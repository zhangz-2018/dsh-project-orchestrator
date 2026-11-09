import type { OrchestratorStore } from '../storage.js'
import type { ProjectRecord, StorageMutationIntentRecordV2, StorageMutationPayloadRecord, StorageRecoveryAttemptRecord } from '../types.js'
import { digestObject, WorkflowError } from '../workflow.js'

export type RecoveryAction = 'finalize' | 'replay' | 'compensate'
type ObservedStepState = 'before' | 'after' | 'diverged' | 'unavailable'
type RecoverableValue = { state: 'absent' } | { state: 'present'; value: unknown }
type FrozenRecordState = { state: 'absent' } | { state: 'present'; digest: string; valueRef: string }
interface FrozenRecoverableWrite {
  stepId: string
  table: string
  recordId: string
  before: FrozenRecordState
  after: FrozenRecordState
}

interface RecordTable {
  get(id: string): unknown
  put(id: string, value: unknown): Promise<void>
  delete(id: string): Promise<boolean>
}

export interface RecoverableWriteInput {
  stepId: string
  table: string
  recordId: string
  before: RecoverableValue
  after: RecoverableValue
}

export interface RecoveryPreview {
  intentId: string
  intentDigest: string
  observedStateDigest: string
  projectRevision: number
  expectedProjectPointerDigest: string
  verdict: 'already_applied' | 'replay_safe' | 'compensation_safe' | 'manual_required'
  allowedActions: RecoveryAction[]
  steps: Array<{ stepId: string; actual: ObservedStepState }>
  reasons: Array<{ code: string; subjectIds: string[] }>
  previewDigest: string
}

export interface RecoveryExecuteInput {
  expectedIntentDigest: string
  previewDigest: string
  expectedProjectRevision: number
  action: RecoveryAction
  idempotencyKey: string
  requestedBy: string
  reason: string
}

const TABLE_BINDINGS = {
  projects: 'projects',
  tasks: 'tasks',
  plan_snapshots: 'planSnapshots',
  requirement_bundles: 'requirementBundles',
  requirement_items: 'requirementItems',
  requirement_decisions: 'requirementDecisions',
  acceptance_criteria: 'acceptanceCriteria',
  verification_specs: 'verificationSpecs',
  verification_evidence: 'verificationEvidence',
  verification_invocations: 'verificationInvocations',
  planning_operations: 'planningOperations',
  planning_checkpoints: 'planningCheckpoints',
} as const

function tableFor(store: OrchestratorStore, name: string): RecordTable | undefined {
  const property = TABLE_BINDINGS[name as keyof typeof TABLE_BINDINGS]
  if (property === undefined) return undefined
  return store[property] as unknown as RecordTable
}

function storedState(value: unknown): { state: 'absent' } | { state: 'present'; digest: string } {
  return value === undefined ? { state: 'absent' } : { state: 'present', digest: digestObject(value) }
}

function stateMatches(actual: ReturnType<typeof storedState>, expected: FrozenRecordState): boolean {
  return actual.state === expected.state && (actual.state === 'absent' || actual.digest === (expected as { state: 'present'; digest: string }).digest)
}

export function projectPointerDigest(project: ProjectRecord): string {
  return digestObject({
    revision: project.revision,
    status: project.status,
    currentPlanSnapshotId: project.currentPlanSnapshotId,
    activePlanningOperationId: project.activePlanningOperationId,
    activeDecompositionKey: project.activeDecompositionKey,
    activeDecompositionDigest: project.activeDecompositionDigest,
  })
}

export function recoverableIntentDigest(intent: Omit<StorageMutationIntentRecordV2, 'intentDigest' | 'completedStepIds' | 'status' | 'errorCode' | 'error' | 'createdAt' | 'updatedAt' | 'completedAt'>): string {
  return digestObject(intent)
}

function immutableIntentCore(intent: StorageMutationIntentRecordV2): Parameters<typeof recoverableIntentDigest>[0] {
  return {
    schemaVersion: 2,
    id: intent.id,
    projectId: intent.projectId,
    aggregateType: intent.aggregateType,
    aggregateId: intent.aggregateId,
    idempotencyKey: intent.idempotencyKey,
    handler: intent.handler,
    expectedProjectRevision: intent.expectedProjectRevision,
    expectedProjectPointerDigest: intent.expectedProjectPointerDigest,
    expectedWrites: intent.expectedWrites,
    expectedEvents: intent.expectedEvents,
  }
}

