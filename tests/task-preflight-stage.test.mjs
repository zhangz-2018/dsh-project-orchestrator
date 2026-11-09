import assert from 'node:assert/strict'
import test from 'node:test'
import { OrchestratorStore, TaskPreflightRecordV3Schema, TaskPreflightStage } from '../lib/index.js'

const now = '2026-09-23T00:00:00.000Z'

class MemoryTable {
  records = new Map()
  get(id) { return this.records.get(id) }
  entries() { return this.records.entries() }
  async put(id, value) { this.records.set(id, structuredClone(value)) }
  async delete(id) { return this.records.delete(id) }
  async update(id, transform) { const next = transform(this.records.get(id)); await this.put(id, next); return next }
}

function memoryStore() {
  const tables = new Map()
  return new OrchestratorStore({ table(name) {
    if (!tables.has(name)) tables.set(name, new MemoryTable())
    return tables.get(name)
  } })
}

function report() {
  return {
    agentId: 'agent-1', agentReportedStatus: 'accepted', identityAuditable: true, structuralEligible: true,
    accessCurrent: true, contextCurrent: true, evidenceRead: true, objectiveRestated: true,
    startingPointCovered: true, allowedScopeCovered: true, forbiddenScopeAcknowledged: true,
    verificationCovered: true, escalationCovered: true, noBlockingUnknowns: true, missingFacts: [],
  }
}

async function fixture() {
  const store = memoryStore()
  await store.agents.put('agent-1', { id: 'agent-1', status: 'active' })
  await store.resourceAccessGrants.put('grant-1', { id: 'grant-1', principalType: 'agent', principalId: 'agent-1', repositoryIdentityDigest: 'a'.repeat(64), permissions: ['repository_read'], pathScopes: ['.'], commandIds: ['pnpm test'], validFrom: now, grantDigest: 'b'.repeat(64) })
  const assignment = {
    id: 'assignment-1', projectId: 'project-1', operationId: 'operation-1', reservedTaskId: 'task-1', taskKey: 'TASK-1',
    assignmentDraftDigest: 'c'.repeat(64), executingAgentId: 'agent-1', dispatchStatus: 'dispatchable',
    candidates: [{ agentId: 'agent-1', structuralEligibility: 'eligible', reasonCodes: [] }],
  }
  const task = {
    key: 'TASK-1', evidenceClaimRefs: ['ref-binding'], policyConstraintRefs: [], verificationCommandRefs: ['ref-command'],
    contextPack: { currentBehaviorClaimRefs: [], startingPoints: [{ evidenceRef: 'ref-binding', reason: 'Current owner.' }], verificationSteps: [] },
  }
  const binding = { id: 'binding-1', key: 'BIND-1', bindingDigest: 'd'.repeat(64), evidenceIds: ['src/owner.ts'], ownerSymbols: ['Owner'], currentBehaviorClaims: ['Current behavior.'], allowedPathScopes: ['src/owner.ts'], excludedPathScopes: [] }
  const manifest = { id: 'manifest-1', projectId: 'project-1', operationId: 'operation-1', manifestDigest: 'e'.repeat(64), references: [
    { ref: 'ref-binding', kind: 'evidence_claim', artifactId: binding.id, artifactDigest: binding.bindingDigest },
    { ref: 'ref-command', kind: 'verification_command', artifactId: 'pnpm test', artifactDigest: 'f'.repeat(64) },
  ] }
  const input = {
    tasks: [task], assignments: [assignment], manifest, bindings: [binding], constraints: [],
    accessSnapshot: { id: 'access-1', projectId: 'project-1', operationId: 'operation-1', snapshotDigest: '1'.repeat(64), grantIds: ['grant-1'] },
    repositoryDigest: '2'.repeat(64), operationId: 'operation-1', now,
  }
  return { store, input }
}

test('TaskPreflightStage persists a verdict from the selected Agent and frozen evidence', async () => {
  const { store, input } = await fixture()
  const prompts = []
  const preflights = await new TaskPreflightStage(store).run({ ...input, runReadOnly: async (prompt, agent) => {
    prompts.push({ prompt, agentId: agent.id })
    return JSON.stringify(report())
  } })

  assert.equal(prompts.length, 1)
  assert.equal(prompts[0].agentId, 'agent-1')
  assert.match(prompts[0].prompt, /src\/owner\.ts/u)
  assert.equal(preflights[0].serviceVerdict, 'accepted')
  assert.doesNotThrow(() => TaskPreflightRecordV3Schema.parse(preflights[0]))
  assert.deepEqual(store.taskPreflightsV3.get(preflights[0].id), preflights[0])
})

test('TaskPreflightStage supports zero-tool handoff using only relevant frozen source excerpts', async () => {
  const { store, input } = await fixture()
  const sourceEvidence = [
    { ref: 'ref-repo-owner', path: 'src/owner.ts', digest: 'a'.repeat(64), content: 'export class Owner { current = true }', truncated: true },
    { ref: 'ref-repo-unrelated', path: 'src/unrelated.ts', digest: 'b'.repeat(64), content: 'unrelated secret fixture text', truncated: false },
  ]
  const preflights = await new TaskPreflightStage(store).run({ ...input, sourceEvidence, runReadOnly: async (prompt) => {
    assert.match(prompt, /Tool execution is unavailable/u)
    assert.doesNotMatch(prompt, /then use read-only repository tools/u)
    const excerpts = JSON.parse(prompt.split('Frozen repository source excerpts:\n')[1].split('\n\nReference manifest identity:')[0])
    assert.deepEqual(excerpts, [sourceEvidence[0]])
    assert.match(prompt, /untrusted source data/u)
    assert.match(prompt, /truncated=true/u)
    return JSON.stringify(report())
  } })
  assert.equal(preflights[0].serviceVerdict, 'accepted')
})

