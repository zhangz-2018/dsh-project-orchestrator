import { symbols, type Context } from '@deepseek-ai/cordis'
import type { ForgeService, ChangeRequestRef, ChangeRequestSnapshot } from '@deepseek-ai/dsh-experimental-forge'
import { z } from 'zod'
import { randomUUID } from 'node:crypto'
import type { OrchestratorStore } from '../storage.js'
import { WorkflowError } from '../workflow.js'
import type { NativeDiagnostics, PullRequestBinding } from './types.js'

/** 只读使用真实 Cordis 服务；测试用简化 Context 也允许显式注入。 */
export function optionalHostService<T>(ctx: Context, name: string): T | undefined {
  return typeof ctx.get === 'function' ? ctx.get(name, false) as T | undefined : (ctx as unknown as Record<string, T | undefined>)[name]
}

/** Cordis 每次访问可生成新代理；只用原对象判断换代，调用仍保留代理的 effect 归属。 */
export function hostServiceIdentity(service: object): object {
  return (service as Record<symbol, object | undefined>)[symbols.original] ?? service
}

/** 禁止把凭据、片段或非 Web 协议保存在可点击链接中。 */
export function safeWebUrl(value: string): string {
  const url = new URL(value)
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) throw new WorkflowError('forge-url-invalid', 'Use a canonical HTTPS pull request URL without credentials, query or fragment.', 400)
  return url.href
}

const BindInput = z.object({
  /** 用户选择的远端 PR；必须经 provider 解析并规范化。 */
  url: z.string().max(4096),
  /** 操作者确认的本地 commit，必须与实际 Git HEAD 一致。 */
  expectedHead: z.string().regex(/^[0-9a-f]{40,64}$/u),
  /** 上次读取的修改时间；null 仅允许创建尚不存在的绑定。 */
  expectedUpdatedAt: z.string().datetime().nullable(),
}).strict()

/** 只读 Forge 适配；观察缓存归 Forge 所有，业务绑定归本项目 Store 所有。 */
export class NativeIntegrationService {
  /** 一项目一个 watcher；保存 ref 和 disposer 用于删除、换绑及 Host 释放。 */
  private readonly watches = new Map<string, { bindingTime: string; forge: ForgeService; dispose: () => void }>()

  constructor(
    /** 提供可选服务的 Host 上下文，不读取任何凭据。 */
    private readonly ctx: Context,
    /** 独立持久绑定表；不会改写旧任务或批准事实。 */
    private readonly store: OrchestratorStore,
    /** 复用当前 Host/CLI 命令后端读取 Git。 */
    private readonly git: (cwd: string, args: string[]) => Promise<string>,
    /** 启动入口显式传入命令后端，避免把模拟 Context 当真实 Host。 */
    private readonly commandBackend: NativeDiagnostics['commandBackend'],
  ) {}

  /** 仅检查服务存在性；provider 登录和策略是否可用需针对具体请求另行探测。 */
  diagnostics(): NativeDiagnostics {
    const definitions = [
      ['subprocess', '进程执行', '托管进程生命周期；业务授权由项目负责，不代表文件或网络沙箱。'],
      ['sandboxPolicy', '执行策略', '服务存在不代表进程已在沙箱内执行。'],
      ['forge', 'PR / MR', '只读绑定、状态、完整检查和 diff；针对仓库探测登录。'],
      ['subagents', '子智能体', '任务内受控只读试点；必须满足父任务身份、工具和预算门禁。'],
      ['agentTeams', 'Agent Team', '待只读子智能体试点通过后评估；共享 cwd 不承担写入隔离。'],
      ['workspaceChanges', '工作区变更', '当前会话的临时视图，持久证据仍由 Git 和项目记录提供。'],
      ['worktrees', '原生 worktree', '保留项目现有 worktree 和 lease 所有权。'],
      ['web', '联网搜索', '独立 provider 和凭据；冻结规划不开放工具。'],
      ['schedule', '定时提醒', '使用原生会话入口；提醒投递不推进项目业务状态。'],
      ['speechToText', '语音输入', '使用原生输入；转录后仍需在需求表单中审阅。'],
      ['pluginMarket', '插件索引', '使用原生插件市场安装及启用，不自动修改 Host 开关。'],
    ]
    const capabilities: NativeDiagnostics['capabilities'] = definitions.map(([id, label, detail]) => ({ id: id!, label: label!, detail: detail!, state: optionalHostService(this.ctx, id!) === undefined ? 'missing' : 'present' }))
    const permissionPresets = optionalHostService<{ names: readonly string[] }>(this.ctx, 'permissionPresets')
    capabilities.push({ id: 'autoReview', label: 'Auto review', state: permissionPresets?.names.includes('auto') ? 'present' : 'missing', detail: '仅检测原生 Auto 选项，不改变当前会话权限或项目批准。' })
    return { observedAt: new Date().toISOString(), commandBackend: this.commandBackend, capabilities }
  }

