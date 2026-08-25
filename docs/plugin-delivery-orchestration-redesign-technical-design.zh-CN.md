# dsh-project-orchestrator 从需求到交付整体改造技术方案

版本：1.1
状态：1.5.11 本地交付范围已实施
关联 PRD：plugin-delivery-orchestration-redesign-prd.zh-CN.md
关联设计：requirement-planning-optimization-design.zh-CN.md

## 1. 设计结论与约束

### 1.1 设计结论

本方案不重写现有编排器，而是在现有 Project、Task、TaskRun、Issue、Runtime、Resource、Artifact、Transcript、Approval 和本地存储之上增加一条受门禁的交付链路：

~~~text
RequirementBundle
  -> RequirementDecision
  -> PlanSnapshot
  -> ApprovalSnapshot
  -> Task/TaskRun
  -> VerificationEvidence
  -> ProjectReview
  -> DeliveryRecord
~~~

每个对象只拥有一种事实。列表、进度、Inbox 和统计都是读取投影，不能反向成为业务状态来源。

### 1.2 现有系统约束

- 保持插件名 project-orchestrator；
- 保持 /project-orchestrator/api、根 export、./client 和 CLI binary；
- 保持 DSH 0.1.0-rc.6、Cordis 4.0.1 的注册和生命周期契约；
- 保持 project_orchestrator storage domain 的旧记录可读；
- 当前只支持单 Host、单进程 serialized mutation，不伪造分布式事务；
- 继续使用现有 Agent、Runtime、Resource、worktree、lease 和 TaskRun 能力；
- 第一版只承诺本地交付，不实现远程 PR、推送、部署或生产发布；
- 不通过 fallback read、默认值或静默重试掩盖业务事实缺失。

### 1.3 关键工程原则

1. 所有写操作通过 Service Command；Web、CLI 和自动化不能拥有私有写路径。
2. 领域状态在 serialized mutation 中重新读取并校验，不能信任客户端带来的旧快照。
3. 终态事实不可被 stale operation 覆盖；迟到结果只能作为 stale evidence 追加。
4. 计划审批绑定需求 digest、决策 digest、plan revision 和仓库基线。
5. 证据先落库，再推进对应的成功/交付状态。
6. 迁移和失败补偿必须可重复、可观测、可回滚。

## 2. 当前代码基线与缺口

### 2.1 现有模块职责

| 模块 | 当前职责 | 改造定位 |
| --- | --- | --- |
| src/index.ts | 注册 Host 存储、Service 和 HTTP 前缀 | 保持入口，注入新 Service 能力 |
| src/http.ts | HTTP 路由、请求解析和错误返回 | 增加需求/计划/验证/交付 Query/Command |
| src/client.tsx | Harness Web 工作台和项目交互 | 增加 deliveryStage 主线和证据页面 |
| src/cli.ts | loopback HTTP 客户端 | 增加只读诊断和交付确认命令 |
| src/service.ts | Project、Issue、Planner、Run、Review 和活动 | 作为唯一业务状态 owner，拆分领域服务 |
| src/workflow.ts | 计划解析、任务物化、拓扑和执行辅助 | 增加 plan snapshot、来源映射和验证契约 |
| src/prompts.ts | Task/Issue/Agent prompt 编译 | 增加 Planner 上下文版本和 digest |
| src/types.ts | Zod schema、类型和状态枚举 | 增加新记录和状态契约 |
| src/storage.ts | storage domain、表、snapshot 投影 | 增加兼容表、迁移和事实查询 |

### 2.2 已存在且应复用的事实

- ProjectRecord 已保存 PRD、技术设计、revision、taskIds、批次和审批指针；
- ApprovalRecord 已绑定 revision 和 planHash；
- TaskRecord 已保存 acceptanceCriteria、dependencies、testCommand、attempts 和测试输出；
- TaskRunRecord 已保存 runtime、workspace、base/head commit、状态和失败信息；
- ArtifactRecord 已保存 diff、test report、commit、log 等执行产物；
- TranscriptEntry 已保存有界、脱敏的 Harness Session 投影；
- DecisionRecord 已用于 Issue/TaskRun 的人工决策；
- IssueRecord 已支持 in_review、approve/reject 和 request changes；
- CommandRecord 已有可选 idempotencyKey 和 requestDigest；
- ExternalTriggerRecord 已有 payloadDigest；
- WorkspaceLeaseRecord 已有 preparing/active/releasing/released/orphaned。

### 2.3 当前缺口

当前代码仍缺少以下专用事实或完整语义：

- RequirementItem 的事实/推断/未知细分、需求级产品决策记录；
- RequirementBundle 已有最小来源快照，但还没有完整需求级验收矩阵建模；
- PlanSnapshot 对需求 digest、冲突和仓库 baseline 的完整绑定；
- VerificationEvidence 对验收项、命令、Artifact、Git 和 TaskRun 的完整关联；
- ProjectReview 的 waiver、责任分离和多轮修订语义；
- DeliveryRecord 的 delivered 后 closed、远程发布和部署边界；
- 追加/修订的 duplicate、conflict、supersedes 关系；
- 审批对需求 digest、决策 digest 和仓库 baseline 的完整绑定。

## 3. 目标架构

### 3.1 分层结构

~~~text
┌────────────────────────────────────────────────────────────────┐
│ UI / CLI                                                       │
│ Project Overview · Requirement · Decision · Plan · Execution   │
│ Verification · Review · Delivery                              │
└──────────────────────────────┬─────────────────────────────────┘
                               │ Query / Command
┌──────────────────────────────▼─────────────────────────────────┐
│ HTTP / Command Boundary                                       │
│ schema parse · loopback/origin · idempotency · error mapping   │
└──────────────────────────────┬─────────────────────────────────┘
                               │
┌──────────────────────────────▼─────────────────────────────────┐
│ OrchestratorService                                           │
│ requirement · planning · approval · preflight · execution      │
│ verification · review · delivery · recovery                   │
└──────┬───────────────┬───────────────┬──────────────┬─────────┘
       │               │               │              │
┌──────▼─────┐  ┌──────▼────┐  ┌───────▼──────┐  ┌────▼────────┐
│ Requirement │  │ Planner   │  │ Execution    │  │ Delivery    │
│ + Decision  │  │ + Plan    │  │ + TaskRun    │  │ + Review    │
└──────┬─────┘  └──────┬────┘  └───────┬──────┘  └────┬────────┘
       │               │               │              │
┌──────▼───────────────▼───────────────▼──────────────▼─────────┐
│ Storage / Migration / Recovery                                │
└──────────────────────────────┬─────────────────────────────────┘
                               │
                 Harness Host · Runtime · Agent · Git
~~~

### 3.2 领域服务边界

第一版可以继续由 OrchestratorService 编排，但新增私有领域服务或模块时按以下边界划分：

| 领域 | 负责 | 不负责 |
| --- | --- | --- |
| Requirement | 来源快照、需求条目、事实/推断/未知 | 生成代码或改变 TaskRun |
| Decision | 记录和冻结业务决策、计算 decision digest | 自己修改计划或执行任务 |
| Planning | Planner 上下文、去重、冲突、任务图、PlanSnapshot | 代替人解决高影响决策 |
| Approval | 审批快照、失效判定、审批门禁 | 直接启动未通过 preflight 的执行 |
| Execution | preflight、TaskRun、lease、retry、recovery | 判断需求是否满足 |
| Verification | 命令、环境、Git、Artifact 和 acceptance mapping | 代替人工验收 |
| Delivery | Project Review、DeliveryRecord、local handoff、关闭 | 伪造远程发布 |

### 3.3 不新增第二套状态机

保留当前：

