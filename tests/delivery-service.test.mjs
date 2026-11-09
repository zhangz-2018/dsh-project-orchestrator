import assert from 'node:assert/strict'
import test from 'node:test'
import { DeliveryRecordSchema, DeliveryService, digestObject } from '../lib/index.js'

class MemoryTable {
  records = new Map()
  get(key) { return this.records.get(key) }
  entries() { return this.records.entries() }
  async put(key, value) { this.records.set(key, structuredClone(value)) }
  async delete(key) { return this.records.delete(key) }
}

test('DeliveryService owns projection, immutable persistence, confirmation, and close transitions', async () => {
  const now = '2026-09-22T00:00:00.000Z'
  const store = {
    projects: new MemoryTable(),
    verificationEvidence: new MemoryTable(),
    projectReviews: new MemoryTable(),
    deliveryRecords: new MemoryTable(),
    activity: new MemoryTable(),
    deliveryIntegrationIntents: new MemoryTable(),
    deliveryIntegrationSnapshots: new MemoryTable(),
    deliveryConvergenceReviews: new MemoryTable(),
  }
  const activities = []
  const activityFailures = new Set()
  let serializedMutations = 0
  const deliveryService = new DeliveryService(store, {
    serializedMutation: async (operation) => { serializedMutations += 1; return operation() },
    recordActivity: async (activity) => {
      if (activityFailures.delete(activity.type)) throw new Error(`injected ${activity.type} activity failure`)
      const existing = store.activity.get(activity.id)
      if (existing === undefined) {
        activities.push(activity)
        await store.activity.put(activity.id, activity)
      }
    },
    inspectCanonicalTarget: async () => ({ head: 'final-commit\n', status: '' }),
    captureRepositorySnapshot: async () => { throw new Error('not used') },
  })
  store.unresolvedDeliveryIntegrationIntents = (projectId) => [...store.deliveryIntegrationIntents.records.values()].filter((item) => item.projectId === projectId && item.status !== 'committed')
  const project = {
    id: 'project-1', name: 'Delivery', summary: '', prd: '', technicalDesign: '', owner: 'owner', cwd: '/repo',
    status: 'completed', deliveryStage: 'delivery_ready', revision: 1, taskIds: [], resourceIds: [], issueIds: [],
    planningContractVersion: 3, currentPlanSnapshotId: 'plan-1', currentDeliveryIntegrationSnapshotId: 'integration-1', currentDeliveryConvergenceReviewId: 'convergence-1',
    createdAt: now, updatedAt: now,
  }
  await store.projects.put(project.id, project)
  await store.verificationEvidence.put('evidence-old', { id: 'evidence-old', projectId: project.id, taskId: 'task-1', taskRunId: 'run-1', attempt: 1, acceptanceIds: [], kind: 'test_command', status: 'failed', createdAt: now })
  await store.verificationEvidence.put('evidence-current', { id: 'evidence-current', projectId: project.id, taskId: 'task-1', taskRunId: 'run-2', attempt: 2, acceptanceIds: [], kind: 'test_command', status: 'passed', createdAt: '2026-09-22T00:01:00.000Z' })
  await store.projectReviews.put('review-1', { id: 'review-1', projectId: project.id, revision: 1, evidenceIds: ['evidence-current'], status: 'approved', reviewerType: 'human', reviewerId: 'reviewer', summary: 'approved', createdAt: now, resolvedAt: now })
  await store.deliveryIntegrationSnapshots.put('integration-1', { id: 'integration-1', projectId: project.id, approvedPlanSnapshotId: 'plan-1', status: 'ready', casStatus: 'matched', targetClean: true, targetRef: 'refs/heads/main', finalCommit: 'final-commit', createdAt: now })
  await store.deliveryConvergenceReviews.put('convergence-1', { id: 'convergence-1', projectId: project.id, approvedPlanSnapshotId: 'plan-1', deliveryIntegrationSnapshotId: 'integration-1', integratedFinalCommit: 'final-commit', status: 'converged', findingIds: [], createdAt: now })

  const delivery = { id: 'delivery-1', projectId: project.id, revision: 1, planSnapshotId: 'plan-1', reviewId: 'review-1', evidenceIds: ['evidence-current'], repository: '/repo', headCommit: 'final-commit', branch: 'refs/heads/main', worktree: '/repo', changedFiles: [], knownRisks: [], rollbackSteps: [], handoffMode: 'local_review', status: 'ready', createdAt: now }
  delivery.immutableDigest = digestObject(deliveryService.deliveryImmutableFields(delivery))
  await deliveryService.putDeliveryRecord(delivery)

  const projection = deliveryService.getProjectDelivery(project.id)
  assert.equal(projection.ready, true)
  assert.deepEqual(projection.blockers, [])
  assert.equal(projection.evidence.length, 2)

  activityFailures.add('project.delivery_confirmed')
  const confirmed = await deliveryService.confirmProjectDelivery(project.id, { actor: 'reviewer', note: 'confirmed' })
  assert.equal(confirmed.status, 'delivered')
  assert.equal(store.projects.get(project.id).deliveryStage, 'delivered')
  assert.equal(serializedMutations, 1)
  assert.equal(activities.length, 0)
  assert.deepEqual(confirmed.pendingAuditEvents, ['project.delivery_confirmed'])
  assert.doesNotThrow(() => DeliveryRecordSchema.parse(confirmed))

  const confirmedReplay = await deliveryService.confirmProjectDelivery(project.id, { actor: 'reviewer', note: 'confirmed' })
  assert.deepEqual(confirmedReplay.pendingAuditEvents, [])
  assert.equal(confirmedReplay.deliveredAt, confirmed.deliveredAt)
  assert.equal(serializedMutations, 3)
  assert.equal(activities[0].type, 'project.delivery_confirmed')
  assert.equal(activities[0].id, 'activity:project.delivery_confirmed:delivery-1')

  activityFailures.add('project.delivery_closed')
  const closed = await deliveryService.closeProjectDelivery(project.id, { actor: 'reviewer', note: 'closed' })
  assert.equal(closed.status, 'closed')
  assert.equal(closed.closedBy, 'reviewer')
  assert.equal(store.projects.get(project.id).deliveryStage, 'closed')
  assert.equal(serializedMutations, 4)
  assert.equal(activities.length, 1)
  assert.deepEqual(closed.pendingAuditEvents, ['project.delivery_closed'])
  assert.doesNotThrow(() => DeliveryRecordSchema.parse(closed))

  const closedReplay = await deliveryService.closeProjectDelivery(project.id, { actor: 'reviewer', note: 'closed' })
  assert.deepEqual(closedReplay.pendingAuditEvents, [])
  assert.equal(closedReplay.closedAt, closed.closedAt)
  assert.equal(serializedMutations, 6)
  assert.equal(activities[1].type, 'project.delivery_closed')
  assert.equal(activities[1].id, 'activity:project.delivery_closed:delivery-1')

  activityFailures.add('project.delivery_closed')
  await store.deliveryRecords.put(closed.id, { ...closed, pendingAuditEvents: ['project.delivery_closed'] })
  await store.activity.delete('activity:project.delivery_closed:delivery-1')
  const restarted = new DeliveryService(store, {
    serializedMutation: async (operation) => { serializedMutations += 1; return operation() },
    recordActivity: async (activity) => {
      if (activityFailures.delete(activity.type)) throw new Error('injected restart audit failure')
      if (store.activity.get(activity.id) === undefined) await store.activity.put(activity.id, activity)
    },
    inspectCanonicalTarget: async () => ({ head: 'final-commit\n', status: '' }),
    captureRepositorySnapshot: async () => { throw new Error('not used') },
  })
  await restarted.reconcilePendingDeliveryAudits()
  assert.deepEqual(store.deliveryRecords.get(closed.id).pendingAuditEvents, ['project.delivery_closed'])
  await restarted.reconcilePendingDeliveryAudits()
  assert.deepEqual(store.deliveryRecords.get(closed.id).pendingAuditEvents, [])
  assert.equal(store.activity.get('activity:project.delivery_closed:delivery-1').type, 'project.delivery_closed')
  assert.equal(activities.length, 2)

  await assert.rejects(
    () => deliveryService.putDeliveryRecord({ ...closed, headCommit: 'tampered-commit' }),
    (error) => error.code === 'delivery-record-immutable',
  )
})

