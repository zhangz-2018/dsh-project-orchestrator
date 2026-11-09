# dsh 0.2.2-rc.1 适配与验收记录

日期：2026-11-09。范围：当前工作区源码适配官方 npm `@deepseek-ai/dsh@0.2.2-rc.1`，不升级用户现有 Host、不迁移真实业务数据、不发布 npm 包。

## 目标与边界

官方 npm registry 的 `latest`、`next` 均为 `0.2.2-rc.1`，发布时间为 2026-11-04。官方包声明 Node.js `>=24.9.0`、Cordis `~4.1.0`，Harness 组件精确依赖 `0.2.2-rc.1`。依据为 `npm view @deepseek-ai/dsh@0.2.2-rc.1` 及该版本发布包的类型声明和运行实现。

本轮验收环境为 macOS、Node.js `v24.22.2`、pnpm `10.34.5`，使用新建的临时安装目录、独立 DSH_HOME、独立存储与锁目录。默认 Node.js、已有 3080/3087 服务及其数据未被变更。

## 接口适配

| 原接口或要求 | 新版适配 |
|---|---|
| Node.js >=22、Cordis ^4.0.1 | Node.js >=24.9.0、Cordis ~4.1.0；CI 与 release 工作流改用 Node 24 |
| `dsh-agent-presets` | `dsh-agent-preset-registry`，继续使用 `agentPresets.mount` |
| `dsh-client-runtime` | Cordis `Context`，工作区 Controller 与 UI 导航服务分别声明依赖 |
| `workspaces.pickDirectory/listDirectory/startSession` | `uiWorkspace.pickDirectory/listDirectory/startSession`；创建工作区仍归 `workspaces.create` |
| slots 类型由旧 runtime 间接提供 | 显式声明 `dsh-client-ui-renderer/client` |
| 图标按 14/16 尺寸命名 | 使用新版 Medium 导出，本地别名保持现有布局引用 |
| `Session.events` | `sessionQuery.readSession`，响应和终态从同一快照读取 |
| 异步转录查询清理 | 等待在途查询，传播失败；即使最终转录写入失败也释放 Agent 句柄 |
| 项目摘要换行后的布局 | 禁止摘要带被 flex 压缩，保留内容高度，避免与工作目录重叠 |
| Loader Patch 中直接新增行 | 新增条目置于 `insert`；已有条目修改原声明，避免重复插入 |

所有直接 Harness peer/dev 依赖锁定 `0.2.2-rc.1`。Cordis loader/include 使用 `~1.1.0`，冻结锁文件安装已通过且没有新旧 peer 混用告警。Host 依赖仍由 Profile 提供，未放入插件运行时 dependencies。前端 `window.__ModuleLoader__.load({id, factory})` 协议经新版发布包核对仍然适用。

存储域名称和业务记录 Schema 未变更；本轮验证新版存储读写与重启恢复，未声称完成真实旧 Host 数据或 Session 格式的升级验收。

## 实际验证

- 类型检查、构建通过。
- 最终完整 Node 回归：526/526 通过，包含查询失败仍释放句柄的新增回归。布局调整后，前端构建契约 8/8 通过。
- 浏览器回归：6/6 通过，涵盖项目创建、重启恢复、恢复授权边界、刷新失败及分页；这些用例使用真实存储和受控 Host fixture。
- 规划本地样例：`large-typescript-owner` 的 5/5 运行通过。该结果是本地样例验证，不是新增真实模型评测。
- 冻结锁文件离线安装通过。
- 打包安装 smoke 通过，校验包内容、依赖边界、CLI 权限与 help/version；首次下载超时后，从官方 registry 下载 PDF.js 原始发布包并预热 pnpm 内容缓存，未降低断言或修改依赖版本范围。
- 真实新版 CLI、完整 Web Profile 和已打包插件的 6 项检查通过：插件激活；Agent 预设、流式输出、会话查询和释放；模型错误显式返回 502；工具 guard 拒绝执行且无 Agent 泄漏；真实取消及释放；写入空项目后停止并重启 Host，数据恢复。
- 真实新版 Web 页面人工流程检查：侧边栏入口、项目列表、新建与编辑对话框、保存隔离项目后创建并关联 Workspace、打开 Workspace 后出现新会话；未发送会话消息。控制台 Errors 0、Warnings 0。
- 桌面 1280x720 与窄屏 390x844 已截图检查；窄屏页面实际宽度与视口均为 390px，摘要内容底部 332px、下一节从 347px 开始，没有该处重叠。截图位于 `output/playwright/dsh-022-desktop.png` 和 `output/playwright/dsh-022-mobile.png`。