- Project.status：draft/decomposing/awaiting_approval/approved/running/completed/failed/cancelled；
- Task.status：draft/queued/running/verifying/completed/failed/blocked/cancelled；
- TaskRun.status：deferred/queued/dispatched/waiting_local_directory/running/completed/failed/cancelled；
- Issue.status：现有协作和 Review 状态。

新增的 deliveryStage 只表达 Project 交付门禁，不取代上述运行状态。

## 4. 数据模型

### 4.1 RequirementBundle

需求来源可以是原始文件、已解析 Markdown 或用户输入。第一版不强制复制二进制文件，保存稳定定位和 hash；如果 Harness 提供可持久化附件 URI，则保存 URI。

~~~ts
interface RequirementBundle {
  id: string
  projectId: string
  batchId: string
  sourceType: 'pdf' | 'image' | 'markdown' | 'meeting_note' | 'user_input'
  sourceLocator: string
  sourceSha256: string
  parserVersion?: string
  capturedAt: string
  capturedBy: string
  rawAssetRefs: string[]
  extractedTextRef?: string
  imageRefs: string[]
  facts: RequirementItem[]
  inferences: RequirementItem[]
  openQuestions: RequirementQuestion[]
  conflictRefs: string[]
  status: 'captured' | 'normalized' | 'superseded' | 'failed'
}
~~~

RequirementItem 至少包含 id/title/description/sourceRefs/affectedModules/acceptanceIds。RequirementQuestion 至少包含 id/question/options/impact/owner/status。

### 4.2 RequirementDecision

不直接复用现有 DecisionRecord 存放需求决策。现有 DecisionRecord 主要服务 Issue/TaskRun 的运行时决策；强行复用会把运行时决策和产品决策混在一个状态空间。新增 requirement_decisions 表：

~~~ts
interface RequirementDecision {
  id: string
  projectId: string
  requirementBatchId: string
  question: string
  options: Array<{ id: string; label: string; impact?: string }>
  recommendedOption?: string
  impact: 'low' | 'medium' | 'high' | 'critical'
  affectedRequirementIds: string[]
  affectedTaskIds: string[]
  owner?: string
  dueAt?: string
  status: 'pending' | 'resolved' | 'deferred' | 'rejected'
  chosenOption?: string
  resolution?: string
  decidedBy?: string
  decidedAt?: string
  createdAt: string
  updatedAt: string
}
~~~

high/critical + pending 的决策会阻塞计划审批。低影响决策可以由产品规则明确允许延期，但必须可追踪。

### 4.3 PlanSnapshot

~~~ts
interface PlanSnapshot {
  id: string
  projectId: string
  revision: number
  mode: 'initial' | 'append' | 'revise'
  requirementDigest: string
  decisionDigest: string
  repositoryBaseline?: string
  taskIds: string[]
  dependencyDigest: string
  diagnostics: PlanDiagnostic[]
  generatedBy: 'planner' | 'human'
  plannerSessionId?: string
  status: 'candidate' | 'approved' | 'superseded' | 'blocked'
  supersedesId?: string
  createdAt: string
  approvedAt?: string
}
~~~

PlanSnapshot 封版后不原地修改。重新规划创建新 revision，并通过 supersedesId 关联旧快照。

### 4.4 TaskRecord 扩展

在现有 TaskRecord 上增加关联字段，保留已有 acceptanceCriteria 和 testCommand：

~~~ts
interface TaskPlanningMetadata {
  planSnapshotId: string
  sourceRequirementIds: string[]
  sourceRefs: string[]
  acceptanceIds: string[]
  relationship: 'new' | 'extend' | 'replace' | 'duplicate' | 'superseded'
  supersedesTaskId?: string
  decisionIds: string[]
  ownershipKey?: string
}
~~~

高置信 duplicate 任务默认不进入可执行任务集合；中置信候选必须由人解决或明确保留。

### 4.5 VerificationEvidence

~~~ts
interface VerificationEvidence {
  id: string
  projectId: string
  taskId?: string
  taskRunId?: string
  acceptanceId: string
  kind: 'command' | 'git' | 'artifact' | 'transcript' | 'manual'
  command?: string
  workingDirectory?: string
  environmentFingerprint?: string
  startedAt?: string
  finishedAt?: string
  exitCode?: number
  stdoutRef?: string
  stderrRef?: string
  reportRefs: string[]
  changedFiles: string[]
  result: 'passed' | 'failed' | 'unavailable' | 'stale'
  failureClass?: 'business_blocked' | 'dependency_failed' | 'code_or_test_failed' | 'runtime_failed' | 'user_cancelled' | 'internal'
  createdAt: string
}
~~~

result=passed 必须有实际执行证据或明确的人工验收记录；没有证据时只能是 unavailable，不能默认通过。

### 4.6 ProjectReview 与 DeliveryRecord

~~~ts
interface ProjectReview {
  id: string
  projectId: string
  planSnapshotId: string
  acceptanceResults: Array<{
    acceptanceId: string
    result: 'passed' | 'failed' | 'waived' | 'not_applicable'
    evidenceIds: string[]
    note?: string
  }>
  decision: 'approve' | 'request_changes' | 'reject' | 'waive'
  reviewer: string
  note?: string
  createdAt: string
}

interface DeliveryRecord {
  id: string
  projectId: string
  planSnapshotId: string
  reviewId: string
  repository: string
  baseCommit?: string
  headCommit?: string
  branch?: string
  worktree?: string
  changedFiles: string[]
  diffStat?: string
  testSummary: string
  evidenceIds: string[]
  knownRisks: string[]
  rollbackSteps: string[]
  handoffMode: 'local_review'
  immutableDigest: string
  deliveredBy?: string
  deliveredAt?: string
  confirmedBy?: string
  confirmedAt?: string
  createdAt: string
}
~~~

DeliveryRecord 只追加不修改。用户拒绝交付时不删除记录，而是创建新的 Review/Plan revision。

## 5. 状态机与状态 owner

### 5.1 deliveryStage

~~~ts
type DeliveryStage =
  | 'intake'
  | 'evidence_ready'
  | 'decision_pending'
  | 'planning'
  | 'approval_pending'
  | 'execution_ready'
  | 'executing'
  | 'verification_pending'
  | 'review_pending'
  | 'delivery_ready'
  | 'delivered'
  | 'closed'
  | 'blocked'
  | 'cancelled'
~~~

### 5.2 状态推进条件

| 当前阶段 | 允许推进者 | 进入条件 | 下一阶段 |
| --- | --- | --- | --- |
| intake | Service | 来源快照可读取 | evidence_ready |
| evidence_ready | Planner/Service | 需求条目已归一化 | decision_pending 或 planning |
| decision_pending | Project owner | 高影响问题已解决/排除 | planning |
| planning | Planner | PlanSnapshot 已生成 | approval_pending 或 decision_pending |
| approval_pending | Project owner | 诊断、依赖、来源可审阅 | execution_ready |
| execution_ready | Service | approval digest 和 preflight 通过 | executing |
| executing | Workflow | TaskRun 全部终态 | verification_pending |
| verification_pending | Service | required evidence 齐全 | review_pending |
| review_pending | Reviewer | Review 结果已记录 | delivery_ready 或 planning |
| delivery_ready | Service/owner | DeliveryRecord 生成且完整 | delivered |
| delivered | Project owner | 用户确认本地接收 | closed |

任何状态推进都在 serializedMutation 内重新读取 Project、当前 PlanSnapshot、Approval、TaskRun 和 Review。禁止客户端直接提交目标状态。

### 5.3 审批失效规则

审批记录需要绑定：

~~~text
planSnapshotId
planRevision
planHash
requirementDigest
decisionDigest
repositoryBaseline
approvedTaskIds
executionPolicyDigest
~~~

以下变化会使审批失效并回到 approval_pending 或 planning：