test('DeliveryService completes execution with a review, delivery record, and terminal Run', async (t) => {
  for (const failure of ['none', 'project', 'run']) {
    await t.test(failure, async () => {
      const now = '2026-09-22T00:00:00.000Z'
      const store = {
        projects: new MemoryTable(),
        runs: new MemoryTable(),
        tasks: new MemoryTable(),
        taskRuns: new MemoryTable(),
        artifacts: new MemoryTable(),
        activity: new MemoryTable(),
        delegations: new MemoryTable(),
        decisions: new MemoryTable(),
        acceptanceCriteria: new MemoryTable(),
        verificationEvidence: new MemoryTable(),
        projectReviews: new MemoryTable(),
        deliveryRecords: new MemoryTable(),
        projectTasks(project) { return project.taskIds.map((id) => this.tasks.get(id)) },
      }
      const project = { id: 'project-1', name: 'Delivery', cwd: '/repo', status: 'running', deliveryStage: 'executing', revision: 1, taskIds: ['task-1'], activeRunId: 'run-1', createdAt: now, updatedAt: now }
      const run = { id: 'run-1', projectId: project.id, status: 'running', currentTaskId: 'task-1', createdAt: now }
      const task = { id: 'task-1', projectId: project.id, title: 'Task', attemptCount: 1 }
      await store.projects.put(project.id, project)
      await store.runs.put(run.id, run)
      await store.tasks.put(task.id, task)
      await store.taskRuns.put('task-run-1', { id: 'task-run-1', projectId: project.id, taskId: task.id, runId: run.id, status: 'completed', attempt: 1, artifactIds: [], changedFiles: ['feature.txt'], testExitCode: 0 })
      await store.verificationEvidence.put('evidence-1', { id: 'evidence-1', projectId: project.id, taskId: task.id, taskRunId: 'task-run-1', attempt: 1, status: 'passed', actorType: 'system', artifactIds: [], createdAt: now })
      await store.acceptanceCriteria.put('acceptance-1', { id: 'acceptance-1', projectId: project.id, status: 'verified', evidenceIds: ['evidence-1'] })
      const service = new DeliveryService(store, {
        serializedMutation: (operation) => operation(),
        recordActivity: async () => {},
        inspectCanonicalTarget: async () => ({ head: '', status: '' }),
        captureRepositorySnapshot: async () => { throw new Error('not used') },
      })
      if (failure === 'project') {
        const put = store.projects.put.bind(store.projects)
        store.projects.put = async (id, value) => {
          if (value.status === 'completed') throw new Error('injected project write failure')
          return put(id, value)
        }
      }
      if (failure === 'run') {
        store.runs.put = async () => { throw new Error('injected run write failure') }
      }

      if (failure !== 'none') {
        await assert.rejects(() => service.completeExecutionForReview(project.id, run.id), new RegExp(`injected ${failure} write failure`))
        assert.deepEqual(store.projects.get(project.id), project)
        assert.equal(store.projectReviews.get(`${project.id}:review:r1`), undefined)
        assert.equal(store.deliveryRecords.get(`${project.id}:delivery:r1`), undefined)
        assert.deepEqual(store.runs.get(run.id), run)
        return
      }

      const delivery = await service.completeExecutionForReview(project.id, run.id)
      assert.equal(delivery.status, 'ready')
      assert.deepEqual(delivery.responsibilityChain.tasks.map((item) => item.taskRunIds), [['task-run-1']])
      assert.deepEqual(delivery.responsibilityChain.verifications.map((item) => item.evidenceId), ['evidence-1'])
      assert.equal(store.projectReviews.get(delivery.reviewId).acceptanceResults[0].result, 'passed')
      assert.equal(store.projects.get(project.id).deliveryStage, 'review')
      assert.equal(store.projects.get(project.id).activeRunId, undefined)
      assert.equal(store.runs.get(run.id).status, 'completed')
    })
  }
})

