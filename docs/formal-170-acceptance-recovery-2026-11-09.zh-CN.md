# 1.7.0 正式验收恢复记录

日期：2026-11-09。目标保持正式 `1.7.0`，不采用预览版门槛。本次本地验证通过，正式发布验收仍未通过，未发布 npm 或 GitHub 正式 Release。

## 已修复

历史 `tool-fault-v34` 的 p-queue 后继操作在 TaskPreflight 阶段误报缺少 `nz` 工具源码及 8 个非法 `maxQueued` 变体。上游已冻结这些事实，但预检只收到任务摘要和部分仓库源码。

修复归属在 Service 到 TaskPreflight 的交接：传入同一仓库快照的 `verificationTools`，以及当前任务引用的完整验收场景；场景缺失、跨项目或跨操作时在模型调用前拒绝。工具源码仍是只读证据，不代表命令已成功执行。

新增两条回归先复现失败，再验证修复通过；Service 集成测试核对交接中的场景与存储记录完全一致。此结果证明交接缺陷修复，不代表历史 ky、Zod 失败已经通过真实复验。

## 隔离环境恢复

原临时环境 `po-certified-acceptance-EiDNyF` 已不存在；用户确认无其他备份。保留的原始需求、独立 Gold 审阅输入和能力登记回执可用于重建评测初始状态，不能恢复完整旧领域历史。

- 持久 home：本机 `output/acceptance/formal-170-20261109/home`，位于忽略提交的任务目录。
- 重建 25 个需求样本及运行副本，共 61 个原项目 ID。项目均从草稿重新开始；重建时间使用实际当前时间。
- 原 204 + 52 条能力登记逐条核对 Schema、原登记原因参与计算的摘要，并按原 ID、原项目、原成员和原内容恢复。没有新增人工确认。
- 团队 Persona 和 skills 摘要与留存输入核对；需求原文及 SourceManifest 核对一致。
- 不恢复旧 PlanningOperation、Task、TaskRun、Approval、Dispatch 或 DeliveryRecord；留存历史账本继续作为失败及诊断记录。
- 真实 Host：dsh `0.2.2-rc.1`、Cordis `4.1.0`、Node `24.22.2`。安装 bundle SHA-256 与当前源码构建一致。
- 只读 Host 核验确认 61 个项目、256 条原登记完全匹配；预览 GET 没有改变领域快照。

恢复工具为 `scripts/prepare-release-recovery.mjs`、`scripts/verify-release-recovery.mjs`。准备脚本只允许在新的 `output/acceptance/` 子目录创建恢复环境；输入缺失、摘要冲突或目录已存在时拒绝覆盖。运行时使用独立 `DSH_HOME`、workspace ID 和 writer-lock 目录。

Gold 工具新增 `PO_ACCEPTANCE_CONTEXT`，支持新版 patch 模型配置和版本化凭据引用；仍支持旧报告格式。凭据只复制网关所需引用，不进入报告、日志正文或 Git。

## 原网关阻塞与路由切换

网关为用户指定的 `http://47.253.229.128:18080/v1`，模型保持 `gpt-6.1-sol`。

| 实际请求 | 结果 |
| --- | --- |
| 携带现有凭据的 `GET /models` | HTTP 200，列出目标模型 |
| 新版 25 个样本的独立 Gold 审阅 | 全部 HTTP 503，未产生批准的 Gold |
| 最小 `POST /chat/completions` | HTTP 503 |
| 最小 `POST /responses` | HTTP 503 |

两个最小生成请求均返回 `Service temporarily unavailable`。当前证据可以排除此前的 401 认证问题；不能据此进一步确定网关内部根因。没有启动候选规划或任务执行，未把失败审阅计为有效候选。

UTC `2026-11-09T15:19:50Z` 再次检查最小 Chat Completions 请求，仍返回 HTTP 503；追加证据为本机 `output/acceptance/formal-170-20261109/gateway-probe-recheck.json`。不继续重复提交完整批次，待生成服务恢复后使用新输出目录重跑，保留此前失败。

