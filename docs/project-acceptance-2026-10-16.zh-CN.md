# 项目验收结果与后续执行方案

日期：2026-10-16。对象：dsh-project-orchestrator@1.7.0，隔离 Host http://127.0.0.1:3087。

## 当前结论

2026-10-17 02:34：v34 的 25/25 项 Gold 四组独立 approved，全部进程退出 0，最后批准 18:33:09.622Z；逐项核实绑定当前 bundle、晚于安装且早于本版任何候选。正式采集单 owner 已从零启动，优先 maxQueued 恢复、p-map observer、Ky URL 恢复、Zod overlap 恢复，最多四个逻辑槽，逐样本轮转补足五条。状态及子账本为 `output/acceptance/release-tool-fault-v34-completion-2026-10-17/`；正常收口程序已实际启动，日志为 `release-tool-fault-v34-final-2026-10-17.log`。启动不代表通过；一旦质量失败即停新增并让在途自然收口，失败不删去、不换样本或补数稀释。

2026-10-17 02:31：v34 已实际安装于隔离 3087，Host PID 29307、writer fencingToken=36、healthy；本地/包内/安装 bundle 摘要一致，原 3080 PID 2095 保持运行。256 条能力及 52 条历史 pending 逐项不变，真实 V2 canary 复验通过，24 组历史/61 项目/29 后继证明核验退出 0。证据为 `installed-bundle-tool-fault-v34-2026-10-17.json`、`canary-export-tool-fault-v34-2026-10-17.json`、`release-historical-observations-v34-2026-10-17.json`，均在 output/acceptance。

真实工具证据对照退出 0：缺工具原输入 blocked，补齐工具源码后 ready、相同原独立 Reviewer approved/findings=[]，共 3 次真实调用。故障连接原/新对照也退出 0，共 4 次调用；本次原/新都获批准，不能声称统计批准率提升。证据为 `scenario-{tool-evidence,fault-connection}-probe-v34-2026-10-17/summary.json`。原正式失败不改判，这 7 次诊断不计候选。25 项新 Gold 的四组独立审阅已启动，尚无本版候选；全部 Gold 通过且确认晚于安装、早于候选后，才开始从零正式采集。

2026-10-17 02:26：v33 四根均已自然终态，Hono、p-limit 达标，p-queue、p-map 质量失败；0 根模型失败、0 策略替代。原 owner、正常 finalizer 均退出 1；归档程序实际运行正式 gate 并于 18:25:58Z 退出 1，结果为 `output/acceptance/release-combined-callable-fixture-v33-2026-10-17-result.md`，领域与真实 canary 核验退出 0。未审批或派发评测任务。

v34 完整 `PO_TEST_BROWSER_CHANNEL=chrome pnpm verify` 已退出 0：525 Node、6 browser、类型、文档、原 fixture 子集及 153 文件包检查；日志 `output/acceptance/verify-tool-fault-v34-2026-10-17.log`。最后一处仅改为缺工具时省略可选字段，最终 bundle 的两项相关回归另行退出 0：`verification-tool-evidence-v34-final-bundle-2026-10-17.log`。本地 bundle 与 tar 内 bundle SHA256 均为 `e0bd943a792a88f5debdc5cfa8acafce6073e554908a2bf0ad02782a24abea1f`；tarball SHA256 为 `e7f7edbc19d5654d13d8ee2767bd121ed7d3aa137147b25cc54d94b2119eb66b`。尚未安装，不代表新版正式通过。

`tool-and-fault-grounding-v34-2026-10-17.json` 实际退出 0：npm 能从隔离父目录发现 nz@0.1.0，使用 TypeScript@6.0.3；受控类型正例通过、错误声明使负例退出 1；未连接 signal 的 p-map 保持未决，连接后以同一 sentinel 拒绝。8 个上游仓库 Git 状态前后均空；实验未实现未来需求，也不计候选。真实新旧诊断仍在运行，结果待核实。

2026-10-17 02:25 当前进展：正式验收尚未通过。v33 的 p-queue 在 scenario_completion 因缺少 nz 发现/派生编译配置证据阻塞；p-map 在独立场景审阅因 AbortController 未连接到被测调用阻塞。Hono 与 p-limit 的原请求仍在途，等待自然终态后归档本版正式失败，不重发、不补数。256 项能力已登记，用户关于模型、无限 token 与隔离验收的授权持续有效，无须重复确认。

v34 修改正在验证：采集层仅冻结本地安装、由验证脚本使用且符合保守声明版本检查的工具入口及相对源码，将文件摘要纳入 repositoryDigest，并供应场景生成、独立审阅及 Binding；不将其纳为仓库写范围或已执行测试证明。生成器新增通用故障注入连接约束，Reviewer 标准和原 PRD 不变。nz 与 TypeScript 的保留包仅离线安装于 output/acceptance/repositories/node_modules；8 个上游仓库不修改。缺工具/版本不符/越界/变化等回归、真实新旧诊断和完整验证未全部完成前，不认定新版可验收。

2026-10-17 01:59（上海时间）：v33 的 25/25 项 Gold 四组全部独立 approved、进程均退出 0；最后批准 `2026-10-16T17:58:18.844Z`，逐项核实绑定本版 bundle、晚于安装且早于本版候选。单 owner 四条 lane 正式采集已从零启动，优先 Hono expose、p-map observer、maxQueued 恢复和 p-limit wrapper，再逐样本轮转补足五条。状态为 `output/acceptance/release-callable-fixture-v33-completion-2026-10-17/state.json`，正式收口程序已实际启动，日志为 `output/acceptance/release-callable-fixture-v33-final-2026-10-17.log`。尚无本版终态或正式门禁通过结论，下文保留修复与执行证据。

2026-10-17 01:56（上海时间）：v33 隔离安装、持久化能力与 canary 复核均通过，Host PID 89569、fencingToken=35、healthy。256 条已确认能力和 52 条 pending 历史逐项不变；原 greeting commit、两条 TaskRun、人工审阅与交付事实一致，原 3080 PID 2095 未动。23 组历史、61 项目及 29 条后继终态证明核验退出 0。证据为 `output/acceptance/installed-bundle-callable-fixture-v33-2026-10-17.json`、`output/acceptance/canary-export-callable-fixture-v33-2026-10-17.json` 与 `output/acceptance/release-historical-observations-v33-2026-10-17.json`。25 项新版 Gold 四组独立审阅已实际启动，尚无本版正式候选或验收通过结论。

2026-10-17 01:53（上海时间）：v32 四条独立根全部终态，collector 与正常 finalizer 均退出 1；正式归档 release gate 实际退出 **1**。4 条有效候选中 Zod、Ky、Mitt 达标，Hono 因场景调用形状错误质量失败；0 根模型失败、0 策略替代。领域及 V2 canary 核验退出 0，0 审批/派发/TaskRun。结果为 `output/acceptance/release-combined-stage-contract-v32-2026-10-17-result.md`；原失败完整保留。v33 原 25 份 PRD 字节、项目 ID、配对及能力不变，机械版本隔离已通过；隔离 3087 升级已开始，原 3080 PID 2095 未动。新版尚无 Gold 或正式候选，不能宣布验收通过。

2026-10-17 01:48（上海时间）：v32 Mitt 已 committed，正式评分全部适用指标达标；Hono 原失败保留，Zod、Ky 仍在途。v33 完整 `PO_TEST_BROWSER_CHANNEL=chrome pnpm verify` 实际退出 0（524 Node、6 browser、类型、文档、fixture 子集及 151 文件包检查），最新文档检查另行通过。真实调用形状对照的原/新场景均被同一原 Reviewer approved、findings=[]，对照进程退出 0；不能宣称批准率提高。修后场景显式使用正确嵌套并追踪回调到错误处理器，证据为 `output/acceptance/scenario-callable-fixture-probe-v33-2026-10-17/summary.json`，不计正式候选。v33 bundle SHA256 `115c2144daad54db1e2958ebf98f4b19b1a5bd10dcffeb95f3c0a2b0f85cc1e9`、tarball SHA256 `3dd0c2ed432b76cc15411c1c41aecc6c2210a171ca10f2d071c138108704fbec`；包已准备、未安装，v32 收口与正式归档优先完成。

2026-10-17 01:42（上海时间）：v32 首批 Hono 在 `scenario_coverage_review` 被拒绝，错误为 `scenario-trigger-invalid-compose-middleware-shape`。冻结证据含完整 `compose` 参数声明和 `middleware[i][0][0]`，但场景使用了少一层数组的 `compose([[middleware], [downstream]], onError)`，目标回调不能执行。原失败保留，停止新增，在途 Zod、Ky、Mitt 自然收口；正式 gate 尚未运行，不能宣布通过。拟 v33 只在场景生成阶段增加通用调用形状与回调可达性核对，不改 PRD、Gold、审核或阈值。冻结源码实验实际退出 0：错误调用产生两个 TS2322、运行时回调零次；正确嵌套调用通过调用点类型检查，错误处理器执行一次并保留异常身份。证据为 `output/acceptance/callable-fixture-shape-v33-2026-10-17.json`，只证明既有 compose 机制，不冒充未来 exposeHeaders 功能验收。新版真实对照与完整 verify 已实际启动，尚未安装。

2026-10-17 01:28（上海时间）：v32 的 25/25 项 Gold 四组均独立 approved、全部进程退出 0；最后批准于 `2026-10-16T17:27:29.314Z`，逐项核实绑定本版 bundle、晚于安装且早于本版候选。正式采集已从零启动，优先 Zod trim、Ky URL 恢复、Mitt listenerCount、Hono expose，单 owner 四条 lane，逐样本轮转补足五条。状态为 `output/acceptance/release-stage-contract-v32-completion-2026-10-17/state.json`，正式收口程序已实际启动，日志为 `output/acceptance/release-stage-contract-v32-final-2026-10-17.log`。尚无本版正式门禁通过结果；下文记录本轮修复与证据。

2026-10-17 01:07（上海时间）：v31 已全部自然收口并正式归档，release gate 实际退出 **1**。4 个独立根中 3 条有效候选：Hono 达标，Mitt 在 Binding 缺证，Ky 在计划审阅遗漏冻结场景单独要求的 AVA 调用；Zod 发生 `plan-reference-invalid` 根模型失败，把上游 `ref-repo-f00011` 用于任务阶段。原失败全部保留，未审批、未派发。正式结果为 `output/acceptance/release-combined-binding-type-chain-v31-2026-10-17-result.md`，领域及 canary 核验均通过，不能据此改判整体验收通过。

拟 v32 本地修复：将 `.gitignore/.npmignore/.dockerignore` 作为明确允许的策略文本纳入冻结仓库检索，不放开任意 dotfile；19 项检索回归通过，新增测试修前失败。实际 Mitt 原提示的证据回放逐字匹配，修后 `.gitignore` 全文供应，正例 ready、删策略内容负例 blocked，两次真实诊断退出 0，证据为 `output/acceptance/binding-ignore-policy-probe-v32-2026-10-17/summary.json`。此前诊断脚本因新增 inventory 分段解析失败，发生在模型调用之前；修正后的调用独立记录，原日志保留。此小样本不证明稳定改善率，也不补正式候选。

另在场景生成与审阅的同一冻结证据中纳入真实 `verificationCommands` 清单，避免场景额外引入无法映射 Task 命令 ref 的独立调用；保留源文要求的文件覆盖、真实发现配置和编译检查，源文确实要求但清单缺失时仍须阻塞。Task 提示要求 `Evidence claim refs`、`Verification command refs`、`Policy refs` 分种类引用，不把 Binding 内嵌仓库 ref 直接复制到 Task。v32 已安装到隔离 3087，正式批次尚未启动，Gold 正在独立审阅。

v32 最新完整 `PO_TEST_BROWSER_CHANNEL=chrome pnpm verify` 已实际退出 0：524 项 Node、6 项浏览器、类型、文档、fixture 子集及 151 文件包检查通过；fixture 不具备完整 corpus 资格的诊断仍保留。日志为 `output/acceptance/verify-stage-contract-v32-2026-10-17.log`。场景命令清单的集成回归修前失败、修后通过，且实际检查清单对生成/审阅/持久化一致，改变清单使原审阅输入摘要不再匹配。bundle SHA256 `fb03944a7875c25bf42fc6efb7cca9486aece06dc63417454a4968c528e81892`，候选 tarball SHA256 `538de7ae945e565a1027391b2d1207848fad992e242296cc048af58405140524`。

首次新 Task 提示诊断在原 Zod 场景上返回 blocked：该旧场景同样额外要求了未进入注入清单的双文件定向命令。诊断实际退出 1，不能改判为任务生成通过；证据为 `output/acceptance/task-reference-probe-v32-2026-10-17/summary.json`。Ky 原/新场景和 Zod 新场景真实对照已启动，独立审阅完成后再以修后场景诊断任务引用；不重跑或修改原 operation。

Ky 原/新场景对照已实际退出 0：两份均被原独立审阅 approved、findings=[]，不能据此断言批准率提高。结构化 trigger 的差异可核实：原提示再次要求清单之外的独立 AVA 文件选择调用；新提示沿 `npm run test` 的真实发现和编译阶段完成三份运行时文件及类型文件覆盖。证据为 `output/acceptance/scenario-command-catalog-probe-v32-2026-10-17/summary.json`。Zod 新场景也已被原独立审阅 approved、findings=[]，保留 classic/mini 两份确切回归路径及项目模式编译入口；证据为 `output/acceptance/scenario-command-catalog-zod-probe-v32-2026-10-17/summary.json`。

2026-10-17 01:24（上海时间）：v32 安装证明实际退出 0，Host PID 56788、fencingToken=34、healthy；256 条已确认能力与 52 条 pending 历史逐项一致，V2 greeting canary 的原 commit、两条 TaskRun、人工审阅及交付事实复核通过。原 3080 PID 2095 未动。22 组历史、61 个项目和 29 条后继终态证明核验通过；证据为 `output/acceptance/installed-bundle-stage-contract-v32-2026-10-17.json` 与 `output/acceptance/release-historical-observations-v32-2026-10-17.json`。25 项新版 Gold 四组独立审阅已实际启动，全部批准和任务诊断通过之前不启动正式候选；安装与诊断不等于正式验收通过。

Zod 修后场景的 Task 引用真实诊断于 `2026-10-16T17:24:50.550Z` 完成，实际退出 0：两项任务通过完整原 `parseGeneratedPlanV3` 校验，将合法任务的 claim ref 人为替换为上游 `ref-repo-f00011` 的负例仍被 `plan-reference-invalid` 拒绝。证据为 `output/acceptance/task-reference-revised-scenarios-probe-v32-2026-10-17/summary.json`；仅诊断，不写领域或计入正式候选。

## 历史执行记录

以下保留各历史时点的安装、运行与诊断描述；后续终态以本页“当前结论”和对应正式归档为准。

2026-10-17 正式采集已启动：25/25 项 Gold 四组独立审阅全部 approved、进程退出 0，最后批准为 `2026-10-16T16:43:25.621Z`；逐项核实当前 bundle、晚于安装且早于本版候选。单 owner 四条 lane 从零采集，优先 Ky URL 恢复、Zod trim、Hono expose、Mitt listenerCount，再逐样本轮转补足五条。采集状态为 `output/acceptance/release-binding-type-chain-v31-completion-2026-10-17/state.json`，正式收口程序也已启动，日志为 `release-binding-type-chain-v31-final-2026-10-17.log`。目前尚无正式 gate 通过结论，不将启动或 Gold 通过写成整体验收通过。

2026-10-17 最新隔离状态：v31 已安装到 3087，bundle SHA256 `f170994f0cddc08e3e00a7dd63593bc6361395f1554e2014302672d34cf356c2`，tarball SHA256 `d204073ccc797e8f37393733f7ffd03541bf0159a81501b950a141392021a646`；Host PID 9413、fencingToken=33、healthy。256 项能力和 52 条 pending 历史逐项不变，真实 V2 greeting canary 复验通过；原 3080 PID 2095 未动。21 组历史、61 项目与 29 条后继终态证明核验通过。Zod、Ky 最新真实正例均 ready、负例均 blocked，两项对照实际退出 0，诊断不计 fresh；此前失败保留。25 项新版 Gold 四组独立审阅已实际启动，全部批准前不运行正式候选。安装、canary、历史与诊断证据分别为 `installed-bundle-binding-type-chain-v31-2026-10-17.json`、`canary-export-binding-type-chain-v31-2026-10-17.json`、`release-historical-observations-v31-2026-10-17.json`、`binding-{zod,ky}-inspection-probe-v31-2026-10-17/summary.json`，均位于 output/acceptance。

v31 最新完整本地验证实际退出 0：`PO_TEST_BROWSER_CHANNEL=chrome pnpm verify`，523 项 Node、6 项浏览器测试、类型、文档、fixture 子集和 151 文件包检查通过；最新文档检查另行通过。日志为 `output/acceptance/verify-binding-type-chain-v31-final-2026-10-17.log`。bundle SHA256 为 `f170994f0cddc08e3e00a7dd63593bc6361395f1554e2014302672d34cf356c2`。两份扩展源码审计通过，真实负例均 blocked，真实正例仍待终态。本地 fixture 子集不满足完整 corpus 资格是预期边界，不能冒充正式 release gate 通过。

