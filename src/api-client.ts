import type { DomainEventPage, ProjectTeamImpact, Snapshot, TeamCollaborationMetrics } from './client-types.js'
import type { HistoryPage, IssueContext, ProjectOverview, ProjectReadiness, TaskRunArtifactBatch, WorkbenchBootstrap } from './query/service.js'
import type { RecoveryAction, RecoveryExecuteInput, RecoveryPreview } from './storage/reconciliation.js'
import type { StorageMutationIntentRecord, StorageRecoveryAttemptRecord } from './types.js'
import type { NativeDiagnostics } from './native/types.js'
import type { NativeIntegrationService } from './native/service.js'
/** 只读原生状态契约与服务端保持一致；不包含任何远端写操作。 */
export type PullRequestStatus = ReturnType<NativeIntegrationService['status']>

/** 按需获取 Host 能力，服务存在性和 provider 就绪分别呈现。 */
export async function loadNativeDiagnostics(signal?: AbortSignal): Promise<NativeDiagnostics> {
  return request('/native-capabilities', signal === undefined ? undefined : { signal })
}

/** 读取项目 PR 状态，轮询实际由 Forge 共享。 */
export async function loadPullRequestStatus(projectId: string, signal?: AbortSignal): Promise<PullRequestStatus> {
  return request(`/projects/${encodeURIComponent(projectId)}/pull-request`, signal === undefined ? undefined : { signal })
}

/** 完整 checks 或精确 head diff 的显式读取，调用结束不改变项目状态。 */
export async function loadPullRequestEvidence(projectId: string, kind: 'checks' | 'diff', signal?: AbortSignal): Promise<unknown> {
  return request(`/projects/${encodeURIComponent(projectId)}/pull-request/${kind}`, signal === undefined ? undefined : { signal })
}

export type { HistoryPage, IssueContext, ProjectOverview, ProjectReadiness, RecoveryAction, RecoveryExecuteInput, RecoveryPreview, StorageMutationIntentRecord, StorageRecoveryAttemptRecord, TaskRunArtifactBatch, WorkbenchBootstrap }

const API = '/project-orchestrator/api'

export class ApiError extends Error {
  constructor(message: string, readonly code: string, readonly status: number, readonly details?: unknown) {
    super(message)
    this.name = 'ApiError'
  }
}

export async function loadSnapshot(signal?: AbortSignal): Promise<Snapshot> {
  return request<Snapshot>('/snapshot', signal === undefined ? undefined : { signal })
}

export async function loadWorkbenchBootstrap(signal?: AbortSignal): Promise<WorkbenchBootstrap> {
  return request<WorkbenchBootstrap>('/bootstrap', signal === undefined ? undefined : { signal })
}

export async function loadDomainEvents(after: string, signal?: AbortSignal): Promise<DomainEventPage> {
  return request<DomainEventPage>(`/events?after=${encodeURIComponent(after)}&limit=500`, signal === undefined ? undefined : { signal })
}

export async function loadProjectReadiness(projectId: string, signal?: AbortSignal): Promise<ProjectReadiness> {
  return request<ProjectReadiness>(`/projects/${encodeURIComponent(projectId)}/readiness`, signal === undefined ? undefined : { signal })
}

export async function loadProjectOverview(projectId: string, signal?: AbortSignal): Promise<ProjectOverview> {
  return request<ProjectOverview>(`/projects/${encodeURIComponent(projectId)}/overview`, signal === undefined ? undefined : { signal })
}

export async function loadProjectHistory<T>(projectId: string, kind: 'task-runs' | 'planning-operations', cursor?: string, limit = 50, signal?: AbortSignal): Promise<HistoryPage<T>> {
  const query = new URLSearchParams({ kind, limit: String(limit) })
  if (cursor !== undefined) query.set('cursor', cursor)
  return request<HistoryPage<T>>(`/projects/${encodeURIComponent(projectId)}/history?${query.toString()}`, signal === undefined ? undefined : { signal })
}

export async function loadIssueContext(issueId: string, signal?: AbortSignal): Promise<IssueContext> {
  return request<IssueContext>(`/issues/${encodeURIComponent(issueId)}/context`, signal === undefined ? undefined : { signal })
}

export async function loadTaskRunArtifacts(projectId: string, taskRunIds: string[], signal?: AbortSignal): Promise<TaskRunArtifactBatch> {
  const query = new URLSearchParams()
  for (const taskRunId of taskRunIds) query.append('taskRunId', taskRunId)
  return request<TaskRunArtifactBatch>(`/projects/${encodeURIComponent(projectId)}/task-run-artifacts?${query.toString()}`, signal === undefined ? undefined : { signal })
}

export async function loadStorageReconciliationIntents(projectId: string, signal?: AbortSignal): Promise<StorageMutationIntentRecord[]> {
  return request<StorageMutationIntentRecord[]>(`/admin/storage-reconciliation?projectId=${encodeURIComponent(projectId)}`, signal === undefined ? undefined : { signal })
}

export async function loadStorageReconciliationPreview(intentId: string, signal?: AbortSignal): Promise<RecoveryPreview> {
  return request<RecoveryPreview>(`/admin/storage-reconciliation/${encodeURIComponent(intentId)}/preview`, signal === undefined ? undefined : { signal })
}

export async function executeStorageReconciliation(intentId: string, body: RecoveryExecuteInput, signal?: AbortSignal): Promise<StorageRecoveryAttemptRecord> {
  return mutate<StorageRecoveryAttemptRecord>(`/admin/storage-reconciliation/${encodeURIComponent(intentId)}/execute`, 'POST', body, signal)
}

