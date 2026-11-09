import assert from 'node:assert/strict'
import test from 'node:test'
import { execFile, spawn } from 'node:child_process'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import { Context } from '@deepseek-ai/cordis'
import Storage from '@deepseek-ai/dsh-storage'
import * as StorageDomain from '@deepseek-ai/dsh-storage-domain'
import * as StorageJson from '@deepseek-ai/dsh-storage-json'

import { DeliveryIntegrationIntentRecordSchema, DeliveryService, OrchestratorService, OrchestratorStore, digestObject, gitCommitEvidence, orchestratorDomain } from '../lib/index.js'

const exec = promisify(execFile)
const now = '2026-08-28T00:00:00.000Z'
const crashWorker = fileURLToPath(new URL('./support/delivery-integration-crash-worker.mjs', import.meta.url))

class MemoryTable {
  constructor(records = []) { this.records = new Map(records.map((record) => [record.id, structuredClone(record)])) }
  get(key) { return this.records.get(key) }
  entries() { return this.records.entries() }
  async put(key, value) { this.records.set(key, structuredClone(value)) }
  async delete(key) { return this.records.delete(key) }
  async update(key, transform) {
    const next = transform(this.records.get(key))
    this.records.set(key, structuredClone(next))
    return next
  }
}

function memoryStore(seed = {}) {
  const tables = new Map()
  for (const [name, records] of Object.entries(seed)) tables.set(name, new MemoryTable(records))
  return new OrchestratorStore({ table(name) {
    if (!tables.has(name)) tables.set(name, new MemoryTable())
    return tables.get(name)
  } })
}

function deliveryService(store, runGit = gitProcess) {
  return new DeliveryService(store, {
    serializedMutation: (operation) => operation(),
    recordActivity: async () => {},
    inspectCanonicalTarget: async () => ({ head: '', status: '' }),
    captureRepositorySnapshot: async () => { throw new Error('not used') },
    runGit,
  })
}

async function openJsonStore(storageRoot) {
  const context = new Context()
  await context.plugin(Storage)
  await context.plugin(StorageJson, { root: storageRoot })
  await context.plugin(StorageDomain, { backend: 'json' })
  const domain = await context.storageDomain.open(orchestratorDomain)
  return { context, domain, store: new OrchestratorStore(domain) }
}

async function closeJsonStore(opened) {
  await opened.domain.close()
  await opened.context.fiber.dispose()
}

async function persistIntegrationFixture(context, store) {
  const records = [
    [store.projects, context.store.projects.get(context.project.id)],
    [store.tasks, context.store.tasks.get(context.task.id)],
    [store.planSnapshots, context.store.planSnapshots.get(context.plan.id)],
    [store.canonicalTargetBindings, context.store.canonicalTargetBindings.get(context.target.id)],
    [store.resourceAccessGrants, context.store.resourceAccessGrants.get(context.target.integrationGrantId)],
    [store.projectAccessGrantSnapshots, context.store.projectAccessGrantSnapshots.get(context.plan.accessGrantSnapshotId)],
    [store.taskRuns, context.store.taskRuns.get(context.taskRun.id)],
  ]
  for (const [table, record] of records) await table.put(record.id, record)
}

function waitForIntegrationCas(child) {
  return new Promise((resolveReady, rejectReady) => {
    let stdout = ''
    let stderr = ''
    const timer = setTimeout(() => rejectReady(new Error(`Integration crash worker did not reach the CAS boundary. stderr: ${stderr}`)), 20_000)
    child.stderr.setEncoding('utf8')
    child.stderr.on('data', (chunk) => { stderr += chunk })
    child.stdout.setEncoding('utf8')
    child.stdout.on('data', (chunk) => {
      stdout += chunk
      for (const line of stdout.split('\n')) {
        if (line.trim() === '') continue
        try {
          const message = JSON.parse(line)
          if (message.type !== 'ready-to-kill') continue
          clearTimeout(timer)
          resolveReady(message)
          return
        } catch { /* wait for a complete JSON line */ }
      }
    })
    child.once('exit', (code, signal) => {
      clearTimeout(timer)
      rejectReady(new Error(`Integration crash worker exited before the CAS boundary was observed (code=${code}, signal=${signal}). stderr: ${stderr}`))
    })
  })
}

async function git(cwd, ...args) {
  const result = await exec('git', args, { cwd, encoding: 'utf8', maxBuffer: 8_500_000 })
  return result.stdout.trim()
}

