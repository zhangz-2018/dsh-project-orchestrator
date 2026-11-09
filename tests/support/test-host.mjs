import { Context } from '@deepseek-ai/cordis'
import Storage from '@deepseek-ai/dsh-storage'
import * as StorageDomain from '@deepseek-ai/dsh-storage-domain'
import * as StorageJson from '@deepseek-ai/dsh-storage-json'
import { build } from 'esbuild'
import { createServer } from 'node:http'
import { mkdir, readFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createHttpHandler, OrchestratorService, OrchestratorStore, orchestratorDomain } from '../../lib/index.js'

const supportRoot = dirname(fileURLToPath(import.meta.url))
const repositoryRoot = resolve(supportRoot, '..', '..')
const storageRoot = resolve(process.env.PO_TEST_STORAGE_ROOT ?? '')
const workspacePath = resolve(process.env.PO_TEST_WORKSPACE ?? repositoryRoot)
const lockDirectory = resolve(process.env.PO_TEST_LOCK_ROOT ?? resolve(storageRoot, 'writer-locks'))
if (process.env.PO_TEST_STORAGE_ROOT === undefined) throw new Error('PO_TEST_STORAGE_ROOT is required.')

await mkdir(storageRoot, { recursive: true })
const browserEntry = resolve(storageRoot, 'test-client.js')
await build({
  entryPoints: [resolve(supportRoot, 'client-host-entry.tsx')],
  outfile: browserEntry,
  bundle: true,
  platform: 'browser',
  format: 'iife',
  target: ['chrome120'],
  logLevel: 'silent',
})
const [clientBundle, testClientBundle] = await Promise.all([
  readFile(resolve(repositoryRoot, 'lib', 'client.js')),
  readFile(browserEntry),
])

const rootContext = new Context()
await rootContext.plugin(Storage)
await rootContext.plugin(StorageJson, { root: storageRoot })
await rootContext.plugin(StorageDomain, { backend: 'json' })
const domain = await rootContext.storageDomain.open(orchestratorDomain)

const counters = { agentCreateCalls: 0, modelResolveCalls: 0, apiBootstrapCalls: 0, apiSnapshotCalls: 0 }
const serviceContext = {
  skills: { list: async () => [] },
  agentDefaultModel: { currentSelection: () => ({ provider: 'test', model: 'test' }) },
  agentPresets: { mount: async () => {} },
  llm: { resolveModelInfo: async () => { counters.modelResolveCalls += 1; return { provider: 'test', id: 'test', name: 'Test model', inputModalities: ['text'], context: { contextWindow: 32_768 }, defaultMaxTokens: 16_384 } } },
  attachments: {
    imageLimits: { maxImageBytes: 5_000_000, maxImagesPerMessage: 20, maxMessageImageBytes: 20_000_000, maxImagePixels: 4_000_000, mediaTypes: ['image/jpeg'] },
    validateImage: async () => {},
    saveImage: async () => { throw new Error('Image persistence is not available in the deterministic test host.') },
  },
  sessions: { flush: async () => {} },
  agents: { create: async () => { counters.agentCreateCalls += 1; throw new Error('Unexpected model execution in deterministic test host.') } },
  tools: { list: async () => [] },
}
const store = new OrchestratorStore(domain)
const service = new OrchestratorService(serviceContext, store, undefined, undefined, {
  workspaceWriter: { workspaceIdentity: `browser-test:${storageRoot}`, lockDirectory },
})
await service.initialize()
const taskRunSeedCount = Number.parseInt(process.env.PO_TEST_TASK_RUN_SEED_COUNT ?? '0', 10)
if (!Number.isInteger(taskRunSeedCount) || taskRunSeedCount < 0 || taskRunSeedCount > 200) throw new Error('PO_TEST_TASK_RUN_SEED_COUNT must be an integer between 0 and 200.')
if (taskRunSeedCount > 0) {
  const project = await service.createProject({
    name: '分页运行历史项目',
    cwd: workspacePath,
    prd: '验证运行历史分页。',
    technicalDesign: '使用真实 QueryService 和持久化 Store。',
  })
  for (let index = 0; index < taskRunSeedCount; index += 1) {
    const timestamp = new Date(Date.UTC(2026, 8, 22, 0, 0, index)).toISOString()
    const id = `run-${String(index).padStart(4, '0')}-history`
    await store.taskRuns.put(id, {
      id,
      projectId: project.id,
      status: 'completed',
      trigger: 'system',
      attempt: 1,
      cwd: workspacePath,
      finishedReason: 'completed',
      // 固定的隔离会话身份用于验证原生导航，不触发 Agent 创建。
      sessionId: `fixture-session-${index}`,
      createdAt: timestamp,
      completedAt: timestamp,
    })
  }
}
const issueEvidenceSeedCount = Number.parseInt(process.env.PO_TEST_ISSUE_EVIDENCE_SEED_COUNT ?? '0', 10)
if (!Number.isInteger(issueEvidenceSeedCount) || issueEvidenceSeedCount < 0 || issueEvidenceSeedCount > 150) throw new Error('PO_TEST_ISSUE_EVIDENCE_SEED_COUNT must be an integer between 0 and 150.')
if (issueEvidenceSeedCount > 0) {
  const project = await service.createProject({
    name: 'Issue 证据总数项目',
    cwd: workspacePath,
    prd: '验证 Issue 证据总数。',
    technicalDesign: '按需返回有界列表和完整总数。',
  })
  const issue = await service.createIssue({ projectId: project.id, title: 'Issue 证据总数', description: '检查完整历史与已加载记录。' })
  for (let index = 0; index < issueEvidenceSeedCount; index += 1) {
    const timestamp = new Date(Date.UTC(2026, 8, 22, 0, 0, index)).toISOString()
    const runId = `issue-run-${String(index).padStart(4, '0')}`
    await store.taskRuns.put(runId, { id: runId, projectId: project.id, issueId: issue.id, status: 'completed', trigger: 'system', attempt: index + 1, cwd: workspacePath, createdAt: timestamp, completedAt: timestamp })
    await store.transcripts.put(`transcript-${runId}`, { id: `transcript-${runId}`, taskRunId: runId, sequence: 1, role: 'assistant', kind: 'message', text: `Transcript ${index}`, createdAt: timestamp })
    for (let artifactIndex = 0; artifactIndex < 3; artifactIndex += 1) {
      const id = `artifact-${runId}-${artifactIndex}`
      await store.artifacts.put(id, { id, projectId: project.id, taskRunId: runId, kind: 'log', name: `Artifact ${index}-${artifactIndex}`, status: 'available', metadata: {}, createdAt: timestamp })
    }
  }
}
const apiHandler = createHttpHandler(service)

