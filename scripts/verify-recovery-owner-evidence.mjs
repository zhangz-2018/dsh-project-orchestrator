import assert from 'node:assert/strict'
import { readFile, writeFile } from 'node:fs/promises'
import { realpath } from 'node:fs/promises'
import { pathToFileURL } from 'node:url'
import { BindingStage, digestObject } from '../lib/index.js'
import ts from 'typescript'

// Replay the observed evidence gap, preserving its terminal result. No model
// calls, repository mutations, candidate exports, or domain writes.
const response = await fetch('http://127.0.0.1:3087/project-orchestrator/api/snapshot')
assert.ok(response.ok)
const snapshot = await response.json()
const operationId = 'planning-v3:dca18581-ec01-4f02-b06f-524e90654622'
const operation = snapshot.planningOperations.find(o => o.id === operationId)
assert.equal(operation.status, 'blocked')
assert.equal(operation.stage, 'code_binding')
const repository = snapshot.repositorySnapshotsV3.find(r => r.id === operation.repositorySnapshotId)
const report = snapshot.repositoryEvidenceRetrievalReports.find(r => r.id === operation.repositoryEvidenceRetrievalReportId)
const manifest = snapshot.requirementSourceManifests.find(r => r.id === operation.sourceManifestId)
const isolated = JSON.parse(await readFile('output/acceptance/isolated-harness-2026-10-14.json', 'utf8'))
const oldPath = await realpath(`${isolated.profile}/node_modules/dsh-project-orchestrator/lib/index.js`)
const { BindingStage: PreviousBindingStage } = await import(pathToFileURL(oldPath).href)
const focus = manifest.anchors.map(a => a.text).join('\n')
const stage = new BindingStage({})
const refs = { projectId: operation.projectId, operationId, references: stage.repositoryReferences(repository, report) }
const before = await new PreviousBindingStage({}).loadFrozenEvidence(repository, refs, focus)
const after = await stage.loadFrozenEvidence(repository, refs, focus)
assert.deepEqual(after.map(c => [c.ref, c.path, c.digest]), before.map(c => [c.ref, c.path, c.digest]))
const original = await readFile(`${repository.canonicalRoot}/source/index.ts`, 'utf8')
const oldOwner = before.find(c => c.path === 'source/index.ts')
const newOwner = after.find(c => c.path === 'source/index.ts')
assert.ok(!oldOwner.content.includes('get size(): number') || !oldOwner.content.includes('get pending(): number'), 'Replay must reproduce the observed omission.')
for (const fact of ['get size(): number', 'get pending(): number', '#emitEmptyAndIdle()', "this.#emit('active')", "this.#emit('completed', result)", "this.#emit('error', error)", "this.#emit('idle')", 'async #add<']) assert.ok(newOwner.content.includes(fact), fact)
assert.match(newOwner.content, /^\[Source excerpt lines 1-\d+; comments and blank lines omitted\]\n/u)
const tokens = text => {
  // The parser supplies the contextual rescans for template tails, regexes and
  // type operators; a bare scanner would misread template text as source.
  const parsed = ts.createSourceFile('owner.ts', text, ts.ScriptTarget.Latest, true)
  assert.equal(parsed.parseDiagnostics.length, 0)
  const result = []
  const visit = node => {
    if (node.kind >= ts.SyntaxKind.FirstJSDocNode && node.kind <= ts.SyntaxKind.LastJSDocNode) return
    if (node.kind >= ts.SyntaxKind.FirstToken && node.kind <= ts.SyntaxKind.LastToken) {
      if (node.kind !== ts.SyntaxKind.EndOfFileToken) result.push([node.kind, node.getText(parsed)])
      return
    }
    for (const child of node.getChildren(parsed)) visit(child)
  }
  visit(parsed)
  return result
}
assert.deepEqual(tokens(newOwner.content.slice(newOwner.content.indexOf('\n') + 1)), tokens(original), 'All executable tokens, including late producers and getters, must be retained unchanged.')
assert.equal(newOwner.truncated, true)
assert.ok(Buffer.byteLength(newOwner.content) <= 24_576)
const totalBytes = after.reduce((n, c) => n + Buffer.byteLength(c.content), 0)
assert.ok(totalBytes <= 65_536)
const result = { status: 'observed_owner_gap_reproduced_and_all_executable_tokens_retained', observedAt: new Date().toISOString(), operationId,
  originalStatusPreserved: operation.status, diagnostics: operation.diagnostics, previousBundlePath: oldPath,
  beforeEvidenceDigest: digestObject(before), afterEvidenceDigest: digestObject(after),
  sourceDigest: newOwner.digest, beforeOwnerBytes: Buffer.byteLength(oldOwner.content), afterOwnerBytes: Buffer.byteLength(newOwner.content), totalBytes,
  allExecutableTokensEqual: true, frozenRefsUnchanged: true, modelRequests: 0, domainMutations: 0, releasePass: false }
await writeFile(process.argv[2], JSON.stringify(result, null, 2), { flag: 'wx' })
console.log(JSON.stringify(result))
