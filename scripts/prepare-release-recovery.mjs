import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { createRequire } from 'node:module'
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises'
import { join, relative, resolve } from 'node:path'
import {
  AgentCapabilityClaimRecordSchema, AgentRecordSchema, CapabilityDefinitionRecordSchema,
  ProjectAgentMembershipRecordSchema, ProjectRecordSchema, buildRequirementSourceManifest,
  digestObject,
} from '../lib/index.js'

// 本脚本只重建原 ID 的评测草稿及原样登记回执，不恢复审批、任务、规划结果或交付成绩。
const [sourceHomeArgument, runtimeArgument, destinationArgument] = process.argv.slice(2)
assert.ok(sourceHomeArgument && runtimeArgument && destinationArgument,
  'Usage: node scripts/prepare-release-recovery.mjs <source-home> <isolated-runtime> <new-output-root>')
const evidenceRoot = resolve('output/acceptance')
const destination = resolve(destinationArgument)
const childPath = relative(evidenceRoot, destination)
assert.ok(childPath && !childPath.startsWith('..') && !childPath.startsWith('/'), 'Recovery must use a new directory under output/acceptance')
const sourceHome = resolve(sourceHomeArgument)
const runtimeRoot = resolve(runtimeArgument)
const harnessManifest = JSON.parse(await readFile(join(runtimeRoot, 'node_modules/@deepseek-ai/dsh/package.json'), 'utf8'))
assert.equal(harnessManifest.version, '0.2.2-rc.1')
const yaml = createRequire(join(runtimeRoot, 'node_modules/@deepseek-ai/dsh/package.json'))('js-yaml')
const now = new Date().toISOString()
const sources = []
const hash = bytes => createHash('sha256').update(bytes).digest('hex')

/** 保留每个恢复输入的字节摘要，缺失或畸形文件立即终止，禁止用默认记录补齐。 */
async function evidence(path) {
  const absolute = resolve(path)
  const bytes = await readFile(absolute)
  sources.push({ path: absolute, sha256: hash(bytes) })
  return JSON.parse(bytes)
}

const prepared = await evidence(join(evidenceRoot, 'release-tool-fault-v34-projects-2026-10-17.json'))
const packet = await evidence(prepared.packetPath)
assert.equal(prepared.projects.length, 25)
assert.equal(packet.cases.length, 25)
const registrations = await Promise.all([
  evidence(join(evidenceRoot, 'release-capabilities-confirmed-2026-10-16.json')),
  evidence(join(evidenceRoot, 'release-capability-addendum-52-confirmed-2026-10-16.json')),
])
assert.deepEqual(registrations.map(item => item.confirmedCount), [204, 52])
assert.ok(registrations.every(item => item.status === 'confirmed_and_persisted'))
const claims = registrations.flatMap(report => report.projects.flatMap(project => project.claims))
assert.equal(new Set(claims.map(claim => claim.id)).size, 256)
for (const report of registrations) for (const claim of report.projects.flatMap(project => project.claims)) {
  AgentCapabilityClaimRecordSchema.parse(claim)
  const { id, claimDigest, ...core } = claim
  assert.equal(digestObject({ ...core, reason: report.authorization.reason }), claimDigest)
  assert.equal(claim.source, 'human_confirmed')
  assert.equal(claim.status, 'active')
}

const previews = new Map()
for (const entry of await readdir(evidenceRoot, { withFileTypes: true })) {
  const directory = entry.name
  if (!entry.isDirectory() || !directory.startsWith('release-tool-fault-v34-') || !directory.includes('-gold-review-')) continue
  for (const file of await readdir(join(evidenceRoot, directory))) {
    if (!file.endsWith('.input.json')) continue
    const input = await evidence(join(evidenceRoot, directory, file))
    assert.equal(previews.has(input.originalSpecification.caseId), false, 'Ambiguous recovery preview')
    previews.set(input.originalSpecification.caseId, input)
  }
}
assert.equal(previews.size, 25)

