import { performance } from 'node:perf_hooks'
import { buildWorkbenchBootstrap, OrchestratorStore, QueryService } from '../lib/index.js'

class MemoryTable {
  records = new Map()
  get(key) { return this.records.get(key) }
  entries() { return this.records.entries() }
  async put(key, value) { this.records.set(key, value) }
  async delete(key) { return this.records.delete(key) }
  async update(key, transform) {
    const next = transform(this.records.get(key))
    this.records.set(key, next)
    return next
  }
}

function fixture(projectCount, taskRunCount) {
  const tables = new Map()
  const domain = { table(name) { if (!tables.has(name)) tables.set(name, new MemoryTable()); return tables.get(name) } }
  const store = new OrchestratorStore(domain)
  const projects = tables.get('projects').records
  const taskRuns = tables.get('task_runs').records
  const activity = tables.get('activity').records
  const transcripts = tables.get('transcripts').records
  const artifacts = tables.get('artifacts').records
  for (let index = 0; index < projectCount; index += 1) {
    const id = `project-${index}`
    const timestamp = new Date(index * 1_000).toISOString()
    projects.set(id, { id, name: `Project ${index}`, summary: '', cwd: '/tmp', prd: '', technicalDesign: '', priority: 'medium', owner: '', status: 'running', revision: 1, taskIds: [], createdAt: timestamp, updatedAt: timestamp })
  }
  for (let index = 0; index < taskRunCount; index += 1) {
    const id = `run-${index}`
    const projectId = `project-${index % projectCount}`
    const timestamp = new Date(index * 1_000).toISOString()
    taskRuns.set(id, { id, projectId, taskId: `task-${index % (projectCount * 5)}`, status: index < projectCount ? 'running' : 'completed', trigger: 'system', attempt: 1, cwd: '/tmp', createdAt: timestamp })
    activity.set(`activity-${index}`, { id: `activity-${index}`, projectId, taskRunId: id, actorType: 'system', type: 'benchmark', message: 'x'.repeat(120), metadata: {}, createdAt: timestamp })
    transcripts.set(`transcript-${index}`, { id: `transcript-${index}`, taskRunId: id, sequence: 1, role: 'assistant', kind: 'message', text: 'x'.repeat(240), createdAt: timestamp })
    artifacts.set(`artifact-${index}`, { id: `artifact-${index}`, projectId, taskRunId: id, kind: 'log', name: `Artifact ${index}`, status: 'available', content: 'x'.repeat(240), metadata: {}, createdAt: timestamp })
  }
  return store
}

function measure(projectCount, taskRunCount) {
  const store = fixture(projectCount, taskRunCount)
  const snapshotStart = performance.now()
  const snapshot = store.snapshot()
  const snapshotMs = performance.now() - snapshotStart
  const bootstrapStart = performance.now()
  const bootstrap = buildWorkbenchBootstrap(snapshot)
  const bootstrapMs = performance.now() - bootstrapStart
  const historyStart = performance.now()
  const history = new QueryService(store).projectHistory('project-0', 'task-runs', undefined, 50)
  const historyFirstPageMs = performance.now() - historyStart
  const fullJsonBytes = Buffer.byteLength(JSON.stringify(snapshot))
  const bootstrapJsonBytes = Buffer.byteLength(JSON.stringify(bootstrap))
  if (bootstrap.totals.taskRuns !== taskRunCount) throw new Error('Bootstrap TaskRun total does not match the fixture.')
  if (bootstrap.snapshot.transcripts.length !== 0 || bootstrap.snapshot.artifacts.length !== 0) throw new Error('Bootstrap contains on-demand evidence payloads.')
  if (bootstrapJsonBytes >= fullJsonBytes) throw new Error('Bootstrap payload is not smaller than the compatibility snapshot.')
  if (history.items.length > 50) throw new Error('History query exceeded its requested page size.')
  return {
    projectCount,
    taskRunCount,
    transcriptCount: taskRunCount,
    artifactCount: taskRunCount,
    activityCount: taskRunCount,
    snapshotMs: Number(snapshotMs.toFixed(3)),
    bootstrapProjectionMs: Number(bootstrapMs.toFixed(3)),
    historyFirstPageMs: Number(historyFirstPageMs.toFixed(3)),
    fullJsonBytes,
    bootstrapJsonBytes,
    payloadRatio: Number((bootstrapJsonBytes / fullJsonBytes).toFixed(4)),
    bootstrapTaskRuns: bootstrap.snapshot.taskRuns.length,
    bootstrapActivity: bootstrap.snapshot.activity.length,
    historyPageItems: history.items.length,
    historyHasMore: history.hasMore,
  }
}

const results = [measure(10, 1_000), measure(100, 10_000)]
process.stdout.write(`${JSON.stringify({ schemaVersion: 1, generatedAt: new Date().toISOString(), results }, null, 2)}\n`)
