import { createHash, randomUUID } from 'node:crypto'
import type { TaskRunRecord } from '../types.js'
import { digestObject, WorkflowError } from '../workflow.js'

export interface TaskRunTable {
  get(id: string): TaskRunRecord | undefined
  entries(): Iterable<[string, TaskRunRecord]>
  put(id: string, value: TaskRunRecord): Promise<void>
}

export interface ExecutionClaim {
  taskRun: TaskRunRecord
  claimToken: string
}

export interface ExecutionFailureClassification {
  code: 'runtime_unavailable' | 'dependency_failed' | 'contract_stale' | 'runtime_lost' | 'cancelled' | 'unexpected_internal'
  disposition: 'retryable' | 'non_retryable' | 'needs_reconciliation'
  status: 409 | 499 | 500 | 502
}

function taskRunClaimIdentityDigest(run: TaskRunRecord): string {
  return digestObject({
    taskRunId: run.id,
    projectId: run.projectId,
    issueId: run.issueId,
    taskId: run.taskId,
    runId: run.runId,
    agentId: run.agentId,
    runtimeId: run.runtimeId,
    planSnapshotId: run.planSnapshotId,
    deliveryTaskRevision: run.deliveryTaskRevision,
    assignmentRevision: run.assignmentRevision,
    assignmentDecisionId: run.assignmentDecisionId,
    assignmentDigest: run.assignmentDigest,
    planningRepositoryDigest: run.planningRepositoryDigest,
    planningPolicyDigest: run.planningPolicyDigest,
    accessGrantSnapshotDigest: run.accessGrantSnapshotDigest,
    canonicalTargetBindingDigest: run.canonicalTargetBindingDigest,
  })
}

export function taskRunExecutionContractDigest(run: TaskRunRecord): string {
  return digestObject({
    taskRunId: run.id,
    projectId: run.projectId,
    issueId: run.issueId,
    taskId: run.taskId,
    runId: run.runId,
    agentId: run.agentId,
    runtimeId: run.runtimeId,
    resourceId: run.resourceId,
    planSnapshotId: run.planSnapshotId,
    deliveryTaskRevision: run.deliveryTaskRevision,
    assignmentRevision: run.assignmentRevision,
    assignmentDecisionId: run.assignmentDecisionId,
    assignmentDigest: run.assignmentDigest,
    planningRepositoryDigest: run.planningRepositoryDigest,
    planningPolicyDigest: run.planningPolicyDigest,
    accessGrantSnapshotDigest: run.accessGrantSnapshotDigest,
    canonicalTargetBindingDigest: run.canonicalTargetBindingDigest,
    cwd: run.cwd,
    workspace: run.workspace,
    branch: run.branch,
    baseCommit: run.baseCommit,
  })
}

export function classifyExecutionFailure(error: unknown): ExecutionFailureClassification {
  if (error instanceof WorkflowError) {
    if (error.code === 'cancelled') return { code: 'cancelled', disposition: 'non_retryable', status: 499 }
    if (['runtime-offline', 'runtime-unavailable'].includes(error.code)) return { code: 'runtime_unavailable', disposition: 'retryable', status: 502 }
    if (error.code === 'dependency-failed') return { code: 'dependency_failed', disposition: 'retryable', status: 502 }
    if (['execution-contract-stale', 'task-run-claim-conflict'].includes(error.code)) return { code: 'contract_stale', disposition: 'non_retryable', status: 409 }
    if (['task-run-lease-expired', 'task-run-heartbeat-failed'].includes(error.code)) return { code: 'runtime_lost', disposition: 'needs_reconciliation', status: 500 }
  }
  return { code: 'unexpected_internal', disposition: 'non_retryable', status: 500 }
}

