# dsh-project-orchestrator 从需求到交付整体改造 PRD

版本：1.1
状态：1.5.11 本地交付范围已实施
适用版本：1.5.11
关联技术方案：[整体改造技术方案](plugin-delivery-orchestration-redesign-technical-design.zh-CN.md)
关联设计：[整体优化设计方案](requirement-planning-optimization-design.zh-CN.md)

## 1. 产品结论

本次改造的目标不是把 Planner 拆出更多任务，而是把插件从“需求拆解和任务执行工具”升级为一个具备证据、门禁、恢复和交付封版能力的本地交付编排系统。

用户应当能够在同一个 Project 中完成：

```text
接入需求
  -> 固化来源和证据
  -> 识别并解决产品决策
  -> 生成并审阅计划
  -> 审批后执行
  -> 收集代码、测试和 Git 证据
  -> 人工验收
  -> 生成本地交付包
  -> 确认接收并关闭
```

最终交付物不是“31 个任务”或一个绿色进度条，而是可复现的交付包：

```text
需求包 + 决策记录 + 计划快照 + TaskRun 证据
       + 验收记录 + Git 变更 + 回滚说明
```

## 2. 背景与问题

### 2.1 当前插件已具备的能力

当前仓库已经具备较完整的执行基础：

- Project、Task、TaskRun、Run 等项目和执行对象；
- AI Planner、人工审批和 Revision/plan hash；
- Agent、Runtime、Resource、容量控制和 worktree；
- in-place 目录锁和 workspace lease；
- 测试命令、TaskAttempt、Git diff、commit、Artifact、Transcript；
- Issue 级人工 Review、Decision、Inbox 和 CLI；
- 本地 JSON 存储、Host/Web/CLI 三个入口和重启恢复基础。

这些能力说明插件不需要重写，而需要围绕同一条交付主线补齐领域契约和项目级门禁。

### 2.2 当前问题

当前需求拆解暴露出更深层的产品问题：

1. 需求批次、会议纪要和 PRD 修订之间没有统一版本语义，追加容易把旧任务和新任务机械拼接。
2. Planner 不能表达“待产品决策”，审批主要检查计划结构，不能阻止未决规则进入执行。
3. 任务来源、验收标准和执行证据没有形成完整关联，用户无法从交付结果反查需求依据。
4. Project 执行可以完成 TaskRun 和测试，但还没有独立的项目级验收和不可变交付记录。
5. Web、CLI、Service 和 Workflow 虽然共享部分能力，但产品层缺少统一的 deliveryStage、下一步动作和失败恢复入口。
6. 当前存储和状态模型没有为需求决策、计划快照、验证证据和交付封版提供专用事实 owner。

### 2.3 典型场景

以当前外部业务仓库的 PDF、截图和会议纪要为例：

- 第一批 PDF 生成基础需求和执行任务；
- 第二批会议纪要修改基本信息、权限、AI 评价和跨产品入口；
- 插件必须识别这是修订还是新增，而不是直接生成第二套任务；
- 用户需要先确认冲突字段和交互方案；
- 代码执行后需要验证页面入口、角色权限、接口数据和边界行为；
- 最终应能说明改了哪些文件、由哪个计划版本产生、测试如何通过、谁验收、如何回退。

## 3. 产品目标

### 3.1 总目标

建立从需求接入到本地交付关闭的单一主线，保证：

1. 需求来源可追溯、可复现；
2. 高影响产品决策先于计划审批和代码执行；
3. 追加、修订和替换语义明确，不机械制造重复任务；
4. 审批绑定需求、决策、计划和仓库基线快照；
5. TaskRun 的执行、重试、取消、恢复和证据均有真实状态；
6. 任务级测试和项目级验收都可以回指证据；
7. 人工 Review 明确决定是否接受交付；
8. 交付包封版后不可变，支持审阅和回滚；
9. Web、CLI、自动化和重启恢复遵循同一套业务规则；
10. 旧数据可以安全读取、迁移和恢复，不破坏历史证据。

### 3.2 成功定义

一个真实 Project 从需求接入开始，能够在不绕过审批、不虚报测试、不丢失证据的前提下完成本地交付；任何失败都能回答“卡在哪里、为什么卡、谁处理、如何恢复”。

## 4. 非目标与第一版边界

第一版明确不包含：

- 远程 Agent、分布式 Host 或多租户权限系统；
- 自动创建远程 Pull Request、远程推送、CI/CD、测试环境部署和生产发布；
- 重建已有 Agent、Squad、Runtime 或技能系统；
- 新增向量数据库、复杂工作流引擎、消息队列或第二套 AI Contract；
- 让 Planner 自动决定未冻结的业务规则；
- 删除旧需求批次、旧 TaskRun 或旧交付证据；
- 大规模视觉换肤；
- 将本地 JSON 存储直接替换为数据库。

第一版的交付模式只有 `local_review`：用户在本地工作区查看变更、测试和交付说明，并明确确认接收。

## 5. 用户与权限

| 用户角色 | 核心动作 | 不允许的动作 |
| --- | --- | --- |
| Project owner | 接入需求、解决决策、审批计划、确认交付、关闭项目 | 绕过证据和审批直接宣称交付 |
| Planner/规划 Agent | 读取需求和仓库、生成计划和诊断 | 修改业务代码、解决产品决策、推进执行状态 |
| 执行 Agent | 在批准的 TaskRun 工作区内修改代码和运行检查 | 修改需求、改变计划、越权扩大范围 |
| Reviewer | 查看 diff、测试、风险并做 Review | 以测试绿灯替代需求验收 |
| Runtime/Host | 提供本机执行能力、租约和恢复 | 伪造远程执行或发布成功 |
| CLI/自动化调用方 | 查询快照、发起已授权 Command | 绕过 Service 直接写存储 |

