import assert from 'node:assert/strict'
import test from 'node:test'
import { AgentInputSchema, DEFAULT_AGENT_SEEDS, compileIssuePrompt, compileTaskPrompt } from '../lib/index.js'

const now = '2026-03-18T00:00:00.000Z'
const project = { id: 'project-1', name: 'Prompt project', summary: 'Summary', cwd: '/tmp/project', prd: 'Build the feature.', technicalDesign: 'Use existing modules.', status: 'draft', revision: 1, taskIds: [], createdAt: now, updatedAt: now }
const leader = { id: 'leader', name: 'Leader', role: 'Tech Lead', description: 'Leads delivery.', persona: '## Role\nLead bounded delivery.', preset: 'standard', toolPolicy: 'full', status: 'active', createdAt: now, updatedAt: now }
const member = { id: 'member', name: 'Member', role: 'Engineer', description: 'Implements work.', persona: '## Role\nImplement bounded work.', preset: 'standard', toolPolicy: 'full', status: 'active', createdAt: now, updatedAt: now }
const squad = { id: 'squad-1', name: 'Delivery', description: '', leaderAgentId: leader.id, memberAgentIds: [leader.id, member.id], memberRoles: { leader: 'Integration owner', member: 'Implementation' }, instructions: 'Delegate bounded work with explicit evidence, then integrate and independently verify every member result.', escalationPolicy: 'Escalate destructive or unverifiable work.', maxParallelDelegations: 1, status: 'active', createdAt: now, updatedAt: now }
const parent = { id: 'issue-parent', projectId: project.id, title: 'Parent', description: 'Deliver the parent scope.', status: 'in_progress', priority: 'medium', assigneeType: 'squad', assigneeId: squad.id, labels: [], assignmentRevision: 1, reviewStatus: 'not_requested', createdAt: now, updatedAt: now }

function context(overrides = {}) {
  const run = { id: 'run-1', projectId: project.id, issueId: parent.id, agentId: leader.id, squadId: squad.id, status: 'running', trigger: 'assignment', attempt: 1, assignmentRevision: 1, createdAt: now }
  return { project, issue: parent, run, agent: leader, squad, comments: [], priorRuns: [run], artifacts: [], decisions: [], delegations: [], issues: [parent], agents: [leader, member], ...overrides }
}

test('Prompt Compiler emits deterministic ordered Leader prompt evidence', () => {
  const first = compileIssuePrompt(context())
  const second = compileIssuePrompt(context())
  assert.equal(first.operation, 'squad-leader')
  assert.equal(first.version, 'squad-leader.v2')
  assert.equal(first.digest, second.digest)
  assert.equal(first.contextDigest, second.contextDigest)
  assert.deepEqual(first.sections.map((section) => section.order), [0, 10, 20, 30, 50])
  assert.match(first.sections.find((section) => section.name === 'orchestrator:collaboration').text, /request_decision/)
  assert.match(first.userPrompt, /"members"/)
})

