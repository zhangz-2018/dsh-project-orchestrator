import { createHash } from 'node:crypto'
import { lstat, readFile, realpath } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import ts from 'typescript'
import type { RepositoryCommandManifest } from './repository-commands.js'
import type { RepositoryContextSnapshotV3Record } from '../types.js'

type ToolEvidence = NonNullable<RepositoryContextSnapshotV3Record['verificationTools']>[number]
const hash = (content: string) => createHash('sha256').update(content).digest('hex')
const safePath = (path: string) => !isAbsolute(path) && !path.split(/[\\/]/u).includes('..') && !path.includes('\0')

/** 只追踪已声明的显式子脚本调用；循环用已访问集合收敛，不执行脚本或推断生命周期钩子。 */
function verificationScriptTokens(manifest: RepositoryCommandManifest | undefined): Set<string> {
  const scripts = manifest?.scripts ?? {}
  const queue = Object.keys(scripts).filter(name => /^(?:test|check|verify|build|lint|typecheck)(?::|$)/u.test(name))
  const seen = new Set<string>()
  const tokens = new Set<string>()
  while (queue.length) {
    const name = queue.shift()!
    if (seen.has(name) || typeof scripts[name] !== 'string') continue
    seen.add(name)
    const command = scripts[name] as string
    for (const token of command.match(/[A-Za-z0-9@/_.-]+/gu) ?? []) tokens.add(token)
    // 仅识别完整命令段的静态脚本名；变量、引号和通配符等未解析形式继续保留为证据缺口。
    for (const segment of command.split(/&&|\|\||[;|]/u)) {
      const run = /^\s*(?:npm|pnpm|yarn|bun|nub)\s+run\s+([A-Za-z0-9:_-]+)(?:\s|$)/u.exec(segment)
      if (run) queue.push(run[1]!)
      const all = /^\s*(?:npm-run-all|run-s|run-p)\s+([A-Za-z0-9:_\s-]+)$/u.exec(segment)
      if (all) queue.push(...all[1]!.trim().split(/\s+/u).filter(token => !token.startsWith('-')))
    }
  }
  return tokens
}

/** 仅选择 tsc 命令发现及诊断指令处理链；符号缺失时保留缺口，禁止以摘要补猜实现。 */
const compilerEvidenceSymbols = new Set([
  'executeCommandLine', 'executeCommandLineWorker', 'parseCommandLine', 'parseCommandLineWorker',
  'getParsedCommandLineOfConfigFile', 'performCompilation', 'getDirectiveFromComment',
  'createCommentDirectivesMap', 'getBindAndCheckDiagnosticsForFileNoCache',
  'getMergedBindAndCheckDiagnostics', 'getDiagnosticsWithPrecedingDirectives',
  'markPrecedingCommentDirectiveLine', 'Unused_ts_expect_error_directive',
])

/** 只解析本机有界源码，不加载目标包；以完整 AST 节点提供可定位的局部事实，预算不足的节点不截断。 */
function captureCompilerExcerpts(path: string, content: string, budget: number): NonNullable<ToolEvidence['sourceExcerpts']> {
  const source = ts.createSourceFile(path, content, ts.ScriptTarget.Latest, false, ts.ScriptKind.JS)
  const sourceDigest = hash(content)
  const sourceBytes = Buffer.byteLength(content)
  const excerpts: NonNullable<ToolEvidence['sourceExcerpts']> = []
  const visit = (node: ts.Node): void => {
    const name = ts.isFunctionDeclaration(node) || ts.isPropertyAssignment(node) ? node.name : undefined
    if (name && (ts.isIdentifier(name) || ts.isStringLiteral(name)) && compilerEvidenceSymbols.has(name.text)) {
      const startOffset = node.getStart(source)
      const endOffset = node.end
      const text = content.slice(startOffset, endOffset)
      const bytes = Buffer.byteLength(text)
      if (bytes <= 65_536 && bytes <= budget && excerpts.length < 24) {
        excerpts.push({ path, sourceDigest, sourceBytes, symbol: name.text, startOffset, endOffset,
          startLine: source.getLineAndCharacterOfPosition(startOffset).line + 1,
          endLine: source.getLineAndCharacterOfPosition(endOffset - 1).line + 1,
          content: text, digest: hash(text) })
        budget -= bytes
        return
      }
    }
    ts.forEachChild(node, visit)
  }
  visit(source)
  return excerpts
}

