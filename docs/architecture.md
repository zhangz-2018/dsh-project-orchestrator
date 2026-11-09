# Architecture

English | [简体中文](architecture.zh-CN.md)

## Package halves

The package is a static dual-half Cordis plugin:

- `src/index.ts` registers the Host storage, service, and `/project-orchestrator/api` prefix handler.
- `src/client.tsx` registers additive sidebar-footer and shell-overlay slots in the existing Harness Web shell.
- `src/cli.ts` is a loopback-only HTTP client for operational reads and unified mutations.

The Web shell is not replaced and no second application server is required.

## Sources of truth

| Record | Ownership |
|---|---|
| Project | Plan revision, approval, Resources, human-facing owner text, lead Agent, legacy autonomous delivery run pointer |
| ProjectAgentMembership | Project-scoped Agent eligibility, planning role, auto-assignment permission, and join/removal history |
| Task | Approved plan dependency, assigned Agent, and independent verification gate |
| Issue | Collaboration lifecycle, assignment revision, review status, active TaskRun pointer |
| TaskRun | One queue/execution attempt, workspace lease, Session and delivery evidence |
| VerificationSpec / Invocation / Evidence | Approved verification mapping, one real execution context, and evidence bound to the TaskRun, source state, and scenario results |
| StorageMutationIntent / RecoveryAttempt | Frozen before/after facts for recoverable writes, plus every recovery request and result |
| Command | Idempotency key, mutation result or durable failure receipt |
| Runtime | Local Host dispatch eligibility and workspace metadata |
| Squad / Delegation | Team configuration and one parent/child Issue collaboration contract |
| Harness Session | Raw conversation authority; the plugin stores bounded redacted projections |
| Artifact | Durable document, test, commit, diff, or PR-reference evidence |

Inbox, Agent workload, Skills, feature-usage aggregates, and statistics are read projections. They must not become alternative write owners.

Project Agent membership is an eligibility boundary, not the execution assignment itself. Every executable Task remains bound to an explicit `Task.agentId`, and every Issue execution remains bound to its assignment revision and TaskRun. Membership changes that do not alter an assigned Task do not invalidate approval; changing a Task Agent still changes the plan digest and requires fresh approval.

## TaskRun lifecycle

- `queued`: durable and unclaimed; survives Runtime offline and restart.
- `waiting_local_directory`: eligible but blocked by a canonical in-place directory lock.
- `dispatched`: capacity and workspace lease acquired.
- `running`: the RuntimeAdapter has started the bound execution; the TaskRun retains the adapter, execution, and claim-version binding.
- terminal: evidence and workspace cleanup have stabilized.

A stale TaskRun may retain terminal evidence but cannot advance an Issue after its assignment revision changes.

## Workspaces

`in_place` Resources serialize by canonical directory. `worktree` Resources run `git worktree add -b` and fail closed if Git or ref preparation fails. Worktree branches are retained as evidence; temporary directories are removed before terminal completion.

## Process model

The default `inline-runtime` executes Harness Agents in the Host process. The Service drives a RuntimeAdapter through `prepare -> persist binding -> start -> observe -> collectArtifacts`. If `start` returns an uncertain error, the Service observes the existing execution instead of blindly starting it again. Cancellation propagates to the adapter, and failed or cancelled executions can still return diagnostic artifacts. The Service remains the sole owner of TaskRun, Issue, and Project terminal transitions.

A Runtime record does not imply that a remote worker exists, and this repository does not currently register a production daemon adapter. In-memory inline executions cannot survive a Host restart. The storage mutation boundary serializes one Host process and is not a distributed transaction or compare-and-swap protocol.

## Service boundaries

- `OrchestratorService` remains the HTTP/CLI facade and final state owner.
- `ExecutionBroker` freezes the claim, lease, and execution contract; `RuntimeAdapter` only executes and observes.
- `VerificationService` creates versioned invocations, runs controlled commands, and consumes structured browser reports.
- `DeliveryService` owns delivery projections, immutable records, confirmation/closure, V3 Git Integration, and Convergence; `OrchestratorService` retains compatibility delegation and cross-domain terminal coordination that has not yet moved.
- `StorageReconciliationService` derives previews from durable before/after facts and executes digest- and revision-guarded recovery.
- `QueryService` produces overview, readiness, and watermark-based history pages; these read projections do not mutate business facts.

## Planning semantic support

Built-in production providers cover TypeScript/JavaScript symbols, relationships, and consumers; Vue/Nuxt routes; Prisma schemas; test relationships; and trusted manifest commands. Path aliases, re-exports, and reverse consumers feed one TypeScript relationship graph with explicit file and byte budgets. Exceeding a budget produces `partial` evidence.

Python, Java/Spring, and Go are explicitly unsupported today because they have no production semantic provider. Projects can still use the generic workflow, but that does not prove Planning V3 can identify code owners or a complete impact surface for those languages.

## Compatibility storage

The storage domain is version 1. Newer record tables are opened as optional compatibility tables, allowing legacy snapshots to load with empty arrays. Snapshot projection filters dangling context without deleting audit receipts from storage.
