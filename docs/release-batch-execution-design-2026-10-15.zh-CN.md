# 发布真实评测执行与验收补充方案

日期：2026-10-15，2026-10-16 更新。范围：隔离 Harness、8 个固定公开仓库；原 24 个独立需求样本加 1 个无执行者对照，共 25 样本、至少 125 次有效 fresh planning。模型沿用已授权的 pockapi / gpt-6.1-sol。此文档不表示正式发布资格通过。

2026-10-16T15:13Z：当前结果见[最新验收报告](project-acceptance-2026-10-16.zh-CN.md)。256 项能力已登记。v29 已完整自然收口，4 条有效候选中 3 条达标、Ky 1 条质量失败，0 模型失败；正式 gate 退出 1。v30 修复代码闭包挤占命令及编译配置证据的问题，保持 64/96 KB 总预算和所有质量门槛不变。压力回归修前失败，修后完整验证退出 0（522 Node、6 browser 等）；七项关键声明、package.json 和三个 tsconfig 的完整性均已核实。新包隔离安装、256 项能力、V2 canary 及 20 组历史证据复核通过；25 项 Gold 已启动独立审阅，真实诊断的修后输入 ready，其余对照仍在途。诊断不计正式候选，整体验收仍未通过。

## 历史批次记录

本节的“当前”“正在”“等待”均描述当时状态；最新授权及运行结论以上方验收报告为准。

task-boundary 批次收口：共有 6 attempts、5 candidates、1 model_failure；无执行者对照 4 次正确弃权、1 次验证任务空范围而违反既有 Schema，外加 1 条正确未决候选。正式 gate 退出 1，已停止新增请求，所有失败保留。新增验证范围提示词澄清（evidence-grounded-v3.3.27）不放宽 Schema、不强迫写代码或扩大 Binding，回归修前失败、修后通过，正在完成验证和新版本复验。下文的“首条通过”是该失败批次中真实保留的局部结果。

当前批次为 release-verification-scope-2026-10-16。隔离安装 bundle `a660554847cd0cfff4df2c1cbdf63d3c22871e6298b569bf8a89eff8977c22dd` 与本地一致，原 canary 再次复核；9 个 blocked 场景 Gold 均已独立 approved，先各采集 fresh-1，质量达标后在同一账本补 fresh-2..5。账本为 `output/acceptance/release-collection-verification-scope-2026-10-16.json`，manifest 为 `planning-evals/release-manifest-verification-scope-2026-10-16.json`。ready 部分仍等待具体 204 项能力确认，不复用 greeting 的人工授权。

本地 `PO_TEST_BROWSER_CHANNEL=chrome pnpm verify` 已退出 0（478 Node、6 browser、类型/文档、显式原 fixture 的 5 条运行、145 文件包检查）。本地子集参数不允许与 --release / --manifest 同用，真实发布评分和全部历史失败保留；本地回归通过不代表正式 release gate 通过。

2026-10-16 更新：用户明确本批次 token“不限制”，不再等待预算数字。旧版 40/40 个未决候选符合预期，但第 25 项无成员反例前 4 次真实运行均在需求阶段错误阻塞，旧批次已保留质量失败，正式 release gate 退出 1。已修复需求分析/审阅阶段职责（requirements-v2.10），476 项 Node、6 项浏览器、类型/构建/包验证通过，并安装隔离新包。真实对照已通过需求阶段，随后因漏配独立 Reviewer 正确阻塞，暴露原 Gold 的前置条件错误。新输入只增加非执行 Reviewer，重新独立审阅后单次真实复验中；尚未证明最终弃权正确。新批次与旧失败批次分开记录，不修改旧 Gold/候选或阈值。新版本 8 项未决 Gold 已全部独立审阅 approved，等待复验。16 项 ready 项目的 204 条项目限定能力仍为 pending，见[待确认清单](release-capability-review-2026-10-16.zh-CN.md)。ready 的 writable owner 范围在任何该类候选运行前修订，保留不需要修改的 forwarding/export 文件为只读检查，不根据候选改答案。全部原始失败、审阅修订和导出恢复保留。

