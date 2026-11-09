import { Context } from '@deepseek-ai/cordis'
import Storage from '@deepseek-ai/dsh-storage'
import * as StorageDomain from '@deepseek-ai/dsh-storage-domain'
import * as StorageJson from '@deepseek-ai/dsh-storage-json'
import {
  OrchestratorStore,
  StorageReconciliationService,
  orchestratorDomain,
  projectPointerDigest,
} from '../../lib/index.js'

const storageRoot = process.env.PO_RECONCILIATION_STORAGE_ROOT
if (storageRoot === undefined) throw new Error('PO_RECONCILIATION_STORAGE_ROOT is required.')

const context = new Context()
await context.plugin(Storage)
await context.plugin(StorageJson, { root: storageRoot })
await context.plugin(StorageDomain, { backend: 'json' })
const domain = await context.storageDomain.open(orchestratorDomain)
const store = new OrchestratorStore(domain)
const reconciliation = new StorageReconciliationService(store)
const timestamp = '2026-09-22T00:00:00.000Z'
const before = {
  id: 'crash-project',
  name: 'Crash recovery fixture',
  summary: 'Exercises durable reconciliation after an abrupt process exit.',
  cwd: storageRoot,
  prd: 'Persist a planning candidate safely.',
  technicalDesign: 'Use a recoverable storage mutation intent.',
  priority: 'medium',
  status: 'decomposing',
  revision: 1,
  taskIds: [],
  activePlanningOperationId: 'crash-operation',
  createdAt: timestamp,
  updatedAt: timestamp,
}
const after = {
  ...before,
  status: 'awaiting_approval',
  revision: 2,
  taskIds: ['crash-task'],
  currentPlanSnapshotId: 'crash-snapshot',
  updatedAt: '2026-09-22T00:01:00.000Z',
}
delete after.activePlanningOperationId
const task = {
  id: 'crash-task',
  projectId: before.id,
  ordinal: 0,
  title: 'Publish recoverable candidate',
  kind: 'code',
  description: 'Write one candidate task before advancing the Project pointer.',
  acceptanceCriteria: ['The candidate can be recovered after a process crash.'],
  dependencies: [],
  priority: 'medium',
  tags: ['reconciliation'],
  testCommand: 'true',
  status: 'draft',
  createdAt: timestamp,
  updatedAt: timestamp,
}

await store.projects.put(before.id, before)
const intent = await reconciliation.prepare({
  id: 'crash-intent',
  projectId: before.id,
  aggregateType: 'planning_operation',
  aggregateId: 'crash-operation',
  idempotencyKey: 'crash-planning-publish',
  handler: 'planning-publish-v1',
  expectedProjectRevision: before.revision,
  expectedProjectPointerDigest: projectPointerDigest(before),
  writes: [
    { stepId: 'task', table: 'tasks', recordId: task.id, before: { state: 'absent' }, after: { state: 'present', value: task } },
    { stepId: 'project-pointer', table: 'projects', recordId: before.id, before: { state: 'present', value: before }, after: { state: 'present', value: after } },
  ],
})

const putProject = store.projects.put.bind(store.projects)
store.projects.put = async (id, value) => {
  if (value.currentPlanSnapshotId === after.currentPlanSnapshotId) {
    process.stdout.write(`${JSON.stringify({ type: 'ready-to-kill', intentId: intent.id })}\n`)
    await new Promise(() => {})
  }
  return putProject(id, value)
}

await reconciliation.applyPrepared(intent.id)
