import { createHash } from 'node:crypto'

const SHA256 = /^[0-9a-f]{64}$/u
const GIT_OBJECT_ID = /^[0-9a-f]{40,64}$/u

export const PLANNING_EVIDENCE_STAGES = ['repository', 'requirements', 'decisions', 'bindings', 'tasks', 'assignments', 'preflight']

function invariant(condition, message) {
  if (!condition) throw new Error(message)
}

function object(value, label) {
  invariant(value !== null && typeof value === 'object' && !Array.isArray(value), `${label} must be an object.`)
  return value
}

function string(value, label) {
  invariant(typeof value === 'string' && value.trim() !== '', `${label} must be a non-empty string.`)
  return value
}

function stringArray(value, label, { nonempty = false } = {}) {
  invariant(Array.isArray(value) && (!nonempty || value.length > 0), `${label} must be ${nonempty ? 'a non-empty' : 'an'} array.`)
  for (const [index, item] of value.entries()) string(item, `${label}[${index}]`)
  invariant(new Set(value).size === value.length, `${label} must not contain duplicates.`)
  return value
}

function sha256(value, label) {
  invariant(typeof value === 'string' && SHA256.test(value), `${label} must be a lowercase SHA-256 digest.`)
  return value
}

function timestamp(value, label) {
  string(value, label)
  invariant(Number.isFinite(Date.parse(value)), `${label} must be an ISO-compatible timestamp.`)
  return value
}

function exactKeys(value, allowedKeys, label) {
  const unknown = Object.keys(value).filter((key) => !allowedKeys.includes(key))
  invariant(unknown.length === 0, `${label} contains unknown fields: ${unknown.join(', ')}.`)
}

function enumValue(value, allowed, label) {
  invariant(allowed.includes(value), `${label} must be one of: ${allowed.join(', ')}.`)
  return value
}

function validateBlockingReasons(value, label, { nonempty = false } = {}) {
  invariant(Array.isArray(value) && (!nonempty || value.length > 0), `${label} must be ${nonempty ? 'a non-empty' : 'an'} array.`)
  const identities = []
  for (const [index, rawReason] of value.entries()) {
    const reason = object(rawReason, `${label}[${index}]`)
    exactKeys(reason, ['code', 'subjectKeys'], `${label}[${index}]`)
    const code = string(reason.code, `${label}[${index}].code`)
    const subjectKeys = stringArray(reason.subjectKeys, `${label}[${index}].subjectKeys`)
    identities.push(`${code}\u0000${[...subjectKeys].sort().join('\u0000')}`)
  }
  invariant(new Set(identities).size === identities.length, `${label} must not contain duplicate reason facts.`)
  return value
}

function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`
  if (value !== null && typeof value === 'object') return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(',')}}`
  return JSON.stringify(value)
}

export function planningGoldDigest(raw) {
  const value = structuredClone(raw)
  if (value?.review && typeof value.review === 'object') delete value.review.goldDigest
  return createHash('sha256').update(stableJson(value)).digest('hex')
}

export function planningMetricPolicyDigest(raw) {
  const value = structuredClone(raw)
  if (value && typeof value === 'object') delete value.digest
  return createHash('sha256').update(stableJson(value)).digest('hex')
}

const RELEASE_INPUT_FIELDS = [
  'repositoryDigest',
  'sourceDigest',
  'teamCatalogDigest',
  'decisionInputDigest',
  'metricPolicyDigest',
  'promptVersionsDigest',
]

function validateReleaseInput(value, label) {
  const input = object(value, label)
  for (const field of RELEASE_INPUT_FIELDS) sha256(input[field], `${label}.${field}`)
  string(input.metricPolicyId, `${label}.metricPolicyId`)
  string(input.metricPolicyVersion, `${label}.metricPolicyVersion`)
  string(input.modelProvider, `${label}.modelProvider`)
  string(input.modelId, `${label}.modelId`)
  string(input.modelVersion, `${label}.modelVersion`)
  sha256(input.samplingConfigDigest, `${label}.samplingConfigDigest`)
  invariant(Number.isInteger(input.inputTokenBudget) && input.inputTokenBudget > 0, `${label}.inputTokenBudget must be a positive integer.`)
  invariant(Number.isInteger(input.outputTokenBudget) && input.outputTokenBudget > 0, `${label}.outputTokenBudget must be a positive integer.`)
  invariant(Number.isInteger(input.toolCallBudget) && input.toolCallBudget >= 0, `${label}.toolCallBudget must be a non-negative integer.`)
  return input
}

