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

## Worktree 清理

插件使用 `git worktree remove --force` 删除临时 worktree，并清理 metadata。交付分支会保留。清理失败会记录在工作区 lease 上，并阻止系统错误地给出干净的终态结果。

## Python 虚拟环境

如果 `<project cwd>/.venv/bin`（Windows 为 `.venv/Scripts`）存在，运行已批准测试命令时会把该目录添加到 `PATH` 前部，并设置 `VIRTUAL_ENV`。TaskRun 证据会记录 `project_venv` 及其路径。否则，命令使用过滤后的 Host PATH。

## 故障排查

- `project-agent-not-member`：把任务 Agent 加入 Project，或把 Task 重新分配给 active 项目成员。
- `project-task-unassigned`：审批前为每个计划 Task 分配执行智能体。
- `runtime_offline`：为绑定的 Runtime 发送 heartbeat，或修正 Agent 绑定。
- `resource-selection-required`：显式选择一个 Project Resource。
- `verification_failed`：检查 TaskRun 输出和已记录的执行环境。
- 反复出现 collection/import 错误：确认 Project `.venv` 存在并包含所需依赖。
- 缺少启动入口：确认 Loader row，重新构建或安装 Client 产物，重启 Host，并刷新现有 Web 页面。
