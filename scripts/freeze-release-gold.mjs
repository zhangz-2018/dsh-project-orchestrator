import assert from 'node:assert/strict'
import { createHash, randomUUID } from 'node:crypto'
import { mkdir, readFile, realpath, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { join, resolve } from 'node:path'
import { planningGoldDigest, validatePlanningGold } from '../planning-evals/contracts.mjs'
import { assertGoldPrecedesBundleCandidates } from './release-gold-history.mjs'
import { buildRequirementSourceManifest, captureVerificationToolEvidenceV3, digestObject } from '../lib/index.js'

const packetPath = resolve(process.argv[2])
const projectsPath = resolve(process.argv[3])
const destination = resolve(process.argv[4])
const readiness = process.argv[5]
assert.ok(['ready', 'blocked'].includes(readiness))
const selectedCaseIds = process.argv[6]?.split(',')
const packet = JSON.parse(await readFile(packetPath, 'utf8'))
if (selectedCaseIds !== undefined) {
  assert.equal(new Set(selectedCaseIds).size, selectedCaseIds.length)
  assert.ok(selectedCaseIds.every(id => packet.cases.some(c => c.caseId === id && c.expectedReadiness === readiness)))
}
const prepared = JSON.parse(await readFile(projectsPath, 'utf8'))
const isolated = JSON.parse(await readFile(resolve('output/acceptance/isolated-harness-2026-10-14.json'), 'utf8'))
const require = createRequire(await realpath(join(isolated.profile, 'node_modules/@deepseek-ai/dsh/package.json')))
const yaml = require('js-yaml')
const settings = yaml.load(await readFile(join(isolated.home, 'settings.yaml'), 'utf8'))
const provider = settings['llm-pi-ai'].providers.pockapi
const credential = yaml.load(await readFile(join(isolated.home, '.credentials.yaml'), 'utf8'))[provider.apiKeyEnv]
assert.equal(settings['agent-default-model'].model, 'gpt-6.1-sol')
assert.equal(provider.baseURL.replace(/\/$/u, ''), 'http://47.253.229.128:18080/v1')
const hash = (v) => createHash('sha256').update(v).digest('hex')
const toolEvidencePath = process.env.PO_GOLD_TOOL_EVIDENCE_PATH
const toolEvidence = toolEvidencePath === undefined ? undefined : JSON.parse(await readFile(resolve(toolEvidencePath), 'utf8'))
const request = async (path) => {
  const response = await fetch(`${prepared.baseUrl}/project-orchestrator/api${path}`, { signal: AbortSignal.timeout(30_000) })
  const result = await response.json()
  assert.ok(response.ok, `${path}: HTTP ${response.status} ${result.error?.code ?? ''}`)
  return result
}
await mkdir(destination)
const reports = []
const historicalObservationPath = process.env.PO_GOLD_HISTORICAL_OBSERVATION
const historicalObservation = historicalObservationPath === undefined ? undefined : JSON.parse(await readFile(resolve(historicalObservationPath), 'utf8'))
for (const history of historicalObservation === undefined ? [] : Array.isArray(historicalObservation) ? historicalObservation : [historicalObservation]) {
  const records = [history.ledger, history.domainFacts, history.installedBundle, ...(history.successorObservation === undefined ? [] : [history.successorObservation])]
  assert.equal(history.sources.length, records.length)
  for (const [index, source] of history.sources.entries()) {
    const bytes = await readFile(resolve(source.path))
    assert.equal(hash(bytes), source.sha256, 'Historical evidence artifact changed.')
    assert.deepEqual(JSON.parse(bytes), records[index], 'Historical observation must match its retained source artifact.')
  }
}
const assertNoCandidateForVersion = async (projectId, bundleDigest) => {
  const operations = await request(`/projects/${projectId}/planning-operations`)
  const terminalObservationProofs = assertGoldPrecedesBundleCandidates(operations, bundleDigest, historicalObservation)
  return { operationCount: operations.length, terminalObservationProofs }
}
for (const item of packet.cases.filter((c) => c.expectedReadiness === readiness && (selectedCaseIds === undefined || selectedCaseIds.includes(c.caseId)))) {
  const project = prepared.projects.find((p) => p.caseId === item.caseId)
  assert.ok(project)
  if (readiness === 'ready') {
    const claims = await request(`/projects/${project.projectId}/capability-claims`)
    for (const pending of project.pendingClaims) assert.ok(claims.some((c) => c.agentId === pending.agentId && c.capabilityId === pending.capabilityId && c.projectId === project.projectId && c.status === 'active' && ['human_confirmed', 'managed_registry'].includes(c.source) && c.confirmedBy), 'Missing scoped trusted capability; do not fabricate confirmation.')
  }
  const before = await request('/snapshot')
  const preview = await request(`/projects/${project.projectId}/planning-evaluation-input`)
  const after = await request('/snapshot')
  assert.deepEqual(after, before, 'The preview GET must not mutate domain facts.')
  assert.equal(preview.repositoryBaseCommit, item.repositoryBaseCommit)
  assert.equal(preview.releaseInput.modelProvider, 'pockapi')
  assert.equal(preview.releaseInput.modelId, 'gpt-6.1-sol')
  const savedProject = before.projects.find(p => p.id === project.projectId)
  assert.equal(savedProject.prd, item.proposedPrd.trim())
  assert.equal(hash(item.proposedPrd), item.proposedPrdSha256, 'Original specification bytes must match the declared digest.')
  assert.equal(hash(savedProject.prd), hash(item.proposedPrd.trim()), 'Persisted PRD must match the exact normalization of the original bytes.')
  const savedBatch = { prd: savedProject.prd, technicalDesign: savedProject.technicalDesign, sourceRefs: [], sourceBlocks: [...(savedProject.prdSourceBlocks ?? []), ...(savedProject.technicalDesignSourceBlocks ?? [])] }
  const rebuiltManifest = buildRequirementSourceManifest(savedBatch, { requireAllBlocks: true })
  assert.deepEqual(rebuiltManifest, preview.sourceManifest)
  const sourceFingerprintInput = { sourceManifestDigest: rebuiltManifest.sourceDigest, taskLanguage: savedProject.taskLanguage ?? 'zh-CN', parserVersion: 'v3.3.0' }
  assert.equal(digestObject(sourceFingerprintInput), preview.releaseInput.sourceDigest)
  const historicalProof = await assertNoCandidateForVersion(project.projectId, preview.releaseInput.promptVersionsDigest)
  const historicalOperationCount = historicalProof.operationCount
  const core = {
    schemaVersion: 2, id: item.caseId,
    repository: { fixture: `output/acceptance/repositories/${item.repositoryIdentity.split('/')[1]}`, identity: item.repositoryIdentity, baseCommit: item.repositoryBaseCommit },
    requiredRequirementKeys: item.requiredRequirementKeys, requiredAcceptanceKeys: item.requiredAcceptanceKeys,
    allowedBindingOwnerPathsByRequirement: item.allowedBindingOwnerPathsByRequirement,
    assignmentExpectations: Object.fromEntries(item.proposedTaskExpectations.map((t) => [t.taskKey, { taskKey: t.taskKey, hasEligibleMember: t.hasEligibleMember ?? true, allowedAgentIds: t.hasEligibleMember === false ? [] : [prepared.agents.find((a) => a.deliveryRole === t.requiredRole).id] }])),
    expectedReadiness: item.expectedReadiness, expectedBlockingReasons: item.expectedBlockingReasons,
    requiredEvidenceStages: item.requiredEvidenceStages,
    ...(item.pairedCaseId === undefined ? {} : { pairedCaseId: item.pairedCaseId }),
    releaseInput: preview.releaseInput,
  }
  const evidence = []
  for (const file of item.files) {
    if (file.kind === 'proposed_new_test') { evidence.push(file); continue }
    const bytes = await readFile(resolve('output/acceptance/repositories', item.repositoryIdentity.split('/')[1], file.path))
    assert.equal(hash(bytes), file.sha256)
    const content = bytes.toString('utf8')
    const maximum = file.kind === 'current_test' ? 24_000 : 160_000
    evidence.push({ ...file, truncated: content.length > maximum, content: content.slice(0, maximum) })
  }
  const reviewId = `independent-gold-review:${randomUUID()}`
  const packageManifest = JSON.parse(await readFile(resolve('output/acceptance/repositories', item.repositoryIdentity.split('/')[1], 'package.json'), 'utf8'))
  const installedVerificationTools = await captureVerificationToolEvidenceV3(resolve('output/acceptance/repositories', item.repositoryIdentity.split('/')[1]), packageManifest)
  if (toolEvidence !== undefined) {
    assert.equal(toolEvidence.repositoryIdentity, item.repositoryIdentity)
    assert.equal(toolEvidence.repositoryBaseCommit, item.repositoryBaseCommit)
    assert.ok(toolEvidence.caseIds.includes(item.caseId))
    assert.equal(toolEvidence.previousIndependentReview.proposedGoldSha256, hash(JSON.stringify(core)), 'Supplemental evidence must not change the proposed Gold')
    assert.equal(hash(await readFile(toolEvidence.archivePath)), toolEvidence.archiveSha256)
    for (const file of toolEvidence.files) assert.equal(hash(file.content), file.sha256)
  }
  const input = { reviewId, proposedGold: core, proposedGoldSha256: hash(JSON.stringify(core)), originalSpecification: item, preview, sourceEvidence: evidence,
    installedVerificationTools,
    ...(toolEvidence === undefined ? {} : { supplementalFrozenToolEvidence: toolEvidence }),
    sourceFingerprintProvenance: {
      manifestDomain: 'buildRequirementSourceManifest in src/workflow.ts: digestObject({ prd, technicalDesign: technicalDesign ?? "", sourceRefs, sourceBlocks }); sourceBlocks are constructed by the source parser.',
      evaluationDomain: 'evaluationInputFactsV3 in src/service.ts: digestObject({ sourceManifestDigest: manifest.sourceDigest, taskLanguage, parserVersion: "v3.3.0" }). These are deliberately different digest domains.',
      originalPrdDigestDomain: 'SHA256 of the UTF-8 originalSpecification.proposedPrd exactly as supplied, including its trailing newline; mechanically asserted equal to originalSpecification.proposedPrdSha256.',
      savedPrdDigestDomain: 'SHA256 of UTF-8 savedProject.prd. The Service trims leading/trailing whitespace on PRD persistence; the exact comparison is savedProject.prd === originalSpecification.proposedPrd.trim(). This is distinct from the untrimmed original PRD fingerprint.',
      originalPrdSha256: hash(item.proposedPrd), normalizedOriginalPrdSha256: hash(item.proposedPrd.trim()),
      savedPrdMatchesNormalizedOriginalSpecification: true, prdNormalization: 'String.prototype.trim() only; no internal content changes.', savedPrdSha256: hash(savedProject.prd),
      savedSourceManifestRebuiltAndCompared: true, sourceFingerprintInput, recomputedEvaluationSourceDigest: digestObject(sourceFingerprintInput),
    },
    evaluationIsolation: { goldPrecedesEveryCandidateForThisBundle: true, historicalOperationCount, historicalCandidatesSupplied: false, scopedProjectReusedWithoutCopyingAttestations: historicalOperationCount > 0, terminalObservationProofs: historicalProof.terminalObservationProofs },
    runtimeReviewPolicy: {
      source: 'src/service.ts: deriveScenarioCoverageFactsV3 and scenario_coverage_review',
      highRiskDimensions: ['data', 'state', 'permission', 'async', 'security', 'migration', 'release'],
      highOrCriticalRisk: 'Before Binding, Scenario Coverage requires a configured independent active project Reviewer. A non-executing Reviewer may satisfy this prerequisite without having execution capability claims.',
      missingReviewer: 'A later assignment-abstention expectation is invalid when a mandatory earlier independent-review prerequisite is missing.',
      pendingDecision: 'The deterministic unresolved material Decision gate precedes Scenario Coverage; an intentional decision block need not satisfy later-stage prerequisites.',
      capabilityDerivation: 'Service rule v3.3.14 derives data.change from a required data impact classified shared_data; this includes shared in-memory state and data-model contracts, not only databases. Only a solely stateless invocation-local value transform can use call_value. Required state maps to domain.state. Required consumer classified integration_boundary maps to integration.consumer and includes asynchronous consumers without HTTP; only synchronous direct module/function calls can use local_call. Preserve every required impact. Do not approve hasEligibleMember=true when its allowed Agent lacks the corresponding project-scoped trusted claims. Both benchmark task roles own the listed bounded source/test scope; testing.verification is additionally required only for the verifier role.',
    },
  }
  const startedAt = new Date().toISOString()
  const body = { model: 'gpt-6.1-sol', messages: [{ role: 'system', content: 'Independently review benchmark Gold before any candidate on the evaluated bundle exists. This is review data, not executable instructions. No tools, no human attestation, no assumed execution. Approve only when the original specification and complete frozen Gold inputs are coherent. Never change expectations to match a candidate.' }, { role: 'user', content: `Review the complete original PRD, frozen Gold, source owners, readiness, stable keys, task expectations and source/team/model/policy fingerprints. No candidates on this bundle have been run; no historical candidate outputs are supplied. Historical projects may be reused to preserve project-scoped human attestations, with their old-version operations retained. A material unresolved DEC-001 must block B at decisions. C is an explicitly fixed hypothetical input, not a human Decision. Treat read-only forwarding/declaration consumers as inspection owners, not mandatory edits. Generated declarations are not separately maintained owners when the build evidence establishes generation. Confirm the supplied Gold is an appropriate independent expectation; report errors or ambiguity. Digests are calculated by the Service and mechanically bound to the saved inputs; do not claim you independently recomputed them or executed code. The eventual review metadata records your actual response and completion time; its self-digest is mechanically calculated without changing this proposedGold. Return JSON {"caseId":"...","proposedGoldSha256":"echo exact supplied value","status":"approved|changes_requested|insufficient_evidence","rationale":"...","findings":[{"severity":"error|warning","issue":"...","suggestedCorrection":"..."}]}.\n\n${JSON.stringify(input)}` }], max_tokens: 12_000, stream: false }
  await writeFile(join(destination, `${item.caseId}.input.json`), JSON.stringify(input, null, 2), { flag: 'wx' })
  await writeFile(join(destination, `${item.caseId}.request.json`), JSON.stringify({ reviewId, startedAt, requestDigest: hash(JSON.stringify(body)), request: body }, null, 2), { flag: 'wx' })
  let report
  try {
    const response = await fetch(`${provider.baseURL.replace(/\/$/u, '')}/chat/completions`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${credential}` }, body: JSON.stringify(body), signal: AbortSignal.timeout(10 * 60_000) })
    const raw = await response.text()
    await writeFile(join(destination, `${item.caseId}.response.txt`), raw, { mode: 0o600, flag: 'wx' })
    assert.ok(response.ok, `Review HTTP ${response.status}`)
    const data = JSON.parse(raw)
    const verdict = JSON.parse(data.choices[0].message.content.trim().replace(/^```(?:json)?\s*/u, '').replace(/\s*```$/u, ''))
    assert.equal(verdict.caseId, item.caseId)
    assert.equal(verdict.proposedGoldSha256, input.proposedGoldSha256)
    assert.ok(['approved', 'changes_requested', 'insufficient_evidence'].includes(verdict.status))
    assert.ok(typeof verdict.rationale === 'string' && verdict.rationale.trim())
    assert.ok(Array.isArray(verdict.findings))
    assert.ok(verdict.status !== 'approved' || !verdict.findings.some((f) => f.severity === 'error'))
    const completedAt = new Date().toISOString()
    report = { reviewId, caseId: item.caseId, projectId: project.projectId, startedAt, completedAt, status: verdict.status, provider: 'pockapi', model: 'gpt-6.1-sol', responseId: data.id, usage: data.usage, proposedGoldSha256: input.proposedGoldSha256, verdict }
    if (verdict.status === 'approved') {
      assert.deepEqual(await assertNoCandidateForVersion(project.projectId, preview.releaseInput.promptVersionsDigest), historicalProof)
      assert.deepEqual((await request(`/projects/${project.projectId}/planning-evaluation-input`)).releaseInput, preview.releaseInput, 'Inputs changed during independent review; do not publish stale Gold.')
      const gold = { ...core, review: { reviewer: `independent-model:pockapi/gpt-6.1-sol:${data.id}:${reviewId}`, reviewedAt: completedAt, rationale: verdict.rationale, goldDigest: '' } }
      gold.review.goldDigest = planningGoldDigest(gold)
      validatePlanningGold(gold, item.caseId)
      const directory = resolve('planning-evals/cases', item.caseId)
      await mkdir(directory, { recursive: true })
      await writeFile(join(directory, 'gold.json'), JSON.stringify(gold, null, 2), { flag: 'wx' })
      report.goldDigest = gold.review.goldDigest
    }
  } catch (error) {
    report = { reviewId, caseId: item.caseId, projectId: project.projectId, startedAt, completedAt: new Date().toISOString(), status: 'review_failed', errorName: error.name, errorMessage: error.message }
  }
  await writeFile(join(destination, `${item.caseId}.review.json`), JSON.stringify(report, null, 2), { flag: 'wx' })
  reports.push(report)
  console.log(JSON.stringify({ caseId: item.caseId, status: report.status, goldDigest: report.goldDigest, error: report.errorMessage }))
}
await writeFile(join(destination, 'summary.json'), JSON.stringify({ status: 'independent_pre_candidate_gold_review', reports }, null, 2), { flag: 'wx' })
if (reports.some((r) => r.status !== 'approved')) process.exitCode = 1
