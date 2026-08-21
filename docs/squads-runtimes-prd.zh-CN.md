# 团队编排与运行环境产品需求文档（PRD）

> 状态：评审就绪
> 日期：2026-08-21
> 目标版本：`dsh-project-orchestrator@1.5.0`
> 输入设计：`docs/squads-runtimes-daily-workflows-design.zh-CN.md`
> 产品边界：单 Harness Host、本机 loopback Web、工作区级 Agent 与 Squad、项目级成员资格

## 1. 背景

`dsh-project-orchestrator@1.4.0` 已具备以下后端基础：

- Squad 创建、更新、归档、删除及成员合法性校验。
- Issue 对 Agent/Squad 的分配命令和 assignment revision。
- Squad Leader 委派子 Issue、并发上限、成员执行、人工审核和 Leader 唤醒。
- Runtime 创建、heartbeat、删除，以及 Agent/Project Resource 的 Runtime 引用。
- Runtime 离线派发门禁、Inbox 投影和 TaskRun 执行证据。
- 项目智能体成员池及项目范围内的 Squad 资格校验。

但当前 Web 页面主要是只读展示：

- Squad 页面没有新建、编辑、归档或项目上下文入口，空态提示用户通过 API 创建。
- Issue 详情只能选择 Agent，无法选择已有 Squad。
- Runtime 页面没有创建、编辑、绑定和诊断闭环。
- 无显式 Runtime 时显示“0 个配置/还没有 Runtime”，与“未绑定 Agent 使用本机 Host”这一真实执行语义冲突。
- `清除使用统计` 被放在 Runtime 页头，与运行环境业务无关。

结果是系统已有能力无法被普通用户使用，两个页面的低使用率主要来自产品闭环缺失，而不是业务价值已经被否定。

## 2. 产品目标

### 2.1 目标

1. 用户不调用 API 即可创建并维护 Squad 和显式 Runtime。
2. 复杂 Project Issue 可以分配给具备项目资格的 Squad，并进入现有委派与审核链路。
3. 普通单 Agent Task 不增加任何配置步骤，继续使用本机默认环境。
4. 无显式 Runtime 时正确表达本机 Harness Host 仍可执行任务。
5. Runtime 异常可以从 Inbox、项目、Agent 和 TaskRun 上下文直接定位并处理。
6. 保持 Squad/Runtime 为“更多”中的低频高级能力，不重新增加一级导航负担。
7. 所有执行者资格、状态和权限在服务端失败关闭，不能只依赖前端筛选。

### 2.2 非目标

本版本不实现：

- 远程 worker、跨机器调度或 Runtime 安装代理。
- active/active 多 Host、分布式锁或分布式事务。
- 任意 shell 终端、用户自定义探针脚本或环境变量浏览器。
- 自动生成新 Agent 或自动扩大项目成员池。
- 用 Squad 替代 Task 的明确 `agentId`。
- 自动根据 Skills 组建 Squad。
- 跨项目共享执行中的 Issue 或 TaskRun。
- 新的项目审批模型；已有 revision/hash 审批继续作为来源事实。

## 3. 用户与职责

| 用户 | 主要任务 | 需要的能力 |
|---|---|---|
| 项目负责人 | 选择项目成员、组建团队、分派复杂 Issue | 项目上下文组队、资格检查、活跃工作概览 |
| 工作区管理员 | 维护全局 Agent、Squad 和 Runtime | 创建、编辑、归档、绑定、异常处理 |
| 交付审核人 | 审核 Squad 成员产出和 Leader 汇总 | Issue、Delegation、TaskRun、Artifact 证据链 |
| 日常操作者 | 处理 Inbox 和失败恢复 | Runtime 异常深链接、重试、恢复默认环境 |

当前单机产品不增加新的账户或 RBAC 模型；操作主体继续记录为 human/agent/system Activity。

## 4. 核心产品原则

### 4.1 简单任务保持简单

如果一个 Project Task 或 Issue 由单个 Agent 完成，用户只需使用现有项目成员和 Agent 指派流程，不进入 Squad 或 Runtime 页面。

### 4.2 团队是协作结构，不是权限来源

Squad 是工作区级可复用配置。用于某项目时，Leader 和全部成员必须同时是该项目的 active 成员。

### 4.3 默认 Host 是真实执行路径

