import type { PlanningCheckpointRecord, PlanningOperationRecord, PlanningPromptReferenceManifestRecord, PlanningSourceInputRecord, PlanningStageAttemptRecord, PolicyConstraintRecordV3, ProjectRecord } from '../types.js'
import type { OrchestratorStore } from '../storage.js'
import { StorageUnitOfWork } from '../storage-unit-of-work.js'
import { digestObject, WorkflowError } from '../workflow.js'
import { PLANNING_STAGE_ORDER } from './repair-lineage.js'

export function buildPlanningCheckpointV3(input: { operation: PlanningOperationRecord; sequence: number; inputDigest: string; attempt?: PlanningStageAttemptRecord; createdAt?: string }): PlanningCheckpointRecord {
  if (input.attempt !== undefined && (input.attempt.operationId !== input.operation.id || input.attempt.stage !== input.operation.stage || input.attempt.status !== 'completed' || input.attempt.outputDigest !== digestObject(input.operation))) {
    throw new Error('A Planning checkpoint can only bind a completed stage attempt for the exact operation state.')
  }
  const operationDigest = digestObject(input.operation)
  const outputRecordIds = Object.entries(input.operation)
    .filter(([key, value]) => (key.endsWith('Id') && typeof value === 'string') || (key.endsWith('Ids') && Array.isArray(value)))
    .flatMap(([, value]) => typeof value === 'string' ? [value] : (value as unknown[]).filter((item): item is string => typeof item === 'string'))
    .filter((id, index, values) => values.indexOf(id) === index)
    .sort()
  const outputRecordDigests = Object.entries(input.operation)
    .filter(([key, value]) => key.toLowerCase().endsWith('digest') && typeof value === 'string' && /^[a-f0-9]{64}$/u.test(value))
    .map(([, value]) => value as string)
    .filter((digest, index, values) => values.indexOf(digest) === index)
    .sort()
  const createdAt = input.createdAt ?? new Date().toISOString()
  const core = {
    schemaVersion: 1 as const,
    projectId: input.operation.projectId,
    operationId: input.operation.id,
    stage: input.operation.stage,
    sequence: input.sequence,
    ...(input.attempt === undefined ? {} : { stageAttemptId: input.attempt.id }),
    inputDigest: input.inputDigest,
    outputDigest: input.attempt?.outputDigest ?? operationDigest,
    outputRecordIds,
    outputRecordDigests,
    versions: { planningContractVersion: input.operation.planningContractVersion, metricPolicyVersion: input.operation.metricPolicyVersion },
    sideEffectIdempotencyKeys: input.operation.idempotencyKey === undefined ? [] : [input.operation.idempotencyKey],
    pendingWriteIds: [],
    commitMarker: 'committed' as const,
    completionMarker: 'completed' as const,
    recoverability: input.operation.status === 'running' ? 'replay_safe' as const : 'terminal' as const,
    blockingDiagnostics: input.operation.diagnostics.filter((diagnostic) => diagnostic.severity === 'blocking' || diagnostic.severity === 'error'),
    operationDigest,
  }
  return { id: `planning-checkpoint:${input.operation.id}:${input.sequence}`, ...core, checkpointDigest: digestObject(core), createdAt }
}

export function planningCheckpointIsCurrentV3(checkpoint: PlanningCheckpointRecord, operation: PlanningOperationRecord): boolean {
  const { id: _id, checkpointDigest: _digest, createdAt: _createdAt, ...core } = checkpoint
  return checkpoint.operationId === operation.id
    && checkpoint.projectId === operation.projectId
    && checkpoint.stage === operation.stage
    && checkpoint.commitMarker === 'committed'
    && checkpoint.completionMarker === 'completed'
    && checkpoint.recoverability === 'replay_safe'
    && checkpoint.pendingWriteIds.length === 0
    && checkpoint.operationDigest === digestObject(operation)
    && checkpoint.outputDigest === checkpoint.operationDigest
    && checkpoint.checkpointDigest === digestObject(core)
}