2026-10-17（本地时间），v31 本地修复中：用户确认的 204+52 项能力已正式登记，无须重签；9 项 greeting 能力另计。修复普通 Scenario/Acceptance 诊断键校验、冻结类型与执行声明闭包、小型显式模块与公共导出、作为调用参数的过滤表，以及新增文件 inventory 说明。两份最新严格源码审计均退出 0，见 `binding-{zod,ky}-call-arguments-v31-2026-10-17.json`；Ky 检查还包含 requestOptionsRegistry、公共导出、现有 request-options 回归和完整 retry 注释。57 项定向回归通过。

此前真实诊断：Zod 原证据 blocked、修后 ready、删除核心内容负例 blocked，对照退出 0；Ky 原证据 ready、修后 blocked、负例 blocked，对照退出 1，说明原 ready 不能证明证据充分，也不能据此宣称改进。Ky 的三项具体缺证已进入修复及扩展审计，新版两项正反对照已实际启动。完整 verify 首次发现集成测试按旧提示分段解析 JSON，已同步新 inventory 分段，保持场景数量和字段断言；定向集成回归通过，完整 verify 正在重跑。原失败与全部诊断保留，不计正式候选。本版尚未安装、未冻结新 Gold、未取得正式发布验收通过。

2026-10-16T15:44:31Z：v30 已自然收口，正式 gate 实际退出 1。4 个独立根中 2 条有效候选（Mitt 达标、Ky 质量失败），1 条策略替代、1 条 Zod 根模型失败。Zod 合法的普通场景诊断键被解析器拒绝，且其真实响应报告 boolean 输出与 codec 执行声明缺证；源码审计逐项复现供应遗漏，原输入回放完全一致。指定 mini 回归文件在冻结 inventory 中不存在，应作为新增测试规划，不能伪造既有文件证据。Ky 已越过旧 Binding 阻塞，最终因重试声明注释被裁掉、策略选项归属不明确而在 task_preflight 拒绝；不把它改判为通过。Hono 自动后继 committed，不计 fresh，0 审批/派发/TaskRun。结果及后继证明为 `output/acceptance/release-combined-binding-manifest-v30-2026-10-16-result.md`、`release-combined-v30-policy-successors-2026-10-16.json`。拟 v31 修复诊断键契约及冻结模块的声明证据闭包，正在本地回归；未安装、未启动新版正式候选。

**整体验收未通过，不能宣布正式可交付。** 原 204 项能力已按用户确认正式登记并核实持久化。用户随后明确确认合并的 52 项补充，已通过正式接口全部登记到 14 个原隔离项目并核实持久化；原 204 项逐条不变。此前的 4 项和 48 项包含在 52 项中，没有重复登记。

2026-10-16T15:16Z 最新进展：v30 的 25/25 项 Gold 四组全部独立 approved、所有进程退出 0，最后批准为 15:14:24.407Z。已核实逐项绑定当前 bundle、晚于安装且早于首候选。正式采集单 owner 已从零启动，优先 Ky URL 恢复、Zod trim、Hono expose、Mitt listenerCount，最多四个逻辑槽，逐样本轮转补足五条有效独立候选。状态及账本为 `output/acceptance/release-binding-manifest-v30-completion-2026-10-16/`；正常收口程序已实际启动，日志为 `release-binding-manifest-v30-final-2026-10-16.log`。全部真实门槛及正式 gate 尚待完成，不能宣称验收通过。

真实 manifest 诊断三次调用均已收口：原证据、修后证据、删除 package.json 内容负例均返回 ready、无诊断；负例未拒绝，故对照程序实际退出 1。全部响应及解析结果保留在 `binding-manifest-prompt-probe-v30-2026-10-16/summary.json`。这不能证明模型稳定拒绝缺证或质量提升，不能替代正式验收；确定性源码完整性与配置预留回归通过的事实单独保留。未重发失败请求或补数改变结果。

2026-10-16T15:13Z：v30 已在隔离 3087 安装并持久化复核通过，bundle SHA256 `1b9adaeb5d2f1e9a8a181485e8b7cc6664c902ef62f38e5a580124bcb2c47d60`、tarball SHA256 `2dd86da50cba568bd2aca85736865586fc2d546c95b79189658a34dcd0b8eea5`。Host PID 10037、fencingToken=32、healthy，原 3080 PID 2095 保持运行。256 项能力及 52 条 pending 历史逐项不变，真实 V2 canary 复核通过，20 组历史、61 项目和 28 条后继终态证明核验通过。证据为 `installed-bundle-binding-manifest-v30-2026-10-16.json`、`canary-export-binding-manifest-v30-2026-10-16.json`、`release-historical-observations-v30-2026-10-16.json`。25 项 Gold 四组独立审阅已实际启动；真实只读对照中的修后输入已返回 ready、无诊断，原输入和删除 manifest 负例仍在运行。尚无本版正式候选，诊断不计发布资格。

2026-10-16T15:11Z：v29 已全部自然收口并归档，4 个独立根均为有效候选，其中 3 条达标（p-map、maxQueued、无执行者正确资格弃权）、1 条 Ky 质量失败，0 模型失败、0 策略替代。正式 gate 实际退出 1，结果为 `output/acceptance/release-combined-binding-owner-v29-2026-10-16-result.md`；领域核验显示 0 审批、派发和 TaskRun。失败没有删去或用重跑结果覆盖。

Ky 的关键实现已识别，但原分配把验证 manifest 排在完整源码闭包之后，package.json 只剩 129B，丢失 scripts、包入口、工具依赖及 AVA 配置；原绑定据此正确阻塞。新压力回归修前失败，v30 沿既有配置优先级先预留 package/tsconfig，保持 64/96 KB 总预算不变。19 项 Binding 回归及最新完整 `PO_TEST_BROWSER_CHANNEL=chrome pnpm verify` 均退出 0，后者包括 522 Node、6 browser、类型、文档、fixture 子集和 151 文件包检查。实际冻结源码复核确认 package.json 完整 2351B、三个 tsconfig 逐字完整、七项关键声明仍完整，证据为 `binding-manifest-audit-{before-v30,after-v30-verified}-2026-10-16.json`；日志为 `verify-binding-manifest-v30-2026-10-16.log`。真实原/新及删除 manifest 负对照已启动，保留全部调用，不计候选。v30 隔离升级已开始，尚无本版正式候选。

2026-10-16T14:48Z 最新进展：v29 的 25/25 项 Gold 四组均独立 approved、所有进程退出 0，最后批准为 14:46:50.770Z；已逐项核实绑定当前 bundle、晚于安装且早于首候选。正式采集单 owner 已从零启动，优先 Ky URL 恢复、maxQueued 恢复、p-map observer 和无执行者对照，最多四个逻辑槽，轮转补足每样本五条有效独立候选。状态及账本为 `output/acceptance/release-binding-owner-v29-completion-2026-10-16/`；正常收口程序已实际启动，日志为 `release-binding-owner-v29-final-2026-10-16.log`。启动不等于通过，未满全部正式门槛前保持本结论。

2026-10-16T14:45Z：v29 已安装并持久化复核通过，bundle SHA256 `1491d93392bea8611e41f3d5b2339a4e33ee93894418bceb2caf532706abe95c`、tarball SHA256 `bef056a76628db1608385cc52c6f415da52a9825da90c2e4755d85f80e11efd0`。隔离 Host PID 76718、fencingToken=31、healthy；原 3080 PID 2095 保持运行。256 条能力和 52 条 pending 历史逐项不变，V2 canary 复核通过，19 组历史、61 项目及 28 条后继终态证明核验通过。证据为 `installed-bundle-binding-owner-v29-2026-10-16.json`、`canary-export-binding-owner-v29-2026-10-16.json`、`release-historical-observations-v29-2026-10-16.json`。25 项 Gold 四组独立审阅已实际启动，全部批准前不运行正式候选。

最新完整 `PO_TEST_BROWSER_CHANNEL=chrome pnpm verify` 实际退出 0：521 Node、6 browser、类型、文档、fixture 子集和 151 文件包检查通过，日志为 `verify-binding-owner-v29-final-2026-10-16.log`。普通证据回归及新增大型类、箭头工厂、默认导出回归均通过。最终 bundle 的七项源码完整声明 AST 对照通过，证据为 `binding-owner-audit-after-v29-final-2026-10-16.json`。真实模型诊断中新证据 ready、diagnostics=[]，删除核心 owner 负例 blocked；旧证据返回含无效 SCN 引用的诊断，被原解析器拒绝，因此对照程序整体退出 1。完整响应、错误及三次调用保留在 `binding-owner-prompt-probe-v29-2026-10-16/summary.json`；不据此宣称整体验收或统计效果通过。最终束只收紧了大型类额度触发条件，Ky 的新旧诊断与最终束证据摘要逐字一致，未重复付费调用。

2026-10-16T14:41Z：v28 已全部自然收口，正式 gate 实际退出 1。4 个独立根中 1 条有效且达标候选、2 条策略替代、1 条模型超时；后继分别为 p-map committed、Ky code_binding blocked，均不计 fresh，0 审批、派发或 TaskRun。结果为 `output/acceptance/release-combined-fault-fixture-v28-2026-10-16-result.md`，后继和领域历史证明为 `release-combined-v28-{policy-successors,historical-domain-facts}-2026-10-16.json`。

超时原始 Harness 649 个事件证明：14:08:08Z 开始，14:15:26Z 上游连续 300000ms 无数据触发一次自动重试，14:18:08Z 产品按原 600000ms 总时限取消。没有证据确定上游停流原因，未放宽超时、未删失败，证据为 `planning-turn-timeout-audit-v28-2026-10-16.json`。Ky 的真实 prompt 回放逐字匹配原输入，确认 65536B 共享证据中核心 owner 只分得 3971B，缺少类、合并实现和 InitOptions。

拟 v29 在 BindingStage 修复默认导出/同名类发现、箭头函数依赖闭包和完整声明的预算预留；普通共享上限仍 65536B，确有大型类声明时仅追加一次 32768B，有界为 98304B，并先省去注释。精确冻结源码回放已完整保留 Ky、validateAndMerge、deepMerge、deepMergeInternal、InitOptions、InternalOptions、NormalizedOptions 七项声明，AST 与原声明逐项比对通过。新增回归修前失败，既有及新增 17 项通过；补充默认导出回归后的完整验证和真实模型正反对照已实际启动。证据为 `binding-owner-audit-{before-v29,after-v29-verified}-2026-10-16.json`，真实诊断日志为 `binding-owner-prompt-probe-v29-2026-10-16.log`。诊断不计候选，v29 尚未安装或取得发布资格。下文保留各历史时点。

2026-10-16T13:57Z 最新进展：v28 的 25/25 项 Gold 四组均独立 approved、全部进程退出 0，最后批准为 13:55:20Z；逐项核实绑定当前 bundle、晚于安装且早于本版首候选。正式采集单 owner 已从零启动，优先 maxQueued 恢复、p-map observer、Zod overlap 恢复及 Ky URL 恢复，最多四个逻辑槽，逐样本轮转补足五条。状态及子账本为 `output/acceptance/release-fault-fixture-v28-completion-2026-10-16/`。正常收口程序也已实际启动，日志为 `release-fault-fixture-v28-final-2026-10-16.log`，待完整采集后核实领域事实、canary 并运行正式 release gate；启动不代表通过。

v28 已在隔离 3087 安装并持久化复核通过，bundle SHA256 `29fe1cb14f0893249416f8b5301971afa6b6d1dc2e115caadd1d11fac09c676d`、tarball SHA256 `f8db7732e0c5de515f55c1383303b3327821b65a26b9426008ead5e81ac62b24`，Host PID 12820、writer fencingToken=30、healthy，原 3080 PID 2095 保持运行。256 条能力及 52 条 pending 历史逐条不变，真实 V2 canary 通过；18 组历史、61 项目及 26 条后继终态证明核验通过。证据为 `installed-bundle-fault-fixture-v28-complete-2026-10-16.json`、`canary-export-fault-fixture-v28-complete-2026-10-16.json`、`release-historical-observations-v28-2026-10-16.json`，均在 output/acceptance。

最新全部产品修改的完整 verify 退出 0（519 Node、6 browser、类型、文档、原 fixture 子集及 151 文件包检查），日志为 `verify-fault-fixture-v28-complete-2026-10-16.log`；错误对象及英文复数等真实故障表达的补充回归也已通过，证据为 `dependency-fault-contract-after-v28-complete-2026-10-16.log`。真实新旧生成/相同原独立审阅对照退出 0，均 ready、approved、findings=[]；4 次调用仅诊断，不计候选，不证明通过率提高。修后明确生成 mapper 1 完成后启动 mapper 3、pull 2 再返回 done、mapper 0 仍待定的可达夹具，并计入已完成 mapper 1 的通知和最终结果。证据为 `async-fixture-prompt-probe-v28-final-2026-10-16/summary.json`。原失败不改判。

2026-10-16T13:40Z：v27 已全部自然收口并归档，19 个独立根中 16 条有效候选（14 条达标、2 条质量失败），3 条策略替代、0 根模型失败。正式 gate 实际退出 1，结果为 `output/acceptance/release-combined-type-oracle-presence-v27-2026-10-16-result.md`；领域及后继证明为 `release-combined-v27-{historical-domain-facts,policy-successors}-2026-10-16.json`。三条后继均 committed，不计 fresh；0 审批、派发或 TaskRun。原超时、原 owner/finalizer 退出 1 及只读恢复记录继续保留，requestResent=false。

两项根因：maxQueued 恢复场景原文“调用方依赖错误类型分支”被确定性正则误判为真实依赖故障，强制生成无来源故障场景；p-map 的场景预设 pull 1 未返回且 mapper 0 未完成时 mapper 2 已启动，违背冻结源码的 await/pull 顺序。独立审阅正确拒绝，不修改 Gold 或拒绝标准。v28 在归属层修复分类与场景生成约束：精确原文回归修前失败，修后相关 5 项测试通过，涵盖合同描述、真实故障、显式类别及语句边界。冻结 p-map 的实际实验复现原夹具只能启动 mapper 0，并验证先完成另一低序 mapper、保留 mapper 0 待定的可达时序，结果为 ['A','B']；仅证明既有调度，不宣称未来 onMapped 功能验收。证据为 `dependency-fault-contract-{before,after}-v28-2026-10-16.log`、`async-fixture-reachability-real-v28-2026-10-16.json`。全部最新产品修改的完整 verify 退出 0（519 Node、6 browser、类型、文档、原 fixture 子集及 151 文件包检查），日志 `verify-fault-fixture-v28-final-2026-10-16.log`。真实新旧生成/原独立审阅诊断已实际启动，日志 `async-fixture-prompt-probe-v28-final-2026-10-16.log`；新版尚未安装，不能宣称整体验收通过。

2026-10-16T12:25Z：v27 已有四条正式达标候选（无执行者正确资格弃权、Hono maxAge、Zod trim、未决 clear-reason），0 质量/根模型失败。wrapper 后继已 committed，仍不计 fresh。collector-6 的 POST 响应超时后首个 GET 尚无 operation，采集器过早退出，owner 和正常 finalizer 因未闭合记录停止；未伪造 gate。实际根 `planning-v3:d106b145-c439-4cd1-bb91-4b5aaadc3b59` 随后出现，idempotencyKey 精确匹配原 batch/attempt，仍在途。采集器修复为已发送请求在原 30 分钟上限内持续只读观察，绝不重发 POST；将原错误代码、消息和恢复观测另存。两项新增回归修前失败，修后相关 7 项全通过，证据为 `delayed-acceptance-{before,after}-v27-2026-10-16.log`。本次只改验收脚本，产品 bundle 不变；已对原账本原请求启动 drain 观测恢复，日志 `release-type-oracle-presence-v27-delayed-observation-resume-2026-10-16.log`，尚待终态后恢复 owner。

2026-10-16T11:53Z 最新进展：v27 的 25/25 项 Gold 四组全部独立 approved、全部进程退出 0；最后批准为 11:52:31Z。逐项核实 Gold 对应本版 bundle、晚于隔离安装、早于本版候选。证据：`output/acceptance/release-type-oracle-presence-v27-{blocked,hono-zod,pqueue-pretry,other}-gold-review-2026-10-16/summary.json`。正式采集单 owner 已从零启动，优先 p-limit wrapper、无执行者、trim、maxAge；最多四逻辑槽，逐样本轮转补足五条。状态和子账本位于 `release-type-oracle-presence-v27-completion-2026-10-16/`；正式收口程序已运行，等待完整采集后执行领域核验、canary 和 release gate，日志为 `release-type-oracle-presence-v27-final-2026-10-16.log`。启动不代表通过，尚无本版终态候选。

