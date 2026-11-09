import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, realpath, rename, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { buildRepositoryEvidenceRetrievalReportV3, buildRepositoryStackProfileV3, referencedVerificationConfigPathsV3, RepositoryEvidenceRetrievalReportSchema } from '../lib/index.js'

const digest = (value) => createHash('sha256').update(value).digest('hex')

async function fixture(files) {
  const root = await mkdtemp(join(tmpdir(), 'orchestrator-evidence-'))
  for (const [path, content] of Object.entries(files)) {
    await mkdir(join(root, path, '..'), { recursive: true })
    await writeFile(join(root, path), content)
  }
  const inventory = Object.entries(files).map(([path, content]) => ({ path, digest: digest(content) })).sort((left, right) => left.path.localeCompare(right.path))
  return {
    root,
    snapshot: {
      id: 'repository:test', projectId: 'project:test', operationId: 'operation:test', canonicalRoot: root,
      headCommit: 'a'.repeat(40), trackedTreeDigest: digest('tree'), dirtyDigest: digest('dirty'), repositoryDigest: digest('repository'),
      files: inventory, workingFiles: inventory, dirtyFiles: [], verifiedCommands: ['pnpm test'], status: 'ready', diagnostics: [], createdAt: new Date().toISOString(),
    },
  }
}

test('Repository providers parse declarations without emitting and discover root test entry points', async (context) => {
  for (const kind of ['declaration', 'root-test']) await context.test(kind, async () => {
    const files = {
      'package.json': JSON.stringify({ scripts: { test: 'node --test' } }),
      'index.ts': 'export const value = 1\n',
      ...(kind === 'declaration' ? { 'index.d.ts': 'export declare const publicValue: number;\n', 'tests/value.test.ts': 'export const tested = true\n' } : { 'test.js': 'export const tested = true\n' }),
    }
    const fixture_ = await fixture(files)
    try {
      fixture_.snapshot.canonicalRoot = await realpath(fixture_.root)
      const input = { project: { id: 'project:test' }, operationId: 'operation:test', repository: fixture_.snapshot }
      const profile = await buildRepositoryStackProfileV3(input)
      assert.equal(profile.supportStatus, 'supported', JSON.stringify(profile.diagnostics))
      assert.equal(profile.providerCoverage.find((item) => item.capability === 'tests').status, 'covered')
      if (kind === 'declaration') {
        await writeFile(join(fixture_.root, 'index.d.ts'), 'export declare const broken: ;\n')
        const invalid = await buildRepositoryStackProfileV3(input)
        assert.equal(invalid.supportStatus, 'partial', 'malformed declarations must remain blocked')
        assert.equal(invalid.diagnostics.some((item) => item.code === 'repository-provider-incomplete'), true)
      } else {
        input.repository = { ...fixture_.snapshot, files: fixture_.snapshot.files.filter((item) => item.path !== 'test.js'), workingFiles: fixture_.snapshot.workingFiles.filter((item) => item.path !== 'test.js') }
        const noTests = await buildRepositoryStackProfileV3(input)
        assert.equal(noTests.supportStatus, 'partial', 'a manifest script alone is not a test surface')
        assert.equal(noTests.providerCoverage.find((item) => item.capability === 'tests').status, 'missing')
      }
    } finally { await rm(fixture_.root, { recursive: true, force: true }) }
  })
})

test('Repository Evidence preserves declaration imports when keyword matches fill the selection limit', async () => {
  const context = await fixture({
    ...Object.fromEntries(Array.from({ length: 90 }, (_, i) => [`src/noise-${i}.ts`, `import './noise-dependency-${i}.js'\nexport const callback = "compatibility request"\n`])),
    ...Object.fromEntries(Array.from({ length: 90 }, (_, i) => [`src/noise-dependency-${i}.ts`, 'export const dependency = true\n'])),
    'api.ts': 'export const callback = true\n',
    'api.test.ts': "import { Server } from './server.js'\nimport { callback } from './api.js'\n",
    'server.ts': "export { Server } from './server-base.js'\n",
    'server-base.ts': "import { dispatch } from './compose.js'\nexport class Server {}\n",
    'compose.ts': 'export const dispatch = true\n',
    'package.json': '{"scripts":{"test":"vitest run"}}',
  })
  try {
    const report = await buildRepositoryEvidenceRetrievalReportV3({ projectId: 'project:test', operationId: 'operation:test', repository: context.snapshot, requirements: [{ key: 'REQ-001', statement: 'Add callback compatibility request in api.ts and api.test.ts.', acceptanceStatements: [] }] })
    assert.ok(report.selectedEvidenceIds.includes('server.ts'))
    assert.ok(report.selectedEvidenceIds.includes('server-base.ts'))
    assert.ok(report.selectedEvidenceIds.includes('compose.ts'))
    assert.ok(report.requirementSelections[0].evidenceIds.length <= 80)
  } finally { await rm(context.root, { recursive: true, force: true }) }
})