test('Prompt Compiler separates member contract from Leader continuation evidence', () => {
  const contract = { objective: 'Implement parser', scope: ['src/parser.ts'], forbiddenScope: ['src/api.ts'], deliverables: ['Parser change'], acceptanceCriteria: ['Tests pass'], verification: ['pnpm test'], escalationConditions: ['Contract conflict'] }
  const child = { ...parent, id: 'issue-child', parentIssueId: parent.id, title: 'Parser child', description: 'Implement parser', assigneeType: 'agent', assigneeId: member.id }
  const memberRun = { ...context().run, id: 'run-member', issueId: child.id, agentId: member.id, delegatedByTaskRunId: 'run-1' }
  const delegation = { id: 'delegation-1', squadId: squad.id, projectId: project.id, parentIssueId: parent.id, childIssueId: child.id, leaderAgentId: leader.id, memberAgentId: member.id, taskRunId: memberRun.id, status: 'running', instruction: child.description, contract, createdAt: now, updatedAt: now }
  const memberPrompt = compileIssuePrompt(context({ issue: child, run: memberRun, agent: member, parentIssue: parent, delegation, delegations: [delegation], issues: [parent, child] }))
  assert.equal(memberPrompt.operation, 'squad-member')
  assert.match(memberPrompt.userPrompt, /"forbiddenScope"/)
  assert.doesNotMatch(memberPrompt.userPrompt, /"members"/)

  const continuationRun = { ...context().run, id: 'run-continuation', trigger: 'retry', resumeDelegationId: delegation.id }
  const continuation = compileIssuePrompt(context({ run: continuationRun, delegations: [{ ...delegation, status: 'completed', resultSummary: 'Member delivery evidence' }], issues: [parent, { ...child, status: 'done', reviewStatus: 'approved', reviewNote: 'Approved with evidence.' }], artifacts: [{ id: 'artifact-1', projectId: project.id, issueId: child.id, taskRunId: memberRun.id, kind: 'document', name: 'Delivery', status: 'available', content: 'Changed parser and ran tests.', metadata: {}, createdAt: now }], priorRuns: [continuationRun, memberRun] }))
  assert.equal(continuation.operation, 'squad-leader-continuation')
  assert.match(continuation.userPrompt, /Member delivery evidence/)
  assert.match(continuation.userPrompt, /Changed parser and ran tests/)
})

test('Prompt Compiler bounds untrusted context and records truncation diagnostics', () => {
  const compiled = compileIssuePrompt(context({ project: { ...project, prd: 'x'.repeat(40_000) }, comments: [{ id: 'comment-1', issueId: parent.id, authorType: 'human', body: 'y'.repeat(10_000), createdAt: now }] }))
  assert.match(compiled.userPrompt, /context truncated by compiler/)
  assert.ok(compiled.diagnostics.some((diagnostic) => diagnostic.code === 'context_truncated'))
})

