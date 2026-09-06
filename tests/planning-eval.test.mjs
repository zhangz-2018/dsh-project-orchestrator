import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { planningReleaseProvenanceFailures, validatePlanningCandidate, validatePlanningCanary, validatePlanningGold } from '../planning-evals/contracts.mjs'
import { gradePlanningRun, summarizePlanningGrades } from '../planning-evals/grader.mjs'

const gold = { id: 'case', requiredRequirementKeys: ['REQ-1'], requiredAcceptanceKeys: ['AC-1'], allowedBindingOwnerPathsByRequirement: { 'REQ-1': [['src/owner.ts']] }, assignmentExpectations: { implementation: { taskKey: 'TASK-1', hasEligibleMember: true, allowedAgentIds: ['agent-1'] } } }
const good = { runId: 'run', status: 'ready', repositoryEvidenceIds: ['src/owner.ts'], requirements: [{ key: 'REQ-1' }], decisions: [], bindings: [{ requirementKey: 'REQ-1', evidenceIds: ['src/owner.ts'], ownerPaths: ['src/owner.ts'] }], tasks: [{ key: 'TASK-1', acceptanceKeys: ['AC-1'], contextComplete: true, verificationCommandIds: ['test'] }], assignments: [{ taskKey: 'TASK-1', outcome: 'selected', agentId: 'agent-1' }], substantiveRewriteRequired: false }

test('planning eval grader rejects false-ready and enforces five-run release invariants', () => {
  const passing = gradePlanningRun(gold, good)
  assert.equal(passing.metrics.falseReady, 0)
  assert.equal(summarizePlanningGrades(Array.from({ length: 5 }, (_, index) => ({ ...passing, runId: `run-${index}` }))).passed, true)
  const bad = structuredClone(good)
  bad.requirements = []
  bad.bindings[0].evidenceIds = ['README.md']
  const failing = gradePlanningRun(gold, bad)
  assert.equal(failing.metrics.falseReady, 1)
  assert.equal(failing.metrics.invalidEvidenceReferences, 1)
  assert.equal(summarizePlanningGrades([failing]).passed, false)
})

test('planning eval scores one complete equivalent owner set per Requirement and rejects cross-Requirement leakage', () => {
  const equivalentGold = {
    ...gold,
    requiredRequirementKeys: ['REQ-1', 'REQ-2'],
    allowedBindingOwnerPathsByRequirement: {
      'REQ-1': [['src/owner.ts'], ['src/equivalent-owner.ts']],
      'REQ-2': [['src/second-owner.ts']],
    },
  }
  const equivalent = structuredClone(good)
  equivalent.requirements.push({ key: 'REQ-2' })
  equivalent.repositoryEvidenceIds.push('src/second-owner.ts')
  equivalent.bindings.push({ requirementKey: 'REQ-2', evidenceIds: ['src/second-owner.ts'], ownerPaths: ['src/second-owner.ts'] })
  const passing = gradePlanningRun(equivalentGold, equivalent)
  assert.equal(passing.metrics.bindingOwnerPrecision, 1)
  assert.equal(passing.metrics.bindingOwnerRecall, 1)
  assert.equal(passing.metrics.falseReady, 0)

  equivalent.bindings[1].requirementKey = 'REQ-1'
  const leaking = gradePlanningRun(equivalentGold, equivalent)
  assert.equal(leaking.metrics.bindingOwnerRecall, 0.5)
  assert.equal(leaking.metrics.falseReady, 1)
})

test('npm and GitHub release paths enforce the real-model planning qualification gate', async () => {
  const manifest = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'))
  const releaseWorkflow = await readFile(new URL('../.github/workflows/release.yml', import.meta.url), 'utf8')
  assert.match(manifest.scripts.verify, /eval:planning:subset/)
  assert.match(manifest.scripts.prepublishOnly, /eval:planning(?:\s|$)/)
  assert.match(releaseWorkflow, /run: pnpm eval:planning\s/u)
})

