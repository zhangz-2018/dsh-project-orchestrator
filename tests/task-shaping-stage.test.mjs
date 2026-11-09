import assert from 'node:assert/strict'
import test from 'node:test'
import { TaskRecordSchema, VerificationSpecRecordSchema, shapePlanningTasksV3, verificationSpecDigest } from '../lib/index.js'

const now = '2026-09-23T00:00:00.000Z'
const digest = 'a'.repeat(64)

function fixture() {
  const proposal = {
    key: 'TASK-IMPLEMENT', workPackageKey: 'WP-1', title: 'Implement feature', kind: 'code', relationship: 'implementation',
    description: 'Implement one bounded feature.', requirementKeys: ['REQ-1'], acceptanceKeys: ['AC-1'], scenarioKeys: ['SCN-1'],
    decisionKeys: [], policyConstraintRefs: [], bindingKeys: ['BIND-1'], evidenceClaimRefs: ['ref-binding'], dependencyKeys: [],
    verificationCommandRefs: ['ref-command'], completionCriteria: ['Feature works.'], risk: 'medium',
    contextPack: { escalationConditions: ['Scope changes.'], verificationSteps: [] },
    changeContract: { conflictKeys: ['src/feature.ts'], allowedPathScopes: ['src/feature.ts'], excludedPathScopes: [] },
  }
  const verification = {
    ...proposal,
    key: 'TASK-VERIFY', title: 'Verify feature', kind: 'test', relationship: 'verification',
    dependencyKeys: ['TASK-IMPLEMENT'],
    contextPack: {
      escalationConditions: ['Verification is blocked.'],
      verificationHarness: { kind: 'browser' },
      verificationSteps: [{ scenarioKey: 'SCN-1', testFile: 'tests/browser/feature.spec.mjs', testKey: 'feature renders', browserProject: 'chromium' }],
    },
    changeContract: { conflictKeys: ['tests/browser/feature.spec.mjs'], allowedPathScopes: ['tests/browser/feature.spec.mjs'], excludedPathScopes: [] },
  }
  const taskIdsByKey = { 'TASK-IMPLEMENT': 'task-implement', 'TASK-VERIFY': 'task-verify' }
  const stageRecords = Object.entries(taskIdsByKey).map(([taskKey, taskId]) => ({ taskKey, taskId }))
  let teamCalls = 0
  const input = {
    projectId: 'project-1', planSnapshotId: 'plan-1', plan: { tasks: [proposal, verification] }, preservedTasks: [],
    referenceMap: { id: 'map-1', operationId: 'operation-1', reservedPlanSnapshotId: 'plan-1', taskIdsByKey, workPackageIdsByKey: { 'WP-1': 'work-package-1' } },
    requirementIds: new Map([['REQ-1', 'requirement-1']]), acceptanceIds: new Map([['AC-1', 'acceptance-1']]), decisionIds: new Map(),
    codeBindings: [{ id: 'binding-1', key: 'BIND-1' }], scenarios: [{ id: 'scenario-1', key: 'SCN-1' }],
    planManifest: { id: 'manifest-1', projectId: 'project-1', operationId: 'operation-1', references: [
      { ref: 'ref-binding', kind: 'evidence_claim', artifactId: 'binding-1', artifactDigest: digest },
      { ref: 'ref-command', kind: 'verification_command', artifactId: 'pnpm test', artifactDigest: digest },
    ] },
    capabilityRequirements: stageRecords.map(({ taskKey }) => ({ id: `capability-${taskKey}`, taskKey, requiredRoles: [taskKey === 'TASK-VERIFY' ? 'verifier' : 'implementer'], requiredCapabilities: ['language.typescript'], requiresIndependentReviewer: false })),
    assignmentDrafts: stageRecords.map(({ taskKey }) => ({ id: `assignment-${taskKey}`, taskKey, executingAgentId: 'agent-1' })),
    assignmentEvaluations: stageRecords.map(({ taskKey }) => ({ id: `evaluation-${taskKey}`, taskKey })),
    preflights: stageRecords.map(({ taskKey }) => ({ id: `preflight-${taskKey}`, taskKey, preflightDigest: digest })),
    createdAt: now,
    captureTeam: () => { teamCalls += 1; return { teamDigest: 'b'.repeat(64) } },
  }
  return { input, teamCalls: () => teamCalls }
}

test('TaskShapingStage maps approved proposals into Task and VerificationSpec records', () => {
  const { input, teamCalls } = fixture()
  const shaped = shapePlanningTasksV3(input)
  assert.equal(teamCalls(), 1)
  assert.deepEqual(shaped.newTasks.map((task) => task.id), ['task-implement', 'task-verify'])
  assert.deepEqual(shaped.newTasks[1].dependencies, ['task-implement'])
  assert.deepEqual(shaped.newTasks.map((task) => task.assignmentPolicy.requiredRoles), [['implementer'], ['verifier']])
  assert.equal(shaped.newTasks[0].evidenceIds[0], 'binding-1')
  assert.ok(shaped.newTasks.every((task) => task.teamDigest === shaped.team.teamDigest && task.assignmentDigest === shaped.nextAssignmentDigest))
  for (const task of shaped.newTasks) assert.doesNotThrow(() => TaskRecordSchema.parse(task))
  assert.deepEqual(shaped.verificationSpecs.map((spec) => spec.provider), ['command', 'playwright'])
  assert.equal(shaped.verificationSpecs[1].reportContract.testMappings[0].testKey, 'feature renders')
  for (const spec of shaped.verificationSpecs) {
    assert.doesNotThrow(() => VerificationSpecRecordSchema.parse(spec))
    const { specDigest, ...core } = spec
    assert.equal(specDigest, verificationSpecDigest(core))
  }
})

test('TaskShapingStage rejects missing command and cross-candidate inputs before Team capture', () => {
  const { input, teamCalls } = fixture()
  const missingCommand = { ...input, planManifest: { ...input.planManifest, references: input.planManifest.references.filter((item) => item.ref !== 'ref-command') } }
  assert.throws(() => shapePlanningTasksV3(missingCommand), (error) => error.code === 'planning-task-shape-incomplete')
  assert.throws(() => shapePlanningTasksV3({ ...input, planSnapshotId: 'other-plan' }), (error) => error.code === 'planning-task-shape-stale')
  assert.equal(teamCalls(), 0)
})

test('TaskShapingStage appends new Task ordinals after preserved Tasks', () => {
  const { input } = fixture()
  const preserved = TaskRecordSchema.parse({
    id: 'task-existing', projectId: input.projectId, ordinal: 0, title: 'Existing task', kind: 'code', description: 'Preserved.',
    acceptanceCriteria: ['Existing behavior remains.'], dependencies: [], testCommand: 'pnpm test', status: 'completed', createdAt: now, updatedAt: now,
  })
  const shaped = shapePlanningTasksV3({ ...input, preservedTasks: [preserved] })
  assert.deepEqual(shaped.allTasks.map((task) => task.id), ['task-existing', 'task-implement', 'task-verify'])
  assert.deepEqual(shaped.newTasks.map((task) => task.ordinal), [1, 2])
  assert.equal(shaped.allTasks[0], preserved)
})
