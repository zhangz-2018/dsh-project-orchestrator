import { lstat } from 'node:fs/promises'
import { join } from 'node:path'
import type { OrchestratorStore } from '../storage.js'
import type {
  ActivityEvent, AgentCapabilityClaimRecord, ArtifactRecord, DeliveryRecord, PlanningOperationRecord, ProjectAgentMembershipRecord, ProjectRecord,
  ProjectReviewRecord, RepositoryStackProfileRecord, RequirementDecisionRecord, ResourceAccessGrantRecord, Snapshot,
  TaskRunRecord, TranscriptEntry, VerificationEvidenceRecord,
} from '../types.js'
import { WorkflowError } from '../workflow.js'

export type ReadinessStatus = 'ready' | 'blocked' | 'unknown' | 'not_applicable'
export type ProjectActionCode = 'reconcile_storage' | 'resolve_requirement_decision' | 'inspect_readiness' | 'review_plan' | 'start_execution' | 'inspect_execution' | 'review_delivery' | 'confirm_delivery' | 'none'

export interface ReadinessCheck {
  code: string
  status: ReadinessStatus
  phase: 'planning' | 'execution'
  reason: string
  subjectIds: string[]
  actionCode?: ProjectActionCode
}

export interface ProjectReadiness {
  projectId: string
  projectRevision: number
  checkedAt: string
  planningReadiness: { status: ReadinessStatus; checks: ReadinessCheck[] }
  executionPreparation: { status: ReadinessStatus; checks: ReadinessCheck[] }
}

export interface ProjectOverview {
  projectId: string
  projectRevision: number
  status: ProjectRecord['status']
  deliveryStage?: ProjectRecord['deliveryStage']
  conclusionCode: string
  nextAction: { code: ProjectActionCode; subjectId?: string }
  blockers: Array<{ code: string; subjectIds: string[] }>
  currentPlanSnapshotId?: string
  activePlanningOperationId?: string
  latestPlanningOperation?: { id: string; status: PlanningOperationRecord['status']; stage: PlanningOperationRecord['stage']; updatedAt: string }
  counts: { tasks: number; activeTaskRuns: number; failedTaskRuns: number; passedEvidence: number; failedEvidence: number; unresolvedIntents: number; pendingDecisions: number }
  updatedAt: string
}

export interface HistoryPage<T> {
  items: T[]
  nextCursor?: string
  hasMore: boolean
  watermark: string
}

export interface WorkbenchBootstrap {
  schemaVersion: 1
  snapshot: Snapshot
  totals: {
    taskRuns: number
    activity: number
    transcripts: number
    artifacts: number
  }
}

export interface IssueContext {
  issueId: string
  taskRuns: TaskRunRecord[]
  activity: ActivityEvent[]
  transcripts: TranscriptEntry[]
  artifacts: ArtifactRecord[]
  totals: { taskRuns: number; activity: number; transcripts: number; artifacts: number }
  truncated: boolean
}

export interface TaskRunArtifactBatch {
  projectId: string
  taskRunIds: string[]
  items: ArtifactRecord[]
  total: number
  truncatedTaskRunIds: string[]
}

interface Cursor { watermark: string; after?: string }
type HistoryKind = 'task-runs' | 'planning-operations'

function values<T>(table: { entries(): IterableIterator<[string, T]> }): T[] {
  return [...table.entries()].map(([, value]) => value)
}

function aggregateStatus(checks: ReadinessCheck[]): ReadinessStatus {
  if (checks.some((check) => check.status === 'blocked')) return 'blocked'
  if (checks.some((check) => check.status === 'unknown')) return 'unknown'
  if (checks.some((check) => check.status === 'ready')) return 'ready'
  return 'not_applicable'
}

function historyKey(record: { createdAt: string; id: string }): string {
  return `${record.createdAt}\u0000${record.id}`
}

function encodeCursor(cursor: Cursor): string {
  return Buffer.from(JSON.stringify(cursor), 'utf8').toString('base64url')
}

function decodeCursor(raw: string | undefined): Cursor | undefined {
  if (raw === undefined) return undefined
  try {
    const value = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8')) as Cursor
    if (typeof value.watermark !== 'string' || (value.after !== undefined && typeof value.after !== 'string')) throw new Error('invalid cursor')
    return value
  } catch {
    throw new WorkflowError('query-cursor-invalid', 'The history cursor is invalid.', 400)
  }
}

