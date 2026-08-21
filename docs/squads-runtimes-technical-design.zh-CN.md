# 团队编排与运行环境技术方案

> 状态：评审就绪
> 日期：2026-08-21
> 目标版本：`dsh-project-orchestrator@1.5.0`
> 对应 PRD：`docs/squads-runtimes-prd.zh-CN.md`
> 基线：当前未提交工作树中的 `dsh-project-orchestrator@1.4.0`

## 1. 目标与约束

本方案在现有单 Harness Host 架构上补齐 Squad/Runtime 的 Web 管理和日常业务闭环，不建设远程执行平台。

必须保持：

- Host 与 Client 仍是同一个 Cordis dual-half 插件。
- API 前缀仍为 `/project-orchestrator/api`。
- GET 只允许 loopback；mutation 必须 same-origin。
- 所有持久化 mutation 继续进入单 Host `serializedMutation()`。
- Issue assignment 的唯一写入口继续是 `Command`。
- ProjectAgentMembership 继续是项目资格来源事实。
- Squad 不替代具体 `TaskRun.agentId` 或 `Task.agentId`。
- 未绑定 Runtime 的 Agent 继续在本机 Harness Host 执行。
- 当前存储域保持 `project_orchestrator` version 1，不引入第二套存储。

## 2. 当前实现基线

### 2.1 已有来源事实

| 领域 | 当前模型 | 位置 |
|---|---|---|
| 项目资格 | ProjectAgentMembershipRecordSchema | `src/types.ts` |
| Squad | SquadRecordSchema | `src/types.ts` |
| 委派 | DelegationRecordSchema | `src/types.ts` |
| Runtime | RuntimeRecordSchema | `src/types.ts` |
| 项目资源 | ProjectResourceSchema | `src/types.ts` |
| Issue | IssueRecordSchema | `src/types.ts` |
| 一次执行 | TaskRunRecordSchema | `src/types.ts` |
| 幂等变更 | CommandRecordSchema | `src/types.ts` |
| 审计 | ActivityEventSchema | `src/types.ts` |

`src/storage.ts` 已持久化 `runtimes`、`resources`、`issues`、`task_runs`、`squads`、`delegations`、`commands`、`activity`、`project_agent_memberships` 等表。

### 2.2 已有 Squad 服务

可直接复用：

- `createSquad()`
- `updateSquad()`
- `archiveSquad()`
- `deleteSquad()`
- `assertSquadEligibleForProject()`
- `applyCommand('assign_issue' | 'reassign_issue')`
- `applyCommand('delegate_issue')`
- child review 后的幂等 Leader wakeup

现有 HTTP：

- `GET /squads`
- `POST /squads`
- `PUT /squads/:id`
- `POST /squads/:id/archive`
- `DELETE /squads/:id`

### 2.3 已有 Runtime 服务

可直接复用：

- `createRuntime()`
- `heartbeatRuntime()`
- `deleteRuntime()`
- `validateAgentRuntime()`
- `assertAgentRuntimeAvailable()`
- `claimIssueTaskRun()` 对非 online Runtime 的暂缓领取
- heartbeat online 后 `requestDispatch()`
- `TaskRun.runtimeId`、`WorkspaceLease.runtimeId`

现有 HTTP：

- `GET /runtimes`
- `POST /runtimes`
- `POST /runtimes/:id/heartbeat`
- `DELETE /runtimes/:id`

### 2.4 现有主要缺口

| 缺口 | 当前表现 | P0 处理 |
|---|---|---|
| Squad UI | 只读，空态要求 API | 完整 CRUD、详情和项目上下文 |
| Issue Squad 选择 | 只支持 Agent selector | 分段选择并消费服务端资格投影 |
| Squad 容量 | 按同一 parent Issue 计数 | 改为 Squad 全局占用 |
| Squad 编辑保护 | 未检查活跃成员/容量 | 在 mutation 锁内失败关闭 |
| Squad 多表写 | assignment/delegation 可部分写 | 显式补偿回滚 |
| Runtime UI | 只读、手动状态、误导空态 | 默认 Host、CRUD、绑定和详情 |
| Runtime 生命周期 | 只有 health，无 archive | lifecycle 与 health 分离 |
| Runtime 更新 | 无 PUT | 新增受限更新 |
| Agent/Resource 绑定 | 只能经全量 Agent 创建/编辑或资源创建 | 独立 impact/bind 接口 |
| Runtime Inbox | 主要覆盖 Resource offline | 覆盖 Agent、Resource 和等待 TaskRun |
| 本地数据 | 清除按钮在 Runtime 页头 | 独立 local-data View |

## 3. 已确认的技术决策

### 3.1 Squad 状态机

P0 不新增 IssueStatus。

Leader 委派协议保持：

```text
Parent Issue in_progress + Leader TaskRun running
  -> delegate_issue
Parent Issue blocked + Leader TaskRun deferred
Child Issue in_progress + Member TaskRun queued/running
  -> Child Issue in_review
  -> approve_review
Delegation completed
  -> idempotent continue_issue
Parent Issue in_progress + new Leader TaskRun queued
  -> Leader final result in_review
```

`DelegationStatus.waiting_leader` 只兼容旧记录，不作为 P0 新写入目标。页面通过 Parent Issue、Delegation 和 Leader TaskRun 组合投影“等待成员/等待 Leader”，不增加第二套状态来源。

`TaskRun.status = deferred` 专用于已停止执行、等待子委派结果的旧 Leader attempt。它必须有 completedAt，永不重新派发，也不计入 Agent 占用、Runtime 排队或 Runtime 绑定阻塞；后续由新的 Leader TaskRun 继续。可执行/阻塞绑定的 TaskRun 状态统一为 queued、waiting_local_directory、dispatched、running。

### 3.2 Squad 容量

`maxParallelDelegations` 解释为 Squad 全局容量。

占用状态：

- queued
- running
- waiting_leader（兼容旧记录）

不占用：

- completed
- failed
- cancelled
- escalated

资格投影和执行 mutation 必须调用同一个 evaluator，不能分别实现容量逻辑。

### 3.3 Runtime 语义

- Runtime 是当前 Host 内的执行配置与门禁 metadata，不是远程 worker。
- `status` 表达 online/offline/unstable。
- 新增 `lifecycle` 表达 active/archived。
- P0 heartbeat/status 仍为显式记录，不宣称真实远程探测。
- P0 capabilities、agentCli 继续是 metadata；当前执行器没有 Task requiredCapabilities 来源，因此不做能力自动路由。
- `workspaceRoot` 继续表示 worktree 输出根目录，不是 Project Resource 源目录的允许范围。
- 默认 Host 是服务端派生投影，不持久化 RuntimeRecord。

