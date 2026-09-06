import { createHash } from 'node:crypto'
import { lstat, readFile, readdir, realpath } from 'node:fs/promises'
import { isAbsolute, join, relative, sep } from 'node:path'
import { spawn } from 'node:child_process'

const MAX_OUTPUT_BYTES = 70_000
const MAX_ARTIFACT_BYTES = 50 * 1024 * 1024

export interface BrowserVerificationRequest {
  cwd: string
  command: [string, ...string[]]
  scenarioKeys: string[]
  timeoutMs?: number
  artifactDirectory?: string
  environment?: Record<string, string>
}

export interface BrowserVerificationResult {
  status: 'passed' | 'failed' | 'unavailable'
  errorCode?: 'verification_failed' | 'verification_unavailable'
  exitCode?: number
  timedOut: boolean
  output: string
  scenarioKeys: string[]
  artifacts: Array<{ path: string; digest: string; size: number }>
  startedAt: string
  completedAt: string
}

async function hasPlaywrightRunner(cwd: string): Promise<boolean> {
  try {
    const manifest = JSON.parse(await readFile(join(cwd, 'package.json'), 'utf8')) as { dependencies?: Record<string, unknown>; devDependencies?: Record<string, unknown> }
    const dependencies = { ...manifest.dependencies, ...manifest.devDependencies }
    return '@playwright/test' in dependencies || 'playwright' in dependencies
  } catch {
    return false
  }
}

async function browserArtifacts(cwd: string, directory: string | undefined): Promise<BrowserVerificationResult['artifacts']> {
  if (directory === undefined) return []
  const canonicalRoot = await realpath(cwd)
  const candidate = isAbsolute(directory) ? directory : join(canonicalRoot, directory)
  let canonicalDirectory: string
  try { canonicalDirectory = await realpath(candidate) } catch { return [] }
  const child = relative(canonicalRoot, canonicalDirectory)
  if (child === '..' || child.startsWith(`..${sep}`) || isAbsolute(child)) return []
  const artifacts: BrowserVerificationResult['artifacts'] = []
  const visit = async (directoryPath: string): Promise<void> => {
    for (const entry of await readdir(directoryPath, { withFileTypes: true })) {
      const absolute = join(directoryPath, entry.name)
      if (entry.isDirectory()) await visit(absolute)
      if (!entry.isFile()) continue
      const info = await lstat(absolute)
      if (info.size > MAX_ARTIFACT_BYTES) continue
      const content = await readFile(absolute)
      artifacts.push({ path: relative(canonicalRoot, absolute).replace(/\\/gu, '/'), digest: createHash('sha256').update(content).digest('hex'), size: info.size })
    }
  }
  await visit(canonicalDirectory)
  return artifacts.sort((left, right) => left.path.localeCompare(right.path))
}

export class BrowserVerificationProvider {
  readonly id = 'playwright-browser-verification'
  readonly version = '1.0.0'

  async verify(input: BrowserVerificationRequest): Promise<BrowserVerificationResult> {
    const startedAt = new Date().toISOString()
    const finish = async (partial: Omit<BrowserVerificationResult, 'scenarioKeys' | 'artifacts' | 'startedAt' | 'completedAt'>): Promise<BrowserVerificationResult> => ({
      ...partial,
      scenarioKeys: [...new Set(input.scenarioKeys)].sort(),
      artifacts: await browserArtifacts(input.cwd, input.artifactDirectory),
      startedAt,
      completedAt: new Date().toISOString(),
    })
    if (!await hasPlaywrightRunner(input.cwd)) return finish({ status: 'unavailable', errorCode: 'verification_unavailable', timedOut: false, output: 'A manifest-managed Playwright runner is not available.' })
    if (input.command.length === 0 || !input.command.join(' ').match(/(?:playwright|browser|e2e|test)/iu)) return finish({ status: 'unavailable', errorCode: 'verification_unavailable', timedOut: false, output: 'The verification command does not invoke a browser test lifecycle.' })

    const timeoutMs = Math.min(30 * 60_000, Math.max(1_000, input.timeoutMs ?? 10 * 60_000))
    return new Promise((resolve) => {
      let output = ''
      let timedOut = false
      let settled = false
      const child = spawn(input.command[0], input.command.slice(1), { cwd: input.cwd, env: { ...process.env, ...input.environment }, stdio: ['ignore', 'pipe', 'pipe'] })
      const append = (chunk: Buffer): void => { output = `${output}${chunk.toString('utf8')}`.slice(-MAX_OUTPUT_BYTES) }
      child.stdout.on('data', append)
      child.stderr.on('data', append)
      const timer = setTimeout(() => { timedOut = true; child.kill('SIGTERM') }, timeoutMs)
      const complete = async (status: BrowserVerificationResult['status'], exitCode: number | undefined, errorCode?: BrowserVerificationResult['errorCode']): Promise<void> => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        resolve(await finish({ status, ...(errorCode === undefined ? {} : { errorCode }), ...(exitCode === undefined ? {} : { exitCode }), timedOut, output }))
      }
      child.once('error', (error) => { output = `${output}${error.message}`; void complete('unavailable', undefined, 'verification_unavailable') })
      child.once('close', (code) => { void complete(code === 0 && !timedOut ? 'passed' : 'failed', code ?? undefined, code === 0 && !timedOut ? undefined : 'verification_failed') })
    })
  }
}