export class PlanningCoordinator {
  private readonly unitOfWork: StorageUnitOfWork

  static pendingRepositoryPolicySuccessors(store: Pick<OrchestratorStore, 'planningOperations'>): PlanningOperationRecord[] {
    const operations = [...store.planningOperations.entries()].map(([, operation]) => operation)
    return operations
      .filter((operation) => operation.status === 'superseded' && operation.stage === 'policy_snapshot')
      .filter((operation) => !operations.some((candidate) => candidate.predecessorOperationId === operation.id))
      .sort((left, right) => left.createdAt.localeCompare(right.createdAt))
  }

  constructor(
    private readonly store: OrchestratorStore,
    private current: PlanningOperationRecord,
    private readonly failureInjector?: (input: { operationId: string; stage: PlanningOperationRecord['stage']; phase: 'before_stage_commit' }) => void | Promise<void>,
  ) {
    this.unitOfWork = new StorageUnitOfWork(store.storageMutationIntents)
  }

  get operation(): PlanningOperationRecord {
    return this.current
  }

  adopt(operation: PlanningOperationRecord): void {
    if (operation.id !== this.current.id || operation.projectId !== this.current.projectId) throw new WorkflowError('planning-operation-owner-mismatch', 'PlanningCoordinator cannot adopt a different Planning operation.', 409)
    this.current = operation
  }

  promptReferenceManifest(input: { stageAttemptId: string; references: PlanningPromptReferenceManifestRecord['references'] }): PlanningPromptReferenceManifestRecord {
    const attempt = this.store.planningStageAttempts.get(input.stageAttemptId)
    if (attempt === undefined || attempt.operationId !== this.current.id || attempt.stage !== this.current.stage || attempt.status !== 'completed') throw new WorkflowError('prompt-reference-attempt-invalid', 'Prompt references require a completed current stage attempt owned by the Planning Operation.', 409)
    const references = [...input.references].sort((left, right) => left.ref.localeCompare(right.ref))
    const core = { projectId: this.current.projectId, operationId: this.current.id, stageAttemptId: input.stageAttemptId, references, allowedRefSetDigest: digestObject(references.map((reference) => reference.ref)) }
    return { id: `prompt-manifest:${this.current.id}:${input.stageAttemptId}`, ...core, manifestDigest: digestObject(core), createdAt: new Date().toISOString() }
  }

  recoveryDisposition(project: ProjectRecord):
    | { kind: 'defer' }
    | { kind: 'committed'; candidateId: string; taskIds: string[] }
    | { kind: 'retryable'; checkpoint: PlanningCheckpointRecord; sourceInput: PlanningSourceInputRecord }
    | { kind: 'aborted'; checkpoint?: PlanningCheckpointRecord } {
    const operation = this.current
    if (project.id !== operation.projectId) throw new WorkflowError('planning-operation-owner-mismatch', 'Planning recovery cannot inspect a Project outside the current operation.', 409)
    const unresolvedIntent = [...this.store.storageMutationIntents.entries()].map(([, intent]) => intent)
      .find((intent) => intent.aggregateType === 'planning_operation' && intent.aggregateId === operation.id && !['committed', 'compensated'].includes(intent.status))
    if (unresolvedIntent !== undefined) return { kind: 'defer' }
    const candidateId = operation.candidatePlanSnapshotId ?? operation.reservedPlanSnapshotId
    const candidate = this.store.planSnapshots.get(candidateId)
    if (project.currentPlanSnapshotId === candidateId && candidate?.planningContractVersion === 3) return { kind: 'committed', candidateId, taskIds: candidate.taskIds }
    const checkpoints = [...this.store.planningCheckpoints.entries()].map(([, checkpoint]) => checkpoint)
      .filter((checkpoint) => checkpoint.operationId === operation.id)
      .sort((left, right) => right.sequence - left.sequence || right.createdAt.localeCompare(left.createdAt))
    const checkpoint = checkpoints.find((item) => planningCheckpointIsCurrentV3(item, operation))
    const sourceInput = operation.sourceInputId === undefined ? undefined : this.store.planningSourceInputs.get(operation.sourceInputId)
    const sourceInputCurrent = sourceInput !== undefined
      && sourceInput.operationId === operation.id
      && sourceInput.projectId === operation.projectId
      && sourceInput.sourceInputDigest === operation.sourceInputDigest
      && digestObject({
        projectId: sourceInput.projectId,
        operationId: sourceInput.operationId,
        mode: sourceInput.mode,
        title: sourceInput.title,
        prd: sourceInput.prd,
        technicalDesign: sourceInput.technicalDesign,
        taskLanguage: sourceInput.taskLanguage,
        sourceRefs: sourceInput.sourceRefs,
        sourceBlocks: sourceInput.sourceBlocks,
        ...(sourceInput.reviseBundleId === undefined ? {} : { reviseBundleId: sourceInput.reviseBundleId }),
        requestDigest: sourceInput.requestDigest,
      }) === sourceInput.sourceInputDigest
    if (checkpoint !== undefined && sourceInputCurrent && sourceInput !== undefined) return { kind: 'retryable', checkpoint, sourceInput }
    return { kind: 'aborted', ...(checkpoint === undefined ? {} : { checkpoint }) }
  }

