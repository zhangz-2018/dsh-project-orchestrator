import { z } from 'zod'

const Sha256Schema = z.string().regex(/^[a-f0-9]{64}$/)
const RepositoryEvidenceDigestSchema = z.string().regex(/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/)

export const AgentToolPolicySchema = z.enum(['full', 'read_only'])
export const AgentStatusSchema = z.enum(['active', 'archived'])
export const AssignmentModeSchema = z.enum(['single_agent', 'squad_delegation', 'review_only'])
export const TaskRiskLevelSchema = z.enum(['low', 'medium', 'high', 'critical'])
export const DeliveryRoleSchema = z.enum(['planner', 'lead', 'implementer', 'verifier', 'reviewer', 'specialist', 'release'])
export const CapabilityIdSchema = z.string().trim().regex(/^[a-z][a-z0-9._-]{0,159}$/)
export const ProjectDeliveryStageSchema = z.enum([
  'planning', 'awaiting_approval', 'approved', 'executing', 'verifying', 'integrating',
  'final_repository_snapshot', 'convergence_reviewing', 'changes_required', 'blocked', 'failed',
  'review', 'delivery_ready', 'delivered', 'closed',
])
export const PrioritySchema = z.enum(['low', 'medium', 'high', 'urgent'])
export const TaskLanguageSchema = z.enum(['zh-CN', 'en'])
export const RuntimeStatusSchema = z.enum(['online', 'offline', 'unstable'])
export const RuntimeLifecycleSchema = z.enum(['active', 'archived'])
export const ResourceKindSchema = z.enum(['github_repo', 'local_directory'])
export const ResourceExecutionModeSchema = z.enum(['in_place', 'worktree'])
export const IssueStatusSchema = z.enum(['backlog', 'todo', 'in_progress', 'in_review', 'done', 'blocked', 'cancelled'])
export const IssueAssigneeTypeSchema = z.enum(['member', 'agent', 'squad'])
export const TaskRunStatusSchema = z.enum(['deferred', 'queued', 'dispatched', 'waiting_local_directory', 'running', 'completed', 'failed', 'cancelled'])
export const TaskRunErrorCodeSchema = z.enum(['verification_failed', 'scope_violation', 'verification_unavailable', 'permission_denied', 'runtime_offline', 'capacity_exhausted', 'dependency_failed', 'internal'])
export const ActivityActorTypeSchema = z.enum(['human', 'agent', 'system'])
export const DecisionKindSchema = z.enum(['approval', 'retry', 'assignment', 'review', 'permission', 'runtime'])
export const DecisionStatusSchema = z.enum(['pending', 'approved', 'rejected', 'deferred'])
export const SquadStatusSchema = z.enum(['active', 'archived'])
export const EscalationTriggerSchema = z.enum([
  'requirement_conflict',
  'contract_conflict',
  'destructive_change',
  'production_data_change',
  'permission_required',
  'credential_required',
  'verification_unavailable',
  'repeated_failure',
  'scope_expansion',
  'delegation_conflict',
  'source_of_truth_unknown',
])
export const SquadEscalationPolicySchema = z.object({
  triggers: z.array(EscalationTriggerSchema).min(1).max(20),
  maxFocusedRepairAttempts: z.number().int().nonnegative().max(10),
  onTrigger: z.literal('request_decision'),
  pauseParentIssue: z.boolean(),
  cancelSiblingDelegations: z.boolean(),
  customInstructions: z.string().trim().max(10_000),
}).strict()
export const DEFAULT_SQUAD_ESCALATION_POLICY = {
  triggers: ['requirement_conflict', 'destructive_change', 'production_data_change', 'permission_required', 'verification_unavailable', 'repeated_failure', 'delegation_conflict'],
  maxFocusedRepairAttempts: 1,
  onTrigger: 'request_decision',
  pauseParentIssue: true,
  cancelSiblingDelegations: false,
  customInstructions: '',
} as const
export const DelegationContractSchema = z.object({
  objective: z.string().trim().min(1).max(10_000),
  scope: z.array(z.string().trim().min(1).max(2_000)).min(1).max(50),
  forbiddenScope: z.array(z.string().trim().min(1).max(2_000)).max(50).default([]),
  deliverables: z.array(z.string().trim().min(1).max(2_000)).min(1).max(50),
  acceptanceCriteria: z.array(z.string().trim().min(1).max(2_000)).min(1).max(50),
  verification: z.array(z.string().trim().min(1).max(2_000)).min(1).max(50),
  escalationConditions: z.array(z.string().trim().min(1).max(2_000)).min(1).max(50),
}).strict()

export const TaskAssignmentPolicySchema = z.object({
  mode: AssignmentModeSchema.default('single_agent'),
  riskLevel: TaskRiskLevelSchema.default('low'),
  requiredRoles: z.array(z.string().trim().min(1).max(200)).max(20).default([]),
  requiredCapabilities: z.array(z.string().trim().min(1).max(160)).max(50).default([]),
  allowedAgentIds: z.array(z.string().min(1)).max(100).default([]),
  allowedSquadIds: z.array(z.string().min(1)).max(50).default([]),
  requiresIndependentReviewer: z.boolean().default(false),
  maxParallel: z.number().int().positive().max(32).default(1),
  parallelGroup: z.string().trim().min(1).max(160).optional(),
  conflictKeys: z.array(z.string().trim().min(1).max(200)).max(50).default([]),
  allowedScope: z.array(z.string().trim().min(1).max(2_000)).max(100).default([]),
  forbiddenScope: z.array(z.string().trim().min(1).max(2_000)).max(50).default([]),
  escalationConditions: z.array(z.string().trim().min(1).max(2_000)).max(50).default([]),
}).strict()

export const TeamCompositionMemberSchema = z.object({
  agentId: z.string().min(1),
  projectRole: z.string().trim().max(200),
  deliveryRoles: z.array(DeliveryRoleSchema).max(7).default([]),
  source: z.enum(['manual', 'squad', 'retained_reference']),
  sourceId: z.string().min(1),
  capabilities: z.array(z.string().trim().min(1).max(160)).max(100).default([]),
  skillsDigest: z.string().length(64).optional(),
  personaDigest: z.string().length(64).optional(),
  runtimeId: z.string().min(1).optional(),
  runtimeStatus: RuntimeStatusSchema.optional(),
  maxConcurrency: z.number().int().positive().max(32).default(1),
  availableSlots: z.number().int().nonnegative().optional(),
}).strict()

export const TeamCompositionSquadSchema = z.object({
  squadId: z.string().min(1),
  isDefault: z.boolean().default(false),
  leaderAgentId: z.string().min(1),
  memberAgentIds: z.array(z.string().min(1)).min(1).max(100),
  collaborationPolicyVersion: z.string().trim().min(1).max(100).optional(),
  policyDigest: z.string().length(64).optional(),
  maxParallelDelegations: z.number().int().positive().max(32).default(1),
  syncedSquadUpdatedAt: z.string().min(1),
}).strict()

export const TeamCompositionSnapshotSchema = z.object({
  plannerAgentId: z.string().min(1).optional(),
  leadAgentId: z.string().min(1).optional(),
  reviewerAgentId: z.string().min(1).optional(),
  members: z.array(TeamCompositionMemberSchema).max(100),
  squads: z.array(TeamCompositionSquadSchema).max(50),
  teamDigest: z.string().length(64),
  capturedAt: z.string().min(1),
}).strict()

export const TaskAssignmentSnapshotSchema = z.object({
  taskId: z.string().min(1),
  policy: TaskAssignmentPolicySchema,
  ownerAgentId: z.string().min(1).optional(),
  ownerSquadId: z.string().min(1).optional(),
}).strict()

export const TeamCapacityObservationSchema = z.object({
  agents: z.array(z.object({
    agentId: z.string().min(1),
    availability: z.enum(['online', 'offline', 'unstable', 'unknown']),
    queued: z.number().int().nonnegative(),
    working: z.number().int().nonnegative(),
    occupied: z.number().int().nonnegative(),
    maxConcurrency: z.number().int().positive(),
    availableSlots: z.number().int().nonnegative(),
  }).strict()).max(100),
  squads: z.array(z.object({
    squadId: z.string().min(1),
    eligible: z.boolean(),
    activeDelegations: z.number().int().nonnegative(),
    maxParallelDelegations: z.number().int().positive(),
    availableSlots: z.number().int().nonnegative(),
  }).strict()).max(50),
}).strict()

export const ReviewerIndependencePolicySchema = z.object({
  required: z.boolean(),
  reviewerAgentId: z.string().min(1).optional(),
  excludedAgentIds: z.array(z.string().min(1)).max(100).default([]),
  basis: z.enum(['team_role', 'explicit', 'none']),
}).strict()

export const PlanSnapshotStatusSchema = z.enum(['candidate', 'approved', 'superseded', 'blocked'])
export const PlanSnapshotModeSchema = z.enum(['initial', 'append', 'revise'])
export const PlanSnapshotRecordSchema = z.object({
  id: z.string().min(1),
  projectId: z.string().min(1),
  revision: z.number().int().positive(),
  mode: PlanSnapshotModeSchema,
  taskIds: z.array(z.string().min(1)).max(1_000),
  planHash: z.string().length(64),
  teamComposition: TeamCompositionSnapshotSchema,
  teamDigest: z.string().length(64),
  assignmentDigest: z.string().length(64),
  requirementDigest: z.string().length(64).optional(),
  decisionDigest: z.string().length(64).optional(),
  requirementBundleIds: z.array(z.string().min(1)).max(100).optional(),
  sourceManifestDigest: z.string().length(64).optional(),
  requirementAnalysisDigest: z.string().length(64).optional(),
  requirementReviewId: z.string().min(1).optional(),
  requirementReviewDigest: z.string().length(64).optional(),
  requirementPromptVersion: z.string().trim().min(1).max(100).optional(),
  plannerPromptVersion: z.string().trim().min(1).max(100).optional(),
  planningContractVersion: z.union([z.literal(2), z.literal(3)]).optional(),
  planningOperationId: z.string().min(1).optional(),
  metricPolicyId: z.string().min(1).optional(),
  metricPolicyVersion: z.string().min(1).max(100).optional(),
  metricPolicyDigest: Sha256Schema.optional(),
  sourceInputId: z.string().min(1).optional(),
  sourceInputDigest: Sha256Schema.optional(),
  sourceProfileIds: z.array(z.string().min(1)).max(10_000).optional(),
  sourceCompletenessDigest: Sha256Schema.optional(),
  sourceManifestId: z.string().min(1).optional(),
  sourceManifestRecordDigest: Sha256Schema.optional(),
  sourceDispositionBindingIds: z.array(z.string().min(1)).max(10_000).optional(),
  sourceDispositionBindingDigest: Sha256Schema.optional(),
  acceptanceScenarioIds: z.array(z.string().min(1)).max(10_000).optional(),
  acceptanceScenarioDigest: Sha256Schema.optional(),
  acceptanceScenarioCoveragePolicyIds: z.array(z.string().min(1)).max(10_000).optional(),
  acceptanceScenarioCoveragePolicyDigest: Sha256Schema.optional(),
  planningRiskProfileId: z.string().min(1).optional(),
  planningRiskProfileDigest: Sha256Schema.optional(),
  scenarioCoverageReviewId: z.string().min(1).optional(),
  scenarioCoverageReviewDigest: Sha256Schema.optional(),
  bindingReviewId: z.string().min(1).optional(),
  bindingReviewDigest: Sha256Schema.optional(),
  planReviewId: z.string().min(1).optional(),
  planReviewDigest: Sha256Schema.optional(),
  sourcePolicyPrecheckId: z.string().min(1).optional(),
  sourcePolicyDigest: Sha256Schema.optional(),
  decisionOptionEffectIds: z.array(z.string().min(1)).max(20_000).optional(),
  decisionPlanningEffectIds: z.array(z.string().min(1)).max(2_000).optional(),
  decisionEffectPrecheckDigest: Sha256Schema.optional(),
  decisionEffectFinalDigest: Sha256Schema.optional(),
  repositoryPolicyBaselineId: z.string().min(1).optional(),
  repositoryPolicyBaselineDigest: Sha256Schema.optional(),
  repositorySnapshotId: z.string().min(1).optional(),
  repositoryDigest: Sha256Schema.optional(),
  repositoryStackProfileId: z.string().min(1).optional(),
  repositoryStackProfileDigest: Sha256Schema.optional(),
  repositoryEvidenceRetrievalReportId: z.string().min(1).optional(),
  repositoryEvidenceRetrievalReportDigest: Sha256Schema.optional(),
  canonicalTargetBindingId: z.string().min(1).optional(),
  canonicalTargetBindingDigest: Sha256Schema.optional(),
  policySnapshotId: z.string().min(1).optional(),
  policyDigest: Sha256Schema.optional(),
  policyFulfillmentIds: z.array(z.string().min(1)).max(1_000).optional(),
  policyFulfillmentDigest: Sha256Schema.optional(),
  promptReferenceManifestId: z.string().min(1).optional(),
  promptReferenceManifestDigest: Sha256Schema.optional(),
  planningReferenceMapId: z.string().min(1).optional(),
  planningReferenceMapDigest: Sha256Schema.optional(),
  assignmentEvaluationIds: z.array(z.string().min(1)).max(1_000).optional(),
  assignmentEvaluationDigest: Sha256Schema.optional(),
  taskPreflightIds: z.array(z.string().min(1)).max(1_000).optional(),
  taskPreflightDigest: Sha256Schema.optional(),
  convergenceCarryValidationIds: z.array(z.string().min(1)).max(20_000).optional(),
  convergenceCarryValidationDigest: Sha256Schema.optional(),
  convergenceRepairBaselineId: z.string().min(1).optional(),
  capabilityCatalogSnapshotId: z.string().min(1).optional(),
  capabilityCatalogDigest: Sha256Schema.optional(),
  accessGrantSnapshotId: z.string().min(1).optional(),
  accessGrantDigest: Sha256Schema.optional(),
  taskAssignments: z.array(TaskAssignmentSnapshotSchema).max(1_000).optional(),
  capacityObservation: TeamCapacityObservationSchema.optional(),
  reviewerIndependencePolicy: ReviewerIndependencePolicySchema.optional(),
  diagnostics: z.array(z.object({ code: z.string().trim().min(1).max(100), severity: z.enum(['info', 'warning', 'error']), message: z.string().trim().min(1).max(2_000) }).strict()).max(200).optional(),
  generatedBy: z.enum(['planner', 'human']).optional(),
  status: PlanSnapshotStatusSchema,
  supersedesId: z.string().min(1).optional(),
  createdAt: z.string().min(1),
  approvedAt: z.string().min(1).optional(),
}).strict()

export const RequirementSourceBlockSchema = z.object({
  documentKind: z.enum(['prd', 'technical_design']),
  locator: z.string().regex(/^pdf:[a-f0-9]{64}:page:\d+:block:\d+$/),
  page: z.number().int().positive().max(1_000),
  block: z.number().int().positive().max(10_000),
  text: z.string().trim().min(1).max(20_000),
  textDigest: z.string().length(64),
}).strict()

export const RequirementBundleModeSchema = z.enum(['initial', 'append', 'revise'])
export const RequirementBundleStatusSchema = z.enum(['active', 'superseded'])
export const RequirementBundleRecordSchema = z.object({
  id: z.string().min(1),
  projectId: z.string().min(1),
  title: z.string().trim().min(1).max(160),
  mode: RequirementBundleModeSchema,
  prd: z.string().min(1).max(500_000),
  technicalDesign: z.string().max(500_000),
  sourceRefs: z.array(z.string().trim().min(1).max(4_096)).max(100),
  sourceBlocks: z.array(RequirementSourceBlockSchema).max(10_000).optional(),
  idempotencyKey: z.string().trim().min(1).max(200).optional(),
  sourceDigest: z.string().length(64),
  status: RequirementBundleStatusSchema,
  supersedesId: z.string().min(1).optional(),
  createdAt: z.string().min(1),
  updatedAt: z.string().min(1),
}).strict()
export const RequirementItemKindSchema = z.enum(['fact', 'inference', 'unknown'])
export const RequirementItemStatusSchema = z.enum(['active', 'superseded'])
export const RequirementItemRecordSchema = z.object({
  id: z.string().min(1),
  projectId: z.string().min(1),
  bundleId: z.string().min(1),
  key: z.string().trim().min(1).max(240),
  kind: RequirementItemKindSchema,
  scope: z.enum(['in_scope', 'deferred', 'out_of_scope']).optional(),
  dispositionReason: z.string().trim().min(1).max(2_000).optional(),
  statement: z.string().trim().min(1).max(20_000),
  sourceRefs: z.array(z.string().trim().min(1).max(4_096)).max(100),
  status: RequirementItemStatusSchema,
  createdAt: z.string().min(1),
  updatedAt: z.string().min(1),
}).strict()
export const RequirementDecisionImpactSchema = z.enum(['low', 'medium', 'high', 'critical'])
export const RequirementDecisionStatusSchema = z.enum(['pending', 'resolved', 'deferred', 'rejected'])
export const DecisionEffectDimensionSchema = z.enum(['requirement', 'scenario', 'policy', 'binding', 'task_scope', 'dependency', 'verification', 'capability', 'assignment', 'release'])
const RequirementDecisionOptionSchema = z.object({
  id: z.string().trim().min(1).max(100),
  label: z.string().trim().min(1).max(2_000),
  impact: z.string().trim().max(2_000).optional(),
  affectedDimensions: z.array(DecisionEffectDimensionSchema).min(1).max(10).optional(),
  affectedObjectKeys: z.array(z.string().trim().min(1).max(240)).max(1_000).optional(),
  derivation: z.enum(['explicit', 'inferred', 'human_confirmed']).optional(),
  evidenceAnchorIds: z.array(z.string().trim().min(1).max(4_096)).min(1).max(1_000).optional(),
  potentiallyChangesDelivery: z.boolean().optional(),
}).strict()
export const RequirementDecisionRecordSchema = z.object({
  id: z.string().min(1),
  projectId: z.string().min(1),
  bundleId: z.string().min(1).optional(),
  key: z.string().trim().min(1).max(240),
  question: z.string().trim().min(1).max(20_000),
  options: z.array(RequirementDecisionOptionSchema).min(1).max(20),
  recommendedOption: z.string().trim().min(1).max(100).optional(),
  impact: RequirementDecisionImpactSchema,
  affectedRequirementIds: z.array(z.string().min(1)).max(100),
  affectedTaskIds: z.array(z.string().min(1)).max(100),
  sourceRefs: z.array(z.string().trim().min(1).max(4_096)).max(100).optional(),
  owner: z.string().trim().max(240).optional(),
  dueAt: z.string().min(1).optional(),
  status: RequirementDecisionStatusSchema,
  chosenOption: z.string().trim().min(1).max(100).optional(),
  resolution: z.string().trim().max(20_000).optional(),
  decidedBy: z.string().trim().max(240).optional(),
  decidedAt: z.string().min(1).optional(),
  resolutionRevision: z.number().int().positive().optional(),
  createdAt: z.string().min(1),
  updatedAt: z.string().min(1),
}).strict().superRefine((value, context) => {
  if (value.status === 'resolved' && value.chosenOption === undefined) context.addIssue({ code: z.ZodIssueCode.custom, path: ['chosenOption'], message: 'Resolved decisions require chosenOption.' })
  if (value.status === 'resolved' && value.decidedAt === undefined) context.addIssue({ code: z.ZodIssueCode.custom, path: ['decidedAt'], message: 'Resolved decisions require decidedAt.' })
})
export const RequirementDecisionInputSchema = z.object({
  bundleId: z.string().min(1).optional(),
  key: z.string().trim().min(1).max(240),
  question: z.string().trim().min(1).max(20_000),
  options: z.array(RequirementDecisionOptionSchema).min(1).max(20),
  recommendedOption: z.string().trim().min(1).max(100).optional(),
  impact: RequirementDecisionImpactSchema,
  affectedRequirementIds: z.array(z.string().min(1)).max(100).default([]),
  affectedTaskIds: z.array(z.string().min(1)).max(100).default([]),
  owner: z.string().trim().max(240).optional(),
  dueAt: z.string().min(1).optional(),
}).strict()
export const RequirementDecisionResolutionSchema = z.object({
  status: z.enum(['resolved', 'deferred', 'rejected']),
  chosenOption: z.string().trim().min(1).max(100).optional(),
  resolution: z.string().trim().min(1).max(20_000),
  decidedBy: z.string().trim().min(1).max(240),
}).strict()
export const AcceptanceCriterionStatusSchema = z.enum(['open', 'verified', 'failed', 'waived'])
export const AcceptanceCriterionRecordSchema = z.object({
  id: z.string().min(1),
  projectId: z.string().min(1),
  bundleId: z.string().min(1),
  requirementItemId: z.string().min(1).optional(),
  key: z.string().trim().min(1).max(240),
  statement: z.string().trim().min(1).max(2_000),
  sourceRefs: z.array(z.string().trim().min(1).max(4_096)).max(100),
  required: z.boolean().optional(),
  scenario: z.enum(['happy_path', 'business_rejection', 'boundary', 'dependency_failure', 'security', 'compatibility', 'recovery']).optional(),
  taskIds: z.array(z.string().min(1)).max(100),
  evidenceIds: z.array(z.string().min(1)).max(100),
  status: AcceptanceCriterionStatusSchema,
  createdAt: z.string().min(1),
  updatedAt: z.string().min(1),
}).strict()

function normalizeLegacyGoodScenario(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(normalizeLegacyGoodScenario)
  if (value === null || typeof value !== 'object') return value
  return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([key, entry]) => [
    key,
    key === 'scenario' && entry === 'good' ? 'happy_path' : normalizeLegacyGoodScenario(entry),
  ]))
}

// Keep immutable pre-v3.3 records byte-for-byte stable in memory so their
// stored digests remain valid. Service write paths use the strict schema above.
export const AcceptanceCriterionRecordStorageSchema = z.custom<z.infer<typeof AcceptanceCriterionRecordSchema>>(
  (value) => AcceptanceCriterionRecordSchema.safeParse(normalizeLegacyGoodScenario(value)).success,
  'Acceptance criterion storage record is invalid.',
)
export const VerificationEvidenceStatusSchema = z.enum(['passed', 'failed', 'unavailable'])
export const VerificationEvidenceKindSchema = z.enum(['test_command', 'artifact', 'delegation', 'review'])
export const VerificationEvidenceRecordSchema = z.object({
  id: z.string().min(1),
  projectId: z.string().min(1),
  taskId: z.string().min(1).optional(),
  taskRunId: z.string().min(1).optional(),
  attempt: z.number().int().positive().optional(),
  planSnapshotId: z.string().min(1).optional(),
  acceptanceIds: z.array(z.string().min(1)).max(100).default([]),
  kind: VerificationEvidenceKindSchema,
  status: VerificationEvidenceStatusSchema,
  command: z.string().max(10_000).optional(),
  exitCode: z.number().int().optional(),
  output: z.string().max(70_000).optional(),
  artifactIds: z.array(z.string().min(1)).max(500).default([]),
  actorType: ActivityActorTypeSchema,
  actorId: z.string().max(240).optional(),
  createdAt: z.string().min(1),
}).strict()
export const ProjectReviewStatusSchema = z.enum(['pending', 'approved', 'rejected', 'waived'])
export const ReviewerIndependenceWaiverSchema = z.object({
  reason: z.string().trim().min(1).max(10_000),
  owner: z.string().trim().min(1).max(240),
  risk: z.string().trim().min(1).max(10_000),
  followUpAction: z.string().trim().min(1).max(10_000),
}).strict()
export const ProjectReviewRecordSchema = z.object({
  id: z.string().min(1),
  projectId: z.string().min(1),
  revision: z.number().int().positive(),
  planSnapshotId: z.string().min(1).optional(),
  evidenceIds: z.array(z.string().min(1)).max(1_000),
  round: z.number().int().positive().default(1),
  acceptanceResults: z.array(z.object({ acceptanceId: z.string().min(1), result: z.enum(['passed', 'failed', 'waived', 'not_applicable']), evidenceIds: z.array(z.string().min(1)).max(100), note: z.string().max(2_000).optional() }).strict()).max(1_000).default([]),
  decision: z.enum(['approve', 'request_changes', 'reject', 'waive']).optional(),
  independencePassed: z.boolean().optional(),
  reviewerIndependenceWaiver: ReviewerIndependenceWaiverSchema.optional(),
  waivers: z.array(z.object({ acceptanceId: z.string().min(1), reason: z.string().trim().min(1).max(10_000), owner: z.string().trim().min(1).max(240) }).strict()).max(100).default([]),
  status: ProjectReviewStatusSchema,
  reviewerType: ActivityActorTypeSchema,
  reviewerId: z.string().max(240).optional(),
  summary: z.string().max(20_000),
  note: z.string().max(20_000).optional(),
  createdAt: z.string().min(1),
  resolvedAt: z.string().min(1).optional(),
}).strict()
export const ProjectReviewResolutionSchema = z.object({
  decision: z.enum(['approve', 'request_changes', 'reject', 'waive']),
  actor: z.string().trim().min(1).max(240),
  note: z.string().trim().min(1).max(20_000),
  waivers: z.array(z.object({ acceptanceId: z.string().min(1), reason: z.string().trim().min(1).max(10_000), owner: z.string().trim().min(1).max(240) }).strict()).max(100).default([]),
  reviewerIndependenceWaiver: ReviewerIndependenceWaiverSchema.optional(),
}).strict()
export const DeliveryResponsibilityChainSchema = z.object({
  plannerAgentId: z.string().min(1).optional(),
  leadAgentId: z.string().min(1).optional(),
  plannedReviewerAgentId: z.string().min(1).optional(),
  tasks: z.array(z.object({
    taskId: z.string().min(1),
    ownerAgentId: z.string().min(1).optional(),
    assignmentMode: AssignmentModeSchema,
    teamDigest: z.string().length(64).optional(),
    assignmentDigest: z.string().length(64).optional(),
    taskRunIds: z.array(z.string().min(1)).max(100),
    artifactIds: z.array(z.string().min(1)).max(500),
    verificationEvidenceIds: z.array(z.string().min(1)).max(500),
    delegationIds: z.array(z.string().min(1)).max(100),
    activityIds: z.array(z.string().min(1)).max(1_000),
    attemptCount: z.number().int().nonnegative(),
    wasReassigned: z.boolean(),
  }).strict()).max(1_000),
  delegations: z.array(z.object({
    delegationId: z.string().min(1),
    squadId: z.string().min(1),
    leaderAgentId: z.string().min(1),
    memberAgentId: z.string().min(1),
    childIssueId: z.string().min(1),
    status: z.enum(['queued', 'running', 'waiting_leader', 'completed', 'failed', 'cancelled', 'escalated']),
    taskRunId: z.string().min(1).optional(),
    taskRunIds: z.array(z.string().min(1)).max(100).default([]),
    retryTaskRunIds: z.array(z.string().min(1)).max(100).default([]),
    escalationDecisionIds: z.array(z.string().min(1)).max(100).default([]),
    reviewerId: z.string().max(240).optional(),
    evidenceIds: z.array(z.string().min(1)).max(500),
  }).strict()).max(1_000),
  verifications: z.array(z.object({
    evidenceId: z.string().min(1),
    taskId: z.string().min(1).optional(),
    taskRunId: z.string().min(1).optional(),
    actorType: ActivityActorTypeSchema,
    actorId: z.string().max(240).optional(),
    artifactIds: z.array(z.string().min(1)).max(500),
  }).strict()).max(2_000),
  reviewIds: z.array(z.string().min(1)).max(100),
  decisionIds: z.array(z.string().min(1)).max(1_000),
  retryTaskRunIds: z.array(z.string().min(1)).max(1_000).default([]),
  reassignedTaskIds: z.array(z.string().min(1)).max(1_000).default([]),
  escalationDecisionIds: z.array(z.string().min(1)).max(1_000).default([]),
  activityIds: z.array(z.string().min(1)).max(5_000),
}).strict()
export const DeliveryRecordStatusSchema = z.enum(['ready', 'delivered', 'closed'])
export const DeliveryRecordSchema = z.object({
  id: z.string().min(1),
  projectId: z.string().min(1),
  revision: z.number().int().positive(),
  planSnapshotId: z.string().min(1).optional(),
  reviewId: z.string().min(1).optional(),
  evidenceIds: z.array(z.string().min(1)).max(1_000),
  immutableDigest: z.string().length(64).optional(),
  repository: z.string().max(4_096).optional(),
  baseCommit: z.string().max(100).optional(),
  headCommit: z.string().max(100).optional(),
  branch: z.string().max(500).optional(),
  worktree: z.string().max(4_096).optional(),
  changedFiles: z.array(z.string().max(4_096)).max(2_000).default([]),
  diffStat: z.string().max(70_000).optional(),
  testSummary: z.string().max(20_000).optional(),
  knownRisks: z.array(z.string().max(2_000)).max(100).default([]),
  rollbackSteps: z.array(z.string().max(2_000)).max(100).default([]),
  handoffMode: z.enum(['local_review']).default('local_review'),
  teamDigest: z.string().length(64).optional(),
  assignmentDigest: z.string().length(64).optional(),
  requirementDigest: z.string().length(64).optional(),
  decisionDigest: z.string().length(64).optional(),
  responsibilityChain: DeliveryResponsibilityChainSchema.optional(),
  status: DeliveryRecordStatusSchema,
  deliveredBy: z.string().max(240).optional(),
  deliveredAt: z.string().min(1).optional(),
  closedAt: z.string().min(1).optional(),
  note: z.string().max(20_000).optional(),
  createdAt: z.string().min(1),
}).strict()
export const DelegationStatusSchema = z.enum(['queued', 'running', 'waiting_leader', 'completed', 'failed', 'cancelled', 'escalated'])
export const ArtifactKindSchema = z.enum(['diff', 'test_report', 'document', 'log', 'commit', 'pull_request'])
export const ArtifactStatusSchema = z.enum(['available', 'missing', 'failed'])
export const CommandTypeSchema = z.enum(['assign_issue', 'reassign_issue', 'stop_issue', 'continue_issue', 'approve_review', 'reject_review', 'request_decision', 'delegate_issue', 'retry_delegation', 'stop_delegation', 'autopilot_tick', 'reassign_task', 'bind_project_squad', 'sync_project_squad', 'validate_team', 'resolve_team_blocker'])
export const CommandStatusSchema = z.enum(['pending', 'running', 'completed', 'failed', 'cancelled'])
export const ExternalTriggerStatusSchema = z.enum(['received', 'processed', 'rejected', 'duplicate'])
export const InboxKindSchema = z.enum(['needs_decision', 'blocked', 'review_ready', 'runtime_offline', 'permission_denied', 'test_failed_after_retry', 'stale_approval'])
export const ProjectAgentMembershipStatusSchema = z.enum(['active', 'removed'])
export const ProjectSquadBindingStatusSchema = z.enum(['active', 'needs_review', 'removed'])
export const ProjectAgentMembershipSourceTypeSchema = z.enum(['manual', 'squad', 'retained_reference'])
export const ProjectAgentMembershipSourceStatusSchema = z.enum(['active', 'removed'])
export const FeatureUsageFeatureSchema = z.enum(['inbox', 'issues', 'projects', 'delivery', 'agents', 'skills', 'squads', 'runtimes', 'local_data'])

