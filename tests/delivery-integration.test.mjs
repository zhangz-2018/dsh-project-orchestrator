import assert from 'node:assert/strict'
import test from 'node:test'
import { execFile } from 'node:child_process'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'

import { OrchestratorService, OrchestratorStore, digestObject } from '../lib/index.js'

const exec = promisify(execFile)
const now = '2026-08-28T00:00:00.000Z'

class MemoryTable {
  constructor(records = []) { this.records = new Map(records.map((record) => [record.id, structuredClone(record)])) }
  get(key) { return this.records.get(key) }
  entries() { return this.records.entries() }
  async put(key, value) { this.records.set(key, structuredClone(value)) }
  async delete(key) { return this.records.delete(key) }
  async update(key, transform) {
    const next = transform(this.records.get(key))
    this.records.set(key, structuredClone(next))
    return next
  }
}

function memoryStore(seed = {}) {
  const tables = new Map()
  for (const [name, records] of Object.entries(seed)) tables.set(name, new MemoryTable(records))
  return new OrchestratorStore({ table(name) {
    if (!tables.has(name)) tables.set(name, new MemoryTable())
    return tables.get(name)
  } })
}

async function git(cwd, ...args) {
  const result = await exec('git', args, { cwd, encoding: 'utf8', maxBuffer: 8_500_000 })
  return result.stdout.trim()
}

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'dsh-delivery-integration-'))
  await git(root, 'init', '-b', 'main')
  await git(root, 'config', 'user.name', 'Fixture')
  await git(root, 'config', 'user.email', 'fixture@example.test')
  await writeFile(join(root, 'package.json'), JSON.stringify({ scripts: { test: 'node --test' } }))
  await writeFile(join(root, 'feature.txt'), 'base\n')
  await git(root, 'add', '-A')
  await git(root, 'commit', '--no-verify', '-m', 'chore(fixture): create base')
  const baseCommit = await git(root, 'rev-parse', 'HEAD')
  await git(root, 'switch', '-c', 'task-output')
  await writeFile(join(root, 'feature.txt'), 'base\nimplemented\n')
  await git(root, 'add', '-A')
  await git(root, 'commit', '--no-verify', '-m', 'feat(fixture): add task output')
  const outputCommit = await git(root, 'rev-parse', 'HEAD')
  await git(root, 'switch', 'main')

  const projectId = 'project-1'
  const planId = 'plan-1'
  const taskId = 'task-1'
  const runId = 'task-run-1'
  const bindingId = 'target-1'
  const accessId = 'access-1'
  const bindingDigest = 'b'.repeat(64)
  const accessDigest = 'c'.repeat(64)
  const repositoryIdentityDigest = 'd'.repeat(64)
  const project = {
    id: projectId, name: 'fixture', summary: '', cwd: root, prd: 'PRD', technicalDesign: 'Design', status: 'running', revision: 1,
    approvedRevision: 1, taskIds: [taskId], currentPlanSnapshotId: planId, planningContractVersion: 3, deliveryStage: 'executing', createdAt: now, updatedAt: now,
  }
  const task = {
    id: taskId, projectId, ordinal: 0, title: 'Implement feature', kind: 'code', description: 'Implement', acceptanceCriteria: ['implemented'], dependencies: [],
    testCommand: 'true', status: 'completed', testExitCode: 0, planningContractVersion: 3, taskRevision: 1, planSnapshotId: planId,
    assignmentPolicy: { requiredRoles: ['implementer'], requiredCapabilities: [], allowedAgentIds: [], allowedSquadIds: [], requiredToolPolicy: 'full', allowedScope: ['feature.txt'], forbiddenScope: [], conflictKeys: [], maxParallel: 1, riskLevel: 'medium', requiresIndependentReviewer: false },
    createdAt: now, updatedAt: now,
  }
  const plan = {
    id: planId, projectId, revision: 1, mode: 'initial', taskIds: [taskId], planHash: 'a'.repeat(64), teamComposition: { members: [], squads: [], teamDigest: 'e'.repeat(64), capturedAt: now },
    teamDigest: 'e'.repeat(64), assignmentDigest: 'f'.repeat(64), planningContractVersion: 3, canonicalTargetBindingId: bindingId,
    canonicalTargetBindingDigest: bindingDigest, accessGrantSnapshotId: accessId, accessGrantDigest: accessDigest, status: 'approved', createdAt: now,
  }
  const target = {
    id: bindingId, projectId, operationId: 'operation-1', resourceId: 'repo-1', repositoryIdentityDigest, rootIdentityDigest: '1'.repeat(64), vcs: 'git', targetRef: 'refs/heads/main',
    planningBaseCommit: baseCommit, integrationPrincipalId: 'system:delivery-integration', integrationGrantId: 'grant-1', bindingVersion: 1, bindingDigest,
    createdBy: 'system', createdAt: now,
  }
  const grantCore = {
    projectId, principalType: 'integration_service', principalId: target.integrationPrincipalId, resourceId: target.resourceId, repositoryIdentityDigest,
    permissions: ['canonical_integrate'], pathScopes: ['.'], commandIds: [], grantedBy: 'system', grantSource: 'resource_binding', validFrom: now, reason: 'integration',
  }
  const grant = { id: target.integrationGrantId, ...grantCore, grantDigest: digestObject(grantCore) }
  const accessSnapshot = { id: accessId, projectId, operationId: 'operation-1', grantIds: [grant.id], resourceDigest: '2'.repeat(64), teamDigest: 'e'.repeat(64), snapshotDigest: accessDigest, createdAt: now }
  const taskRun = {
    id: runId, projectId, taskId, planSnapshotId: planId, deliveryTaskRevision: 1, accessGrantSnapshotId: accessId, accessGrantSnapshotDigest: accessDigest,
    canonicalTargetBindingId: bindingId, canonicalTargetBindingDigest: bindingDigest, status: 'completed', trigger: 'approval', attempt: 1,
    actualBaseCommit: baseCommit, outputCommit, outputTree: await git(root, 'rev-parse', `${outputCommit}^{tree}`), outputDiffDigest: '0'.repeat(64), outputPatchIds: [], outputChangedPaths: [],
    createdAt: now, completedAt: now,
  }
  const store = memoryStore({ projects: [project], tasks: [task], plan_snapshots: [plan], canonical_target_bindings: [target], resource_access_grants: [grant], project_access_grant_snapshots: [accessSnapshot], task_runs: [taskRun] })
  const service = new OrchestratorService({}, store)
  const outputEvidence = await service.gitCommitEvidence(root, baseCommit, outputCommit)
  await store.taskRuns.put(runId, { ...taskRun, outputTree: outputEvidence.tree, outputDiffDigest: outputEvidence.diffDigest, outputPatchIds: outputEvidence.patchIds, outputChangedPaths: outputEvidence.changedPaths })
  return { root, service, store, project, plan, task, taskRun: store.taskRuns.get(runId), target, baseCommit, outputCommit }
}

