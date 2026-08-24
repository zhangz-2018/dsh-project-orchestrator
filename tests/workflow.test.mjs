import assert from 'node:assert/strict'
import test from 'node:test'
import {
  assertExecutable,
  boundedText,
  materializeTasks,
  parseGeneratedPlan,
  parsePlannerResult,
  planDigest,
  topologicalTasks,
} from '../lib/index.js'

const now = '2026-08-17T00:00:00.000Z'
const project = {
  id: 'p1', name: 'Project', summary: '', cwd: '/tmp/project', prd: 'PRD', technicalDesign: 'Design',
  status: 'approved', revision: 2, approvedRevision: 2, taskIds: ['a', 'b'], createdAt: now, updatedAt: now,
}
const tasks = [
  {
    id: 'a', projectId: 'p1', ordinal: 0, title: 'Implement', kind: 'code', description: 'Build it',
    acceptanceCriteria: ['works'], dependencies: [], testCommand: 'npm test', status: 'draft', createdAt: now, updatedAt: now,
  },
  {
    id: 'b', projectId: 'p1', ordinal: 1, title: 'Test', kind: 'test', description: 'Test it',
    acceptanceCriteria: ['covered'], dependencies: ['a'], testCommand: 'npm test', status: 'draft', createdAt: now, updatedAt: now,
  },
]

test('topologicalTasks orders dependencies first', () => {
  assert.deepEqual(topologicalTasks([tasks[1], tasks[0]]).map((task) => task.id), ['a', 'b'])
})

test('topologicalTasks rejects cycles', () => {
  const cyclic = [
    { id: 'a', ordinal: 0, dependencies: ['b'] },
    { id: 'b', ordinal: 1, dependencies: ['a'] },
  ]
  assert.throws(() => topologicalTasks(cyclic), /cycle/)
})

test('parseGeneratedPlan preserves legacy unfenced and fenced plan compatibility', () => {
  const legacyPlan = {
    summary: 'Plan',
    tasks: [
      { id: 'code', title: 'Code', kind: 'code', description: 'Implement', acceptanceCriteria: ['done'], dependencies: [], suggestedAgentRole: 'Engineer', testCommand: 'npm test' },
      { id: 'test', title: 'Test', kind: 'test', description: 'Verify', acceptanceCriteria: ['passes'], dependencies: ['code'], suggestedAgentRole: 'QA', testCommand: 'npm test' },
    ],
  }
  const valid = JSON.stringify(legacyPlan)
  assert.deepEqual(parseGeneratedPlan(valid), legacyPlan)
  assert.deepEqual(parseGeneratedPlan(`\`\`\`json\n${valid}\n\`\`\``), legacyPlan)
  assert.throws(() => parseGeneratedPlan(JSON.stringify({ summary: 'No tests', tasks: [legacyPlan.tasks[0], { ...legacyPlan.tasks[0], id: 'code2' }] })), /test task/)
})

function readyPlannerResult(overrides = {}) {
  return {
    status: 'ready',
    summary: 'Evidence-backed plan',
    repositoryEvidence: {
      inspectedPaths: ['package.json', 'src/workflow.ts'],
      manifests: ['package.json'],
      verifiedCommands: ['pnpm test'],
      relevantModules: ['src/workflow.ts'],
      assumptions: [],
    },
    tasks: [
      { id: 'code', title: 'Code', kind: 'code', description: 'Implement', acceptanceCriteria: ['done'], dependencies: [], suggestedAgentRole: 'Engineer', evidenceRefs: ['src/workflow.ts'], testCommand: 'pnpm test' },
      { id: 'test', title: 'Test', kind: 'test', description: 'Verify', acceptanceCriteria: ['passes'], dependencies: ['code'], suggestedAgentRole: 'QA', evidenceRefs: ['package.json'], testCommand: 'pnpm test' },
    ],
    ...overrides,
  }
}

test('parsePlannerResult accepts ready plans only with task evidence and verified commands', () => {
  const ready = readyPlannerResult()
  assert.deepEqual(parsePlannerResult(JSON.stringify(ready)), ready)

  const emptySuggestedAgent = readyPlannerResult({ tasks: ready.tasks.map((task) => ({ ...task, suggestedAgentId: '  ' })) })
  assert.deepEqual(parsePlannerResult(JSON.stringify(emptySuggestedAgent)).tasks.map((task) => task.suggestedAgentId), [undefined, undefined])

  const withoutEvidence = readyPlannerResult({ tasks: ready.tasks.map((task, index) => index === 0 ? { ...task, evidenceRefs: undefined } : task) })
  assert.throws(() => parsePlannerResult(JSON.stringify(withoutEvidence)), (error) => error.code === 'task-evidence-required')

  const unverified = readyPlannerResult({ tasks: ready.tasks.map((task, index) => index === 0 ? { ...task, testCommand: 'npm test' } : task) })
  assert.throws(() => parsePlannerResult(JSON.stringify(unverified)), (error) => error.code === 'unverified-test-command')
})

