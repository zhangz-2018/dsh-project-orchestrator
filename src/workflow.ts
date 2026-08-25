import { createHash, randomUUID } from 'node:crypto'
import {
  GeneratedPlanSchema,
  PlannerResultSchema,
  TaskAssignmentPolicySchema,
  type GeneratedPlan,
  type PlannerResult,
  type ProjectRecord,
  type TaskRecord,
  type TeamCompositionSnapshot,
} from './types.js'

export class WorkflowError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status = 409,
  ) {
    super(message)
    this.name = 'WorkflowError'
  }
}

export function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize)
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, entry]) => [key, canonicalize(entry)]),
    )
  }
  return value
}

export function digestObject(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(canonicalize(value))).digest('hex')
}

export function assignmentDigest(tasks: TaskRecord[]): string {
  return digestObject([...tasks]
    .sort((left, right) => left.ordinal - right.ordinal || left.id.localeCompare(right.id))
    .map((task) => ({
      taskId: task.id,
      agentId: task.agentId ?? null,
      assignmentPolicy: task.assignmentPolicy ?? null,
      sourceRequirementIds: task.sourceRequirementIds ?? [],
      acceptanceIds: task.acceptanceIds ?? [],
      relationship: task.relationship ?? null,
    })))
}

export function teamCompositionDigest(snapshot: Omit<TeamCompositionSnapshot, 'teamDigest' | 'capturedAt'>): string {
  return digestObject({
    ...snapshot,
    members: snapshot.members
      .map(({ availableSlots: _availableSlots, ...member }) => ({ ...member, capabilities: [...member.capabilities].sort() }))
      .sort((left, right) => left.agentId.localeCompare(right.agentId)),
    squads: snapshot.squads
      .map((squad) => ({ ...squad, memberAgentIds: [...squad.memberAgentIds].sort() }))
      .sort((left, right) => left.squadId.localeCompare(right.squadId)),
  })
}

export function boundedText(value: string, maxBytes = 64_000): string {
  const bytes = Buffer.from(value)
  if (bytes.byteLength <= maxBytes) return value
  const marker = '\n... output truncated; showing final bytes ...\n'
  const markerBytes = Buffer.byteLength(marker)
  return marker + bytes.subarray(bytes.byteLength - Math.max(0, maxBytes - markerBytes)).toString('utf8')
}

export function planDigest(project: ProjectRecord, tasks: TaskRecord[]): string {
  const hasExecutionMetadata = project.priority !== undefined
    || project.owner !== undefined
    || project.teamDigest !== undefined
    || project.assignmentDigest !== undefined
    || project.requirementDigest !== undefined
    || project.decisionDigest !== undefined
    || tasks.some((task) => task.priority !== undefined || task.tags !== undefined || task.assignmentPolicy !== undefined || task.sourceRequirementIds !== undefined || task.acceptanceIds !== undefined)
  const payload = {
    projectId: project.id,
    revision: project.revision,
    cwd: project.cwd,
    ...(hasExecutionMetadata
      ? {
          priority: project.priority ?? 'medium',
          owner: project.owner ?? '',
          ...(project.teamDigest === undefined ? {} : { teamDigest: project.teamDigest }),
          ...(project.assignmentDigest === undefined ? {} : { assignmentDigest: project.assignmentDigest }),
          ...(project.requirementDigest === undefined ? {} : { requirementDigest: project.requirementDigest }),
          ...(project.decisionDigest === undefined ? {} : { decisionDigest: project.decisionDigest }),
        }
      : {}),
    taskIds: project.taskIds,
    tasks: [...tasks]
      .sort((left, right) => left.ordinal - right.ordinal || left.id.localeCompare(right.id))
      .map((task) => ({
        id: task.id,
        ordinal: task.ordinal,
        title: task.title,
        kind: task.kind,
        description: task.description,
        acceptanceCriteria: task.acceptanceCriteria,
        dependencies: [...task.dependencies].sort(),
        ...(hasExecutionMetadata
          ? { priority: task.priority ?? 'medium', tags: [...(task.tags ?? [])].sort() }
          : {}),
        ...(task.sourceRequirementIds === undefined ? {} : { sourceRequirementIds: [...task.sourceRequirementIds].sort() }),
        ...(task.acceptanceIds === undefined ? {} : { acceptanceIds: [...task.acceptanceIds].sort() }),
        ...(task.assignmentPolicy === undefined ? {} : { assignmentPolicy: TaskAssignmentPolicySchema.parse(task.assignmentPolicy) }),
        ...(task.assignmentDigest === undefined ? {} : { assignmentDigest: task.assignmentDigest }),
        ...(task.teamDigest === undefined ? {} : { teamDigest: task.teamDigest }),
        ...(task.relationship === undefined ? {} : { relationship: task.relationship }),
        agentId: task.agentId ?? null,
        testCommand: task.testCommand,
      })),
  }
  return createHash('sha256').update(JSON.stringify(canonicalize(payload))).digest('hex')
}

