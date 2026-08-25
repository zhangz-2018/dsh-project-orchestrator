import { z } from 'zod'

export const AgentToolPolicySchema = z.enum(['full', 'read_only'])
export const AgentStatusSchema = z.enum(['active', 'archived'])
export const AssignmentModeSchema = z.enum(['single_agent', 'squad_delegation', 'review_only'])
export const TaskRiskLevelSchema = z.enum(['low', 'medium', 'high', 'critical'])
export const ProjectDeliveryStageSchema = z.enum(['planning', 'awaiting_approval', 'approved', 'executing', 'review', 'delivery_ready', 'delivered', 'closed'])
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
  taskIds: z.array(z.string().min(1)).min(1).max(1_000),
  planHash: z.string().length(64),
  teamComposition: TeamCompositionSnapshotSchema,
  teamDigest: z.string().length(64),
  assignmentDigest: z.string().length(64),
  requirementDigest: z.string().length(64).optional(),
  decisionDigest: z.string().length(64).optional(),
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
  statement: z.string().trim().min(1).max(20_000),
  sourceRefs: z.array(z.string().trim().min(1).max(4_096)).max(100),
  status: RequirementItemStatusSchema,
  createdAt: z.string().min(1),
  updatedAt: z.string().min(1),
}).strict()
export const RequirementDecisionImpactSchema = z.enum(['low', 'medium', 'high', 'critical'])
export const RequirementDecisionStatusSchema = z.enum(['pending', 'resolved', 'deferred', 'rejected'])
const RequirementDecisionOptionSchema = z.object({
  id: z.string().trim().min(1).max(100),
  label: z.string().trim().min(1).max(2_000),
  impact: z.string().trim().max(2_000).optional(),
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
  owner: z.string().trim().max(240).optional(),
  dueAt: z.string().min(1).optional(),
  status: RequirementDecisionStatusSchema,
  chosenOption: z.string().trim().min(1).max(100).optional(),
  resolution: z.string().trim().max(20_000).optional(),
  decidedBy: z.string().trim().max(240).optional(),
  decidedAt: z.string().min(1).optional(),
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
  taskIds: z.array(z.string().min(1)).max(100),
  evidenceIds: z.array(z.string().min(1)).max(100),
  status: AcceptanceCriterionStatusSchema,
  createdAt: z.string().min(1),
  updatedAt: z.string().min(1),
}).strict()
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
  runId: z.string().min(1).optional(),
  agentId: z.string().min(1).optional(),
  runtimeId: z.string().min(1).optional(),
  runtimeNameSnapshot: z.string().min(1).max(160).optional(),
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
  diffSummary: z.string().max(70_000).optional(),
  changedFiles: z.array(z.string().max(4_096)).max(2_000).optional(),
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
}).strict()

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
  decompositionSessionId: z.string().optional(),
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
  dependencies: z.array(z.string().min(1)).max(100),
  priority: PrioritySchema.optional(),
  tags: TagsSchema.optional(),
  agentId: z.string().optional(),
  testCommand: z.string().min(1).max(10_000),
  sourceRequirementIds: z.array(z.string().min(1)).max(100).optional(),
  acceptanceIds: z.array(z.string().min(1)).max(100).optional(),
  assignmentPolicy: TaskAssignmentPolicySchema.optional(),
  assignmentSource: z.enum(['planner_recommendation', 'automatic_match', 'manual']).optional(),
  assignmentDigest: z.string().length(64).optional(),
  teamDigest: z.string().length(64).optional(),
  planSnapshotId: z.string().min(1).optional(),
  relationship: z.enum(['implementation', 'verification', 'review', 'handoff']).optional(),
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
  autoAssignable: z.boolean().default(true),
  setAsLead: z.boolean().default(false),
  joinedBy: z.string().trim().min(1).max(240).default('Harness user'),
  expectedProjectRevision: z.number().int().positive().optional(),
}).strict()

export const ProjectAgentMembershipUpdateSchema = z.object({
  projectRole: z.string().trim().max(200).optional(),
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
export type SkillRecord = z.infer<typeof SkillRecordSchema>
export type RuntimeRecord = z.infer<typeof RuntimeRecordSchema>
export type ProjectResource = z.infer<typeof ProjectResourceSchema>
export type IssueRecord = z.infer<typeof IssueRecordSchema>
export type IssueUpdate = z.infer<typeof IssueUpdateSchema>
export type CommentRecord = z.infer<typeof CommentRecordSchema>
export type CommentInput = z.infer<typeof CommentInputSchema>
export type TaskRunRecord = z.infer<typeof TaskRunRecordSchema>
export type ActivityEvent = z.infer<typeof ActivityEventSchema>
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
export type TeamCompositionSnapshot = z.infer<typeof TeamCompositionSnapshotSchema>
export type TeamCompositionMember = z.infer<typeof TeamCompositionMemberSchema>
export type TeamCompositionSquad = z.infer<typeof TeamCompositionSquadSchema>
export type TaskAssignmentSnapshot = z.infer<typeof TaskAssignmentSnapshotSchema>
export type TeamCapacityObservation = z.infer<typeof TeamCapacityObservationSchema>
export type ReviewerIndependencePolicy = z.infer<typeof ReviewerIndependencePolicySchema>
export type PlanSnapshotRecord = z.infer<typeof PlanSnapshotRecordSchema>
export type RequirementBundleRecord = z.infer<typeof RequirementBundleRecordSchema>
export type RequirementItemRecord = z.infer<typeof RequirementItemRecordSchema>
export type RequirementDecisionRecord = z.infer<typeof RequirementDecisionRecordSchema>
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
  runtimeOverview: RuntimeOverview
  inbox: InboxItem[]
  agentWorkloads: AgentWorkload[]
  runStatistics: RunStatistics[]
}
