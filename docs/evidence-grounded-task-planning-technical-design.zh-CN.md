# 基于可验证代码证据的任务规划技术设计

状态：V3.3 candidate 已实现，发布验证中；长期多项目质量指标仍待持续采样

目标版本：Evidence-Grounded Planning V3.3

持久化/API 版本：`planningContractVersion=3`；`3.3` 是设计修订号，不写入整数版本字段

设计日期：2026-08-26

修订日期：2026-08-28

修订依据：[`evidence-grounded-task-planning-improvement-review.zh-CN.md`](./evidence-grounded-task-planning-improvement-review.zh-CN.md)

上层设计：[`evidence-grounded-task-planning-improvement-design.zh-CN.md`](./evidence-grounded-task-planning-improvement-design.zh-CN.md)

适用模块：`src/types.ts`、`src/workflow.ts`、`src/service.ts`、`src/storage.ts`、`src/http.ts`、`src/api-client.ts`、`src/client-types.ts`、`src/client.tsx`

## 1. 结论

本方案在现有 Planning Contract V2 上增加一条由系统持有、可追溯、可判定 stale 的代码事实链：

```text
RequirementSourceProfile -> RequirementSourceAnchor(all-block classification/disposition)
  -> RequirementItem / AcceptanceCriterion / seed AcceptanceScenario / RequirementDecision
  -> DecisionOptionEffect
source anchors + inherited RepositoryPolicyBaseline + Requirement/seed Scenario
  -> SourcePolicyPrecheck
DecisionOptionEffect + SourcePolicyPrecheck + seed Scenario -> DecisionEffectPrecheck
  -> PlanningRiskProfile + per-Acceptance ScenarioCoveragePolicy
  -> AcceptanceScenario completion + ScenarioCoverageReview
  -> RepositoryContextSnapshot / RepositoryStackProfile / RepositoryEvidenceNode
  -> CanonicalTargetBinding -> PlanningPolicySnapshot / PolicyConstraint
  -> repository Policy fixed-point baseline or converged Policy
  -> EvidenceClaim -> RequirementCodeBinding
  -> PlanningPromptReferenceManifest
  -> WorkPackageProposal / TaskProposal / TaskContextPack
  -> PlanningReferenceMap / PolicyFulfillment
  -> Service-derived CapabilityRequirementDraft -> PlanningReview
  -> ProjectCapabilityCatalogSnapshot / AssignmentDraft(executingAgentId)
  -> TaskPreflight(by executingAgentId)
  -> DecisionEffectFinalization
  -> DeliveryTask / AssignmentDecision / PlanSnapshot
  -> TaskRun / VerificationEvidence
  -> DeliveryIntegrationSnapshot(canonical finalCommit)
  -> final RepositoryContextSnapshot / DeliveryConvergenceReview
```

正确修改层不是继续增强 `plannerPromptV2`，而是在 Planner 前后增加由 Service 控制的事实边界和确定性门禁：

1. Service 冻结需求来源和仓库上下文，Planner 不能自报自己看过的路径或命令；
2. Binding 阶段先回答每条需求由哪些现有代码 owner、数据、状态、接口、消费者和测试承担；
3. Planner 对本 operation 已存在的 Requirement、Scenario、Decision 和 Binding 只能使用 Service 注入的 local key，对 Policy、Evidence 和 Command 等已冻结 artifact 只能使用 prompt-scoped opaque ref；Service 分别通过本轮 key namespace/PlanningReferenceMap 和不可变 PlanningPromptReferenceManifest 解析，Planner 不得看到或生成数据库 ID；角色与 CapabilityRequirement 由 Service 根据 Binding、任务关系和版本化规则推导，Planner 不得选择；
4. Requirement Review 后冻结 PlanningRiskProfile；Binding 以 EvidenceClaim 说明结论如何被支持或反驳；
5. Planner 生成带 TaskContextPack 的 TaskProposal，Service 在 Plan Review 前推导 CapabilityRequirementDraft，Plan Reviewer 独立检查任务边界、交付链、依赖、冲突、接手上下文和验证；
6. Assignment 先判断结构资格，再计算排序；AssignmentEvaluation 必须冻结与 AssignmentDraft 相同的 routing target、`executingAgentId` 和 draft digest；审批前必须由该 Agent 完成 TaskPreflight，Squad leader 不能替代执行成员；Runtime、容量和冲突等待单独表达；
7. required 链路不完整、MUST Policy 未处理、技术栈不在当前支持边界、引用超出快照、关键代码 owner 不确定、能力要求无法受控推导、无结构合格成员或 required TaskPreflight 未 accepted 时，计划必须 `blocked/needs_clarification`；
8. 规划过程使用持久化 `PlanningOperation` 和可恢复 Saga。当前适配器只承诺单进程串行、revision 复核、最后切指针和补偿，不声称具备数据库事务；
9. 所有 TaskRun 和 required verification 完成后，先将输出集成到唯一 canonical target 的 clean `finalCommit`，再由 Delivery Convergence 使用最终仓库快照重新核对 Requirement、Scenario、Policy、Binding 和批准计划；发现剩余或计划外行为时只创建新 revise operation，不原地修改批准计划；
10. V3.3 通过 shadow、真实模型评测、交付收敛评测和 3080 canary 后才成为默认路径；最小 Integration/Convergence 必须在开放 candidate 前完成，旧 V2 计划不伪造 V3.3 证据，也不自动迁移。

完成本设计的实现，不等于自动获得“好用”结论。只有真实项目 Gold、mutation/adversarial、重复真实模型运行、全量自动化和 3080 浏览器回归达到上层设计的 release gate，才可以对用户声明满足预期。

## 2. 设计目标与非目标

### 2.1 设计目标

- 对 PRD 和技术方案中的规范性内容建立逐条、稳定、可审计的 disposition；
- 保留 Acceptance 原文，同时建立可执行、可证伪的 AcceptanceScenario；
- 把项目 MUST/不得类规则冻结为带 authority、scope、disposition 和 digest 的 PlanningPolicySnapshot；
- 让仓库新增 MUST 通过单调 RepositoryPolicyBaseline 达到固定点，并在任务引用冻结后以独立 PolicyFulfillment 证明落实到 Task/Verification；
- 对 brownfield 仓库建立与 commit、dirty worktree 和 provider 版本绑定的事实快照；
- 明确当前 release 的受支持技术栈，unsupported stack 不以文本检索冒充代码理解；
- 让需求到代码的映射成为独立领域对象，而不是隐藏在 Task 描述中；
- 用业务 owner、状态链、依赖、风险和验证边界决定任务粒度；
- 由 Service 推导角色和 CapabilityRequirement，并只使用受控 CapabilityDefinition 与可信 AgentCapabilityClaim 做硬资格；
- 保证所有可执行 Task 有结构合格的 Agent 或 Squad 路由；
- 先把所有 TaskRun 输出集成到 canonical finalCommit，再用最终仓库快照执行 DeliveryConvergenceReview，区分“Task 已跑完”“已集成”和“需求已在代码中收敛”；
- 对缺证据、错误引用、关键待决策、零候选、仓库漂移、并发冲突和恢复失败采用真实失败语义；
- 复用 V2 Requirement、Acceptance、Decision、PlanSnapshot、Task、TaskRun 和 VerificationEvidence；
- 支持 `initial`、`append`、`revise`，并保证历史计划、运行和验证证据不可覆盖。

### 2.2 非目标

- 不在 V3 首版构建通用、跨语言、完整语义代码图；
- 不让 LLM 直接读任意本地文件或执行任意命令；
- 不从 Persona、Skill 名称或自然语言简介推导硬能力；
- 不允许 Planner 输出 role/capability requirement，或通过选择现有成员能力来反向扭曲任务语义；
- 不让 Planner 选择 Agent ID、Runtime ID 或绕过候选算法；
- 不用字符串模糊匹配修复角色和能力目录不一致；
- 不在一个版本内重写整个 `service.ts` 或替换存储框架；
- 不把 shadow 结果、fake LLM 契约测试或一次人工观感当作发布证据；
- 不自动把 V2 计划升级成 V3 ready 计划。
- 不把 TypeScript/Nuxt/Vue/Prisma 首版能力宣称为跨语言通用代码理解；
- 不把 Plan Review、TaskRun success 或测试命令通过单独视为 Delivery converged。

## 3. 当前事实与修改边界

### 3.1 可复用的 V2 事实

当前代码已经具备：

- 独立的 RequirementBundle、RequirementItem、AcceptanceCriterion 和 RequirementDecision；
- PlanSnapshot 中的 requirement、decision、team 和 assignment digest；
- Task 对 requirement、acceptance、decision 的结构化引用；
- Acceptance 实施与验证双覆盖、Decision gate、DAG、testCommand、独立 Reviewer 和 assignment 校验；
- `decompose` 中“先写子记录，最后切 Project 指针，失败补偿”的提交思路；
- 审批时复核当前 candidate 和各类 digest，执行前再次复核稳定计划；
- TaskRun 的 attempt、retry、workspace、Git evidence、测试输出、等待原因和 settle ownership；
- 服务启动时的 interrupted work、run dispatch 和 approved project 恢复。

这些对象仍是 V3 的 source of truth，不另建一套平行的 Requirement 或执行系统。

### 3.2 根因所在层

V2 的缺陷位于 Planner 输入事实与 Planner 输出任务之间：

```text
当前：文档 -> 部分 Source Manifest -> LLM 自报 repositoryEvidence -> Task

目标：文档 -> 完整 disposition -> 系统仓库快照 -> Code Binding
     -> WorkPackage -> Task -> Review -> Assignment
```

因此以下做法不构成根因修复：

- 仅增加 prompt 中“请仔细阅读代码”；
- 对 Planner 返回的 path 做一次 `existsSync` 后继续信任；
- 允许 capability 中文短语和 Agent 声明做相似度匹配；
- 所有 Acceptance 任意挂到两个大 Task 上即可通过；
- 无候选时自动选择项目 Lead 或任意 Squad 成员；
- V3 blocked 时静默生成 V2 candidate。

### 3.3 当前一致性承诺

现有 `serializedMutation` 只保证同一 Service 实例内串行，不能证明同一 workspace 没有第二个可写进程。V3.3 在任何 candidate 写路径启用前必须建立 host 级单 writer fencing：

```ts
interface WorkspaceWriterLeaseRecord {
  workspaceIdentityDigest: Sha256
  ownerInstanceId: string
  ownerPid: number
  ownerHostId: string
  fencingToken: number
  acquiredAt: ISODate
  heartbeatAt: ISODate
  releasedAt?: ISODate
  releaseReason?: string
  schemaVersion: 1
}
```

Service 启动时先按 `workspaceIdentityDigest` 获取排他的 OS file lock；只有持有打开 lock handle 的实例才能执行 recovery、mutation、scheduler、dispatch、TaskRun settle、integration、convergence 或 repair。OS lock 是权威，record 只用于审计和诊断。每次 mutation 及后台 continuation 必须调用 `assertWriter(fencingToken)`；lock 丢失后 fence 所有新写并中止本实例拥有的 operation。恢复只能在成功获取更大 fencing token 后运行。锁已被占用时返回 `workspace-writer-active`，实例进入只读或启动失败，不能降级为进程内锁。

在该部署不变量下，`PlanningStore` 适配器再使用 expected revision、不可变子记录、最后切 Project 指针和 Saga 补偿提供一致性。所有子系统共享同一 writer owner/token，不得各自建立互不相识的锁。未来支持多 host 或服务端数据库前，必须由真正的 transaction、唯一索引、租约共识和 CAS 替换该适配器；复制内存锁不成立。

## 4. 总体架构

```text
                     +--------------------------+
PRD / Design ------> | Source Profile/Manifest  |
                     | Requirement/Scenario     |
Project Rules -----> | Decision Precheck        |
                     | Review/Risk/Policy       |
                     | Snapshot                 |
                     +------------+-------------+
                                  |
Repository root ---> +------------v-------------+
                     | Repository Context       |
                     | Stack Profile / Providers|
                     +------------+-------------+
                                  |
                                  v
                     +--------------------------+
                     | Evidence Store/Gateway   |
                     | Claim/Binding + Review   |
                     +------------+-------------+
                                  |
                                  v
                     +--------------------------+
                     | TaskProposal/ContextPack |
                     | Reference Mapping        |
                     | Capability Derivation    |
                     | Plan Review              |
                     +------------+-------------+
                                  |
Capability Registry +------------v-------------+
Team Catalog ------> | Catalog/Assignment Draft |
Runtime State -----> | executing Agent Preflight|
                     | Decision Finalization     |
                     +------------+-------------+
                                  |
                                  v
                     +--------------------------+
                     | Commit/Approval/TaskRun   |
                     | VerificationEvidence     |
                     +------------+-------------+
                                  |
Final repository --> +------------v-------------+
                     | Delivery Integration     |
                     | inclusion/CAS/finalCommit|
                     +------------+-------------+
                                  |
                     +------------v-------------+
                     | Delivery Convergence     |
                     | Review / Repair Revision |
                     +--------------------------+
```

### 4.1 组件责任

| 组件 | 写入事实 | 不允许做的事 |
| --- | --- | --- |
| Source Manifest Builder | 来源 anchor、规范性分类、required disposition | 猜测业务结论 |
| Source Completeness Service | RequirementSourceProfile、页/块/附件/OCR 完整性 | 把抽样或不完整 normative source 标成 complete |
| Requirement Analyzer | Requirement、Acceptance、Decision 候选 | 引用仓库 path、选择 Agent |
| Decision Effect Service | 每个 option 的来源级影响、precheck 和 TaskPreflight 后基于完整 drafts 的 final effect | 在完整 Binding/Task/Capability/Assignment 事实形成前伪造最终影响，或直接覆盖 blocking 布尔值 |
| Acceptance Scenario Service | 从原始 Acceptance 生成可证伪 Scenario，并校验观察面 | 改写原始 Acceptance 或用测试名代替业务结果 |
| Planning Review Service | 持久化 Requirement/Binding/Plan review、independence、finding、round 和 stale | 原地改写 subject 或让创建者自审关键事实 |
| Risk Profile Service | 根据已审需求增加 evidence/review/preflight/convergence 深度 | 降低 normative input 或硬门禁 |
| Policy Service | 提取 authority/MUST/SHOULD、scope、适用性和 disposition，维护单调 RepositoryPolicyBaseline，并在引用冻结后生成 PolicyFulfillment | 把普通建议自动升级为 MUST、对相同仓库 Policy 重复触发 stale 或原地回写 Task 映射 |
| Repository Providers | path、symbol、route、schema、command、test 等 evidence | 解释业务需求、创建 Task |
| Stack Profiler | 识别技术栈、Provider coverage 和支持状态 | 在 unsupported stack 上宣称 ready |
| Evidence Gateway | evidence 搜索、受限读取、访问审计 | 暴露快照外文件或敏感内容 |
| Evidence Claim Service | owner/path/boundary claim、支持/反证、confidence 和 stale | 把“读过文件”当作结论已被证明 |
| Binding Agent | RequirementCodeBinding 候选 | 自造 path/symbol/command |
| Binding Reviewer | binding 完整性和 owner 正确性 finding | 静默改 Requirement |
| WorkPackage Builder | 业务交付包和影响边界 | 直接分配 Agent |
| Task Planner | TaskProposal、TaskContextPack、DAG、验证计划，只返回 prompt-scoped ref | 自造 evidence、role、capability、Agent、数据库 ID 或未注入 ref |
| Plan Reviewer | proposal/context/capability draft 的跨工件 finding | 绕过 blocking finding |
| Capability Service | 受控 definition/claim、项目能力快照、任务 role/capability draft | 从 Planner/Persona/Skill 或自由文本自动授予硬资格 |
| Assignment Engine | AssignmentDraft、资格、排序、routing target、实际 executing Agent、与 draft 闭合的 AssignmentEvaluation、等待状态和拒绝原因 | 从 Persona/Skill 推断硬资格、让 Squad leader 替代执行成员资格或评测另一个 owner |
| TaskPreflight Service | 实际 executing Agent 接手检查、missing fact 和 root-cause routing | 改写任务语义、执行代码或接受 leader 代检 |
| Planning Service | 状态机、digest、stale、commit、恢复 | 把局部写成功报告为完整成功 |
| Execution Service | 计算 approved DAG 的 runnable frontier、逐 Task dispatch outcome、claim、TaskRun、Git scope、verification | 越过依赖启动、因一个软等待阻塞整个可运行前沿，或覆盖计划和历史 run |
| Delivery Integration / Convergence Service | canonical target DAG 集成、patch/tree inclusion、target CAS、final snapshot、规格到代码 finding、修复 revision | 把 TaskRun success/worktree head/integrated 状态当成 inclusion 或原地修改 approved plan |

## 5. 模块划分

新增代码按事实 owner 划分，避免继续把所有逻辑堆入 `workflow.ts` 或 `service.ts`：

```text
src/planning/
  source-manifest.ts
  source-completeness.ts
  acceptance-scenario.ts
  decision-effect.ts
  planning-review.ts
  risk-profile.ts
  policy.ts
  policy-fulfillment.ts
  repository-context.ts
  repository-stack.ts
  evidence-gateway.ts
  evidence-claim.ts
  code-binding.ts
  work-package.ts
  task-context.ts
  prompt-reference.ts
  capability.ts
  assignment.ts
  task-preflight.ts
  delivery-integration.ts
  delivery-convergence.ts
  digest.ts
  planning-operation.ts
  repository-providers/
    filesystem.ts
    manifest.ts
    typescript.ts
    vue.ts
    prisma.ts
    test.ts
    graphify.ts
```

现有文件责任调整：

| 文件 | V3 责任 |
| --- | --- |
| `src/types.ts` | 所有持久化和 API Schema，legacy/V2/V3 兼容联合类型 |
| `src/workflow.ts` | 保留纯引用、DAG、coverage、digest 和状态校验；复杂 provider 移出 |
| `src/service.ts` | 编排 PlanningOperation、Project commit point、审批和执行衔接 |
| `src/storage.ts` | 新表、PlanningStore capability、兼容迁移和恢复扫描 |
| `src/http.ts` | planning operation、snapshot、binding、review、assignment 路由 |
| `src/api-client.ts` | V3 查询、刷新、重试和人工确认客户端 |
| `src/client-types.ts` | 面向 UI 的聚合 DTO，不复制领域判断 |
| `src/client.tsx` | 需求规则、仓库支持、代码理解、任务、能力分派、门禁、交付收敛七层诊断 UI |

## 6. 持久化模型

所有 V3 记录使用不可变事实或显式 revision。大规模 anchor 和 evidence 不嵌入 `PlanSnapshotRecord`，避免单记录无界增长。

### 6.1 PlanningOperationRecord

```ts
type PlanningOperationStatus =
  | 'running'
  | 'blocked'
  | 'failed'
  | 'committed'
  | 'shadow_completed'
  | 'superseded'
  | 'aborted'

type PlanningOperationStage =
  | 'reserved'
  | 'source_ingest'
  | 'source_profile'
  | 'source_manifest'
  | 'requirement_analysis'
  | 'requirement_review'
  | 'source_policy_precheck'
  | 'decision_effect_precheck'
  | 'risk_profile'
  | 'scenario_completion'
  | 'scenario_coverage_review'
  | 'repository_snapshot'
  | 'canonical_target_binding'
  | 'policy_snapshot'
  | 'code_binding'
  | 'binding_review'
  | 'work_packages'
  | 'task_plan'
  | 'reference_mapping'
  | 'policy_fulfillment'
  | 'capability_requirement_derivation'
  | 'plan_review'
  | 'capability_catalog_snapshot'
  | 'access_grant_snapshot'
  | 'assignment_qualification'
  | 'task_preflight'
  | 'decision_effect_finalization'
  | 'convergence_carry_validation'
  | 'committing'
  | 'committed'
  | 'shadow_completed'

interface PlanningOperationRecord {
  id: string
  projectId: string
  mode: 'initial' | 'append' | 'revise'
  status: PlanningOperationStatus
  stage: PlanningOperationStage
  planningContractVersion: 3
  publicationMode: 'shadow' | 'candidate'
  metricPolicyId: string
  metricPolicyVersion: string
  metricPolicyDigest: Sha256

  baseProjectRevision: number
  basePlanSnapshotId?: string
  revisedBundleId?: string
  triggeredByConvergenceReviewId?: string
  repairBaselineId?: string
  predecessorOperationId?: string
  coveragePolicyBaselineOperationId?: string
  coveragePolicyBaselineDigest?: Sha256
  repositoryPolicyBaselineId?: string
  repositoryPolicyBaselineDigest?: Sha256
  repositoryPolicyIteration: number
  requestDigest: Sha256
  idempotencyKey?: string

  sourceManifestId?: string
  sourceProfileIds: string[]
  sourceCompletenessDigest?: Sha256
  sourceDispositionBindingIds: string[]
  sourceDispositionBindingDigest?: Sha256
  requirementBundleIds: string[]
  acceptanceScenarioIds: string[]
  seedScenarioDigest?: Sha256
  acceptanceScenarioDigest?: Sha256
  scenarioCoverageReviewId?: string
  scenarioCoverageReviewDigest?: Sha256
  acceptanceScenarioCoveragePolicyIds: string[]
  acceptanceScenarioCoveragePolicyDigest?: Sha256
  decisionIds: string[]
  decisionOptionEffectIds: string[]
  decisionPlanningEffectIds: string[]
  decisionEffectPrecheckDigest?: Sha256
  decisionEffectFinalDigest?: Sha256
  requirementReviewId?: string
  requirementReviewDigest?: Sha256
  sourcePolicyPrecheckId?: string
  sourcePolicyDigest?: Sha256
  planningRiskProfileId?: string
  repositorySnapshotId?: string
  repositoryStackProfileId?: string
  canonicalTargetBindingId?: string
  canonicalTargetBindingDigest?: Sha256
  policySnapshotId?: string
  policyFulfillmentIds: string[]
  policyFulfillmentDigest?: Sha256
  accessGrantSnapshotId?: string
  accessGrantSnapshotDigest?: Sha256
  evidenceClaimIds: string[]
  bindingIds: string[]
  bindingReviewId?: string
  bindingReviewDigest?: Sha256
  workPackageProposalIds: string[]
  taskProposalIds: string[]
  proposalPackId?: string
  promptReferenceManifestId?: string
  promptReferenceManifestDigest?: Sha256
  capabilityRequirementDraftIds: string[]
  planReviewId?: string
  planReviewDigest?: Sha256
  capabilityCatalogSnapshotId?: string
  assignmentDraftIds: string[]
  assignmentEvaluationIds: string[]
  assignmentEvaluationDigest?: Sha256
  convergenceCarryValidationIds: string[]
  convergenceCarryValidationDigest?: Sha256
  taskPreflightIds: string[]
  taskPreflightDigest?: Sha256

  // 仅 final commit 成功后填充的正式业务记录。
  workPackageIds: string[]
  taskIds: string[]
  capabilityRequirementIds: string[]
  assignmentDecisionIds: string[]
  candidatePlanSnapshotId?: string
  shadowEvaluationId?: string
  reservedPlanSnapshotId: string
  reservedPlanRevision: number
  planningReferenceMapId?: string
  planningReferenceMapDigest?: Sha256

  diagnostics: Diagnostic[]
  leaseOwner?: string
  leaseVersion: number
  leaseExpiresAt?: ISODate
  heartbeatAt?: ISODate
  createdAt: ISODate
  updatedAt: ISODate
  completedAt?: ISODate
}
```

`reservedPlanSnapshotId` 在 operation reserve 时生成，即使后续 blocked/failed 也不可复用于其他 operation。Source 阶段固定为 `source_ingest -> source_profile -> source_manifest`；`sourceProfileIds` 和 `sourceCompletenessDigest` 是冻结 Manifest、进入 Requirement Analyzer、Binding 和 Plan Review 的前置事实，缺少完整 normative profile 时 operation 只能 blocked，不能以 warning 继续。

`workPackageProposalIds/taskProposalIds/capabilityRequirementDraftIds/assignmentDraftIds/taskPreflightIds` 是 commit 前不可执行规划事实。`workPackageIds/taskIds/capabilityRequirementIds/assignmentDecisionIds` 在 final commit 前必须为空；预留 ID 只存在于 PlanningReferenceMap，不证明对应正式记录已经物化。blocked/failed/shadow operation 不得通过正式 ID 让 UI、Dispatcher 或恢复流程误认为存在 executable Task。

Operation 上的集合 digest 均由对应 current ID/digest 对按稳定业务键排序后计算，不能通过“查询该 operation 下最新一条”临时推断。`promptReferenceManifestId/digest` 只指向最终通过 Schema 校验并产出 current Proposal 的 `task_plan` attempt；attempt 被重试或替换时创建新 manifest/proposal，旧记录保留历史且不得混入 current aggregate。

### 6.1.1 RequirementSourceProfileRecord

```ts
interface RequirementSourceProfileRecord {
  id: string
  projectId: string
  operationId: string
  documentId: string
  authority: 'normative' | 'context'
  mediaType: 'markdown' | 'text' | 'pdf' | 'normalized_document'
  contentDigest: Sha256
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
    digest?: Sha256
    status: 'readable' | 'missing' | 'unsupported' | 'uncertain'
  }>
  confidence: 'high' | 'medium' | 'low' | 'unknown'
  status: 'complete' | 'partial' | 'unsupported' | 'failed' | 'stale'
  authorityAudit?: { actor: string; reason: string; at: ISODate }
  diagnostics: Diagnostic[]
  profileDigest: Sha256
  createdAt: ISODate
}
```

只有 `status=complete` 的 normative profile 才能进入 candidate planning；PDF 抽样视觉页、未分析图表/附件、OCR 低置信和不支持 parser 都必须是 `partial/unsupported` 并产生 `source-evidence-incomplete`。context source 的降级需要 actor、reason 和审计记录，不能把 normative source 静默降级绕过门禁。

不变量：

- 同一 `projectId + requestDigest` 的非终态 operation 只能有一个；
- `idempotencyKey` 相同但 requestDigest 不同返回 `409 idempotency-conflict`；
- stage 只能向前推进；仅 stage-local repair 可在同 operation 追加 attempt，上游 subject repair 必须 terminal 当前 operation 并创建带 lineage 的 successor operation；
- child IDs 只追加 operation 本轮创建的记录；
- `committed` 必须满足 Project.currentPlanSnapshotId 指向 candidate；
- `shadow_completed` 必须有 shadowEvaluationId，且正式 workPackage/task/capability requirement/assignment/PlanSnapshot ID 为空，不得改变 Project.currentPlanSnapshotId；
- `blocked` 不创建可审批 candidate pointer。

### 6.1.2 V3 Requirement ownership 与发布可见性

V2 Requirement 记录主要按 `projectId/bundleId` 组织。V3 为避免 shadow/blocked/failed 分析结果污染正式需求视图，对 `RequirementBundleRecord` 增加强制字段：

```ts
interface RequirementBundleV3Ownership {
  planningContractVersion: 3
  planningOperationId: string
}
```

V3 `RequirementItem/AcceptanceCriterion/RequirementDecision` 必须有 `bundleId`，并通过 bundle 归属于唯一 PlanningOperation；AcceptanceScenario 和其他新对象继续保存 `operationId`。`publicationMode` 不复制到每个 child，而是从 owning PlanningOperation 派生，避免两份状态不一致。正式可见性不由 child 自身的 `active` 字段决定，而由 `Project.currentPlanSnapshotId -> PlanSnapshot.requirementBundleIds` 的引用闭包决定：

- shadow/blocked/failed bundle 可以持久化和按 operation 查询，但不属于 current project requirement view；
- final commit 只把本 operation 已批准 bundle IDs 写入 PlanSnapshot 并最后切 Project pointer；
- `/requirements`、`/requirement-decisions` 和默认 planning 聚合必须先取 current Plan 的 bundle IDs，再读 children；禁止仅按 `projectId` 全表返回；
- append/revise 复用旧 bundle 时通过 PlanSnapshot 显式引用，不修改旧 bundle ownership；
- recovery 只能清理 owning operation 独占且未被任何 committed Plan 引用的 bundle/children。

### 6.1.3 PlanningStageAttempt 与 Evidence Access

LLM/provider 调用和“模型实际读取过哪些证据”不能只存在内存。每次 stage attempt 和 evidence gateway 调用独立持久化：

```ts
interface PlanningStageAttemptRecord {
  id: string
  operationId: string
  stage: PlanningOperationStage
  round: number
  status: 'running' | 'completed' | 'failed' | 'cancelled'
  inputDigest: Sha256
  outputDigest?: Sha256
  promptVersion?: string
  promptDigest?: Sha256
  contextDigest?: Sha256
  providerId?: string
  providerVersion?: string
  inputTokens?: number
  outputTokens?: number
  durationMs?: number
  errorCode?: string
  createdAt: ISODate
  completedAt?: ISODate
}

interface PlanningEvidenceAccessRecord {
  id: string
  operationId: string
  stageAttemptId: string
  repositorySnapshotId: string
  accessType: 'search' | 'read'
  requestDigest: Sha256
  returnedEvidenceIds: string[]
  createdAt: ISODate
}
```

Binding/Planner 输出引用的 evidence 必须出现在同一 stage attempt 的 `read` access 集合中。`search` 只返回 summary，不算已读取内容。访问记录不保存原 query 和完整 excerpt，只保存 request digest 和返回 ID，敏感内容继续由 evidence store 控制。

### 6.2 RequirementSourceManifestRecord

```ts
interface RequirementSourceManifestRecord {
  id: string
  projectId: string
  operationId: string
  sourceDigest: Sha256
  sourceProfileIds: string[]
  sourceCompletenessDigest: Sha256
  parserVersion: string
  anchorIds: string[] // 必须与全部 normative profile 的 parsed block 一一对应
  sourceBlockCount: number
  classifiedBlockCount: number
  requiredAnchorCount: number
  classificationDigest: Sha256
  dispositionDigest: Sha256
  status: 'candidate' | 'accepted' | 'superseded'
  createdAt: ISODate
}

interface RequirementSourceAnchorRecord {
  id: string
  manifestId: string
  documentKind: 'prd' | 'technical_design'
  locator: string
  sectionPath: string[]
  ordinal: number
  text: string
  textDigest: Sha256
  normativeHints: Array<
    | 'functional' | 'business_rule' | 'acceptance' | 'decision'
    | 'data' | 'state' | 'permission' | 'failure' | 'non_functional'
    | 'migration' | 'compatibility' | 'rollback'
  >
  contentClassification: 'normative' | 'context' | 'duplicate' | 'uncertain'
  classificationReason: string
  classificationReviewerId?: string
  requiredDisposition: boolean
  disposition?:
    | 'requirement'
    | 'acceptance'
    | 'decision'
    | 'constraint'
    | 'deferred'
    | 'out_of_scope'
  reason?: string
  reentryCondition?: string
  dispositionOwner?: string
  duplicateOfAnchorId?: string
}
```

`RequirementSourceAnchorRecord` 在 `source_manifest` 阶段只冻结来源 block、classification 和主 disposition，不引用尚未创建的业务记录。`requirement_analysis` 创建 Requirement/Acceptance/Decision/SourceConstraint 后，必须为每个 `contentClassification='normative'` 且需要目标的 Anchor 写入不可变绑定：

```ts
interface SourceDispositionBindingRecord {
  id: string
  projectId: string
  operationId: string
  sourceManifestId: string
  sourceAnchorId: string
  disposition: 'requirement' | 'acceptance' | 'decision' | 'constraint'
  targetType: 'requirement' | 'acceptance' | 'decision' | 'source_constraint'
  targetId: string
  targetDigest: Sha256
  bindingDigest: Sha256
  createdAt: ISODate
}
```

Anchor 的 deferred/out-of-scope 结论继续由 Anchor 自身的 reason/owner/reentryCondition 闭合，不创建虚假 target。其余 normative Anchor 必须至少一条且只能指向与 disposition 相容的 current-operation target；Manifest、SourceDispositionBinding 集合和 Requirement digest 共同构成 source disposition closure。模型只返回 local key，Service 在 `requirement_analysis` 写入业务记录后解析成真实 ID；禁止在 Manifest 上原地补 `targetIds`。

Manifest 必须为每个 normative profile 的 parsed block 生成恰好一个 Anchor，且 `classifiedBlockCount === sourceBlockCount === sum(profile.parsedBlocks)` 后才可 accepted。每个 Anchor 必须先有唯一 `contentClassification`：`normative` 才允许并强制 `requiredDisposition=true` 和唯一 disposition；`context` 必须有 reason，命中任一 normative hint 时还必须有独立 `classificationReviewerId`；`duplicate` 必须引用同 manifest 中已分类主 Anchor 且无环；`uncertain` 一律 `source-classification-uncertain` 阻塞。`deferred/out_of_scope` 必须有 reason、owner 和 reentry condition。进入 Requirement Review 前还必须验证 SourceDispositionBinding closure；关键词、章节和表格结构只生成 hints，不能把未命中的普通陈述式业务规则排除在 classification 分母之外。

### 6.2.1 AcceptanceScenarioRecord

`AcceptanceCriterionRecord` 继续保存用户原始验收文本；Scenario 单独保存可执行语义，不能覆盖原文：

```ts
type AcceptanceScenarioCategory =
  | 'happy_path' | 'business_rejection' | 'boundary'
  | 'dependency_failure' | 'security' | 'compatibility' | 'recovery'

interface AcceptanceScenarioRecord {
  id: string
  key: string
  projectId: string
  operationId: string
  requirementId: string
  acceptanceCriterionId: string
  sourceAnchorIds: string[]
  category: AcceptanceScenarioCategory
  derivationPhase: 'seed' | 'completion'
  required: boolean
  preconditions: string[]
  trigger: string
  expectedOutcomes: string[]
  observableAt: Array<{
    kind: 'api' | 'ui' | 'database' | 'event' | 'log' | 'test' | 'artifact'
    description: string
  }>
  eventObservables?: Array<{
    key: `EVT-${string}`
    description: string
    expectation: 'present' | 'absent'
  }>
  derivation: 'explicit' | 'inferred'
  assumptions: string[]
  scenarioDigest: Sha256
  createdAt: ISODate
}

interface AcceptanceScenarioCoveragePolicyRecord {
  id: string
  projectId: string
  operationId: string
  requirementId: string
  acceptanceCriterionId: string
  requirementDigest: Sha256
  riskDerivationInputDigest: Sha256
  categories: Array<{
    category: AcceptanceScenarioCategory
    applicability: 'required' | 'not_applicable' | 'uncertain'
    reasonCode: string
    sourceAnchorIds: string[]
    reviewerId?: string
  }>
  policyVersion: string
  baselineOperationId?: string
  baselineCoveragePolicyDigest?: Sha256
  coveragePolicyDigest: Sha256
  createdAt: ISODate
}

interface ScenarioCoverageReviewRecord {
  id: string
  projectId: string
  operationId: string
  round: number
  coveragePolicyIds: string[]
  coveragePolicyDigest: Sha256
  fullScenarioIds: string[]
  fullScenarioDigest: Sha256
  planningRiskProfileId: string
  riskProfileDigest: Sha256
  reviewerAgentId: string
  authorAgentIds: string[]
  independenceStatus: 'independent' | 'not_required' | 'violated'
  status: 'approved' | 'changes_requested' | 'blocked'
  findings: PlanningReviewRecord['findings']
  reviewerPromptVersion: string
  deterministicPolicyVersion: string
  reviewInputDigest: Sha256
  reviewDigest: Sha256
  createdAt: ISODate
}
```