export function topologicalTasks<T extends Pick<TaskRecord, 'id' | 'dependencies' | 'ordinal'>>(tasks: T[]): T[] {
  const byId = new Map(tasks.map((task) => [task.id, task]))
  if (byId.size !== tasks.length) {
    throw new WorkflowError('duplicate-task-id', 'Task ids must be unique.', 400)
  }

  const indegree = new Map(tasks.map((task) => [task.id, 0]))
  const outgoing = new Map(tasks.map((task) => [task.id, [] as string[]]))
  for (const task of tasks) {
    const uniqueDependencies = new Set(task.dependencies)
    if (uniqueDependencies.size !== task.dependencies.length) {
      throw new WorkflowError('duplicate-dependency', `Task "${task.id}" has duplicate dependencies.`, 400)
    }
    for (const dependency of uniqueDependencies) {
      if (dependency === task.id) {
        throw new WorkflowError('self-dependency', `Task "${task.id}" depends on itself.`, 400)
      }
      if (!byId.has(dependency)) {
        throw new WorkflowError('unknown-dependency', `Task "${task.id}" depends on unknown task "${dependency}".`, 400)
      }
      indegree.set(task.id, (indegree.get(task.id) ?? 0) + 1)
      outgoing.get(dependency)?.push(task.id)
    }
  }

  const ready = tasks
    .filter((task) => indegree.get(task.id) === 0)
    .sort((left, right) => left.ordinal - right.ordinal || left.id.localeCompare(right.id))
  const ordered: T[] = []
  while (ready.length > 0) {
    const current = ready.shift()
    if (current === undefined) break
    ordered.push(current)
    for (const dependentId of outgoing.get(current.id) ?? []) {
      const next = (indegree.get(dependentId) ?? 0) - 1
      indegree.set(dependentId, next)
      if (next === 0) {
        const dependent = byId.get(dependentId)
        if (dependent !== undefined) {
          ready.push(dependent)
          ready.sort((left, right) => left.ordinal - right.ordinal || left.id.localeCompare(right.id))
        }
      }
    }
  }

  if (ordered.length !== tasks.length) {
    throw new WorkflowError('dependency-cycle', 'Task dependencies contain a cycle.', 400)
  }
  return ordered
}

function repairInvalidStringEscapes(raw: string): string {
  let output = ''
  let quoted = false
  for (let index = 0; index < raw.length; index += 1) {
    const character = raw[index]
    if (character === '"' && raw[index - 1] !== '\\') { quoted = !quoted; output += character; continue }
    if (quoted && character === '\\') {
      const next = raw[index + 1]
      if (next !== '"' && next !== '\\' && next !== '/' && next !== 'b' && next !== 'f' && next !== 'n' && next !== 'r' && next !== 't' && next !== 'u') output += '\\\\'
      else output += character
      continue
    }
    output += character
  }
  return output
}

