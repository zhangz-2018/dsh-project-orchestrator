import assert from 'node:assert/strict'
import { copyFile, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises'
import { execFile } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import test from 'node:test'
import {
  planningGoldDigest,
  planningMetricPolicyDigest,
  planningReleaseProvenanceFailures,
  validatePlanningCandidate,
  validatePlanningCanary,
  validatePlanningEvalManifest,
  validatePlanningGold,
} from '../planning-evals/contracts.mjs'
import { gradePlanningRun, summarizePlanningGrades } from '../planning-evals/grader.mjs'

const gold = {
  id: 'case',
  requiredRequirementKeys: ['REQ-1'],
  requiredAcceptanceKeys: ['AC-1'],
  allowedBindingOwnerPathsByRequirement: { 'REQ-1': [['src/owner.ts']] },
  assignmentExpectations: {
    implementation: { taskKey: 'TASK-1', hasEligibleMember: true, allowedAgentIds: ['agent-1'] },
    verification: { taskKey: 'TASK-2', hasEligibleMember: false, allowedAgentIds: [] },
  },
}
const good = {
  runId: 'run',
  status: 'ready',
  repositoryEvidenceIds: ['src/owner.ts'],
  requirements: [{ key: 'REQ-1' }],
  decisions: [],
  bindings: [{ requirementKey: 'REQ-1', evidenceIds: ['src/owner.ts'], ownerPaths: ['src/owner.ts'] }],
  tasks: [
    { key: 'TASK-1', acceptanceKeys: ['AC-1'], contextComplete: true, verificationCommandIds: ['test'] },
    { key: 'TASK-2', acceptanceKeys: ['AC-1'], contextComplete: true, verificationCommandIds: ['test'] },
  ],
  assignments: [
    { taskKey: 'TASK-1', outcome: 'selected', agentId: 'agent-1' },
    { taskKey: 'TASK-2', outcome: 'blocked' },
  ],
  substantiveRewriteRequired: false,
}

function v2Gold(expectedReadiness, expectedBlockingReasons = []) {
  const value = {
    ...structuredClone(gold),
    schemaVersion: 2,
    repository: { fixture: 'fixture', baseCommit: 'fixture-generated' },
    expectedReadiness,
    expectedBlockingReasons,
    requiredEvidenceStages: ['repository', 'requirements', 'decisions', 'bindings', 'tasks', 'assignments', 'preflight'],
    review: { reviewer: 'independent-reviewer', reviewedAt: '2026-09-22T00:00:00.000Z', rationale: 'Frozen expected outcome.', goldDigest: '0'.repeat(64) },
  }
  if (expectedReadiness === 'ready') {
    value.assignmentExpectations.verification = { taskKey: 'TASK-2', hasEligibleMember: true, allowedAgentIds: ['agent-2'] }
  }
  value.review.goldDigest = planningGoldDigest(value)
  return value
}

function v2Candidate(status, blockingReasons = [], allAssignable = status === 'ready') {
  const value = {
    ...structuredClone(good),
    schemaVersion: 2,
    executionKind: 'fixture',
    status,
    blockingReasons,
    reachedStage: 'preflight',
    completedStageEvidence: ['repository', 'requirements', 'decisions', 'bindings', 'tasks', 'assignments', 'preflight'].map((stage) => ({ stage, evidenceIds: [] })),
    humanReviewRefs: [],
  }
  if (allAssignable) value.assignments[1] = { taskKey: 'TASK-2', outcome: 'selected', agentId: 'agent-2' }
  return value
}

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
    schemaVersion: 2,
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
    verificationInvocations: [{ id: 'invocation-1', taskRunId: 'task-run-1', specId: 'spec-1', specDigest: digest, sourceStateDigest: digest, outputCommit: 'b'.repeat(40), outputTree: 'c'.repeat(40) }],
    verificationEvidence: [{ id: 'evidence-1', taskRunId: 'task-run-1', invocationId: 'invocation-1', evidenceDigest: digest, requiredScenarioIds: ['scenario-1'], scenarioResultCount: 1 }],
    humanDeliveryConfirmation: { projectReviewId: 'project-review-1', projectReviewDigest: digest, reviewDecision: 'approve', deliveryRecordId: 'delivery-1', deliveryRecordDigest: digest, deliveryStatus: 'delivered', deliveredBy: 'release-owner', deliveredAt: '2026-09-06T00:09:00.000Z' },
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
  const legacy = structuredClone(canary)
  legacy.schemaVersion = 1
  delete legacy.verificationInvocations
  delete legacy.verificationEvidence
  delete legacy.humanDeliveryConfirmation
  assert.equal(validatePlanningCanary(legacy, '1.7.0').schemaVersion, 1)
  assert.throws(() => validatePlanningCanary({ ...canary, verificationEvidence: undefined }, '1.7.0'), /verificationEvidence must contain exact-one item per TaskRun/)
  assert.throws(() => validatePlanningCanary({ ...canary, humanDeliveryConfirmation: undefined }, '1.7.0'), /humanDeliveryConfirmation must be an object/)
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

test('Gold V2 rejects an otherwise complete candidate that is incorrectly blocked', () => {
  const readyGold = validatePlanningGold(v2Gold('ready'), 'case')
  const blocked = validatePlanningCandidate(v2Candidate('blocked', [{ code: 'no_capacity', subjectKeys: ['TASK-1'] }], true), 'case', 'blocked.json')
  const grade = gradePlanningRun(readyGold, blocked)
  assert.equal(grade.metrics.falseBlockedRate, 1)
  assert.equal(grade.metrics.firstPassApprovableRate, 0)
  const aggregate = summarizePlanningGrades(Array.from({ length: 5 }, (_, index) => ({ ...grade, runId: `blocked-${index}` })))
  assert.equal(aggregate.passed, false)
  assert.ok(aggregate.thresholdFailures.includes('falseBlockedRate'))
  assert.ok(aggregate.thresholdFailures.includes('firstPassApprovableRate'))
})

test('Gold V2 scores normalized blocking reason facts and stage-aware early blocks', () => {
  const reason = { code: 'missing_decision', subjectKeys: ['REQ-1', 'DECISION-1'] }
  const blockedGoldValue = v2Gold('blocked', [reason])
  blockedGoldValue.requiredEvidenceStages = ['repository', 'requirements', 'decisions']
  blockedGoldValue.review.goldDigest = planningGoldDigest(blockedGoldValue)
  const blockedGold = validatePlanningGold(blockedGoldValue, 'case')
  const earlyCandidate = validatePlanningCandidate({
    schemaVersion: 2,
    runId: 'early-block',
    executionKind: 'fixture',
    status: 'blocked',
    blockingReasons: [{ code: 'missing_decision', subjectKeys: ['DECISION-1', 'REQ-1'] }],
    reachedStage: 'decisions',
    completedStageEvidence: ['repository', 'requirements', 'decisions'].map((stage) => ({ stage, evidenceIds: [] })),
    humanReviewRefs: ['review-1'],
    repositoryEvidenceIds: [],
    requirements: [{ key: 'REQ-1' }],
    decisions: [],
    substantiveRewriteRequired: false,
  }, 'case', 'early.json')
  const grade = gradePlanningRun(blockedGold, earlyCandidate)
  assert.equal(grade.metrics.blockingReasonPrecision, 1)
  assert.equal(grade.metrics.blockingReasonRecall, 1)
  assert.equal(grade.metrics.requiredEvidenceStageCoverage, 1)
  assert.equal(grade.metrics.requiredAcceptanceCoverage, null)
})

test('zero-denominator planning metrics are explicitly not applicable', () => {
  const blockedGold = validatePlanningGold(v2Gold('blocked', [{ code: 'missing_member', subjectKeys: ['TASK-1'] }]), 'case')
  const candidate = validatePlanningCandidate(v2Candidate('blocked', [{ code: 'missing_member', subjectKeys: ['TASK-1'] }]), 'case', 'blocked.json')
  const aggregate = summarizePlanningGrades([gradePlanningRun(blockedGold, candidate)], { requireFiveRuns: false })
  assert.equal(aggregate.metrics.falseBlockedRate, null)
  assert.deepEqual(aggregate.metricResults.falseBlockedRate, { numerator: 0, denominator: 0, value: null, applicability: 'not_applicable' })
  assert.ok(aggregate.thresholdFailures.includes('falseBlockedRate:not_applicable'))
})

test('evaluation manifest preserves failed attempts and binds frozen digests', () => {
  const policy = { id: 'policy-2', version: '2', digest: '0'.repeat(64), thresholds: { falseBlockedRate: { max: 0.1 }, modelFailureRate: { max: 0.2 } } }
  policy.digest = planningMetricPolicyDigest(policy)
  const goldValue = v2Gold('ready')
  const manifest = validatePlanningEvalManifest({
    schemaVersion: 1,
    batchId: 'batch-1',
    createdAt: '2026-09-22T00:00:00.000Z',
    metricPolicy: policy,
    cases: [{ caseId: 'case', goldDigest: planningGoldDigest(goldValue) }],
    attempts: [
      { caseId: 'case', attemptId: 'attempt-1', operationId: 'operation-1', outcome: 'candidate', candidateRef: 'cases/case/runs/run-1.json', startedAt: '2026-09-22T00:00:00.000Z', completedAt: '2026-09-22T00:01:00.000Z' },
      { caseId: 'case', attemptId: 'attempt-2', operationId: 'operation-2', outcome: 'model_failure', failureCode: 'provider_timeout', startedAt: '2026-09-22T00:02:00.000Z', completedAt: '2026-09-22T00:03:00.000Z' },
    ],
  })
  assert.equal(manifest.attempts.length, 2)
  const grade = gradePlanningRun(validatePlanningGold(goldValue, 'case'), validatePlanningCandidate(v2Candidate('ready'), 'case', 'ready.json'))
  const aggregate = summarizePlanningGrades([grade], { attempts: manifest.attempts, thresholds: { modelFailureRate: { max: 0.4 } }, requireFiveRuns: false })
  assert.equal(aggregate.metrics.modelFailureRate, 0.5)
  assert.equal(aggregate.passed, false)
  assert.ok(aggregate.thresholdFailures.includes('modelFailureRate'))

  const hiddenFailure = structuredClone(manifest)
  hiddenFailure.attempts = hiddenFailure.attempts.filter((attempt) => attempt.outcome === 'candidate')
  assert.equal(summarizePlanningGrades([grade], { attempts: hiddenFailure.attempts, thresholds: { modelFailureRate: { max: 0.4 } }, requireFiveRuns: false }).metrics.modelFailureRate, 0)
  const forgedPolicy = structuredClone(policy)
  forgedPolicy.thresholds.falseBlockedRate.max = 1
  assert.throws(() => validatePlanningEvalManifest({ ...manifest, metricPolicy: forgedPolicy }), /MetricPolicy content/)
})

test('release manifest refuses historical V1 candidates while accepting the V2 export contract', async () => {
  const directory = await realpath(await mkdtemp(join(tmpdir(), 'po-eval-release-v2-')))
  try {
    const root = join(directory, 'planning-evals')
    const caseRoot = join(root, 'cases/case')
    await mkdir(caseRoot, { recursive: true })
    for (const file of ['run.mjs', 'contracts.mjs', 'grader.mjs']) await copyFile(new URL(`../planning-evals/${file}`, import.meta.url), join(root, file))
    await writeFile(join(directory, 'package.json'), JSON.stringify({ version: '1.7.0', type: 'module' }))
    const policy = { id: 'policy', version: '1', digest: '0'.repeat(64), thresholds: { falseBlockedRate: { max: 0.1 }, modelFailureRate: { max: 0.2 } } }
    policy.digest = planningMetricPolicyDigest(policy)
    const releaseInput = { repositoryDigest: 'a'.repeat(64), sourceDigest: 'a'.repeat(64), teamCatalogDigest: 'a'.repeat(64), decisionInputDigest: 'a'.repeat(64), metricPolicyId: policy.id, metricPolicyVersion: policy.version, metricPolicyDigest: policy.digest, promptVersionsDigest: 'a'.repeat(64), modelProvider: 'unit-test', modelId: 'unit-test', modelVersion: '1', samplingConfigDigest: 'a'.repeat(64), inputTokenBudget: 1000, outputTokenBudget: 1000, toolCallBudget: 0 }
    const expected = v2Gold('ready')
    expected.repository = { identity: 'unit-test/repository', fixture: 'unit-test', baseCommit: 'a'.repeat(40) }
    expected.releaseInput = releaseInput
    expected.review.goldDigest = planningGoldDigest(expected)
    validatePlanningGold(expected, 'case')
    await writeFile(join(caseRoot, 'gold.json'), JSON.stringify(expected))
    const candidate = { ...structuredClone(good), schemaVersion: 1, executionKind: 'real_model', provenance: { ...releaseInput, caseId: 'case', repositoryBaseCommit: 'a'.repeat(40), planningOperationId: 'test-operation', planningOperationDigest: 'a'.repeat(64), startedAt: '2026-09-22T00:00:00.000Z', completedAt: '2026-09-22T00:01:00.000Z' } }
    const candidatePath = join(caseRoot, 'candidate.json')
    await writeFile(candidatePath, JSON.stringify(candidate))
    const manifestPath = join(root, 'manifest.json')
    await writeFile(manifestPath, JSON.stringify({ schemaVersion: 1, batchId: 'unit-test', createdAt: '2026-09-22T00:00:00.000Z', metricPolicy: policy, cases: [{ caseId: 'case', goldDigest: planningGoldDigest(expected) }], attempts: [{ caseId: 'case', attemptId: 'test-attempt', operationId: 'test-operation', outcome: 'candidate', candidateRef: 'cases/case/candidate.json', startedAt: candidate.provenance.startedAt, completedAt: candidate.provenance.completedAt }] }))
    const output = join(directory, 'report.json')
    const run = async () => {
      await assert.rejects(promisify(execFile)(process.execPath, [join(root, 'run.mjs'), '--release', '--manifest', manifestPath, '--output', output]), (error) => { assert.equal(error.code, 1); assert.equal(error.stderr, ''); return true })
      return JSON.parse(await readFile(output, 'utf8'))
    }
    const historical = await run()
    assert.equal(historical.releaseQualification.failures.some((item) => item.includes('must reference a V2 candidate with pre-model frozen input')), true)
    await writeFile(candidatePath, JSON.stringify({ ...v2Candidate('ready'), executionKind: 'real_model', provenance: candidate.provenance }))
    const current = await run()
    assert.equal(current.releaseQualification.failures.some((item) => item.includes('must reference a V2 candidate with pre-model frozen input')), false)
    assert.equal(current.validCandidateCount, 1)
    assert.equal(current.releaseQualification.passed, false, 'one synthetic unit-test case must never qualify a release')
  } finally { await rm(directory, { recursive: true, force: true }) }
})

test('explicit local case selection keeps incomplete history visible and cannot narrow a release', async () => {
  const directory = await realpath(await mkdtemp(join(tmpdir(), 'po-eval-local-subset-')))
  try {
    const root = join(directory, 'planning-evals')
    const fixture = 'large-typescript-owner'
    await mkdir(join(root, 'cases', fixture, 'runs'), { recursive: true })
    await mkdir(join(root, 'cases', 'unfinished-history'), { recursive: true })
    for (const file of ['run.mjs', 'contracts.mjs', 'grader.mjs']) await copyFile(new URL(`../planning-evals/${file}`, import.meta.url), join(root, file))
    await writeFile(join(directory, 'package.json'), JSON.stringify({ version: '1.7.0', type: 'module' }))
    for (const file of ['gold.json', ...[1, 2, 3, 4, 5].map((i) => `runs/run-${i}.json`)]) await copyFile(new URL(`../planning-evals/cases/${fixture}/${file}`, import.meta.url), join(root, 'cases', fixture, file))
    const historical = JSON.parse(await readFile(join(root, 'cases', fixture, 'gold.json'), 'utf8'))
    historical.id = 'unfinished-history'
    await writeFile(join(root, 'cases', 'unfinished-history', 'gold.json'), JSON.stringify(historical))
    const run = (args) => promisify(execFile)(process.execPath, [join(root, 'run.mjs'), ...args])
    await assert.rejects(run([]), /unfinished-history\/runs/)
    const output = join(directory, 'subset.json')
    await run(['--cases', fixture, '--output', output])
    const report = JSON.parse(await readFile(output, 'utf8'))
    assert.equal(report.corpusCaseCount, 1)
    assert.equal(report.validCandidateCount, 5)
    assert.equal(report.aggregate.passed, true)
    assert.equal(report.releaseQualification.passed, false)
    await assert.rejects(run(['--cases', 'unfinished-history']), /unfinished-history\/runs/)
    await assert.rejects(run(['--cases', fixture, '--release']), /Cannot select individual cases for a release manifest/)
    await assert.rejects(run(['--cases', fixture, '--manifest', join(root, 'manifest.json')]), /Cannot select individual cases for a release manifest/)
    await assert.rejects(run(['--cases', 'missing']), /Unknown evaluation case/)
  } finally { await rm(directory, { recursive: true, force: true }) }
})

test('Gold V2 self-digest changes when reviewed expectations drift', () => {
  const value = v2Gold('ready')
  assert.equal(validatePlanningGold(value, 'case').expectedReadiness, 'ready')
  value.expectedReadiness = 'blocked'
  value.expectedBlockingReasons = [{ code: 'changed', subjectKeys: [] }]
  assert.throws(() => validatePlanningGold(value, 'case'), /goldDigest does not match/)
})
