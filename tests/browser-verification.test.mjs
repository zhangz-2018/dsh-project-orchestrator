import assert from 'node:assert/strict'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { BrowserVerificationProvider } from '../lib/index.js'

const SPEC_DIGEST = 'a'.repeat(64)
const REPORT_NONCE = '0123456789abcdef0123456789abcdef'
const REQUIRED_TESTS = [{ scenarioKey: 'SCN-UI', testFile: 'tests/browser/project-detail.spec.ts', testKey: 'project-detail-persists', browserProject: 'chromium' }]

async function fixture(withRunner = true) {
  const root = await mkdtemp(join(tmpdir(), 'browser-provider-'))
  await writeFile(join(root, 'package.json'), JSON.stringify({ devDependencies: withRunner ? { '@playwright/test': '1.63.0' } : {} }))
  await writeFile(join(root, 'emit-browser-report.mjs'), `
import { writeFile } from 'node:fs/promises'
const variant = process.env.REPORT_VARIANT ?? 'passed'
if (variant === 'command-fail') process.exit(2)
if (variant === 'no-report') process.exit(0)
const now = new Date().toISOString()
const test = { testFile: 'tests/browser/project-detail.spec.ts', testKey: 'project-detail-persists', scenarioKey: 'SCN-UI', browserProject: 'chromium', status: 'passed', retry: 0 }
const report = {
  schemaVersion: 1,
  reporterId: 'dsh-playwright-json-v1',
  invocationId: process.env.DSH_VERIFICATION_INVOCATION_ID,
  nonce: process.env.DSH_VERIFICATION_REPORT_NONCE,
  specDigest: process.env.DSH_VERIFICATION_SPEC_DIGEST,
  taskRunId: process.env.DSH_VERIFICATION_TASK_RUN_ID,
  outcome: 'passed',
  startedAt: now,
  completedAt: now,
  total: 1,
  tests: [test],
}
if (variant === 'zero') { report.total = 0; report.tests = [] }
if (variant === 'duplicate') { report.total = 2; report.tests = [test, { ...test }] }
if (variant === 'missing-required') report.tests[0].testKey = 'some-other-test'
if (variant === 'mismatched-nonce') report.nonce = 'ffffffffffffffffffffffffffffffff'
if (variant === 'mismatched-task') report.taskRunId = 'another-task-run'
if (variant === 'skipped') report.tests[0].status = 'skipped'
if (variant === 'flaky') { report.tests[0].status = 'flaky'; report.tests[0].retry = 1 }
if (variant === 'stale') { report.startedAt = '2000-01-01T00:00:00.000Z'; report.completedAt = '2000-01-01T00:00:01.000Z' }
await writeFile(process.env.DSH_VERIFICATION_REPORT_PATH, JSON.stringify(report))
`)
  return root
}

function request(root, variant = 'passed') {
  return {
    cwd: root,
    command: [process.execPath, 'emit-browser-report.mjs', 'browser-test'],
    taskRunId: 'task-run-1',
    invocationId: 'verification-invocation-1',
    reportNonce: REPORT_NONCE,
    specDigest: SPEC_DIGEST,
    reportPath: join(root, 'managed-evidence', 'report.json'),
    requiredTests: REQUIRED_TESTS,
    artifactDirectory: 'test-results',
    environment: { REPORT_VARIANT: variant },
  }
}

test('BrowserVerificationProvider accepts only a current structured report that closes every required mapping', async () => {
  const provider = new BrowserVerificationProvider()
  const root = await fixture()
  try {
    await mkdir(join(root, 'test-results'), { recursive: true })
    await writeFile(join(root, 'test-results', 'trace.zip'), 'trace')
    const result = await provider.verify(request(root))

    assert.equal(result.status, 'passed')
    assert.equal(result.failureCode, undefined)
    assert.equal(result.report?.taskRunId, 'task-run-1')
    assert.equal(result.scenarioResults[0].testKey, 'project-detail-persists')
    assert.equal(result.scenarioKeys[0], 'SCN-UI')
    assert.match(result.reportDigest, /^[0-9a-f]{64}$/)
    assert.equal(result.artifacts[0].path, 'test-results/trace.zip')
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('BrowserVerificationProvider rejects exit-zero text without a structured report', async () => {
  const provider = new BrowserVerificationProvider()
  const root = await fixture()
  try {
    const result = await provider.verify({
      ...request(root),
      command: [process.execPath, '-e', "console.log('browser test passed')"],
    })
    assert.equal(result.status, 'failed')
    assert.equal(result.failureCode, 'report_missing')
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('BrowserVerificationProvider fails closed for malformed, stale, incomplete, skipped, flaky, and duplicated reports', async () => {
  const provider = new BrowserVerificationProvider()
  const root = await fixture()
  try {
    const cases = [
      ['zero', 'zero_tests'],
      ['duplicate', 'duplicate_test_identity'],
      ['missing-required', 'required_test_missing'],
      ['mismatched-nonce', 'report_mismatch'],
      ['mismatched-task', 'report_mismatch'],
      ['skipped', 'test_not_passed'],
      ['flaky', 'test_not_passed'],
      ['stale', 'report_stale'],
    ]
    for (const [variant, failureCode] of cases) {
      const result = await provider.verify(request(root, variant))
      assert.equal(result.status, 'failed', variant)
      assert.equal(result.failureCode, failureCode, variant)
    }
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('BrowserVerificationProvider preserves command failure, timeout, cancellation, and unavailable semantics', async () => {
  const provider = new BrowserVerificationProvider()
  const roots = []
  try {
    const ready = await fixture(); roots.push(ready)
    const failed = await provider.verify(request(ready, 'command-fail'))
    assert.equal(failed.status, 'failed')
    assert.equal(failed.failureCode, 'command_failed')
    assert.equal(failed.exitCode, 2)

    const timedOut = await provider.verify({ ...request(ready), command: [process.execPath, '-e', 'setTimeout(() => {}, 5000)', 'browser-test'], timeoutMs: 1_000 })
    assert.equal(timedOut.status, 'failed')
    assert.equal(timedOut.failureCode, 'command_failed')
    assert.equal(timedOut.timedOut, true)

    const controller = new AbortController()
    controller.abort()
    const cancelled = await provider.verify({ ...request(ready), signal: controller.signal })
    assert.equal(cancelled.status, 'failed')
    assert.equal(cancelled.failureCode, 'command_cancelled')

    const missing = await fixture(false); roots.push(missing)
    const unavailable = await provider.verify({ ...request(missing), command: ['playwright', 'test'] })
    assert.equal(unavailable.status, 'unavailable')
    assert.equal(unavailable.errorCode, 'verification_unavailable')
  } finally {
    await Promise.all(roots.map((root) => rm(root, { recursive: true, force: true })))
  }
})