当前系统是本机优先、单 Host、单用户边界增强模型，不承诺企业级多租户身份认证。权限规则必须在 Host Service 重新校验，不能只依赖 Web 按钮是否可见。

## 6. 产品对象与生命周期

### 6.1 核心对象

| 对象 | 用户理解 | 事实 owner |
| --- | --- | --- |
| RequirementBundle | 一次需求来源和解析快照 | 需求接入模块 |
| RequirementDecision | 一个必须由人确认的产品/技术决策 | 决策中心 |
| PlanSnapshot | 某一版本的任务图和诊断 | 规划模块 |
| Task/Issue | 可执行或协作的工作单元 | Project/Issue 模块 |
| TaskRun | 一次具体执行尝试 | Workflow 模块 |
| VerificationEvidence | 测试、Git、报告和环境事实 | 验证模块 |
| ReviewDecision | 人工对任务或项目的接受结论 | Review 模块 |
| DeliveryRecord | 已封版的本地交付包 | 交付模块 |

### 6.2 Project 交付阶段

Project 现有 `status` 继续表示运行状态；产品增加一个正交的 `deliveryStage`：

```text
intake
  -> evidence_ready
  -> decision_pending
  -> planning
  -> approval_pending
  -> execution_ready
  -> executing
  -> verification_pending
  -> review_pending
  -> delivery_ready
  -> delivered
  -> closed
```

任意非终态可以进入 `blocked` 或 `cancelled`，但必须记录原因、owner 和恢复动作。

### 6.3 主操作规则

每个阶段只提供一个主要下一步动作：

| 阶段 | 主操作 |
| --- | --- |
| `intake` | 保存需求来源 |
| `evidence_ready` | 归一化需求 |
| `decision_pending` | 解决决策或明确排除范围 |
| `planning` | 生成/修订计划 |
| `approval_pending` | 审阅并批准计划 |
| `execution_ready` | 执行前检查 |
| `executing` | 查看运行或处理阻塞 |
| `verification_pending` | 查看验证结果 |
| `review_pending` | 通过、驳回、要求修改或豁免 |
| `delivery_ready` | 封版交付包 |
| `delivered` | 用户确认接收 |
| `closed` | 查看复盘并关闭 |

## 7. 功能需求

### 7.1 需求接入与证据固化

**FR-001 需求批次创建**

- 支持 PDF、图片、Markdown、会议纪要和用户文本；
- 每次接入生成唯一 RequirementBatch；
- 保存来源类型、定位信息、原始资源 hash、解析器版本和时间；
- 重复来源按 hash 提示复用或新建引用，不能静默复制。

**FR-002 事实与未知分离**

需求归一化结果必须区分：

- 明确事实；
- 基于事实的推断；
- 待确认问题；
- 冲突来源；
- 明确排除范围。

PDF 中“讨论后修改”“两种方案待确认”等内容必须成为未决项，不得直接成为已冻结验收标准。

**FR-003 需求可追溯**

每个需求条目至少能定位到 PDF 页码、截图引用、文本段落、会议纪要段落或用户输入记录。

### 7.2 决策中心

**FR-004 决策项生成**

从需求中识别影响范围、权限、交互、数据模型、结果可见性、评分规则、跳转方向和兼容边界等高影响问题，生成待决策项。

**FR-005 决策冻结门禁**

- 高影响决策处于 `pending` 时，Project 不能进入 `approval_pending`；
- 决策必须记录选项、选择、决定人、时间、理由和影响任务；
- 决策变化后，受影响计划和审批自动失效；
- 无法决定时可以明确排除范围，但不能静默采用 Planner 推测。

### 7.3 计划生成与修订

**FR-006 显式规划模式**

支持三种模式：

- `initial`：首次建立计划；
- `append`：确认是独立新增范围后追加；
- `revise`：修订已有需求并替换未执行计划。

缺少模式或无法判断模式时，进入 `decision_pending`，不能默认追加。

**FR-007 计划上下文完整**

Planner 输入必须包含当前需求批次、旧计划摘要、任务来源、依赖、未决项、已解决决策、仓库基线和执行约束。

**FR-008 去重与冲突诊断**

计划生成后显示：

- 高/中/低置信重复候选；
- 需求字段和权限冲突；
- 入口、状态流转和数据模型冲突；
- 跨批次依赖断裂；
- 缺少仓库证据或测试命令的任务。

诊断必须关联来源和任务，不允许只展示一段不可操作的 Planner 摘要。

**FR-009 计划快照与差异**

每个 revision 保存不可变计划快照。用户可以查看本次新增、修改、替换、废弃和未受影响任务；历史任务不得物理删除。

### 7.4 审批与执行准备

**FR-010 审批绑定**

审批至少绑定：计划 revision、plan hash、需求 digest、决策 digest、仓库 base commit、批准任务集合和执行策略。

以下任一变化使审批失效：需求来源、决策、任务图、任务分配、仓库基线或执行策略变化。

**FR-011 Preflight**

执行前检查：

- Project 状态和 deliveryStage；
- 审批是否仍有效；
- 资源、目录、分支、worktree 和 baseline；
- Agent、Runtime、容量和权限；
- 依赖任务是否完成；
- 测试命令、写入目录和网络权限是否在 allowlist 内。

检查失败时进入明确的 `blocked`，不能创建假运行。

### 7.5 执行与恢复

**FR-012 统一执行路径**