const TERMINAL_TASK_RUN_STATUSES = new Set<TaskRunRecord['status']>(['completed', 'failed', 'cancelled'])
const BOOTSTRAP_OMITTED_KEYS = [
  'domainEvents', 'verificationEvidence', 'verificationSpecs', 'verificationInvocations', 'planningOperations',
  'planningMetricPolicies', 'planningMetricPolicyPublishes', 'planningShadowEvaluations', 'planningStageAttempts',
  'planningCheckpoints', 'storageMutationIntents', 'storageMutationPayloads', 'storageRecoveryAttempts',
  'planningSourceInputs', 'requirementSourceProfiles', 'requirementSourceManifests', 'requirementAnalysisProposals',
  'planningRepairAttempts', 'sourceDispositionBindings', 'acceptanceScenarios', 'acceptanceScenarioCoveragePolicies',
  'planningRiskProfiles', 'sourcePolicyPrechecks', 'requirementDecisionOptionEffects', 'requirementDecisionPlanningEffects',
  'scenarioCoverageReviews', 'planningReviewsV3', 'requirementCodeBindings', 'repositorySnapshotsV3',
  'repositoryStackProfiles', 'repositoryEvidenceRetrievalReports', 'canonicalTargetBindings', 'repositoryPolicyBaselines',
  'policyConstraintsV3', 'planningPolicySnapshots', 'planningPromptReferenceManifests', 'planningProposalPacks',
  'planningReferenceMaps', 'policyFulfillments', 'capabilityDefinitions', 'agentCapabilityClaims',
  'projectCapabilityCatalogSnapshots', 'resourceAccessGrants', 'projectAccessGrantSnapshots',
  'capabilityRequirementDrafts', 'assignmentDrafts', 'assignmentEvaluations', 'expectedAssignmentFixtures',
  'planningMetricReleaseReportCreates', 'planningMetricReleaseReports', 'taskPreflightsV3', 'planApprovalsV3',
  'executionDispatches', 'deliveryIntegrationIntents', 'deliveryIntegrationSnapshots', 'integrationInclusionEvidence', 'deliveryConvergenceFindings',
  'deliveryConvergenceReviews', 'convergenceRepairBaselines', 'convergenceRepairCarryItems', 'convergenceCarryValidations',
] as const satisfies ReadonlyArray<keyof Snapshot>

function newestByKey<T extends { id: string }>(records: T[], keys: (record: T) => Array<string | undefined>, perKey: number, timestamp: (record: T) => string): T[] {
  const counts = new Map<string, number>()
  const selected = new Map<string, T>()
  for (const record of [...records].sort((left, right) => timestamp(right).localeCompare(timestamp(left)) || right.id.localeCompare(left.id))) {
    for (const key of keys(record)) {
      if (key === undefined || (counts.get(key) ?? 0) >= perKey) continue
      counts.set(key, (counts.get(key) ?? 0) + 1)
      selected.set(record.id, record)
    }
  }
  return [...selected.values()].sort((left, right) => timestamp(right).localeCompare(timestamp(left)) || right.id.localeCompare(left.id))
}

function bootstrapTaskRuns(snapshot: Snapshot): TaskRunRecord[] {
  const referenced = new Set<string>([
    ...snapshot.issues.flatMap((issue) => issue.activeTaskRunId === undefined ? [] : [issue.activeTaskRunId]),
    ...snapshot.decisions.flatMap((decision) => decision.taskRunId === undefined ? [] : [decision.taskRunId]),
    ...snapshot.delegations.flatMap((delegation) => delegation.taskRunId === undefined ? [] : [delegation.taskRunId]),
  ])
  const selected = new Map(newestByKey(snapshot.taskRuns, (run) => [`project:${run.projectId}`, run.issueId === undefined ? undefined : `issue:${run.issueId}`, run.taskId === undefined ? undefined : `task:${run.taskId}`], 1, (run) => run.createdAt).map((run) => [run.id, run]))
  for (const run of snapshot.taskRuns) {
    if (!TERMINAL_TASK_RUN_STATUSES.has(run.status) || referenced.has(run.id)) selected.set(run.id, run)
  }
  return [...selected.values()].sort((left, right) => right.createdAt.localeCompare(left.createdAt) || right.id.localeCompare(left.id))
}

