import type {
  AcceptanceScenarioRecord,
  AssignmentDraftRecord,
  AssignmentEvaluationRecord,
  CapabilityRequirementDraftRecord,
  GeneratedPlanV3,
  PlanningPromptReferenceManifestRecord,
  PlanningReferenceMapRecord,
  RequirementCodeBindingRecord,
  TaskAssignmentPolicy,
  TaskPreflightRecordV3,
  TaskRecord,
  TeamCompositionSnapshot,
  VerificationSpecRecord,
} from '../types.js'
import { assignmentDigest, digestObject, WorkflowError } from '../workflow.js'
import { verificationSpecDigest } from '../verification/service.js'

export interface TaskShapingInput {
  projectId: string
  planSnapshotId: string
  plan: GeneratedPlanV3
  preservedTasks: TaskRecord[]
  referenceMap: PlanningReferenceMapRecord
  requirementIds: Map<string, string>
  acceptanceIds: Map<string, string>
  decisionIds: Map<string, string>
  codeBindings: RequirementCodeBindingRecord[]
  scenarios: AcceptanceScenarioRecord[]
  planManifest: PlanningPromptReferenceManifestRecord
  capabilityRequirements: CapabilityRequirementDraftRecord[]
  assignmentDrafts: AssignmentDraftRecord[]
  assignmentEvaluations: AssignmentEvaluationRecord[]
  preflights: TaskPreflightRecordV3[]
  createdAt: string
  captureTeam: () => TeamCompositionSnapshot
}

function required<T>(value: T | undefined, description: string): T {
  if (value === undefined) throw new WorkflowError('planning-task-shape-incomplete', `Task shaping is missing ${description}.`, 409)
  return value
}

