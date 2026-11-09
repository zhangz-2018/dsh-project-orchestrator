import assert from 'node:assert/strict'
import test from 'node:test'
import {
  OrchestratorStore,
  PlanningCheckpointRecordSchema,
  PlanningCoordinator,
  PlanningOperationRecordSchema,
  PlanningPolicySnapshotRecordSchema,
  PlanningPromptReferenceManifestRecordSchema,
  PlanningSourceInputRecordSchema,
  PlanningStageAttemptRecordSchema,
  RepositoryPolicyBaselineRecordSchema,
  digestObject,
  orchestratorDomain,
  planningCheckpointIsCurrentV3,
} from '../lib/index.js'

class MemoryTable {
  records = new Map()
  get(id) { return this.records.get(id) }
  entries() { return this.records.entries() }
  async put(id, value) { this.records.set(id, structuredClone(value)) }
  async delete(id) { return this.records.delete(id) }
  async update(id, transform) { const next = transform(this.records.get(id)); await this.put(id, next); return next }
}

function store() {
  const tables = new Map()
  return new OrchestratorStore({ table(name) {
    if (!tables.has(name)) tables.set(name, new MemoryTable())
    return tables.get(name)
  } })
}

function operation() {
  const now = '2026-09-23T00:00:00.000Z'
  return PlanningOperationRecordSchema.parse({
    id: 'operation-1', projectId: 'project-1', mode: 'initial', status: 'running', stage: 'reserved', planningContractVersion: 3,
    publicationMode: 'candidate', baseProjectRevision: 1, repositoryPolicyIteration: 0, requestDigest: 'a'.repeat(64),
    metricPolicyId: 'policy-1', metricPolicyVersion: '1', metricPolicyDigest: 'b'.repeat(64), reservedPlanSnapshotId: 'plan-1',
    reservedPlanRevision: 2, createdAt: now, updatedAt: now,
  })
}

test('PlanningCoordinator owns stage advancement, checkpoint digests, and DomainEvent publication', async () => {
  const storage = store()
  const coordinator = new PlanningCoordinator(storage, operation())
  const attempt = await coordinator.transition({ stage: 'source_ingest' })
  const checkpoint = [...storage.planningCheckpoints.entries()][0][1]

  assert.equal(attempt.status, 'completed')
  assert.equal(attempt.stage, 'source_ingest')
  assert.doesNotThrow(() => PlanningStageAttemptRecordSchema.parse(attempt))
  assert.doesNotThrow(() => PlanningOperationRecordSchema.parse(coordinator.operation))
  assert.doesNotThrow(() => PlanningCheckpointRecordSchema.parse(checkpoint))
  assert.equal(planningCheckpointIsCurrentV3(checkpoint, coordinator.operation), true)
  assert.equal(storage.planningOperations.get('operation-1').stage, 'source_ingest')
  assert.equal(storage.readDomainEvents().events[0].payloadDigest, digestObject(coordinator.operation))
  assert.equal(storage.readDomainEvents().events[0].eventType, 'planning.source_ingest.running')

  const changed = await coordinator.transition({ sourceInputId: 'source-1', sourceInputDigest: 'c'.repeat(64) })
  assert.equal(changed, undefined)
  assert.equal([...storage.planningStageAttempts.entries()].length, 1)
  assert.deepEqual([...storage.planningCheckpoints.entries()].map(([, record]) => record.sequence), [1, 2])
  assert.equal(storage.readDomainEvents().events.length, 2)
  await assert.rejects(() => coordinator.transition({ stage: 'reserved' }), (error) => error.code === 'planning-stage-regression')
  await assert.rejects(() => coordinator.transition({ projectId: 'other-project' }), (error) => error.code === 'planning-operation-owner-mismatch')
})

