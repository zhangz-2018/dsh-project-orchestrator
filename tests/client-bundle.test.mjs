import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import vm from 'node:vm'

test('client bundle registers with the Harness module loader', async () => {
  const source = await readFile(new URL('../lib/client.js', import.meta.url), 'utf8')
  let registration
  const context = {
    window: {
      __ModuleLoader__: {
        load(value) { registration = value },
      },
    },
    console,
  }
  vm.runInNewContext(source, context, { filename: 'client.js' })
  assert.equal(registration.id, 'dsh-project-orchestrator')
  const dependency = new Proxy({}, { get: () => () => null })
  const exported = registration.factory(() => dependency)
  assert.equal(typeof exported.apply, 'function')
  assert.deepEqual(Array.from(exported.inject), ['slots'])
})

test('client exposes explicit empty and AI creation actions', async () => {
  const source = await readFile(new URL('../src/client.tsx', import.meta.url), 'utf8')
  const bundle = await readFile(new URL('../lib/client.js', import.meta.url), 'utf8')
  assert.match(source, /空项目/)
  assert.match(source, /AI 智能拆解/)
  assert.match(source, /创建空项目/)
  assert.match(source, /创建并让 AI 拆解/)
  assert.match(source, /本地代码仓库/)
  assert.match(source, /GitHub 仓库/)
  assert.match(source, /选择目录/)
  assert.match(source, /拉取分支/)
  assert.match(source, /从 Issues 自动创建事项/)
  assert.match(source, /打开目录/)
  assert.match(source, /PROJECT_INTAKE_DRAFT_TTL_MS/)
  assert.match(source, /AbortController/)
  assert.match(source, /repositoryRequestVersion/)
  assert.doesNotMatch(source, /localStorage\.setItem\(PROJECT_INTAKE_STORAGE_KEY, JSON\.stringify\(value\)\)/)
  assert.match(bundle, /repositories\/inspect/)
  assert.match(bundle, /open-directory/)
})
