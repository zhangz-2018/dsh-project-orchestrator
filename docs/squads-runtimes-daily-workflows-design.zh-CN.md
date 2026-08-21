# 团队编排与运行环境日常业务设计

> 状态：已确认，PRD 与技术方案已完成
> 日期：2026-08-21
> 范围：产品定位、业务流程、信息架构、交互、状态、接口增量与验收
> 适用版本：`dsh-project-orchestrator@1.4.x` 后续迭代

## 1. 设计结论

`团队编排` 和 `运行环境` 不应成为用户每天主动巡检的一级工作台，也不应只是空白的数据查看页。

它们的正确定位是：

- `团队编排`：把多个全局智能体组织为可复用的协作模板，用于复杂 Issue 的拆分、委派、并行执行、汇总和升级。
- `运行环境`：管理显式执行配置、能力和可用性；正常时在后台工作，异常时从 Inbox、项目和 Agent 上下文进入处理。
- 高频工作仍在 `项目`、`交付看板`、`Issues` 和 `Inbox` 完成。
- 两个高级页面保留在“更多”中；只有存在活跃委派或运行异常时显示状态点。
- 页面必须提供完整创建、编辑、归档、绑定和诊断闭环，删除“可通过 API 创建”的产品文案。

当前导航收纳方向不变，但页面内容和上下文入口需要补全。

## 2. 业务对象边界

### 2.1 项目成员与 Squad

| 对象 | 回答的问题 | 来源事实 |
|---|---|---|
| Global Agent | 工作区有哪些可复用智能体 | `AgentRecord` |
| Project Agent Membership | 哪些智能体有资格参与当前项目 | `ProjectAgentMembership` |
| Squad | 多个智能体以什么结构协作 | `SquadRecord` |
| Task.agentId | 这个已审批任务最终由谁执行 | `TaskRecord.agentId` |
| Issue assignee | 当前长期事项交给个人还是团队 | `IssueRecord.assigneeType/assigneeId` |

约束：

- Squad 是工作区级可复用团队，不自动获得项目权限。
- Squad 用于某项目时，Leader 和所有成员都必须是该项目的 active 成员。
- Squad 不替代 `Task.agentId`。Leader 拆分或委派后，每个实际 TaskRun 仍记录具体 Agent。
- 单一 Agent 可以完成的 Task 不使用 Squad。
- 只有需要跨角色协作、并行、复核或升级的 Issue 才使用 Squad。

### 2.2 默认 Host 与 Runtime

现有行为中，Agent 未绑定 `runtimeId` 时由本机 Harness Host 执行。因此页面不能用“0 个 Runtime”表达“没有运行环境”。

页面应同时展示两类事实：

- `本机默认环境`：系统派生的只读基线，代表未显式绑定 Runtime 的执行路径，不伪造持久化 RuntimeRecord。
- `显式 Runtime`：用户创建并绑定给 Agent 或 Project Resource 的运行配置。

Issue 执行时，Agent 与选中 Resource 都显式绑定且 ID 不同则拒绝；否则使用显式一方，双方都未绑定才使用默认 Host。旧式 Project Task 不选择 Resource，P0 仍只使用 Agent.runtimeId。

文案规则：

- 有默认环境、无显式配置：显示“本机默认环境可用 · 0 个自定义配置”。
- 不再显示“还没有 Runtime”这种会让用户误以为任务无法执行的空态。
- `清除使用统计` 不属于 Runtime 管理，移动到“更多 > 本地数据”。

## 3. 典型业务场景

### 3.1 简单项目交付

场景：一个软件 Agent 和一个测试 Agent 完成普通项目任务。

流程：

1. 在项目智能体页加入 Software Engineer 和 Test Engineer。
2. 直接为每个 Task 指派 Agent。
3. 使用本机默认环境执行。
4. 不创建 Squad，不进入 Runtime 页面。

这是默认路径，不得因高级能力增加额外步骤。

### 3.2 跨角色复杂 Issue

