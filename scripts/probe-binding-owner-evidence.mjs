import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { mkdir, open, readFile, realpath, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { buildBindingPromptV3, digestObject, parseGeneratedBindingAnalysisV3 } from '../lib/index.js'

// Diagnostic comparison only. Keep original verdict and all three requests.
const [beforePath, afterPath, destination, negativePath = 'source/core/Ky.ts'] = process.argv.slice(2)
const before = JSON.parse(await readFile(beforePath, 'utf8'))
const after = JSON.parse(await readFile(afterPath, 'utf8'))
assert.equal(before.replayMatchesActualPrompt, true)
assert.equal(before.operationId, after.operationId)
assert.ok((after.declarationChecks ?? after.checks).every(c => c.complete))
const isolated = JSON.parse(await readFile('output/acceptance/isolated-harness-2026-10-14.json', 'utf8'))
const require = createRequire(await realpath(join(isolated.profile, 'node_modules/@deepseek-ai/dsh/package.json')))
const yaml = require('js-yaml')
const settings = yaml.load(await readFile(join(isolated.home, 'settings.yaml'), 'utf8'))
const selection = settings['agent-default-model']
assert.equal(selection.provider, 'pockapi')
assert.equal(selection.model, 'gpt-6.1-sol')
const provider = settings['llm-pi-ai'].providers.pockapi
assert.equal(provider.baseURL.replace(/\/$/u, ''), 'http://47.253.229.128:18080/v1')
const credential = yaml.load(await readFile(join(isolated.home, '.credentials.yaml'), 'utf8'))[provider.apiKeyEnv]
const persona = (await readFile('src/service.ts', 'utf8')).match(/const CODE_BINDING_PERSONA = `([^`]+)`/u)[1]
const delimiter = '\n\nAllowed evidence refs:\n'
const originalRefs = JSON.parse(before.actualPrompt.split(delimiter)[1])
const fixedRefs = (after.references?.map(r => ({ ref: r.ref, path: r.artifactId, digest: r.artifactDigest })) ?? originalRefs).map(r => { const e = after.evidence.find(e => e.ref === r.ref); return e === undefined ? r : { ...r, content: e.content, truncated: e.truncated } })
assert.ok(fixedRefs.some(r => r.path === negativePath))
const negativeRefs = fixedRefs.map(r => r.path === negativePath ? { ...r, content: '', truncated: true } : r)
const requirements = JSON.parse(before.actualPrompt.split('\n\nFrozen requirements:\n')[1].split('\n\nFrozen scenarios')[0])
const scenarios = JSON.parse(before.actualPrompt.split('\n\nFrozen scenarios (local keys only):\n')[1].split(/\n\n(?:Requested file inventory facts|Repository identity)/u)[0])
const dispositions = JSON.parse(before.actualPrompt.split('Frozen scope dispositions and invocation constraints:\n')[1].split('\n\nPreserve excluded')[0])
const snapshot = await (await fetch('http://127.0.0.1:3087/project-orchestrator/api/snapshot')).json()
const operation = snapshot.planningOperations.find(o => o.id === before.operationId)
const repository = snapshot.repositorySnapshotsV3.find(r => r.id === operation.repositorySnapshotId)
assert.ok(repository)
const manifest = { references: fixedRefs.map(r => ({ ref: r.ref, kind: 'repository_evidence', artifactId: r.path, artifactDigest: r.digest })) }
const currentPrompt = refs => buildBindingPromptV3({ requirements: [...requirements, ...dispositions] }, scenarios, repository, manifest, false, refs)
const validation = { requireCapabilitySurfaces: true, requirementKeys: requirements.map(r => r.key), acceptanceKeys: requirements.flatMap(r => r.acceptanceCriteria.map(a => a.key)), scenarioKeys: scenarios.map(s => s.key), allowedEvidenceRefs: originalRefs.map(r => r.ref), eventScenarios: scenarios.filter(s => s.observableAt.some(o => o.kind === 'event')).map(s => ({ key: s.key, requirementKey: s.requirementKey, eventObservables: s.eventObservables ?? [] })) }
await mkdir(destination)
const kinds = process.env.PO_BINDING_PROBE_KINDS?.split(',') ?? ['original', 'fixed', 'negative']
assert.equal(new Set(kinds).size, kinds.length)
assert.ok(kinds.includes('fixed') && kinds.includes('negative') && kinds.every(kind => ['original', 'fixed', 'negative'].includes(kind)))
const reports = await Promise.all(kinds.map(async kind => {
  const request = { model: selection.model, messages: [{ role: 'system', content: persona }, { role: 'user', content: kind === 'original' ? before.actualPrompt : currentPrompt(kind === 'fixed' ? fixedRefs : negativeRefs) }], max_tokens: 16_384, reasoning_effort: selection.reasoningEffort ?? 'xhigh', stream: true, stream_options: { include_usage: true } }
  const report = { kind, startedAt: new Date().toISOString(), requestDigest: digestObject(request) }
  await writeFile(join(destination, `${kind}.request.json`), JSON.stringify({ ...report, request }, null, 2), { flag: 'wx' })
  try {
    const response = await fetch(`${provider.baseURL.replace(/\/$/u, '')}/chat/completions`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${credential}` }, body: JSON.stringify(request), signal: AbortSignal.timeout(600_000) })
    assert.ok(response.ok, `HTTP ${response.status}`)
    const file = await open(join(destination, `${kind}.response.txt`), 'wx', 0o600)
    const decoder = new TextDecoder()
    let pending = '', content = '', terminal = false, finish
    const inspect = line => {
      if (!line.startsWith('data:')) return
      const payload = line.slice(5).trim()
      if (payload === '[DONE]') { terminal = true; return }
      const event = JSON.parse(payload)
      assert.ok(!event.error)
      report.usage = event.usage ?? report.usage
      report.responseId ??= event.id
      for (const choice of event.choices ?? []) { content += choice.delta?.content ?? ''; finish = choice.finish_reason ?? finish }
    }
    try {
      for await (const chunk of response.body) { await file.write(chunk); pending += decoder.decode(chunk, { stream: true }); const lines = pending.split('\n'); pending = lines.pop(); for (const line of lines) inspect(line) }
      pending += decoder.decode(); if (pending.trim()) inspect(pending)
      assert.ok(terminal && finish === 'stop' && content.trim(), `Incomplete stream: ${finish}`)
    } finally { await file.close() }
    report.binding = parseGeneratedBindingAnalysisV3(content, { ...validation, allowedEvidenceRefs: (kind === 'original' ? originalRefs : fixedRefs).map(r => r.ref) })
    report.status = 'completed'
  } catch (error) { report.status = 'failed'; report.error = error.message }
  report.completedAt = new Date().toISOString()
  await writeFile(join(destination, `${kind}.report.json`), JSON.stringify(report, null, 2), { flag: 'wx' })
  console.log(JSON.stringify({ kind, status: report.status, bindingStatus: report.binding?.status, diagnostics: report.binding?.diagnostics.map(d => d.code), error: report.error }))
  return report
}))
const result = { observedAt: new Date().toISOString(), scope: 'diagnostic_only_not_release_qualification', sourceOperationId: before.operationId, bundleSha256: after.bundleSha256, modelRequests: reports.length, domainMutations: 0, originalVerdictUnchanged: true, reports }
await writeFile(join(destination, 'summary.json'), JSON.stringify(result, null, 2), { flag: 'wx' })
if (reports.some(r => r.status !== 'completed') || reports.find(r => r.kind === 'fixed').binding?.status !== 'ready' || reports.find(r => r.kind === 'negative').binding?.status !== 'blocked') process.exitCode = 1
