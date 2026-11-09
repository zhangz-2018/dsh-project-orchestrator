import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFile, writeFile } from 'node:fs/promises'

// Prepare pending declarations only; this does not assert human confirmation.
const reviewPath = 'output/acceptance/zod-capability-boundary-v13-2026-10-16/review.json'
const review = JSON.parse(await readFile(reviewPath, 'utf8'))
assert.equal(review.trustedClaimsCreated, 0)
assert.equal(review.reviews.length, 2)
const prepared = JSON.parse(await readFile('output/acceptance/release-transitive-policy-v13-projects-2026-10-16.json', 'utf8'))
const request = async (path, body) => {
  const response = await fetch(`${prepared.baseUrl}/project-orchestrator/api${path}`, { method: body === undefined ? 'GET' : 'POST', headers: { origin: prepared.baseUrl, 'content-type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) })
  const data = await response.json()
  assert.ok(response.ok, `${path}: HTTP ${response.status} ${data.error?.code ?? ''}`)
  return data
}
const before = await request('/snapshot')
const declarations = []
for (const item of review.reviews) {
  assert.equal(item.capabilitySurface, 'shared_data')
  assert.deepEqual(item.uncertainties, [])
  assert.equal(item.missing.length, 1)
  const missing = item.missing[0]
  assert.equal(missing.capabilityId, 'data.change')
  assert.deepEqual([...missing.deliveryRoles].sort(), ['implementer', 'verifier'])
  const project = prepared.projects.find(p => p.caseId === item.caseId)
  assert.equal(project?.projectId, item.projectId)
  const actual = before.projects.find(p => p.id === item.projectId)
  assert.equal(actual?.status, 'draft')
  assert.ok(!actual.activePlanningOperationId)
  const claims = await request(`/projects/${item.projectId}/capability-claims/prepare`, { capabilityIds: ['data.change'] })
  for (const role of missing.deliveryRoles) {
    const agentId = prepared.agents.find(a => a.deliveryRole === role).id
    assert.ok(before.projectAgentMemberships.some(m => m.projectId === item.projectId && m.agentId === agentId && m.status === 'active' && m.deliveryRoles.includes(role)))
    const pendingClaim = claims.find(c => c.projectId === item.projectId && c.agentId === agentId && c.capabilityId === 'data.change' && c.status === 'pending' && c.source === 'legacy_pending_mapping')
    assert.ok(pendingClaim)
    declarations.push({ caseId: item.caseId, projectId: item.projectId, agentId, role, capabilityId: 'data.change', reason: missing.reason, sourcePaths: missing.sourcePaths, pendingClaim })
  }
}
const after = await request('/snapshot')
assert.deepEqual(after.agentCapabilityClaims.filter(c => c.source === 'human_confirmed'), before.agentCapabilityClaims.filter(c => c.source === 'human_confirmed'))
const old = JSON.parse(await readFile('output/acceptance/release-capability-addendum-48-2026-10-16.json', 'utf8'))
for (const d of old.declarations) assert.deepEqual(after.agentCapabilityClaims.find(c => c.id === d.pendingClaim.id), d.pendingClaim)
const report = { preparedAt: new Date().toISOString(), status: 'pending_human_review', trustedClaimsCreated: 0, declarationCount: 52, projectCount: 14, reviewEvidence: [old.reviewEvidence, reviewPath], declarations: [...old.declarations, ...declarations] }
assert.equal(new Set(report.declarations.map(c => `${c.projectId}:${c.agentId}:${c.capabilityId}`)).size, 52)
const destination = 'output/acceptance/release-capability-addendum-52-2026-10-16.json'
await writeFile(destination, JSON.stringify(report, null, 2), { flag: 'wx' })
console.log(JSON.stringify({ destination, sha256: createHash('sha256').update(await readFile(destination)).digest('hex'), declarationCount: 52, projectCount: 14, trustedClaimsCreated: 0, additionalZodDeclarations: declarations.map(({ pendingClaim, ...d }) => ({ ...d, claimId: pendingClaim.id, expectedClaimDigest: pendingClaim.claimDigest })) }))
