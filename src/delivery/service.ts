import { mkdtemp, realpath, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, matchesGlob, posix } from 'node:path'
import type { OrchestratorStore } from '../storage.js'
import type {
  AcceptanceScenarioRecord,
  ActivityEvent,
  CanonicalTargetBindingRecord,
  ConvergenceRepairBaselineRecord,
  ConvergenceRepairCarryItemRecord,
  DeliveryConvergenceFindingRecord,
  DeliveryConvergenceReviewRecord,
  DeliveryIntegrationIntentRecord,
  DeliveryIntegrationSnapshotRecord,
  DeliveryRecord,
  DeliveryResponsibilityChain,
  IntegrationInclusionEvidenceRecord,
  ProjectRecord,
  ProjectReviewRecord,
  RepositoryContextSnapshotV3Record,
  RunRecord,
  TaskRunRecord,
  VerificationEvidenceRecord,
} from '../types.js'
import { boundedText, digestObject, WorkflowError } from '../workflow.js'
import { gitProcess } from '../execution/git-command.js'
import { gitCommitEvidence } from './git-evidence.js'

const WORKTREE_CLEANUP_TIMEOUT_MS = 10_000

function immutableRecordDigestMatches(record: object, digestField: string, timestampFields: string[] = ['createdAt']): boolean {
  const core = { ...record } as Record<string, unknown>
  const expected = core[digestField]
  delete core.id
  for (const field of timestampFields) delete core[field]
  delete core[digestField]
  return typeof expected === 'string' && digestObject(core) === expected
}

