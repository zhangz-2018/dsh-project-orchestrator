import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFile, writeFile } from 'node:fs/promises'
import { relative, resolve } from 'node:path'
import { planningGoldDigest, validatePlanningEvalManifest, validatePlanningGold } from '../planning-evals/contracts.mjs'

// Combine disjoint collectors after they stop; retain EVERY recorded outcome.
const [batchId, ledgerPath, manifestPath, ...inputs] = process.argv.slice(2)
assert.ok(batchId && ledgerPath && manifestPath && inputs.length >= 2)
const sources = []
const ledgers = []
for (const input of inputs) {
  const bytes = await readFile(input)
  const ledger = JSON.parse(bytes)
  assert.ok(ledger.attempts.every(a => a.completedAt), 'Never combine an in-flight collection.')
  sources.push({ path: resolve(input), batchId: ledger.batchId, sha256: createHash('sha256').update(bytes).digest('hex') })
  ledgers.push(ledger)
}
for (const ledger of ledgers) {
  assert.deepEqual(ledger.metricPolicy, ledgers[0].metricPolicy)
  assert.deepEqual(ledger.authorization, ledgers[0].authorization)
}
const cases = new Map()
for (const ledger of ledgers) for (const c of ledger.cases) {
  if (cases.has(c.caseId)) assert.deepEqual(c, cases.get(c.caseId), 'Never combine differing frozen Gold.')
  cases.set(c.caseId, c)
}
const attempts = ledgers.flatMap(l => l.attempts).sort((a, b) => a.startedAt.localeCompare(b.startedAt) || a.attemptId.localeCompare(b.attemptId))
const bundleDigests = new Set()
for (const c of cases.values()) {
  const gold = validatePlanningGold(JSON.parse(await readFile(resolve('planning-evals/cases', c.caseId, 'gold.json'), 'utf8')), c.caseId)
  assert.equal(planningGoldDigest(gold), c.goldDigest)
  assert.equal(gold.schemaVersion, 2)
  assert.ok(gold.releaseInput?.promptVersionsDigest)
  bundleDigests.add(gold.releaseInput.promptVersionsDigest)
}
assert.equal(bundleDigests.size, 1, 'Never combine multiple product bundles into one acceptance batch.')
assert.equal(new Set(attempts.map(a => a.attemptId)).size, attempts.length)
const operations = attempts.filter(a => a.operationId).map(a => a.operationId)
assert.equal(new Set(operations).size, operations.length, 'One operation must not be counted twice.')
const report = { batchId, createdAt: ledgers.map(l => l.createdAt).sort()[0], combinedAt: new Date().toISOString(), sources, authorization: ledgers[0].authorization, metricPolicy: ledgers[0].metricPolicy, cases: [...cases.values()], attempts }
const manifest = { schemaVersion: 1, batchId, createdAt: report.createdAt, metricPolicy: report.metricPolicy, cases: report.cases,
  attempts: attempts.map(a => Object.fromEntries(['caseId', 'attemptId', 'operationId', 'outcome', 'candidateRef', 'failureCode', 'startedAt', 'completedAt'].filter(k => a[k] !== undefined).map(k => [k, k === 'candidateRef' ? relative(resolve(manifestPath, '..'), resolve('planning-evals', a[k])) : a[k]]))) }
validatePlanningEvalManifest(manifest)
await writeFile(ledgerPath, JSON.stringify(report, null, 2), { flag: 'wx' })
await writeFile(manifestPath, JSON.stringify(manifest, null, 2), { flag: 'wx' })
console.log(JSON.stringify({ batchId, ledgerPath, manifestPath, cases: report.cases.length, attempts: attempts.length, candidates: attempts.filter(a => a.outcome === 'candidate').length, failedOutcomesRetained: attempts.filter(a => a.outcome !== 'candidate').length, domainMutations: 0 }))
