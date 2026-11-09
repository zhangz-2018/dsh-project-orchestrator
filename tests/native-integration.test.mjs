import assert from 'node:assert/strict'
import test from 'node:test'
import { Context } from '@deepseek-ai/cordis'
import LocalSubprocess from '@deepseek-ai/dsh-subprocess-local'
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { CommandRunner, NativeIntegrationService, NativeReadOnlyPilot, PullRequestBindingSchema, filteredCommandEnvironment, taskRunExecutionContractDigest } from '../lib/index.js'

class Table {
  rows = new Map()
  get(id) { return this.rows.get(id) }
  entries() { return this.rows.entries() }
  async put(id, value) { this.rows.set(id, structuredClone(value)) }
  async delete(id) { return this.rows.delete(id) }
}

const repository = { forge: 'github', host: 'github.com', owner: 'sample', name: 'repo' }
const ref = { repository, number: 1 }
const head = 'a'.repeat(40)
const bindingInput = { url: 'https://github.com/sample/repo/pull/1', expectedHead: head, expectedUpdatedAt: null }

function fixture() {
  const store = { projects: new Table(), pullRequestBindings: new Table(), artifacts: new Table(), taskRuns: new Table(), agents: new Table() }
  store.projects.rows.set('p', { id: 'p', cwd: '/isolated/repo', revision: 1, approvedRevision: 1, currentPlanSnapshotId: 'plan' })
  let disposed = 0
  let watches = 0
  let snapshot = { ref, url: bindingInput.url, title: 'Test PR', state: 'open', headSha: head, checks: [], checksRollup: 'success', checksTruncated: false, reviewDecision: 'approved' }
  let latest = { fetchedAt: Date.now(), snapshot }
  let readiness = { state: 'ready', message: null }
  const forge = {
    changeRequestFromUrl: () => ref, changeRequestUrl: () => bindingInput.url, repositoryFromRemote: () => repository,
    readiness: async () => readiness,
    watch: () => { watches += 1; return () => { disposed += 1 } }, latest: () => latest,
    fetchChecks: async () => snapshot, diff: async () => 'diff --git a/a b/a',
    merge() { throw new Error('Remote write must never run') }, submitReview() { throw new Error('Remote write must never run') }, markReady() { throw new Error('Remote write must never run') },
  }
  const ctx = { forge }
  const git = async (_cwd, args) => args[0] === 'remote' ? 'git@github.com:sample/repo.git\n' : `${head}\n`
  const service = new NativeIntegrationService(ctx, store, git, 'node')
  return { service, ctx, store, forge, git, counts: () => ({ disposed, watches }), snapshot: () => snapshot, setSnapshot: (value) => { snapshot = value; latest = { fetchedAt: Date.now(), snapshot } }, setLatest: (value) => { latest = value }, setReadiness: (value) => { readiness = value } }
}

test('native diagnostics reports actual services without provider calls or changing switches', () => {
  const f = fixture()
  assert.equal(f.service.diagnostics().capabilities.find((c) => c.id === 'forge').state, 'present')
  assert.equal(f.service.diagnostics().capabilities.find((c) => c.id === 'subagents').state, 'missing')
  assert.equal(f.service.status('p').state, 'unbound')
  assert.equal(f.store.artifacts.rows.size, 0)
})

test('PR binding is separate from approval, uses CAS, shares watcher, restores after restart and unbinds locally', async () => {
  const f = fixture()
  const before = structuredClone(f.store.projects.get('p'))
  const binding = await f.service.bind('p', bindingInput)
  assert.doesNotThrow(() => PullRequestBindingSchema.parse(binding))
  assert.equal(f.service.status('p').headMatches, true)
  f.service.status('p')
  assert.deepEqual(f.counts(), { watches: 1, disposed: 0 })
  await assert.rejects(f.service.bind('p', bindingInput), { code: 'forge-binding-stale' })
  f.service.close()
  const restarted = new NativeIntegrationService(f.ctx, f.store, f.git, 'node')
  assert.equal(restarted.status('p').headMatches, true)
  assert.deepEqual(f.counts(), { watches: 2, disposed: 1 })
  await restarted.unbind('p', { expectedUpdatedAt: binding.updatedAt })
  assert.equal(restarted.status('p').state, 'unbound')
  assert.deepEqual(f.store.projects.get('p'), before)
  assert.deepEqual(f.counts(), { watches: 2, disposed: 2 })
})