test('PlanningCoordinator retains a failed StageAttempt without publishing the rejected stage', async () => {
  const storage = store()
  const coordinator = new PlanningCoordinator(storage, operation(), ({ stage }) => {
    if (stage === 'source_ingest') throw new Error('injected stage failure')
  })

  await assert.rejects(() => coordinator.transition({ stage: 'source_ingest' }), /injected stage failure/u)

  const attempt = [...storage.planningStageAttempts.entries()][0][1]
  assert.equal(attempt.status, 'failed')
  assert.equal(attempt.errorCode, 'planning-stage-failed')
  assert.doesNotThrow(() => PlanningStageAttemptRecordSchema.parse(attempt))
  assert.equal(coordinator.operation.stage, 'reserved')
  assert.equal(storage.planningOperations.get('operation-1'), undefined)
  assert.equal([...storage.planningCheckpoints.entries()].length, 0)
  assert.equal(storage.readDomainEvents().events.length, 0)
  await coordinator.recordFailedAttempt(new Error('same failure'))
  assert.equal([...storage.planningStageAttempts.entries()].length, 1)
})

test('PlanningCoordinator binds sorted Prompt references to a completed current stage attempt', async () => {
  const storage = store()
  const current = operation()
  const coordinator = new PlanningCoordinator(storage, current)
  const attempt = PlanningStageAttemptRecordSchema.parse({
    id: 'attempt-1', operationId: current.id, stage: current.stage, round: 1, status: 'completed',
    inputDigest: 'c'.repeat(64), outputDigest: digestObject(current), createdAt: current.createdAt, completedAt: current.createdAt,
  })
  await storage.planningStageAttempts.put(attempt.id, attempt)
  const manifest = coordinator.promptReferenceManifest({ stageAttemptId: attempt.id, references: [
    { ref: 'ref-repo-f00002', kind: 'repository_evidence', artifactId: 'tests/owner.test.ts', artifactDigest: 'd'.repeat(64) },
    { ref: 'ref-repo-f00001', kind: 'repository_evidence', artifactId: 'src/owner.ts', artifactDigest: 'e'.repeat(64) },
  ] })
  assert.doesNotThrow(() => PlanningPromptReferenceManifestRecordSchema.parse(manifest))
  assert.deepEqual(manifest.references.map((reference) => reference.ref), ['ref-repo-f00001', 'ref-repo-f00002'])
  assert.equal(manifest.allowedRefSetDigest, digestObject(['ref-repo-f00001', 'ref-repo-f00002']))
  await storage.planningStageAttempts.put(attempt.id, { ...attempt, stage: 'source_ingest' })
  assert.throws(() => coordinator.promptReferenceManifest({ stageAttemptId: attempt.id, references: [] }), (error) => error.code === 'prompt-reference-attempt-invalid')
  await storage.planningStageAttempts.put(attempt.id, { ...attempt, operationId: 'other-operation' })
  assert.throws(() => coordinator.promptReferenceManifest({ stageAttemptId: attempt.id, references: [] }), (error) => error.code === 'prompt-reference-attempt-invalid')
})