test('V3 Delivery Integration CAS-integrates exact-one immutable TaskRun output with recomputed proof', async () => {
  const context = await fixture()
  try {
    const integration = await context.service.integrateCompletedTaskOutputsV3(context.project.id, true)
    assert.equal(integration.status, 'ready')
    assert.equal(integration.casStatus, 'matched')
    assert.equal(integration.outputs.length, 1)
    assert.equal(integration.outputs[0].taskRunId, context.taskRun.id)
    assert.equal(integration.outputs[0].inclusionStatus, 'verified')
    assert.equal(await git(context.root, 'rev-parse', 'refs/heads/main'), integration.finalCommit)
    assert.equal(await git(context.root, 'status', '--porcelain=v1'), '')
    const evidence = context.store.integrationInclusionEvidence.get(integration.outputs[0].inclusionEvidenceIds[0])
    assert.equal(evidence.result, 'verified')
    assert.deepEqual(evidence.sourcePatchIds, context.taskRun.outputPatchIds)
    assert.equal(context.store.projects.get(context.project.id).currentDeliveryIntegrationSnapshotId, integration.id)
  } finally {
    await rm(context.root, { recursive: true, force: true })
  }
})

test('V3 Delivery Integration fails closed when canonical target moves before CAS', async () => {
  const context = await fixture()
  try {
    await writeFile(join(context.root, 'external.txt'), 'external\n')
    await git(context.root, 'add', '-A')
    await git(context.root, 'commit', '--no-verify', '-m', 'chore(fixture): move target')
    const movedHead = await git(context.root, 'rev-parse', 'HEAD')
    await assert.rejects(() => context.service.integrateCompletedTaskOutputsV3(context.project.id, true), (error) => error.code === 'delivery-integration-target-moved')
    assert.equal(await git(context.root, 'rev-parse', 'HEAD'), movedHead)
    assert.equal(context.store.deliveryIntegrationSnapshots.get(`delivery-integration:${context.project.id}:r1`), undefined)
    assert.equal([...context.store.integrationInclusionEvidence.entries()].length, 0)
  } finally {
    await rm(context.root, { recursive: true, force: true })
  }
})

