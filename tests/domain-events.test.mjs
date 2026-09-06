import assert from 'node:assert/strict'
import test from 'node:test'
import { OrchestratorStore, digestObject } from '../lib/index.js'

class MemoryTable {
  records = new Map()
  get(id) { return this.records.get(id) }
  entries() { return this.records.entries() }
  async put(id, value) { this.records.set(id, structuredClone(value)) }
  async delete(id) { return this.records.delete(id) }
  async update(id, transform) { const next = transform(this.records.get(id)); await this.put(id, next); return next }
}

function store() {
  const tables = new Map()
  return new OrchestratorStore({ table(name) { if (!tables.has(name)) tables.set(name, new MemoryTable()); return tables.get(name) } })
}

test('DomainEvent append is ordered under concurrent callers and cursor replay has no duplicates', async () => {
  const events = store()
  await Promise.all(Array.from({ length: 20 }, (_, index) => events.appendDomainEvent({
    aggregateType: 'task_run', aggregateId: `run-${index}`, eventType: 'task_run.changed', actor: 'system', projectId: 'project-1',
    payloadDigest: digestObject({ index }),
  })))
  const first = events.readDomainEvents(0, 7)
  const second = events.readDomainEvents(Number(first.nextCursor), 20)
  assert.deepEqual([...first.events, ...second.events].map((event) => event.sequence), Array.from({ length: 20 }, (_, index) => index + 1))
  assert.equal(first.hasMore, true)
  assert.equal(second.hasMore, false)
  assert.equal(second.latestCursor, '20')
})

test('DomainEvent project filtering preserves global events and uses the global cursor', async () => {
  const events = store()
  await events.appendDomainEvent({ aggregateType: 'system', aggregateId: 'global', eventType: 'system.changed', actor: 'system', payloadDigest: 'a'.repeat(64) })
  await events.appendDomainEvent({ aggregateType: 'project', aggregateId: 'project-2', eventType: 'project.changed', actor: 'human', projectId: 'project-2', payloadDigest: 'b'.repeat(64) })
  const page = events.readDomainEvents(0, 100, 'project-1')
  assert.equal(page.events.length, 1)
  assert.equal(page.events[0].aggregateId, 'global')
  assert.equal(page.latestCursor, '2')
})

test('DomainEvent append replays a deterministic event id without duplicating sequence and rejects conflicting reuse', async () => {
  const events = store()
  const input = { eventId: 'planning-event:checkpoint-1', aggregateType: 'planning_operation', aggregateId: 'operation-1', eventType: 'planning.committed.committed', actor: 'system', projectId: 'project-1', operationId: 'operation-1', payloadRef: 'planning-checkpoint:checkpoint-1', payloadDigest: 'd'.repeat(64), occurredAt: '2026-01-01T00:00:00.000Z' }
  const first = await events.appendDomainEvent(input)
  const replay = await events.appendDomainEvent(input)
  assert.deepEqual(replay, first)
  assert.equal(events.readDomainEvents().events.length, 1)
  await assert.rejects(events.appendDomainEvent({ ...input, payloadDigest: 'e'.repeat(64) }), (error) => error.code === 'domain-event-conflict')
})

test('storage capability probe is honest and unresolved intents are observable', async () => {
  const storage = store()
  assert.deepEqual(storage.storageCapabilities(), { transactions: false, compareAndSwap: false, uniqueConstraints: false, orderedAppend: false, serializedDomainWrites: true, durableBeforeMemory: true })
  await storage.storageMutationIntents.put('intent-1', { id: 'intent-1', projectId: 'project-1', aggregateType: 'project', aggregateId: 'project-1', idempotencyKey: 'key', expectedWrites: [{ stepId: 'one', table: 'projects', recordId: 'project-1', operation: 'put' }], completedStepIds: [], status: 'pending', intentDigest: 'c'.repeat(64), createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' })
  assert.deepEqual(storage.unresolvedStorageMutationIntents('project-1').map((intent) => intent.id), ['intent-1'])
  assert.deepEqual(storage.unresolvedStorageMutationIntents('project-2'), [])
})
