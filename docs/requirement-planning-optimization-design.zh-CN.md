# DSH 从需求到交付的插件整体优化设计方案

状态：1.5.11 本地交付范围已实施
日期：2026-08-25
适用仓库：`dsh-project-orchestrator`
目标业务仓库：通过 Project 工作目录接入的外部代码仓库，例如 `lscity-nuxt`

## 1. 设计目标

本方案从 `dsh-project-orchestrator` 这个完整插件的角度，设计“拿到需求直到最终交付”的可靠闭环。需求拆解是其中一个阶段，不是插件的全部职责。目标不是单纯增加 Planner 的任务数量，而是：

1. 区分“新增独立范围”和“对已有需求的修订”。
2. 追加拆解时能够看到并复用已有任务、需求批次和依赖关系。
3. 在产品决策未冻结时阻止相关开发任务进入可批准状态。
4. 检测重复、冲突、遗漏和跨批次依赖断裂。
5. 保存每个任务对应的需求来源和仓库证据，使计划可审阅、可追溯。
6. 保持现有人工审批、TaskRun、测试门禁和本地优先存储模型，不引入外部向量数据库或新的 LLM 供应商。
7. 让 Web、CLI、自动化和重启恢复共用同一套 Command、状态机、source of truth 和错误语义。
8. 在执行前、验证后和交付封版前设置明确门禁，形成可审阅、可复现、可回滚的本地交付包。
9. 让存储迁移、权限、安全、可观测性、升级兼容和后续交付适配器都纳入同一产品设计。

本方案不负责直接修改 `lscity-nuxt` 的业务代码，也不替产品方决定具体字段、权限和 AI 规则；它定义插件如何接住这些输入、冻结决策、组织执行并交付证据。

## 2. 已验证的现状与问题

### 2.1 当前拆解链路

```text
PDF/Markdown 导入
      ↓
需求文档（Project.prd）
      ↓
startDecomposition / appendDecomposition
      ↓
plannerPrompt（只读仓库检查）
      ↓
parsePlannerResult（JSON、代码/测试、测试命令、证据引用）
      ↓
materializeTasks（落库）
      ↓
awaiting_approval
      ↓
人工批准并执行
```

### 2.2 当前实现的关键事实

- `appendDecomposition()` 将新批次作为追加内容处理；已有任务和批次不会删除。
- `decompose()` 只把当前批次的 `title/prd/technicalDesign` 传给 Planner，没有传入已有任务、历史批次或当前计划摘要。
- `materializeTasks()` 只按 `ordinalOffset` 调整序号，并把当前批次任务 ID 映射为持久化 UUID；它不做跨批次去重、冲突分析或依赖合并。
- Planner 任务类型只有 `code` 和 `test`，没有“待产品决策”或“需求澄清”类型。
- `planComplete` 只检查代码任务、测试任务、测试命令和执行者，不能判断需求冲突或未决事项。
- Planner 输出中的 `evidenceRefs` 在解析时会校验，但在 `materializeTasks()` 和 `TaskRecordSchema` 中没有持久化。
- PDF 导入提示要求保留歧义，但导入后的 PRD 仍可能同时出现“按第 14 页执行”和“需确认第 14 页是否取代第 11 页”这类冲突表达；后续 Planner 没有独立的冲突门禁。

### 2.3 目标问题

```text
会议纪要是旧需求修订
        │
        ├─ 当前 UI 将其作为“新增需求并拆分任务”
        ├─ Planner 看不到旧任务
        ├─ 任务协议不能表达待决策事项
        └─ 审批只看结构完整
                ↓
        旧任务 + 新任务机械拼接
        重复、冲突、错误依赖进入可批准计划
```

## 3. 设计原则

### 3.1 Source of truth

- `Project.prd`：当前生效的需求基线。
- `RequirementBatch`：需求来源、修订关系和本批次生成记录。
- `RequirementDecision`：必须由人确认的产品/业务决策，不作为代码任务执行。
- `TaskRecord`：已经具备明确范围、验收标准、证据和测试门禁的执行单元。
- `planDigest`：当前 Project 计划的审批绑定事实。

不能让“会议纪要批次”“任务标题”“Planner 自己的推测”互相替代需求真相。

### 3.2 追加不等于修订

提供三个明确语义：

| 模式 | 语义 | 旧任务处理 | 典型场景 |
|---|---|---|---|
| `initial` | 首次从需求生成计划 | 无旧任务 | 新建 Project |
| `revision` | 合并修订后的完整需求并重建计划 | 替换旧任务，旧计划保留历史快照 | 会议纪要改了原需求 |
| `append` | 增加与旧计划相互独立的新范围 | 保留旧任务，只增加新任务 | 新增一个独立功能域 |

`append` 不允许作为默认值。调用方必须显式指定模式，并在追加前确认“本批次不修改已有范围”。

### 3.3 决策先于执行

如果需求存在高影响未决事项，计划可以生成候选任务，但不能进入可批准执行状态。系统应显示：

- 哪些任务受未决事项影响；
- 需要谁确认；
- 可选方案及影响；
- 确认后需要重新规划还是可以局部更新。

## 4. 目标架构

### 4.1 规划阶段拆分

```text
需求导入/编辑
      ↓
需求规范化
  - 明确事实
  - 推断
  - 待确认事项
  - 本批次模式
      ↓
仓库只读检查
      ↓
已有计划上下文构建
  - 旧批次
  - 旧任务
  - 任务证据
  - 依赖图
      ↓
候选计划生成
      ↓
确定性校验
  - 重复
  - 冲突
  - 遗漏
  - 依赖
  - 证据
      ↓
计划诊断
  - ready
  - needs_decision
  - blocked
      ↓
人工审阅/确认
      ↓
生成或替换 TaskRecord
```

### 4.2 Planner 的上下文契约

追加或修订时，Planner 必须接收结构化上下文，而不是只接收当前 PRD 文本：

```ts
interface ExistingPlanContext {
  mode: 'revision' | 'append'
  currentPlanRevision: number
  currentPlanHash?: string
  requirementBatches: Array<{
    id: string
    title: string
    mode: 'initial' | 'revision' | 'append'
    status: 'active' | 'superseded'
    prd: string
    taskIds: string[]
  }>
  tasks: Array<{
    id: string
    title: string
    kind: 'code' | 'test'
    description: string
    acceptanceCriteria: string[]
    dependencies: string[]
    evidenceRefs: string[]
    originBatchId?: string
  }>
  unresolvedDecisions: string[]
}
```

对于 `append`，Planner 必须输出每个候选任务与以下之一的关系：

- `new`：全新范围；
- `extend`：扩展已有任务；
- `replace`：替换已有任务；
- `duplicate`：与已有任务重复，应丢弃或要求确认。

对于 `revision`，Planner 输出的是完整计划，不是只针对新文档的增量计划。

## 5. 数据模型设计

### 5.1 RequirementBatch 扩展

在现有需求拆分批次基础上增加：

```ts
type RequirementBatchMode = 'initial' | 'revision' | 'append'
type RequirementBatchStatus = 'active' | 'superseded'

interface RequirementBatch {
  id: string
  title: string
  mode: RequirementBatchMode
  status: RequirementBatchStatus
  prd: string
  technicalDesign: string
  sourceRefs: string[]
  supersedesBatchIds: string[]
  decisionIds: string[]
  taskIds: string[]
  sessionId: string
  createdAt: string
  updatedAt: string
}
```

旧存储缺少新字段时使用安全默认值：首次批次为 `initial/active`，来源和决策为空，不能删除历史批次。

### 5.2 RequirementDecision

不要复用现有运行时 `DecisionRecord`。现有 DecisionRecord 面向执行期间的人机决策，需求决策应独立：

```ts
interface RequirementDecision {
  id: string
  projectId: string
  batchId: string
  key: string
  question: string
  options: Array<{
    id: string
    label: string
    impact: string
  }>
  recommendedOptionId?: string
  status: 'open' | 'resolved' | 'rejected'
  resolution?: string
  resolvedBy?: string
  resolvedAt?: string
  affectedTaskIds: string[]
  createdAt: string
  updatedAt: string
}
```

典型 `key`：

