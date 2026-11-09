# 发布评测样本审阅草案

日期：2026-10-15。目标：准备 8 个真实仓库、24 个分别审阅的需求样本，每个样本至少 5 次全新模型规划。此文件是需求与预期的审阅材料，不是已签署的 Gold，也不是模型评测结果。

2026-10-16 修订：用户已明确本批次 token 不限制，预算不再阻塞。独立模型审阅的原请求、原响应和逐项结论保存在 `output/acceptance/release-independent-review-2026-10-16/`。修订后的逐项 PRD 由 `scripts/prepare-release-input-review.mjs` 生成，补充并发、异常、选项默认值和完整入口证据；C 是作者固定的假设评测选择，不登记人工 Decision。下表原“确认后”表示须完成独立输入审阅与可信团队冻结，不额外要求用户为假设场景逐一确认。真实成员能力仍需实际可信来源。

## 已核实的仓库基线

源码已从各项目公开 Git remote 取得，保存在 `output/acceptance/repositories/`。仅阅读源码和 package scripts；没有执行这些仓库的安装脚本、测试或业务代码，没有修改或向上游提交内容。正式采集必须使用下列 commit，而非移动的默认分支。

| 仓库身份 | 固定 commit | 覆盖领域 | 已存在的验证入口 |
| --- | --- | --- | --- |
| sindresorhus/p-limit | `a8a6fbec4e0e866d6d779b10889bb4f5567e70eb` | 并发限制与排队 | `npm run test`，XO / AVA / tsd |
| sindresorhus/p-retry | `1472907affe8d6107aba5884abc36d6361b3042e` | 重试、取消与异常 | `npm run test`，XO / AVA / tsd |
| sindresorhus/p-queue | `7f272ab5ff2254c0dc2537b7977e88ede1cd55e8` | 状态、调度与速率限制 | `npm run test`，包含 Node tests 与构建 |
| sindresorhus/p-map | `d61b6a33cc1d5533ad5711b435959f3f78c3d2fe` | 同步/异步迭代与并发映射 | `npm run test`，XO / AVA / tsd |
| sindresorhus/ky | `3541888878c4d303a8bc2ad61815f4e048f55a5d` | HTTP 客户端、错误与 hooks | `npm run test`，包含构建、类型检查与 AVA |
| honojs/hono | `588ec13fa68ea44fed1b5e1b503341db2bf09d70` | HTTP 服务与 CORS 中间件 | manifest 中的 `test` script：tsc / vp test |
| colinhacks/zod | `680d19f7d1e042e55934209caeb79bc843b94f44` | schema、转换与校验错误 | 根 `test` script：nub / Vitest |
| developit/mitt | `6b41670516ed8e8b738612f60491995470aa63b3` | 事件分发与类型契约 | `npm run test`，类型、lint、Mocha |

上述入口是仓库声明，不能当作本轮实际测试通过。其依赖、Node 版本及工作区安装方式在进入执行前另行核对。发布规划评测不会执行这些需求；完整执行验收已有独立 greeting canary。

## 样本组织与统一验收规则

每个仓库有三个 case：A 是需求明确的增量；B 是必须等待业务选择的另一需求；C 是 B 的已明确选择版本。B/C 是显式恢复对照，保留相同业务问题，改变 Decision 输入。它们是独立审阅的条件样本，不把一个 case 内的多条 Acceptance 另算样本，也不把同一仓库的复制品计作新仓库。

准备 16 个 ready、8 个 blocked case。A/C 的 ready 预期以执行成员具有该需求实际所需的可信能力、可用 Runtime、容量和访问权限为前提；这些事实必须在采集前正式登记并冻结。原 greeting 的 9 项确认仅适用于原项目，不外推到本批次。存在新能力缺口时先出具体清单，不通过 Persona 推定。

每项需求均须保留：成功、拒绝/边界、异常或取消、既有调用兼容及类型验证。只使用现有依赖和测试体系，不改发布配置、无关模块或上游仓库。A/C 的预期最终阶段为 `preflight`，阻塞原因为空；B 的预期阶段为 `decisions`，原因是 `requirement-decision-pending`，subject 为 `DEC-001`。B 不得生成已就绪的 Task 或选择实现方案。

所有 case 的原始需求须明确给出 REQ / AC / DEC 的稳定本地键。Gold 的任务与分配预期还需结合正式团队事实确定；不能根据候选运行的输出改写期望来取得通过。

## 24 条具体需求与预期

### p-limit

