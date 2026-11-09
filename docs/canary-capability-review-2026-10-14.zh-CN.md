# 隔离交付验收：成员能力确认清单

2026-10-15 更新：用户未确认此 13 项清单。本文仅保留原真实规划的历史审阅记录，现场状态以[调整后的修复与确认清单](canary-capability-revision-2026-10-15.zh-CN.md)为准；调整依据见[能力要求分析](canary-capability-adjustment-analysis-2026-10-15.zh-CN.md)。本清单不能作为已获得资格登记授权的依据。

## 审阅对象与实际状态

Host：`http://127.0.0.1:3087`，Project：`ac9fafa7-c07b-4802-a177-6f4c986130bc`。只涉及隔离 greeting 示例，不修改原用户 Host。

最新真实规划 operation：`planning-v3:d2c9ca54-97cf-42e7-a6da-dd6802279c53`。需求、场景、代码绑定与计划审核已完成，2026-10-14 15:49:07 UTC 在 `assignment_qualification` 阻塞。两个任务均为 `abstained-no-eligible`；对应候选成员的实际原因是 `capability-claim-missing`，当前没有任何能力 claim。

该清单由真实 Service 的 `capabilityRequirementDrafts` 和 `assignmentEvaluations` 整理，不以成员名称推定资格。现有成员只有通用字符串声明：实现成员 `implementation/debugging/coding`，测试成员 `testing/regression/verification`。

## 已生成并审核的任务

| 任务 | 拟执行成员 | 允许修改 | 完成标准 |
| --- | --- | --- | --- |
| `TASK-IMPLEMENT` | `default-agent-software-engineer`，职责 `implementer` | `src/greeting.ts`、`tests/greeting.test.ts` | trim 姓名；空或空白输入抛 TypeError；保留既有返回值、导出与签名；增加回归并执行现有 `npm test` |
| `TASK-VERIFY` | `default-agent-test-engineer`，职责 `verifier` | `tests/greeting.test.ts`，按计划仅补强冻结行为断言 | 在实现完成后独立重跑 `npm test`；核对空字符串、单空格、带首尾空白和普通姓名；核对 diff、依赖与接口；发现实现缺陷退回实现任务 |

任务依赖：`TASK-IMPLEMENT → TASK-VERIFY`。实际任务分配必须使用不同 Agent；计划的预检、审批、执行、Integration 和最终验收尚未完成。

## 需要确认的具体能力

以下是 Service 按实际 Binding 和任务推导的能力要求，规则版本 `v3.3.13`。实现成员需前六项，测试成员需全部七项，共 13 个“成员 × 能力”确认事实。

| capabilityId | 本例中的具体含义 | 实现成员 | 测试成员 |
| --- | --- | --- | --- |
| `api.contract` | 保持导出函数名、参数/返回类型和既有调用结果 | 需确认 | 需确认 |
| `data.change` | 对姓名值先规范化，再按规范化结果判断为空 | 需确认 | 需确认 |
| `integration.consumer` | 保持测试对模块的直接导入与调用契约 | 需确认 | 需确认 |
| `language.typescript` | 在现有 TypeScript 文件内完成并核对修改 | 需确认 | 需确认 |
| `reliability.failure-handling` | 空姓名明确抛 TypeError，失败不伪装为成功 | 需确认 | 需确认 |
| `testing.automation` | 使用 node:test、node:assert/strict 与既有 npm test | 需确认 | 需确认 |
| `testing.verification` | 独立执行测试、核对边界与变更范围 | — | 需确认 |

这些含义只描述本例的审阅范围；现有能力定义仍由 Service 控制，不因本表被修改。模型完成规划不能证明执行成员已经具有这些资格。

## 确认后执行的正规流程

1. 在隔离 Profile 的 Agent 配置中补充上述具体 capability 字符串声明，保留原配置。
2. 用正式重新规划入口创建后继运行。Service 自动生成 `legacy_pending_mapping` 的 pending claim，未确认前继续拒绝分配。
3. 依据用户对此清单的明确确认，调用 Project 的 `capability-claims/confirm` 接口；使用实际 pending claimId 与 expectedClaimDigest，保留 actor、reason、清单引用及确认来源，不直接修改 Store。
4. 新规划重新校验资格、访问授权和 TaskPreflight；有新能力要求或资格变化时保留新的待确认事实。
5. 生成可审批计划后展示实际计划与 diff，再进入执行和交付验收。

能力确认记录是人类资格声明，必须得到用户明确确认。此前对真实模型评测的授权仍有效；本次补充确认来自实际缺失的资格记录，不重复索取模型调用许可。完整发布资格另见[验收记录](project-acceptance-2026-10-14.zh-CN.md)。
