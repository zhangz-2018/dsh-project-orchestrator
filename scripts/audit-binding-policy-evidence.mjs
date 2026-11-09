import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

// Replay retained source first, then inspect a new selection. No domain writes,
// model requests, source edits, or changes to the failed operation.
const [operationId, sessionPath, bundleArgument, destination] = process.argv.slice(2)
assert.ok(operationId && sessionPath && bundleArgument && destination)
const snapshot = await (await fetch('http://127.0.0.1:3087/project-orchestrator/api/snapshot')).json()
const operation = snapshot.planningOperations.find(o => o.id === operationId)
assert.equal(operation.status, 'blocked')
const repository = snapshot.repositorySnapshotsV3.find(r => r.id === operation.repositorySnapshotId)
const source = snapshot.requirementSourceManifests.find(r => r.id === operation.sourceManifestId)
const proposal = snapshot.requirementAnalysisProposals.find(r => r.id === operation.requirementAnalysisProposalId)
const retained = snapshot.planningPromptReferenceManifests.find(r => r.operationId === operationId && r.stageAttemptId.endsWith(':code_binding:1'))
assert.ok(repository && source && proposal && retained)
const bundlePath = resolve(bundleArgument)
const { BindingStage, buildRepositoryEvidenceRetrievalReportV3 } = await import(pathToFileURL(bundlePath).href)
const stage = new BindingStage({})
const focus = source.anchors.map(a => a.text).join('\n')
const events = execFileSync('zstd', ['-dc', sessionPath], { encoding: 'utf8', maxBuffer: 10_000_000 }).trim().split('\n').map(JSON.parse)
const actualPrompt = events.filter(e => e.type === 'user/message').flatMap(e => e.data.content).find(c => c.text?.startsWith('Frozen scope')).text
const supplied = JSON.parse(actualPrompt.split('\n\nAllowed evidence refs:\n')[1].split('\n\nReturn one corrected JSON object.')[0])
const replay = await stage.loadFrozenEvidence(repository, retained, focus)
const normalize = list => [...list].sort((a, b) => a.ref.localeCompare(b.ref))
const replayMatchesActualPrompt = JSON.stringify(normalize(replay)) === JSON.stringify(normalize(supplied.filter(e => e.content !== undefined)))
assert.equal(replayMatchesActualPrompt, true)
const hash = value => createHash('sha256').update(value).digest('hex')
const base = { observedAt: new Date().toISOString(), operationId, originalStatus: operation.status, originalDiagnostics: operation.diagnostics,
  bundlePath, bundleSha256: hash(await readFile(bundlePath)), sessionPath, sessionSha256: hash(await readFile(sessionPath)),
  replayMatchesActualPrompt, actualPrompt, modelRequests: 0, domainMutations: 0, originalVerdictUnchanged: true }
await writeFile(`${destination}-before.json`, JSON.stringify({ ...base, evidence: replay }, null, 2), { flag: 'wx' })
const report = await buildRepositoryEvidenceRetrievalReportV3({ projectId: operation.projectId, operationId, repository,
  requirements: proposal.analysis.requirements.filter(r => r.scope === 'in_scope').map(r => ({ key: r.key, statement: r.statement, acceptanceStatements: r.acceptanceCriteria.map(a => a.statement) })) })
const references = stage.repositoryReferences(repository, report)
const evidence = await stage.loadFrozenEvidence(repository, { ...retained, references }, focus)
const checks = []
for (const path of ['.gitignore', '.npmignore', '.dockerignore'].filter(path => focus.includes(path) && repository.files.some(f => f.path === path))) {
  const content = await readFile(resolve(repository.canonicalRoot, path), 'utf8')
  checks.push({ path, complete: evidence.some(e => e.path === path && !e.truncated && e.content === content) })
}
await writeFile(`${destination}-after.json`, JSON.stringify({ ...base, references, evidence, checks }, null, 2), { flag: 'wx' })
assert.ok(checks.length && checks.every(c => c.complete), JSON.stringify(checks))
console.log(JSON.stringify({ destination, replayMatchesActualPrompt, checks, bytes: evidence.reduce((n, e) => n + Buffer.byteLength(e.content), 0) }))
