# Quickstart

This guide takes the shortest supported path from an installed plugin to one completed AI Project with TaskRun evidence.

## Prerequisites

- DeepSeek Harness, Cordis, Node.js, Git, and pnpm versions listed in the README compatibility note.
- A working model provider in the Harness profile. Keep provider credentials in the Harness configuration; do not put them in a Project brief or repository.
- An existing local repository that you are willing to let an Agent modify. Start with a disposable repository or a clean branch.
- A non-interactive verification command already supported by that repository, such as `pnpm test`, `npm test`, or another command documented by its manifest.

## 1. Install and enable the plugin

Follow [Install](../README.md#install), restart the existing `dsh web` process, refresh its current URL, and verify the Host service:

```bash
curl --fail http://127.0.0.1:3080/project-orchestrator/api/health
```

A successful response is `{"ok":true}`. Open **Project Orchestrator** from the Harness sidebar footer.

## 2. Create an Agent

1. Open **Agents** (`智能体`) and select **Create Agent** (`创建智能体`).
2. Choose manual configuration for the most predictable first run.
3. Enter a name and execution instructions, then select the configured provider and model.
4. Use **Full tools** only for a repository you trust. Read-only Agents can plan and review but cannot implement changes.
5. Leave **Runtime** set to **Default local environment** (`本机默认环境`) and set maximum concurrency to `1`.
6. Create the Agent.

The default local environment is sufficient for the normal single-Host flow. Create a custom Runtime only when you need a specific Agent CLI, workspace root, or separately managed execution configuration.

## 3. Create an AI Project

1. Open **Projects** (`项目`) and select **New Project** (`新建项目`).
2. Choose **AI decomposition** (`AI 智能拆解`) and **Local repository** (`本地代码仓库`).
3. Select the existing repository directory.
4. Enter a bounded delivery brief with an observable result and the expected verification command. For example:

```text
Make one small, reversible documentation or code change in this repository.
Use only commands confirmed by the repository manifest.
Create at least one implementation task and one dedicated test task.
The final verification must use the repository's existing non-interactive test command.
```

5. Create the Project and wait for planning to reach **Awaiting approval** (`待批准`).

Planning is read-only. If the Planner reports missing repository evidence or an unconfirmed verification command, fix that repository prerequisite and run planning again instead of approving an invented command.

## 4. Bind and assign a Squad

1. Open **More > Squads** (`更多 > 团队编排`) and create a Squad with at least a Leader, an implementation member, and a test member. The Leader must also be in the Squad member list.
2. Open the Project's **Agents** (`智能体`) tab. In **Squad orchestration** (`团队编排`), select **Bind Squad** (`绑定 Squad`), choose the new team, and confirm **Bind and synchronize** (`绑定并同步`). The first binding becomes the default Squad.
3. Check the default badge, Leader, member count, and dispatch status. The member list identifies the **default Squad Leader** automatically, so the Leader is not selected again. **Project lead** is a separate optional responsibility and is not assigned by binding.
4. Use **Add Agent** (`添加智能体`) only when the Project needs an additional Agent outside the Squad. Assign a Project role and enable automatic matching when appropriate.
5. Open the **Tasks** (`任务`) tab and review every task, dependency, acceptance criterion, and test command.
6. Use **Batch assign unassigned tasks** (`批量分配未分配任务`) if any task has no executor. Binding establishes team and membership eligibility; it does not change Task executors, approve the Project, or start execution.

Approval requires at least one code task, one test task, an eligible concrete Project Agent for every task, and a non-empty verification command for every task.

## 5. Approve and execute

Return to **Overview** (`概览`) and select **Approve plan and start implementation** (`批准计划并开始实施`). Confirm only after reviewing every shell command: approved verification commands execute on the local machine.

The Project proceeds through queueing, Agent execution, and verification. Use **Inbox** for permission, Runtime, retry, or other decisions that require human action.

## 6. Inspect the result

Open the Project's **Runs and evidence** (`运行与证据`) tab and confirm:

- the Project and Run reached `completed`;
- each TaskRun reached `completed`;
- the recorded workspace is the expected repository or worktree;
- every verification result has exit code `0`;
- the Agent summary, Transcript, and any generated Artifacts match the repository changes.

Finally, inspect `git status` and the repository diff yourself before keeping or committing the Agent's changes. The plugin does not push a branch or create a pull request for you.

## Common blockers

- **No launcher:** confirm the loader patch, restart the existing Web process, refresh the page, and call the health endpoint.
- **Plan cannot be approved:** add an active Project Agent, assign every task, and ensure the plan contains code and test tasks with verification commands.
- **Runtime unavailable:** use the default local environment or restore the bound custom Runtime to an online state.
- **Planner blocked:** confirm the selected directory exists and that the repository exposes a non-interactive verification command.
- **Execution needs a decision:** open **Inbox**, inspect the recorded context, and explicitly approve, reject, defer, or retry.

For backup, recovery, and production use, continue with [Operations](operations.md) and [Security](../SECURITY.md).
