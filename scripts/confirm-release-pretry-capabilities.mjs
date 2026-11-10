import assert from 'node:assert/strict'
import { readFile, writeFile } from 'node:fs/promises'
import { digestObject } from '../lib/index.js'

// 仅登记用户已明确确认的单项目四项事实；默认只读，摘要或边界不符时拒绝写入。
const apply = process.argv.includes('--apply')
// 接口成功但本地核验中断后，仅观察已持久化事实，绝不重发登记请求。
const observeConfirmed = process.argv.includes('--observe-confirmed')
assert.ok(!(apply && observeConfirmed))
const projectId = '6a41a661-27b1-483b-8abd-691276f9a190'
const declarations = [
  ['da6f43df-b9a4-499b-ae1a-d39ae3f51711', 'implementer', 'data.change', '660a3a3a9bdb4f24aa31520ea5738fbf76061045d13559191e8143b2e7472d8e'],
  ['da6f43df-b9a4-499b-ae1a-d39ae3f51711', 'implementer', 'domain.state', 'f52107c2c412082e92a476cd084efe411e360191713f685bb352700c14141b07'],
  ['2ef2743b-5017-4ab1-9853-329cc8c1ca8e', 'verifier', 'data.change', '4c3b1697232434ad4262dad679f871a62cd69d1c2ba1d9aa8ff0c426a6fb9966'],
  ['2ef2743b-5017-4ab1-9853-329cc8c1ca8e', 'verifier', 'domain.state', '5bc066eb39bc1a8ef82da1844833318c04075d261b254b765c7f06c90874d92d'],
]
const base = 'http://127.0.0.1:3087'

