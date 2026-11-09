import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { open, readFile, rename, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { validatePlanningEvalManifest } from '../planning-evals/contracts.mjs'

// Recover only the recorded pre-HTTP assertion from the original collector.
// No model or domain write occurs here. The original failed attempt remains.
const ledgerPath = resolve('output/acceptance/release-collection-journal-2026-10-16.json')
const journal = JSON.parse(await readFile(ledgerPath, 'utf8'))
const entry = journal.attempts.find((a) => a.attemptId === 'mitt-once-reentrancy-pending/fresh-3')
assert.equal(entry?.state, 'request_outcome_requires_observation')
assert.equal(entry.requestErrorCode, 'ERR_ASSERTION')
assert.equal(entry.operationId, undefined)
assert.equal(entry.completedAt, undefined)
assert.equal(entry.requestDispatchedAt, undefined)
const base = 'http://127.0.0.1:3087/project-orchestrator/api'
const get = async (path) => {
  const response = await fetch(`${base}${path}`, { signal: AbortSignal.timeout(30_000) })
  assert.ok(response.ok)
  return response.json()
}
const operations = await get(`/projects/${entry.projectId}/planning-operations`)
assert.deepEqual(operations.map((o) => o.id).sort(), [...entry.previousOperationIds].sort())
assert.ok(operations.every((o) => o.status === 'blocked'))
const project = (await get('/snapshot')).projects.find((p) => p.id === entry.projectId)
assert.equal(project.status, 'draft')
assert.equal(project.activePlanningOperationId, undefined)
assert.equal(project.currentPlanSnapshotId, undefined)
const packet = JSON.parse(await readFile(resolve('output/acceptance/release-input-review-v5-2026-10-16/review-inputs.json'), 'utf8'))
assert.equal(project.prd, packet.cases.find((c) => c.caseId === entry.caseId).proposedPrd.trim())
// In the interrupted collector, ERR_ASSERTION can arise only while validating
// Project/bundle facts before request(); request() reports HTTP errors by code.
const completedAt = new Date().toISOString()
Object.assign(entry, { completedAt, outcome: 'infrastructure_failure', failureCode: 'collector-project-restoration-race', state: 'local_preflight_failed_before_request', requestDispatched: false })
const retry = { caseId: entry.caseId, attemptId: `${entry.attemptId}/local-preflight-recovery`, projectId: entry.projectId, runId: entry.runId, state: 'reserved_before_request', startedAt: completedAt, previousOperationIds: entry.previousOperationIds, retryOfAttemptId: entry.attemptId }
assert.ok(!journal.attempts.some((a) => a.attemptId === retry.attemptId))
journal.attempts.push(retry)
const manifest = { schemaVersion: 1, batchId: journal.batchId, createdAt: journal.createdAt, metricPolicy: journal.metricPolicy, cases: journal.cases, attempts: journal.attempts.filter((a) => a.completedAt !== undefined).map((a) => Object.fromEntries(['caseId', 'attemptId', 'operationId', 'outcome', 'candidateRef', 'failureCode', 'startedAt', 'completedAt'].filter((key) => a[key] !== undefined).map((key) => [key, a[key]]))) }
validatePlanningEvalManifest(manifest)
for (const [path, data] of [[ledgerPath, journal], [resolve('planning-evals/release-manifest.json'), manifest]]) {
  const temporary = `${path}.${randomUUID()}.tmp`
  const file = await open(temporary, 'wx', 0o600)
  try { await file.writeFile(JSON.stringify(data, null, 2)); await file.sync() } finally { await file.close() }
  await rename(temporary, path)
}
const report = { observedAt: completedAt, originalFailureRetained: true, originalAttemptId: entry.attemptId, retryAttemptId: retry.attemptId, actualNewOperations: 0, modelRequests: 0, unchangedPrd: true, projectStatus: project.status, projectUpdatedAt: project.updatedAt, attemptStartedAt: entry.startedAt, observation: 'Terminal operation was visible before Project restoration completed; the old collector assertion ran before any POST.' }
await writeFile(resolve('output/acceptance/release-local-preflight-recovery-2026-10-16.json'), JSON.stringify(report, null, 2), { flag: 'wx' })
console.log(JSON.stringify(report))