`requirement_analysis` 只产出源文本明确支持、足够供 Decision precheck 判断 option 影响的 seed Scenario；不得在此声称七类覆盖完成。`risk_profile` stage 的版本化 Service 纯函数以冻结 Requirement/source hints/Decision precheck/seed Scenario/current SourcePolicyPrecheck 为唯一输入并计算 riskDerivationInputDigest，原子产出每个 required Acceptance 恰好一个 current CoveragePolicy 和一份 RiskProfile；若 successor 继承 RepositoryPolicyBaseline，则 baseline 已进入 SourcePolicyPrecheck digest，因此仓库 MUST 会在 Risk 前生效。RiskProfile.requiredScenarioCategories 必须恰好等于所有 per-Acceptance required category 的稳定并集，不允许反馈环。其中 happy_path 必须 required，其他 category 逐项冻结为 required/not_applicable/uncertain。

随后 `scenario_completion` 只根据冻结 CoveragePolicy 补全缺失 required Scenario，不能改 Requirement/Decision/policy；`scenario_coverage_review` 校验每个 required Acceptance 恰一 policy、七个 category 各有唯一 disposition、N/A reason/source/reviewer、uncertain=0、每个 required category 有 required Scenario 且 scenario body 完整。失败在当前 operation blocked；语义修复创建 successor，并强制保存 `coveragePolicyBaselineOperationId/digest`，Requirement Analysis 继承该 baseline 且 CoveragePolicy 不得删除/弱化 required category。只有 source/Decision 输入变化使 baseline stale 时才能重新推导 policy，并显式记录 stale reason。N/A 必须有稳定 reason 和依据，命中 risk/hint 却 N/A 时要求 reviewerId，uncertain 阻塞；每个 required category 至少有一个 required Scenario。`preconditions`、`trigger`、`expectedOutcomes` 和 `observableAt` 任一为空均返回 `acceptance-scenario-incomplete`。当 `observableAt.kind=event` 时，`eventObservables` 必须用全局唯一 `EVT-*` local key 逐项冻结 Scenario 中每个独立持久化记录、发出事件、消息或副作用信号及其 `present/absent` 预期；Dispatch、TaskRun 和 ActivityEvent 是不同事实，不能折叠。无 event 观察面时该数组必须为空。Scenario 不持久化可变 confirmation status；seed 是否可用由 current approved RequirementReview 派生，completion 是否可用由 current approved ScenarioCoverageReview 派生，测试文件名或命令本身不能替代业务结果。`category` 和 `eventObservables` 进入 scenario digest、Plan coverage、Gold 和 Convergence。V3.3 统一使用 `happy_path`；若读取早期设计 fixture 的 `good`，只在导入边界迁移为 `happy_path`，持久化不接受别名。

### 6.2.2 DecisionOptionEffect 与两阶段 PlanningEffect

Decision 的 `impact` 只是业务后果等级，不能单独作为规划门禁。Binding 前不存在可信的代码 owner、Capability 和 Assignment 事实，因此 V3.3 不在 Requirement Analysis 后一次性伪造完整影响链，而是先做来源级 precheck，再在 Binding Review 后完成终判：

```ts
type DecisionEffectDimension =
  | 'requirement' | 'scenario' | 'policy' | 'binding'
  | 'task_scope' | 'dependency' | 'verification'
  | 'capability' | 'assignment' | 'release'

interface RequirementDecisionOptionEffectRecord {
  id: string
  decisionId: string
  operationId: string
  optionKey: string
  affectedDimensions: DecisionEffectDimension[]
  affectedObjectKeys: string[]
  derivation: 'explicit' | 'inferred' | 'human_confirmed'
  evidenceAnchorIds: string[]
  potentiallyChangesDelivery: boolean
  optionEffectDigest: Sha256
  createdAt: ISODate
}

interface RequirementDecisionPlanningEffectRecord {
  id: string
  decisionId: string
  operationId: string
  phase: 'precheck' | 'final'
  decisionStatus: 'pending' | 'resolved' | 'deferred' | 'rejected'
  chosenOptionKey?: string
  decisionResolutionRevision: number
  decisionResolutionDigest: Sha256
  sourcePolicyPrecheckId: string
  sourcePolicyDigest: Sha256
  seedScenarioDigest: Sha256
  optionEffectIds: string[]
  affectedDimensions: DecisionEffectDimension[]
  affectedRequiredObjectIds: string[]
  blocksPlanning: boolean
  determination:
    | 'conservative_default'
    | 'evidence_confirmed'
    | 'human_confirmed_cosmetic'
  reason: string
  nonBlockingAudit?: { actor: string; reason: string; at: ISODate }
  policyVersion: string
  effectDigest: Sha256
  createdAt: ISODate
}
```

`source_policy_precheck` 在 Requirement Review 后从已分类 source anchor 冻结来源中的 MUST/SHOULD、authority、scope 和 unresolved 集合，并合并 operation 继承的 current RepositoryPolicyBaseline。`decision_effect_precheck` 只消费 source anchor、Requirement、`derivationPhase='seed'` Scenario、current SourcePolicyPrecheck 和 `RequirementDecisionOptionEffectRecord`，不直接读取尚未生成的 Repository/PlanningPolicySnapshot；继承的仓库规则只能通过 precheck 冻结输入进入。任一 option 可能改变 required delivery object，或 option/影响对象不完整时，pending Decision 必须按 `conservative_default` 将 operation 置为 `blocked/needs_decision`。Decision 解决后创建新 attempt/operation 并重算；effect 必须冻结 current `decisionStatus/chosenOptionKey/resolutionRevision/resolutionDigest`，不能只凭 decisionId 沿用旧选择。

Repository Snapshot 后生成的完整 `PlanningPolicySnapshot` 合并 SourcePolicyPrecheck 与仓库规则。它不得削弱 precheck；发现 baseline 尚未包含的 applicable MUST、authority 冲突或更强 scope 时，必须按 RepositoryPolicyBaseline 固定点协议终止当前 operation 并创建 successor，而不是让同一输入无限 stale。`decision_effect_finalization` 在 TaskPreflight 后、final commit 前运行，同时消费 current Binding Review、TaskProposal、CapabilityRequirementDraft、AssignmentDraft 和 Preflight，补全真实代码 owner、scope、dependency、verification、capability、assignment 和 release 影响。最终 candidate 必须同时引用 current precheck 与 final effect；任一阶段 blocking 都阻止 commit/approval。high/critical pending 默认阻塞。只有人工逐一确认全部 option 不改变本期任何 required delivery object 时，才能生成新的 `human_confirmed_cosmetic` final record，并保存 actor/reason/time；不得原地覆盖布尔值或删除旧 effect。两阶段 effect digest 都进入 PlanSnapshot、freshness 和 Approval gate。

### 6.2.3 PlanningRiskProfileRecord

Requirement Review approved 后，由确定性策略根据 Requirement、Scenario、Decision effect 和项目规则冻结风险档案：

```ts
interface PlanningRiskProfileRecord {
  id: string
  projectId: string
  operationId: string
  level: 'low' | 'medium' | 'high' | 'critical'
  dimensions: Array<
    'data' | 'state' | 'permission' | 'async' | 'api'
    | 'security' | 'performance' | 'migration' | 'release'
  >
  requiredEvidenceKinds: EvidenceKind[]
  requiredReviewKinds: Array<'requirement' | 'binding' | 'plan' | 'assignment' | 'convergence'>
  requiredScenarioCategories: AcceptanceScenarioCategory[]
  sourcePolicyPrecheckId: string
  sourcePolicyDigest: Sha256
  seedScenarioDigest: Sha256
  acceptanceScenarioCoveragePolicyIds: string[]
  acceptanceScenarioCoveragePolicyDigest: Sha256
  riskDerivationInputDigest: Sha256
  requiresIndependentReviewer: boolean
  requiresTaskPreflight: boolean
  requiresConvergence: boolean
  reasonSourceAnchorIds: string[]
  policyVersion: string
  riskProfileDigest: Sha256
  createdAt: ISODate
}
```

风险只允许增加 repository provider 深度、Scenario、Review、Preflight 和 Convergence 门禁。它不能降低 normative source completeness、required disposition、snapshot 引用、硬资格或 false-ready 约束。Profile 变化使 Binding、TaskProposal、CapabilityRequirementDraft、Plan Review、AssignmentDraft 和 TaskPreflight stale。

### 6.2.4 SourcePolicyPrecheck 与 PlanningPolicySnapshot

```ts
interface RepositoryPolicyConstraintSeedRecord {
  id: string
  projectId: string
  repositoryIdentityDigest: Sha256
  repositoryDigest: Sha256
  extractorVersion: string
  authority: 'project_agents' | 'project_readme' | 'tooling' | 'unknown'
  level: 'must' | 'should' | 'may'
  scope: PolicyConstraintRecord['scope']
  statement: string
  sourceEvidenceIds: string[]
  applicability: 'applicable' | 'not_applicable' | 'needs_confirmation'
  disposition: 'mapped' | 'approved_not_applicable' | 'unresolved'
  seedDigest: Sha256
  createdAt: ISODate
}

interface RepositoryPolicyBaselineRecord {
  id: string
  projectId: string
  createdByOperationId: string
  predecessorBaselineId?: string
  repositoryIdentityDigest: Sha256
  repositoryDigest: Sha256
  extractorVersion: string
  iteration: number
  constraintSeedIds: string[]
  constraintSeedSetDigest: Sha256
  baselineDigest: Sha256
  status: 'ready' | 'needs_confirmation' | 'blocked'
  createdAt: ISODate
}

interface SourcePolicyPrecheckRecord {
  id: string
  projectId: string
  operationId: string
  sourceManifestId: string
  sourceConstraintIds: string[]
  repositoryPolicyBaselineId?: string
  repositoryPolicyBaselineDigest?: Sha256
  inheritedRepositoryConstraintSeedIds: string[]
  unresolvedMustConstraintIds: string[]
  sourceManifestDigest: Sha256
  precheckInputDigest: Sha256
  policyVersion: string
  sourcePolicyDigest: Sha256
  status: 'ready' | 'needs_confirmation' | 'blocked'
  createdAt: ISODate
}

interface PlanningPolicySnapshotRecord {
  id: string
  projectId: string
  operationId: string
  repositorySnapshotId: string
  sourcePolicyPrecheckId: string
  sourcePolicyDigest: Sha256
  comparedRepositoryPolicyBaselineId?: string
  comparedRepositoryPolicyBaselineDigest?: Sha256
  sourceEvidenceIds: string[]
  constraintIds: string[]
  repositoryConstraintSeedSetDigest: Sha256
  repositoryPolicyDeltaSeedIds: string[]
  repositoryPolicyDeltaDigest: Sha256
  fixedPointStatus: 'converged' | 'delta_found'
  extractorVersion: string
  status: 'ready' | 'requires_replan' | 'needs_confirmation' | 'blocked' | 'stale'
  policyDigest: Sha256
  diagnostics: Diagnostic[]
  createdAt: ISODate
}

interface PolicyConstraintRecord {
  id: string
  policySnapshotId: string
  authority: 'system' | 'user' | 'project_agents' | 'project_readme' | 'tooling' | 'unknown'
  level: 'must' | 'should' | 'may'
  scope: {
    pathPrefixes: string[]
    taskKinds: TaskKind[]
    stages: Array<'planning' | 'execution' | 'verification' | 'delivery'>
  }
  statement: string
  sourceEvidenceIds: string[]
  applicability: 'applicable' | 'not_applicable' | 'needs_confirmation'
  disposition: 'mapped' | 'approved_not_applicable' | 'unresolved'
  mappedRequirementIds: string[]
  mappedScenarioIds: string[]
  reason?: string
  constraintDigest: Sha256
}

interface PolicyFulfillmentRecord {
  id: string
  projectId: string
  operationId: string
  policySnapshotId: string
  policyDigest: Sha256
  policyConstraintId: string
  planningReferenceMapId: string
  disposition: 'fulfilled' | 'approved_not_applicable'
  reservedTaskIds: string[]
  verificationCommandIds: string[]
  requirementIds: string[]
  scenarioIds: string[]
  evidenceIds: string[]
  approvalAudit?: { actor: string; reason: string; at: ISODate }
  fulfillmentDigest: Sha256
  createdAt: ISODate
}
```

首次 operation 的 SourcePolicyPrecheck 消费已完成 classification/disposition 的来源 Anchor，且 repository baseline 为空。完整 PlanningPolicySnapshot 在 Repository Snapshot 后规范化 AGENTS/README/tooling 规则，并把规范化 seed set 与输入 baseline 做集合比较：

- 没有 delta 时 `fixedPointStatus='converged'`，Policy 可以进入 Binding；
- 存在新增/加强的 applicable MUST 或 authority/scope 变化时，当前 PlanningPolicySnapshot 写 `status='requires_replan'`、`fixedPointStatus='delta_found'`，当前 operation terminal 为 `superseded`；同一 serialized/fencing 边界内把旧 baseline 与本轮完整 repository seed set 做单调并集，原子创建新的 immutable RepositoryPolicyBaseline 和唯一 successor operation；
- successor 的 SourcePolicyPrecheck 必须消费该 baseline，其 precheckInputDigest、Decision precheck 和 Risk derivation digest 都包含 baseline digest；
- 在相同 repository identity/digest、extractorVersion 和 seed set 下再次得到同一 baseline digest，必须判定 converged，禁止再次 stale；
- baseline 只能增加或加强 constraint，不能删除/弱化。若相同输入仍产生不同 seed set，或达到版本化 `maxRepositoryPolicyIterations` 后仍有 delta，operation 以 `repository-policy-nonconvergent` blocked，不继续自动创建 successor。

active `must` 的 authority、applicability 或 disposition 未确定时不能 ready。普通建议不能仅凭关键词升级为 `must`；`approved_not_applicable` 必须记录 actor/reason。PlanningPolicySnapshot 只冻结规则本身及其 Requirement/Scenario 映射，不保存尚未存在的 Task ID。`policy_fulfillment` 在 PlanningReferenceMap 后为每个 applicability 已决的 active MUST 写 exact-one PolicyFulfillmentRecord：`applicability='applicable'` 必须 `disposition='fulfilled'`，且 `reservedTaskIds/verificationCommandIds` 均非空；`applicability='not_applicable'` 必须由 PolicyConstraint 的 `approved_not_applicable` disposition 和必填 approvalAudit 闭合，Fulfillment 同为 `approved_not_applicable` 且两组执行映射必须为空。fulfilled 的 `reservedTaskIds` 必须来自同一 map，并在 final commit 物化为相同 Task ID。Fulfillment 集合按 `(policyConstraintId,fulfillmentDigest)` 排序形成 digest，进入 PlanSnapshot、Approval、Dispatch 和 Convergence。缺失、重复、分支字段不相容或跨 operation 引用均阻止 Plan Review；不得原地回写 PolicyConstraint。

### 6.3 RepositoryContextSnapshotRecord

```ts
type RepositorySnapshotStatus = 'building' | 'ready' | 'partial' | 'failed' | 'stale'

interface RepositoryContextSnapshotRecord {
  id: string
  projectId: string
  subject:
    | { kind: 'planning'; planningOperationId: string }
    | {
        kind: 'final_delivery'
        deliveryIntegrationSnapshotId: string
        exactCommit: string
      }
  canonicalRoot: string
  rootIdentityDigest: Sha256

  vcs: 'git' | 'none'
  baseCommit?: string
  branch?: string
  trackedTreeDigest: Sha256
  dirtyDigest: Sha256
  repositoryDigest: Sha256

  providerRuns: RepositoryProviderRun[]
  evidenceIds: string[]
  commandIds: string[]
  completeness: RepositoryCompleteness
  policyVersion: string
  exclusionPolicyVersion: string
  status: RepositorySnapshotStatus
  diagnostics: Diagnostic[]
  createdAt: ISODate
  completedAt?: ISODate
}

interface RepositoryProviderRun {
  providerId: string
  providerVersion: string
  status: 'ready' | 'partial' | 'unavailable' | 'failed' | 'stale'
  inputDigest: Sha256
  outputDigest?: Sha256
  evidenceCount: number
  durationMs: number
  diagnosticCodes: string[]
}
```

`canonicalRoot` 仅用于当前 workspace 访问，不进入可移植的业务 digest；`rootIdentityDigest` 由受控 workspace ID 和 root-relative identity 生成，避免泄漏用户目录。`subject.kind='final_delivery'` 时，`vcs` 必须为 `git`、`baseCommit === subject.exactCommit`、`dirtyDigest` 必须为空树 digest，且该 `exactCommit` 必须等于所引 `DeliveryIntegrationSnapshot.finalCommit`；这组字段进入 `repositoryDigest`。规划快照只能使用 `subject.kind='planning'`，final snapshot 不挂靠已结束的 PlanningOperation。

### 6.3.1 RepositoryStackProfileRecord

```ts
interface RepositoryStackProfileRecord {
  id: string
  projectId: string
  operationId: string
  repositorySnapshotId: string
  languages: Array<{ id: string; evidenceIds: string[] }>
  frameworks: Array<{ id: string; evidenceIds: string[] }>
  dataLayers: Array<{ id: string; evidenceIds: string[] }>
  requiredSemanticCapabilities: Array<
    'symbols' | 'routes' | 'schema' | 'relationships' | 'consumers' | 'tests' | 'commands'
  >
  providerCoverage: Array<{
    capability: string
    providerId?: string
    status: 'covered' | 'partial' | 'missing'
    reason?: string
  }>
  supportStatus: 'supported' | 'partial' | 'unsupported'
  supportPolicyVersion: string
  stackProfileDigest: Sha256
  diagnostics: Diagnostic[]
  createdAt: ISODate
}
```

首个 candidate release 只对 TypeScript + Nuxt/Vue + Prisma 组合及其已声明子集承诺 `supported`。Java、Python 或其他缺少适用 semantic provider 的仓库必须 `unsupported`；filesystem/manifest inventory 只能用于诊断，不能产生 ready Binding。

### 6.3.2 CanonicalTargetBindingRecord

```ts
interface CanonicalTargetBindingRecord {
  id: string
  projectId: string
  operationId: string
  resourceId: string
  repositoryIdentityDigest: Sha256
  rootIdentityDigest: Sha256
  vcs: 'git'
  targetRef: string
  planningBaseCommit: string
  integrationPrincipalId: string
  integrationGrantId: string
  bindingVersion: number
  bindingDigest: Sha256
  createdBy: string
  createdAt: ISODate
  supersedesId?: string
}
```

Repository Snapshot 完成后、Policy/Code Binding 前必须冻结唯一 CanonicalTargetBinding。`targetRef` 必须是显式 local branch ref，禁止 `HEAD`、tag、detached commit、remote-tracking ref 和 worktree-private ref；resource/repository/root identity 与规划快照必须一致。Task/Assignment/TaskRun 只能使用该 repository identity 派生的 worktree，只有持有 `canonical_integrate` grant 的 Integration Service principal 能更新 target ref。binding 变化使 Policy、Binding 和全部下游事实 stale，并要求新 plan revision/approval；Integration start 另行冻结 `expectedTargetHead`，不修改 binding。

### 6.4 RepositoryEvidenceNodeRecord

```ts
type EvidenceKind =
  | 'policy'
  | 'manifest'
  | 'file'
  | 'symbol'
  | 'route'
  | 'schema'
  | 'state_transition'
  | 'consumer'
  | 'test'
  | 'command'
  | 'graph_edge'

type EvidenceProvenance = 'extracted' | 'inferred' | 'ambiguous'

interface RepositoryEvidenceNodeRecord {
  id: string
  snapshotId: string
  providerId: string
  providerVersion: string
  kind: EvidenceKind
  provenance: EvidenceProvenance

  path: string
  language?: string
  symbol?: string
  range?: { startLine: number; endLine: number }
  relation?: string
  targetEvidenceIds: string[]

  title: string
  excerpt?: string
  contentDigest: Sha256
  fileDigest: Sha256
  confidence: 'high' | 'medium' | 'low'
  tags: string[]
  sensitivity: 'normal' | 'restricted' | 'redacted'
  createdAt: ISODate
}
```

不变量：

- `path` 必须是 canonical root 下的 POSIX 相对路径，不能包含 `..`；
- range 必须落在快照时的 fileDigest 对应内容内；
- `extracted` 表示 parser 或文件事实直接得到；`inferred` 必须带依据 edge；`ambiguous` 不得单独支撑 critical ready binding；
- excerpt 有严格长度上限，并经过 secret redaction；
- Evidence ID 由 snapshot、provider、kind、path、symbol/range 和 contentDigest 稳定生成；
- 文件变化后旧 evidence 保留，但所属 snapshot 标记 stale，不原地改写。

### 6.4.1 EvidenceClaimRecord

Evidence access 只证明模型读取过节点；Binding 中的 owner、source of truth、路径和边界结论必须独立持久化：

```ts
interface EvidenceClaimRecord {
  id: string
  projectId: string
  operationId: string
  repositorySnapshotId: string
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
  stageAttemptId: string
  claimDigest: Sha256
  createdAt: ISODate
}
```

supporting/contradicting Evidence 必须属于当前 snapshot，并出现在同一 `code_binding` attempt 的 `read` access 集合。critical claim 无支持证据、存在未解决反证、低置信或 `disputed/rejected` 时不能形成 ready Binding。Repository digest 或 claim reviewer status 变化使引用它的 Binding 和 TaskProposal stale。

### 6.5 VerificationCommandRecord

```ts
type CommandTrust = 'declared' | 'probe_passed' | 'baseline_passed'

interface VerificationCommandRecord {
  id: string
  snapshotId: string
  cwd: string
  argv: string[]
  sourceEvidenceIds: string[]
  trust: CommandTrust
  timeoutMs: number
  probe?: CommandProbeResult
  baseline?: CommandBaselineResult
  commandDigest: Sha256
}
```

三个状态不可互换：

- `declared`：由 package manifest、项目规则或受控配置声明；
- `probe_passed`：仅验证命令可解析、目标存在或列举成功，不代表测试通过；
- `baseline_passed`：在冻结 snapshot 上实际执行成功，记录 exit code、时长和截断输出 digest。

Planner 只能引用 PlanningPromptReferenceManifest 注入的 Command ref；Service 解析后在 Proposal 中保存 Command ID。Service 根据风险、成本和环境选择是否 probe/baseline；未执行不能写成 passed。

### 6.6 RequirementCodeBindingRecord

```ts
type ChangeIntent = 'existing' | 'modify' | 'new' | 'remove' | 'unknown'
type ImpactDimension =
  | 'domain_owner'
  | 'write_path'
  | 'read_path'
  | 'data'
  | 'state'
  | 'api'
  | 'permission'
  | 'async'
  | 'consumer'
  | 'failure'
  | 'test'
  | 'migration'
  | 'release'
  | 'rollback'

interface RequirementCodeBindingRecord {
  id: string
  key: string
  projectId: string
  operationId: string
  requirementId: string
  acceptanceIds: string[]
  scenarioIds: string[]
  decisionIds: string[]
  policyConstraintIds: string[]
  planningRiskProfileId: string
  evidenceClaimIds: string[]

  changeIntent: ChangeIntent
  impactDimensions: Array<{
    dimension: ImpactDimension
    applicability: 'required' | 'not_applicable' | 'unknown'
    evidenceIds: string[]
    reason: string
  }>
  primaryOwnerEvidenceIds: string[]
  supportingEvidenceIds: string[]
  currentBehavior: string
  targetBehavior: string
  assumptions: string[]
  openQuestions: string[]
  eventFactChains: Array<{
    factKey: string
    eventObservableKey: `EVT-${string}`
    scenarioKeys: string[]
    eventTypes: string[]
    recordOwnerSymbols: string[]
    persistedCollectionOwnerSymbols: string[]
    readSurfaceOwnerSymbols: string[]
    producerOwnerSymbols: string[]
    fixtureEvidenceIds: string[]
    assertionEvidenceIds: string[]
    correlation: string
    assertsAbsence: boolean
  }>

  completeness: 'complete' | 'partial' | 'blocked'
  bindingDigest: Sha256
  repositoryDigest: Sha256
  requirementDigest: Sha256
  acceptanceScenarioDigest: Sha256
  acceptanceScenarioCoveragePolicyDigest: Sha256
  policyDigest: Sha256
  riskProfileDigest: Sha256
  evidenceClaimDigest: Sha256
  promptVersion: string
  createdAt: ISODate
}
```

`new` 不等于不需要 evidence。它至少需要落点 owner、邻近模式、consumer 和验证基础的 evidence；没有可信落点时必须 `unknown/blocked`。

### 6.7 ReviewRecord

Requirement、Binding 和 Plan Review 使用通用 PlanningReviewRecord；Scenario Coverage 使用专用 ScenarioCoverageReviewRecord，但复用同一 finding/repair 语义，避免 policy/scenario/risk 输入出现第二份真相：

```ts
interface PlanningReviewRecord {
  id: string
  projectId: string
  operationId: string
  kind: 'requirement' | 'binding' | 'plan'
  round: number
  reviewerAgentId: string
  authorAgentIds: string[]
  independenceStatus: 'independent' | 'not_required' | 'violated'
  subjectDigest: Sha256
  sourceManifestDigest: Sha256
  repositoryDigest?: Sha256
  requirementDigest: Sha256
  status: 'approved' | 'changes_requested' | 'blocked'
  findings: Array<{
    code: string
    severity: 'info' | 'warning' | 'error' | 'blocking'
    subjectType: 'requirement' | 'acceptance' | 'scenario' | 'scenario_coverage_policy' | 'decision' | 'policy' | 'binding' | 'work_package' | 'task' | 'dependency' | 'capability_requirement' | 'assignment'
    subjectId: string
    evidenceIds: string[]
    message: string
    repairOwner: 'requirement' | 'risk' | 'scenario' | 'policy' | 'repository' | 'binding' | 'plan' | 'capability' | 'team' | 'human_decision'
    restartStage: PlanningOperationStage
    requiredUserAction?: 'resolve_decision' | 'confirm_policy' | 'confirm_binding' | 'confirm_capability' | 'repair_source'
  }>
  reviewerPromptVersion: string
  deterministicPolicyVersion: string
  capabilityRequirementDigest?: Sha256
  reviewDigest: Sha256
  createdAt: ISODate
}
```

Review 不能直接覆盖 subject。Repair 由不可变 lineage 表达：

```ts
interface PlanningRepairAttemptRecord {
  id: string
  operationId: string
  successorOperationId?: string
  reviewKind: 'requirement' | 'scenario_coverage' | 'binding' | 'plan'
  sourceReviewId: string
  sourceReviewDigest: Sha256
  sourceFindingIds: string[]
  repairOwner: PlanningReviewRecord['findings'][number]['repairOwner']
  restartStage: PlanningOperationStage
  inputSubjectRevision: number
  outputSubjectRevision?: number
  status: 'requested' | 'repairing' | 'revalidated' | 'resolved' | 'blocked' | 'failed' | 'superseded'
  deterministicValidationDigest?: Sha256
  resultReviewId?: string
  attempt: number
  maxAttempts: number
  repairPolicyVersion: string
  repairDigest: Sha256
}
```

`repairOwner` 只表达事实 owner 和用户动作，不能参与状态机比较；`restartStage` 必须逐字使用 canonical `PlanningOperationStage`。仅当 `restartStage` 等于当前 stage、且不会改写任何已完成上游 digest 时，才允许同 operation 追加 stage-local attempt/review round。若 finding 指向已完成的 Requirement/Policy/Repository/Binding/Capability/Team 或其他上游 subject，当前 operation 必须 terminal `blocked|superseded`，并通过 `successorOperationId` 新建 operation，从所有 finding 的 canonical stage ordinal 最小值开始。`human_decision` 仍必须给出实际 `restartStage`，通常为 `decision_effect_precheck`，并以 `requiredUserAction='resolve_decision'` 表达暂停原因，不能伪造不存在的 stage。Scenario coverage repair 还必须冻结 predecessor 的 coveragePolicyBaselineOperationId/digest 并继承不可弱化的 category dispositions；新 operation 只能从 restartStage 向前运行，不能把 stage 指针倒退。相同 finding-set digest + policy 幂等；同一 finding 只能属于一个 current repair chain。

`resolved` 要求新 immutable subject revision、确定性校验通过、后续 Review 无 blocking descendant finding。no-op digest、循环、或达到 max attempts 后同 fingerprint 再现都收敛为 `blocked`；provider/system `failed` 默认不消耗语义预算。`independenceStatus='violated'` 不能 approved；PlanningOperation/PlanSnapshot 保存 Requirement/ScenarioCoverage/Binding/Plan 四类 current review ID/digest，上游变化使 Review stale。

### 6.8 WorkPackage Proposal 与正式 Record

```ts
interface WorkPackageProposalRecord {
  id: string
  projectId: string
  operationId: string
  reservedWorkPackageId: string
  key: string
  title: string
  businessOutcome: string
  requirementKeys: string[]
  acceptanceKeys: string[]
  scenarioKeys: string[]
  decisionKeys: string[]
  policyConstraintIds: string[]
  bindingKeys: string[]
  evidenceClaimIds: string[]
  impactDimensions: ImpactDimension[]
  risk: 'low' | 'medium' | 'high' | 'critical'
  expansion: 'single_task' | 'multi_task'
  expansionReasons: string[]
  dependencyKeys: string[]
  proposalDigest: Sha256
  createdAt: ISODate
}

interface WorkPackageRecord {
  id: string
  projectId: string
  operationId: string
  key: string
  title: string
  businessOutcome: string
  requirementIds: string[]
  acceptanceIds: string[]
  scenarioIds: string[]
  decisionIds: string[]
  policyConstraintIds: string[]
  bindingIds: string[]
  evidenceIds: string[]
  impactDimensions: ImpactDimension[]
  risk: 'low' | 'medium' | 'high' | 'critical'
  expansion: 'single_task' | 'multi_task'
  expansionReasons: string[]
  dependencyWorkPackageIds: string[]
  workPackageDigest: Sha256
}
```

WorkPackage 是规划粒度对象，不直接执行。commit 前它以 `WorkPackageProposalRecord` 保存并使用 operation-local `dependencyKeys`；final commit 必须通过 PlanningReferenceMap 将它们解析为稳定的 `dependencyWorkPackageIds`，再按预留 ID 物化正式 `WorkPackageRecord`。它防止“每条 Acceptance 一个碎任务”和“全部需求只有两个大任务”两个极端。

### 6.8.1 TaskProposal、TaskContextPack 与 PlanningProposalPack

```ts
type TaskRelationship = 'implementation' | 'verification' | 'review' | 'migration' | 'release'

interface TaskProposalRecord {
  id: string
  projectId: string
  operationId: string
  reservedTaskId: string
  key: string
  workPackageKey: string
  title: string
  kind: TaskKind
  relationship: TaskRelationship
  description: string
  requirementKeys: string[]
  acceptanceKeys: string[]
  scenarioKeys: string[]
  decisionKeys: string[]
  policyConstraintIds: string[]
  bindingKeys: string[]
  evidenceClaimIds: string[]
  dependencyKeys: string[]
  verificationCommandIds: string[]
  completionCriteria: string[]
  risk: Risk
  generatedChangeContract: GeneratedChangeContract
  contextPackId: string
  taskProposalDigest: Sha256
  createdAt: ISODate
}

interface TaskContextPackRecord {
  id: string
  operationId: string
  taskProposalId: string
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
  contextPackDigest: Sha256
  createdAt: ISODate
}

interface PlanningProposalPackRecord {
  id: string
  projectId: string
  operationId: string
  plannerStageAttemptId: string
  promptReferenceManifestId: string
  promptReferenceManifestDigest: Sha256
  workPackageProposalIds: string[]
  taskProposalIds: string[]
  taskContextPackIds: string[]
  requirementDigest: Sha256
  riskProfileDigest: Sha256
  repositoryDigest: Sha256
  bindingDigest: Sha256
  policyDigest: Sha256
  proposalDigest: Sha256
  status: 'candidate' | 'reviewed' | 'blocked' | 'superseded'
  createdAt: ISODate
}
```

TaskProposal 本身保存 Planner Schema 中的 local key、关系、引用、completion criteria、verification 和 change contract；TaskContextPack 保存最终候选接手所需的完整上下文。两者都不可执行、不可 dispatch。任一 blocking unknown、空 starting point、缺 expected artifact、无法观察的 verification 或 digest stale 都阻止 Plan Review approved。

### 6.8.2 PlanningPromptReferenceManifestRecord

Planner 不直接接触数据库 ID。Service 在每次 `task_plan` attempt 前为允许模型引用的冻结事实生成不可变、仅在该 attempt 有效的 opaque ref：

```ts
type PlanningPromptReferenceKind =
  | 'policy_constraint' | 'evidence_claim' | 'repository_evidence'
  | 'verification_command' | 'binding_surface'

interface PlanningPromptReferenceManifestRecord {
  id: string
  projectId: string
  operationId: string
  stageAttemptId: string
  references: Array<{
    ref: string
    kind: PlanningPromptReferenceKind
    artifactId: string
    artifactDigest: Sha256
  }>
  allowedRefSetDigest: Sha256
  manifestDigest: Sha256
  createdAt: ISODate
}
```

`ref` 是不可猜测语义、无数据库含义的 attempt-scoped token，例如 `ref-pc-001`；同一 attempt 内唯一，不能跨 operation/stage attempt 重放。模型输出只允许这些 ref 和本轮 Requirement/Scenario/Binding/Task local key。Service 在写 Proposal 前按 manifest exact resolve 为内部 ID；missing/duplicate/kind mismatch/未注入 ref 返回 `planner-reference-invalid`。PromptReferenceManifest 证明“模型可引用什么”，PlanningEvidenceAccessRecord 继续证明“模型实际读取了什么”，二者不能互相替代。

### 6.8.3 PlanningReferenceMapRecord

模型为新交付对象输出 local key，持久化对象使用数据库 ID。两者通过本轮唯一、不可变的引用表连接；已冻结事实的 prompt ref 则在 Proposal 写入前通过 PlanningPromptReferenceManifest 解析。禁止把两类映射混用，也禁止在最终提交后再回写 Task 以补齐 PlanSnapshot 或依赖关系：

```ts
interface PlanningReferenceMapRecord {
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
  mapDigest: Sha256
  createdAt: ISODate
}
```

Reserve 时生成 `reservedPlanSnapshotId/reservedPlanRevision`；proposal 通过引用、覆盖和 DAG 校验后一次性预分配 WorkPackage/Task/CapabilityRequirement/AssignmentDecision ID。预留 ID 只是跨 draft 的稳定引用地址，不表示正式记录已存在。CapabilityRequirementDraft、AssignmentDraft 和 TaskPreflight 引用预留 Task ID；blocked operation 只保留 proposal/draft/map/diagnostics，不产生 WorkPackage、DeliveryTask、正式 CapabilityRequirement 或 AssignmentDecision。恢复只能清理或 tombstone 本 operation 独占且未被引用的 proposal/draft；无法证明 ownership 时保留 orphan diagnostic。

### 6.9 TaskRecord V3 扩展

现有 `TaskRecord` 改为兼容联合类型：legacy/V2 分支接受现有缺省或 `2`，V3 分支强制 `3` 及其必填字段。V3 增加：

```ts
interface TaskV3Fields {
  planningContractVersion: 3
  planSnapshotId: string
  workPackageId: string
  referenceMapId: string
  bindingIds: string[]
  scenarioIds: string[]
  policyConstraintIds: string[]
  evidenceIds: string[]
  commandEvidenceIds: string[]
  relationship: TaskRelationship
  taskRevision: number
  capabilityRequirementId: string
  assignmentDecisionId: string
  risk: 'low' | 'medium' | 'high' | 'critical'
  taskContextPackId: string
  taskContextPackDigest: Sha256
  taskPreflightId: string
  taskPreflightDigest: Sha256

  changeContract: {
    allowedPathScopes: string[]
    excludedPathScopes: string[]
    requiredImpactDimensions: ImpactDimension[]
    conflictKeys: string[]
    expectedArtifacts: string[]
    outOfScopePolicy: 'fail' | 'review'
  }
}
```

