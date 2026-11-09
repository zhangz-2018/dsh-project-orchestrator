# 隔离 greeting：最终交付审阅材料

日期：2026-10-15（Asia/Shanghai）。隔离完整交付验收已通过；人工最终审阅、交付确认和 V2 canary 导出均已完成。

## 结果与精确对象

用户批准的 revision 2 计划已通过正式审批、两次 Dispatch、两个不同成员的真实模型执行、实际测试、Integration 与 Convergence。随后独立运行 `scripts/verify-canary-delivery.mjs`，对最终 canonical commit 重跑原始需求与文件范围检查，退出 0。

用户审阅本文件后明确回复“批准最终交付并登记”。正式 Review approve 与 Delivery confirm 已于 2026-10-15 01:44（Asia/Shanghai）持久化，无 waiver，独立性检查通过。确认后再次运行技术验收，退出 0；正式 CLI 导出 schemaVersion 2 release canary，并通过 Service schema、评测 contract 及与实时记录的摘要核验。实际最终 diff 未变。

| 字段 | 实际值 |
| --- | --- |
| 隔离 Host | `http://127.0.0.1:3087` |
| Project | `ac9fafa7-c07b-4802-a177-6f4c986130bc` |
| 计划 revision | `2` |
| Planning operation | `planning-v3:59ca03a4-22a8-4960-b2ce-e906ad525c2d` |
| Plan digest | `c20c582140872c834b124e78dc3240f9f03259c1924e2767474dc9fd31d038b4` |
| 仓库 | `/var/folders/jk/342x3ttd0hv15q3c5l7z0vrm0000gn/T/po-certified-acceptance-EiDNyF/workspaces/greeting` |
| 基线 commit | `6c046d7e11150f45ac9767146708663614803a1f` |
| 最终 canonical commit | `8541b63a4959b3b82ce12df570f93507f6435cba` |
| Project 状态 | `completed / delivered` |
| Review | `ac9fafa7-c07b-4802-a177-6f4c986130bc:review:r2`，`approved / human` |
| Delivery | `ac9fafa7-c07b-4802-a177-6f4c986130bc:delivery:r2`，`delivered` |
| Canary evidenceBundleDigest | `7e07371fa148bae04bb0d5da14b71ee835322b00f58ae9d00419b39daeadcc0e` |

原用户 3080 Host 未修改，本项目没有部署、发布或提交到远程。隔离环境与证据保留。

## 实际最终 diff

仅改变 `src/greeting.ts`、`tests/greeting.test.ts`，没有新增依赖；`package.json`、`README.md` 与基线一致。

```diff
diff --git a/src/greeting.ts b/src/greeting.ts
--- a/src/greeting.ts
+++ b/src/greeting.ts
@@ -1,3 +1,7 @@
 export function greet(name: string): string {
-  return `Hello, ${name}!`
+  const normalizedName = name.trim()
+  if (normalizedName === '') {
+    throw new TypeError('Name must not be empty')
+  }
+  return `Hello, ${normalizedName}!`
 }
diff --git a/tests/greeting.test.ts b/tests/greeting.test.ts
--- a/tests/greeting.test.ts
+++ b/tests/greeting.test.ts
@@ -5,3 +5,16 @@ import { greet } from '../src/greeting.ts'
 test('greets a nonempty name', () => {
   assert.equal(greet('Ada'), 'Hello, Ada!')
 })
+
+test('AC-TRIM: trims leading and trailing whitespace', () => {
+  assert.equal(greet(' Ada '), 'Hello, Ada!')
+})
+
+test('AC-REJECT: rejects empty and whitespace-only names', () => {
+  assert.throws(() => greet(''), TypeError)
+  assert.throws(() => greet('   '), TypeError)
+})
+
+test('AC-COMPAT: preserves the greeting for an unpadded name', () => {
+  assert.equal(greet('Ada'), 'Hello, Ada!')
+})
```

## 对照原始需求的实测

| 原始要求 | 最终 commit 上的实际检查 | 结果 |
| --- | --- | --- |
| 去除姓名首尾空白 | `greet(' Ada ') === 'Hello, Ada!'` | 通过 |
| 空姓名、纯空白抛 TypeError | `''`、`'   '`、制表/换行、NBSP/全角空格 | 全部通过 |
| 原有效姓名保持兼容 | `greet('Ada') === 'Hello, Ada!'` | 通过 |
| 自动回归 | canonical 仓库实际运行 `npm test` | 4/4，退出 0 |
| 依赖、签名及修改范围 | 实际 Git diff 仅两文件；保持导出名和 `greet(name: string): string`，无依赖修改 | 通过 |
| 不同成员独立验证 | Software Engineer 实现，Test Engineer 验证；两个 TaskRun 均 completed | 通过 |
| 集成、收敛及最终仓库一致 | Integration ready；CAS matched；Convergence converged，无 finding；HEAD 等于最终 commit；检查前后 clean | 通过 |

实现输出 commit 为 `8d71c74adcc60df2cd9f4dfa5c5ea70a3e32b381`，经正式 Integration cherry-pick 形成最终 commit。测试成员从集成后的 commit 执行独立验证，无代码修改，Integration 以 `no_code_change` 记录；没有伪造额外修改或新 commit。

