# 隔离验收：能力要求修复与调整后的确认清单

日期：2026-10-15。Project：`ac9fafa7-c07b-4802-a177-6f4c986130bc`。仅适用于 `127.0.0.1:3087` 的隔离 greeting 示例。

## 当前状态

能力语义修复已实施，最终源码完整回归通过：450 项 Node 测试、6 项浏览器测试、fixture 评测及包烟测全部通过。隔离 Host 已重装，源码与安装 bundle 的 SHA256 一致。确认前的真实模型规划已通过需求、场景、Binding 及 Plan 四类审核，实际要求为实现 4 项、验证 5 项；当时在资格阶段因缺少可信确认阻塞。用户现已明确回复“确认这 9 项并登记”，9 项资格已通过正式接口登记并核对持久化结果。本文件不代表整体验收通过。

原 13 项清单未获确认，历史 operation 保留。规则为 `v3.3.14`。正式确认前核对了 9 项 pending claim 的 ID、version 1、摘要及 active definition；2026-10-15 00:56:10（Asia/Shanghai）正式批量接口登记了 9 项 `human_confirmed / active` 资格。随后通过正常 `/decompose` 接口启动新 operation `planning-v3:59ca03a4-22a8-4960-b2ce-e906ad525c2d`，重新审核、分配与预检，不复用历史阻塞结果。新运行于 01:01:00 成功提交，四类审核 approved、两个成员分别 selected、两个 TaskPreflight accepted，无阻塞诊断。

## 修复内容

新增 `capabilitySurface`，在保持 14 个影响维度完整的同时，区分调用时值转换、共享数据、本地调用及集成边界。新规划的 required data、consumer 必须给出有证据的分类；缺失、未知、错误维度和与状态/异步事实矛盾时拒绝。

`call_value` 不额外推导 `data.change`，`local_call` 不额外推导 `integration.consumer`。共享数据、真实集成与历史未分类证据保留原要求。验证任务的继承使用相同分类规则；显式创建/清理持久化 fixture 仍要求数据资格。规则版本为 `v3.3.14`。

分类随 Binding 持久化、摘要与复用保存。独立 Binding Review 接收再次校验后的冻结源码，核对分类及目标行为；截断源码不能证明省略内容。Binding Review 版本为 `binding-review-v3.3.17`，Plan Review 为 `plan-review-v3.3.9`。旧审核不能跨版本复用，旧缺分类记录不能冒充新分类输入。

本次修改能力要求的适用条件，没有发布或缩窄 CapabilityDefinition，也没有升级任何可信 claim。受控能力定义的详细语义与版本管理仍是后续发布工作，不能用本例说明替代全项目能力注册标准。

## 已确认并登记的 9 项声明

下表是本例中每项资格需要覆盖的具体工作；确认范围为此隔离项目，不是对成员在所有项目中的资格背书。

| capabilityId | Software Engineer（implementer） | Test Engineer（verifier） |
| --- | --- | --- |
| `language.typescript` | 修改现有 TypeScript 函数与回归文件，保持导出名和签名 | 阅读 TypeScript 实现并维护测试断言 |
| `api.contract` | 保持公开函数调用兼容，满足 trim 与既有输出契约 | 独立核对函数签名、trim、空值拒绝与普通姓名兼容 |
| `reliability.failure-handling` | 空字符串和纯空白抛出 TypeError | 对两类拒绝输入核对确切异常类型 |
| `testing.automation` | 使用既有 node:test 入口增加回归，不新增依赖 | 重跑既有 npm test，必要时补强可执行回归断言 |
| `testing.verification` | 不要求 | 独立检查实际 diff、测试结果及文件/依赖边界 |

只允许修改 `src/greeting.ts`、`tests/greeting.test.ts`。两项任务须分配不同执行者。没有数据库、共享状态或外部集成职责；若新真实审核发现这些事实，则不能沿用该清单。

## 正式登记与后续操作

