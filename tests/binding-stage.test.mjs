import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtemp, mkdir, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import ts from 'typescript'
import { BindingStage, OrchestratorStore, RequirementCodeBindingRecordSchema, buildBindingPromptV3, digestObject, parseGeneratedBindingAnalysisV3 } from '../lib/index.js'

const now = '2026-09-23T00:00:00.000Z'
const run = promisify(execFile)
const dimensions = ['domain_owner', 'write_path', 'read_path', 'data', 'state', 'api', 'permission', 'async', 'consumer', 'failure', 'test', 'migration', 'release', 'rollback']

class MemoryTable {
  records = new Map()
  get(id) { return this.records.get(id) }
  entries() { return this.records.entries() }
  async put(id, value) { this.records.set(id, structuredClone(value)) }
  async delete(id) { return this.records.delete(id) }
  async update(id, transform) { const next = transform(this.records.get(id)); await this.put(id, next); return next }
}

function store() {
  const tables = new Map()
  return new OrchestratorStore({ table(name) {
    if (!tables.has(name)) tables.set(name, new MemoryTable())
    return tables.get(name)
  } })
}

function fixture() {
  const storage = store()
  const repositoryCore = {
    canonicalRoot: '/repo', headCommit: 'a'.repeat(40), trackedTreeDigest: 'b'.repeat(64), dirtyDigest: 'c'.repeat(64),
    files: [{ path: 'src/owner.ts', digest: 'd'.repeat(64) }],
    workingFiles: [{ path: 'src/owner.ts', digest: 'd'.repeat(64) }, { path: 'tests/owner.test.ts', digest: 'e'.repeat(64) }],
    dirtyFiles: ['tests/owner.test.ts'], verifiedCommands: ['pnpm test'], status: 'ready', diagnostics: [],
  }
  const repositoryDigest = digestObject(repositoryCore)
  const repository = { id: 'repo-current', projectId: 'project-1', operationId: 'operation-1', ...repositoryCore, repositoryDigest, createdAt: now }
  const predecessorRepository = { ...repository, id: 'repo-predecessor', operationId: 'predecessor' }
  const report = { selectedEvidenceIds: ['src/owner.ts', 'tests/owner.test.ts'] }
  const stage = new BindingStage(storage)
  const references = stage.repositoryReferences(repository, report)
  const manifest = { id: 'manifest-1', projectId: 'project-1', operationId: 'operation-1', references }
  const analysis = parseGeneratedBindingAnalysisV3(JSON.stringify({
    status: 'ready', diagnostics: [], bindings: [{
      key: 'BIND-OWNER', requirementKey: 'REQ-OWNER', changeIntent: 'modify',
      impactAssessments: dimensions.map((dimension) => ({ dimension, applicability: dimension === 'domain_owner' ? 'required' : 'not_applicable', evidenceRefs: dimension === 'domain_owner' ? ['ref-repo-f00001'] : [], reason: 'Frozen repository evidence.' })),
      evidenceRefs: ['ref-repo-f00001', 'ref-repo-f00002'], allowedPathScopes: ['src/owner.ts', 'tests/owner.test.ts'], excludedPathScopes: [],
      ownerSymbols: ['Owner'], currentBehaviorClaims: ['Owner handles the current behavior.'], eventFactChains: [],
    }],
  }), { requirementKeys: ['REQ-OWNER'], allowedEvidenceRefs: references.map((item) => item.ref) })
  return { storage, stage, repository, predecessorRepository, report, manifest, analysis }
}

