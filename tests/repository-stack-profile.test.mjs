import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdir, mkdtemp, realpath, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { buildRepositoryStackProfileV3, getRepositoryProviderSupportMatrixV3, mapRepositoryOwnerSymbolsV3 } from '../lib/index.js'

const digest = 'a'.repeat(64)

async function writeRepositoryFile(root, path, content) {
  await mkdir(dirname(join(root, path)), { recursive: true })
  await writeFile(join(root, path), content)
}

async function profile(root, files, operationId = 'op-stack') {
  const canonicalRoot = await realpath(root)
  return buildRepositoryStackProfileV3({
    project: { id: 'project-stack' },
    operationId,
    repository: {
      id: `repo:${operationId}`,
      projectId: 'project-stack',
      operationId,
      canonicalRoot,
      headCommit: 'b'.repeat(40),
      trackedTreeDigest: digest,
      dirtyDigest: digest,
      repositoryDigest: digest,
      files: files.map((path) => ({ path, digest })),
      workingFiles: files.map((path) => ({ path, digest })),
      dirtyFiles: [],
      verifiedCommands: ['pnpm run test'],
      status: 'ready',
      diagnostics: [],
      createdAt: '2026-08-28T00:00:00.000Z',
    },
  })
}

const validPrismaSchema = `datasource db {
  provider = "postgresql"
}

model User {
  id    Int    @id
  posts Post[]
}

model Post {
  id     Int  @id
  author User @relation(fields: [authorId], references: [id])
  authorId Int
}
`

test('Repository Provider support matrix declares versions, capabilities, and unsupported stacks', () => {
  const matrix = getRepositoryProviderSupportMatrixV3()
  assert.equal(matrix.some((entry) => entry.providerId === 'typescript-compiler-api' && entry.support === 'supported' && entry.capabilities.includes('symbols')), true)
  assert.equal(matrix.some((entry) => entry.providerId === '@prisma/get-dmmf' && entry.support === 'supported' && entry.capabilities.includes('schema')), true)
  assert.equal(matrix.some((entry) => entry.providerId === 'java-provider' && entry.support === 'unsupported' && entry.limitation), true)
  assert.equal(matrix.every((entry) => entry.providerVersion.length > 0), true)
})

