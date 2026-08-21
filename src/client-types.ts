export type AgentToolPolicy = 'full' | 'read_only'
export type Priority = 'low' | 'medium' | 'high' | 'urgent'
export type ProjectStatus = 'draft' | 'decomposing' | 'awaiting_approval' | 'approved' | 'running' | 'completed' | 'failed' | 'cancelled'
export type TaskLanguage = 'zh-CN' | 'en'
export type TaskStatus = 'draft' | 'queued' | 'running' | 'verifying' | 'completed' | 'failed' | 'blocked' | 'cancelled'
export type BoardStage = 'planned' | 'todo' | 'in_progress' | 'review'
export type RuntimeStatus = 'online' | 'offline' | 'unstable'
export type ResourceKind = 'github_repo' | 'local_directory'
export type ResourceExecutionMode = 'in_place' | 'worktree'
export type IssueStatus = 'backlog' | 'todo' | 'in_progress' | 'in_review' | 'done' | 'blocked' | 'cancelled'
export type TaskRunStatus = 'deferred' | 'queued' | 'dispatched' | 'waiting_local_directory' | 'running' | 'completed' | 'failed' | 'cancelled'
export type InboxKind = 'needs_decision' | 'blocked' | 'review_ready' | 'runtime_offline' | 'permission_denied' | 'test_failed_after_retry' | 'stale_approval'
export type AgentWorkloadState = 'idle' | 'queued' | 'working'

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
  runtimeId?: string
  access?: 'only_me' | 'workspace' | 'specific_people'
  maxConcurrency?: number
  status: 'active' | 'archived'
  createdAt: string
  updatedAt: string
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
  decompositionSessionId?: string
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
  dependencies: string[]
  agentId?: string
  testCommand: string
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
  capabilities: string[]
  agentCli?: string
  workspaceRoot?: string
  lastHeartbeatAt: string
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
  status: TaskRunStatus
  trigger: 'assignment' | 'mention' | 'approval' | 'retry' | 'autopilot' | 'system'
  attempt: number
  retryOf?: string
  assignmentRevision?: number
  commandId?: string
  squadId?: string
  delegatedByTaskRunId?: string
  finishedReason?: 'completed' | 'stopped' | 'reassigned' | 'review_rejected' | 'failed'
  sessionId?: string
  cwd?: string
  resourceId?: string
  workspace?: string
  branch?: string
  baseCommit?: string
  headCommit?: string
  diffSummary?: string
  artifactIds?: string[]
  dispatchedAt?: string
  durationMs?: number
  provider?: string
  model?: string
  inputTokens?: number
  outputTokens?: number
  costUsd?: number
  error?: string
  errorCode?: 'verification_failed' | 'permission_denied' | 'runtime_offline' | 'capacity_exhausted' | 'dependency_failed' | 'internal'
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

export interface SquadRecord { id: string; name: string; description: string; leaderAgentId: string; memberAgentIds: string[]; memberRoles: Record<string, string>; instructions: string; escalationPolicy: string; maxParallelDelegations: number; status: 'active' | 'archived'; createdAt: string; updatedAt: string }
export interface DelegationRecord { id: string; squadId: string; projectId: string; parentIssueId: string; childIssueId: string; leaderAgentId: string; memberAgentId: string; taskRunId?: string; status: 'queued' | 'running' | 'waiting_leader' | 'completed' | 'failed' | 'cancelled' | 'escalated'; instruction: string; resultSummary?: string; error?: string; createdAt: string; updatedAt: string; completedAt?: string }
export interface TranscriptEntry { id: string; taskRunId: string; sequence: number; role: 'user' | 'assistant' | 'tool' | 'system'; kind: string; text: string; createdAt: string }
export interface ArtifactRecord { id: string; projectId: string; issueId?: string; taskRunId?: string; kind: 'diff' | 'test_report' | 'document' | 'log' | 'commit' | 'pull_request'; name: string; status: 'available' | 'missing' | 'failed'; uri?: string; content?: string; metadata: Record<string, unknown>; createdAt: string }
export interface CommandRecord { id: string; idempotencyKey?: string; type: string; status: 'pending' | 'running' | 'completed' | 'failed' | 'cancelled'; projectId?: string; issueId?: string; squadId?: string; actorType: 'human' | 'agent' | 'system'; actorId?: string; payload: Record<string, unknown>; result?: Record<string, unknown>; error?: string; createdAt: string; completedAt?: string }
export interface ExternalTriggerRecord { id: string; source: string; externalKey: string; payloadDigest: string; status: 'received' | 'processed' | 'rejected' | 'duplicate'; commandId?: string; receivedAt: string; processedAt?: string }
export interface SkillRecord { id: string; name: string; description: string; source: 'agent' | 'workspace' | 'builtin'; agentIds: string[]; updatedAt: string }
export interface WorkspaceLease { id: string; taskRunId: string; projectId: string; resourceId?: string; runtimeId?: string; mode: ResourceExecutionMode; sourcePath: string; workspacePath: string; branchName?: string; baseCommit?: string; state: 'preparing' | 'active' | 'releasing' | 'released' | 'orphaned'; acquiredAt: string; heartbeatAt: string; releasedAt?: string; cleanupError?: string }
export interface LocalDirectoryLock { id: string; canonicalPath: string; taskRunId: string; projectId: string; acquiredAt: string; heartbeatAt: string }
export interface RunStatistics { taskRunId: string; projectId: string; issueId?: string; agentId?: string; durationMs?: number; inputTokens?: number; outputTokens?: number; costUsd?: number; usageKnown: boolean }

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
  workspaceLeases: WorkspaceLease[]
  localDirectoryLocks: LocalDirectoryLock[]
  inbox: InboxItem[]
  agentWorkloads: AgentWorkload[]
  runStatistics: RunStatistics[]
}
