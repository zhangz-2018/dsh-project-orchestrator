import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { gradePlanningRun } from '../planning-evals/grader.mjs'
import { planningReleaseProvenanceFailures, validatePlanningCandidate } from '../planning-evals/contracts.mjs'

const ledgerPath = 'output/acceptance/release-ready-collection-transitive-policy-v13-2026-10-16.json'
const journal = JSON.parse(await readFile(ledgerPath, 'utf8'))
const entry = journal.attempts.find(a => a.operationId === 'planning-v3:31f51933-ce8e-48d4-ad37-d9a19a9307c2')
assert.equal(entry.outcome, 'infrastructure_failure')
assert.equal(entry.failureCode, 'ERR_ASSERTION')
assert.match(entry.exportError, /teamCatalogDigest does not match Gold/u)
const request = async path => {
  const response = await fetch(`http://127.0.0.1:3087/project-orchestrator/api${path}`, { signal: AbortSignal.timeout(30_000) })
  assert.ok(response.ok)
  return response.json()
}
const snapshot = await request('/snapshot')
const operation = snapshot.planningOperations.find(o => o.id === entry.operationId)
assert.equal(operation.status, 'blocked')
assert.equal(operation.stage, 'task_preflight')
const gold = JSON.parse(await readFile(resolve('planning-evals/cases', entry.caseId, 'gold.json'), 'utf8'))
const input = JSON.parse(await readFile(resolve('output/acceptance/release-transitive-policy-v13-ready-hono-gold-review-2026-10-16', `${entry.caseId}.input.json`), 'utf8'))
const before = input.preview.teamCatalogFacts
const after = operation.evaluationInput.teamCatalogFacts
const equal = (a, b) => JSON.stringify(a) === JSON.stringify(b)
for (const key of Object.keys(before).filter(k => k !== 'claims')) assert.deepEqual(after[key], before[key])
const added = after.claims.filter(c => !before.claims.some(v => equal(c, v)))
assert.equal(added.length, 2)
assert.ok(before.claims.every(c => after.claims.some(v => equal(c, v))))
for (const claim of added) {
  assert.equal(claim.status, 'pending')
  assert.equal(claim.source, 'legacy_pending_mapping')
  assert.equal(claim.capabilityId, 'data.change')
}
const producer = snapshot.planningOperations.filter(o => o.projectId === entry.projectId && added.every(c => c.validFrom === o.createdAt))
assert.equal(producer.length, 1)
assert.equal(producer[0].id, 'planning-v3:393695da-d5d5-4f3b-9b18-737d4e6a2b6c')
const candidate = validatePlanningCandidate(await request(`/projects/${entry.projectId}/planning-operations/${encodeURIComponent(entry.operationId)}/evaluation-export?caseId=${encodeURIComponent(entry.caseId)}&runId=${encodeURIComponent(entry.runId)}`), entry.caseId, entry.runId)
const mismatches = planningReleaseProvenanceFailures(gold, candidate)
assert.equal(mismatches.length, 1)
assert.match(mismatches[0], /teamCatalogDigest does not match Gold/u)
const counts = Object.fromEntries(['approvals', 'taskRuns', 'executionDispatches', 'planApprovalsV3', 'deliveryRecords'].map(key => [key, snapshot[key].filter(v => v.projectId === entry.projectId).length]))
assert.ok(Object.values(counts).every(n => n === 0))
const report = { observedAt: new Date().toISOString(), ledgerPath, operationId: operation.id, projectId: entry.projectId,
  originalOutcome: entry.outcome, originalFailureCode: entry.failureCode, mismatches,
  goldTeamDigest: gold.releaseInput.teamCatalogDigest, candidateTeamDigest: candidate.provenance.teamCatalogDigest,
  addedPendingDeclarations: added, producingOperationId: producer[0].id, producingOperationCreatedAt: producer[0].createdAt,
  diagnostics: operation.diagnostics, preflights: snapshot.taskPreflightsV3.filter(p => p.operationId === operation.id),
  unqualifiedExport: candidate, unqualifiedExportSha256: createHash('sha256').update(JSON.stringify(candidate)).digest('hex'),
  diagnosticGradeOnly: gradePlanningRun(gold, candidate), countsAsQualifiedCandidate: false,
  scopedCounts: counts, modelRequests: 0, domainMutations: 0, ledgerMutations: 0 }
const destination = 'output/acceptance/hono-maxage-team-drift-v13-2026-10-16.json'
await writeFile(destination, JSON.stringify(report, null, 2), { flag: 'wx' })
console.log(JSON.stringify({ destination, operationId: operation.id, addedPendingDeclarations: added.length, mismatches, diagnosticFalseBlockedRate: report.diagnosticGradeOnly.metrics.falseBlockedRate, countsAsQualifiedCandidate: false, modelRequests: 0, domainMutations: 0 }))
