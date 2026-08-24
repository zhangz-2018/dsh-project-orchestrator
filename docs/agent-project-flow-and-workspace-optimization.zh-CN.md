# 智能体接入项目流程与工作区导航优化方案

> 状态：已由 `dsh-project-orchestrator@1.4.0` 实现并在本机 Harness Web 验收
> 日期：2026-08-21
> 范围：产品设计、信息架构、交互、数据模型、API、迁移、埋点与验收
> 本文同时保留方案决策与最终实施验收记录。

## 1. 结论

可以把用户创建的智能体加入项目流程，而且现有系统已经具备任务级指派的基础能力。当前真正缺少的是一个显式、可审计的“项目智能体成员池”。

建议建立三层关系：

1. **全局智能体**：在工作区中创建和维护，可被多个项目复用。
2. **项目智能体成员**：项目明确选择哪些智能体可以参与，并定义项目内职责、是否可被 AI 自动匹配、是否为负责人。
3. **任务执行者**：每个任务最终绑定一个项目成员；该绑定继续进入计划哈希和人工审批。

同时调整工作区导航：

- 保留 `Inbox`、`项目`、`交付看板`、`Issues`、`智能体` 等高频工作入口。
- 将当前为空且偏高级配置的 `Squads`、`Runtimes` 收入“更多”。
- 在智能体、项目、Inbox 等相关上下文中提供直达入口，不让用户为了处理 Runtime 或 Squad 问题主动寻找全局页面。
- 先增加本地、隐私友好的使用度量，再决定是否继续降级 `Skills` 等入口。

## 2. 现状证据

### 2.1 当前真实数据

2026-08-21 从本机 `/project-orchestrator/api/snapshot` 读取到：

| 功能 | 数量 |
|---|---:|
| Inbox | 19 |
| Issues | 48 |
| 项目 | 5 |
| 智能体 | 7 |
| Squads | 0 |
| Runtimes | 0 |
| Skills | 58 |
| 自动交付任务 | 26 |

智能体实际使用情况：

| 类型 | 智能体数 | 已进入项目 | 已分配任务 |
|---|---:|---:|---:|
| 用户创建的智能体 | 5 | 0 | 0 |
| 内置 Software Engineer | 1 | 3 个项目 | 12 |
| 内置 Test Engineer | 1 | 3 个项目 | 14 |

这说明问题不是“系统完全不支持指派”，而是自建智能体与项目流程之间缺少可发现、可管理的连接。

### 2.2 已有能力

- `Task.agentId` 已支持任务级智能体指派。
- 新建和编辑任务时已经可以选择智能体。
- `planDigest` 已包含 `Task.agentId`，更换任务执行者会使旧审批失效。
- AI 拆解会根据 `suggestedAgentRole` 和智能体全局 `role` 做字符串匹配。
- Agent 已有状态、Skills、工具权限、Runtime、并发上限等属性。
- Inbox 已能呈现 Runtime 离线、权限拒绝、重试失败和审批过期等事项。
- 工作台通过 `sidebar.footer.action` 和 `shell.overlay` 插入 Harness Web，不替换 Harness 主侧栏。

### 2.3 执行来源事实

项目编排不能只把 Agent ID 挂在 Project 上，现有三类记录的职责必须继续分离：

| 记录 | 来源事实 |
|---|---|
| Task | 已批准计划、依赖、任务执行者和测试门禁 |
| Issue | 长期工作项状态、指派 revision、Review 与协作上下文 |
| TaskRun | 单次执行尝试、Runtime、Session、工作区和证据 |

`Project.leadAgentId` 只表示项目协调负责人，不能替代 `Task.agentId` 或 `Issue.assigneeId`。自动交付 Task 应继续关联对应的 Issue 与 TaskRun，让项目页可以从计划追到协作状态和执行证据。

### 2.4 核心缺口

- 项目没有成员池，只有未实际使用的单一 `leadAgentId`。
- AI 拆解在全部 active 智能体中匹配，不理解项目边界。
- 未指派任务执行时会从全部 active 智能体中隐式选择，实际执行者未在审批前明确呈现。
- 任务选择器显示全部智能体，无法区分“项目成员”和“工作区其他智能体”。
- 自建智能体创建完成后，没有“加入项目”的下一步。
- `Squads`、`Runtimes` 即使为 0 也永久占据桌面一级导航。
- `Squads` 页面当前主要是只读查看，创建依赖 API，一级入口会抬高用户预期。
- `Runtimes` 是本机 Host 执行配置，不是远程 Worker，但当前命名和位置容易让普通用户误判。
- 目前没有导航和功能使用埋点，实体数量不能等同于使用率。

## 3. 目标与非目标

### 3.1 产品目标

- 用户能从项目中看到并管理参与该项目的智能体。
- 用户创建智能体后，能直接把它加入一个或多个项目。
- AI 规划只从项目允许的智能体中建议任务执行者。
- 审批前，每个可执行任务都有明确且合法的智能体。
- 更换任务执行者继续触发计划重新审批。
- 高级配置不再长期挤占主要工作导航。
- 所有成员变更、任务指派和移出操作都有可追踪活动记录。

### 3.2 成功指标

首个版本上线后 30 天内观察：

