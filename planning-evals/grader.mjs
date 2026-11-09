const set = (values = []) => new Set(values)
const intersectionSize = (left, right) => [...left].filter((value) => right.has(value)).length
const ratio = (numerator, denominator) => denominator === 0 ? null : numerator / denominator
const sample = (numerator, denominator) => ({ numerator, denominator, value: ratio(numerator, denominator), applicability: denominator === 0 ? 'not_applicable' : 'applicable' })

function scoreBindingOwners(gold, candidate) {
  const expectedByRequirement = gold.allowedBindingOwnerPathsByRequirement ?? {}
  const actualByRequirement = new Map()
  for (const binding of candidate.bindings ?? []) {
    const paths = actualByRequirement.get(binding.requirementKey) ?? new Set()
    for (const path of binding.ownerPaths ?? []) paths.add(path)
    actualByRequirement.set(binding.requirementKey, paths)
  }

  let truePositives = 0
  let actualCount = 0
  let expectedCount = 0
  let completeRequirementCount = 0
  for (const [requirementKey, alternatives] of Object.entries(expectedByRequirement)) {
    const actual = actualByRequirement.get(requirementKey) ?? new Set()
    const scoredAlternatives = alternatives.map((paths) => {
      const expected = set(paths)
      const matches = intersectionSize(actual, expected)
      return { matches, actual: actual.size, expected: expected.size, recall: ratio(matches, expected.size) ?? 0, precision: ratio(matches, actual.size) ?? 0 }
    }).sort((left, right) => right.recall - left.recall || right.precision - left.precision || left.expected - right.expected)
    const best = scoredAlternatives[0] ?? { matches: 0, actual: actual.size, expected: 1, recall: 0, precision: 0 }
    truePositives += best.matches
    actualCount += best.actual
    expectedCount += best.expected
    if (best.recall === 1) completeRequirementCount += 1
    actualByRequirement.delete(requirementKey)
  }

  for (const paths of actualByRequirement.values()) actualCount += paths.size
  return {
    precision: sample(truePositives, actualCount),
    recall: sample(truePositives, expectedCount),
    complete: completeRequirementCount === Object.keys(expectedByRequirement).length,
  }
}

const reasonIdentity = (reason) => `${reason.code}\u0000${[...(reason.subjectKeys ?? [])].sort().join('\u0000')}`

function scoreBlockingReasons(gold, candidate) {
  if (gold.schemaVersion !== 2 || gold.expectedReadiness !== 'blocked') return { precision: sample(0, 0), recall: sample(0, 0) }
  const expected = set(gold.expectedBlockingReasons.map(reasonIdentity))
  const actual = set((candidate.blockingReasons ?? []).map(reasonIdentity))
  const matches = intersectionSize(actual, expected)
  return { precision: sample(matches, actual.size), recall: sample(matches, expected.size) }
}

function stageApplies(gold, stage) {
  return gold.schemaVersion !== 2 || gold.requiredEvidenceStages.includes(stage)
}