test('DeliveryService owns changes-required completion and restores the Run when Project persistence fails', async () => {
  const now = '2026-09-22T00:00:00.000Z'
  const store = {
    projects: new MemoryTable(),
    runs: new MemoryTable(),
  }
  const project = { id: 'project-1', status: 'running', deliveryStage: 'executing', activeRunId: 'run-1', revision: 1, createdAt: now, updatedAt: now }
  const run = { id: 'run-1', projectId: project.id, status: 'running', currentTaskId: 'task-1', createdAt: now }
  const integration = { id: 'integration-1', finalCommit: 'final-commit' }
  const convergence = { id: 'convergence-1', status: 'changes_required', deliveryIntegrationSnapshotId: integration.id, integratedFinalCommit: integration.finalCommit, findingIds: ['finding-1'] }
  await store.projects.put(project.id, project)
  await store.runs.put(run.id, run)
  const activities = []
  const service = new DeliveryService(store, {
    serializedMutation: (operation) => operation(),
    recordActivity: async (activity) => { activities.push(activity) },
    inspectCanonicalTarget: async () => ({ head: '', status: '' }),
    captureRepositorySnapshot: async () => { throw new Error('not used') },
  })
  const putProject = store.projects.put.bind(store.projects)
  store.projects.put = async (id, value) => {
    if (value.status === 'approved') throw new Error('injected project write failure')
    return putProject(id, value)
  }

  await assert.rejects(() => service.completeExecutionWithChangesRequired(project.id, run.id, integration, convergence), /injected project write failure/u)
  assert.deepEqual(store.projects.get(project.id), project)
  assert.deepEqual(store.runs.get(run.id), run)
  assert.equal(activities.length, 0)

  store.projects.put = putProject
  await service.completeExecutionWithChangesRequired(project.id, run.id, integration, convergence)
  assert.equal(store.projects.get(project.id).deliveryStage, 'changes_required')
  assert.equal(store.projects.get(project.id).activeRunId, undefined)
  assert.equal(store.runs.get(run.id).status, 'completed')
  assert.equal(activities[0].type, 'delivery.convergence_changes_required')
})

