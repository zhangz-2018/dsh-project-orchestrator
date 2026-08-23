# 变更日志

[English](CHANGELOG.md) | 简体中文

本项目的所有重要变更均记录于此。格式遵循 [Keep a Changelog](https://keepachangelog.com/en/1.1.0/)，项目遵循 [Semantic Versioning](https://semver.org/spec/v2.0.0.html)。

## [1.5.6] - 2026-08-23

### 新增

- 记录 clean Harness Host/Web 和真实 Agent 执行 smoke，完成整改版本的发布验证闭环。

## [1.5.4] - 2026-08-22

### 修复

- 加固 TaskRun 终态结算、Workspace 恢复、命令 reservation 和发布校验，覆盖取消、重启、清理失败与重复请求竞态。

- 删除任务前展示仍依赖当前任务的下游任务，并在依赖未移除前禁用删除操作。
- 服务端拒绝删除时返回具体任务名称和处理建议，不再只展示难以识别的任务 ID。

## [1.5.3] - 2026-08-22

### 安全

- 将 `pdfjs-dist` 升级到修复 CVE-2026-16633 / GHSA-hq66-cqwq-w95j 的 `6.2.108` 版本。
- 需求 PDF 导入时显式关闭 PDF 脚本执行，避免不可信 PDF 内容在 Harness 页面上下文执行脚本。

## [1.5.2] - 2026-08-22

### 新增

- 新增统一的可访问确认弹窗，覆盖删除、归档、成员移出、任务删除、重新规划和草稿放弃，并支持语义标注、Escape 取消、焦点陷阱、焦点恢复与响应式操作区。

### 变更

- Web 工作台移除原生浏览器确认框，所有确认交互统一使用全局弹窗。
- 工作目录移出摘要卡片，改为无输入框感的信息栏，长路径作为只读事实展示。

## [1.5.1] - 2026-08-22

### 新增

- 项目概览增加可恢复的规划诊断；当 Harness 会话缺少仓库只读工具时，可以直接重新运行规划。
- 规划技术详情改为渐进式展开，保留原始诊断，同时避免在中文概览中混入内部英文指令。

### 变更

- 工作目录事实与打开 Workspace、打开目录操作使用独立视觉区域，并针对移动端重新排列操作。
- 项目概览中的项目智能体摘要使用稳定的 active 成员数量，同时保留完整成员名称作为可访问上下文。

## [1.5.0] - 2026-08-21

### 新增

- 新增完整 Squad 管理：项目资格投影、写入时至少两名成员、全局委派容量、乐观并发、克隆/归档保护，以及 Web 工作台中的 Agent/Squad Issue 分派。
- 新增完整本机 Runtime 管理：派生默认 Host、独立生命周期与健康状态、Agent/Project Resource 绑定、影响预览、不可变 TaskRun Runtime 名称快照，以及 Runtime 异常 Inbox 证据。
- 新增响应式管理抽屉、项目上下文入口、本地数据视图、移动端全屏 Sheet，并支持焦点、减少动态效果和 200% 缩放。

### 变更

- Issue 执行会在创建 TaskRun 前解析 Agent 与 Project Resource Runtime 绑定，并拒绝显式绑定不一致的上下文。
- Runtime 工作区根目录必须是已存在、可写、安全且非符号链接的绝对目录，并在创建 worktree 前再次校验。
- 启动派发前会协调 pending/running Command 以及损坏的 TaskRun、Issue 和 Delegation 指针。

### 安全

- 所有 JSON 变更请求现在都要求 `application/json`，并继续执行 2 MiB 有界解析、同源校验、回环读取与串行变更。

## [1.4.0] - 2026-08-21

### 新增

- 新增可持久化的项目智能体成员关系，支持项目内职责、显式 AI 规划匹配资格、负责人、软删除历史和旧任务指派的幂等回填。
- 新增原子项目成员与任务分配 API、本地隐私友好的功能使用聚合，以及关联计划、Issue、TaskRun、Agent 和 Runtime 事实的项目编排状态。
- 在响应式 Web 工作台中增加项目智能体管理与任务分配流程。

### 变更

- 规划、Task 与项目范围 Issue 指派、审批、重试和执行现在要求 active 项目成员资格；每个已批准 Task 都必须有明确 Agent，执行时不再使用工作区全局回退 Agent。
- Squads 和 Runtimes 移入渐进式导航，同时通过上下文入口保持异常执行状态可直接到达。

## [1.3.5] - 2026-08-21

### 新增

- 支持导入 PDF 需求与技术方案，将逐页提取的文字和渲染后的页面图片一并发送给所选 Harness AI 模型，也能处理仅包含扫描图片的 PDF。
- 新增替换或追加导入、分阶段进度、取消、抽样与截断提示，以及可编辑的 Markdown 输出；导入不会隐式保存 Project 或启动规划。
- 在项目 README 中增加微信支付和支付宝支持入口。

### 修复

- 删除 Project 时完整级联清理其 Tasks、Issues、审批、Runs、TaskRuns、Decisions、Delegations、Transcripts、Artifacts、Commands、Triggers、Leases 和本地目录锁，同时保留共享 Agents、Squads、Runtimes 与 Harness Workspaces。
- 子记录清理失败时保留 Project 本身，从而可以安全重试删除。

### 安全

- PDF 导入会在 AI 分析前校验规范 Base64、图片格式、尺寸、像素与字节限制、模型图片能力、同源 JSON 请求、并发上限、请求取消和三分钟超时。
- PDF 提取文字与页面图片被明确视为不可信证据，不能启用工具或覆盖需求分析约束。

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