function extractJsonObject(raw: string): string | undefined {
  let start = -1
  let depth = 0
  let quoted = false
  let escaped = false
  for (let index = 0; index < raw.length; index += 1) {
    const character = raw[index]
    if (quoted) {
      if (escaped) escaped = false
      else if (character === '\\') escaped = true
      else if (character === '"') quoted = false
      continue
    }
    if (character === '"') { quoted = true; continue }
    if (character === '{') { if (depth === 0) start = index; depth += 1; continue }
    if (character === '}' && depth > 0) {
      depth -= 1
      if (depth === 0 && start >= 0) {
        const candidate = raw.slice(start, index + 1)
        if (raw.slice(0, start).trim() && !raw.slice(0, start).includes('json')) return candidate
        return candidate
      }
    }
  }
  return undefined
}

function parsePlannerJson(raw: string): unknown {
  const unfenced = raw.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim()
  try {
    return JSON.parse(unfenced)
  } catch {
    const candidate = extractJsonObject(unfenced)
    if (candidate === undefined) throw new WorkflowError('invalid-plan-json', 'Planner did not return a JSON plan.', 422)
    try {
      return JSON.parse(candidate)
    } catch (error) {
      try {
        return JSON.parse(repairInvalidStringEscapes(candidate))
      } catch {
        throw new WorkflowError(
          'invalid-plan-json',
          `Planner did not return valid JSON: ${error instanceof Error ? error.message : String(error)}`,
          422,
        )
      }
    }
  }
}

function validateReadyPlan(plan: GeneratedPlan): GeneratedPlan {
  if (!plan.tasks.some((task) => task.kind === 'code')) {
    throw new WorkflowError('missing-code-task', 'Generated plan must include at least one code task.', 422)
  }
  if (!plan.tasks.some((task) => task.kind === 'test')) {
    throw new WorkflowError('missing-test-task', 'Generated plan must include at least one test task.', 422)
  }
  topologicalTasks(plan.tasks.map((task, ordinal) => ({ ...task, ordinal })))
  return plan
}

export function parseGeneratedPlan(raw: string): GeneratedPlan {
  return validateReadyPlan(GeneratedPlanSchema.parse(parsePlannerJson(raw)))
}

export function parsePlannerResult(raw: string): PlannerResult {
  const result = PlannerResultSchema.parse(parsePlannerJson(raw))
  if (result.status === 'blocked') return result
  validateReadyPlan(result)
  const commandSet = new Set(result.repositoryEvidence.verifiedCommands)
  const unverified = result.tasks.find((task) => !commandSet.has(task.testCommand))
  if (unverified !== undefined) throw new WorkflowError('unverified-test-command', `Task "${unverified.id}" uses a verification command that is absent from repository evidence.`, 422)
  const missingEvidence = result.tasks.find((task) => task.evidenceRefs === undefined || task.evidenceRefs.length === 0)
  if (missingEvidence !== undefined) throw new WorkflowError('task-evidence-required', `Task "${missingEvidence.id}" requires repository evidence references.`, 422)
  return result
}

