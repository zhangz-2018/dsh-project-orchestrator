import type { OrchestratorStore } from '../storage.js'
import type {
  AgentCapabilityClaimRecord,
  CapabilityDefinitionRecord,
  CapabilityRequirementDraftRecord,
  CanonicalTargetBindingRecord,
  ProjectAccessGrantSnapshotRecord,
  ProjectAgentMembershipRecord,
  ProjectCapabilityCatalogSnapshotRecord,
  ProjectRecord,
  RepositoryContextSnapshotV3Record,
  ResourceAccessGrantRecord,
} from '../types.js'
import { digestObject, qualifyAssignmentsV3, WorkflowError, type AssignmentCandidateV3 } from '../workflow.js'

type AssignmentStageStore = Pick<OrchestratorStore,
  'projects' | 'projectAgentMemberships' | 'agents' | 'capabilityDefinitions' | 'agentCapabilityClaims'
  | 'projectCapabilityCatalogSnapshots' | 'resourceAccessGrants' | 'projectAccessGrantSnapshots'
  | 'taskRuns' | 'runtimes' | 'assignmentDrafts' | 'assignmentEvaluations'>

export class AssignmentStage {
  constructor(private readonly store: AssignmentStageStore) {}

  private activeMemberships(projectId: string): ProjectAgentMembershipRecord[] {
    if (this.store.projects.get(projectId) === undefined) throw new WorkflowError('project-not-found', `Project "${projectId}" was not found.`, 404)
    return [...this.store.projectAgentMemberships.entries()]
      .map(([, membership]) => membership)
      .filter((membership) => membership.projectId === projectId && membership.status === 'active')
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
  }

  async ensureCapabilityDefinitions(requirements: CapabilityRequirementDraftRecord[], now: string): Promise<void> {
    await this.prepareCapabilityDeclarations(requirements[0]?.projectId ?? '', [...new Set(requirements.flatMap((item) => item.requiredCapabilities))], now)
  }

  async prepareCapabilityDeclarations(projectId: string, capabilityIds: string[], now: string): Promise<void> {
    const memberships = this.activeMemberships(projectId)
    const requested = new Set(capabilityIds)
    const roles = ['planner', 'lead', 'implementer', 'verifier', 'reviewer', 'specialist', 'release'] as const
    for (const capabilityId of [...new Set(capabilityIds)].sort()) {
      const existing = this.store.capabilityDefinitions.get(capabilityId)
      if (existing?.status === 'active') continue
      const core = { id: capabilityId, version: 1, key: capabilityId, displayName: capabilityId, description: `Service-controlled Planning V3 capability ${capabilityId}.`, parentCapabilityIds: [], compatibleRoleIds: [...roles], status: 'active' as const }
      const definition: CapabilityDefinitionRecord = { ...core, definitionDigest: digestObject(core) }
      await this.store.capabilityDefinitions.put(definition.id, definition)
    }
    for (const membership of memberships) {
      const agent = this.store.agents.get(membership.agentId)
      for (const capabilityId of agent?.capabilities ?? []) {
        if (!requested.has(capabilityId) || !/^[a-z][a-z0-9._-]{0,159}$/u.test(capabilityId) || this.store.capabilityDefinitions.get(capabilityId) === undefined) continue
        const id = `capability-claim:${membership.projectId}:${agent!.id}:${capabilityId}`
        if (this.store.agentCapabilityClaims.get(id) !== undefined) continue
        const core = { projectId: membership.projectId, agentId: agent!.id, capabilityId, capabilityVersion: 1, source: 'legacy_pending_mapping' as const, status: 'pending' as const, validFrom: now }
        const claim: AgentCapabilityClaimRecord = { id, ...core, claimDigest: digestObject(core) }
        await this.store.agentCapabilityClaims.put(id, claim)
      }
    }
  }