本机证据保存在 `output/acceptance/formal-170-20261109/`：`recovery.json`、`host-inputs-verified-final.json`、`gateway-probes.json`、`gold-1` 至 `gold-3` 的请求、响应及失败记录。文件仍用于后续复现和验收，保留原件。

用户随后要求改成与 Codex 当前配置相同的 API。已只读核对其当前 provider，并将隔离验收配置切换为 `https://ai.aifiys.com`、`openai-responses`，模型仍为 `gpt-6.1-sol`；凭据仅在本机私有凭据文件中复用，不写入报告或 Git，不修改 Codex 自身及用户日常 Host。

新地址的 `/models`、`/v1/models` 均列出目标模型；最小 `/responses` 请求 HTTP 200 且生成有效内容。根路径 `/chat/completions` 返回 HTML，因此不能只换 URL 或将 HTTP 200 计为模型成功。Gold 审阅工具已按 provider 协议构造请求，记录实际路由及协议，拒绝截断、拒绝回答、失败或缺少完整文本的响应；旧 Completions 协议仍受支持。上下文 `modelBaseURL` 显式绑定本批次地址，旧上下文继续绑定旧地址。

切换后 61 项目、256 条原声明只读复核通过，25 个样本的真实独立 Gold 审阅均已获批准。其中 p-retry abort-cause 首次审阅误判缺少 `reliability.failure-handling`；冻结输入实际上包含两名成员在本项目的原 `human_confirmed/active` 记录。审阅输入增加原样 active 声明投影以便核对，未改变 Gold、权威声明或人工确认；追加复核获批准，首次审阅结果保留。候选规划及 canary 仍需完成，不能将 Gold 审阅通过视为正式发布验收通过。

追加本机证据：`codex-route-migration.json`、`codex-route-discovery.json`、`codex-generation-probes.json`、`host-inputs-codex-route.json`、`gold-codex-route-1/`、`gold-codex-ready-a/`、`gold-codex-ready-b/`、`gold-codex-blocked/` 及 `gold-codex-pretry-claims/`。旧配置和凭据已保存在同一私有任务目录用于恢复，均不提交。

### 新路由首轮候选观测

2026-11-10（北京时间）继续通过真实 Host 发起首轮候选：8 个 pending 决策场景均按原 Gold 阻塞，指标检查通过；这仅是各 1 次，尚未满足每样本至少 5 次。

无合格成员场景也已完成首轮，按预期在资格门禁拒绝分配，`correctAbstentionRate=1`，其余适用指标通过。合计 9 个 blocked 样本各 1 次通过，不能替代 45 次所需有效独立候选。

- p-queue maxQueued resolved 在 Scenario Coverage Review 阻塞，代码 `incomplete-reentrant-event-count-oracle`。模型生成的场景仅用 `once:true` 的 add listener，却要求证明整个重入过程的总事件数和拒绝入队不发事件；该 listener 在回调前已移除，不能独立观测嵌套事件。候选保留为质量失败，不通过换 Gold 或重复采样消除。
- p-retry abort-cause 原操作因 `repository-policy-delta` 被 supersede，按现有机制启动的后继操作已在 `assignment_qualification` 阻塞。后继推导要求 `data.change`、`domain.state`，原项目确认声明不包含这两项；是否因影响面分类过宽仍需源码核对，不能自动增加人工确认。原根记录为 infrastructure failure，后继不计为新的独立候选。

本机回执为 `candidates-ready.json`、`candidates-blocked.json`、`ready-policy-successors.json`、`ready-qualification-diagnostics.json` 及 `codex-route-terminal-observation.json`。所有 12 个实际操作（含 1 个自动后继）均已终态，无审批、任务执行或交付写入。隔离 Host 已停止，停机后保存 `domain-after-codex-route-snapshot.json`；新地址及协议配置继续保留。上述问题属于正式规划质量和资格检查，不能继续归因为旧网关 503，也不表示本次 API 地址切换失败。

### 事件观测修复与 p-retry 能力补充

