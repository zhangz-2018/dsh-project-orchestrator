import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'

// Create draft evaluation projects and untrusted capability declarations only.
// This cannot confirm claims, start Planning, approve, dispatch, or publish.
const packetPath = resolve(process.argv[2])
const output = resolve(process.argv[3])
const packet = JSON.parse(await readFile(packetPath, 'utf8'))
assert.equal(packet.status, 'review_only_not_release_gold')
const base = 'http://127.0.0.1:3087'
const request = async (path, body) => {
  const response = await fetch(`${base}/project-orchestrator/api${path}`, { method: body === undefined ? 'GET' : 'POST', headers: { origin: base, 'content-type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(30_000) })
  const data = await response.json()
  assert.ok(response.ok, `${path}: HTTP ${response.status} ${data.error?.code ?? ''}`)
  return data
}
const snapshot = await request('/snapshot')
assert.ok(snapshot.projects.some((p) => p.id === 'ac9fafa7-c07b-4802-a177-6f4c986130bc' && p.status === 'completed'))
const common = ['api.contract', 'reliability.failure-handling', 'testing.automation']
const extraByRepository = {
  'sindresorhus/p-limit': ['language.javascript', 'language.typescript', 'domain.state', 'integration.async'],
  'sindresorhus/p-retry': ['language.javascript', 'language.typescript', 'integration.async'],
  'sindresorhus/p-queue': ['language.typescript', 'domain.state', 'integration.async'],
  'sindresorhus/p-map': ['language.javascript', 'language.typescript', 'integration.async'],
  'sindresorhus/ky': ['language.typescript', 'integration.async', 'integration.consumer'],
  'honojs/hono': ['language.typescript', 'integration.async', 'integration.consumer', 'security.authorization'],
  'colinhacks/zod': ['language.typescript'],
  'developit/mitt': ['language.typescript', 'domain.state'],
}
const all = [...new Set([...common, ...Object.values(extraByRepository).flat()])].sort()
const report = { status: 'preparing_untrusted_drafts', packetPath, packetSha256: createHash('sha256').update(await readFile(packetPath)).digest('hex'), startedAt: new Date().toISOString(), baseUrl: base, agents: [], projects: [], humanAttestationsCreated: 0, candidateOperationsStarted: 0 }
await writeFile(output, JSON.stringify(report, null, 2), { flag: 'wx' })
const persist = () => writeFile(output, JSON.stringify(report, null, 2))
for (const [role, deliveryRole] of [['Software Engineer', 'implementer'], ['Test Engineer', 'verifier']]) {
  const agent = await request('/agents', { name: `Release evaluation ${deliveryRole} 2026-10-16`, role, description: 'Dedicated to this isolated 24-case planning benchmark; no task dispatch authorization.', persona: deliveryRole === 'implementer' ? 'Prepare bounded library implementation plans grounded in frozen source and contracts.' : 'Independently verify each requirement and compatibility boundary using the existing test and typecheck tools.', provider: 'pockapi', model: 'gpt-6.1-sol', toolPolicy: 'full', capabilities: [...all, ...(deliveryRole === 'verifier' ? ['testing.verification'] : [])], maxConcurrency: 1, access: 'only_me' })
  report.agents.push({ id: agent.id, name: agent.name, role, deliveryRole, capabilities: agent.capabilities })
  await persist()
}
for (const item of packet.cases) {
  const project = await request('/projects', { mode: 'empty', name: `release-eval/2026-10-16/${item.caseId}`, cwd: resolve('output/acceptance/repositories', item.repositoryIdentity.split('/')[1]), prd: item.proposedPrd, technicalDesign: '', taskLanguage: 'zh-CN' })
  const record = { caseId: item.caseId, projectId: project.id, repositoryIdentity: item.repositoryIdentity, expectedReadiness: item.expectedReadiness, requiredCapabilities: [...common, ...extraByRepository[item.repositoryIdentity]], pendingClaims: [] }
  report.projects.push(record)
  await persist()
  if (item.expectedReadiness === 'ready') {
    for (const agent of report.agents) await request(`/projects/${project.id}/agents`, { agentId: agent.id, deliveryRoles: [agent.deliveryRole], autoAssignable: true, joinedBy: 'authorized-isolated-benchmark-preparation' })
    const pending = await request(`/projects/${project.id}/capability-claims/prepare`, { capabilityIds: [...record.requiredCapabilities, 'testing.verification'] })
    record.pendingClaims = pending.filter((claim) => record.requiredCapabilities.includes(claim.capabilityId) || (claim.capabilityId === 'testing.verification' && claim.agentId === report.agents.find((a) => a.deliveryRole === 'verifier').id))
    assert.ok(record.pendingClaims.every((claim) => claim.status === 'pending' && claim.source === 'legacy_pending_mapping' && claim.confirmedBy === undefined))
  }
  assert.equal((await request(`/projects/${project.id}/planning-operations`)).length, 0)
  await persist()
}
report.status = 'draft_projects_and_pending_claims_prepared'
report.completedAt = new Date().toISOString()
await persist()
console.log(JSON.stringify({ output, status: report.status, projects: report.projects.length, pendingClaimsForReview: report.projects.reduce((n, p) => n + p.pendingClaims.length, 0), humanAttestationsCreated: 0, candidateOperationsStarted: 0 }))