export function materializeTasks(
  projectId: string,
  plan: GeneratedPlan,
  agents: Array<{ id: string; role: string; projectRole?: string; capabilities?: string[]; autoAssignable?: boolean; status?: 'active' | 'removed'; runtimeStatus?: 'online' | 'offline' | 'unstable' | 'unknown'; availableSlots?: number }>,
  now = new Date().toISOString(),
  ordinalOffset = 0,
): TaskRecord[] {
  const ids = new Map(plan.tasks.map((task) => [task.id, randomUUID()]))
  return plan.tasks.map((task, ordinal) => {
    const suggestedRole = task.suggestedAgentRole.toLocaleLowerCase()
    const hasDeclaredPolicy = task.assignmentPolicy !== undefined
    const policy = TaskAssignmentPolicySchema.parse(task.assignmentPolicy ?? {
      mode: 'single_agent',
      riskLevel: 'low',
      requiredRoles: [],
      requiredCapabilities: [],
      allowedAgentIds: [],
      allowedSquadIds: [],
      requiresIndependentReviewer: false,
      maxParallel: 1,
      conflictKeys: [],
      allowedScope: [],
      forbiddenScope: [],
      escalationConditions: [],
    })
    const eligible = agents.filter((agent) => {
      if (agent.autoAssignable === false || agent.status === 'removed') return false
      if (agent.runtimeStatus !== undefined && agent.runtimeStatus !== 'online') return false
      if (agent.availableSlots !== undefined && agent.availableSlots <= 0) return false
      if (policy?.allowedAgentIds.length && !policy.allowedAgentIds.includes(agent.id)) return false
      const role = (agent.projectRole?.trim() || agent.role).toLocaleLowerCase()
      if (policy?.requiredRoles.some((required) => !role.includes(required.toLocaleLowerCase()))) return false
      if (policy?.requiredCapabilities.some((required) => !(agent.capabilities ?? []).some((capability) => capability.toLocaleLowerCase() === required.toLocaleLowerCase()))) return false
      return true
    })
    const ranked = [...eligible].sort((left, right) => {
      const roleRank = (agent: (typeof agents)[number]) => {
        const role = (agent.projectRole?.trim() || agent.role).toLocaleLowerCase()
        const exactSuggested = role === suggestedRole ? 1 : 0
        const relatedSuggested = role.includes(suggestedRole) || suggestedRole.includes(role) ? 1 : 0
        const exactRequired = policy?.requiredRoles.filter((required) => role === required.toLocaleLowerCase()).length ?? 0
        return { exactSuggested, relatedSuggested, exactRequired }
      }
      const leftRank = roleRank(left)
      const rightRank = roleRank(right)
      const suggestedDifference = rightRank.exactSuggested - leftRank.exactSuggested
      if (suggestedDifference !== 0) return suggestedDifference
      const relatedDifference = rightRank.relatedSuggested - leftRank.relatedSuggested
      if (relatedDifference !== 0) return relatedDifference
      const requiredDifference = rightRank.exactRequired - leftRank.exactRequired
      if (requiredDifference !== 0) return requiredDifference
      const slotDifference = (right.availableSlots ?? 0) - (left.availableSlots ?? 0)
      return slotDifference || left.id.localeCompare(right.id)
    })
    const suggested = ranked.find((agent) => task.suggestedAgentId === agent.id)
    const assigned = suggested ?? ranked.find((agent) => {
      const role = (agent.projectRole?.trim() || agent.role).toLocaleLowerCase()
      return role.includes(suggestedRole) || suggestedRole.includes(role)
    }) ?? (hasDeclaredPolicy ? ranked[0] : undefined)
    return {
      id: ids.get(task.id) ?? randomUUID(),
      projectId,
      ordinal: ordinal + ordinalOffset,
      title: task.title,
      kind: task.kind,
      description: task.description,
      acceptanceCriteria: task.acceptanceCriteria,
      dependencies: task.dependencies.map((dependency) => ids.get(dependency) ?? dependency),
      priority: 'medium',
      tags: [],
      ...(assigned === undefined ? {} : { agentId: assigned.id }),
      assignmentSource: suggested === undefined ? 'automatic_match' : 'planner_recommendation',
      testCommand: task.testCommand,
      ...(task.sourceRequirementIds === undefined ? {} : { sourceRequirementIds: task.sourceRequirementIds }),
      ...(task.acceptanceIds === undefined ? {} : { acceptanceIds: task.acceptanceIds }),
      assignmentPolicy: policy,
      ...(task.relationship === undefined ? {} : { relationship: task.relationship }),
      status: 'draft',
      createdAt: now,
      updatedAt: now,
    }
  })
}