2026-11-10（北京时间），在 Service 的场景生成契约补充事件观测器生命周期规则，并升级 `scenario-coverage-review-v3.3.18`。`once` 回调仅用于重入触发；总事件数及事件缺席必须由首次触发前注册、覆盖同步重入和异步结算的独立非 once 收集器证明，完成断言后才能清理。规则同时禁止虚构私有钩子、事件存储或不存在的 payload。独立审核标准保持不变。

新增 EventTarget 反例回归先失败、修复后通过：正确与错误生产者的 once 回调次数均为 1，而持续收集器分别观察到 1 次和 2 次事件。完整 `pnpm verify` 退出 0，546 条 Node 测试、7 条浏览器测试及其余本地检查通过。真实隔离 dsh Host 的 8 项兼容检查也通过，使用确定性适配器，不计作真实模型规划成绩。

p-retry 的源码与现行 `v3.3.14` 能力规则复核确认需要 `data.change`、`domain.state`。用户已明确确认原两名成员在单一隔离项目承担这 4 项能力，并通过正式接口登记为 `human_confirmed/active`；原 256 项及原 pending 记录均保留。具体范围及登记回执见 [p-retry 能力补充清单](release-capability-pretry-addendum-2026-11-10.zh-CN.md)。没有放宽能力规则或代签其他项目。

修复版 bundle SHA-256 为 `6f64622478bf69eb1782f980a2b063b4e26fe4d668b75bc106c9451776f1de2a`；隔离安装与本地构建一致。先保留旧版全部终态及自动后继的摘要证明，再冻结 `event-oracle-v36` 的独立 Gold，批准后才启动该版本真实候选。

- p-retry `planning-v3:d40ac855-48ec-424b-9e36-f40a89cae7af` 已 `committed`，真实 fresh-1 的全部适用质量指标达标，包括 `assignableRate=1`、`firstPassApprovableRate=1` 和证据阶段完整覆盖。此处 committed 表示规划候选已原子保存，不是代码交付。
- p-queue `planning-v3:a74b4b17-88e0-4c06-b23f-7685176ee27e` 已生成独立非 once 收集器，并通过独立场景审核。其 `SCN-AC-003-BOUNDARY` 明确断言重入拒绝时完整序列为 `['add']`，外层完成后为 `['add', 'next']`，且说明禁止的嵌套事件即便随后拒绝也会被检测。
- 该 p-queue 根操作随后发现 4 个仓库 MUST 策略种子，按现有固定点流程被 supersede。采集器保留 `planning-policy-superseded/infrastructure_failure` 并退出 1，没有将自动后继当作 fresh 候选。后继 `planning-v3:c05102ca-c66c-47f4-99b1-78bd57ad517e` 在场景审核被正确拒绝：已断言等待中取消会发出 `next`，但结构化事件清单及收集器只覆盖提交前已取消的无事件分支，缺少该 present 事实的独立观察。

针对后继暴露的相邻缺口，场景生成契约进一步升级至 `scenario-coverage-review-v3.3.19`：按每个具体夹具分支核对事件清单、收集器、结算检查点及断言；一个分支的 absent 不能覆盖另一个分支的 present。完整输出模板同时补齐 `eventObservables`，避免模板遗漏该字段。新增契约断言先失败再通过，没有弱化独立审核或删除必要分支。

`event-variant-v37` 的 bundle SHA-256 为 `c8709d90690a8e8f73f761a3bddff44c98209c49b99f2198428c0737b354a4dc`，隔离安装摘要一致。61 个项目的旧操作历史核对通过，两个未知版本的自动后继均通过安装前终态观测证明隔离，没有推断其版本。两份新 Gold 已在该版本任何候选启动前独立批准。该版完整 `pnpm verify` 退出 0，546 条 Node 测试、7 条浏览器测试、clean install/package smoke（169 文件）及其余本地检查通过；8 项真实 Host 兼容检查再次通过。

本机证据位于 `output/acceptance/formal-170-20261109/`：`pretry-capabilities-confirmed.json`、`domain-before-event-oracle-install.json`、`ready-domain-before-event-oracle.json`、`event-oracle-installed.json`、`event-oracle-historical-observation.json`、`gold-event-oracle-focused/` 和 `candidates-event-oracle-focused.json`。完整回归日志为 `output/formal-170-event-oracle-verify-2026-11-10.log`，兼容报告为 `output/compatibility/dsh-0.2.2-rc.1-1794241643747.json`。日志和领域快照仍用于验收及恢复，保留本机，不提交原文或凭据。

