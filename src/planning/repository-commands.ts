import { z } from 'zod'
import type { RepositoryContextSnapshotV3Record } from '../types.js'
import { digestObject, WorkflowError } from '../workflow.js'

const plannedEntryDeclaration = z.object({ targetPath: z.string().min(1), command: z.string().min(1) }).strict()

/** 同一规则交给场景、计划、审核与预检，明确待创建入口与现有源码/执行事实的边界。 */
export const PLANNED_VERIFICATION_ENTRY_RULE_V3 = 'Planned verification entries are separately marked source declarations, not existing repository files or successful executions. Their exact commands may receive Task command refs only because an existing invocation in the target directory tree confirms the runner and every flag. When targetState is absent, the plan must assign bounded creation of targetPath to an implementation Task and order every other user after that producer. The producer must put targetPath in expectedChangeSurfaces and allowedPathScopes, describe the sampling implementation, and create it before running it. For before/after measurements, creation of this authorized measurement-only entry may precede baseline capture; baseline capture must finish before the first product-source modification, preserve the frozen baseline identity, use the same measurement code on both revisions, and retain comparable raw samples, units and environment. Do not claim unseen target source was read, require its results during planning, omit any original axis or sampling rule, infer arbitrary commands, or treat a planned entry as permission to write outside the frozen source and Binding scope. '

/** 解析项目来源中的显式 JSON 声明；仅支持目标目录树内已确认的 Nub GC 模板，拒绝任意 shell、路径遍历、重复及超额入口。 */
export function plannedVerificationEntriesV3(paths: readonly string[], verifiedCommands: readonly string[], source: string): NonNullable<RepositoryContextSnapshotV3Record['plannedVerificationEntries']> {
  const result: NonNullable<RepositoryContextSnapshotV3Record['plannedVerificationEntries']> = []
  for (const line of source.split('\n').filter(line => line.startsWith('planned-verification-entry:'))) {
    let declaration: z.infer<typeof plannedEntryDeclaration>
    try { declaration = plannedEntryDeclaration.parse(JSON.parse(line.slice('planned-verification-entry:'.length).trim())) }
    catch { throw new WorkflowError('planned-verification-entry-invalid', 'A planned verification entry requires an exact JSON targetPath and command declaration.', 422) }
    const { targetPath, command } = declaration
    const pathParts = targetPath.split('/')
    if (!/^[A-Za-z0-9_./-]+\.[cm]?ts$/u.test(targetPath) || pathParts.some(part => part === '' || part === '.' || part === '..') || pathParts.length < 2) {
      throw new WorkflowError('planned-verification-entry-invalid', 'A planned verification entry requires a bounded relative TypeScript path.', 422)
    }
    const match = /^(nub --expose-gc(?: --conditions=[A-Za-z0-9@/_.-]+)?) ([A-Za-z0-9_./-]+\.[cm]?ts)$/u.exec(command)
    const directory = targetPath.slice(0, targetPath.lastIndexOf('/') + 1)
    const templateCommand = match === null || match[2] !== targetPath ? undefined : verifiedCommands.find(candidate => {
      if (!candidate.startsWith(`${match[1]} `)) return false
      const templatePath = candidate.slice(match[1]!.length + 1)
      return paths.includes(templatePath) && templatePath.startsWith(directory)
    })
    if (templateCommand === undefined) throw new WorkflowError('planned-verification-template-unconfirmed', 'The declared entry has no existing runner and exact flag template in its directory tree.', 422)
    if (result.some(item => item.targetPath === targetPath) || result.length >= 4) throw new WorkflowError('planned-verification-entry-invalid', 'Planned verification targets must be unique and limited to four.', 422)
    result.push({ command, targetPath, targetState: paths.includes(targetPath) ? 'present' : 'absent', templateCommand, declarationDigest: digestObject(declaration) })
  }
  return result.sort((a, b) => a.targetPath.localeCompare(b.targetPath))
}

/** 合并已存在入口与有独立来源标记的待创建入口；超过原 100 命令预算拒绝，不静默丢失声明。 */
export function repositoryVerificationCommandCatalogV3(repository: Pick<RepositoryContextSnapshotV3Record, 'verifiedCommands' | 'plannedVerificationEntries'>): string[] {
  const commands = [...new Set([...repository.verifiedCommands, ...(repository.plannedVerificationEntries ?? []).map(entry => entry.command)])]
  if (commands.length > 100) throw new WorkflowError('repository-command-catalog-too-large', 'The verification command catalog exceeds its 100-entry budget.', 413)
  return commands
}

export interface RepositoryCommandManifest {
  packageManager?: unknown
  scripts?: Record<string, unknown>
  dependencies?: Record<string, unknown>
  devDependencies?: Record<string, unknown>
}