- `basic_info_interaction`
- `ai_fill_path`
- `result_visibility`
- `cross_product_direction`
- `score_color_rule`
- `ai_quality_acceptance`
- `role_permission_matrix`

### 5.3 TaskRecord 扩展

保留执行任务只有 `code/test`，增加来源和审阅字段：

```ts
interface TaskRecord {
  // existing fields...
  originBatchId?: string
  requirementRefs: string[]
  evidenceRefs: string[]
  ownershipKey?: string
  reviewState: 'candidate' | 'accepted' | 'rejected' | 'superseded'
  supersedesTaskIds: string[]
  relatedDecisionIds: string[]
}
```

`evidenceRefs` 必须从 Planner 响应完整传入落库，并在任务详情页展示。不能只在解析阶段临时校验后丢弃。

### 5.4 Project 计划就绪状态

不立即扩展 Project 生命周期枚举，而增加独立字段，降低迁移风险：

```ts
type PlanReadiness = 'ready' | 'needs_decision' | 'blocked'

interface ProjectPlanDiagnostic {
  readiness: PlanReadiness
  duplicateCandidates: Array<{ taskId: string; existingTaskId: string; reason: string }>
  conflicts: Array<{ subject: string; details: string; affectedTaskIds: string[] }>
  unresolvedDecisionIds: string[]
  unresolvedDependencyTaskIds: string[]
  missingEvidenceTaskIds: string[]
  generatedAt: string
}
```

只有 `planReadiness === 'ready'` 才允许批准执行。

## 6. 去重与冲突检测

### 6.1 确定性去重

不引入新的向量数据库。先使用可解释的确定性规则：

1. 标题规范化：去除“实现/补充/完善/增加”等通用前缀，统一同义词。
2. 模块重叠：比较 `evidenceRefs`、文件路径和模块名。
3. 验收标准重叠：对标准化后的关键词计算 Jaccard 相似度。
4. ownershipKey 冲突：同一业务 owner 的范围不能由两个任务独立声明。
5. 关系由 Planner 说明为 `new/extend/replace/duplicate`，确定性规则负责复核而不是盲信。

输出不是静默删除：

- 高置信重复：标记为 `duplicate`，默认不生成执行任务；
- 中置信重复：进入 `needs_decision`；
- 低置信相似：保留任务，但显示审阅提示。

### 6.2 冲突检测

至少检测以下冲突：

- 同一对象的字段定义不一致；
- 同一流程存在两种入口或状态流转；
- 权限规则相反；
- “禁止查看结果”和“允许查看结果”同时存在；
- 任务依赖引用不存在或跨批次无法解析；
- 任务验收标准要求的文件/接口与仓库证据不一致。

冲突必须关联到具体需求来源和任务，不能只在 Planner 摘要中提示。

## 7. API 与交互设计

### 7.1 现有接口兼容策略

保留现有接口，但改变默认安全语义：

```http
POST /projects/:id/decompositions
```

请求必须携带：

```json
{
  "mode": "append",
  "title": "独立新增范围",
  "prd": "...",
  "technicalDesign": "...",
  "taskLanguage": "zh-CN",
  "sourceRefs": ["meeting-2026-08-20"]
}
```

缺少 `mode` 时拒绝请求，不再默认追加。

```http
POST /projects/:id/replan
```

用于完整 PRD 修订。请求中的 PRD 必须是合并后的权威版本，生成后替换当前未执行计划，并将旧批次标记为 `superseded`。

### 7.2 新增诊断接口

```http
GET /projects/:id/plan-diagnostics
POST /projects/:id/requirement-decisions/:decisionId/resolve
```

用途：

- 在批准前展示重复、冲突、未决事项和依赖缺口；
- 解决产品决策后重新运行局部规划或完整规划；
- 记录决策人、时间和选项，支持审计。

### 7.3 页面文案

将当前按钮区分为：

- `合并修订并重新规划`：替换旧计划；
- `追加独立需求`：保留旧计划，仅添加独立范围；
- `查看计划诊断`：显示结构和语义检查结果。

“计划结构完整”改为分层展示：

- 结构校验：通过/不通过；
- 需求决策：已完成/待确认；
- 计划一致性：通过/存在重复或冲突；
- 执行资格：通过/缺少 Agent 或 Runtime。

## 8. 计划生成与提交流程

### 8.1 Initial

1. 导入或编辑需求。
2. 解析明确事实、推断和待确认事项。
3. 仓库只读检查。
4. 生成候选任务和需求决策。
5. 执行确定性诊断。
6. 若无高影响未决事项，进入 `awaiting_approval`；否则进入 `needs_decision` 展示态。

### 8.2 Revision

1. 用户编辑 Project 主 PRD，形成完整权威需求。
2. Planner 接收完整 PRD、旧计划和历史批次。
3. 生成完整替换计划。
4. 旧任务标记 `superseded`，不直接物理删除。
5. 新计划重新计算依赖、证据和审批哈希。

### 8.3 Append

1. 用户明确声明新增范围独立于已有计划。
2. Planner 接收旧任务摘要和完整依赖图。
3. 对每个候选任务输出新增/扩展/替换/重复关系。
4. 解析跨批次依赖。
5. 出现高置信重复或冲突时不自动批准。
6. 只有诊断通过后才追加新任务。

## 9. 失败语义

| 场景 | 结果 | HTTP |
|---|---|---:|
| 缺少 `mode` | 拒绝拆解请求 | 400 |
| 需求存在未解决高影响决策 | 返回诊断，不生成可执行批准计划 | 409 |
| 追加任务存在重复候选 | 返回候选关系，等待确认 | 409 |
| 依赖无法解析 | 丢弃本次候选写入，保留旧计划 | 422 |
| Planner 无法读取仓库证据 | 生成 blocked 结果 | 422 |
| 计划诊断通过但没有 Agent | 保留计划，不能批准执行 | 409 |
| 规划过程中 Project 被修改 | 丢弃本批次写入 | 409 |

禁止将未决事项静默当成假设，也禁止用默认字段、旧任务或缓存结果伪装为已确认需求。

## 10. 规划子系统实施分期

本节只描述需求接入、决策和计划可靠性这一子系统。插件整体从需求到交付的分阶段落地见第 21 节，不能把本节 Phase 5 的完成误认为整个插件已完成。

### Phase 0：当前项目安全恢复

- 不批准现有 31 个任务。
- 合并 PDF 与会议纪要为一份权威 PRD。
- 将会议纪要中的修订明确标注为覆盖旧规则。
- 使用“更新并重新规划”，不要继续追加。

### Phase 1：数据契约和兼容迁移

- 扩展 `RequirementBatch`、`TaskRecord` 和 `ProjectRecord`。
- 新增 `RequirementDecision` 存储表。
- 为旧 JSON 存储提供默认值和版本迁移。
- 补充 schema 与 storage 测试。

### Phase 2：Planner 上下文和模式语义

- 为 append/revision 构建 `ExistingPlanContext`。
- 强制显式 `mode`。
- 实现旧任务、批次和依赖的上下文注入。
- 增加跨批次依赖解析测试。

### Phase 3：诊断与审批门禁

- 实现重复、冲突、遗漏、证据和依赖诊断。
- 增加 `RequirementDecision` 处理流程。
- 将审批门禁从结构检查扩展为结构 + 语义检查。
- 更新项目详情页状态和按钮文案。

### Phase 4：证据与可观测性

- 持久化并展示 `evidenceRefs`、`requirementRefs`、`originBatchId`。
- 在需求批次和任务详情中显示来源关系。
- 记录规划诊断、确认、替换和追加活动。

### Phase 5：灰度与清理

- 使用 feature flag 控制新版规划器。
- 旧模式只读兼容，不再允许无模式追加。
- 观察重复率、阻塞率、人工修改率、规划失败率和执行回滚率。
- 稳定后移除无诊断的旧追加路径。

## 11. 测试设计

### Good case

- 首次需求无歧义，生成代码和测试任务，证据可追溯，计划可批准。
- 追加一个独立功能域，只生成新任务，旧任务不变。
- 修订完整 PRD 后，旧任务被 superseded，新计划依赖闭合。

### Bad case