export class StorageReconciliationService {
  constructor(private readonly store: OrchestratorStore) {}

  async prepare(input: {
    id: string
    projectId: string
    aggregateType: string
    aggregateId: string
    idempotencyKey: string
    handler: StorageMutationIntentRecordV2['handler']
    expectedProjectRevision: number
    expectedProjectPointerDigest: string
    writes: RecoverableWriteInput[]
  }): Promise<StorageMutationIntentRecordV2> {
    if (input.writes.length === 0) throw new WorkflowError('storage-recovery-intent-invalid', 'A recoverable intent requires at least one write.', 500)
    const identities = input.writes.map((write) => `${write.table}\u0000${write.recordId}`)
    if (new Set(input.writes.map((write) => write.stepId)).size !== input.writes.length || new Set(identities).size !== identities.length) throw new WorkflowError('storage-recovery-intent-invalid', 'Recoverable steps and table/record targets must be unique.', 500)
    if (input.writes.some((write) => tableFor(this.store, write.table) === undefined || digestObject(write.before) === digestObject(write.after))) throw new WorkflowError('storage-recovery-intent-invalid', 'Recoverable writes must use supported tables and change record state.', 500)

    const createdAt = new Date().toISOString()
    const payloads: StorageMutationPayloadRecord[] = []
    const expectedWrites = input.writes.map((write) => {
      const state = (phase: 'before' | 'after', value: RecoverableValue) => {
        if (value.state === 'absent') return { state: 'absent' as const }
        const valueRef = `${input.id}:payload:${write.stepId}:${phase}`
        payloads.push({
          id: valueRef,
          intentId: input.id,
          stepId: write.stepId,
          phase,
          table: write.table,
          recordId: write.recordId,
          payloadDigest: digestObject(value.value),
          value: structuredClone(value.value),
          createdAt,
        })
        return { state: 'present' as const, digest: digestObject(value.value), valueRef }
      }
      return { stepId: write.stepId, table: write.table, recordId: write.recordId, before: state('before', write.before), after: state('after', write.after) }
    })
    const core = {
      schemaVersion: 2 as const,
      id: input.id,
      projectId: input.projectId,
      aggregateType: input.aggregateType,
      aggregateId: input.aggregateId,
      idempotencyKey: input.idempotencyKey,
      handler: input.handler,
      expectedProjectRevision: input.expectedProjectRevision,
      expectedProjectPointerDigest: input.expectedProjectPointerDigest,
      expectedWrites,
      expectedEvents: [],
    }
    const intentDigest = recoverableIntentDigest(core)
    const existing = this.store.storageMutationIntents.get(input.id)
    if (existing !== undefined) {
      if (!('schemaVersion' in existing) || existing.schemaVersion !== 2 || existing.intentDigest !== intentDigest) throw new WorkflowError('storage-unit-of-work-conflict', 'The mutation intent id is already bound to different recoverable writes.', 409)
      return existing
    }
    for (const payload of payloads) {
      const current = this.store.storageMutationPayloads.get(payload.id)
      if (current !== undefined && (current.payloadDigest !== payload.payloadDigest || current.intentId !== input.id)) throw new WorkflowError('storage-recovery-payload-conflict', 'A mutation payload reference is already bound to different content.', 409)
      if (current === undefined) await this.store.storageMutationPayloads.put(payload.id, payload)
    }
    const intent: StorageMutationIntentRecordV2 = { ...core, completedStepIds: [], status: 'pending', intentDigest, createdAt, updatedAt: createdAt }
    await this.store.storageMutationIntents.put(intent.id, intent)
    return intent
  }

