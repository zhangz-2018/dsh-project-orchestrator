# dsh-project-orchestrator 整改修复技术方案

版本：Draft 1

状态：待评审

关联 PRD：[整改 PRD](remediation-prd.zh-CN.md)

## 1. 设计目标与约束

本方案针对全局审查中已确认的执行一致性、资源清理、幂等、恢复、测试和发布治理问题。优先保证 durable state、workspace state 和真实执行状态一致。

### 1.1 约束

- 保持 DSH `0.1.0-rc.6`、Cordis `4.0.1` 的 Host/Web 插件注册契约。
- 保持 `project_orchestrator` storage domain version 1 可读取现有记录。
- 保持 `/project-orchestrator/api`、根 export、`./client` 和 CLI 名称兼容。
- 当前系统只支持单 Host、单进程 serialized mutation；本方案不伪造分布式事务。
- 不直接修改已完成 TaskRun 的历史证据；只阻止 stale operation 推进当前 owner。
- 外部 shell command 的既有批准语义不变，仍由执行前审批和既有安全边界约束。

### 1.2 推荐实施顺序

1. 先增加状态机断言、测试 fixture 和故障注入能力。
2. 再抽取 workspace claim/release，统一 Project 与 Issue 执行。
3. 加入取消 ownership 校验和终态保护。
4. 加入 command/external trigger request digest。
5. 加入 restart recovery cleanup。
6. 最后处理 PDF reservation、package smoke、docs、CI/release。

## 2. 当前问题定位

| 问题 | 位置 | 根因 |
|---|---|---|
| 取消后复活 | `src/service.ts:1666-1710` | Agent 返回后只检查 deferred，不检查 cancelled/stale ownership |
| claim 泄漏 | `src/service.ts:1551-1618,1729-1745` | 清理以 lease record 存在为前提，lock/worktree 可能先于 lease 持久化 |
| Project 绕过 dispatch | `src/service.ts:2426-2507` | 普通执行直接使用 `project.cwd`，没有调用 claim/lease |
| trigger 冲突 | `src/service.ts:1312-1329` | 先按 key replay，未比较新 payload digest |
| command 冲突 | `src/service.ts:1277-1283` | idempotencyKey 没有关联 command request 内容 |
| restart 泄漏 | `src/service.ts:1748-1765` | 只标记 orphaned，不调用 worktree cleanup |
| PDF 超发 | `src/service.ts:822-841` | concurrency check 与 operation reserve 分离 |

## 3. 状态模型与不变量

### 3.1 TaskRun 终态不变量

TaskRun 的终态集合为：`completed`、`failed`、`cancelled`、`deferred`。每个写入终态的路径必须满足：

```text
current TaskRun exists
AND current status is non-terminal
AND current assignmentRevision == operation assignmentRevision
AND current Issue.activeTaskRunId == taskRun.id, when Issue context exists
AND operation owner has not been superseded
```

`cancelled`、`failed`、`completed`、`deferred` 均为收敛状态。任何后台 operation 发现当前状态已经是终态时，只能追加受限 activity 或 stale evidence，不能改变 status。

### 3.2 新增内部类型

建议在 `src/service.ts` 或新的 `src/execution.ts` 定义：

```ts
interface ExecutionOwnership {
  taskRunId: string
  projectId: string
  issueId?: string
  assignmentRevision?: number
}

interface WorkspaceClaim {
  mode: 'in_place' | 'worktree'
  sourcePath: string
  workspacePath: string
  resourceId?: string
  runtimeId?: string
  branchName?: string
  baseCommit?: string
  lockAcquired: boolean
  worktreeCreated: boolean
}

interface CleanupResult {
  released: boolean
  cleanupError?: string
}
```

内部对象不直接进入公共 API；持久化字段只在确有恢复价值时增加。

### 3.3 统一状态写入辅助函数

新增类似以下的集中函数，禁止执行路径直接散落写终态：

