import { lstat, readFile, realpath } from 'node:fs/promises'
import { isAbsolute, join, posix, relative, sep } from 'node:path'
import ts from 'typescript'
import type { RepositoryContextSnapshotV3Record, RepositoryEvidenceRetrievalReport } from '../types.js'
import { digestObject } from '../workflow.js'

const INDEX_VERSION = 'repository-evidence-index-v3.6.6'
const DEFAULT_SELECTION_LIMIT = 2_000
const PER_REQUIREMENT_LIMIT = 80
const MAX_INDEXED_SOURCE_BYTES = 512 * 1024
const DEFAULT_INDEX_FILE_LIMIT = 20_000
const DEFAULT_INDEX_BYTE_LIMIT = 64 * 1024 * 1024
const EXCLUDED_PATH = /(?:^|\/)(?:node_modules|vendor|dist|build|coverage|\.next|\.nuxt|\.output|target|out|generated|__generated__)(?:\/|$)/iu
const TEXT_EVIDENCE_PATH = /\.(?:ts|tsx|mts|cts|js|jsx|mjs|cjs|vue|json|ya?ml|toml|md|prisma|java|kt|kts|py|go|rs|sql|graphql|gql)$|(?:^|\/)(?:\.gitignore|\.npmignore|\.dockerignore)$/iu
const SOURCE_PATH = /\.(?:ts|tsx|mts|cts|js|jsx|mjs|cjs|vue|java|kt|kts|py|go|rs)$/iu
const STOP_TERMS = new Set(['the', 'and', 'for', 'with', 'from', 'this', 'that', 'must', 'should', 'when', 'then', 'into', '需求', '必须', '需要', '实现', '支持', '功能', '系统', '任务', '正确'])

/** 识别运行器默认、命名 profile 及共享 root/workspace 配置；仅保留原样源码，不推定配置被命令加载或测试已执行。 */
export function isVerificationConfigPathV3(path: string): boolean {
  return /(?:^|\/)(?:vite|vitest|jest|playwright|cypress)\.(?:(?:[A-Za-z0-9_-]+\.)?config|root|workspace)\.(?:[cm]?[jt]s|json)$/iu.test(path)
}

/** 只读提取运行器配置中的静态文件字面量及 resolve/join(__dirname, ...literals)；仅返回冻结库存内的文件，不执行配置或展开变量、glob。 */
export function referencedVerificationConfigPathsV3(path: string, content: string, paths: ReadonlySet<string>): string[] {
  if (!isVerificationConfigPathV3(path)) return []
  const result = new Set<string>()
  const add = (value: string): void => {
    if (isAbsolute(value) || value.includes('\\') || value.includes('\0')) return
    const target = posix.normalize(posix.join(posix.dirname(path), value))
    if (paths.has(target)) result.add(target)
  }
  const visit = (node: ts.Node): void => {
    if (ts.isStringLiteral(node)) add(node.text)
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && ['resolve', 'join'].includes(node.expression.text)
      && node.arguments.length > 1 && ts.isIdentifier(node.arguments[0]!) && node.arguments[0]!.text === '__dirname'
      && node.arguments.slice(1).every(ts.isStringLiteral)) {
      add(node.arguments.slice(1).map(argument => (argument as ts.StringLiteral).text).join('/'))
    }
    // 函数实参中的字面量不自动相对配置目录解析；只有上面明确的 __dirname 调用可建立路径。
    ts.forEachChild(node, child => { if (!ts.isCallExpression(node) || !ts.isStringLiteral(child)) visit(child) })
  }
  visit(ts.createSourceFile(path, content, ts.ScriptTarget.Latest))
  return [...result].sort()
}

type EvidenceCategory = 'source' | 'test' | 'schema' | 'migration' | 'workflow' | 'docs' | 'manifest' | 'other'

export interface RepositoryEvidenceRequirementInput {
  key: string
  statement: string
  acceptanceStatements: string[]
}

export interface BuildRepositoryEvidenceReportInput {
  projectId: string
  operationId: string
  repository: RepositoryContextSnapshotV3Record
  requirements: RepositoryEvidenceRequirementInput[]
  selectionLimit?: number
  indexFileLimit?: number
  indexByteLimit?: number
  createdAt?: string
}

interface IndexedFile {
  path: string
  digest: string
  category: EvidenceCategory
  content: string
  imports: string[]
}

