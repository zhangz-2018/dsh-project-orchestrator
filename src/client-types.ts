export type AgentToolPolicy = 'full' | 'read_only'
export type Priority = 'low' | 'medium' | 'high' | 'urgent'
export type ProjectStatus = 'draft' | 'decomposing' | 'awaiting_approval' | 'approved' | 'running' | 'completed' | 'failed' | 'cancelled'
export type TaskLanguage = 'zh-CN' | 'en'
export type TaskStatus = 'draft' | 'queued' | 'running' | 'verifying' | 'completed' | 'failed' | 'blocked' | 'cancelled'
export type BoardStage = 'planned' | 'todo' | 'in_progress' | 'review'
export type RuntimeStatus = 'online' | 'offline' | 'unstable'
export type RuntimeLifecycle = 'active' | 'archived'
export type ResourceKind = 'github_repo' | 'local_directory'
export type ResourceExecutionMode = 'in_place' | 'worktree'
export type IssueStatus = 'backlog' | 'todo' | 'in_progress' | 'in_review' | 'done' | 'blocked' | 'cancelled'
export type IssueAssigneeType = 'member' | 'agent' | 'squad'
export type TaskRunStatus = 'deferred' | 'queued' | 'dispatched' | 'waiting_local_directory' | 'running' | 'completed' | 'failed' | 'cancelled'
export type InboxKind = 'needs_decision' | 'blocked' | 'review_ready' | 'runtime_offline' | 'permission_denied' | 'test_failed_after_retry' | 'stale_approval'
export type AgentWorkloadState = 'idle' | 'queued' | 'working'
export type ProjectAgentMembershipStatus = 'active' | 'removed'
export type ProjectSquadBindingStatus = 'active' | 'needs_review' | 'removed'
export type ProjectAgentMembershipSourceType = 'manual' | 'squad' | 'retained_reference'
export type FeatureUsageFeature = 'inbox' | 'issues' | 'projects' | 'delivery' | 'agents' | 'skills' | 'squads' | 'runtimes' | 'local_data'
export type AssignmentMode = 'single_agent' | 'squad_delegation' | 'review_only'
export type TaskRiskLevel = 'low' | 'medium' | 'high' | 'critical'
export type DeliveryRole = 'planner' | 'lead' | 'implementer' | 'verifier' | 'reviewer' | 'specialist' | 'release'
export interface TaskAssignmentPolicy { mode: AssignmentMode; riskLevel: TaskRiskLevel; requiredRoles: string[]; requiredCapabilities: string[]; allowedAgentIds: string[]; allowedSquadIds: string[]; requiresIndependentReviewer: boolean; maxParallel: number; parallelGroup?: string; conflictKeys: string[]; allowedScope: string[]; forbiddenScope: string[]; escalationConditions: string[] }
export type EscalationTrigger = 'requirement_conflict' | 'contract_conflict' | 'destructive_change' | 'production_data_change' | 'permission_required' | 'credential_required' | 'verification_unavailable' | 'repeated_failure' | 'scope_expansion' | 'delegation_conflict' | 'source_of_truth_unknown'

export interface SquadEscalationPolicy {
  triggers: EscalationTrigger[]
  maxFocusedRepairAttempts: number
  onTrigger: 'request_decision'
  pauseParentIssue: boolean
  cancelSiblingDelegations: boolean
  customInstructions: string
}

export interface DelegationContract {
  objective: string
  scope: string[]
  forbiddenScope: string[]
  deliverables: string[]
  acceptanceCriteria: string[]
  verification: string[]
  escalationConditions: string[]
}

export interface PromptDiagnostic {
  code: string
  severity: 'info' | 'warning'
}

export interface ProjectAgentMembership {
  id: string
  projectId: string
  agentId: string
  projectRole: string
  deliveryRoles: DeliveryRole[]
  autoAssignable: boolean
  status: ProjectAgentMembershipStatus
  joinedBy: string
  joinedAt: string
  updatedAt: string
  removedAt?: string
}

