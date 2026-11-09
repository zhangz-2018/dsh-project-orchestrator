import assert from 'node:assert/strict'
import test from 'node:test'
import {
  AgentCapabilityClaimRecordSchema,
  AssignmentStage,
  CapabilityRequirementDraftRecordSchema,
  OrchestratorStore,
  ProjectAccessGrantSnapshotRecordSchema,
  ProjectCapabilityCatalogSnapshotRecordSchema,
  ResourceAccessGrantRecordSchema,
  digestObject,
} from '../lib/index.js'

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

async function fixture(trusted) {
  const store = memoryStore()
  const project = { id: 'project-1' }
  const membership = {
    id: 'project-1:agent-1', projectId: project.id, agentId: 'agent-1', status: 'active', autoAssignable: true,
    deliveryRoles: ['implementer'], joinedBy: 'owner', updatedAt: now,
  }
  const requirementCore = {
    projectId: project.id, operationId: 'operation-1', reservedTaskId: 'task-1', taskKey: 'TASK-1',
    requiredRoles: ['implementer'], requiredCapabilities: ['language.typescript'], requiresIndependentReviewer: false,
    derivationRuleVersion: 'test-v1', sourceBindingKeys: ['binding-1'],
  }
  const requirement = CapabilityRequirementDraftRecordSchema.parse({ id: 'capreq-1', ...requirementCore, requirementDigest: digestObject(requirementCore), createdAt: now })
  const target = {
    resourceId: 'repository-1', repositoryIdentityDigest: 'a'.repeat(64), integrationGrantId: 'grant-integration', integrationPrincipalId: 'system:delivery-integration',
  }
  const integrationCore = {
    projectId: project.id, principalType: 'integration_service', principalId: target.integrationPrincipalId, resourceId: target.resourceId,
    repositoryIdentityDigest: target.repositoryIdentityDigest, permissions: ['canonical_integrate'], pathScopes: ['.'], commandIds: [],
    grantedBy: 'system', grantSource: 'resource_binding', validFrom: now, reason: 'Frozen canonical Integration authority.',
  }
  await store.projects.put(project.id, project)
  await store.projectAgentMemberships.put(membership.id, membership)
  await store.agents.put('agent-1', { id: 'agent-1', status: 'active', capabilities: ['language.typescript'], maxConcurrency: 1 })
  await store.resourceAccessGrants.put(target.integrationGrantId, ResourceAccessGrantRecordSchema.parse({ id: target.integrationGrantId, ...integrationCore, grantDigest: digestObject(integrationCore) }))
  if (trusted) {
    const claimCore = { projectId: project.id, agentId: 'agent-1', capabilityId: 'language.typescript', capabilityVersion: 1, source: 'human_confirmed', status: 'active', confirmedBy: 'owner', validFrom: now }
    await store.agentCapabilityClaims.put('claim-trusted', AgentCapabilityClaimRecordSchema.parse({ id: 'claim-trusted', ...claimCore, claimDigest: digestObject(claimCore) }))
  }
  return { store, project, requirement, target, repository: { verifiedCommands: ['pnpm test'] } }
}

async function runAssignmentStage(trusted) {
  const context = await fixture(trusted)
  const stage = new AssignmentStage(context.store)
  await stage.ensureCapabilityDefinitions([context.requirement], now)
  const capability = await stage.captureCapabilityCatalog(context.project.id, 'operation-1', now)
  const access = await stage.captureAccessGrants(context.project, 'operation-1', context.repository, context.target, now, () => 'b'.repeat(64))
  const assignment = await stage.qualify([context.requirement], capability, access, {
    projectId: context.project.id, operationId: 'operation-1', metricPolicyId: 'policy-1', metricPolicyVersion: '1',
    metricPolicyDigest: 'c'.repeat(64), risk: 'medium', now,
  })
  return { ...context, capability, access, assignment }
}