```ts
private async readExecutionOwnership(id: string): Promise<ExecutionOwnership | undefined>
private isCurrentExecution(owner: ExecutionOwnership, run: TaskRunRecord): boolean
private async settleTaskRun(
  owner: ExecutionOwnership,
  settlement: 'completed' | 'failed' | 'cancelled' | 'deferred',
  patch: Partial<TaskRunRecord>,
): Promise<boolean>
```

`settleTaskRun` 在 `serializedMutation` 内重新读取 TaskRun 和 Issue，进行状态、assignment revision、active pointer 校验；校验失败返回 `false`，不得写入当前 TaskRun 的新终态。

## 4. 取消竞态修复

### 4.1 修改点

涉及：

- `src/service.ts` 的 `stop_issue` 分支。
- `executeIssueTaskRun()`。
- 普通 Project `execute()`。
- `failIssueTaskRun()`、`releaseTaskRunLease()`。

### 4.2 stop_issue 语义

`stop_issue` 按以下顺序执行：

1. 在 serialized mutation 中读取 Issue 当前 active TaskRun。
2. 校验 TaskRun 仍属于 Issue 且处于 `queued`、`waiting_local_directory`、`dispatched` 或 `running`。
3. 先把 TaskRun 写为 `cancelled`，写入 `finishedReason: 'stopped'` 和完成时间。
4. 清除 Issue 的 `activeTaskRunId`，将 Issue 设置为 `cancelled` 或既有设计规定的 blocked 状态，不能进入 review。
5. 再发送 AbortSignal 和 Agent cancel。
6. 释放 lease；后台 Agent 即使晚返回也只能走 stale result 分支。

如果运行已经是终态，返回稳定的 `issue-not-running` 或既有幂等结果，不重复执行副作用。

### 4.3 executeIssueTaskRun 语义

在以下三个位置重复读取并校验 ownership：

1. `runAgent()` 返回后、写 transcript/artifact 前。
2. `collectGitEvidence()` 之后、Issue review transition 前。
3. 写入 `completed` 前。

建议流程：

```ts
const result = await this.runAgent(...)
const beforeEvidence = await this.readExecutionOwnership(id)
if (beforeEvidence === undefined || !(await this.canContinueExecution(beforeEvidence, 'evidence'))) {
  await this.recordStaleResult(id, result)
  return
}

await this.projectSessionTranscript(id, result.session)
await this.createRunArtifact(...)

const settled = await this.settleTaskRun(owner, 'completed', {
  sessionId: result.sessionId,
  finishedReason: 'completed',
  completedAt,
})
if (!settled) {
  await this.recordStaleResult(id, result)
  return
}

await this.transitionIssueToReviewIfOwned(owner)
```

`recordStaleResult` 不改变 `cancelled` TaskRun 状态；如果需要保留结果，使用独立 activity/artifact metadata 标记 `stale: true`，且不能覆盖用户已确认的 cancelled 事实。

## 5. Workspace claim 与补偿清理

### 5.1 抽取接口

将现有 `claimIssueTaskRun()` 中的资源选择、路径解析、锁、worktree 和 lease 逻辑抽到统一方法：

```ts
private async acquireWorkspace(run: TaskRunRecord): Promise<WorkspaceClaimed>
private async releaseWorkspace(
  run: TaskRunRecord,
  claim?: WorkspaceClaim,
  reason?: string,
): Promise<CleanupResult>
```

`acquireWorkspace` 必须返回包含实际 `workspacePath` 的 claimed run；普通 Project Task 和 Issue Task 都调用它。

### 5.2 Claim 阶段

推荐按以下顺序实施，并对每阶段记录补偿信息：

1. 校验 Project、Agent、Runtime、Resource、capacity 和 assignment ownership。
2. 将资源路径 `realpath` 为 canonical source path。
3. 对 `in_place` 尝试取得 `localDirectoryLocks`；已有其他 taskRun 则写 `waiting_local_directory` 并返回未 claim。
4. 对 `worktree` 创建临时 worktree，记录 `worktreeCreated: true` 和实际路径。
5. 写入 workspace lease，lease 应包含 source/workspace/mode/resource/runtime/branch/baseCommit。
6. 写入 TaskRun `dispatched`、workspace 和 cwd。
7. 只有第 6 步成功后才认为 claim 完整。

