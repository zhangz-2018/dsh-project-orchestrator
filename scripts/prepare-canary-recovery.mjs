import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { createRequire } from 'node:module'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join, relative, resolve } from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { AgentCapabilityClaimRecordSchema, AgentRecordSchema, CapabilityDefinitionRecordSchema, DEFAULT_AGENT_SEEDS,
  ProjectAgentMembershipRecordSchema, ProjectRecordSchema, ProjectResourceSchema, digestObject } from '../lib/index.js'

// 只在新 home 恢复原项目的九条原始能力事实；工作树是明确标记的重建基线，绝不恢复旧审批或交付成绩。
const [contextArgument, workspaceArgument, destinationArgument] = process.argv.slice(2)
assert.ok(contextArgument && workspaceArgument && destinationArgument)
const context = JSON.parse(await readFile(resolve(contextArgument), 'utf8'))
const workspace = resolve(workspaceArgument)
const destination = resolve(destinationArgument)
for (const path of [workspace, destination]) {
  const child = relative(resolve('output/acceptance'), path)
  assert.ok(child && !child.startsWith('..') && !child.startsWith('/'), 'Canary recovery must remain in the isolated acceptance directory')
}
const hash = bytes => createHash('sha256').update(bytes).digest('hex')
const run = promisify(execFile)
const git = async args => (await run('git', args, { cwd: workspace, timeout: 30_000 })).stdout.trim()
assert.equal(await git(['rev-parse', '--show-toplevel']), workspace, 'Canary workspace must be its own repository, never the parent product checkout')
assert.equal(await git(['status', '--porcelain']), '', 'Commit the reviewed reconstructed baseline before creating its home')
const baselineCommit = await git(['rev-parse', 'HEAD'])
assert.notEqual(baselineCommit, '6c046d7e11150f45ac9767146708663614803a1f', 'Reconstructed fixture must not masquerade as the lost original history')
const sources = []
/** 原样读取并记录恢复来源摘要；缺失证据立即失败，不能按角色补填人工能力。 */
async function evidence(path) {
  const bytes = await readFile(resolve(path))
  sources.push({ path, sha256: hash(bytes) })
  return JSON.parse(bytes)
}
const registration = await evidence('output/acceptance/canary-capabilities-confirmed-2026-10-15.json')
const reviewed = await evidence('output/acceptance/canary-capability-review-revised-2026-10-15.json')
const projectId = registration.projectId
assert.equal(projectId, 'ac9fafa7-c07b-4802-a177-6f4c986130bc')
assert.equal(registration.persisted, true)
assert.equal(registration.result.claims.length, 9)
const now = new Date().toISOString()
const tables = { agents: {}, projects: {}, resources: {}, project_agent_memberships: {}, capability_definitions: {}, agent_capability_claims: {} }
for (const definition of reviewed.definitions) {
  CapabilityDefinitionRecordSchema.parse(definition)
  const { definitionDigest, ...core } = definition
  assert.equal(digestObject(core), definitionDigest)
  tables.capability_definitions[definition.id] = definition
}
const roles = { 'default-agent-delivery-planner': 'planner', 'default-agent-software-engineer': 'implementer',
  'default-agent-test-engineer': 'verifier', 'default-agent-code-reviewer': 'reviewer' }