Project Task 和 Issue Task 必须使用同一套 TaskRun、Runtime、Resource、workspace lease、测试和清理语义。

**FR-013 失败分类**

失败至少分为：

- 业务阻塞；
- 依赖失败；
- 代码/测试失败；
- Runtime/Agent 故障；
- 用户取消；
- 编排器内部错误。

**FR-014 有界重试与幂等**

重试必须记录 attempt、原因、输入快照、输出证据并有上限。迟到回调不能覆盖取消、失败或新一轮 TaskRun 的终态。

**FR-015 重启恢复**

Host 重启后可以识别 active/orphaned lease、queued TaskRun、未完成 Command 和失效审批，并提供恢复或人工处理入口。

### 7.6 验证、Review 与交付

**FR-016 验证证据**

每条验收标准至少关联一个可读取的验证证据，证据包含命令、工作目录、环境、开始/结束时间、退出码、输出、报告和变更文件。

**FR-017 项目级验收矩阵**

除 Task 级测试外，还要验收需求整体的入口、权限、跨页面流程、跨产品跳转、数据一致性、空数据和异常路径。

**FR-018 人工 Review**

支持 `approve`、`request_changes`、`reject` 和 `waive`。豁免必须记录风险、责任人和后续动作。

**FR-019 本地交付封版**

只有任务终态、验证证据、Review 和基线信息齐全时，才能生成不可变 DeliveryRecord。

交付包必须包含：需求摘要、计划 revision、base/head commit、变更文件、测试结果、Artifact/Transcript、已知风险和回滚步骤。

**FR-020 交付确认与关闭**

用户确认本地交付包后 Project 才能进入 `closed`。拒绝交付时回到 Review 或修订阶段，保留旧交付记录和拒绝原因。

### 7.7 Web、CLI 和可观测性

**FR-021 主线工作台**

Project Overview、Requirement、Decision、Plan、Execution、Verification、Delivery 页面必须显示当前阶段、阻塞原因、唯一主操作和证据入口。

**FR-022 Web/CLI 一致性**

Web、CLI 和自动化调用同一 Service Command；CLI 不得提供绕过审批的隐藏写路径。

**FR-023 指标与活动**

记录需求到审批、审批到交付、决策等待、计划 revision、重复/冲突、首次通过、重试、阻塞、Review 驳回和交付失败等指标。

## 8. 关键用户流程

### 8.1 首次需求

1. 用户创建或打开 Project。
2. 上传 PDF/会议纪要或输入需求。
3. 插件保存来源快照并显示解析结果。
4. 用户查看事实、推断和未决项。
5. 用户解决高影响决策。
6. Planner 生成 PlanSnapshot 和诊断。
7. 用户审阅任务来源、依赖、冲突和风险。
8. 用户批准当前快照。
9. 插件执行 preflight 并创建 TaskRun。
10. Agent 修改隔离工作区，插件运行批准的测试命令。
11. 插件收集 Git、测试、Transcript 和 Artifact 证据。
12. 用户查看项目级验收矩阵并做 Review。
13. 插件生成本地 DeliveryRecord。
14. 用户确认接收，项目关闭。

### 8.2 会议纪要修订

1. 用户提交会议纪要并选择 `revise` 或 `append`。
2. 插件展示与当前计划的差异、重复和冲突。
3. 未选择模式或存在高影响冲突时进入 Decision Center。
4. `revise` 生成新计划并保留旧 revision；`append` 只增加确认独立范围的任务。
5. 旧的未执行审批失效，用户重新审阅和批准。

### 8.3 失败和恢复

1. Preflight、Agent、测试、依赖或清理失败时记录明确原因。
2. 可重试错误按上限重试；业务阻塞进入 Inbox/Decision。
3. Host 重启后恢复未完成记录和 workspace 状态。
4. 迟到回调只追加 stale evidence，不能改变当前 owner 的终态。
5. 用户可以继续、重新规划、取消或人工处理，不需要手工编辑 JSON。

## 9. 权限与安全要求

- 所有写操作由 Host Service 做权限和状态校验；
- 浏览器不能提交任意本机路径；
- Agent 不能修改 Project 计划和需求决策；
- Review 人不能只凭测试绿灯完成项目验收；
- 命令执行继续遵循批准命令和现有 Shell 风险边界；
- Transcript 和日志沿用现有大小限制、环境变量过滤和尽力脱敏；
- 当前能力以本机回环和单 Host 为边界，不声明多租户安全能力。

## 10. 兼容性与发布策略

### 保持不变

- 插件名 `project-orchestrator`；
- `/project-orchestrator/api`；
- 根 export、`./client`、CLI 名称；
- 现有 Project、TaskRun、Artifact、Issue Review 记录的读取；
- DSH/Cordis 注册契约和本地优先模式。

### 允许新增

- 需求批次、决策、计划快照、验证证据、项目 Review 和 DeliveryRecord 表；
- 可选的 Project/Task/Approval 字段；
- deliveryStage、诊断、失败分类和交付 API；
- 与旧数据兼容的 schema 迁移和只读恢复信息。

### 发布原则

未完成迁移恢复、P1/P2 验证、包 smoke、文档检查和本地真实交付演练前，不宣称完成改造。

## 11. 指标与目标

第一版先采集，不用指标自动改变业务状态：

| 指标 | 目标方向 |
| --- | --- |
| 需求来源完整率 | 100% 的计划任务可回指来源 |
| 高影响未决项漏拦截率 | 0 |
| 重复任务静默生成率 | 0 |
| 审批失效漏拦截率 | 0 |
| TaskRun 迟到回调覆盖终态率 | 0 |
| workspace/lock 泄漏率 | 0；无法清理时必须可发现 |
| 验收证据完整率 | 100% 的 required acceptance 有证据 |
| 无证据交付率 | 0 |
| 本地交付包封版失败率 | 持续下降并可诊断 |

