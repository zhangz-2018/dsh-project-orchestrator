import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { promisify } from 'node:util'

// Prepare review inputs only. This deliberately cannot sign Gold, create claims,
// call models, or turn a proposed Decision into a confirmed human fact.
const run = promisify(execFile)
const documentPath = resolve('docs/release-corpus-review-2026-10-15.zh-CN.md')
const output = resolve(process.argv[2] ?? 'output/acceptance/release-corpus-draft-2026-10-15.json')
const document = await readFile(documentPath, 'utf8')
const repositoryRows = [...document.matchAll(/^\| ([\w-]+\/[\w-]+) \| `([a-f0-9]{40})` \| ([^|]+) \| ([^|]+) \|$/gmu)]
assert.equal(repositoryRows.length, 8)
const repositories = []
for (const [, identity, baseCommit, domain, declaredVerification] of repositoryRows) {
  const repository = resolve('output/acceptance/repositories', identity.split('/')[1])
  const git = async (args) => (await run('git', ['-C', repository, ...args], { maxBuffer: 1_000_000 })).stdout.trim()
  assert.equal(await git(['rev-parse', 'HEAD']), baseCommit, `${identity} commit changed`)
  assert.equal(await git(['remote', 'get-url', 'origin']), `https://github.com/${identity}.git`)
  assert.equal(await git(['status', '--porcelain=v1']), '', `${identity} has local changes`)
  const manifest = JSON.parse(await readFile(resolve(repository, 'package.json'), 'utf8'))
  assert.equal(typeof manifest.scripts?.test, 'string')
  repositories.push({ identity, baseCommit, domain: domain.trim(), repository, declaredVerification: declaredVerification.trim(), testScript: manifest.scripts.test, testExecuted: false })
}
const aliases = new Map([['p-limit', 'plimit'], ['p-retry', 'pretry'], ['p-queue', 'pqueue'], ['p-map', 'pmap'], ['ky', 'ky'], ['Hono', 'hono'], ['Zod', 'zod'], ['mitt', 'mitt']])
const cases = []
for (const section of document.split(/^### /mu).slice(1)) {
  const heading = section.split('\n')[0].trim()
  const prefix = aliases.get(heading)
  if (prefix === undefined) continue
  const rows = [...section.matchAll(/^\| ([a-z][a-z0-9-]+) \| ([^|]+) \| (ready[^|]*|blocked) \|$/gmu)]
  assert.equal(rows.length, 3, `${heading} must contain three independently reviewable cases`)
  const repository = repositories.find((item) => item.identity.split('/')[1] === heading.toLowerCase())
  assert.ok(repository)
  for (const [, caseId, requirement, readiness] of rows) {
    assert.ok(caseId.startsWith(`${prefix}-`))
    const pairedCaseId = caseId.endsWith('-pending') ? caseId.replace(/-pending$/u, '-resolved') : caseId.endsWith('-resolved') ? caseId.replace(/-resolved$/u, '-pending') : undefined
    cases.push({ caseId, repositoryIdentity: repository.identity, repositoryBaseCommit: repository.baseCommit,
      proposedRequirement: requirement.trim(), expectedReadiness: readiness.trim().startsWith('ready') ? 'ready' : 'blocked',
      requiredEvidenceStages: readiness.trim() === 'blocked' ? ['repository', 'requirements', 'decisions'] : ['repository', 'requirements', 'decisions', 'bindings', 'tasks', 'assignments', 'preflight'],
      proposedBlockingReasons: readiness.trim() === 'blocked' ? [{ code: 'requirement-decision-pending', subjectKeys: ['DEC-001'] }] : [],
      ...(pairedCaseId === undefined ? {} : { pairedCaseId }),
      decisionConfirmationPending: readiness.includes('确认后'), goldSigned: false, realModelRunCount: 0 })
  }
}
assert.equal(cases.length, 24)
assert.equal(new Set(cases.map((item) => item.caseId)).size, 24)
assert.equal(cases.filter((item) => item.expectedReadiness === 'blocked').length, 8)
for (const item of cases.filter((item) => item.pairedCaseId !== undefined)) {
  const paired = cases.find((candidate) => candidate.caseId === item.pairedCaseId)
  assert.ok(paired && paired.pairedCaseId === item.caseId && paired.expectedReadiness !== item.expectedReadiness)
}
const report = { schemaVersion: 1, status: 'draft_requires_review_and_input_freeze', preparedAt: new Date().toISOString(), documentPath,
  documentSha256: createHash('sha256').update(document).digest('hex'), repositoryCount: repositories.length, caseCount: cases.length,
  minimumFreshCandidateCount: cases.length * 5, repositories, cases,
  batchBudget: { mode: 'explicitly_unlimited', tokenLimit: null, authorization: '用户于 2026-10-16 回复：不限制' },
  remaining: ['Review business expectations and hypothetical benchmark choices', 'Prepare scoped trusted capability facts through formal interfaces', 'Freeze complete Gold inputs and independent review digests before collection', 'Collect and retain every real attempt', 'Pass the unchanged release gate'] }
await mkdir(dirname(output), { recursive: true })
await writeFile(output, `${JSON.stringify(report, null, 2)}\n`, { flag: 'wx' })
console.log(JSON.stringify({ output, status: report.status, repositoryCount: repositories.length, caseCount: cases.length, minimumFreshCandidateCount: report.minimumFreshCandidateCount }))