V3 Task 由最终 commit 一次写入，`planSnapshotId`、依赖 Task ID、CapabilityRequirement ID 和 AssignmentDecision ID 都来自同一 `PlanningReferenceMapRecord`。不得先创建没有 PlanSnapshot 的 Task，再在 PlanSnapshot 创建后批量 rewrite。V3 Task 必须继续使用现有 `sourceRequirementIds`、`acceptanceIds`、`decisionIds`、`requiredRoles`、`requiredCapabilities`、`testCommand` 和 DAG 字段，不能用 V3 扩展替代 V2 已正确建立的引用。其中 V3 的 `requiredRoles`、`requiredCapabilities` 只是 Service materialize `CapabilityRequirementRecord` 后写入的兼容投影，不属于 Planner 输出，也不能成为另一份 source of truth。

### 6.9.1 CapabilityDefinition、Claim、Catalog 与 Requirement

```ts
interface CapabilityDefinitionRecord {
  id: string
  version: number
  key: string
  displayName: string
  description: string
  parentCapabilityIds: string[]
  compatibleRoleIds: string[]
  status: 'active' | 'deprecated'
  definitionDigest: Sha256
}

interface AgentCapabilityClaimRecord {
  id: string
  agentId: string
  capabilityId: string
  capabilityVersion: number
  source: 'human_confirmed' | 'managed_registry' | 'legacy_pending_mapping'
  status: 'active' | 'pending' | 'revoked' | 'expired'
  confirmedBy?: string
  evidenceRef?: string
  validFrom: ISODate
  validUntil?: ISODate
  claimDigest: Sha256
}

interface ProjectCapabilityCatalogSnapshotRecord {
  id: string
  projectId: string
  operationId: string
  definitionVersions: Array<{ capabilityId: string; version: number }>
  activeClaimIds: string[]
  pendingMappingClaimIds: string[]
  projectMembershipDigest: Sha256
  catalogPolicyVersion: string
  capabilityCatalogDigest: Sha256
  createdAt: ISODate
}

interface CapabilityRequirementDraftRecord {
  id: string
  projectId: string
  operationId: string
  reservedTaskId: string
  taskProposalId: string
  planningRiskProfileId: string
  taskRelationship: TaskRelationship
  relationshipRuleVersion: string
  requiredRoleIds: string[]
  requiredCapabilities: Array<{
    capabilityId: string
    definitionVersion: number
  }>
  bindingIds: string[]
  evidenceIds: string[]
  derivations: Array<{
    requirementType: 'role' | 'capability'
    requirementId: string
    ruleId: string
    reason: string
  }>
  derivationPolicyVersion: string
  capabilityRequirementDigest: Sha256
  createdAt: ISODate
}

interface CapabilityRequirementRecord extends Omit<CapabilityRequirementDraftRecord,
  'reservedTaskId' | 'taskProposalId'> {
  taskId: string
  taskRevision: number
  sourceDraftId: string
}
```

只有 `human_confirmed` 或 `managed_registry` 且 `active` 的 claim 参与硬资格。legacy 自由字符串仅生成 `legacy_pending_mapping`，即使名称与 definition 完全相同也不能自动通过。Service 在 Planner 输出通过引用/DAG 校验后，根据 Binding、PlanningRiskProfile、impact dimension、Task relationship 和版本化规则生成 CapabilityRequirementDraft；无法确定关键映射时返回 `capability-mapping-unresolved`。Plan Review 检查 draft grounding；final commit 才从 approved draft 物化正式 CapabilityRequirementRecord。

### 6.9.2 AgentProjectAffinityClaim 与 AssignmentAffinitySnapshot

“有资格”不等于“最适合”。领域亲和、代码 owner 连续性和交付历史必须来自受控事实，不能由 Planner、Persona 或 Agent 自报：

```ts
interface AgentProjectAffinityClaimRecord {
  id: string
  projectId: string
  agentId: string
  repositoryIdentityDigest: Sha256
  boundedContext: string
  pathPrefixes: string[]
  capabilityIds: string[]
  proficiency: 'primary' | 'secondary' | 'familiar'
  provenance: 'human_confirmed' | 'managed_registry' | 'verified_delivery_history' | 'codeowners'
  sourceRecordIds: string[]
  status: 'active' | 'expired' | 'revoked'
  validUntil?: ISODate
  claimDigest: Sha256
}

interface AssignmentAffinitySnapshotRecord {
  id: string
  projectId: string
  operationId: string
  repositoryIdentityDigest: Sha256
  claimIds: string[]
  verifiedDeliveryHistoryIds: string[]
  policyVersion: string
  snapshotDigest: Sha256
}
```

Assignment 的每个 score contribution 必须记录 `feature`、`value`、`weight` 和 `sourceRecordIds`。缺少事实时该 feature 为中性值；不得用零值伪装负面证据，也不得用自然语言历史输出替代 source record。高/critical Task 存在多个同分 eligible owner 且没有可信 differentiator 时返回 `assignment-owner-ambiguous`，不能靠稳定 ID 随机选人；低风险任务才允许显式标记 `low_confidence_tie_break` 后继续。

### 6.9.3 Agent/Resource Access Grant

```ts
type ResourceAccessPrincipal =
  | { principalType: 'agent'; principalId: string }
  | { principalType: 'integration_service'; principalId: string }

interface ResourceAccessGrantRecord {
  id: string
  projectId: string
  principal: ResourceAccessPrincipal
  resourceId: string
  repositoryIdentityDigest: Sha256
  permissions: Array<
    'evidence_read' | 'repository_read' | 'worktree_write'
    | 'command_execute' | 'artifact_write' | 'canonical_integrate'
  >
  pathScopes: string[]
  commandIds: string[]
  grantedBy: string
  grantSource: 'project_membership' | 'resource_binding' | 'manual'
  validFrom: ISODate
  expiresAt?: ISODate
  reason: string
  grantDigest: Sha256
}

interface ResourceAccessGrantRevocationRecord {
  id: string
  projectId: string
  grantId: string
  revokedBy: string
  revokedAt: ISODate
  reason: string
  idempotencyKey: string
  requestDigest: Sha256
  revocationDigest: Sha256
}

interface ProjectAccessGrantSnapshotRecord {
  id: string
  projectId: string
  operationId: string
  grantIds: string[]
  resourceDigest: Sha256
  teamDigest: Sha256
  snapshotDigest: Sha256
  createdAt: ISODate
}
```

`principalType='agent'` 的 grant 不得包含 `canonical_integrate`；`principalType='integration_service'` 只能授予 CanonicalTargetBinding 指定 principal，且至少包含 `canonical_integrate`，不得用于 TaskRun owner/候选。CanonicalTargetBinding.integrationGrantId 必须解析到同 resource/repository identity、current 且 principalId 相等的 service grant。path scope 必须是 canonical root-relative prefix，禁止 absolute path、wildcard/symlink escape。Assignment 需要 Agent current `evidence_read + repository_read`；TaskRun claim 还需要 `worktree_write + command_execute` 及所需 command IDs。Grant 的 current 状态由 `validFrom/expiresAt` 与是否存在 RevocationRecord 派生；Snapshot 只收入在 snapshot time 有效且未撤销的 grant。Grant snapshot ID/digest 进入 AssignmentDraft、TaskPreflight、PlanSnapshot、Approval、TaskRun 和 Integration；撤销使未启动 dispatch stale，并在 active run 下一次 tool/settle 边界 fence。

### 6.10 AssignmentDraft、TaskPreflight 与 AssignmentDecision

```ts
type StructuralEligibility = 'eligible' | 'ineligible'
type DispatchStatus =
  | 'dispatchable'
  | 'waiting_runtime'
  | 'waiting_capacity'
  | 'waiting_conflict'
  | 'blocked_runtime'
  | 'blocked_access'

interface AssignmentDraftRecord {
  id: string
  projectId: string
  operationId: string
  reservedTaskId: string
  taskProposalId: string
  capabilityRequirementDraftId: string
  teamDigest: Sha256
  capabilityCatalogDigest: Sha256
  capabilityRequirementDigest: Sha256
  accessGrantSnapshotId: string
  accessGrantSnapshotDigest: Sha256
  canonicalTargetBindingId: string
  canonicalTargetBindingDigest: Sha256
  policyVersion: string

  candidates: Array<{
    targetType: 'agent' | 'squad'
    targetId: string
    structuralEligibility: StructuralEligibility
    hardGateReasons: string[]
    qualifyingClaimIds: string[]
    score?: number
    scoreReasons: string[]
    scoreContributions: Array<{
      feature: string
      value: number
      weight: number
      sourceRecordIds: string[]
    }>
    dispatchStatus?: DispatchStatus
    dispatchReasons: string[]
  }>
  selectedTargetType?: 'agent' | 'squad'
  selectedTargetId?: string
  executingAgentId?: string
  routingSquadId?: string
  dispatchStatus?: DispatchStatus
  override?: {
    actor: string
    reason: string
    risk: string
  }
  affinitySnapshotId: string
  confidence: 'high' | 'medium' | 'low'
  ambiguityCode?: 'assignment-owner-ambiguous'
  assignmentDraftDigest: Sha256
  createdAt: ISODate
}

type TaskPreflightVerdict = 'accepted' | 'needs_clarification' | 'rejected'

type TaskPreflightCheckCode =
  | 'agent_matches_assignment' | 'identity_auditable'
  | 'structurally_eligible' | 'access_current' | 'context_current'
  | 'evidence_read' | 'objective_restated' | 'starting_point_covered'
  | 'allowed_scope_covered' | 'forbidden_scope_acknowledged'
  | 'verification_covered' | 'escalation_covered' | 'no_blocking_unknowns'

type TaskPreflightFailureDisposition = 'clarify_upstream' | 'reject_candidate'

interface TaskPreflightRecord {
  id: string
  projectId: string
  operationId: string
  reservedTaskId: string
  taskProposalId: string
  taskContextPackId: string
  taskContextPackDigest: Sha256
  assignmentDraftId: string
  assignmentDraftDigest: Sha256
  capabilityRequirementDigest: Sha256
  repositoryDigest: Sha256
  accessGrantSnapshotId: string
  accessGrantSnapshotDigest: Sha256
  agentId: string
  agentSessionId: string
  agentConfigDigest: Sha256
  stageAttemptId: string
  agentReportedStatus: TaskPreflightVerdict
  serviceVerdict: TaskPreflightVerdict
  acceptanceChecks: Array<{
    code: TaskPreflightCheckCode
    status: 'pass' | 'fail'
    failureDisposition?: TaskPreflightFailureDisposition
    restartStage?: PlanningOperationStage
    subjectIds: string[]
    evidenceIds: string[]
  }>
  acceptancePolicyVersion: string
  verdictInputDigest: Sha256
  understoodObjective: string
  startingEvidenceIds: string[]
  expectedChangeSurfaces: string[]
  plannedVerificationIds: string[]
  missingFacts: string[]
  missingFactCodes: string[]
  estimatedComplexity: 'small' | 'medium' | 'large'
  escalationReason?: string
  evidenceAccessDigest: Sha256
  preflightDigest: Sha256
  createdAt: ISODate
}

interface ExpectedAssignmentFixtureRecord {
  id: string
  projectId: string
  responsibilityKey: string
  repositoryDigest: Sha256
  teamDigest: Sha256
  metricPolicyId: string
  metricPolicyVersion: string
  metricPolicyDigest: Sha256
  expectedOutcome: 'selected' | 'abstained'
  allowedOwnerIds: string[]
  allowedSquadMemberIds: string[]
  expectedAbstentionReasonCodes: string[]
  critical: boolean
  rationaleEvidenceIds: string[]
  fixtureDigest: Sha256
  createdAt: ISODate
}

interface AssignmentEvaluationRecord {
  id: string
  projectId: string
  operationId: string
  taskProposalId: string
  evaluationCohort: 'production' | 'gold'
  risk: Risk
  assignmentDraftId: string
  assignmentDraftDigest: Sha256
  eligibleAgentIds: string[]
  selectedTargetType?: 'agent' | 'squad'
  selectedTargetId?: string
  executingAgentId?: string
  routingSquadId?: string
  outcome:
    | 'selected' | 'abstained_no_eligible' | 'abstained_ambiguous'
    | 'abstained_access' | 'abstained_runtime_incompatible'
  reasonCodes: string[]
  reasonSourceRecordIds: string[]
  goldFixtureId?: string
  goldFixtureDigest?: Sha256
  goldResponsibilityKey?: string
  goldExpectedOutcome?: 'selected' | 'abstained'
  goldCritical?: boolean
  goldAllowedOwnerIds?: string[]
  goldAllowedSquadMemberIds?: string[]
  goldExpectedAbstentionReasonCodes?: string[]
  metricPolicyId: string
  metricPolicyVersion: string
  metricPolicyDigest: Sha256
  evaluationDigest: Sha256
  createdAt: ISODate
}

interface AssignmentDecisionRecord extends Omit<AssignmentDraftRecord,
  | 'reservedTaskId' | 'taskProposalId' | 'capabilityRequirementDraftId'
  | 'assignmentDraftDigest' | 'selectedTargetType' | 'selectedTargetId'
  | 'executingAgentId' | 'routingSquadId'> {
  taskId: string
  taskRevision: number
  capabilityRequirementId: string
  selectedTargetType: 'agent' | 'squad'
  selectedTargetId: string
  executingAgentId: string
  routingSquadId?: string
  sourceDraftId: string
  taskPreflightId: string
  taskPreflightDigest: Sha256
  assignmentDigest: Sha256
}

interface SquadCoordinationRecord {
  id: string
  projectId: string
  taskId: string
  taskRevision: number
  assignmentDecisionId: string
  squadId: string
  leaderAgentId: string
  requestedExecutingAgentId: string
  status: 'requested' | 'accepted' | 'reassigned' | 'cancelled' | 'expired'
  parentCoordinationId?: string
  decisionActorId?: string
  reason?: string
  createdAt: ISODate
  decidedAt?: ISODate
  coordinationDigest: Sha256
}
```

每个 executable TaskProposal 必须恰有一条 terminal AssignmentEvaluationRecord，包含全部 eligible/abstention reason 的稳定证据，并引用被评测的 current AssignmentDraft ID/digest。`outcome='selected'` 时四个 selection 字段按路由语义闭合：直接 Agent 路由要求 `selectedTargetType='agent'` 且 `selectedTargetId=executingAgentId`、`routingSquadId` 为空；Squad 路由要求 `selectedTargetType='squad'`、`routingSquadId=selectedTargetId` 且 `executingAgentId` 是该 Squad current active、独立 hard-eligible member。abstained outcome 时 selection 字段全部为空。final commit 强制 Evaluation、AssignmentDraft 与 AssignmentDecision 的 selected target/routing/executing 字段及 draft digest 完全相等。

`evaluationCohort='gold'` 时 fixture ID/digest 及拷贝真值字段全部必填，并必须解析到同 project/repository/team/MetricPolicy ID-version-digest 的 immutable ExpectedAssignmentFixtureRecord；production 时这些字段全部为空。fixture registry 对 `(projectId,repositoryDigest,teamDigest,metricPolicyId,responsibilityKey)` 唯一，评测开始后不可覆盖，只能发布新 fixture/policy version；outcome 非 `selected` 时不得物化 AssignmentDecision 或 DeliveryTask。Runtime offline/capacity waiting 已有合格 owner，不属于 abstention。该全量分母防止系统只对容易样本报告 owner accuracy，且 Squad 指标不会把 routing target 或 leader 误当成实际执行 owner。

容量为零不再把结构合格候选变成 `ineligible`。没有结构合格候选是 `assignment_no_eligible_candidate`；已有选中 owner 但暂时无容量是 `waiting_capacity`。`waiting_capacity` 和可恢复 `waiting_runtime` 可在 TaskPreflight `serviceVerdict='accepted'` 且两阶段 Decision effect 通过后批准计划，但不可 dispatch；`blocked_runtime`、`blocked_access`、无 eligible candidate 和 high/critical owner ambiguity 不可进入 Preflight 或审批。Draft 允许在 blocked 状态缺少 `executingAgentId`，但 final commit 必须有唯一实际执行 Agent。该 Agent 必须在 `candidates` 中有独立 `targetType='agent'` 且 `structuralEligibility='eligible'` 的条目；`selectedTargetType='squad'` 时还必须是 Squad 当前 active member，`routingSquadId` 必须等于 selected target。这样 Squad 资格与执行成员资格都有独立证据，不靠 leader 或 Squad 汇总分数代替。

Ranking 只能消费当前 `AssignmentAffinitySnapshotRecord` 中的受控 claim、codeowners、项目成员确认和 verified delivery history。每个贡献必须带 source record ID；unknown 取中性值。高/critical Task 在多个 eligible owner 同分且没有可信 differentiator 时必须返回 `assignment-owner-ambiguous`，不能按 ID 随机落 owner；低风险任务的稳定 tie-break 必须标记低置信并进入指标。

TaskPreflight Service 纯函数的完整输入固定为：current TaskContextPack/CapabilityRequirement/AssignmentDraft/Repository/Access digests，executingAgentId，Agent session/config identity，EvidenceAccess records，Agent report，required Scenario verification IDs，escalation requirement 和 policy version；其 canonical digest 写入 `verdictInputDigest`。函数必须对每个 `TaskPreflightCheckCode` 恰生成一个 check，禁止短路省略。

失败映射固定为：`agent_matches_assignment|identity_auditable|structurally_eligible|access_current` 失败=`reject_candidate`，restartStage=`assignment_qualification`；`context_current|evidence_read|starting_point_covered` -> `code_binding`；`objective_restated|allowed_scope_covered|forbidden_scope_acknowledged|escalation_covered` -> `task_plan`；`verification_covered` -> `plan_review`；`no_blocking_unknowns` 按 missingFactCode 的版本化枚举映射到 `requirement_analysis|code_binding|task_plan|capability_requirement_derivation|assignment_qualification`，未知 code 失败关闭到最早的 `requirement_analysis`。Service verdict 优先级唯一：任一 `reject_candidate` 失败 => `rejected`；否则任一 `clarify_upstream` 失败 => `needs_clarification`；全部 pass => `accepted`。Agent report 非 accepted 作为 `no_blocking_unknowns`/escalation 输入，不能降低失败等级或覆盖结果。多失败 check 按 enum 序输出，`restartStage` 取 stage enum 中最早上游值；mapping policy version 与 missingFactCode table version 一并进入 verdictInputDigest，确保相同输入/版本得到字节一致结果。

TaskPreflight 不能修改 objective、scope、verification 或 capability requirement。accepted 还要求全部 cited/required starting evidence 有实际 read 记录、objective 与冻结目标相容、expected surfaces 是 allowed scope 子集且与 forbidden scope 不相交、required Scenario verification 全覆盖、escalation 已确认、missing facts/blocking unknown 为空、全部 digest current；人工/LLM 不能覆盖 Service verdict。

`TaskPreflightRecord.agentId` 必须等于同一 AssignmentDraft 的 `executingAgentId`；Squad leader 的 Preflight 不能替代执行成员。它通过规划控制面以候选 Agent identity 运行，不要求目标代码 Runtime 当前 online；因此兼容 Runtime 暂时 offline 时仍可 accepted 并进入 `waiting_runtime`。不存在兼容 Runtime、执行成员未确定或候选缺 repository/evidence access grant 时分别在资格阶段 `blocked_runtime/assignment-executing-agent-missing/blocked_access`，不进入 finalization/commit。上游 revision 变化创建新 attempt 并使旧 verdict stale。

### 6.11 PlanSnapshot、Project 和 TaskRun 扩展

`PlanSnapshotRecord` 使用兼容联合：历史分支保留缺省版本，V2 分支接受 `2`，V3 分支强制 `3`。V3 扩展：

```ts
planningContractVersion: 2 | 3
planningOperationId?: string
metricPolicyId?: string
metricPolicyVersion?: string
metricPolicyDigest?: Sha256
sourceManifestId?: string
sourceCompletenessDigest?: Sha256
sourceDispositionBindingIds?: string[]
sourceDispositionBindingDigest?: Sha256
acceptanceScenarioDigest?: Sha256
acceptanceScenarioCoveragePolicyIds?: string[]
acceptanceScenarioCoveragePolicyDigest?: Sha256
scenarioCoverageReviewId?: string
scenarioCoverageReviewDigest?: Sha256
requirementReviewId?: string
requirementReviewDigest?: Sha256
sourcePolicyPrecheckId?: string
sourcePolicyDigest?: Sha256
repositoryPolicyBaselineId?: string
repositoryPolicyBaselineDigest?: Sha256
planningRiskProfileId?: string
riskProfileDigest?: Sha256
policySnapshotId?: string
policyDigest?: Sha256
policyFulfillmentIds?: string[]
policyFulfillmentDigest?: Sha256
decisionDigest?: Sha256
decisionOptionEffectDigest?: Sha256
decisionEffectPrecheckIds?: string[]
decisionEffectPrecheckDigest?: Sha256
decisionEffectFinalIds?: string[]
decisionEffectFinalDigest?: Sha256
repositorySnapshotId?: string
repositoryDigest?: Sha256
repositoryStackProfileId?: string
stackProfileDigest?: Sha256
canonicalTargetBindingId?: string
canonicalTargetBindingDigest?: Sha256
accessGrantSnapshotId?: string
accessGrantSnapshotDigest?: Sha256
evidenceClaimDigest?: Sha256
bindingDigest?: Sha256
bindingReviewId?: string
bindingReviewDigest?: Sha256
proposalPackId?: string
proposalDigest?: Sha256
promptReferenceManifestId?: string
promptReferenceManifestDigest?: Sha256
workPackageIds?: string[]
planReviewId?: string
planReviewDigest?: Sha256
planningReferenceMapId?: string
planningReferenceMapDigest?: Sha256
capabilityCatalogSnapshotId?: string
capabilityCatalogDigest?: Sha256
capabilityRequirementDigest?: Sha256
assignmentDecisionIds?: string[]
assignmentDecisionDigest?: Sha256
assignmentEvaluationIds?: string[]
assignmentEvaluationDigest?: Sha256
taskPreflightIds?: string[]
taskPreflightDigest?: Sha256
convergenceCarryValidationIds?: string[]
convergenceCarryValidationDigest?: Sha256
```

上面的可选语法只用于承载 legacy/V2/V3 的公共读取投影；V3 Schema 必须按其阶段契约要求相应字段存在。candidate PlanSnapshot 必须显式保存 exact precheck/final effect ID 集合及 digest；没有 Decision 时保存空 ID 集合和确定性空集 digest，不能用字段缺失表达“无影响”。RepositoryPolicyBaseline、SourceDispositionBinding、PolicyFulfillment、PromptReferenceManifest 和 AssignmentEvaluation 也必须保存 current ID/digest 或确定性空集；只有 legacy/V2 分支可缺省。

Metric policy 是版本化治理事实：

```ts
interface PlanningMetricPolicyRecord {
  id: string
  scopeKey: `global` | `project:${string}`
  scopeProjectId?: string
  version: string
  status: 'published'
  supersedesId?: string
  scopeRevision: number
  metrics: Array<{
    key: string
    numerator: string
    denominator: string
    eventStart?: string
    eventEnd?: string
    sampleWindow: string
    sampleCohort: string
    projectSetDigest: Sha256
    minimumSampleSize: number
    aggregationAlgorithm: 'ratio' | 'duration_percentile' | 'count'
    percentileMethod?: 'nearest_rank'
    exclusions: string[]
    canaryThreshold: string
    releaseThreshold: string
  }>
  approvedBy: string
  approvalReason: string
  policyDigest: Sha256
  publishCommandId: string
  createdAt: ISODate
  publishedAt: ISODate
  effectiveAt: ISODate // V3.3 强制等于 publishedAt，不支持 scheduled activation
}

interface PlanningMetricPolicyPublishRecord {
  id: string
  scopeKey: `global` | `project:${string}`
  scopeProjectId?: string
  requestedVersion: string
  supersedesId?: string
  scopeRevision?: number
  previousPublishedPolicyId?: string
  previousPublishRecordId?: string
  idempotencyKey: string
  requestDigest: Sha256
  outcome: 'published' | 'replayed_existing' | 'rejected_conflict'
  publishedPolicyId?: string
  createdAt: ISODate
}

interface PlanningMetricReleaseReportCreateRecord {
  id: string
  scopeKey: `global` | `project:${string}`
  projectId?: string
  releaseId: string
  metricPolicyId: string
  operationIds: string[]
  observationIds: string[]
  idempotencyKey: string
  requestDigest: Sha256
  outcome: 'created' | 'replayed_existing' | 'rejected_conflict'
  releaseReportId?: string
  createdAt: ISODate
}

interface PlanningMetricReleaseReportRecord {
  id: string
  scopeKey: `global` | `project:${string}`
  projectId?: string
  releaseId: string
  metricPolicyScopeKey: `global` | `project:${string}`
  metricPolicyId: string
  metricPolicyVersion: string
  metricPolicyDigest: Sha256
  operationIds: string[]
  observationIds: string[]
  sampleWindowStart: ISODate
  sampleWindowEnd: ISODate
  metricResults: Array<{
    metricKey: string
    numerator: number
    denominator: number
    sampleSize: number
    value: number
    gate: 'passed' | 'failed' | 'insufficient_sample'
  }>
  reportInputDigest: Sha256
  reportDigest: Sha256
  createdAt: ISODate
}
```

Policy registry 只保存 immutable published records；draft 是 publish command 的校验输入，不是可更新行。`scopeKey` 由 global/projectId 确定性派生且禁止调用方自报。每次成功 publish 同时成为该 scope 的 current activation：`scopeRevision=previous+1`、previous IDs 必须等于该 scope 当前 head；成功 policy/publish 的 `(scopeKey,scopeRevision)` 和 policy 的 `(scopeKey,version)` 唯一；rejected publish 不分配 revision，V3.3 强制 effectiveAt=publishedAt，CAS 失败返回 409 后重读，不覆盖 head。同 version+same digest 且不同 key 写 `replayed_existing` command、返回原 policy、不分配 scopeRevision/不推进 head；同 key/same request 返回原 command；同 version+different digest 返回 409；`supersedesId` 必须等于同 scope current policy（首条为空），不能跳过或成环。published policy 禁止 update/delete，只能追加新 version。

current 解析规则固定：Project scope 若至少有一条成功 publish，取其最大连续 scopeRevision；否则取 global scope 最大连续 scopeRevision。首个 global policy 发布前 PlanningOperation 失败关闭；项目 override 不因后续 global publish 自动漂移，只能显式发布新的 project version。Publish 与 PlanningOperation reserve 共用 serialized/CAS 边界，因此 reserve 原子冻结唯一 resolved `metricPolicyId/version/digest`；同一 operation 永不重新解析 current。ShadowEvaluation、PlanSnapshot 和 immutable PlanningMetricReleaseReportRecord 保存同一三元组。Release report 对 `(scopeKey,releaseId,metricPolicyId)` 唯一，report scopeKey 表示报告项目/全局范围，metricPolicyScopeKey 单独记录 resolved policy 来源；reportInputDigest 绑定 frozen observation/operation 集，且每个引用对象的 policy ID/version/digest 必须与 report 完全一致；同一 release 的 old/new policy 分别生成记录并并列查询，禁止更新、删除、跨 policy 混算或重写历史。

PlanSnapshot 只表示 final commit 已物化的正式 candidate/approved/history，不增加 `shadow` status。Shadow 使用独立评测事实：

```ts
interface PlanningShadowEvaluationRecord {
  id: string
  metricPolicyId: string
  projectId: string
  operationId: string
  basePlanSnapshotId?: string
  reachedStage: PlanningOperationStage
  planningOutcome: 'would_commit' | 'blocked' | 'failed'
  proposalPackId?: string
  capabilityRequirementDraftIds: string[]
  assignmentDraftIds: string[]
  taskPreflightIds: string[]
  decisionEffectPrecheckIds: string[]
  decisionEffectFinalIds: string[]
  decisionEffectPrecheckDigest?: Sha256
  decisionEffectFinalDigest?: Sha256
  blockingDiagnostics: Diagnostic[]
  metricPolicyVersion: string
  metricPolicyDigest: Sha256
  comparisonSummary: Record<string, number | string | boolean>
  inputDigest: Sha256
  evaluationDigest: Sha256
  createdAt: ISODate
}
```

正常走完整链路的 shadow 必须先完成 `decision_effect_finalization`，并把 current precheck/final effect ID 与 digest 写入该记录，不能在 TaskPreflight 后直接结束。若 shadow 在更早阶段按真实门禁 blocked/failed，仍生成 `planningOutcome=blocked|failed` 的评测记录并保存 `reachedStage`、已有事实和 blocking diagnostics；未到达的 proposal/effect 引用保持为空，不得把该样本计入 would-commit 分母。该记录不进入 `plan_snapshots` 表或 PlanSnapshot API，不能成为 Project pointer、审批输入、Dispatcher 输入或 TaskRun 恢复依据；其 reserved PlanSnapshot ID 永不物化并保持不可复用。PlanSnapshot 在 planning final commit 后保持不可变，不保存执行后才产生的 DeliveryIntegration ID；交付关联只由 `Project.currentDeliveryIntegrationSnapshotId`、`DeliveryIntegrationSnapshot.approvedPlanSnapshotId` 和 `DeliveryConvergenceReview.deliveryIntegrationSnapshotId` 表达。

Approval 是独立的不可变业务事实，不是“审批并启动”的中间状态：

```ts
interface PlanApprovalRecord {
  id: string
  projectId: string
  planSnapshotId: string
  planDigest: Sha256
  projectRevision: number
  approverId: string
  approvedAt: ISODate
  gateDigest: Sha256
  accessGrantSnapshotId: string
  accessGrantDigest: Sha256
  canonicalTargetBindingId: string
  canonicalTargetBindingDigest: Sha256
  executionDispatchStatusAtApproval: DispatchStatus
  idempotencyKey: string
  approvalDigest: Sha256
}

interface ExecutionDispatchRecord {
  id: string
  projectId: string
  approvalId: string
  expectedProjectRevision: number
  requestedTaskIds: string[]
  outcome:
    | 'started' | 'partially_started' | 'waiting' | 'blocked' | 'stale'
  taskResults: Array<{
    taskId: string
    taskRevision: number
    outcome:
      | 'started' | 'waiting_dependency' | 'waiting_capacity'
      | 'waiting_runtime' | 'waiting_conflict' | 'blocked' | 'stale'
    predecessorTaskIds: string[]
    reasonCodes: string[]
    taskRunId?: string
    nextObservation?: { kind: string; subjectId?: string; notBefore?: ISODate }
  }>
  createdTaskRunIds: string[]
  observedGateDigest: Sha256
  reasonCodes: string[]
  runnableFrontierDigest: Sha256
  idempotencyKey: string
  dispatchDigest: Sha256
  createdAt: ISODate
}
```

创建 Approval 不得 reserve capacity、acquire workspace、创建/claim TaskRun、创建 Squad coordination 或把 deliveryStatus 改为 `executing`。`waiting_capacity/waiting_runtime` 计划可以审批，保留审批时状态；真正执行由独立 dispatch command 触发并重新门禁。

每次幂等 dispatch 先在 approved Plan 的 current Task revision 上计算 DAG runnable frontier：只有全部 required predecessor 已完成并拥有 current VerificationEvidence 的 Task 才能进入运行资格；其余 Task 明确为 `waiting_dependency`。在任一 requested Task 出现 stale 或硬 blocked 时，整个命令失败关闭并创建 0 Run。没有硬失败时，Service 对 frontier 中 Runtime/capacity/conflict 均通过的 Task 原子创建 Run，其余 Task 保留逐项 soft-wait outcome：全部启动=`started`，部分启动=`partially_started`，无任务启动但存在 soft wait=`waiting`。`createdTaskRunIds` 必须与 `taskResults[outcome='started'].taskRunId` exact-one 相等；非 started task 不得有 taskRunId。这样“部分启动”是显式业务结果，不是泄漏。相同 idempotency key 返回完全相同的 frontier/result/run 集；后续依赖或容量变化必须使用新 key 重新 dispatch。

`ProjectRecord`：

```ts
activePlanningOperationId?: string
planningContractVersion?: 2 | 3
currentDeliveryConvergenceReviewId?: string
currentDeliveryIntegrationSnapshotId?: string
deliveryStatus?: 'not_started' | 'waiting_capacity' | 'waiting_runtime' | 'executing' | 'verifying' | 'integrating' | 'final_repository_snapshot' | 'convergence_reviewing' | 'changes_required' | 'delivered' | 'blocked' | 'failed'
```

`TaskRunRecord`：

```ts
planSnapshotId?: string
deliveryTaskRevision?: number
planningRepositorySnapshotId?: string
planningRepositoryDigest?: Sha256
planningPolicyDigest?: Sha256
capabilityCatalogDigest?: Sha256
capabilityRequirementDigest?: Sha256
accessGrantSnapshotId?: string
accessGrantSnapshotDigest?: Sha256
canonicalTargetBindingId?: string
canonicalTargetBindingDigest?: Sha256
assignmentDecisionId?: string
coordinationId?: string
writerFencingToken?: number
actualBaseCommit?: string
scopeValidation?: {
  status: 'passed' | 'failed' | 'review_required'
  unexpectedPaths: string[]
  policyVersion: string
}
claimVersion?: number
claimOwner?: string
```

V2 记录缺少这些字段时保持原读取语义。任何兼容代码都不得为旧记录合成虚假 binding 或 repository digest。

### 6.11.1 DeliveryConvergenceReviewRecord

```ts
type ConvergenceSubjectType =
  | 'requirement' | 'scenario' | 'policy' | 'binding' | 'task'
  | 'code_surface' | 'verification' | 'integration_output'

interface DeliveryConvergenceFindingRecord {
  id: string
  reviewId: string
  code: 'unmet' | 'partial' | 'unrequested' | 'policy_violation' | 'stale_verification'
  severity: 'warning' | 'error' | 'blocking'
  subjectType: ConvergenceSubjectType
  subjectId: string
  evidenceIds: string[]
  message: string
  findingDigest: Sha256
}

interface DeliveryConvergenceReviewRecord {
  id: string
  projectId: string
  approvedPlanSnapshotId: string
  deliveryIntegrationSnapshotId: string
  integratedFinalCommit: string
  finalRepositorySnapshotId: string
  finalRepositoryDigest: Sha256
  requirementDigest: Sha256
  acceptanceScenarioDigest: Sha256
  acceptanceScenarioCoveragePolicyDigest: Sha256
  policyDigest: Sha256
  bindingDigest: Sha256
  approvedPlanDigest: Sha256
  integrationDigest: Sha256
  verificationEvidenceDigest: Sha256
  status: 'converged' | 'changes_required' | 'blocked' | 'failed' | 'stale'
  findingIds: string[]
  findingSetDigest: Sha256
  reviewerVersion: string
  convergenceDigest: Sha256
  repairRequestStatus: 'not_required' | 'pending' | 'created' | 'blocked'
  repairRequestDigest?: Sha256
  repairPlanningOperationId?: string
  createdAt: ISODate
}

interface ConvergenceRepairBaselineRecord {
  id: string
  projectId: string
  parentPlanSnapshotId: string
  parentIntegrationSnapshotId: string
  parentConvergenceReviewId: string
  canonicalTargetBindingId: string
  canonicalTargetBindingDigest: Sha256
  finalCommit: string
  finalRepositorySnapshotId: string
  requirementDigest: Sha256
  scenarioDigest: Sha256
  policyDigest: Sha256
  findingIds: string[]
  findingSetDigest: Sha256
  findingDispositions: Array<{
    findingId: string
    disposition: 'carry_current' | 'reverify' | 'reexecute' | 'superseded'
    reasonCode: string
  }>
  carryItemIds: string[]
  carryItemSetDigest: Sha256
  baselineDigest: Sha256
  createdAt: ISODate
}

interface ConvergenceRepairCarryItemRecord {
  id: string
  projectId: string
  repairBaselineId: string
  subjectType: ConvergenceSubjectType
  subjectId: string
  sourceRecordId: string
  sourceSubjectDigest: Sha256
  sourceBindingClosureDigest: Sha256
  sourceVerificationInputDigest: Sha256
  sourceFinalCommitReachabilityDigest: Sha256
  disposition: 'carry_current' | 'reverify' | 'reexecute' | 'superseded'
  reasonCode: string
  evidenceIds: string[]
  carryItemDigest: Sha256
  createdAt: ISODate
}

interface ConvergenceCarryValidationRecord {
  id: string
  projectId: string
  repairBaselineId: string
  successorOperationId: string
  carryItemId: string
  subjectType: ConvergenceSubjectType
  subjectId: string
  disposition: 'carry_current' | 'reverify' | 'reexecute' | 'superseded'
  sourceSubjectDigest: Sha256
  targetSubjectDigest?: Sha256
  sourceBindingClosureDigest: Sha256
  targetBindingClosureDigest?: Sha256
  sourceVerificationInputDigest: Sha256
  targetVerificationInputDigest?: Sha256
  sourceFinalCommitReachabilityDigest: Sha256
  targetFinalCommitReachabilityDigest?: Sha256
  result: 'valid' | 'invalid'
  mismatchCodes: Array<
    'carry-subject-changed' | 'carry-binding-closure-changed'
    | 'carry-verification-input-changed' | 'carry-final-commit-unreachable'
    | 'carry-target-missing' | 'carry-disposition-invalid'
  >
  validatorVersion: string
  validationDigest: Sha256
  createdAt: ISODate
}
```