async function gitProcess(cwd, args, timeoutMs = 120_000, outputLimit = 100_000) {
  const result = await exec('git', args, { cwd, encoding: 'utf8', maxBuffer: outputLimit, timeout: timeoutMs })
  return `${result.stdout}${result.stderr}`
}

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'dsh-delivery-integration-'))
  await git(root, 'init', '-b', 'main')
  await git(root, 'config', 'user.name', 'Fixture')
  await git(root, 'config', 'user.email', 'fixture@example.test')
  await writeFile(join(root, 'package.json'), JSON.stringify({ scripts: { test: 'node --test' } }))
  await writeFile(join(root, 'feature.txt'), 'base\n')
  await git(root, 'add', '-A')
  await git(root, 'commit', '--no-verify', '-m', 'chore(fixture): create base')
  const baseCommit = await git(root, 'rev-parse', 'HEAD')
  await git(root, 'switch', '-c', 'task-output')
  await writeFile(join(root, 'feature.txt'), 'base\nimplemented\n')
  await git(root, 'add', '-A')
  await git(root, 'commit', '--no-verify', '-m', 'feat(fixture): add task output')
  const outputCommit = await git(root, 'rev-parse', 'HEAD')
  await git(root, 'switch', 'main')

  const projectId = 'project-1'
  const planId = 'plan-1'
  const taskId = 'task-1'
  const runId = 'task-run-1'
  const bindingId = 'target-1'
  const accessId = 'access-1'
  const bindingDigest = 'b'.repeat(64)
  const accessDigest = 'c'.repeat(64)
  const repositoryIdentityDigest = 'd'.repeat(64)
  const project = {
    id: projectId, name: 'fixture', summary: '', cwd: root, prd: 'PRD', technicalDesign: 'Design', status: 'running', revision: 1,
    approvedRevision: 1, taskIds: [taskId], currentPlanSnapshotId: planId, planningContractVersion: 3, deliveryStage: 'executing', createdAt: now, updatedAt: now,
  }
  const task = {
    id: taskId, projectId, ordinal: 0, title: 'Implement feature', kind: 'code', description: 'Implement', acceptanceCriteria: ['implemented'], dependencies: [],
    testCommand: 'true', status: 'completed', testExitCode: 0, planningContractVersion: 3, taskRevision: 1, planSnapshotId: planId,
    assignmentPolicy: { requiredRoles: ['implementer'], requiredCapabilities: [], allowedAgentIds: [], allowedSquadIds: [], allowedScope: ['feature.txt'], forbiddenScope: [], conflictKeys: [], maxParallel: 1, riskLevel: 'medium', requiresIndependentReviewer: false },
    createdAt: now, updatedAt: now,
  }
  const plan = {
    id: planId, projectId, revision: 1, mode: 'initial', taskIds: [taskId], planHash: 'a'.repeat(64), teamComposition: { members: [], squads: [], teamDigest: 'e'.repeat(64), capturedAt: now },
    teamDigest: 'e'.repeat(64), assignmentDigest: 'f'.repeat(64), planningContractVersion: 3, canonicalTargetBindingId: bindingId,
    canonicalTargetBindingDigest: bindingDigest, accessGrantSnapshotId: accessId, accessGrantDigest: accessDigest, status: 'approved', createdAt: now,
  }
  const target = {
    id: bindingId, projectId, operationId: 'operation-1', resourceId: 'repo-1', repositoryIdentityDigest, rootIdentityDigest: '1'.repeat(64), vcs: 'git', targetRef: 'refs/heads/main',
    planningBaseCommit: baseCommit, integrationPrincipalId: 'system:delivery-integration', integrationGrantId: 'grant-1', bindingVersion: 1, bindingDigest,
    createdBy: 'system', createdAt: now,
  }
  const grantCore = {
    projectId, principalType: 'integration_service', principalId: target.integrationPrincipalId, resourceId: target.resourceId, repositoryIdentityDigest,
    permissions: ['canonical_integrate'], pathScopes: ['.'], commandIds: [], grantedBy: 'system', grantSource: 'resource_binding', validFrom: now, reason: 'integration',
  }
  const grant = { id: target.integrationGrantId, ...grantCore, grantDigest: digestObject(grantCore) }
  const accessSnapshot = { id: accessId, projectId, operationId: 'operation-1', grantIds: [grant.id], resourceDigest: '2'.repeat(64), teamDigest: 'e'.repeat(64), snapshotDigest: accessDigest, createdAt: now }
  const taskRun = {
    id: runId, projectId, taskId, planSnapshotId: planId, deliveryTaskRevision: 1, accessGrantSnapshotId: accessId, accessGrantSnapshotDigest: accessDigest,
    canonicalTargetBindingId: bindingId, canonicalTargetBindingDigest: bindingDigest, status: 'completed', trigger: 'approval', attempt: 1,
    actualBaseCommit: baseCommit, outputCommit, outputTree: await git(root, 'rev-parse', `${outputCommit}^{tree}`), outputDiffDigest: '0'.repeat(64), outputPatchIds: [], outputChangedPaths: [],
    createdAt: now, completedAt: now,
  }
  const store = memoryStore({ projects: [project], tasks: [task], plan_snapshots: [plan], canonical_target_bindings: [target], resource_access_grants: [grant], project_access_grant_snapshots: [accessSnapshot], task_runs: [taskRun] })
  const service = new OrchestratorService({}, store)
  const outputEvidence = await gitCommitEvidence(root, baseCommit, outputCommit)
  await store.taskRuns.put(runId, { ...taskRun, outputTree: outputEvidence.tree, outputDiffDigest: outputEvidence.diffDigest, outputPatchIds: outputEvidence.patchIds, outputChangedPaths: outputEvidence.changedPaths })
  return { root, service, store, project, plan, task, taskRun: store.taskRuns.get(runId), target, baseCommit, outputCommit }
}