任意步骤失败时执行 `releaseWorkspace`，不能依赖 lease 是否已经落盘：

```ts
try {
  const claim = await prepareWorkspace(run)
  await persistLease(claim)
  await persistDispatchedRun(run, claim)
  return claimed
} catch (error) {
  await compensateWorkspace(run, claimState)
  throw error
}
```

### 5.3 补偿规则

- `lockAcquired`：仅当 lock 的 `taskRunId` 等于当前 run 时删除。
- `worktreeCreated`：对记录的 source/workspace 调用 `git worktree remove --force` 和 `git worktree prune`。
- cleanup 成功：若 lease 存在，标记 `released`。
- cleanup 失败：若 lease 存在，标记 `orphaned` 并写 `cleanupError`；若 lease 不存在，创建最小 recovery record 或 activity，保证启动恢复可发现。
- 所有 cleanup 操作必须幂等：目录已经不存在、worktree 已被移除时视为成功或记录无害的已清理结果。

禁止在 `finally` 中无条件删除不是当前 TaskRun 持有的 lock。

## 6. 统一普通 Project 执行

### 6.1 重构方向

保留 Project `RunRecord` 作为计划级聚合，但把每次 Task attempt 的执行改为统一 TaskRun dispatch：

```text
Project approval
  -> create queued TaskRun with assignment revision
  -> dispatcher acquires Runtime/Resource/workspace
  -> runAgent(cwd = taskRun.workspace)
  -> runCommand(testCommand, taskRun.workspace)
  -> collect evidence from taskRun.workspace
  -> settle TaskRun
  -> update Task/Run aggregate
  -> release workspace
```

普通 Project execution 不得再直接把 `project.cwd` 作为 Agent/test cwd。只有 workspace acquisition 失败时才使用既有明确错误或等待状态。

### 6.2 复用与边界

- `compileTaskPrompt` 继续生成 Project Task prompt，但 `runAgent` 接收实际 workspace。
- `runCommand` 的 cwd 使用 TaskRun `workspace ?? cwd`，不从 Project 记录重新取路径。
- Task dependencies、automatic retry 和 Run 聚合仍由 Project executor 管理。
- Issue execution 继续使用 Issue prompt 和 Issue ownership，但共用 workspace acquisition/release。
- 对已存在的旧 running record，恢复逻辑只按持久化 cwd/workspace 处理，不重写历史证据。

### 6.3 并发控制

dispatcher 在单 Host 内通过 `dispatching` 和 `serializedMutation` 串行 claim。Agent capacity 依据已 claim 的 `dispatched/running` TaskRun 计算。普通 Project Task 也必须先进入该计数体系，再启动 Agent。

## 7. Command 与 External Trigger 幂等

### 7.1 canonical request digest

`src/workflow.ts` 已有对象键排序和 SHA-256 digest 能力。将 `canonicalize`/digest helper 提升为可复用导出，或新增 `requestDigest()`：

```ts
export function commandRequestDigest(input: Pick<CommandInput,
  'type' | 'projectId' | 'issueId' | 'squadId' | 'actorType' | 'actorId' | 'payload'
>): string {
  return sha256(canonicalize({
    type: input.type,
    projectId: input.projectId ?? null,
    issueId: input.issueId ?? null,
    squadId: input.squadId ?? null,
    actorType: input.actorType,
    actorId: input.actorId ?? null,
    payload: input.payload,
  }))
}
```

数组顺序是否有语义必须按 command 类型决定；不能对 payload 数组一律排序。

### 7.2 Command 处理

`CommandRecord` 增加可选 `requestDigest`，旧记录缺失时兼容读取。`executeCommand` 必须在现有 serialized mutation 内：

