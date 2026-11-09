import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { readFile, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { pathToFileURL } from 'node:url'
import { resolve } from 'node:path'
import ts from 'typescript'

// Read-only replay of a real failed binding. No candidate, retry or approval.
const [operationId, sessionPath, bundleArgument, destination] = process.argv.slice(2)
assert.ok(operationId && sessionPath && bundleArgument && destination)
const snapshot = await (await fetch('http://127.0.0.1:3087/project-orchestrator/api/snapshot')).json()
const operation = snapshot.planningOperations.find(o => o.id === operationId)
assert.equal(operation.status, 'blocked')
const repository = snapshot.repositorySnapshotsV3.find(r => r.id === operation.repositorySnapshotId)
const retrieval = snapshot.repositoryEvidenceRetrievalReports.find(r => r.id === operation.repositoryEvidenceRetrievalReportId)
const source = snapshot.requirementSourceManifests.find(r => r.id === operation.sourceManifestId)
const bundlePath = resolve(bundleArgument)
const { BindingStage, digestObject } = await import(pathToFileURL(bundlePath).href)
const stage = new BindingStage({})
const evidence = await stage.loadFrozenEvidence(repository, { projectId: operation.projectId, operationId, references: stage.repositoryReferences(repository, retrieval) }, source.anchors.map(a => a.text).join('\n'))
const events = execFileSync('zstd', ['-dc', sessionPath], { encoding: 'utf8', maxBuffer: 10_000_000 }).trim().split('\n').map(JSON.parse)
const prompt = events.filter(e => e.type === 'user/message').flatMap(e => e.data.content).find(c => c.text?.startsWith('Frozen scope')).text
const supplied = JSON.parse(prompt.split('\n\nAllowed evidence refs:\n')[1].split('\n\nReturn one corrected JSON object.')[0])
const original = supplied.filter(e => e.content !== undefined)
const normalize = list => [...list].sort((a, b) => a.ref.localeCompare(b.ref))
const replayMatchesActualPrompt = JSON.stringify(normalize(evidence)) === JSON.stringify(normalize(original))
const printer = ts.createPrinter({ removeComments: true })
const ownerDeclarations = { 'source/core/Ky.ts': ['Ky'], 'source/utils/merge.ts': ['validateAndMerge', 'deepMerge', 'deepMergeInternal'], 'source/types/options.ts': ['InitOptions', 'InternalOptions', 'NormalizedOptions'], 'source/core/constants.ts': ['requestOptionsRegistry', 'kyOptionKeys'] }
const declarationChecks = []
for (const [path, names] of Object.entries(ownerDeclarations)) {
  const current = ts.createSourceFile(path, await readFile(resolve(repository.canonicalRoot, path), 'utf8'), ts.ScriptTarget.Latest, true)
  const suppliedText = evidence.find(e => e.path === path).content.replace(/^\[(?:Exact source declaration|Source excerpt)[^\n]*\]\n/gmu, '')
  const suppliedSource = ts.createSourceFile(path, suppliedText, ts.ScriptTarget.Latest, true)
  const supplied = printer.printFile(suppliedSource)
  for (const name of names) {
    const node = current.statements.find(n => (ts.isVariableStatement(n) ? n.declarationList.declarations.some(d => d.name.getText(current) === name) : n.name?.getText(current) === name))
    assert.ok(node, `Missing original ${path}: ${name}`)
    declarationChecks.push({ path, name, complete: supplied.includes(printer.printNode(ts.EmitHint.Unspecified, node, current)) })
  }
}
const manifestChecks = []
for (const item of evidence.filter(e => /^(?:package|tsconfig[^/]*)\.json$/u.test(e.path))) {
  const text = await readFile(resolve(repository.canonicalRoot, item.path), 'utf8')
  manifestChecks.push({ path: item.path, bytes: Buffer.byteLength(item.content), complete: item.content === text, truncated: item.truncated })
}
const inspectionChecks = []
for (const path of ['source/index.ts', 'test/request-options.ts', 'source/types/retry.ts']) {
  const original = await readFile(resolve(repository.canonicalRoot, path), 'utf8')
  const supplied = evidence.find(e => e.path === path)?.content ?? ''
  const parsed = ts.createSourceFile(path, original, ts.ScriptTarget.Latest, true)
  const exports = parsed.statements.filter(ts.isExportDeclaration).map(n => n.getText(parsed))
  inspectionChecks.push({ path, complete: path === 'source/index.ts' ? exports.every(text => supplied.includes(text)) : supplied === original })
}
const hash = value => createHash('sha256').update(value).digest('hex')
const report = { observedAt: new Date().toISOString(), operationId, originalStatus: operation.status, originalDiagnostics: operation.diagnostics,
  sessionPath, sessionSha256: hash(await readFile(sessionPath)), bundlePath, bundleSha256: hash(await readFile(bundlePath)),
  replayMatchesActualPrompt, declarationChecks, manifestChecks, inspectionChecks, originalDigest: digestObject(original), replayDigest: digestObject(evidence),
  bytes: evidence.reduce((n, e) => n + Buffer.byteLength(e.content), 0),
  owners: evidence.filter(e => ['source/core/Ky.ts', 'source/utils/merge.ts', 'source/types/options.ts'].includes(e.path)).map(e => ({ path: e.path, bytes: Buffer.byteLength(e.content), truncated: e.truncated,
    facts: Object.fromEntries(['class Ky', 'deepMerge', 'type InitOptions', 'interface InitOptions', 'beforeError', 'new HTTPError', 'this._options', 'cloneInitHookOptions'].map(f => [f, e.content.includes(f)])), content: e.content })),
  evidence, actualPrompt: prompt, modelRequests: 0, domainMutations: 0, originalVerdictUnchanged: true }
assert.ok(report.bytes <= 131_072)
await writeFile(destination, JSON.stringify(report, null, 2), { flag: 'wx' })
console.log(JSON.stringify({ destination, replayMatchesActualPrompt, bytes: report.bytes, owners: report.owners.map(({ content, ...r }) => r) }))
if (process.argv[6] === '--require-owners') {
  assert.ok(declarationChecks.every(c => c.complete), JSON.stringify(declarationChecks))
  assert.ok(manifestChecks.every(c => c.complete && !c.truncated), JSON.stringify(manifestChecks))
  assert.ok(inspectionChecks.every(c => c.complete), JSON.stringify(inspectionChecks))
}
