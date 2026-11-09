import assert from 'node:assert/strict'
import { readFile, writeFile } from 'node:fs/promises'
import { resolve, join } from 'node:path'

const base = 'http://127.0.0.1:3087/project-orchestrator/api'
const projectId = 'ac9fafa7-c07b-4802-a177-6f4c986130bc'
const prepared = JSON.parse(await readFile(resolve('output/acceptance/isolated-harness-2026-10-14.json'), 'utf8'))
const get = async path => {
  const response = await fetch(`${base}${path}`, { signal: AbortSignal.timeout(30_000) })
  const data = await response.json()
  if (!response.ok) throw new Error(`${path}: HTTP ${response.status}: ${data.error?.code ?? 'unknown'}`)
  return data
}
const [snapshot, planning, claims] = await Promise.all([
  get('/snapshot'), get(`/projects/${projectId}/planning`), get(`/projects/${projectId}/capability-claims`),
])
const project = snapshot.projects.find(item => item.id === projectId)
assert.equal(project?.cwd, join(prepared.root, 'workspaces/greeting'))
assert.equal(planning.operation.status, 'blocked')
assert.equal(planning.operation.stage, 'assignment_qualification')
const operationId = planning.operation.id
const requirements = snapshot.capabilityRequirementDrafts.filter(item => item.operationId === operationId)
assert.equal(requirements.length, 2)
assert.equal(requirements.every(item => item.derivationRuleVersion === 'v3.3.14'), true)
const reviews = Object.fromEntries(['requirementReview', 'scenarioCoverageReview', 'bindingReview', 'planReview'].map(key => [key, planning[key]]))
assert.equal(Object.values(reviews).every(item => item?.status === 'approved'), true)
const pending = claims.filter(item => item.status === 'pending' && item.source === 'legacy_pending_mapping')
const requiredIds = new Set(requirements.flatMap(item => item.requiredCapabilities))
const relevantPending = pending.filter(item => requiredIds.has(item.capabilityId))
assert.equal(claims.some(item => item.status === 'active' && ['human_confirmed', 'managed_registry'].includes(item.source)), false)
const report = {
  observedAt: new Date().toISOString(), baseUrl: 'http://127.0.0.1:3087', projectId, operationId,
  operation: planning.operation, projectStatus: project.status, requirements, reviews,
  bindings: planning.requirements, assignments: planning.assignments, assignmentEvaluations: planning.assignmentEvaluations,
  pendingClaims: relevantPending,
  definitions: snapshot.capabilityDefinitions.filter(item => requiredIds.has(item.id)),
  modelProvenance: planning.operation.modelExecutionProvenance,
  trustedClaimsCreated: 0, approvalRecorded: false, dispatchRecorded: false,
}
await writeFile(resolve('output/acceptance/canary-capability-review-revised-2026-10-15.json'), `${JSON.stringify(report, null, 2)}\n`)
console.log(JSON.stringify({ projectId, operationId, taskCapabilities: requirements.map(item => ({ taskKey: item.taskKey, requiredRoles: item.requiredRoles, requiredCapabilities: item.requiredCapabilities })), pendingCount: relevantPending.length, trustedClaimsCreated: 0 }))
