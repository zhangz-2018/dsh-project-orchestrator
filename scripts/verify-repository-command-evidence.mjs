import assert from 'node:assert/strict'
import { readFile, realpath, writeFile } from 'node:fs/promises'
import { pathToFileURL } from 'node:url'
import { OrchestratorService, digestObject } from '../lib/index.js'

// Reproduce the retained command-catalog defect without executing commands,
// changing domain facts, retrying an operation, or supplying a model verdict.
const [operationId, destination] = process.argv.slice(2)
assert.ok(operationId && destination)
const endpoint = 'http://127.0.0.1:3087/project-orchestrator/api/snapshot'
const snapshot = await (await fetch(endpoint)).json()
const operation = snapshot.planningOperations.find(o => o.id === operationId)
assert.equal(operation.status, 'blocked')
assert.equal(operation.stage, 'task_plan')
const repository = snapshot.repositorySnapshotsV3.find(r => r.id === operation.repositorySnapshotId)
const project = snapshot.projects.find(p => p.id === operation.projectId)
const isolated = JSON.parse(await readFile('output/acceptance/isolated-harness-2026-10-14.json', 'utf8'))
const installedPath = await realpath(`${isolated.profile}/node_modules/dsh-project-orchestrator/lib/index.js`)
const { OrchestratorService: OriginalService } = await import(pathToFileURL(installedPath).href)
const before = (await Object.create(OriginalService.prototype).captureRepositorySnapshotV3(project, operation.id)).snapshot
const after = (await Object.create(OrchestratorService.prototype).captureRepositorySnapshotV3(project, operation.id)).snapshot
assert.deepEqual(before.verifiedCommands, repository.verifiedCommands)
const policyScriptDiagnostic = process.argv[4] === 'policy-script'
const tsdDiagnostic = process.argv[4] === 'tsd'
const dictionaryModeCommand = 'nub --allow-natives-syntax --conditions=@zod/source packages/bench/memory/dict-mode.ts'
if (tsdDiagnostic) {
  const explicitTsdCommand = 'npm exec -- tsd --files index.test-d.ts'
  assert.ok(before.verifiedCommands.includes('npm run test'))
  assert.equal(before.verifiedCommands.includes(explicitTsdCommand), false)
  assert.deepEqual(after.verifiedCommands, [...before.verifiedCommands, explicitTsdCommand])
} else {
  if (policyScriptDiagnostic) {
    assert.equal(before.verifiedCommands.includes(dictionaryModeCommand), false)
    assert.ok(after.verifiedCommands.includes(dictionaryModeCommand))
  } else assert.ok(before.verifiedCommands.includes('pnpm run test'))
  assert.ok(after.verifiedCommands.includes('nub run test'))
  assert.equal(after.verifiedCommands.some(c => c.startsWith('pnpm ')), false)
  assert.ok(after.verifiedCommands.includes('nub exec --node tsc --noEmit --project packages/zod/tsconfig.test.json'))
  assert.ok(after.verifiedCommands.some(c => /^nub run bench .+\.ts$/u.test(c)))
  for (const path of ['packages/bench/memory/schema-footprint.ts', 'packages/bench/memory/realworld.ts']) {
    assert.ok(after.verifiedCommands.includes(`nub --expose-gc --conditions=@zod/source ${path}`))
  }
  const sizeCommands = after.verifiedCommands.filter(c => c.startsWith('bash -o pipefail') && c.includes('esbuild'))
  assert.ok(sizeCommands.some(c => /\/zod-(?!mini)[A-Za-z0-9-]+\.ts /u.test(c)))
  assert.ok(sizeCommands.some(c => /\/zod-mini-[A-Za-z0-9-]+\.ts /u.test(c)))
  assert.equal(sizeCommands.some(c => c.includes('--outfile')), false)
}
for (const key of ['headCommit', 'trackedTreeDigest', 'dirtyDigest', 'files', 'workingFiles', 'dirtyFiles']) {
  assert.deepEqual(before[key], repository[key])
  assert.deepEqual(after[key], before[key])
}
assert.deepEqual(await (await fetch(endpoint)).json(), snapshot)
const report = { status: 'source_grounded_command_candidates_verified', operationId, observedAt: new Date().toISOString(),
  retainedOperationStatus: operation.status, retainedDiagnostics: operation.diagnostics,
  beforeCommands: before.verifiedCommands, afterCommands: after.verifiedCommands,
  repositorySourceUnchanged: true, beforeRepositoryDigest: before.repositoryDigest, afterRepositoryDigest: after.repositoryDigest,
  commandCatalogDigest: digestObject(after.verifiedCommands), modelRequests: 0, commandsExecuted: 0, domainMutations: 0, releasePassed: false }
await writeFile(destination, JSON.stringify(report, null, 2), { flag: 'wx' })
console.log(JSON.stringify({ ...report, retainedDiagnostics: undefined, beforeCommands: undefined, afterCommands: undefined, beforeCommandCount: before.verifiedCommands.length, afterCommandCount: after.verifiedCommands.length }))
