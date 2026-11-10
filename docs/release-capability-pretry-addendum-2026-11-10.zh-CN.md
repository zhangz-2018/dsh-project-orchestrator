# p-retry 隔离验收能力补充清单

日期：2026-11-10。状态：用户已明确回复“确认这 4 项并登记”；4 条对应的 `human_confirmed/active` 声明已通过正式接口登记并只读复核，原 pending 记录及原 256 项确认保留。

## 范围与原因

仅限隔离项目 `6a41a661-27b1-483b-8abd-691276f9a190`，需求为 p-retry `AbortError.cause` 公开契约与原错误身份、立即终止重试的回归保护。仓库固定 commit 为 `1472907affe8d6107aba5884abc36d6361b3042e`；允许写入仍仅为 `index.js`、`index.d.ts`、`test.js`、`index.test-d.ts`。

原 204 + 52 条确认完整保留。两名成员的通用 capability 标签已经包含下述能力，但此项目没有对应的 active 可信声明；标签不能代替项目限定确认。真实后继规划在 `assignment_qualification` 正确拒绝分配，没有派发任务。

本次不以降低能力要求取得通过。现行 `v3.3.14` 规则将公开数据模型契约归为 `shared_data`，映射为 `data.change`；源要求保留的重试终止控制状态映射为 `domain.state`。这并不声称目标使用数据库或持久化状态机，也不授权改动原重试算法。实现者需维护该契约，验证者需独立验证它。绑定与所需能力已保存在本机 `output/acceptance/formal-170-20261109/ready-qualification-diagnostics.json` 和停机快照中。

现有隔离领域库已存在以下 4 条 `legacy_pending_mapping/pending` 记录。登记前只读核对 Schema 及完整内容摘要；收到用户具体确认后，正式接口新增相应 active 声明，不覆盖原 pending 记录。

## 本次确认成员

- Implementer：`Release evaluation implementer 2026-10-16`，Agent ID `da6f43df-b9a4-499b-ae1a-d39ae3f51711`。
- Verifier：`Release evaluation verifier 2026-10-16`，Agent ID `2ef2743b-5017-4ab1-9853-329cc8c1ca8e`。

## 4 条声明

能力定义版本均为 `1`。确认时必须逐条匹配 claimId 和 expectedClaimDigest；任一内容或成员发生变化时停止登记，不沿用本清单。

| 成员职责 | capabilityId | 本项目职责 |
| --- | --- | --- |
| implementer | `data.change` | 为公开 AbortError 数据契约补充 cause，并保持与 originalError 的对象身份一致；不扩大公开类型约束。 |
| implementer | `domain.state` | 维护 AbortError 触发后立即终止当前重试调用、保留原错误身份且不执行后续回调或重试的状态不变量。 |
| verifier | `data.change` | 独立核对公开声明、运行时构造及两种输入分支的 cause/originalError 关系。 |
| verifier | `domain.state` | 独立验证尚有重试预算时首轮 AbortError 仍只执行一次，最终拒绝原错误且后续回调不被调用。 |

### Implementer / data.change

claimId：`capability-claim:6a41a661-27b1-483b-8abd-691276f9a190:da6f43df-b9a4-499b-ae1a-d39ae3f51711:data.change`

expectedClaimDigest：`660a3a3a9bdb4f24aa31520ea5738fbf76061045d13559191e8143b2e7472d8e`

### Implementer / domain.state

claimId：`capability-claim:6a41a661-27b1-483b-8abd-691276f9a190:da6f43df-b9a4-499b-ae1a-d39ae3f51711:domain.state`

expectedClaimDigest：`f52107c2c412082e92a476cd084efe411e360191713f685bb352700c14141b07`

### Verifier / data.change

claimId：`capability-claim:6a41a661-27b1-483b-8abd-691276f9a190:2ef2743b-5017-4ab1-9853-329cc8c1ca8e:data.change`

expectedClaimDigest：`4c3b1697232434ad4262dad679f871a62cd69d1c2ba1d9aa8ff0c426a6fb9966`

### Verifier / domain.state

claimId：`capability-claim:6a41a661-27b1-483b-8abd-691276f9a190:2ef2743b-5017-4ab1-9853-329cc8c1ca8e:domain.state`

expectedClaimDigest：`5bc066eb39bc1a8ef82da1844833318c04075d261b254b765c7f06c90874d92d`

## 确认含义

确认表示用户认可以上两名原成员在本项目承担所列能力，并允许通过正式接口将这 4 条记录登记为 `human_confirmed/active`。不扩展到其他项目，不批准具体计划，不派发任务，不替代最终交付审阅。真实模型评测及发布的既有授权继续按原范围有效。

需要具体确认，是因为登记结果属于人工能力事实。用户提供的 AGENTS.md 要求“不得靠名称、Persona 或模糊匹配虚构执行能力”；接口的 `human_confirmed` 也不能由模型审阅或“帮我修复”推定。p-queue 的代码修复与复验不依赖这次确认，继续执行。

## 登记结果

本会话 `call_f4adba6fcd6840d993afa0e2f261207c` 的用户回复提供了本清单的明确授权。`scripts/confirm-release-pretry-capabilities.mjs` 先完成只读预检，再调用单一项目的正式批量确认接口。

接口已成功写入 4 条声明及正常的 `project.capability_claim_confirmed` 审计活动。首次本地后置核验将该正常审计活动误当作越界变更而中断；修正校验后使用 `--observe-confirmed` 仅查询已登记结果，没有重发确认请求。最终逐条核对项目、成员、能力、确认来源和证据引用，原 256 项声明及全部旧 pending 声明均保持一致。回执为本机 `output/acceptance/formal-170-20261109/pretry-capabilities-confirmed.json`，状态 `confirmed_and_persisted`。

新版本独立 Gold 审阅已核对这些 active 声明并批准；真实规划仍需另行验证。没有批准计划、任务派发或最终交付。
