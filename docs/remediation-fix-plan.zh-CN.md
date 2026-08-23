# 整改修复方案

版本：Fix Plan 1

状态：已实施并完成仓库级验证

关联文档：[整改问题审查记录](remediation-review.zh-CN.md) | [整改 PRD](remediation-prd.zh-CN.md) | [整改技术方案](remediation-technical-design.zh-CN.md)

## 1. 目标与原则

本方案用于关闭 [整改问题审查记录](remediation-review.zh-CN.md) 中的 R-001 至 R-010。目标不是增加更多表面测试，而是让持久化状态、workspace 状态和真实执行 owner 在并发、取消、失败及重启场景下保持一致。

实施原则：

1. 所有会改变 TaskRun 终态的路径必须经过统一 settlement helper。
2. settlement 必须在 `serializedMutation()` 内重新读取最新记录，并在同一临界区完成 owner 校验和写入。
3. workspace cleanup 不得以 lease 已存在作为清理前提；内存 claim 也必须可恢复。
4. reservation 的“检查 + 占位写入”必须原子化，实际慢操作可以在临界区外执行。
5. recovery 只能根据可验证 owner 和 cleanup 结果改变状态，不能无条件删除 lock 或标记 released。
6. 每个并发不变量都要有确定性测试，测试不能只依赖 `sleep` 和最终状态碰巧正确。

## 2. 修复优先级

| 阶段 | 范围 | 目标状态 | 关闭证据 |
|---|---|---|---|
| F0 | Workflow YAML | CI/release 可解析 | YAML parser 或 GitHub workflow lint |
| F1 | P0 settlement | Issue/Project 终态单向收敛 | TOCTOU、取消、reassign 测试 |
| F2 | P0 claim recovery | lock/worktree 清理可补偿或持久化 orphan | 故障注入测试 |
| F3 | P1 idempotency | Command/Trigger 首次请求只保留一个 owner | 并发 reservation 测试 |
| F4 | P1 restart/PDF | 恢复按 owner，cleanup 有界，PDF slot 可复用 | restart、timeout、三并发测试 |
| F5 | P2 release/live smoke | 发布门禁和真实 Host/Web 验证闭环 | release lint、clean profile smoke |

推荐顺序为 F0 -> F1 -> F2 -> F3 -> F4 -> F5。F1/F2 未完成前不得将整改标记为 P0 完成。

## 3. F0：修复 workflow 配置

### 3.1 修复步骤

修正以下文件中 audit step 的缩进，使其与其他 `steps` 子项完全一致：

- `.github/workflows/ci.yml`；
- `.github/workflows/release.yml`。

目标结构：

```yaml
      - name: Verify source, tests, bundles, and package
        run: pnpm verify
      - name: Audit production dependencies
        run: pnpm audit --prod --audit-level high
```

### 3.2 验证

至少执行一种 YAML 解析验证：

```bash
node -e "import('yaml').then(({parse}) => { parse(require('node:fs').readFileSync('.github/workflows/ci.yml', 'utf8')); parse(require('node:fs').readFileSync('.github/workflows/release.yml', 'utf8')) })"
```

如果仓库不引入 YAML parser，则使用 GitHub Actions workflow validator，并在 CI 中固定验证步骤。

## 4. F1：统一 TaskRun settlement

### 4.1 新增 owner 模型

在 `src/service.ts` 或独立 `src/execution.ts` 增加内部类型：

```ts
interface ExecutionOwnership {
  taskRunId: string
  projectId: string
  issueId?: string
  assignmentRevision?: number
  runId?: string
}
```

Issue TaskRun 的 owner 来自：

- TaskRun ID；
- Project ID；
- Issue ID；
- assignment revision；
- Issue `activeTaskRunId`。

Project TaskRun 至少增加一个可验证 owner token：

- Project execution `runId`；
- TaskRun ID；
- Task ID；
- 当前 Project `activeRunId`；
- 必要时增加 `executionRevision` 可选字段。

不要只依赖 Agent handle 或内存 operation，因为这些信息在重启后不存在。

### 4.2 实现 `settleTaskRun`

建议签名：

```ts
private async settleTaskRun(
  owner: ExecutionOwnership,
  settlement: 'completed' | 'failed' | 'cancelled' | 'deferred',
  patch: Partial<TaskRunRecord>,
): Promise<boolean>
```

实现要求：

