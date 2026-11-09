import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'
import { Context } from '@deepseek-ai/cordis'
import Storage from '@deepseek-ai/dsh-storage'
import * as StorageDomain from '@deepseek-ai/dsh-storage-domain'
import * as StorageJson from '@deepseek-ai/dsh-storage-json'
import {
  OrchestratorStore,
  StorageMutationIntentRecordSchema,
  StorageMutationPayloadRecordSchema,
  StorageRecoveryAttemptRecordSchema,
  StorageReconciliationService,
  OrchestratorService,
  digestObject,
  orchestratorDomain,
  projectPointerDigest,
} from '../lib/index.js'

const crashWorker = fileURLToPath(new URL('./support/reconciliation-crash-worker.mjs', import.meta.url))

async function openJsonStore(storageRoot) {
  const context = new Context()
  await context.plugin(Storage)
  await context.plugin(StorageJson, { root: storageRoot })
  await context.plugin(StorageDomain, { backend: 'json' })
  const domain = await context.storageDomain.open(orchestratorDomain)
  return { context, domain, store: new OrchestratorStore(domain) }
}

function waitForWorkerReady(child) {
  return new Promise((resolveReady, rejectReady) => {
    let stdout = ''
    let stderr = ''
    const timer = setTimeout(() => rejectReady(new Error(`Crash worker did not become ready. stderr: ${stderr}`)), 15_000)
    child.stderr.setEncoding('utf8')
    child.stderr.on('data', (chunk) => { stderr += chunk })
    child.stdout.setEncoding('utf8')
    child.stdout.on('data', (chunk) => {
      stdout += chunk
      const line = stdout.split('\n').find((candidate) => candidate.trim().length > 0)
      if (line === undefined) return
      try {
        const message = JSON.parse(line)
        if (message.type !== 'ready-to-kill') return
        clearTimeout(timer)
        resolveReady(message)
      } catch (error) {
        clearTimeout(timer)
        rejectReady(error)
      }
    })
    child.once('exit', (code, signal) => {
      clearTimeout(timer)
      rejectReady(new Error(`Crash worker exited before the durable partial write was observed (code=${code}, signal=${signal}). stderr: ${stderr}`))
    })
  })
}

class MemoryTable {
  records = new Map()
  get(id) { return this.records.get(id) }
  entries() { return [...this.records.entries()][Symbol.iterator]() }
  async put(id, value) { this.records.set(id, structuredClone(value)) }
  async delete(id) { return this.records.delete(id) }
}

function fixture() {
  const projects = new MemoryTable()
  const store = {
    projects,
    tasks: new MemoryTable(),
    planSnapshots: new MemoryTable(),
    requirementBundles: new MemoryTable(),
    requirementItems: new MemoryTable(),
    requirementDecisions: new MemoryTable(),
    acceptanceCriteria: new MemoryTable(),
    verificationSpecs: new MemoryTable(),
    verificationEvidence: new MemoryTable(),
    verificationInvocations: new MemoryTable(),
    taskRuns: new MemoryTable(),
    planningOperations: new MemoryTable(),
    planningCheckpoints: new MemoryTable(),
    storageMutationIntents: new MemoryTable(),
    storageMutationPayloads: new MemoryTable(),
    storageRecoveryAttempts: new MemoryTable(),
  }
  const before = { id: 'project-1', name: 'Project', revision: 1, status: 'decomposing', activePlanningOperationId: 'operation-1', taskIds: [] }
  const after = { ...before, revision: 2, status: 'awaiting_approval', currentPlanSnapshotId: 'snapshot-1', taskIds: ['task-1'] }
  delete after.activePlanningOperationId
  const task = { id: 'task-1', projectId: before.id, title: 'Task' }
  return { store, before, after, task }
}

async function preparedFixture() {
  const data = fixture()
  await data.store.projects.put(data.before.id, data.before)
  const service = new StorageReconciliationService(data.store)
  const intent = await service.prepare({
    id: 'intent-1',
    projectId: data.before.id,
    aggregateType: 'planning_operation',
    aggregateId: 'operation-1',
    idempotencyKey: 'planning-publish-1',
    handler: 'planning-publish-v1',
    expectedProjectRevision: data.before.revision,
    expectedProjectPointerDigest: projectPointerDigest(data.before),
    writes: [
      { stepId: 'task', table: 'tasks', recordId: data.task.id, before: { state: 'absent' }, after: { state: 'present', value: data.task } },
      { stepId: 'project-pointer', table: 'projects', recordId: data.before.id, before: { state: 'present', value: data.before }, after: { state: 'present', value: data.after } },
    ],
  })
  return { ...data, service, intent }
}

