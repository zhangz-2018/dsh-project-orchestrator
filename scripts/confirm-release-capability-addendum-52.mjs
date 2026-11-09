import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFile, writeFile } from 'node:fs/promises'

// --apply requires explicit human confirmation of the complete 52-item list.
// Neither the original 204-item approval nor an approval of 48 items covers it.
const apply = process.argv.includes('--apply')
const bytes = await readFile('output/acceptance/release-capability-addendum-52-2026-10-16.json')
const listSha256 = createHash('sha256').update(bytes).digest('hex')
assert.equal(listSha256, 'ec3e3f5a4e7302a426c129a60be3a27f64967f62401fadf3912fa0605c5052b4')
const list = JSON.parse(bytes)
assert.equal(list.declarations.length, 52)
const base = 'http://127.0.0.1:3087'
const request = async (path, body) => {
  const response = await fetch(`${base}/project-orchestrator/api${path}`, { method: body === undefined ? 'GET' : 'POST', headers: { origin: base, 'content-type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(30_000) })
  const value = await response.json()
  assert.ok(response.ok, `${path}: HTTP ${response.status} ${value.error?.code ?? ''}`)
  return value
}
const before = await request('/snapshot')
const projectIds = [...new Set(list.declarations.map(d => d.projectId))]
assert.equal(projectIds.length, 14)
const original = JSON.parse(await readFile('output/acceptance/release-capabilities-confirmed-2026-10-16.json', 'utf8'))
for (const p of original.projects) for (const c of p.claims) assert.deepEqual(before.agentCapabilityClaims.find(v => v.id === c.id), c)
for (const id of projectIds) {
  const p = before.projects.find(v => v.id === id)
  assert.equal(p?.status, 'draft')
  assert.ok(!p.activePlanningOperationId)
  for (const key of ['tasks', 'approvals', 'taskRuns', 'executionDispatches', 'planApprovalsV3', 'deliveryRecords']) assert.equal(before[key].filter(v => v.projectId === id).length, 0)
}
for (const d of list.declarations) {
  assert.deepEqual(before.agentCapabilityClaims.find(c => c.id === d.pendingClaim.id), d.pendingClaim)
  assert.ok(before.projectAgentMemberships.some(m => m.projectId === d.projectId && m.agentId === d.agentId && m.status === 'active' && m.deliveryRoles.includes(d.role)))
  const definition = before.capabilityDefinitions.find(v => v.id === d.capabilityId)
  assert.equal(definition?.status, 'active')
  assert.equal(definition.version, d.pendingClaim.capabilityVersion)
}
if (!apply) {
  console.log(JSON.stringify({ status: 'read_only_preflight_passed', declarations: 52, projects: 14, original204ClaimsUnchanged: true, registrationExecuted: false }))
} else {
  const authorization = { actor: '用户（明确确认完整52项项目限定能力补充清单）', reason: '用户在本会话明确确认52项合并清单并允许正式登记；只限清单中的隔离项目与成员，不批准计划、不派发任务、不发布。', evidenceRef: 'docs/release-capability-addendum-52-2026-10-16.zh-CN.md; 本会话对52项合并清单的明确用户确认' }
  const destination = 'output/acceptance/release-capability-addendum-52-confirmed-2026-10-16.json'
  const report = { startedAt: new Date().toISOString(), status: 'registering', listSha256, authorization, projects: [] }
  await writeFile(destination, JSON.stringify(report, null, 2), { flag: 'wx' })
  for (const id of projectIds) {
    const items = list.declarations.filter(d => d.projectId === id)
    const result = await request(`/projects/${id}/capability-claims/confirm`, { ...authorization, claims: items.map(d => ({ claimId: d.pendingClaim.id, expectedClaimDigest: d.pendingClaim.claimDigest })) })
    assert.equal(result.claims.length, items.length)
    const stored = await request(`/projects/${id}/capability-claims`)
    for (const d of items) {
      const c = result.claims.find(v => v.agentId === d.agentId && v.capabilityId === d.capabilityId)
      assert.equal(c?.projectId, id)
      assert.equal(c.status, 'active')
      assert.equal(c.source, 'human_confirmed')
      assert.ok(c.confirmedBy && c.evidenceRef)
      assert.deepEqual(stored.find(v => v.id === c.id), c)
    }
    report.projects.push({ projectId: id, claims: result.claims, persisted: true })
    await writeFile(destination, JSON.stringify(report, null, 2))
    console.log(JSON.stringify({ projectId: id, confirmed: result.claims.length, persisted: true }))
  }
  const after = await request('/snapshot')
  for (const p of original.projects) for (const c of p.claims) assert.deepEqual(after.agentCapabilityClaims.find(v => v.id === c.id), c)
  report.confirmedCount = report.projects.reduce((n, p) => n + p.claims.length, 0)
  assert.equal(report.confirmedCount, 52)
  report.status = 'confirmed_and_persisted'
  report.completedAt = new Date().toISOString()
  await writeFile(destination, JSON.stringify(report, null, 2))
  console.log(JSON.stringify({ status: report.status, confirmedCount: 52, projects: 14, original204ClaimsUnchanged: true }))
}