- 缺少 `mode`。
- 会议纪要与旧字段定义冲突。
- 同一任务被两个批次重复声明。
- 普通用户权限和研究员权限冲突。
- 新任务引用不存在的旧任务。
- Planner 输出没有证据引用。

### Boundary case

- 空任务计划、只有 code 没有 test、只有 test 没有 code。
- 追加批次与旧任务只有部分验收标准重叠。
- 旧存储没有新增字段。
- 规划期间用户同时编辑 Project。
- 旧计划已有审批但尚未执行时进行 revision。
- 需求决策解决后只重新生成受影响任务，其他任务保持 ID 和证据不变。

### 建议命令

```bash
pnpm test
pnpm run typecheck
pnpm run verify:products:code
pnpm run test:smoke:mobile
```

实施时应先运行与变更模块对应的 focused test，再运行完整测试。未实际执行前，不得将计划标记为“已验证”。

## 12. 风险、回滚与残余未知

### 风险

- 新增需求决策状态会改变 Project 审批前的用户流程。
- 旧任务从物理删除改为历史保留，存储体积会增加。
- 去重规则过严可能误合并两个相似但独立的任务。
- 去重规则过松仍可能保留重复任务，因此必须提供人工确认。
- 跨批次依赖迁移可能影响已有手工任务。

### 回滚

- 通过 feature flag 关闭新版 Planner 诊断，保留只读历史记录。
- 不删除旧批次和旧任务，必要时恢复旧 Project snapshot。
- 任何新批次写入必须在计划一致性校验成功后一次性提交，失败则整体回滚。

### 尚未确定

- 是否允许只重新规划受影响任务，还是第一版统一完整替换。
- 重复检测采用何种阈值以及是否需要产品确认。
- 需求决策是否需要指定责任人和截止时间。
- 旧任务历史保留期限。

## 13. 完成标准

该优化完成的最低标准不是“能生成更多任务”，而是：

1. 会议纪要作为修订时不会与旧计划机械相加。
2. 追加模式能够看到旧计划并检测重复、冲突和跨批次依赖。
3. 未解决的高影响需求决策不能进入可批准执行状态。
4. 每个执行任务都能追溯到需求来源和仓库证据。
5. 旧数据可迁移、旧任务可回滚、规划失败不会污染当前计划。
6. good/bad/boundary 场景均有自动化测试和实际执行证据。

> 说明：以上完成标准只覆盖“需求进入规划器到计划可执行”。如果目标是让插件真正承接一次需求并交付结果，还必须补上需求接入、执行交接、验证、人工验收、交付封版和交付后复盘。以下章节是完整闭环设计。

## 14. 端到端目标与当前缺口

### 14.1 目标边界

插件的交付对象不是一组任务，而是一份可审阅、可复现、可回滚的交付包。完整链路应为：

```text
需求接入
  -> 证据固化
  -> 需求归一化
  -> 决策冻结
  -> 计划候选
  -> 计划审批
  -> 执行准备
  -> 任务执行
  -> 自动验证
  -> 人工审阅与验收
  -> 交付封版
  -> 交接/发布
  -> 关闭与复盘
```

第一版的交付范围以“本地仓库可审阅交付”为准：生成代码、测试、提交记录、验证证据和交付说明。远程 PR、自动部署和生产发布不是当前插件已经具备的能力，不应在任务描述中被默认为已包含；后续接入这些能力时，应作为新的交付适配器和新的审批门禁实现。

### 14.2 上一版设计没有覆盖的关键问题

| 缺口 | 不补的后果 | 本方案补充 |
| --- | --- | --- |
| 需求接入没有统一快照 | 同一 PDF、会议纪要或截图反复解析，来源无法复现 | `RequirementBundle` 与来源哈希 |
| 决策与计划没有正式交接 | 未决问题被 Planner 猜测，执行中反复返工 | `RequirementDecision` 冻结门禁 |
| 审批后没有执行前置检查 | 在错误分支、脏工作区或不满足能力的 runtime 上开工 | Execution Preflight |
| TaskRun 失败没有统一分类 | 业务阻塞、代码失败和运行时故障都变成“重试” | 失败分类与重试策略 |
| 验证只有命令，没有证据契约 | 测试“执行过”被误当成“需求已满足” | `VerificationEvidence` |
| 没有项目级验收 | 每个任务绿了，但需求整体仍缺入口、权限或跨模块闭环 | 验收矩阵与人工 Review |
| 没有交付封版 | 交付内容、基线、测试结果和已知风险无法一次复现 | `DeliveryRecord` |
| 没有交付后关闭规则 | 项目停在 running/completed，无法区分“已实现”和“已验收交付” | Delivery Gate 与复盘指标 |

因此，原 31 个 DSH 任务的问题不仅是拆分重复，也在于它们缺少阶段交接契约。即使把 31 个任务压缩成 18-20 个，如果没有下面的状态、证据和交付门禁，仍然不能称为可执行的交付方案。

## 15. 端到端业务链路与职责边界

### 15.1 阶段总表

| 阶段 | 阶段 owner | 输入 source of truth | 必须产出 | 允许离开阶段的条件 |
| --- | --- | --- | --- | --- |
| 需求接入 | 用户/编排器 | `RequirementBundle` | 原始文件、文本/图片快照、来源元数据 | 输入可读取且来源哈希稳定 |
| 需求归一化 | Planner | `RequirementBundle` | 需求条目、验收标准、来源引用、未知项 | 每条需求都有来源或被标记为推断 |
| 决策冻结 | 用户/指定决策人 | `RequirementDecision` | 已决定、待决定、拒绝项及影响范围 | 所有高影响未知项已决定或明确排除 |
| 计划生成 | Planner | 冻结后的需求与决策 | `PlanSnapshot`、任务图、诊断 | 任务边界清晰、依赖闭合、无未处理冲突 |
| 计划审批 | 用户/项目负责人 | `PlanSnapshot` | 审批记录、计划摘要、执行策略 | 审批快照仍与当前需求和仓库基线一致 |
| 执行准备 | 编排器 | 审批快照 | 分支/worktree、runtime、命令和权限检查结果 | 所有前置检查通过 |
| 任务执行 | Agent/Runtime | `TaskRecord` + `TaskRun` | 代码、测试、transcript、commit、artifact | TaskRun 进入终态，或明确阻塞原因 |
| 自动验证 | 编排器/测试执行器 | `VerificationEvidence` | 命令、版本、退出码、日志、报告、diff | 验收项有可核对证据 |
| 人工审阅 | 用户/评审人 | Review 状态与证据 | approve/reject/request-changes | 所有阻断项关闭或获明确豁免 |
| 交付封版 | 编排器/项目负责人 | `DeliveryRecord` | 基线、提交、文件、测试、风险、回滚说明 | 交付包完整且不可变 |
| 交接/发布 | 用户或未来适配器 | 已封版交付包 | 本地交接、PR 或发布记录 | 目标系统确认接收（本地交付则为用户确认） |
| 关闭与复盘 | 编排器 | 交付记录与活动日志 | 项目关闭、指标、未完成项、后续建议 | 交付包和审计记录均已持久化 |

### 15.2 明确哪些事情不由 Planner 负责

- Planner 只负责把已固化的需求转成可审阅的计划，不负责猜测未决产品规则。
- Planner 不得直接改变任务执行状态、写入代码或宣称测试通过。
- 编排器负责状态推进、租约、重试和证据收集，不替 Agent 修改业务结论。
- 人工评审负责接受业务结果，不应被“所有测试通过”自动替代。
- 交付封版负责记录事实，不负责把本地提交伪装成远程发布成功。

## 16. Source of truth 与数据契约

### 16.1 复用现有对象，避免再造第二套事实

当前仓库已经有 Project、Task、TaskRun、Artifact、Transcript、Decision、Approval、Issue review 等对象。优化应以扩展和关联为主：

