# 任务拆解能力闭环修复设计

状态：已实施并通过验收
适用版本：`1.6.0` 及之后
目标：修复“任务看似拆出，但原始需求未完整追踪、关键决策未建模、任务无法分派”的业务断点，使任务拆解结果可覆盖、可分派、可审批、可执行、可验证。

## 1. 结论

当前问题不在任务列表 UI，而在规划写路径：

```text
PRD/技术方案
  -> PlannerResult（当前只有 tasks）
  -> bundle-root RequirementItem
  -> Task 自身验收项反向生成 AcceptanceCriterion
  -> 自由文本 requiredRoles/requiredCapabilities
  -> 精确候选匹配
  -> 原始验收丢失、Decision 为空、候选为零
```

修复后必须改为：

```text
PRD/技术方案/来源证据
  -> Requirement Analysis（需求、原始验收、未知项、决策）
  -> 确定性需求校验
  -> Repository Evidence + Team Capability Catalog
  -> Delivery Plan（任务、依赖、完成条件、需求/验收引用、能力契约）
  -> 确定性计划校验与候选计算
  -> PlanSnapshot
  -> 人工审批
  -> TaskRun/VerificationEvidence
  -> Project Review/DeliveryRecord
```

核心原则：LLM 负责提出结构化分析和计划；Service 负责 ID 映射、引用完整性、覆盖率、权限、候选、状态和审批门禁。不得让 LLM 决定授权范围，也不得用 UI 补偿服务端缺失的业务事实。

## 2. 现场问题与根因

### 2.1 原始需求未进入任务追踪链

`GeneratedPlanSchema` 只接收 `summary`、`repositoryEvidence` 和 `tasks`。Planner 无法返回结构化 RequirementItem、原始 AcceptanceCriterion 或 RequirementDecision。

`decompose()` 因此创建一个 `bundle-root`，再把 Task 的完成条件写成项目 AcceptanceCriterion。这个行为把两种不同事实混成一份：

- 项目验收标准：回答“业务需求是否交付”；
- 任务完成条件：回答“某个工程任务是否完成”。

结果是覆盖矩阵只能证明任务关联到需求包，不能证明原 PRD 的每条验收标准已覆盖。

### 2.2 Decision 门禁有实现，但没有上游事实

Service 已能阻止 high/critical pending RequirementDecision 审批，但自动拆解不会生成 RequirementDecision。门禁存在，输入事实为空，因而无法发挥作用。

### 2.3 Planner 与候选匹配使用不同词汇体系

Planner 示例使用 `implementer`、`test_implementer` 和自由文本中文能力；Project membership 使用展示型 `projectRole`，Agent capabilities 也是自由字符串。候选算法随后执行角色包含和能力精确相等匹配。

精确匹配本身符合失败关闭原则；问题是匹配两端没有共享受控词汇。放宽成 Persona/Skill 模糊推断会制造虚假资格，不是正确修复。

### 2.4 覆盖矩阵是展示投影，不是审批门禁

Team Plan 能计算 `uncovered`，但没有把未覆盖的本期必需需求或验收标准加入 preflight errors。因此即使未来写入了多条 RequirementItem，只要任务已分配，仍可能批准一个需求覆盖不完整的计划。

### 2.5 当前测试验证了组件机制，没有验证完整规划闭环

现有测试分别覆盖候选过滤、覆盖矩阵展示和任务生成，但没有覆盖以下集成不变量：

- 原始验收标准全部进入 AcceptanceCriterion；
- 每条本期必需验收映射到实施与验证任务；
- 未覆盖项阻止审批；
- Planner 只能使用候选系统理解的角色/能力标识；
- 真实复杂 PRD 不会被压缩成一个 `bundle-root`。

## 3. 修复目标与非目标

### 3.1 必须达到

1. 原始需求、原始验收、未知项和决策均有独立事实记录及来源引用。
2. 每个可执行 Task 显式引用 RequirementItem 和 AcceptanceCriterion，不通过文本相似度猜测归属。
3. 所有本期必需验收在批准前同时具备实施覆盖和验证覆盖。
4. high/critical 未决问题在批准前必须解决；不能确定时失败关闭。
5. Planner 只能使用受控角色和能力标识；Service 确定候选和 allowed 集合。
6. 没有合格候选时保留计划和诊断，但不能批准或执行。
7. append、revise、重试和 Host 重启后，当前 Requirement/Plan source of truth 唯一且可复现。
8. 规划覆盖与执行证据分开显示，不能把“已计划”写成“已验证”。