export const ProjectAgentMembershipRecordSchema = z.object({
  id: z.string().min(1),
  projectId: z.string().min(1),
  agentId: z.string().min(1),
  projectRole: z.string().trim().max(200),
  deliveryRoles: z.array(DeliveryRoleSchema).max(7).default([]),
  autoAssignable: z.boolean(),
  status: ProjectAgentMembershipStatusSchema,
  joinedBy: z.string().trim().min(1).max(240),
  joinedAt: z.string().min(1),
  updatedAt: z.string().min(1),
  removedAt: z.string().min(1).optional(),
}).strict().superRefine((value, context) => {
  if (value.id !== `${value.projectId}:${value.agentId}`) context.addIssue({ code: z.ZodIssueCode.custom, path: ['id'], message: 'Membership id must match projectId:agentId.' })
  if (value.status === 'active' && value.removedAt !== undefined) context.addIssue({ code: z.ZodIssueCode.custom, path: ['removedAt'], message: 'Active memberships cannot have removedAt.' })
  if (value.status === 'removed' && value.removedAt === undefined) context.addIssue({ code: z.ZodIssueCode.custom, path: ['removedAt'], message: 'Removed memberships require removedAt.' })
})

export const ProjectSquadBindingRecordSchema = z.object({
  id: z.string().min(1),
  projectId: z.string().min(1),
  squadId: z.string().min(1),
  status: ProjectSquadBindingStatusSchema,
  isDefault: z.boolean(),
  syncedSquadUpdatedAt: z.string().min(1),
  boundBy: z.string().trim().min(1).max(240),
  boundAt: z.string().min(1),
  updatedAt: z.string().min(1),
  removedAt: z.string().min(1).optional(),
}).strict().superRefine((value, context) => {
  if (value.id !== `${value.projectId}:${value.squadId}`) context.addIssue({ code: z.ZodIssueCode.custom, path: ['id'], message: 'Binding id must match projectId:squadId.' })
  if (value.status === 'removed' && value.removedAt === undefined) context.addIssue({ code: z.ZodIssueCode.custom, path: ['removedAt'], message: 'Removed bindings require removedAt.' })
  if (value.status !== 'removed' && value.removedAt !== undefined) context.addIssue({ code: z.ZodIssueCode.custom, path: ['removedAt'], message: 'Active bindings cannot have removedAt.' })
  if (value.status === 'removed' && value.isDefault) context.addIssue({ code: z.ZodIssueCode.custom, path: ['isDefault'], message: 'Removed bindings cannot be default.' })
})

export const ProjectAgentMembershipSourceRecordSchema = z.object({
  id: z.string().min(1),
  projectId: z.string().min(1),
  agentId: z.string().min(1),
  sourceType: ProjectAgentMembershipSourceTypeSchema,
  sourceId: z.string().min(1),
  projectRole: z.string().trim().max(200),
  autoAssignable: z.boolean(),
  status: ProjectAgentMembershipSourceStatusSchema,
  createdAt: z.string().min(1),
  updatedAt: z.string().min(1),
  removedAt: z.string().min(1).optional(),
}).strict().superRefine((value, context) => {
  if (value.id !== `${value.projectId}:${value.agentId}:${value.sourceType}:${value.sourceId}`) context.addIssue({ code: z.ZodIssueCode.custom, path: ['id'], message: 'Membership source id must match projectId:agentId:sourceType:sourceId.' })
  if (value.status === 'active' && value.removedAt !== undefined) context.addIssue({ code: z.ZodIssueCode.custom, path: ['removedAt'], message: 'Active membership sources cannot have removedAt.' })
  if (value.status === 'removed' && value.removedAt === undefined) context.addIssue({ code: z.ZodIssueCode.custom, path: ['removedAt'], message: 'Removed membership sources require removedAt.' })
})

export const FeatureUsageDailyRecordSchema = z.object({
  id: z.string().min(1),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  feature: FeatureUsageFeatureSchema,
  opens: z.number().int().nonnegative(),
  meaningfulActions: z.number().int().nonnegative(),
  errorRecoveries: z.number().int().nonnegative(),
  lastUsedAt: z.string().min(1),
}).strict().superRefine((value, context) => {
  if (value.id !== `${value.date}:${value.feature}`) context.addIssue({ code: z.ZodIssueCode.custom, path: ['id'], message: 'Usage id must match date:feature.' })
})
export const DecisionRecordSchema = z.object({
  id: z.string().min(1),
  projectId: z.string().min(1).optional(),
  issueId: z.string().min(1).optional(),
  taskRunId: z.string().min(1).optional(),
  kind: DecisionKindSchema,
  title: z.string().trim().min(1).max(240),
  prompt: z.string().trim().min(1).max(20_000),
  status: DecisionStatusSchema,
  requestedByType: ActivityActorTypeSchema,
  requestedById: z.string().max(240).optional(),
  resolvedBy: z.string().max(240).optional(),
  resolution: z.string().max(20_000).optional(),
  metadata: z.record(z.string(), z.unknown()).default({}),
  createdAt: z.string().min(1),
  resolvedAt: z.string().min(1).optional(),
}).strict()

export const DecisionInputSchema = z.object({
  projectId: z.string().min(1).optional(),
  issueId: z.string().min(1).optional(),
  taskRunId: z.string().min(1).optional(),
  kind: DecisionKindSchema,
  title: z.string().trim().min(1).max(240),
  prompt: z.string().trim().min(1).max(20_000),
  requestedByType: ActivityActorTypeSchema.default('system'),
  requestedById: z.string().max(240).optional(),
  metadata: z.record(z.string(), z.unknown()).default({}),
}).strict()

export const DecisionResolutionSchema = z.object({
  status: z.enum(['approved', 'rejected', 'deferred']),
  resolution: z.string().trim().min(1).max(20_000),
  resolvedBy: z.string().trim().min(1).max(240),
}).strict()

export const InboxQuerySchema = z.object({
  kind: InboxKindSchema.optional(),
  projectId: z.string().min(1).optional(),
  issueId: z.string().min(1).optional(),
  limit: z.coerce.number().int().positive().max(500).default(100),
}).strict()

export const InboxActionSchema = z.object({
  action: z.enum(['approve', 'reject', 'defer', 'retry']),
  resolution: z.string().trim().min(1).max(20_000),
  actor: z.string().trim().min(1).max(240),
}).strict()

export const SquadRecordSchema = z.object({
  id: z.string().min(1),
  name: z.string().trim().min(1).max(160),
  description: z.string().trim().max(1_000),
  leaderAgentId: z.string().min(1),
  memberAgentIds: z.array(z.string().min(1)).min(1).max(100),
  memberRoles: z.record(z.string(), z.string().trim().min(1).max(200)).default({}),
  instructions: z.string().trim().min(1).max(20_000),
  escalationPolicy: z.string().trim().min(1).max(10_000),
  escalationConfig: SquadEscalationPolicySchema.optional(),
  collaborationPolicyVersion: z.string().trim().min(1).max(100).optional(),
  maxParallelDelegations: z.number().int().positive().max(32).default(1),
  status: SquadStatusSchema,
  createdAt: z.string().min(1),
  updatedAt: z.string().min(1),
}).strict()

export const DelegationRecordSchema = z.object({
  id: z.string().min(1),
  squadId: z.string().min(1),
  projectId: z.string().min(1),
  parentIssueId: z.string().min(1),
  parentAssignmentRevision: z.number().int().nonnegative().optional(),
  coordinationTaskRunId: z.string().min(1).optional(),
  childIssueId: z.string().min(1),
  leaderAgentId: z.string().min(1),
  memberAgentId: z.string().min(1),
  taskRunId: z.string().min(1).optional(),
  commandId: z.string().min(1).optional(),
  status: DelegationStatusSchema,
  instruction: z.string().trim().min(1).max(20_000),
  contract: DelegationContractSchema.optional(),
  contractDigest: z.string().length(64).optional(),
  teamDigest: z.string().length(64).optional(),
  planSnapshotId: z.string().min(1).optional(),
  parentAcceptanceIds: z.array(z.string().min(1)).max(100).optional(),
  childTaskIds: z.array(z.string().min(1)).max(100).optional(),
  sourceRequirementIds: z.array(z.string().min(1)).max(100).optional(),
  assignmentDigest: z.string().length(64).optional(),
  evidenceIds: z.array(z.string().min(1)).max(500).optional(),
  reviewerId: z.string().max(240).optional(),
  resultSummary: z.string().max(20_000).optional(),
  error: z.string().max(20_000).optional(),
  createdAt: z.string().min(1),
  updatedAt: z.string().min(1),
  completedAt: z.string().min(1).optional(),
}).strict()

export const TranscriptEntrySchema = z.object({
  id: z.string().min(1),
  taskRunId: z.string().min(1),
  sequence: z.number().int().nonnegative(),
  role: z.enum(['user', 'assistant', 'tool', 'system']),
  kind: z.string().trim().min(1).max(100),
  text: z.string().max(20_000),
  createdAt: z.string().min(1),
}).strict()

export const ArtifactRecordSchema = z.object({
  id: z.string().min(1),
  projectId: z.string().min(1),
  issueId: z.string().min(1).optional(),
  taskRunId: z.string().min(1).optional(),
  kind: ArtifactKindSchema,
  name: z.string().trim().min(1).max(240),
  status: ArtifactStatusSchema,
  uri: z.string().max(4_096).optional(),
  content: z.string().max(100_000).optional(),
  metadata: z.record(z.string(), z.unknown()).default({}),
  createdAt: z.string().min(1),
}).strict()

export const CommandRecordSchema = z.object({
  id: z.string().min(1),
  idempotencyKey: z.string().min(1).max(240).optional(),
  requestDigest: z.string().length(64).optional(),
  type: CommandTypeSchema,
  status: CommandStatusSchema,
  projectId: z.string().min(1).optional(),
  issueId: z.string().min(1).optional(),
  squadId: z.string().min(1).optional(),
  actorType: ActivityActorTypeSchema,
  actorId: z.string().max(240).optional(),
  payload: z.record(z.string(), z.unknown()).default({}),
  result: z.record(z.string(), z.unknown()).optional(),
  error: z.string().max(20_000).optional(),
  createdAt: z.string().min(1),
  completedAt: z.string().min(1).optional(),
}).strict()

export const ExternalTriggerRecordSchema = z.object({
  id: z.string().min(1),
  source: z.string().trim().min(1).max(160),
  externalKey: z.string().trim().min(1).max(500),
  payloadDigest: z.string().length(64),
  status: ExternalTriggerStatusSchema,
  commandId: z.string().min(1).optional(),
  receivedAt: z.string().min(1),
  processedAt: z.string().min(1).optional(),
}).strict()

export const LocalDirectoryLockRecordSchema = z.object({
  id: z.string().min(1),
  canonicalPath: z.string().min(1).max(4_096),
  taskRunId: z.string().min(1),
  projectId: z.string().min(1),
  acquiredAt: z.string().min(1),
  heartbeatAt: z.string().min(1),
}).strict()

export const WorkspaceLeaseRecordSchema = z.object({
  id: z.string().min(1),
  taskRunId: z.string().min(1),
  projectId: z.string().min(1),
  resourceId: z.string().min(1).optional(),
  runtimeId: z.string().min(1).optional(),
  mode: ResourceExecutionModeSchema,
  sourcePath: z.string().min(1).max(4_096),
  workspacePath: z.string().min(1).max(4_096),
  branchName: z.string().min(1).max(500).optional(),
  baseCommit: z.string().min(1).max(100).optional(),
  state: z.enum(['preparing', 'active', 'releasing', 'released', 'orphaned']),
  acquiredAt: z.string().min(1),
  heartbeatAt: z.string().min(1),
  releasedAt: z.string().min(1).optional(),
  cleanupError: z.string().max(20_000).optional(),
}).strict()

export const WorkspaceWriterLeaseRecordSchema = z.object({
  id: z.string().length(64),
  workspaceIdentityDigest: z.string().length(64),
  ownerInstanceId: z.string().min(1).max(240),
  ownerPid: z.number().int().positive(),
  ownerHostId: z.string().min(1).max(240),
  fencingToken: z.number().int().positive(),
  acquiredAt: z.string().min(1),
  heartbeatAt: z.string().min(1),
  releasedAt: z.string().min(1).optional(),
  releaseReason: z.string().min(1).max(2_000).optional(),
  schemaVersion: z.literal(1),
}).strict().superRefine((value, context) => {
  if (value.id !== value.workspaceIdentityDigest) context.addIssue({ code: z.ZodIssueCode.custom, path: ['id'], message: 'Workspace writer lease key must equal the workspace identity digest.' })
})
export const TaskRunConflictLockRecordSchema = z.object({
  id: z.string().min(1),
  projectId: z.string().min(1),
  taskRunId: z.string().min(1),
  conflictKey: z.string().trim().min(1).max(200),
  acquiredAt: z.string().min(1),
  heartbeatAt: z.string().min(1),
  releasedAt: z.string().min(1).optional(),
}).strict()

export const SkillRecordSchema = z.object({
  id: z.string().min(1),
  name: z.string().trim().min(1).max(160),
  description: z.string().trim().max(1_000),
  source: z.enum(['agent', 'workspace', 'builtin']),
  agentIds: z.array(z.string().min(1)).max(1_000),
  updatedAt: z.string().min(1),
}).strict()

export const CommentRecordSchema = z.object({
  id: z.string().min(1),
  issueId: z.string().min(1),
  authorType: ActivityActorTypeSchema,
  authorId: z.string().max(240).optional(),
  body: z.string().trim().min(1).max(20_000),
  createdAt: z.string().min(1),
}).strict()

const OwnerSchema = z.string().trim().max(200)
const TagsSchema = z.array(z.string().trim().min(1).max(64)).max(50)
  .refine((values) => new Set(values).size === values.length, 'Tags must be unique.')
const SkillsSchema = z.array(z.string().trim().min(1).max(100)).max(50)
  .refine((values) => new Set(values).size === values.length, 'Skills must be unique.')
export const ProjectStatusSchema = z.enum([
  'draft',
  'decomposing',
  'awaiting_approval',
  'approved',
  'running',
  'completed',
  'failed',
  'cancelled',
])
export const TaskKindSchema = z.enum(['code', 'test'])
export const BoardStageSchema = z.enum(['planned', 'todo', 'in_progress', 'review'])
export const TaskStatusSchema = z.enum([
  'draft',
  'queued',
  'running',
  'verifying',
  'completed',
  'failed',
  'blocked',
  'cancelled',
])
export const RunStatusSchema = z.enum(['queued', 'running', 'completed', 'failed', 'cancelled'])

export const RuntimeRecordSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1).max(160),
  machineId: z.string().min(1).max(240),
  status: RuntimeStatusSchema,
  lifecycle: RuntimeLifecycleSchema.default('active'),
  capabilities: z.array(z.string().trim().min(1).max(160)).max(100),
  agentCli: z.string().max(160).optional(),
  workspaceRoot: z.string().max(4_096).optional(),
  lastHeartbeatAt: z.string().min(1),
  archivedAt: z.string().min(1).optional(),
  createdAt: z.string().min(1),
  updatedAt: z.string().min(1),
}).strict().superRefine((value, context) => {
  if (value.lifecycle === 'active' && value.archivedAt !== undefined) context.addIssue({ code: z.ZodIssueCode.custom, path: ['archivedAt'], message: 'Active Runtime cannot have archivedAt.' })
  if (value.lifecycle === 'archived' && value.archivedAt === undefined) context.addIssue({ code: z.ZodIssueCode.custom, path: ['archivedAt'], message: 'Archived Runtime requires archivedAt.' })
})

export const ProjectResourceSchema = z.object({
  id: z.string().min(1),
  projectId: z.string().min(1),
  kind: ResourceKindSchema,
  location: z.string().trim().min(1).max(4_096),
  ref: z.string().trim().max(500).optional(),
  sourcePath: z.string().trim().min(1).max(4_096).optional(),
  executionMode: ResourceExecutionModeSchema,
  runtimeId: z.string().min(1).optional(),
  createdAt: z.string().min(1),
  updatedAt: z.string().min(1),
}).strict()

export const IssueRecordSchema = z.object({
  id: z.string().min(1),
  projectId: z.string().min(1).optional(),
  parentIssueId: z.string().min(1).optional(),
  title: z.string().min(1).max(240),
  description: z.string().max(100_000),
  status: IssueStatusSchema,
  priority: PrioritySchema.default('medium'),
  assigneeType: IssueAssigneeTypeSchema.optional(),
  assigneeId: z.string().min(1).optional(),
  labels: z.array(z.string().trim().min(1).max(64)).max(50).default([]),
  assignmentRevision: z.number().int().nonnegative().optional(),
  activeTaskRunId: z.string().min(1).optional(),
  reviewStatus: z.enum(['not_requested', 'pending', 'approved', 'changes_requested']).optional(),
  reviewedBy: z.string().max(240).optional(),
  reviewedAt: z.string().min(1).optional(),
  reviewNote: z.string().max(20_000).optional(),
  createdAt: z.string().min(1),
  updatedAt: z.string().min(1),
}).strict()

export const TaskRunRecordSchema = z.object({
  id: z.string().min(1),
  projectId: z.string().min(1),
  issueId: z.string().min(1).optional(),
  taskId: z.string().min(1).optional(),
  planSnapshotId: z.string().min(1).optional(),
  deliveryTaskRevision: z.number().int().positive().optional(),
  planningRepositorySnapshotId: z.string().min(1).optional(),
  planningRepositoryDigest: Sha256Schema.optional(),
  planningPolicyDigest: Sha256Schema.optional(),
  accessGrantSnapshotId: z.string().min(1).optional(),
  accessGrantSnapshotDigest: Sha256Schema.optional(),
  canonicalTargetBindingId: z.string().min(1).optional(),
  canonicalTargetBindingDigest: Sha256Schema.optional(),
  assignmentDecisionId: z.string().min(1).optional(),
  runId: z.string().min(1).optional(),
  agentId: z.string().min(1).optional(),
  runtimeId: z.string().min(1).optional(),
  runtimeNameSnapshot: z.string().min(1).max(160).optional(),
  claimVersion: z.number().int().positive().optional(),
  claimTokenDigest: Sha256Schema.optional(),
  claimOwnerId: z.string().min(1).max(240).optional(),
  leaseExpiresAt: z.string().min(1).optional(),
  lastHeartbeatAt: z.string().min(1).optional(),
  executionContractDigest: Sha256Schema.optional(),
  failureDisposition: z.enum(['retryable', 'non_retryable', 'needs_reconciliation']).optional(),
  status: TaskRunStatusSchema,
  trigger: z.enum(['assignment', 'mention', 'approval', 'retry', 'autopilot', 'system']),
  attempt: z.number().int().positive(),
  retryOf: z.string().min(1).optional(),
  assignmentRevision: z.number().int().nonnegative().optional(),
  commandId: z.string().min(1).optional(),
  squadId: z.string().min(1).optional(),
  delegatedByTaskRunId: z.string().min(1).optional(),
  resumeDelegationId: z.string().min(1).optional(),
  resumeDecisionId: z.string().min(1).optional(),
  finishedReason: z.enum(['completed', 'stopped', 'reassigned', 'review_rejected', 'failed', 'decision_requested']).optional(),
  promptVersion: z.string().trim().min(1).max(100).optional(),
  promptDigest: z.string().length(64).optional(),
  promptContextDigest: z.string().length(64).optional(),
  collaborationPolicyVersion: z.string().trim().min(1).max(100).optional(),
  assignmentDigest: z.string().length(64).optional(),
  teamDigest: z.string().length(64).optional(),
  promptDiagnostics: z.array(z.object({ code: z.string().trim().min(1).max(100), severity: z.enum(['info', 'warning']) }).strict()).max(50).optional(),
  sessionId: z.string().min(1).optional(),
  cwd: z.string().min(1).max(4_096).optional(),
  resourceId: z.string().min(1).optional(),
  workspace: z.string().min(1).max(4_096).optional(),
  branch: z.string().min(1).max(500).optional(),
  baseCommit: z.string().min(1).max(100).optional(),
  headCommit: z.string().min(1).max(100).optional(),
  actualBaseCommit: z.string().regex(/^[0-9a-f]{40,64}$/u).optional(),
  outputCommit: z.string().regex(/^[0-9a-f]{40,64}$/u).optional(),
  outputTree: z.string().regex(/^[0-9a-f]{40,64}$/u).optional(),
  outputDiffDigest: Sha256Schema.optional(),
  outputPatchIds: z.array(Sha256Schema).max(10_000).optional(),
  outputChangedPaths: z.array(z.object({
    path: z.string().min(1).max(4_096),
    beforeBlob: z.string().min(1).max(200).optional(),
    afterBlob: z.string().min(1).max(200).optional(),
    beforeMode: z.string().min(1).max(20).optional(),
    afterMode: z.string().min(1).max(20).optional(),
  }).strict()).max(2_000).optional(),
  diffSummary: z.string().max(70_000).optional(),
  changedFiles: z.array(z.string().max(4_096)).max(2_000).optional(),
  changedFileDigests: z.array(z.object({ path: z.string().min(1).max(4_096), digest: z.string().min(1).max(200) }).strict()).max(2_000).optional(),
  diffStat: z.string().max(70_000).optional(),
  artifactIds: z.array(z.string().min(1)).max(500).optional(),
  dispatchedAt: z.string().min(1).optional(),
  waitReason: z.enum(['runtime', 'capacity', 'parallel_group', 'conflict', 'workspace']).optional(),
  waitStartedAt: z.string().min(1).optional(),
  waitDurationsMs: z.object({
    runtime: z.number().int().nonnegative().default(0),
    capacity: z.number().int().nonnegative().default(0),
    parallelGroup: z.number().int().nonnegative().default(0),
    conflict: z.number().int().nonnegative().default(0),
    workspace: z.number().int().nonnegative().default(0),
  }).strict().optional(),
  waitCounts: z.object({
    runtime: z.number().int().nonnegative().default(0),
    capacity: z.number().int().nonnegative().default(0),
    parallelGroup: z.number().int().nonnegative().default(0),
    conflict: z.number().int().nonnegative().default(0),
    workspace: z.number().int().nonnegative().default(0),
  }).strict().optional(),
  durationMs: z.number().int().nonnegative().optional(),
  provider: z.string().max(200).optional(),
  model: z.string().max(300).optional(),
  inputTokens: z.number().int().nonnegative().optional(),
  outputTokens: z.number().int().nonnegative().optional(),
  costUsd: z.number().nonnegative().optional(),
  error: z.string().max(20_000).optional(),
  errorCode: TaskRunErrorCodeSchema.optional(),
  testExitCode: z.number().int().optional(),
  testOutput: z.string().max(70_000).optional(),
  executionEnvironment: z.enum(['host_path', 'project_venv']).optional(),
  virtualEnvPath: z.string().min(1).max(4_096).optional(),
  createdAt: z.string().min(1),
  startedAt: z.string().min(1).optional(),
  completedAt: z.string().min(1).optional(),
}).strict().superRefine((value, context) => {
  const claimed = value.claimTokenDigest !== undefined || value.claimOwnerId !== undefined || value.leaseExpiresAt !== undefined || value.executionContractDigest !== undefined
  if (claimed && (value.claimTokenDigest === undefined || value.claimOwnerId === undefined || value.leaseExpiresAt === undefined || value.executionContractDigest === undefined)) context.addIssue({ code: z.ZodIssueCode.custom, path: ['claimTokenDigest'], message: 'A TaskRun execution claim requires token, owner, lease, and frozen contract digest.' })
  if (['dispatched', 'running'].includes(value.status) && value.claimTokenDigest !== undefined && value.lastHeartbeatAt === undefined) context.addIssue({ code: z.ZodIssueCode.custom, path: ['lastHeartbeatAt'], message: 'A claimed active TaskRun requires a heartbeat timestamp.' })
})

export const ActivityEventSchema = z.object({
  id: z.string().min(1),
  projectId: z.string().min(1).optional(),
  issueId: z.string().min(1).optional(),
  taskRunId: z.string().min(1).optional(),
  actorType: ActivityActorTypeSchema,
  actorId: z.string().max(240).optional(),
  type: z.string().trim().min(1).max(100),
  message: z.string().trim().min(1).max(20_000),
  metadata: z.record(z.string(), z.unknown()).default({}),
  createdAt: z.string().min(1),
}).strict()

export const DomainEventRecordSchema = z.object({
  eventId: z.string().min(1),
  sequence: z.number().int().positive(),
  aggregateType: z.string().trim().min(1).max(100),
  aggregateId: z.string().min(1).max(500),
  eventType: z.string().trim().min(1).max(160),
  occurredAt: z.string().min(1),
  actor: z.string().trim().min(1).max(240),
  projectId: z.string().min(1).optional(),
  operationId: z.string().min(1).optional(),
  taskRunId: z.string().min(1).optional(),
  payloadRef: z.string().min(1).max(1_000).optional(),
  payloadDigest: Sha256Schema,
  schemaVersion: z.literal(1),
}).strict()

export const DomainEventPageSchema = z.object({
  events: z.array(DomainEventRecordSchema).max(500),
  nextCursor: z.string().regex(/^\d+$/u),
  latestCursor: z.string().regex(/^\d+$/u),
  hasMore: z.boolean(),
}).strict()

export const AgentRecordSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1).max(100),
  role: z.string().min(1).max(200),
  description: z.string().max(500),
  persona: z.string().min(1).max(20_000),
  provider: z.string().max(200).optional(),
  model: z.string().max(300).optional(),
  preset: z.string().min(1).max(100),
  toolPolicy: AgentToolPolicySchema,
  skills: SkillsSchema.optional(),
  capabilities: z.array(z.string().trim().min(1).max(160)).max(100).optional(),
  runtimeId: z.string().min(1).optional(),
  access: z.enum(['only_me', 'workspace', 'specific_people']).optional(),
  maxConcurrency: z.number().int().positive().max(32).optional(),
  status: AgentStatusSchema,
  createdAt: z.string().min(1),
  updatedAt: z.string().min(1),
})

export const DecompositionBatchSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1).max(160),
  prd: z.string().min(1).max(500_000),
  technicalDesign: z.string().max(500_000),
  sourceBlocks: z.array(RequirementSourceBlockSchema).max(10_000).optional(),
  idempotencyKey: z.string().trim().min(1).max(200).optional(),
  requestDigest: z.string().length(64).optional(),
  supersedesId: z.string().min(1).optional(),
  requirementBundleId: z.string().min(1).optional(),
  taskIds: z.array(z.string().min(1)).max(1_000),
  sessionId: z.string().min(1).optional(),
  createdAt: z.string().min(1),
  updatedAt: z.string().min(1),
}).strict()

export const ProjectRecordSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1).max(160),
  summary: z.string().max(1_000),
  cwd: z.string().min(1).max(4_096),
  prd: z.string().max(500_000),
  technicalDesign: z.string().max(500_000),
  prdSourceBlocks: z.array(RequirementSourceBlockSchema).max(10_000).optional(),
  technicalDesignSourceBlocks: z.array(RequirementSourceBlockSchema).max(10_000).optional(),
  priority: PrioritySchema.optional(),
  owner: OwnerSchema.optional(),
  taskLanguage: TaskLanguageSchema.optional(),
  status: ProjectStatusSchema,
  revision: z.number().int().positive(),
  approvedRevision: z.number().int().positive().optional(),
  taskIds: z.array(z.string().min(1)).max(1_000),
  decompositionBatches: z.array(DecompositionBatchSchema).max(100).optional(),
  resourceIds: z.array(z.string().min(1)).max(100).optional(),
  issueIds: z.array(z.string().min(1)).max(1_000).optional(),
  workspaceId: z.string().min(1).max(240).optional(),
  leadAgentId: z.string().min(1).optional(),
  deliveryStage: ProjectDeliveryStageSchema.optional(),
  teamComposition: TeamCompositionSnapshotSchema.optional(),
  teamDigest: z.string().length(64).optional(),
  assignmentDigest: z.string().length(64).optional(),
  requirementDigest: z.string().length(64).optional(),
  decisionDigest: z.string().length(64).optional(),
  currentPlanSnapshotId: z.string().min(1).optional(),
  currentDeliveryIntegrationSnapshotId: z.string().min(1).optional(),
  currentDeliveryConvergenceReviewId: z.string().min(1).optional(),
  currentConvergenceRepairBaselineId: z.string().min(1).optional(),
  planningContractVersion: z.union([z.literal(2), z.literal(3)]).optional(),
  activePlanningOperationId: z.string().min(1).optional(),
  decompositionSessionId: z.string().optional(),
  activeDecompositionKey: z.string().trim().min(1).max(200).optional(),
  activeDecompositionDigest: z.string().length(64).optional(),
  activeRunId: z.string().optional(),
  lastError: z.string().max(20_000).optional(),
  createdAt: z.string().min(1),
  updatedAt: z.string().min(1),
})

