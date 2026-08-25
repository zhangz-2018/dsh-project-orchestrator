import type { ProjectTeamImpact, Snapshot, TeamCollaborationMetrics } from './client-types.js'

const API = '/project-orchestrator/api'

export async function loadSnapshot(signal?: AbortSignal): Promise<Snapshot> {
  return request<Snapshot>('/snapshot', signal === undefined ? undefined : { signal })
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
  const payload = await response.json() as T | { error?: { message?: string } }
  if (!response.ok) {
    const message = typeof payload === 'object' && payload !== null && 'error' in payload
      ? payload.error?.message
      : undefined
    throw new Error(message || `Request failed with status ${response.status}.`)
  }
  return payload as T
}
