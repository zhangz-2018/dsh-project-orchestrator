import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { execFile } from 'node:child_process'
import { readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { promisify } from 'node:util'

// 仅在重建 canary 的独立 Host 上启动或观察规划；不登记审批、不派发任务、不继承旧交付成绩。
const [contextPath, journalArgument, previousJournalPath] = process.argv.slice(2)
assert.ok(contextPath && journalArgument)
const context = JSON.parse(await readFile(resolve(contextPath), 'utf8'))
assert.equal(context.status, 'reconstructed_canary_draft_not_qualified')
assert.equal(context.projectId, 'ac9fafa7-c07b-4802-a177-6f4c986130bc')
const journalPath = resolve(journalArgument)
const base = 'http://127.0.0.1:3088'
const projectId = context.projectId
const bundle = createHash('sha256').update(await readFile('lib/index.js')).digest('hex')
assert.equal(bundle, createHash('sha256').update(await readFile(`${context.runtimeRoot}/node_modules/dsh-project-orchestrator/lib/index.js`)).digest('hex'))

/** 只访问固定隔离 Host；失败保留原请求意图，后续仅观察，不自动重发不确定请求。 */
async function request(path, body) {
  const response = await fetch(`${base}/project-orchestrator/api${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { origin: base, 'content-type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    signal: AbortSignal.timeout(30_000),
  })
  const value = await response.json()
  assert.ok(response.ok, `${path}: HTTP ${response.status} ${value.error?.code ?? ''}`)
  return value
}

let journal
try { journal = JSON.parse(await readFile(journalPath, 'utf8')) } catch (error) {
  if (error.code !== 'ENOENT') throw error
}
if (journal === undefined) {
  const snapshot = await request('/snapshot')
  const project = snapshot.projects.find(item => item.id === projectId)
  assert.equal(project?.cwd, context.workspace)
  assert.ok(['draft', 'awaiting_approval'].includes(project.status))
  for (const key of ['planApprovalsV3', 'executionDispatches', 'taskRuns', 'deliveryRecords']) assert.equal(snapshot[key].length, 0)
  const previous = previousJournalPath === undefined ? undefined : JSON.parse(await readFile(resolve(previousJournalPath), 'utf8'))
  if (previous) {
    assert.equal(previous.state, 'terminal')
    assert.equal(previous.projectId, projectId)
    assert.equal(previous.baselineCommit, context.baselineCommit)
    assert.notEqual(previous.bundleSha256, bundle, 'A failed same-bundle request must not be retried for a better score')
    // 新构建可替换从未批准或执行的候选；保留旧账本，通过正式 revise 重算全部阶段。
    assert.ok(previous.operations.every(item => ['blocked', 'superseded', 'committed'].includes(item.status)))
    assert.deepEqual(snapshot.planningOperations.map(item => item.id).sort(), [...previous.previousOperationIds, ...previous.operations.map(item => item.id)].sort())
    assert.ok(snapshot.planningOperations.every(item => item.status !== 'running'))
  } else {
    assert.equal(project.status, 'draft')
    assert.equal(snapshot.planningOperations.length, 0)
  }
  const receipts = JSON.parse(await readFile('output/acceptance/canary-capabilities-confirmed-2026-10-15.json', 'utf8'))
  for (const claim of receipts.result.claims) assert.deepEqual(snapshot.agentCapabilityClaims.find(item => item.id === claim.id), claim)
  assert.equal(project.prd, receipts.result.project.prd)
  assert.equal(project.technicalDesign, receipts.result.project.technicalDesign)
  const run = promisify(execFile)
  assert.equal((await run('git', ['rev-parse', 'HEAD'], { cwd: context.workspace })).stdout.trim(), context.baselineCommit)
  assert.equal((await run('git', ['status', '--porcelain'], { cwd: context.workspace })).stdout.trim(), '')
  let revisionInput
  let revisionBundleId
  if (project.status === 'awaiting_approval') {
    const plan = snapshot.planSnapshots.find(item => item.id === project.currentPlanSnapshotId)
    // 被阻塞的重算不会发布新计划；只沿用前次终态快照中真实保留的候选指针，不能假定失败操作已提交。
    const previousProject = previous.snapshot.projects.find(item => item.id === projectId)
    assert.equal(project.currentPlanSnapshotId, previousProject.currentPlanSnapshotId)
    assert.deepEqual(plan, previous.snapshot.planSnapshots.find(item => item.id === previousProject.currentPlanSnapshotId))
    assert.equal(plan?.status, 'candidate')
    assert.ok(previous.snapshot.planningOperations.some(item => item.id === plan.planningOperationId && item.status === 'committed'))
    const matrix = await request(`/projects/${projectId}/requirements?includeHistory=true`)
    const requirementBundle = matrix.bundles.find(item => item.id === plan.requirementBundleIds[0])
    assert.ok(requirementBundle)
    revisionBundleId = requirementBundle.id
    revisionInput = {
      title: project.name, prd: project.prd, technicalDesign: project.technicalDesign, taskLanguage: project.taskLanguage,
      sourceRefs: [], sourceBlocks: [...(project.prdSourceBlocks ?? []), ...(project.technicalDesignSourceBlocks ?? [])],
      expectedBundleUpdatedAt: requirementBundle.updatedAt, idempotencyKey: `reconstructed-canary:${bundle}`,
    }
  }
  // 意图先持久化；POST 超时也不代表未执行，必须从领域状态观察。
  journal = { projectId, baseUrl: base, bundleSha256: bundle, baselineCommit: context.baselineCommit,
    startedAt: new Date().toISOString(), state: 'request_reserved', previousOperationIds: snapshot.planningOperations.map(item => item.id),
    ...(previousJournalPath === undefined ? {} : { previousJournalPath: resolve(previousJournalPath) }), originalClaimsVerified: 9 }
  await writeFile(journalPath, JSON.stringify(journal, null, 2), { flag: 'wx', mode: 0o600 })
  try {
    if (project.status === 'draft') await request(`/projects/${projectId}/decompose`, {})
    else await request(`/projects/${projectId}/decompositions/${encodeURIComponent(revisionBundleId)}/revise`, revisionInput)
    journal.state = 'request_accepted'
  } catch (error) {
    journal.state = 'request_requires_observation'
    journal.requestError = error.message
  }
  await writeFile(journalPath, JSON.stringify(journal, null, 2))
}
assert.equal(journal.bundleSha256, bundle)
assert.equal(journal.projectId, projectId)
const deadline = Date.now() + 30 * 60_000
let previous
while (Date.now() < deadline) {
  const snapshot = await request('/snapshot')
  const operations = snapshot.planningOperations.filter(item => item.projectId === projectId && !journal.previousOperationIds.includes(item.id))
  const roots = operations.filter(item => item.predecessorOperationId === undefined)
  assert.ok(roots.length <= 1 && operations.length <= 2, 'Unexpected operation; do not send another request')
  const root = roots[0]
  const successor = operations.find(item => item.predecessorOperationId === root?.id)
  if (successor) assert.ok(root.status === 'superseded' && root.stage === 'policy_snapshot')
  const current = successor ?? root
  const state = JSON.stringify({ operationId: current?.id, status: current?.status, stage: current?.stage })
  if (state !== previous) { console.log(state); previous = state }
  if (current && current.status !== 'running' && (root.status !== 'superseded' || successor)) {
    const planning = await request(`/projects/${projectId}/planning`)
    const readiness = await request(`/projects/${projectId}/readiness`)
    Object.assign(journal, { state: 'terminal', observedAt: new Date().toISOString(), rootOperationId: root.id,
      currentOperationId: current.id, operations, planning, readiness, snapshot, requestResent: false,
      approvalsRecordedByScript: 0, tasksDispatchedByScript: 0, releaseQualified: false })
    await writeFile(journalPath, JSON.stringify(journal, null, 2))
    console.log(JSON.stringify({ status: current.status, stage: current.stage, journalPath, approvalRecorded: false }))
    if (current.status !== 'committed') process.exitCode = 1
    break
  }
  await new Promise(done => setTimeout(done, 5_000))
}
assert.equal(journal.state, 'terminal', 'Observation timed out; request retained, do not resend')