- 自建智能体加入至少一个项目的比例达到 60% 以上。
- 新 AI 计划中，自建智能体承担任务的项目比例达到 40% 以上。
- 用户创建智能体后 10 分钟内完成首次“加入项目”的比例达到 50% 以上。
- 审批时存在未分配任务的项目比例低于 10%。
- `Squads`、`Runtimes` 从一级导航移出后，相关错误处理完成率不下降。
- Runtime 离线事项仍能从 Inbox 或关联实体到达处理入口。

这些指标只在本机聚合，不上传项目名、路径、智能体指令或任务内容。

### 3.3 非目标

- 本阶段不把 Runtime 改造成远程执行节点。
- 本阶段不把顺序执行的 Project Task 重构为并行 DAG 调度器。
- 本阶段不合并 Task 与 Issue 两套执行模型。
- 本阶段不实现多人工作区、组织权限或 `specific_people` ACL。
- 本阶段不让 AI 在用户未确认时自动创建或加入智能体。
- 本阶段不在用户未确认时自动把 Squad 绑定到项目；用户可以在项目内显式绑定并同步 Squad。

## 4. 设计方向

### 4.1 视觉与产品语言

- **色彩策略**：Restrained，继续使用 Harness 主题 token 和当前中性浅色工作台。
- **使用场景**：开发者在本机显示器上持续处理代码项目、审批计划与执行异常，需要快速扫描和低干扰操作。
- **参照产品**：Linear 的任务归属、GitHub Projects 的项目上下文、Raycast 的渐进式命令入口。
- **交互原则**：标准控件、短路径、可预期后果、状态优先于装饰。
- **中文策略**：主要动作和解释使用简体中文；`Agent`、`Runtime`、`Skills`、路径、ID、命令等技术身份保持准确。

### 4.2 概念命名

| 概念 | 界面名称 | 说明 |
|---|---|---|
| AgentRecord | 智能体 | 工作区级可复用执行角色 |
| ProjectAgentMembership | 项目智能体 | 已获得某项目参与资格的智能体 |
| Task.agentId | 执行者 | 当前任务审批绑定的实际智能体 |
| Squad | 团队编排 | 高级的 Leader/成员委派模板 |
| Runtime | 运行环境 | 本机 Host 的执行资格与工作区配置 |
| Tasks view | 交付看板 | 全局任务视图，不再把页面本身称为“自动交付” |

“成员”一词未来可能同时包含人类协作者，因此底层模型使用 `ProjectAgentMembership`，避免和 `Issue.assigneeType = member` 混为一谈。

## 5. 信息架构

### 5.1 桌面侧栏

建议从当前 8 个并列入口调整为：

```text
工作
  Inbox                  19
  项目                     5
  交付看板                26
  Issues                  48

执行角色
  智能体                    7
  Skills                   58

更多
  团队编排                  0
  运行环境                  正常 / 1 异常

运行概览
  智能体工作中              0
  等待批准                  n
  测试已通过                n
```

具体规则：

- `Squads` 改名“团队编排”，移入“更多”。
- `Runtimes` 改名“运行环境”，移入“更多”。
- “更多”默认收起，记住用户上次展开状态。
- 数量为 0 时不在“更多”标题旁显示总数。
- Runtime 有离线或不稳定状态时，“更多”显示警告点，并在“运行环境”行显示异常数。
- 有进行中的 Squad 委派时，“更多”显示活动点，并在“团队编排”行显示活跃数。
- `Skills` 本期保留一级入口，因为当前只有实体数量，没有真实使用率数据；后续由埋点决定是否并入智能体详情。
- `自动交付` 改名“交付看板”，移动到项目之后，名称与全局任务看板的实际内容一致。

### 5.2 上下文入口

高级能力降级后必须保留这些直达路径：

- 智能体编辑页的 Runtime 字段旁提供“管理运行环境”。
- 智能体详情显示 Runtime 状态，离线时提供“查看运行环境”。
- Inbox 的 Runtime 离线事项直接打开对应运行环境。
- 项目智能体页在成员达到 2 个后提供次要操作“创建团队编排”。
- Issue 指派为 Squad 时，显示“查看团队编排”。
- 项目资源绑定 Runtime 时提供“管理运行环境”。

### 5.3 移动端

当前移动端已经有“更多”，调整后与桌面保持一致：

- 底部固定：`Inbox`、`项目`、`交付`、`智能体`、`更多`。
- `Issues`、`Skills`、`团队编排`、`运行环境` 放入“更多”。
- 当前位于“更多”内页面时，“更多”保持选中态。
- 所有底部导航和操作触点至少 44px。

## 6. 项目内智能体流程

### 6.1 完整闭环

```mermaid
flowchart LR
  A[创建或选择智能体] --> B[加入项目智能体成员池]
  B --> C[设置项目内职责与自动匹配资格]
  C --> D[AI 拆解或手动创建任务]
  D --> E[从项目成员中分配执行者]
  E --> F[审查任务与执行者]
  F --> G[批准 revision 与 plan hash]
  G --> H[按已批准执行者运行]
  H --> I[记录 TaskRun、证据与审核结果]
```

### 6.2 从智能体出发

智能体创建成功后，不再只显示“智能体已创建”。成功页提供：

- 主操作：`加入项目`
- 次操作：`查看智能体`
- 辅助说明：`加入项目后，才能在该项目的任务计划中被选择。`

