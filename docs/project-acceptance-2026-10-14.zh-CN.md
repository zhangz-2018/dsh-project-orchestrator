# 项目验收记录与剩余实施方案

验收对象：当前工作区 `dsh-project-orchestrator@1.7.0`。原始要求是项目改进方案、可实施技术设计，以及实际验收通过。

配套文档：[改进方案](project-improvement-plan-2026-09-22.zh-CN.md)、[技术设计](project-improvement-technical-design-2026-09-22.zh-CN.md)。

本轮最终状态见[2026-10-16 验收结果与后续执行方案](project-acceptance-2026-10-16.zh-CN.md)：新版本 9 个场景各 5 次，共 45/45 条真实候选全部适用指标达标；完整本地 verify（479 Node、6 browser 等）及隔离安装后的原 canary 复核通过。新 bundle 为 `205f2bcf8bfc95f2be986ad72f7ffdde9ca8bd99223dec315d0a3945f911c0cd`。正式 `release-gate-scenario-evidence-final-2026-10-16.json` 仍退出 1，缺 16 个 ready／恢复样本及其 80 次规划，204 条具体能力确认仍待答。旧版本 13 条候选中的 1 条质量失败及所有更早失败完整保留；下文首轮和采集中的描述为过程记录，不代表当前仍在后台运行。

修复仅在 Planner Prompt 澄清验证任务的有限测试维护范围，不改 Schema、不增加权限、不强迫产生代码 diff；回归修前以相同数组错误失败、修后通过（`verification-scope-before/after-2026-10-16.log`）。新版本 `PO_TEST_BROWSER_CHANNEL=chrome pnpm verify` 已退出 0：478 Node、6 browser、类型/文档、原 fixture 的 5 条运行和 145 文件包检查通过，日志为 `verify-verification-scope-2026-10-16.log`；这是本地回归通过，真实发布资格仍为 false。下文 v3.3.26 的局部成功属于历史，不能称为当前整体通过。

该批次首轮 9/9 真实候选的全部适用指标达标。随后 fresh-4 的 operation `planning-v3:d984385a-0925-4155-8d1d-8885ee9a6a07` 因场景未说明同队列 clearQueue 的访问和“无第二队列”的观测机制，被独立审阅拒绝；采集器停止新增请求，并等待已启动请求收口。固定 commit 的 `index.js` 已通过 `Object.defineProperty` 将 `clearQueue` 公开在包装函数上，声明文件与现有测试也覆盖此 API，需求没有该 API 缺口。实际根因是冻结模型禁用工具，而场景生成和审阅此前没有收到源码证据，导致把已有调用入口留给后续 Binding。

修复复用既有 repository evidence 检索、摘要核验和有界源码读取，为场景设计与审阅提供完全相同的当前证据；要求在结构化 trigger / expectedOutcomes 中闭合可执行机制，不改变源需求、Gold 或独立审阅拒绝规则。源码证据随 Scenario Review 持久化，并纳入 reviewInputDigest、批准/派发/查询时摘要核验以及继承场景/审阅的同源检查；旧记录可读，但不能被新版本无证据继承。Binding 前再次核对仓库摘要，变化即拒绝。回归修前失败、修后通过，见 `scenario-evidence-before/after-2026-10-16.log`。首次全量检查暴露新增 scenario_completion reference manifest 未纳入测试的阶段清单，以及源码提前漂移时错误码变化；补齐新阶段断言并在加载源码前维持原漂移拒绝契约后，完整新验证 `verify-scenario-evidence-final-2026-10-16.log` 退出 0，首次失败日志保留。

修后准备报告为 `release-abstention-evidence-projects-2026-10-16.json`、`release-scenario-evidence-projects-2026-10-16.json`；8 项未决中复用 32 个无 operation 的草稿，替换 8 个已运行项目，原项目不删。无执行者对照创建 5 个无能力声明的新草稿。独立 Gold 审阅结果在 `release-gold-review-abstention-evidence-2026-10-16/summary.json`、`release-gold-review-pending-scenario-evidence-2026-10-16/summary.json`。统一采集清单 `release-current-scenario-evidence-blocked-projects-2026-10-16.json` 含 9 case / 45 个项目，仍不创建 human_confirmed。再次只读核实 16 个 ready 项目全为 draft、0 operation，204 项能力仍与机器清单 digest 相同且待确认。

修后首轮关键 operation `planning-v3:fbd1139f-1399-4a6c-8bad-2f3fc7c98cf2` 的 9 条场景获独立审阅 approved / 0 findings；持久化源码包含 `value: limit.clearQueue`，四文件 Binding 和 Plan 审阅通过，两个完整任务最终各记录 abstained-no-eligible，无审批、发布或派发。8 个未决场景均正确停在 decisions。首轮日志为 `release-collection-scenario-evidence-firsts-2026-10-16.log`；带 canary 的 `release-gate-scenario-evidence-firsts-2026-10-16.json` 仍退出 1，仅有 9 个场景、各 1 次，缺 ready / 配对恢复及完整数量，不能冒充最终通过。

修后最终采集已退出 0：45 attempts / 45 candidates、9 个样本各 5 次、45/45 不变量通过。`release-scenario-evidence-domain-facts-2026-10-16.json` 再核对 40 次正确未决、5 次正确弃权及全部 45 个项目的无发布/无派发事实。带 canary 的最终 gate 因 ready、配对恢复和样本数量不足仍退出 1；3 项 ready 指标分母为 0、值为 null，未当作通过。没有未结束采集或自动后台承诺；下一步需具体能力确认后继续 16 个样本的冻结和真实规划。

2026-10-16 最新执行结果：整体验收未通过。旧批次有 40 个符合预期的未决候选，以及 4 个在需求阶段错误阻塞的负例；原始质量失败和两条基础设施失败完整保留。需求阶段职责修复后，真实对照通过了需求分析，但因漏配 Reviewer 在场景审阅门禁正确阻塞。增加非执行 Reviewer、重新冻结和独立审阅后，下一次对照通过场景审阅，又被独立 Binding Review 正确拒绝：生成器扩大了明确限定的可写范围。两次对照均保留在各自失败批次中，未回写 Gold。