test('Repository symbol projection resolves declaration owners through the TypeScript parser', async () => {
  const root = await mkdtemp(join(tmpdir(), 'po-owner-symbols-'))
  try {
    await writeRepositoryFile(root, 'src/service.ts', 'export class OrchestratorService {\n  getProjectPlanningV3() { return true }\n}\n')
    await writeRepositoryFile(root, 'src/client-types.ts', 'export interface ProjectPlanningV3View { stageAttempts: unknown[] }\n')
    await writeRepositoryFile(root, 'src/unrelated.ts', 'export class UnrelatedService {\n  getProjectPlanningV3() { return false }\n}\n')
    const canonicalRoot = await realpath(root)
    const result = await mapRepositoryOwnerSymbolsV3(canonicalRoot, [{
      key: 'BIND-REQ-001',
      evidencePaths: ['src/service.ts', 'src/client-types.ts', 'src/unrelated.ts'],
      ownerSymbols: ['OrchestratorService', 'OrchestratorService.getProjectPlanningV3', 'ProjectPlanningV3View', 'MissingOwner'],
    }])
    assert.deepEqual(result['BIND-REQ-001'], {
      OrchestratorService: ['src/service.ts'],
      'OrchestratorService.getProjectPlanningV3': ['src/service.ts'],
      ProjectPlanningV3View: ['src/client-types.ts'],
    })
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('Repository StackProfile supports the declared TypeScript, Vue, Nuxt, and Prisma subsets with real parsers', async () => {
  const variants = [
    { name: 'typescript', dependencies: {}, extra: {} },
    { name: 'vue', dependencies: { vue: '^3.5.0' }, extra: { 'src/App.vue': '<template><main>{{ count }}</main></template>\n<script setup lang="ts">\nconst count: number = 1\n</script>\n' } },
    { name: 'nuxt', dependencies: { nuxt: '^4.0.0' }, extra: { 'app/pages/index.vue': '<template><main>Home</main></template>\n<script setup lang="ts">\nconst title: string = "Home"\n</script>\n', 'server/api/records.get.ts': 'export default defineEventHandler(() => ({ records: [] }))\n' } },
    { name: 'react', dependencies: { react: '^18.0.0' }, extra: { 'src/App.tsx': 'export const App = () => <main>Home</main>\n' } },
    { name: 'typescript-with-python-tool', dependencies: {}, extra: { 'scripts/generate-fixture.py': 'def main():\n    return True\n' } },
    { name: 'prisma', dependencies: { prisma: '^7.0.0' }, extra: { 'prisma/schema.prisma': validPrismaSchema } },
    { name: 'combined', dependencies: { nuxt: '^4.0.0', prisma: '^7.0.0' }, extra: { 'app/pages/index.vue': '<template><main>Home</main></template>\n<script setup lang="ts">\nconst title: string = "Home"\n</script>\n', 'server/api/records.get.ts': 'export default defineEventHandler(() => ({ records: [] }))\n', 'prisma/schema.prisma': validPrismaSchema } },
  ]
  for (const variant of variants) {
    const root = await mkdtemp(join(tmpdir(), `po-stack-${variant.name}-`))
    try {
      const base = {
        'package.json': JSON.stringify({ name: variant.name, scripts: { test: 'node --test' }, dependencies: variant.dependencies, devDependencies: { typescript: '^5.8.0' } }),
        'src/records.ts': 'export const records: string[] = []\n',
        'tests/records.test.ts': 'export const verifiesRecords: boolean = true\n',
        ...variant.extra,
      }
      for (const [path, content] of Object.entries(base)) await writeRepositoryFile(root, path, content)
      const result = await profile(root, Object.keys(base), `op-${variant.name}`)
      assert.equal(result.supportStatus, 'supported', `${variant.name}: ${JSON.stringify(result.diagnostics)}`)
      assert.equal(result.requiredSemanticCapabilities.every((capability) => result.providerCoverage.some((item) => item.capability === capability && item.status === 'covered')), true)
      assert.equal(result.providerCoverage.every((item) => typeof item.providerVersion === 'string' && item.providerVersion.length > 0), true)
      if ('vue' in variant.dependencies || 'nuxt' in variant.dependencies) assert.equal(result.providerCoverage.find((item) => item.capability === 'routes')?.providerId, 'vue-nuxt-compiler-sfc')
      if ('react' in variant.dependencies) assert.equal(result.frameworks.some((item) => item.id === 'react'), true)
      if ('scripts/generate-fixture.py' in variant.extra) assert.equal(result.diagnostics.some((item) => item.code === 'repository-auxiliary-language-uncovered' && item.severity === 'warning'), true)
      if ('prisma' in variant.dependencies) assert.equal(result.providerCoverage.find((item) => item.capability === 'schema')?.providerId, '@prisma/get-dmmf')
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  }
})

test('Repository StackProfile still fails closed when Python is part of the primary repository stack', async () => {
  const root = await mkdtemp(join(tmpdir(), 'po-stack-primary-python-'))
  try {
    const files = {
      'package.json': JSON.stringify({ name: 'mixed-stack', scripts: { test: 'node --test' }, devDependencies: { typescript: '^5.8.0' } }),
      'src/records.ts': 'export const records: string[] = []\n',
      'tests/records.test.ts': 'export const verifiesRecords: boolean = true\n',
      'services/worker.py': 'def run():\n    return True\n',
    }
    for (const [path, content] of Object.entries(files)) await writeRepositoryFile(root, path, content)
    const result = await profile(root, Object.keys(files), 'op-primary-python')
    assert.equal(result.supportStatus, 'unsupported')
    assert.equal(result.diagnostics.some((item) => item.code === 'unsupported-stack' && item.subjectIds.includes('python')), true)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('Repository StackProfile fails closed on malformed or unavailable semantic sources', async () => {
  const variants = [
    { name: 'invalid-vue', dependencies: { vue: '^3.5.0' }, extra: { 'src/App.vue': '<script setup lang="ts">const =</script>' }, capability: 'routes', expectedStatus: 'partial' },
    { name: 'invalid-prisma', dependencies: { prisma: '^7.0.0' }, extra: { 'prisma/schema.prisma': 'model User { id Int @id }\n' }, capability: 'schema', expectedStatus: 'partial' },
    { name: 'missing-prisma', dependencies: { prisma: '^7.0.0' }, extra: {}, capability: 'schema', expectedStatus: 'missing' },
    { name: 'invalid-javascript', dependencies: {}, extra: { 'src/broken.js': 'export const = true\n' }, capability: 'symbols', expectedStatus: 'partial' },
  ]
  for (const variant of variants) {
    const root = await mkdtemp(join(tmpdir(), `po-stack-${variant.name}-`))
    try {
      const base = {
        'package.json': JSON.stringify({ name: variant.name, scripts: { test: 'node --test' }, dependencies: variant.dependencies, devDependencies: { typescript: '^5.8.0' } }),
        'src/records.ts': 'export const records: string[] = []\n',
        'tests/records.test.ts': 'export const verifiesRecords: boolean = true\n',
        ...variant.extra,
      }
      for (const [path, content] of Object.entries(base)) await writeRepositoryFile(root, path, content)
      const result = await profile(root, Object.keys(base), `op-${variant.name}`)
      assert.equal(result.supportStatus, 'partial')
      assert.equal(result.providerCoverage.find((item) => item.capability === variant.capability)?.status, variant.expectedStatus)
      assert.equal(result.diagnostics.some((item) => item.code === 'repository-provider-incomplete'), true)
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  }
})

test('Repository StackProfile rejects a symlinked semantic source that escapes the canonical root', async () => {
  const root = await mkdtemp(join(tmpdir(), 'po-stack-symlink-root-'))
  const outside = await mkdtemp(join(tmpdir(), 'po-stack-symlink-outside-'))
  try {
    const base = {
      'package.json': JSON.stringify({ name: 'symlink', scripts: { test: 'node --test' }, devDependencies: { typescript: '^5.8.0' } }),
      'src/records.ts': 'export const records: string[] = []\n',
      'tests/records.test.ts': 'export const verifiesRecords: boolean = true\n',
    }
    for (const [path, content] of Object.entries(base)) await writeRepositoryFile(root, path, content)
    await writeRepositoryFile(outside, 'escaped.ts', 'export const escaped = true\n')
    await symlink(join(outside, 'escaped.ts'), join(root, 'src', 'escaped.ts'))
    const result = await profile(root, [...Object.keys(base), 'src/escaped.ts'], 'op-symlink')
    assert.equal(result.supportStatus, 'partial')
    assert.match(result.providerCoverage.find((item) => item.capability === 'symbols').reason, /non-symlink|outside/u)
  } finally {
    await rm(root, { recursive: true, force: true })
    await rm(outside, { recursive: true, force: true })
  }
})
