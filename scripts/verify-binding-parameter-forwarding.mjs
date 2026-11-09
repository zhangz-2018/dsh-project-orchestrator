import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFile, realpath, writeFile } from 'node:fs/promises'
import { pathToFileURL } from 'node:url'
import ts from 'typescript'
import { BindingStage, digestObject } from '../lib/index.js'

// Replay the exact retained failed bundle and compare bounded source evidence.
// This is a read-only audit, never a replacement model verdict or candidate.
const [operationId, destination] = process.argv.slice(2)
assert.ok(operationId && destination)
const snapshot = await (await fetch('http://127.0.0.1:3087/project-orchestrator/api/snapshot')).json()
const operation = snapshot.planningOperations.find(o => o.id === operationId)
assert.equal(operation.status, 'blocked')
assert.equal(operation.stage, 'code_binding')
const isolated = JSON.parse(await readFile('output/acceptance/isolated-harness-2026-10-14.json', 'utf8'))
const installed = await realpath(`${isolated.profile}/node_modules/dsh-project-orchestrator/lib/index.js`)
const hash = bytes => createHash('sha256').update(bytes).digest('hex')
const installedBundleSha256 = hash(await readFile(installed))
assert.equal(installedBundleSha256, operation.evaluationInput.promptVersionsDigest)
const { BindingStage: OriginalStage } = await import(pathToFileURL(installed).href)
const repository = snapshot.repositorySnapshotsV3.find(r => r.id === operation.repositorySnapshotId)
const report = snapshot.repositoryEvidenceRetrievalReports.find(r => r.id === operation.repositoryEvidenceRetrievalReportId)
const manifest = snapshot.requirementSourceManifests.find(r => r.id === operation.sourceManifestId)
const focus = manifest.anchors.map(a => a.text).join('\n')
const originalStage = new OriginalStage({})
const references = originalStage.repositoryReferences(repository, report)
const input = { projectId: operation.projectId, operationId, references }
const before = await originalStage.loadFrozenEvidence(repository, input, focus)
const after = await new BindingStage({}).loadFrozenEvidence(repository, input, focus)
const apiPath = 'packages/zod/src/v4/core/api.ts'
const forwardingPath = 'packages/zod/src/v4/mini/parse.ts'
const printer = ts.createPrinter({ removeComments: true })
const apiSource = ts.createSourceFile(apiPath, await readFile(`${repository.canonicalRoot}/${apiPath}`, 'utf8'), ts.ScriptTarget.Latest, true)
const declaration = apiSource.statements.find(node => ts.isInterfaceDeclaration(node) && node.name.text === '$ZodStringBoolParams')
assert.ok(declaration)
const printed = printer.printNode(ts.EmitHint.Unspecified, declaration, apiSource)
const containsContract = contents => printer.printFile(ts.createSourceFile(apiPath, contents.find(c => c.path === apiPath).content, ts.ScriptTarget.Latest, true)).includes(printed)
const forwarding = await readFile(`${repository.canonicalRoot}/${forwardingPath}`, 'utf8')
assert.equal(containsContract(before), false)
assert.notEqual(before.find(c => c.path === forwardingPath).content, forwarding)
assert.equal(containsContract(after), true)
assert.equal(after.find(c => c.path === forwardingPath).content, forwarding)
assert.equal(after.find(c => c.path === forwardingPath).truncated, false)
const requiredDeclarations = {
  'packages/zod/src/v4/core/api.ts': ['_stringbool', '$ZodStringBoolParams'],
  'packages/zod/src/v4/core/util.ts': ['normalizeParams'],
  'packages/zod/src/v4/core/schemas.ts': ['$ZodString', '$ZodCodec', 'handleCodecAResult', 'handleCodecTxResult'],
  'packages/zod/src/v4/core/parse.ts': ['_parse'],
}
for (const [path, names] of Object.entries(requiredDeclarations)) {
  const source = ts.createSourceFile(path, await readFile(`${repository.canonicalRoot}/${path}`, 'utf8'), ts.ScriptTarget.Latest, true)
  const supplied = after.find(c => c.path === path)
  assert.ok(supplied?.content)
  const declarations = supplied.content.split(/\[Exact source declaration lines \d+-\d+; comments and blank lines omitted\]\n/u).slice(1)
    .map(content => printer.printFile(ts.createSourceFile(path, content, ts.ScriptTarget.Latest, true)))
  for (const name of names) {
    const nodes = source.statements.filter(node => (ts.isVariableStatement(node) ? node.declarationList.declarations.map(d => d.name.getText(source)) : node.name ? [node.name.getText(source)] : []).includes(name))
    assert.ok(nodes.length, `Missing original declaration ${path}: ${name}`)
    for (const node of nodes) assert.ok(declarations.some(text => text.includes(printer.printNode(ts.EmitHint.Unspecified, node, source))), `Incomplete supplied declaration ${path}: ${name}`)
  }
}
for (const c of after) assert.equal(c.digest, before.find(b => b.path === c.path).digest)
const byteCount = contents => contents.reduce((n, c) => n + Buffer.byteLength(c.content), 0)
assert.ok(byteCount(after) <= 65_536)
const result = {
  status: 'parameter_contract_and_forwarding_source_repaired', observedAt: new Date().toISOString(), operationId,
  originalStatus: operation.status, originalDiagnostics: operation.diagnostics,
  installedBundleSha256, localBundleSha256: hash(await readFile('lib/index.js')),
  before: { bytes: byteCount(before), evidenceDigest: digestObject(before), parameterDeclarationPresent: false, completeForwardingPresent: false },
  after: { bytes: byteCount(after), evidenceDigest: digestObject(after), parameterDeclarationPresent: true, completeForwardingPresent: true },
  sourceDigestsUnchanged: true, completeDeclarationChecks: requiredDeclarations, modelRequests: 0, domainMutations: 0, releasePass: false,
}
await writeFile(destination, JSON.stringify(result, null, 2), { flag: 'wx' })
console.log(JSON.stringify(result))