场景：一个需求同时涉及后端、前端、测试和技术负责人。

流程：

1. 在项目中加入四个所需 Agent。
2. 从项目智能体页点击“组建团队”。
3. 系统带入当前项目和 active 项目成员。
4. 用户指定 Leader、成员职责、最大并行数和升级策略。
5. 在 Issue 中选择“分派给团队”，只显示所有成员均具备项目资格的 Squad。
6. Leader 创建或委派子 Issue。
7. 成员产生具体 TaskRun、Artifact 和评论。
8. Leader 汇总后进入 `in_review`，由用户批准或退回。

### 3.3 Runtime 异常处理

场景：P0 处理 Agent/Resource 显式 Runtime offline/unstable；P1 才处理能力不足。

P0 流程：

1. 派发前检测 Runtime lifecycle 和 status。
2. TaskRun 保持 queued/waiting_local_directory，不把临时离线误写成业务失败。
3. Inbox 创建 `runtime_offline` 事项，summary 区分 offline/unstable。
4. 用户从 Inbox 或项目编排条带直接打开对应 Runtime 详情。
5. 页面突出受影响 Agent、Project Resource 和排队 TaskRun。
6. 用户显式“切换到本机默认环境”、绑定其他 Runtime，或通过 heartbeat 恢复状态。
7. 恢复后继续派发，并记录 Activity。

P1 在 requiredCapabilities 成为来源事实后，再增加 probe、能力不匹配事项和“重新检测”。

### 3.4 P1：只读审查环境

场景：代码审查 Agent 不应写入仓库。

流程：

1. 创建“只读审查”Runtime 配置。
2. 能力显示为 `repository_read`、`git_diff`，工具策略为只读。
3. 将 Code Review Agent 绑定到该 Runtime。
4. 项目 Task 仍审批具体 Agent；执行时验证 Runtime 能力。
5. 权限不足时失败关闭，不自动切换到权限更高的环境。

## 4. 导航与上下文入口

### 4.1 桌面导航

“更多”展开后保留：

- 团队编排
- 运行环境
- 本地数据

状态提示：

- 团队编排存在 `queued/running/waiting_leader` 委派时显示蓝色状态点。
- P0 Runtime 存在 offline/unstable 时显示黄色状态点；P1 再纳入能力不匹配。
- 无活动、无异常时不显示数字 `0`，减少无意义噪音。

### 4.2 移动导航

“更多”菜单：

- Issues
- Skills
- 团队编排
- 运行环境
- 本地数据
- 关闭工作台

异常项在菜单行右侧显示状态点和数量，但不增加新的底部主导航项。

### 4.3 上下文入口

| 来源 | 入口 | 目标 |
|---|---|---|
| 项目智能体页 | 组建团队 | 新建 Squad，预选项目成员 |
| Project Issue | 分派给团队 | 只显示该项目可用 Squad |
| Agent 详情 | 运行环境 | 打开该 Agent 当前 Runtime |
| 项目编排条带 | Runtime | 打开当前执行对应 Runtime |
| TaskRun 详情 | Runtime | 打开执行证据对应 Runtime |
| Inbox Runtime 异常 | 处理运行环境 | 打开异常详情并定位受影响绑定 |
| Squad 活跃 Issue | 查看协作 | 打开对应 Issue 或委派链 |

用户正常交付时不需要主动寻找这两个全局页面。

## 5. 团队编排页面

### 5.1 页面结构

```text
团队编排                                  [新建团队]
活跃 2 · 等待 Leader 1 · 已归档 3

[搜索团队] [状态：全部] [可用于项目：全部]

名称             Leader        成员   活跃事项   并行占用   最近活动
标准交付小队      Tech Lead      4      2          2/3        6 分钟前
代码审查组        Reviewer       2      0          0/1        3 天前
```

采用全宽表格/列表，不使用大卡片和嵌套卡片。

列表列：

