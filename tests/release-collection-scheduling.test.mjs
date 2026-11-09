import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { EventEmitter } from 'node:events'
import { readFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { test } from 'node:test'

const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor
const script = async name => (await readFile(new URL(`../scripts/${name}`, import.meta.url), 'utf8')).replace(/^import .*\n/gmu, '')
const absent = () => Object.assign(new Error('not found'), { code: 'ENOENT' })

test('policy observation waits through registration gap and running successor', async () => {
  const root = { id: 'root', projectId: 'project', status: 'superseded', stage: 'policy_snapshot', diagnostics: [{ code: 'repository-policy-delta' }] }
  const successor = { id: 'successor', projectId: 'project', predecessorOperationId: 'root', status: 'running', stage: 'source_profile', diagnostics: [] }
  const operationSets = [[root], [root, successor], [root, { ...successor, status: 'committed', completedAt: 'done' }]]
  const writes = []
  let fetches = 0
  const stop = new Error('exit')
  const evaluate = new AsyncFunction('assert', 'readFile', 'writeFile', 'digestObject', 'fetch', 'process', 'setTimeout', 'console', await script('observe-release-policy-successors.mjs'))
  await assert.rejects(evaluate(assert, async () => JSON.stringify({ batchId: 'batch', attempts: [{ failureCode: 'planning-policy-superseded', operationId: 'root', projectId: 'project' }] }), async (...args) => writes.push(args), () => 'digest', async () => ({ ok: true, json: async () => ({ planningOperations: operationSets[fetches++], approvals: [], taskRuns: [], executionDispatches: [], planApprovalsV3: [], deliveryRecords: [] }) }), { argv: ['node', 'script', 'ledger', 'destination'], exit: code => { assert.equal(code, 0); throw stop } }, done => done(), { log() {} }), error => error === stop)
  assert.equal(fetches, 3)
  assert.equal(writes.length, 1)
  const report = JSON.parse(writes[0][1])
  assert.equal(report.facts[0].status, 'committed')
  assert.equal(report.facts[0].countsAsFresh, false)
})

for (const initialPerCase of [0, 4]) test(`completion owner from ${initialPerCase} candidates retains policy failures, reserves successor slots and adds unique roots`, async () => {
  const files = new Map()
  const projectsPath = resolve('projects.json')
  const destination = resolve('completion-test')
  const seedPaths = initialPerCase === 0 ? [] : [resolve('seed-one.json'), resolve('seed-two.json')]
  const projects = Array.from({ length: 25 }, (_, i) => ({ caseId: `case-${i}`, projectId: `project-${i}`, expectedReadiness: i % 2 ? 'blocked' : 'ready' }))
  const seeds = projects.flatMap(p => Array.from({ length: initialPerCase }, (_, i) => i + 1).map(i => ({ caseId: p.caseId, attemptId: `${p.caseId}/fresh-${i}`, runId: `fresh-${i}`, outcome: 'candidate', completedAt: 'done', grade: { metricSamples: {} } })))
  files.set(projectsPath, JSON.stringify({ baseUrl: 'http://localhost', projects }))
  for (const [i, path] of seedPaths.entries()) files.set(path, JSON.stringify({ attempts: i ? [] : seeds, metricPolicy: { thresholds: {} } }))
  const read = async path => { if (!files.has(path)) throw absent(); return files.get(path) }
  const writes = async (path, value) => { files.set(path, value) }
  let sequence = 0
  let active = 0
  let maximum = 0
  let policyObserved = false
  let policyCount = 0
  const identities = new Set()
  const dispatchedCases = []
  const spawn = (_node, args, options) => {
    const child = new EventEmitter()
    child.kill = () => {}
    if (args[0].endsWith('collect-release-planning.mjs')) {
      assert.match(options.env.PO_PLANNING_EVAL_BATCH_ID, /^release-compiler-config-v24-completion-\d+-2026-10-16$/u)
      const [, caseId, readiness, , , index] = args
      dispatchedCases.push(caseId)
      assert.ok(!identities.has(`${caseId}/${index}`))
      identities.add(`${caseId}/${index}`)
      if (caseId === 'case-0' && index !== String(initialPerCase + 1)) assert.ok(policyObserved, 'Replacement root started before successor terminal.')
      active++
      maximum = Math.max(maximum, active)
      assert.ok(active <= 4)
      const replaced = caseId === 'case-0' && index === String(initialPerCase + 1)
      if (replaced) policyCount++
      const attempt = { caseId, attemptId: `${caseId}/fresh-${index}`, runId: `fresh-${index}`, operationId: `op-${caseId}-${index}`, completedAt: 'done', outcome: replaced ? 'infrastructure_failure' : 'candidate', ...(replaced ? { failureCode: 'planning-policy-superseded' } : { grade: { metricSamples: {} } }) }
      files.set(options.env.PO_PLANNING_EVAL_LEDGER_PATH, JSON.stringify({ attempts: [attempt], metricPolicy: { thresholds: {} } }))
      setImmediate(() => { if (!replaced) active--; child.emit('exit', replaced ? 1 : 0) })
    } else {
      assert.ok(args[0].endsWith('observe-release-policy-successors.mjs'))
      setTimeout(() => {
        active--
        policyObserved = true
        files.set(args[2], JSON.stringify({ facts: [{ countsAsFresh: false, completedAt: 'done', status: 'committed' }] }))
        child.emit('exit', 0)
      }, 20)
    }
    return child
  }
  const fakeProcess = { argv: ['node', 'script', projectsPath, destination, ...seedPaths], pid: 1, env: { PO_PLANNING_EVAL_COMPLETION_TAG: 'compiler-config-v24', PO_PLANNING_EVAL_PRIORITY_CASES: 'case-24,case-0' }, execPath: 'node', on() {} }
  const evaluate = new AsyncFunction('assert', 'spawn', 'createHash', 'randomUUID', 'mkdir', 'open', 'readFile', 'rename', 'unlink', 'writeFile', 'join', 'resolve', 'process', 'fetch', 'console', 'setTimeout', await script('complete-release-planning.mjs'))
  await evaluate(assert, spawn, createHash, () => String(++sequence), async () => {}, async () => ({ writeFile: async () => {}, close: async () => {} }), read, async (from, to) => { files.set(to, files.get(from)); files.delete(from) }, async path => files.delete(path), writes, join, resolve, fakeProcess, async () => ({ ok: true, json: async () => ({ planningOperations: [] }) }), { log() {}, error() {} }, setTimeout)
  const state = JSON.parse(files.get(join(destination, 'state.json')))
  assert.equal(state.status, 'collection_complete_pending_gate')
  assert.deepEqual(dispatchedCases.slice(0, 2), ['case-24', 'case-0'])
  assert.equal(state.jobs.length, 25 * (5 - initialPerCase) + 1)
  assert.equal(state.jobs.filter(j => j.outcome === 'candidate').length, 25 * (5 - initialPerCase))
  assert.equal(state.jobs.filter(j => j.outcome === 'infrastructure_failure').length, 1)
  assert.equal(policyCount, 1)
  assert.equal(maximum, 4)
  assert.equal(active, 0)
  assert.equal(fakeProcess.exitCode, undefined)
})

test('supplemental collector waits for Project restoration and registry cleanup before preview', async () => {
  const files = new Map()
  const caseId = 'pending-case'
  const projectId = 'project'
  const input = { frozen: 'unchanged' }
  const gold = { releaseInput: input }
  const projectPath = resolve('projects-test.json')
  files.set(projectPath, JSON.stringify({ baseUrl: 'http://localhost', projects: [{ caseId, projectId, expectedReadiness: 'blocked' }] }))
  files.set(resolve('planning-evals', 'cases', caseId, 'gold.json'), JSON.stringify(gold))
  let snapshots = 0
  let previews = 0
  let dispatches = 0
  let sequence = 0
  const fakeProcess = { argv: ['node', 'script', caseId, 'blocked', '1', projectPath, '6'], env: {}, on() {} }
  const fetch = async (url, options) => {
    const path = new URL(url).pathname
    let value
    if (path.endsWith('/snapshot')) {
      snapshots++
      value = { projects: [{ id: projectId, status: snapshots === 1 ? 'decomposing' : 'draft', ...(snapshots === 1 ? { activePlanningOperationId: 'previous-terminal' } : {}) }] }
    } else if (path.endsWith('/planning-evaluation-input')) {
      assert.ok(snapshots >= 2, 'Preview must not run in the terminal-operation/restoration gap.')
      previews++
      if (previews === 1) return { ok: false, status: 409, json: async () => ({ error: { code: 'project-active' } }) }
      value = { releaseInput: input }
    } else if (path.endsWith('/planning-operations')) {
      value = dispatches ? [{ id: 'root', projectId, status: 'blocked', completedAt: 'done', diagnostics: [] }] : []
    } else if (path.endsWith('/decompose')) {
      assert.equal(options.method, 'POST')
      assert.equal(previews, 2)
      dispatches++
      value = {}
    } else if (path.endsWith('/evaluation-export')) value = {}
    else assert.fail(`Unexpected endpoint: ${path}`)
    return { ok: true, json: async () => value }
  }
  const grade = () => ({ metricSamples: {}, metrics: {} })
  const evaluate = new AsyncFunction('assert', 'randomUUID', 'mkdir', 'open', 'readFile', 'rename', 'writeFile', 'dirname', 'relative', 'resolve', 'planningGoldDigest', 'planningMetricPolicyDigest', 'planningReleaseProvenanceFailures', 'validatePlanningCandidate', 'validatePlanningGold', 'gradePlanningRun', 'READINESS_THRESHOLDS', 'RELEASE_THRESHOLDS', 'process', 'fetch', 'setTimeout', 'console', await script('collect-release-planning.mjs'))
  const { dirname, relative } = await import('node:path')
  await evaluate(assert, () => String(++sequence), async () => {}, async path => ({ writeFile: async value => files.set(path, value), sync: async () => {}, close: async () => {} }), async path => { if (!files.has(path)) throw absent(); return files.get(path) }, async (from, to) => { files.set(to, files.get(from)); files.delete(from) }, async (path, value) => files.set(path, value), dirname, relative, resolve, () => 'gold-digest', () => 'policy-digest', () => [], value => value, value => value, grade, {}, {}, fakeProcess, fetch, done => done(), { log() {}, error() {} })
  assert.equal(fakeProcess.exitCode, undefined)
  assert.equal(previews, 2)
  assert.equal(dispatches, 1)
  const ledger = JSON.parse(files.get(resolve('output/acceptance/release-collection-journal-2026-10-16.json')))
  assert.equal(ledger.attempts.length, 1)
  assert.equal(ledger.attempts[0].outcome, 'candidate')
  assert.equal(ledger.attempts[0].runId, 'fresh-6')
})

for (const resumed of [false, true]) test(`collector observes delayed acceptance after POST timeout without resending (resume=${resumed})`, async () => {
  const files = new Map()
  const caseId = 'delayed-case'
  const projectId = 'project'
  const projectPath = resolve('delayed-projects.json')
  const ledgerPath = resolve('delayed-ledger.json')
  const manifestPath = resolve('delayed-manifest.json')
  files.set(projectPath, JSON.stringify({ baseUrl: 'http://localhost', projects: [{ caseId, projectId, expectedReadiness: 'ready' }] }))
  files.set(resolve('planning-evals', 'cases', caseId, 'gold.json'), JSON.stringify({}))
  const pending = { caseId, projectId, attemptId: `${caseId}/fresh-1`, runId: 'fresh-1', state: 'request_outcome_requires_observation', previousOperationIds: [], startedAt: 'started', requestDispatchedAt: 'dispatched', requestErrorCode: 23, requestErrorMessage: 'POST response timed out' }
  if (resumed) files.set(ledgerPath, JSON.stringify({ batchId: 'delayed-batch', cases: [{ caseId, goldDigest: 'gold-digest' }], metricPolicy: { thresholds: {} }, attempts: [pending] }))
  let dispatches = 0
  let observations = 0
  let sequence = 0
  const fetch = async (url, options) => {
    const path = new URL(url).pathname
    let value
    if (path.endsWith('/snapshot')) value = { projects: [{ id: projectId, status: 'draft' }] }
    else if (path.endsWith('/decompose')) {
      assert.equal(options.method, 'POST')
      dispatches++
      throw Object.assign(new Error('POST response timed out'), { code: 23 })
    } else if (path.endsWith('/planning-operations')) {
      if (!resumed && dispatches === 0) value = []
      else {
        observations++
        value = observations === 1 ? [] : [{ id: 'delayed-root', projectId, status: observations === 2 ? 'running' : 'blocked', ...(observations >= 3 ? { completedAt: 'done' } : {}), diagnostics: [] }]
      }
    } else if (path.endsWith('/evaluation-export')) value = {}
    else assert.fail(`Unexpected endpoint: ${path}`)
    return { ok: true, json: async () => value }
  }
  const fakeProcess = { argv: ['node', 'script', caseId, 'ready', '1', projectPath, '1'], env: { PO_PLANNING_EVAL_BATCH_ID: 'delayed-batch', PO_PLANNING_EVAL_LEDGER_PATH: ledgerPath, PO_PLANNING_EVAL_MANIFEST_PATH: manifestPath }, on() {} }
  const evaluate = new AsyncFunction('assert', 'randomUUID', 'mkdir', 'open', 'readFile', 'rename', 'writeFile', 'dirname', 'relative', 'resolve', 'planningGoldDigest', 'planningMetricPolicyDigest', 'planningReleaseProvenanceFailures', 'validatePlanningCandidate', 'validatePlanningGold', 'gradePlanningRun', 'READINESS_THRESHOLDS', 'RELEASE_THRESHOLDS', 'process', 'fetch', 'setTimeout', 'console', await script('collect-release-planning.mjs'))
  const { dirname, relative } = await import('node:path')
  await evaluate(assert, () => String(++sequence), async () => {}, async path => ({ writeFile: async value => files.set(path, value), sync: async () => {}, close: async () => {} }), async path => { if (!files.has(path)) throw absent(); return files.get(path) }, async (from, to) => { files.set(to, files.get(from)); files.delete(from) }, async (path, value) => files.set(path, value), dirname, relative, resolve, () => 'gold-digest', () => 'policy-digest', () => [], value => value, value => value, () => ({ metricSamples: {}, metrics: {} }), {}, {}, fakeProcess, fetch, done => done(), { log() {}, error() {} })
  assert.equal(fakeProcess.exitCode, undefined)
  assert.equal(dispatches, resumed ? 0 : 1)
  assert.equal(observations, 3)
  const ledger = JSON.parse(files.get(ledgerPath))
  assert.equal(ledger.attempts.length, 1)
  assert.equal(ledger.attempts[0].operationId, 'delayed-root')
  assert.equal(ledger.attempts[0].outcome, 'candidate')
  assert.equal(ledger.attempts[0].requestObservationRecovery.requestErrorCode, 23)
  assert.equal(ledger.attempts[0].requestObservationRecovery.requestErrorMessage, 'POST response timed out')
})

test('empty-journal recovery requires exact unsent proof and never dispatches its reserved id', async () => {
  const source = await script('complete-release-planning.mjs')
  for (const mode of ['missing', 'wrong-digest', 'verified']) {
    const files = new Map()
    const projectsPath = resolve('recovery-projects.json')
    const directory = resolve(`recovery-${mode}`)
    const seeds = [resolve('recovery-seed-one.json'), resolve('recovery-seed-two.json')]
    const ledgerPath = join(directory, 'empty.json')
    const projects = Array.from({ length: 25 }, (_, i) => ({ caseId: `case-${i}`, projectId: `project-${i}`, expectedReadiness: 'blocked' }))
    const attempts = projects.flatMap(p => [1, 2, 3, 4, 5].map(i => ({ caseId: p.caseId, attemptId: `${p.caseId}/fresh-${i}`, runId: `fresh-${i}`, outcome: 'candidate', completedAt: 'done', grade: { metricSamples: {} } })))
    files.set(projectsPath, JSON.stringify({ baseUrl: 'http://localhost', projects }))
    for (const [i, path] of seeds.entries()) files.set(path, JSON.stringify({ attempts: i ? [] : attempts, metricPolicy: { thresholds: {} } }))
    const empty = JSON.stringify({ attempts: [], metricPolicy: { thresholds: {} } })
    files.set(ledgerPath, empty)
    files.set(join(directory, 'state.json'), JSON.stringify({ projectsPath, seedPaths: seeds, status: 'stopped_for_diagnosis', jobs: [{ ledgerPath, status: 'reserved', batchId: 'empty-batch', caseId: 'case-0', startedAt: '2026-10-16T09:03:00Z', runIndex: 6 }] }))
    if (mode !== 'missing') files.set(join(directory, 'empty-preflight-failure.json'), JSON.stringify({ status: 'preflight_failed_before_dispatch', batchId: 'empty-batch', projectId: 'project-0', modelRequests: 0, ledgerSha256: mode === 'verified' ? createHash('sha256').update(empty).digest('hex') : 'incorrect' }))
    let dispatches = 0
    let sequence = 0
    const evaluate = new AsyncFunction('assert', 'spawn', 'createHash', 'randomUUID', 'mkdir', 'open', 'readFile', 'rename', 'unlink', 'writeFile', 'join', 'resolve', 'process', 'fetch', 'console', 'setTimeout', source)
    const promise = evaluate(assert, () => { dispatches++; assert.fail('Recovery must not dispatch any root.') }, createHash, () => String(++sequence), async () => {}, async () => ({ writeFile: async () => {}, close: async () => {} }), async path => { if (!files.has(path)) throw absent(); return files.get(path) }, async (from, to) => { files.set(to, files.get(from)); files.delete(from) }, async path => files.delete(path), async (path, value) => files.set(path, value), join, resolve, { argv: ['node', 'script', projectsPath, directory, ...seeds], pid: 1, env: {}, on() {} }, async () => ({ ok: true, json: async () => ({ planningOperations: [{ projectId: 'project-0', createdAt: '2026-10-16T09:00:00Z', status: 'blocked' }] }) }), { log() {}, error() {} }, setTimeout)
    if (mode === 'verified') {
      await promise
      const state = JSON.parse(files.get(join(directory, 'state.json')))
      assert.equal(state.status, 'collection_complete_pending_gate')
      assert.equal(state.jobs[0].outcome, 'local_preflight_failure')
    } else await assert.rejects(promise)
    assert.equal(dispatches, 0)
  }
})
