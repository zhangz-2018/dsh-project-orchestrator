import assert from 'node:assert/strict'
import { Readable } from 'node:stream'
import test from 'node:test'
import { createHttpHandler, OrchestratorService, WorkflowError } from '../lib/index.js'

class MemoryTable {
  records = new Map()
  get size() { return this.records.size }
  get(key) { return this.records.get(key) }
  entries() { return [...this.records.entries()][Symbol.iterator]() }
  async put(key, value) { this.records.set(key, structuredClone(value)) }
  async delete(key) { return this.records.delete(key) }
}

function realServiceStore() {
  const store = {
    agents: new MemoryTable(), projects: new MemoryTable(), tasks: new MemoryTable(), approvals: new MemoryTable(), runs: new MemoryTable(), runtimes: new MemoryTable(), resources: new MemoryTable(), issues: new MemoryTable(), taskRuns: new MemoryTable(), activity: new MemoryTable(), comments: new MemoryTable(), decisions: new MemoryTable(), squads: new MemoryTable(), delegations: new MemoryTable(), transcripts: new MemoryTable(), artifacts: new MemoryTable(), commands: new MemoryTable(), externalTriggers: new MemoryTable(), skills: new MemoryTable(), localDirectoryLocks: new MemoryTable(), workspaceLeases: new MemoryTable(), taskRunConflictLocks: new MemoryTable(), projectAgentMemberships: new MemoryTable(), projectSquadBindings: new MemoryTable(), projectAgentMembershipSources: new MemoryTable(), featureUsageDaily: new MemoryTable(), planSnapshots: new MemoryTable(), requirementBundles: new MemoryTable(), requirementItems: new MemoryTable(), requirementDecisions: new MemoryTable(), acceptanceCriteria: new MemoryTable(), verificationEvidence: new MemoryTable(), projectReviews: new MemoryTable(), deliveryRecords: new MemoryTable(),
    projectTasks(project) { return project.taskIds.map((id) => store.tasks.get(id)) },
    approvalFor(project) { return store.approvals.get(`${project.id}:${project.revision}`) },
  }
  return store
}

async function within(milliseconds, operation) {
  let timeout
  try {
    return await Promise.race([operation, new Promise((_, reject) => { timeout = setTimeout(() => reject(new Error(`operation exceeded ${milliseconds}ms`)), milliseconds) })])
  } finally {
    clearTimeout(timeout)
  }
}

class Request extends Readable {
  constructor({ method = 'GET', url = '/', headers = {}, body = '', remoteAddress = '127.0.0.1' }) {
    super()
    this.method = method
    this.url = url
    this.headers = { ...headers }
    if ((method === 'POST' || method === 'PUT' || body !== '') && !Object.hasOwn(this.headers, 'content-type')) this.headers['content-type'] = 'application/json'
    if (body !== '' && !Object.hasOwn(this.headers, 'content-length')) this.headers['content-length'] = String(Buffer.byteLength(body))
    this.socket = { remoteAddress }
    this.body = body
  }
  _read() {
    this.push(this.body)
    this.push(null)
  }
}

function response() {
  return {
    statusCode: 200,
    headersSent: false,
    headers: new Map(),
    body: '',
    get writableEnded() { return this.headersSent },
    setHeader(name, value) { this.headers.set(name, value) },
    once() { return this },
    removeListener() { return this },
    end(value = '') { this.body += value; this.headersSent = true },
  }
}