点击“加入项目”后使用内联选择页或侧边抽屉：

1. 搜索项目。
2. 选择一个或多个非运行中项目。
3. 为每个项目设置项目内职责。
4. 设置“允许 AI 在规划时自动匹配”，默认开启。
5. 确认“加入 N 个项目”。

加入操作不会调用 AI，也不会创建任务或使审批失效。

### 6.3 从项目出发

项目详情增加一级页签：

```text
[概览] [任务] [智能体] [运行与证据]
```

默认仍进入“概览”。“智能体”页签显示：

- 项目负责人智能体。
- 活跃项目智能体列表。
- 每个智能体的项目内职责、全局角色、Skills、可用性、任务数和排队数。
- `添加智能体` 主操作。
- `批量分配未分配任务` 次操作，仅在存在未分配任务时显示。
- 已移出成员放在折叠的“历史成员”中，只读展示。

### 6.4 添加项目智能体

点击“添加智能体”后打开右侧抽屉或页面内选择区，不使用阻断式小弹窗。

选择器结构：

```text
添加项目智能体
[搜索名称、角色或 Skill]
[全部] [可执行] [只读] [当前可用]

□ PRD 技术方案分析师
  全局角色 · 16 Skills · 未绑定 Runtime
  项目内职责 [需求与方案分析      ]
  ☑ 允许 AI 自动匹配

□ 测试设计工程师
  全局角色 · 12 Skills · 当前可用
  项目内职责 [测试设计            ]
  ☑ 允许 AI 自动匹配

                          [取消] [添加 2 个智能体]
```

交互规则：

- 已在项目中的智能体显示“已加入”，不可重复选择。
- archived 智能体不可选择，并说明原因。
- Runtime 未绑定不是阻断条件，因为当前 Host 可以使用默认执行环境。
- Runtime 离线时可加入，但显示警告，不能在恢复前执行任务。
- 添加多个智能体是一次原子操作，避免部分成功。
- 添加后记录 Activity：谁、何时、加入了哪些智能体、项目内职责是什么。

### 6.5 项目负责人

复用现有 `Project.leadAgentId`：

- 负责人必须是 active 项目智能体。
- 每个项目最多一个负责人。
- 负责人用于默认协调、项目概览展示和未来委派，不自动获得所有任务。
- 更换负责人本身不使任务计划审批失效。
- 若负责人仍承担任务，移出项目前必须先重新分配这些任务。

### 6.6 任务指派

任务编辑页把当前全局智能体下拉框改为项目限定选择器：

```text
执行者
[PRD 技术方案分析师 ▼]
需求与方案分析 · 可用 · 0/1 占用

未找到合适成员？ [加入智能体并指派]
```

规则：

- 只显示 active 项目智能体。
- 排序优先级：当前已选、项目职责匹配、在线且有空闲槽位、名称。
- 显示项目内职责、可用性和并发占用，不只显示名称。
- “加入智能体并指派”完成两个动作，但确认页清楚列出后果。
- 新建任务可以暂时未分配；项目审批前必须解决。
- 更换或清除执行者继续使 Project revision 增加、清除当前审批并重置任务证据。
- 批量分配只使 revision 增加一次，不能逐任务产生多次 revision 跳变。

### 6.7 AI 拆解

AI 拆解的候选范围改为：

- 当前项目 active 成员。
- `autoAssignable = true`。
- Agent 本身 `status = active`。

匹配使用项目内职责 `projectRole`，无项目内职责时回退全局 `Agent.role`。Skills 只作为辅助信息，不把“字符串存在”误当成已安装或可执行能力。

规划结果状态：

- 匹配成功：任务直接写入明确 `agentId`。
- 无匹配成员：任务保持未分配，并在计划审查页进入“需要分配”分组。
- 项目无成员：AI 可以生成任务结构，但所有任务保持未分配；页面提示先添加项目智能体。
- AI 不得自动创建智能体或把工作区智能体加入项目。

### 6.8 审批门禁

批准按钮启用前新增检查：

- 每个任务都有 `agentId`。
- `agentId` 对应 active Agent。
- `agentId` 对应当前项目 active membership。
- 每个任务仍有测试命令。
- 代码任务和测试任务均存在。
- 依赖图无环。
- 当前 revision 和 plan hash 与用户看到的一致。

未满足时，审批区不只禁用按钮，而是显示可操作清单：

```text
计划还不能批准
2 个任务未分配执行者                     [批量分配]
1 个任务的智能体已归档                   [重新分配]
```

### 6.9 执行时校验

即使审批时已经校验，执行入口仍需再次检查：

- 任务执行者仍是 active 项目成员。
- Agent 未归档。
- Runtime 若存在则必须可用。
- Project 处于允许执行的状态。
- approval revision 和 plan hash 仍然一致。

执行期不再从全局智能体中隐式回退。这样实际执行者始终与用户批准的 `Task.agentId` 一致。

## 7. 关键页面

### 7.1 项目概览

在当前状态、优先级、负责人、任务语言、Revision 等摘要中增加：

- `项目智能体 5`
- 头像或名称摘要，最多显示 3 个，其余显示 `+2`
- 点击进入“智能体”页签
- 若为 0，显示 `添加智能体`，不显示空数字