### 3.2 不在本修复中

- 不按固定数量拆任务；任务数由业务边界、依赖、风险和仓库结构决定。
- 不从 Persona、Skills 描述或 Agent 名称推断执行权限。
- 不自动创建 Agent、自动扩 Squad 或静默修改成员资格。
- 不回填旧计划并声称旧计划已满足新契约。
- 不改变 TaskRun、workspace lease、Project Review 和 DeliveryRecord 的既有事实 owner。

## 4. Source of truth 与职责

| 业务事实 | Source of truth | 写入 owner | 读取用途 |
| --- | --- | --- | --- |
| 原始来源包 | RequirementBundle | Requirement Analysis Service | 来源与版本追踪 |
| 原子需求 | RequirementItem | Requirement Analysis Service | 范围与覆盖矩阵 |
| 原始项目验收 | AcceptanceCriterion | Requirement Analysis Service | 审批与交付门禁 |
| 待决问题 | RequirementDecision | Requirement Analysis Service/人工 | 规划和审批阻塞 |
| 工程计划 | PlanSnapshot + TaskRecord | Planning Service | 执行责任和依赖 |
| 角色资格 | ProjectAgentMembership.deliveryRoles | Team Service/人工 | 候选过滤 |
| 能力资格 | Agent capability IDs | Agent Service/人工 | 候选过滤 |
| 实际分派 | TaskRecord.agentId + assignment digest | Team Service/人工审批 | TaskRun owner |
| 执行证据 | TaskRun/VerificationEvidence | Workflow | 验收验证 |
| 最终交付 | ProjectReview/DeliveryRecord | Review/Delivery Service | 封版责任链 |

Project.currentPlanSnapshotId 是当前规划指针。Requirement API 默认只读取当前 PlanSnapshot 引用的 bundle；历史数据通过显式 `includeHistory=true` 查询，不能把旧 bundle 混入当前覆盖率。

## 5. 来源清单与两阶段规划模型

### 5.1 阶段 0：Source Manifest

仅要求 LLM 输出 sourceRefs 仍不足以证明“没有遗漏”。在 Requirement Analysis 前，Service 先用确定性解析器建立来源清单：

```ts
interface RequirementSourceManifest {
  sourceDigest: string
  anchors: Array<{
    id: string
    kind: 'heading' | 'acceptance_item' | 'open_question' | 'table_row' | 'paragraph'
    textDigest: string
    locator: string
    requiredDisposition: boolean
  }>
}
```

- Markdown：保留标题层级、编号列表、表格行以及“验收标准”“待确认事项”等显式区域的稳定 locator；
- PDF：Requirement Import 输出必须保留页码和块序号，Source Manifest 使用 `pdf:<hash>:page:<n>:block:<n>`；
- 附件：保存资源 URI/hash，不能只留下模型归纳后的自然语言；
- 显式验收和待确认项标记 `requiredDisposition=true`；
- Requirement Analysis 必须把每个 required anchor 映射为 Requirement/Acceptance/Decision，或给出 `deferred/out_of_scope` 分类和理由。

确定性 gate 比较 Source Manifest 与分析输出。任何 required anchor 未被消费时，分析不通过。普通叙述段落仍需要语义分析和独立 Reviewer，不能声称确定性解析已经理解全部隐含业务含义。

### 5.2 阶段 A：Requirement Analysis

先由 Requirements Discovery Agent 只读分析来源，再由 Requirements Reviewer 独立检查完整性。输出契约：

```ts
interface RequirementAnalysisResult {
  status: 'ready' | 'needs_decision' | 'blocked'
  summary: string
  requirements: Array<{
    key: string                 // 当前 bundle 内稳定，例如 REQ-001
    kind: 'fact' | 'inference' | 'unknown'
    scope: 'in_scope' | 'deferred' | 'out_of_scope'
    statement: string
    sourceRefs: string[]        // prd heading/list item、PDF page 或附件 hash
    acceptanceCriteria: Array<{
      key: string               // 例如 AC-001
      statement: string
      required: boolean
      scenario: 'good' | 'business_rejection' | 'boundary' |
        'dependency_failure' | 'security' | 'compatibility' | 'recovery'
      sourceRefs: string[]
    }>
  }>
  decisions: Array<{
    key: string                // 例如 DEC-001
    question: string
    options: Array<{ id: string; label: string; impact?: string }>
    recommendedOption?: string
    impact: 'low' | 'medium' | 'high' | 'critical'
    affectedRequirementKeys: string[]
    sourceRefs: string[]
  }>
  diagnostics: Array<{
    code: string
    severity: 'info' | 'warning' | 'error'
    message: string
    sourceRefs: string[]
  }>
}
```