Convergence 使用 final snapshot，不复用 R0。Review 与其 Finding records 在同一原子/可补偿提交中创建；findingIds 按 `(findingDigest,id)` 稳定排序；`findingSetDigest=sha256(canonical-json(sorted findingDigest list))`，ID 只做同 digest 的确定性排序，不进入内容 digest。存在 blocking finding 时以 `(reviewId,findingSetDigest)` 幂等创建唯一 RepairBaseline 和 mode=`revise` operation；baseline.findingIds/setDigest 必须与 parent review 完全相等；baseline.carryItemIds 与独立 ConvergenceRepairCarryItemRecord exact-one 闭合；IDs 按 `(carryItemDigest,id)` 排序计算 carryItemSetDigest 并进入 baselineDigest，且 findingDispositions 对每个 findingId 恰有一项、不得多项或缺项。repair operation 强制保存 repairBaselineId，planning base 必须等于父 canonical finalCommit。所有 finding 是不可丢弃 input。Successor candidate 必须为 baseline 每个唯一 carryItemId 生成恰一条 ConvergenceCarryValidationRecord。`carry_current` 要求四组 source/target digest 逐项相等且 target 非空、result=valid；任一 mismatch 返回稳定 code 并强制 `reverify|reexecute`。`superseded` 要求 target subject 缺失且有替代/移除依据，不能用来隐藏仍存在的 changed subject。所有 ConvergenceSubjectType 都使用同一 validator；`result` 按 disposition 判定：carry_current 只在 target 存在且四组 digest 相等时 valid；reverify/reexecute 允许 subject/binding/verification digest 变化，但只在 target 存在且 successor 冻结对应新 verification/reexecution Task input/relationship 时 valid；superseded 只在 target 缺失且替代/移除证据闭合时 valid。mismatchCodes 始终记录纯比较结果，不能单独替代 disposition-aware result。target binding/verification/reachability digest 的 canonical 输入由 validatorVersion 冻结。传递受影响事实必须 reverify/reexecute；规划 commit 只验证 successor 已冻结新的 verification/reexecution input 与任务关系，后续 Delivery gate 再要求新 TaskRun/VerificationEvidence 完成。移除事实只能 superseded，不能删除。Repair 仍产生新 PlanSnapshot、IntegrationSnapshot、final snapshot 和 ConvergenceReview；旧 approved Plan、Task、Assignment、TaskRun、Verification 和 finding 保持不可变。Delivery close 只接受 current、非 stale 且 `status='converged'` 的 review。

### 6.11.2 DeliveryIntegrationSnapshotRecord

孤立 worktree 中的 TaskRun 成功不等于交付已经进入用户实际使用的代码。Convergence 前必须先形成唯一 canonical target 的集成快照：

```ts
interface DeliveryIntegrationSnapshotRecord {
  id: string
  projectId: string
  approvedPlanSnapshotId: string
  canonicalTargetBindingId: string
  canonicalTargetBindingDigest: Sha256
  accessGrantSnapshotId: string
  accessGrantSnapshotDigest: Sha256
  targetResourceId: string
  repositoryIdentityDigest: Sha256
  targetRef: string
  baseCommit: string
  expectedTargetHead: string
  outputs: Array<{
    sequence: number
    taskId: string
    taskRunId: string
    baseCommit: string
    headCommit?: string
    diffDigest: Sha256
    patchIds: string[]
    integrationMethod: 'in_place' | 'merge' | 'cherry_pick' | 'manual_resolution' | 'no_code_change'
    status: 'pending' | 'integrated' | 'conflicted' | 'rejected'
    targetParentCommitBefore: string
    targetTreeBefore: string
    targetCommitAfter: string
    targetTreeAfter: string
    inclusionStatus: 'pending' | 'verified' | 'duplicate' | 'no_code_change' | 'failed'
    inclusionEvidenceIds: string[]
    audit?: { actor: string; reason: string; at: ISODate }
  }>
  finalCommit?: string
  observedTargetHeadAtFinalize?: string
  casStatus: 'pending' | 'matched' | 'moved' | 'failed'
  targetClean: boolean
  status: 'pending' | 'integrating' | 'conflicted' | 'ready' | 'failed' | 'stale'
  integrationDigest: Sha256
  createdAt: ISODate
}
```

每条 required output 另存一条可复算的包含性证据：

```ts
interface IntegrationInclusionEvidenceRecord {
  id: string
  integrationSnapshotId: string
  sequence: number
  taskId: string
  taskRevision: number
  taskRunId: string
  sourceBaseCommit: string
  sourceHeadCommit?: string
  sourceTree?: string
  sourceDiffDigest: Sha256
  sourcePatchIds: string[]
  changedPaths: Array<{
    path: string
    beforeBlob?: string
    afterBlob?: string
    beforeMode?: string
    afterMode?: string
  }>
  targetParentCommitBefore: string
  targetTreeBefore: string
  targetCommitAfter: string
  targetTreeAfter: string
  proofKind: 'ancestor' | 'patch_hunk_tree_equivalence' | 'duplicate' | 'no_code_change'
  matchedPatchIds: string[]
  duplicateEvidenceId?: string
  toolVersion: string
  result: 'verified' | 'failed'
  failureCode?: string
  evidenceDigest: Sha256
}
```

`integrating` 属于交付生命周期，不属于 PlanningOperation 的规划 stage。交付状态单独使用 `DeliveryStage = 'executing' | 'verifying' | 'integrating' | 'final_repository_snapshot' | 'convergence_reviewing' | 'delivered' | 'changes_required' | 'blocked' | 'failed'`，避免把计划提交和代码集成混成一个 operation 状态。`converged` 只属于 DeliveryConvergenceReview status；DeliveryStage 从 `convergence_reviewing` 直接进入 `delivered` 或 `changes_required/blocked/failed`。

首版只支持 CanonicalTargetBinding 冻结的一个 target。Service 从 immutable run commits 重算 source base/head/tree、diff、changed paths 和稳定 patch IDs，要求每个 required TaskRun 恰有一条 output 且 sequence 连续并满足 DAG。source head 是 integrated commit ancestor 时用 ancestor proof；否则必须逐 patch/hunk 等价，并校验所有 changed path 的最终 blob/mode postimage。duplicate 必须引用更早 verified evidence、diff/patch set 相同且效果仍存在当前 target tree。`no_code_change` 仅在重算 diff 为空且有 actor/reason 审计时允许。手工冲突解决只是 integration method，不是 proof kind，仍需通过上述 tree/patch proof。第一个 output 的 `targetParentCommitBefore/targetTreeBefore` 必须等于 expectedTargetHead 及其 tree；后续 output 必须同时满足 `targetParentCommitBefore == previous.targetCommitAfter` 与 `targetTreeBefore == previous.targetTreeAfter`。`targetCommitAfter` 必须真实存在且其 tree 等于 `targetTreeAfter`；no-code step 的 commit/tree 前后均相等。ready 时 `finalCommit == last.targetCommitAfter`（零 required output 不允许进入 integration）。

集成开始时读取 CanonicalTargetBinding.targetRef 并冻结 `expectedTargetHead`，完成时对该 ref 执行 CAS，记录 `observedTargetHeadAtFinalize/casStatus`。Integration principal 必须持有 current `canonical_integrate` grant，普通 Agent/TaskRun 无此权限。每一条 output 都必须有 result=verified 的 IntegrationInclusionEvidence；worktree head、测试成功、`targetCommitAfter` 非空、人工“已确认”或 output 状态本身都不能通过门禁。目标 ref/base/binding/access digest 变化使 snapshot stale；merge/cherry-pick 冲突、DAG 顺序错误、proof 失败、target dirty 或 CAS 不匹配均阻塞。只有全部 required output 的 evidence verified、commit/tree continuity 成立、`casStatus=matched`、target clean、`status=ready` 且固定精确 `finalCommit` 才能进入 Convergence。多仓库交付在尚未建立跨仓库引用模型前必须失败关闭。

### 6.12 新增表

建议在 `src/storage.ts` 增加：

```text
workspace_writer_leases
planning_metric_policies
planning_metric_policy_publishes
planning_metric_release_report_creates
planning_metric_release_reports
planning_operations
planning_stage_attempts
planning_repair_attempts
planning_evidence_accesses
requirement_source_manifests
requirement_source_anchors
requirement_source_profiles
source_disposition_bindings
acceptance_scenarios
acceptance_scenario_coverage_policies
scenario_coverage_reviews
requirement_decision_option_effects
requirement_decision_planning_effects
source_policy_prechecks
repository_policy_constraint_seeds
repository_policy_baselines
planning_risk_profiles
planning_policy_snapshots
policy_constraints
policy_fulfillments
repository_context_snapshots
repository_stack_profiles
canonical_target_bindings
repository_evidence_nodes
evidence_claims
verification_commands
requirement_code_bindings
planning_reviews
work_package_proposals
task_proposals
task_context_packs
planning_proposal_packs
planning_prompt_reference_manifests
work_packages
capability_definitions
agent_capability_claims
project_capability_catalog_snapshots
capability_requirement_drafts
capability_requirements
resource_access_grants
resource_access_grant_revocations
project_access_grant_snapshots
assignment_drafts
expected_assignment_fixtures
assignment_evaluations
task_preflights
assignment_decisions
squad_coordinations
agent_project_affinity_claims
assignment_affinity_snapshots
planning_reference_maps
planning_shadow_evaluations
plan_approvals
execution_dispatches
delivery_convergence_reviews
delivery_convergence_findings
convergence_repair_baselines
convergence_repair_carry_items
convergence_carry_validations
delivery_integration_snapshots
integration_inclusion_evidence
```

表命名、ID 前缀和分页方式遵循现有 domain table 约定。`planning_metric_policies` 对 `(scopeKey,version)` 唯一且 published 行不可 update/delete；publish command 对 `(scopeKey,idempotencyKey)` 唯一；仅 `outcome=published` 的记录对 `(scopeKey,scopeRevision)` partial-unique，previous head CAS 必须匹配，同 key 不同 requestDigest 或同 version 不同 policyDigest 返回 409，并发发布最多一个成功。`planning_metric_release_report_creates` 对 `(scopeKey,idempotencyKey)` 唯一：same key/same requestDigest 返回原 command/report，same key/different requestDigest 返回 409；different key 但 same canonical report key/input 写 replayed_existing command，不创建第二份 report。`planning_metric_release_reports` 对 `(scopeKey,releaseId,metricPolicyId)` 唯一且不可 update/delete，same canonical key/same reportInputDigest 幂等，不同 digest 冲突。

`source_disposition_bindings` 对 `(operationId,sourceAnchorId,targetType,targetId)` 唯一；每个需要 target 的 normative anchor 必须有相容 binding closure。RepositoryPolicyBaseline 对 `(projectId,repositoryIdentityDigest,repositoryDigest,extractorVersion,constraintSeedSetDigest)` 可重放，同一 predecessor baseline + delta digest 只能生成一个 successor baseline/operation，iteration 单调增加且不得超过 policy 上限。`planning_prompt_reference_manifests` 内 `(manifestId,ref)` 唯一，artifact 外键/kind/digest 必须一致且跨 attempt ref 拒绝。`policy_fulfillments` 对 `(operationId,policyConstraintId)` 唯一，reserved Task 外键必须属于同一 PlanningReferenceMap。

`convergence_repair_carry_items.id` 全局唯一并对 `(repairBaselineId,subjectType,subjectId)` 唯一；Baseline 的 carryItemIds/setDigest 必须与 child records exact-one 闭合。`convergence_carry_validations` 对 `(successorOperationId,carryItemId)` 唯一并以 `(repairBaselineId,carryItemId)` 外键指向 carry item，same key/same validationDigest 幂等，不同 digest 冲突。`plan_approvals`、`execution_dispatches` 和 grant revocation command 均对 `(projectId,idempotencyKey)` 唯一；每个 grantId 最多一条 RevocationRecord，重复同 key/request 返回原记录，不同 requestDigest 冲突。Dispatch 的 requestedTaskIds/taskResults 必须 exact-one；硬 blocked/stale 时 `createdTaskRunIds=[]`，否则它必须与 started taskResult 的 taskRunId 集合完全相等，并与新 TaskRun 在同一原子/可补偿临界区创建。每个 executable proposal 对同一 evaluation policy/input digest 恰有一个 terminal assignment evaluation；selected evaluation 的 draft/target/executing 字段必须与最终 AssignmentDecision 一致。每个 required output 恰有一个 inclusion evidence。大文本 evidence 限制单记录大小，超限只保存 digest、range 和受控 excerpt。

## 7. Digest 与 stale 契约

### 7.1 Canonical digest

所有 digest 统一使用：

```text
sha256(canonical-json(value))
```

`canonical-json` 规则：对象 key 递归排序，数组保持业务顺序；不可用 `undefined`；时间、绝对路径、随机 ID 和运行耗时不进入内容 digest；字符串不做语义归一化，只统一换行到 LF。

### 7.2 Digest 依赖图

```text
source files --------------------> sourceDigest
all source blocks + classification
  + normative disposition --------> sourceManifestDigest
source anchors + resolved targets -> sourceDispositionBindingDigest
requirements + AC + decisions
  + chosen option/resolution -----> requirementDigest / decisionDigest
AC + seed scenario body ----------> seedScenarioDigest
AC + all scenario category/body ---> acceptanceScenarioDigest
per-AC category applicability/reason
  + risk derivation input ---------> scenarioCoveragePolicyDigest
requirement subject + review ------> requirementReviewDigest
repository policy seed monotonic union
  + repository/extractor identity -> repositoryPolicyBaselineDigest
source constraints + authority
  + inherited repository baseline -> sourcePolicyDigest
requirements/scenarios/decisions
  + option effects + source policy
  + precheck + scenario coverage policy
  + risk policy ------------------> riskProfileDigest
repo tree + dirty + providers ----> repositoryDigest
stack detection + coverage -------> stackProfileDigest
resource/repository/root/ref/base
  + integration principal/grant --> canonicalTargetBindingDigest
source policy + repository rules
  + baseline comparison/delta
  + dispositions ----------------> policyDigest
repository evidence + claims -----> evidenceClaimDigest
requirements/scenarios/policy/risk
  + repository + claims ----------> bindingDigest
bindings + review ----------------> bindingReviewDigest
work package/task proposals
  + context packs + DAG ----------> proposalDigest
prompt refs + artifact digests ---> promptReferenceManifestDigest
local key -> ID reference map ----> mapDigest
policy + reference map
  + task/verification mapping ----> policyFulfillmentDigest
binding + risk + task + rules ----> capabilityRequirementDigest
proposal + capability draft
  + plan review ------------------> planReviewDigest
definitions + confirmed claims ---> capabilityCatalogDigest
agent/resource grants + resource
  + team ------------------------> accessGrantSnapshotDigest
catalog + requirements + team
  + access + target binding -----> assignmentDraftDigest
proposal + assignment draft
  + routing/executing owner
  + candidate outcomes/reasons ---> assignmentEvaluationDigest
assignment draft + context pack
  + access/read audit + checks
  + selected agent report/verdict -> taskPreflightDigest
decision options + resolution + precheck + binding/review
  + proposal/capability/assignment/preflight
  --------------------------------> decisionEffectFinalDigest
approved drafts + access/target
  + all digests -----------------> PlanSnapshot candidate
PlanSnapshot + gate/access/target -> PlanApprovalDigest
Approval + current gates/status
  + requested task set + runnable frontier
  + per-task outcomes ------------> executionDispatchDigest
run source diff + target tree
  + inclusion proof -------------> inclusionEvidenceDigest
all inclusion + target CAS ------> integrationDigest
integration finalCommit + final repo + approved plan
  + verification + specifications -> convergenceDigest
review findings + finalCommit
  + carry-forward decisions -----> repairBaselineDigest
```

### 7.3 stale 规则

以下变化必须使相应对象 stale：

| 变化 | stale 对象 | 处理 |
| --- | --- | --- |
| PRD/技术方案 sourceDigest 变化 | profile、全 block classification/disposition、manifest、SourceDispositionBinding、requirement、source policy、binding、plan | 从 source_profile 重跑 |
| RequirementSourceProfile/parser/attachment/block coverage 变化 | manifest、SourceDispositionBinding、requirement、review、source policy、risk、binding、proposal、approval | 从 source_profile 重跑；不完整 normative profile 或未分类 block 立即阻塞 |
| Requirement/Acceptance/seed Scenario/Decision choice-resolution-option effect 变化 | requirement review、source precheck、decision precheck/final、Risk/CoveragePolicy、completion/review 及全部下游 | 从最早受影响 requirement/decision stage 重算 |
| CoveragePolicy/riskDerivationInputDigest 变化 | Risk、Scenario completion/review、Binding 及全部下游 | source/Decision 未变时 successor 必须继承 baseline 且不得弱化；输入变化才重推 |
| completion Scenario/full scenario digest/ScenarioCoverageReview 变化 | repository 后的 Binding、proposal、capability、assignment、preflight、Plan/Approval/Convergence | 从 scenario_completion/review 重算；不反向 stale Decision precheck/Risk |
| RepositoryPolicyBaseline 变化 | SourcePolicyPrecheck、decision precheck/final、Risk/CoveragePolicy、Scenario、Binding 及全部下游 | successor 从 source_policy_precheck 前向重算；相同 repository/extractor/seed-set digest 必须收敛，不得再次 stale |
| SourcePolicyPrecheck 或 PlanningRiskProfile 变化 | decision precheck/final、risk/CoveragePolicy、scenario completion/review、binding、proposal、PolicyFulfillment、capability draft、review、assignment、preflight、approval | 从最早受影响 stage 重算，完整 Policy 不得削弱 source precheck |
| active MUST/full Policy digest 变化 | RepositoryPolicyBaseline、decision precheck、risk、binding、proposal、PolicyFulfillment、TaskRun start、convergence | 仅 delta 扩展 baseline 并创建 successor；相同集合 converged；不收敛达到上限则 blocked |
| repositoryDigest 变化 | stack profile、target binding、repository policy baseline、policy、evidence claim、binding、proposal、prompt ref、PolicyFulfillment、assignment draft、preflight、未完成 convergence | 做差异影响分析；不确定则全量重算 |
| CanonicalTargetBinding 变化 | Policy、Binding 及全部下游、Approval、未开始 TaskRun、Integration | 新 plan revision/approval，禁止在旧 snapshot 替换 target |
| AccessGrantSnapshot/授权撤销 | assignment、preflight、approval、未启动 dispatch；active run 在下一 tool/settle fence | 重建授权快照和资格，不能只记录 warning |
| stack support policy/provider 版本变化 | stack profile、相关 evidence/binding | shadow 重算后再切换；unsupported 不沿用旧 ready |
| CapabilityDefinition/active Claim/membership 变化 | capability catalog、assignment draft、preflight、decision final effect、approval | 重建 snapshot 和候选；不改 Task 语义 |
| proposal/reference map/PromptReferenceManifest 变化 | PolicyFulfillment、capability draft、plan review、assignment/evaluation、preflight、approval | 重建 fulfillment 和下游；未注入或跨 attempt ref 直接拒绝 |
| capability derivation policy/TaskContextPack 变化 | capability draft、plan review、assignment draft/evaluation、preflight、decision final effect、未开始 TaskRun | 生成新 proposal/task revision，旧 run 保留 |
| selected candidate/assignment draft 变化 | AssignmentEvaluation、TaskPreflight、decision final effect、approval | 对同一 current draft 重做 Evaluation/Preflight 并重算 final effect，旧记录 stale |
| teamDigest 变化 | capability catalog、assignment draft、preflight、decision final effect、approval | 只重算团队事实，除非能力缺口影响 plan status |
| command trust 下降或 baseline 失效 | plan review、approval | 阻止启动或要求重新验证 |
| final repository/verification evidence 变化 | DeliveryConvergenceReview、RepairBaseline carry-forward | 旧 review stale，重新 convergence；受影响事实不得 carry_current |
| DeliveryIntegration target/ref/base/output/proof 变化 | IntegrationInclusionEvidence、DeliveryIntegrationSnapshot、Convergence/RepairBaseline | 集成 snapshot stale，重算 proof 并重新集成/固定 finalCommit |

Provider 只要报告 stale、failed 或 critical completeness 缺口，就不能沿用旧 snapshot 冒充 current。

### 7.4 统一 freshness 派生契约

DecisionOptionEffect、两阶段 DecisionPlanningEffect、RiskProfile、ScenarioCoverageReview、EvidenceClaim、TaskContextPack、TaskPreflight 和 Review 保持不可变，不原地追加 `stale` status。`PlanningFreshnessService` 根据每类 artifact 的冻结 input digest 与 Project current input digest 派生：

```ts
interface PlanningArtifactFreshness {
  artifactId: string
  artifactKind:
    | 'requirement_source_profile' | 'source_manifest' | 'source_disposition_binding'
    | 'acceptance_scenario_coverage_policy' | 'scenario_coverage_review'
    | 'source_policy_precheck' | 'repository_policy_baseline' | 'review' | 'decision_option_effect' | 'decision_effect' | 'risk_profile'
    | 'repository_snapshot' | 'repository_stack_profile'
    | 'canonical_target_binding' | 'policy_snapshot' | 'evidence_claim'
    | 'binding' | 'prompt_reference_manifest' | 'proposal_pack' | 'task_context_pack' | 'policy_fulfillment'
    | 'capability_requirement' | 'capability_catalog' | 'access_grant_snapshot'
    | 'assignment' | 'assignment_evaluation' | 'task_preflight'
    | 'plan_snapshot' | 'plan_approval' | 'integration_inclusion_evidence'
    | 'integration_snapshot' | 'convergence_review' | 'repair_baseline'
    | 'convergence_carry_validation'
  frozenInputDigest: Sha256
  currentInputDigest: Sha256
  freshness: 'current' | 'stale'
  staleDimensions: Array<
    'source' | 'source_parser' | 'source_attachment' | 'source_block_coverage'
    | 'requirement' | 'scenario' | 'scenario_category_policy' | 'decision' | 'risk' | 'policy' | 'repository_policy_baseline'
    | 'repository' | 'stack_support' | 'provider_policy'
    | 'canonical_target' | 'access_grant' | 'evidence_claim'
    | 'prompt_reference' | 'policy_fulfillment' | 'task_context' | 'capability_catalog' | 'team' | 'candidate'
    | 'runtime_compatibility' | 'convergence_carry'
  >
  checkedAt: ISODate
}
```

该对象是查询/门禁 DTO，首版不单独持久化；每次 stage commit、approval、dispatch 和 convergence 都在同一 serialized/revision-check 边界内重新计算。若未来缓存，cache key 必须包含 Project revision 和所有 current digest，不能成为另一份 source of truth。API 返回 `freshness/staleDimensions`；UI 只展示 Service 结果，不自行比较 digest。commit 要求全部 planning artifact current；approval 复核 PlanSnapshot 的全部冻结事实；dispatch 额外复核 task/assignment/preflight、policy、catalog、team 和 Runtime compatibility。

## 8. PlanningOperation 状态机

### 8.1 正常流程

```text
reserved
  -> source_ingest
  -> source_profile
  -> source_manifest
  -> requirement_analysis
  -> requirement_review
  -> source_policy_precheck
  -> decision_effect_precheck
  -> risk_profile
  -> scenario_completion
  -> scenario_coverage_review
  -> repository_snapshot
  -> canonical_target_binding
  -> policy_snapshot
  -> code_binding
  -> binding_review
  -> work_packages
  -> task_plan
  -> reference_mapping
  -> policy_fulfillment
  -> capability_requirement_derivation
  -> plan_review
  -> capability_catalog_snapshot
  -> access_grant_snapshot
  -> assignment_qualification
  -> task_preflight
  -> decision_effect_finalization
  -> convergence_carry_validation
  -> candidate mode: committing -> committed
  -> shadow mode: shadow_completed
```

每个 stage：

1. 读取 operation 和 expected stage；
2. 读取其上游不可变记录并复核 digest；
3. 执行纯计算、provider 或 LLM 调用；
4. 校验输出 schema 和确定性不变量；
5. 写入新的不可变 child records；
6. 更新 operation 的 child IDs、diagnostics、stage 和 heartbeat；
7. stage 完成前的局部失败不能推进 Project pointer。

`scenario_coverage_review` 必须原子写 immutable ScenarioCoverageReviewRecord 并把 ID/digest 写回 operation；reviewInputDigest 绑定 sorted CoveragePolicy IDs/digest、full Scenario IDs/digest、Risk ID/digest 和 reviewer policy。`independenceStatus='violated'`、非 approved、finding blocking 或 freshness stale 均不得进入 repository_snapshot。

`policy_snapshot` 是唯一允许扩展 RepositoryPolicyBaseline 的阶段。`fixedPointStatus='delta_found'` 时当前 operation 不进入 `code_binding`，而是原子写 baseline、terminal 当前 operation 并创建继承 baseline 的 successor；`fixedPointStatus='converged'` 才能继续。`policy_fulfillment` 在 reference mapping 后运行，对每个 applicability 已决的 active MUST 生成 exact-one fulfillment；applicable 分支以非空 reserved Task/Verification 闭合未来正式 Task，approved-not-applicable 分支以必填人工审计和空执行映射闭合。它不能修改 PolicyConstraint 或 PlanningReferenceMap。

`convergence_carry_validation` 对所有 operation 都执行。非 repair operation 保存空 IDs 和 `sha256(canonical-json([]))`；repair successor 必须对 baseline 每个唯一 carryItemId（所有 disposition）生成 exact-one current validation record：`carry_current` 要求四组 digest 相等且 result=valid；`reverify|reexecute` 要求 successor 中存在新的 verification Task/TaskContext input 与 required relationship（此时不伪称未来 TaskRun 已完成），对 `superseded` 要求 target missing 与替代/移除证据；各分支不满足时该 record 为 invalid。aggregate digest 按 `(carryItemId,validationDigest)` 排序。missing/duplicate/invalid 分别返回 `carry-validation-missing|carry-validation-duplicate|carry-validation-invalid` 并在正式 records 物化前阻塞。

### 8.2 Commit point

最终 commit 在一个 `serializedMutation` 内执行：

1. 重新读取 Project；
2. 校验 `revision === baseProjectRevision`、status 允许、active operation 匹配；
3. 校验 base/current plan pointer 与 operation mode 匹配；
4. 重新计算 source/profile/block manifest、SourceDispositionBinding closure、requirement/seed+full Scenario/CoveragePolicy、Decision、SourcePolicy/RepositoryPolicyBaseline、四类 Review/Risk、repository/stack/Target/Policy/fixed-point、Claim/Binding、proposal/prompt-reference/context/reference/PolicyFulfillment、capability/catalog/access、assignment/evaluation、Preflight 和 CarryValidation 全部 digest；
5. 校验 stack supported，SourcePolicy/RepositoryPolicyBaseline/Target/Access 和 Requirement/ScenarioCoverage/Binding/Plan Review current、approved、independence valid，Policy fixed point converged 且无 blocking finding；
6. 校验两阶段 Decision effect current/non-blocking、Scenario category/Policy/PolicyFulfillment/relationship/DAG/context/reference closure、trusted claim/hard eligibility/唯一 executingAgentId、每 proposal 唯一 terminal Evaluation 且其 selected target/executing Agent/draft digest 与 AssignmentDraft 和待物化 AssignmentDecision 完全一致、required Preflight accepted，以及 convergence baseline 每个唯一 carryItemId 的 exact-one current valid disposition/validation；
7. 校验 operation 的正式 workPackageIds/taskIds/capabilityRequirementIds/assignmentDecisionIds 仍为空，所有 proposal/draft 属于本 operation；
8. 按已冻结 PlanningReferenceMap 一次物化 WorkPackage、正式 CapabilityRequirement、AssignmentDecision、DeliveryTask 和 PlanSnapshot candidate；
9. 最后更新 Project 的 currentPlanSnapshotId、taskIds、revision、approval status 和 executionDispatchStatus；
10. 将旧 candidate 标记 superseded；
11. operation 写入正式记录 ID 并标记 committed。

shadow mode 在 TaskPreflight.serviceVerdict accepted 后继续用 proposal/draft/preflight 运行 `decision_effect_finalization`，再写包含 precheck/final effect ID、digest 和对比指标的 `PlanningShadowEvaluationRecord`；final effect blocking 时记录真实 blocked outcome，不能伪装为 would-commit。该流程不创建 PlanSnapshot，不物化任何正式 WorkPackage/CapabilityRequirement/AssignmentDecision/Task，也不进入 candidate commit 临界区；完成评测后 operation 写入 `shadowEvaluationId` 并标记 `shadow_completed`。更早阶段 blocked/failed 的 shadow 同样写 terminal evaluation，但保留真实 outcome 和 reached stage。

Project pointer 切换是业务 commit point。正式记录物化成功、Project pointer 更新失败时，新 snapshot 和正式 child 是未引用记录，恢复流程必须按 operation ownership 清理或标记 aborted；不得把它显示为 current。禁止在 commit 后批量 rewrite Task 以补 `planSnapshotId`。

规划状态机不包含执行后的 Convergence。交付生命周期单独推进：

```text
approved
  -> waiting_capacity | waiting_runtime
  -> executing
  -> verifying
  -> integrating
  -> final_repository_snapshot
  -> convergence_reviewing
  -> converged -> delivered
  -> changes_required -> new revise PlanningOperation
  -> blocked | failed
```

`waiting_capacity` 和可恢复 `waiting_runtime` 表示 approved 但当前不可 dispatch；它们不能伪装为 executing。`integrating` 必须在 required VerificationEvidence 完成后，把每个 TaskRun output 纳入唯一 canonical target 并固定 clean finalCommit；`final_repository_snapshot` 只能针对该 finalCommit 构建。`changes_required` 不回退或改写原 PlanningOperation；它引用原 approved snapshot 并创建新的 revise operation。只有新 revision 再次批准、执行、验证、集成和 convergence 后才能 delivered。

### 8.3 幂等与并发

- 同 requestDigest 的重复请求返回已有 operation；
- 同项目已有 running operation 时，新 requestDigest 返回 `409 planning-in-progress`；
- append/revise 记录 base plan 和 base revision，commit 时不一致返回 `409 planning-stale`；
- operation lease 负责业务占用，不替代 writer lock；每次 recovery/mutation/background continuation 先以 authoritative OS lock handle 调用 `assertWriter(fencingToken)`，lease record 仅审计；
- LLM/provider 调用发生在 mutation lock 外，只有 reserve、stage commit 和 final commit 进入短临界区；
- stage-local focused repair 使用同 operation 新 attempt；任何会改变已完成上游 digest 的 repair 终止当前 operation，并以 repairDigest 幂等创建唯一 successor operation；
- 人工解决 Decision 会推进 Project revision，正在运行的 operation 在下一 stage 或 commit 时 stale。

### 8.4 崩溃恢复

`initialize()` 只有在成功持有 workspace OS lock、取得新 fencing token 并通过 `assertWriter` 后，才执行 `recoverPlanningOperations`，且在 `recoverInterruptedWork` 前执行：

```text
for each expired running operation:
  if Project.currentPlanSnapshotId == operation.candidatePlanSnapshotId:
    mark operation committed
    repair missing snapshot/project status if deterministic
  else:
    mark operation aborted with recovery diagnostic
    delete or tombstone child records exclusively owned by operation
    clear Project.activePlanningOperationId if still equal
    restore Project pointer/status to the exact pre-operation snapshot saved at reserve time
```

恢复只处理可由指针和 ownership 证明的状态。无法证明 child 是否被其他对象引用时保留记录并标记 orphan diagnostic，不做破坏性删除。

### 8.5 blocked 与 failed

- `blocked`：业务上缺少继续所需的需求决策、仓库事实、代码 owner、团队能力或计划完整性；保留完整 diagnostics，允许针对 root cause 重试；
- `failed`：provider/LLM/storage 等依赖或系统失败；不伪装成业务 blocked；
- `aborted`：被新操作替代、用户取消或崩溃恢复终止；
- 无论何种非 committed 终态，都不能改变 current plan pointer。

## 9. Source Manifest V3.3

### 9.1 构建算法

Manifest Builder 对 PRD 和技术设计分别执行：

1. 保留每个 parsed block：PDF 使用稳定 block locator；Markdown/纯文本使用 section path + ordinal，禁止预筛选；
2. 识别标题、编号、列表、表格、定义、约束词和决策问句，只写 `normativeHints`；
3. Source Classification Service 对每个 block 返回唯一 `normative|context|duplicate|uncertain` classification 和 reason，不返回业务记录 ID；
4. `normative` block 再冻结唯一 Requirement/Acceptance/Decision/Constraint/Deferred/OutOfScope disposition；context 命中 hint 要求独立 Reviewer，uncertain 阻塞；
5. 过长 paragraph 按句子边界拆分但保留 parent locator；拆分后的每个 block 都进入分母；
6. 相同文本不自动去重；duplicate 必须显式指向已分类主 anchor且无环；
7. Service 校验 `classifiedBlockCount === sourceBlockCount === sum(profile.parsedBlocks)` 和 normative disposition=100%，再生成 sourceManifestDigest；
8. Requirement Analyzer 在下一 stage 生成 local key 和业务对象，Service 随后写 SourceDispositionBinding closure；Manifest 不回写 target。

在 `source_profile` stage，Service 必须先持久化并校验每个来源的 `RequirementSourceProfileRecord`；全部 normative profile complete 后，`source_manifest` 才能冻结 anchor：Markdown/plain text 必须 blocks 全量解析；PDF 必须 text/visual pages 全量分析；附件必须有 digest 和 readable 状态。`visualPages > analyzedVisualPages`、抽样页、缺图表/附件、OCR 低置信或 unsupported parser 直接生成 `source-evidence-incomplete` 并将 operation 置为 blocked/failed，不能作为 warning 继续。

规则扫描只产生 hint 和 Review 优先级，不定义 coverage 分母。所有 parsed block 都必须可见、classification 和审计；context 是 classification 而非 disposition，不能用于吞掉未经 Reviewer 确认的 normative-looking block。

### 9.2 Analyzer 输出约束

Requirement Analyzer 必须返回：

- 每个 source block 的唯一 classification/reason，以及每个 normative anchor 的主 disposition；
- Requirement 的稳定 local key、statement、kind、scope、source anchor IDs；
- Acceptance 的稳定 local key、所属 Requirement、required、原始 statement、source anchor IDs；
- AcceptanceScenario 的稳定 local key、所属 Acceptance、required `category`、preconditions、trigger、expected outcomes、observableAt、explicit/inferred 和 source anchor IDs；
- Decision 的 question、options、impact、affected Requirement local keys、source anchor IDs，并为每个 option 返回受影响维度、对象 local key、derivation、依据 anchor 和 `potentiallyChangesDelivery`；
- inference 的依据 anchor；
- deferred/out-of-scope 的 reason。

