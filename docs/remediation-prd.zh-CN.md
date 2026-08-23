# dsh-project-orchestrator 整改 PRD

版本：Draft 1

状态：待评审

适用版本：1.5.4 及后续 1.x 修复版本

关联技术方案：[修复技术方案](remediation-technical-design.zh-CN.md)

## 1. 背景

本项目已经具备可用的 DSH Host/Web 插件形态、审批式项目编排、Issue 派发、Git worktree、Runtime、证据归档、CLI 和 npm 发布链路。现有静态检查、125 个自动化测试、文档检查、构建和 npm 包 smoke 均可通过，DSH `0.1.0-rc.6` / Cordis `4.0.1` 的已核对集成契约也没有发现已证实错误。

全局审查同时发现，执行状态与工作区生命周期仍存在可能破坏用户数据和审计事实的缺陷：

- 用户停止 Issue 后，异步 Agent 结果可能把 TaskRun 重新写成 `completed`。
- workspace claim 在中途持久化失败时可能泄漏本地目录锁或 worktree。
- 普通 Project 执行没有复用 Issue dispatcher，可能绕过 Resource、Runtime、锁和租约。
- External trigger 和 Command 幂等键没有校验请求内容一致性。
- Host 重启后 worktree 只被标记为 orphaned，实际目录和 Git 元数据可能残留。
- 迁移、漏洞报告、发布和中英文文档存在可执行性或一致性问题。

这些问题直接影响项目最核心的承诺：审批后可控执行、工作区隔离、可恢复调度和可审计证据。因此本整改不是视觉重构，而是一次执行可靠性和开源发布质量提升。

## 2. 产品目标

### 2.1 总目标

在不破坏现有 DSH 插件注册契约、HTTP/CLI 兼容性和版本 1 存储可读性的前提下，使项目达到“可条件发布为可靠 1.x 修复版”的标准：

1. 终态只能由当前 owner 按有效 assignment 写入。
2. 每一次执行都必须在统一的 Resource/Runtime/workspace 生命周期中运行。
3. 所有 claim 和 cleanup 失败都可补偿、可恢复、可观测。
4. 同一幂等键不能接受语义不同的请求。
5. 重启恢复不会持续泄漏本地 worktree 和锁。
6. 文档、包 smoke、CI 和 release workflow 能阻止已知回归。

### 2.2 非目标

本次整改不包含：

- 将本地 Host 扩展为多 Host 或分布式调度。
- 引入远程 Agent、远程执行或远程存储。
- 改变 DSH `0.1.0-rc.6` 的 Slot、Module Loader 或 Cordis 生命周期契约。
- 把本地 JSON 存储升级为加密数据库。
- 增加 PR 自动创建、远程分支推送或代码托管平台认证。
- 进行大规模 UI 视觉重做。

## 3. 用户与场景

| 用户 | 关键场景 | 主要风险 |
|---|---|---|
| 本地开发者 | 批准 Project 后自动执行多个 Task | 多任务修改同一目录，或在错误目录执行 |
| Issue 负责人 | 停止正在运行的 Issue | 停止后任务被异步结果复活 |
| 运维人员 | Host 崩溃后重启 | worktree 和锁残留，队列无法继续 |
| 集成调用方 | 重试 webhook 或 Command | 同 key 不同 payload 被静默接受或错误复用 |
| 贡献者/维护者 | 迁移、发布、报告漏洞 | 文档降级、联系方式不可执行、tag 触发边界不足 |

## 4. 整改范围与优先级

### P0：执行正确性与数据安全

#### P0-1 取消语义不可被覆盖

**需求**

- `stop_issue` 成功后，当前 TaskRun 的 `cancelled` 终态不可被异步 Agent、测试命令或证据归档流程改写为 `completed`、`failed` 或 `deferred`。
- 已取消运行不得推动 Issue 进入 `in_review`。
- stale assignment、assignment revision 不匹配或 Issue 已更换 active TaskRun 的结果不得更新当前 Issue。
- 取消后的结果可以作为受限审计证据保存，但必须标记为 stale/cancelled，不得作为当前交付结果。

