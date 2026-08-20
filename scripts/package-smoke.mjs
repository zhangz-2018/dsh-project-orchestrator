import { execFile } from 'node:child_process'
import { access, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { constants } from 'node:fs'
import { join, resolve } from 'node:path'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)
const root = new URL('../', import.meta.url).pathname
const smoke = join(root, '.package-smoke')
const packDirectory = join(smoke, 'pack')
const appDirectory = join(smoke, 'app')

await rm(smoke, { recursive: true, force: true })
await mkdir(packDirectory, { recursive: true })
try {
  await execFileAsync(process.execPath, [join(root, 'scripts/build.mjs')], { cwd: root, maxBuffer: 10_000_000 })
  const packed = await execFileAsync('npm', ['pack', '--dry-run=false', '--ignore-scripts', '--json', '--pack-destination', packDirectory], { cwd: root, maxBuffer: 10_000_000 })
  const [entry] = JSON.parse(packed.stdout)
  if (entry?.filename === undefined || !Array.isArray(entry.files)) throw new Error('npm pack did not return one inspectable artifact.')
  const files = new Map(entry.files.map((file) => [file.path, file]))
  for (const required of [
    'package.json', 'README.md', 'README.zh-CN.md', 'LICENSE',
    'CHANGELOG.md', 'CHANGELOG.zh-CN.md', 'CONTRIBUTING.md', 'CONTRIBUTING.zh-CN.md',
    'SECURITY.md', 'SECURITY.zh-CN.md', 'SUPPORT.md', 'SUPPORT.zh-CN.md',
    'GOVERNANCE.md', 'GOVERNANCE.zh-CN.md', 'CODE_OF_CONDUCT.md', 'CODE_OF_CONDUCT.zh-CN.md',
    'docs/api.md', 'docs/api.zh-CN.md', 'docs/architecture.md', 'docs/architecture.zh-CN.md',
    'docs/compatibility.md', 'docs/compatibility.zh-CN.md', 'docs/operations.md', 'docs/operations.zh-CN.md',
    'docs/migration.md', 'docs/migration.zh-CN.md', 'docs/releasing.md', 'docs/releasing.zh-CN.md',
    'lib/index.js', 'lib/client.js', 'lib/cli.js', 'lib/types/index.d.ts',
  ]) {
    if (!files.has(required)) throw new Error(`Packed package is missing ${required}.`)
  }
  for (const file of files.keys()) {
    if (/^(?:src|tests|scripts|node_modules|\.github)\//.test(file)) throw new Error(`Packed package unexpectedly contains ${file}.`)
    if (/^(?:\.env|\.npmrc)$/.test(file)) throw new Error(`Packed package unexpectedly contains ${file}.`)
  }
  const manifest = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'))
  if (manifest.name !== 'dsh-project-orchestrator' || !/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(manifest.version) || manifest.private === true || manifest.engines?.node !== '>=22') throw new Error('Source manifest identity, version, or engine contract is invalid.')
  if (entry.name !== manifest.name || entry.version !== manifest.version) throw new Error('Packed artifact identity does not match the source manifest.')
  const exportedTargets = new Set([manifest.main, manifest.types, ...Object.values(manifest.bin ?? {}), ...collectExportTargets(manifest.exports)])
  for (const target of exportedTargets) {
    const packedPath = String(target).replace(/^\.\//, '')
    if (!files.has(packedPath)) throw new Error(`Manifest target is missing from package: ${target}.`)
  }
  for (const [peer, range] of Object.entries(manifest.peerDependencies ?? {})) {
    if (peer.startsWith('@deepseek-ai/dsh-') && range !== '0.1.0-rc.6') throw new Error(`Uncertified Harness peer range: ${peer}@${range}.`)
    if (manifest.dependencies?.[peer] !== undefined) throw new Error(`Host peer ${peer} must not be duplicated in runtime dependencies.`)
    if (manifest.peerDependenciesMeta?.[peer]?.optional !== true) throw new Error(`Host peer ${peer} must be explicitly optional.`)
  }
  const cliEntry = files.get('lib/cli.js')
  if ((cliEntry?.mode ?? 0) !== 0o755) throw new Error('Packed CLI is not executable.')
  if (!(await readFile(join(root, 'lib/cli.js'), 'utf8')).startsWith('#!/usr/bin/env node')) throw new Error('Packed CLI lost its Node shebang.')

  await mkdir(appDirectory, { recursive: true })
  await writeFile(join(appDirectory, 'package.json'), JSON.stringify({ name: 'dsh-project-orchestrator-package-smoke', private: true, type: 'module' }))
  const tarball = resolve(packDirectory, entry.filename)
  await execFileAsync('pnpm', ['--config.auto-install-peers=false', 'add', '--ignore-scripts', tarball], { cwd: appDirectory, maxBuffer: 10_000_000 })
  const installedManifest = JSON.parse(await readFile(join(appDirectory, 'node_modules/dsh-project-orchestrator/package.json'), 'utf8'))
  if (installedManifest.name !== manifest.name || installedManifest.version !== manifest.version || installedManifest.private === true) throw new Error(`Installed manifest identity is not publishable ${manifest.name}@${manifest.version}.`)
  const installedCli = join(appDirectory, 'node_modules/dsh-project-orchestrator/lib/cli.js')
  await access(installedCli, constants.X_OK)
  if ((await stat(installedCli)).mode & 0o111 ? false : true) throw new Error('Installed CLI lost executable mode.')
  const help = await execFileAsync(installedCli, ['--help'], { cwd: appDirectory })
  const version = await execFileAsync(installedCli, ['--version'], { cwd: appDirectory })
  if (!help.stdout.includes('Usage:') || version.stdout.trim() !== manifest.version) throw new Error('Installed CLI help/version contract failed.')

  for (const artifact of ['lib/index.js.map', 'lib/client.js.map']) {
    const sourceMap = await readFile(join(root, artifact), 'utf8')
    if (/\/(?:Users|home)\//.test(sourceMap)) throw new Error(`${artifact} contains an absolute home path.`)
  }
  process.stdout.write(`Package smoke passed: ${entry.filename} (${entry.files.length} files).\n`)
} finally {
  await rm(smoke, { recursive: true, force: true })
}

function collectExportTargets(value) {
  if (typeof value === 'string') return [value]
  if (value === null || typeof value !== 'object') return []
  return Object.entries(value)
    .filter(([key]) => key !== './package.json')
    .flatMap(([, entry]) => collectExportTargets(entry))
}
