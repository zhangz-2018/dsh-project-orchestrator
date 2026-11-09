# dsh 原生能力接入实施与验收记录

日期：2026-11-09。对应[设计方案](dsh-native-integration-design-2026-11-09.zh-CN.md)。基线为官方 `0.2.2-rc.1`、Cordis `4.1.0`、Node.js `24.22.2`，本机 macOS。

## 1. 实施范围

| 阶段 | 当前结果 | 实际边界 |
|---|---|---|
| A 基础适配 | 已接入 rc.1 接口，真实 Host 验证通过 | 延续已有版本适配；未升级用户日常 Host |
| B 只读集成 | 能力诊断、PR 本地绑定、共享状态、完整 checks、diff、检查参考 Artifact、原生 Session 导航 | 不创建、评论、approve、ready 或 merge 远端 PR；外部状态不能自动通过验收 |
| C 执行基础 | 验证命令、Service Git、规划绑定 Git、交付 Git 证据共用 CommandRunner；Host 使用原生 subprocess | CLI 显式使用 Node；Host 服务缺失拒绝执行；没有宣称文件或网络沙箱 |
| D 协作试点 | TaskRun 内的受控只读子任务已实现并通过确定性生命周期测试 | 默认关闭；一次请求、无工具、不能新建项目任务或改变审批；尚未证明真实模型评审质量 |
| E 可选体验 | 诊断服务存在性并复用原生会话入口 | Team、Auto review、搜索研究阶段、提醒业务触发、语音需求保存和市场安装自动化均未启用；按设计分别评估，不作为本期核心包加载前提 |

项目审批、可信能力、TaskRun、worktree lease、独立验证与交付仍由本项目管理。没有新增 `human_confirmed` 事实，没有修改已有发布指标或补造真实评测结果。

## 2. 使用入口与接口

工作台“更多 → 运行环境”展示 Host 原生能力。`服务已加载` 仅证明 Cordis 服务存在，不表示 provider 已登录或执行策略有效。PR 的登录就绪通过具体仓库的 Forge readiness 探测。TaskRun 与 Issue 历史中已有的 Session 可直接打开。

项目概览的 Pull Request 面板支持本地关联、完整检查、diff、保存检查参考和解除本地关联。保存时须填写规范 HTTPS PR URL 和已审阅的本地 HEAD；服务核对实际 HEAD、origin 仓库与 provider 身份。绑定为一项目一条，采用 `expectedUpdatedAt` CAS，初次关联传 `null`。换绑后需重新审阅。

以下路径均相对于 `/project-orchestrator/api`：

| 请求 | 行为 |
|---|---|
| `GET /native-capabilities` | 当前服务存在性与实际命令后端 |
| `GET /projects/:id/pull-request` | 本地关联和 Forge 共享观察值，包含加载、失败、过期与 head 一致性 |
| `GET /projects/:id/pull-request/checks` | 完整检查；错误仓库、旧 head 或截断均拒绝 |
| `GET /projects/:id/pull-request/diff` | 有界 diff，读取前后校验 checks/head 和本地绑定 CAS |
| `PUT /projects/:id/pull-request` | `{url, expectedHead, expectedUpdatedAt}`，仅写本地绑定 |
| `DELETE /projects/:id/pull-request` | `{expectedUpdatedAt}`，仅解除本地绑定 |
| `POST /projects/:id/pull-request/evidence` | 保存完整检查参考，返回 `201` 和 artifactId |

读取限于 loopback；写入继续要求 same-origin JSON 并经过 Service writer。checks/diff 最长 30 秒；diff 上限 100 KB，检查参考内容上限 100000 字符。超过 120 秒的轮询值标记过期；网页每 10 秒读取共享观察，不另建远端轮询器。缺 Forge、无登录、限流、provider 撤销和旧 head 均不能产生有效验收证据。

参考 Artifact 明确记录 `source: forge`、精确 head、采集时间、绑定版本、`checksComplete: true` 和 `acceptanceEffect: none`。不会创建 VerificationEvidence、批准 Review 或确认交付。当前展示审阅汇总及未解决讨论数量，不导入远端评论正文。

## 3. 命令与执行策略

Host 在 `src/index.ts` 显式注入 `ctx.subprocess`，缺服务返回 `subprocess-unavailable`；CLI 及无 Host 的独立调用保留本地 Node 后端。保持 argv/shell 区别、cwd、`.venv`、有界输出、超时、取消、退出码和进程范围清理。命令退出后还须等待 provider 确认范围清空，清理失败继续报告失败。

默认从环境过滤凭据形状变量和所有 ambient `DSH_*`。只有验证器显式传入的六个 `DSH_VERIFICATION_*` 报告握手字段可恢复，不能由父环境自动继承。此过滤是减少环境泄漏，不是文件隔离，不能阻止已授权脚本主动读取本机文件。