2026-10-16T12:05Z：本版 p-limit wrapper 原根 `planning-v3:c113fa00-7e7a-4a3c-87b2-09adf8a0b201` 的场景独立审核 approved、findings=[]，正式生成的类型场景明确要求同一 lf 的 number 读取、赋值拒绝，以及拒绝缺失/可写/错误可读类型，已越过 v26 的原阻塞。随后该根在 policy_snapshot 因旧基线变化而 superseded，自动后继 `planning-v3:0efbab92-5849-4383-9af1-8f5d87661d40` 继续运行；两者均不能补作独立有效候选。无执行者、Zod trim 和 Hono maxAge 原根已越过场景审阅并进入代码绑定。当前 0 正式终态候选、0 质量/根模型失败；完整规划及门禁仍待完成。

最新状态（2026-10-16T11:50Z）：v26 已完整归档，正式 gate 实际退出 1；7 个独立根中 5 条有效候选（4 条达标、1 条质量失败），2 条策略替代，0 根模型失败。两个自动后继均终态：无执行者正确资格阻塞，clear-reason committed；全部不计 fresh，无审批/派发/TaskRun。正式结果为 `output/acceptance/release-combined-compiler-tsd-v26-2026-10-16-result.md`，历史领域及后继证明为 `release-combined-v26-{historical-domain-facts,policy-successors}-2026-10-16.json`。

v27 已安装并持久化复核通过：bundle SHA256 `7ca0dbc49a0dd9860103bcc0c1a89adae20cfe163b9e36d506faa693c4dcf5db`，tarball SHA256 `772ed8b90933681b4b109f8835498820683ca31085cc3209f938934dbd554300`；隔离 Host PID 28035、writer fencingToken=29、healthy，原 3080 PID 2095 保持运行。256 条能力和 52 条 pending 历史逐项不变，真实 V2 canary 复核通过。17 组历史证据、61 项目、23 条后继证明核验通过。证据分别为 `installed-bundle-type-oracle-presence-v27-final-2026-10-16.json`、`canary-export-type-oracle-presence-v27-final-2026-10-16.json`、`release-historical-observations-v27-2026-10-16.json`，均在 output/acceptance。25 项新 Gold 的四组独立审阅已实际启动；全部批准前不运行本版正式候选。下文未安装、在途等描述保留各历史时点。

2026-10-16T11:34Z：v26 新增 p-limit wrapper 根 `planning-v3:00daebb1-7969-41df-9b78-7421b5529a0f` 在 scenario_coverage_review 被正确拒绝。只读属性赋值负例未证明属性存在，缺少声明也可能通过；属于场景生成的质量失败，不改 Gold 或审阅。采集器已停止新增，等待既有请求自然终态；Hono maxAge、pqueue outstandingCount、Zod trim 三条完整候选已达标，未决 clear-reason 候选也已达标。无执行者原请求因策略替代不计 fresh，后继在 assignment_qualification 正确阻塞。拟 v27 补齐类型 oracle 对不存在、可写和错误可读类型的区分；精确 tsd 的五组受控实验通过，真实提示对照及完整本地验证已实际启动。v27 尚未安装，v26 失败归档程序等待在途收口。

2026-10-16T11:41Z：v27 最新全部产品修改的 `PO_TEST_BROWSER_CHANNEL=chrome pnpm verify` 已退出 0：516 Node、6 browser、类型、文档、原 fixture 子集及 151 文件包检查通过，日志为 `verify-type-oracle-presence-v27-final-2026-10-16.log`。新旧生成/同一原独立审阅的真实对照也退出 0，两边均 ready、approved、findings=[]；修后明确包含同一 lf 的数字读取与赋值拒绝，4 次调用仅诊断，不计候选，也不证明通过率提高。证据为 `type-oracle-presence-prompt-probe-v27-2026-10-16/summary.json`。隔离包已生成，尚未安装；v26 最后一条 clear-reason 根被策略替代，后继继续运行，不能提前终止或计 fresh。

v26 最新进展：25/25 项 Gold 已在本版候选前独立 approved。原四组初审为 24 approved、1 insufficient_evidence；pqueue outstandingCount 请求补充 nz 的发现和编译机制。未改 PRD、owner、能力或 Gold 预期，而补充精确 nz@0.1.0 源码和 TS6.0.3 隔离正反实验，并保留首次审阅；补审 approved。程序强制补审 proposedGoldSha256 与初审完全一致。证据：`output/acceptance/nz-gold-evidence-v26-2026-10-16.json`、`release-compiler-tsd-v26-pqueue-tool-evidence-gold-review-2026-10-16/summary.json`，其余同版四组目录保留。只新增评测工具的有界补充材料输入，已装产品 bundle 未变。全部 25 项最终 Gold 均晚于安装复核、早于本版候选。

正式单 owner 已从零启动，优先 outstandingCount、无执行者、trim、maxAge，最多四逻辑槽，逐轮补齐每项五条；状态与账本为 `output/acceptance/release-compiler-tsd-v26-completion-2026-10-16/`。正式收口程序已实际启动，日志为 `release-compiler-tsd-v26-final-2026-10-16.log`，等待完整采集后执行领域、canary 及 release gate。启动不代表通过，尚无本版终态候选。

2026-10-16T11:15Z：上述四条真实根请求均已越过场景独立审核，进入仓库快照与代码绑定。当前 0 终态候选、0 质量失败、0 根模型失败；尚不能计为完整规划通过。先前 pqueue 的场景类型解析阻塞本次未在该阶段重现，最终仍须核实任务规划、独立审阅与资格检查。

2026-10-16T11:00Z 最新状态：v26 已在隔离 3087 安装，bundle SHA256 `2998d6f9300ef04f05bec60364fb473664b5965406b5a123154592fa1c2182f1`、tarball SHA256 `3243c1db3a2d722f0fa5bd3bd92be3a9ea691179f4ea379c8f18f8f95bc0db0a`；Host PID 536、writer fencingToken=28、healthy。256 项 active 能力、52 项 pending 历史及真实 V2 canary 逐项不变；原 3080 PID 2095 仍运行。16 组历史证据、61 项目、21 条后继终态证明核验通过。安装与历史证明分别为 `output/acceptance/installed-bundle-compiler-tsd-v26-final-2026-10-16.json`、`release-historical-observations-v26-2026-10-16.json`；canary 为 `canary-export-compiler-tsd-v26-final-2026-10-16.json`。新 Gold 四组已实际开始候选前独立审阅，全部批准前不启动正式候选；下文“未安装”等保留各历史时点。

2026-10-16T10:59Z：v25 已完整归档，4 条有效独立候选中 Hono maxAge、Zod trim 两条达标，pqueue 和无执行者对照两条质量失败；0 根模型失败、0 策略替代。正式 release gate 实际退出 1，证据为 `output/acceptance/release-combined-branch-baseline-v25-2026-10-16-result.md`。全部根均无审批、派发或 TaskRun，历史领域证明为 `release-combined-v25-historical-domain-facts-2026-10-16.json`。Zod 此次真实生成计划明确指定写入前基线采集及 TASK-IMPLEMENT→TASK-VERIFY 证据交接，两名成员的 preflight 均 accepted、missingFacts=[]；不把该局部改进写成整体验收通过。

v26 最新全部修改的 `PO_TEST_BROWSER_CHANNEL=chrome pnpm verify` 已退出 0：516 项 Node、6 项 browser、类型、文档、fixture 子集及 151 文件包检查通过，日志为 `output/acceptance/verify-compiler-tsd-v26-final-2026-10-16.log`。同原源码/原独立审核的临时类型根真实对照已结束，原/新提示均 ready 并 approved、findings=[]，4 次模型调用只诊断，不计候选，也不证明成功率提高；证据为 `compiler-ambient-prompt-probe-v26-2026-10-16/summary.json`。在全 Host 无在途后，tsd 命令实际仓库前后对照及全快照相等均通过：旧目录 2 条、新目录 3 条，精确新增显式文件选择调用，0 命令执行、0 领域写入，证据为 `tsd-command-real-v26-final-2026-10-16.json`。新版原始 PRD、projectId、配对关系未变，正在准备独立安装与 Gold；尚无 v26 正式候选。

2026-10-16T10:51Z：v25 出现有效但质量失败的 pqueue 根 `planning-v3:2d175ade-8f6b-4a87-88f6-7ff21e692132`，在 scenario_coverage_review 被 `SCENARIO_COMPILER_TYPE_RESOLUTION_UNRESOLVED` 拒绝。其外部临时 project 虽继承原 tsconfig，却未保留已有 test/types.ts 中指向仓库本地的 typeRoots，导致继承 types=['node'] 后存在 TS2688 缺口。单 owner 已停止新增，三条既有在途自然收口；Hono maxAge 和 Zod trim 场景均 approved、findings=[]，已进入 task_plan，尚未终态，不计成功。拟 v26 仅在场景生成规则明确临时项目的本地解析机制并更新指纹，独立审核不变。

2026-10-16T10:54Z：无执行者对照 `planning-v3:6a82d442-b575-413e-9fe4-366ab7b0e3c0` 在 task_plan 因缺少显式 tsd 文件选择命令阻塞，属于第二条质量失败，不能记为正确弃权。v26 补充基于已声明 tsd 与 tracked 安全路径的有界命令发现，2 项相关回归通过，修前失败保留。精确 tsd@0.33.0 源码和隔离真实调用验证：正例退出 0，去除 readonly 的反例和缺失文件均退出 1；证据为 `output/acceptance/tsd-selection-trigger-v26-2026-10-16.json`、`tsd-command-{before,after}-v26-2026-10-16.log`。首次实际目录对照在其他项目仍推进时触发全快照不相等，尚不能据此写只读审计通过，将在全 Host 无在途后另存重验。此前 compiler-ambient 的完整本地结果早于该补充，最新全部修改需重跑完整验证。

精确 TypeScript 6.0.3 隔离实验实际复现上述遗漏返回 TS2688、补齐类型根退出 0，原编译配置正反例继续通过；使用本机 @types/node 22.20.1 的受控夹具，不代表上游功能或其精确依赖已运行。证据：`output/acceptance/compiler-ambient-trigger-v26-2026-10-16.json`。新旧生成/相同原审核的真实诊断及完整本地验证正在执行，v26 未安装。v25 失败归档程序已启动，等待在途终态后保留全部账本并执行真实失败门禁，不补数冲淡失败。

2026-10-16T10:38Z：v25 的 25/25 项 Gold 全部在本版首个候选前独立 approved，四组程序均退出 0。证据：`output/acceptance/release-branch-baseline-v25-{blocked,hono-zod,pqueue-pretry,other}-gold-review-2026-10-16/summary.json`。正式采集单 owner 从零实际启动，优先 trim、maxAge、outstandingCount 及无执行者对照；最多四逻辑槽，策略后继持续占槽至终态，逐样本轮转补足五条。状态/账本为 `output/acceptance/release-branch-baseline-v25-completion-2026-10-16/`，日志为同名前缀 `.log`。正式收口程序已实际启动等待完整采集，再核实领域、canary 和执行 release gate；启动及在途不计通过。

2026-10-16T10:36Z 最新状态：v25 已在隔离 3087 安装，bundle SHA256 `369eacd56cbd166df19ec6efb72123c1863d3a5913e8ec2e4aeea3a777d88c75`、tarball SHA256 `90a24d2165bea65e703b524aab9f50321d072c0e9979b67ff509df84eb582f91`，Host PID 52703、writer fencingToken=27、healthy。256 项 active 能力、52 项 pending 历史及 greeting 真实 V2 canary 逐项复核通过；原 3080 PID 2095 未变。15 组历史证据、61 项目、21 条后继终态证明完成摘要和时间顺序核验。证据：`output/acceptance/installed-bundle-branch-baseline-v25-final-2026-10-16.json`、`canary-export-branch-baseline-v25-final-2026-10-16.json`、`release-historical-observations-v25-2026-10-16.json`。25 个 case 的原始 PRD 字节、projectId、配对及能力授权不变；只变更版本隔离标识。新 Gold 四组独立审阅已实际启动，全部批准前不运行正式候选。首次打包因目标目录不存在而失败，创建专用目录后打包成功，原失败日志保留；没有改动产品代码或绕过验证。

2026-10-16T10:31Z：v24 已正式归档，4 个独立根请求中 3 条有效候选（无执行者对照达标、Hono maxAge 与 Zod trim 两条质量失败），1 条策略替代；最后的 pqueue 后继 committed，不计 fresh。正式 release gate 实际退出 1，全部失败保留。证据：`output/acceptance/release-combined-compiler-config-v24-2026-10-16-result.md`、`release-combined-v24-policy-successors-2026-10-16.json`、`release-combined-v24-historical-domain-facts-2026-10-16.json`。无审批、派发或任务执行。

Zod trim 的新缺口归计划生成：TASK-VERIFY 要求可追溯的六项冻结基线测量，却没有任务在首次实现写入前负责采集。拟 v25 除分支夹具规则外，增加明确的 baseline capture owner、顺序及证据交接，并向 TaskPreflight 注入直接和传递依赖合同；无采集责任的 consumer 单方声明仍应拒绝。修前新增回归 2 项失败；修后最初的 21 项失败定位为 service 测试对 Assignment JSON 的旧分段边界，已调整解析边界，未放松业务断言。相关 231 项现全部通过，日志为 `preflight-dependencies-fixed-v25-2026-10-16.log`。

最新全部改动的 `PO_TEST_BROWSER_CHANNEL=chrome pnpm verify` 已实际退出 0：515 项 Node、6 项浏览器、类型、文档、原 fixture 子集与 151 文件包检查通过，日志为 `output/acceptance/verify-branch-baseline-v25-final-2026-10-16.log`。真实基线合同诊断 6 次：原合同 2/2 拒绝、补齐采集责任合同 2/2 接受、consumer 单方声称生产者反例 2/2 拒绝；见 `output/acceptance/baseline-contract-probe-v25-2026-10-16/summary.json`。这是手工合同诊断，不代表 Planner 已生成正确合同，也不计正式候选。新版尚未安装、尚无正式候选。

Hono 分支规则的真实新旧提示对照已结束，两边均 ready 并获同一原独立审核批准；该小样本不证明通过率提升，4 次调用不计候选。证据：`output/acceptance/branch-fixture-prompt-probe-v25-2026-10-16/summary.json`。先前 branch-only 的完整本地验证通过仅适用于当时版本，不能代替后加基线/依赖改动的验证。

2026-10-16T10:18Z：v24 首批已遇 Hono maxAge 的有效但质量失败候选 `planning-v3:22a17394-c9d9-43aa-915a-873eb1b38b62`。其“unmatched array”夹具仍配置 `['http://example.com']`，请求 Origin 也是 `http://example.com`，却预期不返回允许源响应头；原独立审核正确拒绝。调度器已停止新增，保留在途自然收口，不补数或改判。pqueue 的场景审核通过，但根请求在策略基线阶段被替代，后继仍在途，不计 fresh；Zod trim 及无执行者根尚待终态。

拟 v25 在场景生成层要求每个分支标签对应真实配置、触发值和同值推导的 oracle；共同值与逐分支覆盖值应明确，不能让同一集合和查找值同时表示匹配及不匹配。独立审阅不改。冻结 Hono 源码的 39 次实际内存请求（含原夹具生命周期 8 次、30 组 origin/method/maxAge 及 1 次错误夹具）确认原 oracle 失败、明确不同白名单值的正反组合通过；原源码摘要未变。证据：`output/acceptance/branch-fixtures-real-v25-2026-10-16.json`。完整本地验证及相同冻结输入、相同原独立审阅的真实提示对照正在运行；v25 尚未安装，不将诊断充作正式候选。

2026-10-16T10:05Z：v24 的 25/25 项 Gold 均已在本版首个候选前独立 approved。证据为 `output/acceptance/release-compiler-config-v24-{blocked,hono-zod,pqueue-pretry,other}-gold-review-2026-10-16/summary.json`。正式采集已实际启动，首批四个独立根为 pqueue outstandingCount、Hono maxAge、Zod trim 及无执行者对照，均尚在途，不计成功。单 owner 从零统一调度，最多四槽（含策略替代登记及后继终态），按样本逐轮补五条；5 项模拟回归覆盖零起点、部分完成恢复、明确优先顺序、唯一编号及后继占槽，全部通过，日志为 `release-collection-scheduling-tests-v24-priority-2026-10-16.log`。实际状态与全部子账本位于 `release-compiler-config-v24-completion-2026-10-16/`，采集日志为 `release-compiler-config-v24-completion-2026-10-16.log`，均在 output/acceptance。正式收口程序也已实际运行，等待全部样本收齐后合并账本、核实领域事实及 canary、执行 release gate 并生成独立 Markdown；启动不代表门禁通过。

当前运行版本已切换为 v24。v23 已正式归档：23 次独立根请求，17 条有效候选（16 条达标、1 条质量失败）、6 条策略替代，正式 release gate 退出 1。六条自动后继均已自然终态，其中五条 committed、一条因上游断流 failed；全部不计 fresh。无审批或执行写入。正式归档结果为 `output/acceptance/release-combined-fixture-lifecycle-v23-2026-10-16-result.md`，合并账本、领域核验、门禁及全部失败同前缀保留；后继证明为 `release-combined-v23-policy-successors-2026-10-16.json`，用于新版本冻结的历史领域复核为 `release-combined-v23-historical-domain-facts-2026-10-16.json`。

