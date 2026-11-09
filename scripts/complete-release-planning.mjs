import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import { mkdir, open, readFile, rename, unlink, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'

// One owner for the remaining batch. A slot includes policy replacement and
// successor registration, not merely the lifetime of the root HTTP request.
const [projectsPath, destination, ...seedPaths] = process.argv.slice(2)
assert.ok(projectsPath && destination)
const completionTag = process.env.PO_PLANNING_EVAL_COMPLETION_TAG ?? 'fixture-lifecycle-v23'
assert.match(completionTag, /^[a-z][a-z0-9-]+$/u)
const projects = JSON.parse(await readFile(projectsPath, 'utf8'))
assert.equal(projects.projects.length, 25)
const priorityCases = process.env.PO_PLANNING_EVAL_PRIORITY_CASES?.split(',') ?? []
assert.equal(new Set(priorityCases).size, priorityCases.length)
assert.ok(priorityCases.every(id => projects.projects.some(p => p.caseId === id)))
const directory = resolve(destination)
await mkdir(directory, { recursive: true })
const lockPath = join(directory, 'owner.lock')
const lock = await open(lockPath, 'wx', 0o600)
await lock.writeFile(JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() }))
await lock.close()
const statePath = join(directory, 'state.json')
const atomic = async (path, value) => {
  const temporary = `${path}.${randomUUID()}.tmp`
  await writeFile(temporary, JSON.stringify(value, null, 2), { flag: 'wx', mode: 0o600 })
  await rename(temporary, path)
}
let state
let draining = false
let failed = false
const children = new Set()
const drain = () => { draining = true; for (const child of children) child.kill('SIGTERM') }
process.on('SIGINT', drain)
process.on('SIGTERM', drain)
const pause = () => new Promise(done => setTimeout(done, 5000))
const snapshot = async () => {
  const response = await fetch(`${projects.baseUrl}/project-orchestrator/api/snapshot`, { signal: AbortSignal.timeout(30_000) })
  assert.ok(response.ok)
  return response.json()
}
const run = (args, env = {}, collector = false) => new Promise((done, reject) => {
  const child = spawn(process.execPath, args, { stdio: 'inherit', env: { ...process.env, ...env } })
  if (collector) children.add(child)
  child.on('error', reject)
  child.on('exit', code => { children.delete(child); done(code) })
})
const checkQuality = (ledger, attempt) => {
  assert.equal(attempt.outcome, 'candidate', 'Non-candidate must be diagnosed, never retried silently.')
  for (const [key, sample] of Object.entries(attempt.grade.metricSamples)) {
    const threshold = ledger.metricPolicy.thresholds[key]
    if (!threshold || sample.applicability !== 'applicable') continue
    assert.ok(threshold.min === undefined || sample.value >= threshold.min, `${attempt.attemptId}: ${key}`)
    assert.ok(threshold.max === undefined || sample.value <= threshold.max, `${attempt.attemptId}: ${key}`)
  }
}
let persistence = Promise.resolve()
const persist = () => { persistence = persistence.then(() => atomic(statePath, state)); return persistence }
const loadLedgers = async () => Promise.all([...seedPaths.map(path => resolve(path)), ...state.jobs.map(j => j.ledgerPath)].map(async path => ({ path, data: JSON.parse(await readFile(path, 'utf8')) })))
const observe = async job => {
  const bytes = await readFile(job.ledgerPath, 'utf8')
  const ledger = JSON.parse(bytes)
  if (ledger.attempts.length === 0) {
    // Explicit, independently captured recovery evidence is mandatory. Empty
    // journals alone must never authorize resending an uncertain request.
    const proofPath = `${job.ledgerPath.slice(0, -5)}-preflight-failure.json`
    const proof = JSON.parse(await readFile(proofPath, 'utf8'))
    assert.equal(proof.status, 'preflight_failed_before_dispatch')
    assert.equal(proof.batchId, job.batchId)
    assert.equal(proof.ledgerSha256, createHash('sha256').update(bytes).digest('hex'))
    assert.equal(proof.modelRequests, 0)
    const project = projects.projects.find(p => p.caseId === job.caseId)
    assert.equal(proof.projectId, project.projectId)
    assert.ok((await snapshot()).planningOperations.filter(o => o.projectId === project.projectId).every(o => o.createdAt < job.startedAt && o.status !== 'running'))
    job.status = 'observed'
    job.outcome = 'local_preflight_failure'
    job.observationPath = proofPath
    await persist()
    return
  }
  assert.ok(ledger.attempts.length === 1 && ledger.attempts[0].completedAt, 'Unclosed child attempt; preserve and stop.')
  const attempt = ledger.attempts[0]
  if (attempt.outcome === 'infrastructure_failure') {
    assert.equal(attempt.failureCode, 'planning-policy-superseded')
    // Keep this lane reserved even if a snapshot does not yet show a successor.
    const observationPath = `${job.ledgerPath.slice(0, -5)}-policy-successors.json`
    let proof
    try { proof = JSON.parse(await readFile(observationPath, 'utf8')) } catch (error) {
      if (error.code !== 'ENOENT') throw error
      assert.equal(await run(['scripts/observe-release-policy-successors.mjs', job.ledgerPath, observationPath]), 0)
      proof = JSON.parse(await readFile(observationPath, 'utf8'))
    }
    assert.equal(proof.facts.length, 1)
    assert.ok(proof.facts.every(f => f.countsAsFresh === false && f.completedAt && ['committed', 'blocked'].includes(f.status)))
    assert.ok(proof.facts.every(f => f.status === (job.readiness === 'ready' ? 'committed' : 'blocked')), 'Unexpected successor outcome; diagnose before further requests.')
    job.observationPath = observationPath
  } else checkQuality(ledger, attempt)
  job.status = 'observed'
  job.outcome = attempt.outcome
  job.operationId = attempt.operationId
  await persist()
}
try {
  try { state = JSON.parse(await readFile(statePath, 'utf8')) } catch (error) {
    if (error.code !== 'ENOENT') throw error
    state = { projectsPath: resolve(projectsPath), seedPaths: seedPaths.map(path => resolve(path)), createdAt: new Date().toISOString(), status: 'waiting_for_existing_work', concurrency: 4, minimumValidPerCase: 5, jobs: [] }
    await persist()
  }
  assert.equal(state.projectsPath, resolve(projectsPath))
  assert.deepEqual(state.seedPaths, seedPaths.map(path => resolve(path)))
  // Existing collectors are drained before invoking this owner. Wait for all
  // automatic successors too; superseded-without-successor is still occupied.
  const deadline = Date.now() + 45 * 60_000
  while (!draining) {
    const current = await snapshot()
    const ledgers = await loadLedgers()
    const unclosed = ledgers.flatMap(l => l.data.attempts).some(a => !a.completedAt)
    const unsettled = ledgers.flatMap(l => l.data.attempts).filter(a => a.failureCode === 'planning-policy-superseded').some(a => {
      const successors = current.planningOperations.filter(o => o.predecessorOperationId === a.operationId)
      assert.ok(successors.length <= 1)
      return successors.length === 0 || successors[0].status === 'running' || !successors[0].completedAt
    })
    if (!unclosed && !unsettled && current.planningOperations.every(o => o.status !== 'running')) break
    assert.ok(Date.now() < deadline, 'Existing work did not settle; no new requests issued.')
    await pause()
  }
  for (const job of state.jobs.filter(j => j.status !== 'observed')) {
    // Restart only observes already-journaled attempts. Missing accepted work
    // requires explicit diagnosis and is never resent by this owner.
    await observe(job)
  }
  const ledgers = await loadLedgers()
  const attempts = ledgers.flatMap(l => l.data.attempts)
  assert.equal(new Set(attempts.map(a => a.attemptId)).size, attempts.length)
  for (const ledger of ledgers) for (const attempt of ledger.data.attempts) {
    assert.ok(attempt.completedAt)
    if (attempt.outcome === 'candidate') checkQuality(ledger.data, attempt)
    else assert.equal(attempt.failureCode, 'planning-policy-superseded', 'Undiagnosed previous failure: stop.')
  }
  // A case leaves the queue while its request owns a lane. Requeue only after
  // observation, so every case is sampled before spending on more repetitions.
  const queue = projects.projects.map(project => ({ project, valid: attempts.filter(a => a.caseId === project.caseId && a.outcome === 'candidate').length,
    used: new Set([...attempts.filter(a => a.caseId === project.caseId).map(a => Number(a.runId.slice(6))), ...state.jobs.filter(j => j.caseId === project.caseId).map(j => j.runIndex)]) }))
  const priority = id => priorityCases.includes(id) ? priorityCases.indexOf(id) : priorityCases.length
  queue.sort((left, right) => priority(left.project.caseId) - priority(right.project.caseId))
  state.status = 'collecting'
  await persist()
  const results = await Promise.allSettled(Array.from({ length: 4 }, async () => {
    while (queue.length && !draining && !failed) {
      const item = queue.shift()
      if (item.valid < 5 && !draining && !failed) {
        let index = item.project.expectedReadiness === 'blocked' ? 6 : 1
        while (item.used.has(index)) index++
        item.used.add(index)
        const number = state.jobs.length + 1
        const batchId = `release-${completionTag}-completion-${number}-2026-10-16`
        const job = { number, caseId: item.project.caseId, readiness: item.project.expectedReadiness, runIndex: index, batchId,
          ledgerPath: join(directory, `${batchId}.json`), manifestPath: resolve('planning-evals', `${batchId}-manifest.json`), status: 'reserved', startedAt: new Date().toISOString() }
        state.jobs.push(job)
        await persist()
        job.exitCode = await run(['scripts/collect-release-planning.mjs', job.caseId, job.readiness, '1', projectsPath, String(index)], {
          PO_PLANNING_EVAL_BATCH_ID: batchId, PO_PLANNING_EVAL_LEDGER_PATH: job.ledgerPath, PO_PLANNING_EVAL_MANIFEST_PATH: job.manifestPath,
        }, true)
        await observe(job)
        if (job.outcome === 'candidate') item.valid++
        console.log(JSON.stringify({ caseId: job.caseId, valid: item.valid, required: 5, job: number, outcome: job.outcome }))
        if (item.valid < 5 && !draining && !failed) queue.push(item)
      }
    }
  }).map(promise => promise.catch(error => { failed = true; drain(); throw error })))
  for (const result of results) if (result.status === 'rejected') { console.error(result.reason); failed = true }
  state.status = failed ? 'stopped_for_diagnosis' : draining ? 'drained_incomplete' : 'collection_complete_pending_gate'
  state.updatedAt = new Date().toISOString()
  await persist()
  if (failed || draining) process.exitCode = 1
} finally {
  await persistence
  await unlink(lockPath)
}
