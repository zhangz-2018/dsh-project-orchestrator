# HTTP and CLI contracts

English | [简体中文](api.zh-CN.md)

Base path: `/project-orchestrator/api`

All responses are JSON and carry `Cache-Control: no-store`. Failed requests use:

```json
{"error":{"code":"stable-machine-code","message":"human-readable detail"}}
```

## Read routes

- `GET /health`
- `GET /snapshot`
- `GET /inbox`
- `GET /agents/workload`
- `GET /issues`
- `GET /squads`
- `GET /runtimes`
- `GET /skills`
- `GET /artifacts`
- `GET /commands`
- `GET /stats`
- `GET /team-metrics`
- `GET /task-runs/:id/transcript`
- `GET /task-runs/:id/artifacts`

Inbox query fields are strict: `kind`, `projectId`, `issueId`, and bounded `limit`.

## Project creation and planning routes

`POST /projects` accepts two explicit request modes:

- `{ "mode": "empty", "name": "Project name", "cwd": "/absolute/existing/path", ... }` creates a `draft` Project and returns `201`. It permits empty `prd` and `technicalDesign`, creates no Tasks or approval, and does not invoke a Planner or Agent.
- `{ "mode": "ai", "cwd": "/absolute/existing/path", "prd": "Delivery brief", ... }` creates a Project, starts decomposition, and returns `202`.

For 1.x backward compatibility, omitting `mode` retains the pre-existing AI behavior and therefore requires a non-empty `prd`. New Web clients default to `mode: "empty"`; API omission is not the Web default. `taskLanguage` defaults to `zh-CN` and may be `en`.

Additional routes:

- `PUT /projects/:id` saves Project metadata without invoking AI or invalidating the current plan. When Tasks already exist, changes to plan-affecting fields (`cwd`, PRD, technical design, priority, the human-facing `owner` text, or task language) are rejected with `project-replan-required`; name and summary remain safe metadata-only edits. `owner` is not `leadAgentId`: changing the lead Agent through Project membership does not alter Task assignment or invalidate approval. A taskless draft may keep or add an empty PRD.
- `POST /projects/:id/replan` accepts `{ "taskLanguage": "zh-CN" }` or `en` and may atomically include a full validated `project` edit payload. It rejects Projects with execution history before persisting edits, replaces only an unexecuted plan, increments the Project revision, clears current approval, and starts decomposition.
- `POST /projects/:id/decompose` explicitly starts planning for a draft Project using its stored language and rejects an empty PRD with `project-brief-required`.
- `POST /projects/:id/approve` remains revision/hash-bound; a regenerated plan always requires fresh approval.
- `POST /projects/:id/open-directory` accepts no path body. It resolves the authoritative persisted `project.cwd`, revalidates it, invokes the certified operating-system opener without a shell, and returns `{ "ok": true }`. macOS and Linux are certified; Windows is not.

Chinese mode validates that summary, titles, descriptions, and acceptance criteria contain Chinese text. JSON keys, task IDs, code symbols, paths, Agent roles, and commands are never translated.

## Project Agent membership and assignment routes

- `GET /projects/:id/agents` returns active and removed Project Agent memberships.
- `POST /projects/:id/agents` adds or reactivates one active Agent without invoking AI or invalidating an unrelated approval. An identical repeat is idempotent; different role or auto-assignment settings on an existing active member return `project-agent-already-member` and must use `PUT`.
- `POST /projects/:id/agents/batch` atomically adds or reactivates multiple Agents.
- `PUT /projects/:id/agents/:agentId` updates the Project role, automatic-planning eligibility, or lead designation.
- `DELETE /projects/:id/agents/:agentId` soft-removes membership. The default `assignedTaskPolicy: "reject"` requires current-plan Tasks, non-terminal Issues, active delegation, and lead ownership to be resolved first. `assignedTaskPolicy: "reassign"` requires `replacementAgentId` and `expectedProjectRevision`; it atomically reassigns the current Task plan, increments revision once, clears approval, transfers lead ownership unless explicitly cleared, then removes the membership. Issue and delegation references still use their audited lifecycle commands.
- `POST /projects/:id/task-assignments` atomically changes multiple Task Agents, increments the Project revision once, clears approval, and returns the refreshed plan facts.

Task create/update, planning, approval, retry, execution, and project-scoped Issue/Squad assignment all validate active Project membership. Physical Agent deletion is blocked once retained Project membership history exists; archive the Agent instead so historical names and references remain resolvable. Approval requires every Task to have an explicit eligible Agent. Execution never selects an unapproved workspace-global fallback Agent.

