import assert from 'node:assert/strict'
import { mkdir, readFile, realpath, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import { BindingStage, buildTaskPreflightPromptV3, digestObject } from '../lib/index.js'

// Read-only contract diagnostic. Hand-edited proposals are never persisted,
// counted as release candidates, approved, dispatched, or run in a repository.
const destination = process.argv[2]
assert.ok(destination)
const response = await fetch('http://127.0.0.1:3087/project-orchestrator/api/snapshot')
assert.ok(response.ok)
const snapshot = await response.json()
const operation = snapshot.planningOperations.find(o => o.id === 'planning-v3:0146bdd8-0966-4bf9-bfb0-15a67590c5a4')
assert.equal(operation.status, 'blocked')
assert.equal(operation.stage, 'task_preflight')
const proposal = snapshot.planningProposalPacks.find(p => p.operationId === operation.id)
const task = proposal.plan.tasks.find(t => t.key === 'TASK-VERIFY')
const assignment = snapshot.assignmentDrafts.find(a => a.operationId === operation.id && a.taskKey === task.key)
const manifest = snapshot.planningPromptReferenceManifests.find(m => m.id === proposal.promptReferenceManifestId)
const repository = snapshot.repositorySnapshotsV3.find(r => r.id === operation.repositorySnapshotId)
const retrieval = snapshot.repositoryEvidenceRetrievalReports.find(r => r.id === operation.repositoryEvidenceRetrievalReportId)
const sourceManifest = snapshot.requirementSourceManifests.find(m => m.id === operation.sourceManifestId)
const stage = new BindingStage({})
const sourceEvidence = await stage.loadFrozenEvidence(repository, { projectId: operation.projectId, operationId: operation.id, references: stage.repositoryReferences(repository, retrieval) }, sourceManifest.anchors.map(a => a.text).join('\n'))
const policy = snapshot.planningPolicySnapshots.find(p => p.id === operation.policySnapshotId)
const accessSnapshot = snapshot.projectAccessGrantSnapshots.find(p => p.operationId === operation.id)
const input = {
  bindings: snapshot.requirementCodeBindings.filter(b => b.operationId === operation.id),
  constraints: snapshot.policyConstraintsV3.filter(c => policy.constraintIds.includes(c.id)), accessSnapshot,
  accessGrants: snapshot.resourceAccessGrants.filter(g => accessSnapshot.grantIds.includes(g.id) && g.principalId === assignment.executingAgentId),
  repositoryDigest: repository.repositoryDigest, sourceEvidence, planTasks: proposal.plan.tasks,
}
const originalPrompt = buildTaskPreflightPromptV3(task, assignment, manifest, input)
const fixedTasks = structuredClone(proposal.plan.tasks)
const producer = fixedTasks.find(t => t.key === 'TASK-IMPLEMENT')
const consumer = fixedTasks.find(t => t.key === 'TASK-VERIFY')
const commands = ['ref-command-c040', 'ref-command-c065', 'ref-command-c018', 'ref-command-c019', 'ref-command-c026', 'ref-command-c031']
const artifact = 'Before the first implementation write, TASK-IMPLEMENT measures unchanged frozen revision 680d19f7d1e042e55934209caeb79bc843b94f44 using confirmed commands ref-command-c040 (runtime), ref-command-c065 (construction), ref-command-c018 and ref-command-c019 (memory), ref-command-c026 (classic gzip bytes) and ref-command-c031 (mini gzip bytes). Capture all six numeric values and units, command identity and exit result, revision and repository digest, environment/tool versions and sampling method/repetitions. Keep them as task execution evidence with a stable evidence id, not a new repository report. Do not change or switch the baseline, edit benchmark fixtures/configuration, install dependencies, or write outside the existing contract. If any comparable metric cannot be captured, stop before implementation and escalate the exact gap.'
producer.description = `${artifact} ${producer.description}`
producer.completionCriteria.unshift(artifact)
producer.verificationCommandRefs = [...new Set([...producer.verificationCommandRefs, ...commands])]
producer.policyConstraintRefs = [...new Set([...producer.policyConstraintRefs, 'ref-policy-p0003', 'ref-policy-p0006'])]
producer.contextPack.inScope.unshift(artifact)
producer.contextPack.expectedArtifacts.push('Baseline execution evidence id with all six metrics, units, revision, commands, environment and samples captured before implementation.')
producer.changeContract.expectedArtifacts.push('Baseline measurement evidence retained outside the repository as task evidence before any write.')
const handoff = 'After TASK-IMPLEMENT completes, receive its baseline execution evidence id and six measurements captured before its first write. Verify revision 680d19f7d1e042e55934209caeb79bc843b94f44, repository digest, commands, environment and sampling record. Run the same confirmed measurement commands against the candidate with the same environment and sampling method, then report baseline/candidate values, units, deltas and regressions for all axes. These values are pending execution work, not existing planning facts. If producer evidence is missing, incomplete or incomparable, stop and report that exact gap; never invent values or change the baseline.'
consumer.description = `${consumer.description} ${handoff}`
consumer.completionCriteria.unshift(handoff)
consumer.contextPack.inScope.push(handoff)
consumer.contextPack.expectedArtifacts.push('Comparison referencing TASK-IMPLEMENT baseline evidence id, all six baseline/candidate values, units, environment and sampling records.')
const fixedPrompt = buildTaskPreflightPromptV3(consumer, assignment, manifest, { ...input, planTasks: fixedTasks })
// The consumer claims an owner, but its supplied dependency has no such duty.
const absentProducerTasks = structuredClone(proposal.plan.tasks).map(t => t.key === consumer.key ? consumer : t)
const absentProducerPrompt = buildTaskPreflightPromptV3(consumer, assignment, manifest, { ...input, planTasks: absentProducerTasks })
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
const queue = ['original', 'fixed', 'absent-producer'].flatMap(kind => [1, 2].map(index => ({ kind, index })))
await Promise.all(Array.from({ length: 2 }, async () => {
  while (queue.length) {
    const { kind, index } = queue.shift()
    const prompt = kind === 'original' ? originalPrompt : kind === 'fixed' ? fixedPrompt : absentProducerPrompt
    const request = { model: selection.model, messages: [
      { role: 'system', content: 'You are the selected executing Agent performing a read-only task handoff preflight. Return JSON only. Prove that you understand the frozen objective, evidence, allowed and forbidden scope, verification, and escalation conditions. Do not edit the repository or change the task.' },
      { role: 'user', content: prompt },
    ], max_tokens: 16_384, ...(selection.reasoningEffort === undefined ? {} : { reasoning_effort: selection.reasoningEffort }), stream: false }
    const prefix = `${kind}-${index}`
    const report = { kind, index, startedAt: new Date().toISOString(), requestDigest: digestObject(request) }
    await writeFile(join(destination, `${prefix}.request.json`), JSON.stringify({ ...report, request }, null, 2), { flag: 'wx' })
    try {
      const result = await fetch(`${provider.baseURL.replace(/\/$/u, '')}/chat/completions`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${credential}` }, body: JSON.stringify(request), signal: AbortSignal.timeout(10 * 60_000) })
      const raw = await result.text()
      await writeFile(join(destination, `${prefix}.response.txt`), raw, { flag: 'wx', mode: 0o600 })
      assert.ok(result.ok, `HTTP ${result.status}`)
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
const rejected = kind => reports.filter(r => r.kind === kind && r.verdict && r.verdict.agentReportedStatus !== 'accepted' && r.verdict.missingFacts.length > 0).length
await writeFile(join(destination, 'summary.json'), JSON.stringify({ scope: 'hand_edited_contract_diagnostic_not_planner_generation_or_release_qualification', sourceOperationId: operation.id, modelRequests: reports.length, domainMutations: 0, originalVerdictUnchanged: true, fixedAccepted, originalRejected: rejected('original'), absentProducerRejected: rejected('absent-producer'), reports }, null, 2), { flag: 'wx' })
if (fixedAccepted !== 2 || rejected('original') !== 2 || rejected('absent-producer') !== 2 || reports.some(r => r.status !== 'model_response_parsed')) process.exitCode = 1
