import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { mkdir, open, readFile, realpath, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { OrchestratorService, digestObject, mapRepositoryOwnerSymbolsV3, parseGeneratedPlanV3 } from '../lib/index.js'

// Diagnostic only: use the retained frozen inputs and the complete real parser.
// No retries of domain work, candidate exports, approvals, or task dispatch.
const [operationId, sessionPath, destination, revisedScenarioPath] = process.argv.slice(2)
assert.ok(operationId && sessionPath && destination)
const snapshot = await (await fetch('http://127.0.0.1:3087/project-orchestrator/api/snapshot')).json()
const operation = snapshot.planningOperations.find(o => o.id === operationId)
assert.equal(operation.stage, 'task_plan')
assert.equal(operation.status, 'failed')
assert.ok(operation.diagnostics.some(d => d.code === 'plan-reference-invalid'))
const events = execFileSync('zstd', ['-dc', sessionPath], { encoding: 'utf8', maxBuffer: 10_000_000 }).trim().split('\n').map(JSON.parse)
const actualPrompt = events.filter(e => e.type === 'user/message').flatMap(e => e.data.content).find(c => c.text?.includes('Return exactly one Delivery Plan V3')).text
const section = (start, end) => JSON.parse(actualPrompt.split(start)[1].split(end)[0])
const analysis = { ...snapshot.requirementAnalysisProposals.find(p => p.id === operation.requirementAnalysisProposalId).analysis,
  requirements: [...section('\n\nRequirements and Acceptance:\n', '\n\nResolved Decisions:'), ...section('Frozen scope dispositions and invocation constraints:\n', '\n\nPreserve excluded')] }
let scenarios = section('\n\nScenarios:\n', '\n\nBindings:')
const bindings = { status: 'ready', diagnostics: [], bindings: section('\n\nBindings:\n', '\n\nPolicy refs:') }
const policyRefs = section('\n\nPolicy refs:\n', '\n\nEvidence claim refs:')
const constraints = policyRefs.map(r => snapshot.policyConstraintsV3.find(c => c.id === r.constraintId))
assert.ok(constraints.every(Boolean))
const manifest = snapshot.planningPromptReferenceManifests.find(m => m.id === operation.promptReferenceManifestId)
const decisions = new Map(section('\n\nResolved Decisions:\n', '\n\nScenarios:').map(d => [d.key, d]))
const repository = snapshot.repositorySnapshotsV3.find(r => r.id === operation.repositorySnapshotId)
const project = snapshot.projects.find(p => p.id === operation.projectId)
const isolated = JSON.parse(await readFile('output/acceptance/isolated-harness-2026-10-14.json', 'utf8'))
const installedPath = await realpath(join(isolated.profile, 'node_modules/dsh-project-orchestrator/lib/index.js'))
const { OrchestratorService: OriginalService } = await import(pathToFileURL(installedPath).href)
const args = [{ taskLanguage: project.taskLanguage }, analysis, scenarios, bindings, constraints, manifest, decisions, false]
const originalBase = Object.create(OriginalService.prototype).plannerPromptV3(...args)
assert.ok(actualPrompt.includes(originalBase), 'Retained inputs must reconstruct the exact original planner body before any model call.')
let revisedScenarioEvidence
if (revisedScenarioPath !== undefined) {
  revisedScenarioEvidence = JSON.parse(await readFile(revisedScenarioPath, 'utf8'))
  assert.equal(revisedScenarioEvidence.operationId, operationId)
  assert.equal(revisedScenarioEvidence.kind, 'fixed')
  assert.equal(revisedScenarioEvidence.review.status, 'approved')
  assert.deepEqual(revisedScenarioEvidence.review.findings, [])
  assert.equal(revisedScenarioEvidence.generation.scenarios.status, 'ready')
  scenarios = revisedScenarioEvidence.generation.scenarios.scenarios
  args[2] = scenarios
}
const fixedBase = Object.create(OrchestratorService.prototype).plannerPromptV3(...args)
assert.notEqual(originalBase, fixedBase)
const prompt = actualPrompt.replace(originalBase, fixedBase)
const boundRecords = snapshot.requirementCodeBindings.filter(b => b.operationId === operationId)
const validation = {
  requirementKeys: analysis.requirements.filter(r => r.scope === 'in_scope').map(r => r.key),
  acceptanceKeys: analysis.requirements.flatMap(r => r.acceptanceCriteria.map(a => a.key)),
  requiredAcceptanceKeys: analysis.requirements.flatMap(r => r.acceptanceCriteria.filter(a => a.required).map(a => a.key)),
  scenarioKeys: scenarios.map(s => s.key), requiredScenarioKeys: scenarios.filter(s => s.required).map(s => s.key),
  uiScenarioKeys: scenarios.filter(s => s.required && s.observableAt.some(o => o.kind === 'ui')).map(s => s.key),
  decisionKeys: analysis.decisions.map(d => d.key), resolvedDecisionKeys: [...decisions.keys()],
  bindingKeys: bindings.bindings.map(b => b.key), bindingScopes: Object.fromEntries(bindings.bindings.map(b => [b.key, b.allowedPathScopes])),
  bindingOwnerPathsBySymbol: await mapRepositoryOwnerSymbolsV3(repository.canonicalRoot, boundRecords.map(b => ({ key: b.key, evidencePaths: b.evidenceIds, ownerSymbols: b.ownerSymbols }))),
  stageIdentifierCompatibilityRequired: false, promptReferenceManifest: manifest,
  requiredPolicyRefs: policyRefs.map(r => r.ref), requiredPolicyStatementsByRef: Object.fromEntries(policyRefs.map(r => [r.ref, r.statement])),
  requiredPolicySubjectsByRef: Object.fromEntries(policyRefs.map(r => { const c = constraints.find(c => c.id === r.constraintId); return [r.ref, {
    requirementKeys: analysis.requirements.filter(req => c.mappedRequirementIds.some(id => id.endsWith(`:requirement:${req.key}`))).map(req => req.key),
    scenarioKeys: scenarios.filter(s => c.mappedScenarioIds.some(id => id.endsWith(`:${s.key}`))).map(s => s.key),
  }] })),
}
const require = createRequire(await realpath(join(isolated.profile, 'node_modules/@deepseek-ai/dsh/package.json')))
const yaml = require('js-yaml')
const settings = yaml.load(await readFile(join(isolated.home, 'settings.yaml'), 'utf8'))
const selection = settings['agent-default-model']
assert.equal(selection.provider, 'pockapi')
assert.equal(selection.model, 'gpt-6.1-sol')
const provider = settings['llm-pi-ai'].providers.pockapi
assert.equal(provider.baseURL.replace(/\/$/u, ''), 'http://47.253.229.128:18080/v1')
const credential = yaml.load(await readFile(join(isolated.home, '.credentials.yaml'), 'utf8'))[provider.apiKeyEnv]
const persona = (await readFile('src/service.ts', 'utf8')).match(/const PLANNER_V3_PERSONA = `([^`]+)`/u)[1]
const request = { model: selection.model, messages: [{ role: 'system', content: persona }, { role: 'user', content: prompt }], max_tokens: 24_576,
  reasoning_effort: selection.reasoningEffort ?? 'xhigh', stream: true, stream_options: { include_usage: true } }
await mkdir(destination)
await writeFile(join(destination, 'request.json'), JSON.stringify({ requestDigest: digestObject(request), request }, null, 2), { flag: 'wx' })
const report = { sourceOperationId: operationId, startedAt: new Date().toISOString(), modelRequests: 1, domainMutations: 0,
  scope: 'task_reference_diagnostic_not_release', originalPromptReplayed: true, originalVerdictUnchanged: true,
  ...(revisedScenarioPath === undefined ? {} : { revisedScenarioPath, revisedScenarioReportDigest: digestObject(revisedScenarioEvidence), revisedScenariosAreDiagnosticOnly: true }) }
try {
  const response = await fetch(`${provider.baseURL.replace(/\/$/u, '')}/chat/completions`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${credential}` }, body: JSON.stringify(request), signal: AbortSignal.timeout(600_000) })
  assert.ok(response.ok, `HTTP ${response.status}`)
  const file = await open(join(destination, 'response.txt'), 'wx', 0o600)
  const decoder = new TextDecoder()
  let pending = '', content = '', terminal = false, finish
  const inspect = line => {
    if (!line.startsWith('data:')) return
    const payload = line.slice(5).trim()
    if (payload === '[DONE]') { terminal = true; return }
    const event = JSON.parse(payload)
    assert.ok(!event.error)
    report.usage = event.usage ?? report.usage
    for (const choice of event.choices ?? []) { content += choice.delta?.content ?? ''; finish = choice.finish_reason ?? finish }
  }
  try {
    for await (const chunk of response.body) { await file.write(chunk); pending += decoder.decode(chunk, { stream: true }); const lines = pending.split('\n'); pending = lines.pop(); for (const line of lines) inspect(line) }
    pending += decoder.decode(); if (pending.trim()) inspect(pending)
    assert.ok(terminal && finish === 'stop' && content.trim())
  } finally { await file.close() }
  report.plan = parseGeneratedPlanV3(content, validation)
  assert.equal(report.plan.status, 'ready')
  const negative = structuredClone(report.plan)
  negative.tasks[0].contextPack.currentBehaviorClaimRefs = ['ref-repo-f00011']
  assert.throws(() => parseGeneratedPlanV3(JSON.stringify(negative), validation), e => e.code === 'plan-reference-invalid')
  report.corruptReferenceRejected = true
  report.status = 'ready_parser_passed_negative_rejected'
} catch (error) { report.status = 'failed'; report.error = error.message; process.exitCode = 1 }
report.completedAt = new Date().toISOString()
await writeFile(join(destination, 'summary.json'), JSON.stringify(report, null, 2), { flag: 'wx' })
console.log(JSON.stringify({ status: report.status, error: report.error, corruptReferenceRejected: report.corruptReferenceRejected }))
