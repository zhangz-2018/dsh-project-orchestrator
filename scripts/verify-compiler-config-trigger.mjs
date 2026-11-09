import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { execFileSync, spawnSync } from 'node:child_process'
import { mkdir, mkdtemp, readFile, realpath, symlink, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'

// Isolated compiler experiment; never install dependencies or write benchmark repos.
const [toolDirectory, destination] = process.argv.slice(2)
assert.ok(toolDirectory && destination)
const compiler = resolve(toolDirectory, 'package/bin/tsc')
const version = JSON.parse(await readFile(resolve(toolDirectory, 'package/package.json'), 'utf8')).version
assert.equal(version, '6.0.3')
const hash = bytes => createHash('sha256').update(bytes).digest('hex')
const archive = resolve(toolDirectory, 'nz-0.1.0.tgz')
const runner = execFileSync('tar', ['-xOf', archive, 'package/source/runner.js'], { encoding: 'utf8' })
assert.match(runner, /const testDirectories = \['test-d', 'typetests'\]/u)
assert.match(runner, /extends: path.join\(root, 'tsconfig.json'\)/u)
assert.match(runner, /files: \[\.\.\.files, typeCheckPath\]/u)
assert.ok(/compilerArguments.push\(\s*'--project',\s*configPath,/u.test(runner), 'Frozen nz must compile its derived project configuration')
const root = await mkdtemp(join(resolve(toolDirectory), 'fixture-'))
await mkdir(join(root, 'source'))
await mkdir(join(root, 'test-d'))
await writeFile(join(root, 'tsconfig.json'), JSON.stringify({ compilerOptions: { strict: true, noEmit: true, exactOptionalPropertyTypes: true, target: 'ESNext', module: 'NodeNext' }, include: ['source'] }), { flag: 'wx' })
await writeFile(join(root, 'source/index.ts'), 'export type Options = { enabled?: boolean };\n', { flag: 'wx' })
const fixture = join(root, 'test-d/index.test-d.ts')
const validNegative = 'import type { Options } from "../source/index.js";\n// @ts-expect-error: inherited exactOptionalPropertyTypes rejects explicit undefined\nconst invalid: Options = { enabled: undefined };\n'
await writeFile(fixture, validNegative, { flag: 'wx' })
const compile = args => {
  const result = spawnSync(process.execPath, [compiler, ...args], { cwd: root, encoding: 'utf8' })
  assert.ifError(result.error)
  return { args, exitCode: result.status, output: result.stdout + result.stderr }
}
const direct = compile(['--noEmit', '--strict', '--target', 'ESNext', '--module', 'NodeNext', '--moduleResolution', 'NodeNext', '--skipLibCheck', 'test-d/index.test-d.ts'])
assert.notEqual(direct.exitCode, 0)
assert.match(direct.output, /TS5112/u)
const ignored = compile(['--ignoreConfig', '--noEmit', '--strict', '--target', 'ESNext', '--module', 'NodeNext', 'test-d/index.test-d.ts'])
assert.notEqual(ignored.exitCode, 0)
assert.match(ignored.output, /TS2578/u)
const config = join(root, 'type-tests.json')
await writeFile(config, JSON.stringify({ extends: './tsconfig.json', files: ['./test-d/index.test-d.ts'], include: [] }), { flag: 'wx' })
const inherited = compile(['--project', config])
assert.equal(inherited.exitCode, 0, inherited.output)
await writeFile(fixture, validNegative.replace('// @ts-expect-error: inherited exactOptionalPropertyTypes rejects explicit undefined\n', ''))
const exposed = compile(['--project', config])
assert.notEqual(exposed.exitCode, 0)
assert.match(exposed.output, /exactOptionalPropertyTypes/u)
// A project outside the repository has different default ambient type roots,
// even when it extends the repository config. Use real installed Node types.
const nodeTypes = await realpath('node_modules/@types/node')
const nodeTypesVersion = JSON.parse(await readFile(join(nodeTypes, 'package.json'), 'utf8')).version
await mkdir(join(root, 'node_modules/@types'), { recursive: true })
await symlink(nodeTypes, join(root, 'node_modules/@types/node'), 'dir')
const baseConfig = JSON.parse(await readFile(join(root, 'tsconfig.json'), 'utf8'))
baseConfig.compilerOptions.types = ['node']
await writeFile(join(root, 'tsconfig.json'), JSON.stringify(baseConfig))
const ambientFixture = join(root, 'test-d/ambient.test-d.ts')
await writeFile(ambientFixture, 'export const version: string = process.version;\n', { flag: 'wx' })
const detached = await mkdtemp(join(resolve(toolDirectory), 'detached-harness-'))
const detachedConfig = join(detached, 'tsconfig.json')
const detachedInput = { extends: join(root, 'tsconfig.json'), compilerOptions: { noEmit: true, rootDir: root }, files: [ambientFixture], include: [] }
await writeFile(detachedConfig, JSON.stringify(detachedInput), { flag: 'wx' })
const unresolvedAmbient = compile(['--project', detachedConfig])
assert.notEqual(unresolvedAmbient.exitCode, 0)
assert.match(unresolvedAmbient.output, /TS2688[\s\S]*node/u)
await writeFile(detachedConfig, JSON.stringify({ ...detachedInput, compilerOptions: { ...detachedInput.compilerOptions, typeRoots: [join(root, 'node_modules/@types')] } }))
const resolvedAmbient = compile(['--project', detachedConfig])
assert.equal(resolvedAmbient.exitCode, 0, resolvedAmbient.output)
const report = { status: 'compiler_configuration_trigger_verified', observedAt: new Date().toISOString(), compilerVersion: version,
  compilerArchiveSha256: hash(await readFile(resolve(toolDirectory, 'typescript-6.0.3.tgz'))), nzArchiveSha256: hash(await readFile(archive)),
  nzRunnerSha256: hash(runner), frozenNzDiscoversTestDAndPreservesProjectConfig: true, experimentRoot: root,
  ambientTypeExperiment: { detachedProjectDirectory: detached, nodeTypesVersion, nodeTypesSource: nodeTypes, fixture: 'Controlled fixture using installed Node types; not an upstream feature implementation.' },
  observations: { direct, ignored, inherited, exposed, unresolvedAmbient, resolvedAmbient }, benchmarkRepositoryWrites: 0, modelRequests: 0, releaseCandidate: false }
await writeFile(destination, JSON.stringify(report, null, 2), { flag: 'wx' })
console.log(JSON.stringify(report))