test('StorageReconciliationService applies a prepared intent once without creating a recovery attempt', async () => {
  const { store, service, intent, after, task } = await preparedFixture()
  const committed = await service.applyPrepared(intent.id)
  const replay = await service.applyPrepared(intent.id)

  assert.equal(committed.status, 'committed')
  assert.deepEqual(replay, committed)
  assert.deepEqual(store.tasks.get(task.id), task)
  assert.deepEqual(store.projects.get(after.id), after)
  assert.equal(store.storageRecoveryAttempts.records.size, 0)
})

test('StorageReconciliationService leaves a recoverable intent when a domain write fails midway', async () => {
  const { store, service, intent, before, task } = await preparedFixture()
  const putProject = store.projects.put.bind(store.projects)
  let failed = false
  store.projects.put = async (id, value) => {
    if (!failed && value.currentPlanSnapshotId === 'snapshot-1') {
      failed = true
      throw new Error('project write failed')
    }
    return putProject(id, value)
  }

  await assert.rejects(() => service.applyPrepared(intent.id), (error) => error.code === 'storage-needs-reconciliation')
  assert.deepEqual(store.tasks.get(task.id), task)
  assert.deepEqual(store.projects.get(before.id), before)
  assert.equal(store.storageMutationIntents.get(intent.id).status, 'needs_reconciliation')
  assert.equal(service.preview(intent.id).verdict, 'compensation_safe')
})

test('StorageReconciliationService derives recovery from record facts when progress persistence fails', async () => {
  const { store, service, intent, before, task } = await preparedFixture()
  const putIntent = store.storageMutationIntents.put.bind(store.storageMutationIntents)
  let failed = false
  store.storageMutationIntents.put = async (id, value) => {
    if (!failed && value.status === 'pending' && value.completedStepIds.includes('task')) {
      failed = true
      throw new Error('progress write failed')
    }
    return putIntent(id, value)
  }

  await assert.rejects(() => service.applyPrepared(intent.id), (error) => error.code === 'storage-needs-reconciliation')
  assert.deepEqual(store.tasks.get(task.id), task)
  assert.deepEqual(store.projects.get(before.id), before)
  assert.equal(store.storageMutationIntents.get(intent.id).status, 'needs_reconciliation')
  assert.equal(service.preview(intent.id).verdict, 'compensation_safe')
})

test('StorageReconciliationService rejects a tampered immutable payload before applying it', async () => {
  const { store, service, intent, before, task } = await preparedFixture()
  const payload = [...store.storageMutationPayloads.records.values()].find((candidate) => candidate.stepId === 'task' && candidate.phase === 'after')
  await store.storageMutationPayloads.put(payload.id, { ...payload, value: { ...payload.value, title: 'Tampered' } })

  await assert.rejects(() => service.applyPrepared(intent.id), (error) => error.code === 'storage-needs-reconciliation')
  assert.equal(store.tasks.get(task.id), undefined)
  assert.deepEqual(store.projects.get(before.id), before)
  assert.equal(store.storageMutationIntents.get(intent.id).errorCode, 'reconciliation-payload-invalid')
})

test('StorageReconciliationService replays frozen writes and returns an idempotent audited result', async () => {
  const { store, service, intent, after, task } = await preparedFixture()
  assert.doesNotThrow(() => StorageMutationIntentRecordSchema.parse(intent))
  for (const payload of store.storageMutationPayloads.records.values()) assert.doesNotThrow(() => StorageMutationPayloadRecordSchema.parse(payload))
  const preview = service.preview(intent.id)
  assert.equal(preview.verdict, 'replay_safe')
  assert.deepEqual(preview.allowedActions, ['replay'])

  const request = { expectedIntentDigest: intent.intentDigest, previewDigest: preview.previewDigest, expectedProjectRevision: preview.projectRevision, action: 'replay', idempotencyKey: 'recover-1', requestedBy: 'operator', reason: 'Resume the frozen Planning publication.' }
  const attempt = await service.execute(intent.id, request)
  const replay = await service.execute(intent.id, request)
  assert.deepEqual(replay, attempt)
  assert.equal(attempt.status, 'completed')
  assert.equal(attempt.result, 'committed')
  assert.deepEqual(store.tasks.get(task.id), task)
  assert.deepEqual(store.projects.get(after.id), after)
  assert.equal(store.storageMutationIntents.get(intent.id).status, 'committed')
  assert.equal(service.preview(intent.id).verdict, 'already_applied')
  assert.doesNotThrow(() => StorageRecoveryAttemptRecordSchema.parse(attempt))
})

