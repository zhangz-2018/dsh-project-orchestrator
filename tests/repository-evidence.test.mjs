import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { buildRepositoryEvidenceRetrievalReportV3 } from '../lib/index.js'

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
