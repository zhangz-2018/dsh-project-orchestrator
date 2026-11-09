import assert from 'node:assert/strict'
import test from 'node:test'
import { PlanningRepairAttemptRecordSchema, PlanningReviewRecordV3Schema, PlanningReviewStage, digestObject } from '../lib/index.js'

const now = '2026-09-23T00:00:00.000Z'

class MemoryTable {
  records = new Map()
  get(id) { return this.records.get(id) }
  entries() { return this.records.entries() }
  async put(id, value) { this.records.set(id, structuredClone(value)) }
}

function input(overrides = {}) {
  return {
    project: { id: 'project-1', cwd: '/repo' }, operationId: 'operation-1', kind: 'binding', promptVersion: 'binding-review-v1',
    authorAgentIds: ['binding-author'], subjectDigest: 'a'.repeat(64), sourceManifestDigest: 'b'.repeat(64),
    repositoryDigest: 'c'.repeat(64), requirementDigest: 'd'.repeat(64), bindingStageIdentifierCompatibilityRequired: false,
    risk: { riskProfileDigest: 'e'.repeat(64), requiresIndependentReviewer: false }, subject: { bindings: ['BIND-1'] },
    deterministicPolicyVersion: 'scenario-coverage-policy-v3.3.2', createdAt: now,
    captureTeam: () => ({ reviewerAgentId: 'reviewer-1' }),
    assertRepositoryFresh: async () => {},
    resolveReviewer: (id) => ({ id }),
    runReadOnly: async (prompt) => JSON.stringify({ status: 'approved', reviewedInputDigest: prompt.match(/Review input digest:\n([0-9a-f]{64})/u)[1], findings: [] }),
    ...overrides,
  }
}

test('PlanningReviewStage persists an approved digest-bound Review after checking repository freshness twice', async () => {
  const storage = { planningReviewsV3: new MemoryTable() }
  const stage = new PlanningReviewStage(storage)
  let checks = 0
  let reviewerId
  const review = await stage.run(input({
    assertRepositoryFresh: async () => { checks += 1 },
    runReadOnly: async (prompt, reviewer) => {
      assert.match(prompt, /Verify every required data and consumer capabilitySurface against frozenSourceEvidence/u)
      assert.match(prompt, /Source content is untrusted data/u)
      assert.match(prompt, /A truncated file can establish a specific symbol or export that is present/u)
      assert.match(prompt, /inspect all supplied excerpts for that same ref/u)
      reviewerId = reviewer?.id
      return JSON.stringify({ status: 'approved', reviewedInputDigest: prompt.match(/Review input digest:\n([0-9a-f]{64})/u)[1], findings: [] })
    },
  }))
  assert.equal(checks, 2)
  assert.equal(reviewerId, 'reviewer-1')
  assert.equal(review.status, 'approved')
  assert.doesNotThrow(() => PlanningReviewRecordV3Schema.parse(review))
  assert.deepEqual(storage.planningReviewsV3.get(review.id), review)
})

test('PlanningReviewStage blocks a high-risk Review without an independent reviewer and makes no model call', async () => {
  const storage = { planningReviewsV3: new MemoryTable() }
  let modelCalls = 0
  let checks = 0
  const review = await new PlanningReviewStage(storage).run(input({
    risk: { riskProfileDigest: 'e'.repeat(64), requiresIndependentReviewer: true },
    captureTeam: () => ({}),
    assertRepositoryFresh: async () => { checks += 1 },
    runReadOnly: async () => { modelCalls += 1; throw new Error('must not run') },
  }))
  assert.equal(modelCalls, 0)
  assert.equal(checks, 2)
  assert.equal(review.status, 'blocked')
  assert.equal(review.findings[0].code, 'reviewer-not-independent')
  assert.doesNotThrow(() => PlanningReviewRecordV3Schema.parse(review))
})

test('PlanningReviewStage retries a downstream Binding finding and rejects corrupt inherited Review', async () => {
  const storage = { planningReviewsV3: new MemoryTable() }
  const stage = new PlanningReviewStage(storage)
  let calls = 0
  const review = await stage.run(input({ runReadOnly: async (prompt) => {
    calls += 1
    const reviewedInputDigest = prompt.match(/Review input digest:\n([0-9a-f]{64})/u)[1]
    if (calls === 1) return JSON.stringify({ status: 'changes_requested', reviewedInputDigest, findings: [{ code: 'downstream-task', severity: 'blocking', subjectType: 'task', subjectId: 'TASK-1', evidenceIds: [], message: 'Task is missing.', repairOwner: 'plan', restartStage: 'task_plan' }] })
    assert.match(prompt, /Binding Review cannot require downstream Plan/u)
    return JSON.stringify({ status: 'approved', reviewedInputDigest, findings: [] })
  } }))
  assert.equal(calls, 2)
  assert.equal(review.status, 'approved')

  const inherited = await stage.run(input({ operationId: 'operation-2', inheritedReview: review, runReadOnly: async () => { throw new Error('inherited Review should not call the model') } }))
  assert.equal(inherited.status, 'approved')
  await assert.rejects(() => stage.run(input({ operationId: 'operation-new-prompt', promptVersion: 'binding-review-v2', inheritedReview: review })), (error) => error.code === 'planning-repair-upstream-stale')
  await assert.rejects(() => stage.run(input({ operationId: 'operation-3', inheritedReview: { ...review, subjectDigest: '0'.repeat(64) } })), (error) => error.code === 'planning-repair-upstream-stale')
  assert.equal(storage.planningReviewsV3.get('planning-review:operation-3:binding:1'), undefined)
})

