import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'

// Prepare untrusted mappings for review, never human-confirmed facts.
const review = JSON.parse(await readFile(resolve('output/acceptance/release-capability-gap-preflight-2026-10-16/summary.json'), 'utf8'))
const prepared = JSON.parse(await readFile(resolve('output/acceptance/release-projects-2026-10-16.json'), 'utf8'))
const request = async (path, method = 'GET', body) => {
  const response = await fetch(`${prepared.baseUrl}/project-orchestrator/api${path}`, { method, headers: { origin: prepared.baseUrl, 'content-type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(30_000) })
  const data = await response.json()
  assert.ok(response.ok, `${path}: HTTP ${response.status} ${data.error?.code ?? ''}`)
  return data
}
const snapshot = await request('/snapshot')
assert.equal(review.reports.length, 8)
const declarations = review.reports.flatMap(repo => {
  assert.equal(repo.status, 'review_completed')
  return repo.reviews.flatMap(item => {
    assert.equal(item.status, 'complete')
    const project = prepared.projects.find(p => p.caseId === item.caseId)
    assert.ok(project)
    return item.missing.flatMap(missing => missing.deliveryRoles.map(role => {
      const agentId = prepared.agents.find(a => a.deliveryRole === role)?.id
      assert.ok(agentId)
      assert.ok(snapshot.projectAgentMemberships.some(m => m.projectId === project.projectId && m.agentId === agentId && m.status === 'active' && m.deliveryRoles.includes(role)))
      assert.ok(!snapshot.agentCapabilityClaims.some(c => c.projectId === project.projectId && c.agentId === agentId && c.capabilityId === missing.capabilityId && c.source === 'human_confirmed' && c.status === 'active'))
      assert.ok(['data.change', 'domain.state', 'integration.consumer'].includes(missing.capabilityId))
      return { caseId: item.caseId, projectId: project.projectId, agentId, role, capabilityId: missing.capabilityId, reason: missing.reason, sourcePaths: missing.sourcePaths }
    }))
  })
})
assert.equal(declarations.length, 48)
assert.equal(new Set(declarations.map(c => `${c.projectId}:${c.agentId}:${c.capabilityId}`)).size, 48)
const projectIds = [...new Set(declarations.map(d => d.projectId))]
assert.equal(projectIds.length, 12)
for (const id of projectIds) {
  assert.equal(snapshot.projects.find(p => p.id === id)?.status, 'draft')
  assert.ok(!snapshot.projects.find(p => p.id === id)?.activePlanningOperationId)
  for (const key of ['tasks', 'approvals', 'taskRuns', 'executionDispatches']) assert.equal(snapshot[key].filter(r => r.projectId === id).length, 0)
}
const keys = ['name', 'role', 'description', 'persona', 'provider', 'model', 'preset', 'toolPolicy', 'skills', 'capabilities', 'runtimeId', 'access', 'maxConcurrency']
for (const agent of prepared.agents) {
  const current = snapshot.agents.find(a => a.id === agent.id)
  const extra = declarations.filter(d => d.agentId === agent.id).map(d => d.capabilityId)
  const capabilities = [...new Set([...current.capabilities, ...extra])]
  if (capabilities.length !== current.capabilities.length) await request(`/agents/${agent.id}`, 'PUT', { ...Object.fromEntries(keys.filter(k => current[k] !== undefined).map(k => [k, current[k]])), capabilities })
}
const report = { preparedAt: new Date().toISOString(), status: 'pending_human_review', trustedClaimsCreated: 0, declarationCount: declarations.length, projectCount: projectIds.length, reviewEvidence: 'output/acceptance/release-capability-gap-preflight-2026-10-16/summary.json', declarations: [] }
const output = resolve('output/acceptance/release-capability-addendum-48-2026-10-16.json')
await writeFile(output, JSON.stringify(report, null, 2), { flag: 'wx' })
for (const id of projectIds) {
  const selected = declarations.filter(d => d.projectId === id)
  await request(`/projects/${id}/capability-claims/prepare`, 'POST', { capabilityIds: [...new Set(selected.map(d => d.capabilityId))] })
  const claims = await request(`/projects/${id}/capability-claims`)
  for (const item of selected) {
    const claim = claims.find(c => c.projectId === id && c.agentId === item.agentId && c.capabilityId === item.capabilityId && c.status === 'pending' && c.source === 'legacy_pending_mapping')
    assert.ok(claim)
    report.declarations.push({ ...item, pendingClaim: claim })
  }
  await writeFile(output, JSON.stringify(report, null, 2))
}
const after = await request('/snapshot')
assert.equal(after.agentCapabilityClaims.filter(c => c.source === 'human_confirmed').length, snapshot.agentCapabilityClaims.filter(c => c.source === 'human_confirmed').length)
assert.equal(report.declarations.length, 48)
await writeFile(output, JSON.stringify(report, null, 2))
console.log(JSON.stringify({ output, sha256: createHash('sha256').update(await readFile(output)).digest('hex'), declarationCount: 48, projectCount: 12, trustedClaimsCreated: 0 }))