## 12. MVP 验收标准

### 业务验收

- 首次 PDF 需求可以完成接入、决策、计划、审批、执行、验证、Review 和本地交付；
- 会议纪要追加不会与旧任务机械拼接；
- 高影响冲突会阻止审批和执行；
- 任务和项目验收均能查看证据；
- 用户能看到唯一下一步和失败恢复动作。

### 工程验收

- 旧存储可读取，新字段缺失不会被误判为已批准或已通过；
- Web、CLI 和 Service 使用同一状态门禁；
- TaskRun 取消、重试、重启、迟到回调和 cleanup 具备自动化测试；
- `pnpm typecheck`、`pnpm docs:check`、`pnpm test`、`pnpm build`、`pnpm smoke:package` 通过；
- 至少一次 clean Harness profile 的真实本地交付演练通过。

## 13. 分期与交付拆分

| 阶段 | 交付范围 | 通过门槛 |
| --- | --- | --- |
| P0 | 当前 Project/31 个任务快照、去重候选、旧数据恢复验证 | 不删除历史事实 |
| P1 | RequirementBundle、决策中心、PlanSnapshot 和 append/revise 语义 | 计划诊断和审批失效测试通过 |
| P2 | Preflight、统一 TaskRun 执行、失败分类和恢复 | 执行/取消/重启/lease 测试通过 |
| P3 | VerificationEvidence、验收矩阵、项目 Review 和 DeliveryRecord | 本地交付演练通过 |
| P4 | Web/CLI 主线、指标、迁移、发布和文档治理 | 完整 verify 与 package smoke 通过 |

不得把 P3 的项目级验收和交付封版推迟到最后补测试；没有 P3，插件只能证明“任务运行过”，不能证明“需求已经交付”。

## 14. 风险与开放决策

在 P0/P1 设计冻结时必须明确：

1. PDF 原始文件是否由插件复制保存，还是只保存外部资源定位和 hash；
2. `revise` 是否只允许替换未执行任务，还是允许生成 superseded 历史任务；
3. 项目 Review 是否新增独立记录，还是扩展现有 Issue Review；
4. 旧 Project 已经 `completed` 但未生成 DeliveryRecord 时如何补录；
5. 清理失败时由谁处理 orphaned worktree，是否提供 CLI 修复命令；
6. 未来接入远程 PR/部署时的权限和审批是否由独立适配器实现。

未决项不应阻塞文档评审，但必须在进入对应开发阶段前完成决定。

## 15. 需求追踪矩阵

| 需求 | 技术方案章节 | 主要代码区域 | 验证方式 |
| --- | --- | --- | --- |
| FR-001~003 | 领域模型、接入流程 | `src/types.ts`, `src/service.ts`, `src/storage.ts` | schema/service/API 测试 |
| FR-004~005 | 决策门禁 | `src/types.ts`, `src/service.ts`, `src/client.tsx` | 决策阻塞/恢复测试 |
| FR-006~009 | Planner/PlanSnapshot | `src/prompts.ts`, `src/workflow.ts`, `src/service.ts` | 初次/追加/修订/去重测试 |
| FR-010~011 | Approval/Preflight | `src/service.ts`, `src/http.ts` | stale approval/preflight 测试 |
| FR-012~015 | TaskRun/Recovery | `src/workflow.ts`, `src/service.ts` | 并发、取消、重启、lease 测试 |
| FR-016~020 | Verification/Delivery | `src/types.ts`, `src/service.ts`, `src/client.tsx` | 验收矩阵/交付包测试 |
| FR-021~023 | 工作台/CLI/指标 | `src/client.tsx`, `src/cli.ts`, `src/http.ts` | bundle、HTTP、CLI、smoke |
## 16. 智能体与团队组合改造

### 16.1 当前能力评估

当前插件已经具备以下基础：

- Agent 全局配置：角色、Persona、Skills、工具策略、Runtime、并发上限；
- ProjectAgentMembership：项目范围的成员资格、项目角色和 autoAssignable；
- Squad：Leader、成员、成员职责、指令、升级策略和并行委派上限；
- ProjectSquadBinding：Squad 与 Project 的显式绑定、成员资格同步和默认团队；
- Delegation：Leader 到成员的父子 Issue 委派、协作契约、失败升级和 Leader 唤醒；
- TaskRun/Issue Review：执行证据、人工审核和重试；
- Agent workload/Runtime：容量、在线状态和执行环境投影。

这些能力解决了“谁可以执行”和“一个复杂 Issue 如何协作”，但还没有解决完整交付链路中的团队问题。

### 16.2 主要优化空间

| 当前状态 | 缺口 | 交付风险 |
| --- | --- | --- |
| Planner 只生成任务和 suggestedAgentRole/suggestedAgentId | 没有需求域到角色/能力的明确映射 | 任务可能分给“可用但不合适”的 Agent |
| Project Task 最终绑定单个 agentId | Squad 主要在 Issue 层生效 | 计划阶段无法表达跨模块团队协作 |
| Project membership 记录资格和 autoAssignable | 没有本次交付的团队快照 | 团队配置变化后无法复现当时的责任关系 |
| Squad 有委派和 Leader 唤醒 | 子 Issue 证据没有自动汇总到项目验收 | 父 Issue 通过不等于项目需求已满足 |
| Agent 有并发上限，Squad 有并行上限 | 容量只用于运行时调度，不参与计划设计 | 计划批准后才发现无法并行或长期排队 |
| 有 Issue Review | 没有项目级 reviewer 独立性规则 | 执行 Agent 可能同时成为唯一验收人 |
| 有 Delegation Contract | 跨 Agent 上下文依赖、禁止范围和交接 digest 不统一 | 修复、重试和 Leader 汇总容易丢上下文 |
| Agent/Team 变化有局部 stale 检查 | 没有统一的 team composition digest | 已审批计划可能在团队能力变化后继续执行 |