该版追加证据为同目录 `event-oracle-policy-successors.json`、`event-oracle-domain-before-variant.json`、`domain-before-event-variant-install.json`、`event-variant-installed.json`、`event-variant-historical-observation.json`、`gold-event-variant-focused/`、`candidates-event-variant-focused.json`；完整回归日志为 `output/formal-170-event-variant-verify-2026-11-10.log`，兼容报告为 `output/compatibility/dsh-0.2.2-rc.1-1794242347023.json`。旧提交 `ac63d14` 的 Linux CI 和 CodeQL 通过，macOS 作业没有执行 step 就被取消，不能记作测试通过或断言失败；后续 `108b275` 的 Linux/macOS CI 和 CodeQL 均通过。

### 工具证据闭包与正式决策引用修复

`event-variant-v37` 的两个真实候选均已终态，不能记作通过：

- p-retry `planning-v3:063b00b6-a1f9-4d45-9e01-471ded9ff6f7` 在 TaskPreflight 阻塞。规划选择 `npm exec -- tsd --files index.test-d.ts`，但隔离仓库尚未安装该工具，没有其 CLI、文件发现、配置和编译器证据。能力资格检查已通过，仍不能把证据缺失当作可批准计划。
- p-queue `planning-v3:c5863091-5dab-42db-a236-fe5e1e791004` 已通过场景审核，各取消分支均有独立事件观察项；任务规划随后以 `plan-reference-invalid` 失败。它将源文假设输入中的 `DEC-001` 当作正式任务决策引用，而权威 resolved Decision 集合为空。确定性引用校验保持拒绝，没有补造人工决策。

工具证据修复位于 `captureVerificationToolEvidenceV3`：使用 Node 的只读 CommonJS 解析规则追踪省略扩展名和目录入口的相对 `require`，不执行包代码，拒绝越过包根的符号链接；仍保留原文件数及字节预算。预算耗尽时仅将未访问路径列为缺口，避免重复入队的已采集文件同时被标为不可用。两条回归分别覆盖真实入口解析、拒绝越界与不执行代码，以及预算耗尽时的重复路径，均先失败再通过。

在固定 p-retry 隔离仓库内安装声明最低版本 `tsd@0.33.0` 作为只读工具证据，禁用安装脚本且不写锁文件，tracked 文件仍干净；这不是给目标需求新增依赖。冻结结果包含 `dist/cli.js`、`dist/lib/index.js`、`dist/lib/config.js`、`dist/lib/compiler.js`，未采集路径仍显式保留为缺口。另用实际 tsd 编译器验证函数体内的负向类型断言：readonly `cause: Error` 通过，writable、missing、wrong-type 三种错误声明分别失败。该实验只证明测试工具能够区分这些声明，不能代替目标实现和交付验收。

任务规划契约升级至 `evidence-grounded-v3.3.30`，动态列出 Service 冻结的正式 `decisionKeys`；空集合必须输出 `[]`。源文假设、比较、历史或 pending 标签没有引用权限，固定假设输入按需求行为执行，不能因此虚构正式 Decision。新增空集合与真实 `DEC-REAL` 集合回归先失败再通过，原未知引用拒绝未放宽。

中间版 `tool-decision-v38` 的两份 Gold 已批准，但没有启动候选；随后修复工具预算误标，旧 Gold 保留为已审阅未使用，不能算成绩。`tool-closure-v39` 的 bundle SHA-256 为 `480d4c03a6595bec2022eef7003dbb8b3eb31c1b3a80be0e1f6aedba1b74b88c`，隔离安装与本地构建一致。两份新 Gold 均在该版任何候选启动前获独立批准，实际结果如下：