test('real-model evaluation requires immutable provenance and exact frozen Gold inputs', () => {
  const digest = 'a'.repeat(64)
  const releaseInput = {
    repositoryDigest: digest,
    sourceDigest: digest,
    teamCatalogDigest: digest,
    decisionInputDigest: digest,
    metricPolicyId: 'policy-1',
    metricPolicyVersion: '1',
    metricPolicyDigest: digest,
    promptVersionsDigest: digest,
    modelProvider: 'provider',
    modelId: 'model',
    modelVersion: 'version',
    samplingConfigDigest: digest,
    inputTokenBudget: 1000,
    outputTokenBudget: 1000,
    toolCallBudget: 10,
  }
  const releaseGold = validatePlanningGold({
    ...gold,
    schemaVersion: 1,
    repository: { identity: 'example/repository', fixture: 'fixture', baseCommit: 'a'.repeat(40) },
    releaseInput,
  }, 'case')
  const realRun = validatePlanningCandidate({
    ...good,
    schemaVersion: 1,
    executionKind: 'real_model',
    provenance: {
      caseId: 'case',
      repositoryBaseCommit: 'a'.repeat(40),
      planningOperationId: 'operation-1',
      planningOperationDigest: digest,
      ...releaseInput,
      startedAt: '2026-09-06T00:00:00.000Z',
      completedAt: '2026-09-06T00:01:00.000Z',
    },
  }, 'case', 'run.json')
  assert.deepEqual(planningReleaseProvenanceFailures(releaseGold, realRun), [])

  const forged = structuredClone(realRun)
  forged.provenance.repositoryDigest = 'b'.repeat(64)
  assert.deepEqual(planningReleaseProvenanceFailures(releaseGold, forged), ['case/run repositoryDigest does not match Gold.'])
  assert.throws(() => validatePlanningCandidate({ ...good, schemaVersion: 1, executionKind: 'real_model' }, 'case', 'forged.json'), /provenance must be an object/)
})

test('release canary requires a converged Source-to-Convergence evidence chain', () => {
  const digest = 'a'.repeat(64)
  const canary = {
    schemaVersion: 1,
    releaseVersion: '1.7.0',
    planningContractVersion: 3,
    projectKey: 'redacted-project',
    planningOperationId: 'operation-1',
    planningOperationDigest: digest,
    sourceSnapshotDigest: digest,
    planSnapshotId: 'plan-1',
    planSnapshotDigest: digest,
    approvalId: 'approval-1',
    approvalDigest: digest,
    executionDispatches: [{ id: 'dispatch-1', digest }],
    taskRunCount: 1,
    deliveryIntegrationSnapshotId: 'integration-1',
    deliveryIntegrationDigest: digest,
    finalCommit: 'b'.repeat(40),
    convergenceReviewId: 'review-1',
    convergenceReviewDigest: digest,
    outcome: 'converged',
    falseReady: false,
    falseConverged: false,
    requiredRequirementCoverage: 1,
    requiredAcceptanceCoverage: 1,
    evidenceRecordIds: ['evidence-1'],
    evidenceBundleDigest: digest,
    startedAt: '2026-09-06T00:00:00.000Z',
    completedAt: '2026-09-06T00:10:00.000Z',
  }
  assert.equal(validatePlanningCanary(canary, '1.7.0').outcome, 'converged')
  assert.equal(validatePlanningCanary({ ...canary, executionDispatches: [...canary.executionDispatches, { id: 'dispatch-2', digest }] }, '1.7.0').executionDispatches.length, 2)
  assert.throws(() => validatePlanningCanary({ ...canary, executionDispatches: [...canary.executionDispatches, ...canary.executionDispatches] }, '1.7.0'), /must not contain duplicate ids/)
  assert.throws(() => validatePlanningCanary({ ...canary, falseConverged: true }, '1.7.0'), /falseConverged must be false/)
  assert.throws(() => validatePlanningCanary(canary, '1.8.0'), /must match package version/)
})

test('evaluation contracts reject dangling Bindings and duplicate Assignments before grading', () => {
  const candidate = { ...structuredClone(good), schemaVersion: 1, executionKind: 'fixture' }
  candidate.bindings[0].requirementKey = 'REQ-MISSING'
  assert.throws(() => validatePlanningCandidate(candidate, 'case', 'dangling.json'), /must reference a candidate Requirement/)

  const duplicate = { ...structuredClone(good), schemaVersion: 1, executionKind: 'fixture' }
  duplicate.assignments.push(structuredClone(duplicate.assignments[0]))
  assert.throws(() => validatePlanningCandidate(duplicate, 'case', 'duplicate.json'), /assignmentTaskKeys must not contain duplicates/)
})
