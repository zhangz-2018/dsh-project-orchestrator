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
  PlanningPromptReferenceManifestRecordSchema,
  RepositoryContextSnapshotV3RecordSchema,
  parseGeneratedBindingAnalysisV3,
  parseGeneratedScenarioCompletionV3,
  parseGeneratedScenarioCoverageReviewV3,
  parseGeneratedPlanV3,
  deriveCapabilityRequirementDraftsV3,
  derivePolicyCapabilityIdsV3,
  qualifyAssignmentsV3,
  evaluateTaskPreflightV3,
  planExecutionDispatchV3,
  parseGeneratedPlan,
  parsePlannerResult,
  parseRequirementAnalysis,
  parseRequirementReview,
  planDigest,
  teamCompositionDigest,
  topologicalTasks,
} from '../lib/index.js'

const now = '2026-08-17T00:00:00.000Z'
const metricPolicyInput = { metricPolicyId: 'metric-policy:test', metricPolicyVersion: 'test-v1', metricPolicyDigest: 'a'.repeat(64), risk: 'medium' }
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
    requirements: [{ key: 'REQ-001', kind: 'fact', scope: 'in_scope', statement: '用户可以保存配置。', sourceRefs: [acceptanceRef], acceptanceCriteria: [{ key: 'AC-001', statement: '保存后重新读取结果一致。', required: true, scenario: 'happy_path', sourceRefs: [acceptanceRef] }] }],
    decisions: [{ key: 'DEC-001', question: '失败时是否自动重试？', options: [{ id: 'yes', label: '自动重试' }, { id: 'no', label: '不自动重试' }], impact: 'high', affectedRequirementKeys: ['REQ-001'], sourceRefs: [decisionRef] }],
    diagnostics: [],
  }
  return { manifest, analysis }
}

