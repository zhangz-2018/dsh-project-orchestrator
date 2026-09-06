# 需求识别、代码感知拆解与 Agent 分派改进方案

状态：审查后的改进提案，尚未实施

审查对象：

- [`evidence-grounded-task-planning-improvement-design.zh-CN.md`](./evidence-grounded-task-planning-improvement-design.zh-CN.md)
- [`evidence-grounded-task-planning-technical-design.zh-CN.md`](./evidence-grounded-task-planning-technical-design.zh-CN.md)

审查目标：判断当前方案能否真正满足以下预期，并提出优先级明确、可落地、可验证的改进方案：

> 正确识别需求，结合需求和目标项目的代码逻辑拆出正确任务，把任务分配给合适的 Agent，并且实际好用。

调研说明：外部项目部分优先依据项目官方仓库和官方文档。当前会话的在线 `web_search` 服务缺少 API key，因此没有把未核验的网页搜索结果当作事实；实现前应再次核验外部项目当前版本的细节。原设计中已有的官方链接作为本方案的初步来源，并在文末集中列出。

## 1. 结论

### 1.1 当前方案不能直接声称满足预期

结论不是“方向错误”，而是“目标架构正确，产品闭环尚未成立”。

| 维度 | 当前判断 | 原因 |
| --- | --- | --- |
| 需求结构化 | 部分满足 | V2 已有 Requirement、Acceptance、Decision 和 sourceRef，但来源清单仍主要依赖“验收/问题”章节，普通业务规则、权限、状态和非功能约束可能漏掉 |
| 代码理解 | 尚未满足 | V2 的 `repositoryEvidence` 仍由 Planner 自报，存在路径并不等于读过路径，更不等于找对 owner、写路径、读路径和失败路径 |
| 任务拆解 | 尚未证明 | V2 可以把大量 Acceptance 挂到少数泛任务上，只要结构覆盖满足校验；没有真实代码影响链和任务可执行性评测就不能认为拆得正确 |
| Agent 分派 | 结构上部分满足，语义上未证明 | V2 能校验角色、能力、Runtime 和容量，但自由字符串 capability、角色匹配和容量排序不能证明“最适合该代码上下文” |
| 好用性 | 尚未满足 | 当前主要证明 schema、状态和门禁正确，没有证明用户首次看到的计划可理解、可纠正、可执行，或 Agent 能按任务完成交付 |
| 交付闭环 | 方向正确但范围偏大 | Convergence 和 canonical integration 能补上“TaskRun 成功不等于交付完成”，但不应该阻塞首个可用纵切的验证 |

### 1.2 对两份设计的总体评分

这是工程审查判断，不是客观质量分数：

- 问题识别准确度：`8/10`。对 V2 的主要根因判断基本正确，尤其是 Planner 自报证据、错误 owner、能力绕过和 false-ready。
- 架构完整度：`9/10`。source、scenario、policy、repository、binding、task、assignment、run、integration、convergence 链路完整。
- 首版可交付性：`4/10`。一次性增加大量 record、provider、stage、API、UI 和迁移，容易在完成大部分基础设施后仍无法回答“任务是否真的更正确”。
- 用户可用性设计：`5/10`。诊断内容很完整，但默认路径过重，用户确认和纠正成本、Agent 接手前的任务验证、反馈闭环还不够明确。
- 语义质量证据：`3/10`。已经设计了 Gold、mutation 和真实模型重复运行，但尚未提供可运行纵切，且指标偏离用户完成目标。

### 1.3 最重要的改进原则

1. **先做可运行纵切，再扩展完整 V3。** 首个版本只需要证明一个支持栈中，真实需求能稳定绑定到正确代码 owner，生成可执行任务，分派后 Agent 能接手并完成验证。
2. **区分“证据可用”“模型读过”“结论被证据支持”。** 读取 evidence ID 只能证明工具访问，不足以证明模型理解正确；需要保存 claim/evidence/rationale 关系并由 Reviewer 检查。
3. **任务必须是 Agent 可接手的交付合同。** 仅有 title、description、scope、command 和引用关系不够，还要有输入上下文、非目标、修改边界、输出物、验证步骤、升级条件和接手检查结果。
4. **分派先满足交付，再谈排序。** capability claim、项目代码亲和、Runtime、仓库访问和容量应分层；无合格 owner 时阻塞，有合格 owner 时优先选择最接近绑定 owner 的 Agent，但不能为了“有候选”降低任务要求。
5. **人只确认高影响不确定性。** 不能让用户逐条审核几十个正常判断；应把冲突、owner 歧义、范围变化、不可验证场景和能力缺口压缩成可操作的确认项。
6. **用结果反馈改进规划。** 人工修改、Agent 退回、任务拆分/合并、执行失败和 Convergence finding 必须反馈到评测集、规则和提示版本，而不是只记录审计日志。
7. **成功标准以用户完成任务为主。** coverage、digest 和 schema 是必要条件，不是“好用”的充分条件。

## 2. 对当前实现和两份设计的核对

### 2.1 V2 的真实能力边界

当前代码与原设计的诊断一致：

