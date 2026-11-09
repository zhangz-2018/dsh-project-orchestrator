import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { writeFile } from 'node:fs/promises'

const [operationId, sessionPath, destination] = process.argv.slice(2)
assert.ok(operationId && sessionPath && destination)
const snapshot = await (await fetch('http://127.0.0.1:3087/project-orchestrator/api/snapshot')).json()
const operation = snapshot.planningOperations.find(o => o.id === operationId)
assert.equal(operation.status, 'failed')
assert.ok(operation.diagnostics.some(d => d.code === 'agent-turn-timeout'))
const events = execFileSync('zstd', ['-dc', sessionPath], { encoding: 'utf8', maxBuffer: 20_000_000 }).trim().split('\n').map(JSON.parse)
const retries = events.filter(e => e.type === 'llm/retry').map(e => ({ at: new Date(e.time).toISOString(), retry: e.data.retry, maxRetries: e.data.maxRetries, failure: e.data.failure }))
const lifecycle = events.filter(e => ['turn/start', 'step/start', 'llm/retry', 'llm/retry-started', 'step/end', 'turn/end'].includes(e.type)).map(e => ({ type: e.type, at: new Date(e.time).toISOString(), reason: e.data.reason }))
const report = { observedAt: new Date().toISOString(), operationId, status: operation.status, stage: operation.stage, diagnostics: operation.diagnostics, sessionPath, eventCount: events.length, retries, lifecycle,
  conclusion: 'The upstream stream hit its 300000ms idle timeout and Harness started one retry within the unchanged 600000ms product turn deadline. The product cancelled the turn at that deadline. This audit does not establish why the upstream stream stalled or reclassify the recorded model failure.',
  modelRequests: 0, domainMutations: 0, originalFailureUnchanged: true }
await writeFile(destination, JSON.stringify(report, null, 2), { flag: 'wx' })
console.log(JSON.stringify({ destination, eventCount: events.length, retries, lifecycle }))