export function validatePlanningGold(raw, caseName = 'unknown') {
  const label = `Gold case ${caseName}`
  const gold = object(raw, label)
  invariant(gold.schemaVersion === 1 || gold.schemaVersion === 2, `${label}.schemaVersion must equal 1 or 2.`)
  invariant(string(gold.id, `${label}.id`) === caseName, `${label}.id must match its directory name.`)
  const repository = object(gold.repository, `${label}.repository`)
  string(repository.fixture, `${label}.repository.fixture`)
  string(repository.baseCommit, `${label}.repository.baseCommit`)
  const requirementKeys = stringArray(gold.requiredRequirementKeys, `${label}.requiredRequirementKeys`, { nonempty: true })
  stringArray(gold.requiredAcceptanceKeys, `${label}.requiredAcceptanceKeys`, { nonempty: true })
  const ownerAlternatives = object(gold.allowedBindingOwnerPathsByRequirement, `${label}.allowedBindingOwnerPathsByRequirement`)
  for (const requirementKey of requirementKeys) {
    const alternatives = ownerAlternatives[requirementKey]
    invariant(Array.isArray(alternatives) && alternatives.length > 0, `${label} requires at least one owner alternative for ${requirementKey}.`)
    for (const [index, paths] of alternatives.entries()) stringArray(paths, `${label}.allowedBindingOwnerPathsByRequirement.${requirementKey}[${index}]`, { nonempty: true })
  }
  const assignments = object(gold.assignmentExpectations, `${label}.assignmentExpectations`)
  const taskKeys = []
  for (const [key, rawExpectation] of Object.entries(assignments)) {
    const expectation = object(rawExpectation, `${label}.assignmentExpectations.${key}`)
    taskKeys.push(string(expectation.taskKey, `${label}.assignmentExpectations.${key}.taskKey`))
    invariant(typeof expectation.hasEligibleMember === 'boolean', `${label}.assignmentExpectations.${key}.hasEligibleMember must be boolean.`)
    const owners = stringArray(expectation.allowedAgentIds, `${label}.assignmentExpectations.${key}.allowedAgentIds`)
    invariant(expectation.hasEligibleMember === (owners.length > 0), `${label}.assignmentExpectations.${key} eligibility must agree with allowedAgentIds.`)
  }
  invariant(new Set(taskKeys).size === taskKeys.length, `${label}.assignmentExpectations must not repeat taskKey values.`)
  if (gold.releaseInput !== undefined) {
    string(repository.identity, `${label}.repository.identity`)
    invariant(GIT_OBJECT_ID.test(repository.baseCommit), `${label}.repository.baseCommit must be a frozen Git object id for release qualification.`)
    validateReleaseInput(gold.releaseInput, `${label}.releaseInput`)
  }
  if (gold.schemaVersion === 2) {
    enumValue(gold.expectedReadiness, ['ready', 'blocked'], `${label}.expectedReadiness`)
    validateBlockingReasons(gold.expectedBlockingReasons, `${label}.expectedBlockingReasons`, { nonempty: gold.expectedReadiness === 'blocked' })
    invariant(gold.expectedReadiness !== 'ready' || gold.expectedBlockingReasons.length === 0, `${label}.expectedBlockingReasons must be empty when expectedReadiness is ready.`)
    const stages = stringArray(gold.requiredEvidenceStages, `${label}.requiredEvidenceStages`, { nonempty: true })
    for (const [index, stage] of stages.entries()) enumValue(stage, PLANNING_EVIDENCE_STAGES, `${label}.requiredEvidenceStages[${index}]`)
    if (gold.pairedCaseId !== undefined) string(gold.pairedCaseId, `${label}.pairedCaseId`)
    const review = object(gold.review, `${label}.review`)
    exactKeys(review, ['reviewer', 'reviewedAt', 'rationale', 'goldDigest'], `${label}.review`)
    string(review.reviewer, `${label}.review.reviewer`)
    timestamp(review.reviewedAt, `${label}.review.reviewedAt`)
    string(review.rationale, `${label}.review.rationale`)
    sha256(review.goldDigest, `${label}.review.goldDigest`)
    invariant(review.goldDigest === planningGoldDigest(gold), `${label}.review.goldDigest does not match the Gold content.`)
  }
  return gold
}