const tables = { agents: {}, projects: {}, resources: {}, project_agent_memberships: {}, capability_definitions: {}, agent_capability_claims: {} }
const personas = {
  implementer: 'Prepare bounded library implementation plans grounded in frozen source and contracts.',
  verifier: 'Independently verify each requirement and compatibility boundary using the existing test and typecheck tools.',
  reviewer: 'Independently review source-grounded scenario coverage, bindings and plans. Preserve real business risks and reject unsupported evidence. Never imply executor eligibility.',
}

for (const record of prepared.projects) {
  const item = packet.cases.find(item => item.caseId === record.caseId)
  const input = previews.get(record.caseId)
  assert.ok(item && input)
  assert.deepEqual(input.originalSpecification, item)
  assert.equal(input.preview.projectId, record.projectId)
  assert.equal(hash(item.proposedPrd), item.proposedPrdSha256)
  const prd = item.proposedPrd.trim()
  const manifest = buildRequirementSourceManifest({ prd, technicalDesign: '', sourceRefs: [], sourceBlocks: [] }, { requireAllBlocks: true })
  assert.deepEqual(manifest, input.preview.sourceManifest)
  const facts = input.preview.teamCatalogFacts
  for (const member of facts.members) {
    const role = member.deliveryRoles[0]
    assert.ok(personas[role])
    assert.equal(digestObject(personas[role]), member.personaDigest)
    assert.equal(digestObject([]), member.skillsDigest)
    const agent = AgentRecordSchema.parse({ id: member.agentId,
      name: prepared.agents.find(agent => agent.id === member.agentId)?.name ?? 'Recovered isolated planning Reviewer',
      role: role === 'implementer' ? 'Software Engineer' : role === 'verifier' ? 'Test Engineer' : 'Code Reviewer',
      description: 'Recovered isolated benchmark configuration; creation times describe reconstruction only.',
      persona: personas[role], preset: 'standard', toolPolicy: 'full', skills: [], capabilities: member.capabilities,
      provider: 'pockapi', model: 'gpt-6.1-sol', access: 'only_me', maxConcurrency: member.maxConcurrency,
      status: 'active', createdAt: now, updatedAt: now,
    })
    if (tables.agents[agent.id]) assert.deepEqual(tables.agents[agent.id], agent)
    tables.agents[agent.id] = agent
  }
  for (const definition of facts.definitions) {
    CapabilityDefinitionRecordSchema.parse(definition)
    const { definitionDigest, ...core } = definition
    assert.equal(digestObject(core), definitionDigest)
    if (tables.capability_definitions[definition.id]) assert.deepEqual(tables.capability_definitions[definition.id], definition)
    tables.capability_definitions[definition.id] = definition
  }
  for (const projectId of new Set(Object.values(record.projectIdsByRun ?? { first: record.projectId }))) {
    assert.equal(tables.projects[projectId], undefined)
    const cwd = resolve('output/acceptance/repositories', item.repositoryIdentity.split('/')[1])
    const resourceId = `recovery-resource:${projectId}`
    tables.projects[projectId] = ProjectRecordSchema.parse({ id: projectId, name: `release-recovery/${item.caseId}`,
      summary: '', cwd, prd, technicalDesign: '', taskLanguage: 'zh-CN', priority: 'medium', owner: '',
      status: 'draft', revision: 1, taskIds: [], resourceIds: [resourceId], issueIds: [], deliveryStage: 'planning',
      createdAt: now, updatedAt: now,
    })
    tables.resources[resourceId] = { id: resourceId, projectId, kind: 'local_directory', location: cwd,
      executionMode: 'in_place', createdAt: now, updatedAt: now }
    for (const membership of facts.memberships) {
      const id = `${projectId}:${membership.agentId}`
      tables.project_agent_memberships[id] = ProjectAgentMembershipRecordSchema.parse({ id, projectId, ...membership,
        status: 'active', joinedAt: now, updatedAt: now })
    }
  }
  // 只恢复仍未确认的旧声明，原已确认回执随后按自身 ID 原样写入。
  for (const claim of record.pendingClaims) {
    AgentCapabilityClaimRecordSchema.parse(claim)
    assert.equal(claim.status, 'pending')
    const { id, claimDigest, ...core } = claim
    assert.equal(digestObject(core), claimDigest)
    tables.agent_capability_claims[claim.id] = claim
  }
}
for (const claim of claims) {
  assert.ok(tables.projects[claim.projectId] && tables.agents[claim.agentId] && tables.capability_definitions[claim.capabilityId])
  tables.agent_capability_claims[claim.id] = claim
}
const projectCount = new Set(prepared.projects.flatMap(record => Object.values(record.projectIdsByRun ?? { first: record.projectId }))).size
assert.equal(Object.keys(tables.projects).length, projectCount)

