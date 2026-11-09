# 隔离发布评测：成员能力确认清单

日期：2026-10-16。范围仅为下列 16 个 ready 规划样本的已创建草稿项目；不派发任务、不修改上游、不部署或发布。8 个 pending 样本不配置执行成员。

此前 greeting 的 9 项确认不适用于本批次。本文件对具体成员在具体项目承担所列能力进行确认，不声称模型已证明成员资质。用户已明确回复“确认这 204 项并登记”，已通过正式接口完成全部登记及持久化复核。新增 204 条 active / human_confirmed 记录；原 pending / legacy_pending_mapping 记录作为来源保留。

登记证据：`output/acceptance/release-capabilities-confirmed-2026-10-16.json`，16 个项目均仍为 draft，未创建规划 operation、Task、审批、Dispatch 或 TaskRun。授权证据为 `request_user_input_async/call_8e6501e61078495cbaf96473185e3976`；三次积压确认均指向同一清单，只登记一次。

## 专用成员

- Release evaluation implementer 2026-10-16：`da6f43df-b9a4-499b-ae1a-d39ae3f51711`；implementer，容量 1，使用本机默认运行环境。
- Release evaluation verifier 2026-10-16：`2ef2743b-5017-4ab1-9853-329cc8c1ca8e`；verifier，容量 1，使用本机默认运行环境。

实现与独立验证为不同成员。两者均需下面列出的项目能力，verifier 另外需要 testing.verification。声明的作用域只限各项目，未列出的能力保持未确认。

冻结 Gold 前已为这 16 个草稿补齐非执行 Reviewer `b6a7f6c6-d2b9-41f0-b1a6-c73007232a16`，仅承担独立规划审阅、autoAssignable=false、无 capability claims。实现和验证成员及本清单的 204 条声明完全不变；核验报告为 `output/acceptance/release-ready-reviewer-prepared-2026-10-16.json`。这项审阅配置不代替下面的人工能力确认。

## 能力与范围依据

各项目基础能力：`api.contract`、`reliability.failure-handling`、`testing.automation`。分别对应公共函数/类型契约、拒绝与异常兼容、自动回归。

| 仓库 | 基础能力以外的项目能力 | 责任证据 |
| --- | --- | --- |
| sindresorhus/p-limit | `language.javascript`、`language.typescript`、`domain.state`、`integration.async` | 包装函数和声明、队列状态计数、清队列拒绝值与在途 Promise。 |
| sindresorhus/p-retry | `language.javascript`、`language.typescript`、`integration.async` | Error/cause 声明、重试计时和取消、同步 hook 与异常优先级。 |
| sindresorhus/p-queue | `language.typescript`、`domain.state`、`integration.async` | TypeScript 公共 getter/选项、等待队列状态、并发/限速下的拒绝和清理。 |
| sindresorhus/p-map | `language.javascript`、`language.typescript`、`integration.async` | JS 引擎与声明、异步迭代及 mapper、overflow/abort/stop 与错误观察。 |
| sindresorhus/ky | `language.typescript`、`integration.async`、`integration.consumer` | TypeScript 错误/选项契约、异步 HTTP 错误与 hooks、fetch 选项边界和消费者。 |
| honojs/hono | `language.typescript`、`integration.async`、`integration.consumer`、`security.authorization` | TypeScript CORS、异步 exposeHeaders、HTTP 响应消费者与 Origin 安全边界。 |
| colinhacks/zod | `language.typescript` | TypeScript schema 参数和出口、局部转换与构造错误；无数据库/持久化要求。 |
| developit/mitt | `language.typescript`、`domain.state` | TypeScript 事件键与载荷、订阅共享状态、同步重入和异常传播；无异步平台要求。 |

能力按每库 A/C 两个样本的责任共同准备：例如 p-limit 的异步能力针对 clearQueue/在途任务，不表示计数 getter 本身新增异步工作；具体任务仍由 Service 根据实际代码写入范围推导。integration.consumer 仅用于 Ky/Hono 的 HTTP 边界，不授予其他库；security.authorization 仅限 CORS 的 Origin 边界。没有数据库迁移、持久化 data.change、发布、浏览器、React/Vue 或运维能力声明。

## 精确项目与待确认记录

| caseId | projectId | 待确认项数（两名成员合计） |
| --- | --- | --- |
| plimit-wrapper-counts | `fe632a4a-01ca-40e2-ba47-107820b75536` | 15 |
| plimit-clear-reason-resolved | `6aaaee2f-4d21-4e19-a035-1acd33dafb98` | 15 |
| pretry-abort-cause | `6a41a661-27b1-483b-8abd-691276f9a190` | 13 |
| pretry-scheduled-hook-resolved | `191a5a66-094c-45da-9e73-4a7222cb0df1` | 13 |
| pqueue-outstanding-count | `572617b2-7e36-473c-8dbd-b6c0dcb736e4` | 13 |
| pqueue-maxqueued-resolved | `3f6339bb-2946-4e28-b7a7-8552c31291df` | 13 |
| pmap-completion-observer | `a31f7b15-d359-4227-bb81-73a2bcd324a8` | 13 |
| pmap-input-bound-resolved | `5c959c58-b0c8-475b-9107-a2166dd2c9d1` | 13 |
| ky-http-error-status | `f39df17c-f2a2-4d2d-ac6b-2274d3fe7ebf` | 13 |
| ky-error-url-policy-resolved | `e27665aa-ee8b-447f-ae63-65de1278e70c` | 13 |
| hono-cors-expose-function | `c139cc01-d0ed-4929-9a56-5872b1c79381` | 15 |
| hono-cors-maxage-policy-resolved | `3c208bf5-eb77-45dc-b91b-83f6c7216c9b` | 15 |
| zod-stringbool-trim | `fe2e485b-b8f3-4d8e-8991-499ad5fb7bc5` | 9 |
| zod-stringbool-overlap-resolved | `f45acad5-36c5-422b-8288-b2996dd4a754` | 9 |
| mitt-listener-count | `672cc618-adea-4ff3-8893-0ae9de91d926` | 11 |
| mitt-once-reentrancy-resolved | `39d62a69-382c-4578-8d59-1e3fc7e67d88` | 11 |

合计 204 条项目限定声明。精确 claimId、capabilityId、成员及 expectedClaimDigest 见 [机器清单](../output/acceptance/release-projects-2026-10-16.json)，SHA256：`de4d0c0342a6525df57cfc1efdafd102b2be08366eb41c4e90681d4126b128d2`。不得登记机器清单以外的成员或能力，不将原来的 9 项确认复制到这些项目。

## 验收与拒绝边界

确认后仍不能凭此宣称正式验收通过。Gold 需冻结确认后的团队摘要，再取得独立审阅；每项至少 5 次 fresh 真实规划、全部失败尝试入 manifest，完整 release gate 退出 0 才通过。若模型要求清单之外的真实能力，保留拒绝原因，不代填、扩大资格或回写已冻结 Gold。

用户于 2026-10-16 已允许本批次不限 token。预算和模型授权继续有效；此处只涉及新的人工能力事实。
