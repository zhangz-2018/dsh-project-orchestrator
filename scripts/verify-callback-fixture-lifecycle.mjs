import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { build } from 'esbuild'

// Exercise only frozen, unmodified Hono callback fixtures. Bundle in memory;
// never write to the repository or change the retained planning verdict.
const destination = process.argv[2]
assert.ok(destination)
const repository = resolve('output/acceptance/repositories/hono')
const git = args => execFileSync('git', args, { cwd: repository, encoding: 'utf8' })
const commit = git(['rev-parse', 'HEAD']).trim()
assert.equal(commit, '588ec13fa68ea44fed1b5e1b503341db2bf09d70')
const beforeStatus = git(['status', '--porcelain'])
const paths = ['src/hono.ts', 'src/hono-base.ts', 'src/context.ts', 'src/compose.ts', 'src/middleware/cors/index.ts']
const hash = value => createHash('sha256').update(value).digest('hex')
const sourceDigests = Object.fromEntries(await Promise.all(paths.map(async path => [path, hash(await readFile(resolve(repository, path)))])))
const bundled = await build({ stdin: { contents: 'export { Hono } from "./src/hono.ts"; export { cors } from "./src/middleware/cors/index.ts";', resolveDir: repository, loader: 'ts' }, bundle: true, write: false, format: 'esm', platform: 'node', logLevel: 'silent' })
const { Hono, cors } = await import(`data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].contents).toString('base64')}`)
const createFixture = mode => {
  const sentinel = new Error(`origin-${mode}`)
  const seen = []
  const app = new Hono()
  app.use('/api/*', cors({ origin: () => {
    if (mode === 'sync') throw sentinel
    return Promise.reject(sentinel)
  } }))
  app.onError((error, context) => { seen.push(error); return context.text('cors-origin-error', 500) })
  app.get('/api/abc', context => context.text('ok'))
  return { app, sentinel, seen }
}
const request = async (fixture, method) => {
  const response = await fixture.app.request('http://localhost/api/abc', { method, headers: { Origin: 'http://example.com' } })
  assert.equal(response.status, 500)
  assert.equal(await response.text(), 'cors-origin-error')
}
const observations = []
for (const mode of ['sync', 'async']) {
  const shared = createFixture(mode)
  for (const method of ['GET', 'OPTIONS']) await request(shared, method)
  assert.deepEqual(shared.seen, [shared.sentinel, shared.sentinel])
  const independent = []
  for (const method of ['GET', 'OPTIONS']) {
    const fixture = createFixture(mode)
    await request(fixture, method)
    assert.deepEqual(fixture.seen, [fixture.sentinel])
    independent.push({ method, count: fixture.seen.length, errorIdentityPreserved: true })
  }
  observations.push({ mode, sharedFinalCount: shared.seen.length, originalExactlyOnceOracleSatisfied: false, independent })
}
const originMatrix = []
const requestOrigin = 'http://example.com'
for (const mode of ['wildcard', 'matching-array', 'unmatched-array', 'sync-callback', 'async-callback']) {
  for (const method of ['GET', 'OPTIONS']) for (const maxAge of [undefined, 0, 600]) {
    const origin = mode === 'wildcard' ? '*' : mode === 'matching-array' ? [requestOrigin] : mode === 'unmatched-array' ? ['http://other.example'] : mode === 'sync-callback' ? value => value : async value => value
    const app = new Hono()
    app.use('/api/*', cors({ origin, credentials: true, allowHeaders: ['X-Custom-Header'], ...(maxAge === undefined ? {} : { maxAge }) }))
    app.get('/api/abc', context => context.text('ok'))
    const response = await app.request('http://localhost/api/abc', { method, headers: { Origin: requestOrigin, 'Access-Control-Request-Headers': 'X-Custom-Header' } })
    const actualOrigin = response.headers.get('Access-Control-Allow-Origin')
    const expectedOrigin = mode === 'wildcard' ? '*' : mode === 'unmatched-array' ? null : requestOrigin
    assert.equal(actualOrigin, expectedOrigin)
    assert.equal(response.status, method === 'GET' ? 200 : 204)
    assert.equal(response.headers.get('Access-Control-Max-Age'), method === 'OPTIONS' && maxAge !== undefined ? String(maxAge) : null)
    originMatrix.push({ mode, method, maxAge: maxAge ?? 'omitted', option: typeof origin === 'function' ? mode : origin, requestOrigin, expectedOrigin, actualOrigin })
  }
}
// The rejected fixture supplies matching values to a variant named unmatched.
const conflictingApp = new Hono()
conflictingApp.use('/api/*', cors({ origin: [requestOrigin] }))
conflictingApp.get('/api/abc', context => context.text('ok'))
const conflictingResponse = await conflictingApp.request('http://localhost/api/abc', { headers: { Origin: requestOrigin } })
assert.equal(conflictingResponse.headers.get('Access-Control-Allow-Origin'), requestOrigin)
const conflictingMembership = { option: [requestOrigin], requestOrigin, namedVariant: 'unmatched-array', declaredExpectedOrigin: null, actualOrigin: conflictingResponse.headers.get('Access-Control-Allow-Origin'), originalOracleSatisfied: false }
assert.equal(git(['status', '--porcelain']), beforeStatus)
for (const [path, digest] of Object.entries(sourceDigests)) assert.equal(hash(await readFile(resolve(repository, path))), digest)
const report = { status: 'frozen_callback_fixture_lifecycle_verified', observedAt: new Date().toISOString(), repository, commit, sourceDigests, observations, originMatrix, conflictingMembership, sourceUnchanged: true, requestCount: 8 + originMatrix.length + 1, modelRequests: 0, domainMutations: 0, releasePass: false }
await writeFile(destination, JSON.stringify(report, null, 2), { flag: 'wx' })
console.log(JSON.stringify(report))