async function twoTaskFixture() {
  const context = await fixture()
  await git(context.root, 'switch', '-c', 'task-output-2')
  await writeFile(join(context.root, 'second.txt'), 'second task\n')
  await git(context.root, 'add', '-A')
  await git(context.root, 'commit', '--no-verify', '-m', 'feat(fixture): add second task output')
  const outputCommit = await git(context.root, 'rev-parse', 'HEAD')
  await git(context.root, 'switch', 'main')

  const task = {
    ...context.task,
    id: 'task-2',
    ordinal: 1,
    title: 'Implement second feature',
    assignmentPolicy: { ...context.task.assignmentPolicy, allowedScope: ['second.txt'] },
  }
  const outputEvidence = await gitCommitEvidence(context.root, context.baseCommit, outputCommit)
  const taskRun = {
    ...context.taskRun,
    id: 'task-run-2',
    taskId: task.id,
    outputCommit,
    outputTree: outputEvidence.tree,
    outputDiffDigest: outputEvidence.diffDigest,
    outputPatchIds: outputEvidence.patchIds,
    outputChangedPaths: outputEvidence.changedPaths,
  }
  await context.store.tasks.put(task.id, task)
  await context.store.taskRuns.put(taskRun.id, taskRun)
  await context.store.projects.put(context.project.id, { ...context.project, taskIds: [context.task.id, task.id] })
  await context.store.planSnapshots.put(context.plan.id, { ...context.plan, taskIds: [context.task.id, task.id] })
  return { ...context, secondTask: task, secondTaskRun: taskRun, secondOutputCommit: outputCommit }
}

test('V3 Delivery Integration CAS-integrates exact-one immutable TaskRun output with recomputed proof', async () => {
  const context = await fixture()
  try {
    const integration = await context.service.integrateCompletedTaskOutputsV3(context.project.id, true)
    assert.equal(integration.status, 'ready')
    assert.equal(integration.casStatus, 'matched')
    assert.equal(integration.outputs.length, 1)
    assert.equal(integration.outputs[0].taskRunId, context.taskRun.id)
    assert.equal(integration.outputs[0].inclusionStatus, 'verified')
    assert.equal(await git(context.root, 'rev-parse', 'refs/heads/main'), integration.finalCommit)
    assert.equal(await git(context.root, 'status', '--porcelain=v1'), '')
    const evidence = context.store.integrationInclusionEvidence.get(integration.outputs[0].inclusionEvidenceIds[0])
    assert.equal(evidence.result, 'verified')
    assert.deepEqual(evidence.sourcePatchIds, context.taskRun.outputPatchIds)
    assert.equal(context.store.projects.get(context.project.id).currentDeliveryIntegrationSnapshotId, integration.id)
  } finally {
    await rm(context.root, { recursive: true, force: true })
  }
})

test('V3 Delivery Integration recovers after CAS when inclusion evidence persistence fails', async () => {
  const context = await fixture()
  const originalPut = context.store.integrationInclusionEvidence.put.bind(context.store.integrationInclusionEvidence)
  let failed = false
  context.store.integrationInclusionEvidence.put = async (id, value) => {
    if (!failed) {
      failed = true
      throw new Error('injected inclusion evidence failure')
    }
    return originalPut(id, value)
  }
  try {
    await assert.rejects(
      () => context.service.integrateCompletedTaskOutputsV3(context.project.id, true),
      (error) => error.code === 'delivery-integration-needs-reconciliation',
    )
    const headAfterCas = await git(context.root, 'rev-parse', 'refs/heads/main')
    assert.notEqual(headAfterCas, context.baseCommit)
    assert.equal(context.store.deliveryIntegrationSnapshots.get(`delivery-integration:${context.project.id}:r1`), undefined)
    assert.equal([...context.store.integrationInclusionEvidence.entries()].length, 0)
    const [intent] = [...context.store.deliveryIntegrationIntents.entries()].map(([, value]) => value)
    assert.doesNotThrow(() => DeliveryIntegrationIntentRecordSchema.parse(intent))
    assert.equal(intent.status, 'ref_updated')
    assert.equal(intent.beforeCommit, context.baseCommit)
    assert.equal(intent.afterCommit, headAfterCas)

    context.store.integrationInclusionEvidence.put = originalPut
    const restarted = new OrchestratorService({}, context.store)
    const integration = await restarted.integrateCompletedTaskOutputsV3(context.project.id, true)
    assert.equal(integration.finalCommit, headAfterCas)
    assert.equal(await git(context.root, 'rev-parse', 'refs/heads/main'), headAfterCas)
    assert.equal(context.store.deliveryIntegrationIntents.get(intent.id).status, 'committed')
    assert.deepEqual(context.store.integrationInclusionEvidence.get(intent.evidence.id), intent.evidence)
    assert.equal(context.store.projects.get(context.project.id).currentDeliveryIntegrationSnapshotId, integration.id)
    await assert.rejects(() => git(context.root, 'rev-parse', '--verify', intent.recoveryRef))
  } finally {
    context.store.integrationInclusionEvidence.put = originalPut
    await rm(context.root, { recursive: true, force: true })
  }
})

