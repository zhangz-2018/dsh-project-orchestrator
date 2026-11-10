# greeting 启动前失败恢复交付审阅

状态：已按用户批准的 revision 3 计划执行两项隔离任务，原始 greeting 行为验收通过；最终 diff 尚待人工审阅。编排系统的完整正式发布验收尚未通过，不能据此发布 1.7.0。

## 精确对象

| 对象 | 值 |
| --- | --- |
| 隔离 Host | `http://127.0.0.1:3088`，非日常 3080 |
| 项目 | `ac9fafa7-c07b-4802-a177-6f4c986130bc`，revision `3` |
| 规划操作 | `planning-v3:9e9cd022-375f-4766-82cb-8243a7be5923` |
| 已批准计划摘要 | `21aed08d2675877201267d16b55e25a160c29fb93d20541dd2674740bd157b05` |
| 基线 commit | `77aa9a174da47c111f190d8cc52dfb91c8b00635` |
| 最终集成 commit | `4ea366ea48ecb1363b24a56249b1c41132134a3f` |
| 规划时 bundle | `600d0defdba7c040748ce1f258c367a95c503f1f2c68ba82ee6dab246dfe0947` |
| 恢复执行 bundle | `8eac450ea76fa76a91564ffb42e99cc270172842211bc140e01d82bb65305aec` |
| 工作区 | `output/acceptance/formal-170-20261109/canary-measurement-workspace` |

## 执行与变更

首次实现派发在调用模型前失败：旧实现按 TaskRun ID 前 80 字符生成分支，与历史分支重名。批准、失败 TaskRun、失败 Run 与旧分支全部保留，没有通过删除历史或修改领域 JSON 恢复状态。

插件修复后通过正式 `execution-dispatches` 接口，显式指定旧失败 TaskRun，重新验证当前计划、审核、仓库、能力、权限和执行预检，创建带 `retryOf` 的新实现运行。实现 attempt 为 2，验证 attempt 为 1。两个成功运行分别由 Software Engineer 与 Test Engineer 承担。总计 3 个 TaskRun：1 个启动前失败、2 个完成；两项完成均有独立的成功 VerificationInvocation 与摘要一致的 VerificationEvidence。

最终仅修改以下两个文件，未修改 package.json、README、依赖或导出签名：

```diff
 /** 规范化姓名并返回既有问候格式。 */
 export function greet(name: string): string {
-  return `Hello, ${name}!`
+  const normalizedName = name.trim()
+  if (normalizedName.length === 0) {
+    throw new TypeError('Name must not be empty')
+  }
+  return `Hello, ${normalizedName}!`
 }
```

`tests/greeting.test.ts` 保留原 `greet('Ada')` 测试，新增首尾空白规范化、空字符串拒绝、纯空白拒绝三项测试。

## 实际验证

- 两项任务的正式验证均 passed，最终 Integration 为 ready，Convergence 为 converged、无 finding。
- 对最终 commit 独立运行 `npm test`，4 项测试全部通过。
- 独立调用 `greet` 验证原始三个行为，并增加制表符、换行、NBSP 和全角空格拒绝检查，全部通过。
- 核对函数签名仍为 `export function greet(name: string): string`，精确变更范围为两个批准文件，最终工作区 clean。
- 冻结分析将三个原始行为合并到一个复合 AC；独立检查按该冻结 AC 的身份核对，并逐项验证原始行为，没有用 AC 数量代替覆盖。
- 插件修复版 `PO_TEST_BROWSER_CHANNEL=chrome pnpm verify` 退出 0：590 项 Node、7 项浏览器测试、类型、文档、固定样本和安装包 smoke 通过。完整依赖审计各级漏洞均为 0。
- 8 项真实 dsh Host 兼容检查通过，使用确定性适配器，不计真实规划成绩。

## 保留的限制

1. 本次规划和执行跨构建，不满足同构建发布 Canary。严格 Canary V2 还要求派发链路内每个 TaskRun 都有验证调用与证据，启动前失败不具备这些记录；原门禁保持不变，不伪造验证、不移除失败，也不生成合格 release.json。
2. 最终 DeliveryRecord 的摘要投影存在缺口：责任链的实现任务 `taskRunIds`、`artifactIds` 为空，`diffStat`、`testSummary` 只汇总最后一次验证派发。原始 TaskRun、Artifact、VerificationEvidence、Integration 输出都保留且可交叉定位；本次独立报告据这些原始事实验证。该投影问题归属 `src/delivery/service.ts` 中按最后一个 `runId` 筛选的汇总逻辑，仍需修复后完成完整交付验收，不能把摘要缺失算作已通过。
3. greeting 实现的简短方法注释未明确写出空姓名的 `TypeError` 失败语义；行为已验证，但距当前注释约定仍有文档缺口。本次没有在冻结产物上手工改写来冒充原运行输出。
4. 正式 1.7.0 的当前构建完整真实规划批次与同构建交付门禁仍未完成，没有合并、打 tag、GitHub Release 或 npm 发布。

## 人工登记边界

此前用户批准的是此计划及执行；尚未登记本最终 commit 的人工审阅或交付确认。后续人工批准只能针对上表最终 commit，并明确保留上述限制，不能自动代表完整发布验收通过。正式发布须另行补齐所有原门禁。

## 本机证据

证据目录：`output/acceptance/formal-170-20261109/canary-measurement/`。

- `delivery-policy-context.json`：原批准及首次失败回执。
- `branch-collision-terminal-domain.json`：修复前完整领域快照。
- `branch-fix-domain-after-install.json`：升级重启后快照，与修复前逐项一致。
- `delivery-worktree-recovery.json`：显式重试、独立验证派发与终态记录。
- `delivery-worktree-recovery-verified.json`：最终 commit、完整 diff、独立测试及限制。
- `delivery-worktree-recovery-terminal-domain.json`：两项任务完成、最终 Review pending 的完整领域快照。

这些本机证据和隔离 home 保留用于后续复验，不属于已发布内容。隔离工作区中的两个旧截断分支仍指向原 `260aecc2de340ae6a557deac153a4153ebffb50a`、`d5bbf64bad16a3c98cb21290395fdfaba3c4cc6d`，没有覆盖历史产物。
