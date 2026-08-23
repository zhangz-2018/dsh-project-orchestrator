# 整改复合预期审查记录

版本：Review 1

审查日期：2026-02-14

关联文档：[整改 PRD](remediation-prd.zh-CN.md) | [整改技术方案](remediation-technical-design.zh-CN.md)

## 1. 结论

当前改造**部分符合预期，但不能关闭整改验收，也不能据此宣称稳定版**。

已完成的内容主要集中在正常执行路径、workspace claim 的基本统一、顺序幂等冲突校验和基础故障注入测试。尚未满足的内容集中在：

- TaskRun 终态 ownership 的原子性；
- Project TaskRun 的取消和终态收敛；
- Command/External Trigger 首次请求的并发 reservation；
- lease 尚未落盘时的清理失败恢复记录；
- 重启时 lock/lease 的 owner 判断和 Git 清理超时；
- 发布 workflow 的可解析性和发布门禁完整性。

此前 `typecheck`、完整测试 `131/131`、docs smoke、package smoke 和 production dependency audit 均通过，但这些结果不能证明上述并发竞态和重启恢复条件已满足。

## 2. 审查范围与依据

审查依据：

- `docs/remediation-prd.zh-CN.md`；
- `docs/remediation-technical-design.zh-CN.md`；
- 当前 `src/service.ts`、`src/types.ts`、`tests/service.test.mjs`；
- 当前 `.github/workflows/ci.yml` 和 `.github/workflows/release.yml`；
- 当前已获得的本地验证结果。

审查重点：

1. TaskRun 终态是否只能由当前 owner 原子写入；
2. stop、reassign、late Agent result、failure 是否会互相覆盖；
3. Project 和 Issue 是否共享完整 workspace 生命周期；
4. claim、cleanup、restart recovery 是否可补偿、可恢复、可观测；
5. 幂等 key 是否在首次请求竞争下仍然只执行一次；
6. PDF reservation 和发布门禁是否具有确定性证据。

## 3. 已满足或基本满足

### 3.1 Project/Issue workspace dispatch 基本统一

`src/service.ts` 已提供 `claimTaskRun(id, kind)`，Issue 和 Project 均通过该路径选择 Resource、校验 Runtime 和 Agent capacity、获取 in-place lock 或创建 worktree，并写入 workspace lease。

Project Agent 与测试命令使用 claimed workspace 的正常路径已有回归测试：

- `tests/service.test.mjs`：`Project execution passes the claimed worktree to Agent and verification command`；
- `tests/service.test.mjs`：`worktree TaskRun creates isolated branch, captures Git evidence, and cleans workspace`。

结论：满足“正常路径复用 workspace”的主要要求，但 Project 终态 ownership 和取消竞态仍未满足。

### 3.2 顺序幂等冲突校验已实现

当前代码已计算 Command `requestDigest`，并对同一 idempotency key 的不同请求返回 `command-idempotency-conflict`；External Trigger 也已比较 `payloadDigest` 并返回 `external-trigger-conflict`。

已有测试覆盖顺序执行下的不同 payload：

- `command idempotency keys reject different request payloads`；
- `external trigger keys reject different command payloads`。

结论：顺序语义基本满足；首次并发 reservation 尚未满足。

### 3.3 基本 claim compensation 已测试

已有测试覆盖：

- in-place lock 已写入、active lease 写入失败时释放 lock；
- worktree 创建后 active lease 写入失败时删除 worktree。

结论：成功清理路径满足基本要求；清理本身失败且 lease 尚未落盘的 durable recovery 尚未满足。

### 3.4 PDF reservation 的代码结构基本正确

PDF import 的容量检查和 operation 登记已经放入 `serializedMutation()`，并在导入结束、异常或取消路径通过 `finally` 释放 operation。

结论：结构满足基本容量约束，但尚无三并发和取消释放的确定性回归测试。

## 4. 未满足的问题

以下问题按严重性排序。P0/P1 问题未修复前，不应把整改状态标记为完成。

### R-001 P0：Issue TaskRun 终态写入存在 TOCTOU 竞态

**证据：**

- `src/service.ts:1751` 之后先检查当前 ownership；
- 中间执行 Git evidence、transcript、artifact 和 lease cleanup；
- `src/service.ts:1762` 直接写入 `completed`；
- `src/service.ts:1765` 再把 Issue 推进到 `in_review`。

`stop_issue` 可以在 ownership 检查和最终 `put()` 之间执行。此时 stop 已把 TaskRun 写成 `cancelled`，但完成路径仍可能使用旧快照把它覆盖为 `completed`，随后把 Issue 推进到 `in_review`。

