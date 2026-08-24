import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { transform } from 'esbuild'

const source = await readFile(new URL('../src/squad-ui.ts', import.meta.url), 'utf8')
const compiled = await transform(source, { format: 'esm', loader: 'ts', target: 'node22' })
const { squadUiDiagnostics } = await import(`data:text/javascript;base64,${Buffer.from(compiled.code).toString('base64')}`)

function agent(id, role, toolPolicy) {
  return { id, name: role, role, toolPolicy }
}

function diagnostics(softwareEngineer) {
  const reviewer = agent('reviewer', 'Code Reviewer', 'read_only')
  return squadUiDiagnostics({
    instructions: 'Delegate bounded work with explicit evidence, then integrate and independently verify every member result.',
    customInstructions: '',
    memberAgentIds: [softwareEngineer.id, reviewer.id],
    memberRoles: { [softwareEngineer.id]: 'Software Engineer', [reviewer.id]: 'Code Reviewer' },
    leaderAgentId: reviewer.id,
    maxParallelDelegations: 2,
    agents: [softwareEngineer, reviewer],
  })
}

test('Squad diagnostics recognizes the default executable Software Engineer role', () => {
  const result = diagnostics(agent('engineer', 'Software Engineer', 'full'))
  assert.equal(result.some((item) => item.code === 'implementation_member_missing'), false)
  assert.equal(result.some((item) => item.code === 'verification_member_missing'), false)
})

test('Squad diagnostics still rejects a read-only Software Engineer', () => {
  const result = diagnostics(agent('engineer', 'Software Engineer', 'read_only'))
  assert.equal(result.some((item) => item.code === 'implementation_member_missing'), true)
  assert.equal(result.some((item) => item.code === 'read_only_implementation:engineer'), true)
})