现状：`pLimit()` 返回的 limiter 有 `activeCount` / `pendingCount`；`limitFunction()` 仅向包装函数暴露 `clearQueue`。

| caseId | 原始需求与验收要点 | 预期 |
| --- | --- | --- |
| plimit-wrapper-counts | `limitFunction` 的返回函数新增只读 `activeCount` 和 `pendingCount`；值实时来自同一个内部 limiter。并发 1 时挂起一个任务并排队一个任务，应分别为 1/1；完成后为 0/0。不能新增第二个队列、改变返回 Promise 或可写 concurrency 契约；类型测试证明两个属性只读。 | ready |
| plimit-clear-reason-pending | 为开启 `rejectOnClear` 的 limiter 增加 `clearQueue(reason?)`。显式未决 `DEC-001`：自定义 reason 应原样拒绝，还是强制包装为 AbortError？这会改变调用者的 catch 契约；不得自行选择。保留不取消已运行任务、队列清空后 pendingCount=0 的要求。 | blocked |
| plimit-clear-reason-resolved | 与上一 case 相同；拟定 `DEC-001` 选择为“显式传入的 reason 原样作为拒绝值；未传入时维持现有 AbortError”。测试 Error 对象身份、字符串、显式 undefined 与无参数行为；关闭 rejectOnClear 的既有行为不变。选择尚待用户确认，当前不登记 human 决策。 | ready（确认后） |

责任源码：`index.js`、`index.d.ts`；验证：`test.js`、`index.test-d.ts`。B/C 主要责任在 `clearQueue`，A 在 `limitFunction`。

### p-retry

现状：`AbortError` 保留 `originalError`，没有显式设置标准 `cause`；重试调度在 `onAttemptFailure` / `delayForRetry` 内完成。

| caseId | 原始需求与验收要点 | 预期 |
| --- | --- | --- |
| pretry-abort-cause | `new AbortError(error)` 的 cause 与 originalError 均指向同一个原始 Error；字符串构造的 cause 指向已有的包装 Error。保留 name、message、originalError 及 pRetry 抛回原始 Error 的兼容行为，覆盖类型声明。 | ready |
| pretry-scheduled-hook-pending | 新增同步可选 hook `onRetryScheduled`，提供 attemptNumber 与实际等待 delay；显式未决 `DEC-001`：hook 抛错应终止重试还是忽略并继续？不得自行选择。达到次数上限、被 shouldRetry 拒绝或已取消时不能发出“已调度”事件。 | blocked |
| pretry-scheduled-hook-resolved | 与上一 case 相同；拟选择“hook 异常终止本次调用并原样传播”。hook 只在决定继续后、等待前调用一次；delay 经过现有上下限与剩余预算约束，不能重复计算随机数。保留无 hook 调用及取消清理行为。 | ready（确认后） |

责任源码：`index.js`、`index.d.ts`；验证：`test.js`、`index.test-d.ts`。不新增计时依赖。

### p-queue

现状：`source/index.ts` 分别提供等待数量 size、运行数量 pending；并发和速率限制有独立测试。固定 commit 的 clear 已经会拒绝等待任务，且有自动回归；原草案将其误列为新增功能，现于模型采集前改为尚不存在的 maxQueued 需求。旧草案 JSON 保留，不能作为本次冻结输入。

| caseId | 原始需求与验收要点 | 预期 |
| --- | --- | --- |
| pqueue-outstanding-count | 新增只读 `outstandingCount`，恒等于读取时的 size+pending。覆盖空、暂停后入队、开始执行、成功/失败完成、clear 及限速状态；不得修改现有 size/pending 语义或调度顺序。 | ready |
| pqueue-maxqueued-pending | 新增构造选项 maxQueued，限制尚未开始的等待任务数量，默认不限制。显式未决 `DEC-001`：容量拒绝使用原生 RangeError，还是 name=QueueCapacityError 的普通 Error？此选择影响调用方错误类型分支，不得自行选择。两种方案均保留已有任务，不涉及移除任意自定义队列条目。 | blocked |
| pqueue-maxqueued-resolved | 与上一 case 相同；拟选择“拒绝新提交，RangeError，已有任务不受影响”。maxQueued 为非负整数或 Infinity；0 允许当前可立即运行的任务，但拒绝需要等待的任务。覆盖暂停、并发已满、限速、addAll、已取消信号及监听清理；拒绝任务不得执行、占用队列或消费限速额度。未配置时保留既有行为。 | ready（确认后） |

