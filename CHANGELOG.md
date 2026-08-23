# Changelog

English | [简体中文](CHANGELOG.zh-CN.md)

All notable changes to this project are documented here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.5.5] - 2026-08-23

### Added

- Record clean Harness Host/Web and real Agent execution smoke evidence for the remediation release.

## [1.5.4] - 2026-08-22

### Fixed

- Harden TaskRun settlement, workspace recovery, command reservations, and release verification against cancellation, restart, cleanup, and duplicate-request races.

- Task deletion now explains which downstream Tasks still depend on the selected Task and disables deletion until those dependencies are removed.
- The server returns actionable task names instead of opaque task IDs when dependency protection rejects deletion.

## [1.5.3] - 2026-08-22

### Security

- Upgrade `pdfjs-dist` to the patched `6.2.108` release for CVE-2026-16633 / GHSA-hq66-cqwq-w95j.
- Disable PDF scripting explicitly during requirement imports so untrusted PDF content cannot execute document scripts in the Harness origin.

## [1.5.2] - 2026-08-22

### Added

- A unified accessible confirmation dialog for destructive, archival, membership, task, planning, and draft-discard actions, with semantic labeling, Escape cancellation, focus trapping, focus restoration, and responsive actions.

### Changed

- Replaced native browser confirmation prompts throughout the Web workbench.
- Moved the project working directory into an unframed information band so long filesystem paths read as read-only facts instead of input controls.

## [1.5.1] - 2026-08-22

### Added

- Recoverable planning diagnostics in the Project overview with a direct replan action when the Harness session lacks repository read-only tools.
- Progressive disclosure for planner technical details, preserving the original diagnostic without mixing internal English instructions into the Chinese overview.

### Changed

- Project directory facts and Workspace/file-manager actions now use separate visual regions with responsive mobile actions.
- Project overview summaries now expose active Agent membership as a stable count while retaining full names as accessible context.

## [1.5.0] - 2026-08-21

### Added

- Full Squad management with project eligibility projections, strict two-member writes, global delegation capacity, optimistic concurrency, clone/archive protections, and Agent/Squad Issue assignment in the Web workbench.
- Full local Runtime management with a derived default Host, separate lifecycle and health, Agent/Project Resource binding flows, impact previews, immutable TaskRun Runtime name snapshots, and abnormal Runtime Inbox evidence.
- Responsive management drawers, project context entries, local-data visibility, mobile sheets, and accessible reduced-motion/zoom behavior.

### Changed

- Issue execution resolves Agent and Project Resource Runtime bindings before creating a TaskRun and rejects mismatched explicit bindings.
- Runtime workspace roots must already exist as writable, safe, non-symlink absolute directories and are revalidated immediately before worktree creation.
- Pending/running Commands and broken TaskRun/Issue/Delegation pointers are reconciled before startup dispatch.

### Security

- Every JSON mutation now requires `application/json`, retains the 2 MiB bounded parser, same-origin enforcement, loopback reads, and serialized mutation handling.

## [1.4.0] - 2026-08-21

### Added

- Durable Project Agent memberships with Project-specific roles, explicit AI planning eligibility, lead selection, soft-removal history, and idempotent legacy assignment backfill.
- Atomic Project membership and Task assignment APIs, local privacy-preserving feature usage aggregates, and Project orchestration status linking plan, Issue, TaskRun, Agent, and Runtime facts.
- Project Agent management and assignment workflows in the responsive Web workbench.

### Changed

- Planning, Task and project-scoped Issue assignment, approval, retry, and execution now require active Project membership; every approved Task has an explicit Agent and execution no longer uses a workspace-global fallback Agent.
- Squads and Runtimes move into progressive navigation while contextual links keep abnormal execution states directly reachable.

## [1.3.5] - 2026-08-21

### Added

- PDF requirement and technical-design imports that send extracted page text and rendered page images to the selected Harness AI model, including scanned image-only documents.
- Replace-or-append import controls, staged progress, cancellation, sampling and truncation warnings, and editable Markdown output without implicitly saving or planning the Project.
- WeChat Pay and Alipay support links in the project README files.

### Fixed

- Project deletion now cascades through every Project-owned Task, Issue, approval, run, TaskRun, Decision, delegation, transcript, Artifact, command, trigger, lease, and local-directory lock while preserving shared Agents, Squads, Runtimes, and Harness Workspaces.
- Failed child-record cleanup leaves the Project record intact so deletion can be retried safely.

### Security

- PDF imports validate canonical base64, image type, dimensions, pixel and byte limits, model image capability, same-origin JSON requests, bounded concurrency, request cancellation, and a three-minute timeout before AI analysis.
- Extracted PDF text and page images are explicitly treated as untrusted evidence and cannot enable tools or override the requirement-analysis contract.

## [1.3.4] - 2026-08-21

### Added

- A client style contract test that prevents direct light-only colors and nonexistent Harness theme tokens from returning.

### Fixed

- Every Project Orchestrator view now follows the Harness global light and dark themes, including the task board, semantic status and priority badges, dialogs, project details, Agent Builder, feedback surfaces, and mobile navigation.
- Focus, hover, active, selected, and disabled states now use supported Harness tokens and remain legible across both themes.

## [1.3.3] - 2026-08-21

### Fixed

- The Cordis client plugin now injects the `workspaces` service by service name, while the package manifest continues to declare the runtime package dependency separately.

## [1.3.2] - 2026-08-21

### Added

- Multiple requirement documents and append-only decomposition batches per Project, preserving prior plans and task evidence.
- A Project detail action to submit another requirement document and append its generated code and test tasks.

### Fixed

- The directory browser now injects the Harness workspace runtime it uses, so Web Hosts with the `browse` capability no longer fail with a missing `workspaces` service.

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