export function shapePlanningTasksV3(input: TaskShapingInput): {
  newTasks: TaskRecord[]
  verificationSpecs: VerificationSpecRecord[]
  allTasks: TaskRecord[]
  nextAssignmentDigest: string
  team: TeamCompositionSnapshot
} {
  if (input.referenceMap.operationId !== input.planManifest.operationId || input.planManifest.projectId !== input.projectId || input.referenceMap.reservedPlanSnapshotId !== input.planSnapshotId) throw new WorkflowError('planning-task-shape-stale', 'Task shaping inputs do not belong to one frozen Planning candidate.', 409)
  const promptRefById = new Map(input.planManifest.references.map((item) => [item.ref, item]))
  const taskIdByKey = input.referenceMap.taskIdsByKey
  const assignmentByTask = new Map(input.assignmentDrafts.map((item) => [item.taskKey, item]))
  const capabilityByTask = new Map(input.capabilityRequirements.map((item) => [item.taskKey, item]))
  const evaluationByTask = new Map(input.assignmentEvaluations.map((item) => [item.taskKey, item]))
  const preflightByTask = new Map(input.preflights.map((item) => [item.taskKey, item]))
  const bindingIdByKey = new Map(input.codeBindings.map((item) => [item.key, item.id]))
  const scenarioIdByKey = new Map(input.scenarios.map((item) => [item.key, item.id]))
  let newTasks: TaskRecord[] = input.plan.tasks.map((proposal, ordinal) => {
    const assignment = required(assignmentByTask.get(proposal.key), `Assignment for ${proposal.key}`)
    const capability = required(capabilityByTask.get(proposal.key), `Capability Requirement for ${proposal.key}`)
    const evaluation = required(evaluationByTask.get(proposal.key), `Assignment Evaluation for ${proposal.key}`)
    const preflight = required(preflightByTask.get(proposal.key), `TaskPreflight for ${proposal.key}`)
    const commandRefs = proposal.verificationCommandRefs.map((ref) => required(promptRefById.get(ref), `Verification command ${ref}`))
    const policyIds = proposal.policyConstraintRefs.map((ref) => required(promptRefById.get(ref), `Policy constraint ${ref}`).artifactId)
    const evidenceIds = proposal.evidenceClaimRefs.map((ref) => required(promptRefById.get(ref), `Evidence claim ${ref}`).artifactId)
    const assignmentPolicy: TaskAssignmentPolicy = {
      mode: 'single_agent', riskLevel: proposal.risk, requiredRoles: capability.requiredRoles, requiredCapabilities: capability.requiredCapabilities,
      allowedAgentIds: [required(assignment.executingAgentId, `Executing Agent for ${proposal.key}`)], allowedSquadIds: [], requiresIndependentReviewer: capability.requiresIndependentReviewer, maxParallel: 1,
      conflictKeys: proposal.changeContract.conflictKeys, allowedScope: proposal.changeContract.allowedPathScopes, forbiddenScope: proposal.changeContract.excludedPathScopes,
      escalationConditions: proposal.contextPack.escalationConditions,
    }
    return {
      id: required(taskIdByKey[proposal.key], `Task id for ${proposal.key}`), projectId: input.projectId, ordinal: input.preservedTasks.length + ordinal, title: proposal.title, kind: proposal.kind, description: proposal.description,
      acceptanceCriteria: proposal.completionCriteria, completionCriteria: proposal.completionCriteria, dependencies: proposal.dependencyKeys.map((key) => required(taskIdByKey[key], `Dependency id ${key}`)),
      priority: proposal.risk === 'high' || proposal.risk === 'critical' ? 'high' : 'medium', tags: ['planning-v3'], agentId: assignment.executingAgentId,
      testCommand: required(commandRefs[0], `First verification command for ${proposal.key}`).artifactId, sourceRequirementIds: proposal.requirementKeys.map((key) => required(input.requirementIds.get(key), `Requirement id ${key}`)),
      acceptanceIds: proposal.acceptanceKeys.map((key) => required(input.acceptanceIds.get(key), `Acceptance id ${key}`)), decisionIds: proposal.decisionKeys.map((key) => required(input.decisionIds.get(key), `Decision id ${key}`)),
      planningContractVersion: 3, taskRevision: 1, workPackageId: required(input.referenceMap.workPackageIdsByKey[proposal.workPackageKey], `WorkPackage id ${proposal.workPackageKey}`), referenceMapId: input.referenceMap.id,
      bindingIds: proposal.bindingKeys.map((key) => required(bindingIdByKey.get(key), `Binding id ${key}`)), scenarioIds: proposal.scenarioKeys.map((key) => required(scenarioIdByKey.get(key), `Scenario id ${key}`)), policyConstraintIds: policyIds,
      evidenceIds, commandEvidenceIds: commandRefs.map((item) => item.artifactId), capabilityRequirementId: capability.id, assignmentDecisionId: evaluation.id,
      taskContextPackDigest: digestObject(proposal.contextPack), taskPreflightId: preflight.id, taskPreflightDigest: preflight.preflightDigest,
      assignmentPolicy, assignmentSource: 'automatic_match', planSnapshotId: input.planSnapshotId, relationship: proposal.relationship, status: 'draft', createdAt: input.createdAt, updatedAt: input.createdAt,
    }
  })
  const verificationSpecs: VerificationSpecRecord[] = input.plan.tasks.map((proposal) => {
    const taskId = required(taskIdByKey[proposal.key], `Task id for ${proposal.key}`)
    const commandIds = proposal.verificationCommandRefs.map((ref) => required(promptRefById.get(ref), `Verification command ${ref}`).artifactId)
    const provider = proposal.contextPack.verificationHarness?.kind === 'browser' ? 'playwright' as const : 'command' as const
    const core: Omit<VerificationSpecRecord, 'specDigest'> = {
      schemaVersion: 1,
      id: `verification-spec:${input.planSnapshotId}:${taskId}`,
      projectId: input.projectId,
      planSnapshotId: input.planSnapshotId,
      taskId,
      provider,
      providerContractVersion: provider === 'playwright' ? 'playwright-browser-verification-v2' : 'command-verification-v1',
      commandIds,
      requiredScenarioIds: proposal.scenarioKeys.map((key) => required(scenarioIdByKey.get(key), `Scenario id ${key}`)),
      ...(provider === 'playwright' ? {
        reportContract: {
          version: 1 as const,
          reporterId: 'dsh-playwright-json-v1' as const,
          testMappings: proposal.contextPack.verificationSteps.map((step) => ({
            scenarioId: required(scenarioIdByKey.get(step.scenarioKey), `Scenario id ${step.scenarioKey}`),
            scenarioKey: step.scenarioKey,
            testFile: required(step.testFile, `Test file for ${step.scenarioKey}`),
            testKey: required(step.testKey, `Test key for ${step.scenarioKey}`),
            browserProject: required(step.browserProject, `Browser project for ${step.scenarioKey}`),
          })),
          requireAllMappedTests: true as const,
          allowFlakyPass: false as const,
        },
      } : {}),
      createdAt: input.createdAt,
    }
    return { ...core, specDigest: verificationSpecDigest(core) }
  })
  const verificationSpecIdByTaskId = new Map(verificationSpecs.map((spec) => [spec.taskId, spec.id]))
  newTasks = newTasks.map((task) => ({ ...task, verificationSpecId: required(verificationSpecIdByTaskId.get(task.id), `VerificationSpec for ${task.id}`) }))
  const nextAssignmentDigest = assignmentDigest([...input.preservedTasks, ...newTasks])
  const team = input.captureTeam()
  newTasks = newTasks.map((task) => ({ ...task, teamDigest: team.teamDigest, assignmentDigest: nextAssignmentDigest }))
  return { newTasks, verificationSpecs, allTasks: [...input.preservedTasks, ...newTasks], nextAssignmentDigest, team }
}
