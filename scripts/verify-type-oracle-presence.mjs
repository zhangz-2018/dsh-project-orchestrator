import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { mkdtemp, readFile, realpath, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// Reproduce a retained compiler-oracle defect using frozen declaration/tests
// in a new controlled fixture. No benchmark-repository or domain writes.
const [destination] = process.argv.slice(2)
assert.ok(destination)
const operationId = 'planning-v3:00daebb1-7969-41df-9b78-7421b5529a0f'
const snapshot = await (await fetch('http://127.0.0.1:3087/project-orchestrator/api/snapshot')).json()
const operation = snapshot.planningOperations.find(o => o.id === operationId)
assert.equal(operation.status, 'blocked')
const review = snapshot.scenarioCoverageReviews.find(r => r.id === operation.scenarioCoverageReviewId)
assert.ok(review.findings.some(f => f.code === 'TYPE_ORACLE_ACCEPTS_MISSING_COUNTER_DECLARATIONS'))
const frozen = path => {
  const file = review.repositoryEvidence.contents.find(f => f.path === path)
  assert.ok(file && !file.truncated)
  return file.content
}
const declaration = frozen('index.d.ts')
const tests = frozen('index.test-d.ts')
const marker = "Pick<LimitFunction, 'clearQueue'>"
assert.equal(declaration.split(marker).length, 2)
const toolProof = JSON.parse(await readFile('output/acceptance/tsd-selection-trigger-v26-2026-10-16.json', 'utf8'))
const dependencies = await realpath(join(toolProof.fixture, 'node_modules'))
const installed = JSON.parse(await readFile(join(dependencies, 'tsd/package.json'), 'utf8'))
assert.equal(installed.version, '0.33.0')
const fixture = await mkdtemp(join(tmpdir(), 'po-type-oracle-presence-'))
await symlink(dependencies, join(fixture, 'node_modules'), 'dir')
await writeFile(join(fixture, 'package.json'), JSON.stringify({ name: 'controlled-type-oracle-presence', version: '1.0.0', type: 'module', types: 'index.d.ts', devDependencies: { tsd: '0.33.0' } }), { flag: 'wx' })
const negative = '\nexpectError(lf.activeCount = 99);\nexpectError(lf.pendingCount = 99);\n'
const positive = '\nexpectType<number>(lf.activeCount);\nexpectType<number>(lf.pendingCount);\n'
const cases = [
  { name: 'missing-negative-only', declaration, assertions: negative, expectedExitCode: 0 },
  { name: 'missing-positive-and-negative', declaration, assertions: positive + negative, expectedExitCode: 1, diagnostic: /does not exist/u },
  { name: 'readonly-number', declaration: declaration.replace(marker, "Pick<LimitFunction, 'clearQueue' | 'activeCount' | 'pendingCount'>"), assertions: positive + negative, expectedExitCode: 0 },
  { name: 'writable-number', declaration: declaration.replace(marker, "Pick<LimitFunction, 'clearQueue'> & {activeCount: number; pendingCount: number}"), assertions: positive + negative, expectedExitCode: 1, diagnostic: /Expected an error, but found none/u },
  { name: 'readonly-string', declaration: declaration.replace(marker, "Pick<LimitFunction, 'clearQueue'> & {readonly activeCount: string; readonly pendingCount: string}"), assertions: positive + negative, expectedExitCode: 1, diagnostic: /not assignable/u },
]
const observations = []
for (const example of cases) {
  await writeFile(join(fixture, 'index.d.ts'), example.declaration)
  await writeFile(join(fixture, 'index.test-d.ts'), tests + example.assertions)
  const args = ['exec', '--', 'tsd', '--files', 'index.test-d.ts']
  const result = spawnSync('npm', args, { cwd: fixture, encoding: 'utf8', env: { ...process.env, npm_config_offline: 'true' } })
  assert.ifError(result.error)
  const output = result.stdout + result.stderr
  assert.equal(result.status, example.expectedExitCode, `${example.name}: ${output}`)
  if (example.diagnostic) assert.match(output, example.diagnostic)
  observations.push({ name: example.name, exitCode: result.status, args, output, declaration: example.declaration, tests: tests + example.assertions })
}
const hash = text => createHash('sha256').update(text).digest('hex')
const report = { observedAt: new Date().toISOString(), status: 'type_oracle_presence_verified', operationId, reviewDigest: review.reviewDigest,
  tsdVersion: installed.version, fixture, originalDeclarationSha256: hash(declaration), originalTestsSha256: hash(tests), observations,
  conclusion: 'Negative-only assertions accept missing properties; positive reads plus negative writes reject missing, writable and wrong-type declarations while accepting readonly numeric counters.',
  scope: 'Frozen upstream declarations and tests in a controlled fixture; no upstream implementation and no release candidate.',
  benchmarkRepositoryWrites: 0, modelRequests: 0, domainMutations: 0, releaseCandidate: false }
await writeFile(destination, JSON.stringify(report, null, 2), { flag: 'wx' })
console.log(JSON.stringify({ destination, status: report.status, observations: observations.map(({ name, exitCode }) => ({ name, exitCode })) }))
