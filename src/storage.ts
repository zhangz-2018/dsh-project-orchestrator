import { z } from 'zod'
import {
  defineDomain,
  domainTable,
  type Domain,
} from '@deepseek-ai/dsh-storage-domain'
import {
  ActivityEventSchema,
  CommentRecordSchema,
  DecisionRecordSchema,
  SquadRecordSchema,
  DelegationRecordSchema,
  TranscriptEntrySchema,
  ArtifactRecordSchema,
  CommandRecordSchema,
  ExternalTriggerRecordSchema,
  SkillRecordSchema,
  LocalDirectoryLockRecordSchema,
  WorkspaceLeaseRecordSchema,
  TaskRunConflictLockRecordSchema,
  AgentRecordSchema,
  ApprovalRecordSchema,
  IssueRecordSchema,
  ProjectRecordSchema,
  ProjectResourceSchema,
  RunRecordSchema,
  RuntimeRecordSchema,
  TaskRecordSchema,
  TaskRunRecordSchema,
  ProjectAgentMembershipRecordSchema,
  ProjectSquadBindingRecordSchema,
  ProjectAgentMembershipSourceRecordSchema,
  PlanSnapshotRecordSchema,
  RequirementBundleRecordSchema,
  RequirementItemRecordSchema,
  RequirementDecisionRecordSchema,
  AcceptanceCriterionRecordSchema,
  VerificationEvidenceRecordSchema,
  ProjectReviewRecordSchema,
  DeliveryRecordSchema,
  FeatureUsageDailyRecordSchema,
  type ActivityEvent,
  type CommentRecord,
  type DecisionRecord,
  type SquadRecord,
  type DelegationRecord,
  type TranscriptEntry,
  type ArtifactRecord,
  type CommandRecord,
  type ExternalTriggerRecord,
  type SkillRecord,
  type LocalDirectoryLockRecord,
  type WorkspaceLeaseRecord,
  type TaskRunConflictLockRecord,
  type AgentRecord,
  type ApprovalRecord,
  type IssueRecord,
  type ProjectRecord,
  type ProjectResource,
  type RunRecord,
  type RuntimeRecord,
  type Snapshot,
  type TaskRecord,
  type TaskRunRecord,
  type ProjectAgentMembershipRecord,
  type ProjectSquadBindingRecord,
  type ProjectAgentMembershipSourceRecord,
  type FeatureUsageDailyRecord,
  type PlanSnapshotRecord,
  type RequirementBundleRecord,
  type RequirementItemRecord,
  type RequirementDecisionRecord,
  type AcceptanceCriterionRecord,
  type VerificationEvidenceRecord,
  type ProjectReviewRecord,
  type DeliveryRecord,
} from './types.js'
import { WorkflowError, planDigest } from './workflow.js'

