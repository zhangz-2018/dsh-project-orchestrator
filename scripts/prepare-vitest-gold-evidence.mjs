import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { readFile, realpath, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import ts from 'typescript'

// 仅为缺证据的既有 Gold 补充固定配置与工具实现，不执行评测仓库或生成候选。
const [projectsPath, previousReviewPath, destination] = process.argv.slice(2)
assert.ok(projectsPath && previousReviewPath && destination)
const projects = JSON.parse(await readFile(projectsPath, 'utf8'))
const packet = JSON.parse(await readFile(projects.packetPath, 'utf8'))
const previous = JSON.parse(await readFile(previousReviewPath, 'utf8'))
assert.equal(previous.status, 'insufficient_evidence')
const item = packet.cases.find(c => c.caseId === previous.caseId)
assert.equal(item.repositoryIdentity, 'colinhacks/zod')
const repository = resolve('output/acceptance/repositories/zod')
const tool = await realpath(join(repository, 'node_modules/vitest'))
const hash = value => createHash('sha256').update(value).digest('hex')
const files = []
const archivedPaths = []

/** 完整冻结已安装文件；每项摘要校验内容，归档另行绑定原始工具字节。 */
async function captureToolFile(path, symbols) {
  const content = await readFile(join(tool, path), 'utf8')
  archivedPaths.push(path)
  if (symbols === undefined) {
    files.push({ path: `vitest/${path}`, content, sha256: hash(content), truncated: false })
    return
  }
  const parsed = ts.createSourceFile(path, content, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS)
  assert.equal(parsed.parseDiagnostics.length, 0, `Cannot parse ${path}`)
  const found = new Set()
  for (const node of parsed.statements) {
    const symbol = node.name?.text
    if (!ts.isImportDeclaration(node) && !symbols.includes(symbol)) continue
    if (symbol) found.add(symbol)
    const start = node.getStart(parsed)
    const excerpt = content.slice(start, node.end)
    files.push({ path: `vitest/${path}`, symbol: symbol ?? 'import', sourceSha256: hash(content),
      startLine: parsed.getLineAndCharacterOfPosition(start).line + 1,
      endLine: parsed.getLineAndCharacterOfPosition(node.end - 1).line + 1,
      content: excerpt, sha256: hash(excerpt), truncated: false, scope: 'Complete AST declaration; not the complete module.' })
  }
  assert.deepEqual([...found].sort(), [...symbols].sort(), `Missing requested symbols in ${path}`)
}

// 固定 commit 与当前工作树逐字比对，避免将另一个版本的配置作为事实。
for (const path of ['.configs/tsconfig.base.json', 'scripts/fail-on-console.ts', 'scripts/enable-compile.ts', 'vitest.root.mjs']) {
  const committed = execFileSync('git', ['show', `${item.repositoryBaseCommit}:${path}`], { cwd: repository, maxBuffer: 32_768 })
  const current = await readFile(join(repository, path))
  assert.deepEqual(current, committed)
  const content = current.toString('utf8')
  files.push({ path: `repository/${path}`, repositoryBaseCommit: item.repositoryBaseCommit, content, sha256: hash(content), truncated: false })
}
await captureToolFile('package.json')
assert.equal(JSON.parse(files.find(file => file.path === 'vitest/package.json').content).version, '4.1.5')
await captureToolFile('vitest.mjs')
await captureToolFile('dist/cli.js')
await captureToolFile('dist/chunks/cac.DJJmV0dT.js')
await captureToolFile('dist/chunks/cli-api.Cjt90eJu.js', [
  'createRunner', 'WorkspaceVitestPlugin', 'TestProject', 'resolveProjects', 'resolveTestProjectConfigs',
  'resolveDirectoryConfig', 'initializeProject', 'Vitest', 'VitestPlugin', 'createVitest', 'startVitest', 'prepareVitest',
])
await captureToolFile('dist/chunks/coverage.DM_a_rWm.js')
await captureToolFile('dist/chunks/index.UpGiHP7g.js', ['Typechecker'])
await captureToolFile('dist/chunks/defaults.9aQKnqFk.js')
await captureToolFile('dist/chunks/constants.CPYnjOGj.js')
const evidenceBytes = files.reduce((sum, file) => sum + Buffer.byteLength(file.content), 0)
assert.ok(evidenceBytes <= 300_000, 'Supplemental evidence exceeds the bounded review budget')
// 归档保留完整模块，摘录必须来自这些已安装字节，不冒充 registry 原包。
const archivePath = `${resolve(destination)}.installed-source.tgz`
await writeFile(archivePath, execFileSync('tar', ['-czf', '-', '-C', tool, ...archivedPaths], { maxBuffer: 2_000_000 }), { flag: 'wx' })
const report = {
  scope: 'Supplemental fixed-commit configuration and installed Vitest source only. Original Gold unchanged; no candidate output or claimed test execution.',
  observedAt: new Date().toISOString(), repositoryIdentity: item.repositoryIdentity,
  repositoryBaseCommit: item.repositoryBaseCommit, caseIds: [item.caseId],
  package: { name: 'vitest', version: '4.1.5', declaredRange: '^4.1.5' },
  archivePath, archiveSha256: hash(await readFile(archivePath)), archiveKind: 'Exact installed source files; not a registry tarball.',
  files, evidenceBytes,
  previousIndependentReview: { reviewId: previous.reviewId, status: previous.status, proposedGoldSha256: previous.proposedGoldSha256, verdict: previous.verdict },
  clarificationForIndependentAssessment: 'The full CLI module binds the run command to startVitest. Complete AST declarations trace configuration/project discovery, setup/config inheritance and the Typechecker entry. Full coverage/config/default modules retain the effective typecheck resolution rules. Repository setup/root and inherited compiler configuration match the fixed commit. Assess only the original expectation; source evidence does not establish successful execution, installed optional dependencies, or an implemented feature. Unrelated CLI API declarations are excluded explicitly, not truncated.',
  benchmarkRepositoryWrites: 0, modelRequests: 0, domainMutations: 0, releaseCandidate: false,
}
await writeFile(resolve(destination), JSON.stringify(report, null, 2), { flag: 'wx' })
console.log(JSON.stringify({ destination, caseId: item.caseId, evidenceBytes, files: files.length, benchmarkRepositoryWrites: 0, domainMutations: 0 }))
