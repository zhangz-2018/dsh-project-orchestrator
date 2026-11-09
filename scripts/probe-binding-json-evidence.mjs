import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { execFile } from 'node:child_process'
import { mkdir, readFile, realpath, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { join, resolve } from 'node:path'
import { promisify } from 'node:util'
import { BindingStage, digestObject, parseGeneratedPlanningReviewV3 } from '../lib/index.js'

// A diagnostic A/B plus negative control, never a candidate, approval or retry
// of the rejected operation. All requests and failures are retained separately.
const [auditPath, destination] = process.argv.slice(2)
assert.ok(auditPath && destination)
const audit = JSON.parse(await readFile(auditPath, 'utf8'))
assert.equal(audit.replayMatchesActualPrompt, true)
const snapshotResponse = await fetch('http://127.0.0.1:3087/project-orchestrator/api/snapshot')
assert.ok(snapshotResponse.ok)
const snapshot = await snapshotResponse.json()
const operation = snapshot.planningOperations.find(o => o.id === audit.operationId)
assert.equal(operation.status, 'blocked')
const { stdout } = await promisify(execFile)('zstd', ['-dc', audit.sessionPath], { maxBuffer: 5_000_000 })
const events = stdout.trim().split('\n').map(line => JSON.parse(line))
const prompts = events.filter(e => e.type === 'user/message').flatMap(e => e.data.content).filter(c => c.type === 'text' && c.text.includes(`\n${audit.reviewInputDigest}\n`))
assert.equal(prompts.length, 1)
const delimiter = '\n\nFrozen subject:\n'
const header = prompts[0].text.slice(0, prompts[0].text.indexOf(delimiter) + delimiter.length)
const originalSubject = JSON.parse(prompts[0].text.slice(header.length))
const repository = snapshot.repositorySnapshotsV3.find(r => r.id === operation.repositorySnapshotId)
const retrieval = snapshot.repositoryEvidenceRetrievalReports.find(r => r.id === operation.repositoryEvidenceRetrievalReportId)
const manifest = snapshot.requirementSourceManifests.find(r => r.id === operation.sourceManifestId)
const stage = new BindingStage({})
const newEvidence = await stage.loadFrozenEvidence(repository, { projectId: operation.projectId, operationId: operation.id, references: stage.repositoryReferences(repository, retrieval) }, manifest.anchors.map(a => a.text).join('\n'))
assert.ok(newEvidence.find(e => e.path === 'package.json').content.includes('[Exact JSON member /exports/.~1cors;'))
assert.ok(newEvidence.reduce((n, e) => n + Buffer.byteLength(e.content), 0) <= 65_536)
const newSubject = { ...originalSubject, frozenSourceEvidence: newEvidence }
const negativeSubject = { ...newSubject, bindings: JSON.parse(JSON.stringify(newSubject.bindings).replaceAll('./cors', './missing-probe-export')) }
assert.notDeepEqual(negativeSubject.bindings, newSubject.bindings)
const isolated = JSON.parse(await readFile('output/acceptance/isolated-harness-2026-10-14.json', 'utf8'))
const require = createRequire(await realpath(join(isolated.profile, 'node_modules/@deepseek-ai/dsh/package.json')))
const yaml = require('js-yaml')
const settings = yaml.load(await readFile(join(isolated.home, 'settings.yaml'), 'utf8'))
const selection = settings['agent-default-model']
assert.equal(selection.provider, 'pockapi')
assert.equal(selection.model, 'gpt-6.1-sol')
const provider = settings['llm-pi-ai'].providers[selection.provider]
assert.equal(provider.baseURL.replace(/\/$/u, ''), 'http://47.253.229.128:18080/v1')
const credential = yaml.load(await readFile(join(isolated.home, '.credentials.yaml'), 'utf8'))[provider.apiKeyEnv]
assert.equal(typeof credential, 'string')
await mkdir(destination)
const hash = v => createHash('sha256').update(v).digest('hex')
const bundleSha256 = hash(await readFile('lib/index.js'))
const queue = ['original', 'focused', 'negative'].flatMap(kind => [1, 2].map(index => ({ kind, index })))
const reports = []
await Promise.all(Array.from({ length: 2 }, async () => {
  while (queue.length) {
    const { kind, index } = queue.shift()
    const subject = kind === 'original' ? originalSubject : kind === 'focused' ? newSubject : negativeSubject
    const inputDigest = digestObject({ diagnostic: 'binding-json-evidence-ab-v1', bundleSha256, subject, riskHeader: header })
    const prompt = header.replace(audit.reviewInputDigest, inputDigest) + JSON.stringify(subject)
    const request = { model: selection.model, messages: [
      { role: 'system', content: 'You are an independent repository-binding reviewer. Return JSON only. Verify actual owners, impact chains and claims against frozen source evidence; reject unsupported claims. Do not repair bindings or execute tools.' },
      { role: 'user', content: prompt },
    ], max_tokens: 16_384, ...(selection.reasoningEffort === undefined ? {} : { reasoning_effort: selection.reasoningEffort }), stream: false }
    const prefix = `${kind}-${index}`
    const report = { kind, index, startedAt: new Date().toISOString(), inputDigest, requestDigest: hash(JSON.stringify(request)) }
    await writeFile(join(destination, `${prefix}.request.json`), JSON.stringify({ ...report, request }, null, 2), { flag: 'wx' })
    try {
      const response = await fetch(`${provider.baseURL.replace(/\/$/u, '')}/chat/completions`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${credential}` }, body: JSON.stringify(request), signal: AbortSignal.timeout(10 * 60_000) })
      const raw = await response.text()
      await writeFile(join(destination, `${prefix}.response.txt`), raw, { flag: 'wx', mode: 0o600 })
      assert.ok(response.ok, `HTTP ${response.status}`)
      const data = JSON.parse(raw)
      report.review = parseGeneratedPlanningReviewV3(data.choices[0].message.content, inputDigest)
      report.responseModel = data.model
      report.usage = data.usage
      report.status = 'review_completed'
    } catch (error) { report.status = 'request_or_review_failed'; report.error = error.message }
    report.completedAt = new Date().toISOString()
    await writeFile(join(destination, `${prefix}.report.json`), JSON.stringify(report, null, 2), { flag: 'wx' })
    reports.push(report)
    console.log(JSON.stringify({ kind, index, status: report.status, reviewStatus: report.review?.status, findings: report.review?.findings.map(f => f.code) }))
  }
}))
const focusedApproved = reports.filter(r => r.kind === 'focused' && r.review?.status === 'approved' && r.review.findings.length === 0).length
const negativeRejected = reports.filter(r => r.kind === 'negative' && r.review?.status !== 'approved' && r.review?.findings.some(f => ['error', 'blocking'].includes(f.severity))).length
const result = { scope: 'diagnostic_only_not_release_qualification', observedAt: new Date().toISOString(), sourceAudit: resolve(auditPath), sourceOperationId: operation.id, bundleSha256, domainMutations: 0, originalVerdictUnchanged: true, modelRequests: reports.length, focusedApproved, negativeRejected, reports }
await writeFile(join(destination, 'summary.json'), JSON.stringify(result, null, 2), { flag: 'wx' })
if (focusedApproved !== 2 || negativeRejected !== 2 || reports.some(r => r.status !== 'review_completed')) process.exitCode = 1