export interface ProjectSquadBinding {
  id: string
  projectId: string
  squadId: string
  status: ProjectSquadBindingStatus
  isDefault: boolean
  syncedSquadUpdatedAt: string
  boundBy: string
  boundAt: string
  updatedAt: string
  removedAt?: string
}

export interface ProjectAgentMembershipSource {
  id: string
  projectId: string
  agentId: string
  sourceType: ProjectAgentMembershipSourceType
  sourceId: string
  projectRole: string
  autoAssignable: boolean
  status: ProjectAgentMembershipStatus
  createdAt: string
  updatedAt: string
  removedAt?: string
}

export interface FeatureUsageDaily {
  id: string
  date: string
  feature: FeatureUsageFeature
  opens: number
  meaningfulActions: number
  errorRecoveries: number
  lastUsedAt: string
}

export interface AgentDraft {
  name: string
  role: string
  description: string
  persona: string
  provider?: string
  model?: string
  preset: string
  toolPolicy: AgentToolPolicy
  skills: string[]
  runtimeId?: string
  access?: 'only_me' | 'workspace' | 'specific_people'
  maxConcurrency?: number
}

export interface AgentBuilderMessage {
  role: 'user' | 'assistant'
  content: string
}

export interface AgentBuilderResponse extends AgentDraft {
  reuseRecommendation?: { agentId: string; reason: string }
  warnings: string[]
  feedback: string
  assumptions: string[]
  openQuestions: string[]
}

export interface AgentRecord {
  id: string
  name: string
  role: string
  description: string
  persona: string
  provider?: string
  model?: string
  preset: string
  toolPolicy: AgentToolPolicy
  skills?: string[]
  capabilities?: string[]
  runtimeId?: string
  access?: 'only_me' | 'workspace' | 'specific_people'
  maxConcurrency?: number
  status: 'active' | 'archived'
  createdAt: string
  updatedAt: string
}

export interface TeamCompositionSnapshot {
  plannerAgentId?: string
  leadAgentId?: string
  reviewerAgentId?: string
  members: Array<{ agentId: string; projectRole: string; deliveryRoles: DeliveryRole[]; source: ProjectAgentMembershipSourceType; sourceId: string; capabilities: string[]; skillsDigest?: string; personaDigest?: string; runtimeId?: string; runtimeStatus?: RuntimeStatus; maxConcurrency: number; availableSlots?: number }>
  squads: Array<{ squadId: string; isDefault: boolean; leaderAgentId: string; memberAgentIds: string[]; collaborationPolicyVersion?: string; policyDigest?: string; maxParallelDelegations: number; syncedSquadUpdatedAt: string }>
  teamDigest: string
  capturedAt: string
}