Agent 没有 `runtimeId` 时，由当前本机 Harness Host 执行。页面必须展示这一派生事实，但不创建虚假的 RuntimeRecord。

### 4.4 异常找人，不让人巡检

正常情况下不要求用户访问 Runtime 页面。离线、能力不匹配、权限不足或队列阻塞时，通过 Inbox 和业务上下文引导用户处理。

### 4.5 历史证据不可破坏

Squad 和 Runtime 一旦被 Issue、Delegation 或 TaskRun 引用，优先归档而不是物理删除，历史名称和关系必须可解析。

### 4.6 已确认的产品决策

为避免实现阶段产生不同解释，本版本固定以下语义：

1. **Leader 协作状态**：P0 不新增 Issue 状态。Leader 委派后，父 Issue 使用现有 `blocked` 状态；子 Issue 审核通过后 Delegation 进入 `completed`，系统用幂等 `continue_issue` 创建新的 Leader TaskRun，父 Issue 回到 `in_progress`。`waiting_leader` 只兼容旧记录，本版本不作为新写入目标。
2. **容量口径**：`maxParallelDelegations` 是 Squad 全局活跃委派上限，不是每个父 Issue 的独立上限。active 状态为 `queued/running`；`waiting_leader` 旧记录也占用容量，直到恢复或终止。
3. **失败策略**：P0 只执行现有单子 Issue 审核与 Leader 唤醒协议。停止全部、允许其他成员继续、全员完成再审核等结构化策略属于 P1，P0 不把自由文本误当作可执行状态机。
4. **Runtime 状态来源**：P0 的 online/offline/unstable 来自显式 heartbeat 或人工状态命令，不声称远程存活探测。P1 引入受限 probe 后，probe 结果和人工覆盖必须分开记录。
5. **Runtime 能力**：P0 的 capabilities 仅用于展示和运维判断，不参与自动调度，因为当前 Task/Issue 没有权威的 requiredCapabilities 字段。能力门禁与该字段一起在 P1 设计。
6. **恢复默认环境**：这是对 Agent/Resource 的持久化解绑，不是单次 TaskRun 覆盖，也不会由系统自动执行。Agent 绑定变化会按受影响范围使已审批 Project 失效，避免静默扩大执行权限。
7. **Runtime 生命周期**：P0 为 Runtime 增加独立 lifecycle `active/archived`；online/offline/unstable 继续表达可用性。历史 TaskRun 引用的 Runtime 只能归档，不能物理删除。
8. **Squad 与项目关系**：Squad 仍为工作区级对象，不新增项目绑定表。`sourceProjectId` 只用于创建请求的资格校验和 Activity；“可用于哪些项目”每次按当前 active memberships 实时投影。
9. **操作者权限**：当前只有本机 Harness 操作者，不新增 RBAC。所有人工 mutation 继续通过 same-origin 边界并写入 Activity/Command 审计。

## 5. 术语与来源事实

| 术语 | 定义 | 来源事实 |
|---|---|---|
| 项目智能体 | 有资格参与某项目的 active Agent | ProjectAgentMembership |
| Squad | Leader、成员、职责和协作策略 | SquadRecord |
| Delegation | Leader 到成员的一次父子 Issue 委派 | DelegationRecord |
| 本机默认环境 | 未绑定 Runtime 时的当前 Host 执行路径 | 服务端派生投影 |
| 自定义 Runtime | 显式运行配置及 heartbeat 状态 | RuntimeRecord |
| Runtime 绑定 | Agent 或 Project Resource 对 Runtime 的引用 | Agent.runtimeId / ProjectResource.runtimeId |
| 活跃工作 | 非终态 Issue、active Delegation，或 queued/waiting_local_directory/dispatched/running TaskRun；deferred 是已结束但保留关联的等待证据 | 对应持久化记录 |

## 6. 范围与优先级

### 6.1 P0：本版本必须交付

- Squad 列表、搜索、状态过滤、空态和详情。
- Squad 新建、编辑、复制、归档。
- 项目智能体页“组建团队”，自动带入 active 项目成员。
- Issue 详情支持“智能体/团队”分段指派。
- 可用 Squad 与不可用原因投影。
- Runtime 页面展示本机默认环境和自定义配置列表。
- Runtime 新建、编辑、归档。
- Agent Runtime 绑定和恢复本机默认环境。
- Project Resource Runtime 绑定和恢复默认。
- Runtime 异常的 Inbox、项目、Agent、TaskRun 深链接。
- `清除使用统计` 移到“更多 > 本地数据”。
- 桌面、移动、键盘、焦点和 reduced-motion 验收。