## Team plan, review, and delivery routes

Read routes use Service-owned projections rather than recalculating eligibility in the client:

- `GET /projects/:id/team-plan` returns the team snapshot, task policies, candidate coverage, blockers, critical path, and capacity observations.
- `GET /projects/:id/agent-candidates?taskId=...` returns deterministic eligible/rejected Agent and Squad candidates with reasons in separate `candidates` and `squadCandidates` arrays.
- `GET /projects/:id/team-impact` previews affected Tasks, acceptance evidence, the current PlanSnapshot/Approval, active Issues/Delegations, and active-execution protection.
- `GET /projects/:id/team-metrics` returns project-scoped collaboration metrics; `GET /team-metrics` returns the global projection.
- `GET /projects/:id/validate-team` evaluates the current team without writing a Command.
- `GET /projects/:id/plan-snapshots`, `/requirements`, `/requirement-decisions`, and `/delivery` expose the plan, requirement-to-evidence matrix, decisions, Project Review, and delivery facts.
- `GET /projects/:id/squad-bindings`, `/agent-membership-sources`, and `/eligible-squads` expose Squad provenance and eligibility.

The following team-planning mutations are Command-backed and keep the same idempotency, audit, and failure semantics as `POST /commands`:

- `POST /projects/:id/validate-team`
- `POST /projects/:id/reassign-task`
- `POST /projects/:id/resolve-team-blocker`
- `POST /projects/:id/squad-bindings`
- `POST /projects/:id/squad-bindings/:squadId/sync`

Project Review and delivery use their own serialized lifecycle owners:

- `POST /projects/:id/review/resolve`
- `POST /projects/:id/delivery/confirm`
- `POST /projects/:id/delivery/close`

Review rejection creates an auditable Decision/Inbox item. Waivers are persisted against Acceptance records. A partial Review/waiver write is compensated before the API returns failure, so it does not leave a mixed Project/Review/Acceptance state.

Non-empty Task `allowedScope`/`forbiddenScope` contracts require Git evidence at execution time. A TaskRun records only files actually changed relative to its own starting baseline; `scope_violation` or `verification_unavailable` fails closed before the test command and creates a linked Decision. Exhausting automatic repair also creates one linked retry Decision.

## Local feature-usage routes

- `POST /usage` increments bounded `opens`, `meaningfulActions`, or `errorRecoveries` counters for one known feature in the server's current UTC day.
- `DELETE /usage` clears local feature-usage aggregates.

Usage records contain a UTC date, feature key, three aggregate counters, and `lastUsedAt`. Records older than 30 days are removed on the next usage write. They do not contain Project names, paths, requirements, task content, Agent instructions, comments, or transcripts, and they are not uploaded.

## Unified command route

`POST /commands` accepts a Command input. Supported types:

- `assign_issue`, `reassign_issue`, `stop_issue`, `continue_issue`
- `approve_review`, `reject_review`, `request_decision`
- `delegate_issue`, `retry_delegation`, `stop_delegation`
- `reassign_task`, `bind_project_squad`, `sync_project_squad`
- `validate_team`, `resolve_team_blocker`
- `autopilot_tick`

Supplying the same non-empty `idempotencyKey` returns the original Command record and does not repeat the mutation.

## External triggers

`POST /external-triggers` deduplicates by `(source, externalKey)`, records a payload digest, and routes the nested command through the same owner.

## Security requirements for mutations

Mutation requests are rejected unless:

- the socket peer is loopback;
- the `Host` is loopback;
- `Origin` is present and exactly matches that Host origin;
- cross-site fetch metadata is absent or same-origin.

This policy intentionally rejects remote API clients and reverse proxies unless Harness itself still observes a loopback same-origin request.

## CLI exit codes

- `0`: help/version or successful API response;
- `1`: transport, JSON, policy, or API failure;
- `2`: invalid CLI verb or missing required JSON argument.

The CLI prints successful payloads as formatted JSON and failures to stderr. It never writes the storage file directly.

Team and delivery CLI commands are `team-plan`, `agent-candidates`, `team-impact`, `team-metrics`, `validate-team`, `reassign-task`, `resolve-team-blocker`, `bind-project-squad`, `sync-project-squad`, `plan-snapshots`, `requirements`, `decisions`, `delivery`, `resolve-review`, `confirm-delivery`, and `close-delivery`. All commands connect only to a loopback Harness API.