test('Repository Evidence retrieves a relevant owner beyond the former 2000-file prefix', async () => {
  const files = Object.fromEntries(Array.from({ length: 2_005 }, (_, index) => [`src/generated-placeholder-${String(index).padStart(4, '0')}.ts`, `export const placeholder${index} = ${index}\n`]))
  files['zz/sample-collection-service.ts'] = 'export class SampleCollectionService { createSampleCollection() {} }\n'
  files['zz/sample-collection-service.test.ts'] = "import { SampleCollectionService } from './sample-collection-service.js'\ntest('creates sample collection', () => {})\n"
  files['package.json'] = JSON.stringify({ scripts: { test: 'node --test' } })
  const context = await fixture(files)
  try {
    const report = await buildRepositoryEvidenceRetrievalReportV3({
      projectId: 'project:test', operationId: 'operation:test', repository: context.snapshot,
      requirements: [{ key: 'REQ-SAMPLE', statement: 'Create and persist a SampleCollection through SampleCollectionService.', acceptanceStatements: ['The sample collection can be created and listed.'] }],
    })
    assert.ok(report.inspectedFileCount > 2_000)
    assert.ok(report.selectedEvidenceIds.includes('zz/sample-collection-service.ts'))
    assert.ok(report.selectedEvidenceIds.includes('zz/sample-collection-service.test.ts'))
    assert.ok(report.selectedEvidenceIds.length <= 2_000)
    assert.notEqual(report.status, 'blocked')
  } finally {
    await rm(context.root, { recursive: true, force: true })
  }
})

test('Repository Evidence prioritizes exact requested files over broad vocabulary matches', async () => {
  const context = await fixture({
    ...Object.fromEntries(Array.from({ length: 8 }, (_, i) => [`docs/guide-${i}.md`, 'Maintain boolean parsing options compatibility fixtures declarations public factory.'])),
    'src/api.ts': 'export function stringbool() {}',
    'tests/stringbool.test.ts': 'export {}',
  })
  try {
    const report = await buildRepositoryEvidenceRetrievalReportV3({ projectId: 'project:test', operationId: 'operation:test', repository: context.snapshot, selectionLimit: 2,
      requirements: [{ key: 'REQ-OWNER', statement: 'Maintain boolean parsing options compatibility fixtures declarations public factory in src/api.ts.', acceptanceStatements: ['Verify tests/stringbool.test.ts.'] }] })
    assert.deepEqual(new Set(report.selectedEvidenceIds), new Set(['src/api.ts', 'tests/stringbool.test.ts']))
  } finally { await rm(context.root, { recursive: true, force: true }) }
})

test('Repository Evidence retains spec and test TypeScript configurations as manifests', async () => {
  const context = await fixture({
    'src/api.ts': 'export const value = true',
    'tsconfig.spec.json': '{"include":["src"]}',
    'tsconfig.test.json': '{"extends":"./tsconfig.spec.json"}',
  })
  try {
    const report = await buildRepositoryEvidenceRetrievalReportV3({ projectId: 'project:test', operationId: 'operation:test', repository: context.snapshot,
      requirements: [{ key: 'REQ-CONFIG', statement: 'Change value in src/api.ts.', acceptanceStatements: [] }] })
    assert.ok(report.selectedEvidenceIds.includes('tsconfig.spec.json'))
    assert.ok(report.selectedEvidenceIds.includes('tsconfig.test.json'))
  } finally { await rm(context.root, { recursive: true, force: true }) }
})

