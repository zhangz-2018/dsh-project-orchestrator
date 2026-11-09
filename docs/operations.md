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

Before a RuntimeAdapter takes control, the TaskRun persists `runtimeAdapterId`, `runtimeExecutionId`, and the matching `claimVersion`. The default adapter is the in-process `inline-runtime`; its running executions cannot survive a Host restart, so interrupted runs fail closed and require reconciliation of possible external side effects. A prepared dispatch that never started can return to the queue after its old claim and Runtime binding are cleared. A custom daemon adapter must implement the same prepare, durable binding, start, observe, cancel, and artifact contract and must not write Project, Issue, or TaskRun terminal state itself.

## Storage reconciliation

When an Intent appears as a blocker in the Project overview, inspect current durable facts before changing storage:

```bash
dsh-project-orchestrator reconciliation-preview <INTENT_ID>
dsh-project-orchestrator reconciliation-attempts <INTENT_ID>
```

The preview returns the `intentDigest`, `previewDigest`, Project revision, observed state for every step, and allowed actions. An execution request must carry those values unchanged and use a unique idempotency key, for example:

```bash
dsh-project-orchestrator reconciliation-execute <INTENT_ID> '{
  "expectedIntentDigest":"<INTENT_DIGEST>",
  "previewDigest":"<PREVIEW_DIGEST>",
  "expectedProjectRevision":2,
  "action":"compensate",
  "idempotencyKey":"ops-20260922-001",
  "requestedBy":"operator-name",
  "reason":"Discard the observed partial planning candidate."
}'
```

`replay_safe` permits replay only; `compensation_safe` permits replay or compensation; `already_applied` permits finalization only; and `manual_required` disables automatic execution. Any digest, revision, or observed record drift after preview makes the request stale and requires a new preview. Successful and failed requests both persist a `RecoveryAttempt` audit record.

## Host acceptance report

`scripts/verify-host-acceptance.mjs` validates the current Host, migration result, real Git input, installed package hash, and backup hash. Without an independent corruption/recovery experiment file, the report can only be `partial`. A `passed` recovery result requires an experiment ID, observation timestamp, corrupted-byte count, recovered and backup hashes, plus a `failureLogPath` whose actual content matches the supplied SHA-256. The script rereads the log and storage files; boolean claims alone cannot produce a passing report.

## Worktree cleanup

The plugin removes temporary worktrees with `git worktree remove --force` and prunes metadata. Delivery branches remain. A cleanup failure is recorded on the workspace lease and prevents a false clean terminal result.

## Python virtual environments

If `<project cwd>/.venv/bin` (or `.venv/Scripts` on Windows) exists, approved test commands run with that directory prepended to `PATH` and `VIRTUAL_ENV` set. TaskRun evidence records `project_venv` and its path. Otherwise commands use the filtered Host PATH.

## Native integration and read-only pilot

More → Runtimes reports loaded native services. Host verification and Git evidence commands use `ctx.subprocess` and refuse execution when it is absent; CLI calls explicitly retain Node. This does not enable a filesystem/network sandbox or Auto review.

The TaskRun evidence-review pilot is disabled by default. Set `DSH_PO_NATIVE_READONLY_PILOT=1` only on an isolated pilot Host and restart to opt in. Each eligible TaskRun has one durable attempt; failures, cancellation, and restart do not refund it. Recovery marks unfinished admissions interrupted without dispatching again. See the [implementation record (Chinese)](dsh-native-integration-implementation-2026-11-09.zh-CN.md).

## Troubleshooting

- `project-agent-not-member`: add the assigned Agent to the Project or reassign the Task to an active Project member.
- `project-task-unassigned`: assign every planned Task before approval.
- `runtime_offline`: heartbeat the bound Runtime or correct the Agent binding.
- `resource-selection-required`: select one Project Resource explicitly.
- `verification_failed`: inspect TaskRun output and the recorded execution environment.
- `storage-needs-reconciliation`: stop related execution and inspect the Recovery Preview; replay, compensate, or finalize only when the server explicitly permits it.
- `runtime-start-uncertain` / `runtime-observe-failed`: external side effects cannot be proven; retain TaskRun, artifact, and lease evidence for operator review instead of blindly starting the execution again.
- repeated collection/import errors: confirm the Project `.venv` exists and owns required dependencies.
- missing launcher: confirm the Loader row, rebuild/install the Client artifact, restart Host, and refresh the existing Web page.
