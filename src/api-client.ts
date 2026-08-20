import type { Snapshot } from './client-types.js'

const API = '/project-orchestrator/api'

export async function loadSnapshot(signal?: AbortSignal): Promise<Snapshot> {
  return request<Snapshot>('/snapshot', signal === undefined ? undefined : { signal })
}

export async function mutate<T>(path: string, method: 'POST' | 'PUT' | 'DELETE', body?: unknown): Promise<T> {
  return request<T>(path, {
    method,
    headers: { 'content-type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
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
