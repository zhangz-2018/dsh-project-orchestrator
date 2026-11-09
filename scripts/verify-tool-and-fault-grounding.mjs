import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { resolve, join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { setImmediate as nextTurn } from 'node:timers/promises'
import { captureVerificationToolEvidenceV3 } from '../lib/index.js'

// Evidence for existing mechanics only. Never implement benchmark features,
// mutate their repositories, dispatch tasks, or claim a release candidate.
const destination = process.argv[2]
assert.ok(destination)
const parent = resolve('output/acceptance/repositories')
const hash = data => createHash('sha256').update(data).digest('hex')
const repositories = ['hono', 'ky', 'mitt', 'p-limit', 'p-map', 'p-queue', 'p-retry', 'zod']
const git = repo => execFileSync('git', ['status', '--porcelain=v1'], { cwd: join(parent, repo) }).toString()
const before = Object.fromEntries(repositories.map(repo => [repo, git(repo)]))
assert.ok(Object.values(before).every(status => status === ''))
const manifest = JSON.parse(await readFile(join(parent, 'p-queue/package.json'), 'utf8'))
const tools = await captureVerificationToolEvidenceV3(join(parent, 'p-queue'), manifest)
const nz = tools.find(t => t.packageName === 'nz')
const compiler = tools.find(t => t.packageName === 'typescript')
assert.equal(nz?.version, '0.1.0')
assert.equal(compiler?.version, '6.0.3')
assert.deepEqual(nz.unavailablePaths, [])
const runner = nz.files.find(f => f.path === 'source/runner.js').content
assert.match(runner, /const testDirectories = \['test-d', 'typetests'\]/u)
assert.match(runner, /extends: path.join\(root, 'tsconfig.json'\)/u)
assert.match(runner, /files: \[\.\.\.files, typeCheckPath\]/u)
assert.match(runner, /resolveFromRoot\(root, 'typescript\/package.json'\)/u)
const fixture = await mkdtemp(join(parent, '.tool-grounding-fixture-'))
await mkdir(join(fixture, 'source'))
await mkdir(join(fixture, 'test-d'))
await writeFile(join(fixture, 'package.json'), JSON.stringify({ name: 'tool-grounding-fixture', version: '1.0.0', type: 'module', types: 'index.d.ts', scripts: { probe: 'nz --show-config', verify: 'nz' } }))
await writeFile(join(fixture, 'index.d.ts'), 'export interface Value { readonly count: number }\n')
await writeFile(join(fixture, 'source/index.ts'), 'export {};\n')
await writeFile(join(fixture, 'tsconfig.json'), JSON.stringify({ compilerOptions: { strict: true, noEmit: true, module: 'NodeNext', target: 'ESNext', types: [], rootDir: 'source' }, include: ['source'] }))
await writeFile(join(fixture, 'test-d/index.test-d.ts'), 'import type {Value} from "../index.js";\ndeclare const value: Value;\nconst count: number = value.count;\n// @ts-expect-error: readonly contract\nvalue.count = 2;\n')
const invoke = script => {
  try { return { exitCode: 0, output: execFileSync('npm', ['run', script, '--offline'], { cwd: fixture, encoding: 'utf8' }) } }
  catch (error) { return { exitCode: error.status, output: String(error.stdout) + String(error.stderr) } }
}
const discovery = invoke('probe')
assert.equal(discovery.exitCode, 0, discovery.output)
assert.match(discovery.output, /test-d\/index.test-d.ts/u)
const positive = invoke('verify')
assert.equal(positive.exitCode, 0, positive.output)
await writeFile(join(fixture, 'index.d.ts'), 'export interface Value { count: number }\n')
const negative = invoke('verify')
assert.notEqual(negative.exitCode, 0)
assert.match(negative.output, /TS2578|Unused '@ts-expect-error'/u)
const sourcePath = join(parent, 'p-map/index.js')
const source = await readFile(sourcePath)
const { default: pMap } = await import(pathToFileURL(sourcePath).href)
const observations = []
for (const connected of [false, true]) {
  const controller = new AbortController()
  const sentinel = new Error('abort identity')
  const releases = [], started = []
  let settled = false, rejected, result
  const promise = pMap([1, 2], async value => { started.push(value); await new Promise(done => releases.push(done)); return value }, { concurrency: 2, ...(connected ? { signal: controller.signal } : {}) })
  const observed = promise.then(value => { settled = true; result = value }, error => { settled = true; rejected = error })
  await nextTurn()
  assert.deepEqual(started, [1, 2])
  controller.abort(sentinel)
  await nextTurn()
  assert.equal(settled, connected)
  assert.equal(rejected === sentinel, connected)
  observations.push({ connected, started: [...started], settledAfterAbortBeforeRelease: settled, exactAbortReason: rejected === sentinel })
  releases.forEach(done => done())
  await observed
  if (!connected) assert.deepEqual(result, [1, 2])
}
assert.deepEqual(await readFile(sourcePath), source)
const after = Object.fromEntries(repositories.map(repo => [repo, git(repo)]))
assert.deepEqual(after, before)
const report = { status: 'installed_tool_and_fault_grounding_verified', observedAt: new Date().toISOString(),
  installedVia: 'offline local tarballs in isolated evaluation parent node_modules; upstream repositories untouched',
  tools: tools.map(tool => ({ ...tool, files: tool.files.map(({ content, ...file }) => ({ ...file, bytes: Buffer.byteLength(content) })) })),
  fixture, discovery, positive, negative, faultObservations: observations, pmapSourceSha256: hash(source),
  benchmarkRepositoryWrites: 0, modelRequests: 0, releaseCandidate: false }
await writeFile(destination, JSON.stringify(report, null, 2), { flag: 'wx' })
console.log(JSON.stringify({ destination, status: report.status, compiler: compiler.version, tool: nz.version, positiveExitCode: positive.exitCode, negativeExitCode: negative.exitCode, faultObservations: observations }))