// Source-grounded command candidates, not execution results or authorization.
// The exact invocations remain part of the frozen repository digest.
export function repositoryVerificationCommandsV3(paths: string[], manifest: RepositoryCommandManifest | undefined, policyText = '', scriptHeaders: Record<string, string> = {}): string[] {
  const declared = manifest?.packageManager
  const manager = declared !== undefined ? typeof declared === 'string' ? /^(npm|pnpm|yarn|bun|nub)@[^\s]+$/u.exec(declared)?.[1] : undefined
    : paths.includes('pnpm-lock.yaml') ? 'pnpm' : paths.includes('yarn.lock') ? 'yarn' : 'npm'
  if (manager === undefined) throw new WorkflowError('repository-package-manager-unsupported', 'The declared repository packageManager is not supported; do not substitute the lockfile tool.', 422)
  const run = manager === 'yarn' ? 'yarn' : `${manager} run`
  const exec = manager === 'nub' ? 'nub exec --node' : manager === 'npm' ? 'npm exec --' : manager === 'yarn' ? 'yarn exec' : manager === 'bun' ? 'bun x --no-install' : `${manager} exec`
  const scripts = manifest?.scripts ?? {}
  const commands = Object.keys(scripts).filter(name => /^(?:test|check|verify|build|lint|typecheck|bench|benchmark|bundle|size)(?::|$)/u.test(name) && /^[A-Za-z0-9:_-]+$/u.test(name) && typeof scripts[name] === 'string').sort().map(name => `${run} ${name}`)
  const safePath = (path: string) => /^[A-Za-z0-9_./-]+$/u.test(path) && !path.split('/').includes('..') && !path.startsWith('/')
  const dependencies = { ...manifest?.dependencies, ...manifest?.devDependencies }
  if ('tsd' in dependencies) {
    for (const path of paths.filter(path => safePath(path) && /\.test-d\.tsx?$/u.test(path)).sort().slice(0, 16)) {
      commands.push(`${exec} tsd --files ${path}`)
    }
  }
  if ('typescript' in dependencies) {
    for (const path of paths.filter(path => safePath(path) && (path === 'tsconfig.json' || /(?:^|\/)tsconfig\.tests?\.json$/u.test(path))).sort().slice(0, 12)) {
      commands.push(`${exec} tsc --noEmit --project ${path}`)
    }
  }
  // A declared Nub runner can instantiate documented repository-file and
  // benchmark templates. Never infer this runner from a pnpm lockfile.
  if (manager === 'nub') {
    const lines = policyText.split('\n')
    const conditions = [...new Set(Object.values(scripts).filter((value): value is string => typeof value === 'string').flatMap(value => [...value.matchAll(/--conditions(?:=|\s+)([A-Za-z0-9@/_.-]+)/gu)].map(match => match[1]!)))]
    const conditionFlags = conditions.length === 1 ? ` --conditions=${conditions[0]}` : ''
    // Only instantiate a tracked script explicitly referenced by policy whose
    // own header documents the supported runner and runtime flag. Policy prose
    // alone cannot establish flags, and arbitrary inline commands stay data.
    for (const [path, header] of Object.entries(scriptHeaders).sort(([a], [b]) => a.localeCompare(b))) {
      if (!safePath(path) || !paths.includes(path) || !policyText.includes(`\`${path}\``)) continue
      const invocation = /^\s*\*\s+Run with:\s+nub\s+(--allow-natives-syntax|--expose-gc)\s*$/mu.exec(header)
      if (invocation !== null) commands.push(`nub ${invocation[1]}${conditionFlags} ${path}`)
    }
    const benchmarks: string[] = []
    for (const line of lines) {
      const template = /`nub run ([A-Za-z0-9:_-]+) <name>`/u.exec(line)
      const pattern = /`([A-Za-z0-9_./-]+)\/\*\.ts`/u.exec(line)
      if (template !== null && pattern !== null && typeof scripts[template[1]!] === 'string') {
        const directory = pattern[1]!
        if ((scripts[template[1]!] as string).includes(`${directory}/index.ts`)) {
          for (const path of paths.filter(path => safePath(path) && path.startsWith(`${directory}/`) && !path.slice(directory.length + 1).includes('/') && path.endsWith('.ts') && !path.endsWith('/index.ts'))) {
            benchmarks.push(`nub run ${template[1]} ${path.slice(directory.length + 1)}`)
          }
        }
      }
      if (line.includes('`--expose-gc`')) {
        let directory = ''
        for (const match of line.matchAll(/`([A-Za-z0-9_./-]+\.ts)`/gu)) {
          const path = match[1]!.includes('/') ? match[1]! : `${directory}${match[1]}`
          if (!safePath(path) || !paths.includes(path)) continue
          directory = path.slice(0, path.lastIndexOf('/') + 1)
          commands.push(`nub --expose-gc${conditionFlags} ${path}`)
        }
      }
      const directory = /`([A-Za-z0-9_./-]+)` fixture/u.exec(line)?.[1]
      if (directory !== undefined && 'esbuild' in dependencies && /\besbuild\b/u.test(line) && line.includes('`--minify`') && /\bgzip\b/u.test(line)) {
        const sourceCondition = /`--conditions=([A-Za-z0-9@/_.-]+)`/u.exec(line)?.[1]
        for (const path of paths.filter(path => safePath(path) && path.startsWith(`${directory}/`) && !path.slice(directory.length + 1).includes('/') && /\.[cm]?[jt]s$/u.test(path) && !/\.(?:test|config)\./u.test(path)).sort().slice(0, 16)) {
          commands.push(`bash -o pipefail -c 'nub exec --node esbuild ${path} --bundle --minify${sourceCondition === undefined ? '' : ` --conditions=${sourceCondition}`} --format=esm | gzip -c | wc -c'`)
        }
      }
    }
    commands.push(...benchmarks.sort())
  }
  if (paths.includes('pom.xml')) commands.push('mvn test')
  if (paths.includes('gradlew')) commands.push('./gradlew test')
  if (paths.includes('go.mod')) commands.push('go test ./...')
  return [...new Set(commands)].slice(0, 100)
}