要求：

- 每条 `in_scope` requirement 至少有一条 required acceptance；
- 明确写出的“验收标准”“待确认事项”必须逐条保留，不允许合并后失去来源；
- inference 必须标记，不能包装成 fact；
- unknown 若影响范围、权限、数据模型、错误语义或验收方式，必须生成 Decision；
- high/critical Decision pending 时返回 `needs_decision`，持久化需求和 Decision，但不生成可批准计划。

Requirements Reviewer 必须与 Discovery Agent 分离，并返回结构化评审结果：

```ts
interface RequirementReviewResult {
  status: 'approved' | 'changes_required' | 'blocked'
  reviewedSourceDigest: string
  reviewedAnalysisDigest: string
  missingSourceRefs: string[]
  conflicts: Array<{ sourceRefs: string[]; statement: string; impact: string }>
  untestableAcceptanceKeys: string[]
  findings: Array<{ severity: 'blocking' | 'important' | 'advisory'; message: string }>
}
```

发现来源遗漏、冲突或不可测试验收时，只允许一次聚焦修复；再次失败后持久化 blocked analysis 和 Inbox，不允许带缺口进入规划。

### 5.3 阶段 B：Delivery Planning

只有 Requirement Analysis 通过确定性校验后，Delivery Planner 才读取冻结的 requirement snapshot、已解决决策、仓库证据和团队能力目录。

```ts
interface GeneratedPlanV2 {
  contractVersion: 2
  status: 'ready' | 'needs_decision' | 'blocked'
  summary: string
  repositoryEvidence: RepositoryEvidence
  tasks: Array<{
    id: string
    title: string
    kind: 'code' | 'test'
    relationship: 'implementation' | 'verification' | 'review' | 'handoff'
    description: string
    completionCriteria: string[]
    dependencies: string[]
    sourceRequirementKeys: string[]
    acceptanceKeys: string[]
    decisionKeys: string[]
    assignmentPolicy: {
      policyVersion: 2
      mode: 'single_agent' | 'squad_delegation' | 'review_only'
      riskLevel: 'low' | 'medium' | 'high' | 'critical'
      requiredRoles: DeliveryRole[]
      requiredCapabilities: string[]
      requiresIndependentReviewer: boolean
      maxParallel: number
      parallelGroup?: string
      conflictKeys: string[]
      allowedScope: string[]
      forbiddenScope: string[]
      escalationConditions: string[]
    }
    evidenceRefs: string[]
    testCommand: string
  }>
}
```

V2 不允许 Planner 返回 `allowedAgentIds` 或 `allowedSquadIds`。这两个集合属于授权与资格结果，必须由 Service 根据 Project membership、绑定 Squad、Runtime 和能力事实计算。

Task 的 `completionCriteria` 与项目 AcceptanceCriterion 分离。为兼容现有 TaskRecord，可将 completionCriteria 写入旧 `acceptanceCriteria` 字段，但不得据此创建项目 AcceptanceCriterion。

V2 TaskRecord 新增 `planningContractVersion`、`decisionIds` 和明确的 `completionCriteria`；旧 `acceptanceCriteria` 仅作为 V1/界面兼容字段。PlanSnapshot 新增 `requirementBundleIds`、`sourceManifestDigest`、`requirementAnalysisDigest`、`requirementReviewDigest`、`requirementPromptVersion`、`plannerPromptVersion`、`planningContractVersion` 和结构化 diagnostics。

## 6. 受控角色与能力目录

### 6.1 机器角色

新增稳定的 DeliveryRole：

```ts
type DeliveryRole =
  | 'planner'
  | 'lead'
  | 'implementer'
  | 'verifier'
  | 'reviewer'
  | 'specialist'
  | 'release'
```

