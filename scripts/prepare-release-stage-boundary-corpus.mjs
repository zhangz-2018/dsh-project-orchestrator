import assert from 'node:assert/strict'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'

// Re-evaluate the original decision blocks on the corrected prompt bundle.
// Old inputs/Gold/results remain immutable; ready project claim IDs stay intact.
const prepared = JSON.parse(await readFile(resolve('output/acceptance/release-projects-2026-10-16.json'), 'utf8'))
const original = JSON.parse(await readFile(prepared.packetPath, 'utf8'))
const readyPacket = JSON.parse(await readFile(resolve('output/acceptance/release-input-review-v6-2026-10-16/review-inputs.json'), 'utf8'))
const suffix = process.argv[2] ?? '-stage-boundary-v2'
const reuse = process.argv[5] === undefined ? undefined : JSON.parse(await readFile(resolve(process.argv[5]), 'utf8'))
const ids = new Map(original.cases.map((c) => [c.caseId, c.expectedReadiness === 'blocked' ? `${c.caseId}${suffix}` : c.caseId]))
const cases = original.cases.map((c) => {
  const source = c.expectedReadiness === 'ready' ? readyPacket.cases.find((r) => r.caseId === c.caseId) : c
  assert.ok(source)
  return { ...source, caseId: ids.get(c.caseId), ...(source.pairedCaseId === undefined ? {} : { pairedCaseId: ids.get(source.pairedCaseId) }) }
})
const baseUrl = prepared.baseUrl
const request = async (path, body) => {
  const response = await fetch(`${baseUrl}/project-orchestrator/api${path}`, { method: body === undefined ? 'GET' : 'POST', headers: { origin: baseUrl, 'content-type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(30_000) })
  const value = await response.json()
  assert.ok(response.ok, `${path}: HTTP ${response.status} ${value.error?.code ?? ''}`)
  return value
}
const directory = resolve(process.argv[3] ?? 'output/acceptance/release-stage-boundary-input-2026-10-16')
await mkdir(directory)
const packetPath = join(directory, 'review-inputs.json')
await writeFile(packetPath, JSON.stringify({ ...readyPacket, cases, correction: 'Original pending v5 and ready v6 source bytes unchanged; new prompt bundle, pending case IDs and paired references only.' }, null, 2), { flag: 'wx' })
const projectsPath = resolve(process.argv[4] ?? 'output/acceptance/release-stage-boundary-projects-2026-10-16.json')
const report = { baseUrl, packetPath, agents: prepared.agents, projects: [], previews: [], ...(reuse === undefined ? {} : { reusedProjectsFrom: resolve(process.argv[5]), createdProjects: 0 }), modelRequests: 0, humanAttestationsCreated: 0 }
await writeFile(projectsPath, JSON.stringify(report, null, 2), { flag: 'wx' })
const persist = () => writeFile(projectsPath, JSON.stringify(report, null, 2))
const snapshot = await request('/snapshot')
for (const item of original.cases) {
  const previous = prepared.projects.find((p) => p.caseId === item.caseId)
  const source = snapshot.projects.find((p) => p.id === previous.projectId)
  assert.ok(source)
  const next = cases.find((c) => c.caseId === ids.get(item.caseId))
  assert.equal(source.prd, next.proposedPrd.trim(), 'Do not silently alter the reviewed source.')
  if (item.expectedReadiness === 'ready') {
    assert.equal((await request(`/projects/${source.id}/planning-operations`)).length, 0)
    report.projects.push({ ...previous })
    await persist()
    continue
  }
  const gold = JSON.parse(await readFile(resolve('planning-evals/cases', item.caseId, 'gold.json'), 'utf8'))
  const record = { ...previous, caseId: next.caseId, projectId: null, projectIdsByRun: {} }
  report.projects.push(record)
  await persist()
  let releaseInput
  const reusable = reuse?.projects.filter((p) => p.repositoryIdentity === item.repositoryIdentity && p.expectedReadiness === 'blocked')
  if (reuse) {
    assert.equal(reusable.length, 1)
    assert.equal(new Set(Object.values(reusable[0].projectIdsByRun)).size, 5)
  }
  for (let index = 1; index <= 5; index++) {
    const existingProject = reusable === undefined ? undefined : snapshot.projects.find((p) => p.id === reusable[0].projectIdsByRun[`fresh-${index}`])
    if (reusable !== undefined) assert.ok(existingProject)
    const previousOperations = existingProject === undefined ? [] : await request(`/projects/${existingProject.id}/planning-operations`)
    assert.ok(previousOperations.every((operation) => operation.status !== 'running'), 'Do not replace an in-flight input.')
    const project = existingProject === undefined || previousOperations.length > 0
      ? await request('/projects', { mode: 'empty', name: source.name, cwd: source.cwd, prd: source.prd, technicalDesign: source.technicalDesign, taskLanguage: source.taskLanguage })
      : existingProject
    if (reuse !== undefined && project.id !== existingProject.id) {
      report.createdProjects += 1
      report.replacedUsedDraftProjects ??= []
      report.replacedUsedDraftProjects.push({ caseId: next.caseId, runId: `fresh-${index}`, previousProjectId: existingProject.id, projectId: project.id, previousOperationIds: previousOperations.map((operation) => operation.id) })
    }
    assert.ok(project)
    assert.equal(project.status, 'draft')
    for (const field of ['name', 'cwd', 'prd', 'technicalDesign', 'taskLanguage']) assert.equal(project[field], source[field])
    record.projectId ??= project.id
    record.projectIdsByRun[`fresh-${index}`] = project.id
    await persist()
    assert.deepEqual(await request(`/projects/${project.id}/agents`), [])
    assert.equal((await request(`/projects/${project.id}/planning-operations`)).length, 0)
    const preview = await request(`/projects/${project.id}/planning-evaluation-input`)
    const { promptVersionsDigest, ...otherFacts } = preview.releaseInput
    const { promptVersionsDigest: oldPrompt, ...oldFacts } = gold.releaseInput
    assert.notEqual(promptVersionsDigest, oldPrompt)
    assert.deepEqual(otherFacts, oldFacts, 'Only the corrected prompt bundle may differ from the original decision-block input.')
    releaseInput ??= preview.releaseInput
    assert.deepEqual(preview.releaseInput, releaseInput)
    report.previews.push({ caseId: next.caseId, runId: `fresh-${index}`, projectId: project.id, releaseInput: preview.releaseInput, preparedAt: preview.preparedAt })
    await persist()
  }
}
report.status = 'unchanged_sources_and_pending_facts_with_corrected_bundle_before_models'
await persist()
console.log(JSON.stringify({ packetPath, projectsPath, cases: cases.length, pendingProjectPreviews: report.previews.length, newPendingProjects: reuse === undefined ? report.previews.length : report.createdProjects, reusedDraftProjects: reuse === undefined ? 0 : report.previews.length - report.createdProjects, readyProjectIdsPreserved: true, modelRequests: 0, humanAttestationsCreated: 0 }))
