import assert from 'node:assert/strict'
import test from 'node:test'
import {
  assertExecutable,
  boundedText,
  parseGeneratedPlan,
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

test('parseGeneratedPlan requires code and test tasks', () => {
  const valid = JSON.stringify({
    summary: 'Plan',
    tasks: [
      { id: 'code', title: 'Code', kind: 'code', description: 'Implement', acceptanceCriteria: ['done'], dependencies: [], suggestedAgentRole: 'Engineer', testCommand: 'npm test' },
      { id: 'test', title: 'Test', kind: 'test', description: 'Verify', acceptanceCriteria: ['passes'], dependencies: ['code'], suggestedAgentRole: 'QA', testCommand: 'npm test' },
    ],
  })
  assert.equal(parseGeneratedPlan(`\`\`\`json\n${valid}\n\`\`\``).tasks.length, 2)
  assert.throws(() => parseGeneratedPlan(JSON.stringify({ summary: 'No tests', tasks: [JSON.parse(valid).tasks[0], { ...JSON.parse(valid).tasks[0], id: 'code2' }] })), /test task/)
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

test('boundedText retains the final evidence', () => {
  const value = `prefix-${'x'.repeat(100)}-important-tail`
  const bounded = boundedText(value, 64)
  assert.ok(Buffer.byteLength(bounded) <= 64)
  assert.match(bounded, /important-tail$/)
})