function service() {
  return {
    snapshot() { return { projects: [], tasks: [], agents: [], approvals: [], runs: [], planHashes: {}, runtimes: [], resources: [], issues: [], taskRuns: [], activity: [], comments: [], decisions: [], squads: [], delegations: [], transcripts: [], artifacts: [], commands: [], externalTriggers: [], skills: [], workspaceLeases: [], localDirectoryLocks: [], projectAgentMemberships: [], projectSquadBindings: [], projectAgentMembershipSources: [], featureUsageDaily: [], runtimeOverview: { defaultHost: { id: 'default-host', name: '本机默认环境', status: 'online', capabilities: [], boundAgentCount: 0 }, customCount: 0, abnormalCount: 0, archivedCount: 0 }, inbox: [], agentWorkloads: [], runStatistics: [] } },
     async getInbox(query) { return query?.kind ? [{ id: 'filtered', kind: query.kind }] : [] },
     async getAgentWorkloads() { return [] },
     listProjectAgents(projectId) { return [{ id: `${projectId}:agent`, projectId, agentId: 'agent', status: 'active' }] },
     async addProjectAgent(projectId, body) { return { id: `${projectId}:${body.agentId}`, projectId, status: 'active', ...body } },
     async updateProjectAgent(projectId, agentId, body) { return { id: `${projectId}:${agentId}`, projectId, agentId, status: 'active', ...body } },
     async removeProjectAgent(projectId, agentId) { return { id: `${projectId}:${agentId}`, projectId, agentId, status: 'removed' } },
     async addProjectAgents(projectId, body) { return body.members.map((member) => ({ id: `${projectId}:${member.agentId}`, projectId, status: 'active', ...member })) },
     async assignProjectTasks(projectId, body) { return { project: { id: projectId, revision: body.expectedRevision + 1 }, tasks: body.assignments, planHash: 'a'.repeat(64) } },
     async recordFeatureUsage(body) { return { id: `${body.date ?? 'today'}:${body.feature}`, opens: 0, meaningfulActions: 0, errorRecoveries: 0, ...body } },
     async clearFeatureUsage() {},
     async createDecision(body) { return { id: 'decision', status: 'pending', ...body } },
     async executeCommand(body) {
       let result = body
       if (body.type === 'validate_team') result = { ready: false, errors: [], warnings: [], teamDigest: 'a'.repeat(64), assignmentDigest: 'b'.repeat(64), planHash: 'c'.repeat(64) }
       if (body.type === 'resolve_team_blocker') result = { id: 'team-decision', projectId: body.projectId, status: 'pending', ...body.payload }
       if (body.type === 'bind_project_squad' || body.type === 'sync_project_squad') result = { id: `${body.projectId}:${body.squadId}`, projectId: body.projectId, squadId: body.squadId, status: 'active', ...body.payload }
       if (body.type === 'reassign_task') result = { project: { id: body.projectId, revision: body.payload.expectedRevision + 1 }, task: { id: body.payload.taskId, agentId: body.payload.agentId }, planHash: 'a'.repeat(64) }
       return { id: 'command', type: body.type, status: 'completed', result }
     },
     async receiveExternalTrigger(body) { return { id: 'trigger', status: 'processed', ...body } },
     getSquad(id) { return { id, status: 'active' } },
     listProjectSquadBindings(projectId) { return [{ id: `${projectId}:squad`, projectId, squadId: 'squad', status: 'active' }] },
     listProjectAgentMembershipSources(projectId) { return [{ id: `${projectId}:agent:manual:manual`, projectId, agentId: 'agent', sourceType: 'manual', status: 'active' }] },
     getProjectTeamPlan(projectId) { return { project: { id: projectId }, team: { members: [], squads: [], teamDigest: 'a'.repeat(64), capturedAt: 'now' }, tasks: [], preflight: { ready: false, errors: [], warnings: [], teamDigest: 'a'.repeat(64), assignmentDigest: 'b'.repeat(64), planHash: 'c'.repeat(64) } } },
     getProjectTeamImpact(projectId) { return { projectId, revision: 1, tasks: [], acceptanceCriteria: [], planSnapshotIds: [], activeIssues: [], delegations: [], approvalWillInvalidate: false, hasActiveExecution: false } },
     getTeamCollaborationMetrics(projectId) { return { scope: projectId === undefined ? 'all' : 'project', ...(projectId === undefined ? {} : { projectId }), taskCount: 0 } },
     async resolveTeamBlocker(projectId, body) { return { id: 'team-decision', projectId, status: 'pending', ...body } },
     listProjectPlanSnapshots() { return [] },
     listProjectRequirementBundles() { return [] },
     listProjectRequirementItems() { return [] },
     listProjectAcceptanceCriteria() { return [] },
     listProjectRequirementDecisions() { return [] },
     getProjectRequirementMatrix(projectId) { return { project: { id: projectId }, bundles: [], items: [], decisions: [], acceptanceCriteria: [], rows: [] } },
     getProjectDelivery(projectId) { return { project: { id: projectId, deliveryStage: 'delivery_ready' }, evidence: [], ready: false, blockers: ['No evidence.'] } },
     async confirmProjectDelivery(projectId, body) { return { id: `${projectId}:delivery`, status: 'delivered', ...body } },
     listEligibleSquads(projectId) { return [{ projectId, squadId: 'squad', eligible: true }] },
     async bindProjectSquad(projectId, body) { return { id: `${projectId}:${body.squadId}`, projectId, status: 'active', ...body } },
     async syncProjectSquadBinding(projectId, squadId, body) { return { id: `${projectId}:${squadId}`, projectId, squadId, status: 'active', ...body } },
     async setDefaultProjectSquadBinding(projectId, squadId, body) { return { id: `${projectId}:${squadId}`, projectId, squadId, status: 'active', isDefault: true, ...body } },
     async unbindProjectSquad(projectId, squadId, body) { return { id: `${projectId}:${squadId}`, projectId, squadId, status: 'removed', ...body } },
     async createSquad(body) { return { id: 'squad', status: 'active', ...body } },
     async updateSquad(id, body) { return { id, status: 'active', ...body } },
     async cloneSquad(id, body) { return { id: `${id}-clone`, status: 'active', ...body } },
     async archiveSquad(id) { return { id, status: 'archived' } },
     async deleteSquad() {},
     async attachArtifact(body) { return { id: 'artifact', ...body } },
     async resolveDecision(id, body) { return { id, ...body } },
     async handleInboxItem(id, body) { return { itemId: id, result: body } },
    async serializedMutation(operation) { return await operation() },
    async createAgent(body) { return { id: 'agent', ...body } },
     getRuntimeDetail(id) { return { runtime: { id }, agents: [], resources: [], queuedTaskRuns: [], activeTaskRuns: [], affectedProjectIds: [], historyCount: 0 } },
     getAgentRuntimeImpact(agentId, runtimeId) { return { agentId, nextRuntimeId: runtimeId, executableTaskRunIds: [], affectedProjects: [] } },
     async createRuntime(body) { return { id: 'runtime', status: 'online', lifecycle: 'active', ...body } },
     async updateRuntime(id, body) { return { id, status: 'online', lifecycle: 'active', ...body } },
     async archiveRuntime(id) { return { id, status: 'offline', lifecycle: 'archived' } },
     async heartbeatRuntime(id, status) { return { id, status } },
     async bindAgentRuntime(id, body) { return { id, ...body } },
     async bindResourceRuntime(id, body) { return { id, ...body } },
     async deleteRuntime() {},
     async createIssue(body) { return { id: 'issue', ...body } },
     async inspectRepository(body) { return { repositoryUrl: body.repositoryUrl, owner: 'owner', name: 'repo', defaultBranch: 'main', branches: [{ name: 'main', protected: true }], issues: [] } },
     async importRequirementDocument(body) { return { markdown: '# PRD', pageCount: body.pageCount, textPageCount: body.textPageCount, analyzedImagePages: body.images.map((image) => image.page), warnings: [] } },
    async draftAgent() { return { name: 'Draft', role: 'Reviewer', description: '', persona: 'Review.', preset: 'standard', toolPolicy: 'read_only' } },
    async createProjectFromRequest(body) { return { id: 'project', status: body.mode === 'empty' ? 'draft' : 'decomposing', ...body } },
    async linkProjectWorkspace(id, body) { return { id, ...body } },
    async openProjectDirectory() { return { ok: true } },
    async replanProject(id, body) { return { id, status: 'decomposing', ...body } },
    async appendDecomposition(id, body) { return { id, status: 'decomposing', ...body } },
    async reviseDecomposition(id, bundleId, body) { return { id, bundleId, status: 'decomposing', ...body } },
    async approveAndStartExecution(id, body) { return { project: { id, status: 'running' }, run: { id: 'run', projectId: id, status: 'queued', approvalRevision: body.revision, approvalPlanHash: body.planHash, createdAt: 'now' } } },
    async retryExecution(id) { return { project: { id, status: 'running' }, run: { id: 'retry-run', projectId: id, status: 'queued', createdAt: 'now' } } },
    async createTask(projectId, body) { return { id: 'task', projectId, ...body } },
     async createProjectResource(projectId, body) { return { id: 'resource', projectId, ...body } },
    async updateTaskBoardStage(id, body) { return { id, ...body } },
    async deleteTask() {},
  }
}

