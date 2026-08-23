# Migration from a local or scoped build

English | [简体中文](migration.zh-CN.md)

The public package replaces development builds such as `@mindquant/dsh-project-orchestrator` while intentionally retaining:

- Cordis plugin name `project-orchestrator`;
- HTTP prefix `/project-orchestrator/api`;
- storage domain `project_orchestrator`;
- existing version-1 record schemas and compatibility projections.

This preserves local data when the loader package name changes.

## Safe migration

1. Stop the existing Harness Host.
2. Back up `~/.dsh/storages/project_orchestrator.json`.
3. Install the target release through the same Web profile, for example `dsh-project-orchestrator@1.5.7`; do not treat the example version as fixed.
4. Replace the loader row package name; do not add a second row:

   ```yaml
   - id: project-orchestrator
     name: dsh-project-orchestrator
   ```

5. Remove the old scoped package only after the new package is installed.
6. Restart the existing Host once.
7. Verify health, snapshot counts, queued/recovered TaskRuns, and the Web launcher.

Never load both packages simultaneously. They register the same Host route and storage domain and would create conflicting owners.

## Project Agent membership backfill

The membership-aware release adds compatibility tables without changing the `project_orchestrator` domain name. During the first startup it idempotently creates active Project Agent memberships from:

- the persisted `Project.leadAgentId` when its Agent still exists and is active;
- every current `Task.agentId` in the Project plan when its Agent still exists and is active;
- every active Agent assignee on a non-terminal Project Issue.

Historical TaskRun Agents that are no longer referenced do not become active members. Missing or archived legacy Agents are never reactivated: an invalid lead is cleared, while an affected Task or Issue remains visible for repair and fails closed at assignment, approval, retry, or execution. This does not prevent the Host from starting. Back up storage before the first startup and verify that every assigned Task projects one active membership; reassign any unresolved reference before delivery.

## Squad and Runtime 1.5 compatibility

Version 1.5 keeps storage domain version 1 and performs an idempotent compatibility pass. Legacy Runtimes default to lifecycle `active`; TaskRuns retain their Runtime ID and receive a best-effort Runtime name snapshot without rewriting execution evidence. Legacy one-member Squads remain readable but are ineligible for new Project assignment until edited to contain at least two distinct active Agents. New Runtime workspace roots are never created implicitly and must pass the existing-directory safety checks.

The upgrade also reconciles pending/running Commands and broken active TaskRun pointers before dispatch. Because older binaries do not understand these lifecycle and recovery invariants, rollback requires the pre-upgrade storage backup rather than code-only package downgrade.

## Client module identity

The public Client module loader ID is `dsh-project-orchestrator`; old cached Client artifacts may still contain a scoped ID. Restart Host and refresh the Web page after migration so the shell receives the current bundle.

## Rollback

Stop Host and keep executable queues paused. To return to an older behavior contract, restore both the prior loader package and the pre-upgrade storage backup, then restart and verify queue state before resuming. Do not run an older package directly against membership-aware live data: schema readability does not preserve its assignment and fallback safeguards.