function tokenDigest(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

export class ExecutionBroker {
  private readonly inlineTokens = new Map<string, string>()

  constructor(private readonly taskRuns: TaskRunTable, private readonly now: () => Date = () => new Date()) {}

  async claimPrepared(run: TaskRunRecord, ownerId = 'inline-runtime', leaseMs = 60_000): Promise<ExecutionClaim> {
    this.assertLeaseDuration(leaseMs)
    if (ownerId.trim() === '') throw new WorkflowError('task-run-claim-owner-invalid', 'TaskRun claim owner is required.', 400)
    const current = this.taskRuns.get(run.id)
    if (current === undefined || current.status !== run.status || !['queued', 'waiting_local_directory'].includes(current.status)) throw new WorkflowError('task-run-claim-conflict', 'TaskRun is no longer claimable.', 409)
    if (taskRunClaimIdentityDigest(current) !== taskRunClaimIdentityDigest(run)) throw new WorkflowError('execution-contract-stale', 'TaskRun identity, assignment, plan, access, or repository contract changed before claim.', 409)
    const claimToken = randomUUID()
    const now = this.now()
    const timestamp = now.toISOString()
    const taskRun: TaskRunRecord = {
      ...run,
      status: 'dispatched',
      claimVersion: (current.claimVersion ?? 0) + 1,
      claimTokenDigest: tokenDigest(claimToken),
      claimOwnerId: ownerId,
      leaseExpiresAt: new Date(now.getTime() + leaseMs).toISOString(),
      lastHeartbeatAt: timestamp,
      executionContractDigest: taskRunExecutionContractDigest(run),
    }
    await this.taskRuns.put(taskRun.id, taskRun)
    this.inlineTokens.set(taskRun.id, claimToken)
    return { taskRun, claimToken }
  }

  async startInline(taskRunId: string): Promise<TaskRunRecord> {
    const token = this.inlineTokens.get(taskRunId)
    if (token === undefined) throw new WorkflowError('task-run-claim-token-missing', 'Inline TaskRun claim token is unavailable.', 409)
    return this.start(taskRunId, token)
  }

  async heartbeatInline(taskRunId: string, leaseMs = 60_000): Promise<TaskRunRecord> {
    const token = this.inlineTokens.get(taskRunId)
    if (token === undefined) throw new WorkflowError('task-run-claim-token-missing', 'Inline TaskRun claim token is unavailable.', 409)
    return this.heartbeat(taskRunId, token, leaseMs)
  }

  async start(taskRunId: string, claimToken: string): Promise<TaskRunRecord> {
    const run = this.requireClaim(taskRunId, claimToken)
    if (run.status !== 'dispatched') throw new WorkflowError('task-run-claim-conflict', 'Only a dispatched TaskRun can start.', 409)
    const now = this.now()
    if (this.leaseDeadline(run) <= now.getTime()) throw new WorkflowError('task-run-lease-expired', 'TaskRun claim lease expired before start.', 409)
    const next: TaskRunRecord = { ...run, status: 'running', startedAt: run.startedAt ?? now.toISOString(), lastHeartbeatAt: now.toISOString() }
    await this.taskRuns.put(next.id, next)
    return next
  }

  async heartbeat(taskRunId: string, claimToken: string, leaseMs = 60_000): Promise<TaskRunRecord> {
    this.assertLeaseDuration(leaseMs)
    const run = this.requireClaim(taskRunId, claimToken)
    if (!['dispatched', 'running'].includes(run.status)) throw new WorkflowError('task-run-claim-conflict', 'Only an active TaskRun claim can heartbeat.', 409)
    const now = this.now()
    if (this.leaseDeadline(run) <= now.getTime()) throw new WorkflowError('task-run-lease-expired', 'TaskRun claim lease already expired.', 409)
    const next = { ...run, lastHeartbeatAt: now.toISOString(), leaseExpiresAt: new Date(now.getTime() + leaseMs).toISOString() }
    await this.taskRuns.put(next.id, next)
    return next
  }

  async reclaimExpired(): Promise<TaskRunRecord[]> {
    const now = this.now()
    const reclaimed: TaskRunRecord[] = []
    for (const [, run] of this.taskRuns.entries()) {
      if (!['dispatched', 'running'].includes(run.status) || run.leaseExpiresAt === undefined || Date.parse(run.leaseExpiresAt) > now.getTime()) continue
      const next: TaskRunRecord = run.status === 'dispatched'
        ? { ...run, status: 'queued', error: 'Runtime claim expired before execution started.', failureDisposition: 'retryable' }
        : { ...run, status: 'failed', error: 'Runtime heartbeat expired after execution started; side effects require reconciliation.', errorCode: 'internal', failureDisposition: 'needs_reconciliation', finishedReason: 'failed', completedAt: now.toISOString() }
      delete next.claimTokenDigest
      delete next.claimOwnerId
      delete next.leaseExpiresAt
      delete next.lastHeartbeatAt
      delete next.executionContractDigest
      await this.taskRuns.put(next.id, next)
      this.inlineTokens.delete(next.id)
      reclaimed.push(next)
    }
    return reclaimed
  }

  forget(taskRunId: string): void {
    this.inlineTokens.delete(taskRunId)
  }

  private requireClaim(taskRunId: string, claimToken: string): TaskRunRecord {
    const run = this.taskRuns.get(taskRunId)
    if (run === undefined || run.claimTokenDigest !== tokenDigest(claimToken)) throw new WorkflowError('task-run-claim-conflict', 'TaskRun claim token is invalid or stale.', 409)
    if (run.executionContractDigest !== taskRunExecutionContractDigest(run)) throw new WorkflowError('execution-contract-stale', 'TaskRun agent, runtime, access, assignment, plan, or repository contract changed after claim.', 409)
    return run
  }

  private leaseDeadline(run: TaskRunRecord): number {
    const deadline = Date.parse(run.leaseExpiresAt ?? '')
    if (!Number.isFinite(deadline)) throw new WorkflowError('task-run-lease-invalid', 'TaskRun claim lease is missing or invalid.', 409)
    return deadline
  }

  private assertLeaseDuration(leaseMs: number): void {
    if (!Number.isSafeInteger(leaseMs) || leaseMs < 1_000 || leaseMs > 24 * 60 * 60_000) throw new WorkflowError('task-run-lease-invalid', 'TaskRun lease must be between 1 second and 24 hours.', 400)
  }
}
