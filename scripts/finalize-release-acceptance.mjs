import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { readFile, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'

// Observe the authorized collector, then run the existing formal checks. No
// model calls, approval, task dispatch, publication or domain writes here.
const [directoryArgument, tag, mode] = process.argv.slice(2)
assert.ok(directoryArgument && tag)
assert.match(tag, /^[a-z][a-z0-9-]+$/u)
assert.ok(mode === undefined || mode === '--archive-failed')
const archiveFailed = mode === '--archive-failed'
const directory = resolve(directoryArgument)
const run = args => new Promise((done, reject) => {
  const child = spawn(process.execPath, args, { stdio: 'inherit' })
  child.on('error', reject)
  child.on('exit', code => done(code))
})
let state
while (true) {
  state = JSON.parse(await readFile(join(directory, 'state.json'), 'utf8'))
  if (archiveFailed && ['stopped_for_diagnosis', 'drained_incomplete'].includes(state.status)) break
  if (state.status === 'collection_complete_pending_gate') break
  assert.ok(['waiting_for_existing_work', 'collecting'].includes(state.status), `Collection requires diagnosis: ${state.status}`)
  await new Promise(done => setTimeout(done, 5000))
}
const inputs = [...state.seedPaths, ...state.jobs.map(j => j.ledgerPath)]
const ledgers = await Promise.all(inputs.map(async path => JSON.parse(await readFile(path, 'utf8'))))
const projects = JSON.parse(await readFile(state.projectsPath, 'utf8'))
assert.equal(projects.projects.length, 25)
if (!archiveFailed) for (const project of projects.projects) assert.ok(ledgers.flatMap(l => l.attempts).filter(a => a.caseId === project.caseId && a.outcome === 'candidate').length >= 5, `${project.caseId}: independent candidates incomplete`)
const ledgerPath = resolve('output/acceptance', `${tag}-collection.json`)
const manifestPath = resolve('planning-evals', `${tag}-manifest.json`)
const domainFactsPath = resolve('output/acceptance', `${tag}-domain-facts.json`)
const canaryVerificationPath = resolve('output/acceptance', `${tag}-canary-verification.json`)
const gatePath = resolve('output/acceptance', `${tag}-gate.json`)
assert.equal(await run(['scripts/combine-release-collections.mjs', tag, ledgerPath, manifestPath, ...inputs]), 0)
assert.equal(await run(['scripts/verify-release-domain-facts.mjs', ledgerPath, domainFactsPath]), 0)
assert.equal(await run(['scripts/verify-canary-export.mjs', canaryVerificationPath]), 0)
const exitCode = await run(['planning-evals/run.mjs', '--release', '--manifest', manifestPath, '--canary', 'output/acceptance/greeting-release-canary-v2-2026-10-15.json', '--output', gatePath])
const gate = JSON.parse(await readFile(gatePath, 'utf8'))
assert.equal(exitCode === 0, gate.releaseQualification.passed && gate.aggregate.passed)
const report = { observedAt: new Date().toISOString(), status: exitCode === 0 ? 'formal_release_gate_passed' : 'formal_release_gate_failed', exitCode,
  collectionStatus: state.status,
  sourceStatePath: join(directory, 'state.json'), ledgerPath, manifestPath, domainFactsPath, canaryVerificationPath, gatePath,
  localPreflightObservations: state.jobs.filter(j => j.outcome === 'local_preflight_failure').map(j => j.observationPath),
  modelRequests: 0, domainMutations: 0, published: false }
await writeFile(resolve('output/acceptance', `${tag}-result.json`), JSON.stringify(report, null, 2), { flag: 'wx' })
const markdown = `# 正式验收结果\n\n生成时间：${report.observedAt}。\n\n结论：${exitCode === 0 ? '正式发布验收门禁通过' : '正式发布验收门禁未通过'}，退出码 ${exitCode}。未发布、未部署到原用户 Host。\n\n| 项目 | 实际结果 |\n| --- | --- |\n| 仓库 | ${gate.repositoryCount} |\n| 需求样本 | ${gate.requirementSampleCount} |\n| 全部尝试 | ${gate.attemptCount} |\n| 有效真实候选 | ${gate.validCandidateCount} |\n| 独立根请求模型失败 | ${gate.modelFailureCount} |\n| 质量指标 | ${gate.aggregate.passed ? '通过' : '未通过'} |\n| 资格门禁 | ${gate.releaseQualification.passed ? '通过' : '未通过'} |\n\n全部失败根请求保留在合并账本；策略后继未计为独立候选，后继错误保留在原终态证明。未发送的本地预检失败另有只读证明，不计模型调用或候选。\n\n证据：[正式门禁](${gatePath})、[全部账本](${ledgerPath})、[领域核验](${domainFactsPath})、[真实交付 canary](${canaryVerificationPath})、[调度及后继记录](${report.sourceStatePath})。\n${gate.releaseQualification.failures.length ? `\n未通过项：\n\n${gate.releaseQualification.failures.map(f => `- ${f}`).join('\n')}\n` : ''}`
await writeFile(resolve('output/acceptance', `${tag}-result.md`), markdown, { flag: 'wx' })
console.log(JSON.stringify(report))
process.exitCode = exitCode ?? 1