function normalizeRepositoryRelativePath(value: string): string | undefined {
  const normalized = posix.normalize(value.trim().replaceAll('\\', '/').replace(/^\.\//u, ''))
  if (normalized === '' || normalized === '.' || normalized === '..' || normalized.startsWith('../') || normalized.startsWith('/') || /^[a-zA-Z]:\//u.test(normalized)) return undefined
  return normalized
}

function pathMatchesScope(file: string, scope: string): boolean {
  const normalizedFile = normalizeRepositoryRelativePath(file)
  const rawScope = scope.trim().replaceAll('\\', '/')
  if (rawScope === '.' || rawScope === './') return normalizedFile !== undefined
  const normalizedScope = normalizeRepositoryRelativePath(scope)
  if (normalizedFile === undefined || normalizedScope === undefined) return false
  if (/[*?\[\]{}]/u.test(normalizedScope)) {
    try { return matchesGlob(normalizedFile, normalizedScope) } catch { return false }
  }
  return normalizedFile === normalizedScope || normalizedFile.startsWith(`${normalizedScope.replace(/\/$/u, '')}/`)
}

function deliveryIntegrationIntentCore(intent: Pick<DeliveryIntegrationIntentRecord,
  'schemaVersion' | 'projectId' | 'approvedPlanSnapshotId' | 'integrationSnapshotId' | 'sequence' | 'taskId' | 'taskRunId'
  | 'repositoryIdentityDigest' | 'targetRef' | 'recoveryRef' | 'beforeCommit' | 'beforeTree' | 'afterCommit' | 'afterTree' | 'evidence' | 'output'>) {
  return {
    schemaVersion: intent.schemaVersion,
    projectId: intent.projectId,
    approvedPlanSnapshotId: intent.approvedPlanSnapshotId,
    integrationSnapshotId: intent.integrationSnapshotId,
    sequence: intent.sequence,
    taskId: intent.taskId,
    taskRunId: intent.taskRunId,
    repositoryIdentityDigest: intent.repositoryIdentityDigest,
    targetRef: intent.targetRef,
    recoveryRef: intent.recoveryRef,
    beforeCommit: intent.beforeCommit,
    beforeTree: intent.beforeTree,
    afterCommit: intent.afterCommit,
    afterTree: intent.afterTree,
    evidence: intent.evidence,
    output: intent.output,
  }
}

function deliveryIntegrationSnapshotDigestMatches(record: DeliveryIntegrationSnapshotRecord): boolean {
  const core = { ...record } as Record<string, unknown>
  delete core.id
  delete core.integrationDigest
  delete core.createdAt
  return digestObject(core) === record.integrationDigest
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

export interface ProjectDeliveryProjection {
  project: ProjectRecord
  evidence: VerificationEvidenceRecord[]
  review?: ProjectReviewRecord
  delivery?: DeliveryRecord
  ready: boolean
  blockers: string[]
}

export type DeliveryActivityInput = Omit<ActivityEvent, 'id' | 'createdAt' | 'metadata'> & { id?: string; createdAt?: string; metadata?: Record<string, unknown> }

export interface DeliveryServiceDependencies {
  serializedMutation: <T>(operation: () => Promise<T>) => Promise<T>
  recordActivity: (input: DeliveryActivityInput) => Promise<void>
  inspectCanonicalTarget: (cwd: string, targetRef: string) => Promise<{ head: string; status: string }>
  captureRepositorySnapshot: (project: ProjectRecord, operationId: string) => Promise<{ snapshot: RepositoryContextSnapshotV3Record }>
  runGit?: typeof gitProcess
}

export class DeliveryService {
  constructor(
    private readonly store: OrchestratorStore,
    private readonly dependencies: DeliveryServiceDependencies,
  ) {}

  private runGit(...args: Parameters<typeof gitProcess>): ReturnType<typeof gitProcess> {
    return (this.dependencies.runGit ?? gitProcess)(...args)
  }

  private async settleDeliveryAudit(record: DeliveryRecord): Promise<DeliveryRecord> {
    let current = record
    for (const type of record.pendingAuditEvents ?? []) {
      const input: DeliveryActivityInput = type === 'project.delivery_confirmed'
        ? {
          id: `activity:${type}:${record.id}`,
          projectId: record.projectId,
          actorType: 'human',
          actorId: record.deliveredBy,
          type,
          message: 'Project delivery was confirmed by a human reviewer.',
          metadata: { reviewId: record.reviewId, deliveryId: record.id },
          createdAt: record.deliveredAt ?? record.createdAt,
        }
        : {
          id: `activity:${type}:${record.id}`,
          projectId: record.projectId,
          actorType: 'human',
          actorId: record.closedBy,
          type,
          message: 'Project delivery was closed.',
          metadata: { deliveryId: record.id },
          createdAt: record.closedAt ?? record.createdAt,
        }
      try {
        await this.dependencies.recordActivity(input)
        current = await this.dependencies.serializedMutation(async () => {
          const latest = this.store.deliveryRecords.get(record.id)
          if (latest === undefined || !latest.pendingAuditEvents?.includes(type)) return latest ?? current
          const settled = { ...latest, pendingAuditEvents: latest.pendingAuditEvents.filter((event: 'project.delivery_confirmed' | 'project.delivery_closed') => event !== type) }
          await this.putDeliveryRecord(settled)
          return settled
        })
      } catch {
        return this.store.deliveryRecords.get(record.id) ?? record
      }
    }
    return current
  }

  async reconcilePendingDeliveryAudits(): Promise<void> {
    const pending = [...this.store.deliveryRecords.entries()]
      .map(([, record]) => record)
      .filter((record) => (record.pendingAuditEvents?.length ?? 0) > 0)
      .sort((left, right) => left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id))
    for (const record of pending) await this.settleDeliveryAudit(record)
  }

  getProjectDelivery(id: string): ProjectDeliveryProjection {
    const project = this.requireProject(id)
    const evidence = this.listProjectVerificationEvidence(id)
    const review = this.listProjectReviews(id).find((item) => item.revision === project.revision)
    const delivery = this.listProjectDeliveryRecords(id).find((item) => item.revision === project.revision)
    const blockers: string[] = []
    const latestByTask = new Map<string, VerificationEvidenceRecord>()
    const unscopedEvidence: VerificationEvidenceRecord[] = []
    for (const item of evidence) {
      if (item.taskId === undefined) unscopedEvidence.push(item)
      else {
        const current = latestByTask.get(item.taskId)
        if (current === undefined || (item.attempt ?? 0) > (current.attempt ?? 0) || ((item.attempt ?? 0) === (current.attempt ?? 0) && item.createdAt > current.createdAt)) latestByTask.set(item.taskId, item)
      }
    }
    const evaluatedEvidence = [...latestByTask.values(), ...unscopedEvidence]
    if (project.deliveryStage !== 'delivery_ready' && project.deliveryStage !== 'delivered' && project.deliveryStage !== 'closed') blockers.push(`Project delivery stage is ${project.deliveryStage ?? 'unknown'}.`)
    if (evidence.length === 0) blockers.push('No project verification evidence has been recorded.')
    if (evaluatedEvidence.some((item) => item.status !== 'passed')) blockers.push('The latest verification evidence for at least one task did not pass.')
    if (review === undefined) blockers.push('Project review has not been created.')
    else if (review.status !== 'pending' && review.status !== 'approved' && review.status !== 'waived') blockers.push(`Project review is ${review.status}.`)
    if (delivery === undefined) blockers.push('Delivery record has not been created.')
    if (project.planningContractVersion === 3) {
      const integration = project.currentDeliveryIntegrationSnapshotId === undefined ? undefined : this.store.deliveryIntegrationSnapshots.get(project.currentDeliveryIntegrationSnapshotId)
      const convergence = project.currentDeliveryConvergenceReviewId === undefined ? undefined : this.store.deliveryConvergenceReviews.get(project.currentDeliveryConvergenceReviewId)
      const unresolvedIntents = this.store.unresolvedDeliveryIntegrationIntents(id)
      if (unresolvedIntents.length > 0) blockers.push(`${unresolvedIntents.length} Delivery Integration intent(s) require reconciliation.`)
      if (integration === undefined || integration.status !== 'ready' || integration.finalCommit === undefined || integration.casStatus !== 'matched' || !integration.targetClean || integration.approvedPlanSnapshotId !== project.currentPlanSnapshotId) blockers.push('Current V3 canonical Integration snapshot is missing, stale, or not ready.')
      if (convergence === undefined || convergence.status !== 'converged' || convergence.approvedPlanSnapshotId !== project.currentPlanSnapshotId || convergence.deliveryIntegrationSnapshotId !== integration?.id || convergence.integratedFinalCommit !== integration?.finalCommit) blockers.push('Current V3 Delivery Convergence review is missing, stale, or not converged.')
    }
    return { project, evidence, ...(review === undefined ? {} : { review }), ...(delivery === undefined ? {} : { delivery }), ready: blockers.length === 0, blockers }
  }

  listProjectVerificationEvidence(id: string): VerificationEvidenceRecord[] {
    this.requireProject(id)
    return [...this.store.verificationEvidence.entries()]
      .map(([, record]) => record)
      .filter((record) => record.projectId === id)
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
  }

  listProjectReviews(id: string): ProjectReviewRecord[] {
    this.requireProject(id)
    return [...this.store.projectReviews.entries()]
      .map(([, record]) => record)
      .filter((record) => record.projectId === id)
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
  }

  listProjectDeliveryRecords(id: string): DeliveryRecord[] {
    this.requireProject(id)
    return [...this.store.deliveryRecords.entries()]
      .map(([, record]) => record)
      .filter((record) => record.projectId === id)
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
  }

  private assertIntegrationIntent(intent: DeliveryIntegrationIntentRecord, expected: {
    projectId: string
    planSnapshotId: string
    integrationId: string
    sequence: number
    taskId: string
    taskRunId: string
    repositoryIdentityDigest: string
    targetRef: string
    beforeCommit: string
    beforeTree: string
  }): void {
    if (digestObject(deliveryIntegrationIntentCore(intent)) !== intent.intentDigest
      || intent.projectId !== expected.projectId
      || intent.approvedPlanSnapshotId !== expected.planSnapshotId
      || intent.integrationSnapshotId !== expected.integrationId
      || intent.sequence !== expected.sequence
      || intent.taskId !== expected.taskId
      || intent.taskRunId !== expected.taskRunId
      || intent.repositoryIdentityDigest !== expected.repositoryIdentityDigest
      || intent.targetRef !== expected.targetRef
      || intent.beforeCommit !== expected.beforeCommit
      || intent.beforeTree !== expected.beforeTree) {
      throw new WorkflowError('delivery-integration-intent-conflict', 'The persisted Integration intent is corrupt or belongs to a different frozen transition.', 409)
    }
  }

  private async putIntegrationIntentState(intent: DeliveryIntegrationIntentRecord, status: DeliveryIntegrationIntentRecord['status'], error?: { code: string; message: string }): Promise<DeliveryIntegrationIntentRecord> {
    const now = new Date().toISOString()
    const next: DeliveryIntegrationIntentRecord = {
      ...intent,
      status,
      updatedAt: now,
      ...(status === 'committed' ? { completedAt: intent.completedAt ?? now } : {}),
      ...(error === undefined ? {} : { errorCode: error.code, error: error.message.slice(0, 20_000) }),
    }
    if (error === undefined) {
      delete next.errorCode
      delete next.error
    }
    await this.store.deliveryIntegrationIntents.put(next.id, next)
    return next
  }

  private async ensureIntegrationRecoveryRef(canonicalRoot: string, intent: DeliveryIntegrationIntentRecord): Promise<void> {
    if (intent.beforeCommit === intent.afterCommit) return
    let current: string | undefined
    try { current = (await this.runGit(canonicalRoot, ['rev-parse', '--verify', intent.recoveryRef])).trim() } catch { /* create below */ }
    if (current !== undefined && current !== intent.afterCommit) throw new WorkflowError('delivery-integration-intent-conflict', 'The Integration recovery ref points to a different commit.', 409)
    if (current === undefined) await this.runGit(canonicalRoot, ['update-ref', intent.recoveryRef, intent.afterCommit, '0000000000000000000000000000000000000000'])
  }

  private async settleCanonicalWorktree(canonicalRoot: string, intent: DeliveryIntegrationIntentRecord): Promise<void> {
    const actualAfterTree = (await this.runGit(canonicalRoot, ['rev-parse', `${intent.afterCommit}^{tree}`])).trim()
    if (actualAfterTree !== intent.afterTree) throw new WorkflowError('delivery-integration-intent-conflict', 'The frozen Integration commit no longer resolves to the expected tree.', 409)
    const indexTree = (await this.runGit(canonicalRoot, ['write-tree'])).trim()
    const [worktreeDiff, untracked] = await Promise.all([
      this.runGit(canonicalRoot, ['diff', '--name-only', '-z'], 120_000, 8_500_000, true),
      this.runGit(canonicalRoot, ['ls-files', '--others', '--exclude-standard', '-z'], 120_000, 8_500_000, true),
    ])
    if (worktreeDiff.length > 0 || untracked.length > 0 || (indexTree !== intent.beforeTree && indexTree !== intent.afterTree)) {
      throw new WorkflowError('delivery-integration-reconciliation-manual', 'The canonical worktree changed after Integration CAS and cannot be reset automatically.', 409)
    }
    if (indexTree === intent.beforeTree && intent.beforeTree !== intent.afterTree) await this.runGit(canonicalRoot, ['reset', '--hard', intent.afterCommit], 120_000, 8_500_000, true)
    const status = await this.runGit(canonicalRoot, ['status', '--porcelain=v1', '--untracked-files=all'], 120_000, 2_000_000, true)
    if (status.trim() !== '') throw new WorkflowError('delivery-integration-reconciliation-manual', 'The canonical worktree is not clean after Integration recovery.', 409)
  }

  private async reconcileIntegrationIntent(canonicalRoot: string, original: DeliveryIntegrationIntentRecord): Promise<DeliveryIntegrationIntentRecord> {
    if (original.status === 'manual_required') throw new WorkflowError('delivery-integration-reconciliation-manual', original.error ?? 'The Integration intent requires manual reconciliation.', 409)
    if (original.status === 'committed') {
      const evidence = this.store.integrationInclusionEvidence.get(original.evidence.id)
      if (evidence === undefined || !immutableRecordDigestMatches(evidence, 'evidenceDigest', []) || digestObject(evidence) !== digestObject(original.evidence)) throw new WorkflowError('delivery-integration-intent-conflict', 'Committed Integration evidence is missing or no longer matches its intent.', 409)
      if (original.beforeCommit !== original.afterCommit) {
        try { await this.runGit(canonicalRoot, ['update-ref', '-d', original.recoveryRef, original.afterCommit]) } catch { /* retry pruning on the next replay */ }
      }
      return original
    }

    let intent = original
    try {
      await this.ensureIntegrationRecoveryRef(canonicalRoot, intent)
      let observed = (await this.runGit(canonicalRoot, ['rev-parse', intent.targetRef])).trim()
      if (observed !== intent.beforeCommit && observed !== intent.afterCommit) throw new WorkflowError('delivery-integration-reconciliation-manual', 'The canonical target moved outside the frozen Integration transition.', 409)
      if (observed === intent.beforeCommit && intent.beforeCommit !== intent.afterCommit) {
        const status = await this.runGit(canonicalRoot, ['status', '--porcelain=v1', '--untracked-files=all'], 120_000, 2_000_000, true)
        const beforeTree = (await this.runGit(canonicalRoot, ['rev-parse', `${observed}^{tree}`])).trim()
        if (status.trim() !== '') throw new WorkflowError('delivery-integration-target-dirty', 'Canonical integration requires a clean target worktree.', 409)
        if (beforeTree !== intent.beforeTree) throw new WorkflowError('delivery-integration-reconciliation-manual', 'The canonical target tree no longer matches the frozen Integration input.', 409)
        await this.runGit(canonicalRoot, ['update-ref', intent.targetRef, intent.afterCommit, intent.beforeCommit])
        observed = intent.afterCommit
      }
      if (observed !== intent.afterCommit) throw new WorkflowError('delivery-integration-reconciliation-manual', 'The canonical target did not reach the frozen Integration output.', 409)
      await this.settleCanonicalWorktree(canonicalRoot, intent)
      intent = await this.putIntegrationIntentState(intent, 'ref_updated')

      const existingEvidence = this.store.integrationInclusionEvidence.get(intent.evidence.id)
      if (existingEvidence === undefined) await this.store.integrationInclusionEvidence.put(intent.evidence.id, intent.evidence)
      else if (!immutableRecordDigestMatches(existingEvidence, 'evidenceDigest', []) || digestObject(existingEvidence) !== digestObject(intent.evidence)) throw new WorkflowError('delivery-integration-intent-conflict', 'Existing Integration evidence conflicts with the frozen intent.', 409)

      intent = await this.putIntegrationIntentState(intent, 'committed')
      if (intent.beforeCommit !== intent.afterCommit) {
        try { await this.runGit(canonicalRoot, ['update-ref', '-d', intent.recoveryRef, intent.afterCommit]) } catch { /* stale recovery refs are harmless and can be pruned later */ }
      }
      return intent
    } catch (error) {
      let observed: string | undefined
      try { observed = (await this.runGit(canonicalRoot, ['rev-parse', intent.targetRef])).trim() } catch { /* recorded below */ }
      const manual = error instanceof WorkflowError && error.code === 'delivery-integration-reconciliation-manual'
        || observed !== undefined && observed !== intent.beforeCommit && observed !== intent.afterCommit
      const code = error instanceof WorkflowError ? error.code : 'delivery-integration-reconciliation-failed'
      const message = errorMessage(error)
      const status: DeliveryIntegrationIntentRecord['status'] = manual ? 'manual_required' : observed === intent.afterCommit && intent.afterCommit !== intent.beforeCommit ? 'ref_updated' : 'prepared'
      try { await this.putIntegrationIntentState(intent, status, { code, message }) } catch { /* the durable earlier state remains the recovery signal */ }
      if (manual) throw new WorkflowError('delivery-integration-reconciliation-manual', message, 409)
      if (observed === intent.beforeCommit && intent.beforeCommit !== intent.afterCommit && error instanceof WorkflowError) throw error
      throw new WorkflowError('delivery-integration-needs-reconciliation', `Integration intent ${intent.id} requires reconciliation: ${message}`, 500)
    }
  }

  expectedDispatchTargetHeadV3(projectId: string, target: CanonicalTargetBindingRecord): string {
    const reject = (): never => { throw new WorkflowError('execution-dispatch-stale', 'The canonical Integration transition is missing, corrupt, incomplete, or outside the approved plan.', 409) }
    const project = this.requireProject(projectId)
    const plan = project.currentPlanSnapshotId === undefined ? undefined : this.store.planSnapshots.get(project.currentPlanSnapshotId)
    if (plan === undefined || plan.projectId !== projectId || plan.status !== 'approved'
      || target.projectId !== projectId || plan.canonicalTargetBindingId !== target.id
      || plan.canonicalTargetBindingDigest !== target.bindingDigest) return reject()
    if (this.store.unresolvedDeliveryIntegrationIntents(projectId).length > 0) return reject()
    if (project.currentDeliveryIntegrationSnapshotId === undefined) return target.planningBaseCommit
    const integration: DeliveryIntegrationSnapshotRecord | undefined = this.store.deliveryIntegrationSnapshots.get(project.currentDeliveryIntegrationSnapshotId)
    if (integration === undefined || !deliveryIntegrationSnapshotDigestMatches(integration)
      || integration.projectId !== projectId || integration.approvedPlanSnapshotId !== plan.id
      || integration.canonicalTargetBindingId !== target.id || integration.canonicalTargetBindingDigest !== target.bindingDigest
      || integration.repositoryIdentityDigest !== target.repositoryIdentityDigest || integration.targetResourceId !== target.resourceId
      || integration.targetRef !== target.targetRef || integration.baseCommit !== target.planningBaseCommit
      || integration.expectedTargetHead !== target.planningBaseCommit || integration.accessGrantSnapshotId !== plan.accessGrantSnapshotId
      || integration.accessGrantSnapshotDigest !== plan.accessGrantDigest || !integration.targetClean
      || !['integrating', 'ready'].includes(integration.status) || integration.outputs.length === 0
      || new Set(integration.outputs.map((output) => output.taskId)).size !== integration.outputs.length) return reject()
    const intents = [...this.store.deliveryIntegrationIntents.entries()].map(([, item]) => item)
      .filter((item) => item.integrationSnapshotId === integration.id)
    if (intents.length !== integration.outputs.length) return reject()
    let expectedHead = target.planningBaseCommit
    let expectedTree: string | undefined
    for (const [index, output] of integration.outputs.entries()) {
      const task = this.store.tasks.get(output.taskId)
      const run = this.store.taskRuns.get(output.taskRunId)
      const intent = intents.find((item) => item.sequence === index + 1)
      const evidence = output.inclusionEvidenceIds.length === 1 ? this.store.integrationInclusionEvidence.get(output.inclusionEvidenceIds[0]!) : undefined
      if (output.sequence !== index + 1 || output.targetParentCommitBefore !== expectedHead
        || (expectedTree !== undefined && output.targetTreeBefore !== expectedTree) || output.status !== 'integrated'
        || !['verified', 'duplicate', 'no_code_change'].includes(output.inclusionStatus)
        || !plan.taskIds.includes(output.taskId) || task === undefined || task.projectId !== projectId
        || task.planSnapshotId !== plan.id || task.status !== 'completed' || task.testExitCode !== 0
        || run === undefined || run.projectId !== projectId || run.planSnapshotId !== plan.id || run.taskId !== task.id
        || run.status !== 'completed' || run.deliveryTaskRevision !== (task.taskRevision ?? 1)
        || run.canonicalTargetBindingId !== target.id || run.canonicalTargetBindingDigest !== target.bindingDigest
        || run.accessGrantSnapshotId !== plan.accessGrantSnapshotId || run.accessGrantSnapshotDigest !== plan.accessGrantDigest
        || run.actualBaseCommit === undefined || run.outputCommit === undefined || run.outputTree === undefined
        || run.outputDiffDigest === undefined || run.outputPatchIds === undefined || run.outputChangedPaths === undefined
        || run.actualBaseCommit !== output.baseCommit || run.outputCommit !== output.headCommit || run.outputDiffDigest !== output.diffDigest
        || digestObject(run.outputPatchIds) !== digestObject(output.patchIds)
        || evidence === undefined || !immutableRecordDigestMatches(evidence, 'evidenceDigest', [])
        || evidence.integrationSnapshotId !== integration.id || evidence.sequence !== output.sequence || evidence.taskId !== task.id
        || evidence.taskRevision !== (task.taskRevision ?? 1) || evidence.taskRunId !== run.id || evidence.result !== 'verified'
        || evidence.sourceHeadCommit !== run.outputCommit || evidence.sourceBaseCommit !== run.actualBaseCommit
        || evidence.sourceTree !== run.outputTree || evidence.sourceDiffDigest !== run.outputDiffDigest
        || digestObject(evidence.changedPaths) !== digestObject(run.outputChangedPaths)
        || digestObject(evidence.sourcePatchIds) !== digestObject(run.outputPatchIds)
        || intent === undefined || intent.status !== 'committed' || intent.completedAt === undefined
        || digestObject(intent.output) !== digestObject(output) || digestObject(intent.evidence) !== digestObject(evidence)) return reject()
      try {
        this.assertIntegrationIntent(intent, {
          projectId, planSnapshotId: plan.id, integrationId: integration.id, sequence: index + 1,
          taskId: task.id, taskRunId: run.id, repositoryIdentityDigest: target.repositoryIdentityDigest,
          targetRef: target.targetRef, beforeCommit: expectedHead, beforeTree: output.targetTreeBefore,
        })
      } catch { return reject() }
      expectedHead = output.targetCommitAfter
      expectedTree = output.targetTreeAfter
    }
    if (integration.status === 'ready' && (integration.finalCommit !== expectedHead
      || integration.observedTargetHeadAtFinalize !== expectedHead || integration.casStatus !== 'matched')) return reject()
    return expectedHead
  }

  async integrateCompletedTaskOutputsV3(projectId: string, finalize: boolean): Promise<DeliveryIntegrationSnapshotRecord> {
    const project = this.requireProject(projectId)
    if (project.planningContractVersion !== 3 || project.currentPlanSnapshotId === undefined) throw new WorkflowError('delivery-integration-not-v3', 'Canonical delivery integration is available only for a current V3 plan.', 409)
    const plan = this.store.planSnapshots.get(project.currentPlanSnapshotId)
    if (plan === undefined || plan.status !== 'approved' || plan.canonicalTargetBindingId === undefined || plan.canonicalTargetBindingDigest === undefined || plan.accessGrantSnapshotId === undefined || plan.accessGrantDigest === undefined) throw new WorkflowError('delivery-integration-stale', 'The approved V3 plan is missing frozen target or access facts.', 409)
    const target = this.store.canonicalTargetBindings.get(plan.canonicalTargetBindingId)
    const accessSnapshot = this.store.projectAccessGrantSnapshots.get(plan.accessGrantSnapshotId)
    const integrationGrant = target === undefined ? undefined : this.store.resourceAccessGrants.get(target.integrationGrantId)
    if (target === undefined || target.bindingDigest !== plan.canonicalTargetBindingDigest || accessSnapshot?.snapshotDigest !== plan.accessGrantDigest || integrationGrant === undefined || integrationGrant.principalType !== 'integration_service' || integrationGrant.principalId !== target.integrationPrincipalId || integrationGrant.resourceId !== target.resourceId || integrationGrant.repositoryIdentityDigest !== target.repositoryIdentityDigest || !integrationGrant.permissions.includes('canonical_integrate') || integrationGrant.revokedAt !== undefined) throw new WorkflowError('delivery-integration-stale', 'Canonical target or Integration Service authorization is missing, changed, or revoked.', 409)
    const canonicalRoot = await realpath(project.cwd)
    let symbolicRef: string
    try { symbolicRef = (await this.runGit(canonicalRoot, ['symbolic-ref', '-q', 'HEAD'])).trim() } catch { throw new WorkflowError('delivery-integration-target-detached', 'Canonical delivery target must remain the checked-out frozen branch.', 409) }
    if (symbolicRef !== target.targetRef) throw new WorkflowError('delivery-integration-target-ref-changed', 'The checked-out canonical branch no longer matches the frozen target ref.', 409)

    const integrationId = `delivery-integration:${projectId}:r${project.revision}`
    const existing = this.store.deliveryIntegrationSnapshots.get(integrationId)
    if (existing !== undefined && (!deliveryIntegrationSnapshotDigestMatches(existing) || existing.projectId !== projectId || existing.approvedPlanSnapshotId !== plan.id || existing.canonicalTargetBindingId !== target.id || existing.canonicalTargetBindingDigest !== target.bindingDigest || existing.repositoryIdentityDigest !== target.repositoryIdentityDigest || existing.targetRef !== target.targetRef)) throw new WorkflowError('delivery-integration-replay-conflict', 'The existing Integration snapshot is corrupt or belongs to different frozen inputs.', 409)
    if (existing?.status === 'ready') {
      const observed = (await this.runGit(canonicalRoot, ['rev-parse', target.targetRef])).trim()
      const status = await this.runGit(canonicalRoot, ['status', '--porcelain=v1', '--untracked-files=all'], 120_000, 2_000_000, true)
      if (existing.finalCommit !== observed || status.trim() !== '') throw new WorkflowError('delivery-integration-stale', 'The canonical target moved or became dirty after the ready Integration snapshot.', 409)
      const committedIntents = [...this.store.deliveryIntegrationIntents.entries()]
        .map(([, intent]) => intent)
        .filter((intent) => intent.integrationSnapshotId === existing.id && intent.status === 'committed')
        .sort((left, right) => left.sequence - right.sequence)
      for (const intent of committedIntents) await this.reconcileIntegrationIntent(canonicalRoot, intent)
      const current = this.requireProject(projectId)
      if (current.currentDeliveryIntegrationSnapshotId !== undefined && current.currentDeliveryIntegrationSnapshotId !== existing.id) throw new WorkflowError('delivery-integration-stale', 'A newer Integration snapshot is already current.', 409)
      if (current.currentDeliveryIntegrationSnapshotId === undefined) await this.store.projects.put(projectId, { ...current, currentDeliveryIntegrationSnapshotId: existing.id, deliveryStage: 'final_repository_snapshot', updatedAt: new Date().toISOString() })
      return existing
    }

    const tasks = this.store.projectTasks(project).sort((left, right) => left.ordinal - right.ordinal || left.id.localeCompare(right.id))
    const completedRuns = new Map<string, TaskRunRecord>()
    for (const task of tasks) {
      const run = [...this.store.taskRuns.entries()].map(([, item]) => item)
        .filter((item) => item.projectId === projectId && item.planSnapshotId === plan.id && item.taskId === task.id && item.status === 'completed')
        .sort((left, right) => (right.completedAt ?? '').localeCompare(left.completedAt ?? '') || right.id.localeCompare(left.id))[0]
      if (run !== undefined) completedRuns.set(task.id, run)
    }
    if (completedRuns.size === 0) throw new WorkflowError('delivery-integration-output-missing', 'No completed V3 TaskRun output is available for integration.', 409)
    if (finalize && completedRuns.size !== tasks.length) throw new WorkflowError('delivery-integration-output-missing', 'Every approved Task must have one completed current-plan TaskRun before final integration.', 409)
    for (const [taskId, run] of completedRuns) {
      const task = tasks.find((candidate) => candidate.id === taskId)!
      if (run.deliveryTaskRevision !== (task.taskRevision ?? 1) || run.canonicalTargetBindingId !== target.id || run.canonicalTargetBindingDigest !== target.bindingDigest || run.accessGrantSnapshotId !== accessSnapshot.id || run.accessGrantSnapshotDigest !== accessSnapshot.snapshotDigest || run.actualBaseCommit === undefined || run.outputCommit === undefined || run.outputTree === undefined || run.outputDiffDigest === undefined || run.outputPatchIds === undefined || run.outputChangedPaths === undefined) throw new WorkflowError('delivery-integration-output-stale', `TaskRun output for ${task.title} is incomplete or no longer matches the approved execution contract.`, 409)
    }

    const outputs = [...(existing?.outputs ?? [])]
    const integratedTaskIds = new Set(outputs.map((output) => output.taskId))
    let currentTarget = outputs.at(-1)?.targetCommitAfter ?? target.planningBaseCommit
    let currentTree = outputs.at(-1)?.targetTreeAfter ?? (await this.runGit(canonicalRoot, ['rev-parse', `${currentTarget}^{tree}`])).trim()
    for (const task of tasks) {
      const run = completedRuns.get(task.id)
      if (run === undefined || integratedTaskIds.has(task.id)) continue
      const sequence = outputs.length + 1
      const intentId = `${integrationId}:intent:${sequence}`
      let intent = this.store.deliveryIntegrationIntents.get(intentId)
      if (intent === undefined) {
        const observed = (await this.runGit(canonicalRoot, ['rev-parse', target.targetRef])).trim()
        const status = await this.runGit(canonicalRoot, ['status', '--porcelain=v1', '--untracked-files=all'], 120_000, 2_000_000, true)
        if (observed !== currentTarget) throw new WorkflowError('delivery-integration-target-moved', 'Canonical target head changed outside the current Integration sequence.', 409)
        if (status.trim() !== '') throw new WorkflowError('delivery-integration-target-dirty', 'Canonical integration requires a clean target worktree.', 409)

        const sourceBaseCommit = run.actualBaseCommit!
        const sourceHeadCommit = run.outputCommit!
        const sourcePatchIds = run.outputPatchIds!
        const changedPaths = run.outputChangedPaths!
        let targetCommitAfter = currentTarget
        let targetTreeAfter = currentTree
        let integrationMethod: DeliveryIntegrationSnapshotRecord['outputs'][number]['integrationMethod'] = 'no_code_change'
        let proofKind: IntegrationInclusionEvidenceRecord['proofKind'] = 'no_code_change'
        const audit = changedPaths.length === 0 ? { actor: target.integrationPrincipalId, reason: 'Recomputed TaskRun commit diff is empty.', at: new Date().toISOString() } : undefined
        let integrationParent: string | undefined
        let integrationWorktree: string | undefined
        try {
          if (changedPaths.length > 0) {
            integrationParent = await mkdtemp(join(tmpdir(), 'dsh-integration-'))
            integrationWorktree = join(integrationParent, 'worktree')
            await this.runGit(canonicalRoot, ['worktree', 'add', '--detach', integrationWorktree, currentTarget], 120_000, 8_500_000, true)
            await this.runGit(integrationWorktree, ['cherry-pick', '--no-commit', sourceHeadCommit], 120_000, 8_500_000, true)
            await this.runGit(integrationWorktree, [
              '-c', 'user.name=dsh-integration-service', '-c', 'user.email=dsh-integration@localhost', '-c', 'commit.gpgSign=false',
              'commit', '--no-gpg-sign', '--no-verify', '-m', `dsh: integrate ${task.id}`,
            ], 120_000, 8_500_000, true)
            targetCommitAfter = (await this.runGit(integrationWorktree, ['rev-parse', 'HEAD^{commit}'])).trim()
            const targetEvidence = await gitCommitEvidence(integrationWorktree, currentTarget, targetCommitAfter, (...args) => this.runGit(...args))
            targetTreeAfter = targetEvidence.tree
            const sourceAfter = changedPaths.map((item) => ({ path: item.path, afterBlob: item.afterBlob, afterMode: item.afterMode }))
            const targetAfter = targetEvidence.changedPaths.map((item) => ({ path: item.path, afterBlob: item.afterBlob, afterMode: item.afterMode }))
            if (JSON.stringify(sourcePatchIds) !== JSON.stringify(targetEvidence.patchIds) || JSON.stringify(sourceAfter) !== JSON.stringify(targetAfter)) throw new WorkflowError('delivery-integration-proof-failed', `Cherry-pick result for ${task.title} is not patch/tree equivalent to the immutable TaskRun output.`, 409)
            integrationMethod = 'cherry_pick'
            proofKind = sourceBaseCommit === currentTarget ? 'ancestor' : 'patch_hunk_tree_equivalence'
          }
          const evidenceCore = {
            integrationSnapshotId: integrationId, sequence, taskId: task.id, taskRevision: task.taskRevision ?? 1, taskRunId: run.id,
            sourceBaseCommit, sourceHeadCommit, sourceTree: run.outputTree!, sourceDiffDigest: run.outputDiffDigest!, sourcePatchIds, changedPaths,
            targetParentCommitBefore: currentTarget, targetTreeBefore: currentTree, targetCommitAfter, targetTreeAfter, proofKind,
            matchedPatchIds: sourcePatchIds, toolVersion: 'delivery-integration-v1', result: 'verified' as const,
          }
          const evidence: IntegrationInclusionEvidenceRecord = { id: `${integrationId}:evidence:${sequence}`, ...evidenceCore, evidenceDigest: digestObject(evidenceCore) }
          const output: DeliveryIntegrationIntentRecord['output'] = {
            sequence, taskId: task.id, taskRunId: run.id, baseCommit: sourceBaseCommit, headCommit: sourceHeadCommit,
            diffDigest: run.outputDiffDigest!, patchIds: sourcePatchIds, integrationMethod, status: 'integrated', targetParentCommitBefore: currentTarget, targetTreeBefore: currentTree,
            targetCommitAfter, targetTreeAfter, inclusionStatus: proofKind === 'no_code_change' ? 'no_code_change' : 'verified', inclusionEvidenceIds: [evidence.id],
            ...(audit === undefined ? {} : { audit }),
          }
          const recoveryRef = `refs/dsh-project-orchestrator/integration-intents/${digestObject({ integrationId, sequence, taskRunId: run.id }).slice(0, 40)}`
          const intentCore = {
            schemaVersion: 1 as const, projectId, approvedPlanSnapshotId: plan.id, integrationSnapshotId: integrationId, sequence, taskId: task.id, taskRunId: run.id,
            repositoryIdentityDigest: target.repositoryIdentityDigest, targetRef: target.targetRef, recoveryRef,
            beforeCommit: currentTarget, beforeTree: currentTree, afterCommit: targetCommitAfter, afterTree: targetTreeAfter, evidence, output,
          }
          const createdAt = new Date().toISOString()
          intent = { id: intentId, ...intentCore, status: 'prepared', intentDigest: digestObject(intentCore), createdAt, updatedAt: createdAt }
          await this.store.deliveryIntegrationIntents.put(intent.id, intent)
          try { await this.ensureIntegrationRecoveryRef(canonicalRoot, intent) } catch (error) {
            try { await this.store.deliveryIntegrationIntents.delete(intent.id) } catch { /* a prepared intent is still safe to inspect */ }
            throw error
          }
        } catch (error) {
          if (integrationWorktree !== undefined) {
            try { await this.runGit(integrationWorktree, ['cherry-pick', '--abort'], 30_000, 1_000_000, true) } catch { /* no active cherry-pick */ }
          }
          throw error
        } finally {
          if (integrationWorktree !== undefined) {
            try { await this.runGit(canonicalRoot, ['worktree', 'remove', '--force', integrationWorktree], WORKTREE_CLEANUP_TIMEOUT_MS, 1_000_000, true) } catch { /* recovery pruning runs on the next workspace claim */ }
          }
          if (integrationParent !== undefined) await rm(integrationParent, { recursive: true, force: true })
        }
      }
      this.assertIntegrationIntent(intent, {
        projectId, planSnapshotId: plan.id, integrationId, sequence, taskId: task.id, taskRunId: run.id,
        repositoryIdentityDigest: target.repositoryIdentityDigest, targetRef: target.targetRef, beforeCommit: currentTarget, beforeTree: currentTree,
      })
      intent = await this.reconcileIntegrationIntent(canonicalRoot, intent)
      outputs.push(intent.output)
      currentTarget = intent.afterCommit
      currentTree = intent.afterTree
    }

    if (finalize && outputs.length !== tasks.length) throw new WorkflowError('delivery-integration-output-missing', 'Final Integration does not contain exact-one output for every approved Task.', 409)
    const observedTargetHeadAtFinalize = (await this.runGit(canonicalRoot, ['rev-parse', target.targetRef])).trim()
    if (observedTargetHeadAtFinalize !== currentTarget) throw new WorkflowError('delivery-integration-target-moved', 'Canonical target moved before Integration finalization.', 409)
    const finalStatus = await this.runGit(canonicalRoot, ['status', '--porcelain=v1', '--untracked-files=all'], 120_000, 2_000_000, true)
    const targetClean = finalStatus.trim() === ''
    if (!targetClean) throw new WorkflowError('delivery-integration-target-dirty', 'Canonical target is not clean after Integration finalization.', 409)
    const core = {
      projectId, approvedPlanSnapshotId: plan.id, canonicalTargetBindingId: target.id, canonicalTargetBindingDigest: target.bindingDigest,
      accessGrantSnapshotId: accessSnapshot.id, accessGrantSnapshotDigest: accessSnapshot.snapshotDigest, targetResourceId: target.resourceId,
      repositoryIdentityDigest: target.repositoryIdentityDigest, targetRef: target.targetRef, baseCommit: target.planningBaseCommit,
      expectedTargetHead: target.planningBaseCommit, outputs, ...(finalize ? { finalCommit: currentTarget } : {}),
      ...(finalize ? { observedTargetHeadAtFinalize } : {}), casStatus: finalize ? 'matched' as const : 'pending' as const,
      targetClean, status: finalize ? 'ready' as const : 'integrating' as const,
    }
    const integration: DeliveryIntegrationSnapshotRecord = { id: integrationId, ...core, integrationDigest: digestObject(core), createdAt: existing?.createdAt ?? new Date().toISOString() }
    await this.store.deliveryIntegrationSnapshots.put(integration.id, integration)
    const currentProject = this.requireProject(projectId)
    if (currentProject.currentPlanSnapshotId !== plan.id || currentProject.revision !== project.revision || currentProject.currentDeliveryIntegrationSnapshotId !== undefined && currentProject.currentDeliveryIntegrationSnapshotId !== integration.id) throw new WorkflowError('delivery-integration-stale', 'Project delivery pointers changed before Integration commit.', 409)
    await this.store.projects.put(projectId, { ...currentProject, currentDeliveryIntegrationSnapshotId: integration.id, deliveryStage: finalize ? 'final_repository_snapshot' : 'integrating', updatedAt: new Date().toISOString() })
    return integration
  }

  async reviewDeliveryConvergenceV3(projectId: string, integration: DeliveryIntegrationSnapshotRecord): Promise<DeliveryConvergenceReviewRecord> {
    const project = this.requireProject(projectId)
    const plan = this.store.planSnapshots.get(integration.approvedPlanSnapshotId)
    if (plan === undefined || project.currentPlanSnapshotId !== plan.id || integration.status !== 'ready' || integration.finalCommit === undefined || integration.casStatus !== 'matched' || !integration.targetClean) throw new WorkflowError('delivery-convergence-stale', 'Convergence requires the current ready canonical Integration snapshot.', 409)
    const reviewId = `delivery-convergence:${projectId}:r${project.revision}`
    const replay = this.store.deliveryConvergenceReviews.get(reviewId)
    if (replay !== undefined) {
      const replayFindings = replay.findingIds.map((findingId: string) => this.store.deliveryConvergenceFindings.get(findingId) as DeliveryConvergenceFindingRecord | undefined)
      const replayBaseline = replay.repairBaselineId === undefined ? undefined : this.store.convergenceRepairBaselines.get(replay.repairBaselineId)
      const replayCarryItems = replayBaseline === undefined ? [] : replayBaseline.carryItemIds.map((carryItemId: string) => this.store.convergenceRepairCarryItems.get(carryItemId) as ConvergenceRepairCarryItemRecord | undefined)
      const findingsClosed = replayFindings.length === replay.findingIds.length
        && replayFindings.every((finding: DeliveryConvergenceFindingRecord | undefined) => finding !== undefined && finding.reviewId === replay.id)
        && digestObject((replayFindings as DeliveryConvergenceFindingRecord[]).map((finding) => finding.findingDigest).sort()) === replay.findingSetDigest
      const baselineClosed = replay.status === 'converged'
        ? replayBaseline === undefined
        : replayBaseline !== undefined
          && replayBaseline.parentConvergenceReviewId === replay.id
          && replayBaseline.findingSetDigest === replay.findingSetDigest
          && immutableRecordDigestMatches(replayBaseline, 'baselineDigest')
          && replayCarryItems.length === replayBaseline.carryItemIds.length
          && replayCarryItems.every((item: ConvergenceRepairCarryItemRecord | undefined) => item !== undefined && item.repairBaselineId === replayBaseline.id && immutableRecordDigestMatches(item, 'carryItemDigest'))
          && digestObject((replayCarryItems as ConvergenceRepairCarryItemRecord[]).sort((left, right) => left.carryItemDigest.localeCompare(right.carryItemDigest) || left.id.localeCompare(right.id)).map((item) => item.carryItemDigest)) === replayBaseline.carryItemSetDigest
      if (replay.projectId !== projectId || replay.approvedPlanSnapshotId !== plan.id || replay.deliveryIntegrationSnapshotId !== integration.id || replay.integratedFinalCommit !== integration.finalCommit || replay.integrationDigest !== integration.integrationDigest || !immutableRecordDigestMatches(replay, 'convergenceDigest') || !findingsClosed || !baselineClosed) throw new WorkflowError('delivery-convergence-replay-conflict', 'An existing Convergence review is corrupt or does not match the current immutable Integration input.', 409)
      const current = this.requireProject(projectId)
      if (current.currentDeliveryConvergenceReviewId !== undefined && current.currentDeliveryConvergenceReviewId !== replay.id) throw new WorkflowError('delivery-convergence-stale', 'A newer Convergence review is already current.', 409)
      if (current.currentDeliveryConvergenceReviewId === undefined) await this.store.projects.put(projectId, { ...current, currentDeliveryConvergenceReviewId: replay.id, ...(replayBaseline === undefined ? {} : { currentConvergenceRepairBaselineId: replayBaseline.id }), deliveryStage: replay.status === 'converged' ? 'review' : 'changes_required', updatedAt: new Date().toISOString() })
      return replay
    }
    const capture = await this.dependencies.captureRepositorySnapshot(project, `final-delivery:${integration.id}`)
    if (capture.snapshot.headCommit !== integration.finalCommit || (capture.snapshot.dirtyFiles?.length ?? 0) > 0) throw new WorkflowError('delivery-convergence-repository-stale', 'Final repository snapshot is not the clean integrated finalCommit.', 409)
    const subject = { kind: 'final_delivery' as const, deliveryIntegrationSnapshotId: integration.id, exactCommit: integration.finalCommit }
    const finalSnapshotCore = { ...capture.snapshot, id: `final-repository:${integration.id}`, subject }
    const finalRepositoryDigest = digestObject({ repositoryDigest: capture.snapshot.repositoryDigest, subject })
    const previousFinalSnapshot = this.store.repositorySnapshotsV3.get(finalSnapshotCore.id)
    const finalSnapshot: RepositoryContextSnapshotV3Record = { ...finalSnapshotCore, ...(previousFinalSnapshot === undefined ? {} : { createdAt: previousFinalSnapshot.createdAt }), repositoryDigest: finalRepositoryDigest }

    const tasks = this.store.projectTasks(project)
    const outputByTask = new Map(integration.outputs.map((output) => [output.taskId, output]))
    const includedRunIds = new Set(integration.outputs.map((output) => output.taskRunId))
    const verification = this.listProjectVerificationEvidence(projectId).filter((item) => item.planSnapshotId === plan.id && item.taskRunId !== undefined && includedRunIds.has(item.taskRunId))
    const verificationByTask = new Map<string, VerificationEvidenceRecord[]>()
    for (const evidence of verification) {
      if (evidence.taskId === undefined) continue
      verificationByTask.set(evidence.taskId, [...(verificationByTask.get(evidence.taskId) ?? []), evidence])
    }
    const findingInputs: Array<Omit<DeliveryConvergenceFindingRecord, 'id' | 'reviewId' | 'findingDigest'>> = []
    const addFinding = (finding: Omit<DeliveryConvergenceFindingRecord, 'id' | 'reviewId' | 'findingDigest'>): void => { findingInputs.push(finding) }
    for (const task of tasks) {
      const output = outputByTask.get(task.id)
      if (output === undefined || output.inclusionEvidenceIds.length !== 1) addFinding({ code: 'partial', severity: 'blocking', subjectType: 'task', subjectId: task.id, evidenceIds: [], message: 'Approved Task has no exact-one canonical integration output.' })
      const passed = (verificationByTask.get(task.id) ?? []).some((item) => item.status === 'passed' && item.taskRunId === output?.taskRunId)
      if (!passed) addFinding({ code: 'stale_verification', severity: 'blocking', subjectType: 'verification', subjectId: task.id, evidenceIds: (verificationByTask.get(task.id) ?? []).map((item) => item.id), message: 'Task verification is missing, failed, or does not belong to the integrated TaskRun output.' })
    }
    for (const output of integration.outputs) {
      const evidence = this.store.integrationInclusionEvidence.get(output.inclusionEvidenceIds[0] ?? '')
      if (evidence === undefined || evidence.integrationSnapshotId !== integration.id || evidence.taskRunId !== output.taskRunId || evidence.result !== 'verified' || !immutableRecordDigestMatches(evidence, 'evidenceDigest')) addFinding({ code: 'partial', severity: 'blocking', subjectType: 'integration_output', subjectId: output.taskRunId, evidenceIds: output.inclusionEvidenceIds, message: 'Integration inclusion evidence is missing, corrupt, failed, or belongs to another output.' })
    }
    const currentBundleIds = new Set(plan.requirementBundleIds ?? [])
    const acceptance = [...this.store.acceptanceCriteria.entries()].map(([, criterion]) => criterion).filter((criterion) => criterion.projectId === projectId && currentBundleIds.has(criterion.bundleId))
    for (const criterion of acceptance.filter((item) => item.required !== false && item.status !== 'verified')) addFinding({ code: 'unmet', severity: 'blocking', subjectType: 'requirement', subjectId: criterion.requirementItemId ?? criterion.id, evidenceIds: criterion.evidenceIds, message: `Required acceptance criterion ${criterion.key} is not verified on the integrated revision.` })
    const scenarios = (plan.acceptanceScenarioIds ?? []).map((id: string) => this.store.acceptanceScenarios.get(id) as AcceptanceScenarioRecord | undefined).filter((item: AcceptanceScenarioRecord | undefined): item is AcceptanceScenarioRecord => item !== undefined)
    for (const scenario of scenarios.filter((item: AcceptanceScenarioRecord) => item.required)) {
      const implementing = tasks.filter((task) => (task.scenarioIds ?? []).includes(scenario.id) && task.relationship === 'implementation')
      const verifying = tasks.filter((task) => (task.scenarioIds ?? []).includes(scenario.id) && ['verification', 'review'].includes(task.relationship ?? ''))
      if (implementing.length === 0 || verifying.length === 0 || verifying.some((task) => !(verificationByTask.get(task.id) ?? []).some((item) => item.status === 'passed'))) addFinding({ code: 'partial', severity: 'blocking', subjectType: 'scenario', subjectId: scenario.id, evidenceIds: [...implementing, ...verifying].map((task) => task.id), message: 'Required Scenario lacks integrated implementation plus current passing verification coverage.' })
    }
    for (const fulfillmentId of plan.policyFulfillmentIds ?? []) {
      const fulfillment = this.store.policyFulfillments.get(fulfillmentId)
      if (fulfillment === undefined || fulfillment.policyDigest !== plan.policyDigest || !immutableRecordDigestMatches(fulfillment, 'fulfillmentDigest')) addFinding({ code: 'policy_violation', severity: 'blocking', subjectType: 'policy', subjectId: fulfillmentId, evidenceIds: [], message: 'Approved MUST Policy fulfillment is missing, corrupt, or stale.' })
    }
    const changedPaths = [...new Set(integration.outputs.flatMap((output) => (this.store.taskRuns.get(output.taskRunId) as TaskRunRecord | undefined)?.outputChangedPaths?.map((item: { path: string }) => item.path) ?? []))].sort()
    const allowedScopes = tasks.flatMap((task) => task.assignmentPolicy?.allowedScope ?? [])
    const unrequested = changedPaths.filter((path) => allowedScopes.length === 0 || !allowedScopes.some((scope) => pathMatchesScope(path, scope)))
    for (const path of unrequested) addFinding({ code: 'unrequested', severity: 'blocking', subjectType: 'code_surface', subjectId: path, evidenceIds: integration.outputs.filter((output) => (this.store.taskRuns.get(output.taskRunId) as TaskRunRecord | undefined)?.outputChangedPaths?.some((item: { path: string }) => item.path === path)).map((output) => output.taskRunId), message: 'Integrated code surface is outside every approved Task change scope.' })
    const findings: DeliveryConvergenceFindingRecord[] = findingInputs.map((finding, index) => {
      const findingCore = { ...finding, evidenceIds: [...finding.evidenceIds].sort() }
      return { id: `${reviewId}:finding:${index + 1}`, reviewId, ...findingCore, findingDigest: digestObject(findingCore) }
    }).sort((left, right) => left.findingDigest.localeCompare(right.findingDigest) || left.id.localeCompare(right.id))
    const findingSetDigest = digestObject(findings.map((finding) => finding.findingDigest))
    const verificationEvidenceDigest = digestObject([...verification].sort((left, right) => left.id.localeCompare(right.id)).map((item) => ({ id: item.id, status: item.status, taskId: item.taskId, taskRunId: item.taskRunId, acceptanceIds: item.acceptanceIds, command: item.command, exitCode: item.exitCode })))
    const bindingDigest = digestObject({ approvedBindingDigest: digestObject((plan.planningOperationId === undefined ? [] : [...this.store.requirementCodeBindings.entries()].map(([, item]) => item).filter((item) => item.operationId === plan.planningOperationId)).map((item) => item.bindingDigest).sort()), finalRepositoryDigest, changedPaths })
    const repairBaselineId = findings.length === 0 ? undefined : `convergence-repair:${reviewId}:${findingSetDigest}`
    const carryItems: ConvergenceRepairCarryItemRecord[] = repairBaselineId === undefined ? [] : findings.map((finding, index) => {
      const disposition = finding.code === 'stale_verification' ? 'reverify' as const : 'reexecute' as const
      const core = {
        projectId, repairBaselineId, subjectType: finding.subjectType, subjectId: finding.subjectId, sourceRecordId: finding.id,
        sourceSubjectDigest: digestObject({ subjectType: finding.subjectType, subjectId: finding.subjectId, findingDigest: finding.findingDigest }),
        sourceBindingClosureDigest: bindingDigest, sourceVerificationInputDigest: verificationEvidenceDigest,
        sourceFinalCommitReachabilityDigest: digestObject({ repositoryIdentityDigest: integration.repositoryIdentityDigest, finalCommit: integration.finalCommit, reachable: true }),
        disposition, reasonCode: finding.code, evidenceIds: [...finding.evidenceIds].sort(),
      }
      const id = `${repairBaselineId}:carry:${index + 1}`
      return { id, ...core, carryItemDigest: digestObject(core), createdAt: this.store.convergenceRepairCarryItems.get(id)?.createdAt ?? new Date().toISOString() }
    }).sort((left, right) => left.carryItemDigest.localeCompare(right.carryItemDigest) || left.id.localeCompare(right.id))
    const carryItemSetDigest = digestObject(carryItems.map((item) => item.carryItemDigest))
    const targetBinding = this.store.canonicalTargetBindings.get(integration.canonicalTargetBindingId)
    if (targetBinding === undefined) throw new WorkflowError('delivery-convergence-stale', 'Convergence repair cannot freeze a missing CanonicalTargetBinding.', 409)
    const repairBaselineCore = repairBaselineId === undefined ? undefined : {
      projectId, parentPlanSnapshotId: plan.id, parentIntegrationSnapshotId: integration.id, parentConvergenceReviewId: reviewId,
      canonicalTargetBindingId: targetBinding.id, canonicalTargetBindingDigest: targetBinding.bindingDigest, finalCommit: integration.finalCommit,
      finalRepositorySnapshotId: finalSnapshot.id, requirementDigest: plan.requirementDigest ?? digestObject([]), scenarioDigest: plan.acceptanceScenarioDigest ?? digestObject([]),
      policyDigest: plan.policyDigest ?? digestObject([]), findingIds: findings.map((finding) => finding.id), findingSetDigest,
      findingDispositions: findings.map((finding) => ({ findingId: finding.id, disposition: finding.code === 'stale_verification' ? 'reverify' as const : 'reexecute' as const, reasonCode: finding.code })),
      carryItemIds: carryItems.map((item) => item.id), carryItemSetDigest,
    }
    const repairBaseline: ConvergenceRepairBaselineRecord | undefined = repairBaselineCore === undefined || repairBaselineId === undefined ? undefined : { id: repairBaselineId, ...repairBaselineCore, baselineDigest: digestObject(repairBaselineCore), createdAt: this.store.convergenceRepairBaselines.get(repairBaselineId)?.createdAt ?? new Date().toISOString() }
    const reviewCore = {
      projectId, approvedPlanSnapshotId: plan.id, deliveryIntegrationSnapshotId: integration.id, integratedFinalCommit: integration.finalCommit,
      finalRepositorySnapshotId: finalSnapshot.id, finalRepositoryDigest, requirementDigest: plan.requirementDigest ?? digestObject([]),
      acceptanceScenarioDigest: plan.acceptanceScenarioDigest ?? digestObject([]), acceptanceScenarioCoveragePolicyDigest: plan.acceptanceScenarioCoveragePolicyDigest ?? digestObject([]),
      policyDigest: plan.policyDigest ?? digestObject([]), bindingDigest, approvedPlanDigest: plan.planHash, integrationDigest: integration.integrationDigest,
      verificationEvidenceDigest, status: findings.length === 0 ? 'converged' as const : 'changes_required' as const,
      findingIds: findings.map((finding) => finding.id), findingSetDigest, reviewerVersion: 'deterministic-convergence-v1',
      repairRequestStatus: findings.length === 0 ? 'not_required' as const : 'created' as const,
      ...(repairBaseline === undefined ? {} : { repairBaselineId: repairBaseline.id, repairRequestDigest: digestObject({ integrationId: integration.id, findingSetDigest, repairBaselineDigest: repairBaseline.baselineDigest }) }),
    }
    const review: DeliveryConvergenceReviewRecord = { id: reviewId, ...reviewCore, convergenceDigest: digestObject(reviewCore), createdAt: new Date().toISOString() }
    const inserted: Array<{ id: string; table: { delete: (id: string) => Promise<unknown> } }> = []
    const putExact = async <T>(table: { get: (id: string) => T | undefined; put: (id: string, value: T) => Promise<unknown>; delete: (id: string) => Promise<unknown> }, id: string, value: T): Promise<void> => {
      const existing = table.get(id)
      if (existing !== undefined) {
        if (digestObject(existing) !== digestObject(value)) throw new WorkflowError('delivery-convergence-immutable-conflict', `Immutable Convergence record "${id}" already exists with different content.`, 409)
        return
      }
      await table.put(id, value)
      inserted.push({ id, table })
    }
    await this.dependencies.serializedMutation(async () => {
      const previousProject = this.requireProject(projectId)
      if (previousProject.revision !== project.revision || previousProject.currentPlanSnapshotId !== plan.id || (previousProject.currentDeliveryIntegrationSnapshotId !== undefined && previousProject.currentDeliveryIntegrationSnapshotId !== integration.id)) throw new WorkflowError('delivery-convergence-stale', 'Project pointers changed before Convergence commit.', 409)
      try {
        await putExact(this.store.repositorySnapshotsV3, finalSnapshot.id, finalSnapshot)
        for (const finding of findings) await putExact(this.store.deliveryConvergenceFindings, finding.id, finding)
        for (const carryItem of carryItems) await putExact(this.store.convergenceRepairCarryItems, carryItem.id, carryItem)
        if (repairBaseline !== undefined) await putExact(this.store.convergenceRepairBaselines, repairBaseline.id, repairBaseline)
        await putExact(this.store.deliveryConvergenceReviews, review.id, review)
        await this.store.projects.put(projectId, { ...previousProject, currentDeliveryConvergenceReviewId: review.id, ...(repairBaseline === undefined ? {} : { currentConvergenceRepairBaselineId: repairBaseline.id }), deliveryStage: review.status === 'converged' ? 'review' : 'changes_required', updatedAt: new Date().toISOString() })
      } catch (error) {
        await Promise.allSettled([...inserted].reverse().map(({ table, id }) => table.delete(id)))
        await Promise.allSettled([this.store.projects.put(projectId, previousProject)])
        throw error
      }
    })
    return review
  }

  private buildDeliveryResponsibilityChain(project: ProjectRecord, runId: string, reviewId: string): DeliveryResponsibilityChain {
    const tasks = this.store.projectTasks(project)
    const taskIdSet = new Set(tasks.map((task) => task.id))
    const projectTaskRuns = [...this.store.taskRuns.entries()].map(([, run]) => run).filter((run) => run.projectId === project.id)
    const taskRuns = projectTaskRuns.filter((run) => run.runId === runId)
    const taskRunIdSet = new Set(taskRuns.map((run) => run.id))
    const artifacts = [...this.store.artifacts.entries()].map(([, artifact]) => artifact).filter((artifact) => artifact.projectId === project.id)
    const evidence = this.listProjectVerificationEvidence(project.id)
    const activities = [...this.store.activity.entries()].map(([, activity]) => activity).filter((activity) => activity.projectId === project.id)
    const delegations = [...this.store.delegations.entries()].map(([, delegation]) => delegation).filter((delegation) => {
      if (delegation.projectId !== project.id) return false
      if (project.currentPlanSnapshotId !== undefined && delegation.planSnapshotId === project.currentPlanSnapshotId) return true
      return (delegation.childTaskIds ?? []).some((taskId: string) => taskIdSet.has(taskId))
    })
    const decisions = [...this.store.decisions.entries()].map(([, decision]) => decision).filter((decision) => decision.projectId === project.id && (
      decision.taskRunId !== undefined && (taskRunIdSet.has(decision.taskRunId) || projectTaskRuns.some((run) => run.id === decision.taskRunId))
      || decision.metadata.revision === project.revision
      || decision.metadata.planSnapshotId === project.currentPlanSnapshotId
      || decision.metadata.projectReviewId === reviewId
      || typeof decision.metadata.taskId === 'string' && taskIdSet.has(decision.metadata.taskId)
      || typeof decision.metadata.delegationId === 'string' && delegations.some((delegation) => delegation.id === decision.metadata.delegationId)
    ))
    const activityIds = activities.map((activity) => activity.id).slice(0, 5_000)
    return {
      ...(project.teamComposition?.plannerAgentId === undefined ? {} : { plannerAgentId: project.teamComposition.plannerAgentId }),
      ...(project.teamComposition?.leadAgentId === undefined ? {} : { leadAgentId: project.teamComposition.leadAgentId }),
      ...(project.teamComposition?.reviewerAgentId === undefined ? {} : { plannedReviewerAgentId: project.teamComposition.reviewerAgentId }),
      tasks: tasks.map((task) => {
        const runs = taskRuns.filter((run) => run.taskId === task.id)
        const runIds = new Set(runs.map((run) => run.id))
        const taskArtifacts = artifacts.filter((artifact) => artifact.taskRunId !== undefined && runIds.has(artifact.taskRunId))
        const taskEvidence = evidence.filter((item) => item.taskId === task.id || (item.taskRunId !== undefined && runIds.has(item.taskRunId)))
        const taskDelegations = delegations.filter((delegation) => (delegation.childTaskIds ?? []).includes(task.id))
        const taskActivities = activities.filter((activity) => (activity.taskRunId !== undefined && runIds.has(activity.taskRunId)) || activity.metadata.taskId === task.id)
        return {
          taskId: task.id,
          ...(task.agentId === undefined ? {} : { ownerAgentId: task.agentId }),
          assignmentMode: task.assignmentPolicy?.mode ?? 'single_agent' as const,
          ...(task.teamDigest === undefined ? {} : { teamDigest: task.teamDigest }),
          ...(task.assignmentDigest === undefined ? {} : { assignmentDigest: task.assignmentDigest }),
          taskRunIds: [...runIds],
          artifactIds: [...new Set([...runs.flatMap((run) => run.artifactIds ?? []), ...taskArtifacts.map((artifact) => artifact.id)])],
          verificationEvidenceIds: taskEvidence.map((item) => item.id),
          delegationIds: taskDelegations.map((delegation) => delegation.id),
          activityIds: taskActivities.map((activity) => activity.id).slice(0, 1_000),
          attemptCount: Math.max(task.attemptCount ?? 0, 0, ...runs.map((run) => run.attempt)),
          wasReassigned: taskActivities.some((activity) => activity.type === 'project.task_reassigned'),
        }
      }),
      delegations: delegations.map((delegation) => ({
        ...(() => {
          const runs = projectTaskRuns.filter((run) => run.id === delegation.taskRunId || run.retryOf === delegation.taskRunId || run.delegatedByTaskRunId === delegation.taskRunId || run.issueId === delegation.childIssueId)
          return {
            taskRunIds: runs.map((run) => run.id),
            retryTaskRunIds: runs.filter((run) => run.retryOf !== undefined || run.trigger === 'retry' || run.attempt > 1).map((run) => run.id),
            escalationDecisionIds: decisions.filter((decision) => decision.metadata.delegationId === delegation.id).map((decision) => decision.id),
          }
        })(),
        delegationId: delegation.id,
        squadId: delegation.squadId,
        leaderAgentId: delegation.leaderAgentId,
        memberAgentId: delegation.memberAgentId,
        childIssueId: delegation.childIssueId,
        status: delegation.status,
        ...(delegation.taskRunId === undefined ? {} : { taskRunId: delegation.taskRunId }),
        ...(delegation.reviewerId === undefined ? {} : { reviewerId: delegation.reviewerId }),
        evidenceIds: [...(delegation.evidenceIds ?? [])],
      })),
      verifications: evidence.map((item) => ({
        evidenceId: item.id,
        ...(item.taskId === undefined ? {} : { taskId: item.taskId }),
        ...(item.taskRunId === undefined ? {} : { taskRunId: item.taskRunId }),
        actorType: item.actorType,
        ...(item.actorId === undefined ? {} : { actorId: item.actorId }),
        artifactIds: [...item.artifactIds],
      })),
      reviewIds: [reviewId],
      decisionIds: decisions.map((decision) => decision.id),
      retryTaskRunIds: projectTaskRuns.filter((run) => run.retryOf !== undefined || run.trigger === 'retry' || run.attempt > 1).map((run) => run.id),
      reassignedTaskIds: tasks.filter((task) => activities.some((activity) => activity.type === 'project.task_reassigned' && activity.metadata.taskId === task.id)).map((task) => task.id),
      escalationDecisionIds: decisions.filter((decision) => decision.kind === 'review' || decision.metadata.delegationId !== undefined || decision.metadata.teamBlocker === true).map((decision) => decision.id),
      activityIds,
    }
  }

  private collectDeliveryEvidence(project: ProjectRecord, runId: string, reviewId: string, evidenceIds: string[], responsibilityChain: DeliveryResponsibilityChain): Pick<DeliveryRecord, 'repository' | 'baseCommit' | 'headCommit' | 'branch' | 'worktree' | 'changedFiles' | 'diffStat' | 'testSummary' | 'immutableDigest'> {
    const taskRuns = [...this.store.taskRuns.entries()]
      .map(([, taskRun]) => taskRun)
      .filter((taskRun) => taskRun.projectId === project.id && taskRun.runId === runId)
    const changedFiles = [...new Set(taskRuns.flatMap((taskRun) => taskRun.changedFiles ?? []))].slice(0, 2_000)
    const diffStat = boundedText(taskRuns.map((taskRun) => taskRun.diffStat ?? '').filter(Boolean).join('\n'), 70_000)
    const testSummary = boundedText(taskRuns.map((taskRun) => `${taskRun.taskId ?? taskRun.id}: ${taskRun.testExitCode === 0 ? 'passed' : taskRun.testExitCode === undefined ? taskRun.status : `failed(${taskRun.testExitCode})`}`).join('\n'), 20_000)
    const baseCommit = taskRuns.find((taskRun) => taskRun.baseCommit !== undefined)?.baseCommit
    const headCommit = [...taskRuns].reverse().find((taskRun) => taskRun.headCommit !== undefined)?.headCommit
    const branch = taskRuns.find((taskRun) => taskRun.branch !== undefined)?.branch
    const worktree = taskRuns.find((taskRun) => taskRun.workspace !== undefined)?.workspace
    const repository = project.cwd
    const immutableDigest = digestObject({ projectId: project.id, revision: project.revision, planSnapshotId: project.currentPlanSnapshotId, reviewId, evidenceIds: [...evidenceIds].sort(), teamDigest: project.teamDigest, assignmentDigest: project.assignmentDigest, requirementDigest: project.requirementDigest, decisionDigest: project.decisionDigest, repository, baseCommit, headCommit, branch, worktree, changedFiles, diffStat, testSummary, responsibilityChain })
    return { repository, ...(baseCommit === undefined ? {} : { baseCommit }), ...(headCommit === undefined ? {} : { headCommit }), ...(branch === undefined ? {} : { branch }), ...(worktree === undefined ? {} : { worktree }), changedFiles, ...(diffStat === '' ? {} : { diffStat }), testSummary, immutableDigest }
  }

  async completeExecutionForReview(projectId: string, runId: string, integration?: DeliveryIntegrationSnapshotRecord, convergence?: DeliveryConvergenceReviewRecord): Promise<DeliveryRecord> {
    return this.dependencies.serializedMutation(async () => {
      const currentProject = this.store.projects.get(projectId)
      const currentRun = this.store.runs.get(runId)
      if (currentProject?.activeRunId !== runId || currentRun === undefined || ['completed', 'failed', 'cancelled'].includes(currentRun.status)) throw new WorkflowError('stale-run', 'A newer execution state replaced this run before completion.', 409)
      if ((integration === undefined) !== (convergence === undefined)) throw new WorkflowError('delivery-convergence-stale', 'Execution completion requires Integration and Convergence as one frozen pair.', 409)
      if (currentProject.planningContractVersion === 3 && integration === undefined) throw new WorkflowError('delivery-convergence-stale', 'V3 execution completion requires a converged Integration revision.', 409)
      if (integration !== undefined && (convergence!.status !== 'converged' || convergence!.deliveryIntegrationSnapshotId !== integration.id || convergence!.integratedFinalCommit !== integration.finalCommit)) throw new WorkflowError('delivery-convergence-stale', 'Execution completion requires the current converged Integration revision.', 409)

      const completedAt = new Date().toISOString()
      const completedRun: RunRecord = { ...currentRun, status: 'completed', completedAt }
      delete completedRun.currentTaskId
      delete completedRun.error
      const evidence = this.listProjectVerificationEvidence(projectId)
      const reviewId = `${projectId}:review:r${currentProject.revision}`
      const deliveryId = `${projectId}:delivery:r${currentProject.revision}`
      const review: ProjectReviewRecord = {
        id: reviewId,
        projectId,
        revision: currentProject.revision,
        ...(currentProject.currentPlanSnapshotId === undefined ? {} : { planSnapshotId: currentProject.currentPlanSnapshotId }),
        evidenceIds: evidence.map((item) => item.id),
        round: 1,
        acceptanceResults: [...this.store.acceptanceCriteria.entries()].map(([, criterion]) => criterion).filter((criterion) => criterion.projectId === projectId).map((criterion) => ({
          acceptanceId: criterion.id,
          result: criterion.status === 'verified' ? 'passed' as const : criterion.status === 'waived' ? 'waived' as const : 'failed' as const,
          evidenceIds: [...criterion.evidenceIds],
        })),
        waivers: [],
        status: 'pending',
        reviewerType: 'human',
        summary: `Project execution completed with ${evidence.filter((item) => item.status === 'passed').length}/${evidence.length} passing verification evidence records.`,
        createdAt: completedAt,
      }
      const responsibilityChain = this.buildDeliveryResponsibilityChain(currentProject, runId, reviewId)
      const deliveryEvidence = this.collectDeliveryEvidence(currentProject, runId, reviewId, evidence.map((item) => item.id), responsibilityChain)
      const delivery: DeliveryRecord = {
        id: deliveryId,
        projectId,
        revision: currentProject.revision,
        ...(currentProject.currentPlanSnapshotId === undefined ? {} : { planSnapshotId: currentProject.currentPlanSnapshotId }),
        reviewId,
        evidenceIds: evidence.map((item) => item.id),
        ...deliveryEvidence,
        ...(integration === undefined ? {} : {
          repository: currentProject.cwd,
          baseCommit: integration.baseCommit,
          headCommit: integration.finalCommit,
          branch: integration.targetRef,
          worktree: currentProject.cwd,
          changedFiles: [...new Set(integration.outputs.flatMap((output) => this.store.taskRuns.get(output.taskRunId)?.outputChangedPaths?.map((item: { path: string }) => item.path) ?? []))].sort(),
          immutableDigest: undefined,
        }),
        responsibilityChain,
        ...(currentProject.requirementDigest === undefined ? {} : { requirementDigest: currentProject.requirementDigest }),
        ...(currentProject.decisionDigest === undefined ? {} : { decisionDigest: currentProject.decisionDigest }),
        knownRisks: [],
        rollbackSteps: [],
        handoffMode: 'local_review',
        ...(currentProject.teamDigest === undefined ? {} : { teamDigest: currentProject.teamDigest }),
        ...(currentProject.assignmentDigest === undefined ? {} : { assignmentDigest: currentProject.assignmentDigest }),
        status: 'ready',
        createdAt: completedAt,
      }
      if (integration !== undefined) delivery.immutableDigest = digestObject(this.deliveryImmutableFields(delivery))

      await this.store.projectReviews.put(review.id, review)
      try {
        await this.putDeliveryRecord(delivery)
        const completedProject: ProjectRecord = { ...currentProject, status: 'completed', deliveryStage: 'review', updatedAt: completedAt }
        delete completedProject.activeRunId
        delete completedProject.lastError
        await this.store.projects.put(projectId, completedProject)
      } catch (error) {
        await Promise.allSettled([this.store.projectReviews.delete(reviewId), this.deleteDeliveryRecord(deliveryId)])
        throw error
      }
      try {
        await this.store.runs.put(runId, completedRun)
      } catch (error) {
        await Promise.allSettled([this.store.projectReviews.delete(reviewId), this.deleteDeliveryRecord(deliveryId), this.store.projects.put(projectId, currentProject)])
        throw error
      }
      return delivery
    })
  }

  async completeExecutionWithChangesRequired(projectId: string, runId: string, integration: DeliveryIntegrationSnapshotRecord, convergence: DeliveryConvergenceReviewRecord): Promise<void> {
    if (convergence.status !== 'changes_required' || convergence.deliveryIntegrationSnapshotId !== integration.id || convergence.integratedFinalCommit !== integration.finalCommit) throw new WorkflowError('delivery-convergence-stale', 'Changes-required completion needs the matching Convergence review.', 409)
    const completedAt = new Date().toISOString()
    await this.dependencies.serializedMutation(async () => {
      const project = this.requireProject(projectId)
      const run = this.store.runs.get(runId)
      if (project.activeRunId !== runId || run === undefined || ['completed', 'failed', 'cancelled'].includes(run.status)) throw new WorkflowError('stale-run', 'A newer execution state replaced this run before Convergence completion.', 409)
      const completedRun: RunRecord = { ...run, status: 'completed', completedAt }
      delete completedRun.currentTaskId
      delete completedRun.error
      const changesRequired: ProjectRecord = { ...project, status: 'approved', deliveryStage: 'changes_required', updatedAt: completedAt }
      delete changesRequired.activeRunId
      await this.store.runs.put(runId, completedRun)
      try {
        await this.store.projects.put(projectId, changesRequired)
      } catch (error) {
        await this.store.runs.put(runId, run)
        throw error
      }
    })
    try {
      await this.dependencies.recordActivity({
        id: `activity:delivery.convergence_changes_required:${convergence.id}`,
        projectId,
        actorType: 'system',
        type: 'delivery.convergence_changes_required',
        message: 'Task execution completed, but canonical final code did not satisfy the Delivery Convergence gate.',
        metadata: { integrationId: integration.id, convergenceReviewId: convergence.id, findingIds: convergence.findingIds },
        createdAt: completedAt,
      })
    } catch { /* the frozen Convergence review remains the authoritative recovery source */ }
  }

  async confirmProjectDelivery(id: string, input: { actor: string; note?: string }): Promise<DeliveryRecord> {
    const actor = input.actor.trim().slice(0, 240)
    if (actor === '') throw new WorkflowError('delivery-reviewer-required', 'A delivery reviewer is required.', 400)
    const result = await this.dependencies.serializedMutation(async () => {
      const project = this.requireProject(id)
      const projection = this.getProjectDelivery(id)
      const delivery = projection.delivery
      if (delivery === undefined) throw new WorkflowError('delivery-record-missing', 'Project has no delivery record to confirm.', 409)
      if (delivery.status === 'delivered' || delivery.status === 'closed') return delivery
      const review = projection.review
      if (review === undefined) throw new WorkflowError('project-review-missing', 'Project review is required before delivery confirmation.', 409)
      if (review.status !== 'approved' && review.status !== 'waived') throw new WorkflowError('project-review-pending', 'Resolve the Project Review before confirming delivery.', 409)
      if (!projection.ready) throw new WorkflowError('delivery-not-ready', `Project delivery is not ready: ${projection.blockers.join(' ')}`, 409)
      if (project.planningContractVersion === 3) {
        const integration = project.currentDeliveryIntegrationSnapshotId === undefined ? undefined : this.store.deliveryIntegrationSnapshots.get(project.currentDeliveryIntegrationSnapshotId)
        const convergence = project.currentDeliveryConvergenceReviewId === undefined ? undefined : this.store.deliveryConvergenceReviews.get(project.currentDeliveryConvergenceReviewId)
        if (integration === undefined || convergence === undefined || integration.status !== 'ready' || convergence.status !== 'converged' || convergence.deliveryIntegrationSnapshotId !== integration.id || convergence.integratedFinalCommit !== integration.finalCommit || integration.approvedPlanSnapshotId !== project.currentPlanSnapshotId) throw new WorkflowError('delivery-convergence-stale', 'Delivery close requires the current converged V3 Integration revision.', 409)
        const target = await this.dependencies.inspectCanonicalTarget(project.cwd, integration.targetRef)
        if (target.head.trim() !== integration.finalCommit || target.status.trim() !== '') throw new WorkflowError('delivery-convergence-stale', 'Canonical final commit moved or became dirty after Convergence review.', 409)
      }
      const now = new Date().toISOString()
      const nextDelivery: DeliveryRecord = { ...delivery, status: 'delivered', deliveredBy: actor, deliveredAt: now, pendingAuditEvents: [...new Set([...(delivery.pendingAuditEvents ?? []), 'project.delivery_confirmed' as const])], ...(input.note === undefined ? {} : { note: input.note.trim().slice(0, 20_000) }) }
      try {
        await this.putDeliveryRecord(nextDelivery)
        await this.store.projects.put(id, { ...project, status: project.status === 'completed' ? 'completed' : project.status, deliveryStage: 'delivered', updatedAt: now })
      } catch (error) {
        await Promise.allSettled([this.putDeliveryRecord(delivery)])
        throw error
      }
      return nextDelivery
    })
    return this.settleDeliveryAudit(result)
  }

  async closeProjectDelivery(id: string, input: { actor: string; note?: string }): Promise<DeliveryRecord> {
    const actor = input.actor.trim().slice(0, 240)
    if (actor === '') throw new WorkflowError('delivery-closer-required', 'A delivery close actor is required.', 400)
    const result = await this.dependencies.serializedMutation(async () => {
      const project = this.requireProject(id)
      const delivery = this.listProjectDeliveryRecords(id).find((item) => item.revision === project.revision)
      if (delivery === undefined) throw new WorkflowError('delivery-record-missing', 'Project has no delivery record to close.', 409)
      if (delivery.status === 'closed') return delivery
      if (delivery.status !== 'delivered') throw new WorkflowError('delivery-not-delivered', 'Only delivered records can be closed.', 409)
      const now = new Date().toISOString()
      const closed: DeliveryRecord = { ...delivery, status: 'closed', closedBy: actor, closedAt: now, pendingAuditEvents: [...new Set([...(delivery.pendingAuditEvents ?? []), 'project.delivery_closed' as const])], ...(input.note === undefined ? {} : { note: input.note.trim().slice(0, 20_000) }) }
      await this.putDeliveryRecord(closed)
      try {
        await this.store.projects.put(id, { ...this.requireProject(id), deliveryStage: 'closed', updatedAt: now })
      } catch (error) {
        await this.putDeliveryRecord(delivery)
        throw error
      }
      return closed
    })
    return this.settleDeliveryAudit(result)
  }

  async putDeliveryRecord(record: DeliveryRecord): Promise<void> {
    const current = this.store.deliveryRecords.get(record.id)
    if (current?.immutableDigest !== undefined) {
      const immutableChanged = record.immutableDigest !== current.immutableDigest
        || digestObject(this.deliveryImmutableFields(record)) !== digestObject(this.deliveryImmutableFields(current))
      if (immutableChanged) throw new WorkflowError('delivery-record-immutable', 'Immutable delivery evidence cannot be changed after it is recorded.', 409)
    }
    await this.store.deliveryRecords.put(record.id, record)
  }

  deliveryImmutableFields(record: DeliveryRecord): Record<string, unknown> {
    return {
      id: record.id,
      projectId: record.projectId,
      revision: record.revision,
      planSnapshotId: record.planSnapshotId,
      reviewId: record.reviewId,
      evidenceIds: record.evidenceIds,
      repository: record.repository,
      baseCommit: record.baseCommit,
      headCommit: record.headCommit,
      branch: record.branch,
      worktree: record.worktree,
      changedFiles: record.changedFiles,
      diffStat: record.diffStat,
      testSummary: record.testSummary,
      knownRisks: record.knownRisks,
      rollbackSteps: record.rollbackSteps,
      handoffMode: record.handoffMode,
      teamDigest: record.teamDigest,
      assignmentDigest: record.assignmentDigest,
      requirementDigest: record.requirementDigest,
      decisionDigest: record.decisionDigest,
      responsibilityChain: record.responsibilityChain,
      createdAt: record.createdAt,
    }
  }

  async deleteDeliveryRecord(id: string): Promise<void> {
    await this.store.deliveryRecords.delete(id)
  }

  private requireProject(id: string): ProjectRecord {
    const project = this.store.projects.get(id)
    if (project === undefined) throw new WorkflowError('project-not-found', `Project "${id}" was not found.`, 404)
    return project
  }
}
