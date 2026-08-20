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