v6 独立输入复审已完成，24/24 approved，见 `output/acceptance/release-independent-review-v6-2026-10-16/summary.json`；16 个 ready 项目的输入更新报告见 `output/acceptance/release-ready-inputs-updated-2026-10-16.json`。blocked 原 Gold 不回写，继续使用首次候选之前的 v5 冻结输入。本批次尚未派发任何上游实现任务。

后续真实结果：非执行 Reviewer 的场景审阅 approved / independent，但 Binding Review 正确拒绝超出原四文件限制的写入授权。已修复 Binding/Task Prompt 丢失非产品控制约束，以及将检查证据一概转为可写范围的问题；完整 476 Node、6 browser、类型/构建/文档/145 文件包验证通过，安装摘要为 `b490248d963f55adef45f940abc2034b5fcc1b50dba8626ea812e69ffbb01aa0`，原 canary 再次通过。新的 `plimit-wrapper-counts-no-executor-scope-v4` 与上次需求/团队/模型/仓库完全相同，仅 promptVersionsDigest 变化，Gold 首候选前独立 approved。单次真实采集中，尚未达标。此前重新审阅的 8 个未决 Gold 绑定的是上一 bundle，保留为历史，不能冒充本次新 bundle 的证据。旧失败和 Gold 均不覆盖。

当前执行顺序：新负例首条完整链路已通过，两个任务最终在资格阶段正确弃权；8 项未决场景使用新 case ID、原始 v5 需求和新提示词指纹，独立 Gold 审阅 8/8 approved。复用之前尚无 operation 的 40 个隔离草稿，预览核对除 promptVersionsDigest 外与原事实一致，不新增能力事实。统一 collector 正在补足余下 44 次 blocked 运行。16 项 ready 使用原项目和已复审的 v6 需求，待具体 204 条声明获确认并正式登记后，才冻结最终团队摘要和 Gold，再各运行五次。只有同一当前 bundle 的完整 25 项证据、至少 125 个有效候选及真实 canary 通过 gate，才声明通过；旧版成功不补作新版证据。

| 批次 | 已知结果 | 保留位置 |
| --- | --- | --- |
| release-real-2026-10-16 | 40 个正确未决候选、4 个需求阶段质量失败、2 条基础设施失败 | release-collection-journal-2026-10-16.json / release-manifest.json |
| release-stage-boundary-2026-10-16 | 1 条失败，缺独立 Reviewer，需求阶段已通过 | release-collection-stage-boundary-2026-10-16.json / release-manifest-stage-boundary-2026-10-16.json |
| release-reviewer-precondition-2026-10-16 | 1 条失败，Binding 越过四文件边界，场景独立审阅已通过 | release-collection-reviewer-precondition-2026-10-16.json / release-manifest-reviewer-precondition-2026-10-16.json |
| release-scope-handoff-2026-10-16 | 1 条失败，四文件 Binding 已通过，Task Planner 混同提案 ready 与执行 ready | release-collection-scope-handoff-2026-10-16.json / release-manifest-scope-handoff-2026-10-16.json |
| release-task-boundary-2026-10-16 | 6 attempts、5 candidates、1 model_failure；无执行者 4/5 次正确弃权，另有 1 条正确未决候选；批次停止 | release-collection-task-boundary-2026-10-16.json / release-manifest-task-boundary-2026-10-16.json |
| release-verification-scope-2026-10-16 | 首轮 9/9 候选全部适用指标达标：8 项正确未决，1 项正确资格弃权；同一账本补 36 次重复运行中 | release-collection-verification-scope-2026-10-16.json / release-manifest-verification-scope-2026-10-16.json |

表中 collection 文件位于 output/acceptance，manifest 位于 planning-evals。完整请求、响应、Gold、候选、operation 和失败均保留，不将数据集前置条件错误误报为模型故障，也不将正确门禁拒绝改成成功。

ready 输入准备补充：已在任何 ready Gold/候选之前，为 16 个 draft 项目配置上述非执行独立 Reviewer。正式 API 前后逐项确认只有 teamCatalogDigest 改变、204 条能力记录未变、0 operation、未创建人工能力事实；报告为 `output/acceptance/release-ready-reviewer-prepared-2026-10-16.json`。不将独立审阅角色误当合格执行成员，能力清单仍须具体确认。