在摘要下增加紧凑的“项目编排”条带，聚合当前需要判断的执行事实：

```text
项目编排
负责人  PRD 技术方案分析师
当前执行  Software Engineer · 实现权限校验
运行环境  本机 Harness Host · 正常 · 1/2 占用
队列与审核  2 排队 · 1 阻塞 · 3 待审核
最近运行  TaskRun 8f31c2a1 · 4 分钟前完成
```

条带只聚合并链接现有来源事实，不成为新的写入来源：当前执行和最近运行来自 TaskRun，队列与审核来自 Issue/TaskRun 投影，Runtime 健康来自 Runtime，负责人来自 Project。点击每项进入对应任务、Issue、运行证据或运行环境。

AI 交付流程中增加“执行者准备度”：

- `5/5 已分配`
- `3/5 已分配，2 个待处理`
- `执行者状态发生变化，需要重新确认`

### 7.2 项目智能体页

桌面使用表格式列表，移动端使用无嵌套卡片的纵向行。

| 列 | 内容 |
|---|---|
| 智能体 | 名称、描述、生命周期 |
| 项目职责 | 项目内可编辑职责 |
| 能力 | Skills 数量、工具权限 |
| 可用性 | Runtime、占用、排队 |
| 任务 | 进行中/全部 |
| 操作 | 设为负责人、编辑职责、移出项目 |

页面顶部只保留一个主要按钮“添加智能体”。

### 7.3 全局智能体列表

增加项目使用信息：

- `3 个项目 · 12 个任务`
- 未加入项目时显示 `尚未加入项目`
- 支持筛选：`全部`、`未加入项目`、`当前工作中`、`已归档`
- 空闲自建智能体可直接执行“加入项目”

### 7.4 智能体详情

新增“参与项目”区：

- 项目名称。
- 项目内职责。
- 是否为负责人。
- 已分配任务数。
- 项目状态。
- 跳转项目。

删除智能体规则在页面上提前说明，避免点击后才发现失败。

### 7.5 交付看板

- 卡片继续显示任务执行者。
- 未分配任务使用明确的“未分配”状态，不使用灰色空白。
- 提供按项目智能体筛选。
- 从全局看板编辑执行者时，仍只能选择该任务所属项目的 active 成员。

## 8. 状态设计

| 状态 | 用户应看到的内容 | 可执行操作 |
|---|---|---|
| 项目无智能体 | 为什么需要项目成员，不影响手动整理项目 | 添加智能体 |
| 有成员、无任务 | 成员已就绪，尚未产生任务 | 添加任务、AI 拆解 |
| 有未分配任务 | 数量、具体任务和阻断审批原因 | 单个或批量分配 |
| 智能体已归档 | 受影响任务和审批状态 | 重新分配 |
| Runtime 离线 | 影响哪些成员和任务 | 查看运行环境、稍后处理 |
| 成员满负载 | 占用与排队，不误报为离线 | 仍可分配、改派 |
| 项目运行中 | 成员配置只读，说明运行结束后可改 | 查看执行 |
| 移出成功 | 保留历史记录，当前任务不再引用 | 撤销仅在安全窗口提供 |
| 批量操作部分冲突 | 不允许部分写入，返回冲突项 | 刷新后重试 |
| 迁移后的旧项目 | 根据现有任务指派自动回填成员 | 审核成员池 |

Loading 使用列表骨架，不在页面中央放单个 spinner。错误保留用户已选择内容，并显示稳定错误码对应的中文说明。

## 9. 数据模型

### 9.1 新增 ProjectAgentMembership

```ts
ProjectAgentMembershipRecord {
  id: string                    // `${projectId}:${agentId}`
  projectId: string
  agentId: string
  projectRole: string           // 项目内职责，最多 200 字符
  autoAssignable: boolean       // AI 规划时是否可自动匹配
  status: 'active' | 'removed'
  joinedBy: string              // 操作者标识
  joinedAt: string
  updatedAt: string
  removedAt?: string
}
```

约束：

- `(projectId, agentId)` 唯一。
- Project 和 Agent 必须存在。
- 新增或重新激活时 Agent 必须为 active。
- 移出使用软删除，保留历史上下文。
- 重新加入时复用同一记录，更新状态和职责。
- `Project.leadAgentId` 必须指向 active membership。
- 项目最多 100 个 active 智能体，首版 UI 建议对超过 30 个成员的项目提示筛选和治理风险。

### 9.2 为什么不用 Project.memberAgentIds

独立记录可以保存项目内职责、自动匹配资格、加入和移出时间、操作者与历史状态。数组无法稳定表达这些事实，也会让每次成员变化重写整个 Project 聚合对象。

### 9.3 Snapshot 投影

`Snapshot` 增加：

```ts
projectAgentMemberships: ProjectAgentMembershipRecord[]
```

客户端可以派生：

- 每个项目的 active 成员。
- 每个智能体参与的项目。
- 项目成员任务数和工作负载。
- 已移出成员历史。

### 9.4 审批哈希

不把整个成员列表纳入 `planDigest`。原因是添加一个未承担任务的候选智能体不应使审批失效。

继续把每个任务的 `agentId` 纳入哈希，并增加执行前资格校验：

