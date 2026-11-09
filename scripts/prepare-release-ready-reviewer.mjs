import assert from 'node:assert/strict'
import { access, readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'

// Prepare the missing review prerequisite before Gold or candidates exist.
// This does not confirm executor capabilities or authorize task dispatch.
const prepared = JSON.parse(await readFile(resolve('output/acceptance/release-task-boundary-projects-2026-10-16.json'), 'utf8'))
const reviewerId = 'b6a7f6c6-d2b9-41f0-b1a6-c73007232a16'
assert.equal(prepared.baseUrl, 'http://127.0.0.1:3087')
const request = async (path, body) => {
  const response = await fetch(`${prepared.baseUrl}/project-orchestrator/api${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { origin: prepared.baseUrl, 'content-type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(30_000),
  })
  const value = await response.json()
  assert.ok(response.ok, `${path}: HTTP ${response.status} ${value.error?.code ?? ''}`)
  return value
}
const snapshot = await request('/snapshot')
const reviewer = snapshot.agents.find((a) => a.id === reviewerId)
assert.equal(reviewer?.status, 'active')
assert.deepEqual(reviewer.capabilities, [])
const selected = prepared.projects.filter((p) => p.expectedReadiness === 'ready')
assert.equal(selected.length, 16)
for (const item of selected) {
  assert.equal(snapshot.projects.find((p) => p.id === item.projectId)?.status, 'draft')
  assert.equal((await request(`/projects/${item.projectId}/planning-operations`)).length, 0)
  try {
    await access(resolve('planning-evals/cases', item.caseId, 'gold.json'))
    assert.fail(`Gold already exists for ${item.caseId}; do not change frozen inputs.`)
  } catch (error) { if (error.code !== 'ENOENT') throw error }
}
const reportPath = resolve('output/acceptance/release-ready-reviewer-prepared-2026-10-16.json')
const report = { baseUrl: prepared.baseUrl, reviewerId, startedAt: new Date().toISOString(), projects: [], humanAttestationsCreated: 0, modelRequests: 0 }
await writeFile(reportPath, JSON.stringify(report, null, 2), { flag: 'wx' })
for (const item of selected) {
  const claimsBefore = await request(`/projects/${item.projectId}/capability-claims`)
  const before = await request(`/projects/${item.projectId}/planning-evaluation-input`)
  await request(`/projects/${item.projectId}/agents`, { agentId: reviewerId, deliveryRoles: ['reviewer'], autoAssignable: false, joinedBy: 'authorized-isolated-benchmark-review-preparation' })
  const live = await request('/snapshot')
  const membership = live.projectAgentMemberships.find((m) => m.projectId === item.projectId && m.agentId === reviewerId)
  assert.equal(membership?.status, 'active')
  assert.equal(membership.autoAssignable, false)
  assert.deepEqual(membership.deliveryRoles, ['reviewer'])
  assert.deepEqual(await request(`/projects/${item.projectId}/capability-claims`), claimsBefore)
  assert.equal((await request(`/projects/${item.projectId}/planning-operations`)).length, 0)
  const after = await request(`/projects/${item.projectId}/planning-evaluation-input`)
  const { teamCatalogDigest: previousTeam, ...previousFacts } = before.releaseInput
  const { teamCatalogDigest: currentTeam, ...currentFacts } = after.releaseInput
  assert.notEqual(currentTeam, previousTeam)
  assert.deepEqual(currentFacts, previousFacts, 'Only team review membership may change.')
  report.projects.push({ caseId: item.caseId, projectId: item.projectId, membership, previousReleaseInput: before.releaseInput, releaseInput: after.releaseInput, unchangedClaims: claimsBefore.length })
  await writeFile(reportPath, JSON.stringify(report, null, 2))
}
report.completedAt = new Date().toISOString()
await writeFile(reportPath, JSON.stringify(report, null, 2))
console.log(JSON.stringify({ reportPath, reviewerId, projects: report.projects.length, humanAttestationsCreated: 0, modelRequests: 0 }))