两个任务各有一次 `finished / passed` VerificationInvocation 与 schemaVersion 2 passed Evidence，输出 commit 与 TaskRun 一致，独立脚本重新校验证据摘要。ProjectReview 的两个原始 Acceptance 均 passed，无 waiver；最终人工 Review approved，Delivery delivered。

## 过程中修复与回归

1. Dispatch 原来只允许初始 planning base HEAD，错误拒绝已通过 Integration 的依赖输出。现在由 Delivery Service 校验完整输出、Inclusion Evidence、Intent 与 commit 链，返回合法预期 HEAD；外部 HEAD、损坏摘要及未收口 Intent 仍拒绝。
2. 启动恢复原来把 idle approved V3 交给 legacy 自动执行并误标 failed。现在 V3 不自动走旧入口，旧 `startExecution/retry` 也拒绝 V3；仅对旧恢复误标且仍有完整审批、完成证据、合法 canonical HEAD 的空闲 frontier 恢复 approved，记录系统活动，后续派发仍重新检查所有门禁。真实失败、执行中断和损坏证据不恢复。
3. 验收脚本首次误要求人工审阅前就处于 delivery_ready，按产品实际 `completed / review` 流程修正；新增检查 pending human Review、所有 Acceptance passed、无 waiver 及同一最终 Delivery。首次失败日志保留，没有把人工审阅伪装为通过。

`PO_TEST_BROWSER_CHANNEL=chrome pnpm verify` 退出 0：451 项 Node 测试、6 项浏览器测试、类型、文档、fixture 与包检查通过。fixture 检查不作为真实发布评测。

重装包 `dsh-project-orchestrator-1.7.0-startup-v3-fix.tgz` 的 installed `lib/index.js` 与本地构建 SHA-256 一致：`5ade9f0e464e862d1282757ab83bcbcdde832db8f65a174bf3827204e319264f`。重启仅针对无活动任务的隔离 Host，正式初始化恢复了原计划，随后正式派发验证任务。

## 可复核证据

- [首次技术验收 JSON](../output/acceptance/canary-delivery-verified-2026-10-15.json)：完整实际 diff、Integration、Convergence、两个验证链、当时待审 Review、Delivery、实际 npm 与原始需求断言输出；保留审阅前历史。
- [最终人工确认记录](../output/acceptance/canary-delivery-confirmed-2026-10-15.json)：明确授权、正式 API 请求与响应、approved Review、delivered Delivery，审计无待处理事件。
- [确认后技术复验](../output/acceptance/canary-delivery-post-confirmation-2026-10-15.json)：实际 npm test 4/4、原始断言与范围检查通过，`finalHumanConfirmationRequired=false`。
- [正式 CLI 导出的 V2 canary](../output/acceptance/greeting-release-canary-v2-2026-10-15.json)、[导出核验证据](../output/acceptance/canary-export-verified-2026-10-15.json)：两条 Invocation/Evidence、人工最终确认以及整个 evidenceBundleDigest 与实时记录一致。
- [执行与审批记录](../output/acceptance/canary-delivery-execution-2026-10-15.json)：审批、派发、历史拒绝、完成任务及交付记录。
- [技术验收命令结果](../output/acceptance/verify-canary-delivery-technical-2026-10-15.log)、[完整本地验证](../output/acceptance/verify-startup-v3-2026-10-15.log)。
- [独立验证观察日志](../output/acceptance/canary-verify-observation-recovered-2026-10-15.log)、[隔离 Host 日志](../output/acceptance/certified-host-startup-v3-2026-10-15.log)。
- [已批准计划及范围](canary-plan-approval-2026-10-15.zh-CN.md)、[整体验收与剩余发布工作](project-acceptance-2026-10-14.zh-CN.md)。

## 已登记的最终事实与剩余范围

用户明确批准后，`scripts/confirm-canary-delivery.mjs` 经正式 `/projects/:id/review/resolve` 登记独立人工 approve，再经 `/projects/:id/delivery/confirm` 登记交付；两次操作前后均重新核对精确 revision、plan、Integration、Convergence、最终 HEAD 和 clean 状态。未新增部署或发布。

随后运行 `node lib/cli.js capture-release-canary ...` 正式导出，`scripts/verify-canary-export.mjs` 核验 schema/contract、实际源记录摘要及完整 evidence bundle，退出 0。计划批准与最终交付批准分别保留，最终批准依据是用户本次“批准最终交付并登记”，没有代填未获确认的人工事实。

隔离单样本完整交付验收通过，不代表正式发布合格。使用本次真实 canary 重跑 `node planning-evals/run.mjs --release --canary output/acceptance/greeting-release-canary-v2-2026-10-15.json --output output/acceptance/release-gate-with-confirmed-canary-2026-10-15.json`，退出 1：缺 release manifest，仓库仅 1/8，需求样本仅 1/24；canary 已被门禁接受，不再有 canary 缺失或版本错误。V2 评测 candidate 导出与首次模型调用前输入冻结、独立 Gold、至少 120 次有效真实规划及最终 release gate 仍未闭合。该缺口未通过 fixture、豁免或关闭检查掩盖。
