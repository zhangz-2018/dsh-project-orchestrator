import { randomUUID } from 'node:crypto'
import { LlmAdapter, LlmError, ToolCallId } from '@deepseek-ai/dsh-llm'
import { SessionId } from '@deepseek-ai/dsh-session'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { NativeReadOnlyPilot, taskRunExecutionContractDigest } from '../../lib/index.js'

export const name = 'po-compat-provider'
export const inject = ['llm', 'tools', 'agents', 'agentPresets', 'sessions', 'sessionQuery', 'webServer']

/** 安装仅用于隔离验收的本地模型，不读取凭据或访问外部模型。 */
export function apply(ctx) {
  const state = {
    /** 实际进入本地适配器的请求次数，包含错误和取消用例。 */
    modelCalls: 0,
    /** 探针工具执行次数；规划 guard 生效时必须保持 0。 */
    probeExecutions: 0,
    /** 后续模型请求确实收到工具拒绝反馈的次数。 */
    toolDenials: 0,
  }
  const modelInfo = { id: 'compat', name: 'Local compatibility fixture', inputModalities: ['text'], context: { contextWindow: 32768 }, defaultMaxTokens: 4096 }
  class LocalAdapter extends LlmAdapter {
    /** 提供与注册路由一致的目录身份，不查询外部模型目录。 */
    providerInfo(provider) { return { id: provider, name: 'Local fixture' } }
    /** 仅广告隔离验收的本地模型。 */
    async listModels() { return [modelInfo] }
    /** 返回实际请求的路由身份及固定上下文限制。 */
    async resolveModel(provider, model) { return { ...modelInfo, provider, id: model } }
    /** 根据测试标记产生成功、错误、取消或工具请求，始终遵守真实流协议。 */
    async *stream(options) {
      state.modelCalls += 1
      const prompt = JSON.stringify(options.messages)
      if (prompt.includes('PO_COMPAT_FAILURE')) throw new LlmError('Expected isolated failure', 'COMPAT_FAILURE')
      if (prompt.includes('PO_COMPAT_WAIT')) {
        await new Promise((resolve) => {
          if (options.signal.aborted) return resolve()
          options.signal.addEventListener('abort', resolve, { once: true })
        })
        throw options.signal.reason ?? new Error('Cancelled fixture')
      }
      if (prompt.includes('PO_COMPAT_GUARD') && !prompt.includes('po-compat-call')) {
        const id = ToolCallId('po-compat-call')
        yield { type: 'block-start', index: 0, blockType: 'tool-call' }
        yield { type: 'tool-call-delta', index: 0, id, name: 'po_compat_probe', argumentsDelta: '{}' }
        yield { type: 'block-end', index: 0, block: { type: 'tool-call', id, name: 'po_compat_probe', arguments: '{}' } }
        yield { type: 'finish', reason: { kind: 'tool-calls' } }
        return
      }
      if (prompt.includes('This planning agent cannot execute tools.')) state.toolDenials += 1
      const text = JSON.stringify({ name: 'Compatibility reviewer', role: 'Reviewer', description: 'Local compatibility fixture.', persona: 'Review the provided evidence. Report gaps without editing files.', preset: 'standard', toolPolicy: 'read_only', skills: [], warnings: [], feedback: 'Local lifecycle verified.', assumptions: [], openQuestions: [] })
      yield { type: 'block-start', index: 0, blockType: 'text' }
      yield { type: 'text-delta', index: 0, text }
      yield { type: 'block-end', index: 0, block: { type: 'text', text } }
      yield { type: 'finish', reason: { kind: 'stop' } }
    }
  }
  ctx.llm.registerAdapter(['po-compat'], new LocalAdapter())
  ctx.tools.register(defineTool({
    name: 'po_compat_probe', description: 'Local guard verification probe.', parameters: {},
    output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: value }] },
    execute: async () => { state.probeExecutions += 1; return 'probe executed' },
  }))
  ctx.webServer.register({ kind: 'prefix', path: '/__po_compat', handler: async (req, res) => {
    let result
    if (req.url?.includes('/native-pilot')) {
      // 这里只验证真实 Host 生命周期；批准/成员均为隔离 fixture，不构成发布门禁证据。
      const mode = new URL(req.url, 'http://127.0.0.1').searchParams.get('mode') ?? 'success'
      const rows = () => { const map = new Map(); return { get: (key) => map.get(key), entries: () => map.entries(), put: async (key, value) => { map.set(key, value) } } }
      const store = { projects: rows(), taskRuns: rows(), agents: rows(), artifacts: rows() }
      const run = { id: 'native-run', projectId: 'native-project', taskId: 'native-task', agentId: 'native-member', planSnapshotId: 'native-plan', executionDispatchId: 'native-dispatch', status: 'running', cwd: process.cwd() }
      run.executionContractDigest = taskRunExecutionContractDigest(run)
      await store.projects.put('native-project', { revision: 1, approvedRevision: 1, currentPlanSnapshotId: 'native-plan' })
      await store.taskRuns.put(run.id, run)
      await store.agents.put('native-member', { id: 'native-member', status: 'active' })
      const parent = await ctx.agents.create({ sessionId: SessionId(`po-native-parent-${randomUUID()}`), meta: { cwd: process.cwd() }, agentOptions: { provider: 'po-compat', model: 'compat' } })
      const pilot = new NativeReadOnlyPilot(ctx, store, (work) => work())
      pilot.attachParent(run.id, parent.agent)
      const controller = new AbortController()
      const timer = mode === 'cancel' ? setTimeout(() => controller.abort(), 100) : undefined
      const callsBefore = state.modelCalls
      try {
        const response = await pilot.review(run.id, parent.agent, mode === 'cancel' ? 'PO_COMPAT_WAIT' : mode === 'guard' ? 'PO_COMPAT_GUARD' : 'Review this isolated evidence.', controller.signal)
        result = { ok: true, ...response, artifact: store.artifacts.get(`native-review:${run.id}`) }
      } catch (error) { result = { ok: false, code: error.code, diagnostic: String(error), cause: String(error.cause), artifact: store.artifacts.get(`native-review:${run.id}`) } }
      finally { clearTimeout(timer); pilot.detachParent(run.id, parent.agent); pilot.close(); await parent.dispose() }
      result.modelCalls = state.modelCalls - callsBefore
    } else if (req.url?.endsWith('/cancel')) {
      const handle = await ctx.agents.create({ sessionId: SessionId(`po-compat-${randomUUID()}`), meta: { cwd: process.cwd() }, agentOptions: { provider: 'po-compat', model: 'compat' }, setup: (agentCtx) => ctx.agentPresets.mount(agentCtx, 'standard').then(() => {}) })
      try {
        const { createUserMessage } = await import('@deepseek-ai/dsh-llm')
        handle.agent.followup(createUserMessage({ content: [{ type: 'text', text: 'PO_COMPAT_WAIT' }], source: { kind: 'user' } }))
        const timer = setTimeout(() => handle.agent.cancel({ kind: 'user' }), 100)
        try { await handle.agent.whenIdle() } finally { clearTimeout(timer) }
        const snapshot = await ctx.sessionQuery.readSession(handle.agent.id)
        result = { terminal: snapshot.events.findLast((event) => event.type === 'turn/end')?.data.reason }
      } finally { await handle.dispose() }
    } else {
      result = { ...state, activeAgents: ctx.agents.list().length }
    }
    res.writeHead(200, { 'content-type': 'application/json' })
    res.end(JSON.stringify(result))
  } })
}