export function gradePlanningRun(gold, candidate) {
  const requiredRequirements = set(gold.requiredRequirementKeys)
  const candidateRequirements = set(candidate.requirements?.map((item) => item.key))
  const requiredAcceptances = set(gold.requiredAcceptanceKeys)
  const coveredAcceptances = set(candidate.tasks?.flatMap((task) => task.acceptanceKeys ?? []))
  const unresolvedHighDecisionBypass = candidate.status === 'ready' && (candidate.decisions ?? []).some((decision) => ['high', 'critical'].includes(decision.impact) && decision.status !== 'resolved')
  const evidence = candidate.bindings?.flatMap((binding) => binding.evidenceIds ?? []) ?? []
  const inventory = set(candidate.repositoryEvidenceIds)
  const invalidEvidenceCount = evidence.filter((id) => !inventory.has(id)).length
  const ownerScore = scoreBindingOwners(gold, candidate)
  const executableTasks = candidate.tasks?.filter((task) => task.contextComplete === true && (task.verificationCommandIds?.length ?? 0) > 0) ?? []
  const eligibleAssignments = Object.values(gold.assignmentExpectations).filter((item) => item.hasEligibleMember)
  const blockedAssignments = Object.values(gold.assignmentExpectations).filter((item) => !item.hasEligibleMember)
  const selectedByTask = new Map((candidate.assignments ?? []).map((item) => [item.taskKey, item]))
  const assignableCorrect = eligibleAssignments.filter((expected) => expected.allowedAgentIds.includes(selectedByTask.get(expected.taskKey)?.agentId)).length
  const abstainedCorrect = blockedAssignments.filter((expected) => selectedByTask.get(expected.taskKey)?.outcome === 'blocked').length
  const requirementMatches = intersectionSize(requiredRequirements, candidateRequirements)
  const acceptanceMatches = intersectionSize(requiredAcceptances, coveredAcceptances)
  const fullContractSatisfied = requirementMatches === requiredRequirements.size
    && acceptanceMatches === requiredAcceptances.size
    && !unresolvedHighDecisionBypass
    && invalidEvidenceCount === 0
    && ownerScore.complete
    && assignableCorrect === eligibleAssignments.length
    && abstainedCorrect === blockedAssignments.length
  const contractFalseReady = candidate.status === 'ready' && !fullContractSatisfied
  const expectedReady = gold.schemaVersion === 2 && gold.expectedReadiness === 'ready'
  const expectedBlocked = gold.schemaVersion === 2 && gold.expectedReadiness === 'blocked'
  const blockingReasonScore = scoreBlockingReasons(gold, candidate)
  const completedStages = set(candidate.completedStageEvidence?.map((item) => item.stage))
  const requiredStages = gold.schemaVersion === 2 ? gold.requiredEvidenceStages : []
  const completedRequiredStages = requiredStages.filter((stage) => completedStages.has(stage)).length

  const samples = {
    requiredRequirementRecall: stageApplies(gold, 'requirements') ? sample(requirementMatches, requiredRequirements.size) : sample(0, 0),
    requiredAcceptanceCoverage: stageApplies(gold, 'tasks') ? sample(acceptanceMatches, requiredAcceptances.size) : sample(0, 0),
    unresolvedHighDecisionBypass: sample(unresolvedHighDecisionBypass ? 1 : 0, 1),
    falseReady: sample(contractFalseReady ? 1 : 0, 1),
    invalidEvidenceReferences: sample(invalidEvidenceCount, 1),
    bindingOwnerPrecision: stageApplies(gold, 'bindings') ? ownerScore.precision : sample(0, 0),
    bindingOwnerRecall: stageApplies(gold, 'bindings') ? ownerScore.recall : sample(0, 0),
    executableTaskRate: stageApplies(gold, 'tasks') ? sample(executableTasks.length, candidate.tasks?.length ?? 0) : sample(0, 0),
    assignableRate: stageApplies(gold, 'assignments') ? sample(assignableCorrect, eligibleAssignments.length) : sample(0, 0),
    correctAbstentionRate: stageApplies(gold, 'assignments') ? sample(abstainedCorrect, blockedAssignments.length) : sample(0, 0),
    substantiveRewriteRate: sample(candidate.substantiveRewriteRequired === true ? 1 : 0, 1),
    falseReadyRate: sample(expectedBlocked && candidate.status === 'ready' ? 1 : 0, expectedBlocked ? 1 : 0),
    falseBlockedRate: sample(expectedReady && candidate.status === 'blocked' ? 1 : 0, expectedReady ? 1 : 0),
    blockingReasonPrecision: blockingReasonScore.precision,
    blockingReasonRecall: blockingReasonScore.recall,
    firstPassApprovableRate: sample(expectedReady && candidate.status === 'ready' && !candidate.substantiveRewriteRequired && fullContractSatisfied ? 1 : 0, expectedReady ? 1 : 0),
    requiredEvidenceStageCoverage: gold.schemaVersion === 2 ? sample(completedRequiredStages, requiredStages.length) : sample(0, 0),
  }

  return {
    caseId: gold.id,
    runId: candidate.runId,
    goldSchemaVersion: gold.schemaVersion ?? 1,
    metrics: Object.fromEntries(Object.entries(samples).map(([key, result]) => [key, result.value])),
    metricSamples: samples,
  }
}

