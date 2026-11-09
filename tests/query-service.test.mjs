import assert from 'node:assert/strict'
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { buildWorkbenchBootstrap, QueryService } from '../lib/index.js'

class Table {
  records = new Map()
  get(id) { return this.records.get(id) }
  entries() { return this.records.entries() }
  async put(id, value) { this.records.set(id, structuredClone(value)) }
}

function store() {
  const value = {
    projects: new Table(), projectAgentMemberships: new Table(), agentCapabilityClaims: new Table(), resourceAccessGrants: new Table(), repositoryStackProfiles: new Table(),
    requirementDecisions: new Table(), taskRuns: new Table(), verificationEvidence: new Table(), planningOperations: new Table(), projectReviews: new Table(), deliveryRecords: new Table(),
    issues: new Table(), activity: new Table(), transcripts: new Table(), artifacts: new Table(),
    storageMutationIntents: new Table(), deliveryIntegrationIntents: new Table(),
  }
  value.unresolvedStorageMutationIntents = (projectId) => [...value.storageMutationIntents.records.values()].filter((item) => item.projectId === projectId && !['committed', 'compensated'].includes(item.status))
  value.unresolvedDeliveryIntegrationIntents = (projectId) => [...value.deliveryIntegrationIntents.records.values()].filter((item) => item.projectId === projectId && item.status !== 'committed')
  return value
}