1. 进入 `serializedMutation()`；
2. 重新读取 TaskRun；
3. 如果不存在或当前 status 已是终态，返回 `false`；
4. 校验 `projectId`、`issueId`、assignment revision、Task ID 和 Project active run；
5. Issue 场景校验 Issue `activeTaskRunId === taskRun.id`；
6. Project 场景校验 Project `activeRunId === owner.runId`，且 TaskRun 仍属于当前 Task；
7. 通过全部校验后，在同一临界区写入 terminal status 和 patch；
8. 返回 `true` 表示当前操作成功拥有 settlement，返回 `false` 表示结果已过期；
9. 对 `cancelled`、`failed`、`completed`、`deferred` 统一执行单向收敛，禁止终态回写为其他状态。

伪代码：

```ts
private async settleTaskRun(owner, settlement, patch): Promise<boolean> {
  return this.serializedMutation(async () => {
    const current = this.store.taskRuns.get(owner.taskRunId)
    if (current === undefined || isTerminalTaskRun(current)) return false
    if (!matchesExecutionOwner(current, owner)) return false

    const issue = current.issueId === undefined
      ? undefined
      : this.store.issues.get(current.issueId)
    const project = this.store.projects.get(current.projectId)
    if (project === undefined) return false
    if (issue !== undefined && issue.activeTaskRunId !== current.id) return false
    if (owner.runId !== undefined && project.activeRunId !== owner.runId) return false

    await this.store.taskRuns.put(current.id, {
      ...current,
      ...patch,
      status: settlement,
      completedAt: new Date().toISOString(),
    })
    return true
  })
}
```

实际实现需要避免 `patch` 覆盖 owner 字段和 status，并由 schema 校验终态字段。

### 4.3 Issue completion/failure 改造

修改 `executeIssueTaskRun()`：

1. Agent 返回后可以先保存 session、transcript 和 stale evidence；
2. 证据写入必须不改变当前 TaskRun 终态；
3. workspace cleanup 前后都不得使用旧 TaskRun 快照作为终态依据；
4. cleanup 完成后调用 `settleTaskRun(owner, 'completed', ...)`；
5. 只有 settlement 返回 `true` 才能把 Issue 写成 `in_review`；
6. 返回 `false` 时只记录 `task_run.stale_result`，不得推进 Issue。

修改 `failIssueTaskRun()`：

1. 记录错误和可用证据；
2. 不在等待 evidence 的旧快照上直接 `put()`；
3. 调用 `settleTaskRun(owner, 'failed', ...)`；
4. 只有 settlement 成功且 Issue 仍指向该 TaskRun，才把 Issue 置为 `blocked`；
5. 若 settlement 失败，保留当前 owner 的状态，不覆盖新指派或取消结果。

### 4.4 Project completion/failure/cancel 改造

Project 的每个 TaskRun 都记录 `runId` 或可等价验证的 execution owner 信息。

修改 `execute()`：

- Agent 返回后重新读取 TaskRun；
- 测试命令取消、operation abort 或 Project active run 改变时，不再写 completed/failed；
- 测试成功和失败分别调用 `settleTaskRun()`；
- 只有 settlement 成功后才更新 Task、Run 和 evidence 的当前投影；
- cleanup 必须在对外发布 terminal status 前完成。

修改 `cancelProject()`：

1. 在 `serializedMutation()` 中获取当前 Project active run；
2. 将所有当前非终态 TaskRun 通过 `settleTaskRun(..., 'cancelled', ...)` 处理；
3. 再 abort Agent handles；
4. 等待 operation 结束；
5. 若旧操作返回晚结果，只允许记录 stale activity；
6. Project Run 和 Project 状态只由当前 run owner 更新。

修改 `failExecution()`：

- 不要扫描后直接覆盖所有非终态 TaskRun；
- 对每个 TaskRun 使用其 owner token 调用 settlement；
- 若当前 owner 已变化，跳过该 TaskRun；
- Run 和 Project 也要在 `serializedMutation()` 中重新读取并校验 active pointer。

## 5. F2：补偿 claim 清理和 durable orphan

### 5.1 扩展 WorkspaceClaim

建议补充：

```ts
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
```

`lockAcquired` 必须在 lock 写成功后立即置为 `true`；worktree 创建成功后立即置为 `true`。

### 5.2 统一 cleanup 输入

`releaseTaskRunLease(taskRunId, pendingClaim?)` 必须同时接受：

- 已持久化 WorkspaceLease；
- 只有内存中的 pending claim；
- 两者都存在但字段不完整的情况。

cleanup 顺序：

