# 兼容性与稳定性

[English](compatibility.md) | 简体中文

## 已认证矩阵

| Plugin | DeepSeek Harness | Cordis | Node.js | Git | 平台 |
|---|---|---|---|---|---|
| 1.x | 0.1.0-rc.6 | 4.0.1 | >=22 | worktree 必需 | Linux 和 macOS CI；Windows 未认证 |

Harness 预发布版本的 SemVer 不表示不同 release candidate 之间兼容。修改 peer 范围前，必须验证未来每一个 Harness RC 或稳定版本。Harness 软件包采用可选 peer，是因为 profile Host 会提供这些依赖；普通 npm 安装如果自动解析 peer，可能根据上游预发布范围构造出无效的混合 RC 依赖树。请使用 Harness `dsh plugin` 管理器和以 pnpm 为基础的 profile，不要把本软件包当作独立 Node 应用安装。

## v1 稳定契约

在 1.x 系列中，以下内容属于公共兼容性契约：

- 软件包根 export、`./client` 和 CLI binary 名称；
- HTTP 路由路径、已记录的状态码类别，以及结构化的 `{ error: { code, message } }` 失败响应；
- `POST /projects` 省略创建模式时继续沿用旧版 AI 拆解，而显式 `mode: "empty"` 返回不启动规划的 `201` draft；
- Command 幂等语义和评审归属语义；
- 存储域名称和可向前读取的版本 1 记录；
- 排队工作恢复和终态清理顺序；
- 对未知 token 与成本数据明确保持缺失，而不是伪造数值。

minor 版本可以新增可选字段、读取路由、Inbox 投影、Artifact 类型以及向后兼容的 Command。

## 破坏性变更

以下变更需要新的 major 版本：

- 删除或重命名 export、路由、Command 或 CLI verb；
- 改变 Issue、评审、幂等或终态结算的归属；
- 在没有导出/导入路径的情况下执行破坏性存储迁移；
- 把 Runtime 语义扩展为远程执行，并因此改变当前安全假设。

## 已知边界

- 每个存储域只支持一个活动 Harness Host；
- 远程或经过反向代理的变更客户端按设计无法通过 loopback 和 same-origin 策略；
- Windows 的进程组、shell、Git worktree 和本地目录打开均未认证；
- 本地目录打开只认证了 macOS `open` 和 Linux `xdg-open`，并且按设计不向远程或反向代理客户端开放；
- PR 支持只存储引用和证据，不会推送，也不会向代码托管平台认证；
- Transcript 脱敏属于尽力而为，不是 DLP 系统。