- 需求来源、需求事实或高影响决策变化；
- 任务图、依赖、任务验收、任务 Agent 或测试命令变化；
- 仓库 base commit 变化；
- Runtime/Resource 执行策略变化；
- 旧计划被 supersede。

## 6. 需求与 Planner 流程

### 6.1 接入流程

~~~text
POST requirement-batch
  -> 保存 source hash/locator
  -> 解析文本/图片
  -> 保存 facts/inferences/openQuestions
  -> 计算 requirementDigest
  -> 创建 requirement decisions
  -> deliveryStage = evidence_ready/decision_pending
~~~

原始 PDF 的二进制保存取决于 Harness 附件能力。第一版至少保存解析文本、页码/截图定位、来源 hash 和解析失败信息；不能声称插件永久保存了用户未提供的二进制文件。

### 6.2 Planner 输入契约

在现有 plannerPrompt() 上增加结构化上下文：

~~~ts
interface PlannerContext {
  mode: 'initial' | 'append' | 'revise'
  currentProject: {
    id: string
    revision: number
    prd: string
    technicalDesign: string
    taskIds: string[]
  }
  requirementBatch: RequirementBundle
  decisions: RequirementDecision[]
  previousPlan?: PlanSnapshot
  previousTasks: TaskRecord[]
  repositoryBaseline?: string
  activeProjectAgents: Array<{ id: string; role: string }>
}
~~~

Planner 必须返回 JSON，不得把需求文本中的指令当作系统指令。提示词版本和 context digest 写入 PlanSnapshot。

### 6.3 Planner 输出契约

现有 PlannerResultSchema 增加 needs_decision 分支，保留 ready 和 blocked：

~~~json
{
  "status": "needs_decision",
  "summary": "基本信息交互存在两种互斥方案",
  "decisionIds": ["decision-1"],
  "affectedRequirementIds": ["req-11"],
  "nextAction": "请在决策中心选择方案后重新规划"
}
~~~

ready 结果中的每个 task 必须包含：sourceRequirementIds、acceptanceIds、relationship、decisionIds、evidenceRefs 和 testCommand。解析成功不等于诊断通过，Service 还要做确定性校验。

### 6.4 去重和冲突

第一版不引入向量数据库，使用可解释规则：

1. 标题和同义词规范化；
2. 来源引用和文件/模块重叠；
3. 验收标准关键词 Jaccard；
4. ownershipKey；
5. Planner relationship 与确定性规则交叉验证。

输出 duplicateCandidates、conflicts 和 missingEvidence。高置信重复默认不 materialize；中置信重复进入 decision；低置信只提示。

## 7. 审批、Preflight 与执行

### 7.1 审批写入

新增审批前置校验：

~~~text
project.deliveryStage == approval_pending
AND planSnapshot.status == candidate
AND no high/critical pending decision
AND diagnostics has no blocking conflict
AND dependency graph is closed
AND every task has source/acceptance/test command
~~~

写入 ApprovalRecord 时同步保存完整 digest。旧 ApprovalRecord 缺少新字段时只能被视为旧格式，不能直接用于新交付封版；迁移后需要用户重新确认。

### 7.2 Preflight

建议实现：

~~~ts
interface PreflightResult {
  passed: boolean
  checks: Array<{
    name: 'stage' | 'approval' | 'repository' | 'resource' | 'runtime' | 'capacity' | 'dependency' | 'command'
    result: 'passed' | 'failed' | 'unknown'
    message: string
  }>
  checkedAt: string
  repositoryBaseline?: string
}
~~~

Preflight 失败返回 409（状态/审批冲突）、400（输入或路径非法）或 502（Runtime/依赖不可用），不得创建 running Project。

### 7.3 统一 TaskRun

Project Task 和 Issue Task 都走：

~~~text
create queued TaskRun
  -> claim Runtime/Resource/workspace
  -> dispatched + lease
  -> running Agent
  -> verifying test command
  -> collect Git/transcript/artifacts
  -> settle TaskRun
  -> update Task/Issue/Run projection
  -> release lease
~~~

普通 Project Task 不应直接以 project.cwd 作为最终 Agent/test cwd；cwd 必须来自该 TaskRun 的实际 workspace claim。in-place 和 worktree 仍沿用现有安全路径校验。

### 7.4 失败分类和重试

~~~ts
type FailureClass =
  | 'business_blocked'
  | 'dependency_failed'
  | 'code_or_test_failed'
  | 'runtime_failed'
  | 'user_cancelled'
  | 'orchestrator_error'
~~~

默认策略：

| 类型 | HTTP/状态 | 默认动作 |
| --- | --- | --- |
| 参数/路径非法 | 400 | 修正输入，不创建运行 |
| 状态/审批冲突 | 409 | 重新规划或审批 |
| Planner 需要决策 | 422 + blocked | 创建/解决决策 |
| Runtime/Agent 依赖失败 | 502 + blocked/有限重试 | 检查能力后重试 |
| 测试失败 | 失败 evidence | 按上限修复重试，超限阻塞 |
| 用户取消 | cancelled | 保存证据，不再推进 |
| 未预期内部错误 | 500 | 记录 activity，恢复或人工介入 |

重试必须带 attempt、上一次 failure evidence 和原因。所有终态写入通过集中 settleTaskRun(owner, settlement, patch) 完成。

### 7.5 迟到回调保护

在 Agent 返回、证据收集后和最终 settle 前重新检查：

~~~text
TaskRun still exists
AND current status is non-terminal
AND assignmentRevision matches
AND Project.activeRunId matches when applicable
AND Issue.activeTaskRunId matches when Issue context exists
~~~

检查失败时：

- 不改变当前 TaskRun；
- 不推进 Issue 到 in_review；
- 可创建 stale VerificationEvidence 或 Activity；
- 不覆盖用户已记录的取消、失败或新尝试。

## 8. 验证、Review 与交付

### 8.1 VerificationEvidence 生成

测试命令执行器返回：

~~~ts
interface CommandEvidence {
  command: string
  cwd: string
  executionEnvironment?: string
  virtualEnvPath?: string
  exitCode: number
  output: string
  timedOut: boolean
  startedAt: string
  finishedAt: string
}
~~~

Service 将其转换为 VerificationEvidence，并关联：

~~~text
TaskRun -> Task -> acceptanceIds -> VerificationEvidence
                               -> Artifact/Transcript/Git
~~~

现有 TaskAttempt 和 Artifact 继续保留，VerificationEvidence 是跨记录的验收索引，不替代原始证据。

### 8.2 项目级验收

项目级验收矩阵由 RequirementBundle 的 acceptanceIds 构建：

~~~ts
interface AcceptanceResult {
  acceptanceId: string
  requirementId: string
  result: 'passed' | 'failed' | 'waived' | 'not_applicable'
  evidenceIds: string[]
  reviewerNote?: string
}
~~~

以下任一条件不满足，不能进入 delivery_ready：

- required acceptance 没有 evidence；
- evidence 处于 failed/unavailable/stale；
- Project Task 未完成或测试未通过；
- 仍有阻断冲突或高影响未决策；
- Issue 级 Review 未完成；
- reviewer 未明确批准或豁免。

### 8.3 Project Review

当前 Issue Review 保持不变，用于单个 Issue/Task 的评审。新增 ProjectReview 用于汇总整个需求的验收结果。两者关系：

~~~text
Issue Review approved
  + Task verification passed
  + Project acceptance matrix complete
  -> ProjectReview approve
  -> deliveryStage = delivery_ready
~~~

request_changes 创建新的修订入口；不能直接把已封版 Task 改回 running 并覆盖旧证据。

### 8.4 DeliveryRecord

生成流程：

