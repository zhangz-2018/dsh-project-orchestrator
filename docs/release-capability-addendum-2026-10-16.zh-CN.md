# 发布评测能力补充清单：p-limit 包装计数

日期：2026-10-16。原 204 条声明已按用户确认正式登记，本补充未确认、未登记，不扩大原授权。

后续完整预检形成了[合并 48 项清单](release-capability-addendum-complete-2026-10-16.zh-CN.md)，其中已包含本文件 4 项。确认合并清单无需重复确认本子集；本文件的确认范围仍严格限于以下 4 项。

## 实测原因

隔离项目 `fe632a4a-01ca-40e2-ba47-107820b75536`，case `plimit-wrapper-counts`，真实 operation `planning-v3:217cad24-4bb4-480f-b29c-78865b497680` 已通过需求、场景、Binding 和 Plan 审阅，最终因能力不足拒绝分配。

Binding 将跨调用共享的 limiter 闭包状态认定为 `data.capabilitySurface=shared_data`，将 Promise 和异步调度消费者认定为 `consumer.capabilitySurface=integration_boundary`。现行 Service 规则 `v3.3.14` 分别要求 `data.change`、`integration.consumer`；共享数据不要求数据库持久化。此前清单将“没有持久化”作为不需要 data.change 的依据，不符合这项现行规则。不能通过篡改 Binding、删除必要能力或绕过分配门禁修饰成通过。

来源：`planning-evals/cases/plimit-wrapper-counts/runs/fresh-1.json`；正式 API `/snapshot` 中对应 `requirementCodeBindings`、`capabilityRequirementDrafts`、`assignmentDrafts`、`assignmentEvaluations`。失败保留在 `release-scenario-evidence-2026-10-16` 批次中。

## 精确补充范围

以下 4 项全部仅限上述项目，不包含其他 15 个项目。成员不变，不派发任务，不批准计划，不发布。

| 成员 | agentId | capabilityId | 具体责任 |
| --- | --- | --- | --- |
| Release evaluation implementer 2026-10-16 | `da6f43df-b9a4-499b-ae1a-d39ae3f51711` | `data.change` | 维护共享 limiter 状态的读取契约及相关自动回归，保持单一队列和原有计数写入路径。 |
| Release evaluation implementer 2026-10-16 | `da6f43df-b9a4-499b-ae1a-d39ae3f51711` | `integration.consumer` | 保持 Promise 消费、异步提交、清空和拒绝观察边界。 |
| Release evaluation verifier 2026-10-16 | `2ef2743b-5017-4ab1-9853-329cc8c1ca8e` | `data.change` | 独立验证共享状态计数与清空场景，不修改持久化数据或引入第二数据源。 |
| Release evaluation verifier 2026-10-16 | `2ef2743b-5017-4ab1-9853-329cc8c1ca8e` | `integration.consumer` | 独立验证异步消费者、Promise 结果和拒绝传播兼容性。 |

用户确认这 4 项后，允许通过正式接口准备 pending 映射并登记 human_confirmed，逐项核对精确项目、成员、能力和持久化结果。其他项目若出现真实能力缺口，继续保留拒绝，不据此复制这 4 项授权。原 204 项能力事实和不限 token 模型评测授权继续有效。
