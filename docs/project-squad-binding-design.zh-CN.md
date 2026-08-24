# 项目绑定团队编排设计方案

## 1. 背景

当前 Project 与 Squad 没有持久化关系。系统仅在 Squad 全部成员已经是 active 项目成员时，实时推断该 Squad 是否可用。这要求用户先逐个维护项目成员，无法表达默认团队、同步状态、成员来源和安全解绑，也让“项目使用哪个团队编排”缺少明确事实。

本方案引入一等的 Project-Squad 绑定。绑定负责建立和维护团队成员参与项目的资格；Task 继续绑定具体 Agent，保留执行责任、审批摘要和 TaskRun 证据的确定性。

## 2. 目标

- 一个 Project 可以显式绑定多个 active Squad。
- 一个 Project 最多有一个默认 Squad。
- 绑定时原子补齐 Squad Leader 和成员的 active 项目成员资格。
- 记录项目成员的手动来源和 Squad 来源，支持共享成员与安全解绑。
- Squad 配置变化后显示需要同步，并允许用户显式同步。
- Issue 只能分派给已绑定且当前 eligible 的 Squad。
- 解绑只移除对应 Squad 来源，不破坏手动来源、其他 Squad 来源或历史证据。
- 所有绑定、同步、默认切换和解绑写入 Activity。

## 3. 非目标

- 绑定 Squad 不自动批准或启动 Project。
- 绑定 Squad 不把 Task 的责任主体改成 Squad。
- Squad 成员变化不自动重分配已审批 Task。
- 本版本不实现基于历史成功率、成本或负载的智能调度。
- 本版本不增加多人 RBAC，继续使用本机 Harness 的 same-origin mutation 边界。

## 4. 产品语义

### 4.1 绑定与执行责任

Project-Squad 绑定表示该团队获准参与项目，并由系统维护其成员资格。Task 仍必须分配给具体 active 项目 Agent。Issue 可以分派给已绑定 Squad，由 Leader 按现有 Delegation 协议委派。

### 4.2 多团队与默认团队

一个项目可绑定多个 Squad。首个绑定默认成为项目默认 Squad；后续绑定可以显式设为默认。设置新默认时，服务端在同一串行 mutation 中清除旧默认，保证最多一个默认绑定。

默认 Squad 用于界面推荐和后续编排入口，不代表自动批准、自动派发或自动执行。项目成员列表直接标识默认 Squad Leader；该身份来自绑定事实，不要求用户再次选择。Project `leadAgentId` 表示独立的项目负责人职责，绑定不会静默修改它，也不会因此增加 Project revision 或使审批失效。

### 4.3 成员来源

`ProjectAgentMembership` 继续作为执行资格投影。新增成员来源记录：

- `manual`：用户直接加入项目，或升级前已存在的 active 项目成员。
- `squad`：由某个 Project-Squad 绑定补齐。
- `retained_reference`：解绑或同步时，Agent 仍被 Task、Issue、Delegation 或 TaskRun 引用，需要保留项目资格。

一个 Agent 可以同时拥有多个来源。移除一个来源不会影响其他来源。只有全部来源失效且没有项目引用时，成员投影才可软移除。

### 4.4 同步

绑定记录保存最后同步的 `Squad.updatedAt`。两者不一致时状态为“需要同步”。

同步规则：

- 新成员：新增 Squad 来源并补齐项目成员。
- 仍在 Squad 的成员：刷新 Squad 来源职责；不覆盖用户手动维护的项目职责。
- 已移出 Squad 的成员：移除该 Squad 来源。
- 没有其他来源且没有引用的成员：软移出项目。
- 没有其他来源但仍有引用的成员：转为 `retained_reference`，项目成员继续 active。
- archived Agent 或 archived Squad：绑定状态变为 `needs_review`，禁止新的 Squad Issue 分派。

### 4.5 安全解绑

以下情况拒绝解绑：

- 该项目中仍有该 Squad 的 queued、running 或 waiting_leader Delegation。
- 该项目中仍有分派给该 Squad 的非终态 Issue。
- 解绑默认 Squad 且还有其他绑定，但请求未指定新的默认 Squad。
- 乐观并发版本不匹配。

解绑成功后：

- 绑定记录软删除，保留审计历史。
- 移除该绑定产生的 Squad 成员来源。
- 保留手动来源、其他 Squad 来源和历史证据。
- 被 Task、Issue、Delegation 或 TaskRun 引用的 Agent 转为保留来源。
- 无其他来源且无引用的 Agent 才软移出项目。

