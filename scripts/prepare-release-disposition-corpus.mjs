import assert from 'node:assert/strict'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'

// Reuse only reviewed source bytes and project identities, never candidates.
const tag = process.argv[2] ?? 'disposition'
const suffix = process.argv[3] ?? 'disposition-v9'
assert.match(tag, /^[a-z][a-z0-9-]+$/u)
assert.match(suffix, /^[a-z][a-z0-9-]+$/u)
const previousPath = process.argv[4] ?? 'output/acceptance/release-local-risk-projects-2026-10-16.json'
const previous = JSON.parse(await readFile(resolve(previousPath), 'utf8'))
const packet = JSON.parse(await readFile(previous.packetPath, 'utf8'))
const ids = new Map(packet.cases.map(c => [c.caseId, `${c.caseId}-${suffix}`]))
const cases = packet.cases.map(c => ({ ...c, caseId: ids.get(c.caseId), ...(c.pairedCaseId === undefined ? {} : { pairedCaseId: ids.get(c.pairedCaseId) }) }))
const projects = previous.projects.map(p => ({ ...p, caseId: ids.get(p.caseId) }))
assert.equal(cases.length, 25)
assert.equal(new Set(cases.map(c => c.caseId)).size, 25)
const response = await fetch(`${previous.baseUrl}/project-orchestrator/api/snapshot`)
assert.ok(response.ok)
const snapshot = await response.json()
assert.equal(snapshot.planningOperations.filter(o => o.status === 'running').length, 0)
for (const item of projects) {
  const source = cases.find(c => c.caseId === item.caseId)
  assert.ok(source)
  for (const id of Object.values(item.projectIdsByRun ?? { first: item.projectId })) {
    const project = snapshot.projects.find(p => p.id === id)
    assert.equal(project?.prd, source.proposedPrd.trim(), 'Never modify sources to accommodate candidates.')
    assert.ok(['draft', 'awaiting_approval'].includes(project.status))
    assert.ok(!project.activePlanningOperationId)
  }
}
const directory = resolve(`output/acceptance/release-${tag}-input-2026-10-16`)
await mkdir(directory)
const packetPath = join(directory, 'review-inputs.json')
await writeFile(packetPath, JSON.stringify({ ...packet, cases, correction: 'Only the evaluated bundle and case identifiers change. Original source, expected behavior and scoped project attestations are unchanged; no candidate outputs are supplied to Gold review.' }, null, 2), { flag: 'wx' })
const projectsPath = resolve(`output/acceptance/release-${tag}-projects-2026-10-16.json`)
await writeFile(projectsPath, JSON.stringify({ ...previous, packetPath, projects, createdProjects: 0, copiedAttestations: 0, modelRequests: 0, historicalReports: [...previous.historicalReports, previousPath] }, null, 2), { flag: 'wx' })
console.log(JSON.stringify({ packetPath, projectsPath, cases: cases.length, projectIdsPreserved: true, sourceBytesChanged: false }))