### 6.2 P1：紧随本版本的增强

- 受限 Runtime 环境探针。
- Runtime 能力不匹配的结构化错误和修复建议。
- Runtime 排队工作与诊断事件页签。
- Squad 模板：标准交付、代码审查、故障分析。
- Squad 成员失败策略和汇总策略的结构化字段。

### 6.3 P2：暂不承诺

- 远程 Runtime 注册、证书、agent daemon。
- 自动容量伸缩。
- 基于 Skills 的自动团队推荐。
- 跨 Host 任务迁移。

## 7. 信息架构

### 7.1 “更多”菜单

桌面和移动端新增/保留：

- 团队编排
- 运行环境
- 本地数据

展示规则：

- 无活跃委派、无 Runtime 异常时不显示数字 `0`。
- 有 `queued/running/waiting_leader` Delegation 时，团队编排行显示蓝色状态点和数量。
- 有 offline/unstable Runtime 或等待 Runtime 的 TaskRun 时，运行环境行显示黄色状态点和数量。
- P0 不把两个入口提升为一级导航。

### 7.2 上下文入口

| 来源 | 命令 | 结果 |
|---|---|---|
| 项目智能体页 | 组建团队 | 打开 Squad 新建抽屉并锁定项目上下文 |
| Issue 详情 | 分派给团队 | 显示当前项目 eligible Squad |
| Agent 详情 | 管理运行环境 | 打开当前绑定或本机默认环境 |
| Project Resource | 更改运行环境 | 打开 Runtime 选择器 |
| 项目编排条带 | 处理 Runtime | 打开异常 Runtime 详情 |
| TaskRun 详情 | 查看运行环境 | 打开该次执行捕获的 Runtime 快照 |
| Inbox | 处理运行环境 | 打开 Runtime 详情并高亮受影响对象 |

## 8. Squad 需求

### 8.1 Squad 列表

页面标题：`团队编排`

页头事实：

- active Squad 数
- 协作等待数（由 blocked Parent Issue 和 active Delegation 投影）
- archived 数
- 主命令“新建团队”

列表字段：

- 名称、描述
- Leader
- 成员数及主要职责
- 活跃 Issue/Delegation 数
- 全局并行占用/上限
- 状态
- 最近活动
- 行操作：编辑、复制、归档

筛选：

- 搜索名称、描述、Agent 名称和职责
- 状态：全部/active/archived
- 项目可用性：全部/可用于当前项目/资格不完整

### 8.2 Squad 空态

工作区 active Agent 少于两个：

- 标题：`至少需要两个 active 智能体`
- 命令：`前往智能体`

满足组队条件但无 Squad：

- 标题：`还没有团队编排`
- 正文：`当一个 Issue 需要多个项目智能体协作时再组建团队。`
- 主命令：`新建团队`

不得出现 API 创建说明。

### 8.3 新建与编辑

使用三步右侧抽屉；移动端为全屏 sheet。

第一步，基本信息：

- 名称，必填，1–160 字符。
- 描述，0–1,000 字符。
- 来源项目，从项目进入时只读显示。

第二步，Leader 与成员：

- 候选 Agent 必须 active。
- 从项目进入时只显示 active 项目成员。
- 至少选择两个不同 Agent。
- Leader 必须是已选成员。
- 每个成员可填写 Squad 内职责，1–200 字符。
- 显示 Runtime 可用性，但不在此页面修改 Runtime。

第三步，协作策略：

- Leader 指令，必填，1–20,000 字符。
- 升级策略，必填，1–10,000 字符。
- 最大并行委派，1–32。
- P0 沿用现有自由文本策略；P1 再引入结构化失败策略。

创建成功：

- 刷新 Snapshot。
- 打开新 Squad 详情。
- 从项目进入时显示“返回项目”和“分派 Issue”。
- 记录 `squad.created` Activity 及来源项目 metadata。

### 8.4 Squad 详情

页签：

- 概览
- 成员与职责
- 活跃工作
- 历史与证据

必须展示：