test('StorageReconciliationService compensates a partially published candidate in reverse order', async () => {
  const { store, service, intent, before, task } = await preparedFixture()
  await store.tasks.put(task.id, task)
  const preview = service.preview(intent.id)
  assert.equal(preview.verdict, 'compensation_safe')
  assert.deepEqual(preview.allowedActions, ['replay', 'compensate'])

  const attempt = await service.execute(intent.id, { expectedIntentDigest: intent.intentDigest, previewDigest: preview.previewDigest, expectedProjectRevision: preview.projectRevision, action: 'compensate', idempotencyKey: 'compensate-1', requestedBy: 'operator', reason: 'Discard the unpublished partial candidate.' })
  assert.equal(attempt.result, 'compensated')
  assert.equal(store.tasks.get(task.id), undefined)
  assert.deepEqual(store.projects.get(before.id), before)
  assert.equal(store.storageMutationIntents.get(intent.id).status, 'compensated')
})

test('StorageReconciliationService rebuilds preview from durable facts after service restart', async () => {
  const { store, intent, before, task } = await preparedFixture()
  await store.tasks.put(task.id, task)

  const restarted = new StorageReconciliationService(store)
  const preview = restarted.preview(intent.id)
  assert.equal(preview.verdict, 'compensation_safe')
  assert.deepEqual(preview.steps, [{ stepId: 'task', actual: 'after' }, { stepId: 'project-pointer', actual: 'before' }])

  const attempt = await restarted.execute(intent.id, { expectedIntentDigest: intent.intentDigest, previewDigest: preview.previewDigest, expectedProjectRevision: preview.projectRevision, action: 'compensate', idempotencyKey: 'restart-compensate-1', requestedBy: 'operator', reason: 'Recover after restarting the service.' })
  assert.equal(attempt.result, 'compensated')
  assert.equal(store.tasks.get(task.id), undefined)
  assert.deepEqual(store.projects.get(before.id), before)
})