test('PlanningCoordinator bases restart decisions on durable pointers, intents, checkpoint, and source', async () => {
  const storage = store()
  const base = operation()
  const sourceCore = {
    projectId: base.projectId, operationId: base.id, mode: 'initial', title: 'Project', prd: 'Persist one record.',
    technicalDesign: 'Use the current owner.', taskLanguage: 'zh-CN', sourceRefs: [], sourceBlocks: [], requestDigest: base.requestDigest,
  }
  const source = { id: 'source-1', ...sourceCore, sourceInputDigest: digestObject(sourceCore), createdAt: base.createdAt }
  const running = { ...base, stage: 'source_profile', sourceInputId: source.id, sourceInputDigest: source.sourceInputDigest }
  const coordinator = new PlanningCoordinator(storage, running)
  const checkpoint = await coordinator.persistCheckpoint(digestObject({ stage: running.stage }))
  const project = { id: base.projectId, revision: 1, taskIds: [], createdAt: base.createdAt, updatedAt: base.updatedAt }
  await storage.planningSourceInputs.put(source.id, source)

  const retryable = coordinator.recoveryDisposition(project)
  assert.equal(retryable.kind, 'retryable')
  assert.equal(retryable.checkpoint.id, checkpoint.id)
  assert.throws(() => coordinator.recoveryDisposition({ ...project, id: 'other-project' }), (error) => error.code === 'planning-operation-owner-mismatch')

  await storage.planningSourceInputs.put(source.id, { ...source, title: 'Tampered' })
  assert.equal(coordinator.recoveryDisposition(project).kind, 'aborted')
  await storage.planningSourceInputs.put(source.id, source)

  await storage.storageMutationIntents.put('intent-1', { id: 'intent-1', aggregateType: 'planning_operation', aggregateId: base.id, status: 'needs_reconciliation' })
  assert.equal(coordinator.recoveryDisposition(project).kind, 'defer')
  await storage.storageMutationIntents.delete('intent-1')

  await storage.planSnapshots.put(base.reservedPlanSnapshotId, { id: base.reservedPlanSnapshotId, planningContractVersion: 3, taskIds: ['task-1'] })
  assert.deepEqual(coordinator.recoveryDisposition({ ...project, currentPlanSnapshotId: base.reservedPlanSnapshotId }), { kind: 'committed', candidateId: base.reservedPlanSnapshotId, taskIds: ['task-1'] })
})