约束传递修复后的真实运行已通过需求、场景和精确四文件 Binding Review，但 Task Planner 把提案 ready 误解成允许发布执行，在 task_plan 再次提前阻塞。已明确提案完整性与后续资格的边界，保留真实业务冲突及权限拒绝语义，不改变状态枚举或资格门槛。最新完整 476 项 Node、6 项浏览器、typecheck/build/docs/package（145 文件）通过；本地及隔离 bundle SHA256 均为 `261a73ed104010a93fd8b143c36d047a5033bfc48ed32a174bfb5b595e1c077c`，规划提示词为 evidence-grounded-v3.3.26。最新负例首条真实完整对照已通过，最终由 assignment_qualification 正确弃权；其余重复及未决场景复验正在采集，整体验收仍未通过。

新包安装后原 greeting canary 再次通过，见 `output/acceptance/canary-export-task-proposal-boundary-2026-10-16.json`。用户已明确 token“不限制”；只读再次核实 16 个 ready 项目的 204 条项目限定能力仍为 pending，digest 与[具体清单](release-capability-review-2026-10-16.zh-CN.md)精确一致，仍待人工确认。详见下文 4.7 及[批次执行方案](release-batch-execution-design-2026-10-15.zh-CN.md)。下文早期测试和门禁运行保留为历史证据。

2026-10-15 更新：原 13 项确认清单未获确认。随后按用户“要求验收通过”继续实施[能力调整分析](canary-capability-adjustment-analysis-2026-10-15.zh-CN.md)中的适用性修复；最新完整回归 450 项 Node、6 项浏览器测试通过，隔离 Host 已重装并核对 bundle。确认前真实 operation 已通过四类审核，实际为实现 4 项、验证 5 项。用户现已明确回复“确认这 9 项并登记”，正式批量接口登记并持久化了 9 项 `human_confirmed / active` 资格，证据为 `output/acceptance/canary-capabilities-confirmed-2026-10-15.json`。正常 `/decompose` 接口已启动新 operation `planning-v3:59ca03a4-22a8-4960-b2ce-e906ad525c2d`，重新审核、分配与预检。详情见[修复及确认清单](canary-capability-revision-2026-10-15.zh-CN.md)。

## 1. 当前结论

隔离 greeting 的完整交付验收已通过；整体验收及正式发布尚未通过。模型认证、规划死锁、冻结源码和能力适用性已修复。9 项资格经用户明确确认并正式登记后，新 operation `planning-v3:59ca03a4-22a8-4960-b2ce-e906ad525c2d` 成功提交。用户随后明确批准 revision 2 并授权执行隔离验收；正式审批、两个不同成员的真实 TaskRun、实际验证、Integration 和 Convergence 均已完成。独立脚本在最终 canonical commit `8541b63a4959b3b82ce12df570f93507f6435cba` 重跑原始需求断言、`npm test` 和文件范围检查，退出 0。用户审阅实际 diff 后明确回复“批准最终交付并登记”；当前项目 `completed / delivered`，两个 Acceptance passed，human Review approved，无 waiver。正式 CLI 导出 V2 canary，实际记录与证据 bundle 摘要一致；确认后技术复验通过。具体证据见[最终交付材料](canary-delivery-review-2026-10-15.zh-CN.md)。V2 candidate 与调用前冻结已实现并有回归；剩余发布工作是安装后的 V2 新运行验证、完整独立 Gold 与真实批次，不再包含已完成的最终人工确认和 canary 导出。

用户已授权真实模型评测，指定 `gpt-6.1-sol` 和现有网关，已更新认证，并于 2026-10-16 明确本批次 token“不限制”。当前缺口是 ready 项目的具体人工能力事实、全部 Gold 和完整真实候选，不再等待预算或模型授权；不把私人仓库自动上传给模型。

## 2. 已核实的环境与证据