test('QueryService readiness and overview prioritize unresolved storage facts', async () => {
  const root = await mkdtemp(join(tmpdir(), 'po-query-'))
  try {
    await mkdir(join(root, '.git'))
    const data = store()
    const project = { id: 'project-1', name: 'Project', cwd: root, status: 'decomposing', deliveryStage: 'planning', revision: 2, taskIds: [], activePlanningOperationId: 'operation-1', createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' }
    await data.projects.put(project.id, project)
    await data.projectAgentMemberships.put('member-1', { id: 'member-1', projectId: project.id, agentId: 'agent-1', status: 'active', autoAssignable: true })
    await data.storageMutationIntents.put('intent-1', { id: 'intent-1', projectId: project.id, status: 'needs_reconciliation' })
    await data.planningOperations.put('operation-1', { id: 'operation-1', projectId: project.id, status: 'running', stage: 'committed', createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' })

    const query = new QueryService(data)
    const readiness = await query.projectReadiness(project.id, true)
    const overview = query.projectOverview(project.id)
    assert.equal(readiness.planningReadiness.status, 'blocked')
    assert.equal(readiness.executionPreparation.status, 'blocked')
    assert.equal(readiness.planningReadiness.checks.find((item) => item.code === 'storage_consistent').actionCode, 'reconcile_storage')
    assert.equal(overview.conclusionCode, 'storage_reconciliation_required')
    assert.deepEqual(overview.nextAction, { code: 'reconcile_storage', subjectId: 'intent-1' })
    assert.equal(overview.counts.unresolvedIntents, 1)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('QueryService surfaces unresolved Delivery Integration intents without offering generic storage replay', async () => {
  const root = await mkdtemp(join(tmpdir(), 'po-query-delivery-'))
  try {
    await mkdir(join(root, '.git'))
    const data = store()
    const project = { id: 'project-1', name: 'Project', cwd: root, status: 'running', deliveryStage: 'executing', revision: 2, taskIds: [], createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' }
    await data.projects.put(project.id, project)
    await data.deliveryIntegrationIntents.put('delivery-intent-1', { id: 'delivery-intent-1', projectId: project.id, status: 'manual_required', createdAt: '2026-01-01T00:00:00.000Z' })

    const query = new QueryService(data)
    const readiness = await query.projectReadiness(project.id, true)
    const overview = query.projectOverview(project.id)
    const check = readiness.executionPreparation.checks.find((item) => item.code === 'delivery_integration_consistent')
    assert.equal(check.status, 'blocked')
    assert.equal(check.actionCode, 'review_delivery')
    assert.equal(overview.conclusionCode, 'delivery_integration_reconciliation_required')
    assert.deepEqual(overview.nextAction, { code: 'review_delivery', subjectId: 'delivery-intent-1' })
    assert.equal(overview.counts.unresolvedIntents, 1)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('QueryService history uses a bounded watermark cursor', async () => {
  const data = store()
  await data.projects.put('project-1', { id: 'project-1', status: 'draft', revision: 1, taskIds: [], cwd: '/tmp', createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' })
  for (const [id, createdAt] of [['run-1', '2026-01-01T00:00:00.000Z'], ['run-2', '2026-01-02T00:00:00.000Z'], ['run-3', '2026-01-03T00:00:00.000Z']]) {
    await data.taskRuns.put(id, { id, projectId: 'project-1', status: 'completed', createdAt })
  }
  const query = new QueryService(data)
  const first = query.projectHistory('project-1', 'task-runs', undefined, 2)
  assert.deepEqual(first.items.map((item) => item.id), ['run-3', 'run-2'])
  assert.equal(first.hasMore, true)
  await data.taskRuns.put('run-4', { id: 'run-4', projectId: 'project-1', status: 'completed', createdAt: '2026-01-04T00:00:00.000Z' })
  const second = query.projectHistory('project-1', 'task-runs', first.nextCursor, 2)
  assert.deepEqual(second.items.map((item) => item.id), ['run-1'])
  assert.equal(second.hasMore, false)
  assert.equal(second.watermark, first.watermark)
})

test('QueryService history keeps a frozen watermark across 10,000 records without duplicates', async () => {
  const data = store()
  await data.projects.put('project-1', { id: 'project-1', status: 'draft', revision: 1, taskIds: [], cwd: '/tmp', createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' })
  await Promise.all(Array.from({ length: 10_000 }, (_, index) => data.taskRuns.put(`run-${index}`, {
    id: `run-${index}`, projectId: 'project-1', status: 'completed', createdAt: new Date(index * 1_000).toISOString(),
  })))
  const query = new QueryService(data)
  const seen = []
  let cursor
  let watermark
  do {
    const page = query.projectHistory('project-1', 'task-runs', cursor, 100)
    watermark ??= page.watermark
    assert.equal(page.watermark, watermark)
    assert.ok(page.items.length <= 100)
    seen.push(...page.items.map((item) => item.id))
    cursor = page.nextCursor
    if (!page.hasMore) break
  } while (true)
  assert.equal(seen.length, 10_000)
  assert.equal(new Set(seen).size, 10_000)
  assert.equal(seen[0], 'run-9999')
  assert.equal(seen.at(-1), 'run-0')
})

test('workbench bootstrap bounds 100 projects and 10,000 historical evidence records without losing active or latest runs', () => {
  const projects = Array.from({ length: 100 }, (_, index) => ({
    id: `project-${index}`, name: `Project ${index}`, cwd: '/tmp', status: 'running', revision: 1, taskIds: [],
    createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
  }))
  const issues = Array.from({ length: 100 }, (_, index) => ({ id: `issue-${index}`, projectId: `project-${index}`, status: 'in_progress', title: `Issue ${index}`, description: '', priority: 'medium', labels: [], createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' }))
  const taskRuns = Array.from({ length: 10_000 }, (_, index) => ({
    id: `run-${index}`, projectId: `project-${index % 100}`, issueId: `issue-${index % 100}`, taskId: `task-${index % 500}`,
    status: index === 0 ? 'running' : 'completed', trigger: 'system', attempt: 1,
    createdAt: new Date(index * 1_000).toISOString(),
  }))
  const activity = taskRuns.map((run, index) => ({ id: `activity-${index}`, projectId: run.projectId, issueId: run.issueId, taskRunId: run.id, actorType: 'system', type: 'test', message: 'x'.repeat(100), createdAt: run.createdAt }))
  const transcripts = taskRuns.map((run, index) => ({ id: `transcript-${index}`, taskRunId: run.id, sequence: 1, role: 'assistant', kind: 'message', text: 'x'.repeat(200), createdAt: run.createdAt }))
  const artifacts = taskRuns.map((run, index) => ({ id: `artifact-${index}`, projectId: run.projectId, issueId: run.issueId, taskRunId: run.id, kind: 'log', name: `Artifact ${index}`, status: 'available', content: 'x'.repeat(200), metadata: {}, createdAt: run.createdAt }))
  const snapshot = {
    agents: [], projects, tasks: [], approvals: [], runs: [], planHashes: {}, runtimes: [], resources: [], issues, taskRuns, activity,
    comments: [], decisions: [], squads: [], delegations: [], transcripts, artifacts, commands: [], externalTriggers: [], skills: [], workspaceLeases: [], localDirectoryLocks: [],
    projectAgentMemberships: [], projectSquadBindings: [], projectAgentMembershipSources: [], featureUsageDaily: [], runtimeOverview: { defaultHost: { id: 'default-host', name: 'Host', status: 'online', capabilities: [], boundAgentCount: 0 }, customCount: 0, abnormalCount: 0, archivedCount: 0 }, inbox: [], agentWorkloads: [], runStatistics: [],
  }
  const bootstrap = buildWorkbenchBootstrap(snapshot)
  const bootstrapRunIds = new Set(bootstrap.snapshot.taskRuns.map((run) => run.id))
  assert.equal(bootstrap.schemaVersion, 1)
  assert.deepEqual(bootstrap.totals, { taskRuns: 10_000, activity: 10_000, transcripts: 10_000, artifacts: 10_000 })
  assert.ok(bootstrap.snapshot.taskRuns.length <= 601)
  assert.ok(bootstrap.snapshot.activity.length <= 1_000)
  assert.equal(bootstrap.snapshot.transcripts.length, 0)
  assert.equal(bootstrap.snapshot.artifacts.length, 0)
  assert.equal(bootstrapRunIds.has('run-0'), true)
  assert.equal(bootstrapRunIds.has('run-9999'), true)
  assert.equal(new Set(bootstrap.snapshot.taskRuns.map((run) => run.id)).size, bootstrap.snapshot.taskRuns.length)
  assert.ok(Buffer.byteLength(JSON.stringify(bootstrap)) < Buffer.byteLength(JSON.stringify(snapshot)) * 0.2)
})

test('QueryService loads Issue evidence and visible TaskRun artifacts on demand with explicit bounds', async () => {
  const data = store()
  await data.projects.put('project-1', { id: 'project-1', status: 'running', revision: 1, taskIds: [], cwd: '/tmp', createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' })
  await data.issues.put('issue-1', { id: 'issue-1', projectId: 'project-1', status: 'in_progress' })
  for (let index = 0; index < 120; index += 1) {
    const createdAt = new Date(index * 1_000).toISOString()
    await data.taskRuns.put(`run-${index}`, { id: `run-${index}`, projectId: 'project-1', issueId: 'issue-1', status: 'completed', createdAt })
    await data.activity.put(`activity-${index}`, { id: `activity-${index}`, projectId: 'project-1', issueId: 'issue-1', taskRunId: `run-${index}`, createdAt })
    await data.transcripts.put(`transcript-${index}`, { id: `transcript-${index}`, taskRunId: `run-${index}`, sequence: 1, createdAt })
    for (let artifactIndex = 0; artifactIndex < 21; artifactIndex += 1) {
      await data.artifacts.put(`artifact-${index}-${artifactIndex}`, { id: `artifact-${index}-${artifactIndex}`, projectId: 'project-1', issueId: 'issue-1', taskRunId: `run-${index}`, createdAt })
    }
  }
  await data.artifacts.put('older-run-artifact', { id: 'older-run-artifact', projectId: 'project-1', taskRunId: 'run-0', createdAt: '2026-01-01T00:00:00.000Z' })
  const query = new QueryService(data)
  const context = query.issueContext('issue-1')
  assert.equal(context.taskRuns.length, 100)
  assert.deepEqual(context.totals, { taskRuns: 120, activity: 120, transcripts: 120, artifacts: 2_521 })
  assert.equal(context.transcripts.length, 100)
  assert.equal(context.transcripts.some((entry) => entry.taskRunId === 'run-0'), false)
  assert.equal(context.artifacts.length, 200)
  assert.equal(context.truncated, true)
  assert.equal(context.taskRuns[0].id, 'run-119')

  const batch = query.taskRunArtifacts('project-1', ['run-119', 'run-118'])
  assert.equal(batch.total, 42)
  assert.equal(batch.items.length, 40)
  assert.deepEqual(batch.truncatedTaskRunIds, ['run-119', 'run-118'])
  await assert.rejects(async () => query.taskRunArtifacts('project-1', []), (error) => error.code === 'task-run-query-invalid')
})