test('PlanningCoordinator freezes Repository Policy successor inputs and rejects changed evidence', async () => {
  const storage = store()
  const base = operation()
  const sourceCore = {
    projectId: base.projectId, operationId: base.id, mode: 'initial', title: 'Project', prd: 'Persist one record.',
    technicalDesign: 'Use the current owner.', taskLanguage: 'zh-CN', sourceRefs: [], sourceBlocks: [], requestDigest: base.requestDigest,
  }
  const source = PlanningSourceInputRecordSchema.parse({ id: 'source-1', ...sourceCore, sourceInputDigest: digestObject(sourceCore), createdAt: base.createdAt })
  const baselineCore = {
    projectId: base.projectId, createdByOperationId: base.id, repositoryIdentityDigest: 'c'.repeat(64), repositoryDigest: 'd'.repeat(64),
    extractorVersion: 'test-v1', iteration: 0, constraintSeedIds: [], constraintSeedSetDigest: digestObject([]), status: 'ready',
  }
  const baseline = RepositoryPolicyBaselineRecordSchema.parse({ id: 'baseline-1', ...baselineCore, baselineDigest: digestObject(baselineCore), createdAt: base.createdAt })
  const policyCore = {
    projectId: base.projectId, operationId: base.id, repositorySnapshotId: 'repository-1', constraintIds: [], repositoryConstraintSeedSetDigest: digestObject([]),
    repositoryPolicyDeltaSeedIds: ['seed-1'], repositoryPolicyDeltaDigest: digestObject(['seed-1']), fixedPointStatus: 'delta_found',
    extractorVersion: 'test-v1', status: 'requires_replan', diagnostics: [],
  }
  const policy = PlanningPolicySnapshotRecordSchema.parse({ id: 'policy-1', ...policyCore, policyDigest: digestObject({ ...policyCore, constraints: [] }), createdAt: base.createdAt })
  const predecessor = PlanningOperationRecordSchema.parse({
    ...base, status: 'superseded', stage: 'policy_snapshot', sourceInputId: source.id, sourceInputDigest: source.sourceInputDigest,
    repositoryPolicyBaselineId: baseline.id, repositoryPolicyBaselineDigest: baseline.baselineDigest,
    policySnapshotId: policy.id, policyDigest: policy.policyDigest,
  })
  await storage.planningSourceInputs.put(source.id, source)
  await storage.repositoryPolicyBaselines.put(baseline.id, baseline)
  await storage.planningPolicySnapshots.put(policy.id, policy)
  const coordinator = new PlanningCoordinator(storage, predecessor)
  const options = coordinator.repositoryPolicySuccessorOptions()
  assert.equal(options.policySuccessor.predecessorOperationId, predecessor.id)
  assert.equal(options.policySuccessor.restartStage, 'source_policy_precheck')
  assert.equal(options.batch.idempotencyKey, `repository-policy:${predecessor.id}:${policy.repositoryPolicyDeltaDigest}`)
  assert.equal(options.requestDigest, digestObject({ kind: 'repository_policy_successor', policySuccessor: options.policySuccessor, batch: options.batch }))
  const project = { id: predecessor.projectId, status: 'draft', revision: 1, taskIds: [] }
  assert.equal(coordinator.repositoryPolicySuccessorDisposition(project, options), 'start')
  assert.equal(coordinator.repositoryPolicySuccessorDisposition({ ...project, status: 'decomposing', activePlanningOperationId: predecessor.id }, options), 'recover_project')
  assert.equal(coordinator.repositoryPolicySuccessorDisposition({ ...project, status: 'decomposing', activeDecompositionKey: options.batch.idempotencyKey, activeDecompositionDigest: options.requestDigest }, options), 'inflight')
  assert.throws(() => coordinator.repositoryPolicySuccessorDisposition({ ...project, status: 'decomposing', activeDecompositionKey: options.batch.idempotencyKey, activeDecompositionDigest: '0'.repeat(64) }, options), (error) => error.code === 'decomposition-idempotency-conflict')
  await storage.planningOperations.put('successor-1', { id: 'successor-1', predecessorOperationId: predecessor.id, requestDigest: options.requestDigest })
  assert.equal(coordinator.repositoryPolicySuccessorDisposition(project, options), 'existing')

  await storage.planningSourceInputs.put(source.id, { ...source, title: 'Changed' })
  assert.throws(() => coordinator.repositoryPolicySuccessorOptions(), (error) => error.code === 'repository-policy-successor-source-stale')
  await storage.planningSourceInputs.put(source.id, source)
  await storage.repositoryPolicyBaselines.put(baseline.id, { ...baseline, iteration: 1 })
  assert.throws(() => coordinator.repositoryPolicySuccessorOptions(), (error) => error.code === 'repository-policy-successor-baseline-stale')
  await storage.repositoryPolicyBaselines.put(baseline.id, baseline)
  await storage.planningPolicySnapshots.put(policy.id, { ...policy, repositoryPolicyDeltaSeedIds: ['changed'] })
  assert.throws(() => coordinator.repositoryPolicySuccessorOptions(), (error) => error.code === 'repository-policy-successor-delta-stale')
})

test('PlanningCoordinator queues only superseded Policy operations without a successor', async () => {
  const storage = store()
  const base = operation()
  await storage.planningOperations.put('first', { ...base, id: 'first', status: 'superseded', stage: 'policy_snapshot', createdAt: '2026-09-23T00:00:00.000Z' })
  await storage.planningOperations.put('second', { ...base, id: 'second', status: 'superseded', stage: 'policy_snapshot', createdAt: '2026-09-23T00:01:00.000Z' })
  await storage.planningOperations.put('other-stage', { ...base, id: 'other-stage', status: 'superseded', stage: 'task_plan', createdAt: '2026-09-23T00:02:00.000Z' })
  assert.deepEqual(PlanningCoordinator.pendingRepositoryPolicySuccessors(storage).map((item) => item.id), ['first', 'second'])
  await storage.planningOperations.put('successor', { ...base, id: 'successor', predecessorOperationId: 'first', createdAt: '2026-09-23T00:03:00.000Z' })
  assert.deepEqual(PlanningCoordinator.pendingRepositoryPolicySuccessors(storage).map((item) => item.id), ['second'])
})
