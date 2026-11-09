# Contributing

English | [简体中文](CONTRIBUTING.zh-CN.md)

Thank you for improving `dsh-project-orchestrator`.

## Before opening a change

- Search existing Issues and Discussions.
- For behavior changes, describe the business owner, source of truth, write/read paths, failure semantics, compatibility impact, and verification plan.
- Discuss breaking API, storage, security, or execution changes before implementation.
- Never include credentials, real Harness storage, private repository data, local profile configuration, or generated `lib/` artifacts.

## Development setup

Requirements: Node.js >=24.9.0, pnpm 10.34.5, Git, and DeepSeek Harness 0.2.2-rc.1 for live validation.

```bash
corepack enable
pnpm install --frozen-lockfile
pnpm exec playwright install chromium
pnpm verify
```

The test suite uses Node's test runner, real temporary Git repositories for worktree coverage, and a loopback browser Host backed by the Harness JSON storage provider. It must not depend on a contributor's absolute paths or persistent profile data.

## Pull requests

1. Keep the change focused and update tests.
2. Cover success, rejection/failure, boundary, and unchanged behavior where applicable.
3. Update README/API/compatibility/operations documentation when contracts change.
4. Add a changelog entry for user-visible changes.
5. Run `pnpm verify` and include the result.
6. Explain storage migration and rollback impact.
7. Confirm no generated bundle, tarball, `.env`, storage, or local worktree was committed.

Commits should be clear and imperative. Conventional Commit prefixes are encouraged but not required.

## Release policy

Only maintainers publish. A release tag must exactly match the package version, CI and package smoke must pass, and npm publication uses trusted publishing with provenance. See `GOVERNANCE.md` and `docs/compatibility.md`.