  /** 在同一 writer 串行区内调用；CAS 防换绑覆盖，校验本地 HEAD 和真实 remote。 */
  async bind(projectId: string, input: unknown): Promise<PullRequestBinding> {
    const parsed = BindInput.parse(input)
    const project = this.requireProject(projectId)
    const previous = this.store.pullRequestBindings.get(projectId)
    if ((previous?.updatedAt ?? null) !== parsed.expectedUpdatedAt) throw new WorkflowError('forge-binding-stale', 'Pull request binding changed; reload before editing.', 409)
    const forge = this.requireForge()
    const ref = forge.changeRequestFromUrl(safeWebUrl(parsed.url))
    if (ref === undefined) throw new WorkflowError('forge-provider-unavailable', 'No registered provider serves this URL.', 503)
    const [head, remote] = await Promise.all([this.git(project.cwd, ['rev-parse', 'HEAD^{commit}']), this.git(project.cwd, ['remote', 'get-url', 'origin'])])
    if (head.trim() !== parsed.expectedHead) throw new WorkflowError('forge-head-stale', 'Local HEAD changed; review the current commit before binding.', 409)
    const repository = forge.repositoryFromRemote(remote.trim())
    if (repository === undefined || !this.sameRepository(repository, ref.repository)) throw new WorkflowError('forge-repository-mismatch', 'Pull request repository does not match this project origin.', 409)
    const readiness = await forge.readiness(repository, AbortSignal.timeout(15000))
    if (readiness.state !== 'ready') throw new WorkflowError(`forge-${readiness.state}`, 'Forge provider is not ready; check gh installation, login and host connectivity.', 503)
    const now = new Date(Math.max(Date.now(), previous === undefined ? 0 : Date.parse(previous.updatedAt) + 1)).toISOString()
    const binding: PullRequestBinding = { schemaVersion: 1, projectId, repository, number: ref.number, url: safeWebUrl(forge.changeRequestUrl(ref)), expectedHead: parsed.expectedHead, boundAt: previous?.boundAt ?? now, updatedAt: now }
    await this.store.pullRequestBindings.put(projectId, binding)
    this.watch(binding, forge)
    return binding
  }

  /** 幂等释放所有 watcher；Host 重启后第一次读取会基于持久绑定重建。 */
  close(): void {
    for (const entry of this.watches.values()) entry.dispose()
    this.watches.clear()
  }

  /** 删除本地关联，绝不关闭、修改或合并远端 PR；须在 writer 串行区内调用。 */
  async unbind(projectId: string, input: unknown): Promise<void> {
    this.requireProject(projectId)
    const { expectedUpdatedAt } = z.object({ expectedUpdatedAt: z.string().datetime() }).strict().parse(input)
    const binding = this.store.pullRequestBindings.get(projectId)
    if (binding?.updatedAt !== expectedUpdatedAt) throw new WorkflowError('forge-binding-stale', 'Pull request binding changed; reload before removing.', 409)
    await this.store.pullRequestBindings.delete(projectId)
    this.watches.get(projectId)?.dispose()
    this.watches.delete(projectId)
  }

  /** 读取共享轮询状态；错误、过期和旧 head 均可见，永远不产生项目验收通过。 */
  status(projectId: string) {
    this.requireProject(projectId)
    const binding = this.store.pullRequestBindings.get(projectId) ?? null
    const forge = optionalHostService<ForgeService>(this.ctx, 'forge')
    if (binding === null) return { binding, state: 'unbound' as const }
    if (forge === undefined) return { binding, state: 'unavailable' as const }
    this.watch(binding, forge)
    const update = forge.latest(this.ref(binding))
    if (update === undefined) return { binding, state: 'loading' as const }
    if ('failure' in update) return { binding, state: 'error' as const, failure: { code: update.failure.code, message: 'Forge 读取失败，请检查登录、限流和连接状态。' }, observedAt: update.fetchedAt }
    const stale = Date.now() - update.fetchedAt > 120000
    return { binding, state: stale ? 'stale' as const : 'observed' as const, observedAt: update.fetchedAt, headMatches: update.snapshot.headSha === binding.expectedHead, snapshot: update.snapshot }
  }

  /** 拉取完整检查；分页截断不冒充完整，snapshot 的 ref 和 head 必须匹配绑定。 */
  async checks(projectId: string, signal: AbortSignal): Promise<ChangeRequestSnapshot> {
    const binding = this.requireBinding(projectId)
    const snapshot = await this.requireForge().fetchChecks(this.ref(binding), signal)
    if ('code' in snapshot) throw new WorkflowError(`forge-${snapshot.code}`, 'Unable to fetch complete pull request checks.', 503)
    if (!this.sameRepository(snapshot.ref.repository, binding.repository) || snapshot.ref.number !== binding.number || snapshot.headSha !== binding.expectedHead) throw new WorkflowError('forge-head-stale', 'External checks do not match the bound repository and commit.', 409)
    if (snapshot.checksTruncated) throw new WorkflowError('forge-checks-incomplete', 'Forge returned an incomplete check list.', 409)
    // 读取中发生换绑/解绑时丢弃旧响应，避免迟到数据污染新关联。
    if (this.store.pullRequestBindings.get(projectId)?.updatedAt !== binding.updatedAt) throw new WorkflowError('forge-binding-stale', 'Binding changed during the read.', 409)
    return snapshot
  }

