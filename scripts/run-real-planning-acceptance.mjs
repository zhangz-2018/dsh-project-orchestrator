import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { promisify } from 'node:util'
import { randomUUID } from 'node:crypto'

const arguments_ = process.argv.slice(2)
const resume = arguments_.includes('--resume')
const snapshotOnly = arguments_.includes('--snapshot')
const startOnResume = arguments_.includes('--start-on-resume')
const retryLatest = arguments_.includes('--retry-latest')
if (snapshotOnly && !resume) throw new Error('--snapshot requires --resume; it only observes an existing run.')
if (startOnResume && (!resume || snapshotOnly)) throw new Error('--start-on-resume requires --resume and cannot be combined with --snapshot.')
if (retryLatest && (!resume || snapshotOnly || startOnResume)) throw new Error('--retry-latest requires --resume and cannot be combined with another start or snapshot mode.')
const base = (arguments_.find((argument) => !argument.startsWith('--')) ?? 'http://127.0.0.1:3087').replace(/\/$/u, '')
if (new URL(base).hostname !== '127.0.0.1') throw new Error('Acceptance requires an isolated loopback Harness.')
const prepared = JSON.parse(await readFile(resolve('output/acceptance/isolated-harness-2026-10-14.json'), 'utf8'))
const workspace = join(prepared.root, 'workspaces/greeting')
const run = promisify(execFile)
const reportPath = resolve('output/acceptance/real-planning-2026-10-14.json')
let report = resume ? JSON.parse(await readFile(reportPath, 'utf8')) : {
  status: 'running', baseUrl: base, workspace, modelProvider: prepared.modelProvider,
  modelId: prepared.modelId, startedAt: new Date().toISOString(),
}
if (resume && (report.baseUrl !== base || report.workspace !== workspace || !report.projectId)) throw new Error('Resume must use the original isolated Host, workspace, and Project.')
const persist = () => writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`)
const request = async (path, body) => {
  const response = await fetch(`${base}/project-orchestrator/api${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { 'content-type': 'application/json', origin: base },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    signal: AbortSignal.timeout(30_000),
  })
  const result = await response.json()
  if (!response.ok) throw new Error(`${path}: HTTP ${response.status}: ${result.error?.code ?? 'unknown'}: ${result.error?.message ?? ''}`)
  return result
}
// Reserve the report before creating files; reruns must explicitly resume.
if (!resume) await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, { flag: 'wx' })
try {
if (!resume) {
await mkdir(join(workspace, 'src'), { recursive: true })
await mkdir(join(workspace, 'tests'), { recursive: true })
const files = {
  'package.json': `${JSON.stringify({ name: 'orchestrator-greeting-canary', private: true, type: 'module', scripts: { test: 'node --experimental-strip-types --test tests/*.test.ts' } }, null, 2)}\n`,
  'src/greeting.ts': 'export function greet(name: string): string {\n  return `Hello, ${name}!`\n}\n',
  'tests/greeting.test.ts': "import assert from 'node:assert/strict'\nimport test from 'node:test'\nimport { greet } from '../src/greeting.ts'\n\ntest('greets a nonempty name', () => {\n  assert.equal(greet('Ada'), 'Hello, Ada!')\n})\n",
  'README.md': '# Greeting acceptance repository\n\nA dependency-free TypeScript library. Run `npm test`.\n',
}
for (const [path, text] of Object.entries(files)) await writeFile(join(workspace, path), text, { flag: 'wx' })
await run('git', ['init', '--initial-branch=main', workspace])
await run('git', ['-C', workspace, 'config', 'user.name', 'Orchestrator acceptance'])
await run('git', ['-C', workspace, 'config', 'user.email', 'acceptance@example.invalid'])
await run('git', ['-C', workspace, 'add', '.'])
await run('git', ['-C', workspace, 'commit', '-m', 'test: freeze greeting acceptance baseline'])
const baselineTests = await run('npm', ['test'], { cwd: workspace })
assert.match(baselineTests.stdout, /# pass 1/u)
const { stdout } = await run('git', ['-C', workspace, 'rev-parse', 'HEAD'])
report.baselineCommit = stdout.trim()
report.baselineTestsPassed = true
await persist()
const prd = 'REQ-TRIM: 在 src/greeting.ts 的 greet(name: string) 中去除姓名首尾空白。AC-TRIM: greet(" Ada ") 必须返回 "Hello, Ada!"。AC-REJECT: 空字符串或只有空白的姓名必须抛出 TypeError。AC-COMPAT: greet("Ada") 的既有输出保持 "Hello, Ada!"。在 tests/greeting.test.ts 增加这三个行为的自动回归验证，执行仓库已有的 npm test。只允许修改 src/greeting.ts 和 tests/greeting.test.ts，不新增依赖，不改变导出名或函数签名。实现任务和独立验证任务分别交由实现成员与测试成员。'
const project = await request('/projects', { mode: 'empty', name: '2026-10-14 真实规划验收', cwd: workspace, prd, technicalDesign: '按现有无依赖 TypeScript 模块与 node:test 实现；代码 owner 是 src/greeting.ts，回归 owner 是 tests/greeting.test.ts。', taskLanguage: 'zh-CN' })
report.projectId = project.id
await persist()
for (const [agentId, deliveryRoles] of [
  ['default-agent-software-engineer', ['implementer']],
  ['default-agent-test-engineer', ['verifier']],
  ['default-agent-code-reviewer', ['reviewer']],
]) await request(`/projects/${project.id}/agents`, { agentId, deliveryRoles, autoAssignable: true, joinedBy: '用户授权的隔离验收' })
report.readiness = await request(`/projects/${project.id}/readiness`)
await persist()
report.phase = 'decompose_request'
await persist()
await request(`/projects/${project.id}/decompose`, {})
console.log(JSON.stringify({ type: 'started', projectId: project.id, reportPath }))
}
const projectId = report.projectId
if (resume) {
  report.readiness = await request(`/projects/${projectId}/readiness`)
  report.readinessObservedAt = new Date().toISOString()
  await persist()
}
if (retryLatest) {
  const operations = await request(`/projects/${projectId}/planning-operations`)
  const latest = operations.toSorted((left, right) => right.createdAt.localeCompare(left.createdAt) || right.id.localeCompare(left.id))[0]
  if (!latest || !['failed', 'blocked'].includes(latest.status)) throw new Error('Only an existing terminal operation can be retried through the Service gate.')
  report.previousObservations = [...(report.previousObservations ?? []), {
    status: report.status, operationId: latest.id, operationStatus: latest.status,
    stage: latest.stage, diagnostics: latest.diagnostics, completedAt: latest.completedAt,
    modelProvider: report.modelProvider, modelId: report.modelId,
  }]
  report.phase = 'retry_request'
  await persist()
  await request(`/projects/${projectId}/planning-operations/${encodeURIComponent(latest.id)}/retry`, {
    expectedOperationUpdatedAt: latest.updatedAt, idempotencyKey: `acceptance-${randomUUID()}`,
  })
}
if (startOnResume) {
  const operations = await request(`/projects/${projectId}/planning-operations`)
  if (operations.length > 0) throw new Error('An existing operation must be observed or repaired through its own explicit workflow.')
  report.previousObservations = [...(report.previousObservations ?? []), {
    status: report.status, modelProvider: report.modelProvider, modelId: report.modelId,
    startedAt: report.startedAt, lastObservedAt: report.lastObservedAt,
  }]
  report.modelProvider = prepared.modelProvider
  report.modelId = prepared.modelId
  report.startedAt = new Date().toISOString()
  report.phase = 'decompose_request'
  await persist()
  await request(`/projects/${projectId}/decompose`, {})
}
report.phase = 'observing'
report.status = 'running'
delete report.observationError
delete report.finishedAt
await persist()
let lastStage
const deadline = Date.now() + 15 * 60_000
while (Date.now() < deadline) {
  const operations = await request(`/projects/${projectId}/planning-operations`)
  const operation = operations.toSorted((left, right) => right.createdAt.localeCompare(left.createdAt) || right.id.localeCompare(left.id))[0]
  report.lastObservedAt = new Date().toISOString()
  if (operation !== undefined) {
    if (report.operationId !== undefined && report.operationId !== operation.id) {
      const previousObservations = report.previousObservations ?? []
      if (!previousObservations.some((item) => item.operationId === report.operationId)) {
        previousObservations.push({ operationId: report.operationId, operationStatus: report.operationStatus,
          stage: report.stage, diagnostics: report.diagnostics, completedAt: report.operationCompletedAt,
          modelProvider: report.modelProvider, modelId: report.modelId })
      }
      report.previousObservations = previousObservations
      delete report.diagnostics
    }
    if (operation.stage !== lastStage) {
      lastStage = operation.stage
      console.log(JSON.stringify({ type: 'stage', status: operation.status, stage: operation.stage }))
    }
    report.operationId = operation.id
    report.operationStartedAt = operation.createdAt
    report.operationCompletedAt = operation.completedAt
    report.operationStatus = operation.status
    report.stage = operation.stage
    report.modelProvenanceAvailable = operation.modelExecutionProvenance !== undefined
    if (operation.status !== 'running') {
      report.status = operation.status === 'committed' ? 'planning_passed' : 'planning_not_passed'
      report.diagnostics = operation.diagnostics
      report.finishedAt = new Date().toISOString()
      await persist()
      console.log(JSON.stringify(report))
      if (operation.status !== 'committed') process.exitCode = 1
      break
    }
    await persist()
  }
  if (snapshotOnly) {
    report.status = operation === undefined ? 'no_operation_observed' : 'operation_running'
    await persist()
    console.log(JSON.stringify({ status: report.status, projectId, operationId: report.operationId, reportPath }))
    process.exitCode = 1
    break
  }
  await new Promise((resolveWait) => setTimeout(resolveWait, 5000))
}
if (report.status === 'running') {
  report.status = 'observation_timeout'
  report.lastObservedAt = new Date().toISOString()
  await persist()
  console.error('The observation deadline expired; the operation is not an acceptance pass.')
  process.exitCode = 1
}
} catch (error) {
  // Observation failure does not imply that the server-side operation stopped.
  report.status = 'observation_failed'
  report.lastObservedAt = new Date().toISOString()
  report.observationError = { name: error.name }
  await persist()
  console.error(JSON.stringify({ status: report.status, phase: report.phase, errorName: error.name, reportPath }))
  process.exitCode = 1
}
