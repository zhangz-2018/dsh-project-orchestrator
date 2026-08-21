import assert from 'node:assert/strict'
import test from 'node:test'
import {
  OrchestratorService,
  OrchestratorStore,
  planDigest,
} from '../lib/index.js'

const now = '2026-08-17T00:00:00.000Z'

class MemoryTable {
  constructor(records = []) {
    this.records = new Map(records.map((record) => [record.id, structuredClone(record)]))
  }
  get(key) { return this.records.get(key) }
  entries() { return this.records.entries() }
}

function createStore({ agents = [], projects = [], tasks = [], approvals = [], runs = [], projectAgentMemberships = [], featureUsageDaily = [] } = {}) {
  const tables = {
    agents: new MemoryTable(agents),
    projects: new MemoryTable(projects),
    tasks: new MemoryTable(tasks),
    approvals: new MemoryTable(approvals),
    runs: new MemoryTable(runs),
    project_agent_memberships: new MemoryTable(projectAgentMemberships),
    feature_usage_daily: new MemoryTable(featureUsageDaily),
  }
  return new OrchestratorStore({ table: (name) => tables[name] })
}

function project(id, taskIds, overrides = {}) {
  return {
    id,
    name: id,
    summary: '',
    cwd: '/tmp',
    prd: 'PRD',
    technicalDesign: 'Design',
    priority: 'medium',
    owner: '',
    status: 'approved',
    revision: 2,
    approvedRevision: 2,
    taskIds,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  }
}

function task(id, projectId, ordinal, kind, dependencies = []) {
  return {
    id,
    projectId,
    ordinal,
    title: id,
    kind,
    priority: 'medium',
    tags: [],
    description: `Execute ${id}`,
    acceptanceCriteria: ['passes'],
    dependencies,
    testCommand: 'true',
    status: 'draft',
    createdAt: now,
    updatedAt: now,
  }
}

test('service snapshot exposes the current authoritative plan digest', () => {
  const currentProject = project('valid', ['code', 'test'])
  const currentTasks = [
    task('code', currentProject.id, 0, 'code'),
    task('test', currentProject.id, 1, 'test', ['code']),
  ]
  const expected = planDigest(currentProject, currentTasks)
  const approval = {
    id: `${currentProject.id}:${currentProject.revision}`,
    projectId: currentProject.id,
    revision: currentProject.revision,
    planHash: expected,
    actor: 'tester',
    approvedAt: now,
  }
  const service = new OrchestratorService({}, createStore({
    projects: [currentProject], tasks: currentTasks, approvals: [approval],
  }))

  const snapshot = service.snapshot()
  assert.equal(snapshot.planHashes[currentProject.id], expected)
  assert.equal(snapshot.planHashes[currentProject.id], snapshot.approvals[0].planHash)
})

test('snapshot includes durable memberships and local feature usage aggregates', () => {
  const membership = { id: 'p1:a1', projectId: 'p1', agentId: 'a1', projectRole: 'Backend', autoAssignable: true, status: 'active', joinedBy: 'tester', joinedAt: now, updatedAt: now }
  const usage = { id: '2026-08-17:projects', date: '2026-08-17', feature: 'projects', opens: 2, meaningfulActions: 1, errorRecoveries: 0, lastUsedAt: now }
  const snapshot = createStore({ projects: [project('p1', [])], projectAgentMemberships: [membership], featureUsageDaily: [usage] }).snapshot()
  assert.deepEqual(snapshot.projectAgentMemberships, [membership])
  assert.deepEqual(snapshot.featureUsageDaily, [usage])
})

test('snapshot omits hashes for corrupt plans while authoritative reads remain fail-closed', () => {
  const valid = project('valid', ['valid-code', 'valid-test'])
  const missing = project('missing', ['absent-task'])
  const duplicate = project('duplicate', ['duplicate-task', 'duplicate-task'])
  const foreign = project('foreign', ['foreign-task'])
  const tasks = [
    task('valid-code', valid.id, 0, 'code'),
    task('valid-test', valid.id, 1, 'test', ['valid-code']),
    task('duplicate-task', duplicate.id, 0, 'code'),
    task('foreign-task', 'another-project', 0, 'code'),
  ]
  const store = createStore({ projects: [valid, missing, duplicate, foreign], tasks })

  const snapshot = store.snapshot()
  assert.deepEqual(snapshot.planHashes, {
    valid: planDigest(valid, tasks.filter((entry) => entry.projectId === valid.id)),
  })
  assert.throws(() => store.projectTasks(missing), /missing task/)
  assert.throws(() => store.projectTasks(duplicate), /duplicate task pointers/)
  assert.throws(() => store.projectTasks(foreign), /does not belong/)
})