v24 隔离安装复核于 2026-10-16T10:01:48Z 通过：bundle SHA256 `9ca1999e6426b4684b60d9623a0bf87b78776746b905b7b36c7980f8f1b79a80`，tarball SHA256 `0a4335ec91486cc3abfd3464ead3b8cbd03ad6c7aa50ea8b98a0d29c1690b1e6`，Host PID 73407、writer fencingToken=26、healthy。256 项 active 能力、52 项 pending 历史及真实 V2 canary 逐项一致，原 3080 PID 2095 未变。14 组历史证据、61 项目、20 条后继终态证明全部通过摘要及先后顺序核验。证据：`installed-bundle-compiler-config-v24-final-2026-10-16.json`、`canary-export-compiler-config-v24-final-2026-10-16.json`、`release-historical-observations-v24-2026-10-16.json`，均在 output/acceptance。25 项新 Gold 的四组独立审阅已启动；全部批准前不启动正式候选。下文 v23 在途描述是历史时点，终态以上述正式归档为准。

v23 于 2026-10-16T09:49Z 核实：累计 23 个独立根请求，16 条有效导出候选（15 条达标、1 条质量失败）、6 条策略替代，另有 1 条根请求及 1 条自动后继在途；未发送的本地预检失败另计。调度器已停止新增并等待在途自然终态，不能把有效导出等同于质量达标。正式门槛仍为同一 bundle 的 25 样本各至少 5 条有效独立候选，当前未通过。

质量失败 `planning-v3:d2e33b73-6daa-4b7c-b436-1873e84cf934`：p-queue outstandingCount 场景在仓库根目录用显式文件参数执行 TypeScript 6 编译，触发 TS5112，且未保留原 AC-007 要求的仓库类型配置。完整 tsconfig 和现有只读编译 harness 已在原输入中，不是源码证据缺失。v24 拟修复场景生成的配置约束，独立审阅不变，原失败不改判。精确 TypeScript 6.0.3 的隔离实验复现原命令失败；加 ignoreConfig 又使依赖原配置的负例失效；继承配置并显式纳入文件的 project 模式通过，移除负例指令后正确报错。精确 nz@0.1.0 源码也确认 test-d 发现和继承原配置的机制。证据：`output/acceptance/compiler-config-trigger-v24-2026-10-16.json`；0 上游写入、0 模型调用，不计候选。原/新提示配合同一独立审阅的真实诊断与完整本地验证正在执行，尚未安装 v24。

v24 本地完整验证已退出 0：`output/acceptance/verify-compiler-config-v24-2026-10-16.log`，512 项 Node、6 项 browser、类型、文档、原 fixture 子集及 151 文件包检查通过。随后文档检查再次通过；单 owner 采集器支持明确的新批次标签，4 项模拟回归再次通过，避免新 bundle 账本误用 v23 名称。真实提示对照尚待终态，不将本地测试或诊断充作正式候选。

2026-10-16T09:57Z 真实对照已完成：原/新提示均生成 ready，原独立审阅均 approved、findings=[]。新提示明确通过允许测试文件内的 project-mode harness 纳入 test-d，并沿用配置；该小样本不证明通过率提升。四次模型调用仅诊断，不计 fresh、不改原拒绝。证据：`output/acceptance/compiler-config-prompt-probe-v24-2026-10-16/summary.json`。v23 根请求全部终态：17 条有效导出（16 条达标、1 条质量失败）、6 条策略替代，尚有最后一条自动后继等待资格校验收口。正式归档将保留全部种子和补充账本，以及未发送预检证明，不把后继当独立候选。

两个 p-limit 策略后继随后均 committed，终态证明为 `output/acceptance/release-ready-v23-remaining-wave1-policy-successors-2026-10-16.json`，不计 fresh。无执行者的策略后继 `planning-v3:5130d8e9-0cae-44fb-8a54-15c4e47e3073` 已 failed；Harness 原会话确认是 `Upstream response stream was interrupted` / `PI_AI_ERROR`，未伪装为资格拒绝或候选成功。只读诊断：`output/acceptance/release-v23-policy-successor-stream-diagnostic-2026-10-16.json`，原失败与后继终态证据保留。

原来多个采集器依据瞬时 running 数准入，在策略替代与后继登记之间的空档交错，短时出现 5 条在途；两条补充采集器均已 drain，既有请求已自然终态，并发已回落至 4。观察脚本已改为等待后继登记，不把暂时不存在后继判为失败。统一调度入口 `scripts/complete-release-planning.mjs` 已实际接管，以单一 owner 的 4 个槽位补齐每项 5 条有效独立根请求；策略替代持续占槽直至后继终态，失败原样保留，不改 Gold。两项模拟调度回归通过，覆盖后继登记空档、后继运行期间不释放槽位、最多 4 槽、唯一补充编号及保留失败；这些测试不计真实候选。调度状态：`output/acceptance/release-fixture-lifecycle-v23-completion-2026-10-16/state.json`。收口程序 `scripts/finalize-release-acceptance.mjs` 也已实际启动：等待采集完成，合并全部账本、核实领域事实、复核真实 canary，再运行正式 release gate；尚无该门禁通过结果。上述只改验收脚本与文档，已安装产品 bundle 摘要不变。

17:03 后续进展：p-limit clear reason 未决样本的 fresh-6 已正确 blocked，各适用指标达标，累计 5 条有效候选。接着同一项目的下一次只读预检在领域恢复完成前返回 `409 project-active`，采集器停止，无新 operation、无模型请求。该空账本、原日志与只读核验完整保留：`output/acceptance/release-fixture-lifecycle-v23-completion-2026-10-16/release-fixture-lifecycle-v23-completion-5-2026-10-16-preflight-failure.json`。已把项目恢复等待前移到 preview 之前，并复用同一检查保护派发；3 项调度回归通过，日志为 `output/acceptance/release-collection-scheduling-tests-v23-restoration-2026-10-16.log`。恢复只接受与原账本摘要和项目 operation 历史一致的明确未发送证明，不重放发送结果未知的请求；保留该预留编号，下一次使用新编号。调度顺序调整为先覆盖各样本，再逐轮补足五次，门槛和 Gold 不变。其余在途规划自然运行，收口后再恢复统一采集。

上述在途随后全部达标收口，原调度器因预检错误退出 1，原收口程序也停止，未生成虚假的 gate 结果。恢复调度已核实旧 owner 锁释放，并将第 5 项精确登记为 local_preflight_failure；原 fresh-7 预留编号保留不重放，fresh-8 已实际通过修后 preview 并创建独立根。新调度和收口程序均已重新运行，日志为 `output/acceptance/release-fixture-lifecycle-v23-{completion,final}-resume1-2026-10-16.log`。第 4 项回归同时证明缺少未发送证明、摘要不匹配时都拒绝恢复；4 项测试通过，证据为 `release-collection-scheduling-tests-v23-recovery-2026-10-16.log`。最终收口程序将按正式 gate 的实际 JSON 和退出码输出独立 Markdown 结果，不把采集完成或程序启动当成验收通过。

补充源码核验确认 preview 通过 assertNotActive 检查内存 operation registry，Project 行恢复不一定代表该 registry 已释放。采集器因此在同一 60 秒截止内，仅对只读 preview 的精确 HTTP 409 / project-active 等待并重读，其他错误及发送结果未知的 POST 不自动重发。4 项回归通过，覆盖行恢复和 registry 清理两个先后边界，且最终恰好一次根请求。证据：`output/acceptance/release-collection-scheduling-tests-v23-registry-2026-10-16.log`。产品 bundle 仍不变。

最新状态（v23 真实验收中）：整体验收仍未通过。v22 已正式收口：4 次真实尝试，3 条有效候选（1 条无执行者对照达标、2 条质量失败）、1 条策略替代；正式 gate 退出 1。Hono maxAge 的回调夹具共用数组发送两次请求，却断言最终只有一次回调；Zod overlap 的计划明确拒绝缺少 dict-mode 检查的命令证据。trim 后继在同一命令缺口正确阻塞，不计 fresh。无执行者对照已在 assignment_qualification 正确拒绝两个 Task，各适用指标达标。未审批或派发。

v23 修复归属：场景生成明确共享/独立夹具、重置点、断言时点及累计次数；命令发现从策略点名的真实脚本头读取明确的 Nub 运行标志，支持受限的 `--allow-natives-syntax`，不将任意源码文本或未声明命令当作调用。独立审阅和 MUST 策略不改。真实 Hono 源码的 8 次内存请求复现了共享夹具计数为 2、独立夹具各为 1，异常身份及响应不变；原源码与领域事实未改。证据：`output/acceptance/callback-fixture-lifecycle-real-v23-2026-10-16.json`。命令回归修前失败、修后通过，实际 Zod 只读对照从 91 条增加到 92 条，新增精确命令为 `nub --allow-natives-syntax --conditions=@zod/source packages/bench/memory/dict-mode.ts`，0 命令执行、0 领域变更。证据：`policy-script-command-{before,after}-v23-2026-10-16.log`、`policy-script-command-real-v23-2026-10-16.json`。真实生成/原独立审阅对照及完整本地验证正在执行，尚不宣称真实生成效果或正式资格通过。

v23 完整本地验证随后已退出 0：`output/acceptance/verify-fixture-lifecycle-v23-final-2026-10-16.log`，508 项 Node、6 项 browser、类型、文档、fixture 子集和 151 文件包检查全部通过。真实对照也已退出 0：新提示生成 ready，原独立审阅 approved、findings=[]；原提示本次重生成同样获批，因此不能据此宣称通过率提高。原失败不改判，两次生成与两次审阅均不计正式候选。证据：`output/acceptance/fixture-lifecycle-model-probe-v23-2026-10-16/summary.json`。

v23 已安装并复核：bundle SHA256 `d8f412dd9ef4ca24937ee426858f257bc150d351baa903d193cb2dbb4bc8aa66`，tarball SHA256 `b8489e9bc1dd34b7f916d2e0df19901a981c3f77b743971d016b3c48e82e3a95`。隔离 Host PID 36003、writer fencingToken=25、healthy；原 3080 未改。256 项能力及真实 V2 canary 复核通过，13 组历史证据、61 项目、14 条后继终态证明通过摘要核验。证据：`output/acceptance/installed-bundle-fixture-lifecycle-v23-final-2026-10-16.json`、`canary-export-fixture-lifecycle-v23-final-2026-10-16.json`、`release-historical-observations-v23-2026-10-16.json`。新版 25 项 Gold 正在候选生成前独立审阅，尚无本版正式候选。

v23 四组 Gold 随后全部完成，25/25 approved、全部退出 0，均早于本版正式候选。证据：`output/acceptance/release-fixture-lifecycle-v23-{blocked,hono-zod,pqueue-pretry,other}-gold-review-2026-10-16/summary.json`。真实采集已启动：ready 16 项各 fresh-1，并发 3，优先 trim、overlap、maxAge；blocked 9 项各计划 fresh-1..5，并发 1，无执行者优先。账本：`output/acceptance/release-{ready,blocked}-fixture-lifecycle-v23-round1-2026-10-16.json`。尚未达正式门槛，结果须以终态和同版正式门禁为准。

v23 首轮局部结果：Hono maxAge 的独立候选 `planning-v3:e5e5af30-e9f2-4404-8a4e-d4b7e6f45bd3` committed，各适用指标达标；无执行者 fresh-1 `planning-v3:57f12ae0-56aa-4d1d-b727-03918058149a` 在资格阶段正确拒绝两 Task，各适用指标达标。两个 Zod 原请求因新增命令导致 repositoryDigest 变化而 superseded；后继 `planning-v3:1865477a-0cfc-47c0-8a01-3331760a7ab4`、`planning-v3:1ba66c79-4a6e-4be2-95de-1699f3785f4a` 均 committed，未审批或派发，证明越过原命令缺口，但不计 fresh。终态证明：`output/acceptance/release-ready-v23-round1-policy-successors-2026-10-16.json`。剩余 13 项 ready 的首轮采集已启动，受总并发约束分批运行；另为两项 Zod 准备 fresh-2..6 的独立完整规划，等待空闲槽位后执行，不继承后继结果。

无执行者 fresh-2 的原隔离副本也触发旧策略基线重建，保留原请求并观察后继，不改判通过。额外独立编号复用原隔离项目，从原始需求重新启动全阶段的无 predecessor 根请求；新增请求前逐字段核对 preview.releaseInput 与既有独立 Gold 完全一致，并串行执行，禁止复用同一 operation 补数。采集器保留每个历史失败和唯一 fresh 编号，没有改 Gold、质量阈值或最低有效次数，也没有创建新项目或能力事实。首条额外请求已通过预检并真实启动，尚待终态验证。账本：`output/acceptance/release-blocked-fixture-lifecycle-v23-noexecutor-supplement-2026-10-16.json`。上述局部结果仍不满足 25 样本各五条有效候选，正式资格未通过。

v22 正式归档：`output/acceptance/release-combined-collection-type-projection-v22-2026-10-16.json`、`release-combined-v22-domain-facts-2026-10-16.json`、`release-{ready,blocked}-v22-history-domain-facts-2026-10-16.json`、`release-ready-v22-policy-successors-2026-10-16.json`、`release-gate-combined-type-projection-v22-2026-10-16.json`。trim 原请求的基线差异只有 repositoryDigest；identity、extractor 和 MUST seed 集合一致。下文 v22 启动描述为历史时点，终态以上述归档为准。

v22 完整本地验证 `PO_TEST_BROWSER_CHANNEL=chrome pnpm run verify` 已退出 0：508 项 Node、6 项 browser、类型、文档、fixture 子集及 151 文件包检查通过。日志为 `output/acceptance/verify-type-projection-v22-final-2026-10-16.log`。真实源码回归 `focused-evidence-real-v22-2026-10-16.json`、`helper-entry-evidence-real-v22-2026-10-16.json` 均通过，保留 Hono 完整链及 p-queue 完整执行 owner。上述验证不代表正式发布资格通过。

v21 已正式收口：4 次真实尝试，1 条有效但质量失败的候选、3 条策略替代的 infrastructure_failure，正式 gate 退出 1。trim 的 direct core 输出类型断言缺少内部投影证据；其余请求的冻结仓库摘要或 extractor 版本变化，自动后继不计 fresh。Hono 后继 committed；overlap 后继在 task_plan 遗漏两条 MUST 映射而 failed；无执行者后继被宽泛文本判定错误拦在场景审阅。没有审批或派发。

v22 在冻结源码及 64 KB 总预算内补齐完整 codec/boolean 类型投影，并保留原运行时声明链；只读 AST 比对全部通过。TypeScript 5.9.3 对实际 direct core 编译为 output=boolean、input=unknown，零诊断、零运行时调用。原场景配合修后证据，经原独立审阅规则真实复核 approved、findings=[]；该诊断不计正式候选。修复另将未知/未来与阶段限定为同一短语，避免“未来验证步骤＋编译阶段＋只读值”误触发阶段标识兼容需求；修前失败、修后正反例通过。Planner 增加逐项核对已适用 MUST 的要求，不删除或重新判定策略。完整本地验证及安装后持久化复核均已通过，详见前后记录；256 条能力及 greeting canary 无须重签。证据：`type-projection-real-v22-final-2026-10-16.json`、`zod-direct-core-output-oracle-readonly-v22-2026-10-16.json`、`type-projection-review-model-v22-2026-10-16/summary.json`、`stage-phrase-before-v22-2026-10-16.log`、`stage-phrase-after-v22-b-2026-10-16.log`，均在 `output/acceptance/`。

v22 安装及持久化复核已退出 0：bundle SHA256 `24061706858c8d516120398df9a57219c579305b9ffbd8111113fdbef7b5bb0b`，tarball SHA256 `fcb148d1a2ad7875fcdf3e882c4d8c610c8814fb3fe5174ca07f8e64d10f007d`。Host PID 7792、writer fencingToken=24、healthy；原 3080 未改。256 条声明逐项一致，真实 canary 复核通过；11 组历史证据、61 个项目、13 条后继终态证明通过摘要核验。证据：`output/acceptance/installed-bundle-type-projection-v22-final-2026-10-16.json`、`canary-export-type-projection-v22-final-2026-10-16.json`、`release-historical-observations-v22-2026-10-16.json`。25 项候选前独立 Gold 审阅已启动，全部批准之前不启动正式候选。

v22 四组 Gold 独立审阅 25/25 approved，均退出 0；证据为 `output/acceptance/release-type-projection-v22-{blocked,hono-zod,pqueue-pretry,other}-gold-review-2026-10-16/summary.json`。随后正式采集已启动：ready 16 项计划各 fresh-1，并发 3，优先 trim、overlap、maxAge；blocked 9 项各计划 fresh-1..5，并发 1，无执行者优先。账本为 `output/acceptance/release-{ready,blocked}-type-projection-v22-round1-2026-10-16.json`，结果以真实终态及正式门禁为准，不将诊断或自动后继计入 fresh。

