# 发布评测能力补充清单：完整 48 项

日期：2026-10-16。原 204 条已按用户确认正式登记；本清单 48 条仍为 pending / legacy_pending_mapping，未登记 human_confirmed。范围只限同一隔离 Host、下列原有 12 个项目及两名原成员，不派发任务、不批准计划、不发布。

本清单包含此前 [p-limit 4 项补充](release-capability-addendum-2026-10-16.zh-CN.md)，不是另加 48 项。确认本完整清单即可，无须重复确认子清单；若仅确认原 4 项，不能据此登记其余 44 项。

## 为什么需要补充

现行 `src/planning/binding-stage.ts` 和 `src/workflow.ts` 的 `v3.3.14` 规则区分影响面与执行面：`shared_data` 包含跨调用共享内存状态和数据模型契约，映射到 `data.change`；`integration_boundary` 包括无 HTTP 的异步消费者，映射到 `integration.consumer`；实际状态生命周期映射到 `domain.state`。此前 204 项清单对这些责任准备不足。不会改写正确 Binding、取消必要能力或降低门槛以取得通过。

p-limit 包装计数已有真实规划记录证明其中 4 项缺口。为避免逐项补问，另对全部 8 仓库、16 个 ready 规范做了一次独立真实模型能力预检，输入包括固定源码、原始 PRD、现行派生规则和已确认能力。该预检只提供声明准备依据，不是正式规划候选，不计入 125 次要求，也不证明成员已经具备能力。

预检证据：`output/acceptance/release-capability-gap-preflight-2026-10-16/summary.json`，8/8 仓库完成、16/16 条目完整。Ky 报告中对成员角色映射的未知，已通过正式项目 membership 核实：实现者与验证者角色分别属于下面两名成员，原 204 项包含验证者的 testing.verification，不新增这项资格。该次预检未对 Hono 和 Zod 提出补充。后续 v12 Gold 审阅暴露 Zod 能力分歧，专项源码审阅后另准备 4 项，见[52 项合并清单](release-capability-addendum-52-2026-10-16.zh-CN.md)。本文件原 48 项及对应机器清单保持不变。

预检按两个角色均可承担原规范列明的实现/测试文件有限维护范围计算，48 项是这项范围下的资格准备建议，不是 16 个实际候选已经证明的最小必需集合。后续任务可以选取更窄的验证写入范围，Service 仍按实际 ownership 派生能力，不能因为预先确认了能力就扩大任务写入范围。仅 p-limit 包装计数中的 4 项已有完整真实规划直接证明缺口，其余来自独立预检的源码分析。

## 精确成员与项目范围

- 实现成员：Release evaluation implementer 2026-10-16，`da6f43df-b9a4-499b-ae1a-d39ae3f51711`，implementer。
- 独立验证成员：Release evaluation verifier 2026-10-16，`2ef2743b-5017-4ab1-9853-329cc8c1ca8e`，verifier。

下表每个 capabilityId 分别由这两名成员承担一条项目限定声明。例如两项能力 × 两名成员 = 4 条。

| caseId | projectId | 本项目两名成员各需补充 | 条数 |
| --- | --- | --- | --- |
| plimit-wrapper-counts | `fe632a4a-01ca-40e2-ba47-107820b75536` | `data.change`、`integration.consumer` | 4 |
| plimit-clear-reason-resolved | `6aaaee2f-4d21-4e19-a035-1acd33dafb98` | `data.change`、`integration.consumer` | 4 |
| pretry-abort-cause | `6a41a661-27b1-483b-8abd-691276f9a190` | `integration.consumer` | 2 |
| pretry-scheduled-hook-resolved | `191a5a66-094c-45da-9e73-4a7222cb0df1` | `data.change`、`domain.state`、`integration.consumer` | 6 |
| pqueue-outstanding-count | `572617b2-7e36-473c-8dbd-b6c0dcb736e4` | `data.change`、`integration.consumer` | 4 |
| pqueue-maxqueued-resolved | `3f6339bb-2946-4e28-b7a7-8552c31291df` | `data.change`、`integration.consumer` | 4 |
| pmap-completion-observer | `a31f7b15-d359-4227-bb81-73a2bcd324a8` | `data.change`、`domain.state`、`integration.consumer` | 6 |
| pmap-input-bound-resolved | `5c959c58-b0c8-475b-9107-a2166dd2c9d1` | `data.change`、`domain.state`、`integration.consumer` | 6 |
| ky-http-error-status | `f39df17c-f2a2-4d2d-ac6b-2274d3fe7ebf` | `data.change`、`domain.state` | 4 |
| ky-error-url-policy-resolved | `e27665aa-ee8b-447f-ae63-65de1278e70c` | `data.change`、`domain.state` | 4 |
| mitt-listener-count | `672cc618-adea-4ff3-8893-0ae9de91d926` | `data.change` | 2 |
| mitt-once-reentrancy-resolved | `39d62a69-382c-4578-8d59-1e3fc7e67d88` | `data.change` | 2 |

合计 48 条。精确 claimId、expectedClaimDigest、项目、成员、能力、源码路径与逐项理由见仅原验收机器保留的机器清单 `output/acceptance/release-capability-addendum-48-2026-10-16.json`（路径从仓库根目录计算，不随源码或 npm 包分发）。SHA256：`38753a03c6ba7d1ba8473381acea78a7e067a518478cb6a011a0da8b19ccd056`。

## 责任依据

| 规范组 | 补充责任 |
| --- | --- |
| p-limit | 共享 limiter 的队列和计数、Promise 结果与拒绝、清空与在途任务兼容性。 |
| p-retry AbortError | 异步重试链向消费者抛回同一 originalError，不仅是同步构造。 |
| p-retry hook | attempt/retry budget、delay 和取消生命周期、共享上下文与 AbortSignal、异步等待和清理。 |
| p-queue | 跨提交共享队列、计数和限速状态，以及事件时序、异步 add/addAll 和拒绝消费者。 |
| p-map | 并发 runner 共享的索引、结果、错误及终态；异步 iterator/mapper、溢出与清理消费者。 |
| Ky | HTTPError.response 的可变对象状态与实时 getter；实例 defaults、内部 options 和跨 hook 的冻结快照。 |
| Mitt | emitter 跨调用共享 Map/订阅列表，计数、一次订阅和重入删除；同步本地调用不额外要求 integration.consumer。 |

登记前后仍保留原 204 项信任事实；只通过正式确认接口登记本清单项目限定记录。新补充不是生产数据修改或执行授权，不能据此创建任务派发。用户确认后还要独立冻结修后 ready Gold、完成真实重复规划和最终 release gate，不能凭声明登记宣称验收通过。

登记脚本为 `scripts/confirm-release-capability-addendum.mjs`，默认仅做只读预检，已核实 48 项 digest、成员角色、能力定义版本、12 个草稿项目及没有任务执行。只有收到对完整 48 项的明确确认后才允许使用 `--apply`；本轮尚未执行该写入参数。