function send(res, status, contentType, body) {
  res.writeHead(status, { 'content-type': contentType, 'cache-control': 'no-store' })
  res.end(body)
}

const safeWorkspace = JSON.stringify(workspacePath).replaceAll('<', '\\u003c')
const html = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Project Orchestrator Test Host</title></head><body><div id="plugin-launcher"></div><div id="plugin-overlay"></div><script>window.__PO_TEST_WORKSPACE__=${safeWorkspace};window.__ModuleLoader__={load:function(plugin){window.__PO_PLUGIN__=plugin}}</script><script src="/client.js"></script><script src="/test-client.js"></script></body></html>`
const server = createServer((req, res) => {
  const pathname = new URL(req.url ?? '/', 'http://test.local').pathname
  if (pathname === '/') return send(res, 200, 'text/html; charset=utf-8', html)
  if (pathname === '/client.js') return send(res, 200, 'text/javascript; charset=utf-8', clientBundle)
  if (pathname === '/test-client.js') return send(res, 200, 'text/javascript; charset=utf-8', testClientBundle)
  if (pathname === '/_test/metrics') return send(res, 200, 'application/json; charset=utf-8', JSON.stringify({ ...counters, projectCount: service.snapshot().projects.length }))
  if (pathname.startsWith('/project-orchestrator/api')) {
    if (pathname === '/project-orchestrator/api/bootstrap') counters.apiBootstrapCalls += 1
    if (pathname === '/project-orchestrator/api/snapshot') counters.apiSnapshotCalls += 1
    void Promise.resolve(apiHandler(req, res)).catch((error) => send(res, 500, 'application/json; charset=utf-8', JSON.stringify({ error: { message: String(error) } })))
    return
  }
  send(res, 404, 'text/plain; charset=utf-8', 'Not found')
})

await new Promise((resolveListen, rejectListen) => {
  server.once('error', rejectListen)
  server.listen(0, '127.0.0.1', () => {
    server.off('error', rejectListen)
    resolveListen()
  })
})
const address = server.address()
process.stdout.write(`${JSON.stringify({ type: 'ready', baseURL: `http://127.0.0.1:${address.port}` })}\n`)

let closing
const debug = (message) => { if (process.env.PO_TEST_DEBUG === '1') process.stderr.write(`${message}\n`) }
async function close() {
  if (closing !== undefined) return closing
  closing = (async () => {
    debug('closing server')
    const serverClosed = new Promise((resolveClose) => server.close(resolveClose))
    server.closeAllConnections()
    await serverClosed
    debug('closing service')
    await service.close()
    debug('closing domain')
    await domain.close()
    debug('disposing context')
    await rootContext.fiber.dispose()
    debug('closed')
  })()
  return closing
}

for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => { void close().finally(() => process.exit(0)) })