v21 正式归档：`output/acceptance/release-combined-collection-command-evidence-v21-2026-10-16.json`、`release-combined-v21-domain-facts-2026-10-16.json`、`release-ready-v21-history-domain-facts-2026-10-16.json`、`release-{ready,blocked}-v21-policy-successors-2026-10-16.json`、`release-gate-combined-command-evidence-v21-2026-10-16.json`。以下 v21 启动描述为历史时点，终态以上述正式归档为准。

v21 安装复核 `2026-10-16T06:54:08.550Z`：bundle SHA256 `d05a6d9b054fa7b63d6b8f36743664d7c8e24af2f7ce0ea92ff9f9b94f436b2b`，tarball SHA256 `5ab681f2472bd744e3235a136b60a16fd9de64fceb42c0b27d879875105b4f60`。Host PID 28577，writer fencingToken=23、healthy；原 3080 未改。204＋52 项 active 声明及 52 项 pending 历史逐项一致，V2 canary 的 2 个真实 TaskRun、最终 commit 和人工交付事实再次通过摘要核验。证据：`output/acceptance/installed-bundle-command-evidence-v21-final-2026-10-16.json`、`canary-export-command-evidence-v21-final-2026-10-16.json`。九组历史证据、61 个项目和 10 条后继终态证明核验通过：`release-historical-observations-v21-2026-10-16.json`。25 样本的原始规范字节、projectId 和配对保持不变，未复制人工声明或改写历史。

v21 四组 Gold 25/25 approved，均退出 0，最后批准 `2026-10-16T06:56:36.670Z`。证据：`output/acceptance/release-command-evidence-v21-{blocked,hono-zod,pqueue-pretry,other}-gold-review-2026-10-16/summary.json`。随后启动真实采集：ready 16 项各 fresh-1，并发 3，优先 trim、overlap、maxAge；blocked 9 项各计划 fresh-1..5，并发 1，无执行者优先。账本 `output/acceptance/release-{ready,blocked}-command-evidence-v21-round1-2026-10-16.json`。尚无正式终态候选，不计诊断、历史成功或自动后继；同 bundle 每样本至少 5 个有效候选和正式门禁退出 0 仍待完成。

v20 正式证据：`output/acceptance/release-combined-collection-type-oracle-v20-2026-10-16.json`、`release-combined-v20-domain-facts-2026-10-16.json`、`release-ready-v20-history-domain-facts-2026-10-16.json`、`release-gate-combined-type-oracle-v20-2026-10-16.json`。v21 用 v20 overlap 的精确冻结分析、源码及引用重建场景输入，新提示生成 ready，原独立审阅 approved、findings=[]，诊断进程退出 0；没有修改源码证据或原 operation。证据：`scenario-type-oracle-scope-model-probe-v21-overlap-2026-10-16/summary.json`。该诊断不算发布候选。

命令发现回归在旧 bundle 明确失败于“pnpm lockfile 不得替代声明的 runner”，修后通过。早先测试 fixture 的提交标题被本机 Git hook 拒绝，原失败保留；纠正为合法的 `test:` fixture 标题后才取得修前行为失败。证据：`command-discovery-before-v21-corrected-2026-10-16.log`、`command-discovery-complete-v21-2026-10-16.log`。实际 Zod 源码只读对照通过：旧 10 条 pnpm 命令，新 91 条来源明确的命令包含 Nub、独立 tsc、runtime benchmark、GC memory 以及 classic/mini 的 gzip 包体积入口；所有 Git/文件摘要一致，0 命令执行、0 模型请求、0 领域变更。包体积管道失败传播有实际 stub 进程回归，不能将打包失败伪装为零字节成功。证据：`repository-command-evidence-real-v21-2026-10-16.json`。以上均在 `output/acceptance/`；“命令候选存在”不等于已经执行成功。

v20 安装复核时间 `2026-10-16T06:22:35.362Z`，本地与安装 bundle SHA256 均为 `a4b50ecc9279f4123a678d000c4ae7cb7f90d181dca4c9c80cae989104617fa4`，tarball SHA256 为 `8ae12d4006053fd6a1cc1e4284d33eff41cebf05b655fb2e064985bc666a3364`。Host PID 83385、writer fencingToken=22、healthy。原 204 项及新增 52 项 active 声明逐项一致，52 项 pending 历史保留；原 3080 未改。证据：`output/acceptance/installed-bundle-type-oracle-v20-final-2026-10-16.json`、`canary-export-type-oracle-v20-final-2026-10-16.json`。八组历史证据摘要核验通过，61 个项目、10 条终态后继证明，无版本推断或领域变更：`release-historical-observations-v20-2026-10-16.json`。

v20 四组 Gold 独立审阅均退出 0，25/25 approved，最后批准为 `2026-10-16T06:25:23.795Z`，早于本版全部候选。证据：`output/acceptance/release-type-oracle-v20-{blocked,hono-zod,pqueue-pretry,other}-gold-review-2026-10-16/summary.json`。真实采集已启动：ready 首轮 16 项各 fresh-1，并发 3，优先两个 Zod 和 Hono maxAge；blocked 9 项各计划 fresh-1..5，并发 1。账本：`output/acceptance/release-{ready,blocked}-type-oracle-v20-round1-2026-10-16.json`。进行中不计通过；每样本至少 5 个有效独立候选、全部适用质量指标和同版正式门禁仍须完成。

v19 安装证据：`output/acceptance/installed-bundle-parameter-forwarding-v19-final-2026-10-16.json`。本地与安装 bundle SHA256 均为 `6fcae66eaca49d88deb33a00f18bdd4e9547df305c5b52133a370f741f68eaec`，tarball SHA256 为 `4d3d5148d06cd2400a5a27702bf6ac86684a541270b2ee400b1db6e3742985c8`。Host PID 62373，writer fencingToken=21、healthy，原 3080 未变更。七组历史证据经摘要复核，61 个项目、10 条终态后继证明，未推断版本或新增领域事实：`output/acceptance/release-historical-observations-v19-2026-10-16.json`。

v19 四组独立审阅均退出 0：`output/acceptance/release-parameter-forwarding-v19-{blocked,hono-zod,pqueue-pretry,other}-gold-review-2026-10-16/summary.json`。最后批准为 `2026-10-16T05:52:25.190Z`。ready 首轮 16 项各 fresh-1，并发 3，首先 Zod trim、Zod overlap resolved、Hono maxAge resolved，再覆盖其余；blocked 9 项各计划 fresh-1..5，并发 1，无执行者优先。账本为 `output/acceptance/release-{ready,blocked}-parameter-forwarding-v19-round1-2026-10-16.json`。所有失败和自动后继保留，不以历史成功或诊断补本版数量。

v19 真实拒绝：`planning-v3:bb3540ee-dca7-4878-8e70-129fd8c2e4a4`（trim）、`planning-v3:6bd07991-ebb1-45e1-8a4c-e3049db4da62`（overlap）。生成器把 classic 的 string 输入类型推断套用到 mini/core，又将运行时非字符串拒绝误作 decode 的编译期拒绝，导致无依据的精确类型相等断言及可能未消耗的 `@ts-expect-error`。原需求仅要求保留 boolean 输出和已有参数/执行兼容，不授权收窄已有 unknown 输入。独立审阅正确拒绝，不能改判为通过。Hono maxAge `planning-v3:b256a1ed-a7f7-47f5-8acc-d35b064f7fde` 已 committed、全部适用指标达标。

v20 仅增加生成规则：各 public variant 单独追踪泛型默认值和输入/输出投影；运行时拒绝不等于静态不接受；类型负例须由现有声明或明确的新目标类型契约支持，仍须真正编译入口和不执行的类型测试。不得省略要求的类型覆盖、扩大可写范围或声称已运行。场景指令版本更新为 `scenario-coverage-review-v3.3.7`，防止按旧指令继承场景；独立审阅文本保持不变。完整本地验证：`output/acceptance/verify-type-oracle-v20-2026-10-16.log`。第一次诊断脚本错误依赖尚未发布的 Acceptance 行，生成了 undefined policy key，四个诊断请求正确拒绝；已改为由冻结分析精确重建 Service ID，保留首次失败且不计候选。修正后的真实对照位于 `output/acceptance/scenario-type-oracle-model-probe-v20-corrected-2026-10-16/`，同一冻结源码及原审阅提示，未修改任何领域事实。

只读编译实验已完成，TypeScript 5.9.3、零诊断：实际导入冻结仓库的 mini/core/classic 模块，断言 mini/core input=unknown、classic input=string、mini output=boolean；mini/core decode 数字在静态类型层可通过，现有 case 枚举的非法值负例则产生被指令正确消耗的类型错误。虚拟编译文件仅在内存提供，未写仓库，未执行任何运行时调用。证据：`output/acceptance/zod-baseline-type-oracle-readonly-v20-2026-10-16.json`。这证明原审阅拒绝有真实类型依据，不代表目标变更已实施或通过。

真实对照的 trim 原提示本次已获得 approved；不能宣称原提示必然失败或据小样本断言改善率。修正后的非流式批次中，trim 新提示及 overlap 原/新提示均发生 fetch failed，保留失败。随后 trim、overlap 新提示各运行一次独立流式诊断，生成 ready，完全相同的原独立审阅均 approved、findings=[]；两个进程退出 0。证据位于 `output/acceptance/scenario-type-oracle-model-probe-v20-stream-trim-2026-10-16/summary.json` 和 `scenario-type-oracle-model-probe-v20-stream-overlap-2026-10-16/summary.json`。以上诊断均不计正式候选、不覆盖原 operation、不改变 release 失败记录。

v18 安装证据：`output/acceptance/installed-bundle-source-category-preflight-v18-final-2026-10-16.json`。本地与安装 bundle SHA256 同为 `083e630309398891258d06b98b5728a43ab9ff1457cca6a58d5fc70e0be0cb56`，最终 tarball SHA256 为 `8341c80da42dab61763f0bee11446f3638625f2e034b31c89b5ffcf2a933294c`。Host PID 22743，writer fencingToken=20、healthy；原 3080 未改。canary 复核见 `output/acceptance/canary-export-source-category-preflight-v18-final-2026-10-16.json`。六组历史证据校验通过，61 个项目、10 条终态后继证明，无版本推断、模型请求或领域变更：`output/acceptance/release-historical-observations-v18-2026-10-16.json`。早先预打包版本未安装。

v18 Gold 四组审阅均退出 0，证据位于 `output/acceptance/release-source-category-preflight-v18-{blocked,hono-zod,pqueue-pretry,other}-gold-review-2026-10-16/summary.json`。最后一次批准时间为 `2026-10-16T05:32:43.031Z`。ready 首轮 16 项各 fresh-1，并发 3，优先 Zod trim、pqueue outstandingCount、pretry hook resolved；blocked 9 项各计划 fresh-1..5，并发 1，无执行者优先。独立账本：`output/acceptance/release-{ready,blocked}-source-category-preflight-v18-round1-2026-10-16.json`。在途不算成功，任一质量或技术失败停止该采集器新增并自然收口。

v18 Zod 根操作 `planning-v3:7577e1fd-fce8-4713-94d9-85831fd54835` 保留原错误阻塞。其 AC-002 正确保留 `source-explicit-business_rejection`，场景审阅 approved、findings=[]，证明原分类阻塞已越过。新的确定性重放确认 `_stringbool` 存在，但 `$ZodStringBoolParams` 缺失，`mini/parse.ts` 截断于导出列表。v19 在原 64 KB 内保留本地参数声明与完整短转发模块；避免 schema 标签被当作同名运行时 owner，且不把通用类型基础设施扩成跨模块执行根。源码摘要、写权限及冻结范围不变。

修前失败回归：`output/acceptance/parameter-forwarding-before-v19-2026-10-16.log`。最终相关测试 38/38：`parameter-forwarding-related-v19-complete-2026-10-16.log`。实际 v18 bundle 与本地修后完整声明对照：`binding-parameter-forwarding-real-v19-complete-2026-10-16.json`；旧缺漏修复与 pqueue 完整 owner 复查：`helper-entry-parameter-forwarding-v19-fifth-2026-10-16.json`；Hono/Zod 选取检查：`focused-evidence-parameter-forwarding-v19-complete-2026-10-16.json`，均在 `output/acceptance/`。原始索引 partial 和 200 词 warning 保留。中间修复导致辅助声明被挤掉的断言失败已保留，没有降低断言。第一次完整验证使用修正前的压力测试 fixture，504 pass、1 fail；最终 fixture 区分 API 中明确要求保留的声明与 util 的无关噪声，全部断言保留，正在重跑完整验证：`verify-parameter-forwarding-v19-complete-2026-10-16.log`。

v19 最终完整验证已退出 0（505 Node、6 browser），不是正式发布资格。v18 正式失败证据：`output/acceptance/release-combined-collection-source-category-preflight-v18-2026-10-16.json`、`release-combined-v18-domain-facts-2026-10-16.json`、`release-ready-v18-history-domain-facts-2026-10-16.json`、`release-gate-combined-source-category-preflight-v18-2026-10-16.json`。全部候选仍属于 v18，不计入拟 v19 的 fresh 数量。25 项原始规范字节、项目身份与配对已机械核验不变，新输入为 `release-parameter-forwarding-v19-projects-2026-10-16.json`。

### v16 真实失败与拟 v17 修复

- pretry 已选择场景的恢复类别修复生效，但独立场景审阅缺少冻结需求正文、AC、源锚点与已选决策，无法核实源文支持。新版本将完整 sourceContext 纳入审阅输入、记录及摘要，审批、派发和复用时一并校验；test-only callback/timer/listener 断言不会自行变成新事件义务，既有 event 通道要求保留。
- pqueue 原始模型响应证明：EventMap、CustomEvent、生产者和监听链均存在，但同步通知没有持久化事件集合。旧 schema 无条件要求集合 owner，模型因此拒绝捏造。新版本显式支持 persisted/transient：缺省仍为历史 persisted，必须有真实集合；transient 必须空集合，并继续要求 payload、生产者、读取、fixture、assertion、correlation、期望和逐 EVT 覆盖。生成、持久化、复用及独立审阅保持一致。诊断仅新增允许引用已冻结的 SCN/EVT 标识，未知标识仍拒绝。
- Zod 策略后继真实阻塞于 normalizeParams、字符串与 codec 执行链、公共包入口的声明证据。新检索按源码 exports 跟踪入口，按完整声明和本文件局部调用链分配原 64 KB 预算，不扩大写权限。真实源码只读审计已逐个比对完整 AST 声明，并确认 pqueue 完整可执行 owner 仍在；这不是新模型成功证据。

保留证据：`output/acceptance/release-gate-combined-recovery-owner-v16-2026-10-16.json`、`release-combined-v16-domain-facts-2026-10-16.json`、`release-ready-round1-policy-successors-v16-2026-10-16.json`。修前回归：`event-durability-before-2026-10-16.log`；相关修后回归：`event-durability-after-2026-10-16.log`。源码审计：`helper-entry-real-repositories-v17-2026-10-16.json`、`focused-evidence-real-repositories-v17-final-2026-10-16.json`。这些文件均位于 `output/acceptance/`。

v17 最终代码的 `PO_TEST_BROWSER_CHANNEL=chrome pnpm verify` 已退出 0：503 项 Node、6 项真实浏览器测试全部通过，类型、文档、原 fixture 子集和 149 文件包检查通过。日志：`output/acceptance/verify-scenario-source-helper-v17-final-2026-10-16.log`。该命令中的 fixture 子集不是正式 release gate；整体验收仍未通过。

v17 隔离包已安装：bundle SHA256 `f7171115672457780da39cd027b62693ccb39267421dda91686ad8b48a3dc47d`，tarball SHA256 `c51c42a98f0354d42a5e57f438908e459d9f54a7e176687dce1f5dea7df21150`。Host PID 11824，writer fencingToken=19，独立写锁健康；256 条可信能力、原 pending 历史和 greeting V2 canary 逐项复核通过，原 3080 未变更。证据：`output/acceptance/installed-bundle-scenario-source-helper-v17-2026-10-16.json`、`canary-export-scenario-source-helper-v17-2026-10-16.json`。历史五组原始证据通过摘要校验，61 个项目的 9 条策略后继均有终态证明，未推断后继版本，未计 fresh：`release-historical-observations-v17-2026-10-16.json`。

v17 全部 25 项 Gold 在本版首条候选前独立批准，四组证据位于 `output/acceptance/release-scenario-source-helper-v17-{blocked,hono-zod,pqueue-pretry,other}-gold-review-2026-10-16/summary.json`。原规范字节、projectId、配对和可信能力均保持不变。真实 ready 首轮 fresh-1 并发 3，依次优先 pretry hook resolved、pqueue outstandingCount、Zod trim；blocked 对照并发 1，计划每项 fresh-1..5，无执行者优先。账本分别为 `release-ready-scenario-source-helper-v17-round1-2026-10-16.json`、`release-blocked-scenario-source-helper-v17-round1-2026-10-16.json`，位于 `output/acceptance/`。任一质量或技术失败保留并停止该采集器新增，在途自然收口；不提前把在途计为成功。