test('snapshot endpoint returns no-store JSON', async () => {
  const res = response()
  await createHttpHandler(service())(new Request({ url: '/project-orchestrator/api/snapshot', headers: { host: '127.0.0.1:3080' } }), res)
  assert.equal(res.statusCode, 200)
  assert.equal(res.headers.get('cache-control'), 'no-store')
  assert.deepEqual(JSON.parse(res.body), {
     runtimes: [], resources: [], issues: [], taskRuns: [], activity: [], comments: [], decisions: [], squads: [], delegations: [], transcripts: [], artifacts: [], commands: [], externalTriggers: [], skills: [], workspaceLeases: [], localDirectoryLocks: [], projectAgentMemberships: [], projectSquadBindings: [], projectAgentMembershipSources: [], featureUsageDaily: [], runtimeOverview: { defaultHost: { id: 'default-host', name: '本机默认环境', status: 'online', capabilities: [], boundAgentCount: 0 }, customCount: 0, abnormalCount: 0, archivedCount: 0 }, inbox: [], agentWorkloads: [], runStatistics: [],
    projects: [], tasks: [], agents: [], approvals: [], runs: [], planHashes: {},
  })
})

test('read routes reject non-loopback peers before exposing project data', async () => {
  const res = response()
  await createHttpHandler(service())(new Request({
    url: '/project-orchestrator/api/snapshot',
    remoteAddress: '203.0.113.8',
    headers: { host: '127.0.0.1:3080' },
  }), res)
  assert.equal(res.statusCode, 403)
  assert.equal(JSON.parse(res.body).error.code, 'invalid-origin')
})

test('delivery projection and human confirmation use the serialized HTTP boundary', async () => {
  const fake = service()
  const read = response()
  await createHttpHandler(fake)(new Request({ url: '/project-orchestrator/api/projects/project-1/delivery', headers: { host: '127.0.0.1:3080' } }), read)
  assert.equal(read.statusCode, 200)
  assert.equal(JSON.parse(read.body).project.deliveryStage, 'delivery_ready')
  const confirmed = response()
  await createHttpHandler(fake)(new Request({ method: 'POST', url: '/project-orchestrator/api/projects/project-1/delivery/confirm', headers: { host: '127.0.0.1:3080', origin: 'http://127.0.0.1:3080', 'sec-fetch-site': 'same-origin' }, body: JSON.stringify({ actor: 'reviewer', note: '通过。' }) }), confirmed)
  assert.equal(confirmed.statusCode, 200)
  assert.equal(JSON.parse(confirmed.body).status, 'delivered')
})

test('requirements projection exposes source bundles and acceptance criteria', async () => {
  const fake = service()
  const calls = []
  fake.getProjectRequirementMatrix = (_projectId, includeHistory) => { calls.push(includeHistory); return { project: { id: 'project-1' }, bundles: [{ id: 'bundle-1' }], items: [{ id: 'item-1' }], decisions: [], acceptanceCriteria: [{ id: 'acceptance-1' }], rows: [] } }
  const res = response()
  await createHttpHandler(fake)(new Request({ url: '/project-orchestrator/api/projects/project-1/requirements', headers: { host: '127.0.0.1:3080' } }), res)
  assert.equal(res.statusCode, 200)
  assert.deepEqual(JSON.parse(res.body), { project: { id: 'project-1' }, bundles: [{ id: 'bundle-1' }], items: [{ id: 'item-1' }], decisions: [], acceptanceCriteria: [{ id: 'acceptance-1' }], rows: [] })
  const historical = response()
  await createHttpHandler(fake)(new Request({ url: '/project-orchestrator/api/projects/project-1/requirements?includeHistory=true', headers: { host: '127.0.0.1:3080' } }), historical)
  assert.equal(historical.statusCode, 200)
  assert.deepEqual(calls, [false, true])
})

test('real Requirement Decision HTTP mutations complete without nesting the non-reentrant service lock', async () => {
  const real = new OrchestratorService({}, realServiceStore())
  const project = await real.createProject({ name: 'HTTP Decision', cwd: '/tmp', prd: 'Requirement', technicalDesign: '' })
  const handler = createHttpHandler(real)
  const headers = { host: '127.0.0.1:3080', origin: 'http://127.0.0.1:3080', 'sec-fetch-site': 'same-origin' }
  const created = response()
  await within(500, handler(new Request({ method: 'POST', url: `/project-orchestrator/api/projects/${project.id}/requirement-decisions`, headers, body: JSON.stringify({ key: 'DEC-HTTP', question: 'Proceed?', options: [{ id: 'yes', label: 'Yes' }], impact: 'high', affectedRequirementIds: [], affectedTaskIds: [] }) }), created))
  assert.equal(created.statusCode, 201)
  const decision = JSON.parse(created.body)

  const resolved = response()
  await within(500, handler(new Request({ method: 'POST', url: `/project-orchestrator/api/projects/${project.id}/requirement-decisions/${decision.id}/resolve`, headers, body: JSON.stringify({ status: 'resolved', chosenOption: 'yes', resolution: 'Proceed.', decidedBy: 'owner' }) }), resolved))
  assert.equal(resolved.statusCode, 200)
  assert.equal(JSON.parse(resolved.body).status, 'resolved')
})

test('project creation starts planning and approval starts execution through one route', async () => {
  const fake = service()
  const createResponse = response()
  await createHttpHandler(fake)(new Request({
    method: 'POST', url: '/project-orchestrator/api/projects',
    headers: { host: '127.0.0.1:3080', origin: 'http://127.0.0.1:3080', 'sec-fetch-site': 'same-origin' },
    body: JSON.stringify({ cwd: '/tmp', prd: 'Build a feature.' }),
  }), createResponse)
  assert.equal(createResponse.statusCode, 202)
  assert.equal(JSON.parse(createResponse.body).status, 'decomposing')

  const approveResponse = response()
  await createHttpHandler(fake)(new Request({
    method: 'POST', url: '/project-orchestrator/api/projects/project-1/approve',
    headers: { host: '127.0.0.1:3080', origin: 'http://127.0.0.1:3080', 'sec-fetch-site': 'same-origin' },
    body: JSON.stringify({ revision: 2, planHash: 'a'.repeat(64), actor: 'Harness user' }),
  }), approveResponse)
  assert.equal(approveResponse.statusCode, 202)
  assert.equal(JSON.parse(approveResponse.body).run.status, 'queued')
})

