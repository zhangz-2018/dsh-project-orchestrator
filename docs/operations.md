# Operations

English | [简体中文](operations.zh-CN.md)

## Health and snapshot

```bash
curl --fail http://127.0.0.1:3080/project-orchestrator/api/health
dsh-project-orchestrator snapshot
dsh-project-orchestrator stats
```

## Backup

1. Stop the existing `dsh web` Host.
2. Copy `~/.dsh/storages/project_orchestrator.json` to protected storage.
3. Record the plugin and Harness versions.
4. Restart the same Host and verify `/health`.

Do not copy the JSON file while active mutations are being persisted.

## Upgrade

1. Read `CHANGELOG.md` and the compatibility matrix.
2. Back up storage.
3. Upgrade the profile plugin with the Harness plugin manager.
4. Restart the existing Host; do not start a second server.
5. Verify health, snapshot parsing, queued/recovered runs, and Web navigation.
6. Verify every currently assigned Task has an active Project Agent membership before approving or retrying delivery.

On the first compatible startup, membership backfill is idempotent: active current Task Agents, the active persisted lead Agent, and active non-terminal project Issue Agent assignees become active Project members. Missing or archived references stay visible but fail closed until reassigned; they do not prevent Host startup. Historical-only TaskRun Agents do not expand the active member pool.

## Rollback

Disable or remove the loader row and restart Harness to restore the original Web UI. Before reinstalling an older 1.x package, pause executable queues and restore the matching pre-upgrade storage backup; do not rely on schema readability to preserve membership or no-fallback safeguards.

## Queue recovery

On initialization:

- queued and directory-waiting Issue runs remain eligible;
- dispatched Issue runs return to queued because their process lease did not survive;
- running Issue runs fail with restart evidence and block only the matching assignment revision;
- legacy autonomous delivery runs retain their existing recovery contract.

## Worktree cleanup

The plugin removes temporary worktrees with `git worktree remove --force` and prunes metadata. Delivery branches remain. A cleanup failure is recorded on the workspace lease and prevents a false clean terminal result.

## Python virtual environments

If `<project cwd>/.venv/bin` (or `.venv/Scripts` on Windows) exists, approved test commands run with that directory prepended to `PATH` and `VIRTUAL_ENV` set. TaskRun evidence records `project_venv` and its path. Otherwise commands use the filtered Host PATH.

## Troubleshooting

- `project-agent-not-member`: add the assigned Agent to the Project or reassign the Task to an active Project member.
- `project-task-unassigned`: assign every planned Task before approval.
- `runtime_offline`: heartbeat the bound Runtime or correct the Agent binding.
- `resource-selection-required`: select one Project Resource explicitly.
- `verification_failed`: inspect TaskRun output and the recorded execution environment.
- repeated collection/import errors: confirm the Project `.venv` exists and owns required dependencies.
- missing launcher: confirm the Loader row, rebuild/install the Client artifact, restart Host, and refresh the existing Web page.