- Leader、成员、职责、并行上限、升级策略。
- 可用于哪些项目。
- 不可用项目及首个阻塞原因。
- 父 Issue、子 Issue、Delegation、成员 TaskRun 和审核状态。
- archived 状态下只读查看历史。

### 8.5 Squad 复制

复制内容：

- 名称追加“副本”并允许修改。
- 描述、Leader、成员、职责、指令、升级策略、并行上限。

不复制：

- Issue
- Delegation
- TaskRun
- Activity
- 项目成员资格

### 8.6 Squad 编辑与归档

编辑规则：

- active Delegation 引用的 Leader 或成员不能直接移除。
- 最大并行上限不能低于当前全局活跃委派数。
- archived Squad 不可编辑；可复制为新 Squad。
- 成员变为 archived 后，Squad 保留历史但在新分派时不可用。

归档规则：

- 有非终态 Squad Issue 或 active Delegation 时拒绝归档。
- 归档后不能接收新 Issue。
- 历史 Issue、Delegation、TaskRun 和 Artifact 保留。

### 8.7 Issue 团队指派

Issue Owner commands 使用分段控件：

- 智能体
- 团队

团队候选主列表只展示：

- Squad.status = active。
- Leader 和全部成员都是 active 项目成员。
- Leader 和成员 Agent 均 active。
- 全局活跃 Delegation 未达到 `maxParallelDelegations`。

“不可用团队”折叠区展示阻塞原因：

- 缺少项目成员
- Agent 已归档
- Squad 已归档
- 并行容量已满

Leader Runtime offline/unstable 不改变项目资格，而是在可选团队旁显示“分派后等待运行环境”警告。提交后 Leader TaskRun 保持 queued，Runtime 恢复 online 后继续派发。

选择 Squad 并提交后，继续走现有 `assign_issue/reassign_issue` Command，不允许直接 PUT assignee 字段。

## 9. Runtime 需求

### 9.1 Runtime 页面

页面标题：`运行环境`

页头事实：

- 本机 Harness Host 状态
- 自定义 Runtime 数
- 异常 Runtime 数
- 主命令“添加运行配置”

页面首段始终展示派生的“本机默认环境”：

- 当前 Host 可用状态
- 默认 Agent CLI
- 本机执行边界
- 使用该环境的 Agent 数
- 不提供删除操作

自定义 Runtime 列表字段：

- 名称、Machine ID
- online/offline/unstable
- 能力摘要
- 绑定 Agent 数
- 绑定 Project Resource 数
- queued/waiting_local_directory TaskRun 数
- 最近 heartbeat
- 行操作：编辑、标记状态、归档

不再使用“还没有 Runtime”空态。

### 9.2 新建与编辑 Runtime

字段：

- 名称，必填，1–160 字符。
- Machine ID，必填，1–240 字符。
- capabilities，最多 100 个。
- Agent CLI，可选，最多 160 字符。
- Workspace Root，可选，必须是当前用户可写的现有安全绝对目录，最多 4,096 字符；用于 worktree 输出，不允许过宽目录或符号链接根。

P0 行为：

- 创建后沿用当前服务端语义，初始 status 为 online。
- 页面明确该状态是 Host 记录，不宣称远程机器已注册。
- 名称可直接编辑；machineId、capabilities、Agent CLI、Workspace Root 有绑定或可执行 TaskRun 时不能原地修改，页面引导创建新配置并迁移绑定。
- TaskRun 创建时捕获 Runtime 名称，后续改名不改写历史展示。

P1 行为：

- 增加受限“检测环境”。
- 检测通过后更新结构化能力与最近检测时间。
- 探针不接受任意命令。

### 9.3 Agent Runtime 绑定

Agent 详情显示：

- 未绑定：`本机默认环境`
- 已绑定：Runtime 名称、状态、能力摘要

操作：

- 选择自定义 Runtime
- 恢复本机默认环境
- 打开 Runtime 详情

保护：

- Agent 有 queued/waiting_local_directory/dispatched/running TaskRun 时禁止切换。
- 如果 Agent 承担已审批 Project Task，切换 Runtime 必须明确提示受影响项目并按技术方案使对应审批失效。
- 已创建 TaskRun 的 `runtimeId` 不被回写，历史证据保持不变。

### 9.4 Project Resource Runtime 绑定

Project Resource 可选择：

