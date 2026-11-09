# 隔离 greeting 新版计划审阅

本材料对应 v50 构建的真实候选计划，尚未登记人工批准或派发任务。随后 v50 质量失败需要修改构建，本计划暂不登记批准；待稳定构建产生新计划后另行审阅。旧计划和旧最终 commit 的批准不计为本计划批准，也不继承旧交付成绩。

| 对象 | 固定值 |
| --- | --- |
| 项目 | `ac9fafa7-c07b-4802-a177-6f4c986130bc` |
| 隔离 Host | `http://127.0.0.1:3088` |
| 规划操作 | `planning-v3:763656a7-cc4d-4bdf-bb45-47c02eba82d8` |
| 项目 revision | `5` |
| planDigest | `49ef698c3c94c3da072200279c63ac75e25947de6bb6e49ebb482746d95c958a` |
| 执行 bundle SHA-256 | `093197292ecf1e873e9a25c7c18de18531fbd14c652540a42911216655bd6174` |
| 重建基线 commit | `77aa9a174da47c111f190d8cc52dfb91c8b00635` |
| 工作区 | `output/acceptance/formal-170-20261109/canary-workspace` |

## 必须实现和验证的结果

- `greet(" Ada ")` 返回 `"Hello, Ada!"`。
- 空字符串和纯空白姓名抛出 `TypeError`。
- `greet("Ada")` 的既有输出保持 `"Hello, Ada!"`。
- 既有 `node:test` 回归包含这些行为，执行仓库原入口 `npm run test`。
- 不新增依赖，不改变导出名、函数签名或测试入口。

## 两项任务

| 任务 | 执行成员 | 允许写入 | 前置条件 |
| --- | --- | --- | --- |
| `TASK-IMPLEMENT`：实现姓名规范化并补充同步回归 | `default-agent-software-engineer` | `src/greeting.ts`、`tests/greeting.test.ts` | 人工批准当前计划；首次写入前核对冻结基线 |
| `TASK-VERIFY`：独立验证行为与冻结交付边界 | `default-agent-test-engineer` | 仅 `tests/greeting.test.ts`；实现文件只读 | 实现任务完成并有可关联证据；再次独立执行测试和差异检查 |

`package.json` 和 `README.md` 禁止修改。验证任务在现有测试充分时不强制产生代码差异。超出双文件范围、签名或依赖变化、验证入口失效、基线不明和职责分离失败均须停止并保留错误。

## 已有证据

真实规划的需求、场景、绑定、计划审核均为 approved；两项成员分配为 selected，两项 TaskPreflight 为 accepted；planningReadiness 与 executionPreparation 均为 ready。原九项项目能力声明逐字核验通过，未新增或扩大能力事实。

本机完整证据：`output/acceptance/formal-170-20261109/canary-recovery/plan-review-config-barrel.json`，原始账本：`canary-recovery/planning-config-barrel.json`。只读捕获再次核验了当前候选、revision、摘要、两项任务、审核、分配及预检，确认没有人工审批、派发、TaskRun 或交付记录。

## 本次批准的含义

批准后，通过正式接口登记此计划的人工审阅，依赖顺序执行上述两项隔离任务，保留真实执行、测试、集成及失败证据。该批准不代表最终 diff 已通过人工审阅；最终交付须以实际 commit 和交付材料再确认。正式发布仍须满足本版全部真实规划与交付门禁。