- `buildRequirementSourceManifest` 在 [`src/workflow.ts`](../src/workflow.ts#L302) 主要根据验收和问题章节决定 `requiredDisposition`。普通 paragraph、功能章节中的业务规则、权限和状态语句不一定进入强制清单。
- `parseGeneratedPlanV2` 在 [`src/workflow.ts`](../src/workflow.ts#L436) 校验的是 Planner 自报的 `verifiedCommands`、任务引用、能力目录和覆盖关系；它没有验证路径来自真实快照、模型是否读取过证据或 owner 是否正确。
- `GeneratedPlanV2Schema` 在 [`src/types.ts`](../src/types.ts#L1166) 仍允许模型返回 `repositoryEvidence`、`requiredRoles` 和 `requiredCapabilities`。这些字段在 V2 中是模型输出，不是系统推导事实。
- `materializeTasksV2` 在 [`src/workflow.ts`](../src/workflow.ts#L554) 根据 V2 任务策略和 Agent 目录选择候选，主要使用角色、能力、Runtime 和可用槽位，不能证明代码领域亲和或历史交付适配度。
- `decompose` 在 [`src/service.ts`](../src/service.ts#L4666) 仍是“需求分析 -> 需求 Review -> Planner -> 任务物化 -> 写入”的 V2 流程，尚未拥有 V3 的 Repository Snapshot、Code Binding、WorkPackage、CapabilityRequirement 和独立 Plan Review。
- 现有 `package.json` 的 `test`、`verify`、`docs:check` 和 `smoke:package` 能证明插件工程自身质量，但不能证明 Planner 对任意目标项目的语义质量。

因此，原设计中“V2 是结构化契约基础、V3 才负责代码感知和语义质量”的判断是正确的。当前不能把设计文档中定义的 V3 能力描述成已经存在的产品能力。

### 2.2 两份设计做得好的地方

以下原则应该保留：

- Requirement、AcceptanceCriterion 和 Decision 独立持久化，不用 Task 反向代替原始需求。
- Acceptance 原文和可执行 AcceptanceScenario 分离，兼顾保真和验证。
- Repository Snapshot 由 Service/provider 生成，Planner 只能引用证据 ID。
- Binding 先于 Task，避免按 PRD 标题或目录名称直接猜任务。
- WorkPackage -> DeliveryTask 两级拆解，避免“每条验收一个任务”和“全部需求两个任务”两个极端。
- Capability 资格、Runtime 健康、容量和 Squad 路由分层表达。
- DeliveryTask、TaskRun、VerificationEvidence、Integration 和 Convergence 分离，历史不可覆盖。
- V3 失败时真实 `blocked/failed`，不静默回退 V2 生成 false-ready plan。
- 通过 Shadow、Gold、mutation、真实模型重复运行和浏览器回归进行发布前验证。

## 3. 关键问题与优先级

### P0：必须先修复，否则无法判断是否好用

#### P0-1 缺少“可运行纵切”

原设计从 P0 到 P6 覆盖了完整目标架构，但 P0 主要是建立 Gold 和 baseline，P1-P5 分别建设大量基础设施。问题是：完成 P1 或 P2 后，仍不能让用户从一个真实 PRD 得到可执行任务并完成一次交付；团队可能花费很长时间实现表、provider 和 digest，却没有早期价值信号。

**改进：**新增一个 `V3 Vertical Slice`，顺序固定为：

```text
真实 Markdown brief
  -> 规范性 anchor inventory
  -> Requirement/Scenario
  -> TypeScript/Nuxt/Prisma repository snapshot
  -> evidence claim + code binding
  -> 2~8 个可执行 DeliveryTask
  -> preflight 接手检查
  -> assignment
  -> TaskRun
  -> verification
  -> 人工确认结果
```

该纵切可先以内存或现有 local storage 的兼容表实现，不要求第一天完成全部 V3 表。只要 source、evidence、binding、task、assignment 和 run 之间的关键引用闭合，且能在 `lscity-nuxt` 上跑通一次，就有可验证价值。

#### P0-2 没有 Agent 接手前的可执行性检查

当前设计把“任务生成”和“任务执行”连接起来，但没有一个明确的 `Task Handoff / Preflight` 阶段。一个任务即使引用了正确文件，也可能存在：

- Agent 不知道从哪个入口开始；
- 任务描述与实际代码 API 不一致；
- 任务范围过大，无法在一次上下文内完成；
- 验证命令能运行但不能证明验收结果；
- 任务缺少期望产物或失败时的升级方式；
- 任务依赖写在自然语言中，没有可执行前置条件。

**改进：**在 Assignment 前增加轻量 `TaskPreflight`。由候选 Agent 或独立 Planner/Reviewer 返回结构化结果：

```ts
interface TaskPreflight {
  taskId: string
  agentId: string
  status: 'accepted' | 'needs_clarification' | 'rejected'
  understoodObjective: string
  startingEvidenceIds: string[]
  expectedChangeSurfaces: string[]
  plannedVerificationIds: string[]
  missingFacts: string[]
  estimatedComplexity: 'small' | 'medium' | 'large'
  escalationReason?: string
}
```

规则：

- `accepted` 才能进入执行队列；
- `needs_clarification` 创建用户可处理的 Decision，不让 Agent 自行扩大范围；
- `rejected` 不等于 Agent 不合格，可能意味着任务边界或能力映射错误；
- 首版不要求每个候选都试跑，只对最终候选执行一次低成本接手检查；
- 高风险任务必须由实现 Agent 之外的 Reviewer 做第二次 preflight 或 plan review。

这个阶段直接衡量“分派是否合适”，比仅比较 capability 字符串更接近用户预期。

#### P0-3 Evidence 访问审计不等于理解正确

原技术设计要求 evidence 必须被 Agent read access 过，这是必要的安全和可追溯条件，但仍可能出现：模型读取了正确文件，却把同名组件当成状态 owner，或忽略了另一个 consumer。

**改进：**加入 `EvidenceClaim`，把模型结论拆成可审查的最小断言：

```ts
interface EvidenceClaim {
  id: string
  subjectType: 'requirement' | 'scenario' | 'binding' | 'task'
  subjectId: string
  claimType:
    | 'current_owner'
    | 'source_of_truth'
    | 'write_path'
    | 'read_path'
    | 'state_transition'
    | 'permission_guard'
    | 'failure_path'
    | 'consumer'
    | 'test_surface'
    | 'scope_boundary'
  statement: string
  supportingEvidenceIds: string[]
  contradictingEvidenceIds: string[]
  confidence: 'high' | 'medium' | 'low'
  status: 'proposed' | 'confirmed' | 'disputed' | 'rejected'
}
```

确定性规则只能检查引用闭包，独立 Reviewer 需要逐项检查关键 claim。关键 claim 没有 supporting evidence、同时存在 contradicting evidence 或 confidence 过低时，不能生成 ready binding。

#### P0-4 “任务分配正确”的验收标准不够贴近结果

现有指标包含 expected-owner/top-k、结构资格、score provenance 和 false-ready，这些指标有价值，但还不够回答：

- Agent 是否接受了任务？
- Agent 是否在不请求大范围澄清的情况下开始？
- 首次运行是否完成？
- 任务是否因范围不清而返工？
- 任务完成后是否产生计划外变更？
- 人工是否需要重写任务才能执行？

**改进：**新增用户结果指标：

| 指标 | 定义 | 首版目标 |
| --- | --- | --- |
| `first_pass_task_acceptance` | 最终 Agent preflight 直接 accepted 的任务 / 分派任务 | `>= 85%` |
| `task_start_without_clarification` | 不产生 scope/owner/requirement clarification 即开始的任务 / 开始任务 | `>= 80%` |
| `first_run_completion` | 首次 TaskRun 通过其完成条件的任务 / 执行任务 | 建 baseline，稳定期 `>= 70%` |
| `human_task_rewrite_ratio` | 人工修改 objective/scope/verification 的任务 / 已审阅任务 | `<= 20%` |
| `task_rework_ratio` | 因任务边界或 owner 错误产生新 revision 的任务 / 已完成任务 | `<= 15%` |
| `assignment_rejection_ratio` | 最终 Agent preflight rejected 的分派 / 分派总数 | `<= 10%` |
| `time_to_usable_plan` | 提交 brief 到用户可以批准的计划的 P50/P95 | 先建立 baseline，再设产品 SLO |
| `false_ready` | 应阻塞却 ready 的 case | `0` |
| `false_converged` | 仍有 blocking gap 却 delivered 的 case | `0` |

`first_run_completion` 不能单独作为质量结论，因为任务可能被错误拆小；必须与 binding recall、人工修改比例和 convergence 一起看。

#### P0-5 原技术设计存在实施前必须统一的契约冲突

这些问题不否定 V3 架构，但如果不先形成唯一契约，代码会在阶段顺序、Schema 和持久化语义之间来回返工：

| 冲突 | 当前表现 | 统一决策 |
| --- | --- | --- |
| Source Profile 与 Manifest 顺序 | 状态机先 `source_manifest` 后 `source_validation`，但 Manifest Record 又要求 `sourceProfileIds/sourceCompletenessDigest` | 改为 `source_ingest -> source_profile -> source_manifest`；只有 profile 确认输入边界后才冻结 anchor manifest |
| Requirement Review 无持久化事实 | Approval gate 要求 approved Requirement Review，但 `PlanningOperationRecord` 没有 `requirementReviewId`，统一 Review Record 只定义 `binding/plan` | `PlanningReviewRecord.kind` 增加 `requirement`，Operation 和 PlanSnapshot 保存 requirement review ID/digest |
| Planner Schema 与校验规则不闭合 | 技术设计的 `GeneratedPlanV3.tasks` 没有 `completionCriteria` 和逐 Scenario verification contract，后续 Service 校验却要求两者 | 把 `completionCriteria`、`verification[]`、`expectedArtifacts` 和 `escalationConditions` 放入唯一 Planner Schema，禁止仅在文字章节中要求 |
| Capability 推导与 Plan Review 顺序 | 状态机先 `plan_review` 后 `capability_snapshot`，但 Plan Review 又要检查 Service-derived CapabilityRequirement grounding | 拆成 `capability_requirement_derivation` 和 `capability_catalog_snapshot`：前者在 reference mapping 后、Plan Review 前；后者在 Plan Review 后用于候选资格和分派 |
| Proposal 与可执行 Task 混用 | Operation 在 commit 前已有 `taskIds`、CapabilityRequirement 和 AssignmentDecision，但设计又要求 blocked proposal 不产生 executable Task | 增加只读 `TaskProposal/AssignmentDraft` 或统一 proposal pack；final commit 才物化 `DeliveryTask/AssignmentDecision`，Operation 在此之前保存 proposal IDs，不保存 executable task IDs |
| Delivery 状态遗漏 integrating | 一处交付流写为 `approved -> executing -> verifying -> final_repository_snapshot`，其他章节要求先 canonical integration | 唯一交付流固定为 `executing -> verifying -> integrating -> final_repository_snapshot -> convergence_reviewing` |
| waiting capacity 的审批语义不一致 | 总体设计把“是否可预批准”留作产品规则，技术设计直接允许审批 | 明确为：计划可以批准，执行状态为 `waiting_capacity/waiting_runtime`；`blocked_runtime/blocked_access/no_eligible_owner` 不可批准，并在 API 中不用模糊 `ready` 布尔值表达 |
| 持久化 ID 禁止范围含糊 | Planner 允许引用 Evidence/Policy 冻结 ID，却又笼统禁止“数据库持久化 ID” | 明确禁止 Planner 生成 Requirement/Task/Agent 等业务记录 ID；允许 Service 注入且只读引用的 snapshot-scoped Evidence/Policy/Command ID |

实施 Phase 1 前应先发布一份短小的 `Planning Contract V3 canonical schema`，只包含唯一阶段图、Planner/Reviewer Schema、物化时序和状态语义。两份长设计继续作为 rationale 和测试目录，不能同时充当互有差异的可执行规范。

### P1：应在首个纵切中解决

#### P1-1 V3 对首版过于庞大，事实对象应分层

原设计同时引入 SourceProfile、Manifest、Scenario、Policy、RepositorySnapshot、StackProfile、Evidence、Command、Binding、Review、WorkPackage、ReferenceMap、CapabilityDefinition、Claim、Catalog、Affinity、Assignment、Integration、Convergence 等对象。这些对象分别合理，但全部首发会产生三个风险：

- schema 和迁移成本超过语义功能成本；
- 每一层都有状态和 digest，调试时难以知道失败来自业务还是基础设施；
- 过早要求 100% 完整性，简单需求也可能被复杂治理流程阻塞。

**改进：**按事实层分成三个版本：

| 版本 | 必须交付 | 暂缓内容 |
| --- | --- | --- |
| V3-Slice | Source inventory、Requirement/Scenario、Repository Snapshot、EvidenceClaim、Binding、WorkPackage/Task、Assignment、TaskPreflight、TaskRun | Policy 全量抽取、复杂 Affinity、跨仓库、自动 Convergence |
| V3-Usable | MUST Policy、独立 Binding/Plan Review、受控 CapabilityDefinition/Claim、Task revision、scope settle、final repository snapshot | 多语言 Provider、复杂历史评分、多仓库交付 |
| V3-Governed | Delivery Integration、Convergence、verified delivery history、mutation/nightly、跨进程 CAS/DB adapter | 非必要的新领域对象 |

保留原设计中的概念，但允许多个轻量 summary 暂时由一个 immutable `PlanningEvidencePack` 承载；当数据规模或并发需求证明需要拆表时再迁移。不要为了形式上的对象完整而推迟价值验证。

#### P1-2 没有风险分级的规划深度

原设计对所有 normative source、所有影响维度和所有仓库 provider 采用接近同样的严谨程度。这会让“改一个文案”和“修改幂等写入、权限、异步状态机”获得类似成本。

**改进：**在 Requirement Analysis 后先计算 `PlanningRiskProfile`：

```ts
interface PlanningRiskProfile {
  level: 'low' | 'medium' | 'high' | 'critical'
  dimensions: Array<'data' | 'state' | 'permission' | 'async' | 'api' | 'security' | 'performance' | 'release'>
  requiredEvidenceKinds: string[]
  requiredReviewKinds: Array<'requirement' | 'binding' | 'plan' | 'assignment' | 'convergence'>
  requiredScenarioCategories: string[]
  reasonEvidenceIds: string[]
}
```

建议策略：

- `low`：单一模块、无持久化/权限/异步/对外 API，使用 inventory + symbols + 邻近 tests；一轮 Planner + 自动校验即可。
- `medium`：跨一个边界或影响 API/读写，必须 Binding Review 和 verification preflight。
- `high`：涉及权限、状态、数据迁移、异步、外部 API 或关键业务规则，必须独立 Binding Review、Plan Review、negative/failure scenarios 和独立 Reviewer。
- `critical`：涉及安全、资金/库存、不可逆迁移、生产发布或多系统一致性，必须人工确认关键 owner/Decision，并要求最终 Convergence。

风险分级只能增加门禁，不能降低 source traceability 和 false-ready 约束。

#### P1-3 Task 仍缺少输入和输出合同

原设计的 `GeneratedDeliveryTaskProposalV3` 已有 changeContract、completionCriteria、verification、dependencies、escalationConditions，是正确方向；但对于真实 Agent 接手仍缺少标准化上下文包。

**改进：**将 Task 的人类描述和机器执行合同统一为 `TaskContextPack`：

```ts
interface TaskContextPack {
  objective: string
  whyNow: string
  inScope: string[]
  outOfScope: string[]
  requirementStatements: string[]
  acceptanceScenarioIds: string[]
  currentBehaviorClaims: string[]
  targetBehavior: string
  startingPoints: Array<{ evidenceId: string; reason: string }>
  expectedChangeSurfaces: string[]
  forbiddenChangeSurfaces: string[]
  dependencies: Array<{ taskId: string; reason: string; completionRequired: boolean }>
  invariants: string[]
  verificationSteps: Array<{
    scenarioId: string
    action: string
    expectedObservable: string
    commandEvidenceId?: string
  }>
  expectedArtifacts: string[]
  escalationConditions: string[]
  unknowns: Array<{ question: string; blocking: boolean; owner: string }>
}
```

任务必须同时有：

- 一个可在 1~2 句话中复述的 objective；
- 明确 in-scope 和 out-of-scope；
- 至少一个 starting point 和一个 expected change surface；
- 可观察的 expected artifact；
- 不是“执行测试”，而是验证哪个 scenario 的哪个 observable outcome；
- 失败、未知和 scope 变化的升级条件。

#### P1-4 WorkPackage 的聚合依据仍可能过于抽象

“同一业务 outcome、同一 owner、同一事务边界”是好规则，但实际项目中经常出现一个业务目标跨 schema、后台服务、异步 worker、前端和发布配置。单一 owner 既可能造成大任务，也可能把必须一起设计的契约拆开。

**改进：**WorkPackage 不只记录 owner，还要记录 `delivery seam`：

```ts
interface DeliverySeam {
  kind: 'transaction' | 'api_contract' | 'event_contract' | 'state_machine' | 'migration' | 'ui_flow' | 'release_unit'
  evidenceIds: string[]
  mustStayTogether: boolean
  reason: string
}
```

任务拆分规则改为：

- 跨独立实现 owner，但共享 `mustStayTogether` contract 的内容，可以拆成多个 Task，但由一个 contract task 或 design checkpoint 先冻结接口；
- 同一 owner、同一事务边界且无法独立验证的内容保持一个 Task；
- 独立可验证、无冲突且可以并行的内容才拆开；
- 任何拆分都必须说明拆分后的交付成果和前置依赖，而不是只说明“文件不同”。

#### P1-5 Capability 治理可能阻塞普通项目

受控 CapabilityDefinition 和 active claim 能有效防止 Planner 为匹配候选而降低要求，但如果所有领域能力都要求人工维护 claim，系统首版可能因为团队没有完整登记而频繁 `blocked`，用户会把它理解为“不好用”。

**改进：**采用三层能力事实，但严格区分能否执行：

1. **硬资格**：项目角色、仓库访问、Runtime、语言/框架基础能力、审查独立性。没有 active trusted claim 不能进入 `dispatchable`。
2. **软匹配**：代码 owner affinity、历史成功交付、领域熟悉度。只能排序，不能创造资格。
3. **临时人工确认**：用户可以为某个 Task 选择一个本来硬资格合格的 Agent，并填写 reason 和有效期。不能绕过硬门禁，也不应要求先建立全局领域能力目录才能处理低风险任务。

此外，应区分：

- `blocked_capability_catalog`：能力定义或 claim 本身缺失；
- `assignment_no_eligible_candidate`：当前团队没有符合要求的人；
- `waiting_capacity`：有合格 owner 但当前没有槽位；
- `preflight_rejected`：选定 Agent 无法接手当前任务。

这四种情况需要不同的用户动作。

#### P1-6 计划审查没有“替代方案”和置信度边界

原设计的 Review finding 很完整，但主要是通过/阻塞。真实规划经常存在多个合理拆法，Reviewer 如果只返回一套判断，用户难以知道哪些是事实、哪些是推断、哪些是可选方案。

**改进：**对于重要但非阻塞的结构差异，支持最多两个 `PlanVariant`：

- `recommended`：理由、风险、预计任务数和验证成本；
- `alternative`：何时更适合、代价和不可替代条件。

只在以下情况提供 variant：

- 任务边界存在两种合理 grouping；
- owner 有两个硬资格合格候选；
- 是否提前建立 compatibility layer 影响任务数量；
- UI/API 交付可以选择不同验证路径。

不要为每个小细节生成 variant。默认只显示推荐方案，并提供“查看备选”而不是增加用户选择负担。

### P2：应在可用版本稳定后建设

#### P2-1 Delivery Convergence 不能成为首版规划前置条件

Convergence 是必要的交付治理，但它回答的是“最终代码是否满足规格”，不是“规划是否正确”。如果在首版同时实现 canonical integration、final snapshot、unrequested behavior 检测和 repair revision，会显著扩大交付范围。

**改进：**分两步：

- Slice 版本先保留 `TaskRun -> verification evidence -> human delivery confirmation`，并记录最终 commit、changed files 和 scope 校验。
- Usable/Governed 版本再加入自动 final repository snapshot、Convergence Reviewer 和修复 revision。

但以下两个规则从 Slice 起就必须存在：

- TaskRun 所在 worktree 的成功不能伪装成已集成；UI 显示 `run_succeeded_not_integrated`；
- 交付确认必须引用一个实际 repository revision 或明确的 `no_code_change` 证据。

#### P2-2 自动 repair 轮次不应固定为“一次”而不看错误类型

一次 focused repair 可以防止无限 LLM 循环，但所有问题统一只允许一次，会导致可修复的格式/引用错误和需要用户决策的语义冲突混在一起。

**改进：**按错误类型分流：

- schema、重复 key、非法引用：Service 本地重试或直接失败，不消耗语义 repair 轮次；
- evidence retrieval 不足：允许一次受控补检索；
- task grouping/description 质量：允许一次 focused repair；
- source 冲突、owner 歧义、scope 变化、能力缺口：立即生成 Decision/blocked，不让模型继续猜；
- 同一 blocking finding 第二次仍存在：blocked，保留两轮输入输出和差异。

#### P2-3 缺少用户修正后的局部重算策略

原设计提到 stale 和从受影响阶段重新规划，但没有足够具体地定义用户确认某个 owner、Policy 或 Decision 后哪些对象重算、哪些对象复用。

**改进：**建立影响矩阵：

| 用户动作 | 必须重算 | 可复用 |
| --- | --- | --- |
| 修正 Requirement statement | Scenario、Binding、WorkPackage、Task、Capability、Assignment | Repository Snapshot |
| 确认 Acceptance Scenario | Binding、Task verification、Plan Review | 不受影响 Requirement/Binding |
| 确认代码 owner | 受影响 Binding、Task scope、Assignment | Requirement/Repository Snapshot |
| 解决 Decision | 受影响 Scenario、Binding、Task、Assignment | 不受影响 Requirement/Policy |
| 确认 Policy applicability | 受影响 Binding、Task、Verification | Repository Snapshot |
| 增加/撤销 Capability claim | Capability Catalog、Assignment、Preflight | Task 语义 |
| Repository refresh | 受影响 Binding、Task scope、Assignment | source/Requirement，除非 source 也变 |

每次局部重算都要生成新 revision，不能原地修改已经批准的对象。

#### P2-4 UI 七层信息完整，但默认操作路径过长

原设计建议按需求、仓库、代码理解、任务、能力分派、门禁、交付收敛七层展示，审计上完整，但用户首次只想回答三个问题：

1. 这份需求系统理解对了吗？
2. 任务拆得能做吗？
3. 分给谁有依据吗？

**改进：**采用“摘要优先、证据可下钻”的界面：

```text
Plan Health
  -> 3 个需要我确认的问题
  -> 6 个任务，2 条依赖链，1 个等待容量
  -> 每个任务的 owner、范围、验证和风险
  -> 展开查看 Requirement/Scenario/Binding/Evidence
```

默认首页只展示：

- `ready / needs_confirmation / blocked / waiting`；
- 需要用户处理的根因，按影响排序；
- 任务数量、关键依赖、风险和预计验证方式；
- 每个任务的 owner 与选择理由；
- “批准计划”前仍未解决的 gate。

详情页再显示七层证据。不要把每个 digest、provider、claim 和 audit record 放在首屏。

## 4. 外部项目做法与可借鉴点

外部项目的核心启示不是“照搬某个框架”，而是它们分别解决了流程中的不同问题。本项目应组合机制，不复制产品边界。

| 项目 | 主要解决的问题 | 可借鉴机制 | 不应直接照搬 |
| --- | --- | --- | --- |
| GitHub Spec Kit | Spec/Plan/Tasks/Implement 的规范驱动流程 | 官方推荐流程包含 `clarify`、`checklist` 和 `converge`；`converge` 对照代码与 artifacts 发现差距并追加任务；workflow 还提供 gate、loop、fan-out/fan-in step | 内置流程仍主要按单 coding-agent integration 顺序执行；它不负责本地 brownfield 仓库的完整代码 owner 证明 |
| OpenSpec | 变更规格与场景的 source of truth | 官方 schemas/docs 将 proposal、specs、design、tasks 等工件分开，Requirement 通过 Scenario 具体化，并表达新增、修改和删除 | 文件格式和命令流程不能替代本项目的 Repository Snapshot、证据 freshness 和 Runtime 分派 |
| Task Master | 从 PRD 粗拆到复杂度驱动展开 | 官方任务结构包含 dependencies、subtasks 和 `testStrategy`，支持复杂度分析和任务二次展开 | `status=done` 是任务状态操作，不自动证明测试或验收通过；任务数量和复杂度分析也不能证明代码 owner 正确 |
| Multica | Agent、Squad、Runtime、Issue 和运行调度 | Issue 保存长期目标和状态，Task 是一次运行；Agent/leader 负责路由，Runtime 决定执行位置；pending run 去重；历史 run 不覆盖 | Issue 分派本身不证明需求拆解正确；Squad leader 不能替代规划阶段的 code binding |
| OpenHands | Agent 在真实仓库中执行、工具调用和事件轨迹 | 以受控工具和运行事件记录 Agent 行为；把任务执行与环境/工具隔离；需要清晰的 runtime context | 通用 autonomous coding agent 的开放执行模型不能直接用于本地插件的安全边界；不能让 Agent 自由读取任意敏感文件 |
| SWE-agent | Issue 到代码修复的可复现评测 | 任务输入、工具接口、patch、测试结果和 trajectory 形成可评测单元；用真实 issue/repository benchmark 衡量修复成功 | benchmark patch success 不等于产品需求拆解或多人分派正确；不能只看最终测试通过 |
| MetaGPT / CrewAI / AutoGen / LangGraph | 多 Agent 角色协作和状态编排 | 角色职责、结构化消息、状态图、人工介入点和可恢复执行 | 角色 Persona 不能变成硬能力证明；多 Agent 数量越多不代表 owner 越正确，需受证据和门禁约束 |

### 4.1 组合后的适用模式

建议采用以下组合：

```text
Spec Kit / OpenSpec
  -> clarify、Requirement、Scenario、现状与变更分离

本项目 Repository Snapshot + EvidenceClaim
  -> 真实代码 owner、影响链、测试面和证据 freshness

Task Master
  -> WorkPackage 粗拆、复杂度驱动二次展开

Multica / OpenHands / SWE-agent
  -> TaskRun、Runtime、工具边界、trajectory、重试和真实执行反馈

本项目 Capability / Assignment / Preflight
  -> 结构资格、项目亲和、容量、接手检查和可审计分派
```

### 4.2 从外部项目应吸收的共同产品原则

1. 规划工件要有明确 owner，发现问题时回到产生问题的阶段修复。
2. 任务不是聊天回答，而是可恢复、可重试、可审计的持久化交付责任。
3. 需求、设计、任务和执行结果之间要保留稳定引用，但允许合理的任务 grouping，不要求逐字一致。
4. Agent 的工具能力、Runtime、任务上下文和实际运行记录必须分开。
5. 评测必须使用真实 Issue/需求、真实代码和真实执行结果，不能用固定 fake JSON 代替。
6. 用户要能看到下一步动作和阻塞根因，而不是只看到一个失败状态。

## 5. 推荐目标架构：Evidence-Grounded Planning 3.1

原 V3 的大方向保留，但首版把核心闭环收敛为六个阶段：

```text
1. Understand
   source inventory -> Requirement / Scenario / Decision

2. Ground
   repository snapshot -> evidence -> evidence claims -> code binding

3. Shape
   WorkPackage -> DeliveryTask -> context pack -> dependency/coverage checks

4. Qualify
   capability requirement -> eligible candidates -> TaskPreflight

5. Commit
   human review -> immutable plan revision -> assignment -> TaskRun

6. Learn
   verification -> user correction / Agent feedback -> evaluation record
```

完整的 Policy Snapshot、Delivery Integration 和 Convergence 是后续治理层，不改变前五阶段的 source of truth。

### 5.1 Understand：需求识别

输入：PRD、技术设计、Issue、附件和用户补充说明。

输出：

- source profile 和 block/anchor inventory；
- Requirement、AcceptanceCriterion、AcceptanceScenario、Decision；
- `changeIntent`：`new`、`modify`、`remove`、`unknown`；
- 每条来源的主 disposition；
- inference、冲突、未知和需用户确认的问题。

首版必须覆盖：

- 功能需求、用户故事和编号条目；
- 普通段落中的“必须、不得、仅、失败时、兼容、回滚、性能、安全”等约束；
- 表格中的权限、状态、字段、API、事件和验收内容；
- 技术设计中会改变实现 scope、owner、dependency 或 verification 的约束。

需求识别不要求模型把所有内容都转成 Requirement。要求的是：每个规范性候选都有一个明确结果：`requirement`、`acceptance`、`decision`、`context`、`duplicate`、`deferred` 或 `out_of_scope`。

#### 首版需求 gate

- required anchor disposition = `100%`；
- required Acceptance 保留原文并有 source locator；
- required AcceptanceScenario 有 precondition、trigger、outcome、observableAt；
- pending Decision 只要会改变 scope、owner、dependency、verification 或 release，就阻塞 ready；
- 业务规则与安全/权限/失败语义不能被 `context` 静默消费；
- 用户只需要确认高影响冲突和推断，而不是审核每条正常 anchor。

### 5.2 Ground：代码事实和 Binding

Repository Snapshot 首版只支持已经有可靠 provider 的 TypeScript + Nuxt/Vue + Prisma 子集。必须明确显示 support matrix，其他技术栈只能返回诊断或 blocked，不能生成 ready binding。

Snapshot 最少包含：

- canonical root、Git commit/tree、dirty digest；
- package/workspace/build/test manifest；
- TypeScript symbol、import/call、route、schema、test；
- Nuxt/Vue 页面、server route、composable 和组件 script；
- Prisma model、relation、migration inventory；
- command 的 `declared`/`probe_passed`/`baseline_passed`；
- provider coverage 和未解析限制。

每个 Binding 必须说明：

- current owner 和 source of truth；
- entry point；
- write path 和 read path；
- state transition 和失败时是否推进；
- permission guard 和拒绝路径；
- producer/consumer、幂等和重试；
- 现有 test surface 或新测试面；
- target behavior、allowed scope 和 forbidden scope；
- unknown 及其阻塞影响。

#### Binding ready gate

- critical requirement 没有错误 owner；
- 适用影响维度都有证据或明确、可审计的 not applicable；
- `new` surface 有 parent module/bounded context evidence；
- 关键 claim 有 supporting evidence；
- ambiguous evidence 不能单独支撑 critical binding；
- 绑定 reviewer 与 binding agent 独立；
- repository、requirement 和 policy digest current。

### 5.3 Shape：从 WorkPackage 到 Task

WorkPackage 只表示一个交付目标和其影响边界，不直接执行。Task 是可分派的交付合同。

推荐的 Task 最小字段：

```ts
interface UsableDeliveryTask {
  key: string
  workPackageKey: string
  title: string
  objective: string
  relationship: 'implementation' | 'verification' | 'review' | 'migration' | 'release'
  requirementKeys: string[]
  scenarioKeys: string[]
  bindingKeys: string[]
  evidenceIds: string[]
  contextPack: TaskContextPack
  dependencies: string[]
  conflictKeys: string[]
  risk: 'low' | 'medium' | 'high' | 'critical'
  completionCriteria: string[]
  verificationIds: string[]
  escalationConditions: string[]
}
```

#### 好任务的判断规则

一个任务必须能回答：

1. 为什么做，完成后业务行为是什么？
2. 从哪个真实代码入口开始？
3. 允许改哪些路径，明确不允许改哪些路径？
4. 它交付什么文件、行为、迁移、测试或证据？
5. 前置任务是什么，完成后谁消费它的结果？
6. 如何验证 good、rejection、boundary、failure 或 recovery 场景？
7. 遇到什么情况必须暂停并请求 Decision？

以下任务默认判为不可用：

- “完成后端改造”“实现相关功能”“补充测试”这类没有 owner 和结果的泛任务；
- 只写“运行全部测试”，没有说明验证哪个 scenario；
- 只给目录，不给起始 symbol、入口或 source of truth；
- 把 migration、权限、异步 consumer、失败恢复隐藏在普通 code task 里；
- 一个任务覆盖所有 Acceptance，但没有共同业务 owner、共同事务边界和统一验证闭环；
- 每条 Acceptance 都单独成任务，却没有独立交付成果或合理依赖。

### 5.4 Qualify：分派与 TaskPreflight

分派算法严格分三层：

```text
Hard Eligibility
  -> Evidence-grounded Ranking
  -> Dispatch / Preflight Status
```

#### Hard Eligibility

必须满足：

- active Project membership；
- project role 覆盖 Service 推导的 required role；
- active trusted capability claim 覆盖 required capability；
- 仓库、路径和工具访问满足 scope；
- Runtime 类型兼容；
- 高风险任务存在独立 Reviewer；
- Squad 的 leader/member 结构满足任务子责任。

不能作为硬资格：

- Persona 文本；
- Skill 名称；
- 自然语言简介；
- Planner 选中的 Agent ID；
- 未确认的历史聊天或自由字符串 capability。

#### Ranking

只在 hard eligible 候选中排序：

```text
binding owner affinity
  > project/path confirmed affinity
  > capability coverage depth
  > verified delivery history
  > Runtime/tool locality
  > capacity/estimated completion
  > stable ID tie-break for low risk only
```

每个非中性得分必须引用 source record。高风险同分且无可信区分事实时 `assignment-owner-ambiguous`，不能按 ID 假装正确。

#### Preflight

最终候选必须读取 TaskContextPack 并返回 `accepted`、`needs_clarification` 或 `rejected`。Preflight 不修改任务语义；它发现问题时回到 binding、planning 或 requirement 阶段。

### 5.5 Commit：审批、执行和证据

计划批准前冻结：

- Requirement/Scenario/Decision digest；
- Repository/Stack/Binding digest；
- TaskContextPack 和 plan digest；
- Capability/Assignment/Preflight digest；
- local key -> persistence ID mapping。

执行中：

- TaskRun 不覆盖旧 attempt；
- changed files 必须通过 scope contract；
- command trust 与实际执行结果分开；
- verification evidence 绑定当前 TaskRun、Task revision、Scenario 和 observable result；
- worktree 成功不等于 canonical integration 完成。

### 5.6 Learn：反馈进入系统

每次规划或执行都记录以下反馈：

- 用户修改了哪些 Requirement、Binding、Task 字段；
- 用户合并/拆分了哪些任务；
- Agent preflight 退回原因；
- Agent 请求了哪些澄清；
- TaskRun 失败属于代码、任务边界、owner、环境还是需求；
- verification/convergence 发现哪些遗漏；
- 最终 owner 是否被重新分派；
- 哪些错误被规则阻塞，哪些错误漏过了门禁。

反馈要进入三类数据：

1. 可回放的 evaluation case；
2. 规则或 provider 的质量 issue；
3. prompt/model/provider 版本的效果对比。

不能直接用一次人工修改自动训练或自动改变硬门禁。

## 6. 推荐实施顺序

### Phase 0：基线和用户任务样本

目标：先知道当前版本哪里不好用。

交付：

- 固定 `lscity-nuxt` PRD、技术设计、代码 commit、团队目录；
- 为 8~12 个关键需求建立 expected Requirement/Scenario/Binding/Task grouping；
- 记录允许的替代拆法，不要求固定任务数量；
- 当前 V2 运行至少 5 次真实模型；
- 由工程师完成一次任务可执行性和 owner 正确性标注；
- 采集人工修改、错误 owner、泛任务、缺失败路径和错误分派。

退出条件：有 baseline 报告，能回答当前最常见的 5 类错误。

### Phase 1：V3-Slice Understand + Ground

目标：不改现有 V2 默认流程，生成 shadow planning pack。

交付：

- Source inventory 扩展到普通规范性 paragraph、table、功能章节和约束词；
- Requirement/Scenario 结构化；
- TypeScript/Nuxt/Vue/Prisma snapshot；
- Evidence Gateway；
- EvidenceClaim；
- RequirementCodeBinding；
- Binding deterministic validator + 独立 reviewer；
- 支持 `supported/partial/unsupported`。

退出条件：

- Gold required source disposition 100%；
- critical Requirement owner/impact chain recall 100%；
- snapshot 外 evidence 0；
- unsupported stack false-ready 0；
- 真实用户可以看懂每个 critical binding 的“为什么是这里”。

### Phase 2：V3-Slice Shape + TaskPreflight

目标：证明生成的任务真的能被 Agent 接手。

交付：

- WorkPackage 聚合/展开；
- UsableDeliveryTask 和 TaskContextPack；
- scenario implementation/verification coverage；
- dependency/conflict/scope validator；
- Plan Reviewer；
- TaskPreflight；
- 只为真实候选 Agent 生成一次 preflight；
- shadow 结果与现有 V2 plan 对比。

退出条件：

- `first_pass_task_acceptance >= 85%`；
- `human_task_rewrite_ratio <= 20%`；
- critical task actionability 100%；
- 无 critical owner 错误；
- 泛任务和机械碎任务均能被 Gold/forbidden plan 捕获。

### Phase 3：V3-Slice Assignment + Run

目标：证明“分给谁”比当前 V2 更有依据。

交付：

- CapabilityDefinition/Claim 最小目录；
- hard eligibility / ranking / dispatch status；
- affinity claim 最小版本；
- AssignmentDecision；
- `waiting_capacity`、`waiting_runtime`、`blocked_access`、`assignment-owner-ambiguous`；
- TaskRun revision、retry、reassignment 和 scope settle；
- 用户对 assignment 的明确确认和 override 审计。

退出条件：

- selected owner trusted claim coverage 100%；
- zero-candidate false-ready 0；
- high-risk ambiguity false-ready 0；
- 并发 claim 不产生重复 active run；
- Agent preflight rejection ratio 达到目标；
- 用户能从 UI 看懂每个分派理由和阻塞动作。

### Phase 4：Usable Governance

目标：补齐能影响长期可靠性的治理能力。

交付：

- PlanningPolicySnapshot 和 active MUST disposition；
- 完整 plan review/repair 分流；
- scope impact guard；
- final repository snapshot；
- 人工 delivery confirmation；
- feedback/evaluation registry；
- 3 个支持范围内真实项目和 1 个 unsupported 反例。

退出条件：

- false-ready 0；
- critical false-converged 0；
- 关键人工修改比例稳定下降；
- 规划 P95 延迟和 token 成本在可接受范围；
- 重复运行关键 Binding/Task 语义稳定性达到目标。

### Phase 5：Governed Integration + Convergence

目标：在规划和执行已经证明价值后补齐完整交付治理。

交付：

- canonical target integration；
- final clean commit；
- DeliveryConvergenceReview；
- unmet/partial/unrequested/policy_violation/stale_verification；
- finding -> 新 revise operation；
- 多 worktree、冲突、目标 ref 移动和未集成 output 回归。

退出条件：原设计中 P5/P6 的 delivery gate 全部满足。

## 7. 原设计的保留、调整与推迟

| 原设计内容 | 处理建议 | 理由 |
| --- | --- | --- |
| Planner 只能引用系统 Evidence ID | 保留，V3-Slice 必做 | 是防伪造路径和时点漂移的核心边界 |
| Source Profile 全量 PDF/OCR/附件门禁 | 保留 normative source 全量输入完整性；按 media type 和 authority 分流 | normative PDF/附件必须全量解析或阻塞；完整 Markdown/plain text 可走低成本 parser，风险只决定后续 Binding/Review 深度，不能把 normative 输入降级 |
| AcceptanceScenario | 保留，V3-Slice 必做 | 没有 observable outcome 就无法验证任务是否完成 |
| PlanningPolicySnapshot | V3-Usable | 先保留项目规则文件的 metadata 和关键 MUST 规则，完整 authority/disposition 后置 |
| RequirementCodeBinding | 保留，V3-Slice 必做 | 这是“按照代码逻辑拆任务”的核心 |
| WorkPackage -> DeliveryTask | 保留，V3-Slice 必做 | 比固定每条验收一个任务更稳定 |
| PlanningReferenceMap | 保留核心，简化首版 | 先保证 local key、immutable revision 和引用闭包，复杂预留 ID/跨表恢复可后置 |
| CapabilityDefinition/Claim | 保留最小硬资格 | 不可用自由文本绕过资格，但不必首发完整历史能力治理 |
| AgentProjectAffinityClaim | 首版最小化 | 先支持 codeowner/人工确认/path affinity，verified history 后置 |
| TaskRun/VerificationEvidence | 保留 | 任务分派质量必须由真实执行反馈验证 |
| DeliveryIntegration | 首版只记录 integration status/final commit | 防止 worktree success 被误报为交付完成，但完整 merge/orchestrator 后置 |
| DeliveryConvergence | 后置到 Governed 版本 | 它重要但不应延迟首个可用规划纵切 |
| 多语言 Provider | 后置，明确支持矩阵 | 没有 semantic provider 就不能宣称跨语言好用 |
| 20+ 独立表 | 按使用规模逐步拆分 | 先保证事实边界，避免 schema 建设取代产品验证 |
| 一次自动 repair | 调整为按错误类型分流 | 格式错误、证据不足和业务冲突的恢复语义不同 |
| 七层 UI | 保留信息架构，调整默认视图 | 首屏摘要优先，详情下钻，降低确认成本 |

## 8. Release Gate：什么时候可以说“好用”

### 8.1 必须同时满足的硬条件

1. 所有 normative source 有可审计 disposition，critical source 不因解析缺口被静默忽略。
2. 每个 required Acceptance 有原文、Scenario 和 observable outcome。
3. critical Requirement 的真实 code owner 和影响链 recall 为 `100%`，不能有错误 owner。
4. Planner/Binding 不能引用 snapshot 外路径、命令、symbol 或未读取 evidence。
5. 每个 ready Task 有明确 objective、in/out scope、starting point、expected artifact、dependency、verification 和 escalation。
6. 每个 required Scenario 有实现和验证责任，且不是仅仅挂在任意 Task 上。
7. Service 推导 CapabilityRequirement，Planner 不能通过返回 Agent/Capability 降低真实任务要求。
8. ready Task 的 selected owner 具备 active trusted claim、访问权限、Runtime 兼容和独立 review 条件。
9. 无候选、owner 歧义、关键未知和 unsupported stack 不能 false-ready。
10. TaskRun、retry、reassign、verification 和 scope evidence 可追溯且历史不可覆盖。
11. 任务执行成功但未集成/未验证时不能显示 delivered。
12. V2 历史数据可读，V3 失败不污染 current pointer，不静默回退 V2。

### 8.2 必须达到的体验条件

- 用户在一个摘要页内知道是否可以批准，以及最多 3 个最重要的待处理问题。
- 用户能在 5 分钟内定位一个任务为什么修改某个模块、依赖谁、如何验证。
- 用户不需要手工重写关键 Task 才能让 Agent 开始。
- Agent preflight 能在执行前暴露 owner、scope、入口或验证问题。
- 等待容量、Runtime 不可用、能力缺失、owner 歧义和需求冲突显示不同动作。
- 用户修正一个 owner 或 Decision 后，只重算受影响的 binding/task，不让整个项目无理由重做。
- 失败诊断说明 root cause 和下一步动作，不只显示模型错误文本。

### 8.3 关键指标建议

| 类别 | 指标 | 建议门槛 |
| --- | --- | --- |
| 需求 | critical requirement recall | `100%` |
| 需求 | required source disposition | `100%` |
| 需求 | required scenario executability | `100%` |
| 代码 | critical binding precision | `100%`，无错误 owner |
| 代码 | critical impact-chain recall | `100%` |
| 证据 | fabricated/unread evidence | `0` |
| 任务 | actionability | `>= 90%`，critical `100%` |
| 任务 | dependency correctness | `>= 95%`，无 blocking edge |
| 任务 | human task rewrite ratio | `<= 20%` |
| 分派 | trusted capability coverage | `100%` |
| 分派 | ready assignment eligibility | `100%` |
| 分派 | first-pass preflight acceptance | `>= 85%` |
| 分派 | high-risk owner ambiguity false-ready | `0` |
| 运行 | duplicate active run | `0` |
| 运行 | first-run completion | 建 baseline，稳定期 `>= 70%` |
| 交付 | false-ready | `0` |
| 交付 | false-converged | `0` |
| 稳定性 | rerun semantic stability | 普通关键对象 `>= 85%`，critical `100%` |
| 成本 | plan P95 latency/token cost | 先测 baseline，再按仓库规模设 SLO |

指标不允许互相抵消。例如总体 binding recall 达标时，一个 critical owner 缺失仍必须 blocked；人工修改率低时，也不能掩盖 false-ready。

## 9. 典型用户流程

### 9.1 正常流程

```text
用户提交 brief
  -> 系统显示已识别的 6 个需求、2 个需确认问题
  -> 用户确认 1 个 owner/Decision
  -> 系统生成 4 个 WorkPackage、7 个 Task
  -> 每个 Task 显示入口、范围、依赖、验证和候选 owner
  -> 候选 Agent preflight accepted
  -> 用户批准
  -> TaskRun 执行和验证
  -> 用户确认集成 revision
```

### 9.2 需求歧义

```text
需求包含“提交后自动生成报告”，但没有说明同步还是异步
  -> DecisionPlanningEffect 标记影响 API、状态、consumer 和 verification
  -> 计划显示 needs_decision
  -> 用户选择异步并确认失败重试语义
  -> 只重算受影响 Scenario/Binding/Task
```

### 9.3 代码 owner 歧义

```text
同名组件和 server service 都可能处理状态
  -> EvidenceClaim 同时记录支持和矛盾证据
  -> Binding status=needs_confirmation
  -> UI 展示两个候选 owner 及证据差异
  -> 用户确认或请求补充 provider
  -> 不生成“最像目录名”的 ready Task
```

### 9.4 分派不可用

```text
任务需要 Prisma migration + domain write owner
  -> Agent A 有语言能力但无数据库 claim
  -> Agent B 有 claim 但 Runtime offline
  -> UI 分别显示 capability missing / waiting_runtime
  -> 用户不能用 Persona 绕过能力门禁
  -> Runtime 恢复后重新计算 dispatch，不重写 Task 语义
```

### 9.5 Agent 接不住任务

```text
selected Agent 读取 TaskContextPack
  -> 发现目标 API 已迁移，返回 needs_clarification
  -> 系统创建 repository-drift 或 binding correction
  -> 旧 Task revision 保留
  -> 新 revision 重新 review/assignment
```

## 10. 最终建议

不要直接按两份原设计从 P1 到 P6 全量开工，也不要只调 Planner prompt。推荐的第一批实现顺序是：

1. 固定真实 Gold 和 V2 baseline，先量化错误 owner、漏项、泛任务、人工修改和分派失败。
2. 在不影响 V2 的 Shadow 模式下，实现一个 TypeScript/Nuxt/Vue/Prisma Repository Snapshot。
3. 增加 EvidenceClaim 和 RequirementCodeBinding，让系统能解释“为什么是这个 owner”。
4. 用 WorkPackage + TaskContextPack 生成 2~8 个真正可接手的任务。
5. 增加 TaskPreflight，让最终 Agent 在执行前确认入口、范围、产物和验证。
6. 使用受控 CapabilityDefinition/Claim 做硬资格，使用 affinity 做排序，不让 Planner 反向降低要求。
7. 先用真实 TaskRun 和 verification 反馈验证任务是否好用，再建设完整 Policy、Integration、Convergence 和多语言 Provider。
8. 只有当 `false-ready=0`、critical owner 正确、人工任务重写比例和 preflight acceptance 达到门槛，才逐步从 shadow 开 candidate。

准确的当前对外表述应是：

> 当前版本已具备 V2 的结构化需求、验收、Decision、任务覆盖和审批/分派契约；它还不能证明已经能够稳定地理解任意项目代码、正确拆分任务并把任务分给最合适的 Agent。原 V3 设计方向正确，但需要先通过一个带真实 Repository Snapshot、Code Binding、TaskPreflight 和真实执行反馈的纵向切片，才能证明“好用”。

## 11. 参考来源

### 本项目源码和设计

- [`src/workflow.ts`](../src/workflow.ts#L302)：当前 Source Manifest 和 V2 计划校验。
- [`src/types.ts`](../src/types.ts#L1112)：当前 Requirement Review、Planner 和 V2 repository evidence 契约。
- [`src/service.ts`](../src/service.ts#L4666)：当前 V2 decomposition 编排和任务物化路径。
- [`evidence-grounded-task-planning-improvement-design.zh-CN.md`](./evidence-grounded-task-planning-improvement-design.zh-CN.md)：原总体改进设计。
- [`evidence-grounded-task-planning-technical-design.zh-CN.md`](./evidence-grounded-task-planning-technical-design.zh-CN.md)：原技术设计。

### 外部项目

- [GitHub Spec Kit Agentic SDD](https://github.github.com/spec-kit/reference/agentic-sdd.html)
- [GitHub Spec Kit recommended process](https://github.com/github/spec-kit/blob/main/docs/quickstart.md#recommended-process)
- [GitHub Spec Kit converge command](https://github.com/github/spec-kit/blob/main/templates/commands/converge.md)
- [GitHub Spec Kit workflow step types](https://github.com/github/spec-kit/blob/main/workflows/README.md#step-types)
- [OpenSpec GitHub repository](https://github.com/Fission-AI/OpenSpec)
- [OpenSpec schemas](https://github.com/Fission-AI/OpenSpec/tree/main/schemas)
- [OpenSpec documentation](https://github.com/Fission-AI/OpenSpec/tree/main/docs)
- [Task Master GitHub repository](https://github.com/eyaltoledano/claude-task-master)
- [Task Master task structure](https://github.com/eyaltoledano/claude-task-master/blob/main/docs/task-structure.md)
- [Multica GitHub repository](https://github.com/multica-ai/multica)
- [Multica: Assign issues to agents](https://multica.ai/docs/assigning-issues)
- [Multica: Agents](https://multica.ai/docs/agents)
- [Multica: Squads](https://multica.ai/docs/squads)
- [Multica: Tasks](https://multica.ai/docs/tasks)
- [OpenHands GitHub repository](https://github.com/All-Hands-AI/OpenHands)
- [SWE-agent GitHub repository](https://github.com/SWE-agent/SWE-agent)
- [MetaGPT GitHub repository](https://github.com/geekan/MetaGPT)
- [CrewAI GitHub repository](https://github.com/crewAIInc/crewAI)
- [AutoGen GitHub repository](https://github.com/microsoft/autogen)
- [LangGraph documentation](https://langchain-ai.github.io/langgraph/)
