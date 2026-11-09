import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-attachment'
import type {} from '@deepseek-ai/dsh-host-webserver'
import type {} from '@deepseek-ai/dsh-llm'
import { createHttpHandler } from './http.js'
import { OrchestratorService } from './service.js'
import { OrchestratorStore, orchestratorDomain } from './storage.js'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { CommandRunner } from './execution/command-runner.js'
import { optionalHostService } from './native/service.js'
import type { SubprocessRuntime } from '@deepseek-ai/dsh-subprocess'

export * from './types.js'
export * from './workflow.js'
export * from './prompts.js'
export * from './default-agents.js'
export * from './workspace-writer.js'
export * from './storage-unit-of-work.js'
export * from './storage/reconciliation.js'
export * from './planning/repository-stack-profile.js'
export * from './planning/repository-evidence.js'
export * from './planning/verification-tool-evidence.js'
export * from './planning/repair-lineage.js'
export * from './planning/coordinator.js'
export * from './planning/assignment-stage.js'
export * from './planning/binding-stage.js'
export * from './planning/review-stage.js'
export * from './planning/task-preflight-stage.js'
export * from './planning/task-shaping-stage.js'
export * from './planning/repository-policy.js'
export * from './planning/providers/index.js'
export * from './verification/browser.js'
export * from './verification/service.js'
export * from './execution/command-runner.js'
export * from './execution/broker.js'
export * from './execution/runtime-adapter.js'
export * from './query/service.js'
export * from './delivery/service.js'
export * from './delivery/git-evidence.js'
export * from './native/types.js'
export * from './native/service.js'
export * from './native/subagent.js'
export { OrchestratorStore, orchestratorDomain }
export { OrchestratorService } from './service.js'
export { createHttpHandler } from './http.js'

export const name = 'project-orchestrator'
/** Host 服务契约；sessionQuery 负责新版一致会话读取。 */
export const inject = [
  'storageDomain',
  'webServer',
  'attachments',
  'llm',
  'agents',
  'agentPresets',
  'agentDefaultModel',
  'sessions',
  'sessionQuery',
  'tools',
  'skills',
]

export async function apply(ctx: Context): Promise<void> {
  const domain = await ctx.storageDomain.open(orchestratorDomain)
  ctx.effect(() => () => domain.close(), 'project-orchestrator.storage')

  const service = new OrchestratorService(ctx, new OrchestratorStore(domain), undefined, undefined, {
    commandBackend: 'dsh_subprocess',
    nativeReadOnlyPilot: process.env.DSH_PO_NATIVE_READONLY_PILOT === '1',
    commandRunner: new CommandRunner(() => optionalHostService<SubprocessRuntime>(ctx, 'subprocess')),
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