  async captureCapabilityCatalog(projectId: string, operationId: string, now: string): Promise<ProjectCapabilityCatalogSnapshotRecord> {
    const memberships = this.activeMemberships(projectId)
    const memberIds = new Set(memberships.map((item) => item.agentId))
    const definitions = [...this.store.capabilityDefinitions.entries()].map(([, item]) => item).filter((item) => item.status === 'active')
    const claims = [...this.store.agentCapabilityClaims.entries()].map(([, item]) => item).filter((item) => memberIds.has(item.agentId) && (item.projectId === undefined || item.projectId === projectId) && item.status !== 'revoked' && item.status !== 'expired')
    const core = {
      projectId, operationId, definitionVersions: definitions.map((item) => ({ capabilityId: item.id, version: item.version })).sort((left, right) => left.capabilityId.localeCompare(right.capabilityId)),
      activeClaimIds: claims.filter((item) => item.status === 'active').map((item) => item.id).sort(), pendingMappingClaimIds: claims.filter((item) => item.status === 'pending').map((item) => item.id).sort(),
      projectMembershipDigest: digestObject(memberships.map((item) => ({ agentId: item.agentId, deliveryRoles: item.deliveryRoles, autoAssignable: item.autoAssignable, updatedAt: item.updatedAt }))), catalogPolicyVersion: 'v3.1',
    }
    const snapshot: ProjectCapabilityCatalogSnapshotRecord = { id: `capability-snapshot:${operationId}`, ...core, capabilityCatalogDigest: digestObject(core), createdAt: now }
    await this.store.projectCapabilityCatalogSnapshots.put(snapshot.id, snapshot)
    return snapshot
  }

  async captureAccessGrants(project: ProjectRecord, operationId: string, repository: RepositoryContextSnapshotV3Record, canonicalTarget: CanonicalTargetBindingRecord, now: string, teamDigest: () => string): Promise<ProjectAccessGrantSnapshotRecord> {
    const repositoryIdentityDigest = canonicalTarget.repositoryIdentityDigest
    const memberships = this.activeMemberships(project.id)
    const grants: ResourceAccessGrantRecord[] = []
    for (const membership of memberships) {
      const id = `resource-grant:${project.id}:${membership.agentId}:repository`
      const existing = this.store.resourceAccessGrants.get(id)
      const core = {
        projectId: project.id, principalType: 'agent' as const, principalId: membership.agentId, resourceId: canonicalTarget.resourceId, repositoryIdentityDigest,
        permissions: ['evidence_read', 'repository_read', 'worktree_write', 'command_execute', 'artifact_write'] as Array<'evidence_read' | 'repository_read' | 'worktree_write' | 'command_execute' | 'artifact_write'>,
        pathScopes: ['.'], commandIds: repository.verifiedCommands, grantedBy: membership.joinedBy, grantSource: 'project_membership' as const, validFrom: existing?.validFrom ?? now,
        reason: 'Active project membership grants bounded access to the project repository only.',
      }
      const grant: ResourceAccessGrantRecord = { id, ...core, grantDigest: digestObject(core) }
      await this.store.resourceAccessGrants.put(id, grant)
      grants.push(grant)
    }
    const integrationGrant = this.store.resourceAccessGrants.get(canonicalTarget.integrationGrantId)
    if (integrationGrant === undefined || integrationGrant.principalType !== 'integration_service' || integrationGrant.principalId !== canonicalTarget.integrationPrincipalId || integrationGrant.resourceId !== canonicalTarget.resourceId || integrationGrant.repositoryIdentityDigest !== repositoryIdentityDigest || !integrationGrant.permissions.includes('canonical_integrate') || integrationGrant.revokedAt !== undefined) {
      throw new WorkflowError('canonical-integration-grant-missing', 'The canonical target does not have a current Integration Service grant.', 409)
    }
    grants.push(integrationGrant)
    const core = { projectId: project.id, operationId, grantIds: grants.map((item) => item.id).sort(), resourceDigest: repositoryIdentityDigest, teamDigest: teamDigest() }
    const snapshot: ProjectAccessGrantSnapshotRecord = { id: `access-snapshot:${operationId}`, ...core, snapshotDigest: digestObject(core), createdAt: now }
    await this.store.projectAccessGrantSnapshots.put(snapshot.id, snapshot)
    return snapshot
  }

