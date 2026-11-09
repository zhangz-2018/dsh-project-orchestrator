import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFile, writeFile } from 'node:fs/promises'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { pathToFileURL } from 'node:url'
import { resolve } from 'node:path'
import { digestObject } from '../lib/index.js'

// Audit one observed review. Preserve its rejected verdict; do not override it.
const [operationId, sessionPath, destination] = process.argv.slice(2)
assert.ok(operationId && sessionPath && destination)
const response = await fetch('http://127.0.0.1:3087/project-orchestrator/api/snapshot')
assert.ok(response.ok)
const snapshot = await response.json()
const operation = snapshot.planningOperations.find(o => o.id === operationId)
assert.equal(operation?.status, 'blocked')
assert.equal(operation.stage, 'binding_review')
const bundlePath = resolve(process.env.PO_AUDIT_BUNDLE_PATH ?? 'lib/index.js')
const bundleSha256 = createHash('sha256').update(await readFile(bundlePath)).digest('hex')
assert.equal(bundleSha256, operation.evaluationInput.promptVersionsDigest, 'Replay must use the exact evaluated product bundle.')
const { BindingStage } = await import(pathToFileURL(bundlePath).href)
const review = snapshot.planningReviewsV3.find(r => r.operationId === operationId && r.kind === 'binding')
assert.equal(review?.status, 'changes_requested')
const { stdout } = await promisify(execFile)('zstd', ['-dc', sessionPath], { maxBuffer: 5_000_000 })
const events = stdout.trim().split('\n').map(line => JSON.parse(line))
const prompts = events.filter(e => e.type === 'user/message').flatMap(e => e.data.content).filter(c => c.type === 'text' && c.text.includes(`\n${review.reviewInputDigest}\n`))
assert.equal(prompts.length, 1)
const delimiter = '\n\nFrozen subject:\n'
const prompt = prompts[0].text
const suppliedSubject = JSON.parse(prompt.slice(prompt.indexOf(delimiter) + delimiter.length))
const repository = snapshot.repositorySnapshotsV3.find(r => r.id === operation.repositorySnapshotId)
const retrieval = snapshot.repositoryEvidenceRetrievalReports.find(r => r.id === operation.repositoryEvidenceRetrievalReportId)
const manifest = snapshot.requirementSourceManifests.find(r => r.id === operation.sourceManifestId)
const stage = new BindingStage({})
const replayed = await stage.loadFrozenEvidence(repository, { projectId: operation.projectId, operationId, references: stage.repositoryReferences(repository, retrieval) }, manifest.anchors.map(a => a.text).join('\n'))
assert.deepEqual(replayed, suppliedSubject.frozenSourceEvidence)
const pkg = suppliedSubject.frozenSourceEvidence.find(c => c.path === 'package.json')
const offset = pkg.content.indexOf('"./cors"')
assert.ok(offset >= 0)
const snippet = pkg.content.slice(offset, offset + 225)
for (const target of ['./dist/types/middleware/cors/index.d.ts', './dist/middleware/cors/index.js', './dist/cjs/middleware/cors/index.js']) assert.ok(snippet.includes(target))
const report = { observedAt: new Date().toISOString(), operationId, projectId: operation.projectId, reviewId: review.id, reviewDigest: review.reviewDigest, reviewInputDigest: review.reviewInputDigest,
  bundlePath, bundleSha256,
  originalStatus: review.status, originalFindings: review.findings, sessionPath, sessionSha256: createHash('sha256').update(await readFile(sessionPath)).digest('hex'),
  suppliedSourceEvidenceDigest: digestObject(suppliedSubject.frozenSourceEvidence), replayMatchesActualPrompt: true,
  literalEvidence: { ref: pkg.ref, path: pkg.path, digest: pkg.digest, contentBytes: Buffer.byteLength(pkg.content), truncated: pkg.truncated, claimedMissingExport: './cors', literalPresent: true, snippet },
  interpretation: 'The actual review prompt contains the export mapping that the finding says is absent. The rejected verdict remains unchanged; this audit is not an approval, candidate or release pass.',
  modelRequests: 0, domainMutations: 0 }
await writeFile(destination, JSON.stringify(report, null, 2), { flag: 'wx' })
console.log(JSON.stringify({ destination, operationId, replayMatchesActualPrompt: true, exportMappingPresent: true, originalStatus: review.status, modelRequests: 0, domainMutations: 0 }))
