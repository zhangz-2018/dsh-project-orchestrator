import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-attachment'
import type {} from '@deepseek-ai/dsh-host-webserver'
import type {} from '@deepseek-ai/dsh-llm'
import { createHttpHandler } from './http.js'
import { OrchestratorService } from './service.js'
import { OrchestratorStore, orchestratorDomain } from './storage.js'
import { homedir } from 'node:os'
import { join } from 'node:path'

export * from './types.js'
export * from './workflow.js'
export * from './prompts.js'
export * from './default-agents.js'
export * from './workspace-writer.js'
export * from './storage-unit-of-work.js'
export * from './planning/repository-stack-profile.js'
export * from './planning/repository-evidence.js'
export * from './planning/repair-lineage.js'
export * from './planning/coordinator.js'
export * from './planning/repository-policy.js'
export * from './planning/providers/index.js'
export * from './verification/browser.js'
export * from './execution/broker.js'
export * from './execution/runtime-adapter.js'
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
  'skills',
]

export async function apply(ctx: Context): Promise<void> {
  const domain = await ctx.storageDomain.open(orchestratorDomain)
  ctx.effect(() => () => domain.close(), 'project-orchestrator.storage')

  const service = new OrchestratorService(ctx, new OrchestratorStore(domain), undefined, undefined, {
    workspaceWriter: {
      workspaceIdentity: process.env.DSH_WORKSPACE_ID ?? `${orchestratorDomain.name}:${homedir()}`,
      lockDirectory: process.env.DSH_PROJECT_ORCHESTRATOR_LOCK_DIR ?? join(homedir(), '.dsh', 'project-orchestrator', 'writer-locks'),
    },
  })
  ctx.effect(() => () => service.close(), 'project-orchestrator.lifecycle')
  await service.initialize()

  ctx.effect(() => ctx.webServer.register({
    kind: 'prefix',
    path: '/project-orchestrator/api',
    handler: createHttpHandler(service),
  }), 'project-orchestrator.http')
}