  preview(intentId: string): RecoveryPreview {
    const raw = this.store.storageMutationIntents.get(intentId)
    if (raw === undefined) throw new WorkflowError('reconciliation-intent-not-found', 'Storage mutation intent was not found.', 404)
    const project = raw.projectId === undefined ? undefined : this.store.projects.get(raw.projectId)
    if (!('schemaVersion' in raw) || raw.schemaVersion !== 2 || project === undefined) {
      const core = {
        intentId: raw.id,
        intentDigest: raw.intentDigest,
        observedStateDigest: digestObject({ legacy: true, status: raw.status }),
        projectRevision: project?.revision ?? -1,
        expectedProjectPointerDigest: '',
        verdict: 'manual_required' as const,
        allowedActions: [] as RecoveryAction[],
        steps: (raw.expectedWrites as Array<{ stepId: string }>).map((write) => ({ stepId: write.stepId, actual: 'unavailable' as const })),
        reasons: [{ code: 'reconciliation_v1_not_replayable', subjectIds: [raw.id] }],
      }
      return { ...core, previewDigest: digestObject(core) }
    }
    if (recoverableIntentDigest(immutableIntentCore(raw)) !== raw.intentDigest) throw new WorkflowError('reconciliation-intent-corrupt', 'Recoverable intent digest does not match its immutable content.', 409)
    const writes = raw.expectedWrites as FrozenRecoverableWrite[]
    const steps: RecoveryPreview['steps'] = writes.map((write: FrozenRecoverableWrite) => {
      const table = tableFor(this.store, write.table)
      if (table === undefined) return { stepId: write.stepId, actual: 'unavailable' as const }
      const actual = storedState(table.get(write.recordId))
      if (stateMatches(actual, write.after)) return { stepId: write.stepId, actual: 'after' as const }
      if (stateMatches(actual, write.before)) return { stepId: write.stepId, actual: 'before' as const }
      return { stepId: write.stepId, actual: 'diverged' as const }
    })
    const projectPointerCurrent = projectPointerDigest(project)
    const projectWrite = writes.find((write: FrozenRecoverableWrite) => write.table === 'projects' && write.recordId === raw.projectId)
    const projectStep = projectWrite === undefined ? undefined : steps.find((step: RecoveryPreview['steps'][number]) => step.stepId === projectWrite.stepId)
    const unavailable = steps.filter((step: RecoveryPreview['steps'][number]) => step.actual === 'unavailable')
    const diverged = steps.filter((step: RecoveryPreview['steps'][number]) => step.actual === 'diverged')
    const allAfter = steps.every((step: RecoveryPreview['steps'][number]) => step.actual === 'after')
    const allBefore = steps.every((step: RecoveryPreview['steps'][number]) => step.actual === 'before')
    const pointerRecognized = projectPointerCurrent === raw.expectedProjectPointerDigest || projectStep?.actual === 'after'
    let verdict: RecoveryPreview['verdict']
    let allowedActions: RecoveryAction[]
    const reasons: RecoveryPreview['reasons'] = []
    if (raw.status === 'committed' || allAfter) {
      verdict = 'already_applied'; allowedActions = ['finalize']
    } else if (raw.status === 'compensated') {
      verdict = 'manual_required'; allowedActions = []; reasons.push({ code: 'reconciliation_already_compensated', subjectIds: [raw.id] })
    } else if (!pointerRecognized || unavailable.length > 0 || diverged.length > 0) {
      verdict = 'manual_required'; allowedActions = []
      if (!pointerRecognized) reasons.push({ code: 'reconciliation_project_pointer_diverged', subjectIds: [raw.projectId] })
      if (unavailable.length > 0) reasons.push({ code: 'reconciliation_record_unavailable', subjectIds: unavailable.map((step: RecoveryPreview['steps'][number]) => step.stepId) })
      if (diverged.length > 0) reasons.push({ code: 'reconciliation_record_diverged', subjectIds: diverged.map((step: RecoveryPreview['steps'][number]) => step.stepId) })
    } else if (allBefore) {
      verdict = 'replay_safe'; allowedActions = ['replay']
    } else if (projectStep?.actual === 'before') {
      verdict = 'compensation_safe'; allowedActions = ['replay', 'compensate']
    } else {
      verdict = 'replay_safe'; allowedActions = ['replay']
    }
    const observedStateDigest = digestObject({ projectRevision: project.revision, projectPointerCurrent, steps })
    const core = { intentId: raw.id, intentDigest: raw.intentDigest, observedStateDigest, projectRevision: project.revision, expectedProjectPointerDigest: raw.expectedProjectPointerDigest, verdict, allowedActions, steps, reasons }
    return { ...core, previewDigest: digestObject(core) }
  }

