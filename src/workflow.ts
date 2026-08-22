import { createHash, randomUUID } from 'node:crypto'
import {
  GeneratedPlanSchema,
  PlannerResultSchema,
  type GeneratedPlan,
  type PlannerResult,
  type ProjectRecord,
  type TaskRecord,
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

function canonicalize(value: unknown): unknown {
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
    || tasks.some((task) => task.priority !== undefined || task.tags !== undefined)
  const payload = {
    projectId: project.id,
    revision: project.revision,
    cwd: project.cwd,
    ...(hasExecutionMetadata
      ? { priority: project.priority ?? 'medium', owner: project.owner ?? '' }
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
  agents: Array<{ id: string; role: string; projectRole?: string; autoAssignable?: boolean; status?: 'active' | 'removed' }>,
  now = new Date().toISOString(),
  ordinalOffset = 0,
): TaskRecord[] {
  const ids = new Map(plan.tasks.map((task) => [task.id, randomUUID()]))
  return plan.tasks.map((task, ordinal) => {
    const suggestedRole = task.suggestedAgentRole.toLocaleLowerCase()
    const assigned = agents.find((agent) => task.suggestedAgentId === agent.id && agent.autoAssignable !== false && agent.status !== 'removed') ?? agents.find((agent) => {
      if (agent.autoAssignable === false || agent.status === 'removed') return false
      const role = (agent.projectRole?.trim() || agent.role).toLocaleLowerCase()
      return role.includes(suggestedRole) || suggestedRole.includes(role)
    })
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
      testCommand: task.testCommand,
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
  if (project.approvedRevision !== project.revision || approval === undefined || approval.revision !== project.revision) {
    throw new WorkflowError('stale-approval', 'The current project revision has not been approved.')
  }
  if (approval.planHash !== planDigest(project, tasks)) {
    throw new WorkflowError('stale-approval', 'The approved task plan has changed and must be approved again.')
  }
}