test('Repository Evidence retains runner discovery configurations when unrelated owners fill the lexical cap', async () => {
  const configs = ['vitest.config.ts', 'vitest.compile.config.ts', 'vitest.root.mjs', 'vitest.workspace.ts', 'vite.config.mts', 'runtime-tests/node/vitest.config.ts', 'jest.config.cjs', 'playwright.config.ts', 'cypress.config.ts']
  const context = await fixture({
    ...Object.fromEntries(Array.from({ length: 90 }, (_, i) => [`src/noise-${i}.ts`, 'export const callback = "compatibility request"\n'])),
    'src/api.ts': 'export const callback = true\n',
    ...Object.fromEntries(configs.map(path => [path, "export default { test: { include: ['**/*.test.ts'], exclude: ['**/sandbox/**'] } }\n"])),
    'vitest.compile.config.ts': "export default { test: { setupFiles: [resolve(__dirname, 'scripts', 'setup.ts')], tsconfig: './tsconfig.compile.json' } }\n",
    'scripts/setup.ts': "import './assert-setup.ts'; throw new Error('MUST_NOT_EXECUTE')\n",
    'scripts/assert-setup.ts': "export const initialized = true\n",
    'tsconfig.compile.json': '{"include":["src"]}',
    'unrelated.config.ts': 'export default {}\n',
    'vitest.compile.config.test.ts': 'export default {}\n',
  })
  try {
    const report = await buildRepositoryEvidenceRetrievalReportV3({ projectId: 'project:test', operationId: 'operation:test', repository: context.snapshot,
      requirements: [{ key: 'REQ-CONFIG', statement: 'Add callback compatibility request in src/api.ts.', acceptanceStatements: [] }] })
    for (const path of configs) assert.ok(report.selectedEvidenceIds.includes(path), `${path} must survive lexical selection`)
    for (const path of ['scripts/setup.ts', 'scripts/assert-setup.ts', 'tsconfig.compile.json']) assert.ok(report.selectedEvidenceIds.includes(path), `${path} is frozen configuration evidence`)
    assert.equal(report.selectedEvidenceIds.includes('unrelated.config.ts'), false)
    assert.equal(report.selectedEvidenceIds.includes('vitest.compile.config.test.ts'), false)
  } finally { await rm(context.root, { recursive: true, force: true }) }
})

test('Verification configuration references require static paths inside the frozen inventory', () => {
  const files = new Set(['scripts/setup.ts', 'scripts/check.ts', 'vitest.root.mjs', 'private.key', 'src/ordinary.ts'])
  const source = "import root from './vitest.root.mjs'; export default { setupFiles: [resolve(__dirname, 'scripts', 'setup.ts'), './scripts/check.ts', resolve(otherRoot, 'scripts', 'setup.ts'), variable, './scripts/*.ts', '../outside.ts', '/private.key'] };"
  assert.deepEqual(referencedVerificationConfigPathsV3('vitest.compile.config.ts', source, files), ['scripts/check.ts', 'scripts/setup.ts', 'vitest.root.mjs'])
  assert.deepEqual(referencedVerificationConfigPathsV3('src/ordinary.ts', source, files), [])
  assert.deepEqual(referencedVerificationConfigPathsV3('vitest.config.ts', "export default { setupFiles: [resolve(otherRoot, './scripts/setup.ts'), resolve(__dirname, variable, './scripts/check.ts'), getPath('./scripts/check.ts'), variable, './scripts/*.ts', '../outside.ts', '/private.key'] }", files), [])
})

test('Repository Evidence admits tracked ignore policies without admitting arbitrary dotfiles', async () => {
  const context = await fixture({
    'src/api.ts': 'export const value = true',
    '.gitignore': 'dist/\nindex.d.ts\n',
    '.npmignore': 'test/\n',
    '.credentials': 'never-index-this-value',
  })
  try {
    const report = await buildRepositoryEvidenceRetrievalReportV3({ projectId: 'project:test', operationId: 'operation:test', repository: context.snapshot,
      requirements: [{ key: 'REQ-BUILD', statement: 'Change src/api.ts; inspect .gitignore and .npmignore to establish generated and packaged artifact boundaries.', acceptanceStatements: [] }] })
    assert.ok(report.selectedEvidenceIds.includes('.gitignore'))
    assert.ok(report.selectedEvidenceIds.includes('.npmignore'))
    assert.equal(report.selectedEvidenceIds.includes('.credentials'), false)
  } finally { await rm(context.root, { recursive: true, force: true }) }
})