export function buildWorkbenchBootstrap(snapshot: Snapshot): WorkbenchBootstrap {
  const taskRuns = bootstrapTaskRuns(snapshot)
  const activity = newestByKey(snapshot.activity, (event) => [event.issueId === undefined ? undefined : `issue:${event.issueId}`, event.projectId === undefined ? 'workspace' : `project:${event.projectId}`], 5, (event) => event.createdAt)
  const comments = newestByKey(snapshot.comments, (comment) => [`issue:${comment.issueId}`], 50, (comment) => comment.createdAt)
  const currentPlanSnapshotIds = new Set(snapshot.projects.flatMap((project) => project.currentPlanSnapshotId === undefined ? [] : [project.currentPlanSnapshotId]))
  const planSnapshots = (snapshot.planSnapshots ?? []).filter((record) => currentPlanSnapshotIds.has(record.id))
  const currentBundleIds = new Set(planSnapshots.flatMap((record) => record.requirementBundleIds ?? []))
  const currentRevisions = new Map(snapshot.projects.map((project) => [project.id, project.revision]))
  const bounded: Snapshot = {
    ...snapshot,
    approvals: newestByKey(snapshot.approvals, (approval) => [`project:${approval.projectId}`], 2, (approval) => approval.approvedAt),
    runs: newestByKey(snapshot.runs, (run) => [`project:${run.projectId}`], 1, (run) => run.createdAt),
    taskRuns,
    activity,
    comments,
    decisions: newestByKey(snapshot.decisions.filter((decision) => decision.status === 'pending' || decision.status === 'deferred'), (decision) => [decision.issueId === undefined ? undefined : `issue:${decision.issueId}`, decision.projectId === undefined ? 'workspace' : `project:${decision.projectId}`], 20, (decision) => decision.createdAt),
    transcripts: [],
    artifacts: [],
    commands: [],
    externalTriggers: [],
    runStatistics: snapshot.runStatistics.filter((statistic) => taskRuns.some((run) => run.id === statistic.taskRunId)),
    planSnapshots,
    requirementBundles: (snapshot.requirementBundles ?? []).filter((record) => currentBundleIds.has(record.id)),
    requirementItems: (snapshot.requirementItems ?? []).filter((record) => currentBundleIds.has(record.bundleId)),
    requirementDecisions: (snapshot.requirementDecisions ?? []).filter((record) => (record.bundleId !== undefined && currentBundleIds.has(record.bundleId)) || record.status === 'pending' || record.status === 'deferred'),
    acceptanceCriteria: (snapshot.acceptanceCriteria ?? []).filter((record) => currentBundleIds.has(record.bundleId)),
    projectReviews: (snapshot.projectReviews ?? []).filter((record) => currentRevisions.get(record.projectId) === record.revision),
    deliveryRecords: (snapshot.deliveryRecords ?? []).filter((record) => currentRevisions.get(record.projectId) === record.revision),
  }
  for (const key of BOOTSTRAP_OMITTED_KEYS) delete bounded[key]
  return {
    schemaVersion: 1,
    snapshot: bounded,
    totals: { taskRuns: snapshot.taskRuns.length, activity: snapshot.activity.length, transcripts: snapshot.transcripts.length, artifacts: snapshot.artifacts.length },
  }
}

export class QueryService {
  constructor(private readonly store: OrchestratorStore) {}