### 3.4 Runtime 绑定

- `runtimeId: null` 明确表示恢复本机默认环境。
- 不提供自动 fallback。
- TaskRun 创建时捕获 runtimeId；后续绑定变化不回写历史 TaskRun。
- Agent 存在 queued/waiting_local_directory/dispatched/running TaskRun 时禁止切换 Runtime；deferred 不阻止。
- Agent Runtime 变化影响其承担的已审批 Project Task，因此必须显式确认并使相关 Project 审批失效。
- Project Resource Runtime 变化不进入 plan digest，保持现有审批语义；但 Project active 或存在 active lease 时禁止修改。

### 3.5 Runtime 更新

为避免全局配置被静默改变：

- active Runtime 的名称可在 expectedUpdatedAt/CAS 通过时独立更新，不受绑定或 TaskRun 限制；runtimeNameSnapshot 保持历史展示。
- machineId、capabilities、agentCli、workspaceRoot 属于执行配置。
- 有 Agent/Resource 绑定或 queued/waiting_local_directory/dispatched/running TaskRun 时，执行配置字段不可原地修改；用户应创建新 Runtime，再通过显式绑定流程迁移。
- 这样不需要让一次 Runtime 编辑跨多个 Project 隐式失效审批。

## 4. 数据模型

### 4.1 Squad 持久化模型

P0 不修改 `SquadRecordSchema` 字段集合，继续使用：

- leaderAgentId
- memberAgentIds
- memberRoles
- instructions
- escalationPolicy
- maxParallelDelegations
- status

兼容策略：

- `SquadRecordSchema.memberAgentIds` 保持 `.min(1)`，确保旧单成员记录可读取。
- 新写入使用独立 SquadCreate/Update schema，要求至少两个不同 Agent。
- 旧单成员 Squad 在 availability 中返回 `legacy_member_count`，禁止新分派，但保留历史浏览和复制修复。

新增输入：

```ts
const SquadCreateInputSchema = SquadInputSchema.extend({
  memberAgentIds: z.array(z.string().min(1)).min(2).max(100),
  sourceProjectId: z.string().min(1).optional(),
}).strict()

const SquadUpdateInputSchema = SquadInputSchema.extend({
  memberAgentIds: z.array(z.string().min(1)).min(2).max(100),
  expectedUpdatedAt: z.string().min(1),
}).strict()

const SquadCloneInputSchema = z.object({
  name: z.string().trim().min(1).max(160).optional(),
  sourceProjectId: z.string().min(1).optional(),
  expectedSourceUpdatedAt: z.string().min(1).optional(),
}).strict()

const SquadArchiveInputSchema = z.object({
  expectedUpdatedAt: z.string().min(1),
}).strict()
```

`sourceProjectId` 只用于服务端资格校验和 Activity metadata，不写入 SquadRecord。

### 4.2 Runtime 持久化模型

新增：

```ts
const RuntimeLifecycleSchema = z.enum(['active', 'archived'])

const RuntimeRecordSchema = z.object({
  // existing fields
  lifecycle: RuntimeLifecycleSchema.default('active'),
  archivedAt: z.string().min(1).optional(),
}).strict().superRefine((value, context) => {
  if (value.lifecycle === 'active' && value.archivedAt !== undefined) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['archivedAt'], message: 'Active Runtime cannot have archivedAt.' })
  }
  if (value.lifecycle === 'archived' && value.archivedAt === undefined) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['archivedAt'], message: 'Archived Runtime requires archivedAt.' })
  }
})
```

旧 Runtime 通过 default 读取为 active。

新增输入：

```ts
const RuntimeUpdateInputSchema = z.object({
  name: z.string().trim().min(1).max(160).optional(),
  machineId: z.string().trim().min(1).max(240).optional(),
  capabilities: z.array(z.string().trim().min(1).max(160)).max(100).optional(),
  agentCli: z.string().trim().max(160).nullable().optional(),
  workspaceRoot: z.string().trim().max(4_096).nullable().optional(),
  expectedUpdatedAt: z.string().min(1),
}).strict()

const RuntimeArchiveInputSchema = z.object({
  expectedUpdatedAt: z.string().min(1),
}).strict()
```

`null` 用于清除 agentCli/workspaceRoot；省略表示不修改。

### 4.3 Runtime 绑定输入

```ts
const RuntimeBindingInputSchema = z.object({
  runtimeId: z.string().min(1).nullable(),
  expectedTargetUpdatedAt: z.string().min(1),
  expectedProjectRevisions: z.record(z.string(), z.number().int().positive()).default({}),
  acknowledgeApprovalInvalidation: z.boolean().default(false),
}).strict()
```

- Agent 绑定使用全部字段。
- Resource 绑定必须要求 `expectedTargetUpdatedAt`，忽略/拒绝 Agent 专用的 approval acknowledgment 字段应通过独立 schema 实现。

建议拆为：

```ts
AgentRuntimeBindingInputSchema
ResourceRuntimeBindingInputSchema
```

避免一个 schema 接受无意义字段。

### 4.3.1 TaskRun Runtime 证据

`TaskRunRecordSchema` 新增可选字段：

```ts
runtimeNameSnapshot?: string
```

- 创建显式 Runtime TaskRun 时写入当时的 Runtime 名称。
- 使用默认 Host 时写入“本机默认环境”。
- Runtime 后续改名不改变历史 TaskRun 展示。
- 旧 TaskRun 在迁移时若 runtimeId 仍可解析，则幂等回填当前名称；无法解析时保留 undefined，并由 UI 显示“历史 Runtime 不可解析”。
- P0 不复制 capabilities/agentCli/workspaceRoot，避免把 metadata 误表示为实际执行证明；P1 probe 上线后再定义可验证配置快照。

### 4.4 Squad availability 投影

```ts
type SquadAvailabilityReason =
  | 'legacy_member_count'
  | 'archived'
  | 'agent_inactive'
  | 'member_outside_project'
  | 'capacity_exhausted'

type SquadAvailability = {
  squadId: string
  projectId: string
  eligible: boolean
  reasons: SquadAvailabilityReason[]
  dispatchReady: boolean
  warnings: Array<'leader_runtime_offline' | 'leader_runtime_unstable'>
  missingAgentIds: string[]
  activeDelegations: number
  availableSlots: number
}
```

P0 不加入 capability mismatch reason，因为 capabilities 尚不参与调度。

