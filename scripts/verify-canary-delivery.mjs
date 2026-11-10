import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { readFile, writeFile } from 'node:fs/promises'
import { resolve, join } from 'node:path'
import { promisify } from 'node:util'
import { digestObject } from '../lib/index.js'

const run = promisify(execFile)
const args = process.argv.slice(2)
assert.ok(args.length === 0 || ([2, 4].includes(args.length) && args[0] === '--output'))
const reportPath = resolve(args[1] ?? 'output/acceptance/canary-delivery-verified-2026-10-15.json')
const reviewed = JSON.parse(await readFile(resolve(args[2] ?? 'output/acceptance/canary-plan-review-ready-2026-10-15.json'), 'utf8'))
const prepared = JSON.parse(await readFile(resolve(args[3] ?? 'output/acceptance/isolated-harness-2026-10-14.json'), 'utf8'))
const journal = reviewed.journalPath === undefined ? undefined : JSON.parse(await readFile(reviewed.journalPath, 'utf8'))
const base = `${journal?.baseUrl ?? 'http://127.0.0.1:3087'}/project-orchestrator/api`
if (journal) {
  assert.equal(journal.state, 'terminal')
  assert.equal(journal.currentOperationId, reviewed.operationId)
  assert.equal(journal.bundleSha256, reviewed.bundleSha256)
  assert.equal(journal.baselineCommit, prepared.baselineCommit)
}
const { projectId, operationId } = reviewed
assert.equal(projectId, 'ac9fafa7-c07b-4802-a177-6f4c986130bc')
const response = await fetch(`${base}/snapshot`, { signal: AbortSignal.timeout(30_000) })
assert.equal(response.ok, true)
const snapshot = await response.json()
const project = snapshot.projects.find(item => item.id === projectId)
const cwd = prepared.workspace ?? join(prepared.root, 'workspaces/greeting')
assert.equal(project?.cwd, cwd)
assert.equal(project.currentPlanSnapshotId, reviewed.plan.id)
assert.equal(project.revision, reviewed.project.revision)
assert.equal(project.approvedRevision, project.revision)
assert.equal(project.status, 'completed')
assert.ok(['review', 'delivery_ready', 'delivered', 'closed'].includes(project.deliveryStage))
const integration = snapshot.deliveryIntegrationSnapshots.find(item => item.id === project.currentDeliveryIntegrationSnapshotId)
const convergence = snapshot.deliveryConvergenceReviews.find(item => item.id === project.currentDeliveryConvergenceReviewId)
assert.equal(integration?.status, 'ready')
assert.equal(integration.approvedPlanSnapshotId, reviewed.plan.id)
assert.equal(integration.baseCommit, prepared.baselineCommit ?? '6c046d7e11150f45ac9767146708663614803a1f')
assert.equal(convergence?.status, 'converged')
assert.equal(convergence.integratedFinalCommit, integration.finalCommit)
assert.equal(convergence.deliveryIntegrationSnapshotId, integration.id)
assert.deepEqual(convergence.findingIds, [])
const review = snapshot.projectReviews.find(item => item.id === `${projectId}:review:r${project.revision}`)
assert.equal(review?.planSnapshotId, reviewed.plan.id)
assert.equal(review.reviewerType, 'human')
assert.equal(review.status, project.deliveryStage === 'review' ? 'pending' : 'approved')
assert.deepEqual(review.waivers, [])
assert.equal(review.acceptanceResults.length, 2)
assert.equal(review.acceptanceResults.every(item => item.result === 'passed' && item.evidenceIds.length > 0), true)
const delivery = snapshot.deliveryRecords.find(item => item.id === `${projectId}:delivery:r${project.revision}`)
assert.equal(delivery?.reviewId, review.id)
assert.equal(delivery.planSnapshotId, reviewed.plan.id)
assert.equal(delivery.headCommit, integration.finalCommit)
assert.equal(integration.outputs.length, 2)
const taskRuns = integration.outputs.map(output => snapshot.taskRuns.find(item => item.id === output.taskRunId))
assert.equal(taskRuns.every(item => item?.status === 'completed' && item.planSnapshotId === reviewed.plan.id), true)
assert.deepEqual(new Set(taskRuns.map(item => item.agentId)), new Set(['default-agent-software-engineer', 'default-agent-test-engineer']))
assert.equal(snapshot.taskRuns.filter(item => item.projectId === projectId && item.planSnapshotId === reviewed.plan.id).length, 2)
const verifications = taskRuns.map(taskRun => {
  const invocation = snapshot.verificationInvocations.filter(item => item.taskRunId === taskRun.id)
  assert.equal(invocation.length, 1)
  const evidence = snapshot.verificationEvidence.find(item => item.invocationId === invocation[0].id)
  assert.equal(invocation[0].state, 'finished')
  assert.equal(invocation[0].outcome, 'passed')
  assert.equal(invocation[0].outputCommit, taskRun.outputCommit)
  assert.equal(evidence?.status, 'passed')
  assert.equal(evidence.schemaVersion, 2)
  assert.equal(evidence.outputCommit, taskRun.outputCommit)
  const { evidenceDigest, ...core } = evidence
  assert.equal(digestObject(core), evidenceDigest)
  return { taskRunId: taskRun.id, agentId: taskRun.agentId, outputCommit: taskRun.outputCommit,
    invocation, evidence }
})
const git = async args => (await run('git', args, { cwd, timeout: 30_000, maxBuffer: 1024 * 1024 })).stdout
assert.equal((await git(['rev-parse', 'HEAD'])).trim(), integration.finalCommit)
assert.equal((await git(['status', '--porcelain'])).trim(), '')
const paths = (await git(['diff', '--name-only', integration.baseCommit, integration.finalCommit])).trim().split('\n').filter(Boolean).sort()
assert.deepEqual(paths, ['src/greeting.ts', 'tests/greeting.test.ts'])
await git(['diff', '--exit-code', integration.baseCommit, integration.finalCommit, '--', 'package.json', 'README.md'])
const diff = await git(['diff', integration.baseCommit, integration.finalCommit, '--', 'src/greeting.ts', 'tests/greeting.test.ts'])
const npm = await run('npm', ['test'], { cwd, timeout: 60_000, maxBuffer: 1024 * 1024 })
// These assertions check the original user behavior independently of generated Tasks.
const behavior = await run(process.execPath, ['--experimental-strip-types', '--input-type=module', '-e',
  "import assert from 'node:assert/strict'; import { pathToFileURL } from 'node:url'; const { greet } = await import(pathToFileURL(process.argv[1]).href); assert.equal(greet(' Ada '), 'Hello, Ada!'); assert.equal(greet('Ada'), 'Hello, Ada!'); for (const name of ['', '   ', '\\t\\r\\n', '\\u00a0\\u3000']) assert.throws(() => greet(name), TypeError); console.log(JSON.stringify({trim:true,compatibility:true,emptyRejection:true,whitespaceVariants:3}));",
  join(cwd, 'src/greeting.ts')], { cwd, timeout: 30_000, maxBuffer: 1024 * 1024 })