1. 在 serialized mutation 中重新读取 Project、PlanSnapshot、Review、Tasks 和 Evidence；
2. 检查所有 required acceptance 和 review；
3. 从 TaskRun/workspace/artifact 读取 base/head commit、diff、文件和测试摘要；
4. 生成 DeliveryRecord 内容并计算 immutableDigest；
5. 原子写入 DeliveryRecord；
6. Project 进入 delivered，等待用户确认；
7. 用户确认后记录 confirmedBy/confirmedAt，Project 进入 closed。

封版后任何需求、任务、代码或证据变化都创建新 PlanSnapshot/Review/DeliveryRecord，不修改旧记录。

## 9. API、Command 与 Query

### 9.1 新增 Query

~~~http
GET /projects/:id/delivery
GET /projects/:id/requirement-batches
GET /projects/:id/requirement-decisions
GET /projects/:id/plan-snapshots
GET /projects/:id/plan-diagnostics
GET /projects/:id/verification-evidence
GET /projects/:id/reviews
GET /projects/:id/deliveries
GET /projects/:id/preflight
~~~

Query 返回只读投影，并标注 sourceRecordId，不能把投影字段当作写入事实。

### 9.2 新增 Command

~~~text
create_requirement_batch
resolve_requirement_decision
generate_plan
revise_plan
append_plan
approve_plan
run_preflight
start_project_execution
request_project_review
resolve_project_review
create_delivery_record
confirm_delivery
close_project
recover_project
~~~

所有 Command 使用现有 CommandRecord 和 idempotencyKey。现有 schema 已有可选 requestDigest，本次改造必须把 digest 计算和冲突校验真正接入写路径：

~~~text
canonicalRequest = type + projectId + issueId + actor + normalizedPayload
requestDigest = sha256(canonicalRequest)
~~~

同一 key + 同一 digest 可以 replay；同一 key + 不同 digest 返回 409 command-idempotency-conflict。

### 9.3 HTTP 错误语义

| 状态 | 语义 |
| --- | --- |
| 400 | 参数、路径、格式或命令非法 |
| 409 | 状态冲突、审批失效、重复 key 内容冲突、权限/租约冲突 |
| 422 | Planner 需要决策、需求冲突或验证条件不足 |
| 502 | Agent、Runtime、Git 或其他依赖失败 |
| 500 | 未预期的编排器内部错误 |

错误响应必须包含稳定 code、可读 message、retryable、projectId/taskRunId（若有）和下一步建议；不能用 200 包装真实失败。

## 10. 存储与迁移

### 10.1 版本策略

当前 src/storage.ts 的 domain version 和 schemaVersion 都是 1。第一阶段不直接假设 Host 支持 domain version 自动迁移，采用以下策略：

1. 新字段尽量是 optional/default，旧 Project/Task/Approval 可以继续读取；
2. 新表先通过兼容的 optionalTable 读取，缺失时视为空，不把空值当作已完成事实；
3. 在写入新需求或新计划前，创建备份并执行一次性迁移/初始化；
4. 迁移输出 migrationReport，失败整体不提交；
5. 在 Harness storage-domain 的升级契约确认后，再评估 domain version 2。

不允许把旧 schemaVersion: 1 记录静默改写成“已决策、已审批、已交付”。

### 10.2 新增表

建议新增：

~~~text
requirement_bundles
requirement_decisions
plan_snapshots
verification_evidence
project_reviews
delivery_records
~~~

表以 id 为 key，Project 相关 Query 通过 projectId 过滤。不可变记录不提供更新 API，只提供追加和 supersede/resolve 关系。

### 10.3 迁移流程

~~~text
stop Host
  -> backup project_orchestrator.json
  -> load old domain
  -> validate old records
  -> derive legacy requirement/plan metadata where safe
  -> write additive records
  -> validate snapshot and digests
  -> atomically commit migrated storage
  -> restart Host
  -> run read/recovery smoke
~~~

如果旧记录无法安全推导来源或审批 digest，字段保持 unknown，Project 进入 decision_pending 或 approval_pending，要求用户重新确认，不自动补齐。

## 11. 一致性、幂等与恢复

### 11.1 Serialized mutation

以下操作必须在同一 serialized mutation 内完成“重新读取、校验、写入”：

- 创建或解决需求决策；
- 写入 PlanSnapshot 和 Project revision；
- 审批和审批失效；
- 创建 TaskRun、改变 owner 和终态 settlement；
- ProjectReview、DeliveryRecord 和 Project deliveryStage；
- Command/ExternalTrigger 去重和首次登记。

### 11.2 Workspace 补偿

统一 acquireWorkspace() / releaseWorkspace()，Project 和 Issue 都调用：

~~~ts
interface WorkspaceClaimState {
  sourcePath: string
  workspacePath: string
  mode: 'in_place' | 'worktree'
  lockAcquired: boolean
  worktreeCreated: boolean
  leaseId?: string
}
~~~

claim 任一步失败都按已经完成的副作用执行补偿：

- lock 属于当前 TaskRun 才删除；
- worktree 创建过则尝试 remove/prune；
- lease 已存在则标记 released/orphaned；
- 清理失败记录 cleanupError 和 activity；
- cleanup 操作幂等，不能删除其他 TaskRun 的资源。

### 11.3 终态保护

集中函数：

~~~ts
settleTaskRun(
  owner: ExecutionOwnership,
  settlement: 'completed' | 'failed' | 'cancelled' | 'deferred',
  patch: Partial<TaskRunRecord>,
): Promise<boolean>
~~~

返回 false 表示 owner 已失效或当前 TaskRun 已终态。调用方只能追加 stale evidence，不能再次写当前 TaskRun。

### 11.4 重启恢复

Host 启动时：

1. 检查 running/deferred/queued TaskRun 和 active Run；
2. 检查 workspace_leases 的 preparing/active/releasing/orphaned；
3. 对可安全接管的 queued TaskRun 重新进入 dispatch；
4. 对无法确认 owner 的运行标记 failed/recovery_required；
5. 对 orphaned worktree 尝试清理，失败保留 orphaned/cleanupError；
6. 不覆盖已完成、失败、取消和已封版记录。

## 12. UI 与 CLI 实现

### 12.1 Web 页面

在现有 src/client.tsx 的 Project 工作台中增加：

1. Overview：deliveryStage、阻塞、计划 revision、需求/任务/证据/Review 摘要；
2. Requirement：批次、来源、事实/推断/未知和解析错误；
3. Decision Center：选项、影响、owner、历史决策和解决按钮；
4. Plan Review：来源映射、重复/冲突、任务差异、依赖和批准快照；
5. Execution：TaskRun、attempt、Runtime、workspace、错误分类和恢复动作；
6. Verification：验收矩阵、命令、退出码、Git diff、Artifact 和 Transcript；
7. Delivery Review：风险、豁免、回滚、Review 和本地交付确认。

页面按钮由 Query 投影计算是否可见，但 Service 仍必须重新校验。不可操作按钮显示原因，不做静默 disabled。

### 12.2 CLI

新增只读/受控命令：

~~~text
dsh-project-orchestrator requirements <projectId>
dsh-project-orchestrator decisions <projectId>
dsh-project-orchestrator plan <projectId>
dsh-project-orchestrator preflight <projectId>
dsh-project-orchestrator evidence <projectId>
dsh-project-orchestrator delivery <projectId>
dsh-project-orchestrator command '<json>'
~~~

所有写命令进入统一 HTTP/Service Command；CLI 不允许通过直接操作 JSON 绕过审批和 Review。

## 13. 测试设计

### 13.1 Schema 和迁移

- 新旧记录解析；
- 缺失 optional 字段；
- 迁移成功、重复迁移和中途失败；
- digest 稳定性和字段顺序规范化；
- DeliveryRecord 不可变性。