test('StorageReconciliationService recovers durable partial writes after a real process kill and restart', { timeout: 30_000, skip: process.platform === 'win32' }, async () => {
  const storageRoot = await mkdtemp(join(tmpdir(), 'po-reconciliation-crash-'))
  const child = spawn(process.execPath, [crashWorker], {
    cwd: fileURLToPath(new URL('..', import.meta.url)),
    env: { ...process.env, PO_RECONCILIATION_STORAGE_ROOT: storageRoot },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  let opened
  try {
    const ready = await waitForWorkerReady(child)
    assert.equal(ready.intentId, 'crash-intent')
    const exited = new Promise((resolveExit) => child.once('exit', (code, signal) => resolveExit({ code, signal })))
    assert.equal(child.kill('SIGKILL'), true)
    assert.deepEqual(await exited, { code: null, signal: 'SIGKILL' })

    opened = await openJsonStore(storageRoot)
    const intent = opened.store.storageMutationIntents.get('crash-intent')
    assert.equal(intent.status, 'pending')
    assert.deepEqual(intent.completedStepIds, ['task'])
    assert.equal(opened.store.tasks.get('crash-task').title, 'Publish recoverable candidate')
    const project = opened.store.projects.get('crash-project')
    assert.equal(project.revision, 1)
    assert.equal(project.currentPlanSnapshotId, undefined)

    const reconciliation = new StorageReconciliationService(opened.store)
    const preview = reconciliation.preview(intent.id)
    assert.equal(preview.verdict, 'compensation_safe')
    assert.deepEqual(preview.steps, [
      { stepId: 'task', actual: 'after' },
      { stepId: 'project-pointer', actual: 'before' },
    ])
    const attempt = await reconciliation.execute(intent.id, {
      expectedIntentDigest: intent.intentDigest,
      previewDigest: preview.previewDigest,
      expectedProjectRevision: preview.projectRevision,
      action: 'compensate',
      idempotencyKey: 'recover-after-sigkill',
      requestedBy: 'test-operator',
      reason: 'Compensate the durable partial candidate after restarting the process.',
    })
    assert.equal(attempt.status, 'completed')
    assert.equal(attempt.result, 'compensated')
    assert.equal(opened.store.tasks.get('crash-task'), undefined)
    assert.equal(opened.store.projects.get('crash-project').revision, 1)
    assert.equal(opened.store.storageMutationIntents.get(intent.id).status, 'compensated')
    assert.deepEqual(reconciliation.listAttempts(intent.id), [attempt])
  } finally {
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL')
    if (opened !== undefined) {
      await opened.domain.close()
      await opened.context.fiber.dispose()
    }
    await rm(storageRoot, { recursive: true, force: true })
  }
})

test('StorageReconciliationService audits compensation failure and permits a fresh retry from observed facts', async () => {
  const { store, service, intent, before, task } = await preparedFixture()
  await store.tasks.put(task.id, task)
  const preview = service.preview(intent.id)
  const removeTask = store.tasks.delete.bind(store.tasks)
  let failed = false
  store.tasks.delete = async (id) => {
    if (!failed) {
      failed = true
      throw new Error('simulated compensation delete failure')
    }
    return removeTask(id)
  }

  const request = { expectedIntentDigest: intent.intentDigest, previewDigest: preview.previewDigest, expectedProjectRevision: preview.projectRevision, action: 'compensate', idempotencyKey: 'compensate-failure-1', requestedBy: 'operator', reason: 'Test compensation failure.' }
  await assert.rejects(() => service.execute(intent.id, request), /simulated compensation delete failure/)
  const failedAttempt = service.listAttempts(intent.id)[0]
  assert.equal(failedAttempt.status, 'failed')
  assert.equal(failedAttempt.errorCode, 'reconciliation-execution-failed')
  assert.equal(store.storageMutationIntents.get(intent.id).status, 'needs_reconciliation')
  assert.deepEqual(store.tasks.get(task.id), task)
  assert.deepEqual(store.projects.get(before.id), before)

  const replayedFailure = await service.execute(intent.id, request)
  assert.deepEqual(replayedFailure, failedAttempt)
  const retryPreview = service.preview(intent.id)
  const recovered = await service.execute(intent.id, { ...request, previewDigest: retryPreview.previewDigest, idempotencyKey: 'compensate-failure-2', reason: 'Retry after the storage fault cleared.' })
  assert.equal(recovered.result, 'compensated')
  assert.equal(store.tasks.get(task.id), undefined)
  assert.equal(store.storageMutationIntents.get(intent.id).status, 'compensated')
})

test('OrchestratorService serializes concurrent recovery requests against one preview', async () => {
  const { store, intent } = await preparedFixture()
  const service = new OrchestratorService({}, store)
  const preview = service.previewStorageReconciliation(intent.id)
  const request = { expectedIntentDigest: intent.intentDigest, previewDigest: preview.previewDigest, expectedProjectRevision: preview.projectRevision, action: 'replay', requestedBy: 'operator', reason: 'Recover once through the serialized Service boundary.' }

  const results = await Promise.allSettled([
    service.executeStorageReconciliation(intent.id, { ...request, idempotencyKey: 'concurrent-recovery-1' }),
    service.executeStorageReconciliation(intent.id, { ...request, idempotencyKey: 'concurrent-recovery-2' }),
  ])
  assert.equal(results.filter((result) => result.status === 'fulfilled').length, 1)
  assert.equal(results.filter((result) => result.status === 'rejected' && result.reason.code === 'reconciliation-stale').length, 1)
  assert.equal(service.listStorageRecoveryAttempts(intent.id).length, 1)
  assert.equal(store.storageMutationIntents.get(intent.id).status, 'committed')
})

test('StorageReconciliationService refuses automatic recovery after record drift', async () => {
  const { store, service, intent, task } = await preparedFixture()
  await store.tasks.put(task.id, { ...task, title: 'Diverged task' })
  const preview = service.preview(intent.id)
  assert.equal(preview.verdict, 'manual_required')
  assert.deepEqual(preview.allowedActions, [])
  assert.ok(preview.reasons.some((reason) => reason.code === 'reconciliation_record_diverged'))
  await assert.rejects(() => service.execute(intent.id, { expectedIntentDigest: intent.intentDigest, previewDigest: preview.previewDigest, expectedProjectRevision: preview.projectRevision, action: 'replay', idempotencyKey: 'unsafe-1', requestedBy: 'operator', reason: 'Unsafe replay.' }), (error) => error.code === 'reconciliation-manual-required')
})

test('StorageReconciliationService keeps V1 intents visible but never treats them as replayable', async () => {
  const { store, before } = fixture()
  await store.projects.put(before.id, before)
  const core = { projectId: before.id, aggregateType: 'planning_operation', aggregateId: 'operation-1', idempotencyKey: 'legacy', expectedWrites: [{ stepId: 'one', table: 'tasks', recordId: 'task-1', operation: 'put' }] }
  await store.storageMutationIntents.put('legacy-intent', { id: 'legacy-intent', ...core, completedStepIds: [], status: 'needs_reconciliation', errorCode: 'storage-step-failed', error: 'unknown', intentDigest: digestObject(core), createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' })
  const service = new StorageReconciliationService(store)
  const preview = service.preview('legacy-intent')
  assert.equal(preview.verdict, 'manual_required')
  assert.equal(preview.reasons[0].code, 'reconciliation_v1_not_replayable')
})