### 4.5 Runtime Overview 投影

```ts
type RuntimeOverview = {
  defaultHost: {
    id: 'default-host'
    name: '本机默认环境'
    status: 'online' | 'unstable'
    capabilities: string[]
    boundAgentCount: number
  }
  customCount: number
  abnormalCount: number
  archivedCount: number
}
```

派生规则：

- 当前 Web Host 能响应但 Harness Agent API 不可用时为 unstable。
- `boundAgentCount` 是 `runtimeId === undefined` 的 active Agent 数。
- capabilities 只列插件当前能够证明的本机能力，不推断浏览器或外部 CLI。
- 不写入 storage。

API 位置固定为公共 Snapshot 字段：

- `src/types.ts` 与 `src/client-types.ts` 的 Snapshot 增加 `runtimeOverview`。
- `OrchestratorStore.snapshot()` 像现有 inbox/agentWorkloads 一样返回结构兼容的占位投影。
- `OrchestratorService.snapshot()` 使用 Host Context 覆盖 defaultHost 状态和能力，并计算计数。
- 不额外增加 `/runtime-overview`，避免 Client 首屏出现第二次竞态读取。
- `deriveAgentWorkloads()` 对未绑定 Agent 使用 defaultHost.status，不再返回当前的 unknown。

### 4.6 Runtime Detail 投影

窄详情响应：

```ts
type RuntimeDetail = {
  runtime: RuntimeRecord
  agents: AgentRecord[]
  resources: ProjectResource[]
  queuedTaskRuns: TaskRunRecord[]
  activeTaskRuns: TaskRunRecord[]
  affectedProjectIds: string[]
  historyCount: number
}
```

详情不塞入全量 Snapshot，避免随着 TaskRun 历史增长扩大首屏 payload。

### 4.7 Agent Runtime impact 投影

```ts
type AgentRuntimeImpact = {
  agentId: string
  currentRuntimeId?: string
  nextRuntimeId?: string
  nonTerminalTaskRunIds: string[]
  affectedProjects: Array<{
    projectId: string
    revision: number
    status: ProjectRecord['status']
    assignedTaskIds: string[]
    approvalWillInvalidate: boolean
  }>
}
```

UI 必须先读取 impact，再提交绑定；mutation 仍重新计算，不能信预览。

## 5. 服务层设计

### 5.1 统一 Squad evaluator

新增纯读取方法：

```ts
private evaluateSquadAvailability(
  projectId: string,
  squadId: string,
): SquadAvailability
```

检查顺序：

1. Project 存在。
2. Squad 存在。
3. Squad active。
4. 至少两个不同成员且 Leader 在成员中。
5. Leader/成员 Agent active。
6. Leader/成员都是 active 项目成员。
7. 全局活跃 Delegation 数低于上限。
8. 单独计算 Leader 显式 Runtime 是否可立即派发，写入 dispatchReady/warnings，但不改变 eligible。

`assertSquadEligibleForProject()` 改为消费 evaluator，并把第一条 blocking reason 映射为稳定 WorkflowError。Runtime warning 不阻止 assignment；Leader TaskRun 应保持 queued，等待 Runtime online。

调用位置：

- createIssue with Squad assignee
- assign_issue/reassign_issue
- delegate_issue
- eligible-squads GET
- Squad 页面投影

注意：选择列表可显示容量已满，但 `delegate_issue` 才真正消耗 Delegation 容量。给父 Issue 分派 Squad 时只要求 Leader 可执行；如果产品希望容量满时也禁止新父 Issue，则按 PRD固定为禁止并保持一致。

### 5.2 createSquad

处理：

1. 解析 SquadCreateInput。
2. 校验成员唯一、至少两个、Leader 属于成员。
3. 校验 memberRoles key 全部属于成员。
4. 校验 Agent active。
5. 若 sourceProjectId 存在，校验全部成员是 active 项目成员。
6. 写 Squad。
7. 写 `squad.created` Activity，metadata 包含 sourceProjectId。

Squad 与 Activity 写入失败时补偿删除新 Squad。

### 5.3 updateSquad

在 serialized mutation 内：

1. 校验 expectedUpdatedAt。
2. 拒绝 archived Squad。
3. 校验新成员集合。
4. 读取该 Squad 全部 active Delegation。
5. 拒绝移除 active Delegation 的 leaderAgentId/memberAgentId。
6. 拒绝 Leader 替换时仍有 active Delegation。
7. 拒绝 maxParallelDelegations 小于当前全局占用。
8. 写 Squad 与 Activity。
9. Activity 失败时恢复旧 Squad。

### 5.4 cloneSquad

- 校验 source 可读和 expectedSourceUpdatedAt。
- 复制配置，status 固定 active，使用新 ID/时间。
- 若 sourceProjectId 存在，重新验证成员资格。
- 不复制 Issue、Delegation、TaskRun、Artifact、Activity。
- 名称默认 `${source.name} 副本`，仍受 160 字符限制。

### 5.5 archiveSquad

除现有非终态 Squad Issue 外，增加：

- queued/running/waiting_leader Delegation 检查。
- expectedUpdatedAt。
- Activity `squad.archived`。
- Activity 失败时恢复旧 Squad。

physical delete 只允许从未被 Issue 或 Delegation 引用的 Squad；UI 不展示 delete。

### 5.6 Runtime 创建

复用 RuntimeInput，但增加：

- active Runtime machineId 唯一。
- workspaceRoot 若存在，必须是当前用户可写的现有绝对目录；配置时执行 lstat + realpath，拒绝符号链接根和 `/`、`/tmp`、`/private/tmp`、`/Users`、`/home` 等过宽目录。
- 不自动创建 workspaceRoot；只在其下创建按 TaskRun ID 命名的 worktree 子目录。
- 不执行用户提供命令。
- lifecycle 固定 active。
- 写 `runtime.created` Activity。

P0 保持初始 health online，与现有兼容；页面标注为 Host 状态记录，不宣称远程探测。

### 5.7 updateRuntime

在 serialized mutation 内：

1. 校验 expectedUpdatedAt。
2. 拒绝 archived Runtime。
3. machineId 变更后仍需唯一。
4. 名称可以独立修改；历史 TaskRun 使用 runtimeNameSnapshot，不随改名变化。
5. 执行配置字段变化时检查 Agent/Resource bindings 和 queued/waiting_local_directory/dispatched/running TaskRun；任一存在则返回 `runtime-config-in-use`。deferred 只作为历史等待证据，不阻止修改。
6. 校验 workspaceRoot。
7. 写 Runtime 和 Activity；Activity 失败时恢复。