test('PR binding refuses missing service, auth failure, changed local HEAD, another repo and credential URLs', async () => {
  const f = fixture()
  delete f.ctx.forge
  await assert.rejects(f.service.bind('p', bindingInput), { code: 'forge-unavailable' })
  f.ctx.forge = f.forge
  f.setReadiness({ state: 'unauthenticated', message: 'sensitive diagnostic' })
  await assert.rejects(f.service.bind('p', bindingInput), { code: 'forge-unauthenticated' })
  f.setReadiness({ state: 'unavailable', message: 'missing gh' })
  await assert.rejects(f.service.bind('p', bindingInput), { code: 'forge-unavailable' })
  f.setReadiness({ state: 'ready', message: null })
  await assert.rejects(f.service.bind('p', { ...bindingInput, expectedHead: 'b'.repeat(40) }), { code: 'forge-head-stale' })
  f.forge.repositoryFromRemote = () => ({ ...repository, name: 'other' })
  await assert.rejects(f.service.bind('p', bindingInput), { code: 'forge-repository-mismatch' })
  await assert.rejects(f.service.bind('p', { ...bindingInput, url: 'https://user:secret@github.com/sample/repo/pull/1' }), { code: 'forge-url-invalid' })
  assert.equal(f.store.pullRequestBindings.rows.size, 0)
})

test('PR checks reject old head, truncation, provider failure, expired polling and provider withdrawal', async () => {
  const f = fixture()
  await f.service.bind('p', bindingInput)
  const original = f.snapshot()
  f.setSnapshot({ ...original, headSha: 'b'.repeat(40) })
  assert.equal(f.service.status('p').headMatches, false)
  await assert.rejects(f.service.checks('p', AbortSignal.timeout(1000)), { code: 'forge-head-stale' })
  f.setSnapshot({ ...original, checksTruncated: true })
  await assert.rejects(f.service.capture('p', AbortSignal.timeout(1000)), { code: 'forge-checks-incomplete' })
  assert.equal(f.store.artifacts.rows.size, 0)
  f.setLatest({ fetchedAt: Date.now() - 121000, snapshot: original })
  assert.equal(f.service.status('p').state, 'stale')
  f.forge.fetchChecks = async () => ({ code: 'unavailable', message: 'rate limited' })
  await assert.rejects(f.service.checks('p', AbortSignal.timeout(1000)), { code: 'forge-unavailable' })
  delete f.ctx.forge
  assert.equal(f.service.status('p').state, 'unavailable')
  f.service.close()
})

test('PR diff detects head movement during read; capture stores full reference without acceptance effect', async () => {
  const f = fixture()
  await f.service.bind('p', bindingInput)
  const before = structuredClone(f.store.projects.get('p'))
  const original = f.snapshot()
  f.forge.diff = async () => { f.setSnapshot({ ...original, headSha: 'b'.repeat(40) }); return 'patch for another head' }
  await assert.rejects(f.service.diff('p', AbortSignal.timeout(1000)), { code: 'forge-head-stale' })
  f.setSnapshot(original)
  const captured = await f.service.capture('p', AbortSignal.timeout(1000))
  assert.equal(f.store.artifacts.get(captured.artifactId).metadata.acceptanceEffect, 'none')
  assert.equal(JSON.parse(f.store.artifacts.get(captured.artifactId).content).headSha, head)
  assert.deepEqual(f.store.projects.get('p'), before)
  f.service.close()
})

