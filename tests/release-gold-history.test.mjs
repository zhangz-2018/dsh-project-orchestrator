import assert from 'node:assert/strict'
import test from 'node:test'
import { assertGoldPrecedesBundleCandidates } from '../scripts/release-gold-history.mjs'
import { digestObject } from '../lib/index.js'

const fixture = () => {
  const root = { id: 'root', projectId: 'p', status: 'superseded', stage: 'policy_snapshot', evaluationInput: { promptVersionsDigest: 'old' }, diagnostics: [{ code: 'repository-policy-delta' }], completedAt: '2026-10-16T01:00:00Z' }
  const successor = { id: 'successor', projectId: 'p', predecessorOperationId: 'root', idempotencyKey: 'repository-policy:root:delta', status: 'blocked', stage: 'policy_snapshot', diagnostics: [{ code: 'blocked' }], createdAt: '2026-10-16T01:00:01Z', completedAt: '2026-10-16T01:01:00Z' }
  const record = { operationId: 'root', projectId: 'p', outcome: 'infrastructure_failure', failureCode: 'planning-policy-superseded' }
  return { operations: [root, successor], history: {
    installedBundle: { installedBundleSha256: 'new', localBundleSha256: 'new', verifiedAt: '2026-10-16T02:00:00Z' },
    ledger: { batchId: 'old-batch', attempts: [{ ...record, completedAt: root.completedAt, observedSuccessors: [{ operationId: 'successor', predecessorOperationId: 'root', status: successor.status, stage: successor.stage, completedAt: successor.completedAt, diagnostics: successor.diagnostics }] }] },
    domainFacts: { batchId: 'old-batch', noTaskExecutionOrApproval: true, observedAt: '2026-10-16T01:02:00Z', facts: [{ ...record, operationStatus: 'superseded' }] },
  } }
}

test('Gold permits exactly witnessed old terminal policy successors without inventing their version', () => {
  const f = fixture()
  const proofs = assertGoldPrecedesBundleCandidates(f.operations, 'new', f.history)
  assert.equal(proofs.length, 1)
  assert.equal(proofs[0].successorBundleVersionInferred, false)
  assert.equal(proofs[0].countsAsFresh, false)
  assert.equal(assertGoldPrecedesBundleCandidates([f.operations[0]], 'new').length, 0)
})

test('Gold rejects absent, stale, current-bundle or unobserved policy history', () => {
  const mutations = [
    f => { f.history = undefined },
    f => { f.operations[0].evaluationInput.promptVersionsDigest = 'new' },
    f => { delete f.operations[0].evaluationInput },
    f => { f.operations[1].projectId = 'other' },
    f => { f.operations[1].status = 'running' },
    f => { f.operations[1].diagnostics = [] },
    f => { f.operations[1].id = 'unobserved' },
    f => { f.history.domainFacts.observedAt = '2026-10-16T03:00:00Z' },
    f => { f.history.domainFacts.facts = [] },
    f => { f.history.ledger.attempts[0].outcome = 'candidate' },
    f => { f.history.installedBundle.installedBundleSha256 = 'other' },
    f => { f.operations.push({ ...f.operations[1], id: 'extra' }) },
  ]
  for (const mutate of mutations) {
    const f = fixture()
    mutate(f)
    assert.throws(() => assertGoldPrecedesBundleCandidates(f.operations, 'new', f.history))
  }
})

test('Gold validates each historical root against exactly one retained evidence set across batches', () => {
  const first = fixture()
  const second = fixture()
  second.operations[0].id = 'root-2'
  second.operations[1].id = 'successor-2'
  second.operations[1].predecessorOperationId = 'root-2'
  second.operations[1].idempotencyKey = 'repository-policy:root-2:delta'
  second.history.ledger.batchId = 'old-batch-2'
  second.history.domainFacts.batchId = 'old-batch-2'
  second.history.ledger.attempts[0].operationId = 'root-2'
  second.history.domainFacts.facts[0].operationId = 'root-2'
  Object.assign(second.history.ledger.attempts[0].observedSuccessors[0], { operationId: 'successor-2', predecessorOperationId: 'root-2' })
  const operations = [...first.operations, ...second.operations]
  const history = [first.history, second.history]
  const saved = structuredClone(history)
  const proofs = assertGoldPrecedesBundleCandidates(operations, 'new', history)
  assert.deepEqual(proofs.map(p => p.historicalBatchId), ['old-batch', 'old-batch-2'])
  assert.ok(proofs.every(p => !p.countsAsFresh && !p.successorBundleVersionInferred))
  assert.deepEqual(history, saved)
  assert.throws(() => assertGoldPrecedesBundleCandidates(operations, 'new', [first.history]))
  assert.throws(() => assertGoldPrecedesBundleCandidates(operations, 'new', [...history, first.history]))
  second.history.domainFacts.facts[0].projectId = 'other'
  assert.throws(() => assertGoldPrecedesBundleCandidates(operations, 'new', history))
})

const separatelyObserved = () => {
  const f = fixture()
  delete f.history.ledger.attempts[0].observedSuccessors
  const [root, successor] = f.operations
  f.history.successorObservation = { batchId: 'old-batch', observedAt: '2026-10-16T01:01:30Z', status: 'policy_successors_terminal', modelRequests: 0, domainMutations: 0, ledgerMutations: 0, facts: [{
    projectId: 'p', rootOperationId: root.id, rootOperationDigest: digestObject(root), rootOutcome: 'infrastructure_failure',
    successorOperationId: successor.id, successorOperationDigest: digestObject(successor), predecessorOperationId: root.id,
    status: successor.status, stage: successor.stage, diagnostics: successor.diagnostics, completedAt: successor.completedAt,
    scopedCounts: { approvals: 0, taskRuns: 0, executionDispatches: 0, planApprovalsV3: 0, deliveryRecords: 0 }, countsAsFresh: false,
  }] }
  return f
}

test('Gold accepts an exact separately retained terminal observation without rewriting the collector ledger', () => {
  const f = separatelyObserved()
  const saved = structuredClone(f.history.ledger)
  assert.equal(assertGoldPrecedesBundleCandidates(f.operations, 'new', f.history).length, 1)
  assert.deepEqual(f.history.ledger, saved)
})

test('Gold rejects altered separate observations, execution facts and observations after the domain audit', () => {
  for (const mutate of [
    f => { f.history.successorObservation.batchId = 'other' },
    f => { f.history.successorObservation.observedAt = '2026-10-16T01:03:00Z' },
    f => { f.history.successorObservation.facts[0].successorOperationDigest = 'bad' },
    f => { f.history.successorObservation.facts[0].rootOperationDigest = 'bad' },
    f => { f.history.successorObservation.facts[0].scopedCounts.taskRuns = 1 },
    f => { f.history.successorObservation.facts[0].diagnostics = [] },
    f => { f.history.successorObservation.facts[0].countsAsFresh = true },
    f => { f.history.successorObservation.facts.push(f.history.successorObservation.facts[0]) },
  ]) {
    const f = separatelyObserved()
    mutate(f)
    assert.throws(() => assertGoldPrecedesBundleCandidates(f.operations, 'new', f.history))
  }
})
