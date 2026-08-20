import type { IncomingMessage, ServerResponse } from 'node:http'
import { ZodError } from 'zod'
import { WorkflowError } from './workflow.js'
import type { OrchestratorService } from './service.js'

const API_PREFIX = '/project-orchestrator/api'
const MAX_BODY_BYTES = 2 * 1024 * 1024

export function createHttpHandler(service: OrchestratorService) {
  return async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    try {
      const url = new URL(req.url ?? '/', `http://${req.headers.host ?? '127.0.0.1'}`)
      const path = url.pathname.slice(API_PREFIX.length) || '/'
      const method = req.method ?? 'GET'
      if (method === 'GET' && path === '/snapshot') return json(res, 200, service.snapshot())
      if (method === 'GET' && path === '/inbox') return json(res, 200, await service.getInbox(queryObject(url)))
      if (method === 'GET' && path === '/agents/workload') return json(res, 200, await service.getAgentWorkloads())
      if (method === 'GET' && path === '/issues') return json(res, 200, service.snapshot().issues)
      if (method === 'GET' && path === '/squads') return json(res, 200, service.snapshot().squads)
      if (method === 'GET' && path === '/runtimes') return json(res, 200, service.snapshot().runtimes)
      if (method === 'GET' && path === '/skills') return json(res, 200, service.snapshot().skills)
      if (method === 'GET' && path === '/artifacts') return json(res, 200, service.snapshot().artifacts)
      if (method === 'GET' && path === '/commands') return json(res, 200, service.snapshot().commands)
      if (method === 'GET' && path === '/stats') return json(res, 200, service.snapshot().runStatistics)
      const taskRunTranscript = matchOne(path, /^\/task-runs\/([^/]+)\/transcript$/)
      if (method === 'GET' && taskRunTranscript !== undefined) return json(res, 200, service.snapshot().transcripts.filter((entry) => entry.taskRunId === taskRunTranscript))
      const taskRunArtifacts = matchOne(path, /^\/task-runs\/([^/]+)\/artifacts$/)
      if (method === 'GET' && taskRunArtifacts !== undefined) return json(res, 200, service.snapshot().artifacts.filter((artifact) => artifact.taskRunId === taskRunArtifacts))
      if (method === 'GET' && path === '/health') return json(res, 200, { ok: true })
      if (method === 'GET') return json(res, 404, { error: { code: 'route-not-found', message: 'Project orchestrator route was not found.' } })

      assertSameOrigin(req)
      if (method === 'POST' && path === '/agents/draft') {
        return json(res, 200, await service.draftAgent(await readJson(req)))
      }
      await service.serializedMutation(async () => {
        if (method === 'POST' && path === '/agents') {
          return json(res, 201, await service.createAgent(await readJson(req)))
        }
        if (method === 'POST' && path === '/commands') {
          return json(res, 202, await service.executeCommand(await readJson(req)))
        }
        if (method === 'POST' && path === '/external-triggers') {
          return json(res, 202, await service.receiveExternalTrigger(await readJson(req)))
        }
        if (method === 'POST' && path === '/squads') {
          return json(res, 201, await service.createSquad(await readJson(req)))
        }
        if (method === 'POST' && path === '/artifacts') {
          return json(res, 201, await service.attachArtifact(await readJson(req)))
        }
        const squadArchive = matchOne(path, /^\/squads\/([^/]+)\/archive$/)
        if (squadArchive !== undefined && method === 'POST') {
          return json(res, 200, await service.archiveSquad(squadArchive))
        }
        const squad = matchOne(path, /^\/squads\/([^/]+)$/)
        if (squad !== undefined && method === 'PUT') {
          return json(res, 200, await service.updateSquad(squad, await readJson(req)))
        }
        if (squad !== undefined && method === 'DELETE') {
          await service.deleteSquad(squad)
          return json(res, 200, { ok: true })
        }
        if (method === 'POST' && path === '/runtimes') {
          return json(res, 201, await service.createRuntime(await readJson(req)))
        }
        const runtimeHeartbeat = matchOne(path, /^\/runtimes\/([^/]+)\/heartbeat$/)
        if (runtimeHeartbeat !== undefined && method === 'POST') {
          const body = await readJson(req) as { status?: 'online' | 'offline' | 'unstable' }
          return json(res, 200, await service.heartbeatRuntime(runtimeHeartbeat, body.status ?? 'online'))
        }
        const runtime = matchOne(path, /^\/runtimes\/([^/]+)$/)
        if (runtime !== undefined && method === 'DELETE') {
          await service.deleteRuntime(runtime)
          return json(res, 200, { ok: true })
        }
        if (method === 'POST' && path === '/issues') {
          return json(res, 201, await service.createIssue(await readJson(req)))
        }
        if (method === 'POST' && path === '/decisions') {
          return json(res, 201, await service.createDecision(await readJson(req)))
        }
        const inboxItem = matchOne(path, /^\/inbox\/([^/]+)\/actions$/)
        if (inboxItem !== undefined && method === 'POST') {
          return json(res, 200, await service.handleInboxItem(inboxItem, await readJson(req)))
        }
        const decision = matchOne(path, /^\/decisions\/([^/]+)$/)
        if (decision !== undefined && method === 'POST') {
          return json(res, 200, await service.resolveDecision(decision, await readJson(req)))
        }
        const issue = matchOne(path, /^\/issues\/([^/]+)$/)
        if (issue !== undefined && method === 'PUT') {
          return json(res, 200, await service.updateIssue(issue, await readJson(req)))
        }
        const issueComments = matchOne(path, /^\/issues\/([^/]+)\/comments$/)
        if (issueComments !== undefined && method === 'POST') {
          return json(res, 201, await service.addComment(issueComments, await readJson(req)))
        }
        const issueRetry = matchOne(path, /^\/issues\/([^/]+)\/retry$/)
        if (issueRetry !== undefined && method === 'POST') {
          return json(res, 202, await service.retryIssue(issueRetry))
        }
        const agent = matchOne(path, /^\/agents\/([^/]+)$/)
        if (agent !== undefined && method === 'PUT') {
          return json(res, 200, await service.updateAgent(agent, await readJson(req)))
        }
        if (agent !== undefined && method === 'DELETE') {
          await service.deleteAgent(agent)
          return json(res, 200, { ok: true })
        }

        if (method === 'POST' && path === '/projects') {
          return json(res, 202, await service.createProjectAndStart(await readJson(req)))
        }
        const projectTasks = matchOne(path, /^\/projects\/([^/]+)\/tasks$/)
        if (projectTasks !== undefined && method === 'POST') {
          return json(res, 201, await service.createTask(projectTasks, await readJson(req)))
        }
        const projectResources = matchOne(path, /^\/projects\/([^/]+)\/resources$/)
        if (projectResources !== undefined && method === 'POST') {
          return json(res, 201, await service.createProjectResource(projectResources, await readJson(req)))
        }
        const project = matchOne(path, /^\/projects\/([^/]+)$/)
        if (project !== undefined && method === 'PUT') {
          return json(res, 200, await service.updateProject(project, await readJson(req)))
        }
        if (project !== undefined && method === 'DELETE') {
          await service.deleteProject(project)
          return json(res, 200, { ok: true })
        }
        const decompose = matchOne(path, /^\/projects\/([^/]+)\/decompose$/)
        if (decompose !== undefined && method === 'POST') {
          return json(res, 202, await service.startDecomposition(decompose))
        }
        const approve = matchOne(path, /^\/projects\/([^/]+)\/approve$/)
        if (approve !== undefined && method === 'POST') {
          return json(res, 202, await service.approveAndStartExecution(approve, await readJson(req)))
        }
        const retry = matchOne(path, /^\/projects\/([^/]+)\/retry$/)
        if (retry !== undefined && method === 'POST') {
          return json(res, 202, await service.retryExecution(retry))
        }
        const execute = matchOne(path, /^\/projects\/([^/]+)\/execute$/)
        if (execute !== undefined && method === 'POST') {
          return json(res, 202, await service.startExecution(execute))
        }
        const cancel = matchOne(path, /^\/projects\/([^/]+)\/cancel$/)
        if (cancel !== undefined && method === 'POST') {
          await service.cancelProject(cancel)
          return json(res, 200, { ok: true })
        }

        const taskBoardStage = matchOne(path, /^\/tasks\/([^/]+)\/board-stage$/)
        if (taskBoardStage !== undefined && method === 'PUT') {
          return json(res, 200, await service.updateTaskBoardStage(taskBoardStage, await readJson(req)))
        }
        const task = matchOne(path, /^\/tasks\/([^/]+)$/)
        if (task !== undefined && method === 'PUT') {
          return json(res, 200, await service.updateTask(task, await readJson(req)))
        }
        if (task !== undefined && method === 'DELETE') {
          await service.deleteTask(task)
          return json(res, 200, { ok: true })
        }

        json(res, 404, { error: { code: 'route-not-found', message: 'Project orchestrator route was not found.' } })
      })
    } catch (error) {
      sendError(res, error)
    }
  }
}