最新安装追加了任务规划状态边界：提案 ready 不表示分配、发布或派发，缺执行成员必须在后续资格门禁拒绝。代码不新增状态或绕过门禁。完整 476 Node、6 browser、类型/构建/145 文件包检查通过，隔离安装摘要为 `261a73ed104010a93fd8b143c36d047a5033bfc48ed32a174bfb5b595e1c077c`，原 canary 再次通过。负例 `plimit-wrapper-counts-no-executor-task-v5` Gold 首候选前独立 approved，首条 operation `planning-v3:f457c1ef-f7db-4fbd-83e9-309fcff82248` 需求/场景/Binding/Plan 审阅通过，最终两条 abstained-no-eligible，未发布或派发。首条 gate 仍因覆盖不足退出 1，报告见 `release-gate-task-first-2026-10-16.json`。前述 b490 bundle 的 Gold 与记录继续保留，不能补作当前 bundle 的正式证据。

补充既有弃权指标的覆盖：原 8 个未决场景在 decisions 停止，原 16 个 ready 预期均有合格成员，correctAbstentionRate 没有分母。新增第 25 项 `plimit-wrapper-counts-no-member`，完整需求不变，只为这一反例固定没有任何执行成员。新增 Gold 在候选前已独立审阅 approved；5 个隔离草稿项目的 preview 均逐字段等于同一 Gold.releaseInput，才启动 5 次 fresh 采集。复制项目不增加仓库数或样本数，该项只计一个场景。原 24 项与阈值不变，完整批次计划 25 场景 / 至少 125 有效候选。该反例不需要能力确认，也不派发任务。

## v17 执行约束补充（2026-10-16）

v16 已收口且正式门禁失败，原 7 次尝试及自动后继保持原记录。拟 v17 修复冻结场景源文、完整声明/局部调用及公共入口证据，并支持来源可验证的 transient 事件；不得把瞬时通知伪造为持久化记录，也不得删掉生产者、读取、测试和逐 EVT 覆盖义务。原 256 条可信能力继续复核，不重复登记或代签。

新版须先完整本地验证，再升级隔离 3087、复核包摘要/写锁/能力/canary、冻结全部 25 Gold，才开始本版真实候选。优先复验 pretry、pqueue、Zod 暴露的失败链，然后补齐全部样本每项至少 5 次有效独立候选。旧版候选和自动策略后继不补作新版 fresh；最终同 bundle 正式 gate 退出 0 才报告验收通过。

## 当前已完成

- 修正样本：固定 commit 的 p-queue 已有 clear 拒绝等待任务，因此把该对样本改为 maxQueued 的未决与已选择场景。旧 JSON 保留为历史草案。
- 生成逐项审阅包：`output/acceptance/release-input-review-2026-10-15/review.md`，另含 24 份独立 PRD 和 `review-inputs.json`。全部保留稳定 REQ-001、AC 键、DEC-001、完整 owner 集合、当前文件摘要与拟新增测试标记。
- 追踪 Ky 的选项链发现 `source/core/constants.ts` 的 kyOptionKeys 也属于新增选项的 owner；逐项包已包含该声明，不能只改 HTTPError 构造函数。
- 核实 Zod 的 classic 与 mini 都通过共享 core 参数调用 `_stringbool`。拟定实现 owner 为 `packages/zod/src/v4/core/api.ts`，两个出口均需测试；mini 的专用 stringbool 测试标为拟新增，未伪装为已存在文件。
- 修复模型调用归属：具名 Reviewer 和 TaskPreflight 也必须使用 operation 冻结的 provider/model/maxTokens，保留成员身份与 Persona，规划期间不加载执行技能或调用工具。执行阶段仍使用成员自身配置。回归先在旧 bundle 暴露实际路由与预算不一致，修后通过。

逐项包是独立准备的预期草案，没有读取新 candidate 输出来调整答案。它没有 reviewer、human_confirmed、正式 releaseInput 或可运行标记；不计入正式 corpus。其中对非法参数、选项名及显式 undefined 的细化同样需要审阅，不视作用户已经确认的业务事实。