### 13.2 Planner 和计划

- initial 生成；
- append 与旧任务重复；
- revise 替换未执行任务；
- 高影响决策阻塞；
- 冲突、依赖断裂、缺少 evidence；
- Planner 输出 needs_decision、blocked、ready；
- 旧计划审批在需求/决策/基线变化后失效。

### 13.3 执行和恢复

- preflight 成功/失败；
- Resource、Runtime、容量和 lease 冲突；
- Project/Issue 统一 workspace；
- 测试通过、失败、超时和有限重试；
- stop 与 Agent 迟到返回竞态；
- stale assignment、stale run 和重复 settlement；
- claim 中途 lock/lease/worktree 写入失败；
- Host 重启、orphaned worktree 和 cleanupError；
- 用户取消后不再推进 review。

### 13.4 验证、Review 和交付

- acceptance evidence 完整/缺失/失败/stale；
- Issue Review 和 ProjectReview 汇总；
- approve、request_changes、reject、waive；
- DeliveryRecord 缺字段时拒绝封版；
- 封版后变化生成新 revision；
- 用户确认后关闭，拒绝后回到 Review/Planning；
- 交付包内容与 Git/artifact 事实一致。

### 13.5 入口和发布

- HTTP route、错误码和幂等 replay/conflict；
- CLI 与 Web 使用同一 Command；
- client bundle、docs smoke、build、package smoke；
- clean Harness profile 本地端到端演练。

## 14. 实施分期

### Phase 0：现场快照与契约冻结

- 导出当前 Project、31 个任务、两批需求和已有执行证据；
- 标记 duplicate/conflict/superseded 候选，不删除历史；
- 冻结 schema、状态转移、API 样例和迁移表；
- 增加测试 fixture 和故障注入入口。

### Phase 1：需求、决策和计划

- 新增 RequirementBundle、RequirementDecision、PlanSnapshot；
- 修改 Planner 输入输出和 materializeTasks；
- 实现 initial/append/revise、去重/冲突诊断和审批 digest；
- Web 增加 Requirement/Decision/Plan Review。

### Phase 2：审批到执行交接

- 实现 deliveryStage 和 preflight；
- 统一 Project/Issue TaskRun workspace acquisition；
- 集中终态 settlement、失败分类、有限重试和 recovery；
- CLI 增加 preflight/recovery 诊断。

### Phase 3：验证、Review 和交付

- 新增 VerificationEvidence、ProjectReview、DeliveryRecord；
- 建立 acceptance matrix；
- 实现本地交付包封版、确认和关闭；
- Web 增加 Verification/Delivery 页面。

### Phase 4：迁移、观测和发布

- 旧存储备份、迁移、恢复和回滚演练；
- 指标、Activity、审计和告警；
- 完整 verify、package smoke 和 clean Harness profile；
- 更新 README、API、architecture、operations、migration 和 changelog。

## 15. 回滚和风险控制

### 15.1 Feature flag

新增能力按领域开关：

~~~text
requirement_intake_v2
plan_snapshot_v2
execution_preflight_v2
delivery_review_v2
~~~

关闭开关只停止新流程入口，不删除新旧记录。只读历史页面应继续可用。

### 15.2 失败回滚

- Planner 失败：不改变当前有效 PlanSnapshot；
- 迁移失败：保留原 storage 文件和 migration report；
- Preflight 失败：不创建 running Project；
- TaskRun 失败：保留 TaskRun/Artifact/Transcript，按策略重试或阻塞；
- Review 驳回：保留旧 revision，创建 request changes 活动；
- Delivery 生成失败：不写 delivered；
- 用户拒绝交付：不删除 DeliveryRecord，回到 Review 或 Planning。

禁止执行破坏性 git reset --hard、删除旧任务或删除未知归属 worktree 作为自动恢复手段。

### 15.3 可观测性

每个阶段至少记录：

~~~text
actor, commandId, projectId, revision, deliveryStage,
sourceDigest, decisionDigest, planDigest, taskRunId,
beforeStatus, afterStatus, reason, evidenceIds, createdAt
~~~

指标只做观测，不覆盖事实状态。

## 16. 技术验收标准

技术方案完成必须满足：

1. pnpm typecheck、pnpm docs:check、pnpm test、pnpm build、pnpm smoke:package 通过；
2. 新旧存储都能读取，迁移失败可恢复原文件；
3. 所有 Project/Issue 执行经过统一 workspace lease 和 TaskRun；
4. stale callback、取消、重试、重启和 cleanup 具备确定性回归测试；
5. high/critical pending decision 不能审批或执行；
6. approval digest 变化可被拦截；
7. 每个 required acceptance 有 evidence 或明确 waiver；
8. 缺证据、未 Review、交付包字段缺失时不能进入 delivered；
9. DeliveryRecord 封版后不可变，代码变化创建新 revision；
10. clean Harness profile 可以完成一次本地端到端交付。

## 17. 评审需要做的决定

技术实现前由产品/维护者确认：

1. 是否将需求原始附件复制到插件存储，还是只保存 URI/hash；
2. ProjectReview 是独立表，还是未来扩展 IssueReview 的 project scope；
3. 旧 completed Project 是否允许补生成 DeliveryRecord；
4. 新增表采用 domain version 1 的兼容表策略，还是等 Host migration contract 后升级到 version 2；
5. revise 是否允许影响已执行任务，还是只能从未执行任务开始；
6. 本地交付确认是否需要强制 reviewer 与 owner 分离；
7. 后续远程 PR/部署是否作为独立 Delivery Adapter，不进入本期核心。

## 18. Agent/Squad 现状与改造原则

### 18.1 现有事实 owner

| 记录 | 当前事实 |
| --- | --- |
| AgentRecord | 全局 Persona、角色、Skills、工具策略、Runtime 和并发 |
| ProjectAgentMembership | Project 范围的资格、projectRole 和 autoAssignable |
| ProjectAgentMembershipSource | 成员来自 manual、squad 或 retained_reference 的来源 |
| SquadRecord | Leader、成员、成员职责、指令、升级策略和并行委派上限 |
| ProjectSquadBinding | Squad 与 Project 的绑定、默认团队和同步版本 |
| DelegationRecord | Leader 到成员的一次父子 Issue 委派和协作契约 |
| TaskRecord | Project Task 的最终 agentId 和测试门禁 |
| TaskRunRecord | 一次实际 Agent/Runtime 执行尝试和 workspace 证据 |
| IssueRecord | Issue owner、assignment revision 和 Review 状态 |
| AgentWorkload | Agent/Runtime 的运行时容量投影 |

不新增第二套全局 Agent 或 Squad 事实。团队改造只增加本次 Project/Plan 的责任快照和任务能力契约。

### 18.2 当前职责断点

- Planner 可以返回 suggestedAgentRole/suggestedAgentId，但没有 requiredCapabilities 和 assignment policy；
- Project Task 最终绑定单 Agent，Squad Delegation 主要发生在 Issue 层；
- Squad 成员、Runtime 和容量变化没有统一进入 Plan digest；
- Delegation Contract 有交付和验证字段，但结果没有自动映射到 Project acceptance；
- Review 发生在 Issue 层，Project 没有独立的团队责任和最终审阅快照；
- Agent/Team 配置变化可能被局部资格检查发现，但不能完整解释“哪个已批准任务因此失效”。

## 19. 目标团队模型

### 19.1 TeamCompositionSnapshot

TeamCompositionSnapshot 作为 PlanSnapshot 的嵌入对象保存，不新增一个可独立变更的全局 Team 真相：

