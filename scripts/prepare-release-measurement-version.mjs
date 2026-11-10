import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'

// 仅准备用户批准的两个 Zod 来源修订；通过正式接口更新 draft，不复制人工事实或派发任务。
const [previousPath, destinationArgument, action] = process.argv.slice(2)
assert.ok(previousPath && destinationArgument && action === '--apply-approved-zod-scope')
const destination = resolve(destinationArgument)
const previous = JSON.parse(await readFile(previousPath, 'utf8'))
const packet = JSON.parse(await readFile(previous.packetPath, 'utf8'))
const base = new URL(previous.baseUrl)
assert.equal(base.hostname, '127.0.0.1')
assert.equal(base.port, '3087')
const hash = value => createHash('sha256').update(value).digest('hex')
const run = promisify(execFile)
const targetPath = 'packages/bench/stringbool-acceptance.ts'
const command = `nub --expose-gc --conditions=@zod/source ${targetPath}`
const authorizedProjects = new Set(['fe2e485b-b8f3-4d8e-8991-499ad5fb7bc5', 'f45acad5-36c5-422b-8288-b2996dd4a754'])
const oldBoundary = 'REQ-001 的完整可写 Binding allowedPathScopes 为这些精确文件：packages/zod/src/v4/core/api.ts、packages/zod/src/v4/classic/tests/stringbool.test.ts、packages/zod/src/v4/mini/tests/stringbool.test.ts。'
const newBoundary = oldBoundary.slice(0, -1) + `、${targetPath}。`
const measurementSource = [
  'REQ-001 的执行测量约束：仅新增 packages/bench/stringbool-acceptance.ts，不修改其他测量脚本、依赖、package manifest 或发布配置。它是待创建入口，不是固定 commit 中已有文件或已经成功的测量。',
  `planned-verification-entry: ${JSON.stringify({ targetPath, command })}`,
  'TASK-IMPLEMENT 先核对并冻结基线 commit，可先在精确获批路径创建仅用于测量的入口；必须在首次产品源码修改前完成基线采样，再实现产品并采集候选数据。两版本使用相同测量代码，交错逐轮运行并保留原始样本；每轮 tight parse 只加载一个 revision，construction 可按既有规则比较。入口运行前必须实际创建，不伪造源码或数值。',
  '新增入口分别测量 classic/mini 的 stringbool parse 与 schema construction，基线只使用原有参数；新参数行为的附加数据与基线可比数据分列。使用固定迭代次数、预热、样本之间显式 gc()、消费结果和最小值计时汇总，记录单位、revision、Node 版本及 uptime 负载。GC 不可用、基线身份不匹配或负载超过原政策阈值时明确拒绝该数据。',
  '原 AGENTS.md 的全部 runtime、memory、classic/mini bundle 数值义务保留，不能用新增入口替代 retained-heap 或 bundle 测量。TASK-VERIFY 依赖 TASK-IMPLEMENT，独立检查原始数据、三轴方法、基线身份和全部产品回归；不要求为重复验证强制修改已充分的脚本。',
  '只读测量证据：AGENTS.md、packages/bench/init.ts、packages/bench/metabench.ts、packages/bench/error-construction-breakdown.ts、packages/bench/memory/schema-footprint.ts、packages/bench/memory/realworld.ts、packages/bench/memory/harness.ts。现有 memory harness 的中位数 retained-heap 口径不等同于 runtime 最小值计时；init/metabench 的定时循环不能证明固定总采样次数。',
].join('\n')