- p-queue `planning-v3:a62af2e4-26c2-402e-bcf4-1eb541b31c86` 在场景审核阻塞，`event-observable-fact-missing`。持续收集器及检查点本身可执行，但同一重入夹具中将“运行任务结算前，被拒绝调用不得发 next”和“运行任务结算后发出 next”合并在单一 present 清单项，独立 absent 事实仍缺失。
- p-retry `planning-v3:cbfe7934-1cc9-406d-8acc-0691becce7f3` 因安装工具后仓库证据摘要变化被 supersede；策略种子集与 extractor 均相同，确定性基线检查仍要求重新冻结。自动后继 `planning-v3:96837130-06c5-40b1-9d80-825ac7823a0f` 已通过场景及绑定审核，在任务规划调用中失败。Harness 原始 `turn/end` 证实 `PI_AI_ERROR / stream_read_error`，不能归因为产品契约校验，也不能记为成功。根失败及后继历史分别保留，后继不计 fresh。

两次根请求及自动后继均已终态；领域只读核验确认累计 20 个操作，无计划审批、执行派发或交付。脱敏错误证明为本机 `pretry-tool-closure-stream-failure.json`，引用原始压缩会话的摘要，没有重发该请求。

本版完整 `PO_TEST_BROWSER_CHANNEL=chrome pnpm verify` 退出 0，549 条 Node 测试、7 条浏览器测试、类型及文档检查、固定样本和 clean install/package smoke（169 文件）通过。8 项真实隔离 Host 兼容检查通过，使用确定性模型，未计作真实候选。没有修改主项目依赖。

本机追加证据：`event-variant-domain-facts.json`、`pretry-tool-closure-evidence.json`、`tsd-oracle-probe.json`、`tool-closure-installed.json`、`tool-closure-historical-observation.json`、`gold-tool-closure-focused/`、`candidates-tool-closure-focused.json`；回归及兼容日志为 `output/formal-170-tool-closure-verify-2026-11-10.log`、`output/formal-170-tool-closure-host-compatibility-2026-11-10.log`，兼容报告为 `output/compatibility/dsh-0.2.2-rc.1-1794243698679.json`。所有失败、未使用审阅和实验夹具均保留本机，供验收与恢复使用。

### 同一夹具的事件阶段清单

针对 `tool-closure-v39` 的实际拒绝，场景生成契约升级至 `scenario-coverage-review-v3.3.20`。事件事实按夹具分支、调用或生产者、事件名、观察区间及 present/absent 拆分；同一收集器的“结算前 absent”和“结算后 present”分别使用独立 key 和检查点。已有持续收集器可复用，不新增生产事件通道或 payload；独立审核、原始需求和正式门槛均未修改。新增契约断言先失败再通过。

`event-phase-v40` 的 bundle SHA-256 为 `2a77be6dc5a88b78d48c20c1c4ede4ce11e0c294d247fd514167be7e15613aff`，安装摘要与本地构建一致。完整 `pnpm verify` 退出 0，549 条 Node 测试、7 条浏览器测试及其余检查通过；8 项真实隔离 Host 兼容检查通过，报告为 `output/compatibility/dsh-0.2.2-rc.1-1794244681518.json`。本次未改主项目依赖。

隔离重启第一次漏带 `DSH_PLANNING_CONTRACT_MODE=v3-candidate`，Gold 本地预检返回 `409 planning-v3-disabled`；补齐参数后的下一次请求早于 Host 就绪，返回 `ECONNREFUSED`。这两次未发送模型请求，未登记候选。完成 writer 健康与 V3 只读预览检查后，使用新目录 `gold-event-phase-focused-3/` 完成两份独立 Gold，均获批准后才启动该版真实 fresh-1。

- p-retry `planning-v3:7aa46937-aaa6-4b0e-9907-5d9cf8b1d5bd` 已 committed，全部适用指标通过，包括 `firstPassApprovableRate=1`、`assignableRate=1` 和证据阶段完整覆盖；没有执行计划或交付代码。
- p-queue `planning-v3:e7a0052d-e7d7-4475-b876-22d15eed37f7` 已 blocked，代码 `scenario-unsupported-unknown-stage-compatibility`。生成场景的 assumptions 写入“Compatibility ... not unknown or future stage identifiers”，引入与 p-queue 源需求无关的否定式领域声明；现有确定性规则明确禁止这种声明。没有删除或忽略该拒绝。

