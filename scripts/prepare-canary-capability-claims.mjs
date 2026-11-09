import assert from 'node:assert/strict'
import { readFile, writeFile } from 'node:fs/promises'
import { resolve, join } from 'node:path'

// Only prepare untrusted declarations in the existing isolated canary Profile.
// Human confirmation is a separate, explicit API operation.
const apply = process.argv.includes('--apply')
const base = 'http://127.0.0.1:3087'
const projectId = 'ac9fafa7-c07b-4802-a177-6f4c986130bc'
const prepared = JSON.parse(await readFile(resolve('output/acceptance/isolated-harness-2026-10-14.json'), 'utf8'))
const request = async (path, method = 'GET', body) => {
  const response = await fetch(`${base}/project-orchestrator/api${path}`, {
    method, headers: { origin: base, 'content-type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(30_000),
  })
  const data = await response.json()
  if (!response.ok) throw new Error(`${method} ${path}: HTTP ${response.status}: ${data.error?.code ?? 'unknown'}`)
  return data
}
const snapshot = await request('/snapshot')
const project = snapshot.projects.find(item => item.id === projectId)
assert.equal(project?.cwd, join(prepared.root, 'workspaces/greeting'))
assert.equal(project.status, 'draft', 'Prepare declarations only before planning or approval.')
const common = ['api.contract', 'language.typescript', 'reliability.failure-handling', 'testing.automation']
const declarations = [
  { agentId: 'default-agent-software-engineer', required: common },
  { agentId: 'default-agent-test-engineer', required: [...common, 'testing.verification'] },
]
const inputKeys = ['name', 'role', 'description', 'persona', 'provider', 'model', 'preset', 'toolPolicy', 'skills', 'capabilities', 'runtimeId', 'access', 'maxConcurrency']
const result = { projectId, baseUrl: base, applied: apply, observedAt: new Date().toISOString(), declarations: [] }
for (const declaration of declarations) {
  const agent = snapshot.agents.find(item => item.id === declaration.agentId)
  assert.equal(agent?.status, 'active')
  const input = Object.fromEntries(inputKeys.filter(key => agent[key] !== undefined).map(key => [key, agent[key]]))
  input.capabilities = [...new Set([...agent.capabilities, ...declaration.required])]
  const record = { agentId: agent.id, beforeCapabilities: agent.capabilities, proposedCapabilities: input.capabilities }
  if (apply && JSON.stringify(input.capabilities) !== JSON.stringify(agent.capabilities)) {
    const updated = await request(`/agents/${encodeURIComponent(agent.id)}`, 'PUT', input)
    assert.deepEqual(updated.capabilities, input.capabilities)
  }
  result.declarations.push(record)
}
result.claims = (await request(`/projects/${projectId}/capability-claims`)).map(({ id, agentId, capabilityId, capabilityVersion, source, status, claimDigest }) => ({ id, agentId, capabilityId, capabilityVersion, source, status, claimDigest }))
await writeFile(resolve('output/acceptance/canary-pending-declarations-2026-10-15.json'), `${JSON.stringify(result, null, 2)}\n`)
console.log(JSON.stringify({ projectId, applied: apply, declarationCount: declarations.reduce((sum, item) => sum + item.required.length, 0), trustedClaimsCreated: 0 }))