~~~ts
interface TeamCompositionSnapshot {
  plannerAgentId?: string
  leadAgentId?: string
  reviewerAgentId?: string
  members: Array<{
    agentId: string
    projectRole: string
    source: 'manual' | 'squad' | 'retained_reference'
    skillsDigest?: string
    personaDigest: string
    runtimeId?: string
    maxConcurrency: number
  }>
  squads: Array<{
    squadId: string
    leaderAgentId: string
    memberAgentIds: string[]
    collaborationPolicyVersion?: string
    maxParallelDelegations: number
    syncedSquadUpdatedAt: string
  }>
  teamDigest: string
}
~~~

快照中的成员和 Squad 只表示“本次计划批准时采用的责任关系”，不改变全局 Agent/Squad 配置。

### 19.2 TaskAssignmentPolicy

扩展 GeneratedTask 和 TaskRecord 的规划元数据：

~~~ts
interface TaskAssignmentPolicy {
  mode: 'single_agent' | 'squad_delegation' | 'review_only'
  requiredRoles: string[]
  requiredCapabilities: string[]
  allowedAgentIds: string[]
  allowedSquadIds: string[]
  requiresIndependentReviewer: boolean
  parallelGroup?: string
  maxParallel: number
  conflictKeys: string[]
  allowedScope: string[]
  forbiddenScope: string[]
  escalationConditions: string[]
}
~~~

旧 Task 缺少该字段时默认：

~~~text
mode = single_agent
requiredRoles = []
requiredCapabilities = []
requiresIndependentReviewer = false
maxParallel = 1
~~~

这只是兼容默认，不表示旧任务已经完成能力评估。

### 19.3 DelegationRecord 扩展

不改变现有父子 Issue 结构，在 DelegationRecord 上增加本次计划和验收关联：

~~~ts
interface DelegationPlanningMetadata {
  planSnapshotId: string
  parentAcceptanceIds: string[]
  childTaskIds: string[]
  assignmentDigest: string
  evidenceIds: string[]
}
~~~

成员结果仍由 child Issue/TaskRun/Artifact/Transcript 产生；该字段只提供可追溯索引。

## 20. 团队选择与分派算法

### 20.1 候选过滤

对每个 TaskAssignmentPolicy，按以下顺序过滤：

1. AgentRecord.status 为 active；
2. ProjectAgentMembership.status 为 active；
3. membership.autoAssignable 为 true，除非是人工显式指派；
4. projectRole 满足 requiredRoles；
5. Agent capabilities/skills 满足 requiredCapabilities；
6. Agent Runtime 可用，或使用本机默认 Host；
7. Agent workload 有可用槽位；
8. allowedSquadIds 中的 Squad active；
9. Squad Leader 和成员都是 active Project 成员；
10. conflictKeys 不与当前活跃 TaskRun 冲突。

任何一项无法判断，返回 unknown 或 blocked，不当作满足。

### 20.2 稳定选择

第一版使用确定性选择，不引入模型打分：

~~~text
eligible candidates
  -> role/capability exact match
  -> projectRole specificity
  -> available capacity
  -> current utilization ascending
  -> stable agentId/squadId tie-break
~~~

Planner 可以提出推荐，但 Service 才能确认候选。审批后不允许自动替换 owner；需要显式 reassign 命令，修改 Task/Team digest 并重新审批。

### 20.3 Squad 选择

只有以下条件同时满足，Task 才能使用 squad_delegation：

- Task 明确允许 Squad；
- Squad 已绑定到 Project；
- Squad、Leader 和成员均 active；
- Squad escalation policy 可解析；
- maxParallelDelegations 未超过；
- child Issue 的 acceptance/verification 能映射到父 Project；
- parent Issue 的 Review 和 Leader 唤醒路径可用。

Squad 不直接替代 Task 的最终执行 owner。第一版继续通过 Issue/Delegation 运行团队协作；Project Task 的执行事实仍归 TaskRun。

### 20.4 容量和关键路径

Plan Review 计算：

- 每个 Agent 的 maxConcurrency、queued、working 和 availableSlots；
- 每个 Squad 的 maxParallelDelegations 和 active Delegation；
- 同一 conflictKey 的串行约束；
- 依赖图关键路径和预计等待。

容量不足可以允许审批后排队，但 UI 必须显示预计等待和阻塞原因。若产品选择“容量不足禁止审批”，则作为明确配置，不由 Planner 自行决定。

## 21. 计划、审批和成员变化

### 21.1 PlanSnapshot 绑定

PlanSnapshot 保存：

~~~text
teamCompositionSnapshot
taskAssignmentPolicies
assignmentDigest
teamDigest
capacityObservation
reviewerIndependencePolicy
~~~

审批 digest 计算必须包含：

~~~text
planDigest
requirementDigest
decisionDigest
repositoryBaseline
assignmentDigest
teamDigest
executionPolicyDigest
~~~

### 21.2 失效规则

下列变化使受影响 Task 或整个 PlanSnapshot 重新评估：

- Task owner 移出 Project；
- Agent archived、Runtime offline 或 capacity policy 变化；
- Squad Leader/成员、策略版本或并行上限变化；
- ProjectAgentMembership projectRole/autoAssignable 变化；
- Agent Persona、Skills、工具策略或模型变化；
- Task 从 single_agent 改为 squad_delegation；
- reviewer 与 implementer 发生冲突；
- Delegation contract 的 acceptance 或 forbiddenScope 变化。

影响范围计算：

~~~text
agent/member change
  -> affected task ids
  -> affected acceptance ids
  -> affected plan snapshot
  -> approval invalidation
~~~

不应因任意 Agent 的无关配置变化使所有 Project 审批失效。

## 22. Agent 上下文与证据交接

### 22.1 TaskRun Prompt Context

在现有 compileTaskPrompt() 上增加：

~~~ts
interface AgentTaskContext {
  projectId: string
  planSnapshotId: string
  teamDigest: string
  taskId: string
  assignmentPolicy: TaskAssignmentPolicy
  sourceRequirementIds: string[]
  acceptanceIds: string[]
  dependencies: Array<{
    taskId: string
    resultSummary?: string
    evidenceIds: string[]
  }>
  allowedScope: string[]
  forbiddenScope: string[]
  workspace: {
    cwd: string
    baseCommit?: string
    branch?: string
  }
  previousAttempts: string[]
  escalationConditions: string[]
}
~~~

Prompt context 生成 contextDigest 和 promptDigest，写入 TaskRun。Agent 输出是执行结果，不是新的需求或计划。

### 22.2 Leader Delegation Context

Leader 委派 child Issue 时，使用现有 DelegationContract，并补充：

- planSnapshotId；
- parentAcceptanceIds；
- childTaskIds；
- sourceRequirementIds；
- parent forbiddenScope；
- child evidence 的返回格式；
- 失败和升级触发条件；
- 允许的工作区和分支范围。

Leader 不能把自然语言中未审批的新增范围直接传给成员作为执行要求；发现 scope expansion 时创建 Decision。

### 22.3 证据汇总

证据路径：

~~~text
child TaskRun
  -> DelegationPlanningMetadata.evidenceIds
  -> child Issue review
  -> parent Issue result
  -> Project VerificationEvidence
  -> ProjectReview acceptance result
  -> DeliveryRecord evidenceIds
~~~

汇总时只增加索引和摘要，不复制或覆盖原始 Artifact/Transcript。缺少 child evidence 时，父 Issue 可以进入 blocked，但 Project 不能进入 delivery_ready。

## 23. Review 与责任分离

### 23.1 默认规则

- planner 可以是实施 Agent，但不自动获得 Review 权限；
- implementer 不能作为同一变更的唯一 Project reviewer；
- Squad Leader 可以汇总成员结果，但不能代替 Project owner 确认交付；
- verifier 可以与 implementer 相同，仅在低风险策略下允许，且必须有人工 Review；
- critical/high 风险任务必须有不同的 implementer 和 reviewer，除非人工 waive。