export function assertExecutable(
  project: ProjectRecord,
  tasks: TaskRecord[],
  approval: { revision: number; planHash: string } | undefined,
  memberships?: Array<{ agentId: string; active: boolean }>,
  agents?: Array<{ id: string; role: string; projectRole?: string; capabilities?: string[]; status?: 'active' | 'archived' }>,
  team?: TeamCompositionSnapshot,
): void {
  if (project.status !== 'approved' && project.status !== 'failed' && project.status !== 'cancelled') {
    throw new WorkflowError('project-not-approved', 'Project must be approved before execution.')
  }
  if (tasks.length === 0) {
    throw new WorkflowError('empty-plan', 'Project has no tasks to execute.')
  }
  if (!tasks.some((task) => task.kind === 'code') || !tasks.some((task) => task.kind === 'test')) {
    throw new WorkflowError('incomplete-plan', 'Execution requires at least one code task and one test task.')
  }
  topologicalTasks(tasks)
  if (tasks.some((task) => task.testCommand.trim() === '')) {
    throw new WorkflowError('missing-test-command', 'Every task requires a test command.')
  }
  if (memberships !== undefined) {
    if (tasks.some((task) => task.agentId === undefined)) throw new WorkflowError('project-task-unassigned', 'Every task requires an assigned project Agent before execution.')
    const activeAgentIds = new Set(memberships.filter((membership) => membership.active).map((membership) => membership.agentId))
    const invalid = tasks.find((task) => !activeAgentIds.has(task.agentId!))
    if (invalid !== undefined) throw new WorkflowError('project-agent-not-member', `Task "${invalid.id}" Agent is not an active project member.`)
  }
  if (agents !== undefined) {
    for (const task of tasks) {
      const policy = task.assignmentPolicy
      if (policy === undefined) continue
      const assigned = agents.find((agent) => agent.id === task.agentId)
      if (assigned === undefined || assigned.status === 'archived') throw new WorkflowError('assignment-agent-inactive', `Task "${task.id}" references an unavailable Agent.`)
      if (policy.allowedAgentIds.length > 0 && !policy.allowedAgentIds.includes(assigned.id)) throw new WorkflowError('assignment-agent-not-allowed', `Task "${task.id}" is assigned outside its allowed Agent set.`)
      const role = (assigned.projectRole?.trim() || assigned.role).toLocaleLowerCase()
      const missingRole = policy.requiredRoles.find((required) => !role.includes(required.toLocaleLowerCase()))
      if (missingRole !== undefined) throw new WorkflowError('assignment-role-mismatch', `Task "${task.id}" requires role "${missingRole}".`)
      const missingCapability = policy.requiredCapabilities.find((required) => !(assigned.capabilities ?? []).some((capability) => capability.toLocaleLowerCase() === required.toLocaleLowerCase()))
      if (missingCapability !== undefined) throw new WorkflowError('assignment-capability-missing', `Task "${task.id}" requires capability "${missingCapability}".`)
      if (policy.mode === 'squad_delegation' && policy.allowedSquadIds.length === 0) throw new WorkflowError('assignment-squad-required', `Task "${task.id}" requires a Squad but no allowed Squad is configured.`)
      if (policy.requiresIndependentReviewer || policy.riskLevel === 'high' || policy.riskLevel === 'critical') {
        const reviewerId = team?.reviewerAgentId
        if (reviewerId === undefined || reviewerId === assigned.id) throw new WorkflowError('independent-reviewer-required', `Task "${task.id}" (${policy.riskLevel} risk) requires an independent reviewer.`)
        const reviewer = agents.find((agent) => agent.id === reviewerId)
        if (reviewer === undefined || reviewer.status === 'archived') throw new WorkflowError('independent-reviewer-unavailable', `Task "${task.id}" reviewer is unavailable.`)
      }
    }
  }
  if (project.approvedRevision !== project.revision || approval === undefined || approval.revision !== project.revision) {
    throw new WorkflowError('stale-approval', 'The current project revision has not been approved.')
  }
  if (approval.planHash !== planDigest(project, tasks)) {
    throw new WorkflowError('stale-approval', 'The approved task plan has changed and must be approved again.')
  }
}