- 任务执行者必须仍是 active 项目成员。
- 移出仍被未完成任务引用的成员时必须拒绝，或在同一原子操作中重新分配并使审批失效。

## 10. API 方案

### 10.1 项目成员 API

```http
GET /projects/:projectId/agents
POST /projects/:projectId/agents
PUT /projects/:projectId/agents/:agentId
DELETE /projects/:projectId/agents/:agentId
POST /projects/:projectId/agents/batch
```

请求示例：

```json
{
  "agentId": "agent-id",
  "projectRole": "需求与技术方案分析",
  "autoAssignable": true,
  "setAsLead": false,
  "expectedProjectRevision": 3
}
```

批量添加：

```json
{
  "members": [
    {
      "agentId": "agent-a",
      "projectRole": "后端实现",
      "autoAssignable": true
    },
    {
      "agentId": "agent-b",
      "projectRole": "测试设计",
      "autoAssignable": true
    }
  ],
  "expectedProjectRevision": 3
}
```

移出项目：

```json
{
  "expectedMemberUpdatedAt": "2026-08-21T10:00:00.000Z",
  "assignedTaskPolicy": "reject"
}
```

第二阶段可支持原子重新分配：

```json
{
  "assignedTaskPolicy": "reassign",
  "replacementAgentId": "agent-b",
  "expectedMemberUpdatedAt": "2026-08-21T10:00:00.000Z"
}
```

### 10.2 批量任务分配 API

```http
POST /projects/:projectId/task-assignments
```

```json
{
  "expectedRevision": 3,
  "assignments": [
    { "taskId": "task-a", "agentId": "agent-a" },
    { "taskId": "task-b", "agentId": "agent-b" }
  ]
}
```

要求：

- 全部校验通过后一次写入。
- 只增加一次 Project revision。
- 一次清除审批并重置受影响计划证据。
- 返回新 Project、更新后的 Tasks 和新 plan hash。
- 任一任务、成员或 revision 冲突时整体失败。

### 10.3 现有 API 收紧

- `POST /projects/:id/tasks`：非空 `agentId` 必须为 active 项目成员。
- `PUT /tasks/:id`：同上。
- `POST /projects/:id/approve`：拒绝未分配或成员资格失效的任务。
- `POST /projects/:id/execute` 和 retry：再次验证成员资格。
- `assign_issue`、`reassign_issue`：Issue 有 Project 时，Agent 必须为项目成员。
- Issue 指派给 Squad 时，首版要求 Squad Leader 和所有可能执行的成员都属于项目。
- 普通 `PUT /issues/:id` 不再允许修改 assignee 字段，指派统一走 Command API。

### 10.4 错误码

新增稳定错误码：

| 错误码 | 含义 |
|---|---|
| `project-agent-not-member` | 智能体不是项目 active 成员 |
| `project-agent-already-member` | 智能体已经加入项目 |
| `project-agent-inactive` | 智能体已归档 |
| `project-agent-in-use` | 成员仍被任务或 Issue 引用，不能直接移出 |
| `project-agent-lead-required` | 负责人约束不满足 |
| `project-task-unassigned` | 存在未分配任务，不能审批 |
| `project-membership-stale` | 成员信息已被其他操作修改 |
| `project-assignment-stale` | 项目 revision 已变化，批量分配被拒绝 |
| `squad-member-outside-project` | Squad 包含项目成员池外的执行者 |

## 11. 服务端业务规则

### 11.1 添加成员

- 项目存在且不处于运行中。
- Agent 存在且 active。
- 重复请求可以幂等返回当前 active membership。
- 添加未被任务使用的成员不改变 Project revision，不影响审批。
- 记录 `project.agent_joined` Activity。

### 11.2 修改职责

- `projectRole`、`autoAssignable` 修改不改变已有 Task.agentId。
- 只有重新运行 AI 拆解时才使用新职责。
- 不影响当前审批。
- 记录 `project.agent_role_updated` Activity。

### 11.3 移出成员

- 项目运行中时拒绝。
- 若成员仍被未完成 Task、非终态 Issue 或活跃 Squad 委派引用，默认拒绝。
- 选择原子重新分配后，更新相关任务、使审批失效、再软删除 membership。
- 历史 TaskRun、Artifact 和 Activity 继续保留原 Agent ID。
- 若为负责人，必须先选择新负责人或明确清空。
- 记录 `project.agent_removed` Activity。

### 11.4 删除或归档全局智能体

- 参与过项目的智能体优先归档，不物理删除。
- active membership 存在时禁止删除。
- 归档前列出受影响项目与任务。
- 若修改 Agent persona、模型、权限、Skills 或 Runtime 且它承担已审批任务，沿用现有逻辑使相关项目审批失效。

### 11.5 Squad

- Squad 继续是全局复用团队模板，不直接变成项目成员实体。
- 把 Squad 指派给项目 Issue 时，验证可能执行的 Agent 都是该项目 active 成员。
- 补上 `maxParallelDelegations` 的服务端强制检查，避免配置仅展示不生效。

## 12. 低频功能优化

### 12.1 Squads

现状问题：

- 当前数量为 0。
- 页面主要是只读展示，空状态提示通过 API 创建。
- 对普通项目用户来说，它是高级委派机制，不是日常入口。

调整：