export interface TaskAssignmentSnapshot { taskId: string; policy: TaskAssignmentPolicy; ownerAgentId?: string; ownerSquadId?: string }
export interface TeamCapacityObservation {
  agents: Array<{ agentId: string; availability: RuntimeStatus | 'unknown'; queued: number; working: number; occupied: number; maxConcurrency: number; availableSlots: number }>
  squads: Array<{ squadId: string; eligible: boolean; activeDelegations: number; maxParallelDelegations: number; availableSlots: number }>
}
export interface ProjectTeamPlan {
  project: ProjectRecord
  team: TeamCompositionSnapshot
  tasks: TaskRecord[]
  preflight: {
    ready: boolean
    errors: string[]
    warnings: string[]
    teamDigest: string
    assignmentDigest: string
    planHash: string
    capacityObservation: TeamCapacityObservation
    criticalPath: { taskIds: string[]; length: number }
    blockedTasks: Array<{ taskId: string; title: string; reasons: string[] }>
    waitProjection: Array<{ taskId: string; title: string; reason: string; queuedAhead: number; availableSlots: number }>
    coverageMatrix: Array<{ requirementId: string; requirementKey: string; statement: string; roleNames: string[]; taskIds: string[]; implementationTaskIds: string[]; verificationTaskIds: string[]; acceptanceIds: string[]; evidenceIds: string[]; planningStatus: 'unplanned' | 'partial' | 'planned'; verificationStatus: 'unverified' | 'partial' | 'verified' | 'failed' | 'waived'; status: 'covered' | 'partial' | 'uncovered' }>
  }
}
export interface AgentCandidateProjection { agentId: string; eligible: boolean; reasons: string[]; projectRole: string; capabilities: string[]; runtimeId?: string; runtimeStatus: RuntimeStatus | 'unknown'; queued: number; working: number; occupied: number; maxConcurrency: number; availableSlots: number; score: number }
export interface SquadCandidateProjection { squadId: string; eligible: boolean; reasons: string[]; dispatchReady: boolean; warnings: SquadAvailabilityWarning[]; activeDelegations: number; availableSlots: number }
export interface ProjectTaskCandidates { projectId: string; task: TaskRecord; candidates: AgentCandidateProjection[]; squadCandidates: SquadCandidateProjection[]; conflicts: string[] }
export interface ProjectTeamImpact {
  projectId: string
  revision: number
  tasks: Array<{ id: string; title: string; ownerAgentId?: string; status: TaskStatus; reasons: string[] }>
  acceptanceCriteria: Array<{ id: string; key: string; statement: string; status: 'open' | 'verified' | 'failed' | 'waived'; evidenceIds: string[] }>
  planSnapshotIds: string[]
  currentPlanSnapshot?: PlanSnapshotRecord
  currentApproval?: ApprovalRecord
  activeIssues: Array<{ id: string; title: string; status: IssueStatus; assigneeType?: IssueAssigneeType; assigneeId?: string }>
  delegations: Array<{ id: string; status: DelegationRecord['status']; parentIssueId: string; childIssueId: string; memberAgentId: string; reason: string }>
  reviewerAgentId?: string
  approvalWillInvalidate: boolean
  hasActiveExecution: boolean
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
export interface ReviewerIndependencePolicy { required: boolean; reviewerAgentId?: string; excludedAgentIds: string[]; basis: 'team_role' | 'explicit' | 'none' }

export interface PlanSnapshotRecord {
  id: string
  projectId: string
  revision: number
  mode: 'initial' | 'append' | 'revise'
  taskIds: string[]
  planHash: string
  teamComposition: TeamCompositionSnapshot
  teamDigest: string
  assignmentDigest: string
  requirementDigest?: string
  decisionDigest?: string
  requirementBundleIds?: string[]
  sourceManifestDigest?: string
  requirementAnalysisDigest?: string
  requirementReviewDigest?: string
  requirementPromptVersion?: string
  plannerPromptVersion?: string
  planningContractVersion?: 2
  taskAssignments?: TaskAssignmentSnapshot[]
  capacityObservation?: TeamCapacityObservation
  reviewerIndependencePolicy?: ReviewerIndependencePolicy
  diagnostics?: Array<{ code: string; severity: 'info' | 'warning' | 'error'; message: string }>
  generatedBy?: 'planner' | 'human'
  status: 'candidate' | 'approved' | 'superseded' | 'blocked'
  supersedesId?: string
  createdAt: string
  approvedAt?: string
}

export interface RequirementBundleRecord {
  id: string
  projectId: string
  title: string
  mode: 'initial' | 'append' | 'revise'
  prd: string
  technicalDesign: string
  sourceRefs: string[]
  sourceBlocks?: RequirementSourceBlock[]
  idempotencyKey?: string
  requestDigest?: string
  sourceDigest: string
  status: 'active' | 'superseded'
  supersedesId?: string
  createdAt: string
  updatedAt: string
}

export interface RequirementSourceBlock { documentKind: 'prd' | 'technical_design'; locator: string; page: number; block: number; text: string; textDigest: string }

export interface RequirementItemRecord {
  id: string
  projectId: string
  bundleId: string
  key: string
  kind: 'fact' | 'inference' | 'unknown'
  scope?: 'in_scope' | 'deferred' | 'out_of_scope'
  dispositionReason?: string
  statement: string
  sourceRefs: string[]
  status: 'active' | 'superseded'
  createdAt: string
  updatedAt: string
}

export interface RequirementDecisionRecord {
  id: string
  projectId: string
  bundleId?: string
  key: string
  question: string
  options: Array<{ id: string; label: string; impact?: string }>
  recommendedOption?: string
  impact: 'low' | 'medium' | 'high' | 'critical'
  affectedRequirementIds: string[]
  affectedTaskIds: string[]
  sourceRefs?: string[]
  owner?: string
  dueAt?: string
  status: 'pending' | 'resolved' | 'deferred' | 'rejected'
  chosenOption?: string
  resolution?: string
  decidedBy?: string
  decidedAt?: string
  createdAt: string
  updatedAt: string
}

export interface AcceptanceCriterionRecord {
  id: string
  projectId: string
  bundleId: string
  requirementItemId?: string
  key: string
  statement: string
  sourceRefs: string[]
  required?: boolean
  scenario?: 'good' | 'business_rejection' | 'boundary' | 'dependency_failure' | 'security' | 'compatibility' | 'recovery'
  taskIds: string[]
  evidenceIds: string[]
  status: 'open' | 'verified' | 'failed' | 'waived'
  createdAt: string
  updatedAt: string
}

export interface VerificationEvidenceRecord {
  id: string
  projectId: string
  taskId?: string
  taskRunId?: string
  attempt?: number
  planSnapshotId?: string
  acceptanceIds: string[]
  kind: 'test_command' | 'artifact' | 'delegation' | 'review'
  status: 'passed' | 'failed' | 'unavailable'
  command?: string
  exitCode?: number
  output?: string
  artifactIds: string[]
  actorType: 'human' | 'agent' | 'system'
  actorId?: string
  createdAt: string
}

export interface ProjectReviewRecord {
  id: string
  projectId: string
  revision: number
  planSnapshotId?: string
  evidenceIds: string[]
  round?: number
  acceptanceResults?: Array<{ acceptanceId: string; result: 'passed' | 'failed' | 'waived' | 'not_applicable'; evidenceIds: string[]; note?: string }>
  decision?: 'approve' | 'request_changes' | 'reject' | 'waive'
  independencePassed?: boolean
  reviewerIndependenceWaiver?: { reason: string; owner: string; risk: string; followUpAction: string }
  waivers?: Array<{ acceptanceId: string; reason: string; owner: string }>
  status: 'pending' | 'approved' | 'rejected' | 'waived'
  reviewerType: 'human' | 'agent' | 'system'
  reviewerId?: string
  summary: string
  note?: string
  createdAt: string
  resolvedAt?: string
}

export interface DeliveryRecord {
  id: string
  projectId: string
  revision: number
  planSnapshotId?: string
  reviewId?: string
  evidenceIds: string[]
  immutableDigest?: string
  repository?: string
  baseCommit?: string
  headCommit?: string
  branch?: string
  worktree?: string
  changedFiles?: string[]
  diffStat?: string
  testSummary?: string
  knownRisks?: string[]
  rollbackSteps?: string[]
  handoffMode?: 'local_review'
  teamDigest?: string
  assignmentDigest?: string
  requirementDigest?: string
  decisionDigest?: string
  responsibilityChain?: {
    plannerAgentId?: string
    leadAgentId?: string
    plannedReviewerAgentId?: string
    tasks: Array<{ taskId: string; ownerAgentId?: string; assignmentMode: AssignmentMode; teamDigest?: string; assignmentDigest?: string; taskRunIds: string[]; artifactIds: string[]; verificationEvidenceIds: string[]; delegationIds: string[]; activityIds: string[]; attemptCount: number; wasReassigned: boolean }>
    delegations: Array<{ delegationId: string; squadId: string; leaderAgentId: string; memberAgentId: string; childIssueId: string; status: DelegationRecord['status']; taskRunId?: string; taskRunIds: string[]; retryTaskRunIds: string[]; escalationDecisionIds: string[]; reviewerId?: string; evidenceIds: string[] }>
    verifications: Array<{ evidenceId: string; taskId?: string; taskRunId?: string; actorType: 'human' | 'agent' | 'system'; actorId?: string; artifactIds: string[] }>
    reviewIds: string[]
    decisionIds: string[]
    retryTaskRunIds: string[]
    reassignedTaskIds: string[]
    escalationDecisionIds: string[]
    activityIds: string[]
  }
  status: 'ready' | 'delivered' | 'closed'
  deliveredBy?: string
  deliveredAt?: string
  closedAt?: string
  note?: string
  createdAt: string
}

export interface RepositoryBranch {
  name: string
  protected: boolean
}

export interface RepositoryIssue {
  number: number
  title: string
  body: string
  url: string
  labels: string[]
}

export interface RepositoryInspection {
  repositoryUrl: string
  owner: string
  name: string
  defaultBranch: string
  branches: RepositoryBranch[]
  issues: RepositoryIssue[]
}

export interface DecompositionBatch {
  id: string
  title: string
  prd: string
  technicalDesign: string
  sourceBlocks?: RequirementSourceBlock[]
  idempotencyKey?: string
  supersedesId?: string
  requirementBundleId?: string
  taskIds: string[]
  sessionId?: string
  createdAt: string
  updatedAt: string
}

export interface ProjectRecord {
  id: string
  name: string
  summary: string
  cwd: string
  prd: string
  technicalDesign: string
  prdSourceBlocks?: RequirementSourceBlock[]
  technicalDesignSourceBlocks?: RequirementSourceBlock[]
  priority?: Priority
  owner?: string
  taskLanguage?: TaskLanguage
  status: ProjectStatus
  revision: number
  approvedRevision?: number
  taskIds: string[]
  decompositionBatches?: DecompositionBatch[]
  resourceIds?: string[]
  issueIds?: string[]
  workspaceId?: string
  leadAgentId?: string
  deliveryStage?: 'planning' | 'awaiting_approval' | 'approved' | 'executing' | 'review' | 'delivery_ready' | 'delivered' | 'closed'
  teamComposition?: TeamCompositionSnapshot
  teamDigest?: string
  assignmentDigest?: string
  currentPlanSnapshotId?: string
  decompositionSessionId?: string
  activeDecompositionKey?: string
  activeDecompositionDigest?: string
  activeRunId?: string
  lastError?: string
  createdAt: string
  updatedAt: string
}

export interface TaskRecord {
  id: string
  projectId: string
  ordinal: number
  title: string
  kind: 'code' | 'test'
  priority?: Priority
  tags?: string[]
  description: string
  acceptanceCriteria: string[]
  completionCriteria?: string[]
  dependencies: string[]
  agentId?: string
  testCommand: string
  sourceRequirementIds?: string[]
  acceptanceIds?: string[]
  decisionIds?: string[]
  planningContractVersion?: 2
  assignmentPolicy?: { mode: AssignmentMode; riskLevel: TaskRiskLevel; requiredRoles: string[]; requiredCapabilities: string[]; allowedAgentIds: string[]; allowedSquadIds: string[]; requiresIndependentReviewer: boolean; maxParallel: number; parallelGroup?: string; conflictKeys: string[]; allowedScope: string[]; forbiddenScope: string[]; escalationConditions: string[] }
  assignmentSource?: 'planner_recommendation' | 'automatic_match' | 'manual'
  assignmentDigest?: string
  teamDigest?: string
  relationship?: 'implementation' | 'verification' | 'review' | 'handoff'
  status: TaskStatus
  boardStage?: BoardStage
  sessionId?: string
  latestRunId?: string
  issueId?: string
  latestTaskRunId?: string
  testExitCode?: number
  testOutput?: string
  resultSummary?: string
  failureReason?: string
  attemptCount?: number
  attempts?: Array<{ attempt: number; sessionId?: string; exitCode?: number; output?: string; failureReason?: string; createdAt: string }>
  createdAt: string
  updatedAt: string
}

export interface ApprovalRecord {
  id: string
  projectId: string
  revision: number
  planHash: string
  teamDigest?: string
  assignmentDigest?: string
  actor: string
  approvedAt: string
}

export interface RunRecord {
  id: string
  projectId: string
  status: 'queued' | 'running' | 'completed' | 'failed' | 'cancelled'
  currentTaskId?: string
  approvalRevision?: number
  approvalPlanHash?: string
  teamDigest?: string
  assignmentDigest?: string
  error?: string
  createdAt: string
  startedAt?: string
  completedAt?: string
  taskRunIds?: string[]
}

export interface RuntimeRecord {
  id: string
  name: string
  machineId: string
  status: RuntimeStatus
  lifecycle: RuntimeLifecycle
  capabilities: string[]
  agentCli?: string
  workspaceRoot?: string
  lastHeartbeatAt: string
  archivedAt?: string
  createdAt: string
  updatedAt: string
}

export interface ProjectResource {
  id: string
  projectId: string
  kind: ResourceKind
  location: string
  ref?: string
  sourcePath?: string
  executionMode: ResourceExecutionMode
  runtimeId?: string
  createdAt: string
  updatedAt: string
}

export interface IssueRecord {
  id: string
  projectId?: string
  parentIssueId?: string
  title: string
  description: string
  status: IssueStatus
  priority: Priority
  assigneeType?: 'member' | 'agent' | 'squad'
  assigneeId?: string
  labels: string[]
  assignmentRevision?: number
  activeTaskRunId?: string
  reviewStatus?: 'not_requested' | 'pending' | 'approved' | 'changes_requested'
  reviewedBy?: string
  reviewedAt?: string
  reviewNote?: string
  createdAt: string
  updatedAt: string
}

export interface TaskRunRecord {
  id: string
  projectId: string
  issueId?: string
  taskId?: string
  agentId?: string
  runtimeId?: string
  runtimeNameSnapshot?: string
  status: TaskRunStatus
  trigger: 'assignment' | 'mention' | 'approval' | 'retry' | 'autopilot' | 'system'
  attempt: number
  retryOf?: string
  assignmentRevision?: number
  commandId?: string
  squadId?: string
  delegatedByTaskRunId?: string
  resumeDelegationId?: string
  resumeDecisionId?: string
  finishedReason?: 'completed' | 'stopped' | 'reassigned' | 'review_rejected' | 'failed' | 'decision_requested'
  promptVersion?: string
  promptDigest?: string
  promptContextDigest?: string
  collaborationPolicyVersion?: string
  promptDiagnostics?: PromptDiagnostic[]
  sessionId?: string
  cwd?: string
  resourceId?: string
  workspace?: string
  branch?: string
  baseCommit?: string
  headCommit?: string
  diffSummary?: string
  changedFiles?: string[]
  diffStat?: string
  artifactIds?: string[]
  dispatchedAt?: string
  waitReason?: 'runtime' | 'capacity' | 'parallel_group' | 'conflict' | 'workspace'
  waitStartedAt?: string
  waitDurationsMs?: { runtime: number; capacity: number; parallelGroup: number; conflict: number; workspace: number }
  waitCounts?: { runtime: number; capacity: number; parallelGroup: number; conflict: number; workspace: number }
  durationMs?: number
  provider?: string
  model?: string
  inputTokens?: number
  outputTokens?: number
  costUsd?: number
  error?: string
  errorCode?: 'verification_failed' | 'scope_violation' | 'verification_unavailable' | 'permission_denied' | 'runtime_offline' | 'capacity_exhausted' | 'dependency_failed' | 'internal'
  testExitCode?: number
  testOutput?: string
  executionEnvironment?: 'host_path' | 'project_venv'
  virtualEnvPath?: string
  createdAt: string
  startedAt?: string
  completedAt?: string
}

export interface CommentRecord {
  id: string
  issueId: string
  authorType: 'human' | 'agent' | 'system'
  authorId?: string
  body: string
  createdAt: string
}

export interface ActivityEvent {
  id: string
  projectId?: string
  issueId?: string
  taskRunId?: string
  actorType: 'human' | 'agent' | 'system'
  actorId?: string
  type: string
  message: string
  metadata: Record<string, unknown>
  createdAt: string
}

export interface DecisionRecord {
  id: string
  projectId?: string
  issueId?: string
  taskRunId?: string
  kind: 'approval' | 'retry' | 'assignment' | 'review' | 'permission' | 'runtime'
  title: string
  prompt: string
  status: 'pending' | 'approved' | 'rejected' | 'deferred'
  requestedByType: 'human' | 'agent' | 'system'
  requestedById?: string
  resolvedBy?: string
  resolution?: string
  metadata: Record<string, unknown>
  createdAt: string
  resolvedAt?: string
}

export interface InboxItem {
  id: string
  kind: InboxKind
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

export interface AgentWorkload {
  agentId: string
  availability: RuntimeStatus | 'unknown'
  workload: AgentWorkloadState
  lifecycle: 'active' | 'archived'
  queued: number
  working: number
  occupied: number
  maxConcurrency: number
  availableSlots: number
  utilizationPercent: number
  runtimeId?: string
}

export interface SquadRecord { id: string; name: string; description: string; leaderAgentId: string; memberAgentIds: string[]; memberRoles: Record<string, string>; instructions: string; escalationPolicy: string; escalationConfig?: SquadEscalationPolicy; collaborationPolicyVersion?: string; maxParallelDelegations: number; status: 'active' | 'archived'; createdAt: string; updatedAt: string }
export interface DelegationRecord { id: string; squadId: string; projectId: string; parentIssueId: string; parentAssignmentRevision?: number; coordinationTaskRunId?: string; childIssueId: string; leaderAgentId: string; memberAgentId: string; taskRunId?: string; commandId?: string; status: 'queued' | 'running' | 'waiting_leader' | 'completed' | 'failed' | 'cancelled' | 'escalated'; instruction: string; contract?: DelegationContract; contractDigest?: string; teamDigest?: string; planSnapshotId?: string; parentAcceptanceIds?: string[]; childTaskIds?: string[]; sourceRequirementIds?: string[]; assignmentDigest?: string; evidenceIds?: string[]; reviewerId?: string; resultSummary?: string; error?: string; createdAt: string; updatedAt: string; completedAt?: string }
export interface TranscriptEntry { id: string; taskRunId: string; sequence: number; role: 'user' | 'assistant' | 'tool' | 'system'; kind: string; text: string; createdAt: string }
export interface ArtifactRecord { id: string; projectId: string; issueId?: string; taskRunId?: string; kind: 'diff' | 'test_report' | 'document' | 'log' | 'commit' | 'pull_request'; name: string; status: 'available' | 'missing' | 'failed'; uri?: string; content?: string; metadata: Record<string, unknown>; createdAt: string }
export interface CommandRecord { id: string; idempotencyKey?: string; type: string; status: 'pending' | 'running' | 'completed' | 'failed' | 'cancelled'; projectId?: string; issueId?: string; squadId?: string; actorType: 'human' | 'agent' | 'system'; actorId?: string; payload: Record<string, unknown>; result?: Record<string, unknown>; error?: string; createdAt: string; completedAt?: string }
export interface ExternalTriggerRecord { id: string; source: string; externalKey: string; payloadDigest: string; status: 'received' | 'processed' | 'rejected' | 'duplicate'; commandId?: string; receivedAt: string; processedAt?: string }
export interface SkillRecord { id: string; name: string; description: string; source: 'agent' | 'workspace' | 'builtin'; agentIds: string[]; updatedAt: string }
export interface WorkspaceLease { id: string; taskRunId: string; projectId: string; resourceId?: string; runtimeId?: string; mode: ResourceExecutionMode; sourcePath: string; workspacePath: string; branchName?: string; baseCommit?: string; state: 'preparing' | 'active' | 'releasing' | 'released' | 'orphaned'; acquiredAt: string; heartbeatAt: string; releasedAt?: string; cleanupError?: string }
export interface LocalDirectoryLock { id: string; canonicalPath: string; taskRunId: string; projectId: string; acquiredAt: string; heartbeatAt: string }
export interface RunStatistics { taskRunId: string; projectId: string; issueId?: string; agentId?: string; durationMs?: number; inputTokens?: number; outputTokens?: number; costUsd?: number; usageKnown: boolean }
export type SquadAvailabilityReason = 'not_bound' | 'binding_needs_review' | 'legacy_member_count' | 'archived' | 'agent_inactive' | 'member_outside_project' | 'capacity_exhausted'
export type SquadAvailabilityWarning = 'leader_runtime_offline' | 'leader_runtime_unstable'
export interface SquadAvailability { squadId: string; projectId: string; eligible: boolean; reasons: SquadAvailabilityReason[]; dispatchReady: boolean; warnings: SquadAvailabilityWarning[]; missingAgentIds: string[]; activeDelegations: number; availableSlots: number }
export interface RuntimeOverview { defaultHost: { id: 'default-host'; name: '本机默认环境'; status: 'online' | 'unstable'; capabilities: string[]; boundAgentCount: number }; customCount: number; abnormalCount: number; archivedCount: number }
export interface RuntimeDetail { runtime: RuntimeRecord; agents: AgentRecord[]; resources: ProjectResource[]; queuedTaskRuns: TaskRunRecord[]; activeTaskRuns: TaskRunRecord[]; affectedProjectIds: string[]; historyCount: number }
export interface AgentRuntimeImpact { agentId: string; currentRuntimeId?: string; nextRuntimeId?: string; executableTaskRunIds: string[]; affectedProjects: Array<{ projectId: string; revision: number; status: ProjectStatus; assignedTaskIds: string[]; approvalWillInvalidate: boolean }> }

export interface Snapshot {
  agents: AgentRecord[]
  projects: ProjectRecord[]
  tasks: TaskRecord[]
  approvals: ApprovalRecord[]
  runs: RunRecord[]
  planHashes: Record<string, string>
  planSnapshots?: PlanSnapshotRecord[]
  requirementBundles?: RequirementBundleRecord[]
  requirementItems?: RequirementItemRecord[]
  requirementDecisions?: RequirementDecisionRecord[]
  acceptanceCriteria?: AcceptanceCriterionRecord[]
  verificationEvidence?: VerificationEvidenceRecord[]
  projectReviews?: ProjectReviewRecord[]
  deliveryRecords?: DeliveryRecord[]
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
  workspaceLeases: WorkspaceLease[]
  localDirectoryLocks: LocalDirectoryLock[]
  inbox: InboxItem[]
  agentWorkloads: AgentWorkload[]
  runStatistics: RunStatistics[]
  projectAgentMemberships: ProjectAgentMembership[]
  projectSquadBindings: ProjectSquadBinding[]
  projectAgentMembershipSources: ProjectAgentMembershipSource[]
  featureUsageDaily: FeatureUsageDaily[]
  runtimeOverview: RuntimeOverview
}