  async projectReadiness(projectId: string, modelAvailable: boolean): Promise<ProjectReadiness> {
    const project = this.requireProject(projectId)
    const unresolved = this.store.unresolvedStorageMutationIntents(projectId)
    const unresolvedIntegration = this.store.unresolvedDeliveryIntegrationIntents(projectId)
    const members = values<ProjectAgentMembershipRecord>(this.store.projectAgentMemberships).filter((item) => item.projectId === projectId && item.status === 'active' && item.autoAssignable)
    const activeClaims = values<AgentCapabilityClaimRecord>(this.store.agentCapabilityClaims).filter((item) => (item.projectId === undefined || item.projectId === projectId) && item.status === 'active')
    const activeGrants = values<ResourceAccessGrantRecord>(this.store.resourceAccessGrants).filter((item) => item.projectId === projectId && item.revokedAt === undefined && (item.expiresAt === undefined || Date.parse(item.expiresAt) > Date.now()))
    const currentProfile = values<RepositoryStackProfileRecord>(this.store.repositoryStackProfiles).filter((item) => item.projectId === projectId).sort((left, right) => right.createdAt.localeCompare(left.createdAt))[0]
    let repositoryStatus: ReadinessStatus = 'ready'
    let repositoryReason = 'Repository path and Git metadata are readable.'
    try {
      if (!(await lstat(project.cwd)).isDirectory()) throw new Error('not a directory')
      await lstat(join(project.cwd, '.git'))
    } catch {
      repositoryStatus = 'blocked'
      repositoryReason = 'Repository path or Git metadata is unavailable.'
    }
    const planningChecks: ReadinessCheck[] = [
      { code: 'repository_readable', status: repositoryStatus, phase: 'planning', reason: repositoryReason, subjectIds: [project.cwd], ...(repositoryStatus === 'blocked' ? { actionCode: 'inspect_readiness' as const } : {}) },
      { code: 'model_route_available', status: modelAvailable ? 'ready' : 'blocked', phase: 'planning', reason: modelAvailable ? 'A planning model route is configured.' : 'No planning model route is configured.', subjectIds: [], ...(modelAvailable ? {} : { actionCode: 'inspect_readiness' as const }) },
      { code: 'project_team_available', status: members.length > 0 ? 'ready' : 'blocked', phase: 'planning', reason: members.length > 0 ? `${members.length} auto-assignable project members are available.` : 'No auto-assignable project member is available.', subjectIds: members.map((item) => item.agentId), ...(members.length > 0 ? {} : { actionCode: 'inspect_readiness' as const }) },
      { code: 'repository_stack_supported', status: currentProfile === undefined ? 'unknown' : currentProfile.supportStatus === 'supported' ? 'ready' : 'blocked', phase: 'planning', reason: currentProfile === undefined ? 'Repository stack support has not been frozen by Planning yet.' : `Repository stack support is ${currentProfile.supportStatus}.`, subjectIds: currentProfile === undefined ? [] : [currentProfile.id], ...(currentProfile?.supportStatus === 'unsupported' || currentProfile?.supportStatus === 'partial' ? { actionCode: 'inspect_readiness' as const } : {}) },
      { code: 'storage_consistent', status: unresolved.length === 0 ? 'ready' : 'blocked', phase: 'planning', reason: unresolved.length === 0 ? 'No unresolved storage mutation exists.' : `${unresolved.length} storage mutation intents require reconciliation.`, subjectIds: unresolved.map((intent) => intent.id), ...(unresolved.length === 0 ? {} : { actionCode: 'reconcile_storage' as const }) },
      { code: 'delivery_integration_consistent', status: unresolvedIntegration.length === 0 ? 'ready' : 'blocked', phase: 'planning', reason: unresolvedIntegration.length === 0 ? 'No unresolved Delivery Integration transition exists.' : `${unresolvedIntegration.length} Delivery Integration intents require reconciliation.`, subjectIds: unresolvedIntegration.map((intent) => intent.id), ...(unresolvedIntegration.length === 0 ? {} : { actionCode: 'review_delivery' as const }) },
    ]
    const executionChecks: ReadinessCheck[] = [
      { code: 'storage_consistent', status: unresolved.length === 0 ? 'ready' : 'blocked', phase: 'execution', reason: unresolved.length === 0 ? 'No unresolved storage mutation exists.' : 'Execution is blocked until storage reconciliation completes.', subjectIds: unresolved.map((intent) => intent.id), ...(unresolved.length === 0 ? {} : { actionCode: 'reconcile_storage' as const }) },
      { code: 'delivery_integration_consistent', status: unresolvedIntegration.length === 0 ? 'ready' : 'blocked', phase: 'execution', reason: unresolvedIntegration.length === 0 ? 'No unresolved Delivery Integration transition exists.' : 'Execution is blocked until Delivery Integration reconciliation completes.', subjectIds: unresolvedIntegration.map((intent) => intent.id), ...(unresolvedIntegration.length === 0 ? {} : { actionCode: 'review_delivery' as const }) },
      { code: 'trusted_capabilities_available', status: activeClaims.length > 0 ? 'ready' : project.taskIds.length === 0 ? 'not_applicable' : 'blocked', phase: 'execution', reason: activeClaims.length > 0 ? `${activeClaims.length} active trusted capability claims are available.` : 'No active trusted capability claim is available.', subjectIds: activeClaims.map((claim) => claim.id), ...(activeClaims.length > 0 || project.taskIds.length === 0 ? {} : { actionCode: 'inspect_readiness' as const }) },
      { code: 'resource_access_available', status: activeGrants.length > 0 ? 'ready' : project.taskIds.length === 0 ? 'not_applicable' : 'blocked', phase: 'execution', reason: activeGrants.length > 0 ? `${activeGrants.length} active resource grants are available.` : 'No active resource access grant is available.', subjectIds: activeGrants.map((grant) => grant.id), ...(activeGrants.length > 0 || project.taskIds.length === 0 ? {} : { actionCode: 'inspect_readiness' as const }) },
      { code: 'current_plan_available', status: project.currentPlanSnapshotId === undefined ? 'blocked' : 'ready', phase: 'execution', reason: project.currentPlanSnapshotId === undefined ? 'No current plan snapshot is available.' : 'A current plan snapshot is available.', subjectIds: project.currentPlanSnapshotId === undefined ? [] : [project.currentPlanSnapshotId], ...(project.currentPlanSnapshotId === undefined ? { actionCode: 'review_plan' as const } : {}) },
    ]
    return { projectId, projectRevision: project.revision, checkedAt: new Date().toISOString(), planningReadiness: { status: aggregateStatus(planningChecks), checks: planningChecks }, executionPreparation: { status: aggregateStatus(executionChecks), checks: executionChecks } }
  }

