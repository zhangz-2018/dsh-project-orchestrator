# 重建 greeting 最终交付审阅

状态：独立技术验收通过；用户已批准精确最终 commit，正式接口已登记人工审阅、确认交付并导出 canary，导出复核通过。日期：2026-11-10。

## 精确交付对象

| 对象 | 值 |
| --- | --- |
| 隔离项目 | `ac9fafa7-c07b-4802-a177-6f4c986130bc`，revision `5` |
| 计划摘要 | `49ef698c3c94c3da072200279c63ac75e25947de6bb6e49ebb482746d95c958a` |
| 基线 commit | `77aa9a174da47c111f190d8cc52dfb91c8b00635` |
| 最终 commit | `d5bbf64bad16a3c98cb21290395fdfaba3c4cc6d` |
| 工作区 | `output/acceptance/formal-170-20261109/canary-workspace` |
| 范围 | 仅 `src/greeting.ts` 与 `tests/greeting.test.ts` |

## 最终行为与差异

实现如下，函数签名、导出名和问候格式不变：

```ts
/** 规范化姓名并返回已有的问候格式。 */
export function greet(name: string): string {
  const normalizedName = name.trim()
  if (normalizedName === '') {
    throw new TypeError()
  }
  return `Hello, ${normalizedName}!`
}
```

保留原 `greet('Ada')` 回归，新增三项 `node:test`：`' Ada '` 返回 `'Hello, Ada!'`，空字符串同步抛 `TypeError`，`' \t\n'` 同步抛 `TypeError`。`package.json`、`README.md` 和依赖均未改动。

两名不同成员分别完成实现与独立验证，各有一次 completed TaskRun 和正式 `npm run test` passed 记录。独立技术检查重新执行四项仓库测试，并额外验证普通姓名、空白姓名、换行/制表符及不换行空格/全角空格；全部通过，仓库无未提交差异。Integration 为 ready、CAS matched，Convergence 为 converged 且 findingIds 为空。

## 审核范围缺陷与恢复

首次独立检查发现 pending Review 混入旧失败计划的六项 Acceptance。产品修复按当前冻结计划的 requirementBundleIds 取验收范围，append 保留包仍参与；旧失败事实不删除。针对性及全量回归通过后重启隔离 Host，pending Review 恢复为本计划的两项 passed Acceptance，并新增系统审计事件。前后逐字段比较证明：历史 Acceptance、能力、计划批准、TaskRun、正式验证和集成记录未变。尚未登记最终人工 approve 或任何豁免。

## 发布证据限制

本计划由 v50 生成，在 v51 执行，审核范围修复由新构建完成。本次是用户批准计划的真实完成记录，不能记为最终发布构建的同版 canary。正式 1.7.0 仍需同构建真实规划批次与完整交付门禁，不能据本材料直接发布。

## 本地证据

- 完整 diff、测试输出及独立行为验证：`output/acceptance/formal-170-20261109/canary-recovery/technical-authorized-v50.json`。
- 原始批准与执行：`output/acceptance/formal-170-20261109/canary-recovery/delivery-authorized-v50.json`。
- 恢复范围核验：`output/acceptance/formal-170-20261109/canary-recovery/review-scope-recovery-proof.json`。
- 原始恢复前后领域快照保存在同目录，仍用于复现与验收，不清理。

用户已明确回复“批准最终交付并登记”。登记回执为同目录 `delivery-confirmed-authorized-v50.json`，导出为 `release-canary-authorized-v50.json`，逐项复核为 `export-verified-authorized-v50.json`。没有新增验收或独立性豁免；不包含任何新计划或发布门槛豁免。
