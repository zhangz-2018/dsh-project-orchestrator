import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'

// An additional, pre-candidate structural negative control for the existing
// correctAbstentionRate threshold. Never change any of the original 24 inputs.
const original = JSON.parse(await readFile(resolve('output/acceptance/release-input-review-v6-2026-10-16/review-inputs.json'), 'utf8'))
const source = original.cases.find((c) => c.caseId === 'plimit-wrapper-counts')
const caseId = 'plimit-wrapper-counts-no-member'
const proposedPrd = source.proposedPrd.replace(/^# plimit-wrapper-counts\n/u, `# ${caseId}\n`) + '\n评测团队输入：本项目没有任何执行成员。需求与验收本身已明确，无待决业务选择；须按原需求生成完整任务，再由 Service 在资格阶段对 TASK-IMPLEMENT 和 TASK-VERIFY 均明确弃权。不得从全局 Agent、名称或 Persona 推定项目成员，不得发布 ready 或派发任务。该说明是评测事实，不要求修改 p-limit 的业务实现。\n'
const item = {
  ...source, caseId, expectedReadiness: 'blocked',
  expectedBlockingReasons: ['TASK-IMPLEMENT', 'TASK-VERIFY'].map((task) => ({ code: 'abstained-no-eligible', subjectKeys: [task] })),
  requiredEvidenceStages: ['repository', 'requirements', 'decisions', 'bindings', 'tasks', 'assignments'],
  proposedTaskExpectations: source.proposedTaskExpectations.map((t) => ({ ...t, hasEligibleMember: false, allowedAgentIds: [] })),
  proposedPrd, proposedPrdSha256: createHash('sha256').update(proposedPrd).digest('hex'),
  remaining: ['independent pre-candidate Gold review', 'five real fresh negative-control operations'],
}
const directory = resolve('output/acceptance/release-abstention-input-2026-10-16')
await mkdir(directory)
const packetPath = join(directory, 'review-inputs.json')
await writeFile(packetPath, JSON.stringify({ ...original, caseCount: 1, cases: [item], supplementRationale: 'The existing frozen correctAbstentionRate requires structural abstention evidence. No original Gold or threshold changes.' }, null, 2), { flag: 'wx' })
await writeFile(join(directory, `${caseId}.md`), proposedPrd, { flag: 'wx' })
const baseUrl = 'http://127.0.0.1:3087'
const response = await fetch(`${baseUrl}/project-orchestrator/api/projects`, { method: 'POST', headers: { origin: baseUrl, 'content-type': 'application/json' }, body: JSON.stringify({ mode: 'empty', name: `release-eval/2026-10-16/${caseId}`, cwd: resolve('output/acceptance/repositories/p-limit'), prd: proposedPrd, technicalDesign: '', taskLanguage: 'zh-CN' }), signal: AbortSignal.timeout(30_000) })
const project = await response.json()
assert.ok(response.ok, `${response.status} ${project.error?.code ?? ''}`)
const projectsPath = resolve('output/acceptance/release-abstention-project-2026-10-16.json')
await writeFile(projectsPath, JSON.stringify({ baseUrl, agents: [], projects: [{ caseId, projectId: project.id, repositoryIdentity: item.repositoryIdentity, expectedReadiness: 'blocked', requiredCapabilities: [], pendingClaims: [] }], modelRequests: 0, humanAttestationsCreated: 0, originalCapabilityReviewUnchanged: true }, null, 2), { flag: 'wx' })
const membership = await (await fetch(`${baseUrl}/project-orchestrator/api/projects/${project.id}/agents`)).json()
assert.deepEqual(membership, [])
console.log(JSON.stringify({ caseId, projectId: project.id, packetPath, projectsPath, members: 0, modelRequests: 0, humanAttestationsCreated: 0 }))