const TaskAttemptSchema = z.object({
  attempt: z.number().int().positive(),
  sessionId: z.string().optional(),
  exitCode: z.number().int().optional(),
  output: z.string().max(70_000).optional(),
  failureReason: z.string().max(20_000).optional(),
  createdAt: z.string().min(1),
}).strict()

export const TaskRecordSchema = z.object({
  id: z.string().min(1),
  projectId: z.string().min(1),
  ordinal: z.number().int().nonnegative(),
  title: z.string().min(1).max(240),
  kind: TaskKindSchema,
  description: z.string().min(1).max(20_000),
  acceptanceCriteria: z.array(z.string().min(1).max(2_000)).min(1).max(100),
  completionCriteria: z.array(z.string().min(1).max(2_000)).min(1).max(100).optional(),
  dependencies: z.array(z.string().min(1)).max(100),
  priority: PrioritySchema.optional(),
  tags: TagsSchema.optional(),
  agentId: z.string().optional(),
  testCommand: z.string().min(1).max(10_000),
  sourceRequirementIds: z.array(z.string().min(1)).max(100).optional(),
  acceptanceIds: z.array(z.string().min(1)).max(100).optional(),
  decisionIds: z.array(z.string().min(1)).max(100).optional(),
  planningContractVersion: z.union([z.literal(2), z.literal(3)]).optional(),
  taskRevision: z.number().int().positive().optional(),
  workPackageId: z.string().min(1).optional(),
  referenceMapId: z.string().min(1).optional(),
  bindingIds: z.array(z.string().min(1)).max(100).optional(),
  scenarioIds: z.array(z.string().min(1)).max(200).optional(),
  policyConstraintIds: z.array(z.string().min(1)).max(100).optional(),
  evidenceIds: z.array(z.string().min(1)).max(100).optional(),
  commandEvidenceIds: z.array(z.string().min(1)).max(100).optional(),
  capabilityRequirementId: z.string().min(1).optional(),
  assignmentDecisionId: z.string().min(1).optional(),
  taskContextPackDigest: Sha256Schema.optional(),
  taskPreflightId: z.string().min(1).optional(),
  taskPreflightDigest: Sha256Schema.optional(),
  assignmentPolicy: TaskAssignmentPolicySchema.optional(),
  assignmentSource: z.enum(['planner_recommendation', 'automatic_match', 'manual']).optional(),
  assignmentDigest: z.string().length(64).optional(),
  teamDigest: z.string().length(64).optional(),
  planSnapshotId: z.string().min(1).optional(),
  relationship: z.enum(['implementation', 'verification', 'review', 'handoff', 'migration', 'release']).optional(),
  status: TaskStatusSchema,
  boardStage: BoardStageSchema.optional(),
  sessionId: z.string().optional(),
  latestRunId: z.string().optional(),
  issueId: z.string().min(1).optional(),
  latestTaskRunId: z.string().min(1).optional(),
  testExitCode: z.number().int().optional(),
  testOutput: z.string().max(70_000).optional(),
  resultSummary: z.string().max(20_000).optional(),
  failureReason: z.string().max(20_000).optional(),
  attemptCount: z.number().int().nonnegative().optional(),
  attempts: z.array(TaskAttemptSchema).max(20).optional(),
  createdAt: z.string().min(1),
  updatedAt: z.string().min(1),
})

export const ApprovalRecordSchema = z.object({
  id: z.string().min(1),
  projectId: z.string().min(1),
  revision: z.number().int().positive(),
  planHash: z.string().length(64),
  teamDigest: z.string().length(64).optional(),
  assignmentDigest: z.string().length(64).optional(),
  planSnapshotId: z.string().min(1).optional(),
  requirementDigest: z.string().length(64).optional(),
  decisionDigest: z.string().length(64).optional(),
  approvedTaskIds: z.array(z.string().min(1)).max(1_000).optional(),
  actor: z.string().min(1).max(200),
  approvedAt: z.string().min(1),
})

export const RunRecordSchema = z.object({
  id: z.string().min(1),
  projectId: z.string().min(1),
  status: RunStatusSchema,
  currentTaskId: z.string().optional(),
  approvalRevision: z.number().int().positive().optional(),
  approvalPlanHash: z.string().length(64).optional(),
  teamDigest: z.string().length(64).optional(),
  assignmentDigest: z.string().length(64).optional(),
  planSnapshotId: z.string().min(1).optional(),
  executionDispatchId: z.string().min(1).optional(),
  dispatchedTaskIds: z.array(z.string().min(1)).max(1_000).optional(),
  taskRunIdsByTaskId: z.record(z.string(), z.string().min(1)).optional(),
  taskRunIds: z.array(z.string().min(1)).max(1_000).optional(),
  error: z.string().max(20_000).optional(),
  createdAt: z.string().min(1),
  startedAt: z.string().optional(),
  completedAt: z.string().optional(),
})

export const GeneratedTaskSchema = z.object({
  id: z.string().regex(/^[a-z][a-z0-9_-]{0,63}$/),
  title: z.string().min(1).max(240),
  kind: TaskKindSchema,
  description: z.string().min(1).max(20_000),
  acceptanceCriteria: z.array(z.string().min(1).max(2_000)).min(1).max(100),
  dependencies: z.array(z.string()).max(100),
  suggestedAgentRole: z.string().min(1).max(200),
  suggestedAgentId: z.preprocess(
    (value) => typeof value === 'string' && value.trim() === '' ? undefined : value,
    z.string().trim().min(1).optional(),
  ),
  evidenceRefs: z.array(z.string().trim().min(1).max(4_096)).min(1).max(50).optional(),
  sourceRequirementIds: z.array(z.string().min(1)).max(100).optional(),
  acceptanceIds: z.array(z.string().min(1)).max(100).optional(),
  assignmentPolicy: TaskAssignmentPolicySchema.optional(),
  relationship: z.enum(['implementation', 'verification', 'review', 'handoff']).optional(),
  testCommand: z.string().min(1).max(10_000),
})

export const RepositoryEvidenceSchema = z.object({
  inspectedPaths: z.array(z.string().trim().min(1).max(4_096)).min(1).max(500),
  manifests: z.array(z.string().trim().min(1).max(4_096)).min(1).max(100),
  verifiedCommands: z.array(z.string().trim().min(1).max(10_000)).min(1).max(100),
  relevantModules: z.array(z.string().trim().min(1).max(4_096)).max(500),
  assumptions: z.array(z.string().trim().min(1).max(2_000)).max(50),
}).strict()

export const GeneratedPlanSchema = z.object({
  status: z.literal('ready').optional(),
  summary: z.string().min(1).max(5_000),
  repositoryEvidence: RepositoryEvidenceSchema.optional(),
  tasks: z.array(GeneratedTaskSchema).min(2).max(200),
})

export const RequirementSourceAnchorSchema = z.object({
  id: z.string().trim().min(1).max(500),
  kind: z.enum(['heading', 'acceptance_item', 'open_question', 'table_row', 'paragraph']),
  documentKind: z.enum(['prd', 'technical_design', 'attachment']).optional(),
  sectionPath: z.array(z.string().trim().min(1).max(500)).max(20).optional(),
  ordinal: z.number().int().nonnegative().optional(),
  text: z.string().trim().min(1).max(20_000).optional(),
  textDigest: z.string().length(64),
  locator: z.string().trim().min(1).max(4_096),
  normativeHints: z.array(z.enum(['functional', 'business_rule', 'acceptance', 'decision', 'data', 'state', 'permission', 'failure', 'non_functional', 'migration', 'compatibility', 'rollback'])).max(12).optional(),
  contentClassification: z.enum(['normative', 'context', 'duplicate', 'uncertain']).optional(),
  classificationReason: z.string().trim().min(1).max(2_000).optional(),
  requiredDisposition: z.boolean(),
}).strict()

export const RequirementSourceManifestSchema = z.object({
  sourceDigest: z.string().length(64),
  anchors: z.array(RequirementSourceAnchorSchema).max(10_000),
}).strict()

const RequirementAnalysisAcceptanceSchema = z.object({
  key: z.string().trim().regex(/^AC-[A-Z0-9_-]+$/).max(100),
  statement: z.string().trim().min(1).max(2_000),
  required: z.boolean(),
  scenario: z.enum(['happy_path', 'business_rejection', 'boundary', 'dependency_failure', 'security', 'compatibility', 'recovery']),
  sourceRefs: z.array(z.string().trim().min(1).max(4_096)).min(1).max(100),
}).strict()

export const RequirementAnalysisResultSchema = z.object({
  status: z.enum(['ready', 'needs_decision', 'blocked']),
  summary: z.string().trim().min(1).max(5_000),
  requirements: z.array(z.object({
    key: z.string().trim().regex(/^REQ-[A-Z0-9_-]+$/).max(100),
    kind: RequirementItemKindSchema,
    scope: z.enum(['in_scope', 'deferred', 'out_of_scope']),
    dispositionReason: z.string().trim().min(1).max(2_000).optional(),
    statement: z.string().trim().min(1).max(20_000),
    sourceRefs: z.array(z.string().trim().min(1).max(4_096)).min(1).max(100),
    acceptanceCriteria: z.array(RequirementAnalysisAcceptanceSchema).max(200),
  }).strict().superRefine((value, context) => {
    if (value.scope !== 'in_scope' && value.dispositionReason === undefined) context.addIssue({ code: z.ZodIssueCode.custom, path: ['dispositionReason'], message: 'Deferred and out-of-scope requirements require an auditable disposition reason.' })
  })).max(1_000),
  decisions: z.array(z.object({
    key: z.string().trim().regex(/^DEC-[A-Z0-9_-]+$/).max(100),
    question: z.string().trim().min(1).max(20_000),
    options: z.array(RequirementDecisionOptionSchema).min(1).max(20),
    recommendedOption: z.string().trim().min(1).max(100).optional(),
    impact: RequirementDecisionImpactSchema,
    affectedRequirementKeys: z.array(z.string().trim().min(1).max(100)).max(100),
    sourceRefs: z.array(z.string().trim().min(1).max(4_096)).min(1).max(100),
  }).strict()).max(1_000),
  diagnostics: z.array(z.object({
    code: z.string().trim().min(1).max(100),
    severity: z.enum(['info', 'warning', 'error']),
    message: z.string().trim().min(1).max(2_000),
    sourceRefs: z.array(z.string().trim().min(1).max(4_096)).max(100),
  }).strict()).max(1_000),
}).strict()

export const RequirementReviewResultSchema = z.object({
  status: z.enum(['approved', 'changes_required', 'blocked']),
  reviewedSourceDigest: z.string().length(64),
  reviewedAnalysisDigest: z.string().length(64),
  missingSourceRefs: z.array(z.string().trim().min(1).max(4_096)).max(1_000),
  conflicts: z.array(z.object({
    sourceRefs: z.array(z.string().trim().min(1).max(4_096)).min(1).max(100),
    statement: z.string().trim().min(1).max(2_000),
    impact: z.string().trim().min(1).max(2_000),
  }).strict()).max(1_000),
  untestableAcceptanceKeys: z.array(z.string().trim().min(1).max(100)).max(1_000),
  findings: z.array(z.object({
    severity: z.enum(['blocking', 'important', 'advisory']),
    message: z.string().trim().min(1).max(2_000),
  }).strict()).max(1_000),
}).strict()

export const GeneratedTaskV2Schema = z.object({
  id: z.string().regex(/^[a-z][a-z0-9_-]{0,63}$/),
  title: z.string().min(1).max(240),
  kind: TaskKindSchema,
  relationship: z.enum(['implementation', 'verification', 'review', 'handoff']),
  description: z.string().min(1).max(20_000),
  completionCriteria: z.array(z.string().min(1).max(2_000)).min(1).max(100),
  dependencies: z.array(z.string()).max(100),
  sourceRequirementKeys: z.array(z.string().trim().min(1).max(100)).min(1).max(100),
  acceptanceKeys: z.array(z.string().trim().min(1).max(100)).min(1).max(100),
  decisionKeys: z.array(z.string().trim().min(1).max(100)).max(100),
  assignmentPolicy: z.object({
    policyVersion: z.literal(2),
    mode: AssignmentModeSchema,
    riskLevel: TaskRiskLevelSchema,
    requiredRoles: z.array(DeliveryRoleSchema).min(1).max(7),
    requiredCapabilities: z.array(CapabilityIdSchema).max(50),
    requiresIndependentReviewer: z.boolean(),
    maxParallel: z.number().int().positive().max(32),
    parallelGroup: z.string().trim().min(1).max(160).optional(),
    conflictKeys: z.array(z.string().trim().min(1).max(200)).max(50),
    allowedScope: z.array(z.string().trim().min(1).max(2_000)).max(100),
    forbiddenScope: z.array(z.string().trim().min(1).max(2_000)).max(50),
    escalationConditions: z.array(z.string().trim().min(1).max(2_000)).max(50),
  }).strict(),
  evidenceRefs: z.array(z.string().trim().min(1).max(4_096)).min(1).max(50),
  testCommand: z.string().min(1).max(10_000),
}).strict()

const PartialRepositoryEvidenceSchema = z.object({
  inspectedPaths: z.array(z.string().trim().min(1).max(4_096)).max(500),
  manifests: z.array(z.string().trim().min(1).max(4_096)).max(100),
  verifiedCommands: z.array(z.string().trim().min(1).max(10_000)).max(100),
  relevantModules: z.array(z.string().trim().min(1).max(4_096)).max(500),
  assumptions: z.array(z.string().trim().min(1).max(2_000)).max(50),
}).strict()

export const GeneratedPlanV2Schema = z.object({
  contractVersion: z.literal(2),
  status: z.enum(['ready', 'needs_decision', 'blocked']),
  summary: z.string().trim().min(1).max(5_000),
  repositoryEvidence: PartialRepositoryEvidenceSchema,
  tasks: z.array(GeneratedTaskV2Schema).max(200),
  diagnostics: z.array(z.object({ code: z.string().trim().min(1).max(100), severity: z.enum(['info', 'warning', 'error']), message: z.string().trim().min(1).max(2_000) }).strict()).max(200).default([]),
}).strict().superRefine((value, context) => {
  if (value.status === 'ready') {
    if (value.repositoryEvidence.inspectedPaths.length === 0) context.addIssue({ code: z.ZodIssueCode.custom, path: ['repositoryEvidence', 'inspectedPaths'], message: 'A ready plan requires inspected repository paths.' })
    if (value.repositoryEvidence.manifests.length === 0) context.addIssue({ code: z.ZodIssueCode.custom, path: ['repositoryEvidence', 'manifests'], message: 'A ready plan requires an inspected manifest.' })
    if (value.repositoryEvidence.verifiedCommands.length === 0) context.addIssue({ code: z.ZodIssueCode.custom, path: ['repositoryEvidence', 'verifiedCommands'], message: 'A ready plan requires a verified command.' })
    return
  }
  if (value.tasks.length > 0) context.addIssue({ code: z.ZodIssueCode.custom, path: ['tasks'], message: 'A blocked or decision-pending plan cannot contain executable tasks.' })
  if (!value.diagnostics.some((diagnostic) => diagnostic.severity === 'error')) context.addIssue({ code: z.ZodIssueCode.custom, path: ['diagnostics'], message: 'A blocked or decision-pending plan requires an error diagnostic.' })
})

export const PlanningV3DiagnosticSchema = z.object({
  code: z.string().trim().min(1).max(100),
  severity: z.enum(['info', 'warning', 'error', 'blocking']),
  message: z.string().trim().min(1).max(2_000),
  subjectIds: z.array(z.string().min(1)).max(100).default([]),
}).strict()

export const AcceptanceScenarioCategorySchema = z.enum([
  'happy_path', 'business_rejection', 'boundary', 'dependency_failure', 'security', 'compatibility', 'recovery',
])

export const PlanningReviewFindingSchema = z.object({
  code: z.string().trim().min(1).max(100),
  severity: z.enum(['info', 'warning', 'error', 'blocking']),
  subjectType: z.enum(['requirement', 'acceptance', 'scenario', 'scenario_coverage_policy', 'decision', 'policy', 'binding', 'work_package', 'task', 'dependency', 'capability_requirement', 'assignment']),
  subjectId: z.string().min(1),
  evidenceIds: z.array(z.string().min(1)).max(100),
  message: z.string().trim().min(1).max(2_000),
  repairOwner: z.enum(['requirement', 'risk', 'scenario', 'policy', 'repository', 'binding', 'plan', 'capability', 'team', 'human_decision']),
  restartStage: z.lazy(() => PlanningOperationStageSchema),
  requiredUserAction: z.enum(['resolve_decision', 'confirm_policy', 'confirm_binding', 'confirm_capability', 'repair_source']).optional(),
}).strict()

export const PlanningOperationStageSchema = z.enum([
  'reserved', 'source_ingest', 'source_profile', 'source_manifest', 'requirement_analysis',
  'requirement_review', 'source_policy_precheck', 'decision_effect_precheck', 'risk_profile',
  'scenario_completion', 'scenario_coverage_review', 'repository_snapshot',
  'canonical_target_binding', 'policy_snapshot', 'code_binding', 'binding_review',
  'work_packages', 'task_plan', 'reference_mapping', 'policy_fulfillment',
  'capability_requirement_derivation', 'plan_review', 'capability_catalog_snapshot',
  'access_grant_snapshot', 'assignment_qualification', 'task_preflight',
  'decision_effect_finalization', 'convergence_carry_validation', 'committing', 'committed',
  'shadow_completed',
])

export const PlanningSourceInputRecordSchema = z.object({
  id: z.string().min(1),
  projectId: z.string().min(1),
  operationId: z.string().min(1),
  mode: z.enum(['initial', 'append', 'revise']),
  title: z.string().min(1).max(160),
  prd: z.string().min(1).max(500_000),
  technicalDesign: z.string().max(500_000),
  taskLanguage: TaskLanguageSchema,
  sourceRefs: z.array(z.string().trim().min(1).max(4_096)).max(100),
  sourceBlocks: z.array(RequirementSourceBlockSchema).max(10_000),
  reviseBundleId: z.string().min(1).optional(),
  requestDigest: Sha256Schema,
  sourceInputDigest: Sha256Schema,
  createdAt: z.string().min(1),
}).strict()

export const RequirementSourceProfileRecordSchema = z.object({
  id: z.string().min(1),
  projectId: z.string().min(1),
  operationId: z.string().min(1),
  documentId: z.string().min(1).max(500),
  authority: z.enum(['normative', 'context']),
  mediaType: z.enum(['markdown', 'text', 'pdf', 'normalized_document']),
  contentDigest: Sha256Schema,
  parserId: z.string().min(1).max(200),
  parserVersion: z.string().min(1).max(100),
  totalPages: z.number().int().nonnegative().max(1_000).optional(),
  textPages: z.number().int().nonnegative().max(1_000).optional(),
  visualPages: z.number().int().nonnegative().max(1_000).optional(),
  analyzedVisualPages: z.array(z.number().int().positive().max(1_000)).max(1_000).optional(),
  totalBlocks: z.number().int().nonnegative().max(10_000),
  parsedBlocks: z.number().int().nonnegative().max(10_000),
  attachmentStatuses: z.array(z.object({
    attachmentId: z.string().min(1).max(500),
    digest: Sha256Schema.optional(),
    status: z.enum(['readable', 'missing', 'unsupported', 'uncertain']),
  }).strict()).max(10_000),
  confidence: z.enum(['high', 'medium', 'low', 'unknown']),
  status: z.enum(['complete', 'partial', 'unsupported', 'failed', 'stale']),
  authorityAudit: z.object({ actor: z.string().min(1).max(240), reason: z.string().min(1).max(2_000), at: z.string().min(1) }).strict().optional(),
  diagnostics: z.array(PlanningV3DiagnosticSchema).max(200),
  profileDigest: Sha256Schema,
  createdAt: z.string().min(1),
}).strict().superRefine((value, context) => {
  if (value.parsedBlocks > value.totalBlocks) context.addIssue({ code: z.ZodIssueCode.custom, path: ['parsedBlocks'], message: 'Parsed blocks cannot exceed total blocks.' })
  if (value.status === 'complete' && value.parsedBlocks !== value.totalBlocks) context.addIssue({ code: z.ZodIssueCode.custom, path: ['status'], message: 'A complete source profile requires every block to be parsed.' })
  if (value.status === 'complete' && value.attachmentStatuses.some((item) => item.status !== 'readable')) context.addIssue({ code: z.ZodIssueCode.custom, path: ['attachmentStatuses'], message: 'A complete source profile cannot contain unreadable attachments.' })
  if (value.status === 'complete' && value.visualPages !== undefined && (value.analyzedVisualPages?.length ?? 0) !== value.visualPages) context.addIssue({ code: z.ZodIssueCode.custom, path: ['analyzedVisualPages'], message: 'A complete visual source requires every visual page to be analyzed.' })
  if (value.authority === 'context' && value.authorityAudit === undefined) context.addIssue({ code: z.ZodIssueCode.custom, path: ['authorityAudit'], message: 'Context sources require an authority audit.' })
})

export const RequirementSourceManifestRecordSchema = z.object({
  id: z.string().min(1),
  projectId: z.string().min(1),
  operationId: z.string().min(1),
  sourceDigest: Sha256Schema,
  sourceProfileIds: z.array(z.string().min(1)).min(1).max(10_000),
  sourceCompletenessDigest: Sha256Schema,
  parserVersion: z.string().min(1).max(100),
  anchors: z.array(RequirementSourceAnchorSchema).max(10_000),
  anchorIds: z.array(z.string().min(1)).max(10_000),
  sourceBlockCount: z.number().int().nonnegative().max(10_000),
  classifiedBlockCount: z.number().int().nonnegative().max(10_000),
  requiredAnchorCount: z.number().int().nonnegative().max(10_000),
  classificationDigest: Sha256Schema,
  dispositionDigest: Sha256Schema,
  status: z.enum(['candidate', 'accepted', 'superseded']),
  manifestDigest: Sha256Schema,
  createdAt: z.string().min(1),
}).strict().superRefine((value, context) => {
  if (new Set(value.sourceProfileIds).size !== value.sourceProfileIds.length) context.addIssue({ code: z.ZodIssueCode.custom, path: ['sourceProfileIds'], message: 'Source profile ids must be unique.' })
  if (new Set(value.anchorIds).size !== value.anchorIds.length || value.anchorIds.length !== value.anchors.length) context.addIssue({ code: z.ZodIssueCode.custom, path: ['anchorIds'], message: 'Manifest anchor ids must uniquely match the embedded anchors.' })
  if (value.classifiedBlockCount > value.sourceBlockCount) context.addIssue({ code: z.ZodIssueCode.custom, path: ['classifiedBlockCount'], message: 'Classified blocks cannot exceed source blocks.' })
  if (value.status === 'accepted' && value.classifiedBlockCount !== value.sourceBlockCount) context.addIssue({ code: z.ZodIssueCode.custom, path: ['status'], message: 'An accepted manifest requires complete block classification.' })
})

// Early v3.3 candidates could persist an unbounded Markdown heading in
// sectionPath. Keep the exact historical record readable so its immutable
// digests remain valid; new writes still use the strict schema above.
export const RequirementSourceManifestRecordStorageSchema = RequirementSourceManifestRecordSchema.safeExtend({
  anchors: z.array(RequirementSourceAnchorSchema.safeExtend({
    sectionPath: z.array(z.string().trim().min(1).max(20_000)).max(20).optional(),
  })).max(10_000),
})

export const RequirementAnalysisProposalRecordSchema = z.object({
  id: z.string().min(1),
  projectId: z.string().min(1),
  operationId: z.string().min(1),
  stageAttemptId: z.string().min(1),
  sourceManifestId: z.string().min(1),
  sourceManifestDigest: Sha256Schema,
  analysis: RequirementAnalysisResultSchema,
  analysisDigest: Sha256Schema,
  promptVersion: z.string().min(1).max(200),
  createdAt: z.string().min(1),
}).strict()

export const RequirementAnalysisProposalRecordStorageSchema = z.custom<z.infer<typeof RequirementAnalysisProposalRecordSchema>>(
  (value) => RequirementAnalysisProposalRecordSchema.safeParse(normalizeLegacyGoodScenario(value)).success,
  'Requirement analysis proposal storage record is invalid.',
)

export const PlanningRepairAttemptRecordSchema = z.object({
  id: z.string().min(1),
  projectId: z.string().min(1),
  operationId: z.string().min(1),
  successorOperationId: z.string().min(1).optional(),
  reviewKind: z.enum(['requirement', 'scenario_coverage', 'binding', 'plan']),
  sourceReviewId: z.string().min(1),
  sourceReviewDigest: Sha256Schema,
  findings: z.array(PlanningReviewFindingSchema).min(1).max(1_000).optional(),
  sourceFindingIds: z.array(z.string().min(1)).min(1).max(1_000),
  findingSetDigest: Sha256Schema,
  repairOwner: z.enum(['requirement', 'risk', 'scenario', 'policy', 'repository', 'binding', 'plan', 'capability', 'team', 'human_decision']),
  restartStage: PlanningOperationStageSchema,
  inputSubjectRevision: z.number().int().positive(),
  outputSubjectRevision: z.number().int().positive().optional(),
  status: z.enum(['requested', 'repairing', 'revalidated', 'resolved', 'blocked', 'failed', 'superseded']),
  deterministicValidationDigest: Sha256Schema.optional(),
  resultReviewId: z.string().min(1).optional(),
  attempt: z.number().int().positive(),
  maxAttempts: z.number().int().positive().max(100),
  repairPolicyVersion: z.string().min(1).max(100),
  repairDigest: Sha256Schema,
  createdAt: z.string().min(1),
  updatedAt: z.string().min(1),
}).strict().superRefine((value, context) => {
  if (value.attempt > value.maxAttempts) context.addIssue({ code: z.ZodIssueCode.custom, path: ['attempt'], message: 'Repair attempt exceeds the configured maximum.' })
  if (value.status === 'resolved' && (value.outputSubjectRevision === undefined || value.deterministicValidationDigest === undefined || value.resultReviewId === undefined)) context.addIssue({ code: z.ZodIssueCode.custom, path: ['status'], message: 'A resolved repair requires an output revision, deterministic validation, and result review.' })
  if (value.successorOperationId === value.operationId) context.addIssue({ code: z.ZodIssueCode.custom, path: ['successorOperationId'], message: 'A repair successor cannot reference the predecessor operation itself.' })
})

export const PlanningMetricDefinitionSchema = z.object({
  key: z.string().trim().min(1).max(100),
  numerator: z.string().trim().min(1).max(500),
  denominator: z.string().trim().min(1).max(500),
  eventStart: z.string().trim().min(1).max(100).optional(),
  eventEnd: z.string().trim().min(1).max(100).optional(),
  sampleWindow: z.string().trim().min(1).max(100),
  sampleCohort: z.string().trim().min(1).max(100),
  projectSetDigest: Sha256Schema,
  minimumSampleSize: z.number().int().positive().max(1_000_000),
  aggregationAlgorithm: z.enum(['ratio', 'duration_percentile', 'count']),
  percentileMethod: z.literal('nearest_rank').optional(),
  exclusions: z.array(z.string().trim().min(1).max(200)).max(100),
  canaryThreshold: z.string().trim().min(1).max(100),
  releaseThreshold: z.string().trim().min(1).max(100),
}).strict().superRefine((value, context) => {
  if (value.aggregationAlgorithm === 'duration_percentile' && value.percentileMethod === undefined) context.addIssue({ code: z.ZodIssueCode.custom, path: ['percentileMethod'], message: 'Duration percentile metrics require a deterministic percentile method.' })
  if (value.aggregationAlgorithm !== 'duration_percentile' && value.percentileMethod !== undefined) context.addIssue({ code: z.ZodIssueCode.custom, path: ['percentileMethod'], message: 'Only duration percentile metrics may define percentileMethod.' })
})

export const PlanningMetricPolicyRecordSchema = z.object({
  id: z.string().min(1),
  scopeKey: z.string().regex(/^(global|project:[^:]+)$/u),
  scopeProjectId: z.string().min(1).optional(),
  version: z.string().trim().min(1).max(100),
  status: z.literal('published'),
  supersedesId: z.string().min(1).optional(),
  scopeRevision: z.number().int().positive(),
  metrics: z.array(PlanningMetricDefinitionSchema).min(1).max(100),
  approvedBy: z.string().trim().min(1).max(240),
  approvalReason: z.string().trim().min(1).max(2_000),
  policyDigest: Sha256Schema,
  publishCommandId: z.string().min(1),
  createdAt: z.string().min(1),
  publishedAt: z.string().min(1),
  effectiveAt: z.string().min(1),
}).strict().superRefine((value, context) => {
  const expectedProjectId = value.scopeKey === 'global' ? undefined : value.scopeKey.slice('project:'.length)
  if (value.scopeProjectId !== expectedProjectId) context.addIssue({ code: z.ZodIssueCode.custom, path: ['scopeProjectId'], message: 'Metric policy scopeProjectId must be derived from scopeKey.' })
  if (value.effectiveAt !== value.publishedAt) context.addIssue({ code: z.ZodIssueCode.custom, path: ['effectiveAt'], message: 'V3.3 metric policies become effective when published.' })
  if (new Set(value.metrics.map((metric) => metric.key)).size !== value.metrics.length) context.addIssue({ code: z.ZodIssueCode.custom, path: ['metrics'], message: 'Metric keys must be unique within a policy.' })
})

