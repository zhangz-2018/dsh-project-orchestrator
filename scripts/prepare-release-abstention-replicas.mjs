import assert from 'node:assert/strict'
import { readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'

// Five independent empty Projects represent one exact frozen input, not five
// repositories or five requirement samples. Every preview must match Gold.
const path = resolve('output/acceptance/release-abstention-project-2026-10-16.json')
const prepared = JSON.parse(await readFile(path, 'utf8'))
const record = prepared.projects[0]
const gold = JSON.parse(await readFile(resolve('planning-evals/cases', record.caseId, 'gold.json'), 'utf8'))
const base = prepared.baseUrl
const request = async (path, body) => {
  const response = await fetch(`${base}/project-orchestrator/api${path}`, { method: body === undefined ? 'GET' : 'POST', headers: { origin: base, 'content-type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(30_000) })
  const result = await response.json()
  assert.ok(response.ok, `${response.status} ${result.error?.code ?? ''}`)
  return result
}
const source = (await request('/snapshot')).projects.find((p) => p.id === record.projectId)
const output = resolve('output/acceptance/release-abstention-replicas-2026-10-16.json')
record.projectIdsByRun = { 'fresh-1': record.projectId }
const report = { ...prepared, status: 'preparing_frozen_input_replicas', releaseInput: gold.releaseInput, modelRequests: 0, humanAttestationsCreated: 0, previews: [] }
await writeFile(output, JSON.stringify(report, null, 2), { flag: 'wx' })
for (let index = 1; index <= 5; index++) {
  if (index > 1) {
    const project = await request('/projects', { mode: 'empty', name: source.name, cwd: source.cwd, prd: source.prd, technicalDesign: source.technicalDesign, taskLanguage: source.taskLanguage })
    record.projectIdsByRun[`fresh-${index}`] = project.id
    await writeFile(output, JSON.stringify(report, null, 2))
  }
  const projectId = record.projectIdsByRun[`fresh-${index}`]
  assert.equal((await request(`/projects/${projectId}/planning-operations`)).length, 0)
  assert.deepEqual(await request(`/projects/${projectId}/agents`), [])
  const preview = await request(`/projects/${projectId}/planning-evaluation-input`)
  assert.deepEqual(preview.releaseInput, gold.releaseInput, 'Replica must have the exact independently frozen input.')
  report.previews.push({ runId: `fresh-${index}`, projectId, releaseInput: preview.releaseInput, preparedAt: preview.preparedAt })
  await writeFile(output, JSON.stringify(report, null, 2))
}
report.status = 'five_projects_verified_against_one_frozen_gold'
await writeFile(output, JSON.stringify(report, null, 2))
console.log(JSON.stringify({ output, distinctProjects: 5, goldCases: 1, repositoryCount: 1, matchingFrozenInputs: 5, modelRequests: 0, humanAttestationsCreated: 0 }))