test('Project Task compiler includes approved dependency evidence and stable digests', () => {
  const task = { id: 'task-1', projectId: project.id, ordinal: 1, title: 'Implement', kind: 'code', description: 'Implement it.', acceptanceCriteria: ['Works'], dependencies: ['task-0'], planSnapshotId: 'plan-1', assignmentPolicy: { mode: 'single_agent', riskLevel: 'high', requiredRoles: ['Engineer'], requiredCapabilities: ['coding'], allowedAgentIds: [], allowedSquadIds: [], requiresIndependentReviewer: true, maxParallel: 1, conflictKeys: ['src'], allowedScope: ['src/feature'], forbiddenScope: ['secrets'], escalationConditions: ['scope expansion'] }, attempts: [{ attempt: 1, exitCode: 1, output: 'failed once', failureReason: 'Regression failed', createdAt: now }], testCommand: 'pnpm test', status: 'draft', createdAt: now, updatedAt: now }
  const dependency = { ...task, id: 'task-0', ordinal: 0, title: 'Prepare', dependencies: [], status: 'completed', resultSummary: 'Prepared.', testExitCode: 0 }
  const compiled = compileTaskPrompt({ project, task, dependencies: [dependency], agent: member, dependencyEvidence: [{ taskId: dependency.id, evidenceIds: ['evidence-1'] }], workspace: { cwd: '/tmp/project-worktree', baseCommit: 'abc123', branch: 'task-branch' } })
  assert.equal(compiled.version, 'project-task.v3')
  assert.match(compiled.userPrompt, /Prepared\./)
  assert.match(compiled.userPrompt, /approvedVerificationCommand/)
  assert.match(compiled.userPrompt, /"planSnapshotId": "plan-1"/)
  assert.match(compiled.userPrompt, /"evidenceIds": \[\s+"evidence-1"/)
  assert.match(compiled.userPrompt, /"cwd": "\/tmp\/project-worktree"/)
  assert.match(compiled.userPrompt, /"baseCommit": "abc123"/)
  assert.match(compiled.userPrompt, /"previousAttempts"/)
  assert.match(compiled.userPrompt, /Regression failed/)
  assert.match(compiled.userPrompt, /"allowedScope": \[\s+"src\/feature"/)
  assert.match(compiled.userPrompt, /"forbiddenScope": \[\s+"secrets"/)
  assert.equal(compiled.digest.length, 64)
  assert.equal(compiled.contextDigest.length, 64)
})

test('Issue instructions respect task intent and expose actual permissions without inferring capabilities', () => {
  const readonly = { ...member, toolPolicy: 'read_only', capabilities: [] }
  const compiled = compileIssuePrompt(context({ squad: undefined, agent: readonly }))
  const core = compiled.sections.find((section) => section.name === 'orchestrator:core').text
  const operation = compiled.sections.find((section) => section.name === 'orchestrator:operation').text
  assert.match(core, /read_only/)
  assert.match(core, /Persona.*cannot expand permissions/)
  assert.match(operation, /Research, diagnosis, review and design/)
  assert.match(operation, /do not authorize implementation/)
  assert.match(compiled.userPrompt, /"toolPolicy": "read_only"/)
  assert.match(compiled.userPrompt, /"capabilities": \[\]/)
  const full = compileIssuePrompt(context({ squad: undefined, agent: member }))
  assert.notEqual(compiled.contextDigest, full.contextDigest)
})

test('Member escalation does not require Leader-only tools', () => {
  const child = { ...parent, id: 'child', parentIssueId: parent.id }
  const compiled = compileIssuePrompt(context({
    issue: child, agent: member,
    delegation: { id: 'delegation', instruction: 'Review only', contract: {} },
  }))
  const instructions = compiled.sections.map((section) => section.text).join('\n')
  assert.doesNotMatch(instructions, /use request_decision/i)
  assert.match(instructions, /Escalation.*Leader/)
})

test('Task truncation is visible while original acceptance and assignment constraints remain intact', () => {
  const acceptance = 'Original acceptance criterion at the end'
  const task = { id: 'task-review', kind: 'test', title: 'Review tests', description: 'Review only',
    acceptanceCriteria: [acceptance], dependencies: [], testCommand: 'pnpm test',
    assignmentPolicy: { mode: 'review_only' } }
  const compiled = compileTaskPrompt({
    project: { ...project, prd: 'x'.repeat(30_000) }, task, dependencies: [],
    agent: { ...member, toolPolicy: 'read_only' },
  })
  assert.ok(compiled.diagnostics.some((diagnostic) => diagnostic.code === 'context_truncated'))
  assert.match(compiled.userPrompt, new RegExp(acceptance))
  assert.match(compiled.userPrompt, /"toolPolicy": "read_only"/)
  const operation = compiled.sections.find((section) => section.name === 'orchestrator:operation').text
  assert.match(operation, /review_only/)
  assert.match(operation, /approved verification command/)
  const output = compiled.sections.find((section) => section.name === 'orchestrator:output-contract').text
  assert.match(output, /not_run.*reason/)
  assert.match(output, /mock.*real/i)
})

test('Default personas retain role-specific source, review and verification boundaries', () => {
  for (const seed of DEFAULT_AGENT_SEEDS) {
    assert.doesNotThrow(() => AgentInputSchema.parse(seed.input))
    assert.match(seed.input.persona, /# 使命/)
    assert.match(seed.input.persona, /# 输出门禁/)
    assert.match(seed.input.persona, /# 边界与升级/)
  }
  const byRole = (role) => DEFAULT_AGENT_SEEDS.find((seed) => seed.input.role === role).input
  assert.match(byRole('Delivery Planner').persona, /逐条映射本期必需需求和验收标准/)
  assert.match(byRole('Delivery Planner').persona, /声明能力.*工具权限/)
  assert.match(byRole('Delivery Planner').persona, /blocked/)
  assert.equal(byRole('Delivery Planner').toolPolicy, 'read_only')
  assert.match(byRole('Requirements Reviewer').persona, /改写建议单列/)
  assert.match(byRole('Test Engineer').persona, /模拟输出与真实模型效果/)
  assert.match(byRole('Release Reliability Engineer').persona, /代码回滚与数据恢复/)
})