- 名称与简短描述
- Leader
- 成员数量及主要角色
- 活跃 Issue/Delegation
- 当前并行占用 / 上限
- 状态：active/archived
- 最近活动
- 行尾操作菜单：编辑、复制、归档

顶部统计只展示可操作状态，不展示历史累计总数。

### 5.2 空状态

```text
还没有团队编排
当一个 Issue 需要多个项目智能体协作时再组建团队。
[新建团队]
```

若当前工作区不足两个 active Agent：

```text
至少需要两个 active 智能体
先创建或启用智能体，再组建协作团队。
[前往智能体]
```

不再出现“通过 API 创建”。

### 5.3 新建团队抽屉

使用右侧宽抽屉，三步完成；不跳转独立营销式页面。

#### 第一步：基本信息

- 团队名称，必填，最多 160 字符。
- 简短描述，最多 1,000 字符。
- 来源项目，只在从项目上下文进入时显示且只读。
- P1 可选模板：标准交付、代码审查、故障分析、自定义。

P0 不展示模板。P1 模板只预填字段，不创建隐式 Agent。

#### 第二步：Leader 与成员

成员选择器只显示 active Agent；从项目进入时只显示 active 项目成员。

每一行包含：

- 复选框
- Agent 名称和全局角色
- 项目职责
- Squad 内职责输入
- Runtime 可用性

规则：

- Leader 必须在已选成员中。
- 团队至少包含两个不同 Agent。
- 同一 Agent 不可重复。
- 从项目创建时，不允许加入项目成员池外的 Agent；提供“先加入项目”次要入口。
- archived Agent 不可选择。

#### 第三步：协作策略

P0：

- 最大并行委派：Stepper，范围 1–32。
- Leader 指令：必填自由文本。
- 升级策略：必填自由文本。

P1 在对应状态机和持久化字段完成后再增加：结构化升级选项、是否等待所有成员、停止全部/允许继续失败策略，以及成员失败/Leader 汇总/权限扩大人工门禁。

底部命令：

- 取消
- 上一步
- 创建团队

提交前显示一段结构化摘要，不重复展示完整表单。

### 5.4 Squad 详情

页签：

- 概览
- 成员与职责
- 活跃工作
- 历史与证据

概览展示：

- Leader
- 并行占用
- 升级策略摘要
- 可用于哪些项目
- 当前阻塞/待审核事项

活跃工作按父 Issue 分组，展示 Leader、成员、TaskRun 和审核状态。点击直接进入 Issue，不在 Squad 页面复制 Issue 操作面板。

### 5.5 编辑与归档

- 编辑成员前检查活跃委派。
- 移出承担活跃委派的成员时默认拒绝。
- 修改并行上限不得低于当前占用。
- 归档 Squad 前必须处理活跃 Issue 和 Delegation。
- 归档保留历史 Issue、TaskRun、Artifact 和 Activity。
- 复制 Squad 只复制结构和策略，不复制活跃工作。

## 6. 运行环境页面

### 6.1 页面结构

```text
运行环境                              [添加运行配置]
本机 Harness Host 在线 · 自定义配置 2 · 异常 1

本机默认环境
在线  Harness Host  未显式绑定的 Agent 使用此环境
能力：Git / Worktree / Agent CLI / 本地目录

自定义运行配置
名称            状态       绑定 Agent   项目资源   排队   最近心跳
只读审查         在线       2            3          0      20 秒前
浏览器测试       不稳定     1            1          4      3 分钟前
```

“本机默认环境”是一个无装饰的基线区，不伪造数据库 Runtime，也不允许删除。

自定义配置使用全宽列表，异常行显示状态色和明确问题，不整行填充强色背景。

### 6.2 添加运行配置抽屉

字段：

- 名称
- Machine ID
- Agent CLI
- Workspace Root
- 能力多选

命令：

- 取消
- 保存配置
- P1 检测环境

P0 保存后进入 Runtime 详情，再通过独立的影响预览与绑定流程关联 Agent/Project Resource，避免创建和多对象迁移形成不可恢复的复合写入。