领域只读核验确认累计 22 个操作均终态，无审批、执行派发或交付。同版其余 23 个样本也完成独立 Gold 审阅，合计 24 份批准，Hono expose-function 为 insufficient_evidence，尚无 Gold。该审阅要求区分 TypeScript `lib/_tsc.js` 采集缺失与实际文件缺失。只读检查发现安装的 `typescript@6.0.3` 与声明最低版本一致，文件存在且为 6,239,091 字节，超过现有 65,536 字节单文件上限；真实 `tsc --version` 退出 0，返回 `Version 6.0.3`。该探针仅证明编译器存在且可启动，不证明项目类型测试或交付通过，也没有替代 Gold 复核。回执为本机 `hono-typescript-availability-probe.json`，原 insufficient_evidence 保留。其余 23 个样本未运行本版候选。

追加本机证据：`domain-before-event-phase-install.json`、`tool-closure-domain-facts.json`、`tool-closure-policy-successors.json`、`event-phase-installed.json`、`event-phase-historical-observation.json`、`gold-event-phase-focused-3/`、`candidates-event-phase-focused.json`。完整回归日志为 `output/formal-170-event-phase-verify-2026-11-10.log`。这些文件仍用于正式验收与恢复，不清理、不提交原文。

### 无关阶段声明生成约束

针对上述实际拒绝，将场景生成契约升级至 `scenario-coverage-review-v3.3.21`：在冻结需求没有授权特殊阶段兼容性时，场景的所有字段均省略相关无关领域概念，包括 exclusions、negated assumptions 和 disclaimers；只陈述源需求支持的具体兼容行为。确定性拒绝、独立审核与原始需求均保持不变。新增契约断言先失败再通过。

`stage-disclaimer-v41` 的 bundle SHA-256 为 `4663d88e94923727b6048f4417de201d16086068e78f2700cc1cad411b4709c9`，隔离安装与本地构建一致。完整 `pnpm verify` 退出 0，549 条 Node 测试、7 条浏览器测试及其余检查通过；8 项真实隔离 Host 兼容检查也通过，报告为 `output/compatibility/dsh-0.2.2-rc.1-1794245663192.json`。

保留旧版全部终态后，核对 61 个项目与历史证据，p-queue 和 p-retry 两份独立 Gold 均先批准，再启动该版真实 fresh-1；目前正在观察，不能引用旧版候选作为本版成绩。此前 `event-phase-v40` 的其余 Gold 仍保留为旧版已审阅未用于候选。

追加本机证据：`event-phase-domain-facts.json`、`domain-before-stage-disclaimer-install.json`、`stage-disclaimer-installed.json`、`stage-disclaimer-historical-observation.json`、`gold-stage-disclaimer-focused/`、`candidates-stage-disclaimer-focused.json`。完整回归日志为 `output/formal-170-stage-disclaimer-verify-2026-11-10.log`。

Hono 的编译器可用性证据另行冻结为 `hono-tool-proof/evidence.json`，包含实际文件大小、内容摘要、完整源码归档摘要及真实启动探针；大文件正文不插入提示词，也不提高源码采集预算。Gold 工具允许首次审阅补充材料直接声明 `proposedGoldSha256`，旧材料仍兼容原 `previousIndependentReview.proposedGoldSha256`，均强制绑定未修改的 Gold。错误摘要的实际负向预检在模型调用前拒绝，语法检查通过。补充材料没有宣称目标实现、项目测试或交付通过。

`gold-stage-disclaimer-hono/` 的独立审阅在任何本版 Hono 候选启动前批准，原 insufficient_evidence 保留。本版 Hono expose-function 真实 fresh-1 已启动，账本为 `candidates-stage-disclaimer-hono.json`，目前等待结果。该版其余 22 个样本尚未重新冻结 Gold 或运行候选，不引用旧版 24 份批准作为本版资格。

