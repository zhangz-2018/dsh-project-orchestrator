import assert from 'node:assert/strict'
import { mkdir, readFile, realpath, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import { BindingStage, buildTaskPreflightPromptV3, digestObject } from '../lib/index.js'

// Read-only prompt diagnostic. Never change or retry the original operation,
// count these calls as release candidates, attest capabilities, or dispatch.
const destination = process.argv[2]
assert.ok(destination)
const response = await fetch('http://127.0.0.1:3087/project-orchestrator/api/snapshot')
assert.ok(response.ok)
const snapshot = await response.json()
const operation = snapshot.planningOperations.find(o => o.id === 'planning-v3:666068a8-1875-4a79-b037-83a2583eddc6')
assert.equal(operation.status, 'blocked')
assert.equal(operation.stage, 'task_preflight')
const proposal = snapshot.planningProposalPacks.find(p => p.operationId === operation.id)
const task = proposal.plan.tasks.find(t => t.key === 'TASK-IMPLEMENT')
const assignment = snapshot.assignmentDrafts.find(a => a.operationId === operation.id && a.taskKey === task.key)
const manifest = snapshot.planningPromptReferenceManifests.find(m => m.id === proposal.promptReferenceManifestId)
const repository = snapshot.repositorySnapshotsV3.find(r => r.id === operation.repositorySnapshotId)
const retrieval = snapshot.repositoryEvidenceRetrievalReports.find(r => r.id === operation.repositoryEvidenceRetrievalReportId)
const sourceManifest = snapshot.requirementSourceManifests.find(m => m.id === operation.sourceManifestId)
const stage = new BindingStage({})
const sourceEvidence = await stage.loadFrozenEvidence(repository, { projectId: operation.projectId, operationId: operation.id, references: stage.repositoryReferences(repository, retrieval) }, sourceManifest.anchors.map(a => a.text).join('\n'))
const policy = snapshot.planningPolicySnapshots.find(p => p.id === operation.policySnapshotId)
const accessSnapshot = snapshot.projectAccessGrantSnapshots.find(p => p.operationId === operation.id)
const input = { bindings: snapshot.requirementCodeBindings.filter(b => b.operationId === operation.id),
  constraints: snapshot.policyConstraintsV3.filter(c => policy.constraintIds.includes(c.id)), accessSnapshot,
  accessGrants: snapshot.resourceAccessGrants.filter(g => accessSnapshot.grantIds.includes(g.id) && g.principalId === assignment.executingAgentId),
  repositoryDigest: repository.repositoryDigest, sourceEvidence }
const fixedPrompt = buildTaskPreflightPromptV3(task, assignment, manifest, input)
assert.ok(fixedPrompt.includes('Regression-work semantics:'))
const originalPrompt = fixedPrompt.replace(/\n\nRegression-work semantics:[\s\S]*?(?=\n\nSkill semantics:)/u, '')
assert.notEqual(originalPrompt, fixedPrompt)
const forbiddenTask = structuredClone(task)
forbiddenTask.changeContract.allowedPathScopes = ['source/index.ts']
forbiddenTask.changeContract.excludedPathScopes = [...new Set([...forbiddenTask.changeContract.excludedPathScopes, 'test/basic.ts', 'test/advanced.ts', 'test-d/index.test-d.ts'])]
const forbiddenPrompt = buildTaskPreflightPromptV3(forbiddenTask, assignment, manifest, input)
const isolated = JSON.parse(await readFile('output/acceptance/isolated-harness-2026-10-14.json', 'utf8'))
const require = createRequire(await realpath(join(isolated.profile, 'node_modules/@deepseek-ai/dsh/package.json')))
const yaml = require('js-yaml')
const settings = yaml.load(await readFile(join(isolated.home, 'settings.yaml'), 'utf8'))
const selection = settings['agent-default-model']
assert.equal(selection.model, 'gpt-6.1-sol')
assert.equal(selection.provider, 'pockapi')
const provider = settings['llm-pi-ai'].providers[selection.provider]
assert.equal(provider.baseURL.replace(/\/$/u, ''), 'http://47.253.229.128:18080/v1')
const credential = yaml.load(await readFile(join(isolated.home, '.credentials.yaml'), 'utf8'))[provider.apiKeyEnv]
assert.equal(typeof credential, 'string')
await mkdir(destination)
const reports = []
const checks = ['identityAuditable', 'structuralEligible', 'accessCurrent', 'contextCurrent', 'evidenceRead', 'objectiveRestated', 'startingPointCovered', 'allowedScopeCovered', 'forbiddenScopeAcknowledged', 'verificationCovered', 'escalationCovered', 'noBlockingUnknowns']
const queue = ['original', 'fixed', 'forbidden'].flatMap(kind => [1, 2].map(index => ({ kind, index })))
await Promise.all(Array.from({ length: 2 }, async () => {
  while (queue.length) {
    const { kind, index } = queue.shift()
    const prompt = kind === 'original' ? originalPrompt : kind === 'fixed' ? fixedPrompt : forbiddenPrompt
    const request = { model: selection.model, messages: [
      { role: 'system', content: 'You are the selected executing Agent performing a read-only task handoff preflight. Return JSON only. Prove that you understand the frozen objective, evidence, allowed and forbidden scope, verification, and escalation conditions. Do not edit the repository or change the task.' },
      { role: 'user', content: prompt },
    ], max_tokens: 16_384, ...(selection.reasoningEffort === undefined ? {} : { reasoning_effort: selection.reasoningEffort }), stream: false }
    const prefix = `${kind}-${index}`
    const report = { kind, index, startedAt: new Date().toISOString(), requestDigest: digestObject(request) }
    await writeFile(join(destination, `${prefix}.request.json`), JSON.stringify({ ...report, request }, null, 2), { flag: 'wx' })
    try {
      const response = await fetch(`${provider.baseURL.replace(/\/$/u, '')}/chat/completions`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${credential}` }, body: JSON.stringify(request), signal: AbortSignal.timeout(10 * 60_000) })
      const raw = await response.text()
      await writeFile(join(destination, `${prefix}.response.txt`), raw, { flag: 'wx', mode: 0o600 })
      assert.ok(response.ok, `HTTP ${response.status}`)
      const data = JSON.parse(raw)
      const verdict = JSON.parse(data.choices[0].message.content.trim().replace(/^```(?:json)?\s*/u, '').replace(/\s*```$/u, ''))
      assert.equal(verdict.agentId, assignment.executingAgentId)
      assert.ok(['accepted', 'needs_clarification', 'rejected'].includes(verdict.agentReportedStatus))
      assert.ok(Array.isArray(verdict.missingFacts))
      for (const check of checks) assert.equal(typeof verdict[check], 'boolean', check)
      report.verdict = verdict
      report.usage = data.usage
      report.status = 'model_response_parsed'
    } catch (error) { report.status = 'request_or_parse_failed'; report.error = error.message }
    report.completedAt = new Date().toISOString()
    await writeFile(join(destination, `${prefix}.report.json`), JSON.stringify(report, null, 2), { flag: 'wx' })
    reports.push(report)
    console.log(JSON.stringify({ kind, index, status: report.status, verdict: report.verdict?.agentReportedStatus, missingFacts: report.verdict?.missingFacts }))
  }
}))
const fixedAccepted = reports.filter(r => r.kind === 'fixed' && r.verdict?.agentReportedStatus === 'accepted' && r.verdict.missingFacts.length === 0 && checks.every(check => r.verdict[check] === true)).length
const forbiddenRejected = reports.filter(r => r.kind === 'forbidden' && r.verdict && r.verdict.agentReportedStatus !== 'accepted' && r.verdict.missingFacts.some(f => /scope|forbid|authoriz|permission|范围|授权|禁止/iu.test(f))).length
await writeFile(join(destination, 'summary.json'), JSON.stringify({ scope: 'prompt_diagnostic_not_release_qualification', sourceOperationId: operation.id, modelRequests: reports.length, domainMutations: 0, originalVerdictUnchanged: true, fixedAccepted, forbiddenRejected, reports }, null, 2), { flag: 'wx' })
if (fixedAccepted !== 2 || forbiddenRejected !== 2 || reports.some(r => r.status !== 'model_response_parsed')) process.exitCode = 1