function queryObject(url: URL): Record<string, string> {
  return Object.fromEntries(url.searchParams.entries())
}

function matchOne(path: string, expression: RegExp): string | undefined {
  const value = expression.exec(path)?.[1]
  return value === undefined ? undefined : decodeURIComponent(value)
}

async function readJson(req: IncomingMessage): Promise<unknown> {
  let size = 0
  const chunks: Buffer[] = []
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    size += buffer.byteLength
    if (size > MAX_BODY_BYTES) throw new WorkflowError('payload-too-large', 'Request body exceeds 2 MiB.', 413)
    chunks.push(buffer)
  }
  if (chunks.length === 0) return {}
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'))
  } catch {
    throw new WorkflowError('invalid-json', 'Request body is not valid JSON.', 400)
  }
}

function assertSameOrigin(req: IncomingMessage): void {
  const host = req.headers.host
  if (host === undefined) throw new WorkflowError('invalid-origin', 'Host header is required.', 403)
  let requestHost: URL
  try {
    requestHost = new URL(`http://${host}`)
  } catch {
    throw new WorkflowError('invalid-origin', 'Host header is invalid.', 403)
  }
  if (!['127.0.0.1', 'localhost', '::1'].includes(requestHost.hostname)) {
    throw new WorkflowError('invalid-origin', 'Mutating API calls are allowed only from the loopback Harness Web host.', 403)
  }
  const remoteAddress = req.socket.remoteAddress
  if (remoteAddress === undefined || !isLoopbackAddress(remoteAddress)) {
    throw new WorkflowError('invalid-origin', 'Mutating API calls require a loopback network peer.', 403)
  }
  const fetchSite = req.headers['sec-fetch-site']
  if (fetchSite !== undefined && fetchSite !== 'same-origin') {
    throw new WorkflowError('invalid-origin', 'Cross-site API request was rejected.', 403)
  }
  const origin = req.headers.origin
  if (origin === undefined) throw new WorkflowError('invalid-origin', 'Origin header is required for mutations.', 403)
  let originUrl: URL
  try {
    originUrl = new URL(origin)
  } catch {
    throw new WorkflowError('invalid-origin', 'Origin header is invalid.', 403)
  }
  if (!['http:', 'https:'].includes(originUrl.protocol) || originUrl.host !== requestHost.host) {
    throw new WorkflowError('invalid-origin', 'Cross-origin API request was rejected.', 403)
  }
}

function isLoopbackAddress(address: string): boolean {
  return address === '::1' || address === '127.0.0.1' || address.startsWith('127.') || address.startsWith('::ffff:127.')
}

function json(res: ServerResponse, status: number, body: unknown): void {
  if (res.headersSent) return
  res.statusCode = status
  res.setHeader('content-type', 'application/json; charset=utf-8')
  res.setHeader('cache-control', 'no-store')
  res.end(JSON.stringify(body))
}

function sendError(res: ServerResponse, error: unknown): void {
  if (error instanceof WorkflowError) {
    json(res, error.status, { error: { code: error.code, message: error.message } })
    return
  }
  if (error instanceof ZodError) {
    json(res, 400, {
      error: {
        code: 'invalid-payload',
        message: error.issues.map((issue) => `${issue.path.join('.') || 'body'}: ${issue.message}`).join('; '),
      },
    })
    return
  }
  console.error('[project-orchestrator] request failed', error)
  json(res, 500, { error: { code: 'internal-error', message: 'Project orchestrator request failed.' } })
}
