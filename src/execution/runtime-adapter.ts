import { randomUUID } from 'node:crypto'
import { WorkflowError } from '../workflow.js'

export interface RuntimePrepareRequest<TPayload = unknown> {
  taskRunId: string
  cwd: string
  contractDigest: string
  payload: TPayload
}

export interface RuntimeArtifact {
  kind: string
  name: string
  uri?: string
  contentDigest?: string
}

export interface RuntimeObservation<TResult = unknown> {
  executionId: string
  taskRunId: string
  status: 'prepared' | 'running' | 'succeeded' | 'failed' | 'cancelled'
  result?: TResult
  error?: string
}

export interface RuntimeAdapter<TPayload = unknown, TResult = unknown> {
  readonly id: string
  readonly kind: 'inline' | 'daemon'
  prepare(request: RuntimePrepareRequest<TPayload>): Promise<RuntimeObservation<TResult>>
  start(executionId: string): Promise<void>
  observe(executionId: string): Promise<RuntimeObservation<TResult>>
  cancel(executionId: string, reason: string): Promise<void>
  collectArtifacts(executionId: string): Promise<RuntimeArtifact[]>
}

interface InlineExecution<TPayload, TResult> {
  request: RuntimePrepareRequest<TPayload>
  observation: RuntimeObservation<TResult>
  controller: AbortController
  artifacts: RuntimeArtifact[]
}

export class InlineRuntimeAdapter<TPayload = unknown, TResult = unknown> implements RuntimeAdapter<TPayload, TResult> {
  readonly id = 'inline-runtime'
  readonly kind = 'inline' as const
  private readonly executions = new Map<string, InlineExecution<TPayload, TResult>>()

  constructor(private readonly executor: (request: RuntimePrepareRequest<TPayload>, signal: AbortSignal) => Promise<{ result: TResult; artifacts?: RuntimeArtifact[] }>) {}

  async prepare(request: RuntimePrepareRequest<TPayload>): Promise<RuntimeObservation<TResult>> {
    if (!request.taskRunId || !request.cwd || !/^[a-f0-9]{64}$/u.test(request.contractDigest)) throw new WorkflowError('runtime-prepare-invalid', 'Runtime preparation requires a TaskRun, cwd, and frozen contract digest.', 400)
    const executionId = randomUUID()
    const observation: RuntimeObservation<TResult> = { executionId, taskRunId: request.taskRunId, status: 'prepared' }
    this.executions.set(executionId, { request, observation, controller: new AbortController(), artifacts: [] })
    return observation
  }

  async start(executionId: string): Promise<void> {
    const execution = this.require(executionId)
    if (execution.observation.status !== 'prepared') throw new WorkflowError('runtime-state-conflict', 'Only a prepared execution can start.', 409)
    execution.observation = { ...execution.observation, status: 'running' }
    void this.executor(execution.request, execution.controller.signal).then(({ result, artifacts = [] }) => {
      if (execution.observation.status === 'cancelled') return
      execution.artifacts = artifacts
      execution.observation = { ...execution.observation, status: 'succeeded', result }
    }, (error) => {
      if (execution.observation.status === 'cancelled') return
      execution.observation = { ...execution.observation, status: 'failed', error: error instanceof Error ? error.message : String(error) }
    })
  }

  async observe(executionId: string): Promise<RuntimeObservation<TResult>> {
    return structuredClone(this.require(executionId).observation)
  }

  async cancel(executionId: string, reason: string): Promise<void> {
    const execution = this.require(executionId)
    if (['succeeded', 'failed', 'cancelled'].includes(execution.observation.status)) return
    execution.controller.abort(new WorkflowError('cancelled', reason, 499))
    execution.observation = { ...execution.observation, status: 'cancelled', error: reason }
  }

  async collectArtifacts(executionId: string): Promise<RuntimeArtifact[]> {
    const execution = this.require(executionId)
    if (execution.observation.status !== 'succeeded') throw new WorkflowError('runtime-artifacts-unavailable', 'Artifacts are available only after successful execution.', 409)
    return structuredClone(execution.artifacts)
  }

  private require(executionId: string): InlineExecution<TPayload, TResult> {
    const execution = this.executions.get(executionId)
    if (execution === undefined) throw new WorkflowError('runtime-execution-not-found', 'Runtime execution was not found.', 404)
    return execution
  }
}
