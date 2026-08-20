import { z } from 'zod'

export const AgentToolPolicySchema = z.enum(['full', 'read_only'])
export const AgentStatusSchema = z.enum(['active', 'archived'])
export const PrioritySchema = z.enum(['low', 'medium', 'high', 'urgent'])
export const TaskLanguageSchema = z.enum(['zh-CN', 'en'])
export const RuntimeStatusSchema = z.enum(['online', 'offline', 'unstable'])
export const ResourceKindSchema = z.enum(['github_repo', 'local_directory'])
export const ResourceExecutionModeSchema = z.enum(['in_place', 'worktree'])
export const IssueStatusSchema = z.enum(['backlog', 'todo', 'in_progress', 'in_review', 'done', 'blocked', 'cancelled'])
export const IssueAssigneeTypeSchema = z.enum(['member', 'agent', 'squad'])
export const TaskRunStatusSchema = z.enum(['deferred', 'queued', 'dispatched', 'waiting_local_directory', 'running', 'completed', 'failed', 'cancelled'])
export const TaskRunErrorCodeSchema = z.enum(['verification_failed', 'permission_denied', 'runtime_offline', 'capacity_exhausted', 'dependency_failed', 'internal'])
export const ActivityActorTypeSchema = z.enum(['human', 'agent', 'system'])
export const DecisionKindSchema = z.enum(['approval', 'retry', 'assignment', 'review', 'permission', 'runtime'])
export const DecisionStatusSchema = z.enum(['pending', 'approved', 'rejected', 'deferred'])
export const SquadStatusSchema = z.enum(['active', 'archived'])
export const DelegationStatusSchema = z.enum(['queued', 'running', 'waiting_leader', 'completed', 'failed', 'cancelled', 'escalated'])
export const ArtifactKindSchema = z.enum(['diff', 'test_report', 'document', 'log', 'commit', 'pull_request'])
export const ArtifactStatusSchema = z.enum(['available', 'missing', 'failed'])
export const CommandTypeSchema = z.enum(['assign_issue', 'reassign_issue', 'stop_issue', 'continue_issue', 'approve_review', 'reject_review', 'request_decision', 'delegate_issue', 'retry_delegation', 'stop_delegation', 'autopilot_tick'])
export const CommandStatusSchema = z.enum(['pending', 'running', 'completed', 'failed', 'cancelled'])
export const ExternalTriggerStatusSchema = z.enum(['received', 'processed', 'rejected', 'duplicate'])
export const InboxKindSchema = z.enum(['needs_decision', 'blocked', 'review_ready', 'runtime_offline', 'permission_denied', 'test_failed_after_retry', 'stale_approval'])
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
  childIssueId: z.string().min(1),
  leaderAgentId: z.string().min(1),
  memberAgentId: z.string().min(1),
  taskRunId: z.string().min(1).optional(),
  status: DelegationStatusSchema,
  instruction: z.string().trim().min(1).max(20_000),
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
  capabilities: z.array(z.string().trim().min(1).max(160)).max(100),
  agentCli: z.string().max(160).optional(),
  workspaceRoot: z.string().max(4_096).optional(),
  lastHeartbeatAt: z.string().min(1),
  createdAt: z.string().min(1),
  updatedAt: z.string().min(1),
}).strict()

export const ProjectResourceSchema = z.object({
  id: z.string().min(1),
  projectId: z.string().min(1),
  kind: ResourceKindSchema,
  location: z.string().trim().min(1).max(4_096),
  ref: z.string().trim().max(500).optional(),
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
  agentId: z.string().min(1).optional(),
  runtimeId: z.string().min(1).optional(),
  status: TaskRunStatusSchema,
  trigger: z.enum(['assignment', 'mention', 'approval', 'retry', 'autopilot', 'system']),
  attempt: z.number().int().positive(),
  retryOf: z.string().min(1).optional(),
  assignmentRevision: z.number().int().nonnegative().optional(),
  commandId: z.string().min(1).optional(),
  squadId: z.string().min(1).optional(),
  delegatedByTaskRunId: z.string().min(1).optional(),
  finishedReason: z.enum(['completed', 'stopped', 'reassigned', 'review_rejected', 'failed']).optional(),
  sessionId: z.string().min(1).optional(),
  cwd: z.string().min(1).max(4_096).optional(),
  resourceId: z.string().min(1).optional(),
  workspace: z.string().min(1).max(4_096).optional(),
  branch: z.string().min(1).max(500).optional(),
  baseCommit: z.string().min(1).max(100).optional(),
  headCommit: z.string().min(1).max(100).optional(),
  diffSummary: z.string().max(70_000).optional(),
  artifactIds: z.array(z.string().min(1)).max(500).optional(),
  dispatchedAt: z.string().min(1).optional(),
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
  runtimeId: z.string().min(1).optional(),
  access: z.enum(['only_me', 'workspace', 'specific_people']).optional(),
  maxConcurrency: z.number().int().positive().max(32).optional(),
  status: AgentStatusSchema,
  createdAt: z.string().min(1),
  updatedAt: z.string().min(1),
})

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
  resourceIds: z.array(z.string().min(1)).max(100).optional(),
  issueIds: z.array(z.string().min(1)).max(1_000).optional(),
  leadAgentId: z.string().min(1).optional(),
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
  testCommand: z.string().min(1).max(10_000),
})

