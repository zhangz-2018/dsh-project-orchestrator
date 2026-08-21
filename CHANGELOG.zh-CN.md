# 变更日志

[English](CHANGELOG.md) | 简体中文

本项目的所有重要变更均记录于此。格式遵循 [Keep a Changelog](https://keepachangelog.com/en/1.1.0/)，项目遵循 [Semantic Versioning](https://semver.org/spec/v2.0.0.html)。

## [1.3.4] - 2026-08-21

### 新增

- 新增客户端样式契约测试，防止重新引入仅适用于亮色主题的固定颜色或不存在的 Harness 主题 token。

### 修复

- Project Orchestrator 的全部页面现在跟随 Harness 全局亮色与暗色主题，包括任务看板、语义状态与优先级徽章、弹窗、项目详情、Agent Builder、反馈提示和移动端导航。
- 焦点、悬浮、按下、选中和禁用状态现在使用受支持的 Harness token，并在两种主题下保持清晰可辨。

## [1.3.3] - 2026-08-21

### 修复

- Cordis 客户端插件现在按服务名注入 `workspaces`；package manifest 仍单独声明 runtime 软件包依赖，避免混淆两层注入语义。

## [1.3.2] - 2026-08-21

### 新增

- Project 支持多个需求文档和追加式拆分批次，保留之前的计划与任务证据。
- 项目详情增加提交新需求文档并追加生成代码任务和测试任务的入口。

### 修复

- 目录浏览器现在正确注入所使用的 Harness Workspace runtime，Web Host 使用 `browse` 能力时不再报 `workspaces` 服务缺失。

## [1.3.1] - 2026-08-21

### 新增

- 当 Harness Host 提供 `browse` 目录能力而非系统原生选择器时，使用站内目录浏览器完成选择。
- Project 与 Harness Workspace 建立持久关联，同路径 Workspace 会自动复用，并可从项目详情直接打开。

### 修复

- Web Host 未提供 native 目录选择能力时，本地代码仓库选择不再失败。

## [1.3.0] - 2026-08-21

### 新增

- 支持通过 Harness Host 目录选择器创建本地代码仓库项目。
- 支持创建 GitHub 远程仓库项目，可选择分支浅克隆，并分页读取分支和开放 Issues 后导入选中事项。
- Planner 和执行 Prompt 增加边界，将 GitHub Issue 与项目资料视为不可信数据。

### 变更

- GitHub Resource 持久化本地克隆路径，后续执行和 Worktree 选择使用实际工作目录。
- 创建项目草稿只保留非敏感元数据，30 分钟后过期，并清理旧版敏感草稿。
- Repository inspect 请求会取消旧请求，并忽略过期响应。

### 安全

- 项目创建失败时补偿清理半成品记录，并校验 clone 根目录和本地 API 访问边界。

## [1.2.1] - 2026-08-20

### 新增

- 为 API、架构、兼容性、运维、迁移、发布、贡献、安全、支持、治理、行为准则和变更日志提供完整的简体中文版本。
- 新增双向语言导航，以及自动化的文档链接和 npm 包内容检查。

### 变更

- 简体中文 README 现在只链接中文版专题文档，npm 包同时包含中英文文档。

## [1.2.0] - 2026-08-20

### 新增

- Web workbench 现在默认创建空 Project，并提供显式选择的 AI 拆解模式；之后可以手动规划，也可以再让 AI 规划。
- 为已认证的 macOS 和 Linux Host 提供以 Project ID 为作用域的本地目录打开功能。
- 新增产品与 UI 设计契约，其中记录了明确的 AI 意图、克制的工程控制台呈现方式，以及 WCAG 2.2 AA 目标。

### 变更

- Project 记录及其编辑现在允许 PRD/技术设计字段为空，而 AI 分解要求提供非空的交付简述。
- 编辑 Project metadata 不再隐式调用 AI；仅涉及安全 metadata 的保存会保留当前计划及其批准状态，而影响计划的编辑则使用受执行历史保护的 replan 操作。
- modal dialog 现在会约束键盘焦点，可通过 Escape 关闭，并在关闭后将焦点恢复至触发元素。
- 围绕首次使用工作流、AI 边界、目录打开和安全预期，重新编写了简体中文 README。

### 安全

- 打开目录时会解析已持久化的权威 Project 路径，在执行操作时重新验证该路径，拒绝过于宽泛的根目录，并通过 argv 调用固定可执行文件，而不是进行 shell 插值。

## [1.1.0] - 2026-08-20

### 新增

- 新增 Project 级别的 `zh-CN`/`en` 规划语言，默认使用简体中文，并支持为尚未执行的计划重新生成内容；重新生成会使原有批准失效。

### 变更

- 升级固定版本的 GitHub Actions runtime 依赖项，并将 CodeQL 初始化和分析统一升级至 v4.37.7。
- 将 esbuild 升级至 `0.28.2`，并限制 Dependabot 提议未经认证的 TypeScript 和 Node type 主版本。

## [1.0.0] - 2026-08-20

### 新增

- 可持久化的 Projects、Issues、Tasks、TaskRuns、Decisions、Commands、Squads、Delegations、Runtimes、Resources、Transcripts、Artifacts 和 Activity 记录。
- 以批准为门禁的自主交付，以及独立执行的测试命令。
- 感知 Runtime 的 Issue 分派、Agent 并发容量、目录锁、工作区 lease 和重启恢复。
- 使用真实 Git worktree 执行，并提供 branch、commit、diff、Artifact 和清理证据。
- Inbox、工作负载、运行统计、有界 Autopilot、幂等外部触发器和 loopback CLI。
- 响应式 Harness Web workbench，包含 Inbox、Issues、Projects、Agents、Squads、Runtimes、Skills 和 Autonomous Delivery 页面。
- 为已批准的测试命令发现 Project 本地 `.venv`，并持久化执行环境证据。

### 兼容性

- 已针对 DeepSeek Harness `0.1.0-rc.6` 和 Cordis `4.0.1` 完成认证。
- Runtime 记录表示单个 Harness Host 内的分派资格；不提供多 Host 执行和分布式锁。