新 TaskRun 创建时必须同时写 runtimeNameSnapshot；归档保证 runtimeId 关系仍可解析。

### 5.8 Agent Runtime impact

新增：

```ts
getAgentRuntimeImpact(agentId, nextRuntimeId): AgentRuntimeImpact
```

- nextRuntimeId 为空表示默认 Host。
- 目标 Runtime 必须 active。
- 收集 Agent 的 queued/waiting_local_directory/dispatched/running Issue TaskRun；deferred 不阻止绑定。
- 收集 draft/awaiting_approval/approved/failed Project 当前 plan 中 Task.agentId 等于 Agent 的项目；completed/cancelled 仅保留历史，不进入失效集合。
- 标明哪些审批会失效。

此方法用于 loopback GET 预览，不做写入。

### 5.9 bindAgentRuntime

在 serialized mutation 内重新计算 impact：

1. 校验 Agent expectedTargetUpdatedAt。
2. 如果 next 与 current 相同，幂等返回且不使审批失效。
3. 目标 Runtime 必须 active。
4. 任一 queued/waiting_local_directory/dispatched/running TaskRun 存在则拒绝。
5. 校验 expectedProjectRevisions 与实时影响集合完全一致。
6. 若有已审批/等待审批 Project，要求 acknowledgeApprovalInvalidation。
7. 对每个受影响 Project 调用新的 `assertProjectRuntimeMutationSafe()`：同时检查持久化 status 不为 decomposing/running、无 active Run/TaskRun，并检查现有 in-memory operation；不能只调用当前仅检查 operation 的 `assertNotActive()`。
8. 对 draft/awaiting_approval/approved/failed Project 重置当前计划 Task evidence；Project revision 只增加一次；状态进入 awaiting_approval；清除 approvedRevision/lastError。completed/cancelled Project 仅作为历史，不失效。
9. 更新 Agent.runtimeId。
10. 写 Activity，列出 oldRuntimeId、newRuntimeId、affectedProjectIds。
11. 任一步失败时按安全写序处理，详见第 6 节。

不得直接调用现有 `updateAgent()`，因为其要求完整 AgentInput，且无法表达 impact preview/CAS。

### 5.10 bindResourceRuntime

在 serialized mutation 内：

1. 校验 Resource expectedTargetUpdatedAt。
2. 目标 Runtime active。
3. 调用 `assertProjectRuntimeMutationSafe()`，同时检查持久化 Project.status、active Run/TaskRun 和 in-memory operation；覆盖 Host 重启后只剩持久化 running 状态的情况。
4. Resource 不存在 preparing/active/releasing WorkspaceLease。
5. 不存在引用该 Resource 的 queued/waiting_local_directory/dispatched/running TaskRun；deferred 历史不阻止绑定。
6. same value 幂等返回。
7. 更新 runtimeId 和 Activity。
8. Activity 失败时恢复。

Resource 的源路径继续由 `assertSafeLocalResource()` 校验。Runtime.workspaceRoot 只用于 worktree 输出，不要求包含 Resource 源路径。

### 5.11 Runtime archive/delete

archive：

- 校验 expectedUpdatedAt。
- 拒绝 Agent/Resource bindings。
- 拒绝 queued/waiting_local_directory/dispatched/running TaskRun；deferred 视为历史证据，不阻止归档。
- lifecycle 设 archived，archivedAt/updatedAt 同步。
- status 保留最后事实，不改写为 offline。
- 写 Activity 并提供补偿。

physical delete：

- 只允许没有任何 Agent/Resource/TaskRun/WorkspaceLease 历史引用。
- 其他情况返回 `runtime-history-requires-archive`。
- UI 只展示 archive。

### 5.11.1 执行 Runtime 解析

新增唯一解析方法：

```ts
private resolveExecutionRuntime(
  agent: AgentRecord,
  resource?: ProjectResource,
): RuntimeRecord | undefined
```

规则：

1. Agent.runtimeId 与 Resource.runtimeId 都存在且不同，返回 `runtime-binding-context-mismatch`，不创建 TaskRun。
2. 两者相同，使用该 Runtime。
3. 只有 Resource.runtimeId，使用 Resource Runtime。
4. 只有 Agent.runtimeId，使用 Agent Runtime。
5. 两者都不存在，返回 undefined，表示本机默认环境。
6. 显式 Runtime 必须存在且 lifecycle active；offline/unstable 可以创建 queued TaskRun，但不能领取。

调用位置：

- Issue assign/reassign 在构造 TaskRun 前先确定 resource，再解析 Runtime。
- Delegation child assignment 复用同一命令路径。
- 旧式 Project Task 当前不选择 ProjectResource，P0 继续只使用 Agent.runtimeId；文档和 UI不得暗示 Resource 绑定会改变该旧执行器。后续统一 dispatcher 时再复用解析方法。
- WorkspaceLease.runtimeId 复制已捕获的 TaskRun.runtimeId。
- TaskRun 同时写 runtimeNameSnapshot。

此规则修复当前 Resource.runtimeId 持久化但不参与 Issue 派发的问题，并避免静默优先级。

### 5.12 Runtime 派发

`claimIssueTaskRun()` 增加 lifecycle：

```ts
if (run.runtimeId !== undefined) {
  const runtime = store.runtimes.get(run.runtimeId)
  if (runtime?.lifecycle !== 'active' || runtime.status !== 'online') return undefined
}
```

P0 不新增 capability gate。

`prepareWorktree()` 在每次使用 workspaceRoot 时重新执行安全检查：

1. 对根目录 lstat，拒绝符号链接和非目录。
2. realpath 后必须与配置时保存的 canonical root 一致。
3. 创建 `${root}/${taskRunId}` 后再次 realpath，确认仍在 canonical root 内。
4. 调用 `git worktree add` 前再检查根和目标 containment。
5. 检查失败返回 `runtime-workspace-root-invalid`，不继续执行。

Node 路径 API 无法提供完整 fd-relative openat 事务，因此仍存在同一用户恶意进程在检查和使用之间替换路径的残余风险；当前本机单用户威胁模型接受该限制，并用 symlink-swap 故障测试覆盖可检测窗口。未来远程/多租户 Runtime 必须使用隔离 worker，而不是复用此路径协议。

heartbeat online：

- archived Runtime 拒绝。
- 写 status/lastHeartbeatAt/updatedAt。
- 调用 requestDispatch。

heartbeat offline/unstable：

- 不取消已经 running 的 TaskRun。
- 新领取被暂缓。
- UI/Inbox 标识当前 active run 仍在进行，避免误解为强制停止。