v17 Zod trim 的原始操作 `planning-v3:003c6b49-b4b5-4d52-b64c-eab62f388f85` 在 scenario_coverage_review 被 `SOURCE_REQUIRED_CATEGORY_DISPOSITION_MISMATCH` 拒绝。审阅已能读取原 AC-002 正文，发现 `[business_rejection, required]` 被风险策略误标为 not_applicable；原要求没有改变。根因是推导只认自然语言关键词，未读取精确的原文类别声明。拟 v18 直接从本 Acceptance 所属源锚点读取显式 required 标注并保留类别，记录 `source-explicit-*` 理由；不从同需求下其他 AC、文件名或普通标签借用类别，模型自填 scenario 仍须来源支持。显式 security 类别同步保留安全风险维度。修前回归失败，相关修后通过，证据：`output/acceptance/explicit-source-category-before-2026-10-16.log`、`explicit-source-category-after-2026-10-16.log`。新版尚未安装及真实复验；v17 原失败不改判。

v17 pqueue outstandingCount 已通过 `binding-review-v3.3.22` 独立审阅（approved、independent、findings=[]），实际冻结链将各 CustomEvent 标为 transient、集合为空，并保留真实生产者/监听面；原持久化结构阻塞未重现，整体仍待终态。无执行者 fresh-1 已正确在 assignment_qualification 阻塞，全部适用指标达标，correctAbstentionRate=1；仅此一条不满足每样本至少五次的门槛。领域核验：`output/acceptance/release-blocked-v17-domain-facts-2026-10-16.json`。

拟 v18 相关 259 项测试通过，完整 `PO_TEST_BROWSER_CHANNEL=chrome pnpm verify` 已退出 0（504 Node、6 browser、类型、文档、fixture 子集、包检查）；日志：`output/acceptance/verify-explicit-source-category-v18-2026-10-16.log`。本地代码与仍运行的 v17 隔离包版本不同，不将新版本地检查当作 v17 模型证据。

v17 pqueue 最终在 task_preflight 错误阻塞，实施成员认为必须先证明既有回归的完整断言，验证成员已 accepted。实际配置与滑动窗口测试位于只读 `test/validation.ts`、`test/strict.ts`，而非只能修改的 basic/advanced 文件；计划明确允许在授权回归文件内新增或加强不足断言。接手应核实当前实现 owner、测试/命令入口、精确目标及必要写权限，不能把待实现回归当作已完成的前提，也不能声称未见测试已经存在或运行。新提示明确此边界，保留缺真实 owner、指定既有 fixture 身份、验收语义或必要写权限时的拒绝。独立真实对照记录于 `output/acceptance/preflight-regression-work-model-probe-2026-10-16/`，仅用于诊断，不计 release 候选、不改原失败。

v17 正式收口证据：`release-combined-collection-scenario-source-helper-v17-2026-10-16.json`、`release-combined-v17-domain-facts-2026-10-16.json`、`release-ready-v17-history-domain-facts-2026-10-16.json`、`release-ready-round1-policy-successors-v17-2026-10-16.json`、`release-gate-combined-scenario-source-helper-v17-2026-10-16.json`，均位于 `output/acceptance/`。pretry 后继 `planning-v3:b7dd74ac-a762-429b-bc2d-d8e5954c3791` 已 committed，且无审批或执行，证明完整链路越过旧阻塞；原策略替代保留为 infrastructure_failure。

回归工作边界的真实对照已完成六次：原提示 2/2 accepted，新提示 2/2 accepted，明确排除必要测试写权限的反例 2/2 needs_clarification，并指出具体权限冲突。新提示正例的所有接手布尔检查均为 true，反例没有用更广仓库权限覆盖 Task 限制。原提示同样批准，不能由该小样本宣称误阻塞率已降低；原 operation 不改判，这六次不算正式候选。证据：`output/acceptance/preflight-regression-work-model-probe-2026-10-16/summary.json`。最终代码完整验证退出 0：504 Node、6 browser、类型、文档、fixture 子集和包检查；`output/acceptance/verify-source-category-preflight-v18-final-2026-10-16.log`。早先 v18 预打包版本未安装，保留原包；最终包将另存，避免覆盖证据。

场景风险修后批次 release-local-risk-2026-10-16 已收口：43 次真实尝试，42 次候选符合预期、1 次需求分析失败。其后 release-disposition-2026-10-16 的四项 ready 全部错误阻塞。release-focused-evidence-v11-2026-10-16 也已收口：Hono 两项在 code_binding 缺少声明及请求分派证据，Zod trim 在场景审核错误阻塞；Zod overlap 原请求被策略重规划替代，自动后继又因策略适用条件误分类而阻塞。三条候选及一次 infrastructure_failure 完整保留，正式 release gate 退出 1；不能以自动后继替换 fresh 候选。

已定位并修复依赖图选取满额、源码片段分配、文件名风险提示及命令示例策略分类问题；修前失败回归和实际仓库证据检查已完成。v13 完整验证通过：490 个 Node、6 个浏览器测试，类型、文档、原 fixture 和 148 文件包检查退出 0。v13 已隔离安装并重新核验 canary；9 个 blocked 和 2 个 Hono ready 的独立 Gold 均已批准。两个采集器均已结束：合计 47 次独立尝试，41 条有效候选（40 条未决需求正确阻塞、1 条 expose 成功），6 条 infrastructure_failure 全部保留（4 条策略替代、2 条团队摘要不符）。无执行者对照的 fresh-1、fresh-2 在策略变化后被替代，采集器停止，没有启动其余 3 条。4 条策略后继均已自然终态，其中两条无执行者后继均在 assignment_qualification 正确拒绝两个任务，没有审批或执行；后继不计 fresh。

v13 合并正式门禁已执行，退出 1。41 条有效候选的适用质量指标均达标，但 correctAbstentionRate 无适用候选，样本覆盖仅 11/25，expose 仅 1/5、maxAge 和无执行者均 0/5，7 对恢复样本缺失。不能把质量子集通过写成发布资格通过。最新证据为 output/acceptance/release-gate-combined-transitive-policy-v13-2026-10-16.json。

本地 v14 完整验证已通过：496 个 Node、6 个浏览器测试，类型、文档、原 fixture 和 149 文件包检查全部退出 0。修复覆盖能力准备的请求范围、明确点名测试文件在 64 KB 共享预算内的完整提供、Binding 审阅对同一引用全部片段的判读，以及严格限定的同一未批准需求只读预览。v14 已在隔离 3087 安装，原 204 项和新增 52 项可信能力逐条一致，greeting canary 复核通过；独立工作区写锁健康。全部 25 个新 case 的原始需求字节和 projectId 不变，25/25 独立 Gold 审阅已批准，均先于本版候选。真实采集已经启动：ready 首轮 16 次和 blocked 对照 45 次各并发 2；完成数量和最终资格以后续真实收口结果为准。

v14 ready 采集器现已收口（退出 1）：expose fresh-1 committed，所有适用指标达标；maxAge fresh-1 在 binding_review 被 BINDING_EXPORT_OWNER_UNSUPPORTED 拒绝，是有效但质量失败的候选。其实际审阅 prompt 已包含完整 ./cors types/import/require 映射，精确 v14 loader 重放与实际 prompt 逐字一致；只读审计保留原拒绝，没有自动改判。证据：output/acceptance/hono-maxage-review-source-audit-v14-2026-10-16.json。v14 的同引用多片段提示没有消除真实误读，因此不能宣称该问题已经解决。ready 没有再启动其余 14 项；blocked 已用原账本收口 14 条正确阻塞，没有新增请求。合并正式门禁退出 1，质量指标及样本覆盖仍未满足。

v12 Gold 审阅实际为：9 个 blocked 和 2 个 Hono ready 通过；Zod trim 因可信能力不足退回；Zod overlap 在调用模型前因历史策略后继缺少版本证明而停止。v12 未运行真实候选，不把先前版本的 13/13 审阅结果归给 v12/v13。Zod 专项源码审阅进一步确认两项目各需两名成员的 data.change，共 4 项；已与原 48 项并入[52 项补充清单](release-capability-addendum-52-2026-10-16.zh-CN.md)。本轮用户已明确确认全部 52 项，现为 active / human_confirmed，不再作为授权缺口。

| 验收项 | 实际结果 | 证据 |
| --- | --- | --- |
| 原 204 项人工能力确认 | 16 个原项目、两名原成员，全部正式登记及复核 | output/acceptance/release-capabilities-confirmed-2026-10-16.json |
| 修后完整本地验证 | PO_TEST_BROWSER_CHANNEL=chrome pnpm verify 退出 0：480 Node、6 browser、类型、文档、原 fixture 和包检查通过 | output/acceptance/verify-acceptance-local-risk-2026-10-16.log |
| 来源纠错修后完整验证 | PO_TEST_BROWSER_CHANNEL=chrome pnpm verify 退出 0：482 Node、6 browser、类型、文档、原 fixture 和 148 文件包检查通过 | output/acceptance/verify-disposition-repair-2026-10-16.log |
| 有焦点证据与检索契约完整验证 | PO_TEST_BROWSER_CHANNEL=chrome pnpm verify 退出 0：486 Node、6 browser、类型、文档、原 fixture 和 148 文件包检查通过 | output/acceptance/verify-focused-evidence-v11-2026-10-16.log |
| v12 完整本地验证 | PO_TEST_BROWSER_CHANNEL=chrome pnpm verify 退出 0：490 Node、6 browser、类型、文档、原 fixture 和 148 文件包检查通过 | output/acceptance/verify-transitive-policy-v12-final-2026-10-16.log |
| v12 隔离安装与复核 | 本地/安装摘要一致，原 204 项确认逐条不变，48 项仍 pending，canary 的 2 个真实 TaskRun、最终 commit 和人工交付事实复核通过 | output/acceptance/installed-bundle-transitive-policy-v12-2026-10-16.json |
| v13 完整本地验证 | pnpm verify 退出 0：490 Node、6 browser，类型、文档、原 fixture 和 148 文件包检查通过 | output/acceptance/verify-transitive-policy-v13-2026-10-16.log |
| v13 完整证据链 | Hono Context、HonoBase 到 compose.catch；Zod factory、wrapper、测试与配置在原预算内取得，保留索引 partial 警告 | output/acceptance/transitive-evidence-v13-full-chain-2026-10-16.json |
| v13 独立 Gold | 9 blocked + 2 Hono ready 审阅通过，先于本版本候选；Zod 两项尚未冻结 | output/acceptance/release-transitive-policy-v13-blocked-gold-review-2026-10-16/summary.json、release-transitive-policy-v13-ready-hono-gold-review-2026-10-16/summary.json |
| v13 Hono 首轮策略后继 | 两个根请求 superseded；后继 maxAge committed、expose blocked，均无审批或执行，均不计 fresh | output/acceptance/release-policy-successors-v13-2026-10-16.json |
| v13 Hono expose 拒绝理由复核 | 实际审阅会话包含被声称缺失的 ./cors 导出及三个目标；原拒绝保留，没有改判通过 | output/acceptance/hono-expose-review-source-audit-v13-2026-10-16.json |
| v13 Hono 新独立请求 | 3 次全部终态：expose fresh-2 有效且各适用指标达标；maxAge fresh-2 和 expose fresh-3 因团队摘要不符拒绝资格；均无审批或执行 | output/acceptance/release-ready-v13-all3-domain-facts-2026-10-16.json |
| v13 合并采集账本 | 47 次独立尝试、41 条有效候选、6 条技术失败，原两个账本及所有失败保留；未以自动后继补数 | output/acceptance/release-combined-collection-transitive-policy-v13-2026-10-16.json |
| v13 完整领域核验 | 47 次均无审批、TaskRun、派发或交付；4 条策略后继全部终态 | output/acceptance/release-combined-v13-all47-domain-facts-2026-10-16.json、release-all-policy-successors-v13-2026-10-16.json |
| v13 团队摘要漂移 | 旧自动后继在 Gold 冻结后额外生成两条 data.change pending；原 204 项人工确认没有改变；不将无资格导出计入候选 | output/acceptance/hono-maxage-team-drift-v13-2026-10-16.json |
| v13 expose fresh-3 源码审计 | 使用精确 v13 安装包重放，实际 prompt 与重放一致，./cors 导出确实存在；拒绝结果仍保留 | output/acceptance/hono-expose-fresh3-review-source-audit-v13-2026-10-16.json |
| v14 最终完整本地验证 | PO_TEST_BROWSER_CHANNEL=chrome pnpm verify 退出 0：496 Node、6 browser，类型、文档、原 fixture 和 149 文件包检查通过 | output/acceptance/verify-catalog-evidence-preview-v14-final-2026-10-16.log |
| v14 隔离安装 | 本地和安装摘要一致；独立写锁健康，原 204 项与补充 52 项可信事实逐条不变，真实 canary 再复核通过 | output/acceptance/installed-bundle-catalog-evidence-preview-v14-2026-10-16.json |
| v14 全部独立 Gold | 25/25 批准：9 blocked、2 Hono、2 Zod、12 其他 ready；全部先于本版候选，原需求和项目身份未变 | output/acceptance/release-catalog-evidence-preview-v14-{blocked,hono,zod,other}-gold-review-2026-10-16/summary.json |
| v14 ready 真实采集 | 2 条有效候选：expose 达标，maxAge 在 Binding 审阅质量失败；采集器退出 1，其余 ready 未启动 | output/acceptance/release-ready-collection-catalog-evidence-preview-v14-2026-10-16.json |
| v14 maxAge 只读源码审计 | 实际 prompt 与精确 bundle 重放一致，./cors 三个目标完整存在；原拒绝保留，不算验收通过 | output/acceptance/hono-maxage-review-source-audit-v14-2026-10-16.json |
| v14 blocked 收口 | 同账本恢复观察，14 条正确阻塞，未新增请求；两条在途均自然结束 | output/acceptance/release-blocked-collection-catalog-evidence-preview-v14-2026-10-16.json |
| v14 合并门禁及领域核验 | 16 条有效候选、5 个实际运行样本；16 次无审批／执行，正式门禁退出 1，保留 maxAge 质量失败 | output/acceptance/release-combined-v14-all16-domain-facts-2026-10-16.json、release-gate-combined-catalog-evidence-preview-v14-2026-10-16.json |
| v15 完整本地验证 | pnpm verify 退出 0：497 Node、6 browser，类型、文档、原 fixture 和 149 文件包检查通过 | output/acceptance/verify-json-member-evidence-v15-2026-10-16.log |
| v15 真实证据呈现诊断 | 原呈现 2/2 批准，新呈现 2/2 批准，虚假导出 2/2 拒绝；小样本不能证明误读率改善，不计候选 | output/acceptance/json-member-evidence-model-probe-2026-10-16/summary.json |
| v15 隔离安装 | bundle 摘要一致，256 条可信能力、原 pending 历史和 canary 再核实通过，独立 writer 健康 | output/acceptance/installed-bundle-json-member-evidence-v15-2026-10-16.json |
| v15 全部独立 Gold | 25/25 批准；Zod overlap 补充摘要域机械核验后单独重审批准，首次不足证据结果保留；所有审阅先于本版候选 | output/acceptance/release-json-member-evidence-v15-{blocked,hono,zod,other,zod-fingerprint}-gold-review-2026-10-16/summary.json |
| v15 首轮完整规划 | 16 ready、9 blocked 各 fresh-1，ready 并发 3、blocked 并发 1，无执行者对照优先；采集中，不提前计成功 | output/acceptance/release-{ready,blocked}-collection-json-member-evidence-v15-round1-2026-10-16.json |
| v15 ready 首批收口 | 3 次：clear-reason-resolved committed 且全部适用指标达标；wrapper-counts、abort-cause 因策略基线变化 superseded，原请求保留为 infrastructure_failure；后继仍在途，不计 fresh | output/acceptance/release-ready-collection-json-member-evidence-v15-round1-2026-10-16.json |
| v15 Hono/Zod 聚焦首轮 | 在首批停止后，以独立账本启动此前未运行的 4 个 Hono/Zod fresh-1；并发 1，包含已有后继在内保持总在途不超过 4 | output/acceptance/release-ready-collection-json-member-evidence-v15-focused-2026-10-16.json |
| v15 首批策略后继收口 | wrapper-counts、abort-cause 两个自动后继均 committed，无审批、派发、TaskRun 或交付；根请求仍为技术失败，不拿后继计 fresh | output/acceptance/release-ready-round1-policy-successors-v15-2026-10-16.json、release-ready-v15-round1-all3-domain-facts-2026-10-16.json |
| v15 无执行者独立候选 | fresh-1 正确在 assignment_qualification 阻塞，全部适用指标达标，correctAbstentionRate=1；尚须至少 5 条独立候选 | output/acceptance/release-blocked-collection-json-member-evidence-v15-round1-2026-10-16.json |
| v15 其余 ready 首次尝试 | 对剩余 9 项执行独立分波次采集；只在已确认策略替代且后继成功收口后继续未尝试的项目，质量失败、模型失败或未知技术失败仍停；根失败全保留，后继不充 fresh | output/acceptance/release-ready-json-member-evidence-v15-remaining-2026-10-16 |
| v12 Gold 结果 | 9 blocked + 2 Hono ready 批准；Zod trim 退回，overlap 未送审；未运行候选 | output/acceptance/release-transitive-policy-v12-ready-hono-zod-gold-review-2026-10-16 |
| v11 bundle Gold（历史） | 9 blocked + Hono/Zod 4 ready，13/13 独立审阅通过，均先于其本版候选冻结 | output/acceptance/release-focused-evidence-v11-blocked-gold-review-2026-10-16/summary.json、release-focused-evidence-v11-ready-hono-zod-gold-review-2026-10-16/summary.json |
| 来源纠错修后 Gold | 9 blocked + 4 ready，13/13 独立审阅通过，均先于本 bundle 候选冻结 | output/acceptance/release-disposition-blocked-gold-review-2026-10-16/summary.json、release-disposition-ready-hono-zod-gold-review-2026-10-16/summary.json |
| 修后隔离安装 | 启动成功，本地与安装 bundle 摘要一致 | output/acceptance/installed-bundle-local-risk-2026-10-16.json |
| greeting 交付复核 | 最终 commit、2 个真实 TaskRun、人工审阅和交付确认复核通过 | output/acceptance/canary-export-local-risk-2026-10-16.json |
| 修后阻塞 Gold | 8 仓库、9 个 Gold，独立审阅通过，先于本 bundle 候选冻结 | output/acceptance/release-local-risk-blocked-gold-review-2026-10-16/summary.json |
| 场景风险修后真实规划 | 42 次正确阻塞候选、1 次模型失败，批次已收口；43 次均无审批、派发或任务执行 | output/acceptance/release-local-risk-all43-domain-facts-2026-10-16.json |
| ready 能力补充登记 | 用户明确确认后，14 项目共 52 条通过正式接口登记并核实持久化；原 204 项逐条不变 | output/acceptance/release-capability-addendum-52-confirmed-2026-10-16.json |
| 来源纠错版本真实规划 | 4 个 ready 全部错误阻塞；无审批、派发或任务执行，未再启动本批次其余请求 | output/acceptance/release-disposition-all4-domain-facts-2026-10-16.json |
| v11 真实领域核验 | 3 个错误阻塞候选、1 次策略替代；后继也已终态，无审批、派发、TaskRun 或交付 | output/acceptance/release-focused-evidence-v11-all4-domain-facts-2026-10-16.json |
| 最近已完成的正式门禁 | v14 合并批次退出 1；包含真实质量失败，同时缺完整样本及每样本 5 次候选 | output/acceptance/release-gate-combined-catalog-evidence-preview-v14-2026-10-16.json |