export const GeneratedPlanSchema = z.object({
  summary: z.string().min(1).max(5_000),
  tasks: z.array(GeneratedTaskSchema).min(2).max(200),
})

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
  runtimeId: z.string().min(1).optional(),
  access: z.enum(['only_me', 'workspace', 'specific_people']).default('only_me'),
  maxConcurrency: z.number().int().positive().max(32).default(1),
})

const DEFAULT_TECHNICAL_DESIGN = 'No separate technical design was supplied. Inspect the repository read-only, follow its existing architecture and tests, state material assumptions in the generated plan, and choose the smallest implementation that satisfies the delivery brief.'

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
  ProjectEditableInputSchema.extend({ mode: z.literal('empty') }).superRefine((value, context) => {
    if (value.name === '') context.addIssue({ code: z.ZodIssueCode.custom, path: ['name'], message: 'A project name is required for an empty project.' })
  }),
  ProjectEditableInputSchema.extend({ mode: z.literal('ai').default('ai') }).superRefine((value, context) => {
    if (value.prd === '') context.addIssue({ code: z.ZodIssueCode.custom, path: ['prd'], message: 'A delivery brief is required for AI planning.' })
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
  feedback: z.string().trim().min(1).max(10_000),
  assumptions: AgentBuilderAssumptionsSchema.default([]),
  openQuestions: AgentBuilderQuestionsSchema.default([]),
}).strict()

export const RuntimeInputSchema = z.object({
  name: z.string().trim().min(1).max(160),
  machineId: z.string().trim().min(1).max(240),
  capabilities: z.array(z.string().trim().min(1).max(160)).max(100).default([]),
  agentCli: z.string().trim().max(160).optional(),
  workspaceRoot: z.string().trim().max(4_096).optional(),
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
  assigneeType: IssueAssigneeTypeSchema.nullable().optional(),
  assigneeId: z.string().min(1).nullable().optional(),
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
  memberAgentIds: z.array(z.string().min(1)).min(1).max(100),
  memberRoles: z.record(z.string(), z.string().trim().min(1).max(200)).default({}),
  instructions: z.string().trim().min(1).max(20_000),
  escalationPolicy: z.string().trim().min(1).max(10_000),
  maxParallelDelegations: z.number().int().positive().max(32).default(1),
}).strict()

export const CommandInputSchema = z.object({
  idempotencyKey: z.string().trim().min(1).max(240).optional(),
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
  testCommand: z.string().trim().min(1).max(10_000),
})

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
  testCommand: z.string().trim().min(1).max(10_000).optional(),
})

export type SquadRecord = z.infer<typeof SquadRecordSchema>
export type SquadInput = z.infer<typeof SquadInputSchema>
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
export interface InboxItem {
  id: string
  kind: z.infer<typeof InboxKindSchema>
  title: string
  summary: string
  projectId?: string
  issueId?: string
  taskRunId?: string
  decisionId?: string
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
export type BoardStage = z.infer<typeof BoardStageSchema>
export type TaskBoardStageRequest = z.infer<typeof TaskBoardStageRequestSchema>
export type ApprovalRecord = z.infer<typeof ApprovalRecordSchema>
export type RunRecord = z.infer<typeof RunRecordSchema>
export type GeneratedPlan = z.infer<typeof GeneratedPlanSchema>
export type AgentInput = z.infer<typeof AgentInputSchema>
export type AgentBuilderMessage = z.infer<typeof AgentBuilderMessageSchema>
export type AgentDraftRequest = z.infer<typeof AgentDraftRequestSchema>
export type AgentBuilderResponse = z.infer<typeof AgentBuilderResponseSchema>
export type ProjectInput = z.infer<typeof ProjectInputSchema>
export type ProjectUpdateInput = z.infer<typeof ProjectUpdateInputSchema>
export type ProjectCreateRequest = z.infer<typeof ProjectCreateRequestSchema>
export type TaskLanguage = z.infer<typeof TaskLanguageSchema>
export type ProjectReplanRequest = z.infer<typeof ProjectReplanRequestSchema>
export type ProjectApprovalRequest = z.infer<typeof ProjectApprovalRequestSchema>
export type TaskInput = z.infer<typeof TaskInputSchema>
export type TaskUpdate = z.infer<typeof TaskUpdateSchema>

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
  inbox: InboxItem[]
  agentWorkloads: AgentWorkload[]
  runStatistics: RunStatistics[]
}