**违反的要求：**

- PRD P0-1：取消后的 TaskRun 不得被异步结果改写；
- PRD P0-1：stop 与完成并发不得产生第二次终态；
- 技术方案 3.1/3.3：终态写入必须经过重新读取和 serialized settlement。

**当前测试缺口：**

现有 late Agent result 测试只证明一个延迟路径，没有强制 stop 精确发生在 ownership 检查和 terminal write 之间。

### R-002 P0：Issue failure settlement 同样可覆盖取消或重新指派

**证据：**

- `src/service.ts:1774` 读取当前 TaskRun；
- `src/service.ts:1775` 等待 Git evidence；
- `src/service.ts:1777` 未重新校验就写入 `failed`；
- `src/service.ts:1780` 也使用旧 owner 信息判断 Issue。

stop 或 reassign 可以在 evidence 收集期间改变 owner，旧操作随后仍然写入失败终态或改变 Issue。

**违反的要求：**与 R-001 相同，并且可能造成新的 active TaskRun 被旧操作清除 Issue 指针。

### R-003 P0：Project TaskRun 没有 ownership-aware settlement

**证据：**

- `src/service.ts:2541` 创建 Project TaskRun 时没有 assignment revision 或等价 owner token；
- `src/service.ts:2589` Agent 返回后直接更新 TaskRun；
- `src/service.ts:2613` 和 `src/service.ts:2640` 直接写 completed/failed；
- `src/service.ts:2419` 的 `cancelProject()` 只 abort operation 并等待，没有对每个当前 TaskRun 做原子取消 settlement；
- `src/service.ts:2954` 的 `failExecution()` 扫描并直接覆盖非终态 TaskRun。

**违反的要求：**PRD P0-1、P0-3，以及技术方案 3.1、6.3。

### R-004 P1：Command 首次请求的 check + insert 非原子

**证据：**

- `src/service.ts:1288` 查询 replay；
- `src/service.ts:1295` 插入 pending；
- 两者均在 `serializedMutation()` 外部。

两个并发首次请求可能都观察到相同 key 不存在，分别插入并执行。现有测试只验证顺序 payload conflict，不验证并发首次请求。

**违反的要求：**PRD P1-2 和技术方案 7.2。

### R-005 P1：External Trigger 首次 receive 非原子

**证据：**

- `src/service.ts:1325` 查找 duplicate；
- `src/service.ts:1333` 写入 received；
- 两者均不在统一 reservation 临界区。

并发同 `(source, externalKey)` 请求可能重复插入和重复执行。现有测试只覆盖顺序 replay/conflict。

**违反的要求：**PRD P1-1 和技术方案 7.3。

### R-006 P0/P1：claim 清理失败但 lease 尚未持久化时无 durable recovery record

**证据：**

- `src/service.ts:1645` 在 claim 失败时传入内存 `pendingClaim`；
- `src/service.ts:1807` 只有已有 `lease` 才写 recovery 状态；
- `src/service.ts:1816` cleanup 失败只记录 activity 并抛错。

如果 active lease 写入失败且 worktree 删除也失败，系统没有 lease 或其他持久化记录描述 orphan workspace，后续重启无法发现它。

**违反的要求：**PRD P0-2 83-92 和技术方案 5.3。

### R-007 P1：restart recovery 无条件删除 lock、释放 lease

**证据：**

- `src/service.ts:1825` 只处理带 `issueId` 的 TaskRun，Project TaskRun 被跳过；
- `src/service.ts:1838` 无条件删除所有 local directory lock；
- `src/service.ts:1848` 对每个非 released lease 直接标记 `released`；
- `src/service.ts:1844` 执行 Git cleanup 时没有 timeout。

这可能删除仍有有效 owner 的 in-place lock，或在 worktree 删除失败/阻塞时错误发布 `released`，造成 workspace 再次被错误复用或 Host 初始化被单个损坏 worktree 阻塞。

**违反的要求：**PRD P1-3 和技术方案 8.1-8.3。

### R-008 P2：CI/release workflow 的 audit step 缩进不一致

**证据：**

- `.github/workflows/ci.yml:39`；
- `.github/workflows/release.yml:48`。

新增 `- name` 比同级 `steps` 项多一个空格，`run` 的缩进也不一致。`pnpm verify` 不会解析 GitHub Actions workflow，因此本地测试通过不能证明 workflow 可执行。

**影响：**CI 和 release 可能在 GitHub Actions 加载阶段失败，导致新增 audit 门禁实际不生效。

