import { createHash, randomUUID } from 'node:crypto'
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { constants } from 'node:fs'
import { access, mkdir } from 'node:fs/promises'
import { hostname } from 'node:os'
import { join } from 'node:path'
import { WorkflowError } from './workflow.js'

const LOCK_HELPER = `
process.stdout.write('WORKSPACE_WRITER_READY\\n')
process.stdin.resume()
process.stdin.on('data', () => process.exit(0))
process.stdin.on('end', () => process.exit(0))
`

export interface WorkspaceWriterOptions {
  workspaceIdentity: string
  lockDirectory: string
  ownerInstanceId?: string
  ownerHostId?: string
  acquisitionTimeoutMs?: number
}

export interface WorkspaceWriterStatus {
  workspaceIdentityDigest: string
  ownerInstanceId: string
  ownerPid: number
  ownerHostId: string
  fencingToken?: number
  health: 'uninitialized' | 'acquiring' | 'healthy' | 'fenced' | 'released'
}

export class WorkspaceWriter {
  readonly workspaceIdentityDigest: string
  readonly ownerInstanceId: string
  readonly ownerHostId: string
  readonly ownerPid = process.pid
  private helper: ChildProcessWithoutNullStreams | undefined
  private state: WorkspaceWriterStatus['health'] = 'uninitialized'
  private fencingToken: number | undefined
  private releasing = false

  constructor(
    private readonly options: WorkspaceWriterOptions,
    private readonly onFenced?: (reason: string) => void,
  ) {
    this.workspaceIdentityDigest = createHash('sha256').update(options.workspaceIdentity).digest('hex')
    this.ownerInstanceId = options.ownerInstanceId ?? randomUUID()
    this.ownerHostId = options.ownerHostId ?? hostname()
  }

  async acquire(): Promise<void> {
    if (this.state === 'healthy') return
    if (this.state === 'acquiring') throw new WorkflowError('workspace-writer-active', 'Workspace writer acquisition is already in progress.', 409)
    if (this.state === 'fenced') throw new WorkflowError('workspace-writer-fenced', 'This service instance lost its authoritative workspace writer lock.', 409)
    await mkdir(this.options.lockDirectory, { recursive: true, mode: 0o700 })
    const lockPath = join(this.options.lockDirectory, `${this.workspaceIdentityDigest}.lock`)
    const command = await this.lockCommand(lockPath)
    this.state = 'acquiring'
    const child = spawn(command.executable, command.args, { stdio: ['pipe', 'pipe', 'pipe'] })
    this.helper = child
    let stderr = ''
    child.stderr.setEncoding('utf8')
    child.stderr.on('data', (chunk: string) => { stderr = `${stderr}${chunk}`.slice(-4_000) })
    child.once('exit', (code, signal) => {
      if (this.helper !== child) return
      this.helper = undefined
      if (this.releasing) {
        this.state = 'released'
        return
      }
      const wasHealthy = this.state === 'healthy'
      this.state = 'fenced'
      if (wasHealthy) this.onFenced?.(`Workspace writer helper exited unexpectedly (code=${code ?? 'null'}, signal=${signal ?? 'null'}).`)
    })

    try {
      await this.waitUntilReady(child, this.options.acquisitionTimeoutMs ?? 5_000)
      this.state = 'healthy'
    } catch (error) {
      if (child.exitCode === null && child.signalCode === null) child.kill('SIGTERM')
      this.helper = undefined
      this.state = 'released'
      const detail = stderr.trim()
      if (detail.includes('already locked') || child.exitCode === 75 || child.exitCode === 1) {
        throw new WorkflowError('workspace-writer-active', 'Another process already owns the authoritative workspace writer lock.', 409)
      }
      if (error instanceof WorkflowError) throw error
      throw new WorkflowError('workspace-writer-unavailable', `Unable to acquire the authoritative workspace writer lock${detail === '' ? '.' : `: ${detail}`}`, 500)
    }
  }

