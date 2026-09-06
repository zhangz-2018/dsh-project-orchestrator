import type { RepositoryContextSnapshotV3Record, RepositoryStackProfileRecord } from '../../types.js'

export type RepositorySemanticCapability = RepositoryStackProfileRecord['requiredSemanticCapabilities'][number]
export type RepositoryProviderCoverage = RepositoryStackProfileRecord['providerCoverage'][number]

export interface RepositoryProviderDetection {
  detected: boolean
  evidenceIds: string[]
  stackTags: string[]
}

export interface RepositoryProviderContext {
  repository: RepositoryContextSnapshotV3Record
  paths: string[]
  dependencies: Record<string, unknown>
  stackTags: Set<string>
  coverageByCapability: ReadonlyMap<RepositorySemanticCapability, RepositoryProviderCoverage>
}

export interface RepositoryProviderIndexResult {
  coverage: Array<{ capability: RepositorySemanticCapability; status: 'covered' | 'partial' | 'missing'; reason?: string }>
}

export interface RepositoryProviderQueryInput {
  repository: RepositoryContextSnapshotV3Record
  evidencePaths: string[]
  ownerSymbols: string[]
}

export interface RepositoryProviderEvidenceResult {
  ownerPathsBySymbol: Record<string, string[]>
}

export interface RepositorySemanticProvider {
  id: string
  version: string
  stackTags: string[]
  detect(context: RepositoryProviderContext): RepositoryProviderDetection
  capabilities(): RepositorySemanticCapability[]
  index(context: RepositoryProviderContext): Promise<RepositoryProviderIndexResult>
  query(input: RepositoryProviderQueryInput): Promise<RepositoryProviderEvidenceResult>
}

interface BuiltinProviderImplementations {
  parseScripts(root: string, paths: string[]): Promise<{ status: 'covered' | 'partial' | 'missing'; reason?: string }>
  parseVue(root: string, paths: string[], scriptStatus: 'covered' | 'partial' | 'missing'): Promise<{ status: 'covered' | 'partial' | 'missing'; reason?: string }>
  parsePrisma(root: string, paths: string[]): Promise<{ status: 'covered' | 'partial' | 'missing'; reason?: string }>
  queryScriptOwners(input: RepositoryProviderQueryInput): Promise<RepositoryProviderEvidenceResult>
}

const emptyQuery = async (): Promise<RepositoryProviderEvidenceResult> => ({ ownerPathsBySymbol: {} })

