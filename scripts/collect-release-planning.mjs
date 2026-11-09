import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { mkdir, open, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname, relative, resolve } from 'node:path'
import { planningGoldDigest, planningMetricPolicyDigest, planningReleaseProvenanceFailures, validatePlanningCandidate, validatePlanningGold } from '../planning-evals/contracts.mjs'
import { gradePlanningRun, READINESS_THRESHOLDS, RELEASE_THRESHOLDS } from '../planning-evals/grader.mjs'

// A single collector owns this ledger. Every start is journaled before HTTP;
// unknown in-flight work is retained for explicit resume, never silently retried.
const projects = JSON.parse(await readFile(resolve(process.argv[5] ?? 'output/acceptance/release-projects-2026-10-16.json'), 'utf8'))
const selected = process.argv[2]?.split(',')
assert.ok(selected?.length)
const readiness = process.argv[3] ?? 'blocked'
assert.ok(['ready', 'blocked'].includes(readiness))
const concurrency = Number(process.argv[4] ?? '1')
assert.ok(Number.isSafeInteger(concurrency) && concurrency >= 1 && concurrency <= 4)
assert.equal(new Set(selected).size, selected.length, 'Each project needs exactly one collector worker.')
const root = resolve('planning-evals')
const batchId = process.env.PO_PLANNING_EVAL_BATCH_ID ?? 'release-real-2026-10-16'
const configuredPaths = [process.env.PO_PLANNING_EVAL_BATCH_ID, process.env.PO_PLANNING_EVAL_LEDGER_PATH, process.env.PO_PLANNING_EVAL_MANIFEST_PATH]
assert.ok(configuredPaths.every((v) => v === undefined) || configuredPaths.every((v) => typeof v === 'string' && v.length > 0), 'A new version batch needs its own id, ledger and manifest; never overwrite a failed batch.')
const ledgerPath = resolve(process.env.PO_PLANNING_EVAL_LEDGER_PATH ?? 'output/acceptance/release-collection-journal-2026-10-16.json')
const manifestPath = resolve(process.env.PO_PLANNING_EVAL_MANIFEST_PATH ?? resolve(root, 'release-manifest.json'))
const runIndices = process.argv[6] === undefined ? [1, 2, 3, 4, 5] : process.argv[6].split(',').map(Number)
// Five valid candidates are a minimum, not a limit on observed attempts.
// Additional runs use distinct ids and never replace a failed attempt. A
// supplemental blocked run reuses its original, already prepared Project after
// verifying the exact frozen input; it still starts an independent root.
assert.ok(runIndices.length > 0 && new Set(runIndices).size === runIndices.length && runIndices.every((i) => Number.isSafeInteger(i) && i >= 1))
assert.ok(readiness !== 'blocked' || !runIndices.some(i => i > 5) || concurrency === 1, 'Supplemental blocked runs must serialize reuse of the original Project.')
const atomic = async (path, data) => {
  const temporary = `${path}.${randomUUID()}.tmp`
  const file = await open(temporary, 'wx', 0o600)
  try { await file.writeFile(JSON.stringify(data, null, 2)); await file.sync() } finally { await file.close() }
  await rename(temporary, path)
}
const request = async (path, body) => {
  const response = await fetch(`${projects.baseUrl}/project-orchestrator/api${path}`, { method: body === undefined ? 'GET' : 'POST', headers: { origin: projects.baseUrl, 'content-type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(30_000) })
  const result = await response.json()
  if (!response.ok) { const error = new Error(`${path}: HTTP ${response.status} ${result.error?.code ?? ''}`); error.code = result.error?.code ?? `http-${response.status}`; error.httpStatus = response.status; throw error }
  return result
}
const waitForProjectRestoration = async (projectId, deadline = Date.now() + 60_000) => {
  while (Date.now() < deadline) {
    const live = (await request('/snapshot')).projects.find(p => p.id === projectId)
    assert.ok(live, 'Project disappeared before request.')
    if (!live.activePlanningOperationId && ['draft', 'awaiting_approval'].includes(live.status)) return live
    assert.ok(live.status === 'decomposing', `Project cannot start another plan from ${live.status}.`)
    await new Promise(done => setTimeout(done, 250))
  }
  throw new Error('Project restoration did not complete before request.')
}
const planningInputPreview = async projectId => {
  const deadline = Date.now() + 60_000
  while (Date.now() < deadline) {
    await waitForProjectRestoration(projectId, deadline)
    try { return await request(`/projects/${projectId}/planning-evaluation-input`) } catch (error) {
      // The read-only endpoint also guards the in-memory operation registry,
      // which can clear after the restored Project row becomes visible.
      if (error.httpStatus !== 409 || error.code !== 'project-active') throw error
      await new Promise(done => setTimeout(done, 250))
    }
  }
  throw new Error('Planning preview remained active after Project restoration; no model request sent.')
}
let journal
try { journal = JSON.parse(await readFile(ledgerPath, 'utf8')) } catch (error) {
  if (error.code !== 'ENOENT') throw error
  const policy = { id: 'release-quality-2026-10-16', version: '1', thresholds: { ...RELEASE_THRESHOLDS, ...READINESS_THRESHOLDS, modelFailureRate: { max: 0 } } }
  policy.digest = planningMetricPolicyDigest(policy)
  journal = { batchId, createdAt: new Date().toISOString(), authorization: { modelProvider: 'pockapi', modelId: 'gpt-6.1-sol', tokenLimit: null, budgetMode: 'explicitly_unlimited', excludes: ['task_dispatch', 'publishing', 'upstream_writes'] }, metricPolicy: policy, cases: [], attempts: [] }
  await writeFile(ledgerPath, JSON.stringify(journal, null, 2), { flag: 'wx' })
}
assert.equal(journal.batchId, batchId)
let persistence = Promise.resolve()
const persist = () => {
  const pending = persistence.then(async () => {
  await atomic(ledgerPath, journal)
  await atomic(manifestPath, { schemaVersion: 1, batchId: journal.batchId, createdAt: journal.createdAt, metricPolicy: journal.metricPolicy, cases: journal.cases, attempts: journal.attempts.filter((a) => a.completedAt !== undefined).map((a) => Object.fromEntries(['caseId', 'attemptId', 'operationId', 'outcome', 'candidateRef', 'failureCode', 'startedAt', 'completedAt'].filter((key) => a[key] !== undefined).map((key) => [key, a[key]]))) })
  })
  persistence = pending
  return pending
}
let halted = false
// Drain mode resumes journaled requests only. It never cancels domain work,
// retries a failed attempt, or starts the rest of an obsolete bundle's batch.
let draining = process.env.PO_PLANNING_EVAL_DRAIN === '1'
process.on('SIGINT', () => { draining = true })
process.on('SIGTERM', () => { draining = true })
const assertQuality = (entry) => {
  assert.equal(entry.outcome, 'candidate', 'A technical failure was retained; diagnose before spending on more requests.')
  const mismatches = Object.entries(entry.grade.metricSamples).filter(([key, value]) => {
    const limit = journal.metricPolicy.thresholds[key]
    return limit && value.applicability === 'applicable' && (limit.min !== undefined ? value.value < limit.min : value.value > limit.max)
  }).map(([key]) => key)
  assert.deepEqual(mismatches, [], 'Observed quality failure retained. Do not alter Gold or weaken thresholds.')
}
const collectCase = async (caseId, selectedRun) => {
  const template = projects.projects.find((p) => p.caseId === caseId && p.expectedReadiness === readiness)
  const project = selectedRun === undefined ? template : { ...template, projectId: selectedRun > 5 ? template.projectId : template.projectIdsByRun[`fresh-${selectedRun}`] }
  assert.ok(project, `Case outside selected ${readiness} scope: ${caseId}`)
  const gold = validatePlanningGold(JSON.parse(await readFile(resolve(root, 'cases', caseId, 'gold.json'), 'utf8')), caseId)
  const existing = journal.cases.find((c) => c.caseId === caseId)
  if (existing) assert.equal(existing.goldDigest, planningGoldDigest(gold), 'Never replace frozen Gold within a batch.')
  else { journal.cases.push({ caseId, goldDigest: planningGoldDigest(gold) }); await persist() }
  for (const index of selectedRun === undefined ? runIndices : [selectedRun]) {
    const attemptId = `${caseId}/fresh-${index}`
    let entry = journal.attempts.findLast((a) => a.caseId === caseId && a.runId === `fresh-${index}`)
    if (entry?.completedAt !== undefined) {
      // Recovery must refer to the same operation; a later successful model
      // request must never erase a previous quality or infrastructure failure.
      const resolved = entry.outcome === 'candidate' ? entry : journal.attempts.find((a) => a.operationId === entry.operationId && a.outcome === 'candidate' && a.completedAt)
      assert.ok(resolved, 'Unresolved failed attempt retained; diagnose before resuming.')
      assertQuality(resolved)
      continue
    }
    if ((halted || draining) && entry === undefined) return
    const recoveredLocalPreflight = entry?.state === 'reserved_before_request' && entry.requestDispatchedAt === undefined && entry.retryOfAttemptId !== undefined && journal.attempts.some((a) => a.attemptId === entry.retryOfAttemptId && a.failureCode === 'collector-project-restoration-race' && a.requestDispatched === false && a.operationId === undefined)
    if (!entry || recoveredLocalPreflight) {
      if (!entry) {
      if (readiness === 'blocked' && index > 5) {
        // The read-only preview has the same active-Project guard as dispatch.
        // A terminal operation alone does not prove restoration has finished.
        const preview = await planningInputPreview(project.projectId)
        assert.deepEqual(preview.releaseInput, gold.releaseInput, 'Supplemental reuse must preserve the independently frozen input exactly.')
      }
      const previous = await request(`/projects/${project.projectId}/planning-operations`)
      assert.ok(previous.every((o) => o.status !== 'running'), 'Do not overlap Planning operations in one project.')
      entry = { caseId, attemptId, projectId: project.projectId, runId: `fresh-${index}`, state: 'reserved_before_request', startedAt: new Date().toISOString(), previousOperationIds: previous.map((o) => o.id) }
      journal.attempts.push(entry)
      await persist()
      }
      try {
        // A terminal operation can be visible before its owning Project has
        // finished restoration. Wait for that authoritative Project boundary.
        const live = await waitForProjectRestoration(project.projectId)
        const dispatch = async (path, body) => {
          entry.requestDispatchedAt = new Date().toISOString()
          entry.requestPath = path
          await persist()
          return request(path, body)
        }
        if (live.status === 'draft') await dispatch(`/projects/${project.projectId}/decompose`, {})
        else {
          // Recompute all model stages from the unchanged initial source through
          // the normal revision API. No predecessor/repair continuation is used.
          const snapshots = await request(`/projects/${project.projectId}/plan-snapshots`)
          const plan = snapshots.find((p) => p.id === live.currentPlanSnapshotId)
          const matrix = await request(`/projects/${project.projectId}/requirements?includeHistory=true`)
          const bundle = matrix.bundles.find((b) => b.id === plan?.requirementBundleIds?.[0])
          assert.ok(bundle)
          await dispatch(`/projects/${project.projectId}/decompositions/${encodeURIComponent(bundle.id)}/revise`, { title: live.name, prd: live.prd, technicalDesign: live.technicalDesign, taskLanguage: live.taskLanguage, sourceRefs: [], sourceBlocks: [...(live.prdSourceBlocks ?? []), ...(live.technicalDesignSourceBlocks ?? [])], expectedBundleUpdatedAt: bundle.updatedAt, idempotencyKey: `${journal.batchId}:${entry.attemptId}` })
        }
        entry.state = 'request_accepted'
      } catch (error) {
        entry.state = 'request_outcome_requires_observation'
        entry.requestErrorCode = error.code ?? error.name
        entry.requestErrorMessage = error.message
        await persist()
      }
    }
    const deadline = Date.now() + 30 * 60_000
    let operation
    while (Date.now() < deadline) {
      const operations = await request(`/projects/${project.projectId}/planning-operations`)
      const newOperations = operations.filter((o) => !entry.previousOperationIds.includes(o.id))
      const roots = newOperations.filter(o => o.predecessorOperationId === undefined)
      assert.ok(roots.length <= 1 && newOperations.length <= 2 && newOperations.every(o => o.predecessorOperationId === undefined || (o.predecessorOperationId === roots[0]?.id && roots[0].status === 'superseded' && roots[0].stage === 'policy_snapshot')), 'Unexpected extra operations; preserve journal and investigate.')
      operation = roots[0]
      if (operation) {
        assert.equal(operation.predecessorOperationId, undefined, 'A continued operation is not fresh.')
        if (entry.requestErrorCode !== undefined && entry.requestObservationRecovery === undefined) {
          entry.requestObservationRecovery = { requestErrorCode: entry.requestErrorCode, requestErrorMessage: entry.requestErrorMessage, observedAt: new Date().toISOString(), operationId: operation.id, requestResent: false }
        }
        entry.operationId = operation.id
        entry.state = operation.status
        await persist()
        if (operation.status !== 'running') break
      } else if (entry.requestErrorCode && entry.requestDispatchedAt === undefined) {
        throw new Error(`No operation is observable after ${entry.requestErrorCode}. Resolve this reserved attempt before another request.`)
      }
      // A timed-out POST can still register its operation after the first GET.
      // Observe the journaled request until the bounded deadline; never resend.
      await new Promise((done) => setTimeout(done, 5_000))
    }
    if (!operation || operation.status === 'running') throw new Error('Observation timed out; pending attempt retained. No automatic retry or cancellation.')
    delete entry.requestErrorCode
    entry.completedAt = operation.completedAt ?? new Date().toISOString()
    if (['committed', 'blocked'].includes(operation.status)) {
      try {
        const candidate = validatePlanningCandidate(await request(`/projects/${project.projectId}/planning-operations/${encodeURIComponent(operation.id)}/evaluation-export?caseId=${encodeURIComponent(caseId)}&runId=${encodeURIComponent(entry.runId)}`), caseId, entry.runId)
        assert.deepEqual(planningReleaseProvenanceFailures(gold, candidate), [])
        const path = resolve(root, 'cases', caseId, 'runs', `${entry.runId}.json`)
        await mkdir(dirname(path), { recursive: true })
        await writeFile(path, JSON.stringify(candidate, null, 2), { flag: 'wx' })
        entry.outcome = 'candidate'
        entry.candidateRef = relative(root, path)
        entry.grade = gradePlanningRun(gold, candidate)
      } catch (error) {
        entry.outcome = 'infrastructure_failure'
        entry.failureCode = error.code ?? 'candidate-export-or-provenance-invalid'
        entry.exportError = error.message
      }
    } else if (operation.status === 'superseded') {
      entry.outcome = 'infrastructure_failure'
      entry.failureCode = 'planning-policy-superseded'
      // An automatic policy successor is observable history, never a fresh
      // replacement candidate for the superseded request.
    } else {
      entry.outcome = operation.status === 'cancelled' ? 'cancelled' : 'model_failure'
      entry.failureCode = operation.diagnostics.find((d) => ['error', 'blocking'].includes(d.severity))?.code ?? `planning-${operation.status}`
    }
    await persist()
    console.log(JSON.stringify({ caseId, attemptId: entry.attemptId, operationId: operation.id, operationStatus: operation.status, outcome: entry.outcome, status: entry.grade?.metrics, failureCode: entry.failureCode }))
    assertQuality(entry)
  }
}
const pendingCases = selected.flatMap((caseId) => {
  const project = projects.projects.find((p) => p.caseId === caseId)
  if (project?.projectIdsByRun === undefined) return [{ caseId }]
  assert.deepEqual(Object.keys(project.projectIdsByRun).sort(), ['fresh-1', 'fresh-2', 'fresh-3', 'fresh-4', 'fresh-5'])
  assert.equal(new Set(Object.values(project.projectIdsByRun)).size, 5)
  return runIndices.map((selectedRun) => ({ caseId, selectedRun }))
})
const results = await Promise.allSettled(Array.from({ length: Math.min(concurrency, pendingCases.length) }, async () => {
  while (pendingCases.length > 0 && !halted) {
    const { caseId, selectedRun } = pendingCases.shift()
    try { await collectCase(caseId, selectedRun) } catch (error) { halted = true; throw error }
  }
}))
for (const result of results) if (result.status === 'rejected') { console.error(result.reason); process.exitCode = 1 }
console.log(JSON.stringify({ batchId: journal.batchId, completedAttempts: journal.attempts.filter((a) => a.completedAt).length, manifestPath }))