export const orchestratorDomain = defineDomain({
  name: 'project_orchestrator',
  version: 1,
  global: {
    schema: z.object({ schemaVersion: z.literal(1) }),
    initial: { schemaVersion: 1 },
  },
  tables: {
    agents: domainTable<string, AgentRecord>(AgentRecordSchema),
    projects: domainTable<string, ProjectRecord>(ProjectRecordSchema),
    tasks: domainTable<string, TaskRecord>(TaskRecordSchema),
    approvals: domainTable<string, ApprovalRecord>(ApprovalRecordSchema),
    runs: domainTable<string, RunRecord>(RunRecordSchema),
    runtimes: domainTable<string, RuntimeRecord>(RuntimeRecordSchema),
    resources: domainTable<string, ProjectResource>(ProjectResourceSchema),
    issues: domainTable<string, IssueRecord>(IssueRecordSchema),
    task_runs: domainTable<string, TaskRunRecord>(TaskRunRecordSchema),
    activity: domainTable<string, ActivityEvent>(ActivityEventSchema),
    comments: domainTable<string, CommentRecord>(CommentRecordSchema),
    decisions: domainTable<string, DecisionRecord>(DecisionRecordSchema),
    squads: domainTable<string, SquadRecord>(SquadRecordSchema),
    delegations: domainTable<string, DelegationRecord>(DelegationRecordSchema),
    transcripts: domainTable<string, TranscriptEntry>(TranscriptEntrySchema),
    artifacts: domainTable<string, ArtifactRecord>(ArtifactRecordSchema),
    commands: domainTable<string, CommandRecord>(CommandRecordSchema),
    external_triggers: domainTable<string, ExternalTriggerRecord>(ExternalTriggerRecordSchema),
    skills: domainTable<string, SkillRecord>(SkillRecordSchema),
    local_directory_locks: domainTable<string, LocalDirectoryLockRecord>(LocalDirectoryLockRecordSchema),
    workspace_leases: domainTable<string, WorkspaceLeaseRecord>(WorkspaceLeaseRecordSchema),
    task_run_conflict_locks: domainTable<string, TaskRunConflictLockRecord>(TaskRunConflictLockRecordSchema),
    project_agent_memberships: domainTable<string, ProjectAgentMembershipRecord>(ProjectAgentMembershipRecordSchema),
    project_squad_bindings: domainTable<string, ProjectSquadBindingRecord>(ProjectSquadBindingRecordSchema),
    project_agent_membership_sources: domainTable<string, ProjectAgentMembershipSourceRecord>(ProjectAgentMembershipSourceRecordSchema),
    feature_usage_daily: domainTable<string, FeatureUsageDailyRecord>(FeatureUsageDailyRecordSchema),
    plan_snapshots: domainTable<string, PlanSnapshotRecord>(PlanSnapshotRecordSchema),
    requirement_bundles: domainTable<string, RequirementBundleRecord>(RequirementBundleRecordSchema),
    requirement_items: domainTable<string, RequirementItemRecord>(RequirementItemRecordSchema),
    requirement_decisions: domainTable<string, RequirementDecisionRecord>(RequirementDecisionRecordSchema),
    acceptance_criteria: domainTable<string, AcceptanceCriterionRecord>(AcceptanceCriterionRecordSchema),
    verification_evidence: domainTable<string, VerificationEvidenceRecord>(VerificationEvidenceRecordSchema),
    project_reviews: domainTable<string, ProjectReviewRecord>(ProjectReviewRecordSchema),
    delivery_records: domainTable<string, DeliveryRecord>(DeliveryRecordSchema),
  },
})

export class OrchestratorStore {
  readonly agents
  readonly projects
  readonly tasks
  readonly approvals
  readonly runs
  readonly runtimes
  readonly resources
  readonly issues
  readonly taskRuns
  readonly activity
  readonly comments
  readonly decisions
  readonly squads
  readonly delegations
  readonly transcripts
  readonly artifacts
  readonly commands
  readonly externalTriggers
  readonly skills
  readonly localDirectoryLocks
  readonly workspaceLeases
  readonly taskRunConflictLocks
  readonly projectAgentMemberships
  readonly projectSquadBindings
  readonly projectAgentMembershipSources
  readonly featureUsageDaily
  readonly planSnapshots
  readonly requirementBundles
  readonly requirementItems
  readonly requirementDecisions
  readonly acceptanceCriteria
  readonly verificationEvidence
  readonly projectReviews
  readonly deliveryRecords

