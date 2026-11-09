import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { promisify } from 'node:util'
import { digestObject } from '../lib/index.js'

// 仅在用户批准当前具体最终差异后调用；技术验收材料本身不构成人工批准。
const [technicalPath, destination, reviewDocument] = process.argv.slice(2)
assert.ok([technicalPath, destination, reviewDocument].every(Boolean) || ![technicalPath, destination, reviewDocument].some(Boolean))
const evidence = JSON.parse(await readFile(resolve(technicalPath ?? 'output/acceptance/canary-delivery-verified-2026-10-15.json'), 'utf8'))
const projectId = 'ac9fafa7-c07b-4802-a177-6f4c986130bc'
const finalCommit = technicalPath === undefined ? '8541b63a4959b3b82ce12df570f93507f6435cba' : evidence.finalCommit
assert.match(finalCommit, /^[a-f0-9]{40}$/u)
const base = evidence.baseUrl ?? 'http://127.0.0.1:3087'
assert.ok(['http://127.0.0.1:3087', 'http://127.0.0.1:3088'].includes(base))
const revision = evidence.review.revision
assert.ok(Number.isSafeInteger(revision) && revision > 0)
const actor = '用户（明确回复“批准最终交付并登记”）'
const reviewPath = reviewDocument ?? 'docs/canary-delivery-review-2026-10-15.zh-CN.md'
const reviewedText = await readFile(resolve(reviewPath), 'utf8')
assert.ok(reviewedText.includes(finalCommit), 'The reviewed document must name the exact final commit')
const note = `用户已审阅 ${reviewPath}，明确批准隔离 greeting revision ${revision} 最终 commit ${finalCommit}，授权正式登记人工审阅、确认交付及导出 canary。无验收或独立性豁免。`
assert.equal(evidence.projectId, projectId)
assert.equal(evidence.finalCommit, finalCommit)
assert.equal(evidence.status, 'technical_acceptance_passed')
const reportPath = resolve(destination ?? 'output/acceptance/canary-delivery-confirmed-2026-10-15.json')
const report = { projectId, finalCommit, authorization: '批准最终交付并登记', actor, events: [] }
await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, { flag: 'wx' })
const persist = () => writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`)
/** 通过固定隔离 Host 的正式审阅与交付接口写入；失败保留，不伪造成功回执。 */
const request = async (path, body) => {
  const response = await fetch(`${base}/project-orchestrator/api${path}`, {
    method: body === undefined ? 'GET' : 'POST', headers: { origin: base, 'content-type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(60_000),
  })
  const data = await response.json()
  if (!response.ok) throw new Error(`${path}: HTTP ${response.status}: ${data.error?.code}: ${data.error?.message}`)
  return data
}
const run = promisify(execFile)
const capture = async () => {
  const snapshot = await request('/snapshot')
  const project = snapshot.projects.find(item => item.id === projectId)
  assert.equal(project?.cwd, evidence.cwd)
  assert.equal(project.currentPlanSnapshotId, evidence.integration.approvedPlanSnapshotId)
  assert.equal(project.revision, revision)
  assert.equal(project.approvedRevision, revision)
  assert.equal(project.status, 'completed')
  const integration = snapshot.deliveryIntegrationSnapshots.find(item => item.id === project.currentDeliveryIntegrationSnapshotId)
  const convergence = snapshot.deliveryConvergenceReviews.find(item => item.id === project.currentDeliveryConvergenceReviewId)
  assert.equal(digestObject(integration), digestObject(evidence.integration))
  assert.equal(digestObject(convergence), digestObject(evidence.convergence))
  assert.equal(integration.finalCommit, finalCommit)
  const git = async args => (await run('git', args, { cwd: project.cwd, timeout: 30_000 })).stdout.trim()
  assert.equal(await git(['rev-parse', 'HEAD']), finalCommit)
  assert.equal(await git(['status', '--porcelain']), '')
  const review = snapshot.projectReviews.find(item => item.id === evidence.review.id)
  const delivery = snapshot.deliveryRecords.find(item => item.id === evidence.delivery.id)
  assert.equal(review?.revision, revision)
  assert.equal(review.planSnapshotId, project.currentPlanSnapshotId)
  assert.equal(review.reviewerType, 'human')
  assert.deepEqual(review.waivers, [])
  assert.equal(review.acceptanceResults.length, 2)
  assert.equal(review.acceptanceResults.every(item => item.result === 'passed'), true)
  assert.equal(delivery?.reviewId, review.id)
  assert.equal(delivery.headCommit, finalCommit)
  report.observedAt = new Date().toISOString()
  Object.assign(report, { project, review, delivery, integration, convergence })
  await persist()
  return { project, review, delivery }
}
try {
  let { project, review } = await capture()
  assert.equal(project.deliveryStage, 'review')
  assert.equal(review.status, 'pending')
  const body = { decision: 'approve', actor, note, waivers: [] }
  report.events.push({ at: new Date().toISOString(), action: 'review_resolved', state: 'reserved_before_request', body })
  await persist()
  const resolved = await request(`/projects/${projectId}/review/resolve`, body)
  report.events.push({ at: new Date().toISOString(), action: 'review_resolved', body, result: resolved })
  await persist()
  ;({ project, review } = await capture())
  assert.equal(project.deliveryStage, 'delivery_ready')
  assert.equal(review.status, 'approved')
  assert.equal(review.decision, 'approve')
  assert.equal(review.reviewerId, actor)
  assert.equal(review.independencePassed, true)
  const confirmation = { actor, note }
  report.events.push({ at: new Date().toISOString(), action: 'delivery_confirmed', state: 'reserved_before_request', body: confirmation })
  await persist()
  const delivered = await request(`/projects/${projectId}/delivery/confirm`, confirmation)
  report.events.push({ at: new Date().toISOString(), action: 'delivery_confirmed', body: confirmation, result: delivered })
  await persist()
  const completed = await capture()
  assert.equal(completed.project.deliveryStage, 'delivered')
  assert.equal(completed.delivery.status, 'delivered')
  assert.equal(completed.delivery.deliveredBy, actor)
  assert.ok(completed.delivery.deliveredAt)
  assert.equal(completed.delivery.pendingAuditEvents?.length ?? 0, 0)
  report.status = 'human_delivery_confirmed'
  await persist()
  console.log(JSON.stringify({ reportPath, status: report.status, finalCommit, reviewId: review.id, deliveryId: completed.delivery.id }))
} catch (error) {
  report.events.push({ at: new Date().toISOString(), action: 'failed', error: error.message })
  await persist()
  throw error
}