### 5.13 Runtime Inbox

按 Runtime + Project 去重生成事项，来源包括：

- offline/unstable Runtime 绑定的 Project Resource。
- offline/unstable Runtime 绑定的 Agent，且该 Agent 是 active 项目成员或当前 Task 执行者。
- queued/waiting TaskRun 捕获了非 online Runtime。

InboxItem P0 继续使用 `runtime_offline` kind；summary 区分 offline/unstable。增加可选 `runtimeId` 到 InboxItem schema/client type，避免客户端通过 TaskRun 反查失败。

点击处理：

- model.setView('runtimes')
- set selectedRuntimeId
- 详情高亮 item.taskRunId/resourceId/agentId

## 6. 多表一致性与恢复

### 6.1 一致性承诺

当前 JSON domain 是独立 table put/delete 的集合，没有多表事务；`serializedMutation()` 只是单进程互斥，不能覆盖进程在两次写入之间退出。因此 P0 不宣称数据库级原子性，承诺分为三层：

1. **校验一致性**：所有资格、revision 和引用检查在 serialized mutation 内重新执行。
2. **异常一致性**：同一进程内某个 put/delete 抛错时，按已保存旧值补偿；API 不返回成功。
3. **崩溃安全**：按安全写序保证中间状态不会启动两个有效执行或扩大权限；Host 初始化在 dispatch 前执行确定性修复。

允许的保守中间结果：审批被提前失效、旧执行被停止、Issue 暂时 blocked。禁止的结果：两个 TaskRun 同时被 Issue 视为 active、未审批的新 Runtime 生效、孤儿 TaskRun 被领取、API 报告成功但核心指针未提交。

测试术语必须区分：

- fault injection 验证异常补偿。
- kill-point/restart 验证崩溃恢复。
- 不再使用“补偿保证无可观察部分写”这一不可实现表述。

### 6.2 Agent Runtime 绑定写序

Agent Runtime 绑定采用安全的 forward order：

1. 重新验证 impact 和 expected revisions。
2. 先逐个失效受影响 Project 审批并重置 Task evidence。
3. 最后更新 Agent.runtimeId。
4. 最后写 Activity。

如果进程在第 2 步中退出，Agent 仍使用旧 Runtime，只有部分 Project 被保守地要求重新审批，不会出现未审批的新执行环境。如果 Agent 更新已完成，则全部受影响 Project 必须已经失效。重试根据当前 revision 重新生成 impact。

同进程异常尽力恢复尚未提交的 Project/Task；已成功失效的审批可以保持失效，错误响应和 Activity 说明需要重新确认，不能伪造恢复旧执行事实。

### 6.3 assign/reassign Issue 安全写序

重分派无法恢复已被停止的 Agent 进程，因此不能把旧 TaskRun record 简单改回 running。采用 safety-first 协议：

1. 验证 Issue、资格、Runtime、Resource 和 assignment revision。
2. 预生成 newTaskRunId、Activity ID，并把 Command.status 写为 running、Command.result.recoveryPlan 写入这些确定性 ID 和 expected assignmentRevision。
3. 构造全部 next records；若旧 TaskRun 为 dispatched/running，先将其持久化为 cancelled/reassigned，再停止内存 operation。
4. 写新 TaskRun；此时 Issue 尚未指向它，claim 必须拒绝领取。
5. 写 Issue.activeTaskRunId、assignee 和新 assignmentRevision。
6. 写 Activity。
7. Command.status 写 completed，result 写最终 TaskRun/Issue revision，completedAt 赋值。

同进程失败：

- 删除或取消尚未成为 active 指针的新 TaskRun。
- 若旧执行已停止，不伪造恢复 running；Issue 进入 blocked，并产生可重试 Inbox。
- 若旧执行尚未停止，可恢复旧记录和 Issue。

崩溃安全：

- 新 TaskRun 在 Issue 指针提交前属于 orphan，claimIssueTaskRun 的现有 activeTaskRunId/revision 门禁保证它不能运行。
- 启动恢复将 orphan queued TaskRun 标记 cancelled/failed，并记录 finishedReason。
- Issue 指向缺失/无效 TaskRun 时进入 blocked 和 Inbox，不自动猜测执行结果。

### 6.4 delegate Issue 安全写序

`DelegationRecordSchema` 增加可选 `commandId`，用于崩溃诊断和幂等恢复。delegate command 预生成 childIssueId、delegationId、childTaskRunId、Activity ID，先把 Command.status 写为 running，并把这些 ID 和 expected Parent revision 写入 Command.result.recoveryPlan。

写序：

1. 构造全部 next records，不写入。
2. 写 Child Issue。
3. 写 Project.issueIds。
4. 写 Delegation queued，记录 commandId。
5. 写 Child TaskRun；本流程在第 12 步前不得调用 requestDispatch，Host 重启时也必须先完成 recoverCommandConsistency 再恢复队列。
6. 写 Child Issue assigned/in_progress。
7. 写 Parent Issue blocked。
8. 写 Leader TaskRun deferred/completedAt。
9. 写 Delegation running。
10. 写 Activity。
11. Command.status 写 completed，result 写最终 Child/Delegation/TaskRun ID，completedAt 赋值。
12. 所有持久化完成后再停止 Leader in-memory operation 并 requestDispatch。

同进程异常按逆序补偿。若 Leader operation 已停止，则 Parent 保持 blocked 并进入恢复流程，不把旧 run 改回 running。

崩溃恢复优先 forward-reconcile 已存在的 Delegation：

- Child、Delegation、Parent 三者引用完整时，补齐可确定的状态并继续 child queue。
- 缺失上下文或 revision 冲突时，把 Delegation 标记 escalated、Parent/Child 标记 blocked，并创建 Inbox，不删除证据。

### 6.5 启动恢复

`initialize()` 顺序调整为：

1. seed/migrate。
2. `recoverCommandConsistency()`。
3. 现有 `recoverInterruptedWork()`。
4. 现有 `recoverTaskRunDispatch()`。
5. requestDispatch/resume approved projects。

`recoverCommandConsistency()` 先处理所有 pending/running Command，不能保留会被幂等查询永久命中的中间状态：

