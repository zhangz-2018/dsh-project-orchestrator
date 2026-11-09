import assert from 'node:assert/strict'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'

// Mechanical version isolation; never change specifications or copy trusted
// claims. Freeze new Gold separately, before running any new-version candidate.
const [previousPath, oldSuffix, newSuffix, destination, projectsPath] = process.argv.slice(2)
assert.ok(previousPath && oldSuffix && newSuffix && destination && projectsPath)
assert.match(oldSuffix, /^[a-z][a-z0-9-]+$/u)
assert.match(newSuffix, /^[a-z][a-z0-9-]+$/u)
assert.notEqual(oldSuffix, newSuffix)
const previous = JSON.parse(await readFile(previousPath, 'utf8'))
const packet = JSON.parse(await readFile(previous.packetPath, 'utf8'))
const rename = id => { assert.ok(id.endsWith(`-${oldSuffix}`)); return `${id.slice(0, -oldSuffix.length)}${newSuffix}` }
const cases = packet.cases.map(c => ({ ...c, caseId: rename(c.caseId), ...(c.pairedCaseId === undefined ? {} : { pairedCaseId: rename(c.pairedCaseId) }) }))
const projects = previous.projects.map(p => ({ ...p, caseId: rename(p.caseId) }))
assert.equal(cases.length, 25)
assert.equal(projects.length, 25)
assert.equal(new Set(cases.map(c => c.caseId)).size, 25)
const response = await fetch(`${previous.baseUrl}/project-orchestrator/api/snapshot`)
assert.ok(response.ok)
const snapshot = await response.json()
assert.equal(snapshot.planningOperations.filter(o => o.status === 'running').length, 0)
for (const item of projects) {
  const original = cases.find(c => c.caseId === item.caseId)
  assert.ok(original)
  if (original.pairedCaseId !== undefined) assert.ok(cases.some(c => c.caseId === original.pairedCaseId))
  for (const id of Object.values(item.projectIdsByRun ?? { first: item.projectId })) {
    const live = snapshot.projects.find(p => p.id === id)
    assert.equal(live?.prd, original.proposedPrd.trim(), 'Original reviewed specification must remain byte-identical.')
    assert.ok(['draft', 'awaiting_approval'].includes(live.status))
    assert.ok(!live.activePlanningOperationId)
  }
}
await mkdir(destination)
const packetPath = resolve(join(destination, 'review-inputs.json'))
await writeFile(packetPath, JSON.stringify({ ...packet, cases }, null, 2), { flag: 'wx' })
await writeFile(projectsPath, JSON.stringify({ ...previous, packetPath, projects,
  sourceProjectsPath: resolve(previousPath), createdProjects: 0, copiedAttestations: 0, modelRequests: 0,
  isolation: { oldSuffix, newSuffix, originalSpecificationBytesUnchanged: true, projectIdsPreserved: true },
}, null, 2), { flag: 'wx' })
console.log(JSON.stringify({ packetPath, projectsPath, cases: cases.length, projectIdsPreserved: true, sourceBytesChanged: false, domainMutations: 0 }))