test('Repository Evidence bounds expanded multilingual terms without dropping explicit owner paths', async () => {
  const context = await fixture({ 'src/api.ts': 'export const value = true' })
  try {
    const longChinese = Array.from({ length: 350 }, (_, i) => String.fromCharCode(0x4e00 + i)).join('')
    const report = await buildRepositoryEvidenceRetrievalReportV3({ projectId: 'project:test', operationId: 'operation:test', repository: context.snapshot,
      requirements: [{ key: 'REQ-LONG', statement: `Change src/api.ts. ${longChinese}`, acceptanceStatements: [] }] })
    assert.doesNotThrow(() => RepositoryEvidenceRetrievalReportSchema.parse(report))
    assert.equal(report.querySeeds[0].terms.length, 200)
    assert.ok(report.querySeeds[0].terms.every(t => t.length <= 240))
    assert.ok(report.selectedEvidenceIds.includes('src/api.ts'))
    assert.ok(report.diagnostics.some(d => d.code === 'repository-evidence-query-truncated'))
  } finally { await rm(context.root, { recursive: true, force: true }) }
})

test('Repository Evidence selection is deterministic for the same frozen snapshot', async () => {
  const context = await fixture({
    'package.json': JSON.stringify({ scripts: { test: 'node --test' } }),
    'src/catalog.ts': 'export function listCatalogItems() { return [] }\n',
    'tests/catalog.test.ts': "test('lists catalog items', () => {})\n",
  })
  try {
    const input = {
      projectId: 'project:test', operationId: 'operation:test', repository: context.snapshot, createdAt: '2026-09-06T00:00:00.000Z',
      requirements: [{ key: 'REQ-CATALOG', statement: 'List catalog items.', acceptanceStatements: ['GET returns catalog items.'] }],
    }
    const first = await buildRepositoryEvidenceRetrievalReportV3(input)
    const second = await buildRepositoryEvidenceRetrievalReportV3(input)
    assert.deepEqual(second, first)
  } finally {
    await rm(context.root, { recursive: true, force: true })
  }
})

test('Repository Evidence blocks a requirement with no matching repository fact', async () => {
  const context = await fixture({ 'package.json': JSON.stringify({ scripts: { test: 'node --test' } }), 'src/unrelated.ts': 'export const unrelated = true\n' })
  try {
    const report = await buildRepositoryEvidenceRetrievalReportV3({
      projectId: 'project:test', operationId: 'operation:test', repository: context.snapshot,
      requirements: [{ key: 'REQ-PAYMENT', statement: 'Reconcile quantum invoices.', acceptanceStatements: ['Quantum invoice status is visible.'] }],
    })
    assert.equal(report.status, 'blocked')
    assert.deepEqual(report.diagnostics[0].subjectIds, ['REQ-PAYMENT'])
  } finally {
    await rm(context.root, { recursive: true, force: true })
  }
})

test('Repository Evidence excludes generated, vendor, and symlink evidence before admission', async () => {
  const context = await fixture({
    'package.json': JSON.stringify({ scripts: { test: 'node --test' } }),
    'generated/payment-owner.ts': 'export class PaymentOwner {}\n',
    'vendor/payment-owner.ts': 'export class PaymentOwner {}\n',
    'src/unrelated.ts': 'export const unrelated = true\n',
  })
  const outside = join(context.root, '..', `payment-owner-${Date.now()}.ts`)
  try {
    await writeFile(outside, 'export class PaymentOwner {}\n')
    await symlink(outside, join(context.root, 'src', 'payment-owner.ts'))
    context.snapshot.workingFiles.push({ path: 'src/payment-owner.ts', digest: digest('export class PaymentOwner {}\n') })
    context.snapshot.files.push({ path: 'src/payment-owner.ts', digest: digest('export class PaymentOwner {}\n') })
    const report = await buildRepositoryEvidenceRetrievalReportV3({
      projectId: 'project:test', operationId: 'operation:test', repository: context.snapshot,
      requirements: [{ key: 'REQ-PAYMENT', statement: 'Change PaymentOwner.', acceptanceStatements: ['PaymentOwner is updated.'] }],
    })
    assert.equal(report.status, 'blocked')
    assert.equal(report.selectedEvidenceIds.some((path) => path.includes('payment-owner')), false)
    assert.equal(report.eligibleFileCount, 2)
  } finally {
    await rm(outside, { force: true })
    await rm(context.root, { recursive: true, force: true })
  }
})

