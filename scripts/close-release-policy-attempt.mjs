import assert from 'node:assert/strict'
import { readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { validatePlanningEvalManifest } from '../planning-evals/contracts.mjs'

// Close an already dispatched, superseded attempt without another model call
// or domain write. Preserve the root and successor as separate facts.
const ledgerPath = resolve(process.argv[2])
const manifestPath = resolve(process.argv[3])
const journal = JSON.parse(await readFile(ledgerPath, 'utf8'))
const pending = journal.attempts.filter(a => a.completedAt === undefined)
assert.equal(pending.length, 1)
const entry = pending[0]
const response = await fetch('http://127.0.0.1:3087/project-orchestrator/api/snapshot')
assert.ok(response.ok)
const snapshot = await response.json()
const operation = snapshot.planningOperations.find(o => o.id === entry.operationId)
assert.equal(operation?.projectId, entry.projectId)
assert.equal(operation.status, 'superseded')
assert.equal(operation.stage, 'policy_snapshot')
assert.ok(operation.diagnostics.some(d => d.code === 'repository-policy-delta'))
const successors = snapshot.planningOperations.filter(o => o.predecessorOperationId === operation.id)
assert.equal(successors.length, 1)
assert.notEqual(successors[0].status, 'running')
assert.equal(successors[0].projectId, entry.projectId)
entry.state = 'superseded'
entry.outcome = 'infrastructure_failure'
entry.failureCode = 'planning-policy-superseded'
entry.completedAt = operation.completedAt
entry.observedSuccessors = successors.map(o => ({ operationId: o.id, predecessorOperationId: o.predecessorOperationId, status: o.status, stage: o.stage, completedAt: o.completedAt, diagnostics: o.diagnostics }))
const manifest = { schemaVersion: 1, batchId: journal.batchId, createdAt: journal.createdAt, metricPolicy: journal.metricPolicy, cases: journal.cases, attempts: journal.attempts.map(a => Object.fromEntries(['caseId', 'attemptId', 'operationId', 'outcome', 'candidateRef', 'failureCode', 'startedAt', 'completedAt'].filter(key => a[key] !== undefined).map(key => [key, a[key]]))) }
validatePlanningEvalManifest(manifest)
// Save the original journal once before updating either local projection.
await writeFile(`${ledgerPath}.before-policy-close`, await readFile(ledgerPath), { flag: 'wx' })
await writeFile(ledgerPath, JSON.stringify(journal, null, 2))
await writeFile(manifestPath, JSON.stringify(manifest, null, 2))
console.log(JSON.stringify({ batchId: journal.batchId, operationId: operation.id, outcome: entry.outcome, successors: entry.observedSuccessors, modelRequests: 0, domainMutations: 0 }))