- 从一级导航移入“更多”。
- 中文名称改为“团队编排”，副标题保留 `Squads` 技术名。
- 在项目智能体页提供基于已加入成员创建 Squad 的上下文入口。
- 未创建 Squad 时，页面解释适用条件：需要 Leader、至少一个成员和升级策略。
- 没有 UI 创建能力前，不把空页面包装成主功能。

### 12.2 Runtimes

现状问题：

- 当前数量为 0，7 个智能体均未绑定 Runtime。
- Runtime 实际是本机 Host 调度事实，不是远程执行集群。
- 日常用户通常只在异常或配置 Agent 时需要它。

调整：

- 从一级导航移入“更多”。
- 中文名称改为“运行环境”，副标题明确“本机 Harness Host”。
- 正常状态不占用一级导航注意力。
- 离线、不稳定、心跳过期时通过 Inbox、智能体详情和项目资源显示。
- Runtime 页面继续保留完整管理和诊断能力。

### 12.3 Skills

本期不直接降级，原因：

- 当前有 58 个投影记录，说明数据规模不小。
- 但 Skills 是从 Agent Profile 派生的名称投影，不代表已安装或 Runtime 可用。
- 当前没有真实打开次数和有效操作数据。

先执行：

- 在智能体添加选择器中让 Skills 成为搜索和筛选维度。
- 保留“这不代表 Harness 已安装”的警示。
- 通过 30 天本地度量判断是否把 Skills 并入智能体页签。

## 13. 本地使用度量

### 13.1 原则

- 默认仅保存在本机。
- 不记录项目名称、目录、PRD、任务标题、persona、评论和 Transcript。
- 不上传网络。
- 用户可在设置中清除。
- 埋点用于信息架构判断，不作为执行事实来源。

### 13.2 聚合模型

```ts
FeatureUsageDailyRecord {
  id: string                    // `${date}:${feature}`
  date: string
  feature: 'inbox' | 'issues' | 'projects' | 'delivery' |
           'agents' | 'skills' | 'squads' | 'runtimes'
  opens: number
  meaningfulActions: number
  errorRecoveries: number
  lastUsedAt: string
}
```

有意义动作示例：

- 项目：创建、编辑、批准、执行。
- 智能体：创建、加入项目、修改、分配任务。
- Squad：创建、委派、处理升级。
- Runtime：创建、心跳更新、从异常恢复。
- Skills：从 Skill 打开智能体、按 Skill 筛选。

### 13.3 30 天决策规则

- 30 天内至少 3 个不同日期打开，或至少 5 次有意义动作：保留一级入口候选。
- 只有少量打开且没有有意义动作：移入“更多”或上下文入口。
- 几乎不打开但承担关键异常处理：保留上下文和 Inbox，不保留一级入口。
- 连续 30 天实体为 0 且无动作：默认隐藏在折叠的“更多”中。

不要用单次实体数量直接推断功能使用率。记录只包含 UTC 日期、feature key、三类聚合计数和 `lastUsedAt`；服务端不接受客户端指定统计日期，超过 30 天的记录会在下一次写入时自动清理。所有数据仅保存在本机，可由用户随时清除。

## 14. 存储与迁移

### 14.1 新表

在 `project_orchestrator` domain 增加：

- `project_agent_memberships`
- 第二阶段可增加 `feature_usage_daily`

保持 version 1 兼容策略前，先确认 `dsh-storage-domain` 对 domain version 升级的支持。若继续采用 optional table，必须确保生产存储实际创建新表，而不是只在旧测试域中静默返回空表。

### 14.2 幂等回填

启动迁移顺序：

1. 备份 `~/.dsh/storages/project_orchestrator.json`。
2. 创建或确认 membership 表可用。
3. 对每个项目收集 `Project.leadAgentId`。
4. 收集当前 `Task.agentId`。
5. 收集项目下非终态 Issue 的 Agent assignee。
6. 仅为仍被当前计划或非终态 Issue 使用、且仍存在并为 active 的 Agent 建立 active membership。
7. 历史 TaskRun 中出现、但当前不再引用的 Agent 仅保留原有历史记录，不扩大 active 池。
8. 缺失或已归档的旧引用不阻止 Host 启动；保留 Task/Issue 供修复，并在 Inbox、审批、重试和执行时失败关闭。
9. 确认所有当前 Task.agentId 都有 active membership；重新分配不满足条件的引用。
10. 通过确定性 membership ID 与派生 Inbox 保证重复启动不重复回填。

### 14.3 leadAgentId

- 若已有 `leadAgentId` 且 Agent 存在，回填为 active membership 并保留负责人。
- 若 Agent 已删除或归档，清空负责人并生成 Inbox 待处理事项。
- 不从“第一个任务执行者”自动推断负责人。

### 14.4 删除项目

项目删除流程必须增加 membership 清理：

- active 和 removed memberships 均随项目删除。
- 共享 Agent、Squad、Runtime 继续保留。
- 删除仍不是跨表数据库事务，失败时要返回可重试错误并保留诊断信息。

### 14.5 回滚

- 上线前停止 Harness Host 并备份存储文件。
- 回滚旧版本前暂停所有可执行队列；旧代码不会执行成员资格约束，也可能恢复全局执行者回退。
- 若要恢复旧行为契约，必须同时恢复旧插件和升级前存储备份，不能只依赖新表被旧代码忽略。
- 存储备份中保留所有 Task、Issue 与 membership 事实；不在回滚脚本中选择性删除 membership 数据。

