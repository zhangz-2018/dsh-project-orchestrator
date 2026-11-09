import { CommandRunner } from './command-runner.js'
import { boundedText, WorkflowError } from '../workflow.js'

/** 执行 argv 形式的 Git；Host 注入托管 runner，保留证据超限拒绝及超时错误语义。 */
export async function gitProcess(cwd: string, args: string[], timeoutMs = 120_000, outputLimit = 100_000, rejectTruncated = false, runner = new CommandRunner()): Promise<string> {
  const result = await runner.run({ cwd, command: ['git', ...args], signal: new AbortController().signal, timeoutMs, outputLimit })
  if (result.timedOut) throw new WorkflowError('git-command-timeout', `git ${args[0] ?? ''} exceeded its ${timeoutMs}ms timeout.`, 504)
  if (result.exitCode !== 0) throw new WorkflowError('git-command-failed', `git ${args[0] ?? ''} failed: ${boundedText(result.output, 20_000)}`, 409)
  if (rejectTruncated && result.truncated) throw new WorkflowError('git-output-too-large', `git ${args[0] ?? ''} exceeded the evidence output limit.`, 409)
  return result.output
}
