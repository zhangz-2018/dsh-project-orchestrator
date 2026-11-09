import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'

// --apply may be used ONLY after explicit human approval of the complete
// 48-item addendum. The original 204-item approval does not authorize it.
const apply = process.argv.includes('--apply')
const path = resolve('output/acceptance/release-capability-addendum-48-2026-10-16.json')
const bytes = await readFile(path)
const listSha256 = createHash('sha256').update(bytes).digest('hex')
assert.equal(listSha256, '38753a03c6ba7d1ba8473381acea78a7e067a518478cb6a011a0da8b19ccd056')
const prepared = JSON.parse(bytes)
assert.equal(prepared.declarations.length, 48)
const base = 'http://127.0.0.1:3087'
const request = async (path, body) => {
  const response = await fetch(`${base}/project-orchestrator/api${path}`, { method: body === undefined ? 'GET' : 'POST', headers: { origin: base, 'content-type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(30_000) })
  const result = await response.json()
  assert.ok(response.ok, `${path}: HTTP ${response.status} ${result.error?.code ?? ''}`)
  return result
}
const snapshot = await request('/snapshot')
const projectIds = [...new Set(prepared.declarations.map(c => c.projectId))]
assert.equal(projectIds.length, 12)
for (const id of projectIds) {
  const project = snapshot.projects.find(p => p.id === id)
  assert.equal(project?.status, 'draft')
  assert.ok(!project.activePlanningOperationId)
  for (const key of ['tasks', 'approvals', 'taskRuns', 'executionDispatches']) assert.equal(snapshot[key].filter(r => r.projectId === id).length, 0)
}
for (const item of prepared.declarations) {
  assert.deepEqual(snapshot.agentCapabilityClaims.find(c => c.id === item.pendingClaim.id), item.pendingClaim)
  assert.ok(['data.change', 'domain.state', 'integration.consumer'].includes(item.capabilityId))
  assert.ok(snapshot.projectAgentMemberships.some(m => m.projectId === item.projectId && m.agentId === item.agentId && m.status === 'active' && m.deliveryRoles.includes(item.role)))
  const definition = snapshot.capabilityDefinitions.find(d => d.id === item.capabilityId)
  assert.equal(definition?.status, 'active')
  assert.equal(definition.version, item.pendingClaim.capabilityVersion)
}
if (!apply) {
  console.log(JSON.stringify({ status: 'read_only_preflight_passed', declarations: 48, projects: 12, registrationExecuted: false, requires: 'Explicit user confirmation of docs/release-capability-addendum-complete-2026-10-16.zh-CN.md before --apply.' }))
} else {
  const authorization = { actor: '用户（明确确认完整48项项目限定能力补充清单）', reason: '用户在本会话明确确认完整48项清单并允许正式登记；仅限清单项目和成员，不派发任务、不批准计划或发布。', evidenceRef: 'docs/release-capability-addendum-complete-2026-10-16.zh-CN.md; 本会话对完整48项清单的明确用户确认' }
  const output = resolve('output/acceptance/release-capability-addendum-confirmed-2026-10-16.json')
  let report
  try { report = JSON.parse(await readFile(output, 'utf8')); assert.equal(report.listSha256, listSha256) }
  catch (error) {
    if (error.code !== 'ENOENT') throw error
    report = { startedAt: new Date().toISOString(), listSha256, authorization, status: 'registering', projects: [] }
    await writeFile(output, JSON.stringify(report, null, 2), { flag: 'wx' })
  }
  for (const id of projectIds) {
    const declarations = prepared.declarations.filter(c => c.projectId === id)
    const result = await request(`/projects/${id}/capability-claims/confirm`, { ...authorization, claims: declarations.map(c => ({ claimId: c.pendingClaim.id, expectedClaimDigest: c.pendingClaim.claimDigest })) })
    assert.equal(result.claims.length, declarations.length)
    const stored = await request(`/projects/${id}/capability-claims`)
    for (const item of declarations) {
      const claim = result.claims.find(c => c.agentId === item.agentId && c.capabilityId === item.capabilityId)
      assert.equal(claim?.projectId, id)
      assert.equal(claim.status, 'active')
      assert.equal(claim.source, 'human_confirmed')
      assert.ok(claim.confirmedBy && claim.evidenceRef)
      assert.deepEqual(stored.find(c => c.id === claim.id), claim)
    }
    assert.equal(result.project.status, 'draft')
    report.projects = [...report.projects.filter(p => p.projectId !== id), { projectId: id, claims: result.claims, persisted: true }]
    await writeFile(output, JSON.stringify(report, null, 2))
    console.log(JSON.stringify({ projectId: id, confirmed: result.claims.length, persisted: true }))
  }
  report.status = 'confirmed_and_persisted'
  report.confirmedCount = report.projects.reduce((n, p) => n + p.claims.length, 0)
  assert.equal(report.confirmedCount, 48)
  report.completedAt = new Date().toISOString()
  await writeFile(output, JSON.stringify(report, null, 2))
  console.log(JSON.stringify({ status: report.status, confirmedCount: 48, projects: 12 }))
}
