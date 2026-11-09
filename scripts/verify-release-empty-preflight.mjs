import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'

// Read-only closure for this diagnosed preview/restoration race. No retry,
// model request, attempt creation or mutation of the empty journal occurs.
const [statePath, jobNumber, logPath] = process.argv.slice(2)
const state = JSON.parse(await readFile(statePath, 'utf8'))
const job = state.jobs.find(j => j.number === Number(jobNumber))
assert.ok(job && job.status === 'reserved')
const bytes = await readFile(job.ledgerPath)
const ledger = JSON.parse(bytes)
assert.equal(ledger.batchId, job.batchId)
assert.deepEqual(ledger.attempts, [])
assert.equal(ledger.cases.length, 1)
assert.equal(ledger.cases[0].caseId, job.caseId)
const projects = JSON.parse(await readFile(state.projectsPath, 'utf8'))
const project = projects.projects.find(p => p.caseId === job.caseId)
assert.ok(project && job.readiness === 'blocked' && job.runIndex > 5)
const log = await readFile(logPath, 'utf8')
assert.ok(log.includes(`/projects/${project.projectId}/planning-evaluation-input: HTTP 409 project-active`))
assert.ok(log.includes(`"batchId":"${job.batchId}","completedAttempts":0`))
const response = await fetch(`${projects.baseUrl}/project-orchestrator/api/snapshot`)
assert.ok(response.ok)
const snapshot = await response.json()
const live = snapshot.projects.find(p => p.id === project.projectId)
assert.ok(live && !live.activePlanningOperationId && ['draft', 'awaiting_approval'].includes(live.status))
const operations = snapshot.planningOperations.filter(o => o.projectId === project.projectId)
assert.ok(operations.length && operations.every(o => o.createdAt < job.startedAt && o.status !== 'running'))
const hash = value => createHash('sha256').update(value).digest('hex')
const report = { observedAt: new Date().toISOString(), status: 'preflight_failed_before_dispatch', batchId: job.batchId, projectId: project.projectId,
  ledgerPath: job.ledgerPath, ledgerSha256: hash(bytes), logPath: resolve(logPath), logSha256: hash(log),
  projectRestored: true, operations: operations.map(o => ({ id: o.id, createdAt: o.createdAt, status: o.status })),
  diagnosticCode: 'project-active', failedEndpoint: 'planning-evaluation-input', modelRequests: 0, domainMutations: 0, originalLedgerUnchanged: true }
const destination = `${job.ledgerPath.slice(0, -5)}-preflight-failure.json`
await writeFile(destination, JSON.stringify(report, null, 2), { flag: 'wx' })
console.log(JSON.stringify({ destination, status: report.status, modelRequests: 0, domainMutations: 0 }))