### R-009 P2：release workflow 未完成发布门禁

当前 release workflow 只校验 tag 与 package version，没有校验：

- tag 是否属于受保护主干 ancestry；
- CHANGELOG 是否包含对应版本；
- 发布包文件列表和版本是否与 tag 一致。

**违反的要求：**PRD P2、发布门槛和成功指标 211。

### R-010 P2：live smoke 和安全联系渠道仍未闭环

当前已有 package/doc smoke，但没有本次审查可证明的 clean Harness profile Host/Web live smoke。PRD 也要求 SECURITY 和 CODE_OF_CONDUCT 提供可执行、稳定的联系渠道；当前仓库仍需维护者确认公开 advisory、邮箱或表单是否真实可访问。

**影响：**不能宣称 R4 发布验证已完成。

## 5. 验收矩阵

| 编号 | 预期 | 当前状态 | 证据/说明 |
|---|---|---|---|
| P0-1 | 取消后 stale Agent 结果不能改写终态 | 已修复 | `settleTaskRun` 在串行边界重读 owner；取消、失败、late-result 回归测试通过 |
| P0-2 | claim 任何失败均可补偿或 durable recovery | 已修复 | 内存 claim 会创建 durable lease；清理失败保留 `orphaned`/`cleanupError`，故障注入测试通过 |
| P0-3 | Project/Issue 使用统一 workspace | 已修复 | Project TaskRun 记录 `runId` 并使用 claim workspace；Project 执行测试通过 |
| P1-1 | External Trigger 同 key 同内容只执行一次 | 已修复 | serialized received reservation + flight coalescing；并发首次请求测试通过 |
| P1-2 | Command 同 key 同内容只执行一次 | 已修复 | serialized pending reservation + digest 校验；并发首次请求和 legacy recovery 测试通过 |
| P1-3 | 重启恢复按 owner 和 cleanup 结果处理 | 已修复 | valid in-place owner 保留 lock/lease；worktree cleanup 有 10 秒 timeout；restart 测试通过 |
| P1-4 | PDF import 最多两个并发且取消释放 | 已修复 | 三并发稳定拒绝第三个，前两项完成后 slot 可复用 |
| P2 | CI/release/docs/security/live smoke | 已修复并完成 live smoke | workflow YAML、docs smoke、package smoke、audit 通过；clean profile Host/Web 和真实 Agent smoke 已通过 |

## 6. 已知验证结果

已确认通过：

```text
pnpm typecheck
pnpm test
pnpm verify
pnpm audit --prod --audit-level high
ruby -e "require 'yaml'; YAML.load_file('.github/workflows/ci.yml'); YAML.load_file('.github/workflows/release.yml')"
git diff --check
```

当前完整测试结果为 `136/136`；`docs:check` 报告 12 个中文页面和 37 个 Markdown 文件；`smoke:package` 报告 74 个打包文件；production audit 报告 `No known vulnerabilities found`。专项测试覆盖 TOCTOU owner settlement、并发首次 reservation、lease 缺失 cleanup failure、restart lock owner 判断、Git cleanup timeout 配置和 PDF 三并发 slot 释放。

已完成 clean profile live smoke：临时 `DSH_HOME` 安装构建包，在 macOS Host 上验证 `/project-orchestrator/api/health`、Web plugin marker、真实 Chromium 工作台、空 Project 创建、Runtime/Agent 创建、两阶段 Project TaskRun、Agent 文件变更、test command、evidence 和 Host 重启后的项目恢复。版本为 Harness `0.1.1-rc.2`、插件 `1.5.4`；Agent 使用隔离的本地 Runtime 和 OpenAI-compatible provider。GitHub Actions 云端发布将在 `1.5.5` tag 推送后执行。

## 7. 关闭条件

整改只有在以下条件全部满足后才可关闭：

1. R-001 至 R-007 均已修复，并有确定性回归测试；
2. CI/release YAML 可被 GitHub Actions parser 接受；
3. release workflow 完成 ancestry、CHANGELOG 和 package content 校验；
4. PDF reservation 有三并发及取消释放测试；
5. SECURITY/CODE_OF_CONDUCT 联系渠道经维护者确认可执行；
6. 至少完成一个 clean Harness profile 的 Host/Web live smoke；
7. `typecheck`、`test`、`verify`、production audit 和 `git diff --check` 全部通过。

## 8. 关联修复方案

具体实现顺序、接口建议、测试用例和发布门禁见：[整改修复方案](remediation-fix-plan.zh-CN.md)。