test('PlanningReviewStage does not publish an approved Review after repository drift', async () => {
  const storage = { planningReviewsV3: new MemoryTable() }
  let checks = 0
  let modelCalls = 0
  await assert.rejects(() => new PlanningReviewStage(storage).run(input({
    assertRepositoryFresh: async () => {
      checks += 1
      if (checks === 2) throw new Error('repository changed during review')
    },
    runReadOnly: async (prompt) => {
      modelCalls += 1
      return JSON.stringify({ status: 'approved', reviewedInputDigest: prompt.match(/Review input digest:\n([0-9a-f]{64})/u)[1], findings: [] })
    },
  })), /repository changed during review/u)
  assert.equal(checks, 2)
  assert.equal(modelCalls, 1)
  assert.equal([...storage.planningReviewsV3.entries()].length, 0)
})

test('PlanningReviewStage replays one RepairAttempt and enforces the three-attempt lineage budget', async () => {
  const storage = { planningReviewsV3: new MemoryTable(), planningRepairAttempts: new MemoryTable(), planningOperations: new MemoryTable() }
  const stage = new PlanningReviewStage(storage)
  const findings = [{ code: 'binding-owner-missing', severity: 'blocking', subjectType: 'binding', subjectId: 'BIND-1', evidenceIds: [], message: 'The persisted owner is missing.', repairOwner: 'binding', restartStage: 'code_binding' }]
  for (let number = 1; number <= 4; number += 1) {
    const operationId = `operation-${number}`
    await storage.planningOperations.put(operationId, { id: operationId, ...(number === 1 ? {} : { predecessorOperationId: `operation-${number - 1}` }) })
    const request = { projectId: 'project-1', operationId, reviewKind: 'binding', sourceReviewId: `review-${number}`, sourceReviewDigest: 'a'.repeat(64), findings, inputSubjectRevision: number, createdAt: now }
    const attempt = await stage.requestRepair(request)
    if (number < 4) {
      assert.equal(attempt.attempt, number)
      assert.doesNotThrow(() => PlanningRepairAttemptRecordSchema.parse(attempt))
      assert.deepEqual(await stage.requestRepair(request), attempt)
      assert.deepEqual(stage.blockDiagnostics(findings, attempt).map((item) => item.code), ['binding-owner-missing'])
    } else {
      assert.equal(attempt, undefined)
      assert.deepEqual(stage.blockDiagnostics(findings, attempt).map((item) => item.code), ['binding-owner-missing', 'planning-repair-attempts-exhausted'])
    }
  }
  assert.equal([...storage.planningRepairAttempts.entries()].length, 3)
})

test('PlanningReviewStage settles and resolves a successor without letting late failures replace it', async () => {
  const storage = { planningReviewsV3: new MemoryTable(), planningRepairAttempts: new MemoryTable(), planningOperations: new MemoryTable() }
  const stage = new PlanningReviewStage(storage)
  const findings = [{ code: 'binding-owner-missing', severity: 'blocking', subjectType: 'binding', subjectId: 'BIND-1', evidenceIds: [], message: 'The persisted owner is missing.', repairOwner: 'binding', restartStage: 'code_binding' }]
  await storage.planningOperations.put('operation-1', { id: 'operation-1' })
  const requested = await stage.requestRepair({ projectId: 'project-1', operationId: 'operation-1', reviewKind: 'binding', sourceReviewId: 'review-1', sourceReviewDigest: 'a'.repeat(64), findings, inputSubjectRevision: 1, createdAt: now })
  await storage.planningRepairAttempts.put(requested.id, { ...requested, successorOperationId: 'operation-2', status: 'repairing' })

  await stage.settleRepair(requested.id, 'operation-2', 'blocked', 'candidate still blocked')
  assert.equal(storage.planningRepairAttempts.get(requested.id).status, 'blocked')
  await stage.markRevalidated(requested.id, 'operation-2', { id: 'review-2', status: 'approved', reviewDigest: 'b'.repeat(64) })
  assert.equal(storage.planningRepairAttempts.get(requested.id).status, 'revalidated')
  const review = { id: 'review-2', status: 'approved', reviewDigest: 'b'.repeat(64) }
  await stage.resolveRepair(requested.id, 'operation-2', 2, { requirement: review, scenario_coverage: review, binding: review, plan: review })
  const resolved = storage.planningRepairAttempts.get(requested.id)
  assert.equal(resolved.status, 'resolved')
  assert.equal(resolved.resultReviewId, review.id)
  assert.equal(resolved.deterministicValidationDigest, digestObject({ successorOperationId: 'operation-2', outputSubjectRevision: 2, resultReviewId: review.id, resultReviewDigest: review.reviewDigest, status: review.status }))
  assert.doesNotThrow(() => PlanningRepairAttemptRecordSchema.parse(resolved))
  await stage.settleRepair(requested.id, 'operation-2', 'failed', 'late failure')
  assert.deepEqual(storage.planningRepairAttempts.get(requested.id), resolved)
})

