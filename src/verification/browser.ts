import { createHash } from 'node:crypto'
import { lstat, mkdir, readFile, readdir, realpath, unlink } from 'node:fs/promises'
import { dirname, isAbsolute, join, relative, sep } from 'node:path'
import { z } from 'zod'
import { CommandRunner, type CommandResult } from '../execution/command-runner.js'

const MAX_ARTIFACT_BYTES = 50 * 1024 * 1024
const MAX_REPORT_BYTES = 5 * 1024 * 1024

const BrowserTestResultSchema = z.object({
  testKey: z.string().trim().min(1).max(500),
  testFile: z.string().trim().min(1).max(4_096),
  scenarioKey: z.string().trim().min(1).max(500),
  browserProject: z.string().trim().min(1).max(240),
  status: z.enum(['passed', 'failed', 'skipped', 'xfail', 'flaky']),
  retry: z.number().int().nonnegative().max(100),
  error: z.string().max(20_000).optional(),
}).strict()

export const BrowserVerificationReportSchema = z.object({
  schemaVersion: z.literal(1),
  reporterId: z.literal('dsh-playwright-json-v1'),
  invocationId: z.string().min(1),
  nonce: z.string().min(16),
  specDigest: z.string().regex(/^[0-9a-f]{64}$/u),
  taskRunId: z.string().min(1),
  outcome: z.enum(['passed', 'failed']),
  startedAt: z.string().min(1),
  completedAt: z.string().min(1),
  total: z.number().int().nonnegative(),
  tests: z.array(BrowserTestResultSchema).max(20_000),
}).strict()

export type BrowserVerificationReport = z.infer<typeof BrowserVerificationReportSchema>
export type BrowserScenarioResult = z.infer<typeof BrowserTestResultSchema>

export interface BrowserVerificationRequest {
  cwd: string
  command: string | [string, ...string[]]
  taskRunId: string
  invocationId: string
  reportNonce: string
  specDigest: string
  reportPath: string
  evidenceDirectory?: string
  requiredTests: Array<{ scenarioKey: string; testFile: string; testKey: string; browserProject: string }>
  signal?: AbortSignal
  timeoutMs?: number
  artifactDirectory?: string
  environment?: Record<string, string>
}

export type BrowserVerificationFailureCode =
  | 'command_failed'
  | 'command_cancelled'
  | 'report_missing'
  | 'report_invalid'
  | 'report_mismatch'
  | 'report_stale'
  | 'zero_tests'
  | 'duplicate_test_identity'
  | 'required_test_missing'
  | 'test_not_passed'

