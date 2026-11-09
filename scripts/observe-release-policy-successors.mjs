import assert from 'node:assert/strict'
import { readFile, writeFile } from 'node:fs/promises'
import { digestObject } from '../lib/index.js'

// Observe already-running automatic work. Never dispatch or edit the ledger.
const ledgerPath = process.argv[2]
const destination = process.argv[3]
assert.ok(ledgerPath && destination)
const journal = JSON.parse(await readFile(ledgerPath, 'utf8'))
const roots = journal.attempts.filter(a => a.failureCode === 'planning-policy-superseded' && a.operationId)
assert.ok(roots.length)
const deadline = Date.now() + 30 * 60_000
let lastState
while (Date.now() < deadline) {
  const response = await fetch('http://127.0.0.1:3087/project-orchestrator/api/snapshot', { signal: AbortSignal.timeout(30_000) })
  assert.ok(response.ok)
  const snapshot = await response.json()
  const facts = roots.map(a => {
    const root = snapshot.planningOperations.find(o => o.id === a.operationId)
    assert.equal(root?.projectId, a.projectId)
    assert.equal(root.status, 'superseded')
    assert.equal(root.stage, 'policy_snapshot')
    assert.ok(root.diagnostics.some(d => d.code === 'repository-policy-delta'))
    const successors = snapshot.planningOperations.filter(o => o.predecessorOperationId === root.id)
    // Root supersession and successor registration are separate durable writes.
    // An empty snapshot is not a failed successor and must not release a slot.
    assert.ok(successors.length <= 1, 'Multiple policy successors require investigation.')
    if (successors.length === 0) return { caseId: a.caseId, projectId: a.projectId, rootOperationId: root.id, status: 'awaiting_registration', countsAsFresh: false }
    const successor = successors[0]
    assert.equal(successor.projectId, a.projectId)
    const scopedCounts = Object.fromEntries(['approvals', 'taskRuns', 'executionDispatches', 'planApprovalsV3', 'deliveryRecords'].map(key => [key, snapshot[key].filter(r => r.projectId === a.projectId).length]))
    assert.ok(Object.values(scopedCounts).every(n => n === 0))
    return { caseId: a.caseId, projectId: a.projectId, rootOperationId: root.id, rootOperationDigest: digestObject(root), rootOutcome: a.outcome,
      successorOperationId: successor.id, successorOperationDigest: digestObject(successor), predecessorOperationId: successor.predecessorOperationId, status: successor.status, stage: successor.stage,
      diagnostics: successor.diagnostics, completedAt: successor.completedAt, scopedCounts, countsAsFresh: false }
  })
  const state = JSON.stringify(facts.map(f => ({ id: f.successorOperationId, status: f.status, stage: f.stage })))
  if (state !== lastState) { console.log(state); lastState = state }
  if (facts.every(f => f.successorOperationId && f.status !== 'running' && f.completedAt)) {
    const report = { observedAt: new Date().toISOString(), batchId: journal.batchId, ledgerPath, status: 'policy_successors_terminal', modelRequests: 0, domainMutations: 0, ledgerMutations: 0, facts }
    await writeFile(destination, JSON.stringify(report, null, 2), { flag: 'wx' })
    console.log(JSON.stringify({ destination, status: report.status, successors: facts.length }))
    process.exit(0)
  }
  await new Promise(done => setTimeout(done, 5000))
}
throw new Error('Successors remain unclosed; retain running work and do not infer completion.')
