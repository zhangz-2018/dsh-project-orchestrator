import type { IncomingMessage, ServerResponse } from 'node:http'
import { readFile } from 'node:fs/promises'
import { ZodError } from 'zod'
import { WorkflowError } from './workflow.js'
import type { OrchestratorService } from './service.js'

const API_PREFIX = '/project-orchestrator/api'
const MAX_BODY_BYTES = 2 * 1024 * 1024
const MAX_REQUIREMENT_IMPORT_BODY_BYTES = 32 * 1024 * 1024
const pdfWorkerSource = readFile(new URL('./pdf.worker.mjs', import.meta.url))

export function createHttpHandler(service: OrchestratorService) {
  return async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    try {
      const url = new URL(req.url ?? '/', `http://${req.headers.host ?? '127.0.0.1'}`)
      const path = url.pathname.slice(API_PREFIX.length) || '/'
      const method = req.method ?? 'GET'
      if (method === 'GET') assertLoopbackRead(req)
      if (method === 'GET' && path === '/pdf-worker.mjs') return javascript(res, await pdfWorkerSource)
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
      if (method === 'GET' && path === '/team-metrics') return json(res, 200, service.getTeamCollaborationMetrics())
      const taskRunTranscript = matchOne(path, /^\/task-runs\/([^/]+)\/transcript$/)
      if (method === 'GET' && taskRunTranscript !== undefined) return json(res, 200, service.snapshot().transcripts.filter((entry) => entry.taskRunId === taskRunTranscript))
      const taskRunArtifacts = matchOne(path, /^\/task-runs\/([^/]+)\/artifacts$/)
      if (method === 'GET' && taskRunArtifacts !== undefined) return json(res, 200, service.snapshot().artifacts.filter((artifact) => artifact.taskRunId === taskRunArtifacts))
      const projectAgentsRead = matchOne(path, /^\/projects\/([^/]+)\/agents$/u)
      if (method === 'GET' && projectAgentsRead !== undefined) return json(res, 200, service.listProjectAgents(projectAgentsRead))
      const projectTeamPlan = matchOne(path, /^\/projects\/([^/]+)\/team-plan$/u)
      if (method === 'GET' && projectTeamPlan !== undefined) return json(res, 200, service.getProjectTeamPlan(projectTeamPlan))
      const projectAgentCandidates = matchOne(path, /^\/projects\/([^/]+)\/agent-candidates$/u)
      if (method === 'GET' && projectAgentCandidates !== undefined) {
        const taskId = url.searchParams.get('taskId')
        if (taskId === null || taskId.trim() === '') return json(res, 400, { error: { code: 'task-id-required', message: 'taskId query parameter is required.' } })
        return json(res, 200, service.getProjectAgentCandidates(projectAgentCandidates, taskId))
      }
      const projectTeamImpact = matchOne(path, /^\/projects\/([^/]+)\/team-impact$/u)
      if (method === 'GET' && projectTeamImpact !== undefined) return json(res, 200, service.getProjectTeamImpact(projectTeamImpact))
      const projectTeamMetrics = matchOne(path, /^\/projects\/([^/]+)\/team-metrics$/u)
      if (method === 'GET' && projectTeamMetrics !== undefined) return json(res, 200, service.getTeamCollaborationMetrics(projectTeamMetrics))
      const projectTeamValidation = matchOne(path, /^\/projects\/([^/]+)\/validate-team$/u)
      if (method === 'GET' && projectTeamValidation !== undefined) return json(res, 200, service.validateProjectTeam(projectTeamValidation))
      const projectPlanSnapshots = matchOne(path, /^\/projects\/([^/]+)\/plan-snapshots$/u)
      if (method === 'GET' && projectPlanSnapshots !== undefined) return json(res, 200, service.listProjectPlanSnapshots(projectPlanSnapshots))
      const projectRequirements = matchOne(path, /^\/projects\/([^/]+)\/requirements$/u)
      if (method === 'GET' && projectRequirements !== undefined) return json(res, 200, {
        ...service.getProjectRequirementMatrix(projectRequirements, url.searchParams.get('includeHistory') === 'true'),
      })
      const projectDecisions = matchOne(path, /^\/projects\/([^/]+)\/requirement-decisions$/u)
      if (method === 'GET' && projectDecisions !== undefined) return json(res, 200, url.searchParams.get('includeHistory') === 'true' ? service.listProjectRequirementDecisions(projectDecisions) : service.getProjectRequirementMatrix(projectDecisions).decisions)
      const projectDelivery = matchOne(path, /^\/projects\/([^/]+)\/delivery$/u)
      if (method === 'GET' && projectDelivery !== undefined) return json(res, 200, service.getProjectDelivery(projectDelivery))
      const projectSquadBindings = matchOne(path, /^\/projects\/([^/]+)\/squad-bindings$/u)
      if (method === 'GET' && projectSquadBindings !== undefined) return json(res, 200, service.listProjectSquadBindings(projectSquadBindings))
      const projectMembershipSources = matchOne(path, /^\/projects\/([^/]+)\/agent-membership-sources$/u)
      if (method === 'GET' && projectMembershipSources !== undefined) return json(res, 200, service.listProjectAgentMembershipSources(projectMembershipSources))
      const eligibleSquads = matchOne(path, /^\/projects\/([^/]+)\/eligible-squads$/u)
      if (method === 'GET' && eligibleSquads !== undefined) return json(res, 200, service.listEligibleSquads(eligibleSquads))
      const squadDetail = matchOne(path, /^\/squads\/([^/]+)$/u)
      if (method === 'GET' && squadDetail !== undefined) return json(res, 200, service.getSquad(squadDetail))
      const runtimeDetail = matchOne(path, /^\/runtimes\/([^/]+)$/u)
      if (method === 'GET' && runtimeDetail !== undefined) return json(res, 200, service.getRuntimeDetail(runtimeDetail))
      const runtimeImpact = matchOne(path, /^\/agents\/([^/]+)\/runtime-impact$/u)
      if (method === 'GET' && runtimeImpact !== undefined) {
        const runtimeId = url.searchParams.get('runtimeId')
        return json(res, 200, service.getAgentRuntimeImpact(runtimeImpact, runtimeId === null || runtimeId === 'default' ? undefined : runtimeId))
      }
      if (method === 'GET' && path === '/health') return json(res, 200, { ok: true })
      if (method === 'GET') return json(res, 404, { error: { code: 'route-not-found', message: 'Project orchestrator route was not found.' } })

      assertSameOrigin(req)
      if (method === 'POST' || method === 'PUT' || requestHasBody(req)) assertJsonRequest(req)
      const projectTeamValidationMutation = matchOne(path, /^\/projects\/([^/]+)\/validate-team$/u)
      if (projectTeamValidationMutation !== undefined && method === 'POST') {
        const command = await service.executeCommand({ type: 'validate_team', projectId: projectTeamValidationMutation, actorType: 'human', payload: await readJson(req) })
        return json(res, 200, commandResult(command))
      }
      const projectTeamBlocker = matchOne(path, /^\/projects\/([^/]+)\/resolve-team-blocker$/u)
      if (projectTeamBlocker !== undefined && method === 'POST') {
        const body = await readJson(req) as Record<string, unknown>
        const command = await service.executeCommand({ type: 'resolve_team_blocker', projectId: projectTeamBlocker, actorType: 'human', ...(typeof body.actor === 'string' ? { actorId: body.actor } : {}), payload: body })
        return json(res, 201, commandResult(command))
      }
      if (method === 'POST' && path === '/commands') return json(res, 202, await service.executeCommand(await readJson(req)))
      if (method === 'POST' && path === '/external-triggers') return json(res, 202, await service.receiveExternalTrigger(await readJson(req)))
      const projectSquadSyncCommand = matchTwo(path, /^\/projects\/([^/]+)\/squad-bindings\/([^/]+)\/sync$/)
      if (projectSquadSyncCommand !== undefined && method === 'POST') {
        const body = await readJson(req) as Record<string, unknown>
        const command = await service.executeCommand({ type: 'sync_project_squad', projectId: projectSquadSyncCommand[0], squadId: projectSquadSyncCommand[1], actorType: 'human', payload: body })
        return json(res, 200, commandResult(command))
      }
      const projectSquadBindCommand = matchOne(path, /^\/projects\/([^/]+)\/squad-bindings$/)
      if (projectSquadBindCommand !== undefined && method === 'POST') {
        const body = await readJson(req) as Record<string, unknown>
        const command = await service.executeCommand({ type: 'bind_project_squad', projectId: projectSquadBindCommand, ...(typeof body.squadId === 'string' ? { squadId: body.squadId } : {}), actorType: 'human', ...(typeof body.boundBy === 'string' ? { actorId: body.boundBy } : {}), payload: body })
        return json(res, 201, commandResult(command))
      }
      const projectReassignCommand = matchOne(path, /^\/projects\/([^/]+)\/reassign-task$/)
      if (projectReassignCommand !== undefined && method === 'POST') {
        const body = await readJson(req) as Record<string, unknown>
        const command = await service.executeCommand({ type: 'reassign_task', projectId: projectReassignCommand, actorType: 'human', ...(typeof body.actor === 'string' ? { actorId: body.actor } : {}), payload: body })
        return json(res, 200, commandResult(command))
      }
      if (method === 'POST' && path === '/agents/draft') {
        return json(res, 200, await service.draftAgent(await readJson(req)))
      }
      if (method === 'POST' && path === '/repositories/inspect') {
        return json(res, 200, await service.inspectRepository(await readJson(req)))
      }
      if (method === 'POST' && path === '/requirements/import') {
        assertJsonRequest(req)
        const request = requestAbortSignal(req, res)
        try {
          return json(res, 200, await service.importRequirementDocument(await readJson(req, MAX_REQUIREMENT_IMPORT_BODY_BYTES), request.signal))
        } finally {
          request.dispose()
        }
      }
      if (method === 'POST' && path === '/projects') {
        const project = await service.createProjectFromRequest(await readJson(req))
        return json(res, project.status === 'decomposing' ? 202 : 201, project)
      }
      const createRequirementDecisionDirect = matchOne(path, /^\/projects\/([^/]+)\/requirement-decisions$/u)
      if (createRequirementDecisionDirect !== undefined && method === 'POST') return json(res, 201, await service.createProjectRequirementDecision(createRequirementDecisionDirect, await readJson(req)))
      const resolveRequirementDecisionDirect = matchTwo(path, /^\/projects\/([^/]+)\/requirement-decisions\/([^/]+)\/resolve$/u)
      if (resolveRequirementDecisionDirect !== undefined && method === 'POST') return json(res, 200, await service.resolveProjectRequirementDecision(resolveRequirementDecisionDirect[0], resolveRequirementDecisionDirect[1], await readJson(req)))
      await service.serializedMutation(async () => {
        if (method === 'POST' && path === '/agents') {
          return json(res, 201, await service.createAgent(await readJson(req)))
        }
        if (method === 'POST' && path === '/squads') {
          return json(res, 201, await service.createSquad(await readJson(req)))
        }
        if (method === 'POST' && path === '/artifacts') {
          return json(res, 201, await service.attachArtifact(await readJson(req)))
        }
        const squadClone = matchOne(path, /^\/squads\/([^/]+)\/clone$/)
        if (squadClone !== undefined && method === 'POST') {
          return json(res, 201, await service.cloneSquad(squadClone, await readJson(req)))
        }
        const squadArchive = matchOne(path, /^\/squads\/([^/]+)\/archive$/)
        if (squadArchive !== undefined && method === 'POST') {
          return json(res, 200, await service.archiveSquad(squadArchive, await readJson(req)))
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
        const runtimeArchive = matchOne(path, /^\/runtimes\/([^/]+)\/archive$/)
        if (runtimeArchive !== undefined && method === 'POST') {
          return json(res, 200, await service.archiveRuntime(runtimeArchive, await readJson(req)))
        }
        const runtime = matchOne(path, /^\/runtimes\/([^/]+)$/)
        if (runtime !== undefined && method === 'PUT') {
          return json(res, 200, await service.updateRuntime(runtime, await readJson(req)))
        }
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
        const agentRuntime = matchOne(path, /^\/agents\/([^/]+)\/runtime$/)
        if (agentRuntime !== undefined && method === 'PUT') {
          return json(res, 200, await service.bindAgentRuntime(agentRuntime, await readJson(req)))
        }
        const agent = matchOne(path, /^\/agents\/([^/]+)$/)
        if (agent !== undefined && method === 'PUT') {
          return json(res, 200, await service.updateAgent(agent, await readJson(req)))
        }
        if (agent !== undefined && method === 'DELETE') {
          await service.deleteAgent(agent)
          return json(res, 200, { ok: true })
        }

        const projectSquadDefault = matchTwo(path, /^\/projects\/([^/]+)\/squad-bindings\/([^/]+)\/default$/)
        if (projectSquadDefault !== undefined && method === 'PUT') return json(res, 200, await service.setDefaultProjectSquadBinding(projectSquadDefault[0], projectSquadDefault[1], await readJson(req)))
        const projectSquadBinding = matchTwo(path, /^\/projects\/([^/]+)\/squad-bindings\/([^/]+)$/)
        if (projectSquadBinding !== undefined && method === 'DELETE') return json(res, 200, await service.unbindProjectSquad(projectSquadBinding[0], projectSquadBinding[1], await readJson(req)))

        const projectAgentsBatch = matchOne(path, /^\/projects\/([^/]+)\/agents\/batch$/)
        if (projectAgentsBatch !== undefined && method === 'POST') return json(res, 201, await service.addProjectAgents(projectAgentsBatch, await readJson(req)))
        const projectAgent = matchTwo(path, /^\/projects\/([^/]+)\/agents\/([^/]+)$/)
        if (projectAgent !== undefined && method === 'PUT') return json(res, 200, await service.updateProjectAgent(projectAgent[0], projectAgent[1], await readJson(req)))
        if (projectAgent !== undefined && method === 'DELETE') return json(res, 200, await service.removeProjectAgent(projectAgent[0], projectAgent[1], await readJson(req)))
        const projectAgents = matchOne(path, /^\/projects\/([^/]+)\/agents$/)
        if (projectAgents !== undefined && method === 'POST') return json(res, 201, await service.addProjectAgent(projectAgents, await readJson(req)))
        const projectAssignments = matchOne(path, /^\/projects\/([^/]+)\/task-assignments$/)
        if (projectAssignments !== undefined && method === 'POST') return json(res, 200, await service.assignProjectTasks(projectAssignments, await readJson(req)))
        if (method === 'POST' && path === '/usage') return json(res, 200, await service.recordFeatureUsage(await readJson(req)))
        if (method === 'DELETE' && path === '/usage') { await service.clearFeatureUsage(); return json(res, 200, { ok: true }) }

        const projectTasks = matchOne(path, /^\/projects\/([^/]+)\/tasks$/)
        if (projectTasks !== undefined && method === 'POST') {
          return json(res, 201, await service.createTask(projectTasks, await readJson(req)))
        }
        const projectResources = matchOne(path, /^\/projects\/([^/]+)\/resources$/)
        if (projectResources !== undefined && method === 'POST') {
          return json(res, 201, await service.createProjectResource(projectResources, await readJson(req)))
        }
        const resourceRuntime = matchOne(path, /^\/resources\/([^/]+)\/runtime$/)
        if (resourceRuntime !== undefined && method === 'PUT') {
          return json(res, 200, await service.bindResourceRuntime(resourceRuntime, await readJson(req)))
        }
        const projectWorkspace = matchOne(path, /^\/projects\/([^/]+)\/workspace$/)
        if (projectWorkspace !== undefined && method === 'POST') {
          return json(res, 200, await service.linkProjectWorkspace(projectWorkspace, await readJson(req)))
        }
        const project = matchOne(path, /^\/projects\/([^/]+)$/)
        if (project !== undefined && method === 'PUT') {
          return json(res, 200, await service.updateProject(project, await readJson(req)))
        }
        if (project !== undefined && method === 'DELETE') {
          await service.deleteProject(project)
          return json(res, 200, { ok: true })
        }
        const confirmDelivery = matchOne(path, /^\/projects\/([^/]+)\/delivery\/confirm$/)
        if (confirmDelivery !== undefined && method === 'POST') {
          return json(res, 200, await service.confirmProjectDelivery(confirmDelivery, await readJson(req) as { actor: string; note?: string }))
        }
        const resolveReview = matchOne(path, /^\/projects\/([^/]+)\/review\/resolve$/)
        if (resolveReview !== undefined && method === 'POST') {
          return json(res, 200, await service.resolveProjectReview(resolveReview, await readJson(req)))
        }
        const closeDelivery = matchOne(path, /^\/projects\/([^/]+)\/delivery\/close$/)
        if (closeDelivery !== undefined && method === 'POST') {
          return json(res, 200, await service.closeProjectDelivery(closeDelivery, await readJson(req) as { actor: string; note?: string }))
        }
        const replan = matchOne(path, /^\/projects\/([^/]+)\/replan$/)
        if (replan !== undefined && method === 'POST') {
          return json(res, 202, await service.replanProject(replan, await readJson(req)))
        }
        const decompose = matchOne(path, /^\/projects\/([^/]+)\/decompose$/)
        if (decompose !== undefined && method === 'POST') {
          return json(res, 202, await service.startDecomposition(decompose))
        }
        const appendDecomposition = matchOne(path, /^\/projects\/([^/]+)\/decompositions$/)
        if (appendDecomposition !== undefined && method === 'POST') {
          return json(res, 202, await service.appendDecomposition(appendDecomposition, await readJson(req)))
        }
        const reviseDecomposition = matchTwo(path, /^\/projects\/([^/]+)\/decompositions\/([^/]+)\/revise$/)
        if (reviseDecomposition !== undefined && method === 'POST') {
          return json(res, 202, await service.reviseDecomposition(reviseDecomposition[0], reviseDecomposition[1], await readJson(req)))
        }
        const openDirectory = matchOne(path, /^\/projects\/([^/]+)\/open-directory$/)
        if (openDirectory !== undefined && method === 'POST') {
          return json(res, 200, await service.openProjectDirectory(openDirectory))
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

function matchTwo(path: string, expression: RegExp): [string, string] | undefined {
  const match = expression.exec(path)
  if (match?.[1] === undefined || match[2] === undefined) return undefined
  return [decodeURIComponent(match[1]), decodeURIComponent(match[2])]
}

async function readJson(req: IncomingMessage, maxBytes = MAX_BODY_BYTES): Promise<unknown> {
  let size = 0
  const chunks: Buffer[] = []
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    size += buffer.byteLength
    if (size > maxBytes) throw new WorkflowError('payload-too-large', `Request body exceeds ${Math.floor(maxBytes / (1024 * 1024))} MiB.`, 413)
    chunks.push(buffer)
  }
  if (chunks.length === 0) return {}
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'))
  } catch {
    throw new WorkflowError('invalid-json', 'Request body is not valid JSON.', 400)
  }
}

function assertLoopbackRead(req: IncomingMessage): void {
  assertLoopbackHost(req)
}

function assertSameOrigin(req: IncomingMessage): void {
  const requestHost = assertLoopbackHost(req)
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

function assertLoopbackHost(req: IncomingMessage): URL {
  const host = req.headers.host
  if (host === undefined) throw new WorkflowError('invalid-origin', 'Host header is required.', 403)
  let requestHost: URL
  try {
    requestHost = new URL(`http://${host}`)
  } catch {
    throw new WorkflowError('invalid-origin', 'Host header is invalid.', 403)
  }
  if (!['127.0.0.1', 'localhost', '::1'].includes(requestHost.hostname)) {
    throw new WorkflowError('invalid-origin', 'API reads and mutations are allowed only from the loopback Harness Web host.', 403)
  }
  const remoteAddress = req.socket.remoteAddress
  if (remoteAddress === undefined || !isLoopbackAddress(remoteAddress)) {
    throw new WorkflowError('invalid-origin', 'API reads and mutations require a loopback network peer.', 403)
  }
  return requestHost
}

function isLoopbackAddress(address: string): boolean {
  return address === '::1' || address === '127.0.0.1' || address.startsWith('127.') || address.startsWith('::ffff:127.')
}

function requestAbortSignal(req: IncomingMessage, res: ServerResponse): { signal: AbortSignal; dispose: () => void } {
  const controller = new AbortController()
  const abort = () => controller.abort(new WorkflowError('cancelled', 'PDF 解析请求已断开。', 499))
  const close = () => { if (!res.writableEnded) abort() }
  req.once('aborted', abort)
  res.once('close', close)
  return {
    signal: controller.signal,
    dispose: () => {
      req.removeListener('aborted', abort)
      res.removeListener('close', close)
    },
  }
}

function requestHasBody(req: IncomingMessage): boolean {
  const length = req.headers['content-length']
  return (length !== undefined && length !== '0') || req.headers['transfer-encoding'] !== undefined
}

function assertJsonRequest(req: IncomingMessage): void {
  const contentEncoding = req.headers['content-encoding']
  if (contentEncoding !== undefined && contentEncoding.toLocaleLowerCase() !== 'identity') {
    throw new WorkflowError('unsupported-content-encoding', 'Compressed JSON mutations are not supported.', 415)
  }
  const contentType = req.headers['content-type']?.split(';', 1)[0]?.trim().toLocaleLowerCase()
  if (contentType !== 'application/json') {
    throw new WorkflowError('unsupported-media-type', 'JSON mutations must use application/json.', 415)
  }
}

function javascript(res: ServerResponse, body: Uint8Array): void {
  if (res.headersSent) return
  res.statusCode = 200
  res.setHeader('content-type', 'text/javascript; charset=utf-8')
  res.setHeader('cache-control', 'public, max-age=31536000, immutable')
  res.setHeader('x-content-type-options', 'nosniff')
  res.setHeader('cross-origin-resource-policy', 'same-origin')
  res.end(body)
}

function commandResult(command: { status: string; result?: Record<string, unknown> | undefined }): Record<string, unknown> {
  if (command.status !== 'completed' || command.result === undefined) throw new WorkflowError('command-result-missing', 'The team command did not produce a completed result.', 500)
  return command.result
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
