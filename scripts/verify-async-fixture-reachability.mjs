import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { setImmediate as nextTurn } from 'node:timers/promises'
import { pathToFileURL } from 'node:url'

// Unchanged frozen scheduler only: no hook implementation or upstream writes.
const [destination] = process.argv.slice(2)
assert.ok(destination)
const snapshot = await (await fetch('http://127.0.0.1:3087/project-orchestrator/api/snapshot')).json()
const operationId = 'planning-v3:6e7a136a-7c5a-44b0-ae89-679b0086b1c0'
const operation = snapshot.planningOperations.find(o => o.id === operationId)
assert.equal(operation.status, 'blocked')
const review = snapshot.scenarioCoverageReviews.find(r => r.id === operation.scenarioCoverageReviewId)
assert.ok(review.findings.some(f => f.code === 'SCENARIO_UNREACHABLE_TIMING_FIXTURE'))
const project = snapshot.projects.find(p => p.id === operation.projectId)
const sourcePath = resolve(project.cwd, 'index.js')
const before = await readFile(sourcePath)
const git = args => execFileSync('git', args, { cwd: project.cwd })
const commit = operation.evaluationInput.repositoryBaseCommit
assert.equal(git(['rev-parse', 'HEAD']).toString().trim(), commit)
assert.deepEqual(before, git(['show', `${commit}:index.js`]))
const originalStatus = git(['status', '--porcelain'])
const { default: pMap } = await import(pathToFileURL(sourcePath).href)
const deferred = () => {
  let resolve
  const promise = new Promise(done => { resolve = done })
  return { promise, resolve }
}
const turn = async () => { await nextTurn(); await nextTurn() }
const fixture = (count, signal) => {
  const pulls = Array.from({ length: count }, deferred)
  const values = Array.from({ length: count }, deferred)
  const requested = [], started = []
  const iterable = { [Symbol.asyncIterator]() { return { next() {
    const index = requested.length
    requested.push(index)
    return pulls[index]?.promise ?? Promise.resolve({ done: true })
  }, return() { return Promise.resolve({ done: true }) } } } }
  let settled = false
  const result = pMap(iterable, (_, index) => { started.push(index); return values[index].promise }, { concurrency: 3, signal })
  result.then(() => { settled = true }, () => { settled = true })
  return { pulls, values, requested, started, result, settled: () => settled }
}
const abort = new AbortController()
const invalid = fixture(3, abort.signal)
invalid.pulls[0].resolve({ done: false, value: 0 })
invalid.pulls[2].resolve({ done: false, value: 2 })
await turn()
assert.deepEqual(invalid.requested, [0, 1])
assert.deepEqual(invalid.started, [0])
assert.equal(invalid.settled(), false)
const invalidObservation = { requestedPulls: [...invalid.requested], startedMappers: [...invalid.started],
  mapper2CanStartWithMapper0AndPull1Pending: false }
const reason = new Error('diagnostic cleanup')
abort.abort(reason)
await assert.rejects(invalid.result, error => error === reason)
invalid.pulls[1].resolve({ done: true })
invalid.values[0].resolve('A')
await turn()

// One completed lower mapper can initiate a higher pull while startup waits.
// Keep another lower mapper pending so done does not settle the whole call.
const valid = fixture(4)
valid.pulls[0].resolve({ done: false, value: 0 })
valid.pulls[1].resolve({ done: false, value: 1 })
await turn()
assert.deepEqual(valid.requested, [0, 1, 2])
assert.deepEqual(valid.started, [0, 1])
valid.values[1].resolve('B')
await turn()
assert.deepEqual(valid.requested, [0, 1, 2, 3])
valid.pulls[3].resolve({ done: false, value: 3 })
await turn()
assert.deepEqual(valid.started, [0, 1, 3])
valid.pulls[2].resolve({ done: true })
await turn()
assert.equal(valid.settled(), false)
valid.values[3].resolve('D')
await turn()
assert.equal(valid.settled(), false)
valid.values[0].resolve('A')
assert.deepEqual(await valid.result, ['A', 'B'])
assert.deepEqual(await readFile(sourcePath), before)
assert.deepEqual(git(['status', '--porcelain']), originalStatus)
const report = { observedAt: new Date().toISOString(), operationId, sourcePath,
  commit, retainedEvidenceDigest: review.repositoryEvidence.contents.find(e => e.path === 'index.js').digest,
  sourceSha256: createHash('sha256').update(before).digest('hex'), invalidObservation,
  reachableObservation: { requestedPulls: valid.requested, startedMappers: valid.started,
    doneIndex: 2, higherMapperIndex: 3, pendingLowerMapperIndex: 0, result: ['A', 'B'] },
  scope: 'unchanged_scheduler_reachability_only_not_future_hook_acceptance',
  sourceMutations: 0, modelRequests: 0, domainMutations: 0 }
await writeFile(destination, JSON.stringify(report, null, 2), { flag: 'wx' })
console.log(JSON.stringify(report))