| 项目 | 实际结果 | 证据 |
| --- | --- | --- |
| 模型认证 | 原凭据返回 401；更新后实际 `/chat/completions` 返回 200，响应模型为 `gpt-6.1-sol` | `output/acceptance/model-connectivity-2026-10-14.json`、连接历史 JSONL |
| 本地完整验证 | 模型查询超时修复后，`PO_TEST_BROWSER_CHANNEL=chrome pnpm verify` 退出 0；438 个 Node 测试、6 个浏览器测试、类型检查、文档检查、5 个 fixture 与 136 文件包检查通过 | `output/acceptance/verify-after-fix-2026-10-14.log` |
| 冻结源码完整验证 | 加入 HTTP 启动、Harness 失败终态和冻结源码证据修复后，同一命令退出 0；447 个 Node 测试、6 个浏览器测试、类型/文档/fixture 与 137 文件包检查通过 | `output/acceptance/verify-final-2026-10-14.log` |
| 最新完整验证 | 再补齐 TaskPreflight 的冻结源码交接后，同一命令退出 0；448 个 Node 测试、6 个浏览器测试、类型/文档/fixture 与 137 文件包检查通过 | `output/acceptance/verify-preflight-inline-2026-10-14.log` |
| 认证版本 Profile | 独立安装 Harness `0.1.0-rc.6`、Cordis `4.0.1`；监听 `127.0.0.1:3087` | `output/acceptance/isolated-harness-2026-10-14.json` 与 Host 日志 |
| 安装包一致性 | 最新 TaskPreflight 源码交接修复包的安装后 bundle 与本地构建 SHA-256 相同；隔离 Host 已重启加载 | `output/acceptance/installed-bundle-preflight-fix-2026-10-14.json`、`certified-host-preflight-fix-2026-10-14.log` |
| 真实规划 | 第三个真实 operation `planning-v3:d2c9ca54-97cf-42e7-a6da-dd6802279c53` 通过代码绑定与独立计划审核；最终 assignment_qualification 因 `capability-claim-missing` 阻塞。此前流中断失败和 Binding 阻塞记录仍保留 | `output/acceptance/real-planning-2026-10-14.json`、`real-planning-binding-fix-2026-10-14.log` |
| 流式连通 | 同一模型的 chat/completions 与 responses 小探针均收到完整非空文本和结束事件，没有错误事件 | `output/acceptance/model-stream-chat-2026-10-14.json`、`model-stream-responses-2026-10-14.json` |
| 实际 CLI 导出 | 第三个真实 blocked operation 经正式 CLI 导出 V1 candidate，并通过现有 grader contract 校验；记录两个弃权 Assignment | `output/acceptance/greeting-run-3-candidate-v1.json`、`capture-greeting-candidate-2026-10-14.log` |
| 正式发布门禁 | 最新 `pnpm eval:planning` 仍退出 1：缺 release manifest、仅 1/8 仓库、1/24 fixture case、缺 release canary；尚无独立审阅 Gold V2 批次 | `output/acceptance/release-gate-latest-2026-10-14.log` |
| 9 项资格正式登记 | 用户明确确认后通过正式批量接口登记，9 项 human_confirmed / active 持久化一致 | `output/acceptance/canary-capabilities-confirmed-2026-10-15.json` |
| 确认后的真实规划 | 新 operation committed，无阻塞诊断；四类审核 approved，两个不同成员 selected，两个 TaskPreflight accepted；readiness 均 ready | `output/acceptance/canary-plan-review-ready-2026-10-15.json`、`real-planning-confirmed-capabilities-2026-10-15.log` |
| ready CLI 导出 | 正式 CLI 导出 run-5 的 V1 real_model ready candidate；仅用于历史导出闭合检查，不计入 V2 发布资格 | `output/acceptance/greeting-run-5-ready-candidate-v1.json` |
| 本轮完整验证 | `PO_TEST_BROWSER_CHANNEL=chrome pnpm verify` 退出 0；451 个 Node、6 个浏览器测试、类型/文档/fixture/包检查通过 | `output/acceptance/verify-startup-v3-2026-10-15.log` |
| 真实计划审批及执行 | 用户明确批准，正式审批与两次 Dispatch；Software Engineer、Test Engineer 分别真实执行并完成，两条 V2 verification passed | `output/acceptance/canary-delivery-execution-2026-10-15.json` |
| 最终技术验收 | 最终 HEAD 与 Integration/Convergence 一致且 clean；无 finding；原始需求含 Unicode 纯空白断言通过，npm test 4/4，仅两指定文件 | `output/acceptance/canary-delivery-verified-2026-10-15.json`、`verify-canary-delivery-technical-2026-10-15.log` |
| 最终人工审阅与交付 | 用户明确批准最终 diff；两个 Acceptance passed，无 waiver，独立性检查通过；Review approved human、Delivery delivered，审计无待处理事件 | `output/acceptance/canary-delivery-confirmed-2026-10-15.json` |
| 确认后技术复验 | 实际 npm test 4/4、原始需求断言与范围检查通过，HEAD 等于同一最终 commit，仓库 clean | `output/acceptance/canary-delivery-post-confirmation-2026-10-15.json` |
| 实际 V2 canary | 正式 CLI 导出，Service schema 与评测 contract 接受；源记录与完整 evidenceBundleDigest 核验通过 | `output/acceptance/greeting-release-canary-v2-2026-10-15.json`、`canary-export-verified-2026-10-15.json` |
| 最新正式发布门禁 | 携带上述真实 V2 canary 重跑，退出 1；canary 已接受，仍缺 release manifest、8 仓库/24 独立样本；fixture 不作为真实发布证据 | `output/acceptance/release-gate-with-confirmed-canary-2026-10-15.json` |
| V2 与 Provider 最终完整验证 | `PO_TEST_BROWSER_CHANNEL=chrome pnpm verify` 退出 0；460 Node、6 browser、类型/文档/fixture 与 143 文件包检查全部通过 | `output/acceptance/verify-release-providers-2026-10-15.log` |
| 真实公开仓库只读预检 | 8 个固定仓库基线全部 supported；24 个需求草案及成对关系核对通过；没有模型调用或第三方测试执行 | `output/acceptance/release-corpus-draft-2026-10-15.json`、`release-repository-preflight-final-2026-10-15.json` |
| 新包隔离重装与历史保护 | 本地/安装 bundle SHA256 一致；隔离 3087 启动成功；原 completed/delivered 与全部 canary 证据摘要核验通过 | `output/acceptance/installed-bundle-v2-evaluation-2026-10-15.json`、`canary-export-verified-after-v2-install-2026-10-15.json` |
| 本轮发布门禁 | 退出 1，canary 已接受；缺 release manifest，正式 corpus 仍只有 1 个 fixture、0 条本批次真实 candidate。新下载仓库与草案不冒充已审阅 Gold | `output/acceptance/release-gate-v2-input-2026-10-15.json` |
| 具名规划路由修复 | 完整验证 461 Node、6 browser；新包安装后摘要一致，原 canary 再次复验通过；正式 gate 仍缺 manifest/Gold corpus | `output/acceptance/installed-bundle-frozen-member-model-2026-10-15.json`、`release-gate-member-model-2026-10-15.json` |
| 批次预算门禁 | 10 项本地 HTTP/持久化回归通过；完整验证 471 Node、6 browser、144 文件包检查，退出 0。真实网关接线与数值限额未完成 | `output/acceptance/verify-batch-budget-2026-10-15.log` |

浏览器测试使用真实产品组件、HTTP、Service 与持久化 Store，但模型边界仍是 fixture。连接探针成功只证明该次连接及模型响应，不等于规划质量或交付验收通过。

## 3. 本轮修复

### 3.1 模型目录查询等待有界