test('V3 Delivery Integration resumes the exact CAS-to-reset boundary without replaying the output', async () => {
  const context = await fixture()
  let interrupted = false
  const service = deliveryService(context.store, async (cwd, args, ...options) => {
    const output = await gitProcess(cwd, args, ...options)
    if (!interrupted && args[0] === 'update-ref' && args[1] === context.target.targetRef) {
      interrupted = true
      throw new Error('injected failure after canonical CAS')
    }
    return output
  })
  try {
    await assert.rejects(
      () => service.integrateCompletedTaskOutputsV3(context.project.id, true),
      (error) => error.code === 'delivery-integration-needs-reconciliation',
    )
    const [intent] = [...context.store.deliveryIntegrationIntents.entries()].map(([, value]) => value)
    assert.equal(intent.status, 'ref_updated')
    assert.equal(await git(context.root, 'rev-parse', context.target.targetRef), intent.afterCommit)
    assert.equal(await git(context.root, 'write-tree'), intent.beforeTree)
    assert.equal(await git(context.root, 'rev-list', '--count', `${context.baseCommit}..${intent.afterCommit}`), '1')

    const integration = await deliveryService(context.store).integrateCompletedTaskOutputsV3(context.project.id, true)

    assert.equal(integration.finalCommit, intent.afterCommit)
    assert.equal(await git(context.root, 'rev-parse', context.target.targetRef), intent.afterCommit)
    assert.equal(await git(context.root, 'write-tree'), intent.afterTree)
    assert.equal(await git(context.root, 'status', '--porcelain=v1'), '')
    assert.equal(await git(context.root, 'rev-list', '--count', `${context.baseCommit}..${intent.afterCommit}`), '1')
    assert.equal(context.store.deliveryIntegrationIntents.get(intent.id).status, 'committed')
    assert.deepEqual(context.store.integrationInclusionEvidence.get(intent.evidence.id), intent.evidence)
  } finally {
    await rm(context.root, { recursive: true, force: true })
  }
})

test('V3 Delivery Integration preserves index, tracked, and untracked user drift after CAS', async (t) => {
  const scenarios = [
    {
      name: 'index drift',
      mutate: async (root) => {
        await writeFile(join(root, 'feature.txt'), 'user staged change\n')
        await git(root, 'add', 'feature.txt')
        return { path: 'feature.txt', content: 'user staged change\n' }
      },
    },
    {
      name: 'tracked worktree drift',
      mutate: async (root) => {
        await writeFile(join(root, 'feature.txt'), 'user unstaged change\n')
        return { path: 'feature.txt', content: 'user unstaged change\n' }
      },
    },
    {
      name: 'untracked drift',
      mutate: async (root) => {
        await writeFile(join(root, 'user-local.txt'), 'user untracked change\n')
        return { path: 'user-local.txt', content: 'user untracked change\n' }
      },
    },
  ]

  for (const scenario of scenarios) {
    await t.test(scenario.name, async () => {
      const context = await fixture()
      let interrupted = false
      const service = deliveryService(context.store, async (cwd, args, ...options) => {
        const output = await gitProcess(cwd, args, ...options)
        if (!interrupted && args[0] === 'update-ref' && args[1] === context.target.targetRef) {
          interrupted = true
          throw new Error('injected failure after canonical CAS')
        }
        return output
      })
      try {
        await assert.rejects(
          () => service.integrateCompletedTaskOutputsV3(context.project.id, true),
          (error) => error.code === 'delivery-integration-needs-reconciliation',
        )
        const intent = [...context.store.deliveryIntegrationIntents.entries()][0][1]
        const preserved = await scenario.mutate(context.root)

        await assert.rejects(
          () => deliveryService(context.store).integrateCompletedTaskOutputsV3(context.project.id, true),
          (error) => error.code === 'delivery-integration-reconciliation-manual',
        )

        assert.equal(context.store.deliveryIntegrationIntents.get(intent.id).status, 'manual_required')
        assert.equal(await git(context.root, 'rev-parse', context.target.targetRef), intent.afterCommit)
        assert.equal(await readFile(join(context.root, preserved.path), 'utf8'), preserved.content)
        assert.notEqual(await git(context.root, 'status', '--porcelain=v1'), '')
        assert.equal(context.store.deliveryIntegrationSnapshots.get(`delivery-integration:${context.project.id}:r1`), undefined)
        assert.equal([...context.store.integrationInclusionEvidence.entries()].length, 0)
      } finally {
        await rm(context.root, { recursive: true, force: true })
      }
    })
  }
})