Service 按 local key 解析成持久化 ID，并为每个需要业务 target 的 normative Anchor 生成 exact-one-or-more SourceDispositionBindingRecord。模型不能返回数据库 ID，也不能把 Task acceptance 反向登记为原始 AcceptanceCriterion。

### 9.3 确定性门禁

- source block classification 100%，`uncertain=0`；normative anchor disposition 100%；需要业务 target 的 normative anchor 全部拥有类型相容、current-operation 的 SourceDispositionBinding closure；
- required Acceptance 必须属于 active in-scope Requirement；
- Acceptance statement 不能只复制 Task 动作；
- required AcceptanceScenario 的 precondition/trigger/outcome/observableAt 完整，且 inferred 内容通过 Requirement Review；
- `decision_effect_precheck` 必须覆盖每个 Decision option；option/影响对象不完整或任意 option 可能改变 required delivery 时按 conservative default 阻塞并停止 candidate 链路；Decision 解决后重算；
- Binding Review 后必须生成 final effect；precheck/final 任一 current effect blocking 时都不能 candidate/approval，人工 cosmetic 例外必须有逐 option 审计记录；
- duplicate 目标存在且不能形成环；
- sourceRef/anchor 均属于本次 manifest；
- revise 必须给被替换对象和保留对象明确映射；
- repair 后仍有未分类 block、uncertain block 或未 disposition normative anchor 时直接 blocked。

## 10. Repository Context Snapshot

### 10.1 Snapshot 构建顺序

```text
canonicalize root
  -> resolve repository identity
  -> capture Git commit/tree/dirty state
  -> load exclusion and size policy
  -> run mandatory baseline providers
  -> run applicable semantic providers
  -> normalize and persist evidence
  -> build RepositoryStackProfile
  -> evaluate release support boundary
  -> compute completeness
  -> compute repositoryDigest
  -> freshness recheck
```

开始和结束各采集一次 Git/worktree digest。两次不一致说明扫描期间仓库变化，snapshot 标记 stale 并重试一次；再次变化返回 `409 repository-changing`，不能构造混合时点 snapshot。

### 10.2 Provider SPI

```ts
interface RepositoryContextProvider {
  readonly id: string
  readonly version: string
  readonly requiredFor: RepositoryCapability[]

  supports(context: ProviderProbeContext): Promise<ProviderSupport>
  collect(context: ProviderCollectContext): Promise<ProviderResult>
}

interface ProviderCollectContext {
  canonicalRoot: string
  baseCommit?: string
  fileInventory: ReadonlyArray<InventoryEntry>
  limits: ProviderLimits
  signal: AbortSignal
}

interface ProviderResult {
  status: 'ready' | 'partial' | 'unavailable' | 'failed'
  evidence: EvidenceDraft[]
  commands: VerificationCommandDraft[]
  completeness: Partial<RepositoryCompleteness>
  diagnostics: Diagnostic[]
}
```

Provider 不直接写 Store，也不接收 Requirement 文本。Orchestrator 统一做 path canonicalization、digest、redaction、大小限制和 ID 生成，防止 provider 各自形成不同信任边界。

### 10.3 首版 Provider

| Provider | 级别 | 产出 | 失败语义 |
| --- | --- | --- | --- |
| filesystem | 强制 | inventory、规则文件、语言/目录分布 | failed 阻止 planning |
| manifest | 强制 | package/build scripts、workspace、依赖和声明命令 | partial 可继续，但无命令不得假装可验证 |
| test | 强制 | 测试文件、框架、邻近测试、受控命令 | critical verification 缺口 blocked |
| TypeScript AST | TypeScript 项目强制 | exports、imports、classes/functions、call/reference edge | 不可用时 partial；critical owner 未覆盖则 blocked |
| Vue/Nuxt | 检测到项目时强制 | pages/routes、server handlers、composable、SFC script symbols | parser 缺失时 partial，不做脆弱字符串猜测 |
| Prisma | 检测到 schema 时强制 | model/enum/relation/migration/schema owner | semantic parser 缺失时 partial，data requirement 不得 ready |
| Graphify | 可选增强 | 模块图、调用关系、provenance | stale/unavailable 不阻断其他 provider，但不能作为 ready evidence |

实现依赖选择：

- TypeScript provider 使用 Compiler API，因此发布包必须把 `typescript` 从 devDependency 调整为 runtime dependency，或把 provider 拆为随包安装且有启动自检的可选组件。首个正式启用 TypeScript provider 的版本必须选择其一，不能假设生产环境存在开发依赖；
- Vue SFC 使用稳定 parser 接口，parser 未安装时明确 `provider-unavailable`；
- Prisma 首版可以提供 schema 文件和 migration inventory，但在没有可靠语义 parser 时不得生成高置信 relation；
- 不为减少依赖临时手写不完整的 TypeScript、Vue 或 Prisma grammar。

### 10.4 Graphify freshness

Graphify 只在满足以下条件时进入 active evidence：

- graph metadata 的 repository identity 与当前 root 一致；
- commit 或 source digest 与 snapshot 一致；
- path 全部通过 root canonicalization；
- node/edge 保留 `EXTRACTED`、`INFERRED`、`AMBIGUOUS` provenance；
- graph provider version 进入 repositoryDigest。

缺 metadata、旧 commit 或源文件 digest 不一致时 provider 状态为 `stale`。旧图可显示为诊断，但 Binding Agent 的 search/read 不返回它。

### 10.5 Repository completeness

```ts
interface RepositoryCompleteness {
  inventory: 'complete' | 'partial' | 'missing'
  policy: 'complete' | 'partial' | 'missing'
  manifests: 'complete' | 'partial' | 'missing'
  symbols: 'complete' | 'partial' | 'missing'
  routes: 'complete' | 'partial' | 'not_applicable' | 'missing'
  schemas: 'complete' | 'partial' | 'not_applicable' | 'missing'
  statePaths: 'complete' | 'partial' | 'unknown'
  consumers: 'complete' | 'partial' | 'unknown'
  tests: 'complete' | 'partial' | 'missing'
  commands: 'complete' | 'partial' | 'missing'
}
```

是否可继续不是一个全局布尔值，而是由 Requirement 的适用影响维度决定。例如纯文档改动不要求 Prisma semantic completeness；涉及数据模型的 critical Requirement 在 schemas partial 时必须 blocked。

此外，V3 candidate 还要求 RepositoryStackProfile=`supported`。`partial` 可用于 shadow、诊断或人工补 Provider，`unsupported` 返回 `409 unsupported-stack`；二者都不得因局部 inventory 完整而进入 ready。

## 11. Evidence Gateway

### 11.1 受控检索协议

Binding Agent 和 Planner 不再获得通用 `read/glob/grep`。Service 内部使用以下只读 adapter 契约；其中 `EvidenceSummary/EvidenceDetail` 的数据库 ID 只在 Service 内部和审计记录中存在，模型 wire 看到的是 stage-attempt-scoped opaque handle：

```ts
search_repository_evidence({
  snapshotId,
  query,
  kinds?,
  pathPrefixes?,
  limit
}) -> EvidenceSummary[]

read_repository_evidence({
  snapshotId,
  evidenceIds
}) -> EvidenceDetail[]
```

约束：

- snapshotId 由 Service 注入，模型不能替换；
- 搜索只返回 active snapshot 中已持久化、非 restricted 的 evidence；
- 单次和整轮有 evidence 数、字符数、工具调用数和 token budget；
- 所有查询、内部返回 ID、模型 handle 和读取 ID 映射写入 planning audit；
- 模型输出只能引用本 stage attempt 已实际 `read` 的 handle；Service exact resolve 后才在领域记录中保存 Evidence ID；
- `task_plan` 的 evidence handle 必须逐字等于 current PlanningPromptReferenceManifest 注入的 ref，未注入、跨 attempt、kind mismatch 或只 search 未 read 一律拒绝；
- path、symbol、command 文本仅用于展示，模型领域引用使用 opaque handle，持久化领域引用使用 Service 解析后的 ID；
- 无结果必须显式返回，不自动扩大到 root 外或 excluded path。

### 11.2 检索策略

首版采用可复现的混合检索：

1. kind、path prefix、symbol 和 tag 精确过滤；
2. token/identifier overlap 排序；
3. import/call/schema/route edge 一跳展开；
4. 同目录邻近 test 和 manifest command 提升；
5. stable ID 作为相同分数的最终排序。

向量检索不是 P1 必需项。后续引入时只能改变召回排序，不能绕过 snapshot、freshness、访问和引用校验。

### 11.3 证据不足

Agent 可以请求 `evidence_gap`，包含缺少的 kind、可能 path scope 和影响的 Requirement。Service 只允许：

- 运行已注册但尚未执行的 provider；
- 扩展受控 inventory 范围；
- 请求人工确认代码 owner；
- 将 binding 标记 partial/blocked。

Service 不允许 Agent 直接给出一个快照外 path 作为“补充 evidence”。

## 12. RequirementCodeBinding

### 12.1 Binding 输入

- active Requirement、Acceptance、AcceptanceScenario、Decision；
- current PlanningPolicySnapshot 和 active MUST constraints；
- source anchor 和 disposition；
- current RepositoryContextSnapshot；
- current RepositoryStackProfile；
- provider completeness；
- 受控 Evidence Gateway；
- impact dimension 目录和 binding prompt version。

Binding 阶段不接收团队成员或容量信息，避免为了“有人可做”而扭曲代码 owner。

### 12.2 Binding 过程

1. 根据 Requirement kind、Acceptance scenario 和关键词生成适用影响维度候选；
2. 检索 domain owner、current behavior 和邻近测试；
3. 沿数据写入、状态推进、消息/异步、API/consumer 和读路径做有限深度扩展；
4. 对每个维度输出 required/not_applicable/unknown、evidence IDs 和 reason；
5. Service 校验 evidence 属于 snapshot 且 agent 实际读取过；
6. Service 运行确定性 completeness validator；
   - 每个冻结 `eventObservableKey` 必须且只能由一条 chain 覆盖；chain 只能指向所属 Requirement 的唯一 Scenario，且 `assertsAbsence` 必须与冻结 expectation 一致；
   - 每条 chain 必须包含 record/schema owner、持久化集合 owner、读取面 owner、真实 producer/emitter、fixture/assertion evidence 和关联规则；
7. Binding Reviewer 独立检查错误 owner、漏 consumer、漏失败路径和无依据 not_applicable；
8. 最多一次 focused repair；仍有 blocking finding 时 operation blocked。

### 12.3 影响维度规则

| Requirement 信号 | 至少检查 |
| --- | --- |
| 新建/更新/删除业务对象 | domain_owner、write_path、data、state、failure、test |
| 查询/列表/聚合/展示 | read_path、data、api、consumer、test |
| 状态变化 | state、write_path、failure、consumer、test |
| 权限/角色/可见性 | permission、api、consumer、security test |
| MQ/job/webhook/异步 | async、producer/consumer、idempotency、retry/failure、test |
| schema/migration | data、migration、compatibility、rollback、test |
| 对外 API | api、consumer、compatibility、failure、test |
| 性能/容量 | owner、read/write hot path、measurement command、regression test |

规则只决定“必须检查什么”，不决定“代码在哪”。代码位置仍必须由 evidence 证明。

### 12.4 ready 判定

Binding 可以 ready 仅当：

- active required Requirement 都有 binding；
- required AcceptanceScenario 都被至少一个 binding 覆盖；
- active MUST Policy 均映射到 Binding，或具备审计后的 approved_not_applicable；
- 所有适用 required dimension 有 extracted 或有充分依据的 inferred evidence；
- primary owner 唯一或明确表达协同 owner；
- `unknown` 不落在 critical delivery chain；
- snapshot fresh；
- stack profile supported；
- Binding Review 无 blocking finding；
- fabricated/unread evidence count 为零。

## 13. WorkPackage 与 DeliveryTask

### 13.1 WorkPackage 聚合规则

先按以下因素形成候选 WorkPackage：

- 同一业务 outcome；
- 同一 source-of-truth owner；
- 同一事务或状态推进边界；
- 必须一起发布的 schema/API/consumer 兼容链；
- 共享高冲突文件或 migration；
- 可由同一验证闭环证明。

不得只按 Requirement 数量或文件目录聚合。

### 13.2 展开规则

以下任一成立时展开为多个 DeliveryTask：

- 横跨独立 schema、backend、frontend、async consumer 或 release owner；
- 存在必须先落地的 migration/API contract；
- 高风险变更需要独立实现和验证；
- 单任务预计修改范围超出 policy 上限；
- 可以独立并行且 conflict keys 不重叠；
- 一个任务无法给出单一、可执行 testCommand 或验证策略；
- Reviewer 必须与 implementer 独立。

以下情况保持单任务：

- 同一 owner 内的小型原子修改；
- 拆分会导致两个任务都无法独立验证；
- 修改必须处于同一事务/迁移提交；
- 额外任务只是在重复同一 acceptance。

### 13.3 Planner 输出契约

V3.3 Planner 契约只能输出交付语义 local key 和 PlanningPromptReferenceManifest 注入的 opaque ref；wire/storage 仍使用 `planningContractVersion=3`：

```ts
interface GeneratedPlanV3 {
  summary: string
  status: 'ready' | 'blocked'
  blockedReasons: Diagnostic[]
  workPackages: GeneratedWorkPackage[]
  tasks: Array<{
    key: string
    workPackageKey: string
    title: string
    kind: TaskKind
    relationship: TaskRelationship
    description: string
    requirementKeys: string[]
    acceptanceKeys: string[]
    scenarioKeys: string[]
    decisionKeys: string[]
    policyConstraintRefs: string[]
    bindingKeys: string[]
    evidenceClaimRefs: string[]
    dependencyKeys: string[]
    verificationCommandRefs: string[]
    completionCriteria: string[]
    risk: Risk
    contextPack: {
      objective: string
      whyNow: string
      inScope: string[]
      outOfScope: string[]
      requirementStatements: string[]
      currentBehaviorClaimRefs: string[]
      targetBehavior: string
      startingPoints: Array<{ evidenceRef: string; reason: string }>
      expectedChangeSurfaces: string[]
      forbiddenChangeSurfaces: string[]
      dependencies: Array<{ taskKey: string; reason: string; completionRequired: boolean }>
      invariants: string[]
      verificationSteps: Array<{
        scenarioKey: string
        action: string
        expectedObservable: string
        commandEvidenceRef?: string
      }>
      expectedArtifacts: string[]
      escalationConditions: string[]
      unknowns: Array<{ question: string; blocking: boolean; owner: string }>
    }
    changeContract: GeneratedChangeContract
  }>
}
```

GeneratedPlanV3 使用 strict/closed Schema：对象层级全部 `additionalProperties=false`，数组/文本/unknown 数量有上限。`GeneratedChangeContract` 只能引用冻结 Binding 中的 bounded-context/surface local key、impact dimension 和 conflict relation，不能包含 raw path；Service 将其解析为真实 allowed/excluded path scope，Planner 只能缩小，不能扩大。以下字段禁止出现在模型输出：Agent ID、Squad ID、Runtime ID、role/capability requirement、绝对路径、快照外 path、任意 shell command、任何数据库持久化 ID，以及不在 current PlanningPromptReferenceManifest 中的 ref。模型即使返回语法有效的业务 ID 或 Capability ID 也必须 schema reject，不能当作“建议”静默采用；只有 Service 将已注入 opaque ref 解析后，Proposal Record 才保存内部 Policy/Evidence/Command ID。

Planner 输出只写入 WorkPackageProposal、TaskProposal、TaskContextPack 和 PlanningProposalPack，不是可执行 Task。Service 在 `reference_mapping` 冻结本 operation 的 local key -> reserved ID；在 `capability_requirement_derivation` 生成 CapabilityRequirementDraft；Plan Review approved 后冻结 Catalog 并在 `assignment_qualification` 生成 AssignmentDraft；`task_preflight` accepted 后必须先运行 `decision_effect_finalization`。只有 current precheck/final effect 都存在且 non-blocking，final commit 才一次物化正式 WorkPackage、CapabilityRequirement、AssignmentDecision、Task 和 PlanSnapshot。任何 blocked/rejected/clarification proposal 或 blocking/stale Decision effect 都不得留下正式业务记录。

### 13.4 Service 校验

- 所有 local key 唯一且可解析；
- Requirement、Acceptance、Scenario、Decision、Binding local key 均来自本次冻结输入；Policy、Evidence、Command ref 必须由 current PlanningPromptReferenceManifest exact resolve，且其 artifact digest current；
- required AcceptanceScenario 保持实施与验证双覆盖；
- 每个 applicability 已决的 active MUST 在 `policy_fulfillment` 中恰有一条记录：applicable 必须 exact-one-or-more 映射到同一 ReferenceMap 的 reserved Task/Verification，approved-not-applicable 必须有审计且执行映射为空；
- 每个 Task 至少有一个 Requirement、Scenario、Binding、EvidenceClaim 和可验证 completion criteria；
- 每个 TaskContextPack 的 objective、scope、starting point、target behavior、expected artifact、verification、escalation 均完整，blocking unknown 必须使 proposal blocked；
- allowed scope 必须由 Binding evidence/claim 派生，Planner 只能缩小或请求 review，不能扩大；
- dependency DAG 无环，且 `relationship` 进入 proposal/task/capability digest，不允许从 title/kind 事后推断；
- `verification/review/release` 在适用时依赖对应 implementation，migration 先于受其影响的读写，release 晚于 required verification；独立 review 的 executingAgentId 不得等于被审 implementation owner；
- conflict keys 与 path scope 冲突一致；
- critical Task 有独立 review 任务或 reviewer policy；
- ready plan 中不存在任何 `blocksPlanning=true` 的 unresolved Decision；
- blocked plan 不物化可执行 Task 或 current candidate pointer。

Planner 输出通过上述校验后，Service 才根据 Binding、PlanningRiskProfile、impact dimension、Task relationship 和版本化 derivation rules 写入 CapabilityRequirementDraftRecord。CapabilityRequirement 无法映射到 active CapabilityDefinition 时 operation blocked；不得回调 Planner 让它“换一个现有成员会的能力”。Plan Review 校验 proposal/context pack/capability draft grounding；通过后再冻结 ProjectCapabilityCatalogSnapshot/ProjectAccessGrantSnapshot、生成 AssignmentDraft 并执行 TaskPreflight；只有 Service verdict accepted 后继续生成 final Decision effect。正式 CapabilityRequirement 和 Task 兼容投影只在两阶段 Decision effect 均通过的 final commit 物化。

## 14. Plan Review

### 14.1 确定性检查优先

在调用 Reviewer 前先运行：

- source disposition coverage；
- Requirement/Acceptance/Scenario/Decision 引用完整性；
- AcceptanceScenario executability 和 implementation/verification 双覆盖；
- PlanningPolicySnapshot current、active MUST disposition 和 Task/Verification mapping；
- RepositoryStackProfile supported；
- EvidenceClaim support/contradiction、Binding completeness 和 freshness；
- DAG、parallel group 和 conflict key；
- TaskContextPack 的 scope、starting point、unknown、artifact 和 verification 完整性；
- task size/path scope/command 引用；
- Service-derived CapabilityRequirementDraft grounding；
- CapabilityRequirementDraft 对 active CapabilityDefinition 的 grounding 完整性；
- reviewer independence；
- duplicate outcome、空壳 task、所有 Acceptance 塞入少量 task 的异常检测；
- migration/compatibility/rollback 的适用性检查。

确定性 error 不交给 LLM“解释通过”。

### 14.2 Reviewer 检查

Reviewer 关注确定性规则难以表达的问题：

- 业务交付链是否完整；
- code owner 是否被任务正确承接；
- TaskContextPack 是否让合格候选无需重新发现需求边界即可开始，且不泄漏快照外内容；
- 任务描述是否可执行而非泛化；
- task boundary 是否过大、过碎或跨越不合理 owner；
- dependency 是否符合真实状态/数据先后；
- completion criteria 是否可观察；
- testCommand 是否能证明 AcceptanceScenario 的 observable outcome，而不只是运行任意测试；
- MUST Policy 是否真正体现在 scope、实现责任和验证中；
- role/capability 是否由 Service 的 Binding/规则推导，而非 Planner 套用通用标签；
- 失败、迁移、兼容、回滚和 consumer 是否被漏掉；
- 风险等级和独立 review 是否合理。

Reviewer 只能引用 Requirement、Binding 和 Evidence ID。发现 Requirement 问题时 finding 必须使用 `repairOwner='requirement'`、`restartStage='requirement_analysis'`，不能在 Task 描述中补一个未经批准的业务假设。

### 14.3 Repair

首版每个 review kind 最多一次自动 repair，并遵守单调 operation 分流：

```text
review round 1
  -> no blocking: approve
  -> stage-local finding: same operation new attempt -> deterministic validate -> review round 2
  -> upstream subject finding: terminal current operation -> unique successor operation
  -> source/decision/team/repository blocker: blocked
  -> no-op/cycle/same fingerprint at max attempt: blocked
```

`PlanningRepairAttemptRecord` 保存 finding set、input/output subject revision、result review、policy、attempt 和 successor lineage。所有 round/attempt 保留；operation 不能在 nonterminal repair 时推进。`resolved` 必须有新 subject digest、确定性校验和后续 non-blocking review，不能仅靠 repair Agent 自报。UI 展示原 finding、修复对象、是否新开 successor、最终状态，不能只显示“已自动优化”。

## 15. Assignment 与 TaskPreflight V3.3

### 15.1 三层模型

Assignment 明确分为：

```text
Structural Eligibility
  -> Ranking / Selection
  -> TaskPreflight
  -> Approval Eligibility
  -> Dispatch Status
```

#### Structural Eligibility 硬门禁

- active project membership；
- Project Role 覆盖 Service-derived required role；
- 当前 ProjectCapabilityCatalogSnapshot 中存在覆盖 required capability 的 active trusted AgentCapabilityClaim；
- domain/repository access 满足；
- Agent 状态允许分派；
- Runtime 类型存在兼容绑定；
- Squad 路由满足 leader/member policy；
- reviewer independence 满足。

任何硬门禁失败都记录稳定 reason code，例如：

```text
role-missing
capability-missing
capability-claim-missing
capability-claim-untrusted
repository-access-missing
runtime-incompatible
membership-inactive
reviewer-not-independent
squad-leader-unavailable
```

Persona、Skill 文本、显示 role、legacy 自由字符串 capability 和历史自然语言输出不得用于通过硬门禁。Capability ID 名称相等但没有 active `human_confirmed/managed_registry` claim 时仍是 ineligible。

#### Ranking

仅对 eligible 候选计算：

```text
score = primaryRoleMatch(source=role/claim records)
      + capabilityCoverage(source=claim IDs)
      + domainAffinity(source=affinity claim IDs)
      + repositoryAccessPreference(source=access records)
      + reviewerSeparationPreference(source=review policy)
      - activeLoadPenalty(source=capacity snapshot)
      - recentFailurePenalty(source=verified run history)
```

首版每项使用固定整数权重和稳定 policy version，且将 source record IDs 与 value/weight 一并写入 AssignmentDecision。相同分数按 target type、target ID 排序只适用于低风险、低置信 tie-break；高/critical 同分且没有可信 differentiator 必须 `assignment-owner-ambiguous`，不能把排序当成正确 owner。历史质量数据只有在样本量和口径可信后才启用，避免早期偏差成为硬资格。

#### Dispatch Status

- `dispatchable`：Runtime online、有 capacity、无 conflict；
- `waiting_runtime`：兼容 Runtime 已绑定但暂时不健康，可恢复等待；
- `waiting_capacity`：owner 已选中但当前 slot 为零；
- `waiting_conflict`：受同计划 path/conflict key 限制；
- `blocked_runtime`：不存在兼容 Runtime；
- `blocked_access`：执行环境无法访问仓库。

### 15.2 Agent 与 Squad

- Planner 不知道候选是 Agent 还是 Squad；
- Planner 不知道候选拥有哪些 capability，也不能为了候选可用性改变 CapabilityRequirement；
- V3.3 首版允许 Squad 作为路由目标，但 AssignmentDraft 必须在审批前选定属于该 Squad 的唯一 `executingAgentId`；
- Squad 的结构资格由绑定成员和 leader policy 计算，实际执行 Agent 还必须独立通过当前 Task 的结构硬门禁和 TaskPreflight；
- 选择 Squad 只表示路由给 leader，不表示 leader 或整个 Squad 已执行；leader 的 Preflight 不能替代执行成员；
- leader 路由只创建 `SquadCoordinationRecord`；coordination 不是 TaskRun，不计为 required output，也不能完成 DeliveryTask；
- TaskRun.agentId 必须严格等于 AssignmentDecision.executingAgentId，coordinationId 仅为 provenance；禁止创建 leader TaskRun 代理实际成员执行；
- leader 若要改派其他成员，必须在无 active run 时创建新的 AssignmentDecision、SquadCoordinationRecord，并由新成员完成新的 TaskPreflight；旧 assignment/preflight/dispatch stale，在此之前不得 claim TaskRun；
- 动态“运行时才选成员”的 Squad 延后到独立 `SquadPreflight + DelegatedAgentAssignmentDecision + DelegatedAgentTaskPreflight` 契约完成后启用，首版失败关闭；
- Squad 没有合格成员时不能靠 leader persona 通过；
- Squad capacity 和 Agent capacity 分别记录。

### 15.3 TaskPreflight

每个 AssignmentDraft 在 approval 前必须确定 `executingAgentId`，并由该 Agent 读取冻结的 TaskContextPack 和其有权访问的 Evidence，返回 `accepted | needs_clarification | rejected`、理解后的 objective、starting evidence、expected surfaces、verification、missing facts 和 complexity。Preflight 是语义交接验证，不是执行：不得修改 Task objective/scope/dependency/verification、不得写仓库、不得把候选偏好反向变成 capability requirement。

- `accepted`：候选能指出从哪里开始、要改变什么、不能改变什么、如何验证及何时升级；
- `needs_clarification`：存在可定位的需求、Binding、TaskContextPack 或 team 事实缺口，按 root cause 回到拥有该事实的 stage 并产生新 revision；
- `rejected`：任务与候选资格、访问、真实 owner 或风险策略不相容，旧 AssignmentDraft/Preflight 保持历史；
- candidate、context pack、repository/claim digest 任一变化时旧 Preflight stale；
- selected target、routing Squad 或 `executingAgentId` 任一变化时旧 Preflight stale；
- `needs_clarification/rejected` 不能由人工把状态直接改成 accepted，只能修复上游事实后重跑。

### 15.4 approvable、dispatchable 与等待

V3.3 采用以下产品语义：

- 没有结构合格 owner、未确定唯一 `executingAgentId`、该 Agent 的 required Preflight 未 accepted、`blocked_runtime` 或 `blocked_access`：Plan `blocked`，不可审批；
- executing Agent 已选中且其 Preflight `serviceVerdict='accepted'`，但处于 `waiting_capacity` 或可恢复 `waiting_runtime`：Plan 可审批但独立 Dispatch 不创建 Run；
- owner 已选中、Service verdict accepted 且 `dispatchable`：可审批；随后独立 Dispatch 重校验并启动；
- `waiting_dependency` 只由已批准 DAG 的执行进度派生，不参与初次审批资格；`waiting_conflict` 是已批准计划执行期等待，不作为初次审批时的任务正确性替代；
- UI/API 必须把“可批准”“可 dispatch”“团队不具备交付资格”分开显示；
- 人工 override 只能在候选本来结构 eligible 时改变排序结果，不能绕过 role/capability/access/reviewer/Preflight 硬门禁。

### 15.5 Digest

Assignment digest 包含：

- Task ID/revision、CapabilityRequirement digest 和 risk；
- team composition 和 membership source；
- CapabilityDefinition version、active Claim ID/source/status 和 catalog digest；
- Runtime compatibility identity，不包含瞬时 heartbeat；
- structural eligibility、selected target、routingSquadId、executingAgentId 和 policy version；
- terminal AssignmentEvaluation ID/digest，且其 selected target/routing/executing 字段与 draft exact match；
- TaskContextPack digest、TaskPreflight ID/agentReportedStatus/serviceVerdict/check/digest；
- override actor/reason/risk。

瞬时 capacity 和 online 状态进入 `capacityObservation`，不导致已批准计划因正常负载波动永久 stale；但执行前必须重新计算 dispatch status。

## 16. Approval 与执行衔接

### 16.1 Approval gate

`createPlanApproval` 对 V3 增加：

```text
current snapshot is candidate and V3
AND operation committed
AND every normative RequirementSourceProfile is complete
AND source manifest current, all blocks classified, uncertain=0
AND every normative anchor has one disposition and exact compatible SourceDispositionBinding closure when a target is required
AND requirement/scenario category/decision resolution digest current
AND SourcePolicyPrecheck, inherited RepositoryPolicyBaseline and Decision option/precheck effect current
AND requirement review approved and current
AND every required Acceptance has exactly one current CoveragePolicy with all 7 category dispositions
AND CoveragePolicy uncertain=0, N/A audit valid, aggregate digest/riskDerivationInputDigest current
AND ScenarioCoverageReview current, approved, independence valid and every required category has an executable Scenario
AND PlanningRiskProfile current and required categories equal CoveragePolicy union
AND repository snapshot fresh and RepositoryStackProfile supported
AND CanonicalTargetBinding unique/current
AND PlanningPolicySnapshot current, preserves source precheck, repository Policy fixed point converged, all active MUST resolved
AND critical EvidenceClaims supported, current and not disputed
AND binding complete and current
AND binding review approved
AND Decision final effect current after TaskPreflight and derived from full current drafts
AND TaskContextPack and relationship complete/current for every task
AND PlanningPromptReferenceManifest current and every Planner ref exact-resolved
AND every resolved active MUST has exact-one current PolicyFulfillment; applicable MUST maps to non-empty Task/Verification over the frozen PlanningReferenceMap, approved-not-applicable MUST has audit and empty execution mappings
AND CapabilityRequirementDraft grounded before plan review
AND plan review approved
AND ProjectAccessGrantSnapshot current and required read grants present
AND baseline every carry item has exact-one current valid disposition/CarryValidation
AND CarryValidation aggregate equals committed PlanSnapshot (empty digest for non-repair)
AND exactly one terminal AssignmentEvaluationRecord for every executable proposal, matching AssignmentDraft/Decision selected target, executingAgentId and draft digest
AND required Scenario implementation coverage == 100%
AND required Scenario verification coverage == 100%
AND no unresolved Decision where precheck or final planningEffect.blocksPlanning == true
AND every CapabilityRequirement is grounded in active CapabilityDefinition
AND ProjectCapabilityCatalogSnapshot current
AND every task has selected structurally eligible assignment and executingAgentId
AND every selected Agent capability is backed by an active trusted Claim
AND every required TaskPreflight serviceVerdict is accepted and current for that executingAgentId
AND no blocked runtime/access/no-candidate/high-risk ambiguity
AND reviewer independence satisfied
AND source-disposition/source-policy/repository-policy-baseline/target/access/evaluation/review/risk/claim/prompt-reference/context/preflight/plan/policy/policy-fulfillment/stack/capability/team/assignment digests current
AND PlanningReferenceMap is frozen and reference closure is complete
```

PlanApprovalRecord 保存所有 V3 gate digest、access grant 和 canonical target binding。任何 mismatch 返回 `409 plan-stale` 和具体 stale dimensions，不自动重新规划或部分批准。`waiting_capacity` 和可恢复 `waiting_runtime` 不使 `approvable=false`，但 Approval 必须冻结当时的 executionDispatchStatus；`blocked_runtime/access`、无 eligible candidate、high/critical owner ambiguity 或 Preflight Service verdict 非 accepted 均使 `approvable=false`。Approval command 在任何状态下都不得创建 TaskRun 或启动执行。

### 16.2 Execution dispatch gate

`createExecutionDispatch` 是独立幂等命令；它读取 current PlanApprovalRecord 并再次验证：

- approved snapshot 仍是 Project current pointer；
- Project approvedRevision 和 current revision 一致；
- PlanningPolicySnapshot、CapabilityCatalog 和 Assignment digest 仍 current；
- RepositoryPolicyBaseline、Policy fixed point、PolicyFulfillment 和 PlanningPromptReferenceManifest 仍 current；
- Task revision 与 assignment decision 一致；
- terminal AssignmentEvaluation 的 selected target、routing/executing Agent 和 draft digest 与 AssignmentDecision 仍完全一致；
- TaskRun agent 必须等于 AssignmentDecision.executingAgentId；Squad leader 改派时必须先产生新 AssignmentDecision 和该 Agent 的 current accepted Preflight；
- Runtime compatibility、current ProjectAccessGrantSnapshot 与 canonical target binding 仍满足；
- TaskPreflight `serviceVerdict` 仍 current/accepted；
- Service 从 approved DAG、current Task/Verification 状态计算 requested set 的 runnable frontier；前置未完成的 Task 返回 `waiting_dependency`，不得创建 Run；
- 任一 requested Task stale/blocked 时整个命令返回 409、写 0 Run，不自动重新审批；没有硬失败时只为 frontier 中 `dispatchable` Task 创建 Run，capacity/runtime/conflict 以逐 Task soft-wait 保留；
- 全部启动返回 201 `started`；部分启动返回 201 `partially_started`；没有启动且均为 soft wait 返回 202 `waiting`；每个结果都给出稳定 reason 和 next observation；
- `createdTaskRunIds`、started taskResults 和新 TaskRun 在同一原子/可补偿临界区 exact-one 闭合；
- `(projectId,idempotencyKey)` 唯一，同一 `taskId+taskRevision` 没有 active TaskRun 唯一性冲突；
- 当前 workspace drift 可由计划内已完成前置 Task 解释。

### 16.3 规划基线与执行演进

PlanSnapshot 的 repositoryDigest 表示规划基线 `R0`。执行后仓库自然变为 `R1...Rn`，不能因为前置 Task 的合法提交就让所有后续 Task stale。

执行前使用 `ExecutionImpactGuard`：

1. 计算当前 base commit 与 `R0` 的差异；
2. 减去同一 approved plan 中已完成依赖 Task 的已验证 changedFiles；
3. 剩余外部 drift 若触及未开始 Task 的 binding owner、allowed scope、command 或 conflict key，阻止 claim 并创建 `repository-drift` Decision；
4. 不相关 drift 记录 warning 和 digest，允许继续；
5. 无法确定影响时失败关闭，不能仅按文件名不相等就忽略。

### 16.4 TaskRun claim 与 settle

- 每个 attempt 新建 TaskRun，不覆盖历史；
- claim 需要 `taskId + taskRevision + assignmentDecisionId + claimVersion`；
- 同一 Task revision 最多一个 active run；当前适配器用 serialized claim，数据库实现必须加唯一约束；
- run 冻结 planning snapshot、repository baseline、actual base commit、assignment 和 prompt digest；
- 完成后检查 changedFiles 是否满足 changeContract；
- out-of-scope policy 为 fail 时失败，review 时进入人工 review，不静默接受；
- VerificationEvidence 必须引用 run、task revision、plan snapshot、AcceptanceScenario 和实际 observable result；
- retry 使用同 Task revision 和新 AssignmentDecision/TaskRun；若 Task contract 改变则创建新 taskRevision，不作为 retry 覆盖。

### 16.5 Delivery Convergence 与关闭门禁

当同一 approved PlanSnapshot 的所有 required TaskRun 和 VerificationEvidence 完成后，Service 先进入 `integrating`；只有 `DeliveryIntegrationSnapshotRecord.status=ready` 且固定 clean `finalCommit` 后，才进入 `final_repository_snapshot` 和 Convergence：

