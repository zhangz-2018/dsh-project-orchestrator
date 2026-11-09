# 重建 greeting 隔离验收计划审阅

当前状态：真实规划 committed，需求、场景、绑定和计划独立审阅均 approved；两项任务的成员预检均 accepted，规划及执行准备均 ready。尚未登记人工批准，尚未派发任务，不代表交付验收或正式发布通过。

## 审批对象

| 项目 | 固定值 |
| --- | --- |
| 隔离 Host | `http://127.0.0.1:3088` |
| 项目 | `ac9fafa7-c07b-4802-a177-6f4c986130bc` |
| 工作目录 | `output/acceptance/formal-170-20261109/canary-workspace` |
| 重建基线 commit | `77aa9a174da47c111f190d8cc52dfb91c8b00635` |
| 当前规划操作 | `planning-v3:64d3076b-164f-4323-ae54-e1fa8f602afb` |
| Project revision | `3` |
| Plan digest | `3533b9be10e516dd30b9078f70e0189e373617ff81872cc5c3fe66a23cff4e50` |
| Access grant digest | `fceedac3b59e4514e7728e71e985bf8e49f181da8e50cd4ec1d346818dd7b151` |
| 执行 bundle SHA-256 | `1e79fc0f22e7a09e34eb80ab85eb9b28bc2315f2e611112d155417381c8d05b4` |

完整 PlanSnapshot ID 为 `ac9fafa7-c07b-4802-a177-6f4c986130bc:v3:planning-v3:64d3076b-164f-4323-ae54-e1fa8f602afb:plan`；AccessGrantSnapshot ID 为 `access-snapshot:planning-v3:64d3076b-164f-4323-ae54-e1fa8f602afb`。批准必须绑定这些当前事实；任一摘要或 revision 改变须拒绝旧输入。revision 2 的候选未获批准或执行，已通过正式 revise 被当前构建替换，原账本保留。

旧临时环境已经丢失，用户确认无备份。本仓库明确标记为重建基线，不沿用旧计划批准、旧任务结果或旧交付批准。原项目的九条人工能力声明逐项与原登记回执一致，无新增能力事实。

## 原始需求

REQ-TRIM: 在 src/greeting.ts 的 greet(name: string) 中去除姓名首尾空白。AC-TRIM: greet(" Ada ") 必须返回 "Hello, Ada!"。AC-REJECT: 空字符串或只有空白的姓名必须抛出 TypeError。AC-COMPAT: greet("Ada") 的既有输出保持 "Hello, Ada!"。在 tests/greeting.test.ts 增加这三个行为的自动回归验证，执行仓库已有的 npm test。只允许修改 src/greeting.ts 和 tests/greeting.test.ts，不新增依赖，不改变导出名或函数签名。实现任务和独立验证任务分别交由实现成员与测试成员。

技术设计保持现有无依赖 TypeScript 模块与 node:test，代码 owner 为 `src/greeting.ts`，回归 owner 为 `tests/greeting.test.ts`。

## 实现与验证

| 任务 | 执行成员 | 修改范围 | 先决条件 |
| --- | --- | --- | --- |
| `TASK-IMPLEMENT` | `default-agent-software-engineer` | 源文件和测试文件 | 批准本计划并核对重建基线 |
| `TASK-VERIFY` | `default-agent-test-engineer` | 仅测试文件；只读检查源文件 | 实现任务完成并提供证据 |

实现成员在首次写入前记录基线 commit、文件状态和实际基线测试结果。实现先 trim，再对空结果同步抛出 TypeError；不增加其他输入类型或错误消息约束。保留正常 Ada 用例，新增首尾空白、空字符串、三个 ASCII 空格的三个独立同步回归。两个拒绝用例分别使用 `assert.throws` 检查 TypeError。通过仓库确认入口 `npm run test` 实际执行四个用例，保留命令、退出码、实现版本和逐项结果。

独立验证成员核对基线与本次计划关联，重新执行相同入口，复核四个用例、TypeError 断言、函数签名、命名导出和完整差异。可在测试文件内修正冻结要求的回归；生产实现有缺陷时退回实现成员。两成员分离，不通过新增报告文件绕过两文件修改边界。

两项任务均禁止修改 `README.md`、`package.json`，不新增依赖或替代框架。证据写入正式执行记录，发现基线不符、范围外变更、必需用例未执行或验证入口失败时保留失败并停止推进。

## 已有证据与批准边界

本机完整证据：`output/acceptance/formal-170-20261109/canary-recovery/planning-script-tool-closure.json`，包含原请求、完整快照、场景、任务、成员资格、预检与 readiness。只读即时复核记录为同目录的 `plan-review-script-tool-closure.json`，确认四项审阅均 approved、两项预检 accepted、readiness 均 ready，且无审批、派发、执行或交付记录。原候选 `planning-preserved-contract.json` 与原兼容策略拒绝记录 `planning-handoff-reservations.json` 均保留，没有覆盖。

批准本文件表示允许正式登记当前 revision 3 计划的人工批准，并依赖顺序派发本隔离项目的实现与独立验证。它不等于批准尚未产生的最终 diff，不批准向上游仓库提交，也不代表满足 npm/GitHub 正式发布门禁。最终交付须依据实际 commit、验证和收敛审阅另行确认。