  repositoryPolicySuccessorOptions() {
    const predecessor = this.current
    if (predecessor.status !== 'superseded' || predecessor.stage !== 'policy_snapshot') throw new WorkflowError('repository-policy-successor-predecessor-invalid', 'Repository Policy successor requires a superseded policy_snapshot predecessor.', 409)
    const sourceInput = predecessor.sourceInputId === undefined ? undefined : this.store.planningSourceInputs.get(predecessor.sourceInputId)
    const baseline = predecessor.repositoryPolicyBaselineId === undefined ? undefined : this.store.repositoryPolicyBaselines.get(predecessor.repositoryPolicyBaselineId)
    const policySnapshot = predecessor.policySnapshotId === undefined ? undefined : this.store.planningPolicySnapshots.get(predecessor.policySnapshotId)
    if (sourceInput === undefined || sourceInput.projectId !== predecessor.projectId || sourceInput.operationId !== predecessor.id || sourceInput.sourceInputDigest !== predecessor.sourceInputDigest || digestObject({
      projectId: sourceInput.projectId,
      operationId: sourceInput.operationId,
      mode: sourceInput.mode,
      title: sourceInput.title,
      prd: sourceInput.prd,
      technicalDesign: sourceInput.technicalDesign,
      taskLanguage: sourceInput.taskLanguage,
      sourceRefs: sourceInput.sourceRefs,
      sourceBlocks: sourceInput.sourceBlocks,
      ...(sourceInput.reviseBundleId === undefined ? {} : { reviseBundleId: sourceInput.reviseBundleId }),
      requestDigest: sourceInput.requestDigest,
    }) !== sourceInput.sourceInputDigest) throw new WorkflowError('repository-policy-successor-source-stale', 'Repository Policy successor source input is missing or no longer matches its immutable digest.', 409)
    const baselineCore = baseline === undefined ? undefined : (() => {
      const { id: _id, baselineDigest: _digest, createdAt: _createdAt, ...core } = baseline
      return core
    })()
    if (baseline === undefined || baseline.projectId !== predecessor.projectId || baseline.createdByOperationId !== predecessor.id || baseline.baselineDigest !== predecessor.repositoryPolicyBaselineDigest || digestObject(baselineCore) !== baseline.baselineDigest) throw new WorkflowError('repository-policy-successor-baseline-stale', 'Repository Policy successor baseline is missing, corrupt, or no longer owned by the predecessor.', 409)
    const policyConstraints = policySnapshot?.constraintIds.map((id: string) => this.store.policyConstraintsV3.get(id)) ?? []
    const policySnapshotDigest = policySnapshot === undefined || policyConstraints.some((constraint: PolicyConstraintRecordV3 | undefined) => constraint === undefined)
      ? undefined
      : (() => {
          const { id: _id, policyDigest: _digest, createdAt: _createdAt, ...core } = policySnapshot
          return digestObject({ ...core, constraints: (policyConstraints as PolicyConstraintRecordV3[]).map((constraint) => constraint.constraintDigest) })
        })()
    if (policySnapshot === undefined || policySnapshot.projectId !== predecessor.projectId || policySnapshot.operationId !== predecessor.id || policySnapshot.fixedPointStatus !== 'delta_found' || policySnapshot.status !== 'requires_replan' || policySnapshot.policyDigest !== predecessor.policyDigest || policySnapshotDigest !== policySnapshot.policyDigest) throw new WorkflowError('repository-policy-successor-delta-stale', 'Repository Policy successor delta snapshot is missing, corrupt, or no longer requires replanning.', 409)
    const repairAttempt = [...this.store.planningRepairAttempts.entries()].map(([, attempt]) => attempt)
      .find((attempt) => attempt.projectId === predecessor.projectId && attempt.successorOperationId === predecessor.id && ['repairing', 'revalidated'].includes(attempt.status))
    const batch = {
      title: sourceInput.title,
      prd: sourceInput.prd,
      technicalDesign: sourceInput.technicalDesign,
      taskLanguage: sourceInput.taskLanguage,
      sourceRefs: [...sourceInput.sourceRefs],
      sourceBlocks: [...sourceInput.sourceBlocks],
      idempotencyKey: `repository-policy:${predecessor.id}:${policySnapshot.repositoryPolicyDeltaDigest}`,
    }
    const policySuccessor = {
      predecessorOperationId: predecessor.id,
      baselineId: baseline.id,
      baselineDigest: baseline.baselineDigest,
      sourceInputDigest: sourceInput.sourceInputDigest,
      repositoryPolicyDeltaDigest: policySnapshot.repositoryPolicyDeltaDigest,
      restartStage: 'source_policy_precheck' as const,
      ...(repairAttempt === undefined ? {} : { repairAttemptId: repairAttempt.id }),
    }
    const requestDigest = digestObject({ kind: 'repository_policy_successor', policySuccessor, batch })
    return {
      append: sourceInput.mode === 'append',
      ...(sourceInput.reviseBundleId === undefined ? {} : { reviseBundleId: sourceInput.reviseBundleId }),
      batch,
      requestDigest,
      policySuccessor,
      ...(repairAttempt === undefined ? {} : { repair: { attemptId: repairAttempt.id, predecessorOperationId: repairAttempt.operationId, restartStage: repairAttempt.restartStage, findings: repairAttempt.findings ?? [] } }),
    }
  }

