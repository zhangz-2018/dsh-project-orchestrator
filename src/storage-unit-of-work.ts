import type { StorageMutationIntentRecord } from './types.js'
import { digestObject, WorkflowError } from './workflow.js'

export interface StorageCapabilities {
  transactions: false
  compareAndSwap: false
  uniqueConstraints: false
  orderedAppend: false
  serializedDomainWrites: true
  durableBeforeMemory: true
}

export const STORAGE_CAPABILITIES: StorageCapabilities = {
  transactions: false,
  compareAndSwap: false,
  uniqueConstraints: false,
  orderedAppend: false,
  serializedDomainWrites: true,
  durableBeforeMemory: true,
}

export interface MutationIntentTable {
  get(id: string): StorageMutationIntentRecord | undefined
  put(id: string, value: StorageMutationIntentRecord): Promise<void>
}

export interface UnitOfWorkStep {
  stepId: string
  table: string
  recordId: string
  operation: 'put' | 'delete'
  execute: () => Promise<void>
}

export interface UnitOfWorkInput {
  id: string
  projectId?: string
  aggregateType: string
  aggregateId: string
  idempotencyKey: string
  steps: UnitOfWorkStep[]
}

function intentCore(input: UnitOfWorkInput) {
  return {
    ...(input.projectId === undefined ? {} : { projectId: input.projectId }),
    aggregateType: input.aggregateType,
    aggregateId: input.aggregateId,
    idempotencyKey: input.idempotencyKey,
    expectedWrites: input.steps.map(({ stepId, table, recordId, operation }) => ({ stepId, table, recordId, operation })),
  }
}

export class StorageUnitOfWork {
  constructor(private readonly intents: MutationIntentTable) {}

  async execute(input: UnitOfWorkInput): Promise<StorageMutationIntentRecord> {
    if (input.steps.length === 0 || new Set(input.steps.map((step) => step.stepId)).size !== input.steps.length) {
      throw new WorkflowError('storage-unit-of-work-invalid', 'A storage UnitOfWork requires unique, non-empty idempotent steps.', 500)
    }
    const core = intentCore(input)
    const intentDigest = digestObject(core)
    const existing = this.intents.get(input.id)
    if (existing !== undefined) {
      if (existing.intentDigest !== intentDigest || existing.idempotencyKey !== input.idempotencyKey) throw new WorkflowError('storage-unit-of-work-conflict', 'The mutation intent id is already bound to different writes.', 409)
      if (existing.status === 'committed') return existing
      if (existing.status === 'needs_reconciliation') throw new WorkflowError('storage-needs-reconciliation', 'The existing mutation intent has an uncertain partial outcome and requires reconciliation.', 500)
    }

    const createdAt = new Date().toISOString()
    let intent: StorageMutationIntentRecord = existing ?? {
      id: input.id,
      ...core,
      completedStepIds: [],
      status: 'pending',
      intentDigest,
      createdAt,
      updatedAt: createdAt,
    }
    if (existing === undefined) await this.intents.put(intent.id, intent)
    try {
      const completed = new Set(intent.completedStepIds)
      for (const step of input.steps) {
        if (completed.has(step.stepId)) continue
        await step.execute()
        intent = { ...intent, completedStepIds: [...intent.completedStepIds, step.stepId], updatedAt: new Date().toISOString() }
        await this.intents.put(intent.id, intent)
      }
      const completedAt = new Date().toISOString()
      intent = { ...intent, status: 'committed', completedAt, updatedAt: completedAt }
      await this.intents.put(intent.id, intent)
      return intent
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      const uncertain: StorageMutationIntentRecord = {
        ...intent,
        status: 'needs_reconciliation',
        errorCode: 'storage-step-failed',
        error: message.slice(0, 20_000),
        updatedAt: new Date().toISOString(),
      }
      try { await this.intents.put(uncertain.id, uncertain) } catch { /* the durable pending intent remains the recovery signal */ }
      throw new WorkflowError('storage-needs-reconciliation', `Storage mutation ${input.id} requires reconciliation: ${message}`, 500)
    }
  }
}