行为归属为 Service 的 `freezePlanningModelExecutionV3`。目录查询最多等待 10 秒；用户取消时，即使 provider 忽略 AbortSignal，也能释放等待。查询超时只结束 metadata lookup，沿用缺 provenance 的失败语义，不取消原规划、不伪造模型身份与容量证据。

两项回归覆盖目录永不返回与取消不被 provider 响应：修前均失败，修后均通过。日志见 `output/acceptance/model-info-regression-before-2026-10-14.log` 与 `model-info-regression-after-2026-10-14.log`。

### 3.2 首次 V3 规划启动死锁

真实触发链：

`HTTP 外层 serializedMutation → startDecomposition 等待 planningReservation → resolveMetricPolicyV3 首次建策略 → 再次 serializedMutation`。

外层锁等待保留记录，内层策略创建等待外层释放，导致请求超时且 PlanningOperation 不存在。AI 创建项目也在创建锁内启动规划，具有相同问题。

修复位置为 HTTP 规划入口及 Service 项目创建入口：规划启动不再处于 HTTP 的外层写锁；AI 创建先完成串行持久化，再启动规划。Service 自己在写锁内检查 Project 新鲜度、写入 pending 状态，随后释放锁。Policy successor 继续在已有写锁内原子登记，避免并发生成多个后继；后台策略与模型查询在锁释放后继续。operation reservation、策略发布自身写锁和后续摘要校验保留。

回归使用真实 HTTP handler 与 Service，分别验证 `decompose`、`create-ai`、`replan` 从没有 MetricPolicy 的 Store 启动：三个场景修前超时，修后返回 202，确实产生策略和 PlanningOperation。日志见 `output/acceptance/planning-http-lock-before-2026-10-14.log` 与 `planning-http-lock-after-2026-10-14.log`。

### 3.3 验收工具与环境

- Playwright 可通过 `PO_TEST_BROWSER_CHANNEL=chrome` 使用已安装的 Chrome；未设置时保持原浏览器选择。
- `prepare-harness-acceptance.mjs` 建立独立 Profile，只复制所选连接的配置和凭据。
- `select-acceptance-model.mjs` 选择验收模型，可同步用户更新后的连接配置；凭据不进入输出，探针结果保留历史。
- `run-real-planning-acceptance.mjs` 支持观察已有试跑，按创建时间选择最新 operation；请求失败写为 `observation_failed`，不会继续伪装为正常运行，也不会声称服务器端已经停止。
- 正式重试使用 Service 的 CAS、幂等及失败类型门禁；之前的 operation、诊断和观察记录保留。
- 原用户 `3080` Host 未修改。隔离环境保留验收数据；本轮启动的非必要 Chromium 下载已停止。

### 3.4 绑定阶段获得可校验的源码证据

真实模型报告无法读取文件，静态核对确认 frozen Planning 会禁止工具，而 Binding Prompt 原先仅提供路径和摘要。修复归属 `BindingStage`：服务读取已选证据，按 Git blob 及冻结文件摘要校验内容，将源码附在对应 evidence ref 上；跨 operation、目录越界 symlink、内容漂移、二进制或超出读取预算的文件拒绝。规划工具仍禁止执行。

每文件最多提供 16 KiB，合计最多 64 KiB；`truncated=true` 明确表示摘要片段，不能当作完整源码证明。文件内容作为不可信数据传入，不赋予其指令权限。7 个 BindingStage 测试通过，另有主链及拒绝路径定向回归。第三个真实 operation 已通过 Binding 及 Binding Review；该结果只覆盖 greeting 示例，不证明所有仓库都可规划。

### 3.5 Harness 失败终态不可当作成功回答

真实会话记录 `turn/end` 为 error，底层错误码 `PI_AI_ERROR`，原代码仅发现没有最终文本并返回 `agent-empty-response`。现在先检查 Harness 最后一个 turn 的失败终态，输出稳定的 `agent-turn-failed` 与经过字符限制的错误码；原始 provider 错误详情保留在 Harness 会话，不进入 Project 诊断。即使之前有非空 assistant 消息，也不能将它当作本次成功结果。

两种场景修前失败、修后通过；受控恢复仍有原有 3 次上限，失败事实不删除。

### 3.6 TaskPreflight 的零工具交接契约

静态检查发现 TaskPreflight 同样在 Prompt 中要求使用读取工具，而冻结模型会禁用工具。现在 Service 在进入预检前复用 `BindingStage.loadFrozenEvidence` 再次核对内容摘要，并仅向每个任务传入其实际引用 Binding 对应的源码片段。Prompt 明确工具不可用、源码是不可信数据、截断不能证明未读取的事实；缺事实需返回澄清，不能自称已读取。

新增回归修前失败、修后通过，覆盖仅相关文件进入 Prompt、源码正文存在、截断标记和指令权限。最新完整验证 448 项 Node、6 项浏览器测试通过。真实运行尚未越过能力资格门禁，因此真实 TaskPreflight 的效果仍待验证。

### 3.7 历史资格阻塞与后续确认

修复前软件成员需要 6 项能力，测试成员需要 7 项（另含 `testing.verification`），历史清单见[原确认清单](canary-capability-review-2026-10-14.zh-CN.md)，用户没有确认这 13 项。适用性修复后，真实要求减少为实现 4 项、验证 5 项；用户已明确确认这 9 项并授权登记。正式入口已完成登记；随后用户对实际新计划明确批准，计划审批及派发已完成。

只读审阅证据保存在 `output/acceptance/capability-review-evidence-2026-10-14.json`，包括真实推导结果、候选拒绝原因和四类审核状态。新真实 candidate 暂保存在 `output/acceptance`，没有混入 release corpus；缺独立 Gold 和稳定冻结输入时，CLI 导出成功不能当作一条发布资格通过记录。

### 3.8 Integration 后合法 HEAD 的 Dispatch 门禁