test('V3 Delivery Integration recovers a durable prepared intent after a real process kill at the CAS-to-reset boundary', { timeout: 40_000, skip: process.platform === 'win32' }, async () => {
  const context = await fixture()
  const storageRoot = await mkdtemp(join(tmpdir(), 'dsh-delivery-integration-crash-'))
  let child
  let opened
  try {
    const seeded = await openJsonStore(storageRoot)
    await persistIntegrationFixture(context, seeded.store)
    await closeJsonStore(seeded)

    child = spawn(process.execPath, [crashWorker], {
      cwd: fileURLToPath(new URL('..', import.meta.url)),
      env: {
        ...process.env,
        PO_DELIVERY_INTEGRATION_STORAGE_ROOT: storageRoot,
        PO_DELIVERY_INTEGRATION_PROJECT_ID: context.project.id,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    const ready = await waitForIntegrationCas(child)
    const exited = new Promise((resolveExit) => child.once('exit', (code, signal) => resolveExit({ code, signal })))
    assert.equal(child.kill('SIGKILL'), true)
    assert.deepEqual(await exited, { code: null, signal: 'SIGKILL' })

    opened = await openJsonStore(storageRoot)
    const [intent] = [...opened.store.deliveryIntegrationIntents.entries()].map(([, value]) => value)
    assert.equal(intent.status, 'prepared')
    assert.equal(intent.afterCommit, ready.afterCommit)
    assert.equal(await git(context.root, 'rev-parse', context.target.targetRef), ready.afterCommit)
    assert.equal(await git(context.root, 'write-tree'), intent.beforeTree)
    assert.equal(opened.store.deliveryIntegrationSnapshots.get(`delivery-integration:${context.project.id}:r1`), undefined)

    const integration = await new OrchestratorService({}, opened.store).integrateCompletedTaskOutputsV3(context.project.id, true)

    assert.equal(integration.status, 'ready')
    assert.equal(integration.finalCommit, ready.afterCommit)
    assert.equal(await git(context.root, 'rev-parse', context.target.targetRef), ready.afterCommit)
    assert.equal(await git(context.root, 'status', '--porcelain=v1'), '')
    assert.equal(await git(context.root, 'rev-list', '--count', `${context.baseCommit}..${ready.afterCommit}`), '1')
    assert.equal(opened.store.deliveryIntegrationIntents.get(intent.id).status, 'committed')
    assert.deepEqual(opened.store.integrationInclusionEvidence.get(intent.evidence.id), intent.evidence)
    assert.equal(opened.store.projects.get(context.project.id).currentDeliveryIntegrationSnapshotId, integration.id)
  } finally {
    if (child !== undefined && child.exitCode === null && child.signalCode === null) child.kill('SIGKILL')
    if (opened !== undefined) await closeJsonStore(opened)
    await rm(storageRoot, { recursive: true, force: true })
    await rm(context.root, { recursive: true, force: true })
  }
})

test('V3 Delivery Integration resumes a second-task CAS failure without replaying the committed first task', async () => {
  const context = await twoTaskFixture()
  const originalPut = context.store.integrationInclusionEvidence.put.bind(context.store.integrationInclusionEvidence)
  context.store.integrationInclusionEvidence.put = async (id, value) => {
    if (id.endsWith(':evidence:2')) throw new Error('injected second inclusion evidence failure')
    return originalPut(id, value)
  }
  try {
    await assert.rejects(
      () => context.service.integrateCompletedTaskOutputsV3(context.project.id, true),
      (error) => error.code === 'delivery-integration-needs-reconciliation',
    )
    const headAfterSecondCas = await git(context.root, 'rev-parse', 'refs/heads/main')
    const intentsBeforeRestart = [...context.store.deliveryIntegrationIntents.entries()].map(([, value]) => value).sort((left, right) => left.sequence - right.sequence)
    assert.deepEqual(intentsBeforeRestart.map((intent) => intent.status), ['committed', 'ref_updated'])
    assert.equal(intentsBeforeRestart[1].afterCommit, headAfterSecondCas)
    assert.equal(await git(context.root, 'rev-list', '--count', `${context.baseCommit}..${headAfterSecondCas}`), '2')

    context.store.integrationInclusionEvidence.put = originalPut
    const restarted = new OrchestratorService({}, context.store)
    const integration = await restarted.integrateCompletedTaskOutputsV3(context.project.id, true)

    assert.equal(integration.finalCommit, headAfterSecondCas)
    assert.equal(await git(context.root, 'rev-parse', 'refs/heads/main'), headAfterSecondCas)
    assert.equal(await git(context.root, 'rev-list', '--count', `${context.baseCommit}..${headAfterSecondCas}`), '2')
    assert.deepEqual(integration.outputs.map((output) => output.sequence), [1, 2])
    assert.deepEqual(integration.outputs.map((output) => output.taskRunId), [context.taskRun.id, context.secondTaskRun.id])
    assert.deepEqual([...context.store.deliveryIntegrationIntents.entries()].map(([, value]) => value.status), ['committed', 'committed'])
    assert.equal([...context.store.integrationInclusionEvidence.entries()].length, 2)
  } finally {
    context.store.integrationInclusionEvidence.put = originalPut
    await rm(context.root, { recursive: true, force: true })
  }
})

test('V3 Delivery Integration rebuilds its snapshot from a committed intent without another cherry-pick', async () => {
  const context = await fixture()
  const originalPut = context.store.deliveryIntegrationSnapshots.put.bind(context.store.deliveryIntegrationSnapshots)
  let failed = false
  context.store.deliveryIntegrationSnapshots.put = async (id, value) => {
    if (!failed) {
      failed = true
      throw new Error('injected Integration snapshot failure')
    }
    return originalPut(id, value)
  }
  try {
    await assert.rejects(() => context.service.integrateCompletedTaskOutputsV3(context.project.id, true), /injected Integration snapshot failure/u)
    const headAfterCas = await git(context.root, 'rev-parse', 'refs/heads/main')
    const [intent] = [...context.store.deliveryIntegrationIntents.entries()].map(([, value]) => value)
    assert.equal(intent.status, 'committed')
    assert.deepEqual(context.store.integrationInclusionEvidence.get(intent.evidence.id), intent.evidence)

    context.store.deliveryIntegrationSnapshots.put = originalPut
    const restarted = new OrchestratorService({}, context.store)
    const integration = await restarted.integrateCompletedTaskOutputsV3(context.project.id, true)
    assert.equal(integration.finalCommit, headAfterCas)
    assert.equal(await git(context.root, 'rev-parse', 'refs/heads/main'), headAfterCas)
    assert.equal([...context.store.deliveryIntegrationIntents.entries()].length, 1)
    assert.equal([...context.store.integrationInclusionEvidence.entries()].length, 1)
  } finally {
    context.store.deliveryIntegrationSnapshots.put = originalPut
    await rm(context.root, { recursive: true, force: true })
  }
})

test('V3 Delivery Integration ready replay prunes a stale committed recovery ref', async () => {
  const context = await fixture()
  try {
    const integration = await context.service.integrateCompletedTaskOutputsV3(context.project.id, true)
    const [intent] = [...context.store.deliveryIntegrationIntents.entries()].map(([, value]) => value)
    assert.equal(intent.status, 'committed')
    await git(context.root, 'update-ref', intent.recoveryRef, intent.afterCommit, '0000000000000000000000000000000000000000')
    assert.equal(await git(context.root, 'rev-parse', '--verify', intent.recoveryRef), intent.afterCommit)

    const replay = await context.service.integrateCompletedTaskOutputsV3(context.project.id, true)

    assert.deepEqual(replay, integration)
    assert.equal(await git(context.root, 'rev-parse', 'refs/heads/main'), integration.finalCommit)
    await assert.rejects(() => git(context.root, 'rev-parse', '--verify', intent.recoveryRef))
  } finally {
    await rm(context.root, { recursive: true, force: true })
  }
})

test('V3 Delivery Integration ready replay validates committed intent closure before repairing the Project pointer', async () => {
  const context = await fixture()
  try {
    const integration = await context.service.integrateCompletedTaskOutputsV3(context.project.id, true)
    const [intent] = [...context.store.deliveryIntegrationIntents.entries()].map(([, value]) => value)
    await context.store.projects.put(context.project.id, { ...context.store.projects.get(context.project.id), currentDeliveryIntegrationSnapshotId: undefined, deliveryStage: 'executing' })
    await context.store.integrationInclusionEvidence.put(intent.evidence.id, { ...intent.evidence, result: 'failed' })

    await assert.rejects(
      () => context.service.integrateCompletedTaskOutputsV3(context.project.id, true),
      (error) => error.code === 'delivery-integration-intent-conflict',
    )
    assert.equal(context.store.projects.get(context.project.id).currentDeliveryIntegrationSnapshotId, undefined)
    assert.equal(context.store.deliveryIntegrationSnapshots.get(integration.id).id, integration.id)
  } finally {
    await rm(context.root, { recursive: true, force: true })
  }
})

test('V3 Delivery Integration preserves an external ref move and marks the unresolved intent manual', async () => {
  const context = await fixture()
  const originalPut = context.store.integrationInclusionEvidence.put.bind(context.store.integrationInclusionEvidence)
  let failed = false
  context.store.integrationInclusionEvidence.put = async (id, value) => {
    if (!failed) {
      failed = true
      throw new Error('injected inclusion evidence failure')
    }
    return originalPut(id, value)
  }
  try {
    await assert.rejects(
      () => context.service.integrateCompletedTaskOutputsV3(context.project.id, true),
      (error) => error.code === 'delivery-integration-needs-reconciliation',
    )
    context.store.integrationInclusionEvidence.put = originalPut
    await writeFile(join(context.root, 'external-after-cas.txt'), 'external\n')
    await git(context.root, 'add', '-A')
    await git(context.root, 'commit', '--no-verify', '-m', 'chore(fixture): move after interrupted integration')
    const externalHead = await git(context.root, 'rev-parse', 'HEAD')

    const restarted = new OrchestratorService({}, context.store)
    await assert.rejects(
      () => restarted.integrateCompletedTaskOutputsV3(context.project.id, true),
      (error) => error.code === 'delivery-integration-reconciliation-manual',
    )
    const [intent] = [...context.store.deliveryIntegrationIntents.entries()].map(([, value]) => value)
    assert.equal(intent.status, 'manual_required')
    assert.equal(intent.errorCode, 'delivery-integration-reconciliation-manual')
    assert.equal(await git(context.root, 'rev-parse', 'HEAD'), externalHead)
    assert.equal(context.store.deliveryIntegrationSnapshots.get(`delivery-integration:${context.project.id}:r1`), undefined)
    assert.equal([...context.store.integrationInclusionEvidence.entries()].length, 0)
  } finally {
    context.store.integrationInclusionEvidence.put = originalPut
    await rm(context.root, { recursive: true, force: true })
  }
})

test('V3 Delivery Integration fails closed when canonical target moves before CAS', async () => {
  const context = await fixture()
  try {
    await writeFile(join(context.root, 'external.txt'), 'external\n')
    await git(context.root, 'add', '-A')
    await git(context.root, 'commit', '--no-verify', '-m', 'chore(fixture): move target')
    const movedHead = await git(context.root, 'rev-parse', 'HEAD')
    await assert.rejects(() => context.service.integrateCompletedTaskOutputsV3(context.project.id, true), (error) => error.code === 'delivery-integration-target-moved')
    assert.equal(await git(context.root, 'rev-parse', 'HEAD'), movedHead)
    assert.equal(context.store.deliveryIntegrationSnapshots.get(`delivery-integration:${context.project.id}:r1`), undefined)
    assert.equal([...context.store.integrationInclusionEvidence.entries()].length, 0)
  } finally {
    await rm(context.root, { recursive: true, force: true })
  }
})

test('V3 delivery confirmation rejects a superficially ready legacy delivery without current convergence', async () => {
  const context = await fixture()
  try {
    await context.store.projects.put(context.project.id, { ...context.project, status: 'completed', deliveryStage: 'delivery_ready' })
    await context.store.projectReviews.put('review-1', { id: 'review-1', projectId: context.project.id, revision: 1, evidenceIds: [], status: 'approved', reviewerType: 'human', reviewerId: 'reviewer', summary: 'approved', createdAt: now, resolvedAt: now })
    await context.store.deliveryRecords.put('delivery-1', { id: 'delivery-1', projectId: context.project.id, revision: 1, reviewId: 'review-1', evidenceIds: [], status: 'ready', createdAt: now })
    await assert.rejects(() => context.service.confirmProjectDelivery(context.project.id, { actor: 'reviewer' }), (error) => error.code === 'delivery-not-ready' && /Convergence/u.test(error.message))
    assert.equal(context.store.deliveryRecords.get('delivery-1').status, 'ready')
  } finally {
    await rm(context.root, { recursive: true, force: true })
  }
})

test('V3 Convergence freezes immutable findings and a repair baseline at the canonical finalCommit', async () => {
  const context = await fixture()
  try {
    const integration = await context.service.integrateCompletedTaskOutputsV3(context.project.id, true)
    const review = await context.service.reviewDeliveryConvergenceV3(context.project.id, integration)
    assert.equal(review.status, 'changes_required')
    assert.equal(review.findingIds.length, 1)
    assert.equal(context.store.deliveryConvergenceFindings.get(review.findingIds[0]).code, 'stale_verification')

    const baseline = context.store.convergenceRepairBaselines.get(review.repairBaselineId)
    assert.equal(baseline.finalCommit, integration.finalCommit)
    assert.equal(baseline.parentIntegrationSnapshotId, integration.id)
    assert.deepEqual(baseline.findingIds, review.findingIds)
    assert.equal(baseline.carryItemIds.length, review.findingIds.length)
    assert.equal(context.store.convergenceRepairCarryItems.get(baseline.carryItemIds[0]).disposition, 'reverify')
    assert.equal(context.store.projects.get(context.project.id).deliveryStage, 'changes_required')

    const replay = await context.service.reviewDeliveryConvergenceV3(context.project.id, integration)
    assert.deepEqual(replay, review)
    assert.equal([...context.store.deliveryConvergenceReviews.entries()].length, 1)
    assert.equal([...context.store.convergenceRepairBaselines.entries()].length, 1)
  } finally {
    await rm(context.root, { recursive: true, force: true })
  }
})

test('V3 Convergence compensates every new record when the immutable review write fails', async () => {
  const context = await fixture()
  try {
    const integration = await context.service.integrateCompletedTaskOutputsV3(context.project.id, true)
    const projectBefore = structuredClone(context.store.projects.get(context.project.id))
    const originalPut = context.store.deliveryConvergenceReviews.put.bind(context.store.deliveryConvergenceReviews)
    context.store.deliveryConvergenceReviews.put = async () => { throw new Error('injected convergence review write failure') }
    await assert.rejects(() => context.service.reviewDeliveryConvergenceV3(context.project.id, integration), /injected convergence review write failure/u)
    context.store.deliveryConvergenceReviews.put = originalPut

    assert.deepEqual(context.store.projects.get(context.project.id), projectBefore)
    assert.equal(context.store.repositorySnapshotsV3.get(`final-repository:${integration.id}`), undefined)
    assert.equal([...context.store.deliveryConvergenceFindings.entries()].length, 0)
    assert.equal([...context.store.convergenceRepairCarryItems.entries()].length, 0)
    assert.equal([...context.store.convergenceRepairBaselines.entries()].length, 0)
    assert.equal([...context.store.deliveryConvergenceReviews.entries()].length, 0)
  } finally {
    await rm(context.root, { recursive: true, force: true })
  }
})

test('V3 Convergence repair replays the same baseline request while decomposition is active', async () => {
  const context = await fixture()
  try {
    const integration = await context.service.integrateCompletedTaskOutputsV3(context.project.id, true)
    const review = await context.service.reviewDeliveryConvergenceV3(context.project.id, integration)
    const baseline = context.store.convergenceRepairBaselines.get(review.repairBaselineId)
    const project = context.store.projects.get(context.project.id)
    const idempotencyKey = `convergence-repair:${baseline.baselineDigest}`
    const batch = {
      title: `${project.name} convergence repair`, prd: project.prd, technicalDesign: project.technicalDesign,
      taskLanguage: project.taskLanguage ?? 'zh-CN', sourceRefs: [], sourceBlocks: [], idempotencyKey,
    }
    const requestDigest = digestObject({ kind: 'convergence_repair', baselineDigest: baseline.baselineDigest, batch })
    const active = { ...project, status: 'decomposing', deliveryStage: 'planning', activeDecompositionKey: idempotencyKey, activeDecompositionDigest: requestDigest }
    await context.store.projects.put(project.id, active)

    const replay = await context.service.startConvergenceRepairV3(project.id, { expectedBaselineDigest: baseline.baselineDigest })
    assert.deepEqual(replay, active)
    assert.equal([...context.store.planningOperations.entries()].length, 0)
  } finally {
    await rm(context.root, { recursive: true, force: true })
  }
})

test('V3 Convergence repair rejects a repository that moved after the parent finalCommit', async () => {
  const context = await fixture()
  try {
    const integration = await context.service.integrateCompletedTaskOutputsV3(context.project.id, true)
    const review = await context.service.reviewDeliveryConvergenceV3(context.project.id, integration)
    const baseline = context.store.convergenceRepairBaselines.get(review.repairBaselineId)
    await writeFile(join(context.root, 'after-convergence.txt'), 'moved\n')
    await git(context.root, 'add', '-A')
    await git(context.root, 'commit', '--no-verify', '-m', 'chore(fixture): move after convergence')

    await assert.rejects(
      () => context.service.startConvergenceRepairV3(context.project.id, { expectedBaselineDigest: baseline.baselineDigest }),
      (error) => error.code === 'convergence-repair-repository-stale',
    )
    assert.equal([...context.store.planningOperations.entries()].length, 0)
  } finally {
    await rm(context.root, { recursive: true, force: true })
  }
})