test('V3 delivery confirmation rejects a superficially ready legacy delivery without current convergence', async () => {
  const context = await fixture()
  try {
    await context.store.projects.put(context.project.id, { ...context.project, status: 'completed', deliveryStage: 'delivery_ready' })
    await context.store.projectReviews.put('review-1', { id: 'review-1', projectId: context.project.id, revision: 1, evidenceIds: [], status: 'approved', reviewerType: 'human', reviewerId: 'reviewer', summary: 'approved', createdAt: now, resolvedAt: now })
    await context.store.deliveryRecords.put('delivery-1', { id: 'delivery-1', projectId: context.project.id, revision: 1, reviewId: 'review-1', evidenceIds: [], status: 'ready', createdAt: now })
    await assert.rejects(() => context.service.confirmProjectDelivery(context.project.id, { actor: 'reviewer' }), (error) => error.code === 'delivery-not-ready' && /Convergence/u.test(error.message))
    assert.equal(context.store.deliveryRecords.get('delivery-1').status, 'ready')
  } finally {
    await rm(context.root, { recursive: true, force: true })
  }
})

test('V3 Convergence freezes immutable findings and a repair baseline at the canonical finalCommit', async () => {
  const context = await fixture()
  try {
    const integration = await context.service.integrateCompletedTaskOutputsV3(context.project.id, true)
    const review = await context.service.reviewDeliveryConvergenceV3(context.project.id, integration)
    assert.equal(review.status, 'changes_required')
    assert.equal(review.findingIds.length, 1)
    assert.equal(context.store.deliveryConvergenceFindings.get(review.findingIds[0]).code, 'stale_verification')

    const baseline = context.store.convergenceRepairBaselines.get(review.repairBaselineId)
    assert.equal(baseline.finalCommit, integration.finalCommit)
    assert.equal(baseline.parentIntegrationSnapshotId, integration.id)
    assert.deepEqual(baseline.findingIds, review.findingIds)
    assert.equal(baseline.carryItemIds.length, review.findingIds.length)
    assert.equal(context.store.convergenceRepairCarryItems.get(baseline.carryItemIds[0]).disposition, 'reverify')
    assert.equal(context.store.projects.get(context.project.id).deliveryStage, 'changes_required')

    const replay = await context.service.reviewDeliveryConvergenceV3(context.project.id, integration)
    assert.deepEqual(replay, review)
    assert.equal([...context.store.deliveryConvergenceReviews.entries()].length, 1)
    assert.equal([...context.store.convergenceRepairBaselines.entries()].length, 1)
  } finally {
    await rm(context.root, { recursive: true, force: true })
  }
})

