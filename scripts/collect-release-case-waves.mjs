import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'

// Continue untouched first attempts after diagnosed policy replacement, keeping
// the failed roots and their observed successors out of the candidate count.
const [projectsPath, selected, tag, destination] = process.argv.slice(2)
assert.ok(projectsPath && selected && tag && destination)
assert.match(tag, /^[a-z][a-z0-9-]+$/u)
const projects = JSON.parse(await readFile(projectsPath, 'utf8'))
let remaining = selected.split(',')
assert.equal(new Set(remaining).size, remaining.length)
assert.ok(remaining.every(id => projects.projects.some(p => p.caseId === id && p.expectedReadiness === 'ready')))
await mkdir(destination)
let draining = false
let activeCollector
const drain = () => { draining = true; activeCollector?.kill('SIGTERM') }
process.on('SIGINT', drain)
process.on('SIGTERM', drain)
const run = (args, env = {}) => new Promise((resolveRun, reject) => {
  const child = spawn(process.execPath, args, { stdio: 'inherit', env: { ...process.env, ...env } })
  if (args[0] === 'scripts/collect-release-planning.mjs') activeCollector = child
  child.on('error', reject)
  child.on('exit', code => { if (activeCollector === child) activeCollector = undefined; resolveRun(code) })
})
const waves = []
collection: while (remaining.length && !draining) {
  // This runner owns two slots; existing independent collectors and automatic
  // successors must leave room before another wave starts.
  const deadline = Date.now() + 30 * 60_000
  while (true) {
    if (draining) break collection
    const response = await fetch(`${projects.baseUrl}/project-orchestrator/api/snapshot`)
    assert.ok(response.ok)
    if ((await response.json()).planningOperations.filter(o => o.status === 'running').length <= 2) break
    assert.ok(Date.now() < deadline, 'Existing operations did not drain; no new requests dispatched.')
    await new Promise(done => setTimeout(done, 5000))
  }
  const suffix = `${tag}-wave-${waves.length + 1}`
  const ledgerPath = join(destination, `${suffix}.json`)
  const manifestPath = resolve('planning-evals', `${suffix}-manifest.json`)
  const exitCode = await run(['scripts/collect-release-planning.mjs', remaining.join(','), 'ready', '2', projectsPath, '1'], {
    PO_PLANNING_EVAL_BATCH_ID: suffix, PO_PLANNING_EVAL_LEDGER_PATH: ledgerPath, PO_PLANNING_EVAL_MANIFEST_PATH: manifestPath,
  })
  const journal = JSON.parse(await readFile(ledgerPath, 'utf8'))
  assert.ok(journal.attempts.length && journal.attempts.every(a => a.completedAt), 'Unclosed attempt: preserve and stop.')
  waves.push({ ledgerPath, manifestPath, exitCode })
  await writeFile(join(destination, `wave-${waves.length}-completed.json`), JSON.stringify({ waves, remaining }, null, 2), { flag: 'wx' })
  for (const a of journal.attempts) {
    if (a.outcome === 'infrastructure_failure') {
      assert.equal(a.failureCode, 'planning-policy-superseded', 'Unknown infrastructure failure: stop.')
      continue
    }
    assert.equal(a.outcome, 'candidate', 'Model failure: stop without retry.')
    for (const [key, sample] of Object.entries(a.grade.metricSamples)) {
      const threshold = journal.metricPolicy.thresholds[key]
      if (!threshold || sample.applicability !== 'applicable') continue
      assert.ok(threshold.min === undefined || sample.value >= threshold.min, `${a.attemptId}: ${key}`)
      assert.ok(threshold.max === undefined || sample.value <= threshold.max, `${a.attemptId}: ${key}`)
    }
  }
  if (journal.attempts.some(a => a.failureCode === 'planning-policy-superseded')) {
    const observationPath = join(destination, `${suffix}-policy-successors.json`)
    assert.equal(await run(['scripts/observe-release-policy-successors.mjs', ledgerPath, observationPath]), 0)
    const observation = JSON.parse(await readFile(observationPath, 'utf8'))
    assert.ok(observation.facts.every(f => f.status === 'committed' && f.countsAsFresh === false), 'A ready successor did not complete; diagnose before continuing.')
  } else assert.equal(exitCode, 0)
  const attempted = new Set(journal.attempts.map(a => a.caseId))
  remaining = remaining.filter(id => !attempted.has(id))
}
await writeFile(join(destination, 'summary.json'), JSON.stringify({ status: remaining.length ? 'drained_incomplete_not_release_pass' : 'all_selected_first_attempts_observed_not_release_pass', remaining, waves, modelRequestsByWrapper: 0, failedRootsRetained: true, successorsCountAsFresh: false }, null, 2), { flag: 'wx' })
if (waves.some(w => w.exitCode !== 0)) process.exitCode = 1
