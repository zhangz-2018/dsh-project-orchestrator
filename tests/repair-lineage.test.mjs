import assert from 'node:assert/strict'
import test from 'node:test'

import {
  buildPlanningRepairAttempt,
  canonicalPlanningRepairFinding,
  earliestPlanningRestartStage,
} from '../lib/index.js'

const now = '2026-08-28T00:00:00.000Z'
const digest = 'a'.repeat(64)

function finding(code, restartStage, repairOwner) {
  return {
    code,
    severity: 'blocking',
    subjectType: 'task',
    subjectId: `subject:${code}`,
    evidenceIds: [],
    message: code,
    repairOwner,
    restartStage,
  }
}

test('repair lineage selects the earliest canonical restart stage independent of finding order or owner', () => {
  const findings = [
    finding('team-capability', 'capability_catalog_snapshot', 'team'),
    finding('requirement-gap', 'requirement_analysis', 'requirement'),
    finding('binding-gap', 'code_binding', 'binding'),
  ]
  assert.equal(earliestPlanningRestartStage(findings), 'requirement_analysis')
  assert.equal(earliestPlanningRestartStage([...findings].reverse()), 'requirement_analysis')
})

test('repair lineage derives restart stages from semantic ownership instead of model advice', () => {
  const scenarioFinding = {
    ...finding('scenario-contract-gap', 'binding_review', 'scenario'),
    subjectType: 'scenario',
  }
  assert.equal(canonicalPlanningRepairFinding(scenarioFinding, 'binding').restartStage, 'scenario_completion')
  assert.equal(earliestPlanningRestartStage([
    finding('binding-gap', 'plan_review', 'binding'),
    scenarioFinding,
  ], 'binding'), 'scenario_completion')

  const attempt = buildPlanningRepairAttempt({
    projectId: 'project-1',
    operationId: 'operation-1',
    reviewKind: 'binding',
    sourceReviewId: 'review-1',
    sourceReviewDigest: digest,
    findings: [finding('binding-gap', 'plan_review', 'binding'), scenarioFinding],
    inputSubjectRevision: 2,
    existingAttempts: [],
    repairPolicyVersion: 'planning-repair-v3.3.1',
    maxAttempts: 3,
    createdAt: now,
  })
  assert.equal(attempt.record.restartStage, 'scenario_completion')
  assert.equal(attempt.record.findings.find((item) => item.code === 'scenario-contract-gap').restartStage, 'scenario_completion')
  assert.equal(attempt.record.findings.find((item) => item.code === 'binding-gap').restartStage, 'code_binding')
})

test('team repair restarts only the review that requires an independent reviewer', () => {
  const teamFinding = { ...finding('reviewer-not-independent', 'requirement_analysis', 'team'), subjectType: 'scenario_coverage_policy' }
  assert.equal(canonicalPlanningRepairFinding(teamFinding, 'scenario_coverage').restartStage, 'scenario_coverage_review')
  assert.equal(canonicalPlanningRepairFinding(teamFinding, 'binding').restartStage, 'binding_review')
  assert.equal(canonicalPlanningRepairFinding(teamFinding, 'plan').restartStage, 'plan_review')
})

test('repair lineage is idempotent for the same finding set and policy', () => {
  const input = {
    projectId: 'project-1',
    operationId: 'operation-1',
    reviewKind: 'plan',
    sourceReviewId: 'review-1',
    sourceReviewDigest: digest,
    findings: [finding('binding-gap', 'code_binding', 'binding'), finding('plan-gap', 'task_plan', 'plan')],
    inputSubjectRevision: 2,
    existingAttempts: [],
    repairPolicyVersion: 'planning-repair-v3.3',
    maxAttempts: 3,
    createdAt: now,
  }
  const first = buildPlanningRepairAttempt(input)
  const replay = buildPlanningRepairAttempt({ ...input, findings: [...input.findings].reverse(), existingAttempts: [first.record] })
  assert.equal(first.replayed, false)
  assert.equal(first.record.restartStage, 'code_binding')
  assert.equal(replay.replayed, true)
  assert.deepEqual(replay.record, first.record)
})

test('repair lineage fails closed when semantic attempts are exhausted', () => {
  const findings = [finding('same-gap', 'task_plan', 'plan')]
  const existingAttempts = [1, 2, 3].map((attempt) => ({
    id: `repair-${attempt}`,
    projectId: 'project-1',
    operationId: 'operation-1',
    reviewKind: 'plan',
    sourceReviewId: `review-${attempt}`,
    sourceReviewDigest: String(attempt).repeat(64),
    sourceFindingIds: [`finding-${attempt}`],
    findingSetDigest: String(attempt + 3).repeat(64),
    repairOwner: 'plan',
    restartStage: 'task_plan',
    inputSubjectRevision: attempt,
    status: 'blocked',
    attempt,
    maxAttempts: 3,
    repairPolicyVersion: 'planning-repair-v3.3',
    repairDigest: String(attempt + 6).repeat(64),
    createdAt: now,
    updatedAt: now,
  }))
  assert.throws(() => buildPlanningRepairAttempt({ projectId: 'project-1', operationId: 'operation-1', reviewKind: 'plan', sourceReviewId: 'review-4', sourceReviewDigest: 'f'.repeat(64), findings, inputSubjectRevision: 4, existingAttempts, repairPolicyVersion: 'planning-repair-v3.3', maxAttempts: 3, createdAt: now }), (error) => error.code === 'planning-repair-attempts-exhausted')
})

test('repair attempt budget is enforced across canonical predecessor operations', () => {
  const findings = [finding('same-gap', 'task_plan', 'plan')]
  const existingAttempts = ['operation-1', 'operation-2', 'operation-3'].map((operationId, index) => ({
    id: `repair-${index + 1}`,
    projectId: 'project-1',
    operationId,
    reviewKind: 'plan',
    sourceReviewId: `review-${index + 1}`,
    sourceReviewDigest: String(index + 1).repeat(64),
    sourceFindingIds: [`finding-${index + 1}`],
    findingSetDigest: String(index + 4).repeat(64),
    repairOwner: 'plan',
    restartStage: 'task_plan',
    inputSubjectRevision: index + 1,
    status: 'blocked',
    attempt: index + 1,
    maxAttempts: 3,
    repairPolicyVersion: 'planning-repair-v3.3',
    repairDigest: String(index + 7).repeat(64),
    createdAt: now,
    updatedAt: now,
  }))
  assert.throws(() => buildPlanningRepairAttempt({ projectId: 'project-1', operationId: 'operation-4', lineageOperationIds: ['operation-1', 'operation-2', 'operation-3', 'operation-4'], reviewKind: 'plan', sourceReviewId: 'review-4', sourceReviewDigest: 'f'.repeat(64), findings, inputSubjectRevision: 4, existingAttempts, repairPolicyVersion: 'planning-repair-v3.3', maxAttempts: 3, createdAt: now }), (error) => error.code === 'planning-repair-attempts-exhausted')
})
