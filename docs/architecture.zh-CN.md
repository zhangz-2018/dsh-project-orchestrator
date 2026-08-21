# 架构

[English](architecture.md) | 简体中文

## 软件包的两部分

该软件包是一个静态的双端 Cordis 插件：

- `src/index.ts` 注册 Host 存储、服务和 `/project-orchestrator/api` 前缀处理器。
- `src/client.tsx` 在现有 Harness Web shell 中注册附加式的侧边栏底部 slot 和 shell overlay slot。
- `src/cli.ts` 是仅限 loopback 的 HTTP 客户端，用于运维读取和统一变更。

插件不会替换 Web shell，也不需要启动第二个应用服务器。

## 事实来源

| 记录 | 归属事实 |
|---|---|
| Project | 计划 revision、审批、Resources、面向人工展示的 owner 文本、负责人智能体，以及旧版自主交付 run 指针 |
| ProjectAgentMembership | 项目范围内的智能体资格、规划职责、自动分配许可和加入/移出历史 |
| Task | 已批准计划依赖、执行智能体和独立验证门禁 |
| Issue | 协作生命周期、分配 revision、评审状态、当前 TaskRun 指针 |
| TaskRun | 一次排队/执行尝试、工作区 lease、Session 和交付证据 |
| Command | 幂等 key、变更结果或持久化失败回执 |
| Runtime | 本地 Host 分派资格和工作区 metadata |
| Squad / Delegation | 团队配置，以及一份父子 Issue 协作契约 |
| Harness Session | 原始对话的权威来源；插件只存储有界、已脱敏的投影 |
| Artifact | 持久化的文档、测试、commit、diff 或 PR 引用证据 |

Inbox、Agent 工作负载、Skills、本地功能使用聚合和统计数据都是读取投影，不能成为替代性的写入 owner。

项目智能体成员关系只定义参与资格，不等同于实际执行指派。每个可执行 Task 仍必须绑定明确的 `Task.agentId`；每次 Issue 执行仍由分配 revision 和 TaskRun 约束。未改变任务执行者的成员变更不会使审批失效；更换 Task Agent 仍会改变 plan digest，并要求重新审批。

## TaskRun 生命周期

- `queued`：已持久化但尚未被领取；Runtime 离线或 Host 重启后仍会保留。
- `waiting_local_directory`：具备执行资格，但被 canonical 原地目录锁阻塞。
- `dispatched`：已获取容量和工作区 lease。
- `running`：Harness Agent 正在运行。
- 终态：证据和工作区清理均已稳定。

当 Issue 的分配 revision 发生变化后，过期 TaskRun 可以保留终态证据，但不能继续推进该 Issue。

## 工作区

`in_place` Resource 按 canonical 目录串行执行。`worktree` Resource 使用 `git worktree add -b`；Git 或 ref 准备失败时按失败关闭处理。worktree 分支会作为证据保留；临时目录会在进入终态前删除。

## 进程模型

当前 Harness Agent 在 Host 进程中执行。Runtime 记录并不表示远程 worker。存储变更边界只串行化单个 Host 进程，并不是分布式事务或 compare-and-swap 协议。

## 兼容性存储

存储域版本为 1。较新的记录表会作为可选兼容表打开，因此旧 snapshot 可以用空数组加载。Snapshot 投影会过滤悬空上下文，但不会从存储中删除审计回执。