| 事实 | 建议 owner | 与现有对象的关系 |
| --- | --- | --- |
| 原始需求及来源 | `RequirementBundle` | 新增；关联 Project 和 RequirementBatch |
| 产品/技术决策 | `RequirementDecision` | 新增；可复用现有 `DecisionRecord` 的记录方式 |
| 某次计划版本 | `PlanSnapshot` | 新增；保存任务图、诊断、输入哈希和 revision |
| 可执行任务 | `TaskRecord` | 扩展 source refs、plan revision、supersedes 信息 |
| 一次执行尝试 | `TaskRun` | 保持现有状态机，补充 preflight 和失败分类 |
| 验证事实 | `VerificationEvidence` | 新增或扩展 Artifact；不得只存一个 boolean |
| 人工验收 | `ReviewDecision` | 优先复用现有 Issue/Review 机制，必要时补项目级记录 |
| 封版交付 | `DeliveryRecord` | 新增；不可变地关联 plan、commit、证据和评审 |

禁止由多个对象分别维护“当前计划”“最新测试结果”“是否已交付”三份可写真相。派生状态可缓存，但必须能从上述 owner 重建。

### 16.2 最小数据字段

#### `RequirementBundle`

```text
id, projectId, batchId, sourceType, sourceLocator, sourceSha256,
capturedAt, capturedBy, rawAssetRefs, extractedTextRef, imageRefs,
facts[], inferences[], openQuestions[], conflictRefs[], status
```

`facts`、`inferences`、`openQuestions` 必须分开保存。PDF 中“讨论后修改”的内容只能进入 `openQuestions`，不能直接写进已冻结验收标准。

#### `PlanSnapshot`

```text
id, projectId, revision, requirementDigest, decisionDigest,
repositoryBaseline, taskIds[], dependencyDigest, diagnostics[],
generatedAt, generatedBy, status, supersedesId
```

审批绑定 `PlanSnapshot.id + revision + requirementDigest + repositoryBaseline`。其中任一项变化，原审批自动失效。

#### `VerificationEvidence`

```text
id, projectId, taskId, taskRunId, acceptanceId,
command, workingDirectory, environmentFingerprint, startedAt, finishedAt,
exitCode, stdoutRef, stderrRef, reportRefs[], changedFiles[], result,
failureClass, createdAt
```

`result=passed` 的前提是命令实际执行、退出码满足规则、报告可读取且与本次 TaskRun 关联；人工标记不能替代执行证据。

#### `DeliveryRecord`

```text
id, projectId, planSnapshotId, reviewId, repository,
baseCommit, headCommit, branch, worktree,
changedFiles[], diffStat, testSummary, evidenceRefs[],
knownRisks[], rollbackSteps[], handoffMode, handedOffAt,
deliveredBy, deliveredAt, immutableDigest
```

第一版 `handoffMode` 只支持 `local_review`。如果未来支持 `pull_request`、`staging_deploy` 或 `production_release`，每种模式都要有独立的权限、审批和结果记录。

## 17. 交付状态机与状态 owner

现有 Project `status` 继续表示项目运行状态；不要把需求决策、人工验收和发布状态全部塞进同一个枚举。新增一个正交的 `deliveryStage`（或同等语义的 Delivery Gate）：

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

任意阶段都可以进入 `blocked` 或 `cancelled`，但二者必须记录原因和恢复动作；`blocked` 不是“失败”，也不是可静默重试的中间状态。

### 17.1 状态推进规则

| 状态 | 谁可以推进 | 进入条件 | 退出条件 |
| --- | --- | --- | --- |
| `intake` | 编排器/用户 | 创建项目或收到新批次 | 资源读取成功，形成来源快照 |
| `evidence_ready` | 编排器 | 来源哈希和解析结果落库 | 需求归一化完成 |
| `decision_pending` | Planner | 存在高影响未知或冲突 | 决策人完成决定/排除 |
| `approval_pending` | Planner | 计划诊断通过 | 用户审批当前快照 |
| `execution_ready` | 编排器 | 审批有效且 preflight 通过 | 开始 TaskRun |
| `executing` | 编排器 | 至少一个 TaskRun 活跃 | 任务全部终态 |
| `verification_pending` | 编排器 | 有代码/测试产物 | 必要验证证据完整 |
| `review_pending` | 用户/评审人 | 证据和验收矩阵齐全 | approve 或 request-changes |
| `delivery_ready` | 编排器 | Review approved、交付包可生成 | 交付包封版 |
| `delivered` | 用户/编排器 | 用户确认接收本地交付包 | 关闭或进入后续发布适配器 |
| `closed` | 项目负责人 | 交付已记录，未完成项已登记 | 不允许无新批次地回写 |

过期 Agent、重复回调或重启恢复只能补充日志，不能越权推进不属于自己的状态，也不能覆盖已落库的终态事实。

## 18. 各阶段的执行契约

### 18.1 需求接入与证据固化

输入可以是 PDF、图片、文本、会议纪要或用户直接输入。接入时必须保存：

- 原始资源引用和 SHA-256；
- 解析器版本、时间和操作者；
- 页码/截图坐标/文本段落等可定位引用；
- 解析失败、OCR 不确定和权限不足等异常。

同一资源重复上传时按哈希提示“复用已有来源”或“作为新批次引用”，不能静默复制为两份需求事实。

### 18.2 需求归一化与决策冻结

每条需求至少包含：目标、范围、验收标准、来源引用、影响模块、风险和状态。`openQuestions` 应生成可追踪的决策项，至少包含：

```text
decisionId, question, options[], recommendedOption,
impact, owner, dueAt, status, chosenOption, decidedBy, decidedAt
```

高影响决策包括交互方案二选一、权限边界、结果可见性、分数规则、跨产品跳转方向、数据模型归属等。只要这些项目仍是 `pending`，Project 就不能进入 `approval_pending`。

### 18.3 计划审批与执行交接

审批页不只展示任务数量，还要展示：需求覆盖率、冲突/重复诊断、未决项、任务-来源映射、依赖图、预计命令、仓库基线和风险。

批准时写入不可变的 `ApprovalRecord`：

```text
planSnapshotId, revision, requirementDigest, decisionDigest,
repositoryBaseline, approvedTaskIds[], executionPolicy,
approvedBy, approvedAt
```

以下任一变化都必须回到 `planning` 或 `approval_pending`，不能沿用旧审批：需求来源变化、决策变化、任务图变化、仓库基线变化、执行策略变化。

### 18.4 执行前置检查（Preflight）

开始第一个 TaskRun 前，编排器必须检查：

1. Project 当前 deliveryStage 与审批快照一致；
2. 仓库基线、分支和用户未提交改动符合项目策略；
3. worktree/lease 未被其他运行占用；
4. runtime、agent、模型和所需工具可用；
5. 测试命令、写入目录和网络权限满足 allowlist；
6. 计划中的依赖任务已完成或被明确豁免。

检查失败要返回可行动的 `blocked` 原因，不得创建一个看似运行但永远不会执行的 TaskRun。

### 18.5 任务执行、重试和恢复

沿用现有 TaskRun 状态，但补充统一失败分类：

| 失败分类 | 例子 | 默认动作 |
| --- | --- | --- |
| `business_blocked` | 需求决策未定、权限不允许 | 阻塞并要求决策，不重试 |
| `dependency_failed` | 上游任务失败、接口契约不满足 | 等待修复或重新规划 |
| `code_or_test_failed` | 编译、断言、lint 失败 | 允许有限次有记录的修复重试 |
| `runtime_failed` | Agent、模型、工具或本地服务不可用 | 按策略重试，超过上限转阻塞 |
| `user_cancelled` | 用户取消或撤回 | 取消并保留已产生证据 |
| `orchestrator_error` | 编排器内部异常 | 告警、恢复或人工介入 |

重试必须有 `attempt`、原因、输入快照、输出 artifact 和上限。不得静默重试，不得把依赖失败包装成业务成功。重启恢复时，先依据 lease 和 TaskRun 终态判断是否可接管；旧进程迟到的回调不得覆盖新一轮尝试。

### 18.6 自动验证与项目级验收

验证分两层：

- **任务级**：代码任务的单元/集成测试、测试任务的断言、lint/typecheck、变更文件范围；
- **项目级**：需求覆盖、端到端流程、角色权限矩阵、页面入口、跨产品跳转、数据一致性和 PDF 中的明确验收项。

每条验收标准必须能映射到一个或多个 `VerificationEvidence`。Good、bad、boundary 至少覆盖：