test('TaskPreflightStage retries a malformed report once but does not retry a failed model call', async () => {
  const { store, input } = await fixture()
  const prompts = []
  const preflights = await new TaskPreflightStage(store).run({ ...input, runReadOnly: async (prompt) => {
    prompts.push(prompt)
    return prompts.length === 1 ? '{malformed' : `\`\`\`json\n${JSON.stringify(report())}\n\`\`\``
  } })
  assert.equal(preflights[0].serviceVerdict, 'accepted')
  assert.equal(prompts.length, 2)
  assert.match(prompts[1], /Gate feedback:/u)

  let failedCalls = 0
  await assert.rejects(() => new TaskPreflightStage(store).run({ ...input, runReadOnly: async () => {
    failedCalls += 1
    throw new Error('model unavailable')
  } }), /model unavailable/u)
  assert.equal(failedCalls, 1)
})

test('TaskPreflightStage supplies only frozen dependency contracts, including transitive baseline ownership', async () => {
  const { store, input } = await fixture()
  input.tasks[0].dependencyKeys = ['IMPLEMENT']
  const baseline = { key: 'BASELINE', dependencyKeys: [], completionCriteria: ['Measure the frozen revision before any implementation write.'], changeContract: { allowedPathScopes: [] }, contextPack: { objective: 'Capture baseline', expectedArtifacts: ['revision, commands, environment, values and units'] } }
  const implement = { key: 'IMPLEMENT', dependencyKeys: ['BASELINE'], completionCriteria: ['Implement after baseline evidence exists.'], contextPack: { objective: 'Implement the change' } }
  const unrelated = { key: 'UNRELATED', dependencyKeys: [], contextPack: { objective: 'unrelated-contract-do-not-disclose' } }
  const preflights = await new TaskPreflightStage(store).run({ ...input, tasks: [...input.tasks, implement, baseline, unrelated], runReadOnly: async prompt => {
    const dependencies = JSON.parse(prompt.split('Frozen dependency task contracts:\n')[1].split('\n\nTask proposal:')[0])
    assert.deepEqual(dependencies.map(t => t.key), ['BASELINE', 'IMPLEMENT'])
    assert.deepEqual(dependencies[0].contextPack.expectedArtifacts, baseline.contextPack.expectedArtifacts)
    assert.doesNotMatch(prompt, /unrelated-contract-do-not-disclose/u)
    return JSON.stringify(report())
  } })
  assert.equal(preflights[0].serviceVerdict, 'accepted')
})

test('TaskPreflightStage rejects missing or cyclic dependency contracts before requesting a handoff', async () => {
  const { store, input } = await fixture()
  input.tasks[0].dependencyKeys = ['BASELINE']
  let calls = 0
  const runReadOnly = async () => { calls++; return JSON.stringify(report()) }
  await assert.rejects(() => new TaskPreflightStage(store).run({ ...input, runReadOnly }), error => error.code === 'task-preflight-dependency-missing')
  await assert.rejects(() => new TaskPreflightStage(store).run({ ...input, tasks: [...input.tasks, { key: 'BASELINE', dependencyKeys: ['TASK-1'] }], runReadOnly }), error => error.code === 'task-preflight-dependency-cycle')
  assert.equal(calls, 0)
  assert.equal([...store.taskPreflightsV3.entries()].length, 0)
})

test('TaskPreflightStage rejects a stale Binding digest before model execution', async () => {
  const { store, input } = await fixture()
  let calls = 0
  await assert.rejects(
    () => new TaskPreflightStage(store).run({ ...input, bindings: [{ ...input.bindings[0], bindingDigest: '0'.repeat(64) }], runReadOnly: async () => { calls += 1; return JSON.stringify(report()) } }),
    (error) => error.code === 'task-preflight-evidence-unresolved',
  )
  assert.equal(calls, 0)
  assert.equal([...store.taskPreflightsV3.entries()].length, 0)
})

test('TaskPreflightStage rejects a foreign assignment or missing task before model execution', async () => {
  const { store, input } = await fixture()
  let calls = 0
  const runReadOnly = async () => { calls += 1; return JSON.stringify(report()) }
  await assert.rejects(() => new TaskPreflightStage(store).run({ ...input, assignments: [{ ...input.assignments[0], operationId: 'other-operation' }], runReadOnly }), (error) => error.code === 'task-preflight-stale')
  await assert.rejects(() => new TaskPreflightStage(store).run({ ...input, tasks: [], runReadOnly }), (error) => error.code === 'task-preflight-task-missing')
  assert.equal(calls, 0)
  assert.equal([...store.taskPreflightsV3.entries()].length, 0)
})
