import assert from 'node:assert/strict'
import { readFile, writeFile } from 'node:fs/promises'
import { resolve, join } from 'node:path'

// Authorized by the user's explicit confirmation of this exact nine-claim list.
const base = 'http://127.0.0.1:3087'
const projectId = 'ac9fafa7-c07b-4802-a177-6f4c986130bc'
const evidence = JSON.parse(await readFile(resolve('output/acceptance/canary-capability-review-revised-2026-10-15.json'), 'utf8'))
const prepared = JSON.parse(await readFile(resolve('output/acceptance/isolated-harness-2026-10-14.json'), 'utf8'))
const request = async (path, body) => {
  const response = await fetch(`${base}/project-orchestrator/api${path}`, {
    method: body === undefined ? 'GET' : 'POST', headers: { origin: base, 'content-type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(30_000),
  })
  const data = await response.json()
  if (!response.ok) throw new Error(`${path}: HTTP ${response.status}: ${data.error?.code ?? 'unknown'}`)
  return data
}
const snapshot = await request('/snapshot')
const project = snapshot.projects.find(item => item.id === projectId)
assert.equal(project?.cwd, join(prepared.root, 'workspaces/greeting'))
assert.equal(project.status, 'draft')
assert.equal(evidence.projectId, projectId)
const common = ['api.contract', 'language.typescript', 'reliability.failure-handling', 'testing.automation']
const expected = new Set([
  ...common.map(id => `default-agent-software-engineer:${id}`),
  ...[...common, 'testing.verification'].map(id => `default-agent-test-engineer:${id}`),
])
assert.equal(evidence.pendingClaims.length, 9)
assert.deepEqual(new Set(evidence.pendingClaims.map(item => `${item.agentId}:${item.capabilityId}`)), expected)
const current = await request(`/projects/${projectId}/capability-claims`)
for (const pending of evidence.pendingClaims) {
  const live = current.find(item => item.id === pending.id)
  assert.equal(live?.claimDigest, pending.claimDigest)
  assert.equal(live?.capabilityVersion, 1)
  assert.equal(live?.status, 'pending')
  assert.equal(live?.source, 'legacy_pending_mapping')
  const definition = snapshot.capabilityDefinitions.find(item => item.id === pending.capabilityId)
  assert.equal(definition?.version, live.capabilityVersion)
  assert.equal(definition?.status, 'active')
}
const alreadyConfirmed = current.filter(item => expected.has(`${item.agentId}:${item.capabilityId}`) && item.status === 'active' && item.source === 'human_confirmed')
const actor = '用户（明确确认隔离 greeting 项目的9项能力）'
const body = {
  actor, reason: '用户回复“确认这 9 项并登记”；范围仅为已审阅的隔离 greeting 项目能力清单。',
  evidenceRef: 'docs/canary-capability-revision-2026-10-15.zh-CN.md; request_user_input_async/call_bdd58412a864495794e7ef915657d4b3',
  claims: evidence.pendingClaims.map(item => ({ claimId: item.id, expectedClaimDigest: item.claimDigest })),
}
const result = alreadyConfirmed.length === 9 ? { claims: alreadyConfirmed, project } : await request(`/projects/${projectId}/capability-claims/confirm`, body)
assert.equal(result.claims.length, 9)
assert.deepEqual(new Set(result.claims.map(item => `${item.agentId}:${item.capabilityId}`)), expected)
assert.equal(result.claims.every(item => item.status === 'active' && item.source === 'human_confirmed' && item.confirmedBy === actor), true)
const stored = await request(`/projects/${projectId}/capability-claims`)
assert.equal(result.claims.every(item => stored.some(live => live.id === item.id && live.claimDigest === item.claimDigest)), true)
await writeFile(resolve('output/acceptance/canary-capabilities-confirmed-2026-10-15.json'), `${JSON.stringify({ observedAt: new Date().toISOString(), projectId, authorization: body, result, persisted: true }, null, 2)}\n`)
console.log(JSON.stringify({ projectId, confirmed: result.claims.length, persisted: true, projectStatus: result.project.status }))