/** 仅访问隔离 Host 的正式接口；HTTP 或领域失败均抛出，不以空响应继续登记。 */
async function request(path, body) {
  const response = await fetch(`${base}/project-orchestrator/api${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { origin: base, 'content-type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    signal: AbortSignal.timeout(30_000),
  })
  const value = await response.json()
  assert.ok(response.ok, `${path}: HTTP ${response.status} ${value.error?.code ?? ''}`)
  return value
}

const before = await request('/snapshot')
const project = before.projects.find(p => p.id === projectId)
assert.equal(project?.status, 'draft')
assert.ok(!project.activePlanningOperationId)
assert.ok(before.planningOperations.every(o => o.status !== 'running'))
for (const key of ['approvals', 'taskRuns', 'executionDispatches', 'planApprovalsV3', 'deliveryRecords']) assert.equal(before[key].length, 0)
const originals = []
for (const path of ['output/acceptance/release-capabilities-confirmed-2026-10-16.json', 'output/acceptance/release-capability-addendum-52-confirmed-2026-10-16.json']) {
  const record = JSON.parse(await readFile(path, 'utf8'))
  originals.push(...record.projects.flatMap(p => p.claims))
}
assert.equal(originals.length, 256)
for (const claim of originals) assert.deepEqual(before.agentCapabilityClaims.find(c => c.id === claim.id), claim)
const claims = declarations.map(([agentId, role, capabilityId, expectedClaimDigest]) => {
  const claimId = `capability-claim:${projectId}:${agentId}:${capabilityId}`
  const pending = before.agentCapabilityClaims.find(c => c.id === claimId)
  assert.equal(pending?.status, 'pending')
  assert.equal(pending.source, 'legacy_pending_mapping')
  assert.equal(pending.claimDigest, expectedClaimDigest)
  // 领域摘要绑定声明内容，记录 ID 单独作为定位键，不属于摘要域。
  const { id: _id, claimDigest, ...core } = pending
  assert.equal(digestObject(core), claimDigest)
  assert.ok(before.projectAgentMemberships.some(m => m.projectId === projectId && m.agentId === agentId && m.status === 'active' && m.deliveryRoles.includes(role)))
  assert.ok(before.capabilityDefinitions.some(d => d.id === capabilityId && d.version === pending.capabilityVersion && d.status === 'active'))
  return { claimId, expectedClaimDigest }
})
if (!apply && !observeConfirmed) {
  console.log(JSON.stringify({ status: 'read_only_preflight_passed', declarations: claims.length, original256Unchanged: true, registrationExecuted: false }))
} else {
  const authorization = {
    actor: '用户（明确确认 p-retry 项目四项能力）',
    reason: '用户在本会话回复“确认这 4 项并登记”；仅限本项目原两名成员的 data.change、domain.state，不批准计划或任务派发。',
    evidenceRef: 'docs/release-capability-pretry-addendum-2026-11-10.zh-CN.md; 本会话 call_f4adba6fcd6840d993afa0e2f261207c 的明确用户回复',
  }
  const destination = 'output/acceptance/formal-170-20261109/pretry-capabilities-confirmed.json'
  const report = observeConfirmed
    ? JSON.parse(await readFile(destination, 'utf8'))
    : { status: 'registering', startedAt: new Date().toISOString(), projectId, authorization, claims }
  assert.deepEqual(report.claims, claims)
  assert.deepEqual(report.authorization, authorization)
  // 写前保留意图；接口返回前失败时保留 registering，禁止无证据重发。
  if (apply) await writeFile(destination, JSON.stringify(report, null, 2), { flag: 'wx', mode: 0o600 })
  const result = observeConfirmed
    ? { claims: before.agentCapabilityClaims.filter(c => c.projectId === projectId && c.source === 'human_confirmed' && c.evidenceRef === authorization.evidenceRef) }
    : await request(`/projects/${projectId}/capability-claims/confirm`, { ...authorization, claims })
  assert.equal(result.claims.length, 4)
  Object.assign(report, { registeredClaims: result.claims, responseObservedAt: new Date().toISOString(), requestResent: false })
  await writeFile(destination, JSON.stringify(report, null, 2))
  const after = await request('/snapshot')
  for (const [agentId, , capabilityId] of declarations) {
    const matches = result.claims.filter(c => c.agentId === agentId && c.capabilityId === capabilityId)
    assert.equal(matches.length, 1)
    const claim = matches[0]
    assert.equal(claim.projectId, projectId)
    assert.equal(claim.status, 'active')
    assert.equal(claim.source, 'human_confirmed')
    assert.equal(claim.confirmedBy, authorization.actor)
    assert.equal(claim.evidenceRef, authorization.evidenceRef)
    assert.deepEqual(after.agentCapabilityClaims.find(c => c.id === claim.id), claim)
  }
  for (const claim of before.agentCapabilityClaims) assert.deepEqual(after.agentCapabilityClaims.find(c => c.id === claim.id), claim)
  for (const key of Object.keys(before).filter(key => !['agentCapabilityClaims', 'activity'].includes(key))) assert.deepEqual(after[key], before[key], `${key} changed outside capability registration`)
  const addedActivity = after.activity.filter(a => !before.activity.some(b => b.id === a.id))
  if (apply) {
    assert.equal(addedActivity.length, 1)
    assert.equal(addedActivity[0].type, 'project.capability_claim_confirmed')
    assert.equal(addedActivity[0].projectId, projectId)
    assert.deepEqual(addedActivity[0].metadata.confirmedClaimIds, result.claims.map(c => c.id))
  } else assert.deepEqual(after.activity, before.activity)
  assert.equal(after.agentCapabilityClaims.length, before.agentCapabilityClaims.length + (apply ? 4 : 0))
  Object.assign(report, { status: 'confirmed_and_persisted', completedAt: new Date().toISOString(), confirmedCount: 4, original256Unchanged: true, registeredClaims: result.claims })
  await writeFile(destination, JSON.stringify(report, null, 2))
  console.log(JSON.stringify({ status: report.status, confirmedCount: 4, original256Unchanged: true, destination }))
}
