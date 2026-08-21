import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-attachment'
import type {} from '@deepseek-ai/dsh-host-webserver'
import type {} from '@deepseek-ai/dsh-llm'
import { createHttpHandler } from './http.js'
import { OrchestratorService } from './service.js'
import { OrchestratorStore, orchestratorDomain } from './storage.js'

export * from './types.js'
export * from './workflow.js'
export { OrchestratorStore, orchestratorDomain }
export { OrchestratorService } from './service.js'
export { createHttpHandler } from './http.js'

export const name = 'project-orchestrator'
export const inject = [
  'storageDomain',
  'webServer',
  'attachments',
  'llm',
  'agents',
  'agentPresets',
  'agentDefaultModel',
  'sessions',
  'tools',
]

export async function apply(ctx: Context): Promise<void> {
  const domain = await ctx.storageDomain.open(orchestratorDomain)
  ctx.effect(() => () => domain.close(), 'project-orchestrator.storage')

  const service = new OrchestratorService(ctx, new OrchestratorStore(domain))
  ctx.effect(() => () => service.close(), 'project-orchestrator.lifecycle')
  await service.initialize()

  ctx.effect(() => ctx.webServer.register({
    kind: 'prefix',
    path: '/project-orchestrator/api',
    handler: createHttpHandler(service),
  }), 'project-orchestrator.http')
}