责任源码：`source/index.ts`；B/C 另需构造选项声明 `source/options.ts`。验证：`test/basic.ts`、`test/advanced.ts` 及现有类型测试。不要求修改 queue 存储接口；若源码审阅确定确实需要调整，须在采集前更新 Gold owner 集合，不能只允许修改调用方。

### p-map

现状：`index.js` 同时实现批量与流式映射；支持跳过、停止及错误路径，不能混为一个行为。

| caseId | 原始需求与验收要点 | 预期 |
| --- | --- | --- |
| pmap-completion-observer | 为默认 pMap 增加同步可选 `onMapped({index,value})`：成功的 mapper 结果在完成时通知一次，通知顺序允许与输入顺序不同，返回数组仍保持原顺序。pMapSkip / pMapStop 不通知；hook 抛错按当前 stopOnError 策略处理。无 hook 时行为不变，不扩展到其他导出函数。 | ready |
| pmap-input-bound-pending | 为默认 pMap 增加可选 maxItems，限制读取的输入数量；显式未决 `DEC-001`：发现第 maxItems+1 个元素时，拒绝整个调用还是成功返回截断结果？不能把截断当成完整成功。 | blocked |
| pmap-input-bound-resolved | 与上一 case 相同；拟选择“拒绝整个调用，RangeError，不向 mapper 交付超限元素”。maxItems 为非负整数，0 允许空 iterable；覆盖同步/异步输入、输入 next() 失败、既有并发任务的拒绝观察和迭代清理。未配置时保留现状。 | ready（确认后） |

责任源码：`index.js`、`index.d.ts`；验证：`test.js`、`index.test-d.ts`。不能影响 pMapSettled / pMapKeyed / pMapIterable 的既有契约。

### ky

现状：HTTPError 保存 response/request/options/data，并构造含请求 URL 的 message；源码与错误测试独立。

| caseId | 原始需求与验收要点 | 预期 |
| --- | --- | --- |
| ky-http-error-status | HTTPError 新增只读 status getter，实时等于 response.status，不缓存第二份状态。保留 response、data、name、message 和类型保护行为；覆盖普通 HTTP 失败及无 statusText 的 Response。 | ready |
| ky-error-url-policy-pending | 为 HTTPError message 增加 URL 查询参数隐藏选项；显式未决 `DEC-001`：默认隐藏还是仅 opt-in 隐藏？这涉及日志隐私与既有错误消息兼容，不能自行选择。原始 request.url 不得被修改。 | blocked |
| ky-error-url-policy-resolved | 与上一 case 相同；拟选择“显式 opt-in 时隐藏 query 与 fragment，默认完全兼容”。选项须经过现有 options/normalization 主链抵达 HTTPError；覆盖 direct/create/extend、包含敏感参数的请求及 beforeError hook 读到的 message，禁止更改请求发送 URL。 | ready（确认后） |

责任源码：`source/errors/HTTPError.ts`；B/C 另含 `source/types/options.ts` 与 `source/core/Ky.ts` 的选项消费。验证：`test/http-error.ts`、必要的 options/hook 测试。不能用仅修改构造函数而遗漏 options 主链的方案通过。

### Hono

现状：CORS 中间件已经有静态/动态 origin、异步 allowMethods 以及 Vary 行为。

| caseId | 原始需求与验收要点 | 预期 |
| --- | --- | --- |
| hono-cors-expose-function | exposeHeaders 支持返回 string[] 的同步或异步函数，接收 origin 和 Context；每个请求调用一次，空列表不写 expose header。静态数组完全兼容；函数异常沿既有错误通道传播，不能回退为允许所有来源。 | ready |
| hono-cors-maxage-policy-pending | 对 maxAge 的负数、NaN、Infinity 增加明确处理；显式未决 `DEC-001`：配置时抛 TypeError，还是忽略该字段并省略响应 header？不得悄悄输出无效 header 或自行选策略。 | blocked |
| hono-cors-maxage-policy-resolved | 与上一 case 相同；拟选择“创建中间件时对上述非法值抛 TypeError”。0 仍合法；未配置保持省略；正常 GET/OPTIONS 的其他 CORS 与 Vary 行为不变。 | ready（确认后） |

责任源码/验证：`src/middleware/cors/index.ts`、`src/middleware/cors/index.test.ts`。该 case 不修改全局路由器、Context 或认证中间件。

### Zod

现状：v4 core `_stringbool` 默认忽略大小写；转换输入没有 trim；classic 测试已覆盖默认词表及自定义词表。

