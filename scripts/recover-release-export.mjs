import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { mkdir, open, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname, relative, resolve } from 'node:path'
import { planningReleaseProvenanceFailures, validatePlanningCandidate, validatePlanningEvalManifest } from '../planning-evals/contracts.mjs'
import { gradePlanningRun } from '../planning-evals/grader.mjs'

const ledgerPath = resolve('output/acceptance/release-collection-journal-2026-10-16.json')
const journal = JSON.parse(await readFile(ledgerPath, 'utf8'))
const original = journal.attempts.find((a) => a.attemptId === process.argv[2])
assert.equal(original?.outcome, 'infrastructure_failure')
assert.equal(original?.failureCode, 'route-not-found')
assert.ok(original.operationId)
const attemptId = `${original.attemptId}/export-recovery`
assert.ok(!journal.attempts.some((a) => a.attemptId === attemptId))
const startedAt = new Date().toISOString()
const response = await fetch(`http://127.0.0.1:3087/project-orchestrator/api/projects/${original.projectId}/planning-operations/${encodeURIComponent(original.operationId)}/evaluation-export?caseId=${encodeURIComponent(original.caseId)}&runId=${encodeURIComponent(original.runId)}`, { signal: AbortSignal.timeout(30_000) })
const data = await response.json()
assert.ok(response.ok, `${response.status} ${data.error?.code ?? ''}`)
const candidate = validatePlanningCandidate(data, original.caseId, original.runId)
const gold = JSON.parse(await readFile(resolve('planning-evals/cases', original.caseId, 'gold.json'), 'utf8'))
assert.deepEqual(planningReleaseProvenanceFailures(gold, candidate), [])
const path = resolve('planning-evals/cases', original.caseId, 'runs', `${original.runId}.json`)
await mkdir(dirname(path), { recursive: true })
await writeFile(path, JSON.stringify(candidate, null, 2), { flag: 'wx' })
const grade = gradePlanningRun(gold, candidate)
journal.attempts.push({ caseId: original.caseId, attemptId, projectId: original.projectId, runId: original.runId, operationId: original.operationId, outcome: 'candidate', candidateRef: relative(resolve('planning-evals'), path), startedAt, completedAt: new Date().toISOString(), state: 'export_recovered_without_model_call', grade })
const manifest = { schemaVersion: 1, batchId: journal.batchId, createdAt: journal.createdAt, metricPolicy: journal.metricPolicy, cases: journal.cases, attempts: journal.attempts.filter((a) => a.completedAt !== undefined).map((a) => Object.fromEntries(['caseId', 'attemptId', 'operationId', 'outcome', 'candidateRef', 'failureCode', 'startedAt', 'completedAt'].filter((key) => a[key] !== undefined).map((key) => [key, a[key]]))) }
validatePlanningEvalManifest(manifest)
for (const [target, value] of [[ledgerPath, journal], [resolve('planning-evals/release-manifest.json'), manifest]]) {
  const temporary = `${target}.${randomUUID()}.tmp`
  const file = await open(temporary, 'wx', 0o600)
  try { await file.writeFile(JSON.stringify(value, null, 2)); await file.sync() } finally { await file.close() }
  await rename(temporary, target)
}
console.log(JSON.stringify({ originalFailureRetained: true, operationId: original.operationId, recoveredAttemptId: attemptId, modelRequests: 0, metrics: grade.metrics }))