1. 找到 idempotency key。
2. 计算当前请求 digest。
3. 已有记录且 digest 相同：按原逻辑 replay。
4. 已有记录且 digest 不同：抛出 `WorkflowError('command-idempotency-conflict', ..., 409)`。
5. 没有记录：插入 pending record，带 digest，再进入 running/apply。

如果需要减少 mutation 持有时间，可以把“key 检查与 pending 占位”放在 serialized mutation 内，把实际 Agent 操作放在外部，但必须保留 pending recovery 规则。

### 7.3 External trigger 处理

先对 `parsed.command` 计算 digest，再查 `(source, externalKey)`：

- digest 相同：返回已有 trigger。
- digest 不同：返回 `external-trigger-conflict` 409，保留原 trigger 不变。
- 不存在：写入 received trigger，再调用 `executeCommand`，外层 idempotency key 也必须使用同一 canonical command 语义。

API 文档应明确“same key 不代表不同 payload 可覆盖”。

## 8. Restart recovery 与 worktree 清理

### 8.1 恢复阶段顺序

`initialize()` 中建议按以下顺序：

1. 恢复 pending/running Command。
2. 读取所有非 released workspace lease。
3. 对每个 worktree lease 执行有界 cleanup。
4. 对 in-place lease 检查对应 TaskRun 是否仍 queued/dispatched/running；无有效 owner 则删除 lock。
5. 将中断 running TaskRun 标记 failed/blocked，或按既有恢复契约排队，但不得在清理完成前重新占用同一 workspace。
6. 重新请求 dispatcher。

### 8.2 Lease 终态

- `released`：workspace cleanup 成功，后续不再处理。
- `orphaned`：cleanup 失败或缺乏足够信息，保留诊断；启动时重试需有幂等保护。
- 可以新增 `cleanupAttemptedAt`、`cleanupError`、`recoveryAttempts`，均为可选字段。

### 8.3 超时与阻塞

Git cleanup 必须有明确超时，不能无限阻塞 Host 初始化。超时后写 orphaned 和 activity，继续恢复其他 lease；不要因为一个损坏 worktree 阻塞整个插件启动。

## 9. PDF import reservation

将 `reserveOperation` 前移到受控同步段，或新增专用计数器：

```ts
const operation = await this.reserveRequirementImport()
try {
  return await runImport(operation)
} finally {
  operation.release()
}
```

实现要求：

- reservation 的读取和写入不能被两个并发请求穿插。
- `AbortSignal`、超时、模型错误和图片校验失败都进入 `finally` 释放。
- 现有最多 2 个并发限制保持不变。
- 增加三个并发请求测试：前两项成功进入，第三项稳定得到 429；其中一个取消后，下一项可以进入。

## 10. 数据兼容与迁移

### 10.1 Schema

优先使用可选字段，避免 storage domain version 变更：

- `TaskRun`: `cleanupAttemptedAt`、`cleanupError`、`recoveryAttempts`、可选 `staleResultCount`。
- `WorkspaceLease`: 现有 `state` 扩展时必须保持旧状态可读；优先复用 `orphaned` 并增加诊断字段。
- `Command`: `requestDigest`。
- `ExternalTrigger`: 当前 `payloadDigest` 已存在，修复比较逻辑，不改字段名。

### 10.2 启动兼容

旧 Command 缺少 `requestDigest` 时：

- 只读展示不报错。
- 无法可靠重建原始输入时，不允许把旧记录当成新请求的匹配依据；对带同 key 的新请求返回 `command-idempotency-recovery-required`，或按项目明确的旧兼容策略处理。
- 不对历史 Command 重新执行 apply。

旧 lease 缺少新 cleanup 字段时按默认值处理；不得删除历史 evidence。

### 10.3 迁移文档

`docs/migration.md` 和中文版改为：

```text
VERSION=当前发布版本
安装 dsh-project-orchestrator@${VERSION}
```

