# HTTP and CLI contracts

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
- `GET /task-runs/:id/transcript`
- `GET /task-runs/:id/artifacts`

Inbox query fields are strict: `kind`, `projectId`, `issueId`, and bounded `limit`.

## Project creation and planning routes

`POST /projects` accepts two explicit request modes:

- `{ "mode": "empty", "name": "Project name", "cwd": "/absolute/existing/path", ... }` creates a `draft` Project and returns `201`. It permits empty `prd` and `technicalDesign`, creates no Tasks or approval, and does not invoke a Planner or Agent.
- `{ "mode": "ai", "cwd": "/absolute/existing/path", "prd": "Delivery brief", ... }` creates a Project, starts decomposition, and returns `202`.

For 1.x backward compatibility, omitting `mode` retains the pre-existing AI behavior and therefore requires a non-empty `prd`. New Web clients default to `mode: "empty"`; API omission is not the Web default. `taskLanguage` defaults to `zh-CN` and may be `en`.

Additional routes:

- `PUT /projects/:id` saves Project metadata without invoking AI or invalidating the current plan. When Tasks already exist, changes to plan-affecting fields (`cwd`, PRD, technical design, priority, owner, or task language) are rejected with `project-replan-required`; name and summary remain safe metadata-only edits. A taskless draft may keep or add an empty PRD.
- `POST /projects/:id/replan` accepts `{ "taskLanguage": "zh-CN" }` or `en` and may atomically include a full validated `project` edit payload. It rejects Projects with execution history before persisting edits, replaces only an unexecuted plan, increments the Project revision, clears current approval, and starts decomposition.
- `POST /projects/:id/decompose` explicitly starts planning for a draft Project using its stored language and rejects an empty PRD with `project-brief-required`.
- `POST /projects/:id/approve` remains revision/hash-bound; a regenerated plan always requires fresh approval.
- `POST /projects/:id/open-directory` accepts no path body. It resolves the authoritative persisted `project.cwd`, revalidates it, invokes the certified operating-system opener without a shell, and returns `{ "ok": true }`. macOS and Linux are certified; Windows is not.

Chinese mode validates that summary, titles, descriptions, and acceptance criteria contain Chinese text. JSON keys, task IDs, code symbols, paths, Agent roles, and commands are never translated.

## Unified command route

`POST /commands` accepts a Command input. Supported types:

- `assign_issue`, `reassign_issue`, `stop_issue`, `continue_issue`
- `approve_review`, `reject_review`, `request_decision`
- `delegate_issue`
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
