import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import {
  assertExecutable,
  assignmentDigest,
  boundedText,
  buildRequirementSourceManifest,
  digestObject,
  materializeTasksV2,
  materializeTasks,
  parseGeneratedPlanV2,
  parseGeneratedPlan,
  parsePlannerResult,
  parseRequirementAnalysis,
  parseRequirementReview,
  planDigest,
  teamCompositionDigest,
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

function planningV2Fixture() {
  const manifest = buildRequirementSourceManifest({ prd: '# Feature\n## 验收标准\n1. 用户可以保存配置\n## 待确认事项\n1. 失败时是否自动重试？' })
  const acceptanceRef = manifest.anchors.find((anchor) => anchor.kind === 'acceptance_item').id
  const decisionRef = manifest.anchors.find((anchor) => anchor.kind === 'open_question').id
  const analysis = {
    status: 'needs_decision', summary: 'Structured requirements.',
    requirements: [{ key: 'REQ-001', kind: 'fact', scope: 'in_scope', statement: '用户可以保存配置。', sourceRefs: [acceptanceRef], acceptanceCriteria: [{ key: 'AC-001', statement: '保存后重新读取结果一致。', required: true, scenario: 'good', sourceRefs: [acceptanceRef] }] }],
    decisions: [{ key: 'DEC-001', question: '失败时是否自动重试？', options: [{ id: 'yes', label: '自动重试' }, { id: 'no', label: '不自动重试' }], impact: 'high', affectedRequirementKeys: ['REQ-001'], sourceRefs: [decisionRef] }],
    diagnostics: [],
  }
  return { manifest, analysis }
}

test('Planning V2 preserves required source anchors and rejects omissions or duplicate dispositions', () => {
  const { manifest, analysis } = planningV2Fixture()
  assert.deepEqual(parseRequirementAnalysis(JSON.stringify(analysis), manifest), analysis)
  const normalizedDiagnostics = parseRequirementAnalysis(JSON.stringify({ ...analysis, diagnostics: ['Source wording is ambiguous.'] }), manifest)
  assert.deepEqual(normalizedDiagnostics.diagnostics, [{ code: 'model-diagnostic-1', severity: 'warning', message: 'Source wording is ambiguous.', sourceRefs: [] }])
  const defaultedSourceRefs = parseRequirementAnalysis(JSON.stringify({ ...analysis, diagnostics: [{ code: 'source-ambiguity', severity: 'warning', message: 'Source wording is ambiguous.' }] }), manifest)
  assert.deepEqual(defaultedSourceRefs.diagnostics, [{ code: 'source-ambiguity', severity: 'warning', message: 'Source wording is ambiguous.', sourceRefs: [] }])
  const blockedDiagnostics = parseRequirementAnalysis(JSON.stringify({ ...analysis, status: 'blocked', diagnostics: ['Source conflict blocks analysis.'] }), manifest)
  assert.equal(blockedDiagnostics.diagnostics[0].severity, 'error')
  const readyWithHighImpactDecision = { ...analysis, status: 'ready' }
  assert.throws(() => parseRequirementAnalysis(JSON.stringify(readyWithHighImpactDecision), manifest), (error) => error.code === 'requirement-decision-pending')
  assert.deepEqual(parseRequirementAnalysis(JSON.stringify(readyWithHighImpactDecision), manifest, { resolvedDecisionKeys: ['DEC-001'] }), readyWithHighImpactDecision)
  assert.throws(() => parseRequirementAnalysis(JSON.stringify({ ...analysis, diagnostics: [42] }), manifest))
  assert.throws(() => parseRequirementAnalysis(JSON.stringify({ ...analysis, decisions: [] }), manifest), (error) => error.code === 'requirement-source-uncovered')
  assert.throws(() => parseRequirementAnalysis(JSON.stringify({ ...analysis, decisions: [{ ...analysis.decisions[0], sourceRefs: [analysis.requirements[0].acceptanceCriteria[0].sourceRefs[0]] }] }), manifest), (error) => ['requirement-source-uncovered', 'requirement-source-duplicate'].includes(error.code))
  const deferredWithoutReason = { ...analysis, status: 'ready', requirements: [{ ...analysis.requirements[0], scope: 'deferred', acceptanceCriteria: [] }] }
  assert.throws(() => parseRequirementAnalysis(JSON.stringify(deferredWithoutReason), manifest), /disposition reason/i)
})

test('PDF source manifest retains stable page/block locators instead of summarized Markdown line locators', () => {
  const documentHash = 'd'.repeat(64)
  const block = (page, index, text) => ({ documentKind: 'prd', locator: `pdf:${documentHash}:page:${page}:block:${index}`, page, block: index, text, textDigest: digestObject(text) })
  const manifest = buildRequirementSourceManifest({
    prd: '# AI 归纳后的需求文档\n## 验收标准\n1. 这不是原始 PDF locator',
    sourceBlocks: [block(3, 1, '## 验收标准'), block(3, 2, '1. 保存后结果一致'), block(4, 1, '## 待确认事项'), block(4, 2, '1. 失败时是否重试？')],
  })
  assert.deepEqual(manifest.anchors.filter((anchor) => anchor.requiredDisposition).map((anchor) => anchor.locator), [`pdf:${documentHash}:page:3:block:2`, `pdf:${documentHash}:page:4:block:2`])
  assert.equal(manifest.anchors.some((anchor) => anchor.locator.startsWith('prd:line:')), false)
  assert.throws(() => buildRequirementSourceManifest({ prd: '# ignored', sourceBlocks: [block(3, 1, 'first'), block(3, 1, 'conflicting duplicate')] }), (error) => error.code === 'requirement-source-locator-duplicate')
})

test('lscity-nuxt fixture preserves all 21 acceptance items and 27 open questions as independent dispositions', () => {
  const prd = readFileSync(new URL('./fixtures/lscity-nuxt-required-dispositions.md', import.meta.url), 'utf8')
  for (const signal of ['AI 自动补齐', '城链', '管理后台', '项目对比', '修改记录', 'AI 分析']) assert.match(prd, new RegExp(signal))
  const manifest = buildRequirementSourceManifest({ prd })
  const acceptance = manifest.anchors.filter((anchor) => anchor.kind === 'acceptance_item')
  const questions = manifest.anchors.filter((anchor) => anchor.kind === 'open_question')
  assert.equal(acceptance.length, 21)
  assert.equal(questions.length, 27)
  assert.equal(manifest.anchors.filter((anchor) => anchor.requiredDisposition).length, 48)
  const analysis = { status: 'ready', summary: 'lscity-nuxt dispositions.', requirements: acceptance.map((anchor, index) => ({ key: `REQ-${String(index + 1).padStart(3, '0')}`, kind: 'fact', scope: 'in_scope', statement: `Requirement ${index + 1}`, sourceRefs: [anchor.id], acceptanceCriteria: [{ key: `AC-${String(index + 1).padStart(3, '0')}`, statement: `Acceptance ${index + 1}`, required: true, scenario: 'good', sourceRefs: [anchor.id] }] })), decisions: questions.map((anchor, index) => ({ key: `DEC-${String(index + 1).padStart(3, '0')}`, question: `Question ${index + 1}`, options: [{ id: 'resolve', label: 'Resolve now' }, { id: 'defer', label: 'Defer with reason' }], impact: 'low', affectedRequirementKeys: [`REQ-${String(Math.min(index + 1, 21)).padStart(3, '0')}`], sourceRefs: [anchor.id] })), diagnostics: [] }
  assert.deepEqual(parseRequirementAnalysis(JSON.stringify(analysis), manifest), analysis)
})

test('Requirement review is digest-bound and cannot approve blocking findings', () => {
  const { manifest, analysis } = planningV2Fixture()
  const expectedDigest = digestObject(analysis)
  const approved = { status: 'approved', reviewedSourceDigest: manifest.sourceDigest, reviewedAnalysisDigest: expectedDigest, missingSourceRefs: [], conflicts: [], untestableAcceptanceKeys: [], findings: [] }
  assert.deepEqual(parseRequirementReview(JSON.stringify(approved), { sourceDigest: manifest.sourceDigest, analysisDigest: expectedDigest }), approved)
  assert.throws(() => parseRequirementReview(JSON.stringify({ ...approved, reviewedSourceDigest: '0'.repeat(64) }), { sourceDigest: manifest.sourceDigest, analysisDigest: expectedDigest }), (error) => error.code === 'requirement-review-stale')
})

test('Delivery Plan V2 requires implementation and verification coverage and derives assignment ids in Service materialization', () => {
  const { analysis: unresolved } = planningV2Fixture()
  const analysis = { ...unresolved, status: 'ready', decisions: [] }
  const task = (id, kind, relationship, role, capability, dependencies = []) => ({ id, title: id, kind, relationship, description: id, completionCriteria: ['done'], dependencies, sourceRequirementKeys: ['REQ-001'], acceptanceKeys: ['AC-001'], decisionKeys: [], assignmentPolicy: { policyVersion: 2, mode: 'single_agent', riskLevel: 'low', requiredRoles: [role], requiredCapabilities: [capability], requiresIndependentReviewer: false, maxParallel: 1, conflictKeys: ['src'], allowedScope: ['src'], forbiddenScope: [], escalationConditions: [] }, evidenceRefs: ['package.json'], testCommand: 'pnpm test' })
  const raw = { contractVersion: 2, status: 'ready', summary: 'Plan', repositoryEvidence: { inspectedPaths: ['package.json'], manifests: ['package.json'], verifiedCommands: ['pnpm test'], relevantModules: ['src'], assumptions: [] }, tasks: [task('implement', 'code', 'implementation', 'implementer', 'implementation'), task('verify', 'test', 'verification', 'verifier', 'testing', ['implement'])], diagnostics: [] }
  const plan = parseGeneratedPlanV2(JSON.stringify(raw), { analysis, capabilityCatalog: ['implementation', 'testing'], roleCatalog: ['implementer', 'verifier'] })
  const normalizedPlan = parseGeneratedPlanV2(JSON.stringify({ ...raw, diagnostics: ['Repository evidence is bounded.'] }), { analysis, capabilityCatalog: ['implementation', 'testing'], roleCatalog: ['implementer', 'verifier'] })
  assert.deepEqual(normalizedPlan.diagnostics, [{ code: 'model-diagnostic-1', severity: 'warning', message: 'Repository evidence is bounded.' }])
  const requirementIds = new Map([['REQ-001', 'req-id']]); const acceptanceIds = new Map([['AC-001', 'acc-id']]); const decisionIds = new Map()
  const tasksV2 = materializeTasksV2('p1', plan, { requirementIds, acceptanceIds, decisionIds }, [{ id: 'engineer', deliveryRoles: ['implementer'], capabilities: ['implementation'], runtimeStatus: 'online', availableSlots: 0 }, { id: 'tester', deliveryRoles: ['verifier'], capabilities: ['testing'], runtimeStatus: 'online', availableSlots: 1 }], now)
  assert.deepEqual(tasksV2.map((item) => item.agentId), ['engineer', 'tester'])
  assert.deepEqual(tasksV2[0].assignmentPolicy.allowedAgentIds, ['engineer'])
  assert.deepEqual(tasksV2[0].sourceRequirementIds, ['req-id'])
  assert.deepEqual(tasksV2[0].acceptanceIds, ['acc-id'])
  assert.equal(tasksV2[0].planningContractVersion, 2)
  assert.throws(() => parseGeneratedPlanV2(JSON.stringify({ ...raw, tasks: [raw.tasks[0]] }), { analysis, capabilityCatalog: ['implementation'], roleCatalog: ['implementer'] }), (error) => ['incomplete-plan', 'acceptance-verification-missing'].includes(error.code))
  assert.throws(() => parseGeneratedPlanV2(JSON.stringify({ ...raw, tasks: raw.tasks.map((item, index) => index === 0 ? { ...item, assignmentPolicy: { ...item.assignmentPolicy, allowedAgentIds: ['forged'] } } : item) }), { analysis, capabilityCatalog: ['implementation', 'testing'], roleCatalog: ['implementer', 'verifier'] }))

  const decisionPlan = { ...raw, tasks: raw.tasks.map((item) => ({ ...item, decisionKeys: ['DEC-001'] })) }
  assert.throws(() => parseGeneratedPlanV2(JSON.stringify(decisionPlan), { analysis: unresolved, capabilityCatalog: ['implementation', 'testing'], roleCatalog: ['implementer', 'verifier'] }), (error) => error.code === 'plan-decision-unresolved')
  assert.doesNotThrow(() => parseGeneratedPlanV2(JSON.stringify(decisionPlan), { analysis: unresolved, capabilityCatalog: ['implementation', 'testing'], roleCatalog: ['implementer', 'verifier'], resolvedDecisionKeys: ['DEC-001'] }))
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
  assert.equal(generated[0].assignmentSource, 'planner_recommendation')
  assert.equal(generated[1].agentId, undefined)
  assert.equal(generated[1].assignmentSource, 'automatic_match')
  assert.equal(generated.every((task) => task.assignmentPolicy?.mode === 'single_agent'), true)
  assert.deepEqual(generated[0].assignmentPolicy.requiredRoles, [])
})

test('task assignment policy filters capabilities and independent review ownership', () => {
  const plan = parseGeneratedPlan(JSON.stringify({
    summary: 'Policy plan',
    tasks: [
      { id: 'code', title: 'Code', kind: 'code', description: 'Implement', acceptanceCriteria: ['done'], dependencies: [], suggestedAgentRole: 'Engineer', evidenceRefs: ['src'], assignmentPolicy: { mode: 'single_agent', requiredRoles: ['Engineer'], requiredCapabilities: ['coding'], allowedAgentIds: [], allowedSquadIds: [], requiresIndependentReviewer: true, maxParallel: 1, conflictKeys: [], forbiddenScope: [], escalationConditions: [] }, testCommand: 'true' },
      { id: 'test', title: 'Test', kind: 'test', description: 'Verify', acceptanceCriteria: ['passes'], dependencies: ['code'], suggestedAgentRole: 'QA', evidenceRefs: ['tests'], testCommand: 'true' },
    ],
  }))
  const generated = materializeTasks('p1', plan, [
    { id: 'engineer', role: 'Software Engineer', projectRole: 'Engineer', capabilities: ['coding'], autoAssignable: true, status: 'active' },
    { id: 'reviewer', role: 'Code Reviewer', projectRole: 'Reviewer', capabilities: ['review'], autoAssignable: true, status: 'active' },
  ], now)
  assert.equal(generated[0].agentId, 'engineer')
  assert.equal(generated[0].assignmentSource, 'automatic_match')
  assert.equal(generated[0].assignmentPolicy?.requiresIndependentReviewer, true)
  const assigned = generated.map((task) => ({ ...task, agentId: task.agentId ?? 'engineer' }))
  const digest = planDigest({ ...project, teamDigest: 'a'.repeat(64), assignmentDigest: 'b'.repeat(64) }, assigned)
  assert.doesNotThrow(() => assertExecutable(
    { ...project, teamDigest: 'a'.repeat(64), assignmentDigest: 'b'.repeat(64) },
    assigned,
    { revision: 2, planHash: digest },
    [{ agentId: 'engineer', active: true }, { agentId: 'reviewer', active: true }],
    [{ id: 'engineer', role: 'Software Engineer', projectRole: 'Engineer', capabilities: ['coding'], status: 'active' }, { id: 'reviewer', role: 'Code Reviewer', projectRole: 'Reviewer', capabilities: ['review'], status: 'active' }],
    { leadAgentId: 'engineer', reviewerAgentId: 'reviewer', members: [], squads: [], teamDigest: 'a'.repeat(64), capturedAt: now },
  ))
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

test('assertExecutable treats high-risk tasks as requiring independent review', () => {
  const highRisk = tasks.map((task, index) => ({
    ...task,
    agentId: index === 0 ? 'engineer' : 'tester',
    ...(index === 0 ? { assignmentPolicy: { mode: 'single_agent', riskLevel: 'high', requiredRoles: [], requiredCapabilities: [], allowedAgentIds: [], allowedSquadIds: [], requiresIndependentReviewer: false, maxParallel: 1, conflictKeys: [], forbiddenScope: [], escalationConditions: [] } } : {}),
  }))
  const withDigests = { ...project, teamDigest: 'a'.repeat(64), assignmentDigest: assignmentDigest(highRisk) }
  const digest = planDigest(withDigests, highRisk)
  assert.throws(() => assertExecutable(
    withDigests,
    highRisk,
    { revision: project.revision, planHash: digest },
    [{ agentId: 'engineer', active: true }, { agentId: 'tester', active: true }],
    [{ id: 'engineer', role: 'Engineer', capabilities: [], status: 'active' }, { id: 'tester', role: 'Tester', capabilities: [], status: 'active' }],
    { leadAgentId: 'engineer', members: [], squads: [], teamDigest: 'a'.repeat(64), capturedAt: now },
  ), /high risk.*independent reviewer/)
})

test('team composition digest ignores live slots but tracks capacity policy and runtime state', () => {
  const member = { agentId: 'engineer', projectRole: 'Engineer', source: 'manual', sourceId: 'membership-1', capabilities: ['coding'], runtimeStatus: 'online', maxConcurrency: 2, availableSlots: 2 }
  const snapshot = { leadAgentId: 'engineer', members: [member], squads: [] }
  const digest = teamCompositionDigest(snapshot)
  assert.equal(teamCompositionDigest({ ...snapshot, members: [{ ...member, availableSlots: 0 }] }), digest)
  assert.notEqual(teamCompositionDigest({ ...snapshot, members: [{ ...member, maxConcurrency: 1 }] }), digest)
  assert.notEqual(teamCompositionDigest({ ...snapshot, members: [{ ...member, runtimeStatus: 'offline' }] }), digest)
})

test('team composition digest is independent of member, capability, Squad, and Squad-member order', () => {
  const memberA = { agentId: 'a', projectRole: 'Engineer', source: 'manual', sourceId: 'membership-a', capabilities: ['tests', 'coding'], runtimeStatus: 'online', maxConcurrency: 2 }
  const memberB = { agentId: 'b', projectRole: 'Reviewer', source: 'manual', sourceId: 'membership-b', capabilities: ['review'], runtimeStatus: 'online', maxConcurrency: 1 }
  const squadA = { squadId: 'squad-a', leaderAgentId: 'a', memberAgentIds: ['b', 'a'], maxParallelDelegations: 2, syncedSquadUpdatedAt: now }
  const squadB = { squadId: 'squad-b', leaderAgentId: 'b', memberAgentIds: ['a', 'b'], maxParallelDelegations: 1, syncedSquadUpdatedAt: now }
  const first = { leadAgentId: 'a', members: [memberA, memberB], squads: [squadA, squadB] }
  const reordered = { leadAgentId: 'a', members: [memberB, { ...memberA, capabilities: ['coding', 'tests'] }], squads: [{ ...squadB, memberAgentIds: ['b', 'a'] }, { ...squadA, memberAgentIds: ['a', 'b'] }] }
  assert.equal(teamCompositionDigest(first), teamCompositionDigest(reordered))
})

test('materializeTasks prefers exact roles, then capacity, then stable Agent id', () => {
  const plan = parseGeneratedPlan(JSON.stringify({
    summary: 'Stable assignment',
    tasks: [
      { id: 'code', title: 'Code', kind: 'code', description: 'Implement', acceptanceCriteria: ['done'], dependencies: [], suggestedAgentRole: 'Engineer', evidenceRefs: ['src'], assignmentPolicy: { mode: 'single_agent', requiredRoles: ['Engineer'], requiredCapabilities: ['coding'], allowedAgentIds: [], allowedSquadIds: [], requiresIndependentReviewer: false, maxParallel: 1, conflictKeys: [], forbiddenScope: [], escalationConditions: [] }, testCommand: 'true' },
      { id: 'test', title: 'Test', kind: 'test', description: 'Verify', acceptanceCriteria: ['passes'], dependencies: ['code'], suggestedAgentRole: 'QA', evidenceRefs: ['tests'], testCommand: 'true' },
    ],
  }))
  const assigned = materializeTasks('p1', plan, [
    { id: 'z-broad', role: 'Engineer', projectRole: 'Senior Engineer', capabilities: ['coding'], availableSlots: 8 },
    { id: 'b-exact', role: 'Engineer', projectRole: 'Engineer', capabilities: ['coding'], availableSlots: 2 },
    { id: 'a-exact', role: 'Engineer', projectRole: 'Engineer', capabilities: ['coding'], availableSlots: 2 },
  ], now)
  assert.equal(assigned[0].agentId, 'a-exact')
})

test('boundedText retains the final evidence', () => {
  const value = `prefix-${'x'.repeat(100)}-important-tail`
  const bounded = boundedText(value, 64)
  assert.ok(Buffer.byteLength(bounded) <= 64)
  assert.match(bounded, /important-tail$/)
})