## 5. 数据模型

### 5.1 ProjectSquadBindingRecord

```ts
{
  id: `${projectId}:${squadId}`
  projectId: string
  squadId: string
  status: 'active' | 'needs_review' | 'removed'
  isDefault: boolean
  syncedSquadUpdatedAt: string
  boundBy: string
  boundAt: string
  updatedAt: string
  removedAt?: string
}
```

### 5.2 ProjectAgentMembershipSourceRecord

```ts
{
  id: string
  projectId: string
  agentId: string
  sourceType: 'manual' | 'squad' | 'retained_reference'
  sourceId: string
  projectRole: string
  autoAssignable: boolean
  status: 'active' | 'removed'
  createdAt: string
  updatedAt: string
  removedAt?: string
}
```

`manual` 来源的 `sourceId` 固定为 `manual`；`squad` 来源使用 Squad ID；保留来源使用引用摘要标识。

## 6. API

```text
GET    /projects/:projectId/squad-bindings
POST   /projects/:projectId/squad-bindings
POST   /projects/:projectId/squad-bindings/:squadId/sync
PUT    /projects/:projectId/squad-bindings/:squadId/default
DELETE /projects/:projectId/squad-bindings/:squadId
```

绑定请求：

```ts
{
  squadId: string
  isDefault?: boolean
  syncRoles?: boolean
  boundBy?: string
  expectedProjectRevision?: number
  expectedSquadUpdatedAt?: string
}
```

同步、设置默认和解绑均携带 `expectedBindingUpdatedAt`。解绑默认团队时，如仍有其他 active 绑定，还需提供 `replacementDefaultSquadId`。

所有 mutation 均位于现有 `serializedMutation` 边界。绑定与同步写入绑定、成员来源和成员投影时执行补偿式回滚。

## 7. 界面

Project 的“智能体”页分为两个连续区域：

1. `团队编排`：展示已绑定 Squad、Leader、成员数、默认标记、可派发容量和同步状态。
2. `项目成员`：展示最终 active Agent、项目职责、工具权限、任务数量及来源。

主要操作：

- `绑定 Squad`
- `同步成员`
- `设为默认`
- `解除绑定`
- `查看 Squad`

绑定使用现有管理抽屉：单选 active Squad，展示 Leader、成员、可执行/只读构成、将新增的项目成员和 Runtime/容量提示。解绑使用全局确认框，准确说明会移除多少来源、保留多少成员，以及是否需要替代默认团队。

Project 概览只展示绑定摘要和异常入口，不承载写操作。

## 8. 兼容与迁移

- 不根据现有成员集合自动创建绑定，避免猜测用户意图。
- 首次维护来源时，为升级前已有的 active 项目成员幂等补建 `manual` 来源。
- 旧版本没有新表时读取为空；新版本首次写入时创建记录。
- 原 `/eligible-squads` 投影继续保留，用于绑定前影响展示和后端安全校验。
- 未绑定的 Squad 即使成员碰巧齐全，也不能接收新的项目 Issue。

## 9. 测试

服务层覆盖：

- 首次绑定自动补齐成员和来源。
- 重复绑定、成员上限、inactive Agent、stale Project/Squad 拒绝。
- 首个默认、默认唯一性和替代默认。
- 同步幂等、新增成员、移除成员、共享来源与引用保留。
- active Issue/Delegation 解绑保护。
- 项目删除级联绑定与来源。
- 绑定后 eligible，解绑后不可用于新的项目 Issue。

HTTP 覆盖路由解码、状态码、same-origin 和串行 mutation。客户端覆盖绑定区、状态、操作入口、来源标签和响应式样式契约。

## 10. 验收标准

- 用户无需逐个添加 Agent 即可在项目内绑定 Squad。
- 绑定后 Squad 全员成为 active 项目成员。
- 项目明确显示绑定关系、默认团队、同步状态和成员来源。
- 只有已绑定且 eligible 的 Squad 能接收项目 Issue。
- Task 始终由具体 Agent 负责。
- 多 Squad 共享 Agent 时，解绑一个 Squad 不误删成员。
- 活跃 Issue 或 Delegation 下不能危险解绑。
- 所有操作可审计，历史 TaskRun、Issue 和 Delegation 可继续解析。
- 桌面和移动端均可完成绑定、同步、设置默认和解绑。