test('AssignmentStage keeps legacy capability mapping pending and blocks untrusted ownership', async () => {
  const { store, capability, access, assignment } = await runAssignmentStage(false)
  assert.doesNotThrow(() => ProjectCapabilityCatalogSnapshotRecordSchema.parse(capability))
  assert.doesNotThrow(() => ProjectAccessGrantSnapshotRecordSchema.parse(access))
  assert.equal(capability.activeClaimIds.length, 0)
  assert.equal(capability.pendingMappingClaimIds.length, 1)
  assert.equal(assignment.evaluations[0].outcome, 'abstained_no_eligible')
  assert.deepEqual(assignment.drafts[0].candidates[0].reasonCodes, ['capability-claim-untrusted'])
  assert.equal(assignment.drafts[0].executingAgentId, undefined)
  assert.deepEqual(store.assignmentDrafts.get(assignment.drafts[0].id), assignment.drafts[0])
  assert.deepEqual(store.assignmentEvaluations.get(assignment.evaluations[0].id), assignment.evaluations[0])
})

test('AssignmentStage prepares only requested declarations without changing unrelated frozen team facts', async () => {
  const { store, project, requirement } = await fixture(true)
  const agent = store.agents.get('agent-1')
  await store.agents.put(agent.id, { ...agent, capabilities: [...agent.capabilities, 'data.change'] })
  await store.capabilityDefinitions.put('data.change', { id: 'data.change', status: 'active', version: 1 })
  const stage = new AssignmentStage(store)
  await stage.ensureCapabilityDefinitions([requirement], now)
  const claims = [...store.agentCapabilityClaims.entries()].map(([, claim]) => claim)
  assert.equal(claims.some(claim => claim.capabilityId === 'data.change'), false)
  assert.equal(claims.some(claim => claim.capabilityId === 'language.typescript' && claim.status === 'pending'), true)
  await stage.prepareCapabilityDeclarations(project.id, ['data.change'], now)
  const prepared = [...store.agentCapabilityClaims.entries()].map(([, claim]) => claim)
  assert.equal(prepared.filter(claim => claim.capabilityId === 'data.change').length, 1)
  assert.equal(prepared.find(claim => claim.capabilityId === 'data.change').source, 'legacy_pending_mapping')
  assert.equal(prepared.find(claim => claim.capabilityId === 'data.change').status, 'pending')
})

test('AssignmentStage selects a trusted Agent with current repository access', async () => {
  const { store, capability, access, assignment } = await runAssignmentStage(true)
  assert.deepEqual(capability.activeClaimIds, ['claim-trusted'])
  assert.equal(access.grantIds.includes('resource-grant:project-1:agent-1:repository'), true)
  assert.equal(assignment.evaluations[0].outcome, 'selected')
  assert.equal(assignment.drafts[0].executingAgentId, 'agent-1')
  assert.equal(assignment.drafts[0].dispatchStatus, 'dispatchable')
  assert.equal(store.resourceAccessGrants.get('resource-grant:project-1:agent-1:repository').grantDigest.length, 64)
})

test('AssignmentStage rejects a capability snapshot from another Planning operation before writing assignments', async () => {
  const { store, project, requirement, target, repository } = await fixture(true)
  const stage = new AssignmentStage(store)
  await stage.ensureCapabilityDefinitions([requirement], now)
  const capability = await stage.captureCapabilityCatalog(project.id, 'operation-1', now)
  const access = await stage.captureAccessGrants(project, 'operation-1', repository, target, now, () => 'b'.repeat(64))
  await assert.rejects(
    () => stage.qualify([requirement], { ...capability, operationId: 'other-operation' }, access, { projectId: project.id, operationId: 'operation-1', metricPolicyId: 'policy-1', metricPolicyVersion: '1', metricPolicyDigest: 'c'.repeat(64), risk: 'medium', now }),
    (error) => error.code === 'assignment-stage-stale',
  )
  assert.equal([...store.assignmentDrafts.entries()].length, 0)
  assert.equal([...store.assignmentEvaluations.entries()].length, 0)
})