export const PlanningMetricPolicyPublishRecordSchema = z.object({
  id: z.string().min(1),
  scopeKey: z.string().regex(/^(global|project:[^:]+)$/u),
  scopeProjectId: z.string().min(1).optional(),
  requestedVersion: z.string().trim().min(1).max(100),
  supersedesId: z.string().min(1).optional(),
  scopeRevision: z.number().int().positive().optional(),
  previousPublishedPolicyId: z.string().min(1).optional(),
  previousPublishRecordId: z.string().min(1).optional(),
  idempotencyKey: z.string().trim().min(1).max(200),
  requestDigest: Sha256Schema,
  outcome: z.enum(['published', 'replayed_existing', 'rejected_conflict']),
  publishedPolicyId: z.string().min(1).optional(),
  createdAt: z.string().min(1),
}).strict()

export const PlanningShadowEvaluationRecordSchema = z.object({
  id: z.string().min(1),
  metricPolicyId: z.string().min(1),
  projectId: z.string().min(1),
  operationId: z.string().min(1),
  basePlanSnapshotId: z.string().min(1).optional(),
  reachedStage: PlanningOperationStageSchema,
  planningOutcome: z.enum(['would_commit', 'blocked', 'failed']),
  proposalPackId: z.string().min(1).optional(),
  capabilityRequirementDraftIds: z.array(z.string().min(1)).max(1_000),
  assignmentDraftIds: z.array(z.string().min(1)).max(1_000),
  taskPreflightIds: z.array(z.string().min(1)).max(1_000),
  decisionEffectPrecheckIds: z.array(z.string().min(1)).max(2_000),
  decisionEffectFinalIds: z.array(z.string().min(1)).max(2_000),
  decisionEffectPrecheckDigest: Sha256Schema.optional(),
  decisionEffectFinalDigest: Sha256Schema.optional(),
  blockingDiagnostics: z.array(PlanningV3DiagnosticSchema).max(1_000),
  metricPolicyVersion: z.string().min(1).max(100),
  metricPolicyDigest: Sha256Schema,
  comparisonSummary: z.record(z.string(), z.union([z.number(), z.string(), z.boolean()])),
  inputDigest: Sha256Schema,
  evaluationDigest: Sha256Schema,
  createdAt: z.string().min(1),
}).strict().superRefine((value, context) => {
  if (value.planningOutcome === 'would_commit' && value.reachedStage !== 'decision_effect_finalization' && value.reachedStage !== 'convergence_carry_validation') context.addIssue({ code: z.ZodIssueCode.custom, path: ['reachedStage'], message: 'A would-commit shadow must complete decision effect finalization.' })
  if (value.planningOutcome === 'would_commit' && value.blockingDiagnostics.length > 0) context.addIssue({ code: z.ZodIssueCode.custom, path: ['blockingDiagnostics'], message: 'A would-commit shadow cannot contain blocking diagnostics.' })
})

export const PlanningModelExecutionProvenanceSchema = z.object({
  modelProvider: z.string().min(1).max(240),
  modelId: z.string().min(1).max(500),
  modelVersion: z.string().min(1).max(500),
  samplingConfigDigest: Sha256Schema,
  inputTokenBudget: z.number().int().positive(),
  outputTokenBudget: z.number().int().positive(),
  toolCallBudget: z.literal(0),
  identitySource: z.literal('resolved_model_route'),
  capturedAt: z.string().min(1),
}).strict()

export const PlanningOperationRecordSchema = z.object({
  id: z.string().min(1),
  projectId: z.string().min(1),
  mode: z.enum(['initial', 'append', 'revise']),
  status: z.enum(['running', 'blocked', 'failed', 'committed', 'shadow_completed', 'superseded', 'aborted']),
  stage: PlanningOperationStageSchema,
  planningContractVersion: z.literal(3),
  publicationMode: z.enum(['shadow', 'candidate']),
  writerFencingToken: z.number().int().positive().optional(),
  baseProjectRevision: z.number().int().positive(),
  predecessorOperationId: z.string().min(1).optional(),
  repositoryPolicyBaselineId: z.string().min(1).optional(),
  repositoryPolicyBaselineDigest: Sha256Schema.optional(),
  repositoryPolicyIteration: z.number().int().nonnegative(),
  requestDigest: Sha256Schema,
  metricPolicyId: z.string().min(1),
  metricPolicyVersion: z.string().min(1).max(100),
  metricPolicyDigest: Sha256Schema,
  modelExecutionProvenance: PlanningModelExecutionProvenanceSchema.optional(),
  idempotencyKey: z.string().min(1).max(200).optional(),
  sourceInputId: z.string().min(1).optional(),
  sourceInputDigest: Sha256Schema.optional(),
  sourceProfileIds: z.array(z.string().min(1)).max(10_000).default([]),
  sourceCompletenessDigest: Sha256Schema.optional(),
  sourceManifestId: z.string().min(1).optional(),
  sourceManifestDigest: Sha256Schema.optional(),
  requirementAnalysisProposalId: z.string().min(1).optional(),
  requirementAnalysisDigest: Sha256Schema.optional(),
  sourceDispositionBindingIds: z.array(z.string().min(1)).max(10_000).default([]),
  sourceDispositionBindingDigest: Sha256Schema.optional(),
  acceptanceScenarioIds: z.array(z.string().min(1)).max(10_000).default([]),
  acceptanceScenarioDigest: Sha256Schema.optional(),
  acceptanceScenarioCoveragePolicyIds: z.array(z.string().min(1)).max(10_000).default([]),
  acceptanceScenarioCoveragePolicyDigest: Sha256Schema.optional(),
  planningRiskProfileId: z.string().min(1).optional(),
  planningRiskProfileDigest: Sha256Schema.optional(),
  scenarioCoverageReviewId: z.string().min(1).optional(),
  scenarioCoverageReviewDigest: Sha256Schema.optional(),
  requirementReviewId: z.string().min(1).optional(),
  requirementReviewDigest: Sha256Schema.optional(),
  bindingReviewId: z.string().min(1).optional(),
  bindingReviewDigest: Sha256Schema.optional(),
  planReviewId: z.string().min(1).optional(),
  planReviewDigest: Sha256Schema.optional(),
  sourcePolicyPrecheckId: z.string().min(1).optional(),
  sourcePolicyDigest: Sha256Schema.optional(),
  decisionOptionEffectIds: z.array(z.string().min(1)).max(20_000).default([]),
  decisionPlanningEffectIds: z.array(z.string().min(1)).max(2_000).default([]),
  decisionEffectPrecheckDigest: Sha256Schema.optional(),
  decisionEffectFinalDigest: Sha256Schema.optional(),
  repositorySnapshotId: z.string().min(1).optional(),
  repositoryDigest: Sha256Schema.optional(),
  repositoryStackProfileId: z.string().min(1).optional(),
  repositoryStackProfileDigest: Sha256Schema.optional(),
  repositoryEvidenceRetrievalReportId: z.string().min(1).optional(),
  repositoryEvidenceRetrievalReportDigest: Sha256Schema.optional(),
  canonicalTargetBindingId: z.string().min(1).optional(),
  canonicalTargetBindingDigest: Sha256Schema.optional(),
  policySnapshotId: z.string().min(1).optional(),
  policyDigest: Sha256Schema.optional(),
  promptReferenceManifestId: z.string().min(1).optional(),
  promptReferenceManifestDigest: Sha256Schema.optional(),
  proposalPackId: z.string().min(1).optional(),
  proposalDigest: Sha256Schema.optional(),
  planningReferenceMapId: z.string().min(1).optional(),
  planningReferenceMapDigest: Sha256Schema.optional(),
  policyFulfillmentIds: z.array(z.string().min(1)).max(1_000).default([]),
  policyFulfillmentDigest: Sha256Schema.optional(),
  assignmentDraftIds: z.array(z.string().min(1)).max(1_000).default([]),
  assignmentEvaluationIds: z.array(z.string().min(1)).max(1_000).default([]),
  assignmentEvaluationDigest: Sha256Schema.optional(),
  taskPreflightIds: z.array(z.string().min(1)).max(1_000).default([]),
  taskPreflightDigest: Sha256Schema.optional(),
  convergenceCarryValidationIds: z.array(z.string().min(1)).max(20_000).default([]),
  convergenceCarryValidationDigest: Sha256Schema.optional(),
  convergenceRepairBaselineId: z.string().min(1).optional(),
  capabilityCatalogSnapshotId: z.string().min(1).optional(),
  capabilityCatalogDigest: Sha256Schema.optional(),
  accessGrantSnapshotId: z.string().min(1).optional(),
  accessGrantDigest: Sha256Schema.optional(),
  reservedPlanSnapshotId: z.string().min(1),
  reservedPlanRevision: z.number().int().positive(),
  workPackageIds: z.array(z.string().min(1)).max(1_000).default([]),
  taskIds: z.array(z.string().min(1)).max(1_000).default([]),
  capabilityRequirementIds: z.array(z.string().min(1)).max(1_000).default([]),
  assignmentDecisionIds: z.array(z.string().min(1)).max(1_000).default([]),
  candidatePlanSnapshotId: z.string().min(1).optional(),
  shadowEvaluationId: z.string().min(1).optional(),
  diagnostics: z.array(PlanningV3DiagnosticSchema).max(1_000).default([]),
  createdAt: z.string().min(1),
  updatedAt: z.string().min(1),
  completedAt: z.string().min(1).optional(),
}).strict().superRefine((value, context) => {
  if (value.status === 'shadow_completed' && value.shadowEvaluationId === undefined) context.addIssue({ code: z.ZodIssueCode.custom, path: ['shadowEvaluationId'], message: 'A completed shadow operation requires its immutable evaluation.' })
  if (value.status === 'shadow_completed' && (value.workPackageIds.length > 0 || value.taskIds.length > 0 || value.capabilityRequirementIds.length > 0 || value.assignmentDecisionIds.length > 0 || value.candidatePlanSnapshotId !== undefined)) context.addIssue({ code: z.ZodIssueCode.custom, path: ['status'], message: 'A shadow operation cannot publish executable records or a PlanSnapshot.' })
})

export const PlanningEvaluationCandidateSchema = z.object({
  schemaVersion: z.literal(1),
  runId: z.string().min(1).max(240),
  executionKind: z.literal('real_model'),
  status: z.enum(['ready', 'blocked']),
  repositoryEvidenceIds: z.array(z.string().min(1).max(4_096)).max(2_000),
  requirements: z.array(z.object({ key: z.string().min(1).max(240) }).strict()).max(10_000),
  decisions: z.array(z.object({ impact: RequirementDecisionImpactSchema, status: z.enum(['pending', 'resolved', 'superseded']) }).strict()).max(10_000),
  bindings: z.array(z.object({
    requirementKey: z.string().min(1).max(240),
    evidenceIds: z.array(z.string().min(1).max(4_096)).max(200),
    ownerPaths: z.array(z.string().min(1).max(4_096)).max(100),
  }).strict()).max(10_000),
  tasks: z.array(z.object({
    key: z.string().min(1).max(240),
    acceptanceKeys: z.array(z.string().min(1).max(240)).max(200),
    contextComplete: z.boolean(),
    verificationCommandIds: z.array(z.string().min(1).max(10_000)).max(20),
  }).strict()).max(1_000),
  assignments: z.array(z.object({
    taskKey: z.string().min(1).max(240),
    outcome: z.enum(['selected', 'blocked']),
    agentId: z.string().min(1).optional(),
  }).strict().superRefine((value, context) => {
    if ((value.outcome === 'selected') !== (value.agentId !== undefined)) context.addIssue({ code: z.ZodIssueCode.custom, path: ['agentId'], message: 'Selected assignments require exactly one Agent; blocked assignments cannot name one.' })
  })).max(1_000),
  substantiveRewriteRequired: z.boolean(),
  provenance: z.object({
    caseId: z.string().min(1).max(240),
    repositoryBaseCommit: z.string().regex(/^[0-9a-f]{40,64}$/u),
    planningOperationId: z.string().min(1),
    planningOperationDigest: Sha256Schema,
    repositoryDigest: Sha256Schema,
    sourceDigest: Sha256Schema,
    teamCatalogDigest: Sha256Schema,
    decisionInputDigest: Sha256Schema,
    metricPolicyId: z.string().min(1),
    metricPolicyVersion: z.string().min(1).max(100),
    metricPolicyDigest: Sha256Schema,
    promptVersionsDigest: Sha256Schema,
    modelProvider: z.string().min(1),
    modelId: z.string().min(1),
    modelVersion: z.string().min(1),
    samplingConfigDigest: Sha256Schema,
    inputTokenBudget: z.number().int().positive(),
    outputTokenBudget: z.number().int().positive(),
    toolCallBudget: z.number().int().nonnegative(),
    startedAt: z.string().min(1),
    completedAt: z.string().min(1),
  }).strict(),
}).strict()

export const PlanningReleaseCanarySchema = z.object({
  schemaVersion: z.literal(1),
  releaseVersion: z.string().min(1).max(100),
  planningContractVersion: z.literal(3),
  projectKey: z.string().min(1).max(240),
  planningOperationId: z.string().min(1),
  planningOperationDigest: Sha256Schema,
  sourceSnapshotDigest: Sha256Schema,
  planSnapshotId: z.string().min(1),
  planSnapshotDigest: Sha256Schema,
  approvalId: z.string().min(1),
  approvalDigest: Sha256Schema,
  executionDispatches: z.array(z.object({
    id: z.string().min(1),
    digest: Sha256Schema,
  }).strict()).min(1).max(10_000),
  taskRunCount: z.number().int().positive(),
  deliveryIntegrationSnapshotId: z.string().min(1),
  deliveryIntegrationDigest: Sha256Schema,
  finalCommit: z.string().regex(/^[0-9a-f]{40,64}$/u),
  convergenceReviewId: z.string().min(1),
  convergenceReviewDigest: Sha256Schema,
  outcome: z.literal('converged'),
  falseReady: z.literal(false),
  falseConverged: z.literal(false),
  requiredRequirementCoverage: z.literal(1),
  requiredAcceptanceCoverage: z.literal(1),
  evidenceRecordIds: z.array(z.string().min(1)).min(1).max(100_000),
  evidenceBundleDigest: Sha256Schema,
  startedAt: z.string().min(1),
  completedAt: z.string().min(1),
}).strict().superRefine((value, context) => {
  const dispatchIds = value.executionDispatches.map((dispatch) => dispatch.id)
  if (new Set(dispatchIds).size !== dispatchIds.length) context.addIssue({ code: z.ZodIssueCode.custom, path: ['executionDispatches'], message: 'Canary Dispatch ids must be unique.' })
  const startedAt = Date.parse(value.startedAt)
  const completedAt = Date.parse(value.completedAt)
  if (!Number.isFinite(startedAt)) context.addIssue({ code: z.ZodIssueCode.custom, path: ['startedAt'], message: 'Canary start timestamp is invalid.' })
  if (!Number.isFinite(completedAt) || (Number.isFinite(startedAt) && completedAt < startedAt)) context.addIssue({ code: z.ZodIssueCode.custom, path: ['completedAt'], message: 'Canary completion timestamp must be valid and not precede start.' })
})

export const RequirementDecisionOptionEffectRecordSchema = z.object({
  id: z.string().min(1),
  projectId: z.string().min(1),
  decisionId: z.string().min(1),
  operationId: z.string().min(1),
  optionKey: z.string().trim().min(1).max(100),
  affectedDimensions: z.array(DecisionEffectDimensionSchema).min(1).max(10),
  affectedObjectKeys: z.array(z.string().trim().min(1).max(240)).max(1_000),
  derivation: z.enum(['explicit', 'inferred', 'human_confirmed']),
  evidenceAnchorIds: z.array(z.string().trim().min(1).max(4_096)).min(1).max(1_000),
  potentiallyChangesDelivery: z.boolean(),
  optionEffectDigest: Sha256Schema,
  createdAt: z.string().min(1),
}).strict()

export const RequirementDecisionPlanningEffectRecordSchema = z.object({
  id: z.string().min(1),
  projectId: z.string().min(1),
  decisionId: z.string().min(1),
  operationId: z.string().min(1),
  phase: z.enum(['precheck', 'final']),
  decisionStatus: RequirementDecisionStatusSchema,
  chosenOptionKey: z.string().trim().min(1).max(100).optional(),
  decisionResolutionRevision: z.number().int().positive(),
  decisionResolutionDigest: Sha256Schema,
  sourcePolicyPrecheckId: z.string().min(1),
  sourcePolicyDigest: Sha256Schema,
  seedScenarioDigest: Sha256Schema,
  optionEffectIds: z.array(z.string().min(1)).min(1).max(20),
  affectedDimensions: z.array(DecisionEffectDimensionSchema).max(10),
  affectedRequiredObjectIds: z.array(z.string().min(1)).max(20_000),
  finalizationInputDigest: Sha256Schema.optional(),
  blocksPlanning: z.boolean(),
  determination: z.enum(['conservative_default', 'evidence_confirmed', 'human_confirmed_cosmetic']),
  reason: z.string().trim().min(1).max(2_000),
  nonBlockingAudit: z.object({ actor: z.string().trim().min(1).max(240), reason: z.string().trim().min(1).max(2_000), at: z.string().min(1) }).strict().optional(),
  policyVersion: z.string().trim().min(1).max(100),
  effectDigest: Sha256Schema,
  createdAt: z.string().min(1),
}).strict().superRefine((value, context) => {
  if (value.phase === 'final' && value.finalizationInputDigest === undefined) context.addIssue({ code: z.ZodIssueCode.custom, path: ['finalizationInputDigest'], message: 'Final Decision effect requires the exact finalization input digest.' })
  if (value.phase === 'precheck' && value.finalizationInputDigest !== undefined) context.addIssue({ code: z.ZodIssueCode.custom, path: ['finalizationInputDigest'], message: 'Precheck Decision effect cannot reference finalization inputs.' })
  if (value.decisionStatus === 'resolved' && value.chosenOptionKey === undefined) context.addIssue({ code: z.ZodIssueCode.custom, path: ['chosenOptionKey'], message: 'Resolved Decision effect requires a chosen option.' })
  if (value.determination === 'human_confirmed_cosmetic' && value.nonBlockingAudit === undefined) context.addIssue({ code: z.ZodIssueCode.custom, path: ['nonBlockingAudit'], message: 'A cosmetic Decision determination requires a human audit record.' })
})

export const PlanningStageAttemptRecordSchema = z.object({
  id: z.string().min(1),
  operationId: z.string().min(1),
  stage: PlanningOperationStageSchema,
  round: z.number().int().positive(),
  status: z.enum(['running', 'completed', 'failed', 'cancelled']),
  inputDigest: Sha256Schema,
  outputDigest: Sha256Schema.optional(),
  promptVersion: z.string().min(1).max(200).optional(),
  promptDigest: Sha256Schema.optional(),
  contextDigest: Sha256Schema.optional(),
  providerId: z.string().min(1).max(240).optional(),
  providerVersion: z.string().min(1).max(240).optional(),
  inputTokens: z.number().int().nonnegative().optional(),
  outputTokens: z.number().int().nonnegative().optional(),
  durationMs: z.number().int().nonnegative().optional(),
  errorCode: z.string().min(1).max(200).optional(),
  createdAt: z.string().min(1),
  completedAt: z.string().min(1).optional(),
}).strict().superRefine((value, context) => {
  if (value.status === 'running' && value.completedAt !== undefined) context.addIssue({ code: z.ZodIssueCode.custom, path: ['completedAt'], message: 'A running stage attempt cannot be completed.' })
  if (value.status === 'completed' && (value.outputDigest === undefined || value.completedAt === undefined)) context.addIssue({ code: z.ZodIssueCode.custom, path: ['outputDigest'], message: 'A completed stage attempt requires output digest and completion time.' })
  if ((value.status === 'failed' || value.status === 'cancelled') && value.completedAt === undefined) context.addIssue({ code: z.ZodIssueCode.custom, path: ['completedAt'], message: 'A terminal stage attempt requires completion time.' })
})

export const PlanningCheckpointRecordSchema = z.object({
  id: z.string().min(1),
  schemaVersion: z.literal(1),
  projectId: z.string().min(1),
  operationId: z.string().min(1),
  stage: PlanningOperationStageSchema,
  sequence: z.number().int().positive(),
  stageAttemptId: z.string().min(1).optional(),
  inputDigest: Sha256Schema,
  outputDigest: Sha256Schema,
  outputRecordIds: z.array(z.string().min(1)).max(50_000),
  outputRecordDigests: z.array(Sha256Schema).max(50_000),
  versions: z.object({
    planningContractVersion: z.number().int().positive(),
    metricPolicyVersion: z.string().min(1).max(100),
  }).strict(),
  sideEffectIdempotencyKeys: z.array(z.string().min(1).max(500)).max(1_000),
  pendingWriteIds: z.array(z.string().min(1).max(500)).max(50_000),
  commitMarker: z.literal('committed'),
  completionMarker: z.literal('completed'),
  recoverability: z.enum(['replay_safe', 'terminal']),
  blockingDiagnostics: z.array(PlanningV3DiagnosticSchema).max(1_000),
  operationDigest: Sha256Schema,
  checkpointDigest: Sha256Schema,
  createdAt: z.string().min(1),
}).strict().superRefine((value, context) => {
  if (value.pendingWriteIds.length > 0) context.addIssue({ code: z.ZodIssueCode.custom, path: ['pendingWriteIds'], message: 'A completed checkpoint cannot retain pending writes.' })
  if (new Set(value.outputRecordIds).size !== value.outputRecordIds.length) context.addIssue({ code: z.ZodIssueCode.custom, path: ['outputRecordIds'], message: 'Checkpoint output record ids must be unique.' })
  if (new Set(value.sideEffectIdempotencyKeys).size !== value.sideEffectIdempotencyKeys.length) context.addIssue({ code: z.ZodIssueCode.custom, path: ['sideEffectIdempotencyKeys'], message: 'Checkpoint side-effect idempotency keys must be unique.' })
})

export const StorageMutationIntentRecordSchema = z.object({
  id: z.string().min(1),
  projectId: z.string().min(1).optional(),
  aggregateType: z.string().min(1).max(100),
  aggregateId: z.string().min(1).max(500),
  idempotencyKey: z.string().min(1).max(500),
  expectedWrites: z.array(z.object({
    stepId: z.string().min(1).max(200),
    table: z.string().min(1).max(200),
    recordId: z.string().min(1).max(500),
    operation: z.enum(['put', 'delete']),
  }).strict()).min(1).max(10_000),
  completedStepIds: z.array(z.string().min(1).max(200)).max(10_000),
  status: z.enum(['pending', 'committed', 'needs_reconciliation']),
  errorCode: z.string().min(1).max(200).optional(),
  error: z.string().min(1).max(20_000).optional(),
  intentDigest: Sha256Schema,
  createdAt: z.string().min(1),
  updatedAt: z.string().min(1),
  completedAt: z.string().min(1).optional(),
}).strict().superRefine((value, context) => {
  const expectedStepIds = value.expectedWrites.map((write) => write.stepId)
  if (new Set(expectedStepIds).size !== expectedStepIds.length) context.addIssue({ code: z.ZodIssueCode.custom, path: ['expectedWrites'], message: 'Mutation intent step ids must be unique.' })
  if (new Set(value.completedStepIds).size !== value.completedStepIds.length || value.completedStepIds.some((id) => !expectedStepIds.includes(id))) context.addIssue({ code: z.ZodIssueCode.custom, path: ['completedStepIds'], message: 'Completed steps must be a unique subset of expected writes.' })
  if (value.status === 'committed' && (value.completedStepIds.length !== expectedStepIds.length || value.completedAt === undefined)) context.addIssue({ code: z.ZodIssueCode.custom, path: ['status'], message: 'Committed mutation intent requires every step and completion time.' })
  if (value.status === 'needs_reconciliation' && (value.errorCode === undefined || value.error === undefined)) context.addIssue({ code: z.ZodIssueCode.custom, path: ['status'], message: 'Reconciliation intent requires a stable error.' })
})

export const SourceDispositionBindingRecordSchema = z.object({
  id: z.string().min(1),
  projectId: z.string().min(1),
  operationId: z.string().min(1),
  sourceManifestDigest: Sha256Schema,
  sourceAnchorId: z.string().min(1),
  disposition: z.enum(['requirement', 'acceptance', 'decision', 'constraint']),
  targetType: z.enum(['requirement', 'acceptance', 'decision', 'source_constraint']),
  targetId: z.string().min(1),
  targetDigest: Sha256Schema,
  bindingDigest: Sha256Schema,
  createdAt: z.string().min(1),
}).strict()

export const RepositoryContextSnapshotV3RecordSchema = z.object({
  id: z.string().min(1),
  projectId: z.string().min(1),
  operationId: z.string().min(1),
  subject: z.discriminatedUnion('kind', [
    z.object({ kind: z.literal('planning') }).strict(),
    z.object({ kind: z.literal('final_delivery'), deliveryIntegrationSnapshotId: z.string().min(1), exactCommit: z.string().regex(/^[0-9a-f]{40,64}$/u) }).strict(),
  ]).optional(),
  canonicalRoot: z.string().min(1).max(4_096),
  headCommit: z.string().min(1).max(200),
  trackedTreeDigest: Sha256Schema,
  dirtyDigest: Sha256Schema,
  repositoryDigest: Sha256Schema,
  files: z.array(z.object({ path: z.string().min(1).max(4_096), digest: Sha256Schema }).strict()).max(20_000),
  // Legacy snapshots froze Git SHA-1 object ids here; new captures use SHA-256.
  workingFiles: z.array(z.object({ path: z.string().min(1).max(4_096), digest: RepositoryEvidenceDigestSchema }).strict()).max(22_000).optional(),
  dirtyFiles: z.array(z.string().min(1).max(4_096)).max(2_000).optional(),
  verifiedCommands: z.array(z.string().min(1).max(10_000)).max(100),
  status: z.enum(['ready', 'partial', 'failed', 'stale']),
  diagnostics: z.array(PlanningV3DiagnosticSchema).max(200).default([]),
  createdAt: z.string().min(1),
}).strict()

export const RepositoryStackProfileRecordSchema = z.object({
  id: z.string().min(1),
  projectId: z.string().min(1),
  operationId: z.string().min(1),
  repositorySnapshotId: z.string().min(1),
  languages: z.array(z.object({ id: z.string().min(1).max(160), evidenceIds: z.array(z.string().min(1)).max(10_000) }).strict()).max(100),
  frameworks: z.array(z.object({ id: z.string().min(1).max(160), evidenceIds: z.array(z.string().min(1)).max(10_000) }).strict()).max(100),
  dataLayers: z.array(z.object({ id: z.string().min(1).max(160), evidenceIds: z.array(z.string().min(1)).max(10_000) }).strict()).max(100),
  requiredSemanticCapabilities: z.array(z.enum(['symbols', 'routes', 'schema', 'relationships', 'consumers', 'tests', 'commands'])).max(7),
  providerCoverage: z.array(z.object({
    capability: z.enum(['symbols', 'routes', 'schema', 'relationships', 'consumers', 'tests', 'commands']),
    providerId: z.string().min(1).max(240).optional(),
    providerVersion: z.string().min(1).max(100).optional(),
    status: z.enum(['covered', 'partial', 'missing']),
    reason: z.string().min(1).max(2_000).optional(),
  }).strict()).max(100),
  supportStatus: z.enum(['supported', 'partial', 'unsupported']),
  supportPolicyVersion: z.string().min(1).max(100),
  stackProfileDigest: Sha256Schema,
  diagnostics: z.array(PlanningV3DiagnosticSchema).max(200).default([]),
  createdAt: z.string().min(1),
}).strict().superRefine((value, context) => {
  const required = new Set(value.requiredSemanticCapabilities)
  const covered = new Set(value.providerCoverage.filter((item) => item.status === 'covered').map((item) => item.capability))
  if (value.supportStatus === 'supported' && [...required].some((capability) => !covered.has(capability))) context.addIssue({ code: z.ZodIssueCode.custom, path: ['supportStatus'], message: 'A supported stack requires complete semantic provider coverage.' })
})

export const RepositoryEvidenceRetrievalReportSchema = z.object({
  id: z.string().min(1),
  projectId: z.string().min(1),
  operationId: z.string().min(1),
  repositorySnapshotId: z.string().min(1),
  repositoryDigest: Sha256Schema,
  indexVersion: z.string().min(1).max(100),
  querySeeds: z.array(z.object({
    requirementKey: z.string().regex(/^REQ-[A-Z0-9_-]+$/),
    terms: z.array(z.string().min(1).max(240)).max(200),
  }).strict()).max(1_000),
  inspectedFileCount: z.number().int().nonnegative().max(22_000),
  eligibleFileCount: z.number().int().nonnegative().max(22_000),
  selectedEvidenceIds: z.array(z.string().min(1).max(4_096)).max(2_000),
  requirementSelections: z.array(z.object({
    requirementKey: z.string().regex(/^REQ-[A-Z0-9_-]+$/),
    evidenceIds: z.array(z.string().min(1).max(4_096)).max(200),
    matchedTerms: z.array(z.string().min(1).max(240)).max(200),
    categoryCounts: z.record(z.enum(['source', 'test', 'schema', 'migration', 'workflow', 'docs', 'manifest', 'other']), z.number().int().nonnegative()),
  }).strict()).max(1_000),
  selectionLimit: z.number().int().positive().max(2_000),
  status: z.enum(['ready', 'partial', 'blocked']),
  diagnostics: z.array(PlanningV3DiagnosticSchema).max(1_000),
  reportDigest: Sha256Schema,
  createdAt: z.string().min(1),
}).strict().superRefine((value, context) => {
  if (value.selectedEvidenceIds.length > value.selectionLimit) context.addIssue({ code: z.ZodIssueCode.custom, path: ['selectedEvidenceIds'], message: 'Selected repository evidence exceeds the frozen selection limit.' })
  if (new Set(value.selectedEvidenceIds).size !== value.selectedEvidenceIds.length) context.addIssue({ code: z.ZodIssueCode.custom, path: ['selectedEvidenceIds'], message: 'Selected repository evidence ids must be unique.' })
  if (value.status === 'ready' && value.requirementSelections.some((selection) => selection.evidenceIds.length === 0)) context.addIssue({ code: z.ZodIssueCode.custom, path: ['status'], message: 'A ready retrieval report requires evidence for every Requirement.' })
})