export interface BrowserVerificationResult {
  status: 'passed' | 'failed' | 'unavailable'
  errorCode?: 'verification_failed' | 'verification_unavailable'
  failureCode?: BrowserVerificationFailureCode
  exitCode?: number
  timedOut: boolean
  cancelled: boolean
  output: string
  scenarioKeys: string[]
  scenarioResults: BrowserScenarioResult[]
  report?: BrowserVerificationReport
  reportDigest?: string
  artifacts: Array<{ path: string; digest: string; size: number }>
  executionEnvironment?: CommandResult['executionEnvironment']
  virtualEnvPath?: string
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

async function browserArtifacts(evidenceDirectory: string, directory: string | undefined): Promise<BrowserVerificationResult['artifacts']> {
  if (directory === undefined) return []
  const canonicalRoot = await realpath(evidenceDirectory)
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

function reportFailure(input: BrowserVerificationRequest, report: BrowserVerificationReport, startedAt: string, completedAt: string): BrowserVerificationFailureCode | undefined {
  if (report.invocationId !== input.invocationId || report.nonce !== input.reportNonce || report.specDigest !== input.specDigest || report.taskRunId !== input.taskRunId) return 'report_mismatch'
  const reportStarted = Date.parse(report.startedAt)
  const reportCompleted = Date.parse(report.completedAt)
  if (!Number.isFinite(reportStarted) || !Number.isFinite(reportCompleted) || reportCompleted < reportStarted || reportStarted < Date.parse(startedAt) - 1_000 || reportCompleted > Date.parse(completedAt) + 1_000) return 'report_stale'
  if (report.total === 0 || report.tests.length === 0) return 'zero_tests'
  if (report.total !== report.tests.length) return 'report_invalid'
  const identities = report.tests.map((test) => `${test.browserProject}\u0000${test.testFile}\u0000${test.testKey}`)
  if (new Set(identities).size !== identities.length) return 'duplicate_test_identity'
  const resultByIdentity = new Map(report.tests.map((test) => [`${test.browserProject}\u0000${test.testFile}\u0000${test.testKey}`, test]))
  for (const required of input.requiredTests) {
    const result = resultByIdentity.get(`${required.browserProject}\u0000${required.testFile}\u0000${required.testKey}`)
    if (result === undefined || result.scenarioKey !== required.scenarioKey) return 'required_test_missing'
  }
  if (report.outcome !== 'passed' || report.tests.some((test) => test.status !== 'passed' || test.retry !== 0)) return 'test_not_passed'
  return undefined
}

export class BrowserVerificationProvider {
  readonly id = 'playwright-browser-verification'
  readonly version = '2.0.0'

  constructor(private readonly commandRunner = new CommandRunner()) {}

  async verify(input: BrowserVerificationRequest): Promise<BrowserVerificationResult> {
    const startedAt = new Date().toISOString()
    const scenarioKeys = [...new Set(input.requiredTests.map((test) => test.scenarioKey))].sort()
    const finish = async (partial: Omit<BrowserVerificationResult, 'scenarioKeys' | 'artifacts' | 'startedAt' | 'completedAt'>): Promise<BrowserVerificationResult> => ({
      ...partial,
      scenarioKeys,
      artifacts: await browserArtifacts(input.evidenceDirectory ?? input.cwd, input.artifactDirectory),
      startedAt,
      completedAt: new Date().toISOString(),
    })
    if (!await hasPlaywrightRunner(input.cwd)) return finish({ status: 'unavailable', errorCode: 'verification_unavailable', timedOut: false, cancelled: false, output: 'A manifest-managed Playwright runner is not available.', scenarioResults: [] })
    const commandText = typeof input.command === 'string' ? input.command : input.command.join(' ')
    if (!commandText.match(/(?:playwright|browser|e2e|test)/iu)) return finish({ status: 'unavailable', errorCode: 'verification_unavailable', timedOut: false, cancelled: false, output: 'The verification command does not invoke a browser test lifecycle.', scenarioResults: [] })
    if (input.requiredTests.length === 0) return finish({ status: 'failed', errorCode: 'verification_failed', failureCode: 'required_test_missing', timedOut: false, cancelled: false, output: 'The browser verification spec has no required test mappings.', scenarioResults: [] })

    await mkdir(dirname(input.reportPath), { recursive: true })
    try { await unlink(input.reportPath) } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error }

    let command: CommandResult
    try {
      const signal = input.signal ?? new AbortController().signal
      command = await this.commandRunner.run({
        cwd: input.cwd,
        command: input.command,
        signal,
        ...(input.timeoutMs === undefined ? {} : { timeoutMs: input.timeoutMs }),
        environment: {
          ...input.environment,
          DSH_VERIFICATION_REPORT_PATH: input.reportPath,
          DSH_VERIFICATION_INVOCATION_ID: input.invocationId,
          DSH_VERIFICATION_REPORT_NONCE: input.reportNonce,
          DSH_VERIFICATION_SPEC_DIGEST: input.specDigest,
          DSH_VERIFICATION_TASK_RUN_ID: input.taskRunId,
          DSH_VERIFICATION_ARTIFACT_DIRECTORY: input.artifactDirectory ?? '',
        },
      })
    } catch (error) {
      return finish({ status: 'unavailable', errorCode: 'verification_unavailable', timedOut: false, cancelled: false, output: error instanceof Error ? error.message : String(error), scenarioResults: [] })
    }

    const commandFields = {
      exitCode: command.exitCode,
      timedOut: command.timedOut,
      cancelled: command.cancelled,
      output: command.output,
      scenarioResults: [] as BrowserScenarioResult[],
      executionEnvironment: command.executionEnvironment,
      ...(command.virtualEnvPath === undefined ? {} : { virtualEnvPath: command.virtualEnvPath }),
    }
    if (command.cancelled) return finish({ ...commandFields, status: 'failed', errorCode: 'verification_failed', failureCode: 'command_cancelled' })
    if (command.exitCode !== 0) return finish({ ...commandFields, status: 'failed', errorCode: 'verification_failed', failureCode: 'command_failed' })

    let reportBytes: Buffer
    try { reportBytes = await readFile(input.reportPath) } catch { return finish({ ...commandFields, status: 'failed', errorCode: 'verification_failed', failureCode: 'report_missing' }) }
    if (reportBytes.byteLength > MAX_REPORT_BYTES) return finish({ ...commandFields, status: 'failed', errorCode: 'verification_failed', failureCode: 'report_invalid' })
    const parsed = BrowserVerificationReportSchema.safeParse((() => { try { return JSON.parse(reportBytes.toString('utf8')) } catch { return undefined } })())
    if (!parsed.success) return finish({ ...commandFields, status: 'failed', errorCode: 'verification_failed', failureCode: 'report_invalid' })

    const completedAt = new Date().toISOString()
    const failureCode = reportFailure(input, parsed.data, startedAt, completedAt)
    const reportDigest = createHash('sha256').update(reportBytes).digest('hex')
    const reportFields = { ...commandFields, scenarioResults: parsed.data.tests, report: parsed.data, reportDigest }
    if (failureCode !== undefined) return { ...await finish({ ...reportFields, status: 'failed', errorCode: 'verification_failed', failureCode }), completedAt }
    return { ...await finish({ ...reportFields, status: 'passed' }), completedAt }
  }
}
