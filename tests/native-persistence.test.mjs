import assert from 'node:assert/strict'
import test from 'node:test'
import { Context } from '@deepseek-ai/cordis'
import Storage from '@deepseek-ai/dsh-storage'
import * as StorageDomain from '@deepseek-ai/dsh-storage-domain'
import * as StorageJson from '@deepseek-ai/dsh-storage-json'
import Forge, { changeRequestKey } from '@deepseek-ai/dsh-experimental-forge'
import { z } from 'zod'
import { mkdtemp, mkdir, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { setTimeout as delay } from 'node:timers/promises'
import { CommandRunner, NativeIntegrationService, OrchestratorStore, ProjectRecordSchema, orchestratorDomain } from '../lib/index.js'

/** 打开实际 JSON 后端；legacy 仅声明原表，用于演练旧数据增量读取。 */
async function open(root, legacy = false) {
  const context = new Context()
  await context.plugin(Storage)
  await context.plugin(StorageJson, { root })
  await context.plugin(StorageDomain, { backend: 'json' })
  await context.plugin(Forge, { activeIntervalMs: 100, idleIntervalMs: 100 })
  const definition = legacy ? StorageDomain.defineDomain({ name: 'project_orchestrator', version: 1, global: { schema: z.object({ schemaVersion: z.literal(1) }), initial: { schemaVersion: 1 } }, tables: { projects: StorageDomain.domainTable(ProjectRecordSchema) } }) : orchestratorDomain
  const domain = await context.storageDomain.open(definition)
  return { context, domain, store: legacy ? undefined : new OrchestratorStore(domain), close: async () => { await domain.close(); await context.fiber.dispose() } }
}

test('real Forge polling and JSON binding survive old-table upgrade, restart, withdrawal and rollback read', async () => {
  const root = await mkdtemp(join(tmpdir(), 'po-native-json-'))
  let opened
  let native
  try {
    const cwd = join(root, 'repo')
    await mkdir(cwd)
    const runner = new CommandRunner()
    const git = async (_cwd, args) => {
      const result = await runner.run({ cwd: _cwd, command: ['git', ...args], signal: AbortSignal.timeout(5000) })
      assert.equal(result.exitCode, 0, result.output)
      return result.output.trim()
    }
    await git(cwd, ['init', '-q'])
    await git(cwd, ['-c', 'core.hooksPath=/dev/null', '-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '--allow-empty', '-qm', 'test: fixture'])
    await git(cwd, ['remote', 'add', 'origin', 'https://example.invalid/sample/repo.git'])
    const head = await git(cwd, ['rev-parse', 'HEAD'])
    const project = { id: 'p', name: 'Legacy', summary: '', cwd, prd: '', technicalDesign: '', status: 'draft', revision: 1, taskIds: [], createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() }
    opened = await open(join(root, 'storage'), true)
    await opened.domain.table('projects').put('p', project)
    await opened.close()
    opened = await open(join(root, 'storage'))
    assert.deepEqual(opened.store.projects.get('p'), project)
    assert.equal(opened.store.pullRequestBindings.get('p'), undefined)
    const repository = { forge: 'fixture', host: 'example.invalid', owner: 'sample', name: 'repo' }
    const ref = { repository, number: 1 }
    const url = 'https://example.invalid/sample/repo/pull/1'
    const snapshot = { ref, url, title: 'Fixture', state: 'open', headSha: head, checks: [], checksRollup: 'success', checksTruncated: false, reviewDecision: 'approved' }
    let fetches = 0
    const register = () => opened.context.forge.register({
      forge: 'fixture', repositoryFromRemote: (remote) => remote === 'https://example.invalid/sample/repo.git' ? repository : undefined,
      changeRequestFromUrl: (value) => value === url ? ref : undefined, changeRequestUrl: () => url,
      readiness: async () => ({ state: 'ready', message: null }), findByHead: async () => [],
      fetch: async (refs) => { fetches += 1; return new Map(refs.map((item) => [changeRequestKey(item), snapshot])) },
      fetchChecks: async () => snapshot, diff: async () => 'diff --git a/a b/a', fileText: async () => '', fileUrl: () => url,
      markReady: async () => { throw new Error('Unexpected remote write') }, merge: async () => { throw new Error('Unexpected remote write') },
    })
    register()
    native = new NativeIntegrationService(opened.context, opened.store, git, 'node')
    const binding = await native.bind('p', { url, expectedHead: head, expectedUpdatedAt: null })
    const deadline = Date.now() + 3000
    while (native.status('p').state === 'loading' && Date.now() < deadline) await delay(20)
    assert.equal(native.status('p').headMatches, true)
    assert.ok(fetches > 0)
    const capture = await native.capture('p', AbortSignal.timeout(3000))
    native.close()
    await opened.close()
    opened = await open(join(root, 'storage'))
    const unregister = register()
    native = new NativeIntegrationService(opened.context, opened.store, git, 'node')
    assert.deepEqual(opened.store.pullRequestBindings.get('p'), binding)
    assert.equal(opened.store.artifacts.get(capture.artifactId).metadata.acceptanceEffect, 'none')
    assert.deepEqual(opened.store.projects.get('p'), project)
    native.status('p')
    await unregister()
    assert.equal(native.status('p').state, 'error')
    assert.equal(native.status('p').failure.code, 'unavailable')
    native.close()
    await opened.close()
    opened = await open(join(root, 'storage'), true)
    assert.deepEqual(opened.domain.table('projects').get('p'), project)
  } finally {
    native?.close()
    await opened?.close()
    await rm(root, { recursive: true, force: true })
  }
})