export const CanonicalTargetBindingRecordSchema = z.object({
  id: z.string().min(1),
  projectId: z.string().min(1),
  operationId: z.string().min(1),
  resourceId: z.string().min(1),
  repositoryIdentityDigest: Sha256Schema,
  rootIdentityDigest: Sha256Schema,
  vcs: z.literal('git'),
  targetRef: z.string().regex(/^refs\/heads\/(?!dsh\/taskrun\/)[^\u0000-\u0020~^:?*\\\[]+$/u),
  planningBaseCommit: z.string().regex(/^[0-9a-f]{40,64}$/u),
  integrationPrincipalId: z.string().min(1).max(240),
  integrationGrantId: z.string().min(1),
  bindingVersion: z.number().int().positive(),
  bindingDigest: Sha256Schema,
  createdBy: z.string().min(1).max(240),
  createdAt: z.string().min(1),
  supersedesId: z.string().min(1).optional(),
}).strict()

export const RepositoryPolicyBaselineRecordSchema = z.object({
  id: z.string().min(1),
  projectId: z.string().min(1),
  createdByOperationId: z.string().min(1),
  predecessorBaselineId: z.string().min(1).optional(),
  repositoryIdentityDigest: Sha256Schema,
  repositoryDigest: Sha256Schema,
  extractorVersion: z.string().min(1).max(100),
  iteration: z.number().int().nonnegative(),
  constraintSeedIds: z.array(z.string().min(1)).max(1_000),
  constraintSeedSetDigest: Sha256Schema,
  baselineDigest: Sha256Schema,
  status: z.enum(['ready', 'needs_confirmation', 'blocked']),
  createdAt: z.string().min(1),
}).strict()

export const PolicyOperationKindSchema = z.enum(['read', 'write', 'delete', 'publish', 'deploy', 'network', 'credential'])
export const PolicyArtifactKindSchema = z.enum(['source', 'test', 'schema', 'migration', 'workflow', 'docs'])
export const PolicyLifecycleStageSchema = z.enum(['plan', 'implement', 'verify', 'integrate', 'release'])

export const PolicyTargetSelectorSchema = z.object({
  includePaths: z.array(z.string().min(1).max(4_096)).max(100),
  excludePaths: z.array(z.string().min(1).max(4_096)).max(100),
  artifactKinds: z.array(PolicyArtifactKindSchema).max(6),
  operationKinds: z.array(PolicyOperationKindSchema).max(7),
  lifecycleStages: z.array(PolicyLifecycleStageSchema).max(5),
  stackTags: z.array(z.string().min(1).max(160)).max(100),
}).strict()

export const PolicyApplicabilityDecisionSchema = z.object({
  subjectType: z.enum(['requirement', 'scenario']),
  subjectId: z.string().min(1),
  result: z.enum(['applicable', 'not_applicable', 'needs_confirmation']),
  matchedFacts: z.array(z.string().min(1).max(4_096)).max(100),
  reasonCode: z.string().min(1).max(100),
  evaluatorVersion: z.string().min(1).max(100),
}).strict()

export const PolicyConstraintRecordV3Schema = z.object({
  id: z.string().min(1),
  policySnapshotId: z.string().min(1),
  authority: z.enum(['system', 'user', 'project_agents', 'project_readme', 'tooling', 'unknown']),
  level: z.enum(['must', 'should', 'may']),
  statement: z.string().min(1).max(20_000),
  sourcePath: z.string().min(1).max(4_096).optional(),
  targetSelector: PolicyTargetSelectorSchema.optional(),
  applicabilityDecisions: z.array(PolicyApplicabilityDecisionSchema).max(2_000).optional(),
  applicability: z.enum(['applicable', 'not_applicable', 'needs_confirmation']),
  disposition: z.enum(['mapped', 'approved_not_applicable', 'unresolved']),
  mappedRequirementIds: z.array(z.string().min(1)).max(1_000),
  mappedScenarioIds: z.array(z.string().min(1)).max(1_000),
  reason: z.string().min(1).max(2_000).optional(),
  constraintDigest: Sha256Schema,
}).strict()

export const PlanningPolicySnapshotRecordSchema = z.object({
  id: z.string().min(1),
  projectId: z.string().min(1),
  operationId: z.string().min(1),
  repositorySnapshotId: z.string().min(1),
  comparedRepositoryPolicyBaselineId: z.string().min(1).optional(),
  comparedRepositoryPolicyBaselineDigest: Sha256Schema.optional(),
  constraintIds: z.array(z.string().min(1)).max(1_000),
  repositoryConstraintSeedSetDigest: Sha256Schema,
  repositoryPolicyDeltaSeedIds: z.array(z.string().min(1)).max(1_000),
  repositoryPolicyDeltaDigest: Sha256Schema,
  fixedPointStatus: z.enum(['converged', 'delta_found']),
  extractorVersion: z.string().min(1).max(100),
  status: z.enum(['ready', 'requires_replan', 'needs_confirmation', 'blocked', 'stale']),
  policyDigest: Sha256Schema,
  diagnostics: z.array(PlanningV3DiagnosticSchema).max(200).default([]),
  createdAt: z.string().min(1),
}).strict().superRefine((value, context) => {
  if (value.fixedPointStatus === 'converged' && value.status !== 'ready' && value.status !== 'needs_confirmation' && value.status !== 'blocked') context.addIssue({ code: z.ZodIssueCode.custom, path: ['status'], message: 'A converged policy snapshot must be ready or explicitly blocked on applicability.' })
  if (value.fixedPointStatus === 'delta_found' && value.status !== 'requires_replan') context.addIssue({ code: z.ZodIssueCode.custom, path: ['status'], message: 'A policy delta must require replan.' })
})

export const PlanningPromptReferenceManifestRecordSchema = z.object({
  id: z.string().min(1),
  projectId: z.string().min(1),
  operationId: z.string().min(1),
  stageAttemptId: z.string().min(1),
  references: z.array(z.object({
    ref: z.string().regex(/^ref-[a-z]+-[a-z0-9_-]+$/),
    kind: z.enum(['policy_constraint', 'evidence_claim', 'repository_evidence', 'verification_command', 'binding_surface']),
    artifactId: z.string().min(1),
    artifactDigest: RepositoryEvidenceDigestSchema,
  }).strict().superRefine((reference, context) => {
    if (reference.kind !== 'repository_evidence' && reference.artifactDigest.length !== 64) context.addIssue({ code: z.ZodIssueCode.custom, path: ['artifactDigest'], message: 'Only legacy repository evidence may retain a Git SHA-1 object digest.' })
  })).max(10_000),
  allowedRefSetDigest: Sha256Schema,
  manifestDigest: Sha256Schema,
  createdAt: z.string().min(1),
}).strict().superRefine((value, context) => {
  const refs = value.references.map((item) => item.ref)
  if (new Set(refs).size !== refs.length) context.addIssue({ code: z.ZodIssueCode.custom, path: ['references'], message: 'Prompt refs must be unique inside an attempt.' })
})

export const BindingImpactDimensionSchema = z.enum(['domain_owner', 'write_path', 'read_path', 'data', 'state', 'api', 'permission', 'async', 'consumer', 'failure', 'test', 'migration', 'release', 'rollback'])
export const BindingImpactAssessmentSchema = z.object({
  dimension: BindingImpactDimensionSchema,
  applicability: z.enum(['required', 'not_applicable', 'unknown']),
  evidenceRefs: z.array(z.string().min(1)).max(100),
  reason: z.string().trim().min(1).max(2_000),
}).strict().superRefine((value, context) => {
  if (value.applicability === 'required' && value.evidenceRefs.length === 0) context.addIssue({ code: z.ZodIssueCode.custom, path: ['evidenceRefs'], message: 'A required impact dimension needs repository evidence.' })
})

export const GeneratedBindingEventFactChainV3Schema = z.object({
  factKey: z.string().regex(/^[A-Z][A-Z0-9_-]{0,159}$/),
  eventObservableKey: z.string().regex(/^EVT-[A-Z0-9_-]+$/),
  scenarioKeys: z.array(z.string().regex(/^SCN-[A-Z0-9_-]+$/)).min(1).max(100),
  eventTypes: z.array(z.string().trim().min(1).max(500)).min(1).max(20),
  recordOwnerSymbols: z.array(z.string().trim().min(1).max(500)).min(1).max(20),
  persistedCollectionOwnerSymbols: z.array(z.string().trim().min(1).max(500)).min(1).max(20),
  readSurfaceOwnerSymbols: z.array(z.string().trim().min(1).max(500)).min(1).max(20),
  producerOwnerSymbols: z.array(z.string().trim().min(1).max(500)).min(1).max(20),
  fixtureEvidenceRefs: z.array(z.string().min(1)).min(1).max(20),
  assertionEvidenceRefs: z.array(z.string().min(1)).min(1).max(20),
  correlation: z.string().trim().min(1).max(2_000),
  assertsAbsence: z.boolean(),
}).strict()

export const GeneratedBindingAnalysisV3Schema = z.object({
  status: z.enum(['ready', 'blocked']),
  diagnostics: z.array(PlanningV3DiagnosticSchema).max(200),
  bindings: z.array(z.object({
    key: z.string().regex(/^BIND-[A-Z0-9_-]+$/),
    requirementKey: z.string().regex(/^REQ-[A-Z0-9_-]+$/),
    changeIntent: z.enum(['existing', 'modify', 'new', 'remove', 'unknown']),
    impactAssessments: z.array(BindingImpactAssessmentSchema).length(14),
    evidenceRefs: z.array(z.string().min(1)).min(1).max(100),
    allowedPathScopes: z.array(z.string().min(1).max(4_096)).min(1).max(100),
    excludedPathScopes: z.array(z.string().min(1).max(4_096)).max(100),
    ownerSymbols: z.array(z.string().min(1).max(500)).max(100),
    currentBehaviorClaims: z.array(z.string().min(1).max(2_000)).min(1).max(100),
    eventFactChains: z.array(GeneratedBindingEventFactChainV3Schema).max(100).default([]),
  }).strict()).max(1_000),
}).strict().superRefine((value, context) => {
  for (const [index, binding] of value.bindings.entries()) {
    const dimensions = binding.impactAssessments.map((assessment) => assessment.dimension)
    if (new Set(dimensions).size !== BindingImpactDimensionSchema.options.length || BindingImpactDimensionSchema.options.some((dimension) => !dimensions.includes(dimension))) context.addIssue({ code: z.ZodIssueCode.custom, path: ['bindings', index, 'impactAssessments'], message: 'Every Binding impact dimension must be dispositioned exactly once.' })
    if (value.status === 'ready' && binding.impactAssessments.some((assessment) => assessment.applicability === 'unknown')) context.addIssue({ code: z.ZodIssueCode.custom, path: ['bindings', index, 'impactAssessments'], message: 'A ready Binding cannot contain an unknown impact disposition.' })
  }
})

export const RequirementCodeBindingRecordSchema = z.object({
  id: z.string().min(1),
  projectId: z.string().min(1),
  operationId: z.string().min(1),
  key: z.string().regex(/^BIND-[A-Z0-9_-]+$/),
  requirementId: z.string().min(1),
  repositorySnapshotId: z.string().min(1),
  repositoryDigest: Sha256Schema,
  changeIntent: z.enum(['existing', 'modify', 'new', 'remove']),
  impactDimensions: z.array(BindingImpactDimensionSchema).min(1).max(14),
  impactAssessments: z.array(z.object({
    dimension: BindingImpactDimensionSchema,
    applicability: z.enum(['required', 'not_applicable']),
    evidenceIds: z.array(z.string().min(1)).max(100),
    reason: z.string().trim().min(1).max(2_000),
  }).strict()).length(14),
  evidenceIds: z.array(z.string().min(1)).min(1).max(100),
  allowedPathScopes: z.array(z.string().min(1).max(4_096)).min(1).max(100),
  excludedPathScopes: z.array(z.string().min(1).max(4_096)).max(100),
  ownerSymbols: z.array(z.string().min(1).max(500)).max(100),
  currentBehaviorClaims: z.array(z.string().min(1).max(2_000)).min(1).max(100),
  eventFactChains: z.array(z.object({
    factKey: z.string().regex(/^[A-Z][A-Z0-9_-]{0,159}$/),
    eventObservableKey: z.string().regex(/^EVT-[A-Z0-9_-]+$/).optional(),
    scenarioKeys: z.array(z.string().regex(/^SCN-[A-Z0-9_-]+$/)).min(1).max(100),
    eventTypes: z.array(z.string().trim().min(1).max(500)).min(1).max(20),
    recordOwnerSymbols: z.array(z.string().trim().min(1).max(500)).min(1).max(20),
    persistedCollectionOwnerSymbols: z.array(z.string().trim().min(1).max(500)).min(1).max(20),
    readSurfaceOwnerSymbols: z.array(z.string().trim().min(1).max(500)).min(1).max(20),
    producerOwnerSymbols: z.array(z.string().trim().min(1).max(500)).min(1).max(20),
    fixtureEvidenceIds: z.array(z.string().min(1)).min(1).max(20),
    assertionEvidenceIds: z.array(z.string().min(1)).min(1).max(20),
    correlation: z.string().trim().min(1).max(2_000),
    assertsAbsence: z.boolean(),
  }).strict()).max(100).optional(),
  bindingDigest: Sha256Schema,
  createdAt: z.string().min(1),
}).strict().superRefine((value, context) => {
  const dimensions = value.impactAssessments.map((assessment) => assessment.dimension)
  if (new Set(dimensions).size !== BindingImpactDimensionSchema.options.length || BindingImpactDimensionSchema.options.some((dimension) => !dimensions.includes(dimension))) context.addIssue({ code: z.ZodIssueCode.custom, path: ['impactAssessments'], message: 'Every persisted Binding impact dimension must be dispositioned exactly once.' })
  const requiredDimensions = value.impactAssessments.filter((assessment) => assessment.applicability === 'required').map((assessment) => assessment.dimension).sort()
  if (JSON.stringify(requiredDimensions) !== JSON.stringify([...value.impactDimensions].sort())) context.addIssue({ code: z.ZodIssueCode.custom, path: ['impactDimensions'], message: 'Required impact dimensions must equal the persisted impact assessment projection.' })
  if (value.impactAssessments.some((assessment) => assessment.applicability === 'required' && assessment.evidenceIds.length === 0)) context.addIssue({ code: z.ZodIssueCode.custom, path: ['impactAssessments'], message: 'A required persisted impact dimension needs repository evidence.' })
})

export const AcceptanceScenarioRecordSchema = z.object({
  id: z.string().min(1),
  projectId: z.string().min(1),
  operationId: z.string().min(1),
  requirementKey: z.string().regex(/^REQ-[A-Z0-9_-]+$/),
  acceptanceKey: z.string().regex(/^AC-[A-Z0-9_-]+$/),
  requirementId: z.string().min(1),
  acceptanceCriterionId: z.string().min(1),
  key: z.string().regex(/^SCN-[A-Z0-9_-]+$/),
  category: AcceptanceScenarioCategorySchema,
  derivationPhase: z.enum(['seed', 'completion']),
  preconditions: z.array(z.string().min(1).max(2_000)).min(1).max(50),
  trigger: z.string().min(1).max(5_000),
  expectedOutcomes: z.array(z.string().min(1).max(5_000)).min(1).max(50),
  observableAt: z.array(z.object({ kind: z.enum(['api', 'ui', 'database', 'event', 'log', 'test', 'artifact']), description: z.string().min(1).max(2_000) }).strict()).min(1).max(20),
  eventObservables: z.array(z.object({
    key: z.string().regex(/^EVT-[A-Z0-9_-]+$/),
    description: z.string().min(1).max(2_000),
    expectation: z.enum(['present', 'absent']),
  }).strict()).max(50).optional(),
  derivation: z.enum(['explicit', 'inferred']),
  assumptions: z.array(z.string().min(1).max(2_000)).max(50),
  required: z.boolean(),
  sourceAnchorIds: z.array(z.string().min(1).max(4_096)).min(1).max(100),
  scenarioDigest: Sha256Schema,
  createdAt: z.string().min(1),
}).strict()

export const AcceptanceScenarioCoveragePolicyRecordSchema = z.object({
  id: z.string().min(1),
  projectId: z.string().min(1),
  operationId: z.string().min(1),
  requirementId: z.string().min(1),
  acceptanceCriterionId: z.string().min(1),
  requirementDigest: Sha256Schema,
  riskDerivationInputDigest: Sha256Schema,
  categories: z.array(z.object({
    category: AcceptanceScenarioCategorySchema,
    applicability: z.enum(['required', 'not_applicable', 'uncertain']),
    reasonCode: z.string().min(1).max(100),
    sourceAnchorIds: z.array(z.string().min(1)).min(1).max(100),
    reviewerId: z.string().min(1).optional(),
  }).strict()).length(7),
  policyVersion: z.string().min(1).max(100),
  baselineOperationId: z.string().min(1).optional(),
  baselineCoveragePolicyDigest: Sha256Schema.optional(),
  coveragePolicyDigest: Sha256Schema,
  createdAt: z.string().min(1),
}).strict().superRefine((value, context) => {
  const categories = value.categories.map((item) => item.category)
  if (new Set(categories).size !== AcceptanceScenarioCategorySchema.options.length || AcceptanceScenarioCategorySchema.options.some((category) => !categories.includes(category))) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['categories'], message: 'Coverage policy must contain exactly one disposition for every Scenario category.' })
  }
  if (value.categories.find((item) => item.category === 'happy_path')?.applicability !== 'required') {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['categories'], message: 'happy_path must always be required.' })
  }
})

export const PlanningRiskProfileRecordSchema = z.object({
  id: z.string().min(1),
  projectId: z.string().min(1),
  operationId: z.string().min(1),
  level: z.enum(['low', 'medium', 'high', 'critical']),
  dimensions: z.array(z.enum(['data', 'state', 'permission', 'async', 'api', 'security', 'performance', 'migration', 'release'])).max(20),
  requiredEvidenceKinds: z.array(z.enum(['policy', 'manifest', 'file', 'symbol', 'route', 'schema', 'state_transition', 'consumer', 'test', 'command', 'graph_edge'])).min(1).max(20),
  requiredReviewKinds: z.array(z.enum(['requirement', 'binding', 'plan', 'assignment', 'convergence'])).min(1).max(10),
  requiredScenarioCategories: z.array(AcceptanceScenarioCategorySchema).min(1).max(7),
  sourcePolicyPrecheckId: z.string().min(1),
  sourcePolicyDigest: Sha256Schema,
  seedScenarioDigest: Sha256Schema,
  acceptanceScenarioCoveragePolicyIds: z.array(z.string().min(1)).min(1).max(10_000),
  acceptanceScenarioCoveragePolicyDigest: Sha256Schema,
  riskDerivationInputDigest: Sha256Schema,
  requiresIndependentReviewer: z.boolean(),
  requiresTaskPreflight: z.boolean(),
  requiresConvergence: z.boolean(),
  reasonSourceAnchorIds: z.array(z.string().min(1)).min(1).max(1_000),
  policyVersion: z.string().min(1).max(100),
  riskProfileDigest: Sha256Schema,
  createdAt: z.string().min(1),
}).strict()

export const SourcePolicyPrecheckRecordSchema = z.object({
  id: z.string().min(1),
  projectId: z.string().min(1),
  operationId: z.string().min(1),
  sourceManifestId: z.string().min(1),
  sourceConstraintIds: z.array(z.string().min(1)).max(10_000),
  repositoryPolicyBaselineId: z.string().min(1).optional(),
  repositoryPolicyBaselineDigest: Sha256Schema.optional(),
  inheritedRepositoryConstraintSeedIds: z.array(z.string().min(1)).max(10_000),
  unresolvedMustConstraintIds: z.array(z.string().min(1)).max(10_000),
  sourceManifestDigest: Sha256Schema,
  precheckInputDigest: Sha256Schema,
  policyVersion: z.string().min(1).max(100),
  sourcePolicyDigest: Sha256Schema,
  status: z.enum(['ready', 'needs_confirmation', 'blocked']),
  createdAt: z.string().min(1),
}).strict()

export const ScenarioCoverageReviewRecordSchema = z.object({
  id: z.string().min(1),
  projectId: z.string().min(1),
  operationId: z.string().min(1),
  round: z.number().int().positive(),
  coveragePolicyIds: z.array(z.string().min(1)).min(1).max(10_000),
  coveragePolicyDigest: Sha256Schema,
  fullScenarioIds: z.array(z.string().min(1)).min(1).max(10_000),
  fullScenarioDigest: Sha256Schema,
  planningRiskProfileId: z.string().min(1),
  riskProfileDigest: Sha256Schema,
  reviewerAgentId: z.string().min(1),
  authorAgentIds: z.array(z.string().min(1)).min(1).max(100),
  independenceStatus: z.enum(['independent', 'not_required', 'violated']),
  status: z.enum(['approved', 'changes_requested', 'blocked']),
  findings: z.array(PlanningReviewFindingSchema).max(1_000),
  reviewerPromptVersion: z.string().min(1).max(100),
  deterministicPolicyVersion: z.string().min(1).max(100),
  reviewInputDigest: Sha256Schema,
  reviewDigest: Sha256Schema,
  createdAt: z.string().min(1),
}).strict()

export const PlanningReviewRecordV3Schema = z.object({
  id: z.string().min(1),
  projectId: z.string().min(1),
  operationId: z.string().min(1),
  kind: z.enum(['requirement', 'binding', 'plan']),
  round: z.number().int().positive(),
  reviewerAgentId: z.string().min(1),
  authorAgentIds: z.array(z.string().min(1)).min(1).max(100),
  independenceStatus: z.enum(['independent', 'not_required', 'violated']),
  subjectDigest: Sha256Schema,
  sourceManifestDigest: Sha256Schema,
  repositoryDigest: Sha256Schema.optional(),
  requirementDigest: Sha256Schema,
  bindingStageIdentifierCompatibilityRequired: z.boolean().optional(),
  status: z.enum(['approved', 'changes_requested', 'blocked']),
  findings: z.array(PlanningReviewFindingSchema).max(1_000),
  reviewerPromptVersion: z.string().min(1).max(100),
  deterministicPolicyVersion: z.string().min(1).max(100),
  capabilityRequirementDigest: Sha256Schema.optional(),
  reviewInputDigest: Sha256Schema,
  reviewDigest: Sha256Schema,
  createdAt: z.string().min(1),
}).strict()

export const GeneratedPlanningReviewV3Schema = z.object({
  status: z.enum(['approved', 'changes_requested', 'blocked']),
  reviewedInputDigest: Sha256Schema,
  findings: z.array(PlanningReviewFindingSchema).max(1_000),
}).strict().superRefine((value, context) => {
  if (value.status === 'approved' && value.findings.length > 0) context.addIssue({ code: z.ZodIssueCode.custom, path: ['findings'], message: 'An approved planning review cannot contain findings.' })
})

export const GeneratedScenarioCoverageReviewV3Schema = z.object({
  status: z.enum(['approved', 'changes_requested', 'blocked']),
  reviewedInputDigest: Sha256Schema,
  findings: z.array(PlanningReviewFindingSchema).max(1_000),
}).strict().superRefine((value, context) => {
  if (value.status === 'approved' && value.findings.some((finding) => finding.severity === 'error' || finding.severity === 'blocking')) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['findings'], message: 'An approved Scenario coverage review cannot contain blocking findings.' })
  }
})

export const GeneratedScenarioCompletionV3Schema = z.object({
  status: z.enum(['ready', 'blocked']),
  diagnostics: z.array(PlanningV3DiagnosticSchema).max(200),
  scenarios: z.array(z.object({
    requirementKey: z.string().regex(/^REQ-[A-Z0-9_-]+$/),
    acceptanceKey: z.string().regex(/^AC-[A-Z0-9_-]+$/),
    key: z.string().regex(/^SCN-[A-Z0-9_-]+$/),
    category: AcceptanceScenarioCategorySchema,
    preconditions: z.array(z.string().min(1).max(2_000)).min(1).max(50),
    trigger: z.string().min(1).max(5_000),
    expectedOutcomes: z.array(z.string().min(1).max(5_000)).min(1).max(50),
    observableAt: z.array(z.object({ kind: z.enum(['api', 'ui', 'database', 'event', 'log', 'test', 'artifact']), description: z.string().min(1).max(2_000) }).strict()).min(1).max(20),
    eventObservables: z.array(z.object({
      key: z.string().regex(/^EVT-[A-Z0-9_-]+$/),
      description: z.string().min(1).max(2_000),
      expectation: z.enum(['present', 'absent']),
    }).strict()).max(50).default([]),
    derivation: z.enum(['explicit', 'inferred']),
    assumptions: z.array(z.string().min(1).max(2_000)).max(50),
    required: z.boolean(),
    sourceAnchorIds: z.array(z.string().min(1).max(4_096)).min(1).max(100),
  }).strict().superRefine((scenario, context) => {
    const hasEventObservable = scenario.observableAt.some((observable) => observable.kind === 'event')
    if (hasEventObservable && scenario.eventObservables.length === 0) context.addIssue({ code: z.ZodIssueCode.custom, path: ['eventObservables'], message: 'An event-observable Scenario must declare every independent event fact.' })
    if (!hasEventObservable && scenario.eventObservables.length > 0) context.addIssue({ code: z.ZodIssueCode.custom, path: ['eventObservables'], message: 'Scenario event facts require an event observableAt entry.' })
    const keys = scenario.eventObservables.map((observable) => observable.key)
    if (new Set(keys).size !== keys.length) context.addIssue({ code: z.ZodIssueCode.custom, path: ['eventObservables'], message: 'Scenario event observable keys must be unique.' })
  })).max(5_000),
}).strict().superRefine((value, context) => {
  if (value.status === 'blocked' && value.scenarios.length > 0) context.addIssue({ code: z.ZodIssueCode.custom, path: ['scenarios'], message: 'Blocked scenario completion cannot publish scenarios.' })
})

const GeneratedTaskContextPackV3Schema = z.object({
  objective: z.string().min(1).max(10_000),
  whyNow: z.string().min(1).max(5_000),
  inScope: z.array(z.string().min(1).max(2_000)).min(1).max(100),
  outOfScope: z.array(z.string().min(1).max(2_000)).max(100),
  requirementStatements: z.array(z.string().min(1).max(2_000)).min(1).max(100),
  currentBehaviorClaimRefs: z.array(z.string().min(1)).min(1).max(100),
  targetBehavior: z.string().min(1).max(10_000),
  startingPoints: z.array(z.object({ evidenceRef: z.string().min(1), reason: z.string().min(1).max(2_000) }).strict()).min(1).max(100),
  expectedChangeSurfaces: z.array(z.string().min(1).max(4_096)).min(1).max(100),
  forbiddenChangeSurfaces: z.array(z.string().min(1).max(4_096)).max(100),
  invariants: z.array(z.string().min(1).max(2_000)).max(100),
  verificationHarness: z.object({
    kind: z.literal('browser'),
    runner: z.string().min(1).max(500),
    applicationStart: z.string().min(1).max(2_000),
    fixtureMutation: z.enum(['read_only', 'create_and_cleanup']).optional(),
    fixtureSetup: z.string().min(1).max(2_000),
    navigation: z.string().min(1).max(2_000),
    asyncWait: z.string().min(1).max(2_000),
    persistedFactCorrelation: z.string().min(1).max(2_000),
    teardown: z.string().min(1).max(2_000),
  }).strict().optional(),
  verificationSteps: z.array(z.object({ scenarioKey: z.string().min(1), action: z.string().min(1).max(2_000), expectedObservable: z.string().min(1).max(2_000), commandEvidenceRef: z.string().min(1).optional() }).strict()).min(1).max(100),
  expectedArtifacts: z.array(z.string().min(1).max(2_000)).min(1).max(100),
  escalationConditions: z.array(z.string().min(1).max(2_000)).min(1).max(100),
  unknowns: z.array(z.object({ question: z.string().min(1).max(2_000), blocking: z.boolean(), owner: z.string().min(1).max(240) }).strict()).max(100),
}).strict()