结论：当前 Agent/Squad 设计适合“任务执行协作”，还不足以支撑“从需求到最终交付的团队责任链”。

### 16.3 产品目标

智能体和团队改造需要达到：

1. 需求分析、规划、实现、验证和交付各阶段都有明确责任角色；
2. 简单任务保持单 Agent，只有跨域、并行或需要独立审核时才使用 Squad；
3. Planner 推荐的是角色和能力，最终成员由 Project 资格、Runtime、容量和人工审批共同决定；
4. 计划审批时冻结本次交付的团队组成和任务分配；
5. Agent、Squad、Runtime 或成员资格变化能使受影响审批失效；
6. Leader、成员、测试验证者和 Reviewer 之间有结构化上下文交接；
7. Delegation 的子任务、证据和失败原因能汇总到 Project 验收；
8. 团队协作不会绕过统一 TaskRun、workspace、Review 和 DeliveryRecord；
9. 团队规模、并行度、等待时间和返工率可观测；
10. 不因为引入 Squad 而把所有任务都复杂化。

### 16.4 目标团队模式

| 模式 | 适用场景 | 组成 | 默认策略 |
| --- | --- | --- | --- |
| Single Agent | 单模块、小范围、边界清楚 | 一个实施 Agent + 人工 Review | 默认 |
| Lead + Specialists | 跨前后端、数据、权限或多个模块 | Leader + 2-4 个专业成员 | Squad Delegation |
| Implementer + Verifier | 需要独立验证或高风险修改 | 实施 Agent + 独立验证 Agent | 任务完成后进入验证 |
| Planner + Reviewer | 需求复杂、冲突多或需要技术审查 | Planner + 技术 Reviewer + 人工 owner | 只参与规划，不直接写业务代码 |
| Recovery Team | 重复失败、依赖冲突或 source of truth 不明 | 原 owner + 专家/Reviewer + 人工决策人 | 进入 blocked/decision，不自动扩容 |
| Delivery Review | 最终交付 | 执行责任人 + 独立 Reviewer + Project owner | Review 后才能封版 |

第一版不自动创建 Agent，也不根据 Skills 自动创建 Squad。推荐和自动匹配只允许在已有 Project 成员和已绑定 Squad 中进行。

### 16.5 功能需求

#### AG-001 角色与能力声明

Agent 需要有全局能力摘要；Project 成员需要有项目角色。至少区分：

- planner：只读分析和计划生成；
- lead：拆分协作、汇总成员结果、处理升级；
- implementer：修改代码和实现功能；
- verifier：运行验证、检查结果和补充测试；
- reviewer：技术审阅和风险识别；
- specialist：数据库、前端、权限、AI、数据迁移等专业领域。

角色不是权限的唯一来源，真正执行资格仍由 ProjectAgentMembership、Agent status、Runtime 和 Task assignment 共同决定。

#### AG-002 任务能力契约

每个可执行 Task 可声明：

- requiredRoles；
- requiredCapabilities；
- assignmentMode；
- 是否需要独立 Reviewer；
- 是否允许 Squad delegation；
- 冲突资源或文件范围；
- 并行组和最大并发；
- 不可修改范围和升级条件。

缺少能力契约的旧任务按 Single Agent 兼容执行，但不能宣称完成了能力匹配。

#### AG-003 团队候选与覆盖检查

Plan Review 显示：

- 每个需求域由哪些角色覆盖；
- 每个任务的候选 Agent/Squad；
- 缺少能力、Runtime 或项目资格的原因；
- Agent 和 Squad 的当前容量；
- 是否存在同一文件/资源的并行冲突；
- 是否满足独立 Review 要求。

#### AG-004 团队组成快照

批准计划时保存 Team Composition Snapshot，至少包括：

- planner、lead、reviewer；
- 每个成员的 Agent、Project role、Persona/Skills digest；
- Squad、Leader、成员、策略版本和并行上限；
- Runtime、容量和资格状态；
- 每个 Task 的 assignment policy 和 owner；
- team digest。

审批后变更成员、角色、Persona、Skills、Runtime、Squad 成员或协作策略，必须重新评估并使受影响计划失效。

#### AG-005 确定性分派

自动分派只在以下候选中进行：

1. Agent status active；
2. Project membership active；
3. membership.autoAssignable 为 true；
4. 角色和 requiredCapabilities 满足；
5. Runtime 可用且容量足够；
6. 没有冲突资源或未解决的 assignment；
7. Squad 仍 active 且成员资格完整。

评分相同时使用稳定的 Agent ID 作为 tie-breaker。审批后不得静默替换为另一个 Agent；替换必须是显式 reassign，并重新审批受影响任务。

#### AG-006 结构化上下文交接

每次 TaskRun 或 Delegation 都传递结构化上下文：

- 需求来源和 acceptanceIds；
- 当前 PlanSnapshot、Task contract 和非目标；
- 已完成依赖和验证证据；
- 工作区、base commit 和允许修改范围；
- 前一次失败及重试原因；
- 升级条件、禁止范围和 Review 要求。