test('Host subprocess executes argv and shell, honors venv, scrubs secrets and waits cancellation/timeout', async () => {
  const ctx = new Context()
  const root = await mkdtemp(join(tmpdir(), 'po-native-commands-'))
  try {
    await ctx.plugin(LocalSubprocess)
    const runner = new CommandRunner(() => ctx.subprocess)
    const signal = new AbortController().signal
    const first = await runner.run({ cwd: root, command: [process.execPath, '-e', 'console.log("argv;literal")'], signal })
    assert.equal(first.backend, 'dsh_subprocess')
    assert.equal(first.output.trim(), 'argv;literal')
    assert.equal(first.exitCode, 0)
    assert.match((await runner.run({ cwd: root, command: 'printf shell-ok', signal })).output, /shell-ok/)
    await mkdir(join(root, '.venv', 'bin'), { recursive: true })
    const venv = await runner.run({ cwd: root, command: [process.execPath, '-e', 'console.log(process.env.VIRTUAL_ENV);console.log(process.env.DSH_SECRET ?? "no-secret")'], signal, environment: { DSH_SECRET: 'must-not-inherit', AUTH_TOKEN: 'must-not-inherit' } })
    assert.equal(venv.executionEnvironment, 'project_venv')
    assert.match(venv.output, /no-secret/)
    assert.doesNotMatch(venv.output, /must-not-inherit/)
    const large = await runner.run({ cwd: root, command: [process.execPath, '-e', 'process.stdout.write("x".repeat(2000))'], signal, outputLimit: 1000 })
    assert.equal(large.truncated, true)
    const failed = await runner.run({ cwd: root, command: [process.execPath, '-e', 'process.exit(7)'], signal })
    assert.equal(failed.exitCode, 7)
    await assert.rejects(runner.run({ cwd: root, command: ['po-does-not-exist'], signal }))
    const timeout = await runner.run({ cwd: root, command: [process.execPath, '-e', 'setInterval(()=>{},1000)'], signal, timeoutMs: 1000 })
    assert.equal(timeout.exitCode, 124)
    assert.equal(timeout.timedOut, true)
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 100)
    const cancelled = await runner.run({ cwd: root, command: [process.execPath, '-e', 'setInterval(()=>{},1000)'], signal: controller.signal })
    clearTimeout(timer)
    assert.equal(cancelled.exitCode, 130)
    assert.equal(cancelled.cancelled, true)
  } finally { await ctx.fiber.dispose(); await rm(root, { recursive: true, force: true }) }
})

test('Node command runner preserves literal argv and explicit authorized shell programs', async () => {
  const runner = new CommandRunner()
  const signal = new AbortController().signal
  const value = 'literal; $(echo injected) `echo injected` & | >'
  const literal = await runner.run({ cwd: tmpdir(), command: [process.execPath, '-e', 'console.log(process.argv[1])', value], signal })
  assert.equal(literal.exitCode, 0)
  assert.equal(literal.output.trim(), value)
  const shell = await runner.run({ cwd: tmpdir(), command: 'printf first && printf second', signal })
  assert.equal(shell.exitCode, 0)
  assert.equal(shell.output, 'firstsecond')
})

test('Host subprocess absence or failure never falls back to Node', async () => {
  const input = { cwd: tmpdir(), command: [process.execPath, '-e', 'throw new Error("must not run")'], signal: new AbortController().signal }
  await assert.rejects(new CommandRunner(() => undefined).run(input), { code: 'subprocess-unavailable' })
  await assert.rejects(new CommandRunner(() => ({ spawn() { throw new Error('provider failed') } })).run(input), /provider failed/)
  assert.deepEqual(filteredCommandEnvironment({ PATH: '/bin', DSH_HOME: '/private', AUTH_TOKEN: 'secret', OK: 'yes' }), { PATH: '/bin', OK: 'yes' })
})