export function validatePlanningCandidate(raw, caseName = 'unknown', runName = 'unknown') {
  const label = `Planning run ${caseName}/${runName}`
  const candidate = { ...object(raw, label) }
  invariant(candidate.schemaVersion === 1 || candidate.schemaVersion === 2, `${label}.schemaVersion must equal 1 or 2.`)
  string(candidate.runId, `${label}.runId`)
  invariant(candidate.executionKind === 'fixture' || candidate.executionKind === 'real_model', `${label}.executionKind must be fixture or real_model.`)
  invariant(candidate.status === 'ready' || candidate.status === 'blocked', `${label}.status must be ready or blocked.`)
  if (candidate.schemaVersion === 2) {
    validateBlockingReasons(candidate.blockingReasons, `${label}.blockingReasons`, { nonempty: candidate.status === 'blocked' })
    invariant(candidate.status !== 'ready' || candidate.blockingReasons.length === 0, `${label}.blockingReasons must be empty when status is ready.`)
    const reachedStage = enumValue(candidate.reachedStage, PLANNING_EVIDENCE_STAGES, `${label}.reachedStage`)
    invariant(candidate.status !== 'ready' || reachedStage === 'preflight', `${label}.reachedStage must be preflight when status is ready.`)
    invariant(Array.isArray(candidate.completedStageEvidence), `${label}.completedStageEvidence must be an array.`)
    const stageNames = []
    for (const [index, rawStage] of candidate.completedStageEvidence.entries()) {
      const stage = object(rawStage, `${label}.completedStageEvidence[${index}]`)
      exactKeys(stage, ['stage', 'evidenceIds'], `${label}.completedStageEvidence[${index}]`)
      const stageName = enumValue(stage.stage, PLANNING_EVIDENCE_STAGES, `${label}.completedStageEvidence[${index}].stage`)
      invariant(PLANNING_EVIDENCE_STAGES.indexOf(stageName) <= PLANNING_EVIDENCE_STAGES.indexOf(reachedStage), `${label}.completedStageEvidence[${index}].stage is after reachedStage.`)
      stringArray(stage.evidenceIds, `${label}.completedStageEvidence[${index}].evidenceIds`)
      stageNames.push(stageName)
    }
    invariant(new Set(stageNames).size === stageNames.length, `${label}.completedStageEvidence must not repeat stages.`)
    stringArray(candidate.humanReviewRefs, `${label}.humanReviewRefs`)
  }
  stringArray(candidate.repositoryEvidenceIds, `${label}.repositoryEvidenceIds`)
  const reachedStageIndex = candidate.schemaVersion === 2 ? PLANNING_EVIDENCE_STAGES.indexOf(candidate.reachedStage) : PLANNING_EVIDENCE_STAGES.length - 1
  const requiresStage = (stage) => reachedStageIndex >= PLANNING_EVIDENCE_STAGES.indexOf(stage)
  invariant(Array.isArray(candidate.requirements) || !requiresStage('requirements'), `${label}.requirements must be an array once requirements is reached.`)
  candidate.requirements ??= []
  const requirementKeys = stringArray(candidate.requirements.map((item, index) => string(object(item, `${label}.requirements[${index}]`).key, `${label}.requirements[${index}].key`)), `${label}.requirementKeys`)
  const requirementKeySet = new Set(requirementKeys)
  invariant(Array.isArray(candidate.decisions) || !requiresStage('decisions'), `${label}.decisions must be an array once decisions is reached.`)
  candidate.decisions ??= []
  for (const [index, rawDecision] of candidate.decisions.entries()) {
    const decision = object(rawDecision, `${label}.decisions[${index}]`)
    invariant(['low', 'medium', 'high', 'critical'].includes(decision.impact), `${label}.decisions[${index}].impact is invalid.`)
    invariant(['pending', 'resolved', 'superseded'].includes(decision.status), `${label}.decisions[${index}].status is invalid.`)
  }
  invariant(Array.isArray(candidate.bindings) || !requiresStage('bindings'), `${label}.bindings must be an array once bindings is reached.`)
  candidate.bindings ??= []
  for (const [index, rawBinding] of candidate.bindings.entries()) {
    const binding = object(rawBinding, `${label}.bindings[${index}]`)
    string(binding.requirementKey, `${label}.bindings[${index}].requirementKey`)
    invariant(requirementKeySet.has(binding.requirementKey), `${label}.bindings[${index}].requirementKey must reference a candidate Requirement.`)
    stringArray(binding.evidenceIds, `${label}.bindings[${index}].evidenceIds`)
    stringArray(binding.ownerPaths, `${label}.bindings[${index}].ownerPaths`)
  }
  invariant(Array.isArray(candidate.tasks) || !requiresStage('tasks'), `${label}.tasks must be an array once tasks is reached.`)
  candidate.tasks ??= []
  const taskKeys = stringArray(candidate.tasks.map((rawTask, index) => {
    const task = object(rawTask, `${label}.tasks[${index}]`)
    stringArray(task.acceptanceKeys, `${label}.tasks[${index}].acceptanceKeys`)
    invariant(typeof task.contextComplete === 'boolean', `${label}.tasks[${index}].contextComplete must be boolean.`)
    stringArray(task.verificationCommandIds, `${label}.tasks[${index}].verificationCommandIds`)
    return string(task.key, `${label}.tasks[${index}].key`)
  }), `${label}.taskKeys`)
  const taskKeySet = new Set(taskKeys)
  invariant(Array.isArray(candidate.assignments) || !requiresStage('assignments'), `${label}.assignments must be an array once assignments is reached.`)
  candidate.assignments ??= []
  stringArray(candidate.assignments.map((rawAssignment, index) => {
    const assignment = object(rawAssignment, `${label}.assignments[${index}]`)
    const taskKey = string(assignment.taskKey, `${label}.assignments[${index}].taskKey`)
    invariant(taskKeySet.has(taskKey), `${label}.assignments[${index}].taskKey must reference a candidate Task.`)
    invariant(assignment.outcome === 'selected' || assignment.outcome === 'blocked', `${label}.assignments[${index}].outcome must be selected or blocked.`)
    if (assignment.outcome === 'selected') string(assignment.agentId, `${label}.assignments[${index}].agentId`)
    else invariant(assignment.agentId === undefined, `${label}.assignments[${index}] blocked assignment cannot select an Agent.`)
    return taskKey
  }), `${label}.assignmentTaskKeys`)
  invariant(typeof candidate.substantiveRewriteRequired === 'boolean', `${label}.substantiveRewriteRequired must be boolean.`)
  if (candidate.executionKind === 'fixture') {
    invariant(candidate.provenance === undefined, `${label} fixture runs cannot carry real-model provenance.`)
    return candidate
  }

  const provenance = object(candidate.provenance, `${label}.provenance`)
  invariant(string(provenance.caseId, `${label}.provenance.caseId`) === caseName, `${label}.provenance.caseId must match its directory name.`)
  string(provenance.repositoryBaseCommit, `${label}.provenance.repositoryBaseCommit`)
  string(provenance.planningOperationId, `${label}.provenance.planningOperationId`)
  sha256(provenance.planningOperationDigest, `${label}.provenance.planningOperationDigest`)
  validateReleaseInput(provenance, `${label}.provenance`)
  timestamp(provenance.startedAt, `${label}.provenance.startedAt`)
  timestamp(provenance.completedAt, `${label}.provenance.completedAt`)
  invariant(Date.parse(provenance.completedAt) >= Date.parse(provenance.startedAt), `${label}.provenance.completedAt must not precede startedAt.`)
  return candidate
}