Leader 汇总成员结果时必须引用 child Issue、TaskRun 和 evidence，而不是只复制自然语言总结。

#### AG-007 Delegation 证据汇总

成员完成 child Issue 后，系统将其结果映射到：

~~~text
child Issue
  -> Delegation
  -> child TaskRun
  -> Artifact/Transcript/VerificationEvidence
  -> parent Issue
  -> Project acceptance matrix
~~~

父 Issue 被批准只能表示协作单元完成；项目进入 delivery_ready 还必须满足项目级 acceptance matrix。

#### AG-008 Review 独立性

默认规则：

- 实施 Agent 不能作为同一变更的唯一最终 Reviewer；
- Leader 可以做技术汇总，但不能代替 Project owner 的最终交付确认；
- waive 必须由人工记录风险、责任人和原因；
- 低风险单 Agent 场景允许同一 Agent 提交自检证据，但仍需要人工 Review。

#### AG-009 容量和并行计划

Planner/Plan Review 需要在计划层估计：

- Agent maxConcurrency；
- Squad maxParallelDelegations；
- Runtime 可用性；
- 任务资源冲突；
- 预计排队和关键路径。

容量不足时可以排队，但必须显式展示，不得在审批页显示为“可立即执行”。

#### AG-010 失败升级

以下情况进入人工 Decision/Inbox，不自动增加成员或创建新 Squad：

- 同一 TaskRun 超过自动修复上限；
- 需求或接口冲突；
- Leader 与成员结果互相矛盾；
- 验证不可用；
- 需要扩大文件、权限或数据范围；
- 当前团队没有满足能力的成员；
- 交付 Review 驳回。

#### AG-011 成员变化与审批失效

以下变化必须使相关任务或整个计划重新评估：

- Task owner 被移出 Project；
- Agent 归档或 Runtime 不可用；
- Squad Leader/成员变化；
- Project role、autoAssignable、Persona、Skills 或协作策略变化；
- 任务从 Single Agent 改为 Squad delegation，或反之。

#### AG-012 团队责任可追溯

交付包需要展示：

- 谁负责需求分析和计划；
- 谁执行每个 Task；
- 哪些 Task 由 Squad/Delegation 完成；
- 谁运行验证；
- 谁做 Review；
- 哪些结果被重试、替换、豁免或升级；
- 每个责任节点对应的 digest、TaskRun、Artifact 和 Activity。

### 16.6 工作台要求

新增或扩展 Project Team/Team Plan 区域，显示：

- 当前交付阶段的责任角色；
- Planner、Lead、Implementer、Verifier、Reviewer；
- 每个 Agent 的资格、Runtime、容量和当前任务；
- Squad 的可用性、成员缺口、委派占用和升级状态；
- 需求域-角色-任务-证据覆盖矩阵；
- 团队配置变化导致的审批失效原因。

交互原则：

- 简单任务不强制进入团队配置；
- 从 Project 进入组建团队时只展示 active 项目成员；
- 不可用团队显示原因而不是隐藏；
- 任务重新分派、团队绑定和策略变化都要求预览影响；
- 不把“有成员”误显示为“具备交付能力”。

### 16.7 团队指标

第一版先记录：

- Single Agent 与 Squad 任务比例；
- Agent/Squad 推荐后人工修改率；
- 团队能力缺口率；
- TaskRun 等待 Runtime/容量的时长；
- Delegation 完成率、升级率、Leader 重启率；
- child evidence 汇总完整率；
- 实施 Agent 自审率和 Review 驳回率；
- 团队协作导致的返工次数；
- 同一文件/资源并行冲突次数；
- 每个 Agent 的利用率和阻塞时长。

### 16.8 第一版验收标准

- 简单任务默认由单个 eligible Agent 执行；
- 跨域计划可以展示并审批 Lead/Specialist/Verifier/Reviewer 组合；
- 计划审批后保存 team digest 和任务 assignment policy；
- Agent/Squad/Runtime/成员资格变化能阻止过期计划继续执行；
- Delegation 子任务的证据能够进入项目验收矩阵；
- 实施 Agent 不能静默成为唯一最终 Reviewer；
- 容量不足、能力缺失和成员缺口显示为可处理阻塞；
- 团队协作失败不会绕过 TaskRun、Artifact、Transcript、Review 和 DeliveryRecord。

## 17. 智能体与团队实施分期

| 阶段 | 交付范围 | 依赖 |
| --- | --- | --- |
| T0 | 盘点现有 Agent、Project membership、Squad、Delegation 和 Runtime 关系 | 当前 Project 快照 |
| T1 | Agent capability/role、Task assignment policy、Team Composition Snapshot | PlanSnapshot |
| T2 | 确定性候选、容量/冲突检查、审批失效和显式 reassign | Approval/Preflight |
| T3 | Delegation evidence rollup、Verifier/Reviewer 门禁、ProjectReview/DeliveryRecord 最小本地闭环 | VerificationEvidence |
| T4 | 完整 acceptance matrix、Team Plan UI、指标、恢复演练、冲突调度和交付回放 | DeliveryRecord |

智能体和团队优化不能独立于需求、计划和交付改造并行上线；T1 至少要与 PlanSnapshot 和审批 digest 同步，否则团队变化无法成为可靠的交付事实。

## 18. 团队改造已冻结决策

T1～T4 已按以下契约实现，不再作为开放问题：