  repositoryPolicySuccessorDisposition(project: ProjectRecord, options: { requestDigest?: string | undefined; batch: { idempotencyKey?: string | undefined }; policySuccessor?: { predecessorOperationId: string } | undefined }): 'existing' | 'inflight' | 'recover_project' | 'start' {
    if (project.id !== this.current.projectId || options.policySuccessor?.predecessorOperationId !== this.current.id) throw new WorkflowError('repository-policy-successor-lineage-invalid', 'Repository Policy successor lineage does not match its predecessor.', 409)
    const existing = [...this.store.planningOperations.entries()].map(([, operation]) => operation)
      .find((operation) => operation.predecessorOperationId === this.current.id && operation.requestDigest === options.requestDigest)
    if (existing !== undefined) return 'existing'
    if (project.status === 'decomposing' && project.activeDecompositionKey === options.batch.idempotencyKey) {
      if (project.activeDecompositionDigest !== options.requestDigest) throw new WorkflowError('decomposition-idempotency-conflict', 'The Repository Policy successor key is already bound to a different request.', 409)
      return 'inflight'
    }
    return project.status === 'decomposing' && project.activePlanningOperationId === this.current.id ? 'recover_project' : 'start'
  }

  private buildCheckpoint(inputDigest: string, attempt?: PlanningStageAttemptRecord): PlanningCheckpointRecord {
    const sequence = [...this.store.planningCheckpoints.entries()].reduce((highest, [, checkpoint]) => checkpoint.operationId === this.current.id ? Math.max(highest, checkpoint.sequence) : highest, 0) + 1
    return buildPlanningCheckpointV3({ operation: this.current, sequence, inputDigest, ...(attempt === undefined ? {} : { attempt }) })
  }