1. 根据 Command.type、payload、result.recoveryPlan 和确定性 ID 检查目标状态。
2. 核心 Issue/TaskRun/Delegation 指针全部提交且 revision 一致时，补写可缺省 Activity 后把 Command 标记 completed。
3. Leader continuation 等可安全 forward-replay 的内部命令，绕过公开 idempotency lookup、使用原 recoveryPlan 恢复一次，再标记 completed。
4. 无法证明完成或安全 forward-replay 时，执行保守修复，把 Command 标记 failed，error=`host-restarted-during-command`，设置 completedAt，并创建 Inbox。
5. failed/cancelled/completed 是终态；同一 idempotencyKey 返回该终态记录。用户显式重试使用新 key。

`executeCommand()` 同步收紧：若运行期发现已有 pending/running record，不再像当前实现一样直接当结果返回，而是返回 409 `command-recovery-required` 并触发一致性恢复。initialize 完成后正常情况下不存在此状态。

随后幂等扫描业务不变量：

- commandId 对应 failed/cancelled 且未被 Issue.activeTaskRunId 引用的 queued TaskRun：取消为 orphan。
- Issue.activeTaskRunId 指向缺失记录、不同 issueId 或不同 assignmentRevision：Issue blocked + Inbox。
- active Delegation 缺 Parent/Child/Leader/Member：Delegation escalated + Inbox。
- Parent blocked、Child review approved、Delegation completed，但缺 Leader continuation：从原 Command recoveryPlan forward-replay；不能通过公开接口复用被 pending/failed key 抑制的调用。
- archived/offline/unstable Runtime 的 queued TaskRun：保留 queued，生成 Runtime Inbox，不派发。
- 旧单成员 Squad：禁止新 assign/delegate，但历史记录继续展示。

完成定义只要求 Host 对外提供工作台和触发 dispatch 前恢复到上述安全不变量，并确保 Command 不再处于 pending/running；不要求删除所有异常证据。

## 7. HTTP 设计

### 7.1 读取路由

```text
GET /projects/:projectId/eligible-squads
GET /squads/:id
GET /runtimes/:id
GET /agents/:id/runtime-impact?runtimeId=<id|default>
```

- 全部调用 `assertLoopbackRead()`。
- `eligible-squads` 返回 active/archived 全部投影及 reasons，客户端自行分组。
- Runtime detail 使用窄响应，不扩大 Snapshot。
- runtime-impact 的 `default` 映射为 undefined，不接受空字符串。

### 7.2 Squad mutation

```text
POST /squads
PUT  /squads/:id
POST /squads/:id/clone
POST /squads/:id/archive
```

现有 DELETE 保留兼容，但 Web 不使用。

### 7.3 Runtime mutation

```text
POST /runtimes
PUT  /runtimes/:id
POST /runtimes/:id/heartbeat
POST /runtimes/:id/archive
PUT  /agents/:id/runtime
PUT  /resources/:id/runtime
```

现有 DELETE 保留为“从未使用记录的物理删除”。

### 7.4 Issue assignment

继续：

```text
POST /commands
```

Squad 请求示例：

```json
{
  "type": "assign_issue",
  "projectId": "project-id",
  "issueId": "issue-id",
  "actorType": "human",
  "actorId": "operator",
  "payload": {
    "assigneeType": "squad",
    "assigneeId": "squad-id"
  }
}
```

不新增 `PUT /issues/:id/assignee`。

### 7.5 安全边界

所有新 mutation：

- `assertSameOrigin(req)`。
- 通过共享 `readMutationJson(req)` 先调用 `assertJsonRequest()`，缺失或非 `application/json` 返回 415，再执行有界 `readJson()`。
- 2 MiB body 上限。
- 进入 `serializedMutation()`。
- 返回稳定 `{ error: { code, message } }`。

当前普通 mutation 直接 `readJson()`、没有统一 Content-Type 门禁。1.5 同步把所有 JSON mutation 迁移到 `readMutationJson()`，避免同一 API 前缀出现不同安全语义；Web mutate/CLI 补齐 header，HTTP 回归覆盖缺失与错误 media type。

P1 probe：

- 不接受 command/script/args/env。
- 文件系统与固定能力检查在 mutation 锁外执行。
- 结果在短锁内用 expectedUpdatedAt/CAS 写入。
- 返回有界、脱敏的结构化检查，不返回环境变量和完整命令输出。

## 8. 稳定错误码

### 8.1 Squad

| code | HTTP | 含义 |
|---|---:|---|
| squad-min-members | 400 | 新 Squad 少于两个不同 Agent |
| squad-leader-not-member | 400 | Leader 不在成员中 |
| duplicate-squad-member | 400 | 成员重复 |
| squad-role-member-mismatch | 400 | role key 指向非成员 |
| squad-stale | 409 | expectedUpdatedAt 冲突 |
| squad-unavailable | 409 | Squad 不存在或非 active |
| squad-member-outside-project | 409 | 项目成员资格不完整 |
| squad-agent-inactive | 409 | Leader/成员已归档 |
| squad-delegation-capacity | 409 | 全局委派容量已满；保留现有稳定错误码 |
| squad-active-member-work | 409 | 编辑移除活跃成员 |
| squad-capacity-below-occupancy | 409 | 上限低于当前占用 |
| squad-active-delegations | 409 | 存在活跃委派，不能归档 |
| squad-in-use | 409 | 存在非终态 Issue 或历史删除保护 |

### 8.2 Runtime

| code | HTTP | 含义 |
|---|---:|---|
| runtime-not-found | 404 | Runtime 不存在 |
| runtime-stale | 409 | expectedUpdatedAt 冲突 |
| runtime-archived | 409 | 归档 Runtime 不可变更或绑定 |
| runtime-machine-id-conflict | 409 | active Runtime Machine ID 重复 |
| runtime-binding-context-mismatch | 409 | Agent 与 Resource 显式绑定不同 Runtime |
| runtime-config-in-use | 409 | 执行配置有绑定/活跃引用，不能原地修改 |
| runtime-nonterminal-task-runs | 409 | 绑定目标存在 queued/waiting_local_directory/dispatched/running TaskRun |
| runtime-binding-impact-stale | 409 | 影响项目集合或 revision 已变化 |
| runtime-binding-approval-required | 409 | 未确认审批失效影响 |
| runtime-active-bindings | 409 | 归档前仍有 Agent/Resource 绑定 |
| runtime-active-task-runs | 409 | 归档前仍有 queued/waiting_local_directory/dispatched/running TaskRun |
| runtime-history-requires-archive | 409 | 有历史引用，禁止物理删除 |
| runtime-workspace-root-invalid | 400 | worktree 输出根目录不安全 |
| runtime-resource-active-lease | 409 | Resource 有活跃 lease |

### 8.3 Command

