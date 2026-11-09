import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import * as plugin from '../lib/index.js'

test('Verification tool evidence follows declared script runners without executing scripts or unrelated lifecycle hooks', async () => {
  const root = await mkdtemp(join(tmpdir(), 'po-tool-script-graph-'))
  try {
    const modules = join(root, 'node_modules')
    await mkdir(join(modules, '.bin'), { recursive: true })
    for (const name of ['runtime-checker', 'type-checker', 'publish-checker']) {
      await mkdir(join(modules, name))
      await writeFile(join(modules, name, 'package.json'), JSON.stringify({ name, version: '1.2.3', bin: './cli.js' }))
      await writeFile(join(modules, name, 'cli.js'), "throw new Error('SCRIPT_MUST_NOT_EXECUTE');\n")
      await symlink(`../${name}/cli.js`, join(modules, '.bin', name))
    }
    const evidence = await plugin.captureVerificationToolEvidenceV3(root, {
      devDependencies: { 'runtime-checker': '1.2.3', 'type-checker': '1.2.3', 'publish-checker': '1.2.3' },
      scripts: {
        test: 'npm-run-all --silent unit compile-types',
        unit: 'runtime-checker && npm run nested',
        'compile-types': 'pnpm run nested',
        nested: 'type-checker && npm run unit',
        postinstall: 'publish-checker',
      },
    })
    assert.deepEqual(evidence.map(tool => tool.packageName), ['runtime-checker', 'type-checker'])
    assert.ok(evidence.every(tool => tool.files.some(file => file.content.includes('SCRIPT_MUST_NOT_EXECUTE'))))
    const direct = await plugin.captureVerificationToolEvidenceV3(root, {
      devDependencies: { 'runtime-checker': '1.2.3', 'publish-checker': '1.2.3' },
      scripts: { test: 'echo unit', unit: 'runtime-checker', postinstall: 'publish-checker' },
    })
    assert.deepEqual(direct, [], 'Text naming a script does not prove a runner invokes it.')
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('Verification tool evidence freezes installed entry closure, rejects drift and never treats it as repository ownership', async () => {
  const root = await mkdtemp(join(tmpdir(), 'po-tool-evidence-'))
  try {
    const repository = join(root, 'repo')
    const tool = join(root, 'node_modules/type-checker')
    await mkdir(repository)
    await mkdir(join(tool, 'source'), { recursive: true })
    await mkdir(join(root, 'node_modules/.bin'))
    await writeFile(join(tool, 'package.json'), JSON.stringify({ name: 'type-checker', version: '1.2.3', bin: './source/cli.js' }))
    await writeFile(join(tool, 'source/cli.js'), "import './runner.js';\n")
    await writeFile(join(tool, 'source/runner.js'), "export const files = ['test-d'];\n")
    await symlink('../type-checker/source/cli.js', join(root, 'node_modules/.bin/type-checker'))
    const manifest = { devDependencies: { 'type-checker': '^1.2.3' }, scripts: { test: 'node --test && type-checker' } }
    assert.equal(typeof plugin.captureVerificationToolEvidenceV3, 'function')
    const capture = () => plugin.captureVerificationToolEvidenceV3(repository, manifest)
    const initial = await capture()
    assert.equal(initial.length, 1)
    assert.equal(initial[0].version, '1.2.3')
    assert.equal(initial[0].binName, 'type-checker')
    assert.deepEqual(initial[0].files.map(f => f.path), ['package.json', 'source/cli.js', 'source/runner.js'])
    assert.ok(initial[0].files.every(f => f.truncated === false))
    assert.deepEqual(await capture(), initial)
    await writeFile(join(tool, 'source/runner.js'), "export const files = ['other'];\n")
    assert.notDeepEqual(await capture(), initial, 'Tool source changes must invalidate frozen evidence.')
    await writeFile(join(tool, 'package.json'), JSON.stringify({ name: 'type-checker', version: '2.0.0', bin: './source/cli.js' }))
    assert.deepEqual(await capture(), [], 'A mismatched installed dependency is not evidence of the declared tool.')
    await writeFile(join(tool, 'package.json'), JSON.stringify({ name: 'type-checker', version: '1.2.3', bin: './source/cli.js' }))
    await writeFile(join(tool, 'source/cli.js'), "import './outside.js';\n")
    await writeFile(join(root, 'outside.js'), 'SECRET_SENTINEL\n')
    await symlink(join(root, 'outside.js'), join(tool, 'source/outside.js'))
    const escaped = await capture()
    assert.ok(!JSON.stringify(escaped).includes('SECRET_SENTINEL'))
    assert.deepEqual(escaped[0].unavailablePaths, ['source/outside.js'])
    assert.deepEqual(await plugin.captureVerificationToolEvidenceV3(repository, { ...manifest, scripts: { test: 'node --test' } }), [])
    await rm(tool, { recursive: true })
    assert.deepEqual(await capture(), [])
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('Verification tool evidence keeps command-order compiler evidence within the four-tool budget', async () => {
  const root = await mkdtemp(join(tmpdir(), 'po-tool-priority-'))
  try {
    await mkdir(join(root, 'node_modules/.bin'), { recursive: true })
    const dependencies = {}
    for (const [name, binName] of [['typescript', 'tsc'], ['a-checker', 'a-checker'], ['b-checker', 'b-checker'], ['c-checker', 'c-checker'], ['d-checker', 'd-checker']]) {
      const tool = join(root, 'node_modules', name)
      await mkdir(tool)
      await writeFile(join(tool, 'package.json'), JSON.stringify({ name, version: '1.2.3', bin: { [binName]: './cli.js' } }))
      await writeFile(join(tool, 'cli.js'), 'module.exports = {};\n')
      await symlink(`../${name}/cli.js`, join(root, 'node_modules/.bin', binName))
      dependencies[name] = '1.2.3'
    }
    const tools = await plugin.captureVerificationToolEvidenceV3(root, {
      devDependencies: dependencies, scripts: { test: 'tsc && a-checker && b-checker && c-checker && d-checker' },
    })
    assert.equal(tools.length, 4)
    assert.deepEqual(tools.map(tool => tool.packageName), ['a-checker', 'b-checker', 'c-checker', 'typescript'])
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('Verification tool evidence resolves CommonJS extension and directory entries without executing them', async () => {
  const root = await mkdtemp(join(tmpdir(), 'po-tool-commonjs-evidence-'))
  try {
    const repository = join(root, 'repo')
    const tool = join(root, 'node_modules/type-checker')
    await mkdir(repository)
    await mkdir(join(tool, 'lib/runner'), { recursive: true })
    await mkdir(join(root, 'node_modules/.bin'))
    await writeFile(join(tool, 'package.json'), JSON.stringify({ name: 'type-checker', version: '1.2.3', bin: './cli.js' }))
    await writeFile(join(tool, 'cli.js'), "require('./lib');\n")
    await writeFile(join(tool, 'lib/index.js'), "require('./runner'); require('./options'); require('./outside');\n")
    await writeFile(join(tool, 'lib/runner/index.js'), "throw new Error('TOOL_MUST_NOT_EXECUTE');\n")
    await writeFile(join(tool, 'lib/options.json'), '{"files":"test-d"}\n')
    await writeFile(join(root, 'outside.js'), 'SECRET_SENTINEL\n')
    await symlink(join(root, 'outside.js'), join(tool, 'lib/outside.js'))
    await symlink('../type-checker/cli.js', join(root, 'node_modules/.bin/type-checker'))
    const evidence = await plugin.captureVerificationToolEvidenceV3(repository, {
      devDependencies: { 'type-checker': '^1.2.3' }, scripts: { test: 'type-checker' },
    })
    assert.equal(evidence.length, 1)
    assert.deepEqual(evidence[0].files.map(f => f.path), ['cli.js', 'lib/index.js', 'lib/options.json', 'lib/runner/index.js', 'package.json'])
    assert.ok(evidence[0].files.some(f => f.content.includes('TOOL_MUST_NOT_EXECUTE')))
    assert.ok(!JSON.stringify(evidence).includes('SECRET_SENTINEL'))
    assert.ok(evidence[0].unavailablePaths.some(p => p.includes('outside')))
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('Verification tool evidence does not mark captured duplicate imports unavailable when its budget ends', async () => {
  const root = await mkdtemp(join(tmpdir(), 'po-tool-budget-evidence-'))
  try {
    const tool = join(root, 'node_modules/type-checker')
    await mkdir(tool, { recursive: true })
    await mkdir(join(root, 'node_modules/.bin'))
    await writeFile(join(tool, 'package.json'), JSON.stringify({ name: 'type-checker', version: '1.2.3', bin: './cli.js' }))
    const imports = []
    for (let index = 0; index < 30; index++) {
      await writeFile(join(tool, `part-${index}.js`), 'module.exports = {};\n')
      imports.push(`require('./part-${index}');`)
    }
    await writeFile(join(tool, 'cli.js'), `${imports.join('\n')}\nrequire('./part-0');\n`)
    await symlink('../type-checker/cli.js', join(root, 'node_modules/.bin/type-checker'))
    const [evidence] = await plugin.captureVerificationToolEvidenceV3(root, { devDependencies: { 'type-checker': '1.2.3' }, scripts: { test: 'type-checker' } })
    assert.ok(evidence.files.length <= 24, 'Keep the existing source budget')
    assert.ok(evidence.unavailablePaths.length > 0, 'Unvisited files must remain explicit gaps')
    for (const file of evidence.files) assert.ok(!evidence.unavailablePaths.includes(file.path), `${file.path} was already captured`)
    assert.ok(evidence.unavailablePaths.includes('part-29.js'))
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('Verification tool evidence freezes bounded AST excerpts of an oversized installed compiler without execution', async () => {
  const root = await mkdtemp(join(tmpdir(), 'po-tool-compiler-excerpts-'))
  try {
    const tool = join(root, 'node_modules/typescript')
    await mkdir(join(tool, 'lib'), { recursive: true })
    await mkdir(join(root, 'node_modules/.bin'))
    await writeFile(join(tool, 'package.json'), JSON.stringify({ name: 'typescript', version: '6.0.3', bin: { tsc: './cli.js' } }))
    await writeFile(join(tool, 'cli.js'), "require('./lib/compiler.js');\n")
    await symlink('../typescript/cli.js', join(root, 'node_modules/.bin/tsc'))
    const body = 'function getMergedBindAndCheckDiagnostics() { throw new Error("MUST_NOT_EXECUTE"); }'
    const source = `// ${'unselected '.repeat(9000)}\n${body}\nfunction unrelated() { return 'NOT_CAPTURED'; }\n`
    await writeFile(join(tool, 'lib/compiler.js'), source)
    const manifest = { devDependencies: { typescript: '^6.0.3' }, scripts: { typecheck: 'tsc -p tsconfig.json' } }
    const [evidence] = await plugin.captureVerificationToolEvidenceV3(root, manifest)
    assert.equal(evidence.sourceExcerpts?.length, 1)
    const excerpt = evidence.sourceExcerpts[0]
    assert.equal(excerpt.content, body)
    assert.equal(excerpt.symbol, 'getMergedBindAndCheckDiagnostics')
    assert.equal(excerpt.path, 'lib/compiler.js')
    assert.equal(excerpt.sourceDigest, createHash('sha256').update(source).digest('hex'))
    assert.equal(excerpt.sourceBytes, Buffer.byteLength(source))
    assert.equal(excerpt.digest, createHash('sha256').update(body).digest('hex'))
    assert.equal(source.slice(excerpt.startOffset, excerpt.endOffset), body)
    assert.equal(excerpt.startLine, 2)
    assert.equal(excerpt.endLine, 2)
    assert.ok(evidence.unavailablePaths.includes('lib/compiler.js'), 'The complete compiler remains unavailable; excerpts prove only their own content.')
    assert.ok(!JSON.stringify(evidence).includes('NOT_CAPTURED'))
    assert.ok(evidence.files.reduce((sum, file) => sum + Buffer.byteLength(file.content), 0) + Buffer.byteLength(excerpt.content) <= 98_304)
    plugin.VerificationToolEvidenceV3Schema.parse(evidence)
    await writeFile(join(tool, 'lib/compiler.js'), source.replace('NOT_CAPTURED', 'CHANGED_OUTSIDE_EXCERPT'))
    const [changed] = await plugin.captureVerificationToolEvidenceV3(root, manifest)
    assert.equal(changed.sourceExcerpts[0].digest, excerpt.digest)
    assert.notEqual(changed.sourceExcerpts[0].sourceDigest, excerpt.sourceDigest, 'Unselected source drift must invalidate the evidence too.')
    const budgetSource = ['executeCommandLine', 'performCompilation', 'createCommentDirectivesMap']
      .map(name => `function ${name}() { return '${'x'.repeat(48_000)}'; }`).join('\n')
    await writeFile(join(tool, 'lib/compiler.js'), budgetSource)
    const [bounded] = await plugin.captureVerificationToolEvidenceV3(root, manifest)
    assert.ok(bounded.sourceExcerpts.length > 0 && bounded.sourceExcerpts.length < 3)
    assert.ok([...bounded.files, ...bounded.sourceExcerpts].reduce((sum, file) => sum + Buffer.byteLength(file.content), 0) <= 98_304)
    for (const item of bounded.sourceExcerpts) assert.equal(item.content, budgetSource.slice(item.startOffset, item.endOffset), 'Keep entire AST nodes within the shared budget.')
    await writeFile(join(tool, 'lib/compiler.js'), `// ${'x'.repeat(8_388_608)}\n${body}`)
    const [oversized] = await plugin.captureVerificationToolEvidenceV3(root, manifest)
    assert.equal(oversized.sourceExcerpts, undefined, 'Bound the local parser input as well as the supplied text.')
    await rm(join(tool, 'lib/compiler.js'))
    await writeFile(join(root, 'outside.js'), `// ${'x'.repeat(70_000)}\nfunction executeCommandLine() { return 'OUTSIDE_COMPILER_SENTINEL'; }`)
    await symlink(join(root, 'outside.js'), join(tool, 'lib/compiler.js'))
    const [escaped] = await plugin.captureVerificationToolEvidenceV3(root, manifest)
    assert.equal(escaped.sourceExcerpts, undefined)
    assert.ok(!JSON.stringify(escaped).includes('OUTSIDE_COMPILER_SENTINEL'), 'Excerpt fallback must preserve package-root isolation.')
  } finally { await rm(root, { recursive: true, force: true }) }
})