1. 如果是 worktree，尝试 `git worktree remove --force`；
2. 始终尝试 `git worktree prune`；
3. 仅删除当前 TaskRun 所有的 in-place lock；
4. cleanup 成功时将 lease 标记 `released`；
5. cleanup 失败时将 lease 标记 `orphaned` 并保存 `cleanupError`；
6. 如果 lease 不存在，创建最小 recovery record，例如 `lease:${taskRunId}`，包含 projectId、taskRunId、mode、sourcePath、workspacePath、state=`orphaned`、cleanupError、createdAt/releasedAt；
7. 写 recovery record 失败时，至少持久化独立的 `workspace.cleanup_failed` activity，包含完整路径和 taskRun ID，并让启动 recovery 能通过该 activity 或 orphan index 发现它；
8. 不得因为 lease 缺失就跳过清理。

### 5.3 cleanup failure 测试

增加故障注入：

- active lease 写入失败；
- worktree remove 失败；
- prune 失败；
- orphan lease 写入成功；
- orphan lease 写入也失败。

验收：

- lock 不会残留，或明确存在 orphan 记录；
- worktree 目录仍存在时必须有 cleanupError；
- 重启 recovery 能再次发现该记录；
- 后续同目录任务不会永久等待且不会无提示抢占目录。

## 6. F3：原子 Command/External Trigger reservation

### 6.1 Command

拆分 `executeCommand()` 为两个阶段：

```ts
const reservation = await this.serializedMutation(() =>
  this.reserveCommand(parsed, requestDigest)
)
return this.applyReservedCommand(reservation)
```

`reserveCommand()` 在临界区内完成：

1. 查找相同 idempotency key；
2. 计算并比较 digest；
3. 对旧记录无 digest 的情况返回 `command-idempotency-recovery-required`，除非明确使用兼容策略；
4. 已有相同 digest 的 pending/running 返回 recovery-required，completed/failed 才 replay；
5. 没有记录时插入唯一 pending record；
6. 返回当前调用是否为 owner。

实际 Agent、命令和 apply 操作必须在临界区外执行，但只有 reservation owner 能把 pending 更新为 running/completed/failed。

### 6.2 External Trigger

拆分为：

```ts
const reservation = await this.serializedMutation(() =>
  this.reserveExternalTrigger(parsed, payloadDigest)
)
return this.processReservedExternalTrigger(reservation)
```

临界区内：

1. 查找 `(source, externalKey)`；
2. 比较 digest；
3. 相同 digest 返回已有 record 或当前 owner；
4. 不存在时写入 `received` reservation；
5. 记录关联 command idempotency key。

临界区外执行 Command。并发相同请求必须 replay 同一 trigger/command，不得重复 apply；不同 payload 必须稳定返回 409。

### 6.3 并发测试

使用 deferred promise 或 barrier，不使用固定长 sleep：

- 两个相同 Command 首次请求同时进入，断言只生成一个 Command 且 apply 只执行一次；
- 两个不同 payload 的相同 Command key 同时进入，断言一个成功、另一个 `command-idempotency-conflict`；
- 两个相同 External Trigger 同时进入，断言只生成一个 trigger 和一个 command；
- 两个不同 payload 的同 key trigger 同时进入，断言只保留一个 payload；
- 旧 Command 缺少 digest 时，同 key 新请求返回 `command-idempotency-recovery-required`。

## 7. F4：restart recovery 和 PDF reservation

### 7.1 restart recovery 顺序

`initialize()` 的恢复顺序：

1. 标记/恢复 pending/running Command；
2. 读取所有非 released lease；
3. 先处理 TaskRun owner 状态；
4. worktree lease 执行有界 cleanup；
5. in-place lease 只在没有有效 queued/dispatched/running owner 时删除 lock；
6. cleanup 成功标记 released；
7. cleanup 失败标记 orphaned，记录 cleanupError/activity；
8. Project/Issue TaskRun 按恢复契约转为 queued、failed 或 blocked；
9. 最后重新请求 dispatcher。

不得在 recovery 开始时无条件删除全部 localDirectoryLocks。

### 7.2 Git cleanup timeout

封装 timeout-aware Git process：

```ts
await runWithTimeout(
  gitProcess(lease.sourcePath, ['worktree', 'remove', '--force', lease.workspacePath]),
  WORKTREE_CLEANUP_TIMEOUT_MS,
)
```

建议默认 10 秒，并允许测试注入更短 timeout。超时应：

- 捕获为 cleanupError；
- 写 orphaned lease；
- 写 recovery activity；
- 继续处理其他 lease；
- 不阻塞整个 Host 初始化。

### 7.3 restart 测试

增加：