1. Service 校验每个 required TaskRun 恰好有一条 output，从 immutable commits 重算 diff/patch/blob-mode，按 DAG/sequence/tree continuity 完成 ancestor 或 patch-hunk-postimage proof；duplicate 指向先前 verified evidence，`no_code_change` 要求 diff 为空及审计，`manual_resolution` 仍需 proof；target CAS matched 且 clean 后固定 `finalCommit`；
2. Service 冻结 final RepositoryContextSnapshot `Rf`，并复核扫描前后 digest 一致；
3. 重新构建 RepositoryStackProfile，复核原 Binding 指向的 owner、consumer、失败路径和测试面在 `Rf` 中仍成立；
4. Convergence Reviewer 逐条比较 Requirement、AcceptanceScenario、active MUST Policy、批准 Task/changeContract、VerificationEvidence 与 `Rf`；
5. 确定性规则先发现缺 Scenario evidence、stale verification、scope 外 changed surface 和 Policy violation；Reviewer 再判断 unmet、partial 和 unrequested semantics；
6. 无 blocking finding 时写 `status=converged`；否则写 `changes_required`，并创建引用 finding 的新 `revise` PlanningOperation；
7. Service 只有在 current convergence digest 与 final repository/verification/specification digest 一致且 status=`converged` 时，才能把 Delivery 标记 `delivered`。

Plan Review 和 Convergence Review 使用不同 record/kind/prompt/version。前者回答“计划是否足以开始”，后者回答“最终代码是否满足规格且没有计划外行为”。Repair 不能在 approved snapshot 上追加 Task；新 revise operation 必须走完整的 snapshot、policy、binding、plan、capability、assignment、approval、execution 和 convergence 链路。

### 16.6 Delivery Integration stage

TaskRun 可以在隔离 worktree 成功，但交付仍必须经过 `integrating`：Service 为 approved plan 创建 `DeliveryIntegrationSnapshotRecord`，按 Task DAG 逐一登记 TaskRun base/head/diff/patch ID、集成前 parent、结果 tree 和 inclusion evidence，执行 in-place、merge、cherry-pick 或受审计的人工/no-code 处理，并通过 target ref CAS 在唯一 canonical repository target 上得到 clean `finalCommit`。任何冲突、目标 ref 移动、未集成 output、缺 inclusion proof、伪造 no-code、把 manual resolution 当 proof、错误顺序/tree discontinuity 或多仓库 target 都是 blocked/stale；不得由 Convergence 直接读取某个 worktree 代替集成。

## 17. API 契约

### 17.1 规划命令

保留现有 decompose/append/revise 路由，扩展请求参数：

```http
POST /projects/:projectId/decompose
POST /projects/:projectId/decompositions
POST /projects/:projectId/decompositions/:bundleId/revise
Content-Type: application/json

{
  "planningContractVersion": 3,
  "idempotencyKey": "client-generated-key",
  "repositoryRefresh": "if_stale",
  "modeSpecificFields": {}
}
```

响应使用 operation，而不是把 Project 的 `decomposing` 当作全部进度：

```json
{
  "operationId": "planning-op-...",
  "projectId": "project-...",
  "status": "running",
  "stage": "reserved",
  "planningContractVersion": 3
}
```

HTTP `202` 表示已接受异步规划，不表示 plan ready。

MetricPolicy 由受限治理 API 发布；普通项目查询只能读取 current/history：

```http
POST /admin/planning-metric-policies/publishes
{
  "scopeProjectId": "project-... | null",
  "version": "v3.3-metrics-1",
  "supersedesId": "... | null",
  "metrics": ["...validated metric definitions..."],
  "idempotencyKey": "..."
}
```

Service 计算 requestDigest/policyDigest；201 返回新 immutable policy，same key/request 返回原 command/policy；不同 key 但 same version/digest 返回 200 原 policy 与 replayed_existing command且不推进 head；version/digest 或 idempotency 冲突返回 409。无 update/delete endpoint。

Release report 由受限 `POST /admin/planning-metric-release-reports` 创建 immutable PlanningMetricReleaseReportCreateRecord；request 只含 scope/project、releaseId、metricPolicyId、frozen operationIds/observationIds 和 idempotencyKey，不接受 numerator/denominator/window/threshold 覆盖。Service 先计算 requestDigest 并按 `(scopeKey,idempotencyKey)` 重放/冲突，再复核所有 observation 的 policy 三元组、重算 reportInputDigest，并按 canonical report key=`(scopeKey,releaseId,metricPolicyId)` 创建或 replay immutable report。same command key/same request 返回原 command/report，same command key/different request 返回 409；different key/same canonical input 写 replayed_existing command。查询 API 不接受临时 denominator/window 覆盖。

审批与执行使用两个命令：

```http
POST /projects/:projectId/approvals
{
  "planSnapshotId": "...",
  "planDigest": "...",
  "projectRevision": 12,
  "accessGrantSnapshotId": "...",
  "accessGrantDigest": "...",
  "canonicalTargetBindingId": "...",
  "canonicalTargetBindingDigest": "...",
  "idempotencyKey": "..."
}

POST /projects/:projectId/execution-dispatches
{
  "approvalId": "...",
  "expectedProjectRevision": 12,
  "taskIds": ["..."],
  "idempotencyKey": "..."
}
```

Approval 成功返回 201 PlanApprovalRecord，且响应中 TaskRun 数必须为 0。Dispatch 全部可启动时返回 201 `started`；可运行前沿部分启动时返回 201 `partially_started`；没有 Task 可启动且全部为 dependency/Runtime/容量/conflict soft wait 时返回 202 `waiting`；三者都返回逐 Task result，只有 started result 带 TaskRun ID。任一 requested Task stale、access/target/assignment/preflight blocked 或硬 uniqueness 冲突返回 409，整个命令创建 0 Run。

### 17.2 查询 API

```http
GET /projects/:projectId/planning
GET /projects/:projectId/planning-operations
GET /projects/:projectId/planning-operations/:operationId
GET /projects/:projectId/planning-metric-policy
GET /projects/:projectId/planning-metric-policies
GET /projects/:projectId/planning-metric-release-reports?releaseId=...
GET /admin/planning-metric-release-reports?scopeKey=global&releaseId=...
GET /admin/planning-metric-release-report-creates?scopeKey=...&idempotencyKey=...
GET /projects/:projectId/planning-shadow-evaluations
GET /projects/:projectId/source-manifest
GET /projects/:projectId/source-profiles
GET /projects/:projectId/source-disposition-bindings
GET /projects/:projectId/source-policy-precheck
GET /projects/:projectId/repository-policy-baseline
GET /projects/:projectId/acceptance-scenarios
GET /projects/:projectId/acceptance-scenario-coverage-policies
GET /projects/:projectId/scenario-coverage-reviews
GET /projects/:projectId/decision-planning-effects
GET /projects/:projectId/planning-risk-profile
GET /projects/:projectId/planning-policy
GET /projects/:projectId/policy-fulfillments
GET /projects/:projectId/repository-context
GET /projects/:projectId/repository-stack-profile
GET /projects/:projectId/canonical-target-binding
GET /projects/:projectId/evidence-claims
GET /projects/:projectId/requirement-bindings
GET /projects/:projectId/planning-proposal
GET /projects/:projectId/planning-prompt-reference-manifests
GET /projects/:projectId/task-context-packs
GET /projects/:projectId/work-packages
GET /projects/:projectId/planning-reviews
GET /projects/:projectId/capability-catalog
GET /projects/:projectId/capability-requirements
GET /projects/:projectId/access-grant-snapshot
GET /projects/:projectId/assignment-evaluation-fixtures
GET /projects/:projectId/assignment-evaluations
GET /projects/:projectId/assignment-decisions
GET /projects/:projectId/task-preflights
GET /projects/:projectId/approvals
GET /projects/:projectId/execution-dispatches
GET /projects/:projectId/squad-coordinations
GET /projects/:projectId/delivery-integration
GET /projects/:projectId/delivery-integration/inclusion-evidence
GET /projects/:projectId/delivery-convergence
GET /projects/:projectId/delivery-convergence/findings
GET /projects/:projectId/delivery-convergence/repair-baselines
GET /projects/:projectId/delivery-convergence/repair-carry-items
GET /projects/:projectId/delivery-convergence/carry-validations
```

审计 API 另提供 `GET /projects/:projectId/planning-operations/:operationId/{stage-attempts,repair-attempts,evidence-accesses,source-anchors,assignment-drafts,affinity-snapshots}`；Grant 管理员可查询 `GET /projects/:projectId/resource-access-grants`，writer lease 只通过 `GET /admin/workspace-writer` 暴露 identity/token/owner/health，绝不返回 OS lock handle。普通规划聚合通过 sourceCoverage/assignment/preflight/provenance 摘要暴露这些内部记录的 current IDs、counts、diagnostics；无权限用户不能枚举原始 evidence access 或 grant scope。

`GET /projects/:projectId/planning` 返回 UI 使用的聚合视图：

```ts
interface ProjectPlanningView {
  projectId: string
  planningContractVersion: 'legacy' | 2 | 3
  operation?: PlanningOperationSummary
  metricPolicy: { version: string; digest: Sha256 }
  shadowEvaluation?: PlanningShadowEvaluationSummary
  planHealth: {
    approvable: boolean
    executionDispatchStatus:
      | 'dispatchable' | 'partially_dispatchable' | 'waiting_dependency'
      | 'waiting_runtime' | 'waiting_capacity' | 'waiting_conflict' | 'blocked'
    topIssues: PlanningGateSummary[] // 最多 3 条，按 blocking/impact 排序
    requiredUserAction?: PlanningAction
    taskCount: number
    dependencyCount: number
    waitingTaskCount: number
  }
  sourceCoverage: SourceCoverageSummary
  sourceProfiles: RequirementSourceProfileSummary[]
  sourceDispositionBindings: SourceDispositionBindingSummary[]
  scenarios: AcceptanceScenarioSummary[]
  sourcePolicyPrecheck?: SourcePolicyPrecheckSummary
  repositoryPolicyBaseline?: RepositoryPolicyBaselineSummary
  decisionOptionEffects: DecisionOptionEffectSummary[]
  decisionPrecheckEffects: DecisionPlanningEffectSummary[]
  decisionFinalEffects: DecisionPlanningEffectSummary[]
  requirementReview?: PlanningReviewSummary
  riskProfile?: PlanningRiskProfileSummary
  policy?: PlanningPolicySummary
  policyFulfillments: PolicyFulfillmentSummary[]
  repository: RepositorySnapshotSummary
  stackProfile?: RepositoryStackProfileSummary
  canonicalTarget?: CanonicalTargetBindingSummary
  evidenceClaims: EvidenceClaimSummary[]
  requirements: RequirementBindingSummary[]
  proposal?: PlanningProposalSummary
  promptReferenceManifest?: PlanningPromptReferenceManifestSummary
  workPackages: WorkPackageSummary[]
  tasks: TaskPlanningSummary[]
  capabilityCatalog?: ProjectCapabilityCatalogSummary
  accessGrantSnapshot?: ProjectAccessGrantSummary
  assignmentEvaluations: AssignmentEvaluationSummary[]
  assignments: AssignmentSummary[]
  taskPreflights: TaskPreflightSummary[]
  approval?: PlanApprovalSummary
  latestDispatch?: ExecutionDispatchSummary
  squadCoordinations: SquadCoordinationSummary[]
  deliveryIntegration?: DeliveryIntegrationSummary
  inclusionEvidence: IntegrationInclusionEvidenceSummary[]
  gates: PlanningGateSummary[]
  convergence?: DeliveryConvergenceSummary
  repairBaseline?: ConvergenceRepairBaselineSummary
  actions: PlanningAction[]
}
```

聚合层只组合领域判断，不在客户端重新计算 eligibility、coverage、approvable 或 dispatchable。`topIssues` 由 Service 按 severity、critical path 和用户可修复性排序并截取 3 条；完整 gate 保留在详情，不用首屏隐藏失败事实。

### 17.3 恢复和人工动作

```http
POST /projects/:projectId/planning-operations/:operationId/retry
POST /projects/:projectId/repository-context/refresh
POST /projects/:projectId/planning-policy/:constraintId/confirm
POST /projects/:projectId/requirement-bindings/:bindingId/confirm
POST /projects/:projectId/planning-reviews/:reviewId/resolve
POST /projects/:projectId/capability-claims/:claimId/confirm
POST /projects/:projectId/resource-access-grants
POST /projects/:projectId/resource-access-grants/:grantId/revoke
POST /projects/:projectId/access-grant-snapshot/refresh
POST /projects/:projectId/task-preflights/:preflightId/retry
POST /projects/:projectId/delivery-integration/start
POST /projects/:projectId/delivery-integration/:snapshotId/resolve-conflict
POST /projects/:projectId/delivery-convergence/run
POST /projects/:projectId/delivery-convergence/:reviewId/create-repair-plan
POST /projects/:projectId/replace-plan
```

- retry 只从可重试的 failed/blocked root stage 创建新 operation 或新 stage attempt；
- repository refresh 创建新 snapshot，不覆盖旧 snapshot；
- binding confirm 需要 actor、reason、evidence IDs 和风险说明，不能只提交一个 path 字符串；
- policy confirm 需要 actor、authority、scope、disposition 和 reason；确认仓库规则时创建新的 constraint seed/baseline 并由 successor 重算，不能原地修改旧 baseline/Policy；不得在 UI 中用一个通用“忽略”动作处理 MUST；
- delivery integration 只允许对 approved plan 操作，必须使用冻结 CanonicalTargetBinding/expected head；no-code/manual resolution 记录 actor/reason，但仍由 Service 重算 diff/patch/tree inclusion evidence，不允许直接标 integrated；finalize 对 target ref 做 CAS；
- capability claim confirm 只能确认已映射到 active CapabilityDefinition 的 pending claim，并生成新 catalog snapshot；
- grant create 是不可变授权记录，过期由 expiresAt 派生；revoke 创建唯一 immutable RevocationRecord、不改原 grant/scope；revoke 与 refresh 共用 serialized/CAS 边界，snapshot time 之前 committed 的 revocation 必须排除 grant，之后的 revocation 生成下一 snapshot 并 stale 当前 dispatch/run，refresh 原子冻结 current grant IDs/digest。Integration Service grant 需管理权限，Agent grant API 拒绝 canonical_integrate；
- review resolve 只能处理允许人工确认的 finding；任何 `blocksPlanning=true` 的 Decision 仍走 RequirementDecision API；
- TaskPreflight retry 只能在上游新 revision 或可恢复依赖恢复后创建新 attempt，不能原地修改 status；
- convergence run 必须在 required runs/verification 完成并集成到 clean finalCommit 后冻结新的 final snapshot；create-repair-plan 是幂等命令，重复调用返回同一 revise operation；
- replace-plan 是旧计划进入 V3 的显式操作，必须展示将 supersede 的 snapshot。

### 17.4 Evidence API 限制

默认 API 只返回 evidence metadata、短 excerpt、digest 和 provenance。完整 evidence read：

- 仅用于当前 workspace 有权用户；
- 按 evidence ID 获取，禁止任意 path 参数；
- restricted/redacted 内容不返回原文；
- 记录访问审计；
- 响应限制条数和字节数。

### 17.5 API 兼容

- 现有 `/team-plan`、`/plan-snapshots`、`/requirements`、`/requirement-decisions` 保持；
- V2 的 `/approve` 和 `/execute` 可保持旧语义；V3 的旧 `/approve` 只能作为 `/approvals` 的 approval-only 兼容别名，旧 `/execute` 只能作为 `/execution-dispatches` 别名，任何 V3 路径都禁止调用 `approveAndStartExecution` 或在 approval handler 内创建 TaskRun；
- V2 Project 返回原 DTO，新增字段 optional；
- V3 客户端遇到 V2 snapshot 显示 `legacy_plan`，不调用 binding detail；
- ShadowEvaluation 使用独立 API/DTO，不出现在 `/plan-snapshots`、approval 或 execution 响应；
- `/requirements`、`/requirement-decisions`、assignment 和默认 planning 聚合只返回 current committed Plan 引用的数据；shadow/blocked/failed child records 仅能通过显式 `operationId` 或 ShadowEvaluation API 查询；
- API 聚合响应始终包含归一化的 `planningContractVersion`；持久化记录缺省时返回 `legacy`，客户端不得根据其他字段猜版本；
- 新错误使用稳定 code，message 可本地化但不能作为程序分支依据。

## 18. 错误与状态语义

### 18.1 HTTP 错误

| HTTP | 场景 | 示例 code |
| --- | --- | --- |
| 400 | 参数、schema、非法 ID、超限输入 | `invalid-planning-request` |
| 409 | 业务阻塞、stale、并发、状态冲突 | `planning-in-progress`、`plan-stale`、`repository-changing` |
| 502 | provider、LLM、Runtime 等依赖失败 | `repository-provider-failed`、`planner-unavailable` |
| 500 | 存储、恢复或未预期内部错误 | `planning-commit-failed` |

业务 blocked 的异步 operation 可以由查询返回 `200` 和 `status=blocked`；发起时已经同步发现不可接受状态则返回 `409`。两者都不能包装成 ready/success。

### 18.2 稳定 diagnostic code

至少定义：

```text
source-block-unclassified
source-classification-uncertain
source-classification-review-required
source-disposition-invalid
source-disposition-binding-missing
source-disposition-binding-mismatch
source-evidence-incomplete
requirement-review-blocking
acceptance-scenario-incomplete
acceptance-scenario-category-missing
source-policy-precheck-unresolved
planning-risk-profile-invalid
planning-policy-unresolved
planning-policy-precheck-weakened
repository-policy-replan-required
repository-policy-nonconvergent
policy-fulfillment-missing
policy-fulfillment-duplicate
policy-fulfillment-invalid
planning-policy-violation
repository-root-invalid
repository-changing
repository-provider-unavailable
repository-provider-stale
repository-completeness-insufficient
canonical-target-invalid
canonical-target-stale
canonical-target-multiple
unsupported-stack
evidence-outside-snapshot
evidence-not-read
evidence-redacted
evidence-claim-unsupported
evidence-claim-disputed
binding-owner-missing
binding-impact-incomplete
binding-review-blocking
decision-pending-blocking
decision-effect-incomplete
task-coverage-incomplete
task-context-incomplete
task-relationship-invalid
task-scope-invalid
task-command-untrusted
planner-reference-invalid
plan-review-blocking
capability-mapping-unresolved
capability-claim-missing
access-grant-missing
access-grant-stale
access-grant-revoked
access-grant-revocation-conflict
assignment-evaluation-missing
assignment-evaluation-incomplete
assignment-evaluation-owner-mismatch
assignment-no-eligible-candidate
assignment-owner-ambiguous
assignment-executing-agent-missing
assignment-runtime-blocked
assignment-access-blocked
task-preflight-check-failed
task-preflight-needs-clarification
task-preflight-rejected
task-preflight-stale
plan-approval-stale
execution-dispatch-waiting
execution-dispatch-waiting-dependency
execution-dispatch-partially-started
execution-dispatch-blocked
execution-dispatch-conflict
plan-stale
task-revision-stale
repository-drift
workspace-writer-active
workspace-writer-fenced
planning-lease-lost
planning-repair-lineage-conflict
planning-commit-failed
delivery-convergence-required
convergence-repair-baseline-stale
convergence-finding-dropped
carry-validation-missing
carry-validation-duplicate
carry-validation-invalid
carry-subject-changed
carry-binding-closure-changed
carry-verification-input-changed
carry-final-commit-unreachable
carry-target-missing
carry-disposition-invalid
delivery-integration-required
delivery-integration-conflict
delivery-integration-stale
delivery-integration-inclusion-unverified
delivery-integration-sequence-invalid
delivery-integration-tree-discontinuous
delivery-integration-target-moved
```

Diagnostic 同时包含 stage、subject ID、severity、message、canonical `restartStage`、`repairOwner` 和可选 evidence IDs。用户动作根据 code 映射，不从 message 猜 root cause。

### 18.3 取消

用户取消 running operation 时：

1. 设置 abort signal；
2. 停止后续 provider/LLM 调用；
3. operation 标记 aborted；
4. 清理仅由该 operation 持有的未引用 child；
5. 不回滚已存在的旧 current plan；
6. 若恰在 commit 临界区，先依据 Project pointer 判定是否已经 committed，再返回最终状态。

## 19. 安全设计

### 19.1 路径与文件边界

- 使用 `realpath` 固定 canonical root；
- inventory 中的 symlink 必须解析后仍位于 root 内，否则排除并记录；
- 默认排除 `.git`、`node_modules`、build output、cache、binary、大文件和 vendor tree；
- 默认拒绝 `.env*`、私钥、credential、token cache、系统 keychain 和用户目录其他文件；
- provider 只能读取 inventory 允许的 path；
- 绝对路径只在 server 内部使用，API/LLM 使用 root-relative path；
- 单文件、总文件、excerpt、evidence 数量和扫描时长均设硬上限。

### 19.2 Prompt injection

仓库代码、注释、README、Issue 文本和依赖内容均视为不可信数据：

- 以结构化 tool result 提供，不拼接成 system instruction；
- 明确标注 source、kind、provenance 和 content boundary；
- 代码中的“忽略上级指令”“读取 secret”等文本仅作为 excerpt；
- AGENTS.md/项目规则作为 `policy` evidence 单独分类，但仍由 Service 决定可授予的工具和路径；
- 模型输出的工具请求经过 schema、snapshot 和配额校验；
- 模型不能请求 shell 或网络；
- 发现 prompt-like 内容不自动删除代码证据，但记录 injection diagnostic 并限制其 instruction 权限。

### 19.3 Secret redaction

Evidence 正规化阶段扫描常见 key/token/private-key 形态：

- 命中内容用固定占位符替换，digest 分别保存原文件 digest 和 redacted excerpt digest；
- 原 secret 不进入 LLM prompt、日志、API 或 diagnostics；
- secret scanner 不承诺发现所有敏感信息，因此路径 allowlist/denylist 是第一道边界；
- restricted evidence 可用于“文件存在/类型”判断，不能读取内容；
- 测试必须包含恶意文件名、symlink escape、`.env`、私钥和注释注入样本。

### 19.4 命令安全

- Command 使用 `argv[] + cwd`，不接受 Planner 返回 shell string；
- 只运行 manifest/规则/管理员 allowlist 派生的命令；
- 默认无网络、有限环境变量、超时、输出上限和子进程终止；
- probe 与 baseline 分开记录；
- 含 install、publish、deploy、migration apply、数据写入或 destructive flag 的命令不得自动 baseline；
- 发布、部署、GitHub Release 和 npm publish 不属于规划命令，仍需要独立授权和发布流程。

## 20. 性能与资源预算

### 20.1 Snapshot 缓存

Repository snapshot 缓存 key：

```text
rootIdentityDigest
+ trackedTreeDigest
+ dirtyDigest
+ providerSetVersion
+ exclusionPolicyVersion
```

命中完整 key 可以复用 immutable snapshot。只要 dirtyDigest 或 provider version 变化就不能复用旧 evidence；不得只用 `HEAD` 判断工作区未变。

### 20.2 增量策略

P1 首版允许全量 inventory、按适用 provider 扫描。稳定后可增加：

- fileDigest 未变复用 file/symbol evidence；
- import/schema/route edge 的受影响闭包重建；
- append/revise 只重做受 Requirement 和 repository diff 影响的 binding；
- provider output digest 相同复用 Review 输入；
- 任何增量不确定性都退到全量重建，不退到旧 snapshot ready。

### 20.3 默认上限

首版上限通过配置暴露并写入 policy version，建议起始值：

| 项目 | 默认 |
| --- | --- |
| inventory 文件数 | 50,000 |
| 单文件可读大小 | 1 MiB |
| 单 evidence excerpt | 8 KiB |
| snapshot evidence 数 | 100,000 |
| Agent 单次 search 结果 | 50 |
| Agent 整轮 read evidence | 500 |
| provider 单次超时 | 120 秒 |
| repository snapshot 总超时 | 10 分钟 |
| Binding 自动 repair | 1 次 |
| Plan 自动 repair | 1 次 |

超过上限返回 partial/blocked 和明确 diagnostics，不无界读取，也不静默截断后标 complete。

### 20.4 LLM token budget

- Requirement、Binding、Planner、Reviewer 分开预算；
- 先传 summary/ID，按需 evidence read；
- 相同 snapshot 的 evidence detail 可以缓存，但每轮保留实际 read audit；
- 大 Requirement 分批 binding，最终由 Service 做全局 completeness merge；
- token 截断必须被检测为依赖失败，不能拿半个 JSON 做 partial success；
- 记录 input/output token、tool calls、evidence count、修复轮次和耗时。

## 21. UI 设计契约

本技术设计不规定视觉样式，但规定信息层级和用户动作。

### 21.1 摘要优先与七层下钻

首屏 Plan Health 固定展示：`approvable`、`executionDispatchStatus`、最多 3 个最高影响问题、下一步动作、任务/依赖/等待数量，以及每个 Task 的 objective、owner、scope、verification、risk 和 Preflight Service verdict。不得要求用户先阅读所有 evidence 才能判断计划状态。

详情按七层下钻：

1. **需求与规则**：parsed-block classification、normative disposition、Requirement/Acceptance/categorized Scenario/Decision、Review、SourcePolicy/full Policy、遗漏和待确认；
2. **风险与仓库支持**：PlanningRiskProfile、commit/dirty、RepositoryStackProfile、supported/partial/unsupported、Provider completeness；
3. **代码理解**：每条 Requirement/Scenario 的 EvidenceClaim、owner、影响链、支持/反证、provenance/freshness；
4. **任务计划**：WorkPackage、TaskContextPack、DAG、allowed/forbidden scope、Scenario/Policy coverage、验证命令和 Review finding；
5. **能力、分派与接手**：Service-derived CapabilityRequirement、Definition/Claim/affinity provenance、eligible/rejected candidate、TaskPreflight、owner ambiguity、Runtime/容量/冲突；
6. **审批与执行门禁**：当前是否可审批、是否可 dispatch、blocking/waiting code、root-cause action；
7. **交付集成与收敛**：每个 TaskRun output 的集成方式、canonical target、冲突/stale、clean finalCommit、verification freshness、convergence finding、repair revision 和 delivery close gate。

### 21.2 必须可见的区分

- `approvable`、`dispatchable`、`waiting_capacity/waiting_runtime` 与 `blocked`；
- proposal/draft 与 executable committed record；
- TaskPreflight Agent report 与 Service accepted/needs_clarification/rejected/stale；
- declared command 与 baseline passed；
- extracted/inferred/ambiguous evidence；
- current 与 stale repository snapshot；
- supported/partial/unsupported stack；
- original Acceptance 与 derived Scenario；
- active trusted claim 与 legacy pending mapping；
- V2 legacy plan 与 V3 evidence-grounded plan；
- auto review finding 与人工 override；
- 计划完成与实际 Delivery verified。
- TaskRun/Verification complete 与 Delivery converged。
- TaskRun worktree 成功与 canonical integration ready；`source-evidence-incomplete` 与普通 warning。

### 21.3 用户动作

UI 根据 diagnostic code 提供精确动作：

- 补充或修正 Requirement；
- 补全/确认 AcceptanceScenario；
- 解决所有 `blocksPlanning=true` 的 Decision；
- 确认 MUST Policy authority/disposition；
- 刷新 Repository Snapshot；
- 确认或修正 EvidenceClaim/Code Binding；
- 处理 TaskPreflight clarification/rejection 并从归因阶段创建新 revision；
- 从受影响阶段重新规划；
- 确认 legacy capability mapping，或给项目加入具有 active trusted Claim 的 Agent/Squad；
- 修复 Runtime/access；
- 等待容量；
- 解决 `assignment-owner-ambiguous`（补充受控 affinity claim 或人工确认）；
- 启动/继续 Delivery Integration、解决冲突或 ref stale；
- 显式替换旧计划。
- 运行 Delivery Convergence，或从 finding 创建修复 revision。

不能把所有 blocking 状态都归结为“手工分配 Agent”。

## 22. 兼容、迁移和 feature flag

### 22.1 Schema 兼容

- `planningContractVersion` 使用兼容 `z.union`：历史分支接受缺省，V2 分支接受 `2`，V3 分支强制 `3`；由于历史字段可缺省，不能直接使用只靠该字段的 `z.discriminatedUnion`；
- V2/legacy Schema 保持原字段和校验，不因 V3 新要求读失败；
- V3 必填字段只在 version=3 分支要求；
- 新表为空时旧数据正常初始化；
- storage schema version 做一次幂等升级，但不改写 V2 业务内容；
- `optionalTable` 只用于读取兼容，V3 write 开启前必须启动自检确认所有 V3 table 可写，不能写一半后才发现表缺失。

### 22.2 旧数据策略

- V1/V2 PlanSnapshot、Task、TaskRun 和 evidence 保持只读可追溯；
- 不为旧 Task 创建 fake repository snapshot、binding 或 assignment decision；
- 不为旧交付补写 Scenario、Policy、Capability Claim 或 ConvergenceReview；
- UI 明确显示 `legacy_plan / binding_unavailable / convergence_unavailable`；
- 旧项目执行当前已批准 V2 plan 仍按旧冻结契约；
- 想使用 V3 时执行显式 `replace-plan/replan`；
- append/revise 只有在 base V3 的 scenario/policy/stack/binding/capability digest 完整时才做增量，否则生成完整 V3 replacement；
- capability backfill 仅接受人工或受控目录映射，不从自由文本自动确认。

### 22.3 Feature flag

```text
off       仅 V2
shadow    V2 保持 current；V3 生成 shadow operation 和对比报告，不可审批执行
candidate 新创建/显式 replan 可生成 V3 candidate
default   V3 为默认；V2 只读兼容
```

建议配置同时支持全局默认和 per-project override，并在 PlanSnapshot 记录实际模式与 policy version。V3 在 `candidate/default` 下失败时返回真实 blocked/failed，不能自动降级 V2。

### 22.4 Shadow 隔离

- shadow operation 使用 `publicationMode=shadow` 和 `status=shadow_completed`；允许写入归属于同一 `operationId` 的 SourceProfile、Manifest/Anchor、Requirement/Acceptance/Scenario/Decision effect、Review/Risk、Repository Snapshot、Policy、EvidenceClaim/Binding、Proposal/ContextPack、ReferenceMap、Capability/Assignment draft 和 Preflight 规划事实，并最终写 `PlanningShadowEvaluationRecord`；child 的 publication mode 从 owning operation 派生，不复制第二份状态；
- shadow 不创建正式 PlanSnapshot、WorkPackage、CapabilityRequirement、AssignmentDecision 或 DeliveryTask，不设置 Project.currentPlanSnapshotId，不改变 current requirement/decision pointer、Project.taskIds、delivery status、容量或执行队列；
- 项目级默认 Requirement/Decision/Assignment/Planning 查询必须从 current committed Plan 的引用闭包读取，不得按 `projectId` 全表聚合 shadow/blocked/failed child；查看 shadow 必须显式提供 `operationId` 或调用 ShadowEvaluation API；
- shadow proposal/draft/preflight 不进入正式 assignment 查询、审批 gate、Dispatcher 或 TaskRun 恢复；
- shadow assignment draft 不占 capacity；
- 对比报告只读，不进入 plan-snapshots API 或审批 gate；
- convergence shadow 只能对隔离的已完成测试交付运行，不改变 Project delivery status，也不自动创建 repair Task；
- shadow 记录可按 retention policy 清理，但评测样本和 digest 保留。

### 22.5 回滚

- 关闭 V3 新写，历史 V3 记录继续可读；
- 未提交 operation 终止并按 Saga 清理；
- current V3 candidate 保持只读且标 planning unavailable，不自动指回 V2；
- 回滚 Project pointer 必须是显式管理命令，记录 actor、from/to snapshot、reason；
- 已 approved/started 的 V3 TaskRun 按冻结 contract 继续、等待或人工取消；
- 数据表和字段采用 forward-compatible 保留，不在应用回滚时删除；
- provider 故障不影响历史计划和 evidence 查询。

## 23. 可观测性

### 23.1 结构化事件

每个 PlanningOperation 至少产生：

```text
planning.operation.reserved
planning.stage.started
planning.stage.completed
planning.stage.blocked
planning.stage.failed
planning.review.completed
planning.capability_requirement_derivation.completed
planning.capability_catalog_snapshot.completed
planning.commit.started
planning.commit.succeeded
planning.commit.failed
planning.recovery.completed
delivery.integration.started
delivery.integration.output_integrated
delivery.integration.conflict
delivery.integration.stale
delivery.integration.ready
delivery.convergence.started
delivery.convergence.completed
delivery.convergence.changes_required
```

事件 metadata 包含 operation/project/stage、版本、输入/输出 digest、duration、record counts 和 diagnostic codes，不写 PRD 全文、代码 excerpt 或 secret。

### 23.2 指标

- source block classification/uncertain/hinted-context-review ratio 和 normative disposition ratio；
- explicit acceptance traceability；
- required Scenario executability、implementation/verification coverage；
- MUST Policy resolution、not-applicable 和 violation rate；
- stack support status/reason 和 unsupported false-ready；
- provider status/duration/evidence count/digest churn；
- repository snapshot stale/retry rate；
- PlanningRiskProfile level/dimensions、策略命中和 required depth；
- EvidenceClaim supporting/contradicting、confidence、disputed/rejected；
- Binding completeness by impact dimension；
- evidence search/read count 和 fabricated/unread reject count；
- review finding、repair 和 blocked rate；
- WorkPackage expansion、TaskContextPack completeness、Task size、scope 和 DAG 指标；
- CapabilityRequirement derivation coverage、unresolved mapping、Claim source/status 和 pending legacy mapping；
- structural eligible/rejected count；
- dispatchable/waiting/blocking 分布；
- assignment override rate；
- assignment evaluation coverage、terminal outcome/reason provenance、selected-owner accuracy、abstention recall/precision、false-abstention、expected-owner recall@k、owner ambiguity 和 low-confidence tie-break；
- TaskPreflight agent report/Service verdict/check failure/stale、first-pass acceptance 和 rejection；
- task start without clarification、first-run completion、human task rewrite、task rework 和 time-to-usable-plan P50/P95；
- planning commit conflict 和 recovery orphan count；
- reference map key/ID closure、reserved ID collision、materialization rollback/recovery orphan count；
- TaskRun duplicate claim、retry、reassignment、scope violation；
- convergence unmet/partial/unrequested/policy/stale-verification finding、repair revision 和 false-converged；
- delivery integration output coverage、conflict/stale、canonical finalCommit 和未集成阻塞率；
- Gold precision/recall、false-ready、rerun stability 和 human edit ratio。

平均指标不得覆盖关键不变量。例如总体 binding recall 达标时，只要一个 critical Requirement owner 缺失，仍然必须 blocked。

### 23.3 日志关联

统一关联字段：

```text
projectId
planningOperationId
metricPolicyId
metricPolicyVersion
metricPolicyDigest
metricReleaseReportId
planSnapshotId
repositorySnapshotId
repositoryStackProfileId
policySnapshotId
planningRiskProfileId
requirementId
acceptanceScenarioId
evidenceClaimId
bindingId
proposalPackId
workPackageId
taskId
taskPreflightId
taskRevision
assignmentDecisionId
taskRunId
deliveryConvergenceReviewId
```

对用户显示短 ID；日志和 Store 使用完整 ID。跨阶段错误必须能够从 operation 追到输入 digest 和 child records。

## 24. 测试设计

测试分成契约正确性、状态与一致性、语义质量三类。三类均通过前不能声称 V3 好用。

### 24.1 Schema 和纯函数单元测试

#### MetricPolicy

