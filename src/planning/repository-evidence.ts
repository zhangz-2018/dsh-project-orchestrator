import { lstat, readFile, realpath } from 'node:fs/promises'
import { isAbsolute, join, posix, relative, sep } from 'node:path'
import type { RepositoryContextSnapshotV3Record, RepositoryEvidenceRetrievalReport } from '../types.js'
import { digestObject } from '../workflow.js'

const INDEX_VERSION = 'repository-evidence-index-v3.4.0'
const DEFAULT_SELECTION_LIMIT = 2_000
const PER_REQUIREMENT_LIMIT = 80
const MAX_INDEXED_SOURCE_BYTES = 512 * 1024
const EXCLUDED_PATH = /(?:^|\/)(?:node_modules|vendor|dist|build|coverage|\.next|\.nuxt|\.output|target|out|generated|__generated__)(?:\/|$)/iu
const TEXT_EVIDENCE_PATH = /\.(?:ts|tsx|mts|cts|js|jsx|mjs|cjs|vue|json|ya?ml|toml|md|prisma|java|kt|kts|py|go|rs|sql|graphql|gql)$/iu
const SOURCE_PATH = /\.(?:ts|tsx|mts|cts|js|jsx|mjs|cjs|vue|java|kt|kts|py|go|rs)$/iu
const STOP_TERMS = new Set(['the', 'and', 'for', 'with', 'from', 'this', 'that', 'must', 'should', 'when', 'then', 'into', '需求', '必须', '需要', '实现', '支持', '功能', '系统', '任务', '正确'])

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
  createdAt?: string
}

interface IndexedFile {
  path: string
  digest: string
  category: EvidenceCategory
  content: string
  imports: string[]
}

