import { createHash, randomUUID } from 'node:crypto'
import {
  GeneratedPlanV2Schema,
  GeneratedPlanSchema,
  PlannerResultSchema,
  RequirementAnalysisResultSchema,
  RequirementReviewResultSchema,
  TaskAssignmentPolicySchema,
  type DeliveryRole,
  type GeneratedPlanV2,
  type GeneratedPlan,
  type PlannerResult,
  type ProjectRecord,
  type RequirementAnalysisResult,
  type RequirementReviewResult,
  type RequirementSourceBlock,
  type RequirementSourceManifest,
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

function normalizeGeneratedDiagnostics(value: unknown, includeSourceRefs: boolean): unknown {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return value
  const record = value as Record<string, unknown>
  if (!Array.isArray(record.diagnostics) || !record.diagnostics.some((diagnostic) => typeof diagnostic === 'string'
    || (includeSourceRefs && diagnostic !== null && typeof diagnostic === 'object' && !Array.isArray(diagnostic) && !('sourceRefs' in diagnostic)))) return value
  const severity = record.status === 'blocked' ? 'error' : 'warning'
  return {
    ...record,
    diagnostics: record.diagnostics.map((diagnostic, index) => typeof diagnostic === 'string'
      ? {
          code: `model-diagnostic-${index + 1}`,
          severity,
          message: diagnostic,
          ...(includeSourceRefs ? { sourceRefs: [] } : {}),
        }
      : includeSourceRefs && diagnostic !== null && typeof diagnostic === 'object' && !Array.isArray(diagnostic) && !('sourceRefs' in diagnostic)
        ? { ...diagnostic, sourceRefs: [] }
        : diagnostic),
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

function sourceAnchorId(kind: RequirementSourceManifest['anchors'][number]['kind'], locator: string, text: string): string {
  return `src:${kind}:${locator}:${digestObject(text).slice(0, 12)}`
}

export function buildRequirementSourceManifest(input: { prd: string; technicalDesign?: string; sourceRefs?: string[]; sourceBlocks?: RequirementSourceBlock[] }): RequirementSourceManifest {
  const anchors: RequirementSourceManifest['anchors'] = []
  const scan = (source: 'prd' | 'technical-design', content: string): void => {
    let section: 'acceptance' | 'questions' | 'other' = 'other'
    const lines = content.replace(/\r\n?/g, '\n').split('\n')
    for (const [index, raw] of lines.entries()) {
      const text = raw.trim()
      if (text === '') continue
      const locator = `${source}:line:${index + 1}`
      const heading = /^(#{1,6})\s+(.+)$/u.exec(text)
      if (heading !== null) {
        const title = heading[2]!.trim()
        section = /验收|acceptance/i.test(title) ? 'acceptance' : /待确认|开放问题|未决|open questions?|questions?/i.test(title) ? 'questions' : 'other'
        anchors.push({ id: sourceAnchorId('heading', locator, title), kind: 'heading', textDigest: digestObject(title), locator, requiredDisposition: false })
        continue
      }
      const tableRow = /^\|.*\|$/u.test(text) && !/^\|?\s*:?-{3,}/u.test(text.replaceAll('|', ''))
      const listItem = /^(?:[-*+]\s+|\d+[.)]\s+)(.+)$/u.exec(text)
      const kind = section === 'acceptance' && listItem !== null
        ? 'acceptance_item'
        : section === 'questions' && listItem !== null
          ? 'open_question'
          : tableRow
            ? 'table_row'
            : 'paragraph'
      const normalized = listItem?.[1]?.trim() ?? text
      const requiredDisposition = (section === 'acceptance' || section === 'questions') && (listItem !== null || tableRow)
      anchors.push({ id: sourceAnchorId(kind, locator, normalized), kind, textDigest: digestObject(normalized), locator, requiredDisposition })
    }
  }
  const sourceBlocks = [...(input.sourceBlocks ?? [])].sort((left, right) => left.documentKind.localeCompare(right.documentKind) || left.page - right.page || left.block - right.block)
  const duplicateLocator = sourceBlocks.find((block, index) => sourceBlocks.findIndex((candidate) => candidate.locator === block.locator) !== index)
  if (duplicateLocator !== undefined) throw new WorkflowError('requirement-source-locator-duplicate', `Requirement source locator "${duplicateLocator.locator}" is duplicated.`, 422)
  const blockKinds = new Set(sourceBlocks.map((block) => block.documentKind))
  if (!blockKinds.has('prd')) scan('prd', input.prd)
  if (!blockKinds.has('technical_design') && (input.technicalDesign ?? '').trim() !== '') scan('technical-design', input.technicalDesign ?? '')
  for (const documentKind of ['prd', 'technical_design'] as const) {
    let section: 'acceptance' | 'questions' | 'other' = 'other'
    for (const block of sourceBlocks.filter((item) => item.documentKind === documentKind)) {
      const text = block.text.trim()
      const heading = /^(?:#{1,6}\s+)?(.+)$/u.exec(text)
      const title = heading?.[1]?.trim() ?? text
      if (/^(?:验收标准|acceptance(?: criteria)?)$/i.test(title)) section = 'acceptance'
      else if (/^(?:待确认事项|开放问题|未决问题|open questions?|questions?)$/i.test(title)) section = 'questions'
      const listItem = /^(?:[-*+]\s+|\d+[.)]\s+)(.+)$/u.exec(text)
      const tableRow = /^\|.*\|$/u.test(text) && !/^\|?\s*:?-{3,}/u.test(text.replaceAll('|', ''))
      const isHeading = /^(?:#{1,6}\s+)/u.test(text) || title === '验收标准' || title === '待确认事项'
      const kind = isHeading
        ? 'heading'
        : section === 'acceptance' && listItem !== null
          ? 'acceptance_item'
          : section === 'questions' && listItem !== null
            ? 'open_question'
            : tableRow
              ? 'table_row'
              : 'paragraph'
      const normalized = listItem?.[1]?.trim() ?? text
      const requiredDisposition = (section === 'acceptance' || section === 'questions') && (listItem !== null || tableRow)
      anchors.push({ id: sourceAnchorId(kind, block.locator, normalized), kind, textDigest: block.textDigest, locator: block.locator, requiredDisposition })
    }
  }
  for (const [index, ref] of (input.sourceRefs ?? []).entries()) {
    const locator = `attachment:${index + 1}:${ref}`
    anchors.push({ id: sourceAnchorId('paragraph', locator, ref), kind: 'paragraph', textDigest: digestObject(ref), locator, requiredDisposition: false })
  }
  return { sourceDigest: digestObject({ prd: input.prd, technicalDesign: input.technicalDesign ?? '', sourceRefs: input.sourceRefs ?? [], sourceBlocks }), anchors }
}

function assertUniqueKeys(values: string[], code: string): void {
  if (new Set(values).size !== values.length) throw new WorkflowError(code, 'Structured planning keys must be unique.', 422)
}

export function validateRequirementAnalysis(analysis: RequirementAnalysisResult, manifest: RequirementSourceManifest, input: { resolvedDecisionKeys?: string[] } = {}): RequirementAnalysisResult {
  assertUniqueKeys(analysis.requirements.map((item) => item.key), 'duplicate-requirement-key')
  assertUniqueKeys(analysis.requirements.flatMap((item) => item.acceptanceCriteria.map((criterion) => criterion.key)), 'duplicate-acceptance-key')
  assertUniqueKeys(analysis.decisions.map((decision) => decision.key), 'duplicate-decision-key')
  const anchorIds = new Set(manifest.anchors.map((anchor) => anchor.id))
  const refs = [
    ...analysis.requirements.flatMap((item) => item.sourceRefs),
    ...analysis.requirements.flatMap((item) => item.acceptanceCriteria.flatMap((criterion) => criterion.sourceRefs)),
    ...analysis.decisions.flatMap((decision) => decision.sourceRefs),
    ...analysis.diagnostics.flatMap((diagnostic) => diagnostic.sourceRefs),
  ]
  const unknownRef = refs.find((ref) => !anchorIds.has(ref))
  if (unknownRef !== undefined) throw new WorkflowError('requirement-source-invalid', `Requirement analysis references unknown source anchor "${unknownRef}".`, 422)
  for (const requirement of analysis.requirements) {
    if (requirement.scope === 'in_scope' && !requirement.acceptanceCriteria.some((criterion) => criterion.required)) {
      throw new WorkflowError('requirement-acceptance-missing', `Requirement "${requirement.key}" has no required acceptance criterion.`, 422)
    }
  }
  const requirementKeys = new Set(analysis.requirements.map((item) => item.key))
  for (const decision of analysis.decisions) {
    const missing = decision.affectedRequirementKeys.find((key) => !requirementKeys.has(key))
    if (missing !== undefined) throw new WorkflowError('requirement-decision-reference-invalid', `Decision "${decision.key}" references unknown requirement "${missing}".`, 422)
  }
  for (const requirement of analysis.requirements.filter((item) => item.kind === 'unknown' && item.scope === 'in_scope')) {
    if (!analysis.decisions.some((decision) => decision.affectedRequirementKeys.includes(requirement.key))) {
      throw new WorkflowError('requirement-decision-missing', `Unknown requirement "${requirement.key}" requires a Decision.`, 422)
    }
  }
  const dispositionCounts = new Map<string, number>()
  const consume = (sourceRefs: string[]): void => {
    for (const ref of sourceRefs) dispositionCounts.set(ref, (dispositionCounts.get(ref) ?? 0) + 1)
  }
  for (const requirement of analysis.requirements) {
    for (const criterion of requirement.acceptanceCriteria) consume(criterion.sourceRefs)
    if (requirement.scope !== 'in_scope') consume(requirement.sourceRefs)
  }
  for (const decision of analysis.decisions) consume(decision.sourceRefs)
  const uncovered = manifest.anchors.filter((anchor) => anchor.requiredDisposition && (dispositionCounts.get(anchor.id) ?? 0) === 0)
  if (uncovered.length > 0) throw new WorkflowError('requirement-source-uncovered', `Required source anchors were not dispositioned: ${uncovered.map((anchor) => anchor.locator).join(', ')}`, 422)
  const duplicate = manifest.anchors.filter((anchor) => anchor.requiredDisposition && (dispositionCounts.get(anchor.id) ?? 0) > 1)
  if (duplicate.length > 0) throw new WorkflowError('requirement-source-duplicate', `Required source anchors were dispositioned more than once: ${duplicate.map((anchor) => anchor.locator).join(', ')}`, 422)
  const resolvedDecisionKeys = new Set(input.resolvedDecisionKeys ?? [])
  const pendingHighImpact = analysis.decisions.some((decision) => (decision.impact === 'high' || decision.impact === 'critical') && !resolvedDecisionKeys.has(decision.key))
  if (pendingHighImpact && analysis.status === 'ready') throw new WorkflowError('requirement-decision-pending', 'High-impact pending Decisions require needs_decision status.', 422)
  return analysis
}

export function parseRequirementAnalysis(raw: string, manifest: RequirementSourceManifest, input: { resolvedDecisionKeys?: string[] } = {}): RequirementAnalysisResult {
  return validateRequirementAnalysis(RequirementAnalysisResultSchema.parse(normalizeGeneratedDiagnostics(parsePlannerJson(raw), true)), manifest, input)
}

export function parseRequirementReview(raw: string, expected: { sourceDigest: string; analysisDigest: string }): RequirementReviewResult {
  const review = RequirementReviewResultSchema.parse(parsePlannerJson(raw))
  if (review.reviewedSourceDigest !== expected.sourceDigest || review.reviewedAnalysisDigest !== expected.analysisDigest) {
    throw new WorkflowError('requirement-review-stale', 'Requirement review digests do not match the frozen source and analysis.', 422)
  }
  if (review.status === 'approved' && (review.missingSourceRefs.length > 0 || review.conflicts.length > 0 || review.untestableAcceptanceKeys.length > 0 || review.findings.some((finding) => finding.severity === 'blocking'))) {
    throw new WorkflowError('requirement-review-invalid', 'An approved requirement review cannot contain blocking findings.', 422)
  }
  return review
}

export function parseGeneratedPlanV2(raw: string, input: { analysis: RequirementAnalysisResult; capabilityCatalog: string[]; roleCatalog: DeliveryRole[]; resolvedDecisionKeys?: string[] }): GeneratedPlanV2 {
  const plan = GeneratedPlanV2Schema.parse(normalizeGeneratedDiagnostics(parsePlannerJson(raw), false))
  if (plan.status !== 'ready') return plan
  if (!plan.tasks.some((task) => task.kind === 'code') || !plan.tasks.some((task) => task.kind === 'test')) throw new WorkflowError('incomplete-plan', 'V2 plan requires implementation and verification tasks.', 422)
  topologicalTasks(plan.tasks.map((task, ordinal) => ({ ...task, ordinal, acceptanceCriteria: task.completionCriteria, projectId: '', testCommand: task.testCommand, status: 'draft', createdAt: '', updatedAt: '' })))
  const requirementKeys = new Set(input.analysis.requirements.filter((item) => item.scope === 'in_scope').map((item) => item.key))
  const acceptanceKeys = new Set(input.analysis.requirements.filter((item) => item.scope === 'in_scope').flatMap((item) => item.acceptanceCriteria.map((criterion) => criterion.key)))
  const decisionKeys = new Set(input.analysis.decisions.map((item) => item.key))
  const resolvedDecisionKeys = new Set(input.resolvedDecisionKeys ?? [])
  const capabilityCatalog = new Set(input.capabilityCatalog)
  const roleCatalog = new Set(input.roleCatalog)
  const verifiedCommands = new Set(plan.repositoryEvidence.verifiedCommands)
  for (const task of plan.tasks) {
    if (task.sourceRequirementKeys.some((key) => !requirementKeys.has(key)) || task.acceptanceKeys.some((key) => !acceptanceKeys.has(key)) || task.decisionKeys.some((key) => !decisionKeys.has(key))) {
      throw new WorkflowError('plan-reference-invalid', `Task "${task.id}" contains an unknown requirement, acceptance, or Decision reference.`, 422)
    }
    const unresolvedDecision = task.decisionKeys.find((key) => !resolvedDecisionKeys.has(key))
    if (unresolvedDecision !== undefined) throw new WorkflowError('plan-decision-unresolved', `Task "${task.id}" references unresolved Decision "${unresolvedDecision}".`, 422)
    const unknownCapability = task.assignmentPolicy.requiredCapabilities.find((capability) => !capabilityCatalog.has(capability))
    if (unknownCapability !== undefined) throw new WorkflowError('assignment-capability-invalid', `Task "${task.id}" requests capability "${unknownCapability}" outside the project catalog.`, 422)
    const unavailableRole = task.assignmentPolicy.requiredRoles.find((role) => !roleCatalog.has(role))
    if (unavailableRole !== undefined) throw new WorkflowError('assignment-role-invalid', `Task "${task.id}" requests role "${unavailableRole}" outside the project catalog.`, 422)
    if (!verifiedCommands.has(task.testCommand)) throw new WorkflowError('unverified-test-command', `Task "${task.id}" uses an unverified test command.`, 422)
  }
  for (const requirement of input.analysis.requirements.filter((item) => item.scope === 'in_scope')) {
    for (const criterion of requirement.acceptanceCriteria.filter((item) => item.required)) {
      const related = plan.tasks.filter((task) => task.acceptanceKeys.includes(criterion.key))
      if (!related.some((task) => task.relationship === 'implementation')) throw new WorkflowError('acceptance-implementation-missing', `Acceptance "${criterion.key}" has no implementation task.`, 422)
      if (!related.some((task) => task.relationship === 'verification')) throw new WorkflowError('acceptance-verification-missing', `Acceptance "${criterion.key}" has no verification task.`, 422)
    }
  }
  return plan
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

export function materializeTasksV2(
  projectId: string,
  plan: GeneratedPlanV2,
  mappings: { requirementIds: Map<string, string>; acceptanceIds: Map<string, string>; decisionIds: Map<string, string> },
  agents: Array<{ id: string; deliveryRoles: DeliveryRole[]; capabilities: string[]; runtimeStatus: 'online' | 'offline' | 'unstable' | 'unknown'; availableSlots: number }>,
  now = new Date().toISOString(),
  ordinalOffset = 0,
): TaskRecord[] {
  const ids = new Map(plan.tasks.map((task) => [task.id, randomUUID()]))
  return plan.tasks.map((task, ordinal) => {
    const eligible = agents.filter((agent) => agent.runtimeStatus === 'online'
      && task.assignmentPolicy.requiredRoles.every((role) => agent.deliveryRoles.includes(role))
      && task.assignmentPolicy.requiredCapabilities.every((capability) => agent.capabilities.includes(capability)))
      .sort((left, right) => right.availableSlots - left.availableSlots || left.id.localeCompare(right.id))
    const allowedAgentIds = eligible.map((agent) => agent.id).sort()
    const { policyVersion: _policyVersion, ...servicePolicy } = task.assignmentPolicy
    const policy = TaskAssignmentPolicySchema.parse({ ...servicePolicy, allowedAgentIds, allowedSquadIds: [] })
    const assigned = eligible[0]
    return {
      id: ids.get(task.id) ?? randomUUID(),
      projectId,
      ordinal: ordinal + ordinalOffset,
      title: task.title,
      kind: task.kind,
      description: task.description,
      acceptanceCriteria: task.completionCriteria,
      completionCriteria: task.completionCriteria,
      dependencies: task.dependencies.map((dependency) => ids.get(dependency) ?? dependency),
      priority: 'medium',
      tags: [],
      ...(assigned === undefined ? {} : { agentId: assigned.id }),
      assignmentSource: 'automatic_match',
      testCommand: task.testCommand,
      sourceRequirementIds: task.sourceRequirementKeys.map((key) => mappings.requirementIds.get(key)!),
      acceptanceIds: task.acceptanceKeys.map((key) => mappings.acceptanceIds.get(key)!),
      decisionIds: task.decisionKeys.map((key) => mappings.decisionIds.get(key)!),
      assignmentPolicy: policy,
      relationship: task.relationship,
      planningContractVersion: 2,
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