  async persistCheckpoint(inputDigest: string, attempt?: PlanningStageAttemptRecord): Promise<PlanningCheckpointRecord> {
    const checkpoint = this.buildCheckpoint(inputDigest, attempt)
    await this.store.planningCheckpoints.put(checkpoint.id, checkpoint)
    return checkpoint
  }

  private async publishCheckpointEvent(checkpoint: PlanningCheckpointRecord): Promise<void> {
    const eventId = `planning-event:${checkpoint.id}`
    await this.unitOfWork.execute({
      id: `storage-intent:${eventId}`,
      projectId: this.current.projectId,
      aggregateType: 'planning_operation_event',
      aggregateId: this.current.id,
      idempotencyKey: checkpoint.checkpointDigest,
      steps: [{
        stepId: 'domain-event', table: 'domain_events', recordId: eventId, operation: 'put', execute: async () => {
          await this.store.appendDomainEvent({
            eventId,
            aggregateType: 'planning_operation',
            aggregateId: this.current.id,
            eventType: `planning.${this.current.stage}.${this.current.status}`,
            actor: 'system',
            projectId: this.current.projectId,
            operationId: this.current.id,
            payloadRef: `planning-checkpoint:${checkpoint.id}`,
            payloadDigest: checkpoint.operationDigest,
            occurredAt: this.current.updatedAt,
          })
        },
      }],
    })
  }

