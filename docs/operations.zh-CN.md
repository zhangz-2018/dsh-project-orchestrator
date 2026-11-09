# 运维

[English](operations.md) | 简体中文

## 健康状态与 Snapshot

```bash
curl --fail http://127.0.0.1:3080/project-orchestrator/api/health
dsh-project-orchestrator snapshot
dsh-project-orchestrator stats
```

## 备份

1. 停止现有的 `dsh web` Host。
2. 把 `~/.dsh/storages/project_orchestrator.json` 复制到受保护的存储位置。
3. 记录 plugin 和 Harness 版本。
4. 重启同一个 Host，并验证 `/health`。

正在持久化活动变更时，不要复制 JSON 文件。

## 升级

1. 阅读 `CHANGELOG.zh-CN.md` 和[兼容性矩阵](compatibility.zh-CN.md)。
2. 备份存储。
3. 使用 Harness plugin 管理器升级 profile plugin。
4. 重启现有 Host；不要启动第二个服务器。
5. 验证健康状态、snapshot 解析、排队/恢复的 run，以及 Web 导航。
6. 在批准或重试交付前，确认每个当前已分配 Task 都具有 active 项目智能体成员关系。

首次兼容启动时会幂等回填成员关系：仍为 active 的当前 Task Agent、负责人 Agent，以及项目下非终态 Issue 的 Agent assignee 会成为 active 项目成员。缺失或已归档引用仍保持可见，但在重新分配前会失败关闭，且不会阻止 Host 启动。仅存在于历史 TaskRun 的 Agent 不会扩大 active 成员池。

## 回滚

禁用或删除 loader row，然后重启 Harness，即可恢复原始 Web UI。重新安装旧 1.x 软件包前，必须暂停可执行队列并恢复与其匹配的升级前存储备份；不要依赖 schema 可读性来保留成员资格或禁止回退的安全约束。

## 队列恢复

初始化时：

- 已排队以及等待目录的 Issue run 仍具备执行资格；
- 已分派的 Issue run 会回到 queued，因为对应进程 lease 无法跨重启保留；
- 正在运行的 Issue run 会带着重启证据失败，并且只阻塞匹配的分配 revision；
- 旧版自主交付 run 继续沿用原有恢复契约。

TaskRun 被 RuntimeAdapter 接管前会先持久化 `runtimeAdapterId`、`runtimeExecutionId` 和对应的 `claimVersion`。默认 adapter 为 Host 进程内的 `inline-runtime`，其运行中 execution 不能跨 Host 重启恢复；运行中断会失败关闭并标记需要核对外部副作用。已准备但尚未启动的 dispatch 可在清除旧 claim 与 Runtime 绑定后重新排队。自定义 daemon adapter 必须遵守相同的 prepare、持久化绑定、start、observe、cancel 和 artifact 契约，不能自行写 Project、Issue 或 TaskRun 终态。

## 存储 Reconciliation

当写入 Intent 出现在项目概览的阻塞项中时，先读取当前事实，不要直接编辑存储文件：

```bash
dsh-project-orchestrator reconciliation-preview <INTENT_ID>
dsh-project-orchestrator reconciliation-attempts <INTENT_ID>
```

Preview 返回 `intentDigest`、`previewDigest`、`projectRevision`、逐步骤实际状态和允许动作。执行时必须原样携带这些并使用唯一幂等键，例如：

```bash
dsh-project-orchestrator reconciliation-execute <INTENT_ID> '{
  "expectedIntentDigest":"<INTENT_DIGEST>",
  "previewDigest":"<PREVIEW_DIGEST>",
  "expectedProjectRevision":2,
  "action":"compensate",
  "idempotencyKey":"ops-20260922-001",
  "requestedBy":"operator-name",
  "reason":"Discard the observed partial planning candidate."
}'
```

`replay_safe` 只允许重放；`compensation_safe` 可重放或补偿；`already_applied` 只允许完成收口；`manual_required` 禁止自动执行。任何摘要、revision 或记录事实在 preview 后发生变化，执行都会返回 stale，必须重新读取。失败和成功尝试均保留 `RecoveryAttempt` 审计记录。

## Host 验收报告

`scripts/verify-host-acceptance.mjs` 校验当前 Host、迁移结果、真实 Git 输入、安装包 hash 和备份 hash。没有独立破坏/恢复实验文件时，报告状态只能是 `partial`。要获得 `passed`，恢复证据 JSON 必须包含实验 ID、观测时间、损坏字节数、恢复/备份 hash，以及 `failureLogPath` 与该文件实际内容的 SHA-256；脚本会重新读取日志和存储文件验证，不能靠填写布尔值生成通过结论。

## Worktree 清理

插件使用 `git worktree remove --force` 删除临时 worktree，并清理 metadata。交付分支会保留。清理失败会记录在工作区 lease 上，并阻止系统错误地给出干净的终态结果。

## Python 虚拟环境

如果 `<project cwd>/.venv/bin`（Windows 为 `.venv/Scripts`）存在，运行已批准测试命令时会把该目录添加到 `PATH` 前部，并设置 `VIRTUAL_ENV`。TaskRun 证据会记录 `project_venv` 及其路径。否则，命令使用过滤后的 Host PATH。

## 原生集成与只读试点

“更多 → 运行环境”可查看原生服务存在性。Host 的验证和 Git 证据命令使用 `ctx.subprocess`；缺服务会拒绝执行，CLI 保留显式 Node 后端。该接入不自动提供文件或网络沙箱，也不自动开启 Auto review。

任务内只读子任务默认关闭，隔离试点可显式设置 `DSH_PO_NATIVE_READONLY_PILOT=1` 并重启 Host。每个合格 TaskRun 最多一次；取消、失败和重启不退还配额。恢复时将未完成的 admitted 记录标记 interrupted，不重新派发。完整限制、PR CAS 和存储恢复见[实施记录](dsh-native-integration-implementation-2026-11-09.zh-CN.md)。

## 故障排查

- `project-agent-not-member`：把任务 Agent 加入 Project，或把 Task 重新分配给 active 项目成员。
- `project-task-unassigned`：审批前为每个计划 Task 分配执行智能体。
- `runtime_offline`：为绑定的 Runtime 发送 heartbeat，或修正 Agent 绑定。
- `resource-selection-required`：显式选择一个 Project Resource。
- `verification_failed`：检查 TaskRun 输出和已记录的执行环境。
- `storage-needs-reconciliation`：停止相关执行，读取 Recovery Preview；只有服务端明确允许时才重放、补偿或收口。
- `runtime-start-uncertain` / `runtime-observe-failed`：Runtime 是否已产生外部副作用无法确认，保留 TaskRun、artifact 与 lease 证据后人工核对，不要再次盲目 start。
- 反复出现 collection/import 错误：确认 Project `.venv` 存在并包含所需依赖。
- 缺少启动入口：确认 Loader row，重新构建或安装 Client 产物，重启 Host，并刷新现有 Web 页面。
