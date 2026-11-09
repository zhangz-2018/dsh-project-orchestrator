import { WorkflowError } from '../workflow.js'

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
