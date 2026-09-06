import type {
  PlanningOperationStage,
  PlanningRepairAttemptRecord,
  PlanningReviewFinding,
} from '../types.js'
import { WorkflowError, digestObject } from '../workflow.js'

export const PLANNING_STAGE_ORDER: readonly PlanningOperationStage[] = [
  'reserved', 'source_ingest', 'source_profile', 'source_manifest', 'requirement_analysis', 'requirement_review', 'source_policy_precheck',
  'decision_effect_precheck', 'risk_profile', 'scenario_completion', 'scenario_coverage_review', 'repository_snapshot', 'canonical_target_binding',
  'policy_snapshot', 'code_binding', 'binding_review', 'work_packages', 'task_plan', 'reference_mapping', 'policy_fulfillment',
  'capability_requirement_derivation', 'plan_review', 'capability_catalog_snapshot', 'access_grant_snapshot', 'assignment_qualification',
  'task_preflight', 'decision_effect_finalization', 'convergence_carry_validation', 'committing', 'committed', 'shadow_completed',
]

const stageOrdinal = new Map(PLANNING_STAGE_ORDER.map((stage, index) => [stage, index]))

type PlanningReviewKind = PlanningRepairAttemptRecord['reviewKind']

const OWNER_RESTART_STAGE: Record<Exclude<PlanningReviewFinding['repairOwner'], 'team'>, PlanningOperationStage> = {
  requirement: 'requirement_analysis',
  risk: 'risk_profile',
  scenario: 'scenario_completion',
  policy: 'policy_snapshot',
  repository: 'repository_snapshot',
  binding: 'code_binding',
  plan: 'task_plan',
  capability: 'task_plan',
  human_decision: 'decision_effect_precheck',
}

const TEAM_RESTART_STAGE: Record<PlanningReviewKind, PlanningOperationStage> = {
  requirement: 'requirement_review',
  scenario_coverage: 'scenario_coverage_review',
  binding: 'binding_review',
  plan: 'plan_review',
}

export function canonicalPlanningRepairFinding(finding: PlanningReviewFinding, reviewKind: PlanningReviewKind): PlanningReviewFinding {
  const ownerStage = finding.repairOwner === 'team' ? TEAM_RESTART_STAGE[reviewKind] : OWNER_RESTART_STAGE[finding.repairOwner]
  const subjectStage = finding.repairOwner === 'team' || finding.repairOwner === 'human_decision'
    ? undefined
    : finding.subjectType === 'scenario'
      ? 'scenario_completion'
      : finding.subjectType === 'scenario_coverage_policy'
        ? 'risk_profile'
        : undefined
  const restartStage = subjectStage !== undefined && stageOrdinal.get(subjectStage)! < stageOrdinal.get(ownerStage)!
    ? subjectStage
    : ownerStage
  return { ...finding, restartStage }
}

export function canonicalPlanningRepairFindings(findings: PlanningReviewFinding[], reviewKind: PlanningReviewKind): PlanningReviewFinding[] {
  return findings.map((finding) => canonicalPlanningRepairFinding(finding, reviewKind))
}

function canonicalFindings(findings: PlanningReviewFinding[], reviewKind: PlanningReviewKind = 'plan'): PlanningReviewFinding[] {
  if (findings.length === 0) throw new WorkflowError('planning-repair-findings-required', 'A Planning repair requires at least one Review finding.', 422)
  return canonicalPlanningRepairFindings(findings, reviewKind).sort((left, right) => {
    const stage = (stageOrdinal.get(left.restartStage) ?? Number.MAX_SAFE_INTEGER) - (stageOrdinal.get(right.restartStage) ?? Number.MAX_SAFE_INTEGER)
    if (stage !== 0) return stage
    return left.code.localeCompare(right.code) || left.subjectType.localeCompare(right.subjectType) || left.subjectId.localeCompare(right.subjectId) || left.message.localeCompare(right.message)
  })
}

export function earliestPlanningRestartStage(findings: PlanningReviewFinding[], reviewKind: PlanningReviewKind = 'plan'): PlanningOperationStage {
  const canonical = canonicalFindings(findings, reviewKind)
  const restartStage = canonical[0]!.restartStage
  if (!stageOrdinal.has(restartStage)) throw new WorkflowError('planning-repair-stage-invalid', `Unknown Planning restart stage "${restartStage}".`, 422)
  return restartStage
}

export function buildPlanningRepairAttempt(input: {
  projectId: string
  operationId: string
  reviewKind: PlanningRepairAttemptRecord['reviewKind']
  sourceReviewId: string
  sourceReviewDigest: string
  findings: PlanningReviewFinding[]
  inputSubjectRevision: number
  existingAttempts: PlanningRepairAttemptRecord[]
  lineageOperationIds?: string[]
  repairPolicyVersion: string
  maxAttempts: number
  createdAt: string
}): { record: PlanningRepairAttemptRecord; replayed: boolean } {
  const findings = canonicalFindings(input.findings, input.reviewKind)
  const restartStage = earliestPlanningRestartStage(findings, input.reviewKind)
  const findingSet = findings.map((finding) => ({
    code: finding.code,
    severity: finding.severity,
    subjectType: finding.subjectType,
    subjectId: finding.subjectId,
    evidenceIds: [...finding.evidenceIds].sort(),
    message: finding.message,
    repairOwner: finding.repairOwner,
    restartStage: finding.restartStage,
    requiredUserAction: finding.requiredUserAction,
  }))
  const findingSetDigest = digestObject(findingSet)
  const replay = input.existingAttempts.find((attempt) => attempt.operationId === input.operationId
    && attempt.sourceReviewDigest === input.sourceReviewDigest
    && attempt.findingSetDigest === findingSetDigest
    && attempt.repairPolicyVersion === input.repairPolicyVersion)
  if (replay !== undefined) return { record: replay, replayed: true }

  const lineageOperationIds = new Set(input.lineageOperationIds ?? [input.operationId])
  if (!lineageOperationIds.has(input.operationId)) throw new WorkflowError('planning-repair-lineage-invalid', 'Planning repair lineage must include the current operation.', 422)
  const attempt = input.existingAttempts
    .filter((item) => lineageOperationIds.has(item.operationId) && item.reviewKind === input.reviewKind)
    .reduce((highest, item) => Math.max(highest, item.attempt), 0) + 1
  if (attempt > input.maxAttempts) throw new WorkflowError('planning-repair-attempts-exhausted', `Planning repair exceeded ${input.maxAttempts} semantic attempts.`, 409)

  const repairOwner = findings.find((finding) => finding.restartStage === restartStage)!.repairOwner
  const sourceFindingIds = findings.map((finding) => `finding:${digestObject(finding)}`)
  const repairCore = {
    projectId: input.projectId,
    operationId: input.operationId,
    reviewKind: input.reviewKind,
    sourceReviewId: input.sourceReviewId,
    sourceReviewDigest: input.sourceReviewDigest,
    sourceFindingIds,
    findingSetDigest,
    repairOwner,
    restartStage,
    inputSubjectRevision: input.inputSubjectRevision,
    status: 'requested' as const,
    attempt,
    maxAttempts: input.maxAttempts,
    repairPolicyVersion: input.repairPolicyVersion,
  }
  const repairDigest = digestObject(repairCore)
  return {
    record: {
      id: `planning-repair:${input.operationId}:${input.reviewKind}:${attempt}:${repairDigest.slice(0, 12)}`,
      ...repairCore,
      findings,
      repairDigest,
      createdAt: input.createdAt,
      updatedAt: input.createdAt,
    },
    replayed: false,
  }
}