真实实现任务测试完成并被 Integration 纳入 canonical 仓库后，下一 frontier 被初始 planning base 的固定 HEAD 门禁错误拒绝。Delivery Service 现在以当前审批的 Integration、completed TaskRun、Inclusion Evidence、已提交 Intent 及连续 commit/tree 链计算合法预期 HEAD；Dispatch 仍校验当前仓库与 source of truth 一致。任意外部同 tree commit、缺失 Inclusion、损坏摘要和未收口 Intent 都拒绝且不创建 TaskRun。定向回归有修前失败及修后通过记录（`dispatch-integration-before-2026-10-15.log`、`dispatch-integration-after-2026-10-15.log`）。

### 3.9 V3 空闲 frontier 的启动恢复归属

重装隔离 Host 后，旧启动恢复错误调用 legacy `startExecution`，把已批准、没有活动 TaskRun 的 V3 项目标成 failed。现在启动恢复跳过 V3 自动执行，旧执行及 retry 入口明确拒绝 V3。仅对旧启动恢复的特定误标失败，校验当前审批摘要、计划、全部成功执行记录、冻结审核及合法 canonical HEAD 后恢复 approved 并记录系统活动，继续要求正式 Dispatch。真实失败或重启中的执行不自动放行。

回归覆盖 V3 idle、真实中断、legacy 恢复、损坏审批、失败 TaskRun 及幂等恢复。全量验证退出 0（451 Node、6 browser）。隔离 installed bundle 与本地 SHA-256 一致（`5ade9f0e464e862d1282757ab83bcbcdde832db8f65a174bf3827204e319264f`）；真实初始化保留原审批并恢复 approved，正式独立验证 Dispatch 随后成功，最终交付技术验收通过。没有直接改写隔离持久化 JSON。

## 4. 批量真实评测导出与冻结输入的本轮实现

以下修改归属 Service 的输入采集与导出层、领域 schema 和发布评测 manifest 入口；不改变业务审批、能力信任或质量门槛。自动化回归使用模型 fixture，不能记为真实模型质量证据。

### 4.1 Candidate V2 与历史 V1

新增运行有调用前冻结记录时导出 V2，包含真实阻塞原因、实际抵达阶段、已完成阶段的领域证据及已有人工审阅引用。早期业务 blocked 无需捏造后期 proposal/assignment；ready 仍要求完整旧闭合校验、全部阶段与 accepted preflight。failed 不得导出为业务 blocked。

历史无冻结记录的 operation 保持 V1，不回填资格证据；release manifest 明确拒绝 V1 candidate。针对 manifest 的真实子进程回归验证 V1 被拒、V2 契约可读取，而单个合成 case 无法取得发布资格。

跨项目、源记录/仓库摘要篡改、冻结内容损坏、无效或晚于首次模型 stage 的冻结时间、缺少模型 provenance、复用 predecessor 均拒绝。现有完整 ready 与 Assignment 弃权导出继续保留。

### 4.2 调用前冻结与稳定摘要

首次 requirement_analysis 模型请求前，operation 持久化 evaluationInput 及自身 inputDigest。该记录绑定源输入记录、仓库快照、完整团队语义事实、已解决 Decision 契约、实际 runtime bundle 摘要和已解析模型预算。仓库捕获失败只保留明确诊断与旧业务流程，不能取得 V2 发布资格。

重复运行摘要移除运行专属 ID，而保留真实语义：团队包含职责、autoAssignable、容量、Runtime 配置/生命周期、完整能力定义及 claim 来源/状态/有效期；sourceDigest 同时绑定语言与解析器版本；Decision 不使用生成 effect 替代原始输入；Prompt 摘要为包含模板/Persona/规则的实际 bundle SHA256。后续仓库采集和 Assignment 前重新比较冻结事实，漂移作为技术失败保留，不准输出资格 candidate。

回归覆盖调用发生时冻结记录已存在、相同输入两次早期 blocked 的摘要稳定、目录准备后两次 fresh ready 的摘要稳定且 operation 摘要不同、语言与成员变化改变输入摘要，以及运行中仓库/autoAssignable 变化拒绝发布。目录首次补齐本身是输入改变，必须在正式 Gold 冻结前准备完，不能忽略差异。

### 4.3 尚未完成的批次工作

8 仓库/24 需求已具体化为草案，并核对固定 Git commit、责任源码与现有测试入口。草案不是最终 Gold：具体成员资格、完整 owner 替代集合、稳定任务/分配预期、发布输入摘要和独立审阅签署还需完成。不能根据模型候选反向调整标准。

真实批次 `release-real-2026-10-16` 已启动，用户明确采用不限 token。账本为 `output/acceptance/release-collection-journal-2026-10-16.json`，manifest 为 `planning-evals/release-manifest.json`；候选经正式 GET 导出。全部 attempts 保留，至少每 case 五条新 operation，技术失败不改称业务 blocked。最终携带已确认的真实 canary 重跑 release gate，只有退出 0 才称整体验收通过。


### 4.4 真实仓库预检发现的 Provider 误阻塞

8 个已下载仓库在未调用模型的语义预检中，4 个被标为 partial。实际原因是 `.d.ts` 被 `transpileModule` 当作需要生成 JavaScript 的源码而抛出 Output generation failed，以及根目录 `test.js` 未被测试发现规则识别。修复在拥有源码解析和测试发现职责的 Provider 层：声明文件使用不产生输出、不解析外部依赖的 TypeScript 编译器语法检查；测试发现增加精确的根测试入口和 `test-d` 类型测试命名。

旧隔离安装包运行相同回归时，两种场景均失败；当前代码通过，非法声明语法和只有 manifest、没有测试文件的仓库仍拒绝。证据为 `repository-provider-before-canonical-2026-10-15.log`、`repository-provider-after-canonical-2026-10-15.log`。修复后真实 8 个仓库全部 supported，报告 `output/acceptance/release-repository-preflight-fixed-2026-10-15.json`；这是只读 Provider 预检，既没有执行第三方代码，也没有产生模型 candidate，不能当作 120 次真实评测的一部分。