1. `capabilities` 属于全局 `AgentRecord`；Project membership 只保存项目角色、资格和来源，不维护第二份能力真相。
2. 第一版资格匹配只使用显式 `capabilities`。Skills/Persona 进入 Prompt 和团队 digest，但 Skill 文本不能提升执行权限或绕过能力门禁。
3. 所有 Project 都必须经过人工 Project Review；high/critical Task、Delegation child 和声明独立 Review 的 Task 强制 reviewer 与 implementer 不同。只有字段完整的人工 waiver 可以例外。
4. Squad 不替代 Project Task owner；第一版继续通过 `Issue -> Delegation -> child TaskRun` 执行，证据再汇总到父 Task 和 Acceptance。
5. 纯容量不足允许批准后排队，并在 Team Plan 显示等待投影；成员、能力、绑定或 Runtime 不可用属于资格失败，会阻止审批/执行。
6. Persona/Skills 变化只使实际引用该 Agent 的已批准 Project 失效，不影响无关 Project；历史快照保持只读。
7. low/medium 风险允许同一 Agent 兼任 Lead/Verifier，但最终仍需人工 Project Review；high/critical 风险禁止 implementer 成为唯一 Reviewer。Verifier 角色不自动获得 Review 权限。

补充冻结的范围契约：非空 `allowedScope`/`forbiddenScope` 必须由 Git-backed workspace 提供可验证证据。执行器以 TaskRun 开始时的工作区状态为基线，只归因本次运行实际改变的文件；越界或证据不可用时不运行批准的测试命令，TaskRun/Task 进入失败/阻塞并创建幂等 Decision。

## 19. 第一批实施验收记录

本批次已将团队组合从“可配置的 Squad 能力”推进为“计划可追踪的交付事实”：

- Agent 能力、Task 分派策略、Project 团队快照和 team/assignment digest 已进入持久化记录；
- 审批和启动执行都会重新校验当前团队、成员资格、角色、能力和独立 Reviewer 条件；
- Web、HTTP 和 CLI 都可以读取同一份 team preflight，不再各自推导候选团队；
- Delegation 结果会关联 child TaskRun 的 Artifact evidence 和 Reviewer，成员不能审批自己的交付；失败委派可显式重试并保留原 owner、父 TaskRun 和 `retryOf` 责任链；重启发现无效 active Delegation 时会转为 escalated，并幂等创建一条 Decision/Inbox 待办；
- 团队影响预览会展示受影响 Task、Acceptance、当前 PlanSnapshot/Approval、active Issue/Delegation 和活动执行保护；不再只返回 ID；
- validate、reassign、bind/sync Squad、解决团队阻塞以及 Delegation retry/stop 等团队变更统一写入 `CommandRecord`，复用幂等键、审计状态和真实失败语义，不存在 Web/CLI 绕过 Service owner 的隐藏写路径；
- 任务风险分为 low/medium/high/critical，高/关键风险在 preflight、执行和最终 Review 都强制独立 Reviewer；手动任务编辑可显式设置风险等级。
- 团队指标提供全局和项目级只读投影；`TaskRun.waitStartedAt/waitDurationsMs/waitCounts` 记录 Runtime、容量、并行组、资源冲突和 workspace 等待，`startedAt/completedAt/durationMs` 与后续 retry/resume 事实用于计算 Agent 利用率和阻塞时长；`assignmentSource` 区分 `planner_recommendation`、`automatic_match` 和 `manual`，人工 reassign Activity 只对推荐分派计算修改率；返工以 retry TaskRun、Review 驳回和显式 reassign 等可审计事实计数，不从自然语言推测。
- Delegation 没有 Artifact 或通过测试证据时不能通过 child Review；项目执行完成先进入 review，ProjectReview 通过后才进入 delivery_ready；驳回会创建 Decision/Inbox 而不是覆盖同 revision Review，waiver 会逐条落到 Acceptance；任一关联写入失败时补偿恢复 Review、Acceptance 和 Project 的原状态；
- `DeliveryRecord.responsibilityChain` 固化 planner、lead、任务 owner、Delegation、验证者、Reviewer、waiver 和 Project owner，最终交付可以从任务执行追溯到独立 Review 与用户确认。

### 19.1 AG-001～AG-012 实施证据矩阵