test('Planning V2 preserves required source anchors and rejects omissions or duplicate dispositions', () => {
  const { manifest, analysis } = planningV2Fixture()
  assert.deepEqual(parseRequirementAnalysis(JSON.stringify(analysis), manifest), analysis)
  const legacyGood = structuredClone(analysis)
  legacyGood.requirements[0].acceptanceCriteria[0].scenario = 'good'
  assert.deepEqual(parseRequirementAnalysis(JSON.stringify(legacyGood), manifest), analysis)
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

test('Requirement Analysis normalizes only the exact full-digest spelling of a frozen source anchor', () => {
  const { manifest, analysis } = planningV2Fixture()
  const fullDigestRef = (anchorId) => {
    const anchor = manifest.anchors.find((candidate) => candidate.id === anchorId)
    return `${anchor.id.slice(0, anchor.id.lastIndexOf(':') + 1)}${anchor.textDigest}`
  }
  const generated = structuredClone(analysis)
  generated.requirements[0].sourceRefs = generated.requirements[0].sourceRefs.map(fullDigestRef)
  generated.requirements[0].acceptanceCriteria[0].sourceRefs = generated.requirements[0].acceptanceCriteria[0].sourceRefs.map(fullDigestRef)
  generated.decisions[0].sourceRefs = generated.decisions[0].sourceRefs.map(fullDigestRef)
  generated.decisions[0].options[0] = {
    ...generated.decisions[0].options[0],
    affectedDimensions: ['requirement'], affectedObjectKeys: ['REQ-001'], derivation: 'explicit',
    evidenceAnchorIds: [fullDigestRef(analysis.decisions[0].sourceRefs[0])], potentiallyChangesDelivery: true,
  }
  const normalized = parseRequirementAnalysis(JSON.stringify(generated), manifest)
  assert.deepEqual(normalized.requirements[0].sourceRefs, analysis.requirements[0].sourceRefs)
  assert.deepEqual(normalized.requirements[0].acceptanceCriteria[0].sourceRefs, analysis.requirements[0].acceptanceCriteria[0].sourceRefs)
  assert.deepEqual(normalized.decisions[0].sourceRefs, analysis.decisions[0].sourceRefs)
  assert.deepEqual(normalized.decisions[0].options[0].evidenceAnchorIds, analysis.decisions[0].sourceRefs)

  const forged = structuredClone(generated)
  forged.requirements[0].sourceRefs = [`${manifest.anchors[0].id.slice(0, manifest.anchors[0].id.lastIndexOf(':') + 1)}${'f'.repeat(64)}`]
  assert.throws(() => parseRequirementAnalysis(JSON.stringify(forged), manifest), (error) => error.code === 'requirement-source-invalid')
})

test('Planning V3 source manifest dispositions every normative block instead of keyword-prefiltering requirements', () => {
  const manifest = buildRequirementSourceManifest({
    prd: '# 保存功能\n保存必须校验当前用户权限。\n\n## 失败处理\n依赖超时不得返回成功。\n\n## 验收标准\n1. 保存后可以重新查询。',
    technicalDesign: '# 迁移\n旧数据需要可回滚迁移。',
  }, { requireAllBlocks: true })
  const normative = manifest.anchors.filter((anchor) => anchor.contentClassification === 'normative')
  assert.equal(normative.length, 4)
  assert.equal(normative.every((anchor) => anchor.requiredDisposition), true)
  assert.equal(normative.every((anchor) => anchor.text && anchor.documentKind && anchor.classificationReason), true)
  assert.ok(normative.find((anchor) => anchor.text.includes('权限')).normativeHints.includes('permission'))
  assert.ok(normative.find((anchor) => anchor.text.includes('超时')).normativeHints.includes('failure'))
  assert.ok(normative.find((anchor) => anchor.text.includes('回滚')).normativeHints.includes('migration'))

  const legacy = buildRequirementSourceManifest({ prd: '# 保存功能\n保存必须校验当前用户权限。\n\n## 验收标准\n1. 保存后可以重新查询。' })
  assert.deepEqual(legacy.anchors.filter((anchor) => anchor.requiredDisposition).map((anchor) => anchor.kind), ['acceptance_item'])
})

test('requirement source manifest bounds section paths while preserving full heading evidence and stable identity', () => {
  const exact = 'a'.repeat(500)
  const oversized = 'b'.repeat(501)
  const literalEscapes = `literal${String.raw`\n## requirement`.repeat(40)}`
  const manifest = buildRequirementSourceManifest({ prd: `# ${exact}\n## ${oversized}\n### ${literalEscapes}` })
  const headings = manifest.anchors.filter((anchor) => anchor.kind === 'heading')

  assert.equal(headings[0].sectionPath[0], exact)
  assert.equal(headings[1].sectionPath[1].length, 500)
  assert.match(headings[1].sectionPath[1], /\.\.\.#[a-f0-9]{12}$/)
  assert.equal(headings[1].text, oversized)
  assert.equal(headings[2].sectionPath[2].length, 500)
  assert.equal(headings[2].text, literalEscapes)
  assert.notEqual(headings[1].id, buildRequirementSourceManifest({ prd: `# ${oversized}x` }).anchors[0].id)
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
  const analysis = { status: 'ready', summary: 'lscity-nuxt dispositions.', requirements: acceptance.map((anchor, index) => ({ key: `REQ-${String(index + 1).padStart(3, '0')}`, kind: 'fact', scope: 'in_scope', statement: `Requirement ${index + 1}`, sourceRefs: [anchor.id], acceptanceCriteria: [{ key: `AC-${String(index + 1).padStart(3, '0')}`, statement: `Acceptance ${index + 1}`, required: true, scenario: 'happy_path', sourceRefs: [anchor.id] }] })), decisions: questions.map((anchor, index) => ({ key: `DEC-${String(index + 1).padStart(3, '0')}`, question: `Question ${index + 1}`, options: [{ id: 'resolve', label: 'Resolve now' }, { id: 'defer', label: 'Defer with reason' }], impact: 'low', affectedRequirementKeys: [`REQ-${String(Math.min(index + 1, 21)).padStart(3, '0')}`], sourceRefs: [anchor.id] })), diagnostics: [] }
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

function planningV3Fixture() {
  const manifest = {
    id: 'prompt-manifest', projectId: 'p1', operationId: 'op1', stageAttemptId: 'attempt1',
    references: [
      { ref: 'ref-evidence-owner', kind: 'evidence_claim', artifactId: 'claim-owner', artifactDigest: '1'.repeat(64) },
      { ref: 'ref-command-test', kind: 'verification_command', artifactId: 'cmd-test', artifactDigest: '2'.repeat(64) },
      { ref: 'ref-policy-must', kind: 'policy_constraint', artifactId: 'policy-must', artifactDigest: '3'.repeat(64) },
    ],
    allowedRefSetDigest: '4'.repeat(64), manifestDigest: '5'.repeat(64), createdAt: now,
  }
  const binding = {
    status: 'ready', diagnostics: [], bindings: [{
      key: 'BIND-API', requirementKey: 'REQ-001', changeIntent: 'modify',
      impactAssessments: ['domain_owner', 'write_path', 'read_path', 'data', 'state', 'api', 'permission', 'async', 'consumer', 'failure', 'test', 'migration', 'release', 'rollback'].map((dimension) => ({
        dimension,
        applicability: ['domain_owner', 'write_path', 'read_path', 'failure', 'test'].includes(dimension) ? 'required' : 'not_applicable',
        evidenceRefs: ['domain_owner', 'write_path', 'read_path', 'failure', 'test'].includes(dimension) ? ['ref-evidence-owner'] : [],
        reason: ['domain_owner', 'write_path', 'read_path', 'failure', 'test'].includes(dimension) ? 'Repository evidence proves this surface.' : 'This requirement does not affect the dimension.',
      })),
      evidenceRefs: ['ref-evidence-owner'], allowedPathScopes: ['src/service.ts'], excludedPathScopes: ['src/client.tsx'],
      ownerSymbols: ['OrchestratorService'], currentBehaviorClaims: ['Service owns the write and read path.'], eventFactChains: [],
    }],
  }
  const contextPack = (relationship) => ({
    objective: `${relationship} AC-001`, whyNow: 'Required delivery outcome', inScope: ['src/service.ts'], outOfScope: ['src/client.tsx'],
    requirementStatements: ['The service must preserve the requested behavior.'], currentBehaviorClaimRefs: ['ref-evidence-owner'],
    targetBehavior: 'The service implements and verifies the requirement.', startingPoints: [{ evidenceRef: 'ref-evidence-owner', reason: 'Current owner' }],
    expectedChangeSurfaces: ['src/service.ts'], forbiddenChangeSurfaces: ['src/client.tsx'], invariants: ['No silent fallback'],
    verificationSteps: [{ scenarioKey: 'SCN-001', action: 'Run focused tests', expectedObservable: 'Behavior is proven', commandEvidenceRef: 'ref-command-test' }],
    expectedArtifacts: ['source and test changes'], escalationConditions: ['Evidence contradicts the binding'], unknowns: [],
  })
  const task = (key, relationship, kind, dependencyKeys = []) => ({
    key, workPackageKey: 'WP-001', title: key, kind, relationship, description: `${relationship} task`,
    requirementKeys: ['REQ-001'], acceptanceKeys: ['AC-001'], scenarioKeys: ['SCN-001'], decisionKeys: [],
    policyConstraintRefs: ['ref-policy-must'], bindingKeys: ['BIND-API'], evidenceClaimRefs: ['ref-evidence-owner'],
    dependencyKeys, verificationCommandRefs: ['ref-command-test'], completionCriteria: ['Observable result is proven'], risk: 'medium',
    contextPack: contextPack(relationship), changeContract: { allowedPathScopes: ['src/service.ts'], excludedPathScopes: ['src/client.tsx'], conflictKeys: ['src/service.ts'], expectedArtifacts: ['source and test changes'], outOfScopePolicy: 'fail' },
  })
  const plan = {
    contractVersion: 3, summary: 'Grounded plan', status: 'ready', blockedReasons: [],
    workPackages: [{ key: 'WP-001', title: 'Deliver behavior', businessOutcome: 'Requirement is implemented and verified', requirementKeys: ['REQ-001'], acceptanceKeys: ['AC-001'], bindingKeys: ['BIND-API'] }],
    tasks: [task('TASK-IMPLEMENT', 'implementation', 'code'), task('TASK-VERIFY', 'verification', 'test', ['TASK-IMPLEMENT'])],
  }
  return { manifest, binding, plan }
}

test('V3 repository evidence reads legacy Git object digests but keeps non-repository evidence on SHA-256', () => {
  const legacyDigest = 'a'.repeat(40)
  const sha256 = 'b'.repeat(64)
  assert.doesNotThrow(() => RepositoryContextSnapshotV3RecordSchema.parse({
    id: 'repo-snapshot:legacy', projectId: 'p1', operationId: 'op1', canonicalRoot: '/tmp/project', headCommit: legacyDigest,
    trackedTreeDigest: sha256, dirtyDigest: sha256, repositoryDigest: sha256, files: [], workingFiles: [{ path: 'src/owner.ts', digest: legacyDigest }], dirtyFiles: [], verifiedCommands: ['pnpm test'], status: 'ready', diagnostics: [], createdAt: now,
  }))
  const manifest = { id: 'manifest-1', projectId: 'p1', operationId: 'op1', stageAttemptId: 'attempt-1', references: [{ ref: 'ref-repo-legacy', kind: 'repository_evidence', artifactId: 'src/owner.ts', artifactDigest: legacyDigest }], allowedRefSetDigest: sha256, manifestDigest: sha256, createdAt: now }
  assert.doesNotThrow(() => PlanningPromptReferenceManifestRecordSchema.parse(manifest))
  assert.throws(() => PlanningPromptReferenceManifestRecordSchema.parse({ ...manifest, references: [{ ...manifest.references[0], kind: 'evidence_claim' }] }), /legacy repository evidence/i)
})

test('V3 planner can only use frozen local keys and attempt-scoped opaque references', () => {
  const { manifest, binding, plan } = planningV3Fixture()
  assert.deepEqual(parseGeneratedBindingAnalysisV3(JSON.stringify(binding), { requirementKeys: ['REQ-001'], allowedEvidenceRefs: ['ref-evidence-owner'] }), binding)
  const missingImpact = structuredClone(binding)
  missingImpact.bindings[0].impactAssessments.pop()
  assert.throws(() => parseGeneratedBindingAnalysisV3(JSON.stringify(missingImpact), { requirementKeys: ['REQ-001'], allowedEvidenceRefs: ['ref-evidence-owner'] }), /14|dimension/i)
  const duplicateImpact = structuredClone(binding)
  duplicateImpact.bindings[0].impactAssessments[13] = structuredClone(duplicateImpact.bindings[0].impactAssessments[0])
  assert.throws(() => parseGeneratedBindingAnalysisV3(JSON.stringify(duplicateImpact), { requirementKeys: ['REQ-001'], allowedEvidenceRefs: ['ref-evidence-owner'] }), /dimension/i)
  const unknownImpact = structuredClone(binding)
  unknownImpact.bindings[0].impactAssessments[0].applicability = 'unknown'
  assert.throws(() => parseGeneratedBindingAnalysisV3(JSON.stringify(unknownImpact), { requirementKeys: ['REQ-001'], allowedEvidenceRefs: ['ref-evidence-owner'] }), /unknown impact/i)
  const unsupportedRequiredImpact = structuredClone(binding)
  unsupportedRequiredImpact.bindings[0].impactAssessments[0].evidenceRefs = []
  assert.throws(() => parseGeneratedBindingAnalysisV3(JSON.stringify(unsupportedRequiredImpact), { requirementKeys: ['REQ-001'], allowedEvidenceRefs: ['ref-evidence-owner'] }), /needs repository evidence/i)
  const forgedImpactEvidence = structuredClone(binding)
  forgedImpactEvidence.bindings[0].impactAssessments[0].evidenceRefs = ['ref-evidence-forged']
  assert.throws(() => parseGeneratedBindingAnalysisV3(JSON.stringify(forgedImpactEvidence), { requirementKeys: ['REQ-001'], allowedEvidenceRefs: ['ref-evidence-owner'] }), (error) => error.code === 'binding-evidence-invalid')
  const missingEventChain = structuredClone(binding)
  const eventInput = {
    requirementKeys: ['REQ-001'],
    allowedEvidenceRefs: ['ref-evidence-owner'],
    eventScenarios: [{
      key: 'SCN-001',
      requirementKey: 'REQ-001',
      eventObservables: [
        { key: 'EVT-SCN-001-DISPATCH-ABSENT', expectation: 'absent' },
        { key: 'EVT-SCN-001-TASK-RUN-ABSENT', expectation: 'absent' },
      ],
    }],
  }
  assert.throws(() => parseGeneratedBindingAnalysisV3(JSON.stringify(missingEventChain), eventInput), (error) => error.code === 'binding-event-observable-chain-missing')
  const eventBound = structuredClone(binding)
  for (const assessment of eventBound.bindings[0].impactAssessments) {
    if (!['write_path', 'read_path', 'data'].includes(assessment.dimension)) continue
    assessment.applicability = 'required'
    assessment.evidenceRefs = ['ref-evidence-owner']
    assessment.reason = 'The repository evidence identifies this required event fact surface.'
  }
  eventBound.bindings[0].eventFactChains = [{ factKey: 'EVENT-FACT-DISPATCH', eventObservableKey: 'EVT-SCN-001-DISPATCH-ABSENT', scenarioKeys: ['SCN-001'], eventTypes: ['execution_dispatch'], recordOwnerSymbols: ['OrchestratorService'], persistedCollectionOwnerSymbols: ['OrchestratorService'], readSurfaceOwnerSymbols: ['OrchestratorService'], producerOwnerSymbols: ['OrchestratorService'], fixtureEvidenceRefs: ['ref-evidence-owner'], assertionEvidenceRefs: ['ref-evidence-owner'], correlation: 'The project and operation identifiers match before and after the query.', assertsAbsence: true }]
  assert.throws(() => parseGeneratedBindingAnalysisV3(JSON.stringify(eventBound), eventInput), (error) => error.code === 'binding-event-observable-chain-missing' && /EVT-SCN-001-TASK-RUN-ABSENT/u.test(error.message))
  eventBound.bindings[0].eventFactChains.push({ factKey: 'EVENT-FACT-TASK-RUN', eventObservableKey: 'EVT-SCN-001-TASK-RUN-ABSENT', scenarioKeys: ['SCN-001'], eventTypes: ['task_run'], recordOwnerSymbols: ['OrchestratorService'], persistedCollectionOwnerSymbols: ['OrchestratorService'], readSurfaceOwnerSymbols: ['OrchestratorService'], producerOwnerSymbols: ['OrchestratorService'], fixtureEvidenceRefs: ['ref-evidence-owner'], assertionEvidenceRefs: ['ref-evidence-owner'], correlation: 'The project and operation identifiers match before and after the query.', assertsAbsence: true })
  assert.deepEqual(parseGeneratedBindingAnalysisV3(JSON.stringify(eventBound), eventInput), eventBound)
  const forgedEventOwner = structuredClone(eventBound)
  forgedEventOwner.bindings[0].eventFactChains[0].producerOwnerSymbols = ['ForgedProducer']
  assert.throws(() => parseGeneratedBindingAnalysisV3(JSON.stringify(forgedEventOwner), eventInput), (error) => error.code === 'binding-event-owner-invalid')
  const forgedEventEvidence = structuredClone(eventBound)
  forgedEventEvidence.bindings[0].eventFactChains[0].assertionEvidenceRefs = ['ref-evidence-forged']
  assert.throws(() => parseGeneratedBindingAnalysisV3(JSON.stringify(forgedEventEvidence), eventInput), (error) => error.code === 'binding-event-evidence-invalid')
  const unownedEventEvidence = structuredClone(eventBound)
  unownedEventEvidence.bindings[0].eventFactChains[0].assertionEvidenceRefs = ['ref-evidence-other']
  assert.throws(() => parseGeneratedBindingAnalysisV3(JSON.stringify(unownedEventEvidence), { ...eventInput, allowedEvidenceRefs: ['ref-evidence-owner', 'ref-evidence-other'] }), (error) => error.code === 'binding-event-evidence-unowned')
  const incompleteEventImpact = structuredClone(eventBound)
  incompleteEventImpact.bindings[0].impactAssessments.find((assessment) => assessment.dimension === 'data').applicability = 'not_applicable'
  incompleteEventImpact.bindings[0].impactAssessments.find((assessment) => assessment.dimension === 'data').evidenceRefs = []
  assert.throws(() => parseGeneratedBindingAnalysisV3(JSON.stringify(incompleteEventImpact), eventInput), (error) => error.code === 'binding-event-impact-incomplete')
  const invertedEventExpectation = structuredClone(eventBound)
  invertedEventExpectation.bindings[0].eventFactChains[0].assertsAbsence = false
  assert.throws(() => parseGeneratedBindingAnalysisV3(JSON.stringify(invertedEventExpectation), eventInput), (error) => error.code === 'binding-event-observable-expectation-mismatch')
  const duplicateEventMapping = structuredClone(eventBound)
  duplicateEventMapping.bindings[0].eventFactChains[1].eventObservableKey = 'EVT-SCN-001-DISPATCH-ABSENT'
  assert.throws(() => parseGeneratedBindingAnalysisV3(JSON.stringify(duplicateEventMapping), eventInput), (error) => error.code === 'duplicate-binding-event-observable-key')
  const blockedWithFrozenDiagnosticSubjects = { status: 'blocked', diagnostics: [{ code: 'binding-evidence-insufficient', severity: 'blocking', message: 'The frozen evidence is incomplete.', subjectIds: ['REQ-001', 'ref-evidence-owner'] }], bindings: [] }
  assert.deepEqual(parseGeneratedBindingAnalysisV3(JSON.stringify(blockedWithFrozenDiagnosticSubjects), { requirementKeys: ['REQ-001'], allowedEvidenceRefs: ['ref-evidence-owner'] }), blockedWithFrozenDiagnosticSubjects)
  const blockedWithForgedDiagnosticSubject = structuredClone(blockedWithFrozenDiagnosticSubjects)
  blockedWithForgedDiagnosticSubject.diagnostics[0].subjectIds = ['src/forged-path.ts']
  assert.throws(() => parseGeneratedBindingAnalysisV3(JSON.stringify(blockedWithForgedDiagnosticSubject), { requirementKeys: ['REQ-001'], allowedEvidenceRefs: ['ref-evidence-owner'] }), (error) => error.code === 'binding-diagnostic-subject-invalid')
  const parsed = parseGeneratedPlanV3(JSON.stringify(plan), {
    requirementKeys: ['REQ-001'], acceptanceKeys: ['AC-001'], requiredAcceptanceKeys: ['AC-001'], scenarioKeys: ['SCN-001'], requiredScenarioKeys: ['SCN-001'], decisionKeys: [], resolvedDecisionKeys: [], bindingKeys: ['BIND-API'], requiredPolicyRefs: ['ref-policy-must'], promptReferenceManifest: manifest,
  })
  assert.deepEqual(parsed, plan)
  const forged = structuredClone(plan)
  forged.tasks[0].evidenceClaimRefs = ['ref-evidence-forged']
  assert.throws(() => parseGeneratedPlanV3(JSON.stringify(forged), { requirementKeys: ['REQ-001'], acceptanceKeys: ['AC-001'], requiredAcceptanceKeys: ['AC-001'], scenarioKeys: ['SCN-001'], requiredScenarioKeys: ['SCN-001'], decisionKeys: [], resolvedDecisionKeys: [], bindingKeys: ['BIND-API'], requiredPolicyRefs: ['ref-policy-must'], promptReferenceManifest: manifest }), (error) => error.code === 'plan-reference-invalid')

  const missingPolicy = structuredClone(plan)
  for (const task of missingPolicy.tasks) task.policyConstraintRefs = []
  assert.throws(() => parseGeneratedPlanV3(JSON.stringify(missingPolicy), { requirementKeys: ['REQ-001'], acceptanceKeys: ['AC-001'], requiredAcceptanceKeys: ['AC-001'], scenarioKeys: ['SCN-001'], requiredScenarioKeys: ['SCN-001'], decisionKeys: [], resolvedDecisionKeys: [], bindingKeys: ['BIND-API'], requiredPolicyRefs: ['ref-policy-must'], promptReferenceManifest: manifest }), (error) => error.code === 'policy-fulfillment-missing')

  assert.throws(() => parseGeneratedPlanV3(JSON.stringify(plan), {
    requirementKeys: ['REQ-001', 'REQ-UNMAPPED'], acceptanceKeys: ['AC-001'], requiredAcceptanceKeys: ['AC-001'], scenarioKeys: ['SCN-001'], requiredScenarioKeys: ['SCN-001'], decisionKeys: [], resolvedDecisionKeys: [], bindingKeys: ['BIND-API'], requiredPolicyRefs: ['ref-policy-must'], promptReferenceManifest: manifest,
    requiredPolicySubjectsByRef: { 'ref-policy-must': { requirementKeys: ['REQ-001', 'REQ-UNMAPPED'], scenarioKeys: ['SCN-001'] } },
  }), (error) => error.code === 'policy-subject-fulfillment-missing' && /REQ-UNMAPPED/u.test(error.message))

  const mutationPolicyInput = {
    requirementKeys: ['REQ-001'], acceptanceKeys: ['AC-001'], requiredAcceptanceKeys: ['AC-001'], scenarioKeys: ['SCN-001'], requiredScenarioKeys: ['SCN-001'], decisionKeys: [], resolvedDecisionKeys: [], bindingKeys: ['BIND-API'], requiredPolicyRefs: ['ref-policy-must'], promptReferenceManifest: manifest,
    requiredPolicyStatementsByRef: { 'ref-policy-must': 'Mutation requests must come from a loopback Peer and loopback Host with a matching Origin and same-origin Fetch Metadata.' },
  }
  assert.throws(() => parseGeneratedPlanV3(JSON.stringify(plan), mutationPolicyInput), (error) => error.code === 'mutation-source-policy-coverage-incomplete')
  const completeMutationCoverage = structuredClone(plan)
  completeMutationCoverage.tasks[1].completionCriteria = [
    'Execute an allowed mutation through the production HTTP boundary with an allowed loopback Peer, allowed loopback Host, matching Origin, and same-origin Fetch Metadata.',
    'Reject a mutation from a non-loopback Peer; compare business facts before and after the request and assert zero business writes.',
    'Reject a mutation using a non-loopback Host; compare business facts before and after the request and assert zero business writes.',
    'Reject mutations with a missing Origin and a cross-origin Origin; compare business facts before and after each request and assert zero business writes.',
    'Reject mutations with cross-site Fetch Metadata and invalid Fetch Metadata; compare business facts before and after each request and assert zero business writes.',
  ]
  assert.deepEqual(parseGeneratedPlanV3(JSON.stringify(completeMutationCoverage), mutationPolicyInput), completeMutationCoverage)
  const splitMutationCoverage = structuredClone(completeMutationCoverage)
  splitMutationCoverage.tasks[1].completionCriteria = [
    ...completeMutationCoverage.tasks[1].completionCriteria.slice(0, 3),
    'Reject a mutation with a missing Origin; compare business facts before and after the request and assert zero business writes.',
    'Reject a mutation with a cross-origin Origin; compare business facts before and after the request and assert zero business writes.',
    'Reject a mutation with cross-site Fetch Metadata; compare business facts before and after the request and assert zero business writes.',
    'Reject a mutation with invalid Fetch Metadata; compare business facts before and after the request and assert zero business writes.',
  ]
  assert.deepEqual(parseGeneratedPlanV3(JSON.stringify(splitMutationCoverage), mutationPolicyInput), splitMutationCoverage)
  const splitMutationCoverageWithoutInvalidProof = structuredClone(splitMutationCoverage)
  splitMutationCoverageWithoutInvalidProof.tasks[1].completionCriteria[6] = 'Reject a mutation with invalid Fetch Metadata and assert that the handler returns an error.'
  assert.throws(() => parseGeneratedPlanV3(JSON.stringify(splitMutationCoverageWithoutInvalidProof), mutationPolicyInput), (error) => error.code === 'mutation-source-policy-coverage-incomplete' && /rejected-invalid-fetch-metadata-with-zero-writes/u.test(error.message))
  for (let criterionIndex = 0; criterionIndex < completeMutationCoverage.tasks[1].completionCriteria.length; criterionIndex += 1) {
    const missingMatrixCase = structuredClone(completeMutationCoverage)
    missingMatrixCase.tasks[1].completionCriteria.splice(criterionIndex, 1)
    assert.throws(() => parseGeneratedPlanV3(JSON.stringify(missingMatrixCase), mutationPolicyInput), (error) => error.code === 'mutation-source-policy-coverage-incomplete')
  }
  const rejectionWithoutBeforeAfterProof = structuredClone(completeMutationCoverage)
  rejectionWithoutBeforeAfterProof.tasks[1].completionCriteria[4] = 'Reject mutations with cross-site Fetch Metadata and invalid Fetch Metadata and assert that the handler returns an error.'
  assert.throws(() => parseGeneratedPlanV3(JSON.stringify(rejectionWithoutBeforeAfterProof), mutationPolicyInput), (error) => error.code === 'mutation-source-policy-coverage-incomplete')

  const chineseMutationCoverage = structuredClone(plan)
  chineseMutationCoverage.tasks[1].completionCriteria = [
    '允许使用回环 Peer、回环 Host、匹配 Origin 和 same-origin Fetch Metadata 的生产 HTTP 修改请求。',
    '非回环 Peer 请求被拒绝；请求紧邻前后比较业务事实并断言零业务写入。',
    '非回环 Host 请求被拒绝；请求紧邻前后比较业务事实并断言业务写入数为零。',
    '缺失 Origin 与跨源 Origin 请求均被拒绝；每个请求紧邻前后比较业务事实并断言零业务写入。',
    'cross-site Fetch Metadata 与非法 Fetch Metadata 请求均被拒绝；每个请求紧邻前后比较业务事实并断言业务写入数量为零。',
  ]
  assert.deepEqual(parseGeneratedPlanV3(JSON.stringify(chineseMutationCoverage), mutationPolicyInput), chineseMutationCoverage)
  const splitChineseMutationCoverage = structuredClone(chineseMutationCoverage)
  splitChineseMutationCoverage.tasks[1].completionCriteria = [
    ...chineseMutationCoverage.tasks[1].completionCriteria.slice(0, 3),
    '缺失 Origin 请求被拒绝；请求紧邻前后比较业务事实并断言零业务写入。',
    '跨源 Origin 请求被拒绝；请求紧邻前后比较业务事实并断言零业务写入。',
    'cross-site Fetch Metadata 请求被拒绝；请求紧邻前后比较业务事实并断言零业务写入。',
    '非法 Fetch Metadata 请求被拒绝；请求紧邻前后比较业务事实并断言零业务写入。',
  ]
  assert.deepEqual(parseGeneratedPlanV3(JSON.stringify(splitChineseMutationCoverage), mutationPolicyInput), splitChineseMutationCoverage)
  for (let criterionIndex = 0; criterionIndex < chineseMutationCoverage.tasks[1].completionCriteria.length; criterionIndex += 1) {
    const missingChineseMatrixCase = structuredClone(chineseMutationCoverage)
    missingChineseMatrixCase.tasks[1].completionCriteria.splice(criterionIndex, 1)
    assert.throws(() => parseGeneratedPlanV3(JSON.stringify(missingChineseMatrixCase), mutationPolicyInput), (error) => error.code === 'mutation-source-policy-coverage-incomplete')
  }
  const chineseRejectionWithoutZeroWrites = structuredClone(chineseMutationCoverage)
  chineseRejectionWithoutZeroWrites.tasks[1].completionCriteria[1] = '非回环 Peer 请求被拒绝；请求紧邻前后比较响应状态。'
  assert.throws(() => parseGeneratedPlanV3(JSON.stringify(chineseRejectionWithoutZeroWrites), mutationPolicyInput), (error) => error.code === 'mutation-source-policy-coverage-incomplete')
})

test('V3 scenario completion requires executable happy-path and risk-category coverage per Acceptance', () => {
  const completion = {
    status: 'ready', diagnostics: [], scenarios: [
      { requirementKey: 'REQ-001', acceptanceKey: 'AC-001', key: 'SCN-001-HAPPY', category: 'happy_path', preconditions: ['Project exists'], trigger: 'Submit the update', expectedOutcomes: ['The saved value is returned'], observableAt: [{ kind: 'api', description: 'The response contains the saved value' }], eventObservables: [], derivation: 'explicit', assumptions: [], required: true, sourceAnchorIds: ['src:acceptance', 'src:policy'] },
      { requirementKey: 'REQ-001', acceptanceKey: 'AC-001', key: 'SCN-001-FAIL', category: 'dependency_failure', preconditions: ['Dependency is unavailable'], trigger: 'Submit the update', expectedOutcomes: ['A dependency failure is returned', 'No state is committed'], observableAt: [{ kind: 'api', description: 'The API returns a dependency failure' }, { kind: 'database', description: 'No state change is committed' }], eventObservables: [], derivation: 'inferred', assumptions: ['The dependency can be isolated in the test environment'], required: true, sourceAnchorIds: ['src:acceptance'] },
    ],
  }
  const input = { requirements: [{ key: 'REQ-001', acceptanceKeys: ['AC-001'] }], requiredCategoriesByAcceptance: { 'AC-001': ['happy_path', 'dependency_failure'] }, requiredSourceRefsByAcceptanceCategory: { 'AC-001': { happy_path: ['src:acceptance', 'src:policy'], dependency_failure: ['src:acceptance'] } }, allowedSourceRefs: ['src:acceptance', 'src:policy'] }
  assert.deepEqual(parseGeneratedScenarioCompletionV3(JSON.stringify(completion), input), completion)
  assert.throws(() => parseGeneratedScenarioCompletionV3(JSON.stringify({ ...completion, scenarios: completion.scenarios.slice(1) }), input), (error) => error.code === 'acceptance-scenario-category-missing')
  assert.throws(() => parseGeneratedScenarioCompletionV3(JSON.stringify({ ...completion, scenarios: [{ ...completion.scenarios[0], sourceAnchorIds: ['forged'] }, completion.scenarios[1]] }), input), (error) => error.code === 'scenario-source-invalid')
  assert.throws(() => parseGeneratedScenarioCompletionV3(JSON.stringify({ ...completion, scenarios: [{ ...completion.scenarios[0], sourceAnchorIds: ['src:acceptance'] }, completion.scenarios[1]] }), input), (error) => error.code === 'scenario-source-policy-mismatch')
  assert.throws(() => parseGeneratedScenarioCompletionV3(JSON.stringify({ ...completion, scenarios: [{ ...completion.scenarios[0], preconditions: [] }, completion.scenarios[1]] }), input), /Too small/)
  const bundleTriggeredUi = structuredClone(completion)
  bundleTriggeredUi.scenarios[0].trigger = '客户端 bundle 自动化测试呈现项目详情'
  bundleTriggeredUi.scenarios[0].observableAt = [{ kind: 'ui', description: '项目详情渲染阶段列表' }]
  assert.throws(() => parseGeneratedScenarioCompletionV3(JSON.stringify(bundleTriggeredUi), input), (error) => error.code === 'scenario-ui-trigger-nonbrowser')
  const bundleThenBrowserUi = structuredClone(bundleTriggeredUi)
  bundleThenBrowserUi.scenarios[0].trigger = '先执行客户端 bundle 合同测试，再由用户使用真实浏览器打开项目详情路由。'
  assert.doesNotThrow(() => parseGeneratedScenarioCompletionV3(JSON.stringify(bundleThenBrowserUi), input))
  const vagueUi = structuredClone(bundleTriggeredUi)
  vagueUi.scenarios[0].trigger = 'Inspect the project detail output.'
  assert.throws(() => parseGeneratedScenarioCompletionV3(JSON.stringify(vagueUi), input), (error) => error.code === 'scenario-ui-trigger-nonbrowser')
  const eventWithoutFacts = structuredClone(completion)
  eventWithoutFacts.scenarios[0].observableAt = [{ kind: 'event', description: 'No Dispatch or TaskRun is created.' }]
  assert.throws(() => parseGeneratedScenarioCompletionV3(JSON.stringify(eventWithoutFacts), input), /must declare every independent event fact/i)
  eventWithoutFacts.scenarios[0].eventObservables = [
    { key: 'EVT-SCN-001-DISPATCH-ABSENT', description: 'No Dispatch is created.', expectation: 'absent' },
    { key: 'EVT-SCN-001-TASK-RUN-ABSENT', description: 'No TaskRun is created.', expectation: 'absent' },
  ]
  assert.doesNotThrow(() => parseGeneratedScenarioCompletionV3(JSON.stringify(eventWithoutFacts), input))

  const blocked = parseGeneratedScenarioCompletionV3(JSON.stringify({
    status: 'blocked',
    diagnostics: [{
      code: 'scenario-policy-insufficient', severity: 'blocked', message: 'The frozen source cannot support this category.',
      requirementKey: 'REQ-001', acceptanceKey: 'AC-001', categories: ['dependency_failure'], sourceAnchorIds: ['src:acceptance'],
    }],
    scenarios: [],
  }), input)
  assert.deepEqual(blocked, {
    status: 'blocked',
    diagnostics: [{ code: 'scenario-policy-insufficient', severity: 'blocking', message: 'The frozen source cannot support this category.', subjectIds: ['REQ-001', 'AC-001', 'src:acceptance'] }],
    scenarios: [],
  })

  const readyWithAliasedDiagnostic = { ...completion, diagnostics: [{ severity: 'warn', message: 'Non-blocking note.', acceptanceKey: 'AC-001' }] }
  assert.deepEqual(parseGeneratedScenarioCompletionV3(JSON.stringify(readyWithAliasedDiagnostic), input).diagnostics, [{ code: 'model-diagnostic-1', severity: 'warning', message: 'Non-blocking note.', subjectIds: ['AC-001'] }])
  assert.throws(() => parseGeneratedScenarioCompletionV3(JSON.stringify({ ...readyWithAliasedDiagnostic, scenarios: completion.scenarios.slice(1) }), input), (error) => error.code === 'acceptance-scenario-category-missing')
})

test('V3 Scenario coverage review binds the exact immutable input digest', () => {
  const reviewedInputDigest = 'a'.repeat(64)
  const approved = { status: 'approved', reviewedInputDigest, findings: [] }
  assert.deepEqual(parseGeneratedScenarioCoverageReviewV3(JSON.stringify(approved), reviewedInputDigest), approved)
  assert.throws(() => parseGeneratedScenarioCoverageReviewV3(JSON.stringify(approved), 'b'.repeat(64)), (error) => error.code === 'scenario-coverage-review-stale')
  assert.throws(() => parseGeneratedScenarioCoverageReviewV3(JSON.stringify({ ...approved, findings: [{ code: 'missing', severity: 'blocking', subjectType: 'scenario', subjectId: 'SCN-1', evidenceIds: [], message: 'Missing.', repairOwner: 'scenario', restartStage: 'scenario_completion' }] }), reviewedInputDigest), /approved Scenario coverage review/i)
})

test('V3 plan fails closed for uncovered acceptance, missing scenario verification, invalid scope, and DAG cycles', () => {
  const { manifest, plan } = planningV3Fixture()
  const input = { requirementKeys: ['REQ-001'], acceptanceKeys: ['AC-001'], requiredAcceptanceKeys: ['AC-001'], scenarioKeys: ['SCN-001'], requiredScenarioKeys: ['SCN-001'], decisionKeys: [], resolvedDecisionKeys: [], bindingKeys: ['BIND-API'], requiredPolicyRefs: ['ref-policy-must'], promptReferenceManifest: manifest }
  assert.throws(() => parseGeneratedPlanV3(JSON.stringify({ ...plan, tasks: [plan.tasks[0]] }), input), (error) => error.code === 'acceptance-verification-missing')
  const expandedScope = structuredClone(plan); expandedScope.tasks[0].changeContract.allowedPathScopes = ['src']
  assert.throws(() => parseGeneratedPlanV3(JSON.stringify(expandedScope), { ...input, bindingScopes: { 'BIND-API': ['src/service.ts'] } }), (error) => error.code === 'task-scope-expanded')
  const expectedOutsideWriteScope = structuredClone(plan)
  expectedOutsideWriteScope.tasks[0].contextPack.expectedChangeSurfaces = ['src/client-types.ts']
  assert.throws(() => parseGeneratedPlanV3(JSON.stringify(expectedOutsideWriteScope), input), (error) => error.code === 'task-context-surface-outside-write-scope')
  const expectedExcluded = structuredClone(plan)
  expectedExcluded.tasks[0].contextPack.expectedChangeSurfaces = ['src/service.ts']
  expectedExcluded.tasks[0].changeContract.excludedPathScopes = ['src/service.ts']
  assert.throws(() => parseGeneratedPlanV3(JSON.stringify(expectedExcluded), input), (error) => error.code === 'task-context-surface-excluded')
  const namedOwnerOutsideWriteScope = structuredClone(plan)
  namedOwnerOutsideWriteScope.tasks[0].completionCriteria = ['Extend ProjectPlanningV3View so it exposes the new projection.']
  assert.throws(() => parseGeneratedPlanV3(JSON.stringify(namedOwnerOutsideWriteScope), { ...input, bindingOwnerPathsBySymbol: { 'BIND-API': { ProjectPlanningV3View: ['src/client-types.ts'] } } }), (error) => error.code === 'task-contract-owner-outside-write-scope')
  const readOnlyOwnerReference = structuredClone(plan)
  readOnlyOwnerReference.tasks[0].completionCriteria = ['The browser harness invokes the production createHttpHandler as a read-only dependency and verifies its response.']
  assert.doesNotThrow(() => parseGeneratedPlanV3(JSON.stringify(readOnlyOwnerReference), { ...input, bindingOwnerPathsBySymbol: { 'BIND-API': { createHttpHandler: ['src/http.ts'] } } }))
  const fixtureWriterUsesOwners = structuredClone(plan)
  fixtureWriterUsesOwners.tasks[0].completionCriteria = ['tests/browser/support/fixture.mjs 通过 orchestratorDomain 和 apply 在共享临时目录写入夹具。']
  assert.doesNotThrow(() => parseGeneratedPlanV3(JSON.stringify(fixtureWriterUsesOwners), { ...input, bindingOwnerPathsBySymbol: { 'BIND-API': { orchestratorDomain: ['src/storage.ts'], apply: ['src/index.ts'] } } }))
  const directOwnerMutation = structuredClone(plan)
  directOwnerMutation.tasks[0].completionCriteria = ['修改 apply 以支持新的持久化夹具协议。']
  assert.throws(() => parseGeneratedPlanV3(JSON.stringify(directOwnerMutation), { ...input, bindingOwnerPathsBySymbol: { 'BIND-API': { apply: ['src/index.ts'] } } }), (error) => error.code === 'task-contract-owner-outside-write-scope')
  const filenameIsNotOwnerMutation = structuredClone(plan)
  filenameIsNotOwnerMutation.tasks[0].completionCriteria = [
    '夹具完成后原子写入 fixture-ready.json。',
    '测试仅观察既有 json 序列化，不修改、不扩展也不拥有 json 或其声明文件。',
  ]
  assert.doesNotThrow(() => parseGeneratedPlanV3(JSON.stringify(filenameIsNotOwnerMutation), { ...input, bindingOwnerPathsBySymbol: { 'BIND-API': { json: ['src/http.ts'] } } }))
  const directJsonOwnerMutation = structuredClone(plan)
  directJsonOwnerMutation.tasks[0].completionCriteria = ['修改 json 以支持新的响应协议。']
  assert.throws(() => parseGeneratedPlanV3(JSON.stringify(directJsonOwnerMutation), { ...input, bindingOwnerPathsBySymbol: { 'BIND-API': { json: ['src/http.ts'] } } }), (error) => error.code === 'task-contract-owner-outside-write-scope')
  const negatedOwnerMutation = structuredClone(plan)
  negatedOwnerMutation.tasks[0].completionCriteria = [
    '只读调用现有 PLANNING_STAGE_ORDER，不修改 PLANNING_STAGE_ORDER。',
    '不得扩展 PLANNING_STAGE_ORDER，也无需拥有 PLANNING_STAGE_ORDER。',
    'The task does not modify PLANNING_STAGE_ORDER, must not extend PLANNING_STAGE_ORDER, and will not own PLANNING_STAGE_ORDER.',
  ]
  assert.doesNotThrow(() => parseGeneratedPlanV3(JSON.stringify(negatedOwnerMutation), { ...input, bindingOwnerPathsBySymbol: { 'BIND-API': { PLANNING_STAGE_ORDER: ['src/planning/repair-lineage.ts'] } } }))
  const directStageOrderMutation = structuredClone(plan)
  directStageOrderMutation.tasks[0].completionCriteria = ['修改 PLANNING_STAGE_ORDER 以加入新的规划阶段。']
  assert.throws(() => parseGeneratedPlanV3(JSON.stringify(directStageOrderMutation), { ...input, bindingOwnerPathsBySymbol: { 'BIND-API': { PLANNING_STAGE_ORDER: ['src/planning/repair-lineage.ts'] } } }), (error) => error.code === 'task-contract-owner-outside-write-scope')
  const contradictoryStageOrderMutation = structuredClone(plan)
  contradictoryStageOrderMutation.tasks[0].completionCriteria = ['Do not modify PLANNING_STAGE_ORDER but extend PLANNING_STAGE_ORDER with a new planning stage.']
  assert.throws(() => parseGeneratedPlanV3(JSON.stringify(contradictoryStageOrderMutation), { ...input, bindingOwnerPathsBySymbol: { 'BIND-API': { PLANNING_STAGE_ORDER: ['src/planning/repair-lineage.ts'] } } }), (error) => error.code === 'task-contract-owner-outside-write-scope')
  const unsupportedStageCompatibility = structuredClone(plan)
  unsupportedStageCompatibility.tasks[0].completionCriteria = ['Unknown stage identifiers remain readable and sort after known stages.']
  assert.throws(() => parseGeneratedPlanV3(JSON.stringify(unsupportedStageCompatibility), { ...input, stageIdentifierCompatibilityRequired: false }), (error) => error.code === 'task-stage-compatibility-unrequired')
  assert.doesNotThrow(() => parseGeneratedPlanV3(JSON.stringify(unsupportedStageCompatibility), { ...input, stageIdentifierCompatibilityRequired: true }))
  const excludedStageCompatibility = structuredClone(plan)
  excludedStageCompatibility.tasks[0].completionCriteria = [
    '不处理未知或未来阶段，也不支持未知阶段标识。',
    '不实现未知阶段兼容，不得扩展未来阶段排序。',
    '不增加未知阶段分支、未知阶段排序、兼容回退或未来阶段目录处理。',
    '检查成功，未声明第二个阶段尝试持久化模型或未知阶段兼容分支。',
    '排序比较器不承担未知阶段兼容，也不涉及未来阶段 schema。',
    '存储测试不包含未知阶段夹具，也不验证未来阶段行为。',
    'This task does not support unknown stages and will not implement future stage compatibility.',
    'The regression does not include an unknown stage fixture and will not test future stages.',
    'The task must not extend unknown stage handling; unrecognized stage values are not supported.',
  ]
  assert.doesNotThrow(() => parseGeneratedPlanV3(JSON.stringify(excludedStageCompatibility), { ...input, stageIdentifierCompatibilityRequired: false }))
  const contradictoryStageCompatibility = structuredClone(plan)
  contradictoryStageCompatibility.tasks[0].completionCriteria = ['Do not support unknown stages, but preserve future stage identifiers in API responses.']
  assert.throws(() => parseGeneratedPlanV3(JSON.stringify(contradictoryStageCompatibility), { ...input, stageIdentifierCompatibilityRequired: false }), (error) => error.code === 'task-stage-compatibility-unrequired')
  const contradictoryCoordinatedStageCompatibility = structuredClone(plan)
  contradictoryCoordinatedStageCompatibility.tasks[0].completionCriteria = ['不增加未知阶段分支、未来阶段标识仍需要保持可读。']
  assert.throws(() => parseGeneratedPlanV3(JSON.stringify(contradictoryCoordinatedStageCompatibility), { ...input, stageIdentifierCompatibilityRequired: false }), (error) => error.code === 'task-stage-compatibility-unrequired')
  const cyclic = structuredClone(plan); cyclic.tasks[0].dependencyKeys = ['TASK-VERIFY']
  assert.throws(() => parseGeneratedPlanV3(JSON.stringify(cyclic), input), (error) => error.code === 'dependency-cycle')
  assert.throws(() => parseGeneratedPlanV3(JSON.stringify(plan), { ...input, uiScenarioKeys: ['SCN-001'] }), (error) => error.code === 'ui-verification-harness-missing')
  const browserVerified = structuredClone(plan)
  browserVerified.tasks[1].contextPack.verificationHarness = { kind: 'browser', runner: 'Repository browser runner', applicationStart: 'Start the test application.', fixtureMutation: 'create_and_cleanup', fixtureSetup: 'Create persisted operation facts.', navigation: 'Open the project detail route.', asyncWait: 'Wait for the stage list response and render.', persistedFactCorrelation: 'Compare the same operation id in storage, API, and rendered rows.', teardown: 'Stop the application and remove the fixture.' }
  assert.doesNotThrow(() => parseGeneratedPlanV3(JSON.stringify(browserVerified), { ...input, uiScenarioKeys: ['SCN-001'] }))
  const supportingBundleVerification = structuredClone(browserVerified)
  supportingBundleVerification.tasks.push({
    ...structuredClone(plan.tasks[1]),
    key: 'TASK-BUNDLE-VERIFY',
    dependencyKeys: ['TASK-IMPLEMENT'],
    contextPack: {
      ...structuredClone(plan.tasks[1].contextPack),
      expectedChangeSurfaces: ['tests/client-bundle.test.mjs'],
      verificationSteps: [{ scenarioKey: 'SCN-001', action: 'Run the source-required bundle contract regression.', expectedObservable: 'The narrower bundle contract remains present; the browser verifier separately closes the rendered UI chain.', commandEvidenceRef: 'ref-command-test' }],
    },
    changeContract: { ...structuredClone(plan.tasks[1].changeContract), allowedPathScopes: ['tests/client-bundle.test.mjs'], conflictKeys: [] },
  })
  assert.doesNotThrow(() => parseGeneratedPlanV3(JSON.stringify(supportingBundleVerification), { ...input, uiScenarioKeys: ['SCN-001'], bindingScopes: { 'BIND-API': ['src/service.ts', 'tests/client-bundle.test.mjs'] } }))
  const legacyBrowserVerified = structuredClone(browserVerified)
  delete legacyBrowserVerified.tasks[1].contextPack.verificationHarness.fixtureMutation
  assert.doesNotThrow(() => parseGeneratedPlanV3(JSON.stringify(legacyBrowserVerified), { ...input, uiScenarioKeys: ['SCN-001'] }))
  const browserInfrastructure = structuredClone(browserVerified)
  browserInfrastructure.tasks.push({ ...structuredClone(browserVerified.tasks[0]), key: 'TASK-BROWSER-INFRA', kind: 'test', changeContract: { ...structuredClone(browserVerified.tasks[0].changeContract), allowedPathScopes: ['tests/browser'] }, contextPack: { ...structuredClone(browserVerified.tasks[0].contextPack), expectedChangeSurfaces: ['tests/browser'] } })
  assert.throws(() => parseGeneratedPlanV3(JSON.stringify(browserInfrastructure), { ...input, uiScenarioKeys: ['SCN-001'], bindingScopes: { 'BIND-API': ['src/service.ts', 'tests/browser'] } }), (error) => error.code === 'browser-infrastructure-harness-contract-missing')
  browserInfrastructure.tasks.at(-1).contextPack.verificationHarness = structuredClone(browserVerified.tasks[1].contextPack.verificationHarness)
  assert.throws(() => parseGeneratedPlanV3(JSON.stringify(browserInfrastructure), { ...input, uiScenarioKeys: ['SCN-001'], bindingScopes: { 'BIND-API': ['src/service.ts', 'tests/browser'] } }), (error) => error.code === 'browser-harness-infrastructure-dependency-missing')
  browserInfrastructure.tasks[1].dependencyKeys = ['TASK-IMPLEMENT', 'TASK-BROWSER-INFRA']
  assert.doesNotThrow(() => parseGeneratedPlanV3(JSON.stringify(browserInfrastructure), { ...input, uiScenarioKeys: ['SCN-001'], bindingScopes: { 'BIND-API': ['src/service.ts', 'tests/browser'] } }))

  const implementationHarness = structuredClone(browserVerified)
  implementationHarness.tasks[0].contextPack.verificationHarness = structuredClone(browserVerified.tasks[1].contextPack.verificationHarness)
  assert.throws(() => parseGeneratedPlanV3(JSON.stringify(implementationHarness), { ...input, uiScenarioKeys: ['SCN-001'] }), (error) => error.code === 'browser-harness-ownership-invalid')

  const commandMismatchManifest = structuredClone(manifest)
  commandMismatchManifest.references.push({ ref: 'ref-command-build', kind: 'verification_command', artifactId: 'pnpm run build', artifactDigest: '6'.repeat(64) })
  const commandMismatch = structuredClone(browserVerified)
  commandMismatch.tasks[1].verificationCommandRefs = ['ref-command-build']
  commandMismatch.tasks[1].contextPack.verificationSteps[0].commandEvidenceRef = 'ref-command-build'
  assert.throws(() => parseGeneratedPlanV3(JSON.stringify(commandMismatch), { ...input, uiScenarioKeys: ['SCN-001'], promptReferenceManifest: commandMismatchManifest }), (error) => error.code === 'verification-harness-command-mismatch')
})

test('V3 plan requires dependency or a shared conflict key for overlapping write scopes', () => {
  const { manifest, plan } = planningV3Fixture()
  const input = { requirementKeys: ['REQ-001'], acceptanceKeys: ['AC-001'], requiredAcceptanceKeys: ['AC-001'], scenarioKeys: ['SCN-001'], requiredScenarioKeys: ['SCN-001'], decisionKeys: [], resolvedDecisionKeys: [], bindingKeys: ['BIND-API'], requiredPolicyRefs: ['ref-policy-must'], promptReferenceManifest: manifest }
  const overlapping = structuredClone(plan)
  overlapping.tasks[0].changeContract.allowedPathScopes = ['src/service.ts']
  overlapping.tasks[0].changeContract.conflictKeys = ['src/service.ts']
  overlapping.tasks[1].changeContract.allowedPathScopes = ['tests/service.test.mjs', 'tests/http.test.mjs']
  overlapping.tasks[1].contextPack.expectedChangeSurfaces = ['tests/service.test.mjs', 'tests/http.test.mjs']
  overlapping.tasks[1].changeContract.conflictKeys = ['api-verification']
  overlapping.tasks.push({
    ...structuredClone(overlapping.tasks[1]),
    key: 'TASK-POLICY-VERIFY',
    changeContract: {
      ...structuredClone(overlapping.tasks[1].changeContract),
      conflictKeys: ['policy-verification'],
    },
  })

  assert.throws(() => parseGeneratedPlanV3(JSON.stringify(overlapping), input), (error) => error.code === 'parallel-write-conflict-uncontrolled')

  const serializedByConflictKey = structuredClone(overlapping)
  serializedByConflictKey.tasks[1].changeContract.conflictKeys = ['tests-verification']
  serializedByConflictKey.tasks[2].changeContract.conflictKeys = ['tests-verification']
  assert.doesNotThrow(() => parseGeneratedPlanV3(JSON.stringify(serializedByConflictKey), input))

  const serializedByDependency = structuredClone(overlapping)
  serializedByDependency.tasks[2].dependencyKeys = ['TASK-IMPLEMENT', 'TASK-VERIFY']
  assert.doesNotThrow(() => parseGeneratedPlanV3(JSON.stringify(serializedByDependency), input))

  const transitivelyVerified = structuredClone(plan)
  transitivelyVerified.tasks.push({
    ...structuredClone(transitivelyVerified.tasks[0]),
    key: 'TASK-INFRA',
    relationship: 'migration',
    dependencyKeys: ['TASK-IMPLEMENT'],
    changeContract: { ...structuredClone(transitivelyVerified.tasks[0].changeContract), allowedPathScopes: ['scripts/build.mjs'], conflictKeys: ['scripts/build.mjs'] },
    contextPack: { ...structuredClone(transitivelyVerified.tasks[0].contextPack), expectedChangeSurfaces: ['scripts/build.mjs'] },
  })
  transitivelyVerified.tasks[1].dependencyKeys = ['TASK-INFRA']
  assert.doesNotThrow(() => parseGeneratedPlanV3(JSON.stringify(transitivelyVerified), input))

  const unreachableImplementation = structuredClone(transitivelyVerified)
  unreachableImplementation.tasks[2].dependencyKeys = []
  assert.throws(() => parseGeneratedPlanV3(JSON.stringify(unreachableImplementation), input), (error) => error.code === 'task-relationship-dependency-invalid')
})

test('V3 capability derivation is Service-owned and assignment uses exact trusted facts', () => {
  const { binding, plan } = planningV3Fixture()
  const capabilityInput = { projectId: 'p1', operationId: 'op1', reservedTaskIdsByKey: { 'TASK-IMPLEMENT': 'task-1', 'TASK-VERIFY': 'task-2' }, stackCapabilityEvidence: [{ capability: 'language.typescript', evidencePaths: ['src/service.ts'] }], repositoryEvidencePathByRef: { 'ref-evidence-owner': 'src/service.ts' }, now }
  const drafts = deriveCapabilityRequirementDraftsV3(plan, binding, capabilityInput)
  assert.deepEqual(drafts.map((draft) => draft.requiredRoles), [['implementer'], ['verifier']])
  assert.equal(drafts[0].requiredCapabilities.includes('language.typescript'), true)
  assert.equal(drafts[1].requiredCapabilities.includes('testing.verification'), true)

  const { drafts: assignments, evaluations } = qualifyAssignmentsV3(drafts, [
    { agentId: 'legacy-only', activeMembership: true, autoAssignable: true, deliveryRoles: ['implementer'], claimedCapabilityIds: drafts[0].requiredCapabilities, trustedCapabilityIds: [], repositoryAccess: true, runtimeCompatible: true, runtimeStatus: 'online', availableSlots: 1 },
    { agentId: 'engineer', activeMembership: true, autoAssignable: true, deliveryRoles: ['implementer'], claimedCapabilityIds: drafts[0].requiredCapabilities, trustedCapabilityIds: drafts[0].requiredCapabilities, repositoryAccess: true, runtimeCompatible: true, runtimeStatus: 'online', availableSlots: 1 },
    { agentId: 'tester', activeMembership: true, autoAssignable: true, deliveryRoles: ['verifier'], claimedCapabilityIds: drafts[1].requiredCapabilities, trustedCapabilityIds: drafts[1].requiredCapabilities, repositoryAccess: true, runtimeCompatible: true, runtimeStatus: 'online', availableSlots: 0 },
  ], { projectId: 'p1', operationId: 'op1', ...metricPolicyInput, now })
  assert.deepEqual(assignments.map((draft) => draft.executingAgentId), ['engineer', 'tester'])
  assert.deepEqual(assignments.map((draft) => draft.dispatchStatus), ['dispatchable', 'waiting_capacity'])
  assert.equal(assignments[0].candidates.find((candidate) => candidate.agentId === 'legacy-only').structuralEligibility, 'ineligible')
  assert.deepEqual(evaluations.map((record) => record.outcome), ['selected', 'selected'])

  const noOwner = qualifyAssignmentsV3([drafts[0]], [], { projectId: 'p1', operationId: 'op1', ...metricPolicyInput, now })
  assert.equal(noOwner.evaluations[0].outcome, 'abstained_no_eligible')
  assert.equal(noOwner.drafts[0].executingAgentId, undefined)
})

test('V3 capability derivation is scoped to each task change surface', () => {
  const { binding, plan } = planningV3Fixture()
  const scopedBinding = structuredClone(binding)
  const requiredEvidence = {
    domain_owner: 'ref-repo-server',
    data: 'ref-repo-data',
    api: 'ref-repo-server',
    permission: 'ref-repo-server',
    consumer: 'ref-repo-client',
    test: 'ref-repo-test',
    migration: 'ref-repo-server',
    rollback: 'ref-repo-server',
  }
  scopedBinding.bindings[0].evidenceRefs = Object.values(requiredEvidence)
  scopedBinding.bindings[0].allowedPathScopes = ['src', 'tests']
  scopedBinding.bindings[0].impactAssessments = scopedBinding.bindings[0].impactAssessments.map((assessment) => {
    const evidenceRef = requiredEvidence[assessment.dimension]
    return evidenceRef === undefined
      ? { ...assessment, applicability: 'not_applicable', evidenceRefs: [], reason: 'This dimension is not required by the fixture.' }
      : { ...assessment, applicability: 'required', evidenceRefs: [evidenceRef], reason: 'Task-local repository evidence proves this impact.' }
  })
  const task = (base, key, relationship, kind, scope, dependencyKeys = []) => ({
    ...structuredClone(base), key, relationship, kind, dependencyKeys,
    changeContract: { ...structuredClone(base.changeContract), allowedPathScopes: [scope] },
    contextPack: { ...structuredClone(base.contextPack), inScope: [scope], expectedChangeSurfaces: [scope] },
  })
  const scopedPlan = {
    ...plan,
    tasks: [
      task(plan.tasks[0], 'TASK-SERVER', 'implementation', 'code', 'src/service.ts'),
      task(plan.tasks[0], 'TASK-MIGRATE', 'migration', 'code', 'src/service.ts', ['TASK-SERVER']),
      task(plan.tasks[0], 'TASK-CLIENT', 'implementation', 'code', 'src/client.tsx'),
      task(plan.tasks[1], 'TASK-VERIFY', 'verification', 'test', 'tests/service.test.mjs', ['TASK-MIGRATE', 'TASK-CLIENT']),
    ],
  }
  const drafts = deriveCapabilityRequirementDraftsV3(scopedPlan, scopedBinding, {
    projectId: 'p1', operationId: 'op1',
    reservedTaskIdsByKey: { 'TASK-SERVER': 'task-server', 'TASK-MIGRATE': 'task-migrate', 'TASK-CLIENT': 'task-client', 'TASK-VERIFY': 'task-verify' },
    stackCapabilityEvidence: [
      { capability: 'language.typescript', evidencePaths: ['src/service.ts', 'src/client.tsx'] },
      { capability: 'language.javascript', evidencePaths: ['tests/service.test.mjs'] },
      { capability: 'framework.react', evidencePaths: ['package.json', 'src/client.tsx'] },
    ],
    repositoryEvidencePathByRef: { 'ref-repo-server': 'src/service.ts', 'ref-repo-data': 'src/storage.ts', 'ref-repo-client': 'src/client.tsx', 'ref-repo-test': 'tests/service.test.mjs' },
    now,
  })
  const byTask = new Map(drafts.map((draft) => [draft.taskKey, draft.requiredCapabilities]))
  assert.deepEqual(byTask.get('TASK-SERVER'), ['api.contract', 'language.typescript', 'security.authorization'])
  assert.deepEqual(byTask.get('TASK-MIGRATE'), ['api.contract', 'database.migration', 'language.typescript', 'release.rollback', 'security.authorization'])
  assert.deepEqual(byTask.get('TASK-CLIENT'), ['framework.react', 'integration.consumer', 'language.typescript'])
  assert.deepEqual(byTask.get('TASK-VERIFY'), ['api.contract', 'database.migration', 'framework.react', 'integration.consumer', 'language.javascript', 'release.rollback', 'security.authorization', 'testing.automation', 'testing.verification'])
  assert.equal(drafts.every((draft) => draft.derivationRuleVersion === 'v3.3.13'), true)

  const backendVerificationPlan = structuredClone(scopedPlan)
  backendVerificationPlan.tasks[3].key = 'TASK-MUTATION-BOUNDARY'
  backendVerificationPlan.tasks[3].dependencyKeys = ['TASK-SERVER']
  backendVerificationPlan.tasks[3].changeContract.allowedPathScopes = ['src/http.ts', 'tests/http.test.mjs']
  backendVerificationPlan.tasks[3].contextPack.expectedChangeSurfaces = ['src/http.ts', 'tests/http.test.mjs']
  const backendVerificationDrafts = deriveCapabilityRequirementDraftsV3(backendVerificationPlan, scopedBinding, {
    projectId: 'p1', operationId: 'op-backend-verification',
    reservedTaskIdsByKey: { 'TASK-SERVER': 'task-server', 'TASK-MIGRATE': 'task-migrate', 'TASK-CLIENT': 'task-client', 'TASK-MUTATION-BOUNDARY': 'task-mutation-boundary' },
    stackCapabilityEvidence: [
      { capability: 'language.typescript', evidencePaths: ['src/service.ts', 'src/http.ts', 'src/client.tsx'] },
      { capability: 'language.javascript', evidencePaths: ['tests/http.test.mjs'] },
      { capability: 'framework.react', evidencePaths: ['package.json', 'src/client.tsx'] },
    ],
    repositoryEvidencePathByRef: { 'ref-repo-server': 'src/service.ts', 'ref-repo-data': 'src/storage.ts', 'ref-repo-client': 'src/client.tsx', 'ref-repo-test': 'tests/service.test.mjs' }, now,
  })
  const backendVerificationCapabilities = backendVerificationDrafts.find((draft) => draft.taskKey === 'TASK-MUTATION-BOUNDARY').requiredCapabilities
  assert.equal(backendVerificationCapabilities.includes('language.typescript'), true)
  assert.equal(backendVerificationCapabilities.includes('language.javascript'), true)
  assert.equal(backendVerificationCapabilities.includes('framework.react'), false)

  const mixedConsumerBinding = structuredClone(scopedBinding)
  mixedConsumerBinding.bindings[0].impactAssessments = mixedConsumerBinding.bindings[0].impactAssessments.map((assessment) => assessment.dimension === 'consumer'
    ? { ...assessment, evidenceRefs: ['ref-repo-server', 'ref-repo-client'] }
    : assessment)
  const mixedConsumerDrafts = deriveCapabilityRequirementDraftsV3(scopedPlan, mixedConsumerBinding, {
    projectId: 'p1', operationId: 'op-mixed-consumer',
    reservedTaskIdsByKey: { 'TASK-SERVER': 'task-server', 'TASK-MIGRATE': 'task-migrate', 'TASK-CLIENT': 'task-client', 'TASK-VERIFY': 'task-verify' },
    stackCapabilityEvidence: [{ capability: 'language.typescript', evidencePaths: ['src/service.ts', 'src/client.tsx'] }, { capability: 'language.javascript', evidencePaths: ['tests/service.test.mjs'] }, { capability: 'framework.react', evidencePaths: ['package.json', 'src/client.tsx'] }],
    repositoryEvidencePathByRef: { 'ref-repo-server': 'src/service.ts', 'ref-repo-data': 'src/storage.ts', 'ref-repo-client': 'src/client.tsx', 'ref-repo-test': 'tests/service.test.mjs' }, now,
  })
  assert.equal(mixedConsumerDrafts.find((draft) => draft.taskKey === 'TASK-SERVER').requiredCapabilities.includes('framework.react'), false)
  assert.equal(mixedConsumerDrafts.find((draft) => draft.taskKey === 'TASK-CLIENT').requiredCapabilities.includes('framework.react'), true)

  const futureJavaScriptPlan = structuredClone(scopedPlan)
  futureJavaScriptPlan.tasks[0].changeContract.allowedPathScopes = ['tests/browser/server.mjs']
  futureJavaScriptPlan.tasks[0].contextPack.expectedChangeSurfaces = ['tests/browser/server.mjs']
  const futureJavaScriptDrafts = deriveCapabilityRequirementDraftsV3(futureJavaScriptPlan, scopedBinding, {
    projectId: 'p1', operationId: 'op-future-javascript',
    reservedTaskIdsByKey: { 'TASK-SERVER': 'task-server', 'TASK-MIGRATE': 'task-migrate', 'TASK-CLIENT': 'task-client', 'TASK-VERIFY': 'task-verify' },
    stackCapabilityEvidence: [{ capability: 'language.typescript', evidencePaths: ['src/service.ts', 'src/client.tsx'] }, { capability: 'language.javascript', evidencePaths: ['tests/service.test.mjs'] }],
    repositoryEvidencePathByRef: { 'ref-repo-server': 'src/service.ts', 'ref-repo-data': 'src/storage.ts', 'ref-repo-client': 'src/client.tsx', 'ref-repo-test': 'tests/service.test.mjs' }, now,
  })
  assert.equal(futureJavaScriptDrafts.find((draft) => draft.taskKey === 'TASK-SERVER').requiredCapabilities.includes('language.javascript'), true)
  assert.equal(futureJavaScriptDrafts.find((draft) => draft.taskKey === 'TASK-SERVER').requiredCapabilities.includes('language.typescript'), false)

  const asyncGovernanceBinding = structuredClone(scopedBinding)
  asyncGovernanceBinding.bindings[0].impactAssessments = asyncGovernanceBinding.bindings[0].impactAssessments.map((assessment) => assessment.dimension === 'async'
    ? { ...assessment, applicability: 'required', evidenceRefs: ['ref-repo-server'], reason: 'The governance verification observes an asynchronous request and persisted state transition.' }
    : assessment)
  const asyncGovernanceDrafts = deriveCapabilityRequirementDraftsV3(scopedPlan, asyncGovernanceBinding, {
    projectId: 'p1', operationId: 'op-async-governance',
    reservedTaskIdsByKey: { 'TASK-SERVER': 'task-server', 'TASK-MIGRATE': 'task-migrate', 'TASK-CLIENT': 'task-client', 'TASK-VERIFY': 'task-verify' },
    stackCapabilityEvidence: [
      { capability: 'language.typescript', evidencePaths: ['src/service.ts', 'src/client.tsx'] },
      { capability: 'language.javascript', evidencePaths: ['tests/service.test.mjs'] },
    ],
    repositoryEvidencePathByRef: { 'ref-repo-server': 'src/service.ts', 'ref-repo-data': 'src/storage.ts', 'ref-repo-client': 'src/client.tsx', 'ref-repo-test': 'tests/service.test.mjs' }, now,
  })
  assert.equal(asyncGovernanceDrafts.find((draft) => draft.taskKey === 'TASK-VERIFY').requiredCapabilities.includes('integration.async'), true)

  const browserPlan = structuredClone(scopedPlan)
  browserPlan.tasks[2].contextPack.verificationHarness = { kind: 'browser', runner: 'Playwright from package.json', applicationStart: 'Start the web script and await /health.', fixtureMutation: 'create_and_cleanup', fixtureSetup: 'Create one persisted operation fixture.', navigation: 'Open the project detail route.', asyncWait: 'Wait for the stage list DOM rows.', persistedFactCorrelation: 'Compare operation, stage, and round keys across storage, API, and DOM.', teardown: 'Close the browser and child process and remove temporary storage.' }
  browserPlan.tasks[3].contextPack.verificationHarness = structuredClone(browserPlan.tasks[2].contextPack.verificationHarness)
  const browserDrafts = deriveCapabilityRequirementDraftsV3(browserPlan, scopedBinding, {
    projectId: 'p1', operationId: 'op-browser',
    reservedTaskIdsByKey: { 'TASK-SERVER': 'task-server', 'TASK-MIGRATE': 'task-migrate', 'TASK-CLIENT': 'task-client', 'TASK-VERIFY': 'task-verify' },
    stackCapabilityEvidence: [{ capability: 'framework.react', evidencePaths: ['src/client.tsx'] }],
    repositoryEvidencePathByRef: { 'ref-repo-server': 'src/service.ts', 'ref-repo-data': 'src/storage.ts', 'ref-repo-client': 'src/client.tsx', 'ref-repo-test': 'tests/service.test.mjs' }, now,
  })
  assert.equal(browserDrafts.find((draft) => draft.taskKey === 'TASK-CLIENT').requiredCapabilities.includes('testing.browser-e2e'), true)
  assert.equal(browserDrafts.find((draft) => draft.taskKey === 'TASK-CLIENT').requiredCapabilities.includes('testing.verification'), true)
  assert.equal(browserDrafts.find((draft) => draft.taskKey === 'TASK-CLIENT').requiredCapabilities.includes('build.process-orchestration'), false)
  assert.equal(browserDrafts.find((draft) => draft.taskKey === 'TASK-CLIENT').requiredCapabilities.includes('release.delivery'), false)
  assert.equal(browserDrafts.find((draft) => draft.taskKey === 'TASK-CLIENT').requiredCapabilities.includes('data.change'), true)
  assert.equal(browserDrafts.find((draft) => draft.taskKey === 'TASK-CLIENT').requiredCapabilities.includes('security.authorization'), true)
  assert.equal(browserDrafts.find((draft) => draft.taskKey === 'TASK-VERIFY').requiredCapabilities.includes('testing.browser-e2e'), true)
  assert.equal(browserDrafts.find((draft) => draft.taskKey === 'TASK-VERIFY').requiredCapabilities.includes('testing.verification'), true)
  assert.equal(browserDrafts.find((draft) => draft.taskKey === 'TASK-VERIFY').requiredCapabilities.includes('build.process-orchestration'), false)
  assert.equal(browserDrafts.find((draft) => draft.taskKey === 'TASK-VERIFY').requiredCapabilities.includes('release.delivery'), false)
  assert.equal(browserDrafts.find((draft) => draft.taskKey === 'TASK-VERIFY').requiredCapabilities.includes('data.change'), true)
  assert.equal(browserDrafts.find((draft) => draft.taskKey === 'TASK-VERIFY').requiredCapabilities.includes('security.authorization'), true)
  assert.equal(browserDrafts.find((draft) => draft.taskKey === 'TASK-VERIFY').requiredCapabilities.includes('framework.react'), true)
  assert.equal(browserDrafts.find((draft) => draft.taskKey === 'TASK-VERIFY').requiredCapabilities.includes('language.typescript'), false)

  const noConsumerBrowserBinding = structuredClone(scopedBinding)
  noConsumerBrowserBinding.bindings[0].impactAssessments = noConsumerBrowserBinding.bindings[0].impactAssessments.map((assessment) => assessment.dimension === 'consumer'
    ? { ...assessment, applicability: 'not_applicable', evidenceRefs: [], reason: 'This browser flow has no bound UI consumer.' }
    : assessment)
  const noConsumerBrowserDrafts = deriveCapabilityRequirementDraftsV3(browserPlan, noConsumerBrowserBinding, {
    projectId: 'p1', operationId: 'op-browser-no-consumer',
    reservedTaskIdsByKey: { 'TASK-SERVER': 'task-server', 'TASK-MIGRATE': 'task-migrate', 'TASK-CLIENT': 'task-client', 'TASK-VERIFY': 'task-verify' },
    stackCapabilityEvidence: [{ capability: 'framework.react', evidencePaths: ['src/client.tsx'] }],
    repositoryEvidencePathByRef: { 'ref-repo-server': 'src/service.ts', 'ref-repo-data': 'src/storage.ts', 'ref-repo-client': 'src/client.tsx', 'ref-repo-test': 'tests/service.test.mjs' }, now,
  })
  assert.equal(noConsumerBrowserDrafts.find((draft) => draft.taskKey === 'TASK-VERIFY').requiredCapabilities.includes('framework.react'), false)

  const readOnlyBrowserPlan = structuredClone(browserPlan)
  readOnlyBrowserPlan.tasks[2].contextPack.verificationHarness.fixtureMutation = 'read_only'
  readOnlyBrowserPlan.tasks[3].contextPack.verificationHarness.fixtureMutation = 'read_only'
  const readOnlyBrowserDrafts = deriveCapabilityRequirementDraftsV3(readOnlyBrowserPlan, scopedBinding, {
    projectId: 'p1', operationId: 'op-browser-read-only',
    reservedTaskIdsByKey: { 'TASK-SERVER': 'task-server', 'TASK-MIGRATE': 'task-migrate', 'TASK-CLIENT': 'task-client', 'TASK-VERIFY': 'task-verify' },
    stackCapabilityEvidence: [{ capability: 'framework.react', evidencePaths: ['src/client.tsx'] }],
    repositoryEvidencePathByRef: { 'ref-repo-server': 'src/service.ts', 'ref-repo-data': 'src/storage.ts', 'ref-repo-client': 'src/client.tsx', 'ref-repo-test': 'tests/service.test.mjs' }, now,
  })
  assert.equal(readOnlyBrowserDrafts.find((draft) => draft.taskKey === 'TASK-CLIENT').requiredCapabilities.includes('data.change'), false)
  assert.equal(readOnlyBrowserDrafts.find((draft) => draft.taskKey === 'TASK-VERIFY').requiredCapabilities.includes('data.change'), false)
  assert.equal(readOnlyBrowserDrafts.find((draft) => draft.taskKey === 'TASK-CLIENT').requiredCapabilities.includes('security.authorization'), true)
  assert.equal(readOnlyBrowserDrafts.find((draft) => draft.taskKey === 'TASK-VERIFY').requiredCapabilities.includes('security.authorization'), true)

  const harnessPlan = structuredClone(scopedPlan)
  harnessPlan.tasks[2].changeContract.allowedPathScopes = ['tests/browser', 'tests/browser/config.mjs', 'package.json']
  harnessPlan.tasks[2].contextPack.expectedChangeSurfaces = ['tests/browser', 'tests/browser/config.mjs', 'package.json']
  harnessPlan.tasks[2].contextPack.verificationHarness = { kind: 'browser', runner: 'Playwright from package.json', applicationStart: 'Start the combined application and await /health.', fixtureMutation: 'create_and_cleanup', fixtureSetup: 'Create persisted operation facts.', navigation: 'Open the project detail route.', asyncWait: 'Wait for the stage list DOM rows.', persistedFactCorrelation: 'Compare persisted, API, and DOM facts.', teardown: 'Close the browser, process, and temporary storage.' }
  harnessPlan.tasks[2].dependencyKeys = ['TASK-SERVER']
  harnessPlan.tasks[3].dependencyKeys = ['TASK-SERVER', 'TASK-CLIENT']
  const harnessDrafts = deriveCapabilityRequirementDraftsV3(harnessPlan, scopedBinding, {
    projectId: 'p1', operationId: 'op-harness',
    reservedTaskIdsByKey: { 'TASK-SERVER': 'task-server', 'TASK-MIGRATE': 'task-migrate', 'TASK-CLIENT': 'task-client', 'TASK-VERIFY': 'task-verify' },
    stackCapabilityEvidence: [
      { capability: 'language.typescript', evidencePaths: ['src/service.ts', 'src/client.tsx'] },
      { capability: 'language.javascript', evidencePaths: ['tests/service.test.mjs'] },
      { capability: 'framework.react', evidencePaths: ['package.json', 'src/client.tsx'] },
    ],
    repositoryEvidencePathByRef: { 'ref-repo-server': 'src/service.ts', 'ref-repo-data': 'src/storage.ts', 'ref-repo-client': 'src/client.tsx', 'ref-repo-test': 'tests/service.test.mjs' }, now,
  })
  const harnessCapabilities = harnessDrafts.find((draft) => draft.taskKey === 'TASK-CLIENT').requiredCapabilities
  assert.equal(harnessCapabilities.includes('language.javascript'), true)
  assert.equal(harnessCapabilities.includes('language.typescript'), false)
  assert.equal(harnessCapabilities.includes('api.contract'), true)
  assert.equal(harnessCapabilities.includes('framework.react'), false)
  assert.equal(harnessCapabilities.includes('testing.browser-e2e'), true)
  assert.equal(harnessCapabilities.includes('testing.verification'), true)
  const serviceVerificationCapabilities = harnessDrafts.find((draft) => draft.taskKey === 'TASK-VERIFY').requiredCapabilities
  assert.equal(serviceVerificationCapabilities.includes('language.javascript'), true)
  assert.equal(serviceVerificationCapabilities.includes('language.typescript'), false)
  assert.equal(serviceVerificationCapabilities.includes('framework.react'), false)
  assert.equal(serviceVerificationCapabilities.includes('testing.browser-e2e'), false)
  assert.equal(serviceVerificationCapabilities.includes('build.process-orchestration'), false)

  const manifestOnlyPlan = structuredClone(scopedPlan)
  manifestOnlyPlan.tasks[3].changeContract.allowedPathScopes.push('package.json')
  manifestOnlyPlan.tasks[3].contextPack.expectedChangeSurfaces.push('package.json')
  const manifestOnlyBinding = structuredClone(scopedBinding)
  manifestOnlyBinding.bindings[0].impactAssessments = manifestOnlyBinding.bindings[0].impactAssessments.map((assessment) => assessment.dimension === 'consumer'
    ? { ...assessment, applicability: 'not_applicable', evidenceRefs: [], reason: 'This manifest-only task has no bound consumer behavior.' }
    : assessment)
  const manifestOnlyDrafts = deriveCapabilityRequirementDraftsV3(manifestOnlyPlan, manifestOnlyBinding, {
    projectId: 'p1', operationId: 'op-manifest-only-framework',
    reservedTaskIdsByKey: { 'TASK-SERVER': 'task-server', 'TASK-MIGRATE': 'task-migrate', 'TASK-CLIENT': 'task-client', 'TASK-VERIFY': 'task-verify' },
    stackCapabilityEvidence: [{ capability: 'framework.react', evidencePaths: ['package.json', 'src/client.tsx'] }, { capability: 'language.javascript', evidencePaths: ['tests/service.test.mjs'] }],
    repositoryEvidencePathByRef: { 'ref-repo-server': 'src/service.ts', 'ref-repo-data': 'src/storage.ts', 'ref-repo-client': 'src/client.tsx', 'ref-repo-test': 'tests/service.test.mjs' }, now,
  })
  assert.equal(manifestOnlyDrafts.find((draft) => draft.taskKey === 'TASK-VERIFY').requiredCapabilities.includes('framework.react'), false)
  assert.equal(manifestOnlyDrafts.find((draft) => draft.taskKey === 'TASK-VERIFY').requiredCapabilities.includes('testing.browser-e2e'), false)
  assert.equal(manifestOnlyDrafts.find((draft) => draft.taskKey === 'TASK-VERIFY').requiredCapabilities.includes('release.delivery'), false)

  const unresolvedConsumerBinding = structuredClone(scopedBinding)
  unresolvedConsumerBinding.bindings[0].impactAssessments = unresolvedConsumerBinding.bindings[0].impactAssessments.map((assessment) => assessment.dimension === 'consumer'
    ? { ...assessment, evidenceRefs: ['ref-repo-missing-consumer'] }
    : assessment)
  assert.throws(() => deriveCapabilityRequirementDraftsV3(scopedPlan, unresolvedConsumerBinding, {
    projectId: 'p1', operationId: 'op-unresolved-consumer',
    reservedTaskIdsByKey: { 'TASK-SERVER': 'task-server', 'TASK-MIGRATE': 'task-migrate', 'TASK-CLIENT': 'task-client', 'TASK-VERIFY': 'task-verify' },
    stackCapabilityEvidence: [{ capability: 'framework.react', evidencePaths: ['src/client.tsx'] }],
    repositoryEvidencePathByRef: { 'ref-repo-server': 'src/service.ts', 'ref-repo-data': 'src/storage.ts', 'ref-repo-client': 'src/client.tsx', 'ref-repo-test': 'tests/service.test.mjs' }, now,
  }), (error) => error?.code === 'capability-evidence-unresolved')

  const deliveryPlan = structuredClone(scopedPlan)
  const browserHarness = { kind: 'browser', runner: 'Playwright from package.json', applicationStart: 'Start the web script and await /health.', fixtureMutation: 'read_only', fixtureSetup: 'Use the frozen release fixture.', navigation: 'Open the project detail route.', asyncWait: 'Wait for the release status DOM.', persistedFactCorrelation: 'Compare the operation id across storage, API, and DOM.', teardown: 'Close the browser and application process.' }
  deliveryPlan.tasks.push({
    ...structuredClone(deliveryPlan.tasks[0]),
    key: 'TASK-BROWSER-INFRA',
    kind: 'test',
    dependencyKeys: ['TASK-SERVER'],
    changeContract: { ...structuredClone(deliveryPlan.tasks[0].changeContract), allowedPathScopes: ['tests/browser', 'package.json', 'pnpm-lock.yaml', '.github/workflows/verify.yml'] },
    contextPack: { ...structuredClone(deliveryPlan.tasks[0].contextPack), expectedChangeSurfaces: ['tests/browser', 'package.json', 'pnpm-lock.yaml', '.github/workflows/verify.yml'], verificationHarness: browserHarness },
  })
  deliveryPlan.tasks.push({
    ...structuredClone(deliveryPlan.tasks[1]),
    key: 'TASK-RELEASE-VERIFY',
    relationship: 'release',
    dependencyKeys: ['TASK-BROWSER-INFRA'],
    changeContract: { ...structuredClone(deliveryPlan.tasks[1].changeContract), allowedPathScopes: ['tests/browser/release.test.mjs', '.github/workflows/verify.yml'] },
    contextPack: { ...structuredClone(deliveryPlan.tasks[1].contextPack), expectedChangeSurfaces: ['tests/browser/release.test.mjs', '.github/workflows/verify.yml'] },
  })
  const deliveryDrafts = deriveCapabilityRequirementDraftsV3(deliveryPlan, scopedBinding, {
    projectId: 'p1', operationId: 'op-delivery-capabilities',
    reservedTaskIdsByKey: { 'TASK-SERVER': 'task-server', 'TASK-MIGRATE': 'task-migrate', 'TASK-CLIENT': 'task-client', 'TASK-VERIFY': 'task-verify', 'TASK-BROWSER-INFRA': 'task-browser-infra', 'TASK-RELEASE-VERIFY': 'task-release-verify' },
    stackCapabilityEvidence: [
      { capability: 'language.javascript', evidencePaths: ['tests/browser/release.test.mjs'] },
      { capability: 'framework.react', evidencePaths: ['src/client.tsx'] },
    ],
    repositoryEvidencePathByRef: { 'ref-repo-server': 'src/service.ts', 'ref-repo-data': 'src/storage.ts', 'ref-repo-client': 'src/client.tsx', 'ref-repo-test': 'tests/service.test.mjs' }, now,
  })
  const browserInfrastructureCapabilities = deliveryDrafts.find((draft) => draft.taskKey === 'TASK-BROWSER-INFRA').requiredCapabilities
  assert.equal(browserInfrastructureCapabilities.includes('testing.browser-e2e'), true)
  assert.equal(browserInfrastructureCapabilities.includes('testing.verification'), true)
  assert.equal(browserInfrastructureCapabilities.includes('build.process-orchestration'), true)
  assert.equal(browserInfrastructureCapabilities.includes('release.delivery'), true)
  const releaseVerificationCapabilities = deliveryDrafts.find((draft) => draft.taskKey === 'TASK-RELEASE-VERIFY').requiredCapabilities
  assert.equal(releaseVerificationCapabilities.includes('release.delivery'), true)
  assert.equal(releaseVerificationCapabilities.includes('build.process-orchestration'), true)
  assert.equal(releaseVerificationCapabilities.includes('testing.browser-e2e'), true)
  assert.equal(releaseVerificationCapabilities.includes('testing.verification'), true)
  assert.equal(releaseVerificationCapabilities.includes('framework.react'), true)

  const policyPlan = structuredClone(scopedPlan)
  policyPlan.tasks[3].policyConstraintRefs = ['ref-policy-security-boundary']
  const policyBinding = structuredClone(scopedBinding)
  policyBinding.bindings[0].impactAssessments = policyBinding.bindings[0].impactAssessments.map((assessment) => assessment.dimension === 'permission'
    ? { ...assessment, applicability: 'not_applicable', evidenceRefs: [], reason: 'The feature does not change authorization behavior.' }
    : assessment)
  const policyDrafts = deriveCapabilityRequirementDraftsV3(policyPlan, policyBinding, {
    projectId: 'p1', operationId: 'op-policy-capability',
    reservedTaskIdsByKey: { 'TASK-SERVER': 'task-server', 'TASK-MIGRATE': 'task-migrate', 'TASK-CLIENT': 'task-client', 'TASK-VERIFY': 'task-verify' },
    stackCapabilityEvidence: [{ capability: 'language.javascript', evidencePaths: ['tests/service.test.mjs'] }],
    repositoryEvidencePathByRef: { 'ref-repo-server': 'src/service.ts', 'ref-repo-data': 'src/storage.ts', 'ref-repo-client': 'src/client.tsx', 'ref-repo-test': 'tests/service.test.mjs' },
    policyCapabilitiesByRef: { 'ref-policy-security-boundary': derivePolicyCapabilityIdsV3('Mutation requests require a loopback Peer and Host with matching Origin and same-origin Fetch Metadata.') }, now,
  })
  assert.equal(policyDrafts.find((draft) => draft.taskKey === 'TASK-VERIFY').requiredCapabilities.includes('security.authorization'), true)
  assert.deepEqual(derivePolicyCapabilityIdsV3('Every change MUST include an automated regression test.'), [])

  assert.throws(() => deriveCapabilityRequirementDraftsV3(scopedPlan, scopedBinding, {
    projectId: 'p1', operationId: 'op1', reservedTaskIdsByKey: { 'TASK-SERVER': 'task-server', 'TASK-MIGRATE': 'task-migrate', 'TASK-CLIENT': 'task-client', 'TASK-VERIFY': 'task-verify' },
    stackCapabilityEvidence: [], repositoryEvidencePathByRef: {}, now,
  }), (error) => error.code === 'capability-evidence-unresolved')
})

test('V3 TaskPreflight verdict is owned by Service and bound to the executing Agent', () => {
  const { binding, plan } = planningV3Fixture()
  const [requirement] = deriveCapabilityRequirementDraftsV3({ ...plan, tasks: [plan.tasks[0]] }, binding, { projectId: 'p1', operationId: 'op1', reservedTaskIdsByKey: { 'TASK-IMPLEMENT': 'task-1' }, stackCapabilityEvidence: [{ capability: 'language.typescript', evidencePaths: ['src/service.ts'] }], repositoryEvidencePathByRef: { 'ref-evidence-owner': 'src/service.ts' }, now })
  const { drafts: [assignment] } = qualifyAssignmentsV3([requirement], [{ agentId: 'engineer', activeMembership: true, autoAssignable: true, deliveryRoles: ['implementer'], claimedCapabilityIds: requirement.requiredCapabilities, trustedCapabilityIds: requirement.requiredCapabilities, repositoryAccess: true, runtimeCompatible: true, runtimeStatus: 'online', availableSlots: 1 }], { projectId: 'p1', operationId: 'op1', ...metricPolicyInput, now })
  const accepted = evaluateTaskPreflightV3(assignment, { agentId: 'engineer', agentReportedStatus: 'accepted', identityAuditable: true, structuralEligible: true, accessCurrent: true, contextCurrent: true, evidenceRead: true, objectiveRestated: true, startingPointCovered: true, allowedScopeCovered: true, forbiddenScopeAcknowledged: true, verificationCovered: true, escalationCovered: true, noBlockingUnknowns: true, missingFacts: [] }, { id: 'preflight-1', now })
  assert.equal(accepted.serviceVerdict, 'accepted')
  const mismatch = evaluateTaskPreflightV3(assignment, { agentId: 'other', agentReportedStatus: 'accepted', identityAuditable: true, structuralEligible: true, accessCurrent: true, contextCurrent: true, evidenceRead: true, objectiveRestated: true, startingPointCovered: true, allowedScopeCovered: true, forbiddenScopeAcknowledged: true, verificationCovered: true, escalationCovered: true, noBlockingUnknowns: true, missingFacts: [] }, { id: 'preflight-2', now })
  assert.equal(mismatch.serviceVerdict, 'rejected')
  assert.equal(mismatch.acceptanceChecks.find((check) => check.code === 'agent_matches_assignment').status, 'fail')

  const baseReport = { agentId: 'engineer', agentReportedStatus: 'accepted', identityAuditable: true, structuralEligible: true, accessCurrent: true, contextCurrent: true, evidenceRead: true, objectiveRestated: true, startingPointCovered: true, allowedScopeCovered: true, forbiddenScopeAcknowledged: true, verificationCovered: true, escalationCovered: true, noBlockingUnknowns: true, missingFacts: [] }
  const withMissingFact = evaluateTaskPreflightV3(assignment, { ...baseReport, missingFacts: ['The current state owner is unresolved.'] }, { id: 'preflight-missing-fact', now })
  assert.equal(withMissingFact.serviceVerdict, 'needs_clarification')
  assert.equal(withMissingFact.acceptanceChecks.find((check) => check.code === 'no_blocking_unknowns').status, 'fail')

  const agentRejectedWithoutCandidateFailure = evaluateTaskPreflightV3(assignment, { ...baseReport, agentReportedStatus: 'rejected' }, { id: 'preflight-agent-rejected', now })
  assert.equal(agentRejectedWithoutCandidateFailure.serviceVerdict, 'needs_clarification')

  for (const [field, code, expectedVerdict, restartStage] of [
    ['accessCurrent', 'access_current', 'rejected', 'assignment_qualification'],
    ['contextCurrent', 'context_current', 'needs_clarification', 'code_binding'],
    ['allowedScopeCovered', 'allowed_scope_covered', 'needs_clarification', 'task_plan'],
    ['verificationCovered', 'verification_covered', 'needs_clarification', 'plan_review'],
  ]) {
    const result = evaluateTaskPreflightV3(assignment, { ...baseReport, [field]: false }, { id: `preflight-${code}`, now })
    assert.equal(result.serviceVerdict, expectedVerdict)
    assert.equal(result.acceptanceChecks.find((check) => check.code === code).restartStage, restartStage)
  }
})

test('V3 dispatch starts only the runnable frontier and hard failures create zero TaskRuns', () => {
  const requested = [
    { id: 'task-1', revision: 3, dependencies: [], status: 'draft', dispatchStatus: 'dispatchable' },
    { id: 'task-2', revision: 3, dependencies: ['task-1'], status: 'draft', dispatchStatus: 'dispatchable' },
    { id: 'task-3', revision: 3, dependencies: [], status: 'draft', dispatchStatus: 'waiting_capacity' },
  ]
  const partial = planExecutionDispatchV3(requested, { projectId: 'p1', approvalId: 'approval-1', expectedProjectRevision: 3, requestedTaskIds: requested.map((task) => task.id), gateCurrent: true, gateDigest: 'a'.repeat(64), idempotencyKey: 'dispatch-1', taskRunIdsByTaskId: { 'task-1': 'run-1' }, now })
  assert.equal(partial.outcome, 'partially_started')
  assert.deepEqual(partial.createdTaskRunIds, ['run-1'])
  assert.equal(partial.taskResults.find((result) => result.taskId === 'task-2').outcome, 'waiting_dependency')
  const stale = planExecutionDispatchV3([{ ...requested[0], stale: true }], { projectId: 'p1', approvalId: 'approval-1', expectedProjectRevision: 3, requestedTaskIds: ['task-1'], gateCurrent: true, gateDigest: 'a'.repeat(64), idempotencyKey: 'dispatch-2', taskRunIdsByTaskId: { 'task-1': 'must-not-exist' }, now })
  assert.equal(stale.outcome, 'stale')
  assert.deepEqual(stale.createdTaskRunIds, [])
})