  private assignmentCandidates(projectId: string, capabilitySnapshot: ProjectCapabilityCatalogSnapshotRecord, accessSnapshot: ProjectAccessGrantSnapshotRecord): AssignmentCandidateV3[] {
    const activeClaims = capabilitySnapshot.activeClaimIds.map((id) => this.store.agentCapabilityClaims.get(id)).filter((item): item is AgentCapabilityClaimRecord => item !== undefined)
    const pendingClaims = capabilitySnapshot.pendingMappingClaimIds.map((id) => this.store.agentCapabilityClaims.get(id)).filter((item): item is AgentCapabilityClaimRecord => item !== undefined)
    const accessAgentIds = new Set(accessSnapshot.grantIds.map((id) => this.store.resourceAccessGrants.get(id)).filter((item): item is ResourceAccessGrantRecord => item !== undefined && item.revokedAt === undefined).map((item) => item.principalId))
    return this.activeMemberships(projectId).flatMap((membership) => {
      const agent = this.store.agents.get(membership.agentId)
      if (agent?.status !== 'active') return []
      const runtime = agent.runtimeId === undefined ? undefined : this.store.runtimes.get(agent.runtimeId)
      const occupied = [...this.store.taskRuns.entries()].filter(([, run]) => run.agentId === agent.id && ['dispatched', 'running'].includes(run.status)).length
      const claims = [...activeClaims, ...pendingClaims].filter((item) => item.agentId === agent.id)
      return [{
        agentId: agent.id, activeMembership: true, autoAssignable: membership.autoAssignable, deliveryRoles: membership.deliveryRoles ?? [], claimedCapabilityIds: [...new Set(claims.map((item) => item.capabilityId))],
        trustedCapabilityIds: [...new Set(activeClaims.filter((item) => item.agentId === agent.id && (item.source === 'human_confirmed' || item.source === 'managed_registry')).map((item) => item.capabilityId))],
        repositoryAccess: accessAgentIds.has(agent.id), runtimeCompatible: agent.runtimeId === undefined || runtime?.lifecycle === 'active', runtimeStatus: agent.runtimeId === undefined ? 'online' as const : runtime?.status ?? 'offline' as const,
        availableSlots: Math.max(0, (agent.maxConcurrency ?? 1) - occupied), affinityScore: membership.deliveryRoles?.length ?? 0,
      }]
    })
  }

  async qualify(requirements: CapabilityRequirementDraftRecord[], capabilitySnapshot: ProjectCapabilityCatalogSnapshotRecord, accessSnapshot: ProjectAccessGrantSnapshotRecord, input: Parameters<typeof qualifyAssignmentsV3>[2]): Promise<ReturnType<typeof qualifyAssignmentsV3>> {
    if (capabilitySnapshot.projectId !== input.projectId || capabilitySnapshot.operationId !== input.operationId
      || accessSnapshot.projectId !== input.projectId || accessSnapshot.operationId !== input.operationId
      || requirements.some((requirement) => requirement.projectId !== input.projectId || requirement.operationId !== input.operationId)) {
      throw new WorkflowError('assignment-stage-stale', 'Assignment inputs do not belong to the same frozen Planning operation.', 409)
    }
    const candidates = this.assignmentCandidates(input.projectId, capabilitySnapshot, accessSnapshot)
    const assignment = qualifyAssignmentsV3(requirements, candidates, input)
    for (const draft of assignment.drafts) await this.store.assignmentDrafts.put(draft.id, draft)
    for (const evaluation of assignment.evaluations) await this.store.assignmentEvaluations.put(evaluation.id, evaluation)
    return assignment
  }
}
