# 基于可验证代码证据的需求拆解与任务分派改进设计

状态：V3.3 candidate 已实现，发布验证中；长期多项目质量指标仍待持续采样

目标版本：Evidence-Grounded Planning V3.3（持久化与 API `planningContractVersion` 仍为整数 `3`）

调研日期：2026-08-26

修订日期：2026-08-31

修订依据：[`evidence-grounded-task-planning-improvement-review.zh-CN.md`](./evidence-grounded-task-planning-improvement-review.zh-CN.md)

适用范围：`dsh-project-orchestrator` 的需求识别、代码感知规划、任务拆解、候选计算、分派和审批前门禁

## 1. 结论

当前 Planning Contract V2 已修复一个重要基础契约缺陷：原始 Requirement、AcceptanceCriterion 和 RequirementDecision 能独立持久化，不再以 `bundle-root` 和 Task 自身完成条件替代。V2 也已经具备审批、DAG、Acceptance 实施/验证双覆盖以及按角色、能力、Runtime 和容量筛选候选的结构基础。

但必须准确区分现状和目标：V2 的 `repositoryEvidence`、`requiredRoles` 和 `requiredCapabilities` 仍由 Planner 输出；由 Service 根据 Binding 和版本化规则推导受控 DeliveryRole/CapabilityRequirement、只接受可信 CapabilityClaim，是 V3.3 的目标能力，不是当前 V2 已实现事实。

V2 还不能证明“任务拆解能力已经满足实际使用预期”。主要缺口不在字段数量，而在代码事实链和真实接手结果：

- Source Manifest 只强制消费显式“验收标准”和“待确认事项”区域中的列表或表格行，普通功能需求、业务规则、状态要求、权限要求和非功能要求仍可能被遗漏；
- `repositoryEvidence` 由 Planner 自报，当前校验只证明路径、命令和引用字符串在同一份 JSON 内自洽，不证明路径存在、文件被读取、命令来自真实 manifest、需求关联到正确的代码 owner；
- Planner 可以把所有代码任务都标成通用 `implementation`，系统没有从数据库、API、领域服务、状态机、前端消费方和现有测试反向约束任务边界；
- 当前 21 条验收、27 个问题的回归使用 fake analyzer 和固定两任务计划，只证明数量、持久化、门禁和分派契约没有断裂，不证明模型正确理解业务、找到真实代码或生成可执行任务；
- V2 有 Requirement Reviewer，但没有独立的 Code Binding Reviewer 和 Delivery Plan Reviewer，无法系统发现“需求覆盖了，但改错模块”“任务能分派，但交付链不完整”等问题。

因此建议保留 V2 的领域模型和审批闭环，在其上新增 **Evidence-Grounded Planning V3.3**：由 Service 生成冻结的来源与仓库上下文，先用可审查的 EvidenceClaim 建立 Requirement 到真实代码 owner 的绑定，再形成可接手的任务合同、推导能力要求、筛选候选并执行 TaskPreflight。Planner 不再拥有“声明自己看过什么”的权力，只能引用系统提供的稳定证据 ID。

V3.3 的核心不变量是：

```text
来源输入
  -> RequirementSourceProfile（先证明输入完整）
  -> RequirementSourceManifest（再冻结规范性条目）
  -> Requirement / seed AcceptanceScenario / Decision / DecisionOptionEffect
  -> SourcePolicyPrecheck（先冻结来源中的 MUST/SHOULD 候选）
  -> DecisionEffectPrecheck（只消费 seed Scenario，仓库绑定前保守门禁）
  -> PlanningRiskProfile + per-Acceptance ScenarioCoveragePolicy
  -> Scenario completion + ScenarioCoverageReview（补全并审核七类 disposition）
  -> RepositoryContextSnapshot / SupportedStackProfile / CanonicalTargetBinding
  -> PlanningPolicySnapshot / PolicyConstraint（合并来源与仓库规则，只能维持或加强门禁）
  -> EvidenceClaim（结论、支持证据、反证与置信度）
  -> RequirementCodeBinding
  -> WorkPackage / TaskProposal / TaskContextPack
  -> Service-derived CapabilityRequirement
  -> Structurally Eligible Candidates
  -> TaskPreflight（审批前已确定的实际执行 Agent 能否接手）
  -> DecisionEffectFinalization（完整 drafts 上的 commit 前终判）
  -> AssignmentDecision / DeliveryTask / PlanSnapshot
  -> TaskRun / VerificationEvidence
  -> DeliveryIntegrationSnapshot(canonical finalCommit)
  -> DeliveryConvergenceReview
```

任一 required 链路断开时必须返回 `blocked` 或可恢复的明确 `waiting_*`，不能以一个看似完整的任务列表继续审批。风险分级只决定代码证据、Review 和 Convergence 的深度，不能降低 normative source 完整性、引用闭包、硬资格或 false-ready 门禁。

Capability ID 本身不是能力事实。V3 必须由受控 `CapabilityDefinition`、经过人工或受管目录确认的 `AgentCapabilityClaim` 和冻结的 Project Capability Snapshot 共同证明候选资格；Planner 不得自行决定角色、能力或 Agent。项目规则也不能只作为普通 repository evidence 展示，MUST/不得类规则必须成为带 digest 和适用范围的 PolicyConstraint，并进入 Plan、Approval 和 Delivery gate。

Plan Review 只证明计划在执行前可用。TaskRun 全部结束后必须先把输出集成到唯一 canonical target 的 clean `finalCommit`，再冻结实现后的仓库快照，把当前代码与 Requirement、AcceptanceScenario、Policy 和批准计划重新对照；存在未集成 output、冲突、stale、unmet、partial、unrequested 或 policy violation 时创建新 plan revision 的修复任务并阻止交付关闭，不能把“任务跑完”当成“需求已实现”。

## 2. 用户预期与完成边界

用户的真实预期不是“模型输出了任务”，而是：

1. 正确识别显式需求、隐含业务约束、验收标准和待决策事项；
2. 理解目标项目的真实代码结构、source of truth、写路径、读路径、状态流转、失败路径和测试体系；
3. 按业务交付链拆出边界清晰、依赖正确、可独立验证的任务；
4. 把任务交给具备项目资格、技术能力、领域能力、Runtime 和容量的 Agent 或 Squad；
5. 遇到证据不足、需求冲突、代码 owner 不明或团队不具备能力时明确阻塞，而不是编造路径、能力或任务；
6. 通过真实仓库、真实模型和非 happy-path 评测证明它在重复使用时仍然好用。

本设计不把以下结果视为完成：

- schema 校验通过；
- 需求数量与输入列表数量相同；
- 每条 Acceptance 被任意 implementation/test Task 引用；
- 所有 Task 都有 Agent ID；
- fake LLM 返回固定任务后集成测试通过；
- 单次真实模型运行结果看起来合理；
- 给无候选 Task 手工指定 Agent 后可以批准。

## 3. 当前实现事实

### 3.1 V2 已经具备的正确基础

当前实现已经具备以下能力，应保留而不是重做：

- [`src/types.ts`](../src/types.ts) 中已有 `RequirementAnalysisResultSchema`、`RequirementReviewResultSchema`、`GeneratedPlanV2Schema`；
- [`src/workflow.ts`](../src/workflow.ts) 已校验稳定 key、sourceRef、Decision 引用、DAG、Acceptance 的实施/验证双覆盖、受控角色/能力和 testCommand 引用；
- [`src/service.ts`](../src/service.ts) 已按本地 key 生成稳定持久化 ID，并写入 RequirementBundle、RequirementItem、AcceptanceCriterion、RequirementDecision、Task 和 PlanSnapshot；
- 写入采用“先写子记录，最后切换 Project 指针，失败补偿”的思路；
- Service 已区分结构资格、Runtime、容量、Squad、独立 Reviewer 和审批 stale digest；
- `append`、`revise`、Decision gate、审批覆盖门禁和历史快照已有自动化覆盖。

V3 应以这些能力为基础，新增可信仓库证据、代码绑定和质量评测，不回退到 V1 的单阶段 Planner。

### 3.2 Source Manifest 的遗漏窗口

[`buildRequirementSourceManifest`](../src/workflow.ts) 当前根据章节标题识别“验收”和“问题”区域，只对这些区域中的列表项或表格行设置 `requiredDisposition=true`。这意味着以下内容即使对业务至关重要，也可能只作为普通 paragraph 存在：

- “只有管理员可以发布模型”；
- “提交成功后必须保留原版本，不允许覆盖历史记录”；
- “失败时不得推进状态”；
- “同一幂等键只能创建一次记录”；
- “P95 响应时间小于 500ms”；
- 普通“功能要求”章节中的编号列表；
- 技术方案中的迁移、兼容、回滚和安全约束。

Requirement Reviewer 可能发现这些遗漏，但这仍是概率性发现，不能把 Reviewer 没报错等同于来源完整。

### 3.3 仓库证据是 Planner 自我声明

`GeneratedPlanV2Schema.repositoryEvidence` 当前包含：

```ts
{
  inspectedPaths: string[]
  manifests: string[]
  verifiedCommands: string[]
  relevantModules: string[]
  assumptions: string[]
}
```

`plannerPromptV2` 要求 Planner 只读检查仓库并返回这些字段。当前确定性校验只检查：

- ready 计划的数组非空；
- Task 的 `testCommand` 出现在 Planner 自报的 `verifiedCommands`；
- Task 的 `evidenceRefs` 非空；
- requirement/acceptance/decision/task 引用合法；
- role/capability 来自当前目录。

当前没有建立以下事实：

- evidence path 是否在项目根目录内、是否存在、类型是否正确；
- Planner 是否真的读取过该内容；
- evidence 对应哪个 commit、文件 digest、行区间或 symbol；
- `verifiedCommands` 是 manifest 中声明的命令、做过安全探测的命令，还是模型编造的字符串；
- Requirement 为什么由该 module、API、schema 或 test owner 承担；
- 任务遗漏某个既有调用方、状态推进、权限校验、异步消费者或回滚路径时，谁负责发现。

所以 V2 的 repository evidence 是“计划自洽证据”，不是“系统验证的仓库事实”。

### 3.4 当前真实样本测试仍属于契约测试

[`tests/service.test.mjs`](../tests/service.test.mjs) 中的 `lscity-nuxt 21 acceptance and 27 open questions` 测试具有价值，但不能作为语义质量验收：

- fake requirement analyzer 按 acceptance anchor 顺序生成 `Requirement N` 和 `Acceptance N`；
- 27 个 Decision 全部默认 `low`；
- fake planner 用两个固定 Task 覆盖全部 Acceptance；
- `repositoryEvidence` 固定为 `package.json`、`src` 和 `true`；
- 断言关注数量、映射、owner 和 approval，不检查真实代码 owner、任务边界和可执行内容。

这类测试应继续承担 schema/service 回归，但发布结论必须由另一组真实评测给出。

## 4. 外部项目调研

### 4.1 Multica：借鉴运行与分派，不把它当需求拆解器

调研依据：