| caseId | 原始需求与验收要点 | 预期 |
| --- | --- | --- |
| zod-stringbool-trim | stringbool 增加 opt-in trim，默认 false；开启后先 trim 输入再按现有 case 配置查词表。覆盖大小写、自定义词表、纯空白、非法非字符串和 encode/decode；未配置时不得把空白字符串从失败变为成功。通过 core/classic 现有出口传递参数，保持 boolean output 推断。 | ready |
| zod-stringbool-overlap-pending | truthy/falsy 归一化后发生重叠时需要明确规则；显式未决 `DEC-001`：truthy 优先还是构造 schema 时拒绝？此选择影响校验结果与错误时机，不得自行选择。 | blocked |
| zod-stringbool-overlap-resolved | 与上一 case 相同；拟选择“构造时拒绝重叠词表”。case=insensitive 时大小写归一化再检查；sensitive 时区分大小写；空词表仍按现有行为处理。不能在 parse 时才随机选择真假，或改变无重叠配置。 | ready（确认后） |

责任源码：`packages/zod/src/v4/core/api.ts` 的参数与构造逻辑，及确实需要改变的 classic/mini 出口。验证：`packages/zod/src/v4/classic/tests/stringbool.test.ts`，必要的 mini/type 回归。必须核实 mini 出口适用性，不能从 classic 路径推定所有出口已经覆盖。

### mitt

现状：Emitter.all、on/off/emit 已存在；普通 handler 后执行 wildcard handler；emit 使用数组快照。

| caseId | 原始需求与验收要点 | 预期 |
| --- | --- | --- |
| mitt-listener-count | 增加 listenerCount(type)，返回该精确 key 当前注册的 handler 个数；支持字符串、symbol 与 wildcard，不把 wildcard 计入普通事件。重复注册分别计数，off 后实时变化，空 key 为 0；类型签名只能接受既有事件键或 wildcard。 | ready |
| mitt-once-reentrancy-pending | 增加一次性订阅 once；显式未决 `DEC-001`：首次 handler 调用前注销，还是返回后注销？同一 handler 内重入 emit 的次数与异常清理会受影响，不得自行选择。 | blocked |
| mitt-once-reentrancy-resolved | 与上一 case 相同；拟选择“调用前注销”。重入 emit 不得再次触发该订阅，即使 handler 抛错也已经注销；保留其他订阅与 wildcard 顺序。普通与 wildcard 的 once 重载均需类型验证，不增加异步调度或吞掉现有异常。 | ready（确认后） |

责任源码：`src/index.ts`；验证：`test/index_test.ts`、`test/test-types-compilation.ts`。不能以重写整个事件系统替代一次性订阅。

## Gold 冻结与真实采集前的必需项

1. 审阅上述业务输入与 B/C 的选择。未确认的 C 选择当前只是建议，不写成 human_confirmed。
2. 逐 case 生成原始 PRD、稳定键、完整 owner 替代集合、分配预期、阶段与原因预期。进一步源码追踪发现新增责任文件时先修草案，不能在跑完之后追随模型输出修改 Gold。
3. 经正式接口准备具体项目/成员/能力，并独立计算发布输入摘要。Gold.releaseInput 必须来自运行前事实，不能从某个获胜 candidate 的结果倒推。对每项最终 Gold 内容和 digest 单独留审阅记录；本 MD 不代替该记录。
4. 模型保持已授权的 pockapi / gpt-6.1-sol。每个 case 五次 fresh operation；来源重用或 predecessor continuation 不计作 fresh run。失败、取消与基础设施错误全部入 manifest，不能挑选五条成功结果隐藏先前尝试。
5. 冻结现有质量阈值；falseReady / falseBlocked 均保持 0，原因 precision/recall 均为 1，不为了通过放宽门禁。新增 modelFailureRate 建议明确冻结为 0；任何非零预算容忍须单独解释，不从失败结果倒推。

## 费用与范围

最低需要 120 次有效规划 operation；一个 operation 包含多次模型请求及有界格式修复，因此不能把“120 次规划”当作“120 次 API 请求”。当前没有该自建网关的可核实计价，也没有用户指定的批次金额上限，无法据此给出可信人民币估价。

本轮尚未启动新增批次，没有因本草案产生新的模型费用。开始前需要确定可执行的费用或 token 硬上限；若提供金额上限，还需使用网关实际计价/额度接口或可核实价格换算，不能用公开模型报价猜测本代理价格。达到限额保留全部证据并停止新增请求，不自动超额重试。

本批次只做隔离规划评测，不发布 npm、不写上游仓库、不部署原 3080 Host。既有 greeting 最终人工批准与 V2 canary 继续保留，不能用新样本覆盖。