**验收标准**

- Agent 忽略 AbortSignal 并延迟返回时，TaskRun 最终仍为 `cancelled`。
- Issue 不会进入 `in_review`，`activeTaskRunId` 不会被错误恢复。
- 重复 stop、stop 与完成并发、stop 与 deferred 并发均返回稳定状态，不产生第二次终态。

#### P0-2 Workspace claim 具备补偿清理

**需求**

- claim 过程中任何持久化失败都必须释放已写入的本地目录锁。
- 已创建的 worktree 必须尝试 `git worktree remove --force` 和 `git worktree prune`。
- 清理失败必须持久化错误并产生 activity，不能静默吞掉。
- 不得把不存在 lease 记录作为“不需要清理”的依据。

**验收标准**

- lock 写入成功、lease 写入失败时，锁最终不存在。
- worktree 创建成功、TaskRun 写入失败时，worktree 目录和 Git 注册信息最终被移除，或明确记录 orphaned/cleanupError。
- 后续同目录任务不会因为上一次失败 claim 永久处于 `waiting_local_directory`。

#### P0-3 所有执行复用统一 workspace 生命周期

**需求**

普通 Project Task 必须与 Issue Task 使用同一套 workspace acquisition/dispatch/cleanup 语义，至少包括：

- Resource 选择和多 worktree 资源冲突检查。
- Runtime lifecycle/status 和 Agent capacity 校验。
- in-place canonical directory lock。
- worktree 创建、路径安全校验和 workspace lease。
- Agent 与测试命令使用实际分配的 workspace。
- 终态前证据收集与 workspace cleanup。

**验收标准**

- 配置 worktree Resource 后，Agent 和 test command 均运行在该 TaskRun 的 worktree。
- 共享 in-place 目录的并发执行被串行化。
- Runtime offline 或容量已满时不会创建可执行 TaskRun。
- 普通 Project、Issue、retry、restart recovery 都遵循同一 cleanup 规则。

### P1：幂等、恢复和并发

#### P1-1 External trigger 内容一致性

同一 `(source, externalKey)` 只有在 canonical command digest 相同时才允许 replay。digest 不同必须返回明确的 `external-trigger-conflict`，不得静默返回旧结果。

#### P1-2 Command 幂等请求指纹

Command record 需要保存 canonical request digest，至少覆盖：

- command type
- projectId / issueId / squadId
- actorType / actorId
- payload

同一 idempotency key 且 digest 不同必须拒绝；相同请求才允许 replay。首次检查与插入必须在现有单 Host serialized mutation 边界内完成。

#### P1-3 重启 worktree 恢复

启动恢复必须读取 active/orphaned lease，根据 lease mode 尝试清理 worktree；成功后标记 `released`，失败后保持 `orphaned` 并记录 cleanupError、activity 和后续人工操作入口。in-place lock 也必须按当前 lease/task 状态恢复或删除，不能无条件掩盖清理失败。

#### P1-4 PDF import 并发上限

将“检查容量”和“登记 operation”放入同一同步/串行保留段，确保最多两个 import operation 同时进入执行。取消、异常和完成都必须释放 reservation。

### P1：测试与发布质量

- 为 P0/P1 场景增加确定性回归测试和故障注入测试。
- package smoke 实际 import 根入口、`./client` 和 PDF worker。
- docs smoke 检查 fragment-only 链接的目标锚点。
- 固定测试临时目录，并在 `finally` 清理 marker；去除固定 sleep，使用带诊断的条件轮询。
- 增加 `pnpm audit --prod --audit-level high` 或等价 OSV 门禁，并记录审计例外。
- release workflow 校验 tag 对应受保护主干的 ancestry、版本、CHANGELOG 和包内容。

### P2：开源体验与文档