- 正常创建、编辑、提交和查看结果；
- 无权限、未完成、冲突和非法输入；
- 空数据、重复提交、并发、超时、附件大小/格式边界；
- 依赖服务失败、测试失败、用户取消和恢复重试。

“命令退出码为 0”只能证明该命令通过，不能自动证明项目级需求已验收。

### 18.7 人工审阅与交付封版

Review 页面需要支持 `approve`、`request_changes`、`reject`、`waive` 四种明确结果，记录评审人、时间、针对的 plan/repository digest 和理由。`waive` 必须填写风险和责任人，不能用空备注绕过门禁。

只有满足以下条件，Project 才能进入 `delivery_ready`：

- 必要 TaskRun 已进入终态；
- 必要验证证据齐全且可读取；
- 需求-任务-证据验收矩阵无未处理项；
- 评审结果为 approve，或所有豁免均有记录；
- 交付基线和 head commit 可解析。

封版后生成不可变 `DeliveryRecord`，至少包括变更文件、diff 摘要、base/head commit、执行环境、测试结果、artifact/transcript、已知风险、回滚步骤和交付模式。任何封版后的代码变化都必须创建新 revision，不得原地修改交付记录。

### 18.8 交接、关闭与复盘

第一版本地交付的用户动作是“打开工作区/提交记录/交付说明并确认接收”。确认前项目为 `delivered`，确认后才可 `closed`。如果用户拒绝，则回到 `review_pending` 或 `planning`，并保留拒绝原因。

关闭时至少记录：未完成需求、已知风险、后续批次建议、交付耗时、重试次数、阻塞时长、人工修改次数和证据完整率。复盘数据用于调优 Planner 和任务模板，不得反向篡改历史交付事实。

## 19. 面向现有插件的最小实现方案

### 19.1 新增或扩展的接口

保持现有 API 和存储兼容，优先增加以下能力：

```text
POST /projects/:id/requirement-batches       # 保存来源快照并启动归一化
GET  /projects/:id/requirement-decisions     # 查看待决策项
POST /projects/:id/requirement-decisions/:decisionId/resolve
GET  /projects/:id/plan-snapshots/:revision
POST /projects/:id/approvals                 # 审批绑定完整快照
POST /projects/:id/preflight                  # 执行前置检查
POST /projects/:id/reviews                    # 项目级验收
POST /projects/:id/deliveries                 # 生成不可变交付包
POST /projects/:id/delivery/close             # 用户确认交付后关闭
```

实际路由命名可适配当前实现，但语义必须保持一致。当前没有远程 PR/部署连接器时，不能让 `deliveries` 接口返回“已发布”；应返回 `handoffMode=local_review`。

### 19.2 与现有代码的对应关系

- `startDecomposition` / `appendDecomposition`：改为创建 `RequirementBatch` 和 `PlanSnapshot`，追加前读取旧计划并诊断；
- `materializeTasks`：保留来源引用、plan revision、supersedes 和决策依赖；
- `approveAndStartExecution`：拆成 approval 校验、preflight、execution 三步，避免审批与开工不可观测地耦合；
- `execute`、`TaskRun` 和 lease：承担执行、重试、超时和恢复，不改变任务业务结论；
- `collectGitEvidence`、artifact/transcript：汇总为 `VerificationEvidence` 和 `DeliveryRecord` 的事实来源；
- 现有 Issue/Review：承载任务级人工审阅；项目级交付前增加统一验收矩阵；
- 现有 Project status：继续表示运行状态，新增 deliveryStage 而非重写旧枚举。

### 19.3 不在第一版做的事情

- 不重建已有角色系统和矩阵分类；
- 不新增第二套 AI Contract、评分规则或审计事实；
- 不把远程代码托管、CI/CD、生产部署假设成插件内置能力；
- 不为了“看起来闭环”引入无实际消费者的消息队列、缓存或复杂工作流引擎；
- 不删除旧批次和旧交付记录，所有 revision 通过追加不可变记录保留历史。

## 20. 端到端测试与验收矩阵

### 20.1 必须自动化的场景

| 场景 | 预期结果 |
| --- | --- |
| 首次 PDF 需求，决策完整 | 生成计划、审批、执行、验证、交付包并可关闭 |
| 会议纪要追加且与旧任务重复 | 产生 duplicate/conflict 诊断，不机械追加 |
| 关键字段未决 | 阻塞在 `decision_pending`，不能审批/执行 |
| 审批后仓库基线改变 | 审批失效，回到 `approval_pending` |
| preflight 检测到脏工作区或能力缺失 | 不创建虚假运行，记录可行动阻塞 |
| Agent 超时后重启 | lease 恢复正确，迟到回调不覆盖终态 |
| 代码测试失败 | 记录失败证据，按上限重试或阻塞 |
| 任务通过但项目级验收缺入口/权限 | 不能进入 `delivery_ready` |
| 人工 request changes | 回到执行/规划，并保留旧 revision 与评审意见 |
| 交付包字段缺失 | 封版失败，不得返回 delivered |
| 用户取消 | 取消后保留 transcript/artifact，不继续写入 |
| 服务重启/旧数据迁移 | 状态、计划、证据和历史记录可恢复 |

### 20.2 交付质量指标

第一版先记录，不以指标自动改变业务状态：

- 从需求接入到计划审批的时长；
- 计划 revision 次数、重复率、冲突率、人工修改率；
- 决策等待时长、审批驳回率；
- TaskRun 首次通过率、重试率、失败分类分布、阻塞时长；
- 验收证据完整率、项目级漏验收数；
- 从审批到交付封版的时长、交付包生成失败率、交付后回滚率。

## 21. 分阶段落地与回滚

### Phase 0：先恢复真实现场

- 把当前 Project 的 31 个任务按来源批次、任务类型和重复关系建立快照；
- 不自动删除或合并任务，只标记 duplicate/conflict/superseded 候选；
- 验证当前执行、artifact、transcript、Issue review 能否从快照恢复。

### Phase 1：需求与计划闭环

- 引入 RequirementBundle、RequirementDecision、PlanSnapshot；
- 让 append/revision 进入统一入口，审批绑定 digest；
- UI 先展示来源、决策和诊断，默认禁止无模式追加。

### Phase 2：计划到执行的安全交接

- 将 approveAndStartExecution 拆为 approval 校验、preflight、execution；
- 补齐 lease、超时、失败分类、有限重试和重启恢复；
- 增加执行前后审计活动。

### Phase 3：验证、人工验收、交付封版

- 统一 VerificationEvidence；
- 建立需求-任务-证据验收矩阵和项目级 Review；
- 生成只读 DeliveryRecord，第一版只交付本地工作区和提交记录。

### Phase 4：观测与扩展适配器

- 上报本节指标和阻塞原因；
- 稳定后再评估远程 PR、CI/CD、部署适配器；
- 每个新适配器必须复用同一 DeliveryRecord 和审批门禁。

任何阶段发现新状态 owner 不清、证据无法落库或旧数据无法恢复，应停止扩大范围，回退到上一阶段的只读能力。回滚优先关闭 feature flag 或恢复旧的 plan snapshot，不执行破坏性 reset，不删除用户工作区和交付证据。

## 22. 完整交付完成标准

“从拿到需求直到最终交付”完成的最低标准是：

1. 原始需求、解析结果、事实/推断/未决项和来源引用可复现；
2. 高影响决策在计划审批前已冻结，未决项不能被 Planner 静默猜测；
3. 计划 revision、任务来源、依赖和审批快照不可混淆，追加不会机械制造重复任务；
4. 执行前有仓库、runtime、权限、lease 和命令的 preflight；
5. 每次 TaskRun 的成功、失败、重试、取消和恢复都有真实状态与证据；
6. 任务级测试和项目级需求验收均有可读取的 VerificationEvidence；
7. 人工 Review 明确记录 approve、reject、request changes 或 waive，不能由绿灯数量代替；
8. DeliveryRecord 绑定 base/head commit、变更文件、测试结果、artifact、风险和回滚步骤，并在封版后不可变；
9. 用户确认的是明确的交付模式（当前为本地交付），插件不虚报远程发布或生产上线；
10. 重启、重复回调、依赖失败、用户取消、旧数据迁移和回滚均有测试及恢复路径；
11. 项目关闭后仍能回答：需求来自哪里、谁决定的、改了什么、如何验证、谁验收、如何交付、出了问题如何回退。