## 15. 安全与审计

- 所有 mutation 继续要求 loopback、同源 Origin 和 same-origin fetch metadata。
- Client 只发送 Project ID、Agent ID 和受限字段，不发送任意命令。
- 项目成员资格不等同于文件系统 ACL，Host 仍需验证持久化项目目录。
- Activity 至少记录加入、修改职责、设为负责人、移出、批量分配和资格校验失败。
- TaskRun 继续记录最终 Agent ID、Runtime ID、Session、分支、测试和 Artifact。
- Runtime 文案不得暗示支持当前尚未实现的远程 Agent 执行。

## 16. 可访问性与响应式

- 新增列表、选择器和抽屉符合 WCAG 2.2 AA。
- 项目智能体选择使用真实 checkbox；负责人使用单选或明确命令，不使用仅靠颜色的选中态。
- 所有图标按钮有可访问名称和 Tooltip。
- 键盘可完成搜索、选择、设置职责、加入和取消。
- 焦点在抽屉打开后进入标题或首个字段，关闭后返回触发按钮。
- 错误通过文本和图标表达，不只使用红色。
- 移动端项目成员行不隐藏关键状态，次要字段可进入详情。
- 尊重 `prefers-reduced-motion`，状态过渡保持 150 至 250ms 或直接切换。

## 17. 实施分期

### Phase 0：契约与测试基线

交付：

- 确认存储扩表方式。
- 为成员资格、审批、执行和迁移写失败测试。
- 固化当前 26 个任务的迁移样本。
- 明确 Issue assignee 普通更新的收紧策略。

完成标准：

- 旧快照可加载。
- 回填脚本可重复运行。
- 不改变现有运行中项目。

### Phase 1：项目成员池 MVP

交付：

- `ProjectAgentMembershipRecord` 与存储表。
- 成员 CRUD 和批量添加 API。
- 项目“智能体”页签。
- 项目概览的“项目编排”条带，链接 Task、Issue、TaskRun 与 Runtime 事实。
- 全局智能体详情的“参与项目”。
- 任务选择器仅显示项目成员。
- 创建智能体后的“加入项目”。
- Activity 记录。

完成标准：

- 自建智能体可以加入项目并手动分配给任务。
- 非项目成员不能写入 Task.agentId。
- 添加未使用成员不影响审批。
- 移出被引用成员会失败并说明受影响任务。

### Phase 2：规划、审批与批量分配

交付：

- AI 拆解只使用 `autoAssignable` 项目成员。
- 未匹配任务分组。
- 批量任务分配 API 和 UI。
- 审批前强制所有任务明确分配。
- 执行时取消全局默认 Agent 回退。
- 成员移出时原子重新分配。

完成标准：

- AI 不会选择项目外智能体。
- 批量分配只增加一次 revision。
- 实际执行者与批准的 Task.agentId 完全一致。
- 成员资格变化无法绕过执行期校验。

### Phase 3：导航与上下文优化

交付：

- 桌面“更多”分组。
- `Squads`、`Runtimes` 降级。
- `自动交付` 改名“交付看板”。
- Runtime 和 Squad 上下文入口。
- 移动端导航同步。

完成标准：

- 一级导航不再永久显示两个 0 数量高级入口。
- Runtime 异常仍能在两次操作内到达处理页。
- 当前处于“更多”页面时导航状态明确。

### Phase 4：本地度量与后续收敛

交付：

- 本地聚合使用度量。
- 30 天工作区导航报告。
- Skills 是否降级的决策。
- Squad 创建 UI 是否值得进入项目流程的决策。

完成标准：

- 无敏感业务内容写入度量表。
- 用户可查看并清除统计。
- 导航调整有数据依据。

## 18. 测试计划

### 18.1 单元测试

- membership schema、唯一性和软删除。
- 项目成员新增、更新、移出和重新加入。
- Task agent 必须属于项目。
- AI role matching 只使用项目成员和 `autoAssignable`。
- plan digest 继续绑定 Task.agentId。
- 添加未使用成员不改变 digest。
- 批量分配 revision 只增加一次。
- Squad 项目成员约束。
- `maxParallelDelegations` 上限。

### 18.2 服务测试

- Agent 归档和删除受 membership 约束。
- Project 删除清理 memberships。
- 运行中项目拒绝成员变更。
- 移出有未完成任务的成员失败。
- 原子重新分配失败时不产生部分写入。
- 审批拒绝未分配和失效成员。
- 执行期再次验证成员资格。
- 旧数据幂等回填。

### 18.3 HTTP 测试

- 新路由 method、status 和错误结构。
- mutation 继续受 loopback 同源策略保护。
- stale revision 和 stale membership 返回 409。
- 批量 API 不接受跨项目 Task 或 Agent。

### 18.4 前端测试

- 项目成员空、加载、成功、错误、历史状态。
- 创建智能体后加入项目。
- 任务选择器只显示当前项目成员。
- “加入并指派”完成后选择器状态正确。
- 审批阻断清单可跳转到未分配任务。
- 桌面和移动端“更多”状态。
- Runtime 异常上下文跳转。
- 键盘、焦点、屏幕阅读器名称和 200% 缩放。