/** 只读摘录 Vitest 的 CLI、配置及测试分流节点；budget 为剩余 UTF-8 字节，limit 为剩余条数，缺失节点保持未证明。 */
function captureVitestExcerpts(path: string, content: string, budget: number, limit: number): NonNullable<ToolEvidence['sourceExcerpts']> {
  if (!/^dist\/chunks\/(?:cac|cli-api|coverage|index)\.[^/]+\.js$/u.test(path)) return []
  const source = ts.createSourceFile(path, content, ts.ScriptTarget.Latest, false, ts.ScriptKind.JS)
  const symbols = new Set(['createCLI', 'run', 'start', 'startVitest', 'createVitest', 'VitestPlugin', 'WorkspaceVitestPlugin',
    'initializeProject', 'resolveProjects', 'resolveTestProjectConfigs', 'resolveDirectoryConfig', 'TestProject', 'Typechecker', 'resolveConfig$1'])
  const excerpts: NonNullable<ToolEvidence['sourceExcerpts']> = []
  /** 仅加入完整声明或连续的完整 import 声明组；预算不足保留缺口，不截取节点正文。 */
  const add = (symbol: string, startOffset: number, endOffset: number): void => {
    const text = content.slice(startOffset, endOffset)
    const bytes = Buffer.byteLength(text)
    if (bytes > 65_536 || bytes > budget || excerpts.length >= limit) return
    excerpts.push({ path, sourceDigest: hash(content), sourceBytes: Buffer.byteLength(content), symbol, startOffset, endOffset,
      startLine: source.getLineAndCharacterOfPosition(startOffset).line + 1,
      endLine: source.getLineAndCharacterOfPosition(endOffset - 1).line + 1, content: text, digest: hash(text) })
    budget -= bytes
  }
  const imports = source.statements.filter(ts.isImportDeclaration)
  // 保留关键模块的原样别名映射；index 大型报告模块仅提供完整 Typechecker，其他实现仍不可见。
  if (!path.startsWith('dist/chunks/index.') && imports.length) {
    const first = imports[0]!
    const last = imports.at(-1)!
    if (source.statements.slice(source.statements.indexOf(first), source.statements.indexOf(last) + 1).every(ts.isImportDeclaration)) add('imports', first.getStart(source), last.end)
  }
  for (const node of source.statements) {
    if ((ts.isFunctionDeclaration(node) || ts.isClassDeclaration(node)) && node.name && symbols.has(node.name.text)) add(node.name.text, node.getStart(source), node.end)
    if (ts.isVariableStatement(node)) {
      const declaration = node.declarationList.declarations.find(item => ts.isIdentifier(item.name) && ['cliApi', 'CONFIG_REGEXP'].includes(item.name.text))
      if (declaration && ts.isIdentifier(declaration.name)) add(declaration.name.text, node.getStart(source), node.end)
    }
    if (ts.isClassDeclaration(node) && node.name?.text === 'Vitest') {
      for (const member of node.members) if (ts.isMethodDeclaration(member) && ts.isIdentifier(member.name) && ['_setServer', 'resolveProjects'].includes(member.name.text)) add(`Vitest.${member.name.text}`, member.getStart(source), member.end)
    }
    if (ts.isExportDeclaration(node)) add('exports', node.getStart(source), node.end)
  }
  return excerpts
}