这意味着插件优化的最终交付物应从“31 个任务的计划”升级为“需求包 + 决策记录 + 计划快照 + 执行证据 + 验收记录 + 交付包”。任务数量只是其中一个派生视图，不能再作为完成度的唯一判断。

## 23. 从整个插件项目维度重新定义架构

### 23.1 插件不是 Planner，而是交付操作系统

当前仓库已经是一个本地优先的 Harness 插件，包含 Host 服务、HTTP/CLI、Web 工作台、Planner prompt、任务编排、Runtime/Agent 容量、Git worktree、Artifact/Transcript、人工审批和本地存储。优化目标应是让这些能力围绕同一条交付链路协同工作，而不是再增加一个“更聪明的拆任务提示词”。

建议把系统划分为以下边界，每个边界只拥有一种核心事实：

```text
┌─────────────────────────────────────────────────────────────┐
│ Web Workbench / CLI                                         │
│ 需求、计划、执行、验证、评审、交付的用户入口                │
└──────────────────────┬──────────────────────────────────────┘
                       │ 统一 Command / Query 契约
┌──────────────────────▼──────────────────────────────────────┐
│ Orchestrator Service                                        │
│ 权限、状态门禁、幂等、事务边界、活动审计、错误语义           │
└───────┬──────────────┬──────────────┬──────────────┬────────┘
        │              │              │              │
   Intake/Plan     Execution       Evidence       Delivery
   需求快照/决策    TaskRun/lease   测试/Git/日志   Review/封版/交接
        │              │              │              │
┌───────▼──────────────▼──────────────▼──────────────▼────────┐
│ Storage + Migration + Recovery                               │
│ Project/Batch/Plan/Task/Run/Artifact/Decision/Delivery       │
└──────────────────────┬───────────────────────────────────────┘
                       │
              Harness Host / Runtime / Agent / Git
```

### 23.2 六条插件级不变量

1. **所有写操作走统一 Command。** Web、CLI、自动化回执不能各自实现一套状态推进逻辑。
2. **客户端只展示和发起意图。** 权限、状态校验、幂等和写入必须在 Host Service 重新执行。
3. **一个事实只有一个 owner。** 计划、执行、证据、评审和交付分别由对应记录拥有，不能互相兜底。
4. **不可变事实追加，当前视图派生。** Revision、TaskRun、Artifact、Decision、DeliveryRecord 保留历史；列表和进度可以从事实重建。
5. **审批是快照门禁，不是按钮颜色。** 审批必须绑定需求 digest、计划 revision 和仓库基线。
6. **没有证据就没有成功。** 状态为 completed/delivered 的结论必须能回指实际命令、提交、评审或用户确认。

### 23.3 各代码模块的职责收敛

| 现有模块 | 应保留的职责 | 优化时禁止承担的职责 |
| --- | --- | --- |
| `src/http.ts` / `src/api-client.ts` | 输入校验、认证边界、Command/Query 传输 | 直接改存储或复制业务状态机 |
| `src/client.tsx` / `src/squad-ui.ts` | 页面、流程引导、错误和证据呈现 | 根据 UI 状态自行判断能否执行/交付 |
| `src/service.ts` | 业务规则、权限、状态推进、幂等、活动记录 | 把所有领域对象继续堆成不可测试的巨型方法 |
| `src/workflow.ts` | TaskRun、lease、runtime、Git、artifact/transcript 生命周期 | 代替业务层猜测需求或自动豁免验收 |
| `src/prompts.ts` | Planner/Agent 输入输出契约和提示词版本 | 保存计划、决定业务状态或绕过审批 |
| `src/storage.ts` | 持久化、版本迁移、备份恢复、原子写 | 在读路径偷偷补写业务事实 |
| `src/types.ts` | 跨模块 schema 和状态契约 | 用宽泛可选字段掩盖未决业务规则 |
| `src/cli.ts` | 本地回环命令入口和诊断 | 绕过 HTTP/Service 的私有写路径 |
| `tests/*` / `scripts/*` | 契约、回归、构建、包冒烟和文档检查 | 只测 happy path 并把未执行写成通过 |

## 24. 插件用户旅程与工作台设计

### 24.1 用户从需求到交付只走一条主线

Web 工作台首页应围绕一个 Project 的交付阶段组织，而不是让用户在 Inbox、Issue、Task、Runtime、Skill 页面之间猜下一步：

```text
接入需求 -> 查看来源/未知项 -> 解决决策 -> 审阅计划
   -> 批准执行 -> 查看执行与失败 -> 查看验收证据
   -> 人工评审 -> 生成交付包 -> 打开工作区/提交 -> 确认关闭
```

每个页面都要显示：当前 deliveryStage、阻塞原因、下一步唯一主操作、负责角色、输入/输出证据和失败恢复入口。不能出现“按钮可点击但 Service 会拒绝”的假可用状态，也不能只有一个“完成百分比”掩盖验收缺口。

### 24.2 页面最小集合

| 页面/区域 | 用户要回答的问题 | 必须显示 |
| --- | --- | --- |
| Project Overview | 项目现在卡在哪一步？ | deliveryStage、阻塞项、计划 revision、任务/证据/评审摘要 |
| Requirement Inbox | 需求来自哪里？哪些是事实/推断？ | 原始资源、页码/引用、批次、哈希、未知项 |
| Decision Center | 还有哪些问题不能让 AI 猜？ | 决策选项、影响、owner、截止时间、历史决定 |
| Plan Review | 计划是否覆盖需求且没有重复？ | 来源映射、冲突诊断、依赖图、任务差异、执行策略 |
| Execution Board | 哪个任务正在执行，为什么失败？ | TaskRun、lease、runtime、attempt、失败分类、日志入口 |
| Verification | 结果如何证明？ | 验收矩阵、命令、退出码、环境、报告、Git diff |
| Delivery Review | 我是否愿意接收这次交付？ | 风险、豁免、变更文件、测试、回滚步骤、评审动作 |
| Operations | 出问题如何恢复？ | 运行时、租约、存储版本、备份、恢复和诊断 |

### 24.3 CLI 与 Web 的一致性

CLI 不是另一套管理面。所有改变 Project 的 CLI 命令都应调用同一 HTTP/Service Command，并返回：`commandId`、前后状态、revision、阻塞原因和相关 evidence refs。CLI 额外提供只读诊断，例如 `snapshot`、`stats`、`inbox`，用于 Harness Host 异常时恢复现场，但不应提供绕过审批的隐藏开关。

## 25. 权限、安全与数据边界

当前安全模型是本机回环和单用户优先，并非多租户身份系统。完整设计应在不夸大安全能力的前提下把权限边界写清楚：

- **需求/计划权限：** 只有 Project owner 或具备规划资格的成员可新增批次、解决决策和提交审批；
- **执行权限：** 只有已加入 Project 且具备执行容量的 Agent/Runtime 才能领取 TaskRun；
- **评审权限：** 执行者不能单独为自己的变更完成最终验收，除非显式记录豁免；
- **交付权限：** 只有 owner/reviewer 可生成或确认 DeliveryRecord；
- **本地路径：** 所有路径来自持久化 Project，并在每次操作重新校验；不能接受浏览器任意路径；
- **凭据与 transcript：** 沿用现有环境变量过滤、脱敏和大小限制，并把“尽力脱敏”标为非 DLP；
- **命令执行：** 继续保留已批准命令和 Shell 风险提示，不从 Planner 输出直接执行未批准命令；
- **审计：** 权限拒绝、审批、决策、重试、取消、交付和回滚都记录 actor、时间、前后状态和原因。

## 26. 存储、升级与兼容性设计

### 26.1 存储演进原则

新增 RequirementBatch/Decision/PlanSnapshot/VerificationEvidence/DeliveryRecord 时，必须：