P1“检测环境”只调用受限服务端探针，不接受用户输入任意 shell 命令。

P1 检测结果：

- Host 可达性
- Agent CLI 可用性
- Workspace Root 是否为现有、可写、非过宽且非符号链接目录
- Git/Worktree 能力
- 浏览器能力
- 权限模式

保存失败时保留全部表单内容和检测结果。

### 6.3 Runtime 详情

页签：

- 概览
- 绑定关系
- 排队工作
- 事件与诊断

概览：

- online/offline/unstable
- Machine ID
- 最近心跳
- Agent CLI
- Workspace Root
- 能力
- P1 最近检测结果

绑定关系：

- 已绑定 Agent
- 已绑定 Project Resource
- 每条绑定显示受影响项目和活跃任务
- 支持“切换到其他 Runtime”
- 支持“恢复为本机默认环境”

排队工作：

- queued/waiting_local_directory TaskRun
- 等待原因
- 所需能力
- 对应 Project、Issue、Task、Agent

诊断操作：

- 重新检测
- 标记不稳定
- 标记离线
- 查看最近错误
- 复制诊断摘要

不提供任意命令终端。

### 6.4 Runtime 删除或归档

- 有绑定 Agent、Project Resource 或 queued/waiting_local_directory/dispatched/running TaskRun 时禁止归档；deferred 仅保留为历史证据。
- 用户必须先重新绑定，或明确恢复本机默认环境。
- 已产生 TaskRun 的 Runtime 优先归档，不物理删除。
- 历史执行证据继续保留 Runtime ID 和名称快照。

## 7. Issue 与项目中的使用

### 7.1 Issue 分派

Issue 详情的 assignee 控件改为分段模式：

```text
执行者类型  [智能体] [团队]
执行者      [选择项目成员 / 选择可用团队]
```

团队主选项只显示：

- active Squad
- Leader 和全部成员均为 active 项目成员
- 当前全局并行容量未耗尽

不满足结构或容量条件的 Squad 进入“不可用团队”，说明具体原因并提供修复入口。Leader Runtime offline/unstable 只显示“分派后等待运行环境”警告，不改变项目资格；P0 不存在权威 requiredCapabilities，因此不做能力门禁。

### 7.2 项目智能体页

“创建团队编排”改为主文案“组建团队”，行为：

- 打开新建 Squad 抽屉。
- 自动带入当前项目。
- 候选人只来自 active 项目成员。
- 成功后返回项目智能体页，显示新团队及“分派 Issue”命令。

项目成员区域下方增加“可用团队”轻量列表：

- 团队名称
- Leader
- 成员资格是否完整
- 活跃 Issue 数

### 7.3 Agent 详情

增加“运行环境”事实行：

- 未绑定：本机默认环境
- 已绑定：Runtime 名称、状态、能力摘要
- 异常时显示“处理运行环境”

## 8. 本地数据入口

`清除使用统计` 从 Runtime 页头移除。

在“更多”中新增 `本地数据`：

- 最近 30 天功能使用聚合
- 数据字段说明
- 本机存储说明
- 清除使用统计

清除后不得立即记录“清除统计”本身；当前 `recordMeaningfulAction = false` 规则继续保留。

## 9. 状态与反馈

### 9.1 Squad 状态

| 状态 | 页面表现 | 可执行操作 |
|---|---|---|
| active / idle | 正常 | 编辑、复制、分派 |
| active / busy | 显示并行占用 | 查看工作、有限编辑 |
| waiting_leader | 黄色状态 | 打开待汇总 Issue |
| blocked | 红色错误摘要 | 处理成员、权限或 Runtime |
| archived | 降低强调 | 查看历史、复制 |

### 9.2 Runtime 状态