## 执行顺序与阻塞条件

| 步骤 | 输入与行为 | 通过条件 |
| --- | --- | --- |
| 逐项审阅 | 审阅完整 PRD、owner、验收、B/C 选择及任务键 | 24 个样本分别可追溯；8 对未决/恢复输入一致；修正已知草案错误 |
| 准备团队 | 正式接口创建/选用成员，按实际责任登记项目范围能力 | 明确可信来源、作用域、Runtime、容量、访问；不复用 greeting 的项目限定声明 |
| 运行前冻结 | 从正式项目事实计算仓库、source、团队、Decision、MetricPolicy、实际 bundle、模型与预算摘要 | Gold.releaseInput 在首个模型请求前独立确定；全部 digest 经独立审阅 |
| 预算选择 | 本批次用户明确“不限制”，记录 explicitly_unlimited；若后续选择限额，再启用独立计量门禁 | 不设隐式上限，不宣称本批次已有硬限额；单请求仍受冻结的模型容量与输出预算约束 |
| 真实采集 | 25 case 各至少五个无 predecessor 的新 operation | ≥125 个有效候选；所有错误、取消与失败也入 manifest，不挑选成功结果 |
| 发布验收 | 对完整 manifest、Gold、candidate 与已批准 canary 运行正式 release gate | 退出码 0；全部原始质量阈值通过 |

## 团队资格准备原则

实现与独立验证使用不同成员，不能把成员名称、Persona 或 Skills 字符串当作资质。逐项包中的 allowedAgentIds 保留为空缺，而非先假定所有人都有资格。

能力按任务实际写入语言和影响面准备：JavaScript 实现加声明文件通常涉及 JavaScript 与 TypeScript；纯 TypeScript owner 不额外要求 JavaScript。自动测试、接口契约和异常处理根据实际任务适用。queue / emitter 的共享状态与 Promise 调度须结合原始源码判定，不能把每个库都套上数据库迁移、发布、浏览器、HTTP 服务或安全授权能力。验证成员另需独立验证能力，且依赖实现任务。

正式声明清单应附具体项目、成员、capabilityId 与责任证据；新增确认不得外推到其他项目。模型若发现超出已审阅输入的真实能力缺口，应记录拒绝及原因，再修正下一批输入，不回写已冻结 Gold 掩盖失败。

## 批次预算保护契约

已实现独立 loopback 请求门禁 `scripts/planning-batch-budget.mjs` 和启动入口 `scripts/run-planning-batch-budget-gate.mjs`，本地模拟网关的 10 项回归通过。本批次按用户明确选择不限 token，未启动有界预算代理，不声称“真实批次硬限额已生效”。下述契约适用于后续显式选择数值限额的批次。当前采集器和 Gold 冻结器均已实际运行，授权记录保存在各审阅目录和采集账本。

预算以 `input + output` token 作为控制单位，不凭公开报价推断私有网关价格。调用前持久化预留该请求可消耗的最大输入与输出，预留失败不得发送；格式修复、SDK 重试、具名审阅与预检必须经过同一计量入口。并发预留须串行原子化，重启继续使用原账本，不清零、不超额重放。

实际 usage 可核实时才释放预留差额；断流、超时、取消或 usage 缺失时保留预留，不把未知计为 0。流式和非流式都需覆盖；网关自身不可见的内部计费须单独核实，不能承诺限制未知的额外费用。禁止在预算耗尽后创建“正确业务阻塞”候选，应该以基础设施/预算失败记入批次尝试。

已验证：发送前确已落盘、恰好额度边界、并发争抢、每次失败重试分别计费预留、未知用量不退还、两种 API 的分片 SSE usage、网关用量越界后永久停止、持久化失败时零请求、未结束请求重启恢复、配置改变或双实例拒绝。模型不符、输出超额、tools/functions、多结果生成和后台调用在发出前拒绝；模型目录只允许精确 GET `/v1/models`。账本不保存 prompt 或凭据。

