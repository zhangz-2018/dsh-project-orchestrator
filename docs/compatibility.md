# Compatibility and stability

English | [简体中文](compatibility.zh-CN.md)

## Validated Source Matrix

| Plugin | DeepSeek Harness | Cordis | Node.js | Git | Platforms |
|---|---|---|---|---|---|
| Current working source (unpublished) | 0.2.2-rc.1 | 4.1.0 | >=24.9.0 | required for worktrees | macOS local validation; Linux CI configured, not run in this session; Windows not certified |

The previous 0.1.0-rc.6 validation applies only to its historical source and artifacts. The current package requires the new Host packages and does not claim compatibility with that old Host. Node.js 22 is no longer supported. Existing user Host processes and data were not upgraded during this verification.

The migration uses `dsh-agent-preset-registry`, `dsh-api-workspace-controller`, `dsh-client-ui-workspace`, `dsh-client-ui-renderer`, and `sessionQuery.readSession()` in place of the removed or split services. The client factory protocol remains unchanged. Storage domain names and record schema versions remain unchanged.

Compatibility checks cover the real CLI and plugin activation, Agent preset/stream/query lifecycle, model errors, tool denial, cancellation, disposal, and JSON storage across Host restart. Model output is supplied by a deterministic local adapter: this proves integration, not real-model planning quality or release qualification. See the [acceptance record](dsh-0.2.2-adaptation-2026-11-09.zh-CN.md) for evidence and reproduction.

Harness prerelease SemVer does not imply compatibility across release candidates. Every future Harness RC or stable release must be validated before the peer range is changed. Harness packages are optional peers because the profile Host supplies them; a generic npm install that auto-resolves peers can construct an invalid mixed-RC tree from upstream prerelease ranges. Use the Harness `dsh plugin` manager and pnpm-backed profile rather than treating the package as a standalone Node application.

## v1 stable contracts

Within the 1.x line, the project treats these as public compatibility contracts:

- package root export, `./client`, and CLI binary names;
- HTTP route paths, documented status classes, and structured `{ error: { code, message } }` failures;
- omitted `POST /projects` creation mode retaining legacy AI decomposition, while explicit `mode: "empty"` returns a non-planning `201` draft;
- Command idempotency and review ownership semantics;
- storage-domain name and forward-readable version-1 records;
- queued-work recovery and terminal cleanup ordering;
- explicit absence of unknown token and cost data.

New optional fields, read routes, Inbox projections, Artifact kinds, and backward-compatible commands may be added in minor releases.

## Breaking changes

The following require a new major version:

- removing or renaming exports, routes, commands, or CLI verbs;
- changing Issue, review, idempotency, or terminal settlement ownership;
- destructive storage migration without an export/import path;
- broadening Runtime semantics to remote execution in a way that changes current safety assumptions.

## Known boundaries

- one active Harness Host is supported per storage domain;
- remote/reverse-proxied mutation clients fail the loopback and same-origin policy by design;
- Windows process groups, shells, Git worktrees, and local directory opening are not certified;
- local directory opening is certified only for macOS `open` and Linux `xdg-open` and is unavailable to remote/reverse-proxied clients by design;
- PR support stores references and evidence; it does not push or authenticate with providers;
- Transcript redaction is best effort and not a DLP system.
