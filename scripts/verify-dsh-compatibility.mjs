import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { setTimeout as delay } from 'node:timers/promises'

const sourceRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
// 必须显式指定隔离安装目录，禁止复用用户的 Harness home。
const installRoot = process.env.PO_DSH_COMPAT_ROOT
if (!installRoot) throw new Error('PO_DSH_COMPAT_ROOT must name an isolated dsh installation.')
const root = resolve(installRoot)
const expectedVersion = '0.2.2-rc.1'
const dsh = JSON.parse(await readFile(join(root, 'node_modules/@deepseek-ai/dsh/package.json'), 'utf8'))
assert.equal(dsh.version, expectedVersion)
const [nodeMajor, nodeMinor] = process.versions.node.split('.').map(Number)
assert.ok(nodeMajor > 24 || (nodeMajor === 24 && nodeMinor >= 9), 'Run with Node.js >=24.9.0')
const digest = (bytes) => createHash('sha256').update(bytes).digest('hex')
const hashes = {}
for (const file of ['lib/index.js', 'lib/client.js', 'package.json']) {
  const [source, installed] = await Promise.all([readFile(join(sourceRoot, file)), readFile(join(root, 'node_modules/dsh-project-orchestrator', file))])
  assert.equal(digest(installed), digest(source), `Repack and install current ${file} before testing`)
  hashes[file] = digest(source)
}
const home = await mkdtemp(join(root, 'compat-home-'))
const patch = join(home, 'compat.patch.yml')
const provider = join(sourceRoot, 'tests/support/dsh-compat-provider.mjs')
await writeFile(patch, `- insert:\n    - id: po-compat-provider\n      name: ${JSON.stringify(provider)}\n    - id: project-orchestrator\n      name: dsh-project-orchestrator\n- id: agent-default-model\n  config:\n    provider: po-compat\n    model: compat\n- id: session-title-llm\n  disabled: true\n`)
const checks = []
let child
let origin
let startup = ''

/** 在独立 home 启动真实 CLI，启动失败或超时会终止本轮验收。 */
async function start() {
  startup = ''
  child = spawn(process.execPath, [join(root, 'node_modules/@deepseek-ai/dsh/lib/bin.js'), 'web', '--patch', patch, '--no-open', '--port', '0'], {
    cwd: root,
    env: { ...process.env, DSH_HOME: home, DSH_TELEMETRY_DISABLED: '1', DSH_PROJECT_ORCHESTRATOR_LOCK_DIR: join(home, 'locks') },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  for (const stream of [child.stdout, child.stderr]) stream.on('data', (chunk) => { startup += chunk })
  const deadline = Date.now() + 60000
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`Harness exited: ${startup}`)
    const match = startup.match(/dsh web: (http:\/\/127\.0\.0\.1:\d+\/\?token=[^\s]+)/)
    if (match) {
      assert.doesNotMatch(startup, /did not activate|failed to import/)
      origin = new URL(match[1]).origin
      return
    }
    await delay(100)
  }
  throw new Error('Harness startup timed out')
}

/** 停止且等待本脚本创建的 Host 退出；超时仅终止该子进程。 */
async function stop() {
  if (!child || child.exitCode !== null) return
  const exited = once(child, 'exit')
  child.kill('SIGTERM')
  const timer = setTimeout(() => child.kill('SIGKILL'), 10000)
  try { await exited } finally { clearTimeout(timer) }
}

/** 调用隔离回环 API，校验 HTTP 状态，所有请求都带有限超时。 */
async function request(path, payload, status = 200) {
  const response = await fetch(`${origin}${path}`, {
    ...(payload === undefined ? {} : { method: 'POST', headers: { 'content-type': 'application/json', origin }, body: JSON.stringify(payload) }),
    signal: AbortSignal.timeout(30000),
  })
  const value = await response.json()
  assert.equal(response.status, status, JSON.stringify(value))
  return value
}