  activate(fencingToken: number): void {
    if (!Number.isSafeInteger(fencingToken) || fencingToken <= 0) throw new WorkflowError('workspace-writer-token-invalid', 'Workspace writer fencing token must be a positive safe integer.', 500)
    if (this.state !== 'healthy' || this.helper?.exitCode !== null) throw new WorkflowError('workspace-writer-fenced', 'The authoritative workspace writer lock is not held.', 409)
    this.fencingToken = fencingToken
  }

  assertWriter(expectedToken = this.fencingToken): void {
    if (expectedToken === undefined || this.fencingToken !== expectedToken || this.state !== 'healthy' || this.helper === undefined || this.helper.exitCode !== null || this.helper.signalCode !== null) {
      throw new WorkflowError('workspace-writer-fenced', 'This service instance does not hold the current authoritative workspace writer fencing token.', 409)
    }
  }

  status(): WorkspaceWriterStatus {
    return {
      workspaceIdentityDigest: this.workspaceIdentityDigest,
      ownerInstanceId: this.ownerInstanceId,
      ownerPid: this.ownerPid,
      ownerHostId: this.ownerHostId,
      ...(this.fencingToken === undefined ? {} : { fencingToken: this.fencingToken }),
      health: this.state,
    }
  }

  async release(): Promise<void> {
    const child = this.helper
    if (child === undefined) {
      if (this.state !== 'fenced') this.state = 'released'
      return
    }
    this.releasing = true
    const exited = new Promise<void>((resolve) => child.once('exit', () => resolve()))
    child.stdin.end('release\n')
    const timer = setTimeout(() => {
      if (child.exitCode === null && child.signalCode === null) child.kill('SIGTERM')
    }, 2_000)
    timer.unref()
    await exited
    clearTimeout(timer)
    this.helper = undefined
    this.fencingToken = undefined
    this.state = 'released'
    this.releasing = false
  }

  private async lockCommand(lockPath: string): Promise<{ executable: string; args: string[] }> {
    if (process.platform === 'darwin') {
      await access('/usr/bin/lockf', constants.X_OK)
      return { executable: '/usr/bin/lockf', args: ['-t', '0', lockPath, process.execPath, '-e', LOCK_HELPER] }
    }
    for (const executable of ['/usr/bin/flock', '/bin/flock']) {
      try {
        await access(executable, constants.X_OK)
        return { executable, args: ['-n', lockPath, process.execPath, '-e', LOCK_HELPER] }
      } catch {}
    }
    throw new WorkflowError('workspace-writer-unsupported', 'No supported authoritative OS file-lock command is available on this host.', 500)
  }

  private async waitUntilReady(child: ChildProcessWithoutNullStreams, timeoutMs: number): Promise<void> {
    child.stdout.setEncoding('utf8')
    await new Promise<void>((resolve, reject) => {
      let output = ''
      const cleanup = () => {
        clearTimeout(timeout)
        child.stdout.off('data', onData)
        child.off('exit', onExit)
        child.off('error', onError)
      }
      const onData = (chunk: string) => {
        output += chunk
        if (!output.includes('WORKSPACE_WRITER_READY\n')) return
        cleanup()
        resolve()
      }
      const onExit = (code: number | null, signal: NodeJS.Signals | null) => {
        cleanup()
        reject(new Error(`workspace writer helper exited before readiness (code=${code ?? 'null'}, signal=${signal ?? 'null'})`))
      }
      const onError = (error: Error) => {
        cleanup()
        reject(error)
      }
      const timeout = setTimeout(() => {
        cleanup()
        reject(new WorkflowError('workspace-writer-timeout', 'Timed out acquiring the authoritative workspace writer lock.', 500))
      }, timeoutMs)
      timeout.unref()
      child.stdout.on('data', onData)
      child.once('exit', onExit)
      child.once('error', onError)
    })
  }
}
