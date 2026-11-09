import { spawn } from 'node:child_process'
import { mkdtemp, mkdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const repositoryRoot = resolve(fileURLToPath(new URL('../..', import.meta.url)))

export async function createHostFixture({ taskRunSeedCount = 0, issueEvidenceSeedCount = 0 } = {}) {
  const root = await mkdtemp(join(tmpdir(), 'po-browser-host-'))
  const storageRoot = join(root, 'storage')
  const lockRoot = join(root, 'locks')
  const workspace = join(root, 'workspace')
  await Promise.all([mkdir(storageRoot), mkdir(lockRoot), mkdir(workspace)])
  let processHandle
  let processStderr = ''

  const start = async () => {
    if (processHandle !== undefined) throw new Error('Test host is already running.')
    const child = spawn(process.execPath, [resolve(repositoryRoot, 'tests/support/test-host.mjs')], {
      cwd: repositoryRoot,
      env: { ...process.env, PO_TEST_STORAGE_ROOT: storageRoot, PO_TEST_LOCK_ROOT: lockRoot, PO_TEST_WORKSPACE: workspace, PO_TEST_TASK_RUN_SEED_COUNT: String(taskRunSeedCount), PO_TEST_ISSUE_EVIDENCE_SEED_COUNT: String(issueEvidenceSeedCount) },
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    processHandle = child
    let stderr = ''
    child.stderr.setEncoding('utf8')
    child.stderr.on('data', (chunk) => { stderr += chunk; processStderr += chunk })
    const baseURL = await new Promise((resolveReady, rejectReady) => {
      let stdout = ''
      const timeout = setTimeout(() => rejectReady(new Error(`Test host startup timed out. ${stderr}`)), 20_000)
      child.stdout.setEncoding('utf8')
      child.stdout.on('data', (chunk) => {
        stdout += chunk
        const newline = stdout.indexOf('\n')
        if (newline < 0) return
        clearTimeout(timeout)
        try {
          const message = JSON.parse(stdout.slice(0, newline))
          if (message.type !== 'ready' || typeof message.baseURL !== 'string') throw new Error('Invalid ready message.')
          resolveReady(message.baseURL)
        } catch (error) {
          rejectReady(new Error(`Test host emitted an invalid ready message: ${stdout}`, { cause: error }))
        }
      })
      child.once('exit', (code, signal) => {
        clearTimeout(timeout)
        rejectReady(new Error(`Test host exited before ready (code=${code}, signal=${signal}). ${stderr}`))
      })
    })
    return baseURL
  }

  const stop = async () => {
    const child = processHandle
    if (child === undefined) return
    processHandle = undefined
    if (child.exitCode !== null || child.signalCode !== null) return
    child.kill('SIGTERM')
    await new Promise((resolveExit, rejectExit) => {
      const timeout = setTimeout(() => { child.kill('SIGKILL'); rejectExit(new Error(`Test host did not stop within 10 seconds. ${processStderr}`)) }, 10_000)
      child.once('exit', (code, signal) => {
        clearTimeout(timeout)
        if (code === 0 || signal === 'SIGTERM') resolveExit()
        else rejectExit(new Error(`Test host stopped unexpectedly (code=${code}, signal=${signal}).`))
      })
    })
  }

  return {
    root,
    storageRoot,
    workspace,
    start,
    stop,
    async cleanup() {
      await stop()
      await rm(root, { recursive: true, force: true })
    },
  }
}