### 4.5 首次模型前准备与实际采集

输入冻结职责仍在 Service：初始项目可先通过 pending 准备接口建立能力定义，再使用只读 preview 计算与正式 operation 同源的 releaseInput。preview 不启动规划、不写领域 repository snapshot、不确认能力，拒绝无策略、无模型容量、历史已提交计划或已解决 Decision，以及准备期间的项目/团队/策略漂移。相关回归随 475 项 Node 和 6 项浏览器测试通过，安装后运行已实际使用这些接口。

独立输入审阅 v6 的 8 个仓库、24 条样本全部 approved：`output/acceptance/release-independent-review-v6-2026-10-16/summary.json`。审阅器为真实 `pockapi / gpt-6.1-sol` 请求，保存完整输入、响应、usage 和结论，不冒充人工确认。ready 项目 PRD 的更新报告为 `output/acceptance/release-ready-inputs-updated-2026-10-16.json`。已冻结的 8 项 blocked 仍使用 v5 原输入与原 Gold，不回写为新版；ready 尚未运行候选。

blocked Gold 的独立审阅在 `output/acceptance/release-gold-review-blocked-v2-2026-10-16/`，均先于对应首个候选。采集通过正式规划入口创建 operation，正式 GET 导出候选并核对 Gold provenance、schema 和逐项质量。初次误用 POST 导出产生的 route-not-found 保留为 infrastructure_failure；同一个 operation 后续以正确 GET 导出，另记 export-recovery，未新增模型请求。观察进程切换为最多四个不同项目并发，保留正在运行的 Host operation，沿原账本恢复，不重复发起同一尝试。

采集器还发现 operation 终态早于 Project 恢复为 draft 的短暂窗口。mitt 的第三次尝试在 HTTP 请求前断言失败，未创建 operation。实际 Project 恢复时间比该次准备起点晚 149 毫秒。采集器已改为等待 Project 的 status 和 activePlanningOperationId 收口；原失败按 infrastructure_failure 保留，经 API 核对 operation 集合与 PRD 均未变化后，另建 local-preflight-recovery 尝试，再通过正式入口继续。恢复检查没有调用模型或改写领域数据，证据为 `output/acceptance/release-local-preflight-recovery-2026-10-16.json`。采集日志恢复行的旧显示键为 fresh-3，权威 journal/manifest 使用完整的 `fresh-3/local-preflight-recovery` attemptId；后续输出已统一使用记录自身的 ID。

`output/acceptance/release-projects-2026-10-16.json` 的 SHA256 仍为 `de4d0c0342a6525df57cfc1efdafd102b2be08366eb41c4e90681d4126b128d2`。只读核对 16 个 ready 项目的 204 条声明，全部 digest 与清单相同，仍为 pending / legacy_pending_mapping。需要用户对这份具体清单确认后才能正式登记；此前 greeting 的 9 项授权不能外推。

### 4.6 已完成的未决场景与剩余覆盖

8 仓库的未决场景均完成 5/5 个独立 operation，共 40 个有效 real_model 候选；journal 无未结束尝试。42 条已完成 attempts 包含 40 条候选和两条保留的 infrastructure_failure，原导出恢复没有新增 operation。正式门禁报告为 `output/acceptance/release-gate-blocked-batch-2026-10-16.json`：需求召回 40/40、阻塞原因精确率与召回率 40/40、必要阶段证据 120/120、错误放行 0、模型失败 0。该 120 是阶段证据分母，不是 120 次规划。整体 gate 退出 1，requiredAcceptanceCoverage、Binding、分配、falseBlocked、firstPass 等指标暂不适用，且只有 8 个样本，没有 ready 与成对恢复证据。

检查 grader 的现行契约还发现：原 16 个 ready 的 assignmentExpectations 全为有合格成员，8 个未决场景则在 decisions 阶段停止，因此即使补齐原 120 次，correctAbstentionRate 仍没有分母。为覆盖现有门槛而非降低门槛，补充 `plimit-wrapper-counts-no-member`：复用已审阅的 p-limit getter 需求、固定 commit 与可写 scope，单独新建无执行成员的隔离项目，预期到达 assignments 并对两个任务各记录 abstained-no-eligible。原 24 个样本、Gold、能力确认机器清单和质量阈值均不回写。

补充输入与项目事实见 `output/acceptance/release-abstention-input-2026-10-16/`、`output/acceptance/release-abstention-project-2026-10-16.json`。仍先独立审阅完整 Gold 和运行前指纹，再执行 5 次 fresh 真实规划；不为负例登记能力或派发任务。完整批次因该项变为 25 个场景、至少 125 个有效候选，仍使用原“至少 24 / 至少 120”的最低门槛。

该补充 Gold 已独立审阅 approved，证据为 `output/acceptance/release-gold-review-abstention-2026-10-16/`。为并发运行准备 5 个相同初始输入的隔离项目，所有 preview.releaseInput 在任何候选前均与同一 Gold 精确一致，报告为 `output/acceptance/release-abstention-replicas-2026-10-16.json`。它们只算一个样本、一个仓库；候选仍须具备各自唯一 operation、无 predecessor 和完全匹配的 provenance。采集器使用单进程、统一 journal，最多四路并发；没有使用多个进程竞争写账本。

### 4.7 无成员反例的真实失败与阶段职责修复

旧批次 `release-real-2026-10-16` 的无成员反例在前 4 次真实 operation 均过早停在 requirement_review：分析把执行成员缺失写为 blocked，并把规划控制说明拆成产品义务，独立需求审阅仍 approved。未进入 assignment_qualification，不能计为正确弃权。旧账本现有 46 条 attempts、44 条候选（40 条正确、4 条质量失败）和 2 条基础设施失败；第五次负例未启动。原 Gold、候选、manifest 和响应均保留，报告见 `output/acceptance/release-gate-abstention-failed-2026-10-16.json`。