test('Repository Evidence preserves duplicate symbol candidates for independent owner review', async () => {
  const context = await fixture({
    'package.json': JSON.stringify({ scripts: { test: 'node --test' } }),
    'packages/admin/src/catalog-service.ts': 'export class CatalogService {}\n',
    'packages/store/src/catalog-service.ts': 'export class CatalogService {}\n',
    'packages/store/tests/catalog-service.test.ts': "import { CatalogService } from '../src/catalog-service.js'\ntest('CatalogService lists products', () => {})\n",
  })
  try {
    const report = await buildRepositoryEvidenceRetrievalReportV3({
      projectId: 'project:test', operationId: 'operation:test', repository: context.snapshot,
      requirements: [{ key: 'REQ-CATALOG', statement: 'Update CatalogService.', acceptanceStatements: ['CatalogService lists products.'] }],
    })
    assert.equal(report.selectedEvidenceIds.includes('packages/admin/src/catalog-service.ts'), true)
    assert.equal(report.selectedEvidenceIds.includes('packages/store/src/catalog-service.ts'), true)
  } finally {
    await rm(context.root, { recursive: true, force: true })
  }
})

test('Repository Evidence follows a relative dependency across monorepo package boundaries', async () => {
  const context = await fixture({
    'package.json': JSON.stringify({ workspaces: ['packages/*'], scripts: { test: 'node --test' } }),
    'packages/api/src/order-service.ts': "import { OrderStatus } from '../../shared/src/order-status.js'\nexport class OrderService { status = OrderStatus.Created }\n",
    'packages/api/tests/order-service.test.ts': "import { OrderService } from '../src/order-service.js'\ntest('OrderService creates orders', () => {})\n",
    'packages/shared/src/order-status.ts': "export enum OrderStatus { Created = 'created' }\n",
  })
  try {
    const report = await buildRepositoryEvidenceRetrievalReportV3({
      projectId: 'project:test', operationId: 'operation:test', repository: context.snapshot,
      requirements: [{ key: 'REQ-ORDER', statement: 'OrderService creates an order.', acceptanceStatements: ['The created order has an OrderStatus.'] }],
    })
    assert.equal(report.selectedEvidenceIds.includes('packages/api/src/order-service.ts'), true)
    assert.equal(report.selectedEvidenceIds.includes('packages/shared/src/order-status.ts'), true)
  } finally {
    await rm(context.root, { recursive: true, force: true })
  }
})

test('Repository Evidence includes source entries for explicitly referenced conditional package exports', async () => {
  const context = await fixture({
    'packages/lib/package.json': JSON.stringify({ name: 'fixture-lib', exports: { './v4': { 'source': './src/entry.ts', 'import': './dist/entry.js' }, './other': './src/other.ts' } }),
    'packages/lib/src/entry.ts': "export { transform } from './api.js'\n",
    'packages/lib/src/api.ts': 'export function transform(value: string) { return value; }\n',
    'packages/lib/src/other.ts': 'export const unrelated = true\n',
    ...Object.fromEntries(Array.from({ length: 100 }, (_, i) => [`src/noise-${i}.ts`, 'export const transform = true\n'])),
  })
  try {
    const report = await buildRepositoryEvidenceRetrievalReportV3({ projectId: 'project:test', operationId: 'operation:test', repository: context.snapshot, requirements: [{ key: 'REQ-001', statement: 'Change transform in packages/lib/src/api.ts; preserve fixture-lib/v4 public imports.', acceptanceStatements: ['The source entry stays compatible.'] }] })
    assert.ok(report.selectedEvidenceIds.includes('packages/lib/src/entry.ts'), 'Manifest-declared public source entry must not be lost to lexical noise.')
    assert.ok(!report.selectedEvidenceIds.includes('packages/lib/src/other.ts') || report.selectedEvidenceIds.indexOf('packages/lib/src/entry.ts') < report.selectedEvidenceIds.indexOf('packages/lib/src/other.ts'), 'Referenced source entries take priority over incidental lexical matches; inspection evidence does not authorize writes.')
  } finally { await rm(context.root, { recursive: true, force: true }) }
})

