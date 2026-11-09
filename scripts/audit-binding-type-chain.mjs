import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { readFile, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { pathToFileURL } from 'node:url'
import { resolve } from 'node:path'
import ts from 'typescript'

// Replay actual frozen Binding input. No requests to a model or domain writes.
const [operationId, sessionPath, bundleArgument, destination] = process.argv.slice(2)
assert.ok(operationId && sessionPath && bundleArgument && destination)
const snapshot = await (await fetch('http://127.0.0.1:3087/project-orchestrator/api/snapshot')).json()
const operation = snapshot.planningOperations.find(o => o.id === operationId)
assert.ok(['failed', 'blocked'].includes(operation.status))
const repository = snapshot.repositorySnapshotsV3.find(r => r.id === operation.repositorySnapshotId)
const retrieval = snapshot.repositoryEvidenceRetrievalReports.find(r => r.id === operation.repositoryEvidenceRetrievalReportId)
const source = snapshot.requirementSourceManifests.find(r => r.id === operation.sourceManifestId)
const bundlePath = resolve(bundleArgument)
const { BindingStage, digestObject } = await import(pathToFileURL(bundlePath).href)
const stage = new BindingStage({})
const evidence = await stage.loadFrozenEvidence(repository, { projectId: operation.projectId, operationId, references: stage.repositoryReferences(repository, retrieval) }, source.anchors.map(a => a.text).join('\n'))
const events = execFileSync('zstd', ['-dc', sessionPath], { encoding: 'utf8', maxBuffer: 20_000_000 }).trim().split('\n').map(JSON.parse)
const prompt = events.filter(e => e.type === 'user/message').flatMap(e => e.data.content).find(c => c.text?.startsWith('Frozen scope')).text
const supplied = JSON.parse(prompt.split('\n\nAllowed evidence refs:\n')[1].split('\n\nReturn one corrected JSON object.')[0]).filter(e => e.content !== undefined)
const normalize = list => [...list].sort((a, b) => a.ref.localeCompare(b.ref))
const declarations = {
  'packages/zod/src/v4/core/api.ts': ['_stringbool', '$ZodStringBoolParams'],
  'packages/zod/src/v4/core/schemas.ts': ['$ZodString', '$ZodStringInternals', '$ZodBoolean', '$ZodBooleanInternals', '$ZodCodec', '$ZodCodecInternals', '$ZodType', '$ZodTypeInternals', 'handleCodecAResult', 'handleCodecTxResult'],
  'packages/zod/src/v4/core/core.ts': ['input', 'output'],
  'packages/zod/src/v4/core/util.ts': ['normalizeParams'],
  'packages/zod/src/v4/classic/schemas.ts': ['stringbool', 'ZodCodec', 'ZodBoolean'],
  'packages/zod/src/v4/mini/schemas.ts': ['stringbool', 'ZodMiniCodec', 'ZodMiniBoolean'],
  'packages/zod/src/v4/classic/in-out.ts': ['output'],
  'packages/zod/src/v4/mini/in-out.ts': ['output'],
}
const printer = ts.createPrinter({ removeComments: true })
const checks = []
for (const [path, names] of Object.entries(declarations)) {
  const parsed = ts.createSourceFile(path, await readFile(resolve(repository.canonicalRoot, path), 'utf8'), ts.ScriptTarget.Latest, true)
  const suppliedText = (evidence.find(e => e.path === path)?.content ?? '').replace(/^\[(?:Exact source declaration|Source excerpt)[^\n]*\]\n/gmu, '')
  const printed = printer.printFile(ts.createSourceFile(path, suppliedText, ts.ScriptTarget.Latest, true))
  for (const name of names) {
    const nodes = parsed.statements.filter(n => (!path.endsWith('/in-out.ts') || ts.isTypeAliasDeclaration(n)) && (ts.isVariableStatement(n) ? n.declarationList.declarations.some(d => d.name.getText(parsed) === name) : n.name?.getText(parsed) === name))
    assert.ok(nodes.length, `${path}:${name}`)
    for (const node of nodes) checks.push({ path, name, kind: ts.SyntaxKind[node.kind], complete: printed.includes(printer.printNode(ts.EmitHint.Unspecified, node, parsed)) })
  }
}
const requestedNewPath = 'packages/zod/src/v4/mini/tests/stringbool.test.ts'
assert.equal(repository.workingFiles.some(f => f.path === requestedNewPath), false)
const hash = value => createHash('sha256').update(value).digest('hex')
const report = { observedAt: new Date().toISOString(), operationId, originalStatus: operation.status, originalDiagnostics: operation.diagnostics,
  sessionPath, sessionSha256: hash(await readFile(sessionPath)), bundlePath, bundleSha256: hash(await readFile(bundlePath)),
  replayMatchesActualPrompt: JSON.stringify(normalize(evidence)) === JSON.stringify(normalize(supplied)),
  originalDigest: digestObject(supplied), replayDigest: digestObject(evidence), checks,
  requestedNewPath: { path: requestedNewPath, existsInFrozenInventory: false, selected: false },
  bytes: evidence.reduce((n, e) => n + Buffer.byteLength(e.content), 0), evidence, actualPrompt: prompt,
  modelRequests: 0, domainMutations: 0, originalVerdictUnchanged: true }
assert.ok(report.bytes <= 98_304)
await writeFile(destination, JSON.stringify(report, null, 2), { flag: 'wx' })
console.log(JSON.stringify({ destination, replayMatchesActualPrompt: report.replayMatchesActualPrompt, bytes: report.bytes, missing: checks.filter(c => !c.complete), requestedNewPath: report.requestedNewPath }))
if (process.argv[6] === '--require-chain') assert.ok(checks.every(c => c.complete), 'The full current type and runtime chain must be supplied')
