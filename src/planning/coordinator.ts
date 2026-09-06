import type { PlanningCheckpointRecord, PlanningOperationRecord, PlanningStageAttemptRecord } from '../types.js'
import { digestObject } from '../workflow.js'

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
