import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync, writeFileSync } from 'node:fs'
import { chmod, mkdir, mkdtemp, realpath, rm, stat, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)
import {
  AgentRecordSchema,
  DEFAULT_AGENT_SEEDS,
  OrchestratorService,
  ProjectRecordSchema,
  RuntimeRecordSchema,
  SquadRecordSchema,
  TaskRecordSchema,
  assertExecutable,
  buildPlanningCheckpointV3,
  digestObject,
  planDigest,
} from '../lib/index.js'

class MemoryTable {
  records = new Map()
  get size() { return this.records.size }
  get(key) { return this.records.get(key) }
  entries() { return [...this.records.entries()][Symbol.iterator]() }
  async put(key, value) { this.records.set(key, structuredClone(value)) }
  async delete(key) { return this.records.delete(key) }
  async update(key, fn) {
    if (!this.records.has(key)) throw new Error('missing key')
    const next = fn(this.records.get(key))
    this.records.set(key, structuredClone(next))
    return next
  }
}

function memoryStore() {
  const store = {
    agents: new MemoryTable(), projects: new MemoryTable(), tasks: new MemoryTable(), approvals: new MemoryTable(), runs: new MemoryTable(), runtimes: new MemoryTable(), resources: new MemoryTable(), issues: new MemoryTable(), taskRuns: new MemoryTable(), activity: new MemoryTable(), domainEvents: new MemoryTable(), comments: new MemoryTable(), decisions: new MemoryTable(), squads: new MemoryTable(), delegations: new MemoryTable(), transcripts: new MemoryTable(), artifacts: new MemoryTable(), commands: new MemoryTable(), externalTriggers: new MemoryTable(), skills: new MemoryTable(), localDirectoryLocks: new MemoryTable(), workspaceLeases: new MemoryTable(), workspaceWriterLeases: new MemoryTable(), taskRunConflictLocks: new MemoryTable(), projectAgentMemberships: new MemoryTable(), projectSquadBindings: new MemoryTable(), projectAgentMembershipSources: new MemoryTable(), featureUsageDaily: new MemoryTable(), planSnapshots: new MemoryTable(), requirementBundles: new MemoryTable(), requirementItems: new MemoryTable(), requirementDecisions: new MemoryTable(), acceptanceCriteria: new MemoryTable(), verificationEvidence: new MemoryTable(), projectReviews: new MemoryTable(), deliveryRecords: new MemoryTable(), planningOperations: new MemoryTable(), planningMetricPolicies: new MemoryTable(), planningMetricPolicyPublishes: new MemoryTable(), planningShadowEvaluations: new MemoryTable(), planningStageAttempts: new MemoryTable(), planningCheckpoints: new MemoryTable(), storageMutationIntents: new MemoryTable(), planningSourceInputs: new MemoryTable(), requirementSourceProfiles: new MemoryTable(), requirementSourceManifests: new MemoryTable(), requirementAnalysisProposals: new MemoryTable(), planningRepairAttempts: new MemoryTable(), sourceDispositionBindings: new MemoryTable(), sourcePolicyPrechecks: new MemoryTable(), requirementDecisionOptionEffects: new MemoryTable(), requirementDecisionPlanningEffects: new MemoryTable(), acceptanceScenarios: new MemoryTable(), acceptanceScenarioCoveragePolicies: new MemoryTable(), planningRiskProfiles: new MemoryTable(), scenarioCoverageReviews: new MemoryTable(), planningReviewsV3: new MemoryTable(), repositorySnapshotsV3: new MemoryTable(), repositoryStackProfiles: new MemoryTable(), repositoryEvidenceRetrievalReports: new MemoryTable(), canonicalTargetBindings: new MemoryTable(), repositoryPolicyBaselines: new MemoryTable(), policyConstraintsV3: new MemoryTable(), planningPolicySnapshots: new MemoryTable(), planningPromptReferenceManifests: new MemoryTable(), requirementCodeBindings: new MemoryTable(), planningProposalPacks: new MemoryTable(), planningReferenceMaps: new MemoryTable(), policyFulfillments: new MemoryTable(), capabilityDefinitions: new MemoryTable(), agentCapabilityClaims: new MemoryTable(), projectCapabilityCatalogSnapshots: new MemoryTable(), resourceAccessGrants: new MemoryTable(), projectAccessGrantSnapshots: new MemoryTable(), capabilityRequirementDrafts: new MemoryTable(), assignmentDrafts: new MemoryTable(), assignmentEvaluations: new MemoryTable(), expectedAssignmentFixtures: new MemoryTable(), planningMetricReleaseReportCreates: new MemoryTable(), planningMetricReleaseReports: new MemoryTable(), taskPreflightsV3: new MemoryTable(), planApprovalsV3: new MemoryTable(), executionDispatches: new MemoryTable(), deliveryIntegrationSnapshots: new MemoryTable(), integrationInclusionEvidence: new MemoryTable(), deliveryConvergenceFindings: new MemoryTable(), deliveryConvergenceReviews: new MemoryTable(), convergenceRepairBaselines: new MemoryTable(), convergenceRepairCarryItems: new MemoryTable(), convergenceCarryValidations: new MemoryTable(),
    projectTasks(project) {
      if (new Set(project.taskIds).size !== project.taskIds.length) throw new Error('duplicate task pointers')
      return project.taskIds.map((id) => {
        const task = store.tasks.get(id)
        if (!task) throw new Error(`missing task ${id}`)
        if (task.projectId !== project.id) throw new Error(`foreign task ${id}`)
        return task
      }).sort((a, b) => a.ordinal - b.ordinal)
    },
    approvalFor(project) { return store.approvals.get(`${project.id}:${project.revision}`) },
    storageCapabilities() { return { transactions: false, compareAndSwap: false, uniqueConstraints: false, orderedAppend: false, serializedDomainWrites: true, durableBeforeMemory: true } },
    unresolvedStorageMutationIntents(projectId) { return [...store.storageMutationIntents.entries()].map(([, value]) => value).filter((value) => value.status !== 'committed' && (projectId === undefined || value.projectId === projectId)) },
    async appendDomainEvent(input) { const sequence = store.domainEvents.size + 1; const event = { ...input, eventId: `event:${sequence}`, sequence, occurredAt: input.occurredAt ?? new Date().toISOString(), schemaVersion: 1 }; await store.domainEvents.put(event.eventId, event); return event },
    readDomainEvents(after = 0, limit = 100, projectId) { const all = [...store.domainEvents.entries()].map(([, value]) => value).sort((a, b) => a.sequence - b.sequence); const filtered = all.filter((value) => value.sequence > after && (projectId === undefined || value.projectId === undefined || value.projectId === projectId)); const events = filtered.slice(0, limit); const latest = all.at(-1)?.sequence ?? 0; return { events, nextCursor: String(events.at(-1)?.sequence ?? latest), latestCursor: String(latest), hasMore: filtered.length > events.length } },
    snapshot() {
      const values = (name) => [...store[name].records.values()]
      return { agents: values('agents'), projects: values('projects'), tasks: values('tasks'), approvals: values('approvals'), runs: values('runs'), planHashes: {}, runtimes: values('runtimes'), resources: values('resources'), issues: values('issues'), taskRuns: values('taskRuns'), activity: values('activity'), eventCursor: String(store.domainEvents.size), comments: values('comments'), decisions: values('decisions'), squads: values('squads'), delegations: values('delegations'), transcripts: values('transcripts'), artifacts: values('artifacts'), commands: values('commands'), externalTriggers: values('externalTriggers'), skills: values('skills'), workspaceLeases: values('workspaceLeases'), localDirectoryLocks: values('localDirectoryLocks'), projectAgentMemberships: values('projectAgentMemberships'), projectSquadBindings: values('projectSquadBindings'), projectAgentMembershipSources: values('projectAgentMembershipSources'), featureUsageDaily: values('featureUsageDaily'), planSnapshots: values('planSnapshots'), requirementBundles: values('requirementBundles'), requirementItems: values('requirementItems'), requirementDecisions: values('requirementDecisions'), acceptanceCriteria: values('acceptanceCriteria'), verificationEvidence: values('verificationEvidence'), projectReviews: values('projectReviews'), deliveryRecords: values('deliveryRecords'), planningOperations: values('planningOperations'), planningMetricPolicies: values('planningMetricPolicies'), planningMetricPolicyPublishes: values('planningMetricPolicyPublishes'), planningShadowEvaluations: values('planningShadowEvaluations'), planningStageAttempts: values('planningStageAttempts'), planningCheckpoints: values('planningCheckpoints'), storageMutationIntents: values('storageMutationIntents'), planningSourceInputs: values('planningSourceInputs'), requirementSourceProfiles: values('requirementSourceProfiles'), requirementSourceManifests: values('requirementSourceManifests'), requirementAnalysisProposals: values('requirementAnalysisProposals'), planningRepairAttempts: values('planningRepairAttempts'), sourceDispositionBindings: values('sourceDispositionBindings'), sourcePolicyPrechecks: values('sourcePolicyPrechecks'), requirementDecisionOptionEffects: values('requirementDecisionOptionEffects'), requirementDecisionPlanningEffects: values('requirementDecisionPlanningEffects'), acceptanceScenarios: values('acceptanceScenarios'), acceptanceScenarioCoveragePolicies: values('acceptanceScenarioCoveragePolicies'), planningRiskProfiles: values('planningRiskProfiles'), scenarioCoverageReviews: values('scenarioCoverageReviews'), planningReviewsV3: values('planningReviewsV3'), repositorySnapshotsV3: values('repositorySnapshotsV3'), repositoryStackProfiles: values('repositoryStackProfiles'), repositoryEvidenceRetrievalReports: values('repositoryEvidenceRetrievalReports'), canonicalTargetBindings: values('canonicalTargetBindings'), repositoryPolicyBaselines: values('repositoryPolicyBaselines'), policyConstraintsV3: values('policyConstraintsV3'), planningPolicySnapshots: values('planningPolicySnapshots'), planningPromptReferenceManifests: values('planningPromptReferenceManifests'), requirementCodeBindings: values('requirementCodeBindings'), planningProposalPacks: values('planningProposalPacks'), planningReferenceMaps: values('planningReferenceMaps'), policyFulfillments: values('policyFulfillments'), capabilityDefinitions: values('capabilityDefinitions'), agentCapabilityClaims: values('agentCapabilityClaims'), projectCapabilityCatalogSnapshots: values('projectCapabilityCatalogSnapshots'), resourceAccessGrants: values('resourceAccessGrants'), projectAccessGrantSnapshots: values('projectAccessGrantSnapshots'), capabilityRequirementDrafts: values('capabilityRequirementDrafts'), assignmentDrafts: values('assignmentDrafts'), assignmentEvaluations: values('assignmentEvaluations'), expectedAssignmentFixtures: values('expectedAssignmentFixtures'), planningMetricReleaseReportCreates: values('planningMetricReleaseReportCreates'), planningMetricReleaseReports: values('planningMetricReleaseReports'), taskPreflightsV3: values('taskPreflightsV3'), planApprovalsV3: values('planApprovalsV3'), executionDispatches: values('executionDispatches'), deliveryIntegrationSnapshots: values('deliveryIntegrationSnapshots'), integrationInclusionEvidence: values('integrationInclusionEvidence'), deliveryConvergenceFindings: values('deliveryConvergenceFindings'), deliveryConvergenceReviews: values('deliveryConvergenceReviews'), convergenceRepairBaselines: values('convergenceRepairBaselines'), convergenceRepairCarryItems: values('convergenceRepairCarryItems'), convergenceCarryValidations: values('convergenceCarryValidations'), inbox: [], agentWorkloads: [], runStatistics: [] }
    },
  }
  return store
}

const now = '2026-08-17T00:00:00.000Z'

test('initialization seeds the complete delivery lifecycle idempotently', async () => {
  const store = memoryStore()
  const service = new OrchestratorService({}, store)

  await service.initialize()
  const first = service.snapshot().agents
  await service.initialize()
  const second = service.snapshot().agents

  assert.equal(first.length, DEFAULT_AGENT_SEEDS.length)
  assert.deepEqual(new Set(first.map((agent) => agent.id)), new Set(DEFAULT_AGENT_SEEDS.map((seed) => seed.id)))
  assert.deepEqual(second, first)
  assert.equal(service.snapshot().runtimeOverview.defaultHost.boundAgentCount, DEFAULT_AGENT_SEEDS.length)
  for (const agent of first) {
    assert.doesNotThrow(() => AgentRecordSchema.parse(agent))
    assert.equal(agent.status, 'active')
    assert.equal(agent.preset, 'standard')
    assert.equal(agent.access, 'only_me')
    assert.equal(agent.runtimeId, undefined)
    assert.ok(agent.persona.length >= 300)
    for (const heading of ['# 使命', '# 工作方式', '# 输出门禁', '# 边界与升级']) assert.match(agent.persona, new RegExp(heading))
    assert.equal(new Set(agent.skills).size, agent.skills.length)
  }
  assert.equal(first.filter((agent) => agent.toolPolicy === 'read_only').length, 5)
  assert.equal(first.filter((agent) => agent.toolPolicy === 'full').length, 3)
})

test('WorkspaceWriter rejects a second writer and advances the persisted fencing token after release', async () => {
  const lockDirectory = await mkdtemp(join(tmpdir(), 'po-workspace-writer-'))
  const store = memoryStore()
  const options = { workspaceWriter: { workspaceIdentity: 'workspace-writer-lifecycle', lockDirectory } }
  const first = new OrchestratorService({}, store, undefined, undefined, options)
  const contender = new OrchestratorService({}, memoryStore(), undefined, undefined, options)
  try {
    await first.initialize()
    const firstStatus = first.workspaceWriterStatus()
    assert.equal(firstStatus.health, 'healthy')
    assert.equal(firstStatus.fencingToken, 1)
    assert.equal(store.workspaceWriterLeases.get(firstStatus.workspaceIdentityDigest).releasedAt, undefined)
    await assert.rejects(() => contender.initialize(), (error) => error.code === 'workspace-writer-active' && error.status === 409)

    await first.close()
    const released = store.workspaceWriterLeases.get(firstStatus.workspaceIdentityDigest)
    assert.equal(released.fencingToken, 1)
    assert.equal(released.releaseReason, 'service-closed')
    assert.ok(released.releasedAt)

    const successor = new OrchestratorService({}, store, undefined, undefined, options)
    await successor.initialize()
    const successorStatus = successor.workspaceWriterStatus()
    assert.equal(successorStatus.health, 'healthy')
    assert.equal(successorStatus.fencingToken, 2)
    assert.equal(store.workspaceWriterLeases.get(successorStatus.workspaceIdentityDigest).ownerInstanceId, successorStatus.ownerInstanceId)
    await successor.close()
  } finally {
    await contender.close()
    await first.close()
    await rm(lockDirectory, { recursive: true, force: true })
  }
})

test('initialization preserves custom and legacy default Agents while adding only missing lifecycle roles', async () => {
  const store = memoryStore()
  const service = new OrchestratorService({}, store)
  const custom = await service.createAgent({ name: 'Custom Domain Agent', role: 'Domain Specialist', persona: 'Keep this user-defined configuration unchanged.' })
  const legacy = await service.createAgent({ name: 'Legacy implementation agent', role: 'Software Engineer', persona: 'Keep this legacy implementation configuration unchanged.' })

  await service.initialize()
  const first = service.snapshot().agents
  await service.initialize()
  const second = service.snapshot().agents

  assert.equal(store.agents.get(custom.id).persona, custom.persona)
  assert.equal(store.agents.get(legacy.id).persona, legacy.persona)
  assert.equal(first.filter((agent) => agent.role === 'Software Engineer').length, 1)
  assert.equal(first.some((agent) => agent.id === 'default-agent-software-engineer'), false)
  assert.equal(first.length, DEFAULT_AGENT_SEEDS.length + 1)
  assert.deepEqual(second, first)
})

test('initialization idempotently backfills manual provenance for legacy active project memberships', async () => {
  const store = memoryStore()
  const service = new OrchestratorService({}, store)
  const agent = await service.createAgent({ name: 'Legacy Member', role: 'Engineer', description: '', persona: 'Build.', preset: 'standard', toolPolicy: 'full' })
  const project = await service.createProject({ name: 'Legacy Project', cwd: '/tmp', prd: 'Legacy.', technicalDesign: 'Backfill.' })
  const membership = { id: `${project.id}:${agent.id}`, projectId: project.id, agentId: agent.id, projectRole: 'Legacy Role', autoAssignable: true, status: 'active', joinedBy: 'legacy', joinedAt: now, updatedAt: now }
  await store.projectAgentMemberships.put(membership.id, membership)

  await service.initialize()
  await service.initialize()

  const sources = service.listProjectAgentMembershipSources(project.id).filter((item) => item.agentId === agent.id && item.status === 'active')
  assert.equal(sources.length, 1)
  assert.equal(sources[0].sourceType, 'manual')
  assert.equal(sources[0].projectRole, membership.projectRole)
})

test('initialization idempotently migrates exactly 31 legacy Tasks without duplicating Issues or Decisions', async () => {
  const store = memoryStore()
  const service = new OrchestratorService({}, store)
  const legacyAgent = await service.createAgent({ name: 'Legacy Delivery Agent', role: 'Engineer', persona: 'Preserve legacy work.', toolPolicy: 'full' })
  const taskIds = Array.from({ length: 31 }, (_, index) => `legacy-task-${index + 1}`)
  const legacyProject = { id: 'legacy-31-project', name: 'Legacy 31 Task Project', summary: '', cwd: '/tmp', prd: 'Legacy requirements.', technicalDesign: 'Legacy design.', status: 'draft', revision: 7, taskIds, leadAgentId: legacyAgent.id, createdAt: now, updatedAt: now }
  await store.projects.put(legacyProject.id, legacyProject)
  for (const [index, id] of taskIds.entries()) {
    const status = index % 3 === 0 ? 'completed' : index % 3 === 1 ? 'failed' : 'draft'
    await store.tasks.put(id, { id, projectId: legacyProject.id, ordinal: index, title: `Legacy Task ${index + 1}`, kind: 'code', description: `Legacy task ${index + 1}.`, acceptanceCriteria: ['preserved'], dependencies: [], testCommand: 'true', agentId: legacyAgent.id, status, createdAt: now, updatedAt: now })
  }
  await store.approvals.put('legacy-31-approval', { id: 'legacy-31-approval', projectId: legacyProject.id, revision: 7, planHash: 'a'.repeat(64), actor: 'legacy-owner', approvedAt: now })

  await service.initialize()
  const firstTaskIssueIds = taskIds.map((id) => store.tasks.get(id).issueId)
  const firstIssueIds = [...store.issues.records.values()].filter((issue) => issue.projectId === legacyProject.id).map((issue) => issue.id).sort()
  const firstDecisionIds = [...store.decisions.records.values()].filter((decision) => decision.projectId === legacyProject.id).map((decision) => decision.id)
  const firstMigratedProject = structuredClone(store.projects.get(legacyProject.id))
  await service.initialize()

  const migratedTasks = taskIds.map((id) => store.tasks.get(id))
  const migratedIssues = [...store.issues.records.values()].filter((issue) => issue.projectId === legacyProject.id)
  assert.equal(migratedTasks.length, 31)
  assert.equal(migratedIssues.filter((issue) => issue.parentIssueId === undefined).length, 1)
  assert.equal(migratedIssues.filter((issue) => issue.parentIssueId !== undefined).length, 31)
  assert.equal(new Set(migratedTasks.map((task) => task.issueId)).size, 31)
  assert.deepEqual(migratedTasks.map((task) => task.issueId), firstTaskIssueIds)
  assert.deepEqual(migratedIssues.map((issue) => issue.id).sort(), firstIssueIds)
  for (const task of migratedTasks) {
    const issue = store.issues.get(task.issueId)
    assert.equal(issue.status, task.status === 'completed' ? 'done' : task.status === 'failed' ? 'blocked' : 'todo')
    assert.equal(task.assignmentPolicy, undefined)
  }
  assert.equal([...store.projectAgentMemberships.records.values()].filter((membership) => membership.projectId === legacyProject.id && membership.agentId === legacyAgent.id && membership.status === 'active').length, 1)
  assert.equal([...store.projectAgentMembershipSources.records.values()].filter((source) => source.projectId === legacyProject.id && source.agentId === legacyAgent.id && source.status === 'active').length, 1)
  assert.deepEqual([...store.decisions.records.values()].filter((decision) => decision.projectId === legacyProject.id).map((decision) => decision.id), firstDecisionIds)
  assert.deepEqual(firstDecisionIds, ['legacy-approval:legacy-31-approval'])
  assert.deepEqual(store.projects.get(legacyProject.id), firstMigratedProject)
})

test('legacy persisted records parse without Multica metadata', () => {
  const agent = AgentRecordSchema.parse({
    id: 'legacy-agent', name: 'Legacy Agent', role: 'Engineer', description: '', persona: 'Work safely.',
    preset: 'standard', toolPolicy: 'full', status: 'active', createdAt: now, updatedAt: now,
  })
  const project = ProjectRecordSchema.parse({
    id: 'legacy-project', name: 'Legacy Project', summary: '', cwd: '/tmp', prd: 'PRD', technicalDesign: 'Design',
    status: 'draft', revision: 1, taskIds: ['legacy-task'], createdAt: now, updatedAt: now,
  })
  const task = TaskRecordSchema.parse({
    id: 'legacy-task', projectId: project.id, ordinal: 0, title: 'Legacy Task', kind: 'code', description: 'Implement',
    acceptanceCriteria: ['done'], dependencies: [], testCommand: 'true', status: 'draft', createdAt: now, updatedAt: now,
  })
  assert.equal(agent.skills, undefined)
  assert.equal(project.priority, undefined)
  assert.equal(project.owner, undefined)
  assert.equal(task.priority, undefined)
  assert.equal(task.tags, undefined)
  assert.equal(task.boardStage, undefined)
})

test('board scheduling persists only stage and timestamp without changing execution or approval facts', async () => {
  const store = memoryStore()
  const service = new OrchestratorService({}, store)
  const approved = await approvedProject(service, store, ['true', 'true'])
  const task = {
    ...store.tasks.get('code'),
    status: 'failed',
    sessionId: 'session-1',
    latestRunId: 'run-1',
    testExitCode: 1,
    testOutput: 'failing evidence',
    resultSummary: 'Agent result',
    failureReason: 'Test failed',
  }
  await store.tasks.put(task.id, task)
  const projectBefore = structuredClone(store.projects.get(approved.id))
  const approvalBefore = structuredClone(store.approvalFor(projectBefore))
  const digestBefore = planDigest(projectBefore, store.projectTasks(projectBefore))

  const updated = await service.updateTaskBoardStage(task.id, { boardStage: 'review' })

  assert.equal(updated.boardStage, 'review')
  assert.notEqual(updated.updatedAt, task.updatedAt)
  const { boardStage, updatedAt, ...persistedFacts } = store.tasks.get(task.id)
  const { updatedAt: oldUpdatedAt, ...originalFacts } = task
  assert.deepEqual(persistedFacts, originalFacts)
  assert.equal(boardStage, 'review')
  assert.notEqual(updatedAt, oldUpdatedAt)
  assert.deepEqual(store.projects.get(approved.id), projectBefore)
  assert.deepEqual(store.approvalFor(projectBefore), approvalBefore)
  assert.equal(planDigest(projectBefore, store.projectTasks(projectBefore)), digestBefore)
})

test('board scheduling rejects invalid stages, active projects, and completed tasks without persistence', async () => {
  for (const projectStatus of ['approved', 'running', 'decomposing']) {
    const store = memoryStore()
    const service = new OrchestratorService({}, store)
    const approved = await approvedProject(service, store, ['true', 'true'])
    await store.projects.put(approved.id, { ...approved, status: projectStatus })
    const before = structuredClone(store.tasks.get('code'))
    if (projectStatus === 'approved') {
      await assert.rejects(() => service.updateTaskBoardStage('code', { boardStage: 'done' }))
    } else {
      await assert.rejects(
        () => service.updateTaskBoardStage('code', { boardStage: 'todo' }),
        (error) => error.code === 'project-active' && error.status === 409,
      )
    }
    assert.deepEqual(store.tasks.get('code'), before)
  }

  const store = memoryStore()
  const service = new OrchestratorService({}, store)
  const approved = await approvedProject(service, store, ['true', 'true'])
  const completed = { ...store.tasks.get('code'), status: 'completed', testExitCode: 0, testOutput: 'passed' }
  await store.tasks.put(completed.id, completed)
  await assert.rejects(
    () => service.updateTaskBoardStage(completed.id, { boardStage: 'review' }),
    (error) => error.code === 'task-completed' && error.status === 409,
  )
  assert.deepEqual(store.tasks.get(completed.id), completed)
  assert.equal(store.projects.get(approved.id).revision, approved.revision)
})

test('board scheduling rejects orphan tasks without writing task or project state', async () => {
  const store = memoryStore()
  const service = new OrchestratorService({}, store)
  const project = await service.createProject({ name: 'Orphan project', cwd: '/tmp', prd: 'PRD', technicalDesign: 'Design' })
  const orphan = { id: 'orphan', projectId: project.id, ordinal: 0, title: 'Orphan', kind: 'code', description: 'Hidden', acceptanceCriteria: ['done'], dependencies: [], testCommand: 'true', status: 'draft', createdAt: now, updatedAt: now }
  await store.tasks.put(orphan.id, orphan)
  const projectBefore = structuredClone(store.projects.get(project.id))

  await assert.rejects(() => service.updateTaskBoardStage(orphan.id, { boardStage: 'todo' }), /not part of project/)

  assert.deepEqual(store.tasks.get(orphan.id), orphan)
  assert.deepEqual(store.projects.get(project.id), projectBefore)
})

test('board scheduling fails closed on corrupt project task pointers without writes', async () => {
  for (const corruption of ['duplicate', 'missing', 'foreign']) {
    const store = memoryStore()
    const service = new OrchestratorService({}, store)
    const project = await service.createProject({ name: 'Corrupt project', cwd: '/tmp', prd: 'PRD', technicalDesign: 'Design' })
    const task = { id: 'code', projectId: project.id, ordinal: 0, title: 'Code', kind: 'code', description: 'Implement', acceptanceCriteria: ['done'], dependencies: [], testCommand: 'true', status: 'draft', createdAt: now, updatedAt: now }
    const foreign = { ...task, id: 'foreign', projectId: 'other-project' }
    await store.tasks.put(task.id, task)
    if (corruption === 'foreign') await store.tasks.put(foreign.id, foreign)
    const taskIds = corruption === 'duplicate' ? ['code', 'code'] : corruption === 'missing' ? ['code', 'missing'] : ['code', 'foreign']
    await store.projects.put(project.id, { ...project, taskIds })
    const tasksBefore = structuredClone([...store.tasks.records.entries()])
    const projectBefore = structuredClone(store.projects.get(project.id))

    await assert.rejects(() => service.updateTaskBoardStage(task.id, { boardStage: 'todo' }), new RegExp(corruption))

    assert.deepEqual([...store.tasks.records.entries()], tasksBefore)
    assert.deepEqual(store.projects.get(project.id), projectBefore)
  }
})

test('new agent, project, and task records persist metadata defaults and explicit values', async () => {
  const store = memoryStore()
  const service = new OrchestratorService({}, store)
  const defaultAgent = await service.createAgent({ name: 'Default Agent', role: 'Engineer', persona: 'Implement safely.' })
  assert.deepEqual(defaultAgent.skills, [])
  assert.deepEqual(store.agents.get(defaultAgent.id).skills, [])

  const skilledAgent = await service.createAgent({
    name: 'Skilled Agent', role: 'Reviewer', persona: 'Review safely.', skills: ['API review', 'test evidence'],
  })
  assert.deepEqual(skilledAgent.skills, ['API review', 'test evidence'])
  const resetAgent = await service.updateAgent(skilledAgent.id, {
    name: 'Skilled Agent', role: 'Reviewer', persona: 'Review safely.',
  })
  assert.deepEqual(resetAgent.skills, [])

  const defaultProject = await service.createProject({ name: 'Default Project', cwd: '/tmp', prd: 'PRD', technicalDesign: 'Design' })
  assert.equal(defaultProject.priority, 'medium')
  assert.equal(defaultProject.owner, '')
  assert.equal(store.projects.get(defaultProject.id).priority, 'medium')

  const explicitProject = await service.createProject({
    name: 'Owned Project', cwd: '/tmp', prd: 'PRD', technicalDesign: 'Design', priority: 'high', owner: 'Platform Team',
  })
  assert.equal(explicitProject.priority, 'high')
  assert.equal(explicitProject.owner, 'Platform Team')
  const resetProject = await service.updateProject(explicitProject.id, {
    name: 'Owned Project', cwd: '/tmp', prd: 'PRD', technicalDesign: 'Design',
  })
  assert.equal(resetProject.priority, 'medium')
  assert.equal(resetProject.owner, '')

  const defaultTask = await service.createTask(defaultProject.id, {
    title: 'Default Task', kind: 'code', description: 'Implement', acceptanceCriteria: ['done'], testCommand: 'true',
  })
  assert.equal(defaultTask.priority, 'medium')
  assert.deepEqual(defaultTask.tags, [])

  await service.addProjectAgent(explicitProject.id, { agentId: skilledAgent.id, projectRole: 'Reviewer', autoAssignable: true, joinedBy: 'tester' })
  const explicitTask = await service.createTask(explicitProject.id, {
    title: 'Urgent Task', kind: 'test', description: 'Verify', acceptanceCriteria: ['passes'], testCommand: 'true',
    priority: 'urgent', tags: ['release', 'regression'], agentId: skilledAgent.id,
  })
  assert.equal(explicitTask.priority, 'urgent')
  assert.deepEqual(explicitTask.tags, ['release', 'regression'])
})

test('metadata inputs enforce enum, length, count, and uniqueness bounds without persistence', async () => {
  const store = memoryStore()
  const service = new OrchestratorService({}, store)
  const agentInput = { name: 'Bounded Agent', role: 'Engineer', persona: 'Work safely.' }
  await assert.rejects(() => service.createAgent({ ...agentInput, skills: Array.from({ length: 51 }, (_, index) => `skill-${index}`) }))
  await assert.rejects(() => service.createAgent({ ...agentInput, skills: ['duplicate', 'duplicate'] }))
  await assert.rejects(() => service.createAgent({ ...agentInput, skills: ['x'.repeat(101)] }))
  assert.equal(store.agents.size, 0)

  const projectInput = { name: 'Bounded Project', cwd: '/tmp', prd: 'PRD', technicalDesign: 'Design' }
  await assert.rejects(() => service.createProject({ ...projectInput, priority: 'critical' }))
  await assert.rejects(() => service.createProject({ ...projectInput, owner: 'x'.repeat(201) }))
  assert.equal(store.projects.size, 0)

  const project = await service.createProject(projectInput)
  const taskInput = { title: 'Bounded Task', kind: 'code', description: 'Implement', acceptanceCriteria: ['done'], testCommand: 'true' }
  await assert.rejects(() => service.createTask(project.id, { ...taskInput, priority: 'critical' }))
  await assert.rejects(() => service.createTask(project.id, { ...taskInput, tags: Array.from({ length: 51 }, (_, index) => `tag-${index}`) }))
  await assert.rejects(() => service.createTask(project.id, { ...taskInput, tags: ['duplicate', 'duplicate'] }))
  await assert.rejects(() => service.createTask(project.id, { ...taskInput, tags: ['x'.repeat(65)] }))
  assert.equal(store.tasks.size, 0)
  assert.deepEqual(store.projects.get(project.id).taskIds, [])
})

test('editing an approved task invalidates approval and increments revision', async () => {
  const store = memoryStore()
  const service = new OrchestratorService({}, store)
  const project = await service.createProject({ name: 'Test project', summary: '', cwd: '/tmp', prd: 'PRD', technicalDesign: 'Design' })
  const agent = await service.createAgent({ name: 'Approval agent', role: 'Engineer', persona: 'Work safely.' })
  await service.addProjectAgent(project.id, { agentId: agent.id, projectRole: 'Engineer', autoAssignable: true, joinedBy: 'tester' })
  const codeTask = { id: 'code', projectId: project.id, ordinal: 0, title: 'Code', kind: 'code', description: 'Implement', acceptanceCriteria: ['done'], dependencies: [], agentId: agent.id, testCommand: 'true', status: 'completed', testExitCode: 0, testOutput: 'passed', createdAt: now, updatedAt: now }
  const testTask = { id: 'test', projectId: project.id, ordinal: 1, title: 'Test', kind: 'test', description: 'Verify', acceptanceCriteria: ['passes'], dependencies: ['code'], agentId: agent.id, testCommand: 'true', status: 'completed', testExitCode: 0, testOutput: 'passed', createdAt: now, updatedAt: now }
  await store.tasks.put(codeTask.id, codeTask)
  await store.tasks.put(testTask.id, testTask)
  await store.projects.put(project.id, { ...project, status: 'awaiting_approval', revision: 2, taskIds: ['code', 'test'] })

  const approved = await service.approveProject(project.id, 'tester')
  assert.equal(approved.status, 'approved')
  const approval = store.approvalFor(approved)
  assert.doesNotThrow(() => assertExecutable(approved, store.projectTasks(approved), approval))

  await service.updateTask('code', { testCommand: 'printf changed' })
  const changed = store.projects.get(project.id)
  assert.equal(changed.status, 'awaiting_approval')
  assert.equal(changed.revision, 3)
  assert.equal(changed.approvedRevision, undefined)
  assert.deepEqual(store.projectTasks(changed).map((task) => task.status), ['draft', 'draft'])
  assert.equal(store.tasks.get('test').testExitCode, undefined)
  assert.equal(store.tasks.get('test').testOutput, undefined)
  assert.throws(() => assertExecutable(changed, store.projectTasks(changed), store.approvalFor(changed)), /approved/)
})

test('editing task priority and tags invalidates approval and clears all task evidence', async () => {
  const store = memoryStore()
  const service = new OrchestratorService({}, store)
  const approved = await approvedProject(service, store, ['true', 'true'])
  for (const task of store.projectTasks(approved)) {
    await store.tasks.put(task.id, { ...task, status: 'completed', testExitCode: 0, testOutput: 'old evidence' })
  }

  const updated = await service.updateTask('code', { priority: 'urgent', tags: ['security', 'backend'] })
  const changed = store.projects.get(approved.id)
  assert.equal(updated.priority, 'urgent')
  assert.deepEqual(updated.tags, ['security', 'backend'])
  assert.equal(changed.revision, approved.revision + 1)
  assert.equal(changed.approvedRevision, undefined)
  assert.equal(changed.status, 'awaiting_approval')
  assert.deepEqual(store.projectTasks(changed).map((task) => task.status), ['draft', 'draft'])
  assert.deepEqual(store.projectTasks(changed).map((task) => task.testExitCode), [undefined, undefined])
  assert.deepEqual(store.projectTasks(changed).map((task) => task.testOutput), [undefined, undefined])
})

test('saving Project metadata preserves the current plan, approval, and task evidence', async () => {
  const store = memoryStore()
  const service = new OrchestratorService(agentContext('Unused.'), store)
  const approved = await approvedProject(service, store, ['true', 'true'])
  const beforeTasks = structuredClone(store.projectTasks(approved))
  const changed = await service.updateProject(approved.id, {
    name: 'Changed project name',
    summary: 'Changed summary',
    cwd: approved.cwd,
    prd: approved.prd,
    technicalDesign: approved.technicalDesign,
    priority: approved.priority,
    owner: approved.owner,
    taskLanguage: approved.taskLanguage,
  })
  assert.equal(changed.status, approved.status)
  assert.equal(changed.revision, approved.revision)
  assert.equal(changed.approvedRevision, approved.approvedRevision)
  assert.equal(changed.name, 'Changed project name')
  assert.equal(changed.summary, 'Changed summary')
  assert.deepEqual(store.projectTasks(changed), beforeTasks)
  assert.doesNotThrow(() => assertExecutable(changed, store.projectTasks(changed), store.approvalFor(changed)))

  await assert.rejects(() => service.updateProject(approved.id, {
    name: changed.name,
    summary: changed.summary,
    cwd: approved.cwd,
    prd: 'Changed PRD',
    technicalDesign: approved.technicalDesign,
    priority: approved.priority,
    owner: approved.owner,
    taskLanguage: approved.taskLanguage,
  }), (error) => error.code === 'project-replan-required')
  assert.deepEqual(store.projectTasks(changed), beforeTasks)
})

test('manual task creation validates the plan and invalidates approval', async () => {
  const store = memoryStore()
  const service = new OrchestratorService({}, store)
  const approved = await approvedProject(service, store, ['true', 'true'])
  const agentId = store.tasks.get('code').agentId

  const created = await service.createTask(approved.id, {
    title: 'Document edge behavior',
    kind: 'test',
    description: 'Add focused edge-case coverage.',
    acceptanceCriteria: ['Edge cases pass.'],
    dependencies: ['code'],
    agentId,
    testCommand: 'node --test',
  })

  const changed = store.projects.get(approved.id)
  assert.equal(created.projectId, approved.id)
  assert.equal(created.ordinal, 2)
  assert.equal(created.status, 'draft')
  assert.equal(changed.status, 'awaiting_approval')
  assert.equal(changed.revision, approved.revision + 1)
  assert.equal(changed.approvedRevision, undefined)
  assert.deepEqual(changed.taskIds, ['code', 'test', created.id])
  assert.deepEqual(store.projectTasks(changed).map((task) => task.status), ['draft', 'draft', 'draft'])
  assert.equal(store.tasks.get('code').testExitCode, undefined)
})

test('manual task creation rejects invalid dependencies, agents, and corrupt plans without committing', async () => {
  const store = memoryStore()
  const service = new OrchestratorService({}, store)
  const project = await service.createProject({ name: 'Manual project', summary: '', cwd: '/tmp', prd: 'PRD', technicalDesign: 'Design' })
  const input = {
    title: 'Manual task', kind: 'code', description: 'Implement safely.', acceptanceCriteria: ['done'],
    dependencies: [], testCommand: 'true',
  }

  await assert.rejects(() => service.createTask(project.id, { ...input, dependencies: ['missing'] }), /unknown task/)
  await assert.rejects(() => service.createTask(project.id, { ...input, agentId: 'missing-agent' }), /not found/)
  const archived = await service.createAgent({ name: 'Archived', role: 'Engineer', description: '', persona: 'Do work.', preset: 'standard', toolPolicy: 'full' })
  await store.agents.put(archived.id, { ...archived, status: 'archived' })
  await assert.rejects(() => service.createTask(project.id, { ...input, agentId: archived.id }), /archived/)
  assert.equal(store.tasks.size, 0)
  assert.equal(store.projects.get(project.id).revision, 1)

  await store.projects.put(project.id, { ...project, taskIds: ['missing-task'] })
  await assert.rejects(() => service.createTask(project.id, input), /missing task/)
  assert.equal(store.tasks.size, 0)
})

test('manual task deletion rejects dependents and invalidates approval after a safe removal', async () => {
  const store = memoryStore()
  const service = new OrchestratorService({}, store)
  const approved = await approvedProject(service, store, ['true', 'true'])

  await assert.rejects(() => service.deleteTask('code'), /任务“Code”仍被“Test”依赖，不能删除/)
  assert.equal(store.projects.get(approved.id).revision, approved.revision)
  assert.notEqual(store.tasks.get('code'), undefined)

  await service.deleteTask('test')
  const changed = store.projects.get(approved.id)
  assert.equal(changed.status, 'awaiting_approval')
  assert.equal(changed.revision, approved.revision + 1)
  assert.equal(changed.approvedRevision, undefined)
  assert.deepEqual(changed.taskIds, ['code'])
  assert.equal(store.tasks.get('test'), undefined)
  assert.equal(store.tasks.get('code').status, 'draft')
  assert.equal(store.tasks.get('code').testExitCode, undefined)
})

test('manual task deletion refuses orphan task records', async () => {
  const store = memoryStore()
  const service = new OrchestratorService({}, store)
  const project = await service.createProject({ name: 'Orphan project', summary: '', cwd: '/tmp', prd: 'PRD', technicalDesign: 'Design' })
  await store.tasks.put('orphan', { id: 'orphan', projectId: project.id, ordinal: 0, title: 'Orphan', kind: 'code', description: 'Hidden', acceptanceCriteria: ['done'], dependencies: [], testCommand: 'true', status: 'draft', createdAt: now, updatedAt: now })
  await assert.rejects(() => service.deleteTask('orphan'), /not part of project/)
  assert.notEqual(store.tasks.get('orphan'), undefined)
  assert.equal(store.projects.get(project.id).revision, 1)
})

test('agent builder returns a validated editable draft without persistence or tools', async () => {
  const store = memoryStore()
  const observation = { availableSkills: [{ name: 'API contract review', description: 'Review API contracts.' }, { name: 'test evidence', description: 'Review test evidence.' }] }
  const response = JSON.stringify({
    name: 'API Reviewer',
    role: 'Backend API Reviewer',
    description: 'Reviews backend contracts and test evidence.',
    persona: '## Responsibilities\nReview API behavior.\n\n## Verification\nCite evidence and report concrete blockers.',
    preset: 'standard',
    toolPolicy: 'read_only',
    skills: ['API contract review', 'test evidence'],
    feedback: 'Created a focused read-only reviewer.',
    assumptions: ['The agent reviews supplied evidence.'],
    openQuestions: ['Which API framework is primary?'],
  })
  const service = new OrchestratorService(agentContext(response, observation), store)
  const draft = await service.draftAgent({ requirement: 'Create a read-only backend API reviewer.' })
  assert.equal(draft.name, 'API Reviewer')
  assert.equal(draft.toolPolicy, 'read_only')
  assert.deepEqual(draft.skills, ['API contract review', 'test evidence'])
  assert.equal(draft.provider, undefined)
  assert.equal(draft.feedback, 'Created a focused read-only reviewer.')
  assert.deepEqual(draft.assumptions, ['The agent reviews supplied evidence.'])
  assert.deepEqual(draft.openQuestions, ['Which API framework is primary?'])
  assert.equal(store.agents.size, 0)
  assert.equal(observation.guardCalls, 1)
  assert.equal(observation.sections.some((section) => section.name === 'deployment:assigned-skills'), false)
  assert.match(observation.prompt, /read-only backend API reviewer/)
  assert.match(observation.prompt, /exact names/)
  assert.match(observation.prompt, /Available Skill catalog/)
  assert.match(observation.prompt, /structured Markdown/)
  assert.match(observation.prompt, /complete editable agent configuration on every turn/)
})

test('agent builder includes conversation and existing draft context while preserving root response fields', async () => {
  const store = memoryStore()
  const observation = { availableSkills: [{ name: 'API review', description: 'Review APIs.' }] }
  const existingDraft = {
    name: 'API Reviewer', role: 'Backend Reviewer', description: 'Reviews APIs.',
    persona: '## Responsibilities\nReview APIs.', preset: 'standard', toolPolicy: 'read_only', skills: ['API review'],
  }
  const response = JSON.stringify({
    ...existingDraft,
    description: 'Reviews APIs with a focus on compatibility.',
    feedback: 'Kept the role and permissions; narrowed the review focus.',
    assumptions: [],
    openQuestions: ['Should security findings block approval?'],
  })
  const service = new OrchestratorService(agentContext(response, observation), store)

  const draft = await service.draftAgent({
    requirement: 'Focus on backward compatibility.',
    messages: [
      { role: 'user', content: 'Create an API reviewer.' },
      { role: 'assistant', content: 'I drafted a read-only reviewer.' },
    ],
    existingDraft,
  })

  assert.equal(draft.name, existingDraft.name)
  assert.equal(draft.description, 'Reviews APIs with a focus on compatibility.')
  assert.match(observation.prompt, /Create an API reviewer/)
  assert.match(observation.prompt, /I drafted a read-only reviewer/)
  assert.match(observation.prompt, /Focus on backward compatibility/)
  assert.match(observation.prompt, /Reviews APIs\./)
  assert.match(observation.prompt, /preserve valid fields/i)
  assert.equal(store.agents.size, 0)

  const partialStore = memoryStore()
  const partialObservation = { availableSkills: observation.availableSkills }
  await new OrchestratorService(agentContext(response, partialObservation), partialStore).draftAgent({
    requirement: 'Complete this unfinished draft.',
    existingDraft: { description: 'A manually entered partial description.' },
  })
  assert.match(partialObservation.prompt, /manually entered partial description/)
  assert.equal(partialStore.agents.size, 0)
})

test('agent builder keeps concise read-only prohibitions and provides role-specific refinement rules', async () => {
  const observation = {}
  const persona = '## 职责\n只读评审需求与代码，按风险给出证据。\n## 边界\n不修改代码，不写入数据。Do not edit, write, delete, deploy, commit or push.\n## 输出\n列出问题、触发条件、位置和未验证项；证据不足不宣称通过。'
  const response = JSON.stringify({
    name: '只读评审', role: 'Reviewer', persona, toolPolicy: 'read_only', skills: [],
    feedback: '保留只读边界。', warnings: [], assumptions: [], openQuestions: [],
  })
  const store = memoryStore()
  const draft = await new OrchestratorService(agentContext(response, observation), store)
    .draftAgent({ requirement: '精简评审指令，保留只读。' })
  assert.equal(draft.persona, persona)
  assert.deepEqual(draft.warnings, [])
  assert.match(observation.prompt, /original requirements.*acceptance criteria/)
  assert.match(observation.prompt, /Do not broaden toolPolicy/)
  assert.match(observation.prompt, /no minimum length/)
  assert.match(observation.prompt, /research.*review.*design/i)
  assert.equal(observation.guardCalls, 1)
  assert.equal(store.agents.size, 0)
})

test('agent builder still rejects unavailable skills and invalid reuse recommendations', async () => {
  const valid = {
    name: 'Reviewer', role: 'Reviewer', persona: 'Review supplied evidence only.',
    toolPolicy: 'read_only', skills: [], feedback: 'Drafted.', warnings: [],
  }
  for (const [response, code] of [
    [{ ...valid, skills: ['invented-skill'] }, 'agent-draft-skill-unavailable'],
    [{ ...valid, reuseRecommendation: { agentId: 'missing', reason: 'Similar name' } }, 'agent-draft-reuse-invalid'],
  ]) {
    const store = memoryStore()
    const observation = {}
    const service = new OrchestratorService(agentContext(JSON.stringify(response), observation), store)
    await assert.rejects(service.draftAgent({ requirement: 'Create a reviewer.' }), (error) => error.code === code)
    assert.equal(store.agents.size, 0)
    for (const guard of observation.toolGuards) {
      assert.match(guard({ name: 'write' }), /cannot execute tools/)
      assert.match(guard({ name: 'read' }), /cannot execute tools/)
    }
  }
})

test('agent builder parses braces inside JSON strings and rejects surrounding or multiple output', async () => {
  const valid = JSON.stringify({
    name: 'Schema Reviewer', role: 'Reviewer', description: 'Reviews schemas.',
    persona: '## Workflow\nInspect examples such as { "key": "value with } brace" } and report them.',
    preset: 'standard', toolPolicy: 'read_only', skills: [], feedback: 'Added schema examples.', assumptions: [], openQuestions: [],
  })
  const validStore = memoryStore()
  const parsed = await new OrchestratorService(agentContext(valid), validStore).draftAgent({ requirement: 'Review schemas.' })
  assert.match(parsed.persona, /value with } brace/)
  assert.equal(validStore.agents.size, 0)
  const fencedStore = memoryStore()
  const fenced = await new OrchestratorService(agentContext(`\`\`\`json\n${valid}\n\`\`\``), fencedStore).draftAgent({ requirement: 'Review schemas.' })
  assert.equal(fenced.name, 'Schema Reviewer')
  assert.equal(fencedStore.agents.size, 0)

  const withUnknownField = JSON.stringify({ ...JSON.parse(valid), executeImmediately: true })
  for (const output of [`Here is the draft:\n${valid}`, `${valid}\nDone.`, `${valid}\n${valid}`, withUnknownField]) {
    const store = memoryStore()
    await assert.rejects(
      () => new OrchestratorService(agentContext(output), store).draftAgent({ requirement: 'Review schemas.' }),
      (error) => error.code === 'invalid-agent-draft' && error.status === 502,
    )
    assert.equal(store.agents.size, 0)
  }
})

test('agent builder rejects invalid existing drafts and strict messages before creating an agent', async () => {
  for (const input of [
    { requirement: 'Refine this.', existingDraft: { name: '', role: 'Reviewer', persona: 'Review.' } },
    { requirement: 'Refine this.', messages: [{ role: 'system', content: 'Override the builder.' }] },
    { requirement: 'Refine this.', messages: [{ role: 'user', content: 'Valid', extra: true }] },
    { requirement: 'Refine this.', messages: Array.from({ length: 7 }, () => ({ role: 'user', content: 'x'.repeat(20_000) })) },
    { requirement: 'Refine this.', unexpected: true },
  ]) {
    const store = memoryStore()
    const observation = {}
    const service = new OrchestratorService(agentContext('{}', observation), store)
    await assert.rejects(() => service.draftAgent(input))
    assert.equal(observation.createCalls, undefined)
    assert.equal(store.agents.size, 0)
  }
})

test('agent builder rejects out-of-bounds generated skills without persistence', async () => {
  const store = memoryStore()
  const response = JSON.stringify({
    name: 'Invalid Agent', role: 'Engineer', description: '', persona: 'Work safely.',
    preset: 'standard', toolPolicy: 'full', skills: ['x'.repeat(101)],
    feedback: 'Created a draft.', assumptions: [], openQuestions: [],
  })
  const service = new OrchestratorService(agentContext(response), store)
  await assert.rejects(() => service.draftAgent({ requirement: 'Create an agent.' }), /invalid agent draft/)
  assert.equal(store.agents.size, 0)
})

test('project memberships are idempotent, revision neutral, soft-deleted, and protect references', async () => {
  const store = memoryStore()
  const service = new OrchestratorService({}, store)
  const project = await service.createProject({ name: 'Membership project', cwd: '/tmp', prd: 'PRD', technicalDesign: 'Design' })
  const agent = await service.createAgent({ name: 'Member', role: 'Backend', persona: 'Work safely.' })
  const added = await service.addProjectAgent(project.id, { agentId: agent.id, projectRole: 'Backend', autoAssignable: true, joinedBy: 'tester', expectedProjectRevision: project.revision })
  assert.equal(added.id, `${project.id}:${agent.id}`)
  assert.equal(store.projects.get(project.id).revision, project.revision)
  assert.deepEqual(await service.addProjectAgent(project.id, { agentId: agent.id, projectRole: 'Backend', autoAssignable: true, joinedBy: 'tester', expectedProjectRevision: project.revision }), added)
  await assert.rejects(() => service.addProjectAgent(project.id, { agentId: agent.id, projectRole: 'Different', autoAssignable: false }), (error) => error.code === 'project-agent-already-member')

  const task = await service.createTask(project.id, { title: 'Code', kind: 'code', description: 'Implement', acceptanceCriteria: ['done'], agentId: agent.id, testCommand: 'true' })
  await assert.rejects(() => service.removeProjectAgent(project.id, agent.id, { expectedMemberUpdatedAt: added.updatedAt, assignedTaskPolicy: 'reject' }), (error) => error.code === 'project-agent-in-use')
  await service.deleteTask(task.id)
  const removed = await service.removeProjectAgent(project.id, agent.id, { expectedMemberUpdatedAt: added.updatedAt, assignedTaskPolicy: 'reject' })
  assert.equal(removed.status, 'removed')
  assert.ok(removed.removedAt)
  await assert.rejects(() => service.createTask(project.id, { title: 'Rejected', kind: 'code', description: 'Implement', acceptanceCriteria: ['done'], agentId: agent.id, testCommand: 'true' }), (error) => error.code === 'project-agent-not-member')
})

test('project team plan snapshots active members, roles, capabilities, and preflight blockers', async () => {
  const store = memoryStore()
  const service = new OrchestratorService({}, store)
  const project = await service.createProject({ name: 'Team plan', cwd: '/tmp', prd: 'PRD', technicalDesign: 'Design' })
  const engineer = await service.createAgent({ name: 'Engineer', role: 'Software Engineer', persona: 'Implement.', capabilities: ['coding'] })
  const reviewer = await service.createAgent({ name: 'Reviewer', role: 'Code Reviewer', persona: 'Review.', capabilities: ['review'] })
  await service.addProjectAgents(project.id, { members: [{ agentId: engineer.id, projectRole: 'Engineer', autoAssignable: true }, { agentId: reviewer.id, projectRole: 'Reviewer', autoAssignable: true }] })
  const code = await service.createTask(project.id, { title: 'Code', kind: 'code', description: 'Implement', acceptanceCriteria: ['done'], agentId: engineer.id, assignmentPolicy: { mode: 'single_agent', requiredRoles: ['Engineer'], requiredCapabilities: ['coding'], allowedAgentIds: [], allowedSquadIds: [], requiresIndependentReviewer: true, maxParallel: 1, conflictKeys: [], forbiddenScope: [], escalationConditions: [] }, testCommand: 'true' })
  await service.createTask(project.id, { title: 'Verify', kind: 'test', description: 'Verify', acceptanceCriteria: ['passes'], dependencies: [code.id], agentId: reviewer.id, testCommand: 'true' })
  const plan = service.getProjectTeamPlan(project.id)
  assert.equal(plan.team.members.length, 2)
  assert.equal(plan.team.reviewerAgentId, reviewer.id)
  assert.equal(plan.tasks[0].id, code.id)
  assert.deepEqual(plan.preflight.errors, [])
  assert.equal(plan.preflight.ready, true)
  assert.equal(plan.preflight.teamDigest.length, 64)
  assert.equal(plan.team.members[0].skillsDigest.length, 64)
  assert.equal(plan.team.members[0].personaDigest.length, 64)
  assert.ok(plan.preflight.capacityObservation.agents.length >= 2)
})

test('team candidates apply membership, capability, runtime, and capacity rules with stable ordering', async () => {
  const store = memoryStore()
  const service = new OrchestratorService({}, store)
  const project = await service.createProject({ name: 'Candidate project', cwd: '/tmp', prd: 'PRD', technicalDesign: 'Design' })
  const capable = await service.createAgent({ name: 'Capable', role: 'Engineer', persona: 'Implement.', capabilities: ['coding'], maxConcurrency: 1 })
  const incapable = await service.createAgent({ name: 'Incapable', role: 'Engineer', persona: 'Implement.', capabilities: [] })
  await service.addProjectAgents(project.id, { members: [{ agentId: capable.id, projectRole: 'Engineer', autoAssignable: true }, { agentId: incapable.id, projectRole: 'Engineer', autoAssignable: true }] })
  const task = await service.createTask(project.id, { title: 'Candidate task', kind: 'code', description: 'Implement.', acceptanceCriteria: ['done'], assignmentPolicy: { mode: 'single_agent', requiredRoles: ['Engineer'], requiredCapabilities: ['coding'], allowedAgentIds: [], allowedSquadIds: [], requiresIndependentReviewer: false, maxParallel: 1, conflictKeys: ['src'], forbiddenScope: [], escalationConditions: [] }, testCommand: 'true' })
  const candidates = service.getProjectAgentCandidates(project.id, task.id)
  assert.equal(candidates.candidates.find((candidate) => candidate.agentId === capable.id).eligible, true)
  assert.ok(candidates.candidates.find((candidate) => candidate.agentId === incapable.id).reasons.includes('missing_capability:coding'))
  assert.deepEqual(candidates.candidates.map((candidate) => candidate.agentId), [capable.id, incapable.id])
  const before = store.projects.get(project.id)
  const reassigned = await service.reassignProjectTask(project.id, { expectedRevision: before.revision, taskId: task.id, agentId: capable.id, actor: 'tester' })
  assert.equal(reassigned.task.agentId, capable.id)
  assert.equal(reassigned.project.revision, before.revision + 1)
  assert.equal(reassigned.project.approvedRevision, undefined)
  assert.equal(reassigned.project.assignmentDigest.length, 64)
  const impact = service.getProjectTeamImpact(project.id)
  assert.deepEqual(impact.tasks.map((item) => item.id), [task.id])
  assert.equal(impact.tasks[0].title, task.title)
  assert.equal(impact.tasks[0].ownerAgentId, capable.id)
  assert.equal(impact.hasActiveExecution, true)
  assert.equal(impact.activeIssues.length, 1)
})

test('team plan projects requirement domain, role, task, acceptance, and evidence coverage directly', async () => {
  const store = memoryStore()
  const service = new OrchestratorService({}, store)
  const project = await service.createProject({ name: 'Coverage project', cwd: '/tmp', prd: 'Protect checkout.', technicalDesign: 'Add tests.' })
  const agent = await service.createAgent({ name: 'Checkout engineer', role: 'Engineer', persona: 'Implement.', capabilities: ['checkout'] })
  await service.addProjectAgent(project.id, { agentId: agent.id, projectRole: 'Checkout Specialist', autoAssignable: true })
  const task = await service.createTask(project.id, { title: 'Protect checkout', kind: 'code', description: 'Implement.', acceptanceCriteria: ['protected'], agentId: agent.id, assignmentPolicy: { mode: 'single_agent', riskLevel: 'low', requiredRoles: ['specialist'], requiredCapabilities: ['checkout'], allowedAgentIds: [], allowedSquadIds: [], requiresIndependentReviewer: false, maxParallel: 1, conflictKeys: [], allowedScope: ['src/checkout'], forbiddenScope: [], escalationConditions: [] }, testCommand: 'true' })
  await service.createTask(project.id, { title: 'Verify checkout', kind: 'test', description: 'Verify.', acceptanceCriteria: ['passes'], agentId: agent.id, testCommand: 'true' })
  await store.requirementItems.put('req-checkout', { id: 'req-checkout', projectId: project.id, bundleId: 'bundle', key: 'checkout', kind: 'fact', statement: 'Checkout must remain protected.', sourceRefs: ['prd'], status: 'active', createdAt: now, updatedAt: now })
  await store.requirementItems.put('req-uncovered', { id: 'req-uncovered', projectId: project.id, bundleId: 'bundle', key: 'audit', kind: 'fact', statement: 'Audit export is required.', sourceRefs: ['prd'], status: 'active', createdAt: now, updatedAt: now })
  await store.tasks.put(task.id, { ...store.tasks.get(task.id), sourceRequirementIds: ['req-checkout'], acceptanceIds: ['acc-checkout'] })
  await store.acceptanceCriteria.put('acc-checkout', { id: 'acc-checkout', projectId: project.id, bundleId: 'bundle', requirementItemId: 'req-checkout', key: 'checkout-protected', statement: 'Checkout is protected.', sourceRefs: ['prd'], taskIds: [task.id], evidenceIds: ['evidence-checkout'], status: 'verified', createdAt: now, updatedAt: now })

  const matrix = service.getProjectTeamPlan(project.id).preflight.coverageMatrix
  assert.deepEqual(matrix.find((row) => row.requirementId === 'req-checkout'), { requirementId: 'req-checkout', requirementKey: 'checkout', statement: 'Checkout must remain protected.', roleNames: ['specialist'], taskIds: [task.id], implementationTaskIds: [], verificationTaskIds: [], acceptanceIds: ['acc-checkout'], evidenceIds: ['evidence-checkout'], planningStatus: 'partial', verificationStatus: 'verified', status: 'covered' })
  assert.equal(matrix.find((row) => row.requirementId === 'req-uncovered').status, 'uncovered')
})

test('team mutations share idempotent Command records and return impact plus validation', async () => {
  const store = memoryStore()
  const service = new OrchestratorService({}, store)
  const leader = await service.createAgent({ name: 'Command Lead', role: 'Lead', persona: 'Lead.', capabilities: ['coordination'] })
  const member = await service.createAgent({ name: 'Command Member', role: 'Engineer', persona: 'Implement.', capabilities: ['coding'] })
  const squad = await service.createSquad({ name: 'Command Squad', leaderAgentId: leader.id, memberAgentIds: [leader.id, member.id], instructions: 'Delegate.', escalationPolicy: 'Escalate.' })
  const project = await service.createProject({ name: 'Command project', cwd: '/tmp', prd: 'PRD', technicalDesign: 'Design' })

  const bound = await service.executeCommand({ idempotencyKey: 'bind-command-squad', type: 'bind_project_squad', projectId: project.id, squadId: squad.id, actorType: 'human', actorId: 'operator', payload: { expectedProjectRevision: project.revision, expectedSquadUpdatedAt: squad.updatedAt } })
  assert.equal(bound.status, 'completed')
  assert.equal(bound.result.squadId, squad.id)
  assert.ok(bound.result.impact)
  assert.ok(bound.result.validation)
  const binding = store.projectSquadBindings.get(`${project.id}:${squad.id}`)

  const synced = await service.executeCommand({ type: 'sync_project_squad', projectId: project.id, squadId: squad.id, actorType: 'human', actorId: 'operator', payload: { expectedBindingUpdatedAt: binding.updatedAt, expectedSquadUpdatedAt: squad.updatedAt } })
  assert.equal(synced.status, 'completed')
  const task = await service.createTask(project.id, { title: 'Command task', kind: 'code', description: 'Implement.', acceptanceCriteria: ['done'], agentId: leader.id, testCommand: 'true' })
  const beforeReassign = store.projects.get(project.id)
  const reassigned = await service.executeCommand({ type: 'reassign_task', projectId: project.id, actorType: 'human', actorId: 'operator', payload: { expectedRevision: beforeReassign.revision, taskId: task.id, agentId: member.id } })
  assert.equal(reassigned.status, 'completed')
  assert.equal(reassigned.result.task.agentId, member.id)
  assert.ok(reassigned.result.impact)

  const validated = await service.executeCommand({ type: 'validate_team', projectId: project.id, actorType: 'human', actorId: 'operator', payload: {} })
  assert.equal(validated.status, 'completed')
  assert.equal(typeof validated.result.ready, 'boolean')
  const blocker = await service.executeCommand({ type: 'resolve_team_blocker', projectId: project.id, actorType: 'human', actorId: 'operator', payload: { taskId: task.id, reason: 'Confirm execution access.', missingPermissions: ['execute'] } })
  assert.equal(blocker.status, 'completed')
  assert.equal(blocker.result.kind, 'permission')
  assert.ok(service.snapshot().inbox.some((item) => item.decisionId === blocker.result.id))
  assert.deepEqual([...store.commands.records.values()].map((command) => command.type), ['bind_project_squad', 'sync_project_squad', 'reassign_task', 'validate_team', 'resolve_team_blocker'])
  assert.deepEqual(await service.executeCommand({ idempotencyKey: 'bind-command-squad', type: 'bind_project_squad', projectId: project.id, squadId: squad.id, actorType: 'human', actorId: 'operator', payload: { expectedProjectRevision: project.revision, expectedSquadUpdatedAt: squad.updatedAt } }), bound)
})

test('squad delegation remains eligible when at least one allowed Squad is available', async () => {
  const store = memoryStore()
  const service = new OrchestratorService({}, store)
  const leader = await service.createAgent({ name: 'Lead', role: 'Lead', persona: 'Lead delivery.' })
  const member = await service.createAgent({ name: 'Member', role: 'Engineer', persona: 'Implement.' })
  const project = await service.createProject({ name: 'Squad candidates', cwd: '/tmp', prd: 'PRD', technicalDesign: 'Design' })
  const available = await service.createSquad({ name: 'Available', leaderAgentId: leader.id, memberAgentIds: [leader.id, member.id], instructions: 'Delegate.', escalationPolicy: 'Escalate.' })
  const unavailable = await service.createSquad({ name: 'Unavailable', leaderAgentId: leader.id, memberAgentIds: [leader.id, member.id], instructions: 'Delegate.', escalationPolicy: 'Escalate.' })
  await service.bindProjectSquad(project.id, { squadId: available.id, expectedProjectRevision: project.revision, expectedSquadUpdatedAt: available.updatedAt })
  const task = await service.createTask(project.id, { title: 'Delegated implementation', kind: 'code', description: 'Implement.', acceptanceCriteria: ['done'], agentId: leader.id, assignmentPolicy: { mode: 'squad_delegation', requiredRoles: [], requiredCapabilities: [], allowedAgentIds: [], allowedSquadIds: [available.id, unavailable.id, 'missing-squad'], requiresIndependentReviewer: false, maxParallel: 1, conflictKeys: [], forbiddenScope: [], escalationConditions: [] }, testCommand: 'true' })

  const projection = service.getProjectAgentCandidates(project.id, task.id)
  const candidate = projection.candidates.find((item) => item.agentId === leader.id)
  assert.equal(candidate.eligible, true)
  assert.equal(candidate.reasons.some((reason) => reason.startsWith('squad_unavailable')), false)
  assert.deepEqual(new Set(projection.squadCandidates.map((item) => item.squadId)), new Set([available.id, unavailable.id, 'missing-squad']))
  assert.equal(projection.squadCandidates.find((item) => item.squadId === available.id).eligible, true)
  assert.deepEqual(projection.squadCandidates.find((item) => item.squadId === unavailable.id).reasons, ['not_bound'])
  assert.deepEqual(projection.squadCandidates.find((item) => item.squadId === 'missing-squad').reasons, ['squad_not_found'])
})

test('parallel groups enforce their shared maxParallel during TaskRun claim', async () => {
  const store = memoryStore()
  const service = new OrchestratorService({}, store)
  const firstAgent = await service.createAgent({ name: 'First', role: 'Engineer', persona: 'Implement.', maxConcurrency: 2 })
  const secondAgent = await service.createAgent({ name: 'Second', role: 'Engineer', persona: 'Implement.', maxConcurrency: 2 })
  const project = await service.createProject({ name: 'Parallel limit', cwd: '/tmp', prd: 'PRD', technicalDesign: 'Design' })
  await service.addProjectAgents(project.id, { members: [{ agentId: firstAgent.id, projectRole: 'Engineer', autoAssignable: true }, { agentId: secondAgent.id, projectRole: 'Engineer', autoAssignable: true }] })
  const policy = { mode: 'single_agent', riskLevel: 'low', requiredRoles: [], requiredCapabilities: [], allowedAgentIds: [], allowedSquadIds: [], requiresIndependentReviewer: false, parallelGroup: 'shared-files', maxParallel: 1, conflictKeys: [], forbiddenScope: [], escalationConditions: [] }
  const first = await service.createTask(project.id, { title: 'First task', kind: 'code', description: 'Implement.', acceptanceCriteria: ['done'], agentId: firstAgent.id, assignmentPolicy: policy, testCommand: 'true' })
  const second = await service.createTask(project.id, { title: 'Second task', kind: 'test', description: 'Verify.', acceptanceCriteria: ['passes'], agentId: secondAgent.id, assignmentPolicy: policy, testCommand: 'true' })
  const runId = 'parallel-project-run'
  await store.projects.put(project.id, { ...store.projects.get(project.id), status: 'running', activeRunId: runId })
  await store.taskRuns.put('active-group-run', { id: 'active-group-run', projectId: project.id, runId, taskId: first.id, agentId: firstAgent.id, status: 'running', trigger: 'approval', attempt: 1, cwd: '/tmp', createdAt: now })
  await store.taskRuns.put('queued-group-run', { id: 'queued-group-run', projectId: project.id, runId, taskId: second.id, agentId: secondAgent.id, status: 'queued', trigger: 'approval', attempt: 1, cwd: '/tmp', createdAt: now })

  assert.equal(await service.serializedMutation(() => service.claimTaskRun('queued-group-run', 'project')), undefined)
  assert.equal(store.taskRuns.get('queued-group-run').status, 'queued')
})

test('high-risk tasks require an independent reviewer even without an explicit task flag', async () => {
  const store = memoryStore()
  const service = new OrchestratorService({}, store)
  const project = await service.createProject({ name: 'High risk plan', cwd: '/tmp', prd: 'PRD', technicalDesign: 'Design' })
  const engineer = await service.createAgent({ name: 'Engineer', role: 'Software Engineer', persona: 'Implement.', capabilities: ['coding'] })
  await service.addProjectAgent(project.id, { agentId: engineer.id, projectRole: 'Engineer', autoAssignable: true })
  await service.createTask(project.id, { title: 'Critical write', kind: 'code', description: 'Implement.', acceptanceCriteria: ['done'], agentId: engineer.id, assignmentPolicy: { mode: 'single_agent', riskLevel: 'critical', requiredRoles: ['Engineer'], requiredCapabilities: ['coding'], allowedAgentIds: [], allowedSquadIds: [], requiresIndependentReviewer: false, maxParallel: 1, conflictKeys: [], forbiddenScope: [], escalationConditions: [] }, testCommand: 'true' })
  await service.createTask(project.id, { title: 'Verify', kind: 'test', description: 'Verify.', acceptanceCriteria: ['passes'], agentId: engineer.id, testCommand: 'true' })
  const blocked = service.getProjectTeamPlan(project.id)
  assert.equal(blocked.preflight.ready, false)
  assert.ok(blocked.preflight.errors.some((message) => message.includes('critical risk') && message.includes('independent reviewer')))
  const reviewer = await service.createAgent({ name: 'Reviewer', role: 'Code Reviewer', persona: 'Review independently.', capabilities: ['review'] })
  await service.addProjectAgent(project.id, { agentId: reviewer.id, projectRole: 'Reviewer', autoAssignable: true })
  const ready = service.getProjectTeamPlan(project.id)
  assert.equal(ready.team.reviewerAgentId, reviewer.id)
  assert.equal(ready.preflight.errors.some((message) => message.includes('independent reviewer')), false)
})

test('team collaboration metrics derive only observable assignment, delegation, evidence, and blocking facts', async () => {
  const store = memoryStore()
  const service = new OrchestratorService({}, store)
  const project = await service.createProject({ name: 'Metrics', cwd: '/tmp', prd: 'PRD', technicalDesign: 'Design' })
  const agent = await service.createAgent({ name: 'Engineer', role: 'Engineer', persona: 'Implement.', capabilities: [] })
  await service.addProjectAgent(project.id, { agentId: agent.id, projectRole: 'Engineer', autoAssignable: true })
  const task = await service.createTask(project.id, { title: 'Capability gap', kind: 'code', description: 'Implement.', acceptanceCriteria: ['done'], agentId: agent.id, assignmentPolicy: { mode: 'single_agent', riskLevel: 'medium', requiredRoles: [], requiredCapabilities: ['coding'], allowedAgentIds: [], allowedSquadIds: [], requiresIndependentReviewer: false, maxParallel: 1, conflictKeys: [], forbiddenScope: [], escalationConditions: [] }, testCommand: 'true' })
  await store.tasks.put(task.id, { ...store.tasks.get(task.id), status: 'blocked', assignmentSource: 'planner_recommendation' })
  await store.activity.put('reassigned', { id: 'reassigned', projectId: project.id, actorType: 'human', type: 'project.task_reassigned', message: 'Changed recommendation.', metadata: { taskId: task.id }, createdAt: now })
  await store.taskRuns.put('metric-run', { id: 'metric-run', projectId: project.id, taskId: task.id, agentId: agent.id, status: 'failed', trigger: 'retry', attempt: 2, squadId: 'squad', waitDurationsMs: { runtime: 1200, capacity: 800, parallelGroup: 300, conflict: 200, workspace: 100 }, waitCounts: { runtime: 1, capacity: 1, parallelGroup: 1, conflict: 1, workspace: 1 }, durationMs: 4000, cwd: '/tmp', createdAt: '2026-08-17T00:00:00.000Z', startedAt: '2026-08-17T00:00:01.000Z', completedAt: '2026-08-17T00:00:05.000Z' })
  const metrics = service.getTeamCollaborationMetrics(project.id)
  assert.equal(metrics.scope, 'project')
  assert.equal(metrics.taskCount, 1)
  assert.equal(metrics.singleAgentRatio, 1)
  assert.equal(metrics.capabilityGapCount, 1)
  assert.equal(metrics.recommendedAssignmentCount, 1)
  assert.equal(metrics.recommendationManualChangeRate, 1)
  assert.equal(metrics.runtimeWaitDurationMs, 1200)
  assert.equal(metrics.capacityWaitDurationMs, 800)
  assert.equal(metrics.resourceConflictWaitDurationMs, 600)
  assert.equal(metrics.conflictCount, 3)
  assert.equal(metrics.collaborationReworkCount, 1)
  assert.equal(metrics.agentUtilization[0].busyDurationMs, 4000)
  assert.equal(metrics.agentUtilization[0].blockedDurationMs > 0, true)
  assert.equal(metrics.blockedTaskCount, 1)
  assert.equal(metrics.delegationCompletionRate, undefined)
  assert.equal(metrics.childEvidenceCompletenessRate, undefined)
})

test('team plan projects critical path and team blockers into Decisions without auto-assignment', async () => {
  const store = memoryStore()
  const service = new OrchestratorService({}, store)
  const project = await service.createProject({ name: 'Team blocker', cwd: '/tmp', prd: 'PRD', technicalDesign: 'Design' })
  const agent = await service.createAgent({ name: 'Engineer', role: 'Engineer', persona: 'Implement.', capabilities: ['coding'] })
  await service.addProjectAgent(project.id, { agentId: agent.id, projectRole: 'Engineer', autoAssignable: true })
  const first = await service.createTask(project.id, { title: 'First', kind: 'code', description: 'Implement', acceptanceCriteria: ['done'], agentId: agent.id, testCommand: 'true' })
  const second = await service.createTask(project.id, { title: 'Second', kind: 'test', description: 'Verify', acceptanceCriteria: ['passes'], dependencies: [first.id], testCommand: 'true' })
  const plan = service.getProjectTeamPlan(project.id)
  assert.deepEqual(plan.preflight.criticalPath.taskIds, [first.id, second.id])
  assert.equal(plan.preflight.criticalPath.length, 2)
  const decision = await service.resolveTeamBlocker(project.id, { taskId: second.id, reason: '需要确认测试环境权限。', facts: ['Runtime 未配置'], missingPermissions: ['test:execute'], actor: 'operator' })
  assert.equal(decision.kind, 'permission')
  assert.equal(decision.metadata.teamBlocker, true)
  assert.equal(decision.metadata.taskId, second.id)
  assert.equal(store.tasks.get(second.id).agentId, undefined)
  assert.ok(service.snapshot().inbox.some((item) => item.decisionId === decision.id))
})

test('feature usage stays local, aggregates daily, and prunes records older than 30 days', async () => {
  const store = memoryStore()
  const service = new OrchestratorService({}, store)
  await store.featureUsageDaily.put('2000-01-01:projects', { id: '2000-01-01:projects', date: '2000-01-01', feature: 'projects', opens: 1, meaningfulActions: 0, errorRecoveries: 0, lastUsedAt: '2000-01-01T00:00:00.000Z' })
  const first = await service.recordFeatureUsage({ feature: 'projects', opens: 1 })
  const second = await service.recordFeatureUsage({ feature: 'projects', meaningfulActions: 1 })
  assert.equal(second.id, first.id)
  assert.deepEqual({ opens: second.opens, meaningfulActions: second.meaningfulActions, errorRecoveries: second.errorRecoveries }, { opens: 1, meaningfulActions: 1, errorRecoveries: 0 })
  assert.equal(store.featureUsageDaily.get('2000-01-01:projects'), undefined)
  await service.clearFeatureUsage()
  assert.equal(store.featureUsageDaily.size, 0)
})

test('batch task assignment is atomic and increments project revision once', async () => {
  const store = memoryStore()
  const service = new OrchestratorService({}, store)
  const project = await service.createProject({ name: 'Assignment project', cwd: '/tmp', prd: 'PRD', technicalDesign: 'Design' })
  const first = await service.createAgent({ name: 'First', role: 'Engineer', persona: 'Work safely.' })
  const second = await service.createAgent({ name: 'Second', role: 'Tester', persona: 'Work safely.' })
  await service.addProjectAgents(project.id, { members: [{ agentId: first.id, projectRole: 'Code', autoAssignable: true }, { agentId: second.id, projectRole: 'QA', autoAssignable: true }], joinedBy: 'tester', expectedProjectRevision: project.revision })
  const code = await service.createTask(project.id, { title: 'Code', kind: 'code', description: 'Implement', acceptanceCriteria: ['done'], testCommand: 'true' })
  const verify = await service.createTask(project.id, { title: 'Verify', kind: 'test', description: 'Test', acceptanceCriteria: ['passes'], dependencies: [code.id], testCommand: 'true' })
  const before = store.projects.get(project.id)
  const result = await service.assignProjectTasks(project.id, { expectedRevision: before.revision, assignments: [{ taskId: code.id, agentId: first.id }, { taskId: verify.id, agentId: second.id }] })
  assert.equal(result.project.revision, before.revision + 1)
  assert.deepEqual(result.tasks.map((task) => task.agentId), [first.id, second.id])
  const state = structuredClone([...store.tasks.records.entries()])
  await assert.rejects(() => service.assignProjectTasks(project.id, { expectedRevision: result.project.revision, assignments: [{ taskId: code.id, agentId: second.id }, { taskId: 'foreign', agentId: first.id }] }), (error) => error.code === 'task-not-found')
  assert.deepEqual([...store.tasks.records.entries()], state)
})

test('batch membership and task assignment compensate storage failures without partial state', async () => {
  {
    const store = memoryStore()
    const service = new OrchestratorService({}, store)
    const project = await service.createProject({ name: 'Atomic members', cwd: '/tmp', prd: 'PRD', technicalDesign: 'Design' })
    const first = await service.createAgent({ name: 'First member', role: 'Engineer', persona: 'Work safely.' })
    const second = await service.createAgent({ name: 'Second member', role: 'Tester', persona: 'Work safely.' })
    const activityCount = store.activity.size
    const put = store.projectAgentMemberships.put.bind(store.projectAgentMemberships)
    let calls = 0
    store.projectAgentMemberships.put = async (...args) => { calls += 1; if (calls === 2) throw new Error('membership write failed'); return put(...args) }
    await assert.rejects(() => service.addProjectAgents(project.id, { members: [{ agentId: first.id, projectRole: 'Code' }, { agentId: second.id, projectRole: 'QA' }] }), /membership write failed/)
    assert.equal(store.projectAgentMemberships.size, 0)
    assert.equal(store.activity.size, activityCount)
  }
  {
    const store = memoryStore()
    const service = new OrchestratorService({}, store)
    const project = await service.createProject({ name: 'Atomic assignments', cwd: '/tmp', prd: 'PRD', technicalDesign: 'Design' })
    const first = await service.createAgent({ name: 'First assignee', role: 'Engineer', persona: 'Work safely.' })
    const second = await service.createAgent({ name: 'Second assignee', role: 'Tester', persona: 'Work safely.' })
    await service.addProjectAgents(project.id, { members: [{ agentId: first.id, projectRole: 'Code' }, { agentId: second.id, projectRole: 'QA' }] })
    const code = await service.createTask(project.id, { title: 'Code', kind: 'code', description: 'Implement', acceptanceCriteria: ['done'], testCommand: 'true' })
    const verify = await service.createTask(project.id, { title: 'Verify', kind: 'test', description: 'Test', acceptanceCriteria: ['passes'], dependencies: [code.id], testCommand: 'true' })
    const beforeProject = structuredClone(store.projects.get(project.id))
    const beforeTasks = structuredClone([...store.tasks.records.entries()])
    const put = store.tasks.put.bind(store.tasks)
    let calls = 0
    store.tasks.put = async (...args) => { calls += 1; if (calls === 2) throw new Error('task write failed'); return put(...args) }
    await assert.rejects(() => service.assignProjectTasks(project.id, { expectedRevision: beforeProject.revision, assignments: [{ taskId: code.id, agentId: first.id }, { taskId: verify.id, agentId: second.id }] }), /task write failed/)
    assert.deepEqual(store.projects.get(project.id), beforeProject)
    assert.deepEqual([...store.tasks.records.entries()], beforeTasks)
  }
})

test('member removal protects every current-plan task and restores lead when persistence fails', async () => {
  const store = memoryStore()
  const service = new OrchestratorService({}, store)
  const project = await service.createProject({ name: 'Safe removal', cwd: '/tmp', prd: 'PRD', technicalDesign: 'Design' })
  const agent = await service.createAgent({ name: 'Lead', role: 'Engineer', persona: 'Work safely.' })
  const membership = await service.addProjectAgent(project.id, { agentId: agent.id, projectRole: 'Lead', setAsLead: true })
  const task = await service.createTask(project.id, { title: 'Completed fact', kind: 'code', description: 'Implement', acceptanceCriteria: ['done'], agentId: agent.id, testCommand: 'true' })
  await store.tasks.put(task.id, { ...task, status: 'completed', testExitCode: 0 })
  await assert.rejects(() => service.removeProjectAgent(project.id, agent.id, { clearLead: true }), (error) => error.code === 'project-agent-in-use')
  await service.deleteTask(task.id)
  const put = store.projectAgentMemberships.put.bind(store.projectAgentMemberships)
  let fail = true
  store.projectAgentMemberships.put = async (...args) => { if (fail) { fail = false; throw new Error('membership removal failed') } return put(...args) }
  await assert.rejects(() => service.removeProjectAgent(project.id, agent.id, { expectedMemberUpdatedAt: membership.updatedAt, clearLead: true }), /membership removal failed/)
  assert.equal(store.projectAgentMemberships.get(membership.id).status, 'active')
  assert.equal(store.projects.get(project.id).leadAgentId, agent.id)
})

test('member removal can atomically reassign the current plan and transfer lead ownership', async () => {
  const store = memoryStore()
  const service = new OrchestratorService({}, store)
  const project = await service.createProject({ name: 'Reassign on removal', cwd: '/tmp', prd: 'PRD', technicalDesign: 'Design' })
  const departing = await service.createAgent({ name: 'Departing', role: 'Engineer', persona: 'Work safely.' })
  const replacement = await service.createAgent({ name: 'Replacement', role: 'Engineer', persona: 'Work safely.' })
  const membership = await service.addProjectAgent(project.id, { agentId: departing.id, projectRole: 'Lead', setAsLead: true })
  await service.addProjectAgent(project.id, { agentId: replacement.id, projectRole: 'Backup' })
  const code = await service.createTask(project.id, { title: 'Code', kind: 'code', description: 'Implement', acceptanceCriteria: ['done'], agentId: departing.id, testCommand: 'true' })
  await service.createTask(project.id, { title: 'Test', kind: 'test', description: 'Verify', acceptanceCriteria: ['passes'], dependencies: [code.id], agentId: departing.id, testCommand: 'true' })
  const before = store.projects.get(project.id)
  const removed = await service.removeProjectAgent(project.id, departing.id, { expectedMemberUpdatedAt: membership.updatedAt, expectedProjectRevision: before.revision, assignedTaskPolicy: 'reassign', replacementAgentId: replacement.id })
  const after = store.projects.get(project.id)
  assert.equal(removed.status, 'removed')
  assert.equal(after.revision, before.revision + 1)
  assert.equal(after.status, 'awaiting_approval')
  assert.equal(after.leadAgentId, replacement.id)
  assert.equal(after.approvedRevision, undefined)
  assert.deepEqual(store.projectTasks(after).map((task) => task.agentId), [replacement.id, replacement.id])
})

test('approval rejects unassigned tasks and ordinary Issue update rejects assignee fields', async () => {
  const store = memoryStore()
  const service = new OrchestratorService({}, store)
  const project = await service.createProject({ name: 'Guarded project', cwd: '/tmp', prd: 'PRD', technicalDesign: 'Design' })
  const code = await service.createTask(project.id, { title: 'Code', kind: 'code', description: 'Implement', acceptanceCriteria: ['done'], testCommand: 'true' })
  await service.createTask(project.id, { title: 'Test', kind: 'test', description: 'Verify', acceptanceCriteria: ['passes'], dependencies: [code.id], testCommand: 'true' })
  await assert.rejects(() => service.approveProject(project.id, 'tester'), (error) => error.code === 'project-task-unassigned')
  const issue = await service.createIssue({ projectId: project.id, title: 'Issue' })
  await assert.rejects(() => service.updateIssue(issue.id, { assigneeType: 'agent', assigneeId: 'agent' }))
})

test('agent deletion is rejected while tasks reference it', async () => {
  const store = memoryStore()
  const service = new OrchestratorService({}, store)
  const agent = await service.createAgent({ name: 'Engineer', role: 'Software Engineer', description: '', persona: 'Implement safely.', preset: 'standard', toolPolicy: 'full' })
  await store.tasks.put('task', { id: 'task', projectId: 'project', ordinal: 0, title: 'Code', kind: 'code', description: 'Implement', acceptanceCriteria: ['done'], dependencies: [], agentId: agent.id, testCommand: 'true', status: 'draft', createdAt: now, updatedAt: now })
  await assert.rejects(() => service.deleteAgent(agent.id), /assigned/)
})

test('approval fails closed on missing, duplicate, or foreign task pointers', async () => {
  for (const corruption of ['missing', 'duplicate', 'foreign']) {
    const store = memoryStore()
    const service = new OrchestratorService({}, store)
    const project = await service.createProject({ name: 'Corrupt project', summary: '', cwd: '/tmp', prd: 'PRD', technicalDesign: 'Design' })
    const task = { id: 'code', projectId: corruption === 'foreign' ? 'other-project' : project.id, ordinal: 0, title: 'Code', kind: 'code', description: 'Implement', acceptanceCriteria: ['done'], dependencies: [], testCommand: 'true', status: 'draft', createdAt: now, updatedAt: now }
    await store.tasks.put(task.id, task)
    const taskIds = corruption === 'missing' ? ['code', 'missing'] : corruption === 'duplicate' ? ['code', 'code'] : ['code']
    await store.projects.put(project.id, { ...project, status: 'awaiting_approval', revision: 2, taskIds })
    await assert.rejects(() => service.approveProject(project.id, 'tester'), new RegExp(corruption === 'duplicate' ? 'duplicate' : corruption))
  }
})

test('agent changes invalidate every referencing project plan', async () => {
  const store = memoryStore()
  const service = new OrchestratorService({}, store)
  const project = await approvedProject(service, store, ['true', 'true'])
  const unrelated = await service.createAgent({ name: 'Unrelated', role: 'Writer', persona: 'Write docs.' })
  await service.updateAgent(unrelated.id, { ...unrelated, persona: 'Write unrelated docs carefully.' })
  assert.equal(store.projects.get(project.id).revision, project.revision)
  assert.equal(store.projects.get(project.id).approvedRevision, project.revision)
  const agent = store.agents.get(store.tasks.get('code').agentId)
  await service.updateAgent(agent.id, { ...agent, persona: 'Updated execution contract.' })
  const changed = store.projects.get(project.id)
  assert.equal(changed.status, 'awaiting_approval')
  assert.equal(changed.revision, project.revision + 1)
  assert.equal(changed.approvedRevision, undefined)
  assert.deepEqual(store.projectTasks(changed).map((task) => task.status), ['draft', 'draft'])
})

test('approved team snapshots invalidate when an unassigned project member is added or removed', async () => {
  const store = memoryStore()
  const service = new OrchestratorService({}, store)
  const firstApproval = await approvedProject(service, store, ['true', 'true'])
  const observer = await service.createAgent({ name: 'Observer', role: 'Reviewer', persona: 'Review.' })
  await service.addProjectAgent(firstApproval.id, { agentId: observer.id, projectRole: 'Reviewer', autoAssignable: true, expectedProjectRevision: firstApproval.revision })
  const afterAdd = store.projects.get(firstApproval.id)
  assert.equal(afterAdd.status, 'awaiting_approval')
  assert.equal(afterAdd.revision, firstApproval.revision + 1)
  assert.equal(afterAdd.approvedRevision, undefined)

  const refreshedTeam = service.getProjectTeamPlan(firstApproval.id).team
  await store.projects.put(firstApproval.id, { ...afterAdd, teamDigest: refreshedTeam.teamDigest, teamComposition: refreshedTeam })
  const secondApproval = await service.approveProject(firstApproval.id, 'tester')
  const membership = service.listProjectAgents(firstApproval.id).find((item) => item.agentId === observer.id)
  await service.removeProjectAgent(firstApproval.id, observer.id, { expectedMemberUpdatedAt: membership.updatedAt, assignedTaskPolicy: 'reject' })
  const afterRemove = store.projects.get(firstApproval.id)
  assert.equal(afterRemove.status, 'awaiting_approval')
  assert.equal(afterRemove.revision, secondApproval.revision + 1)
  assert.equal(afterRemove.approvedRevision, undefined)
})

test('Runtime unavailability invalidates only approved Projects that use that Runtime', async () => {
  const store = memoryStore()
  const service = new OrchestratorService({}, store)
  const runtime = await service.createRuntime({ name: 'Approval Runtime', machineId: 'approval-runtime' })
  const affected = await approvedProject(service, store, ['true', 'true'], { runtimeId: runtime.id })

  const otherAgent = await service.createAgent({ name: 'Other Engineer', role: 'Software Engineer', persona: 'Implement elsewhere.', toolPolicy: 'full' })
  const otherProject = await service.createProject({ name: 'Other approved project', cwd: '/tmp', prd: 'Other.', technicalDesign: 'Other.' })
  await service.addProjectAgent(otherProject.id, { agentId: otherAgent.id, projectRole: 'Software Engineer', autoAssignable: true })
  const otherCode = await service.createTask(otherProject.id, { title: 'Other code', kind: 'code', description: 'Implement.', acceptanceCriteria: ['done'], agentId: otherAgent.id, testCommand: 'true' })
  await service.createTask(otherProject.id, { title: 'Other test', kind: 'test', description: 'Verify.', acceptanceCriteria: ['passes'], dependencies: [otherCode.id], agentId: otherAgent.id, testCommand: 'true' })
  const otherApproved = await service.approveProject(otherProject.id, 'tester')

  await service.heartbeatRuntime(runtime.id, 'offline')

  const invalidated = store.projects.get(affected.id)
  assert.equal(invalidated.status, 'awaiting_approval')
  assert.equal(invalidated.deliveryStage, 'awaiting_approval')
  assert.equal(invalidated.revision, affected.revision + 1)
  assert.equal(invalidated.approvedRevision, undefined)
  assert.equal(store.projects.get(otherProject.id).revision, otherApproved.revision)
  assert.equal(store.projects.get(otherProject.id).status, 'approved')

  await service.heartbeatRuntime(runtime.id, 'offline')
  assert.equal(store.projects.get(affected.id).revision, invalidated.revision)
})

test('Squad bind, default, and unbind changes invalidate approved teams but initial binding is revision-neutral', async () => {
  const store = memoryStore()
  const service = new OrchestratorService({}, store)
  const leader = await service.createAgent({ name: 'Snapshot Leader', role: 'Lead', persona: 'Lead.', toolPolicy: 'full' })
  const firstMember = await service.createAgent({ name: 'First Member', role: 'Engineer', persona: 'Build.', toolPolicy: 'full' })
  const secondMember = await service.createAgent({ name: 'Second Member', role: 'Verifier', persona: 'Verify.', toolPolicy: 'full' })
  const firstSquad = await service.createSquad({ name: 'First Snapshot Squad', leaderAgentId: leader.id, memberAgentIds: [leader.id, firstMember.id], instructions: 'Build.', escalationPolicy: 'Escalate.' })
  const secondSquad = await service.createSquad({ name: 'Second Snapshot Squad', leaderAgentId: leader.id, memberAgentIds: [leader.id, secondMember.id], instructions: 'Verify.', escalationPolicy: 'Escalate.' })
  const project = await service.createProject({ name: 'Squad snapshot project', cwd: '/tmp', prd: 'Freeze team.', technicalDesign: 'Invalidate changed composition.' })
  const firstBinding = await service.bindProjectSquad(project.id, { squadId: firstSquad.id, expectedProjectRevision: project.revision, expectedSquadUpdatedAt: firstSquad.updatedAt })
  assert.equal(store.projects.get(project.id).revision, project.revision)

  const code = await service.createTask(project.id, { title: 'Squad code', kind: 'code', description: 'Implement.', acceptanceCriteria: ['done'], agentId: leader.id, testCommand: 'true' })
  await service.createTask(project.id, { title: 'Squad test', kind: 'test', description: 'Verify.', acceptanceCriteria: ['passes'], dependencies: [code.id], agentId: leader.id, testCommand: 'true' })
  let approved = await service.approveProject(project.id, 'tester')
  const secondBinding = await service.bindProjectSquad(project.id, { squadId: secondSquad.id, expectedProjectRevision: approved.revision, expectedSquadUpdatedAt: secondSquad.updatedAt })
  assert.equal(store.projects.get(project.id).revision, approved.revision + 1)
  assert.equal(store.projects.get(project.id).status, 'awaiting_approval')

  const approveCurrentTeam = async () => {
    const current = store.projects.get(project.id)
    const team = service.getProjectTeamPlan(project.id).team
    await store.projects.put(project.id, { ...current, teamComposition: team, teamDigest: team.teamDigest })
    return service.approveProject(project.id, 'tester')
  }

  approved = await approveCurrentTeam()
  const defaulted = await service.setDefaultProjectSquadBinding(project.id, secondSquad.id, { expectedBindingUpdatedAt: secondBinding.updatedAt })
  assert.equal(store.projects.get(project.id).revision, approved.revision + 1)
  assert.equal(service.getProjectTeamPlan(project.id).team.squads.find((squad) => squad.squadId === secondSquad.id).isDefault, true)

  approved = await approveCurrentTeam()
  await service.unbindProjectSquad(project.id, secondSquad.id, { expectedBindingUpdatedAt: defaulted.updatedAt, replacementDefaultSquadId: firstSquad.id })
  assert.equal(store.projects.get(project.id).revision, approved.revision + 1)
  assert.equal(store.projects.get(project.id).status, 'awaiting_approval')
  assert.equal(service.listProjectSquadBindings(project.id).find((binding) => binding.id === firstBinding.id).isDefault, true)
})

test('serialized mutations cannot overlap', async () => {
  const service = new OrchestratorService({}, memoryStore())
  const order = []
  let releaseFirst
  const gate = new Promise((resolve) => { releaseFirst = resolve })
  const first = service.serializedMutation(async () => {
    order.push('first:start')
    await gate
    order.push('first:end')
  })
  const second = service.serializedMutation(async () => { order.push('second') })
  await new Promise((resolve) => setImmediate(resolve))
  assert.deepEqual(order, ['first:start'])
  releaseFirst()
  await Promise.all([first, second])
  assert.deepEqual(order, ['first:start', 'first:end', 'second'])
})

test('execution completes only after independent commands pass', async () => {
  const store = memoryStore()
  const service = new OrchestratorService(agentContext(), store)
  const project = await approvedProject(service, store, ['printf code-verified', 'printf test-verified'])
  const implementerId = store.tasks.get('code').agentId
  await store.activity.put('historical-reassignment', { id: 'historical-reassignment', projectId: project.id, actorType: 'human', type: 'project.task_reassigned', message: 'Historical explicit reassignment.', metadata: { taskId: 'code', previousAgentId: 'previous-owner', agentId: implementerId }, createdAt: now })
  await store.taskRuns.put('historical-retry', { id: 'historical-retry', projectId: project.id, taskId: 'code', agentId: implementerId, status: 'failed', trigger: 'retry', attempt: 2, retryOf: 'historical-first-attempt', cwd: '/tmp', error: 'Historical focused failure.', createdAt: now, completedAt: now })
  await store.delegations.put('historical-delegation', { id: 'historical-delegation', squadId: 'historical-squad', projectId: project.id, parentIssueId: 'historical-parent', childIssueId: 'historical-child', leaderAgentId: implementerId, memberAgentId: implementerId, taskRunId: 'historical-retry', status: 'escalated', instruction: 'Historical delegated repair.', childTaskIds: ['code'], evidenceIds: [], error: 'Escalated for review.', createdAt: now, updatedAt: now, completedAt: now })
  await store.decisions.put('historical-escalation', { id: 'historical-escalation', projectId: project.id, kind: 'review', title: 'Historical escalation', prompt: 'Review the delegated failure.', status: 'approved', requestedByType: 'system', metadata: { delegationId: 'historical-delegation' }, createdAt: now, resolvedBy: 'delivery-owner', resolution: 'Proceed with a focused retry.', resolvedAt: now })
  const run = await service.startExecution(project.id)
  const completedRun = await waitForRun(store, run.id)
  assert.equal(completedRun.status, 'completed')
  assert.equal(store.projects.get(project.id).status, 'completed')
  assert.deepEqual(store.projectTasks(store.projects.get(project.id)).map((task) => task.testExitCode), [0, 0])
  assert.match(store.tasks.get('test').testOutput, /test-verified/)
  assert.equal([...store.verificationEvidence.records.values()].filter((evidence) => evidence.projectId === project.id).length, 2)
  assert.equal([...store.verificationEvidence.records.values()].every((evidence) => evidence.status === 'passed'), true)
  assert.equal([...store.acceptanceCriteria.records.values()].filter((criterion) => criterion.projectId === project.id).every((criterion) => criterion.status === 'verified'), true)
  assert.equal([...store.projectReviews.records.values()].find((review) => review.projectId === project.id)?.status, 'pending')
  const readyDelivery = [...store.deliveryRecords.records.values()].find((record) => record.projectId === project.id)
  assert.equal(readyDelivery?.status, 'ready')
  assert.deepEqual(readyDelivery.responsibilityChain.tasks.map((task) => task.taskId), ['code', 'test'])
  assert.equal(readyDelivery.responsibilityChain.tasks.every((task) => task.taskRunIds.length === 1), true)
  assert.equal(readyDelivery.responsibilityChain.verifications.length, 2)
  assert.deepEqual(readyDelivery.responsibilityChain.reviewIds, [`${project.id}:review:r${project.revision}`])
  assert.ok(readyDelivery.responsibilityChain.retryTaskRunIds.includes('historical-retry'))
  assert.ok(readyDelivery.responsibilityChain.reassignedTaskIds.includes('code'))
  assert.ok(readyDelivery.responsibilityChain.escalationDecisionIds.includes('historical-escalation'))
  assert.equal(readyDelivery.responsibilityChain.delegations.find((delegation) => delegation.delegationId === 'historical-delegation').status, 'escalated')
  assert.ok(readyDelivery.responsibilityChain.delegations.find((delegation) => delegation.delegationId === 'historical-delegation').retryTaskRunIds.includes('historical-retry'))
  assert.ok(readyDelivery.responsibilityChain.delegations.find((delegation) => delegation.delegationId === 'historical-delegation').escalationDecisionIds.includes('historical-escalation'))
  await assert.rejects(() => service.putDeliveryRecord({ ...readyDelivery, changedFiles: ['tampered.txt'] }), (error) => error.code === 'delivery-record-immutable')
  assert.equal([...store.activity.records.values()].filter((activity) => activity.projectId === project.id && activity.type === 'task_run.started').length, 2)
  assert.equal(store.projects.get(project.id).deliveryStage, 'review')
  await assert.rejects(() => service.confirmProjectDelivery(project.id, { actor: '交付负责人' }), (error) => error.code === 'project-review-pending')
  await service.resolveProjectReview(project.id, { decision: 'approve', actor: '交付负责人', note: '验收证据完整。' })
  assert.equal(store.projects.get(project.id).deliveryStage, 'delivery_ready')
  const delivered = await service.confirmProjectDelivery(project.id, { actor: '交付负责人', note: '验收通过。' })
  assert.equal(delivered.status, 'delivered')
  assert.equal(store.projects.get(project.id).deliveryStage, 'delivered')
  assert.equal([...store.projectReviews.records.values()].find((review) => review.projectId === project.id)?.status, 'approved')
  const closed = await service.closeProjectDelivery(project.id, { actor: '交付负责人', note: '已归档。' })
  assert.equal(closed.status, 'closed')
  assert.equal(store.projects.get(project.id).deliveryStage, 'closed')
})

test('Project Review enforces independent human waiver details and persists the audit record', async () => {
  const store = memoryStore()
  const service = new OrchestratorService(agentContext(), store)
  const project = await approvedProject(service, store, ['true', 'true'])
  const implementerId = store.tasks.get('code').agentId
  const run = await service.startExecution(project.id)
  assert.equal((await waitForRun(store, run.id)).status, 'completed')

  await assert.rejects(() => service.resolveProjectReview(project.id, { decision: 'approve', actor: implementerId, note: 'Self approval.' }), (error) => error.code === 'reviewer-not-independent')
  await assert.rejects(() => service.resolveProjectReview(project.id, { decision: 'approve', actor: implementerId, note: 'Wrong waiver decision.', reviewerIndependenceWaiver: { reason: 'No reviewer available.', owner: 'delivery-owner', risk: 'Self-review can miss regressions.', followUpAction: 'Schedule retrospective review.' } }), (error) => error.code === 'reviewer-waiver-decision-required')
  const waiver = { reason: 'No independent reviewer is available in this bounded local delivery.', owner: 'delivery-owner', risk: 'The implementer may miss defects in their own change.', followUpAction: 'Assign an independent retrospective review before reuse.' }
  const resolved = await service.resolveProjectReview(project.id, { decision: 'waive', actor: implementerId, note: 'Risk accepted by the human owner.', reviewerIndependenceWaiver: waiver })
  assert.equal(resolved.status, 'waived')
  assert.equal(resolved.independencePassed, false)
  assert.deepEqual(resolved.reviewerIndependenceWaiver, waiver)
  assert.deepEqual(store.projectReviews.get(resolved.id).reviewerIndependenceWaiver, waiver)
  const delivery = [...store.deliveryRecords.records.values()].find((record) => record.projectId === project.id)
  assert.ok(delivery.responsibilityChain.reviewIds.includes(resolved.id))
  assert.deepEqual(store.projectReviews.get(delivery.responsibilityChain.reviewIds[0]).reviewerIndependenceWaiver, waiver)
  assert.equal(store.projects.get(project.id).deliveryStage, 'delivery_ready')
})

test('Project Review rejection closes the current round and creates a revision Decision in Inbox', async () => {
  const store = memoryStore()
  const service = new OrchestratorService(agentContext(), store)
  const project = await approvedProject(service, store, ['true', 'true'])
  const run = await service.startExecution(project.id)
  assert.equal((await waitForRun(store, run.id)).status, 'completed')
  const rejected = await service.resolveProjectReview(project.id, { decision: 'request_changes', actor: 'delivery-owner', note: 'Add the missing boundary regression before another review.' })

  assert.equal(rejected.status, 'rejected')
  assert.equal(rejected.decision, 'request_changes')
  assert.equal(store.projects.get(project.id).deliveryStage, 'review')
  const decision = [...store.decisions.records.values()].find((item) => item.metadata.projectReviewId === rejected.id)
  assert.equal(decision.status, 'pending')
  assert.equal(decision.metadata.requiresRevision, true)
  assert.ok(service.snapshot().inbox.some((item) => item.decisionId === decision.id))
  await assert.rejects(() => service.resolveProjectReview(project.id, { decision: 'approve', actor: 'delivery-owner', note: 'Try same revision.' }), (error) => error.code === 'project-review-already-resolved')
  assert.equal([...store.projectReviews.records.values()].filter((review) => review.revision === project.revision).length, 1)
})

test('Project Review rejection restores Review and Project when Decision persistence fails', async () => {
  const store = memoryStore()
  const service = new OrchestratorService(agentContext(), store)
  const project = await approvedProject(service, store, ['true', 'true'])
  const run = await service.startExecution(project.id)
  assert.equal((await waitForRun(store, run.id)).status, 'completed')
  const reviewBefore = structuredClone([...store.projectReviews.records.values()].find((review) => review.projectId === project.id))
  const projectBefore = structuredClone(store.projects.get(project.id))
  const originalPut = store.decisions.put.bind(store.decisions)
  store.decisions.put = async () => { throw new Error('injected Decision write failure') }

  await assert.rejects(
    () => service.resolveProjectReview(project.id, { decision: 'request_changes', actor: 'delivery-owner', note: 'Request a revision.' }),
    /injected Decision write failure/,
  )
  store.decisions.put = originalPut

  assert.deepEqual(store.projectReviews.get(reviewBefore.id), reviewBefore)
  assert.deepEqual(store.projects.get(project.id), projectBefore)
  assert.equal([...store.decisions.records.values()].some((decision) => decision.metadata?.projectReviewId === reviewBefore.id), false)
})

test('Project Review waiver restores all Acceptance records after a partial waiver write', async () => {
  const store = memoryStore()
  const service = new OrchestratorService(agentContext(), store)
  const project = await approvedProject(service, store, ['true', 'true'])
  const run = await service.startExecution(project.id)
  assert.equal((await waitForRun(store, run.id)).status, 'completed')
  const criteria = ['code', 'test'].map((taskId, index) => ({
    id: `${project.id}:acceptance:waiver-${index + 1}`,
    projectId: project.id,
    bundleId: `${project.id}:bundle:test`,
    key: `waiver-${index + 1}`,
    statement: `Acceptance ${index + 1} requires a bounded waiver.`,
    sourceRefs: [],
    taskIds: [taskId],
    evidenceIds: [],
    status: 'open',
    createdAt: now,
    updatedAt: now,
  }))
  for (const criterion of criteria) await store.acceptanceCriteria.put(criterion.id, criterion)
  const acceptanceBefore = new Map(criteria.map((criterion) => [criterion.id, structuredClone(store.acceptanceCriteria.get(criterion.id))]))
  const reviewBefore = structuredClone([...store.projectReviews.records.values()].find((review) => review.projectId === project.id))
  const projectBefore = structuredClone(store.projects.get(project.id))
  const originalPut = store.acceptanceCriteria.put.bind(store.acceptanceCriteria)
  let waivedWrites = 0
  store.acceptanceCriteria.put = async (key, value) => {
    if (value.status === 'waived' && ++waivedWrites === 2) throw new Error('injected Acceptance write failure')
    await originalPut(key, value)
  }

  await assert.rejects(
    () => service.resolveProjectReview(project.id, {
      decision: 'waive',
      actor: 'delivery-owner',
      note: 'Waive both pending criteria.',
      waivers: criteria.map((criterion) => ({ acceptanceId: criterion.id, reason: 'Bounded exception.', owner: 'delivery-owner' })),
    }),
    /injected Acceptance write failure/,
  )
  store.acceptanceCriteria.put = originalPut

  for (const [criterionId, criterion] of acceptanceBefore) assert.deepEqual(store.acceptanceCriteria.get(criterionId), criterion)
  assert.deepEqual(store.projectReviews.get(reviewBefore.id), reviewBefore)
  assert.deepEqual(store.projects.get(project.id), projectBefore)
})

test('independent verification prefers a project virtualenv and records the resolved environment', async () => {
  const root = await mkdtemp(join(tmpdir(), 'project-orchestrator-venv-'))
  try {
    const bin = join(root, '.venv', 'bin')
    await mkdir(bin, { recursive: true })
    const python = join(bin, 'python')
    await writeFile(python, '#!/bin/sh\nprintf "venv=%s\\n" "$VIRTUAL_ENV"\n')
    await chmod(python, 0o755)
    const store = memoryStore()
    const service = new OrchestratorService(agentContext(), store)
    const project = await approvedProject(service, store, ['python', 'true'], {}, root)
    const run = await service.startExecution(project.id)
    assert.equal((await waitForRun(store, run.id)).status, 'completed')
    const taskRun = [...store.taskRuns.records.values()].find((value) => value.taskId === 'code')
    assert.equal(taskRun.executionEnvironment, 'project_venv')
    assert.equal(taskRun.virtualEnvPath, await realpath(join(root, '.venv')))
    assert.match(taskRun.testOutput, /project-orchestrator-venv-/)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('executor sessions instruct configured agents to load and apply assigned skills', async () => {
  const store = memoryStore()
  const observation = {}
  const service = new OrchestratorService(agentContext('Agent applied assigned skills.', observation), store)
  const project = await approvedProject(service, store, ['true', 'true'], {
    skills: ['nestjs-best-practices', 'api-contract-review'],
  })
  const run = await service.startExecution(project.id)
  assert.equal((await waitForRun(store, run.id)).status, 'completed')

  const skillSections = observation.sections.filter((section) => section.name === 'deployment:assigned-skills')
  assert.equal(skillSections.length, 2)
  for (const section of skillSections) {
    assert.equal(section.order, 10)
    assert.match(section.text, /assigned skill names, not preloaded instructions/i)
    assert.match(section.text, /nestjs-best-practices/)
    assert.match(section.text, /api-contract-review/)
    assert.match(section.text, /available skill tool/)
    assert.match(section.text, /load each assigned skill and apply its instructions/)
  }
})

test('a non-zero test command fails the project and blocks dependents', async () => {
  const store = memoryStore()
  const service = new OrchestratorService(agentContext(), store)
  const project = await approvedProject(service, store, ['printf failure-evidence; exit 7', 'printf should-not-run'])
  const run = await service.startExecution(project.id)
  const failedRun = await waitForRun(store, run.id)
  assert.equal(failedRun.status, 'failed')
  assert.equal(store.projects.get(project.id).status, 'failed')
  assert.equal(store.tasks.get('code').status, 'failed')
  assert.equal(store.tasks.get('code').testExitCode, 7)
  assert.match(store.tasks.get('code').testOutput, /failure-evidence/)
  assert.equal(store.tasks.get('test').status, 'blocked')
  assert.equal([...store.verificationEvidence.records.values()].some((evidence) => evidence.projectId === project.id && evidence.status === 'failed' && evidence.exitCode === 7), true)
  assert.equal([...store.deliveryRecords.records.values()].some((record) => record.projectId === project.id), false)
})

function agentContext(responseText = 'Agent work completed.', observation = {}) {
  const responses = Array.isArray(responseText) ? responseText : [responseText]
  const normalizeResponse = (value) => {
    try {
      const parsed = JSON.parse(value)
      if (Array.isArray(parsed.tasks) && parsed.status === undefined) {
        const verifiedCommands = [...new Set(parsed.tasks.map((task) => task.testCommand))]
        return JSON.stringify({ status: 'ready', ...parsed, repositoryEvidence: { inspectedPaths: ['package.json'], manifests: ['package.json'], verifiedCommands, relevantModules: ['src'], assumptions: [] }, tasks: parsed.tasks.map((task) => ({ ...task, evidenceRefs: ['package.json'] })) })
      }
    } catch {}
    return value
  }
  const promptJson = (prompt, start, end) => {
    const value = prompt.split(`${start}\n`)[1]?.split(`\n\n${end}`)[0]
    if (value === undefined) throw new Error(`Missing prompt section: ${start}`)
    return JSON.parse(value)
  }
  const bindingImpactAssessments = (evidenceRef) => ['domain_owner', 'write_path', 'read_path', 'data', 'state', 'api', 'permission', 'async', 'consumer', 'failure', 'test', 'migration', 'release', 'rollback'].map((dimension) => ({
    dimension,
    applicability: ['domain_owner', 'test'].includes(dimension) ? 'required' : 'not_applicable',
    evidenceRefs: ['domain_owner', 'test'].includes(dimension) ? [evidenceRef] : [],
    reason: ['domain_owner', 'test'].includes(dimension) ? 'The repository evidence identifies this required impact surface.' : 'The frozen requirement does not affect this dimension.',
  }))
  return {
    skills: { list: async () => observation.availableSkills ?? [] },
    agentDefaultModel: { currentSelection: () => ({ provider: 'test', model: 'test' }) },
    agentPresets: { mount: async (_agentCtx, preset) => { observation.mountedPresets = [...(observation.mountedPresets ?? []), preset] } },
    llm: { resolveModelInfo: async () => {
      if (observation.resolveModelInfoError !== undefined) throw observation.resolveModelInfoError
      return { provider: 'test', id: 'test', name: 'Test model', inputModalities: ['text', 'image'], context: { contextWindow: 32_768 }, defaultMaxTokens: 16_384 }
    } },
    attachments: {
      imageLimits: { maxImageBytes: 5_000_000, maxImagesPerMessage: 20, maxMessageImageBytes: 20_000_000, maxImagePixels: 4_000_000, mediaTypes: ['image/jpeg'] },
      validateImage: async (image) => { observation.validatedImages = [...(observation.validatedImages ?? []), image] },
      saveImage: async (image) => {
        observation.savedImages = [...(observation.savedImages ?? []), image]
        return { attachmentId: `attachment-${observation.savedImages.length}`, mediaType: image.mediaType, bytes: image.data.byteLength, width: 100, height: 100, name: image.name }
      },
    },
    sessions: { flush: async () => {} },
    agents: {
      create: async (options) => {
        observation.createCalls = (observation.createCalls ?? 0) + 1
        observation.cwd = options.meta?.cwd
        observation.agentOptions = [...(observation.agentOptions ?? []), structuredClone(options.agentOptions)]
        if (observation.onAgentCreate) await observation.onAgentCreate(options, observation.createCalls)
        await options.setup({
          systemPrompt: {
            section: (section) => {
              observation.sections = [...(observation.sections ?? []), section]
              return () => {}
            },
          },
          tools: { guard: (guard) => { observation.guardCalls = (observation.guardCalls ?? 0) + 1; observation.toolGuards = [...(observation.toolGuards ?? []), guard]; return () => {} } },
        })
        const persona = observation.sections?.at(-1)?.text ?? ''
        const session = { events: [] }
        const respond = (promptText) => {
          let normalizedResponse
          if (persona.includes('requirements discovery analyst')) {
          observation.requirementAnalysisCalls = (observation.requirementAnalysisCalls ?? 0) + 1
          observation.requirementAnalysisPrompts = [...(observation.requirementAnalysisPrompts ?? []), promptText]
          const manifestText = promptText.match(/Source manifest:\n([^\n]+)/)?.[1]
          const manifest = JSON.parse(manifestText)
          const acceptanceAnchors = manifest.anchors.filter((anchor) => anchor.kind === 'acceptance_item')
          const questionAnchors = manifest.anchors.filter((anchor) => anchor.kind === 'open_question')
          const basis = acceptanceAnchors.length > 0 ? acceptanceAnchors : [manifest.anchors.find((anchor) => anchor.kind !== 'heading') ?? manifest.anchors[0]]
          const generated = { status: 'ready', summary: 'Structured requirements.', requirements: basis.map((anchor, index) => ({ key: `REQ-${String(index + 1).padStart(3, '0')}`, kind: 'fact', scope: 'in_scope', statement: `Requirement ${index + 1}`, sourceRefs: [anchor.id], acceptanceCriteria: [{ key: `AC-${String(index + 1).padStart(3, '0')}`, statement: `Acceptance ${index + 1}`, required: true, scenario: 'happy_path', sourceRefs: [anchor.id] }] })), decisions: questionAnchors.map((anchor, index) => ({ key: `DEC-${String(index + 1).padStart(3, '0')}`, question: `Decision ${index + 1}`, options: [{ id: 'proceed', label: 'Proceed', affectedDimensions: ['requirement'], affectedObjectKeys: ['REQ-001'], derivation: 'explicit', evidenceAnchorIds: [anchor.id], potentiallyChangesDelivery: true }, { id: 'defer', label: 'Defer', affectedDimensions: ['requirement'], affectedObjectKeys: ['REQ-001'], derivation: 'explicit', evidenceAnchorIds: [anchor.id], potentiallyChangesDelivery: true }], impact: 'low', affectedRequirementKeys: basis.length === 0 ? [] : ['REQ-001'], sourceRefs: [anchor.id] })), diagnostics: [] }
          normalizedResponse = JSON.stringify(typeof observation.requirementAnalysisResponse === 'function' ? observation.requirementAnalysisResponse({ manifest, generated, promptText, call: observation.requirementAnalysisCalls }) : observation.requirementAnalysisResponse ?? generated)
          } else if (persona.includes('independent requirements reviewer')) {
          observation.requirementReviewCalls = (observation.requirementReviewCalls ?? 0) + 1
          observation.requirementReviewPrompts = [...(observation.requirementReviewPrompts ?? []), promptText]
          const sourceDigest = promptText.match(/"reviewedSourceDigest":"([a-f0-9]{64})"/)?.[1]
          const analysisDigest = promptText.match(/"reviewedAnalysisDigest":"([a-f0-9]{64})"/)?.[1]
          const generated = { status: 'approved', reviewedSourceDigest: sourceDigest, reviewedAnalysisDigest: analysisDigest, missingSourceRefs: [], conflicts: [], untestableAcceptanceKeys: [], findings: [] }
          normalizedResponse = JSON.stringify(typeof observation.requirementReviewResponse === 'function' ? observation.requirementReviewResponse({ generated, call: observation.requirementReviewCalls }) : observation.requirementReviewResponse ?? generated)
          } else if (persona.includes('independent acceptance-scenario coverage reviewer')) {
          observation.scenarioReviewCalls = (observation.scenarioReviewCalls ?? 0) + 1
          const reviewedInputDigest = promptText.match(/Review input digest:\n([a-f0-9]{64})/)?.[1]
          const generated = { status: 'approved', reviewedInputDigest, findings: [] }
          normalizedResponse = JSON.stringify(typeof observation.scenarioReviewResponse === 'function' ? observation.scenarioReviewResponse({ generated, promptText, call: observation.scenarioReviewCalls }) : observation.scenarioReviewResponse ?? generated)
          } else if (persona.includes('acceptance-scenario designer')) {
          observation.scenarioCalls = (observation.scenarioCalls ?? 0) + 1
          observation.scenarioPrompts = [...(observation.scenarioPrompts ?? []), promptText]
          const analysis = promptJson(promptText, 'Frozen analysis:', 'Resolved Decisions with selected options (Service-owned facts):')
          const requiredPolicies = promptJson(promptText, 'Required category policies:', 'Allowed source anchors:')
          const generated = { status: 'ready', diagnostics: [], scenarios: analysis.requirements.flatMap((requirement) => requirement.acceptanceCriteria.filter((criterion) => criterion.required).flatMap((criterion) => (requiredPolicies[criterion.key] ?? [{ category: 'happy_path', sourceAnchorIds: criterion.sourceRefs }]).map((policy) => ({ requirementKey: requirement.key, acceptanceKey: criterion.key, key: `SCN-${criterion.key}-${policy.category.toUpperCase()}`, category: policy.category, preconditions: [`${criterion.key} prerequisites are satisfied`], trigger: `Exercise ${criterion.key} ${policy.category}`, expectedOutcomes: [`Observe ${criterion.key} ${policy.category}`], observableAt: [{ kind: 'test', description: `Automated verification for ${criterion.key} ${policy.category}` }], derivation: 'inferred', assumptions: [], required: true, sourceAnchorIds: policy.sourceAnchorIds })))) }
          normalizedResponse = JSON.stringify(typeof observation.scenarioResponse === 'function' ? observation.scenarioResponse({ generated, promptText, call: observation.scenarioCalls }) : observation.scenarioResponse ?? generated)
          } else if (persona.includes('independent repository-binding reviewer')) {
          observation.bindingReviewCalls = (observation.bindingReviewCalls ?? 0) + 1
          const reviewedInputDigest = promptText.match(/Review input digest:\n([a-f0-9]{64})/)?.[1]
          const generated = { status: 'approved', reviewedInputDigest, findings: [] }
          normalizedResponse = JSON.stringify(typeof observation.bindingReviewResponse === 'function' ? observation.bindingReviewResponse({ generated, promptText, call: observation.bindingReviewCalls }) : observation.bindingReviewResponse ?? generated)
          } else if (persona.includes('repository binding analyst')) {
          observation.bindingCalls = (observation.bindingCalls ?? 0) + 1
          const requirements = promptJson(promptText, 'Frozen requirements:', 'Frozen scenarios (local keys only):')
          const evidence = promptJson(promptText, 'Allowed evidence refs:', 'Return one corrected JSON object. Gate feedback:')
          const preferred = evidence.find((item) => /^(?:src|tests)\//.test(item.path)) ?? evidence[0]
          const scope = preferred.path.includes('/') ? preferred.path.split('/')[0] : preferred.path
          const generated = { status: 'ready', diagnostics: [], bindings: requirements.map((requirement) => ({ key: `BIND-${requirement.key}`, requirementKey: requirement.key, changeIntent: 'modify', impactAssessments: bindingImpactAssessments(preferred.ref), evidenceRefs: [preferred.ref], allowedPathScopes: [scope], excludedPathScopes: [], ownerSymbols: [preferred.path], currentBehaviorClaims: [`${preferred.path} is a repository-owned change surface.`], eventFactChains: [] })) }
          normalizedResponse = JSON.stringify(typeof observation.bindingResponse === 'function' ? observation.bindingResponse({ generated, promptText, call: observation.bindingCalls }) : observation.bindingResponse ?? generated)
          } else if (persona.includes('independent delivery-plan reviewer')) {
          observation.planReviewCalls = (observation.planReviewCalls ?? 0) + 1
          observation.planReviewPrompts = [...(observation.planReviewPrompts ?? []), promptText]
          const reviewedInputDigest = promptText.match(/Review input digest:\n([a-f0-9]{64})/)?.[1]
          const generated = { status: 'approved', reviewedInputDigest, findings: [] }
          normalizedResponse = JSON.stringify(typeof observation.planReviewResponse === 'function' ? observation.planReviewResponse({ generated, promptText, call: observation.planReviewCalls }) : observation.planReviewResponse ?? generated)
          } else if (persona.includes('code-grounded delivery planner')) {
          observation.plannerV3Calls = (observation.plannerV3Calls ?? 0) + 1
          const requirements = promptJson(promptText, 'Requirements and Acceptance:', 'Resolved Decisions:')
          const scenarios = promptJson(promptText, 'Scenarios:', 'Bindings:')
          const bindings = promptJson(promptText, 'Bindings:', 'Policy refs:')
          const policyRefs = promptJson(promptText, 'Policy refs:', 'Evidence claim refs:')
          const evidenceRefs = promptJson(promptText, 'Evidence claim refs:', 'Verification command refs:')
          const commandRefs = promptJson(promptText, 'Verification command refs:', 'Return one corrected V3 JSON object. Gate feedback:')
          const requirementKeys = requirements.map((item) => item.key)
          const acceptanceKeys = requirements.flatMap((item) => item.acceptanceCriteria.map((criterion) => criterion.key))
          const scenarioKeys = scenarios.map((item) => item.key)
          const bindingKeys = bindings.map((item) => item.key)
          const allowedPathScopes = [...new Set(bindings.flatMap((item) => item.allowedPathScopes))]
          const contextPack = (relationship) => ({ objective: `${relationship} the frozen requirement set.`, whyNow: 'The approved requirement revision needs an executable change.', inScope: [...allowedPathScopes], outOfScope: [], requirementStatements: requirements.map((item) => item.statement), currentBehaviorClaimRefs: [evidenceRefs[0].ref], targetBehavior: 'The required behavior is implemented and independently verified.', startingPoints: [{ evidenceRef: evidenceRefs[0].ref, reason: 'Repository-backed owner surface.' }], expectedChangeSurfaces: [...allowedPathScopes], forbiddenChangeSurfaces: [], invariants: ['Do not expand scope.'], verificationSteps: scenarioKeys.map((key) => ({ scenarioKey: key, action: `Verify ${key}`, expectedObservable: `${key} passes`, commandEvidenceRef: commandRefs[0].ref })), expectedArtifacts: ['source changes', 'automated tests'], escalationConditions: ['Requirement or repository evidence changes.'], unknowns: [] })
          const baseTask = (key, relationship, kind, dependencies) => ({ key, workPackageKey: 'WP-CORE', title: `${relationship} requirements`, kind, relationship, description: `${relationship} all frozen scenarios.`, requirementKeys, acceptanceKeys, scenarioKeys, decisionKeys: [], policyConstraintRefs: policyRefs.map((item) => item.ref), bindingKeys, evidenceClaimRefs: [evidenceRefs[0].ref], dependencyKeys: dependencies, verificationCommandRefs: [commandRefs[0].ref], completionCriteria: [`All ${relationship} criteria pass.`], risk: 'medium', contextPack: contextPack(relationship), changeContract: { allowedPathScopes, excludedPathScopes: [], conflictKeys: ['v3-core'], expectedArtifacts: ['source changes', 'automated tests'], outOfScopePolicy: 'fail' } })
          const generated = { contractVersion: 3, summary: 'Evidence-grounded V3 plan.', status: 'ready', blockedReasons: [], workPackages: [{ key: 'WP-CORE', title: 'Core delivery', businessOutcome: 'Deliver the frozen requirements.', requirementKeys, acceptanceKeys, bindingKeys }], tasks: [baseTask('TASK-IMPLEMENT', 'implementation', 'code', []), baseTask('TASK-VERIFY', 'verification', 'test', ['TASK-IMPLEMENT'])] }
          normalizedResponse = JSON.stringify(typeof observation.plannerV3Response === 'function' ? observation.plannerV3Response({ generated, promptText, call: observation.plannerV3Calls }) : observation.plannerV3Response ?? generated)
          } else if (persona.includes('selected executing Agent performing a read-only task handoff preflight')) {
          observation.preflightCalls = (observation.preflightCalls ?? 0) + 1
          const assignment = promptJson(promptText, 'Assignment:', 'Task proposal:')
          const generated = { agentId: assignment.agentId, agentReportedStatus: 'accepted', identityAuditable: true, structuralEligible: true, accessCurrent: true, contextCurrent: true, evidenceRead: true, objectiveRestated: true, startingPointCovered: true, allowedScopeCovered: true, forbiddenScopeAcknowledged: true, verificationCovered: true, escalationCovered: true, noBlockingUnknowns: true, missingFacts: [] }
          normalizedResponse = JSON.stringify(typeof observation.preflightResponse === 'function' ? observation.preflightResponse({ generated, promptText, call: observation.preflightCalls }) : observation.preflightResponse ?? generated)
          } else if (persona.includes('senior delivery planner')) {
          observation.plannerCalls = (observation.plannerCalls ?? 0) + 1
          const source = responses[Math.min(observation.plannerCalls - 1, responses.length - 1)]
          const legacy = JSON.parse(normalizeResponse(source))
          normalizedResponse = legacy.contractVersion === 2 || !Array.isArray(legacy.tasks) ? JSON.stringify(legacy) : JSON.stringify({ contractVersion: 2, status: 'ready', summary: legacy.summary, repositoryEvidence: legacy.repositoryEvidence, tasks: legacy.tasks.map((task) => ({ id: task.id, title: task.title, kind: task.kind, relationship: task.kind === 'code' ? 'implementation' : 'verification', description: task.description, completionCriteria: task.acceptanceCriteria, dependencies: task.dependencies, sourceRequirementKeys: ['REQ-001'], acceptanceKeys: ['AC-001'], decisionKeys: [], assignmentPolicy: { policyVersion: 2, mode: 'single_agent', riskLevel: 'low', requiredRoles: [task.kind === 'code' ? 'implementer' : 'verifier'], requiredCapabilities: [], requiresIndependentReviewer: false, maxParallel: 1, conflictKeys: [], allowedScope: [], forbiddenScope: [], escalationConditions: [] }, evidenceRefs: task.evidenceRefs, testCommand: task.testCommand })), diagnostics: [] })
          } else {
          observation.agentResponseCalls = (observation.agentResponseCalls ?? 0) + 1
          normalizedResponse = normalizeResponse(responses[Math.min(observation.agentResponseCalls - 1, responses.length - 1)])
          }
          session.events = [{ type: 'assistant/message', data: { message: { content: [{ type: 'text', text: normalizedResponse }] } } }]
        }
        return {
          agent: {
            session,
            followup: (message) => { observation.message = message; observation.prompt = message.content?.[0]?.text; observation.prompts = [...(observation.prompts ?? []), observation.prompt]; respond(observation.prompt) },
            whenIdle: async () => {},
            cancel: () => {},
          },
          dispose: async () => {},
        }
      },
    },
  }
}

function readyV2Plan(acceptanceKeys = ['AC-001']) {
  const task = (id, kind, relationship, role, dependencies = []) => ({ id, title: id, kind, relationship, description: id, completionCriteria: [`${id} done`], dependencies, sourceRequirementKeys: acceptanceKeys.map((_, index) => `REQ-${String(index + 1).padStart(3, '0')}`), acceptanceKeys, decisionKeys: [], assignmentPolicy: { policyVersion: 2, mode: 'single_agent', riskLevel: 'low', requiredRoles: [role], requiredCapabilities: [], requiresIndependentReviewer: false, maxParallel: 1, conflictKeys: [], allowedScope: [], forbiddenScope: [], escalationConditions: [] }, evidenceRefs: ['package.json'], testCommand: 'true' })
  return JSON.stringify({ contractVersion: 2, status: 'ready', summary: 'V2 plan.', repositoryEvidence: { inspectedPaths: ['package.json'], manifests: ['package.json'], verifiedCommands: ['true'], relevantModules: ['src'], assumptions: [] }, tasks: [task('implement', 'code', 'implementation', 'implementer'), task('verify', 'test', 'verification', 'verifier', ['implement'])], diagnostics: [] })
}

async function createPlanningV3Fixture(root) {
  const repository = join(root, 'repository')
  await mkdir(repository)
  await mkdir(join(repository, 'src'))
  await mkdir(join(repository, 'tests'))
  await writeFile(join(repository, 'package.json'), JSON.stringify({ name: 'planning-v3-fixture', private: true, scripts: { verify: 'node --test' }, devDependencies: { typescript: '^5.8.0' } }))
  await writeFile(join(repository, 'src', 'records.ts'), 'export const records = new Map()\n')
  await writeFile(join(repository, 'tests', 'records.test.ts'), 'export const verifiesRecords = true\n')
  await execFileAsync('git', ['init'], { cwd: repository })
  await execFileAsync('git', ['config', 'user.email', 'test@example.com'], { cwd: repository })
  await execFileAsync('git', ['config', 'user.name', 'Test'], { cwd: repository })
  await execFileAsync('git', ['add', '.'], { cwd: repository })
  await execFileAsync('git', ['commit', '-m', 'test: initialize planning v3 fixture'], { cwd: repository })
  return repository
}

async function waitForPlanning(store, projectId) {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    const project = store.projects.get(projectId)
    if (project?.status !== 'decomposing') return project
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
  throw new Error(`Planning did not settle for ${projectId}`)
}

async function waitForProject(store, projectId, predicate, message = 'Project did not reach the expected state') {
  for (let attempt = 0; attempt < 500; attempt += 1) {
    const project = store.projects.get(projectId)
    if (project !== undefined && predicate(project)) return project
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
  throw new Error(`${message}: ${projectId}`)
}

async function addTrustedCapabilities(store, projectId, agentId, capabilities) {
  for (const capabilityId of capabilities) {
    const claim = { id: `test-claim:${projectId}:${agentId}:${capabilityId}`, projectId, agentId, capabilityId, capabilityVersion: 1, source: 'human_confirmed', status: 'active', confirmedBy: 'test-owner', validFrom: now, claimDigest: 'a'.repeat(64) }
    await store.agentCapabilityClaims.put(claim.id, claim)
  }
}

function interruptedPlanningOperation(id, projectId, reservedPlanSnapshotId, stage = 'reserved') {
  return {
    id, projectId, mode: 'initial', status: 'running', stage, planningContractVersion: 3, publicationMode: 'candidate', metricPolicyId: 'metric-policy:test', metricPolicyVersion: 'test-v1', metricPolicyDigest: 'a'.repeat(64),
    baseProjectRevision: 1, repositoryPolicyIteration: 0, requestDigest: 'a'.repeat(64), sourceDispositionBindingIds: [],
    acceptanceScenarioIds: [], acceptanceScenarioCoveragePolicyIds: [], policyFulfillmentIds: [], assignmentDraftIds: [],
    assignmentEvaluationIds: [], taskPreflightIds: [], reservedPlanSnapshotId, reservedPlanRevision: 2, workPackageIds: [], taskIds: [],
    capabilityRequirementIds: [], assignmentDecisionIds: [], diagnostics: [], createdAt: now, updatedAt: now,
  }
}

test('Planning V3 candidate atomically publishes evidence-grounded tasks only after trusted assignment and preflight', async () => {
  const root = await mkdtemp(join(tmpdir(), 'po-v3-candidate-'))
  try {
    const repository = await createPlanningV3Fixture(root)
    await mkdir(join(repository, 'scripts'))
    await writeFile(join(repository, 'scripts', 'generate-fixture.py'), 'def main():\n    return True\n')
    await execFileAsync('git', ['add', 'scripts/generate-fixture.py'], { cwd: repository })
    await execFileAsync('git', ['commit', '-m', 'test: add auxiliary repository tool'], { cwd: repository })
    const store = memoryStore()
    const observation = {
      scenarioResponse: ({ generated, call }) => call === 1 ? {
        ...generated,
        scenarios: generated.scenarios.map((scenario, index) => index === 0 ? { ...scenario, assumptions: ['An unknown stage identifier is present only to test non-standard ordering.'] } : scenario),
      } : generated,
      bindingReviewResponse: ({ generated, call }) => call === 1 ? {
        ...generated,
        status: 'changes_requested',
        findings: [{
          code: 'BINDING_UNKNOWN_STAGE_CONSUMER_CHAIN_INCOMPLETE',
          severity: 'error',
          subjectType: 'binding',
          subjectId: 'BIND-REQ-001',
          evidenceIds: ['src/types.ts'],
          message: 'REQ-002 independently requires persisted unknown-stage attempts to be returned and sorted after known stages, but this Binding covers only the comparator symptom. PlanningStageAttemptRecordSchema currently validates stage through the closed PlanningOperationStageSchema, so unknown-stage records cannot traverse the real persisted read path. Bind the actual schema/validation and storage surfaces, together with compatibility and tests proving unknown-stage records can be persisted/read without weakening the separately closed PlanningOperation stage contract.',
          repairOwner: 'binding',
          restartStage: 'code_binding',
        }],
      } : generated,
    }
    const service = new OrchestratorService(agentContext('unused', observation), store, undefined, undefined, { planningContractMode: 'v3-candidate' })
    const project = await service.createProjectFromRequest({ mode: 'empty', name: 'V3 candidate', cwd: repository, prd: '# 功能\n## 验收标准\n1. 仅管理员可以保存；依赖失败时不得提交状态，旧版本数据迁移必须兼容并可恢复' })
    const implementer = await service.createAgent({ name: 'V3 Implementer', role: 'Software Engineer', persona: 'Implement.', skills: ['free-form-execution-skill-that-is-not-installed'] })
    const verifier = await service.createAgent({ name: 'V3 Verifier', role: 'Test Engineer', persona: 'Verify.' })
    await service.addProjectAgents(project.id, { members: [
      { agentId: implementer.id, projectRole: 'Software Engineer', deliveryRoles: ['implementer'], autoAssignable: true },
      { agentId: verifier.id, projectRole: 'Test Engineer', deliveryRoles: ['verifier'], autoAssignable: true },
    ] })
    await addTrustedCapabilities(store, project.id, implementer.id, ['language.typescript', 'testing.automation'])
    await addTrustedCapabilities(store, project.id, verifier.id, ['language.typescript', 'testing.automation', 'testing.verification'])

    await service.startDecomposition(project.id)
    const settled = await waitForPlanning(store, project.id)

    assert.equal(settled.status, 'awaiting_approval', settled.lastError)
    assert.equal(settled.planningContractVersion, 3)
    assert.equal(store.planSnapshots.get(settled.currentPlanSnapshotId).planningContractVersion, 3)
    assert.deepEqual(store.projectTasks(settled).map((task) => task.relationship), ['implementation', 'verification'])
    assert.equal(store.projectTasks(settled).every((task) => task.agentId && task.taskPreflightId && task.bindingIds.length > 0 && task.scenarioIds.length > 0), true)
    const committedOperation = [...store.planningOperations.records.values()].at(-1)
    assert.equal(committedOperation.status, 'committed')
    const sourceInput = store.planningSourceInputs.get(committedOperation.sourceInputId)
    const sourceManifest = store.requirementSourceManifests.get(committedOperation.sourceManifestId)
    const analysisProposal = store.requirementAnalysisProposals.get(committedOperation.requirementAnalysisProposalId)
    assert.equal(sourceInput.sourceInputDigest, committedOperation.sourceInputDigest)
    assert.equal(sourceInput.requestDigest, committedOperation.requestDigest)
    assert.equal(committedOperation.sourceProfileIds.length >= 1, true)
    assert.equal(committedOperation.sourceProfileIds.every((id) => store.requirementSourceProfiles.get(id).status === 'complete'), true)
    assert.equal(sourceManifest.manifestDigest, committedOperation.sourceManifestDigest)
    assert.equal(sourceManifest.sourceCompletenessDigest, committedOperation.sourceCompletenessDigest)
    assert.equal(sourceManifest.status, 'accepted')
    assert.equal(store.sourcePolicyPrechecks.get(committedOperation.sourcePolicyPrecheckId).sourceManifestId, sourceManifest.id)
    assert.equal(analysisProposal.analysisDigest, committedOperation.requirementAnalysisDigest)
    assert.equal(analysisProposal.sourceManifestDigest, sourceManifest.manifestDigest)
    const evaluation = service.exportPlanningEvaluationV3(project.id, committedOperation.id, { caseId: 'v3-candidate', runId: 'run-1' })
    assert.equal(evaluation.executionKind, 'real_model')
    assert.equal(evaluation.status, 'ready')
    assert.equal(evaluation.assignments.every((assignment) => assignment.outcome === 'selected'), true)
    assert.equal(evaluation.provenance.modelId, 'test')
    assert.equal(JSON.stringify(evaluation).includes(project.prd), false)
    assert.equal(JSON.stringify(evaluation).includes(repository), false)
    const frozenCapabilityCatalog = structuredClone(store.projectCapabilityCatalogSnapshots.get(committedOperation.capabilityCatalogSnapshotId))
    await store.projectCapabilityCatalogSnapshots.put(frozenCapabilityCatalog.id, { ...frozenCapabilityCatalog, projectId: 'foreign-project' })
    assert.throws(() => service.exportPlanningEvaluationV3(project.id, committedOperation.id, { caseId: 'v3-candidate', runId: 'cross-project' }), (error) => error.code === 'planning-evaluation-evidence-incomplete')
    await store.projectCapabilityCatalogSnapshots.put(frozenCapabilityCatalog.id, frozenCapabilityCatalog)
    await store.planningOperations.put(committedOperation.id, { ...committedOperation, modelExecutionProvenance: undefined })
    assert.throws(() => service.exportPlanningEvaluationV3(project.id, committedOperation.id, { caseId: 'v3-candidate', runId: 'missing-provenance' }), (error) => error.code === 'planning-evaluation-provenance-unavailable')
    await store.planningOperations.put(committedOperation.id, { ...committedOperation, predecessorOperationId: 'operation-predecessor' })
    assert.throws(() => service.exportPlanningEvaluationV3(project.id, committedOperation.id, { caseId: 'v3-candidate', runId: 'reused-lineage' }), (error) => error.code === 'planning-evaluation-lineage-unsupported')
    await store.planningOperations.put(committedOperation.id, committedOperation)
    const stageAttempts = service.listPlanningStageAttemptsV3(project.id, committedOperation.id)
    assert.equal(stageAttempts[0].stage, 'reserved')
    assert.equal(stageAttempts.every((attempt) => attempt.status === 'completed'), true)
    assert.equal(stageAttempts.some((attempt) => attempt.stage === 'task_preflight'), true)
    assert.equal(stageAttempts.some((attempt) => attempt.stage === 'convergence_carry_validation'), true)
    assert.equal(stageAttempts.some((attempt) => attempt.stage === 'source_ingest'), true)
    assert.equal(stageAttempts.some((attempt) => attempt.stage === 'source_profile'), true)
    assert.equal(stageAttempts.some((attempt) => attempt.stage === 'source_manifest'), true)
    assert.equal(stageAttempts.some((attempt) => attempt.id === analysisProposal.stageAttemptId && attempt.stage === 'requirement_analysis'), true)
    assert.equal(stageAttempts.every((attempt) => attempt.inputDigest.length === 64 && attempt.outputDigest.length === 64), true)
    for (const requiredStage of ['canonical_target_binding', 'policy_snapshot', 'code_binding', 'task_plan', 'reference_mapping', 'policy_fulfillment', 'capability_requirement_derivation', 'capability_catalog_snapshot', 'access_grant_snapshot']) {
      assert.equal(stageAttempts.some((attempt) => attempt.stage === requiredStage && attempt.status === 'completed'), true, `missing durable ${requiredStage} attempt`)
    }
    for (const manifest of store.planningPromptReferenceManifests.records.values()) {
      const owningAttempt = store.planningStageAttempts.get(manifest.stageAttemptId)
      assert.equal(owningAttempt?.operationId, committedOperation.id)
      assert.equal(owningAttempt?.status, 'completed')
      assert.equal(['code_binding', 'task_plan'].includes(owningAttempt?.stage), true)
    }
    assert.equal([...store.assignmentEvaluations.records.values()].every((item) => item.outcome === 'selected'), true)
    assert.equal([...store.capabilityRequirementDrafts.records.values()].every((item) => !item.requiredCapabilities.includes('language.python')), true)
    assert.equal([...store.taskPreflightsV3.records.values()].every((item) => item.serviceVerdict === 'accepted'), true)
    assert.equal(observation.scenarioCalls, 2)
    assert.equal(observation.scenarioReviewCalls, 1)
    assert.equal(observation.bindingCalls, 1)
    assert.equal(observation.bindingReviewCalls, 2)
    assert.equal(observation.plannerV3Calls, 1)
    assert.equal(observation.planReviewCalls, 1)
    assert.equal(observation.preflightCalls, 2)
    const preflightPrompts = observation.prompts.filter((prompt) => prompt.includes('TaskPreflight V3 JSON object'))
    assert.equal(preflightPrompts.length, 2)
    for (const preflightPrompt of preflightPrompts) {
      assert.match(preflightPrompt, /opaque refs are identifiers, not repository filenames/i)
      assert.match(preflightPrompt, /Authoritative evidence projections:/)
      assert.match(preflightPrompt, /"repositoryPaths":\["src\/records\.ts"/)
      assert.match(preflightPrompt, /Dependency Tasks are expected to be unexecuted during preflight/)
      assert.match(preflightPrompt, /target file or directory may not exist yet/)
      assert.match(preflightPrompt, /configured free-form Agent skills are execution-time preferences/)
      assert.match(preflightPrompt, /"permissions":\["evidence_read","repository_read","worktree_write","command_execute","artifact_write"\]/)
    }
    assert.equal((observation.sections ?? []).some((section) => section.name === 'deployment:assigned-skills' && section.text.includes('free-form-execution-skill-that-is-not-installed')), false)
    const scenarioPrompt = observation.prompts.find((prompt) => prompt.includes('Acceptance Scenario V3 JSON object'))
    assert.match(scenarioPrompt, /A blocked planning operation is not a blocked stage attempt/)
    assert.match(scenarioPrompt, /Never create a fixture, precondition, expected outcome, or UI list item whose stage-attempt status is blocked/)
    assert.match(scenarioPrompt, /eventObservables must enumerate every independently asserted persisted record/)
    assert.match(scenarioPrompt, /globally unique EVT-\* local key/)
    assert.match(scenarioPrompt, /Never group a Dispatch record, TaskRun record, and ActivityEvent under one key/)
    const correctedScenarioPrompt = observation.scenarioPrompts.find((prompt) => prompt.includes('Remove the unsupported behavior completely, including negated assumptions and non-standard stage fixtures.'))
    assert.match(correctedScenarioPrompt, /scenario-unsupported-unknown-stage-compatibility/)
    const bindingPrompt = observation.prompts.find((prompt) => prompt.includes('Repository Binding V3 JSON object'))
    assert.match(bindingPrompt, /Optional persistence properties are not a sufficient response contract/)
    assert.match(bindingPrompt, /use explicit null in the projected API\/client contract/)
    assert.match(bindingPrompt, /inspect and bind every repository writer that can create the relevant record/)
    assert.match(bindingPrompt, /normal transitions, catch or fallback writers, interruption recovery, and compatibility initialization/)
    assert.match(bindingPrompt, /Claim current persisted support only if every applicable writer already stores the required fact/)
    assert.match(bindingPrompt, /terminal writer that stores completedAt or terminal status but omits a required duration/)
    assert.match(bindingPrompt, /Do not infer a missing persisted value from timestamps in a read projection/)
    assert.match(bindingPrompt, /existing browser\/DOM test runner/)
    assert.match(bindingPrompt, /absence of an installed browser runner or an existing end-to-end test file is target work, not evidence insufficiency/)
    assert.match(bindingPrompt, /do not use the whole tests directory as the only proposed harness scope/)
    assert.match(bindingPrompt, /For every frozen Scenario eventObservables entry, emit exactly one structured eventFactChains entry/)
    assert.match(bindingPrompt, /same eventObservableKey/)
    assert.match(bindingPrompt, /"eventObservableKey":"EVT-SCN-AC-001-NO-EVENT"/)
    assert.match(bindingPrompt, /This also applies to a negative assertion that no event occurred/)
    assert.match(bindingPrompt, /Dispatch record, TaskRun record, and ActivityEvent are distinct facts/)
    assert.match(bindingPrompt, /persistedCollectionOwnerSymbols/)
    assert.match(bindingPrompt, /bind both the read\/sort consumer and the actual repository order catalog/)
    assert.match(bindingPrompt, /Do not return blocked merely because the requested behavior, response contract, browser harness, runner dependency, fixture, or regression test still needs to be implemented/)
    assert.match(bindingPrompt, /Every diagnostic must contain exactly code, severity, message, and subjectIds/)
    assert.match(bindingPrompt, /Do not output evidenceRefs on a diagnostic/)
    assert.match(bindingPrompt, /A PlanningOperation status of blocked is not a PlanningStageAttempt status/)
    assert.match(bindingPrompt, /Never propose, require, or describe a blocked attempt row, fixture, enum extension/)
    assert.doesNotMatch(bindingPrompt, /persisted unknown or future stage identifiers to remain readable and sort stably after known stages/)
    assert.match(bindingPrompt, /that Requirement's own Binding must include the complete real browser\/DOM chain/)
    assert.match(bindingPrompt, /coverage in another Requirement Binding does not close it/)
    const bindingPromptScenarios = JSON.parse(bindingPrompt.split('Frozen scenarios (local keys only):\n')[1].split('\n\nRepository identity and commands')[0])
    assert.equal(bindingPromptScenarios.length, 7)
    assert.equal(bindingPromptScenarios.every((scenario) => scenario.id === undefined && scenario.projectId === undefined && scenario.operationId === undefined && scenario.requirementId === undefined && scenario.acceptanceCriterionId === undefined), true)
    const bindingReviewPrompt = observation.prompts.find((prompt) => prompt.includes('binding Planning Review V3 JSON object'))
    assert.match(bindingReviewPrompt, /System verification policy requires every Scenario observable at ui to have a real browser\/DOM harness/)
    assert.match(bindingReviewPrompt, /Every frozen Scenario eventObservables entry, including a negative no-event assertion/)
    assert.match(bindingReviewPrompt, /requires exactly one structured eventFactChains entry/)
    assert.match(bindingReviewPrompt, /Dispatch record, TaskRun record, and ActivityEvent are distinct facts/)
    assert.match(bindingReviewPrompt, /preserve those source-required tests as separate coverage/)
    assert.match(bindingReviewPrompt, /does not by itself require all three values on PlanningStageAttempt rows/)
    assert.match(bindingReviewPrompt, /never infer or require a persisted state that the source and repository contract exclude/)
    assert.match(bindingReviewPrompt, /bindingStageIdentifierCompatibilityRequired=false/)
    assert.match(bindingReviewPrompt, /special unknown-stage compatibility rule is inapplicable/)
    assert.doesNotMatch(bindingReviewPrompt, /separates the forward-compatible PlanningStageAttempt stage identifier from the closed PlanningOperation and repair-restart stage contract/)
    const correctedBindingReviewPrompt = observation.prompts.find((prompt) => prompt.includes('cannot require unknown or future stage-identifier compatibility'))
    assert.match(correctedBindingReviewPrompt, /cannot require unknown or future stage-identifier compatibility when the deterministic frozen-Requirement gate is false/)
    const plannerPrompt = observation.prompts.find((prompt) => prompt.includes('Delivery Plan V3 JSON object'))
    assert.match(plannerPrompt, /verificationHarness has exactly two legal states: omit the property entirely, or provide an object whose kind is exactly browser/)
    assert.match(plannerPrompt, /Never emit verificationHarness with kind unit, api, service, integration, repository, command, none, null/)
    assert.match(plannerPrompt, /verificationHarness/)
    assert.match(plannerPrompt, /Every Task, including infrastructure, migration, review, and release Tasks, must list at least one injected Scenario/)
    assert.match(plannerPrompt, /never emit empty scenarioKeys or verificationSteps/)
    assert.match(plannerPrompt, /Do not map every verification Task to every Scenario/)
    assert.match(plannerPrompt, /separate source-required bundle, API, or service verification Task may map the same UI Scenario without a harness as supporting coverage/)
    assert.match(plannerPrompt, /another verification Task maps that exact Scenario with the complete browser harness/)
    assert.match(plannerPrompt, /actual UI-to-service-to-persistence chain/)
    assert.match(plannerPrompt, /implementation Task must also include the same concrete contextPack\.verificationHarness contract/)
    assert.match(plannerPrompt, /structured ownership is mandatory so the Service can derive browser, process-orchestration, API, data, consumer, and security capabilities/)
    assert.match(plannerPrompt, /package script or CI step that provisions browser binaries and required system dependencies in a clean environment/)
    assert.match(plannerPrompt, /clean-install command or CI assertion that proves the runner can launch/)
    assert.match(plannerPrompt, /allowed loopback Peer, allowed loopback Host, matching Origin, and same-origin Fetch Metadata/)
    assert.match(plannerPrompt, /rejected non-loopback Peer, rejected non-loopback Host, missing Origin, cross-origin Origin, cross-site Fetch Metadata, and invalid Fetch Metadata/)
    assert.match(plannerPrompt, /Rejected cases may be expressed as separate completion criteria or verification steps, but every case must compare business facts immediately before and after its own request and assert zero business writes/)
    assert.match(plannerPrompt, /A read-only GET, a generic no-side-effect statement, or a statement that no Dispatch occurred does not fulfill this mutation policy/)
    assert.match(plannerPrompt, /Every test file, bundle test, migration, manifest, or other artifact explicitly required by the frozen source must also be allowed/)
    assert.match(plannerPrompt, /build, check, and typecheck commands alone cannot establish API, persistence, DOM, clock, accessibility, or side-effect observations/)
    assert.match(plannerPrompt, /Ordinary implementation Tasks must omit verificationHarness/)
    assert.match(plannerPrompt, /make every Task that executes or relies on the new browser harness depend directly or transitively on that infrastructure Task/)
    assert.match(plannerPrompt, /temporary storage configuration or directory shared with the spawned application/)
    assert.match(plannerPrompt, /fixture-write-complete\/application-read-ready synchronization point/)
    assert.match(plannerPrompt, /equal row top coordinates and the required grid-template-columns count/)
    assert.match(plannerPrompt, /computed style plus a non-color cue/)
    assert.match(plannerPrompt, /No frozen Requirement requires unknown\/future stage-identifier compatibility/)
    assert.match(plannerPrompt, /allowedPathScopes as the complete write ownership contract/)
    assert.match(plannerPrompt, /Every blockedReasons item must contain exactly code, severity, message, and subjectIds/)
    assert.match(plannerPrompt, /"blockedReasons":\[\{"code":"planning-evidence-insufficient","severity":"blocking","message":"\.\.\.","subjectIds":\["REQ-001","ref-policy-p0001"\]\}\]/)
    assert.match(scenarioPrompt, /actual browser or user interaction as its trigger/)
    assert.match(scenarioPrompt, /bundle contract and never claims rendered DOM, layout, accessibility, visual distinction, navigation, or asynchronous UI behavior/)
    assert.match(scenarioPrompt, /boundary names an actual edge value, limit, edge state, or boundary transition/)
    assert.match(scenarioPrompt, /Never borrow Approval, Dispatch, persistence, UI, API, or other behavior from another Acceptance/)
    assert.match(scenarioPrompt, /return blocked rather than importing scope from a sibling Acceptance/)
    assert.match(scenarioPrompt, /bindingStageIdentifierCompatibilityRequired=false/)
    assert.match(scenarioPrompt, /Do not introduce unknown or future stage persistence, compatibility, fallback ordering, schema, migration, API, UI, browser, rollback, or test behavior/)
    const planReviewSubject = JSON.parse(observation.planReviewPrompts[0].split('Frozen subject:\n')[1])
    assert.match(observation.planReviewPrompts[0], /Assignment Qualification and TaskPreflight intentionally run only after this Plan Review approves/)
    assert.match(observation.planReviewPrompts[0], /do not report missing assignments, candidate eligibility, reviewer assignment, capacity, Runtime availability, dependency completion, or preflight results/)
    assert.match(observation.planReviewPrompts[0], /every expectedChangeSurfaces entry must be allowed/)
    assert.match(observation.planReviewPrompts[0], /only when the Task explicitly claims it will modify that declaration/)
    assert.match(observation.planReviewPrompts[0], /read-only import, invocation, observation, assertion, or preservation of an existing owner does not expand source-write ownership/)
    assert.match(observation.planReviewPrompts[0], /persisted test fixture facts through an existing API, domain store, or storage interface does not require ownership/)
    assert.doesNotMatch(observation.planReviewPrompts[0], /declaring path of every named schema, type, DTO, constant, comparator, state owner, or other owner symbol must be allowed/)
    assert.match(observation.planReviewPrompts[0], /Missing target files are valid future artifacts/)
    assert.match(observation.planReviewPrompts[0], /Capability vocabulary and granularity are closed and Service-owned under derivation rule v3\.3\.13/)
    assert.match(observation.planReviewPrompts[0], /Language capabilities derive only from each Task's owned source file extensions or existing language evidence inside an owned directory/)
    assert.match(observation.planReviewPrompts[0], /language capabilities never propagate from read-only evidence or implementation dependencies/)
    assert.match(observation.planReviewPrompts[0], /Owning or verifying an unrelated backend consumer from the same broad Binding does not imply a frontend framework capability/)
    assert.match(observation.planReviewPrompts[0], /Every Task with a real-browser verificationHarness maps to both capabilities/)
    assert.match(observation.planReviewPrompts[0], /verification, review, or release Task receives a detected framework capability only when the Binding has intersecting required consumer evidence/)
    assert.match(observation.planReviewPrompts[0], /generic Binding membership is insufficient/)
    assert.match(observation.planReviewPrompts[0], /React DOM, component, layout, and style implementation map to framework\.react/)
    assert.match(observation.planReviewPrompts[0], /Real-browser layout, computed-style, accessible-name, and non-color-state observations map to testing\.browser-e2e plus testing\.verification/)
    assert.equal(planReviewSubject.scenarios.length, 7)
    assert.equal(planReviewSubject.scenarioCoveragePolicies.length, 1)
    assert.equal(planReviewSubject.scenarioCoveragePolicies[0].categories.length, 7)
    assert.equal(planReviewSubject.policyConstraints.length > 0, true)
    assert.equal(planReviewSubject.policyConstraints.every((constraint) => typeof constraint.statement === 'string' && constraint.statement.length > 0), true)
    const promptReferenceMappings = new Map(planReviewSubject.promptReferenceMappings.map((item) => [item.ref, item]))
    const opaqueTaskRefs = planReviewSubject.plan.tasks.flatMap((task) => [
      ...task.policyConstraintRefs,
      ...task.evidenceClaimRefs,
      ...task.verificationCommandRefs,
      ...task.contextPack.currentBehaviorClaimRefs,
      ...task.contextPack.startingPoints.map((item) => item.evidenceRef),
      ...task.contextPack.verificationSteps.flatMap((item) => item.commandEvidenceRef === undefined ? [] : [item.commandEvidenceRef]),
    ])
    assert.equal(opaqueTaskRefs.every((ref) => promptReferenceMappings.has(ref)), true)
    const snapshot = store.planSnapshots.get(settled.currentPlanSnapshotId)
    assert.deepEqual(snapshot.convergenceCarryValidationIds, [])
    assert.equal(snapshot.convergenceCarryValidationDigest.length, 64)
    assert.deepEqual(committedOperation.convergenceCarryValidationIds, [])
    assert.equal(committedOperation.convergenceCarryValidationDigest, snapshot.convergenceCarryValidationDigest)
    const planningBeforeApproval = service.getProjectPlanningV3(project.id)
    assert.equal(planningBeforeApproval.stackProfile.supportStatus, 'supported')
    assert.equal(planningBeforeApproval.stackProfile.providerCoverage.every((item) => item.status === 'covered'), true)
    assert.match(planningBeforeApproval.canonicalTarget.targetRef, /^refs\/heads\//)
    assert.equal(planningBeforeApproval.canonicalTarget.planningBaseCommit, planningBeforeApproval.repository.headCommit)
    const integrationGrant = store.resourceAccessGrants.get(planningBeforeApproval.canonicalTarget.integrationGrantId)
    assert.equal(integrationGrant.principalType, 'integration_service')
    assert.deepEqual(integrationGrant.permissions, ['canonical_integrate'])
    assert.equal([...store.resourceAccessGrants.records.values()].filter((grant) => grant.principalType === 'agent').every((grant) => !grant.permissions.includes('canonical_integrate')), true)
    assert.equal(planningBeforeApproval.planHealth.approvable, true)
    assert.equal(planningBeforeApproval.tasks.length, 2)
    assert.equal(planningBeforeApproval.assignmentEvaluations.length, 2)
    assert.equal(planningBeforeApproval.taskPreflights.length, 2)
    assert.equal(planningBeforeApproval.riskProfile.level, 'high')
    assert.equal(planningBeforeApproval.requirementReview.status, 'approved')
    assert.equal(planningBeforeApproval.requirementReview.independenceStatus, 'independent')
    assert.deepEqual(planningBeforeApproval.riskProfile.requiredScenarioCategories, ['happy_path', 'business_rejection', 'boundary', 'dependency_failure', 'security', 'compatibility', 'recovery'])
    assert.equal(planningBeforeApproval.scenarioCoveragePolicies.length, 1)
    assert.equal(planningBeforeApproval.scenarioCoveragePolicies[0].categories.length, 7)
    assert.equal(planningBeforeApproval.scenarioCoveragePolicies[0].categories.every((item) => item.applicability === 'required'), true)
    assert.equal(planningBeforeApproval.scenarios.length, 7)
    assert.equal(planningBeforeApproval.scenarioCoverageReview.status, 'approved')
    assert.equal(planningBeforeApproval.scenarioCoverageReview.independenceStatus, 'independent')
    assert.equal(planningBeforeApproval.bindingReview.status, 'approved')
    assert.equal(planningBeforeApproval.bindingReview.independenceStatus, 'independent')
    assert.equal(planningBeforeApproval.planReview.status, 'approved')
    assert.equal(planningBeforeApproval.planReview.independenceStatus, 'independent')
    assert.deepEqual(planningBeforeApproval.actions, ['approve_plan'])
    const frozenMetricPolicy = structuredClone(store.planningMetricPolicies.get(committedOperation.metricPolicyId))
    const projectMetricPolicy = await service.publishPlanningMetricPolicyV3(project.id, {
      version: 'candidate-project-v1',
      metrics: frozenMetricPolicy.metrics,
      approvedBy: 'quality-owner',
      approvalReason: 'Future project operations use this policy; the current operation remains frozen.',
      idempotencyKey: 'candidate-project-policy-v1',
    })
    assert.notEqual(projectMetricPolicy.policy.id, frozenMetricPolicy.id)
    assert.equal(service.getPlanningMetricPolicyV3(project.id).id, projectMetricPolicy.policy.id)
    assert.equal(snapshot.metricPolicyId, frozenMetricPolicy.id)
    assert.equal(committedOperation.metricPolicyId, frozenMetricPolicy.id)
    assert.equal(service.getProjectPlanningV3(project.id).metricPolicy.id, frozenMetricPolicy.id)
    await store.planningMetricPolicies.put(frozenMetricPolicy.id, { ...frozenMetricPolicy, approvalReason: 'tampered without a new digest' })
    assert.equal(service.getProjectPlanningV3(project.id).planHealth.approvable, false)
    assert.equal(service.getProjectPlanningV3(project.id).planHealth.topIssues.some((issue) => issue.code === 'metric-policy-stale'), true)
    await assert.rejects(() => service.approvePlanningV3(project.id, { planSnapshotId: snapshot.id, planDigest: snapshot.planHash, projectRevision: settled.revision, accessGrantSnapshotId: snapshot.accessGrantSnapshotId, accessGrantDigest: snapshot.accessGrantDigest, approverId: 'acceptance-owner', idempotencyKey: 'reject-corrupt-metric-policy' }), (error) => error.code === 'plan-approval-stale')
    await store.planningMetricPolicies.put(frozenMetricPolicy.id, frozenMetricPolicy)
    const taskRunsBefore = store.taskRuns.size
    const frozenPolicySnapshot = structuredClone(store.planningPolicySnapshots.get(snapshot.policySnapshotId))
    await store.planningPolicySnapshots.put(frozenPolicySnapshot.id, { ...frozenPolicySnapshot, status: 'requires_replan', fixedPointStatus: 'delta_found' })
    assert.equal(service.getProjectPlanningV3(project.id).planHealth.approvable, false)
    assert.equal(service.getProjectPlanningV3(project.id).planHealth.topIssues.some((issue) => issue.code === 'repository-policy-stale'), true)
    await assert.rejects(() => service.approvePlanningV3(project.id, { planSnapshotId: snapshot.id, planDigest: snapshot.planHash, projectRevision: settled.revision, accessGrantSnapshotId: snapshot.accessGrantSnapshotId, accessGrantDigest: snapshot.accessGrantDigest, approverId: 'acceptance-owner', idempotencyKey: 'reject-stale-repository-policy' }), (error) => error.code === 'plan-approval-stale')
    await store.planningPolicySnapshots.put(frozenPolicySnapshot.id, frozenPolicySnapshot)
    const frozenPolicyFulfillment = structuredClone([...store.policyFulfillments.records.values()][0])
    await store.policyFulfillments.put(frozenPolicyFulfillment.id, { ...frozenPolicyFulfillment, subjectMappings: undefined })
    await assert.rejects(() => service.approvePlanningV3(project.id, { planSnapshotId: snapshot.id, planDigest: snapshot.planHash, projectRevision: settled.revision, accessGrantSnapshotId: snapshot.accessGrantSnapshotId, accessGrantDigest: snapshot.accessGrantDigest, approverId: 'acceptance-owner', idempotencyKey: 'reject-corrupt-policy-fulfillment' }), (error) => error.code === 'plan-approval-stale')
    await store.policyFulfillments.put(frozenPolicyFulfillment.id, frozenPolicyFulfillment)
    const frozenPolicyConstraint = structuredClone(store.policyConstraintsV3.get(frozenPolicySnapshot.constraintIds[0]))
    const { id: _constraintId, constraintDigest: _constraintDigest, ...constraintCore } = frozenPolicyConstraint
    const changedConstraintCore = { ...constraintCore, statement: `${constraintCore.statement} Changed after Plan Review.` }
    const changedPolicyConstraint = { id: frozenPolicyConstraint.id, ...changedConstraintCore, constraintDigest: digestObject(changedConstraintCore) }
    const { id: _policyId, policyDigest: _policyDigest, createdAt: _policyCreatedAt, ...policyCore } = frozenPolicySnapshot
    const changedPolicyDigest = digestObject({ ...policyCore, constraints: frozenPolicySnapshot.constraintIds.map((id) => id === changedPolicyConstraint.id ? changedPolicyConstraint.constraintDigest : store.policyConstraintsV3.get(id).constraintDigest) })
    await store.policyConstraintsV3.put(changedPolicyConstraint.id, changedPolicyConstraint)
    await store.planningPolicySnapshots.put(frozenPolicySnapshot.id, { ...frozenPolicySnapshot, policyDigest: changedPolicyDigest })
    await store.planningOperations.put(committedOperation.id, { ...committedOperation, policyDigest: changedPolicyDigest })
    await store.planSnapshots.put(snapshot.id, { ...snapshot, policyDigest: changedPolicyDigest })
    assert.equal(service.getProjectPlanningV3(project.id).planHealth.approvable, false)
    assert.equal(service.getProjectPlanningV3(project.id).planHealth.topIssues.some((issue) => issue.code === 'planning-review-stale'), true)
    assert.equal(service.getProjectPlanningV3(project.id).planHealth.topIssues.some((issue) => issue.code === 'repository-policy-stale'), false)
    await assert.rejects(() => service.approvePlanningV3(project.id, { planSnapshotId: snapshot.id, planDigest: snapshot.planHash, projectRevision: settled.revision, accessGrantSnapshotId: snapshot.accessGrantSnapshotId, accessGrantDigest: snapshot.accessGrantDigest, approverId: 'acceptance-owner', idempotencyKey: 'reject-policy-content-review-stale' }), (error) => error.code === 'planning-review-stale')
    await store.policyConstraintsV3.put(frozenPolicyConstraint.id, frozenPolicyConstraint)
    await store.planningPolicySnapshots.put(frozenPolicySnapshot.id, frozenPolicySnapshot)
    await store.planningOperations.put(committedOperation.id, committedOperation)
    await store.planSnapshots.put(snapshot.id, snapshot)
    await store.planningOperations.put(committedOperation.id, { ...committedOperation, convergenceCarryValidationDigest: 'f'.repeat(64) })
    assert.equal(service.getProjectPlanningV3(project.id).planHealth.approvable, false)
    assert.equal(service.getProjectPlanningV3(project.id).planHealth.topIssues.some((issue) => issue.code === 'carry-validation-stale'), true)
    await assert.rejects(() => service.approvePlanningV3(project.id, { planSnapshotId: snapshot.id, planDigest: snapshot.planHash, projectRevision: settled.revision, accessGrantSnapshotId: snapshot.accessGrantSnapshotId, accessGrantDigest: snapshot.accessGrantDigest, approverId: 'acceptance-owner', idempotencyKey: 'reject-stale-carry-validation' }), (error) => error.code === 'plan-approval-stale')
    await store.planningOperations.put(committedOperation.id, committedOperation)
    const frozenSourceManifest = structuredClone(sourceManifest)
    await store.requirementSourceManifests.put(frozenSourceManifest.id, { ...frozenSourceManifest, requiredAnchorCount: frozenSourceManifest.requiredAnchorCount + 1 })
    assert.equal(service.getProjectPlanningV3(project.id).planHealth.approvable, false)
    await assert.rejects(() => service.approvePlanningV3(project.id, { planSnapshotId: snapshot.id, planDigest: snapshot.planHash, projectRevision: settled.revision, accessGrantSnapshotId: snapshot.accessGrantSnapshotId, accessGrantDigest: snapshot.accessGrantDigest, approverId: 'acceptance-owner', idempotencyKey: 'reject-corrupt-source-manifest' }), (error) => error.code === 'planning-review-stale')
    await store.requirementSourceManifests.put(frozenSourceManifest.id, frozenSourceManifest)
    const frozenRequirementReview = structuredClone(planningBeforeApproval.requirementReview)
    await store.planningReviewsV3.put(frozenRequirementReview.id, { ...frozenRequirementReview, status: 'blocked' })
    assert.equal(service.getProjectPlanningV3(project.id).planHealth.approvable, false)
    assert.equal(service.getProjectPlanningV3(project.id).planHealth.topIssues[0].code, 'planning-review-stale')
    await assert.rejects(() => service.approvePlanningV3(project.id, { planSnapshotId: snapshot.id, planDigest: snapshot.planHash, projectRevision: settled.revision, accessGrantSnapshotId: snapshot.accessGrantSnapshotId, accessGrantDigest: snapshot.accessGrantDigest, approverId: 'acceptance-owner', idempotencyKey: 'reject-stale-requirement-review' }), (error) => error.code === 'planning-review-stale')
    await store.planningReviewsV3.put(frozenRequirementReview.id, frozenRequirementReview)
    const frozenCoveragePolicy = structuredClone(planningBeforeApproval.scenarioCoveragePolicies[0])
    await store.acceptanceScenarioCoveragePolicies.put(frozenCoveragePolicy.id, { ...frozenCoveragePolicy, categories: frozenCoveragePolicy.categories.map((item, index) => index === 0 ? { ...item, reasonCode: 'tampered-without-new-digest' } : item) })
    assert.equal(service.getProjectPlanningV3(project.id).planHealth.approvable, false)
    await assert.rejects(() => service.approvePlanningV3(project.id, { planSnapshotId: snapshot.id, planDigest: snapshot.planHash, projectRevision: settled.revision, accessGrantSnapshotId: snapshot.accessGrantSnapshotId, accessGrantDigest: snapshot.accessGrantDigest, approverId: 'acceptance-owner', idempotencyKey: 'reject-corrupt-scenario-policy' }), (error) => error.code === 'scenario-coverage-stale')
    await store.acceptanceScenarioCoveragePolicies.put(frozenCoveragePolicy.id, frozenCoveragePolicy)
    const frozenScenarioReview = structuredClone(planningBeforeApproval.scenarioCoverageReview)
    await store.scenarioCoverageReviews.put(frozenScenarioReview.id, { ...frozenScenarioReview, status: 'blocked' })
    assert.equal(service.getProjectPlanningV3(project.id).planHealth.approvable, false)
    assert.equal(service.getProjectPlanningV3(project.id).planHealth.topIssues[0].code, 'scenario-coverage-review-stale')
    await assert.rejects(() => service.approvePlanningV3(project.id, { planSnapshotId: snapshot.id, planDigest: snapshot.planHash, projectRevision: settled.revision, accessGrantSnapshotId: snapshot.accessGrantSnapshotId, accessGrantDigest: snapshot.accessGrantDigest, approverId: 'acceptance-owner', idempotencyKey: 'reject-stale-scenario-review' }), (error) => error.code === 'scenario-coverage-review-stale')
    await store.scenarioCoverageReviews.put(frozenScenarioReview.id, frozenScenarioReview)
    const frozenBindingReview = structuredClone(planningBeforeApproval.bindingReview)
    await store.planningReviewsV3.put(frozenBindingReview.id, { ...frozenBindingReview, status: 'blocked' })
    assert.equal(service.getProjectPlanningV3(project.id).planHealth.approvable, false)
    assert.equal(service.getProjectPlanningV3(project.id).planHealth.topIssues[0].code, 'planning-review-stale')
    await assert.rejects(() => service.approvePlanningV3(project.id, { planSnapshotId: snapshot.id, planDigest: snapshot.planHash, projectRevision: settled.revision, accessGrantSnapshotId: snapshot.accessGrantSnapshotId, accessGrantDigest: snapshot.accessGrantDigest, approverId: 'acceptance-owner', idempotencyKey: 'reject-stale-binding-review' }), (error) => error.code === 'planning-review-stale')
    await store.planningReviewsV3.put(frozenBindingReview.id, frozenBindingReview)
    const frozenPlanReview = structuredClone(planningBeforeApproval.planReview)
    await store.planningReviewsV3.put(frozenPlanReview.id, { ...frozenPlanReview, findings: [{ code: 'tampered-plan-review', severity: 'blocking', subjectType: 'task', subjectId: 'TASK-IMPLEMENT', evidenceIds: [], message: 'Tampered after review.', repairOwner: 'plan', restartStage: 'plan_review' }] })
    assert.equal(service.getProjectPlanningV3(project.id).planHealth.approvable, false)
    await assert.rejects(() => service.approvePlanningV3(project.id, { planSnapshotId: snapshot.id, planDigest: snapshot.planHash, projectRevision: settled.revision, accessGrantSnapshotId: snapshot.accessGrantSnapshotId, accessGrantDigest: snapshot.accessGrantDigest, approverId: 'acceptance-owner', idempotencyKey: 'reject-stale-plan-review' }), (error) => error.code === 'planning-review-stale')
    await store.planningReviewsV3.put(frozenPlanReview.id, frozenPlanReview)
    const frozenPlanManifest = structuredClone(store.planningPromptReferenceManifests.get(committedOperation.promptReferenceManifestId))
    await store.planningPromptReferenceManifests.put(frozenPlanManifest.id, { ...frozenPlanManifest, references: frozenPlanManifest.references.map((item, index) => index === 0 ? { ...item, artifactId: 'tampered-artifact' } : item) })
    assert.equal(service.getProjectPlanningV3(project.id).planHealth.approvable, false)
    await assert.rejects(() => service.approvePlanningV3(project.id, { planSnapshotId: snapshot.id, planDigest: snapshot.planHash, projectRevision: settled.revision, accessGrantSnapshotId: snapshot.accessGrantSnapshotId, accessGrantDigest: snapshot.accessGrantDigest, approverId: 'acceptance-owner', idempotencyKey: 'reject-stale-plan-manifest' }), (error) => error.code === 'planning-review-stale')
    await store.planningPromptReferenceManifests.put(frozenPlanManifest.id, frozenPlanManifest)
    const originalTargetRef = planningBeforeApproval.canonicalTarget.targetRef
    const originalBranch = originalTargetRef.slice('refs/heads/'.length)
    await execFileAsync('git', ['branch', 'alternate-canonical-target'], { cwd: repository })
    await execFileAsync('git', ['switch', 'alternate-canonical-target'], { cwd: repository })
    await assert.rejects(() => service.approvePlanningV3(project.id, { planSnapshotId: snapshot.id, planDigest: snapshot.planHash, projectRevision: settled.revision, accessGrantSnapshotId: snapshot.accessGrantSnapshotId, accessGrantDigest: snapshot.accessGrantDigest, approverId: 'acceptance-owner', idempotencyKey: 'reject-stale-canonical-target' }), (error) => error.code === 'planning-snapshot-stale')
    await execFileAsync('git', ['switch', originalBranch], { cwd: repository })
    const approval = await service.approvePlanningV3(project.id, { planSnapshotId: snapshot.id, planDigest: snapshot.planHash, projectRevision: settled.revision, accessGrantSnapshotId: snapshot.accessGrantSnapshotId, accessGrantDigest: snapshot.accessGrantDigest, approverId: 'acceptance-owner', idempotencyKey: 'approve-v3-candidate' })
    assert.equal(approval.planSnapshotId, snapshot.id)
    assert.equal(approval.convergenceCarryValidationDigest, snapshot.convergenceCarryValidationDigest)
    assert.equal(store.projects.get(project.id).status, 'approved')
    assert.equal(store.taskRuns.size, taskRunsBefore)
    const planningAfterApproval = service.getProjectPlanningV3(project.id)
    assert.equal(planningAfterApproval.planHealth.approvable, false)
    assert.deepEqual(planningAfterApproval.actions, ['dispatch_runnable_frontier'])
    assert.equal(planningAfterApproval.approval.id, approval.id)
    assert.deepEqual(await service.approvePlanningV3(project.id, { planSnapshotId: snapshot.id, planDigest: snapshot.planHash, projectRevision: settled.revision, accessGrantSnapshotId: snapshot.accessGrantSnapshotId, accessGrantDigest: snapshot.accessGrantDigest, approverId: 'acceptance-owner', idempotencyKey: 'approve-v3-candidate' }), approval)
    await assert.rejects(() => service.approvePlanningV3(project.id, { planSnapshotId: snapshot.id, planDigest: snapshot.planHash, projectRevision: settled.revision, accessGrantSnapshotId: snapshot.accessGrantSnapshotId, accessGrantDigest: snapshot.accessGrantDigest, approverId: 'different-owner', idempotencyKey: 'approve-v3-candidate' }), (error) => error.code === 'plan-approval-idempotency-conflict')
    await assert.rejects(() => service.approveAndStartExecution(project.id, { revision: settled.revision, planHash: snapshot.planHash, actor: 'legacy-ui' }), (error) => error.code === 'v3-approval-dispatch-separated')

    const [implementation, verification] = store.projectTasks(store.projects.get(project.id))
    await store.planningMetricPolicies.put(frozenMetricPolicy.id, { ...frozenMetricPolicy, approvalReason: 'tampered after approval' })
    const beforeMetricPolicyDispatch = store.taskRuns.size
    await assert.rejects(() => service.dispatchPlanningV3(project.id, { approvalId: approval.id, expectedProjectRevision: settled.revision, taskIds: [implementation.id, verification.id], idempotencyKey: 'reject-v3-corrupt-metric-policy' }), (error) => error.code === 'execution-dispatch-stale')
    assert.equal(store.taskRuns.size, beforeMetricPolicyDispatch)
    assert.equal(store.executionDispatches.get(`execution-dispatch:${project.id}:reject-v3-corrupt-metric-policy`), undefined)
    await store.planningMetricPolicies.put(frozenMetricPolicy.id, frozenMetricPolicy)
    const sourceProfileId = snapshot.sourceProfileIds[0]
    const frozenSourceProfile = structuredClone(store.requirementSourceProfiles.get(sourceProfileId))
    await store.requirementSourceProfiles.put(sourceProfileId, { ...frozenSourceProfile, parsedBlocks: Math.max(0, frozenSourceProfile.parsedBlocks - 1) })
    const beforeStaleSourceDispatch = store.taskRuns.size
    await assert.rejects(() => service.dispatchPlanningV3(project.id, { approvalId: approval.id, expectedProjectRevision: settled.revision, taskIds: [implementation.id, verification.id], idempotencyKey: 'reject-v3-stale-source-profile' }), (error) => error.code === 'execution-dispatch-stale')
    assert.equal(store.taskRuns.size, beforeStaleSourceDispatch)
    await store.requirementSourceProfiles.put(sourceProfileId, frozenSourceProfile)
    await store.planningReviewsV3.put(frozenPlanReview.id, { ...frozenPlanReview, status: 'blocked' })
    const beforeStaleReviewDispatch = store.taskRuns.size
    await assert.rejects(() => service.dispatchPlanningV3(project.id, { approvalId: approval.id, expectedProjectRevision: settled.revision, taskIds: [implementation.id, verification.id], idempotencyKey: 'reject-v3-stale-plan-review' }), (error) => error.code === 'execution-dispatch-stale')
    assert.equal(store.taskRuns.size, beforeStaleReviewDispatch)
    assert.equal(store.executionDispatches.get(`execution-dispatch:${project.id}:reject-v3-stale-plan-review`), undefined)
    await store.planningReviewsV3.put(frozenPlanReview.id, frozenPlanReview)
    const occupiedTaskRun = { id: 'occupied-v3-capacity', projectId: 'other-project', agentId: implementation.agentId, status: 'running', trigger: 'system', attempt: 1, cwd: repository, createdAt: now }
    await store.taskRuns.put(occupiedTaskRun.id, occupiedTaskRun)
    const beforeWaitingDispatch = store.taskRuns.size
    const waiting = await service.dispatchPlanningV3(project.id, { approvalId: approval.id, expectedProjectRevision: settled.revision, taskIds: [implementation.id, verification.id], idempotencyKey: 'wait-for-v3-capacity' })
    assert.equal(waiting.dispatch.outcome, 'waiting')
    assert.equal(waiting.run, undefined)
    assert.equal(store.taskRuns.size, beforeWaitingDispatch)
    assert.equal(waiting.dispatch.taskResults.find((result) => result.taskId === implementation.id).outcome, 'waiting_capacity')
    const waitingReplay = await service.dispatchPlanningV3(project.id, { approvalId: approval.id, expectedProjectRevision: settled.revision, taskIds: [implementation.id, verification.id], idempotencyKey: 'wait-for-v3-capacity' })
    assert.deepEqual(waitingReplay.dispatch, waiting.dispatch)
    await store.taskRuns.delete(occupiedTaskRun.id)

    await writeFile(join(repository, 'src', 'records.ts'), 'export const records = new Map()\nexport const drift = true\n')
    const beforeStaleDispatch = store.taskRuns.size
    await assert.rejects(() => service.dispatchPlanningV3(project.id, { approvalId: approval.id, expectedProjectRevision: settled.revision, taskIds: [implementation.id], idempotencyKey: 'reject-v3-repository-drift' }), (error) => error.code === 'execution-dispatch-repository-drift')
    assert.equal(store.taskRuns.size, beforeStaleDispatch)
    assert.equal(store.executionDispatches.get(`execution-dispatch:${project.id}:reject-v3-repository-drift`), undefined)
    assert.equal([...store.decisions.records.values()].some((decision) => decision.metadata.escalationTrigger === 'repository-drift' && decision.metadata.impactedPaths.includes('src/records.ts')), true)
    await writeFile(join(repository, 'src', 'records.ts'), 'export const records = new Map()\n')

    const conflictingTaskRun = { id: 'conflicting-v3-task-run', projectId: project.id, taskId: implementation.id, agentId: implementation.agentId, status: 'running', trigger: 'system', attempt: 1, cwd: repository, createdAt: now }
    await store.taskRuns.put(conflictingTaskRun.id, conflictingTaskRun)
    const beforeConflictingDispatch = store.taskRuns.size
    await assert.rejects(() => service.dispatchPlanningV3(project.id, { approvalId: approval.id, expectedProjectRevision: settled.revision, taskIds: [implementation.id, verification.id], idempotencyKey: 'reject-v3-active-conflict' }), (error) => error.code === 'task-run-active-conflict')
    assert.equal(store.taskRuns.size, beforeConflictingDispatch)
    assert.equal(store.executionDispatches.get(`execution-dispatch:${project.id}:reject-v3-active-conflict`), undefined)
    await store.taskRuns.delete(conflictingTaskRun.id)

    const putTask = store.tasks.put.bind(store.tasks)
    let dispatchWriteFailed = false
    store.tasks.put = async (id, value) => {
      if (!dispatchWriteFailed && value.status === 'queued') {
        dispatchWriteFailed = true
        throw new Error('dispatch task persistence failed')
      }
      return putTask(id, value)
    }
    await assert.rejects(() => service.dispatchPlanningV3(project.id, { approvalId: approval.id, expectedProjectRevision: settled.revision, taskIds: [implementation.id, verification.id], idempotencyKey: 'rollback-v3-dispatch' }), /dispatch task persistence failed/)
    store.tasks.put = putTask
    assert.equal(store.executionDispatches.get(`execution-dispatch:${project.id}:rollback-v3-dispatch`), undefined)
    assert.equal([...store.runs.records.values()].filter((run) => run.projectId === project.id).length, 0)
    assert.equal([...store.taskRuns.records.values()].filter((taskRun) => taskRun.projectId === project.id).length, 0)
    assert.equal(store.projects.get(project.id).status, 'approved')
    assert.equal(store.tasks.get(implementation.id).status, 'draft')

    const firstDispatch = await service.dispatchPlanningV3(project.id, { approvalId: approval.id, expectedProjectRevision: settled.revision, taskIds: [implementation.id, verification.id], idempotencyKey: 'dispatch-v3-implementation' })
    assert.equal(firstDispatch.dispatch.outcome, 'partially_started')
    assert.equal(firstDispatch.dispatch.createdTaskRunIds.length, 1)
    assert.equal(firstDispatch.dispatch.taskResults.find((result) => result.taskId === verification.id).outcome, 'waiting_dependency')
    const afterImplementation = await waitForProject(store, project.id, (value) => value.status !== 'running', 'First V3 frontier did not settle')
    assert.equal(afterImplementation.status, 'approved')
    assert.equal(store.tasks.get(implementation.id).status, 'completed')
    assert.equal(store.tasks.get(verification.id).status, 'draft')
    assert.equal([...store.taskRuns.records.values()].filter((taskRun) => taskRun.projectId === project.id && taskRun.taskId === implementation.id).length, 1)
    assert.equal([...store.projectReviews.records.values()].filter((review) => review.projectId === project.id).length, 0)

    await writeFile(join(repository, 'src', 'records.ts'), 'export const records = new Map()\nexport const plannedOutput = true\n')
    const { stdout: plannedDigestOutput } = await execFileAsync('git', ['hash-object', '--no-filters', '--', 'src/records.ts'], { cwd: repository })
    const completedImplementationRun = [...store.taskRuns.records.values()].find((taskRun) => taskRun.projectId === project.id && taskRun.taskId === implementation.id && taskRun.status === 'completed')
    await store.taskRuns.put(completedImplementationRun.id, { ...completedImplementationRun, changedFiles: ['src/records.ts'], changedFileDigests: [{ path: 'src/records.ts', digest: plannedDigestOutput.trim() }] })
    await writeFile(join(repository, 'planning-notes.md'), 'Unrelated local notes.\n')
    const secondDispatch = await service.dispatchPlanningV3(project.id, { approvalId: approval.id, expectedProjectRevision: settled.revision, taskIds: [verification.id], idempotencyKey: 'dispatch-v3-verification' })
    assert.equal(secondDispatch.dispatch.outcome, 'started')
    assert.equal(secondDispatch.dispatch.createdTaskRunIds.length, 1)
    const impactAudit = [...store.activity.records.values()].find((activity) => activity.type === 'execution.repository_drift_assessed')
    assert.deepEqual(impactAudit.metadata.plannedPaths, ['src/records.ts'])
    assert.deepEqual(impactAudit.metadata.externalPaths, ['planning-notes.md'])
    assert.equal(impactAudit.metadata.verdict, 'unrelated_drift')
    const { stdout: canonicalRecords } = await execFileAsync('git', ['show', 'HEAD:src/records.ts'], { cwd: repository })
    await writeFile(join(repository, 'src', 'records.ts'), canonicalRecords)
    await rm(join(repository, 'planning-notes.md'))
    const completed = await waitForProject(store, project.id, (value) => value.status !== 'running', 'Second V3 frontier did not settle')
    assert.equal(completed.status, 'completed')
    assert.equal(store.tasks.get(verification.id).status, 'completed')
    assert.equal([...store.taskRuns.records.values()].filter((taskRun) => taskRun.projectId === project.id).length, 2)
    const canary = service.exportPlanningReleaseCanaryV3(project.id, { releaseVersion: '1.7.0' })
    assert.equal(canary.executionDispatches.length, 2)
    assert.equal(canary.taskRunCount, 2)
    assert.equal(canary.outcome, 'converged')
    assert.equal(JSON.stringify(canary).includes(project.prd), false)
    assert.equal(JSON.stringify(canary).includes(repository), false)
    const completedProject = structuredClone(store.projects.get(project.id))
    await store.projects.put(project.id, { ...completedProject, currentDeliveryConvergenceReviewId: undefined })
    assert.throws(() => service.exportPlanningReleaseCanaryV3(project.id, { releaseVersion: '1.7.0' }), (error) => error.code === 'planning-canary-convergence-incomplete')
    await store.projects.put(project.id, completedProject)
    const frozenImplementationTask = structuredClone(store.tasks.get(implementation.id))
    const frozenVerificationTask = structuredClone(store.tasks.get(verification.id))
    await store.tasks.put(implementation.id, { ...frozenImplementationTask, acceptanceIds: [] })
    await store.tasks.put(verification.id, { ...frozenVerificationTask, acceptanceIds: [] })
    assert.throws(() => service.exportPlanningReleaseCanaryV3(project.id, { releaseVersion: '1.7.0' }), (error) => error.code === 'planning-canary-coverage-incomplete')
    await store.tasks.put(implementation.id, frozenImplementationTask)
    await store.tasks.put(verification.id, frozenVerificationTask)
    const finalVerificationRun = [...store.taskRuns.records.values()].find((run) => run.projectId === project.id && run.taskId === verification.id)
    await store.taskRuns.put(finalVerificationRun.id, { ...finalVerificationRun, projectId: 'foreign-project' })
    assert.throws(() => service.exportPlanningReleaseCanaryV3(project.id, { releaseVersion: '1.7.0' }), (error) => error.code === 'planning-canary-task-runs-incomplete')
    await store.taskRuns.put(finalVerificationRun.id, finalVerificationRun)
    const integration = store.deliveryIntegrationSnapshots.get(completedProject.currentDeliveryIntegrationSnapshotId)
    const inclusion = store.integrationInclusionEvidence.get(integration.outputs[0].inclusionEvidenceIds[0])
    await store.integrationInclusionEvidence.put(inclusion.id, { ...inclusion, result: 'failed' })
    assert.throws(() => service.exportPlanningReleaseCanaryV3(project.id, { releaseVersion: '1.7.0' }), (error) => error.code === 'planning-canary-integration-evidence-stale')
    await store.integrationInclusionEvidence.put(inclusion.id, inclusion)
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('Planning V3 enables unknown-stage compatibility work only when a frozen Requirement explicitly requires it', async () => {
  const root = await mkdtemp(join(tmpdir(), 'po-v3-stage-identifier-contract-'))
  try {
    const repository = await createPlanningV3Fixture(root)
    const store = memoryStore()
    const observation = {
      requirementAnalysisResponse: ({ generated }) => ({
        ...generated,
        requirements: generated.requirements.map((requirement, index) => index === 0 ? {
          ...requirement,
          statement: 'Persisted unknown stage identifiers must remain readable.',
          acceptanceCriteria: requirement.acceptanceCriteria.map((criterion) => ({ ...criterion, statement: 'A future stage identifier value remains visible and sorts after known stages.' })),
        } : requirement),
      }),
    }
    const service = new OrchestratorService(agentContext('unused', observation), store, undefined, undefined, { planningContractMode: 'v3-candidate' })
    const project = await service.createProjectFromRequest({ mode: 'empty', name: 'Forward-compatible stages', cwd: repository, prd: '# 功能\n## 验收标准\n1. 未知阶段标识必须可读取并排在已知阶段之后' })

    await service.startDecomposition(project.id)
    await waitForPlanning(store, project.id)

    const bindingPrompt = observation.prompts.find((prompt) => prompt.includes('Repository Binding V3 JSON object'))
    const scenarioPrompt = observation.prompts.find((prompt) => prompt.includes('Acceptance Scenario V3 JSON object'))
    const bindingReviewPrompt = observation.prompts.find((prompt) => prompt.includes('binding Planning Review V3 JSON object'))
    assert.match(scenarioPrompt, /bindingStageIdentifierCompatibilityRequired=true/)
    assert.match(scenarioPrompt, /A frozen Requirement or Acceptance explicitly requires unknown or future stage-identifier compatibility/)
    assert.match(scenarioPrompt, /concrete unknown persisted identifier loaded through storage startup\/read/)
    assert.match(scenarioPrompt, /exact original value to remain visible/)
    assert.match(scenarioPrompt, /repeated reads to return the same stable order/)
    assert.match(bindingPrompt, /persisted unknown or future stage identifiers to remain readable and sort stably after known stages/)
    assert.match(bindingPrompt, /give the persisted PlanningStageAttempt stage identifier its own forward-compatible validation contract/)
    assert.match(bindingReviewPrompt, /bindingStageIdentifierCompatibilityRequired=true/)
    assert.match(bindingReviewPrompt, /separates the forward-compatible PlanningStageAttempt stage identifier from the closed PlanningOperation and repair-restart stage contract/)
    assert.doesNotMatch(bindingReviewPrompt, /special unknown-stage compatibility rule is inapplicable/)
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('Planning V3 gives actionable UI harness feedback and accepts a corrected browser verifier without weakening coverage', async () => {
  const root = await mkdtemp(join(tmpdir(), 'po-v3-browser-plan-correction-'))
  try {
    const repository = await createPlanningV3Fixture(root)
    const store = memoryStore()
    const browserHarness = {
      kind: 'browser',
      runner: 'Playwright from package.json.',
      applicationStart: 'Start the web application and wait for the health endpoint.',
      fixtureMutation: 'create_and_cleanup',
      fixtureSetup: 'Create one persisted operation through the project API and capture its id.',
      navigation: 'Open the project detail route using the captured project id.',
      asyncWait: 'Wait for the planning response and matching stage rows in the DOM.',
      persistedFactCorrelation: 'Compare operation, stage, and round keys across storage, API, and DOM.',
      teardown: 'Close the browser and server process and remove the temporary store.',
    }
    const observation = {
      scenarioResponse: ({ generated }) => ({
        ...generated,
        scenarios: generated.scenarios.map((scenario) => ({
          ...scenario,
          trigger: 'Use a real browser to open the project detail route and interact with the persisted stage view.',
          observableAt: [{ kind: 'ui', description: 'The project detail page renders the persisted stage fact.' }],
        })),
      }),
      plannerV3Response: ({ generated, call }) => {
        if (call === 1) {
          const missingBrowserCoverage = structuredClone(generated)
          for (const task of missingBrowserCoverage.tasks.filter((candidate) => candidate.relationship === 'verification')) delete task.contextPack.verificationHarness
          return missingBrowserCoverage
        }
        const corrected = structuredClone(generated)
        corrected.tasks.find((task) => task.relationship === 'verification').contextPack.verificationHarness = browserHarness
        return corrected
      },
    }
    const service = new OrchestratorService(agentContext('unused', observation), store, undefined, undefined, { planningContractMode: 'v3-candidate' })
    const project = await service.createProjectFromRequest({ mode: 'empty', name: 'Browser correction', cwd: repository, prd: '# 功能\n## 验收标准\n1. 项目详情展示持久化阶段事实' })
    const implementer = await service.createAgent({ name: 'Browser Implementer', role: 'Software Engineer', persona: 'Implement.' })
    const verifier = await service.createAgent({ name: 'Browser Verifier', role: 'Test Engineer', persona: 'Verify.' })
    await service.addProjectAgents(project.id, { members: [
      { agentId: implementer.id, projectRole: 'Software Engineer', deliveryRoles: ['implementer'], autoAssignable: true },
      { agentId: verifier.id, projectRole: 'Test Engineer', deliveryRoles: ['verifier'], autoAssignable: true },
    ] })
    await addTrustedCapabilities(store, project.id, implementer.id, ['language.typescript', 'testing.automation'])
    await addTrustedCapabilities(store, project.id, verifier.id, ['build.process-orchestration', 'language.typescript', 'testing.automation', 'testing.browser-e2e', 'testing.verification'])

    await service.startDecomposition(project.id)
    const settled = await waitForPlanning(store, project.id)

    assert.equal(settled.status, 'awaiting_approval', settled.lastError)
    assert.equal(observation.plannerV3Calls, 2)
    const correctionPrompt = observation.prompts.find((prompt) => prompt.includes('Deterministic correction: every listed UI Scenario needs at least one verification Task'))
    assert.match(correctionPrompt, /separate source-required bundle, API, or service verification Task may map the same UI Scenario without a harness only as supporting coverage/)
    assert.match(correctionPrompt, /do not claim that the supporting Task alone closes the UI chain/)
    assert.match(correctionPrompt, /without weakening or dropping aggregate Scenario coverage/)
    const operation = [...store.planningOperations.records.values()].at(-1)
    assert.equal(operation.status, 'committed')
    assert.equal([...store.taskPreflightsV3.records.values()].every((preflight) => preflight.serviceVerdict === 'accepted'), true)
    const proposal = store.planningProposalPacks.get(operation.proposalPackId)
    assert.equal(proposal.plan.tasks.find((task) => task.relationship === 'verification').contextPack.verificationHarness.kind, 'browser')
    assert.equal(store.projectTasks(settled).find((task) => task.relationship === 'verification').taskContextPackDigest.length, 64)
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('Planning V3 gives actionable overlap feedback and accepts a conflict-controlled task plan', async () => {
  const root = await mkdtemp(join(tmpdir(), 'po-v3-overlap-plan-correction-'))
  try {
    const repository = await createPlanningV3Fixture(root)
    const store = memoryStore()
    const observation = {
      plannerV3Response: ({ generated, call }) => {
        if (call !== 1) return generated
        const overlapping = structuredClone(generated)
        const verifier = overlapping.tasks.find((task) => task.relationship === 'verification')
        verifier.changeContract.conflictKeys = ['core-verification']
        overlapping.tasks.push({
          ...structuredClone(verifier),
          key: 'TASK-BOUNDARY-VERIFY',
          title: 'Verify the boundary contract separately',
          changeContract: { ...structuredClone(verifier.changeContract), conflictKeys: ['boundary-verification'] },
        })
        return overlapping
      },
    }
    const service = new OrchestratorService(agentContext('unused', observation), store, undefined, undefined, { planningContractMode: 'v3-candidate' })
    const project = await service.createProjectFromRequest({ mode: 'empty', name: 'Overlap correction', cwd: repository, prd: '# Feature\n## Acceptance criteria\n1. Persist and return the required record' })
    const implementer = await service.createAgent({ name: 'Overlap Implementer', role: 'Software Engineer', persona: 'Implement.' })
    const verifier = await service.createAgent({ name: 'Overlap Verifier', role: 'Test Engineer', persona: 'Verify.' })
    await service.addProjectAgents(project.id, { members: [
      { agentId: implementer.id, projectRole: 'Software Engineer', deliveryRoles: ['implementer'], autoAssignable: true },
      { agentId: verifier.id, projectRole: 'Test Engineer', deliveryRoles: ['verifier'], autoAssignable: true },
    ] })
    await addTrustedCapabilities(store, project.id, implementer.id, ['language.typescript', 'testing.automation'])
    await addTrustedCapabilities(store, project.id, verifier.id, ['language.typescript', 'testing.automation', 'testing.verification'])

    await service.startDecomposition(project.id)
    const settled = await waitForPlanning(store, project.id)

    assert.equal(settled.status, 'awaiting_approval', settled.lastError)
    assert.equal(observation.plannerV3Calls, 2)
    const correctionPrompt = observation.prompts.find((prompt) => prompt.includes('Deterministic correction: every pair of Tasks whose allowedPathScopes overlap'))
    assert.match(correctionPrompt, /share at least one identical changeContract\.conflictKeys value/)
    assert.match(correctionPrompt, /direct or transitive dependency path that serializes their writes/)
    assert.match(correctionPrompt, /Preserve both Tasks and their coverage unless they are semantically duplicate/)
    const operation = [...store.planningOperations.records.values()].at(-1)
    assert.equal(operation.status, 'committed')
    assert.equal([...store.taskPreflightsV3.records.values()].every((preflight) => preflight.serviceVerdict === 'accepted'), true)
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('Planning V3 gives actionable feedback when a UI Scenario uses a non-browser trigger', async () => {
  const root = await mkdtemp(join(tmpdir(), 'po-v3-ui-trigger-correction-'))
  try {
    const repository = await createPlanningV3Fixture(root)
    const store = memoryStore()
    const observation = {
      scenarioResponse: ({ generated, call }) => {
        if (call !== 1) return generated
        return {
          ...generated,
          scenarios: generated.scenarios.map((scenario, index) => index === 0 ? {
            ...scenario,
            trigger: 'Run the client bundle contract test.',
            observableAt: [{ kind: 'ui', description: 'The project detail page renders the persisted stage rows.' }],
          } : scenario),
        }
      },
    }
    const service = new OrchestratorService(agentContext('unused', observation), store, undefined, undefined, { planningContractMode: 'v3-candidate' })
    const project = await service.createProjectFromRequest({ mode: 'empty', name: 'UI trigger correction', cwd: repository, prd: '# Feature\n## Acceptance criteria\n1. Persist and return the required record' })
    const implementer = await service.createAgent({ name: 'UI Trigger Implementer', role: 'Software Engineer', persona: 'Implement.' })
    const verifier = await service.createAgent({ name: 'UI Trigger Verifier', role: 'Test Engineer', persona: 'Verify.' })
    await service.addProjectAgents(project.id, { members: [
      { agentId: implementer.id, projectRole: 'Software Engineer', deliveryRoles: ['implementer'], autoAssignable: true },
      { agentId: verifier.id, projectRole: 'Test Engineer', deliveryRoles: ['verifier'], autoAssignable: true },
    ] })
    await addTrustedCapabilities(store, project.id, implementer.id, ['language.typescript', 'testing.automation'])
    await addTrustedCapabilities(store, project.id, verifier.id, ['language.typescript', 'testing.automation', 'testing.verification'])

    await service.startDecomposition(project.id)
    const settled = await waitForPlanning(store, project.id)

    assert.equal(settled.status, 'awaiting_approval', settled.lastError)
    assert.equal(observation.scenarioCalls, 2)
    const correctionPrompt = observation.scenarioPrompts.find((prompt) => prompt.includes('Deterministic correction: every Scenario with observableAt.kind ui'))
    assert.match(correctionPrompt, /actual browser or user interaction as its trigger/)
    assert.match(correctionPrompt, /bundle, source, unit, service, or API test command is not a UI trigger/)
    assert.match(correctionPrompt, /Preserve ui when the frozen Acceptance requires user-visible behavior/)
    assert.equal([...store.planningOperations.records.values()].at(-1).status, 'committed')
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('Planning V3 scenario policy does not invent dependency failure or recovery from displayed status fields', async () => {
  const root = await mkdtemp(join(tmpdir(), 'po-v3-status-scenarios-'))
  try {
    const repository = await createPlanningV3Fixture(root)
    const store = memoryStore()
    const observation = {
      requirementAnalysisResponse: ({ generated }) => ({
        ...generated,
        requirements: generated.requirements.map((requirement) => ({
          ...requirement,
          acceptanceCriteria: requirement.acceptanceCriteria.map((criterion) => ({ ...criterion, scenario: 'dependency_failure' })),
        })),
      }),
    }
    const service = new OrchestratorService(agentContext('unused', observation), store, undefined, undefined, { planningContractMode: 'v3-candidate' })
    const project = await service.createProjectFromRequest({
      mode: 'empty', name: 'Status projection', cwd: repository,
      prd: '# 阶段状态\n## 验收标准\n1. 列表显示运行中、失败和阻塞状态，并包含 completedAt、durationMs 和 errorCode 字段。',
    })
    const implementer = await service.createAgent({ name: 'Status Implementer', role: 'Software Engineer', persona: 'Implement.' })
    const verifier = await service.createAgent({ name: 'Status Verifier', role: 'Test Engineer', persona: 'Verify.' })
    await service.addProjectAgents(project.id, { members: [
      { agentId: implementer.id, projectRole: 'Software Engineer', deliveryRoles: ['implementer'], autoAssignable: true },
      { agentId: verifier.id, projectRole: 'Test Engineer', deliveryRoles: ['verifier'], autoAssignable: true },
    ] })
    await addTrustedCapabilities(store, project.id, implementer.id, ['language.typescript', 'testing.automation'])
    await addTrustedCapabilities(store, project.id, verifier.id, ['language.typescript', 'testing.automation', 'testing.verification'])

    await service.startDecomposition(project.id)
    const settled = await waitForPlanning(store, project.id)
    assert.equal(settled.status, 'awaiting_approval', settled.lastError)
    const planning = service.getProjectPlanningV3(project.id)
    assert.equal(planning.scenarioCoveragePolicies.length, 1)
    const categoryByName = new Map(planning.scenarioCoveragePolicies[0].categories.map((item) => [item.category, item.applicability]))
    assert.equal(categoryByName.get('happy_path'), 'required')
    assert.equal(categoryByName.get('boundary'), 'required')
    assert.equal(categoryByName.get('dependency_failure'), 'not_applicable')
    assert.equal(categoryByName.get('recovery'), 'not_applicable')
    assert.match(observation.requirementAnalysisPrompts[0], /displayed failed status, generic failure case, or negative outcome is not a dependency failure/)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('Planning V3 StackProfile fails closed for a primary Python support boundary', async () => {
  for (const stack of ['python']) {
    const root = await mkdtemp(join(tmpdir(), `po-v3-unsupported-${stack}-`))
    try {
      const repository = await createPlanningV3Fixture(root)
      await writeFile(join(repository, 'app.py'), 'def save():\n    return True\n')
      await execFileAsync('git', ['add', '.'], { cwd: repository })
      await execFileAsync('git', ['commit', '-m', `test: add unsupported ${stack} stack`], { cwd: repository })
      const store = memoryStore()
      const service = new OrchestratorService(agentContext(), store, undefined, undefined, { planningContractMode: 'v3-candidate' })
      const project = await service.createProjectFromRequest({ mode: 'empty', name: `Unsupported ${stack}`, cwd: repository, prd: '# 功能\n## 验收标准\n1. 保存记录' })

      await service.startDecomposition(project.id)
      const settled = await waitForPlanning(store, project.id)
      const operation = [...store.planningOperations.records.values()].at(-1)
      const profile = [...store.repositoryStackProfiles.records.values()].at(-1)

      assert.equal(settled.status, 'draft')
      assert.equal(settled.currentPlanSnapshotId, undefined)
      assert.equal(store.tasks.size, 0)
      assert.equal(operation.status, 'blocked')
      assert.equal(profile.supportStatus, 'unsupported')
      assert.equal(profile.diagnostics.some((item) => item.code === 'unsupported-stack'), true)
    } finally { await rm(root, { recursive: true, force: true }) }
  }
})

test('Planning V3 repository policy includes an untracked AGENTS.md and creates one fixed-point successor', async () => {
  const root = await mkdtemp(join(tmpdir(), 'po-v3-policy-fixed-point-'))
  try {
    const repository = await createPlanningV3Fixture(root)
    await writeFile(join(repository, 'AGENTS.md'), '# Project rules\n\n- Every change MUST include an automated regression test.\n')
    const store = memoryStore()
    const observation = {}
    const service = new OrchestratorService(agentContext('unused', observation), store, undefined, undefined, { planningContractMode: 'v3-candidate' })
    const project = await service.createProjectFromRequest({ mode: 'empty', name: 'Policy fixed point', cwd: repository, prd: '# 功能\n## 验收标准\n1. 保存记录并可查询' })
    const implementer = await service.createAgent({ name: 'Policy Implementer', role: 'Software Engineer', persona: 'Implement.' })
    const verifier = await service.createAgent({ name: 'Policy Verifier', role: 'Test Engineer', persona: 'Verify.' })
    await service.addProjectAgents(project.id, { members: [
      { agentId: implementer.id, projectRole: 'Software Engineer', deliveryRoles: ['implementer'], autoAssignable: true },
      { agentId: verifier.id, projectRole: 'Test Engineer', deliveryRoles: ['verifier'], autoAssignable: true },
    ] })
    await addTrustedCapabilities(store, project.id, implementer.id, ['language.typescript', 'testing.automation'])
    await addTrustedCapabilities(store, project.id, verifier.id, ['language.typescript', 'testing.automation', 'testing.verification'])

    await service.startDecomposition(project.id)
    const settled = await waitForPlanning(store, project.id)
    const operations = [...store.planningOperations.records.values()].sort((left, right) => left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id))
    assert.equal(operations.length, 2)
    const [predecessor, successor] = operations
    const firstBaseline = store.repositoryPolicyBaselines.get(predecessor.repositoryPolicyBaselineId)
    const firstPolicy = store.planningPolicySnapshots.get(predecessor.policySnapshotId)
    const successorPrecheck = store.sourcePolicyPrechecks.get(successor.sourcePolicyPrecheckId)
    const successorPolicy = store.planningPolicySnapshots.get(successor.policySnapshotId)
    assert.equal(settled.status, 'awaiting_approval', settled.lastError)
    assert.equal(predecessor.status, 'superseded')
    assert.equal(predecessor.stage, 'policy_snapshot')
    assert.equal(firstPolicy.fixedPointStatus, 'delta_found')
    assert.equal(firstPolicy.status, 'requires_replan')
    assert.equal(firstPolicy.diagnostics.some((item) => item.code === 'repository-policy-delta'), true)
    assert.equal(firstBaseline.constraintSeedIds.length, 1)
    assert.equal([...store.policyConstraintsV3.records.values()].some((constraint) => constraint.policySnapshotId === firstPolicy.id && constraint.authority === 'project_agents' && /automated regression test/i.test(constraint.statement)), true)
    assert.equal(successor.predecessorOperationId, predecessor.id)
    assert.equal(successor.status, 'committed')
    assert.equal(successorPrecheck.repositoryPolicyBaselineId, firstBaseline.id)
    assert.equal(successorPrecheck.repositoryPolicyBaselineDigest, firstBaseline.baselineDigest)
    assert.deepEqual(successorPrecheck.inheritedRepositoryConstraintSeedIds, firstBaseline.constraintSeedIds)
    assert.equal(successorPolicy.comparedRepositoryPolicyBaselineId, firstBaseline.id)
    assert.equal(successorPolicy.fixedPointStatus, 'converged')
    assert.equal(successorPolicy.status, 'ready')
    assert.equal(observation.requirementAnalysisCalls, 1)
    assert.equal(observation.requirementReviewCalls, 1)
    const planningView = service.getProjectPlanningV3(project.id)
    assert.equal(planningView.operationLineage.complete, true)
    assert.deepEqual(planningView.operationLineage.entries.map((entry) => entry.operation.id), [successor.id, predecessor.id])
    assert.deepEqual(planningView.operationLineage.entries.map((entry) => entry.repositoryPolicyBaseline?.id), [successor.repositoryPolicyBaselineId, predecessor.repositoryPolicyBaselineId])
    assert.deepEqual(planningView.operationLineage.entries.map((entry) => entry.policy?.id), [successor.policySnapshotId, predecessor.policySnapshotId])

    await service.initialize()
    assert.equal(store.planningOperations.size, 2)
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('Planning V3 serializes concurrent Repository Policy successor commands into one durable operation', async () => {
  const root = await mkdtemp(join(tmpdir(), 'po-v3-policy-successor-race-'))
  try {
    const repository = await createPlanningV3Fixture(root)
    await writeFile(join(repository, 'AGENTS.md'), '# Project rules\n\n- Every change MUST include an automated regression test.\n')
    await execFileAsync('git', ['add', 'AGENTS.md'], { cwd: repository })
    await execFileAsync('git', ['commit', '-m', 'docs: add project policy'], { cwd: repository })
    const store = memoryStore()
    const service = new OrchestratorService(agentContext(), store, undefined, undefined, { planningContractMode: 'v3-candidate' })
    const project = await service.createProjectFromRequest({ mode: 'empty', name: 'Policy successor race', cwd: repository, prd: '# 功能\n## 验收标准\n1. 保存记录并可查询' })
    const implementer = await service.createAgent({ name: 'Race Implementer', role: 'Software Engineer', persona: 'Implement.' })
    const verifier = await service.createAgent({ name: 'Race Verifier', role: 'Test Engineer', persona: 'Verify.' })
    await service.addProjectAgents(project.id, { members: [
      { agentId: implementer.id, projectRole: 'Software Engineer', deliveryRoles: ['implementer'], autoAssignable: true },
      { agentId: verifier.id, projectRole: 'Test Engineer', deliveryRoles: ['verifier'], autoAssignable: true },
    ] })
    await addTrustedCapabilities(store, project.id, implementer.id, ['language.typescript', 'testing.automation'])
    await addTrustedCapabilities(store, project.id, verifier.id, ['language.typescript', 'testing.automation', 'testing.verification'])
    const originalStartSuccessor = service.startRepositoryPolicySuccessorV3.bind(service)
    let captured
    service.startRepositoryPolicySuccessorV3 = async (predecessorId, options) => {
      captured = { predecessorId, options }
      return store.projects.get(project.id)
    }

    await service.startDecomposition(project.id)
    await waitForPlanning(store, project.id)
    assert.ok(captured)
    service.startRepositoryPolicySuccessorV3 = originalStartSuccessor
    const [first, second] = await Promise.all([
      originalStartSuccessor(captured.predecessorId, captured.options),
      originalStartSuccessor(captured.predecessorId, captured.options),
    ])
    assert.equal(first.activeDecompositionDigest, second.activeDecompositionDigest)
    const settled = await waitForPlanning(store, project.id)
    const successors = [...store.planningOperations.records.values()].filter((operation) => operation.predecessorOperationId === captured.predecessorId && operation.requestDigest === captured.options.requestDigest)
    assert.equal(settled.status, 'awaiting_approval', settled.lastError)
    assert.equal(successors.length, 1)
    assert.equal(successors[0].status, 'committed')
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('Planning V3 stops automatic Repository Policy iteration when the successor discovers another delta', async () => {
  const root = await mkdtemp(join(tmpdir(), 'po-v3-policy-nonconvergent-'))
  try {
    const repository = await createPlanningV3Fixture(root)
    const agentsPath = join(repository, 'AGENTS.md')
    await writeFile(agentsPath, '# Project rules\n\n- Every change MUST include an automated regression test.\n')
    await execFileAsync('git', ['add', 'AGENTS.md'], { cwd: repository })
    await execFileAsync('git', ['commit', '-m', 'docs: add initial project policy'], { cwd: repository })
    const store = memoryStore()
    let sourcePolicyPrechecks = 0
    const service = new OrchestratorService(agentContext(), store, undefined, undefined, {
      planningContractMode: 'v3-candidate',
      planningFailureInjector: async ({ stage }) => {
        if (stage !== 'source_policy_precheck' || ++sourcePolicyPrechecks !== 2) return
        await writeFile(agentsPath, '# Project rules\n\n- Every change MUST include an automated regression test.\n- Every change MUST preserve backwards compatibility.\n')
      },
    })
    const project = await service.createProjectFromRequest({ mode: 'empty', name: 'Policy nonconvergent', cwd: repository, prd: '# 功能\n## 验收标准\n1. 保存记录并可查询' })
    const implementer = await service.createAgent({ name: 'Changing Policy Implementer', role: 'Software Engineer', persona: 'Implement.' })
    const verifier = await service.createAgent({ name: 'Changing Policy Verifier', role: 'Test Engineer', persona: 'Verify.' })
    await service.addProjectAgents(project.id, { members: [
      { agentId: implementer.id, projectRole: 'Software Engineer', deliveryRoles: ['implementer'], autoAssignable: true },
      { agentId: verifier.id, projectRole: 'Test Engineer', deliveryRoles: ['verifier'], autoAssignable: true },
    ] })
    await addTrustedCapabilities(store, project.id, implementer.id, ['language.typescript', 'testing.automation'])
    await addTrustedCapabilities(store, project.id, verifier.id, ['language.typescript', 'testing.automation', 'testing.verification'])

    await service.startDecomposition(project.id)
    const settled = await waitForPlanning(store, project.id)
    const operations = [...store.planningOperations.records.values()].sort((left, right) => left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id))
    assert.equal(settled.status, 'draft')
    assert.equal(operations.length, 2)
    assert.equal(operations[0].status, 'superseded')
    assert.equal(operations[1].status, 'blocked')
    assert.equal(operations[1].stage, 'policy_snapshot')
    assert.equal(operations[1].diagnostics.some((item) => item.code === 'repository-policy-nonconvergent'), true)
    assert.equal(store.repositoryPolicyBaselines.get(operations[1].repositoryPolicyBaselineId).constraintSeedIds.length, 2)
    assert.equal(store.tasks.size, 0)
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('Planning V3 compensates every Repository Policy stage write failure without leaving an approvable partial plan', async () => {
  for (const failurePoint of ['baseline', 'constraint', 'snapshot', 'operation-terminal', 'project-pointer']) {
    const root = await mkdtemp(join(tmpdir(), `po-v3-policy-rollback-${failurePoint}-`))
    try {
      const repository = await createPlanningV3Fixture(root)
      await writeFile(join(repository, 'AGENTS.md'), '# Project rules\n\n- Every change MUST include an automated regression test.\n')
      await execFileAsync('git', ['add', 'AGENTS.md'], { cwd: repository })
      await execFileAsync('git', ['commit', '-m', 'docs: add project policy'], { cwd: repository })
      const store = memoryStore()
      const service = new OrchestratorService(agentContext(), store, undefined, undefined, { planningContractMode: 'v3-candidate' })
      const project = await service.createProjectFromRequest({ mode: 'empty', name: `Policy rollback ${failurePoint}`, cwd: repository, prd: '# 功能\n## 验收标准\n1. 保存记录并可查询' })
      let injected = false
      const injectAfterWrite = (table, matches) => {
        const original = table.put.bind(table)
        table.put = async (id, value) => {
          await original(id, value)
          if (!injected && matches(value)) {
            injected = true
            throw new Error(`injected policy ${failurePoint} write failure`)
          }
        }
      }
      if (failurePoint === 'baseline') injectAfterWrite(store.repositoryPolicyBaselines, () => true)
      if (failurePoint === 'constraint') injectAfterWrite(store.policyConstraintsV3, () => true)
      if (failurePoint === 'snapshot') injectAfterWrite(store.planningPolicySnapshots, () => true)
      if (failurePoint === 'operation-terminal') injectAfterWrite(store.planningOperations, (value) => value.status === 'superseded')
      if (failurePoint === 'project-pointer') injectAfterWrite(store.projects, (value) => value.id === project.id && value.status === 'draft' && value.activePlanningOperationId === undefined)

      await service.startDecomposition(project.id)
      const settled = await waitForPlanning(store, project.id)
      const operation = [...store.planningOperations.records.values()].at(-1)

      assert.equal(injected, true, failurePoint)
      assert.equal(settled.status, 'draft', failurePoint)
      assert.equal(settled.currentPlanSnapshotId, undefined, failurePoint)
      assert.equal(operation.status, 'failed', failurePoint)
      assert.notEqual(operation.status, 'superseded', failurePoint)
      assert.equal(store.repositoryPolicyBaselines.size, 0, failurePoint)
      assert.equal(store.policyConstraintsV3.size, 0, failurePoint)
      assert.equal(store.planningPolicySnapshots.size, 0, failurePoint)
      assert.equal(store.planSnapshots.size, 0, failurePoint)
      assert.equal(store.tasks.size, 0, failurePoint)
      assert.equal(service.getProjectPlanningV3(project.id).planHealth.approvable, false, failurePoint)
    } finally { await rm(root, { recursive: true, force: true }) }
  }
})

test('Planning V3 rejects detached HEAD and ambiguous canonical repository resources', async () => {
  for (const variant of ['detached', 'multiple-resources']) {
    const root = await mkdtemp(join(tmpdir(), `po-v3-target-${variant}-`))
    try {
      const repository = await createPlanningV3Fixture(root)
      if (variant === 'detached') await execFileAsync('git', ['checkout', '--detach'], { cwd: repository })
      const store = memoryStore()
      const service = new OrchestratorService(agentContext(), store, undefined, undefined, { planningContractMode: 'v3-candidate' })
      const project = await service.createProjectFromRequest({ mode: 'empty', name: `Canonical target ${variant}`, cwd: repository, prd: '# 功能\n## 验收标准\n1. 保存记录' })
      if (variant === 'multiple-resources') {
        await service.createProjectResource(project.id, { kind: 'local_directory', location: repository, executionMode: 'in_place' })
        await service.createProjectResource(project.id, { kind: 'local_directory', location: repository, executionMode: 'worktree' })
      }

      await service.startDecomposition(project.id)
      const settled = await waitForPlanning(store, project.id)
      const operation = [...store.planningOperations.records.values()].at(-1)

      assert.equal(settled.status, 'draft')
      assert.equal(settled.currentPlanSnapshotId, undefined)
      assert.equal(store.tasks.size, 0)
      assert.equal(operation.status, 'failed')
      assert.equal(operation.diagnostics.some((item) => item.code === (variant === 'detached' ? 'canonical-target-detached' : 'canonical-target-ambiguous')), true)
      assert.equal(store.canonicalTargetBindings.size, 0)
    } finally { await rm(root, { recursive: true, force: true }) }
  }
})

test('Planning V3 stage failure injection records a failed immutable attempt and publishes no candidate', async () => {
  const root = await mkdtemp(join(tmpdir(), 'po-v3-stage-failure-'))
  try {
    const repository = await createPlanningV3Fixture(root)
    const store = memoryStore()
    const service = new OrchestratorService(agentContext(), store, undefined, undefined, {
      planningContractMode: 'v3-candidate',
      planningFailureInjector: ({ stage }) => { if (stage === 'requirement_review') throw new Error('injected requirement review commit failure') },
    })
    const project = await service.createProjectFromRequest({ mode: 'empty', name: 'Injected stage failure', cwd: repository, prd: '# 功能\n## 验收标准\n1. 保存记录并可查询' })

    await service.startDecomposition(project.id)
    const settled = await waitForPlanning(store, project.id)
    const operation = [...store.planningOperations.records.values()].at(-1)
    const attempts = service.listPlanningStageAttemptsV3(project.id, operation.id)

    assert.equal(settled.status, 'draft')
    assert.equal(settled.currentPlanSnapshotId, undefined)
    assert.deepEqual(settled.taskIds, [])
    assert.equal(operation.status, 'failed')
    assert.equal(attempts.filter((attempt) => attempt.status === 'failed').length, 1)
    assert.equal(attempts.find((attempt) => attempt.status === 'failed').stage, 'requirement_review')
    assert.equal(attempts.find((attempt) => attempt.status === 'failed').errorCode, 'planning-stage-failed')
    assert.equal(store.tasks.size, 0)
    assert.equal(store.planSnapshots.size, 0)
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('Planning V3 rejects unreadable normative source references before invoking requirement analysis', async () => {
  const root = await mkdtemp(join(tmpdir(), 'po-v3-unreadable-source-'))
  try {
    const repository = await createPlanningV3Fixture(root)
    const store = memoryStore()
    const observation = {}
    const service = new OrchestratorService(agentContext('unused', observation), store, undefined, undefined, { planningContractMode: 'v3-candidate' })
    const project = await service.createProjectFromRequest({ mode: 'empty', name: 'Unreadable source gate', cwd: repository })

    await service.appendDecomposition(project.id, {
      title: 'Referenced requirement source',
      prd: '# 功能\n## 验收标准\n1. 保存记录并可查询',
      technicalDesign: '',
      sourceRefs: ['/missing/normative-design.md'],
      sourceBlocks: [],
    })
    const settled = await waitForPlanning(store, project.id)
    const operation = [...store.planningOperations.records.values()].at(-1)
    const attempts = service.listPlanningStageAttemptsV3(project.id, operation.id)

    assert.equal(settled.status, 'draft')
    assert.equal(settled.currentPlanSnapshotId, undefined)
    assert.equal(operation.status, 'blocked')
    assert.equal(operation.stage, 'source_profile')
    assert.equal(operation.diagnostics.some((item) => item.code === 'source-evidence-incomplete'), true)
    assert.equal(observation.requirementAnalysisCalls, undefined)
    assert.equal(observation.requirementReviewCalls, undefined)
    assert.equal(store.requirementAnalysisProposals.size, 0)
    assert.equal(store.requirementSourceManifests.size, 0)
    assert.equal(store.tasks.size, 0)
    assert.equal(attempts.some((attempt) => attempt.stage === 'source_profile' && attempt.status === 'completed'), true)
    assert.equal(attempts.some((attempt) => attempt.stage === 'requirement_analysis'), false)
    assert.equal([...store.requirementSourceProfiles.records.values()].some((profile) => profile.documentId === 'attachment-1' && profile.status === 'unsupported'), true)
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('startup recovery commits only an authoritative V3 pointer and aborts an unreferenced interrupted operation', async () => {
  const store = memoryStore()
  const service = new OrchestratorService({}, store)
  const abortedProject = await service.createProject({ name: 'Interrupted candidate', cwd: '/tmp', prd: 'PRD', technicalDesign: 'Design' })
  const committedProject = await service.createProject({ name: 'Pointer committed candidate', cwd: '/tmp', prd: 'PRD', technicalDesign: 'Design' })
  const abortedOperation = interruptedPlanningOperation('planning-v3:recover-abort', abortedProject.id, 'plan:recover-abort', 'code_binding')
  const committedOperation = interruptedPlanningOperation('planning-v3:recover-commit', committedProject.id, 'plan:recover-commit', 'committing')
  await store.planningOperations.put(abortedOperation.id, abortedOperation)
  await store.planningOperations.put(committedOperation.id, committedOperation)
  await store.planningStageAttempts.put('attempt:recover-abort', { id: 'attempt:recover-abort', operationId: abortedOperation.id, stage: 'code_binding', round: 1, status: 'running', inputDigest: 'b'.repeat(64), createdAt: now })
  await store.planSnapshots.put('plan:recover-commit', { id: 'plan:recover-commit', projectId: committedProject.id, planningContractVersion: 3, taskIds: ['recovered-task'] })
  await store.projects.put(abortedProject.id, { ...abortedProject, status: 'decomposing', planningContractVersion: 3, activePlanningOperationId: abortedOperation.id })
  await store.projects.put(committedProject.id, { ...committedProject, status: 'decomposing', planningContractVersion: 3, currentPlanSnapshotId: 'plan:recover-commit', activePlanningOperationId: committedOperation.id })

  await service.initialize()

  const recoveredAbort = store.planningOperations.get(abortedOperation.id)
  const recoveredCommit = store.planningOperations.get(committedOperation.id)
  assert.equal(recoveredAbort.status, 'aborted')
  assert.equal(store.projects.get(abortedProject.id).status, 'draft')
  assert.equal(store.projects.get(abortedProject.id).activePlanningOperationId, undefined)
  assert.equal(store.planningStageAttempts.get('attempt:recover-abort').status, 'cancelled')
  assert.equal(store.planningStageAttempts.get('attempt:recover-abort').errorCode, 'planning-recovered-after-interruption')
  assert.equal(recoveredCommit.status, 'committed')
  assert.equal(recoveredCommit.stage, 'committed')
  assert.deepEqual(recoveredCommit.taskIds, ['recovered-task'])
  assert.equal(store.projects.get(committedProject.id).status, 'awaiting_approval')
  assert.equal(store.projects.get(committedProject.id).activePlanningOperationId, undefined)
})

test('startup recovery resumes exactly once from a current checkpoint with immutable source input', async () => {
  const store = memoryStore()
  const observation = {}
  const service = new OrchestratorService(agentContext('unused', observation), store, undefined, undefined, { planningContractMode: 'v3-candidate' })
  const project = await service.createProject({ name: 'Checkpoint resume', cwd: '/tmp', prd: 'Persist the record.', technicalDesign: 'Use the existing repository owner.' })
  let operation = interruptedPlanningOperation('planning-v3:checkpoint-resume', project.id, 'plan:checkpoint-resume', 'source_profile')
  const sourceCore = {
    projectId: project.id, operationId: operation.id, mode: 'initial', title: project.name, prd: project.prd,
    technicalDesign: project.technicalDesign, taskLanguage: 'zh-CN', sourceRefs: [], sourceBlocks: [], requestDigest: operation.requestDigest,
  }
  const sourceInput = { id: `planning-source-input:${operation.id}`, ...sourceCore, sourceInputDigest: digestObject(sourceCore), createdAt: now }
  operation = { ...operation, sourceInputId: sourceInput.id, sourceInputDigest: sourceInput.sourceInputDigest }
  const checkpoint = buildPlanningCheckpointV3({ operation, sequence: 1, inputDigest: digestObject({ stage: operation.stage }) })
  await store.planningOperations.put(operation.id, operation)
  await store.planningSourceInputs.put(sourceInput.id, sourceInput)
  await store.planningCheckpoints.put(checkpoint.id, checkpoint)
  await store.projects.put(project.id, { ...project, status: 'decomposing', planningContractVersion: 3, activePlanningOperationId: operation.id })

  await service.initialize()

  const recovered = store.planningOperations.get(operation.id)
  const successors = [...store.planningOperations.records.values()].filter((candidate) => candidate.predecessorOperationId === operation.id)
  assert.equal(recovered.status, 'failed')
  assert.equal(recovered.diagnostics.some((item) => item.code === 'planning-recovered-after-interruption'), true)
  assert.equal(successors.length, 1)
  assert.equal([...store.planningCheckpoints.records.values()].some((candidate) => candidate.operationId === successors[0].id && candidate.stage === 'reserved'), true)
  assert.equal(successors[0].requestDigest, digestObject({ predecessorOperationId: operation.id, sourceInputDigest: sourceInput.sourceInputDigest, restartStage: operation.stage, checkpointDigest: checkpoint.checkpointDigest, batch: { title: sourceInput.title, prd: sourceInput.prd, technicalDesign: sourceInput.technicalDesign, taskLanguage: sourceInput.taskLanguage, sourceRefs: [], sourceBlocks: [], idempotencyKey: `planning-operation-recovery:${operation.id}:${checkpoint.id}` } }))
  await service.close()
})

test('startup recovery refuses a tampered checkpoint or missing immutable source input', async () => {
  for (const failure of ['tampered_checkpoint', 'missing_source']) {
    const store = memoryStore()
    const service = new OrchestratorService({}, store)
    const project = await service.createProject({ name: `Checkpoint ${failure}`, cwd: '/tmp', prd: 'PRD', technicalDesign: 'Design' })
    let operation = interruptedPlanningOperation(`planning-v3:${failure}`, project.id, `plan:${failure}`, 'source_profile')
    const sourceCore = { projectId: project.id, operationId: operation.id, mode: 'initial', title: project.name, prd: project.prd, technicalDesign: project.technicalDesign, taskLanguage: 'zh-CN', sourceRefs: [], sourceBlocks: [], requestDigest: operation.requestDigest }
    const sourceInput = { id: `planning-source-input:${operation.id}`, ...sourceCore, sourceInputDigest: digestObject(sourceCore), createdAt: now }
    operation = { ...operation, sourceInputId: sourceInput.id, sourceInputDigest: sourceInput.sourceInputDigest }
    const validCheckpoint = buildPlanningCheckpointV3({ operation, sequence: 1, inputDigest: digestObject({ stage: operation.stage }) })
    const checkpoint = failure === 'tampered_checkpoint' ? { ...validCheckpoint, operationDigest: 'f'.repeat(64) } : validCheckpoint
    await store.planningOperations.put(operation.id, operation)
    if (failure !== 'missing_source') await store.planningSourceInputs.put(sourceInput.id, sourceInput)
    await store.planningCheckpoints.put(checkpoint.id, checkpoint)
    await store.projects.put(project.id, { ...project, status: 'decomposing', planningContractVersion: 3, activePlanningOperationId: operation.id })

    await service.initialize()

    assert.equal(store.planningOperations.get(operation.id).status, 'aborted')
    assert.equal([...store.planningOperations.records.values()].some((candidate) => candidate.predecessorOperationId === operation.id), false)
    assert.equal(store.projects.get(project.id).status, 'draft')
  }
})

test('Planning V3 checkpoint persistence failure cannot publish a candidate or leave a running operation', async () => {
  const store = memoryStore()
  const originalPut = store.planningCheckpoints.put.bind(store.planningCheckpoints)
  let writes = 0
  store.planningCheckpoints.put = async (...args) => {
    writes += 1
    if (writes === 1) throw new Error('injected checkpoint write failure')
    return originalPut(...args)
  }
  const service = new OrchestratorService(agentContext('unused', {}), store, undefined, undefined, { planningContractMode: 'v3-candidate' })
  const project = await service.createProjectFromRequest({ mode: 'empty', name: 'Checkpoint write failure', cwd: '/tmp', prd: 'Persist a record.' })
  await service.startDecomposition(project.id)
  const settled = await waitForPlanning(store, project.id)
  const operation = [...store.planningOperations.records.values()].find((candidate) => candidate.projectId === project.id)

  assert.equal(settled.status, 'draft')
  assert.equal(operation.status, 'failed')
  assert.equal(operation.diagnostics.some((item) => item.message.includes('injected checkpoint write failure')), true)
  assert.equal(store.planSnapshots.size, 0)
  assert.equal(store.tasks.size, 0)
})

test('Planning V3 times out a hung Planner turn, fails closed, and restores the Project for retry', async () => {
  const root = await mkdtemp(join(tmpdir(), 'po-v3-agent-timeout-'))
  try {
    const repository = await createPlanningV3Fixture(root)
    const store = memoryStore()
    const observation = {}
    const context = agentContext('unused', observation)
    const createAgent = context.agents.create
    context.agents.create = async (options) => {
      const handle = await createAgent(options)
      if (observation.sections?.at(-1)?.text.includes('code-grounded delivery planner')) {
        handle.agent.whenIdle = async () => await new Promise(() => {})
      }
      return handle
    }
    const service = new OrchestratorService(context, store, undefined, undefined, { planningContractMode: 'v3-candidate', agentTurnTimeoutMs: 20 })
    const project = await service.createProjectFromRequest({ mode: 'empty', name: 'Hung Planner', cwd: repository, prd: '# Feature\n## Acceptance\n1. Save and query the record' })

    await service.startDecomposition(project.id)
    const settled = await waitForPlanning(store, project.id)
    const operation = [...store.planningOperations.records.values()].find((item) => item.projectId === project.id)

    assert.equal(settled.status, 'draft')
    assert.equal(settled.activePlanningOperationId, undefined)
    assert.equal(operation.status, 'failed')
    assert.equal(operation.stage, 'task_plan')
    assert.equal(operation.diagnostics.some((item) => item.code === 'agent-turn-timeout'), true)
    assert.equal([...store.planningStageAttempts.records.values()].some((attempt) => attempt.operationId === operation.id && attempt.stage === 'task_plan' && attempt.status === 'failed' && attempt.errorCode === 'agent-turn-timeout'), true)
    assert.equal(store.tasks.size, 0)
    assert.equal(store.planApprovalsV3.size, 0)
    assert.equal(store.executionDispatches.size, 0)
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('Planning V3 blocks a non-approved Scenario Coverage Review before repository binding and task publication', async () => {
  const root = await mkdtemp(join(tmpdir(), 'po-v3-scenario-review-blocked-'))
  try {
    const repository = await createPlanningV3Fixture(root)
    const store = memoryStore()
    const observation = {
      scenarioReviewResponse: ({ generated }) => ({
        ...generated,
        status: 'changes_requested',
        findings: [{ code: 'scenario-not-falsifiable', severity: 'blocking', subjectType: 'scenario', subjectId: 'SCN-AC-001-HAPPY_PATH', evidenceIds: [], message: 'The expected outcome is not independently observable.', repairOwner: 'scenario', restartStage: 'scenario_completion' }],
      }),
    }
    const service = new OrchestratorService(agentContext('unused', observation), store, undefined, undefined, { planningContractMode: 'v3-candidate' })
    const project = await service.createProjectFromRequest({ mode: 'empty', name: 'Blocked Scenario review', cwd: repository, prd: '# 功能\n## 验收标准\n1. 保存记录并可查询' })

    await service.startDecomposition(project.id)
    const settled = await waitForPlanning(store, project.id)

    assert.equal(settled.status, 'draft')
    const operation = [...store.planningOperations.records.values()].at(-1)
    assert.equal(operation.status, 'blocked')
    assert.equal(operation.stage, 'scenario_coverage_review')
    assert.equal([...store.scenarioCoverageReviews.records.values()].at(-1).status, 'changes_requested')
    assert.equal(store.repositorySnapshotsV3.size, 0)
    assert.equal(store.requirementCodeBindings.size, 0)
    assert.equal(store.tasks.size, 0)
    assert.equal(store.planSnapshots.size, 0)
    const planningView = service.getProjectPlanningV3(project.id)
    assert.equal(planningView.requirementReview.id, operation.requirementReviewId)
    assert.equal(planningView.scenarioCoverageReview.id, operation.scenarioCoverageReviewId)
    const repair = [...store.planningRepairAttempts.records.values()].at(-1)
    assert.equal(repair.reviewKind, 'scenario_coverage')
    assert.equal(repair.restartStage, 'scenario_completion')
    assert.equal(repair.status, 'requested')
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('Planning V3 blocks a non-approved Binding Review before plan generation and task publication', async () => {
  const root = await mkdtemp(join(tmpdir(), 'po-v3-binding-review-blocked-'))
  try {
    const repository = await createPlanningV3Fixture(root)
    const store = memoryStore()
    const observation = {
      bindingReviewResponse: ({ generated }) => ({
        ...generated,
        status: 'changes_requested',
        findings: [{ code: 'binding-scope-expanded', severity: 'blocking', subjectType: 'binding', subjectId: 'BIND-REQ-001', evidenceIds: [], message: 'The Binding includes unknown-stage schema, API, UI, browser, migration, and test work. This is an unrequested scope expansion and must be removed because no frozen Requirement or Acceptance requires it.', repairOwner: 'binding', restartStage: 'code_binding' }],
      }),
    }
    const service = new OrchestratorService(agentContext('unused', observation), store, undefined, undefined, { planningContractMode: 'v3-candidate' })
    const project = await service.createProjectFromRequest({ mode: 'empty', name: 'Blocked Binding review', cwd: repository, prd: '# 功能\n## 验收标准\n1. 保存记录并可查询' })

    await service.startDecomposition(project.id)
    const settled = await waitForPlanning(store, project.id)

    assert.equal(settled.status, 'draft')
    const operation = [...store.planningOperations.records.values()].at(-1)
    assert.equal(operation.status, 'blocked')
    assert.equal(operation.stage, 'binding_review')
    assert.equal([...store.planningReviewsV3.records.values()].at(-1).status, 'changes_requested')
    assert.equal(observation.bindingReviewCalls, 1)
    assert.equal(observation.plannerV3Calls, undefined)
    assert.equal(store.planningProposalPacks.size, 0)
    assert.equal(store.tasks.size, 0)
    assert.equal(store.planSnapshots.size, 0)
    const planningView = service.getProjectPlanningV3(project.id)
    assert.equal(planningView.requirementReview.id, operation.requirementReviewId)
    assert.equal(planningView.scenarioCoverageReview.id, operation.scenarioCoverageReviewId)
    assert.equal(planningView.bindingReview.id, operation.bindingReviewId)
    assert.equal(planningView.planReview, undefined)
    const repair = [...store.planningRepairAttempts.records.values()].at(-1)
    assert.equal(repair.reviewKind, 'binding')
    assert.equal(repair.restartStage, 'code_binding')
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('Planning V3 restarts Scenario generation when Binding Review discovers a frozen Scenario defect', async () => {
  const root = await mkdtemp(join(tmpdir(), 'po-v3-binding-review-scenario-repair-'))
  try {
    const repository = await createPlanningV3Fixture(root)
    const store = memoryStore()
    const finding = { code: 'scenario-stage-attempt-status-unsupported', severity: 'blocking', subjectType: 'scenario', subjectId: 'SCN-AC-001-BOUNDARY', evidenceIds: [], message: 'The Scenario invents a blocked stage-attempt status instead of observing the blocked operation and diagnostics.', repairOwner: 'scenario', restartStage: 'binding_review' }
    const observation = {
      bindingReviewResponse: ({ generated, call }) => call === 1 ? { ...generated, status: 'changes_requested', findings: [finding] } : generated,
    }
    const service = new OrchestratorService(agentContext('unused', observation), store, undefined, undefined, { planningContractMode: 'v3-candidate' })
    const project = await service.createProjectFromRequest({ mode: 'empty', name: 'Binding discovers Scenario defect', cwd: repository, prd: '# 功能\n## 验收标准\n1. 保存记录并可查询' })
    const implementer = await service.createAgent({ name: 'Scenario Repair Implementer', role: 'Software Engineer', persona: 'Implement.' })
    const verifier = await service.createAgent({ name: 'Scenario Repair Verifier', role: 'Test Engineer', persona: 'Verify.' })
    await service.addProjectAgents(project.id, { members: [
      { agentId: implementer.id, projectRole: 'Software Engineer', deliveryRoles: ['implementer'], autoAssignable: true },
      { agentId: verifier.id, projectRole: 'Test Engineer', deliveryRoles: ['verifier'], autoAssignable: true },
    ] })
    await addTrustedCapabilities(store, project.id, implementer.id, ['language.typescript', 'testing.automation'])
    await addTrustedCapabilities(store, project.id, verifier.id, ['language.typescript', 'testing.automation', 'testing.verification'])

    await service.startDecomposition(project.id)
    await waitForPlanning(store, project.id)
    const predecessor = [...store.planningOperations.records.values()].at(-1)
    const frozenReview = store.planningReviewsV3.get(predecessor.bindingReviewId)
    const repair = [...store.planningRepairAttempts.records.values()].at(-1)

    assert.equal(predecessor.status, 'blocked')
    assert.equal(frozenReview.findings[0].restartStage, 'scenario_completion')
    assert.equal(repair.restartStage, 'scenario_completion')
    assert.equal(repair.findings[0].restartStage, 'scenario_completion')

    await service.retryPlanningRepairV3(project.id, repair.id, { expectedRepairDigest: repair.repairDigest, idempotencyKey: 'repair-scenario-from-binding-review' })
    const settled = await waitForPlanning(store, project.id)
    const resolvedRepair = store.planningRepairAttempts.get(repair.id)
    const successor = store.planningOperations.get(resolvedRepair.successorOperationId)

    assert.equal(settled.status, 'awaiting_approval', settled.lastError)
    assert.equal(successor.status, 'committed')
    assert.equal(resolvedRepair.status, 'resolved')
    assert.equal(observation.requirementAnalysisCalls, 1)
    assert.equal(observation.requirementReviewCalls, 1)
    assert.equal(observation.scenarioCalls, 2)
    assert.equal(observation.scenarioReviewCalls, 2)
    assert.equal(observation.bindingCalls, 2)
    assert.equal(observation.bindingReviewCalls, 2)
    assert.equal(observation.prompts.some((prompt) => prompt.includes('Successor repair findings') && prompt.includes(finding.code) && prompt.includes('Acceptance Scenario V3 JSON object')), true)
    assert.equal(observation.prompts.some((prompt) => prompt.includes(finding.code) && prompt.includes('full structured Scenario fields')), true)
    assert.equal(observation.prompts.some((prompt) => prompt.includes(finding.code) && prompt.includes('unknown-stage compatibility is not required') && prompt.includes('remove any unknown or future stage fixture')), true)
    assert.equal(observation.prompts.some((prompt) => prompt.includes(finding.code) && prompt.includes('must name a real unknown identifier fixture')), false)
    assert.equal(observation.prompts.some((prompt) => prompt.includes(finding.code) && prompt.includes('Repository Binding V3 JSON object')), false)
    assert.equal(observation.prompts.some((prompt) => prompt.includes(finding.code) && prompt.includes('Delivery Plan V3 JSON object')), false)
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('Planning V3 rejects repository freshness findings from a model Reviewer and retries under the semantic review contract', async () => {
  const root = await mkdtemp(join(tmpdir(), 'po-v3-binding-review-authority-'))
  try {
    const repository = await createPlanningV3Fixture(root)
    const store = memoryStore()
    const observation = {
      bindingReviewResponse: ({ generated, call }) => call === 1 ? {
        ...generated,
        status: 'blocked',
        findings: [{ code: 'repository_snapshot_evidence_mismatch', severity: 'blocking', subjectType: 'binding', subjectId: 'BIND-REQ-001', evidenceIds: ['src/records.ts'], message: 'The checkout digest does not match the frozen repository snapshot.', repairOwner: 'repository', restartStage: 'code_binding' }],
      } : generated,
    }
    const service = new OrchestratorService(agentContext('unused', observation), store, undefined, undefined, { planningContractMode: 'v3-candidate' })
    const project = await service.createProjectFromRequest({ mode: 'empty', name: 'Reviewer authority', cwd: repository, prd: '# 功能\n## 验收标准\n1. 保存记录并可查询' })

    await service.startDecomposition(project.id)
    await waitForPlanning(store, project.id)

    const review = [...store.planningReviewsV3.records.values()].find((item) => item.kind === 'binding')
    assert.equal(observation.bindingReviewCalls, 2)
    assert.equal(review.status, 'approved')
    assert.deepEqual(review.findings, [])
    assert.equal(observation.plannerV3Calls, 1)
    assert.match(observation.prompts.find((prompt) => prompt.includes('Planning Review V3 JSON object') && prompt.includes('Frozen subject:')), /deterministic Service-owned gates/)
    assert.equal([...store.planningRepairAttempts.records.values()].some((repair) => repair.reviewKind === 'binding'), false)
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('Planning V3 rejects downstream plan findings from Binding Review and retries within the frozen stage boundary', async () => {
  const root = await mkdtemp(join(tmpdir(), 'po-v3-binding-review-stage-boundary-'))
  try {
    const repository = await createPlanningV3Fixture(root)
    const store = memoryStore()
    const observation = {
      bindingReviewResponse: ({ generated, call }) => call === 1 ? {
        ...generated,
        status: 'changes_requested',
        findings: [{ code: 'planning-review-plan-artifacts-missing', severity: 'blocking', subjectType: 'work_package', subjectId: 'future-plan', evidenceIds: [], message: 'No work packages, tasks, capabilities, or assignments exist.', repairOwner: 'plan', restartStage: 'task_plan' }],
      } : generated,
    }
    const service = new OrchestratorService(agentContext('unused', observation), store, undefined, undefined, { planningContractMode: 'v3-candidate' })
    const project = await service.createProjectFromRequest({ mode: 'empty', name: 'Binding review boundary', cwd: repository, prd: '# 功能\n## 验收标准\n1. 保存记录并可查询' })

    await service.startDecomposition(project.id)
    await waitForPlanning(store, project.id)

    const review = [...store.planningReviewsV3.records.values()].find((item) => item.kind === 'binding')
    assert.equal(observation.bindingReviewCalls, 2)
    assert.equal(review.status, 'approved')
    assert.deepEqual(review.findings, [])
    assert.equal(observation.plannerV3Calls, 1)
    assert.equal([...store.planningRepairAttempts.records.values()].some((repair) => repair.reviewKind === 'binding'), false)
    const bindingReviewPrompts = observation.prompts.filter((prompt) => prompt.includes('binding Planning Review V3 JSON object'))
    assert.match(bindingReviewPrompts[0], /work packages, tasks, dependencies, capability requirements, assignments, and preflight records do not exist yet/)
    assert.match(bindingReviewPrompts[0], /A current closed enum, missing field, rejecting schema\/validator, absent code branch, or absent test harness proves required target work, not a Scenario contradiction/)
    assert.match(bindingReviewPrompts[0], /it does not by itself require every field validator or enum member to remain unchanged/)
    assert.match(bindingReviewPrompts[1], /Binding Review cannot require downstream Plan, capability, assignment, or preflight artifacts before Task Planning/)
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('Planning V3 deterministically rejects real repository drift during Binding Review', async () => {
  const root = await mkdtemp(join(tmpdir(), 'po-v3-binding-review-drift-'))
  try {
    const repository = await createPlanningV3Fixture(root)
    const store = memoryStore()
    const observation = {
      bindingReviewResponse: ({ generated }) => {
        writeFileSync(join(repository, 'src', 'records.ts'), 'export const records = new Map([["drift", true]])\n')
        return generated
      },
    }
    const service = new OrchestratorService(agentContext('unused', observation), store, undefined, undefined, { planningContractMode: 'v3-candidate' })
    const project = await service.createProjectFromRequest({ mode: 'empty', name: 'Binding review drift', cwd: repository, prd: '# 功能\n## 验收标准\n1. 保存记录并可查询' })

    await service.startDecomposition(project.id)
    const settled = await waitForPlanning(store, project.id)
    const operation = [...store.planningOperations.records.values()].at(-1)

    assert.equal(settled.status, 'draft')
    assert.match(settled.lastError, /Repository content changed while the binding Review was running/)
    assert.equal(operation.status, 'failed')
    assert.equal(store.tasks.size, 0)
    assert.equal(store.planSnapshots.size, 0)
    assert.equal([...store.planningRepairAttempts.records.values()].some((repair) => repair.reviewKind === 'binding'), false)
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('Planning V3 blocks a non-approved Plan Review before assignment and task publication', async () => {
  const root = await mkdtemp(join(tmpdir(), 'po-v3-plan-review-blocked-'))
  try {
    const repository = await createPlanningV3Fixture(root)
    const store = memoryStore()
    const observation = {
      planReviewResponse: ({ generated }) => ({
        ...generated,
        status: 'changes_requested',
        findings: [{ code: 'plan-context-incomplete', severity: 'blocking', subjectType: 'task', subjectId: 'TASK-IMPLEMENT', evidenceIds: [], message: 'The task context does not close the impact chain.', repairOwner: 'plan', restartStage: 'task_plan' }],
      }),
    }
    const service = new OrchestratorService(agentContext('unused', observation), store, undefined, undefined, { planningContractMode: 'v3-candidate' })
    const project = await service.createProjectFromRequest({ mode: 'empty', name: 'Blocked Plan review', cwd: repository, prd: '# 功能\n## 验收标准\n1. 保存记录并可查询' })

    await service.startDecomposition(project.id)
    const settled = await waitForPlanning(store, project.id)

    assert.equal(settled.status, 'draft')
    const operation = [...store.planningOperations.records.values()].at(-1)
    assert.equal(operation.status, 'blocked')
    assert.equal(operation.stage, 'plan_review')
    assert.equal([...store.planningReviewsV3.records.values()].at(-1).status, 'changes_requested')
    assert.equal(observation.planReviewCalls, 1)
    assert.equal(store.assignmentDrafts.size, 0)
    assert.equal(store.assignmentEvaluations.size, 0)
    assert.equal(store.taskPreflightsV3.size, 0)
    assert.equal(store.tasks.size, 0)
    assert.equal(store.planSnapshots.size, 0)
    const planningView = service.getProjectPlanningV3(project.id)
    assert.equal(planningView.requirementReview.id, operation.requirementReviewId)
    assert.equal(planningView.scenarioCoverageReview.id, operation.scenarioCoverageReviewId)
    assert.equal(planningView.bindingReview.id, operation.bindingReviewId)
    assert.equal(planningView.planReview.id, operation.planReviewId)
    const repair = [...store.planningRepairAttempts.records.values()].at(-1)
    assert.equal(repair.reviewKind, 'plan')
    assert.equal(repair.restartStage, 'task_plan')
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('Planning V3 repair retry creates one immutable successor and resolves only after a non-blocking review', async () => {
  const root = await mkdtemp(join(tmpdir(), 'po-v3-plan-repair-successor-'))
  try {
    const repository = await createPlanningV3Fixture(root)
    const store = memoryStore()
    const repairFinding = { code: 'plan-context-incomplete', severity: 'blocking', subjectType: 'task', subjectId: 'TASK-IMPLEMENT', evidenceIds: [], message: 'The task context does not close the impact chain.', repairOwner: 'plan', restartStage: 'task_plan' }
    const observation = {
      planReviewResponse: ({ generated, call }) => call === 1 ? { ...generated, status: 'changes_requested', findings: [repairFinding] } : generated,
    }
    const service = new OrchestratorService(agentContext('unused', observation), store, undefined, undefined, { planningContractMode: 'v3-candidate' })
    const project = await service.createProjectFromRequest({ mode: 'empty', name: 'Repair successor', cwd: repository, prd: '# 功能\n## 验收标准\n1. 保存记录并可查询' })
    const implementer = await service.createAgent({ name: 'Repair Implementer', role: 'Software Engineer', persona: 'Implement.' })
    const verifier = await service.createAgent({ name: 'Repair Verifier', role: 'Test Engineer', persona: 'Verify.' })
    await service.addProjectAgents(project.id, { members: [
      { agentId: implementer.id, projectRole: 'Software Engineer', deliveryRoles: ['implementer'], autoAssignable: true },
      { agentId: verifier.id, projectRole: 'Test Engineer', deliveryRoles: ['verifier'], autoAssignable: true },
    ] })
    await addTrustedCapabilities(store, project.id, implementer.id, ['language.typescript', 'testing.automation'])
    await addTrustedCapabilities(store, project.id, verifier.id, ['language.typescript', 'testing.automation', 'testing.verification'])

    await service.startDecomposition(project.id)
    const firstSettled = await waitForPlanning(store, project.id)
    const predecessor = [...store.planningOperations.records.values()].at(-1)
    const repair = [...store.planningRepairAttempts.records.values()].at(-1)
    const predecessorSnapshot = structuredClone(predecessor)

    assert.equal(firstSettled.status, 'draft')
    assert.equal(predecessor.status, 'blocked')
    assert.equal(repair.status, 'requested')
    await service.retryPlanningRepairV3(project.id, repair.id, { expectedRepairDigest: repair.repairDigest, idempotencyKey: 'repair-plan-context' })
    const repairedProject = await waitForPlanning(store, project.id)
    const resolvedRepair = store.planningRepairAttempts.get(repair.id)
    const successor = store.planningOperations.get(resolvedRepair.successorOperationId)

    assert.equal(repairedProject.status, 'awaiting_approval', repairedProject.lastError)
    assert.deepEqual(store.planningOperations.get(predecessor.id), predecessorSnapshot)
    assert.equal(successor.predecessorOperationId, predecessor.id)
    assert.equal(successor.status, 'committed')
    assert.equal(resolvedRepair.status, 'resolved')
    assert.equal(resolvedRepair.outputSubjectRevision, repairedProject.revision)
    assert.equal(resolvedRepair.resultReviewId, successor.planReviewId)
    assert.equal(resolvedRepair.deterministicValidationDigest.length, 64)
    assert.equal(observation.requirementAnalysisCalls, 1)
    assert.equal(observation.requirementReviewCalls, 1)
    assert.equal(observation.scenarioCalls, 1)
    assert.equal(observation.scenarioReviewCalls, 1)
    assert.equal(observation.bindingCalls, 1)
    assert.equal(observation.bindingReviewCalls, 1)
    assert.equal(observation.plannerV3Calls, 2)
    assert.equal(observation.planReviewCalls, 2)
    assert.equal(observation.prompts.some((prompt) => prompt.includes('Successor repair findings') && prompt.includes(repairFinding.code)), true)
    assert.equal(observation.prompts.some((prompt) => prompt.includes(repairFinding.code) && prompt.includes('shared temporary storage configuration or directory') && prompt.includes('concrete DOM geometry or computed-style assertions')), true)
    assert.equal(observation.prompts.filter((prompt) => prompt.includes('Successor repair findings') && prompt.includes(repairFinding.code)).length, 1)
    const operationCount = store.planningOperations.size
    assert.deepEqual(await service.retryPlanningRepairV3(project.id, repair.id, { expectedRepairDigest: repair.repairDigest, idempotencyKey: 'repair-plan-context' }), repairedProject)
    assert.equal(store.planningOperations.size, operationCount)
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('Planning V3 keeps a revalidated Scenario repair lineage through an automatic Repository Policy successor', async () => {
  const root = await mkdtemp(join(tmpdir(), 'po-v3-scenario-repair-policy-successor-'))
  try {
    const repository = await createPlanningV3Fixture(root)
    await writeFile(join(repository, 'AGENTS.md'), '# Project rules\n\n- Every change MUST include an automated regression test.\n')
    await execFileAsync('git', ['add', 'AGENTS.md'], { cwd: repository })
    await execFileAsync('git', ['commit', '-m', 'docs: add project policy'], { cwd: repository })
    const store = memoryStore()
    const finding = { code: 'scenario-not-falsifiable', severity: 'blocking', subjectType: 'scenario', subjectId: 'SCN-AC-001-HAPPY_PATH', evidenceIds: [], message: 'The expected outcome is not independently observable.', repairOwner: 'scenario', restartStage: 'scenario_completion' }
    const observation = {
      scenarioReviewResponse: ({ generated, call }) => call === 1 ? { ...generated, status: 'changes_requested', findings: [finding] } : generated,
    }
    const service = new OrchestratorService(agentContext('unused', observation), store, undefined, undefined, { planningContractMode: 'v3-candidate' })
    const project = await service.createProjectFromRequest({ mode: 'empty', name: 'Scenario repair with policy successor', cwd: repository, prd: '# 功能\n## 验收标准\n1. 保存记录并可查询' })
    const implementer = await service.createAgent({ name: 'Scenario Policy Implementer', role: 'Software Engineer', persona: 'Implement.' })
    const verifier = await service.createAgent({ name: 'Scenario Policy Verifier', role: 'Test Engineer', persona: 'Verify.' })
    await service.addProjectAgents(project.id, { members: [
      { agentId: implementer.id, projectRole: 'Software Engineer', deliveryRoles: ['implementer'], autoAssignable: true },
      { agentId: verifier.id, projectRole: 'Test Engineer', deliveryRoles: ['verifier'], autoAssignable: true },
    ] })
    await addTrustedCapabilities(store, project.id, implementer.id, ['language.typescript', 'testing.automation'])
    await addTrustedCapabilities(store, project.id, verifier.id, ['language.typescript', 'testing.automation', 'testing.verification'])

    await service.startDecomposition(project.id)
    await waitForPlanning(store, project.id)
    const original = [...store.planningOperations.records.values()].at(-1)
    const repair = [...store.planningRepairAttempts.records.values()].at(-1)
    await service.retryPlanningRepairV3(project.id, repair.id, { expectedRepairDigest: repair.repairDigest, idempotencyKey: 'repair-scenario-before-policy' })
    const settled = await waitForPlanning(store, project.id)
    const operations = [...store.planningOperations.records.values()].sort((left, right) => left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id))
    const resolvedRepair = store.planningRepairAttempts.get(repair.id)

    assert.equal(settled.status, 'awaiting_approval', settled.lastError)
    assert.equal(operations.length, 3)
    assert.equal(original.status, 'blocked')
    assert.equal(operations[1].status, 'superseded')
    assert.equal(operations[1].stage, 'policy_snapshot')
    assert.equal(operations[2].predecessorOperationId, operations[1].id)
    assert.equal(operations[2].status, 'committed')
    assert.equal(resolvedRepair.status, 'resolved')
    assert.equal(resolvedRepair.successorOperationId, operations[2].id)
    assert.equal(resolvedRepair.resultReviewId, operations[2].scenarioCoverageReviewId)
    assert.equal(observation.requirementAnalysisCalls, 1)
    assert.equal(observation.requirementReviewCalls, 1)
    const planningView = service.getProjectPlanningV3(project.id)
    assert.equal(planningView.operationLineage.complete, true)
    assert.deepEqual(planningView.operationLineage.entries.map((entry) => entry.operation.id), [operations[2].id, operations[1].id, original.id])
    assert.equal(planningView.repairAttempts.some((attempt) => attempt.id === resolvedRepair.id && attempt.status === 'resolved'), true)
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('Planning V3 settles and explicitly retries a schema-failed repair after an automatic Repository Policy successor', async () => {
  const root = await mkdtemp(join(tmpdir(), 'po-v3-repair-policy-successor-schema-retry-'))
  try {
    const repository = await createPlanningV3Fixture(root)
    await writeFile(join(repository, 'AGENTS.md'), '# Project rules\n\n- Every change MUST include an automated regression test.\n')
    await execFileAsync('git', ['add', 'AGENTS.md'], { cwd: repository })
    await execFileAsync('git', ['commit', '-m', 'docs: add project policy'], { cwd: repository })
    const store = memoryStore()
    const finding = { code: 'scenario-not-falsifiable', severity: 'blocking', subjectType: 'scenario', subjectId: 'SCN-AC-001-HAPPY_PATH', evidenceIds: [], message: 'The expected outcome is not independently observable.', repairOwner: 'scenario', restartStage: 'scenario_completion' }
    let emitInvalidPlan = true
    const observation = {
      scenarioReviewResponse: ({ generated, call }) => call === 1 ? { ...generated, status: 'changes_requested', findings: [finding] } : generated,
      plannerV3Response: ({ generated }) => emitInvalidPlan ? {
        ...generated,
        tasks: generated.tasks.map((task, index) => index === 0 ? { ...task, scenarioKeys: [], contextPack: { ...task.contextPack, verificationSteps: [] } } : task),
      } : generated,
    }
    const service = new OrchestratorService(agentContext('unused', observation), store, undefined, undefined, { planningContractMode: 'v3-candidate' })
    const project = await service.createProjectFromRequest({ mode: 'empty', name: 'Schema retry after policy successor', cwd: repository, prd: '# 功能\n## 验收标准\n1. 保存记录并可查询' })
    const implementer = await service.createAgent({ name: 'Schema Retry Implementer', role: 'Software Engineer', persona: 'Implement.' })
    const verifier = await service.createAgent({ name: 'Schema Retry Verifier', role: 'Test Engineer', persona: 'Verify.' })
    await service.addProjectAgents(project.id, { members: [
      { agentId: implementer.id, projectRole: 'Software Engineer', deliveryRoles: ['implementer'], autoAssignable: true },
      { agentId: verifier.id, projectRole: 'Test Engineer', deliveryRoles: ['verifier'], autoAssignable: true },
    ] })
    await addTrustedCapabilities(store, project.id, implementer.id, ['language.typescript', 'testing.automation'])
    await addTrustedCapabilities(store, project.id, verifier.id, ['language.typescript', 'testing.automation', 'testing.verification'])

    await service.startDecomposition(project.id)
    await waitForPlanning(store, project.id)
    const original = [...store.planningOperations.records.values()].at(-1)
    const repair = [...store.planningRepairAttempts.records.values()].at(-1)
    await service.retryPlanningRepairV3(project.id, repair.id, { expectedRepairDigest: repair.repairDigest, idempotencyKey: 'repair-schema-before-policy' })
    const failedProject = await waitForProject(store, project.id, (item) => item.status !== 'decomposing' && store.planningOperations.get(store.planningRepairAttempts.get(repair.id).successorOperationId)?.status === 'failed')
    const failedRepair = store.planningRepairAttempts.get(repair.id)
    const failedSuccessor = store.planningOperations.get(failedRepair.successorOperationId)

    assert.equal(failedProject.status, 'draft')
    assert.equal(original.status, 'blocked')
    assert.equal(failedSuccessor.status, 'failed')
    assert.equal(failedSuccessor.diagnostics.some((diagnostic) => diagnostic.code === 'planning-v3-failed'), true)
    assert.equal(failedRepair.status, 'failed')

    emitInvalidPlan = false
    await service.retryPlanningRepairV3(project.id, repair.id, { expectedRepairDigest: repair.repairDigest, idempotencyKey: 'retry-schema-after-contract-fix' })
    const repairedProject = await waitForPlanning(store, project.id)
    const resolvedRepair = store.planningRepairAttempts.get(repair.id)
    const successfulSuccessor = store.planningOperations.get(resolvedRepair.successorOperationId)

    assert.equal(repairedProject.status, 'awaiting_approval', repairedProject.lastError)
    assert.equal(store.planningOperations.get(failedSuccessor.id).status, 'failed')
    assert.notEqual(successfulSuccessor.id, failedSuccessor.id)
    assert.equal(successfulSuccessor.status, 'committed')
    assert.equal(resolvedRepair.status, 'resolved')
    assert.equal(resolvedRepair.attempt, repair.attempt)
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('Planning V3 repair retry reopens a generated-output or provider-failed successor without consuming the semantic attempt budget', async () => {
  const root = await mkdtemp(join(tmpdir(), 'po-v3-repair-provider-retry-'))
  try {
    const repository = await createPlanningV3Fixture(root)
    const store = memoryStore()
    const repairFinding = { code: 'plan-context-incomplete', severity: 'blocking', subjectType: 'task', subjectId: 'TASK-IMPLEMENT', evidenceIds: [], message: 'The task context does not close the impact chain.', repairOwner: 'plan', restartStage: 'task_plan' }
    let emitInvalidRepairPlan = false
    const observation = {
      planReviewResponse: ({ generated, call }) => call === 1 ? { ...generated, status: 'changes_requested', findings: [repairFinding] } : generated,
      plannerV3Response: ({ generated }) => emitInvalidRepairPlan ? {
        ...generated,
        tasks: generated.tasks.map((task, index) => index === 0 ? { ...task, scenarioKeys: [], contextPack: { ...task.contextPack, verificationSteps: [] } } : task),
      } : generated,
    }
    const service = new OrchestratorService(agentContext('unused', observation), store, undefined, undefined, { planningContractMode: 'v3-candidate' })
    const project = await service.createProjectFromRequest({ mode: 'empty', name: 'Provider retry successor', cwd: repository, prd: '# 功能\n## 验收标准\n1. 保存记录并可查询' })
    const implementer = await service.createAgent({ name: 'Provider Retry Implementer', role: 'Software Engineer', persona: 'Implement.' })
    const verifier = await service.createAgent({ name: 'Provider Retry Verifier', role: 'Test Engineer', persona: 'Verify.' })
    await service.addProjectAgents(project.id, { members: [
      { agentId: implementer.id, projectRole: 'Software Engineer', deliveryRoles: ['implementer'], autoAssignable: true },
      { agentId: verifier.id, projectRole: 'Test Engineer', deliveryRoles: ['verifier'], autoAssignable: true },
    ] })
    await addTrustedCapabilities(store, project.id, implementer.id, ['language.typescript', 'testing.automation'])
    await addTrustedCapabilities(store, project.id, verifier.id, ['language.typescript', 'testing.automation', 'testing.verification'])

    await service.startDecomposition(project.id)
    await waitForPlanning(store, project.id)
    const predecessor = [...store.planningOperations.records.values()].at(-1)
    const repair = [...store.planningRepairAttempts.records.values()].at(-1)
    emitInvalidRepairPlan = true
    await service.retryPlanningRepairV3(project.id, repair.id, { expectedRepairDigest: repair.repairDigest, idempotencyKey: 'create-provider-failure' })
    await waitForProject(store, project.id, (item) => item.status !== 'decomposing' && store.planningRepairAttempts.get(repair.id)?.status === 'failed')
    const failedRepair = store.planningRepairAttempts.get(repair.id)
    const failedSuccessor = store.planningOperations.get(failedRepair.successorOperationId)
    await store.planningOperations.put(failedSuccessor.id, {
      ...failedSuccessor,
      diagnostics: [
        { code: 'mutation-source-policy-coverage-incomplete', severity: 'blocking', message: 'The generated Task plan omitted a required zero-write rejection case.', subjectIds: [] },
        { code: 'planning-v3-failed', severity: 'blocking', message: 'Generated output failed the deterministic task_plan gate.', subjectIds: ['mutation-source-policy-coverage-incomplete'] },
      ],
    })
    emitInvalidRepairPlan = false
    const upstreamCallsBeforeRetry = {
      requirementAnalysis: observation.requirementAnalysisCalls,
      scenario: observation.scenarioCalls,
      binding: observation.bindingCalls,
      planner: observation.plannerV3Calls,
    }

    await service.retryPlanningRepairV3(project.id, repair.id, { expectedRepairDigest: repair.repairDigest, idempotencyKey: 'retry-provider-failure' })
    const repairedProject = await waitForPlanning(store, project.id)
    const resolvedRepair = store.planningRepairAttempts.get(repair.id)
    const successfulSuccessor = store.planningOperations.get(resolvedRepair.successorOperationId)

    assert.equal(repairedProject.status, 'awaiting_approval', repairedProject.lastError)
    assert.equal(store.planningOperations.get(failedSuccessor.id).status, 'failed')
    assert.notEqual(successfulSuccessor.id, failedSuccessor.id)
    assert.equal(successfulSuccessor.predecessorOperationId, failedSuccessor.id)
    assert.equal(successfulSuccessor.status, 'committed')
    assert.equal(resolvedRepair.status, 'resolved')
    assert.equal(resolvedRepair.attempt, repair.attempt)
    assert.equal(observation.requirementAnalysisCalls, upstreamCallsBeforeRetry.requirementAnalysis)
    assert.equal(observation.scenarioCalls, upstreamCallsBeforeRetry.scenario)
    assert.equal(observation.bindingCalls, upstreamCallsBeforeRetry.binding)
    assert.equal(observation.plannerV3Calls, upstreamCallsBeforeRetry.planner + 1)
    assert.equal(observation.prompts.some((prompt) => prompt.includes('rejected non-loopback Peer') && prompt.includes('assert zero business writes')), true)
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('Planning V3 operation retry resumes a transiently failed stage with CAS, idempotency, and immutable upstream reuse', async () => {
  const root = await mkdtemp(join(tmpdir(), 'po-v3-operation-retry-'))
  try {
    const repository = await createPlanningV3Fixture(root)
    const store = memoryStore()
    const observation = {}
    const service = new OrchestratorService(agentContext('unused', observation), store, undefined, undefined, { planningContractMode: 'v3-candidate' })
    const project = await service.createProjectFromRequest({ mode: 'empty', name: 'Provider stage retry', cwd: repository, prd: '# Feature\n## Acceptance\n1. Save and query the record' })
    const implementer = await service.createAgent({ name: 'Retry Implementer', role: 'Software Engineer', persona: 'Implement.' })
    const verifier = await service.createAgent({ name: 'Retry Verifier', role: 'Test Engineer', persona: 'Verify.' })
    await service.addProjectAgents(project.id, { members: [
      { agentId: implementer.id, projectRole: 'Software Engineer', deliveryRoles: ['implementer'], autoAssignable: true },
      { agentId: verifier.id, projectRole: 'Test Engineer', deliveryRoles: ['verifier'], autoAssignable: true },
    ] })
    await addTrustedCapabilities(store, project.id, implementer.id, ['language.typescript', 'testing.automation'])
    await addTrustedCapabilities(store, project.id, verifier.id, ['language.typescript', 'testing.automation', 'testing.verification'])

    await service.startDecomposition(project.id)
    const firstProject = await waitForPlanning(store, project.id)
    const predecessor = [...store.planningOperations.records.values()].find((operation) => operation.id === firstProject.activePlanningOperationId)
      ?? [...store.planningOperations.records.values()].filter((operation) => operation.projectId === project.id && operation.status === 'committed').at(-1)
    assert.equal(predecessor.status, 'committed')
    const failedAt = new Date().toISOString()
    const failedPredecessor = {
      ...predecessor,
      status: 'failed',
      stage: 'scenario_completion',
      diagnostics: [{ code: 'agent-empty-response', severity: 'blocking', message: 'Agent completed without a text response.', subjectIds: [] }],
      updatedAt: failedAt,
      completedAt: failedAt,
    }
    await store.planningOperations.put(failedPredecessor.id, failedPredecessor)
    const analysisCallsBeforeRetry = observation.requirementAnalysisCalls
    const scenarioCallsBeforeRetry = observation.scenarioCalls

    await assert.rejects(() => service.retryPlanningOperationV3(project.id, failedPredecessor.id, { expectedOperationUpdatedAt: 'stale', idempotencyKey: 'retry-stage' }), (error) => error.code === 'planning-operation-stale' && error.status === 409)
    await service.retryPlanningOperationV3(project.id, failedPredecessor.id, { expectedOperationUpdatedAt: failedAt, idempotencyKey: 'retry-stage' })
    const retriedProject = await waitForPlanning(store, project.id)
    const successor = [...store.planningOperations.records.values()].find((operation) => operation.predecessorOperationId === failedPredecessor.id)

    assert.equal(retriedProject.status, 'awaiting_approval', retriedProject.lastError)
    assert.equal(successor.status, 'committed')
    assert.equal(successor.predecessorOperationId, failedPredecessor.id)
    assert.equal(observation.requirementAnalysisCalls, analysisCallsBeforeRetry)
    assert.equal(observation.scenarioCalls, scenarioCallsBeforeRetry + 1)
    const replayed = await service.retryPlanningOperationV3(project.id, failedPredecessor.id, { expectedOperationUpdatedAt: failedAt, idempotencyKey: 'retry-stage' })
    assert.equal(replayed.id, project.id)
    assert.equal([...store.planningOperations.records.values()].filter((operation) => operation.predecessorOperationId === failedPredecessor.id).length, 1)

    const nonRetryableAt = new Date(Date.now() + 1).toISOString()
    await store.planningOperations.put(successor.id, {
      ...successor,
      status: 'blocked',
      stage: 'binding_review',
      diagnostics: [{ code: 'binding-review-blocked', severity: 'blocking', message: 'Binding repair is required.', subjectIds: [] }],
      updatedAt: nonRetryableAt,
      completedAt: nonRetryableAt,
    })
    await assert.rejects(() => service.retryPlanningOperationV3(project.id, successor.id, { expectedOperationUpdatedAt: nonRetryableAt, idempotencyKey: 'do-not-bypass-review' }), (error) => error.code === 'planning-operation-not-retryable' && error.status === 409)
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('Planning V3 preserves the latest frozen Review findings when the semantic repair budget is exhausted', async () => {
  const root = await mkdtemp(join(tmpdir(), 'po-v3-repair-budget-diagnostics-'))
  try {
    const repository = await createPlanningV3Fixture(root)
    const store = memoryStore()
    const observation = {
      bindingReviewResponse: ({ generated, call }) => ({
        ...generated,
        status: 'changes_requested',
        findings: [{
          code: `binding-gap-${call}`,
          severity: 'error',
          subjectType: 'binding',
          subjectId: 'BIND-REQ-001',
          evidenceIds: ['src/records.ts'],
          message: `Binding gap ${call} remains unresolved.`,
          repairOwner: 'binding',
          restartStage: 'code_binding',
        }],
      }),
    }
    const service = new OrchestratorService(agentContext('unused', observation), store, undefined, undefined, { planningContractMode: 'v3-candidate' })
    const project = await service.createProjectFromRequest({ mode: 'empty', name: 'Repair budget diagnostics', cwd: repository, prd: '# Feature\n## Acceptance\n1. Save and query the record' })

    await service.startDecomposition(project.id)
    await waitForPlanning(store, project.id)
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      const predecessor = [...store.planningOperations.records.values()].at(-1)
      const repair = [...store.planningRepairAttempts.records.values()].find((item) => item.operationId === predecessor.id && item.status === 'requested')
      assert.equal(repair?.attempt, attempt)
      await service.retryPlanningRepairV3(project.id, repair.id, { expectedRepairDigest: repair.repairDigest, idempotencyKey: `repair-budget-${attempt}` })
      await waitForPlanning(store, project.id)
    }

    const finalOperation = [...store.planningOperations.records.values()].at(-1)
    assert.equal(finalOperation.status, 'blocked')
    assert.equal(finalOperation.stage, 'binding_review')
    assert.equal(finalOperation.diagnostics.some((item) => item.code === 'binding-gap-4' && item.message === 'Binding gap 4 remains unresolved.'), true)
    assert.equal(finalOperation.diagnostics.some((item) => item.code === 'planning-repair-attempts-exhausted' && item.subjectIds.includes('BIND-REQ-001')), true)
    assert.equal([...store.planningRepairAttempts.records.values()].filter((item) => item.reviewKind === 'binding').length, 3)
    assert.equal(observation.bindingReviewCalls, 4)
    const repairBindingPrompts = observation.prompts.filter((prompt) => prompt.includes('Repository Binding V3 JSON object') && prompt.includes('Successor repair findings owned by repository Binding'))
    assert.equal(repairBindingPrompts.length, 3)
    for (const prompt of repairBindingPrompts) {
      assert.match(prompt, /include the repository evidence for its declaring module, add the declaring symbol to ownerSymbols, and include its repository-relative file in allowedPathScopes/)
      assert.match(prompt, /bind the existing compatibility\/migration initialization owner and its startup-order, write, failure, rollback, and test surfaces/)
      assert.match(prompt, /For every frozen Scenario eventObservables entry, emit exactly one structured eventFactChains entry/)
      assert.match(prompt, /a broad directory or importing consumer is not a substitute/)
      assert.ok(prompt.indexOf('Successor repair findings owned by repository Binding') > prompt.indexOf('Allowed evidence refs:'))
    }
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('Planning V3 repair fails closed when an inherited upstream proposal was mutated', async () => {
  const root = await mkdtemp(join(tmpdir(), 'po-v3-plan-repair-upstream-stale-'))
  try {
    const repository = await createPlanningV3Fixture(root)
    const store = memoryStore()
    const repairFinding = { code: 'plan-context-incomplete', severity: 'blocking', subjectType: 'task', subjectId: 'TASK-IMPLEMENT', evidenceIds: [], message: 'The task context does not close the impact chain.', repairOwner: 'plan', restartStage: 'task_plan' }
    const observation = { planReviewResponse: ({ generated, call }) => call === 1 ? { ...generated, status: 'changes_requested', findings: [repairFinding] } : generated }
    const service = new OrchestratorService(agentContext('unused', observation), store, undefined, undefined, { planningContractMode: 'v3-candidate' })
    const project = await service.createProjectFromRequest({ mode: 'empty', name: 'Stale repair predecessor', cwd: repository, prd: '# 功能\n## 验收标准\n1. 保存记录并可查询' })
    const implementer = await service.createAgent({ name: 'Stale Repair Implementer', role: 'Software Engineer', persona: 'Implement.' })
    const verifier = await service.createAgent({ name: 'Stale Repair Verifier', role: 'Test Engineer', persona: 'Verify.' })
    await service.addProjectAgents(project.id, { members: [
      { agentId: implementer.id, projectRole: 'Software Engineer', deliveryRoles: ['implementer'], autoAssignable: true },
      { agentId: verifier.id, projectRole: 'Test Engineer', deliveryRoles: ['verifier'], autoAssignable: true },
    ] })
    await addTrustedCapabilities(store, project.id, implementer.id, ['language.typescript', 'testing.automation'])
    await addTrustedCapabilities(store, project.id, verifier.id, ['language.typescript', 'testing.automation', 'testing.verification'])

    await service.startDecomposition(project.id)
    await waitForPlanning(store, project.id)
    const predecessor = [...store.planningOperations.records.values()].at(-1)
    const repair = [...store.planningRepairAttempts.records.values()].at(-1)
    const proposal = store.requirementAnalysisProposals.get(predecessor.requirementAnalysisProposalId)
    await store.requirementAnalysisProposals.put(proposal.id, { ...proposal, analysis: { ...proposal.analysis, summary: `${proposal.analysis.summary} tampered` } })

    await service.retryPlanningRepairV3(project.id, repair.id, { expectedRepairDigest: repair.repairDigest, idempotencyKey: 'repair-stale-upstream' })
    const settled = await waitForPlanning(store, project.id)
    const failedRepair = store.planningRepairAttempts.get(repair.id)
    const successor = store.planningOperations.get(failedRepair.successorOperationId)

    assert.equal(settled.status, 'draft')
    assert.match(settled.lastError, /predecessor Requirement Analysis cannot be reused safely/i)
    assert.equal(successor.status, 'failed')
    assert.equal(successor.stage, 'requirement_analysis')
    assert.equal(successor.diagnostics.at(-1).code, 'planning-repair-upstream-stale')
    assert.equal(failedRepair.status, 'failed')
    assert.equal(observation.requirementAnalysisCalls, 1)
    assert.equal(observation.scenarioCalls, 1)
    assert.equal(observation.bindingCalls, 1)
    assert.equal(observation.plannerV3Calls, 1)
    assert.equal(store.tasks.size, 0)
    assert.equal(store.planSnapshots.size, 0)
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('Planning V3 repairs an in-scope Requirement that initially has no required Acceptance', async () => {
  const root = await mkdtemp(join(tmpdir(), 'po-v3-requirement-acceptance-repair-'))
  try {
    const repository = await createPlanningV3Fixture(root)
    const store = memoryStore()
    const observation = {
      requirementAnalysisResponse: ({ generated, call }) => call === 1
        ? { ...generated, requirements: generated.requirements.map((requirement, index) => index === 0 ? { ...requirement, acceptanceCriteria: [] } : requirement) }
        : generated,
    }
    const service = new OrchestratorService(agentContext('unused', observation), store, undefined, undefined, { planningContractMode: 'v3-candidate' })
    const project = await service.createProjectFromRequest({ mode: 'empty', name: 'Requirement acceptance repair', cwd: repository, prd: '# 功能\n## 验收标准\n1. 保存记录' })
    const implementer = await service.createAgent({ name: 'Acceptance Implementer', role: 'Software Engineer', persona: 'Implement.' })
    const verifier = await service.createAgent({ name: 'Acceptance Verifier', role: 'Test Engineer', persona: 'Verify.' })
    await service.addProjectAgents(project.id, { members: [
      { agentId: implementer.id, projectRole: 'Software Engineer', deliveryRoles: ['implementer'], autoAssignable: true },
      { agentId: verifier.id, projectRole: 'Test Engineer', deliveryRoles: ['verifier'], autoAssignable: true },
    ] })
    await addTrustedCapabilities(store, project.id, implementer.id, ['language.typescript', 'testing.automation'])
    await addTrustedCapabilities(store, project.id, verifier.id, ['language.typescript', 'testing.automation', 'testing.verification'])

    await service.startDecomposition(project.id)
    const settled = await waitForPlanning(store, project.id)

    assert.equal(settled.status, 'awaiting_approval', settled.lastError)
    assert.equal(observation.requirementAnalysisCalls, 2)
    assert.match(observation.requirementAnalysisPrompts[0], /self-check every requirements\[i\] where scope=in_scope/)
    assert.match(observation.requirementAnalysisPrompts[1], /An in_scope Requirement is invalid unless its own acceptanceCriteria contains at least one required=true criterion/)
    assert.match(observation.requirementAnalysisPrompts[1], /Requirement .* has no required acceptance criterion/)
    assert.equal(store.projectTasks(settled).length, 2)
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('Planning V3 repairs invalid Requirement scenario and diagnostic fields without weakening the parser', async () => {
  const root = await mkdtemp(join(tmpdir(), 'po-v3-requirement-shape-repair-'))
  try {
    const repository = await createPlanningV3Fixture(root)
    const store = memoryStore()
    const observation = {
      requirementAnalysisResponse: ({ generated, call }) => call === 1
        ? {
            ...generated,
            requirements: generated.requirements.map((requirement, index) => index === 0 ? { ...requirement, acceptanceCriteria: requirement.acceptanceCriteria.map((criterion) => ({ ...criterion, scenario: 'success' })) } : requirement),
            diagnostics: [{ code: 'shape-test', severity: 'error', message: 'Invalid test response.', sourceRefs: generated.requirements[0].sourceRefs, key: 'REQ-001' }],
          }
        : generated,
    }
    const service = new OrchestratorService(agentContext('unused', observation), store, undefined, undefined, { planningContractMode: 'v3-candidate' })
    const project = await service.createProjectFromRequest({ mode: 'empty', name: 'Requirement shape repair', cwd: repository, prd: '# 功能\n## 验收标准\n1. 保存记录' })
    const implementer = await service.createAgent({ name: 'Shape Implementer', role: 'Software Engineer', persona: 'Implement.' })
    const verifier = await service.createAgent({ name: 'Shape Verifier', role: 'Test Engineer', persona: 'Verify.' })
    await service.addProjectAgents(project.id, { members: [
      { agentId: implementer.id, projectRole: 'Software Engineer', deliveryRoles: ['implementer'], autoAssignable: true },
      { agentId: verifier.id, projectRole: 'Test Engineer', deliveryRoles: ['verifier'], autoAssignable: true },
    ] })
    await addTrustedCapabilities(store, project.id, implementer.id, ['language.typescript', 'testing.automation'])
    await addTrustedCapabilities(store, project.id, verifier.id, ['language.typescript', 'testing.automation', 'testing.verification'])

    await service.startDecomposition(project.id)
    const settled = await waitForPlanning(store, project.id)

    assert.equal(settled.status, 'awaiting_approval', settled.lastError)
    assert.equal(observation.requirementAnalysisCalls, 2)
    assert.match(observation.requirementAnalysisPrompts[0], /must equal exactly one of happy_path, business_rejection, boundary, dependency_failure, security, compatibility, or recovery/)
    assert.match(observation.requirementAnalysisPrompts[0], /Every diagnostic object must contain exactly code, severity, message, and sourceRefs/)
    assert.match(observation.requirementAnalysisPrompts[1], /never add key, subjectId, or subjectIds/)
    assert.match(observation.requirementAnalysisPrompts[1], /Invalid option: expected one of/)
    assert.equal(store.projectTasks(settled).length, 2)
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('Planning V3 repairs a Decision reference to a missing Requirement key before persistence', async () => {
  const root = await mkdtemp(join(tmpdir(), 'po-v3-decision-reference-repair-'))
  try {
    const repository = await createPlanningV3Fixture(root)
    const store = memoryStore()
    const observation = {
      requirementAnalysisResponse: ({ generated, call }) => call === 1
        ? { ...generated, requirements: generated.requirements.map((requirement) => ({ ...requirement, key: 'REQ-002' })) }
        : { ...generated, status: 'needs_decision' },
    }
    const service = new OrchestratorService(agentContext('unused', observation), store, undefined, undefined, { planningContractMode: 'v3-candidate' })
    const project = await service.createProjectFromRequest({ mode: 'empty', name: 'Decision reference repair', cwd: repository, prd: '# 功能\n## 验收标准\n1. 保存记录\n## 待确认\n1. 是否保留历史？' })

    await service.startDecomposition(project.id)
    const settled = await waitForPlanning(store, project.id)
    const operation = [...store.planningOperations.records.values()].at(-1)

    assert.equal(settled.status, 'draft')
    assert.equal(operation.status, 'blocked')
    assert.equal(operation.stage, 'decision_effect_precheck')
    assert.equal(observation.requirementAnalysisCalls, 2)
    assert.match(observation.requirementAnalysisPrompts[0], /Every Decision affectedRequirementKeys entry must equal a key in the returned requirements array/)
    assert.match(observation.requirementAnalysisPrompts[1], /Frozen Decision references are immutable/)
    assert.match(observation.requirementAnalysisPrompts[1], /references unknown requirement/)
    assert.equal(service.listProjectRequirementDecisions(project.id).some((decision) => decision.status === 'pending'), true)
    assert.equal(store.tasks.size, 0)
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('Planning V3 rejects a Decision option without a complete source-grounded effect before task planning', async () => {
  const root = await mkdtemp(join(tmpdir(), 'po-v3-decision-option-effect-'))
  try {
    const repository = await createPlanningV3Fixture(root)
    const store = memoryStore()
    const observation = {
      requirementAnalysisResponse: ({ generated }) => ({
        ...generated,
        status: 'needs_decision',
        decisions: generated.decisions.map((decision) => ({ ...decision, options: decision.options.map(({ affectedDimensions: _dimensions, ...option }) => option) })),
      }),
    }
    const service = new OrchestratorService(agentContext('unused', observation), store, undefined, undefined, { planningContractMode: 'v3-candidate' })
    const project = await service.createProjectFromRequest({ mode: 'empty', name: 'Incomplete option effect', cwd: repository, prd: '# 功能\n## 验收标准\n1. 保存记录\n## 待确认\n1. 是否保留历史？' })
    await service.startDecomposition(project.id)
    const settled = await waitForPlanning(store, project.id)
    const operation = [...store.planningOperations.records.values()].at(-1)
    assert.equal(settled.status, 'draft')
    assert.equal(operation.status, 'failed')
    assert.equal(operation.stage, 'requirement_analysis')
    assert.match(settled.lastError, /missing its structured delivery effect/i)
    assert.equal(store.requirementDecisionOptionEffects.size, 0)
    assert.equal(store.tasks.size, 0)
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('Planning V3 persists low-impact delivery Decisions and resumes through a successor after explicit resolution', async () => {
  const root = await mkdtemp(join(tmpdir(), 'po-v3-decision-successor-'))
  try {
    const repository = await createPlanningV3Fixture(root)
    const store = memoryStore()
    const observation = {}
    const service = new OrchestratorService(agentContext('unused', observation), store, undefined, undefined, { planningContractMode: 'v3-candidate' })
    const project = await service.createProjectFromRequest({ mode: 'empty', name: 'Decision successor', cwd: repository, prd: '# 功能\n## 验收标准\n1. 保存记录并可查询\n## 待确认\n1. 是否保留历史记录？' })
    const implementer = await service.createAgent({ name: 'Decision Implementer', role: 'Software Engineer', persona: 'Implement.' })
    const verifier = await service.createAgent({ name: 'Decision Verifier', role: 'Test Engineer', persona: 'Verify.' })
    await service.addProjectAgents(project.id, { members: [
      { agentId: implementer.id, projectRole: 'Software Engineer', deliveryRoles: ['implementer'], autoAssignable: true },
      { agentId: verifier.id, projectRole: 'Test Engineer', deliveryRoles: ['verifier'], autoAssignable: true },
    ] })
    await addTrustedCapabilities(store, project.id, implementer.id, ['language.typescript', 'testing.automation'])
    await addTrustedCapabilities(store, project.id, verifier.id, ['language.typescript', 'testing.automation', 'testing.verification'])

    await service.startDecomposition(project.id)
    const blockedProject = await waitForPlanning(store, project.id)
    const predecessor = [...store.planningOperations.records.values()].at(-1)
    const predecessorSnapshot = structuredClone(predecessor)
    const pendingDecision = service.listProjectRequirementDecisions(project.id).find((decision) => decision.status === 'pending')
    const repair = [...store.planningRepairAttempts.records.values()].find((item) => item.operationId === predecessor.id && item.repairOwner === 'human_decision')

    assert.equal(blockedProject.status, 'draft')
    assert.equal(predecessor.stage, 'decision_effect_precheck')
    assert.equal(predecessor.status, 'blocked')
    assert.equal(pendingDecision.impact, 'low')
    assert.equal(pendingDecision.affectedTaskIds.length, 0)
    const predecessorOptionEffects = [...store.requirementDecisionOptionEffects.records.values()].filter((effect) => effect.operationId === predecessor.id)
    const predecessorPlanningEffects = [...store.requirementDecisionPlanningEffects.records.values()].filter((effect) => effect.operationId === predecessor.id)
    assert.equal(predecessorOptionEffects.length, pendingDecision.options.length)
    assert.equal(predecessorPlanningEffects.length, 1)
    assert.equal(predecessorPlanningEffects[0].phase, 'precheck')
    assert.equal(predecessorPlanningEffects[0].blocksPlanning, true)
    assert.equal(predecessorPlanningEffects[0].determination, 'conservative_default')
    assert.match(observation.requirementReviewPrompts.at(-1), /Do not reject the analysis or mark an acceptance untestable merely because such a Decision has not been chosen yet/)
    assert.match(observation.requirementReviewPrompts.at(-1), /"conflicts":\[\{"sourceRefs":\["source-anchor-id"\],"statement":"the conflicting statements","impact":"how the conflict affects delivery or testability"\}\]/)
    assert.equal(repair.status, 'requested')
    assert.equal(repair.findings[0].requiredUserAction, 'resolve_decision')

    const resolved = await service.resolveProjectRequirementDecision(project.id, pendingDecision.id, { status: 'resolved', chosenOption: 'proceed', resolution: 'Retain history with an auditable record.', decidedBy: 'product-owner' })
    assert.equal(resolved.status, 'resolved')
    const repairedProject = await waitForPlanning(store, project.id)
    const settledRepair = store.planningRepairAttempts.get(repair.id)
    const successor = store.planningOperations.get(settledRepair.successorOperationId)
    const currentDecision = service.getProjectRequirementMatrix(project.id).decisions.find((decision) => decision.key === pendingDecision.key)

    assert.equal(repairedProject.status, 'awaiting_approval', repairedProject.lastError)
    assert.deepEqual(store.planningOperations.get(predecessor.id), predecessorSnapshot)
    assert.equal(successor.predecessorOperationId, predecessor.id)
    assert.equal(successor.status, 'committed')
    assert.equal(settledRepair.status, 'resolved')
    assert.equal(currentDecision.status, 'resolved')
    assert.equal(currentDecision.chosenOption, 'proceed')
    assert.match(observation.requirementAnalysisPrompts.at(-1), /Do not create a new Acceptance solely to restate chosenOption or resolution/)
    assert.match(observation.requirementReviewPrompts.at(-1), /Do not require Requirement Analysis to create a second Acceptance or consume a second source anchor/)
    assert.match(observation.scenarioPrompts.at(-1), /Resolved Decisions with selected options \(Service-owned facts\)/)
    assert.match(observation.scenarioPrompts.at(-1), /"chosenOption":"proceed"/)
    assert.match(observation.scenarioPrompts.at(-1), /"resolution":"Retain history with an auditable record\."/)
    const successorPlanningEffects = [...store.requirementDecisionPlanningEffects.records.values()].filter((effect) => effect.operationId === successor.id)
    assert.deepEqual(successorPlanningEffects.map((effect) => effect.phase).sort(), ['final', 'precheck'])
    assert.equal(successorPlanningEffects.every((effect) => effect.blocksPlanning === false && effect.decisionResolutionRevision === currentDecision.resolutionRevision), true)
    assert.equal(successor.decisionEffectPrecheckDigest.length, 64)
    assert.equal(successor.decisionEffectFinalDigest.length, 64)
    assert.equal(store.projectTasks(repairedProject).length, 2)

    const snapshot = store.planSnapshots.get(repairedProject.currentPlanSnapshotId)
    const finalEffect = structuredClone(successorPlanningEffects.find((effect) => effect.phase === 'final'))
    await store.requirementDecisionPlanningEffects.put(finalEffect.id, { ...finalEffect, reason: 'tampered without a successor operation' })
    assert.equal(service.getProjectPlanningV3(project.id).planHealth.approvable, false)
    await assert.rejects(() => service.approvePlanningV3(project.id, { planSnapshotId: snapshot.id, planDigest: snapshot.planHash, projectRevision: repairedProject.revision, accessGrantSnapshotId: snapshot.accessGrantSnapshotId, accessGrantDigest: snapshot.accessGrantDigest, approverId: 'product-owner', idempotencyKey: 'reject-tampered-decision-effect' }), (error) => error.code === 'plan-approval-stale')
    await store.requirementDecisionPlanningEffects.put(finalEffect.id, finalEffect)
    const approval = await service.approvePlanningV3(project.id, { planSnapshotId: snapshot.id, planDigest: snapshot.planHash, projectRevision: repairedProject.revision, accessGrantSnapshotId: snapshot.accessGrantSnapshotId, accessGrantDigest: snapshot.accessGrantDigest, approverId: 'product-owner', idempotencyKey: 'approve-current-decision-effects' })
    assert.equal(approval.decisionEffectPrecheckDigest, snapshot.decisionEffectPrecheckDigest)
    assert.equal(approval.decisionEffectFinalDigest, snapshot.decisionEffectFinalDigest)
    await store.requirementDecisionPlanningEffects.put(finalEffect.id, { ...finalEffect, operationId: predecessor.id })
    await assert.rejects(() => service.dispatchPlanningV3(project.id, { approvalId: approval.id, expectedProjectRevision: repairedProject.revision, taskIds: snapshot.taskIds, idempotencyKey: 'reject-cross-operation-decision-effect' }), (error) => error.code === 'execution-dispatch-stale')
    await store.requirementDecisionPlanningEffects.put(finalEffect.id, finalEffect)
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('Planning V3 blocks zero-trusted-candidate plans without publishing tasks or a current plan pointer', async () => {
  const root = await mkdtemp(join(tmpdir(), 'po-v3-zero-candidate-'))
  try {
    const repository = await createPlanningV3Fixture(root)
    await writeFile(join(repository, 'src', 'untracked-owner.ts'), 'export const untrackedOwner = true\n')
    const store = memoryStore()
    const service = new OrchestratorService(agentContext(), store, undefined, undefined, { planningContractMode: 'v3-candidate' })
    const project = await service.createProjectFromRequest({ mode: 'empty', name: 'V3 blocked', cwd: repository, prd: '# 功能\n## 验收标准\n1. 保存记录' })
    const implementer = await service.createAgent({ name: 'Untrusted Implementer', role: 'Software Engineer', persona: 'Implement.', capabilities: ['language.typescript', 'testing.automation'] })
    const verifier = await service.createAgent({ name: 'Untrusted Verifier', role: 'Test Engineer', persona: 'Verify.', capabilities: ['language.typescript', 'testing.automation', 'testing.verification'] })
    await service.addProjectAgents(project.id, { members: [
      { agentId: implementer.id, projectRole: 'Software Engineer', deliveryRoles: ['implementer'], autoAssignable: true },
      { agentId: verifier.id, projectRole: 'Test Engineer', deliveryRoles: ['verifier'], autoAssignable: true },
    ] })

    await service.startDecomposition(project.id)
    const settled = await waitForPlanning(store, project.id)
    const operation = [...store.planningOperations.records.values()].at(-1)

    assert.equal(settled.status, 'draft')
    assert.equal(settled.currentPlanSnapshotId, undefined)
    assert.deepEqual(settled.taskIds, [])
    assert.equal(operation.status, 'blocked')
    assert.equal(operation.diagnostics.some((item) => item.code === 'abstained-no-eligible'), true)
    const evaluation = service.exportPlanningEvaluationV3(project.id, operation.id, { caseId: 'zero-candidate', runId: 'blocked-run' })
    assert.equal(evaluation.status, 'blocked')
    assert.equal(evaluation.assignments.length > 0, true)
    assert.equal(evaluation.assignments.every((assignment) => assignment.outcome === 'blocked' && assignment.agentId === undefined), true)
    const bindingPromptManifest = [...store.planningPromptReferenceManifests.records.values()].find((manifest) => manifest.operationId === operation.id && manifest.references.some((reference) => reference.kind === 'repository_evidence'))
    assert.equal(bindingPromptManifest.references.some((reference) => reference.artifactId === 'src/untracked-owner.ts'), false)
    const evidenceReport = store.repositoryEvidenceRetrievalReports.get(operation.repositoryEvidenceRetrievalReportId)
    assert.equal(evidenceReport.selectedEvidenceIds.includes('src/untracked-owner.ts'), false)
    assert.equal(bindingPromptManifest.references.every((reference) => /^[a-f0-9]{64}$/.test(reference.artifactDigest)), true)
    assert.equal(store.tasks.size, 0)
    assert.equal(store.planSnapshots.size, 0)
    assert.ok(store.agentCapabilityClaims.size > 0)
    assert.equal([...store.agentCapabilityClaims.records.values()].every((claim) => claim.status === 'pending'), true)
    const pendingClaims = [...store.agentCapabilityClaims.records.values()]
    const originalPutClaim = store.agentCapabilityClaims.put.bind(store.agentCapabilityClaims)
    let activeWriteCount = 0
    store.agentCapabilityClaims.put = async (id, value) => {
      if (value.status === 'active' && ++activeWriteCount === 2) throw new Error('capability confirmation persistence failed')
      return originalPutClaim(id, value)
    }
    await assert.rejects(() => service.confirmProjectCapabilityClaims(project.id, { actor: 'team-owner', reason: 'Reviewed against the controlled capability definition.', claims: pendingClaims.map((claim) => ({ claimId: claim.id, expectedClaimDigest: claim.claimDigest })) }), /capability confirmation persistence failed/)
    store.agentCapabilityClaims.put = originalPutClaim
    assert.equal(service.listProjectCapabilityClaims(project.id).filter((claim) => claim.status === 'active').length, 0)
    await service.confirmProjectCapabilityClaims(project.id, { actor: 'team-owner', reason: 'Reviewed against the controlled capability definition.', claims: pendingClaims.map((claim) => ({ claimId: claim.id, expectedClaimDigest: claim.claimDigest })) })
    assert.equal(service.listProjectCapabilityClaims(project.id).filter((claim) => claim.status === 'active').length, store.agentCapabilityClaims.size / 2)
    await service.startDecomposition(project.id)
    const recovered = await waitForPlanning(store, project.id)
    assert.equal(recovered.status, 'awaiting_approval')
    assert.equal(store.projectTasks(recovered).length, 2)
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('Planning V3 approval fails closed when repository content changes after planning', async () => {
  const root = await mkdtemp(join(tmpdir(), 'po-v3-approval-stale-'))
  try {
    const repository = await createPlanningV3Fixture(root)
    const store = memoryStore()
    const observation = { resolveModelInfoError: new Error('model catalog unavailable') }
    const service = new OrchestratorService(agentContext('unused', observation), store, undefined, undefined, { planningContractMode: 'v3-candidate' })
    const project = await service.createProjectFromRequest({ mode: 'empty', name: 'V3 stale approval', cwd: repository, prd: '# 功能\n## 验收标准\n1. 保存记录' })
    const implementer = await service.createAgent({ name: 'Stale Implementer', role: 'Software Engineer', persona: 'Implement.' })
    const verifier = await service.createAgent({ name: 'Stale Verifier', role: 'Test Engineer', persona: 'Verify.' })
    await service.addProjectAgents(project.id, { members: [
      { agentId: implementer.id, projectRole: 'Software Engineer', deliveryRoles: ['implementer'], autoAssignable: true },
      { agentId: verifier.id, projectRole: 'Test Engineer', deliveryRoles: ['verifier'], autoAssignable: true },
    ] })
    await addTrustedCapabilities(store, project.id, implementer.id, ['language.typescript', 'testing.automation'])
    await addTrustedCapabilities(store, project.id, verifier.id, ['language.typescript', 'testing.automation', 'testing.verification'])
    await service.startDecomposition(project.id)
    const settled = await waitForPlanning(store, project.id)
    const operation = [...store.planningOperations.records.values()].at(-1)
    assert.equal(settled.status, 'awaiting_approval')
    assert.equal(operation.modelExecutionProvenance, undefined)
    assert.equal(observation.agentOptions.length > 0, true)
    const frozenPlanningOptions = observation.agentOptions.filter((options) => options.maxTokens !== undefined)
    assert.equal(frozenPlanningOptions.length > 0, true)
    assert.equal(frozenPlanningOptions.every((options) => options.provider === 'test' && options.model === 'test' && options.maxTokens === 16_384), true)
    assert.throws(() => service.exportPlanningEvaluationV3(project.id, operation.id, { caseId: 'model-info-unavailable', runId: 'run-1' }), (error) => error.code === 'planning-evaluation-provenance-unavailable')
    const snapshot = store.planSnapshots.get(settled.currentPlanSnapshotId)
    await writeFile(join(repository, 'src', 'records.ts'), 'export const records = new Map([["changed", true]])\n')

    await assert.rejects(() => service.approvePlanningV3(project.id, { planSnapshotId: snapshot.id, planDigest: snapshot.planHash, projectRevision: settled.revision, accessGrantSnapshotId: snapshot.accessGrantSnapshotId, accessGrantDigest: snapshot.accessGrantDigest, approverId: 'owner', idempotencyKey: 'stale-repository' }), (error) => error.code === 'planning-snapshot-stale')
    assert.equal(store.projects.get(project.id).status, 'awaiting_approval')
    assert.equal(store.planApprovalsV3.size, 0)
    assert.equal(store.taskRuns.size, 0)
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('Planning V3 shadow retains audit facts but never publishes project tasks or a current candidate', async () => {
  const root = await mkdtemp(join(tmpdir(), 'po-v3-shadow-'))
  try {
    const repository = await createPlanningV3Fixture(root)
    const store = memoryStore()
    const service = new OrchestratorService(agentContext(), store, undefined, undefined, { planningContractMode: 'v3-shadow' })
    const project = await service.createProjectFromRequest({ mode: 'empty', name: 'V3 shadow', cwd: repository, prd: '# 功能\n## 验收标准\n1. 保存记录' })
    const implementer = await service.createAgent({ name: 'Shadow Implementer', role: 'Software Engineer', persona: 'Implement.' })
    const verifier = await service.createAgent({ name: 'Shadow Verifier', role: 'Test Engineer', persona: 'Verify.' })
    await service.addProjectAgents(project.id, { members: [
      { agentId: implementer.id, projectRole: 'Software Engineer', deliveryRoles: ['implementer'], autoAssignable: true },
      { agentId: verifier.id, projectRole: 'Test Engineer', deliveryRoles: ['verifier'], autoAssignable: true },
    ] })
    await addTrustedCapabilities(store, project.id, implementer.id, ['language.typescript', 'testing.automation'])
    await addTrustedCapabilities(store, project.id, verifier.id, ['language.typescript', 'testing.automation', 'testing.verification'])

    await service.startDecomposition(project.id)
    const settled = await waitForPlanning(store, project.id)

    assert.equal(settled.status, 'draft')
    assert.equal(settled.currentPlanSnapshotId, undefined)
    assert.deepEqual(settled.taskIds, [])
    assert.equal(store.planSnapshots.size, 0)
    assert.equal(store.tasks.size, 0)
    const planningOperation = [...store.planningOperations.records.values()].at(-1)
    assert.equal(planningOperation.status, 'shadow_completed')
    assert.ok(store.requirementCodeBindings.size > 0)
    assert.ok(store.assignmentEvaluations.size > 0)
    const shadowEvaluation = store.planningShadowEvaluations.get(planningOperation.shadowEvaluationId)
    assert.equal(shadowEvaluation.planningOutcome, 'would_commit')
    assert.equal(shadowEvaluation.reachedStage, 'convergence_carry_validation')
    assert.equal(shadowEvaluation.metricPolicyId, planningOperation.metricPolicyId)
    assert.equal(store.planSnapshots.get(planningOperation.reservedPlanSnapshotId), undefined)

    const observations = [shadowEvaluation.id, ...planningOperation.assignmentEvaluationIds]
    const createdReport = await service.createPlanningMetricReleaseReportV3({ projectId: project.id, releaseId: 'shadow-canary-1', metricPolicyId: planningOperation.metricPolicyId, operationIds: [planningOperation.id], observationIds: observations, idempotencyKey: 'shadow-report-1' })
    const replayedReport = await service.createPlanningMetricReleaseReportV3({ projectId: project.id, releaseId: 'shadow-canary-1', metricPolicyId: planningOperation.metricPolicyId, operationIds: [planningOperation.id], observationIds: observations, idempotencyKey: 'shadow-report-1' })
    const canonicalReplay = await service.createPlanningMetricReleaseReportV3({ projectId: project.id, releaseId: 'shadow-canary-1', metricPolicyId: planningOperation.metricPolicyId, operationIds: [planningOperation.id], observationIds: observations, idempotencyKey: 'shadow-report-2' })
    assert.equal(createdReport.command.outcome, 'created')
    assert.equal(replayedReport.report.id, createdReport.report.id)
    assert.equal(canonicalReplay.command.outcome, 'replayed_existing')
    assert.equal(canonicalReplay.report.id, createdReport.report.id)
    assert.equal(createdReport.report.metricResults.find((item) => item.metricKey === 'planning_would_commit_rate').numerator, 1)
    assert.equal(createdReport.report.metricResults.every((item) => ['passed', 'failed', 'insufficient_sample'].includes(item.gate)), true)
    await assert.rejects(() => service.createPlanningMetricReleaseReportV3({ projectId: project.id, releaseId: 'changed-release', metricPolicyId: planningOperation.metricPolicyId, operationIds: [planningOperation.id], observationIds: observations, idempotencyKey: 'shadow-report-1' }), (error) => error.code === 'metric-report-idempotency-conflict')
    await assert.rejects(() => service.createPlanningMetricReleaseReportV3({ projectId: project.id, releaseId: 'shadow-canary-duplicate', metricPolicyId: planningOperation.metricPolicyId, operationIds: [planningOperation.id], observationIds: [shadowEvaluation.id, shadowEvaluation.id], idempotencyKey: 'shadow-report-duplicate' }), (error) => error.code === 'metric-report-duplicate-reference')
    const reportCountBeforeFailure = store.planningMetricReleaseReports.size
    const putReportCreate = store.planningMetricReleaseReportCreates.put.bind(store.planningMetricReleaseReportCreates)
    store.planningMetricReleaseReportCreates.put = async (id, value) => {
      if (value.idempotencyKey === 'shadow-report-rollback') throw new Error('report command persistence failed')
      return putReportCreate(id, value)
    }
    await assert.rejects(() => service.createPlanningMetricReleaseReportV3({ projectId: project.id, releaseId: 'shadow-canary-rollback', metricPolicyId: planningOperation.metricPolicyId, operationIds: [planningOperation.id], observationIds: observations, idempotencyKey: 'shadow-report-rollback' }), /report command persistence failed/)
    store.planningMetricReleaseReportCreates.put = putReportCreate
    assert.equal(store.planningMetricReleaseReports.size, reportCountBeforeFailure)
    assert.equal([...store.planningMetricReleaseReportCreates.records.values()].some((item) => item.idempotencyKey === 'shadow-report-rollback'), false)

    const fixtureInput = { responsibilityKey: 'TASK-IMPLEMENT', repositoryDigest: planningOperation.repositoryDigest, teamDigest: 'b'.repeat(64), metricPolicyId: planningOperation.metricPolicyId, expectedOutcome: 'selected', allowedOwnerIds: [implementer.id], allowedSquadMemberIds: [], expectedAbstentionReasonCodes: [], critical: true, rationaleEvidenceIds: [planningOperation.sourceManifestId], idempotencyKey: 'fixture-1' }
    const fixture = await service.createExpectedAssignmentFixtureV3(project.id, fixtureInput)
    assert.equal((await service.createExpectedAssignmentFixtureV3(project.id, fixtureInput)).id, fixture.id)
    await assert.rejects(() => service.createExpectedAssignmentFixtureV3(project.id, { ...fixtureInput, allowedOwnerIds: [verifier.id], idempotencyKey: 'fixture-2' }), (error) => error.code === 'assignment-fixture-conflict')
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('Planning V3 MetricPolicy publishing is append-only, idempotent, and project-scoped', async () => {
  const store = memoryStore()
  const service = new OrchestratorService(agentContext(), store)
  const project = await service.createProject({ name: 'Metric governance', summary: '', prd: 'Requirement', technicalDesign: '', owner: 'owner', cwd: process.cwd() })
  const projectSetDigest = digestObject({ projectId: project.id })
  const metrics = [{ key: 'assignment_selection_rate', numerator: 'selected assignment evaluations', denominator: 'all assignment evaluations', sampleWindow: 'frozen observation set', sampleCohort: 'production', projectSetDigest, minimumSampleSize: 3, aggregationAlgorithm: 'ratio', exclusions: [], canaryThreshold: '>= 0.80', releaseThreshold: '>= 0.95' }]
  const input = { version: 'project-v1', metrics, approvedBy: 'quality-owner', approvalReason: 'Project canary thresholds.', idempotencyKey: 'publish-project-v1' }
  const first = await service.publishPlanningMetricPolicyV3(project.id, input)
  const replay = await service.publishPlanningMetricPolicyV3(project.id, input)
  const semanticReplay = await service.publishPlanningMetricPolicyV3(project.id, { ...input, idempotencyKey: 'publish-project-v1-replay' })
  assert.equal(first.command.outcome, 'published')
  assert.equal(replay.policy.id, first.policy.id)
  assert.equal(semanticReplay.command.outcome, 'replayed_existing')
  assert.equal(semanticReplay.policy.id, first.policy.id)
  assert.equal(service.getPlanningMetricPolicyV3(project.id).id, first.policy.id)
  await assert.rejects(() => service.publishPlanningMetricPolicyV3(project.id, { ...input, approvalReason: 'Changed after publish.' }), (error) => error.code === 'metric-policy-idempotency-conflict')
  await assert.rejects(() => service.publishPlanningMetricPolicyV3(project.id, { ...input, approvalReason: 'Different immutable version content.', idempotencyKey: 'publish-project-v1-conflict' }), (error) => error.code === 'metric-policy-version-conflict')
  const concurrent = await Promise.allSettled([
    service.publishPlanningMetricPolicyV3(project.id, { ...input, version: 'project-v2', supersedesId: first.policy.id, approvalReason: 'Concurrent candidate A.', idempotencyKey: 'publish-project-v2-a' }),
    service.publishPlanningMetricPolicyV3(project.id, { ...input, version: 'project-v2', supersedesId: first.policy.id, approvalReason: 'Concurrent candidate B.', idempotencyKey: 'publish-project-v2-b' }),
  ])
  assert.equal(concurrent.filter((result) => result.status === 'fulfilled').length, 1)
  assert.equal(concurrent.filter((result) => result.status === 'rejected' && result.reason.code === 'metric-policy-version-conflict').length, 1)
  assert.equal(service.listPlanningMetricPoliciesV3(project.id).filter((policy) => policy.scopeProjectId === project.id && policy.version === 'project-v2').length, 1)
})

test('Planning V3 Shadow creates immutable terminal evaluations for blocked and failed operations', async () => {
  for (const outcome of ['blocked', 'failed']) {
    const root = await mkdtemp(join(tmpdir(), `po-v3-shadow-${outcome}-`))
    try {
      const repository = await createPlanningV3Fixture(root)
      const store = memoryStore()
      const observation = outcome === 'blocked' ? {
        scenarioReviewResponse: ({ generated }) => ({ ...generated, status: 'changes_requested', findings: [{ code: 'shadow-blocked', severity: 'blocking', subjectType: 'scenario', subjectId: 'SCN-AC-001-HAPPY_PATH', evidenceIds: [], message: 'Shadow review blocked.', repairOwner: 'scenario', restartStage: 'scenario_completion' }] }),
      } : {}
      const service = new OrchestratorService(agentContext('unused', observation), store, undefined, undefined, {
        planningContractMode: 'v3-shadow',
        ...(outcome === 'failed' ? { planningFailureInjector: ({ stage }) => { if (stage === 'requirement_review') throw new Error('injected shadow failure') } } : {}),
      })
      const project = await service.createProjectFromRequest({ mode: 'empty', name: `Shadow ${outcome}`, cwd: repository, prd: '# 功能\n## 验收标准\n1. 保存记录并可查询' })
      await service.startDecomposition(project.id)
      const settled = await waitForPlanning(store, project.id)
      const operation = [...store.planningOperations.records.values()].at(-1)
      const evaluation = store.planningShadowEvaluations.get(operation.shadowEvaluationId)
      assert.equal(settled.status, 'draft')
      assert.equal(operation.status, outcome)
      assert.equal(evaluation.planningOutcome, outcome)
      assert.equal(evaluation.operationId, operation.id)
      assert.equal(evaluation.metricPolicyId, operation.metricPolicyId)
      assert.equal(evaluation.blockingDiagnostics.length > 0, true)
      assert.equal(store.planSnapshots.size, 0)
      assert.equal(store.tasks.size, 0)
    } finally { await rm(root, { recursive: true, force: true }) }
  }
})

test('Planning V3 candidate commit failure rolls back every formal record and current pointer', async () => {
  const root = await mkdtemp(join(tmpdir(), 'po-v3-rollback-'))
  try {
    const repository = await createPlanningV3Fixture(root)
    const store = memoryStore()
    const service = new OrchestratorService(agentContext(), store, undefined, undefined, { planningContractMode: 'v3-candidate' })
    const project = await service.createProjectFromRequest({ mode: 'empty', name: 'V3 rollback', cwd: repository, prd: '# 功能\n## 验收标准\n1. 保存记录并可查询' })
    const implementer = await service.createAgent({ name: 'Rollback Implementer', role: 'Software Engineer', persona: 'Implement.' })
    const verifier = await service.createAgent({ name: 'Rollback Verifier', role: 'Test Engineer', persona: 'Verify.' })
    await service.addProjectAgents(project.id, { members: [
      { agentId: implementer.id, projectRole: 'Software Engineer', deliveryRoles: ['implementer'], autoAssignable: true },
      { agentId: verifier.id, projectRole: 'Test Engineer', deliveryRoles: ['verifier'], autoAssignable: true },
    ] })
    await addTrustedCapabilities(store, project.id, implementer.id, ['language.typescript', 'testing.automation'])
    await addTrustedCapabilities(store, project.id, verifier.id, ['language.typescript', 'testing.automation', 'testing.verification'])
    const putPlanSnapshot = store.planSnapshots.put.bind(store.planSnapshots)
    let failed = false
    store.planSnapshots.put = async (id, value) => {
      if (!failed && value.planningContractVersion === 3 && value.status === 'candidate') {
        failed = true
        throw new Error('candidate snapshot persistence failed')
      }
      return putPlanSnapshot(id, value)
    }

    await service.startDecomposition(project.id)
    const settled = await waitForPlanning(store, project.id)

    assert.equal(settled.status, 'draft')
    assert.equal(settled.currentPlanSnapshotId, undefined)
    assert.deepEqual(settled.taskIds, [])
    assert.equal(store.planSnapshots.size, 0)
    assert.equal(store.tasks.size, 0)
    assert.equal(store.requirementBundles.size, 0)
    assert.equal(store.requirementItems.size, 0)
    assert.equal(store.acceptanceCriteria.size, 0)
    assert.equal(store.requirementDecisions.size, 0)
    const operation = [...store.planningOperations.records.values()].at(-1)
    assert.equal(operation.status, 'failed')
    assert.deepEqual(operation.taskIds, [])
    assert.deepEqual(operation.workPackageIds, [])
    assert.equal(operation.candidatePlanSnapshotId, undefined)
    assert.ok(store.planningProposalPacks.size > 0)
    assert.ok(store.assignmentDrafts.size > 0)
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('Planning V2 persists source requirements, original acceptance, deterministic mappings, and approvable owners', async () => {
  const root = await mkdtemp(join(tmpdir(), 'po-v2-closure-'))
  try {
    const store = memoryStore()
    const service = new OrchestratorService(agentContext(readyV2Plan(['AC-001', 'AC-002'])), store)
    const project = await service.createProjectFromRequest({ mode: 'empty', name: 'V2 closure', cwd: root, prd: '# 功能\n## 验收标准\n1. 可以创建记录\n2. 失败返回业务错误' })
    const implementer = await service.createAgent({ name: 'Implementer', role: 'Software Engineer', persona: 'Implement.', capabilities: [] })
    const verifier = await service.createAgent({ name: 'Verifier', role: 'Test Engineer', persona: 'Verify.', capabilities: [] })
    await service.addProjectAgents(project.id, { members: [{ agentId: implementer.id, projectRole: '软件工程师', deliveryRoles: ['implementer'], autoAssignable: true }, { agentId: verifier.id, projectRole: '自动化测试设计工程师', deliveryRoles: ['verifier'], autoAssignable: true }] })
    await service.startDecomposition(project.id)
    await new Promise((resolve) => setTimeout(resolve, 30))
    const settled = store.projects.get(project.id)
    const snapshot = store.planSnapshots.get(settled.currentPlanSnapshotId)
    const items = [...store.requirementItems.records.values()]
    const acceptance = [...store.acceptanceCriteria.records.values()]
    const tasks = store.projectTasks(settled)
    assert.equal(snapshot.planningContractVersion, 2)
    assert.equal(snapshot.status, 'candidate')
    assert.equal(items.length, 2)
    assert.equal(items.some((item) => item.key === 'bundle-root'), false)
    assert.deepEqual(acceptance.map((item) => item.key).sort(), ['AC-001', 'AC-002'])
    assert.equal(acceptance.every((item) => item.sourceRefs.length === 1 && item.taskIds.length === 2), true)
    assert.deepEqual(tasks.map((task) => task.agentId), [implementer.id, verifier.id])
    assert.equal(tasks.every((task) => task.planningContractVersion === 2 && task.sourceRequirementIds.length === 2 && task.acceptanceIds.length === 2), true)
    assert.equal(service.getProjectTeamPlan(project.id).preflight.ready, true)
    assert.equal((await service.approveProject(project.id, 'tester')).status, 'approved')
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('lscity-nuxt 21 acceptance and 27 open questions survive the complete Service planning and approval path', async () => {
  const root = await mkdtemp(join(tmpdir(), 'po-v2-lscity-closure-'))
  try {
    const prd = readFileSync(new URL('./fixtures/lscity-nuxt-required-dispositions.md', import.meta.url), 'utf8')
    const acceptanceKeys = Array.from({ length: 21 }, (_, index) => `AC-${String(index + 1).padStart(3, '0')}`)
    const store = memoryStore()
    const service = new OrchestratorService(agentContext(readyV2Plan(acceptanceKeys)), store)
    const project = await service.createProjectFromRequest({ mode: 'empty', name: 'lscity-nuxt regression', cwd: root, prd })
    const implementer = await service.createAgent({ name: 'lscity implementer', role: 'Software Engineer', persona: 'Implement.' })
    const verifier = await service.createAgent({ name: 'lscity verifier', role: 'Test Engineer', persona: 'Verify.' })
    await service.addProjectAgents(project.id, { members: [
      { agentId: implementer.id, projectRole: 'Software Engineer', deliveryRoles: ['implementer'], autoAssignable: true },
      { agentId: verifier.id, projectRole: 'Test Engineer', deliveryRoles: ['verifier'], autoAssignable: true },
    ] })

    await service.startDecomposition(project.id)
    await new Promise((resolve) => setTimeout(resolve, 30))

    const settled = store.projects.get(project.id)
    const matrix = service.getProjectRequirementMatrix(project.id)
    const teamPlan = service.getProjectTeamPlan(project.id)
    assert.equal(matrix.acceptanceCriteria.length, 21)
    assert.equal(new Set(matrix.acceptanceCriteria.map((criterion) => criterion.sourceRefs[0])).size, 21)
    assert.equal(matrix.decisions.length, 27)
    assert.equal(new Set(matrix.decisions.map((decision) => decision.sourceRefs[0])).size, 27)
    assert.equal(teamPlan.preflight.coverageMatrix.length, 21)
    assert.equal(teamPlan.preflight.coverageMatrix.every((row) => row.planningStatus === 'planned' && row.verificationStatus === 'unverified'), true)
    assert.equal(teamPlan.preflight.ready, true)
    assert.equal(store.projectTasks(settled).every((task) => task.agentId !== undefined), true)
    assert.equal((await service.approveProject(project.id, 'acceptance-owner')).status, 'approved')
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('a requirements review that still rejects the focused repair persists a blocked snapshot and Inbox evidence', async () => {
  const root = await mkdtemp(join(tmpdir(), 'po-v2-review-blocked-'))
  try {
    const observation = { requirementReviewResponse: ({ generated }) => ({ ...generated, status: 'changes_required', missingSourceRefs: ['prd:line:missing'], findings: [{ severity: 'blocking', message: 'A required workflow remains ambiguous.' }] }) }
    const store = memoryStore()
    const service = new OrchestratorService(agentContext(readyV2Plan(), observation), store)
    const project = await service.createProjectFromRequest({ mode: 'empty', name: 'Review blocked', cwd: root, prd: '# 功能\n## 验收标准\n1. 可以保存' })

    await service.startDecomposition(project.id)
    await new Promise((resolve) => setTimeout(resolve, 30))

    const settled = store.projects.get(project.id)
    const snapshot = store.planSnapshots.get(settled.currentPlanSnapshotId)
    assert.equal(observation.requirementReviewCalls, 2)
    assert.equal(observation.plannerCalls, undefined)
    assert.equal(settled.status, 'awaiting_approval')
    assert.equal(snapshot.status, 'blocked')
    assert.equal(snapshot.diagnostics.some((diagnostic) => diagnostic.code === 'requirement-review-blocked'), true)
    assert.equal(store.projectTasks(settled).length, 0)
    assert.equal(service.snapshot().inbox.some((item) => item.id === `planning-blocked:${project.id}:${snapshot.id}`), true)
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('an explicitly blocked V2 planner result persists diagnostics without materializing partial tasks', async () => {
  const root = await mkdtemp(join(tmpdir(), 'po-v2-planner-blocked-'))
  try {
    const blockedPlan = JSON.stringify({ contractVersion: 2, status: 'blocked', summary: 'Repository evidence is insufficient.', repositoryEvidence: { inspectedPaths: [], manifests: [], verifiedCommands: [], relevantModules: [], assumptions: [] }, tasks: [], diagnostics: [{ code: 'verification-command-unconfirmed', severity: 'error', message: 'No repository verification command could be confirmed.' }] })
    const store = memoryStore()
    const service = new OrchestratorService(agentContext(blockedPlan), store)
    const project = await service.createProjectFromRequest({ mode: 'empty', name: 'Planner blocked', cwd: root, prd: '# 功能\n## 验收标准\n1. 可以保存' })

    await service.startDecomposition(project.id)
    await new Promise((resolve) => setTimeout(resolve, 30))

    const settled = store.projects.get(project.id)
    const snapshot = store.planSnapshots.get(settled.currentPlanSnapshotId)
    assert.equal(settled.status, 'awaiting_approval')
    assert.equal(snapshot.status, 'blocked')
    assert.equal(snapshot.diagnostics.some((diagnostic) => diagnostic.code === 'planning-blocked'), true)
    assert.equal(snapshot.diagnostics.some((diagnostic) => diagnostic.code === 'verification-command-unconfirmed'), true)
    assert.equal(store.projectTasks(settled).length, 0)
    await assert.rejects(() => service.approveProject(project.id, 'tester'), (error) => error.code === 'planning-snapshot-blocked')
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('Planning V2 approval rejects a required acceptance without verification coverage', async () => {
  const root = await mkdtemp(join(tmpdir(), 'po-v2-coverage-gate-'))
  try {
    const store = memoryStore()
    const service = new OrchestratorService(agentContext(readyV2Plan()), store)
    const project = await service.createProjectFromRequest({ mode: 'empty', name: 'Coverage gate', cwd: root, prd: '# 功能\n## 验收标准\n1. 可以保存' })
    const implementer = await service.createAgent({ name: 'Implementer', role: 'Engineer', persona: 'Implement.' })
    const verifier = await service.createAgent({ name: 'Verifier', role: 'Tester', persona: 'Verify.' })
    await service.addProjectAgents(project.id, { members: [{ agentId: implementer.id, projectRole: 'Engineer', deliveryRoles: ['implementer'], autoAssignable: true }, { agentId: verifier.id, projectRole: 'Tester', deliveryRoles: ['verifier'], autoAssignable: true }] })
    await service.startDecomposition(project.id); await new Promise((resolve) => setTimeout(resolve, 30))
    const verify = store.projectTasks(store.projects.get(project.id)).find((task) => task.relationship === 'verification')
    await store.tasks.put(verify.id, { ...verify, acceptanceIds: [] })
    const preflight = service.getProjectTeamPlan(project.id).preflight
    assert.equal(preflight.ready, false)
    assert.ok(preflight.errors.some((message) => message.includes('has no verification task')))
    await assert.rejects(() => service.approveProject(project.id, 'tester'), (error) => error.code === 'team-preflight-failed')
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('Planning V2 persists high-impact Decisions and blocks planning and approval before task generation', async () => {
  const root = await mkdtemp(join(tmpdir(), 'po-v2-decision-gate-'))
  try {
    const store = memoryStore()
    const observation = { requirementAnalysisResponse: ({ generated }) => ({ ...generated, status: 'needs_decision', decisions: generated.decisions.map((decision) => ({ ...decision, impact: 'high' })) }) }
    const service = new OrchestratorService(agentContext(readyV2Plan(), observation), store)
    const project = await service.createProjectFromRequest({ mode: 'empty', name: 'Decision gate', cwd: root, prd: '# 功能\n## 验收标准\n1. 可以保存\n## 待确认事项\n1. 失败是否重试？' })
    await service.replanProject(project.id, { taskLanguage: 'zh-CN' }); await new Promise((resolve) => setTimeout(resolve, 30))
    const settled = store.projects.get(project.id)
    assert.equal(observation.plannerCalls, undefined)
    assert.equal(store.projectTasks(settled).length, 0)
    assert.equal([...store.requirementDecisions.records.values()].length, 1)
    assert.equal(store.planSnapshots.get(settled.currentPlanSnapshotId).status, 'blocked')
    await assert.rejects(() => service.approveProject(project.id, 'tester'), (error) => error.code === 'requirement-decision-pending')
    const restarted = new OrchestratorService({}, store)
    await restarted.initialize()
    assert.equal(restarted.getProjectRequirementMatrix(project.id).decisions.length, 1)
    assert.equal(restarted.getProjectTeamPlan(project.id).preflight.ready, false)
    assert.equal(store.projects.get(project.id).currentPlanSnapshotId, settled.currentPlanSnapshotId)
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('resolved high-impact Decision supersedes the old plan and is carried into a deterministic replan', async () => {
  const root = await mkdtemp(join(tmpdir(), 'po-v2-decision-replan-'))
  try {
    const plan = JSON.parse(readyV2Plan())
    plan.tasks = plan.tasks.map((task) => ({ ...task, decisionKeys: ['DEC-001'] }))
    const observation = { requirementAnalysisResponse: ({ generated }) => ({ ...generated, status: 'needs_decision', decisions: generated.decisions.map((decision) => ({ ...decision, impact: 'high' })) }) }
    const store = memoryStore()
    const service = new OrchestratorService(agentContext(JSON.stringify(plan), observation), store)
    const project = await service.createProjectFromRequest({ mode: 'empty', name: 'Decision replan', cwd: root, prd: '# 功能\n## 验收标准\n1. 可以保存\n## 待确认事项\n1. 失败是否重试？' })
    const implementer = await service.createAgent({ name: 'Implementer', role: 'Engineer', persona: 'Implement.' })
    const verifier = await service.createAgent({ name: 'Verifier', role: 'Tester', persona: 'Verify.' })
    await service.addProjectAgents(project.id, { members: [{ agentId: implementer.id, projectRole: 'Engineer', deliveryRoles: ['implementer'], autoAssignable: true }, { agentId: verifier.id, projectRole: 'Tester', deliveryRoles: ['verifier'], autoAssignable: true }] })

    await service.startDecomposition(project.id); await new Promise((resolve) => setTimeout(resolve, 30))
    const blockedProject = store.projects.get(project.id)
    const blockedSnapshot = store.planSnapshots.get(blockedProject.currentPlanSnapshotId)
    const pending = [...store.requirementDecisions.records.values()].find((decision) => decision.bundleId === blockedSnapshot.requirementBundleIds[0])
    const plannedDecisionDigest = blockedProject.decisionDigest

    await service.resolveProjectRequirementDecision(project.id, pending.id, { status: 'resolved', chosenOption: 'proceed', resolution: 'Retry once with an idempotency key.', decidedBy: 'product-owner' })
    const staleProject = store.projects.get(project.id)
    assert.equal(store.planSnapshots.get(blockedSnapshot.id).status, 'superseded')
    assert.equal(store.planSnapshots.get(blockedSnapshot.id).diagnostics.some((item) => item.code === 'planning-stale'), true)
    assert.equal(staleProject.decisionDigest, plannedDecisionDigest)
    assert.equal(service.getProjectTeamPlan(project.id).preflight.ready, false)

    await service.replanProject(project.id, { taskLanguage: 'zh-CN' }); await new Promise((resolve) => setTimeout(resolve, 30))
    const replanned = store.projects.get(project.id)
    const snapshot = store.planSnapshots.get(replanned.currentPlanSnapshotId)
    const carried = [...store.requirementDecisions.records.values()].find((decision) => decision.bundleId === snapshot.requirementBundleIds[0])
    assert.equal(snapshot.mode, 'revise')
    assert.equal(snapshot.status, 'candidate')
    assert.equal(carried.status, 'resolved')
    assert.equal(carried.chosenOption, 'proceed')
    assert.equal(store.projectTasks(replanned).every((task) => task.decisionIds.includes(carried.id)), true)
    assert.match(observation.requirementAnalysisPrompts.at(-1), /Resolved Decisions with frozen contracts/)
    assert.match(observation.requirementAnalysisPrompts.at(-1), /"chosenOption":"proceed"/)
    assert.match(observation.requirementReviewPrompts.at(-1), /do not report their already supplied chosenOption or resolution as unresolved/)
    const currentRequirements = service.getProjectRequirementMatrix(project.id)
    const requirementHistory = service.getProjectRequirementMatrix(project.id, true)
    assert.deepEqual(currentRequirements.bundles.map((bundle) => bundle.id), snapshot.requirementBundleIds)
    assert.equal(currentRequirements.items.length, 1)
    assert.equal(requirementHistory.bundles.length, 2)
    assert.equal(requirementHistory.items.length, 2)
    assert.equal(requirementHistory.decisions.length, 2)
    assert.equal((await service.approveProject(project.id, 'tester')).status, 'approved')
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('a same-source replan repairs a model rewrite and preserves the frozen resolved Decision contract', async () => {
  const root = await mkdtemp(join(tmpdir(), 'po-v2-decision-frozen-repair-'))
  try {
    const plan = JSON.parse(readyV2Plan())
    plan.tasks = plan.tasks.map((task) => ({ ...task, decisionKeys: ['DEC-001'] }))
    const observation = { requirementAnalysisResponse: ({ generated, call }) => ({
      ...generated,
      status: 'needs_decision',
      decisions: generated.decisions.map((decision) => ({
        ...decision,
        impact: 'high',
        question: call === 2 ? `${decision.question} (rewritten by the model)` : decision.question,
      })),
    }) }
    const store = memoryStore()
    const service = new OrchestratorService(agentContext(JSON.stringify(plan), observation), store)
    const project = await service.createProjectFromRequest({ mode: 'empty', name: 'Frozen Decision repair', cwd: root, prd: '# 功能\n## 验收标准\n1. 可以保存\n## 待确认事项\n1. 失败是否重试？' })
    const implementer = await service.createAgent({ name: 'Implementer', role: 'Engineer', persona: 'Implement.' })
    const verifier = await service.createAgent({ name: 'Verifier', role: 'Tester', persona: 'Verify.' })
    await service.addProjectAgents(project.id, { members: [{ agentId: implementer.id, projectRole: 'Engineer', deliveryRoles: ['implementer'], autoAssignable: true }, { agentId: verifier.id, projectRole: 'Tester', deliveryRoles: ['verifier'], autoAssignable: true }] })

    await service.startDecomposition(project.id); await new Promise((resolve) => setTimeout(resolve, 30))
    const firstSnapshot = store.planSnapshots.get(store.projects.get(project.id).currentPlanSnapshotId)
    const firstDecision = [...store.requirementDecisions.records.values()].find((decision) => decision.bundleId === firstSnapshot.requirementBundleIds[0])
    await service.resolveProjectRequirementDecision(project.id, firstDecision.id, { status: 'resolved', chosenOption: 'proceed', resolution: 'Retry once with an idempotency key.', decidedBy: 'owner' })

    await service.replanProject(project.id, { taskLanguage: 'zh-CN' }); await new Promise((resolve) => setTimeout(resolve, 30))

    const replanned = store.projects.get(project.id)
    const nextSnapshot = store.planSnapshots.get(replanned.currentPlanSnapshotId)
    const nextDecision = [...store.requirementDecisions.records.values()].find((decision) => decision.bundleId === nextSnapshot.requirementBundleIds[0])
    assert.equal(observation.requirementAnalysisCalls, 3)
    assert.match(observation.requirementAnalysisPrompts.at(-1), /must be returned with its frozen question/)
    assert.equal(nextSnapshot.status, 'candidate')
    assert.equal(nextDecision.question, firstDecision.question)
    assert.equal(nextDecision.status, 'resolved')
    assert.equal(nextDecision.chosenOption, 'proceed')
    assert.equal(observation.plannerCalls, 1)
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('a changed Decision contract does not inherit a previously resolved answer', async () => {
  const root = await mkdtemp(join(tmpdir(), 'po-v2-decision-contract-change-'))
  try {
    const observation = { requirementAnalysisResponse: ({ generated }) => ({
      ...generated,
      status: 'needs_decision',
      decisions: generated.decisions.map((decision) => ({
        ...decision,
        impact: 'high',
        options: decision.options.map((option) => option.id === 'proceed' && (observation.requirementAnalysisCalls ?? 0) > 1 ? { ...option, label: 'Proceed with a mandatory audit record' } : option),
      })),
    }) }
    const store = memoryStore()
    const service = new OrchestratorService(agentContext(readyV2Plan(), observation), store)
    const project = await service.createProjectFromRequest({ mode: 'empty', name: 'Decision contract change', cwd: root, prd: '# 功能\n## 验收标准\n1. 可以保存\n## 待确认事项\n1. 失败是否重试？' })

    await service.startDecomposition(project.id); await new Promise((resolve) => setTimeout(resolve, 30))
    const firstSnapshot = store.planSnapshots.get(store.projects.get(project.id).currentPlanSnapshotId)
    const firstDecision = [...store.requirementDecisions.records.values()].find((decision) => decision.bundleId === firstSnapshot.requirementBundleIds[0])
    await service.resolveProjectRequirementDecision(project.id, firstDecision.id, { status: 'resolved', chosenOption: 'proceed', resolution: 'Proceed.', decidedBy: 'owner' })

    const current = store.projects.get(project.id)
    await service.replanProject(project.id, { taskLanguage: 'zh-CN', project: {
      name: current.name,
      summary: current.summary,
      cwd: current.cwd,
      prd: current.prd.replace('失败是否重试？', '失败是否重试并强制记录审计日志？'),
      technicalDesign: current.technicalDesign,
      priority: current.priority ?? 'medium',
      owner: current.owner ?? '',
      taskLanguage: current.taskLanguage ?? 'zh-CN',
    } }); await new Promise((resolve) => setTimeout(resolve, 30))
    const replanned = store.projects.get(project.id)
    const nextSnapshot = store.planSnapshots.get(replanned.currentPlanSnapshotId)
    const nextDecision = [...store.requirementDecisions.records.values()].find((decision) => decision.bundleId === nextSnapshot.requirementBundleIds[0])
    assert.equal(nextSnapshot.status, 'blocked')
    assert.equal(nextSnapshot.diagnostics.some((diagnostic) => diagnostic.code === 'requirement-decision-pending'), true)
    assert.equal(nextDecision.status, 'pending')
    assert.equal(nextDecision.chosenOption, undefined)
    assert.equal(observation.plannerCalls, undefined)
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('Decision resolution rolls back the Decision, Project, and snapshot when stale-state persistence fails', async () => {
  const store = memoryStore()
  const service = new OrchestratorService({}, store)
  const project = await service.createProject({ name: 'Decision rollback', cwd: '/tmp', prd: 'PRD', technicalDesign: 'Design' })
  const bundleId = 'decision-rollback-bundle'
  const snapshot = { id: `${project.id}:r1`, projectId: project.id, revision: 1, mode: 'initial', taskIds: [], planHash: 'a'.repeat(64), teamComposition: { members: [], squads: [], teamDigest: 'b'.repeat(64), capturedAt: now }, teamDigest: 'b'.repeat(64), assignmentDigest: 'c'.repeat(64), decisionDigest: 'd'.repeat(64), requirementBundleIds: [bundleId], planningContractVersion: 2, status: 'blocked', createdAt: now }
  const decision = { id: 'decision-rollback', projectId: project.id, bundleId, key: 'DEC-001', question: 'Proceed?', options: [{ id: 'yes', label: 'Yes' }], impact: 'high', affectedRequirementIds: [], affectedTaskIds: [], sourceRefs: ['prd:line:1'], status: 'pending', createdAt: now, updatedAt: now }
  await store.planSnapshots.put(snapshot.id, snapshot)
  await store.requirementDecisions.put(decision.id, decision)
  await store.projects.put(project.id, { ...project, currentPlanSnapshotId: snapshot.id, decisionDigest: snapshot.decisionDigest })
  const beforeProject = structuredClone(store.projects.get(project.id))
  const originalPut = store.projects.put.bind(store.projects)
  store.projects.put = async (key, value) => { if (value.revision > beforeProject.revision) throw new Error('project persistence failed'); await originalPut(key, value) }

  await assert.rejects(() => service.resolveProjectRequirementDecision(project.id, decision.id, { status: 'resolved', chosenOption: 'yes', resolution: 'Proceed.', decidedBy: 'owner' }), /project persistence failed/)
  assert.deepEqual(store.requirementDecisions.get(decision.id), decision)
  assert.deepEqual(store.planSnapshots.get(snapshot.id), snapshot)
  assert.deepEqual(store.projects.get(project.id), beforeProject)
})

test('Planning V2 derives bound Squad ownership from collective roles and capabilities', async () => {
  const root = await mkdtemp(join(tmpdir(), 'po-v2-squad-'))
  try {
    const plan = JSON.parse(readyV2Plan())
    plan.tasks[0] = { ...plan.tasks[0], assignmentPolicy: { ...plan.tasks[0].assignmentPolicy, mode: 'squad_delegation', requiredRoles: ['implementer', 'specialist'], requiredCapabilities: ['language.typescript'] } }
    const store = memoryStore()
    const service = new OrchestratorService(agentContext(JSON.stringify(plan)), store)
    const project = await service.createProjectFromRequest({ mode: 'empty', name: 'Squad plan', cwd: root, prd: '# 功能\n## 验收标准\n1. 可以保存' })
    const leader = await service.createAgent({ name: 'Leader', role: 'Lead', persona: 'Coordinate.' })
    const member = await service.createAgent({ name: 'Engineer', role: 'Engineer', persona: 'Implement.', capabilities: ['language.typescript'] })
    const verifier = await service.createAgent({ name: 'Verifier', role: 'Tester', persona: 'Verify.' })
    await service.addProjectAgents(project.id, { members: [{ agentId: leader.id, projectRole: 'Lead', deliveryRoles: ['lead'], autoAssignable: true }, { agentId: member.id, projectRole: 'Engineer', deliveryRoles: ['implementer', 'specialist'], autoAssignable: true }, { agentId: verifier.id, projectRole: 'Tester', deliveryRoles: ['verifier'], autoAssignable: true }] })
    const squad = await service.createSquad({ name: 'Delivery Squad', leaderAgentId: leader.id, memberAgentIds: [leader.id, member.id], instructions: 'Delegate.', escalationPolicy: 'Escalate.' })
    await service.bindProjectSquad(project.id, { squadId: squad.id, expectedProjectRevision: store.projects.get(project.id).revision, expectedSquadUpdatedAt: squad.updatedAt, boundBy: 'tester' })

    await service.startDecomposition(project.id); await new Promise((resolve) => setTimeout(resolve, 30))
    const settled = store.projects.get(project.id)
    const snapshot = store.planSnapshots.get(settled.currentPlanSnapshotId)
    const implementation = store.projectTasks(settled).find((task) => task.relationship === 'implementation')
    assert.equal(snapshot.status, 'candidate')
    assert.equal(implementation.agentId, leader.id)
    assert.deepEqual(implementation.assignmentPolicy.allowedSquadIds, [squad.id])
    assert.equal(snapshot.taskAssignments.find((assignment) => assignment.taskId === implementation.id).ownerSquadId, squad.id)
    assert.equal(service.getProjectTeamPlan(project.id).preflight.ready, true)
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('Planning V2 compensates every candidate record when the final Project pointer write fails', async () => {
  const root = await mkdtemp(join(tmpdir(), 'po-v2-pointer-failure-'))
  try {
    const store = memoryStore()
    const service = new OrchestratorService(agentContext(readyV2Plan()), store)
    const project = await service.createProjectFromRequest({ mode: 'empty', name: 'Pointer failure', cwd: root, prd: '# 功能\n## 验收标准\n1. 可以保存' })
    const originalPut = store.projects.put.bind(store.projects)
    store.projects.put = async (key, value) => { if (value.currentPlanSnapshotId !== undefined) throw new Error('pointer write failed'); await originalPut(key, value) }
    await service.startDecomposition(project.id); await new Promise((resolve) => setTimeout(resolve, 30))
    assert.equal(store.projects.get(project.id).status, 'draft')
    assert.match(store.projects.get(project.id).lastError, /pointer write failed/)
    assert.equal(store.tasks.size, 0)
    assert.equal(store.requirementBundles.size, 0)
    assert.equal(store.requirementItems.size, 0)
    assert.equal(store.acceptanceCriteria.size, 0)
    assert.equal(store.requirementDecisions.size, 0)
    assert.equal(store.planSnapshots.size, 0)
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('Planning V2 rolls back requirement records and the first Task when a later Task write fails', async () => {
  const root = await mkdtemp(join(tmpdir(), 'po-v2-task-write-failure-'))
  try {
    const store = memoryStore()
    const service = new OrchestratorService(agentContext(readyV2Plan()), store)
    const project = await service.createProjectFromRequest({ mode: 'empty', name: 'Task write failure', cwd: root, prd: '# 功能\n## 验收标准\n1. 可以保存' })
    const originalPut = store.tasks.put.bind(store.tasks)
    let planningWrites = 0
    store.tasks.put = async (key, value) => {
      if (value.planningContractVersion === 2 && value.planSnapshotId === undefined && ++planningWrites === 2) throw new Error('second task write failed')
      await originalPut(key, value)
    }
    await service.startDecomposition(project.id); await new Promise((resolve) => setTimeout(resolve, 30))
    const settled = store.projects.get(project.id)
    assert.equal(settled.status, 'draft')
    assert.match(settled.lastError, /second task write failed/)
    assert.equal(store.tasks.size, 0)
    assert.equal(store.requirementBundles.size, 0)
    assert.equal(store.requirementItems.size, 0)
    assert.equal(store.acceptanceCriteria.size, 0)
    assert.equal(store.requirementDecisions.size, 0)
    assert.equal(store.planSnapshots.size, 0)
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('Planning V2 discards an AI result when the Project revision changes during analysis', async () => {
  const root = await mkdtemp(join(tmpdir(), 'po-v2-stale-analysis-'))
  try {
    const store = memoryStore()
    let projectId
    let changed = false
    const observation = { onAgentCreate: async () => {
      if (changed || projectId === undefined) return
      const current = store.projects.get(projectId)
      if (current?.status !== 'decomposing') return
      changed = true
      await store.projects.put(projectId, { ...current, revision: current.revision + 1, updatedAt: new Date().toISOString() })
    } }
    const service = new OrchestratorService(agentContext(readyV2Plan(), observation), store)
    const project = await service.createProjectFromRequest({ mode: 'empty', name: 'Stale analysis', cwd: root, prd: '# 功能\n## 验收标准\n1. 可以保存' })
    projectId = project.id
    await service.startDecomposition(project.id); await new Promise((resolve) => setTimeout(resolve, 30))
    const settled = store.projects.get(project.id)
    assert.equal(changed, true)
    assert.equal(settled.status, 'draft')
    assert.match(settled.lastError, /changed while requirement analysis was running/i)
    assert.equal(store.tasks.size, 0)
    assert.equal(store.requirementBundles.size, 0)
    assert.equal(store.planSnapshots.size, 0)
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('Decision resolution wins over a concurrent replan and stale AI output cannot reset the newer Project revision', async () => {
  const root = await mkdtemp(join(tmpdir(), 'po-v2-decision-replan-race-'))
  try {
    let releaseAnalysis
    let markAnalysisStarted
    const analysisStarted = new Promise((resolve) => { markAnalysisStarted = resolve })
    const analysisGate = new Promise((resolve) => { releaseAnalysis = resolve })
    const observation = {
      requirementAnalysisResponse: ({ generated }) => ({ ...generated, status: 'needs_decision', decisions: generated.decisions.map((decision) => ({ ...decision, impact: 'high' })) }),
      onAgentCreate: async (_options, call) => {
        if (call !== 3) return
        markAnalysisStarted()
        await analysisGate
      },
    }
    const store = memoryStore()
    const service = new OrchestratorService(agentContext(readyV2Plan(), observation), store)
    const project = await service.createProjectFromRequest({ mode: 'empty', name: 'Decision replan race', cwd: root, prd: '# 功能\n## 验收标准\n1. 可以保存\n## 待确认事项\n1. 失败是否重试？' })
    await service.startDecomposition(project.id); await new Promise((resolve) => setTimeout(resolve, 30))
    const before = store.projects.get(project.id)
    const pending = [...store.requirementDecisions.records.values()][0]
    const snapshotCount = store.planSnapshots.size
    const bundleCount = store.requirementBundles.size

    await service.replanProject(project.id, { taskLanguage: 'zh-CN' })
    await analysisStarted
    await service.resolveProjectRequirementDecision(project.id, pending.id, { status: 'resolved', chosenOption: 'proceed', resolution: 'Resolve while planning.', decidedBy: 'owner' })
    const resolvedProject = structuredClone(store.projects.get(project.id))
    releaseAnalysis()
    await new Promise((resolve) => setTimeout(resolve, 30))

    const settled = store.projects.get(project.id)
    assert.equal(settled.revision, resolvedProject.revision)
    assert.equal(settled.status, 'awaiting_approval')
    assert.equal(settled.currentPlanSnapshotId, before.currentPlanSnapshotId)
    assert.equal(store.requirementDecisions.get(pending.id).status, 'resolved')
    assert.equal(store.planSnapshots.size, snapshotCount)
    assert.equal(store.requirementBundles.size, bundleCount)
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('Planning V2 pointer failure preserves an existing authoritative plan during replan', async () => {
  const root = await mkdtemp(join(tmpdir(), 'po-v2-existing-pointer-'))
  try {
    const store = memoryStore()
    const service = new OrchestratorService(agentContext(readyV2Plan()), store)
    const project = await service.createProjectFromRequest({ mode: 'empty', name: 'Existing plan', cwd: root, prd: '# 功能\n## 验收标准\n1. 可以保存' })
    await service.startDecomposition(project.id); await new Promise((resolve) => setTimeout(resolve, 30))
    const before = structuredClone(store.projects.get(project.id))
    const beforeTasks = [...store.tasks.records.values()].map((task) => structuredClone(task))
    const beforeBundles = [...store.requirementBundles.records.values()].map((bundle) => structuredClone(bundle))
    const beforeSnapshots = [...store.planSnapshots.records.values()].map((snapshot) => structuredClone(snapshot))
    const originalPut = store.projects.put.bind(store.projects)
    store.projects.put = async (key, value) => {
      if (value.currentPlanSnapshotId !== undefined && value.currentPlanSnapshotId !== before.currentPlanSnapshotId) throw new Error('replacement pointer failed')
      await originalPut(key, value)
    }

    await service.replanProject(project.id, { taskLanguage: 'zh-CN' }); await new Promise((resolve) => setTimeout(resolve, 30))
    const settled = store.projects.get(project.id)
    assert.equal(settled.currentPlanSnapshotId, before.currentPlanSnapshotId)
    assert.deepEqual(settled.taskIds, before.taskIds)
    assert.match(settled.lastError, /replacement pointer failed/)
    assert.deepEqual([...store.tasks.records.values()], beforeTasks)
    assert.deepEqual([...store.requirementBundles.records.values()], beforeBundles)
    assert.deepEqual([...store.planSnapshots.records.values()], beforeSnapshots)
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('V2 candidate matching uses exact deliveryRoles and declared capability ids, not display role text', async () => {
  const store = memoryStore()
  const service = new OrchestratorService({}, store)
  const project = await service.createProject({ name: 'Exact roles', cwd: '/tmp', prd: 'PRD', technicalDesign: 'Design' })
  const agent = await service.createAgent({ name: 'Similar role', role: 'Implementer', persona: 'Implement.', capabilities: ['coding'] })
  await service.addProjectAgent(project.id, { agentId: agent.id, projectRole: 'implementer engineer', deliveryRoles: [], autoAssignable: true })
  const task = await service.createTask(project.id, { title: 'V2 task', kind: 'code', description: 'Implement.', acceptanceCriteria: ['done'], assignmentPolicy: { mode: 'single_agent', riskLevel: 'low', requiredRoles: ['implementer'], requiredCapabilities: ['coding'], allowedAgentIds: [], allowedSquadIds: [], requiresIndependentReviewer: false, maxParallel: 1, conflictKeys: [], allowedScope: [], forbiddenScope: [], escalationConditions: [] }, testCommand: 'true' })
  await store.tasks.put(task.id, { ...task, planningContractVersion: 2 })
  assert.ok(service.getProjectAgentCandidates(project.id, task.id).candidates.find((candidate) => candidate.agentId === agent.id).reasons.includes('missing_role:implementer'))
  await service.updateProjectAgent(project.id, agent.id, { deliveryRoles: ['implementer'] })
  assert.equal(service.getProjectAgentCandidates(project.id, task.id).candidates.find((candidate) => candidate.agentId === agent.id).eligible, true)
})

test('PDF requirement import sends extracted text and ordered page images to the AI model', async () => {
  const observation = {}
  const context = agentContext('```markdown\n# 产品需求文档\n\n## 背景与目标\n统一审批流程。\n```', observation)
  const service = new OrchestratorService(context, memoryStore())
  const firstImage = Buffer.from('first-jpeg').toString('base64')
  const secondImage = Buffer.from('second-jpeg').toString('base64')

  const result = await service.importRequirementDocument({
    fileName: '审批需求.pdf',
    documentHash: 'a'.repeat(64),
    documentKind: 'prd',
    pageCount: 2,
    textPageCount: 1,
    visualPageCount: 2,
    extractedText: '## PDF 第 1 页\n审批人可以批准或拒绝。',
    images: [
      { page: 1, mediaType: 'image/jpeg', dataBase64: firstImage },
      { page: 2, mediaType: 'image/jpeg', dataBase64: secondImage },
    ],
  })

  assert.match(result.markdown, /^# 产品需求文档/)
  assert.deepEqual(result.analyzedImagePages, [1, 2])
  assert.deepEqual(result.sourceBlocks.map((block) => block.locator), [`pdf:${'a'.repeat(64)}:page:1:block:1`, `pdf:${'a'.repeat(64)}:page:2:block:1`])
  assert.equal(observation.validatedImages.length, 2)
  assert.equal(observation.savedImages.length, 2)
  assert.match(observation.prompt, /BEGIN UNTRUSTED EXTRACTED PDF TEXT/)
  assert.deepEqual(observation.message.content.map((block) => block.type), ['text', 'text', 'image', 'text', 'image'])
  assert.equal(observation.message.content[1].text, '以下图片是 PDF 第 1 页。')
  assert.equal(observation.message.content[3].text, '以下图片是 PDF 第 2 页。')
})

test('PDF reservation rejects a third concurrent import and releases slots after cancellation', async () => {
  const observation = {}
  const context = agentContext('# Imported requirement', observation)
  const originalCreate = context.agents.create
  let release
  const gate = new Promise((resolve) => { release = resolve })
  context.agents.create = async (options) => {
    const handle = await originalCreate(options)
    const idle = handle.agent.whenIdle
    handle.agent.whenIdle = async () => { await idle(); await gate }
    return handle
  }
  const service = new OrchestratorService(context, memoryStore())
  const input = (name) => ({ fileName: `${name}.pdf`, documentHash: 'b'.repeat(64), documentKind: 'prd', pageCount: 1, textPageCount: 1, visualPageCount: 0, extractedText: 'Requirement', images: [] })
  const first = service.importRequirementDocument(input('one'))
  const second = service.importRequirementDocument(input('two'))
  await new Promise((resolve) => setImmediate(resolve))
  await assert.rejects(() => service.importRequirementDocument(input('three')), (error) => error.code === 'requirement-import-busy')
  release()
  await Promise.all([first, second])
  await service.importRequirementDocument(input('after'))
})

test('PDF requirement import rejects an explicitly text-only model before saving images', async () => {
  const observation = {}
  const context = agentContext('unused', observation)
  context.llm.resolveModelInfo = async () => ({ provider: 'test', id: 'text-only', name: 'Text only', inputModalities: ['text'] })
  const service = new OrchestratorService(context, memoryStore())
  await assert.rejects(() => service.importRequirementDocument({
    fileName: 'scan.pdf',
    documentHash: 'c'.repeat(64),
    documentKind: 'prd',
    pageCount: 1,
    textPageCount: 0,
    visualPageCount: 1,
    extractedText: '',
    images: [{ page: 1, mediaType: 'image/jpeg', dataBase64: Buffer.from('scan').toString('base64') }],
  }), (error) => error.code === 'model-image-input-unsupported' && error.status === 422)
  assert.equal(observation.savedImages, undefined)
})

test('runtime, resource, issue, and task run records form the collaboration foundation', async () => {
  const root = await mkdtemp(join(tmpdir(), 'po-foundation-'))
  try {
    const store = memoryStore()
    const service = new OrchestratorService(agentContext('Implemented.'), store)
    const runtime = await service.createRuntime({ name: 'Local Harness', machineId: 'test-machine', capabilities: ['codex'], workspaceRoot: root })
    assert.equal(runtime.status, 'online')
    assert.equal((await service.heartbeatRuntime(runtime.id, 'offline')).status, 'offline')
    const project = await service.createProject({ name: 'Foundation', cwd: root, prd: 'Build foundation.', technicalDesign: '' })
    const resource = await service.createProjectResource(project.id, { kind: 'local_directory', location: root, executionMode: 'in_place', runtimeId: runtime.id })
    assert.equal(resource.runtimeId, runtime.id)
    const issue = await service.createIssue({ projectId: project.id, title: 'Foundation issue', description: 'Track the delivery.' })
    assert.equal(store.projects.get(project.id).issueIds.includes(issue.id), true)
    const approved = await approvedProject(service, store, ['true', 'true'])
    const run = await service.startExecution(approved.id)
    const settled = await waitForRun(store, run.id)
    assert.equal(settled.status, 'completed')
    assert.equal([...store.taskRuns.entries()].length >= 2, true)
    assert.equal([...store.activity.records.values()].some((event) => event.type === 'task_run.completed'), true)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('project intake starts decomposition without a second user action', async () => {
  const store = memoryStore()
  const response = JSON.stringify({ summary: 'Generated delivery plan.', tasks: [
    { id: 'implement', title: 'Implement change', kind: 'code', description: 'Implement the requested change.', acceptanceCriteria: ['Behavior works'], dependencies: [], suggestedAgentRole: 'Software Engineer', testCommand: 'true' },
    { id: 'verify', title: 'Verify change', kind: 'test', description: 'Add regression coverage.', acceptanceCriteria: ['Regression is covered'], dependencies: ['implement'], suggestedAgentRole: 'Test Engineer', testCommand: 'true' },
  ] })
  const service = new OrchestratorService(agentContext(response), store)
  const project = await service.createProjectAndStart({ name: '', cwd: '/tmp', prd: 'Build a feature.', technicalDesign: '', taskLanguage: 'en' })
  assert.equal(project.status, 'decomposing')
  assert.equal(project.taskLanguage, 'en')
  assert.equal(project.technicalDesign.includes('No separate technical design'), true)
  await new Promise((resolve) => setTimeout(resolve, 30))
  const settled = store.projects.get(project.id)
  assert.equal(settled.status, 'awaiting_approval')
  assert.equal(store.projectTasks(settled).length, 2)
})

test('planning mounts the standard preset while enforcing read-only tools', async () => {
  const observation = {}
  const response = JSON.stringify({ summary: 'Generated delivery plan.', tasks: [
    { id: 'implement', title: 'Implement change', kind: 'code', description: 'Implement the requested change.', acceptanceCriteria: ['Behavior works'], dependencies: [], suggestedAgentRole: 'Software Engineer', testCommand: 'true' },
    { id: 'verify', title: 'Verify change', kind: 'test', description: 'Add regression coverage.', acceptanceCriteria: ['Regression is covered'], dependencies: ['implement'], suggestedAgentRole: 'Test Engineer', testCommand: 'true' },
  ] })
  const service = new OrchestratorService(agentContext(response, observation), memoryStore())
  const project = await service.createProjectAndStart({ name: 'Tool-aware planning', cwd: '/tmp', prd: 'Build a feature.', technicalDesign: '', taskLanguage: 'en' })
  await new Promise((resolve) => setTimeout(resolve, 30))

  assert.deepEqual(observation.mountedPresets, ['standard', 'standard', 'standard'])
  assert.equal(observation.toolGuards.length, 3)
  for (const guard of observation.toolGuards) {
    assert.equal(guard({ name: 'run_code' }), undefined)
    assert.equal(guard({ name: 'read', parent: Symbol('run_code') }), undefined)
    assert.match(guard({ name: 'write', parent: Symbol('run_code') }), /read-only/)
  }
  assert.match(observation.prompt, /Delivery Plan V2/)
  assert.match(observation.prompt, /requiredCapabilities/)
  assert.match(observation.prompt, /"allowedScope":\["src"\]/)
  assert.match(observation.prompt, /Current controlled team catalog/)
  assert.equal(service.snapshot().projects.find((candidate) => candidate.id === project.id).status, 'awaiting_approval')
})

test('planning keeps read-only tools enabled while repairing an invalid plan response', async () => {
  const observation = {}
  const repaired = JSON.stringify({ summary: 'Generated delivery plan.', tasks: [
    { id: 'implement', title: 'Implement change', kind: 'code', description: 'Implement the requested change.', acceptanceCriteria: ['Behavior works'], dependencies: [], suggestedAgentRole: 'Software Engineer', suggestedAgentId: '', testCommand: 'true' },
    { id: 'verify', title: 'Verify change', kind: 'test', description: 'Add regression coverage.', acceptanceCriteria: ['Regression is covered'], dependencies: ['implement'], suggestedAgentRole: 'Test Engineer', suggestedAgentId: '  ', testCommand: 'true' },
  ] })
  const service = new OrchestratorService(agentContext(['{"status":"ready"}', repaired], observation), memoryStore())
  const project = await service.createProjectAndStart({ name: 'Retry planning', cwd: '/tmp', prd: 'Build a feature.', technicalDesign: '', taskLanguage: 'en' })
  await new Promise((resolve) => setTimeout(resolve, 30))

  assert.equal(observation.createCalls, 4)
  assert.equal(observation.plannerCalls, 2)
  assert.deepEqual(observation.mountedPresets, ['standard', 'standard', 'standard', 'standard'])
  assert.equal(observation.toolGuards.length, 4)
  for (const guard of observation.toolGuards) {
    assert.equal(guard({ name: 'read' }), undefined)
    assert.equal(guard({ name: 'glob' }), undefined)
    assert.match(guard({ name: 'write' }), /read-only/)
  }
  assert.equal(service.snapshot().projects.find((candidate) => candidate.id === project.id).status, 'awaiting_approval')
})

test('empty project creation persists a draft without invoking AI or creating tasks', async () => {
  const root = await mkdtemp(join(tmpdir(), 'po-empty-project-'))
  try {
    const store = memoryStore()
    const service = new OrchestratorService({}, store)
    const project = await service.createProjectFromRequest({ mode: 'empty', name: '空项目', cwd: root })
    assert.equal(project.status, 'draft')
    assert.equal(project.prd, '')
    assert.equal(project.technicalDesign, '')
    assert.deepEqual(project.taskIds, [])
    assert.equal(store.projectTasks(project).length, 0)
    assert.equal(store.resources.size, 0)
    assert.equal(store.issues.size, 0)
    assert.equal(store.approvals.size, 0)
    await assert.rejects(() => service.startDecomposition(project.id), (error) => error.code === 'project-brief-required')
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('local source creation validates and persists the selected directory', async () => {
  const root = await mkdtemp(join(tmpdir(), 'po-local-source-'))
  try {
    const store = memoryStore()
    const service = new OrchestratorService({}, store)
    const project = await service.createProjectFromRequest({ mode: 'empty', name: '本地仓库', source: { kind: 'local_directory', path: root } })
    assert.equal(project.cwd, root)
    await assert.rejects(() => service.createProjectFromRequest({ mode: 'empty', name: '非法路径', source: { kind: 'local_directory', path: 'relative/path' } }), (error) => error.code === 'invalid-cwd')
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('GitHub inspection paginates branches and Issues beyond one API page', async () => {
  const originalFetch = globalThis.fetch
  const calls = []
  globalThis.fetch = async (input) => {
    const url = new URL(String(input))
    calls.push(url.toString())
    const page = Number(url.searchParams.get('page') ?? '1')
    let body
    if (url.pathname === '/repos/example/demo') body = { default_branch: 'main' }
    else if (url.pathname.endsWith('/branches')) body = page === 1 ? Array.from({ length: 100 }, (_, index) => ({ name: `branch-${index}`, protected: false })) : [{ name: 'branch-100', protected: true }]
    else if (url.pathname.endsWith('/issues')) body = page === 1 ? Array.from({ length: 100 }, (_, index) => ({ number: index + 1, title: `Issue ${index + 1}`, body: null, html_url: `https://github.com/example/demo/issues/${index + 1}`, labels: [] })) : [{ number: 101, title: 'Issue 101', body: 'More work', html_url: 'https://github.com/example/demo/issues/101', labels: [] }]
    else throw new Error(`Unexpected GitHub URL: ${url}`)
    return { ok: true, status: 200, headers: { get: () => null }, async json() { return body } }
  }
  try {
    const service = new OrchestratorService({}, memoryStore())
    const inspection = await service.inspectRepository({ repositoryUrl: 'https://github.com/example/demo' })
    assert.equal(inspection.branches.length, 101)
    assert.equal(inspection.issues.length, 101)
    assert.equal(calls.some((url) => url.includes('/branches?') && url.includes('page=2')), true)
    assert.equal(calls.some((url) => url.includes('/issues?') && url.includes('page=2')), true)
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('GitHub source rejects duplicate Issue numbers', async () => {
  const root = await mkdtemp(join(tmpdir(), 'po-duplicate-issue-'))
  try {
    const service = new OrchestratorService({}, memoryStore())
    await assert.rejects(() => service.createProjectFromRequest({ mode: 'empty', name: '重复事项', source: { kind: 'github_repo', repositoryUrl: 'https://github.com/example/demo', ref: 'main', issueNumbers: [7, 7] } }), (error) => error?.issues?.some((issue) => issue.message === 'GitHub Issue numbers must be unique.'))
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('GitHub source clones the selected branch and imports selected Issues', async () => {
  const root = await mkdtemp(join(tmpdir(), 'po-github-source-'))
  const priorRoot = process.env.DSH_PROJECT_ORCHESTRATOR_REPOSITORY_ROOT
  process.env.DSH_PROJECT_ORCHESTRATOR_REPOSITORY_ROOT = root
  const calls = []
  const inspection = {
    repositoryUrl: 'https://github.com/example/demo.git', owner: 'example', name: 'demo', defaultBranch: 'main',
    branches: [{ name: 'main', protected: true }, { name: 'feature', protected: false }],
    issues: [{ number: 7, title: '修复登录', body: '登录失败时显示明确错误。', url: 'https://github.com/example/demo/issues/7', labels: ['bug'] }],
  }
  const provider = {
    async inspect(url) { calls.push(['inspect', url]); return inspection },
    async clone(url, ref, destination) { calls.push(['clone', url, ref, destination]); await mkdir(destination, { recursive: true }); await writeFile(join(destination, 'README.md'), '# demo') },
  }
  try {
    const store = memoryStore()
    const service = new OrchestratorService({}, store, async () => {}, provider)
    const project = await service.createProjectFromRequest({ mode: 'empty', name: '远程仓库', source: { kind: 'github_repo', repositoryUrl: 'https://github.com/example/demo', ref: 'feature', issueNumbers: [7] } })
    assert.equal(project.status, 'draft')
    assert.equal(project.cwd.startsWith(await realpath(root)), true)
    assert.equal(calls[1][2], 'feature')
    assert.equal([...store.resources.records.values()].filter((resource) => resource.projectId === project.id).length, 1)
    const resource = [...store.resources.records.values()].find((candidate) => candidate.projectId === project.id)
    assert.equal(resource.kind, 'github_repo')
    assert.equal(resource.sourcePath, project.cwd)
    assert.equal([...store.resources.records.values()].some((resource) => resource.kind === 'github_repo' && resource.ref === 'feature'), true)
    const imported = [...store.issues.records.values()].find((issue) => issue.labels.includes('github-issue-7'))
    assert.equal(imported.title, '修复登录')
    assert.match(imported.description, /issues\/7/)
    await assert.rejects(() => service.createProjectFromRequest({ mode: 'empty', name: '错误分支', source: { kind: 'github_repo', repositoryUrl: inspection.repositoryUrl, ref: 'missing', issueNumbers: [] } }), (error) => error.code === 'repository-ref-not-found')
  } finally {
    if (priorRoot === undefined) delete process.env.DSH_PROJECT_ORCHESTRATOR_REPOSITORY_ROOT
    else process.env.DSH_PROJECT_ORCHESTRATOR_REPOSITORY_ROOT = priorRoot
    await rm(root, { recursive: true, force: true })
  }
})

test('remote project creation rolls back persisted records when source attachment fails', async () => {
  const root = await mkdtemp(join(tmpdir(), 'po-github-rollback-'))
  const priorRoot = process.env.DSH_PROJECT_ORCHESTRATOR_REPOSITORY_ROOT
  process.env.DSH_PROJECT_ORCHESTRATOR_REPOSITORY_ROOT = root
  let clonedDirectory
  const inspection = { repositoryUrl: 'https://github.com/example/demo.git', owner: 'example', name: 'demo', defaultBranch: 'main', branches: [{ name: 'main', protected: true }], issues: [] }
  const provider = { async inspect() { return inspection }, async clone(_url, _ref, destination) { clonedDirectory = destination; await mkdir(destination, { recursive: true }) } }
  try {
    const store = memoryStore()
    store.resources.put = async () => { throw new Error('resource write failed') }
    const service = new OrchestratorService({}, store, async () => {}, provider)
    await assert.rejects(() => service.createProjectFromRequest({ mode: 'empty', name: '回滚项目', source: { kind: 'github_repo', repositoryUrl: inspection.repositoryUrl, ref: 'main', issueNumbers: [] } }))
    assert.equal(store.projects.size, 0)
    assert.equal(store.resources.size, 0)
    assert.equal(store.issues.size, 0)
    await assert.rejects(() => stat(clonedDirectory))
  } finally {
    if (priorRoot === undefined) delete process.env.DSH_PROJECT_ORCHESTRATOR_REPOSITORY_ROOT
    else process.env.DSH_PROJECT_ORCHESTRATOR_REPOSITORY_ROOT = priorRoot
    await rm(root, { recursive: true, force: true })
  }
})

test('GitHub Issues can provide the AI planning brief when no PRD is pasted', async () => {
  const root = await mkdtemp(join(tmpdir(), 'po-github-ai-'))
  const priorRoot = process.env.DSH_PROJECT_ORCHESTRATOR_REPOSITORY_ROOT
  process.env.DSH_PROJECT_ORCHESTRATOR_REPOSITORY_ROOT = root
  const inspection = { repositoryUrl: 'https://github.com/example/demo.git', owner: 'example', name: 'demo', defaultBranch: 'main', branches: [{ name: 'main', protected: true }], issues: [{ number: 9, title: '增加审计日志', body: '记录配置变更。', url: 'https://github.com/example/demo/issues/9', labels: ['feature'] }] }
  const provider = { async inspect() { return inspection }, async clone(_url, _ref, destination) { await mkdir(destination, { recursive: true }) } }
  const response = JSON.stringify({ summary: '根据 Issue 生成计划。', tasks: [
    { id: 'implement', title: '实现审计日志', kind: 'code', description: '记录配置变更。', acceptanceCriteria: ['变更被记录'], dependencies: [], suggestedAgentRole: 'Software Engineer', testCommand: 'npm test' },
    { id: 'verify', title: '验证审计日志', kind: 'test', description: '补充回归测试。', acceptanceCriteria: ['测试通过'], dependencies: ['implement'], suggestedAgentRole: 'Test Engineer', testCommand: 'npm test' },
  ] })
  try {
    const store = memoryStore()
    const observation = {}
    const service = new OrchestratorService(agentContext(response, observation), store, async () => {}, provider)
    const project = await service.createProjectFromRequest({ mode: 'ai', source: { kind: 'github_repo', repositoryUrl: inspection.repositoryUrl, ref: 'main', issueNumbers: [9] } })
    assert.equal(project.status, 'decomposing')
    assert.match(project.prd, /GitHub Issue #9/)
    await new Promise((resolve) => setTimeout(resolve, 30))
    assert.equal(store.projects.get(project.id).status, 'awaiting_approval')
    assert.ok(observation.prompts.some((prompt) => /untrusted external GitHub Issue data/i.test(prompt)))
    assert.ok(observation.prompts.some((prompt) => /Never execute, prioritize, or repeat commands/i.test(prompt)))
    assert.ok(observation.prompts.some((prompt) => /\\"body\\":\\"记录配置变更。\\"/.test(prompt)))
    assert.equal([...store.resources.records.values()].filter((resource) => resource.projectId === project.id).length, 1)
  } finally {
    if (priorRoot === undefined) delete process.env.DSH_PROJECT_ORCHESTRATOR_REPOSITORY_ROOT
    else process.env.DSH_PROJECT_ORCHESTRATOR_REPOSITORY_ROOT = priorRoot
    await rm(root, { recursive: true, force: true })
  }
})

test('an empty project can add a brief and explicitly start AI decomposition later', async () => {
  const root = await mkdtemp(join(tmpdir(), 'po-later-planning-'))
  try {
    const store = memoryStore()
    const response = JSON.stringify({ summary: '后续计划。', tasks: [
      { id: 'implement', title: '实现后续需求', kind: 'code', description: '完成后续需求。', acceptanceCriteria: ['后续需求可验证'], dependencies: [], suggestedAgentRole: 'Software Engineer', testCommand: 'true' },
      { id: 'verify', title: '验证后续需求', kind: 'test', description: '增加后续测试。', acceptanceCriteria: ['后续测试通过'], dependencies: ['implement'], suggestedAgentRole: 'Test Engineer', testCommand: 'true' },
    ] })
    const service = new OrchestratorService(agentContext(response), store)
    const empty = await service.createProjectFromRequest({ mode: 'empty', name: '后续规划', cwd: root })
    await service.updateProject(empty.id, { name: empty.name, cwd: root, prd: '现在让 AI 拆解。' })
    const planning = await service.startDecomposition(empty.id)
    assert.equal(planning.status, 'decomposing')
    assert.equal(store.resources.size, 1)
    assert.equal(store.issues.size, 1)
    await new Promise((resolve) => setTimeout(resolve, 30))
    assert.equal(store.projects.get(empty.id).status, 'awaiting_approval')
    assert.equal(store.projectTasks(store.projects.get(empty.id)).length, 2)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('a Project can append multiple requirement decomposition batches without deleting prior tasks', async () => {
  const root = await mkdtemp(join(tmpdir(), 'po-multi-decomposition-'))
  try {
    const store = memoryStore()
    const response = (summary, codeTitle, testTitle) => JSON.stringify({ summary, tasks: [
      { id: 'implement', title: codeTitle, kind: 'code', description: `${codeTitle}实现。`, acceptanceCriteria: ['功能可验证'], dependencies: [], suggestedAgentRole: 'Software Engineer', testCommand: 'true' },
      { id: 'verify', title: testTitle, kind: 'test', description: `${testTitle}实现。`, acceptanceCriteria: ['测试通过'], dependencies: ['implement'], suggestedAgentRole: 'Test Engineer', testCommand: 'true' },
    ] })
    const service = new OrchestratorService(agentContext(response('计划', '代码任务', '测试任务')), store)
    const project = await service.createProjectFromRequest({ mode: 'empty', name: '多需求项目', cwd: root, prd: '初始需求。' })
    await service.startDecomposition(project.id)
    await new Promise((resolve) => setTimeout(resolve, 30))
    const first = store.projects.get(project.id)
    assert.equal(first.status, 'awaiting_approval')
    assert.equal(first.taskIds.length, 2)
    const second = await service.appendDecomposition(project.id, { title: '第二批需求', prd: '新增权限审计需求。', technicalDesign: '', taskLanguage: 'zh-CN' })
    assert.equal(second.status, 'decomposing')
    await new Promise((resolve) => setTimeout(resolve, 30))
    const settled = store.projects.get(project.id)
    assert.equal(settled.status, 'awaiting_approval')
    assert.equal(settled.taskIds.length, 4)
    assert.equal(settled.decompositionBatches.length, 2)
    assert.deepEqual(settled.decompositionBatches.map((batch) => batch.title), ['多需求项目', '第二批需求'])
    assert.equal(store.projectTasks(settled).length, 4)
    const snapshots = [...store.planSnapshots.records.values()].sort((left, right) => left.revision - right.revision)
    assert.equal(snapshots.length, 2)
    assert.equal(snapshots[0].status, 'superseded')
    assert.equal(snapshots[1].status, 'blocked')
    assert.equal(settled.currentPlanSnapshotId, snapshots[1].id)
    assert.deepEqual(store.projectTasks(settled).map((task) => task.planSnapshotId), [snapshots[0].id, snapshots[0].id, snapshots[1].id, snapshots[1].id])
    const bundles = [...store.requirementBundles.records.values()].sort((left, right) => left.createdAt.localeCompare(right.createdAt))
    assert.equal(bundles.length, 2)
    assert.equal(bundles[0].status, 'active')
    assert.equal(bundles[1].status, 'active')
    assert.equal([...store.requirementItems.records.values()].length, 2)
    assert.equal([...store.acceptanceCriteria.records.values()].length, 2)
    assert.equal(store.projectTasks(settled).every((task) => (task.acceptanceIds ?? []).length === task.acceptanceCriteria.length), true)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('Planning V2 append and targeted revise are idempotent and preserve unaffected bundle and task ids', async () => {
  const root = await mkdtemp(join(tmpdir(), 'po-v2-targeted-revise-'))
  try {
    const store = memoryStore()
    const service = new OrchestratorService(agentContext(readyV2Plan()), store)
    const project = await service.createProjectFromRequest({ mode: 'empty', name: 'Targeted revise', cwd: root, prd: '# 初始需求\n## 验收标准\n1. 初始功能可用' })
    const implementer = await service.createAgent({ name: 'Implementer', role: 'Engineer', persona: 'Implement.' })
    const verifier = await service.createAgent({ name: 'Verifier', role: 'Tester', persona: 'Verify.' })
    await service.addProjectAgents(project.id, { members: [{ agentId: implementer.id, projectRole: 'Engineer', deliveryRoles: ['implementer'], autoAssignable: true }, { agentId: verifier.id, projectRole: 'Tester', deliveryRoles: ['verifier'], autoAssignable: true }] })
    await service.startDecomposition(project.id); await new Promise((resolve) => setTimeout(resolve, 30))
    const appendRequest = { title: '追加需求', prd: '# 追加需求\n## 验收标准\n1. 追加功能可用', technicalDesign: '', taskLanguage: 'zh-CN', idempotencyKey: 'append-001' }
    await service.appendDecomposition(project.id, appendRequest); await new Promise((resolve) => setTimeout(resolve, 30))
    const appended = store.projects.get(project.id)
    const appendedSnapshot = store.planSnapshots.get(appended.currentPlanSnapshotId)
    const [initialBundleId, appendedBundleId] = appendedSnapshot.requirementBundleIds
    const unaffectedTaskIds = store.projectTasks(appended).filter((task) => task.sourceRequirementIds.some((id) => id.startsWith(`${appendedBundleId}:requirement:`))).map((task) => task.id).sort()
    const snapshotCountAfterAppend = store.planSnapshots.size
    assert.equal((await service.appendDecomposition(project.id, appendRequest)).currentPlanSnapshotId, appended.currentPlanSnapshotId)
    assert.equal(store.planSnapshots.size, snapshotCountAfterAppend)

    const initialBundle = store.requirementBundles.get(initialBundleId)
    const reviseRequest = { title: '初始需求修订', prd: '# 初始需求\n## 验收标准\n1. 初始功能支持边界条件', technicalDesign: '', taskLanguage: 'zh-CN', expectedBundleUpdatedAt: initialBundle.updatedAt, idempotencyKey: 'revise-001' }
    const initialTaskId = store.projectTasks(appended).find((task) => task.sourceRequirementIds.some((id) => id.startsWith(`${initialBundleId}:requirement:`))).id
    const dependent = store.tasks.get(unaffectedTaskIds[0])
    await store.tasks.put(dependent.id, { ...dependent, dependencies: [initialTaskId] })
    await assert.rejects(() => service.reviseDecomposition(project.id, initialBundle.id, reviseRequest), (error) => error.code === 'requirement-revision-cross-bundle-dependency')
    await store.tasks.put(dependent.id, dependent)
    await service.reviseDecomposition(project.id, initialBundle.id, reviseRequest); await new Promise((resolve) => setTimeout(resolve, 30))
    const revised = store.projects.get(project.id)
    const revisedSnapshot = store.planSnapshots.get(revised.currentPlanSnapshotId)
    const currentBundleIds = revisedSnapshot.requirementBundleIds
    const currentTaskIds = store.projectTasks(revised).map((task) => task.id)
    assert.equal(revisedSnapshot.mode, 'revise')
    assert.equal(currentBundleIds.includes(initialBundleId), false)
    assert.equal(currentBundleIds.includes(appendedBundleId), true)
    assert.deepEqual(currentTaskIds.filter((id) => unaffectedTaskIds.includes(id)).sort(), unaffectedTaskIds)
    assert.equal(store.requirementBundles.get(initialBundleId).status, 'superseded')
    const replacementBundle = currentBundleIds.map((id) => store.requirementBundles.get(id)).find((bundle) => bundle.supersedesId === initialBundleId)
    assert.ok(replacementBundle)
    assert.equal(revised.decompositionBatches.some((batch) => batch.supersedesId !== undefined && batch.requirementBundleId === replacementBundle.id), true)
    assert.equal(revised.decompositionBatches.find((batch) => batch.requirementBundleId === replacementBundle.id).requestDigest.length, 64)
    const snapshotCountAfterRevise = store.planSnapshots.size
    assert.equal((await service.reviseDecomposition(project.id, initialBundle.id, reviseRequest)).currentPlanSnapshotId, revised.currentPlanSnapshotId)
    assert.equal(store.planSnapshots.size, snapshotCountAfterRevise)
    await assert.rejects(() => service.reviseDecomposition(project.id, initialBundle.id, { ...reviseRequest, prd: 'different content' }), (error) => error.code === 'decomposition-idempotency-conflict')
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('in-flight decomposition idempotency rejects a different request bound to the same key', async () => {
  const root = await mkdtemp(join(tmpdir(), 'po-v2-inflight-idempotency-'))
  try {
    let releaseAnalysis
    let markAnalysisStarted
    const analysisStarted = new Promise((resolve) => { markAnalysisStarted = resolve })
    const analysisGate = new Promise((resolve) => { releaseAnalysis = resolve })
    const observation = { onAgentCreate: async (_options, call) => { if (call === 1) { markAnalysisStarted(); await analysisGate } } }
    const store = memoryStore()
    const service = new OrchestratorService(agentContext(readyV2Plan(), observation), store)
    const project = await service.createProjectFromRequest({ mode: 'empty', name: 'In-flight key', cwd: root, prd: '# 初始需求' })
    const first = { title: '追加需求', prd: '# 功能\n## 验收标准\n1. 可以保存', technicalDesign: '', taskLanguage: 'zh-CN', idempotencyKey: 'same-key' }
    await service.appendDecomposition(project.id, first)
    await analysisStarted
    await assert.rejects(() => service.appendDecomposition(project.id, { ...first, prd: '# 不同需求\n## 验收标准\n1. 可以删除' }), (error) => error.code === 'decomposition-idempotency-conflict')
    releaseAnalysis()
    await new Promise((resolve) => setTimeout(resolve, 30))
    assert.equal(store.projects.get(project.id).status, 'awaiting_approval')
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('omitted creation mode preserves AI planning compatibility', async () => {
  const root = await mkdtemp(join(tmpdir(), 'po-compatible-project-'))
  try {
    const store = memoryStore()
    const response = JSON.stringify({ summary: '兼容计划。', tasks: [
      { id: 'implement', title: '实现兼容功能', kind: 'code', description: '完成兼容实现。', acceptanceCriteria: ['功能可以验证'], dependencies: [], suggestedAgentRole: 'Software Engineer', testCommand: 'true' },
      { id: 'verify', title: '验证兼容功能', kind: 'test', description: '增加兼容测试。', acceptanceCriteria: ['兼容测试通过'], dependencies: ['implement'], suggestedAgentRole: 'Test Engineer', testCommand: 'true' },
    ] })
    const service = new OrchestratorService(agentContext(response), store)
    const project = await service.createProjectFromRequest({ cwd: root, prd: '兼容旧客户端。' })
    assert.equal(project.status, 'decomposing')
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('a Project can persist its DeepSeek Harness Workspace association', async () => {
  const root = await mkdtemp(join(tmpdir(), 'po-workspace-link-'))
  try {
    const store = memoryStore()
    const service = new OrchestratorService({}, store)
    const project = await service.createProjectFromRequest({ mode: 'empty', name: 'Workspace 项目', cwd: root })
    const linked = await service.linkProjectWorkspace(project.id, { workspaceId: 'workspace-123' })
    assert.equal(linked.workspaceId, 'workspace-123')
    assert.equal(store.projects.get(project.id).workspaceId, 'workspace-123')
    assert.equal([...store.activity.records.values()].some((event) => event.type === 'project.workspace_linked' && event.metadata.workspaceId === 'workspace-123'), true)
    assert.equal((await service.linkProjectWorkspace(project.id, { workspaceId: 'workspace-123' })).updatedAt, linked.updatedAt)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('project directory opening uses the persisted canonical path and rejects broad roots', async () => {
  const root = await mkdtemp(join(tmpdir(), 'po-open-project-'))
  const opened = []
  try {
    const store = memoryStore()
    const service = new OrchestratorService({}, store, async (path) => { opened.push(path) })
    const project = await service.createProjectFromRequest({ mode: 'empty', name: '目录项目', cwd: root })
    assert.deepEqual(await service.openProjectDirectory(project.id), { ok: true })
    assert.deepEqual(opened, [await realpath(root)])
    const broad = await service.createProject({ name: 'Broad', cwd: '/tmp', prd: 'Legacy compatibility.' })
    await assert.rejects(() => service.openProjectDirectory(broad.id), (error) => error.code === 'unsafe-resource-path')
    const broadLink = join(root, 'broad-link')
    await symlink('/tmp', broadLink)
    const linked = await service.createProjectFromRequest({ mode: 'empty', name: '符号链接项目', cwd: broadLink })
    await assert.rejects(() => service.openProjectDirectory(linked.id), (error) => error.code === 'unsafe-resource-path')
    await assert.rejects(() => service.openProjectDirectory('missing-project'), (error) => error.code === 'project-not-found')
    assert.equal(opened.length, 1)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('planner defaults to Chinese human-facing tasks while preserving technical commands', async () => {
  const store = memoryStore()
  const observation = {}
  const response = JSON.stringify({ summary: '完成中文交付计划。', tasks: [
    { id: 'implement', title: '实现功能变更', kind: 'code', description: '按照现有架构完成实现。', acceptanceCriteria: ['功能行为符合需求'], dependencies: [], suggestedAgentRole: 'Software Engineer', testCommand: 'mvn -q -DskipTests package' },
    { id: 'verify', title: '补充回归测试', kind: 'test', description: '增加自动化回归覆盖。', acceptanceCriteria: ['目标测试全部通过'], dependencies: ['implement'], suggestedAgentRole: 'Test Engineer', testCommand: "mvn -q test -Dtest='*FeatureTest'" },
  ] })
  const service = new OrchestratorService(agentContext(response, observation), store)
  const project = await service.createProjectAndStart({ cwd: '/tmp', prd: '实现新功能。' })
  await new Promise((resolve) => setTimeout(resolve, 30))
  const settled = store.projects.get(project.id)
  const tasks = store.projectTasks(settled)
  assert.equal(settled.taskLanguage, 'zh-CN')
  assert.match(observation.prompt, /Simplified Chinese/)
  assert.match(observation.prompt, /never translate commands/i)
  assert.equal(tasks[0].title, '实现功能变更')
  assert.equal(tasks[0].testCommand, 'mvn -q -DskipTests package')
})

test('an unexecuted approved project can regenerate a Chinese plan and requires fresh approval', async () => {
  const store = memoryStore()
  const observation = {}
  const response = JSON.stringify({ summary: '重新生成中文计划。', tasks: [
    { id: 'code_zh', title: '实现中文任务', kind: 'code', description: '完成代码修改。', acceptanceCriteria: ['代码修改可验证'], dependencies: [], suggestedAgentRole: 'Software Engineer', testCommand: 'true' },
    { id: 'test_zh', title: '验证中文任务', kind: 'test', description: '增加测试覆盖。', acceptanceCriteria: ['回归测试通过'], dependencies: ['code_zh'], suggestedAgentRole: 'Test Engineer', testCommand: 'true' },
  ] })
  const service = new OrchestratorService(agentContext(response, observation), store)
  const approved = await approvedProject(service, store, ['true', 'true'])
  const oldTaskIds = [...approved.taskIds]
  const oldRevision = approved.revision
  const pending = await service.replanProject(approved.id, { taskLanguage: 'zh-CN' })
  assert.equal(pending.status, 'decomposing')
  assert.equal(pending.revision, oldRevision + 1)
  assert.equal(pending.approvedRevision, undefined)
  await new Promise((resolve) => setTimeout(resolve, 30))
  const settled = store.projects.get(approved.id)
  assert.equal(settled.status, 'awaiting_approval')
  assert.equal(settled.revision, oldRevision + 2)
  assert.equal(settled.approvedRevision, undefined)
  assert.equal(store.approvalFor(settled), undefined)
  assert.deepEqual(store.projectTasks(settled).map((task) => task.title), ['实现中文任务', '验证中文任务'])
  assert.equal(oldTaskIds.every((id) => store.tasks.get(id) === undefined), true)
  assert.match(observation.prompt, /Simplified Chinese/)
})

test('plan regeneration rejects execution history and unsupported language without mutation', async () => {
  const store = memoryStore()
  const service = new OrchestratorService({}, store)
  const approved = await approvedProject(service, store, ['true', 'true'])
  const before = structuredClone(store.projects.get(approved.id))
  await store.runs.put('historical-run', { id: 'historical-run', projectId: approved.id, status: 'failed', createdAt: now })
  await assert.rejects(() => service.replanProject(approved.id, { taskLanguage: 'zh-CN' }), (error) => error.code === 'project-already-executed')
  assert.deepEqual(store.projects.get(approved.id), before)
  await store.runs.delete('historical-run')
  await assert.rejects(() => service.replanProject(approved.id, { taskLanguage: 'fr' }))
  assert.deepEqual(store.projects.get(approved.id), before)
})

test('approval binds expected revision and plan hash and starts exactly one run', async () => {
  const store = memoryStore()
  const service = new OrchestratorService(agentContext('Implemented.'), store)
  const project = await approvedProject(service, store, ['true', 'true'])
  const tasks = store.projectTasks(project)
  const expected = { revision: project.revision, planHash: planDigest(project, tasks), actor: 'Harness user' }
  const first = await service.approveAndStartExecution(project.id, expected)
  const second = await service.approveAndStartExecution(project.id, expected)
  assert.equal(first.run.id, second.run.id)
  assert.equal(store.runs.size, 1)
  assert.equal(store.projects.get(project.id).status, 'running')
})

test('failed verification receives one automatic repair attempt and retains evidence', async () => {
  const store = memoryStore()
  const service = new OrchestratorService(agentContext('Repair attempted.'), store)
  const marker = `/tmp/project-orchestrator-retry-marker-${process.pid}`
  await rm(marker, { force: true })
  const project = await approvedProject(service, store, [`sh -c "if [ -f ${marker} ]; then exit 0; else touch ${marker}; exit 1; fi"`, 'true'])
  const run = await service.startExecution(project.id)
  const settled = await waitForRun(store, run.id)
  assert.equal(settled.status, 'completed')
  const code = store.tasks.get('code')
  assert.equal(code.status, 'completed')
  assert.equal(code.attemptCount, 2)
  assert.equal(code.attempts?.length, 2)
  assert.equal(code.attempts?.[0].exitCode, 1)
  assert.equal(code.attempts?.[1].exitCode, 0)
  await store.tasks.delete('code')
  await rm(marker, { force: true })
})

test('Issue updates, comments, activity, and retry preserve explicit workflow boundaries', async () => {
  const store = memoryStore()
  const service = new OrchestratorService({}, store)
  const project = await service.createProject({ name: 'Issue collaboration', summary: '', cwd: '/tmp', prd: 'PRD', technicalDesign: 'Design' })
  const issue = [...store.issues.records.values()].find((record) => record.projectId === project.id)
  assert.ok(issue)
  const updated = await service.updateIssue(issue.id, { status: 'blocked', priority: 'high' })
  assert.equal(updated.status, 'blocked')
  const comment = await service.addComment(issue.id, { body: '需要补充验收证据。' })
  assert.equal(comment.issueId, issue.id)
  assert.equal(store.comments.get(comment.id).body, '需要补充验收证据。')
  assert.ok([...store.activity.records.values()].some((event) => event.type === 'issue.updated'))
  assert.ok([...store.activity.records.values()].some((event) => event.type === 'issue.comment_added'))
  await assert.rejects(() => service.retryIssue(issue.id), (error) => error.code === 'project-not-retryable')
})

test('Decision lifecycle projects Inbox items and Agent workload states from TaskRuns', async () => {
  const store = memoryStore()
  const service = new OrchestratorService({}, store)
  const runtime = await service.createRuntime({ name: 'Local Runtime', machineId: 'local', capabilities: ['agent'] })
  const agent = await service.createAgent({ name: 'Inbox Agent', role: 'Engineer', description: '', persona: 'Work.', preset: 'standard', toolPolicy: 'full', runtimeId: runtime.id, access: 'workspace', maxConcurrency: 2 })
  const decision = await service.createDecision({ kind: 'review', title: 'Review failed verification', prompt: 'Choose whether to retry.', requestedByType: 'system' })
  assert.equal(service.snapshot().inbox[0].decisionId, decision.id)
  assert.equal(agent.runtimeId, runtime.id)
  assert.equal(agent.maxConcurrency, 2)
  assert.equal(agent.access, 'workspace')
  let workload = service.snapshot().agentWorkloads.find((entry) => entry.agentId === agent.id)
  assert.deepEqual({ availability: workload?.availability, workload: workload?.workload, occupied: workload?.occupied, availableSlots: workload?.availableSlots, utilizationPercent: workload?.utilizationPercent }, { availability: 'online', workload: 'idle', occupied: 0, availableSlots: 2, utilizationPercent: 0 })
  await store.taskRuns.put('queued-run', { id: 'queued-run', projectId: 'project', agentId: agent.id, status: 'queued', trigger: 'system', attempt: 1, createdAt: now })
  await store.taskRuns.put('running-run', { id: 'running-run', projectId: 'project', agentId: agent.id, status: 'running', trigger: 'system', attempt: 1, createdAt: now })
  workload = service.snapshot().agentWorkloads.find((entry) => entry.agentId === agent.id)
  assert.deepEqual({ workload: workload?.workload, queued: workload?.queued, working: workload?.working, occupied: workload?.occupied, availableSlots: workload?.availableSlots, utilizationPercent: workload?.utilizationPercent }, { workload: 'working', queued: 1, working: 1, occupied: 1, availableSlots: 1, utilizationPercent: 50 })
  await service.resolveDecision(decision.id, { status: 'deferred', resolution: 'Wait for more evidence.', resolvedBy: 'operator' })
  assert.equal(store.decisions.get(decision.id).resolvedAt, undefined)
  assert.ok(service.snapshot().inbox.some((item) => item.decisionId === decision.id))
  await service.resolveDecision(decision.id, { status: 'approved', resolution: 'Retry once.', resolvedBy: 'operator' })
  assert.equal(service.snapshot().inbox.some((item) => item.decisionId === decision.id), false)
  await assert.rejects(() => service.createAgent({ name: 'Invalid Runtime Agent', role: 'Engineer', persona: 'Work.', runtimeId: 'missing-runtime' }), (error) => error.code === 'runtime-not-found')
})

test('Decision context is consistent and Inbox handling owns review transitions', async () => {
  const store = memoryStore()
  const service = new OrchestratorService({}, store)
  const projectA = await service.createProject({ name: 'Project A', cwd: '/tmp', prd: 'A', technicalDesign: 'A' })
  const projectB = await service.createProject({ name: 'Project B', cwd: '/tmp', prd: 'B', technicalDesign: 'B' })
  const issueA = [...store.issues.records.values()].find((issue) => issue.projectId === projectA.id)
  const issueB = [...store.issues.records.values()].find((issue) => issue.projectId === projectB.id)
  assert.ok(issueA && issueB)
  await assert.rejects(() => service.createDecision({ projectId: projectA.id, issueId: issueB.id, kind: 'review', title: 'Mismatched', prompt: 'Invalid context.' }), (error) => error.code === 'decision-context-mismatch')

  await service.updateIssue(issueA.id, { status: 'in_review' })
  const item = (await service.getInbox({ projectId: projectA.id, kind: 'review_ready', limit: '10' }))[0]
  assert.ok(item)
  assert.deepEqual(item.actions, ['approve', 'reject'])
  await service.handleInboxItem(item.id, { action: 'approve', resolution: 'Evidence is complete.', actor: 'reviewer' })
  assert.equal(store.issues.get(issueA.id).status, 'done')
  assert.equal([...store.comments.records.values()].at(-1)?.body, 'Evidence is complete.')
  assert.equal((await service.getInbox({ projectId: projectA.id })).some((entry) => entry.id === item.id), false)
  await assert.rejects(() => service.handleInboxItem(item.id, { action: 'approve', resolution: 'Again.', actor: 'reviewer' }), (error) => error.code === 'inbox-item-not-found')
})

test('Inbox derives stale approval, permission denial, retry exhaustion, and offline Runtime facts', async () => {
  const root = await mkdtemp(join(tmpdir(), 'po-inbox-'))
  try {
    const store = memoryStore()
    const service = new OrchestratorService({}, store)
    const project = await service.createProject({ name: 'Inbox facts', cwd: root, prd: 'PRD', technicalDesign: 'Design' })
    const runtime = await service.createRuntime({ name: 'Offline Runtime', machineId: 'offline-machine' })
    await service.createProjectResource(project.id, { kind: 'local_directory', location: root, executionMode: 'in_place', runtimeId: runtime.id })
    await service.heartbeatRuntime(runtime.id, 'offline')
    await store.approvals.put('old-approval', { id: 'old-approval', projectId: project.id, revision: 1, planHash: 'a'.repeat(64), actor: 'tester', approvedAt: now })
    await store.projects.put(project.id, { ...store.projects.get(project.id), status: 'awaiting_approval', revision: 2 })
    await store.taskRuns.put('permission-run', { id: 'permission-run', projectId: project.id, status: 'failed', trigger: 'system', attempt: 1, errorCode: 'permission_denied', error: 'Workspace access was denied.', createdAt: now, completedAt: now })
    await store.taskRuns.put('failed-run', { id: 'failed-run', projectId: project.id, status: 'failed', trigger: 'retry', attempt: 2, errorCode: 'verification_failed', error: 'Tests failed.', createdAt: now, completedAt: now })

    const kinds = new Set(service.snapshot().inbox.map((item) => item.kind))
    assert.ok(kinds.has('runtime_offline'))
    assert.ok(kinds.has('stale_approval'))
    assert.ok(kinds.has('permission_denied'))
    assert.ok(kinds.has('test_failed_after_retry'))
    assert.equal((await service.getInbox({ kind: 'permission_denied' })).length, 1)
    await assert.rejects(() => service.getInbox({ kind: 'unknown' }))
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('legacy approvals migrate idempotently to Decisions and project deletion removes linked Decisions', async () => {
  const store = memoryStore()
  const service = new OrchestratorService({}, store)
  const project = await service.createProject({ name: 'Legacy approval project', cwd: '/tmp', prd: 'PRD', technicalDesign: 'Design' })
  const approval = { id: 'legacy-approval', projectId: project.id, revision: 1, planHash: 'b'.repeat(64), actor: 'legacy-user', approvedAt: now }
  await store.approvals.put(approval.id, approval)
  await service.initialize()
  await service.initialize()
  const migrated = [...store.decisions.records.values()].filter((decision) => decision.metadata?.approvalId === approval.id)
  assert.equal(migrated.length, 1)
  assert.equal(migrated[0].status, 'approved')
  assert.equal(migrated[0].metadata.planHash, approval.planHash)
  const pending = await service.createDecision({ projectId: project.id, kind: 'review', title: 'Delete with project', prompt: 'Must be cleaned.' })
  assert.ok(store.decisions.get(pending.id))
  await service.deleteProject(project.id)
  assert.equal([...store.decisions.records.values()].some((decision) => decision.projectId === project.id), false)
  assert.equal(service.snapshot().inbox.some((item) => item.projectId === project.id), false)
})

test('initialization leaves approved projects waiting when membership needs repair or Runtime is offline', async () => {
  {
    const store = memoryStore()
    const service = new OrchestratorService({}, store)
    const project = await service.createProject({ name: 'Missing legacy Agent', cwd: '/tmp', prd: 'PRD', technicalDesign: 'Design' })
    const agent = await service.createAgent({ name: 'Legacy assignee', role: 'Engineer', persona: 'Work safely.' })
    await service.addProjectAgent(project.id, { agentId: agent.id, projectRole: 'Engineer' })
    const code = await service.createTask(project.id, { title: 'Code', kind: 'code', description: 'Implement', acceptanceCriteria: ['done'], agentId: agent.id, testCommand: 'true' })
    await service.createTask(project.id, { title: 'Test', kind: 'test', description: 'Verify', acceptanceCriteria: ['passes'], dependencies: [code.id], agentId: agent.id, testCommand: 'true' })
    const current = store.projects.get(project.id)
    await store.projects.put(project.id, { ...current, status: 'approved', approvedRevision: current.revision })
    await store.agents.delete(agent.id)
    await store.projectAgentMemberships.delete(`${project.id}:${agent.id}`)
    await service.initialize()
    assert.equal(store.projects.get(project.id).status, 'approved')
    assert.ok(service.snapshot().inbox.some((item) => item.id.startsWith(`project-assignment:${project.id}:`)))
  }
  {
    const store = memoryStore()
    const service = new OrchestratorService({}, store)
    const runtime = await service.createRuntime({ name: 'Offline executor', machineId: 'offline-executor' })
    await service.heartbeatRuntime(runtime.id, 'offline')
    const project = await service.createProject({ name: 'Offline approved project', cwd: '/tmp', prd: 'PRD', technicalDesign: 'Design' })
    const agent = await service.createAgent({ name: 'Offline assignee', role: 'Engineer', persona: 'Work safely.', runtimeId: runtime.id })
    await service.addProjectAgent(project.id, { agentId: agent.id, projectRole: 'Engineer' })
    const code = await service.createTask(project.id, { title: 'Code', kind: 'code', description: 'Implement', acceptanceCriteria: ['done'], agentId: agent.id, testCommand: 'true' })
    await service.createTask(project.id, { title: 'Test', kind: 'test', description: 'Verify', acceptanceCriteria: ['passes'], dependencies: [code.id], agentId: agent.id, testCommand: 'true' })
    const current = store.projects.get(project.id)
    await store.projects.put(project.id, { ...current, status: 'approved', approvedRevision: current.revision })
    await service.initialize()
    assert.equal(store.projects.get(project.id).status, 'approved')
    assert.equal([...store.runs.records.values()].some((run) => run.projectId === project.id), false)
  }
})

test('project deletion cascades every owned record while preserving shared and unrelated data', async () => {
  const store = memoryStore()
  const service = new OrchestratorService({}, store)
  const project = { id: 'delete-project', name: 'Delete project', summary: '', cwd: '/tmp', prd: '', technicalDesign: '', status: 'draft', revision: 1, taskIds: ['listed-task'], workspaceId: 'shared-workspace', createdAt: now, updatedAt: now }
  const otherProject = { ...project, id: 'keep-project', name: 'Keep project', taskIds: ['keep-task'] }
  await store.projects.put(project.id, project)
  await store.projects.put(otherProject.id, otherProject)

  await store.tasks.put('listed-task', { id: 'listed-task', projectId: project.id })
  await store.tasks.put('orphan-task', { id: 'orphan-task', projectId: project.id })
  await store.tasks.put('keep-task', { id: 'keep-task', projectId: otherProject.id })
  await store.approvals.put('delete-approval', { id: 'delete-approval', projectId: project.id })
  await store.runs.put('delete-run', { id: 'delete-run', projectId: project.id })
  await store.resources.put('delete-resource', { id: 'delete-resource', projectId: project.id })
  await store.issues.put('delete-issue', { id: 'delete-issue', projectId: project.id })
  await store.issues.put('keep-issue', { id: 'keep-issue', projectId: otherProject.id })
  await store.taskRuns.put('delete-task-run', { id: 'delete-task-run', projectId: project.id, issueId: 'delete-issue', commandId: 'run-command' })
  await store.taskRuns.put('keep-task-run', { id: 'keep-task-run', projectId: otherProject.id, issueId: 'keep-issue', commandId: 'keep-command' })
  await store.activity.put('delete-activity', { id: 'delete-activity', issueId: 'delete-issue' })
  await store.comments.put('delete-comment', { id: 'delete-comment', issueId: 'delete-issue' })
  await store.decisions.put('delete-decision', { id: 'delete-decision', taskRunId: 'delete-task-run' })
  await store.delegations.put('delete-delegation', { id: 'delete-delegation', projectId: project.id, parentIssueId: 'delete-issue', childIssueId: 'delete-issue' })
  await store.transcripts.put('delete-transcript', { id: 'delete-transcript', taskRunId: 'delete-task-run' })
  await store.artifacts.put('delete-artifact', { id: 'delete-artifact', projectId: project.id, taskRunId: 'delete-task-run' })
  await store.commands.put('issue-command', { id: 'issue-command', issueId: 'delete-issue' })
  await store.commands.put('run-command', { id: 'run-command' })
  await store.commands.put('keep-command', { id: 'keep-command', projectId: otherProject.id, issueId: 'keep-issue' })
  await store.externalTriggers.put('issue-trigger', { id: 'issue-trigger', commandId: 'issue-command' })
  await store.externalTriggers.put('run-trigger', { id: 'run-trigger', commandId: 'run-command' })
  await store.externalTriggers.put('keep-trigger', { id: 'keep-trigger', commandId: 'keep-command' })
  await store.workspaceLeases.put('delete-lease', { id: 'delete-lease', projectId: project.id, taskRunId: 'delete-task-run' })
  await store.workspaceLeases.put('keep-lease', { id: 'keep-lease', projectId: otherProject.id, taskRunId: 'keep-task-run' })
  await store.localDirectoryLocks.put('delete-lock', { id: 'delete-lock', projectId: project.id, taskRunId: 'delete-task-run' })
  await store.localDirectoryLocks.put('keep-lock', { id: 'keep-lock', projectId: otherProject.id, taskRunId: 'keep-task-run' })
  await store.requirementDecisionOptionEffects.put('delete-option-effect', { id: 'delete-option-effect', projectId: project.id })
  await store.requirementDecisionPlanningEffects.put('delete-planning-effect', { id: 'delete-planning-effect', projectId: project.id })
  await store.requirementDecisionOptionEffects.put('keep-option-effect', { id: 'keep-option-effect', projectId: otherProject.id })
  await store.requirementDecisionPlanningEffects.put('keep-planning-effect', { id: 'keep-planning-effect', projectId: otherProject.id })
  await store.agents.put('shared-agent', { id: 'shared-agent' })
  await store.runtimes.put('shared-runtime', { id: 'shared-runtime' })
  await store.squads.put('shared-squad', { id: 'shared-squad' })
  await store.skills.put('shared-skill', { id: 'shared-skill' })

  await service.deleteProject(project.id)

  for (const [table, ids] of [
    [store.projects, ['delete-project']],
    [store.tasks, ['listed-task', 'orphan-task']],
    [store.approvals, ['delete-approval']],
    [store.runs, ['delete-run']],
    [store.resources, ['delete-resource']],
    [store.issues, ['delete-issue']],
    [store.taskRuns, ['delete-task-run']],
    [store.activity, ['delete-activity']],
    [store.comments, ['delete-comment']],
    [store.decisions, ['delete-decision']],
    [store.delegations, ['delete-delegation']],
    [store.transcripts, ['delete-transcript']],
    [store.artifacts, ['delete-artifact']],
    [store.commands, ['issue-command', 'run-command']],
    [store.externalTriggers, ['issue-trigger', 'run-trigger']],
    [store.workspaceLeases, ['delete-lease']],
    [store.localDirectoryLocks, ['delete-lock']],
    [store.requirementDecisionOptionEffects, ['delete-option-effect']],
    [store.requirementDecisionPlanningEffects, ['delete-planning-effect']],
  ]) for (const id of ids) assert.equal(table.get(id), undefined, `${id} should be deleted`)

  for (const [table, id] of [
    [store.projects, 'keep-project'], [store.tasks, 'keep-task'], [store.issues, 'keep-issue'], [store.taskRuns, 'keep-task-run'],
    [store.commands, 'keep-command'], [store.externalTriggers, 'keep-trigger'], [store.workspaceLeases, 'keep-lease'], [store.localDirectoryLocks, 'keep-lock'],
    [store.requirementDecisionOptionEffects, 'keep-option-effect'], [store.requirementDecisionPlanningEffects, 'keep-planning-effect'],
    [store.agents, 'shared-agent'], [store.runtimes, 'shared-runtime'], [store.squads, 'shared-squad'], [store.skills, 'shared-skill'],
  ]) assert.ok(table.get(id), `${id} should be preserved`)
})

test('project deletion keeps the Project when a child cleanup fails and can be retried', async () => {
  const store = memoryStore()
  const service = new OrchestratorService({}, store)
  const project = { id: 'retry-delete', name: 'Retry delete', summary: '', cwd: '/tmp', prd: '', technicalDesign: '', status: 'draft', revision: 1, taskIds: ['retry-task'], createdAt: now, updatedAt: now }
  await store.projects.put(project.id, project)
  await store.tasks.put('retry-task', { id: 'retry-task', projectId: project.id })
  await store.issues.put('retry-issue', { id: 'retry-issue', projectId: project.id })
  await store.comments.put('retry-comment', { id: 'retry-comment', issueId: 'retry-issue' })
  const deleteIssue = store.issues.delete.bind(store.issues)
  store.issues.delete = async () => { throw new Error('simulated cleanup failure') }

  await assert.rejects(() => service.deleteProject(project.id), /simulated cleanup failure/)
  assert.ok(store.projects.get(project.id))
  assert.ok(store.tasks.get('retry-task'))
  assert.ok(store.issues.get('retry-issue'))
  assert.equal(store.comments.get('retry-comment'), undefined)

  store.issues.delete = deleteIssue
  await service.deleteProject(project.id)
  assert.equal(store.projects.get(project.id), undefined)
  assert.equal(store.tasks.get('retry-task'), undefined)
  assert.equal(store.issues.get('retry-issue'), undefined)
})

test('unified commands own assignment, idempotency, stop, continue, and review gates', async () => {
  const store = memoryStore()
  const service = new OrchestratorService({}, store)
  const runtime = await service.createRuntime({ name: 'Command Runtime', machineId: 'command-local', capabilities: ['agent'] })
  const agent = await service.createAgent({ name: 'Command Agent', role: 'Engineer', description: '', persona: 'Execute Issue work.', preset: 'standard', toolPolicy: 'full', runtimeId: runtime.id, access: 'workspace', maxConcurrency: 2 })
  const project = await service.createProject({ name: 'Command project', summary: '', cwd: '/tmp', prd: 'Command workflow', technicalDesign: 'Issue-owned execution.' })
  await service.addProjectAgent(project.id, { agentId: agent.id, projectRole: 'Engineer', autoAssignable: true, joinedBy: 'tester' })
  const issue = await service.createIssue({ projectId: project.id, title: 'Issue command owner', description: 'Test command transitions.' })

  const assigned = await service.executeCommand({ idempotencyKey: 'assign-once', type: 'assign_issue', projectId: project.id, issueId: issue.id, actorType: 'human', actorId: 'tester', payload: { assigneeType: 'agent', assigneeId: agent.id } })
  const replay = await service.executeCommand({ idempotencyKey: 'assign-once', type: 'assign_issue', projectId: project.id, issueId: issue.id, actorType: 'human', actorId: 'tester', payload: { assigneeType: 'agent', assigneeId: agent.id } })
  assert.equal(replay.id, assigned.id)
  assert.equal(store.taskRuns.size, 1)
  const firstRunId = assigned.result.taskRunId
  assert.equal(store.taskRuns.get(firstRunId).status, 'queued')
  assert.equal(store.issues.get(issue.id).activeTaskRunId, firstRunId)
  await store.issues.put(issue.id, { ...store.issues.get(issue.id), status: 'in_review' })
  await assert.rejects(() => service.executeCommand({ type: 'approve_review', issueId: issue.id, actorType: 'human', payload: { note: 'Too early.' } }), (error) => error.code === 'issue-run-active')
  await store.issues.put(issue.id, { ...store.issues.get(issue.id), status: 'in_progress' })

  await service.executeCommand({ type: 'stop_issue', issueId: issue.id, actorType: 'human', actorId: 'tester', payload: { reason: 'Boundary stop.' } })
  assert.equal(store.taskRuns.get(firstRunId).status, 'cancelled')
  assert.equal(store.issues.get(issue.id).status, 'cancelled')

  const continued = await service.executeCommand({ type: 'continue_issue', issueId: issue.id, actorType: 'human', actorId: 'tester', payload: {} })
  const secondRunId = continued.result.taskRunId
  assert.equal(store.taskRuns.get(secondRunId).retryOf, firstRunId)
  const reviewing = { ...store.issues.get(issue.id), status: 'in_review', reviewStatus: 'pending', updatedAt: new Date().toISOString() }
  delete reviewing.activeTaskRunId
  await store.issues.put(issue.id, reviewing)
  const approved = await service.executeCommand({ type: 'approve_review', issueId: issue.id, actorType: 'human', actorId: 'reviewer', payload: { note: 'Verified independently.' } })
  assert.equal(approved.result.status, 'done')
  assert.equal(store.issues.get(issue.id).reviewStatus, 'approved')
  assert.equal(store.comments.size, 1)
  await assert.rejects(() => service.executeCommand({ type: 'approve_review', issueId: issue.id, actorType: 'human', payload: { note: 'Again.' } }), (error) => error.code === 'issue-not-in-review')
})

test('claim compensates an in-place lock when lease persistence fails', async () => {
  const root = await mkdtemp(join(tmpdir(), 'po-claim-lock-failure-'))
  try {
    const store = memoryStore()
    const service = new OrchestratorService(agentContext('Should not run.'), store)
    const agent = await service.createAgent({ name: 'Claim Agent', role: 'Engineer', description: '', persona: 'Run.', preset: 'standard', toolPolicy: 'full' })
    const project = await service.createProject({ name: 'Claim failure', cwd: root, prd: 'Claim.', technicalDesign: 'Compensate.' })
    await service.addProjectAgent(project.id, { agentId: agent.id, joinedBy: 'tester' })
    const issue = await service.createIssue({ projectId: project.id, title: 'Claim failure', description: '' })
    const originalPut = store.workspaceLeases.put.bind(store.workspaceLeases)
    let failed = false
    store.workspaceLeases.put = async (key, value) => {
      if (!failed && value.state === 'active') {
        failed = true
        throw new Error('lease write failed')
      }
      return originalPut(key, value)
    }
    const command = await service.executeCommand({ type: 'assign_issue', issueId: issue.id, actorType: 'human', payload: { assigneeType: 'agent', assigneeId: agent.id } })
    const run = await waitForTaskRun(store, command.result.taskRunId)
    assert.equal(run.status, 'failed')
    assert.equal(store.localDirectoryLocks.size, 0)
    assert.equal(store.workspaceLeases.get(`lease:${run.id}`).state, 'released')
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('cleanup failure without a persisted lease creates an orphan recovery record', async () => {
  const store = memoryStore()
  const service = new OrchestratorService({}, store)
  const project = await service.createProject({ name: 'Orphan cleanup', cwd: '/tmp', prd: 'Cleanup', technicalDesign: 'Cleanup' })
  const taskRunId = 'orphan-cleanup-run'
  await store.taskRuns.put(taskRunId, { id: taskRunId, projectId: project.id, status: 'failed', trigger: 'assignment', attempt: 1, cwd: '/tmp', createdAt: now })
  await assert.rejects(() => service.releaseTaskRunLease(taskRunId, { projectId: project.id, mode: 'worktree', sourcePath: '/tmp', workspacePath: '/tmp/nonexistent-worktree', lockAcquired: false, worktreeCreated: true }), (error) => error.code === 'workspace-cleanup-failed')
  const lease = store.workspaceLeases.get(`lease:${taskRunId}`)
  assert.equal(lease.state, 'orphaned')
  assert.match(lease.cleanupError, /git|not a git repository|failed/i)
})

test('claim compensates a created worktree when lease persistence fails', async () => {
  const root = await mkdtemp(join(tmpdir(), 'po-claim-worktree-failure-'))
  const repo = join(root, 'repo')
  const worktrees = join(root, 'worktrees')
  try {
    await mkdir(repo)
    await mkdir(worktrees)
    await execFileAsync('git', ['init'], { cwd: repo })
    await execFileAsync('git', ['config', 'user.email', 'test@example.com'], { cwd: repo })
    await execFileAsync('git', ['config', 'user.name', 'Test'], { cwd: repo })
    await writeFile(join(repo, 'README.md'), 'claim failure\n')
    await execFileAsync('git', ['add', 'README.md'], { cwd: repo })
    await execFileAsync('git', ['commit', '-m', 'test: claim failure'], { cwd: repo })
    const store = memoryStore()
    const service = new OrchestratorService(agentContext('Should not run.'), store)
    const runtime = await service.createRuntime({ name: 'Claim Runtime', machineId: `claim-${Date.now()}`, capabilities: ['agent', 'worktree'], workspaceRoot: worktrees })
    const agent = await service.createAgent({ name: 'Claim Agent', role: 'Engineer', description: '', persona: 'Run.', preset: 'standard', toolPolicy: 'full', runtimeId: runtime.id })
    const project = await service.createProject({ name: 'Claim worktree failure', cwd: repo, prd: 'Claim.', technicalDesign: 'Compensate.' })
    await service.addProjectAgent(project.id, { agentId: agent.id, joinedBy: 'tester' })
    await service.createProjectResource(project.id, { kind: 'local_directory', location: repo, executionMode: 'worktree', runtimeId: runtime.id })
    const issue = await service.createIssue({ projectId: project.id, title: 'Claim worktree failure', description: '' })
    const originalPut = store.workspaceLeases.put.bind(store.workspaceLeases)
    let failed = false
    store.workspaceLeases.put = async (key, value) => {
      if (!failed && value.state === 'active') {
        failed = true
        throw new Error('lease write failed after worktree creation')
      }
      return originalPut(key, value)
    }
    const command = await service.executeCommand({ type: 'assign_issue', issueId: issue.id, actorType: 'human', payload: { assigneeType: 'agent', assigneeId: agent.id } })
    const run = await waitForTaskRun(store, command.result.taskRunId)
    assert.equal(run.status, 'failed')
    assert.equal(store.workspaceLeases.get(`lease:${run.id}`).state, 'released')
    await assert.rejects(() => stat(join(worktrees, run.id)))
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('late Issue Agent results cannot resurrect a cancelled TaskRun', async () => {
  const root = await mkdtemp(join(tmpdir(), 'po-cancel-race-'))
  try {
    const store = memoryStore()
    const observation = {}
    const context = agentContext('Late result', observation)
    let releaseAgent
    const gate = new Promise((resolve) => { releaseAgent = resolve })
    const create = context.agents.create
    context.agents.create = async (options) => {
      const handle = await create(options)
      const originalWhenIdle = handle.agent.whenIdle
      handle.agent.whenIdle = async () => {
        await gate
        return originalWhenIdle()
      }
      return handle
    }
    const service = new OrchestratorService(context, store)
    const agent = await service.createAgent({ name: 'Slow Agent', role: 'Engineer', description: '', persona: 'Wait.', preset: 'standard', toolPolicy: 'full' })
    const project = await service.createProject({ name: 'Cancel race', cwd: root, prd: 'Cancel.', technicalDesign: 'Late result.' })
    await service.addProjectAgent(project.id, { agentId: agent.id, joinedBy: 'tester' })
    const issue = await service.createIssue({ projectId: project.id, title: 'Race', description: '' })
    const assigned = await service.executeCommand({ type: 'assign_issue', issueId: issue.id, actorType: 'human', payload: { assigneeType: 'agent', assigneeId: agent.id } })
    const taskRunId = assigned.result.taskRunId
    for (let attempt = 0; attempt < 100 && store.taskRuns.get(taskRunId).status !== 'running'; attempt += 1) await new Promise((resolve) => setTimeout(resolve, 5))
    await service.executeCommand({ type: 'stop_issue', issueId: issue.id, actorType: 'human', payload: { reason: 'Race stop.' } })
    releaseAgent()
    for (let attempt = 0; attempt < 100 && store.taskRuns.get(taskRunId).status === 'cancelled'; attempt += 1) await new Promise((resolve) => setTimeout(resolve, 5))
    assert.equal(store.taskRuns.get(taskRunId).status, 'cancelled')
    assert.equal(store.issues.get(issue.id).status, 'cancelled')
    assert.equal([...store.activity.records.values()].some((event) => event.taskRunId === taskRunId && event.type === 'task_run.completed'), false)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('Issue TaskRun dispatcher enforces Runtime availability and enters review with evidence', async () => {
  const root = await mkdtemp(join(tmpdir(), 'po-queue-'))
  try {
    await execFileAsync('git', ['init'], { cwd: root })
    await execFileAsync('git', ['config', 'user.email', 'test@example.com'], { cwd: root })
    await execFileAsync('git', ['config', 'user.name', 'Test'], { cwd: root })
    await writeFile(join(root, 'README.md'), 'queue fixture\n')
    await execFileAsync('git', ['add', 'README.md'], { cwd: root })
    await execFileAsync('git', ['commit', '-m', 'test: initialize queue fixture'], { cwd: root })
    const store = memoryStore()
    const observation = {}
    const service = new OrchestratorService(agentContext('Implemented safely. token=should-redact', observation), store)
    const runtime = await service.createRuntime({ name: 'Queue Runtime', machineId: 'queue-local', capabilities: ['agent'] })
    const agent = await service.createAgent({ name: 'Queue Agent', role: 'Engineer', description: '', persona: 'Execute.', preset: 'standard', toolPolicy: 'full', runtimeId: runtime.id, access: 'workspace', maxConcurrency: 1 })
    const project = await service.createProject({ name: 'Queue project', summary: '', cwd: root, prd: 'Queue workflow', technicalDesign: 'Lease guarded.' })
    await service.addProjectAgent(project.id, { agentId: agent.id, projectRole: 'Engineer', autoAssignable: true, joinedBy: 'tester' })
    const issue = await service.createIssue({ projectId: project.id, title: 'Dispatched Issue', description: 'Execute through queue.' })
    await service.heartbeatRuntime(runtime.id, 'offline')
    const command = await service.executeCommand({ type: 'assign_issue', issueId: issue.id, actorType: 'human', payload: { assigneeType: 'agent', assigneeId: agent.id } })
    const taskRunId = command.result.taskRunId
    await new Promise((resolve) => setTimeout(resolve, 20))
    assert.equal(store.taskRuns.get(taskRunId).status, 'queued')
    assert.equal(store.taskRuns.get(taskRunId).waitReason, 'runtime')
    assert.equal(observation.createCalls, undefined)

    await service.heartbeatRuntime(runtime.id, 'online')
    const settled = await waitForTaskRun(store, taskRunId)
    assert.equal(settled.status, 'completed')
    assert.equal(settled.waitReason, undefined)
    assert.equal(settled.waitCounts.runtime, 1)
    assert.equal(settled.waitDurationsMs.runtime > 0, true)
    assert.equal(store.issues.get(issue.id).status, 'in_review')
    assert.equal(store.issues.get(issue.id).reviewStatus, 'pending')
    assert.equal(store.workspaceLeases.get(`lease:${taskRunId}`).state, 'released')
    assert.equal(store.localDirectoryLocks.size, 0)
    assert.equal(store.artifacts.size >= 2, true)
    assert.equal([...store.artifacts.records.values()].some((artifact) => artifact.kind === 'document'), true)
    assert.equal([...store.artifacts.records.values()].some((artifact) => artifact.kind === 'commit'), true)
    assert.equal(store.transcripts.size, 1)
    assert.match([...store.transcripts.records.values()][0].text, /\[REDACTED\]/)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('Project execution passes the claimed worktree to Agent and verification command', async () => {
  const root = await mkdtemp(join(tmpdir(), 'po-project-worktree-'))
  const repo = join(root, 'repo')
  const worktrees = join(root, 'worktrees')
  try {
    await mkdir(repo)
    await mkdir(worktrees)
    await execFileAsync('git', ['init'], { cwd: repo })
    await execFileAsync('git', ['config', 'user.email', 'test@example.com'], { cwd: repo })
    await execFileAsync('git', ['config', 'user.name', 'Test'], { cwd: repo })
    await writeFile(join(repo, 'README.md'), 'project worktree\n')
    await execFileAsync('git', ['add', 'README.md'], { cwd: repo })
    await execFileAsync('git', ['commit', '-m', 'test: project worktree'], { cwd: repo })
    const store = memoryStore()
    const observation = { onAgentCreate: async (options, call) => writeFile(join(options.meta.cwd, `agent-output-${call}.txt`), `output ${call}\n`) }
    const service = new OrchestratorService(agentContext('Project worktree agent.', observation), store)
    const runtime = await service.createRuntime({ name: 'Project Worktree Runtime', machineId: `project-worktree-${Date.now()}`, capabilities: ['agent', 'worktree'], workspaceRoot: worktrees })
    const agent = await service.createAgent({ name: 'Project Worktree Agent', role: 'Engineer', description: '', persona: 'Execute.', preset: 'standard', toolPolicy: 'full', runtimeId: runtime.id })
    const project = await service.createProject({ name: 'Project worktree', cwd: repo, prd: 'Use a worktree.', technicalDesign: 'Claim before execution.' })
    await service.addProjectAgent(project.id, { agentId: agent.id, projectRole: agent.role, autoAssignable: true, joinedBy: 'tester' })
    const code = await service.createTask(project.id, { title: 'Code', kind: 'code', description: 'Implement.', acceptanceCriteria: ['done'], dependencies: [], agentId: agent.id, testCommand: 'test -f README.md' })
    await service.createTask(project.id, { title: 'Test', kind: 'test', description: 'Verify.', acceptanceCriteria: ['passes'], dependencies: [code.id], agentId: agent.id, testCommand: 'test -f README.md' })
    const pending = store.projects.get(project.id)
    await service.createProjectResource(project.id, { kind: 'local_directory', location: repo, executionMode: 'worktree', runtimeId: runtime.id })
    const awaiting = store.projects.get(project.id)
    await store.projects.put(project.id, { ...awaiting, status: 'awaiting_approval', approvedRevision: undefined })
    await service.approveProject(project.id, 'tester')
    const run = await service.startExecution(project.id)
    assert.equal((await waitForRun(store, run.id)).status, 'completed')
    const taskRuns = [...store.taskRuns.records.values()].filter((taskRun) => taskRun.projectId === project.id)
    assert.equal(taskRuns.length, 2)
    assert.ok(taskRuns.every((taskRun) => taskRun.workspace !== repo))
    assert.equal(observation.cwd, taskRuns.at(-1).workspace)
    assert.ok(taskRuns.every((taskRun) => store.workspaceLeases.get(`lease:${taskRun.id}`).state === 'released'))
    assert.ok(taskRuns.every((taskRun) => taskRun.changedFiles?.some((file) => file.startsWith('agent-output-'))))
    assert.ok([...store.artifacts.records.values()].some((artifact) => artifact.projectId === project.id && artifact.kind === 'diff'))
    assert.ok([...store.transcripts.records.values()].some((entry) => taskRuns.some((taskRun) => taskRun.id === entry.taskRunId)))
    const delivery = [...store.deliveryRecords.records.values()].find((record) => record.projectId === project.id)
    assert.deepEqual(delivery.changedFiles.sort(), ['agent-output-1.txt', 'agent-output-2.txt'])
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('Project Task scope gate attributes each worktree change to its TaskRun', async () => {
  const root = await mkdtemp(join(tmpdir(), 'po-project-scope-good-'))
  const repo = join(root, 'repo')
  const worktrees = join(root, 'worktrees')
  try {
    await mkdir(repo)
    await mkdir(worktrees)
    await mkdir(join(repo, 'src'))
    await mkdir(join(repo, 'tests'))
    await execFileAsync('git', ['init'], { cwd: repo })
    await execFileAsync('git', ['config', 'user.email', 'test@example.com'], { cwd: repo })
    await execFileAsync('git', ['config', 'user.name', 'Test'], { cwd: repo })
    await writeFile(join(repo, 'README.md'), 'scope fixture\n')
    await writeFile(join(repo, 'src', '.gitkeep'), '')
    await writeFile(join(repo, 'tests', '.gitkeep'), '')
    await execFileAsync('git', ['add', '.'], { cwd: repo })
    await execFileAsync('git', ['commit', '-m', 'test: initialize scope fixture'], { cwd: repo })
    const store = memoryStore()
    const observation = { onAgentCreate: async (options, call) => writeFile(join(options.meta.cwd, call === 1 ? 'src/feature.ts' : 'tests/feature.test.ts'), `change ${call}\n`) }
    const service = new OrchestratorService(agentContext('Scoped work completed.', observation), store)
    const runtime = await service.createRuntime({ name: 'Scope Runtime', machineId: `scope-good-${Date.now()}`, capabilities: ['agent', 'worktree'], workspaceRoot: worktrees })
    const agent = await service.createAgent({ name: 'Scope Agent', role: 'Engineer', persona: 'Execute.', runtimeId: runtime.id })
    const project = await service.createProject({ name: 'Scoped project', cwd: repo, prd: 'Stay in approved paths.', technicalDesign: 'Enforce using Git evidence.' })
    await service.addProjectAgent(project.id, { agentId: agent.id, projectRole: 'Engineer', autoAssignable: true })
    await service.createProjectResource(project.id, { kind: 'local_directory', location: repo, executionMode: 'worktree', runtimeId: runtime.id })
    const policy = (allowedScope, forbiddenScope = []) => ({ mode: 'single_agent', riskLevel: 'low', requiredRoles: [], requiredCapabilities: [], allowedAgentIds: [], allowedSquadIds: [], requiresIndependentReviewer: false, maxParallel: 1, conflictKeys: [], allowedScope, forbiddenScope, escalationConditions: ['scope expansion'] })
    const code = await service.createTask(project.id, { title: 'Scoped code', kind: 'code', description: 'Implement.', acceptanceCriteria: ['done'], agentId: agent.id, assignmentPolicy: policy(['src']), testCommand: 'test -f README.md' })
    await service.createTask(project.id, { title: 'Scoped test', kind: 'test', description: 'Verify.', acceptanceCriteria: ['passes'], dependencies: [code.id], agentId: agent.id, assignmentPolicy: policy(['tests/**']), testCommand: 'test -f README.md' })
    await service.approveProject(project.id, 'tester')

    const run = await service.startExecution(project.id)
    assert.equal((await waitForRun(store, run.id)).status, 'completed')
    const taskRuns = [...store.taskRuns.records.values()].filter((taskRun) => taskRun.runId === run.id).sort((left, right) => left.createdAt.localeCompare(right.createdAt))
    assert.deepEqual(taskRuns.map((taskRun) => taskRun.changedFiles), [['src/feature.ts'], ['tests/feature.test.ts']])
    assert.equal([...store.decisions.records.values()].some((decision) => ['scope_expansion', 'verification_unavailable'].includes(decision.metadata?.escalationTrigger)), false)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('Project Task scope expansion fails before verification and creates one durable Decision', async () => {
  const root = await mkdtemp(join(tmpdir(), 'po-project-scope-bad-'))
  const repo = join(root, 'repo')
  const worktrees = join(root, 'worktrees')
  try {
    await mkdir(repo)
    await mkdir(worktrees)
    await mkdir(join(repo, 'src'))
    await execFileAsync('git', ['init'], { cwd: repo })
    await execFileAsync('git', ['config', 'user.email', 'test@example.com'], { cwd: repo })
    await execFileAsync('git', ['config', 'user.name', 'Test'], { cwd: repo })
    await writeFile(join(repo, 'README.md'), 'scope fixture\n')
    await writeFile(join(repo, 'src', '.gitkeep'), '')
    await execFileAsync('git', ['add', '.'], { cwd: repo })
    await execFileAsync('git', ['commit', '-m', 'test: initialize scope fixture'], { cwd: repo })
    const store = memoryStore()
    const observation = { onAgentCreate: async (options) => writeFile(join(options.meta.cwd, 'outside.txt'), 'not approved\n') }
    const service = new OrchestratorService(agentContext('Changed an unapproved file.', observation), store)
    const runtime = await service.createRuntime({ name: 'Scope Runtime', machineId: `scope-bad-${Date.now()}`, capabilities: ['agent', 'worktree'], workspaceRoot: worktrees })
    const agent = await service.createAgent({ name: 'Scope Agent', role: 'Engineer', persona: 'Execute.', runtimeId: runtime.id })
    const project = await service.createProject({ name: 'Scope violation', cwd: repo, prd: 'Stay in src.', technicalDesign: 'Stop on expansion.' })
    await service.addProjectAgent(project.id, { agentId: agent.id, projectRole: 'Engineer', autoAssignable: true })
    await service.createProjectResource(project.id, { kind: 'local_directory', location: repo, executionMode: 'worktree', runtimeId: runtime.id })
    const policy = { mode: 'single_agent', riskLevel: 'low', requiredRoles: [], requiredCapabilities: [], allowedAgentIds: [], allowedSquadIds: [], requiresIndependentReviewer: false, maxParallel: 1, conflictKeys: [], allowedScope: ['src'], forbiddenScope: [], escalationConditions: ['scope expansion'] }
    const code = await service.createTask(project.id, { title: 'Bounded code', kind: 'code', description: 'Implement.', acceptanceCriteria: ['done'], agentId: agent.id, assignmentPolicy: policy, testCommand: 'touch verification-command-ran' })
    await service.createTask(project.id, { title: 'Independent test', kind: 'test', description: 'Verify.', acceptanceCriteria: ['passes'], dependencies: [code.id], agentId: agent.id, testCommand: 'true' })
    await service.approveProject(project.id, 'tester')

    const run = await service.startExecution(project.id)
    assert.equal((await waitForRun(store, run.id)).status, 'failed')
    const taskRun = [...store.taskRuns.records.values()].find((candidate) => candidate.runId === run.id)
    assert.equal(taskRun.status, 'failed')
    assert.equal(taskRun.errorCode, 'scope_violation')
    assert.equal(taskRun.testExitCode, undefined)
    assert.equal(await stat(join(taskRun.workspace, 'verification-command-ran')).then(() => true, () => false), false)
    const decisions = [...store.decisions.records.values()].filter((decision) => decision.taskRunId === taskRun.id && decision.metadata?.escalationTrigger === 'scope_expansion')
    assert.equal(decisions.length, 1)
    assert.deepEqual(decisions[0].metadata.outsideAllowedScope, ['outside.txt'])
    assert.ok(service.snapshot().inbox.some((item) => item.decisionId === decisions[0].id))
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('Project Task forbidden scope takes precedence over an allowed parent path', async () => {
  const root = await mkdtemp(join(tmpdir(), 'po-project-scope-forbidden-'))
  const repo = join(root, 'repo')
  const worktrees = join(root, 'worktrees')
  try {
    await mkdir(repo)
    await mkdir(worktrees)
    await mkdir(join(repo, 'src'))
    await execFileAsync('git', ['init'], { cwd: repo })
    await execFileAsync('git', ['config', 'user.email', 'test@example.com'], { cwd: repo })
    await execFileAsync('git', ['config', 'user.name', 'Test'], { cwd: repo })
    await writeFile(join(repo, 'README.md'), 'scope fixture\n')
    await writeFile(join(repo, 'src', '.gitkeep'), '')
    await execFileAsync('git', ['add', '.'], { cwd: repo })
    await execFileAsync('git', ['commit', '-m', 'test: initialize scope fixture'], { cwd: repo })
    const store = memoryStore()
    const service = new OrchestratorService(agentContext('Touched a forbidden path.', { onAgentCreate: async (options) => writeFile(join(options.meta.cwd, 'src/secret.ts'), 'forbidden\n') }), store)
    const runtime = await service.createRuntime({ name: 'Scope Runtime', machineId: `scope-forbidden-${Date.now()}`, capabilities: ['agent', 'worktree'], workspaceRoot: worktrees })
    const agent = await service.createAgent({ name: 'Scope Agent', role: 'Engineer', persona: 'Execute.', runtimeId: runtime.id })
    const project = await service.createProject({ name: 'Forbidden scope', cwd: repo, prd: 'Do not touch secret.', technicalDesign: 'Enforce forbidden path.' })
    await service.addProjectAgent(project.id, { agentId: agent.id, projectRole: 'Engineer', autoAssignable: true })
    await service.createProjectResource(project.id, { kind: 'local_directory', location: repo, executionMode: 'worktree', runtimeId: runtime.id })
    const policy = { mode: 'single_agent', riskLevel: 'low', requiredRoles: [], requiredCapabilities: [], allowedAgentIds: [], allowedSquadIds: [], requiresIndependentReviewer: false, maxParallel: 1, conflictKeys: [], allowedScope: ['src'], forbiddenScope: ['src/secret.ts'], escalationConditions: ['scope expansion'] }
    const code = await service.createTask(project.id, { title: 'Bounded code', kind: 'code', description: 'Implement.', acceptanceCriteria: ['done'], agentId: agent.id, assignmentPolicy: policy, testCommand: 'true' })
    await service.createTask(project.id, { title: 'Independent test', kind: 'test', description: 'Verify.', acceptanceCriteria: ['passes'], dependencies: [code.id], agentId: agent.id, testCommand: 'true' })
    await service.approveProject(project.id, 'tester')

    const run = await service.startExecution(project.id)
    assert.equal((await waitForRun(store, run.id)).status, 'failed')
    const decision = [...store.decisions.records.values()].find((candidate) => candidate.metadata?.escalationTrigger === 'scope_expansion')
    assert.deepEqual(decision.metadata.outsideAllowedScope, [])
    assert.deepEqual(decision.metadata.forbiddenScopeMatches, ['src/secret.ts'])
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('Project Task with an enforced scope fails closed when Git evidence is unavailable', async () => {
  const root = await mkdtemp(join(tmpdir(), 'po-project-scope-no-git-'))
  try {
    const store = memoryStore()
    const observation = {}
    const service = new OrchestratorService(agentContext('Should not run.', observation), store)
    const agent = await service.createAgent({ name: 'Scope Agent', role: 'Engineer', persona: 'Execute.' })
    const project = await service.createProject({ name: 'No Git scope', cwd: root, prd: 'Enforce scope.', technicalDesign: 'Fail closed without evidence.' })
    await service.addProjectAgent(project.id, { agentId: agent.id, projectRole: 'Engineer', autoAssignable: true })
    const policy = { mode: 'single_agent', riskLevel: 'low', requiredRoles: [], requiredCapabilities: [], allowedAgentIds: [], allowedSquadIds: [], requiresIndependentReviewer: false, maxParallel: 1, conflictKeys: [], allowedScope: ['src'], forbiddenScope: [], escalationConditions: ['verification unavailable'] }
    const code = await service.createTask(project.id, { title: 'Scoped code', kind: 'code', description: 'Implement.', acceptanceCriteria: ['done'], agentId: agent.id, assignmentPolicy: policy, testCommand: 'true' })
    await service.createTask(project.id, { title: 'Independent test', kind: 'test', description: 'Verify.', acceptanceCriteria: ['passes'], dependencies: [code.id], agentId: agent.id, testCommand: 'true' })
    await service.approveProject(project.id, 'tester')

    const run = await service.startExecution(project.id)
    assert.equal((await waitForRun(store, run.id)).status, 'failed')
    assert.equal(observation.createCalls, undefined)
    const taskRun = [...store.taskRuns.records.values()].find((candidate) => candidate.runId === run.id)
    assert.equal(taskRun.errorCode, 'verification_unavailable')
    const decisions = [...store.decisions.records.values()].filter((decision) => decision.metadata?.escalationTrigger === 'verification_unavailable')
    assert.equal(decisions.length, 1)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('automatic Task repair exhaustion creates one durable retry Decision', async () => {
  const store = memoryStore()
  const service = new OrchestratorService(agentContext('Repair attempted.'), store)
  const project = await approvedProject(service, store, ['false', 'true'])
  const run = await service.startExecution(project.id)
  assert.equal((await waitForRun(store, run.id)).status, 'failed')
  const failedRuns = [...store.taskRuns.records.values()].filter((taskRun) => taskRun.runId === run.id && taskRun.errorCode === 'verification_failed')
  assert.equal(failedRuns.length, 2)
  const exhaustedRun = failedRuns.find((taskRun) => taskRun.attempt === 2)
  const decisions = [...store.decisions.records.values()].filter((decision) => decision.taskRunId === exhaustedRun.id && decision.metadata?.escalationTrigger === 'repeated_failure')
  assert.equal(decisions.length, 1)
  assert.equal(decisions[0].kind, 'retry')
  const inbox = service.snapshot().inbox.filter((item) => item.taskRunId === exhaustedRun.id)
  assert.equal(inbox.filter((item) => item.decisionId === decisions[0].id).length, 1)
  assert.equal(inbox.some((item) => item.kind === 'test_failed_after_retry'), false)
})

test('worktree TaskRun creates isolated branch, captures Git evidence, and cleans workspace', async () => {
  const root = await mkdtemp(join(tmpdir(), 'po-worktree-'))
  const repo = join(root, 'repo')
  const worktrees = join(root, 'worktrees')
  try {
    await import('node:fs/promises').then(async ({ mkdir }) => { await mkdir(repo); await mkdir(worktrees) })
    await execFileAsync('git', ['init'], { cwd: repo })
    await execFileAsync('git', ['config', 'user.email', 'test@example.com'], { cwd: repo })
    await execFileAsync('git', ['config', 'user.name', 'Test'], { cwd: repo })
    await writeFile(join(repo, 'README.md'), 'base\n')
    await execFileAsync('git', ['add', 'README.md'], { cwd: repo })
    await execFileAsync('git', ['commit', '-m', 'test: initialize worktree fixture'], { cwd: repo })

    const store = memoryStore()
    const service = new OrchestratorService(agentContext('Worktree execution completed.'), store)
    const runtime = await service.createRuntime({ name: 'Worktree Runtime', machineId: 'worktree-local', capabilities: ['agent', 'worktree'], workspaceRoot: worktrees })
    const agent = await service.createAgent({ name: 'Worktree Agent', role: 'Engineer', description: '', persona: 'Execute.', preset: 'standard', toolPolicy: 'full', runtimeId: runtime.id, access: 'workspace', maxConcurrency: 1 })
    const project = await service.createProject({ name: 'Worktree project', cwd: repo, prd: 'Isolate execution.', technicalDesign: 'Use a Git worktree.' })
    await service.addProjectAgent(project.id, { agentId: agent.id, projectRole: 'Engineer', autoAssignable: true, joinedBy: 'tester' })
    await service.createProjectResource(project.id, { kind: 'local_directory', location: repo, executionMode: 'worktree', runtimeId: runtime.id })
    const issue = await service.createIssue({ projectId: project.id, title: 'Isolated Issue', description: 'Run in worktree.' })
    const command = await service.executeCommand({ type: 'assign_issue', issueId: issue.id, actorType: 'human', payload: { assigneeType: 'agent', assigneeId: agent.id } })
    const run = await waitForTaskRun(store, command.result.taskRunId)
    assert.equal(run.status, 'completed')
    assert.match(run.branch, /^dsh\/taskrun\//)
    assert.equal(typeof run.baseCommit, 'string')
    assert.equal(typeof run.headCommit, 'string')
    assert.notEqual(run.workspace, repo)
    await assert.rejects(() => stat(run.workspace))
    assert.equal(store.workspaceLeases.get(`lease:${run.id}`).state, 'released')
    const branch = await execFileAsync('git', ['branch', '--list', run.branch], { cwd: repo })
    assert.match(branch.stdout, new RegExp(run.branch.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('Squad membership and Artifact context fail closed while valid records persist', async () => {
  const store = memoryStore()
  const service = new OrchestratorService({}, store)
  const leader = await service.createAgent({ name: 'Leader', role: 'Lead', description: '', persona: 'Lead.', preset: 'standard', toolPolicy: 'full' })
  const member = await service.createAgent({ name: 'Member', role: 'Engineer', description: '', persona: 'Build.', preset: 'standard', toolPolicy: 'full' })
  await assert.rejects(() => service.createSquad({ name: 'Invalid', description: '', leaderAgentId: leader.id, memberAgentIds: [member.id, member.id], instructions: 'Delegate safely.', escalationPolicy: 'Ask a human.' }), (error) => error.code === 'squad-min-members')
  const escalationConfig = { triggers: ['requirement_conflict', 'repeated_failure'], maxFocusedRepairAttempts: 2, onTrigger: 'request_decision', pauseParentIssue: true, cancelSiblingDelegations: false, customInstructions: 'Attach evidence before asking for a decision.' }
  const squad = await service.createSquad({ name: 'Delivery Squad', description: '', leaderAgentId: leader.id, memberAgentIds: [leader.id, member.id], memberRoles: { [leader.id]: 'Leader', [member.id]: 'Implementer' }, instructions: 'Delegate safely.', escalationPolicy: 'Ask a human.', escalationConfig, collaborationPolicyVersion: 'squad-collaboration-v1' })
  assert.equal(squad.status, 'active')
  assert.deepEqual(squad.escalationConfig, escalationConfig)
  assert.equal(squad.collaborationPolicyVersion, 'squad-collaboration-v1')
  const updatedSquad = await service.updateSquad(squad.id, { name: squad.name, description: squad.description, leaderAgentId: squad.leaderAgentId, memberAgentIds: squad.memberAgentIds, memberRoles: squad.memberRoles, instructions: squad.instructions, escalationPolicy: squad.escalationPolicy, escalationConfig: { ...escalationConfig, maxFocusedRepairAttempts: 3 }, collaborationPolicyVersion: 'squad-collaboration-v2', maxParallelDelegations: squad.maxParallelDelegations, expectedUpdatedAt: squad.updatedAt })
  assert.equal(updatedSquad.escalationConfig.maxFocusedRepairAttempts, 3)
  assert.equal(updatedSquad.collaborationPolicyVersion, 'squad-collaboration-v2')

  const project = await service.createProject({ name: 'Artifacts', summary: '', cwd: '/tmp', prd: 'Evidence', technicalDesign: 'Bounded evidence.' })
  const issue = await service.createIssue({ projectId: project.id, title: 'Evidence Issue', description: '' })
  const artifact = await service.attachArtifact({ projectId: project.id, issueId: issue.id, kind: 'pull_request', name: 'Review PR', uri: 'https://example.test/pr/1', metadata: { provider: 'test' } })
  assert.equal(store.artifacts.get(artifact.id).uri, 'https://example.test/pr/1')
  await assert.rejects(() => service.attachArtifact({ projectId: project.id, issueId: 'missing', kind: 'document', name: 'Bad', content: 'bad' }), (error) => error.code === 'artifact-context-mismatch')
})

test('Squad delegation creates a child run and approved review wakes the leader exactly once', async () => {
  const store = memoryStore()
  const service = new OrchestratorService({}, store)
  const leader = await service.createAgent({ name: 'Squad Leader', role: 'Lead', description: '', persona: 'Lead.', preset: 'standard', toolPolicy: 'full' })
  const member = await service.createAgent({ name: 'Squad Member', role: 'Engineer', description: '', persona: 'Build.', preset: 'standard', toolPolicy: 'full' })
  const squad = await service.createSquad({ name: 'Command Squad', leaderAgentId: leader.id, memberAgentIds: [leader.id, member.id], instructions: 'Delegate.', escalationPolicy: 'Escalate.' })
  const project = await service.createProject({ name: 'Delegation project', cwd: '/tmp', prd: 'Delegate work.', technicalDesign: 'Child Issue protocol.' })
  await service.addProjectAgents(project.id, { members: [{ agentId: leader.id, projectRole: 'Lead', autoAssignable: true }, { agentId: member.id, projectRole: 'Engineer', autoAssignable: true }], joinedBy: 'tester' })
  await service.bindProjectSquad(project.id, { squadId: squad.id, expectedProjectRevision: project.revision, expectedSquadUpdatedAt: squad.updatedAt })
  const parent = await service.createIssue({ projectId: project.id, title: 'Parent delivery', description: 'Coordinate.', assigneeType: 'squad', assigneeId: squad.id })
  const parentTask = await service.createTask(project.id, { title: 'Delegated parent task', kind: 'code', description: 'Track delegated acceptance.', acceptanceCriteria: ['Delegated child is reviewed.'], testCommand: 'true' })
  await store.tasks.put(parentTask.id, { ...parentTask, issueId: parent.id, acceptanceIds: ['delegation-acceptance'] })
  await store.acceptanceCriteria.put('delegation-acceptance', { id: 'delegation-acceptance', projectId: project.id, bundleId: 'delegation-bundle', key: 'delegation-review', statement: 'Delegated child is reviewed.', sourceRefs: [], taskIds: [parentTask.id], evidenceIds: [], status: 'open', createdAt: now, updatedAt: now })
  const assigned = await service.executeCommand({ type: 'assign_issue', issueId: parent.id, actorType: 'human', payload: { assigneeType: 'squad', assigneeId: squad.id } })
  const leaderRunId = assigned.result.taskRunId
  await store.taskRuns.put(leaderRunId, { ...store.taskRuns.get(leaderRunId), status: 'running', startedAt: now })
  const assignedParent = store.issues.get(parent.id)
  const contract = { objective: 'Implement delegated work.', scope: ['delegated module'], forbiddenScope: ['parent requirement decisions'], deliverables: ['Implementation and evidence'], acceptanceCriteria: ['Delegated behavior works'], verification: ['Run focused tests'], escalationConditions: ['Requirement conflict'] }
  await assert.rejects(() => service.executeCommand({ type: 'delegate_issue', issueId: parent.id, squadId: squad.id, actorType: 'agent', actorId: member.id, payload: { memberAgentId: member.id, title: 'Invalid actor', expectedAssignmentRevision: assignedParent.assignmentRevision, contract } }), (error) => error.code === 'leader-actor-mismatch')
  await assert.rejects(() => service.executeCommand({ type: 'delegate_issue', issueId: parent.id, squadId: squad.id, actorType: 'agent', actorId: leader.id, payload: { memberAgentId: member.id, title: 'Stale', expectedAssignmentRevision: assignedParent.assignmentRevision - 1, contract } }), (error) => error.code === 'issue-assignment-stale')
  const delegated = await service.executeCommand({ type: 'delegate_issue', issueId: parent.id, squadId: squad.id, actorType: 'agent', actorId: leader.id, payload: { memberAgentId: member.id, title: 'Child implementation', description: 'Implement delegated work.', expectedAssignmentRevision: assignedParent.assignmentRevision, contract } })
  const childId = delegated.result.childIssueId
  assert.equal(store.issues.get(childId).assigneeId, member.id)
  assert.equal(store.taskRuns.get(delegated.result.taskRunId).delegatedByTaskRunId, leaderRunId)
  assert.equal(store.delegations.get(delegated.result.delegationId).contract.objective, 'Implement delegated work.')
  assert.equal(store.delegations.get(delegated.result.delegationId).parentAssignmentRevision, assignedParent.assignmentRevision)
  assert.equal(store.taskRuns.get(leaderRunId).status, 'deferred')
  const child = { ...store.issues.get(childId), status: 'in_review', reviewStatus: 'pending', updatedAt: new Date().toISOString() }
  delete child.activeTaskRunId
  await store.issues.put(childId, child)
  await assert.rejects(() => service.executeCommand({ type: 'approve_review', issueId: childId, actorType: 'human', actorId: 'reviewer', payload: { note: 'No child evidence yet.' } }), (error) => error.code === 'delegation-evidence-missing')
  assert.equal(store.issues.get(childId).status, 'in_review')
  const childArtifact = await service.attachArtifact({ projectId: project.id, issueId: childId, taskRunId: delegated.result.taskRunId, kind: 'test_report', name: 'Delegated focused test', content: 'passed', metadata: { exitCode: 0 } })
  await service.executeCommand({ idempotencyKey: 'review-child-once', type: 'approve_review', issueId: childId, actorType: 'human', actorId: 'reviewer', payload: { note: 'Child verified.' } })
  const wakeRuns = [...store.taskRuns.records.values()].filter((run) => run.issueId === parent.id && run.trigger === 'retry')
  assert.equal(wakeRuns.length, 1)
  assert.equal([...store.delegations.records.values()][0].status, 'completed')
  const delegation = [...store.delegations.records.values()][0]
  assert.ok(delegation.evidenceIds.includes(childArtifact.id))
  assert.ok(delegation.evidenceIds.some((evidenceId) => evidenceId.startsWith(`${delegation.id}:review:`)))
  assert.deepEqual(store.acceptanceCriteria.get('delegation-acceptance').evidenceIds, delegation.evidenceIds.filter((evidenceId) => evidenceId.startsWith(`${delegation.id}:review:`)))
  assert.equal(store.acceptanceCriteria.get('delegation-acceptance').status, 'verified')
  await service.executeCommand({ idempotencyKey: 'review-child-once', type: 'approve_review', issueId: childId, actorType: 'human', actorId: 'reviewer', payload: { note: 'Child verified.' } })
  assert.equal([...store.taskRuns.records.values()].filter((run) => run.issueId === parent.id && run.trigger === 'retry').length, 1)
})

test('multi-child Delegation enforces capacity, survives partial failure and restart, and wakes Leader once after out-of-order Reviews', async () => {
  const store = memoryStore()
  let service = new OrchestratorService({}, store)
  const leader = await service.createAgent({ name: 'Parallel Leader', role: 'Lead', persona: 'Coordinate.', toolPolicy: 'full', maxConcurrency: 2 })
  const members = []
  for (const name of ['API Specialist', 'Data Specialist', 'Test Specialist']) members.push(await service.createAgent({ name, role: 'Specialist', persona: 'Deliver scoped evidence.', toolPolicy: 'full', maxConcurrency: 2 }))
  const squad = await service.createSquad({ name: 'Parallel Delivery Squad', leaderAgentId: leader.id, memberAgentIds: [leader.id, ...members.map((member) => member.id)], instructions: 'Delegate bounded child work.', escalationPolicy: 'Escalate conflicts.', maxParallelDelegations: 3 })
  const project = await service.createProject({ name: 'Parallel delegation project', cwd: '/tmp', prd: 'Coordinate three specialists.', technicalDesign: 'One Leader coordination epoch.' })
  await service.addProjectAgents(project.id, { members: [{ agentId: leader.id, projectRole: 'Lead' }, ...members.map((member) => ({ agentId: member.id, projectRole: member.role }))], joinedBy: 'tester' })
  await service.bindProjectSquad(project.id, { squadId: squad.id, expectedProjectRevision: project.revision, expectedSquadUpdatedAt: squad.updatedAt })
  const parent = await service.createIssue({ projectId: project.id, title: 'Parallel parent', description: 'Coordinate all child outcomes.', assigneeType: 'squad', assigneeId: squad.id })
  const parentTask = await service.createTask(project.id, { title: 'Parallel parent task', kind: 'code', description: 'Track all delegated evidence.', acceptanceCriteria: ['All delegated children are reviewed.'], testCommand: 'true' })
  await store.tasks.put(parentTask.id, { ...parentTask, issueId: parent.id, acceptanceIds: ['parallel-delegation-acceptance'] })
  await store.acceptanceCriteria.put('parallel-delegation-acceptance', { id: 'parallel-delegation-acceptance', projectId: project.id, bundleId: 'parallel-delegation-bundle', key: 'parallel-delegation-review', statement: 'All delegated children are reviewed.', sourceRefs: [], taskIds: [parentTask.id], evidenceIds: [], status: 'open', createdAt: now, updatedAt: now })
  const assigned = await service.executeCommand({ type: 'assign_issue', issueId: parent.id, actorType: 'human', payload: { assigneeType: 'squad', assigneeId: squad.id } })
  const leaderRunId = assigned.result.taskRunId
  await store.taskRuns.put(leaderRunId, { ...store.taskRuns.get(leaderRunId), status: 'running', startedAt: now })
  const assignmentRevision = store.issues.get(parent.id).assignmentRevision
  const contract = { objective: 'Deliver scoped child evidence.', scope: ['assigned child scope'], forbiddenScope: ['sibling scope'], deliverables: ['Implementation and evidence'], acceptanceCriteria: ['Scoped behavior works'], verification: ['Run focused verification'], escalationConditions: ['Cross-scope conflict'] }

  const commands = await Promise.all(members.map((member, index) => service.executeCommand({ idempotencyKey: `parallel-delegation-${index + 1}`, type: 'delegate_issue', issueId: parent.id, squadId: squad.id, actorType: 'agent', actorId: leader.id, payload: { memberAgentId: member.id, title: `Parallel child ${index + 1}`, expectedAssignmentRevision: assignmentRevision, contract } })))
  const delegations = commands.map((command) => store.delegations.get(command.result.delegationId))
  assert.equal(new Set(delegations.map((delegation) => delegation.coordinationTaskRunId)).size, 1)
  assert.equal(delegations[0].coordinationTaskRunId, leaderRunId)
  assert.equal(store.taskRuns.get(leaderRunId).status, 'deferred')
  assert.equal(store.issues.get(parent.id).status, 'blocked')
  await assert.rejects(() => service.executeCommand({ type: 'delegate_issue', issueId: parent.id, squadId: squad.id, actorType: 'agent', actorId: leader.id, payload: { memberAgentId: members[0].id, title: 'Capacity overflow', expectedAssignmentRevision: assignmentRevision, contract } }), (error) => error.code === 'squad-delegation-capacity')

  const prepareReview = async (delegation, label) => {
    const child = { ...store.issues.get(delegation.childIssueId), status: 'in_review', reviewStatus: 'pending', updatedAt: new Date().toISOString() }
    delete child.activeTaskRunId
    await store.issues.put(child.id, child)
    return service.attachArtifact({ projectId: project.id, issueId: child.id, taskRunId: delegation.taskRunId, kind: 'test_report', name: `${label} focused test`, content: 'passed', metadata: { exitCode: 0 } })
  }

  await prepareReview(delegations[2], 'third')
  await service.executeCommand({ type: 'approve_review', issueId: delegations[2].childIssueId, actorType: 'human', actorId: 'independent-reviewer', payload: { note: 'Third child reviewed first.' } })
  assert.equal(store.acceptanceCriteria.get('parallel-delegation-acceptance').status, 'open')
  assert.equal([...store.taskRuns.records.values()].filter((run) => run.issueId === parent.id && run.resumeDelegationId !== undefined).length, 0)

  await prepareReview(delegations[0], 'first-failed')
  await service.executeCommand({ type: 'reject_review', issueId: delegations[0].childIssueId, actorType: 'human', actorId: 'independent-reviewer', payload: { note: 'First child needs a focused repair.' } })
  assert.equal(store.acceptanceCriteria.get('parallel-delegation-acceptance').status, 'failed')
  const failedRunId = store.delegations.get(delegations[0].id).taskRunId
  const retried = await service.executeCommand({ type: 'retry_delegation', projectId: project.id, actorType: 'human', actorId: 'delivery-owner', payload: { delegationId: delegations[0].id } })
  const retryRun = store.taskRuns.get(retried.result.taskRunId)
  assert.equal(retryRun.retryOf, failedRunId)
  assert.equal(retryRun.delegatedByTaskRunId, leaderRunId)
  assert.equal(store.acceptanceCriteria.get('parallel-delegation-acceptance').status, 'open')

  const retriedDelegation = store.delegations.get(delegations[0].id)
  await prepareReview(retriedDelegation, 'first-retry')
  await service.executeCommand({ type: 'approve_review', issueId: retriedDelegation.childIssueId, actorType: 'human', actorId: 'independent-reviewer', payload: { note: 'Focused repair verified.' } })
  assert.equal([...store.taskRuns.records.values()].filter((run) => run.issueId === parent.id && run.resumeDelegationId !== undefined).length, 0)

  service = new OrchestratorService({}, store)
  await service.initialize()
  const second = store.delegations.get(delegations[1].id)
  await prepareReview(second, 'second-last')
  const executeBeforeCrash = service.executeCommand.bind(service)
  service.executeCommand = async (input) => {
    if (input.idempotencyKey?.startsWith('leader-wakeup:')) throw new Error('simulated Host crash before Leader wakeup')
    return executeBeforeCrash(input)
  }
  await assert.rejects(() => service.executeCommand({ idempotencyKey: 'parallel-last-review', type: 'approve_review', issueId: second.childIssueId, actorType: 'human', actorId: 'independent-reviewer', payload: { note: 'Second child reviewed last after restart.' } }), /simulated Host crash/)
  assert.equal(store.delegations.get(second.id).status, 'waiting_leader')
  assert.equal(store.issues.get(parent.id).status, 'blocked')
  service = new OrchestratorService({}, store)
  await service.initialize()
  await service.initialize()

  const finalGroup = delegations.map((delegation) => store.delegations.get(delegation.id))
  const wakeRuns = [...store.taskRuns.records.values()].filter((run) => run.issueId === parent.id && run.resumeDelegationId !== undefined)
  const wakeActivities = [...store.activity.records.values()].filter((activity) => activity.type === 'squad.leader_woken' && activity.issueId === parent.id)
  assert.deepEqual(finalGroup.map((delegation) => delegation.status), ['completed', 'completed', 'completed'])
  assert.equal(wakeRuns.length, 1)
  assert.equal(wakeActivities.length, 1)
  assert.equal(store.acceptanceCriteria.get('parallel-delegation-acceptance').status, 'verified')
  const reviewEvidenceIds = finalGroup.flatMap((delegation) => delegation.evidenceIds ?? []).filter((id) => id.includes(':review:'))
  assert.equal(reviewEvidenceIds.length, 4)
  assert.deepEqual(new Set(store.acceptanceCriteria.get('parallel-delegation-acceptance').evidenceIds), new Set(reviewEvidenceIds))
})

test('stale delegated child Review cannot publish evidence or wake a reassigned or terminal parent', async () => {
  const store = memoryStore()
  const service = new OrchestratorService({}, store)
  const leader = await service.createAgent({ name: 'Stale Leader', role: 'Lead', persona: 'Lead.', toolPolicy: 'full' })
  const member = await service.createAgent({ name: 'Stale Member', role: 'Engineer', persona: 'Build.', toolPolicy: 'full' })
  const squad = await service.createSquad({ name: 'Stale Callback Squad', leaderAgentId: leader.id, memberAgentIds: [leader.id, member.id], instructions: 'Delegate.', escalationPolicy: 'Escalate.' })
  const project = await service.createProject({ name: 'Stale callback project', cwd: '/tmp', prd: 'Protect owner state.', technicalDesign: 'Use assignment tokens.' })
  await service.addProjectAgents(project.id, { members: [{ agentId: leader.id, projectRole: 'Lead' }, { agentId: member.id, projectRole: 'Engineer' }] })
  await service.bindProjectSquad(project.id, { squadId: squad.id, expectedProjectRevision: project.revision, expectedSquadUpdatedAt: squad.updatedAt })
  const parent = await service.createIssue({ projectId: project.id, title: 'Parent', description: 'Coordinate.', assigneeType: 'squad', assigneeId: squad.id })
  const assigned = await service.executeCommand({ type: 'assign_issue', issueId: parent.id, actorType: 'human', payload: { assigneeType: 'squad', assigneeId: squad.id } })
  await store.taskRuns.put(assigned.result.taskRunId, { ...store.taskRuns.get(assigned.result.taskRunId), status: 'running', startedAt: now })
  const assignedParent = store.issues.get(parent.id)
  const delegated = await service.executeCommand({ type: 'delegate_issue', issueId: parent.id, squadId: squad.id, actorType: 'agent', actorId: leader.id, payload: { memberAgentId: member.id, title: 'Child', expectedAssignmentRevision: assignedParent.assignmentRevision, contract: { objective: 'Implement.', scope: ['child'], forbiddenScope: [], deliverables: ['evidence'], acceptanceCriteria: ['works'], verification: ['focused test'], escalationConditions: ['conflict'] } } })
  const child = { ...store.issues.get(delegated.result.childIssueId), status: 'in_review', reviewStatus: 'pending', updatedAt: now }
  delete child.activeTaskRunId
  await store.issues.put(child.id, child)
  await service.attachArtifact({ projectId: project.id, issueId: child.id, taskRunId: delegated.result.taskRunId, kind: 'test_report', name: 'Focused test', content: 'passed' })

  const blockedParent = store.issues.get(parent.id)
  await store.issues.put(parent.id, { ...blockedParent, assignmentRevision: blockedParent.assignmentRevision + 2 })
  await assert.rejects(() => service.executeCommand({ type: 'approve_review', issueId: child.id, actorType: 'human', actorId: 'reviewer', payload: { note: 'Late result.' } }), (error) => error.code === 'delegation-owner-stale')
  assert.equal(store.issues.get(child.id).status, 'in_review')
  assert.equal(store.delegations.get(delegated.result.delegationId).status, 'running')
  assert.equal([...store.verificationEvidence.records.values()].length, 0)
  assert.equal([...store.taskRuns.records.values()].filter((run) => run.issueId === parent.id && run.resumeDelegationId === delegated.result.delegationId).length, 0)

  await store.issues.put(parent.id, { ...blockedParent, status: 'done' })
  await assert.rejects(() => service.executeCommand({ type: 'approve_review', issueId: child.id, actorType: 'human', actorId: 'reviewer', payload: { note: 'Result after parent completion.' } }), (error) => error.code === 'delegation-owner-stale')
  assert.equal(store.issues.get(parent.id).status, 'done')
})

test('request_decision atomically defers an active run and resumes exactly once after resolution', async () => {
  const store = memoryStore()
  const service = new OrchestratorService({}, store)
  const agent = await service.createAgent({ name: 'Decision Agent', role: 'Lead', description: '', persona: 'Lead safely.', preset: 'standard', toolPolicy: 'full' })
  const project = await service.createProject({ name: 'Decision project', cwd: '/tmp', prd: 'Decide safely.', technicalDesign: 'Use durable Decisions.' })
  await service.addProjectAgent(project.id, { agentId: agent.id, projectRole: 'Lead', autoAssignable: true, joinedBy: 'tester' })
  const issue = await service.createIssue({ projectId: project.id, title: 'Risky work', description: 'Requires a decision.' })
  const assigned = await service.executeCommand({ type: 'assign_issue', issueId: issue.id, actorType: 'human', payload: { assigneeType: 'agent', assigneeId: agent.id } })
  const runId = assigned.result.taskRunId
  await store.taskRuns.put(runId, { ...store.taskRuns.get(runId), status: 'running', startedAt: now })
  const activeIssue = store.issues.get(issue.id)
  const requested = await service.executeCommand({ idempotencyKey: 'decision-once', type: 'request_decision', projectId: project.id, issueId: issue.id, actorType: 'agent', actorId: agent.id, payload: { title: 'Choose safe option', prompt: 'Which compatible option should be used?', expectedAssignmentRevision: activeIssue.assignmentRevision, facts: ['Current contract conflicts'], missingEvidence: ['Owner choice'], options: [{ id: 'a', description: 'Option A', impact: 'Preserves compatibility' }] } })
  const decisionId = requested.result.decisionId
  assert.equal(store.decisions.get(decisionId).status, 'pending')
  assert.equal(store.issues.get(issue.id).status, 'blocked')
  assert.equal(store.issues.get(issue.id).activeTaskRunId, undefined)
  assert.equal(store.taskRuns.get(runId).status, 'deferred')
  assert.equal(store.taskRuns.get(runId).finishedReason, 'decision_requested')

  await service.resolveDecision(decisionId, { status: 'approved', resolution: 'Use option A.', resolvedBy: 'reviewer' })
  const continuation = [...store.taskRuns.records.values()].find((run) => run.resumeDecisionId === decisionId)
  assert.ok(continuation)
  assert.equal(store.issues.get(issue.id).activeTaskRunId, continuation.id)
  await assert.rejects(() => service.resolveDecision(decisionId, { status: 'approved', resolution: 'Repeat.', resolvedBy: 'reviewer' }), (error) => error.code === 'decision-already-resolved')
  assert.equal([...store.taskRuns.records.values()].filter((run) => run.resumeDecisionId === decisionId).length, 1)
})

test('a failed Delegation retries through the child Issue and preserves the Delegation owner chain', async () => {
  const store = memoryStore()
  const service = new OrchestratorService({}, store)
  const member = await service.createAgent({ name: 'Retry Member', role: 'Engineer', persona: 'Repair delegated work.', toolPolicy: 'full' })
  const project = await service.createProject({ name: 'Delegation retry', cwd: '/tmp', prd: 'Retry failed child work.', technicalDesign: 'Preserve ownership.' })
  await service.addProjectAgent(project.id, { agentId: member.id, projectRole: 'Engineer', autoAssignable: true })
  const parent = await service.createIssue({ projectId: project.id, title: 'Parent', description: 'Coordinate the child.' })
  const child = await service.createIssue({ projectId: project.id, parentIssueId: parent.id, title: 'Child', description: 'Repair the failure.', assigneeType: 'agent', assigneeId: member.id })
  await store.issues.put(child.id, { ...child, status: 'blocked', updatedAt: now })
  await store.taskRuns.put('failed-child-run', { id: 'failed-child-run', projectId: project.id, issueId: child.id, agentId: member.id, status: 'failed', trigger: 'assignment', attempt: 1, assignmentRevision: child.assignmentRevision, cwd: project.cwd, error: 'Focused verification failed.', createdAt: now, completedAt: now })
  const delegation = { id: 'failed-delegation', squadId: 'squad-1', projectId: project.id, parentIssueId: parent.id, childIssueId: child.id, leaderAgentId: 'leader-1', memberAgentId: member.id, taskRunId: 'failed-child-run', status: 'failed', instruction: 'Repair delegated work.', error: 'Focused verification failed.', createdAt: now, updatedAt: now, completedAt: now }
  await store.delegations.put(delegation.id, delegation)

  const retried = await service.executeCommand({ type: 'retry_delegation', projectId: project.id, actorType: 'human', actorId: 'delivery-owner', payload: { delegationId: delegation.id } })
  const retryRun = store.taskRuns.get(retried.result.taskRunId)
  assert.equal(store.delegations.get(delegation.id).status, 'running')
  assert.equal(store.delegations.get(delegation.id).taskRunId, retryRun.id)
  assert.equal(retryRun.retryOf, delegation.taskRunId)
  assert.equal(retryRun.delegatedByTaskRunId, delegation.taskRunId)
  assert.equal(store.issues.get(child.id).activeTaskRunId, retryRun.id)
})

test('command idempotency keys reject different request payloads', async () => {
  const store = memoryStore()
  const service = new OrchestratorService({}, store)
  const first = await service.executeCommand({ idempotencyKey: 'digest-key', type: 'autopilot_tick', actorType: 'system', payload: { agentId: 'missing', limit: 1 } }).catch((error) => error)
  assert.equal(first.code, 'agent-not-found')
  const stored = [...store.commands.records.values()][0]
  assert.equal(stored.requestDigest.length, 64)
  await assert.rejects(() => service.executeCommand({ idempotencyKey: 'digest-key', type: 'autopilot_tick', actorType: 'system', payload: { agentId: 'missing', limit: 2 } }), (error) => error.code === 'command-idempotency-conflict')
})

test('external trigger keys reject different command payloads', async () => {
  const store = memoryStore()
  const service = new OrchestratorService({}, store)
  const input = { source: 'test-hook', externalKey: 'event-1', command: { type: 'autopilot_tick', actorType: 'system', payload: { agentId: 'missing', limit: 1 } } }
  await assert.rejects(() => service.receiveExternalTrigger(input), (error) => error.code === 'agent-not-found')
  await assert.rejects(() => service.receiveExternalTrigger({ ...input, command: { ...input.command, payload: { agentId: 'missing', limit: 2 } } }), (error) => error.code === 'external-trigger-conflict')
})

test('concurrent first Command and External Trigger requests share one reservation owner', async () => {
  const store = memoryStore()
  const service = new OrchestratorService({}, store)
  const commandInput = { idempotencyKey: 'concurrent-command', type: 'autopilot_tick', actorType: 'system', payload: { agentId: 'missing', limit: 1 } }
  const commandResults = await Promise.allSettled([service.executeCommand(commandInput), service.executeCommand(commandInput)])
  assert.deepEqual(commandResults.map((result) => result.status), ['rejected', 'rejected'])
  assert.equal(commandResults[0].reason.code, 'agent-not-found')
  assert.equal(commandResults[1].reason.code, 'agent-not-found')
  assert.equal([...store.commands.records.values()].filter((command) => command.idempotencyKey === commandInput.idempotencyKey).length, 1)

  const triggerInput = { source: 'concurrent-hook', externalKey: 'event-1', command: { type: 'autopilot_tick', actorType: 'system', payload: { agentId: 'missing', limit: 1 } } }
  const triggerResults = await Promise.allSettled([service.receiveExternalTrigger(triggerInput), service.receiveExternalTrigger(triggerInput)])
  assert.deepEqual(triggerResults.map((result) => result.status), ['rejected', 'rejected'])
  assert.equal(triggerResults[0].reason.code, 'agent-not-found')
  assert.equal(triggerResults[1].reason.code, 'agent-not-found')
  assert.equal([...store.externalTriggers.records.values()].filter((trigger) => trigger.externalKey === 'event-1').length, 1)
})

test('legacy Command records without a digest fail closed during replay', async () => {
  const store = memoryStore()
  const service = new OrchestratorService({}, store)
  await store.commands.put('legacy-command', { id: 'legacy-command', idempotencyKey: 'legacy-key', type: 'autopilot_tick', status: 'failed', actorType: 'system', payload: {}, createdAt: now })
  await assert.rejects(() => service.executeCommand({ idempotencyKey: 'legacy-key', type: 'autopilot_tick', actorType: 'system', payload: {} }), (error) => error.code === 'command-idempotency-recovery-required')
})

test('Autopilot and external triggers are bounded and idempotent through unified commands', async () => {
  const store = memoryStore()
  const service = new OrchestratorService({}, store)
  const agent = await service.createAgent({ name: 'Autopilot Agent', role: 'Engineer', description: '', persona: 'Build.', preset: 'standard', toolPolicy: 'full' })
  const project = await service.createProject({ name: 'Autopilot project', cwd: '/tmp', prd: 'Automate.', technicalDesign: 'Bounded command tick.' })
  await service.addProjectAgent(project.id, { agentId: agent.id, projectRole: 'Engineer', autoAssignable: true, joinedBy: 'tester' })
  const issues = []
  for (let index = 0; index < 3; index += 1) issues.push(await service.createIssue({ projectId: project.id, title: `Auto ${index}`, description: '' }))
  const tick = await service.executeCommand({ idempotencyKey: 'autopilot-once', type: 'autopilot_tick', projectId: project.id, actorType: 'system', payload: { agentId: agent.id, limit: 2 } })
  assert.equal(tick.result.assigned, 2)
  assert.equal([...store.taskRuns.records.values()].length, 2)
  await service.executeCommand({ idempotencyKey: 'autopilot-once', type: 'autopilot_tick', projectId: project.id, actorType: 'system', payload: { agentId: agent.id, limit: 2 } })
  assert.equal([...store.taskRuns.records.values()].length, 2)
  const triggerInput = { source: 'test-webhook', externalKey: 'event-1', command: { type: 'assign_issue', projectId: project.id, issueId: issues[2].id, actorType: 'system', payload: { assigneeType: 'agent', assigneeId: agent.id } } }
  const first = await service.receiveExternalTrigger(triggerInput)
  const replay = await service.receiveExternalTrigger(triggerInput)
  assert.equal(replay.id, first.id)
  assert.equal([...store.taskRuns.records.values()].length, 3)
  assert.equal(service.snapshot().skills.some((skill) => skill.name === 'missing'), false)
  assert.equal(service.snapshot().runStatistics.every((stat) => stat.usageKnown === false), true)
})

test('Runtime lifecycle and legacy Squad records preserve compatible read contracts', () => {
  const legacyRuntime = RuntimeRecordSchema.parse({ id: 'runtime', name: 'Legacy', machineId: 'machine', status: 'offline', capabilities: [], lastHeartbeatAt: now, createdAt: now, updatedAt: now })
  assert.equal(legacyRuntime.lifecycle, 'active')
  assert.throws(() => RuntimeRecordSchema.parse({ ...legacyRuntime, lifecycle: 'archived' }))
  const legacySquad = SquadRecordSchema.parse({ id: 'squad', name: 'Legacy one-member Squad', description: '', leaderAgentId: 'agent', memberAgentIds: ['agent'], instructions: 'Legacy instructions.', escalationPolicy: 'Escalate.', status: 'active', createdAt: now, updatedAt: now })
  assert.deepEqual(legacySquad.memberAgentIds, ['agent'])
})

test('Runtime management validates roots, uniqueness, lifecycle, history, and name snapshots', async () => {
  const root = await mkdtemp(join(tmpdir(), 'po-runtime-'))
  const workspaceRoot = join(root, 'worktrees')
  const linkedRoot = join(root, 'linked')
  await mkdir(workspaceRoot)
  await symlink(workspaceRoot, linkedRoot)
  try {
    const store = memoryStore()
    const service = new OrchestratorService({}, store)
    await assert.rejects(() => service.createRuntime({ name: 'Bad', machineId: 'bad', capabilities: [], workspaceRoot: linkedRoot }), (error) => error.code === 'runtime-workspace-root-invalid')
    const runtime = await service.createRuntime({ name: 'Local A', machineId: 'machine-a', capabilities: ['agent'], workspaceRoot })
    await assert.rejects(() => service.createRuntime({ name: 'Duplicate', machineId: 'machine-a', capabilities: [] }), (error) => error.code === 'runtime-machine-id-conflict')
    const agent = await service.createAgent({ name: 'Bound', role: 'Engineer', description: '', persona: 'Work.', preset: 'standard', toolPolicy: 'full', runtimeId: runtime.id })
    const renamed = await service.updateRuntime(runtime.id, { name: 'Local A renamed', expectedUpdatedAt: runtime.updatedAt })
    await assert.rejects(() => service.updateRuntime(runtime.id, { machineId: 'machine-b', expectedUpdatedAt: renamed.updatedAt }), (error) => error.code === 'runtime-config-in-use')
    await assert.rejects(() => service.archiveRuntime(runtime.id, { expectedUpdatedAt: renamed.updatedAt }), (error) => error.code === 'runtime-active-bindings')
    await service.bindAgentRuntime(agent.id, { runtimeId: null, expectedTargetUpdatedAt: agent.updatedAt, expectedProjectRevisions: {}, acknowledgeApprovalInvalidation: false })
    const archived = await service.archiveRuntime(runtime.id, { expectedUpdatedAt: renamed.updatedAt })
    assert.equal(archived.lifecycle, 'archived')
    await assert.rejects(() => service.heartbeatRuntime(runtime.id), (error) => error.code === 'runtime-archived')
    await assert.rejects(() => service.deleteRuntime(runtime.id), (error) => error.code === 'runtime-in-use')
    const disposable = await service.createRuntime({ name: 'Disposable', machineId: 'disposable-machine', capabilities: [] })
    const disposableArchive = await service.archiveRuntime(disposable.id, { expectedUpdatedAt: disposable.updatedAt })
    await service.deleteRuntime(disposableArchive.id)
    assert.equal(store.runtimes.get(disposable.id), undefined)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('Issue assignment resolves Agent and Resource Runtime bindings before capturing immutable evidence', async () => {
  const cwd = await mkdtemp(join(tmpdir(), 'po-runtime-resolution-'))
  const store = memoryStore()
  const service = new OrchestratorService({}, store)
  const first = await service.createRuntime({ name: 'First Runtime', machineId: 'first-machine', capabilities: ['agent'] })
  const second = await service.createRuntime({ name: 'Second Runtime', machineId: 'second-machine', capabilities: ['agent'] })
  const agent = await service.createAgent({ name: 'Runner', role: 'Engineer', description: '', persona: 'Run.', preset: 'standard', toolPolicy: 'full', runtimeId: first.id })
  const project = await service.createProject({ name: 'Runtime resolution', cwd, prd: 'Resolve.', technicalDesign: 'Capture evidence.' })
  await service.addProjectAgent(project.id, { agentId: agent.id, joinedBy: 'tester' })
  const resource = await service.createProjectResource(project.id, { kind: 'local_directory', location: cwd, executionMode: 'in_place', runtimeId: second.id })
  const issue = await service.createIssue({ projectId: project.id, title: 'Mismatch', description: '' })
  await assert.rejects(() => service.executeCommand({ type: 'assign_issue', issueId: issue.id, actorType: 'human', payload: { assigneeType: 'agent', assigneeId: agent.id, resourceId: resource.id } }), (error) => error.code === 'runtime-binding-context-mismatch')
  assert.equal([...store.taskRuns.records.values()].length, 0)
  const aligned = await service.bindResourceRuntime(resource.id, { runtimeId: first.id, expectedTargetUpdatedAt: resource.updatedAt })
  const assigned = await service.executeCommand({ type: 'assign_issue', issueId: issue.id, actorType: 'human', payload: { assigneeType: 'agent', assigneeId: agent.id, resourceId: aligned.id } })
  const run = store.taskRuns.get(assigned.result.taskRunId)
  assert.equal(run.runtimeId, first.id)
  assert.equal(run.runtimeNameSnapshot, 'First Runtime')
  const renamed = await service.updateRuntime(first.id, { name: 'Renamed Runtime', expectedUpdatedAt: first.updatedAt })
  assert.equal(renamed.name, 'Renamed Runtime')
  assert.equal(store.taskRuns.get(run.id).runtimeNameSnapshot, 'First Runtime')
  await rm(cwd, { recursive: true, force: true })
})

test('Project Squad bindings synchronize membership sources and unbind without deleting shared or referenced Agents', async () => {
  const store = memoryStore()
  const service = new OrchestratorService({}, store)
  const leader = await service.createAgent({ name: 'Binding Leader', role: 'Lead', description: '', persona: 'Lead.', preset: 'standard', toolPolicy: 'full' })
  const engineer = await service.createAgent({ name: 'Binding Engineer', role: 'Software Engineer', description: '', persona: 'Build.', preset: 'standard', toolPolicy: 'full' })
  const tester = await service.createAgent({ name: 'Binding Tester', role: 'Test Engineer', description: '', persona: 'Test.', preset: 'standard', toolPolicy: 'full' })
  const first = await service.createSquad({ name: 'Delivery Squad', leaderAgentId: leader.id, memberAgentIds: [leader.id, engineer.id], memberRoles: { [leader.id]: 'Leader', [engineer.id]: 'Software Engineer' }, instructions: 'Deliver.', escalationPolicy: 'Escalate.' })
  const second = await service.createSquad({ name: 'Quality Squad', leaderAgentId: leader.id, memberAgentIds: [leader.id, tester.id], memberRoles: { [leader.id]: 'Quality Lead', [tester.id]: 'Test Engineer' }, instructions: 'Verify.', escalationPolicy: 'Escalate.' })
  const project = await service.createProject({ name: 'Bound project', cwd: '/tmp', prd: 'Bind teams.', technicalDesign: 'Explicit binding.' })

  const firstBinding = await service.bindProjectSquad(project.id, { squadId: first.id, expectedProjectRevision: project.revision, expectedSquadUpdatedAt: first.updatedAt })
  assert.equal(firstBinding.isDefault, true)
  assert.equal(service.listProjectAgents(project.id).filter((item) => item.status === 'active').length, 2)
  assert.deepEqual(service.listProjectAgentMembershipSources(project.id).filter((item) => item.status === 'active').map((item) => item.sourceId).sort(), [first.id, first.id])
  assert.equal(service.listEligibleSquads(project.id).find((item) => item.squadId === first.id).eligible, true)
  assert.equal(service.listEligibleSquads(project.id).find((item) => item.squadId === second.id).reasons.includes('not_bound'), true)

  const secondBinding = await service.bindProjectSquad(project.id, { squadId: second.id, expectedProjectRevision: project.revision, expectedSquadUpdatedAt: second.updatedAt })
  assert.equal(secondBinding.isDefault, false)
  assert.equal(service.listProjectAgents(project.id).filter((item) => item.status === 'active').length, 3)
  assert.equal(service.listProjectAgentMembershipSources(project.id).filter((item) => item.agentId === leader.id && item.status === 'active').length, 2)

  const changedFirst = await service.updateSquad(first.id, { name: first.name, description: first.description, leaderAgentId: first.leaderAgentId, memberAgentIds: [leader.id, tester.id], memberRoles: { [leader.id]: 'Leader', [tester.id]: 'Release Tester' }, instructions: first.instructions, escalationPolicy: first.escalationPolicy, maxParallelDelegations: first.maxParallelDelegations, expectedUpdatedAt: first.updatedAt })
  assert.equal(service.listEligibleSquads(project.id).find((item) => item.squadId === first.id).reasons.includes('binding_needs_review'), true)
  const synced = await service.syncProjectSquadBinding(project.id, first.id, { expectedBindingUpdatedAt: firstBinding.updatedAt, expectedSquadUpdatedAt: changedFirst.updatedAt, syncRoles: true })
  assert.equal(synced.syncedSquadUpdatedAt, changedFirst.updatedAt)
  assert.equal(service.listProjectAgentMembershipSources(project.id).some((item) => item.agentId === engineer.id && item.sourceId === first.id && item.status === 'active'), false)
  assert.equal(service.listProjectAgents(project.id).find((item) => item.agentId === engineer.id).status, 'removed')

  const issue = await service.createIssue({ projectId: project.id, title: 'Squad-owned work', description: '', assigneeType: 'squad', assigneeId: first.id })
  await assert.rejects(() => service.unbindProjectSquad(project.id, first.id, { expectedBindingUpdatedAt: synced.updatedAt, replacementDefaultSquadId: second.id }), (error) => error.code === 'project-squad-in-use')
  await store.issues.put(issue.id, { ...store.issues.get(issue.id), status: 'done', updatedAt: now })
  const removed = await service.unbindProjectSquad(project.id, first.id, { expectedBindingUpdatedAt: synced.updatedAt, replacementDefaultSquadId: second.id })
  assert.equal(removed.status, 'removed')
  assert.equal(service.listProjectSquadBindings(project.id).find((item) => item.squadId === second.id).isDefault, true)
  assert.equal(service.listProjectAgents(project.id).find((item) => item.agentId === leader.id).status, 'active')
  assert.equal(service.listProjectAgents(project.id).find((item) => item.agentId === tester.id).status, 'active')
})

test('Project Squad binding requires concurrency tokens and preserves explicit manual role edits during synchronization', async () => {
  const store = memoryStore()
  const service = new OrchestratorService({}, store)
  const leader = await service.createAgent({ name: 'Concurrency Leader', role: 'Lead', description: '', persona: 'Lead.', preset: 'standard', toolPolicy: 'full' })
  const member = await service.createAgent({ name: 'Role Engineer', role: 'Software Engineer', description: '', persona: 'Build.', preset: 'standard', toolPolicy: 'full' })
  const squad = await service.createSquad({ name: 'Role Squad', leaderAgentId: leader.id, memberAgentIds: [leader.id, member.id], memberRoles: { [leader.id]: 'Leader', [member.id]: 'Squad Engineer' }, instructions: 'Deliver.', escalationPolicy: 'Escalate.' })
  const project = await service.createProject({ name: 'Role project', cwd: '/tmp', prd: 'Protect explicit roles.', technicalDesign: 'Source precedence.' })
  await assert.rejects(() => service.bindProjectSquad(project.id, { squadId: squad.id }), (error) => error.name === 'ZodError')
  assert.equal(service.listProjectSquadBindings(project.id).length, 0)

  const binding = await service.bindProjectSquad(project.id, { squadId: squad.id, expectedProjectRevision: project.revision, expectedSquadUpdatedAt: squad.updatedAt, syncRoles: true })
  const beforeEdit = service.listProjectAgents(project.id).find((item) => item.agentId === member.id)
  assert.equal(beforeEdit.projectRole, 'Squad Engineer')
  const edited = await service.updateProjectAgent(project.id, member.id, { projectRole: 'Project Specialist', autoAssignable: false, expectedMemberUpdatedAt: beforeEdit.updatedAt })
  assert.equal(service.listProjectAgentMembershipSources(project.id).some((item) => item.agentId === member.id && item.sourceType === 'manual' && item.status === 'active'), true)
  const changed = await service.updateSquad(squad.id, { name: squad.name, description: squad.description, leaderAgentId: squad.leaderAgentId, memberAgentIds: squad.memberAgentIds, memberRoles: { [leader.id]: 'Leader', [member.id]: 'Changed Squad Role' }, instructions: squad.instructions, escalationPolicy: squad.escalationPolicy, maxParallelDelegations: squad.maxParallelDelegations, expectedUpdatedAt: squad.updatedAt })
  await service.syncProjectSquadBinding(project.id, squad.id, { expectedBindingUpdatedAt: binding.updatedAt, expectedSquadUpdatedAt: changed.updatedAt, syncRoles: true })
  const afterSync = service.listProjectAgents(project.id).find((item) => item.agentId === member.id)
  assert.equal(afterSync.projectRole, edited.projectRole)
  assert.equal(afterSync.autoAssignable, false)
})

test('Squad dispatch fails closed for a missing member, a leader outside the Project, and a stale binding', async () => {
  const store = memoryStore()
  const service = new OrchestratorService({}, store)
  const leader = await service.createAgent({ name: 'Boundary Leader', role: 'Lead', persona: 'Lead.', toolPolicy: 'full' })
  const member = await service.createAgent({ name: 'Boundary Member', role: 'Engineer', persona: 'Build.', toolPolicy: 'full' })
  const squad = await service.createSquad({ name: 'Boundary Squad', leaderAgentId: leader.id, memberAgentIds: [leader.id, member.id], instructions: 'Deliver.', escalationPolicy: 'Escalate.' })
  const project = await service.createProject({ name: 'Boundary Project', cwd: '/tmp', prd: 'Validate ownership.', technicalDesign: 'Fail closed.' })
  await service.bindProjectSquad(project.id, { squadId: squad.id, expectedProjectRevision: project.revision, expectedSquadUpdatedAt: squad.updatedAt })
  const leaderMembership = store.projectAgentMemberships.get(`${project.id}:${leader.id}`)
  const memberMembership = store.projectAgentMemberships.get(`${project.id}:${member.id}`)

  await store.projectAgentMemberships.put(memberMembership.id, { ...memberMembership, status: 'removed', removedAt: now, updatedAt: now })
  let availability = service.listEligibleSquads(project.id).find((item) => item.squadId === squad.id)
  assert.ok(availability.reasons.includes('member_outside_project'))
  assert.ok(availability.missingAgentIds.includes(member.id))
  await assert.rejects(() => service.createIssue({ projectId: project.id, title: 'Missing member', assigneeType: 'squad', assigneeId: squad.id }), (error) => error.code === 'squad-member-outside-project')

  await store.projectAgentMemberships.put(memberMembership.id, memberMembership)
  await store.projectAgentMemberships.put(leaderMembership.id, { ...leaderMembership, status: 'removed', removedAt: now, updatedAt: now })
  availability = service.listEligibleSquads(project.id).find((item) => item.squadId === squad.id)
  assert.ok(availability.missingAgentIds.includes(leader.id))
  await assert.rejects(() => service.createIssue({ projectId: project.id, title: 'Leader outside', assigneeType: 'squad', assigneeId: squad.id }), (error) => error.code === 'squad-member-outside-project')

  await store.projectAgentMemberships.put(leaderMembership.id, leaderMembership)
  await service.updateSquad(squad.id, { name: squad.name, description: squad.description, leaderAgentId: squad.leaderAgentId, memberAgentIds: squad.memberAgentIds, memberRoles: squad.memberRoles, instructions: 'Updated collaboration policy.', escalationPolicy: squad.escalationPolicy, maxParallelDelegations: squad.maxParallelDelegations, expectedUpdatedAt: squad.updatedAt })
  availability = service.listEligibleSquads(project.id).find((item) => item.squadId === squad.id)
  assert.ok(availability.reasons.includes('binding_needs_review'))
  await assert.rejects(() => service.createIssue({ projectId: project.id, title: 'Stale binding', assigneeType: 'squad', assigneeId: squad.id }), (error) => error.code === 'project-squad-sync-required')
})

test('unbinding retains a referenced Agent with explicit retained-reference provenance', async () => {
  const store = memoryStore()
  const service = new OrchestratorService({}, store)
  const leader = await service.createAgent({ name: 'Reference Leader', role: 'Lead', description: '', persona: 'Lead.', preset: 'standard', toolPolicy: 'full' })
  const member = await service.createAgent({ name: 'Referenced Engineer', role: 'Software Engineer', description: '', persona: 'Build.', preset: 'standard', toolPolicy: 'full' })
  const squad = await service.createSquad({ name: 'Reference Squad', leaderAgentId: leader.id, memberAgentIds: [leader.id, member.id], instructions: 'Deliver.', escalationPolicy: 'Escalate.' })
  const project = await service.createProject({ name: 'Reference project', cwd: '/tmp', prd: 'Retain task owner.', technicalDesign: 'Explicit source.' })
  const binding = await service.bindProjectSquad(project.id, { squadId: squad.id, expectedProjectRevision: project.revision, expectedSquadUpdatedAt: squad.updatedAt })
  await service.createTask(project.id, { title: 'Owned task', kind: 'code', description: 'Keep the owner.', acceptanceCriteria: ['owner remains active'], dependencies: [], agentId: member.id, testCommand: 'true' })

  await service.unbindProjectSquad(project.id, squad.id, { expectedBindingUpdatedAt: binding.updatedAt })

  const retainedMembership = service.listProjectAgents(project.id).find((item) => item.agentId === member.id)
  assert.equal(retainedMembership.status, 'active')
  assert.equal(retainedMembership.autoAssignable, false)
  const sources = service.listProjectAgentMembershipSources(project.id).filter((item) => item.agentId === member.id)
  assert.equal(sources.find((item) => item.sourceType === 'squad').status, 'removed')
  assert.equal(sources.find((item) => item.sourceType === 'retained_reference').status, 'active')
})

test('Squad availability is unified across project membership, global capacity, and Runtime warnings', async () => {
  const store = memoryStore()
  const service = new OrchestratorService({}, store)
  const runtime = await service.createRuntime({ name: 'Leader Runtime', machineId: 'leader-machine', capabilities: ['agent'] })
  await service.heartbeatRuntime(runtime.id, 'offline')
  const leader = await service.createAgent({ name: 'Leader', role: 'Lead', description: '', persona: 'Lead.', preset: 'standard', toolPolicy: 'full', runtimeId: runtime.id })
  const member = await service.createAgent({ name: 'Member', role: 'Engineer', description: '', persona: 'Build.', preset: 'standard', toolPolicy: 'full' })
  const squad = await service.createSquad({ name: 'Bounded Squad', leaderAgentId: leader.id, memberAgentIds: [leader.id, member.id], instructions: 'Delegate.', escalationPolicy: 'Escalate.', maxParallelDelegations: 1 })
  const projectA = await service.createProject({ name: 'A', cwd: '/tmp', prd: 'A', technicalDesign: 'A' })
  const projectB = await service.createProject({ name: 'B', cwd: '/tmp', prd: 'B', technicalDesign: 'B' })
  for (const project of [projectA, projectB]) {
    await service.addProjectAgents(project.id, { members: [{ agentId: leader.id }, { agentId: member.id }], joinedBy: 'tester' })
    await service.bindProjectSquad(project.id, { squadId: squad.id, expectedProjectRevision: project.revision, expectedSquadUpdatedAt: squad.updatedAt })
  }
  let availability = service.listEligibleSquads(projectA.id)[0]
  assert.equal(availability.eligible, true)
  assert.equal(availability.dispatchReady, false)
  assert.deepEqual(availability.warnings, ['leader_runtime_offline'])
  await store.delegations.put('busy', { id: 'busy', squadId: squad.id, projectId: projectA.id, parentIssueId: 'parent', childIssueId: 'child', leaderAgentId: leader.id, memberAgentId: member.id, status: 'running', instruction: 'Busy', createdAt: now, updatedAt: now })
  availability = service.listEligibleSquads(projectB.id)[0]
  assert.equal(availability.eligible, false)
  assert.deepEqual(availability.reasons, ['capacity_exhausted'])
  assert.equal(availability.activeDelegations, 1)
})

test('Agent Runtime binding previews Project revisions, invalidates approval, and treats deferred as historical', async () => {
  const store = memoryStore()
  const service = new OrchestratorService({}, store)
  const runtime = await service.createRuntime({ name: 'Target', machineId: 'target-machine', capabilities: ['agent'] })
  const agent = await service.createAgent({ name: 'Plan Agent', role: 'Engineer', description: '', persona: 'Plan.', preset: 'standard', toolPolicy: 'full' })
  let project = await service.createProject({ name: 'Plan', cwd: '/tmp', prd: 'Plan', technicalDesign: 'Plan' })
  await service.addProjectAgent(project.id, { agentId: agent.id, joinedBy: 'tester' })
  await service.createTask(project.id, { title: 'Assigned', kind: 'code', description: 'Work', acceptanceCriteria: ['done'], dependencies: [], agentId: agent.id, testCommand: 'true' })
  project = store.projects.get(project.id)
  await store.projects.put(project.id, { ...project, status: 'approved', approvedRevision: project.revision })
  await assert.rejects(() => service.updateAgent(agent.id, { name: agent.name, role: agent.role, description: agent.description, persona: agent.persona, preset: agent.preset, toolPolicy: agent.toolPolicy, runtimeId: runtime.id }), (error) => error.code === 'runtime-binding-route-required')
  const impact = service.getAgentRuntimeImpact(agent.id, runtime.id)
  assert.equal(impact.affectedProjects[0].approvalWillInvalidate, true)
  const expectedProjectRevisions = { [project.id]: project.revision }
  await assert.rejects(() => service.bindAgentRuntime(agent.id, { runtimeId: runtime.id, expectedTargetUpdatedAt: agent.updatedAt, expectedProjectRevisions, acknowledgeApprovalInvalidation: false }), (error) => error.code === 'runtime-binding-approval-required')
  await store.taskRuns.put('deferred', { id: 'deferred', projectId: project.id, agentId: agent.id, runtimeNameSnapshot: '本机默认环境', status: 'deferred', trigger: 'assignment', attempt: 1, assignmentRevision: 1, cwd: '/tmp', createdAt: now, completedAt: now })
  const bound = await service.bindAgentRuntime(agent.id, { runtimeId: runtime.id, expectedTargetUpdatedAt: agent.updatedAt, expectedProjectRevisions, acknowledgeApprovalInvalidation: true })
  assert.equal(bound.runtimeId, runtime.id)
  const changedProject = store.projects.get(project.id)
  assert.equal(changedProject.status, 'awaiting_approval')
  assert.equal(changedProject.revision, project.revision + 1)

  const other = await service.createAgent({ name: 'Busy Agent', role: 'Engineer', description: '', persona: 'Busy.', preset: 'standard', toolPolicy: 'full' })
  for (const status of ['queued', 'waiting_local_directory', 'dispatched', 'running']) await store.taskRuns.put(`busy-${status}`, { id: `busy-${status}`, projectId: project.id, agentId: other.id, status, trigger: 'assignment', attempt: 1, assignmentRevision: 1, cwd: '/tmp', createdAt: now })
  const busyImpact = service.getAgentRuntimeImpact(other.id, runtime.id)
  assert.equal(busyImpact.executableTaskRunIds.length, 4)
  await assert.rejects(() => service.bindAgentRuntime(other.id, { runtimeId: runtime.id, expectedTargetUpdatedAt: other.updatedAt, expectedProjectRevisions: {}, acknowledgeApprovalInvalidation: false }), (error) => error.code === 'runtime-nonterminal-task-runs')
})

test('startup preserves a valid in-place Issue owner lock during dispatch recovery', async () => {
  const store = memoryStore()
  const service = new OrchestratorService({}, store)
  const project = await service.createProject({ name: 'Lock recovery', cwd: '/tmp', prd: 'Recover', technicalDesign: 'Recover' })
  const issue = await service.createIssue({ projectId: project.id, title: 'Owned Issue', description: '' })
  const agent = await service.createAgent({ name: 'Recovery agent', role: 'Engineer', description: '', persona: 'Recover.', preset: 'standard', toolPolicy: 'full' })
  const taskRun = { id: 'recovery-run', projectId: project.id, issueId: issue.id, agentId: agent.id, status: 'queued', trigger: 'assignment', attempt: 1, assignmentRevision: 1, cwd: '/tmp', createdAt: now }
  await store.taskRuns.put(taskRun.id, taskRun)
  await store.issues.put(issue.id, { ...issue, status: 'in_progress', assignmentRevision: 1, activeTaskRunId: taskRun.id })
  await store.localDirectoryLocks.put('/tmp', { id: '/tmp', canonicalPath: '/tmp', taskRunId: taskRun.id, projectId: project.id, acquiredAt: now, heartbeatAt: now })
  await store.workspaceLeases.put(`lease:${taskRun.id}`, { id: `lease:${taskRun.id}`, taskRunId: taskRun.id, projectId: project.id, mode: 'in_place', sourcePath: '/tmp', workspacePath: '/tmp', state: 'active', acquiredAt: now, heartbeatAt: now })

  await service.initialize()

  assert.ok(store.localDirectoryLocks.get('/tmp'))
  assert.equal(store.workspaceLeases.get(`lease:${taskRun.id}`).state, 'active')
  assert.equal(store.taskRuns.get(taskRun.id).status, 'queued')
})

test('host restart preserves valid TeamSnapshot, active Delegation, and owned child TaskRun', async () => {
  const store = memoryStore()
  const firstService = new OrchestratorService({}, store)
  const leader = await firstService.createAgent({ name: 'Restart Leader', role: 'Lead', persona: 'Coordinate.', toolPolicy: 'full' })
  const member = await firstService.createAgent({ name: 'Restart Member', role: 'Engineer', persona: 'Implement.', toolPolicy: 'full' })
  const squad = await firstService.createSquad({ name: 'Restart Squad', leaderAgentId: leader.id, memberAgentIds: [leader.id, member.id], instructions: 'Delegate.', escalationPolicy: 'Escalate.' })
  const project = await firstService.createProject({ name: 'Restart project', cwd: '/tmp', prd: 'Recover.', technicalDesign: 'Preserve durable owners.' })
  await firstService.addProjectAgents(project.id, { members: [{ agentId: leader.id, projectRole: 'Lead', autoAssignable: true }, { agentId: member.id, projectRole: 'Engineer', autoAssignable: true }] })
  await firstService.bindProjectSquad(project.id, { squadId: squad.id, expectedProjectRevision: project.revision, expectedSquadUpdatedAt: squad.updatedAt })
  const task = await firstService.createTask(project.id, { title: 'Durable task', kind: 'code', description: 'Track restart.', acceptanceCriteria: ['preserved'], agentId: leader.id, testCommand: 'true' })
  const team = firstService.getProjectTeamPlan(project.id).team
  const digest = 'd'.repeat(64)
  const planSnapshot = { id: `${project.id}:restart-plan`, projectId: project.id, revision: store.projects.get(project.id).revision, mode: 'initial', taskIds: [task.id], planHash: digest, teamComposition: team, teamDigest: team.teamDigest, assignmentDigest: digest, status: 'candidate', createdAt: now }
  await store.planSnapshots.put(planSnapshot.id, planSnapshot)
  await store.projects.put(project.id, { ...store.projects.get(project.id), currentPlanSnapshotId: planSnapshot.id, teamComposition: team, teamDigest: team.teamDigest })
  const parent = await firstService.createIssue({ projectId: project.id, title: 'Restart parent', assigneeType: 'squad', assigneeId: squad.id })
  const assigned = await firstService.executeCommand({ type: 'assign_issue', issueId: parent.id, actorType: 'human', payload: { assigneeType: 'squad', assigneeId: squad.id } })
  await store.taskRuns.put(assigned.result.taskRunId, { ...store.taskRuns.get(assigned.result.taskRunId), status: 'running', startedAt: now })
  const activeParent = store.issues.get(parent.id)
  const delegated = await firstService.executeCommand({ type: 'delegate_issue', projectId: project.id, issueId: parent.id, squadId: squad.id, actorType: 'agent', actorId: leader.id, payload: { memberAgentId: member.id, title: 'Restart child', expectedAssignmentRevision: activeParent.assignmentRevision, contract: { objective: 'Preserve child work.', scope: ['child'], forbiddenScope: [], deliverables: ['evidence'], acceptanceCriteria: ['preserved'], verification: ['focused test'], escalationConditions: ['state mismatch'] } } })

  const restartedService = new OrchestratorService({}, store)
  await restartedService.initialize()

  assert.equal(restartedService.listProjectPlanSnapshots(project.id).find((snapshot) => snapshot.id === planSnapshot.id)?.teamDigest, team.teamDigest)
  assert.equal(store.delegations.get(delegated.result.delegationId).status, 'running')
  assert.equal(store.taskRuns.get(delegated.result.taskRunId).status, 'queued')
  assert.equal(store.issues.get(delegated.result.childIssueId).activeTaskRunId, delegated.result.taskRunId)
})

test('startup reconciles pending Commands, orphan TaskRuns, and broken Issue pointers before dispatch', async () => {
  const store = memoryStore()
  const service = new OrchestratorService({}, store)
  const project = await service.createProject({ name: 'Recovery', cwd: '/tmp', prd: 'Recover', technicalDesign: 'Recover' })
  const issue = await service.createIssue({ projectId: project.id, title: 'Broken pointer', description: '' })
  await store.commands.put('pending', { id: 'pending', type: 'assign_issue', projectId: project.id, issueId: issue.id, actorType: 'human', payload: { assigneeType: 'agent', assigneeId: 'missing' }, status: 'pending', createdAt: now })
  await store.taskRuns.put('orphan', { id: 'orphan', projectId: project.id, issueId: issue.id, agentId: 'missing', status: 'queued', trigger: 'assignment', attempt: 1, assignmentRevision: 1, commandId: 'pending', cwd: '/tmp', createdAt: now })
  await store.issues.put(issue.id, { ...issue, status: 'in_progress', activeTaskRunId: 'missing-pointer', assignmentRevision: 2 })

  await service.initialize()

  assert.equal(store.commands.get('pending').status, 'failed')
  assert.equal(store.taskRuns.get('orphan').status, 'cancelled')
  assert.equal(store.issues.get(issue.id).status, 'blocked')
  assert.equal(store.issues.get(issue.id).activeTaskRunId, undefined)
  assert.equal([...store.commands.records.values()].some((command) => ['pending', 'running'].includes(command.status)), false)
})

test('startup escalates an invalid Delegation into one durable Decision and Inbox item', async () => {
  const store = memoryStore()
  const service = new OrchestratorService({}, store)
  const project = await service.createProject({ name: 'Delegation recovery decision', cwd: '/tmp', prd: 'Recover ownership.', technicalDesign: 'Escalate invalid durable context.' })
  const parent = await service.createIssue({ projectId: project.id, title: 'Existing parent', description: 'The child context was lost.' })
  const delegation = { id: 'invalid-recovery-delegation', squadId: 'missing-squad', projectId: project.id, parentIssueId: parent.id, childIssueId: 'missing-child', leaderAgentId: 'missing-leader', memberAgentId: 'missing-member', status: 'running', instruction: 'Recover safely.', createdAt: now, updatedAt: now }
  await store.delegations.put(delegation.id, delegation)

  await service.initialize()
  await service.initialize()

  const recovered = store.delegations.get(delegation.id)
  assert.equal(recovered.status, 'escalated')
  assert.match(recovered.error, /ownership or Issue context became invalid/)
  const decisions = [...store.decisions.records.values()].filter((decision) => decision.metadata?.delegationId === delegation.id)
  assert.equal(decisions.length, 1)
  assert.equal(decisions[0].status, 'pending')
  assert.ok(service.snapshot().inbox.some((item) => item.decisionId === decisions[0].id && item.kind === 'needs_decision'))
})

async function approvedProject(service, store, commands, agentOverrides = {}, cwd = '/tmp') {
  const agent = await service.createAgent({ name: 'Engineer', role: 'Software Engineer', description: '', persona: 'Implement.', preset: 'standard', toolPolicy: 'full', ...agentOverrides })
  const project = await service.createProject({ name: 'Execution project', summary: '', cwd, prd: 'PRD', technicalDesign: 'Design' })
  await service.addProjectAgent(project.id, { agentId: agent.id, projectRole: agent.role, autoAssignable: true, joinedBy: 'test-helper' })
  const tasks = [
    { id: 'code', projectId: project.id, ordinal: 0, title: 'Code', kind: 'code', description: 'Implement', acceptanceCriteria: ['done'], dependencies: [], agentId: agent.id, testCommand: commands[0], status: 'draft', createdAt: now, updatedAt: now },
    { id: 'test', projectId: project.id, ordinal: 1, title: 'Test', kind: 'test', description: 'Verify', acceptanceCriteria: ['passes'], dependencies: ['code'], agentId: agent.id, testCommand: commands[1], status: 'draft', createdAt: now, updatedAt: now },
  ]
  for (const task of tasks) await store.tasks.put(task.id, task)
  await store.projects.put(project.id, { ...project, status: 'awaiting_approval', revision: 2, taskIds: tasks.map((task) => task.id) })
  return await service.approveProject(project.id, 'tester')
}

async function waitForTaskRun(store, taskRunId) {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    const run = store.taskRuns.get(taskRunId)
    if (run && ['completed', 'failed', 'cancelled'].includes(run.status)) return run
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
  throw new Error(`task run ${taskRunId} did not settle`)
}

async function waitForRun(store, runId) {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    const run = store.runs.get(runId)
    if (run && ['completed', 'failed', 'cancelled'].includes(run.status)) return run
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
  throw new Error(`run ${runId} did not settle`)
}