`ProjectAgentMembership.projectRole` 继续作为展示名称；新增 `deliveryRoles: DeliveryRole[]` 作为匹配事实。不得再对展示文本做 substring 权限判断。

### 6.2 能力标识

新增 Capability Catalog，使用稳定 ID，例如：

```text
language.typescript
framework.nuxt
framework.vue
data.prisma
data.postgresql-migration
security.authorization
test.vitest
test.playwright
test.transaction-rollback
release.package
```

Agent capabilities 和 Task requiredCapabilities 都引用 Catalog ID。描述可本地化，但 ID 不翻译。Skills 仍用于上下文增强，不作为权限或能力满足依据。

### 6.3 候选计算

Service 按以下顺序确定性过滤：

1. Agent active；
2. Project membership active；
3. autoAssignable=true，人工显式指派除外；
4. deliveryRoles 覆盖 requiredRoles；
5. capability IDs 覆盖 requiredCapabilities；
6. Runtime 结构可用；
7. 独立 Reviewer 不等于 implementer；
8. Squad 绑定、Leader 和成员资格完整；
9. conflictKeys 无活动冲突；
10. 稳定 agentId/squadId 排序。

容量不足只产生等待诊断，不取消结构资格；Runtime offline、资格缺失和能力缺失是阻塞。没有 Project 候选但存在全局合格 Agent 时，UI 可以建议“加入项目”，但不能自动加入。

## 7. 确定性校验与门禁

### 7.1 Requirement gate

以下任一情况阻止进入 Delivery Planning：

- key 重复或 sourceRefs 为空；
- in_scope requirement 没有 required acceptance；
- 显式验收条目没有进入 AcceptanceCriterion；
- unknown 影响关键业务但没有 Decision；
- high/critical Decision 未解决；
- Reviewer 报告来源遗漏或互相冲突。

### 7.2 Plan gate

以下任一情况使 PlanSnapshot.status=`blocked`：

- Task 引用不存在的 requirement/acceptance/task；
- Task 引用不存在或尚未解决、且会改变该任务行为的 Decision；
- 依赖存在环或引用跨 revision 的无效 Task；
- Task 没有 sourceRequirementKeys 或 acceptanceKeys；
- 任一 required acceptance 没有 implementation Task；
- 任一 required acceptance 没有 verification Task；
- testCommand 不在已验证仓库命令中；
- allowedScope/conflictKeys 不能由仓库证据解释；
- required role/capability 不在 Catalog；
- 没有结构合格候选；
- high/critical Task 没有独立 Reviewer。

### 7.3 Approval gate

Approval 必须同时满足：

```text
current PlanSnapshot == candidate
AND requirement planning coverage == 100% for required in_scope acceptance
AND no high/critical pending Decision
AND every Task has an eligible owner
AND dependency graph is closed
AND assignment/team/requirement/decision digests match
AND reviewer independence is satisfied or human waiver is complete
```

### 7.4 Delivery gate

规划覆盖与验证覆盖拆开：

```ts
interface CoverageRow {
  requirementId: string
  acceptanceId: string
  planningStatus: 'unplanned' | 'partial' | 'planned'
  verificationStatus: 'unverified' | 'partial' | 'verified' | 'failed' | 'waived'
  implementationTaskIds: string[]
  verificationTaskIds: string[]
  evidenceIds: string[]
}
```

Approval 检查 planningStatus；delivery_ready 检查 verificationStatus。任务刚拆出时不得显示成“需求已覆盖/已验证”，应显示“计划覆盖完成，尚未执行验证”。

## 8. 持久化和一致性

### 8.1 ID 映射

Planner 只返回 bundle 内 local key。Service 在一次 materialization 中建立：

```text
REQ-001 -> <bundleId>:requirement:REQ-001
AC-001  -> <bundleId>:acceptance:AC-001
DEC-001 -> <bundleId>:decision:DEC-001
task-a  -> generated Task UUID
```

所有引用校验通过后才写入。不得让 Planner 生成数据库 ID。

Task 的 `decisionKeys` 同步映射为持久化 `decisionIds`。Decision 解决、改判或变为 deferred 时，所有引用它的 candidate/approved Task 和 PlanSnapshot 必须按影响范围失效。

### 8.2 无跨表事务时的写入顺序

当前 Host 只提供逻辑 KV 表，采用项目指针提交协议：