  async transition(patch: Partial<PlanningOperationRecord>): Promise<PlanningStageAttemptRecord | undefined> {
    const operationId = this.current.id
    if (patch.id !== undefined && patch.id !== operationId || patch.projectId !== undefined && patch.projectId !== this.current.projectId) throw new WorkflowError('planning-operation-owner-mismatch', 'A Planning stage transition cannot change its owning operation or Project.', 409)
    const nextStage = patch.stage ?? this.current.stage
    const currentOrdinal = PLANNING_STAGE_ORDER.indexOf(this.current.stage)
    const nextOrdinal = PLANNING_STAGE_ORDER.indexOf(nextStage)
    if (currentOrdinal < 0 || nextOrdinal < currentOrdinal) throw new WorkflowError('planning-stage-regression', `Planning stage cannot move from ${this.current.stage} to ${nextStage}.`, 500)
    if (nextStage === this.current.stage) {
      this.current = { ...this.current, ...patch, updatedAt: new Date().toISOString() }
      const inputDigest = digestObject({ operationId, stage: nextStage, patch })
      const checkpoint = this.buildCheckpoint(inputDigest)
      await this.unitOfWork.execute({
        id: `storage-intent:${checkpoint.id}`,
        projectId: this.current.projectId,
        aggregateType: 'planning_operation',
        aggregateId: operationId,
        idempotencyKey: checkpoint.checkpointDigest,
        steps: [
          { stepId: 'operation', table: 'planning_operations', recordId: operationId, operation: 'put', execute: async () => this.store.planningOperations.put(operationId, this.current) },
          { stepId: 'checkpoint', table: 'planning_checkpoints', recordId: checkpoint.id, operation: 'put', execute: async () => this.store.planningCheckpoints.put(checkpoint.id, checkpoint) },
        ],
      })
      await this.publishCheckpointEvent(checkpoint)
      return undefined
    }
    const priorAttempts = [...this.store.planningStageAttempts.entries()].map(([, attempt]) => attempt).filter((attempt) => attempt.operationId === operationId && attempt.stage === nextStage)
    const round = priorAttempts.reduce((highest, attempt) => Math.max(highest, attempt.round), 0) + 1
    const startedAt = new Date().toISOString()
    const attemptId = `planning-stage-attempt:${operationId}:${nextStage}:${round}`
    const inputDigest = digestObject({ operationId, fromStage: this.current.stage, toStage: nextStage, currentOperation: this.current, patch })
    let attempt: PlanningStageAttemptRecord = { id: attemptId, operationId, stage: nextStage, round, status: 'running', inputDigest, createdAt: startedAt }
    await this.store.planningStageAttempts.put(attempt.id, attempt)
    try {
      await this.failureInjector?.({ operationId, stage: nextStage, phase: 'before_stage_commit' })
      this.current = { ...this.current, ...patch, updatedAt: new Date().toISOString() }
      const completedAt = new Date().toISOString()
      attempt = { ...attempt, status: 'completed', outputDigest: digestObject(this.current), durationMs: Math.max(0, Date.parse(completedAt) - Date.parse(startedAt)), completedAt }
      const checkpoint = this.buildCheckpoint(inputDigest, attempt)
      await this.unitOfWork.execute({
        id: `storage-intent:${checkpoint.id}`,
        projectId: this.current.projectId,
        aggregateType: 'planning_operation',
        aggregateId: operationId,
        idempotencyKey: checkpoint.checkpointDigest,
        steps: [
          { stepId: 'operation', table: 'planning_operations', recordId: operationId, operation: 'put', execute: async () => this.store.planningOperations.put(operationId, this.current) },
          { stepId: 'stage-attempt', table: 'planning_stage_attempts', recordId: attempt.id, operation: 'put', execute: async () => this.store.planningStageAttempts.put(attempt.id, attempt) },
          { stepId: 'checkpoint', table: 'planning_checkpoints', recordId: checkpoint.id, operation: 'put', execute: async () => this.store.planningCheckpoints.put(checkpoint.id, checkpoint) },
        ],
      })
      await this.publishCheckpointEvent(checkpoint)
      return attempt
    } catch (error) {
      const completedAt = new Date().toISOString()
      attempt = { ...attempt, status: error instanceof WorkflowError && error.code === 'cancelled' ? 'cancelled' : 'failed', errorCode: error instanceof WorkflowError ? error.code : 'planning-stage-failed', durationMs: Math.max(0, Date.parse(completedAt) - Date.parse(startedAt)), completedAt }
      await this.store.planningStageAttempts.put(attempt.id, attempt)
      throw error
    }
  }

  async recordFailedAttempt(error: unknown): Promise<void> {
    const operationId = this.current.id
    const operationAttempts = [...this.store.planningStageAttempts.entries()].map(([, attempt]) => attempt).filter((attempt) => attempt.operationId === operationId)
    if (operationAttempts.some((attempt) => attempt.status === 'failed' || attempt.status === 'cancelled')) return
    const stageAttempts = operationAttempts.filter((attempt) => attempt.stage === this.current.stage)
    const round = stageAttempts.reduce((highest, attempt) => Math.max(highest, attempt.round), 0) + 1
    const completedAt = new Date().toISOString()
    const attempt: PlanningStageAttemptRecord = {
      id: `planning-stage-attempt:${operationId}:${this.current.stage}:${round}`,
      operationId,
      stage: this.current.stage,
      round,
      status: error instanceof WorkflowError && error.code === 'cancelled' ? 'cancelled' : 'failed',
      inputDigest: digestObject({ operationId, stage: this.current.stage, operation: this.current }),
      errorCode: error instanceof WorkflowError ? error.code : 'planning-stage-failed',
      createdAt: completedAt,
      completedAt,
    }
    await this.store.planningStageAttempts.put(attempt.id, attempt)
  }
}