通过 `node scripts/run-planning-batch-budget-gate.mjs CONFIGURATION_JSON` 启动。配置必须显式提供绝对 ledgerPath、modelId、upstreamBaseUrl、tokenLimit、inputTokenBudget、outputTokenBudget 与 loopback port；没有隐式无限额度。凭据保留在 Harness，门禁仅转发必要的 Authorization，不写入配置或日志。启动后仍需核对隔离 Host 的实际请求全部经过该端口，不能有直连 fallback；这个真实接线验证尚未执行。

每次请求按模型目录声明的完整输入/输出容量预留，而不是猜测中文字符到 token 的比例，因此剩余额度少于单请求最坏容量时会提前拒绝。用量回收依赖网关如实报告 usage 并执行其声明的模型容量；网关违反声明时只能在观察到异常后停止，不能撤销已经发生的计费。因此接入前必须核实容量上限，不把本地模拟测试等同于对私有网关计费的证明。进程崩溃遗留锁不自动抢占，需要确认原进程退出再恢复。预算耗尽不保证已完成 120 个有效候选，也不放宽最低数量和失败率阈值。

## 发布结论与恢复

2026-10-17 补充：v30 正式门禁退出 1，原账本、后继和失败保留；v31 修复诊断键契约及冻结声明证据。诊断调用只用于定位，不计 fresh；遇到真实缺证则先修产品及回归。Binding 的有焦点输入容量调整为 96 KB，真实大型类最多 128 KB，以完整声明审计验证成本与收益，不放宽质量门槛。新版仍须完整 verify、隔离安装和持久化复核、25 项独立 Gold 在候选前批准，再从零统一采集及正式收口。能力 256 项和历史 pending 保留，原 3080 Host 不动；详细状态以最新验收文档为准。

### v23 采集调度与策略替代的边界

多个独立采集器不能分别依据同一瞬时 running 数抢占槽位。原请求持久化 superseded 与自动后继登记之间存在可观察空档；必须从根请求发出直至后继终态占有同一个逻辑槽位。当前 `scripts/complete-release-planning.mjs` 使用单 owner 锁、4 条 lane、逐请求独立账本和终态观察；启动前等待既有工作收口。每个 case 同时至多一条根请求，未决补充请求复用原项目并精确对照冻结 Gold，不新建成员能力事实。

已有候选、失败和后继证明保持原文件；新编号不覆盖失败，后继不计 fresh。质量失败、未知基础设施失败或未闭合请求停止新增并 drain 其余 lane，不取消领域请求；策略替代必须先观察后继且核实预期终态。断流保留原会话错误，不将依赖失败写成业务拒绝。恢复只观察已登记请求，未明的发送结果不自动重发。最终合并全部 disjoint 账本、核实领域事实，并运行同一 bundle 的正式 release gate；采集完成状态本身不表示验收通过。

项目恢复与 operation 终态也是不同持久化边界。补充请求的只读 preview 必须在权威 Project 已回到 draft/awaiting_approval 且无 activePlanningOperationId 后进行，随后仍逐字段核对既有 Gold；禁止将 `409 project-active` 解释为业务阻塞。若故障发生在请求登记之前，仅当原空账本摘要、原预检错误日志和项目 operation 历史共同证明没有发送，才可另存 local_preflight_failure 观察并使用新编号继续。证据缺失或发送结果未知保持停止，不能靠空账本推定可重试。各 case 先完成一轮观察再重新入队补次数，同一 case 不重叠。

preview 的正式守卫还包含内存 operation registry。恢复等待在同一个 60 秒截止时间内同时检查 Project 行，并仅对只读 preview 的精确 HTTP 409 / project-active 等待清理后重新读取；其他错误立即停止，超时仍为未发送故障。该等待不重发 decompose/revise、不调用模型，不放宽输入一致性校验。回归同时模拟终态已见但 Project 未恢复、Project 已恢复但 registry 仍占用，确认最终仅派发一次独立根。