/** 仅访问隔离 Host；PUT 使用 API 的原有项目契约，不直接改领域存储。 */
async function request(path, body) {
  const response = await fetch(`${base.origin}/project-orchestrator/api${path}`, {
    method: body === undefined ? 'GET' : 'PUT', headers: { origin: base.origin, 'content-type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(30_000),
  })
  const result = await response.json()
  assert.ok(response.ok, `${path}: HTTP ${response.status} ${result.error?.code ?? ''}`)
  return result
}

const before = await request('/snapshot')
assert.equal(before.planningOperations.filter(operation => operation.status === 'running').length, 0)
const rename = id => { assert.ok(id.endsWith('-config-barrel-v50')); return id.replace(/-config-barrel-v50$/u, '-measurement-v52') }
const updates = []
const cases = []
for (const item of packet.cases) {
  const prepared = previous.projects.find(project => project.caseId === item.caseId)
  assert.ok(prepared)
  let next = { ...item, caseId: rename(item.caseId), ...(item.pairedCaseId === undefined ? {} : { pairedCaseId: rename(item.pairedCaseId) }) }
  if (authorizedProjects.has(prepared.projectId)) {
    assert.equal(item.expectedReadiness, 'ready')
    assert.equal(item.repositoryBaseCommit, '680d19f7d1e042e55934209caeb79bc843b94f44')
    const project = before.projects.find(project => project.id === prepared.projectId)
    assert.equal(project?.status, 'draft')
    assert.equal(project.currentPlanSnapshotId, undefined)
    assert.deepEqual(project.taskIds, [])
    assert.equal(project.prd, item.proposedPrd.trim())
    assert.equal(item.proposedPrd.split(oldBoundary).length, 2)
    const proposedPrd = item.proposedPrd.replace(oldBoundary, newBoundary).trimEnd() + `\n\n${measurementSource}\n`
    // 产品 REQ/AC/DEC 原文逐行保留；只有批准的边界句及附加测量责任可变化。
    assert.ok(item.proposedPrd.split('\n').filter(line => /^(?:REQ-|AC-|DEC-|OPT-)/u.test(line) && !line.startsWith(oldBoundary)).every(line => proposedPrd.split('\n').includes(line)))
    const root = resolve('output/acceptance/repositories/zod')
    const files = [...item.files, { path: targetPath, kind: 'proposed_new_verification' }]
    for (const path of ['AGENTS.md', 'packages/bench/init.ts', 'packages/bench/metabench.ts', 'packages/bench/error-construction-breakdown.ts', 'packages/bench/memory/schema-footprint.ts', 'packages/bench/memory/realworld.ts', 'packages/bench/memory/harness.ts']) {
      const committed = (await run('git', ['show', `${item.repositoryBaseCommit}:${path}`], { cwd: root, encoding: 'buffer' })).stdout
      assert.deepEqual(await readFile(join(root, path)), committed)
      if (!files.some(file => file.path === path)) files.push({ path, kind: 'current_configuration', sha256: hash(committed) })
    }
    next = { ...next, proposedPrd, proposedPrdSha256: hash(proposedPrd), files,
      allowedBindingOwnerPathsByRequirement: { ...item.allowedBindingOwnerPathsByRequirement,
        'REQ-001': item.allowedBindingOwnerPathsByRequirement['REQ-001'].map(paths => [...paths, targetPath]) },
      humanReview: null, releaseInput: null }
    updates.push({ projectId: project.id, caseId: next.caseId, previousProject: project, proposedPrd })
  } else assert.equal(next.proposedPrd, item.proposedPrd)
  cases.push(next)
}
assert.equal(updates.length, 2)
assert.equal(cases.length, 25)
await mkdir(destination)
await writeFile(join(destination, 'domain-before.json'), JSON.stringify(before, null, 2), { flag: 'wx', mode: 0o600 })
const packetPath = join(destination, 'review-inputs.json')
await writeFile(packetPath, JSON.stringify({ ...packet, cases, correction: { sourcePacket: previous.packetPath,
  authorization: '用户批准 2026-11-10 Zod 测量范围草案', changedCases: updates.map(update => update.caseId), other23SpecificationsUnchanged: true } }, null, 2), { flag: 'wx' })
for (const update of updates) {
  const project = update.previousProject
  const fields = ['name', 'summary', 'cwd', 'priority', 'owner', 'taskLanguage', 'technicalDesign']
  const input = Object.fromEntries(fields.filter(key => project[key] !== undefined).map(key => [key, project[key]]))
  const updated = await request(`/projects/${project.id}`, { ...input, prd: update.proposedPrd })
  assert.equal(updated.prd, update.proposedPrd.trim())
  assert.deepEqual(updated.taskIds, [])
  await writeFile(join(destination, `${project.id}-updated.json`), JSON.stringify({ previous: project, updated }, null, 2), { flag: 'wx', mode: 0o600 })
}
const projectsPath = join(destination, 'projects.json')
await writeFile(projectsPath, JSON.stringify({ ...previous, packetPath, projects: previous.projects.map(project => ({ ...project, caseId: rename(project.caseId) })),
  sourceProjectsPath: resolve(previousPath), createdProjects: 0, copiedAttestations: 0, modelRequests: 0,
  isolation: { projectIdsPreserved: true, approvedZodSourceRevisions: 2, other23SpecificationsUnchanged: true } }, null, 2), { flag: 'wx' })
const after = await request('/snapshot')
assert.deepEqual(after.agentCapabilityClaims, before.agentCapabilityClaims)
for (const key of ['planningOperations', 'tasks', 'taskRuns', 'planApprovalsV3', 'executionDispatches', 'deliveryRecords']) assert.deepEqual(after[key], before[key])
await writeFile(join(destination, 'domain-after.json'), JSON.stringify(after, null, 2), { flag: 'wx', mode: 0o600 })
console.log(JSON.stringify({ packetPath, projectsPath, changedProjects: updates.map(update => update.projectId), modelRequests: 0, trustedClaimsChanged: 0, dispatchedTasks: 0 }))