  constructor(readonly domain: Domain<typeof orchestratorDomain>) {
    this.agents = domain.table('agents')
    this.projects = domain.table('projects')
    this.tasks = domain.table('tasks')
    this.approvals = domain.table('approvals')
    this.runs = domain.table('runs')
    this.runtimes = optionalTable<RuntimeRecord>(domain, 'runtimes')
    this.resources = optionalTable<ProjectResource>(domain, 'resources')
    this.issues = optionalTable<IssueRecord>(domain, 'issues')
    this.taskRuns = optionalTable<TaskRunRecord>(domain, 'task_runs')
    this.activity = optionalTable<ActivityEvent>(domain, 'activity')
    this.comments = optionalTable<CommentRecord>(domain, 'comments')
    this.decisions = optionalTable<DecisionRecord>(domain, 'decisions')
    this.squads = optionalTable<SquadRecord>(domain, 'squads')
    this.delegations = optionalTable<DelegationRecord>(domain, 'delegations')
    this.transcripts = optionalTable<TranscriptEntry>(domain, 'transcripts')
    this.artifacts = optionalTable<ArtifactRecord>(domain, 'artifacts')
    this.commands = optionalTable<CommandRecord>(domain, 'commands')
    this.externalTriggers = optionalTable<ExternalTriggerRecord>(domain, 'external_triggers')
    this.skills = optionalTable<SkillRecord>(domain, 'skills')
    this.localDirectoryLocks = optionalTable<LocalDirectoryLockRecord>(domain, 'local_directory_locks')
    this.workspaceLeases = optionalTable<WorkspaceLeaseRecord>(domain, 'workspace_leases')
    this.taskRunConflictLocks = optionalTable<TaskRunConflictLockRecord>(domain, 'task_run_conflict_locks')
    this.projectAgentMemberships = optionalTable<ProjectAgentMembershipRecord>(domain, 'project_agent_memberships')
    this.projectSquadBindings = optionalTable<ProjectSquadBindingRecord>(domain, 'project_squad_bindings')
    this.projectAgentMembershipSources = optionalTable<ProjectAgentMembershipSourceRecord>(domain, 'project_agent_membership_sources')
    this.featureUsageDaily = optionalTable<FeatureUsageDailyRecord>(domain, 'feature_usage_daily')
    this.planSnapshots = optionalTable<PlanSnapshotRecord>(domain, 'plan_snapshots')
    this.requirementBundles = optionalTable<RequirementBundleRecord>(domain, 'requirement_bundles')
    this.requirementItems = optionalTable<RequirementItemRecord>(domain, 'requirement_items')
    this.requirementDecisions = optionalTable<RequirementDecisionRecord>(domain, 'requirement_decisions')
    this.acceptanceCriteria = optionalTable<AcceptanceCriterionRecord>(domain, 'acceptance_criteria')
    this.verificationEvidence = optionalTable<VerificationEvidenceRecord>(domain, 'verification_evidence')
    this.projectReviews = optionalTable<ProjectReviewRecord>(domain, 'project_reviews')
    this.deliveryRecords = optionalTable<DeliveryRecord>(domain, 'delivery_records')
  }