test('read-only pilot rejects unapproved, stale or forged parent and consumes one durable attempt', async () => {
  const f = fixture()
  const parent = { id: 'root', model: { current: () => ({ provider: 'test', model: 'test' }) } }
  let calls = 0
  let registered
  const ctx = {
    agents: { get: () => parent },
    subagents: {
      registerProvider(provider) { registered = provider; return () => {} },
      async startActivation() {
        calls += 1
        return { childId: 'child', result: Promise.resolve({ stopReason: 'completed', output: [{ type: 'text', text: 'Review only' }] }), async dispose() {} }
      },
    },
  }
  const pilot = new NativeReadOnlyPilot(ctx, f.store, (work) => work())
  await assert.rejects(pilot.review('run', parent, 'evidence', new AbortController().signal), { code: 'native-review-parent-ineligible' })
  const run = { id: 'run', projectId: 'p', taskId: 'task', status: 'running', planSnapshotId: 'plan', agentId: 'member', executionDispatchId: 'dispatch', cwd: '/isolated/repo' }
  run.executionContractDigest = taskRunExecutionContractDigest(run)
  await f.store.taskRuns.put('run', run)
  await f.store.agents.put('member', { id: 'member', status: 'active' })
  await assert.rejects(pilot.review('run', parent, 'evidence', new AbortController().signal), { code: 'native-review-parent-stale' })
  pilot.attachParent('run', parent)
  const result = await pilot.review('run', parent, 'evidence', new AbortController().signal)
  await assert.rejects(registered.start({ parent: { ...parent }, cwd: '/isolated/repo', prompt: [] }), { code: 'native-review-unauthorized' })
  assert.equal(result.activationId, 'child')
  assert.equal(result.childSessionId, f.store.artifacts.get('native-review:run').metadata.childSessionId)
  assert.equal(f.store.artifacts.get('native-review:run').metadata.acceptanceEffect, 'none')
  await assert.rejects(pilot.review('run', parent, 'evidence', new AbortController().signal), { code: 'native-review-quota-exhausted' })
  assert.equal(calls, 1)
  pilot.detachParent('run', parent)
  pilot.close()
})

test('read-only pilot restart marks incomplete admission failed without dispatching or refunding quota', async () => {
  const f = fixture()
  await f.store.artifacts.put('native-review:old', { id: 'native-review:old', status: 'available', metadata: { state: 'admitted' } })
  const pilot = new NativeReadOnlyPilot({}, f.store, (work) => work())
  await pilot.recover()
  assert.equal(f.store.artifacts.get('native-review:old').metadata.state, 'interrupted')
  assert.equal(f.store.artifacts.get('native-review:old').status, 'failed')
})

test('read-only pilot preserves capacity failures and rejects late output after parent approval changes', async () => {
  for (const mode of ['capacity', 'late']) {
    const f = fixture()
    const parent = { id: 'root', model: { current: () => ({ provider: 'test', model: 'test' }) } }
    const run = { id: 'run', projectId: 'p', taskId: 'task', status: 'running', planSnapshotId: 'plan', agentId: 'member', executionDispatchId: 'dispatch', cwd: '/isolated/repo' }
    run.executionContractDigest = taskRunExecutionContractDigest(run)
    await f.store.taskRuns.put('run', run)
    await f.store.agents.put('member', { id: 'member', status: 'active' })
    let disposed = 0
    const ctx = { agents: { get: () => parent }, subagents: { registerProvider: () => () => {}, startActivation: async () => {
      if (mode === 'capacity') throw Object.assign(new Error('Capacity unavailable'), { code: 'ACTIVATION_LIMIT_REACHED' })
      await f.store.projects.put('p', { ...f.store.projects.get('p'), revision: 2 })
      return { childId: 'child', result: Promise.resolve({ stopReason: 'completed', output: [{ type: 'text', text: 'Late result' }] }), dispose: async () => { disposed += 1 } }
    } } }
    const pilot = new NativeReadOnlyPilot(ctx, f.store, (work) => work())
    pilot.attachParent('run', parent)
    await assert.rejects(pilot.review('run', parent, 'evidence', new AbortController().signal), { code: mode === 'capacity' ? 'ACTIVATION_LIMIT_REACHED' : 'native-review-parent-ineligible' })
    const artifact = f.store.artifacts.get('native-review:run')
    assert.equal(artifact.status, 'failed')
    assert.equal(artifact.metadata.acceptanceEffect, 'none')
    assert.doesNotMatch(artifact.content, /Late result/)
    assert.equal(disposed, mode === 'late' ? 1 : 0)
    await f.store.projects.put('p', { ...f.store.projects.get('p'), revision: 1 })
    await assert.rejects(pilot.review('run', parent, 'evidence', new AbortController().signal), { code: 'native-review-quota-exhausted' })
    pilot.close()
  }
})