function normalizedRepositoryPath(path: string): string {
  return path.replace(/\\/g, '/').replace(/^\.\//u, '').replace(/\/+$/u, '')
}

function categoryForPath(path: string): EvidenceCategory {
  if (/(?:^|\/)(?:test|tests|__tests__|e2e|browser)(?:\/|$)|\.(?:spec|test)\.[^.]+$/iu.test(path)) return 'test'
  if (/\.prisma$|(?:^|\/)schemas?(?:\/|$)|\.(?:graphql|gql)$/iu.test(path)) return 'schema'
  if (/(?:^|\/)(?:migrations?|db\/migrate)(?:\/|$)|\.sql$/iu.test(path)) return 'migration'
  if (/(?:^|\/)\.github\/workflows(?:\/|$)|(?:^|\/)(?:ci|scripts?)(?:\/|$)/iu.test(path)) return 'workflow'
  if (/(?:^|\/)(?:AGENTS|README|CONTRIBUTING|SECURITY)(?:\.[^/]+)?\.md$|\.md$/iu.test(path)) return 'docs'
  if (/(?:^|\/)(?:package\.json|tsconfig[^/]*\.json|pom\.xml|build\.gradle(?:\.kts)?|go\.mod|pyproject\.toml)$/iu.test(path)) return 'manifest'
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

async function readEvidenceFile(root: string, path: string): Promise<string | undefined> {
  if (!TEXT_EVIDENCE_PATH.test(path)) return undefined
  const canonicalRoot = await realpath(root)
  const candidate = join(canonicalRoot, path)
  const info = await lstat(candidate)
  if (!info.isFile() || info.isSymbolicLink() || info.size > MAX_INDEXED_SOURCE_BYTES) return undefined
  const canonical = await realpath(candidate)
  const child = relative(canonicalRoot, canonical)
  if (child === '' || child === '..' || child.startsWith(`..${sep}`) || isAbsolute(child)) return undefined
  return readFile(canonical, 'utf8')
}

function importedSpecifiers(content: string): string[] {
  const values: string[] = []
  for (const match of content.matchAll(/(?:\bfrom\s*|\bimport\s*\(|\brequire\s*\()\s*['"]([^'"]+)['"]/gu)) {
    if (match[1]?.startsWith('.')) values.push(match[1])
  }
  return [...new Set(values)].sort()
}

function resolveImport(fromPath: string, specifier: string, paths: Set<string>): string | undefined {
  const base = normalizedRepositoryPath(posix.normalize(posix.join(posix.dirname(fromPath), specifier)))
  const candidates = [base, ...['.ts', '.tsx', '.mts', '.cts', '.js', '.jsx', '.mjs', '.cjs', '.vue', '.json'].map((extension) => `${base}${extension}`), ...['index.ts', 'index.tsx', 'index.js', 'index.vue'].map((name) => `${base}/${name}`)]
  return candidates.find((candidate) => paths.has(candidate))
}

function regexEscape(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')
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
  const inventory = input.repository.workingFiles ?? input.repository.files
  const eligible = inventory.filter((file) => !EXCLUDED_PATH.test(file.path) && TEXT_EVIDENCE_PATH.test(file.path)).sort((left, right) => left.path.localeCompare(right.path))
  const indexed: IndexedFile[] = []
  for (const file of eligible) {
    let content: string | undefined
    try { content = await readEvidenceFile(input.repository.canonicalRoot, file.path) } catch { content = undefined }
    if (content === undefined) continue
    indexed.push({ path: normalizedRepositoryPath(file.path), digest: file.digest, category: categoryForPath(file.path), content, imports: importedSpecifiers(content) })
  }
  const indexedByPath = new Map(indexed.map((file) => [file.path, file]))
  const pathSet = new Set(indexedByPath.keys())
  const querySeeds = input.requirements.map((requirement) => ({ requirementKey: requirement.key, terms: queryTerms([requirement.statement, ...requirement.acceptanceStatements].join('\n')) }))
  const rankedByRequirement = new Map<string, Array<{ file: IndexedFile; score: number; matchedTerms: string[] }>>()
  for (const seed of querySeeds) {
    const ranked = indexed.map((file) => ({ file, ...evidenceScore(file, seed.terms) })).filter((item) => item.score > 0).sort((left, right) => right.score - left.score || left.file.path.localeCompare(right.file.path)).slice(0, PER_REQUIREMENT_LIMIT)
    const expanded = new Map(ranked.map((item) => [item.file.path, item]))
    for (const item of ranked.slice(0, 20)) {
      for (const specifier of item.file.imports) {
        const dependency = resolveImport(item.file.path, specifier, pathSet)
        if (dependency === undefined || expanded.has(dependency)) continue
        expanded.set(dependency, { file: indexedByPath.get(dependency)!, score: Math.max(1, item.score - 5), matchedTerms: [] })
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
  const mandatory = indexed.filter((file) => file.category === 'manifest' || /(?:^|\/)AGENTS\.md$/iu.test(file.path)).map((file) => ({ file, score: 1 }))
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
  const rankedPathCount = new Set([...mandatory.map((item) => item.file.path), ...[...rankedByRequirement.values()].flatMap((items) => items.map((item) => item.file.path))]).size
  const diagnostics = [
    ...(missing.length === 0 ? [] : [{ code: 'repository-evidence-requirement-missing', severity: 'blocking' as const, message: 'No repository evidence matched one or more in-scope Requirements.', subjectIds: missing }]),
    ...(weak.length === 0 ? [] : [{ code: 'repository-evidence-semantic-surface-weak', severity: 'warning' as const, message: 'Some Requirements matched only documentation, manifests, or workflow surfaces; Binding must fail closed if it cannot identify a code owner.', subjectIds: weak }]),
    ...(structuralOnly.length === 0 ? [] : [{ code: 'repository-evidence-structural-fallback', severity: 'warning' as const, message: 'Some Requirements have no lexical owner match and use a source-test structural seed; Binding and Review must identify the actual owner before publication.', subjectIds: structuralOnly }]),
    ...(selected.size < rankedPathCount ? [{ code: 'repository-evidence-selection-truncated', severity: 'warning' as const, message: `Repository evidence was deterministically reduced to the ${selectionLimit}-file selection budget.`, subjectIds: [] }] : []),
  ]
  const status = missing.length > 0 ? 'blocked' as const : weak.length > 0 || structuralOnly.length > 0 ? 'partial' as const : 'ready' as const
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