export const GeneratedPlanV3Schema = z.object({
  contractVersion: z.literal(3),
  summary: z.string().min(1).max(5_000),
  status: z.enum(['ready', 'blocked']),
  blockedReasons: z.array(PlanningV3DiagnosticSchema).max(200),
  workPackages: z.array(z.object({
    key: z.string().regex(/^WP-[A-Z0-9_-]+$/),
    title: z.string().min(1).max(240),
    businessOutcome: z.string().min(1).max(5_000),
    requirementKeys: z.array(z.string().min(1)).min(1).max(100),
    acceptanceKeys: z.array(z.string().min(1)).min(1).max(200),
    bindingKeys: z.array(z.string().min(1)).min(1).max(100),
  }).strict()).max(200),
  tasks: z.array(z.object({
    key: z.string().regex(/^TASK-[A-Z0-9_-]+$/),
    workPackageKey: z.string().min(1),
    title: z.string().min(1).max(240),
    kind: TaskKindSchema,
    relationship: z.enum(['implementation', 'verification', 'review', 'migration', 'release']),
    description: z.string().min(1).max(20_000),
    requirementKeys: z.array(z.string().min(1)).min(1).max(100),
    acceptanceKeys: z.array(z.string().min(1)).min(1).max(200),
    scenarioKeys: z.array(z.string().min(1)).min(1).max(200),
    decisionKeys: z.array(z.string().min(1)).max(100),
    policyConstraintRefs: z.array(z.string().min(1)).max(100),
    bindingKeys: z.array(z.string().min(1)).min(1).max(100),
    evidenceClaimRefs: z.array(z.string().min(1)).min(1).max(100),
    dependencyKeys: z.array(z.string().min(1)).max(100),
    verificationCommandRefs: z.array(z.string().min(1)).min(1).max(20),
    completionCriteria: z.array(z.string().min(1).max(2_000)).min(1).max(100),
    risk: TaskRiskLevelSchema,
    contextPack: GeneratedTaskContextPackV3Schema,
    changeContract: z.object({
      allowedPathScopes: z.array(z.string().min(1).max(4_096)).min(1).max(100),
      excludedPathScopes: z.array(z.string().min(1).max(4_096)).max(100),
      conflictKeys: z.array(z.string().min(1).max(200)).max(100),
      expectedArtifacts: z.array(z.string().min(1).max(2_000)).min(1).max(100),
      outOfScopePolicy: z.enum(['fail', 'review']),
    }).strict(),
  }).strict()).max(200),
}).strict().superRefine((value, context) => {
  if (value.status === 'blocked' && value.tasks.length > 0) context.addIssue({ code: z.ZodIssueCode.custom, path: ['tasks'], message: 'A blocked V3 plan cannot contain executable proposals.' })
  if (value.status === 'ready' && value.blockedReasons.some((item) => item.severity === 'error' || item.severity === 'blocking')) context.addIssue({ code: z.ZodIssueCode.custom, path: ['blockedReasons'], message: 'A ready V3 plan cannot contain blocking diagnostics.' })
})

export const PlanningProposalPackRecordSchema = z.object({
  id: z.string().min(1),
  projectId: z.string().min(1),
  operationId: z.string().min(1),
  promptReferenceManifestId: z.string().min(1),
  promptReferenceManifestDigest: Sha256Schema,
  bindingAnalysis: GeneratedBindingAnalysisV3Schema,
  plan: GeneratedPlanV3Schema,
  proposalDigest: Sha256Schema,
  status: z.enum(['ready', 'blocked']),
  createdAt: z.string().min(1),
}).strict().superRefine((value, context) => {
  if (value.status !== value.plan.status) context.addIssue({ code: z.ZodIssueCode.custom, path: ['status'], message: 'Proposal pack status must match its plan.' })
})

export const PlanningReferenceMapRecordSchema = z.object({
  id: z.string().min(1),
  operationId: z.string().min(1),
  reservedPlanSnapshotId: z.string().min(1),
  reservedPlanRevision: z.number().int().positive(),
  workPackageIdsByKey: z.record(z.string(), z.string().min(1)),
  taskIdsByKey: z.record(z.string(), z.string().min(1)),
  capabilityRequirementIdsByTaskKey: z.record(z.string(), z.string().min(1)),
  assignmentDecisionIdsByTaskKey: z.record(z.string(), z.string().min(1)),
  mapDigest: Sha256Schema,
  createdAt: z.string().min(1),
}).strict()

export const PolicyFulfillmentRecordSchema = z.object({
  id: z.string().min(1),
  projectId: z.string().min(1),
  operationId: z.string().min(1),
  policySnapshotId: z.string().min(1),
  policyDigest: Sha256Schema,
  policyConstraintId: z.string().min(1),
  planningReferenceMapId: z.string().min(1),
  disposition: z.enum(['fulfilled', 'approved_not_applicable']),
  reservedTaskIds: z.array(z.string().min(1)).max(1_000),
  verificationCommandIds: z.array(z.string().min(1)).max(100),
  subjectMappings: z.array(z.object({
    subjectType: z.enum(['requirement', 'scenario']),
    subjectId: z.string().min(1),
    reservedTaskIds: z.array(z.string().min(1)).min(1).max(1_000),
    verificationCommandIds: z.array(z.string().min(1)).min(1).max(100),
  }).strict()).max(2_000).optional(),
  approvalAudit: z.object({ actor: z.string().min(1), reason: z.string().min(1), at: z.string().min(1) }).strict().optional(),
  fulfillmentDigest: Sha256Schema,
  createdAt: z.string().min(1),
}).strict().superRefine((value, context) => {
  if (value.disposition === 'fulfilled' && (value.reservedTaskIds.length === 0 || value.verificationCommandIds.length === 0)) context.addIssue({ code: z.ZodIssueCode.custom, path: ['reservedTaskIds'], message: 'Fulfilled policy requires Task and verification mappings.' })
  if (value.disposition === 'fulfilled' && value.subjectMappings !== undefined && value.subjectMappings.length === 0) context.addIssue({ code: z.ZodIssueCode.custom, path: ['subjectMappings'], message: 'A subject-scoped fulfilled policy requires per-subject Task and verification mappings.' })
  if (value.disposition === 'approved_not_applicable' && (value.reservedTaskIds.length > 0 || value.verificationCommandIds.length > 0 || value.approvalAudit === undefined)) context.addIssue({ code: z.ZodIssueCode.custom, path: ['approvalAudit'], message: 'Not-applicable policy requires an audit and empty execution mappings.' })
})

export const CapabilityDefinitionRecordSchema = z.object({
  id: CapabilityIdSchema,
  version: z.number().int().positive(),
  key: CapabilityIdSchema,
  displayName: z.string().min(1).max(240),
  description: z.string().max(2_000),
  parentCapabilityIds: z.array(CapabilityIdSchema).max(50),
  compatibleRoleIds: z.array(DeliveryRoleSchema).max(7),
  status: z.enum(['active', 'deprecated']),
  definitionDigest: Sha256Schema,
}).strict().superRefine((value, context) => {
  if (value.id !== value.key) context.addIssue({ code: z.ZodIssueCode.custom, path: ['id'], message: 'Capability definition id must equal its canonical key.' })
})

export const AgentCapabilityClaimRecordSchema = z.object({
  id: z.string().min(1),
  projectId: z.string().min(1).optional(),
  agentId: z.string().min(1),
  capabilityId: CapabilityIdSchema,
  capabilityVersion: z.number().int().positive(),
  source: z.enum(['human_confirmed', 'managed_registry', 'legacy_pending_mapping']),
  status: z.enum(['active', 'pending', 'revoked', 'expired']),
  confirmedBy: z.string().min(1).max(240).optional(),
  evidenceRef: z.string().min(1).max(4_096).optional(),
  validFrom: z.string().min(1),
  validUntil: z.string().min(1).optional(),
  claimDigest: Sha256Schema,
}).strict().superRefine((value, context) => {
  if ((value.source === 'human_confirmed' || value.source === 'managed_registry') && value.status === 'active' && value.confirmedBy === undefined) context.addIssue({ code: z.ZodIssueCode.custom, path: ['confirmedBy'], message: 'Trusted active capability claims require provenance.' })
  if (value.source === 'legacy_pending_mapping' && value.status === 'active') context.addIssue({ code: z.ZodIssueCode.custom, path: ['status'], message: 'Legacy capability strings cannot become active without confirmation.' })
})

export const ProjectCapabilityCatalogSnapshotRecordSchema = z.object({
  id: z.string().min(1),
  projectId: z.string().min(1),
  operationId: z.string().min(1),
  definitionVersions: z.array(z.object({ capabilityId: CapabilityIdSchema, version: z.number().int().positive() }).strict()).max(1_000),
  activeClaimIds: z.array(z.string().min(1)).max(10_000),
  pendingMappingClaimIds: z.array(z.string().min(1)).max(10_000),
  projectMembershipDigest: Sha256Schema,
  catalogPolicyVersion: z.string().min(1).max(100),
  capabilityCatalogDigest: Sha256Schema,
  createdAt: z.string().min(1),
}).strict()

export const ResourceAccessGrantRecordSchema = z.object({
  id: z.string().min(1),
  projectId: z.string().min(1),
  principalType: z.enum(['agent', 'integration_service']),
  principalId: z.string().min(1),
  resourceId: z.string().min(1),
  repositoryIdentityDigest: Sha256Schema,
  permissions: z.array(z.enum(['evidence_read', 'repository_read', 'worktree_write', 'command_execute', 'artifact_write', 'canonical_integrate'])).min(1).max(6),
  pathScopes: z.array(z.string().min(1).max(4_096)).min(1).max(100),
  commandIds: z.array(z.string().min(1)).max(100),
  grantedBy: z.string().min(1).max(240),
  grantSource: z.enum(['project_membership', 'resource_binding', 'manual']),
  validFrom: z.string().min(1),
  expiresAt: z.string().min(1).optional(),
  revokedAt: z.string().min(1).optional(),
  reason: z.string().min(1).max(2_000),
  grantDigest: Sha256Schema,
}).strict().superRefine((value, context) => {
  if (value.principalType === 'agent' && value.permissions.includes('canonical_integrate')) context.addIssue({ code: z.ZodIssueCode.custom, path: ['permissions'], message: 'Agent grants cannot authorize canonical integration.' })
  if (value.principalType === 'integration_service' && !value.permissions.includes('canonical_integrate')) context.addIssue({ code: z.ZodIssueCode.custom, path: ['permissions'], message: 'Integration service grants require canonical integration permission.' })
  if (value.pathScopes.some((scope) => scope.startsWith('/') || scope.includes('*') || scope.split('/').includes('..'))) context.addIssue({ code: z.ZodIssueCode.custom, path: ['pathScopes'], message: 'Access grant scopes must be bounded repository-relative paths.' })
})

export const ProjectAccessGrantSnapshotRecordSchema = z.object({
  id: z.string().min(1),
  projectId: z.string().min(1),
  operationId: z.string().min(1),
  grantIds: z.array(z.string().min(1)).max(10_000),
  resourceDigest: Sha256Schema,
  teamDigest: Sha256Schema,
  snapshotDigest: Sha256Schema,
  createdAt: z.string().min(1),
}).strict()

export const CapabilityRequirementDraftRecordSchema = z.object({
  id: z.string().min(1),
  projectId: z.string().min(1),
  operationId: z.string().min(1),
  reservedTaskId: z.string().min(1),
  taskKey: z.string().min(1),
  requiredRoles: z.array(DeliveryRoleSchema).min(1).max(7),
  requiredCapabilities: z.array(CapabilityIdSchema).max(50),
  requiresIndependentReviewer: z.boolean(),
  derivationRuleVersion: z.string().min(1).max(100),
  sourceBindingKeys: z.array(z.string().min(1)).min(1).max(100),
  requirementDigest: Sha256Schema,
  createdAt: z.string().min(1),
}).strict()

export const AssignmentDraftRecordSchema = z.object({
  id: z.string().min(1),
  projectId: z.string().min(1),
  operationId: z.string().min(1),
  reservedTaskId: z.string().min(1),
  taskKey: z.string().min(1),
  capabilityRequirementDraftId: z.string().min(1),
  candidates: z.array(z.object({ agentId: z.string().min(1), structuralEligibility: z.enum(['eligible', 'ineligible']), reasonCodes: z.array(z.string().min(1)).max(100) }).strict()).max(100),
  selectedTargetType: z.enum(['agent', 'squad']).optional(),
  selectedTargetId: z.string().min(1).optional(),
  executingAgentId: z.string().min(1).optional(),
  routingSquadId: z.string().min(1).optional(),
  dispatchStatus: z.enum(['dispatchable', 'waiting_runtime', 'waiting_capacity', 'waiting_conflict', 'blocked']).optional(),
  assignmentDraftDigest: Sha256Schema,
  createdAt: z.string().min(1),
}).strict().superRefine((value, context) => {
  const selectionFields = [value.selectedTargetType, value.selectedTargetId, value.executingAgentId]
  const selectedCount = selectionFields.filter((item) => item !== undefined).length
  if (selectedCount !== 0 && selectedCount !== selectionFields.length) context.addIssue({ code: z.ZodIssueCode.custom, path: ['selectedTargetId'], message: 'Assignment selection fields must be all present or all absent.' })
  if (selectedCount === 0 && value.dispatchStatus !== 'blocked') context.addIssue({ code: z.ZodIssueCode.custom, path: ['dispatchStatus'], message: 'An unselected assignment must be blocked.' })
  if (value.executingAgentId !== undefined && !value.candidates.some((candidate) => candidate.agentId === value.executingAgentId && candidate.structuralEligibility === 'eligible')) context.addIssue({ code: z.ZodIssueCode.custom, path: ['executingAgentId'], message: 'Executing Agent must be structurally eligible in this draft.' })
  if (value.selectedTargetType === 'agent' && value.selectedTargetId !== value.executingAgentId) context.addIssue({ code: z.ZodIssueCode.custom, path: ['selectedTargetId'], message: 'A direct Agent target must be the executing Agent.' })
  if (value.selectedTargetType === 'squad' && value.routingSquadId !== value.selectedTargetId) context.addIssue({ code: z.ZodIssueCode.custom, path: ['routingSquadId'], message: 'A Squad target must retain its routing Squad id.' })
})

export const ExpectedAssignmentFixtureRecordSchema = z.object({
  id: z.string().min(1),
  projectId: z.string().min(1),
  responsibilityKey: z.string().trim().min(1).max(240),
  repositoryDigest: Sha256Schema,
  teamDigest: Sha256Schema,
  metricPolicyId: z.string().min(1),
  metricPolicyVersion: z.string().min(1).max(100),
  metricPolicyDigest: Sha256Schema,
  expectedOutcome: z.enum(['selected', 'abstained']),
  allowedOwnerIds: z.array(z.string().min(1)).max(100),
  allowedSquadMemberIds: z.array(z.string().min(1)).max(100),
  expectedAbstentionReasonCodes: z.array(z.string().min(1).max(100)).max(100),
  critical: z.boolean(),
  rationaleEvidenceIds: z.array(z.string().min(1)).min(1).max(1_000),
  fixtureDigest: Sha256Schema,
  createdAt: z.string().min(1),
}).strict().superRefine((value, context) => {
  if (value.expectedOutcome === 'selected' && value.allowedOwnerIds.length === 0) context.addIssue({ code: z.ZodIssueCode.custom, path: ['allowedOwnerIds'], message: 'A selected Gold fixture requires at least one allowed executing owner.' })
  if (value.expectedOutcome === 'abstained' && (value.allowedOwnerIds.length > 0 || value.expectedAbstentionReasonCodes.length === 0)) context.addIssue({ code: z.ZodIssueCode.custom, path: ['expectedOutcome'], message: 'An abstained Gold fixture requires no owners and at least one expected reason.' })
})

export const AssignmentEvaluationRecordSchema = z.object({
  id: z.string().min(1),
  projectId: z.string().min(1),
  operationId: z.string().min(1),
  taskKey: z.string().min(1),
  evaluationCohort: z.enum(['production', 'gold']),
  risk: z.enum(['low', 'medium', 'high', 'critical']),
  assignmentDraftId: z.string().min(1),
  assignmentDraftDigest: Sha256Schema,
  eligibleAgentIds: z.array(z.string().min(1)).max(100),
  selectedTargetType: z.enum(['agent', 'squad']).optional(),
  selectedTargetId: z.string().min(1).optional(),
  executingAgentId: z.string().min(1).optional(),
  routingSquadId: z.string().min(1).optional(),
  outcome: z.enum(['selected', 'abstained_no_eligible', 'abstained_ambiguous', 'abstained_access', 'abstained_runtime_incompatible']),
  reasonCodes: z.array(z.string().min(1)).max(100),
  reasonSourceRecordIds: z.array(z.string().min(1)).max(1_000),
  goldFixtureId: z.string().min(1).optional(),
  goldFixtureDigest: Sha256Schema.optional(),
  goldResponsibilityKey: z.string().min(1).max(240).optional(),
  goldExpectedOutcome: z.enum(['selected', 'abstained']).optional(),
  goldCritical: z.boolean().optional(),
  goldAllowedOwnerIds: z.array(z.string().min(1)).max(100).optional(),
  goldAllowedSquadMemberIds: z.array(z.string().min(1)).max(100).optional(),
  goldExpectedAbstentionReasonCodes: z.array(z.string().min(1)).max(100).optional(),
  metricPolicyId: z.string().min(1),
  metricPolicyVersion: z.string().min(1).max(100),
  metricPolicyDigest: Sha256Schema,
  evaluationDigest: Sha256Schema,
  createdAt: z.string().min(1),
}).strict().superRefine((value, context) => {
  const selectionFields = [value.selectedTargetType, value.selectedTargetId, value.executingAgentId]
  const selectedCount = selectionFields.filter((item) => item !== undefined).length
  if (value.outcome === 'selected' && selectedCount !== selectionFields.length) context.addIssue({ code: z.ZodIssueCode.custom, path: ['outcome'], message: 'A selected evaluation requires target and executing Agent fields.' })
  if (value.outcome !== 'selected' && selectedCount !== 0) context.addIssue({ code: z.ZodIssueCode.custom, path: ['outcome'], message: 'An abstained evaluation cannot select an execution target.' })
  if (value.executingAgentId !== undefined && !value.eligibleAgentIds.includes(value.executingAgentId)) context.addIssue({ code: z.ZodIssueCode.custom, path: ['executingAgentId'], message: 'Selected executing Agent must be in the eligible set.' })
  const goldFields = [value.goldFixtureId, value.goldFixtureDigest, value.goldResponsibilityKey, value.goldExpectedOutcome, value.goldCritical, value.goldAllowedOwnerIds, value.goldAllowedSquadMemberIds, value.goldExpectedAbstentionReasonCodes]
  if (value.evaluationCohort === 'gold' && goldFields.some((field) => field === undefined)) context.addIssue({ code: z.ZodIssueCode.custom, path: ['evaluationCohort'], message: 'Gold evaluations require a complete immutable fixture copy.' })
  if (value.evaluationCohort === 'production' && goldFields.some((field) => field !== undefined)) context.addIssue({ code: z.ZodIssueCode.custom, path: ['evaluationCohort'], message: 'Production evaluations cannot carry Gold truth fields.' })
})

export const PlanningMetricReleaseReportCreateRecordSchema = z.object({
  id: z.string().min(1),
  scopeKey: z.string().regex(/^(global|project:[^:]+)$/u),
  projectId: z.string().min(1).optional(),
  releaseId: z.string().trim().min(1).max(200),
  metricPolicyId: z.string().min(1),
  operationIds: z.array(z.string().min(1)).max(100_000),
  observationIds: z.array(z.string().min(1)).max(100_000),
  idempotencyKey: z.string().trim().min(1).max(200),
  requestDigest: Sha256Schema,
  outcome: z.enum(['created', 'replayed_existing', 'rejected_conflict']),
  releaseReportId: z.string().min(1).optional(),
  createdAt: z.string().min(1),
}).strict()

export const PlanningMetricReleaseReportRecordSchema = z.object({
  id: z.string().min(1),
  scopeKey: z.string().regex(/^(global|project:[^:]+)$/u),
  projectId: z.string().min(1).optional(),
  releaseId: z.string().trim().min(1).max(200),
  metricPolicyScopeKey: z.string().regex(/^(global|project:[^:]+)$/u),
  metricPolicyId: z.string().min(1),
  metricPolicyVersion: z.string().min(1).max(100),
  metricPolicyDigest: Sha256Schema,
  operationIds: z.array(z.string().min(1)).max(100_000),
  observationIds: z.array(z.string().min(1)).max(100_000),
  sampleWindowStart: z.string().min(1),
  sampleWindowEnd: z.string().min(1),
  metricResults: z.array(z.object({
    metricKey: z.string().min(1).max(100),
    numerator: z.number().nonnegative(),
    denominator: z.number().nonnegative(),
    sampleSize: z.number().int().nonnegative(),
    value: z.number(),
    gate: z.enum(['passed', 'failed', 'insufficient_sample']),
  }).strict()).min(1).max(100),
  reportInputDigest: Sha256Schema,
  reportDigest: Sha256Schema,
  createdAt: z.string().min(1),
}).strict()

export const TaskPreflightRecordV3Schema = z.object({
  id: z.string().min(1),
  projectId: z.string().min(1),
  operationId: z.string().min(1),
  reservedTaskId: z.string().min(1),
  taskKey: z.string().min(1),
  assignmentDraftId: z.string().min(1),
  assignmentDraftDigest: Sha256Schema,
  agentId: z.string().min(1),
  agentReportedStatus: z.enum(['accepted', 'needs_clarification', 'rejected']),
  serviceVerdict: z.enum(['accepted', 'needs_clarification', 'rejected']),
  acceptanceChecks: z.array(z.object({
    code: z.enum(['agent_matches_assignment', 'identity_auditable', 'structurally_eligible', 'access_current', 'context_current', 'evidence_read', 'objective_restated', 'starting_point_covered', 'allowed_scope_covered', 'forbidden_scope_acknowledged', 'verification_covered', 'escalation_covered', 'no_blocking_unknowns']),
    status: z.enum(['pass', 'fail']),
    failureDisposition: z.enum(['clarify_upstream', 'reject_candidate']).optional(),
    restartStage: PlanningOperationStageSchema.optional(),
  }).strict()).length(13),
  missingFacts: z.array(z.string().min(1).max(2_000)).max(100),
  verdictInputDigest: Sha256Schema,
  preflightDigest: Sha256Schema,
  createdAt: z.string().min(1),
}).strict().superRefine((value, context) => {
  const codes = value.acceptanceChecks.map((check) => check.code)
  if (new Set(codes).size !== 13) context.addIssue({ code: z.ZodIssueCode.custom, path: ['acceptanceChecks'], message: 'Task preflight must contain each deterministic check exactly once.' })
  const failures = value.acceptanceChecks.filter((check) => check.status === 'fail')
  if (failures.some((check) => check.failureDisposition === undefined || check.restartStage === undefined)) context.addIssue({ code: z.ZodIssueCode.custom, path: ['acceptanceChecks'], message: 'Every failed preflight check requires a disposition and canonical restart stage.' })
  if (value.serviceVerdict === 'accepted' && (failures.length > 0 || value.agentReportedStatus !== 'accepted')) context.addIssue({ code: z.ZodIssueCode.custom, path: ['serviceVerdict'], message: 'Service cannot accept a failed or non-accepted Agent preflight.' })
})

export const PlanApprovalV3RecordSchema = z.object({
  id: z.string().min(1),
  projectId: z.string().min(1),
  planSnapshotId: z.string().min(1),
  planDigest: Sha256Schema,
  projectRevision: z.number().int().positive(),
  approverId: z.string().min(1).max(240),
  gateDigest: Sha256Schema,
  accessGrantSnapshotId: z.string().min(1),
  accessGrantDigest: Sha256Schema,
  repositoryStackProfileId: z.string().min(1),
  repositoryStackProfileDigest: Sha256Schema,
  canonicalTargetBindingId: z.string().min(1),
  canonicalTargetBindingDigest: Sha256Schema,
  decisionEffectPrecheckDigest: Sha256Schema.optional(),
  decisionEffectFinalDigest: Sha256Schema.optional(),
  convergenceCarryValidationDigest: Sha256Schema.optional(),
  executionDispatchStatusAtApproval: z.enum(['dispatchable', 'partially_dispatchable', 'waiting_dependency', 'waiting_runtime', 'waiting_capacity', 'waiting_conflict', 'blocked']),
  idempotencyKey: z.string().min(1).max(200),
  approvalDigest: Sha256Schema,
  approvedAt: z.string().min(1),
}).strict()

export const ExecutionDispatchRecordSchema = z.object({
  id: z.string().min(1),
  projectId: z.string().min(1),
  approvalId: z.string().min(1),
  expectedProjectRevision: z.number().int().positive(),
  requestedTaskIds: z.array(z.string().min(1)).min(1).max(1_000),
  outcome: z.enum(['started', 'partially_started', 'waiting', 'blocked', 'stale']),
  taskResults: z.array(z.object({
    taskId: z.string().min(1),
    taskRevision: z.number().int().positive(),
    outcome: z.enum(['started', 'waiting_dependency', 'waiting_capacity', 'waiting_runtime', 'waiting_conflict', 'blocked', 'stale']),
    predecessorTaskIds: z.array(z.string().min(1)).max(100),
    reasonCodes: z.array(z.string().min(1)).max(100),
    taskRunId: z.string().min(1).optional(),
  }).strict()).min(1).max(1_000),
  createdTaskRunIds: z.array(z.string().min(1)).max(1_000),
  observedGateDigest: Sha256Schema,
  runnableFrontierDigest: Sha256Schema,
  idempotencyKey: z.string().min(1).max(200),
  dispatchDigest: Sha256Schema,
  createdAt: z.string().min(1),
}).strict().superRefine((value, context) => {
  const requested = value.requestedTaskIds
  const resultIds = value.taskResults.map((result) => result.taskId)
  if (new Set(requested).size !== requested.length) context.addIssue({ code: z.ZodIssueCode.custom, path: ['requestedTaskIds'], message: 'Requested Task ids must be unique.' })
  if (new Set(resultIds).size !== resultIds.length || requested.length !== resultIds.length || requested.some((id) => !resultIds.includes(id))) context.addIssue({ code: z.ZodIssueCode.custom, path: ['taskResults'], message: 'Dispatch must contain exactly one result for every requested Task.' })
  const startedRunIds = value.taskResults.flatMap((result) => result.outcome === 'started' && result.taskRunId !== undefined ? [result.taskRunId] : [])
  if (value.taskResults.some((result) => (result.outcome === 'started') !== (result.taskRunId !== undefined))) context.addIssue({ code: z.ZodIssueCode.custom, path: ['taskResults'], message: 'Only started Task results may reference a TaskRun.' })
  if (new Set(value.createdTaskRunIds).size !== value.createdTaskRunIds.length || startedRunIds.length !== value.createdTaskRunIds.length || startedRunIds.some((id) => !value.createdTaskRunIds.includes(id))) context.addIssue({ code: z.ZodIssueCode.custom, path: ['createdTaskRunIds'], message: 'Created TaskRuns must exactly match started Task results.' })
  if ((value.outcome === 'blocked' || value.outcome === 'stale' || value.outcome === 'waiting') && value.createdTaskRunIds.length > 0) context.addIssue({ code: z.ZodIssueCode.custom, path: ['createdTaskRunIds'], message: 'Blocked, stale, or waiting dispatch cannot create TaskRuns.' })
  if (value.outcome === 'started' && startedRunIds.length !== value.taskResults.length) context.addIssue({ code: z.ZodIssueCode.custom, path: ['outcome'], message: 'Started dispatch requires every requested Task to start.' })
  if (value.outcome === 'partially_started' && (startedRunIds.length === 0 || startedRunIds.length === value.taskResults.length)) context.addIssue({ code: z.ZodIssueCode.custom, path: ['outcome'], message: 'Partially started dispatch requires both started and waiting results.' })
})

export const ConvergenceSubjectTypeSchema = z.enum([
  'requirement', 'scenario', 'policy', 'binding', 'task', 'code_surface', 'verification', 'integration_output',
])
export const DeliveryConvergenceFindingRecordSchema = z.object({
  id: z.string().min(1),
  reviewId: z.string().min(1),
  code: z.enum(['unmet', 'partial', 'unrequested', 'policy_violation', 'stale_verification']),
  severity: z.enum(['warning', 'error', 'blocking']),
  subjectType: ConvergenceSubjectTypeSchema,
  subjectId: z.string().min(1),
  evidenceIds: z.array(z.string().min(1)).max(10_000),
  message: z.string().min(1).max(20_000),
  findingDigest: Sha256Schema,
}).strict()

export const IntegrationChangedPathSchema = z.object({
  path: z.string().min(1).max(4_096),
  beforeBlob: z.string().min(1).max(200).optional(),
  afterBlob: z.string().min(1).max(200).optional(),
  beforeMode: z.string().min(1).max(20).optional(),
  afterMode: z.string().min(1).max(20).optional(),
}).strict()

export const IntegrationInclusionEvidenceRecordSchema = z.object({
  id: z.string().min(1),
  integrationSnapshotId: z.string().min(1),
  sequence: z.number().int().positive(),
  taskId: z.string().min(1),
  taskRevision: z.number().int().positive(),
  taskRunId: z.string().min(1),
  sourceBaseCommit: z.string().regex(/^[0-9a-f]{40,64}$/u),
  sourceHeadCommit: z.string().regex(/^[0-9a-f]{40,64}$/u).optional(),
  sourceTree: z.string().regex(/^[0-9a-f]{40,64}$/u).optional(),
  sourceDiffDigest: Sha256Schema,
  sourcePatchIds: z.array(Sha256Schema).max(10_000),
  changedPaths: z.array(IntegrationChangedPathSchema).max(2_000),
  targetParentCommitBefore: z.string().regex(/^[0-9a-f]{40,64}$/u),
  targetTreeBefore: z.string().regex(/^[0-9a-f]{40,64}$/u),
  targetCommitAfter: z.string().regex(/^[0-9a-f]{40,64}$/u),
  targetTreeAfter: z.string().regex(/^[0-9a-f]{40,64}$/u),
  proofKind: z.enum(['ancestor', 'patch_hunk_tree_equivalence', 'duplicate', 'no_code_change']),
  matchedPatchIds: z.array(Sha256Schema).max(10_000),
  duplicateEvidenceId: z.string().min(1).optional(),
  toolVersion: z.string().min(1).max(100),
  result: z.enum(['verified', 'failed']),
  failureCode: z.string().min(1).max(200).optional(),
  evidenceDigest: Sha256Schema,
}).strict().superRefine((value, context) => {
  if (value.proofKind === 'no_code_change' && (value.sourcePatchIds.length > 0 || value.changedPaths.length > 0 || value.targetParentCommitBefore !== value.targetCommitAfter || value.targetTreeBefore !== value.targetTreeAfter)) context.addIssue({ code: z.ZodIssueCode.custom, path: ['proofKind'], message: 'No-code evidence requires an empty source diff and unchanged target commit/tree.' })
  if (value.proofKind === 'duplicate' && value.duplicateEvidenceId === undefined) context.addIssue({ code: z.ZodIssueCode.custom, path: ['duplicateEvidenceId'], message: 'Duplicate proof requires the earlier verified evidence id.' })
  if (value.result === 'failed' && value.failureCode === undefined) context.addIssue({ code: z.ZodIssueCode.custom, path: ['failureCode'], message: 'Failed inclusion evidence requires a stable failure code.' })
})

