import { randomUUID } from 'node:crypto'
import { mkdir, mkdtemp, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { OrchestratorStore } from '../storage.js'
import type { ArtifactRecord, TaskRecord, TaskRunRecord, VerificationEvidenceRecord, VerificationInvocationRecord, VerificationSpecRecord, VerificationTestMapping } from '../types.js'
import { digestObject, WorkflowError } from '../workflow.js'
import { CommandRunner, type CommandResult } from '../execution/command-runner.js'
import { BrowserVerificationProvider, type BrowserVerificationResult } from './browser.js'

const SOURCE_OUTPUT_LIMIT = 1_000_000

export function verificationSpecDigest(spec: Omit<VerificationSpecRecord, 'specDigest'>): string {
  return digestObject(spec)
}

async function runGit(commandRunner: CommandRunner, cwd: string, args: [string, ...string[]], signal: AbortSignal): Promise<string> {
  const result = await commandRunner.run({ cwd, command: ['git', ...args], signal, outputLimit: SOURCE_OUTPUT_LIMIT, timeoutMs: 120_000 })
  if (result.exitCode !== 0 || result.truncated) throw new WorkflowError('verification-source-state-unavailable', `Cannot capture verification source state: git ${args.join(' ')} failed or exceeded the evidence limit.`, 409)
  return result.output
}

async function sourceStateDigest(commandRunner: CommandRunner, cwd: string, signal: AbortSignal): Promise<string> {
  const [head, status, patch, untrackedOutput] = await Promise.all([
    runGit(commandRunner, cwd, ['rev-parse', 'HEAD^{commit}'], signal),
    runGit(commandRunner, cwd, ['status', '--porcelain=v1', '-z', '--untracked-files=all'], signal),
    runGit(commandRunner, cwd, ['diff', '--binary', '--no-ext-diff', 'HEAD'], signal),
    runGit(commandRunner, cwd, ['ls-files', '--others', '--exclude-standard', '-z'], signal),
  ])
  const untrackedPaths = untrackedOutput.split('\0').filter(Boolean).sort()
  if (untrackedPaths.length > 2_000) throw new WorkflowError('verification-source-state-too-large', 'Verification source state contains more than 2,000 untracked files.', 413)
  const untracked = await Promise.all(untrackedPaths.map(async (path) => ({ path, digest: (await runGit(commandRunner, cwd, ['hash-object', '--no-filters', '--', path], signal)).trim() })))
  return digestObject({ head: head.trim(), status, patch, untracked })
}

export interface VerificationRunResult {
  invocation: VerificationInvocationRecord
  evidence: VerificationEvidenceRecord
  command: CommandResult | BrowserVerificationResult
}

export class VerificationService {
  private readonly browserProvider: BrowserVerificationProvider

  constructor(private readonly store: OrchestratorStore, private readonly commandRunner = new CommandRunner()) {
    this.browserProvider = new BrowserVerificationProvider(commandRunner)
  }

  async verify(input: { task: TaskRecord; taskRun: TaskRunRecord; signal: AbortSignal }): Promise<VerificationRunResult> {
    const { task, taskRun, signal } = input
    if (task.verificationSpecId === undefined || taskRun.planSnapshotId === undefined || taskRun.executionContractDigest === undefined) throw new WorkflowError('verification-spec-missing', 'The TaskRun is missing a frozen verification contract.', 409)
    const spec = this.store.verificationSpecs.get(task.verificationSpecId)
    if (spec === undefined || spec.taskId !== task.id || spec.projectId !== taskRun.projectId || spec.planSnapshotId !== taskRun.planSnapshotId) throw new WorkflowError('verification-spec-stale', 'The Task verification spec is missing or does not match the current TaskRun.', 409)
    const { specDigest: _storedDigest, ...specWithoutDigest } = spec
    if (verificationSpecDigest(specWithoutDigest) !== spec.specDigest) throw new WorkflowError('verification-spec-corrupt', 'The frozen verification spec digest does not match its content.', 409)
    if (spec.commandIds.length !== 1 || spec.commandIds[0] !== task.testCommand) throw new WorkflowError('verification-command-stale', 'The approved verification command no longer matches the Task.', 409)
    const cwd = taskRun.workspace ?? taskRun.cwd
    if (cwd === undefined) throw new WorkflowError('verification-workspace-missing', 'The TaskRun has no claimed verification workspace.', 409)

    const evidenceDirectory = await mkdtemp(join(tmpdir(), 'dsh-verification-'))
    const artifactDirectory = join(evidenceDirectory, 'artifacts')
    const reportPath = join(evidenceDirectory, 'report.json')
    await mkdir(artifactDirectory, { recursive: true })
    const createdAt = new Date().toISOString()
    const invocationId = `verification-invocation:${taskRun.id}:${randomUUID()}`
    const reportNonce = `${randomUUID()}${randomUUID()}`
    const beforeDigest = await sourceStateDigest(this.commandRunner, cwd, signal)
    let invocation: VerificationInvocationRecord = {
      schemaVersion: 1,
      id: invocationId,
      projectId: taskRun.projectId,
      taskRunId: taskRun.id,
      attempt: taskRun.attempt,
      specId: spec.id,
      specDigest: spec.specDigest,
      planSnapshotId: taskRun.planSnapshotId,
      executionContractDigest: taskRun.executionContractDigest,
      commandDigest: digestObject(spec.commandIds),
      sourceStateDigest: beforeDigest,
      reportNonce,
      state: 'prepared',
      createdAt,
    }
    await this.store.verificationInvocations.put(invocation.id, invocation)
    invocation = { ...invocation, state: 'running', startedAt: new Date().toISOString() }
    await this.store.verificationInvocations.put(invocation.id, invocation)

    let command: CommandResult | BrowserVerificationResult
    try {
      if (spec.provider === 'playwright') {
        const mappings = spec.reportContract?.testMappings ?? []
        command = await this.browserProvider.verify({
          cwd,
          command: task.testCommand,
          taskRunId: taskRun.id,
          invocationId,
          reportNonce,
          specDigest: spec.specDigest,
          reportPath,
          evidenceDirectory,
          artifactDirectory,
          requiredTests: mappings.map((mapping: VerificationTestMapping) => ({ scenarioKey: mapping.scenarioKey, testFile: mapping.testFile, testKey: mapping.testKey, browserProject: mapping.browserProject })),
          signal,
        })
      } else {
        command = await this.commandRunner.run({ cwd, command: task.testCommand, signal })
      }
    } catch (error) {
      const completedAt = new Date().toISOString()
      invocation = { ...invocation, state: signal.aborted ? 'cancelled' : 'interrupted', outcome: 'unavailable', failureCode: error instanceof Error ? error.name : 'verification-execution-error', completedAt }
      await this.store.verificationInvocations.put(invocation.id, invocation)
      throw error
    }

    let afterDigest: string
    try {
      afterDigest = await sourceStateDigest(this.commandRunner, cwd, signal)
    } catch (error) {
      const completedAt = new Date().toISOString()
      invocation = {
        ...invocation,
        state: signal.aborted ? 'cancelled' : 'interrupted',
        outcome: 'unavailable',
        failureCode: error instanceof WorkflowError ? error.code : 'verification-source-state-unavailable',
        completedAt,
      }
      await this.store.verificationInvocations.put(invocation.id, invocation)
      throw error
    }
    const sourceChanged = beforeDigest !== afterDigest
    const browser = spec.provider === 'playwright' ? command as BrowserVerificationResult : undefined
    const commandResult = spec.provider === 'command' ? command as CommandResult : undefined
    const status = sourceChanged ? 'failed' : browser?.status ?? (commandResult?.exitCode === 0 ? 'passed' : 'failed')
    const failureCode = sourceChanged ? 'verification_source_changed' : browser?.failureCode ?? (commandResult?.timedOut ? 'verification_timeout' : commandResult?.cancelled ? 'verification_cancelled' : commandResult?.exitCode === 0 ? undefined : 'command_failed')
    let reportArtifact: ArtifactRecord | undefined
    if (browser?.reportDigest !== undefined) {
      const content = await readFile(reportPath, 'utf8')
      const artifact: ArtifactRecord = {
        id: randomUUID(), projectId: taskRun.projectId, ...(taskRun.issueId === undefined ? {} : { issueId: taskRun.issueId }), taskRunId: taskRun.id,
        kind: 'test_report', name: 'Structured browser verification report', status: 'available', uri: reportPath,
        content: content.length <= 100_000 ? content : undefined,
        metadata: { invocationId, reportDigest: browser.reportDigest, evidenceDirectory, artifacts: browser.artifacts }, createdAt: new Date().toISOString(),
      }
      reportArtifact = artifact
      await this.store.artifacts.put(artifact.id, artifact)
      const currentRun = this.store.taskRuns.get(taskRun.id)
      if (currentRun !== undefined) await this.store.taskRuns.put(taskRun.id, { ...currentRun, artifactIds: [...new Set([...(currentRun.artifactIds ?? []), artifact.id])] })
    }
    const completedAt = new Date().toISOString()
    invocation = {
      ...invocation,
      state: 'finished',
      outcome: status,
      ...(failureCode === undefined ? {} : { failureCode }),
      ...(browser?.reportDigest === undefined ? {} : { reportDigest: browser.reportDigest }),
      ...(reportArtifact === undefined ? {} : { reportArtifactId: reportArtifact.id }),
      completedAt,
    }
    await this.store.verificationInvocations.put(invocation.id, invocation)

    const common = {
      schemaVersion: 2 as const, id: `${taskRun.id}:verification`, projectId: taskRun.projectId, taskId: task.id, taskRunId: taskRun.id, attempt: taskRun.attempt,
      planSnapshotId: taskRun.planSnapshotId, acceptanceIds: [...(task.acceptanceIds ?? [])], status, command: task.testCommand,
      exitCode: browser?.exitCode ?? commandResult?.exitCode, output: sourceChanged ? `${command.output}\nVerification changed the tested source state.` : command.output,
      artifactIds: [...new Set([...(this.store.taskRuns.get(taskRun.id)?.artifactIds ?? []), ...(reportArtifact === undefined ? [] : [reportArtifact.id])])],
      invocationId, specId: spec.id, specDigest: spec.specDigest, sourceStateDigest: beforeDigest, actorType: 'system' as const, createdAt: completedAt,
    }
    const evidenceWithoutDigest = spec.provider === 'playwright'
      ? {
          ...common, kind: 'browser_test' as const,
          scenarioResults: (browser?.scenarioResults ?? []).map((result) => {
            const mapping = spec.reportContract!.testMappings.find((item: VerificationTestMapping) => item.scenarioKey === result.scenarioKey && item.testFile === result.testFile && item.testKey === result.testKey && item.browserProject === result.browserProject)
            return { scenarioId: mapping?.scenarioId ?? `unmapped:${result.scenarioKey}`, ...result }
          }),
          reportDigest: browser?.reportDigest ?? digestObject({ missing: true, invocationId }),
        }
      : { ...common, kind: 'test_command' as const }
    const evidence: VerificationEvidenceRecord = { ...evidenceWithoutDigest, evidenceDigest: digestObject(evidenceWithoutDigest) }
    return { invocation, evidence, command }
  }
}