  snapshot(): Snapshot {
    const projects = [...this.projects.entries()].map(([, value]) => value).sort(byUpdatedAt)
    const projectIds = new Set(projects.map((project) => project.id))
    const issues = [...this.issues.entries()].map(([, value]) => value).sort(byUpdatedAt)
    const taskRuns = [...this.taskRuns.entries()].map(([, value]) => value).sort(byCreatedAt)
    const runtimes = [...this.runtimes.entries()].map(([, value]) => value).sort(byUpdatedAt)
    const activity = [...this.activity.entries()].map(([, value]) => value).sort(byCreatedAt)
    const comments = [...this.comments.entries()].map(([, value]) => value).sort(byCreatedAt)
    const issueIds = new Set(issues.map((issue) => issue.id))
    const taskRunIds = new Set(taskRuns.map((run) => run.id))
    const activeTaskIds = new Set(projects.flatMap((project) => project.taskIds))
    const planHashes: Record<string, string> = {}
    for (const project of projects) {
      try {
        planHashes[project.id] = planDigest(project, this.projectTasks(project))
      } catch (error) {
        if (!(error instanceof WorkflowError) || error.code !== 'inconsistent-plan') throw error
      }
    }
    return {
      agents: [...this.agents.entries()].map(([, value]) => value).sort(byUpdatedAt),
      projects,
      tasks: [...this.tasks.entries()]
        .filter(([id]) => activeTaskIds.has(id))
        .map(([, value]) => value)
        .sort((left, right) => left.ordinal - right.ordinal),
      approvals: [...this.approvals.entries()]
        .map(([, value]) => value)
        .filter((approval) => projectIds.has(approval.projectId))
        .sort((left, right) => right.approvedAt.localeCompare(left.approvedAt)),
      runs: [...this.runs.entries()]
        .map(([, value]) => value)
        .filter((run) => projectIds.has(run.projectId))
        .sort((left, right) => right.createdAt.localeCompare(left.createdAt)),
      planHashes,
      runtimes,
      resources: [...this.resources.entries()].map(([, value]) => value).filter((resource) => projectIds.has(resource.projectId)).sort(byUpdatedAt),
      issues: issues.filter((issue) => issue.projectId === undefined || projectIds.has(issue.projectId)),
      taskRuns: taskRuns.filter((run) => projectIds.has(run.projectId)),
      activity: activity.filter((event) => event.projectId === undefined || projectIds.has(event.projectId)),
      comments: comments.filter((comment) => issues.some((issue) => issue.id === comment.issueId)),
      decisions: [...this.decisions.entries()]
        .map(([, value]) => value)
        .filter((decision) => (decision.projectId === undefined || projectIds.has(decision.projectId)) && (decision.issueId === undefined || issueIds.has(decision.issueId)) && (decision.taskRunId === undefined || taskRunIds.has(decision.taskRunId)))
        .sort(byCreatedAt),
      squads: [...this.squads.entries()].map(([, value]) => value).sort(byUpdatedAt),
      delegations: [...this.delegations.entries()]
        .map(([, value]) => value)
        .filter((delegation) => projectIds.has(delegation.projectId) && issueIds.has(delegation.parentIssueId) && issueIds.has(delegation.childIssueId))
        .sort(byUpdatedAt),
      transcripts: [...this.transcripts.entries()]
        .map(([, value]) => value)
        .filter((entry) => taskRunIds.has(entry.taskRunId))
        .sort((left, right) => left.taskRunId.localeCompare(right.taskRunId) || left.sequence - right.sequence),
      artifacts: [...this.artifacts.entries()]
        .map(([, value]) => value)
        .filter((artifact) => projectIds.has(artifact.projectId) && (artifact.issueId === undefined || issueIds.has(artifact.issueId)) && (artifact.taskRunId === undefined || taskRunIds.has(artifact.taskRunId)))
        .sort(byCreatedAt),
      commands: [...this.commands.entries()]
        .map(([, value]) => value)
        .filter((command) => (command.projectId === undefined || projectIds.has(command.projectId)) && (command.issueId === undefined || issueIds.has(command.issueId)))
        .sort(byCreatedAt),
      externalTriggers: [...this.externalTriggers.entries()].map(([, value]) => value).sort((left, right) => right.receivedAt.localeCompare(left.receivedAt)),
      skills: [...this.skills.entries()].map(([, value]) => value).sort(byUpdatedAt),
      workspaceLeases: [...this.workspaceLeases.entries()].map(([, value]) => value).filter((lease) => projectIds.has(lease.projectId)).sort((left, right) => right.acquiredAt.localeCompare(left.acquiredAt)),
      localDirectoryLocks: [...this.localDirectoryLocks.entries()].map(([, value]) => value).filter((lock) => projectIds.has(lock.projectId)).sort((left, right) => right.acquiredAt.localeCompare(left.acquiredAt)),
      projectAgentMemberships: [...this.projectAgentMemberships.entries()].map(([, value]) => value).filter((membership) => projectIds.has(membership.projectId)).sort(byUpdatedAt),
      projectSquadBindings: [...this.projectSquadBindings.entries()].map(([, value]) => value).filter((binding) => projectIds.has(binding.projectId)).sort(byUpdatedAt),
      projectAgentMembershipSources: [...this.projectAgentMembershipSources.entries()].map(([, value]) => value).filter((source) => projectIds.has(source.projectId)).sort(byUpdatedAt),
      featureUsageDaily: [...this.featureUsageDaily.entries()].map(([, value]) => value).sort((left, right) => right.date.localeCompare(left.date) || left.feature.localeCompare(right.feature)),
      planSnapshots: [...this.planSnapshots.entries()].map(([, value]) => value).filter((snapshot) => projectIds.has(snapshot.projectId)).sort((left, right) => right.createdAt.localeCompare(left.createdAt)),
      requirementBundles: [...this.requirementBundles.entries()].map(([, value]) => value).filter((bundle) => projectIds.has(bundle.projectId)).sort((left, right) => right.createdAt.localeCompare(left.createdAt)),
      requirementItems: [...this.requirementItems.entries()].map(([, value]) => value).filter((item) => projectIds.has(item.projectId)).sort((left, right) => right.createdAt.localeCompare(left.createdAt)),
      requirementDecisions: [...this.requirementDecisions.entries()].map(([, value]) => value).filter((decision) => projectIds.has(decision.projectId)).sort((left, right) => right.createdAt.localeCompare(left.createdAt)),
      acceptanceCriteria: [...this.acceptanceCriteria.entries()].map(([, value]) => value).filter((criterion) => projectIds.has(criterion.projectId)).sort((left, right) => right.createdAt.localeCompare(left.createdAt)),
      verificationEvidence: [...this.verificationEvidence.entries()].map(([, value]) => value).filter((evidence) => projectIds.has(evidence.projectId)).sort((left, right) => right.createdAt.localeCompare(left.createdAt)),
      projectReviews: [...this.projectReviews.entries()].map(([, value]) => value).filter((review) => projectIds.has(review.projectId)).sort((left, right) => right.createdAt.localeCompare(left.createdAt)),
      deliveryRecords: [...this.deliveryRecords.entries()].map(([, value]) => value).filter((record) => projectIds.has(record.projectId)).sort((left, right) => right.createdAt.localeCompare(left.createdAt)),
      runtimeOverview: {
        defaultHost: { id: 'default-host', name: '本机默认环境', status: 'unstable', capabilities: [], boundAgentCount: [...this.agents.entries()].filter(([, agent]) => agent.status === 'active' && agent.runtimeId === undefined).length },
        customCount: runtimes.filter((runtime) => runtime.lifecycle === 'active').length,
        abnormalCount: runtimes.filter((runtime) => runtime.lifecycle === 'active' && runtime.status !== 'online').length,
        archivedCount: runtimes.filter((runtime) => runtime.lifecycle === 'archived').length,
      },
      inbox: [],
      agentWorkloads: [],
      runStatistics: [],
    }
  }

