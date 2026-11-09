import assert from 'node:assert/strict'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'

// Correct a missed benchmark precondition, not the product's independence gate.
// This new input has a real non-executing Reviewer and still no eligible executor.
const previous = JSON.parse(await readFile(resolve('output/acceptance/release-corrected-abstention-projects-2026-10-16.json'), 'utf8'))
const oldPacket = JSON.parse(await readFile(previous.packetPath, 'utf8'))
const original = oldPacket.cases[0]
const oldGold = JSON.parse(await readFile(resolve('planning-evals/cases', original.caseId, 'gold.json'), 'utf8'))
const baseUrl = previous.baseUrl
const request = async (path, body) => {
  const response = await fetch(`${baseUrl}/project-orchestrator/api${path}`, { method: body === undefined ? 'GET' : 'POST', headers: { origin: baseUrl, 'content-type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(30_000) })
  const value = await response.json()
  assert.ok(response.ok, `${path}: HTTP ${response.status} ${value.error?.code ?? ''}`)
  return value
}
const source = (await request('/snapshot')).projects.find((p) => p.id === previous.projects[0].projectId)
assert.equal(source.status, 'draft')
assert.equal(source.prd, original.proposedPrd.trim())
const caseId = 'plimit-wrapper-counts-no-executor-reviewer-v3'
const directory = resolve('output/acceptance/release-abstention-reviewer-input-2026-10-16')
await mkdir(directory)
const packetPath = join(directory, 'review-inputs.json')
await writeFile(packetPath, JSON.stringify({ ...oldPacket, cases: [{ ...original, caseId }], inputChange: 'Same product source, model and prompt bundle; add one actual non-autoassignable Reviewer to satisfy high-risk review. No execution members or trusted claims.', previousFailedCaseId: original.caseId }, null, 2), { flag: 'wx' })
const projectsPath = resolve('output/acceptance/release-abstention-reviewer-projects-2026-10-16.json')
const record = { caseId, projectId: null, projectIdsByRun: {}, repositoryIdentity: original.repositoryIdentity, expectedReadiness: 'blocked', pendingClaims: [] }
const report = { baseUrl, packetPath, agents: [], projects: [record], previews: [], modelRequests: 0, humanAttestationsCreated: 0 }
await writeFile(projectsPath, JSON.stringify(report, null, 2), { flag: 'wx' })
const persist = () => writeFile(projectsPath, JSON.stringify(report, null, 2))
const reviewer = await request('/agents', { name: 'Isolated abstention planning Reviewer 2026-10-16', role: 'Code Reviewer', description: 'Reviews only. Not an executor; no trusted capability declaration or task dispatch authorization.', persona: 'Independently review source-grounded scenario coverage, bindings and plans. Preserve real business risks and reject unsupported evidence. Never imply executor eligibility.', provider: 'pockapi', model: 'gpt-6.1-sol', toolPolicy: 'full', capabilities: [], maxConcurrency: 1, access: 'only_me' })
report.agents.push({ id: reviewer.id, name: reviewer.name, deliveryRole: 'reviewer' })
await persist()
let releaseInput
for (let index = 1; index <= 5; index++) {
  const project = await request('/projects', { mode: 'empty', name: source.name, cwd: source.cwd, prd: source.prd, technicalDesign: source.technicalDesign, taskLanguage: source.taskLanguage })
  record.projectId ??= project.id
  record.projectIdsByRun[`fresh-${index}`] = project.id
  await persist()
  await request(`/projects/${project.id}/agents`, { agentId: reviewer.id, deliveryRoles: ['reviewer'], autoAssignable: false, joinedBy: 'authorized-isolated-benchmark-review-preparation' })
  assert.equal((await request(`/projects/${project.id}/planning-operations`)).length, 0)
  const snapshot = await request('/snapshot')
  const members = snapshot.projectAgentMemberships.filter((m) => m.projectId === project.id && m.status === 'active')
  assert.equal(members.length, 1)
  assert.equal(members[0].agentId, reviewer.id)
  assert.deepEqual(members[0].deliveryRoles, ['reviewer'])
  assert.equal(members[0].autoAssignable, false)
  assert.deepEqual(await request(`/projects/${project.id}/capability-claims`), [])
  const preview = await request(`/projects/${project.id}/planning-evaluation-input`)
  const { teamCatalogDigest, ...otherFacts } = preview.releaseInput
  const { teamCatalogDigest: oldTeam, ...oldFacts } = oldGold.releaseInput
  assert.notEqual(teamCatalogDigest, oldTeam)
  assert.deepEqual(otherFacts, oldFacts, 'Only the explicitly corrected team precondition may change.')
  releaseInput ??= preview.releaseInput
  assert.deepEqual(preview.releaseInput, releaseInput)
  report.previews.push({ runId: `fresh-${index}`, projectId: project.id, releaseInput: preview.releaseInput, preparedAt: preview.preparedAt })
  await persist()
}
report.status = 'nonexecuting_independent_reviewer_prepared_before_models'
await persist()
console.log(JSON.stringify({ caseId, packetPath, projectsPath, projects: 5, reviewerId: reviewer.id, executionMembers: 0, modelRequests: 0, humanAttestationsCreated: 0 }))