test('empty project creation returns a draft without starting planning', async () => {
  const fake = service()
  const res = response()
  await createHttpHandler(fake)(new Request({
    method: 'POST', url: '/project-orchestrator/api/projects',
    headers: { host: '127.0.0.1:3080', origin: 'http://127.0.0.1:3080', 'sec-fetch-site': 'same-origin' },
    body: JSON.stringify({ mode: 'empty', name: '空项目', cwd: '/workspace' }),
  }), res)
  assert.equal(res.statusCode, 201)
  assert.equal(JSON.parse(res.body).status, 'draft')
})

test('project Workspace linking is same-origin and serialized', async () => {
  const fake = service()
  let linked
  let lockCalls = 0
  fake.serializedMutation = async (operation) => { lockCalls += 1; return await operation() }
  fake.linkProjectWorkspace = async (id, body) => { linked = { id, body }; return { id, workspaceId: body.workspaceId } }
  const res = response()
  await createHttpHandler(fake)(new Request({
    method: 'POST', url: '/project-orchestrator/api/projects/project-1/workspace',
    headers: { host: '127.0.0.1:3080', origin: 'http://127.0.0.1:3080', 'sec-fetch-site': 'same-origin' },
    body: JSON.stringify({ workspaceId: 'workspace-123' }),
  }), res)
  assert.equal(res.statusCode, 200)
  assert.deepEqual(linked, { id: 'project-1', body: { workspaceId: 'workspace-123' } })
  assert.equal(lockCalls, 1)
})

test('additional requirement decomposition route is same-origin and serialized', async () => {
  const fake = service()
  let received
  let lockCalls = 0
  fake.serializedMutation = async (operation) => { lockCalls += 1; return await operation() }
  fake.appendDecomposition = async (id, body) => { received = { id, body }; return { id, status: 'decomposing' } }
  const res = response()
  await createHttpHandler(fake)(new Request({
    method: 'POST', url: '/project-orchestrator/api/projects/project-1/decompositions',
    headers: { host: '127.0.0.1:3080', origin: 'http://127.0.0.1:3080', 'sec-fetch-site': 'same-origin' },
    body: JSON.stringify({ title: '权限审计', prd: '记录权限变更。', technicalDesign: '', taskLanguage: 'zh-CN' }),
  }), res)
  assert.equal(res.statusCode, 202)
  assert.deepEqual(received, { id: 'project-1', body: { title: '权限审计', prd: '记录权限变更。', technicalDesign: '', taskLanguage: 'zh-CN' } })
  assert.equal(lockCalls, 1)
})

test('targeted requirement revision route passes the current bundle id through the serialized boundary', async () => {
  const fake = service()
  let received
  fake.reviseDecomposition = async (id, bundleId, body) => { received = { id, bundleId, body }; return { id, status: 'decomposing' } }
  const res = response()
  await createHttpHandler(fake)(new Request({
    method: 'POST', url: '/project-orchestrator/api/projects/project-1/decompositions/bundle-1/revise',
    headers: { host: '127.0.0.1:3080', origin: 'http://127.0.0.1:3080', 'sec-fetch-site': 'same-origin' },
    body: JSON.stringify({ title: '权限审计修订', prd: '修订权限变更。', technicalDesign: '', taskLanguage: 'zh-CN', expectedBundleUpdatedAt: '2026-08-26T00:00:00.000Z', idempotencyKey: 'revise-1' }),
  }), res)
  assert.equal(res.statusCode, 202)
  assert.deepEqual(received, { id: 'project-1', bundleId: 'bundle-1', body: { title: '权限审计修订', prd: '修订权限变更。', technicalDesign: '', taskLanguage: 'zh-CN', expectedBundleUpdatedAt: '2026-08-26T00:00:00.000Z', idempotencyKey: 'revise-1' } })
})

test('repository inspection and project cloning routes run outside the HTTP mutation lock', async () => {
  const fake = service()
  let lockCalls = 0
  fake.serializedMutation = async (operation) => { lockCalls += 1; return await operation() }
  const headers = { host: '127.0.0.1:3080', origin: 'http://127.0.0.1:3080', 'sec-fetch-site': 'same-origin' }
  const inspectResponse = response()
  await createHttpHandler(fake)(new Request({ method: 'POST', url: '/project-orchestrator/api/repositories/inspect', headers, body: JSON.stringify({ repositoryUrl: 'https://github.com/owner/repo' }) }), inspectResponse)
  assert.equal(inspectResponse.statusCode, 200)
  assert.equal(JSON.parse(inspectResponse.body).defaultBranch, 'main')

  const createResponse = response()
  await createHttpHandler(fake)(new Request({ method: 'POST', url: '/project-orchestrator/api/projects', headers, body: JSON.stringify({ mode: 'empty', name: 'Repo', source: { kind: 'github_repo', repositoryUrl: 'https://github.com/owner/repo', ref: 'main', issueNumbers: [] } }) }), createResponse)
  assert.equal(createResponse.statusCode, 201)
  assert.equal(lockCalls, 0)
})

test('PDF worker is served as a same-origin immutable JavaScript asset', async () => {
  const res = response()
  await createHttpHandler(service())(new Request({
    url: '/project-orchestrator/api/pdf-worker.mjs?v=test',
    headers: { host: '127.0.0.1:3080' },
  }), res)
  assert.equal(res.statusCode, 200)
  assert.equal(res.headers.get('content-type'), 'text/javascript; charset=utf-8')
  assert.equal(res.headers.get('x-content-type-options'), 'nosniff')
  assert.match(res.headers.get('cache-control'), /immutable/)
})

test('PDF requirement import is same-origin, JSON-only, and does not hold the mutation lock', async () => {
  const fake = service()
  let lockCalls = 0
  let importSignal
  fake.serializedMutation = async (operation) => { lockCalls += 1; return await operation() }
  fake.importRequirementDocument = async (document, signal) => {
    importSignal = signal
    return { markdown: '# PRD', documentHash: document.documentHash, sourceBlocks: [], pageCount: document.pageCount, textPageCount: document.textPageCount, analyzedImagePages: [], warnings: [] }
  }
  const body = JSON.stringify({ fileName: 'requirements.pdf', documentHash: 'a'.repeat(64), documentKind: 'prd', pageCount: 1, textPageCount: 1, visualPageCount: 0, extractedText: 'Requirement', images: [] })
  const headers = { host: '127.0.0.1:3080', origin: 'http://127.0.0.1:3080', 'sec-fetch-site': 'same-origin', 'content-type': 'application/json; charset=utf-8' }
  const res = response()
  await createHttpHandler(fake)(new Request({ method: 'POST', url: '/project-orchestrator/api/requirements/import', headers, body }), res)
  assert.equal(res.statusCode, 200)
  assert.equal(JSON.parse(res.body).markdown, '# PRD')
  assert.equal(importSignal instanceof AbortSignal, true)
  assert.equal(lockCalls, 0)

  const wrongType = response()
  await createHttpHandler(fake)(new Request({ method: 'POST', url: '/project-orchestrator/api/requirements/import', headers: { ...headers, 'content-type': 'text/plain' }, body }), wrongType)
  assert.equal(wrongType.statusCode, 415)
  assert.equal(JSON.parse(wrongType.body).error.code, 'unsupported-media-type')
})

