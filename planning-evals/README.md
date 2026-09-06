# Planning evaluation harness

Each directory under `cases/` freezes business invariants in `gold.json` and contains at least five candidate outputs under `runs/`. The grader scores requirement and acceptance conservation, decision bypass, false-ready, evidence validity, per-Requirement binding owner precision/recall, task executability, assignment, abstention, rewrite rate, and five-run invariants. `allowedBindingOwnerPathsByRequirement` is a list of complete equivalent owner sets; one set must be covered, not every alternative at once.

Run `pnpm eval:planning:subset` while developing the grader. Run `pnpm eval:planning` for the release gate; it also requires at least eight unique `repository.identity` values, 24 independently reviewed case directories, and five real-model runs per case. A case with many Requirement records is still one requirement sample, and copying one repository into several cases does not increase the repository count. Use `pnpm eval:planning:subset -- --output /absolute/path/result.json` to persist a machine-readable report. Frozen sample outputs validate the grader contract but never qualify a release.

A `real_model` run must include provenance for a unique Planning operation. The provenance freezes the repository base commit and digest, source/team/Decision inputs, MetricPolicy, Prompt versions, model provider/id/version, sampling configuration, token/tool budgets, operation digest, and start/completion timestamps. Those frozen inputs, including the model configuration and budgets, must match `gold.json.releaseInput`. Merely changing `executionKind` on a fixture is rejected and repeated copies of one Planning operation do not count as five runs.

Release qualification also reads `canary/release.json` by default, or the path supplied with `--canary`. This report must match the package version and identify the immutable Planning operation, source snapshot, approved PlanSnapshot, Approval, ordered Dispatch chain, terminal TaskRuns, Delivery Integration, final Git commit, and converged review. Multiple started or partially-started Dispatches are expected for dependency DAG frontiers. Integration must still select exactly one completed TaskRun per approved Task; failed or cancelled attempts remain in the evidence chain instead of being hidden. Required Requirement/Acceptance coverage must be complete and both false-ready and false-converged must be false. Missing or malformed canary evidence fails the release gate; never add a synthetic report to make the gate pass.

Capture artifacts from a running loopback Harness without manually assembling JSON:

```bash
dsh-project-orchestrator capture-planning-eval PROJECT_ID OPERATION_ID CASE_ID RUN_ID --output planning-evals/cases/CASE_ID/runs/RUN_ID.json
dsh-project-orchestrator capture-release-canary PROJECT_ID --output planning-evals/canary/release.json
```

The service exports only terminal same-operation evidence and refuses missing provenance, stale digests, reused predecessor model lineage, false-ready assignments, uncovered required scope, incomplete Dispatch/TaskRun closure, or non-converged delivery. The CLI validates the versioned schema, writes through an `fsync`ed same-directory temporary file, and refuses to overwrite an existing artifact. Model catalog lookup failure does not stop Planning, but such an operation has no release provenance and cannot be exported as a real-model evaluation run.