### 23.2 ProjectReview 输入

ProjectReview 页面和记录包含：

~~~text
teamDigest
task owner map
delegation map
verification owner map
reviewer independence result
acceptance results
waivers
escalations
~~~

DeliveryRecord 附带责任链摘要，但不把 Persona 或完整 prompt 当作交付事实；只保存版本、digest 和必要的审计引用。

## 24. API 与 schema 变更

### 24.1 Schema

在 types.ts 增加：

- AgentCapabilityProfileSchema，或在 AgentRecord 上增加可选 capabilities；
- TaskAssignmentPolicySchema；
- TeamCompositionSnapshotSchema；
- DelegationPlanningMetadataSchema；
- ReviewerIndependencePolicySchema。

能力字段第一版建议使用显式字符串数组，并限制长度；不把 Skills 描述文本直接当作强权限。

### 24.2 Planner API

GeneratedTask 增加：

~~~json
{
  "assignmentPolicy": {
    "mode": "single_agent",
    "requiredRoles": ["implementer"],
    "requiredCapabilities": ["frontend"],
    "requiresIndependentReviewer": false,
    "parallelGroup": "ui",
    "maxParallel": 1,
    "conflictKeys": ["project-form"]
  },
  "sourceRequirementIds": ["req-1"],
  "acceptanceIds": ["acc-1"],
  "decisionIds": []
}
~~~

Planner 只能推荐 requiredRoles、requiredCapabilities 和 policy，不能直接把未验证的 Agent ID 写成最终 owner。Service 在 materialize 时解析 suggestedAgentId 是否符合资格。

### 24.3 Query/Command

新增或扩展：

~~~text
GET  /projects/:id/team-plan
GET  /projects/:id/agent-candidates?taskId=...
GET  /projects/:id/team-impact
GET  /team-metrics
GET  /projects/:id/team-metrics
POST /projects/:id/reassign-task
GET  /projects/:id/validate-team
POST /projects/:id/resolve-team-blocker
~~~

使用现有 CommandRecord：

~~~text
reassign_task
bind_project_squad
sync_project_squad
validate_team
resolve_team_blocker
~~~

bind_project_squad 和 sync_project_squad 已有局部实现，改造重点是把影响的 Task、PlanSnapshot、Approval 和 DeliveryStage 一并返回，而不是另造一套绑定 API。

## 25. 测试与实施

### 25.1 必测场景

| 场景 | 预期门禁/结果 | 自动化证据 |
| --- | --- | --- |
| 单 Agent 简单 Task | 不要求 Squad，仍走统一 TaskRun、验证和 Review | `execution completes only after independent commands pass` |
| membership inactive / autoAssignable=false / capability 缺失 | 候选明确不可用并给出原因，不静默分派 | `team candidates apply membership, capability, runtime, and capacity rules with stable ordering` |
| Runtime offline、容量不足 | Team Plan 显示阻塞/等待；关联 Runtime 失效只影响已审批且实际使用它的 Project | `Runtime unavailability invalidates only approved Projects that use that Runtime`；`team collaboration metrics derive only observable assignment, delegation, evidence, and blocking facts` |
| Squad 缺成员、Leader 不在 Project、绑定策略过期 | Delegation 失败关闭，不创建 child 写入 | `Squad dispatch fails closed for a missing member, a leader outside the Project, and a stale binding` |
| parallel group / conflict / workspace 冲突 | claim 层串行化，TaskRun 累计对应等待次数和时长 | `parallel groups enforce their shared maxParallel during TaskRun claim`；`Issue TaskRun dispatcher enforces Runtime availability and enters review with evidence` |
| 审批后 Agent/Persona/Runtime/Squad/membership 变化 | 仅受影响已审批 Project 失效；Squad 初始绑定保持 revision-neutral | `agent changes invalidate every referencing project plan`；`approved team snapshots invalidate when an unassigned project member is added or removed`；`Squad bind, default, and unbind changes invalidate approved teams but initial binding is revision-neutral` |
| 显式 reassign | assignment revision/digest 更新、旧验证清理、审批失效且 Command 可审计 | `batch task assignment is atomic and increments project revision once`；`team mutations share idempotent Command records and return impact plus validation` |
| 需求域到证据覆盖 | 直接投影 `RequirementItem -> roles -> Task -> AcceptanceCriterion -> evidence`，不以父 Issue 完成代替验收 | `team plan projects requirement domain, role, task, acceptance, and evidence coverage directly` |
| child Review 缺证据或项目 acceptance 缺失 | child 缺 Artifact/通过测试时不能批准；项目仍停在 review，不能生成通过交付事实 | `Squad delegation creates a child run and approved review wakes the leader exactly once`；`execution completes only after independent commands pass` |
| implementer/reviewer 冲突与 waiver | high/critical 强制独立 Reviewer；waiver 只允许人工且字段完整、可追溯 | `high-risk tasks require an independent reviewer even without an explicit task flag`；`Project Review enforces independent human waiver details and persists the audit record` |
| Delegation 失败、升级、唤醒、重试 | retry 保留 owner/`retryOf`；Leader 唤醒幂等；无效恢复进入单一 Decision/Inbox | `a failed Delegation retries through the child Issue and preserves the Delegation owner chain`；`startup escalates an invalid Delegation into one durable Decision and Inbox item` |
| Delegation 乱序或过期结果 | `parentAssignmentRevision`、parent owner/status 三重校验，禁止覆盖重派或终态 parent | `stale delegated child Review cannot publish evidence or wake a reassigned or terminal parent` |
| Task 允许/禁止范围 | 以 TaskRun 开始时的 Git 状态为基线，只归因本次运行改变的文件；越界时保留 diff/transcript、跳过测试并创建单一 Decision | `Project Task scope gate attributes each worktree change to its TaskRun`；`Project Task scope expansion fails before verification and creates one durable Decision`；`Project Task forbidden scope takes precedence over an allowed parent path` |
| 范围证据不可用 | 非空范围契约在非 Git 或基线/结果证据失败时失败关闭，不调用 Agent（基线不可用）或测试，不把未知写成通过 | `Project Task with an enforced scope fails closed when Git evidence is unavailable` |
| 自动修复耗尽 | 第二次验证失败保留两次 TaskRun/VerificationEvidence，并幂等创建关联的 retry Decision；Inbox 不再重复投影同一失败 | `automatic Task repair exhaustion creates one durable retry Decision` |
| Host 重启 | 有效 TeamSnapshot、Delegation 和 owned child TaskRun 保留；无效 owner 显式升级 | `host restart preserves valid TeamSnapshot, active Delegation, and owned child TaskRun`；`startup escalates an invalid Delegation into one durable Decision and Inbox item` |
| digest 未变化的 replay | Command 幂等键只允许相同 payload replay；旧记录缺 digest 时失败关闭 | `command idempotency keys reject different request payloads`；`legacy Command records without a digest fail closed during replay` |

### 25.2 实施顺序

1. T0：导出当前 Agent、Project membership、Squad、Delegation 和 Runtime 关系快照；
2. T1：加入 TaskAssignmentPolicy 和 TeamCompositionSnapshot，不改变默认单 Agent 行为；
3. T2：实现候选过滤、容量/冲突检查、assignment digest 和审批失效；
4. T3：落地 VerificationEvidence、ProjectReview 责任分离和 DeliveryRecord 本地确认链；
5. T4：补齐 acceptance matrix、冲突 key 调度、Team Plan UI、指标、CLI 诊断和恢复演练。

### 25.3 回滚

