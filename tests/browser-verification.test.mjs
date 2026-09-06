import assert from 'node:assert/strict'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { BrowserVerificationProvider } from '../lib/index.js'

async function fixture(withRunner = true) {
  const root = await mkdtemp(join(tmpdir(), 'browser-provider-'))
  await writeFile(join(root, 'package.json'), JSON.stringify({ devDependencies: withRunner ? { '@playwright/test': '1.63.0' } : {} }))
  return root
}

test('BrowserVerificationProvider preserves real pass, failure, timeout, and unavailable semantics', async () => {
  const provider = new BrowserVerificationProvider()
  const roots = []
  try {
    const ready = await fixture(); roots.push(ready)
    await mkdir(join(ready, 'test-results'), { recursive: true })
    await writeFile(join(ready, 'test-results', 'trace.zip'), 'trace')
    const passed = await provider.verify({ cwd: ready, command: [process.execPath, '-e', "console.log('browser test passed')"], scenarioKeys: ['SCN-UI'], artifactDirectory: 'test-results' })
    assert.equal(passed.status, 'passed')
    assert.equal(passed.artifacts[0].path, 'test-results/trace.zip')
    const failed = await provider.verify({ cwd: ready, command: [process.execPath, '-e', "console.error('browser failed'); process.exit(2)"], scenarioKeys: ['SCN-UI'] })
    assert.equal(failed.status, 'failed')
    assert.equal(failed.errorCode, 'verification_failed')
    assert.equal(failed.exitCode, 2)
    const timedOut = await provider.verify({ cwd: ready, command: [process.execPath, '-e', 'setTimeout(() => {}, 5000)', 'browser-test'], scenarioKeys: ['SCN-UI'], timeoutMs: 1_000 })
    assert.equal(timedOut.status, 'failed')
    assert.equal(timedOut.timedOut, true)
    const missing = await fixture(false); roots.push(missing)
    const unavailable = await provider.verify({ cwd: missing, command: ['playwright', 'test'], scenarioKeys: ['SCN-UI'] })
    assert.equal(unavailable.status, 'unavailable')
    assert.equal(unavailable.errorCode, 'verification_unavailable')
  } finally {
    await Promise.all(roots.map((root) => rm(root, { recursive: true, force: true })))
  }
})