test('Repository Evidence follows tsconfig aliases, re-exports, and reverse consumers', async () => {
  const context = await fixture({
    'package.json': JSON.stringify({ scripts: { test: 'node --test' } }),
    'tsconfig.json': JSON.stringify({ compilerOptions: { baseUrl: '.', paths: { '@domain/*': ['src/domain/*'] } } }),
    'src/domain/order-service.ts': 'export class OrderService { createOrder() {} }\n',
    'src/domain/index.ts': "export { OrderService } from './order-service.js'\n",
    'src/http/checkout-endpoint.ts': "import { OrderService } from '@domain/index.js'\nexport class CheckoutEndpoint { constructor(private orders = new OrderService()) {} }\n",
    'tests/checkout-endpoint.test.ts': "import { CheckoutEndpoint } from '../src/http/checkout-endpoint.js'\ntest('CheckoutEndpoint creates an order', () => new CheckoutEndpoint())\n",
  })
  try {
    const report = await buildRepositoryEvidenceRetrievalReportV3({
      projectId: 'project:test', operationId: 'operation:test', repository: context.snapshot,
      requirements: [{ key: 'REQ-CHECKOUT', statement: 'Change CheckoutEndpoint.', acceptanceStatements: ['CheckoutEndpoint creates an order.'] }],
    })
    assert.equal(report.selectedEvidenceIds.includes('src/http/checkout-endpoint.ts'), true)
    assert.equal(report.selectedEvidenceIds.includes('src/domain/index.ts'), true)
    assert.equal(report.selectedEvidenceIds.includes('src/domain/order-service.ts'), true)
    assert.equal(report.selectedEvidenceIds.includes('tests/checkout-endpoint.test.ts'), true)
  } finally {
    await rm(context.root, { recursive: true, force: true })
  }
})

test('Repository Evidence invalidates cached relationships after rename, delete, and tsconfig changes', async () => {
  const context = await fixture({
    'tsconfig.json': JSON.stringify({ compilerOptions: { baseUrl: '.', paths: { '@internal/*': ['src/v1/*'] } } }),
    'src/entry.ts': "import { dependency } from '@internal/index.js'\nexport const CheckoutEndpoint = dependency\n",
    'src/v1/index.ts': 'export const dependency = 1\n',
    'src/v2/index.ts': 'export const dependency = 2\n',
  })
  const requirement = [{ key: 'REQ-CACHE', statement: 'Change CheckoutEndpoint.', acceptanceStatements: ['The endpoint behavior remains correct.'] }]
  try {
    const first = await buildRepositoryEvidenceRetrievalReportV3({ projectId: 'project:test', operationId: 'operation:first', repository: context.snapshot, requirements: requirement })
    assert.equal(first.selectedEvidenceIds.includes('src/v1/index.ts'), true)
    assert.equal(first.selectedEvidenceIds.includes('src/v2/index.ts'), false)

    const nextConfig = JSON.stringify({ compilerOptions: { baseUrl: '.', paths: { '@internal/*': ['src/v2/*'] } } })
    await writeFile(join(context.root, 'tsconfig.json'), nextConfig)
    context.snapshot.workingFiles = context.snapshot.workingFiles.map((file) => file.path === 'tsconfig.json' ? { path: file.path, digest: digest(nextConfig) } : file)
    const second = await buildRepositoryEvidenceRetrievalReportV3({ projectId: 'project:test', operationId: 'operation:config', repository: context.snapshot, requirements: requirement })
    assert.equal(second.selectedEvidenceIds.includes('src/v1/index.ts'), false)
    assert.equal(second.selectedEvidenceIds.includes('src/v2/index.ts'), true)

    await rename(join(context.root, 'src/v2/index.ts'), join(context.root, 'src/v2/renamed.ts'))
    const renamedContent = 'export const dependency = 2\n'
    const renamedConfig = JSON.stringify({ compilerOptions: { baseUrl: '.', paths: { '@internal/*': ['src/v2/*'] } } })
    const renamedEntry = "import { dependency } from '@internal/renamed.js'\nexport const CheckoutEndpoint = dependency\n"
    await writeFile(join(context.root, 'src/entry.ts'), renamedEntry)
    context.snapshot.workingFiles = context.snapshot.workingFiles
      .filter((file) => file.path !== 'src/v1/index.ts' && file.path !== 'src/v2/index.ts')
      .map((file) => file.path === 'src/entry.ts' ? { path: file.path, digest: digest(renamedEntry) } : file)
      .concat({ path: 'src/v2/renamed.ts', digest: digest(renamedContent) })
      .sort((left, right) => left.path.localeCompare(right.path))
    context.snapshot.files = context.snapshot.workingFiles
    context.snapshot.dirtyDigest = digest('renamed-and-deleted')
    await writeFile(join(context.root, 'tsconfig.json'), renamedConfig)
    const third = await buildRepositoryEvidenceRetrievalReportV3({ projectId: 'project:test', operationId: 'operation:rename', repository: context.snapshot, requirements: requirement })
    assert.equal(third.selectedEvidenceIds.includes('src/v2/renamed.ts'), true)
    assert.equal(third.selectedEvidenceIds.includes('src/v1/index.ts'), false)
    assert.equal(third.selectedEvidenceIds.includes('src/v2/index.ts'), false)
  } finally {
    await rm(context.root, { recursive: true, force: true })
  }
})