### 18.5 回归测试

- 空项目仍不调用 AI。
- AI 拆解仍需显式触发。
- 项目目录与 Harness Workspace 打开能力不变。
- 当前 approval revision/hash 行为不弱化。
- Project、Issue、TaskRun、Artifact 和 Transcript 证据不丢失。
- 深色主题和 reduced motion 不回归。

## 19. 验收场景

### 场景 A：自建智能体首次进入项目

1. 用户创建“PRD 技术方案分析师”。
2. 成功页点击“加入项目”。
3. 选择一个项目，职责设为“需求与技术方案分析”。
4. 项目智能体页立即显示该成员。
5. 新建任务时可选择它。
6. 任务保存后 Project revision 增加，旧审批失效。

预期：全程不调用 AI，所有后果有明确说明。

### 场景 B：AI 使用项目成员

1. 项目加入分析、实现、测试三个智能体。
2. 启动 AI 拆解。
3. AI 只能从这三个成员中匹配。
4. 无匹配任务保持未分配。
5. 用户批量分配后批准。

预期：项目外智能体不会出现在计划或执行中。

### 场景 C：移出承担任务的成员

1. 项目有已审批任务绑定 Agent A。
2. 用户尝试移出 Agent A。
3. 系统显示受影响任务并拒绝直接移出。
4. 用户选择 Agent B 作为替代。
5. 系统原子更新任务、软删除 membership、增加一次 revision 并使审批失效。

预期：不存在任务继续引用已移出 active 成员的中间状态。

### 场景 D：Runtime 离线

1. 项目成员绑定 Runtime，Runtime 离线。
2. Inbox 出现待处理事项。
3. 用户从 Inbox 进入运行环境页。
4. 恢复后成员可用性同步更新。

预期：即使 Runtime 不在一级导航，异常处理路径不变差。

## 20. 主要风险与控制

| 风险 | 控制 |
|---|---|
| 成员池与 Task.agentId 不一致 | 写入、审批、执行三层校验 |
| 成员变更导致无意义审批失效 | 只让实际任务指派进入 plan hash |
| 批量修改造成 revision 多次跳变 | 新增原子批量分配 API |
| 迁移后旧项目无法执行 | 先回填，再开启严格校验 |
| Runtime 被误解为远程集群 | 改名并明确“本机 Harness Host” |
| 高级入口被隐藏后不可发现 | Inbox 和实体详情提供上下文入口 |
| 埋点收集敏感内容 | 仅按日聚合 feature key 和计数 |
| 多 Host 并发冲突 | 当前声明单 Host 边界，API 预留 expected version |
| Squad 含项目外 Agent | 指派时校验全部可能执行成员 |
| 旧式 Project Task 不遵守并发槽位 | 本阶段不宣称并行，后续单独统一 dispatcher |

## 21. 预计代码影响

| 文件 | 预计改动 |
|---|---|
| `src/types.ts` | membership schema、输入、错误相关类型、Snapshot |
| `src/client-types.ts` | 客户端 membership 和投影类型 |
| `src/storage.ts` | 新表、snapshot 投影、项目删除关联 |
| `src/service.ts` | 成员 CRUD、资格校验、迁移、规划候选、审批和执行门禁 |
| `src/workflow.ts` | 项目成员范围内的任务匹配，不弱化 plan digest |
| `src/http.ts` | 成员和批量分配路由 |
| `src/client.tsx` | 导航、项目页签、成员选择器、任务指派、成功后续动作 |
| `src/styles.ts` | 项目成员列表、抽屉、导航 disclosure、响应式状态 |
| `tests/service.test.mjs` | 资格、审批、迁移、删除、并发和回归 |
| `tests/http.test.mjs` | 新 API 与安全边界 |
| `tests/workflow.test.mjs` | 角色匹配和 plan hash |
| `docs/architecture*.md` | ProjectAgentMembership 来源事实与执行边界 |
| `docs/api*.md` | 新路由、错误码和兼容策略 |
| `docs/operations.md` | 备份、迁移和回滚 |

## 22. 实施与验收结果

`dsh-project-orchestrator@1.4.0` 已完成本文定义的数据模型、服务契约、迁移、项目成员/任务分配界面、导航调整、本地使用度量和双语文档。最终验收证据：

- TypeScript 检查、Host/Client build、文档 smoke、package smoke 均通过；完整 Node 测试为 `109/109`。
- 现有 Harness Web profile 已通过官方 plugin 管理器安装本地 `1.4.0` 构建；升级前存储已做 SHA-256 一致性备份。
- 真实 version-1 存储启动后成功持久化 `project_agent_memberships` 与 `feature_usage_daily` 表；5 个 Project、26 个 Task 回填出 6 条 active memberships，未发现无成员或失效成员的 Task 指派。
- Chrome CDP 在 `1440x1000` 与 `390x844` 验证项目详情、智能体页签、任务执行者、桌面/移动导航和“更多”入口；页面异常与 console error 均为 0，根节点和 body 横向溢出均为 0。
- 视觉截图保存在本机 `/tmp/dsh-po-desktop.png`、`/tmp/dsh-po-tasks.png`、`/tmp/dsh-po-mobile.png` 和 `/tmp/dsh-po-mobile-more.png`，用于本次验收。
