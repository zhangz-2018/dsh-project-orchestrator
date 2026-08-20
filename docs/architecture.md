# Architecture

## Package halves

The package is a static dual-half Cordis plugin:

- `src/index.ts` registers the Host storage, service, and `/project-orchestrator/api` prefix handler.
- `src/client.tsx` registers additive sidebar-footer and shell-overlay slots in the existing Harness Web shell.
- `src/cli.ts` is a loopback-only HTTP client for operational reads and unified mutations.

The Web shell is not replaced and no second application server is required.

## Sources of truth

| Record | Ownership |
|---|---|
| Project | Plan revision, approval, Resources, legacy autonomous delivery run pointer |
| Issue | Collaboration lifecycle, assignment revision, review status, active TaskRun pointer |
| TaskRun | One queue/execution attempt, workspace lease, Session and delivery evidence |
| Command | Idempotency key, mutation result or durable failure receipt |
| Runtime | Local Host dispatch eligibility and workspace metadata |
| Squad / Delegation | Team configuration and one parent/child Issue collaboration contract |
| Harness Session | Raw conversation authority; the plugin stores bounded redacted projections |
| Artifact | Durable document, test, commit, diff, or PR-reference evidence |

Inbox, Agent workload, Skills, and statistics are read projections. They must not become alternative write owners.

## TaskRun lifecycle

- `queued`: durable and unclaimed; survives Runtime offline and restart.
- `waiting_local_directory`: eligible but blocked by a canonical in-place directory lock.
- `dispatched`: capacity and workspace lease acquired.
- `running`: Harness Agent active.
- terminal: evidence and workspace cleanup have stabilized.

A stale TaskRun may retain terminal evidence but cannot advance an Issue after its assignment revision changes.

## Workspaces

`in_place` Resources serialize by canonical directory. `worktree` Resources run `git worktree add -b` and fail closed if Git or ref preparation fails. Worktree branches are retained as evidence; temporary directories are removed before terminal completion.

## Process model

Current Harness Agents execute in the Host process. Runtime records do not represent remote workers. The storage mutation boundary serializes one Host process and is not a distributed transaction or compare-and-swap protocol.

## Compatibility storage

The storage domain is version 1. Newer record tables are opened as optional compatibility tables, allowing legacy snapshots to load with empty arrays. Snapshot projection filters dangling context without deleting audit receipts from storage.