test('parsePlannerResult preserves explicit blocked planner outcomes', () => {
  const blocked = {
    status: 'blocked',
    reasonCode: 'manifest_missing',
    summary: 'No repository manifest was available.',
    missingEvidence: ['package or build manifest'],
    nextAction: 'Restore the repository checkout and retry planning.',
  }
  assert.deepEqual(parsePlannerResult(JSON.stringify(blocked)), blocked)
})

test('assertExecutable binds approval to exact plan digest', () => {
  const digest = planDigest(project, tasks)
  assert.doesNotThrow(() => assertExecutable(project, tasks, { revision: 2, planHash: digest }))
  assert.notEqual(planDigest({ ...project, taskIds: ['b', 'a'] }, tasks), digest)
  assert.throws(() => assertExecutable(project, [{ ...tasks[0], testCommand: 'npm run changed' }, tasks[1]], { revision: 2, planHash: digest }), /changed/)
})

test('legacy approval hashes remain valid until execution metadata is persisted', () => {
  const legacyHash = '57387e0ece83c03ae24d248faf14e41008fb0bdf16c3b14eae2d6d547c75c05f'
  assert.equal(planDigest(project, tasks), legacyHash)
  assert.doesNotThrow(() => assertExecutable(project, tasks, { revision: project.revision, planHash: legacyHash }))

  const metadataCases = [
    [{ ...project, priority: 'medium' }, tasks],
    [{ ...project, owner: '' }, tasks],
    [project, [{ ...tasks[0], priority: 'medium' }, tasks[1]]],
    [project, [{ ...tasks[0], tags: [] }, tasks[1]]],
  ]
  for (const [metadataProject, metadataTasks] of metadataCases) {
    assert.notEqual(planDigest(metadataProject, metadataTasks), legacyHash)
  }

  const defaultPersistedProject = { ...project, priority: 'medium', owner: '' }
  const defaultPersistedTasks = tasks.map((task) => ({ ...task, priority: 'medium', tags: [] }))
  const currentHash = planDigest(defaultPersistedProject, defaultPersistedTasks)
  assert.throws(
    () => assertExecutable(defaultPersistedProject, defaultPersistedTasks, { revision: project.revision, planHash: legacyHash }),
    /changed and must be approved again/,
  )
  assert.doesNotThrow(() => assertExecutable(
    defaultPersistedProject,
    defaultPersistedTasks,
    { revision: project.revision, planHash: currentHash },
  ))
})

test('materializeTasks matches only eligible project memberships by project role', () => {
  const plan = parseGeneratedPlan(JSON.stringify({
    summary: 'Plan',
    tasks: [
      { id: 'code', title: 'Code', kind: 'code', description: 'Implement', acceptanceCriteria: ['done'], dependencies: [], suggestedAgentRole: 'No role match needed', suggestedAgentId: 'project-agent', testCommand: 'true' },
      { id: 'test', title: 'Test', kind: 'test', description: 'Verify', acceptanceCriteria: ['passes'], dependencies: ['code'], suggestedAgentRole: 'QA', testCommand: 'true' },
    ],
  }))
  const generated = materializeTasks('p1', plan, [
    { id: 'workspace-agent', role: 'Backend Engineer', projectRole: 'Backend', autoAssignable: false, status: 'active' },
    { id: 'project-agent', role: 'Generalist', projectRole: 'Backend', autoAssignable: true, status: 'active' },
    { id: 'removed-agent', role: 'QA', projectRole: 'QA', autoAssignable: true, status: 'removed' },
  ], now)
  assert.equal(generated[0].agentId, 'project-agent')
  assert.equal(generated[1].agentId, undefined)
})

test('assertExecutable requires every task assignee to remain an active project member', () => {
  const assigned = tasks.map((task, index) => ({ ...task, agentId: index === 0 ? 'engineer' : 'tester' }))
  const digest = planDigest(project, assigned)
  assert.throws(() => assertExecutable(project, assigned, { revision: 2, planHash: digest }, [{ agentId: 'engineer', active: true }]), (error) => error.code === 'project-agent-not-member')
  assert.doesNotThrow(() => assertExecutable(project, assigned, { revision: 2, planHash: digest }, [{ agentId: 'engineer', active: true }, { agentId: 'tester', active: true }]))
  const unassigned = [{ ...assigned[0] }, { ...assigned[1] }]
  delete unassigned[1].agentId
  assert.throws(() => assertExecutable(project, unassigned, { revision: 2, planHash: planDigest(project, unassigned) }, [{ agentId: 'engineer', active: true }]), (error) => error.code === 'project-task-unassigned')
})

test('boundedText retains the final evidence', () => {
  const value = `prefix-${'x'.repeat(100)}-important-tail`
  const bounded = boundedText(value, 64)
  assert.ok(Buffer.byteLength(bounded) <= 64)
  assert.match(bounded, /important-tail$/)
})