2026-10-16 补充设计：冻结模型工具被禁用，场景设计和审阅必须显式接收同一份经仓库摘要核验的有界源码证据，不能把已有 API 的访问机制推迟到 Binding。该证据进入持久化审阅输入和摘要；批准、派发、查询及继承均保留证据一致性校验，Binding 前仓库变化即拒绝。新 prompt 指纹必须重新冻结 Gold 并开启独立批次；历史 `release-verification-scope-2026-10-16` 的 13 条候选包含 1 条场景质量失败，原 gate 退出 1，不删除、不覆盖、不与修后候选混算为通过。

已批准的 greeting canary 继续有效，历史证据不回填或重签。本轮只更新隔离环境；不触碰原 3080 Host、不发布 npm、不写上游。

加入预算门禁后的完整本地验证为 471 项 Node、6 项浏览器测试通过，类型、文档、fixture 和 144 文件包检查通过，`pnpm verify` 退出 0。证据日志：`output/acceptance/verify-batch-budget-2026-10-15.log`。这些测试包含模拟模型与本地模拟网关，不能替代真实质量对照。

最新完整本地验证为 475 项 Node、6 项浏览器测试通过，日志为 `output/acceptance/verify-pre-model-preparation-2026-10-16.log`；新包隔离安装摘要一致，原 canary 复验通过。

当前状态见[2026-10-16 验收结果](project-acceptance-2026-10-16.zh-CN.md)：用户确认的 204+52 条能力均已正式登记并重启复核，模型及不限 token 授权持续有效，无须再次确认。v22 正式 gate 退出 1，原始失败保留；v23 最终完整本地验证退出 0，508 Node、6 browser 通过，已安装到隔离 3087 并复核能力、canary 和历史终态证明。25/25 Gold 已在本版候选前独立批准，真实采集与正式收口程序均实际运行。采集脚本的 4 项额外模拟回归通过，不计真实候选。正式门槛仍是同一 bundle 的 25 样本各至少 5 次有效独立规划、8 对未决/恢复、无执行者对照及真实 canary，最终 release gate 退出 0。旧版通过项、自动策略后继和诊断请求不补本版 fresh 数量。

回滚代码时可重新安装保留的旧 tarball；不能将回滚包等同于删除既有审批、声明和交付记录，也不能把新 bundle 的摘要回填到旧 operation。只操作隔离 3087，不发布、不动原 3080、不派发实现任务。

2026-10-17 补充：v31 四个独立根全部终态，正式 gate 退出 1，结果为 `output/acceptance/release-combined-binding-type-chain-v31-2026-10-17-result.md`。后续 v32 必须从零独立采集，原失败不能删去或补数稀释。修复把明确的忽略策略文件纳入证据，将同一冻结命令清单传给场景生成和审阅，并明确 Task 只能使用其当前阶段注入的 claim/command/policy refs。新版本的原 25 份 PRD、项目和能力声明保持不变；场景新增清单与全部源码证据一起进入审阅摘要，旧审阅不能继承为新版本事实。完整本地验证已通过 524 Node、6 browser，真实诊断与正式评测分开记录；当前安装状态和门禁结果仍以[验收记录](project-acceptance-2026-10-16.zh-CN.md)为准。

2026-10-17 v33 补充：v32 四条有效候选中 Zod、Ky、Mitt 达标，Hono 因错误 compose tuple 夹具被独立审阅拒绝，正式 gate 退出 1，失败不重写。完整源码已供应，修复属于生成器的通用调用形状与回调可达性核对，原 Reviewer 和质量标准不变。冻结源码的运行/编译实验及真实原/新生成对照均完成；原/新本次都获批准，不声称小样本统计改善。v33 必须继续独立安装证明、完整历史观察、新 Gold 与从零正式采集，不用成功诊断代替候选或补足失败批次。

2026-10-17 v34 补充：v33 又发现独立 Gold 的 nz 附加工具源码未供应正式场景，以及取消夹具未连接 signal 两项问题。先在采集和生成归属层修复并验证；旧批次在途自然收口后保留正式失败账本。离线工具仅安装于隔离评测父目录，不写上游 repo，不改变 PRD、能力、Gold 判定或正式门槛。新 bundle 不沿用 v33 候选；仍先安装复核及独立 Gold，再单 owner 四槽从零采集。
