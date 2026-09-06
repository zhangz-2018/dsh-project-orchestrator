import { lstat, readFile, realpath } from 'node:fs/promises'
import { isAbsolute, join, relative, sep } from 'node:path'
import { getDMMF } from '@prisma/get-dmmf'
import { compileScript, parse as parseVueSfc } from '@vue/compiler-sfc'
import ts from 'typescript'
import type { ProjectRecord, RepositoryContextSnapshotV3Record, RepositoryStackProfileRecord } from '../types.js'
import { boundedText, digestObject } from '../workflow.js'
import { createBuiltinRepositorySemanticProviders, repositoryProviderSupportMatrixV3, type RepositoryProviderContext, type RepositorySemanticProvider } from './providers/index.js'

const MAX_SCRIPT_FILES = 2_000
const MAX_VUE_FILES = 1_000
const MAX_PRISMA_FILES = 100
const MAX_SOURCE_BYTES = 2 * 1024 * 1024
const MAX_PRISMA_TOTAL_BYTES = 4 * 1024 * 1024
const PYTHON_STACK_MARKERS = ['pyproject.toml', 'requirements.txt', 'setup.py', 'setup.cfg', 'Pipfile', 'poetry.lock']

type Coverage = RepositoryStackProfileRecord['providerCoverage'][number]
type ParseResult = { status: 'covered' | 'partial' | 'missing'; reason?: string }

interface RepositoryStackProfileInput {
  project: Pick<ProjectRecord, 'id'>
  operationId: string
  repository: RepositoryContextSnapshotV3Record
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

async function readCanonicalSource(root: string, path: string): Promise<string> {
  const candidate = join(root, path)
  const info = await lstat(candidate)
  if (!info.isFile() || info.isSymbolicLink()) throw new Error('path is not a regular non-symlink file')
  if (info.size > MAX_SOURCE_BYTES) throw new Error(`file exceeds the ${MAX_SOURCE_BYTES}-byte provider limit`)
  const canonical = await realpath(candidate)
  const child = relative(root, canonical)
  if (child === '' || child === '..' || child.startsWith(`..${sep}`) || isAbsolute(child)) throw new Error('path resolves outside the canonical repository root')
  return readFile(canonical, 'utf8')
}

async function parseScriptSources(root: string, paths: string[]): Promise<ParseResult> {
  if (paths.length === 0) return { status: 'missing', reason: 'No TypeScript or JavaScript source files were found.' }
  if (paths.length > MAX_SCRIPT_FILES) return { status: 'partial', reason: `Script provider limit exceeded ${MAX_SCRIPT_FILES} source files.` }
  const failures: string[] = []
  for (const path of paths) {
    try {
      const result = ts.transpileModule(await readCanonicalSource(root, path), {
        fileName: path,
        reportDiagnostics: true,
        compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, jsx: ts.JsxEmit.Preserve, allowJs: true },
      })
      if ((result.diagnostics ?? []).some((diagnostic) => diagnostic.category === ts.DiagnosticCategory.Error)) failures.push(`${path} (syntax error)`)
    } catch (error) {
      failures.push(`${path} (${boundedText(errorMessage(error), 200)})`)
    }
  }
  return failures.length === 0 ? { status: 'covered' } : { status: 'partial', reason: `${failures.length} script files could not be parsed safely: ${failures.slice(0, 5).join(', ')}.` }
}

function declaredScriptSymbols(source: ts.SourceFile): Set<string> {
  const symbols = new Set<string>()
  const addName = (name: ts.DeclarationName | undefined, prefix?: string): void => {
    if (name === undefined) return
    const value = ts.isIdentifier(name) || ts.isStringLiteral(name) || ts.isNumericLiteral(name) ? name.text : undefined
    if (value === undefined || value === '') return
    symbols.add(value)
    if (prefix !== undefined) symbols.add(`${prefix}.${value}`)
  }
  for (const statement of source.statements) {
    if (ts.isClassDeclaration(statement) || ts.isInterfaceDeclaration(statement) || ts.isEnumDeclaration(statement)) {
      const container = statement.name?.text
      addName(statement.name)
      if (container !== undefined && 'members' in statement) {
        for (const member of statement.members) addName(member.name, container)
      }
      continue
    }
    if (ts.isFunctionDeclaration(statement) || ts.isTypeAliasDeclaration(statement)) {
      addName(statement.name)
      continue
    }
    if (ts.isVariableStatement(statement)) {
      for (const declaration of statement.declarationList.declarations) {
        if (ts.isIdentifier(declaration.name)) symbols.add(declaration.name.text)
      }
    }
  }
  return symbols
}