// 仅复制用户当前已配置网关的引用凭据；报告及 stdout 永远不包含凭据内容。
const userPatch = yaml.load(await readFile(join(sourceHome, 'profiles/web/cordis.patch.yml'), 'utf8'))
const provider = userPatch.find(item => item.id === 'llm-pi-ai')?.config?.providers?.pockapi
assert.equal(provider?.baseURL?.replace(/\/$/u, ''), 'http://47.253.229.128:18080/v1')
assert.ok(provider.models.some(model => (typeof model === 'string' ? model : model.id) === 'gpt-6.1-sol'))
const credentials = yaml.load(await readFile(join(sourceHome, '.credentials.yaml'), 'utf8'))
assert.equal(typeof credentials.refs?.[provider.apiKeyEnv], 'string')
const home = join(destination, 'home')
const patchPath = join(destination, 'acceptance.patch.yml')
const patch = [{ insert: [{ id: 'project-orchestrator', name: join(runtimeRoot, 'node_modules/dsh-project-orchestrator/lib/index.js') }] },
  { id: 'llm-pi-ai', config: { providers: { pockapi: provider } } },
  { id: 'agent-default-model', config: { provider: 'pockapi', model: 'gpt-6.1-sol' } },
  { id: 'session-title-llm', disabled: true }]
await mkdir(destination, { mode: 0o700 })
await mkdir(join(home, 'storages'), { recursive: true, mode: 0o700 })
await writeFile(join(home, '.credentials.yaml'), yaml.dump({ version: credentials.version, refs: { [provider.apiKeyEnv]: credentials.refs[provider.apiKeyEnv] }, records: {} }), { flag: 'wx', mode: 0o600 })
await writeFile(patchPath, yaml.dump(patch), { flag: 'wx', mode: 0o600 })
await writeFile(join(home, 'storages/project_orchestrator.json'), JSON.stringify({ unit: { name: 'project_orchestrator', version: 1 }, global: null, tables }, null, 2), { flag: 'wx', mode: 0o600 })
const report = { status: 'draft_inputs_reconstructed_not_qualified', root: destination, home, runtimeRoot,
  profile: join(home, 'profiles/web'), modelConfigPath: patchPath, modelProvider: 'pockapi', modelId: 'gpt-6.1-sol',
  harnessVersion: harnessManifest.version, reconstructedAt: now, sources, projectCount, restoredClaimCount: 256,
  newHumanConfirmations: 0, restoredPlanningOperations: 0, restoredTaskRuns: 0, restoredApprovals: 0, restoredDeliveryRecords: 0,
  historicalEvidenceRoot: evidenceRoot, projectsSource: resolve('output/acceptance/release-tool-fault-v34-projects-2026-10-17.json') }
await writeFile(join(destination, 'recovery.json'), JSON.stringify(report, null, 2), { flag: 'wx', mode: 0o600 })
console.log(JSON.stringify({ status: report.status, contextPath: join(destination, 'recovery.json'), projectCount, restoredClaimCount: 256, newHumanConfirmations: 0 }))
