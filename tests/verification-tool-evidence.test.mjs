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
