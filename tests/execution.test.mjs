import assert from 'node:assert/strict'
import test from 'node:test'
import {
  ExecutionBroker,
  InlineRuntimeAdapter,
  TaskRunRecordSchema,
  WorkflowError,
  classifyExecutionFailure,
  taskRunExecutionContractDigest,
} from '../lib/index.js'

class MemoryTable {
  records = new Map()
  get(id) { return this.records.get(id) }
  entries() { return this.records.entries() }
  async put(id, value) { this.records.set(id, structuredClone(value)) }
}

function taskRun(overrides = {}) {
  return {
    id: 'task-run-1', projectId: 'project-1', taskId: 'task-1', planSnapshotId: 'plan-1', deliveryTaskRevision: 1,
    planningRepositoryDigest: 'a'.repeat(64), planningPolicyDigest: 'b'.repeat(64), accessGrantSnapshotDigest: 'c'.repeat(64),
    canonicalTargetBindingDigest: 'd'.repeat(64), assignmentDecisionId: 'assignment-1', agentId: 'agent-1', runtimeId: 'runtime-1',
    status: 'queued', trigger: 'approval', attempt: 1, createdAt: '2026-01-01T00:00:00.000Z', ...overrides,
  }
}

test('ExecutionBroker claims exactly once and rejects stale tokens or execution contracts', async () => {
  const table = new MemoryTable()
  const run = taskRun()
  await table.put(run.id, run)
  const broker = new ExecutionBroker(table, () => new Date('2026-01-01T00:00:00.000Z'))
  const claim = await broker.claimPrepared(run, 'runtime-1', 60_000)
  assert.equal(claim.taskRun.status, 'dispatched')
  assert.equal(claim.taskRun.claimVersion, 1)
  assert.equal(claim.taskRun.executionContractDigest, taskRunExecutionContractDigest(run))
  assert.doesNotThrow(() => TaskRunRecordSchema.parse(claim.taskRun))
  await assert.rejects(broker.claimPrepared(run), (error) => error.code === 'task-run-claim-conflict')
  await assert.rejects(broker.start(run.id, 'wrong-token'), (error) => error.code === 'task-run-claim-conflict')
  await table.put(run.id, { ...claim.taskRun, agentId: 'agent-2' })
  await assert.rejects(broker.start(run.id, claim.claimToken), (error) => error.code === 'execution-contract-stale')
})

test('ExecutionBroker freezes workspace, base commit, and assignment revision in the claim contract', async () => {
  const table = new MemoryTable()
  const run = taskRun({ assignmentRevision: 3, resourceId: 'resource-1', cwd: '/repo', workspace: '/worktree/run-1', branch: 'dsh/taskrun/run-1', baseCommit: '1'.repeat(40) })
  await table.put(run.id, run)
  const broker = new ExecutionBroker(table, () => new Date('2026-01-01T00:00:00.000Z'))
  const claim = await broker.claimPrepared(run, 'runtime-1', 60_000)
  await table.put(run.id, { ...claim.taskRun, workspace: '/worktree/other' })
  await assert.rejects(broker.start(run.id, claim.claimToken), (error) => error.code === 'execution-contract-stale')
})

test('ExecutionBroker heartbeat extends a valid lease and rejects an expired lease', async () => {
  const table = new MemoryTable()
  let now = new Date('2026-01-01T00:00:00.000Z')
  const run = taskRun()
  await table.put(run.id, run)
  const broker = new ExecutionBroker(table, () => now)
  const claim = await broker.claimPrepared(run, 'runtime-1', 2_000)
  const started = await broker.start(run.id, claim.claimToken)
  assert.equal(started.status, 'running')
  now = new Date('2026-01-01T00:00:01.000Z')
  const heartbeat = await broker.heartbeat(run.id, claim.claimToken, 4_000)
  assert.equal(heartbeat.leaseExpiresAt, '2026-01-01T00:00:05.000Z')
  assert.equal((await broker.heartbeatInline(run.id, 5_000)).leaseExpiresAt, '2026-01-01T00:00:06.000Z')
  now = new Date('2026-01-01T00:00:06.000Z')
  await assert.rejects(broker.heartbeat(run.id, claim.claimToken), (error) => error.code === 'task-run-lease-expired')
})