当前本地与隔离 v15 bundle SHA256 均为 2137b251d948cf806c5c5aca4ecf760c3697e842cb66a293fb26543de5144b13；原 v14 为 4c63a3335f3a609cf714d22dd270e5662cf914f01e30a13bcff2c71e9186bf48。v14 无运行 operation 后仅停止隔离 PID 22556，完成升级；v15 writer.ownerPid=42282、fencingToken=17，独立写锁健康。greeting canary 在 v15 再核实通过（output/acceptance/canary-export-json-member-evidence-v15-2026-10-16.json）。原 204 项确认和新增 52 项可信记录在重启后逐条一致；接口新建 human_confirmed 记录，原 52 条 legacy pending 历史记录保持原样，并非把未确认能力当成已确认。v13 bundle 为 c40f8bbe9864a94d7bd909bdbc700878fc9db75b9739ba92957c3a9ab5d3a5e3，v12 为 997d50f41feb75f1585488fca813649368c3faf4e455878b94a31d36d4106ec2，旧 v11 为 edf3dc23c2ceb5c2eb442ddc2a2e9bb698ac0359c024383038bafbd51e0fff32。候选各归其本版，不能混合。模型为已授权的 pockapi / gpt-6.1-sol，使用用户指定网关；本批次 token 不限制，无需重复授权模型或预算。

本轮隔离升级曾因禁用自动 peer 安装而缺失 cordis-plugin-group，恢复该 profile 原有 auto-install-peers=true 后安装成功；首次恢复启动遗漏独立 workspace/lock 环境，被现有默认写锁拒绝，没有修改原 3080 Host。两次失败日志均保留。最终启动显式设置 DSH_HOME、DSH_WORKSPACE_ID=po-certified-acceptance-EiDNyF、DSH_PROJECT_ORCHESTRATOR_LOCK_DIR=<隔离 root>/writer-locks、DSH_PLANNING_CONTRACT_MODE=v3-candidate；writer.ownerPid=22556、fencingToken=16，实际身份摘要核验通过。安装参数问题已修正，不以移除锁文件、终止原 Host 或修改产品门禁解决。

## 问题、归属与修复设计

### 大 JSON 相关成员集中展示（v15）

v14 实际审阅再次把已展示的 ./cors 映射当作未展示，说明单纯提示检查后续片段不足以消除误读。修复归属 BindingStage 的证据呈现：大 package.json 先以 TypeScript JSON AST 定位与原始需求词匹配的 exports/imports 成员，展示完整原始成员、JSON Pointer 与原始行号，再在同一文件预算内补上下文。成员片段最多占该文件预算一半，不提高原 8 KB 文件预算或 65,536 字节总预算，不增加检索路径、写权限或可信事实。所有内容仍绑定同一已校验的源文件 digest/ref；展示原始重复键，不把 JSON.parse 最后一个值冒充唯一事实。无效 JSON 不生成结构片段；超预算成员不生成标为完整的截断结构。独立审阅仍须验证语义，原拒绝不改判。

回归修前失败、修后通过，覆盖完整导出目标、源行定位、JSON Pointer 转义、重复键、缺失导出、无效 JSON、确定性及预算。Binding/Review 共 19 条相关测试通过，四项实际 Hono/Zod 证据链重放通过。PO_TEST_BROWSER_CHANNEL=chrome pnpm verify 退出 0：497 个 Node、6 个浏览器测试、类型、文档、原 fixture 和 149 文件包检查通过。证据：output/acceptance/json-member-evidence-{before,after}-2026-10-16.log、json-member-evidence-four-repositories-2026-10-16.json、verify-json-member-evidence-v15-2026-10-16.log。本地通过不证明真实误读率改善；另以保留的实际审阅输入运行原呈现／新呈现／虚假导出声明的真实对照，仅作为诊断，不计发布候选或人工批准。

旧 v14 已知质量失败，继续花费完成剩余阻塞样本也不能取得本版资格。原 collector 没有运行时收口信号，因此仅中断其观察进程并用同一账本以 PO_PLANNING_EVAL_DRAIN=1 恢复观察既有请求，没有取消领域 operation。新增收口模式不启动未登记请求；以后 SIGINT/SIGTERM 直接进入收口，观察在途到终态。所有已发生尝试、失败和领域状态保留，完成后再核验及升级；不会用新版本结果填补旧版本缺口。

六次真实诊断全部完成：原呈现 2/2 批准，新呈现 2/2 批准，虚假导出声明 2/2 被拒绝。负例验证新呈现没有使审阅放行不存在的导出；原呈现此次也通过，样本过少，不据此声称误读率已下降或完整流程已通过。原 rejected operation、Gold 与领域事实不变。证据：output/acceptance/json-member-evidence-model-probe-2026-10-16/summary.json。

v15 独立 Gold 审阅的 Zod overlap 首次返回 insufficient_evidence，要求解释 preview.sourceManifest.sourceDigest 与 releaseInput.sourceDigest 的关系。源码核实两者属于不同摘要域：前者标识原始来源，后者为 digestObject({ sourceManifestDigest, taskLanguage, parserVersion: 'v3.3.0' })。freeze-release-gold.mjs 增加保存 PRD 与原规范相等、重建 manifest 完全相等、重算评测摘要相等的机械断言，把实际参数与结果一起送审。仅补审阅证据，不改产品 bundle、原始需求、Gold core 或旧审阅结果；独立重审另存目录，不覆盖首次结果。

### 依赖选取、来源词义与策略示例误分类（本轮）

v11 的 Hono 两项已通过场景阶段，但 Context、HonoBase 的实际声明和请求分派仍未进入可读片段。源码检查发现，repository-evidence.ts 先填满 80 个关键词候选，后续依赖图展开条件要求候选数小于 80，导致相关声明模块无法加入。v12 先展开前 20 个入口后，完整链预检仍发现宽泛关键词入口的依赖抢占名额；v13 优先展开原文明确点名入口的三层已有依赖，没有明确入口时才回到前 20 项，再补关键词候选。仍保持每需求 80 项及全局选取边界。Binding 内容加载在同一选中清单内追踪本地 import/re-export、为精确路径和依赖预留片段；不新增写权限，不从仓库边界外读取。所有选中源文件仍完整校验摘要、路径与二进制/大小限制。

大文件片段使用精确标识符及声明匹配，避免 REQ 命中 Request、OPTIONS 命中 options、boolean 等基本类型压过实际 factory；TypeScript AST 识别的注释仅在展示片段中省略，明确标注原始行号范围。可在单文件 16 KB 内展示的精简源码保留全部代码，否则按相关位置提供最多 8 KB 片段；总内容仍不超过 65,536 字节，省略或截断继续标记。依赖优先级通过 AST 区分 runtime/type-only import；同一模块兼有普通导入和类型导入时保留 runtime 身份，避免 HonoBase 被错误降为纯类型依赖。实际四项检查加入 Context 声明、HonoBase 的 Context 创建和 onError、compose.catch，完整链检查通过：output/acceptance/transitive-evidence-v13-full-chain-2026-10-16.json。Zod 两文件的索引缺失警告仍保留，不宣称任意仓库都能在固定预算内取得完整语义。

Zod trim 的 AC-005 仅要求检查 schemas.ts 等文件，但来源提示词将 schemas.ts 和 state.ts 文件名当作数据、状态语义，强制生成额外 boundary 场景，最终要求尚不存在的“必须越界修改”的证据。修复归属 sourceNormativeHints：只在风险分类时移除文件路径词，原文、来源定位和必要处置完整保留；真实“schema 数据字段及状态”仍产生原有风险。未减少真实数据/状态场景门槛。

Zod overlap 自动后继的 policy:4 来自仓库 AGENTS.md，完整规则要求以 nub 运行工具，包含命令示例 `nub remove`。旧选择器将 remove 当成删除业务限定，导致验证场景不匹配或待确认。修复只从适用条件推断文本中排除明确工具调用的 inline command，完整 MUST statement 和后续履约义务保留；“删除记录前必须运行 npm test”等明确删除规则仍保持 delete 限定。版本为 repository-evidence-index-v3.6.2、scenario-coverage-policy-v3.3.4、scenario-coverage-review-v3.3.5、binding-review-v3.3.19、repository-policy-v3.4.1。

采集器现在将 superseded 根请求保留为 planning-policy-superseded 技术失败，独立记录已观察的自动后继；不会把带 predecessor 的后继当成 fresh，也不会重试覆盖。原账本已备份并仅补齐收口事实，未改变任何领域状态。旧版本后继的最终 policy_snapshot 阻塞亦保留。上述四个缺陷均有修前失败与修后相关验证；真实效果须由新 bundle 的独立 Gold 和后续真实批次确认。

### v13 Hono 实际审阅误读与独立请求

v13 Hono 首轮两个根请求在 policy_snapshot 检测到 repository-policy-v3.4.1 与旧基线不同，按正常机制创建后继。maxAge 后继最终 committed；expose 后继在 binding_review 被 BINDING_EXPORT_OWNER_EVIDENCE_INCOMPLETE 拒绝，声称 package.json 的冻结片段没有 ./cors 导出。两个后继均已终态且没有审批、TaskRun、Dispatch 或交付，不能替代独立 fresh 请求。

对实际发送的 expose 审阅会话解压核对，8192 字节 package.json 片段中确有 ./cors 的 types/import/require 映射，重放证据与实际 prompt 完全相等。这是本次审阅的模型误读证据，不能据拒绝文字断言源码缺失，也不能自行把拒绝改为批准。具体摘要、原 finding、实际片段及会话摘要保留在 output/acceptance/hono-expose-review-source-audit-v13-2026-10-16.json。

新的 Hono 采集使用 fresh-2 至 fresh-6，各有独立请求标识与真实全阶段计算；首轮两条失败继续保留在主账本。每个样本至少五条有效独立候选是最低次数，不是尝试次数上限；新增编号不覆盖失败，不改变质量断言，任一新质量或模型失败仍停止该采集器新增请求。两个账本只能在全部请求终态后合并，须校验同一 bundle 和 Gold 摘要、禁止重复 attempt/operation，并保留所有失败。

上述新采集在 3 次终态后已退出 1：expose fresh-2 完整 committed，所有适用指标达标；maxAge fresh-2 在 task_preflight 阻塞，expose fresh-3 在 binding_review 阻塞。后两次导出另因 teamCatalogDigest 与 Gold 不一致被拒绝资格，不能把其诊断评分计入有效候选。原样保留 ERR_ASSERTION 和 exportError，并独立复核为真实团队摘要差异；没有将其伪装成模型网络失败，也没有改写 Gold 摘要。领域核验确认 3 次均无审批、Dispatch、TaskRun 或交付。fresh-4 至 fresh-6 未启动。

### v14 能力准备范围、完整测试证据及审阅判读修复

maxAge 的冻结 Gold 与后续真实请求只在团队 claims 发生差异：首轮自动后继调用 AssignmentStage.prepareCapabilityDeclarations 时，不论请求了哪些能力，都遍历 Agent 的全部已声明能力，为已存在的定义补 pending。它额外生成两条非本次所需的 data.change，时间与该后继 createdAt 完全一致；人工可信能力没有新增。后续请求正确冻结了这些实际事实，但与先前 Gold 不再相同。根因修复位于声明写入层：仅为 capabilityIds 的请求集合创建 pending，仍保留人工确认专用接口和不可信声明拒分配逻辑；不删除已产生的历史声明，也不代签新能力。

maxAge 的任务预检确实缺少完整现有测试覆盖：src/middleware/cors/index.test.ts 原文件 16,799 字节，超过 16 KB 后回落为 8 KB 片段。明确点名的 test/spec 文件上限现为 24,576 字节，满足时提供原始全文；所有文件合计仍限 65,536 字节，依赖证据预留、完整文件摘要、路径边界、漂移与截断标记保持。实际 Hono 重放已断言该测试全文逐字一致，Context、HonoBase 的 new Context/onError 和 compose.catch 链仍存在；Zod 两项重放也通过。没有取消预检的证据要求。

expose fresh-3 再次声称 ./cors 缺失；用精确 v13 安装包而非本地修后 loader 重放，证实实际审阅 prompt 包含该映射。Binding 审阅版本升为 binding-review-v3.3.20，要求报告缺失前检查同一引用的全部片段；截断标记不否定片段内已展示的具体事实，未展示的事实仍不得推断。没有修改原拒绝、降低独立审阅门槛或加入自动批准。提示词实际效果仍待新版本真实对照。

两条实现回归修前失败、修后通过，相关 19 条测试和类型检查通过；修后完整本地验证曾通过 494 Node、6 browser，最终审阅提示改动后的完整验证另行记录。证据为 output/acceptance/catalog-and-complete-evidence-v14-before-2026-10-16.log、catalog-and-complete-evidence-v14-after-2026-10-16.log、complete-evidence-v14-verified-repositories-2026-10-16.json。扩大 package.json 全文片段的尝试曾挤占 Hono 请求分派依赖，真实重放未通过，已撤回；未以放宽该断言获得通过。

新版独立 Gold 预览不再因“已有未批准计划”一律拒绝，但只允许 awaiting_approval、完整 V3 已提交来源链、原始来源摘要相同、没有 resolved 历史 Decision 的项目。缺失或篡改历史来源、已批准计划、需求原文变化仍拒绝；GET 不生成模型请求或领域记录。重复 ready 规划回归先失败后通过，逐表核对只读性及五项输入摘要，并验证批准状态和原文变化均拒绝。

对 v13 两个没有 evaluationInput 的策略后继，可使用此前独立只读观察报告作为精确旧事实证明，而不修改采集账本。除原有根请求、终态、项目、时间和旧领域核验要求外，逐项比较根与后继对象摘要、完整诊断、无审批/执行计数；独立观察必须早于领域审计，领域审计早于新版隔离安装验证。报告文件也参与来源 SHA256 校验。新增回归覆盖正常证明及 8 种篡改/越界拒绝，历史证明共 4 条测试通过；不推断后继 bundle，不将其计 fresh。最终全部修改的完整验证为 output/acceptance/verify-catalog-evidence-preview-v14-final-2026-10-16.log（496 Node、6 browser，退出 0）。

### 有界源码证据未覆盖真正相关位置

