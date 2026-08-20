# dsh-project-orchestrator

English | [简体中文](README.zh-CN.md)

A durable, approval-gated project orchestration workbench for [DeepSeek Harness](https://github.com/deepseek-ai/DeepSeek-Harness).

`dsh-project-orchestrator` adds a Host service, responsive Web workbench, and loopback CLI to one existing Harness installation. It keeps Projects, Issues, TaskRuns, human Decisions, Agent capacity, Git worktree evidence, Transcripts, Artifacts, and automation receipts in one auditable local workflow.

> **Compatibility:** v1.2.0 is certified only with DeepSeek Harness `0.1.0-rc.6`, Cordis `4.0.1`, Node.js 22+, and Git. Future Harness release candidates are not covered until tested.

## Project creation is not an AI side effect

The Web client defaults to **Empty Project**. It records the Project name and existing working directory without reading the repository, invoking a Planner, creating Tasks, or creating an approval. Add Tasks manually, or add a delivery brief later and explicitly request AI decomposition.

Choose **AI decomposition** only when a delivery brief is ready. Planning inspects the repository read-only, generates code and test Tasks, and still requires explicit human approval before execution.

The Project detail view can open the persisted working directory in Finder on macOS or the system file manager through `xdg-open` on Linux. The Host accepts only a Project ID for this action; Windows is not certified.

## Highlights

- **Explicit AI planning:** Project creation and AI decomposition are separate actions; an empty Project is the Web default.
- **Approval-gated delivery:** AI planning produces a revision/hash-bound plan; execution starts only after explicit approval.
- **Durable Issue execution:** assignment, reassign, stop, continue, review, and Decision requests converge on idempotent Command records.
- **Runtime and capacity controls:** Runtime heartbeat, Agent `maxConcurrency`, queue retention, restart recovery, directory locks, and workspace leases.
- **Real Git isolation:** fail-closed worktree creation, deterministic branches, base/head commits, bounded diffs, Artifacts, and cleanup evidence.
- **Human collaboration:** Inbox, review gates, comments, Activity, Squads, delegated child Issues, and Leader continuation.
- **Auditable automation:** bounded Autopilot, external-trigger deduplication, loopback CLI, Transcript redaction, and explicit unknown token/cost facts.
- **Responsive workbench:** Inbox, Issues, Projects, Agents, Squads, Runtimes, Skills, and Autonomous Delivery inside the existing Harness Web shell.
- **Project environment discovery:** approved commands use `<project>/.venv` when present and record the resolved execution environment.
- **Chinese-first planning:** new Projects default to Simplified Chinese human-facing tasks, can opt into English, and can regenerate an unexecuted plan in Chinese with fresh approval required.

## Install

Install pnpm first because the Harness profile plugin manager owns and supplies the required Host peers, then add the npm package. Do not install this plugin as a standalone application with npm peer auto-resolution; Harness `0.1.0-rc.6` packages expose prerelease transitive peer ranges that can otherwise resolve a mixed RC tree.

```bash
npm install --global pnpm
dsh plugin --profile web add dsh-project-orchestrator@1.2.0
```

Add the plugin to the Web profile loader patch, normally `~/.dsh/profiles/web/cordis.patch.yml`:

```yaml
- id: project-orchestrator
  name: dsh-project-orchestrator
```

Restart the existing `dsh web` process and refresh its current URL. Do not run a second Web server for the same profile.

Verify the Host half:

```bash
curl --fail http://127.0.0.1:3080/project-orchestrator/api/health
```

The launcher appears in the Harness sidebar footer.

## CLI

The packaged CLI calls the same loopback API as the Web client and refuses non-loopback URLs:

```bash
dsh-project-orchestrator --help
dsh-project-orchestrator snapshot
dsh-project-orchestrator inbox
dsh-project-orchestrator stats
dsh-project-orchestrator command '{"type":"autopilot_tick","actorType":"human","payload":{"agentId":"...","limit":10}}'
```

Override the local API only when the Harness still listens on loopback:

```bash
DSH_PROJECT_ORCHESTRATOR_URL=http://127.0.0.1:3080/project-orchestrator/api \
  dsh-project-orchestrator stats
```

## Execution model

1. A Project owns the approved plan and Resources.
2. An Issue owns assignment, lifecycle, review state, and its active TaskRun pointer.
3. A TaskRun owns one queue/execution attempt and its evidence.
4. A Runtime controls local dispatch eligibility; an Agent contributes capacity.
5. A worktree or in-place lease is acquired before execution.
6. Harness Session events are projected into bounded redacted Transcript entries.
7. Workspace cleanup and evidence settle before a TaskRun becomes terminal.
8. Human review approval is the only Issue completion path.

Runtime records are local Harness Host facts. v1.2.0 does **not** provide remote Agent execution, active/active Hosts, distributed locks, remote branch push, or provider-authenticated pull-request creation.

## Security model

- Mutations require a loopback peer, loopback Host, a matching `Origin`, and same-origin fetch metadata.
- The CLI accepts loopback URLs only.
- Credential-shaped environment variables are removed from child processes.
- Transcript projection is bounded and applies best-effort credential-shaped text redaction.
- Approved test commands intentionally execute through the platform shell. Agents with full tool policy can modify the selected workspace.

Read [SECURITY.md](SECURITY.md) before using the plugin with sensitive repositories. Use a dedicated OS account or stronger sandbox when repository trust is uncertain.

## Storage and recovery

The storage domain is `project_orchestrator`; a standard local profile currently persists it under `~/.dsh/storages/project_orchestrator.json`. Back up that file while Harness is stopped before upgrades or destructive maintenance.

Storage version 1 preserves missing newer tables as empty compatibility tables. Forward migration is supported within the v1 line; downgrade safety is not guaranteed. See [docs/operations.md](docs/operations.md).

## Development

```bash
corepack enable
pnpm install --frozen-lockfile
pnpm verify
```

Useful commands:

```bash
pnpm typecheck
pnpm test
pnpm build
pnpm smoke:package
```

The package smoke test builds the exact npm artifact, checks its file allowlist and executable mode, installs it in a clean temporary project, exercises CLI help/version, and rejects source maps containing absolute home paths.

## Documentation

- [Architecture and source-of-truth rules](docs/architecture.md)
- [HTTP and CLI contracts](docs/api.md)
- [Compatibility and stability policy](docs/compatibility.md)
- [Operations, backup, upgrade, and rollback](docs/operations.md)
- [Migration from local or scoped builds](docs/migration.md)
- [Maintainer release runbook](docs/releasing.md)
- [Contributing](CONTRIBUTING.md)
- [Security policy](SECURITY.md)
- [Support policy](SUPPORT.md)
- [Governance](GOVERNANCE.md)
- [Changelog](CHANGELOG.md)

## Project status and affiliation

This is an independent community plugin and is not an official DeepSeek or DeepSeek Harness project. DeepSeek and related names may be trademarks of their respective owners.

## License

[MIT](LICENSE) © 2026 zhangz-2018
