import assert from 'node:assert/strict'
import { mkdir, open, readFile, realpath, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import { digestObject, OrchestratorService, parseGeneratedScenarioCoverageReviewV3 } from '../lib/index.js'

// Replay retained scenarios with repaired source evidence, without changing the
// original verdict, reviewer instructions, domain records, or release ledger.
const [proofPath, destination] = process.argv.slice(2)
assert.ok(proofPath && destination)
const proof = JSON.parse(await readFile(proofPath, 'utf8'))
assert.ok(proof.checks.every(c => c.after))
const snapshot = await (await fetch('http://127.0.0.1:3087/project-orchestrator/api/snapshot')).json()
const operation = snapshot.planningOperations.find(o => o.id === proof.operationId)
const retained = snapshot.scenarioCoverageReviews.find(r => r.id === operation.scenarioCoverageReviewId)
assert.equal(retained.status, 'changes_requested')
assert.equal(digestObject(retained.repositoryEvidence.contents), proof.before.digest)
const repositoryEvidence = { ...retained.repositoryEvidence, contents: proof.after.contents }
const scenarios = snapshot.acceptanceScenarios.filter(s => operation.acceptanceScenarioIds.includes(s.id))
assert.equal(scenarios.length, operation.acceptanceScenarioIds.length)
const risk = snapshot.planningRiskProfiles.find(r => r.id === operation.planningRiskProfileId)
const policies = snapshot.acceptanceScenarioCoveragePolicies.filter(p => operation.acceptanceScenarioCoveragePolicyIds.includes(p.id))
const service = Object.create(OrchestratorService.prototype)
const inputDigest = digestObject({ risk, policies, scenarios, sourceContext: retained.sourceContext, repositoryEvidence })
const prompt = `${service.scenarioCoverageReviewPromptV3(risk, policies, scenarios, inputDigest, retained.sourceContext)}\n\n${service.scenarioRepositoryEvidencePromptV3(repositoryEvidence)}`
const source = await readFile('src/service.ts', 'utf8')
const system = source.match(/const SCENARIO_COVERAGE_REVIEWER_PERSONA = `([^`]+)`/u)?.[1]
assert.ok(system)
const isolated = JSON.parse(await readFile('output/acceptance/isolated-harness-2026-10-14.json', 'utf8'))
const require = createRequire(await realpath(join(isolated.profile, 'node_modules/@deepseek-ai/dsh/package.json')))
const yaml = require('js-yaml')
const settings = yaml.load(await readFile(join(isolated.home, 'settings.yaml'), 'utf8'))
const selection = settings['agent-default-model']
assert.equal(selection.model, 'gpt-6.1-sol')
assert.equal(selection.provider, 'pockapi')
const provider = settings['llm-pi-ai'].providers.pockapi
assert.equal(provider.baseURL.replace(/\/$/u, ''), 'http://47.253.229.128:18080/v1')
const credential = yaml.load(await readFile(join(isolated.home, '.credentials.yaml'), 'utf8'))[provider.apiKeyEnv]
const request = { model: selection.model, messages: [{ role: 'system', content: system }, { role: 'user', content: prompt }],
  max_tokens: 24_576, reasoning_effort: selection.reasoningEffort, stream: true, stream_options: { include_usage: true } }
await mkdir(destination)
await writeFile(join(destination, 'request.json'), JSON.stringify({ requestDigest: digestObject(request), request }, null, 2), { flag: 'wx' })
const response = await fetch(`${provider.baseURL.replace(/\/$/u, '')}/chat/completions`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${credential}` }, body: JSON.stringify(request), signal: AbortSignal.timeout(10 * 60_000) })
assert.ok(response.ok, `HTTP ${response.status}`)
assert.ok(response.headers.get('content-type')?.includes('text/event-stream'))
const log = await open(join(destination, 'response.txt'), 'wx', 0o600)
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
    content += choice.delta?.content ?? ''
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
const review = parseGeneratedScenarioCoverageReviewV3(content, inputDigest)
const report = { scope: 'type_projection_source_diagnostic_not_release', observedAt: new Date().toISOString(), operationId: operation.id,
  originalStatus: retained.status, originalFindings: retained.findings, originalVerdictUnchanged: true, reviewerInstructionsUnchanged: true,
  scenariosUnchanged: true, sourceDigestsUnchanged: true, evidenceBefore: proof.before.digest, evidenceAfter: proof.after.digest,
  modelRequests: 1, domainMutations: 0, review, usage, responseId }
await writeFile(join(destination, 'summary.json'), JSON.stringify(report, null, 2), { flag: 'wx' })
console.log(JSON.stringify(report))
assert.equal(review.status, 'approved')
assert.deepEqual(review.findings, [])