- numerator/denominator/eventStart/eventEnd/sampleCohort/projectSetDigest/minimumSampleSize/sampleWindow/exclusions/aggregationAlgorithm/percentileMethod/canaryThreshold/releaseThreshold 全部进入 policyDigest，任一字段变化生成新 digest/version；
- 固定 duration/ratio/count fixture 逐项断言 exclusion 后分母、minimum sample gate、`nearest_rank` P50/P95 和 threshold 结果；输入顺序变化结果稳定；
- registry/publish command 验证派生 scopeKey、连续 scopeRevision、previous-head CAS、同 scopeKey version 唯一、same request 幂等、different key/same version+digest replay 不推进 head、same version different digest 409、supersedes=current、published update/delete 拒绝；并发发布最多一条成为 head；
- 无 global head 时 reserve 失败；project head 优先于 global，无 project head 回退 global；global 后续发布不漂移已有 project override；
- Operation reserve 与 publish 并发时线性化冻结唯一 current metricPolicyId/version/digest；新版本发布后旧 operation 重放仍用旧三元组；
- ReleaseReport create command 的 `(scopeKey,idempotencyKey)`/requestDigest 重放与冲突确定；different key/same canonical input 只新增 replay command；global/admin 与 project history 均可读取；
- immutable ReleaseReport 的 operation/observation/reportInputDigest 与 policy 三元组一致；同 release old/new policy 分组并列，跨 policy 混算、same canonical key different digest、update/delete 均拒绝；
- legacy policy migration 只能生成明确新 immutable published version，不能补默认值后冒充旧 digest；
- Gold fixture registry 的 repository/team/MetricPolicy/responsibilityKey 唯一、外键/digest/真值拷贝一致；重复、mismatch、事后 mutation 和 critical denominator 漏样本失败关闭。

#### Source Manifest

- normative profile 每个 parsed block 恰有一个 Anchor/classification，未命中关键词的普通陈述也在分母；
- 功能、业务规则、验收、Decision、权限、失败、NFR、migration、rollback 只产生 hint，不预筛 block；
- table/list/numbering/duplicate/long paragraph 稳定 inventory；
- classification 缺失/uncertain、normative anchor 无 disposition 拒绝；context 命中 hint 但无 Reviewer 拒绝；
- duplicate 无目标、环、跨 manifest 拒绝；
- deferred/out-of-scope 无 reason 拒绝；
- Manifest Anchor 不允许保存未来业务 target ID；Requirement Analysis 后需要 target 的 normative Anchor 必须有类型相容的 SourceDispositionBinding，missing/duplicate-kind/cross-operation/mismatched target digest 拒绝；
- PDF locator 和 Markdown section path 稳定。
- normative PDF 抽样视觉页、缺附件、OCR 低置信或 unsupported parser 生成 `source-evidence-incomplete` 并 blocked；完整 text/visual coverage 才能 `status=complete`；profile digest 变化使下游 stale。

#### AcceptanceScenario 与 Policy

- requirement_analysis 只产 seed Scenario；Decision precheck 读取 seed，Risk/CoveragePolicy 原子产出后才进入 scenario_completion/review，stage 顺序不可跳过；
- 每个 required Acceptance 恰一 CoveragePolicy，七个 category 各一 disposition；happy_path 必须 required，N/A 缺 reason/source、risk hint N/A 缺 reviewer、uncertain 均拒绝；
- CoveragePolicy aggregate digest、riskDerivationInputDigest 和 Risk required-category union 稳定且完全一致；policy/input 变化使 Scenario/Review/Plan/Approval stale；
- required category 缺 Scenario 或 body 字段不全拒绝；coverage repair successor 必须绑定 predecessor baseline 且不得弱化 required disposition，source/Decision 变化才允许 stale+重推；
- 原始 Acceptance 文本保持不变；seed inference 只可由 RequirementReview 确认，completion inference 只可由 ScenarioCoverageReview 确认；
- ScenarioCoverageReview input 绑定 policy/full Scenario/Risk，缺失、stale、non-approved、blocking finding 或 independence violated 均不得进 Repository/commit/Approval；
- seed/completion/category 进入 digest/coverage，旧 fixture `good` 只在 import migration 变成 `happy_path`，持久化 Schema 拒绝 `good`；
- 一个 Acceptance 多 Scenario、一个 Scenario 多观察面和 stable digest；
- MUST/SHOULD authority、scope、applicability、mapped/approved N/A/unresolved；
- MUST 未映射、无 reason 的 N/A 和 Policy digest 变化失败关闭；
- 首轮完整 Policy 发现 repository MUST 时生成单调 RepositoryPolicyBaseline 和唯一 successor；successor 的 SourcePolicy/Decision/Risk digest 包含 baseline；相同 repository/extractor/seed set 第二轮必须 converged 且不再创建 successor；持续 delta 达上限返回 `repository-policy-nonconvergent`；
- PolicyConstraint 在 task_plan 前不含 Task ID；reference mapping 后每个 applicability 已决的 active MUST 恰有 PolicyFulfillment；applicable 分支的 reserved Task/Command missing、duplicate、跨 map、空 verification，not-applicable 分支的非空执行映射/缺 audit，以及任意原地回写 constraint 均拒绝；
- 普通 README 建议不能被关键词误升级为 MUST。

#### Risk、Review 与 EvidenceClaim

- Requirement Review `kind=requirement` 持久化、round、subject digest、stale 和 repair 历史；
- SourcePolicyPrecheck 必须早于 Decision precheck，precheck 禁止直接引用未来 Repository/PlanningPolicySnapshot；successor 只能通过 inherited RepositoryPolicyBaseline 输入仓库规则；完整 Policy delta 创建新 baseline/successor，相同 baseline 必须 fixed-point converged；
- DecisionOptionEffect 覆盖所有 option；precheck 冻结 decision status/chosen option/resolution digest，选择变化不得复用旧 effect；Binding 后 final effect 补全 owner/capability/assignment；人工 cosmetic 例外逐 option 审计；
- PlanningRiskProfile 根据风险只增加 evidence/review/preflight/convergence 深度，不能降低 source/traceability gate；
- critical EvidenceClaim 缺 supporting evidence、有 unresolved contradiction、low confidence 或 disputed/rejected 时阻塞；
- claim 引用 snapshot 外或未 read evidence 拒绝；repository/claim status 变化使 Binding/Proposal stale。

#### Repository Snapshot

- canonical root、relative path、symlink escape；
- trackedTreeDigest、dirtyDigest、provider version 导致 repositoryDigest 变化；
- 扫描前后仓库变化触发 retry/stale；
- provider ready/partial/unavailable/failed 聚合；
- Graphify commit/digest 不匹配标 stale；
- secret path 排除、excerpt redaction、大小和数量超限；
- declared/probe_passed/baseline_passed 不混淆；
- planning snapshot 不能使用 `final_delivery` subject，final snapshot 的 integration ID/finalCommit/baseCommit/clean digest 任一不一致即拒绝；
- TypeScript/Nuxt/Vue/Prisma fixture 得到 supported stack；
- CanonicalTargetBinding 只接受唯一 explicit local branch ref；HEAD/tag/detached/remote/worktree ref 拒绝，binding 变化使 Policy/Binding/下游/approval stale；
- Java/Python/未知框架缺 semantic provider 时得到 unsupported，不产生 ready Binding；
- provider coverage 或 support policy 变化使 StackProfile stale。

#### Binding

- snapshot 外 evidence、未读取 evidence、错误 snapshot ID 拒绝；
- data/state/permission/async/failure/consumer/test 适用性矩阵；
- critical dimension unknown 阻塞；
- `new` Requirement 无落点 evidence 阻塞；
- not_applicable 无依据被 Review 发现；
- repository/requirement/scenario/policy digest 变化使 binding stale。

#### Task/Plan

- local key 映射、非法引用和重复 key；
- WorkPackage 聚合/展开规则；proposal `dependencyKeys` 在 commit 全部解析为正式 `dependencyWorkPackageIds`，跨 operation key 或未解析 key 拒绝；
- GeneratedPlanV3 strict/closed Schema，未知字段、Agent/role/capability/任意 command/数据库 ID 拒绝；PlanningPromptReferenceManifest 中的 opaque ref 可解析，未注入、跨 attempt、kind mismatch、artifact digest stale 的 ref 拒绝；
- TaskContextPack objective/scope/starting point/target/artifact/verification/escalation/unknown 完整性；
- AcceptanceScenario 实施/验证双覆盖；
- 所有 Acceptance 塞进两个泛任务的异常检测；
- Task `relationship` 在 GeneratedPlan/Proposal/Task/Capability digest 中必填；verification/review/release/migration 依赖顺序、独立 Reviewer owner 和 DAG cycle/conflict key 纯函数校验；
- local key -> reserved ID map 完整、重复 key/跨 operation 引用/缺 task map 拒绝；blocked proposal 只保留 proposal/draft，不生成 WorkPackage/CapabilityRequirement/AssignmentDecision/executable Task；commit/recovery 不发生 Task rewrite 或 orphan 污染；
- PromptReferenceManifest 只负责 frozen artifact ref -> ID，PlanningReferenceMap 只负责 new local key -> reserved ID；两类映射混用、数据库 ID 冒充 ref 或 ref 冒充 local key 均拒绝；
- allowed scope 扩大、快照外 path 和未声明 command 拒绝；
- low/medium/high/critical Decision 的 option -> precheck/final `blocksPlanning` 推导；source 看似 cosmetic 但 Binding 后改变 owner/capability 时 final effect 阻塞；无交付影响且有完整审计的 cosmetic Decision 才可继续；
- Planner 返回 role/capability 字段被 Schema 拒绝；
- Service-derived CapabilityRequirement 可追溯到 Binding、Task relationship 和 rule version；
- Capability mapping unresolved 时 blocked，不回调 Planner 改要求；
- Review finding 的 `repairOwner` 与 canonical `restartStage` 分离；所有 restartStage 都属于 PlanningOperationStage，按 canonical ordinal 选最早 stage；不存在的 `policy/risk/repository/human_decision` stage 值拒绝；stage-local repair 可同 operation 追加 attempt，上游 repair 必须 terminal 当前 operation 并幂等创建 successor；no-op/cycle/同 fingerprint 达上限收敛 blocked。

#### Assignment

- role/trusted capability claim/ResourceAccessGrant/runtime/reviewer 硬门禁；root-relative scope、command IDs、symlink/wildcard escape 和 canonical_integrate principal；
- grant/revocation immutable、revoke idempotency/requestDigest/one-per-grant 唯一；revoke 与 snapshot refresh 并发按 serialized/CAS 线性化，撤销前后 snapshot/current/dispatch/run fencing 结果确定；
- Persona/Skill 文本命中不能通过；
- legacy free-text capability 与 Definition 同名但无 active claim 不能通过；
- human_confirmed/managed_registry active claim 可通过，pending/revoked/expired 不可通过；
- Definition/Claim/catalog digest 变化使 assignment stale；
- eligible 但 capacity=0 得到 waiting_capacity；
- 无兼容 Runtime 与 Runtime 暂时 offline 区分；
- deterministic score/tie-break；
- score contribution 必须引用 affinity/claim/history source record；unknown 为中性；高风险同分且无 differentiator 返回 `assignment-owner-ambiguous`；
- Squad leader eligible 但无成员能力时拒绝；
- Squad leader report accepted 但 executingAgentId 未确定/未通过硬门禁/其 Service Preflight 未 accepted 时拒绝；leader 改派使旧 Preflight stale；
- 每个 executable TaskProposal 恰有 terminal AssignmentEvaluation；全量 coverage/reason provenance、selected-owner、abstention recall/precision/false-abstention 按 Gold 纯函数计算；
- selected Evaluation 必须绑定 current AssignmentDraft ID/digest；direct Agent 与 Squad routing 的 selectedTarget/executingAgent/routingSquad closure 分别校验，abstained selection 字段必须全空；Evaluation 与最终 AssignmentDecision owner/draft mismatch 阻止 commit；
- eligible 候选中最终 executing Agent 不在 Gold allowed-owner 集合时 selected-owner 失败，即使正确 owner 位于 top-k；
- override 不能绕硬门禁；team/task/access/target revision 变化使 assignment stale；
- 表驱动逐 TaskPreflightCheckCode 断言 failureDisposition、exact verdict 和 canonical restartStage；未知 missingFactCode 失败关闭到 requirement_analysis；
- 多失败集合的所有排列产生相同 enum-order checks、`rejected > needs_clarification > accepted` verdict、最早 restartStage、verdictInputDigest/preflightDigest；policy/table version 重放结果一致；
- Agent report accepted 但 starting evidence 未 read、surface 越界/命中 forbidden、required Scenario verification 缺失或 missing facts 非空时，Service verdict 必须非 accepted；
- 只有 Service verdict accepted 可 commit/approve；Preflight 不能修改 Task 语义或仓库，全部 check/input digest 变化使其 stale；
- clarification/rejection 按 requirement/binding/plan/team root cause 创建新 revision。

#### Delivery Convergence

- final repository/verification/specification digest 变化使旧 review stale；
- TaskRun 全成功但漏 consumer、失败路径或 Scenario outcome 时返回 changes_required；
- 实现包含计划外 API/状态行为时产生 unrequested finding；
- active MUST Policy 被违反时产生 policy_violation；
- VerificationEvidence 属于旧 task/repository revision 时产生 stale_verification；
- 完整 finding 集以 `(reviewId,findingSetDigest)` 幂等创建 RepairBaseline/revise operation；baseline 必须是父 canonical finalCommit，finding 不可丢；
- 每个 ConvergenceSubjectType 分别 mutation subject/binding closure/verification input/finalCommit reachability；source-target digest mismatch 必须产生稳定 carry code，carry_current 拒绝，reverify/reexecute/superseded 规则确定；
- Baseline carryItemIds/setDigest 与 immutable carry-item child exact-one 闭合；重复 subject、外键错 baseline、并发/recovery duplicate insert 失败或幂等；
- 普通 operation CarryValidation 空集 digest 稳定；repair 的每个 disposition 都有 exact-one validation；missing/duplicate/stale/invalid 产生稳定 diagnostic，在正式 WorkPackage/Task/PlanSnapshot 物化前阻塞；valid aggregate 写入 operation/PlanSnapshot 并由 Approval 重放；
- 只有 current `status=converged` 才通过 delivery close gate；旧 approved plan/task/run/finding 不可变。
- worktree TaskRun 全成功但未集成 CanonicalTargetBinding、目标 ref 移动或 merge 冲突时分别 blocked/stale/conflict；只有 clean finalCommit 的 ready integration 才收敛。
- source diff/patch/changed blob-mode 必须从 immutable commits 重算；required output 非一一对应、sequence/DAG 不连续、commit parent 或 tree continuity 不连续、duplicate 无先前 proof、no-code diff 非空、manual resolution 无 patch-tree proof、target dirty/CAS mismatch 时不得 ready。

### 24.2 Service 集成测试

至少覆盖：

1. initial V3 完整成功并最后切 Project pointer；
2. Gold 的 Requirement、21 条 Acceptance、对应 Scenario 和 27 个 Decision 全部持久化并逐条 binding；
3. 任一 parsed block 未 classification、uncertain、hinted context 未 Reviewer、normative anchor 漏 disposition，或需要 target 的 anchor 缺/错 SourceDispositionBinding 时 blocked 且 current plan 不变；
4. required Acceptance 缺 `happy_path`/适用 category/完整结构时输出诊断且不能 candidate ready；
5. low/medium/high/critical Decision 只要 `blocksPlanning=true`，能输出诊断但不能 candidate ready；cosmetic non-blocking Decision 不阻止 candidate；
6. MUST Policy 未确认/未映射/缺 PolicyFulfillment，operation blocked 且给出 policy root action；
7. repository provider partial 且缺口不适用时仅允许 shadow/diagnostic；
8. unsupported Java/Python repository 不会被通用文本 evidence 标为 ready；
9. repository provider partial 且 critical schema owner 缺失时 blocked；
10. Binding Agent 伪造 path/evidence ID 被拒绝；
11. Binding Review repair 一次成功；
12. 第二轮仍 blocking，operation blocked；
13. Planner 输出合法格式 Capability ID 仍被拒绝；
14. Plan Review 发现漏 consumer/rollback/Policy 后 repair；
15. CapabilityRequirement 无受控映射时 blocked；
16. Agent 只有同名自由文本 capability、没有 active claim 时零结构候选 blocked；
17. owner 已选中但 capacity=0，可审批并进入 waiting；
18. append 仅添加新 bundle，保留未受影响 Scenario/Policy/Binding 映射；
19. revise supersede 正确，保留未受影响历史；
20. storage 在每个 stage 写入点失败，Project pointer 均不污染；
21. candidate snapshot 写成功、pointer 失败，恢复后无错误 current；
22. pointer 成功、operation 标记失败，恢复补标 committed；
23. 同 idempotencyKey 同 digest 返回同 operation；
24. 同 idempotencyKey 不同 digest 返回 409；
25. 同 host 两个 Service 进程争用 workspace，只有持 OS lock 者可写；锁丢失/fencing token 旧的 mutation、recovery、background settle 全部拒绝；
26. 同 writer 内并发不同 request 只有一个 operation 获得业务 lease；commit 前 project/source-policy/target/access/team/capability/repository 变化返回 stale；
27. V2 项目兼容查询、审批和执行不回归；
28. shadow 不改 pointer、taskIds、capacity 或 delivery status；
29. V3 failed 不回退 V2 candidate；
30. Convergence finding 创建新 revise operation，重复请求幂等；
31. 旧 approved plan/task/run 在 convergence repair 后仍字节级业务不可变；
32. source profile incomplete、抽样 PDF、缺附件时 operation blocked，不能仅 warning；
33. reserved PlanSnapshot/reference map 在 crash、pointer failure、retry 下保持唯一，Task 不被二次 rewrite；
34. 两个同等 eligible owner 的 high-risk Task 返回 `assignment-owner-ambiguous`，补充可信 affinity claim 后才可选择；
35. 多个 worktree output 必须集成同一 canonical finalCommit，遗漏/冲突/ref 移动均阻止 convergence；
36. integration `targetClean=false`、finalCommit 缺失或 output diffDigest 不匹配时 delivery close 必须 blocked/stale；
37. Requirement Review、RiskProfile、EvidenceClaim、ProposalPack、ContextPack 和四类 Review digest 变化正确 stale 下游；
38. blocked/failed/shadow operation 的正式 workPackageIds/taskIds/capabilityRequirementIds/assignmentDecisionIds 为空；
39. Agent report accepted 但 Service identity/evidence-read/scope/scenario/escalation/missing-fact 任一 check 失败时不能 commit/approve；修复上游后新 attempt Service accepted 才可继续；
40. Approval 创建 immutable record 且永远 0 TaskRun；无 runnable Task 的 waiting dispatch 返回 202/immutable dispatch record/0 TaskRun，blocked runtime/access 不可批准；恢复 dispatchable 后新幂等 dispatch 才原子创建 run；
41. final RepositoryContextSnapshot 的 integration ID/exactCommit/baseCommit/clean digest 任一不一致时 convergence blocked；
42. WorkPackageProposal dependency key 在 final commit 解析为稳定 WorkPackage ID，未解析/跨 operation 引用不产生正式记录；
43. 同一 MetricPolicyVersion 分别执行 canary first-run completion >=60% 和稳定发布 >=70% gate，样本不足或混用 policy version 不得通过。
44. Decision precheck/final effect 的 phase、option closure 和 derivation 审计完整；Binding 后新增 owner/capability 影响不能被旧 precheck 绕过。
45. Squad 路由在 commit 前固定唯一 executingAgentId；leader 只创建 SquadCoordinationRecord 且 0 leader TaskRun，TaskRun.agentId 恒等于 executingAgentId；改派后旧 Preflight/dispatch stale。
46. 每个 executable proposal 有唯一 terminal AssignmentEvaluation；Gold selected-owner、abstention recall/precision/false-abstention 和 reason provenance 全部门禁，top-k 不能替代；Squad 的 executingAgentId 而非 routing target/leader 参与 accuracy，Evaluation 与 Draft/Decision mismatch 被拒。
47. Integration 对每个 output 从 commits 重算 diff/patch/blob-mode；DAG/sequence/tree 连续、ancestor 或 patch-hunk-postimage、duplicate/no-code、target clean/CAS 全通过；manual resolution 不替代 proof。
48. Convergence repair baseline 绑定父 finalCommit/review/finding；删除 finding、无依据 carry_current、受影响事实无新 verification/reexecution Task input、后续 Delivery 无对应 Run/Evidence、并发重复 repair 均被拒或幂等。
49. shadow/blocked/failed child 不通过默认 API 泄漏，不参与审批、容量、Dispatcher 或恢复。
50. grant revoke/expire 或 target binding/ref 变化使 assignment/preflight/approval/dispatch/integration stale；active run 下一次 tool/settle 被 fence，普通 Agent 永远不能 canonical_integrate。
51. 未实现 Writer/Approval-Dispatch/Access/Integration/Convergence/Repair 强制门禁时，即使规划/TaskRun 指标达标也不得打开 3080 candidate。
52. 首轮 repository Policy delta 创建唯一 baseline/successor；第二轮相同 seed set fixed-point converged；重复回放不创建第三轮；非确定 seed set 达 max iterations 后稳定 blocked。
53. PlanningPolicySnapshot 在 Task 前保持 immutable；reference mapping 后 PolicyFulfillment exact-one，missing/duplicate/cross-map/reserved ID 未物化一致性失败均阻止 commit/approval。
54. Planner 只能返回 current prompt ref；数据库 ID、未知 ref、跨 attempt ref、kind mismatch 和 stale artifact digest 全部被拒且不写 Proposal。
55. Review finding 使用 canonical restartStage；requirement/policy/repository/team/human-decision repair 均从确定的最早真实 stage 创建 successor，不发生字符串枚举落空。
56. 三层 DAG 请求全部 Task 时只启动首个 runnable frontier，下游返回 waiting_dependency；前置完成后新 key 启动下一 frontier，任何 Task 不得越过 dependency。
57. 同一 frontier 中一个 Task capacity/runtime/conflict 等待、另一个可运行时返回 partially_started，started result/createdTaskRunIds/TaskRun exact-one，等待项 0 Run；硬 stale/blocked 混入时整批 409 且 0 Run。
58. Source Manifest 在 Requirement 前可 accepted 且不含 target ID；Requirement Analysis 写 SourceDispositionBinding 后 closure 通过，append/revise 复用对象时 binding ownership/current-plan 可见性正确。

### 24.3 Execution/TaskRun 测试

- approval-only command 成功后 plan approved、TaskRun/SquadCoordination/容量占用均为 0；
- 独立 dispatch 只在 approval、source-policy/repository-policy-baseline/policy-fulfillment/target/access/assignment/evaluation/TaskPreflight Service verdict 全 current 时启动；
- requested set 按 approved DAG 计算 runnable frontier；前置未完成得到 waiting_dependency，不能越过 dependency；
- frontier 内全部 soft-wait 时写 202 waiting record 且 0 TaskRun；部分可运行时写 201 partially_started，只为可运行项建 Run；全部可运行写 201 started；同 key 重试返回完全相同的 per-task result/run 集，状态恢复后用新 key dispatch；
- requested set 任一 stale/blocked 时整批 409 且 0 Run；createdTaskRunIds 与 started taskResults exact-one，非 started result 不得携带 runId；
- taskRevision/assignment/access/target/TaskPreflight stale 阻止 claim；grant 撤销使后续 tool/settle fenced；
- 两个并发 claim 只产生一个 active run，leader coordination 不产生 TaskRun；
- 合法前置 Task diff 不使后续 Task 全部 stale；
- 外部 drift 触及 binding owner 时阻塞；
- 不相关 drift 记录 warning；
- changedFiles 超出 allowed scope 触发 fail/review；
- retry 创建新 TaskRun，旧 run 不覆盖；
- reassignment 生成新 AssignmentDecision；
- verification evidence 绑定当前 run/task revision/plan/AcceptanceScenario 和 observable result；
- execution start 时 Policy/Capability Claim stale 阻止 claim；
- Runtime offline、capacity、parallel group、conflict 和 workspace 等待分别可恢复；
- settle 时 ownership 已变化，不把旧 run 写成当前成功。

### 24.4 API 和 UI 测试

- 202 operation 与最终 ready/blocked/failed 区分；
- 400/409/502/500 错误契约；
- V2/V3 DTO 兼容；
- evidence detail 不允许 path 任意读取；
- approvable、dispatchable/partially_dispatchable、waiting_dependency/capacity/runtime/conflict、blocked、stale、legacy 文案和动作正确；Approval 与 Dispatch 是两个按钮/状态，审批前 soft waiting 不影响 Approval，执行期仍有 runnable frontier 时允许 Dispatch；
- Approval response/GET approval 永远无 TaskRun；waiting Dispatch 202/0 Run、partially_started 201/逐 Task result、stale 409/0 Run，reason code 可解释；
- Plan Health 只显示最多 3 个主要问题，详情保留完整 gates，窄屏不遮挡 action；
- Source classification/DispositionBinding/Scenario category/SourcePolicy/RepositoryPolicyBaseline/Target/Review/Risk/Policy/PolicyFulfillment/Stack/Claim/Binding/PromptReference/Context/Task relationship/Capability/Access/Evaluation/Assignment/Preflight/Approval/Dispatch/Inclusion/Repair 数据一致；
- 默认项目查询与显式 shadow operation 查询隔离，shadow Requirement/Decision/Assignment 不出现在 current Plan Health、approval 或 execution；
- 刷新 snapshot、解决 Decision、确认 Policy/Claim、重试 stage、replace plan、convergence repair 流程；
- 浏览器 `happy_path`、`business_rejection`、`boundary`、`dependency_failure`；
- 窄屏和大数据列表不遮挡关键 gate/action。

### 24.5 Mutation 与 adversarial 测试

对 Gold 项目自动注入：

- 删除一个 route consumer；
- 修改 Prisma relation；
- 增加隐含权限规则；
- 把失败时状态推进改错；
- 新增异步 consumer；
- 删除邻近测试；
- 修改 manifest command；
- 让 Graphify 指向旧 commit；
- 在注释中加入 prompt injection；
- 创建同名错误 owner；
- 让 Agent persona 声称能力但 capability 为空；
- 让 Agent 自由字符串 capability 与受控 Definition 同名但没有 active claim；
- 让 Planner 返回当前目录中的 capability ID；
- 删除 required Scenario 的 observableAt；
- 增加未映射的 project MUST rule；
- 在首轮 repository Policy 中加入新 MUST，并让 successor 读取同一规则集，验证只产生一次 baseline delta；再让 extractor 对同一输入来回改变 rule set，验证达到上限后 nonconvergent blocked；
- 让 PolicyConstraint 尝试在 Task 创建前保存 Task ID，或删除/重复一个 PolicyFulfillment；
- 让 Planner 返回真实数据库 ID、未知 prompt ref、上一 attempt ref 或错误 kind ref；
- 让 normative Anchor 缺 SourceDispositionBinding、绑定到错误 target type 或另一个 operation；
- 将受支持仓库替换为 Java/Python 文件结构但保留相同需求文本；
- Runtime offline、capacity=0、repo access 丢失；
- 扫描中修改仓库；
- 在 planning commit 每个写点注入失败。
- 让所有 TaskRun/test 成功但删除最终 route consumer 或失败路径；
- 在最终实现中增加规格/计划未授权的 API 或状态变化；
- convergence 后篡改 final repository 或 VerificationEvidence digest。
- 让 Decision precheck 判断 cosmetic，但在 Binding 后让某 option 改变 state owner/capability；
- 让正确 owner 留在 top-k、最终选择另一个 eligible Agent；
- 让 AssignmentEvaluation 选择 leader/旧 executing Agent，但 AssignmentDecision 使用新的 executingAgentId；
- 只让 Squad leader 完成 Preflight，执行成员为空或运行时换人；
- 对三层 DAG 一次请求全部 Task，并让同一 runnable frontier 一个 Task capacity=0、另一个可运行；
- 重复应用 patch、移除 inclusion evidence、伪造 no-code，或用 manual resolution 审计替代 patch/tree proof，或 finalize 前移动 target ref；
- 把 shadow Requirement/Decision/Assignment 注入默认 project 聚合查询。

成功标准不是每次给出相同文字，而是正确 evidence/binding/ready-or-blocked 判定保持稳定。

### 24.6 真实模型评测

每个 Gold fixture 必须按稳定责任键冻结允许的最终 owner 集合：

```ts
interface ExpectedAssignmentFixtureRecord {
  id: string
  projectId: string
  responsibilityKey: string
  repositoryDigest: Sha256
  teamDigest: Sha256
  metricPolicyId: string
  metricPolicyVersion: string
  metricPolicyDigest: Sha256
  expectedOutcome: 'selected' | 'abstained'
  allowedOwnerIds: string[]
  allowedSquadMemberIds: string[]
  expectedAbstentionReasonCodes: string[]
  critical: boolean
  rationaleEvidenceIds: string[]
  fixtureDigest: Sha256
  createdAt: ISODate
}
```

fixture 必须先写入 `expected_assignment_fixtures` registry，在运行前分配 immutable ID/digest 并冻结 selected/abstained 真值和理由；registry 对 project/repository/team/MetricPolicy ID/responsibilityKey 唯一，只读 API 可重放 release report。Gold AssignmentEvaluation 对 fixture ID/digest 建外键并强制真值拷贝一致；fixture mismatch、重复 responsibility key 或事后 mutation 失败关闭。每条评测记录引用并拷贝责任键、critical、allowed owner/Squad member 和 expected reason，fixture digest mismatch 使评测无效。selected 时 allowedOwnerIds 非空，abstained 时为空且有 expected reason。`selected-owner accuracy` 只看最终 executingAgentId；abstention recall/precision/false-abstention 使用全部 fixture，expected-owner recall@k 仅诊断。评测后不得补 owner/reason。

评测集至少包含：

- 当前 `lscity-nuxt` 21 Acceptance/27 Decision 样本；
- 至少两个仍在首版支持边界内、但目录/路由/数据访问结构不同的 TypeScript 项目；
- 一个 Java 或 Python 项目，用于证明 unsupported-stack 失败关闭，而不是纳入“好用”成功样本；
- 小型变更、跨层功能、migration/compatibility、权限/失败路径和异步任务；
- 明确 forbidden plan 和 gold binding/impact chain。

每个固定 revision 运行至少 5 次，记录：

- critical Requirement recall；
- Scenario executability/coverage 和 MUST Policy disposition；
- code-binding precision/recall；
- fabricated/unread evidence；
- plan actionability；
- dependency correctness；
- structural assignment eligibility；
- trusted capability coverage；
- assignment evaluation coverage（全部 executable TaskProposal=100%）和 stable reason/source coverage（100%）；
- selected-owner accuracy（Gold 要求选择的 Task 中 >=90%，critical=100%）；
- abstention recall（>=95%，critical=100%）、precision（>=90%）、false-abstention（<=10%，critical=0）；
- expected-owner recall@k（仅排序诊断，不替代 selection/abstention gate）；
- false-ready；
- false-converged、unrequested behavior detection；
- rerun semantic stability；
- first-pass TaskPreflight acceptance（目标 >= 85%）；
- task start without clarification（目标 >= 80%）；
- first-run completion（canary >= 60%，稳定发布 >= 70%）；
- human task rewrite ratio（目标 <= 20%）；
- task rework ratio（目标 <= 15%）；
- TaskPreflight Service rejection ratio（诊断目标 <=10%，不能替代 assignment abstention gates）；
- time-to-usable-plan P50/P95（首版 gate：P50 <=20 分钟、P95 <=45 分钟，只排除审计过的用户待决策和外部依赖故障时间）；
- human edit ratio（<=20%）。

以上生产/评测指标都带 `MetricPolicyVersion`。同一 release report 不得混用不同 denominator/window；阈值调整必须保留 actor、reason、old/new value 和生效 release，且不能追溯改写历史结果。

模型评测使用真实 provider snapshot 和 Evidence Gateway，不能把 Gold 答案放入 prompt，也不能用 fake analyzer/planner 代替。

### 24.7 发布前命令层次

每个实现阶段先运行相关单测，再运行：

```text
typecheck / lint（项目实际声明的命令）
full unit + integration tests
build
package smoke
clean install smoke
docs check
3080 browser happy-path/business-rejection/boundary/dependency-failure regression
delivery convergence/repair regression
```

命令名称在实现时从 `package.json` 和项目规则确认。设计文档不把未执行命令写成已通过。

## 25. 实施顺序

实施单位是可运行纵切，所有阶段保持 `planningContractVersion=3`。

### Phase 0：Baseline 与真实用户样本

交付：

- 冻结 Gold repository revision、PRD、team catalog、expected assignment allowed-owner 集合与接手 rubric；
- 建 expected Requirement/Scenario/Binding/impact chain、允许的 task grouping 和 forbidden plan；
- 当前 V2 跑至少 5 次真实模型；
- 建离线 metric report，记录人工重写、Preflight 接手代理指标、首次运行和 time-to-usable-plan baseline；
- 冻结 `MetricPolicyId/MetricPolicyVersion/policyDigest`：每项分子/分母、event boundaries、sample cohort/projectSetDigest、minimum sample、窗口、排除、aggregation/nearest-rank percentile 算法、assignment Gold、canary/release 阈值和调整审批；
- 建 MetricPolicy schema/digest/migration/计算 fixture：固定样本逐项断言 ratio/P50/P95/exclusion，版本变更只追加并并列历史结果；
- 实现 WorkspaceWriter authoritative OS lock、lease audit、fencing token 和 `assertWriter`，覆盖 recovery/mutation/scheduler/dispatch/settle/integration/convergence/repair；
- 冻结 approval-only 与 execution-dispatch 的 API/DTO/幂等契约。

退出条件：最常见失败可量化；global current MetricPolicy head 已发布，project override/global fallback、publish-reserve CAS 和 immutable ReleaseReport 历史重放测试通过；双进程 fixture 只有一个 writer，锁丢失立即 fence。Writer guard 未通过时 Phase 1 candidate writes 禁止启用。

### Phase 1：V3-Slice Understand + Ground

交付：

- V2/V3 Schema 兼容、PlanningStore、writer-fenced operation stage/recovery；
- `source_ingest -> source_profile -> source_manifest -> requirement_analysis(seed) -> requirement_review -> source_policy_precheck -> decision_effect_precheck -> risk_profile -> scenario_completion -> scenario_coverage_review`，含 SourceDispositionBinding closure、CoveragePolicy exact-one/七类/N-A reviewer/uncertain/baseline 不弱化；
- filesystem/manifest/test providers、TypeScript/Nuxt/Vue/Prisma StackProfile 和 Evidence Gateway；
- Repository Snapshot 后冻结 CanonicalTargetBinding，再合并完整 PlanningPolicySnapshot；repository delta 通过单调 RepositoryPolicyBaseline successor 达到固定点，相同 seed set 不重复 stale；
- EvidenceClaim、RequirementCodeBinding、Binding Review 和 digest/stale；
- shadow API 和诊断 UI。

退出条件：source block classification=100%、required disposition 与 SourceDispositionBinding closure=100%、CoveragePolicy exact-one/七类 disposition/N-A reviewer/uncertain=0、policy-risk union/baseline/fixed-point/stale tests 和 Scenario category coverage=100%，相同 repository Policy 最多一次 delta successor 且 nonconvergent 稳定 blocked，critical owner/impact-chain recall=100%，snapshot 外 evidence=0，CanonicalTargetBinding 非法/变化失败关闭，crash 不污染 Project pointer。

### Phase 2：V3-Slice Shape + TaskPreflight

交付：

- WorkPackageProposal、带 required relationship 的 TaskProposal、TaskContextPack 和 PlanningProposalPack；
- strict GeneratedPlanV3、attempt-scoped PlanningPromptReferenceManifest、PlanningReferenceMap 和 reserved ID；
- reference mapping 后生成 immutable PolicyFulfillment；applicable active MUST 对 reserved Task/Verification exact-one-or-more，approved-not-applicable MUST 以审计和空执行映射闭合；
- Service CapabilityRequirementDraft relationship derivation、Plan Review 和 `repairOwner + canonical restartStage` 单调 repair lineage；
- 为固定 Gold 团队建立最小正式 CapabilityDefinition/Claim/Catalog、ResourceAccessGrant/ProjectAccessGrantSnapshot 和 immutable ExpectedAssignmentFixture registry；
- 每个 executable proposal 生成 terminal AssignmentEvaluation；AssignmentDraft 和 Service-verdict TaskPreflight 禁止自由字符串/Persona/Skill/自报 accepted 通过资格；
- blocked/clarification/rejected 仅保留 proposal/draft，不物化正式记录。

