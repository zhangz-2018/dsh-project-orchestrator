import assert from 'node:assert/strict'
import { digestObject } from '../lib/index.js'

// This proves prior observation, NOT an inherited version for a successor.
// Unknown history still fails closed. It never turns a successor into fresh work.
export function assertGoldPrecedesBundleCandidates(operations, bundleDigest, history) {
  assert.ok(operations.every(o => o.status !== 'running'), 'Never freeze Gold while a project operation is in flight.')
  const proofs = []
  for (const operation of operations) {
    if (operation.evaluationInput?.promptVersionsDigest) {
      assert.notEqual(operation.evaluationInput.promptVersionsDigest, bundleDigest, 'Gold must precede every candidate on the evaluated bundle.')
      continue
    }
    assert.ok(history, 'Historical operation version or prior terminal observation must be provable.')
    const matchingHistories = Array.isArray(history)
      ? history.filter(item => item.ledger.attempts.some(attempt => attempt.operationId === operation.predecessorOperationId))
      : [history]
    assert.equal(matchingHistories.length, 1, 'Each historical root requires exactly one retained evidence set.')
    const observedHistory = matchingHistories[0]
    const { ledger, domainFacts, installedBundle } = observedHistory
    assert.equal(installedBundle.installedBundleSha256, bundleDigest)
    assert.equal(installedBundle.localBundleSha256, bundleDigest)
    assert.equal(domainFacts.batchId, ledger.batchId)
    assert.equal(domainFacts.noTaskExecutionOrApproval, true)
    const observed = Date.parse(domainFacts.observedAt)
    const activated = Date.parse(installedBundle.verifiedAt)
    assert.ok(Number.isFinite(observed) && Number.isFinite(activated) && observed < activated, 'The historical observation must precede this bundle installation verification.')
    const root = operations.find(o => o.id === operation.predecessorOperationId)
    assert.ok(root?.evaluationInput?.promptVersionsDigest && root.evaluationInput.promptVersionsDigest !== bundleDigest, 'An unknown or current-bundle predecessor cannot prove historical isolation.')
    assert.equal(root.projectId, operation.projectId)
    assert.equal(root.status, 'superseded')
    assert.equal(root.stage, 'policy_snapshot')
    assert.ok(root.diagnostics.some(d => d.code === 'repository-policy-delta'))
    assert.equal(operations.filter(o => o.predecessorOperationId === root.id).length, 1)
    assert.ok(operation.idempotencyKey?.startsWith(`repository-policy:${root.id}:`))
    assert.ok(['blocked', 'failed', 'committed'].includes(operation.status))
    assert.ok(Date.parse(root.completedAt) <= Date.parse(operation.createdAt) && Date.parse(operation.createdAt) <= Date.parse(operation.completedAt) && Date.parse(operation.completedAt) <= observed)
    const attempt = ledger.attempts.find(a => a.operationId === root.id)
    const fact = domainFacts.facts.find(f => f.operationId === root.id)
    for (const record of [attempt, fact]) {
      assert.equal(record?.projectId, operation.projectId)
      assert.equal(record.outcome, 'infrastructure_failure')
      assert.equal(record.failureCode, 'planning-policy-superseded')
    }
    assert.equal(fact.operationStatus, 'superseded')
    assert.equal(attempt.completedAt, root.completedAt)
    if (attempt.observedSuccessors !== undefined) {
      assert.deepEqual(attempt.observedSuccessors, [{ operationId: operation.id, predecessorOperationId: root.id, status: operation.status, stage: operation.stage, completedAt: operation.completedAt, diagnostics: operation.diagnostics }], 'Historical successor observation no longer matches live terminal facts.')
    } else {
      const separate = observedHistory.successorObservation
      assert.equal(separate?.batchId, ledger.batchId)
      assert.equal(separate.status, 'policy_successors_terminal')
      for (const key of ['modelRequests', 'domainMutations', 'ledgerMutations']) assert.equal(separate[key], 0)
      const witnessedAt = Date.parse(separate.observedAt)
      assert.ok(Number.isFinite(witnessedAt) && Date.parse(operation.completedAt) <= witnessedAt && witnessedAt <= observed)
      const matches = separate.facts.filter(f => f.rootOperationId === root.id)
      assert.equal(matches.length, 1)
      const witness = matches[0]
      assert.equal(witness.rootOperationDigest, digestObject(root))
      assert.equal(witness.successorOperationDigest, digestObject(operation))
      assert.equal(witness.projectId, operation.projectId)
      assert.equal(witness.rootOutcome, 'infrastructure_failure')
      assert.equal(witness.successorOperationId, operation.id)
      assert.equal(witness.predecessorOperationId, root.id)
      for (const key of ['status', 'stage', 'completedAt', 'diagnostics']) assert.deepEqual(witness[key], operation[key])
      assert.equal(witness.countsAsFresh, false)
      assert.deepEqual(witness.scopedCounts, { approvals: 0, taskRuns: 0, executionDispatches: 0, planApprovalsV3: 0, deliveryRecords: 0 })
    }
    proofs.push({ operationId: operation.id, basis: 'previously_observed_terminal_policy_successor', predecessorOperationId: root.id, historicalBatchId: ledger.batchId, observedAt: domainFacts.observedAt, bundleInstallationVerifiedAt: installedBundle.verifiedAt, successorBundleVersionInferred: false, countsAsFresh: false })
  }
  return proofs
}