| 状态 | 页面表现 | 派发行为 |
|---|---|---|
| 默认本机可用 | 中性成功状态 | 允许未绑定 Agent 执行 |
| online | 正常 | P0 允许通过现有资格门禁的任务 |
| unstable | 黄色状态 | 新任务默认暂缓，可人工处理 |
| offline | 红色状态 | 不派发，保留队列 |
| P1 capability mismatch | 具体缺少能力 | requiredCapabilities 上线后失败关闭，不自动降级 |

### 9.3 加载与错误

- 页面加载使用列表骨架，不在中央放单个 spinner。
- 创建和编辑失败保留输入。
- 409 冲突显示稳定错误码对应的中文修复动作。
- 空状态、加载状态、错误状态不复用同一文案。
- 后台 usage 写入失败不打断业务操作。

## 10. 响应式与可访问性

### 10.1 桌面

- Sidebar 维持当前宽度。
- 列表内容最大利用横向空间。
- 创建和编辑使用右侧抽屉，宽度 520–640px。
- 详情不使用嵌套卡片；页签下使用分组列表和描述列表。

### 10.2 移动

- 全宽列表改为主信息行 + 次要事实。
- 行操作收进三点菜单。
- 创建抽屉变为全屏 sheet。
- 步骤标题固定在顶部，底部命令固定且不遮挡内容。
- Squad 成员职责和 Runtime 绑定使用逐行编辑，不压缩为桌面表格。

### 10.3 可访问性

- 所有点击目标至少 44px。
- 状态不只依赖颜色。
- 抽屉打开后焦点进入标题，关闭后返回触发按钮。
- 成员选择器支持键盘搜索、Space 勾选和可读禁用原因。
- 普通页签使用导航语义；若声明 ARIA tabs，则完整实现 roving tabindex 和方向键。
- `prefers-reduced-motion` 下取消抽屉位移动画。

## 11. 服务与接口增量

### 11.1 Squad

保留并收紧：

- `POST /squads`
- `PUT /squads/:id`：继续编辑基本信息、成员职责和策略，增加乐观并发及活跃委派保护。
- `POST /squads/:id/archive`
- `DELETE /squads/:id`：仅兼容从未被引用的记录，Web 不展示。

新增：

- `POST /squads/:id/clone`：复制结构和策略。
- `GET /projects/:id/eligible-squads`：返回可用与不可用原因的投影。

`POST /squads` 增加可选 `sourceProjectId`，只用于资格校验和 Activity，不把 Squad 变成项目私有对象。

### 11.2 Runtime

保留：

- `POST /runtimes`
- `POST /runtimes/:id/heartbeat`

新增：

- `PUT /runtimes/:id`：修改显式配置。
- `POST /runtimes/:id/archive`：归档无活跃引用的 Runtime。
- `PUT /agents/:id/runtime`：绑定或恢复默认环境。
- `PUT /resources/:id/runtime`：绑定或恢复默认环境。
- P1 `POST /runtimes/:id/probe`：执行受限能力检测。

探针响应只返回结构化能力和错误码，不返回环境变量、密钥或无界命令输出。

### 11.3 只读投影

公共 Snapshot 只新增工作区级 Runtime 概览：

```ts
runtimeOverview: {
  defaultHost: {
    status: 'online' | 'unstable'
    capabilities: string[]
  }
  customCount: number
  abnormalCount: number
}
```

Squad availability 依赖具体项目，不放入全局 Snapshot；统一通过 `GET /projects/:id/eligible-squads` 实时返回 eligible、dispatchReady、reasons/warnings、activeDelegations 和 availableSlots。

两类投影都不是新的写入来源事实。

## 12. 数据与安全规则

- 所有 mutation 继续要求 loopback、同源 Origin 和 same-origin fetch metadata。
- P1 Runtime probe 不接受任意 command、脚本或环境变量名。
- Workspace Root 必须是现有可写绝对目录，经过 lstat/realpath、过宽路径和符号链接校验，并在每次创建 worktree 前复核。
- Squad Leader 和成员必须 active，且至少两个不同 Agent。
- 项目 Issue 分派给 Squad 时重新校验全部成员资格，不能只信页面投影。
- Runtime 异常不允许自动切换到权限更高的环境。
- Runtime 和 Squad 归档保留 TaskRun、Artifact、Activity 与 Issue 历史。
- 批量绑定和成员变更使用串行 mutation；进程内异常尽力补偿，跨写入崩溃依靠安全写序和 dispatch 前启动恢复，不宣称多表事务。