修复归属 `src/service.ts` 的需求分析与独立审阅提示词，二者共享阶段职责规则：成员/能力/容量/执行授权不足交给后续确定性资格阶段；真正的业务未决仍阻塞；调用控制保留 out_of_scope 审计，不虚构产品功能，也不能丢弃真实产品测试与失败处理要求。没有绕过 analysis.status 门禁，没有改 Gold 或降低阈值。新增 Service 回归验证需求 ready、完整 proposal、两个 abstained-no-eligible、无任务发布和派发，并检查 analyst/reviewer 均收到同一职责规则。

修前/修后日志为 `output/acceptance/requirement-stage-boundary-before-2026-10-16.log`、`requirement-stage-boundary-after-2026-10-16.log`。完整 `pnpm test` 476/476、浏览器 6/6、typecheck、build 与 smoke:package 均退出 0，对应 `test-`、`browser-`、`typecheck-`、`build-`、`package-requirement-stage-boundary-2026-10-16.log`。完整 `pnpm verify` 当前不声称通过，真实 corpus 尚有未完成与质量失败。

修后隔离安装使用 `output/acceptance/requirement-stage-boundary-package/dsh-project-orchestrator-1.7.0.tgz`，Host 日志为 `certified-host-requirement-stage-boundary-2026-10-16.log`；`canary-export-stage-boundary-2026-10-16.json` 再次证明原交付摘要与实际源记录一致。准备脚本新建 5 个无成员项目，机械断言原 PRD 及所有 releaseInput 事实相同、仅 promptVersionsDigest 改变；见 `release-corrected-abstention-projects-2026-10-16.json`。新 case `plimit-wrapper-counts-no-member-stage-boundary-v2` 必须先获得独立 Gold 审阅，再单次真实复验，不能将不同 bundle 的旧成功记录混为修后完整资格。

该 case 的 Gold 已 approved，首个真实 operation `planning-v3:4d2117a3-a441-47f3-bc5f-eb58662d3794` 实际分析为 ready、需求审阅 approved，随后在 scenario_coverage_review 因 `reviewer-not-independent` 正确阻塞。产品异步维度导致高风险，必须有独立项目 Reviewer；原负例的无成员团队不满足这个更早的前置条件，独立 Gold 审阅漏审了该条件。没有关闭独立性门禁或回写 Gold；`release-stage-boundary-2026-10-16` 保留这一失败，正式报告 `release-gate-stage-boundary-first-2026-10-16.json` 退出 1。

新的 `plimit-wrapper-counts-no-executor-reviewer-v3` 保留相同 PRD、模型、提示词与质量标准，仅加入一个真正配置的非自动分配 Reviewer。五个项目均无执行成员、无能力声明，preview 机械核对仅 teamCatalogDigest 变化；该成员实际通过冻结模型请求执行审阅，不以角色名称代替审阅结果。Gold 再次在候选前独立 approved，证据为 `release-gold-review-abstention-reviewer-2026-10-16/`。审阅工具补充了高风险独立性与早期 Decision 的阶段前置契约，防止再次只审摘要而漏查必经门禁。当前批次 `release-reviewer-precondition-2026-10-16` 正在单次真实复验，不能先宣称弃权通过。新版本的 8 个未决场景 Gold 也已全部独立审阅 approved（`release-gold-review-pending-stage-boundary-2026-10-16/summary.json`）；原 40 条成功只作为旧版证据。

配置 Reviewer 后，operation `planning-v3:69369c70-5c03-4a63-9a3b-85231347f02b` 的场景审阅 approved / independent，随后 Binding Review 发现生成器为 REQ-001 额外授权 readme.md、recipes.md、benchmark.js、package.json 和 .github/workflows/main.yml，与原四文件限制冲突。独立审阅正确拒绝，未到达资格阶段；报告为 `release-gate-reviewer-first-2026-10-16.json`，批次停止于第一条失败，没有启动余下四次。

代码核对确认：Binding 和 Task Prompt 仅序列化 in_scope requirements，需求阶段保存在非产品 dispositions 中的精确写入范围及任务组织约束被遗漏；Binding 又明确要求将所有检查 owner 放入 allowedPathScopes。修复直接落在这些提示词的生成层：保留完整非产品 disposition 作为约束数据，明确不恢复已排除产品需求；声明、消费者、命令配置或 CI 可以作为检查证据，只有真实目标写入才获得范围，无法在原限制内实现时仍阻塞。需求分析同时要求支持同一命名需求的回归、类型检查与兼容细节保持归属，避免另造重复产品需求。

跨阶段回归实际检查两个下游 Prompt 均收到与冻结分析完全相同的 dispositions，同时维持最终两个弃权、无任务发布/审批/派发。修前失败、修后通过，见 `scope-handoff-before-2026-10-16.log`、`scope-handoff-after-2026-10-16.log`。此处是模型边界数据传递回归，不证明真实生成质量；仍须安装、冻结新 Gold 并真实复验。此前两个失败批次和旧 Gold 均不修改。

四文件修复后的 operation `planning-v3:a2ca096a-f9de-473e-9a53-2bda59d4a7e1` 只有一个 in_scope REQ-001，Binding 范围精确匹配四文件且独立审阅 approved；后续任务提案却把源中的“不得发布 ready”混同于自身 proposal.status=ready，认为完整任务与禁止派发互相冲突，于 task_plan 返回 blocked。失败保留在 `release-scope-handoff-2026-10-16`，正式报告 `release-gate-scope-first-2026-10-16.json` 退出 1。

任务 Prompt 现明确 ready 仅代表完整提案，尚无分配，也不会自行发布 Task；没有成员、可信能力、容量或执行授权由后续 Service 门禁判断，不能据此提前拒绝提案。真正业务未决、目标冲突、缺证据或必需写入越界仍阻塞。契约回归修前失败、修后通过；最新完整 `test-task-proposal-boundary-2026-10-16.log` 476/476、`browser-task-proposal-boundary-2026-10-16.log` 6/6，类型和 145 文件包检查通过。安装记录见 `installed-bundle-task-proposal-boundary-2026-10-16.json`。

