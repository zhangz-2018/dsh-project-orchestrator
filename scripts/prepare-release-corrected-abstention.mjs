import assert from 'node:assert/strict'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'

// Preserve the failed version's PRD and all other semantic facts. Only the
// installed prompt bundle changes; old Gold, candidates and manifest stay put.
const oldProjects = JSON.parse(await readFile(resolve(process.argv[2] ?? 'output/acceptance/release-abstention-project-2026-10-16.json'), 'utf8'))
const oldPacket = JSON.parse(await readFile(resolve(oldProjects.packetPath ?? 'output/acceptance/release-abstention-input-2026-10-16/review-inputs.json'), 'utf8'))
const original = oldPacket.cases[0]
const oldGold = JSON.parse(await readFile(resolve('planning-evals/cases', original.caseId, 'gold.json'), 'utf8'))
const baseUrl = oldProjects.baseUrl
const request = async (path, body) => {
  const response = await fetch(`${baseUrl}/project-orchestrator/api${path}`, { method: body === undefined ? 'GET' : 'POST', headers: { origin: baseUrl, 'content-type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(30_000) })
  const value = await response.json()
  assert.ok(response.ok, `${response.status} ${value.error?.code ?? ''}`)
  return value
}
const source = (await request('/snapshot')).projects.find((p) => p.id === oldProjects.projects[0].projectId)
assert.equal(source.status, 'draft')
assert.equal(source.prd, original.proposedPrd.trim())
assert.deepEqual(await request(`/projects/${source.id}/capability-claims`), [], 'Never copy scoped trusted capability attestations to a new project.')
const members = (await request(`/projects/${source.id}/agents`)).filter((m) => m.status === 'active')
assert.ok(members.every((m) => m.autoAssignable === false && m.deliveryRoles.length === 1 && m.deliveryRoles[0] === 'reviewer'))
const caseId = process.argv[3] ?? 'plimit-wrapper-counts-no-member-stage-boundary-v2'
const directory = resolve(process.argv[4] ?? 'output/acceptance/release-corrected-abstention-input-2026-10-16')
await mkdir(directory)
const packetPath = join(directory, 'review-inputs.json')
await writeFile(packetPath, JSON.stringify({ ...oldPacket, cases: [{ ...original, caseId }], regressionOf: original.caseId, inputChange: 'Only the installed requirements prompt bundle; original source bytes remain identical.' }, null, 2), { flag: 'wx' })
const record = { caseId, projectId: null, projectIdsByRun: {}, repositoryIdentity: original.repositoryIdentity, expectedReadiness: 'blocked', pendingClaims: [] }
const projectsPath = resolve(process.argv[5] ?? 'output/acceptance/release-corrected-abstention-projects-2026-10-16.json')
const report = { baseUrl, packetPath, agents: oldProjects.agents ?? [], projects: [record], modelRequests: 0, humanAttestationsCreated: 0, previews: [] }
await writeFile(projectsPath, JSON.stringify(report, null, 2), { flag: 'wx' })
let releaseInput
for (let index = 1; index <= 5; index++) {
  const project = await request('/projects', { mode: 'empty', name: source.name, cwd: source.cwd, prd: source.prd, technicalDesign: source.technicalDesign, taskLanguage: source.taskLanguage })
  record.projectId ??= project.id
  record.projectIdsByRun[`fresh-${index}`] = project.id
  await writeFile(projectsPath, JSON.stringify(report, null, 2))
  for (const member of members) await request(`/projects/${project.id}/agents`, { agentId: member.agentId, deliveryRoles: member.deliveryRoles, autoAssignable: false, joinedBy: 'authorized-isolated-benchmark-review-preparation' })
  assert.deepEqual(await request(`/projects/${project.id}/capability-claims`), [])
  assert.equal((await request(`/projects/${project.id}/planning-operations`)).length, 0)
  const preview = await request(`/projects/${project.id}/planning-evaluation-input`)
  const { promptVersionsDigest, ...otherFacts } = preview.releaseInput
  const { promptVersionsDigest: oldBundle, ...oldFacts } = oldGold.releaseInput
  assert.notEqual(promptVersionsDigest, oldBundle, 'The fixed bundle must be installed first.')
  assert.deepEqual(otherFacts, oldFacts, 'Do not change inputs to hide the original failure.')
  releaseInput ??= preview.releaseInput
  assert.deepEqual(preview.releaseInput, releaseInput)
  report.previews.push({ runId: `fresh-${index}`, projectId: project.id, releaseInput: preview.releaseInput, preparedAt: preview.preparedAt })
  await writeFile(projectsPath, JSON.stringify(report, null, 2))
}
report.status = 'unchanged_source_and_facts_with_corrected_bundle_before_models'
await writeFile(projectsPath, JSON.stringify(report, null, 2))
console.log(JSON.stringify({ packetPath, projectsPath, caseId, projects: 5, unchangedExceptPromptBundle: true, modelRequests: 0, humanAttestationsCreated: 0 }))
