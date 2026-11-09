import { spawn } from 'node:child_process'
import { stat } from 'node:fs/promises'
import { delimiter, join } from 'node:path'
import type { SubprocessRuntime } from '@deepseek-ai/dsh-subprocess'
import { WorkflowError } from '../workflow.js'

const DEFAULT_OUTPUT_LIMIT = 64_000
const DEFAULT_TIMEOUT_MS = 20 * 60_000
const FORCE_KILL_DELAY_MS = 5_000

export interface CommandInvocation {
  /** 已由业务调用方核实的绝对执行目录。 */
  cwd: string
  /** 字符串按 shell 解释；数组按原始 argv 执行。 */
  command: string | [string, ...string[]]
  /** 所属 operation 的取消信号。 */
  signal: AbortSignal
  /** 毫秒；默认及最大为 20 分钟。 */
  timeoutMs?: number
  /** 保留的输出尾部字节数，最大 10 MB。 */
  outputLimit?: number
  /** 显式环境覆盖；仅允许固定的 DSH_VERIFICATION_* 运行事实，不继承 Host 控制变量。 */
  environment?: Record<string, string>
}

export interface CommandResult {
  exitCode: number
  output: string
  truncated: boolean
  timedOut: boolean
  cancelled: boolean
  executionEnvironment: 'host_path' | 'project_venv'
  virtualEnvPath?: string
  /** 实际使用的进程后端；不代表启用了文件或网络沙箱。 */
  backend?: 'node' | 'dsh_subprocess'
}

/** 去除父进程凭据和 Harness 内部变量，防止测试命令继承控制凭证。 */
export function filteredCommandEnvironment(environment: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  return Object.fromEntries(
    Object.entries(environment).filter(([name]) => !/^DSH_/iu.test(name) && !/(?:key|token|secret|password|credential|cookie|authorization)/iu.test(name)),
  )
}

async function executionEnvironment(cwd: string, overrides: Record<string, string> | undefined): Promise<{
  env: NodeJS.ProcessEnv
  evidence: Pick<CommandResult, 'executionEnvironment' | 'virtualEnvPath'>
}> {
  const env = { ...filteredCommandEnvironment(), ...filteredCommandEnvironment(overrides ?? {}) }
  // 浏览器报告握手由验证器签发，必须显式传递；不从 ambient env 继承这些值。
  for (const key of ['DSH_VERIFICATION_REPORT_PATH', 'DSH_VERIFICATION_INVOCATION_ID', 'DSH_VERIFICATION_REPORT_NONCE', 'DSH_VERIFICATION_SPEC_DIGEST', 'DSH_VERIFICATION_TASK_RUN_ID', 'DSH_VERIFICATION_ARTIFACT_DIRECTORY']) {
    if (overrides?.[key] !== undefined) env[key] = overrides[key]
  }
  const virtualEnvPath = join(cwd, '.venv')
  const executableDirectory = join(virtualEnvPath, process.platform === 'win32' ? 'Scripts' : 'bin')
  try {
    if (!(await stat(executableDirectory)).isDirectory()) return { env, evidence: { executionEnvironment: 'host_path' } }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    return { env, evidence: { executionEnvironment: 'host_path' } }
  }
  return {
    env: { ...env, VIRTUAL_ENV: virtualEnvPath, PATH: `${executableDirectory}${delimiter}${env.PATH ?? ''}` },
    evidence: { executionEnvironment: 'project_venv', virtualEnvPath },
  }
}

export class CommandRunner {
  /** Host 显式传入服务解析器；解析失败时拒绝执行，不回落到 Node 绕开 Host。 */
  constructor(private readonly subprocess?: () => SubprocessRuntime | undefined) {}