try {
  await start()
  const api = '/project-orchestrator/api'
  const bootstrap = await request(`${api}/bootstrap`)
  assert.ok(bootstrap)
  checks.push('real-host-plugin-activation')
  const native = await request(`${api}/native-capabilities`)
  assert.equal(native.commandBackend, 'dsh_subprocess')
  assert.equal(native.capabilities.find((item) => item.id === 'subprocess').state, 'present')
  assert.equal(native.capabilities.find((item) => item.id === 'subagents').state, 'present')
  checks.push('real-host-native-capability-diagnostics')
  const draft = await request(`${api}/agents/draft`, { requirement: 'PO_COMPAT_SUCCESS' })
  assert.equal(draft.name, 'Compatibility reviewer')
  checks.push('real-agent-preset-stream-query-disposal')
  const failed = await request(`${api}/agents/draft`, { requirement: 'PO_COMPAT_FAILURE' }, 502)
  assert.equal(failed.error.code, 'agent-turn-failed')
  checks.push('model-failure-is-visible')
  await request(`${api}/agents/draft`, { requirement: 'PO_COMPAT_GUARD' })
  const state = await request('/__po_compat/state')
  assert.ok(state.toolDenials > 0, JSON.stringify(state))
  assert.equal(state.probeExecutions, 0)
  assert.equal(state.activeAgents, 0)
  checks.push('real-tool-guard-denial-and-no-agent-leak')
  const cancelled = await request('/__po_compat/cancel')
  assert.equal(cancelled.terminal?.kind, 'aborted', JSON.stringify(cancelled))
  assert.equal((await request('/__po_compat/state')).activeAgents, 0)
  checks.push('real-agent-cancellation-and-disposal')
  const reviewed = await request('/__po_compat/native-pilot')
  assert.equal(reviewed.ok, true, JSON.stringify(reviewed))
  assert.equal(reviewed.artifact.metadata.acceptanceEffect, 'none')
  assert.equal(reviewed.artifact.metadata.state, 'completed')
  assert.ok(reviewed.childSessionId)
  assert.notEqual(reviewed.childSessionId, reviewed.activationId)
  assert.equal(reviewed.modelCalls, 1)
  const childStopped = await request('/__po_compat/native-pilot?mode=cancel')
  assert.equal(childStopped.ok, false, JSON.stringify(childStopped))
  assert.equal(childStopped.artifact.metadata.state, 'cancelled')
  const childDenied = await request('/__po_compat/native-pilot?mode=guard')
  assert.equal(childDenied.ok, false, JSON.stringify(childDenied))
  assert.equal(childDenied.modelCalls, 1, 'Tool denial must not consume a second model request')
  assert.equal((await request('/__po_compat/state')).probeExecutions, 0)
  assert.equal((await request('/__po_compat/state')).activeAgents, 0)
  checks.push('real-native-subagent-result-cancel-deny-and-disposal')
  const project = await request(`${api}/projects`, { name: 'dsh 0.2.2 compatibility', cwd: root, mode: 'empty' }, 201)
  await stop()
  await start()
  const snapshot = await request(`${api}/snapshot`)
  assert.equal(snapshot.projects.find((item) => item.id === project.id)?.name, 'dsh 0.2.2 compatibility')
  checks.push('storage-domain-write-and-host-restart')
  const report = { status: 'passed', dshVersion: expectedVersion, nodeVersion: process.version, platform: process.platform, modelMode: 'local-deterministic-adapter-no-external-model', home, hashes, checks, completedAt: new Date().toISOString() }
  const reportRoot = join(sourceRoot, 'output/compatibility')
  await mkdir(reportRoot, { recursive: true })
  const reportPath = join(reportRoot, `dsh-${expectedVersion}-${Date.now()}.json`)
  await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`)
  process.stdout.write(`Compatibility passed: ${checks.length} checks. Report: ${reportPath}\n`)
} finally {
  await stop()
}
