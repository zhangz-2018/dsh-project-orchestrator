# 安全政策

[English](SECURITY.md) | 简体中文

## 支持的版本

我们为 `docs/compatibility.zh-CN.md` 中认证的最新 1.x 版本提供安全修复。

## 报告漏洞

请勿创建公开 Issue。仓库发布后，请使用 GitHub 针对 `zhangz-2018/dsh-project-orchestrator` 的私密漏洞报告功能。如果私密报告不可用，请通过 GitHub profile 上显示的私密联系方式联系维护者，并在分享详细信息前申请安全的报告渠道。

请提供受影响的版本、影响、前置条件、复现步骤和最小概念验证。请勿包含真实凭据、私有仓库或未经脱敏的存储/session 数据。预计会在七天内收到确认；修复时间取决于严重程度以及 Harness 上游依赖项。

## 安全边界

运维人员必须理解以下预期能力：

- 已获批准的测试命令会在选定工作区中以 `shell: true` 执行；
- full-policy Agents 可以使用 Harness 工具读取和修改仓库文件；
- Git worktree 操作会创建分支并删除临时目录；
- Transcripts、命令 payload、错误、diff 和 Artifacts 可能会持久保留敏感的仓库上下文；
- 具有凭据特征的环境变量会被过滤，Transcript 文本也会尽最大努力进行脱敏，但这不构成全面的 secret detection 或 DLP；
- 存储采用本地 JSON，此插件不会对其加密；
- 变更操作防护基于 loopback 和 same-origin，而非用户身份认证或多租户授权；
- 打开目录操作会产生本地操作系统副作用：它仅接受 Project ID，解析已持久化的 `project.cwd`，拒绝过于宽泛的根目录，并在不使用 shell 的情况下调用固定的 macOS/Linux opener 可执行文件；same-origin 页面代码仍然可以触发该操作；
- macOS 和 Linux 的目录打开功能已通过认证；在通过认证前，Windows 目录打开功能有意不予支持；
- 假定只有一个 Host 进程；不支持对同一存储进行 active/active 访问。

请使用最小权限的操作系统账户运行 Harness，限制仓库访问权限，审查 Agent 工具策略，尽可能使用隔离的 worktree，保护存储文件，并且绝不要在未经审查的情况下批准来自不可信计划的命令。

## 不在范围内

如果报告成立的前提是已获授权的运维人员故意批准任意破坏性 shell 命令，则这类报告本身不属于漏洞。绕过批准、origin、工作区、脱敏或清理边界的行为属于范围内。
