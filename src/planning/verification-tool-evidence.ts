import { createHash } from 'node:crypto'
import { lstat, readFile, realpath } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import type { RepositoryCommandManifest } from './repository-commands.js'
import type { RepositoryContextSnapshotV3Record } from '../types.js'

type ToolEvidence = NonNullable<RepositoryContextSnapshotV3Record['verificationTools']>[number]
const hash = (content: string) => createHash('sha256').update(content).digest('hex')
const safePath = (path: string) => !isAbsolute(path) && !path.split(/[\\/]/u).includes('..') && !path.includes('\0')

/** 只读冻结已安装且与声明最低版本一致的脚本工具；不安装或执行包，未解析依赖保留为证据缺口。 */
export async function captureVerificationToolEvidenceV3(root: string, manifest: RepositoryCommandManifest | undefined): Promise<ToolEvidence[]> {
  const scripts = Object.entries(manifest?.scripts ?? {}).filter(([name, value]) => /^(?:test|check|verify|build|lint|typecheck)(?::|$)/u.test(name) && typeof value === 'string')
  const tokens = new Set(scripts.flatMap(([, value]) => (value as string).match(/[A-Za-z0-9@/_.-]+/gu) ?? []))
  const dependencies = { ...manifest?.dependencies, ...manifest?.devDependencies }
  const result: ToolEvidence[] = []
  for (const [name, range] of Object.entries(dependencies).sort(([a], [b]) => a.localeCompare(b))) {
    if (result.length === 4) break
    if (!/^(?:@[A-Za-z0-9_.-]+\/)?[A-Za-z0-9_.-]+$/u.test(name) || typeof range !== 'string' || !/^[~^]?\d+\.\d+\.\d+$/u.test(range)) continue
    let directory = resolve(root)
    while (true) {
      const modules = join(directory, 'node_modules')
      const candidate = join(modules, name)
      let packageRoot: string
      try { packageRoot = await realpath(candidate) } catch {
        const parent = dirname(directory)
        if (parent === directory) break
        directory = parent
        continue
      }
      // First installed package wins, as in Node resolution; do not silently
      // fall through a mismatch to a different ancestor version.
      try {
        const read = async (path: string, limit: number) => {
          if (!safePath(path)) throw new Error('Unsafe package path')
          const file = join(packageRoot, path)
          const actual = await realpath(file)
          if (actual !== file || relative(packageRoot, actual).startsWith(`..${sep}`)) throw new Error('Package file escapes its root')
          const info = await lstat(actual)
          if (!info.isFile() || info.size > limit) throw new Error('Package file unavailable or too large')
          return readFile(actual, 'utf8')
        }
        const packageText = await read('package.json', 32_768)
        const installed = JSON.parse(packageText) as { name?: string; version?: string; bin?: string | Record<string, string>; types?: string; exports?: { types?: string } }
        // Conservative subset: exact declared minimum. Never infer a lockfile
        // pin or compatibility with arbitrary semver syntax from this check.
        if (installed.name !== name || installed.version !== range.replace(/^[~^]/u, '')) break
        const bins = typeof installed.bin === 'string' ? { [name.split('/').at(-1)!]: installed.bin } : installed.bin ?? {}
        for (const [binName, binPath] of Object.entries(bins).sort(([a], [b]) => a.localeCompare(b))) {
          if (!tokens.has(binName) || typeof binPath !== 'string' || !safePath(binPath)) continue
          if (await realpath(join(modules, '.bin', binName)) !== await realpath(join(packageRoot, binPath))) continue
          const files: ToolEvidence['files'] = [{ path: 'package.json', digest: hash(packageText), content: packageText, truncated: false }]
          const unavailablePaths: string[] = []
          const queue = [binPath, installed.types ?? installed.exports?.types].filter((path): path is string => typeof path === 'string')
          const seen = new Set(['package.json'])
          let bytes = Buffer.byteLength(packageText)
          while (queue.length && seen.size < 24) {
            const requested = queue.shift()!
            const path = relative(packageRoot, resolve(packageRoot, requested)).split(sep).join('/')
            if (seen.has(path)) continue
            seen.add(path)
            try {
              if (!safePath(path) || (path !== relative(packageRoot, resolve(packageRoot, binPath)) && !/\.(?:[cm]?[jt]sx?|json)$/u.test(path))) throw new Error('Unsupported source path')
              const content = await read(path, 65_536)
              if (bytes + Buffer.byteLength(content) > 98_304) throw new Error('Package source budget exceeded')
              bytes += Buffer.byteLength(content)
              files.push({ path, digest: hash(content), content, truncated: false })
              for (const match of content.matchAll(/(?:\bfrom\s*|\bimport\s*|\bimport\s*\(\s*)['"](\.[^'"]+)['"]/gu)) {
                queue.push(relative(packageRoot, resolve(packageRoot, dirname(path), match[1]!)))
              }
              // CommonJS 可省略扩展名或引用目录；使用 Node 的只读解析规则，仍禁止越出本包。
              const require = createRequire(join(packageRoot, path))
              for (const match of content.matchAll(/\brequire\s*\(\s*['"](\.[^'"]+)['"]/gu)) {
                const requested = relative(packageRoot, resolve(packageRoot, dirname(path), match[1]!)).split(sep).join('/')
                try {
                  const resolved = relative(packageRoot, require.resolve(match[1]!)).split(sep).join('/')
                  if (!safePath(resolved)) throw new Error('Resolved dependency escapes package root')
                  queue.push(resolved)
                } catch { unavailablePaths.push(requested) }
              }
            } catch { unavailablePaths.push(path) }
          }
          // 预算耗尽仅表示尚未访问的依赖缺失；重复入队的已读取文件不能同时标为不可用。
          unavailablePaths.push(...queue.map(path => relative(packageRoot, resolve(packageRoot, path)).split(sep).join('/')).filter(path => !seen.has(path)))
          if (!files.some(file => file.path === relative(packageRoot, resolve(packageRoot, binPath)))) continue
          result.push({ packageName: name, declaredRange: range, version: installed.version, binName, entryPath: relative(packageRoot, resolve(packageRoot, binPath)).split(sep).join('/'), files: files.sort((a, b) => a.path.localeCompare(b.path)), unavailablePaths: [...new Set(unavailablePaths)].sort() })
          break
        }
      } catch { /* Absent or unsupported tools do not establish discovery. */ }
      break
    }
  }
  return result
}