1. 为旧 JSON 存储提供显式 schema version 和幂等迁移；
2. 迁移前自动备份并输出可恢复路径；
3. 缺失历史字段按“未知”处理，不能填充成已批准/已通过；
4. 迁移失败整体不提交，保留原文件和错误报告；
5. 新版本读取旧数据后可以只读展示，不能在用户未确认时隐式重写旧计划。

### 26.2 版本与发布

插件发布必须同时验证：

- TypeScript 类型和跨模块 schema；
- Host/Web/CLI 三个入口的兼容契约；
- JSON 存储迁移、备份和恢复；
- 旧 Project/TaskRun/Artifact/Review 的只读与继续执行能力；
- 包文件白名单、CLI 权限、无绝对用户路径的 Source Map；
- 文档中的状态、命令和当前实际能力一致。

`DeliveryRecord` 的 schema 变更必须向后兼容或提供明确 migration；不能因为 UI 增加字段就破坏已封版的本地交付包。

## 27. 以插件为整体的实施任务切片

实施时不再按 PDF 的 31 个标题直接建任务，而按“一个可验证的系统切片”建任务。建议第一期拆成 10 个边界明确的工程包：

| 编号 | 工程包 | 主要范围 | 完成证据 |
| --- | --- | --- | --- |
| P1 | 现场快照与兼容迁移 | 31 个任务、批次、旧存储和当前状态盘点 | 可恢复 snapshot、迁移测试 |
| P2 | 统一需求接入 | PDF/图片/文本来源、哈希、解析失败和引用 | RequirementBundle API/UI/测试 |
| P3 | 决策中心 | 未决项、冲突、owner、冻结和失效审批 | 决策门禁测试 |
| P4 | 计划快照与差异 | replace/append/revise、去重、依赖、来源映射 | PlanSnapshot 与诊断证据 |
| P5 | 审批到执行交接 | approval digest、preflight、命令/权限/基线 | 拒绝和失效场景测试 |
| P6 | TaskRun 可靠执行 | lease、attempt、失败分类、重试、恢复 | 重启/迟到回调/并发测试 |
| P7 | 验证与验收矩阵 | 任务级/项目级证据和 Review | bad/boundary 验收证据 |
| P8 | 交付封版 | DeliveryRecord、本地交付、回滚说明 | 不可变交付包 |
| P9 | 工作台主线 | Overview、Decision、Plan、Execution、Review、Delivery | 浏览器 smoke 与可用性检查 |
| P10 | 运维与发布 | 备份恢复、指标、诊断、包验证、文档同步 | `pnpm verify` 与恢复演练 |

这些工程包之间存在明确依赖：`P1 -> P2/P3/P4 -> P5/P6 -> P7 -> P8 -> P9/P10`。UI 不应先于状态和证据契约独立开发；也不能把 P7/P8 降级为“最后补几个测试”。

## 28. 插件整体完成定义

从整个插件项目看，优化完成必须同时满足四个维度：

### 业务闭环

用户可以从一个真实需求开始，经过决策、计划、审批、执行、验证、评审和本地交付，并明确知道失败后下一步是什么。

### 系统一致性

Web、CLI、自动化和重启恢复使用同一 Command、状态机、source of truth 和错误语义；没有第二套隐藏流程。

### 交付可信度

任何“计划已批准”“任务已完成”“测试已通过”“项目已交付”的结论都可回指实际记录、命令、提交、证据和责任人。

### 产品可维护性

存储可迁移、历史可恢复、权限和安全边界明确、远程发布能力不被虚构、核心链路有自动化回归和可观测指标。

因此，这份方案的正确落点不是“把 31 个任务改成 18-20 个任务”，而是把插件从“任务计划器”收敛为“有证据、有门禁、有恢复路径的本地交付编排系统”。任务合并只是 P4 的一个子能力，不能作为整个项目的设计终点。

## 29. 方案评估结论

### 29.1 总体判断

以下判断是设计冻结时的基线；当前实现增量见 29.5 和第 30 节，不能再把这里的历史缺口当作现状：

| 评估维度 | 判断 | 说明 |
| --- | --- | --- |
| 是否覆盖从需求到交付的业务链路 | 满足 | 已覆盖接入、决策、计划、审批、执行、验证、Review、封版和关闭，并回收真实输入、迁移、恢复和并发证据 |
| 是否覆盖整个插件项目 | 满足 | 已覆盖 Web、CLI、Service、Workflow、Storage、权限、安全、升级和本地发布边界 |
| 是否与现有插件方向一致 | 满足 | 复用现有 Project、TaskRun、Artifact、Transcript、Approval、Issue Review 和本地优先模型 |
| 是否可以直接按文档拆成开发任务 | 满足 | 核心 schema、路由、状态转移和自动化验收已经落地；环境级演练单独作为上线门槛 |
| 当前代码是否已经具备设计能力 | 满足 | 已具备需求验收矩阵、Plan/Team/Assignment 快照、冲突 key 调度、ProjectReview、DeliveryRecord、delivered 和 closed 语义 |
| 是否已经能保证最终交付可信 | 满足本地交付范围 | 代码内闭环、真实 PDF/Git、31 条迁移、物理恢复、多 child 恢复、clean Harness Web/API 和桌面/移动端均已复验；不扩张到远程 PR、部署或生产发布 |

### 29.2 已经足够的部分

以下部分已经达到可以指导实现的程度：

- 明确了“追加需求”和“修订需求”的差异；
- 明确了需求来源、决策、计划、执行、验证和交付的 source of truth；
- 明确了 Planner、Service、Workflow、Review 和 Delivery 的职责边界；
- 明确了审批快照失效、重试、租约、迟到回调、阻塞和取消的失败语义；
- 明确了第一版只承诺本地交付，不虚构远程 PR、部署或生产发布；
- 明确了从插件整体角度的工程切片、回滚策略和完成定义。

### 29.3 实施前需要冻结的契约

进入大规模开发前曾要求冻结以下五组契约；当前实现已将前四组落实为 schema、状态机、关联索引和测试，第五组仍受 Host 存储契约限制：

1. **领域对象契约：** `RequirementBundle`、`RequirementDecision`、`PlanSnapshot`、`VerificationEvidence`、`DeliveryRecord` 的完整 schema、索引和存储版本。
2. **状态转移契约：** `Project.status` 与新增 `deliveryStage` 的并行关系、每个状态的唯一 owner、允许的前置状态和恢复动作。
3. **验证契约：** acceptanceId 如何从需求传到 TaskRecord，再关联到测试命令、Git diff、artifact 和项目级验收。
4. **Review/交付契约：** 当前 Issue 级 review 如何与 Project 级 review 汇合，用户确认本地交付后写入什么事实，拒绝后回到哪一阶段。
5. **兼容迁移契约：** 旧 Project、旧批次、旧 Approval、旧 TaskRun 和旧 JSON 存储如何只读兼容、如何升级、如何失败回滚。

插件持久层只暴露逻辑 KV 表，没有物理文件路径、备份、恢复或跨表事务 API。因此代码可以兼容读取旧记录并对多表写入做补偿，但不能诚实承诺“迁移失败恢复原物理文件”；该动作必须由 Host/运维层在真实 profile 中完成并验证。

### 29.4 已回收的上线门槛证据

2026-08-25 已实际回收以下验收证据：

- 真实三页 PDF 通过 PDF.js 提取 3 个文字页，并在浏览器 Canvas 渲染为页 1/2/3 的 3 张 JPEG；Service 导入正确采用已批准的 45 秒值而不是被废弃的 30 秒值。真实 GitHub 仓库已 clone，clone HEAD、`origin/main` 与独立 `ls-remote` 提交一致，持久化 URL 不含凭据；
- 31 条旧 Task 在真实 Host 存储中幂等迁移为 1 个 parent Issue 和 31 个 child Issue，保留 11 completed/done、10 failed/blocked、10 draft/todo，以及唯一 membership、source 和 legacy approval Decision；
- 停机备份后把隔离存储截断为 37 字节，Host 明确以 malformed JSON 拒绝启动且端口未监听；恢复精确备份后两次启动和全套 API 断言通过，恢复文件与备份 SHA-256 一致且重启不再无条件修改 Project `updatedAt`；
- multi-child Delegation 覆盖 3 个并发 child、第 4 个容量拒绝、部分失败、乱序 Review、retry、Leader 唤醒前崩溃和两次恢复；仅创建 1 个 Leader continuation/Activity，并保留 4 条 Review evidence；
- `pnpm run verify` 实际通过 189 个测试，并通过类型检查、43 份 Markdown 文档检查、构建和 82 文件 package smoke；桌面 1440x1000 与移动端 390x844 无页面级横向溢出或文本裁切，业务页面 console 为 0 error/0 warning。