test('late audit reconciliation cannot overwrite a concurrently closed delivery', async () => {
  const now = '2026-09-22T00:00:00.000Z'
  const store = { projects: new MemoryTable(), deliveryRecords: new MemoryTable() }
  const project = { id: 'project-1', revision: 1, status: 'completed', deliveryStage: 'delivered', createdAt: now, updatedAt: now }
  const delivery = { id: 'delivery-1', projectId: project.id, revision: 1, evidenceIds: [], changedFiles: [], knownRisks: [], rollbackSteps: [], handoffMode: 'local_review', status: 'delivered', deliveredBy: 'reviewer', deliveredAt: now, pendingAuditEvents: ['project.delivery_confirmed'], createdAt: now }
  await store.projects.put(project.id, project)
  await store.deliveryRecords.put(delivery.id, delivery)
  let releaseFirst
  let firstStarted
  const firstGate = new Promise((resolve) => { releaseFirst = resolve })
  const started = new Promise((resolve) => { firstStarted = resolve })
  let firstConfirmation = true
  const events = new Set()
  const service = new DeliveryService(store, {
    serializedMutation: (operation) => operation(),
    recordActivity: async (activity) => {
      if (activity.type === 'project.delivery_confirmed' && firstConfirmation) {
        firstConfirmation = false
        firstStarted()
        await firstGate
      }
      events.add(activity.id)
    },
    inspectCanonicalTarget: async () => ({ head: '', status: '' }),
    captureRepositorySnapshot: async () => { throw new Error('not used') },
  })

  const lateReconciliation = service.reconcilePendingDeliveryAudits()
  await started
  const closed = await service.closeProjectDelivery(project.id, { actor: 'closer' })
  assert.equal(closed.status, 'closed')
  releaseFirst()
  await lateReconciliation

  const final = store.deliveryRecords.get(delivery.id)
  assert.equal(final.status, 'closed')
  assert.equal(final.closedBy, 'closer')
  assert.deepEqual(final.pendingAuditEvents, [])
  assert.deepEqual([...events].sort(), ['activity:project.delivery_closed:delivery-1', 'activity:project.delivery_confirmed:delivery-1'])
})