assert.equal((await git(['rev-parse', 'HEAD'])).trim(), integration.finalCommit)
assert.equal((await git(['status', '--porcelain'])).trim(), '')
const report = {
  observedAt: new Date().toISOString(), projectId, operationId, cwd, baseUrl: journal?.baseUrl ?? 'http://127.0.0.1:3087',
  status: 'technical_acceptance_passed', finalHumanConfirmationRequired: ['review', 'delivery_ready'].includes(project.deliveryStage),
  baselineCommit: integration.baseCommit, finalCommit: integration.finalCommit,
  changedFiles: paths, diff, integration, convergence, review, delivery, verifications,
  npmTest: { exitCode: 0, stdout: npm.stdout, stderr: npm.stderr },
  behaviorChecks: { exitCode: 0, stdout: behavior.stdout, stderr: behavior.stderr },
  repositoryClean: true,
}
const path = reportPath
await writeFile(path, `${JSON.stringify(report, null, 2)}\n`, { flag: 'wx' })
console.log(JSON.stringify({ path, status: report.status, finalCommit: report.finalCommit, changedFiles: paths,
  taskRuns: taskRuns.length, independentAgents: 2, verificationPassed: verifications.length,
  finalHumanConfirmationRequired: report.finalHumanConfirmationRequired }))