test('V3 Convergence compensates every new record when the immutable review write fails', async () => {
  const context = await fixture()
  try {
    const integration = await context.service.integrateCompletedTaskOutputsV3(context.project.id, true)
    const projectBefore = structuredClone(context.store.projects.get(context.project.id))
    const originalPut = context.store.deliveryConvergenceReviews.put.bind(context.store.deliveryConvergenceReviews)
    context.store.deliveryConvergenceReviews.put = async () => { throw new Error('injected convergence review write failure') }
    await assert.rejects(() => context.service.reviewDeliveryConvergenceV3(context.project.id, integration), /injected convergence review write failure/u)
    context.store.deliveryConvergenceReviews.put = originalPut

    assert.deepEqual(context.store.projects.get(context.project.id), projectBefore)
    assert.equal(context.store.repositorySnapshotsV3.get(`final-repository:${integration.id}`), undefined)
    assert.equal([...context.store.deliveryConvergenceFindings.entries()].length, 0)
    assert.equal([...context.store.convergenceRepairCarryItems.entries()].length, 0)
    assert.equal([...context.store.convergenceRepairBaselines.entries()].length, 0)
    assert.equal([...context.store.deliveryConvergenceReviews.entries()].length, 0)
  } finally {
    await rm(context.root, { recursive: true, force: true })
  }
})

test('V3 Convergence repair replays the same baseline request while decomposition is active', async () => {
  const context = await fixture()
  try {
    const integration = await context.service.integrateCompletedTaskOutputsV3(context.project.id, true)
    const review = await context.service.reviewDeliveryConvergenceV3(context.project.id, integration)
    const baseline = context.store.convergenceRepairBaselines.get(review.repairBaselineId)
    const project = context.store.projects.get(context.project.id)
    const idempotencyKey = `convergence-repair:${baseline.baselineDigest}`
    const batch = {
      title: `${project.name} convergence repair`, prd: project.prd, technicalDesign: project.technicalDesign,
      taskLanguage: project.taskLanguage ?? 'zh-CN', sourceRefs: [], sourceBlocks: [], idempotencyKey,
    }
    const requestDigest = digestObject({ kind: 'convergence_repair', baselineDigest: baseline.baselineDigest, batch })
    const active = { ...project, status: 'decomposing', deliveryStage: 'planning', activeDecompositionKey: idempotencyKey, activeDecompositionDigest: requestDigest }
    await context.store.projects.put(project.id, active)

    const replay = await context.service.startConvergenceRepairV3(project.id, { expectedBaselineDigest: baseline.baselineDigest })
    assert.deepEqual(replay, active)
    assert.equal([...context.store.planningOperations.entries()].length, 0)
  } finally {
    await rm(context.root, { recursive: true, force: true })
  }
})

test('V3 Convergence repair rejects a repository that moved after the parent finalCommit', async () => {
  const context = await fixture()
  try {
    const integration = await context.service.integrateCompletedTaskOutputsV3(context.project.id, true)
    const review = await context.service.reviewDeliveryConvergenceV3(context.project.id, integration)
    const baseline = context.store.convergenceRepairBaselines.get(review.repairBaselineId)
    await writeFile(join(context.root, 'after-convergence.txt'), 'moved\n')
    await git(context.root, 'add', '-A')
    await git(context.root, 'commit', '--no-verify', '-m', 'chore(fixture): move after convergence')

    await assert.rejects(
      () => context.service.startConvergenceRepairV3(context.project.id, { expectedBaselineDigest: baseline.baselineDigest }),
      (error) => error.code === 'convergence-repair-repository-stale',
    )
    assert.equal([...context.store.planningOperations.entries()].length, 0)
  } finally {
    await rm(context.root, { recursive: true, force: true })
  }
})