test('project directory open route is same-origin, project-id scoped, and ignores arbitrary path bodies', async () => {
  const fake = service()
  let openedId
  fake.openProjectDirectory = async (id) => { openedId = id; return { ok: true } }
  const res = response()
  await createHttpHandler(fake)(new Request({
    method: 'POST', url: '/project-orchestrator/api/projects/project-1/open-directory',
    headers: { host: '127.0.0.1:3080', origin: 'http://127.0.0.1:3080', 'sec-fetch-site': 'same-origin' },
    body: JSON.stringify({ path: '/etc' }),
  }), res)
  assert.equal(res.statusCode, 200)
  assert.equal(openedId, 'project-1')
  assert.deepEqual(JSON.parse(res.body), { ok: true })

  const crossOrigin = response()
  await createHttpHandler(fake)(new Request({
    method: 'POST', url: '/project-orchestrator/api/projects/project-2/open-directory',
    headers: { host: '127.0.0.1:3080', origin: 'https://attacker.example', 'sec-fetch-site': 'cross-site' },
  }), crossOrigin)
  assert.equal(crossOrigin.statusCode, 403)
  assert.equal(openedId, 'project-1')
})

test('project directory opener failures preserve stable HTTP status and error codes', async () => {
  const headers = { host: '127.0.0.1:3080', origin: 'http://127.0.0.1:3080', 'sec-fetch-site': 'same-origin' }
  for (const [code, status] of [
    ['directory-open-unsupported', 501],
    ['directory-opener-unavailable', 503],
    ['directory-open-failed', 500],
    ['directory-open-timeout', 504],
  ]) {
    const fake = service()
    fake.openProjectDirectory = async () => { throw new WorkflowError(code, 'Stable safe message.', status) }
    const res = response()
    await createHttpHandler(fake)(new Request({ method: 'POST', url: '/project-orchestrator/api/projects/project-1/open-directory', headers }), res)
    assert.equal(res.statusCode, status)
    assert.deepEqual(JSON.parse(res.body), { error: { code, message: 'Stable safe message.' } })
  }
})

test('project replan route owns language change behind same-origin serialization', async () => {
  const fake = service()
  const res = response()
  await createHttpHandler(fake)(new Request({
    method: 'POST', url: '/project-orchestrator/api/projects/project-1/replan',
    headers: { host: '127.0.0.1:3080', origin: 'http://127.0.0.1:3080', 'sec-fetch-site': 'same-origin' },
    body: JSON.stringify({ taskLanguage: 'zh-CN' }),
  }), res)
  assert.equal(res.statusCode, 202)
  assert.deepEqual(JSON.parse(res.body), { id: 'project-1', status: 'decomposing', taskLanguage: 'zh-CN' })
})

test('runtime, issue, and project resource routes use the serialized mutation boundary', async () => {
  const fake = service()
  const headers = { host: '127.0.0.1:3080', origin: 'http://127.0.0.1:3080', 'sec-fetch-site': 'same-origin' }
  const runtimeResponse = response()
  await createHttpHandler(fake)(new Request({ method: 'POST', url: '/project-orchestrator/api/runtimes', headers, body: JSON.stringify({ name: 'Local', machineId: 'machine' }) }), runtimeResponse)
  assert.equal(runtimeResponse.statusCode, 201)
  const heartbeatResponse = response()
  await createHttpHandler(fake)(new Request({ method: 'POST', url: '/project-orchestrator/api/runtimes/runtime/heartbeat', headers, body: JSON.stringify({ status: 'unstable' }) }), heartbeatResponse)
  assert.equal(JSON.parse(heartbeatResponse.body).status, 'unstable')
  const issueResponse = response()
  await createHttpHandler(fake)(new Request({ method: 'POST', url: '/project-orchestrator/api/issues', headers, body: JSON.stringify({ title: 'Track delivery' }) }), issueResponse)
  assert.equal(issueResponse.statusCode, 201)
  const resourceResponse = response()
  await createHttpHandler(fake)(new Request({ method: 'POST', url: '/project-orchestrator/api/projects/project/resources', headers, body: JSON.stringify({ kind: 'local_directory', location: '/workspace' }) }), resourceResponse)
  assert.equal(resourceResponse.statusCode, 201)
})

test('Inbox, workload, and Decision routes use the serialized mutation boundary', async () => {
  const fake = service()
  const headers = { host: '127.0.0.1:3080', origin: 'http://127.0.0.1:3080', 'sec-fetch-site': 'same-origin' }
  const inboxResponse = response()
  await createHttpHandler(fake)(new Request({ method: 'GET', url: '/project-orchestrator/api/inbox?kind=blocked&limit=10', headers: { host: '127.0.0.1:3080' } }), inboxResponse)
  assert.deepEqual(JSON.parse(inboxResponse.body), [{ id: 'filtered', kind: 'blocked' }])
  const workloadResponse = response()
  await createHttpHandler(fake)(new Request({ method: 'GET', url: '/project-orchestrator/api/agents/workload', headers: { host: '127.0.0.1:3080' } }), workloadResponse)
  assert.deepEqual(JSON.parse(workloadResponse.body), [])
  const decisionResponse = response()
  await createHttpHandler(fake)(new Request({ method: 'POST', url: '/project-orchestrator/api/decisions', headers, body: JSON.stringify({ kind: 'review', title: 'Review', prompt: 'Choose.' }) }), decisionResponse)
  assert.equal(decisionResponse.statusCode, 201)
  const resolveResponse = response()
  await createHttpHandler(fake)(new Request({ method: 'POST', url: '/project-orchestrator/api/decisions/decision', headers, body: JSON.stringify({ status: 'approved', resolution: 'Proceed.', resolvedBy: 'operator' }) }), resolveResponse)
  assert.equal(resolveResponse.statusCode, 200)
  const inboxActionResponse = response()
  await createHttpHandler(fake)(new Request({ method: 'POST', url: '/project-orchestrator/api/inbox/decision%3Adecision/actions', headers, body: JSON.stringify({ action: 'approve', resolution: 'Proceed.', actor: 'operator' }) }), inboxActionResponse)
  assert.equal(inboxActionResponse.statusCode, 200)
  assert.equal(JSON.parse(inboxActionResponse.body).itemId, 'decision:decision')
})

