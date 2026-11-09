import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { readFile, realpath, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { promisify } from 'node:util'
import { buildRepositoryStackProfileV3, digestObject } from '../lib/index.js'

const run = promisify(execFile)
const draft = JSON.parse(await readFile(resolve('output/acceptance/release-corpus-draft-2026-10-15.json'), 'utf8'))
const output = resolve(process.argv[2] ?? 'output/acceptance/release-repository-preflight-2026-10-15.json')
const profiles = []
for (const repository of draft.repositories) {
  const canonicalRoot = await realpath(repository.repository)
  const git = async (args) => (await run('git', ['-C', canonicalRoot, ...args], { maxBuffer: 8_500_000 })).stdout
  assert.equal((await git(['rev-parse', 'HEAD'])).trim(), repository.baseCommit)
  assert.equal((await git(['status', '--porcelain=v1'])).trim(), '')
  const files = (await git(['ls-files', '-s', '-z'])).split('\0').filter(Boolean).map((entry) => {
    const match = /^\d+\s+([a-f0-9]+)\s+0\t(.+)$/u.exec(entry)
    assert.ok(match)
    return { path: match[2], digest: digestObject({ path: match[2], blob: match[1] }) }
  })
  const manifest = JSON.parse(await readFile(resolve(canonicalRoot, 'package.json'), 'utf8'))
  const manager = files.some((file) => file.path === 'pnpm-lock.yaml') ? 'pnpm run' : files.some((file) => file.path === 'yarn.lock') ? 'yarn' : 'npm run'
  const verifiedCommands = Object.keys(manifest.scripts ?? {}).filter((name) => /^(?:test|check|verify|build|lint|typecheck)(?::|$)/u.test(name)).sort().map((name) => `${manager} ${name}`)
  // Only the provider's read-only input projection is supplied here. This is a
  // diagnostic preflight, never an operation/candidate or a release input freeze.
  const profile = await buildRepositoryStackProfileV3({ project: { id: 'repository-preflight' }, operationId: `repository-preflight:${repository.identity}`,
    repository: { id: `repository-preflight:${repository.identity}`, canonicalRoot, files, workingFiles: files, verifiedCommands } })
  profiles.push({ identity: repository.identity, baseCommit: repository.baseCommit, trackedFileCount: files.length,
    supportStatus: profile.supportStatus, providerCoverage: profile.providerCoverage, diagnostics: profile.diagnostics })
}
await writeFile(output, `${JSON.stringify({ schemaVersion: 1, kind: 'read_only_repository_provider_preflight', modelCalled: false, checkedAt: new Date().toISOString(), profiles }, null, 2)}\n`, { flag: 'wx' })
console.log(JSON.stringify({ output, profiles: profiles.map(({ identity, supportStatus, diagnostics }) => ({ identity, supportStatus, diagnostics })) }))
if (profiles.some((profile) => profile.supportStatus !== 'supported')) process.exitCode = 1