真实 Host 检查使用本地确定性 LLM adapter，不访问外部模型、不发送项目内容、不产生模型费用。它验证新版生命周期和协议集成，不证明真实模型质量。

机器报告保留在工作区 `output/compatibility/dsh-0.2.2-rc.1-1794218078957.json`，包含检查项、执行环境与实际产物 SHA-256；输出目录不随 npm 包发布。该轮已测产物：

```text
lib/index.js   2612b55a0e0db9c4ba03d88007beebe688e8f54793bdf47ceda0d4c7274aef41
lib/client.js  ae70665e8f60749cfd6d6f31ebf5709b7ad2581cd5d756484ebf85d54d6840f4
```

上述初轮报告先于布局修复。修复后的最终产物已重新打包并离线安装到隔离目录，由相同集成脚本复验 6/6 通过，最终报告为 `output/compatibility/dsh-0.2.2-rc.1-1794219555313.json`；其中 `lib/client.js` SHA-256 为 `5541d3d6d69d10919b3cbb0bd69b7e1ee1dfb13fb164de4e75759235f822d8ce`，服务端摘要不变。布局修改后的浏览器回归再次 6/6 通过，最终包 smoke 通过（155 个文件），文档检查 66 个 Markdown 通过。

独立安装遇到 npm 对最新版 PDF.js 的下载超时，因此真实 Host fixture 使用从当前锁定的 `pdfjs-dist@6.2.108` 本地安装内容打包的依赖。未修改其源码；该测试不是无缓存全新网络安装证明。

## 复验方式

使用 Node.js >=24.9.0。在源码目录执行：

```bash
pnpm install --frozen-lockfile
pnpm verify
```

真实 Harness 集成验证另建一次性安装目录，安装官方 `@deepseek-ai/dsh@0.2.2-rc.1` 和刚由 `pnpm pack` 生成的本地插件包，然后运行：

```bash
PO_DSH_COMPAT_ROOT=/absolute/path/to/isolated-install node scripts/verify-dsh-compatibility.mjs
```

脚本先核对官方版本和已安装插件与当前源码构建产物的摘要，创建全新 home，启动真实 Web Profile、调用回环接口、重启并验证存储，最后关闭自己创建的子进程。测试用 provider 位于 `tests/support/dsh-compat-provider.mjs`，不会包含在发布包中。报告保留隔离目录以便复核，禁止指向现有用户 Profile。

## 发布边界

本次适配未部署到现有 Host，未提交、未发布，包版本仍沿用工作区的 `1.7.0`。安装新版适配需要从当前源码打包，不能把 npm 已发布同名版本视为包含本次改动。

Linux CI 尚未在本轮远程运行，Windows 未认证。旧版完整真实模型发布评测仍有未通过项；本次兼容性验证不能将其改写成“项目正式发布验收通过”。升级现有环境前应备份整个旧 DSH_HOME，保留旧版程序和数据快照；需要恢复时恢复成套程序与备份，不能假定只回滚插件就能恢复新版 Host 写过的 Session。

本轮浏览器与专用 Host 进程均已关闭。隔离安装目录、报告关联 home 和包文件暂留用于复验，不作为生产安装；未清理历史评测文件。进一步复用原生能力的建议见[接入与最佳实践方案](dsh-native-integration-design-2026-11-09.zh-CN.md)，该方案尚未实施。
