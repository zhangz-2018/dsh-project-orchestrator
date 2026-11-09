import { posix } from 'node:path'
import type { TaskRunRecord } from '../types.js'
import { digestObject, WorkflowError } from '../workflow.js'
import { gitProcess } from '../execution/git-command.js'

function normalizeRepositoryRelativePath(value: string): string | undefined {
  const normalized = posix.normalize(value.trim().replaceAll('\\', '/').replace(/^\.\//u, ''))
  if (normalized === '' || normalized === '.' || normalized === '..' || normalized.startsWith('../') || normalized.startsWith('/') || /^[a-zA-Z]:\//u.test(normalized)) return undefined
  return normalized
}

/** 读取指定提交的路径事实，复用上层执行后端，缺路径返回空状态。 */
async function gitPathState(cwd: string, commit: string, path: string, runGit: typeof gitProcess): Promise<{ blob?: string; mode?: string }> {
  const output = await runGit(cwd, ['ls-tree', '-z', commit, '--', path], 120_000, 1_000_000, true)
  const entry = output.split('\0').find(Boolean)
  if (entry === undefined) return {}
  const match = /^(\d+)\s+\S+\s+([0-9a-f]+)\t/u.exec(entry)
  if (match === null) throw new WorkflowError('integration-tree-invalid', `Git returned an invalid tree entry for ${path}.`, 502)
  return { mode: match[1]!, blob: match[2]! }
}

/** 固定 base/head 收集持久交付证据，超出上限即拒绝；可注入 Host 的托管 Git。 */
export async function gitCommitEvidence(cwd: string, baseCommit: string, headCommit: string, runGit: typeof gitProcess = gitProcess): Promise<{
  tree: string
  diffDigest: string
  patchIds: string[]
  changedPaths: NonNullable<TaskRunRecord['outputChangedPaths']>
}> {
  const [tree, changedOutput, patch] = await Promise.all([
    runGit(cwd, ['rev-parse', `${headCommit}^{tree}`]),
    runGit(cwd, ['diff', '--name-only', '-z', baseCommit, headCommit], 120_000, 8_500_000, true),
    runGit(cwd, ['diff', '--binary', '--no-ext-diff', baseCommit, headCommit], 120_000, 8_500_000, true),
  ])
  const paths = [...new Set(changedOutput.split('\0').map((value) => normalizeRepositoryRelativePath(value)).filter((value): value is string => value !== undefined))].sort()
  if (paths.length > 2_000) throw new WorkflowError('integration-output-too-large', 'A TaskRun output changes more than 2,000 paths.', 413)
  const changedPaths = await Promise.all(paths.map(async (path) => {
    const [before, after] = await Promise.all([gitPathState(cwd, baseCommit, path, runGit), gitPathState(cwd, headCommit, path, runGit)])
    return { path, ...(before.blob === undefined ? {} : { beforeBlob: before.blob }), ...(after.blob === undefined ? {} : { afterBlob: after.blob }), ...(before.mode === undefined ? {} : { beforeMode: before.mode }), ...(after.mode === undefined ? {} : { afterMode: after.mode }) }
  }))
  const patchIds = await Promise.all(changedPaths.map(async (pathState) => {
    const pathPatch = await runGit(cwd, ['diff', '--binary', '--no-ext-diff', baseCommit, headCommit, '--', pathState.path], 120_000, 8_500_000, true)
    return digestObject({ path: pathState.path, beforeBlob: pathState.beforeBlob, afterBlob: pathState.afterBlob, beforeMode: pathState.beforeMode, afterMode: pathState.afterMode, patch: pathPatch })
  }))
  return { tree: tree.trim(), diffDigest: digestObject({ baseCommit, headCommit, patch, changedPaths }), patchIds, changedPaths }
}
