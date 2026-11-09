# 1.7.0 发布候选状态

检查日期：2026-11-09。候选版本 `1.7.0`；公开 GitHub Release 和 npm latest 在本次检查时均为 `1.6.0`。本文件记录候选状态，不表示正式版本已经发布。

## 本次提交范围

包含工作区累积的 Planning V3、执行/交付证据与恢复修复、真实评测工具和失败账本，以及 dsh `0.2.2-rc.1` 原生接入。保留历史评测样本及失败记录，不以筛选记录取得发布资格。

原生接入的实施边界见[实施与验收记录](dsh-native-integration-implementation-2026-11-09.zh-CN.md)。本次不升级用户日常 Host，不启用 Team 写协作或 Auto review，不开启默认关闭的只读子任务试点。

## 生产依赖修复

- `zod` 从 `4.4.3` 更新到 `4.6.7`，运行时最低版本设为 `^4.6.6`；修复审计报告中的 GHSA-mrhx-c7xc-m3w5。
- `source-map-js` 从 `1.2.1` 更新到 `1.2.2`；修复 GHSA-68fv-2mgg-jv7q。
- pnpm overrides 将本仓库的传递依赖统一到上述精确版本。Harness 存储开发依赖固定旧版 Zod，与新版 Schema 共存时类型不兼容；统一版本后类型检查通过，没有修改业务 Schema 或降低校验。
- `pnpm audit --prod --audit-level high`：退出 0，报告 0 漏洞。审计范围是本项目生产依赖，不代表用户另行安装的 Host 依赖已升级。依赖下游不会自动继承本仓库的 pnpm overrides。

## 正式发布门禁：未通过

本次实际执行 `pnpm run eval:planning`，退出 1。默认 manifest 为 `planning-evals/release-manifest.json`，未改写阈值或选择其他 manifest 代替默认门禁。

| 项目 | 当前证据 |
| --- | --- |
| 候选规划 | 44 次，40 次通过 invariant |
| 需求样本 | 9 条，要求至少 24 条 |
| Gold ready | 缺失 |
| pending/resolved 配对 | 8 个 pending 场景缺少对应 resolved 场景 |
| 无合格成员场景 | 仅 4 个有效真实候选，要求至少 5 个 |
| 质量指标 | acceptance coverage、binding recall、abstention、阻塞原因及阶段证据覆盖等尚未达到门槛 |
| 本版交付 canary | 默认路径 `planning-evals/canary/release.json` 缺失 |

本地固定样本回归和确定性 Host 兼容性通过不能替代这些证据。历史 greeting canary 不能直接作为本次候选的同版验收证明。

生产依赖更新后，本次 `PO_TEST_BROWSER_CHANNEL=chrome pnpm verify` 退出 0：类型检查、文档检查、538 个 Node 测试（0 失败、0 跳过）、7 个浏览器测试、5 个固定规划样本和安装包 clean install 均通过。安装包检查共 165 个文件。浏览器使用本机 Chrome；GitHub CI 将另行验证 Linux/macOS Chromium。

本地命令报告保存在忽略提交的 `output/release-verify-2026-11-09.log`、`output/release-audit-2026-11-09.json` 和 `output/release-planning-gate-2026-11-09.log`。提交前的高置信凭据形状扫描未发现匹配，不代表完成了全面安全审计。

重新打包并校验安装包产物 SHA-256 后，隔离 rc.1 Host 的 8 项兼容性检查再次通过；使用本地确定性模型，没有调用外部模型。报告为 `output/compatibility/dsh-0.2.2-rc.1-1794222658350.json`。

## 发布顺序与恢复

先提交分支和 PR，运行 CI；GitHub Release 只能准备为 draft。正式门禁通过后，更新发布日期、合并 main，再按[发布手册](releasing.zh-CN.md)推送版本 tag，由 `release.yml` 完成 npm provenance 发布及正式 GitHub Release。当前不推送正式 tag、不直接调用 npm publish。

后续必须修复真实评测失败的归属原因，补齐同版样本、配对和交付证据，再重新运行完整门禁；不能仅补一个文件或重复采样稀释失败。当前没有部署或数据迁移。代码可回退到原 main `726e728`；真实 Host 的升级回退必须同时恢复匹配的 DSH_HOME 备份，不能只回滚程序。