test('team impact and collaboration metrics expose the Service-owned read projections', async () => {
  const fake = service()
  const headers = { host: '127.0.0.1:3080' }
  const impact = response()
  await createHttpHandler(fake)(new Request({ method: 'GET', url: '/project-orchestrator/api/projects/project-1/team-impact', headers }), impact)
  assert.equal(JSON.parse(impact.body).projectId, 'project-1')
  const projectMetrics = response()
  await createHttpHandler(fake)(new Request({ method: 'GET', url: '/project-orchestrator/api/projects/project-1/team-metrics', headers }), projectMetrics)
  assert.equal(JSON.parse(projectMetrics.body).scope, 'project')
  const globalMetrics = response()
  await createHttpHandler(fake)(new Request({ method: 'GET', url: '/project-orchestrator/api/team-metrics', headers }), globalMetrics)
  assert.equal(JSON.parse(globalMetrics.body).scope, 'all')
})

test('team validation and task reassignment mutations use auditable Project Commands', async () => {
  const fake = service()
  const commands = []
  const executeCommand = fake.executeCommand
  fake.executeCommand = async (body) => { commands.push(body); return executeCommand(body) }
  const headers = { host: '127.0.0.1:3080', origin: 'http://127.0.0.1:3080', 'sec-fetch-site': 'same-origin' }
  const validation = response()
  await createHttpHandler(fake)(new Request({ method: 'POST', url: '/project-orchestrator/api/projects/project-1/validate-team', headers, body: '{}' }), validation)
  assert.equal(validation.statusCode, 200)
  assert.equal(JSON.parse(validation.body).ready, false)
  const reassign = response()
  await createHttpHandler(fake)(new Request({ method: 'POST', url: '/project-orchestrator/api/projects/project-1/reassign-task', headers, body: JSON.stringify({ expectedRevision: 2, taskId: 'task-1', agentId: 'agent-2', actor: 'operator' }) }), reassign)
  assert.equal(reassign.statusCode, 200)
  assert.equal(JSON.parse(reassign.body).task.agentId, 'agent-2')
  assert.deepEqual(commands.map((command) => command.type), ['validate_team', 'reassign_task'])
})

test('team blocker resolution is same-origin and uses the Command boundary', async () => {
  const fake = service()
  const commands = []
  const executeCommand = fake.executeCommand
  fake.executeCommand = async (body) => { commands.push(body); return executeCommand(body) }
  const headers = { host: '127.0.0.1:3080', origin: 'http://127.0.0.1:3080', 'sec-fetch-site': 'same-origin' }
  const res = response()
  await createHttpHandler(fake)(new Request({ method: 'POST', url: '/project-orchestrator/api/projects/project-1/resolve-team-blocker', headers, body: JSON.stringify({ taskId: 'task-1', reason: 'Missing permission.' }) }), res)
  assert.equal(res.statusCode, 201)
  assert.equal(JSON.parse(res.body).id, 'team-decision')
  assert.equal(commands[0].type, 'resolve_team_blocker')
  assert.equal(commands[0].projectId, 'project-1')
})

test('command, Squad, Artifact, trigger, and operational read routes stay same-origin and serialized', async () => {
  const fake = service()
  let lockCalls = 0
  fake.serializedMutation = async (operation) => { lockCalls += 1; return await operation() }
  const headers = { host: '127.0.0.1:3080', origin: 'http://127.0.0.1:3080', 'sec-fetch-site': 'same-origin' }
  for (const [url, body, status] of [
    ['/project-orchestrator/api/commands', { type: 'autopilot_tick', payload: { agentId: 'agent' } }, 202],
    ['/project-orchestrator/api/external-triggers', { source: 'test', externalKey: 'event', command: { type: 'autopilot_tick', payload: { agentId: 'agent' } } }, 202],
    ['/project-orchestrator/api/squads', { name: 'Squad' }, 201],
    ['/project-orchestrator/api/artifacts', { name: 'Evidence' }, 201],
  ]) {
    const res = response()
    await createHttpHandler(fake)(new Request({ method: 'POST', url, headers, body: JSON.stringify(body) }), res)
    assert.equal(res.statusCode, status)
  }
  assert.equal(lockCalls, 2)
  for (const path of ['issues', 'squads', 'runtimes', 'skills', 'artifacts', 'commands', 'stats', 'task-runs/run/transcript', 'task-runs/run/artifacts']) {
    const res = response()
    await createHttpHandler(fake)(new Request({ url: `/project-orchestrator/api/${path}`, headers: { host: '127.0.0.1:3080' } }), res)
    assert.equal(res.statusCode, 200)
    assert.deepEqual(JSON.parse(res.body), [])
  }
})

test('Project Squad binding routes are decoded and bind/sync use the Command boundary', async () => {
  const fake = service()
  let lockCalls = 0
  const commands = []
  const executeCommand = fake.executeCommand
  fake.executeCommand = async (body) => { commands.push(body); return executeCommand(body) }
  fake.serializedMutation = async (operation) => { lockCalls += 1; return await operation() }
  const origin = { host: '127.0.0.1:3080', origin: 'http://127.0.0.1:3080', 'sec-fetch-site': 'same-origin' }
  for (const path of ['squad-bindings', 'agent-membership-sources']) {
    const res = response()
    await createHttpHandler(fake)(new Request({ url: `/project-orchestrator/api/projects/project%20one/${path}`, headers: { host: '127.0.0.1:3080' } }), res)
    assert.equal(res.statusCode, 200)
    assert.equal(JSON.parse(res.body)[0].projectId, 'project one')
  }
  for (const [method, url, body, status] of [
    ['POST', '/project-orchestrator/api/projects/project%20one/squad-bindings', { squadId: 'squad one', expectedProjectRevision: 1, expectedSquadUpdatedAt: 'now' }, 201],
    ['POST', '/project-orchestrator/api/projects/project%20one/squad-bindings/squad%20one/sync', { expectedBindingUpdatedAt: 'now' }, 200],
    ['PUT', '/project-orchestrator/api/projects/project%20one/squad-bindings/squad%20one/default', { expectedBindingUpdatedAt: 'now' }, 200],
    ['DELETE', '/project-orchestrator/api/projects/project%20one/squad-bindings/squad%20one', { expectedBindingUpdatedAt: 'now' }, 200],
  ]) {
    const res = response()
    await createHttpHandler(fake)(new Request({ method, url, headers: origin, body: JSON.stringify(body) }), res)
    assert.equal(res.statusCode, status)
    const record = JSON.parse(res.body)
    assert.equal(record.projectId, 'project one')
    assert.equal(record.squadId, 'squad one')
  }
  assert.deepEqual(commands.map((command) => command.type), ['bind_project_squad', 'sync_project_squad'])
  assert.equal(lockCalls, 2)
})

