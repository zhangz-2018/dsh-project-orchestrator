# 从本地构建或带作用域构建迁移

[English](migration.md) | 简体中文

公开软件包将替代 `@mindquant/dsh-project-orchestrator` 等开发构建，同时有意保留：

- Cordis 插件名称 `project-orchestrator`；
- HTTP 前缀 `/project-orchestrator/api`；
- 存储域 `project_orchestrator`；
- 现有的版本 1 记录 schema 和兼容性投影。

这样可确保加载器软件包名称发生变化时，本地数据仍得到保留。

## 安全迁移

1. 停止现有的 Harness Host。
2. 备份 `~/.dsh/storages/project_orchestrator.json`。
3. 通过同一个 Web profile 安装目标发布版本（例如 `dsh-project-orchestrator@1.5.6`）；不要把文档中的示例版本当作固定安装版本。
4. 替换加载器行中的软件包名称；不要添加第二行：

   ```yaml
   - id: project-orchestrator
     name: dsh-project-orchestrator
   ```

5. 仅在新软件包安装完成后，移除旧的带作用域软件包。
6. 重启现有 Host 一次。
7. 验证健康状态、快照数量、已排队或已恢复的 TaskRun，以及 Web 启动入口。

切勿同时加载这两个软件包。它们会注册相同的 Host route 和存储域，从而产生所有者冲突。

## 项目智能体成员回填

支持项目成员关系的版本会增加兼容表，但不会改变 `project_orchestrator` 存储域名称。首次启动时会从以下事实幂等创建 active 项目智能体成员：

- 已持久化的 `Project.leadAgentId`，前提是对应 Agent 仍然存在且为 active；
- 项目当前计划中的每个 `Task.agentId`，前提是对应 Agent 仍然存在且为 active；
- 项目下每个非终态 Issue 的 active Agent assignee。

仅存在于历史 TaskRun、当前已不再引用的 Agent 不会成为 active 成员。缺失或已归档的旧 Agent 不会被重新激活：无效负责人会被清空，受影响的 Task 或 Issue 仍保留用于修复，并在指派、审批、重试或执行时失败关闭，但不会阻止 Host 启动。首次启动前请备份存储，并确认每个已分配 Task 都能投影出一条 active membership；交付前必须重新分配所有未解决引用。

## Squad 与 Runtime 1.5 兼容性

1.5 保持存储域版本 1，并执行幂等兼容迁移。旧 Runtime 的生命周期默认解释为 `active`；TaskRun 保留原 Runtime ID，并在不改写执行证据的前提下尽力补充 Runtime 名称快照。旧的单成员 Squad 仍可读取，但在编辑为至少包含两个不同的 active Agent 前，不能用于新的 Project 指派。新的 Runtime 工作区根目录不会再被隐式创建，必须通过已存在目录的安全校验。

升级还会在派发前协调 pending/running Command 和损坏的 active TaskRun 指针。旧版本无法理解这些生命周期与恢复约束，因此回滚必须恢复升级前存储备份，不能只降级软件包代码。

## Client 模块标识

公开 Client 模块的加载器 ID 为 `dsh-project-orchestrator`；旧的 Client 缓存产物中可能仍包含带作用域的 ID。迁移后重启 Host 并刷新 Web 页面，以便 shell 获取当前 bundle。

## 回滚

停止 Host，并保持所有可执行队列暂停。若要恢复旧行为契约，必须同时恢复旧加载器软件包和升级前存储备份，再重启并验证队列状态后恢复执行。不要让旧软件包直接读取已使用成员语义的在线数据：schema 可读并不代表旧版本保留了任务指派和禁止回退的安全约束。