- 迁移文档不再固定安装 `1.5.0`，改为当前版本或显式 `VERSION`。
- SECURITY 提供仓库内稳定的邮箱、表单或已确认可访问的 advisory 地址。
- CODE_OF_CONDUCT 使用可执行的 enforcement 联系方式。
- 中英文 README、release、compatibility、operations 和 contributing 内容保持同一版本与平台边界。
- operations 文档提供可复制执行的 loader/client rebuild、安装、重启和刷新命令。
- 修复中文 PRD 的排版错误。
- 明确 source map 是否作为公开包的一部分；若保留，说明用途并验证不含本机路径和敏感源信息。

## 5. 兼容性要求

### 保持不变

- 插件名 `project-orchestrator`。
- HTTP prefix `/project-orchestrator/api`。
- 根 export、`./client` export 和两个 CLI binary 名称。
- storage domain `project_orchestrator` 以及 version 1 记录的向前读取能力。
- 现有成功请求、错误响应结构和已记录的审计证据。
- DSH `0.1.0-rc.6`、Cordis `4.0.1` 的注册与 loader 契约。

### 允许新增

- TaskRun cleanup/recovery 元数据字段。
- Command request digest 字段。
- 新错误码：`command-idempotency-conflict`、`external-trigger-conflict`、`workspace-cleanup-failed` 等。
- 只读恢复诊断字段和 API/CLI 输出字段。
- 兼容旧记录的默认值和一次性幂等迁移。

### 需要特别评审

- TaskRun 状态转换和 Issue ownership 语义属于 v1 公共契约，修复必须确保旧数据不会被错误推进。
- 如果必须改变持久化状态枚举，应增加迁移版本或 forward-readable 默认分支，并补充 rollback 说明。

## 6. 交付拆分

| 阶段 | 主要输出 | 通过门槛 |
|---|---|---|
| R0 设计冻结 | 状态转换表、workspace claim/cleanup 接口、错误码 | 技术评审通过 |
| R1 P0 修复 | 取消保护、统一 dispatch、claim compensation | P0 测试全部通过 |
| R2 P1 修复 | 幂等指纹、重启清理、PDF reservation | 并发/故障注入测试通过 |
| R3 工程补强 | package/docs/release/security/CI | verify、audit、package smoke 通过 |
| R4 发布验证 | clean Harness profile、macOS/Linux live smoke | 版本、tag、npm provenance 核验通过 |

## 7. 发布门槛

禁止在以下任一项未完成时宣称“稳定版”：

- 任一 P0 缺陷仍可复现。
- 普通 Project 执行仍绕过 workspace lease/resource dispatch。
- 取消竞态和 claim compensation 没有自动化回归测试。
- migration 文档仍可能引导安装旧版本。
- SECURITY 没有可执行报告渠道。
- 只在仓库内存储测试通过，未完成至少一个 clean Harness profile 的 Host/Web live smoke。

## 8. 成功指标

- P0 回归场景通过率：100%。
- 所有 TaskRun terminal 状态单向收敛，不能被 stale operation 改写。
- 故障注入测试中 lock/worktree 泄漏率：0；无法清理时必须有明确 orphaned 记录和 cleanupError。
- Command/External trigger 同 key 不同内容：100% 返回冲突，不发生静默 replay。
- package smoke 覆盖根 export、client export、worker 和 CLI：100%。
- 中英文核心文档链接和版本声明无漂移。
- 发布 workflow 只能由受控 tag 和受保护主干 ancestry 触发。

## 9. 风险与取舍

- 统一执行路径可能改变旧版 Project 的实际 cwd 行为。应在 release notes 中明确：执行 workspace 以 Resource/lease 结果为准，旧任务仅按旧记录恢复，不重写历史证据。
- 启动清理 worktree 可能耗时或受 Git 状态影响。清理应有超时/错误记录，并保留 orphaned 状态供运维处理，不能阻塞 Host 无限等待。
- 幂等冲突会让过去“静默返回旧结果”的调用方收到 409。该行为是防止错误重放所必需的，应在 API 文档和 changelog 中明确。
- source map 移除会降低外部调试能力，但可以减少源码暴露；需要由维护者根据 npm 调试需求作出明确选择。