- 本机默认环境
- 自定义 Runtime

保护：

- Project 正在运行时禁止更改。
- 存在活跃 WorkspaceLease 时禁止更改。
- Resource 源路径继续独立执行 canonical 安全校验；Runtime.workspaceRoot 仅作为 worktree 输出根目录，不作为源路径包含规则。
- 执行 Runtime 按统一规则确定：Agent 与 Resource 都显式绑定且 ID 不同则拒绝；否则使用 Resource 或 Agent 的显式绑定；两者都未绑定时使用本机默认环境。
- 该规则在 TaskRun 创建时捕获，旧 TaskRun/WorkspaceLease 保留原 runtimeId。

### 9.5 Runtime 状态与派发

- online：允许符合现有约束的 TaskRun 派发。
- unstable：新任务保持 queued/waiting_local_directory，等待人工处理。
- offline：新任务保持 queued/waiting_local_directory，不写成业务失败。
- Runtime 恢复 online 后触发队列重新派发。
- 未绑定 Runtime 的 Agent 使用本机默认环境。
- 不允许因 Runtime 异常自动切换到权限更高的配置。

### 9.6 Runtime 归档

P0 不再主推物理删除，页面提供归档：

- 有绑定 Agent、Project Resource 或 queued/waiting_local_directory/dispatched/running TaskRun 时拒绝；deferred 仅作为历史证据。
- 有历史 TaskRun 时允许归档并保留记录。
- archived Runtime 不可用于新绑定或新派发。
- 恢复本机默认环境必须由用户明确执行。

### 9.7 Runtime 异常闭环

异常来源：

- Runtime offline/unstable。
- Resource 绑定 Runtime 不可用。
- Agent 绑定 Runtime 不可用。
- TaskRun 等待 Runtime。

Inbox 项必须包含：

- Runtime ID
- 受影响 Agent/Resource/TaskRun
- Project/Issue 上下文
- 稳定错误码
- “处理运行环境”命令

Runtime 详情从 Inbox 打开时自动高亮对应绑定或排队工作。

## 10. 本地数据需求

新增“更多 > 本地数据”，展示：

- 最近 30 天各 feature 的 opens、meaningfulActions、errorRecoveries。
- 数据仅保存在本机且不上传的说明。
- `清除使用统计`。

规则：

- 从 Runtime 页头移除清除操作。
- 清除后不立刻为清除动作本身写入 usage。
- 清除不影响 Project、Issue、TaskRun、Activity 或 Artifact。

## 11. 状态、错误与恢复

### 11.1 稳定错误语义

| 错误码 | 用户动作 |
|---|---|
| squad-not-found | 刷新列表 |
| squad-unavailable | 选择 active Squad |
| squad-member-outside-project | 将缺少的 Agent 加入项目或选择其他 Squad |
| squad-delegation-capacity | 等待委派完成或提高上限 |
| squad-in-use / squad-active-delegations | 完成或取消活跃工作后归档 |
| runtime-not-found | 刷新 Runtime 和绑定 |
| runtime-offline | 恢复 Runtime 或显式重新绑定 |
| runtime-active-bindings / runtime-active-task-runs | 解除绑定并完成 queued/waiting_local_directory/dispatched/running TaskRun 后归档 |
| runtime-nonterminal-task-runs | 等待或停止 queued/waiting_local_directory/dispatched/running TaskRun 后切换绑定 |
| runtime-workspace-root-invalid | 选择安全的绝对 worktree 输出根目录 |
| project-membership-stale | 刷新项目成员后重试 |

### 11.2 表单恢复

- 400/409/500 均保留用户输入。
- 409 显示修复动作，不只显示服务端英文。
- 创建成功才关闭抽屉。
- 关闭未保存表单时二次确认。

## 12. 响应式与可访问性

- 桌面使用全宽列表和 520–640px 右侧抽屉。
- 移动端列表改为主信息行，行操作放三点菜单。
- 移动端抽屉改为全屏 sheet，顶部步骤和底部命令稳定。
- 所有点击目标至少 44px。
- 状态同时使用图标、文字和颜色。
- 抽屉打开后焦点进入标题，关闭后回到触发按钮。
- 键盘可完成成员搜索、选择、步骤切换和提交。
- 200% 缩放无内容遮挡。
- `prefers-reduced-motion` 下取消位移动画。
- 浅色和深色对比度达到 WCAG 2.2 AA。

