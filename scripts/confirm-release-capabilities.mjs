import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { access, readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'

// Explicit user approval covers this exact frozen 204-claim list, only.
const listPath = resolve('output/acceptance/release-projects-2026-10-16.json')
const bytes = await readFile(listPath)
const listSha256 = createHash('sha256').update(bytes).digest('hex')
assert.equal(listSha256, 'de4d0c0342a6525df57cfc1efdafd102b2be08366eb41c4e90681d4126b128d2')
const prepared = JSON.parse(bytes)
const base = 'http://127.0.0.1:3087'
assert.equal(prepared.baseUrl, base)
const selected = prepared.projects.filter(p => p.expectedReadiness === 'ready')
assert.equal(selected.length, 16)
assert.equal(selected.reduce((n, p) => n + p.pendingClaims.length, 0), 204)
const members = new Set(['da6f43df-b9a4-499b-ae1a-d39ae3f51711', '2ef2743b-5017-4ab1-9853-329cc8c1ca8e'])
const authorization = {
  actor: '用户（明确确认本批次204项项目限定能力清单）',
  reason: '用户回复“确认这 204 项并登记”；仅限已审阅清单中的两名成员、16个隔离项目和204项能力，不派发任务或发布。',
  evidenceRef: 'docs/release-capability-review-2026-10-16.zh-CN.md; request_user_input_async/call_8e6501e61078495cbaf96473185e3976',
}
const request = async (path, body) => {
  const response = await fetch(`${base}/project-orchestrator/api${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { origin: base, 'content-type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    signal: AbortSignal.timeout(30_000),
  })
  const result = await response.json()
  assert.ok(response.ok, `${path}: HTTP ${response.status} ${result.error?.code ?? ''}`)
  return result
}
const snapshot = await request('/snapshot')
// Complete preflight before any mutation; existing confirmations are inspected on resume.
for (const item of selected) {
  assert.equal(snapshot.projects.find(p => p.id === item.projectId)?.status, 'draft')
  assert.equal((await request(`/projects/${item.projectId}/planning-operations`)).length, 0)
  await assert.rejects(access(resolve('planning-evals/cases', item.caseId, 'gold.json')), { code: 'ENOENT' })
  for (const key of ['tasks', 'approvals', 'taskRuns', 'executionDispatches']) assert.equal(snapshot[key].filter(r => r.projectId === item.projectId).length, 0)
  const current = await request(`/projects/${item.projectId}/capability-claims`)
  for (const claim of item.pendingClaims) {
    assert.equal(claim.projectId, item.projectId)
    assert.ok(members.has(claim.agentId))
    assert.deepEqual(current.find(c => c.id === claim.id), claim)
    assert.equal(claim.status, 'pending')
    assert.equal(claim.source, 'legacy_pending_mapping')
    const definition = snapshot.capabilityDefinitions.find(d => d.id === claim.capabilityId)
    assert.equal(definition?.status, 'active')
    assert.equal(definition.version, claim.capabilityVersion)
    assert.ok(snapshot.projectAgentMemberships.some(m => m.projectId === item.projectId && m.agentId === claim.agentId && m.status === 'active'))
  }
}
const reportPath = resolve('output/acceptance/release-capabilities-confirmed-2026-10-16.json')
let report
try { report = JSON.parse(await readFile(reportPath, 'utf8')); assert.equal(report.listSha256, listSha256) }
catch (error) {
  if (error.code !== 'ENOENT') throw error
  report = { startedAt: new Date().toISOString(), listSha256, authorization, status: 'registering', projects: [] }
  await writeFile(reportPath, JSON.stringify(report, null, 2), { flag: 'wx' })
}
for (const item of selected) {
  const body = { ...authorization, claims: item.pendingClaims.map(c => ({ claimId: c.id, expectedClaimDigest: c.claimDigest })) }
  // Formal API is idempotent for already-active scoped claims; no direct store writes.
  const result = await request(`/projects/${item.projectId}/capability-claims/confirm`, body)
  assert.equal(result.claims.length, item.pendingClaims.length)
  const stored = await request(`/projects/${item.projectId}/capability-claims`)
  for (const pending of item.pendingClaims) {
    const claim = result.claims.find(c => c.agentId === pending.agentId && c.capabilityId === pending.capabilityId)
    assert.equal(claim?.projectId, item.projectId)
    assert.equal(claim.capabilityVersion, pending.capabilityVersion)
    assert.equal(claim.source, 'human_confirmed')
    assert.equal(claim.status, 'active')
    assert.equal(claim.confirmedBy, authorization.actor)
    assert.equal(claim.evidenceRef, authorization.evidenceRef)
    assert.deepEqual(stored.find(c => c.id === claim.id), claim)
  }
  assert.equal(result.project.status, 'draft')
  const entry = { caseId: item.caseId, projectId: item.projectId, claims: result.claims, persisted: true, observedAt: new Date().toISOString() }
  report.projects = [...report.projects.filter(p => p.projectId !== item.projectId), entry]
  await writeFile(reportPath, JSON.stringify(report, null, 2))
  console.log(JSON.stringify({ caseId: item.caseId, confirmed: result.claims.length, persisted: true }))
}
const after = await request('/snapshot')
for (const item of selected) {
  assert.equal(after.projects.find(p => p.id === item.projectId)?.status, 'draft')
  for (const key of ['tasks', 'approvals', 'taskRuns', 'executionDispatches', 'planningOperations']) assert.equal(after[key].filter(r => r.projectId === item.projectId).length, 0)
}
report.status = 'confirmed_and_persisted'
report.confirmedCount = report.projects.reduce((n, p) => n + p.claims.length, 0)
assert.equal(report.confirmedCount, 204)
report.completedAt = new Date().toISOString()
await writeFile(reportPath, JSON.stringify(report, null, 2))
console.log(JSON.stringify({ status: report.status, confirmedCount: report.confirmedCount, projects: report.projects.length }))