export function validatePlanningEvalManifest(raw, label = 'Planning evaluation manifest') {
  const manifest = object(raw, label)
  invariant(manifest.schemaVersion === 1, `${label}.schemaVersion must equal 1.`)
  string(manifest.batchId, `${label}.batchId`)
  timestamp(manifest.createdAt, `${label}.createdAt`)
  const policy = object(manifest.metricPolicy, `${label}.metricPolicy`)
  exactKeys(policy, ['id', 'version', 'digest', 'thresholds'], `${label}.metricPolicy`)
  string(policy.id, `${label}.metricPolicy.id`)
  string(policy.version, `${label}.metricPolicy.version`)
  sha256(policy.digest, `${label}.metricPolicy.digest`)
  const thresholds = object(policy.thresholds, `${label}.metricPolicy.thresholds`)
  for (const [metric, rawThreshold] of Object.entries(thresholds)) {
    const threshold = object(rawThreshold, `${label}.metricPolicy.thresholds.${metric}`)
    exactKeys(threshold, ['min', 'max'], `${label}.metricPolicy.thresholds.${metric}`)
    invariant(('min' in threshold) !== ('max' in threshold), `${label}.metricPolicy.thresholds.${metric} must define exactly one of min or max.`)
    const value = threshold.min ?? threshold.max
    invariant(typeof value === 'number' && Number.isFinite(value), `${label}.metricPolicy.thresholds.${metric} must be finite.`)
  }
  invariant(policy.digest === planningMetricPolicyDigest(policy), `${label}.metricPolicy.digest does not match the MetricPolicy content.`)
  invariant(Array.isArray(manifest.cases) && manifest.cases.length > 0, `${label}.cases must be a non-empty array.`)
  const caseIds = []
  for (const [index, rawCase] of manifest.cases.entries()) {
    const entry = object(rawCase, `${label}.cases[${index}]`)
    exactKeys(entry, ['caseId', 'goldDigest'], `${label}.cases[${index}]`)
    caseIds.push(string(entry.caseId, `${label}.cases[${index}].caseId`))
    sha256(entry.goldDigest, `${label}.cases[${index}].goldDigest`)
  }
  invariant(new Set(caseIds).size === caseIds.length, `${label}.cases must not repeat caseId values.`)
  const caseIdSet = new Set(caseIds)
  invariant(Array.isArray(manifest.attempts) && manifest.attempts.length > 0, `${label}.attempts must be a non-empty array.`)
  const attemptIds = []
  for (const [index, rawAttempt] of manifest.attempts.entries()) {
    const attempt = object(rawAttempt, `${label}.attempts[${index}]`)
    exactKeys(attempt, ['caseId', 'attemptId', 'operationId', 'outcome', 'candidateRef', 'failureCode', 'startedAt', 'completedAt'], `${label}.attempts[${index}]`)
    invariant(caseIdSet.has(string(attempt.caseId, `${label}.attempts[${index}].caseId`)), `${label}.attempts[${index}].caseId must reference manifest.cases.`)
    attemptIds.push(string(attempt.attemptId, `${label}.attempts[${index}].attemptId`))
    const outcome = enumValue(attempt.outcome, ['candidate', 'model_failure', 'infrastructure_failure', 'cancelled'], `${label}.attempts[${index}].outcome`)
    if (attempt.operationId !== undefined) string(attempt.operationId, `${label}.attempts[${index}].operationId`)
    if (outcome === 'candidate') {
      string(attempt.candidateRef, `${label}.attempts[${index}].candidateRef`)
      invariant(attempt.failureCode === undefined, `${label}.attempts[${index}].failureCode is not allowed for candidate outcomes.`)
    } else {
      string(attempt.failureCode, `${label}.attempts[${index}].failureCode`)
      invariant(attempt.candidateRef === undefined, `${label}.attempts[${index}].candidateRef is only allowed for candidate outcomes.`)
    }
    timestamp(attempt.startedAt, `${label}.attempts[${index}].startedAt`)
    timestamp(attempt.completedAt, `${label}.attempts[${index}].completedAt`)
    invariant(Date.parse(attempt.completedAt) >= Date.parse(attempt.startedAt), `${label}.attempts[${index}].completedAt must not precede startedAt.`)
  }
  invariant(new Set(attemptIds).size === attemptIds.length, `${label}.attempts must not repeat attemptId values.`)
  return manifest
}