test('Repository Evidence reports file-count and byte-budget truncation as partial', async () => {
  const context = await fixture({
    'src/a-owner.ts': 'export class AlphaOwner {}\n',
    'src/b-secondary.ts': `export const secondary = '${'x'.repeat(500)}'\n`,
    'src/c-third.ts': 'export const third = true\n',
  })
  const input = {
    projectId: 'project:test', operationId: 'operation:budget', repository: context.snapshot,
    requirements: [{ key: 'REQ-ALPHA', statement: 'Change AlphaOwner.', acceptanceStatements: ['AlphaOwner remains available.'] }],
  }
  try {
    const fileBounded = await buildRepositoryEvidenceRetrievalReportV3({ ...input, indexFileLimit: 2 })
    assert.equal(fileBounded.status, 'partial')
    assert.equal(fileBounded.diagnostics.some((item) => item.code === 'repository-evidence-index-partial'), true)
    const byteBounded = await buildRepositoryEvidenceRetrievalReportV3({ ...input, operationId: 'operation:bytes', indexByteLimit: 100 })
    assert.equal(byteBounded.status, 'partial')
    assert.equal(byteBounded.selectedEvidenceIds.includes('src/a-owner.ts'), true)
    assert.equal(byteBounded.diagnostics.some((item) => item.code === 'repository-evidence-index-partial'), true)
  } finally {
    await rm(context.root, { recursive: true, force: true })
  }
})

test('Repository Evidence labels source-test structural fallback as partial', async () => {
  const context = await fixture({
    'package.json': JSON.stringify({ scripts: { test: 'node --test' } }),
    'src/ledger.ts': 'export const ledger = true\n',
    'tests/ledger.test.ts': "test('ledger', () => {})\n",
  })
  try {
    const report = await buildRepositoryEvidenceRetrievalReportV3({
      projectId: 'project:test', operationId: 'operation:test', repository: context.snapshot,
      requirements: [{ key: 'REQ-ALIEN', statement: 'Implement quantum reconciliation.', acceptanceStatements: ['Quantum state is reconciled.'] }],
    })
    assert.equal(report.status, 'partial')
    assert.equal(report.diagnostics.some((item) => item.code === 'repository-evidence-structural-fallback'), true)
    assert.deepEqual(report.requirementSelections[0].matchedTerms, [])
  } finally {
    await rm(context.root, { recursive: true, force: true })
  }
})
