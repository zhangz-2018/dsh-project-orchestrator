import assert from 'node:assert/strict'
import { readFile, realpath, writeFile } from 'node:fs/promises'
import { pathToFileURL } from 'node:url'
import ts from 'typescript'
import { BindingStage, digestObject } from '../lib/index.js'

const [operationId, destination] = process.argv.slice(2)
assert.ok(operationId && destination)
const snapshot = await (await fetch('http://127.0.0.1:3087/project-orchestrator/api/snapshot')).json()
const operation = snapshot.planningOperations.find(o => o.id === operationId)
assert.equal(operation.status, 'blocked')
assert.equal(operation.stage, 'scenario_coverage_review')
const review = snapshot.scenarioCoverageReviews.find(r => r.id === operation.scenarioCoverageReviewId)
const repository = snapshot.repositorySnapshotsV3.find(r => r.id === operation.evaluationInput.repositorySnapshotId)
const manifest = snapshot.planningPromptReferenceManifests.find(m => m.operationId === operation.id)
const focus = review.sourceContext.manifest.anchors.map(a => a.text).join('\n')
const isolated = JSON.parse(await readFile('output/acceptance/isolated-harness-2026-10-14.json', 'utf8'))
const installed = await realpath(`${isolated.profile}/node_modules/dsh-project-orchestrator/lib/index.js`)
const { BindingStage: OriginalStage } = await import(pathToFileURL(installed).href)
const before = await new OriginalStage({}).loadFrozenEvidence(repository, manifest, focus)
assert.deepEqual(before, review.repositoryEvidence.contents)
const after = await new BindingStage({}).loadFrozenEvidence(repository, manifest, focus)
const required = {
  'packages/zod/src/v4/core/api.ts': ['_stringbool', '$ZodStringBoolParams'],
  'packages/zod/src/v4/core/schemas.ts': ['$ZodCodec', '$ZodCodecInternals', '$ZodBoolean', '$ZodBooleanInternals', '$ZodTypeInternals', 'handleCodecAResult', 'handleCodecTxResult'],
  'packages/zod/src/v4/core/core.ts': ['input', 'output'],
  'packages/zod/src/v4/core/util.ts': ['normalizeParams'],
}
const printer = ts.createPrinter({ removeComments: true })
const checks = []
for (const [path, names] of Object.entries(required)) {
  const parsed = ts.createSourceFile(path, await readFile(`${repository.canonicalRoot}/${path}`, 'utf8'), ts.ScriptTarget.Latest, true)
  const printed = contents => printer.printFile(ts.createSourceFile(path, contents.find(c => c.path === path).content, ts.ScriptTarget.Latest, true))
  for (const name of names) {
    const nodes = parsed.statements.filter(node => (ts.isVariableStatement(node) ? node.declarationList.declarations.map(d => d.name.getText(parsed)) : node.name ? [node.name.getText(parsed)] : []).includes(name))
    assert.ok(nodes.length)
    for (const node of nodes) {
      const text = printer.printNode(ts.EmitHint.Unspecified, node, parsed)
      const check = { path, name, before: printed(before).includes(text), after: printed(after).includes(text) }
      checks.push(check)
    }
  }
}
const byteCount = items => items.reduce((n, c) => n + Buffer.byteLength(c.content), 0)
assert.ok(byteCount(after) <= 65_536)
for (const c of after) assert.equal(c.digest, before.find(b => b.path === c.path).digest)
const result = { scope: 'readonly_type_projection_evidence_diagnostic', observedAt: new Date().toISOString(), operationId,
  originalVerdict: review.status, originalFindings: review.findings, before: { bytes: byteCount(before), digest: digestObject(before) },
  after: { bytes: byteCount(after), digest: digestObject(after), contents: after }, checks, sourceDigestsUnchanged: true, domainMutations: 0, modelRequests: 0, releaseCandidate: false }
await writeFile(destination, JSON.stringify(result, null, 2), { flag: 'wx' })
console.log(JSON.stringify({ ...result, after: { ...result.after, contents: undefined } }))
assert.ok(checks.every(c => c.after), 'Complete declaration closure is required')
assert.ok(checks.some(c => !c.before && c.after))
