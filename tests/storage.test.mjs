import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  OrchestratorService,
  OrchestratorStore,
  AcceptanceCriterionRecordSchema,
  RequirementAnalysisProposalRecordSchema,
  RequirementSourceManifestRecordSchema,
  digestObject,
  orchestratorDomain,
  planDigest,
} from '../lib/index.js'

const now = '2026-08-17T00:00:00.000Z'

class MemoryTable {
  constructor(records = []) {
    this.records = new Map(records.map((record) => [record.id, structuredClone(record)]))
  }
  get(key) { return this.records.get(key) }
  entries() { return this.records.entries() }
  async put(key, value) { this.records.set(key, structuredClone(value)) }
  async delete(key) { return this.records.delete(key) }
  async update(key, fn) {
    if (!this.records.has(key)) throw new Error('missing key')
    const next = fn(this.records.get(key))
    this.records.set(key, structuredClone(next))
    return next
  }
}

function createStore({ agents = [], projects = [], tasks = [], approvals = [], runs = [], projectAgentMemberships = [], projectSquadBindings = [], projectAgentMembershipSources = [], featureUsageDaily = [], planSnapshots = [], verificationEvidence = [], projectReviews = [], deliveryRecords = [] } = {}) {
  const tables = {
    agents: new MemoryTable(agents),
    projects: new MemoryTable(projects),
    tasks: new MemoryTable(tasks),
    approvals: new MemoryTable(approvals),
    runs: new MemoryTable(runs),
    workspace_writer_leases: new MemoryTable(),
    project_agent_memberships: new MemoryTable(projectAgentMemberships),
    project_squad_bindings: new MemoryTable(projectSquadBindings),
    project_agent_membership_sources: new MemoryTable(projectAgentMembershipSources),
    feature_usage_daily: new MemoryTable(featureUsageDaily),
    plan_snapshots: new MemoryTable(planSnapshots),
    requirement_bundles: new MemoryTable(),
    requirement_items: new MemoryTable(),
    acceptance_criteria: new MemoryTable(),
    verification_evidence: new MemoryTable(verificationEvidence),
    project_reviews: new MemoryTable(projectReviews),
    delivery_records: new MemoryTable(deliveryRecords),
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

test('production Store fences every table mutation before writer acquisition and after release', async () => {
  const lockDirectory = await mkdtemp(join(tmpdir(), 'po-store-writer-'))
  const store = createStore()
  const service = new OrchestratorService({}, store, undefined, undefined, { workspaceWriter: { workspaceIdentity: 'guarded-store', lockDirectory } })
  try {
    await assert.rejects(() => store.projects.delete('missing-before-init'), (error) => error.code === 'workspace-writer-fenced')
    await service.initialize()
    assert.equal(await store.projects.delete('missing-while-held'), false)
    await service.close()
    await assert.rejects(() => store.projects.delete('missing-after-close'), (error) => error.code === 'workspace-writer-fenced')
  } finally {
    await service.close()
    await rm(lockDirectory, { recursive: true, force: true })
  }
})

test('storage startup accepts legacy oversized section paths while canonical writes remain strict', () => {
  const oversized = String.raw`heading\n\n## requirement`.repeat(30)
  assert.ok(oversized.length > 500)
  const anchor = { id: 'src:heading:prd:line:1:legacy', kind: 'heading', documentKind: 'prd', sectionPath: [oversized], ordinal: 0, text: oversized, textDigest: digestObject(oversized), locator: 'prd:line:1', normativeHints: [], contentClassification: 'context', classificationReason: 'Historical candidate record.', requiredDisposition: false }
  const core = { projectId: 'p1', operationId: 'op1', sourceDigest: 'a'.repeat(64), sourceProfileIds: ['profile1'], sourceCompletenessDigest: 'b'.repeat(64), parserVersion: 'v3.3.0', anchors: [anchor], anchorIds: [anchor.id], sourceBlockCount: 1, classifiedBlockCount: 1, requiredAnchorCount: 0, classificationDigest: 'c'.repeat(64), dispositionDigest: 'd'.repeat(64), status: 'accepted' }
  const record = { id: 'manifest1', ...core, manifestDigest: digestObject(core), createdAt: now }

  assert.throws(() => RequirementSourceManifestRecordSchema.parse(record), /<=500 characters/)
  const loaded = orchestratorDomain.tables.requirement_source_manifests.valueSchema.parse(record)
  assert.deepEqual(loaded, record)
  assert.equal(loaded.manifestDigest, digestObject(core))
})

test('storage startup preserves legacy good scenarios while canonical V3.3 writes require happy_path', () => {
  const analysis = {
    status: 'ready',
    summary: 'Legacy requirement analysis.',
    requirements: [{ key: 'REQ-001', kind: 'fact', scope: 'in_scope', statement: 'Save a record.', sourceRefs: ['source-1'], acceptanceCriteria: [{ key: 'AC-001', statement: 'The record is saved.', required: true, scenario: 'good', sourceRefs: ['source-1'] }] }],
    decisions: [],
    diagnostics: [],
  }
  const proposal = { id: 'proposal-legacy-good', projectId: 'p1', operationId: 'op1', stageAttemptId: 'attempt-1', sourceManifestId: 'manifest-1', sourceManifestDigest: 'a'.repeat(64), analysis, analysisDigest: digestObject(analysis), promptVersion: 'legacy-v3.3', createdAt: now }
  const criterion = { id: 'criterion-legacy-good', projectId: 'p1', bundleId: 'bundle-1', requirementItemId: 'requirement-1', key: 'AC-001', statement: 'The record is saved.', sourceRefs: ['source-1'], required: true, scenario: 'good', taskIds: [], evidenceIds: [], status: 'open', createdAt: now, updatedAt: now }

  assert.throws(() => RequirementAnalysisProposalRecordSchema.parse(proposal), /happy_path/)
  assert.throws(() => AcceptanceCriterionRecordSchema.parse(criterion), /happy_path/)
  const loadedProposal = orchestratorDomain.tables.requirement_analysis_proposals.valueSchema.parse(proposal)
  const loadedCriterion = orchestratorDomain.tables.acceptance_criteria.valueSchema.parse(criterion)
  assert.deepEqual(loadedProposal, proposal)
  assert.deepEqual(loadedCriterion, criterion)
  assert.equal(digestObject(loadedProposal.analysis), proposal.analysisDigest)
})

test('snapshot includes durable memberships, Squad bindings, sources, and local usage aggregates', async () => {
  const membership = { id: 'p1:a1', projectId: 'p1', agentId: 'a1', projectRole: 'Backend', autoAssignable: true, status: 'active', joinedBy: 'tester', joinedAt: now, updatedAt: now }
  const binding = { id: 'p1:s1', projectId: 'p1', squadId: 's1', status: 'active', isDefault: true, syncedSquadUpdatedAt: now, boundBy: 'tester', boundAt: now, updatedAt: now }
  const source = { id: 'p1:a1:squad:s1', projectId: 'p1', agentId: 'a1', sourceType: 'squad', sourceId: 's1', projectRole: 'Backend', autoAssignable: true, status: 'active', createdAt: now, updatedAt: now }
  const usage = { id: '2026-08-17:projects', date: '2026-08-17', feature: 'projects', opens: 2, meaningfulActions: 1, errorRecoveries: 0, lastUsedAt: now }
  const digest = 'a'.repeat(64)
  const planSnapshot = { id: 'p1:r3', projectId: 'p1', revision: 3, mode: 'initial', taskIds: ['p1-code', 'p1-test'], planHash: digest, teamComposition: { members: [], squads: [], teamDigest: digest, capturedAt: now }, teamDigest: digest, assignmentDigest: digest, status: 'candidate', createdAt: now }
  const verification = { id: 'e1', projectId: 'p1', taskId: 'p1-code', kind: 'test_command', status: 'passed', acceptanceIds: [], artifactIds: [], actorType: 'system', createdAt: now }
  const review = { id: 'p1:review:r3', projectId: 'p1', revision: 3, evidenceIds: ['e1'], status: 'pending', reviewerType: 'human', summary: '待人工确认。', createdAt: now }
  const delivery = { id: 'p1:delivery:r3', projectId: 'p1', revision: 3, reviewId: review.id, evidenceIds: ['e1'], status: 'ready', createdAt: now }
  const bundle = { id: 'p1:bundle:1', projectId: 'p1', title: '需求来源', mode: 'initial', prd: 'PRD', technicalDesign: 'Design', sourceRefs: ['pdf:1'], sourceDigest: 'b'.repeat(64), status: 'active', createdAt: now, updatedAt: now }
  const item = { id: 'p1:item:1', projectId: 'p1', bundleId: bundle.id, key: 'root', kind: 'fact', statement: '需求来源包', sourceRefs: ['pdf:1'], status: 'active', createdAt: now, updatedAt: now }
  const criterion = { id: 'p1:acceptance:1', projectId: 'p1', bundleId: bundle.id, requirementItemId: item.id, key: 'a1', statement: '通过验证', sourceRefs: ['pdf:1'], taskIds: ['p1-code'], evidenceIds: ['e1'], status: 'verified', createdAt: now, updatedAt: now }
  const store = createStore({ projects: [project('p1', [])], projectAgentMemberships: [membership], projectSquadBindings: [binding], projectAgentMembershipSources: [source], featureUsageDaily: [usage], planSnapshots: [planSnapshot], verificationEvidence: [verification], projectReviews: [review], deliveryRecords: [delivery] })
  await store.requirementBundles.put(bundle.id, bundle)
  await store.requirementItems.put(item.id, item)
  await store.acceptanceCriteria.put(criterion.id, criterion)
  const snapshot = store.snapshot()
  assert.deepEqual(snapshot.projectAgentMemberships, [membership])
  assert.deepEqual(snapshot.projectSquadBindings, [binding])
  assert.deepEqual(snapshot.projectAgentMembershipSources, [source])
  assert.deepEqual(snapshot.featureUsageDaily, [usage])
  assert.deepEqual(snapshot.planSnapshots, [planSnapshot])
  assert.deepEqual(snapshot.requirementBundles, [bundle])
  assert.deepEqual(snapshot.requirementItems, [item])
  assert.deepEqual(snapshot.acceptanceCriteria, [criterion])
  assert.deepEqual(snapshot.verificationEvidence, [verification])
  assert.deepEqual(snapshot.projectReviews, [review])
  assert.deepEqual(snapshot.deliveryRecords, [delivery])
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