## 13. 实施阶段

### Phase A：P0 补齐可操作闭环

- Squad 新建抽屉、编辑、全局并行容量保护和归档。
- Runtime 默认 Host 基线区、新建配置、编辑和归档。
- 移除两个空页面中的 API 文案。
- 从项目智能体页带上下文组建团队。
- 将本地使用统计移出 Runtime 页头。

### Phase B：P0 业务上下文接入

- Issue 的智能体/团队分段指派。
- 项目可用 Squad 投影。
- Agent 和 Project Resource 的 Runtime 绑定。
- Inbox、项目编排条带和 TaskRun 的 Runtime 深链接。
- Leader 协作等待投影和 Runtime/Squad 历史审计视图。

### Phase C：P1 诊断与治理

- 受限 Runtime probe。
- requiredCapabilities、能力不匹配和结构化排队原因。
- Squad 模板、聚合策略、失败策略和人工门禁。

不建议一次性实现远程 worker、分布式锁或 active/active Host；这些不属于当前单 Host 产品边界。

## 14. 验收标准

### 14.1 团队编排

- 用户无需 API 即可新建、编辑、复制和归档 Squad。
- 从项目进入时只能选择 active 项目成员。
- Leader 必须是成员，团队至少两个不同 Agent。
- 可将 Project Issue 分派给具备资格且有容量的 Squad。
- 活跃委派中的成员不能被静默移除。
- 点击活跃工作可回到具体 Issue、TaskRun 和 Artifact。

### 14.2 运行环境

- 无自定义 Runtime 时仍显示可用的本机默认环境，不再显示误导性 `0 Runtime` 空白页。
- 用户无需 API 即可创建和编辑显式 Runtime。
- 可查看并修改 Agent、Project Resource 绑定。
- Runtime 离线时不创建错误执行，TaskRun 保持可恢复状态。
- Inbox 和项目上下文可直接打开异常 Runtime。
- 页面不暴露任意命令执行能力或敏感环境数据。

### 14.3 导航与体验

- 正常情况下两个页面继续位于“更多”。
- 存在活跃 Squad 或 Runtime 异常时显示状态点。
- 桌面和 390px 移动端无横向页面溢出。
- 抽屉焦点进入和返回正确。
- 浅色、深色、200% 缩放和 reduced motion 均通过检查。
- 页面异常和 console error 为 0。

## 15. 预计代码影响

| 文件 | 改动 |
|---|---|
| `src/types.ts` | P0 Squad 更新/复制、Runtime lifecycle/归档、TaskRun 名称证据和投影类型；P1 probe |
| `src/client-types.ts` | Runtime Overview、eligible-squads 响应和表单类型 |
| `src/service.ts` | P0 Squad 更新/复制/资格、Runtime 绑定/归档/恢复；P1 probe |
| `src/http.ts` | 新增同源 JSON 路由和统一 Content-Type 门禁 |
| `src/client.tsx` | 两个管理页面、抽屉、Issue 分段指派、上下文入口、本地数据页 |
| `src/styles.ts` | 全宽管理列表、抽屉、状态点和移动布局 |
| `tests/service.test.mjs` | 资格、容量、绑定、离线、归档、异常补偿和 kill-point 恢复 |
| `tests/http.test.mjs` | P0 新路由、同源、Content-Type；P1 probe 安全边界 |
| `tests/client-bundle.test.mjs` | 关键客户端契约；另补渲染级交互测试 |
| `docs/api*.md` | Squad/Runtime 路由和错误码 |
| `docs/operations*.md` | Runtime probe、恢复和诊断流程 |
