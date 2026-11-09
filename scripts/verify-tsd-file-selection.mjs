import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { execFileSync, spawnSync } from 'node:child_process'
import { readFile, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'

// Controlled type-tool fixture only. Never edit or run upstream repositories.
const [directoryArgument, destination] = process.argv.slice(2)
assert.ok(directoryArgument && destination)
const directory = resolve(directoryArgument)
const fixture = join(directory, 'fixture')
const archive = join(directory, 'tsd-0.33.0.tgz')
const hash = bytes => createHash('sha256').update(bytes).digest('hex')
const cli = execFileSync('tar', ['-xOf', archive, 'package/dist/cli.js'], { encoding: 'utf8' })
const loader = execFileSync('tar', ['-xOf', archive, 'package/dist/lib/index.js'], { encoding: 'utf8' })
assert.match(cli, /files:\s*\{\s*type: 'string',[\s\S]*?isMultiple: true/u)
assert.match(loader, /findCustomTestFiles\(options\.testFiles, options\.cwd\)/u)
assert.ok(loader.includes('(0, config_1.default)(pkg, options.cwd)'), 'Explicit files must retain repository configuration loading')
const installed = JSON.parse(await readFile(join(fixture, 'node_modules/tsd/package.json'), 'utf8'))
assert.equal(installed.version, '0.33.0')
const invoke = file => {
  const args = ['exec', '--', 'tsd', '--files', file]
  const result = spawnSync('npm', args, { cwd: fixture, encoding: 'utf8', env: { ...process.env, npm_config_offline: 'true' } })
  assert.ifError(result.error)
  return { args, exitCode: result.status, output: result.stdout + result.stderr }
}
const readonly = invoke('index.test-d.ts')
assert.equal(readonly.exitCode, 0, readonly.output)
const writable = invoke('writable.test-d.ts')
assert.notEqual(writable.exitCode, 0)
assert.match(writable.output, /Expected an error, but found none/u)
const missing = invoke('missing.test-d.ts')
assert.notEqual(missing.exitCode, 0)
assert.match(missing.output, /Could not find any test files/u)
const report = { observedAt: new Date().toISOString(), status: 'explicit_tsd_file_selection_verified',
  tsdVersion: installed.version, archiveSha256: hash(await readFile(archive)), cliSha256: hash(cli), loaderSha256: hash(loader),
  fixture, observations: { readonly, writable, missing },
  scope: 'Controlled readonly declaration fixture; not upstream implementation or a release candidate.',
  benchmarkRepositoryWrites: 0, modelRequests: 0, domainMutations: 0, releaseCandidate: false }
await writeFile(destination, JSON.stringify(report, null, 2), { flag: 'wx' })
console.log(JSON.stringify(report))