export function createBuiltinRepositorySemanticProviders(implementations: BuiltinProviderImplementations): RepositorySemanticProvider[] {
  return [
    {
      id: 'typescript-compiler-api', version: '5.8-v1', stackTags: ['typescript', 'javascript'],
      detect: (context) => {
        const evidenceIds = context.paths.filter((path) => /\.(?:ts|tsx|mts|cts|js|jsx|mjs|cjs)$/u.test(path))
        return { detected: evidenceIds.length > 0, evidenceIds, stackTags: evidenceIds.some((path) => /\.(?:ts|tsx|mts|cts)$/u.test(path)) ? ['typescript'] : ['javascript'] }
      },
      capabilities: () => ['symbols', 'relationships', 'consumers'],
      index: async (context) => {
        const paths = context.paths.filter((path) => /\.(?:ts|tsx|mts|cts|js|jsx|mjs|cjs)$/u.test(path))
        const result = await implementations.parseScripts(context.repository.canonicalRoot, paths)
        const capabilities: RepositorySemanticCapability[] = ['symbols', 'relationships', 'consumers']
        return { coverage: capabilities.map((capability) => ({ capability, ...result })) }
      },
      query: implementations.queryScriptOwners,
    },
    {
      id: 'typescript-vue-test-provider', version: '1.0.0', stackTags: ['typescript', 'javascript', 'vue', 'nuxt'],
      detect: (context) => {
        const evidenceIds = context.paths.filter((path) => /(?:^|\/)(?:test|tests|__tests__)(?:\/|$)|\.(?:spec|test)\.[^.]+$/u.test(path) && /\.(?:ts|tsx|mts|cts|js|jsx|mjs|cjs|vue)$/u.test(path))
        return { detected: evidenceIds.length > 0, evidenceIds, stackTags: [] }
      },
      capabilities: () => ['tests'],
      index: async (context) => {
        const tests = context.paths.filter((path) => /(?:^|\/)(?:test|tests|__tests__)(?:\/|$)|\.(?:spec|test)\.[^.]+$/u.test(path) && /\.(?:ts|tsx|mts|cts|js|jsx|mjs|cjs|vue)$/u.test(path))
        const scriptStatus = context.coverageByCapability.get('symbols')?.status
        const covered = tests.length > 0 && scriptStatus === 'covered'
        return { coverage: [{ capability: 'tests', status: covered ? 'covered' : tests.length > 0 ? 'partial' : 'missing', ...(!covered ? { reason: tests.length === 0 ? 'No supported repository test surface was found.' : 'Test files do not have complete semantic provider coverage.' } : {}) }] }
      },
      query: emptyQuery,
    },
    {
      id: 'manifest-command-provider', version: '1.0.0', stackTags: ['manifest'],
      detect: (context) => ({ detected: context.repository.verifiedCommands.length > 0, evidenceIds: context.paths.filter((path) => /(?:^|\/)(?:package\.json|pyproject\.toml|pom\.xml|build\.gradle(?:\.kts)?|go\.mod)$/u.test(path)), stackTags: [] }),
      capabilities: () => ['commands'],
      index: async (context) => ({ coverage: [{ capability: 'commands', status: context.repository.verifiedCommands.length > 0 ? 'covered' : 'missing', ...(context.repository.verifiedCommands.length > 0 ? {} : { reason: 'No verification command was declared by a trusted manifest.' }) }] }),
      query: emptyQuery,
    },
    {
      id: 'vue-nuxt-compiler-sfc', version: '3.5-v1', stackTags: ['vue', 'nuxt'],
      detect: (context) => {
        const evidenceIds = context.paths.filter((path) => path.endsWith('.vue'))
        const detected = evidenceIds.length > 0 || 'vue' in context.dependencies || 'nuxt' in context.dependencies
        return { detected, evidenceIds, stackTags: ['vue', ...('nuxt' in context.dependencies ? ['nuxt'] : [])] }
      },
      capabilities: () => ['routes'],
      index: async (context) => {
        const paths = context.paths.filter((path) => path.endsWith('.vue'))
        const result = await implementations.parseVue(context.repository.canonicalRoot, paths, context.coverageByCapability.get('symbols')?.status ?? 'missing')
        return { coverage: [{ capability: 'routes', ...result }] }
      },
      query: emptyQuery,
    },
    {
      id: '@prisma/get-dmmf', version: '7.10-v1', stackTags: ['prisma'],
      detect: (context) => {
        const evidenceIds = context.paths.filter((path) => path.endsWith('.prisma'))
        return { detected: evidenceIds.length > 0 || 'prisma' in context.dependencies || '@prisma/client' in context.dependencies, evidenceIds, stackTags: ['prisma'] }
      },
      capabilities: () => ['schema'],
      index: async (context) => {
        const result = await implementations.parsePrisma(context.repository.canonicalRoot, context.paths.filter((path) => path.endsWith('.prisma')))
        return { coverage: [{ capability: 'schema', ...result }] }
      },
      query: emptyQuery,
    },
  ]
}

export interface RepositoryProviderSupportMatrixEntry {
  providerId: string
  providerVersion: string
  stackTags: string[]
  capabilities: RepositorySemanticCapability[]
  support: 'supported' | 'unsupported'
  limitation?: string
}

export function repositoryProviderSupportMatrixV3(providers: RepositorySemanticProvider[]): RepositoryProviderSupportMatrixEntry[] {
  return [
    ...providers.map((provider) => ({ providerId: provider.id, providerVersion: provider.version, stackTags: [...provider.stackTags], capabilities: provider.capabilities(), support: 'supported' as const })),
    { providerId: 'python-provider', providerVersion: 'not-installed', stackTags: ['python'], capabilities: [], support: 'unsupported' as const, limitation: 'No production Python semantic provider is registered.' },
    { providerId: 'java-provider', providerVersion: 'not-installed', stackTags: ['java', 'spring'], capabilities: [], support: 'unsupported' as const, limitation: 'No production Java semantic provider is registered.' },
    { providerId: 'go-provider', providerVersion: 'not-installed', stackTags: ['go'], capabilities: [], support: 'unsupported' as const, limitation: 'No production Go semantic provider is registered.' },
  ].sort((left, right) => left.providerId.localeCompare(right.providerId))
}
