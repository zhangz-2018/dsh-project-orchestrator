import assert from 'node:assert/strict'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'

// Preserve all reviewed specifications and project-scoped attestations. Every
// new case is evaluated only after independent Gold review on the new bundle.
const read = async path => JSON.parse(await readFile(resolve(path), 'utf8'))
const main = await read('output/acceptance/release-scenario-evidence-projects-2026-10-16.json')
const abstention = await read('output/acceptance/release-abstention-evidence-projects-2026-10-16.json')
const packet = await read(main.packetPath)
const abstentionPacket = await read(abstention.packetPath)
const originals = [...packet.cases, ...abstentionPacket.cases]
assert.equal(originals.length, 25)
const ids = new Map(originals.map(c => [c.caseId, `${c.caseId}-local-risk-v8`]))
const cases = originals.map(c => ({ ...c, caseId: ids.get(c.caseId), ...(c.pairedCaseId === undefined ? {} : { pairedCaseId: ids.get(c.pairedCaseId) }) }))
assert.equal(new Set(cases.map(c => c.caseId)).size, 25)
assert.ok(cases.every(c => c.pairedCaseId === undefined || cases.some(p => p.caseId === c.pairedCaseId)))
const projects = [...main.projects, ...abstention.projects].map(p => ({ ...p, caseId: ids.get(p.caseId) }))
assert.equal(projects.length, 25)
const response = await fetch(`${main.baseUrl}/project-orchestrator/api/snapshot`)
assert.ok(response.ok)
const snapshot = await response.json()
assert.equal(snapshot.planningOperations.filter(o => o.status === 'running').length, 0)
for (const item of projects) {
  const original = cases.find(c => c.caseId === item.caseId)
  for (const projectId of Object.values(item.projectIdsByRun ?? { first: item.projectId })) {
    const project = snapshot.projects.find(p => p.id === projectId)
    assert.ok(project)
    assert.equal(project.prd, original.proposedPrd.trim(), 'Never change the reviewed specification to accommodate a candidate.')
    assert.ok(['draft', 'awaiting_approval'].includes(project.status))
    assert.ok(!project.activePlanningOperationId)
  }
}
const directory = resolve('output/acceptance/release-local-risk-input-2026-10-16')
await mkdir(directory)
const packetPath = join(directory, 'review-inputs.json')
await writeFile(packetPath, JSON.stringify({ ...packet, cases, correction: 'Only case identifiers, pair references and the evaluated bundle change. All original specification bytes and expected behaviors are preserved; historical candidates are not supplied to Gold review.' }, null, 2), { flag: 'wx' })
const projectsPath = resolve('output/acceptance/release-local-risk-projects-2026-10-16.json')
await writeFile(projectsPath, JSON.stringify({ baseUrl: main.baseUrl, packetPath, agents: main.agents, projects, createdProjects: 0, copiedAttestations: 0, modelRequests: 0, historicalReports: ['output/acceptance/release-scenario-evidence-projects-2026-10-16.json', 'output/acceptance/release-abstention-evidence-projects-2026-10-16.json'] }, null, 2), { flag: 'wx' })
console.log(JSON.stringify({ packetPath, projectsPath, cases: cases.length, ready: cases.filter(c => c.expectedReadiness === 'ready').length, blocked: cases.filter(c => c.expectedReadiness === 'blocked').length, projectIdsPreserved: true, sourceBytesChanged: false }))