最新 `plimit-wrapper-counts-no-executor-task-v5` 沿用上一负例的源文本、Reviewer、无执行资格、仓库、模型与预算事实，仅 promptVersionsDigest 变化；五个项目的 preview 均精确一致。Gold 先独立 approved（`release-gold-review-abstention-task-2026-10-16/`），再启动 `release-task-boundary-2026-10-16` 真实采集。首条 operation `planning-v3:f457c1ef-f7db-4fbd-83e9-309fcff82248` 的需求、场景、四文件 Binding 和 Plan 审阅均通过；两个完整任务最终各记录 abstained-no-eligible，停在 assignment_qualification，无审批、发布或派发。该候选所有适用质量指标达标，falseReady 与 substantiveRewrite 均为 0。证据为 `planning-evals/cases/plimit-wrapper-counts-no-executor-task-v5/runs/fresh-1.json`。

首条正式 gate 报告 `output/acceptance/release-gate-task-first-2026-10-16.json` 仍退出 1：仅有一个仓库、一个场景、一个候选，缺少 ready、成对恢复和完整覆盖。该 bundle 的 8 个未决场景 Gold 也曾逐项独立 approved（`release-gold-review-pending-task-boundary-2026-10-16.log`）；补采因上述模型运行失败停止，日志为 `release-collection-task-rest-2026-10-16.log`。旧失败不并入新版本成功记录，不修改其 Gold 或候选；204 条具体能力确认仍是 ready 部分的前置条件。

候选前检查又发现 16 个 ready 草稿缺少高风险审阅前置角色；已通过正式成员接口补齐同一非执行 Reviewer（autoAssignable=false、无能力声明），只改变 teamCatalogDigest，需求、仓库、模型、策略和全部能力记录均保持原值。`release-ready-reviewer-prepared-2026-10-16.json` 逐项目核实 draft、0 operation、尚无 Gold，且未创建任何 human_confirmed。最终 Gold 须冻结补齐 Reviewer 且获得具体能力确认后的团队事实。

本轮补充检查：Reviewer 准备脚本语法、`pnpm docs:check` 和 `git diff --check` 通过；`pnpm eval:planning:subset` 实际退出 1，因为扫描到历史 `hono-cors-maxage-policy-pending-scope-v3` 的 Gold，但该历史批次尚无 runs 目录，证据为 `subset-current-corpus-2026-10-16.log`。因此不将此前 476 Node/6 browser 等独立检查冒充当前完整 `pnpm verify` 通过；未删除历史 case 或跳过失败以取得绿色结果。

随后修正本地回归入口的作用域：`eval:planning:subset` 显式选择原有 large-typescript-owner 的 5 条 fixture；无参数运行仍扫描完整目录并暴露不完整历史。新增回归验证默认扫描/显式选中历史都失败，选中 fixture 仅通过本地评分且发布资格为 false，`--cases` 与 `--release` / `--manifest` 组合一律拒绝。正式 release 仍完整加载所选冻结 manifest 的所有样本和失败，不过滤失败、不改阈值；见 `subset-selection-before/after-2026-10-16.log`。这项工具修复不改变产品 bundle。

verification-scope 安装前，477 Node、6 browser、typecheck、docs 和 145 文件包检查实际通过。首次隔离安装误用了 auto-install-peers=false，造成 Harness peer 被裁剪、Host 启动失败；恢复该 profile 原有 auto-install-peers=true 后实际启动成功，未改业务 JSON。事件日志及恢复记录保留在安装报告。新增 Gold 输入保持原源/团队事实，只更新提示词指纹；8 项未决草稿复用 39 个未运行项目，只替换 1 个已有终态 operation 的草稿，旧项目和候选不删除。

本轮影响范围为 Planning 的需求、Binding 和 Task Prompt 数据与职责契约；执行与交付状态枚举、能力信任、分配算法、独立审阅和发布阈值未放宽。若需撤回隔离安装，先确认无运行 operation，再重装保留的上一 tarball 并校验 bundle 摘要；不覆盖领域 JSON、不删除候选或失败、不将代码回退误当数据恢复。不同 bundle 的新候选须对应其自己的冻结 Gold 和批次。原 3080 用户 Host、上游仓库和正式发布未变更。

## 5. 剩余验收顺序与通过标准

| 顺序 | 必须完成的工作 | 通过判据 |
| --- | --- | --- |
| 1 | 死锁修复全量回归并重装隔离 Host | 修改后的完整 verify 退出 0，安装包哈希一致，真实 HTTP 启动不再无限等待 |
| 2 | 小样本真实规划与恢复 | 实际阶段、阻塞原因和模型身份有记录；能力确认经正式入口，失败与重试保留 |
| 3 | V2 导出及冻结输入契约 | 前述正反例回归通过，Service→CLI→grader 闭合 |
| 4 | 独立冻结真实 Gold | 至少 8 个不同仓库、24 个独立审阅需求，包含 ready/blocked 及成对恢复；审阅者可核实，不伪造签名 |
| 5 | 批量真实模型采集 | 每 case 至少 5 次不同 operation，至少 120 次有效运行；失败 attempts、配置和消耗保留 |
| 6 | 完整交付 canary（已完成） | Source→审批→Dispatch→TaskRun→真实验证→Integration→Convergence→人工确认同一版本与最终 commit 闭合，真实 V2 canary 已接受 |
| 7 | 最终人工审阅（已完成）与发布门禁（未完成） | 用户已审阅最终 diff 并正式确认交付；批量评测门禁仍退出 1，须退出 0 才可声明整体验收通过 |

本地验证、模型连接、真实规划、用户确认和正式发布资格分别记录。未经实际检查的最终 diff 不得代填用户确认。尚未部署或发布到用户原 Host，也未提交或发布仓库变更。
