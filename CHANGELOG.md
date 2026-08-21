# Changelog

English | [简体中文](CHANGELOG.zh-CN.md)

All notable changes to this project are documented here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.3.1] - 2026-08-21

### Added

- In-app directory browsing when the Harness Host provides the `browse` picker capability instead of a native operating-system chooser.
- Durable Project-to-Harness Workspace association, with automatic same-path Workspace reuse and a Project action to open it.

### Fixed

- Local repository selection no longer fails on Web Hosts without the native directory-picker capability.

## [1.3.0] - 2026-08-21

### Added

- Local repository project creation through the Harness Host directory picker.
- GitHub repository project creation with branch selection, shallow clone, paginated branch and Issue inspection, and selected Issue import.
- Planner and execution prompt boundaries that treat GitHub Issue and project evidence as untrusted data.

### Changed

- GitHub Resources persist their local clone path for later execution and Worktree selection.
- Project intake drafts keep only non-sensitive metadata, expire after 30 minutes, and discard legacy sensitive drafts.
- Repository inspection requests cancel stale requests and ignore out-of-date responses.

### Security

- Project creation compensates partial persistence failures and validates clone roots and local API access boundaries.

## [1.2.1] - 2026-08-20

### Added

- Complete Simplified Chinese editions of the API, architecture, compatibility, operations, migration, release, contribution, security, support, governance, code-of-conduct, and changelog documentation.
- Bidirectional language navigation and automated documentation link/package-content verification.

### Changed

- The Simplified Chinese README now links exclusively to Chinese documentation pages, and the npm package includes both language editions.

## [1.2.0] - 2026-08-20

### Added

- Default empty-Project creation in the Web workbench, with explicit opt-in AI decomposition and later manual or AI planning.
- Project-ID-scoped local directory opening for certified macOS and Linux Hosts.
- Product and UI design contracts documenting explicit AI intent, restrained engineering-console presentation, and WCAG 2.2 AA targets.

### Changed

- Project records and editing now permit empty PRD/technical-design fields, while AI decomposition requires a non-empty delivery brief.
- Editing Project metadata no longer invokes AI implicitly; safe metadata-only saves preserve the current plan and approval, while plan-affecting edits use the execution-history-protected replan action.
- Modal dialogs now trap keyboard focus, close with Escape, and restore focus to their trigger.
- Reworked the Simplified Chinese README around first-use workflows, AI boundaries, directory opening, and security expectations.

### Security

- Directory opening resolves the authoritative persisted Project path, revalidates it at action time, rejects broad roots, and invokes fixed executables with argv rather than shell interpolation.

## [1.1.0] - 2026-08-20

### Added

- Project-level `zh-CN`/`en` planning language, Simplified Chinese by default, plus approval-invalidating regeneration for unexecuted plans.

### Changed

- Upgraded the pinned GitHub Actions runtime dependencies and moved CodeQL initialization and analysis together to v4.37.7.
- Upgraded esbuild to `0.28.2` and constrained Dependabot from proposing uncertified TypeScript and Node type major versions.

## [1.0.0] - 2026-08-20

### Added

- Durable Projects, Issues, Tasks, TaskRuns, Decisions, Commands, Squads, Delegations, Runtimes, Resources, Transcripts, Artifacts, and Activity records.
- Approval-gated autonomous delivery and independently executed test commands.
- Runtime-aware Issue dispatch, Agent concurrency capacity, directory locks, workspace leases, and restart recovery.
- Real Git worktree execution with branch, commit, diff, Artifact, and cleanup evidence.
- Inbox, workload, run statistics, bounded Autopilot, idempotent external triggers, and loopback CLI.
- Responsive Harness Web workbench with Inbox, Issues, Projects, Agents, Squads, Runtimes, Skills, and Autonomous Delivery pages.
- Project-local `.venv` discovery for approved test commands and persisted execution-environment evidence.

### Compatibility

- Certified against DeepSeek Harness `0.1.0-rc.6` and Cordis `4.0.1`.
- Runtime records represent dispatch eligibility inside one Harness Host; multi-host execution and distributed locking are not provided.
