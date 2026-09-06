const SHA256 = /^[0-9a-f]{64}$/u
const GIT_OBJECT_ID = /^[0-9a-f]{40,64}$/u

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
  invariant(gold.schemaVersion === 1, `${label}.schemaVersion must equal 1.`)
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
  return gold
}

export function validatePlanningCandidate(raw, caseName = 'unknown', runName = 'unknown') {
  const label = `Planning run ${caseName}/${runName}`
  const candidate = object(raw, label)
  invariant(candidate.schemaVersion === 1, `${label}.schemaVersion must equal 1.`)
  string(candidate.runId, `${label}.runId`)
  invariant(candidate.executionKind === 'fixture' || candidate.executionKind === 'real_model', `${label}.executionKind must be fixture or real_model.`)
  invariant(candidate.status === 'ready' || candidate.status === 'blocked', `${label}.status must be ready or blocked.`)
  stringArray(candidate.repositoryEvidenceIds, `${label}.repositoryEvidenceIds`)
  invariant(Array.isArray(candidate.requirements), `${label}.requirements must be an array.`)
  const requirementKeys = stringArray(candidate.requirements.map((item, index) => string(object(item, `${label}.requirements[${index}]`).key, `${label}.requirements[${index}].key`)), `${label}.requirementKeys`)
  const requirementKeySet = new Set(requirementKeys)
  invariant(Array.isArray(candidate.decisions), `${label}.decisions must be an array.`)
  for (const [index, rawDecision] of candidate.decisions.entries()) {
    const decision = object(rawDecision, `${label}.decisions[${index}]`)
    invariant(['low', 'medium', 'high', 'critical'].includes(decision.impact), `${label}.decisions[${index}].impact is invalid.`)
    invariant(['pending', 'resolved', 'superseded'].includes(decision.status), `${label}.decisions[${index}].status is invalid.`)
  }
  invariant(Array.isArray(candidate.bindings), `${label}.bindings must be an array.`)
  for (const [index, rawBinding] of candidate.bindings.entries()) {
    const binding = object(rawBinding, `${label}.bindings[${index}]`)
    string(binding.requirementKey, `${label}.bindings[${index}].requirementKey`)
    invariant(requirementKeySet.has(binding.requirementKey), `${label}.bindings[${index}].requirementKey must reference a candidate Requirement.`)
    stringArray(binding.evidenceIds, `${label}.bindings[${index}].evidenceIds`)
    stringArray(binding.ownerPaths, `${label}.bindings[${index}].ownerPaths`)
  }
  invariant(Array.isArray(candidate.tasks), `${label}.tasks must be an array.`)
  const taskKeys = stringArray(candidate.tasks.map((rawTask, index) => {
    const task = object(rawTask, `${label}.tasks[${index}]`)
    stringArray(task.acceptanceKeys, `${label}.tasks[${index}].acceptanceKeys`)
    invariant(typeof task.contextComplete === 'boolean', `${label}.tasks[${index}].contextComplete must be boolean.`)
    stringArray(task.verificationCommandIds, `${label}.tasks[${index}].verificationCommandIds`)
    return string(task.key, `${label}.tasks[${index}].key`)
  }), `${label}.taskKeys`)
  const taskKeySet = new Set(taskKeys)
  invariant(Array.isArray(candidate.assignments), `${label}.assignments must be an array.`)
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
  invariant(report.schemaVersion === 1, `${label}.schemaVersion must equal 1.`)
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
  stringArray(report.evidenceRecordIds, `${label}.evidenceRecordIds`, { nonempty: true })
  timestamp(report.startedAt, `${label}.startedAt`)
  timestamp(report.completedAt, `${label}.completedAt`)
  invariant(Date.parse(report.completedAt) >= Date.parse(report.startedAt), `${label}.completedAt must not precede startedAt.`)
  return report
}