Hono/Zod 的四个 ready 样本均在 scenario_completion 因实现、测试或编译配置证据不足阻塞。原 BindingStage.loadFrozenEvidence 对排名文件逐一截取开头最多 16 KB、总计 64 KB；广泛匹配的文档和大 schemas 文件排在前面，耗尽预算，真正的 API、测试、package.json 只剩空内容。Zod 的 stringbool 位于 api.ts 约第 1787 行、classic/schemas.ts 约第 2892 行、mini/schemas.ts 约第 1948 行，文件开头截取也无法覆盖。另 categoryForPath 先匹配 test/spec，把 tsconfig.spec.json 和 tsconfig.test.json 错当测试文件，未进入必选 manifest 证据。

修复归属为 src/planning/repository-evidence.ts 的检索排序/分类，以及 src/planning/binding-stage.ts 的有界内容加载。明确点名的当前文件优先于宽泛词汇匹配；配置分类先于 test/spec；加载时优先相关验证配置及明确路径，大文件按需求相关符号及配置键提供带原始行号的片段。保持总计 65,536 内容字节、单个片段最多 8,192 字节、完整文件摘要及路径边界/漂移检查；缺失内容仍明确标记 truncated，不把片段当完整文件，不假定新测试文件已存在。

进一步对实际四项输入运行报告 Schema 预检发现，中文长需求的完整词与双字展开超过 querySeeds.terms 原有 200 项上限。现仅约束检索表示为最多 200 项、单项最多 240 字符；原始需求继续完整保留并独立用于精确路径选择，不放宽持久化 Schema。发生缩减时保留 repository-evidence-query-truncated 警告，不伪装全量检索。新增多语种边界回归，四项实际输入均已通过完整报告 Schema 和内容断言：output/acceptance/focused-evidence-real-repositories-schema-2026-10-16.json。

Service 将同一冻结来源作为选取依据传给 Scenario 生成、独立审阅、Binding、Binding 审阅及执行者预检。证据内容及摘要仍进入审阅 digest，Binding 前仍核对仓库漂移。版本 repository-evidence-index-v3.6.0、scenario-coverage-review-v3.3.4、binding-review-v3.3.18。旧默认加载接口保留原有行为，规划路径显式使用有焦点的证据。

晚于文件开头的目标函数和配置预算回归修前失败、修后通过；原始文件摘要漂移仍拒绝。对保留的四个 Hono/Zod 仓库输入只读重放，均在原 64 KB 总内容预算内拿到实际 factory/调用、已有测试和 TypeScript/package 配置，没有模型请求或领域 mutation。证据：output/acceptance/focused-evidence-before-2026-10-16.log、focused-evidence-after-2026-10-16.log、focused-evidence-retrieval-after-2026-10-16.log、focused-evidence-real-repositories-after-2026-10-16.json。真实效果及最终完整验证以新版后续记录为准。

### 来源重复消费与纠错上下文不足

Mitt 未决样本 fresh-5 的 operation planning-v3:b7fa0725-c3f1-471c-83a8-4ba4c2ea364e 在 requirement_analysis 失败，未发布 Requirement Analysis proposal。保留失败，不将其记为正确业务阻塞，也不补跑覆盖。

原始会话 project-orchestrator-9881bde0-14e5-4ad8-af51-87691e1369f1 中，第 7 行同时由 REQ-001/AC-001 和 DEC-001 消费。第二次会话 project-orchestrator-3871cd82-8d26-4172-b4f9-43a6e087b2f0 修正该行后，又把第 20 行同时放入 REQ-001/AC-006 和范围外 REQ-003。唯一消费校验拒绝正确；原反馈只提供行号，纠错请求没有待修复结果，且未明确区分消费与支持引用。

修复归属为 src/workflow.ts 的确定性错误反馈与 src/service.ts 的分析纠错交接：报错列出完整 anchorId 和全部消费对象；纠错携带原始无效输出并标为不可信数据；提示明确 Acceptance、Decision、范围外/延后 Requirement 的 sourceRefs 才消费来源，in_scope Requirement、选项证据和诊断只是支持引用。混合验证行为与调用约束的块保留在单个来源充分的验收中，不删约束、不代选 Decision。提示版本 requirements-v2.13，仍最多两次尝试，重复无效继续失败。

两条新增回归修前失败、修后通过：涵盖 Decision/Acceptance、范围外 Requirement/Acceptance、两个 Acceptance 竞争，以及支持引用可复用；Service 覆盖纠错成功和连续重复仍阻断、无 proposal/派发。证据：output/acceptance/disposition-repair-before-2026-10-16.log、disposition-repair-after-2026-10-16.log。真实效果待新 bundle 的独立 Gold 与 fresh 批次验证，不以模拟回归替代。

### 场景风险错误传播

pretry-abort-cause 的同步构造和类型验证被要求提供恢复场景。deriveScenarioCoverageFactsV3 把父 Requirement 的全部 sourceRefs 合并到每个 AC，兄弟 AC 的风险变成所有 AC 的义务；子串正则还会将 pRetry 标识符认成恢复动作。

已在 src/service.ts 按当前 AC 的精确来源计算必需类别；父需求完整来源仍用于全局风险、证据要求及独立 Reviewer 门槛，不删除全局风险。英文恢复动作按完整单词识别，重试终止契约本身不推导恢复。策略版本为 scenario-coverage-policy-v3.3.3。

新增回归先失败、修后通过：同步构造、标识符、类型检查不产生恢复义务，真实依赖失败重试仍要求 recovery。证据：output/acceptance/acceptance-local-risk-before-2026-10-16.log、acceptance-local-risk-after-2026-10-16.log。此前“展示失败状态不应凭空推导 dependency_failure/recovery”的回归也通过。

### 固定输入被重新打开为决策

两个 C 场景已在原规范明确固定假设选项，但分析仍生成待人工解决的 DEC-001。已在需求分析与独立审阅提示词中区分“源文固定的产品输入”与“正式登记的人工 Decision”：前者只规划所选分支，未选分支保留背景处置；真正未决仍阻塞，不生成 human_confirmed、审批或执行事实。版本 requirements-v2.12。

场景风险版本的 8 组真正未决 B 场景共有 39 次正确阻塞及 1 次来源重复失败。来源纠错版本的 Hono/Zod 两个 C 首次真实分析均保留固定选择，未重开产品 Decision，但后续因场景源码证据缺失而阻塞，不能宣称完整恢复成功。最新 bundle 的全部 B/C 对照仍需完成；本地或提示词静态检查不替代真实对照。

### 能力准备与真实派生不符

plimit-wrapper-counts 已通过需求、场景、Binding、Plan 审阅，最终因两名成员缺少 data.change、integration.consumer 正确拒绝分配。现行 v3.3.14 将跨调用共享内存状态映射到 data.change，将异步消费者映射到 integration.consumer；此前“无持久化就不需要 data.change”的判断不完整，不能为通过而取消正确派生。

原 204 条已按实际确认登记。另对 8 仓库、16 个 ready 规范独立预检，形成[48 项补充](release-capability-addendum-complete-2026-10-16.zh-CN.md)，其中包含先前 4 项。后续 Zod 专项源码审阅确认 trim 配置契约及 overlap 构造期词表不相交约束均是必要数据模型契约，各为两角色补 data.change，共新增 4 项，合并为[52 项清单](release-capability-addendum-52-2026-10-16.zh-CN.md)。不因为保留只读 Set 就推导 domain.state。Service 仍按实际 ownership 派生资格。本轮用户明确确认完整 52 项后，运行 node scripts/confirm-release-capability-addendum-52.mjs --apply 退出 0，14 个项目的 52 条 active / human_confirmed 均由正式接口返回且与存储逐条一致，原 204 条逐条保留。原清单和 pending 摘要作为确认前证据保留，不回写篡改。

### 历史策略后继的版本隔离证明

Zod overlap 的旧自动后继没有 evaluationInput，原 Gold 脚本因此拒绝复用项目。现在允许另一种严格证明：旧账本明确观察的唯一策略后继，必须与当前终态、项目、predecessor、idempotencyKey、时间和诊断逐项相同；根请求必须有不同于本版的冻结版本，并处于 policy_snapshot/superseded；既有领域审计的观察时间须早于本版隔离安装验证。加载时核对三个原始证据文件的 SHA256 和内容，未观察历史、当前版本、运行中、跨项目、终态变化或重复后继仍拒绝。

该证明不推断或回填后继版本，不将其计为 fresh，不提供历史候选给 Gold 审阅。实际 Zod 旧链只读验证通过，证据为 output/acceptance/release-historical-policy-observation-v13-2026-10-16.json；2 条回归覆盖成功路径与 12 种拒绝条件，node --test tests/release-gold-history.test.mjs 退出 0。该变更只涉及验收脚本，不改变安装的产品 bundle。

## 评测隔离与历史保留

历史 release-scenario-evidence-2026-10-16 共 49 次候选：45 次阻塞对照符合预期、4 次 ready 质量失败，模型失败 0；49 次领域记录均无 Task 执行、审批或 Dispatch。失败、响应、Gold 和 manifest 均保留。领域证据：output/acceptance/release-scenario-evidence-all49-domain-facts-2026-10-16.json。

修后新建 25 个版本化 case 标识与独立批次，原始 PRD 字节、预期行为、成员及 projectId 不变，能力信任事实不跨项目复制。新 Gold 只在本 bundle 尚无候选且历史 operation 均终态时冻结；审阅不含历史候选，冻结期间不并发登记或规划 mutation。准备证据：output/acceptance/release-local-risk-projects-2026-10-16.json。

更早 release-real、release-stage-boundary、release-reviewer-precondition、release-scope-handoff、release-task-boundary、release-verification-scope 等失败批次继续保留。场景源码证据交接的先前修复也保留：生成与审阅收到同一有界源码，源码摘要进入审阅 digest，Binding 前校验漂移。

## v15 收口与恢复契约修复

完整账本：output/acceptance/release-combined-collection-json-member-evidence-v15-2026-10-16.json。领域核验：output/acceptance/release-combined-v15-all10-domain-facts-2026-10-16.json。正式门禁：output/acceptance/release-gate-combined-json-member-evidence-v15-2026-10-16.json，退出 1。7 条有效候选中 plimit clear-reason 与 Hono expose 完整规划成功；无执行者、plimit/pretry/pqueue 三个未决需求正确阻塞；pretry hook resolved 错误阻塞。3 条策略替代及其唯一自动后继均保留，不充 fresh 次数。

pretry resolved 在 scenario_completion 被拒绝：源文 AC-002 和固定选项要求 hook 抛值原样终止，不定义中断后的恢复结果。原策略仅因引用的决策问题中含“继续重试”就强制 recovery，生成者正确拒绝虚构恢复行为。修复归属于 Service 的确定性类别派生：普通 retry/重试词汇、次数、调度及终止契约不独立建立恢复义务；明确恢复、回滚、补偿、重放、重启与重试成功结果继续要求 recovery。每条 AC 自身来源、聚合风险与独立审阅保持生效，策略版本改为 v3.3.5。原规范和 Gold 未改变；修前失败和修后相关测试分别保留在 output/acceptance/recovery-contract-before-2026-10-16.log 与 recovery-contract-after-2026-10-16.log。

pqueue 的策略后继最终在 code_binding 因缺少 getter 与事件生产者实现而阻塞，原拒绝没有改判。实际 source/index.ts 为 44,078 字节，去除注释和空行后约 22 KB；16 KB 实现文件限额使其退回 8 KB 窗口，遗漏 late getter、#add 与 completed/error/idle 生产路径。修复将明确点名的实现文件与回归文件统一使用已有 24 KB 检查额度，仍受全体 64 KB 上限、其他 owner 预留、冻结路径与摘要校验约束。未扩大未来写入范围，也不将省略注释的证据标成原文件完整。修前回归：output/acceptance/complete-owner-evidence-before-2026-10-16.log。修后实际冻结仓库重放及新版本完整验证结果以后续证据为准。

v16 实际验证：pnpm build 及 BindingStage 全部 12 条回归通过；原冻结 pqueue 重放复现旧 8,192 字节缺口，新证据 22,164 字节，解析器的全部可执行 token 与原始 owner 一致，所有引用/摘要不变，总预算为 65,536 字节。最初裸词法扫描器不能正确重扫 template 尾部，审计脚本断言失败；随后改为 TypeScript 解析器取得上下文 token，原失败没有作为产品结果或成功证据。有效审计：output/acceptance/complete-owner-evidence-real-pqueue-2026-10-16.json。Hono/Zod 原四项证据链检查仍全部通过：output/acceptance/focused-evidence-real-repositories-recovery-owner-v16-2026-10-16.json；保留索引部分覆盖警告。

PO_TEST_BROWSER_CHANNEL=chrome pnpm verify 退出 0（499 Node、6 browser、类型、文档、原 fixture 及 149 文件包检查），日志：output/acceptance/verify-recovery-owner-v16-2026-10-16.log。历史多批证据集合另跑 5 条回归全部通过，拒绝缺失、重复、跨项目或篡改的历史证明，不把自动后继充 fresh。v16 bundle SHA256 为 f4fa05a62734b4182c6002909c2e3206808585032359fb8d7b87ec854acf66df，tarball SHA256 为 a190542c937e8683d8934a3c249d253c9b8a866603233ecf752bbccdbcfb6744；隔离 Host PID 90282，writer fencingToken=18，原 3080 未变更。安装验证：output/acceptance/installed-bundle-recovery-owner-v16-2026-10-16.json；已确认 256 项与 greeting commit/人工交付事实不变。

25 项新 case 仅改版本标识，原规范字节、projectId、配对及信任事实不变。历史预检第一次因 ready 领域观察比独立后继观察早 446 毫秒而拒绝，没有放宽时序断言；通过只读重新审计原 ready 账本，再完整复核同一安装包，留下新的两个证据文件，旧记录不改。最终 4 组原始证据及各 SHA256 验证通过，61 个原项目的 8 条历史策略后继均逐一证明终态且与新版隔离，不推断后继版本：output/acceptance/release-historical-observations-v16-2026-10-16.json。Gold 审阅不包含旧候选；全部审阅完成前不新增规划请求。

v16 首次 Gold 审阅 6 项批准、19 项退回，均指出“原始 PRD 含末尾换行的哈希”与“持久化 trim 后哈希”没有明确区分。25 项机械审计确认原始摘要全部精确正确，持久化正文全部等于 proposedPrd.trim()，原规范未改变；证据：output/acceptance/release-prd-normalization-audit-v16-2026-10-16.json。已在 Gold 输入中明确两种摘要域、原始与标准化后摘要、String.prototype.trim() 比较规则，并加入提交审阅前的精确断言。没有改 Gold core、sourceDigest 或任何产品输入；19 项基于新增具体证据重审，全部批准，原 19 项退回响应保留。重审日志：output/acceptance/release-recovery-owner-v16-normalized-prd-gold-freeze-2026-10-16.log；加原先 6 项，25/25 Gold 均在新版真实候选之前冻结。

真实首轮已启动：ready 并发 3，先 pretry hook resolved、pqueue outstandingCount、Zod trim，再继续其余 13 项；blocked 并发 1，采集 9 项首条。账本为 output/acceptance/release-ready-recovery-owner-v16-round1-2026-10-16.json 和 release-blocked-recovery-owner-v16-round1-2026-10-16.json。使用新版独立 fresh-1，不使用自动后继或旧版成功补数；任一质量/技术失败保留并停止该采集器新增，在途操作自然收口。

## 剩余执行顺序与最终判据

1. 在新 bundle 冻结独立 Gold 后运行 45 次阻塞对照，逐项核对领域状态及没有审批、派发或 TaskRun；旧版 43 次及来源重复失败完整保留，不计入新版资格。
2. 52 项已获明确确认并完成正式登记，接下来核实新版重启后全部 256 条确认事实不变；无需再次询问能力、模型或预算。
3. 对 16 个 ready 冻结最新团队事实并独立审阅。每项至少 5 条有效 fresh 候选；所有失败和策略后继保留，不修改原需求或 Gold 迎合候选，不以自动后继补足有效次数。
4. 同版本 manifest 覆盖 25 样本、8 仓库、至少 125 条有效候选，含 8 对未决／恢复与无执行者对照；带真实 V2 canary 运行正式 release gate。所有适用指标达标且退出 0，才宣布整体验收通过。

最近已实际执行的正式门禁命令（退出 1）：

```sh
node planning-evals/run.mjs --release \
  --manifest planning-evals/release-combined-manifest-scenario-source-helper-v17-2026-10-16.json \
  --canary output/acceptance/greeting-release-canary-v2-2026-10-15.json \
  --output output/acceptance/release-gate-combined-scenario-source-helper-v17-2026-10-16.json
```

仅更新隔离 3087；用户原 3080 Host、上游仓库和正式发布未变更。恢复隔离包前须确认无运行 operation，再重装保留 tarball 并核验摘要；保留领域数据和失败账本，包回退不等于数据恢复。

设计依据：[改进方案](project-improvement-plan-2026-09-22.zh-CN.md)、[技术设计](project-improvement-technical-design-2026-09-22.zh-CN.md)、[批次执行方案](release-batch-execution-design-2026-10-15.zh-CN.md)。历史：[验收过程与证据](project-acceptance-2026-10-14.zh-CN.md)。