export async function loadProjectTeamPlan<T = unknown>(projectId: string, signal?: AbortSignal): Promise<T> {
  return request<T>(`/projects/${encodeURIComponent(projectId)}/team-plan`, signal === undefined ? undefined : { signal })
}

export async function loadProjectAgentCandidates<T = unknown>(projectId: string, taskId: string, signal?: AbortSignal): Promise<T> {
  return request<T>(`/projects/${encodeURIComponent(projectId)}/agent-candidates?taskId=${encodeURIComponent(taskId)}`, signal === undefined ? undefined : { signal })
}

export async function loadProjectTeamImpact(projectId: string, signal?: AbortSignal): Promise<ProjectTeamImpact> {
  return request<ProjectTeamImpact>(`/projects/${encodeURIComponent(projectId)}/team-impact`, signal === undefined ? undefined : { signal })
}

export async function loadTeamCollaborationMetrics(projectId?: string, signal?: AbortSignal): Promise<TeamCollaborationMetrics> {
  const path = projectId === undefined ? '/team-metrics' : `/projects/${encodeURIComponent(projectId)}/team-metrics`
  return request<TeamCollaborationMetrics>(path, signal === undefined ? undefined : { signal })
}

export async function validateProjectTeam<T = unknown>(projectId: string, signal?: AbortSignal): Promise<T> {
  return mutate<T>(`/projects/${encodeURIComponent(projectId)}/validate-team`, 'POST', {}, signal)
}

export async function reassignProjectTask<T = unknown>(projectId: string, body: unknown, signal?: AbortSignal): Promise<T> {
  return mutate<T>(`/projects/${encodeURIComponent(projectId)}/reassign-task`, 'POST', body, signal)
}

export async function resolveProjectTeamBlocker<T = unknown>(projectId: string, body: unknown, signal?: AbortSignal): Promise<T> {
  return mutate<T>(`/projects/${encodeURIComponent(projectId)}/resolve-team-blocker`, 'POST', body, signal)
}

export async function loadProjectPlanSnapshots<T = unknown>(projectId: string, signal?: AbortSignal): Promise<T> {
  return request<T>(`/projects/${encodeURIComponent(projectId)}/plan-snapshots`, signal === undefined ? undefined : { signal })
}

export async function reviseProjectDecomposition<T = unknown>(projectId: string, bundleId: string, body: unknown, signal?: AbortSignal): Promise<T> {
  return mutate<T>(`/projects/${encodeURIComponent(projectId)}/decompositions/${encodeURIComponent(bundleId)}/revise`, 'POST', body, signal)
}

export async function loadProjectRequirements<T = unknown>(projectId: string, signal?: AbortSignal): Promise<T> {
  return request<T>(`/projects/${encodeURIComponent(projectId)}/requirements`, signal === undefined ? undefined : { signal })
}

export async function loadProjectRequirementDecisions<T = unknown>(projectId: string, signal?: AbortSignal): Promise<T> {
  return request<T>(`/projects/${encodeURIComponent(projectId)}/requirement-decisions`, signal === undefined ? undefined : { signal })
}

export async function createProjectRequirementDecision<T = unknown>(projectId: string, body: unknown, signal?: AbortSignal): Promise<T> {
  return mutate<T>(`/projects/${encodeURIComponent(projectId)}/requirement-decisions`, 'POST', body, signal)
}

export async function resolveProjectRequirementDecision<T = unknown>(projectId: string, decisionId: string, body: unknown, signal?: AbortSignal): Promise<T> {
  return mutate<T>(`/projects/${encodeURIComponent(projectId)}/requirement-decisions/${encodeURIComponent(decisionId)}/resolve`, 'POST', body, signal)
}

export async function loadProjectDelivery<T = unknown>(projectId: string, signal?: AbortSignal): Promise<T> {
  return request<T>(`/projects/${encodeURIComponent(projectId)}/delivery`, signal === undefined ? undefined : { signal })
}

export async function confirmProjectDelivery<T = unknown>(projectId: string, body: { actor: string; note?: string }, signal?: AbortSignal): Promise<T> {
  return mutate<T>(`/projects/${encodeURIComponent(projectId)}/delivery/confirm`, 'POST', body, signal)
}

export async function resolveProjectReview<T = unknown>(projectId: string, body: unknown, signal?: AbortSignal): Promise<T> {
  return mutate<T>(`/projects/${encodeURIComponent(projectId)}/review/resolve`, 'POST', body, signal)
}

export async function closeProjectDelivery<T = unknown>(projectId: string, body: { actor: string; note?: string }, signal?: AbortSignal): Promise<T> {
  return mutate<T>(`/projects/${encodeURIComponent(projectId)}/delivery/close`, 'POST', body, signal)
}

export async function mutate<T>(path: string, method: 'POST' | 'PUT' | 'DELETE', body?: unknown, signal?: AbortSignal): Promise<T> {
  return request<T>(path, {
    method,
    headers: { 'content-type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    ...(signal === undefined ? {} : { signal }),
  })
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API}${path}`, init)
  const payload = await response.json() as T | { error?: { code?: string; message?: string; details?: unknown } }
  if (!response.ok) {
    const message = typeof payload === 'object' && payload !== null && 'error' in payload
      ? payload.error?.message
      : undefined
    const error = typeof payload === 'object' && payload !== null && 'error' in payload ? payload.error : undefined
    throw new ApiError(message || `Request failed with status ${response.status}.`, error?.code ?? 'request-failed', response.status, error?.details)
  }
  return payload as T
}
