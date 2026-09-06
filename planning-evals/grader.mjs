const set = (values = []) => new Set(values)
const intersectionSize = (left, right) => [...left].filter((value) => right.has(value)).length
const ratio = (numerator, denominator) => denominator === 0 ? 1 : numerator / denominator

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
      return { matches, actual: actual.size, expected: expected.size, recall: ratio(matches, expected.size), precision: ratio(matches, actual.size) }
    }).sort((left, right) => right.recall - left.recall || right.precision - left.precision || left.expected - right.expected)
    const best = scoredAlternatives[0] ?? { matches: 0, actual: actual.size, expected: 1, recall: 0, precision: ratio(0, actual.size) }
    truePositives += best.matches
    actualCount += best.actual
    expectedCount += best.expected
    if (best.recall === 1) completeRequirementCount += 1
    actualByRequirement.delete(requirementKey)
  }

  for (const paths of actualByRequirement.values()) actualCount += paths.size
  return {
    precision: ratio(truePositives, actualCount),
    recall: ratio(truePositives, expectedCount),
    complete: completeRequirementCount === Object.keys(expectedByRequirement).length,
  }
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
  const falseReady = candidate.status === 'ready' && (
    intersectionSize(requiredRequirements, candidateRequirements) !== requiredRequirements.size
    || intersectionSize(requiredAcceptances, coveredAcceptances) !== requiredAcceptances.size
    || unresolvedHighDecisionBypass
    || invalidEvidenceCount > 0
    || !ownerScore.complete
    || assignableCorrect < eligibleAssignments.length
    || abstainedCorrect < blockedAssignments.length
  )
  return {
    caseId: gold.id,
    runId: candidate.runId,
    metrics: {
      requiredRequirementRecall: ratio(intersectionSize(requiredRequirements, candidateRequirements), requiredRequirements.size),
      requiredAcceptanceCoverage: ratio(intersectionSize(requiredAcceptances, coveredAcceptances), requiredAcceptances.size),
      unresolvedHighDecisionBypass: unresolvedHighDecisionBypass ? 1 : 0,
      falseReady: falseReady ? 1 : 0,
      invalidEvidenceReferences: invalidEvidenceCount,
      bindingOwnerPrecision: ownerScore.precision,
      bindingOwnerRecall: ownerScore.recall,
      executableTaskRate: ratio(executableTasks.length, candidate.tasks?.length ?? 0),
      assignableRate: ratio(assignableCorrect, eligibleAssignments.length),
      correctAbstentionRate: ratio(abstainedCorrect, blockedAssignments.length),
      substantiveRewriteRate: candidate.substantiveRewriteRequired === true ? 1 : 0,
    },
  }
}

export const RELEASE_THRESHOLDS = {
  requiredRequirementRecall: { min: 1 }, requiredAcceptanceCoverage: { min: 1 }, unresolvedHighDecisionBypass: { max: 0 }, falseReady: { max: 0 }, invalidEvidenceReferences: { max: 0 }, bindingOwnerPrecision: { min: 0.9 }, bindingOwnerRecall: { min: 0.95 }, executableTaskRate: { min: 0.9 }, assignableRate: { min: 1 }, correctAbstentionRate: { min: 1 }, substantiveRewriteRate: { max: 0.2 },
}

export function summarizePlanningGrades(grades) {
  const metricKeys = Object.keys(RELEASE_THRESHOLDS)
  const metrics = Object.fromEntries(metricKeys.map((key) => [key, grades.reduce((sum, grade) => sum + grade.metrics[key], 0) / Math.max(1, grades.length)]))
  const invariantRunsPassed = grades.filter((grade) => grade.metrics.requiredRequirementRecall === 1 && grade.metrics.requiredAcceptanceCoverage === 1 && grade.metrics.unresolvedHighDecisionBypass === 0 && grade.metrics.falseReady === 0 && grade.metrics.invalidEvidenceReferences === 0).length
  const thresholdFailures = metricKeys.filter((key) => {
    const threshold = RELEASE_THRESHOLDS[key]
    return ('min' in threshold && metrics[key] < threshold.min) || ('max' in threshold && metrics[key] > threshold.max)
  })
  if (grades.length < 5 || invariantRunsPassed !== grades.length) thresholdFailures.push('fiveRunInvariantPassRate')
  return { runCount: grades.length, invariantRunsPassed, metrics, thresholdFailures: [...new Set(thresholdFailures)], passed: thresholdFailures.length === 0 }
}