- active in-place lease 且 owner 仍 running：lock 不得被误删；
- active in-place lease 但 TaskRun 已 terminal：lock 可删除并 lease released；
- active worktree lease cleanup 成功：目录删除、lease released；
- worktree cleanup 失败：lease orphaned 且有 cleanupError；
- Git cleanup timeout：恢复继续处理后续 lease；
- Project TaskRun 重启：不得被 `issueId` 过滤逻辑遗漏；
- orphan recovery 后 dispatcher 不会重复占用同一 workspace。

### 7.4 PDF reservation 测试

使用可控的 import barrier：

1. 发起三个并发 import；
2. 前两个进入执行；
3. 第三个稳定返回 429；
4. 释放其中一个 operation；
5. 第四个请求可以进入；
6. 取消、超时、解析失败都释放 slot。

## 8. F5：发布和文档门禁

### 8.1 Release workflow

在 publish 前增加：

1. tag 必须匹配 package version；
2. tag commit 必须属于受保护主干 ancestry；
3. `CHANGELOG.md` 和 `CHANGELOG.zh-CN.md` 必须包含当前版本；
4. `pnpm verify`、production audit、package smoke 必须通过；
5. 读取 tarball 文件列表，确认根入口、client、CLI、PDF worker、types 和文档均存在；
6. 禁止从任意非受保护分支 tag 发布。

`github-release` 只在 publish 成功后创建 release，继续保留 least privilege permissions。

### 8.2 Security 和 Code of Conduct

维护者需要选择并验证一个真实可执行渠道：

- GitHub private vulnerability reporting；
- 仓库 SECURITY 联系邮箱；
- 可访问的安全表单或 advisory 地址。

CODE_OF_CONDUCT 必须提供 enforcement 联系方式，并在中英文文件保持一致。

### 8.3 Live smoke

在 clean Harness profile 中至少完成：

1. 安装构建包；
2. 启动同一个 `dsh web` Host；
3. 验证 `/project-orchestrator/api/health`；
4. 打开 Web plugin 入口；
5. 创建空 Project；
6. 创建/审批一个最小 Project；
7. 验证 Agent、workspace、test command 和 evidence；
8. 重启 Host，验证 queued/recovered TaskRun 和 lease cleanup；
9. 记录 macOS/Linux 结果和版本。

已完成 macOS clean Harness profile live smoke：安装构建包、启动 `dsh web` Host、验证 health 和 Web plugin、创建空 Project、创建并审批最小 Project、执行真实 Agent、验证 workspace、test command、evidence，并重启 Host 验证项目恢复。

## 9. 测试与验收命令

实现完成后执行：

```bash
PATH="$PWD/.tools-pnpm/node_modules/.bin:$PATH" \
node .tools-pnpm/node_modules/pnpm/bin/pnpm.cjs typecheck

PATH="$PWD/.tools-pnpm/node_modules/.bin:$PATH" \
node .tools-pnpm/node_modules/pnpm/bin/pnpm.cjs test

PATH="$PWD/.tools-pnpm/node_modules/.bin:$PATH" \
node .tools-pnpm/node_modules/pnpm/bin/pnpm.cjs verify

PATH="$PWD/.tools-pnpm/node_modules/.bin:$PATH" \
node .tools-pnpm/node_modules/pnpm/bin/pnpm.cjs audit --prod --audit-level high

git diff --check
```

还必须补充：

- GitHub workflow YAML parser/validator；
- 并发 Command/External Trigger 测试；
- TOCTOU settlement 测试；
- claim cleanup failure 测试；
- restart lock/lease/timeout 测试；
- PDF 三并发 reservation 测试；
- clean Harness profile live smoke。

## 10. 不建议的修复方式

以下方式不能作为最终修复：

- 只在 `isCurrentIssueTaskRun()` 后增加一次重复检查；
- 只依赖 AbortSignal 或 Agent cancel；
- 只删除内存 lock，不写 durable recovery record；
- 只在测试中增加固定 sleep；
- 通过无条件删除所有 lock 来“恢复干净”；
- 给 Command/Trigger 加 digest 但不做 check + insert reservation；
- 只让 `pnpm verify` 通过而不解析 workflow；
- 只运行 package smoke 而不做 clean Harness Host/Web smoke。

## 11. 完成定义

本方案完成需要满足：

- [整改问题审查记录](remediation-review.zh-CN.md) 的 R-001 至 R-007 均关闭；
- R-008 workflow YAML 问题关闭；
- R-009 release ancestry、CHANGELOG、package content 门禁关闭；
- R-010 security/contact 和 clean Harness profile live smoke 有记录；
- P0/P1 并发和故障注入测试全部稳定通过；
- typecheck、test、verify、audit、package smoke 和 diff check 全部通过；
- 未完成项明确记录为 blocker，不得在 release notes 中宣称稳定版。