  listAttempts(intentId: string): StorageRecoveryAttemptRecord[] {
    return [...this.store.storageRecoveryAttempts.entries()].map(([, attempt]) => attempt).filter((attempt) => attempt.intentId === intentId).sort((left, right) => left.createdAt.localeCompare(right.createdAt))
  }

  async applyPrepared(intentId: string): Promise<StorageMutationIntentRecordV2> {
    const raw = this.store.storageMutationIntents.get(intentId)
    if (raw === undefined || !('schemaVersion' in raw) || raw.schemaVersion !== 2) throw new WorkflowError('storage-recovery-intent-invalid', 'A prepared V2 mutation intent is required.', 500)
    if (raw.status === 'committed') return raw
    if (raw.status !== 'pending') throw new WorkflowError('storage-needs-reconciliation', 'The prepared mutation intent is not safe for blind execution.', 500)
    let intent = raw
    try {
      for (const write of raw.expectedWrites as FrozenRecoverableWrite[]) {
        const table = tableFor(this.store, write.table)!
        const actual = storedState(table.get(write.recordId))
        if (!stateMatches(actual, write.after)) {
          if (!stateMatches(actual, write.before)) throw new WorkflowError('reconciliation-stale', `Prepared step ${write.stepId} does not match its frozen before state.`, 409)
          await this.applyState(raw, write, 'after', write.after, table)
        }
        if (!intent.completedStepIds.includes(write.stepId)) {
          intent = { ...intent, completedStepIds: [...intent.completedStepIds, write.stepId], updatedAt: new Date().toISOString() }
          await this.store.storageMutationIntents.put(intent.id, intent)
        }
      }
      const completedAt = new Date().toISOString()
      intent = { ...intent, status: 'committed', completedAt, updatedAt: completedAt }
      await this.store.storageMutationIntents.put(intent.id, intent)
      return intent
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      const uncertain: StorageMutationIntentRecordV2 = { ...intent, status: 'needs_reconciliation', errorCode: error instanceof WorkflowError ? error.code : 'storage-step-failed', error: message.slice(0, 20_000), updatedAt: new Date().toISOString() }
      try { await this.store.storageMutationIntents.put(uncertain.id, uncertain) } catch { /* The durable pending intent remains the recovery signal. */ }
      throw new WorkflowError('storage-needs-reconciliation', `Storage mutation ${intent.id} requires reconciliation: ${message}`, 500)
    }
  }

