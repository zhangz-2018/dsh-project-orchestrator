# 1.7.0 正式验收恢复记录

日期：2026-11-09。目标保持正式 `1.7.0`，不采用预览版门槛。本次本地验证通过，正式发布验收仍未通过，未发布 npm 或 GitHub 正式 Release。

## 已修复

历史 `tool-fault-v34` 的 p-queue 后继操作在 TaskPreflight 阶段误报缺少 `nz` 工具源码及 8 个非法 `maxQueued` 变体。上游已冻结这些事实，但预检只收到任务摘要和部分仓库源码。

修复归属在 Service 到 TaskPreflight 的交接：传入同一仓库快照的 `verificationTools`，以及当前任务引用的完整验收场景；场景缺失、跨项目或跨操作时在模型调用前拒绝。工具源码仍是只读证据，不代表命令已成功执行。

新增两条回归先复现失败，再验证修复通过；Service 集成测试核对交接中的场景与存储记录完全一致。此结果证明交接缺陷修复，不代表历史 ky、Zod 失败已经通过真实复验。

## 隔离环境恢复

原临时环境 `po-certified-acceptance-EiDNyF` 已不存在；用户确认无其他备份。保留的原始需求、独立 Gold 审阅输入和能力登记回执可用于重建评测初始状态，不能恢复完整旧领域历史。

- 持久 home：本机 `output/acceptance/formal-170-20261109/home`，位于忽略提交的任务目录。
- 重建 25 个需求样本及运行副本，共 61 个原项目 ID。项目均从草稿重新开始；重建时间使用实际当前时间。
- 原 204 + 52 条能力登记逐条核对 Schema、原登记原因参与计算的摘要，并按原 ID、原项目、原成员和原内容恢复。没有新增人工确认。
- 团队 Persona 和 skills 摘要与留存输入核对；需求原文及 SourceManifest 核对一致。
- 不恢复旧 PlanningOperation、Task、TaskRun、Approval、Dispatch 或 DeliveryRecord；留存历史账本继续作为失败及诊断记录。
- 真实 Host：dsh `0.2.2-rc.1`、Cordis `4.1.0`、Node `24.22.2`。安装 bundle SHA-256 与当前源码构建一致。
- 只读 Host 核验确认 61 个项目、256 条原登记完全匹配；预览 GET 没有改变领域快照。

恢复工具为 `scripts/prepare-release-recovery.mjs`、`scripts/verify-release-recovery.mjs`。准备脚本只允许在新的 `output/acceptance/` 子目录创建恢复环境；输入缺失、摘要冲突或目录已存在时拒绝覆盖。运行时使用独立 `DSH_HOME`、workspace ID 和 writer-lock 目录。

Gold 工具新增 `PO_ACCEPTANCE_CONTEXT`，支持新版 patch 模型配置和版本化凭据引用；仍支持旧报告格式。凭据只复制网关所需引用，不进入报告、日志正文或 Git。

## 真实模型阻塞

网关为用户指定的 `http://47.253.229.128:18080/v1`，模型保持 `gpt-6.1-sol`。

| 实际请求 | 结果 |
| --- | --- |
| 携带现有凭据的 `GET /models` | HTTP 200，列出目标模型 |
| 新版 25 个样本的独立 Gold 审阅 | 全部 HTTP 503，未产生批准的 Gold |
| 最小 `POST /chat/completions` | HTTP 503 |
| 最小 `POST /responses` | HTTP 503 |

两个最小生成请求均返回 `Service temporarily unavailable`。当前证据可以排除此前的 401 认证问题；不能据此进一步确定网关内部根因。没有启动候选规划或任务执行，未把失败审阅计为有效候选。

本机证据保存在 `output/acceptance/formal-170-20261109/`：`recovery.json`、`host-inputs-verified-final.json`、`gateway-probes.json`、`gold-1` 至 `gold-3` 的请求、响应及失败记录。文件仍用于后续复现和验收，保留原件。

## 实际验证

- `PO_TEST_BROWSER_CHANNEL=chrome pnpm verify`：退出 0，543 条 Node 测试、7 条浏览器测试、类型检查、文档检查、固定规划样本及 clean install/package smoke 通过。
- `PO_DSH_COMPAT_ROOT=... node scripts/verify-dsh-compatibility.mjs`：退出 0，8 项真实隔离 Host 检查通过；使用本地确定性模型，不作为真实模型规划成绩。
- `pnpm audit --prod --audit-level high --json`：退出 0，0 漏洞。
- `pnpm eval:planning`：退出 1；默认正式 manifest 仍缺足够 ready/resolved 样本、完整有效候选及本版 canary。

本机日志为 `output/formal-170-verify-2026-11-09.log`、`output/formal-170-host-compatibility-2026-11-09.log`、`output/formal-170-audit-2026-11-09.json`、`output/formal-170-planning-gate-2026-11-09.log`。GitHub CI 结果需另行核对，不能用本地通过推定。

## 剩余发布条件

1. 恢复网关目标模型的生成服务，重新执行独立 Gold 审阅，保留已有 503 记录。
2. 在当前 bundle 上完成 8 仓库、25 样本、每样本至少 5 次有效独立真实规划，覆盖 8 对 pending/resolved 及无合格成员场景；保留所有失败，修复根因后重新验证。
3. 完成同版真实交付 canary、独立验证和所需人工交付确认。
4. 默认正式门禁、完整回归及 GitHub CI/CodeQL 通过后，才合并发布提交、创建 `v1.7.0` tag，执行正式 GitHub Release 和 npm provenance 发布。

尚未发布的代码可通过撤回本次修复提交恢复。隔离数据恢复应使用本次任务目录和对应 bundle，不能用代码回退代替数据恢复，也不能覆盖用户日常 Host。