- TeamSnapshot 生成失败：保留旧 PlanSnapshot，不进入 approval_pending；
- 候选计算失败：任务进入 blocked/needs_decision，不自动选 Agent；
- Team digest 变化：旧计划只读，要求显式 reassign/replan；
- Delegation 汇总失败：保留 child evidence，父 Issue 和 Project 阻塞；
- UI feature flag 关闭：仍可通过旧 Project/Issue Review 读取历史；
- 不删除旧 Agent、Squad、Delegation 或 TaskRun 记录。

## 26. 技术验收标准

智能体与团队改造完成必须满足：

1. 现有单 Agent 项目仍能不配置 Squad 地完成；
2. 复杂项目的 team composition 可以被计划、审批和交付记录复现；
3. Task 的角色、能力、冲突和 Review 要求有可解释来源；
4. Agent/Squad/Runtime/成员资格变化不会被静默忽略；
5. 容量和并行约束在审批前可见，在执行时可校验；
6. Delegation child evidence 可以关联到项目 acceptance；
7. stale Leader/member 回调不能覆盖当前 owner 或交付终态；
8. Review 责任分离和 waiver 有可审计记录；
9. Web、CLI、Service 和自动化调用同一团队校验；
10. 团队相关变更通过 schema、service、workflow、HTTP、client smoke 和端到端交付测试。

## 27. 本次代码落地范围（2026-08）

已落地的第一批闭环：

- `AgentRecord`/`AgentInput` 增加可选 `capabilities`，保留旧记录兼容；
- `TaskAssignmentPolicy` 进入 GeneratedTask、TaskRecord、TaskInput/Update，并在 materialize、approval、execution 三处复核；
- `TeamCompositionSnapshot` 由 active Project membership、provenance、Squad binding 和 Agent Runtime 信息确定性生成，保存到 Project；
- `teamDigest`、`assignmentDigest` 写入 Project/Approval/Run/TaskRun，成为审批和执行前的稳定门禁；
- `GET /projects/:id/team-plan`、CLI `team-plan PROJECT_ID` 和项目详情的 Team Snapshot 投影复用同一 Service preflight；
- Project Task Prompt 携带需求来源、验收来源、分派策略和团队 digest；
- Delegation 保存 contract/team/evidence/reviewer 关联，并禁止 delegated member 审批自己的 child delivery；
- `RequirementBundle`、`RequirementItem`、`RequirementDecision`、`AcceptanceCriterion` 已建立独立表；每次初次/追加分解都会保存来源内容、sourceDigest、批次根条目和任务级验收条目，需求矩阵会汇总 task/evidence/review/delivery 链路，高影响未决策会阻断审批和执行。
- `VerificationEvidence`、`ProjectReview`、`DeliveryRecord` 已建立独立表；Project Task 的测试命令会写入通过/失败证据，执行成功会生成 pending ProjectReview 和 ready DeliveryRecord；Review 必须独立决议，确认后才进入 delivered，另有显式 close 进入 closed；
- 新增 workflow/service 回归测试，覆盖能力筛选、独立 Reviewer、团队 preflight、计划快照读写、验证证据和交付确认。

本批次已增加 `plan_snapshots` 独立表：每次初次/追加分解都会写入 candidate 快照，审批后转为 approved，后续计划替换会把旧快照标为 superseded；Project 的 `currentPlanSnapshotId` 只作为当前指针。执行器使用拓扑就绪队列，claim 层同时校验 Agent 并发、目录锁和持久化 conflict key 锁，并在失败、取消、重启时释放或回收。当前仍不包含远程 PR、部署、生产发布或生产数据变更能力。

本轮 Agent/Squad 闭环补充：

- `TeamCompositionMember` 记录 `skillsDigest`、`personaDigest`、Runtime 状态和可用槽位；Squad 记录策略 digest，团队 digest 因此覆盖成员能力、Persona、Runtime 和 Squad 策略快照。
- `PlanSnapshot` 增加任务分派策略快照、Agent/Squad 容量观察和 Reviewer 独立性策略；旧快照字段保持可选以兼容历史存储。
- `DelegationRecord` 增加 `planSnapshotId`、父验收、子任务、来源需求、assignment digest 和 `parentAssignmentRevision`；child Review 写入 Issue、evidence、acceptance 或唤醒 Leader 前必须确认 parent 仍为原 Squad owner、仍处于 blocked 且 assignment revision 未变化，过期结果以 `delegation-owner-stale` 失败关闭。
- Service 提供统一的 `getProjectAgentCandidates`、`getProjectTeamImpact`、`validateProjectTeam`、`resolveTeamBlocker` 和显式 `reassignProjectTask`；HTTP/API Client/CLI 已提供对应查询和命令入口。候选结果逐 Task 返回独立的 `candidates` 与 `squadCandidates`，按资格、Runtime、容量和稳定 ID 排序，不能通过自然语言或静默替换绕过校验。团队阻塞通过现有 Decision/Inbox 体系记录事实、缺失能力和权限，不自动创建 Agent/Squad；解决后会使审批回到待刷新状态。Team Plan 还投影依赖关键路径、阻塞任务和 Runtime/容量等待原因供 UI 展示。
- 显式 reassign 会清理任务验证事实、递增 Project revision、更新 assignment digest、失效当前审批并写入活动审计；候选、预检和 reassign 共用同一套规则。

本轮又补齐了三个关键闭环：`getProjectTeamImpact` 返回 Task 标题/owner/状态/原因、AcceptanceCriterion 证据状态、当前 PlanSnapshot/Approval、active Issue/Delegation 与活动执行保护；Task 风险等级贯穿手动编辑、计划快照、审批前 preflight、执行门禁和最终 Review，高/关键风险强制独立 Reviewer；`GET /team-metrics` 与 `GET /projects/:id/team-metrics` 从已有记录计算团队比例、能力缺口、Runtime/容量等待、Delegation、child evidence、自审、驳回、冲突和阻塞指标。等待时长来自 TaskRun 的 `waitStartedAt/waitDurationsMs/waitCounts`，分派来源来自 `assignmentSource`，推荐后人工修改来自 reassign Activity，返工来自 retry/reassign/Review 驳回等持久化事实，Leader 重启来自 `resumeDelegationId`，Agent 利用率和阻塞时长来自 TaskRun 起止、失败/延期及后续恢复时间；缺少分母时仍不虚构比例。Delegation child Review 在没有 Artifact 或通过测试证据时会失败关闭，执行完成后项目保持 `review`，只有 ProjectReview 通过后才进入 `delivery_ready`。

Delegation 的 failed/retry/escalated 与 multi-child coordination 已完成聚焦回归：同一 coordination epoch 可提交 3 个并发 child，第 4 个在容量 3 时失败关闭；child 可乱序 Review，其中 1 个先 rejected 再 retry，旧 Review evidence 不被覆盖；全部 child review terminal 后 Leader 才恢复。测试在 Leader 唤醒前模拟 Host 崩溃并连续执行两次恢复，稳定幂等键保证仅 1 个 continuation TaskRun/Activity，最终保留 4 条 Review evidence。无效 active Delegation 仍转为 escalated，并只创建一条幂等 Decision/Inbox。

环境级门槛也已回收：真实三页 PDF 的 PDF.js 文本与浏览器 Canvas/JPEG 页 1/2/3 渲染、真实 Git clone/HEAD、31 条旧 Task 的 1+31 Issue 幂等迁移、37 字节损坏启动失败、物理备份恢复、两次 Host 重启、包内外 bundle 哈希一致均有实际证据。`ensureProjectContext` 已修正为只在 context ID 集合变化时写 Project，避免每次重启无条件刷新 `updatedAt`。当前非视觉模型会对带页面图像的 UI 导入返回结构化 `422 model-image-input-unsupported`；这是部署前置条件和真实失败语义，不是 PDF.js/Canvas 失败。当前指标仍只使用可观察事实，历史缺字段记录不回填、不估算。
