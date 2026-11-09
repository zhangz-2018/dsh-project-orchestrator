import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { readFile, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import ts from 'typescript'

// 只为既有缺证据审阅补充固定源码；不读取候选输出、不执行仓库或变更需求与 Gold。
const [projectsPath, previousReviewPath, destination] = process.argv.slice(2)
assert.ok(projectsPath && previousReviewPath && destination)
const projects = JSON.parse(await readFile(projectsPath, 'utf8'))
const packet = JSON.parse(await readFile(projects.packetPath, 'utf8'))
const previous = JSON.parse(await readFile(previousReviewPath, 'utf8'))
assert.equal(previous.status, 'insufficient_evidence')
const item = packet.cases.find(c => c.caseId === previous.caseId)
assert.equal(item?.repositoryIdentity, 'sindresorhus/p-map')
const repository = resolve('output/acceptance/repositories/p-map')
const hash = value => createHash('sha256').update(value).digest('hex')
const files = []
const omitted = []
const paths = ['package.json', 'index.test-d.ts', 'test.js', 'test-multiple-pmapskips-performance.js',
  'test-pmap-iterable-performance.js', 'count-array-work.js', 'assert-in-range.js']

/** 核对工作树与固定 commit 的完整字节；不以摘要代替未提供的正文或声称测试已执行。 */
async function readCommitted(path) {
  const committed = execFileSync('git', ['show', `${item.repositoryBaseCommit}:${path}`], { cwd: repository, maxBuffer: 1_000_000 })
  const current = await readFile(join(repository, path))
  assert.deepEqual(current, committed, `Source changed: ${path}`)
  return current.toString('utf8')
}

for (const path of paths) {
  const content = await readCommitted(path)
  if (path !== 'test.js') {
    files.push({ path, repositoryBaseCommit: item.repositoryBaseCommit, content, sha256: hash(content), truncated: false })
    continue
  }
  const parsed = ts.createSourceFile(path, content, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS)
  assert.equal(parsed.parseDiagnostics.length, 0)
  // 完整保留直接引用 pMap 的语句，以及全部顶层 imports、helpers 和循环；其他表达式逐条登记为未提供。
  for (const node of parsed.statements) {
    let usesPMap = false
    const visit = child => { if (ts.isIdentifier(child) && child.text === 'pMap') usesPMap = true; ts.forEachChild(child, visit) }
    visit(node)
    const startOffset = node.getStart(parsed)
    const text = content.slice(startOffset, node.end)
    const location = { path, sourceSha256: hash(content), sourceBytes: Buffer.byteLength(content), startOffset, endOffset: node.end,
      startLine: parsed.getLineAndCharacterOfPosition(startOffset).line + 1, endLine: parsed.getLineAndCharacterOfPosition(node.end - 1).line + 1 }
    if (!ts.isExpressionStatement(node) || usesPMap) {
      files.push({ ...location, content: text, sha256: hash(text), truncated: false, scope: 'Complete top-level AST statement; not the entire test module.' })
    } else omitted.push({ ...location, sha256: hash(text), scope: 'Omitted expression without a pMap identifier; no claim about execution or correctness.' })
  }
}
const evidenceBytes = files.reduce((sum, file) => sum + Buffer.byteLength(file.content), 0)
assert.ok(evidenceBytes <= 300_000)
const archivePath = `${resolve(destination)}.fixed-source.tgz`
await writeFile(archivePath, execFileSync('git', ['archive', '--format=tar.gz', item.repositoryBaseCommit, '--', ...paths], { cwd: repository, maxBuffer: 2_000_000 }), { flag: 'wx' })
const report = {
  // 绑定原需求、原审阅及原拟议 Gold；新的版本须重新绑定并独立审阅，不继承批准。
  scope: 'Fixed-commit focused pMap tests, full type tests and full AVA-discovered performance tests and helpers. No candidate outputs or test execution claims.',
  observedAt: new Date().toISOString(), repositoryIdentity: item.repositoryIdentity, repositoryBaseCommit: item.repositoryBaseCommit,
  caseIds: [item.caseId],
  // 完整归档用于复现；模型正文仅为 files 中明确提供的完整文件或完整节点。
  archivePath, archiveSha256: hash(await readFile(archivePath)), archiveKind: 'git archive of exact fixed-commit files; omitted nodes are not supplied review text.',
  files, evidenceBytes, omitted,
  previousIndependentReview: { reviewId: previous.reviewId, status: previous.status, proposedGoldSha256: previous.proposedGoldSha256, verdict: previous.verdict },
  clarificationForIndependentAssessment: 'The two default-discovered performance files contain AVA serial test declarations, not standalone scripts without tests. Their complete helpers are supplied. index.test-d.ts is complete. test.js supplies complete statements that reference the default pMap identifier, plus all other top-level declarations, imports and loops; other top-level expressions are explicitly listed as omitted, not claimed covered. Assess completion/stop/done/abort/error/inference and API-isolation expectations from the supplied evidence; do not assume omitted assertions passed or require edits to inspection-only files. The prescribed unfiltered repository test command and original Gold remain unchanged.',
  // 本脚本仅写本地审阅材料，不产生领域批准、真实候选或上游改动。
  benchmarkRepositoryWrites: 0, modelRequests: 0, domainMutations: 0, releaseCandidate: false,
}
await writeFile(resolve(destination), JSON.stringify(report, null, 2), { flag: 'wx' })
console.log(JSON.stringify({ destination, caseId: item.caseId, evidenceBytes, files: files.length, omittedStatements: omitted.length, modelRequests: 0, domainMutations: 0 }))