  projectTasks(project: ProjectRecord): TaskRecord[] {
    if (new Set(project.taskIds).size !== project.taskIds.length) {
      throw new WorkflowError('inconsistent-plan', `Project "${project.id}" contains duplicate task pointers.`, 500)
    }
    return project.taskIds
      .map((id) => {
        const task = this.tasks.get(id)
        if (task === undefined) {
          throw new WorkflowError('inconsistent-plan', `Project "${project.id}" references missing task "${id}".`, 500)
        }
        if (task.projectId !== project.id) {
          throw new WorkflowError('inconsistent-plan', `Task "${id}" does not belong to project "${project.id}".`, 500)
        }
        return task
      })
      .sort((left, right) => left.ordinal - right.ordinal)
  }

  approvalFor(project: ProjectRecord): ApprovalRecord | undefined {
    return this.approvals.get(`${project.id}:${project.revision}`)
  }
}

function optionalTable<T>(domain: Domain<typeof orchestratorDomain>, name: string): any {
  try {
    const table = (domain as any).table(name)
    if (table === undefined) throw new Error(`missing table ${name}`)
    return table
  } catch {
    return {
      __unavailable: true,
      get: () => undefined,
      entries: () => [][Symbol.iterator](),
      put: async () => { throw new WorkflowError('storage-table-unavailable', `Storage table "${name}" is unavailable in this legacy test domain.`, 503) },
      delete: async () => false,
    } as any
  }
}

function byUpdatedAt<T extends { updatedAt: string }>(left: T, right: T): number {
  return right.updatedAt.localeCompare(left.updatedAt)
}

function byCreatedAt<T extends { createdAt: string }>(left: T, right: T): number {
  return right.createdAt.localeCompare(left.createdAt)
}
