import { Context } from '@deepseek-ai/cordis'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import Storage from '@deepseek-ai/dsh-storage'
import * as StorageDomain from '@deepseek-ai/dsh-storage-domain'
import * as StorageJson from '@deepseek-ai/dsh-storage-json'
import { DeliveryService, OrchestratorStore, orchestratorDomain } from '../../lib/index.js'

const exec = promisify(execFile)

async function gitProcess(cwd, args, timeoutMs = 120_000, outputLimit = 100_000) {
  const result = await exec('git', args, { cwd, encoding: 'utf8', maxBuffer: outputLimit, timeout: timeoutMs })
  return `${result.stdout}${result.stderr}`
}

const storageRoot = process.env.PO_DELIVERY_INTEGRATION_STORAGE_ROOT
const projectId = process.env.PO_DELIVERY_INTEGRATION_PROJECT_ID
if (storageRoot === undefined || projectId === undefined) throw new Error('Delivery Integration crash worker environment is incomplete.')

const context = new Context()
await context.plugin(Storage)
await context.plugin(StorageJson, { root: storageRoot })
await context.plugin(StorageDomain, { backend: 'json' })
const domain = await context.storageDomain.open(orchestratorDomain)
const store = new OrchestratorStore(domain)
const project = store.projects.get(projectId)
const plan = project?.currentPlanSnapshotId === undefined ? undefined : store.planSnapshots.get(project.currentPlanSnapshotId)
const target = plan?.canonicalTargetBindingId === undefined ? undefined : store.canonicalTargetBindings.get(plan.canonicalTargetBindingId)
if (project === undefined || target === undefined) throw new Error('Delivery Integration crash worker fixture is missing.')

let announced = false
const service = new DeliveryService(store, {
  serializedMutation: (operation) => operation(),
  recordActivity: async () => {},
  inspectCanonicalTarget: async () => ({ head: '', status: '' }),
  captureRepositorySnapshot: async () => { throw new Error('not used') },
  runGit: async (cwd, args, ...options) => {
    const output = await gitProcess(cwd, args, ...options)
    if (!announced && args[0] === 'update-ref' && args[1] === target.targetRef) {
      announced = true
      process.stdout.write(`${JSON.stringify({ type: 'ready-to-kill', projectId, targetRef: target.targetRef, afterCommit: args[2] })}\n`)
      await new Promise(() => {})
    }
    return output
  },
})

await service.integrateCompletedTaskOutputsV3(projectId, true)
