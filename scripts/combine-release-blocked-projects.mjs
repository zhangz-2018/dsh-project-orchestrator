import assert from 'node:assert/strict'
import { readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'

// Combine existing prepared references; never create domain or capability facts.
const [firstPath, secondPath, outputPath] = process.argv.slice(2)
assert.ok(firstPath && secondPath && outputPath)
const reports = await Promise.all([firstPath, secondPath].map(async (path) => JSON.parse(await readFile(resolve(path), 'utf8'))))
assert.equal(reports[0].baseUrl, reports[1].baseUrl)
const projects = reports.flatMap((report) => report.projects.filter((p) => p.expectedReadiness === 'blocked'))
assert.equal(new Set(projects.map((p) => p.caseId)).size, projects.length)
assert.ok(projects.every((p) => p.pendingClaims.length === 0 && Object.keys(p.projectIdsByRun).length === 5))
const projectIds = projects.flatMap((p) => Object.values(p.projectIdsByRun))
assert.equal(new Set(projectIds).size, projectIds.length)
await writeFile(resolve(outputPath), JSON.stringify({ baseUrl: reports[0].baseUrl, sourceReports: [resolve(firstPath), resolve(secondPath)], projects, modelRequests: 0, humanAttestationsCreated: 0 }, null, 2), { flag: 'wx' })
console.log(JSON.stringify({ outputPath: resolve(outputPath), cases: projects.length, projects: projectIds.length }))
