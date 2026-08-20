# Security policy

## Supported versions

Security fixes are provided for the latest 1.x release certified in `docs/compatibility.md`.

## Reporting a vulnerability

Do not open a public issue. Use GitHub private vulnerability reporting for `zhangz-2018/dsh-project-orchestrator` after the repository is published. If private reporting is unavailable, contact the maintainer through the private contact method shown on the GitHub profile and request a secure reporting channel before sharing details.

Include affected versions, impact, prerequisites, reproduction steps, and a minimal proof of concept. Do not include real credentials, private repositories, or unredacted storage/session data. Expect acknowledgement within seven days; remediation timelines depend on severity and Harness upstream dependencies.

## Security boundaries

Operators must understand these intentional capabilities:

- approved test commands execute with `shell: true` in a selected workspace;
- full-policy Agents can read and modify repository files using Harness tools;
- Git worktree operations create branches and remove temporary directories;
- Transcripts, command payloads, errors, diffs, and Artifacts can persist sensitive repository context;
- credential-shaped environment variables are filtered and Transcript text is redacted best effort, but this is not comprehensive secret detection or DLP;
- storage is local JSON and is not encrypted by this plugin;
- mutation protection is loopback and same-origin, not user authentication or multi-tenant authorization;
- one Host process is assumed; active/active access to the same storage is unsupported.

Run Harness under a least-privilege OS account, restrict repository access, review Agent tool policy, use isolated worktrees where possible, protect the storage file, and never approve commands from untrusted plans without review.

## Out of scope

Reports that require an already-authorized operator to deliberately approve an arbitrary destructive shell command are not vulnerabilities by themselves. Bypasses of the approval, origin, workspace, redaction, or cleanup boundaries are in scope.
