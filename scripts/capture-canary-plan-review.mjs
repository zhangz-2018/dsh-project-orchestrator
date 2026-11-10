import assert from 'node:assert/strict'
import { readFile, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'

// 只读捕获指定隔离环境的当前计划；审批与派发必须使用独立正式流程。
const [contextPath, journalPath, destination] = process.argv.slice(2)
assert.ok([contextPath, journalPath, destination].every(Boolean) || ![contextPath, journalPath, destination].some(Boolean))
const prepared = JSON.parse(await readFile(resolve(contextPath ?? 'output/acceptance/isolated-harness-2026-10-14.json'), 'utf8'))
const journal = journalPath === undefined ? undefined : JSON.parse(await readFile(resolve(journalPath), 'utf8'))
if (journal) assert.equal(journal.state, 'terminal')
const base = `${journal?.baseUrl ?? 'http://127.0.0.1:3087'}/project-orchestrator/api`
const projectId = journal?.projectId ?? 'ac9fafa7-c07b-4802-a177-6f4c986130bc'
const operationId = journal?.currentOperationId ?? 'planning-v3:59ca03a4-22a8-4960-b2ce-e906ad525c2d'
/** GET 失败即中止捕获，不能把旧账本当作当前运行状态的证明。 */
const get = async path => {
  const response = await fetch(`${base}${path}`, { signal: AbortSignal.timeout(30_000) })
  const data = await response.json()
  if (!response.ok) throw new Error(`${path}: HTTP ${response.status}: ${data.error?.code ?? 'unknown'}`)
  return data
}
const [snapshot, planning, readiness, claims] = await Promise.all([
  get('/snapshot'), get(`/projects/${projectId}/planning`),
  get(`/projects/${projectId}/readiness`), get(`/projects/${projectId}/capability-claims`),
])
const project = snapshot.projects.find(item => item.id === projectId)
assert.equal(project?.cwd, prepared.workspace ?? join(prepared.root, 'workspaces/greeting'))
assert.equal(project.status, 'awaiting_approval')
assert.equal(project.revision, journal?.snapshot.projects.find(item => item.id === projectId)?.revision ?? 2)
assert.equal(planning.operation.id, operationId)
assert.equal(planning.operation.status, 'committed')
assert.deepEqual(planning.operation.diagnostics, [])
const plan = snapshot.planSnapshots.find(item => item.id === project.currentPlanSnapshotId)
assert.equal(plan?.planningOperationId, operationId)
assert.equal(plan.status, 'candidate')
assert.match(plan.planHash, /^[a-f0-9]{64}$/u)
const tasks = plan.taskIds.map(id => snapshot.tasks.find(item => item.id === id))
assert.equal(tasks.length, 2)
assert.equal(tasks.every(item => item?.projectId === projectId && item.planSnapshotId === plan.id), true)
const assignmentEvaluations = planning.assignmentEvaluations
assert.equal(assignmentEvaluations.length, 2)
assert.equal(assignmentEvaluations.every(item => item.outcome === 'selected'), true)
assert.equal(new Set(assignmentEvaluations.map(item => item.executingAgentId)).size, 2)
assert.equal(planning.taskPreflights.length, 2)
assert.equal(planning.taskPreflights.every(item => item.serviceVerdict === 'accepted'), true)
const reviews = {
  requirement: planning.requirementReview,
  scenario: planning.scenarioCoverageReview,
  binding: planning.bindingReview,
  plan: snapshot.planningReviewsV3.find(item => item.id === plan.planReviewId),
}
assert.equal(Object.values(reviews).every(item => item?.status === 'approved' && item.operationId === operationId), true)
assert.equal(readiness.planningReadiness.status, 'ready')
assert.equal(readiness.executionPreparation.status, 'ready')
const trustedClaims = claims.filter(item => item.source === 'human_confirmed' && item.status === 'active')
assert.equal(trustedClaims.length, 9)
const approvals = snapshot.planApprovalsV3.filter(item => item.projectId === projectId)
const dispatches = snapshot.executionDispatches.filter(item => item.projectId === projectId)
assert.equal(approvals.length, 0)
assert.equal(dispatches.length, 0)
for (const key of ['taskRuns', 'deliveryRecords']) assert.equal(snapshot[key].filter(item => item.projectId === projectId).length, 0)
const report = {
  observedAt: new Date().toISOString(), projectId, operationId,
  ...(journal === undefined ? {} : { journalPath: resolve(journalPath), bundleSha256: journal.bundleSha256, baselineCommit: journal.baselineCommit }),
  operation: planning.operation, project, plan, tasks, reviews, readiness,
  source: planning.sourceInput, analysis: planning.requirementAnalysisProposal,
  scenarios: planning.scenarios, bindings: planning.requirements,
  capabilityRequirements: snapshot.capabilityRequirementDrafts.filter(item => item.operationId === operationId),
  assignmentEvaluations, assignments: planning.assignments, taskPreflights: planning.taskPreflights,
  trustedClaims, approvalRecorded: false, dispatchRecorded: false,
  approvalInput: {
    planSnapshotId: plan.id, planDigest: plan.planHash, projectRevision: project.revision,
    accessGrantSnapshotId: plan.accessGrantSnapshotId, accessGrantDigest: plan.accessGrantDigest,
  },
}
const path = resolve(destination ?? 'output/acceptance/canary-plan-review-ready-2026-10-15.json')
await writeFile(path, `${JSON.stringify(report, null, 2)}\n`, { flag: 'wx' })
console.log(JSON.stringify({ path, operationId, status: planning.operation.status,
  planDigest: plan.planHash, trustedClaimCount: trustedClaims.length,
  assignments: assignmentEvaluations.map(item => ({ taskKey: item.taskKey, agentId: item.executingAgentId })),
  preflightsAccepted: planning.taskPreflights.length, approvalRecorded: false, dispatchRecorded: false }))
