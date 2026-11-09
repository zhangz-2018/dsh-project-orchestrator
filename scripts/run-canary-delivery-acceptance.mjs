import assert from 'node:assert/strict'
import { readFile, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'

const args = process.argv.slice(2)
const action = args[0] ?? '--snapshot'
assert.ok(['--approve', '--implement', '--verify', '--snapshot', '--observe'].includes(action))
assert.ok(args.length === 1 || args.length === 4)
const reviewed = JSON.parse(await readFile(resolve(args[1] ?? 'output/acceptance/canary-plan-review-ready-2026-10-15.json'), 'utf8'))
const prepared = JSON.parse(await readFile(resolve(args[2] ?? 'output/acceptance/isolated-harness-2026-10-14.json'), 'utf8'))
const journal = reviewed.journalPath === undefined ? undefined : JSON.parse(await readFile(reviewed.journalPath, 'utf8'))
const base = journal?.baseUrl ?? 'http://127.0.0.1:3087'
assert.ok(['http://127.0.0.1:3087', 'http://127.0.0.1:3088'].includes(base))
const { projectId, operationId } = reviewed
assert.equal(projectId, 'ac9fafa7-c07b-4802-a177-6f4c986130bc')
assert.equal(operationId, journal?.currentOperationId ?? 'planning-v3:59ca03a4-22a8-4960-b2ce-e906ad525c2d')
if (journal) {
  assert.equal(journal.state, 'terminal')
  assert.equal(journal.projectId, prepared.projectId)
  assert.equal(journal.bundleSha256, reviewed.bundleSha256)
  assert.equal(journal.baselineCommit, prepared.baselineCommit)
}
const reportPath = resolve(args[3] ?? 'output/acceptance/canary-delivery-execution-2026-10-15.json')
let report
try { report = JSON.parse(await readFile(reportPath, 'utf8')) } catch (error) {
  if (error.code !== 'ENOENT') throw error
  report = { projectId, operationId, baseUrl: base, events: [] }
}
assert.equal(report.projectId, projectId)
assert.equal(report.operationId, operationId)
const persist = () => writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`)
/** 正式接口失败保留错误，不把未知 POST 结果视为未执行；幂等键绑定当前计划。 */
const request = async (path, body) => {
  const response = await fetch(`${base}/project-orchestrator/api${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { origin: base, 'content-type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(60_000),
  })
  const data = await response.json()
  if (!response.ok) throw new Error(`${path}: HTTP ${response.status}: ${data.error?.code ?? 'unknown'}: ${data.error?.message ?? ''}`)
  return data
}
const snapshot = async () => {
  const data = await request('/snapshot')
  const project = data.projects.find(item => item.id === projectId)
  assert.equal(project?.cwd, prepared.workspace ?? join(prepared.root, 'workspaces/greeting'))
  assert.equal(project.currentPlanSnapshotId, reviewed.plan.id)
  assert.equal(project.revision, reviewed.project.revision)
  const plan = data.planSnapshots.find(item => item.id === project.currentPlanSnapshotId)
  assert.equal(plan.planHash, reviewed.plan.planHash)
  return { data, project, plan }
}
const capture = async () => {
  const { data, project, plan } = await snapshot()
  const belongs = item => item.projectId === projectId
  report.observedAt = new Date().toISOString()
  report.project = project
  report.plan = plan
  for (const key of ['tasks', 'planApprovalsV3', 'executionDispatches', 'runs', 'taskRuns', 'verificationSpecs',
    'verificationInvocations', 'verificationEvidence', 'deliveryIntegrationIntents', 'deliveryIntegrationSnapshots',
    'integrationInclusionEvidence', 'deliveryConvergenceReviews', 'deliveryConvergenceFindings', 'projectReviews', 'deliveryRecords']) {
    report[key] = data[key].filter(belongs)
  }
  await persist()
  return { data, project, plan }
}
try {
  const { data, project, plan } = await capture()
  if (action === '--approve') {
    assert.ok(['awaiting_approval', 'approved'].includes(project.status))
    const body = { ...reviewed.approvalInput, approverId: `用户（明确批准隔离 greeting 的 revision ${project.revision} 计划）`,
      idempotencyKey: `canary-user-approved-plan:${plan.planHash}` }
    report.authorization = { scope: '用户明确批准当前具体计划并执行隔离验收', ...reviewed.approvalInput }
    report.events.push({ at: new Date().toISOString(), action, state: 'reserved_before_request', body })
    await persist()
    const approval = await request(`/projects/${projectId}/approvals`, body)
    assert.equal(approval.planDigest, reviewed.plan.planHash)
    report.events.push({ at: new Date().toISOString(), action, body, approval })
    assert.equal((await capture()).data.taskRuns.filter(item => item.projectId === projectId).length, 0)
    console.log(JSON.stringify({ action, approvalId: approval.id, planDigest: approval.planDigest, dispatchStatus: approval.executionDispatchStatusAtApproval }))
  } else if (action === '--implement' || action === '--verify') {
    const approval = data.planApprovalsV3.find(item => item.projectId === projectId && item.planSnapshotId === plan.id)
    assert.ok(approval)
    const taskKey = action === '--implement' ? 'TASK-IMPLEMENT' : 'TASK-VERIFY'
    const taskId = `task:${operationId}:${taskKey}`
    assert.ok(plan.taskIds.includes(taskId))
    const task = data.tasks.find(item => item.id === taskId)
    assert.ok(task)
    if (action === '--verify') {
      const dependencyId = `task:${operationId}:TASK-IMPLEMENT`
      assert.equal(data.tasks.find(item => item.id === dependencyId)?.status, 'completed')
      assert.ok(data.taskRuns.some(item => item.taskId === dependencyId && item.status === 'completed'))
    }
    const body = { approvalId: approval.id, expectedProjectRevision: project.revision,
      taskIds: [taskId], idempotencyKey: `canary-${taskKey.toLowerCase()}:${plan.planHash}` }
    report.events.push({ at: new Date().toISOString(), action, state: 'reserved_before_request', body })
    await persist()
    const result = await request(`/projects/${projectId}/execution-dispatches`, body)
    report.events.push({ at: new Date().toISOString(), action, body, result })
    await persist()
    assert.equal(result.dispatch.outcome, 'started')
    assert.equal(result.dispatch.createdTaskRunIds.length, 1)
    await capture()
    console.log(JSON.stringify({ action, dispatchId: result.dispatch.id, taskRunId: result.dispatch.createdTaskRunIds[0], projectStatus: result.project.status }))
  } else if (action === '--snapshot') {
    console.log(JSON.stringify({ projectStatus: project.status, deliveryStage: project.deliveryStage,
      tasks: report.tasks.map(item => ({ id: item.id, status: item.status })),
      taskRuns: report.taskRuns.map(item => ({ id: item.id, status: item.status, error: item.error })), reportPath }))
  } else {
    const deadline = Date.now() + 15 * 60_000
    let previous
    while (Date.now() < deadline) {
      const { project } = await capture()
      const state = { projectStatus: project.status, deliveryStage: project.deliveryStage,
        tasks: report.tasks.map(item => ({ key: item.id.split(':').at(-1), status: item.status })),
        taskRuns: report.taskRuns.map(item => ({ key: item.taskId?.split(':').at(-1), status: item.status, error: item.error })) }
      if (JSON.stringify(state) !== previous) { console.log(JSON.stringify(state)); previous = JSON.stringify(state) }
      if (!['running', 'queued'].includes(project.status)) {
        report.observationStatus = project.status === 'failed' || report.taskRuns.some(item => item.status === 'failed') ? 'execution_not_passed' : 'execution_settled'
        await persist()
        if (report.observationStatus === 'execution_not_passed') process.exitCode = 1
        break
      }
      await new Promise(resolveWait => setTimeout(resolveWait, 5000))
    }
    if (Date.now() >= deadline) {
      report.observationStatus = 'observation_timeout'
      await persist()
      process.exitCode = 1
    }
  }
} catch (error) {
  report.events.push({ at: new Date().toISOString(), action, error: error.message })
  await persist()
  throw error
}