test('project membership, task assignment, and usage routes are same-origin and serialized', async () => {
  const fake = service()
  let lockCalls = 0
  fake.serializedMutation = async (operation) => { lockCalls += 1; return await operation() }
  const origin = { host: '127.0.0.1:3080', origin: 'http://127.0.0.1:3080', 'sec-fetch-site': 'same-origin' }
  const read = response()
  await createHttpHandler(fake)(new Request({ url: '/project-orchestrator/api/projects/project-1/agents', headers: { host: '127.0.0.1:3080' } }), read)
  assert.equal(JSON.parse(read.body)[0].agentId, 'agent')
  for (const [method, url, body, status] of [
    ['POST', '/project-orchestrator/api/projects/project-1/agents', { agentId: 'a1', projectRole: 'Backend', autoAssignable: true }, 201],
    ['PUT', '/project-orchestrator/api/projects/project-1/agents/a1', { projectRole: 'API', autoAssignable: false }, 200],
    ['DELETE', '/project-orchestrator/api/projects/project-1/agents/a1', { assignedTaskPolicy: 'reject' }, 200],
    ['POST', '/project-orchestrator/api/projects/project-1/agents/batch', { members: [{ agentId: 'a1', projectRole: 'Backend', autoAssignable: true }] }, 201],
    ['POST', '/project-orchestrator/api/projects/project-1/task-assignments', { expectedRevision: 2, assignments: [{ taskId: 't1', agentId: 'a1' }] }, 200],
    ['POST', '/project-orchestrator/api/usage', { feature: 'projects', opens: 1 }, 200],
    ['DELETE', '/project-orchestrator/api/usage', {}, 200],
  ]) {
    const res = response()
    await createHttpHandler(fake)(new Request({ method, url, headers: origin, body: JSON.stringify(body) }), res)
    assert.equal(res.statusCode, status)
  }
  assert.equal(lockCalls, 7)

  const blocked = response()
  await createHttpHandler(fake)(new Request({ method: 'POST', url: '/project-orchestrator/api/projects/project-1/agents', headers: { ...origin, origin: 'https://attacker.example', 'sec-fetch-site': 'cross-site' }, body: '{}' }), blocked)
  assert.equal(blocked.statusCode, 403)
})

test('same-origin mutation is accepted', async () => {
  const res = response()
  await createHttpHandler(service())(new Request({
    method: 'POST',
    url: '/project-orchestrator/api/agents',
    headers: { host: '127.0.0.1:3080', origin: 'http://127.0.0.1:3080', 'sec-fetch-site': 'same-origin' },
    body: JSON.stringify({ name: 'Agent' }),
  }), res)
  assert.equal(res.statusCode, 201)
  assert.equal(JSON.parse(res.body).name, 'Agent')
})

test('manual task create and delete routes use the serialized mutation boundary', async () => {
  const fake = service()
  let lockCalls = 0
  let deleted
  fake.serializedMutation = async (operation) => { lockCalls += 1; return await operation() }
  fake.deleteTask = async (id) => { deleted = id }

  const createResponse = response()
  await createHttpHandler(fake)(new Request({
    method: 'POST',
    url: '/project-orchestrator/api/projects/project-1/tasks',
    headers: { host: '127.0.0.1:3080', origin: 'http://127.0.0.1:3080', 'sec-fetch-site': 'same-origin' },
    body: JSON.stringify({ title: 'Manual task' }),
  }), createResponse)
  assert.equal(createResponse.statusCode, 201)
  assert.equal(JSON.parse(createResponse.body).projectId, 'project-1')

  const deleteResponse = response()
  await createHttpHandler(fake)(new Request({
    method: 'DELETE',
    url: '/project-orchestrator/api/tasks/task-1',
    headers: { host: '127.0.0.1:3080', origin: 'http://127.0.0.1:3080', 'sec-fetch-site': 'same-origin' },
  }), deleteResponse)
  assert.equal(deleteResponse.statusCode, 200)
  assert.equal(deleted, 'task-1')
  assert.equal(lockCalls, 2)
})

test('board-stage route is same-origin, serialized, and dispatches its narrow body', async () => {
  const fake = service()
  let lockCalls = 0
  let received
  fake.serializedMutation = async (operation) => { lockCalls += 1; return await operation() }
  fake.updateTaskBoardStage = async (id, body) => { received = { id, body }; return { id, ...body } }
  const res = response()
  await createHttpHandler(fake)(new Request({
    method: 'PUT',
    url: '/project-orchestrator/api/tasks/task%2Fencoded/board-stage',
    headers: { host: '127.0.0.1:3080', origin: 'http://127.0.0.1:3080', 'sec-fetch-site': 'same-origin' },
    body: JSON.stringify({ boardStage: 'in_progress' }),
  }), res)
  assert.equal(res.statusCode, 200)
  assert.equal(lockCalls, 1)
  assert.deepEqual(received, { id: 'task/encoded', body: { boardStage: 'in_progress' } })
  assert.deepEqual(JSON.parse(res.body), { id: 'task/encoded', boardStage: 'in_progress' })
})

test('board-stage route rejects cross-origin requests before serialized dispatch', async () => {
  const fake = service()
  let lockCalls = 0
  let called = false
  fake.serializedMutation = async (operation) => { lockCalls += 1; return await operation() }
  fake.updateTaskBoardStage = async () => { called = true }
  const res = response()
  await createHttpHandler(fake)(new Request({
    method: 'PUT',
    url: '/project-orchestrator/api/tasks/task-1/board-stage',
    headers: { host: '127.0.0.1:3080', origin: 'https://example.com', 'sec-fetch-site': 'cross-site' },
    body: JSON.stringify({ boardStage: 'todo' }),
  }), res)
  assert.equal(res.statusCode, 403)
  assert.equal(lockCalls, 0)
  assert.equal(called, false)
})