export const DeliveryIntegrationOutputSchema = z.object({
  sequence: z.number().int().positive(),
  taskId: z.string().min(1),
  taskRunId: z.string().min(1),
  baseCommit: z.string().regex(/^[0-9a-f]{40,64}$/u),
  headCommit: z.string().regex(/^[0-9a-f]{40,64}$/u).optional(),
  diffDigest: Sha256Schema,
  patchIds: z.array(Sha256Schema).max(10_000),
  integrationMethod: z.enum(['in_place', 'merge', 'cherry_pick', 'manual_resolution', 'no_code_change']),
  status: z.enum(['pending', 'integrated', 'conflicted', 'rejected']),
  targetParentCommitBefore: z.string().regex(/^[0-9a-f]{40,64}$/u),
  targetTreeBefore: z.string().regex(/^[0-9a-f]{40,64}$/u),
  targetCommitAfter: z.string().regex(/^[0-9a-f]{40,64}$/u),
  targetTreeAfter: z.string().regex(/^[0-9a-f]{40,64}$/u),
  inclusionStatus: z.enum(['pending', 'verified', 'duplicate', 'no_code_change', 'failed']),
  inclusionEvidenceIds: z.array(z.string().min(1)).max(100),
  audit: z.object({ actor: z.string().min(1).max(240), reason: z.string().min(1).max(2_000), at: z.string().min(1) }).strict().optional(),
}).strict()

export const DeliveryIntegrationSnapshotRecordSchema = z.object({
  id: z.string().min(1),
  projectId: z.string().min(1),
  approvedPlanSnapshotId: z.string().min(1),
  canonicalTargetBindingId: z.string().min(1),
  canonicalTargetBindingDigest: Sha256Schema,
  accessGrantSnapshotId: z.string().min(1),
  accessGrantSnapshotDigest: Sha256Schema,
  targetResourceId: z.string().min(1),
  repositoryIdentityDigest: Sha256Schema,
  targetRef: z.string().min(1).max(500),
  baseCommit: z.string().regex(/^[0-9a-f]{40,64}$/u),
  expectedTargetHead: z.string().regex(/^[0-9a-f]{40,64}$/u),
  outputs: z.array(DeliveryIntegrationOutputSchema).min(1).max(1_000),
  finalCommit: z.string().regex(/^[0-9a-f]{40,64}$/u).optional(),
  observedTargetHeadAtFinalize: z.string().regex(/^[0-9a-f]{40,64}$/u).optional(),
  casStatus: z.enum(['pending', 'matched', 'moved', 'failed']),
  targetClean: z.boolean(),
  status: z.enum(['pending', 'integrating', 'conflicted', 'ready', 'failed', 'stale']),
  integrationDigest: Sha256Schema,
  createdAt: z.string().min(1),
}).strict().superRefine((value, context) => {
  if (value.outputs.some((output, index) => output.sequence !== index + 1)) context.addIssue({ code: z.ZodIssueCode.custom, path: ['outputs'], message: 'Integration output sequence must be continuous and ordered.' })
  for (let index = 1; index < value.outputs.length; index += 1) {
    const previous = value.outputs[index - 1]!
    const current = value.outputs[index]!
    if (current.targetParentCommitBefore !== previous.targetCommitAfter || current.targetTreeBefore !== previous.targetTreeAfter) context.addIssue({ code: z.ZodIssueCode.custom, path: ['outputs', index], message: 'Integration commit and tree continuity must both hold.' })
  }
  if (value.status === 'ready') {
    const last = value.outputs.at(-1)!
    if (value.finalCommit !== last.targetCommitAfter || value.observedTargetHeadAtFinalize !== value.finalCommit || value.casStatus !== 'matched' || !value.targetClean || value.outputs.some((output) => output.status !== 'integrated' || !['verified', 'duplicate', 'no_code_change'].includes(output.inclusionStatus) || output.inclusionEvidenceIds.length !== 1)) context.addIssue({ code: z.ZodIssueCode.custom, path: ['status'], message: 'A ready Integration snapshot requires a clean CAS-matched final commit and exact-one verified evidence for every output.' })
  }
})

export const DeliveryConvergenceReviewRecordSchema = z.object({
  id: z.string().min(1),
  projectId: z.string().min(1),
  approvedPlanSnapshotId: z.string().min(1),
  deliveryIntegrationSnapshotId: z.string().min(1),
  integratedFinalCommit: z.string().regex(/^[0-9a-f]{40,64}$/u),
  finalRepositorySnapshotId: z.string().min(1),
  finalRepositoryDigest: Sha256Schema,
  requirementDigest: Sha256Schema,
  acceptanceScenarioDigest: Sha256Schema,
  acceptanceScenarioCoveragePolicyDigest: Sha256Schema,
  policyDigest: Sha256Schema,
  bindingDigest: Sha256Schema,
  approvedPlanDigest: Sha256Schema,
  integrationDigest: Sha256Schema,
  verificationEvidenceDigest: Sha256Schema,
  status: z.enum(['converged', 'changes_required', 'blocked', 'failed', 'stale']),
  findingIds: z.array(z.string().min(1)).max(10_000),
  findingSetDigest: Sha256Schema,
  reviewerVersion: z.string().min(1).max(100),
  convergenceDigest: Sha256Schema,
  repairRequestStatus: z.enum(['not_required', 'pending', 'created', 'blocked']),
  repairRequestDigest: Sha256Schema.optional(),
  repairBaselineId: z.string().min(1).optional(),
  repairPlanningOperationId: z.string().min(1).optional(),
  createdAt: z.string().min(1),
}).strict().superRefine((value, context) => {
  if (value.status === 'converged' && (value.findingIds.length > 0 || value.repairRequestStatus !== 'not_required')) context.addIssue({ code: z.ZodIssueCode.custom, path: ['status'], message: 'Converged delivery cannot retain findings or a repair request.' })
  if (value.status !== 'converged' && value.findingIds.length === 0) context.addIssue({ code: z.ZodIssueCode.custom, path: ['findingIds'], message: 'A non-converged review requires immutable findings.' })
})

export const ConvergenceRepairCarryItemRecordSchema = z.object({
  id: z.string().min(1),
  projectId: z.string().min(1),
  repairBaselineId: z.string().min(1),
  subjectType: ConvergenceSubjectTypeSchema,
  subjectId: z.string().min(1),
  sourceRecordId: z.string().min(1),
  sourceSubjectDigest: Sha256Schema,
  sourceBindingClosureDigest: Sha256Schema,
  sourceVerificationInputDigest: Sha256Schema,
  sourceFinalCommitReachabilityDigest: Sha256Schema,
  disposition: z.enum(['carry_current', 'reverify', 'reexecute', 'superseded']),
  reasonCode: z.string().min(1).max(200),
  evidenceIds: z.array(z.string().min(1)).max(10_000),
  carryItemDigest: Sha256Schema,
  createdAt: z.string().min(1),
}).strict()

export const ConvergenceRepairBaselineRecordSchema = z.object({
  id: z.string().min(1),
  projectId: z.string().min(1),
  parentPlanSnapshotId: z.string().min(1),
  parentIntegrationSnapshotId: z.string().min(1),
  parentConvergenceReviewId: z.string().min(1),
  canonicalTargetBindingId: z.string().min(1),
  canonicalTargetBindingDigest: Sha256Schema,
  finalCommit: z.string().regex(/^[0-9a-f]{40,64}$/u),
  finalRepositorySnapshotId: z.string().min(1),
  requirementDigest: Sha256Schema,
  scenarioDigest: Sha256Schema,
  policyDigest: Sha256Schema,
  findingIds: z.array(z.string().min(1)).min(1).max(10_000),
  findingSetDigest: Sha256Schema,
  findingDispositions: z.array(z.object({ findingId: z.string().min(1), disposition: z.enum(['carry_current', 'reverify', 'reexecute', 'superseded']), reasonCode: z.string().min(1).max(200) }).strict()).min(1).max(10_000),
  carryItemIds: z.array(z.string().min(1)).min(1).max(20_000),
  carryItemSetDigest: Sha256Schema,
  baselineDigest: Sha256Schema,
  createdAt: z.string().min(1),
}).strict().superRefine((value, context) => {
  const findingIds = [...value.findingIds].sort()
  const dispositionIds = value.findingDispositions.map((item) => item.findingId).sort()
  if (new Set(findingIds).size !== findingIds.length || JSON.stringify(findingIds) !== JSON.stringify(dispositionIds)) context.addIssue({ code: z.ZodIssueCode.custom, path: ['findingDispositions'], message: 'Repair baseline requires exact-one disposition for every immutable finding.' })
  if (new Set(value.carryItemIds).size !== value.carryItemIds.length) context.addIssue({ code: z.ZodIssueCode.custom, path: ['carryItemIds'], message: 'Repair baseline carry item ids must be unique.' })
})

export const ConvergenceCarryValidationRecordSchema = z.object({
  id: z.string().min(1),
  projectId: z.string().min(1),
  repairBaselineId: z.string().min(1),
  successorOperationId: z.string().min(1),
  carryItemId: z.string().min(1),
  subjectType: ConvergenceSubjectTypeSchema,
  subjectId: z.string().min(1),
  disposition: z.enum(['carry_current', 'reverify', 'reexecute', 'superseded']),
  sourceSubjectDigest: Sha256Schema,
  targetSubjectDigest: Sha256Schema.optional(),
  sourceBindingClosureDigest: Sha256Schema,
  targetBindingClosureDigest: Sha256Schema.optional(),
  sourceVerificationInputDigest: Sha256Schema,
  targetVerificationInputDigest: Sha256Schema.optional(),
  sourceFinalCommitReachabilityDigest: Sha256Schema,
  targetFinalCommitReachabilityDigest: Sha256Schema.optional(),
  result: z.enum(['valid', 'invalid']),
  mismatchCodes: z.array(z.enum(['carry-subject-changed', 'carry-binding-closure-changed', 'carry-verification-input-changed', 'carry-final-commit-unreachable', 'carry-target-missing', 'carry-disposition-invalid'])).max(6),
  validatorVersion: z.string().min(1).max(100),
  validationDigest: Sha256Schema,
  createdAt: z.string().min(1),
}).strict()

export const BlockedGeneratedPlanSchema = z.object({
  status: z.literal('blocked'),
  reasonCode: z.enum(['repository_unavailable', 'manifest_missing', 'verification_command_unconfirmed', 'requirement_conflict']),
  summary: z.string().trim().min(1).max(5_000),
  missingEvidence: z.array(z.string().trim().min(1).max(2_000)).min(1).max(100),
  nextAction: z.string().trim().min(1).max(5_000),
}).strict()

export const PlannerResultSchema = z.union([
  GeneratedPlanSchema.extend({ status: z.literal('ready'), repositoryEvidence: RepositoryEvidenceSchema }).strict(),
  BlockedGeneratedPlanSchema,
])

export const AgentInputSchema = z.object({
  name: z.string().trim().min(1).max(100),
  role: z.string().trim().min(1).max(200),
  description: z.string().trim().max(500).default(''),
  persona: z.string().trim().min(1).max(20_000),
  provider: z.string().trim().max(200).optional(),
  model: z.string().trim().max(300).optional(),
  preset: z.string().trim().min(1).max(100).default('standard'),
  toolPolicy: AgentToolPolicySchema.default('full'),
  skills: SkillsSchema.default([]),
  capabilities: z.array(z.string().trim().min(1).max(160)).max(100).default([]),
  runtimeId: z.string().min(1).optional(),
  access: z.enum(['only_me', 'workspace', 'specific_people']).default('only_me'),
  maxConcurrency: z.number().int().positive().max(32).default(1),
})

const DEFAULT_TECHNICAL_DESIGN = 'No separate technical design was supplied. Inspect the repository read-only, follow its existing architecture and tests, state material assumptions in the generated plan, and choose the smallest implementation that satisfies the delivery brief.'

export const ProjectSourceSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('local_directory'),
    path: z.string().trim().min(1).max(4_096),
  }).strict(),
  z.object({
    kind: z.literal('github_repo'),
    repositoryUrl: z.string().trim().url().max(4_096),
    ref: z.string().trim().min(1).max(500),
    issueNumbers: z.array(z.number().int().positive()).max(100).default([]).superRefine((numbers, context) => {
      if (new Set(numbers).size !== numbers.length) context.addIssue({ code: z.ZodIssueCode.custom, message: 'GitHub Issue numbers must be unique.' })
    }),
  }).strict(),
])

export const RepositoryInspectRequestSchema = z.object({
  repositoryUrl: z.string().trim().url().max(4_096),
}).strict()

export const RepositoryBranchSchema = z.object({
  name: z.string().min(1).max(500),
  protected: z.boolean().default(false),
}).strict()

export const RepositoryIssueSchema = z.object({
  number: z.number().int().positive(),
  title: z.string().min(1).max(240),
  body: z.string().max(100_000),
  url: z.string().url().max(4_096),
  labels: z.array(z.string().min(1).max(64)).max(50),
}).strict()

export const RepositoryInspectionSchema = z.object({
  repositoryUrl: z.string().url().max(4_096),
  owner: z.string().min(1).max(100),
  name: z.string().min(1).max(100),
  defaultBranch: z.string().min(1).max(500),
  branches: z.array(RepositoryBranchSchema).min(1).max(5_000),
  issues: z.array(RepositoryIssueSchema).max(5_000),
}).strict()

const ImportedPdfPageImageSchema = z.object({
  page: z.number().int().positive().max(1_000),
  mediaType: z.literal('image/jpeg'),
  dataBase64: z.string().min(4).max(3_000_000).regex(/^[A-Za-z0-9+/]+={0,2}$/, 'Image data must be valid base64.'),
}).strict()

export const RequirementDocumentImportSchema = z.object({
  fileName: z.string().trim().min(1).max(240),
  documentHash: z.string().regex(/^[a-f0-9]{64}$/),
  documentKind: z.enum(['prd', 'technical_design']),
  pageCount: z.number().int().positive().max(1_000),
  textPageCount: z.number().int().nonnegative().max(1_000),
  visualPageCount: z.number().int().nonnegative().max(1_000),
  extractedText: z.string().max(500_000),
  images: z.array(ImportedPdfPageImageSchema).max(20),
}).strict().superRefine((value, context) => {
  if (value.textPageCount > value.pageCount || value.visualPageCount > value.pageCount) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['pageCount'], message: 'PDF page metadata is inconsistent.' })
  }
  if (value.extractedText.trim() === '' && value.images.length === 0) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['extractedText'], message: 'The PDF did not provide readable text or page images.' })
  }
  if (new Set(value.images.map((image) => image.page)).size !== value.images.length) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['images'], message: 'PDF image page numbers must be unique.' })
  }
  if (value.images.some((image) => image.page > value.pageCount)) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['images'], message: 'PDF image page numbers must exist in the document.' })
  }
})

export const RequirementDocumentImportResultSchema = z.object({
  markdown: z.string().trim().min(1).max(500_000),
  documentHash: z.string().regex(/^[a-f0-9]{64}$/),
  sourceBlocks: z.array(RequirementSourceBlockSchema).min(1).max(10_000),
  pageCount: z.number().int().positive(),
  textPageCount: z.number().int().nonnegative(),
  analyzedImagePages: z.array(z.number().int().positive()).max(20),
  warnings: z.array(z.string().min(1).max(500)).max(10),
}).strict()

const ProjectEditableInputSchema = z.object({
  name: z.string().trim().max(160).default(''),
  summary: z.string().trim().max(1_000).default(''),
  cwd: z.string().trim().min(1).max(4_096),
  prd: z.string().trim().max(500_000).default(''),
  technicalDesign: z.string().trim().max(500_000).default(''),
  prdSourceBlocks: z.array(RequirementSourceBlockSchema).max(10_000).optional(),
  technicalDesignSourceBlocks: z.array(RequirementSourceBlockSchema).max(10_000).optional(),
  priority: PrioritySchema.default('medium'),
  owner: OwnerSchema.default(''),
  taskLanguage: TaskLanguageSchema.default('zh-CN'),
}).strict()

const ProjectCreateEditableInputSchema = ProjectEditableInputSchema.omit({ cwd: true }).extend({
  cwd: z.string().trim().min(1).max(4_096).optional(),
  source: ProjectSourceSchema.optional(),
})

export const ProjectInputSchema = ProjectEditableInputSchema.superRefine((value, context) => {
  if (value.prd === '') context.addIssue({ code: z.ZodIssueCode.custom, path: ['prd'], message: 'A delivery brief is required for AI planning.' })
}).transform((value) => ({
  ...value,
  name: value.name || 'Untitled project',
  technicalDesign: value.technicalDesign || DEFAULT_TECHNICAL_DESIGN,
}))

export const ProjectUpdateInputSchema = ProjectEditableInputSchema.transform((value) => ({
  ...value,
  name: value.name || 'Untitled project',
}))

export const ProjectCreateRequestSchema = z.union([
  ProjectCreateEditableInputSchema.extend({ mode: z.literal('empty') }).superRefine((value, context) => {
    if (value.name === '') context.addIssue({ code: z.ZodIssueCode.custom, path: ['name'], message: 'A project name is required for an empty project.' })
    if (value.cwd === undefined && value.source === undefined) context.addIssue({ code: z.ZodIssueCode.custom, path: ['source'], message: 'A local directory or GitHub repository source is required.' })
  }),
  ProjectCreateEditableInputSchema.extend({ mode: z.literal('ai').default('ai') }).superRefine((value, context) => {
    if (value.prd === '' && !(value.source?.kind === 'github_repo' && value.source.issueNumbers.length > 0)) context.addIssue({ code: z.ZodIssueCode.custom, path: ['prd'], message: 'A delivery brief or selected GitHub Issue is required for AI planning.' })
    if (value.cwd === undefined && value.source === undefined) context.addIssue({ code: z.ZodIssueCode.custom, path: ['source'], message: 'A local directory or GitHub repository source is required.' })
  }).transform((value) => ({
    ...value,
    name: value.name || 'Untitled project',
    technicalDesign: value.technicalDesign || DEFAULT_TECHNICAL_DESIGN,
  })),
])

export const ProjectReplanRequestSchema = z.object({
  taskLanguage: TaskLanguageSchema.default('zh-CN'),
  project: ProjectUpdateInputSchema.optional(),
}).strict()

export const ProjectWorkspaceLinkRequestSchema = z.object({
  workspaceId: z.string().trim().min(1).max(240),
}).strict()

export const ProjectDecompositionRequestSchema = z.object({
  title: z.string().trim().min(1).max(160),
  prd: z.string().trim().min(1).max(500_000),
  technicalDesign: z.string().trim().max(500_000).default(''),
  taskLanguage: TaskLanguageSchema.default('zh-CN'),
  sourceRefs: z.array(z.string().trim().min(1).max(4_096)).max(100).default([]),
  sourceBlocks: z.array(RequirementSourceBlockSchema).max(10_000).default([]),
  idempotencyKey: z.string().trim().min(1).max(200).optional(),
}).strict()

export const ProjectDecompositionRevisionRequestSchema = ProjectDecompositionRequestSchema.extend({
  expectedBundleUpdatedAt: z.string().min(1),
}).strict()

export const ProjectApprovalRequestSchema = z.object({
  revision: z.number().int().positive(),
  planHash: z.string().regex(/^[a-f0-9]{64}$/),
  actor: z.string().trim().min(1).max(200).default('Harness user'),
}).strict()

export const AgentBuilderMessageSchema = z.object({
  role: z.enum(['user', 'assistant']),
  content: z.string().trim().min(1).max(20_000),
}).strict()

const AgentDraftContextSchema = AgentInputSchema.partial().strict()

export const AgentDraftRequestSchema = z.object({
  requirement: z.string().trim().min(1).max(20_000),
  messages: z.array(AgentBuilderMessageSchema).max(40).default([]),
  existingDraft: AgentDraftContextSchema.optional(),
}).strict().refine((input) => input.requirement.length + input.messages.reduce((total, message) => total + message.content.length, 0) + JSON.stringify(input.existingDraft ?? {}).length <= 120_000, 'Agent Builder context exceeds 120,000 characters.')

const AgentBuilderAssumptionsSchema = z.array(z.string().trim().min(1).max(2_000)).max(10)
const AgentBuilderQuestionsSchema = z.array(z.string().trim().min(1).max(2_000)).max(2)

export const AgentBuilderResponseSchema = AgentInputSchema.extend({
  reuseRecommendation: z.object({ agentId: z.string().min(1), reason: z.string().trim().min(1).max(2_000) }).strict().optional(),
  warnings: z.array(z.string().trim().min(1).max(2_000)).max(20).default([]),
  feedback: z.string().trim().min(1).max(10_000),
  assumptions: AgentBuilderAssumptionsSchema.default([]),
  openQuestions: AgentBuilderQuestionsSchema.default([]),
}).strict()

export const RuntimeInputSchema = z.object({
  name: z.string().trim().min(1).max(160),
  machineId: z.string().trim().min(1).max(240),
  capabilities: z.array(z.string().trim().min(1).max(160)).max(100).default([]),
  agentCli: z.string().trim().min(1).max(160).optional(),
  workspaceRoot: z.string().trim().min(1).max(4_096).optional(),
}).strict()

export const RuntimeUpdateInputSchema = z.object({
  name: z.string().trim().min(1).max(160).optional(),
  machineId: z.string().trim().min(1).max(240).optional(),
  capabilities: z.array(z.string().trim().min(1).max(160)).max(100).optional(),
  agentCli: z.string().trim().min(1).max(160).nullable().optional(),
  workspaceRoot: z.string().trim().min(1).max(4_096).nullable().optional(),
  expectedUpdatedAt: z.string().min(1),
}).strict()

export const RuntimeArchiveInputSchema = z.object({
  expectedUpdatedAt: z.string().min(1),
}).strict()

export const AgentRuntimeBindingInputSchema = z.object({
  runtimeId: z.string().min(1).nullable(),
  expectedTargetUpdatedAt: z.string().min(1),
  expectedProjectRevisions: z.record(z.string(), z.number().int().positive()).default({}),
  acknowledgeApprovalInvalidation: z.boolean().default(false),
}).strict()

export const ResourceRuntimeBindingInputSchema = z.object({
  runtimeId: z.string().min(1).nullable(),
  expectedTargetUpdatedAt: z.string().min(1),
}).strict()

export const ProjectResourceInputSchema = z.object({
  kind: ResourceKindSchema,
  location: z.string().trim().min(1).max(4_096),
  ref: z.string().trim().max(500).optional(),
  executionMode: ResourceExecutionModeSchema.default('in_place'),
  runtimeId: z.string().min(1).optional(),
}).strict()

export const IssueUpdateSchema = z.object({
  title: z.string().trim().min(1).max(240).optional(),
  description: z.string().trim().max(100_000).optional(),
  status: IssueStatusSchema.optional(),
  priority: PrioritySchema.optional(),
  labels: z.array(z.string().trim().min(1).max(64)).max(50).optional(),
}).strict()

export const CommentInputSchema = z.object({
  body: z.string().trim().min(1).max(20_000),
  authorType: ActivityActorTypeSchema.default('human'),
  authorId: z.string().trim().max(240).optional(),
}).strict()

export const IssueInputSchema = z.object({
  projectId: z.string().min(1).optional(),
  parentIssueId: z.string().min(1).optional(),
  title: z.string().trim().min(1).max(240),
  description: z.string().trim().max(100_000).default(''),
  status: IssueStatusSchema.default('todo'),
  priority: PrioritySchema.default('medium'),
  assigneeType: IssueAssigneeTypeSchema.optional(),
  assigneeId: z.string().min(1).optional(),
  labels: z.array(z.string().trim().min(1).max(64)).max(50).default([]),
}).strict()

export const SquadInputSchema = z.object({
  name: z.string().trim().min(1).max(160),
  description: z.string().trim().max(1_000).default(''),
  leaderAgentId: z.string().min(1),
  memberAgentIds: z.array(z.string().min(1)).min(2).max(100),
  memberRoles: z.record(z.string(), z.string().trim().min(1).max(200)).default({}),
  instructions: z.string().trim().min(1).max(20_000),
  escalationPolicy: z.string().trim().min(1).max(10_000),
  escalationConfig: SquadEscalationPolicySchema.optional(),
  collaborationPolicyVersion: z.string().trim().min(1).max(100).optional(),
  maxParallelDelegations: z.number().int().positive().max(32).default(1),
}).strict()

export const SquadCreateInputSchema = SquadInputSchema.extend({
  sourceProjectId: z.string().min(1).optional(),
}).strict()

export const SquadUpdateInputSchema = SquadInputSchema.extend({
  expectedUpdatedAt: z.string().min(1),
}).strict()

export const SquadCloneInputSchema = z.object({
  name: z.string().trim().min(1).max(160).optional(),
  sourceProjectId: z.string().min(1).optional(),
  expectedSourceUpdatedAt: z.string().min(1).optional(),
}).strict()

export const SquadArchiveInputSchema = z.object({
  expectedUpdatedAt: z.string().min(1),
}).strict()

export const CommandInputSchema = z.object({
  idempotencyKey: z.string().trim().min(1).max(240).optional(),
  requestDigest: z.string().length(64).optional(),
  type: CommandTypeSchema,
  projectId: z.string().min(1).optional(),
  issueId: z.string().min(1).optional(),
  squadId: z.string().min(1).optional(),
  actorType: ActivityActorTypeSchema.default('human'),
  actorId: z.string().trim().max(240).optional(),
  payload: z.record(z.string(), z.unknown()).default({}),
}).strict()

export const ExternalTriggerInputSchema = z.object({
  source: z.string().trim().min(1).max(160),
  externalKey: z.string().trim().min(1).max(500),
  command: CommandInputSchema,
}).strict()

export const ArtifactInputSchema = z.object({
  projectId: z.string().min(1),
  issueId: z.string().min(1).optional(),
  taskRunId: z.string().min(1).optional(),
  kind: ArtifactKindSchema,
  name: z.string().trim().min(1).max(240),
  status: ArtifactStatusSchema.default('available'),
  uri: z.string().max(4_096).optional(),
  content: z.string().max(100_000).optional(),
  metadata: z.record(z.string(), z.unknown()).default({}),
}).strict()

export const TaskInputSchema = z.object({
  title: z.string().trim().min(1).max(240),
  kind: TaskKindSchema,
  description: z.string().trim().min(1).max(20_000),
  acceptanceCriteria: z.array(z.string().trim().min(1).max(2_000)).min(1).max(100),
  dependencies: z.array(z.string().min(1)).max(100).default([]),
  priority: PrioritySchema.default('medium'),
  tags: TagsSchema.default([]),
  agentId: z.string().min(1).nullable().optional(),
  assignmentPolicy: TaskAssignmentPolicySchema.optional(),
  testCommand: z.string().trim().min(1).max(10_000),
})

export const ProjectAgentMembershipInputSchema = z.object({
  agentId: z.string().min(1),
  projectRole: z.string().trim().max(200).default(''),
  deliveryRoles: z.array(DeliveryRoleSchema).max(7).default([]),
  autoAssignable: z.boolean().default(true),
  setAsLead: z.boolean().default(false),
  joinedBy: z.string().trim().min(1).max(240).default('Harness user'),
  expectedProjectRevision: z.number().int().positive().optional(),
}).strict()

export const ProjectAgentMembershipUpdateSchema = z.object({
  projectRole: z.string().trim().max(200).optional(),
  deliveryRoles: z.array(DeliveryRoleSchema).max(7).optional(),
  autoAssignable: z.boolean().optional(),
  setAsLead: z.boolean().optional(),
  expectedMemberUpdatedAt: z.string().min(1).optional(),
}).strict()

export const ProjectAgentMembershipBatchInputSchema = z.object({
  members: z.array(ProjectAgentMembershipInputSchema.omit({ setAsLead: true, joinedBy: true, expectedProjectRevision: true })).min(1).max(100),
  joinedBy: z.string().trim().min(1).max(240).default('Harness user'),
  expectedProjectRevision: z.number().int().positive().optional(),
}).strict()

export const ProjectAgentMembershipRemoveSchema = z.object({
  expectedMemberUpdatedAt: z.string().min(1).optional(),
  expectedProjectRevision: z.number().int().positive().optional(),
  assignedTaskPolicy: z.enum(['reject', 'reassign']).default('reject'),
  replacementAgentId: z.string().min(1).optional(),
  clearLead: z.boolean().default(false),
}).strict().superRefine((value, context) => {
  if (value.assignedTaskPolicy === 'reassign' && value.replacementAgentId === undefined) context.addIssue({ code: z.ZodIssueCode.custom, path: ['replacementAgentId'], message: 'Task reassignment requires a replacement Agent.' })
  if (value.assignedTaskPolicy === 'reassign' && value.expectedProjectRevision === undefined) context.addIssue({ code: z.ZodIssueCode.custom, path: ['expectedProjectRevision'], message: 'Task reassignment requires the expected Project revision.' })
})

export const ProjectTaskAssignmentsSchema = z.object({
  expectedRevision: z.number().int().positive(),
  assignments: z.array(z.object({ taskId: z.string().min(1), agentId: z.string().min(1) }).strict()).min(1).max(1_000),
}).strict()

export const ProjectTaskReassignSchema = z.object({
  expectedRevision: z.number().int().positive(),
  taskId: z.string().min(1),
  agentId: z.string().min(1),
  actor: z.string().trim().min(1).max(240).default('Harness user'),
}).strict()

export const ResolveTeamBlockerSchema = z.object({
  taskId: z.string().min(1),
  reason: z.string().trim().min(1).max(4_000),
  facts: z.array(z.string().trim().min(1).max(2_000)).max(20).default([]),
  missingCapabilities: z.array(z.string().trim().min(1).max(160)).max(50).default([]),
  missingPermissions: z.array(z.string().trim().min(1).max(160)).max(50).default([]),
  actor: z.string().trim().min(1).max(240).default('Harness user'),
}).strict()