隔离 profile 安装包与仓库 `lib/index.js` SHA-256 一致。真实 PDF 的 UI 请求也实测携带 3 个视觉页；当前配置的 `deepseek-official/deepseek-v4-flash` 不支持图片输入，API 因此按设计返回 `422 model-image-input-unsupported` 并由 UI 明示。若部署要求 UI 完成视觉归纳，必须切换视觉模型；该配置前置条件不影响 PDF.js/Canvas、Service 错误契约和本地交付状态机已完成的闭环，也不能被描述成成功归纳。

当前最准确的状态是：**设计约定的本地交付业务闭环及其非 happy-path 验收已完成；真实输入、31 条迁移、物理损坏恢复、多 child 并发/失败/乱序/重启、全量测试和浏览器回归均已有实际证据。远程 PR、部署、生产发布仍明确不在本期范围，PDF 视觉归纳的部署环境必须提供支持图片输入的模型。**

### 29.5 当前实现增量

当前代码已经落地 Requirement/Decision/PlanSnapshot、TeamCompositionSnapshot、TaskAssignmentPolicy、VerificationEvidence、ProjectReview、DeliveryRecord 和责任链；团队变更通过统一 `CommandRecord`，审批/执行会重算 digest，Delegation 证据进入项目验收，ProjectReview 的驳回/waiver 具备补偿语义。该实现增量是当前事实，第 29.1 至 29.4 中保留的设计时基线用于解释方案形成过程。
## 30. 智能体与团队组合的整体评估

### 30.1 设计时基线

设计启动时，插件的 Agent/Squad 能力已经覆盖：

- Agent 全局配置、Project 成员资格和 autoAssignable；
- Squad Leader、成员职责、升级策略和并行委派；
- ProjectSquadBinding 的资格同步；
- Delegation Contract、子 Issue、TaskRun、Issue Review 和 Leader 唤醒；
- Runtime、Agent workload 和容量投影。

当时这些能力主要解决“任务执行期间的协作”，尚未完全进入“需求到交付”的主链路：

1. Planner 只推荐 Agent 角色或 ID，没有把需求域、能力、风险和任务分派策略结构化；
2. Project Task 仍以单个 Agent 为最终 owner，Squad 主要在 Issue 层生效；
3. 团队组成、成员资格、Persona、Skills、Runtime 和容量没有统一进入计划审批快照；
4. Delegation 子任务的证据没有自动汇总到项目级验收和 DeliveryRecord；
5. 没有实施 Agent、Verifier、Reviewer 和 Project owner 的责任分离门禁；
6. 容量和并行冲突在执行时才暴露，没有在计划阶段参与关键路径；
7. 团队配置变化的影响范围不够明确，不能回答哪些已批准任务因此失效。

因此，本轮实现坚持的目标不是“默认给每个需求组建一个 Squad”，而是形成分层组合：

~~~text
简单任务：Single Agent + 人工 Review
跨域任务：Lead + Specialists + Delegation
高风险任务：Implementer + Verifier + 独立 Reviewer
重复失败：原 owner + 专家 + 人工 Decision
最终交付：执行责任人 + Reviewer + Project owner
~~~

第一版已经把 TeamCompositionSnapshot 和 TaskAssignmentPolicy 放入 PlanSnapshot/Task 规划元数据中，并冻结：

- planner、lead、implementer、verifier、reviewer；
- Project membership、Squad、Runtime 和容量快照；
- requiredRoles、requiredCapabilities、assignmentMode；
- conflictKeys、forbiddenScope、升级条件；
- team digest、assignment digest 和证据归属。

计划审批后，Agent/Squad/Runtime/成员资格变化不能被静默忽略；当前实现会按受影响的 Task、acceptance 和 PlanSnapshot 失效审批。Delegation 的 child Issue、TaskRun、Artifact、Transcript 和 VerificationEvidence 已能回溯到 Project acceptance matrix，并进入 DeliveryRecord 责任链。

详细的产品需求和技术实现见：

- [整体改造 PRD](plugin-delivery-orchestration-redesign-prd.zh-CN.md)
- [整体改造技术方案](plugin-delivery-orchestration-redesign-technical-design.zh-CN.md)

### 30.2 当前实现状态

当前代码已落地需求接入、RequirementDecision 高影响门禁、需求验收矩阵查询、独立 PlanSnapshot、VerificationEvidence、ProjectReview、DeliveryRecord 表：Agent capabilities、TaskAssignmentPolicy、Project TeamCompositionSnapshot、team/assignment digest、统一 team preflight、结构化 Task Prompt 上下文、Delegation evidence/reviewer 关联，以及初次/追加分解的 candidate/approved/superseded 计划快照。执行器使用拓扑就绪队列，并在 claim 层约束 Agent 并发、目录锁和 conflict key；执行完成会生成项目级 pending Review 和带 Git/测试摘要的 ready DeliveryRecord，Review 决议后才能 delivered，另有显式 close。ProjectReview 驳回会创建 Decision/Inbox，waiver 写入 Acceptance，失败写入通过补偿恢复原状态；DeliveryRecord 保存从计划、执行、委派、验证、Review 到 Project owner 的责任链。

在 Agent/Squad 团队组合方向，能力/Persona/Runtime/容量快照、任务分派策略快照、Reviewer 独立性元数据、Delegation 的计划与验收来源关联，以及统一候选、影响、校验和显式 reassign API 已落地。团队影响现已投影 Task、验收证据、当前计划/审批、active Issue/Delegation 和活动执行保护；Team Plan 直接建立 `RequirementItem -> roles -> Task -> AcceptanceCriterion -> evidence` 覆盖矩阵。风险等级贯穿任务编辑、preflight、执行和最终 Review，高/关键风险必须有独立 Reviewer；团队指标从 TaskRun 等待时间、分派来源、retry/reassign/Review、Leader resume 和 Agent 运行时间等持久化事实提供全局和项目级只读查询。所有团队变更通过 `CommandRecord` 审计。关联 Runtime offline/unstable、已绑定 Squad 的 bind/default/unbind/成员/策略变化会使受影响已审批 Project 失效，初始建队不制造无意义 revision；Delegation child Review 缺少 Artifact 或通过测试证据时不能通过，且 `parentAssignmentRevision` 阻止过期 child 结果覆盖已重派或终态 parent；failed/retry/escalated 和重启幂等 Decision 已有聚焦回归；项目执行完成后先进入 review，ProjectReview 通过后才进入 delivery_ready。

Task 候选查询现逐任务分别返回 Agent 与 Squad 候选。执行层不再只把 `allowedScope`/`forbiddenScope` 当作 Prompt 建议：Git-backed TaskRun 以启动时工作区为基线归因本次变化，越界、禁止路径命中或 Git 证据不可用会在测试前失败关闭并创建持久化 Decision；自动修复耗尽也会创建单一 retry Decision。该门禁修复的是执行 source of truth，UI 只展示同一 Service 结果。

### 30.3 环境验收结果与剩余边界

真实 PDF/仓库输入、31 个旧任务迁移、Host 物理损坏/备份/恢复、两次重启、复杂 multi-child Delegation 并发/部分失败/乱序/retry/Leader 恢复、clean tarball、Web/API 与桌面/移动端复验均已完成。物理恢复仍属于 Host/运维 runbook，而不是插件逻辑 KV API；本次通过真实停机、37 字节损坏和 SHA-256 恢复证明该边界可操作。新 TaskRun 的等待与利用指标仍只按持久化事实计算，历史缺字段记录不回填、不估算。剩余边界是本期明确不提供远程 PR/部署/生产发布，以及部署 PDF 视觉归纳时必须配置支持图片输入的模型；非视觉模型返回 422 是预期失败语义。