subprocess 接管进程生命周期，不自动接入 Auto review 或文件/网络沙箱。服务端验证命令依据现有冻结命令与业务授权运行，不把用户会话的只读工具策略当作操作系统沙箱。目录打开和远端 clone 的既有专用进程路径本轮保留；没有声称项目每一处进程都已迁移。

## 4. 只读子任务试点

默认关闭。仅在隔离 Host 明确设置 `DSH_PO_NATIVE_READONLY_PILOT=1` 后，合格 TaskRun 的 scoped tools 才注册 `review_task_evidence`。不向 HTTP 暴露子任务派发接口。

派发要求：精确在线父 Agent、原 active 成员、running TaskRun、批准 revision、当前 plan、dispatch 身份与未变的执行契约摘要。证据输入 1–16000 字符，每 TaskRun 最多一次；派发前持久占用配额，失败、取消或重启均不退还、不自动重试。

子任务继承父模型 provider/model，完整模型输入最多 24000 字符，最多一次模型请求和 1024 输出 token，60 秒限时。预算记录归属父 TaskRun；不根据未知模型计价推算金额，也不宣称已有完整父子成本汇总。子 Agent 不挂载标准工具预设，工具白名单为空并有拒绝 guard；即使模型请求工具，也不能执行或消耗第二次请求。middleware 同时覆盖重试请求。

使用官方 subagents 的一次性 provider seam 管理 activation，provider 内部持有受限 Agent。官方禁止外部 activation 与已存在的 Agent/Session 重用身份，因此分别记录 `activationId` 和实际 `childSessionId`，以及 rootSessionId、原成员和执行契约。取消会释放该次 activation 并等待内部 Agent；迟到结果重新校验父状态。输出仅为参考 Artifact，不替代独立测试。

重启将仍为 admitted 的配额记录标记 interrupted，不冷恢复子任务。Team 共享 cwd、CAS 任务板和写协作没有启用，亦没有相应可用性结论。

## 5. 存储与恢复

新增独立 `pull_request_bindings` 表，记录 `schemaVersion: 1`，沿用 domain version 1 的增量表模式。旧数据缺表时读取为空；不改写 Project revision、审批摘要或可信能力。watcher 为进程内资源，重启第一次读取根据持久绑定重建，换绑、解绑、删除项目或关闭服务释放。

Cordis 服务代理每次访问可能不同。watcher/provider 注册通过公开的 `symbols.original` 比较底层服务身份，但保留代理进行方法调用，避免丢失 effect 归属。这已由实际 Forge 轮询测试覆盖。

JSON 副本实验验证了旧表读取、创建关联、重启恢复关联和参考 Artifact、provider 撤销、旧定义重新读取原项目。该实验不证明旧程序写入时会保留所有新表。升级真实 Host 前仍应停机备份整个 DSH_HOME；回滚程序时恢复匹配的数据快照。只需停用试点时移除开关并重启；解除 PR 本地绑定不改变远端 PR。

## 6. 验证结果与限制

- `pnpm run build`、`pnpm run typecheck`：通过。
- `node --test --test-reporter=tap tests/*.test.mjs`：538/538 通过，0 跳过，记录见本地 `output/native-regression.tap`；含原回归与新增原生集成、真实 LocalSubprocessRuntime、JSON/Forge 用例。
- `PO_TEST_BROWSER_CHANNEL=chrome pnpm exec playwright test`：7/7 通过，包含 1280×720、390×844 布局、失败表单保留、Session 导航和原有项目生命周期。
- `pnpm run smoke:package`：通过，实际 tarball 安装、CLI help/version 与公开产物检查通过。
- `pnpm run eval:planning:subset`：5/5 固定样本通过；不是新增真实模型评测，输出明确显示完整发布资格未满足。
- `scripts/verify-dsh-compatibility.mjs`：在隔离 home 使用实际 rc.1 Host 与本地确定性模型，8 项检查通过；覆盖 Agent/Session、模型失败、工具拒绝、取消、只读子任务与重启。运行前比对当前源码产物与安装包 SHA-256。

浏览器截图保存在本地 `output/playwright/native-pr-1280.png` 和 `native-pr-390.png`；Host 报告保存在 `output/compatibility/`。本轮未访问用户 GitHub 认证、未调用外部模型、未开启用户 Host 实验插件、未部署或发布。

GitHub `gh` 的真实登录/限流仅以失败注入和确定性 provider 验证，未做真实账号端到端测试。没有 OS 沙箱认证，没有真实模型质量对照、Team CAS 或 Auto review allow 的端到端认证。本轮原生接入结果不能代替整个项目的真实模型发布评测与交付门禁。