export function planningReleaseProvenanceFailures(gold, candidate, runName = candidate.runId) {
  if (candidate.executionKind !== 'real_model') return []
  const failures = []
  if (gold.releaseInput === undefined) return [`Gold case ${gold.id} has no frozen releaseInput for real-model qualification.`]
  if (candidate.provenance.repositoryBaseCommit !== gold.repository.baseCommit) failures.push(`${gold.id}/${runName} repositoryBaseCommit does not match Gold.`)
  for (const field of [...RELEASE_INPUT_FIELDS, 'metricPolicyId', 'metricPolicyVersion', 'modelProvider', 'modelId', 'modelVersion', 'samplingConfigDigest', 'inputTokenBudget', 'outputTokenBudget', 'toolCallBudget']) {
    if (candidate.provenance[field] !== gold.releaseInput[field]) failures.push(`${gold.id}/${runName} ${field} does not match Gold.`)
  }
  return failures
}

export function validatePlanningCanary(raw, expectedReleaseVersion) {
  const label = 'Planning release canary'
  const report = object(raw, label)
  invariant(report.schemaVersion === 1 || report.schemaVersion === 2, `${label}.schemaVersion must equal 1 or 2.`)
  invariant(string(report.releaseVersion, `${label}.releaseVersion`) === expectedReleaseVersion, `${label}.releaseVersion must match package version ${expectedReleaseVersion}.`)
  invariant(report.planningContractVersion === 3, `${label}.planningContractVersion must equal 3.`)
  string(report.projectKey, `${label}.projectKey`)
  for (const field of ['planningOperationId', 'planSnapshotId', 'approvalId', 'deliveryIntegrationSnapshotId', 'convergenceReviewId']) string(report[field], `${label}.${field}`)
  for (const field of ['planningOperationDigest', 'sourceSnapshotDigest', 'planSnapshotDigest', 'approvalDigest', 'deliveryIntegrationDigest', 'convergenceReviewDigest', 'evidenceBundleDigest']) sha256(report[field], `${label}.${field}`)
  invariant(Array.isArray(report.executionDispatches) && report.executionDispatches.length > 0, `${label}.executionDispatches must be a non-empty array.`)
  const dispatchIds = []
  for (const [index, rawDispatch] of report.executionDispatches.entries()) {
    const dispatch = object(rawDispatch, `${label}.executionDispatches[${index}]`)
    dispatchIds.push(string(dispatch.id, `${label}.executionDispatches[${index}].id`))
    sha256(dispatch.digest, `${label}.executionDispatches[${index}].digest`)
  }
  invariant(new Set(dispatchIds).size === dispatchIds.length, `${label}.executionDispatches must not contain duplicate ids.`)
  invariant(typeof report.finalCommit === 'string' && GIT_OBJECT_ID.test(report.finalCommit), `${label}.finalCommit must be a Git object id.`)
  invariant(report.outcome === 'converged', `${label}.outcome must be converged.`)
  invariant(report.falseReady === false, `${label}.falseReady must be false.`)
  invariant(report.falseConverged === false, `${label}.falseConverged must be false.`)
  invariant(report.requiredRequirementCoverage === 1, `${label}.requiredRequirementCoverage must equal 1.`)
  invariant(report.requiredAcceptanceCoverage === 1, `${label}.requiredAcceptanceCoverage must equal 1.`)
  invariant(Number.isInteger(report.taskRunCount) && report.taskRunCount > 0, `${label}.taskRunCount must be a positive integer.`)
  if (report.schemaVersion === 2) {
    invariant(Array.isArray(report.verificationInvocations) && report.verificationInvocations.length === report.taskRunCount, `${label}.verificationInvocations must contain exact-one item per TaskRun.`)
    const invocationIds = []
    const invocationTaskRunIds = []
    for (const [index, rawInvocation] of report.verificationInvocations.entries()) {
      const invocation = object(rawInvocation, `${label}.verificationInvocations[${index}]`)
      invocationIds.push(string(invocation.id, `${label}.verificationInvocations[${index}].id`))
      invocationTaskRunIds.push(string(invocation.taskRunId, `${label}.verificationInvocations[${index}].taskRunId`))
      string(invocation.specId, `${label}.verificationInvocations[${index}].specId`)
      for (const field of ['specDigest', 'sourceStateDigest']) sha256(invocation[field], `${label}.verificationInvocations[${index}].${field}`)
      invariant(typeof invocation.outputCommit === 'string' && GIT_OBJECT_ID.test(invocation.outputCommit), `${label}.verificationInvocations[${index}].outputCommit must be a Git object id.`)
      invariant(typeof invocation.outputTree === 'string' && GIT_OBJECT_ID.test(invocation.outputTree), `${label}.verificationInvocations[${index}].outputTree must be a Git object id.`)
      if (invocation.reportDigest !== undefined) sha256(invocation.reportDigest, `${label}.verificationInvocations[${index}].reportDigest`)
    }
    invariant(new Set(invocationIds).size === invocationIds.length, `${label}.verificationInvocations must not contain duplicate ids.`)
    invariant(new Set(invocationTaskRunIds).size === invocationTaskRunIds.length, `${label}.verificationInvocations must not repeat TaskRuns.`)
    invariant(Array.isArray(report.verificationEvidence) && report.verificationEvidence.length === report.taskRunCount, `${label}.verificationEvidence must contain exact-one item per TaskRun.`)
    const evidenceTaskRunIds = []
    for (const [index, rawEvidence] of report.verificationEvidence.entries()) {
      const evidence = object(rawEvidence, `${label}.verificationEvidence[${index}]`)
      string(evidence.id, `${label}.verificationEvidence[${index}].id`)
      evidenceTaskRunIds.push(string(evidence.taskRunId, `${label}.verificationEvidence[${index}].taskRunId`))
      string(evidence.invocationId, `${label}.verificationEvidence[${index}].invocationId`)
      sha256(evidence.evidenceDigest, `${label}.verificationEvidence[${index}].evidenceDigest`)
      stringArray(evidence.requiredScenarioIds, `${label}.verificationEvidence[${index}].requiredScenarioIds`)
      invariant(Number.isInteger(evidence.scenarioResultCount) && evidence.scenarioResultCount >= 0, `${label}.verificationEvidence[${index}].scenarioResultCount must be a non-negative integer.`)
    }
    invariant(new Set(evidenceTaskRunIds).size === evidenceTaskRunIds.length, `${label}.verificationEvidence must not repeat TaskRuns.`)
    const confirmation = object(report.humanDeliveryConfirmation, `${label}.humanDeliveryConfirmation`)
    for (const field of ['projectReviewId', 'deliveryRecordId', 'deliveredBy']) string(confirmation[field], `${label}.humanDeliveryConfirmation.${field}`)
    for (const field of ['projectReviewDigest', 'deliveryRecordDigest']) sha256(confirmation[field], `${label}.humanDeliveryConfirmation.${field}`)
    enumValue(confirmation.reviewDecision, ['approve', 'waive'], `${label}.humanDeliveryConfirmation.reviewDecision`)
    enumValue(confirmation.deliveryStatus, ['delivered', 'closed'], `${label}.humanDeliveryConfirmation.deliveryStatus`)
    timestamp(confirmation.deliveredAt, `${label}.humanDeliveryConfirmation.deliveredAt`)
  }
  stringArray(report.evidenceRecordIds, `${label}.evidenceRecordIds`, { nonempty: true })
  timestamp(report.startedAt, `${label}.startedAt`)
  timestamp(report.completedAt, `${label}.completedAt`)
  invariant(Date.parse(report.completedAt) >= Date.parse(report.startedAt), `${label}.completedAt must not precede startedAt.`)
  return report
}