export const ProjectSquadBindingInputSchema = z.object({
  squadId: z.string().min(1),
  isDefault: z.boolean().default(false),
  syncRoles: z.boolean().default(false),
  boundBy: z.string().trim().min(1).max(240).default('Harness user'),
  expectedProjectRevision: z.number().int().positive(),
  expectedSquadUpdatedAt: z.string().min(1),
}).strict()

export const ProjectSquadBindingSyncInputSchema = z.object({
  syncRoles: z.boolean().default(false),
  expectedBindingUpdatedAt: z.string().min(1),
  expectedSquadUpdatedAt: z.string().min(1).optional(),
}).strict()

export const ProjectSquadBindingDefaultInputSchema = z.object({
  expectedBindingUpdatedAt: z.string().min(1),
}).strict()

export const ProjectSquadBindingRemoveSchema = z.object({
  expectedBindingUpdatedAt: z.string().min(1),
  replacementDefaultSquadId: z.string().min(1).optional(),
}).strict()

export const FeatureUsageInputSchema = z.object({
  feature: FeatureUsageFeatureSchema,
  opens: z.number().int().nonnegative().max(10_000).default(0),
  meaningfulActions: z.number().int().nonnegative().max(10_000).default(0),
  errorRecoveries: z.number().int().nonnegative().max(10_000).default(0),
}).strict().refine((value) => value.opens + value.meaningfulActions + value.errorRecoveries > 0, 'At least one usage counter must increase.')

export const TaskBoardStageRequestSchema = z.object({
  boardStage: BoardStageSchema,
}).strict()

export const TaskUpdateSchema = z.object({
  title: z.string().trim().min(1).max(240).optional(),
  description: z.string().trim().min(1).max(20_000).optional(),
  acceptanceCriteria: z.array(z.string().trim().min(1).max(2_000)).min(1).max(100).optional(),
  dependencies: z.array(z.string().min(1)).max(100).optional(),
  priority: PrioritySchema.optional(),
  tags: TagsSchema.optional(),
  agentId: z.string().min(1).nullable().optional(),
  assignmentPolicy: TaskAssignmentPolicySchema.optional(),
  testCommand: z.string().trim().min(1).max(10_000).optional(),
})

export type ProjectAgentMembershipRecord = z.infer<typeof ProjectAgentMembershipRecordSchema>
export type ProjectSquadBindingRecord = z.infer<typeof ProjectSquadBindingRecordSchema>
export type ProjectAgentMembershipSourceRecord = z.infer<typeof ProjectAgentMembershipSourceRecordSchema>
export type ProjectSquadBindingInput = z.infer<typeof ProjectSquadBindingInputSchema>
export type ProjectSquadBindingSyncInput = z.infer<typeof ProjectSquadBindingSyncInputSchema>
export type ProjectSquadBindingDefaultInput = z.infer<typeof ProjectSquadBindingDefaultInputSchema>
export type ProjectSquadBindingRemove = z.infer<typeof ProjectSquadBindingRemoveSchema>
export type ProjectAgentMembershipInput = z.infer<typeof ProjectAgentMembershipInputSchema>
export type ProjectAgentMembershipUpdate = z.infer<typeof ProjectAgentMembershipUpdateSchema>
export type ProjectAgentMembershipBatchInput = z.infer<typeof ProjectAgentMembershipBatchInputSchema>
export type ProjectAgentMembershipRemove = z.infer<typeof ProjectAgentMembershipRemoveSchema>
export type ProjectTaskAssignments = z.infer<typeof ProjectTaskAssignmentsSchema>
export type ProjectTaskReassign = z.infer<typeof ProjectTaskReassignSchema>
export type ResolveTeamBlocker = z.infer<typeof ResolveTeamBlockerSchema>
export type FeatureUsageDailyRecord = z.infer<typeof FeatureUsageDailyRecordSchema>
export type FeatureUsageInput = z.infer<typeof FeatureUsageInputSchema>
export type EscalationTrigger = z.infer<typeof EscalationTriggerSchema>
export type SquadEscalationPolicy = z.infer<typeof SquadEscalationPolicySchema>
export type DelegationContract = z.infer<typeof DelegationContractSchema>
export type SquadRecord = z.infer<typeof SquadRecordSchema>
export type SquadInput = z.infer<typeof SquadInputSchema>
export type SquadCreateInput = z.infer<typeof SquadCreateInputSchema>
export type SquadUpdateInput = z.infer<typeof SquadUpdateInputSchema>
export type SquadCloneInput = z.infer<typeof SquadCloneInputSchema>
export type SquadArchiveInput = z.infer<typeof SquadArchiveInputSchema>
export type RuntimeInput = z.infer<typeof RuntimeInputSchema>
export type RuntimeUpdateInput = z.infer<typeof RuntimeUpdateInputSchema>
export type RuntimeArchiveInput = z.infer<typeof RuntimeArchiveInputSchema>
export type AgentRuntimeBindingInput = z.infer<typeof AgentRuntimeBindingInputSchema>
export type ResourceRuntimeBindingInput = z.infer<typeof ResourceRuntimeBindingInputSchema>
export type DelegationRecord = z.infer<typeof DelegationRecordSchema>
export type TranscriptEntry = z.infer<typeof TranscriptEntrySchema>
export type ArtifactRecord = z.infer<typeof ArtifactRecordSchema>
export type ArtifactInput = z.infer<typeof ArtifactInputSchema>
export type CommandRecord = z.infer<typeof CommandRecordSchema>
export type CommandInput = z.infer<typeof CommandInputSchema>
export type ExternalTriggerRecord = z.infer<typeof ExternalTriggerRecordSchema>
export type ExternalTriggerInput = z.infer<typeof ExternalTriggerInputSchema>
export type LocalDirectoryLockRecord = z.infer<typeof LocalDirectoryLockRecordSchema>
export type WorkspaceLeaseRecord = z.infer<typeof WorkspaceLeaseRecordSchema>
export type WorkspaceWriterLeaseRecord = z.infer<typeof WorkspaceWriterLeaseRecordSchema>
export type SkillRecord = z.infer<typeof SkillRecordSchema>
export type RuntimeRecord = z.infer<typeof RuntimeRecordSchema>
export type ProjectResource = z.infer<typeof ProjectResourceSchema>
export type IssueRecord = z.infer<typeof IssueRecordSchema>
export type IssueUpdate = z.infer<typeof IssueUpdateSchema>
export type CommentRecord = z.infer<typeof CommentRecordSchema>
export type CommentInput = z.infer<typeof CommentInputSchema>
export type TaskRunRecord = z.infer<typeof TaskRunRecordSchema>
export type ActivityEvent = z.infer<typeof ActivityEventSchema>
export type DomainEventRecord = z.infer<typeof DomainEventRecordSchema>
export type DomainEventPage = z.infer<typeof DomainEventPageSchema>
export type DecisionRecord = z.infer<typeof DecisionRecordSchema>
export type DecisionInput = z.infer<typeof DecisionInputSchema>
export type DecisionResolution = z.infer<typeof DecisionResolutionSchema>
export type InboxQuery = z.infer<typeof InboxQuerySchema>
export type InboxAction = z.infer<typeof InboxActionSchema>
export type SquadAvailabilityReason = 'not_bound' | 'binding_needs_review' | 'legacy_member_count' | 'archived' | 'agent_inactive' | 'member_outside_project' | 'capacity_exhausted'
export type SquadAvailabilityWarning = 'leader_runtime_offline' | 'leader_runtime_unstable'
export interface SquadAvailability {
  squadId: string
  projectId: string
  eligible: boolean
  reasons: SquadAvailabilityReason[]
  dispatchReady: boolean
  warnings: SquadAvailabilityWarning[]
  missingAgentIds: string[]
  activeDelegations: number
  availableSlots: number
}
export interface RuntimeOverview {
  defaultHost: {
    id: 'default-host'
    name: '本机默认环境'
    status: 'online' | 'unstable'
    capabilities: string[]
    boundAgentCount: number
  }
  customCount: number
  abnormalCount: number
  archivedCount: number
}
export interface RuntimeDetail {
  runtime: RuntimeRecord
  agents: AgentRecord[]
  resources: ProjectResource[]
  queuedTaskRuns: TaskRunRecord[]
  activeTaskRuns: TaskRunRecord[]
  affectedProjectIds: string[]
  historyCount: number
}
export interface AgentRuntimeImpact {
  agentId: string
  currentRuntimeId?: string
  nextRuntimeId?: string
  executableTaskRunIds: string[]
  affectedProjects: Array<{
    projectId: string
    revision: number
    status: z.infer<typeof ProjectRecordSchema>['status']
    assignedTaskIds: string[]
    approvalWillInvalidate: boolean
  }>
}
export interface InboxItem {
  id: string
  kind: z.infer<typeof InboxKindSchema>
  title: string
  summary: string
  projectId?: string
  issueId?: string
  taskRunId?: string
  decisionId?: string
  runtimeId?: string
  resourceId?: string
  agentId?: string
  actions: Array<'approve' | 'reject' | 'defer' | 'retry'>
  createdAt: string
}
export interface RunStatistics {
  taskRunId: string
  projectId: string
  issueId?: string
  agentId?: string
  durationMs?: number
  inputTokens?: number
  outputTokens?: number
  costUsd?: number
  usageKnown: boolean
}

export interface TeamCollaborationMetrics {
  scope: 'all' | 'project'
  projectId?: string
  taskCount: number
  singleAgentTaskCount: number
  squadDelegationTaskCount: number
  singleAgentRatio: number
  squadDelegationRatio: number
  recommendedAssignmentCount: number
  manuallyChangedAssignmentCount: number
  recommendationManualChangeRate?: number
  capabilityGapCount: number
  capabilityGapRate?: number
  runtimeWaitCount: number
  capacityWaitCount: number
  runtimeWaitDurationMs: number
  capacityWaitDurationMs: number
  resourceConflictWaitDurationMs: number
  blockedTaskCount: number
  activeBlockedIssueCount: number
  delegationCount: number
  delegationCompletedCount: number
  delegationFailedCount: number
  delegationEscalatedCount: number
  delegationCompletionRate?: number
  delegationEscalationRate?: number
  leaderRestartCount: number
  leaderRestartRate?: number
  childEvidenceCompleteCount: number
  childEvidenceIncompleteCount: number
  childEvidenceCompletenessRate?: number
  implementationSelfReviewCount: number
  reviewRejectedCount: number
  collaborationReworkCount: number
  conflictCount: number
  activeAgentCount: number
  agentUtilization: Array<{ agentId: string; busyDurationMs: number; blockedDurationMs: number; observationWindowMs: number; utilizationRate?: number }>
  blockedCount: number
  generatedAt: string
}

export interface AgentWorkload {
  agentId: string
  availability: 'online' | 'offline' | 'unstable' | 'unknown'
  workload: 'idle' | 'queued' | 'working'
  lifecycle: 'active' | 'archived'
  queued: number
  working: number
  occupied: number
  maxConcurrency: number
  availableSlots: number
  utilizationPercent: number
  runtimeId?: string
}
export type AgentRecord = z.infer<typeof AgentRecordSchema>
export type ProjectRecord = z.infer<typeof ProjectRecordSchema>
export type TaskRecord = z.infer<typeof TaskRecordSchema>
export type AssignmentMode = z.infer<typeof AssignmentModeSchema>
export type TaskAssignmentPolicy = z.infer<typeof TaskAssignmentPolicySchema>
export type TaskRiskLevel = z.infer<typeof TaskRiskLevelSchema>
export type DeliveryRole = z.infer<typeof DeliveryRoleSchema>
export type TeamCompositionSnapshot = z.infer<typeof TeamCompositionSnapshotSchema>
export type TeamCompositionMember = z.infer<typeof TeamCompositionMemberSchema>
export type TeamCompositionSquad = z.infer<typeof TeamCompositionSquadSchema>
export type TaskAssignmentSnapshot = z.infer<typeof TaskAssignmentSnapshotSchema>
export type TeamCapacityObservation = z.infer<typeof TeamCapacityObservationSchema>
export type ReviewerIndependencePolicy = z.infer<typeof ReviewerIndependencePolicySchema>
export type PlanSnapshotRecord = z.infer<typeof PlanSnapshotRecordSchema>
export type RequirementBundleRecord = z.infer<typeof RequirementBundleRecordSchema>
export type RequirementSourceBlock = z.infer<typeof RequirementSourceBlockSchema>
export type RequirementItemRecord = z.infer<typeof RequirementItemRecordSchema>
export type RequirementDecisionRecord = z.infer<typeof RequirementDecisionRecordSchema>
export type DecisionEffectDimension = z.infer<typeof DecisionEffectDimensionSchema>
export type RequirementDecisionInput = z.infer<typeof RequirementDecisionInputSchema>
export type RequirementDecisionResolution = z.infer<typeof RequirementDecisionResolutionSchema>
export type AcceptanceCriterionRecord = z.infer<typeof AcceptanceCriterionRecordSchema>
export type VerificationEvidenceRecord = z.infer<typeof VerificationEvidenceRecordSchema>
export type ProjectReviewRecord = z.infer<typeof ProjectReviewRecordSchema>
export type ProjectReviewResolution = z.infer<typeof ProjectReviewResolutionSchema>
export type DeliveryRecord = z.infer<typeof DeliveryRecordSchema>
export type DeliveryResponsibilityChain = z.infer<typeof DeliveryResponsibilityChainSchema>
export type TaskRunConflictLockRecord = z.infer<typeof TaskRunConflictLockRecordSchema>
export type BoardStage = z.infer<typeof BoardStageSchema>
export type TaskBoardStageRequest = z.infer<typeof TaskBoardStageRequestSchema>
export type ApprovalRecord = z.infer<typeof ApprovalRecordSchema>
export type RunRecord = z.infer<typeof RunRecordSchema>
export type GeneratedPlan = z.infer<typeof GeneratedPlanSchema>
export type PlannerResult = z.infer<typeof PlannerResultSchema>
export type RequirementSourceManifest = z.infer<typeof RequirementSourceManifestSchema>
export type RequirementAnalysisResult = z.infer<typeof RequirementAnalysisResultSchema>
export type RequirementReviewResult = z.infer<typeof RequirementReviewResultSchema>
export type GeneratedPlanV2 = z.infer<typeof GeneratedPlanV2Schema>
export type PlanningV3Diagnostic = z.infer<typeof PlanningV3DiagnosticSchema>
export type AcceptanceScenarioCategory = z.infer<typeof AcceptanceScenarioCategorySchema>
export type PlanningReviewFinding = z.infer<typeof PlanningReviewFindingSchema>
export type PlanningOperationStage = z.infer<typeof PlanningOperationStageSchema>
export type PlanningMetricDefinition = z.infer<typeof PlanningMetricDefinitionSchema>
export type PlanningMetricPolicyRecord = z.infer<typeof PlanningMetricPolicyRecordSchema>
export type PlanningMetricPolicyPublishRecord = z.infer<typeof PlanningMetricPolicyPublishRecordSchema>
export type PlanningShadowEvaluationRecord = z.infer<typeof PlanningShadowEvaluationRecordSchema>
export type PlanningModelExecutionProvenance = z.infer<typeof PlanningModelExecutionProvenanceSchema>
export type PlanningOperationRecord = z.infer<typeof PlanningOperationRecordSchema>
export type PlanningEvaluationCandidate = z.infer<typeof PlanningEvaluationCandidateSchema>
export type PlanningReleaseCanary = z.infer<typeof PlanningReleaseCanarySchema>
export type RequirementDecisionOptionEffectRecord = z.infer<typeof RequirementDecisionOptionEffectRecordSchema>
export type RequirementDecisionPlanningEffectRecord = z.infer<typeof RequirementDecisionPlanningEffectRecordSchema>
export type PlanningStageAttemptRecord = z.infer<typeof PlanningStageAttemptRecordSchema>
export type PlanningCheckpointRecord = z.infer<typeof PlanningCheckpointRecordSchema>
export type StorageMutationIntentRecord = z.infer<typeof StorageMutationIntentRecordSchema>
export type PlanningSourceInputRecord = z.infer<typeof PlanningSourceInputRecordSchema>
export type RequirementSourceProfileRecord = z.infer<typeof RequirementSourceProfileRecordSchema>
export type RequirementSourceManifestRecord = z.infer<typeof RequirementSourceManifestRecordSchema>
export type RequirementAnalysisProposalRecord = z.infer<typeof RequirementAnalysisProposalRecordSchema>
export type PlanningRepairAttemptRecord = z.infer<typeof PlanningRepairAttemptRecordSchema>
export type SourceDispositionBindingRecord = z.infer<typeof SourceDispositionBindingRecordSchema>
export type RepositoryContextSnapshotV3Record = z.infer<typeof RepositoryContextSnapshotV3RecordSchema>
export type RepositoryStackProfileRecord = z.infer<typeof RepositoryStackProfileRecordSchema>
export type RepositoryEvidenceRetrievalReport = z.infer<typeof RepositoryEvidenceRetrievalReportSchema>
export type CanonicalTargetBindingRecord = z.infer<typeof CanonicalTargetBindingRecordSchema>
export type RepositoryPolicyBaselineRecord = z.infer<typeof RepositoryPolicyBaselineRecordSchema>
export type PolicyOperationKind = z.infer<typeof PolicyOperationKindSchema>
export type PolicyArtifactKind = z.infer<typeof PolicyArtifactKindSchema>
export type PolicyLifecycleStage = z.infer<typeof PolicyLifecycleStageSchema>
export type PolicyTargetSelector = z.infer<typeof PolicyTargetSelectorSchema>
export type PolicyApplicabilityDecision = z.infer<typeof PolicyApplicabilityDecisionSchema>
export type PolicyConstraintRecordV3 = z.infer<typeof PolicyConstraintRecordV3Schema>
export type PlanningPolicySnapshotRecord = z.infer<typeof PlanningPolicySnapshotRecordSchema>
export type PlanningPromptReferenceManifestRecord = z.infer<typeof PlanningPromptReferenceManifestRecordSchema>
export type GeneratedBindingAnalysisV3 = z.infer<typeof GeneratedBindingAnalysisV3Schema>
export type RequirementCodeBindingRecord = z.infer<typeof RequirementCodeBindingRecordSchema>
export type AcceptanceScenarioRecord = z.infer<typeof AcceptanceScenarioRecordSchema>
export type AcceptanceScenarioCoveragePolicyRecord = z.infer<typeof AcceptanceScenarioCoveragePolicyRecordSchema>
export type PlanningRiskProfileRecord = z.infer<typeof PlanningRiskProfileRecordSchema>
export type SourcePolicyPrecheckRecord = z.infer<typeof SourcePolicyPrecheckRecordSchema>
export type ScenarioCoverageReviewRecord = z.infer<typeof ScenarioCoverageReviewRecordSchema>
export type PlanningReviewRecordV3 = z.infer<typeof PlanningReviewRecordV3Schema>
export type GeneratedScenarioCompletionV3 = z.infer<typeof GeneratedScenarioCompletionV3Schema>
export type GeneratedScenarioCoverageReviewV3 = z.infer<typeof GeneratedScenarioCoverageReviewV3Schema>
export type GeneratedPlanningReviewV3 = z.infer<typeof GeneratedPlanningReviewV3Schema>
export type GeneratedPlanV3 = z.infer<typeof GeneratedPlanV3Schema>
export type PlanningProposalPackRecord = z.infer<typeof PlanningProposalPackRecordSchema>
export type PlanningReferenceMapRecord = z.infer<typeof PlanningReferenceMapRecordSchema>
export type PolicyFulfillmentRecord = z.infer<typeof PolicyFulfillmentRecordSchema>
export type CapabilityDefinitionRecord = z.infer<typeof CapabilityDefinitionRecordSchema>
export type AgentCapabilityClaimRecord = z.infer<typeof AgentCapabilityClaimRecordSchema>
export type ProjectCapabilityCatalogSnapshotRecord = z.infer<typeof ProjectCapabilityCatalogSnapshotRecordSchema>
export type ResourceAccessGrantRecord = z.infer<typeof ResourceAccessGrantRecordSchema>
export type ProjectAccessGrantSnapshotRecord = z.infer<typeof ProjectAccessGrantSnapshotRecordSchema>
export type CapabilityRequirementDraftRecord = z.infer<typeof CapabilityRequirementDraftRecordSchema>
export type AssignmentDraftRecord = z.infer<typeof AssignmentDraftRecordSchema>
export type ExpectedAssignmentFixtureRecord = z.infer<typeof ExpectedAssignmentFixtureRecordSchema>
export type AssignmentEvaluationRecord = z.infer<typeof AssignmentEvaluationRecordSchema>
export type PlanningMetricReleaseReportCreateRecord = z.infer<typeof PlanningMetricReleaseReportCreateRecordSchema>
export type PlanningMetricReleaseReportRecord = z.infer<typeof PlanningMetricReleaseReportRecordSchema>
export type TaskPreflightRecordV3 = z.infer<typeof TaskPreflightRecordV3Schema>
export type PlanApprovalV3Record = z.infer<typeof PlanApprovalV3RecordSchema>
export type ExecutionDispatchRecord = z.infer<typeof ExecutionDispatchRecordSchema>
export type DeliveryIntegrationSnapshotRecord = z.infer<typeof DeliveryIntegrationSnapshotRecordSchema>
export type IntegrationInclusionEvidenceRecord = z.infer<typeof IntegrationInclusionEvidenceRecordSchema>
export type DeliveryConvergenceFindingRecord = z.infer<typeof DeliveryConvergenceFindingRecordSchema>
export type DeliveryConvergenceReviewRecord = z.infer<typeof DeliveryConvergenceReviewRecordSchema>
export type ConvergenceRepairBaselineRecord = z.infer<typeof ConvergenceRepairBaselineRecordSchema>
export type ConvergenceRepairCarryItemRecord = z.infer<typeof ConvergenceRepairCarryItemRecordSchema>
export type ConvergenceCarryValidationRecord = z.infer<typeof ConvergenceCarryValidationRecordSchema>
export type RepositoryEvidence = z.infer<typeof RepositoryEvidenceSchema>
export type AgentInput = z.infer<typeof AgentInputSchema>
export type AgentBuilderMessage = z.infer<typeof AgentBuilderMessageSchema>
export type AgentDraftRequest = z.infer<typeof AgentDraftRequestSchema>
export type AgentBuilderResponse = z.infer<typeof AgentBuilderResponseSchema>
export type ProjectInput = z.infer<typeof ProjectInputSchema>
export type ProjectUpdateInput = z.infer<typeof ProjectUpdateInputSchema>
export type ProjectCreateRequest = z.infer<typeof ProjectCreateRequestSchema>
export type ProjectSource = z.infer<typeof ProjectSourceSchema>
export type RepositoryInspection = z.infer<typeof RepositoryInspectionSchema>
export type RepositoryIssue = z.infer<typeof RepositoryIssueSchema>
export type RequirementDocumentImport = z.infer<typeof RequirementDocumentImportSchema>
export type RequirementDocumentImportResult = z.infer<typeof RequirementDocumentImportResultSchema>
export type TaskLanguage = z.infer<typeof TaskLanguageSchema>
export type ProjectReplanRequest = z.infer<typeof ProjectReplanRequestSchema>
export type ProjectWorkspaceLinkRequest = z.infer<typeof ProjectWorkspaceLinkRequestSchema>
export type ProjectDecompositionRequest = z.infer<typeof ProjectDecompositionRequestSchema>
export type DecompositionBatch = z.infer<typeof DecompositionBatchSchema>
export type ProjectApprovalRequest = z.infer<typeof ProjectApprovalRequestSchema>
export type TaskInput = z.infer<typeof TaskInputSchema>
export type TaskUpdate = z.infer<typeof TaskUpdateSchema>
export type ProjectDeliveryStage = z.infer<typeof ProjectDeliveryStageSchema>

export interface Snapshot {
  agents: AgentRecord[]
  projects: ProjectRecord[]
  tasks: TaskRecord[]
  approvals: ApprovalRecord[]
  runs: RunRecord[]
  planHashes: Record<string, string>
  runtimes: RuntimeRecord[]
  resources: ProjectResource[]
  issues: IssueRecord[]
  taskRuns: TaskRunRecord[]
  activity: ActivityEvent[]
  domainEvents?: DomainEventRecord[]
  eventCursor?: string
  comments: CommentRecord[]
  decisions: DecisionRecord[]
  squads: SquadRecord[]
  delegations: DelegationRecord[]
  transcripts: TranscriptEntry[]
  artifacts: ArtifactRecord[]
  commands: CommandRecord[]
  externalTriggers: ExternalTriggerRecord[]
  skills: SkillRecord[]
  workspaceLeases: WorkspaceLeaseRecord[]
  localDirectoryLocks: LocalDirectoryLockRecord[]
  projectAgentMemberships: ProjectAgentMembershipRecord[]
  projectSquadBindings: ProjectSquadBindingRecord[]
  projectAgentMembershipSources: ProjectAgentMembershipSourceRecord[]
  featureUsageDaily: FeatureUsageDailyRecord[]
  planSnapshots?: PlanSnapshotRecord[]
  requirementBundles?: RequirementBundleRecord[]
  requirementItems?: RequirementItemRecord[]
  requirementDecisions?: RequirementDecisionRecord[]
  acceptanceCriteria?: AcceptanceCriterionRecord[]
  verificationEvidence?: VerificationEvidenceRecord[]
  projectReviews?: ProjectReviewRecord[]
  deliveryRecords?: DeliveryRecord[]
  planningOperations?: PlanningOperationRecord[]
  planningMetricPolicies?: PlanningMetricPolicyRecord[]
  planningMetricPolicyPublishes?: PlanningMetricPolicyPublishRecord[]
  planningShadowEvaluations?: PlanningShadowEvaluationRecord[]
  planningStageAttempts?: PlanningStageAttemptRecord[]
  planningCheckpoints?: PlanningCheckpointRecord[]
  storageMutationIntents?: StorageMutationIntentRecord[]
  planningSourceInputs?: PlanningSourceInputRecord[]
  requirementSourceProfiles?: RequirementSourceProfileRecord[]
  requirementSourceManifests?: RequirementSourceManifestRecord[]
  requirementAnalysisProposals?: RequirementAnalysisProposalRecord[]
  planningRepairAttempts?: PlanningRepairAttemptRecord[]
  sourceDispositionBindings?: SourceDispositionBindingRecord[]
  acceptanceScenarios?: AcceptanceScenarioRecord[]
  acceptanceScenarioCoveragePolicies?: AcceptanceScenarioCoveragePolicyRecord[]
  planningRiskProfiles?: PlanningRiskProfileRecord[]
  sourcePolicyPrechecks?: SourcePolicyPrecheckRecord[]
  requirementDecisionOptionEffects?: RequirementDecisionOptionEffectRecord[]
  requirementDecisionPlanningEffects?: RequirementDecisionPlanningEffectRecord[]
  scenarioCoverageReviews?: ScenarioCoverageReviewRecord[]
  planningReviewsV3?: PlanningReviewRecordV3[]
  requirementCodeBindings?: RequirementCodeBindingRecord[]
  repositorySnapshotsV3?: RepositoryContextSnapshotV3Record[]
  repositoryStackProfiles?: RepositoryStackProfileRecord[]
  repositoryEvidenceRetrievalReports?: RepositoryEvidenceRetrievalReport[]
  canonicalTargetBindings?: CanonicalTargetBindingRecord[]
  repositoryPolicyBaselines?: RepositoryPolicyBaselineRecord[]
  policyConstraintsV3?: PolicyConstraintRecordV3[]
  planningPolicySnapshots?: PlanningPolicySnapshotRecord[]
  planningPromptReferenceManifests?: PlanningPromptReferenceManifestRecord[]
  planningProposalPacks?: PlanningProposalPackRecord[]
  planningReferenceMaps?: PlanningReferenceMapRecord[]
  policyFulfillments?: PolicyFulfillmentRecord[]
  capabilityDefinitions?: CapabilityDefinitionRecord[]
  agentCapabilityClaims?: AgentCapabilityClaimRecord[]
  projectCapabilityCatalogSnapshots?: ProjectCapabilityCatalogSnapshotRecord[]
  resourceAccessGrants?: ResourceAccessGrantRecord[]
  projectAccessGrantSnapshots?: ProjectAccessGrantSnapshotRecord[]
  capabilityRequirementDrafts?: CapabilityRequirementDraftRecord[]
  assignmentDrafts?: AssignmentDraftRecord[]
  assignmentEvaluations?: AssignmentEvaluationRecord[]
  expectedAssignmentFixtures?: ExpectedAssignmentFixtureRecord[]
  planningMetricReleaseReportCreates?: PlanningMetricReleaseReportCreateRecord[]
  planningMetricReleaseReports?: PlanningMetricReleaseReportRecord[]
  taskPreflightsV3?: TaskPreflightRecordV3[]
  planApprovalsV3?: PlanApprovalV3Record[]
  executionDispatches?: ExecutionDispatchRecord[]
  deliveryIntegrationSnapshots?: DeliveryIntegrationSnapshotRecord[]
  integrationInclusionEvidence?: IntegrationInclusionEvidenceRecord[]
  deliveryConvergenceFindings?: DeliveryConvergenceFindingRecord[]
  deliveryConvergenceReviews?: DeliveryConvergenceReviewRecord[]
  convergenceRepairBaselines?: ConvergenceRepairBaselineRecord[]
  convergenceRepairCarryItems?: ConvergenceRepairCarryItemRecord[]
  convergenceCarryValidations?: ConvergenceCarryValidationRecord[]
  runtimeOverview: RuntimeOverview
  inbox: InboxItem[]
  agentWorkloads: AgentWorkload[]
  runStatistics: RunStatistics[]
}
