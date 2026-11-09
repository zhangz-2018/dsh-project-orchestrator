import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'

// Before any ready candidate or Gold freeze, clarify writable owner semantics.
// Preserve project IDs, members and the exact pending capability review packet.
const packetPath = resolve(process.argv[2])
const packet = JSON.parse(await readFile(packetPath, 'utf8'))
const projects = JSON.parse(await readFile(resolve('output/acceptance/release-projects-2026-10-16.json'), 'utf8'))
const base = projects.baseUrl
const request = async (path, body) => {
  const response = await fetch(`${base}/project-orchestrator/api${path}`, { method: body === undefined ? 'GET' : 'PUT', headers: { origin: base, 'content-type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(30_000) })
  const data = await response.json()
  assert.ok(response.ok, `${response.status} ${data.error?.code ?? ''}`)
  return data
}
const report = { packetPath, observedAt: new Date().toISOString(), scope: 'ready project PRDs only before candidates', updates: [] }
for (const p of projects.projects.filter((p) => p.expectedReadiness === 'ready')) {
  assert.equal((await request(`/projects/${p.projectId}/planning-operations`)).length, 0)
  const snapshot = await request('/snapshot')
  const project = snapshot.projects.find((item) => item.id === p.projectId)
  assert.equal(project.status, 'draft')
  const item = packet.cases.find((c) => c.caseId === p.caseId)
  const keys = ['name', 'summary', 'cwd', 'priority', 'owner', 'taskLanguage', 'technicalDesign']
  const input = Object.fromEntries(keys.filter((k) => project[k] !== undefined).map((k) => [k, project[k]]))
  const updated = await request(`/projects/${p.projectId}`, { ...input, prd: item.proposedPrd })
  assert.equal(updated.prd, item.proposedPrd.trim())
  report.updates.push({ caseId: p.caseId, projectId: p.projectId, previousPrdSha256: createHash('sha256').update(project.prd).digest('hex'), prdSha256: createHash('sha256').update(updated.prd).digest('hex') })
}
await writeFile(resolve('output/acceptance/release-ready-inputs-updated-2026-10-16.json'), JSON.stringify(report, null, 2), { flag: 'wx' })
console.log(JSON.stringify({ updates: report.updates.length, modelRequests: 0, trustedClaimsCreated: 0 }))
