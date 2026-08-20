import assert from 'node:assert/strict'
import { Readable } from 'node:stream'
import test from 'node:test'
import { createHttpHandler, WorkflowError } from '../lib/index.js'

class Request extends Readable {
  constructor({ method = 'GET', url = '/', headers = {}, body = '', remoteAddress = '127.0.0.1' }) {
    super()
    this.method = method
    this.url = url
    this.headers = headers
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
    setHeader(name, value) { this.headers.set(name, value) },
    end(value = '') { this.body += value; this.headersSent = true },
  }
}

function service() {
  return {
    snapshot() { return { projects: [], tasks: [], agents: [], approvals: [], runs: [], planHashes: {}, runtimes: [], resources: [], issues: [], taskRuns: [], activity: [], comments: [], decisions: [], squads: [], delegations: [], transcripts: [], artifacts: [], commands: [], externalTriggers: [], skills: [], workspaceLeases: [], localDirectoryLocks: [], inbox: [], agentWorkloads: [], runStatistics: [] } },
     async getInbox(query) { return query?.kind ? [{ id: 'filtered', kind: query.kind }] : [] },
     async getAgentWorkloads() { return [] },
     async createDecision(body) { return { id: 'decision', status: 'pending', ...body } },
     async executeCommand(body) { return { id: 'command', status: 'completed', result: body } },
     async receiveExternalTrigger(body) { return { id: 'trigger', status: 'processed', ...body } },
     async createSquad(body) { return { id: 'squad', status: 'active', ...body } },
     async updateSquad(id, body) { return { id, status: 'active', ...body } },
     async archiveSquad(id) { return { id, status: 'archived' } },
     async deleteSquad() {},
     async attachArtifact(body) { return { id: 'artifact', ...body } },
     async resolveDecision(id, body) { return { id, ...body } },
     async handleInboxItem(id, body) { return { itemId: id, result: body } },
    async serializedMutation(operation) { return await operation() },
    async createAgent(body) { return { id: 'agent', ...body } },
     async createRuntime(body) { return { id: 'runtime', status: 'online', ...body } },
     async heartbeatRuntime(id, status) { return { id, status } },
     async deleteRuntime() {},
     async createIssue(body) { return { id: 'issue', ...body } },
     async inspectRepository(body) { return { repositoryUrl: body.repositoryUrl, owner: 'owner', name: 'repo', defaultBranch: 'main', branches: [{ name: 'main', protected: true }], issues: [] } },
    async draftAgent() { return { name: 'Draft', role: 'Reviewer', description: '', persona: 'Review.', preset: 'standard', toolPolicy: 'read_only' } },
    async createProjectFromRequest(body) { return { id: 'project', status: body.mode === 'empty' ? 'draft' : 'decomposing', ...body } },
    async openProjectDirectory() { return { ok: true } },
    async replanProject(id, body) { return { id, status: 'decomposing', ...body } },
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
     runtimes: [], resources: [], issues: [], taskRuns: [], activity: [], comments: [], decisions: [], squads: [], delegations: [], transcripts: [], artifacts: [], commands: [], externalTriggers: [], skills: [], workspaceLeases: [], localDirectoryLocks: [], inbox: [], agentWorkloads: [], runStatistics: [],
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
  assert.equal(lockCalls, 4)
  for (const path of ['issues', 'squads', 'runtimes', 'skills', 'artifacts', 'commands', 'stats', 'task-runs/run/transcript', 'task-runs/run/artifacts']) {
    const res = response()
    await createHttpHandler(fake)(new Request({ url: `/project-orchestrator/api/${path}`, headers: { host: '127.0.0.1:3080' } }), res)
    assert.equal(res.statusCode, 200)
    assert.deepEqual(JSON.parse(res.body), [])
  }
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