export const RELEASE_THRESHOLDS = {
  requiredRequirementRecall: { min: 1 },
  requiredAcceptanceCoverage: { min: 1 },
  unresolvedHighDecisionBypass: { max: 0 },
  falseReady: { max: 0 },
  invalidEvidenceReferences: { max: 0 },
  bindingOwnerPrecision: { min: 0.9 },
  bindingOwnerRecall: { min: 0.95 },
  executableTaskRate: { min: 0.9 },
  assignableRate: { min: 1 },
  correctAbstentionRate: { min: 1 },
  substantiveRewriteRate: { max: 0.2 },
}

export const READINESS_THRESHOLDS = {
  falseReadyRate: { max: 0 },
  falseBlockedRate: { max: 0 },
  blockingReasonPrecision: { min: 1 },
  blockingReasonRecall: { min: 1 },
  firstPassApprovableRate: { min: 1 },
  requiredEvidenceStageCoverage: { min: 1 },
}

function aggregateSamples(grades, attempts) {
  const keys = new Set(grades.flatMap((grade) => Object.keys(grade.metricSamples)))
  const results = {}
  for (const key of keys) {
    let numerator = 0
    let denominator = 0
    for (const grade of grades) {
      numerator += grade.metricSamples[key]?.numerator ?? 0
      denominator += grade.metricSamples[key]?.denominator ?? 0
    }
    results[key] = sample(numerator, denominator)
  }
  const invokedAttempts = attempts.filter((attempt) => attempt.operationId !== undefined)
  results.modelFailureRate = sample(invokedAttempts.filter((attempt) => attempt.outcome === 'model_failure').length, invokedAttempts.length)
  return results
}

export function summarizePlanningGrades(grades, { attempts = [], thresholds, requireFiveRuns = true } = {}) {
  const appliedThresholds = thresholds ?? {
    ...RELEASE_THRESHOLDS,
    ...(grades.some((grade) => grade.goldSchemaVersion === 2) ? READINESS_THRESHOLDS : {}),
  }
  const metricResults = aggregateSamples(grades, attempts)
  const metrics = Object.fromEntries(Object.entries(metricResults).map(([key, result]) => [key, result.value]))
  const satisfiedWhenApplicable = (grade, metric, expected) => grade.metricSamples[metric].applicability === 'not_applicable' || grade.metrics[metric] === expected
  const invariantRunsPassed = grades.filter((grade) => satisfiedWhenApplicable(grade, 'requiredRequirementRecall', 1)
    && satisfiedWhenApplicable(grade, 'requiredAcceptanceCoverage', 1)
    && grade.metrics.unresolvedHighDecisionBypass === 0
    && grade.metrics.falseReady === 0
    && grade.metrics.invalidEvidenceReferences === 0).length
  const thresholdFailures = []
  for (const [key, threshold] of Object.entries(appliedThresholds)) {
    const result = metricResults[key] ?? sample(0, 0)
    if (result.applicability === 'not_applicable') {
      thresholdFailures.push(`${key}:not_applicable`)
      continue
    }
    if (('min' in threshold && result.value < threshold.min) || ('max' in threshold && result.value > threshold.max)) thresholdFailures.push(key)
  }
  if ((requireFiveRuns && grades.length < 5) || invariantRunsPassed !== grades.length) thresholdFailures.push('fiveRunInvariantPassRate')
  return { runCount: grades.length, invariantRunsPassed, metrics, metricResults, thresholdFailures: [...new Set(thresholdFailures)], passed: thresholdFailures.length === 0 }
}