/** 只读冻结已安装且与声明最低版本一致的脚本工具；不安装或执行包，未解析依赖保留为证据缺口。 */
export async function captureVerificationToolEvidenceV3(root: string, manifest: RepositoryCommandManifest | undefined): Promise<ToolEvidence[]> {
  const tokens = verificationScriptTokens(manifest)
  // 使用命令的实际出现次序分配既有四工具预算，避免包名字母顺序挤掉较早调用的编译器。
  const priorities = new Map([...tokens].map((token, index) => [token, index]))
  const priority = (tool: ToolEvidence) => priorities.get(tool.binName)!
  const dependencies = { ...manifest?.dependencies, ...manifest?.devDependencies }
  const result: ToolEvidence[] = []
  for (const [name, range] of Object.entries(dependencies).sort(([a], [b]) => a.localeCompare(b))) {
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
          if (result.length === 4 && priorities.get(binName)! >= Math.max(...result.map(priority))) continue
          if (await realpath(join(modules, '.bin', binName)) !== await realpath(join(packageRoot, binPath))) continue
          const files: ToolEvidence['files'] = [{ path: 'package.json', digest: hash(packageText), content: packageText, truncated: false }]
          // 大型编译器只补充原样节点；完整文件仍列为 unavailable，局部证据与普通文件共享文本预算。
          const sourceExcerpts: NonNullable<ToolEvidence['sourceExcerpts']> = []
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
              let content = await read(path, name === 'vitest' && /\.[cm]?js$/u.test(path) ? 524_288 : 65_536)
              const vitestExcerpts = name === 'vitest' ? captureVitestExcerpts(path, content, 98_304 - bytes, 24 - sourceExcerpts.length) : []
              if (vitestExcerpts.length) {
                sourceExcerpts.push(...vitestExcerpts)
                bytes += vitestExcerpts.reduce((sum, item) => sum + Buffer.byteLength(item.content), 0)
                unavailablePaths.push(path)
                // 先沿摘录直接引用的配置和实现继续读取；原模块未提供的其余正文仍保持 unavailable。
                content = vitestExcerpts.map(item => item.content).join('\n')
              } else {
                if (Buffer.byteLength(content) > 65_536) throw new Error('Package source file exceeds the full-file budget')
                if (bytes + Buffer.byteLength(content) > 98_304) throw new Error('Package source budget exceeded')
                bytes += Buffer.byteLength(content)
                files.push({ path, digest: hash(content), content, truncated: false })
              }
              const referenced = [...content.matchAll(/(?:\bfrom\s*|\bimport\s*|\bimport\s*\(\s*)['"](\.[^'"]+)['"]/gu)]
                .map(match => relative(packageRoot, resolve(packageRoot, dirname(path), match[1]!)))
              if (name === 'vitest') {
                // CLI 运行链先于宽泛声明文件；在原 24 文件预算内优先保留发现规则，不扩大预算。
                const kinds = ['cli-api', 'defaults', 'coverage', 'index', 'constants']
                const rank = (value: string): number => {
                  const index = kinds.indexOf(/\/([^/.]+)\./u.exec(value)?.[1] ?? '')
                  return index < 0 ? kinds.length : index
                }
                queue.unshift(...referenced.sort((left, right) => rank(left) - rank(right)))
              } else queue.push(...referenced)
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
            } catch {
              unavailablePaths.push(path)
              if (name === 'typescript' && binName === 'tsc' && /\.[cm]?js$/u.test(path) && sourceExcerpts.length < 24) {
                try {
                  const content = await read(path, 8_388_608)
                  if (Buffer.byteLength(content) > 65_536) {
                    const captured = captureCompilerExcerpts(path, content, 98_304 - bytes).slice(0, 24 - sourceExcerpts.length)
                    sourceExcerpts.push(...captured)
                    bytes += captured.reduce((sum, item) => sum + Buffer.byteLength(item.content), 0)
                  }
                } catch { /* 路径、大小或解析不受支持时，继续保留完整文件的证据缺口。 */ }
              }
            }
          }
          // 预算耗尽仅表示尚未访问的依赖缺失；重复入队的已读取文件不能同时标为不可用。
          unavailablePaths.push(...queue.map(path => relative(packageRoot, resolve(packageRoot, path)).split(sep).join('/')).filter(path => !seen.has(path)))
          if (!files.some(file => file.path === relative(packageRoot, resolve(packageRoot, binPath)))) continue
          result.push({ packageName: name, declaredRange: range, version: installed.version, binName, entryPath: relative(packageRoot, resolve(packageRoot, binPath)).split(sep).join('/'), files: files.sort((a, b) => a.path.localeCompare(b.path)),
            ...(sourceExcerpts.length ? { sourceExcerpts } : {}), unavailablePaths: [...new Set(unavailablePaths)].sort() })
          result.sort((left, right) => priority(left) - priority(right))
          if (result.length > 4) result.pop()
          break
        }
      } catch { /* Absent or unsupported tools do not establish discovery. */ }
      break
    }
  }
  return result.sort((left, right) => left.packageName.localeCompare(right.packageName))
}
