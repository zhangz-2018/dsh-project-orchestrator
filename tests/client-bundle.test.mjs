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