1. 写新 RequirementBundle、Item、Acceptance、Decision；
2. 写新 Task；
3. 写 candidate/blocked PlanSnapshot，其中保存 `requirementBundleIds`；
4. 最后更新 Project.currentPlanSnapshotId；
5. 项目指针成功后再把旧 PlanSnapshot 标记 superseded；
6. 任一步失败，补偿删除本次新记录，旧 Project 指针保持不变。

Requirement/Decision digest 必须来自即将提交的内存快照，不能在半写入状态从全表重新扫描计算。

### 8.3 initial、append、revise

- initial/replace：新 PlanSnapshot 只引用新 bundle 和新任务；旧记录只读保留。
- append：新 PlanSnapshot 引用当前 bundle 集合加新增 bundle，保留旧任务映射。
- revise：只替换受影响 Requirement/Acceptance/Task；未受影响引用保持稳定，旧版本由 supersedes 链追踪。

当前 API 默认只返回 currentPlanSnapshotId 引用的数据，防止历史 active item 混入当前覆盖矩阵。

## 9. 错误语义和用户动作

使用结构化 diagnostic code，不再只返回拼接字符串：

| code | 语义 | HTTP/状态 | 用户动作 |
| --- | --- | --- | --- |
| `requirement-source-uncovered` | 来源验收未进入模型 | 422 / blocked | 重新分析或人工补充 |
| `requirement-decision-pending` | 高影响决策未解决 | 409 / needs_decision | 解决 Decision |
| `plan-reference-invalid` | 任务引用不存在 | 422 / blocked | 重新规划 |
| `acceptance-implementation-missing` | 验收无实施覆盖 | 409 / blocked | 补实施任务 |
| `acceptance-verification-missing` | 验收无测试覆盖 | 409 / blocked | 补验证任务 |
| `assignment-capability-missing` | 项目无所需能力 | 409 / blocked | 配置能力/加入成员 |
| `assignment-role-missing` | 项目无所需角色 | 409 / blocked | 配置 delivery role |
| `reviewer-independence-missing` | 缺独立 Reviewer | 409 / blocked | 加 Reviewer 或人工 waiver |
| `planning-stale` | 需求、团队或仓库基线变化 | 409 / superseded | 重新规划 |
| `planning-persistence-failed` | 写入或补偿失败 | 500 / planning | 检查存储并重试 |

依赖失败不得包装为 success；LLM 返回非法或不完整结果最多聚焦修复一次，仍失败则生成 blocked snapshot/Inbox，不回退到 `bundle-root`。

## 10. API 与 UI

### 10.1 API

保留现有 API，扩展响应：

- `GET /projects/:id/requirements`：默认当前 snapshot，返回 source coverage、Decision 和历史查询参数；
- `GET /projects/:id/team-plan`：返回 planningCoverage、verificationCoverage 和结构化 diagnostics；
- `GET /projects/:id/agent-candidates?taskId=...`：返回 required/actual role、capability 差集和建议动作；
- `GET /projects/:id/validate-team`：使用同一 Service preflight；
- `POST /projects/:id/resolve-team-blocker`：只能执行显式、可审计的 add/reassign/replan 动作；
- `POST /projects/:id/requirement-decisions/:decisionId/resolve`：解决后使受影响 candidate plan stale，并要求重新规划。

### 10.2 审批页

审批页按顺序显示：

1. 来源需求：总数、本期数、deferred/out_of_scope；
2. 原始验收：规划覆盖数、缺实施数、缺验证数；
3. 待决问题：按 impact 排序；
4. 任务：依赖、范围、风险和测试命令；
5. 分派：候选、缺失角色/能力、容量等待；
6. 审批门禁：阻断项及唯一下一步动作。

按钮文案区分“检查分配”“解决需求决策”“补齐验收覆盖”“重新规划”。不能把所有失败统一显示为“未分配执行者”。

## 11. 兼容与迁移

1. 新增 `planningContractVersion=2`；旧 Plan/Task 继续只读和执行既有兼容逻辑。
2. 新生成计划必须使用 V2，不允许解析失败后静默降级 V1。
3. 旧 Agent capability 文本保留；只有映射到 Capability Catalog 的 ID 才参与 V2 自动匹配。
4. 默认 Agent 执行一次幂等 backfill：Software Engineer -> implementer，Test Engineer -> verifier，Code Reviewer -> reviewer 等。
5. 自定义 Agent 不自动推断；UI 要求人工确认 deliveryRoles 和 capability IDs。
6. 当前 `lscity-nuxt` revision 7 标记为 legacy candidate。修复发布后使用“替换当前计划”重新拆解，不直接修改其 11 个 Task 冒充新闭环。