  projectOverview(projectId: string): ProjectOverview {
    const project = this.requireProject(projectId)
    const unresolved = this.store.unresolvedStorageMutationIntents(projectId)
    const unresolvedIntegration = this.store.unresolvedDeliveryIntegrationIntents(projectId)
    const decisions = values<RequirementDecisionRecord>(this.store.requirementDecisions).filter((item) => item.projectId === projectId && item.status === 'pending')
    const taskRuns = values<TaskRunRecord>(this.store.taskRuns).filter((item) => item.projectId === projectId)
    const evidence = values<VerificationEvidenceRecord>(this.store.verificationEvidence).filter((item) => item.projectId === projectId)
    const operations = values<PlanningOperationRecord>(this.store.planningOperations).filter((item) => item.projectId === projectId).sort((left, right) => right.updatedAt.localeCompare(left.updatedAt) || right.id.localeCompare(left.id))
    const reviews = values<ProjectReviewRecord>(this.store.projectReviews).filter((item) => item.projectId === projectId).sort((left, right) => right.createdAt.localeCompare(left.createdAt))
    const deliveries = values<DeliveryRecord>(this.store.deliveryRecords).filter((item) => item.projectId === projectId).sort((left, right) => right.createdAt.localeCompare(left.createdAt))
    const activeRuns = taskRuns.filter((item) => !['completed', 'failed', 'cancelled'].includes(item.status))
    const failedRuns = taskRuns.filter((item) => item.status === 'failed')
    let conclusionCode = 'project_ready_for_next_step'
    let nextAction: ProjectOverview['nextAction'] = { code: 'none' }
    const blockers: ProjectOverview['blockers'] = []
    if (unresolved.length > 0) {
      conclusionCode = 'storage_reconciliation_required'; nextAction = { code: 'reconcile_storage', subjectId: unresolved[0]!.id }; blockers.push({ code: 'storage-needs-reconciliation', subjectIds: unresolved.map((item) => item.id) })
    } else if (unresolvedIntegration.length > 0) {
      conclusionCode = 'delivery_integration_reconciliation_required'; nextAction = { code: 'review_delivery', subjectId: unresolvedIntegration[0]!.id }; blockers.push({ code: 'delivery-integration-needs-reconciliation', subjectIds: unresolvedIntegration.map((item) => item.id) })
    } else if (decisions.length > 0) {
      conclusionCode = 'requirement_decision_required'; nextAction = { code: 'resolve_requirement_decision', subjectId: decisions[0]!.id }; blockers.push({ code: 'requirement-decision-pending', subjectIds: decisions.map((item) => item.id) })
    } else if (project.status === 'draft') {
      conclusionCode = 'planning_not_started'; nextAction = { code: 'inspect_readiness' }
    } else if (project.status === 'decomposing') {
      conclusionCode = 'planning_in_progress'; nextAction = { code: 'none' }
    } else if (project.status === 'awaiting_approval') {
      conclusionCode = 'plan_review_required'; nextAction = { code: 'review_plan', ...(project.currentPlanSnapshotId === undefined ? {} : { subjectId: project.currentPlanSnapshotId }) }
    } else if (project.status === 'approved') {
      conclusionCode = 'execution_ready'; nextAction = { code: 'start_execution' }
    } else if (project.status === 'running') {
      conclusionCode = failedRuns.length > 0 ? 'execution_failure_requires_attention' : 'execution_in_progress'; nextAction = { code: 'inspect_execution', ...(project.activeRunId === undefined ? {} : { subjectId: project.activeRunId }) }
    } else if (project.deliveryStage === 'review' || reviews[0]?.status === 'pending') {
      conclusionCode = 'delivery_review_required'; nextAction = { code: 'review_delivery', ...(reviews[0] === undefined ? {} : { subjectId: reviews[0].id }) }
    } else if (project.deliveryStage === 'delivery_ready' || deliveries[0]?.status === 'ready') {
      conclusionCode = 'delivery_confirmation_required'; nextAction = { code: 'confirm_delivery', ...(deliveries[0] === undefined ? {} : { subjectId: deliveries[0].id }) }
    }
    const latest = operations[0]
    return {
      projectId, projectRevision: project.revision, status: project.status, ...(project.deliveryStage === undefined ? {} : { deliveryStage: project.deliveryStage }), conclusionCode, nextAction, blockers,
      ...(project.currentPlanSnapshotId === undefined ? {} : { currentPlanSnapshotId: project.currentPlanSnapshotId }),
      ...(project.activePlanningOperationId === undefined ? {} : { activePlanningOperationId: project.activePlanningOperationId }),
      ...(latest === undefined ? {} : { latestPlanningOperation: { id: latest.id, status: latest.status, stage: latest.stage, updatedAt: latest.updatedAt } }),
      counts: { tasks: project.taskIds.length, activeTaskRuns: activeRuns.length, failedTaskRuns: failedRuns.length, passedEvidence: evidence.filter((item) => item.status === 'passed').length, failedEvidence: evidence.filter((item) => item.status === 'failed').length, unresolvedIntents: unresolved.length + unresolvedIntegration.length, pendingDecisions: decisions.length },
      updatedAt: project.updatedAt,
    }
  }

