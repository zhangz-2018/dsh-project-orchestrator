import assert from 'node:assert/strict'
import { readFile, writeFile } from 'node:fs/promises'
import { BindingStage, buildRepositoryEvidenceRetrievalReportV3, digestObject } from '../lib/index.js'
import ts from 'typescript'

// Replay the retained real failure without a model request or domain write.
const response = await fetch('http://127.0.0.1:3087/project-orchestrator/api/snapshot')
assert.ok(response.ok)
const snapshot = await response.json()
const operation = snapshot.planningOperations.find(o => o.id === 'planning-v3:362aaa72-4ea0-4841-b3b3-f43c23c34de6')
assert.equal(operation.status, 'blocked')
const repository = snapshot.repositorySnapshotsV3.find(r => r.id === operation.repositorySnapshotId)
const manifest = snapshot.requirementSourceManifests.find(r => r.id === operation.sourceManifestId)
const analysis = snapshot.requirementAnalysisProposals.find(r => r.id === operation.requirementAnalysisProposalId).analysis
const focus = manifest.anchors.map(a => a.text).join('\n')
const report = await buildRepositoryEvidenceRetrievalReportV3({ projectId: operation.projectId, operationId: operation.id, repository,
  requirements: analysis.requirements.filter(r => r.scope === 'in_scope').map(r => ({ key: r.key, statement: r.statement, acceptanceStatements: r.acceptanceCriteria.map(a => a.statement) })) })
const stage = new BindingStage({})
const contents = await stage.loadFrozenEvidence(repository, { projectId: operation.projectId, operationId: operation.id, references: stage.repositoryReferences(repository, report) }, focus)
const required = {
  'packages/zod/src/v4/core/api.ts': ['export function _stringbool(', 'const params = util.normalizeParams(_params)', 'reverseTransform:'],
  'packages/zod/src/v4/core/util.ts': ['export function normalizeParams', 'return params'],
  'packages/zod/src/v4/core/schemas.ts': ['export const $ZodString', 'export const $ZodCodec'],
  'packages/zod/src/v4/core/parse.ts': ['export const _parse'],
  'packages/zod/src/v4/index.ts': ['export * from "./classic/index.js"'],
  'packages/zod/src/v4/classic/schemas.ts': ['export const stringbool:'],
  'packages/zod/src/v4/mini/schemas.ts': ['export const stringbool:'],
}
const requiredDeclarations = {
  'packages/zod/src/v4/core/api.ts': ['_stringbool'],
  'packages/zod/src/v4/core/util.ts': ['normalizeParams'],
  'packages/zod/src/v4/core/schemas.ts': ['$ZodString', '$ZodCodec', 'handleCodecAResult', 'handleCodecTxResult'],
  'packages/zod/src/v4/core/parse.ts': ['_parse'],
}
const printer = ts.createPrinter({ removeComments: true })
for (const [path, facts] of Object.entries(required)) {
  const content = contents.find(c => c.path === path)
  assert.ok(content?.content, `Missing ${path}`)
  const source = await readFile(`${repository.canonicalRoot}/${path}`, 'utf8')
  for (const fact of facts) {
    assert.ok(source.includes(fact), `Invalid audit fact ${path}: ${fact}`)
    assert.ok(content.content.includes(fact), `Missing declaring source ${path}: ${fact}`)
  }
  assert.equal(content.digest, (repository.workingFiles ?? repository.files).find(f => f.path === path).digest)
  const parsed = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true)
  const suppliedDeclarations = content.content.split(/\[Exact source declaration lines \d+-\d+; comments and blank lines omitted\]\n/u).slice(1)
    .map(text => printer.printFile(ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true)))
  for (const name of requiredDeclarations[path] ?? []) {
    const declarations = parsed.statements.filter(node => (ts.isVariableStatement(node) ? node.declarationList.declarations.map(d => d.name.getText(parsed)) : node.name ? [node.name.getText(parsed)] : []).includes(name))
    assert.ok(declarations.length)
    for (const node of declarations) {
      const printed = printer.printNode(ts.EmitHint.Unspecified, node, parsed)
      assert.ok(suppliedDeclarations.some(text => text.includes(printed)), `Incomplete declaration ${path}: ${name}; supplied ${Buffer.byteLength(content.content)} bytes; declarations: ${suppliedDeclarations.map(text => text.slice(0, 100)).join(' | ')}`)
    }
  }
}
const totalBytes = contents.reduce((n, c) => n + Buffer.byteLength(c.content), 0)
assert.ok(totalBytes <= 65_536)
const queueOperation = snapshot.planningOperations.find(o => o.id === 'planning-v3:285226e9-a975-4324-919d-136898fa05b2')
const queueRepository = snapshot.repositorySnapshotsV3.find(r => r.id === queueOperation.repositorySnapshotId)
const queueManifest = snapshot.requirementSourceManifests.find(r => r.id === queueOperation.sourceManifestId)
const queueReport = snapshot.repositoryEvidenceRetrievalReports.find(r => r.id === queueOperation.repositoryEvidenceRetrievalReportId)
const queueContents = await stage.loadFrozenEvidence(queueRepository, { projectId: queueOperation.projectId, operationId: queueOperation.id, references: stage.repositoryReferences(queueRepository, queueReport) }, queueManifest.anchors.map(a => a.text).join('\n'))
const queueOwner = queueContents.find(c => c.path === 'source/index.ts')
const originalQueue = await readFile(`${queueRepository.canonicalRoot}/source/index.ts`, 'utf8')
assert.match(queueOwner.content, /^\[Source excerpt lines 1-\d+; comments and blank lines omitted\]\n/u)
assert.equal(printer.printFile(ts.createSourceFile('owner.ts', queueOwner.content.slice(queueOwner.content.indexOf('\n') + 1), ts.ScriptTarget.Latest, true)), printer.printFile(ts.createSourceFile('owner.ts', originalQueue, ts.ScriptTarget.Latest, true)), 'The complete executable Queue owner must remain unchanged.')
assert.ok(queueContents.reduce((n, c) => n + Buffer.byteLength(c.content), 0) <= 65_536)
const result = { status: 'real_helper_and_public_entry_evidence_present', observedAt: new Date().toISOString(), operationId: operation.id,
  retainedStatus: operation.status, originalDiagnostics: operation.diagnostics, indexVersion: report.indexVersion, reportDigest: report.reportDigest,
  evidenceDigest: digestObject(contents), totalBytes, pqueueCompleteExecutableOwnerRetained: true, modelRequests: 0, domainMutations: 0, releasePass: false,
  files: contents.filter(c => c.content).map(c => ({ path: c.path, bytes: Buffer.byteLength(c.content), digest: c.digest, truncated: c.truncated })) }
await writeFile(process.argv[2], JSON.stringify(result, null, 2), { flag: 'wx' })
console.log(JSON.stringify({ ...result, files: result.files.filter(f => Object.hasOwn(required, f.path)) }))
