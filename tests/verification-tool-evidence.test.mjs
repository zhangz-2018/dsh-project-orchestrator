import assert from 'node:assert/strict'
import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import * as plugin from '../lib/index.js'

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
