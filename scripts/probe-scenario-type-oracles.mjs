import assert from 'node:assert/strict'
import { mkdir, open, readFile, realpath, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { BindingStage, OrchestratorService, captureVerificationToolEvidenceV3, digestObject, parseGeneratedScenarioCompletionV3, parseGeneratedScenarioCoverageReviewV3 } from '../lib/index.js'

// Real prompt comparison on retained frozen inputs. No domain mutations,
// original-operation retries, approvals, dispatches, or release candidates.
const destination = process.argv[2]
assert.ok(destination)
const diagnosticRule = process.argv[5] ?? 'type-oracle'
assert.ok(['type-oracle', 'type-oracle-presence', 'fixture-lifecycle', 'compiler-config', 'branch-fixture', 'async-fixture', 'command-catalog', 'callable-fixture', 'fault-connection', 'tool-evidence'].includes(diagnosticRule))
const snapshot = await (await fetch('http://127.0.0.1:3087/project-orchestrator/api/snapshot')).json()
const isolated = JSON.parse(await readFile('output/acceptance/isolated-harness-2026-10-14.json', 'utf8'))
const installedPath = await realpath(`${isolated.profile}/node_modules/dsh-project-orchestrator/lib/index.js`)
const { OrchestratorService: OriginalService } = await import(pathToFileURL(installedPath).href)
const currentService = Object.create(OrchestratorService.prototype)
const originalService = Object.create(OriginalService.prototype)
const source = await readFile('src/service.ts', 'utf8')
const persona = name => {
  const result = source.match(new RegExp('const ' + name + ' = `([^`]+)`'))?.[1]
  assert.ok(result)
  return result
}
const designer = persona('SCENARIO_DESIGNER_PERSONA')
const reviewer = persona('SCENARIO_COVERAGE_REVIEWER_PERSONA')
const require = createRequire(await realpath(join(isolated.profile, 'node_modules/@deepseek-ai/dsh/package.json')))
const yaml = require('js-yaml')
const settings = yaml.load(await readFile(join(isolated.home, 'settings.yaml'), 'utf8'))
const selection = settings['agent-default-model']
assert.equal(selection.model, 'gpt-6.1-sol')
assert.equal(selection.provider, 'pockapi')
const provider = settings['llm-pi-ai'].providers.pockapi
assert.equal(provider.baseURL.replace(/\/$/u, ''), 'http://47.253.229.128:18080/v1')
const credential = yaml.load(await readFile(join(isolated.home, '.credentials.yaml'), 'utf8'))[provider.apiKeyEnv]
await mkdir(destination)
let modelRequests = 0
const invoke = async (prefix, system, prompt) => {
  const request = { model: selection.model, messages: [{ role: 'system', content: system }, { role: 'user', content: prompt }], max_tokens: 24_576,
    ...(selection.reasoningEffort === undefined ? {} : { reasoning_effort: selection.reasoningEffort }), stream: true, stream_options: { include_usage: true } }
  await writeFile(join(destination, `${prefix}.request.json`), JSON.stringify({ requestDigest: digestObject(request), request }, null, 2), { flag: 'wx' })
  modelRequests++
  const response = await fetch(`${provider.baseURL.replace(/\/$/u, '')}/chat/completions`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${credential}` }, body: JSON.stringify(request), signal: AbortSignal.timeout(10 * 60_000) })
  assert.ok(response.ok, `HTTP ${response.status}`)
  assert.ok(response.headers.get('content-type')?.includes('text/event-stream'))
  const log = await open(join(destination, `${prefix}.response.txt`), 'wx', 0o600)
  const decoder = new TextDecoder()
  let pending = '', content = '', usage, responseId, terminal = false, finishReason
  const inspect = line => {
    if (!line.startsWith('data:')) return
    const payload = line.slice(5).trim()
    if (payload === '[DONE]') { terminal = true; return }
    const event = JSON.parse(payload)
    assert.ok(!event.error, 'Upstream stream error')
    responseId ??= event.id
    usage = event.usage ?? usage
    for (const choice of event.choices ?? []) {
      if (typeof choice.delta?.content === 'string') content += choice.delta.content
      finishReason = choice.finish_reason ?? finishReason
    }
  }
  try {
    for await (const chunk of response.body) {
      await log.write(chunk)
      pending += decoder.decode(chunk, { stream: true })
      const lines = pending.split('\n')
      pending = lines.pop()
      for (const line of lines) inspect(line)
    }
    pending += decoder.decode()
    if (pending.trim()) inspect(pending)
    assert.ok(terminal && finishReason === 'stop' && content.trim(), `Incomplete stream: ${finishReason}`)
  } finally { await log.close() }
  return { text: content, usage, responseId }
}
const ids = process.argv[4]?.split(',') ?? ['planning-v3:bb3540ee-dca7-4878-8e70-129fd8c2e4a4', 'planning-v3:6bd07991-ebb1-45e1-8a4c-e3049db4da62']
assert.ok(ids.length >= 1 && ids.length <= 2)
const queue = ids.flatMap((operationId, index) => ['original', 'fixed'].map(kind => ({ operationId, caseName: diagnosticRule === 'type-oracle-presence' ? `presence-${index + 1}` : diagnosticRule === 'branch-fixture' ? `branch-${index + 1}` : diagnosticRule === 'compiler-config' ? `compiler-${index + 1}` : diagnosticRule === 'fixture-lifecycle' ? `fixture-${index + 1}` : index === 0 ? 'trim' : 'overlap', kind })))
const selected = process.argv[3]?.split(',')
if (selected !== undefined) {
  assert.ok(selected.length && new Set(selected).size === selected.length && selected.every(key => queue.some(j => `${j.caseName}-${j.kind}` === key)))
  for (let i = queue.length - 1; i >= 0; i--) if (!selected.includes(`${queue[i].caseName}-${queue[i].kind}`)) queue.splice(i, 1)
}
const requiredFixedApprovals = queue.filter(j => j.kind === 'fixed').length
const reports = []
await Promise.all(Array.from({ length: 2 }, async () => {
  while (queue.length) {
    const job = queue.shift()
    const prefix = `${job.caseName}-${job.kind}`
    const report = { ...job, startedAt: new Date().toISOString() }
    try {
      const operation = snapshot.planningOperations.find(o => o.id === job.operationId)
      assert.ok((diagnosticRule === 'command-catalog' ? ['blocked', 'failed'] : ['blocked']).includes(operation.status))
      assert.ok(['scenario_completion', 'scenario_coverage_review', ...(diagnosticRule === 'command-catalog' ? ['plan_review', 'task_plan'] : [])].includes(operation.stage))
      const retainedReview = snapshot.scenarioCoverageReviews.find(r => r.id === operation.scenarioCoverageReviewId)
      let sourceContext = retainedReview?.sourceContext
      let repositoryEvidence = retainedReview?.repositoryEvidence
      if (retainedReview === undefined) {
        // Completion can block before a review exists. Reconstruct its exact
        // input from the retained source/analysis/reference manifest and frozen
        // repository, using the still-installed original evidence loader.
        assert.equal(operation.stage, 'scenario_completion')
        const manifest = snapshot.requirementSourceManifests.find(m => m.id === operation.sourceManifestId)
        const analysis = snapshot.requirementAnalysisProposals.find(p => p.id === operation.requirementAnalysisProposalId)?.analysis
        assert.ok(manifest && analysis && analysis.decisions.length === 0)
        assert.deepEqual(operation.decisionPlanningEffectIds, [])
        sourceContext = { manifest, analysis, resolvedDecisions: [] }
        const repository = snapshot.repositorySnapshotsV3.find(r => r.id === operation.evaluationInput.repositorySnapshotId)
        const references = snapshot.planningPromptReferenceManifests.filter(m => m.operationId === operation.id)
        assert.equal(references.length, 1)
        const { BindingStage: OriginalBindingStage } = await import(pathToFileURL(installedPath).href)
        const focus = manifest.anchors.map(a => a.text).join('\n')
        const contents = await new OriginalBindingStage({}).loadFrozenEvidence(repository, references[0], focus)
        assert.deepEqual(await new BindingStage({}).loadFrozenEvidence(repository, references[0], focus), contents)
        repositoryEvidence = { repositoryDigest: repository.repositoryDigest, verificationCommands: repository.verifiedCommands, ...(repository.verificationTools === undefined ? {} : { verificationTools: repository.verificationTools }), contents }
      }
      assert.ok(sourceContext && repositoryEvidence)
      const policies = snapshot.acceptanceScenarioCoveragePolicies.filter(p => operation.acceptanceScenarioCoveragePolicyIds.includes(p.id))
      // A Scenario rejection precedes requirement publication. Derive the exact
      // service-owned IDs from the retained frozen analysis, not live rows.
      const keyById = new Map(sourceContext.analysis.requirements.flatMap(r => r.acceptanceCriteria.map(a => [`${operation.projectId}:requirements:${operation.id}:acceptance:${a.key}`, a.key])))
      for (const p of policies) assert.ok(keyById.has(p.acceptanceCriterionId))
      const policyMap = Object.fromEntries(policies.map(p => [keyById.get(p.acceptanceCriterionId), p.categories.filter(c => c.applicability === 'required').map(c => ({ category: c.category, sourceAnchorIds: c.sourceAnchorIds }))]))
      const decisions = new Map(sourceContext.resolvedDecisions.map(d => [d.key, { ...d, options: [d.selectedOption] }]))
      const args = [sourceContext.analysis, policyMap, sourceContext.manifest, decisions, false]
      const originalPrompt = originalService.scenarioCompletionPromptV3(...args)
      const fixedPrompt = currentService.scenarioCompletionPromptV3(...args)
      if (diagnosticRule === 'command-catalog') assert.equal(originalPrompt, fixedPrompt)
      else assert.notEqual(originalPrompt, fixedPrompt)
      const withoutOracleRule = prompt => prompt.replace(['fault-connection', 'tool-evidence'].includes(diagnosticRule)
        ? /Fault injection connection grounding:[\s\S]*?(?=Async fixture reachability grounding:)/u
        : diagnosticRule === 'callable-fixture'
        ? /Callable fixture grounding:[\s\S]*?(?=Async fixture reachability grounding:)/u
        : diagnosticRule === 'async-fixture'
        ? /Async fixture reachability grounding:[\s\S]*?(?=bindingStageIdentifierCompatibilityRequired=)/u
        : diagnosticRule === 'type-oracle-presence'
        ? / Type oracle discrimination:[\s\S]*?(?= Fixture lifecycle grounding:)/u
        : diagnosticRule === 'branch-fixture'
        ? / Branch fixture grounding:[\s\S]*?(?= Every Scenario requires)/u
        : diagnosticRule === 'compiler-config'
        ? / Compiler configuration grounding:[\s\S]*?(?= Every Scenario requires)/u
        : diagnosticRule === 'fixture-lifecycle'
        ? / Fixture lifecycle grounding:[\s\S]*?(?= Every Scenario requires)/u
        : / Compile-time oracle grounding:[\s\S]*?(?= Every Scenario requires)/u, '')
      assert.equal(withoutOracleRule(fixedPrompt), withoutOracleRule(originalPrompt))
      const evidencePrompt = originalService.scenarioRepositoryEvidencePromptV3(repositoryEvidence)
      let generationEvidencePrompt = evidencePrompt
      if (diagnosticRule === 'tool-evidence') {
        const project = snapshot.projects.find(p => p.id === operation.projectId)
        const manifest = JSON.parse(await readFile(join(project.cwd, 'package.json'), 'utf8'))
        const verificationTools = await captureVerificationToolEvidenceV3(project.cwd, manifest)
        assert.ok(verificationTools.some(p => p.packageName === 'nz' && p.files.some(f => f.path === 'source/runner.js')))
        if (job.kind === 'fixed') repositoryEvidence = { ...repositoryEvidence, verificationTools }
        generationEvidencePrompt = originalService.scenarioRepositoryEvidencePromptV3(repositoryEvidence)
      } else if (diagnosticRule === 'command-catalog') {
        const repository = snapshot.repositorySnapshotsV3.find(r => r.id === operation.repositorySnapshotId)
        assert.ok(repository)
        generationEvidencePrompt = job.kind === 'fixed' ? currentService.scenarioRepositoryEvidencePromptV3({ ...repositoryEvidence, verificationCommands: repository.verifiedCommands }) : evidencePrompt
      } else if (diagnosticRule !== 'fault-connection') assert.equal(currentService.scenarioRepositoryEvidencePromptV3(repositoryEvidence), evidencePrompt)
      const generated = await invoke(`${prefix}-generation`, designer, `${job.kind === 'fixed' && diagnosticRule !== 'tool-evidence' ? fixedPrompt : originalPrompt}\n\n${generationEvidencePrompt}`)
      const validation = {
        requirements: sourceContext.analysis.requirements.map(r => ({ key: r.key, acceptanceKeys: r.acceptanceCriteria.map(a => a.key) })),
        requiredCategoriesByAcceptance: Object.fromEntries(Object.entries(policyMap).map(([key, values]) => [key, values.map(p => p.category)])),
        requiredSourceRefsByAcceptanceCategory: Object.fromEntries(Object.entries(policyMap).map(([key, values]) => [key, Object.fromEntries(values.map(p => [p.category, p.sourceAnchorIds]))])),
        allowedSourceRefs: sourceContext.manifest.anchors.map(a => a.id),
      }
      const scenarios = parseGeneratedScenarioCompletionV3(generated.text, validation)
      report.generation = { status: scenarios.status, usage: generated.usage, responseId: generated.responseId, scenarios }
      if (diagnosticRule === 'tool-evidence' && job.kind === 'original' && scenarios.status === 'blocked') {
        report.status = 'missing_tool_evidence_rejected'
        report.completedAt = new Date().toISOString()
        await writeFile(join(destination, `${prefix}.report.json`), JSON.stringify(report, null, 2), { flag: 'wx' })
        reports.push(report)
        continue
      }
      assert.equal(scenarios.status, 'ready')
      const scenarioRecords = scenarios.scenarios.map(scenario => {
        const core = { ...scenario, projectId: operation.projectId, operationId: operation.id,
          requirementId: `${operation.projectId}:requirements:${operation.id}:requirement:${scenario.requirementKey}`,
          acceptanceCriterionId: `${operation.projectId}:requirements:${operation.id}:acceptance:${scenario.acceptanceKey}`, derivationPhase: 'completion' }
        return { id: `scenario:${operation.id}:${scenario.key}`, ...core, scenarioDigest: digestObject(core), createdAt: report.startedAt }
      })
      const risk = snapshot.planningRiskProfiles.find(r => r.id === operation.planningRiskProfileId)
      const inputDigest = digestObject({ risk, policies, scenarios: scenarioRecords, sourceContext, repositoryEvidence })
      const reviewEvidencePrompt = diagnosticRule === 'tool-evidence' ? generationEvidencePrompt : evidencePrompt
      const reviewPrompt = `${originalService.scenarioCoverageReviewPromptV3(risk, policies, scenarioRecords, inputDigest, sourceContext)}\n\n${reviewEvidencePrompt}`
      assert.equal(reviewPrompt, `${currentService.scenarioCoverageReviewPromptV3(risk, policies, scenarioRecords, inputDigest, sourceContext)}\n\n${reviewEvidencePrompt}`)
      const reviewed = await invoke(`${prefix}-review`, reviewer, reviewPrompt)
      report.review = { ...parseGeneratedScenarioCoverageReviewV3(reviewed.text, inputDigest), usage: reviewed.usage, responseId: reviewed.responseId }
      report.status = 'generation_and_unchanged_review_completed'
    } catch (error) { report.status = 'diagnostic_failed'; report.error = error.message; report.errorCause = error.cause?.code ?? error.cause?.message }
    report.completedAt = new Date().toISOString()
    await writeFile(join(destination, `${prefix}.report.json`), JSON.stringify(report, null, 2), { flag: 'wx' })
    reports.push(report)
    console.log(JSON.stringify({ ...job, status: report.status, reviewStatus: report.review?.status, findings: report.review?.findings, error: report.error }))
  }
}))
const fixedApproved = reports.filter(r => r.kind === 'fixed' && r.review?.status === 'approved' && r.review.findings.length === 0).length
await writeFile(join(destination, 'summary.json'), JSON.stringify({ scope: `${diagnosticRule.replaceAll('-', '_')}_prompt_diagnostic_not_release`, modelRequests, requiredFixedApprovals, fixedApproved, originalVerdictsUnchanged: true, reviewerUnchanged: true, sourceEvidenceUnchanged: diagnosticRule !== 'tool-evidence', ...(diagnosticRule === 'command-catalog' ? { generationCommandCatalogSupplied: true, reviewerRetainsOriginalSourceEvidence: true } : {}), domainMutations: 0, reports }, null, 2), { flag: 'wx' })
if (fixedApproved !== requiredFixedApprovals || reports.some(r => r.status === 'diagnostic_failed')) process.exitCode = 1