for (const [agentId, deliveryRole] of Object.entries(roles)) {
  const seed = DEFAULT_AGENT_SEEDS.find(seed => seed.id === agentId)
  assert.ok(seed)
  const scoped = registration.result.claims.filter(claim => claim.agentId === agentId)
  tables.agents[agentId] = AgentRecordSchema.parse({ id: agentId, ...seed.input,
    capabilities: [...new Set([...seed.input.capabilities, ...scoped.map(claim => claim.capabilityId)])],
    provider: 'pockapi', model: 'gpt-6.1-sol', status: 'active', createdAt: now, updatedAt: now })
  const id = `${projectId}:${agentId}`
  tables.project_agent_memberships[id] = ProjectAgentMembershipRecordSchema.parse({ id, projectId, agentId, projectRole: seed.input.role,
    deliveryRoles: [deliveryRole], autoAssignable: ['implementer', 'verifier'].includes(deliveryRole), status: 'active',
    joinedBy: 'isolated canary reconstruction configuration', joinedAt: now, updatedAt: now })
}
for (const claim of registration.result.claims) {
  AgentCapabilityClaimRecordSchema.parse(claim)
  assert.equal(claim.projectId, projectId)
  assert.equal(claim.source, 'human_confirmed')
  assert.equal(claim.status, 'active')
  assert.ok(tables.agents[claim.agentId] && tables.capability_definitions[claim.capabilityId])
  const { id, claimDigest, ...core } = claim
  assert.equal(digestObject({ ...core, reason: registration.authorization.reason }), claimDigest)
  tables.agent_capability_claims[id] = claim
}
const resourceId = `reconstructed-canary-resource:${projectId}`
tables.resources[resourceId] = ProjectResourceSchema.parse({ id: resourceId, projectId, kind: 'local_directory', location: workspace,
  executionMode: 'in_place', createdAt: now, updatedAt: now })
tables.projects[projectId] = ProjectRecordSchema.parse({ id: projectId, name: 'Formal 1.7.0 reconstructed greeting canary', summary: '', cwd: workspace,
  prd: registration.result.project.prd, technicalDesign: registration.result.project.technicalDesign, taskLanguage: 'zh-CN', priority: 'medium', owner: '',
  status: 'draft', revision: 1, taskIds: [], resourceIds: [resourceId], issueIds: [], deliveryStage: 'planning', createdAt: now, updatedAt: now })
const yaml = createRequire(join(context.runtimeRoot, 'node_modules/@deepseek-ai/dsh/package.json'))('js-yaml')
const patch = yaml.load(await readFile(context.modelConfigPath, 'utf8'))
const provider = patch.find(item => item.id === 'llm-pi-ai').config.providers.pockapi
assert.equal(provider.baseURL.replace(/\/$/u, ''), context.modelBaseURL)
assert.equal(provider.api, context.modelApi)
const credentials = yaml.load(await readFile(join(context.home, '.credentials.yaml'), 'utf8'))
assert.equal(typeof credentials.refs[provider.apiKeyEnv], 'string')
await mkdir(destination, { mode: 0o700 })
const home = join(destination, 'home')
await mkdir(join(home, 'storages'), { recursive: true, mode: 0o700 })
await writeFile(join(home, '.credentials.yaml'), yaml.dump({ version: credentials.version, refs: { [provider.apiKeyEnv]: credentials.refs[provider.apiKeyEnv] }, records: {} }), { flag: 'wx', mode: 0o600 })
const modelConfigPath = join(destination, 'canary.patch.yml')
await writeFile(modelConfigPath, yaml.dump(patch), { flag: 'wx', mode: 0o600 })
await writeFile(join(home, 'storages/project_orchestrator.json'), JSON.stringify({ unit: { name: 'project_orchestrator', version: 1 }, global: null, tables }, null, 2), { flag: 'wx', mode: 0o600 })
const report = { status: 'reconstructed_canary_draft_not_qualified', reconstructedAt: now, projectId, workspace, baselineCommit,
  home, modelConfigPath, runtimeRoot: context.runtimeRoot, sources, restoredOriginalClaims: 9, newHumanConfirmations: 0,
  restoredApprovals: 0, restoredTaskRuns: 0, restoredDeliveryRecords: 0, baselineIsReconstructed: true,
  currentBundleSha256: hash(await readFile(join(context.runtimeRoot, 'node_modules/dsh-project-orchestrator/lib/index.js'))) }
await writeFile(join(destination, 'context.json'), JSON.stringify(report, null, 2), { flag: 'wx', mode: 0o600 })
console.log(JSON.stringify({ ...report, sources: undefined }))