export async function mapRepositoryOwnerSymbolsV3(
  root: string,
  bindings: Array<{ key: string; evidencePaths: string[]; ownerSymbols: string[] }>,
): Promise<Record<string, Record<string, string[]>>> {
  const result: Record<string, Record<string, string[]>> = {}
  for (const binding of bindings) {
    const requested = new Set(binding.ownerSymbols)
    const pathsBySymbol = new Map<string, string[]>()
    for (const path of [...new Set(binding.evidencePaths)].filter((candidate) => /\.(?:ts|tsx|mts|cts|js|jsx|mjs|cjs)$/u.test(candidate)).sort()) {
      let source: ts.SourceFile
      try {
        const scriptKind = /\.(?:tsx|jsx)$/u.test(path) ? ts.ScriptKind.TSX : /\.(?:js|jsx|mjs|cjs)$/u.test(path) ? ts.ScriptKind.JS : ts.ScriptKind.TS
        source = ts.createSourceFile(path, await readCanonicalSource(root, path), ts.ScriptTarget.ES2022, false, scriptKind)
      } catch {
        continue
      }
      const declared = declaredScriptSymbols(source)
      for (const symbol of requested) {
        if (!declared.has(symbol)) continue
        pathsBySymbol.set(symbol, [...(pathsBySymbol.get(symbol) ?? []), path])
      }
    }
    result[binding.key] = Object.fromEntries([...pathsBySymbol.entries()].map(([symbol, paths]) => [symbol, [...new Set(paths)].sort()]))
  }
  return result
}

async function parseVueSources(root: string, paths: string[], scriptStatus: ParseResult['status']): Promise<ParseResult> {
  if (paths.length > MAX_VUE_FILES) return { status: 'partial', reason: `Vue provider limit exceeded ${MAX_VUE_FILES} SFC files.` }
  const failures: string[] = []
  for (const path of paths) {
    try {
      const parsed = parseVueSfc(await readCanonicalSource(root, path), { filename: path, sourceMap: false })
      if (parsed.errors.length > 0) {
        failures.push(`${path} (${parsed.errors.map(errorMessage).slice(0, 2).join('; ')})`)
        continue
      }
      const { script, scriptSetup } = parsed.descriptor
      if (script?.src !== undefined || scriptSetup?.src !== undefined) {
        failures.push(`${path} (external script src is not supported by the frozen SFC provider)`)
        continue
      }
      const languages = [script?.lang, scriptSetup?.lang].filter((value): value is string => value !== undefined)
      if (languages.some((language) => !['js', 'jsx', 'ts', 'tsx'].includes(language))) {
        failures.push(`${path} (unsupported SFC script language)`)
        continue
      }
      if (script !== null || scriptSetup !== null) compileScript(parsed.descriptor, { id: digestObject({ path }).slice(0, 12), sourceMap: false })
    } catch (error) {
      failures.push(`${path} (${boundedText(errorMessage(error), 200)})`)
    }
  }
  if (failures.length > 0) return { status: 'partial', reason: `${failures.length} Vue SFC files could not be parsed safely: ${failures.slice(0, 5).join(', ')}.` }
  if (scriptStatus !== 'covered') return { status: 'partial', reason: 'Vue/Nuxt route scripts do not have complete TypeScript Compiler API coverage.' }
  return { status: 'covered' }
}

async function parsePrismaSources(root: string, paths: string[]): Promise<ParseResult> {
  if (paths.length === 0) return { status: 'missing', reason: 'Prisma was declared but no .prisma schema file was found.' }
  if (paths.length > MAX_PRISMA_FILES) return { status: 'partial', reason: `Prisma provider limit exceeded ${MAX_PRISMA_FILES} schema files.` }
  try {
    const sources: Array<[filename: string, content: string]> = []
    let totalBytes = 0
    for (const path of paths) {
      const source = await readCanonicalSource(root, path)
      totalBytes += Buffer.byteLength(source)
      if (totalBytes > MAX_PRISMA_TOTAL_BYTES) throw new Error(`combined schemas exceed the ${MAX_PRISMA_TOTAL_BYTES}-byte provider limit`)
      sources.push([path, source])
    }
    const dmmf = getDMMF({ datamodel: sources })
    if ('error' in dmmf) throw dmmf.error
    for (const model of dmmf.datamodel.models) {
      for (const field of model.fields) {
        if (field.kind === 'object' && field.relationName === undefined) throw new Error(`relation field ${model.name}.${field.name} has no semantic relation identity`)
      }
    }
    return { status: 'covered' }
  } catch (error) {
    return { status: 'partial', reason: `Prisma schema semantic parsing failed: ${boundedText(errorMessage(error), 1_500)}.` }
  }
}