  /** 执行已获业务授权的命令；等待关闭、保留有界输出，并区分取消与超时。 */
  async run(input: CommandInvocation): Promise<CommandResult> {
    const execution = await executionEnvironment(input.cwd, input.environment)
    if (input.signal.aborted) return { exitCode: 130, output: 'Cancelled before command started.', truncated: false, timedOut: false, cancelled: true, ...execution.evidence }

    const timeoutMs = Math.min(DEFAULT_TIMEOUT_MS, Math.max(1_000, input.timeoutMs ?? DEFAULT_TIMEOUT_MS))
    const outputLimit = Math.min(10_000_000, Math.max(1_000, input.outputLimit ?? DEFAULT_OUTPUT_LIMIT))
    if (!Number.isFinite(timeoutMs) || !Number.isFinite(outputLimit)) throw new WorkflowError('command-limits-invalid', 'Command limits must be finite.', 400)
    if (this.subprocess !== undefined) return await this.runHost(input, execution, timeoutMs, outputLimit)
    return await new Promise((resolve, reject) => {
      const useProcessGroup = process.platform !== 'win32'
      const options = {
        cwd: input.cwd,
        shell: false,
        env: execution.env,
        stdio: ['ignore', 'pipe', 'pipe'] as ['ignore', 'pipe', 'pipe'],
        detached: useProcessGroup,
      }
      // 两种调用保持独立 spawn 边界；数组分支不隐式拼接或包装为 shell 命令。
      const child = typeof input.command !== 'string'
        ? spawn(input.command[0], input.command.slice(1), options)
        : process.platform === 'win32'
          ? spawn(process.env.ComSpec ?? 'cmd.exe', ['/d', '/s', '/c', input.command], options)
          : spawn('/bin/sh', ['-c', input.command], options)
      let captured = Buffer.alloc(0)
      let truncated = false
      let timedOut = false
      let cancelled = false
      let settled = false
      let forceKill: ReturnType<typeof setTimeout> | undefined

      const collect = (chunk: Buffer | string): void => {
        const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
        const combined = Buffer.concat([captured, buffer])
        if (combined.byteLength > outputLimit) truncated = true
        captured = combined.subarray(Math.max(0, combined.byteLength - outputLimit))
      }
      const sendSignal = (childSignal: NodeJS.Signals): void => {
        try {
          if (useProcessGroup && child.pid !== undefined) process.kill(-child.pid, childSignal)
          else child.kill(childSignal)
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== 'ESRCH') console.warn('[project-orchestrator] failed to signal command process', error)
        }
      }
      const terminate = (): void => {
        sendSignal('SIGTERM')
        if (forceKill === undefined) {
          forceKill = setTimeout(() => sendSignal('SIGKILL'), FORCE_KILL_DELAY_MS)
          forceKill.unref()
        }
      }
      const abort = (): void => {
        cancelled = true
        terminate()
      }
      const timeout = setTimeout(() => {
        timedOut = true
        terminate()
      }, timeoutMs)
      const cleanup = (): void => {
        clearTimeout(timeout)
        if (forceKill !== undefined) clearTimeout(forceKill)
        input.signal.removeEventListener('abort', abort)
      }

      child.stdout.on('data', collect)
      child.stderr.on('data', collect)
      input.signal.addEventListener('abort', abort, { once: true })
      child.once('error', (error) => {
        if (settled) return
        settled = true
        cleanup()
        reject(error)
      })
      child.once('close', (code, childSignal) => {
        if (settled) return
        settled = true
        cleanup()
        const output = `${truncated ? '... output truncated; showing final bytes ...\n' : ''}${captured.toString('utf8')}`
        resolve({
          exitCode: cancelled ? 130 : timedOut ? 124 : code ?? (childSignal === null ? 1 : 128),
          output,
          truncated,
          timedOut,
          cancelled,
          backend: 'node',
          ...execution.evidence,
        })
      })
    })
  }

  /** 映射非交互命令至 dsh 托管范围；服务错误原样失败，取消后等待整个范围清空。 */
  private async runHost(input: CommandInvocation, execution: Awaited<ReturnType<typeof executionEnvironment>>, timeoutMs: number, outputLimit: number): Promise<CommandResult> {
    const runtime = this.subprocess?.()
    if (runtime === undefined) throw new WorkflowError('subprocess-unavailable', 'Harness subprocess service is unavailable; command execution was refused.', 503)
    const controller = new AbortController()
    let cancelled = false
    let timedOut = false
    const abort = () => { if (!controller.signal.aborted) { cancelled = true; controller.abort(input.signal.reason) } }
    input.signal.addEventListener('abort', abort, { once: true })
    if (input.signal.aborted) abort()
    const timer = setTimeout(() => { if (!controller.signal.aborted) { timedOut = true; controller.abort(new Error('Command deadline exceeded.')) } }, timeoutMs)
    // tombstone 删除 Host base 中所有不允许继承的变量；显式 env 只恢复验证握手事实。
    const env: NodeJS.ProcessEnv = { ...Object.fromEntries(Object.keys(process.env).map((key) => [key, undefined])), ...execution.env }
    const argv = typeof input.command !== 'string' ? input.command : process.platform === 'win32'
      ? [process.env.ComSpec ?? 'cmd.exe', '/d', '/s', '/c', input.command]
      : ['/bin/sh', '-c', input.command]
    let captured = Buffer.alloc(0)
    let truncated = false
    const collect = (chunk: Buffer | string) => {
      const combined = Buffer.concat([captured, Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)])
      if (combined.byteLength > outputLimit) truncated = true
      captured = combined.subarray(Math.max(0, combined.byteLength - outputLimit))
    }
    try {
      const handle = runtime.spawn({ argv, cwd: input.cwd, env, signal: controller.signal, graceMs: FORCE_KILL_DELAY_MS, stdio: { stdin: 'ignore', stdout: 'pipe', stderr: 'pipe' } })
      handle.stdout?.on('data', collect)
      handle.stderr?.on('data', collect)
      try {
        const outcome = await handle.done
        // 命令退出但留有子进程仍不能视为完成；终止残留范围后等待 provider 确认。
        handle.terminate()
        if (!await handle.waitForExit(AbortSignal.timeout(FORCE_KILL_DELAY_MS * 2))) throw new WorkflowError('command-range-not-empty', 'Harness could not confirm process-range cleanup.', 504)
        return { exitCode: cancelled ? 130 : timedOut ? 124 : outcome.exitCode ?? 128, output: `${truncated ? '... output truncated; showing final bytes ...\n' : ''}${captured.toString('utf8')}`, truncated, timedOut, cancelled, backend: 'dsh_subprocess', ...execution.evidence }
      } catch (error) {
        handle.terminate()
        await handle.waitForExit(AbortSignal.timeout(FORCE_KILL_DELAY_MS * 2))
        throw error
      }
    } finally {
      clearTimeout(timer)
      input.signal.removeEventListener('abort', abort)
    }
  }
}
