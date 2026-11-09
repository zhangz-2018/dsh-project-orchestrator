import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFile, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'

// 只读核对重建后的真实 Host；不调用模型、不修改领域记录、不提供验收通过结论。
const [contextPath, baseUrl, destination] = process.argv.slice(2)
assert.ok(contextPath && baseUrl && destination)
const context = JSON.parse(await readFile(contextPath, 'utf8'))
assert.equal(context.status, 'draft_inputs_reconstructed_not_qualified')
const hash = bytes => createHash('sha256').update(bytes).digest('hex')
for (const source of context.sources) assert.equal(hash(await readFile(source.path)), source.sha256, 'A recovery source changed')
const harness = JSON.parse(await readFile(join(context.runtimeRoot, 'node_modules/@deepseek-ai/dsh/package.json'), 'utf8'))
assert.equal(harness.version, context.harnessVersion)
const sourceBundleSha256 = hash(await readFile('lib/index.js'))
assert.equal(hash(await readFile(join(context.runtimeRoot, 'node_modules/dsh-project-orchestrator/lib/index.js'))), sourceBundleSha256)

/** 请求隔离回环 Host，失败立即保留为异常，不把空或无权限响应当作恢复成功。 */
async function request(path) {
  const target = new URL(baseUrl)
  assert.equal(target.hostname, '127.0.0.1')
  const response = await fetch(`${target.origin}/project-orchestrator/api${path}`, { signal: AbortSignal.timeout(30_000) })
  assert.equal(response.ok, true, `${path}: HTTP ${response.status}`)
  return response.json()
}

const snapshot = await request('/snapshot')
const prepared = JSON.parse(await readFile(context.projectsSource, 'utf8'))
const packet = JSON.parse(await readFile(prepared.packetPath, 'utf8'))
const ids = new Set(prepared.projects.flatMap(record => Object.values(record.projectIdsByRun ?? { first: record.projectId })))
assert.equal(ids.size, context.projectCount)
const original = JSON.parse(await readFile('output/acceptance/release-capabilities-confirmed-2026-10-16.json', 'utf8'))
const addendum = JSON.parse(await readFile('output/acceptance/release-capability-addendum-52-confirmed-2026-10-16.json', 'utf8'))
const claims = [...original.projects, ...addendum.projects].flatMap(record => record.claims)
assert.equal(claims.length, 256)
for (const claim of claims) assert.deepEqual(snapshot.agentCapabilityClaims.find(item => item.id === claim.id), claim)
assert.equal(snapshot.agentCapabilityClaims.filter(claim => claim.source === 'human_confirmed').length, 256)
for (const key of ['planningOperations', 'tasks', 'taskRuns', 'approvals', 'planApprovalsV3', 'executionDispatches', 'deliveryRecords']) {
  assert.equal(snapshot[key].filter(record => ids.has(record.projectId)).length, 0, `${key} must start empty`)
}
const inputs = []
for (const record of prepared.projects) {
  const specification = packet.cases.find(item => item.caseId === record.caseId)
  for (const id of new Set(Object.values(record.projectIdsByRun ?? { first: record.projectId }))) {
    const project = snapshot.projects.find(project => project.id === id)
    assert.equal(project?.prd, specification.proposedPrd.trim())
    assert.equal(project.status, 'draft')
    const preview = await request(`/projects/${id}/planning-evaluation-input`)
    assert.equal(preview.repositoryBaseCommit, specification.repositoryBaseCommit)
    assert.equal(preview.releaseInput.modelProvider, 'pockapi')
    assert.equal(preview.releaseInput.modelId, 'gpt-6.1-sol')
    const members = snapshot.projectAgentMemberships.filter(member => member.projectId === id && member.status === 'active')
    if (record.expectedReadiness === 'ready') assert.equal(members.filter(member => member.autoAssignable).length, 2)
    else assert.equal(members.filter(member => member.autoAssignable).length, 0)
    inputs.push({ caseId: record.caseId, projectId: id, releaseInput: preview.releaseInput })
  }
}
assert.deepEqual(await request('/snapshot'), snapshot, 'Preview GETs must not mutate recovery facts')
const report = { status: 'reconstructed_host_inputs_verified_not_qualified', observedAt: new Date().toISOString(),
  contextPath: resolve(contextPath), contextSha256: hash(await readFile(contextPath)), baseUrl,
  harnessVersion: harness.version, sourceBundleSha256,
  projectCount: ids.size, caseCount: prepared.projects.length, exactOriginalClaims: 256,
  modelRequests: 0, domainMutations: 0, releaseQualified: false, inputs }
await writeFile(destination, JSON.stringify(report, null, 2), { flag: 'wx', mode: 0o600 })
console.log(JSON.stringify({ status: report.status, projectCount: report.projectCount, caseCount: report.caseCount, exactOriginalClaims: 256, destination: resolve(destination) }))
