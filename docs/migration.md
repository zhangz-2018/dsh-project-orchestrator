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
3. Install `dsh-project-orchestrator@1.2.1` through the same Web profile.
4. Replace the loader row package name; do not add a second row:

   ```yaml
   - id: project-orchestrator
     name: dsh-project-orchestrator
   ```

5. Remove the old scoped package only after the new package is installed.
6. Restart the existing Host once.
7. Verify health, snapshot counts, queued/recovered TaskRuns, and the Web launcher.

Never load both packages simultaneously. They register the same Host route and storage domain and would create conflicting owners.

## Client module identity

The public Client module loader ID is `dsh-project-orchestrator`; old cached Client artifacts may still contain a scoped ID. Restart Host and refresh the Web page after migration so the shell receives the current bundle.

## Rollback

Stop Host, restore the prior loader package and storage backup if needed, then restart. Do not downgrade after a future schema migration unless that release documents downgrade compatibility.