  projectHistory(projectId: string, kind: HistoryKind, cursorRaw?: string, requestedLimit = 50): HistoryPage<TaskRunRecord | PlanningOperationRecord> {
    this.requireProject(projectId)
    const limit = Math.max(1, Math.min(100, Math.trunc(requestedLimit)))
    const records: Array<TaskRunRecord | PlanningOperationRecord> = (kind === 'task-runs' ? values<TaskRunRecord>(this.store.taskRuns) : values<PlanningOperationRecord>(this.store.planningOperations))
      .filter((item) => item.projectId === projectId)
      .sort((left, right) => historyKey(right).localeCompare(historyKey(left)))
    const cursor = decodeCursor(cursorRaw)
    const watermark = cursor?.watermark ?? (records[0] === undefined ? '' : historyKey(records[0]))
    const bounded = records.filter((item) => historyKey(item) <= watermark && (cursor?.after === undefined || historyKey(item) < cursor.after))
    const items = bounded.slice(0, limit)
    const hasMore = bounded.length > items.length
    const nextCursor = hasMore && items.length > 0 ? encodeCursor({ watermark, after: historyKey(items.at(-1)!) }) : undefined
    return { items, ...(nextCursor === undefined ? {} : { nextCursor }), hasMore, watermark }
  }

  issueContext(issueId: string): IssueContext {
    const issue = this.store.issues.get(issueId)
    if (issue === undefined) throw new WorkflowError('issue-not-found', 'Issue was not found.', 404)
    const allRuns = values<TaskRunRecord>(this.store.taskRuns).filter((run) => run.issueId === issueId).sort((left, right) => historyKey(right).localeCompare(historyKey(left)))
    const taskRuns = allRuns.slice(0, 100)
    const runIds = new Set(taskRuns.map((run) => run.id))
    const allRunIds = new Set(allRuns.map((run) => run.id))
    const allActivity = values<ActivityEvent>(this.store.activity).filter((event) => event.issueId === issueId).sort((left, right) => historyKey(right).localeCompare(historyKey(left)))
    const allTranscripts = values<TranscriptEntry>(this.store.transcripts).filter((entry) => allRunIds.has(entry.taskRunId))
    const allArtifacts = values<ArtifactRecord>(this.store.artifacts).filter((artifact) => artifact.issueId === issueId || (artifact.taskRunId !== undefined && allRunIds.has(artifact.taskRunId))).sort((left, right) => historyKey(right).localeCompare(historyKey(left)))
    const activity = allActivity.slice(0, 200)
    const transcripts = allTranscripts.filter((entry) => runIds.has(entry.taskRunId)).sort((left, right) => left.taskRunId.localeCompare(right.taskRunId) || left.sequence - right.sequence).slice(0, 1_000)
    const artifacts = allArtifacts.slice(0, 200)
    return {
      issueId,
      taskRuns,
      activity,
      transcripts,
      artifacts,
      totals: { taskRuns: allRuns.length, activity: allActivity.length, transcripts: allTranscripts.length, artifacts: allArtifacts.length },
      truncated: taskRuns.length < allRuns.length || activity.length < allActivity.length || transcripts.length < allTranscripts.length || artifacts.length < allArtifacts.length,
    }
  }