test('BindingStage supplies verified source content while rejecting changed, cross-operation, and escaping evidence', async () => {
  const root = await mkdtemp(join(tmpdir(), 'po-binding-inline-'))
  try {
    const repositoryPath = join(root, 'repo')
    await mkdir(repositoryPath)
    await run('git', ['init', '--object-format=sha1', '--initial-branch=main', repositoryPath])
    const source = 'export function greet(name: string) { return `Hello, ${name}!` }\n'
    await writeFile(join(repositoryPath, 'greeting.ts'), source)
    const { stdout } = await run('git', ['hash-object', '--no-filters', '--', 'greeting.ts'], { cwd: repositoryPath })
    const digest = digestObject({ path: 'greeting.ts', blob: stdout.trim() })
    const repository = { canonicalRoot: repositoryPath, projectId: 'project', operationId: 'operation', workingFiles: [{ path: 'greeting.ts', digest }] }
    const manifest = { projectId: 'project', operationId: 'operation', references: [{ ref: 'ref-source', kind: 'repository_evidence', artifactId: 'greeting.ts', artifactDigest: digest }] }
    const stage = new BindingStage(store())
    const contents = await stage.loadFrozenEvidence(repository, manifest)
    assert.deepEqual(contents, [{ ref: 'ref-source', path: 'greeting.ts', digest, content: source, truncated: false }])
    assert.equal(JSON.stringify(contents).includes(repositoryPath), false)
    await assert.rejects(() => stage.loadFrozenEvidence(repository, { ...manifest, operationId: 'foreign' }), (error) => error.code === 'repository-evidence-report-stale')
    await writeFile(join(repositoryPath, 'greeting.ts'), `${source}// changed after capture\n`)
    await assert.rejects(() => stage.loadFrozenEvidence(repository, manifest), (error) => error.code === 'repository-evidence-report-stale')
    await writeFile(join(root, 'outside.ts'), source)
    await symlink(join(root, 'outside.ts'), join(repositoryPath, 'escape.ts'))
    const escaping = { ...repository, workingFiles: [{ path: 'escape.ts', digest }] }
    await assert.rejects(() => stage.loadFrozenEvidence(escaping, { ...manifest, references: [{ ...manifest.references[0], artifactId: 'escape.ts' }] }), (error) => error.code === 'repository-evidence-outside-root')
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('BindingStage freezes complete existing sampling code and its harness without creating a proposed file', async () => {
  const root = await mkdtemp(join(tmpdir(), 'po-binding-measurement-'))
  try {
    await run('git', ['init', '--initial-branch=main', root])
    await mkdir(join(root, 'bench'))
    const files = { 'owner.ts': 'export const convert = (value: string) => value', 'bench/memory.ts': 'import { sample } from "./harness.js"; sample();', 'bench/harness.ts': 'export function sample() { for (let i = 0; i < 10; i++) globalThis.gc?.(); }' }
    const inventory = []
    for (const [path, content] of Object.entries(files)) {
      await writeFile(join(root, path), content)
      const { stdout } = await run('git', ['hash-object', '--no-filters', '--', path], { cwd: root })
      inventory.push({ path, digest: digestObject({ path, blob: stdout.trim() }) })
    }
    const repository = { canonicalRoot: root, projectId: 'project', operationId: 'operation', workingFiles: inventory,
      verifiedCommands: ['nub --expose-gc bench/memory.ts'], plannedVerificationEntries: [{ command: 'nub --expose-gc bench/new.ts', targetPath: 'bench/new.ts', targetState: 'absent', templateCommand: 'nub --expose-gc bench/memory.ts', declarationDigest: 'a'.repeat(64) }] }
    const manifest = { projectId: 'project', operationId: 'operation', references: inventory.map((file, index) => ({ ref: `ref-source-${index}`, kind: 'repository_evidence', artifactId: file.path, artifactDigest: file.digest })) }
    const evidence = await new BindingStage(store()).loadFrozenEvidence(repository, manifest, 'Modify owner.ts and create bench/new.ts to measure the change.')
    for (const path of ['bench/memory.ts', 'bench/harness.ts']) {
      assert.equal(evidence.find(item => item.path === path).content, files[path])
      assert.equal(evidence.find(item => item.path === path).truncated, false)
    }
    assert.equal(evidence.some(item => item.path === 'bench/new.ts'), false)
    assert.ok(evidence.reduce((size, item) => size + Buffer.byteLength(item.content), 0) <= 98_304)
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('BindingStage bounds source excerpts and labels incomplete evidence explicitly', async () => {
  const root = await mkdtemp(join(tmpdir(), 'po-binding-budget-'))
  try {
    await run('git', ['init', '--object-format=sha1', '--initial-branch=main', root])
    const files = []
    const references = []
    for (let index = 0; index < 5; index += 1) {
      const path = `source-${index}.ts`
      await writeFile(join(root, path), 'x'.repeat(20_000))
      const { stdout } = await run('git', ['hash-object', '--no-filters', '--', path], { cwd: root })
      const digest = digestObject({ path, blob: stdout.trim() })
      files.push({ path, digest })
      references.push({ ref: `ref-${index}`, kind: 'repository_evidence', artifactId: path, artifactDigest: digest })
    }
    const contents = await new BindingStage(store()).loadFrozenEvidence({ canonicalRoot: root, projectId: 'project', operationId: 'operation', workingFiles: files }, { projectId: 'project', operationId: 'operation', references })
    assert.equal(contents.length, 5)
    assert.equal(contents.every((item) => item.truncated), true)
    assert.equal(contents.reduce((sum, item) => sum + Buffer.byteLength(item.content), 0), 65_536)
    assert.equal(contents.at(-1).content, '')
    const oversized = references[0].artifactId
    await writeFile(join(root, oversized), 'x'.repeat(2_000_001))
    await assert.rejects(() => new BindingStage(store()).loadFrozenEvidence({ canonicalRoot: root, projectId: 'project', operationId: 'operation', workingFiles: files }, { projectId: 'project', operationId: 'operation', references }), (error) => error.code === 'repository-evidence-content-too-large')
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('BindingStage preserves complete runner discovery configuration without requiring a lexical match', async () => {
  const root = await mkdtemp(join(tmpdir(), 'po-binding-runner-config-'))
  try {
    await run('git', ['init', '--object-format=sha1', '--initial-branch=main', root])
    const path = 'vitest.config.ts'
    const source = `import { defineConfig } from 'vitest/config'\n${'// unrelated runner setup\n'.repeat(80)}export default defineConfig({ test: { projects: [{ test: { include: ['src/**/*.test.ts'], exclude: ['**/sandbox/**'] } }] } })\n`
    await writeFile(join(root, path), source)
    const { stdout } = await run('git', ['hash-object', '--no-filters', '--', path], { cwd: root })
    const digest = digestObject({ path, blob: stdout.trim() })
    const files = [{ path, digest }]
    const references = [{ ref: 'ref-config', kind: 'repository_evidence', artifactId: path, artifactDigest: digest }]
    const variants = ['vitest.compile.config.ts', 'vitest.root.mjs', 'vitest.workspace.ts']
    for (const variant of variants) {
      await writeFile(join(root, variant), source)
      const { stdout: blob } = await run('git', ['hash-object', '--no-filters', '--', variant], { cwd: root })
      const variantDigest = digestObject({ path: variant, blob: blob.trim() })
      files.push({ path: variant, digest: variantDigest })
      references.push({ ref: `ref-${variant}`, kind: 'repository_evidence', artifactId: variant, artifactDigest: variantDigest })
    }
    const setupPath = 'setup-helper.ts'
    const setup = `${'// setup context\n'.repeat(80)}export const initialized = true\n`
    await writeFile(join(root, setupPath), setup)
    const { stdout: setupBlob } = await run('git', ['hash-object', '--no-filters', '--', setupPath], { cwd: root })
    const setupDigest = digestObject({ path: setupPath, blob: setupBlob.trim() })
    files.push({ path: setupPath, digest: setupDigest })
    references.push({ ref: 'ref-setup', kind: 'repository_evidence', artifactId: setupPath, artifactDigest: setupDigest })
    const compileSource = source + "export const setupFiles = [resolve(__dirname, './setup-helper.ts')];\n"
    await writeFile(join(root, variants[0]), compileSource)
    const { stdout: compileBlob } = await run('git', ['hash-object', '--no-filters', '--', variants[0]], { cwd: root })
    const compileDigest = digestObject({ path: variants[0], blob: compileBlob.trim() })
    files.find(file => file.path === variants[0]).digest = compileDigest
    references.find(reference => reference.artifactId === variants[0]).artifactDigest = compileDigest
    for (let index = 0; index < 8; index++) {
      const ownerPath = `owner-${index}.ts`
      await writeFile(join(root, ownerPath), `export const callback = '${'x'.repeat(20_000)}'\n`)
      const { stdout: blob } = await run('git', ['hash-object', '--no-filters', '--', ownerPath], { cwd: root })
      const ownerDigest = digestObject({ path: ownerPath, blob: blob.trim() })
      files.push({ path: ownerPath, digest: ownerDigest })
      references.push({ ref: `ref-owner-${index}`, kind: 'repository_evidence', artifactId: ownerPath, artifactDigest: ownerDigest })
    }
    const contents = await new BindingStage(store()).loadFrozenEvidence(
      { canonicalRoot: root, projectId: 'project', operationId: 'operation', workingFiles: files },
      { projectId: 'project', operationId: 'operation', references },
      `Change callback compatibility request in ${files.filter(file => file.path.startsWith('owner-')).map(file => file.path).join(' ')}.`,
    )
    const config = contents.find(item => item.path === path)
    assert.equal(config.content, source)
    assert.equal(config.truncated, false)
    for (const variant of variants) {
      const evidence = contents.find(item => item.path === variant)
      assert.equal(evidence.content, variant === variants[0] ? compileSource : source, variant)
      assert.equal(evidence.truncated, false, variant)
    }
    assert.equal(contents.find(item => item.path === setupPath).content, setup)
    assert.equal(contents.find(item => item.path === setupPath).truncated, false)
    assert.ok(contents.reduce((sum, item) => sum + Buffer.byteLength(item.content), 0) <= 98_304)
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('BindingStage reserves a requested regression owner before broad small-module evidence exhausts the shared budget', async () => {
  const root = await mkdtemp(join(tmpdir(), 'po-binding-test-reservation-'))
  try {
    await run('git', ['init', '--object-format=sha1', '--initial-branch=main', root])
    const regression = `const callback = () => 'existing';\n${Array.from({ length: 370 }, (_, i) => `test('existing CORS regression ${i}', () => {});`).join('\n')}\n`
    assert.ok(Buffer.byteLength(regression) > 16_384 && Buffer.byteLength(regression) < 24_576)
    const inputs = { 'cors.test.ts': regression, 'vitest.config.ts': "export default { test: { include: ['**/*.test.ts'] } };\n" }
    for (let i = 0; i < 16; i++) inputs[`helper-${i}.ts`] = `export const callback = '${'x'.repeat(7_000)}';\n`
    const files = []
    const references = []
    for (const [path, content] of Object.entries(inputs)) {
      await writeFile(join(root, path), content)
      const { stdout } = await run('git', ['hash-object', '--no-filters', '--', path], { cwd: root })
      const digest = digestObject({ path, blob: stdout.trim() })
      files.push({ path, digest })
      references.push({ ref: `ref-${files.length}`, kind: 'repository_evidence', artifactId: path, artifactDigest: digest })
    }
    const evidence = await new BindingStage(store()).loadFrozenEvidence(
      { canonicalRoot: root, projectId: 'project', operationId: 'operation', workingFiles: files },
      { projectId: 'project', operationId: 'operation', references },
      `Inspect callback behavior and preserve regression ownership in ${Object.keys(inputs).join(' ')}.`,
    )
    assert.equal(evidence.find(item => item.path === 'cors.test.ts').content, regression)
    assert.equal(evidence.find(item => item.path === 'cors.test.ts').truncated, false)
    assert.equal(evidence.find(item => item.path === 'vitest.config.ts').content, inputs['vitest.config.ts'])
    assert.ok(evidence.some(item => item.path.startsWith('helper-') && item.truncated))
    assert.ok(evidence.reduce((sum, item) => sum + Buffer.byteLength(item.content), 0) <= 98_304)
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('BindingStage setup barrel imports cannot promote unrelated production modules over requested declarations', async () => {
  const root = await mkdtemp(join(tmpdir(), 'po-binding-config-barrel-'))
  try {
    await run('git', ['init', '--object-format=sha1', '--initial-branch=main', root])
    const inputs = {
      'vitest.config.ts': "export default { test: { setupFiles: ['./setup.ts'] } };\n",
      'setup.ts': "import * as runtime from './barrel.js';\nconsole.log(runtime.context);\n",
      'barrel.ts': Array.from({ length: 12 }, (_, i) => `export * from './unrelated-${i}.js';`).join('\n'),
      'factory.ts': `export function requestedFactory(input: string) { return input.trim(); }\n${'// unrelated context\n'.repeat(1500)}`,
    }
    for (let i = 0; i < 12; i++) inputs[`unrelated-${i}.ts`] = `export const context${i} = '${'x'.repeat(15_000)}';\n`
    const files = []
    const references = []
    for (const [path, content] of Object.entries(inputs)) {
      await writeFile(join(root, path), content)
      const { stdout } = await run('git', ['hash-object', '--no-filters', '--', path], { cwd: root })
      const digest = digestObject({ path, blob: stdout.trim() })
      files.push({ path, digest })
      references.push({ ref: `ref-${files.length}`, kind: 'repository_evidence', artifactId: path, artifactDigest: digest })
    }
    const evidence = await new BindingStage(store()).loadFrozenEvidence(
      { canonicalRoot: root, projectId: 'project', operationId: 'operation', workingFiles: files },
      { projectId: 'project', operationId: 'operation', references },
      'Inspect requestedFactory in factory.ts and its test configuration.',
    )
    for (const path of ['vitest.config.ts', 'setup.ts', 'barrel.ts']) assert.equal(evidence.find(c => c.path === path).content, inputs[path])
    assert.match(evidence.find(c => c.path === 'factory.ts').content, /export function requestedFactory\(input: string\)/)
    assert.ok(evidence.reduce((sum, c) => sum + Buffer.byteLength(c.content), 0) <= 98_304)
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('BindingStage exposes complete focused JSON members with source locations without inventing absent exports', async () => {
  const root = await mkdtemp(join(tmpdir(), 'po-binding-json-members-'))
  try {
    await run('git', ['init', '--object-format=sha1', '--initial-branch=main', root])
    const mapping = { types: './dist/types/cors.d.ts', import: './dist/cors.js', require: './dist/cjs/cors.js' }
    const source = JSON.stringify({ scripts: { test: 'vitest run' }, exports: {
      ...Object.fromEntries(Array.from({ length: 260 }, (_, i) => [`./unrelated-${i}`, `./dist/unrelated-${i}.js`])),
      './cors': mapping,
      './cors~internal': './dist/private.js',
    } }, null, 2)
    assert.ok(Buffer.byteLength(source) > 8_192)
    const load = async (content, focus) => {
      await writeFile(join(root, 'package.json'), content)
      const { stdout } = await run('git', ['hash-object', '--no-filters', '--', 'package.json'], { cwd: root })
      const digest = digestObject({ path: 'package.json', blob: stdout.trim() })
      return (await new BindingStage(store()).loadFrozenEvidence(
        { canonicalRoot: root, projectId: 'project', operationId: 'operation', workingFiles: [{ path: 'package.json', digest }] },
        { projectId: 'project', operationId: 'operation', references: [{ ref: 'ref-package', kind: 'repository_evidence', artifactId: 'package.json', artifactDigest: digest }] }, focus,
      ))[0]
    }
    const focus = 'Preserve package.json exports for src/middleware/cors/index.ts and cors~internal.'
    const evidence = await load(source, focus)
    assert.equal(evidence.ref, 'ref-package')
    assert.equal(evidence.truncated, true)
    assert.ok(Buffer.byteLength(evidence.content) <= 8_192)
    const start = evidence.content.indexOf('[Exact JSON member /exports/.~1cors;')
    assert.ok(start >= 0, 'A matching export must be shown as a complete located JSON member, not buried in disjoint excerpts')
    const snippet = evidence.content.slice(start, evidence.content.indexOf('\n\n', start))
    assert.match(snippet, /original lines \d+-\d+/u)
    for (const target of Object.values(mapping)) assert.ok(snippet.includes(target))
    const match = snippet.match(/original lines (\d+)-(\d+)\]\n([\s\S]*)/u)
    assert.ok(source.split('\n').slice(Number(match[1]) - 1, Number(match[2])).join('\n').includes(match[3]))
    assert.ok(evidence.content.includes('[Exact JSON member /exports/.~1cors~0internal;'))
    assert.deepEqual(await load(source, focus), evidence, 'Presentation must be deterministic')
    const missing = await load(source.replace('"./cors":', '"./different":'), 'Inspect package.json cors mapping')
    assert.equal(missing.content.includes('[Exact JSON member /exports/.~1cors;'), false)
    const malformed = await load(`${source}\nnot-json`, focus)
    assert.equal(malformed.content.includes('[Exact JSON member'), false, 'Malformed JSON must not yield structural evidence')
    const duplicates = await load(source.replace('"./cors": {', '"./cors": "./first.js",\n    "./cors": {'), focus)
    assert.equal(duplicates.content.split('[Exact JSON member /exports/.~1cors;').length - 1, 2, 'Duplicate source members must not be silently collapsed')
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('BindingStage supplies a complete explicitly requested regression file that fits its bounded test budget', async () => {
  const root = await mkdtemp(join(tmpdir(), 'po-binding-complete-test-'))
  try {
    await run('git', ['init', '--object-format=sha1', '--initial-branch=main', root])
    const path = 'cors.test.ts'
    const content = `${Array.from({ length: 370 }, (_, i) => `test('existing CORS regression ${i}', () => {});`).join('\n')}\ntest('maxAge and Vary remain compatible', () => {});\n`
    assert.ok(Buffer.byteLength(content) > 16_384 && Buffer.byteLength(content) < 24_576)
    await writeFile(join(root, path), content)
    const { stdout } = await run('git', ['hash-object', '--no-filters', '--', path], { cwd: root })
    const digest = digestObject({ path, blob: stdout.trim() })
    const repository = { canonicalRoot: root, projectId: 'project', operationId: 'operation', workingFiles: [{ path, digest }] }
    const manifest = { projectId: 'project', operationId: 'operation', references: [{ ref: 'ref-test', kind: 'repository_evidence', artifactId: path, artifactDigest: digest }] }
    const evidence = await new BindingStage(store()).loadFrozenEvidence(repository, manifest, 'Inspect existing regression coverage in cors.test.ts before adding maxAge validation.')
    assert.equal(evidence[0].content, content)
    assert.equal(evidence[0].truncated, false)
    assert.ok(evidence.reduce((n, item) => n + Buffer.byteLength(item.content), 0) <= 65_536)
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('BindingStage supplies referenced helper declarations instead of unrelated module prefixes', async () => {
  const root = await mkdtemp(join(tmpdir(), 'po-binding-helper-closure-'))
  try {
    await run('git', ['init', '--object-format=sha1', '--initial-branch=main', root])
    const noise = Array.from({ length: 450 }, (_, i) => `export function unrelated${i}(value: string) { return value + '${i}'; }`).join('\n')
    const sources = {
      'api.ts': "import * as util from './util.js';\nimport * as schema from './schema.js';\nexport function transform(value: string) { return schema.decode(util.required(util.normalizeParams(value))); }\n",
      'util.ts': `${noise}\nexport function required(value: string) { if (!value) throw new Error('required'); return value; }\nexport function normalizeParams(value: string) {\n${Array.from({ length: 90 }, (_, i) => `  value = value + '${i}';`).join('\n')}\n  return value.trim();\n}\n`,
      'schema.ts': `${noise}\nexport function decode(value: string) { return finish(value); }\n${noise}\nfunction finish(value: string) { return value === 'yes'; }\n`,
    }
    const files = []
    for (const [path, content] of Object.entries(sources)) {
      await writeFile(join(root, path), content)
      const { stdout } = await run('git', ['hash-object', '--no-filters', '--', path], { cwd: root })
      files.push({ path, digest: digestObject({ path, blob: stdout.trim() }) })
    }
    const repository = { canonicalRoot: root, projectId: 'project', operationId: 'operation', workingFiles: files }
    const manifest = { projectId: 'project', operationId: 'operation', references: files.map((f, i) => ({ ref: `ref-${i}`, kind: 'repository_evidence', artifactId: f.path, artifactDigest: f.digest })) }
    const contents = await new BindingStage(store()).loadFrozenEvidence(repository, manifest, 'Modify transform in api.ts; preserve shared normalization and decoding.')
    assert.match(contents.find(c => c.path === 'util.ts').content, /export function normalizeParams/)
    assert.match(contents.find(c => c.path === 'util.ts').content, /return value.trim\(\)/)
    assert.match(contents.find(c => c.path === 'util.ts').content, /export function required\(/, 'An exact source dependency must override prose keyword filtering')
    assert.match(contents.find(c => c.path === 'schema.ts').content, /export function decode/)
    assert.match(contents.find(c => c.path === 'schema.ts').content, /function finish\(value: string\) \{ return value === 'yes'; \}/)
    assert.ok(contents.reduce((n, c) => n + Buffer.byteLength(c.content), 0) <= 65_536)
    assert.equal(contents.find(c => c.path === 'util.ts').truncated, true)
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('BindingStage retains the executable owner chain when comments make an explicitly requested source large', async () => {
  const root = await mkdtemp(join(tmpdir(), 'po-binding-complete-owner-'))
  try {
    await run('git', ['init', '--object-format=sha1', '--initial-branch=main', root])
    const owner = `export class Queue {\n${'/** Scheduling documentation. */\n'.repeat(800)}
  #pending = 0;
  #emit(event: string) { return event; }
  start() { this.#pending++; this.#emit('active'); }
${Array.from({ length: 420 }, (_, i) => `  operation${i}(value: number) { return value + ${i}; }`).join('\n')}
  finish() { this.#pending--; this.#emit('completed'); this.#emitEmptyAndIdle(); }
  fail() { this.#pending--; this.#emit('error'); this.#emitEmptyAndIdle(); }
  #emitEmptyAndIdle() { if (!this.#pending) this.#emit('idle'); }
  get size() { return 0; }
  get pending() { return this.#pending; }
}\n`
    const sources = { 'queue.ts': owner, 'queue.test.ts': "test('existing events', () => {});\n", 'package.json': '{"scripts":{"test":"node --test"}}' }
    const files = []
    for (const [path, content] of Object.entries(sources)) {
      await writeFile(join(root, path), content)
      const { stdout } = await run('git', ['hash-object', '--no-filters', '--', path], { cwd: root })
      files.push({ path, digest: digestObject({ path, blob: stdout.trim() }) })
    }
    const repository = { canonicalRoot: root, projectId: 'project', operationId: 'operation', workingFiles: files }
    const manifest = { projectId: 'project', operationId: 'operation', references: files.map((f, i) => ({ ref: `ref-${i}`, kind: 'repository_evidence', artifactId: f.path, artifactDigest: f.digest })) }
    const contents = await new BindingStage(store()).loadFrozenEvidence(repository, manifest, 'Add outstandingCount = size + pending in queue.ts; preserve queue.test.ts events, scheduling, finish and failure timing.')
    const evidence = contents.find(c => c.path === 'queue.ts')
    assert.ok(Buffer.byteLength(evidence.content) > 16_384 && Buffer.byteLength(evidence.content) <= 24_576)
    for (const fact of ["this.#emit('active')", "this.#emit('completed')", "this.#emit('error')", "this.#emit('idle')", 'get size()', 'get pending()', 'operation0(', 'operation419(']) assert.ok(evidence.content.includes(fact), `Missing executable owner fact ${fact}`)
    assert.equal(evidence.truncated, true, 'Omitted documentation must stay explicit even when all executable source fits')
    assert.match(evidence.content, /comments and blank lines omitted/)
    assert.equal(contents.find(c => c.path === 'queue.test.ts').content, sources['queue.test.ts'])
    assert.ok(contents.reduce((n, c) => n + Buffer.byteLength(c.content), 0) <= 65_536)
    assert.deepEqual(await new BindingStage(store()).loadFrozenEvidence(repository, manifest, 'Add outstandingCount = size + pending in queue.ts; preserve queue.test.ts events, scheduling, finish and failure timing.'), contents)
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('BindingStage reserves intact named owners before large regression excerpts and follows arrow helpers', async () => {
  const root = await mkdtemp(join(tmpdir(), 'po-binding-named-owner-'))
  try {
    await run('git', ['init', '--object-format=sha1', '--initial-branch=main', root])
    const sources = {
      'Client.ts': `import {validateAndMerge} from './merge.js';\nimport type {InitOptions} from './options.js';\n${Array.from({ length: 250 }, (_, i) => `const unrelated${i} = '${'x'.repeat(55)}';`).join('\n')}\nexport class Client {\n  constructor(options: InitOptions) { validateAndMerge(options); }\n${Array.from({ length: 500 }, (_, i) => `  operation${i}(value: number) { return value + ${i}; }`).join('\n')}\n  beforeError() { return new Error('current error'); }\n  fetch() { return 'original request'; }\n}\n`,
      'merge.ts': `${Array.from({ length: 250 }, (_, i) => `const irrelevant${i} = '${'x'.repeat(55)}';`).join('\n')}\nexport const validateAndMerge = (options: object) => deepMerge({}, options);\nconst deepMerge = (base: object, options: object) => deepMergeInternal(base, options);\nconst deepMergeInternal = (base: object, options: object) => ({...base, ...options});\n`,
      'options.ts': 'export type InitOptions = { enabled?: boolean };\n',
      ...Object.fromEntries(Array.from({ length: 6 }, (_, i) => [`regression${i}.test.ts`, Array.from({ length: 600 }, (_, n) => `test('existing regression ${i} ${n}', () => {});`).join('\n')])),
      'package.json': '{"scripts":{"test":"node --test"}}',
    }
    // A same-named class contains the actual constructor, error and fetch chain.
    assert.ok(Buffer.byteLength(sources['Client.ts']) > 32_768)
    const files = []
    for (const [path, content] of Object.entries(sources)) {
      await writeFile(join(root, path), content)
      const { stdout } = await run('git', ['hash-object', '--no-filters', '--', path], { cwd: root })
      files.push({ path, digest: digestObject({ path, blob: stdout.trim() }) })
    }
    const repository = { canonicalRoot: root, projectId: 'project', operationId: 'operation', workingFiles: files }
    const manifest = { projectId: 'project', operationId: 'operation', references: files.map((f, i) => ({ ref: `ref-${i}`, kind: 'repository_evidence', artifactId: f.path, artifactDigest: f.digest })) }
    const focus = `Modify Client.ts; inspect merge.ts and options.ts; preserve ${Object.keys(sources).filter(p => p.includes('.test.')).join(', ')}.`
    const contents = await new BindingStage(store()).loadFrozenEvidence(repository, manifest, focus)
    const owner = contents.find(c => c.path === 'Client.ts')
    for (const fact of ['export class Client', 'constructor(options: InitOptions)', 'operation0(', 'operation499(', 'beforeError()', "return 'original request'"]) assert.ok(owner.content.includes(fact), `Missing intact owner fact ${fact}`)
    const merge = contents.find(c => c.path === 'merge.ts')
    assert.match(merge.content, /const deepMerge =/)
    assert.match(merge.content, /const deepMergeInternal =/)
    assert.match(contents.find(c => c.path === 'options.ts').content, /type InitOptions/)
    assert.ok(contents.reduce((n, c) => n + Buffer.byteLength(c.content), 0) <= 131_072)
    assert.equal(owner.truncated, true)
    assert.equal(contents.length, files.length)
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('BindingStage preserves an indirectly referenced large request class within the existing single-class envelope', async () => {
  const root = await mkdtemp(join(tmpdir(), 'po-binding-indirect-class-'))
  try {
    await run('git', ['init', '--object-format=sha1', '--initial-branch=main', root])
    const inputs = {
      'index.ts': "import { Client } from './Client.js';\nexport const request = () => Client.create();\n",
      'Client.ts': `export class Client {\n${Array.from({ length: 600 }, (_, i) => `  // ${'request documentation '.repeat(4)}\n  operation${i}(value: number) { return value + ${i}; }`).join('\n')}\n  static create() { return new Client().fetch(); }\n  fetch() { throw new Error('HTTP request failed'); }\n}\n`,
      'Unrelated.ts': `export class Unrelated { ${'/* unused */'.repeat(4000)} }`,
      'package.json': '{"scripts":{"test":"node --test"}}',
    }
    const files = []
    for (const [path, content] of Object.entries(inputs)) {
      await writeFile(join(root, path), content)
      const { stdout } = await run('git', ['hash-object', '--no-filters', '--', path], { cwd: root })
      files.push({ path, digest: digestObject({ path, blob: stdout.trim() }) })
    }
    const repository = { canonicalRoot: root, projectId: 'project', operationId: 'operation', workingFiles: files }
    const manifest = { projectId: 'project', operationId: 'operation', references: files.map((f, i) => ({ ref: `ref-${i}`, kind: 'repository_evidence', artifactId: f.path, artifactDigest: f.digest })) }
    const evidence = await new BindingStage(store()).loadFrozenEvidence(repository, manifest, 'Inspect request in index.ts and preserve the HTTP failure contract.')
    const owner = evidence.find(c => c.path === 'Client.ts')
    for (const fact of ['export class Client', 'static create()', 'operation599(', "throw new Error('HTTP request failed')"]) assert.ok(owner.content.includes(fact), `Missing indirect class fact ${fact}`)
    assert.equal(owner.truncated, true)
    assert.ok(Buffer.byteLength(owner.content) <= 32_768)
    assert.ok(evidence.reduce((n, c) => n + Buffer.byteLength(c.content), 0) <= 131_072)
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('BindingStage reserves command and compiler manifests before large code declaration closures', async () => {
  const root = await mkdtemp(join(tmpdir(), 'po-binding-config-reservation-'))
  try {
    await run('git', ['init', '--object-format=sha1', '--initial-branch=main', root])
    const helpers = Array.from({ length: 14 }, (_, i) => `helper${i}`)
    const sources = {
      'Client.ts': `${helpers.map(h => `import {${h}} from './${h}.js';`).join('\n')}\nexport class Client {\n  constructor() { ${helpers.map(h => `${h}();`).join(' ')} }\n${Array.from({ length: 500 }, (_, i) => `  operation${i}(value: number) { return value + ${i}; }`).join('\n')}\n}\n`,
      ...Object.fromEntries(helpers.map(h => [`${h}.ts`, `const noise = '${'x'.repeat(17000)}';\nexport function ${h}() { return '${'y'.repeat(7000)}'; }\n`])),
      'package.json': JSON.stringify({ name: 'fixture', description: 'Context. '.repeat(400), type: 'module', exports: './dist/index.js', scripts: { test: 'tsc -p tsconfig.test.json && ava', build: 'tsc' }, devDependencies: { ava: '1.0.0', typescript: '5.0.0' }, ava: { extensions: { ts: 'module' } } }),
      'tsconfig.test.json': '{"compilerOptions":{"noEmit":true},"include":["test-d"]}',
      'retry.ts': 'export type RetryOptions = {\n/** Retry timing headers are clamped by maxRetryAfter. @default Infinity */\nmaxRetryAfter?: number;\n/** Exponential retry.delay uses backoffLimit, excluding timing headers. @default Infinity */\nbackoffLimit?: number;\n};\n',
    }
    const files = []
    for (const [path, content] of Object.entries(sources)) {
      await writeFile(join(root, path), content)
      const { stdout } = await run('git', ['hash-object', '--no-filters', '--', path], { cwd: root })
      files.push({ path, digest: digestObject({ path, blob: stdout.trim() }) })
    }
    const repository = { canonicalRoot: root, projectId: 'project', operationId: 'operation', workingFiles: files }
    const manifest = { projectId: 'project', operationId: 'operation', references: files.map((f, i) => ({ ref: `ref-${i}`, kind: 'repository_evidence', artifactId: f.path, artifactDigest: f.digest })) }
    const contents = await new BindingStage(store()).loadFrozenEvidence(repository, manifest, 'Modify Client.ts; inspect RetryOptions in retry.ts and preserve package.json and tsconfig.test.json verification contracts.')
    for (const path of ['package.json', 'tsconfig.test.json']) {
      assert.equal(contents.find(c => c.path === path).content, sources[path], `Missing complete verification manifest ${path}`)
      assert.equal(contents.find(c => c.path === path).truncated, false)
    }
    assert.match(contents.find(c => c.path === 'Client.ts').content, /operation499\(/)
    assert.equal(contents.find(c => c.path === 'retry.ts').content, sources['retry.ts'], 'Declaration comments must retain the field-specific policy ownership under large-class pressure')
    assert.ok(contents.reduce((n, c) => n + Buffer.byteLength(c.content), 0) <= 131_072)
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('BindingStage follows an explicitly requested default export into its local factory', async () => {
  const root = await mkdtemp(join(tmpdir(), 'po-binding-default-owner-'))
  try {
    await run('git', ['init', '--object-format=sha1', '--initial-branch=main', root])
    const path = 'index.ts'
    const content = `${Array.from({ length: 500 }, (_, i) => `const unrelated${i} = '${'x'.repeat(55)}';`).join('\n')}\nconst createInstance = () => ({ extend: () => 'existing defaults' });\nconst client = createInstance();\nexport default client;\n`
    await writeFile(join(root, path), content)
    const { stdout } = await run('git', ['hash-object', '--no-filters', '--', path], { cwd: root })
    const digest = digestObject({ path, blob: stdout.trim() })
    const repository = { canonicalRoot: root, projectId: 'project', operationId: 'operation', workingFiles: [{ path, digest }] }
    const manifest = { projectId: 'project', operationId: 'operation', references: [{ ref: 'ref-entry', kind: 'repository_evidence', artifactId: path, artifactDigest: digest }] }
    const [evidence] = await new BindingStage(store()).loadFrozenEvidence(repository, manifest, 'Inspect defaults and inheritance in index.ts.')
    assert.match(evidence.content, /const client = createInstance\(\)/)
    assert.match(evidence.content, /const createInstance = \(\) => \(\{ extend: \(\) => 'existing defaults' \}\)/)
    assert.ok(Buffer.byteLength(evidence.content) <= 65_536)
    assert.equal(evidence.truncated, true)
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('BindingStage preserves local parameter contracts and whole small forwarding modules under budget pressure', async () => {
  const root = await mkdtemp(join(tmpdir(), 'po-binding-parameter-forwarding-'))
  try {
    await run('git', ['init', '--object-format=sha1', '--initial-branch=main', root])
    const noise = Array.from({ length: 300 }, (_, i) => `export function unrelated${i}(value: string) { return value + '${i}'; }`).join('\n')
    const forwarding = `export {\n${Array.from({ length: 20 }, (_, i) => `  parse${i},`).join('\n')}\n} from './parse-core.js';\n`
    const sources = {
      'api.ts': `import * as util from './util.js';\n${noise}\nexport interface ParameterContract { truthy?: string[]; case?: 'sensitive' | 'insensitive'; }\nexport function transform(options: ParameterContract) { return util.normalizeParams(options.truthy); }\n`,
      'util.ts': `${noise.replaceAll('unrelated', 'utilityNoise')}\nexport function required(value: string) {\n${Array.from({ length: 80 }, (_, i) => `  value += '${i}';`).join('\n')}\n  return value;\n}\nexport function normalizeParams(value: string[] | undefined) { return value ?? []; }\n`,
      'entry.ts': "export * from './forward.js';\n",
      'forward.js': forwarding,
      'parse-core.js': "export const parse0 = value => value;\n",
      ...Object.fromEntries(Array.from({ length: 16 }, (_, i) => [`owner${i}.ts`, `export class Owner${i} {\n${Array.from({ length: 120 }, (_, j) => `  method${j}(value: string) { return value + '${j}'; }`).join('\n')}\n}\n`])),
    }
    const files = []
    for (const [path, content] of Object.entries(sources)) {
      await writeFile(join(root, path), content)
      const { stdout } = await run('git', ['hash-object', '--no-filters', '--', path], { cwd: root })
      files.push({ path, digest: digestObject({ path, blob: stdout.trim() }) })
    }
    const repository = { canonicalRoot: root, projectId: 'project', operationId: 'operation', workingFiles: files }
    const manifest = { projectId: 'project', operationId: 'operation', references: files.map((f, i) => ({ ref: `ref-${i}`, kind: 'repository_evidence', artifactId: f.path, artifactDigest: f.digest })) }
    const focus = `AC-001 [compatibility, required]: Modify transform in api.ts and inspect entry.ts; preserve ${Array.from({ length: 300 }, (_, i) => `unrelated${i}`).join(' ')} ${Array.from({ length: 16 }, (_, i) => `Owner${i} in owner${i}.ts`).join(' ')}.`
    const stage = new BindingStage(store())
    const contents = await stage.loadFrozenEvidence(repository, manifest, focus)
    assert.ok(contents.find(c => c.path === 'api.ts').content.includes('export interface ParameterContract { truthy?: string[]; case?: \'sensitive\' | \'insensitive\'; }'))
    assert.equal(contents.find(c => c.path === 'forward.js').content, forwarding)
    assert.equal(contents.find(c => c.path === 'forward.js').truncated, false)
    assert.match(contents.find(c => c.path === 'util.ts').content, /export function normalizeParams\(/)
    assert.doesNotMatch(contents.find(c => c.path === 'util.ts').content, /export function required\(/, 'A schema label must not become an unrelated runtime root')
    assert.ok(contents.reduce((n, c) => n + Buffer.byteLength(c.content), 0) <= 98_304)
    assert.deepEqual(await stage.loadFrozenEvidence(repository, manifest, focus), contents)
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('BindingStage follows merged constructor initialization and generic defaults without expanding unrelated deferred methods', async () => {
  const root = await mkdtemp(join(tmpdir(), 'po-binding-deferred-'))
  try {
    await run('git', ['init', '--object-format=sha1', '--initial-branch=main', root])
    const noise = Array.from({ length: 500 }, (_, i) => `export function noise${i}() { return '${i}'; }`).join('\n')
    const sources = {
      'api.ts': "import { Schema } from './schema.js';\nexport function convert() { return Schema(); }",
      'schema.ts': `${noise}\nexport interface Schema<T = Internals> { internals: T; }\n// Unicode before the owner: 😀🧪\nexport const Schema = (): Schema => install(initialize(), { convert() { return transform(); }, sibling() { return unrelated(); } });\nconst registry = { value: 1 };\nfunction initialize() { return Object.hasOwn(registry, 'value'); }\nfunction install(value: unknown, methods: unknown) { return { value, methods }; }\nfunction transform() { return true; }\nexport interface Internals { output: boolean; }\nfunction unrelated() { return 'must not expand'; }`,
    }
    const files = []
    for (const [path, content] of Object.entries(sources)) {
      await writeFile(join(root, path), content)
      const { stdout } = await run('git', ['hash-object', '--no-filters', '--', path], { cwd: root })
      files.push({ path, digest: digestObject({ path, blob: stdout.trim() }) })
    }
    const repository = { canonicalRoot: root, projectId: 'project', operationId: 'operation', workingFiles: files }
    const manifest = { projectId: 'project', operationId: 'operation', references: files.map((f, i) => ({ ref: `ref-${i}`, kind: 'repository_evidence', artifactId: f.path, artifactDigest: f.digest })) }
    const evidence = await new BindingStage(store()).loadFrozenEvidence(repository, manifest, 'Modify convert in api.ts.')
    const supplied = evidence.find(c => c.path === 'schema.ts').content
    for (const declaration of ['export const Schema =', 'export interface Schema<', 'export interface Internals', 'const registry =', 'function initialize()', 'function install(', 'function transform()']) assert.ok(supplied.includes(declaration), declaration)
    assert.ok(supplied.includes('sibling() { return unrelated(); }'), 'The actual owner remains intact')
    assert.doesNotMatch(supplied, /function unrelated\(/)
    assert.doesNotMatch(supplied, /function noise/)
    assert.ok(evidence.reduce((n, c) => n + Buffer.byteLength(c.content), 0) <= 98_304)
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('BindingStage preserves complete transitive output type projections without expanding unrelated runtime roots', async () => {
  const root = await mkdtemp(join(tmpdir(), 'po-binding-type-projection-'))
  try {
    await run('git', ['init', '--object-format=sha1', '--initial-branch=main', root])
    const noise = Array.from({ length: 500 }, (_, i) => `export function noise${i}(value: string) { return value + '${i}'; }`).join('\n')
    const sources = {
      'api.ts': `import * as schemas from './schemas.js';\n${noise}\nexport function convert(): schemas.Codec<schemas.Text, schemas.Flag> { return schemas.Codec(schemas.Text, schemas.Flag); }`,
      'schemas.ts': `import * as project from './projection-entry.js';\n${noise}\nexport interface Codec<A, B> { internals: CodecInternals<A, B>; }\nexport const Codec = (text: unknown, flag: unknown) => createCodec(text, flag);\nfunction createCodec(text: unknown, flag: unknown) { return { text, flag, parse: runCodec }; }\nfunction runCodec(value: unknown) { return Flag(value); }\nexport interface Flag<T = unknown> { internals: FlagInternals<T>; }\nexport const Flag = (value: unknown) => typeof value === 'boolean';\nexport interface Text<T = unknown> { internals: ValueInternals<string, T>; }\nexport const Text = (value: unknown) => typeof value === 'string';\nexport interface CodecInternals<A, B> extends ValueInternals<project.Output<B>, project.Input<A>> {}\nexport interface FlagInternals<T> extends ValueInternals<boolean, T> {}\nexport interface ValueInternals<O, I> { output: O; input: I; }\nexport function json() { throw new Error('unrelated path suffix'); }`,
      'projection-entry.ts': "export * from './projection.js';\nexport * from './unrelated-projections.js';",
      'projection.ts': `${noise}\nexport type Output<T> = T extends { internals: { output: infer O } } ? O : unknown;\nexport type Input<T> = T extends { internals: { input: infer I } } ? I : unknown;`,
      'unrelated-projections.ts': `${noise}\nexport function Output(value: unknown) { return value; }\nexport function Input(value: unknown) { return value; }`,
      'public-entry.ts': "export type { Output, Input } from './public-projection.js';",
      'public-projection.ts': `import type * as project from './projection-entry.js';\n${noise}\nexport type Output<T> = project.Output<T>;\nexport type Input<T> = project.Input<T>;`,
      'checks.test.ts': "import * as publicApi from './public-entry.js';\nimport { convert } from './api.js';\nexpectTypeOf<publicApi.Output<ReturnType<typeof convert>>>().toEqualTypeOf<boolean>();\nexpectTypeOf<publicApi.Input<ReturnType<typeof convert>>>().toEqualTypeOf<unknown>();",
      'package.json': '{"scripts":{"test":"node --test"}}',
      ...Object.fromEntries(Array.from({ length: 14 }, (_, i) => [`owner${i}.ts`, `export class Owner${i} {\n${Array.from({ length: 120 }, (_, j) => `method${j}() { return '${j}'; }`).join('\n')}\n}`])),
    }
    const files = []
    for (const [path, content] of Object.entries(sources)) {
      await writeFile(join(root, path), content)
      const { stdout } = await run('git', ['hash-object', '--no-filters', '--', path], { cwd: root })
      files.push({ path, digest: digestObject({ path, blob: stdout.trim() }) })
    }
    const repository = { canonicalRoot: root, projectId: 'project', operationId: 'operation', workingFiles: files }
    const manifest = { projectId: 'project', operationId: 'operation', references: files.map((f, i) => ({ ref: `ref-${i}`, kind: 'repository_evidence', artifactId: f.path, artifactDigest: f.digest })) }
    const focus = `Modify convert in api.ts; preserve checks.test.ts, package.json and ${Array.from({ length: 14 }, (_, i) => `Owner${i} in owner${i}.ts`).join(' ')}.`
    const stage = new BindingStage(store())
    const contents = await stage.loadFrozenEvidence(repository, manifest, focus)
    const printer = ts.createPrinter({ removeComments: true })
    for (const path of ['schemas.ts', 'projection.ts', 'public-projection.ts']) {
      const parsed = ts.createSourceFile(path, sources[path], ts.ScriptTarget.Latest, true)
      const supplied = printer.printFile(ts.createSourceFile(path, contents.find(c => c.path === path).content, ts.ScriptTarget.Latest, true))
      for (const node of parsed.statements.filter(n => ts.isInterfaceDeclaration(n) || ts.isTypeAliasDeclaration(n))) {
        assert.ok(supplied.includes(printer.printNode(ts.EmitHint.Unspecified, node, parsed)), `Missing complete type projection: ${node.name.text}`)
      }
    }
    for (const symbol of ['const Codec =', 'function createCodec(', 'const Flag =', 'const Text =']) assert.ok(contents.find(c => c.path === 'schemas.ts').content.includes(symbol), `Merged type/value owner is missing: ${symbol}`)
    assert.doesNotMatch(contents.find(c => c.path === 'schemas.ts').content, /function noise/)
    assert.doesNotMatch(contents.find(c => c.path === 'schemas.ts').content, /function json/)
    assert.doesNotMatch(contents.find(c => c.path === 'unrelated-projections.ts').content, /function (?:Output|Input)/)
    assert.ok(contents.reduce((n, c) => n + Buffer.byteLength(c.content), 0) <= 65_536)
    assert.deepEqual(await stage.loadFrozenEvidence(repository, manifest, focus), contents)
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('BindingStage keeps late requested symbols and verification configuration inside the shared evidence budget', async () => {
  const root = await mkdtemp(join(tmpdir(), 'po-binding-focused-'))
  try {
    await run('git', ['init', '--object-format=sha1', '--initial-branch=main', root])
    const sources = Object.fromEntries([
      ...Array.from({ length: 5 }, (_, i) => [`unrelated-${i}.md`, 'unrelated documentation\n'.repeat(2_000)]),
      ['api.ts', `import { normalize } from './util.js'\n${'// unrelated declaration\n'.repeat(3_000)}export function stringbool(options: { trim?: boolean }) {\n  return normalize(options)\n}\n`],
      ['stringbool.test.ts', "import { stringbool } from './api.js'\n// existing stringbool fixtures and oracle\n"],
      ['tsconfig.test.json', '{"include":["stringbool.test.ts"]}'],
      ['package.json', '{"scripts":{"test":"tsc -p tsconfig.test.json && vitest run"}}'],
    ])
    const files = []
    for (const [path, content] of Object.entries(sources)) {
      await writeFile(join(root, path), content)
      const { stdout } = await run('git', ['hash-object', '--no-filters', '--', path], { cwd: root })
      files.push({ path, digest: digestObject({ path, blob: stdout.trim() }) })
    }
    const repository = { canonicalRoot: root, projectId: 'project', operationId: 'operation', workingFiles: files }
    const manifest = { projectId: 'project', operationId: 'operation', references: files.map((f, i) => ({ ref: `ref-${i}`, kind: 'repository_evidence', artifactId: f.path, artifactDigest: f.digest })) }
    const focus = 'Add trim to stringbool in api.ts; preserve stringbool.test.ts and tsc -p tsconfig.test.json from package.json.'
    const stage = new BindingStage(store())
    const contents = await stage.loadFrozenEvidence(repository, manifest, focus)
    const api = contents.find(c => c.path === 'api.ts')
    assert.match(api.content, /export function stringbool/)
    assert.match(api.content, /return normalize\(options\)/)
    assert.equal(api.truncated, true)
    assert.equal(contents.find(c => c.path === 'tsconfig.test.json').content, sources['tsconfig.test.json'])
    assert.equal(contents.find(c => c.path === 'package.json').content, sources['package.json'])
    assert.equal(contents.find(c => c.path === 'stringbool.test.ts').content, sources['stringbool.test.ts'])
    assert.ok(contents.reduce((sum, c) => sum + Buffer.byteLength(c.content), 0) <= 65_536)
    assert.deepEqual(await stage.loadFrozenEvidence(repository, manifest, focus), contents)
    await writeFile(join(root, 'api.ts'), `${sources['api.ts']}// drift`)
    await assert.rejects(() => stage.loadFrozenEvidence(repository, manifest, focus), e => e.code === 'repository-evidence-report-stale')
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('BindingStage reserves evidence for transitive declaration owners before unrelated ranked matches', async () => {
  const root = await mkdtemp(join(tmpdir(), 'po-binding-imports-'))
  try {
    await run('git', ['init', '--object-format=sha1', '--initial-branch=main', root])
    const sources = Object.fromEntries([
      ...Array.from({ length: 12 }, (_, i) => [`unrelated-${i}.ts`, '// callback request compatibility\n'.repeat(1_000)]),
      ['api.ts', "import type { Context } from './context.js'\nexport const callback = (c: Context) => c.response()\n"],
      ['api.test.ts', "import { Server } from './server.js'\nimport { callback } from './api.js'\n"],
      ['context.ts', "export class Context { response() { return 'response' } }\n"],
      ['server.ts', "export { Server } from './server-base.js'\n"],
      ['server-base.ts', `${'/**\n * callback request compatibility api.ts onError example\n */\n'.repeat(1_000)}export class Server { onError(error: Error) { throw error } }\n`],
      ['package.json', '{"scripts":{"test":"vitest run"}}'],
    ])
    const files = []
    for (const [path, content] of Object.entries(sources)) {
      await writeFile(join(root, path), content)
      const { stdout } = await run('git', ['hash-object', '--no-filters', '--', path], { cwd: root })
      files.push({ path, digest: digestObject({ path, blob: stdout.trim() }) })
    }
    const repository = { canonicalRoot: root, projectId: 'project', operationId: 'operation', workingFiles: files }
    const manifest = { projectId: 'project', operationId: 'operation', references: files.map((f, i) => ({ ref: `ref-${i}`, kind: 'repository_evidence', artifactId: f.path, artifactDigest: f.digest })) }
    const contents = await new BindingStage(store()).loadFrozenEvidence(repository, manifest, 'Add callback request compatibility in api.ts and api.test.ts; preserve onError.')
    for (const [path, symbol] of [['context.ts', 'class Context'], ['server.ts', 'Server'], ['server-base.ts', 'class Server']]) {
      assert.ok(contents.find(c => c.path === path)?.content.includes(symbol), `Missing transitive owner ${path}`)
    }
    assert.ok(contents.reduce((sum, c) => sum + Buffer.byteLength(c.content), 0) <= 65_536)
    assert.deepEqual(await new BindingStage(store()).loadFrozenEvidence(repository, manifest, 'Add callback request compatibility in api.ts and api.test.ts; preserve onError.'), contents)
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('BindingStage admits selected working-tree evidence and persists a digest-bound Binding', async () => {
  const context = fixture()
  assert.deepEqual(context.manifest.references.map((item) => item.artifactId), ['src/owner.ts', 'tests/owner.test.ts'])
  for (const assessment of context.analysis.bindings[0].impactAssessments) {
    if (!['data', 'consumer'].includes(assessment.dimension)) continue
    assessment.applicability = 'required'
    assessment.evidenceRefs = ['ref-repo-f00001']
    assessment.capabilitySurface = assessment.dimension === 'data' ? 'call_value' : 'local_call'
  }
  const result = await context.stage.persistBindings({
    projectId: 'project-1', operationId: 'operation-1', requirementIds: new Map([['REQ-OWNER', 'project-1:requirement:REQ-OWNER']]),
    repository: context.repository, manifest: context.manifest, analysis: context.analysis, createdAt: now,
  })
  const binding = result.records[0]
  assert.doesNotThrow(() => RequirementCodeBindingRecordSchema.parse(binding))
  assert.deepEqual(binding.evidenceIds, ['src/owner.ts', 'tests/owner.test.ts'])
  assert.deepEqual(binding.impactDimensions, ['domain_owner', 'data', 'consumer'])
  assert.equal(binding.impactAssessments.find(a => a.dimension === 'data').capabilitySurface, 'call_value')
  assert.equal(binding.impactAssessments.find(a => a.dimension === 'consumer').capabilitySurface, 'local_call')
  assert.deepEqual(binding.impactAssessments[0].evidenceIds, ['src/owner.ts'])
  assert.deepEqual(context.storage.requirementCodeBindings.get(binding.id), binding)
  assert.equal(result.subjectDigest, digestObject([binding.bindingDigest]))

  await context.storage.repositorySnapshotsV3.put(context.predecessorRepository.id, context.predecessorRepository)
  const { id: _id, bindingDigest: _digest, createdAt: _createdAt, ...core } = binding
  const inheritedCore = { ...core, operationId: 'predecessor', repositorySnapshotId: context.predecessorRepository.id }
  const predecessorBinding = { id: 'binding-predecessor', ...inheritedCore, bindingDigest: digestObject(inheritedCore), createdAt: now }
  await context.storage.requirementCodeBindings.put(predecessorBinding.id, predecessorBinding)
  const predecessor = { id: 'predecessor', repositorySnapshotId: context.predecessorRepository.id, repositoryDigest: context.repository.repositoryDigest }
  const reused = context.stage.reusePredecessor({ projectId: 'project-1', predecessor, repository: context.repository, manifest: context.manifest, validation: { requirementKeys: ['REQ-OWNER'], allowedEvidenceRefs: context.manifest.references.map((item) => item.ref) } })
  assert.deepEqual(reused, context.analysis)

  await context.storage.requirementCodeBindings.put(predecessorBinding.id, { ...predecessorBinding, allowedPathScopes: ['other/path'] })
  assert.throws(() => context.stage.reusePredecessor({ projectId: 'project-1', predecessor, repository: context.repository, manifest: context.manifest, validation: { requirementKeys: ['REQ-OWNER'], allowedEvidenceRefs: context.manifest.references.map((item) => item.ref) } }), (error) => error.code === 'planning-repair-upstream-stale')
})

test('BindingStage preserves transient event evidence through persistence and predecessor reuse', async () => {
  const context = fixture()
  for (const assessment of context.analysis.bindings[0].impactAssessments) {
    if (!['write_path', 'read_path', 'data', 'test'].includes(assessment.dimension)) continue
    assessment.applicability = 'required'
    assessment.evidenceRefs = ['ref-repo-f00001']
  }
  context.analysis.bindings[0].eventFactChains = [{
    factKey: 'EVENT-NOTIFICATION', eventObservableKey: 'EVT-NOTIFICATION', scenarioKeys: ['SCN-NOTIFICATION'],
    eventTypes: ['completed'], durability: 'transient', recordOwnerSymbols: ['Owner'], persistedCollectionOwnerSymbols: [],
    readSurfaceOwnerSymbols: ['Owner'], producerOwnerSymbols: ['Owner'], fixtureEvidenceRefs: ['ref-repo-f00002'],
    assertionEvidenceRefs: ['ref-repo-f00002'], correlation: 'Listener observes the same task completion.', assertsAbsence: false,
  }]
  const validation = { requirementKeys: ['REQ-OWNER'], allowedEvidenceRefs: context.manifest.references.map(r => r.ref), eventScenarios: [{ key: 'SCN-NOTIFICATION', requirementKey: 'REQ-OWNER', eventObservables: [{ key: 'EVT-NOTIFICATION', expectation: 'present' }] }] }
  parseGeneratedBindingAnalysisV3(JSON.stringify(context.analysis), validation)
  const { records: [binding] } = await context.stage.persistBindings({ projectId: 'project-1', operationId: 'operation-1', requirementIds: new Map([['REQ-OWNER', 'project-1:requirement:REQ-OWNER']]), repository: context.repository, manifest: context.manifest, analysis: context.analysis, createdAt: now })
  assert.equal(binding.eventFactChains[0].durability, 'transient')
  assert.deepEqual(binding.eventFactChains[0].persistedCollectionOwnerSymbols, [])
  assert.equal(RequirementCodeBindingRecordSchema.safeParse({ ...binding, eventFactChains: [{ ...binding.eventFactChains[0], durability: 'persisted' }] }).success, false)
  assert.equal(RequirementCodeBindingRecordSchema.safeParse({ ...binding, eventFactChains: [{ ...binding.eventFactChains[0], persistedCollectionOwnerSymbols: ['Owner'] }] }).success, false)
  await context.storage.repositorySnapshotsV3.put(context.repository.id, context.repository)
  const reused = context.stage.reusePredecessor({ projectId: 'project-1', predecessor: { id: 'operation-1', repositorySnapshotId: context.repository.id, repositoryDigest: context.repository.repositoryDigest }, repository: context.repository, manifest: context.manifest, validation })
  assert.deepEqual(reused, context.analysis)
})

test('BindingStage refuses selected evidence that is absent from the frozen working tree', () => {
  const context = fixture()
  assert.throws(() => context.stage.repositoryReferences(context.repository, { selectedEvidenceIds: ['missing.ts'] }), (error) => error.code === 'repository-evidence-report-stale')
})

test('BindingStage retries an invalid Binding response once and keeps model failures visible', async () => {
  const context = fixture()
  const validation = { requirementKeys: ['REQ-OWNER'], allowedEvidenceRefs: context.manifest.references.map((item) => item.ref) }
  const prompts = []
  const analysis = await context.stage.analyze('Frozen Binding prompt', validation, async (prompt) => {
    prompts.push(prompt)
    return prompts.length === 1 ? '{invalid' : JSON.stringify(context.analysis)
  })
  assert.deepEqual(analysis, context.analysis)
  assert.equal(prompts.length, 2)
  assert.match(prompts[1], /Gate feedback:/u)

  let modelCalls = 0
  await assert.rejects(() => context.stage.analyze('Frozen Binding prompt', validation, async () => {
    modelCalls += 1
    throw new Error('model unavailable')
  }), /model unavailable/u)
  assert.equal(modelCalls, 1)
})

test('BindingStage validates every record before persisting any Binding', async () => {
  const context = fixture()
  const invalid = structuredClone(context.analysis.bindings[0])
  invalid.key = 'BIND-INVALID'
  invalid.impactAssessments = invalid.impactAssessments.map((item) => ({ ...item, applicability: 'not_applicable', evidenceRefs: [] }))
  await assert.rejects(() => context.stage.persistBindings({
    projectId: 'project-1', operationId: 'operation-1', requirementIds: new Map([['REQ-OWNER', 'project-1:requirement:REQ-OWNER']]),
    repository: context.repository, manifest: context.manifest, analysis: { ...context.analysis, bindings: [...context.analysis.bindings, invalid] }, createdAt: now,
  }), /impactDimensions/u)
  assert.equal([...context.storage.requirementCodeBindings.entries()].length, 0)
})

test('BindingStage prompt projects frozen evidence and gates unknown-stage compatibility by source', () => {
  const context = fixture()
  const analysis = { requirements: [{ key: 'REQ-OWNER', scope: 'in_scope', statement: 'Preserve src/owner.ts; add tests/new-owner.test.ts; inspect existing.ts.' }] }
  context.repository.workingFiles.push({ path: 'existing.ts', digest: 'a'.repeat(64) })
  const scenarios = [{ id: 'database-scenario-1', projectId: 'project-1', operationId: 'operation-1', requirementId: 'requirement-1', acceptanceCriterionId: 'acceptance-1', key: 'SCN-OWNER', scenarioDigest: 'f'.repeat(64), createdAt: now }]
  const ordinary = buildBindingPromptV3(analysis, scenarios, context.repository, context.manifest, false)
  const compatible = buildBindingPromptV3(analysis, scenarios, context.repository, context.manifest, true)
  assert.doesNotMatch(ordinary, /The target change must give the persisted PlanningStageAttempt stage identifier/u)
  assert.match(compatible, /The target change must give the persisted PlanningStageAttempt stage identifier/u)
  assert.match(ordinary, /ref-repo-f00001/u)
  assert.match(ordinary, /binding-capability-surfaces-v1/u)
  assert.match(ordinary, /src\/owner\.ts/u)
  assert.doesNotMatch(ordinary, /database-scenario-1/u)
  assert.match(ordinary, /Requirement or Acceptance keys/u)
  const facts = JSON.parse(ordinary.split('\n\nRequested file inventory facts (not write authorization):\n')[1].split('\nAn absent frozen path')[0])
  assert.deepEqual(facts, [
    { path: 'src/owner.ts', existsInFrozenInventory: true, evidenceRef: 'ref-repo-f00001' },
    { path: 'tests/new-owner.test.ts', existsInFrozenInventory: false, evidenceRef: null },
    { path: 'existing.ts', existsInFrozenInventory: true, evidenceRef: null },
  ])
})

test('BindingStage prompt scans long dollar path tokens once and retains sentence-ending paths', { timeout: 5000 }, () => {
  const context = fixture()
  const path = `${'$'.repeat(18000)}.ts`
  const analysis = { requirements: [{ key: 'REQ-OWNER', scope: 'in_scope', statement: `Inspect ${path} and src/owner.ts.` }] }
  const prompt = buildBindingPromptV3(analysis, [], context.repository, context.manifest, false)
  const facts = JSON.parse(prompt.split('\n\nRequested file inventory facts (not write authorization):\n')[1].split('\nAn absent frozen path')[0])
  assert.deepEqual(facts, [
    { path, existsInFrozenInventory: false, evidenceRef: null },
    { path: 'src/owner.ts', existsInFrozenInventory: true, evidenceRef: 'ref-repo-f00001' },
  ])
})
