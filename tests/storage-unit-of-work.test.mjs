import assert from 'node:assert/strict'
import test from 'node:test'
import { StorageUnitOfWork } from '../lib/index.js'

class MemoryIntentTable {
  records = new Map()
  get(id) { return this.records.get(id) }
  async put(id, value) { this.records.set(id, structuredClone(value)) }
}

function input(executed, overrides = {}) {
  return {
    id: 'intent-1',
    projectId: 'project-1',
    aggregateType: 'planning_operation',
    aggregateId: 'operation-1',
    idempotencyKey: 'request-1',
    steps: [
      { stepId: 'one', table: 'records', recordId: 'one', operation: 'put', execute: async () => { executed.push('one') } },
      { stepId: 'two', table: 'records', recordId: 'two', operation: 'put', execute: async () => { executed.push('two') } },
    ],
    ...overrides,
  }
}

test('StorageUnitOfWork commits all steps and returns committed replay without duplicate writes', async () => {
  const table = new MemoryIntentTable()
  const executed = []
  const unit = new StorageUnitOfWork(table)
  const first = await unit.execute(input(executed))
  const replay = await unit.execute(input(executed))
  assert.equal(first.status, 'committed')
  assert.deepEqual(first.completedStepIds, ['one', 'two'])
  assert.deepEqual(replay, first)
  assert.deepEqual(executed, ['one', 'two'])
})

test('StorageUnitOfWork resumes a durable pending intent from its first incomplete idempotent step', async () => {
  const table = new MemoryIntentTable()
  const executed = []
  const unit = new StorageUnitOfWork(table)
  const candidate = input(executed)
  const core = { projectId: candidate.projectId, aggregateType: candidate.aggregateType, aggregateId: candidate.aggregateId, idempotencyKey: candidate.idempotencyKey, expectedWrites: candidate.steps.map(({ stepId, table, recordId, operation }) => ({ stepId, table, recordId, operation })) }
  const { digestObject } = await import('../lib/index.js')
  await table.put(candidate.id, { id: candidate.id, ...core, completedStepIds: ['one'], status: 'pending', intentDigest: digestObject(core), createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' })
  const result = await unit.execute(candidate)
  assert.equal(result.status, 'committed')
  assert.deepEqual(executed, ['two'])
})

test('StorageUnitOfWork marks partial failure for reconciliation and refuses blind replay', async () => {
  const table = new MemoryIntentTable()
  const unit = new StorageUnitOfWork(table)
  const executed = []
  const candidate = input(executed)
  candidate.steps[1].execute = async () => { throw new Error('disk unavailable') }
  await assert.rejects(unit.execute(candidate), (error) => error.code === 'storage-needs-reconciliation')
  assert.equal(table.get(candidate.id).status, 'needs_reconciliation')
  assert.deepEqual(table.get(candidate.id).completedStepIds, ['one'])
  await assert.rejects(unit.execute(input([])), (error) => error.code === 'storage-needs-reconciliation')
})

test('StorageUnitOfWork rejects an intent id reused for different writes', async () => {
  const table = new MemoryIntentTable()
  const unit = new StorageUnitOfWork(table)
  await unit.execute(input([]))
  await assert.rejects(unit.execute(input([], { aggregateId: 'operation-2' })), (error) => error.code === 'storage-unit-of-work-conflict' && error.status === 409)
})

test('StorageUnitOfWork leaves a durable uncertain intent when progress persistence fails', async () => {
  const table = new MemoryIntentTable()
  let puts = 0
  table.put = async (id, value) => {
    puts += 1
    if (puts === 2) throw new Error('progress write failed')
    table.records.set(id, structuredClone(value))
  }
  const executed = []
  await assert.rejects(new StorageUnitOfWork(table).execute(input(executed)), (error) => error.code === 'storage-needs-reconciliation')
  assert.deepEqual(executed, ['one'])
  assert.equal(table.get('intent-1').status, 'needs_reconciliation')
})