  async execute(intentId: string, input: RecoveryExecuteInput): Promise<StorageRecoveryAttemptRecord> {
    const raw = this.store.storageMutationIntents.get(intentId)
    if (raw === undefined) throw new WorkflowError('reconciliation-intent-not-found', 'Storage mutation intent was not found.', 404)
    if (!('schemaVersion' in raw) || raw.schemaVersion !== 2) throw new WorkflowError('reconciliation-manual-required', 'Legacy mutation intents do not contain replayable facts.', 409)
    const requestCore = { intentId, expectedIntentDigest: input.expectedIntentDigest, previewDigest: input.previewDigest, expectedProjectRevision: input.expectedProjectRevision, action: input.action, requestedBy: input.requestedBy, reason: input.reason }
    const requestDigest = digestObject(requestCore)
    const replay = this.listAttempts(intentId).find((attempt) => attempt.idempotencyKey === input.idempotencyKey)
    if (replay !== undefined) {
      if (replay.requestDigest !== requestDigest) throw new WorkflowError('reconciliation-idempotency-conflict', 'Recovery idempotency key is already bound to another request.', 409)
      return replay
    }
    const preview = this.preview(intentId)
    if (raw.intentDigest !== input.expectedIntentDigest || preview.previewDigest !== input.previewDigest || preview.projectRevision !== input.expectedProjectRevision) throw new WorkflowError('reconciliation-stale', 'Recovery facts changed after preview; refresh before executing.', 409)
    if (!preview.allowedActions.includes(input.action)) throw new WorkflowError('reconciliation-manual-required', 'The requested recovery action is not allowed by the current preview.', 409)
    const createdAt = new Date().toISOString()
    let attempt: StorageRecoveryAttemptRecord = {
      id: `storage-recovery:${intentId}:${digestObject(input.idempotencyKey).slice(0, 24)}`,
      intentId,
      projectId: raw.projectId,
      intentDigest: raw.intentDigest,
      previewDigest: preview.previewDigest,
      observedStateDigest: preview.observedStateDigest,
      action: input.action,
      idempotencyKey: input.idempotencyKey,
      requestDigest,
      status: 'running',
      completedStepIds: [],
      requestedBy: input.requestedBy,
      reason: input.reason,
      createdAt,
    }
    await this.store.storageRecoveryAttempts.put(attempt.id, attempt)
    try {
      if (input.action !== 'finalize') {
        const writes = input.action === 'compensate' ? [...raw.expectedWrites as FrozenRecoverableWrite[]].reverse() : raw.expectedWrites as FrozenRecoverableWrite[]
        for (const write of writes) {
          const source = input.action === 'compensate' ? write.after : write.before
          const target = input.action === 'compensate' ? write.before : write.after
          const table = tableFor(this.store, write.table)!
          const actual = storedState(table.get(write.recordId))
          if (!stateMatches(actual, target)) {
            if (!stateMatches(actual, source)) throw new WorkflowError('reconciliation-stale', `Recovery step ${write.stepId} no longer matches its source state.`, 409)
            await this.applyState(raw, write, input.action === 'compensate' ? 'before' : 'after', target, table)
          }
          attempt = { ...attempt, completedStepIds: [...attempt.completedStepIds, write.stepId] }
          await this.store.storageRecoveryAttempts.put(attempt.id, attempt)
        }
      }
      const completedAt = new Date().toISOString()
      const result = input.action === 'compensate' ? 'compensated' as const : 'committed' as const
      const finalIntent: StorageMutationIntentRecordV2 = {
        ...raw,
        completedStepIds: result === 'committed' ? (raw.expectedWrites as FrozenRecoverableWrite[]).map((write: FrozenRecoverableWrite) => write.stepId) : [],
        status: result,
        completedAt,
        updatedAt: completedAt,
      }
      delete finalIntent.errorCode
      delete finalIntent.error
      await this.store.storageMutationIntents.put(raw.id, finalIntent)
      attempt = { ...attempt, status: 'completed', result, completedAt }
      await this.store.storageRecoveryAttempts.put(attempt.id, attempt)
      return attempt
    } catch (error) {
      const completedAt = new Date().toISOString()
      const message = error instanceof Error ? error.message : String(error)
      const errorCode = error instanceof WorkflowError ? error.code : 'reconciliation-execution-failed'
      await Promise.allSettled([
        this.store.storageMutationIntents.put(raw.id, { ...raw, status: 'needs_reconciliation', errorCode, error: message.slice(0, 20_000), updatedAt: completedAt }),
        this.store.storageRecoveryAttempts.put(attempt.id, { ...attempt, status: 'failed', errorCode, error: message.slice(0, 20_000), completedAt }),
      ])
      throw error
    }
  }

  private async applyState(
    intent: StorageMutationIntentRecordV2,
    write: FrozenRecoverableWrite,
    phase: 'before' | 'after',
    target: FrozenRecordState,
    table: RecordTable,
  ): Promise<void> {
    if (target.state === 'absent') {
      await table.delete(write.recordId)
      return
    }
    const payload = this.store.storageMutationPayloads.get(target.valueRef)
    if (payload === undefined || payload.intentId !== intent.id || payload.stepId !== write.stepId || payload.phase !== phase || payload.table !== write.table || payload.recordId !== write.recordId || payload.payloadDigest !== target.digest || digestObject(payload.value) !== target.digest) throw new WorkflowError('reconciliation-payload-invalid', `Recovery payload for ${write.stepId} is missing, corrupt, or cross-intent.`, 409)
    await table.put(write.recordId, structuredClone(payload.value))
  }
}