提交 `b0a4123` 的 Linux CI 和 CodeQL 通过，macOS 作业没有执行步骤，等待约 15 分钟后因 hosted runner 未分配而取消；GitHub annotations 明确报告 macOS arm64 容量约束。后续提交 `0d1bcc6` 的 Linux/macOS CI 和 CodeQL 均通过。本版后续提交仍须各自核对，不能继承上述结论。

## 实际验证

- `PO_TEST_BROWSER_CHANNEL=chrome pnpm verify`：退出 0，543 条 Node 测试、7 条浏览器测试、类型检查、文档检查、固定规划样本及 clean install/package smoke 通过。
- `PO_DSH_COMPAT_ROOT=... node scripts/verify-dsh-compatibility.mjs`：退出 0，8 项真实隔离 Host 检查通过；使用本地确定性模型，不作为真实模型规划成绩。
- `pnpm audit --prod --audit-level high --json`：退出 0，0 漏洞。
- 后续完整依赖审计发现 Host 开发依赖链的 `undici@8.11.2` 告警；增加现有 pnpm override，锁定修复版 `8.12.2`，隔离 Host 同步安装该版本。完整 `pnpm audit --json` 退出 0，各级漏洞均为 0。该 override 不会自动升级用户另行安装的 Host。
- 此依赖修复后完整 `pnpm verify` 再次退出 0，543 条 Node 测试、7 条浏览器测试和其余检查均通过，安装包 168 个文件。日志为本机 `output/formal-170-security-verify-2026-11-09.log`，完整审计为 `output/formal-170-full-audit-fixed-2026-11-09.json`。
- 更新隔离安装包和 Host 的 undici 后，8 项真实 Host 检查再次通过；本机报告为 `output/compatibility/dsh-0.2.2-rc.1-1794237580721.json`，仍使用本地确定性模型，不计入真实规划成绩。
- 新增 Responses/Completions 审阅协议回归后，完整 `pnpm verify` 退出 0，545 条 Node 测试、7 条浏览器测试及其余检查通过；本机日志 `output/formal-170-codex-route-verify-2026-11-09.log`。
- `pnpm eval:planning`：退出 1；默认正式 manifest 仍缺足够 ready/resolved 样本、完整有效候选及本版 canary。

本机日志为 `output/formal-170-verify-2026-11-09.log`、`output/formal-170-host-compatibility-2026-11-09.log`、`output/formal-170-audit-2026-11-09.json`、`output/formal-170-planning-gate-2026-11-09.log`。GitHub CI 结果需另行核对，不能用本地通过推定。

修复提交 `04015b0` 的 GitHub Linux/macOS CI 与 CodeQL 均已通过；后续依赖和文档提交仍需核对各自最新检查。重建的正式 Host 已停止，停机后保存本机 `output/acceptance/formal-170-20261109/domain-pre-model-snapshot.json`，用于后续恢复；这是重建后的快照，不是丢失的旧环境备份。

路由适配提交 `e1b94ad` 的 Linux/macOS CI 与 CodeQL 均通过；其后仅追加首轮实测记录。最终安装包 clean install 再次通过，报告为本机 `output/formal-170-codex-route-package-final-2026-11-10.log`。

## 剩余发布条件

1. 原 25 个样本在新 Codex 默认 API 的独立 Gold 审阅已完成；每次 bundle 变化后，须先完成该版独立 Gold 审阅，再启动对应样本候选，保留旧网关已有 503 记录。
2. 在当前 bundle 上完成 8 仓库、25 样本、每样本至少 5 次有效独立真实规划，覆盖 8 对 pending/resolved 及无合格成员场景；保留所有失败，修复根因后重新验证。
3. 完成同版真实交付 canary、独立验证和所需人工交付确认。
4. 默认正式门禁、完整回归及 GitHub CI/CodeQL 通过后，才合并发布提交、创建 `v1.7.0` tag，执行正式 GitHub Release 和 npm provenance 发布。

尚未发布的代码可通过撤回本次修复提交恢复。隔离数据恢复应使用本次任务目录和对应 bundle，不能用代码回退代替数据恢复，也不能覆盖用户日常 Host。