## 13. 使用度量

继续使用本地 `feature_usage_daily`，不新增遥测上传。

事件定义：

| feature | meaningfulAction 示例 | errorRecovery 示例 |
|---|---|---|
| squads | 创建、编辑、复制、归档、Issue 团队指派 | 修复成员资格、容量冲突后成功 |
| runtimes | 创建、编辑、绑定、恢复默认、状态处理 | Runtime 恢复后队列继续 |

不记录：

- Squad 指令正文
- Agent persona
- Runtime 路径
- Issue 内容
- TaskRun 输出
- 用户身份

## 14. 成功指标

发布后 30 天只基于本机聚合观察：

- Squad 页面 meaningfulActions / opens 不低于 20%。
- 从项目“组建团队”进入的创建成功率不低于 80%。
- Runtime 异常从 Inbox 到恢复成功的闭环率不低于 80%。
- Squad 创建和 Runtime 创建不再依赖 API。
- 简单项目交付步骤数不增加。
- 因 Squad 成员不在项目而发生的执行期失败为 0；问题应在选择或提交阶段阻止。
- Runtime 离线不产生不可恢复的错误执行。

指标只用于本机产品判断，不自动上传或跨用户汇总。

## 15. 验收用例

### AC-SQ-01：工作区新建 Squad

给定至少两个 active Agent，用户可在团队编排页完成创建；Leader 必须在成员中，重复成员和 archived Agent 被阻止。

### AC-SQ-02：项目上下文组队

从项目智能体页进入时，只显示 active 项目成员；创建后返回项目并显示可用团队。

### AC-SQ-03：Issue 分派给 Squad

只允许 eligible 且有容量的 Squad；提交通过 Command 创建 Leader TaskRun，并记录 assignment revision。

### AC-SQ-04：成员委派与审核

Leader 可在容量内委派给非 Leader 成员；子 Issue 审核通过后只唤醒 Leader 一次。

### AC-SQ-05：编辑和归档保护

活跃 Delegation 的成员不可移除；有非终态 Issue/Delegation 时不可归档；历史证据保留。

### AC-RT-01：默认环境表达

无自定义 Runtime 时，页面显示本机默认环境可用，不显示“没有 Runtime”或 `0 Runtime` 误导空态。

### AC-RT-02：自定义 Runtime 管理

用户可在 Web 创建、编辑和归档 Runtime，不依赖 API；字段约束与服务端一致。

### AC-RT-03：Agent 绑定

用户可选择自定义 Runtime或恢复默认；活跃 TaskRun 时被阻止；受影响审批按提示失效。

### AC-RT-04：Resource 绑定

非运行项目可更新 Resource Runtime；存在 queued/waiting_local_directory/dispatched/running TaskRun 或活跃 WorkspaceLease 时被阻止。Agent/Resource 显式 Runtime 相同或只有一方显式绑定时，TaskRun 捕获该 Runtime；两者不同返回冲突且不创建 TaskRun；旧执行证据不被改写。

### AC-RT-05：离线恢复

Runtime offline/unstable 时 TaskRun 留在可恢复队列，Inbox 可直达 Runtime；恢复 online 后重新派发。

### AC-NAV-01：高级导航

正常情况下两个入口保持在“更多”；活跃委派和 Runtime 异常分别显示状态点；无状态时不显示数字 0。

### AC-DATA-01：本地数据

清除使用统计从 Runtime 页移除；本地数据页可清除统计且不影响业务记录，也不立即重记清除动作。

### AC-A11Y-01：桌面与移动

1440×1000、390×844、200% 缩放、键盘和 reduced motion 均可完成核心流程，无页面横向溢出、内容遮挡或焦点丢失。

## 16. 发布门禁

发布必须同时满足：

- PRD P0 验收用例全部通过。
- 现有项目成员、审批、Task、Issue 和 TaskRun 回归测试通过。
- 旧 Snapshot 无需新建 Runtime 即可加载并执行未绑定 Agent。
- Squad/Runtime 新 API 继续满足 loopback read 和 same-origin mutation。
- 存储备份与回滚步骤完成演练。
- 现有 Web GUI 桌面和移动截图验证通过。
- 文档、package smoke、typecheck、build 和完整测试通过。