- [Multica 官方仓库](https://github.com/multica-ai/multica)
- [Assign issues to agents](https://multica.ai/docs/assigning-issues)
- [Agents](https://multica.ai/docs/agents)
- [Squads](https://multica.ai/docs/squads)
- [Tasks](https://multica.ai/docs/tasks)
- 可直接读取的 [`issue_trigger.go`](https://github.com/multica-ai/multica/blob/main/server/internal/service/issue_trigger.go)

可以借鉴的机制：

| Multica 机制 | 本项目可吸收的原则 |
| --- | --- |
| Issue 保存长期目标、讨论、assignee 和最终状态；Task 只记录一次 Agent run | DeliveryTask 与 TaskRun 分离；重试、换人、恢复都新建 TaskRun，不覆盖原计划任务和历史运行 |
| Agent 决定“谁和如何做”，Runtime 决定“在哪里执行”，Task 记录一次运行 | 角色/能力资格、Runtime 健康和运行记录保持不同 source of truth |
| 一个 Issue 可有多个 Task，历史运行不覆盖 | 同一 DeliveryTask 的多次执行必须可审计、可比较、可恢复 |
| Squad 只唤醒 leader，由 leader 根据上下文选择成员 | Squad delegation 是路由行为，不等于整个 Squad 已执行，更不等于交付完成 |
| role description 只提供上下文，不授予权限 | Persona、展示 role 和 Skill 不参与硬资格判断 |
| pending run 去重、数据库约束和共享 trigger predicate | 任务触发、预览和真实写路径应共享同一确定性规则，并以存储约束防竞态 |
| Runtime offline 时等待或明确拒绝触发 | 资格、容量、Runtime 健康和启动结果必须分层表达 |

不能直接照搬的部分：

- Multica 的核心对象从人工维护的 Issue 开始，它不负责把完整 PRD 可靠转换成结构化 Requirement 和可验证任务；
- Squad leader 的动态选择适合“需求已明确但 owner 要运行时路由”的场景，不能替代规划阶段的需求覆盖和代码 owner 识别；
- Issue 被分派给 Agent 只表示责任转移，不证明任务拆分质量。

调研限制：本次尝试完整 clone 和 partial clone Multica 时 GitHub 传输失败；官方文档、仓库页面和可读取源码用于形成上述结论，但不声称完成了 Multica 全仓源码审计。实施前若要复用其具体数据库或竞态实现，应在网络恢复后单独完成源码级复核。

### 4.2 GitHub Spec Kit：跨工件门禁

[Spec Kit Agentic SDD](https://github.github.com/spec-kit/reference/agentic-sdd.html) 将过程分为 Spec、Plan、Tasks、Implement，并提供：

- `clarify`：在拆任务前解决会改变本期交付链的歧义（高影响默认阻塞，低/中影响若改变 scope/owner/dependency 同样阻塞）；
- `checklist`：像测试代码一样检查需求是否完整、清晰、一致；
- `tasks`：按 Setup、Foundational、User Story 和 Polish 组织依赖与并行；
- `analyze`：只读检查 spec、plan、tasks 之间的冲突、遗漏和矛盾；
- `implement`：只消费已通过前置门禁的任务，并按依赖执行。

本项目应吸收“不同工件由不同阶段 owner 负责，问题回到源头修复”的原则。Plan Reviewer 不直接改需求；发现需求问题时回到 Requirement Analysis，发现 code binding 问题时回到 Binding 阶段，不能在 Task 描述里静默补一个假设。

### 4.3 OpenSpec：Requirement/Scenario source of truth

[OpenSpec](https://github.com/Fission-AI/OpenSpec) 使用 Requirement 和具体 Scenario 表达变更，并将 proposal、specs、design、tasks 分开。对本项目有价值的是：

- Requirement 必须落到可观察 Scenario，不能只保留抽象目标；
- 现状规格和变更规格分离，变更明确表达新增、修改和删除；
- 设计与任务消费同一个 specification source of truth；
- brownfield 项目先理解现状再提出改变，不能按 PRD 标题假设代码结构。

V3 不需要复制 OpenSpec 的文件格式，但应在数据模型中增加 `changeIntent` 和 `currentBehaviorEvidence`，区分 `existing`、`modify`、`new`、`remove` 和 `unknown`。

### 4.4 Task Master：粗拆、复杂度分析和二次展开

[Task Master](https://github.com/eyaltoledano/claude-task-master) 提供 PRD parse、complexity analysis、task expansion、dependency 和 next-task 工作流。可借鉴的不是其具体 prompt，而是两阶段任务粒度控制：

1. 先形成围绕业务 owner 的 WorkPackage；
2. 按影响面、依赖、风险和验证成本决定是否展开为更小 DeliveryTask；
3. 展开后重新校验依赖、覆盖、冲突和可分派性。

这比一次让 Planner 输出 2 到 200 个 Task 更稳定，也能避免“每条验收一个碎任务”和“所有需求塞进两个大任务”两个极端。

### 4.5 调研后的组合选择

```text
OpenSpec / Spec Kit
  提供需求、场景、设计、任务之间的 source-of-truth 与一致性门禁

Repository Context + Code Binding（本项目新增）
  提供 brownfield 项目的真实代码 owner、路径和影响链

Task Master 思路
  提供 WorkPackage -> DeliveryTask 的复杂度驱动二次展开

Multica
  提供 Agent/Squad/Runtime/TaskRun 的路由、运行、去重、恢复和审计原则
```

## 5. V3 总体架构

### 5.1 业务对象与 source of truth

| 业务事实 | Source of truth | 写入 owner | 消费方 |
| --- | --- | --- | --- |
| workspace 唯一写者与 fencing | WorkspaceWriterLeaseRecord + authoritative OS lock handle | Host Bootstrap/Writer Guard | Recovery、所有 mutation/background continuation |
| 原始需求内容与解析完整性 | RequirementBundle + RequirementSourceProfile + source blocks/hash | Requirement Import Service | Source Manifest、Requirement Analysis、Approval |
| 需求和验收语义 | RequirementItem + AcceptanceCriterion + AcceptanceScenario(category) | Requirement Analysis，经 Requirement Review 门禁 | Risk Profile、Code Binding、Plan、Verification、Convergence |
| 未决事项及各选项的交付影响 | RequirementDecision + DecisionOptionEffect + DecisionPlanningEffect（含 resolution digest） | Requirement Analysis / Decision Effect Service，经 Requirement/Binding Review 门禁 | Binding、Plan、Capability、Assignment、stale gate |
| 来源级强制规则 | SourcePolicyPrecheck | Source Policy Service | Decision precheck、Risk、完整 Policy merge |
| 规划风险与所需深度 | PlanningRiskProfile | Risk Policy Service | Repository Evidence、Review、Preflight、Convergence gate |
| 场景策略与完成审核 | AcceptanceScenarioCoveragePolicy + ScenarioCoverageReview | Planning Service + 独立 Reviewer | Binding、Plan、Approval、Convergence |
| 仓库事实 | RepositoryContextSnapshot | Repository Evidence Service | EvidenceClaim、Binding、Plan、Reviewer |
| 技术栈支持状态 | RepositoryStackProfile | Repository Provider Orchestrator | Planning gate、UI、Release scope |
| 唯一交付目标 | CanonicalTargetBinding | Repository/Integration Control Service | Policy、Binding、Plan、Approval、TaskRun、Integration |
| 项目强制规则 | PlanningPolicySnapshot + PolicyConstraint | Policy Extraction Service，经确定性校验/人工确认 | Binding、Plan、Execution、Convergence |
| 代码事实断言 | EvidenceClaim | Binding Agent 提出、Service 校验、Reviewer 确认 | RequirementCodeBinding、Task starting point、审计 |
| 需求到代码关系 | RequirementCodeBinding | Code Binding Service，经 Reviewer 门禁 | Task decomposition、影响分析 |
| 规划候选及接手合同 | WorkPackage + TaskProposal + TaskContextPack | Delivery Planning Service，经 Plan Review 门禁 | Capability 推导、Preflight、最终物化 |
| 本轮 local key/预留 ID | PlanningReferenceMap | Planning Service | Proposal/Task/Capability/Assignment 物化、恢复、Commit |
| 计划任务 | DeliveryTask + PlanSnapshot | Planning Commit | Approval、Execution |
| 能力定义和成员能力声明 | CapabilityDefinition + AgentCapabilityClaim | 受控目录/人工管理 | Capability Snapshot、Assignment |
| 本次任务能力要求 | CapabilityRequirement | Capability Derivation Service | Plan Review、Assignment、Approval |
| 本次成员能力事实 | ProjectCapabilityCatalogSnapshot | Capability Catalog Service | Assignment、Approval |
| 项目 owner/领域亲和事实 | AssignmentAffinitySnapshot + AgentProjectAffinityClaim | 人工/受管目录/已验证交付历史 | Assignment ranking、Review、审计 |
| Agent 对 Resource 的权限 | ResourceAccessGrant + GrantRevocation + ProjectAccessGrantSnapshot | Access Control Service | Assignment、Preflight、Approval、TaskRun、Integration |
| 全量候选选择/弃权评测 | AssignmentEvaluationRecord | Assignment Service | Release metric、审计 |
| 候选接手结论 | TaskPreflight（Agent report + Service verdict） | 审批前已确定的实际执行 Agent / TaskPreflight Service | Assignment finalization、Approval |
| 候选与选择理由 | AssignmentDecision | Assignment Service | Approval、Dispatcher、审计 |
| 计划批准事实 | PlanApprovalRecord | Approval Service | Dispatch、审计 |
| Squad 路由协作 | SquadCoordinationRecord | Squad Coordination Service | Dispatcher、审计；不作为执行成功 |
| 一次执行 | TaskRun（agentId=executingAgentId） | Runtime/Dispatcher | Verification、恢复、历史 |
| 验证结果 | VerificationEvidence | Verifier/Runtime | Delivery gate、Review、Release |
| TaskRun 输出的统一集成版本 | DeliveryIntegrationSnapshot + IntegrationInclusionEvidence | Integration Service | Convergence、Delivery close |
| 实现后规格收敛与修复基线 | DeliveryConvergenceReview + ConvergenceRepairBaseline + ConvergenceCarryValidation | Convergence Service，经 Reviewer 门禁 | 修复计划、successor commit/Approval、Delivery close |

Planner、Reviewer 和 Agent 都不是事实 source of truth。它们提出结构化候选结果；Service 校验、冻结、持久化并决定状态是否可推进。

### 5.2 状态流

PlanningOperation 的持久化 stage 逐字使用 canonical enum；执行与交付不属于 PlanningOperation：

```text
reserved -> source_ingest -> source_profile -> source_manifest
  -> requirement_analysis(seed scenarios) -> requirement_review
  -> source_policy_precheck -> decision_effect_precheck -> risk_profile
  -> scenario_completion -> scenario_coverage_review
  -> repository_snapshot -> canonical_target_binding -> policy_snapshot
  -> code_binding -> binding_review -> work_packages -> task_plan
  -> reference_mapping -> capability_requirement_derivation -> plan_review
  -> capability_catalog_snapshot -> access_grant_snapshot
  -> assignment_qualification -> task_preflight
  -> decision_effect_finalization -> convergence_carry_validation
  -> committing -> committed
```

PlanningOperation status 独立为 `running|blocked|failed|committed|shadow_completed|superseded|aborted`；Decision 未决、source/provider/access/assignment/Preflight 失败是 diagnostic/gate outcome，不是伪 stage。Approval 与 Dispatch 是独立 immutable command/record：

```text
committed PlanSnapshot -> PlanApprovalRecord
  -> ExecutionDispatchRecord(outcome=started|waiting_*|blocked|stale)
```

只有 Dispatch `started` 才进入独立 Delivery 生命周期：

```text
executing -> verifying -> integrating -> final_repository_snapshot
  -> convergence_reviewing -> delivered | changes_required | blocked | failed
```

每个阶段只消费已经冻结并通过门禁的上游事实。上游 digest 变化时，下游结果变为 `stale`，不得继续使用旧任务或旧分派。DecisionOptionEffect、两阶段 DecisionPlanningEffect、RiskProfile、EvidenceClaim、TaskContextPack、TaskPreflight 和 Review 保持不可变，不在旧记录上原地改状态；Service 统一比较 frozen input digest 与 Project current digest，派生 `freshness=current|stale` 和 `staleDimensions`。Commit、Approval、Dispatch 和 Convergence 只信该 Service 结果，UI 不自行计算 freshness。`TaskProposal`、CapabilityRequirement draft、Assignment draft 和 TaskPreflight 是 commit 前的不可执行规划事实；只有 final commit 才物化 WorkPackage、正式 CapabilityRequirement、AssignmentDecision、DeliveryTask 和 PlanSnapshot。`waiting_capacity/waiting_runtime` 表示计划语义和 owner 资格已通过、但暂时不能 dispatch，不与 `blocked_access`、`assignment_no_eligible_candidate` 或 Preflight `serviceVerdict=needs_clarification|rejected` 混用。

### 5.3 阶段责任

| 阶段 | LLM 职责 | Service 确定性职责 | 稳定 diagnostic / gate outcome |
| --- | --- | --- | --- |
| Source Profile | 无 | 先校验格式支持、页/块/附件覆盖、OCR 置信和 source digest | `source-evidence-incomplete` / blocked |
| Source Manifest | 无 | 在 complete profile 上建立全 parsed-block anchor、hint、classification/disposition 和 digest | `source-block-unclassified` / blocked |
| Requirement Analysis | 解释需求、场景、未知项及每个 Decision option 的显式/推导影响 | schema、source disposition、Decision option 引用闭包 | needs_decision / blocked |
| Requirement Review | 独立发现遗漏、冲突、不可测试项 | digest、全 block classification/normative disposition、repair 次数 | blocked |
| Source Policy Precheck | 只提出来源规则分类候选 | 从已分类 source anchor 冻结 MUST/SHOULD、authority、scope 和 unresolved 集合 | needs_confirmation / blocked |
| Decision Effect Precheck | 只提出 option 影响候选 | 只消费 current SourcePolicyPrecheck，在仓库 Binding 前保守计算 `potentiallyChangesDelivery/blocksPlanning` | needs_decision / blocked |
| Risk + Scenario Coverage Policy | 无或只提出候选 | 同一纯函数冻结 Risk 与每 Acceptance 七类 disposition | `planning-risk-profile-invalid` / blocked |
| Scenario Completion/Review | 补全 policy 要求的可执行 Scenario | exact-one policy、N/A reviewer、uncertain=0、required coverage 和 baseline 不弱化 | `acceptance-scenario-category-missing` / blocked |
| Repository Context | 无或仅辅助摘要 | 读取文件、manifest、符号、路由、schema、test、digest | `repository-provider-unavailable` / partial |
| Canonical Target Binding | 无 | 在当前 repository identity 上冻结唯一 resource、显式 local target ref、planning base 和 Integration principal | needs_confirmation / blocked |
| Policy Snapshot | 仅可提出仓库规则分类候选 | 合并 SourcePolicyPrecheck 与仓库规则；新增 applicable MUST 只能维持或加强 Decision/Plan 门禁 | needs_confirmation / blocked |
| Code Binding / EvidenceClaim | 提出需求到代码事实的映射及最小断言 | evidence read access、ID、path/symbol、支持/反证和关系完整性 | needs_decision / blocked |
| Binding Review | 独立检查 owner、claim 和影响链 | digest、关键链路门禁 | blocked |
| Decision Effect Finalization | 无 | 在 TaskPreflight 后、commit 前，以 Binding、Task、Capability 和 Assignment drafts 补全 owner/scope/dependency/capability/assignment/release 影响并终判 | needs_decision / blocked |
| WorkPackage/Task Proposal | 选择交付边界、依赖和 TaskContextPack | 覆盖、DAG、scope、command、目录校验 | blocked |
| Reference Mapping | 无 | 预留 PlanSnapshot ID，冻结 local key -> ID map，校验引用闭包 | blocked / failed |
| Capability Requirement Derivation | 无 | 从 Binding、风险和任务关系推导受控角色/能力要求 | `capability-mapping-unresolved` / blocked |
| Plan Review | 评估可执行性、TaskContextPack 和能力推导依据 | deterministic findings 合并 | blocked |
| Capability Catalog Snapshot | 无 | 冻结能力定义、active trusted claim、访问和 Runtime 类型事实 | `capability-claim-missing` / blocked |
| Assignment Qualification | 无权选择任意 Agent | 硬门禁、亲和评分、候选选择和容量/Runtime 状态 | waiting / blocked |
| Task Preflight | 最终候选复述目标并验证入口、范围、产物和验证可接手 | 禁止改写 Task 语义，校验 evidence access 和结构结果 | needs_clarification / rejected / accepted |
| Planning Commit | 无 | 物化 WorkPackage、正式 CapabilityRequirement、AssignmentDecision、DeliveryTask 和 PlanSnapshot，最后切 Project pointer | failed / stale |
| Delivery Integration | 无 | 将所有 required TaskRun 输出集成到唯一目标 revision，处理冲突和 stale | changes_required / blocked |
| Delivery Convergence | 在 canonical finalCommit 上发现实现与规格的语义差距 | final snapshot、scenario/policy coverage、finding 和 repair revision | changes_required / blocked |

## 6. 来源清单 V3.3

### 6.1 RequirementSourceProfile：先证明输入被完整读取

Source Manifest 的“100% disposition”只有在输入来源本身完整时才有意义。V3 对每个 PRD、技术方案和被声明为 normative 的附件先冻结解析画像：

```ts
interface RequirementSourceProfile {
  id: string
  projectId: string
  documentId: string
  authority: 'normative' | 'context'
  mediaType: 'markdown' | 'text' | 'pdf' | 'normalized_document'
  contentDigest: string
  parserId: string
  parserVersion: string
  totalPages?: number
  textPages?: number
  visualPages?: number
  analyzedVisualPages?: number[]
  totalBlocks: number
  parsedBlocks: number
  attachmentStatuses: Array<{
    attachmentId: string
    digest?: string
    status: 'readable' | 'missing' | 'unsupported' | 'uncertain'
  }>
  confidence: 'high' | 'medium' | 'low' | 'unknown'
  status: 'complete' | 'partial' | 'unsupported' | 'failed' | 'stale'
  authorityAudit?: { actor: string; reason: string; at: string }
  diagnostics: string[]
  profileDigest: string
}
```

首版只接受能够完整归一化为带 locator block 的 Markdown/plain text，以及文本或视觉页全部分析完成的 PDF。DOCX 等格式必须先通过受控 importer 完整转换为 `normalized_document`；仅抽样页面、只保存 URL、缺附件、OCR 低置信或图表未解析时，normative source 必须 `partial/unsupported` 并阻止规划。context source 可由人工降级排除，但必须记录 authority、reason 和 actor，不能把 normative source 改成 context 来绕过门禁。

### 6.2 从“关键词候选”升级为“normative 文档全 block 判定”

Source Manifest V3.3 必须保留文档结构，并把每个 `authority='normative'` 来源中成功解析的 block 都放入 classification inventory。章节名、列表、表格和“必须/不得”等约束词只能产生 `normativeHints`，用于排序和诊断，不能决定一个 block 是否免于判定。每个 block 必须先得到且只得到一个 `contentClassification='normative'|'context'|'duplicate'|'uncertain'`；其中 `uncertain` 仅是失败关闭的诊断态，不能进入 accepted manifest：

- `normative`：继续 disposition 为 Requirement、Acceptance、Decision、Constraint、Deferred 或 OutOfScope；
- `context`：必须保存分类 reason；若 block 含业务结果、状态变化、权限、失败、数据、兼容、迁移或 NFR 语义，必须由 Requirement Reviewer 明确确认；
- `duplicate`：必须引用同一 manifest 中已完成 classification 的主 block，不能形成环；
- 无法可靠分类时返回 `source-classification-uncertain` 并阻塞，不能默认降为 context。

这样，“所有规范性条目已处理”的分母先是完整 normative source 的全部 block，而不是关键词规则预先筛出的候选集。确定性解析器只负责形成全量 inventory 和 hints；Requirement Analysis/Review 负责语义分类，Service 负责全 block classification coverage 和 normative disposition coverage 两层门禁。

### 6.3 建议契约

```ts
interface RequirementSourceManifestV3 {
  contractVersion: 3
  sourceDigest: string
  sourceProfileIds: string[]
  sourceCompletenessDigest: string
  anchors: Array<{
    id: string
    documentId: string
    locator: string
    structuralKind:
      | 'heading' | 'paragraph' | 'list_item' | 'table_row'
      | 'code_block' | 'diagram_node' | 'attachment_block'
    normativeHints: Array<
      'requirement' | 'acceptance' | 'business_rule' | 'state_rule'
      | 'permission' | 'error_semantics' | 'nfr' | 'decision'
      | 'scope' | 'compatibility' | 'migration' | 'rollback'
    >
    textDigest: string
    parentAnchorId?: string
    contentClassification: 'normative' | 'context' | 'duplicate' | 'uncertain'
    classificationReason: string
    classificationReviewerId?: string
    duplicateOfAnchorId?: string
    requiredDisposition: boolean // 当且仅当 contentClassification='normative'
    dispositionPolicyVersion: string
  }>
  totalNormativeBlocks: number
  classifiedBlockCount: number
  classificationCoverageDigest: string
}
```

### 6.4 门禁

- 所有 normative source block 都必须有且只有一个 `contentClassification`，`classifiedBlockCount / totalNormativeBlocks = 100%`；
- 所有 `contentClassification='normative'` anchor 必须 `requiredDisposition=true`，且只能被一个主 disposition 消费；
- `context` 必须有 reason；命中业务结果/状态/权限/失败/数据/兼容/迁移/NFR hint 的 context 必须有 Reviewer ID；`uncertain` 一律阻塞；
- 所有 normative RequirementSourceProfile 必须 `complete`，页/块/附件覆盖率为 100%；
- 一个 anchor 可以作为多个 Acceptance 的辅助 sourceRef，但必须有唯一主 classification/disposition；
- `deferred/out_of_scope` 必须给理由、owner 和重新进入条件；
- normative anchor 被 LLM 判断为“仅背景”时必须由 Reviewer 复核；
- 附件只保存 URL 不够，必须保存 hash、可读取状态和 locator；
- OCR 或 PDF block 置信不足时返回 `source_evidence_uncertain`，不得静默忽略。
- `visualPages > analyzedVisualPages`、抽样页、缺图表/附件或 parser unsupported 时返回 `source-evidence-incomplete`，不能只显示 warning 后继续。

### 6.5 AcceptanceScenario 契约

AcceptanceCriterion 保留用户原始验收语句和 sourceRef；AcceptanceScenario 把验收语义转换为可执行、可证伪的场景。两者不能互相替代：原始语句用于保真，Scenario 用于规划和验证。

```ts
interface AcceptanceScenario {
  id: string
  projectId: string
  requirementItemId: string
  acceptanceCriterionId: string
  key: string
  category:
    | 'happy_path' | 'business_rejection' | 'boundary'
    | 'dependency_failure' | 'security' | 'compatibility' | 'recovery'
  preconditions: string[]
  trigger: string
  expectedOutcomes: string[]
  observableAt: Array<'api' | 'ui' | 'database' | 'event' | 'log' | 'artifact' | 'metric'>
  eventObservables: Array<{
    key: string
    description: string
    expectation: 'present' | 'absent'
  }>
  examples: Array<{ name: string; inputs: Record<string, unknown>; expected: Record<string, unknown> }>
  sourceAnchorIds: string[]
  derivationPhase: 'seed' | 'completion'
  required: boolean
  digest: string
}

interface AcceptanceScenarioCoveragePolicy {
  id: string
  projectId: string
  operationId: string
  requirementItemId: string
  acceptanceCriterionId: string
  riskDerivationInputDigest: string
  categories: Array<{
    category: AcceptanceScenario['category']
    applicability: 'required' | 'not_applicable' | 'uncertain'
    reasonCode: string
    sourceAnchorIds: string[]
    reviewerId?: string
  }>
  baselineOperationId?: string
  baselineCoveragePolicyDigest?: string
  policyVersion: string
  digest: string
}
```

门禁：

- Requirement Analysis 只产出 seed Scenario，Decision precheck 只消费 seed；Risk stage 原子冻结 PlanningRiskProfile 与每个 required Acceptance 恰一 CoveragePolicy；随后 Scenario Completion/Review 补全并审核 required categories；
- 每条 CoveragePolicy 对七类 category 恰有一项 disposition；`happy_path` 必须 required，N/A 必须有 reason/source，命中 risk/hint 的 N/A 要独立 reviewer，uncertain 阻塞；
- aggregate digest 由按 Acceptance ID 排序后的 per-policy digest 计算，并进入 Risk、Plan、freshness、Approval；CoveragePolicy 与 Risk required-category union 必须完全一致；
- coverage repair successor 必须绑定 predecessor baseline，除非 source/Decision input stale，否则不得删除或弱化 required category；
- 每个 required AcceptanceCriterion 至少有一个 required Scenario；
- `preconditions`、`trigger`、`expectedOutcomes` 和 `observableAt` 不得为空；
- `observableAt` 含 `event` 时，Scenario 中每个独立持久化记录、发出事件、消息或副作用信号都必须有唯一 `EVT-*` key 的 `eventObservables` 项；Dispatch、TaskRun 和 ActivityEvent 不能合并为一个事实；无 event 观察面时该数组必须为空；
- Code Binding 必须按 `eventObservableKey` 为每个冻结事件事实提供恰好一条 source-of-truth chain，且 present/absent 语义一致；漏映射、重复映射、跨 Scenario/Requirement 映射均确定性阻塞；
- `happy_path` 不能替代适用的业务拒绝、边界、依赖失败、安全、兼容或恢复场景；
- Scenario 的业务结果必须能追溯到原始 anchor；推导内容标记 inference 并由 Requirement Reviewer 审查；
- DeliveryTask 必须引用 Scenario ID，implementation 和 verification 分别覆盖 required Scenario；
- VerificationEvidence 必须说明观察面和实际结果，不能只记录“命令 exitCode=0”。

### 6.6 Decision 使用两阶段影响门禁

`impact` 只表示决策错误的业务后果，不能单独决定是否允许规划。Binding 前尚没有可信代码 owner、Capability 和 Assignment 事实，因此不能在 Requirement Analysis 后一次性声称已经算出完整交付影响。V3.3 先冻结每个选项的来源级影响，再在 Binding Review 后完成代码级终判：

```ts
type DecisionEffectDimension =
  | 'requirement' | 'scenario' | 'policy' | 'binding'
  | 'task_scope' | 'dependency' | 'verification'
  | 'capability' | 'assignment' | 'release'

interface DecisionOptionEffect {
  decisionId: string
  optionKey: string
  affectedDimensions: DecisionEffectDimension[]
  affectedObjectKeys: string[]
  derivation: 'explicit' | 'inferred' | 'human_confirmed'
  evidenceAnchorIds: string[]
  potentiallyChangesDelivery: boolean
  digest: string
}

interface DecisionPlanningEffect {
  phase: 'precheck' | 'final'
  decisionStatus: 'pending' | 'resolved' | 'deferred' | 'rejected'
  chosenOptionKey?: string
  decisionResolutionRevision: number
  decisionResolutionDigest: string
  sourcePolicyPrecheckId: string
  sourcePolicyDigest: string
  optionEffectIds: string[]
  affectedDimensions: DecisionEffectDimension[]
  affectedRequiredObjectIds: string[]
  blocksPlanning: boolean
  determination:
    | 'conservative_default'
    | 'evidence_confirmed'
    | 'human_confirmed_cosmetic'
  reason: string
  nonBlockingAudit?: { actor: string; reason: string; at: string }
  policyVersion: string
  digest: string
}
```

门禁顺序固定为：

1. Requirement Analyzer 为每个可选项生成 `DecisionOptionEffect`，Requirement Reviewer 检查遗漏和无依据推断；
2. `source_policy_precheck` 先冻结来源 MUST/SHOULD；`decision_effect_precheck` 只使用 source anchor、Requirement、seed Scenario、current SourcePolicyPrecheck，并冻结 Decision 当前 status/chosen option/resolution revision+digest。任何 option 可能改变 required delivery object 时，pending Decision 按 `conservative_default` 阻塞；Decision resolution 变化必须创建新 current attempt，不能沿用旧选择或越过 precheck；
3. TaskPreflight 后、final commit 前运行 `decision_effect_finalization`，同时消费 current Binding Review、TaskProposal、CapabilityRequirementDraft、AssignmentDraft 和 Preflight，把真实代码 owner、scope、dependency、verification、CapabilityRequirement、Assignment 和 release 影响补入最终 effect；
4. candidate commit 和 approval 必须同时持有 current precheck 与 final effect，且两者均不存在 unresolved blocking Decision；
5. high/critical pending 默认 blocking。只有人工逐一确认所有 option 都不会改变本期 required delivery object，才能用 `human_confirmed_cosmetic` 标为 non-blocking，并保存 actor、reason、option effect 和审计时间；
6. Reviewer/人工不能直接覆盖 `blocksPlanning=false`。它必须通过新的 effect revision 重算，旧 effect 保持不可变并进入 stale/audit。

测试必须验证从 option 到 `blocksPlanning` 的推导和反例，不能只构造一个已经为 `true` 的布尔值测试 Approval gate。

### 6.7 PlanningRiskProfile：按风险增加规划深度

Requirement Review 和 Decision precheck 通过后，Service 以 Requirement、source hints、seed Scenario 和 Decision effect 为冻结输入，用同一版本化纯函数原子生成不可变风险档案与 per-Acceptance CoveragePolicy；完整 Scenario 在随后 completion/review stage 生成，不能反向成为 Risk 输入：

```ts
interface PlanningRiskProfile {
  id: string
  projectId: string
  operationId: string
  level: 'low' | 'medium' | 'high' | 'critical'
  dimensions: Array<
    'data' | 'state' | 'permission' | 'async' | 'api'
    | 'security' | 'performance' | 'migration' | 'release'
  >
  requiredEvidenceKinds: string[]
  requiredReviewKinds: Array<'requirement' | 'binding' | 'plan' | 'assignment' | 'convergence'>
  requiredScenarioCategories: string[]
  acceptanceScenarioCoveragePolicyIds: string[]
  acceptanceScenarioCoveragePolicyDigest: string
  riskDerivationInputDigest: string
  requiresIndependentReviewer: boolean
  requiresTaskPreflight: boolean
  requiresConvergence: boolean
  reasonSourceAnchorIds: string[]
  digest: string
}
```

规则：

- `low` 允许使用轻量 repository provider 和单轮自动 Review，但仍要求完整 normative source、真实 Evidence ID、TaskContextPack 和 false-ready 门禁；
- `medium` 涉及 API、读写边界或跨模块时，必须 Binding Review 和 TaskPreflight；
- `high` 涉及权限、状态、数据迁移、异步、外部 API 或关键业务规则时，CoveragePolicy 必须要求相应 `business_rejection|dependency_failure|security|compatibility|recovery` Scenario、独立 Binding/Plan Review 和独立交付 Reviewer；
- `critical` 涉及安全、资金、库存、不可逆迁移、生产发布或多系统一致性时，必须人工确认关键 owner/Decision，并执行最终 Convergence；
- 风险只能增加证据和门禁，不能把 normative source 降为 context、允许 snapshot 外引用、绕过硬资格或容忍 critical false-ready。

## 7. Repository Context Snapshot

### 7.1 原则

Repository Context 必须由 Service 或可信的只读索引器生成，不能由 Planner 自报。Planner 只接收已冻结、带 digest 的证据节点，并引用 evidence ID。

索引范围基于项目 cwd 的 canonical path。所有路径必须：

- `realpath` 后仍位于项目根目录；
- 遵守 ignore、大小、文件类型和敏感文件策略；
- 记录 git commit/tree hash；无 Git 时记录 root digest 和 snapshot 时间；
- 对实际内容或可验证片段生成 digest；
- 不读取 `.env`、credential、private key 等敏感内容；
- 不执行从 PRD、README 或代码注释中提取的任意命令。

### 7.2 证据内容

最低可用快照包含：

1. 项目规则：`AGENTS.md`、README、贡献规范、测试和发布说明；
2. manifests：package、workspace、build、dependency、migration 配置；
3. 目录与模块：源码根、服务、页面、组件、测试、脚本、部署目录；
4. symbol：导出函数、类、类型、路由 handler、数据库 model、event/job/consumer；
5. 关系：import/call、route -> service、service -> repository/schema、producer -> consumer、source -> test；
6. 运行命令：manifest 中声明的 lint/typecheck/test/build/migrate 命令及来源；
7. 当前测试：unit/integration/e2e 文件、fixture、覆盖的 symbol 或 route；
8. 变更状态：git dirty paths、当前 branch/commit、generated/vendor 路径；
9. 索引限制：未解析文件、超限目录、不支持语言、语法错误和缺失依赖。

Graphify、LSP、Tree-sitter 或框架适配器可以作为 symbol/relationship provider，但输出必须统一进入同一证据契约。某个 provider 不可用时必须降低快照 completeness，不能用 LLM 猜测补齐。

### 7.3 建议契约

```ts
interface RepositoryContextSnapshot {
  id: string
  projectId: string
  contractVersion: 1
  subject:
    | { kind: 'planning'; planningOperationId: string }
    | { kind: 'final_delivery'; deliveryIntegrationSnapshotId: string; exactCommit: string }
  rootRealPath: string
  gitCommit?: string
  gitTree?: string
  dirtyPathDigests: Array<{ path: string; digest: string }>
  createdAt: string
  providers: Array<{
    id: string
    version: string
    status: 'complete' | 'partial' | 'failed'
    diagnostics: string[]
  }>
  evidence: RepositoryEvidenceNode[]
  commands: VerificationCommandEvidence[]
  completeness: {
    manifests: 'complete' | 'partial' | 'missing'
    symbols: 'complete' | 'partial' | 'unsupported'
    relationships: 'complete' | 'partial' | 'unsupported'
    tests: 'complete' | 'partial' | 'missing'
  }
  digest: string
}

interface RepositoryEvidenceNode {
  id: string
  kind:
    | 'rule' | 'manifest' | 'module' | 'file' | 'symbol' | 'route'
    | 'schema' | 'state_transition' | 'event' | 'job' | 'test' | 'config'
  path: string
  pathDigest: string
  symbol?: string
  locator?: { startLine: number; endLine: number }
  contentDigest: string
  relationships: Array<{
    type: 'imports' | 'calls' | 'reads' | 'writes' | 'routes_to'
      | 'produces' | 'consumes' | 'tests' | 'guards'
    targetEvidenceId: string
  }>
  tags: string[]
}

interface VerificationCommandEvidence {
  id: string
  command: string
  cwd: string
  originEvidenceId: string
  trust: 'declared' | 'probe_passed' | 'baseline_passed'
  lastExitCode?: number
  lastRunAt?: string
}
```

`subject.kind='final_delivery'` 时必须绑定 `DeliveryIntegrationSnapshot` 和其精确 `finalCommit`，`gitCommit` 必须等于该 commit，工作树必须 clean；这些字段进入 snapshot digest。规划快照只允许 `subject.kind='planning'`，final snapshot 不伪挂到已经结束的 PlanningOperation。

### 7.4 修正“verified command”语义

从 manifest 读取到 `pnpm test` 只能证明它是 declared command，不能声称测试通过。V3 应区分：

- `declared`：命令由可信 manifest 或项目规则解析；
- `probe_passed`：完成低成本、安全、非破坏性可用性探测；
- `baseline_passed`：在冻结 revision 上实际执行并成功。

Plan 可以引用 `declared` 命令，但 UI 和审计必须显示真实 trust。是否要求 baseline 通过由风险和发布策略决定，不能把“Planner 写进数组”命名为 verified。

### 7.5 RepositoryStackProfile 与支持边界

Repository Provider Orchestrator 必须先形成技术栈画像，再决定当前版本能否提供足够的语义证据：

```ts
interface RepositoryStackProfile {
  repositorySnapshotId: string
  languages: Array<{ id: string; confidence: 'high' | 'medium'; evidenceIds: string[] }>
  frameworks: Array<{ id: string; confidence: 'high' | 'medium'; evidenceIds: string[] }>
  dataTechnologies: Array<{ id: string; confidence: 'high' | 'medium'; evidenceIds: string[] }>
  providerCoverage: Array<{
    providerId: string
    capability: 'inventory' | 'symbols' | 'routes' | 'schema' | 'relationships' | 'tests' | 'commands'
    status: 'complete' | 'partial' | 'unsupported'
  }>
  planningSupport: 'supported' | 'partial' | 'unsupported'
  diagnostics: string[]
  digest: string
}
```

V3 首个 candidate release 只支持 TypeScript 技术栈中已由 Provider 覆盖的 Nuxt/Vue/Prisma 组合及其已声明子集。其他技术栈在只有 filesystem/manifest inventory、缺少适用 semantic provider 时必须返回 `unsupported-stack` 或 `repository-snapshot-partial`，不能以通用文本搜索冒充已理解代码逻辑。

若产品要对所有本地仓库声明“好用”，release gate 必须至少再覆盖 Java/Maven/Gradle/Spring 与 Python/FastAPI/Django Provider、Gold fixture 和真实模型评测。未达到前，UI 和发布说明必须展示支持矩阵。

### 7.6 PlanningPolicySnapshot

`AGENTS.md`、项目规则、贡献规范、manifest 约束和管理员策略不能只作为普通 evidence。Service 应从可信范围中提取规范性候选，并冻结为：

```ts
interface PlanningPolicySnapshot {
  id: string
  projectId: string
  repositorySnapshotId: string
  constraints: Array<{
    id: string
    authority: 'administrator' | 'project_rule' | 'repository_guidance'
    level: 'must' | 'should'
    statement: string
    appliesToStages: Array<'binding' | 'planning' | 'execution' | 'verification' | 'delivery'>
    pathScopes: string[]
    sourceEvidenceIds: string[]
    status: 'active' | 'needs_confirmation' | 'superseded'
  }>
  digest: string
}
```

每条 active `must` Policy 必须映射到 RequirementCodeBinding、DeliveryTask、Verification 或明确的 `not_applicable + reason`。Policy digest 进入 PlanSnapshot、Approval、TaskRun 和 DeliveryConvergenceReview；违反 MUST 时失败关闭。README 或代码注释中的普通建议不自动升级为 MUST，authority/level 不确定时请求人工确认。

### 7.7 EvidenceClaim：证明结论由证据支持

Evidence access 只证明模型读取过某个 evidence，不证明 owner、写路径、状态流或测试面的结论正确。Binding Agent 必须先提交最小可审查断言：

```ts
interface EvidenceClaim {
  id: string
  projectId: string
  operationId: string
  subjectType: 'requirement' | 'scenario' | 'binding' | 'task'
  subjectId: string
  claimType:
    | 'current_owner' | 'source_of_truth' | 'write_path' | 'read_path'
    | 'state_transition' | 'permission_guard' | 'failure_path'
    | 'consumer' | 'test_surface' | 'scope_boundary'
  statement: string
  supportingEvidenceIds: string[]
  contradictingEvidenceIds: string[]
  confidence: 'high' | 'medium' | 'low'
  status: 'proposed' | 'confirmed' | 'disputed' | 'rejected'
  claimDigest: string
}
```

Service 校验 claim 引用的 Evidence 必须属于当前 RepositoryContextSnapshot，且出现在同一 Binding stage attempt 的 `read` access 集合。确定性校验只负责引用闭包；独立 Binding Reviewer 负责判断 statement 是否被支持。critical claim 无 supporting evidence、存在未解决 contradicting evidence、置信度不足或 status=`disputed/rejected` 时，Binding 不得 ready。

## 8. RequirementCodeBinding

### 8.1 目的

RequirementCodeBinding 是 V3 的关键新增层，用于回答：

- 当前行为由谁拥有；
- 正确修改层在哪里；
- 写路径、读路径、状态推进、失败和权限路径是什么；
- 哪些既有消费者和测试会受影响；
- 这是修改现状、新增能力、删除行为还是仍未知；
- 为什么任务需要某种技术和领域能力。

没有 Binding，Planner 容易按 PRD 标题拆任务；有 Binding，Task 才能按真实代码 owner 和交付链形成。

### 8.2 建议契约

```ts
interface RequirementCodeBinding {
  id: string
  key: string
  requirementItemId: string
  acceptanceCriterionIds: string[]
  acceptanceScenarioIds: string[]
  decisionIds: string[]
  policyConstraintIds: string[]
  planningRiskProfileId: string
  repositorySnapshotId: string
  changeIntent: 'existing' | 'modify' | 'new' | 'remove' | 'unknown'
  domain: string
  evidenceClaimIds: string[]
  sourceOfTruthEvidenceIds: string[]
  entryPointEvidenceIds: string[]
  writePathEvidenceIds: string[]
  readPathEvidenceIds: string[]
  stateOwnerEvidenceIds: string[]
  permissionEvidenceIds: string[]
  failurePathEvidenceIds: string[]
  consumerEvidenceIds: string[]
  existingTestEvidenceIds: string[]
  proposedNewSurfaces: Array<{
    kind: 'file' | 'symbol' | 'route' | 'schema' | 'event' | 'test'
    parentEvidenceId: string
    proposedName: string
    reason: string
  }>
  unknowns: Array<{
    code: string
    impact: 'low' | 'medium' | 'high' | 'critical'
    question: string
    evidenceNeeded: string
  }>
  rationale: string
  digest: string
}
```

### 8.3 Binding 完整性规则

对每个 required Acceptance：

- 必须关联至少一个 Binding；
- `modify/remove` 必须有真实 existing evidence；
- `new` 必须有 parent module 或 bounded context evidence，不能直接编造任意路径；
- 涉及持久化时必须标出 schema/source of truth、写路径、读路径和事务/失败路径；
- 涉及状态时必须标出 state owner、合法转换和失败时是否推进；
- 涉及权限时必须标出 guard 和拒绝路径；
- 涉及异步时必须标出 producer、consumer、幂等、重试/死信或明确 unknown；
- 必须引用现有测试，或明确为什么是新测试面；
- current owner、source of truth、写路径、状态、权限、失败、consumer 和测试结论必须由 EvidenceClaim 支持；
- critical claim 无支持证据、存在未解决反证、低置信或 disputed/rejected 时必须 blocked；
- high/critical unknown 必须生成 Decision 或使 Binding `blocked`。

Binding Reviewer 与创建 Binding/EvidenceClaim 的 Agent 必须分离。Reviewer 不以“看起来合理”批准，而是返回 missing owner、unsupported claim、contradicting evidence、orphan consumer、unverified new surface、state/failure gap 等结构化 finding。

### 8.4 Capability 治理与推导

Capability 不是任意字符串，也不能由 Planner 为了匹配现有成员而挑选。V3 新增三个 source of truth：

```ts
interface CapabilityDefinition {
  id: string
  version: number
  category: 'language' | 'framework' | 'data' | 'testing' | 'domain' | 'release' | 'review'
  name: string
  description: string
  parentCapabilityIds: string[]
  status: 'active' | 'deprecated'
}

interface AgentCapabilityClaim {
  id: string
  agentId: string
  capabilityId: string
  scope: 'global' | 'project'
  projectId?: string
  source: 'human_confirmed' | 'managed_registry'
  status: 'active' | 'revoked'
  confirmedBy: string
  confirmedAt: string
}

interface ProjectCapabilityCatalogSnapshot {
  projectId: string
  definitionVersions: Array<{ capabilityId: string; version: number }>
  activeClaimIds: string[]
  digest: string
}
```

能力资格和 owner 选择分开治理。为避免“能做”被误当成“最适合”，项目亲和和历史必须来自受控事实：

```ts
interface AgentProjectAffinityClaim {
  id: string
  projectId: string
  agentId: string
  repositoryIdentityDigest: string
  boundedContext: string
  pathPrefixes: string[]
  capabilityIds: string[]
  proficiency: 'primary' | 'secondary' | 'familiar'
  provenance: 'human_confirmed' | 'managed_registry' | 'verified_delivery_history' | 'codeowners'
  sourceRecordIds: string[]
  status: 'active' | 'expired' | 'revoked'
  validUntil?: string
}

interface AssignmentAffinitySnapshot {
  id: string
  projectId: string
  operationId: string
  repositoryIdentityDigest: string
  claimIds: string[]
  verifiedDeliveryHistoryIds: string[]
  policyVersion: string
  digest: string
}
```

每个评分贡献必须携带 `sourceRecordIds`；未知事实使用中性值，不把缺少历史当成负面能力。高/critical Task 出现多个同等 eligible owner 且没有可信 differentiator 时返回 `assignment-owner-ambiguous`，不能靠 ID 排序伪造“正确 owner”；低风险任务才允许显式记录低置信 tie-break，并纳入质量指标。

Service 根据 Binding evidence、impact dimension、Task relationship 和受控映射规则生成 CapabilityRequirement。例如：

```text
TypeScript symbol change -> language.typescript
Nuxt server route       -> framework.nuxt.server
Prisma schema/migration -> data.prisma + database.migration
verification task       -> testing.integration or testing.unit
high-risk review        -> review.independent
```

V3.3 Planner 契约不输出 `requiredRoleIds` 或 `requiredCapabilityIds`。它只输出任务关系、Binding、Evidence、scope 和验证责任；Service 由版本化规则推导 role/capability requirement，并在 Plan Review 前冻结。无法映射关键能力时返回 `capability-mapping-unresolved`，不能降为通用 `implementation`。

Agent 自报 Persona、Skill、description 或历史输出不能生成 active claim。旧自由字符串 capability 只能进入迁移待确认清单，经人工映射到 CapabilityDefinition 后才参与 V3 硬资格。

## 9. 代码感知任务拆解

### 9.1 两级拆解

V3 使用两级拆解，避免一次输出任意数量的 Task。

第一级先生成 WorkPackageProposal，围绕一个业务目标和一组紧密相关的代码 owner；proposal 使用 operation-local key，final commit 后正式 WorkPackage 只保存稳定 ID：

```ts
interface WorkPackageProposal {
  key: string
  objective: string
  requirementKeys: string[]
  acceptanceKeys: string[]
  scenarioKeys: string[]
  decisionKeys: string[]
  policyConstraintIds: string[]
  bindingKeys: string[]
  primaryDomain: string
  ownerEvidenceIds: string[]
  dependencyKeys: string[]
  riskDimensions: Array<
    'data' | 'state' | 'permission' | 'async' | 'compatibility'
    | 'security' | 'performance' | 'release'
  >
  expansion: 'keep' | 'required'
  expansionReasons: string[]
}

interface WorkPackage {
  id: string
  requirementIds: string[]
  bindingIds: string[]
  dependencyWorkPackageIds: string[]
  workPackageDigest: string
}
```

第二级把复杂 WorkPackage 展开为 DeliveryTask。展开依据不是固定“每个任务几个文件”，而是以下事实：

- 是否跨多个 state owner 或事务边界；
- 是否同时修改 schema、write service、API、UI 和异步消费者；
- 是否存在可独立验证的中间交付；
- 是否需要不同 capability 或不同 Agent；
- 是否有冲突文件导致无法并行；
- 是否需要 migration/backfill/rollout/rollback；
- 单个上下文是否会过大，导致 Agent 难以完整理解。

### 9.2 TaskContextPack 与 DeliveryTask V3

Task 不是标题和文件列表，而是最终候选 Agent 可以复述、验证并接手的交付合同。Planner proposal 和最终 DeliveryTask 共享同一份不可变上下文包：

```ts
interface TaskContextPack {
  objective: string
  whyNow: string
  inScope: string[]
  outOfScope: string[]
  requirementStatements: string[]
  currentBehaviorClaimIds: string[]
  targetBehavior: string
  startingPoints: Array<{ evidenceId: string; reason: string }>
  expectedChangeSurfaces: string[]
  forbiddenChangeSurfaces: string[]
  dependencies: Array<{ taskKey: string; reason: string; completionRequired: boolean }>
  invariants: string[]
  verificationSteps: Array<{
    scenarioKey: string
    action: string
    expectedObservable: string
    commandEvidenceId?: string
  }>
  expectedArtifacts: string[]
  escalationConditions: string[]
  unknowns: Array<{ question: string; blocking: boolean; owner: string }>
}

interface GeneratedDeliveryTaskProposalV3 {
  key: string
  workPackageKey: string
  title: string
  objective: string
  relationship: 'implementation' | 'verification' | 'review' | 'migration' | 'release'
  requirementKeys: string[]
  acceptanceKeys: string[]
  scenarioKeys: string[]
  decisionKeys: string[]
  policyConstraintIds: string[]
  bindingKeys: string[]
  evidenceIds: string[]
  contextPack: TaskContextPack
  changeContract: {
    existingOwnerEvidenceIds: string[]
    allowedExistingScopeEvidenceIds: string[]
    proposedNewSurfaces: string[]
    forbiddenScopeEvidenceIds: string[]
    invariants: string[]
    failureSemantics: string[]
  }
  completionCriteria: string[]
  verification: Array<{
    scenarioKey: string
    commandEvidenceId?: string
    evidenceExpected: string
  }>
  dependencies: string[]
  conflictEvidenceIds: string[]
  escalationConditions: string[]
}

interface DeliveryTaskV3 {
  id: string
  planSnapshotId: string
  workPackageId: string
  sourceRequirementIds: string[]
  acceptanceCriterionIds: string[]
  acceptanceScenarioIds: string[]
  decisionIds: string[]
  policyConstraintIds: string[]
  bindingIds: string[]
  dependencyTaskIds: string[]
  capabilityRequirementId: string
  relationship: 'implementation' | 'verification' | 'review' | 'migration' | 'release'
  taskRevision: number
  contextPackDigest: string
  proposalDigest: string
}
```

Planner 只产生 `GeneratedDeliveryTaskProposalV3`，所有 Requirement、Acceptance、Scenario、Decision 和 Binding 都使用同一轮分析生成的稳定 local key；Policy、Evidence 和 Command 使用冻结快照中的真实 ID。Planner 不能返回 raw Agent/Squad ID、role/capability requirement、raw path、raw command 或未经绑定的 capability。新文件只允许通过 `proposedNewSurfaces` 表达，并必须锚定已有 bounded context。

`DeliveryTaskV3` 是 Service 在 proposal、CapabilityRequirement draft、Plan Review、候选资格和 TaskPreflight 全部通过，并完成 `decision_effect_finalization` 且确认两阶段 Decision effect 均 current/non-blocking 后，于 final commit 一次性物化的不可变事实。CapabilityRequirement 由 Service 根据 Binding、风险档案、任务关系和版本化规则推导，既不属于 Planner proposal，也不作为 Task 内的第二份能力真相。TaskContextPack 必须通过 digest 冻结；Preflight 不能原地修改它。

### 9.3 PlanningReferenceMap 与不可变物化

一次规划同时涉及模型 local key、跨对象引用和持久化 ID。V3 不允许边写边反查或在 PlanSnapshot 建好后重写 Task，而是在 operation reserve 时预留 PlanSnapshot ID，并在 proposal 校验后冻结唯一引用表：

```ts
interface PlanningReferenceMap {
  id: string
  operationId: string
  reservedPlanSnapshotId: string
  reservedPlanRevision: number
  requirementIdsByKey: Record<string, string>
  acceptanceIdsByKey: Record<string, string>
  scenarioIdsByKey: Record<string, string>
  decisionIdsByKey: Record<string, string>
  bindingIdsByKey: Record<string, string>
  workPackageIdsByKey: Record<string, string>
  taskIdsByKey: Record<string, string>
  capabilityRequirementIdsByTaskKey: Record<string, string>
  assignmentDecisionIdsByTaskKey: Record<string, string>
  reusedObjectIdsByKey?: Record<string, string>
  mapDigest: string
}
```

物化顺序固定为：

1. reserve operation 时同时预留 PlanSnapshot ID/revision；
2. Requirement Analysis/Binding 通过各自 Review 后，冻结 requirement/acceptance/scenario/binding key 映射；
3. Planner proposal 通过 schema、引用闭包、覆盖和 DAG 校验后，预分配 WorkPackage/Task/CapabilityRequirement/AssignmentDecision ID 并补全同一张 map；预分配 ID 只是引用地址，不代表记录已经存在；
4. Service 生成不可执行的 CapabilityRequirementDraft，并在 Plan Review 前冻结；Plan Review 通过后再冻结能力目录和候选资格；
5. AssignmentDraft 选出最终候选后执行 TaskPreflight；Agent report 非 accepted 或 Service verdict 为 `needs_clarification/rejected` 时按单调 repair lineage 产生新 revision，不能修改原 proposal；只有 `serviceVerdict='accepted'` 允许进入最终 Decision 影响计算，不直接授权 commit；
6. `decision_effect_finalization` 消费 current Binding Review、TaskProposal、CapabilityRequirementDraft、AssignmentDraft 和 TaskPreflight，生成并冻结 final effect；precheck/final effect 任一 stale、缺失或 blocking 都终止物化；
7. blocked 计划只保留 PlanningProposalPack、reference diagnostics、effect、draft 和审计事实，不创建 DeliveryTask、正式 CapabilityRequirement 或 AssignmentDecision；
8. final commit 在短临界区内复核两阶段 Decision effect 和全部 frozen digest，再按 reference map 一次写入 WorkPackage、正式 CapabilityRequirement、AssignmentDecision、DeliveryTask 和 PlanSnapshot，最后切 Project pointer；创建后不得为了补 `planSnapshotId` 或 dependency ID 再重写；
9. 崩溃恢复按 `operationId + mapDigest` 证明 ownership，删除或 tombstone 仅属于该 operation 的部分物化记录；无法证明归属时保留 orphan diagnostic，不猜测修复。

`append/revise` 为本轮新对象创建新 key map；复用旧对象时显式记录 `reusedObjectIdsByKey` 和来源 PlanSnapshot。key 只在一个 operation 内唯一，持久化 ID 才是跨 revision 身份，禁止把同名 key 当成同一业务对象。

### 9.4 任务边界规则

一个高质量 DeliveryTask 应满足：

- 一个明确业务目标，而不是“完成所有后端改造”；
- 默认只有一个主要 state owner 或事务 owner；
- 输入、输出、副作用和失败语义明确；
- allowed scope 来自 Binding，不是 Planner 自由填写；
- completion criteria 描述 Task 完成，不替代项目 Acceptance；
- verification 至少覆盖本任务相关的 `happy_path`、`business_rejection`、`boundary` 和受影响失败路径；
- 测试任务必须新增或强化测试及证据，不得只是执行已有命令；
- migration、backfill、数据修复、权限、异步和 release 行为不能藏在普通 code Task 描述中；
- 一个 Task 引用很多 Acceptance 并非错误，只要它们属于同一业务 owner 和原子行为；
- 一个 Acceptance 可以由多个 Task 交付，但必须能解释依赖和最终验证责任。

### 9.5 依赖推导

依赖优先来自代码与业务事实：

```text
Decision / schema contract
  -> migration or compatibility layer
  -> domain write/state owner
  -> API / event producer
  -> read model / consumer
  -> UI integration
  -> integration/e2e verification
  -> release/rollback verification
```

Planner 可以提出 DAG，但 Service 必须检查：

- 引用闭合和无环；
- dependency 与 Binding relationship 不矛盾；
- 同一 state owner 的冲突写不会错误并行；
- migration/backfill 不晚于依赖它的新读写路径；
- verification 不早于其覆盖的 implementation；
- release Task 不早于 required verification evidence。

## 10. 以 lscity-nuxt 为例的正确拆解形态

`lscity-nuxt` 当前仓库存在可验证的模型领域 owner，包括但不限于：

- `prisma/schema.prisma`：持久化模型和关系；
- `server/utils/model-instance.ts`：模型实例与动作状态；
- `server/utils/model-submission.ts`：提交记录和结果组装；
- `server/utils/model-submission-ai-report*.ts`：AI 报告资格、契约、执行和读取；
- `server/utils/model-access.ts`、`permission*.ts`：可见性、写权限和拒绝路径；
- `server/utils/admin-handlers/model-management.ts`：管理端模型生命周期；
- `server/utils/upload-session.ts`：上传会话与 finalized key；
- `server/utils/audit-log.ts`：审计事实；
- `server/api/model-instances/**`、`server/api/model-submissions/**`、`server/api/admin/models/**`：入口路由；
- 对应 Vitest、API test、组件 test 和 Playwright 预生产测试。

因此，面对“模型提交、权限、AI 报告、对比和管理”类 PRD，正确流程不是直接生成“后端实现、前端实现、测试”三个泛任务，而应先形成类似绑定：

| Requirement 关注点 | 需要确认的真实 owner | 必须跟随的影响链 |
| --- | --- | --- |
| 提交不可覆盖历史 | Prisma submission model、`model-submission.ts` | 写事务、读取历史、copy/rename/delete API、审计、回归测试 |
| 提交后生成 AI 报告 | eligibility、contract、worker、report service | enqueue、幂等、失败恢复、读取 API、状态展示、worker test |
| 仅有权限用户可操作 | `model-access.ts`、permission middleware | API guard、业务拒绝、列表可见性、管理端路径、negative test |
| 草稿/提交状态转换 | `model-instance.ts`、draft service、submit route | state owner、并发提交、失败不推进、autosave、API test |
| 管理端发布模型 | `model-management.ts`、publication API、schema | 发布状态、用户侧 read path、回滚、audit、admin test |

随后才按 owner 和风险展开 WorkPackage。只引用 `src` 或 `package.json` 的计划应被 Plan Reviewer 判为证据粒度不足；把全部 21 条 Acceptance 绑定到同两个 Task，即使 coverage=100%，也应因 cohesion、code-impact completeness 和 verification specificity 不合格而阻塞。

## 11. Planning Review

Requirement、Binding 和 Plan Review 使用通用不可变 PlanningReview 事实；Scenario Coverage 使用专用不可变 ScenarioCoverageReview，显式冻结 CoveragePolicy/full Scenario/Risk 输入；四类事实复用同一 finding/repair 语义，分别持久化 review ID、subject digest、round、finding、status 和 review digest。PlanningOperation 和 PlanSnapshot 必须保存四类 current review ID/digest；上游 subject digest 变化时对应 Review stale。Repair 另建不可变 attempt/lineage：只有不改任何已完成上游 digest 的 stage-local repair 可以在同 operation 追加 attempt；一旦 finding 要回到已完成的 Requirement/Policy/Repository/Binding/Capability/Team，当前 operation 必须 terminal，并按 finding-set digest 幂等创建 successor operation，从最早受影响 stage 重新向前运行，不能把单调 stage 指针倒退。

### 11.1 Plan Review 的两层审查

Plan Review 由确定性校验和独立 Reviewer 组成。

确定性校验负责：

- requirement/acceptance/decision/binding/evidence/command 引用；
- 所有 required AcceptanceScenario 的 implementation + verification 覆盖；
- active MUST Policy 的 disposition 和 task/verification 覆盖；
- DAG、scope、conflict、TaskContextPack 和 Service-derived role/capability requirement；
- CapabilityRequirementDraft 对 active CapabilityDefinition 的 grounding 完整性；
- snapshot digest 和 stale；
- proposed new surface 是否有 parent evidence；
- high/critical 独立 Reviewer；
- 同一 Task 的 evidence 是否来自同一冻结 revision。

独立 Plan Reviewer 负责语义质量：

- requirement interpretation 是否与来源一致；
- code owner 和影响链是否完整；
- 是否遗漏读路径、写路径、失败、权限、异步、迁移或回滚；
- Task 是否过大、过碎或职责混杂；
- 依赖顺序和可并行性是否合理；
- TaskContextPack 是否提供 objective、whyNow、in/out scope、starting point、target behavior、expected artifact、verification 和 escalation；
- completion/verification 是否可观察且能证伪；
- capability 是否由 Binding/evidence、PlanningRiskProfile 和版本化规则推导，而非 Planner 套用通用标签；
- Project MUST Policy 是否在 scope、实现和验证中得到落实；
- 计划是否包含无证据路径或“先做再说”的假设。

### 11.2 建议契约

```ts
interface DeliveryPlanReviewResult {
  status: 'approved' | 'changes_requested' | 'blocked'
  reviewedRequirementDigest: string
  reviewedRepositoryDigest: string
  reviewedBindingDigest: string
  reviewedPlanDigest: string
  findings: Array<{
    code:
      | 'requirement_misinterpreted' | 'code_owner_missing'
      | 'impact_path_incomplete' | 'task_too_large' | 'task_too_fragmented'
      | 'dependency_invalid' | 'verification_weak'
      | 'capability_ungrounded' | 'assignment_infeasible'
      | 'fabricated_evidence' | 'release_path_missing'
    severity: 'blocking' | 'important' | 'advisory'
    taskKeys: string[]
    requirementKeys: string[]
    evidenceIds: string[]
    message: string
    remediationOwner: 'requirements' | 'repository' | 'binding' | 'planning' | 'team'
  }>
}
```

只允许一次针对同一 finding 集的自动修复。每个 attempt 冻结 source review/finding、input/output subject revision、repair stage、policy 和 result review；`resolved` 必须有新 subject digest、确定性校验通过且后续 review 无 blocking descendant。无变化、形成环、或第二次仍出现同 fingerprint 时持久化 blocked snapshot 和 Inbox，不进行无限 LLM 自修循环。

## 12. 分派改进

### 12.1 硬门禁保持确定性

现有 V2 硬门禁方向正确，V3 保留并扩展：

1. Agent active；
2. Project membership active；
3. autoAssignable 或人工显式授权；
4. deliveryRoles 全覆盖；
5. Task 的 CapabilityRequirement 全部来自受控 CapabilityDefinition 和推导规则；
6. Agent 存在当前 Project Capability Snapshot 中 active、经确认的 AgentCapabilityClaim；
7. repository/resource access 满足任务 scope；
8. 存在支持所需工具的兼容 Runtime 类型/绑定；瞬时健康和容量只影响 dispatch，不改变结构资格；
9. 独立 Reviewer 与 implementer 不同；
10. Squad 绑定、leader、成员资格完整；
11. conflict key 和 workspace lock 无冲突；
12. 计划、团队、能力声明、Policy 和仓库 digest 未 stale。

Persona、Skill 名称、自然语言 projectRole 和历史对话不能绕过硬门禁。没有合格候选时，ready plan 应降为 `blocked`（`assignment_no_eligible_candidate` 或 `capability-claim-missing`），不能选择“最像”的 Agent。

旧 Agent capability 自由字符串不能直接通过 V3 硬门禁。迁移时只生成待确认映射；管理员确认 CapabilityDefinition 和 claim 后，新的 Project Capability Snapshot 才能使用它。

### 12.2 资格后评分

硬门禁通过后，再对候选评分：

```text
domain capability match
  > 相关 evidence owner 的历史成功交付
  > 当前项目上下文连续性
  > Runtime/tool locality
  > 可用容量与预计完成时间
  > 稳定 agentId tie-break
```

评分不改变资格，只决定合格候选之间的顺序。每次选择必须持久化：

```ts
interface AssignmentDecision {
  taskId: string
  policyVersion: 3
  eligibleAgentIds: string[]
  rejected: Array<{
    agentId: string
    reasonCodes: string[]
    missingRoleIds: string[]
    missingCapabilityIds: string[]
  }>
  scores: Array<{
    agentId: string
    domainMatch: number
    continuity: number
    deliveryHistory: number
    capacity: number
    total: number
    contributions: Array<{
      feature: string
      value: number
      weight: number
      sourceRecordIds: string[]
    }>
  }>
  selectedTargetType: 'agent' | 'squad'
  selectedTargetId: string
  executingAgentId: string
  routingSquadId?: string
  reason: string
  teamDigest: string
  capabilityDigest: string
  runtimeDigest: string
  affinitySnapshotId: string
  confidence: 'high' | 'medium' | 'low'
  ambiguityCode?: 'assignment-owner-ambiguous'
}
```

评分权重必须版本化，并以真实交付数据校准。`domainMatch`、`continuity` 和 `deliveryHistory` 必须引用 `AgentProjectAffinityClaim`、Codeowners、人工确认或 verified delivery history 的 source ID；没有足够历史样本时 `deliveryHistory` 应为中性值，不能把缺少记录当失败，也不能虚构成功率。高/critical Task 多个 eligible owner 同分且没有可信 differentiator 时返回 `assignment-owner-ambiguous`；低风险任务才允许带低置信 tie-break 继续。

### 12.3 TaskPreflight：由最终候选证明任务可接手

硬资格和评分只能说明候选有资格，不能证明当前 TaskContextPack 足以执行。V3.3 首版要求 AssignmentDraft 在审批前确定唯一 `executingAgentId`；即使路由目标是 Squad，也必须由这个实际执行 Agent 读取冻结上下文并返回：

```ts
interface TaskPreflight {
  id: string
  operationId: string
  taskKey: string
  agentId: string
  agentSessionId: string
  agentConfigDigest: string
  taskContextPackDigest: string
  assignmentDraftDigest: string
  repositoryDigest: string
  capabilityRequirementDigest: string
  accessGrantSnapshotDigest: string
  agentReportedStatus: 'accepted' | 'needs_clarification' | 'rejected'
  serviceVerdict: 'accepted' | 'needs_clarification' | 'rejected'
  acceptanceChecks: Array<{
    code: string
    status: 'pass' | 'fail'
    subjectIds: string[]
    evidenceIds: string[]
  }>
  understoodObjective: string
  startingEvidenceIds: string[]
  expectedChangeSurfaces: string[]
  plannedVerificationIds: string[]
  missingFacts: string[]
  missingFactCodes: string[]
  estimatedComplexity: 'small' | 'medium' | 'large'
  escalationReason?: string
  acceptancePolicyVersion: string
  evidenceAccessDigest: string
  preflightDigest: string
}
```

规则：

- Agent 只能返回 `agentReportedStatus`；只有 Service 确定性检查得到 `serviceVerdict='accepted'` 才允许进入 `decision_effect_finalization`，两阶段 Decision effect 均 current/non-blocking 后才能 final commit；
- accepted 要求 agent/session 身份与 AssignmentDraft.executingAgentId 一致、结构资格与 access grant current、全部 required starting evidence 有 read access、expected surfaces 是 allowed scope 子集且不命中 forbidden scope、required Scenario verification 全覆盖、escalation 已确认，并且 `missingFacts/missingFactCodes/blocking unknowns` 全空；
- acceptance check 结果和 policy version 进入 digest；人工或 Agent 不能直接覆盖 Service verdict；Squad leader 的报告不能替代实际执行成员；
- `needs_clarification` 根据稳定 check code 回到 Requirement、Binding、Plan 或 Team，终止当前后期 attempt，并按 11.1“Planning Review 与 Repair”协议重算；
- `rejected` 不自动判定 Agent 能力不足，也可能说明任务 owner、边界或能力推导错误；
- Preflight 只能引用当前 TaskContextPack 和同一候选实际读取的 Evidence，不能改 objective、scope、verification 或 capability requirement；
- 高/critical Task 按 PlanningRiskProfile 要求由独立 Reviewer 复核 Preflight；
- Runtime 临时 offline 或 capacity=0 是 dispatch 状态，不阻止已经完成的语义 Preflight；Runtime 类型不兼容、访问缺失则硬门禁失败，不能进入 Preflight。

### 12.4 Squad 使用边界

- owner 已能确定时直接分派给 Agent；
- 首版 Squad 只能作为路由入口，AssignmentDecision 仍必须在审批前确定一个属于该 Squad、对当前 Task 硬资格合格的 `executingAgentId`；
- leader 只获得路由职责，不自动成为 DeliveryTask 的完成 owner，也不能用自己的 Preflight 替代执行成员；
- leader 接收路由只创建不可执行的 `SquadCoordinationRecord`，记录 task/revision/AssignmentDecision/requestedExecutingAgentId/leader/status/digest；coordination 不是 TaskRun、不占 required output、不能完成 DeliveryTask；
- 真正的 TaskRun.agentId 必须等于 AssignmentDecision.executingAgentId，`coordinationId` 只作为 provenance；禁止创建 leader coordination TaskRun 或把 Squad ID/leader 当执行 owner；
- leader 若要改派其他成员，必须在无 active run 时创建新的 AssignmentDecision、TaskPreflight 和 SquadCoordinationRecord，旧 dispatch stale；在此之前不得 claim TaskRun；
- 需要“运行时才决定成员”的动态 Squad 延后到后续版本，并以独立 `SquadPreflight + DelegatedAgentAssignmentDecision + DelegatedAgentTaskPreflight` 契约实现，不能复用首版 Agent Preflight 冒充闭环；
- coordination/dispatch 完成不改变 DeliveryTask 为 delivered；
- 被委派成员失败时回到同一 DeliveryTask 的恢复流程，不覆盖历史 run。

### 12.5 容量与资格分离

- 角色/能力/访问不满足：`blocked`；
- Runtime offline：`waiting_runtime` 或按策略拒绝启动；
- 结构合格但容量为零：`waiting_capacity`；
- owner 已选但 team/runtime digest 变化：`assignment_stale`；
- 高风险任务没有独立 Reviewer：`blocked`。

UI 不能把这些状态统一显示为“未分配”。

## 13. DeliveryTask 与 TaskRun 分离

V2 已有 TaskRecord 和 TaskRunRecord，但 V3 需要在业务语义上严格区分：

| 对象 | 语义 | 是否可覆盖 |
| --- | --- | --- |
| DeliveryTask | 计划中的稳定交付责任、需求映射、scope 和完成条件 | revise 时生成新 revision，旧版本只读 |
| AssignmentDecision | 某个 task revision 在某个团队/runtime snapshot 下的候选和选择 | 重新计算生成新记录 |
| TaskRun | AssignmentDecision.executingAgentId 对 DeliveryTask 的一次执行尝试；Squad coordination 另表 | 永不覆盖 |
| VerificationEvidence | 某次 run 或独立 verifier 对 Acceptance 的证据 | 追加，失效时标 stale |
| DeliveryIntegrationSnapshot | 将 required TaskRun output 集成到 canonical target 的事实和 finalCommit | 重新集成生成新 snapshot，旧快照只读 |

触发和并发原则借鉴 Multica，但由本项目领域约束：

- 同一 `deliveryTaskRevisionId + agentId + active` 建立存储级唯一约束，抑制重复 pending run；
- claim 使用 compare-and-set 或数据库锁，不能只在内存检查；
- retry 创建新 TaskRun，并记录 previousRunId 和 reason；
- reassignment 不删除旧 run；
- Runtime 恢复后只能 claim 仍有效且 digest 未 stale 的 run；
- 计划 revise 后未开始的旧 run 取消，运行中的旧 run 进入人工决策，不让旧结果覆盖新 revision；
- leader dispatch、implementer execution、reviewer verification 分别记录，不混为一个成功状态。

## 14. 失败语义

沿用项目现有 `WorkflowError` 约定，并补充 V3 code：

| Code | HTTP/状态 | 含义 | 修复 owner |
| --- | --- | --- | --- |
| `source-block-unclassified` / `source-classification-uncertain` | 409 / blocked | parsed block 未分类或语义不确定 | requirements/reviewer |
| `requirement-source-uncovered` | 409 / blocked | normative anchor 未 disposition | requirements |
| `source-evidence-incomplete` | 409 / blocked | normative 来源只被抽样解析、附件/视觉页/OCR 不完整 | requirements/import |
| `acceptance-scenario-incomplete` / `acceptance-scenario-category-missing` | 409 / blocked | required Acceptance 缺结构完整或适用 category Scenario | requirements |
| `repository-snapshot-unavailable` | 502 / failed | 无法读取或索引目标仓库 | repository/runtime |
| `repository-snapshot-partial` | 409 / needs_decision 或 blocked | 关键语言/目录/关系未覆盖 | repository/human |
| `unsupported-stack` | 409 / blocked | 当前 release 没有覆盖该技术栈的语义 Provider | repository/product |
| `repository-evidence-invalid` | 409 / blocked | evidence path、digest 或 locator 无效 | repository |
| `canonical-target-invalid` / `canonical-target-stale` | 409 / blocked/stale | target 非唯一 local branch ref，或 binding/ref/base 已变化 | integration/project |
| `planning-policy-unresolved` / `planning-policy-precheck-weakened` | 409 / needs_confirmation | MUST 未确认，或完整 Policy 试图削弱 source precheck | project owner |
| `decision-pending-blocking` | 409 / blocked | Decision 影响本期 required delivery，尚未解决 | requirements/decision owner |
| `decision-effect-incomplete` | 409 / blocked | Decision option 或 precheck/final 影响闭包不完整 | requirements/binding |
| `planning-policy-violation` | 409 / blocked | Plan、TaskRun 或实现结果违反 active MUST Policy | planning/delivery |
| `code-binding-missing` | 409 / blocked | required Scenario 无 Binding | binding |
| `code-owner-unresolved` | 409 / needs_decision | state/source-of-truth owner 不明 | requirements/architecture |
| `code-impact-incomplete` | 409 / blocked | 写、读、失败、权限或消费者链缺失 | binding |
| `plan-evidence-fabricated` | 409 / blocked | Task 引用了快照外路径/命令/symbol | planning |
| `plan-review-blocked` | 409 / blocked | 独立 Reviewer 仍有 blocking finding | finding owner |
| `capability-mapping-unresolved` | 409 / blocked | Service 无法从 Binding/Task 推导受控 CapabilityRequirement | capability owner |
| `capability-claim-missing` | 409 / blocked | 候选没有经确认的 active CapabilityClaim | team |
| `assignment-capability-missing` | 409 / blocked | 项目团队无所需能力 | team |
| `assignment-owner-ambiguous` | 409 / blocked | 高风险任务存在多个同等合格 owner 且无可信区分事实 | assignment/team |
| `assignment-executing-agent-missing` | 409 / blocked | 未确定实际执行 Agent，或 Squad 只有 leader/路由资格 | assignment/team |
| `access-grant-missing` / `access-grant-revoked` | 409 / blocked | owner 缺 required grant 或授权已撤销 | access/team |
| `assignment-evaluation-missing` | 409 / blocked | executable proposal 缺 terminal selection/abstention 评估 | assignment |
| `task-preflight-check-failed` | 409 / blocked | Agent 自报与 Service identity/evidence/scope/scenario checks 不一致 | root-cause stage |
| `assignment-runtime-waiting` | waiting | 资格满足但 Runtime 不可启动 | runtime |
| `assignment-capacity-waiting` | waiting | 资格满足但暂无容量 | scheduling |
| `planning-snapshot-stale` | 409 / stale | 需求、Scenario、Policy、仓库、能力目录、团队或 Decision 已变化 | replan |
| `workspace-writer-active` / `workspace-writer-fenced` | 409 / read-only | workspace 已有 writer 或当前实例丢锁 | host/operator |
| `plan-approval-stale` / `execution-dispatch-blocked` | 409 / blocked | approval 或 dispatch 的 target/access/assignment/preflight 已失效 | approval/dispatch |
| `delivery-convergence-required` | 409 / changes_required | 实现后仍有 unmet/partial/unrequested/policy finding | planning/delivery |
| `convergence-finding-dropped` | 409 / blocked | repair baseline 未携带父 review finding/disposition | planning/delivery |
| `delivery-integration-required` | 409 / blocked | TaskRun 输出尚未进入 canonical target | integration |
| `delivery-integration-conflict` | 409 / blocked | merge/cherry-pick 或目标 ref 冲突 | integration |
| `delivery-integration-inclusion-unverified` | 409 / blocked | required output 缺可复算 ancestor/patch-tree/duplicate proof，或 no-code diff 非空/缺审计 | integration |
| `delivery-integration-target-moved` | 409 / stale | target ref CAS 不匹配 | integration |

不允许：

- repository provider 失败后回退到 Planner 自报路径；
- code owner 不明时默认选择目录名最相似的模块；
- 无 capability 时通过 Persona/Skill 关键词匹配；
- 把旧自由字符串 capability 自动升级为受控 claim；
- 不支持的技术栈用文件名/关键词扫描生成 ready Binding；
- plan review 失败后仍物化部分可执行 Task；
- TaskRun 完成后跳过实现到规格的 convergence；
- 用 success 包装 blocked/waiting；
- V3 失败时静默回退生成 V2 计划。

## 15. 非 happy-test 验证体系

### 15.1 测试分层

| 层级 | 目的 | 是否可用 fake LLM |
| --- | --- | --- |
| Schema/unit | 检查契约、parser、digest、引用和错误码 | 可以 |
| Service integration | 检查事务、补偿、stale、DAG、候选和门禁 | 可以，但不能据此声称语义好用 |
| Repository fixture | 检查真实 filesystem、manifest、symbol、route、schema、test 关系 | 不需要 LLM 或使用受控结果 |
| Golden planning evaluation | 检查真实 PRD + 真实代码快照的语义质量 | 必须使用真实模型 |
| Adversarial/mutation | 证明遗漏、伪造、冲突、重命名和错误分派会失败关闭 | 混合 |
| Browser E2E | 检查用户能理解并修复阻塞、批准正确计划 | 使用真实服务链路 |
| Release smoke | clean install、package、3080、升级/回滚 | 不使用 fake |

### 15.2 lscity-nuxt Golden Dataset

为 `lscity-nuxt` 建立版本化评测包，而不是只保存 21/27 数量：

```text
evaluation/lscity-nuxt/
  source/
    prd.md
    technical-design.md
  repository-snapshot.json
  expected-requirements.json
  expected-scenarios.json
  expected-bindings.json
  required-impact-chains.json
  forbidden-plans.json
  policy-snapshot.json
  capability-definitions.json
  agent-capability-claims.json
  team-catalog-snapshot.json
  expected-assignments.json
  expected-convergence.json
  review-rubric.json
```

`expected-assignments.json` 不能只声明“候选有资格”，而要按稳定责任键声明允许的最终 owner 集合：

```ts
interface ExpectedAssignment {
  responsibilityKey: string
  expectedOutcome: 'selected' | 'abstained'
  allowedOwnerIds: string[] // selected 时非空；abstained 时必须为空
  allowedSquadMemberIds?: string[]
  expectedAbstentionReasonCodes?: string[]
  critical: boolean
  rationaleEvidenceIds: string[]
}
```

Gold 必须覆盖应选择与应弃权两类 Task；`expectedOutcome` 和 reason 在运行前冻结。允许集合表达真正等价 owner，评测后不得追加；应选择却 abstain 计 false abstention，应弃权却 selected 计 abstention recall 失败，最终 owner 不在集合即错误分派，即使正确 owner 在 top-k 也不算成功。

Gold 不强制唯一任务数量或唯一标题，而是定义：

- 必须识别的 Requirement、Acceptance、AcceptanceScenario、Decision、Policy 和 source locator；
- 每个关键 Requirement 必须命中的 domain owner 和影响链；
- 必须出现的数据、权限、状态、异步、UI、测试或发布责任；
- 允许的替代 task grouping；
- 禁止的泛任务、伪造路径、错误 owner、遗漏链路和不可能分派；
- Decision 取不同选项时哪些 Binding/Task 应改变。

### 15.3 对抗与变异案例

至少覆盖：

1. 业务规则藏在普通段落，不在“验收标准”章节；
2. 权限规则藏在表格；
3. 技术方案与 PRD 冲突；
4. Acceptance 可测试但 Requirement 本身歧义；
5. Planner 引用不存在路径、旧路径、vendor/generated 文件或仓库外路径；
6. manifest 有 `test`，但 Planner 编造 `test:unit`；
7. 真实 state owner 在 service，存在同名 decoy component；
8. schema 改动遗漏 migration 或读路径；
9. 异步 producer 有多个 consumer，Planner 只找到一个；
10. 权限正向测试存在，但拒绝路径未覆盖；
11. 一个 Task 覆盖全部 Acceptance；
12. 每条 Acceptance 被机械拆成独立 Task，产生错误依赖；
13. capability catalog 缺失、Agent 只有 Persona 关键词；
14. Agent 合格但 Runtime offline、容量为零或访问 scope 不足；
15. Squad leader 合格但成员无执行能力；
16. 仓库在分析中发生 commit/dirty digest 变化；
17. Decision 解决与 replan 并发；
18. repository provider partial/failure；
19. monorepo 中需求跨多个 package；
20. append/revise 后旧 Binding、Task、Assignment 和 Run 的 stale 行为。
21. Acceptance 有 statement 和 category，但缺少 precondition/trigger/outcome/observableAt；
22. Planner 返回 capability ID，试图替代 Service 推导；
23. Agent 自由字符串 capability 与受控 definition 同名但没有 active claim；
24. AGENTS.md 的 MUST 规则未映射到 Task 或 Verification；
25. Java/Python 仓库只有 inventory provider 却被错误标记 supported；
26. 所有 TaskRun 成功，但最终代码仍漏 consumer 或存在计划外行为；
27. Convergence finding 产生后旧 approved plan 被原地篡改，而不是新 revision。
28. PDF 只解析抽样视觉页、缺图表/附件或 OCR 低置信，必须 `source-evidence-incomplete` 阻塞；
29. low/medium Decision 改变 required scope/owner/dependency 时必须阻塞，cosmetic Decision 不阻塞；
30. 两个同等 eligible owner 无可信 affinity differentiator 时 high-risk Task 必须 `assignment-owner-ambiguous`；
31. Planner proposal 的 local key 重复、跨快照引用或 blocked proposal 物化 Task 时必须拒绝并回滚；
32. 多个 worktree TaskRun 成功但未集成到 canonical finalCommit、集成冲突或目标 ref 移动时必须阻止 Convergence。
33. canonical target dirty、finalCommit 缺失或 output diff digest 不匹配时必须阻止交付关闭。
34. Decision option 在 source 层看似 cosmetic、但 Binding 后改变代码 owner/capability 时，final effect 必须阻塞；不能沿用 precheck non-blocking。
35. high/critical Decision 未列全 option 或缺影响对象时按 conservative default 阻塞；不能由 Reviewer 直接改布尔值放行。
36. Squad leader 自报 accepted、但实际 executingAgentId 未确定或该成员 Service Preflight 未 accepted 时，不得审批/Dispatch；leader 改派必须生成新 Assignment/Preflight，coordination 不创建 TaskRun。
37. 正确 owner 位于 top-k 但最终 selected owner 不在 Gold allowed 集合时，必须计为错误分派并触发 release gate。
38. 重复 patch、伪造 `no_code_change`、把 manual conflict resolution 当 proof、缺 postimage/inclusion evidence 或 sequence 不符合 DAG 时，不得生成 ready finalCommit。
39. shadow/blocked/failed operation 的 Requirement、Decision、Binding 或 Assignment 通过默认项目 API 泄漏到 current 视图、审批或 Dispatcher 时测试失败。

### 15.4 真实模型稳定性测试

发布候选至少对每个 Golden Case 执行 5 次真实规划；nightly 执行 20 次。固定：

- model/provider/version；
- prompt version；
- repository snapshot；
- capability/team catalog；
- 决策输入；
- temperature/reasoning 配置（若 provider 支持）；
- token 和工具预算。

不比较任务标题的逐字一致，而比较 Requirement、AcceptanceScenario、Policy、Binding、影响链、Task responsibility、Service-derived CapabilityRequirement、DAG、assignment 和 convergence 的结构语义。

### 15.5 指标与首版阈值

以下是 V3.3 release gate 的首版阈值。Phase 0 先建立当前 baseline 并冻结 MetricPolicy ID/version/digest；后续只能以新版本和审批记录调整，不得为让现状通过而降低关键不变量：

| 指标 | 计算 | Release gate |
| --- | --- | --- |
| Source block classification coverage | 已唯一 classification 的 block / normative profiles 的全部 parsed block | 100% |
| Required source disposition | 已主 disposition / classification=`normative` anchors | 100% |
| Normative source completeness | `complete` normative profiles / normative profiles | 100% |
| Explicit acceptance traceability | 有独立持久化和 Task 双覆盖 / required AC | 100% |
| Required scenario executability | 结构完整且有实施/验证覆盖 / required Scenario | 100% |
| MUST policy disposition | 已映射或有批准 N/A / active MUST Policy | 100% |
| Critical requirement recall | 命中 gold critical Requirement / gold critical | 100% |
| Code-binding precision | 正确 gold owner/impact evidence / 所有提出 evidence | >= 90%，且 critical 无错误 owner |
| Code-binding recall | 命中 gold required owner/impact / gold required | >= 90%，且 critical chain 100% |
| Fabricated evidence rate | 快照外 path/symbol/command 引用 | 0 |
| Plan actionability | rubric 通过 Task / 全部 Task | >= 90% |
| Dependency correctness | gold/规则判定正确 edge / 评估 edge | >= 95%，无 blocking edge |
| Ready-plan assignment eligibility | 有结构合格 owner / ready Task | 100% |
| Trusted capability coverage | 受控 requirement 有 active confirmed claim / ready Task capability requirement | 100% |
| Assignment evaluation coverage | 有 terminal AssignmentEvaluationRecord / 全部 executable TaskProposal | 100% |
| Selected-owner accuracy | selected 且 `executingAgentId` 命中 Gold allowed owner / Gold 要求选择的 Task | >= 90%，critical 100% |
| Abstention recall | 应 abstain 且实际 abstain / Gold 应 abstain Task | >= 95%，critical 100% |
| Abstention precision | 应 abstain 且实际 abstain / 全部 abstained Task | >= 90% |
| False abstention rate | Gold 有允许 owner 却 abstain / Gold 要求选择的 Task | <= 10%，critical 0 |
| Assignment reason provenance | 有稳定 reason code 和 source record 的 terminal evaluation / 全部 executable TaskProposal | 100% |
| Expected-owner recall@k | Gold allowed owner 至少一个进入候选前 K / Gold 要求选择的 Task | >= 90%，仅用于排序诊断，不能替代 selected-owner gate |
| Score provenance coverage | 有 source record ID 的 score contribution / 全部非中性 contribution | 100% |
| False-ready rate | 应 blocked 却 ready 的 case | 0 |
| False-converged rate | 实现仍有 blocking gap 却判 converged 的 case | 0 |
| Rerun semantic stability | 多次运行的关键 Binding/责任一致度 | >= 85%，critical 100% |
| First-pass TaskPreflight acceptance | 最终候选首次返回 accepted / 分派任务 | >= 85% |
| Start without clarification | 不产生 scope/owner/requirement clarification 即开始 / 开始任务 | >= 80% |
| First-run completion | 首次 TaskRun 满足冻结完成条件 / 执行任务 | canary >= 60%，稳定发布 >= 70% |
| Human task rewrite ratio | 人工修改 objective/scope/verification / 已审阅任务 | <= 20% |
| Task rework ratio | 因任务边界或 owner 错误产生新 revision / 已完成任务 | <= 15% |
| Assignment rejection ratio | 最终候选 Preflight rejected / 分派任务 | <= 10% |
| Time to usable plan | 提交完整来源到 `approvable=true` 的有效运行时间 P50/P95 | P50 <= 20 分钟，P95 <= 45 分钟 |
| Human edit ratio | 人工批准前修改的关键 Binding/Task 字段比例 | <= 20% |

Phase 0 必须通过 append-only publish command 冻结 immutable `MetricPolicyId/MetricPolicyVersion/policyDigest`：per-scope 连续 head revision + CAS，同 scope version 唯一，project current 优先/global fallback 明确，发布/operation reserve 幂等并发线性化，published 禁止更新/删除，逐项定义分子/分母、事件起止、样本项目、最小样本量、统计窗口、P50/P95 算法、排除规则、canary/release 阈值和调整审批记录。`time_to_usable_plan` 只排除明确记录的用户待决策时间和外部 provider/Runtime 故障时间，不排除系统 repair、重试或模型耗时。Phase 1 开始后调整口径必须发布新版本并通过 immutable ReleaseReport 按 policy ID 并列报告旧/新结果，不能为使 canary 通过而原地改阈值。

“未发现伪造路径”只表示当前样本没有命中，不等于证明所有项目都不会出现；需要持续 mutation 和生产观测。

## 16. 审批与交付门禁

### 16.1 Approval gate

```text
current requirement snapshot
  AND all normative RequirementSourceProfile status == complete
  AND source block classification == 100%, uncertain == 0
  AND normative anchor disposition == 100%
  AND approved current requirement review
  AND per-Acceptance CoveragePolicy exact-one, seven dispositions, uncertain == 0
  AND current approved independent ScenarioCoverageReview over full Scenario/Risk/policy digest
  AND complete categorized required AcceptanceScenario inventory
  AND current SourcePolicyPrecheck, Decision precheck, PlanningRiskProfile
  AND current repository snapshot and supported RepositoryStackProfile
  AND unique current CanonicalTargetBinding
  AND current PlanningPolicySnapshot that preserves/strengthens source precheck
  AND all active MUST dispositions complete
  AND complete EvidenceClaim-supported code bindings
  AND approved binding review
  AND complete TaskContextPack and required relationship for every TaskProposal
  AND Service-derived CapabilityRequirementDraft for every TaskProposal
  AND approved delivery plan review
  AND current ProjectAccessGrantSnapshot and required read grants
  AND exactly one terminal AssignmentEvaluationRecord per executable TaskProposal
  AND required scenario implementation coverage == 100%
  AND required scenario verification plan coverage == 100%
  AND current DecisionEffectPrecheck and DecisionEffectFinalization
  AND no unresolved Decision where either current effect blocksPlanning == true
  AND every required capability resolves to a current definition and active confirmed claim
  AND every Task has a hard-eligible selected candidate and executingAgentId
  AND every required TaskPreflight serviceVerdict == accepted for that executingAgentId
  AND independent reviewer requirements satisfied
  AND all digests current, including source policy/target/access/assignment evaluation
  AND repair baseline every carry item has exact-one current valid CarryValidation (non-repair empty digest)
  AND PlanningReferenceMap frozen and reference closure complete
  ```

审批语义固定为：`waiting_capacity` 和可恢复的 `waiting_runtime` 可以创建不可变 PlanApprovalRecord，但不能启动执行；`blocked_runtime`、`blocked_access`、`assignment_no_eligible_candidate`、`capability_catalog_blocked`、`assignment-owner-ambiguous`（high/critical）和 Preflight Service verdict 非 accepted 时不可批准。Approval command 不得 reserve 容量、获取 workspace、创建/claim TaskRun 或把交付状态改成 executing；独立 Dispatch command 再校验 Approval、Assignment、Preflight、ProjectAccessGrantSnapshot、CanonicalTargetBinding 和瞬时状态，等待时返回 `202 waiting_*` 且创建 0 个 TaskRun。API 必须分别返回 `approvable`、`executionDispatchStatus`、`blockingReason` 和 `requiredUserAction`，不得通过单一 `ready` 或 `preflight.ready` 布尔值混合计划正确性与瞬时可调度性。

### 16.2 Delivery gate

Approval 只表示计划可执行，不表示 Requirement 已交付。Delivery 必须另行满足：

- 所有 required implementation Task 完成；
- VerificationEvidence 对 required AcceptanceScenario 为 verified，并包含实际观察面和结果；
- 测试结果来自当前 task/repository revision；
- failed/waived 有明确状态，waive 包含批准人、理由、风险和有效期；
- high/critical Task 完成独立 review；
- migration/release/rollback evidence 满足计划；
- 无未处理的执行期 Decision 或 scope escalation；
- DeliveryIntegrationSnapshot status=`ready`，所有 required TaskRun output 已通过 patch/tree inclusion proof 进入唯一 canonical target 的同一 `finalCommit`，或有包含 actor、reason 和 evidence 的 `no_code_change` 审计；
- 已基于最终实现 revision 生成新的 RepositoryContextSnapshot；
- DeliveryConvergenceReview 对 Requirement、Scenario、Policy、Binding、批准 Plan 和当前代码返回 `converged`；
- 不存在未处理的 unmet、partial、unrequested 或 policy_violation finding。

### 16.3 Delivery Integration 与 Convergence

Convergence 在所有本轮 TaskRun、required verification 和 Delivery Integration 完成后执行，不复用规划基线或孤立 worktree 冒充最终代码：

```text
approved PlanSnapshot + original Requirement/Scenario/Policy digests
  -> required TaskRun + VerificationEvidence complete
  -> canonical DeliveryIntegrationSnapshot
  -> clean canonical finalCommit
  -> final RepositoryContextSnapshot(finalCommit)
  -> refresh affected code bindings
  -> deterministic requirement/scenario/policy/scope checks
  -> independent convergence review
  -> converged | changes_required | blocked
```

首版只支持 CanonicalTargetBinding 冻结的一个 repository target。每个 required TaskRun 必须恰好对应一条集成输出，并按 Task DAG 和连续 `sequence` 集成。Integration Service 从 immutable run commits 重算 source base/head/tree、diff、changed path/blob/mode 和稳定 patch IDs；source head 是 integrated commit ancestor 时用 ancestor proof，否则要求 patch/hunk 一一等价并校验 target tree 中的 postimage。重复 patch 必须引用更早的 verified evidence、证明相同 diff/patch set 且效果仍存在；`no_code_change` 仅在重算 diff 为空并保存 actor/reason 时成立；manual conflict resolution 只是 integration method，不能替代 proof。每步分别冻结 `targetParentCommitBefore/targetCommitAfter` 与 `targetTreeBefore/targetTreeAfter`，后一步的 commit/tree before 必须分别等于前一步的 commit/tree after；不得比较 commit hash 与 tree hash。Integration principal 独占 `canonical_integrate` grant，并以 target ref expected head 做 CAS；target/binding/grant 变化、目标 dirty、集成冲突、未集成 output、无法证明 inclusion 或多仓库交付直接 blocked/stale。只有每条 immutable IntegrationInclusionEvidence 都 verified、target clean 且 CAS 成功后才生成 `finalCommit`；Convergence 只能读取该精确 revision。

Finding 至少区分：

- `unmet`：需求或 Scenario 没有在当前代码中成立；
- `partial`：只有部分路径、消费者或失败场景完成；
- `unrequested`：实现包含规格、Plan 和 Policy 都未授权的行为；
- `policy_violation`：违反 active MUST Policy；
- `stale_verification`：证据不属于最终 task/repository revision。

发现剩余工作时，Convergence Service 先把每个 finding 持久化为带 ID/digest 的 immutable record，并以 `(reviewId,findingSetDigest)` 幂等冻结 ConvergenceRepairBaseline，再创建唯一 `revise` PlanningOperation；baseline 必须覆盖 parent review 的完整 findingIds 集合，且每个 finding 恰有一条 disposition。Repair 的 repository baseline 必须是父 DeliveryIntegrationSnapshot 的 canonical `finalCommit`，不是原规划 R0；所有 finding 都是不可删除输入。每个 requirement/scenario/policy/binding/task/code_surface/verification/integration_output 必须显式 `carry_current|reverify|reexecute|superseded`：只有 subject digest、target binding、finalCommit reachability、verification inputs 和 affected Binding closure 均未变才可 carry。旧 PlanSnapshot、Task、TaskRun、Verification 和 finding 保持只读；新 revision 必须重新产生 Plan、Integration、final snapshot 和 ConvergenceReview。Convergence 无权直接修改业务代码、原地追加 approved Task 或静默扩大范围。

## 17. UI 交互

UI 采用“摘要优先、证据下钻”，不能把七层审计对象全部堆在首屏。默认 Plan Health 只回答：当前是否可批准、最多 3 个最高影响问题、任务/依赖/等待摘要，以及每个任务的 owner、范围、验证和风险。详情再按以下层次展开：

1. 需求与规则：来源 profile 是否 complete、哪些 deferred/out-of-scope、哪些待决策；每条 Acceptance 的 Scenario 是否可执行，MUST Policy 是否已确认并有 disposition；
2. 风险与仓库支持：PlanningRiskProfile、识别到的技术栈、Provider coverage、supported/partial/unsupported，以及哪些结论不能由当前版本证明；
3. 代码理解：每条关键需求的 EvidenceClaim、domain owner、写/读/失败/consumer/测试路径、支持/反证、provenance 和 freshness；
4. 任务计划：WorkPackage、TaskContextPack、依赖、允许/禁止范围、expected artifacts、Scenario/Policy 覆盖和 Review finding；
5. 能力、分派与接手：Service 推导的角色/能力要求、CapabilityDefinition/Claim/Affinity 来源、候选、选中 owner、TaskPreflight、owner ambiguity、Runtime/容量状态；
6. 审批与执行门禁：为什么当前能或不能批准、为什么能或不能 dispatch、下一步由谁处理；
7. 交付集成与收敛：每个 TaskRun output 的集成方式、canonical target/finalCommit、冲突/stale、Scenario/Policy 验证结果、unmet/partial/unrequested finding 和修复 revision。

建议的用户动作必须针对 root cause：

- “补充/修正需求”；
- “补全 AcceptanceScenario”；
- “解决所有影响本期交付的 Decision”；
- “确认项目 MUST Policy”；
- “刷新仓库快照”；
- “确认代码 owner”；
- “重新生成受影响任务”；
- “确认 legacy capability 到受控 CapabilityDefinition 的映射”；
- “给项目加入具有 active confirmed claim 的 data.prisma 实施 Agent”；
- “等待 Runtime 恢复”；
- “解决 owner 歧义（补充受控 affinity 事实或人工确认）”；
- “启动/继续 canonical Delivery Integration，解决冲突或目标 ref stale”；
- “运行交付收敛审查”；
- “基于 convergence finding 创建修复 revision”；
- “替换当前计划”。

不能把所有问题都归为“请手工分配 Agent”。

## 18. 实施计划

实施采用可运行纵切，而不是先完成所有 V3.3 表和治理对象。每个 Phase 都必须产生可观察的用户价值和退出证据。

### Phase 0：Baseline 与真实用户样本

- 冻结当前 `lscity-nuxt` PRD、真实代码 revision 和团队目录；
- 建 expected Requirement/Scenario/Binding/impact chain、允许的替代 task grouping、forbidden plan 和接手 rubric；
- 使用当前 V2 做至少 5 次真实模型评测，记录漏项、错误 owner、泛任务、人工重写、分派拒绝和 time-to-usable-plan；
- 把现有 21/27 测试明确标记为 contract integration，不再用于语义完成声明；
- 产出 V3.3 指标采集器、离线 baseline 报告和冻结的 `MetricPolicyId/MetricPolicyVersion/policyDigest`，包含 assignment evaluation/abstention 的全量分母、窗口、排除、阈值和调整审批；
- 实现 WorkspaceWriter OS lock、lease audit 和 fencing guard；未持锁实例只读/启动失败，所有 recovery/mutation/background continuation 校验 token；
- 冻结 approval-only 与 execution-dispatch 两个 API/DTO 契约，禁止新增耦合入口。

退出条件：能够量化当前最常见的 5 类失败，冻结后续 Phase 的 metric policy；host 级并发 fixture 证明同 workspace 只有一个 writer，锁丢失会 fence；不存在“canary 前再设 SLO”的占位。Writer guard 未通过时 Phase 1 不允许 candidate 写。

### Phase 1：V3-Slice Understand + Ground

- 按 `source_ingest -> source_profile -> source_manifest` 建完整输入边界，对 normative profile 的每个 parsed block 做 100% classification，再对 normative anchor 做 100% disposition；
- 新增 seed/completion AcceptanceScenario(category)、per-Acceptance CoveragePolicy、ScenarioCoverageReview、持久化 Requirement Review、SourcePolicyPrecheck、Decision resolution-bound precheck 和 PlanningRiskProfile；
- 新增可信 filesystem/manifest/test command provider、canonical path 和 git/tree/dirty digest；
- 在 Repository Snapshot 后冻结唯一 CanonicalTargetBinding，显式 local branch ref 与 integration principal/grant；
- 合并来源/仓库规则形成 PlanningPolicySnapshot，新增/加强 MUST 会 stale precheck 和下游；
- 首版只支持 TypeScript/Nuxt/Vue/Prisma 已覆盖子集，其他技术栈明确 unsupported；
- 新增 Evidence Gateway、EvidenceClaim、RequirementCodeBinding 和独立 Binding Review；
- 在 shadow mode 与 V2 对比，不改变当前审批。

退出条件：source block classification=100%、required source disposition=100%、CoveragePolicy exact-one/七类 disposition/N-A reviewer/uncertain=0 且 Scenario required-category coverage=100%，critical Requirement owner/impact-chain recall=100%，snapshot 外 evidence=0，target binding 唯一且非法 ref 失败关闭，用户能解释每个 critical Binding 为什么落到该 owner。

### Phase 2：V3-Slice Shape + TaskPreflight

- 实现 WorkPackage -> TaskProposal 二次展开，`relationship` 在 Planner proposal、正式 Task、CapabilityRequirement 和 digest 中必填并由 DAG 规则校验；
- TaskProposal 必须包含完整 TaskContextPack；
- Planner 只能引用 requirement/scenario/evidence/claim/binding/command ID，不返回 role/capability/Agent；
- Service 在 Plan Review 前推导 CapabilityRequirementDraft；
- 为固定 Gold 团队建立最小但正式受控的 CapabilityDefinition、active confirmed AgentCapabilityClaim 和 ProjectCapabilityCatalogSnapshot，不使用自由字符串或 Persona 选候选；
- 建最小 ResourceAccessGrant/ProjectAccessGrantSnapshot，Assignment 和 Preflight 必须引用 current read grant；
- 每个 executable TaskProposal 生成 terminal AssignmentEvaluationRecord，记录 selected/abstention、稳定 reason/source 与 MetricPolicy ID/version/digest；
- 新增独立 Plan Reviewer、单调 repair lineage、硬资格/AssignmentDraft 和由 Service checks 决定 verdict 的最终候选 TaskPreflight；
- blocked/clarification/rejected 只保存 proposal/draft，不物化 executable Task。

退出条件：assignment evaluation coverage/reason provenance=100%，abstention recall >=95%（critical=100%）、precision>=90%、false abstention<=10%（critical=0）；`first_pass_task_preflight_acceptance >=85%`、`human_task_rewrite_ratio <=20%`、critical Task actionability=100%，伪造 accepted 但缺 evidence/scope/verification 的 Preflight 被 Service 拒绝。

### Phase 3：V3-Slice Assignment + Real TaskRun + Minimal Convergence

- 将 Phase 2 的固定 Gold 能力/授权目录扩展为项目级 claim/access grant lifecycle、revocation fencing、legacy pending mapping、权限审计和 snapshot refresh；
- 增加受控 affinity ranking、完整 AssignmentEvaluation/Draft/TaskPreflight 治理、Decision effect finalization 和 final commit 物化；
- 分离 immutable PlanApproval 与 ExecutionDispatch；waiting approval 创建 0 个 TaskRun，dispatch 重校验 target/access/assignment/preflight；
- 首版 Squad 在审批前固定实际 `executingAgentId`；leader 只产生 SquadCoordinationRecord，改派必须产生新 AssignmentDecision 和新 Agent Preflight；
- 资格、Runtime、容量、访问和 owner 歧义状态分离；TaskRun.agentId 必须等于 executingAgentId，pending run 存储级唯一；
- 实现单 CanonicalTargetBinding 的最小 DeliveryIntegration：DAG 连续顺序、逐 output IntegrationInclusionEvidence、target-tree continuity、target ref CAS、clean `finalCommit`；
- 实现最小 DeliveryConvergence 与 ConvergenceRepairBaseline：repair 基于父 finalCommit，finding 不可丢，carry/reverify/reexecute/superseded 显式；
- 仅在隔离测试交付和内部 canary 中运行，不开放 3080 candidate。

退出条件：trusted capability/access coverage=100%，AssignmentEvaluation/reason=100%，selected-owner>=90%（critical=100%），abstention recall>=95%（critical=100%）/precision>=90%/false-abstention<=10%（critical=0），false-ready=0；Writer/Approval-Dispatch/Squad/active-run 不变量通过；未集成 output、target moved、proof 失败、finding 丢失或 false-converged 均不能 delivered。

### Phase 4：V3-Usable Candidate

- 完善 PlanningPolicySnapshot 的 authority 冲突、人工确认、局部重算和风险依赖治理；
- 完成 AccessGrant 管理、局部重算影响矩阵、用户修正反馈、evaluation registry 和摘要优先 UI；
- GUI 将“批准计划”和“启动执行”呈现为两个动作/状态；waiting 可批准但启动禁用且原因明确；
- 把 Writer fencing、target binding、grant、Phase 3 的最小 Integration/Convergence/Repair 纳入 candidate 强制路径和 release gate；
- 在 3080 使用 `lscity-nuxt`、至少两个同支持边界但结构不同的项目和一个 unsupported 反例跑完整链路；
- 先 shadow，再对新项目开 candidate；旧 V2 项目只能显式 replace/replan；
- 完成 clean install、全量 test/build/package smoke 和浏览器 happy-path/business-rejection/boundary/dependency-failure 回归。

退出条件：false-ready/false-converged=0，selection/abstention 全部 release gates 通过，human rewrite<=20%、rework<=15%、稳定首次完成>=70%、time-to-usable-plan P50<=20/P95<=45 分钟；摘要页分离 Approval/Dispatch 并解释 target/access/evaluation/Service verdict/inclusion/repair。Writer fencing 或 Phase 3 门禁缺失时不得开放 3080 candidate。

### Phase 5：V3-Advanced Integration + Governance

- 在已上线的最小闭环上增强复杂多 worktree 集成顺序、重复 patch、冲突辅助和大规模恢复；
- 增强 Convergence 的 affected Binding 刷新、unmet/partial/unrequested/policy_violation/stale_verification 精度和成本控制；
- 完善 finding 到 revise operation 的幂等治理、长期证据保留和性能观测；
- 多仓库交付仍在建立跨仓库引用与原子发布模型前失败关闭，不以 Phase 5 名义放宽。

退出条件：高级冲突、重复 patch、恢复和规模化 fixture 通过；Phase 3/4 已有 false-converged、inclusion proof 和关闭门禁保持不回归。

## 19. 建议代码责任边界

最终文件划分应结合实施时现状确定，建议最小责任边界为：

| 模块 | 职责 |
| --- | --- |
| `src/types.ts` | V3 snapshot/binding/work package/task/review/assignment 契约和兼容字段 |
| `src/workflow.ts` | 纯 schema/digest/reference/relationship-aware DAG/coverage validator；逐步把复杂 provider 移出 |
| `src/planning/writer-guard.ts` | workspace OS lock、fencing token、lease audit 和 assertWriter |
| `src/planning/source-manifest.ts` | 全 parsed-block inventory、classification hints/coverage 和 normative disposition gate |
| `src/planning/acceptance-scenario.ts` | Acceptance 到 categorized executable Scenario 的解析和完整性门禁 |
| `src/planning/risk-profile.ts` | 规划风险维度、证据/Review/Preflight/Convergence 深度策略 |
| `src/planning/repository-context.ts` | canonical root、provider 编排、snapshot/digest |
| `src/planning/canonical-target.ts` | target resource/ref/base/integration principal 绑定、validation 和 stale |
| `src/planning/repository-stack.ts` | 技术栈识别、Provider coverage 和 supported/partial/unsupported |
| `src/planning/repository-providers/*` | manifest、TypeScript/Nuxt、Prisma、test、Graphify 适配器 |
| `src/planning/policy.ts` | Policy extraction、authority、适用性、disposition 和 digest |
| `src/planning/evidence-claim.ts` | EvidenceClaim 引用、支持/反证、confidence 和 review gate |
| `src/planning/code-binding.ts` | Binding 解析、完整性门禁和 stale |
| `src/planning/task-context.ts` | TaskContextPack、proposal actionability 和 digest |
| `src/planning/capability.ts` | CapabilityDefinition/Claim、Task relationship requirement 推导和 catalog snapshot |
| `src/planning/access.ts` | ResourceAccessGrant、Project snapshot、scope/command/canonical-integrate gate |
| `src/planning/planning-review.ts` | Requirement/Binding/Plan review 和 monotonic repair/successor orchestration |
| `src/planning/assignment.ts` | 硬门禁、亲和评分、terminal AssignmentEvaluation 和 selection/abstention metrics |
| `src/planning/task-preflight.ts` | Agent report、Service deterministic verdict、evidence read/scope/scenario checks |
| `src/planning/approval-dispatch.ts` | immutable Approval/Dispatch、waiting zero-run 和 dispatch freshness |
| `src/planning/squad-coordination.ts` | leader routing provenance、执行成员改派；不创建 coordination TaskRun |
| `src/planning/delivery-integration.ts` | per-output 可复算 inclusion proof、tree continuity、CAS 和 finalCommit |
| `src/planning/delivery-convergence.ts` | final snapshot、规格对照、finding 和 immutable RepairBaseline/carry disposition |
| `src/service.ts` | 阶段状态机、事务/补偿、Project pointer 和 API orchestration |
| `src/storage.ts` | snapshot/binding/review/assignment/run 唯一约束与兼容表 |
| `src/client.tsx` | 来源、代码绑定、计划、分派和门禁分层展示 |
| `tests/evaluation/*` | gold、mutation、真实模型 runner、指标报告 |

不要一次重构整个 `service.ts`。按 Phase 1-5 在新增事实边界时逐步提取，保证每一步都有行为测试和可回滚 feature flag。

## 20. 数据兼容、发布和回滚

### 20.1 兼容

- V1/V2 snapshot 保持只读可查询；
- V3 新增 `planningContractVersion=3` 和 source/scenario/policy/repository/stack/binding/review/capability-requirement/capability-catalog/assignment/convergence digest；
- 旧 Task 不伪造 Binding；UI 显示“legacy plan / code binding unavailable”；
- 旧项目进入 V3 必须显式 replace/replan；
- append/revise 只复用 digest 未变且 requirement scope 未受影响的 snapshot/binding；
- capability backfill 只能增加人工可审计映射，不能从 Persona/Skill 自动确认领域能力。
- V2/V3 历史交付没有 final Repository Snapshot 和 Convergence Review 时显示 `convergence_unavailable`，不能补写虚假 `converged`。

### 20.2 发布

```text
schema/read compatibility
  -> repository snapshot shadow
  -> scenario/policy/binding shadow
  -> capability/assignment shadow
  -> convergence shadow on completed test deliveries
  -> internal canary
  -> new-project V3 candidate
  -> V3 default
```

每阶段记录 feature flag、prompt/provider/policy version，并保留 V2 读取能力。V3 写开启后若 V3 规划失败，返回真实 blocked；不能回退生成 V2 candidate。

Shadow 的“不发布”不等于“不持久化中间事实”。Shadow operation 可以写入归属于同一 `operationId` 的 SourceProfile、Scenario、Decision effect、Claim、Binding、Proposal、Draft 和 Preflight，child 的 publication mode 从 owning operation 派生，用于审计与对比；正常完整链路也必须在 TaskPreflight 后运行 Decision effect finalization，评测记录冻结 precheck/final effect ID 与 digest，不能绕过 final gate 得出 would-commit。更早 blocked/failed 的 shadow 保存 reached stage 和真实 blocking outcome，不纳入 would-commit 分母。Shadow 不得物化正式 PlanSnapshot、DeliveryTask、CapabilityRequirement 或 AssignmentDecision，不得改变 Project pointer、容量、delivery status 或执行队列。V3 RequirementBundle 必须记录 owning operation，Item/Acceptance/Decision 通过 bundle 归属；项目默认 `/requirements`、`/requirement-decisions`、assignment 和 planning 聚合查询只读取 current committed Plan 的 bundle/reference 闭包。shadow 数据只能通过显式 `operationId` 或 ShadowEvaluation API 查询，blocked/failed/shadow 记录不能泄漏到审批与 Dispatcher 视图。

### 20.3 回滚

- 关闭 V3 新写，不删除已生成 snapshot/binding/plan/run；
- 当前 V3 candidate 保持只读并标记 planning unavailable；
- 回滚 Project pointer 到切换前 snapshot 必须是显式管理动作并记录审计；
- 运行中的 TaskRun 按其已冻结 contract 继续或人工取消，不切换到另一个 plan；
- provider/LLM 故障不影响历史查询；
- 数据迁移必须 forward-compatible，回滚应用时不删除新表和新字段。

## 21. 可观测性

至少记录：

- source parsed-block/classified-block counts、classification 分布/Reviewer、normative disposition、deferred/out-of-scope reasons；
- source profile 的 total/parsed pages、blocks、attachments、OCR confidence、complete/partial/unsupported、source-evidence-incomplete 次数；
- required AcceptanceScenario category 分布、适用/N/A reason、结构完整性、implementation/verification coverage 和 observableAt；
- active MUST Policy 的 authority、适用性、disposition、violation 和确认耗时；
- RepositoryStackProfile、supported/partial/unsupported 原因、provider status、index duration、evidence count、digest churn；
- PlanningRiskProfile level/dimensions、要求的证据/Review/Preflight/Convergence 和策略命中；
- EvidenceClaim 的 supporting/contradicting evidence、confidence、disputed/rejected 和 reviewer finding；
- Binding completeness by data/state/permission/async/failure/test dimension；
- Planner/Reviewer repair 次数与 blocked finding code；
- fabricated evidence 拒绝次数；
- WorkPackage 展开比例、TaskContextPack 完整性、Task 大小和 dependency/conflict 统计；
- CapabilityRequirement 的推导规则/证据、claim provenance/status、legacy pending mapping 和 catalog digest churn；
- eligible/rejected candidate、missing role/capability claim/access、Runtime/容量等待；
- AssignmentEvaluation coverage/terminal reason provenance、selected-owner accuracy、abstention recall/precision/false-abstention、affinity source 和 owner ambiguity；
- assignment override 和人工 reason；
- TaskPreflight agent report/Service verdict/check failure、missing fact code、evidence read audit、首次接手率和拒绝率；
- task start without clarification、first-run completion、human task rewrite、task rework 和 time-to-usable-plan；
- retry/reassignment/duplicate trigger/claim conflict；
- requirement/plan/assignment stale 原因；
- gold 指标、rerun stability 和 human edit ratio；
- approval rejection、delivery verification failure、convergence finding 分布、repair revision 次数和 false-converged count。
- delivery integration 的 required output 覆盖、集成顺序、patch/tree inclusion proof、duplicate/no-code 审计、target CAS、冲突/stale、canonical finalCommit 和未集成阻塞次数。

指标用于发现质量退化，不得覆盖真实状态。比如“平均 code-binding recall 很高”不能允许一个 critical Requirement 无 owner 仍进入 ready。

## 22. 完成定义

只有同时满足以下条件，才能对用户声称“能够正确识别需求、结合代码拆任务并正确分配，已经好用”：

1. normative profile 的全部 parsed block 100% classification、uncertain=0；每个 normative anchor 有唯一 disposition，hinted context 有 Reviewer，显式 Requirement/Acceptance/Decision 不遗漏；每个 Decision option/当前 resolution 有可追溯 precheck/final effect，任一 blocking 阻止 candidate/approval；
2. 所有 normative 来源都有 `RequirementSourceProfile.status=complete`，页/块/附件/OCR 全量覆盖；抽样或不完整来源以 `source-evidence-incomplete` 失败关闭；
3. 每个 required Acceptance 保留原文，至少有 `happy_path`，并对风险派生的每个 applicable category 有结构完整、可证伪、具有 observableAt 的 required Scenario；
4. SourcePolicyPrecheck 的 active MUST authority/scope/disposition 已确认；Repository 后的完整 Policy 只能保持或加强 precheck，且进入 Plan/Approval/Execution/Delivery digest；
5. RepositoryStackProfile 明确 supported/partial/unsupported；仅受支持子集可 ready，且冻结唯一 current CanonicalTargetBinding，非法/多 target/ref 失败关闭；
6. 每个 required Requirement/Scenario 有当前仓库 snapshot 上的 RequirementCodeBinding，关键 owner/路径结论有 current EvidenceClaim 支持，数据、状态、权限、异步、失败、consumer 和测试等适用影响链完整；
7. Planner 只能引用系统冻结的 requirement/scenario/evidence/claim/binding/command ID，不能输出 Agent、角色或能力要求，伪造路径和命令失败关闭；
8. Service 生成的 CapabilityRequirement 可追溯到 Binding、PlanningRiskProfile、Task relationship 和版本化规则；每个硬资格 claim 可追溯到受控 definition 与人工确认或 managed registry；
9. WorkPackage/DeliveryTask 边界由业务 owner、依赖、风险和可验证性决定；每个 Task 有冻结 TaskContextPack 和 required `implementation|verification|review|migration|release` relationship，relationship 的 DAG/独立 owner 规则通过；
10. 独立 Requirement、Scenario Coverage、Binding 和 Plan Reviewer 无 blocking finding，所有 required Scenario 有实施与验证计划覆盖；
11. 每个 executable proposal 有唯一 terminal AssignmentEvaluation；ready Task 有 current access grant、结构合格 executingAgentId，并由该 Agent 的 Service-verdict TaskPreflight 通过 identity/evidence/scope/scenario checks；Gold selection 与 abstention 全量指标达门禁；
12. Approval 与 Dispatch 为独立 immutable 命令/记录：Approval 永远 0 TaskRun，waiting Dispatch 返回 202 且 0 Run；Squad leader 只协调，TaskRun.agentId 恒等于 executingAgentId；
13. authoritative workspace OS lock/fencing 覆盖 recovery、mutation 和所有后台 continuation；PlanningReferenceMap 与 active TaskRun 唯一，DeliveryTask/Assignment/Run/Verification 历史不覆盖，重复、竞态、重试、grant revocation 和 stale 有自动化证据；
14. 所有 required verification 完成后，先按 DAG 将每个 TaskRun output 通过可复算 ancestor/patch-hunk-tree/duplicate/no-code proof、target-tree continuity 和 target ref CAS 集成到 CanonicalTargetBinding 并固定 clean `finalCommit`；manual conflict resolution 仍需 proof，no-code 要求重算 diff 为空及 actor/reason 审计；再基于 final Snapshot 收敛。存在 proof 失败、未集成、冲突、目标 stale、unmet/partial/unrequested/policy_violation/stale_verification 时不能关闭；
15. Convergence repair 以父 Plan/Integration/Review 的 canonical finalCommit 建 immutable baseline；每个 carry item 是独立唯一 child，每种 disposition 都有 exact-one source-target CarryValidation；missing/duplicate/invalid 阻止 successor commit/Approval；每个 finding 不可丢，上游变化幂等创建 successor；
16. `lscity-nuxt` Gold、至少两个同支持边界但结构不同的仓库、unsupported-stack 反例、mutation/adversarial 和 5 次真实模型重复运行达到 release gate；
17. 全量测试、构建、package smoke、clean install 和 3080 浏览器 happy-path/business-rejection/boundary/dependency-failure 回归实际通过；
18. 旧 V2 计划兼容可读，V3 失败不静默降级；shadow 中间事实只能按 operation 查询，不污染 current Project/Requirement/Assignment 视图、审批、容量或 Dispatcher，也不伪造 convergence；
19. 真实试用满足：AssignmentEvaluation/reason coverage=100%，selected-owner>=90%（critical=100%），abstention recall>=95%（critical=100%）/precision>=90%/false-abstention<=10%（critical=0），first-pass Service Preflight>=85%，无澄清启动>=80%，首次完成 canary>=60%/稳定>=70%，rewrite<=20%、rework<=15%，time-to-usable-plan P50<=20/P95<=45 分钟，false-ready/false-converged=0。

在长期多项目指标完成前，准确表述应是：

> 系统已经实现 V3.3 的结构化需求、代码绑定、任务 DAG、受控能力分派、Preflight、Approval/Dispatch 分离和交付收敛门禁；当前自动化与单项目 Canary 证明这些门禁能失败关闭，但尚不能替代多项目、同一 MetricPolicyVersion 下的重复真实模型质量采样。

## 23. 当前实施状态与下一步

截至 2026-09-05，V3.3 candidate 已落地到 Schema、Storage、Service、HTTP、响应式 Web、WorkspaceWriter、Repository Provider、Assignment/Preflight、Approval/Dispatch、Delivery Integration/Convergence 和 repair lineage。发布前自动化覆盖 298 项，并实际执行 typecheck、文档检查、全量测试和 package smoke。Agent turn 现在有统一的 10 分钟上限；超时会取消会话、把当前 PlanningOperation 记为可重试失败、恢复 Project，且不会物化 Task、Approval 或 Dispatch。repair successor 若在后续生成阶段失败，retry 从该失败 operation 的真实 stage 继续，继承其已冻结上游产物并把确定性诊断注入首次纠错；原 Review repair attempt 继续作为同一 lineage owner，不回退到更早 restartStage 重复分析。

3080 单项目真实模型 Canary 已证明仓库快照变化、能力 claim 缺失和零合格候选会失败关闭；它仍不是第 22 节“好用”结论所需的长期统计证据。后续必须在冻结的 `MetricPolicyId/MetricPolicyVersion/policyDigest` 下继续完成 `lscity-nuxt`、两个异构受支持项目、unsupported 反例和每个 Golden Case 至少 5 次真实规划，报告 selection、abstention、rewrite、rework、time-to-usable-plan、false-ready 和 false-converged 的完整分母。

不建议直接从 prompt 调优开始。Prompt 调优无法把 Planner 自报 evidence 变成系统事实，也无法为错误路径、漏 consumer、错误 owner 和 false-ready 提供确定性门禁。
