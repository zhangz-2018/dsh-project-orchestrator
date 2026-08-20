# Changelog

All notable changes to this project are documented here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