| code | HTTP | 含义 |
|---|---:|---|
| command-recovery-required | 409 | 幂等键对应 pending/running Command，需先完成一致性恢复 |
| host-restarted-during-command | 409 | 上次变更在 Host 重启时被保守终止；用户确认状态后用新 key 重试 |

客户端只根据 code 映射中文修复动作，不解析 message。

## 9. 前端设计映射

### 9.1 状态模型

WorkbenchState 增加：

```ts
type AdvancedPanel =
  | { kind: 'squad-create'; sourceProjectId?: string }
  | { kind: 'squad-edit'; squadId: string }
  | { kind: 'squad-detail'; squadId: string }
  | { kind: 'runtime-create' }
  | { kind: 'runtime-edit'; runtimeId: string }
  | { kind: 'runtime-detail'; runtimeId: string; focusId?: string }
  | { kind: 'local-data' }
```

不要把不同抽屉拆成全局布尔值，避免冲突状态。

### 9.2 SquadsPage

替换当前只读 `po-entity-panel`：

- PageHeader + 新建命令。
- 搜索、状态、项目可用性 toolbar。
- 全宽稳定列列表。
- 行点击打开详情；三点菜单编辑/复制/归档。
- 空态直接新建或前往 Agent。

SquadFormDrawer：

- 三步本地 draft。
- 成员选择复用项目成员/Agent 数据。
- 从项目上下文进入时先请求 eligible context 或使用 active memberships。
- 409 保留 draft。
- 成功后刷新并打开详情。
- 关闭后焦点返回触发按钮。

### 9.3 IssueDialog

Owner commands：

- 使用 segmented control 切换 agent/squad。
- Agent 列表继续只显示 active 项目成员。
- Squad 列表请求 `/projects/:id/eligible-squads`。
- eligible 为主选项；不可用项单独展示原因和修复入口。
- 提交仍调用 `/commands`。
- assign/reassign 成功后刷新 Issue/TaskRun。

### 9.4 RuntimesPage

页面顺序：

1. 本机默认环境基线。
2. 自定义 Runtime toolbar/list。
3. Runtime 详情抽屉。

基线数据来自 `snapshot.runtimeOverview.defaultHost`。

RuntimeFormDrawer：

- create/update 共用字段组件。
- 名称字段始终可编辑；machineId、capabilities、agentCli、workspaceRoot 有绑定或可执行 TaskRun 时禁用，并提示“创建新配置并迁移绑定”。
- P0 不显示“检测成功”等未经 probe 支持的文案。

RuntimeDetail：

- 概览
- 绑定关系
- 排队工作
- 历史统计

AgentRuntimeBindingDialog：

1. 选择目标 Runtime/default。
2. 请求 impact。
3. 显示 queued/waiting_local_directory/dispatched/running TaskRun 阻塞或受影响 Project；deferred 不阻塞。
4. 用户确认审批失效。
5. 提交 expected timestamps/revisions。

### 9.5 本地数据

新增 `view: 'local-data'`：

- 使用现有 `featureUsageDaily`。
- 使用现有 DELETE `/usage`。
- 从 RuntimesPage 删除 clearUsage。
- FeatureUsageFeatureSchema 增加 `local_data` 前需要决定是否记录该页；建议不记录，避免读取统计改变统计本身。

### 9.6 导航计数

- SideNavButton 支持 `count?: number`，undefined 不渲染占位数字。
- Squad 无活跃委派时不显示 0。
- Runtime 无异常时不显示 0。
- More 状态点同时提供可读 aria-label。

## 10. 迁移与兼容

### 10.1 存储迁移

不新增表，不提升 domain version。

`initialize()` 幂等处理：

- 旧 Runtime 读取时 lifecycle default active。
- 可选择将 lifecycle 显式 put 回存储，便于后续诊断；重复启动结果一致。
- 旧单成员 Squad 不修改、不删除。
- availability 标记 `legacy_member_count`。
- 旧 TaskRun 若 runtimeId 仍可解析且 runtimeNameSnapshot 缺失，回填当前 Runtime 名称；默认 Host 历史可按无 runtimeId 展示，不强制回写。
- 旧 Delegation 的 commandId 保持 undefined，不伪造来源 Command。
- 默认 Host 永不写入 runtimes 表。

### 10.2 API 兼容

- 现有 GET/POST/PUT/DELETE 路由继续保留。
- `PUT /squads/:id` 从 1.5 起强制 expectedUpdatedAt；旧客户端若存在会收到 400。当前 Web 没有该 UI，API/CLI 用户需按迁移文档更新。
- 所有 JSON mutation 从 1.5 起强制 `Content-Type: application/json`；记录到 changelog 和 API 文档。
- RuntimeRecord/TaskRun/Delegation 新字段会使旧 1.4 strict schema 无法安全读取升级后存储；回滚必须恢复升级前备份。

### 10.3 降级

- 暂停 Project/Issue 队列。
- 停止 Host。
- 恢复 1.5 升级前存储备份。
- 安装旧 plugin。
- 重启同一 Host。
- 验证 health/snapshot/queued runs。

不得只降级代码而保留含 lifecycle 的新 Runtime 记录。

## 11. 测试方案

### 11.1 Schema 与 storage

- 旧 Runtime 无 lifecycle 可解析为 active。
- archived Runtime 必须有 archivedAt。
- 旧单成员 Squad 可加载但新创建拒绝。
- 默认 Host 不持久化。
- RuntimeOverview 和 SquadAvailability 投影排序稳定。
- 项目删除继续过滤相关 Issue/Delegation/TaskRun，不删除全局 Squad/Runtime。

### 11.2 Service

Squad：

- create sourceProjectId 资格。
- memberRoles key mismatch。
- update expectedUpdatedAt。
- active member/Leader removal。
- 全局容量计数跨多个 parent Issue。
- 降低容量拒绝。
- archive 同时检查 Issue 和 Delegation。
- clone 不复制工作。
- evaluator reason 矩阵。
- 每个写入点故障注入和补偿。

Runtime：

- machineId 唯一。
- workspaceRoot 绝对路径、过宽路径、symlink 和不存在父目录。
- execution config in-use 拒绝。
- Agent impact 确定性。
- bind same runtime 幂等。
- queued/waiting_local_directory/dispatched/running TaskRun 阻止绑定，deferred 不阻止。
- 受影响 revision stale。
- 多 Project approval 一次失效。
- Resource active lease 阻止绑定。
- Agent/Resource Runtime 相同、单方显式、双方冲突和双方默认的解析矩阵。
- persisted Project.status=running/decomposing 即使 Host 重启后无 operation 也阻止绑定。
- deferred Leader TaskRun 不计排队、不阻止绑定/归档，也永不重新派发。
- archive/delete 历史保护和 runtimeNameSnapshot 改名稳定性。
- archived/offline/unstable 不领取队列。
- online heartbeat 恢复派发。
- workspaceRoot 配置校验、使用前复查和 symlink-swap 可检测窗口。
- Agent/Resource/TaskRun Runtime Inbox 去重。

