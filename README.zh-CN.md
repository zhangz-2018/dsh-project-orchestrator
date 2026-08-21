# dsh-project-orchestrator

[English](README.md) | 简体中文

面向 [DeepSeek Harness](https://github.com/deepseek-ai/DeepSeek-Harness) 的本地项目编排工作台：先建立项目事实，再按需使用 AI，最后由人工批准执行。

它为现有 Harness Profile 增加 Host 服务、响应式 Web 工作台和仅限本机回环地址的 CLI。项目、事项、任务、Agent、运行证据、人工决策和自动化回执都会持久化到同一套可审计工作流中。

> **兼容性：** 当前 1.x 版本仅针对 DeepSeek Harness `0.1.0-rc.6`、Cordis `4.0.1`、Node.js 22+ 和 Git 完成认证。Windows 尚未认证。

## 先了解三个原则

1. **创建项目不等于调用 AI。** 新建窗口默认选择“空项目”，只保存名称和目录，不读取代码，不创建任务，也不会启动 Planner。
2. **AI 拆解是显式操作。** 只有选择“AI 智能拆解”，或者稍后点击“补充需求并让 AI 拆解”，才会读取需求并生成计划。
3. **计划不等于执行。** AI 生成的计划与 Revision 和 plan hash 绑定，必须由人明确批准后才能开始修改仓库。

## 创建项目

### 方式一：空项目（默认）

适合还没有 PRD、只想登记仓库、准备手动管理任务，或者暂时不希望 AI 介入的场景。

创建时只需要：

- 项目名称；
- 一个已存在的绝对工作目录。

创建结果：

- Project 状态为 `draft`；
- PRD 和技术方案可以为空；
- Task 数量为 0；
- 不创建审批记录；
- 不调用 Planner 或执行 Agent。

之后可以直接添加手动任务，也可以编辑项目，补充交付目标，再明确选择“保存并让 AI 重新规划”。

### 代码来源

创建项目时可以选择两类代码来源：

- **本地代码仓库：** 点击“选择目录”后使用 Host 原生选择器或站内目录浏览器。Host 会重新校验所选目录是已存在的绝对目录；创建成功后，Project 会自动创建或复用同路径的 DeepSeek Harness Workspace，并持久化关联。
- **GitHub 仓库：** 输入不含凭据的 `https://github.com/owner/repository` 地址，分页读取分支和开放 Issues，选择要拉取的分支。创建时会将该分支浅克隆到 Harness 受管目录，并把选中的 Issue 导入当前 Project；超过安全结果上限时会明确失败，不会静默截断。配置 `GITHUB_TOKEN` 或 `GH_TOKEN` 可提高 GitHub API 的访问额度。

选中的 Issue 会作为 Project 的长期事项保存；在 AI 模式下，如果没有另外填写交付简报，Issue 内容会作为 Planner 的输入。空项目仍不会调用 AI。

### 方式二：AI 智能拆解

适合已经有 PRD、验收目标或较完整交付说明的场景。需要提供工作目录和非空交付简报；技术方案可选。

Planner 会只读检查仓库结构与现有测试，生成人类可审阅的代码任务、测试任务、依赖关系和验证命令。新项目默认生成简体中文任务，也可以切换为英文。生成后仍需人工批准，AI 不会直接开始实施。计划生成后，可以点击“新增需求并拆分任务”提交另一份需求文档。每个批次保留独立需求和 Planner 会话，并把新任务追加到同一个需要审批的 Project 计划中。已有执行记录的 Project 不允许再追加拆分。

### 打开项目目录

项目详情中的“打开目录”会调用本机文件管理器：

- macOS：Finder；
- Linux：系统 `xdg-open` 对应的文件管理器；
- Windows：当前未认证，不承诺可用。

项目详情还可以打开关联的 DeepSeek Harness Workspace。对于 GitHub 项目，Workspace 对应指定分支实际浅克隆后的本地目录，不是 GitHub URL。Harness 会尽量复用该 Workspace 下已有会话，只有没有可复用会话时才创建空会话；反复打开 Project 不会反复创建新会话。上述操作只接受 Project ID。Host 会从持久化 Project 读取工作目录并在操作时重新校验；浏览器不能提交任意本机路径。

## 核心能力

- **审批后执行：** 计划与 Revision/hash 绑定，明确批准后才执行。
- **项目智能体成员：** 工作区可复用 Agent 必须显式加入 Project，设置项目职责和规划资格后，才能分配给该项目的 Task 或 Issue。
- **可恢复的事项执行：** 分配、重新分配、停止、继续、评审和决策请求收敛为幂等 Command。
- **Runtime 与容量控制：** 始终展示默认 Host，支持本机 Runtime 生命周期、Agent/Project Resource 绑定、心跳、Agent `maxConcurrency`、队列保留、重启恢复、目录锁和工作区租约。
- **真实 Git 隔离：** 以失败关闭方式创建 worktree，记录基准/最终提交、受限差异、产物和清理证据。
- **人工协作：** 收件箱、评审门禁、评论、Activity、可复用 Squad、项目资格、全局委派容量、委派子事项和 Leader 续作。
- **可审计自动化：** 有界 Autopilot、外部触发去重、回环 CLI、Transcript 脱敏，以及明确的未知 Token/成本状态。
- **项目环境发现：** 已批准命令优先使用 `<project>/.venv`（如存在），并记录最终执行环境。
- **响应式工作台：** 在原有 Harness Web Shell 中提供 Inbox、Issue、Project、交付看板、Agent 和 Skill，以及完整 Squad/Runtime 管理、绑定影响复核和本地数据入口。

## 安装

Harness Profile 插件管理器负责提供 Host peer 依赖。请先安装 pnpm，再通过 `dsh plugin` 安装已发布版本；不要把插件当作独立 Node 应用依赖 npm 自动解析 Harness 的预发布 peer。

```bash
npm install --global pnpm
dsh plugin --profile web add dsh-project-orchestrator@1.5.0
```

把插件加入 Web Profile 的 Loader Patch，通常是 `~/.dsh/profiles/web/cordis.patch.yml`：

```yaml
- id: project-orchestrator
  name: dsh-project-orchestrator
```

重启现有 `dsh web` 进程并刷新当前页面。不要为同一个 Profile 启动第二个 Web 服务。

验证 Host：

```bash
curl --fail http://127.0.0.1:3080/project-orchestrator/api/health
```

入口会出现在 Harness 侧边栏底部。

## CLI

CLI 与 Web 客户端调用同一个本机回环 API，并拒绝非回环地址：

```bash
dsh-project-orchestrator --help
dsh-project-orchestrator snapshot
dsh-project-orchestrator inbox
dsh-project-orchestrator stats
dsh-project-orchestrator command '{"type":"autopilot_tick","actorType":"human","payload":{"agentId":"...","limit":10}}'
```

只有 Harness 仍监听本机回环地址时，才可以覆盖默认 API 地址：

```bash
DSH_PROJECT_ORCHESTRATOR_URL=http://127.0.0.1:3080/project-orchestrator/api \
  dsh-project-orchestrator stats
```

## 执行模型

1. Project 保存交付简报、资源、计划版本、审批状态、负责人和具备资格的项目智能体成员。
2. 每个已批准 Task 都绑定明确的 active 项目智能体；成员资格本身不等同于执行指派。
3. Issue 保存分配关系、生命周期、评审状态和当前 TaskRun。
4. TaskRun 表示一次排队或执行尝试，并持有对应证据。
5. Runtime 控制本机调度资格，Agent 提供执行容量。
6. 执行前必须获取 worktree 或原地工作区租约。
7. Harness Session 事件会投影为有界、尽力脱敏的 Transcript。
8. 清理工作区并归档证据后，TaskRun 才会进入终态。
9. Issue 只有经过人工评审才可以完成。

Runtime 记录只代表当前 Harness Host 内的本地事实。1.x **不提供**远程 Agent 执行、双活 Host、分布式锁、远程分支推送或由代码托管平台认证的 Pull Request 创建。

## 安全边界

- 修改请求必须来自回环 Peer 和回环 Host，并具有匹配的 `Origin` 与同源 Fetch Metadata；这不是多租户身份认证。
- CLI 只接受回环地址。
- “打开目录”使用持久化 Project 路径、固定系统程序和独立 argv，不经过 shell。
- 子进程环境会移除疑似凭证的环境变量。
- Transcript 有大小限制，并尽力对疑似凭证文本脱敏；这不是 DLP。
- 已批准的测试命令会有意通过平台 Shell 执行；拥有完整工具权限的 Agent 可以修改所选工作区。

在敏感仓库中使用前，请阅读 [安全策略](SECURITY.zh-CN.md)。无法完全信任仓库内容时，应使用专用操作系统账户或更强的沙箱。

## 存储、备份与恢复

存储域名为 `project_orchestrator`；标准本地 Profile 通常持久化到 `~/.dsh/storages/project_orchestrator.json`。升级或执行破坏性维护前，请停止 Harness 并备份此文件。

存储版本 1 会把缺失的新表视为空兼容表。1.x 支持向前迁移，但不保证降级安全。详见 [运维文档](docs/operations.zh-CN.md)。

## 开发与验证

```bash
corepack enable
pnpm install --frozen-lockfile
pnpm verify
```

常用命令：

```bash
pnpm typecheck
pnpm docs:check
pnpm test
pnpm build
pnpm smoke:package
```

包冒烟测试会构建真实 npm 产物，检查文件白名单和可执行权限，在干净临时项目中安装并验证 CLI，同时拒绝包含绝对用户目录路径的 Source Map。

## 文档

- [HTTP 与 CLI 契约](docs/api.zh-CN.md)
- [架构与事实来源规则](docs/architecture.zh-CN.md)
- [兼容性与稳定性策略](docs/compatibility.zh-CN.md)
- [运维、备份、升级与回滚](docs/operations.zh-CN.md)
- [从本地或 Scope 构建迁移](docs/migration.zh-CN.md)
- [维护者发布手册](docs/releasing.zh-CN.md)
- [贡献指南](CONTRIBUTING.zh-CN.md)
- [安全策略](SECURITY.zh-CN.md)
- [支持策略](SUPPORT.zh-CN.md)
- [治理规则](GOVERNANCE.zh-CN.md)
- [行为准则](CODE_OF_CONDUCT.zh-CN.md)
- [变更日志](CHANGELOG.zh-CN.md)

## 请作者喝杯咖啡

如果这个项目对你有帮助，欢迎通过微信支付或支付宝请作者喝杯咖啡。感谢你的支持。

<p align="center">
  <img src="docs/assets/donate-alipay.jpg" alt="支付宝收款码" width="280">
</p>

## 项目声明

这是独立社区插件，并非 DeepSeek 或 DeepSeek Harness 官方项目。DeepSeek 及相关名称可能是其各自所有者的商标。

## 许可证

[MIT](LICENSE) © 2026 zhangz-2018
