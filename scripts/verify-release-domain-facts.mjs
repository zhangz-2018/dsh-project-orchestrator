import assert from 'node:assert/strict'
import { readFile, writeFile } from 'node:fs/promises'
import { resolve, sep } from 'node:path'
import { planningReleaseProvenanceFailures, validatePlanningCandidate } from '../planning-evals/contracts.mjs'

const ledgerPath = resolve(process.argv[2] ?? 'output/acceptance/release-collection-scenario-evidence-2026-10-16.json')
const journal = JSON.parse(await readFile(ledgerPath, 'utf8'))
const response = await fetch('http://127.0.0.1:3087/project-orchestrator/api/snapshot', { signal: AbortSignal.timeout(30_000) })
assert.ok(response.ok)
const snapshot = await response.json()
const candidateBytes = new Map()
for (const attempt of journal.attempts) {
  if (attempt.outcome !== 'candidate') continue
  assert.ok(attempt.candidateRef)
  const root = resolve('planning-evals')
  const path = resolve(root, attempt.candidateRef)
  assert.ok(path.startsWith(`${root}${sep}`))
  candidateBytes.set(attempt.candidateRef, await readFile(path, 'utf8'))
}
const facts = await Promise.all(journal.attempts.map(async attempt => {
  assert.ok(attempt.completedAt, 'An attempt remains in flight.')
  assert.ok(['candidate', 'model_failure', 'infrastructure_failure'].includes(attempt.outcome), 'Unrecognized outcome must remain unresolved.')
  const operation = snapshot.planningOperations.find(o => o.id === attempt.operationId)
  assert.ok(operation)
  assert.equal(operation.projectId, attempt.projectId)
  assert.equal(operation.predecessorOperationId, undefined)
  if (attempt.outcome === 'candidate') {
    assert.ok(['committed', 'blocked'].includes(operation.status))
    const candidate = JSON.parse(candidateBytes.get(attempt.candidateRef))
    assert.equal(candidate.executionKind, 'real_model')
  } else if (attempt.outcome === 'infrastructure_failure') {
    if (attempt.failureCode === 'ERR_ASSERTION') {
      // A rejected export remains an infrastructure failure. Verify the exact
      // mismatch rather than converting it into a qualified candidate.
      assert.ok(['committed', 'blocked'].includes(operation.status))
      assert.equal(attempt.candidateRef, undefined)
      const exported = await fetch(`http://127.0.0.1:3087/project-orchestrator/api/projects/${attempt.projectId}/planning-operations/${encodeURIComponent(operation.id)}/evaluation-export?caseId=${encodeURIComponent(attempt.caseId)}&runId=${encodeURIComponent(attempt.runId)}`, { signal: AbortSignal.timeout(30_000) })
      assert.ok(exported.ok)
      const candidate = validatePlanningCandidate(await exported.json(), attempt.caseId, attempt.runId)
      const gold = JSON.parse(await readFile(resolve('planning-evals/cases', attempt.caseId, 'gold.json'), 'utf8'))
      const mismatches = planningReleaseProvenanceFailures(gold, candidate)
      assert.ok(mismatches.length > 0)
      for (const mismatch of mismatches) assert.ok(attempt.exportError?.includes(mismatch), 'Export rejection must match retained provenance failure.')
    } else {
      assert.equal(attempt.failureCode, 'planning-policy-superseded')
      assert.equal(operation.status, 'superseded')
      assert.equal(operation.stage, 'policy_snapshot')
      assert.ok(operation.diagnostics.some(d => d.code === 'repository-policy-delta'))
      const successors = snapshot.planningOperations.filter(o => o.predecessorOperationId === operation.id)
      assert.equal(successors.length, 1)
      assert.notEqual(successors[0].status, 'running')
      assert.equal(successors[0].projectId, attempt.projectId)
    }
  } else {
    assert.equal(operation.status, 'failed')
    assert.equal(attempt.candidateRef, undefined)
    assert.ok(operation.diagnostics.some(d => d.code === attempt.failureCode && ['error', 'blocking'].includes(d.severity)))
    assert.equal(operation.modelExecutionProvenance?.identitySource, 'resolved_model_route')
  }
  const scopedCounts = Object.fromEntries(['tasks', 'approvals', 'taskRuns', 'executionDispatches', 'planApprovalsV3', 'deliveryRecords'].map(key => [key, snapshot[key].filter(r => r.projectId === attempt.projectId).length]))
  for (const key of ['approvals', 'taskRuns', 'executionDispatches', 'planApprovalsV3', 'deliveryRecords']) assert.equal(scopedCounts[key], 0, `${key} outside planning-only scope`)
  return { caseId: attempt.caseId, runId: attempt.runId, projectId: attempt.projectId, operationId: operation.id, operationStatus: operation.status, outcome: attempt.outcome, ...(attempt.failureCode === undefined ? {} : { failureCode: attempt.failureCode }), scopedCounts }
}))
const report = { observedAt: new Date().toISOString(), batchId: journal.batchId, ledgerPath,
  attemptCount: facts.length, caseCount: new Set(facts.map(f => f.caseId)).size,
  committed: facts.filter(f => f.operationStatus === 'committed').length,
  blocked: facts.filter(f => f.operationStatus === 'blocked').length,
  modelFailures: facts.filter(f => f.outcome === 'model_failure').length,
  infrastructureFailures: facts.filter(f => f.outcome === 'infrastructure_failure').length,
  noTaskExecutionOrApproval: true, facts }
const destination = resolve(process.argv[3] ?? 'output/acceptance/release-full-domain-facts-2026-10-16.json')
await writeFile(destination, `${JSON.stringify(report, null, 2)}\n`, { flag: 'wx' })
console.log(JSON.stringify({ ...report, facts: undefined, destination }))