function isAuxiliaryLanguagePath(path: string): boolean {
  return /^(?:scripts?|tools?)(?:\/|$)/u.test(path)
}

function builtinProviders(): RepositorySemanticProvider[] {
  return createBuiltinRepositorySemanticProviders({
    parseScripts: parseScriptSources,
    parseVue: parseVueSources,
    parsePrisma: parsePrismaSources,
    queryScriptOwners: async (input) => {
      const projection = await mapRepositoryOwnerSymbolsV3(input.repository.canonicalRoot, [{ key: 'QUERY', evidencePaths: input.evidencePaths, ownerSymbols: input.ownerSymbols }])
      return { ownerPathsBySymbol: projection.QUERY ?? {} }
    },
  })
}

export function getRepositoryProviderSupportMatrixV3() {
  return repositoryProviderSupportMatrixV3(builtinProviders())
}

export async function buildRepositoryStackProfileV3(input: RepositoryStackProfileInput): Promise<RepositoryStackProfileRecord> {
  const { project, operationId, repository } = input
  const paths = (repository.workingFiles ?? repository.files).map((item) => item.path).sort()
  const pathSet = new Set(paths)
  let packageManifest: { dependencies?: Record<string, unknown>; devDependencies?: Record<string, unknown> } | undefined
  if (pathSet.has('package.json')) {
    try { packageManifest = JSON.parse(await readCanonicalSource(repository.canonicalRoot, 'package.json')) as typeof packageManifest } catch { packageManifest = undefined }
  }
  const dependencies = { ...(packageManifest?.dependencies ?? {}), ...(packageManifest?.devDependencies ?? {}) }
  const typescriptPaths = paths.filter((path) => /\.(?:ts|tsx|mts|cts)$/u.test(path))
  const javascriptPaths = paths.filter((path) => /\.(?:js|jsx|mjs|cjs)$/u.test(path))
  const scriptPaths = [...typescriptPaths, ...javascriptPaths].sort()
  const vuePaths = paths.filter((path) => path.endsWith('.vue'))
  const prismaPaths = paths.filter((path) => path.endsWith('.prisma'))
  const pythonPaths = paths.filter((path) => path.endsWith('.py'))
  const javaPaths = paths.filter((path) => path.endsWith('.java'))
  const goPaths = paths.filter((path) => path.endsWith('.go'))
  const testPaths = paths.filter((path) => /(?:^|\/)(?:test|tests|__tests__)(?:\/|$)|\.(?:spec|test)\.[^.]+$/u.test(path) && /\.(?:ts|tsx|mts|cts|js|jsx|mjs|cjs|vue)$/u.test(path))
  const hasNuxt = 'nuxt' in dependencies
  const hasVue = hasNuxt || 'vue' in dependencies || vuePaths.length > 0
  const hasReact = 'react' in dependencies
  const hasPrisma = 'prisma' in dependencies || '@prisma/client' in dependencies || prismaPaths.length > 0
  const pythonStackMarkers = PYTHON_STACK_MARKERS.filter((path) => pathSet.has(path))
  const primaryPythonPaths = pythonPaths.filter((path) => !isAuxiliaryLanguagePath(path))
  const auxiliaryPythonPaths = pythonPaths.filter(isAuxiliaryLanguagePath)
  const packageEvidence = pathSet.has('package.json') ? ['package.json'] : []
  const languages = [
    ...(typescriptPaths.length === 0 ? [] : [{ id: 'typescript', evidenceIds: typescriptPaths }]),
    ...(javascriptPaths.length === 0 ? [] : [{ id: 'javascript', evidenceIds: javascriptPaths }]),
    ...(pythonPaths.length === 0 ? [] : [{ id: 'python', evidenceIds: pythonPaths }]),
    ...(javaPaths.length === 0 && !pathSet.has('pom.xml') && !pathSet.has('build.gradle') && !pathSet.has('build.gradle.kts') ? [] : [{ id: 'java', evidenceIds: [...javaPaths, ...['pom.xml', 'build.gradle', 'build.gradle.kts'].filter((path) => pathSet.has(path))] }]),
    ...(goPaths.length === 0 && !pathSet.has('go.mod') ? [] : [{ id: 'go', evidenceIds: [...goPaths, ...['go.mod'].filter((path) => pathSet.has(path))] }]),
  ]
  const frameworks = [
    ...(hasNuxt ? [{ id: 'nuxt', evidenceIds: [...packageEvidence, ...vuePaths] }] : []),
    ...(hasVue ? [{ id: 'vue', evidenceIds: [...packageEvidence, ...vuePaths] }] : []),
    ...(hasReact ? [{ id: 'react', evidenceIds: [...packageEvidence, ...typescriptPaths.filter((path) => path.endsWith('.tsx')), ...javascriptPaths.filter((path) => path.endsWith('.jsx'))] }] : []),
  ]
  const dataLayers = hasPrisma ? [{ id: 'prisma', evidenceIds: [...packageEvidence, ...prismaPaths, ...paths.filter((path) => path.startsWith('prisma/migrations/'))] }] : []
  const requiredSemanticCapabilities: RepositoryStackProfileRecord['requiredSemanticCapabilities'] = [...new Set([
    'symbols' as const, 'relationships' as const, 'consumers' as const, 'tests' as const, 'commands' as const,
    ...(hasVue ? ['routes' as const] : []), ...(hasPrisma ? ['schema' as const] : []),
  ])]
  const providerCoverage: RepositoryStackProfileRecord['providerCoverage'] = []
  const coverageByCapability = new Map<RepositoryStackProfileRecord['requiredSemanticCapabilities'][number], Coverage>()
  const providers = builtinProviders()
  for (const provider of providers) {
    const context: RepositoryProviderContext = { repository, paths, dependencies, stackTags: new Set([...languages.map((item) => item.id), ...frameworks.map((item) => item.id), ...dataLayers.map((item) => item.id)]), coverageByCapability }
    const detection = provider.detect(context)
    if (!detection.detected && !['typescript-compiler-api', 'typescript-vue-test-provider', 'manifest-command-provider'].includes(provider.id)) continue
    const result = await provider.index(context)
    for (const item of result.coverage) {
      const record: Coverage = { capability: item.capability, providerId: provider.id, providerVersion: provider.version, status: item.status, ...(item.reason === undefined ? {} : { reason: item.reason }) }
      providerCoverage.push(record)
      coverageByCapability.set(item.capability, record)
    }
  }
  const unsupportedStacks = [
    ...(pythonStackMarkers.length > 0 || primaryPythonPaths.length > 0 ? ['python'] : []),
    ...(javaPaths.length > 0 || pathSet.has('pom.xml') || pathSet.has('build.gradle') || pathSet.has('build.gradle.kts') ? ['java'] : []),
    ...(goPaths.length > 0 || pathSet.has('go.mod') ? ['go'] : []),
  ]
  const coveredCapabilities = new Set(providerCoverage.filter((item) => item.status === 'covered').map((item) => item.capability))
  const missingCapabilities = requiredSemanticCapabilities.filter((capability) => !coveredCapabilities.has(capability))
  const supportStatus: RepositoryStackProfileRecord['supportStatus'] = unsupportedStacks.length > 0 || typescriptPaths.length === 0 ? 'unsupported' : missingCapabilities.length > 0 ? 'partial' : 'supported'
  const diagnostics: RepositoryStackProfileRecord['diagnostics'] = [
    ...(unsupportedStacks.length === 0 && typescriptPaths.length > 0 ? [] : [{ code: 'unsupported-stack', severity: 'blocking' as const, message: unsupportedStacks.length > 0 ? `Unsupported repository stack detected: ${unsupportedStacks.join(', ')}.` : 'Planning V3 candidate requires a supported TypeScript repository.', subjectIds: unsupportedStacks }]),
    ...(supportStatus !== 'partial' ? [] : [{ code: 'repository-provider-incomplete', severity: 'blocking' as const, message: `Required semantic provider coverage is incomplete: ${missingCapabilities.join(', ')}. ${providerCoverage.filter((item) => item.status !== 'covered').map((item) => `${item.capability}: ${item.reason ?? item.status}`).join('; ')}`, subjectIds: missingCapabilities }]),
    ...(auxiliaryPythonPaths.length === 0 || unsupportedStacks.includes('python') ? [] : [{ code: 'repository-auxiliary-language-uncovered', severity: 'warning' as const, message: 'Auxiliary Python scripts are inventoried but are outside the supported semantic planning surface. Plans and bindings must remain within the covered TypeScript/JavaScript stack.', subjectIds: auxiliaryPythonPaths.slice(0, 100) }]),
  ]
  const core = { projectId: project.id, operationId, repositorySnapshotId: repository.id, languages, frameworks, dataLayers, requiredSemanticCapabilities, providerCoverage, supportStatus, supportPolicyVersion: 'repository-stack-support-v3.4.0', diagnostics }
  return { id: `repository-stack-profile:${operationId}`, ...core, stackProfileDigest: digestObject(core), createdAt: new Date().toISOString() }
}