文档必须说明：涉及成员语义、lease cleanup 或幂等行为的版本，回滚需要同时恢复旧 package 和 pre-upgrade storage backup。

## 11. 测试方案

### 11.1 单元测试

新增或扩展：

- `commandRequestDigest`：对象键顺序不同但语义相同得到相同 digest；type/target/payload 改变得到不同 digest。
- TaskRun settlement：cancelled、stale assignment、missing issue pointer 均拒绝 completed。
- cleanup ownership：只删除当前 run 的 lock；重复 cleanup 不报错。
- External trigger：相同 digest replay，不同 digest 409。
- PDF reservation：并发计数、异常释放、取消释放。

### 11.2 Service 集成测试

使用真实临时 Git repository 和故障注入 store：

1. Agent 延迟返回，先 stop Issue，确认最终 cancelled。
2. lock 写入后 lease 写入失败，确认 lock 清除。
3. worktree 创建后 TaskRun 写入失败，确认 worktree 和 metadata 清除。
4. 普通 Project 配置 worktree，记录 Agent cwd 和 test cwd，确认均为 worktree。
5. 两个 Task 共享 in-place 目录，确认一个等待而不是并发运行。
6. Runtime offline/capacity full，确认不启动 Agent。
7. restart recovery 删除 worktree；模拟 Git 失败时保留 orphaned 和 cleanupError。
8. 同 idempotency key 不同 command 返回 409；并发首次请求只产生一条 Command。
9. same external key 不同 payload 返回 409。

### 11.3 测试稳定性

- 将 `tests/service.test.mjs` 中固定 `30 ms` sleep 改为条件 polling。
- polling 超时错误带上最后 TaskRun/Run 状态、error、workspace 和 output 摘要。
- 所有 `/tmp` marker 改为 `mkdtemp` 生成的测试专属目录，并在 `finally` 删除。
- 长命令测试只等待明确终态，不用短于合法执行窗口的固定总超时。
- 故障注入 store 提供按 table/key/调用次数触发一次失败的可控接口。

### 11.4 HTTP、包和文档测试

- `http.test.mjs` 增加 malformed percent-encoding、encoded slash、空 path parameter。
- `package-smoke.mjs` 安装 tarball 后执行：

```bash
node --input-type=module -e "const m=await import('dsh-project-orchestrator'); if (m.name !== 'project-orchestrator') process.exit(1)"
node --input-type=module -e "const m=await import('dsh-project-orchestrator/client'); if (typeof m.apply !== 'function') process.exit(1)"
node --input-type=module -e "await import('dsh-project-orchestrator/lib/pdf.worker.mjs')"
```

必要时使用临时 app 的 `node_modules` 路径执行，避免从源码树误加载。

- docs smoke 解析 fragment：对本地 Markdown 标题生成 slug 集合，校验 `file.md#heading` 和当前文件 `#heading`。
- 保持不引入网络依赖的离线文档 smoke。

## 12. 发布与 CI 改造

### 12.1 CI

`.github/workflows/ci.yml` 增加：

- `pnpm audit --prod --audit-level high` 或 OSV scanner。
- 明确 `corepack prepare pnpm@10.34.5 --activate`，并在日志中验证 `pnpm --version`。
- 可选增加 package smoke 独立 job，避免 verify 内部失败原因不清晰。
- CI 使用 live Harness 验证时，明确将其作为单独 job/profile，不让普通单元测试依赖本地 profile。

### 12.2 Release workflow

`.github/workflows/release.yml` 增加：

1. tag 必须是 `v${package.json.version}`。
2. tag commit 必须位于受保护 `main` 的 ancestry 内，使用 API 或 checkout `fetch-depth: 0` 验证。
3. 读取 CHANGELOG，确认当前版本存在对应 section。
4. 验证 pnpm 版本和 lockfile。
5. 不在线无完整性校验地全局安装 npm；优先使用 setup-node 提供的 npm，或使用锁定版本/完整性校验的工具安装方式。
6. 继续保留 npm trusted publishing、environment protection 和 provenance。
7. 发布前验证 package smoke，发布后验证 provenance URL 和 clean Harness install。

