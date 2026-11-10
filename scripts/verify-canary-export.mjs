import assert from 'node:assert/strict'
import { readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { digestObject, PlanningReleaseCanarySchema } from '../lib/index.js'
import { validatePlanningCanary } from '../planning-evals/contracts.mjs'

// 重建环境显式提供当前导出与技术验收材料；不沿用遗失环境的最终 commit。
const [reportArgument, canaryArgument, technicalArgument] = process.argv.slice(2)
assert.ok([canaryArgument, technicalArgument].every(Boolean) || ![canaryArgument, technicalArgument].some(Boolean))
const technical = technicalArgument === undefined ? undefined : JSON.parse(await readFile(resolve(technicalArgument), 'utf8'))
if (technical) assert.equal(technical.status, 'technical_acceptance_passed')
const path = resolve(canaryArgument ?? 'output/acceptance/greeting-release-canary-v2-2026-10-15.json')
const canary = PlanningReleaseCanarySchema.parse(validatePlanningCanary(JSON.parse(await readFile(path, 'utf8')), '1.7.0'))
assert.equal(canary.schemaVersion, 2)
assert.equal(canary.finalCommit, technical?.finalCommit ?? '8541b63a4959b3b82ce12df570f93507f6435cba')
assert.equal(canary.taskRunCount, 2)
const response = await fetch(`${technical?.baseUrl ?? 'http://127.0.0.1:3087'}/project-orchestrator/api/snapshot`, { signal: AbortSignal.timeout(30_000) })
assert.equal(response.ok, true)
const snapshot = await response.json()
const projectId = 'ac9fafa7-c07b-4802-a177-6f4c986130bc'
const project = snapshot.projects.find(item => item.id === projectId)
if (technical) {
  assert.equal(technical.projectId, projectId)
  assert.equal(technical.operationId, canary.planningOperationId)
  assert.equal(technical.integration.approvedPlanSnapshotId, canary.planSnapshotId)
  assert.equal(technical.cwd, project?.cwd)
}
assert.equal(project?.status, 'completed')
assert.equal(project.deliveryStage, 'delivered')
const record = (table, id) => {
  const value = snapshot[table].find(item => item.id === id)
  assert.ok(value, `${table}: ${id}`)
  assert.equal(value.projectId, projectId)
  return value
}
const operation = record('planningOperations', canary.planningOperationId)
const manifest = record('requirementSourceManifests', operation.sourceManifestId)
const plan = record('planSnapshots', canary.planSnapshotId)
const approval = record('planApprovalsV3', canary.approvalId)
const integration = record('deliveryIntegrationSnapshots', canary.deliveryIntegrationSnapshotId)
const convergence = record('deliveryConvergenceReviews', canary.convergenceReviewId)
assert.equal(digestObject(operation), canary.planningOperationDigest)
assert.equal(manifest.manifestDigest, canary.sourceSnapshotDigest)
assert.equal(digestObject(plan), canary.planSnapshotDigest)
assert.equal(approval.approvalDigest, canary.approvalDigest)
assert.equal(integration.integrationDigest, canary.deliveryIntegrationDigest)
assert.equal(convergence.convergenceDigest, canary.convergenceReviewDigest)
assert.equal(integration.finalCommit, canary.finalCommit)
const runs = canary.executionDispatches.flatMap(item => {
  const dispatch = record('executionDispatches', item.id)
  assert.equal(dispatch.dispatchDigest, item.digest)
  return dispatch.createdTaskRunIds.map(id => record('taskRuns', id))
})
assert.equal(runs.length, canary.taskRunCount)
assert.equal(new Set(runs.map(item => item.id)).size, 2)
assert.equal(runs.every(item => item.status === 'completed' && item.planSnapshotId === plan.id), true)
for (const item of canary.verificationInvocations) {
  const actual = record('verificationInvocations', item.id)
  assert.equal(actual.state, 'finished')
  assert.equal(actual.outcome, 'passed')
  for (const [key, value] of Object.entries(item)) assert.deepEqual(actual[key], value)
}
for (const item of canary.verificationEvidence) {
  const actual = record('verificationEvidence', item.id)
  const { evidenceDigest, ...core } = actual
  assert.equal(actual.status, 'passed')
  assert.equal(digestObject(core), evidenceDigest)
  assert.equal(evidenceDigest, item.evidenceDigest)
  assert.equal(actual.invocationId, item.invocationId)
  assert.equal(actual.taskRunId, item.taskRunId)
}
const human = canary.humanDeliveryConfirmation
const review = record('projectReviews', human.projectReviewId)
const delivery = record('deliveryRecords', human.deliveryRecordId)
assert.equal(review.status, 'approved')
assert.equal(review.decision, 'approve')
assert.equal(review.reviewerType, 'human')
assert.equal(review.independencePassed, true)
assert.deepEqual(review.waivers, [])
assert.equal(digestObject(review), human.projectReviewDigest)
assert.equal(digestObject(delivery), human.deliveryRecordDigest)
assert.equal(delivery.status, 'delivered')
assert.equal(delivery.deliveredBy, human.deliveredBy)
assert.equal(delivery.deliveredAt, human.deliveredAt)
assert.equal(delivery.headCommit, canary.finalCommit)
const bundle = {
  operationDigest: digestObject(operation), sourceManifestDigest: manifest.manifestDigest, planSnapshotDigest: digestObject(plan),
  approvalDigest: approval.approvalDigest, dispatches: canary.executionDispatches,
  taskRuns: runs.map(item => ({ id: item.id, taskId: item.taskId, executionContractDigest: item.executionContractDigest, outputCommit: item.outputCommit, status: item.status })).sort((a, b) => a.id.localeCompare(b.id)),
  verificationInvocations: canary.verificationInvocations, verificationEvidence: canary.verificationEvidence, humanDeliveryConfirmation: human,
  integrationDigest: integration.integrationDigest, convergenceDigest: convergence.convergenceDigest, evidenceRecordIds: canary.evidenceRecordIds,
}
assert.equal(digestObject(bundle), canary.evidenceBundleDigest)
const report = { verifiedAt: new Date().toISOString(), status: 'canary_v2_verified', path, projectId, finalCommit: canary.finalCommit,
  evidenceBundleDigest: canary.evidenceBundleDigest, taskRunCount: runs.length, humanReviewApproved: true, deliveryConfirmed: true }
const reportPath = resolve(reportArgument ?? 'output/acceptance/canary-export-verified-2026-10-15.json')
await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, { flag: 'wx' })
console.log(JSON.stringify(report))
