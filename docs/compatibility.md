# Compatibility and stability

## Certified matrix

| Plugin | DeepSeek Harness | Cordis | Node.js | Git | Platforms |
|---|---|---|---|---|---|
| 1.0.x | 0.1.0-rc.6 | 4.0.1 | >=22 | required for worktrees | Linux and macOS CI; Windows not certified |

Harness prerelease SemVer does not imply compatibility across release candidates. Every future Harness RC or stable release must be validated before the peer range is changed. Harness packages are optional peers because the profile Host supplies them; a generic npm install that auto-resolves peers can construct an invalid mixed-RC tree from upstream prerelease ranges. Use the Harness `dsh plugin` manager and pnpm-backed profile rather than treating the package as a standalone Node application.

## v1 stable contracts

Within the 1.x line, the project treats these as public compatibility contracts:

- package root export, `./client`, and CLI binary names;
- HTTP route paths, status classes, and structured `{ error: { code, message } }` failures;
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
- Windows process groups, shells, and Git worktrees are not certified;
- PR support stores references and evidence; it does not push or authenticate with providers;
- Transcript redaction is best effort and not a DLP system.