tag 的创建权限、main branch protection 和 npm trusted publishing 配置仍需在 GitHub/npm 管理面手工核验，不能只靠 workflow 文件推断。

### 12.3 Dependabot

不要永久忽略 `@deepseek-ai/*` 而失去通知。建议：

- 保留精确版本约束，避免自动合并。
- 允许 Dependabot 提 PR，但要求人工完成 Harness compatibility matrix 和 client bundle/live smoke。
- 对 DSH peer 更新配置 label、reviewer 或单独的 update group。

## 13. 文档整改清单

| 文件 | 修复内容 |
|---|---|
| `docs/migration.md` / `.zh-CN.md` | 移除固定 `1.5.0`，改为当前/目标版本变量 |
| `SECURITY.md` / `.zh-CN.md` | 增加稳定、可验证的安全报告渠道 |
| `CODE_OF_CONDUCT.md` / `.zh-CN.md` | 指向可执行 enforcement 联系方式 |
| `docs/releasing.zh-CN.md` | 兼容性链接指向中文页面；同步英文内容 |
| `docs/operations.md` / `.zh-CN.md` | 给出 loader row、build、install、restart、refresh 的明确命令和 profile 目标 |
| `README.md` / `.zh-CN.md` | 顶部同步 Windows 未认证、未来 RC 未验证和版本范围 |
| `CONTRIBUTING.md` / `.zh-CN.md` | 区分 offline verify 与 live Harness validation，说明如何准备 profile |
| `docs/squads-runtimes-prd.zh-CN.md` | 修正 `Runtime或恢复默认` 排版 |
| `docs/api.md` / `.zh-CN.md` | 记录 idempotency digest 与 external trigger conflict 的 409 语义 |
| `docs/architecture.md` / `.zh-CN.md` | 记录统一 workspace acquisition、settlement 和 restart cleanup 不变量 |

## 14. 可观测性与错误码

新增错误码应保持结构化 JSON：

| 错误码 | HTTP | 含义 |
|---|---:|---|
| `command-idempotency-conflict` | 409 | 同一 key 对应不同 Command 请求 |
| `command-idempotency-recovery-required` | 409 | 旧记录无法安全重建 request digest |
| `external-trigger-conflict` | 409 | 同 source/key 对应不同 payload |
| `workspace-claim-compensation-failed` | 500 | claim 失败且补偿清理未完成 |
| `workspace-cleanup-failed` | 500 | 终态清理未完成，保留 orphaned 诊断 |
| `execution-stale-result` | 不直接作为请求错误 | 后台结果已失去 owner，不推进当前状态 |
| `requirement-import-busy` | 429 | 并发 PDF import reservation 已满 |

Activity 消息至少包含：projectId、taskRunId、workspace lease id（如有）、cleanup attempt、错误摘要和是否 stale。不要写入完整 prompt、凭据或未脱敏路径以外的敏感内容。

## 15. 验收矩阵

| 类别 | 必须通过 |
|---|---|
| 静态 | `typecheck`、lint/格式检查（如项目启用） |
| 单元 | digest、状态机、reservation、cleanup ownership |
| 集成 | 取消竞态、claim 故障注入、worktree、共享目录、restart recovery |
| API | 409 冲突、malformed route、错误结构 |
| 包 | root/client/worker/CLI 安装后 smoke |
| 文档 | 中英文核心文档链接、fragment、版本和平台声明 |
| 安全 | production dependency audit、secret scanning、包内容检查 |
| DSH | rc.6 clean profile Host activation、Web launcher、API health、卸载/重载 cleanup |
| 发布 | protected main ancestry、tag/version/changelog、npm provenance、安装后验证 |

所有验收项完成后，才可以把 PRD 状态从“待整改”改为“已完成”，并在 CHANGELOG 中说明行为变化、错误码和迁移/回滚影响。