Command 与恢复：

- assign/reassign 每个写入点的异常补偿。
- delegate 每个写入点的异常补偿。
- assignment/delegation 每个 kill point 重启后的安全不变量和 Inbox 修复。
- orphan TaskRun、断裂 Issue 指针和断裂 Delegation 的幂等恢复。
- 重启后 pending/running Command 必须变为 completed 或 failed；同一 idempotencyKey 返回确定终态，显式重试使用新 key。
- 运行期遇到 pending/running key 返回 command-recovery-required，不静默返回中间记录。
- Leader operation 只在持久化提交后 cancel。
- child review 幂等唤醒一次。

### 11.3 HTTP 与安全

每条新路由覆盖：

- loopback GET。
- same-origin mutation。
- Origin/Host/sec-fetch-site 拒绝。
- 缺失/错误 Content-Type 返回 `unsupported-media-type` 415。
- JSON body 2 MiB 限制。
- URL 编码 ID。
- 200/201/400/404/409。
- mutation 进入 serialized boundary。

### 11.4 Client 与浏览器

必须新增渲染级测试，不能只依赖 source/bundle 字符串：

- Squad 三步创建、编辑、复制和归档。
- 项目上下文成员限制。
- Issue Agent/Squad 切换和不可用原因。
- 默认 Host baseline。
- Runtime create/edit/archive。
- Agent impact/绑定确认。
- Resource binding。
- Inbox 深链接。
- local-data 清除。
- 409 后保留输入。
- 抽屉焦点进入和返回。
- 桌面、390px、200% zoom、dark、reduced motion。
- console error、页面横向溢出和内容重叠。

## 12. 实施顺序

### Phase 0：契约与安全修复

1. Squad 新写入 min2、expectedUpdatedAt。
2. Squad unified evaluator 和全局容量。
3. assign/delegate 安全写序、异常补偿和启动一致性恢复。
4. Runtime lifecycle、runtimeNameSnapshot 和 archive/delete 保护。
5. Agent/Resource 执行 Runtime 解析矩阵。
6. RuntimeOverview、SquadAvailability、Inbox runtimeId。
7. JSON mutation Content-Type 统一门禁。
8. migration/compat/kill-point tests。

### Phase 1：管理 UI 闭环

1. Squad 列表、详情和表单。
2. 项目“组建团队”。
3. Issue Agent/Squad 分段指派。
4. Runtime baseline、列表、详情和表单。
5. local-data View 和导航计数优化。

### Phase 2：绑定与异常闭环

1. Agent impact + bind。
2. Resource bind。
3. Inbox/Project/Agent/TaskRun 深链接。
4. 绑定审批失效和恢复验证。

### Phase 3：P1 probe 与能力门禁

1. capability registry。
2. Issue/Task requiredCapabilities 来源事实。
3. 固定、受限、脱敏 probe。
4. waitReason/missingCapabilities。
5. 观察模式上线，再开启阻断。

## 13. 发布与回滚

上线前：

- 完整测试通过。
- package smoke 和 docs smoke 通过。
- 停止活跃 Project/TaskRun。
- 备份 `~/.dsh/storages/project_orchestrator.json` 并校验哈希。
- 记录 plugin/Harness 版本。

上线：

- 使用官方 profile plugin manager 安装。
- 重启现有 Host，不启动第二个 Web server。
- 验证 `/health`、Snapshot、旧 Squad/Runtime 兼容。
- 验证 queued TaskRun 和默认 Host。
- Chrome 验证桌面/移动核心流程。

回滚：

- 暂停队列并停止 Host。
- 同时恢复旧 plugin 和升级前存储备份。
- 验证 health、snapshot 和执行队列。

## 14. 主要风险与控制

| 风险 | 控制 |
|---|---|
| 旧单成员 Squad 阻止 Host 启动 | Record schema 保持 min1，新写入 schema min2 |
| UI 与执行资格漂移 | 唯一 evaluator，UI 消费 reason projection |
| 容量按 parent 计算导致超卖 | 改为 Squad 全局占用并在锁内复查 |
| JSON 表无多表事务 | 异常补偿、崩溃安全写序、dispatch 前启动修复；不宣称数据库级原子性 |
| Runtime 被误解为远程 worker | UI 和文档明确本机 Host 内执行配置 |
| 默认 Host 被错误持久化 | 只读投影，不建 RuntimeRecord |
| 绑定变化绕过审批 | impact preview + expected revisions + 显式审批失效 |
| 可执行 run 使用旧 Runtime 造成误解 | queued/waiting_local_directory/dispatched/running TaskRun 阻止 Agent 重绑定；deferred 保持历史 |
| Runtime 配置全局影响项目 | in-use 时禁止执行字段原地修改，创建新配置迁移 |
| Runtime 历史引用丢失 | lifecycle archive，physical delete 仅限从未使用记录 |
| capabilities 被误当作强门禁 | P0 仅展示，P1 建 requiredCapabilities 后再启用 |
| Probe 扩大攻击面 | P1 固定检查、无用户命令、锁外执行、脱敏有界结果 |
| strict schema 导致代码降级失败 | 回滚必须恢复升级前备份 |

## 15. 完成定义

技术交付完成必须满足：

- PRD P0 AC 全部通过。
- Squad/Runtime 可在 Web 完成日常闭环，不再出现 API 创建文案。
- 默认 Host、Squad availability 和 Runtime detail 投影有单一服务端定义。
- assign/reassign/delegate 的 fault injection 失败不返回成功；kill-point 重启后在 dispatch 前恢复安全不变量，孤儿证据可诊断。
- Agent Runtime 绑定不能绕过可执行 TaskRun 和 Project 审批。
- Agent/Resource Runtime 冲突失败关闭，Issue TaskRun 捕获统一解析结果。
- 历史 Issue、Delegation、TaskRun、Artifact、Runtime/Squad 引用及 Runtime 名称快照可解析。
- 所有新 mutation 满足 same-origin、JSON Content-Type 和 serialized boundary。
- Typecheck、build、完整测试、docs smoke、package smoke 通过。
- 现有 Harness Web 的桌面、移动、键盘、深色和无溢出验证通过。
