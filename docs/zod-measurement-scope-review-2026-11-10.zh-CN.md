# Zod 正式评测测量范围调整草案

日期：2026-11-10。状态：待用户决定，未修改评测需求、Gold、目标仓库或正式门槛。

## 已核实的问题

固定仓库为 `colinhacks/zod @ 680d19f7d1e042e55934209caeb79bc843b94f44`。

原 `zod-stringbool-trim` 样本只允许未来修改以下三个文件：

- `packages/zod/src/v4/core/api.ts`
- `packages/zod/src/v4/classic/tests/stringbool.test.ts`
- `packages/zod/src/v4/mini/tests/stringbool.test.ts`

该 commit 的 `AGENTS.md` 第 57 至 76 行要求 core 变更同时提供 runtime、memory、classic/mini bundle 数值；runtime 必须区分 parse 与 construction。分配型计时必须使用固定次数、样本之间 GC、取最小值，并消费结果以防优化消除；两版本交错测量，机器负载不符合条件时不能接受数据。

v50 的真实操作 `planning-v3:13bdecb3-0093-48e6-aab0-2c7dab3e0135` 在 TaskPreflight 返回 `needs_clarification`。基线数值属于执行前应完成的工作，预检未要求预先伪造数值；它缺少测量入口实际行为的冻结源码。

进一步只读检查发现，候选选用的 construction 入口 `nub run bench init.ts` 并不能直接证明符合上述采样要求：`init.ts` 每次回调创建 1,000 个 schema，但它调用 `metabench.ts`，默认分支为 `new Bench({ time: 1500 })`；回调内部的固定数量不等于固定总采样次数，也没有轮间 GC 与最小值汇总。`nub run bench boolean.ts` 测量 `z.boolean().parse`，不是本次 stringbool 行为的直接测量。

现有 `error-construction-breakdown.ts` 确有固定次数、GC、最小值，但测量的是错误对象及失败解析，不是 schema construction，不能凭名称替代目标测量。两份既有 memory 脚本通过 `harness.ts` 保留对象并输出字节；其中 `measureStable` 取中位数，这是 retained-heap 口径，不应偷换成 runtime 计时的最小值规则。

另有独立的产品证据缺口：本次 Binding 冻结证据没有选入 benchmark 脚本，而 TaskPreflight 仅按 Binding 的 `evidenceIds` 投影源码；仅补命令字符串不能闭合测量证据。该问题应在只读证据发现及交接层修复，不能靠关闭预检解决。

这些事实说明当前候选尚不可批准。尚未穷尽证明所有既有命令都不可用，不能据此直接把整个原样本改判为预期 blocked，也不能把旧失败删除或计为通过。

## 建议的最小调整

建议在新的独立样本版本中，保留全部原产品行为、AC、仓库 commit、三项测量门槛及旧失败记录，明确允许未来增加一个测量文件：

`packages/bench/stringbool-acceptance.ts`

此文件仅负责测量，不能修改生产行为、现有测量脚本、package manifest 或发布配置；不新增依赖。它应覆盖 classic/mini 的 stringbool parse 与 schema construction，兼容基线只使用现有参数；新参数行为的额外测量与基线可比数据分列。采用固定迭代次数、显式 GC、预热、结果消费、交错运行的原始样本及最小值汇总，输出单位、revision、Node 版本及负载记录。GC 不可用或基线不匹配时明确失败。

拟新增的命令为 `nub --expose-gc --conditions=@zod/source packages/bench/stringbool-acceptance.ts`。必须先在新样本中明确该目标文件、命令及创建责任，再实现相应的确定性命令发现和冻结证据支持；文件尚不存在时不能声称它已在固定 commit 中，也不能为旧操作补造 opaque ref。现有 runtime、memory、classic/mini bundle 验证义务继续保留，新增测量用于补齐分配型计时协议。

TASK-IMPLEMENT 在改动生产文件前负责冻结并测量基线，然后完成实现及候选测量；TASK-VERIFY 独立检查原始数据、方法和回归。两任务关系及成员资格仍由正式接口校验。此次调整仅授权规划样本范围，不批准派发 Zod 实现任务。

适用范围建议为原 `zod-stringbool-trim` 及 `zod-stringbool-overlap-resolved` 两个 ready 样本；pending 样本继续在未决选择处阻塞，不绕过决策。创建新版本前逐条核对两份原文的实际边界，并对新增需求重新独立审阅 Gold；不能把旧版 Gold 批准迁移为新版批准。原能力声明如不足，必须另行核对具体能力事实。

## 验收与恢复

1. 先验证只读证据发现及预检交接，保留预算、摘要、路径隔离和缺证拒绝。
2. 独立审阅新需求及 Gold，保留原样本与每次拒绝结果。
3. 在同一安装 bundle 上运行真实候选，达到原正式批次门槛；本地回归或 Gold 批准不代替真实规划。
4. 完成同版 canary、独立验证及人工最终交付审阅，正式门禁通过后才发布 1.7.0。

未获范围调整确认前，不修改原需求、Gold 或 Zod 文件；可继续其他编排器缺陷修复与本地验证。恢复时保留旧样本和对应安装包、领域快照，不以代码回退代替数据恢复。

需要用户决定的原因是原需求已冻结精确写入边界。用户提供的 AGENTS.md 要求“需要扩大范围时请用户决策”，以及“不通过……降低断言……绕过发布门禁取得通过”。本草案增加必要的测量能力，不降低任何指标，但仍必须明确确认新增文件和命令的范围。
