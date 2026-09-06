import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { WorkspaceWriter } from '../lib/index.js'

test('authoritative OS lock is exclusive and a released handle is fenced', async () => {
  const lockDirectory = await mkdtemp(join(tmpdir(), 'po-os-writer-'))
  const options = { workspaceIdentity: 'two-process-fixture', lockDirectory }
  const first = new WorkspaceWriter(options)
  const second = new WorkspaceWriter(options)
  try {
    await first.acquire()
    first.activate(11)
    first.assertWriter(11)
    await assert.rejects(() => second.acquire(), (error) => error.code === 'workspace-writer-active' && error.status === 409)
    await first.release()
    assert.throws(() => first.assertWriter(11), (error) => error.code === 'workspace-writer-fenced')

    await second.acquire()
    second.activate(12)
    second.assertWriter(12)
    assert.throws(() => second.assertWriter(11), (error) => error.code === 'workspace-writer-fenced')
  } finally {
    await Promise.allSettled([first.release(), second.release()])
    await rm(lockDirectory, { recursive: true, force: true })
  }
})