## 12. 测试设计

### 12.1 Schema/Workflow 单元测试

- RequirementAnalysisResult good/needs_decision/blocked 三分支；
- Source Manifest 对 Markdown 编号验收、待确认列表、表格行和 PDF 页块生成稳定 locator；
- required source anchor 未被消费、被重复消费或只有无理由 out_of_scope 分类时拒绝；
- Requirement Reviewer digest 不匹配、发现遗漏、冲突或不可测试验收时拒绝；
- 重复 key、空 sourceRefs、unknown 无 Decision、非法 Decision 引用拒绝；
- Plan V2 悬空 requirement/acceptance/task 引用拒绝；
- DAG、verified command、completionCriteria 和 evidenceRefs 校验；
- Planner 不得返回 allowedAgentIds/allowedSquadIds；
- local key 到持久化 ID 的稳定映射。

### 12.2 Service 集成测试

- 原始验收逐条持久化，不再生成 bundle-root；
- 每条 required acceptance 同时关联实施和验证任务；
- uncovered requirement/acceptance 阻止审批；
- high/critical pending Decision 阻止规划/审批，解决后可重新规划；
- Decision 变化只使引用它的 Task/Plan 失效，未受影响历史保持可追踪；
- Project pointer 最后提交，任一步写失败完整补偿；
- replace 不混入旧 bundle，append 保留旧覆盖，revise 只影响目标范围；
- requirement/team/assignment digest 变化使审批 stale；
- 当前与历史 requirements 查询隔离。

### 12.3 分派测试

- canonical deliveryRoles 和 capability IDs 精确匹配；
- 展示角色相似但 deliveryRoles 不满足时拒绝；
- Persona/Skill 包含关键词但 capability 未声明时拒绝；
- 无项目候选但有全局候选时只建议加入；
- 容量耗尽显示等待但不伪装为立即执行；
- Runtime offline、membership inactive、autoAssignable=false 明确阻塞；
- high/critical implementer 与 Reviewer 相同则拒绝；
- Squad Leader/成员/绑定不完整时失败关闭。

### 12.4 非 happy-path

- Planner 第一次漏掉验收，聚焦修复后仍不完整则 blocked；
- 并发修改团队和需求导致 stale decomposition；
- Requirement 写成功但 Task 写失败；
- PlanSnapshot 写成功但 Project pointer 写失败；
- Host 重启后 blocked plan、Decision 和当前指针一致；
- append/revise 重放保持幂等；
- Decision 解决与 replan 并发时旧结果不能覆盖新 revision；
- 测试证据失败时 verificationCoverage=failed，不能进入 delivery_ready。

### 12.5 真实验收样本

以 `lscity-nuxt` 当前完整 PRD 作为固定回归样本：

- 21 条显式验收标准必须各自拥有 sourceRef 和独立 AcceptanceCriterion；
- 27 条显式待确认事项必须逐条进入 Decision 或提供可审计的“不影响本期”分类依据；
- 所有本期 required acceptance 的 planningCoverage 为 planned；
- AI 补齐、导航/首页、角色权限、项目对比、城链矩阵、AI 分析等不能静默遗漏；
- 团队未配置时明确显示角色/能力缺口；配置合格 implementer/verifier/reviewer 后任务可确定性分派；
- 任务数量不作为断言，覆盖和责任链才是断言。

最终执行：

```text
pnpm typecheck
pnpm docs:check
pnpm test
pnpm build
pnpm smoke:package
clean profile 安装包 smoke
真实 PRD -> requirement analysis -> decision -> plan -> assignment -> approval 浏览器回归
```

## 13. 实施顺序

主要代码责任边界：

