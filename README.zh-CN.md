# dsh-project-orchestrator

[English](README.md) | 简体中文

一个面向 [DeepSeek Harness](https://github.com/deepseek-ai/DeepSeek-Harness) 的持久化、审批驱动项目编排工作台。

`dsh-project-orchestrator` 为现有 Harness 安装提供 Host 服务、响应式 Web 工作台和仅限本机回环地址访问的 CLI。它把项目（Project）、事项（Issue）、任务运行（TaskRun）、人工决策（Decision）、Agent 容量、Git worktree 证据、执行记录（Transcript）、产物（Artifact）和自动化回执统一到一个可审计的本地工作流中。

> **兼容性说明：** v1.1.0 仅针对 DeepSeek Harness `0.1.0-rc.6`、Cordis `4.0.1`、Node.js 22+ 和 Git 完成兼容性验证。后续 Harness 候选版本需要经过测试后才会纳入支持范围。

## 核心特性

- **审批后执行：** AI 先生成与修订版本和哈希绑定的计划，只有获得明确批准后才开始执行。
- **持久化事项执行：** 分配、重新分配、停止、继续、评审和决策请求最终都会收敛为幂等的 Command 记录。
- **运行时与容量控制：** 支持 Runtime 心跳、Agent `maxConcurrency`、队列保留、重启恢复、目录锁和工作区租约。
- **真实 Git 隔离：** 以失败关闭方式创建 worktree，使用确定性分支，记录基准/最终提交、受限差异、产物和清理证据。
- **人工协作：** 提供收件箱、评审门禁、评论、活动记录、Squad、委派子事项和 Leader 续作能力。
- **可审计自动化：** 提供有界 Autopilot、外部触发去重、回环 CLI、执行记录脱敏，并明确标记未知的 Token/成本数据。
- **响应式工作台：** 在现有 Harness Web Shell 中提供收件箱、事项、项目、Agent、Squad、Runtime、Skill 和自主交付页面。
- **项目环境发现：** 已批准的命令会优先使用 `<project>/.venv`（如存在），并记录最终解析出的执行环境。
- **中文优先规划：** 新项目默认生成简体中文任务，也可切换为英文；尚未执行的旧计划可以重新生成中文版本，并且必须重新审批。

## 安装

Harness Profile 插件管理器负责提供所需的 Host peer 依赖，因此请先安装 pnpm，再添加 npm 包。不要依赖 npm 的 peer 自动解析，把本插件当作独立应用安装；Harness `0.1.0-rc.6` 的预发布传递 peer 范围可能会解析出混合 RC 版本依赖树。

```bash
npm install --global pnpm
dsh plugin --profile web add dsh-project-orchestrator@1.1.0
```

把插件加入 Web Profile 的 Loader Patch，通常是 `~/.dsh/profiles/web/cordis.patch.yml`：

```yaml
- id: project-orchestrator
  name: dsh-project-orchestrator
```

重启现有的 `dsh web` 进程，然后刷新当前访问地址。不要为同一个 Profile 启动第二个 Web 服务。

验证 Host 端：

```bash
curl --fail http://127.0.0.1:3080/project-orchestrator/api/health
```

启动入口会显示在 Harness 侧边栏底部。

## CLI

随包提供的 CLI 与 Web 客户端调用同一个本机回环 API，并拒绝访问非回环地址：

```bash
dsh-project-orchestrator --help
dsh-project-orchestrator snapshot
dsh-project-orchestrator inbox
dsh-project-orchestrator stats
dsh-project-orchestrator command '{"type":"autopilot_tick","actorType":"human","payload":{"agentId":"...","limit":10}}'
```

只有当 Harness 仍监听本机回环地址时，才可以覆盖默认 API 地址：

```bash
DSH_PROJECT_ORCHESTRATOR_URL=http://127.0.0.1:3080/project-orchestrator/api \
  dsh-project-orchestrator stats
```

## 执行模型

1. Project 持有已批准计划和资源（Resource）。
2. Issue 持有分配关系、生命周期、评审状态及其当前 TaskRun 指针。
3. TaskRun 表示一次排队/执行尝试，并持有对应证据。
4. Runtime 控制本地调度资格，Agent 提供执行容量。
5. 执行前必须先获取 worktree 或原地工作区租约。
6. Harness Session 事件会被投影为有界、已脱敏的 Transcript 条目。
7. 工作区清理和证据归档完成后，TaskRun 才会进入终态。
8. 只有人工评审通过，Issue 才能完成。

Runtime 记录代表本地 Harness Host 内的运行事实。v1.1.0 **不提供**远程 Agent 执行、双活 Host、分布式锁、远程分支推送或经过代码托管平台认证的 Pull Request 创建能力。

## 安全模型

- 修改操作要求请求来自回环 Peer 和回环 Host，并具有匹配的 `Origin` 与同源 Fetch Metadata。
- CLI 只接受回环地址。
- 子进程环境会移除疑似凭证的环境变量。
- Transcript 投影有大小限制，并尽力对疑似凭证的文本执行脱敏。
- 已批准的测试命令会有意通过平台 Shell 执行。拥有完整工具权限的 Agent 可以修改所选工作区。

在敏感仓库中使用本插件前，请先阅读 [SECURITY.md](SECURITY.md)。如果无法完全信任仓库内容，请使用专用操作系统账户或更强的沙箱隔离。

## 存储与恢复

存储域名为 `project_orchestrator`；标准本地 Profile 通常把数据持久化到 `~/.dsh/storages/project_orchestrator.json`。升级或执行破坏性维护前，请先停止 Harness，再备份此文件。

存储版本 1 会把缺失的新表视为空兼容表。v1 系列支持向前迁移，但不保证降级安全。详见 [docs/operations.md](docs/operations.md)。

## 开发

```bash
corepack enable
pnpm install --frozen-lockfile
pnpm verify
```

常用命令：

```bash
pnpm typecheck
pnpm test
pnpm build
pnpm smoke:package
```

包冒烟测试会构建实际发布的 npm 产物，检查文件白名单和可执行权限，在干净的临时项目中完成安装，验证 CLI 帮助/版本命令，并拒绝包含绝对用户目录路径的 Source Map。

## 文档

- [架构与事实来源规则](docs/architecture.md)
- [HTTP 与 CLI 契约](docs/api.md)
- [兼容性与稳定性策略](docs/compatibility.md)
- [运维、备份、升级与回滚](docs/operations.md)
- [从本地或 Scope 构建迁移](docs/migration.md)
- [维护者发布手册](docs/releasing.md)
- [贡献指南](CONTRIBUTING.md)
- [安全策略](SECURITY.md)
- [支持策略](SUPPORT.md)
- [治理规则](GOVERNANCE.md)
- [变更日志](CHANGELOG.md)

> 以上专题文档目前以英文提供。

## 项目状态与关联声明

这是一个独立的社区插件，并非 DeepSeek 或 DeepSeek Harness 官方项目。DeepSeek 及相关名称可能是其各自所有者的商标。

## 许可证

[MIT](LICENSE) © 2026 zhangz-2018