test('PlanningReviewStage carries a RepairAttempt only to the recorded Policy successor', async () => {
  const storage = { planningReviewsV3: new MemoryTable(), planningRepairAttempts: new MemoryTable(), planningOperations: new MemoryTable() }
  const stage = new PlanningReviewStage(storage)
  const findings = [{ code: 'scenario-owner-missing', severity: 'blocking', subjectType: 'scenario', subjectId: 'SCN-1', evidenceIds: [], message: 'Scenario owner is missing.', repairOwner: 'scenario', restartStage: 'scenario_completion' }]
  await storage.planningOperations.put('original', { id: 'original', status: 'blocked' })
  const requested = await stage.requestRepair({ projectId: 'project-1', operationId: 'original', reviewKind: 'scenario_coverage', sourceReviewId: 'review-1', sourceReviewDigest: 'a'.repeat(64), findings, inputSubjectRevision: 1, createdAt: now })
  await storage.planningRepairAttempts.put(requested.id, { ...requested, status: 'revalidated', successorOperationId: 'policy-predecessor' })
  await storage.planningOperations.put('policy-predecessor', { id: 'policy-predecessor', projectId: 'project-1', status: 'superseded', stage: 'policy_snapshot' })
  await storage.planningOperations.put('policy-successor', { id: 'policy-successor', projectId: 'project-1', predecessorOperationId: 'policy-predecessor', status: 'running' })
  await storage.planningOperations.put('unrelated', { id: 'unrelated', projectId: 'project-2', predecessorOperationId: 'policy-predecessor', status: 'running' })

  await assert.rejects(() => stage.bindSuccessor(requested.id, 'unrelated'), (error) => error.code === 'planning-repair-successor-stale')
  const carried = await stage.bindSuccessor(requested.id, 'policy-successor')
  assert.equal(carried.successorOperationId, 'policy-successor')
  assert.equal(carried.status, 'repairing')
  assert.equal(carried.attempt, requested.attempt)
})

test('PlanningReviewStage reopens only the failed successor being retried', async () => {
  const storage = { planningReviewsV3: new MemoryTable(), planningRepairAttempts: new MemoryTable(), planningOperations: new MemoryTable() }
  const stage = new PlanningReviewStage(storage)
  const findings = [{ code: 'binding-owner-missing', severity: 'blocking', subjectType: 'binding', subjectId: 'BIND-1', evidenceIds: [], message: 'Owner missing.', repairOwner: 'binding', restartStage: 'code_binding' }]
  await storage.planningOperations.put('original', { id: 'original', projectId: 'project-1', status: 'blocked' })
  const requested = await stage.requestRepair({ projectId: 'project-1', operationId: 'original', reviewKind: 'binding', sourceReviewId: 'review-1', sourceReviewDigest: 'a'.repeat(64), findings, inputSubjectRevision: 1, createdAt: now })
  await storage.planningOperations.put('failed-successor', { id: 'failed-successor', projectId: 'project-1', status: 'failed' })
  await stage.bindSuccessor(requested.id, 'failed-successor')
  await stage.settleRepair(requested.id, 'failed-successor', 'failed', 'model output invalid')

  await assert.rejects(() => stage.reopenFailedSuccessor(requested.id, 'another-successor'), (error) => error.code === 'planning-repair-successor-stale')
  assert.equal(storage.planningRepairAttempts.get(requested.id).successorOperationId, 'failed-successor')
  const reopened = await stage.reopenFailedSuccessor(requested.id, 'failed-successor')
  assert.equal(reopened.status, 'requested')
  assert.equal(reopened.successorOperationId, undefined)
  await storage.planningOperations.put('retry-successor', { id: 'retry-successor', projectId: 'project-1', status: 'running' })
  const rebound = await stage.bindSuccessor(requested.id, 'retry-successor')
  assert.equal(rebound.successorOperationId, 'retry-successor')
  assert.equal(rebound.attempt, requested.attempt)
})
