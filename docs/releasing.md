# Release runbook

English | [简体中文](releasing.zh-CN.md)

Only maintainers publish releases.

## One-time repository setup

1. Create `zhangz-2018/dsh-project-orchestrator` with `main` as the default branch.
2. Enable Discussions, private vulnerability reporting, Dependabot alerts, secret scanning, and push protection.
3. Protect `main`: require pull requests, resolved conversations, CI and CodeQL checks; block force pushes and deletion.
4. Add a ruleset restricting `v*` tag creation.
5. Create a protected GitHub environment named `npm`.
6. In npm, configure trusted publishing for owner `zhangz-2018`, repository `dsh-project-orchestrator`, workflow `release.yml`, and environment `npm`.
7. Keep default GitHub Actions token permissions read-only.

## Release checklist

1. Confirm `docs/compatibility.md` matches the tested Harness version.
2. Update `CHANGELOG.md` and `package.json` version.
3. Run:

   ```bash
   corepack enable
   pnpm install --frozen-lockfile
   pnpm verify
   npm publish --dry-run --access public
   ```

4. Confirm the package name is still available or owned by the maintainer.
5. Merge through protected `main`.
6. Create and push an annotated tag matching the manifest exactly:

   ```bash
   git tag -a "v${VERSION}" -m "dsh-project-orchestrator v${VERSION}"
   git push origin "v${VERSION}"
   ```

7. The release workflow re-runs verification, publishes with npm provenance, and creates GitHub release notes.
8. Verify the npm provenance link, install through a clean Harness profile, restart the existing Host, and confirm `/project-orchestrator/api/health` plus the Web launcher.

## Failed release

Do not move or reuse an already published npm version. Fix forward with a new patch version. If npm publication succeeded but GitHub release creation failed, create release notes manually for the immutable tag. If publication did not occur, delete or replace the tag only according to repository tag-protection policy and after confirming no consumer received it.
