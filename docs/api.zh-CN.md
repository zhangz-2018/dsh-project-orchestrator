# HTTP 与 CLI 契约

[English](api.md) | 简体中文

基础路径：`/project-orchestrator/api`

所有响应均为 JSON，并携带 `Cache-Control: no-store`。失败响应采用以下结构：

```json
{"error":{"code":"stable-machine-code","message":"human-readable detail"}}
```

## 读取路由

- `GET /health`
- `GET /snapshot`
- `GET /inbox`
- `GET /agents/workload`
- `GET /issues`
- `GET /squads`
- `GET /runtimes`
- `GET /skills`
- `GET /artifacts`
- `GET /commands`
- `GET /stats`
- `GET /team-metrics`
- `GET /task-runs/:id/transcript`
- `GET /task-runs/:id/artifacts`

Inbox 查询字段采用严格校验：`kind`、`projectId`、`issueId`，以及有上限的 `limit`。

## Project 创建与规划路由

`POST /projects` 接受两种显式请求模式：

- `{ "mode": "empty", "name": "Project name", "cwd": "/absolute/existing/path", ... }` 创建状态为 `draft` 的 Project，并返回 `201`。该模式允许 `prd` 和 `technicalDesign` 为空，不创建 Task 或审批记录，也不会调用 Planner 或 Agent。
- `{ "mode": "ai", "cwd": "/absolute/existing/path", "prd": "Delivery brief", ... }` 创建 Project、启动拆解，并返回 `202`。

为保持 1.x 向后兼容，省略 `mode` 时仍沿用原有 AI 行为，因此必须提供非空 `prd`。新的 Web 客户端默认使用 `mode: "empty"`；API 省略 `mode` 并不等同于 Web 默认值。`taskLanguage` 默认为 `zh-CN`，也可以设置为 `en`。

其他路由：

- `PUT /projects/:id` 保存 Project metadata，不调用 AI，也不使当前计划失效。已有 Task 时，如果修改影响计划的字段（`cwd`、PRD、技术方案、优先级、面向人工展示的 `owner` 文本或任务语言），请求会以 `project-replan-required` 拒绝；名称和摘要仍可作为安全的纯 metadata 修改。`owner` 不等于 `leadAgentId`：通过项目成员关系更换负责人智能体不会改变 Task 指派，也不会使审批失效。没有 Task 的 draft 可以保留空 PRD，也可以继续提交空 PRD。
- `POST /projects/:id/replan` 接受 `{ "taskLanguage": "zh-CN" }` 或 `en`，也可以原子地附带经过完整校验的 `project` 编辑 payload。该路由会在持久化任何编辑前拒绝已有执行历史的 Project；它只替换尚未执行的计划、递增 Project revision、清除当前审批并启动拆解。
- `POST /projects/:id/decompose` 使用已保存的语言显式启动 draft Project 的规划；PRD 为空时以 `project-brief-required` 拒绝。
- `POST /projects/:id/approve` 继续与 revision/hash 绑定；重新生成计划后必须重新批准。
- `POST /projects/:id/open-directory` 不接受路径 body。它会读取权威的已持久化 `project.cwd`，重新校验路径，通过不使用 shell 的已认证操作系统 opener 打开目录，并返回 `{ "ok": true }`。macOS 和 Linux 已认证；Windows 尚未认证。

中文模式会校验摘要、标题、描述和验收标准包含中文文本。JSON key、Task ID、代码符号、路径、Agent 角色和命令绝不会被翻译。

## 项目智能体成员与任务分配路由

- `GET /projects/:id/agents` 返回 active 和 removed 项目智能体成员关系。
- `POST /projects/:id/agents` 添加或重新激活一个 active Agent，不调用 AI，也不会使无关审批失效。完全相同的重复请求幂等返回；若现有 active 成员的职责或自动匹配设置不同，则返回 `project-agent-already-member`，并要求使用 `PUT`。
- `POST /projects/:id/agents/batch` 原子添加或重新激活多个 Agent。
- `PUT /projects/:id/agents/:agentId` 更新项目职责、AI 规划自动匹配资格或负责人标记。
- `DELETE /projects/:id/agents/:agentId` 软删除成员关系。默认 `assignedTaskPolicy: "reject"`，必须先处理当前计划 Task、非终态 Issue、活跃委派和负责人关系。`assignedTaskPolicy: "reassign"` 要求同时提交 `replacementAgentId` 与 `expectedProjectRevision`：服务端原子重新分配当前 Task 计划、只增加一次 revision、清除审批、在未明确清空时转移负责人，然后移出成员。Issue 与委派引用仍必须走各自的审计生命周期命令。
- `POST /projects/:id/task-assignments` 原子更换多个 Task Agent，只增加一次 Project revision，清除审批，并返回刷新后的计划事实。