| 文件 | 修改职责 |
| --- | --- |
| `src/types.ts` | V2 analysis/plan/review schema、DeliveryRole、Capability Catalog、PlanSnapshot/Task 兼容字段 |
| `src/prompts.ts` / `src/service.ts` prompt 区域 | 分离 requirement analysis、requirement review、delivery planning 提示词和受控上下文 |
| `src/workflow.ts` | 结果解析、Source Manifest 引用校验、V2 计划引用/DAG/覆盖校验、Task materialization |
| `src/service.ts` | 阶段编排、候选派生、preflight/approval gate、补偿写、digest 和 stale 处理 |
| `src/storage.ts` | 新记录表和旧 Host 可选表兼容 |
| `src/http.ts` / `src/api-client.ts` | 结构化 diagnostics、当前/历史 requirements 和显式修复动作 |
| `src/client-types.ts` / `src/client.tsx` | 来源覆盖、Decision、任务覆盖和分派阻塞分层展示 |
| `tests/workflow.test.mjs` | Schema、解析、引用、覆盖和 materialization 单元测试 |
| `tests/service.test.mjs` | 状态、写入补偿、审批、Decision、candidate 和 snapshot 集成测试 |
| `tests/http.test.mjs` / `tests/client-bundle.test.mjs` | API 契约与 UI bundle 回归 |

### P0：契约和失败测试

- 增加 V2 schema、固定回归 fixture 和预期失败测试；
- 修正文档中“已完整闭环”的不准确表述；
- 不改变现有生产写路径。

### P1：Requirement Analysis

- 实现独立分析/评审结果契约；
- 持久化 RequirementItem、AcceptanceCriterion、RequirementDecision；
- 实现 current snapshot 范围读取和 Decision gate。

### P2：Planning V2 与覆盖门禁

- Planner 只消费冻结需求快照；
- 实现引用映射、planningCoverage 和 plan diagnostics；
- 将 uncovered/missing verification 纳入 approval preflight。

### P3：角色能力与候选

- 加入 DeliveryRole 和 Capability Catalog；
- Service 派生 allowed Agent/Squad 与 owner；
- 默认 Agent 幂等 backfill，自定义 Agent 人工确认。

### P4：UI 与兼容迁移

- 分开展示需求、验收、决策、任务和分派阻塞；
- V1 只读兼容，V2 replace/replan；
- 补齐 API、CLI 和文档。

### P5：全量与真实验收

- 聚焦测试、全量 verify、package smoke；
- clean profile 和真实 `lscity-nuxt` PRD 回归；
- 浏览器验证审批按钮只在所有门禁满足后可用。

## 14. 发布、回滚和观测

### 14.1 发布

- 先发布兼容读和 V2 schema，再启用 V2 写；
- 以 `planningContractVersion` 记录每个计划使用的契约；
- V2 默认先对新项目启用，验证后允许旧项目显式 replace。

### 14.2 回滚

- 关闭 V2 写时，规划入口返回明确 unavailable，不回退生成 V1 bundle-root；
- 已生成 V2 snapshot 保持只读，旧 V1 数据不删除；
- Project 指针提交失败时恢复旧指针；
- Agent backfill 幂等且只增加结构化 role/capability 映射，不覆盖用户 Persona/Skills。

### 14.3 指标

至少记录：

- source acceptance count / persisted acceptance count；
- required acceptance planning coverage；
- pending Decision by impact；
- tasks with eligible candidates / total tasks；
- missing role/capability diagnostics；
- planner repair attempts and blocked outcomes；
- approval rejection reasons；
- replan and reassignment rate。

指标只用于观测，不覆盖 Requirement、Task、Evidence 或 Approval 的真实状态。

## 15. 完成定义

只有同时满足以下条件，才能声称“任务拆解能力满足预期”：

1. Planner 输出不再只有 tasks，原始需求、验收和决策完整进入领域模型；
2. 所有本期 required acceptance 在批准前有实施和验证任务；
3. 未覆盖、未决高风险问题、无合格执行者或缺独立 Reviewer 均失败关闭；
4. Service 使用受控角色/能力确定性分派，不依赖自然语言模糊推断；
5. planning coverage 与 verification evidence 分离；
6. append/revise、失败补偿、并发 stale 和重启均有自动化证据；
7. `lscity-nuxt` 真实 PRD 回归证明 21 条验收不遗漏、27 条待确认可追踪；
8. 全量测试、构建、package smoke 和浏览器回归实际通过。

在这些证据完成前，只能表述为“已生成候选任务计划”，不能表述为“需求拆解已闭环”或“需求已交付”。