interface ModuleResolutionConfig {
  baseUrl: string
  paths: Array<{ prefix: string; suffix: string; targets: string[] }>
}

interface RepositoryIndex {
  files: IndexedFile[]
  indexedBytes: number
  skippedFileCount: number
  fileBudgetExceeded: boolean
  byteBudgetExceeded: boolean
}

const INDEX_CACHE = new Map<string, RepositoryIndex>()

/** 线性去除路径末尾分隔符，避免重复斜杠引起正则回溯。 */
function normalizedRepositoryPath(path: string): string {
  const normalized = path.replace(/\\/g, '/').replace(/^\.\//u, '')
  let end = normalized.length
  while (end > 0 && normalized[end - 1] === '/') end--
  return normalized.slice(0, end)
}

function categoryForPath(path: string): EvidenceCategory {
  if (isVerificationConfigPathV3(path) || /(?:^|\/)(?:package\.json|tsconfig[^/]*\.json|pom\.xml|build\.gradle(?:\.kts)?|go\.mod|pyproject\.toml)$/iu.test(path)) return 'manifest'
  if (/(?:^|\/)(?:test|tests|__tests__|e2e|browser)(?:\/|$)|\.(?:spec|test)\.[^.]+$/iu.test(path)) return 'test'
  if (/\.prisma$|(?:^|\/)schemas?(?:\/|$)|\.(?:graphql|gql)$/iu.test(path)) return 'schema'
  if (/(?:^|\/)(?:migrations?|db\/migrate)(?:\/|$)|\.sql$/iu.test(path)) return 'migration'
  if (/(?:^|\/)\.github\/workflows(?:\/|$)|(?:^|\/)(?:ci|scripts?)(?:\/|$)/iu.test(path)) return 'workflow'
  if (/(?:^|\/)(?:AGENTS|README|CONTRIBUTING|SECURITY)(?:\.[^/]+)?\.md$|\.md$/iu.test(path)) return 'docs'
  if (SOURCE_PATH.test(path)) return 'source'
  return 'other'
}

function queryTerms(text: string): string[] {
  const raw = text.normalize('NFKC').match(/[A-Za-z_$][A-Za-z0-9_$.-]{2,}|[\p{Script=Han}]{2,}/gu) ?? []
  const expanded = raw.flatMap((term) => {
    const normalized = term.toLocaleLowerCase()
    const camelParts = term.replace(/([a-z])([A-Z])/gu, '$1 $2').toLocaleLowerCase().split(/[\s._-]/u).filter((part) => part.length >= 3)
    const hanParts = /^[\p{Script=Han}]+$/u.test(term) && term.length > 4
      ? Array.from({ length: term.length - 1 }, (_, index) => term.slice(index, index + 2))
      : []
    return [normalized, ...camelParts, ...hanParts]
  })
  return [...new Set(expanded.filter((term) => term.length >= 2 && !STOP_TERMS.has(term)))].sort()
}

async function readEvidenceFile(root: string, path: string): Promise<{ content: string; bytes: number } | undefined> {
  if (!TEXT_EVIDENCE_PATH.test(path)) return undefined
  const canonicalRoot = await realpath(root)
  const candidate = join(canonicalRoot, path)
  const info = await lstat(candidate)
  if (!info.isFile() || info.isSymbolicLink() || info.size > MAX_INDEXED_SOURCE_BYTES) return undefined
  const canonical = await realpath(candidate)
  const child = relative(canonicalRoot, canonical)
  if (child === '' || child === '..' || child.startsWith(`..${sep}`) || isAbsolute(child)) return undefined
  return { content: await readFile(canonical, 'utf8'), bytes: info.size }
}

function importedSpecifiers(content: string): string[] {
  const values: string[] = []
  // setup 常以副作用 import 初始化；它与具名导入、动态导入和 require 一样属于只读依赖。
  for (const match of content.matchAll(/(?:\bfrom\s*|\bimport\s*\(\s*|\brequire\s*\(\s*|\bimport\s+)['"]([^'"]+)['"]/gu)) {
    if (match[1] !== undefined) values.push(match[1])
  }
  return [...new Set(values)].sort()
}

/** 读取冻结 tsconfig 的单通配符别名；无效模式被忽略，不推导缺失的依赖事实。 */
function moduleResolutionConfig(indexed: IndexedFile[]): ModuleResolutionConfig {
  const config = indexed.find((file) => file.path === 'tsconfig.json')
  if (config === undefined) return { baseUrl: '.', paths: [] }
  const parsed = ts.parseConfigFileTextToJson(config.path, config.content)
  const options = parsed.config?.compilerOptions
  const baseUrl = typeof options?.baseUrl === 'string' ? normalizedRepositoryPath(options.baseUrl) || '.' : '.'
  const aliases = options?.paths !== null && typeof options?.paths === 'object' ? options.paths : {}
  const paths = Object.entries(aliases).flatMap(([pattern, rawTargets]) => {
    if (!Array.isArray(rawTargets) || rawTargets.some((target) => typeof target !== 'string')) return []
    // TypeScript paths 只允许一个通配符；无效模式不能产生伪造的依赖闭包。
    if (pattern.split('*').length > 2 || rawTargets.some(target => target.split('*').length > 2)) return []
    const star = pattern.indexOf('*')
    return [{ prefix: star < 0 ? pattern : pattern.slice(0, star), suffix: star < 0 ? '' : pattern.slice(star + 1), targets: rawTargets }]
  })
  return { baseUrl, paths }
}

/** 只解析冻结库存中的实际文件；通配值按字面量替换，不能解释为 replacement 模板。 */
function resolveImport(fromPath: string, specifier: string, paths: Set<string>, config: ModuleResolutionConfig): string | undefined {
  const bases: string[] = []
  if (specifier.startsWith('.')) {
    bases.push(normalizedRepositoryPath(posix.normalize(posix.join(posix.dirname(fromPath), specifier))))
  } else {
    for (const alias of config.paths) {
      if (!specifier.startsWith(alias.prefix) || !specifier.endsWith(alias.suffix)) continue
      const wildcard = specifier.slice(alias.prefix.length, specifier.length - alias.suffix.length || undefined)
      for (const target of alias.targets) bases.push(normalizedRepositoryPath(posix.normalize(posix.join(config.baseUrl, target.split('*').join(wildcard)))))
    }
  }
  const extensionPattern = /\.(?:[cm]?[jt]sx?|vue|json)$/u
  const normalizedBases = [...new Set(bases.flatMap((base) => extensionPattern.test(base) ? [base, base.replace(extensionPattern, '')] : [base]))]
  const candidates = normalizedBases.flatMap((base) => [base, ...['.ts', '.tsx', '.mts', '.cts', '.js', '.jsx', '.mjs', '.cjs', '.vue', '.json'].map((extension) => `${base}${extension}`), ...['index.ts', 'index.tsx', 'index.js', 'index.vue'].map((name) => `${base}/${name}`)])
  return candidates.find((candidate) => paths.has(candidate))
}

function regexEscape(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')
}

// Resolve only explicit, existing source targets from package exports. Manifest
// conditions remain source evidence; this does not select a runtime condition.
export function referencedPackageEntryPaths(files: Array<{ path: string; content: string }>, focus: string): string[] {
  const paths = new Set(files.map(file => file.path))
  const byPath = new Map(files.map(file => [file.path, file]))
  const linksToRequestedOwner = (entry: string): boolean => {
    const pending = [{ path: entry, depth: 0 }]
    const seen = new Set<string>()
    while (pending.length) {
      const current = pending.shift()!
      if (focus.includes(current.path)) return true
      if (current.depth >= 3 || seen.has(current.path)) continue
      seen.add(current.path)
      const source = ts.createSourceFile(current.path, byPath.get(current.path)?.content ?? '', ts.ScriptTarget.Latest)
      const exports = source.statements.flatMap(statement => ts.isExportDeclaration(statement) && statement.moduleSpecifier !== undefined && ts.isStringLiteral(statement.moduleSpecifier) ? [statement.moduleSpecifier.text] : [])
      for (const specifier of exports) {
        const path = resolveImport(current.path, specifier, paths, { baseUrl: '.', paths: [] })
        if (path !== undefined) pending.push({ path, depth: current.depth + 1 })
      }
    }
    return false
  }
  const entries = new Set<string>()
  for (const file of files.filter(file => /(?:^|\/)package\.json$/u.test(file.path))) {
    let manifest: { name?: unknown; exports?: unknown }
    try { manifest = JSON.parse(file.content) } catch { continue }
    if (typeof manifest?.name !== 'string' || manifest.exports === null || typeof manifest.exports !== 'object') continue
    for (const [key, value] of Object.entries(manifest.exports)) {
      if (!key.startsWith('.') || key.includes('*')) continue
      const specifier = manifest.name + (key === '.' ? '' : key.slice(1))
      const explicitlyNamed = new RegExp(`(?<![A-Za-z0-9_./-])${regexEscape(specifier)}(?![A-Za-z0-9_./-])`, 'u').test(focus)
      const visit = (target: unknown): void => {
        if (typeof target === 'string' && target.startsWith('./')) {
          const path = posix.normalize(posix.join(posix.dirname(file.path), target))
          if (paths.has(path) && SOURCE_PATH.test(path) && !EXCLUDED_PATH.test(path) && (explicitlyNamed || linksToRequestedOwner(path))) entries.add(path)
        } else if (target !== null && typeof target === 'object') {
          for (const child of Object.values(target)) visit(child)
        }
      }
      visit(value)
    }
  }
  return [...entries].sort()
}

function evidenceScore(file: IndexedFile, terms: string[]): { score: number; matchedTerms: string[] } {
  const pathText = file.path.toLocaleLowerCase()
  const contentText = file.content.toLocaleLowerCase()
  const matchedTerms = terms.filter((term) => pathText.includes(term) || contentText.includes(term))
  let score = matchedTerms.reduce((total, term) => total + (pathText.includes(term) ? 18 : 7) + (new RegExp(`(?:class|interface|function|type|const|let|var|model|route)\\s+${regexEscape(term)}\\b`, 'iu').test(file.content) ? 12 : 0), 0)
  if (file.category === 'source') score += matchedTerms.length > 0 ? 10 : 0
  if (file.category === 'test') score += matchedTerms.length > 0 ? 8 : 0
  if (file.category === 'schema' || file.category === 'migration') score += matchedTerms.length > 0 ? 6 : 0
  if (file.category === 'manifest' && matchedTerms.length > 0) score += 2
  return { score, matchedTerms }
}

function emptyCategoryCounts(): Record<EvidenceCategory, number> {
  return { source: 0, test: 0, schema: 0, migration: 0, workflow: 0, docs: 0, manifest: 0, other: 0 }
}

function logicalSourceStem(path: string): string {
  return posix.basename(path).replace(/\.(?:spec|test)(?=\.)/iu, '').replace(/\.[^.]+$/u, '').toLocaleLowerCase()
}

export async function buildRepositoryEvidenceRetrievalReportV3(input: BuildRepositoryEvidenceReportInput): Promise<RepositoryEvidenceRetrievalReport> {
  const selectionLimit = Math.min(DEFAULT_SELECTION_LIMIT, Math.max(1, input.selectionLimit ?? DEFAULT_SELECTION_LIMIT))
  const indexFileLimit = Math.min(DEFAULT_INDEX_FILE_LIMIT, Math.max(1, Math.trunc(input.indexFileLimit ?? DEFAULT_INDEX_FILE_LIMIT)))
  const indexByteLimit = Math.min(DEFAULT_INDEX_BYTE_LIMIT, Math.max(1, Math.trunc(input.indexByteLimit ?? DEFAULT_INDEX_BYTE_LIMIT)))
  const inventory = input.repository.workingFiles ?? input.repository.files
  const eligible = inventory.filter((file) => !EXCLUDED_PATH.test(file.path) && TEXT_EVIDENCE_PATH.test(file.path)).sort((left, right) => left.path.localeCompare(right.path))
  const inventoryDigest = digestObject(eligible.map((file) => ({ path: normalizedRepositoryPath(file.path), digest: file.digest })))
  const configurationDigest = digestObject(eligible.filter((file) => /(?:^|\/)(?:package\.json|tsconfig[^/]*\.json)$/iu.test(file.path)).map((file) => ({ path: normalizedRepositoryPath(file.path), digest: file.digest })))
  const cacheKey = digestObject({
    root: input.repository.canonicalRoot,
    headCommit: input.repository.headCommit,
    trackedTreeDigest: input.repository.trackedTreeDigest,
    dirtyDigest: input.repository.dirtyDigest,
    repositoryDigest: input.repository.repositoryDigest,
    inventoryDigest,
    configurationDigest,
    providerVersion: INDEX_VERSION,
    indexFileLimit,
    indexByteLimit,
  })
  let repositoryIndex = INDEX_CACHE.get(cacheKey)
  if (repositoryIndex === undefined) {
    const files: IndexedFile[] = []
    let indexedBytes = 0
    let skippedFileCount = 0
    let byteBudgetExceeded = false
    const candidates = eligible.slice(0, indexFileLimit)
    for (const file of candidates) {
      let loaded: { content: string; bytes: number } | undefined
      try { loaded = await readEvidenceFile(input.repository.canonicalRoot, file.path) } catch { loaded = undefined }
      if (loaded === undefined) { skippedFileCount += 1; continue }
      if (indexedBytes + loaded.bytes > indexByteLimit) { byteBudgetExceeded = true; break }
      indexedBytes += loaded.bytes
      files.push({ path: normalizedRepositoryPath(file.path), digest: file.digest, category: categoryForPath(file.path), content: loaded.content, imports: importedSpecifiers(loaded.content) })
    }
    if (INDEX_CACHE.size >= 8) INDEX_CACHE.delete(INDEX_CACHE.keys().next().value!)
    repositoryIndex = { files, indexedBytes, skippedFileCount, fileBudgetExceeded: eligible.length > candidates.length, byteBudgetExceeded }
    INDEX_CACHE.set(cacheKey, repositoryIndex)
  }
  const indexed = repositoryIndex.files
  const indexedByPath = new Map(indexed.map((file) => [file.path, file]))
  const pathSet = new Set(indexedByPath.keys())
  const resolution = moduleResolutionConfig(indexed)
  const dependencies = new Map<string, string[]>()
  const consumers = new Map<string, string[]>()
  for (const file of indexed) {
    const resolved = [...file.imports.map((specifier) => resolveImport(file.path, specifier, pathSet, resolution)).filter((path): path is string => path !== undefined),
      ...referencedVerificationConfigPathsV3(file.path, file.content, pathSet)]
    dependencies.set(file.path, [...new Set(resolved)].sort())
    for (const dependency of resolved) consumers.set(dependency, [...(consumers.get(dependency) ?? []), file.path])
  }
  const fullQuerySeeds = input.requirements.map((requirement) => ({ requirementKey: requirement.key, terms: queryTerms([requirement.statement, ...requirement.acceptanceStatements].join('\n')) }))
  // Keep the retrieval representation within its existing persisted contract.
  // Full requirement text still drives explicit-path selection below.
  const querySeeds = fullQuerySeeds.map(seed => ({ ...seed, terms: seed.terms.filter(term => term.length <= 240).slice(0, 200) }))
  const reducedQueryKeys = fullQuerySeeds.filter((seed, index) => seed.terms.length !== querySeeds[index]!.terms.length).map(seed => seed.requirementKey)
  const rankedByRequirement = new Map<string, Array<{ file: IndexedFile; score: number; matchedTerms: string[] }>>()
  for (const seed of querySeeds) {
    const requirement = input.requirements.find(item => item.key === seed.requirementKey)!
    const source = [requirement.statement, ...requirement.acceptanceStatements].join('\n')
    const ranked = indexed.map((file) => {
      const scored = evidenceScore(file, seed.terms)
      return { file, ...scored, score: scored.score + (source.includes(file.path) ? 10_000 : 0) }
    }).filter((item) => item.score > 0).sort((left, right) => right.score - left.score || left.file.path.localeCompare(right.file.path)).slice(0, PER_REQUIREMENT_LIMIT)
    // Reserve selection space for declaring modules before broad keyword
    // matches fill the cap. Previously 80 matches made graph expansion a no-op.
    const publicEntries = new Set(referencedPackageEntryPaths(indexed, source))
    const explicitEntries = [...ranked.filter(item => source.includes(item.file.path)), ...[...publicEntries].map(path => ({ file: indexedByPath.get(path)!, score: 10_000, matchedTerms: [] }))]
    const dependencyEntries = explicitEntries.length > 0 ? explicitEntries : ranked.slice(0, 20)
    const expanded = new Map(dependencyEntries.map((item) => [item.file.path, item]))
    const dependencyQueue = dependencyEntries.map(item => ({ path: item.file.path, depth: 0, score: item.score }))
    const visitedDependencies = new Set<string>()
    while (dependencyQueue.length > 0 && expanded.size < PER_REQUIREMENT_LIMIT) {
      const current = dependencyQueue.shift()!
      if (visitedDependencies.has(current.path) || current.depth >= 3) continue
      visitedDependencies.add(current.path)
      for (const path of dependencies.get(current.path) ?? []) {
        const score = Math.max(1, current.score - 5)
        if (!expanded.has(path)) expanded.set(path, { file: indexedByPath.get(path)!, score, matchedTerms: [] })
        dependencyQueue.push({ path, depth: current.depth + 1, score })
        if (expanded.size >= PER_REQUIREMENT_LIMIT) break
      }
    }
    for (const item of ranked) {
      if (expanded.size >= PER_REQUIREMENT_LIMIT) break
      if (!expanded.has(item.file.path)) expanded.set(item.file.path, item)
    }
    for (const item of ranked.slice(0, 20)) {
      const queue = [{ path: item.file.path, depth: 0 }]
      const visited = new Set<string>()
      while (queue.length > 0 && expanded.size < PER_REQUIREMENT_LIMIT) {
        const current = queue.shift()!
        if (visited.has(current.path) || current.depth >= 2) continue
        visited.add(current.path)
        const related = [...(dependencies.get(current.path) ?? []), ...(consumers.get(current.path) ?? [])]
        for (const relatedPath of related) {
          if (!expanded.has(relatedPath)) expanded.set(relatedPath, { file: indexedByPath.get(relatedPath)!, score: Math.max(1, item.score - 5 * (current.depth + 1)), matchedTerms: [] })
          queue.push({ path: relatedPath, depth: current.depth + 1 })
        }
      }
    }
    if (expanded.size === 0) {
      const sourceFiles = indexed.filter((file) => file.category === 'source')
      const testFiles = indexed.filter((file) => file.category === 'test')
      for (const source of sourceFiles) {
        const sourceStem = logicalSourceStem(source.path)
        const relatedTests = testFiles.filter((test) => logicalSourceStem(test.path) === sourceStem)
        if (relatedTests.length === 0) continue
        expanded.set(source.path, { file: source, score: 1, matchedTerms: [] })
        for (const test of relatedTests) expanded.set(test.path, { file: test, score: 1, matchedTerms: [] })
        if (expanded.size >= 20) break
      }
    }
    rankedByRequirement.set(seed.requirementKey, [...expanded.values()].sort((left, right) => right.score - left.score || left.file.path.localeCompare(right.file.path)).slice(0, PER_REQUIREMENT_LIMIT))
  }
  // 配置及其静态 setup/import 闭包不依赖需求词命中；沿用三层深度及总选取预算，缺失/动态路径仍不作推定。
  const mandatoryPaths = new Set(indexed.filter(file => file.category === 'manifest' || /(?:^|\/)AGENTS\.md$/iu.test(file.path)).map(file => file.path))
  const configQueue = indexed.filter(file => isVerificationConfigPathV3(file.path)).map(file => ({ path: file.path, depth: 0 }))
  const visitedConfigs = new Set<string>()
  while (configQueue.length && mandatoryPaths.size < selectionLimit) {
    const current = configQueue.shift()!
    if (visitedConfigs.has(current.path) || current.depth >= 3) continue
    visitedConfigs.add(current.path)
    for (const dependency of dependencies.get(current.path) ?? []) {
      mandatoryPaths.add(dependency)
      configQueue.push({ path: dependency, depth: current.depth + 1 })
      if (mandatoryPaths.size >= selectionLimit) break
    }
  }
  const mandatory = indexed.filter(file => mandatoryPaths.has(file.path)).map(file => ({ file, score: 1 }))
  const selected = new Map<string, { file: IndexedFile; score: number }>()
  for (let rank = 0; selected.size < selectionLimit && rank < PER_REQUIREMENT_LIMIT; rank += 1) {
    for (const seed of querySeeds) {
      const item = rankedByRequirement.get(seed.requirementKey)?.[rank]
      if (item === undefined) continue
      const existing = selected.get(item.file.path)
      if (existing === undefined || item.score > existing.score) selected.set(item.file.path, { file: item.file, score: item.score })
      if (selected.size >= selectionLimit) break
    }
  }
  for (const item of mandatory) {
    if (selected.size >= selectionLimit && !selected.has(item.file.path)) break
    selected.set(item.file.path, { file: item.file, score: Math.max(item.score, selected.get(item.file.path)?.score ?? 0) })
  }
  const selectedItems = [...selected.values()].sort((left, right) => right.score - left.score || left.file.path.localeCompare(right.file.path))
  const selectedPaths = new Set(selectedItems.map((item) => item.file.path))
  const requirementSelections = querySeeds.map((seed) => {
    const evidence = (rankedByRequirement.get(seed.requirementKey) ?? []).filter((item) => selectedPaths.has(item.file.path))
    const categoryCounts = emptyCategoryCounts()
    for (const item of evidence) categoryCounts[item.file.category] += 1
    return {
      requirementKey: seed.requirementKey,
      evidenceIds: evidence.map((item) => item.file.path),
      matchedTerms: [...new Set(evidence.flatMap((item) => item.matchedTerms))].sort(),
      categoryCounts,
    }
  })
  const missing = requirementSelections.filter((selection) => selection.evidenceIds.length === 0).map((selection) => selection.requirementKey)
  const weak = requirementSelections.filter((selection) => selection.evidenceIds.length > 0 && selection.categoryCounts.source + selection.categoryCounts.test + selection.categoryCounts.schema + selection.categoryCounts.migration === 0).map((selection) => selection.requirementKey)
  const structuralOnly = requirementSelections.filter((selection) => selection.evidenceIds.length > 0 && selection.matchedTerms.length === 0).map((selection) => selection.requirementKey)
  const indexIncomplete = repositoryIndex.fileBudgetExceeded || repositoryIndex.byteBudgetExceeded || repositoryIndex.skippedFileCount > 0
  const rankedPathCount = new Set([...mandatory.map((item) => item.file.path), ...[...rankedByRequirement.values()].flatMap((items) => items.map((item) => item.file.path))]).size
  const diagnostics = [
    ...(reducedQueryKeys.length === 0 ? [] : [{ code: 'repository-evidence-query-truncated', severity: 'warning' as const, message: 'Retrieval terms were reduced to the persisted 200-term/240-character limits; original Requirements and exact requested file paths remain intact.', subjectIds: reducedQueryKeys }]),
    ...(missing.length === 0 ? [] : [{ code: 'repository-evidence-requirement-missing', severity: 'blocking' as const, message: 'No repository evidence matched one or more in-scope Requirements.', subjectIds: missing }]),
    ...(!indexIncomplete ? [] : [{ code: 'repository-evidence-index-partial', severity: 'warning' as const, message: `Repository indexing was incomplete: ${indexed.length}/${eligible.length} eligible files and ${repositoryIndex.indexedBytes}/${indexByteLimit} allowed bytes were indexed; ${repositoryIndex.skippedFileCount} files were unreadable or exceeded the per-file limit.`, subjectIds: [] }]),
    ...(weak.length === 0 ? [] : [{ code: 'repository-evidence-semantic-surface-weak', severity: 'warning' as const, message: 'Some Requirements matched only documentation, manifests, or workflow surfaces; Binding must fail closed if it cannot identify a code owner.', subjectIds: weak }]),
    ...(structuralOnly.length === 0 ? [] : [{ code: 'repository-evidence-structural-fallback', severity: 'warning' as const, message: 'Some Requirements have no lexical owner match and use a source-test structural seed; Binding and Review must identify the actual owner before publication.', subjectIds: structuralOnly }]),
    ...(selected.size < rankedPathCount ? [{ code: 'repository-evidence-selection-truncated', severity: 'warning' as const, message: `Repository evidence was deterministically reduced to the ${selectionLimit}-file selection budget.`, subjectIds: [] }] : []),
  ]
  const status = missing.length > 0 ? 'blocked' as const : indexIncomplete || weak.length > 0 || structuralOnly.length > 0 ? 'partial' as const : 'ready' as const
  const core = {
    projectId: input.projectId,
    operationId: input.operationId,
    repositorySnapshotId: input.repository.id,
    repositoryDigest: input.repository.repositoryDigest,
    indexVersion: INDEX_VERSION,
    querySeeds,
    inspectedFileCount: inventory.length,
    eligibleFileCount: indexed.length,
    selectedEvidenceIds: selectedItems.map((item) => item.file.path),
    requirementSelections,
    selectionLimit,
    status,
    diagnostics,
  }
  return { id: `repository-evidence-report:${input.operationId}`, ...core, reportDigest: digestObject(core), createdAt: input.createdAt ?? new Date().toISOString() }
}