Task 创建/更新、规划、审批、重试、执行，以及项目范围内的 Issue/Squad 指派都会校验 active 项目成员资格。只要保留了项目成员历史，就禁止物理删除对应 Agent；应改为归档，以便历史名称和引用仍可解析。审批要求每个 Task 都有明确且具备资格的 Agent；执行时不会从工作区全局 Agent 中选择未被审批的回退执行者。

## Team Plan、Review 与交付路由

读取路由使用 Service 拥有的投影，不在客户端重复推导资格：

- `GET /projects/:id/team-plan` 返回团队快照、任务策略、候选覆盖、阻塞项、关键路径和容量观察。
- `GET /projects/:id/agent-candidates?taskId=...` 在 `candidates` 和 `squadCandidates` 中分别返回确定性的可用/拒绝 Agent、Squad 候选及原因。
- `GET /projects/:id/team-impact` 预览受影响 Task、验收证据、当前 PlanSnapshot/Approval、active Issue/Delegation 和活动执行保护。
- `GET /projects/:id/team-metrics` 返回项目范围团队指标；`GET /team-metrics` 返回全局投影。
- `GET /projects/:id/validate-team` 只评估当前团队，不写 Command。
- `GET /projects/:id/plan-snapshots`、`/requirements`、`/requirement-decisions` 和 `/delivery` 暴露计划、需求到证据矩阵、决策、Project Review 和交付事实。
- `GET /projects/:id/squad-bindings`、`/agent-membership-sources` 和 `/eligible-squads` 暴露 Squad 来源与资格。

以下团队规划变更由 Command 驱动，与 `POST /commands` 共享幂等、审计和失败语义：

- `POST /projects/:id/validate-team`
- `POST /projects/:id/reassign-task`
- `POST /projects/:id/resolve-team-blocker`
- `POST /projects/:id/squad-bindings`
- `POST /projects/:id/squad-bindings/:squadId/sync`

Project Review 和交付由各自的串行生命周期 owner 处理：

- `POST /projects/:id/review/resolve`
- `POST /projects/:id/delivery/confirm`
- `POST /projects/:id/delivery/close`

Review 驳回会创建可审计的 Decision/Inbox 待办；waiver 会写入 Acceptance 记录。Review/waiver 发生部分写入失败时，API 返回失败前会补偿恢复，避免留下 Project、Review 和 Acceptance 混合状态。

非空 Task `allowedScope`/`forbiddenScope` 在执行时强制依赖 Git 证据。TaskRun 只记录相对其启动基线实际变化的文件；`scope_violation` 或 `verification_unavailable` 会在测试命令前失败关闭并创建关联 Decision。自动修复达到上限时同样创建一个关联的 retry Decision。

## 本地功能使用路由

- `POST /usage` 按服务端当前 UTC 日期，为一个已知 feature 增加有界的 `opens`、`meaningfulActions` 或 `errorRecoveries` 计数。
- `DELETE /usage` 清除本地功能使用聚合。

使用记录包含 UTC 日期、feature key、三类聚合计数和 `lastUsedAt`；超过 30 天的记录会在下一次写入时清理。它不包含 Project 名称、路径、需求、任务内容、Agent 指令、评论或 Transcript，也不会上传。

## 统一 Command 路由

`POST /commands` 接受 Command 输入。支持的类型：

- `assign_issue`、`reassign_issue`、`stop_issue`、`continue_issue`
- `approve_review`、`reject_review`、`request_decision`
- `delegate_issue`、`retry_delegation`、`stop_delegation`
- `reassign_task`、`bind_project_squad`、`sync_project_squad`
- `validate_team`、`resolve_team_blocker`
- `autopilot_tick`

提供相同的非空 `idempotencyKey` 时，会返回原始 Command 记录，不会重复执行变更。

## 外部触发器

`POST /external-triggers` 以 `(source, externalKey)` 去重，记录 payload digest，并通过同一个 owner 路由嵌套 Command。

## 变更请求的安全要求

变更请求必须同时满足以下条件，否则会被拒绝：

- socket peer 是 loopback；
- `Host` 是 loopback；
- 存在 `Origin`，且与该 Host origin 完全一致；
- cross-site fetch metadata 不存在或为 same-origin。

这项策略会有意拒绝远程 API 客户端和反向代理；只有 Harness 自身仍观察到 loopback same-origin 请求时才会放行。

## CLI 退出码

- `0`：显示 help/version，或 API 请求成功；
- `1`：传输、JSON、策略或 API 失败；
- `2`：CLI verb 无效，或缺少必需的 JSON 参数。

CLI 会把成功 payload 以格式化 JSON 输出，把失败信息输出到 stderr。CLI 绝不会直接写入存储文件。

团队和交付 CLI 命令包括 `team-plan`、`agent-candidates`、`team-impact`、`team-metrics`、`validate-team`、`reassign-task`、`resolve-team-blocker`、`bind-project-squad`、`sync-project-squad`、`plan-snapshots`、`requirements`、`decisions`、`delivery`、`resolve-review`、`confirm-delivery` 和 `close-delivery`。所有命令只连接 loopback Harness API。