| 需求 | 已落地的 source of truth / 行为 | 自动化证据 |
| --- | --- | --- |
| AG-001 角色与能力声明 | `AgentRecord.capabilities`、`ProjectAgentMembership.projectRole/autoAssignable/status` 共同决定资格，角色不替代成员资格和 Runtime 门禁 | `project team plan snapshots active members, roles, capabilities, and preflight blockers`；`task assignment policy filters capabilities and independent review ownership` |
| AG-002 任务能力契约 | `TaskAssignmentPolicy` 持久化 requiredRoles、requiredCapabilities、assignmentMode、Review、Squad、conflict/parallel/allowed/forbidden scope 和升级条件，并进入 PlanSnapshot/Task/Prompt | `task assignment policy filters capabilities and independent review ownership`；`Project Task compiler includes approved dependency evidence and stable digests` |
| AG-003 团队候选与覆盖检查 | `getProjectAgentCandidates` 逐 Task 显式输出 Agent 与 Squad 候选、资格原因、Runtime/容量和稳定排序；`getProjectTeamPlan` 输出冲突、关键路径及 `RequirementItem -> roles -> Task -> AcceptanceCriterion -> evidence` 覆盖矩阵 | `team candidates apply membership, capability, runtime, and capacity rules with stable ordering`；`squad delegation remains eligible when at least one allowed Squad is available`；`team plan projects requirement domain, role, task, acceptance, and evidence coverage directly` |
| AG-004 团队组成快照 | `TeamCompositionSnapshot` 冻结成员、Persona/Skills digest、Runtime、容量策略、Squad 默认关系/策略和 task assignment，`teamDigest` 进入审批与执行门禁 | `team composition digest ignores live slots but tracks capacity policy and runtime state`；`approved team snapshots invalidate when an unassigned project member is added or removed` |
| AG-005 确定性分派 | 候选按 active membership、autoAssignable、角色/能力、Runtime、容量和稳定 Agent ID 过滤排序；显式 reassign 递增 assignment revision、清理旧验证并失效审批 | `materializeTasks prefers exact roles, then capacity, then stable Agent id`；`batch task assignment is atomic and increments project revision once` |
| AG-006 结构化上下文交接 | Task/Issue Prompt Compiler 固化需求、验收、依赖证据、workspace、digest、失败/恢复和 Delegation contract；执行器再以 TaskRun Git 基线强制校验 allowed/forbidden scope，不能仅依赖 Prompt 自律 | `Prompt Compiler emits deterministic ordered Leader prompt evidence`；`Project Task compiler includes approved dependency evidence and stable digests`；`Project Task scope gate attributes each worktree change to its TaskRun`；`Project Task scope expansion fails before verification and creates one durable Decision` |
| AG-007 Delegation 证据汇总 | child Issue/TaskRun 的 Artifact、测试和 Review 生成 `VerificationEvidence`，回写 parent acceptance；缺证据失败关闭。`parentAssignmentRevision` 阻止过期 child 结果覆盖已重派或终态 parent | `Squad delegation creates a child run and approved review wakes the leader exactly once`；`stale delegated child Review cannot publish evidence or wake a reassigned or terminal parent` |
| AG-008 Review 独立性 | high/critical Task、Delegation child 和 ProjectReview 复用独立 Reviewer 门禁；人工 waiver 必须保存 reason、owner、risk 和 follow-up | `high-risk tasks require an independent reviewer even without an explicit task flag`；`Project Review enforces independent human waiver details and persists the audit record` |
| AG-009 容量和并行计划 | Team Plan 保存容量观察、关键路径和等待投影；claim 层校验 Agent 并发、parallel group、conflict key 和 workspace；TaskRun 持久化等待次数/时长 | `parallel groups enforce their shared maxParallel during TaskRun claim`；`team collaboration metrics derive only observable assignment, delegation, evidence, and blocking facts` |
| AG-010 失败升级 | 能力缺口、范围越界/证据不可用、重复失败、Review 驳回和无效 Delegation 进入持久化 Decision/Inbox；不会自动创建 Agent/Squad，恢复和重试通过显式命令 | `team plan projects critical path and team blockers into Decisions without auto-assignment`；`Project Task with an enforced scope fails closed when Git evidence is unavailable`；`automatic Task repair exhaustion creates one durable retry Decision`；`startup escalates an invalid Delegation into one durable Decision and Inbox item` |
| AG-011 成员变化与审批失效 | Agent/Project membership、关联 Runtime、已绑定 Squad 的成员/策略/default/bind/unbind 变化只使受影响且已审批 Project 回到 `awaiting_approval`；初始建队保持 revision-neutral | `Runtime unavailability invalidates only approved Projects that use that Runtime`；`Squad bind, default, and unbind changes invalidate approved teams but initial binding is revision-neutral` |
| AG-012 团队责任可追溯 | `DeliveryRecord.responsibilityChain` 固化任务/TaskRun、Delegation、验证、Review、retry、reassign、escalation、waiver 和 Project owner，DeliveryRecord 创建后不可变 | `execution completes only after independent commands pass`；`Project Review enforces independent human waiver details and persists the audit record` |

该矩阵的环境证据已于 2026-08-25 在隔离 clean Harness profile 回收：真实三页 PDF 完成 PDF.js 文字提取和浏览器 Canvas/JPEG 页 1/2/3 渲染，真实 GitHub 仓库 clone 的 HEAD 与 `origin/main` 一致；31 条旧 Task 幂等迁移为 1 个 parent Issue 和 31 个 child Issue，状态与 membership/source/legacy Decision 均保持；物理存储被截断为 37 字节后 Host 明确拒绝启动，恢复备份后两次启动及 API 验收通过且存储哈希不变。多 child Delegation 自动化覆盖 3 个并发 child、容量拒绝、部分失败、乱序 Review、retry、Leader 唤醒前崩溃和两次恢复，最终只有 1 个 Leader continuation 且保留 4 条 Review evidence。仓库 `pnpm run verify` 的 189 个测试、类型、文档、构建和包 smoke 全部通过。

浏览器桌面 1440x1000 与移动端 390x844 均无页面级横向溢出和文本裁切，业务页面 console 为 0 error/0 warning。PDF UI 请求实际携带 3 个视觉页；当前配置的 `deepseek-official/deepseek-v4-flash` 不支持图片输入，因此 API 按契约返回 `422 model-image-input-unsupported` 并在 UI 显式提示。部署环境若要求在 UI 内完成视觉归纳，必须配置支持图片输入的模型；不得把该 422 降级成成功。

这不是远程发布系统：RequirementBundle/RequirementItem/RequirementDecision/AcceptanceCriterion 已形成来源、决策和验收矩阵切片；PlanSnapshot、VerificationEvidence、ProjectReview、DeliveryRecord 独立表支持“执行完成 → 独立项目 Review → 用户确认 delivered → 显式 close”的本地闭环。执行层已支持拓扑就绪并发、Agent/目录/conflict key 三重约束和重启回收。当前实现仍不包含远程 PR、部署、生产发布或生产数据变更能力，边界以技术方案第 27 节为准。