退出条件：Planner 数据库 ID/未知或跨 attempt ref 拒绝，PolicyFulfillment coverage=100%，repair restartStage 全部属于 canonical enum；assignment evaluation/reason coverage=100%，abstention recall>=95%（critical=100%）、precision>=90%、false abstention<=10%（critical=0）；first-pass TaskPreflight acceptance>=85%，critical actionability=100%，逐 check/multi-failure permutation 的 verdict/root-stage/order/digest replay 一致，伪造 accepted 的缺 evidence/scope/verification 报告被拒，blocked operation 正式 Task/Assignment ID 为空。

### Phase 3：V3-Slice Assignment + Real TaskRun + Minimal Convergence

交付：

- 将 Phase 2 固定目录扩展为项目级 claim/access lifecycle、grant revocation fencing、legacy mapping、catalog/access refresh；
- AssignmentAffinitySnapshot、全量 AssignmentEvaluation、score provenance、owner ambiguity 和 trusted qualification；Evaluation 必须冻结并匹配 Draft/Decision 的 routing target 与 executingAgentId；
- Approval command 与 ExecutionDispatch command 分离；Dispatch 计算 DAG runnable frontier，支持 started/partially_started/waiting 与逐 Task waiting_dependency/capacity/runtime/conflict，硬 blocked/stale 保持整批 0 Run；
- 首版 Squad approval 前固定 hard-eligible executingAgentId；leader 只创建 SquadCoordination，改派生成新 Assignment/Agent Preflight；TaskRun.agentId 严格等于 executingAgentId；
- TaskPreflight Service accepted -> Decision finalization -> final commit，一次物化正式 records；
- taskRevision、active run uniqueness、ExecutionImpactGuard、scope settle、retry/reassign/recovery；
- 单 CanonicalTargetBinding 的最小 DeliveryIntegration：连续 DAG sequence、逐 output 可复算 inclusion evidence、duplicate/no-code proof、commit/tree continuity、target CAS 和 clean finalCommit；
- 最小 DeliveryConvergence + RepairBaseline/CarryValidation：父 finalCommit baseline、finding 不可丢、source-target subject/binding/verification/reachability digest 和显式 carry/reverify/reexecute/superseded；
- 仅用于隔离测试交付和 internal canary，不开放 3080 candidate。

退出条件：trusted capability/access coverage=100%，assignment evaluation/reason=100%，Evaluation-Draft-Decision owner mismatch=0，selected-owner>=90%（critical=100%），abstention recall>=95%（critical=100%）/precision>=90%/false-abstention<=10%（critical=0），false-ready=0；三层 DAG 不越过 dependency、mixed soft-wait 可启动其余 frontier、started result/run exact-one；Writer/Approval-Dispatch/Squad/active-run 并发不变量通过；未集成 output、target moved、缺 proof、finding 丢失和 false-converged 均不能 delivered。

### Phase 4：V3-Usable Candidate

交付：

- 完善 PlanningPolicySnapshot authority 冲突、AccessGrant lifecycle/管理、风险深度和局部重算；
- Plan Health 摘要优先 UI、用户修正反馈和 evaluation registry；GUI 将 Approval 与 Dispatch 分为两个动作和状态；
- 将 Writer fencing、target/access、Phase 3 的 Integration/Convergence/Repair 设为 candidate 强制路径；
- 3080 shadow/candidate：`lscity-nuxt`、两个同支持边界异构项目、一个 unsupported 反例；
- clean install、全量 test/build/package/browser happy-path/business-rejection/boundary/dependency-failure、回滚演练。

退出条件：false-ready/false-converged=0，selection/abstention 全部 release gates 通过，human rewrite<=20%、rework<=15%、稳定首次完成>=70%、time-to-usable-plan P50<=20/P95<=45 分钟；3080 明确分离 Approval/Dispatch 并展示 target/access/evaluation/Service verdict/inclusion/repair。Writer fencing 与 Phase 3 门禁任一缺失均不得开放 candidate。

### Phase 5：V3-Advanced Integration + Governance

交付：

- 增强多 worktree DAG 集成、重复 patch、复杂冲突辅助、规模化恢复和性能；
- 增强 affected Binding 刷新、Convergence finding 精度、幂等 repair revise 和长期证据治理；
- 扩充 large-plan、恢复、冲突和成本观测 fixture；
- 多仓库交付在跨仓库引用与原子发布模型完成前继续失败关闭。

退出条件：高级冲突、重复 patch、恢复和规模化 fixture 通过；Phase 3/4 的 false-converged、inclusion proof 和 delivery close gate 保持不回归。

## 26. 文件级改动计划

### 26.1 `src/types.ts`

- 增加 V3.3 Record Schema：WriterLease、all-block Source/SourceDispositionBinding、PolicyPrecheck/RepositoryPolicyBaseline、categorized Scenario、Decision resolution/effects、Risk/Repository/Target/Policy/PolicyFulfillment/Claim/Binding、PromptReference/relationship Task、Capability/Access、owner-closed AssignmentEvaluation/Draft、deterministic Preflight、frontier Dispatch、SquadCoordination、InclusionEvidence、Convergence/RepairBaseline；
- 增加 PlanningReferenceMap、AssignmentAffinity、ShadowEvaluation、MetricPolicy、stage attempt/evidence access 和完整 digest/freshness Schema；
- `PlanSnapshotRecordSchema`、`TaskRecordSchema` 改为 legacy/V2/V3 兼容 `z.union`，解析后由 helper 归一化版本；
- 扩展 Project/TaskRun optional V3 字段和 delivery/convergence pointer；
- 增加 API summary、diagnostic code 和 command trust Schema；
- 对数组数量、文本长度、digest、path 和 round 设置上限；
- 避免 V3 Schema 使用 `.passthrough()` 接受未知 Planner 字段。

### 26.2 `src/storage.ts`

- 注册 V3 domain tables；
- 新增 `PlanningStore` capability；
- 增加 operation list-by-status、lease/revision check、child ownership 和 recovery 查询；
- 当前 adapter 实现 authoritative host OS lock/fencing + business lease + saga；
- 对 source disposition closure、repository policy baseline successor、prompt ref、policy fulfillment、approval/dispatch idempotency、terminal assignment evaluation owner closure、active run、required inclusion evidence 建唯一/校验约束；
- 预留数据库 adapter 的 transaction/CAS/unique active run 接口；
- migration 只建新表/兼容字段，不伪造旧数据。

### 26.3 `src/planning/*`

- writer guard 之外的 source classification/disposition binding、Scenario category、SourcePolicy/RepositoryPolicy fixed point、Decision/Risk/Target/PolicyFulfillment/provider/Claim/Binding/PromptReference/relationship/context/reference/capability/access/AssignmentEvaluation owner closure/Preflight/Approval-frontier Dispatch/Squad/Inclusion/RepairBaseline/freshness/metrics 纯逻辑；
- provider 不依赖 Service 或直接写 Store；
- deterministic validator 无 LLM 副作用，方便 mutation/property test；
- 每个 policy/provider/prompt 有显式版本。

### 26.4 `src/workflow.ts`

- 保留 V2 入口供兼容；
- 增加 V3 prompt-ref resolution、local-key materialization、PolicyFulfillment、coverage、DAG frontier 和 cross-reference validator；
- 增加 reserved ID/reference map、immutable materialization/recovery 和 blocked proposal validator；
- 把当前复杂 repository/planning 辅助函数逐阶段迁出，不做一次性大重构；
- 当前候选算法迁到 `planning/assignment.ts` 后，V2 wrapper 保持旧 DTO。

### 26.5 `src/service.ts`

- `startDecompositionOperation` 改为创建 durable PlanningOperation；
- V2 和 V3 使用显式分支，不根据响应字段猜测；
- V3 stage orchestration 在 lock 外执行耗时依赖，在短 lock 内提交 stage；
- source ingest/profile/manifest/disposition binding、review/risk、RepositoryPolicyBaseline fixed-point successor、Decision effect precheck/finalization、prompt/reference mapping、policy fulfillment、capability derivation、assignment qualification/evaluation owner closure、executing Agent TaskPreflight、DAG frontier dispatch、一次性正式记录物化、freshness 和 recovery 必须由 Service 作为明确阶段编排；
- V3 使用独立 `createPlanApproval` 与 `createExecutionDispatch`，禁止 approval handler 创建 Run；
- delivery close 编排逐 output inclusion/CAS、final snapshot、Convergence 与 immutable RepairBaseline/successor；
- initialize 先获取 writer OS lock/fencing 再 recovery；所有 mutation/background continuation assertWriter；
- Project pointer 仍是唯一 current plan source of truth；
- 不在 service 中重新解析 TypeScript/Vue/Prisma。

### 26.6 `src/http.ts` 与 API client

- 增加 Source classification/DispositionBinding/PolicyPrecheck/RepositoryPolicyBaseline/PolicyFulfillment/PromptReference/Target/Access/AssignmentEvaluation/Preflight/Approval/逐 Task Dispatch/Squad/Inclusion/RepairBaseline 等查询，默认按 current Plan 闭包过滤；
- 增加独立 approvals/execution-dispatches、grant lifecycle、refresh/retry/confirm/preflight/integration/convergence-repair/replace 命令；
- 复用现有同源、JSON、body limit 和 sendError 机制；
- evidence detail 禁止 path 参数；
- client 方法返回判别联合和稳定 error code。

### 26.7 `src/client.tsx`

- 项目详情先展示 Plan Health、最多 3 个主要问题和下一步动作，再按需求规则、风险/仓库、代码理解、任务、能力/接手、审批/执行门禁、交付收敛七层下钻；
- Approval 与 Dispatch 为两个动作/状态；审批前 soft waiting 可批准；执行期按 DAG 显示 runnable frontier、waiting_dependency 和逐 Task状态，有可运行项时允许部分 Dispatch；
- evidence 只展示相对 path、symbol/range、provenance、freshness；
- candidate reason 展示 hard gate、带 source ID 的 score contribution、selected/routing/executing owner、owner ambiguity 和 dispatch 三部分；
- integration 视图展示每个 TaskRun output 的 sequence、patch/tree inclusion、duplicate/no-code audit、target CAS、冲突/stale、canonical target 和 finalCommit；
- V2 legacy、shadow、candidate、approved 状态清晰；
- 保留现有工作流，不在前端复制 gate 逻辑。

### 26.8 `tests/*`

- 现有 21/27 测试保留并重命名/注释为 contract integration；
- 新增 all-block/disposition binding/category/RepositoryPolicy fixed point/PolicyFulfillment/PromptReference/Target/Access/Decision/freshness/materialization/shadow/Service Preflight/Assignment owner closure/DAG frontier Dispatch/Squad/Inclusion/Repair、双进程 writer/failure/race/recovery tests；
- 新增 Gold selected/abstained outcome、allowed-owner/reason、selection+abstention 指标、接手 rubric、MetricPolicyVersion、forbidden plan、mutation runner 和报告；
- 新增 unsupported-stack、untrusted claim、false-converged 和 repair immutability fixtures；
- 真实模型测试默认不混入快速单测，但 release gate 必须显式执行并归档结果。

## 27. 关键技术决策记录

### ADR-001：系统证据优先于 Planner 自报

决定：Planner 只能引用 current PlanningPromptReferenceManifest 注入的 attempt-scoped opaque evidence ref；Service 在写 Proposal 前校验 ref 的 kind、artifact digest 和 attempt ownership，并解析为内部 EvidenceClaim ID。Planner 不得看到、猜测或返回数据库 ID。

理由：path existence 不能证明模型读取、时点一致或代码 owner 正确。

代价：需要 provider、store 和 retrieval 层，规划延迟和存储增加。

### ADR-002：先 Binding，再 Task

决定：RequirementCodeBinding 是独立、可 Review、可 stale 的领域对象。

理由：把代码理解隐藏在 Task 中无法区分“需求覆盖但改错模块”。

代价：增加一次 LLM/Review 阶段，但能把错误返回正确 owner 修复。

### ADR-003：WorkPackage 两阶段拆解

决定：先按业务 owner 聚合，再按依赖、风险和验证成本展开。

理由：一次性直接生成 Task 容易过碎或过泛。

代价：多一个中间对象和 review 规则。

### ADR-004：资格与调度分层

决定：capacity/runtime health 不参与 structural ineligible。

理由：能力缺失和暂时等待具有不同业务语义和修复动作。

代价：API/UI 需要表达更多状态。

### ADR-005：OS lock/fencing 下的可恢复 Saga

决定：每个 workspace 无条件使用 authoritative host OS lock、单调 fencing token、业务 lease、revision recheck、不可变 child、最后切指针和补偿；record 不替代 lock handle。

理由：实例内串行与持久化 lease 都不能阻止同 host 第二个 Service 写；底层多表 transaction/CAS 尚未确认。

代价：当前只允许一个 writer，所有 recovery/mutation/background continuation 必须 assertWriter；未来多 writer 需新的分布式 fencing/CAS ADR。

### ADR-006：V3 失败关闭，不自动降级 V2

决定：candidate/default 下 V3 blocked/failed 保持真实状态。

理由：自动 V2 fallback 会重新引入自报 evidence 和 false-ready。

代价：provider 或模型故障时用户需要重试或修复依赖。

### ADR-007：规划 repository baseline 与执行演进分离

决定：Plan 冻结 R0，TaskRun 记录实际 Rn，并由 ImpactGuard 识别计划内合法演进和外部 drift。

理由：严格要求每个 Task 都等于 R0 会使顺序执行必然 stale；完全忽略 drift 又会在错误代码上运行。

代价：必须可靠归档每个已完成 Task 的 changedFiles 和 scope evidence。

### ADR-008：Acceptance 原文与可执行 Scenario 分离

决定：AcceptanceCriterion 保留用户原文，AcceptanceScenario 单独表达 precondition、trigger、outcome 和 observableAt。

理由：改写原文会丢失需求保真，只保留原文又无法建立可证伪的规划和交付门禁。

代价：增加 Scenario 分析/Review、digest 和双覆盖校验。

### ADR-009：Service 而非 Planner 拥有能力要求

决定：Planner 不输出 role/capability；Service 根据 Binding、Task relationship 和版本化规则生成 CapabilityRequirement，Assignment 只信任受控 Definition 与 active confirmed Claim。

理由：让 Planner 自由选择能力会再次产生两套语言，并可为了有候选而降低任务真实要求。

代价：需要能力目录治理、legacy pending mapping 和人工确认流程。

### ADR-010：技术栈支持失败关闭

决定：首版 candidate 只支持 TypeScript + Nuxt/Vue + Prisma 及已声明子集；其他缺 semantic provider 的栈返回 unsupported。

理由：通用文本搜索只能证明文件存在，不能证明理解真实 owner、状态链和 consumer。

代价：首版适用范围更窄，扩栈必须新增 Provider、Gold 和 release evidence。

### ADR-011：计划审查与交付收敛分离

决定：Plan Review 在执行前评估计划，DeliveryConvergenceReview 在执行后基于 final repository 评估实现；repair 生成新 plan revision。

理由：TaskRun/test 成功无法证明遗漏 consumer、失败路径、Policy 或计划外行为不存在。

代价：交付关闭增加一次快照和审查成本，并需要维护修复 revision 的幂等性。

### ADR-012：local key 与持久化 ID 分离且一次物化

决定：Planner 对新交付对象只输出本轮 local key，对已冻结事实只输出 current PlanningPromptReferenceManifest 注入的 opaque ref；Service 在 Proposal 写入前解析 ref -> artifact ID，在 reference-mapping 阶段冻结 local key -> reserved ID。commit 前只持久化 proposal/draft/preflight 和两阶段 Decision effect；TaskPreflight `serviceVerdict='accepted'` 且 final effect 通过后，final commit 一次物化正式 WorkPackage、CapabilityRequirement、AssignmentDecision、DeliveryTask 和 PlanSnapshot。

理由：避免模型看到/生成数据库 ID、跨 attempt 重放证据引用、混淆已有事实与待创建对象，以及先写 Task 再回写 `planSnapshotId` 造成半成品和恢复歧义。

代价：PlanningOperation 需要预留 ID、独立 proposal/draft 表、引用表和 orphan recovery；blocked/shadow proposal 只保留规划事实与诊断，不产生正式业务记录。

### ADR-013：owner 选择必须有受控亲和事实

决定：硬资格使用 trusted Claim；排序使用 AssignmentAffinitySnapshot 和带 source record ID 的 feature contribution。高风险同分无可信区分时阻塞；Gold 以 allowed-owner set 验证最终 executing Agent，top-k 只用于召回诊断。

理由：资格只能证明“可以做”，不能证明“应该由谁做”；自由文本 Persona、Skill 和无来源历史会让错误 owner 看起来合理。

代价：需要维护 project affinity claim、历史口径、人工确认和 owner ambiguity 处理。

### ADR-014：可复算 Integration Inclusion 是 Convergence 前置

决定：每个 required output 必须从 immutable commits 重算 diff/patch/blob-mode，按 DAG/连续 tree 产生 ancestor 或 patch-hunk-postimage/duplicate/no-code proof，再以 CanonicalTargetBinding ref CAS 得到 clean finalCommit；manual resolution 不是 proof。

理由：worktree/test/人工确认不能证明输出进入用户实际 target；没有逐 output proof 和统一 revision 无法闭环。

代价：需要显式集成流程、稳定 patch identity、tree postimage、CAS、冲突处理和多仓库失败关闭。

### ADR-015：Decision 影响采用来源预判与完整草案终判

决定：Requirement Review 后对每个 Decision option 做 conservative precheck；TaskPreflight 后、final commit 前使用 current Binding、Task、Capability 和 Assignment drafts 补全影响并生成 final effect。candidate/approval 同时门禁两者。

理由：Binding 前无法可信计算代码 owner 和能力影响；只检查一个预先写好的 `blocksPlanning` 布尔值会把漏标变成稳定绕过路径。

代价：增加一类 option effect 记录、两个 stage/digest，并在 TaskPreflight 后基于完整 drafts 重算，但能保证影响判断使用正确时点的事实。

### ADR-016：首版 Squad 审批前固定实际执行 Agent

决定：Squad 可以作为路由目标，但 final AssignmentDecision 必须包含唯一 hard-eligible `executingAgentId`，且 TaskPreflight 必须由该 Agent 完成。运行时改派生成新 AssignmentDecision/Preflight。

理由：leader 能路由不等于执行成员能接手；允许未确定成员的 Squad 通过审批会让 Preflight 契约失去证明对象。

代价：首版不支持完全动态的运行时成员选择；该能力需独立 Squad/Delegated-Agent Preflight 契约后再启用。

### ADR-017：Shadow 持久化规划事实但不发布业务视图

决定：shadow 可以保存 operation-scoped child 供审计和评测，但不物化正式 Plan/Task/Assignment，不改变 Project pointer；默认项目查询只读取 current committed Plan 引用闭包。

理由：完全不保存中间事实无法复核模型质量；按 projectId 全表展示又会让 shadow/blocked 数据污染正式需求、审批和分派。

代价：所有默认查询必须显式实现 current-plan 过滤，shadow 查询必须携带 operation identity。

### ADR-018：来源 Policy 预检与仓库完整 Policy 两阶段

决定：SourcePolicyPrecheck 在 Decision precheck 前冻结来源 MUST，并合并 predecessor operation 的 immutable RepositoryPolicyBaseline；Repository 和 CanonicalTarget 后生成完整 Policy。新增/加强 repository rule 只能单调扩展 baseline 并创建唯一 successor；相同 repository identity/digest、extractorVersion 和 seed set 必须 fixed-point converged。

理由：Decision 不能依赖未来工件，但仓库规则又必须进入最终门禁。

代价：首次发现仓库强规则会增加一次 successor 重算；需要 baseline lineage、delta/iteration 上限和 nonconvergent 诊断，但不会对同一规则无限 stale。

### ADR-019：TaskPreflight 判定权属于 Service

决定：Agent 只提交报告；Service 对 identity、current digests、eligibility/access、evidence read、objective/scope、Scenario verification、escalation 和 missing facts 运行确定性 checks，生成唯一 verdict。

理由：自报 accepted 不能证明 Agent 读过证据或接受的是冻结任务。

代价：需要 evidence access audit、稳定 check code 和 root-cause repair mapping。

### ADR-020：Approval 与 Dispatch 是两个不可变事实

决定：Approval 只证明计划可执行，永不 reserve/claim/create TaskRun；Dispatch 独立幂等并重校验瞬时 gate，从 approved DAG 计算 runnable frontier。硬 blocked/stale 使整批 0 Run；soft wait 逐 Task 表达，可运行项原子启动，允许显式 `partially_started`。

理由：计划正确性与 Runtime/容量/冲突是不同生命周期。

代价：API、Store 和 GUI 都要表达两个命令、批次 aggregate、逐 Task outcome、waiting_dependency 和后续新 key dispatch。

### ADR-021：授权快照参与分派与执行 fencing

决定：ResourceAccessGrant/ProjectAccessGrantSnapshot 进入 assignment/preflight/approval/run digest；撤销在下一 tool/settle fence，只有 Integration Service principal 可持 canonical_integrate。

理由：能力合格不等于对当前仓库/命令有权，也不能让执行 Agent 修改 canonical target。

代价：需要 grant lifecycle、scope canonicalization、command allowlist 和 revocation tests。

### ADR-022：Assignment 评测包含弃权全量分母

决定：每个 executable proposal 必须有 terminal AssignmentEvaluation，且 selected outcome 冻结 current AssignmentDraft digest、routing target 和真正的 executingAgentId，并与最终 AssignmentDecision exact match。Gold 冻结 selected/abstained 真值；selection accuracy 只看 executingAgentId，和 abstention recall/precision/false-abstention 分别门禁。

理由：只对已选择样本报告 owner accuracy 会通过选择性弃权隐藏失败。

代价：需要稳定 reason provenance、完整 fixture、MetricPolicyVersion 和 Evaluation-Draft-Decision closure 校验。

### ADR-023：Convergence repair 绑定父 canonical finalCommit

决定：RepairBaseline 冻结父 Plan/Integration/Review/finalCommit/finding；每项事实只能 carry_current/reverify/reexecute/superseded，finding 不可删除。上游 digest 变化创建 successor operation。

理由：从 worktree 或当前漂移状态修复、或静默丢 finding，会破坏可追溯性并产生 false convergence。

代价：repair 需要 immutable lineage、幂等 successor 和 carry-forward validation。

### ADR-024：Policy 发现与 Task 落实分离

决定：PlanningPolicySnapshot/PolicyConstraint 在 task planning 前冻结规则、authority、scope、applicability 和 Requirement/Scenario 映射；PlanningReferenceMap 后以独立 immutable PolicyFulfillment 闭合每个 applicability 已决的 active MUST。applicable 分支必须映射到 reserved Task 与 VerificationCommand；approved-not-applicable 分支必须保留人工审计且不生成执行映射。final commit 保持 reserved ID 不变。

理由：Policy stage 早于 Task stage，不能在不可变 PolicyConstraint 中预存未来 Task ID，也不能在任务生成后原地回写规则快照。

代价：增加 policy_fulfillment stage/table/digest 和 exact-one closure 门禁。

### ADR-025：Repair 使用 canonical restartStage

决定：Review finding 分离事实 `repairOwner` 与状态机 `restartStage`；restartStage 必须是 PlanningOperationStage 的逐字枚举，所有 finding 按 canonical stage ordinal 选择最早 successor 起点。human decision 通过 requiredUserAction 暂停，但仍指向真实 restartStage。

理由：`policy/risk/repository/human_decision` 等 owner 名称不是持久化 stage，直接比较会让 repair 永远无法命中或从错误位置恢复。

代价：Reviewer Schema、diagnostic、UI action mapping 和历史 fixture 需要迁移到双字段契约。

## 28. 已知未知与实施前决策

以下问题不会改变总体架构，但会影响具体依赖、阈值或部署能力，应在对应 Phase 开始前通过最小实验确认：

| 未知 | 最小验证 | 决策点 |
| --- | --- | --- |
| domain storage 是否可提供 transaction/CAS/unique index | 写 capability probe 和并发 fixture | 只决定未来是否另立多 writer ADR；V3.3 仍强制 OS lock/fencing |
| TypeScript Compiler API 对目标仓库的耗时/内存 | 在三个 Gold 仓库扫描 | provider timeout、增量和 worker 隔离 |
| Vue/Nuxt 稳定 parser 的发布体积和兼容性 | package smoke + fixture corpus | runtime dependency 或 optional provider |
| Prisma semantic parser 稳定性 | relation/migration fixture | 是否可将 schema completeness 标 complete |
| 首版 StackProfile 识别精度 | supported/unsupported fixture corpus | 哪些技术栈组合可进入 candidate |
| Evidence retrieval 首版 recall | Gold binding query replay | token overlap 是否需向量/全文索引 |
| LLM 一次 repair 是否足够 | 5-run baseline | repair 上限，不以成本为由放宽 blocking gate |
| Project Policy authority 冲突 | AGENTS/README/tooling 冲突 fixture | needs_confirmation 和优先级 UI |
| Capability registry 的管理 owner 和失效周期 | claim lifecycle/权限审计演练 | 谁可确认、撤销和设置 expiresAt |
| Convergence Reviewer 的漏报/误报 | final-repo mutation corpus | deterministic/LLM 边界和人工复核阈值 |
| 3080 当前有几个 Service 实例 | 进程/端口/启动方式核查 + 双进程锁 fixture | 选择只读/启动失败 UX；不影响 OS lock/fencing 必须上线 |

共同未知必须转化为测试或 deployment gate，不能在实现中以默认值隐藏。

## 29. 完成定义与验收映射

### 29.1 代码完成定义

完整 V3.3 实现可以进入 3080 candidate canary 的最低条件：

1. V2/V3 Schema 兼容和 migration 测试通过，`planningContractVersion=3` 且 design revision=V3.3；
2. authoritative WorkspaceWriter OS lock/fencing、PlanningOperation 每阶段失败注入、`repairOwner + canonical restartStage` successor lineage、prompt/reference mapping、commit、shadow 和恢复测试通过；
3. Source Profile 全 block classification/disposition 与 SourceDispositionBinding closure、seed->precheck->Risk/CoveragePolicy->completion/review 单调链、immutable ScenarioCoverageReview input/independence/freshness、CoveragePolicy exact-one/七类/N-A reviewer/uncertain/policy-risk union/baseline、Decision precheck/final 测试通过；
4. Repository Snapshot freshness、StackProfile support、CanonicalTargetBinding、RepositoryPolicyBaseline fixed-point/nonconvergent、path/secret 安全和 provider completeness 测试通过；
5. EvidenceClaim/Binding fabricated、unread、unsupported、contradicted evidence 失败关闭；
6. TaskContextPack、required relationship、Scenario category/Policy coverage、PromptReference exact resolution、PolicyFulfillment exact-one、DAG/scope/command、CapabilityRequirementDraft 和 Plan Review gate 通过；
7. Planner role/capability/数据库 ID/未注入 ref 输出被拒，Service derivation、trusted Claim 与 immutable Grant/Revocation lifecycle、revoke-refresh 并发、path/command/canonical-integrate 边界通过；
8. Gold fixture registry/外键/唯一/不可变与 critical denominator、每 proposal terminal Evaluation、Evaluation-Draft-Decision owner closure、selection/abstention、唯一 executingAgentId、SquadCoordination 非 Run、Preflight 逐 check/permutation verdict-stage-order-digest replay 通过；
9. Approval-only 与 immutable ExecutionDispatch 分离、DAG runnable frontier、waiting 0 Run、partially_started exact-one Run、dependency 不越级、active-run uniqueness、grant/target stale fencing 测试通过；
10. ReferenceMap/一次物化、逐 output inclusion proof、DAG/commit/tree continuity/target CAS、Convergence/RepairBaseline/finding set、CarryValidation stage/freshness/aggregate/commit+Approval 门禁和每 subject mismatch 通过；
11. V3 blocked/failed/shadow/changes_required 不错误创建正式记录或改变 current Project/Delivery pointer；shadow child 不泄漏到默认查询、审批、容量或 Dispatcher；
12. immutable published MetricPolicy 的 ID/version/digest、publish idempotency/version uniqueness/concurrency/禁止 update-delete、Operation 原子冻结、ReleaseReport command 幂等/global+project history/旧历史重放和全部计算字段测试通过；新版本只追加且 report 并列历史；
13. V2 现有全量测试无回归；
14. build、package smoke、clean install 和 docs check 实际通过；
15. 所有未执行的真实模型或浏览器验证明确标为待验证。

### 29.2 “好用”完成定义

只有以下全部有实际证据，才可以对用户声明满足“正确识别需求，按照需求和项目代码逻辑正确拆任务并分配”：

| 上层验收 | 技术机制 | 必须证据 |
| --- | --- | --- |
| 规范性来源不遗漏 | Source Profile + all-block Manifest classification + normative disposition + SourceDispositionBinding | classification/disposition/target closure 100%，uncertain=0，hinted-context Review=100% |
| 原始 AC/Decision 保真 | 独立记录 + anchor mapping + resolution digest | 21/27 和 choice-change mutation 回归 |
| 未决事项不能绕过 | SourcePolicyPrecheck + RepositoryPolicyBaseline + per-option precheck/final gate | option/resolution closure 100%，完整 Policy 不能削弱 precheck，相同 repository Policy fixed-point converged，cosmetic false-ready=0 |
| 验收可执行 | seed/completion Scenario + per-AC CoveragePolicy + CoverageReview | exact-one/七类 disposition/N-A reviewer/uncertain=0；happy_path 及 required category coverage=100% |
| 项目强制规则不丢 | Source precheck + RepositoryPolicy fixed point + PolicyFulfillment | active MUST disposition/Task-Verification fulfillment 100%，新增强规则单调进入 successor 且不无限 stale，violation false-negative=0 |
| 只在真实支持范围宣称好用 | StackProfile + CanonicalTargetBinding + support gate | supported Gold 达全部 threshold，非法/multi target 与 unsupported false-ready=0 |
| 理解真实代码 owner | Repository Snapshot + Binding | critical binding recall 100% |
| 不伪造路径/命令 | PromptReferenceManifest + Evidence access + Command trust | 数据库 ID/未知或跨 attempt ref 接受率=0，fabricated evidence=0 |
| 影响链完整 | EvidenceClaim + impact dimension matrix + Review | critical chain 100%，unsupported/disputed critical claim 0 |
| 任务边界可执行 | WorkPackage + relationship + TaskContextPack + Review | actionability>=90%，relationship/DAG invariants 100%，first-pass Service Preflight>=85% |
| 接手后少澄清返工 | deterministic Service Preflight + immutable Task | evidence/scope/scenario check bypass=0，无澄清启动>=80%，首次完成>=70%，rewrite<=20%，rework<=15% |
| 依赖正确 | relationship-aware deterministic DAG + Reviewer + runnable frontier Dispatch | blocking edge=0，verification/review/migration/release 顺序错误=0，dependency 越级启动=0，mixed soft-wait 不阻塞其他 runnable Task |
| 能力与权限不被 Planner 扭曲 | Service derivation + controlled Definition/Grant | capability grounding=100%，required access=100%，canonical_integrate Agent grant=0 |
| 正确分配或正确弃权 | AssignmentEvaluation + Draft/Decision owner closure + trusted eligibility + provenance ranking + Gold outcome | evaluation/reason=100%，owner/draft mismatch=0，selected-owner>=90%（critical=100%），abstention recall>=95%（critical=100%）/precision>=90%/false-abstention<=10%（critical=0） |
| 零候选不误放行 | terminal abstention + blocked gate | false-ready=0 |
| 容量不伪装资格/审批 | immutable Approval + frontier Dispatch | Approval Run=0；all-waiting 202/Run=0；partial 只启动 runnable Task 且 exact-one；恢复后新 key 幂等 dispatch tests |
| 计划和执行可追溯 | writer fencing + immutable snapshot/task/assignment/run/coordination | two-process writer、leader no-run、retry/race/recovery tests |
| 仓库/授权变化不误执行 | digest/stale + Access revocation + ImpactGuard | target/access/drift mutation 与 active-run fence tests |
| 最终代码满足规格 | per-output recomputed inclusion evidence + target continuity/CAS + final snapshot + Convergence | output 一一对应；缺 proof/伪造 no-code/manual-as-proof/target moved/stale 不关闭；false-converged=0 |
| 修复不篡改或丢 finding | immutable RepairBaseline + CarryValidation + successor | canonical finalCommit、finding set、每 subject source-target digest/mismatch、idempotency、plan/task/run immutability tests |
| 非 happy path 可用 | failure/adversarial/browser matrix | release report |
| 重复使用稳定且及时 | 真实模型 5-run + MetricPolicyVersion | semantic stability >=85%、critical=100%，time-to-usable-plan P50 <=20 分钟/P95 <=45 分钟 |

### 29.3 明确不能作为完成证据的结果

- Zod Schema 通过；
- fake LLM 返回固定 Gold JSON；
- 每条 Acceptance 被任意 Task 引用；
- 每条 Acceptance 有一段看似完整但没有 observableAt 的模型文本；
- 所有 Task 有一个 Agent ID；
- Planner 返回了存在于目录中的 Capability ID；
- Agent 自由字符串 capability 与受控 Definition 名称相同；
- manifest 中存在 test script；
- Java/Python 仓库能通过 filesystem inventory；
- 所有 TaskRun 和测试命令返回成功，但没有 final repository convergence；
- 单次真实模型结果看起来合理；
- 手工修正全部 binding/task 后可以审批；
- 只跑 `happy_path`；
- 只在开发源码目录运行，未做 package/clean install；
- 3080 页面能打开但没有 bad/boundary 流程证据。

## 30. 实施状态与后续验证

截至 2026-09-05，本文的 candidate 主链已在 `src/types.ts`、`src/storage.ts`、`src/service.ts`、`src/workflow.ts`、`src/http.ts`、`src/client.tsx`、`src/planning/` 和 `src/workspace-writer.ts` 实现。发布前回归实际覆盖 298 项；Agent turn 统一设置 10 分钟超时，超时由统一调用边界取消会话，持久化 `agent-turn-timeout`，恢复 Project，并允许按冻结 stage 重试，不会留下永久 `running/decomposing` 或创建正式 Task/Approval/Dispatch。若 Review repair 的 successor 在后续生成阶段以可重试诊断失败，新的 operation 同时绑定原 repair attempt 与失败 successor：`predecessorOperationId` 指向失败 successor，`restartStage` 取其实际失败 stage，阶段之前的不可变产物按 digest 复用，并把失败 operation 的首条确定性诊断作为首次生成反馈；repair attempt 只有在新 successor 通过原 Review 语义和全部后续门禁后才转为 `resolved`。

下一阶段不再是“先写 V3 Schema”，而是冻结发布产物并持续完成以下质量验证：

1. 固定真实项目 revision、PRD、团队目录、CapabilityClaim 和 release commit；
2. 补齐 `lscity-nuxt`、两个异构受支持项目及 unsupported 反例的 Gold Requirement/Scenario/Policy、Binding/impact chain、forbidden plan 和 expected convergence finding；
3. 对每个 Golden Case 在同一冻结 MetricPolicyVersion 下执行至少 5 次真实规划，记录完整 selection/abstention 分母；
4. 执行 3080 桌面/移动端 happy-path、business-rejection、boundary 和 dependency-failure 回归；
5. 只有第 29.2 节阈值全部通过，才把“candidate 已实现”提升为“重复使用已证明好用”。

当前单项目 Canary 和自动化证明门禁链已闭合，不代表长期模型质量阈值已完成；ReleaseReport 必须继续保留“样本不足”状态，不能用单次成功或单次正确弃权替代统计结论。