  /** diff 前后核对精确 head；只展示有界文本，不把外部内容升级为执行指令。 */
  async diff(projectId: string, signal: AbortSignal) {
    const binding = this.requireBinding(projectId)
    await this.checks(projectId, signal)
    if (this.store.pullRequestBindings.get(projectId)?.updatedAt !== binding.updatedAt) throw new WorkflowError('forge-binding-stale', 'Binding changed before the diff read.', 409)
    const patch = await this.requireForge().diff(this.ref(binding), signal)
    if (typeof patch !== 'string') throw new WorkflowError(`forge-${patch.code}`, 'Unable to read pull request diff.', 503)
    if (Buffer.byteLength(patch) > 100000) throw new WorkflowError('forge-diff-too-large', 'Diff exceeds the 100 KB preview limit; open it on the code host.', 413)
    await this.checks(projectId, signal)
    if (this.store.pullRequestBindings.get(projectId)?.updatedAt !== binding.updatedAt) throw new WorkflowError('forge-binding-stale', 'Binding changed during the diff read.', 409)
    return { headSha: binding.expectedHead, observedAt: new Date().toISOString(), patch }
  }

  /** 显式采集完整检查为持久参考 Artifact；须在 writer 串行区内调用，不生成 VerificationEvidence。 */
  async capture(projectId: string, signal: AbortSignal) {
    const binding = this.requireBinding(projectId)
    const snapshot = await this.checks(projectId, signal)
    if (this.store.pullRequestBindings.get(projectId)?.updatedAt !== binding.updatedAt) throw new WorkflowError('forge-binding-stale', 'Binding changed before evidence capture.', 409)
    const content = JSON.stringify(snapshot)
    if (content.length > 100000) throw new WorkflowError('forge-evidence-too-large', 'Complete check snapshot exceeds the artifact limit.', 413)
    const observedAt = new Date().toISOString()
    const id = `native-pr:${projectId}:${randomUUID()}`
    await this.store.artifacts.put(id, { id, projectId, kind: 'log', name: `PR #${binding.number} checks reference`, status: 'available', uri: binding.url, content, metadata: { schemaVersion: 1, source: 'forge', headSha: snapshot.headSha, bindingUpdatedAt: binding.updatedAt, observedAt, checksComplete: true, acceptanceEffect: 'none' }, createdAt: observedAt })
    return { artifactId: id, headSha: snapshot.headSha, observedAt }
  }

  /** 按项目替换观察，轮询和 provider 撤销由 Forge 自身负责。 */
  private watch(binding: PullRequestBinding, forge: ForgeService): void {
    const current = this.watches.get(binding.projectId)
    if (current?.bindingTime === binding.updatedAt && hostServiceIdentity(current.forge) === hostServiceIdentity(forge)) return
    current?.dispose()
    this.watches.set(binding.projectId, { bindingTime: binding.updatedAt, forge, dispose: forge.watch(this.ref(binding), () => {}) })
  }

  /** 项目必须仍存在；不接受其他项目的任意外部引用。 */
  private requireProject(id: string) {
    const project = this.store.projects.get(id)
    if (project === undefined) throw new WorkflowError('project-not-found', 'Project was not found.', 404)
    return project
  }

  /** 原生服务缺失时给出显式失败，不降级调用 gh 或其他远端通道。 */
  private requireForge(): ForgeService {
    const forge = optionalHostService<ForgeService>(this.ctx, 'forge')
    if (forge === undefined) throw new WorkflowError('forge-unavailable', 'Harness Forge service is unavailable.', 503)
    return forge
  }

  /** 检查项目及本地绑定，为只读远端调用生成输入。 */
  private requireBinding(projectId: string): PullRequestBinding {
    this.requireProject(projectId)
    const binding = this.store.pullRequestBindings.get(projectId)
    if (binding === undefined) throw new WorkflowError('forge-unbound', 'Project has no pull request binding.', 409)
    return binding
  }

  /** 保持 provider 的仓库身份，不从显示 URL 猜测 owner/repo。 */
  private ref(binding: PullRequestBinding): ChangeRequestRef { return { repository: binding.repository, number: binding.number } }

  /** GitHub 名称大小写由 provider 规范化；跨 provider 或 host 永不匹配。 */
  private sameRepository(left: ChangeRequestRef['repository'], right: ChangeRequestRef['repository']): boolean {
    return left.forge === right.forge && left.host === right.host && left.owner === right.owner && left.name === right.name
  }
}