  taskRunArtifacts(projectId: string, taskRunIds: string[]): TaskRunArtifactBatch {
    this.requireProject(projectId)
    const uniqueIds = [...new Set(taskRunIds)]
    if (uniqueIds.length === 0 || uniqueIds.length > 100) throw new WorkflowError('task-run-query-invalid', 'Between 1 and 100 TaskRun ids are required.', 400)
    for (const id of uniqueIds) {
      const run = this.store.taskRuns.get(id)
      if (run === undefined || run.projectId !== projectId) throw new WorkflowError('task-run-context-mismatch', 'A requested TaskRun does not belong to the selected Project.', 400)
    }
    const requested = new Set(uniqueIds)
    const all = values<ArtifactRecord>(this.store.artifacts).filter((artifact) => artifact.taskRunId !== undefined && requested.has(artifact.taskRunId)).sort((left, right) => historyKey(right).localeCompare(historyKey(left)))
    const counts = new Map<string, number>()
    const items = all.filter((artifact) => {
      const id = artifact.taskRunId!
      const count = counts.get(id) ?? 0
      counts.set(id, count + 1)
      return count < 20
    })
    return { projectId, taskRunIds: uniqueIds, items, total: all.length, truncatedTaskRunIds: uniqueIds.filter((id) => (counts.get(id) ?? 0) > 20) }
  }

  taskRunTranscript(taskRunId: string): TranscriptEntry[] {
    if (this.store.taskRuns.get(taskRunId) === undefined) throw new WorkflowError('task-run-not-found', 'TaskRun was not found.', 404)
    return values<TranscriptEntry>(this.store.transcripts).filter((entry) => entry.taskRunId === taskRunId).sort((left, right) => left.sequence - right.sequence)
  }

  taskRunArtifactsById(taskRunId: string): ArtifactRecord[] {
    if (this.store.taskRuns.get(taskRunId) === undefined) throw new WorkflowError('task-run-not-found', 'TaskRun was not found.', 404)
    return values<ArtifactRecord>(this.store.artifacts).filter((artifact) => artifact.taskRunId === taskRunId).sort((left, right) => historyKey(right).localeCompare(historyKey(left)))
  }

  private requireProject(projectId: string): ProjectRecord {
    const project = this.store.projects.get(projectId)
    if (project === undefined) throw new WorkflowError('project-not-found', 'Project was not found.', 404)
    return project
  }
}