已通过 `POST /projects/ac9fafa7-c07b-4802-a177-6f4c986130bc/capability-claims/confirm` 正式登记，并确认返回记录与持久化记录一致。执行脚本为 `scripts/confirm-canary-capabilities.mjs`，证据为 `output/acceptance/canary-capabilities-confirmed-2026-10-15.json`，包含原回复引用、预期摘要及实际可信 claim。登记后项目仍为 draft，没有因此自动审批或派发。新 operation 已通过审核、资格与预检，项目进入 awaiting_approval，revision 2；规划与执行准备 readiness 均为 ready，无未收口存储 Intent。计划审批、执行、Integration、Convergence 及最终交付确认仍分别进行，不以资格确认替代。完整审阅数据为 `output/acceptance/canary-plan-review-ready-2026-10-15.json`，具体方案见[实际计划审批材料](canary-plan-approval-2026-10-15.zh-CN.md)。

之所以需要针对该清单的确认，是用户 AGENTS.md 要求“不得靠名称、Persona 或模糊匹配虚构执行能力”，且接口将登记 `human_confirmed`。此前真实模型调用授权继续有效，不需要重复授权。

## 证据与剩余门禁

修前回归：`output/acceptance/capability-surfaces-before-2026-10-15.log`。待审核声明准备记录：`output/acceptance/canary-pending-declarations-2026-10-15.json`。最终完整验证：`output/acceptance/verify-capability-surfaces-certified-2026-10-15.log`（退出 0）。安装核对：`output/acceptance/installed-bundle-capability-surfaces-2026-10-15.json`，bundle SHA256 为 `1d8e732fd7d5e9f8e749950cb37ff991b98aa3849a3eedb82fc3bc253c488cfd`。

真实模型新规划日志：`output/acceptance/real-planning-capability-surfaces-observation-2026-10-15.log`；operation 为 `planning-v3:51f72101-fb49-4d57-a447-7f8d028cc2d1`，于 2026-10-14 16:36:07 UTC 在 `assignment_qualification` 终止为 blocked。两个任务均为 `abstained-no-eligible`，候选原因是未确认的能力声明，Project 回到 draft。

确认前正式 API 只读导出的完整审核证据：`output/acceptance/canary-capability-review-revised-2026-10-15.json`，包含实际能力要求、分类后的 Binding、四类审核、候选拒绝原因、9 项 pending claim 的 ID/版本/摘要及模型 provenance。该历史时点没有可信 claim、计划审批或 Dispatch；后续可信登记另存上述确认记录，历史证据不改写。CLI 历史 V1 导出仅用于契约核对，不能算作 V2 发布资格。

最新正式 CLI 导出为 `output/acceptance/greeting-run-4-candidate-v1.json`，`validatePlanningCandidate` 校验通过，包含本次 real_model blocked 结果。实现/验证成员的实际拒绝原因均为 `capability-claim-untrusted`，证明 pending 声明未越过可信来源门禁。终态 readiness 的 storage_consistent 为 ready，运行期间短暂 pending 的 checkpoint intent 已正常提交，没有遗留恢复项。

启动时先尝试了 runner 的 `--start-on-resume`，该选项只允许没有历史 operation 的项目，因此在本项目被工具自身拒绝，未产生新 operation。随后使用正常 `/decompose` 接口得到 202，再用只观察的 `--resume` 跟踪；该工具拒绝日志保留，不计作模型运行或通过记录。

正式发布门禁最近执行仍退出 1，缺 release manifest、8 仓库/24 独立需求及完整交付 canary。V2 导出与首次模型调用前冻结输入的实现仍未闭合，不能把 fixture 回归计作 120 次有效真实评测，也不能以此清单登记伪造的发布通过记录。

## 影响范围与恢复

源码修复影响所有新 V3 Binding 分类及任务能力推导，尚只在隔离 greeting 仓库运行真实对照；数据库、集成、历史记录和未知分类另由回归覆盖，不宣称其真实模型质量已通过。原用户 3080 Host 没有重装、部署或发布。

如需撤回隔离安装，可停止确认后的 3087 进程并重装保留的 `dsh-project-orchestrator-1.7.0-preflight-inline-fix.tgz`，不要重置仓库或删除历史 operation。代码回滚不会撤销新声明与审核事实；Agent 声明的原值保存在准备记录，可通过正式更新接口恢复。9 项可信资格已登记，撤销需要通过正式资格接口保留历史，不能删除记录或以代码回滚冒充撤销。

关联：[能力要求分析](canary-capability-adjustment-analysis-2026-10-15.zh-CN.md)、[项目验收记录](project-acceptance-2026-10-14.zh-CN.md)。