test('agent draft route waits outside the serialized mutation lock', async () => {
  const fake = service()
  let lockCalls = 0
  let draftStarted = false
  let releaseDraft
  const draftGate = new Promise((resolve) => { releaseDraft = resolve })
  fake.serializedMutation = async (operation) => { lockCalls += 1; return await operation() }
  let receivedBody
  fake.draftAgent = async (body) => {
    draftStarted = true
    receivedBody = body
    await draftGate
    return {
      name: 'Draft', role: 'Reviewer', description: body.requirement, persona: 'Review.', preset: 'standard', toolPolicy: 'read_only',
      skills: [], feedback: 'Refined the draft.', assumptions: [], openQuestions: ['Which framework?'],
    }
  }
  const res = response()
  const request = createHttpHandler(fake)(new Request({
    method: 'POST',
    url: '/project-orchestrator/api/agents/draft',
    headers: { host: '127.0.0.1:3080', origin: 'http://127.0.0.1:3080', 'sec-fetch-site': 'same-origin' },
    body: JSON.stringify({
      requirement: 'Review APIs.',
      messages: [{ role: 'user', content: 'Create a reviewer.' }],
      existingDraft: { name: 'Draft', role: 'Reviewer', description: '', persona: 'Review.', preset: 'standard', toolPolicy: 'read_only', skills: [] },
    }),
  }), res)
  await new Promise((resolve) => setImmediate(resolve))
  assert.equal(draftStarted, true)
  assert.equal(lockCalls, 0)
  assert.equal(res.headersSent, false)
  releaseDraft()
  await request
  assert.equal(res.statusCode, 200)
  const body = JSON.parse(res.body)
  assert.equal(body.description, 'Review APIs.')
  assert.equal(body.feedback, 'Refined the draft.')
  assert.deepEqual(body.openQuestions, ['Which framework?'])
  assert.deepEqual(receivedBody.messages, [{ role: 'user', content: 'Create a reviewer.' }])
  assert.equal(receivedBody.existingDraft.name, 'Draft')
  assert.equal(lockCalls, 0)
})

test('Squad and Runtime management routes decode ids and expose narrow read projections', async () => {
  const handler = createHttpHandler(service())
  for (const [url, expected] of [
    ['/project-orchestrator/api/projects/project%20one/eligible-squads', 'project one'],
    ['/project-orchestrator/api/squads/squad%20one', 'squad one'],
    ['/project-orchestrator/api/runtimes/runtime%20one', 'runtime one'],
    ['/project-orchestrator/api/agents/agent%20one/runtime-impact?runtimeId=default', 'agent one'],
  ]) {
    const res = response()
    await handler(new Request({ url, headers: { host: '127.0.0.1:3080' } }), res)
    assert.equal(res.statusCode, 200)
    assert.match(res.body, new RegExp(expected))
  }
  const mutations = [
    ['POST', '/project-orchestrator/api/squads/squad%20one/clone', '{}', 201],
    ['POST', '/project-orchestrator/api/squads/squad%20one/archive', '{"expectedUpdatedAt":"now"}', 200],
    ['PUT', '/project-orchestrator/api/runtimes/runtime%20one', '{"name":"Renamed","expectedUpdatedAt":"now"}', 200],
    ['POST', '/project-orchestrator/api/runtimes/runtime%20one/archive', '{"expectedUpdatedAt":"now"}', 200],
    ['PUT', '/project-orchestrator/api/agents/agent%20one/runtime', '{"runtimeId":null}', 200],
    ['PUT', '/project-orchestrator/api/resources/resource%20one/runtime', '{"runtimeId":null}', 200],
  ]
  for (const [method, url, body, expectedStatus] of mutations) {
    const res = response()
    await handler(new Request({ method, url, headers: { host: '127.0.0.1:3080', origin: 'http://127.0.0.1:3080' }, body }), res)
    assert.equal(res.statusCode, expectedStatus)
  }
})

test('all JSON mutations reject missing media type and retain the 2 MiB body limit', async () => {
  const handler = createHttpHandler(service())
  const missing = response()
  await handler(new Request({ method: 'POST', url: '/project-orchestrator/api/commands', headers: { host: '127.0.0.1:3080', origin: 'http://127.0.0.1:3080', 'content-type': undefined }, body: '{}' }), missing)
  assert.equal(missing.statusCode, 415)
  assert.equal(JSON.parse(missing.body).error.code, 'unsupported-media-type')

  const oversized = response()
  await handler(new Request({ method: 'POST', url: '/project-orchestrator/api/commands', headers: { host: '127.0.0.1:3080', origin: 'http://127.0.0.1:3080' }, body: JSON.stringify({ payload: 'x'.repeat(2 * 1024 * 1024) }) }), oversized)
  assert.equal(oversized.statusCode, 413)
  assert.equal(JSON.parse(oversized.body).error.code, 'payload-too-large')
})

test('cross-origin mutation is rejected before service invocation', async () => {
  const res = response()
  let called = false
  const fake = service()
  fake.createAgent = async () => { called = true }
  await createHttpHandler(fake)(new Request({
    method: 'POST',
    url: '/project-orchestrator/api/agents',
    headers: { host: '127.0.0.1:3080', origin: 'https://example.com', 'sec-fetch-site': 'cross-site' },
    body: '{}',
  }), res)
  assert.equal(res.statusCode, 403)
  assert.equal(called, false)
  assert.equal(JSON.parse(res.body).error.code, 'invalid-origin')
})

test('spoofed loopback Host from a remote peer is rejected', async () => {
  const res = response()
  await createHttpHandler(service())(new Request({
    method: 'POST',
    url: '/project-orchestrator/api/agents',
    remoteAddress: '203.0.113.8',
    headers: { host: 'localhost:3080', origin: 'http://localhost:3080', 'sec-fetch-site': 'same-origin' },
    body: '{}',
  }), res)
  assert.equal(res.statusCode, 403)
  assert.match(JSON.parse(res.body).error.message, /loopback network peer/)
})

test('mutation without a browser Origin is rejected', async () => {
  const res = response()
  await createHttpHandler(service())(new Request({
    method: 'POST',
    url: '/project-orchestrator/api/agents',
    headers: { host: '127.0.0.1:3080' },
    body: '{}',
  }), res)
  assert.equal(res.statusCode, 403)
  assert.match(JSON.parse(res.body).error.message, /Origin header/)
})
