# 隔离 greeting 交付：实际计划审批材料

日期：2026-10-15（Asia/Shanghai）。这是用户已批准的真实计划及执行记录，不替代最终交付确认。

## 已验证的状态

用户确认的 9 项能力已通过正式接口登记为 `human_confirmed / active`。新真实规划 `planning-v3:59ca03a4-22a8-4960-b2ce-e906ad525c2d` 于 2026-10-15 01:01:00 完成，状态为 `committed`，无阻塞诊断。需求、场景、Binding、Plan 四类审核均为 approved；两个任务选择了不同成员，两个 TaskPreflight 均为 accepted。当前规划 readiness 和执行准备均为 ready，无未收口存储 Intent。

审批材料生成时，项目状态为 `awaiting_approval`，revision 为 2，尚无 PlanApproval、ExecutionDispatch 或 TaskRun。随后用户明确回复“批准该计划并执行隔离验收”，已通过正式接口登记该 revision 的审批（幂等键 `canary-user-approved-plan-2026-10-15`）。实现任务已完成实际测试及 Integration；独立验证已通过正式 Dispatch 派发。最终结果见验收记录。

## 审批对象与执行范围

仅适用于 `127.0.0.1:3087` 的隔离项目 `ac9fafa7-c07b-4802-a177-6f4c986130bc`。仓库为 `/var/folders/jk/342x3ttd0hv15q3c5l7z0vrm0000gn/T/po-certified-acceptance-EiDNyF/workspaces/greeting`，基线 commit 为 `6c046d7e11150f45ac9767146708663614803a1f`。原用户 3080 Host 不在执行范围内。

| 任务 | 实际执行者 | 依赖 | 允许修改 |
| --- | --- | --- | --- |
| `TASK-IMPLEMENT`：实现姓名规范化并补齐三个行为回归 | `default-agent-software-engineer` | 无 | `src/greeting.ts`、`tests/greeting.test.ts` |
| `TASK-VERIFY`：独立验证行为边界与技术约束 | `default-agent-test-engineer` | `TASK-IMPLEMENT` 成功交付 | `tests/greeting.test.ts`；生产实现只读 |

批准后按 DAG 顺序派发，实现成功后再派发独立验证。执行使用已授权的 `pockapi / gpt-6.1-sol`；由正式执行接口管理隔离 worktree、实际测试、输出 commit、Integration 和 Convergence。遇到范围外修改、测试失败或交付不一致时保留失败记录并修复，不代填通过。

## 原始需求与验收对应

| 原始要求 | 实现交付 | 独立验收 |
| --- | --- | --- |
| `greet(" Ada ")` 返回 `"Hello, Ada!"` | 对姓名先 trim，使用规范化姓名构造输出 | 独立执行严格返回值断言 |
| 空字符串和纯空白姓名抛出 `TypeError` | 对 trim 后为空的姓名抛出指定异常 | 分别断言空字符串和三个普通空格的异常类型；检查实现涵盖纯空白输入 |
| `greet("Ada")` 兼容原输出 | 保留问候格式、导出名及 `greet(name: string): string` 签名 | 重跑既有回归并检查签名和最终 diff |
| 自动回归、无新增依赖、仅两个指定文件 | 保留 node:test、node:assert/strict、直接导入 greet；执行既有 `npm test` | 重新实际执行 `npm test`，对照基线检查文件、依赖及模块方式 |
| 实现与验证不同成员 | 实现分配给 Software Engineer | 验证分配给 Test Engineer，检查实际 TaskRun 执行者不同 |

生成的 `AC-001` 将同段落中的三个行为保留在一个对象内，以满足一个 requiredDisposition source anchor 仅消费一次的规则；任务验收仍明确分别要求 AC-TRIM、AC-REJECT、AC-COMPAT 回归，没有删除原始要求。`AC-002` 保留技术方式与归属约束。

## 需要正式登记的审批身份

以下值来自实际已提交计划，执行前会重新校验 revision、摘要、资格、权限及仓库基线；任何漂移均拒绝，不使用旧审批覆盖新计划。

| 字段 | 实际值 |
| --- | --- |
| `planSnapshotId` | `ac9fafa7-c07b-4802-a177-6f4c986130bc:v3:planning-v3:59ca03a4-22a8-4960-b2ce-e906ad525c2d:plan` |
| `planDigest` | `c20c582140872c834b124e78dc3240f9f03259c1924e2767474dc9fd31d038b4` |
| `projectRevision` | `2` |
| `accessGrantSnapshotId` | `access-snapshot:planning-v3:59ca03a4-22a8-4960-b2ce-e906ad525c2d` |
| `accessGrantDigest` | `e98db7f85b7d023f707e8be1cb71a1ca670a6f2d297dda3ebda43668e40d35b4` |

用户已明确回复“批准该计划并执行隔离验收”。该确认针对上述计划审批及其两个任务的正式派发、测试、集成和收敛；不替代最终 diff 的人工交付确认，也不扩大到部署、发布或其它仓库评测。

需要具体审批是因为正式接口将保存 `approverId`、`planDigest` 和 `projectRevision` 的批准事实；此前“确认这 9 项并登记”只针对成员资格。用户 AGENTS.md 要求“不编造执行记录、引用、路径行号、测试结果或根因”，因此不能将资格确认写成对未审阅计划或最终交付的人工批准，必须分别保留资格、计划及最终交付事实。

## 证据与剩余发布工作

正式接口只读采集及字段校验已执行：`scripts/capture-canary-plan-review.mjs`。完整审阅数据为 `output/acceptance/canary-plan-review-ready-2026-10-15.json`，包含原始来源、分析、场景、Binding、实际任务、四类审核、分配、预检、可信资格、readiness 和精确审批输入。能力登记证据为 `output/acceptance/canary-capabilities-confirmed-2026-10-15.json`；实际规划日志为 `output/acceptance/real-planning-confirmed-capabilities-2026-10-15.log`。

本次真实规划成功只覆盖 greeting 示例。后续两个任务真实执行、技术验收、最终人工批准、交付确认及 V2 release canary 已闭合，见[最终交付材料](canary-delivery-review-2026-10-15.zh-CN.md)。整体验收仍需 V2 评测 candidate 导出与首次模型调用前冻结输入、8 个仓库/24 条独立审阅 Gold 及至少 120 次有效真实规划，最终正式 release gate 退出 0。尚未用 fixture 或本例的 V1 导出替代这些证据。

关联：[能力登记与修复](canary-capability-revision-2026-10-15.zh-CN.md)、[项目验收记录](project-acceptance-2026-10-14.zh-CN.md)。