test('ExecutionBroker rejects invalid claim owners, heartbeat durations, and corrupt lease timestamps', async () => {
  const table = new MemoryTable()
  const run = taskRun()
  await table.put(run.id, run)
  const broker = new ExecutionBroker(table, () => new Date('2026-01-01T00:00:00.000Z'))
  await assert.rejects(broker.claimPrepared(run, ' ', 60_000), (error) => error.code === 'task-run-claim-owner-invalid')
  const claim = await broker.claimPrepared(run, 'runtime-1', 60_000)
  await assert.rejects(broker.heartbeat(run.id, claim.claimToken, 999), (error) => error.code === 'task-run-lease-invalid')
  await table.put(run.id, { ...claim.taskRun, leaseExpiresAt: 'not-a-date' })
  await assert.rejects(broker.start(run.id, claim.claimToken), (error) => error.code === 'task-run-lease-invalid')
})

test('ExecutionBroker requeues never-started expiry but reconciles an expired running attempt', async () => {
  const table = new MemoryTable()
  let now = new Date('2026-01-01T00:00:00.000Z')
  const queued = taskRun({ id: 'queued-expiry' })
  const running = taskRun({ id: 'running-expiry' })
  await table.put(queued.id, queued)
  await table.put(running.id, running)
  const broker = new ExecutionBroker(table, () => now)
  await broker.claimPrepared(queued, 'runtime-1', 1_000)
  await broker.claimPrepared(running, 'runtime-1', 1_000)
  await broker.startInline(running.id)
  now = new Date('2026-01-01T00:00:02.000Z')
  const reclaimed = await broker.reclaimExpired()
  assert.equal(reclaimed.length, 2)
  assert.equal(table.get(queued.id).status, 'queued')
  assert.equal(table.get(queued.id).failureDisposition, 'retryable')
  assert.equal(table.get(running.id).status, 'failed')
  assert.equal(table.get(running.id).failureDisposition, 'needs_reconciliation')
})

test('execution failure classification distinguishes dependency retry from business/stale and uncertain runtime loss', () => {
  assert.deepEqual(classifyExecutionFailure(new WorkflowError('runtime-offline', 'offline', 409)).disposition, 'retryable')
  assert.deepEqual(classifyExecutionFailure(new WorkflowError('execution-contract-stale', 'stale', 409)).disposition, 'non_retryable')
  assert.deepEqual(classifyExecutionFailure(new WorkflowError('task-run-lease-expired', 'lost', 409)).disposition, 'needs_reconciliation')
  assert.deepEqual(classifyExecutionFailure(new WorkflowError('task-run-heartbeat-failed', 'lost', 500)).disposition, 'needs_reconciliation')
})

test('InlineRuntimeAdapter exposes prepare/start/observe/artifact and cancellation states', async () => {
  const adapter = new InlineRuntimeAdapter(async (request) => ({ result: { echoed: request.payload }, artifacts: [{ kind: 'log', name: 'run.log', contentDigest: 'a'.repeat(64) }] }))
  const prepared = await adapter.prepare({ taskRunId: 'run-1', cwd: '/tmp/project', contractDigest: 'f'.repeat(64), payload: 'ok' })
  await assert.rejects(adapter.collectArtifacts(prepared.executionId), (error) => error.code === 'runtime-artifacts-unavailable')
  await adapter.start(prepared.executionId)
  await new Promise((resolve) => setImmediate(resolve))
  assert.equal((await adapter.observe(prepared.executionId)).status, 'succeeded')
  assert.equal((await adapter.collectArtifacts(prepared.executionId))[0].name, 'run.log')

  const cancellable = new InlineRuntimeAdapter(async (_request, signal) => new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(signal.reason), { once: true })))
  const pending = await cancellable.prepare({ taskRunId: 'run-2', cwd: '/tmp/project', contractDigest: 'e'.repeat(64), payload: null })
  await cancellable.start(pending.executionId)
  await cancellable.cancel(pending.executionId, 'operator stop')
  assert.equal((await cancellable.observe(pending.executionId)).status, 'cancelled')
})
