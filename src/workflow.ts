import { createHash, randomUUID } from 'node:crypto'
import {
  GeneratedPlanV2Schema,
  GeneratedBindingAnalysisV3Schema,
  GeneratedScenarioCompletionV3Schema,
  GeneratedScenarioCoverageReviewV3Schema,
  GeneratedPlanningReviewV3Schema,
  GeneratedPlanV3Schema,
  AssignmentDraftRecordSchema,
  AssignmentEvaluationRecordSchema,
  TaskPreflightRecordV3Schema,
  ExecutionDispatchRecordSchema,
  GeneratedPlanSchema,
  PlannerResultSchema,
  RequirementAnalysisResultSchema,
  RequirementReviewResultSchema,
  RequirementSourceManifestSchema,
  TaskAssignmentPolicySchema,
  type DeliveryRole,
  type GeneratedPlanV2,
  type GeneratedBindingAnalysisV3,
  type GeneratedScenarioCompletionV3,
  type GeneratedScenarioCoverageReviewV3,
  type GeneratedPlanningReviewV3,
  type GeneratedPlanV3,
  type PlanningPromptReferenceManifestRecord,
  type CapabilityRequirementDraftRecord,
  type AssignmentDraftRecord,
  type AssignmentEvaluationRecord,
  type TaskPreflightRecordV3,
  type ExecutionDispatchRecord,
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

function normalizePlanningV3Diagnostics(value: unknown): unknown {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return value
  const record = value as Record<string, unknown>
  if (!Array.isArray(record.diagnostics)) return value
  const defaultSeverity = record.status === 'blocked' ? 'blocking' : 'warning'
  const severityAliases: Record<string, 'info' | 'warning' | 'error' | 'blocking'> = {
    blocked: 'blocking',
    fatal: 'blocking',
    critical: 'blocking',
    warn: 'warning',
    failed: 'error',
    failure: 'error',
  }
  return {
    ...record,
    diagnostics: record.diagnostics.map((diagnostic, index) => {
      if (typeof diagnostic === 'string') {
        return { code: `model-diagnostic-${index + 1}`, severity: defaultSeverity, message: diagnostic, subjectIds: [] }
      }
      if (diagnostic === null || typeof diagnostic !== 'object' || Array.isArray(diagnostic)) return diagnostic
      const source = diagnostic as Record<string, unknown>
      const severity = typeof source.severity === 'string' ? severityAliases[source.severity.toLowerCase()] ?? source.severity : defaultSeverity
      const subjectIds = [
        ...(Array.isArray(source.subjectIds) ? source.subjectIds : []),
        source.requirementKey,
        source.acceptanceKey,
        ...(Array.isArray(source.sourceAnchorIds) ? source.sourceAnchorIds : []),
      ].filter((subjectId): subjectId is string => typeof subjectId === 'string' && subjectId.length > 0)
      return {
        code: typeof source.code === 'string' && source.code.trim().length > 0 ? source.code : `model-diagnostic-${index + 1}`,
        severity,
        message: source.message,
        subjectIds: [...new Set(subjectIds)].slice(0, 100),
      }
    }),
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

const REQUIREMENT_SECTION_PATH_SEGMENT_MAX_LENGTH = 500

function requirementSectionPathSegment(title: string): string {
  if (title.length <= REQUIREMENT_SECTION_PATH_SEGMENT_MAX_LENGTH) return title
  const digestSuffix = `...#${digestObject(title).slice(0, 12)}`
  return `${title.slice(0, REQUIREMENT_SECTION_PATH_SEGMENT_MAX_LENGTH - digestSuffix.length)}${digestSuffix}`
}

function sourceNormativeHints(text: string, section: 'acceptance' | 'questions' | 'other'): NonNullable<RequirementSourceManifest['anchors'][number]['normativeHints']> {
  const hints = new Set<NonNullable<RequirementSourceManifest['anchors'][number]['normativeHints']>[number]>()
  if (section === 'acceptance' || /验收|acceptance|应当|应该|shall|must|必须|需要|支持|允许|禁止|不得/iu.test(text)) hints.add(section === 'acceptance' ? 'acceptance' : 'functional')
  if (section === 'questions' || /待确认|未决|是否|question|decision|选择/iu.test(text)) hints.add('decision')
  if (/业务规则|规则|约束|invariant|business rule/iu.test(text)) hints.add('business_rule')
  if (/数据|字段|表|数据库|schema|migration|索引|唯一/iu.test(text)) hints.add('data')
  if (/状态|流转|state|status|transition/iu.test(text)) hints.add('state')
  if (/权限|授权|角色|认证|管理员|操作员|仅.{0,20}(?:可以|允许)|permission|access|auth|administrator/iu.test(text)) hints.add('permission')
  if (/失败|错误|异常|超时|重试|回滚|降级|failure|error|timeout|retry/iu.test(text)) hints.add('failure')
  if (/性能|安全|可用性|并发|幂等|审计|performance|security|availability|concurrency|idempot/iu.test(text)) hints.add('non_functional')
  if (/迁移|migration|backfill|数据修复/iu.test(text)) hints.add('migration')
  if (/兼容|compatib|旧版本|legacy|upgrade/iu.test(text)) hints.add('compatibility')
  if (/回滚|rollback|撤销/iu.test(text)) hints.add('rollback')
  return [...hints]
}

export function buildRequirementSourceManifest(input: { prd: string; technicalDesign?: string; sourceRefs?: string[]; sourceBlocks?: RequirementSourceBlock[] }, options: { requireAllBlocks?: boolean } = {}): RequirementSourceManifest {
  const anchors: RequirementSourceManifest['anchors'] = []
  const scan = (source: 'prd' | 'technical-design', content: string): void => {
    let section: 'acceptance' | 'questions' | 'other' = 'other'
    const sectionPath: string[] = []
    const lines = content.replace(/\r\n?/g, '\n').split('\n')
    for (const [index, raw] of lines.entries()) {
      const text = raw.trim()
      if (text === '') continue
      const locator = `${source}:line:${index + 1}`
      const heading = /^(#{1,6})\s+(.+)$/u.exec(text)
      if (heading !== null) {
        const title = heading[2]!.trim()
        section = /验收|acceptance/i.test(title) ? 'acceptance' : /待确认|开放问题|未决|open questions?|questions?/i.test(title) ? 'questions' : 'other'
        const level = heading[1]!.length
        sectionPath.splice(level - 1)
        sectionPath[level - 1] = requirementSectionPathSegment(title)
        anchors.push({ id: sourceAnchorId('heading', locator, title), kind: 'heading', documentKind: source === 'prd' ? 'prd' : 'technical_design', sectionPath: sectionPath.filter(Boolean), ordinal: anchors.length, text: title, textDigest: digestObject(title), locator, normativeHints: sourceNormativeHints(title, section), contentClassification: 'context', classificationReason: 'Markdown heading provides structure and is not dispositioned as a standalone requirement.', requiredDisposition: false })
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
      const requiredDisposition = options.requireAllBlocks === true || (section === 'acceptance' || section === 'questions') && (listItem !== null || tableRow)
      anchors.push({ id: sourceAnchorId(kind, locator, normalized), kind, documentKind: source === 'prd' ? 'prd' : 'technical_design', sectionPath: sectionPath.filter(Boolean), ordinal: anchors.length, text: normalized, textDigest: digestObject(normalized), locator, normativeHints: sourceNormativeHints(normalized, section), contentClassification: 'normative', classificationReason: options.requireAllBlocks === true ? 'V3 treats every non-heading block from the normative PRD/design source as disposition-required.' : 'Acceptance and open-question items require explicit disposition.', requiredDisposition })
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
    const sectionPath: string[] = []
    for (const block of sourceBlocks.filter((item) => item.documentKind === documentKind)) {
      const text = block.text.trim()
      const heading = /^(?:#{1,6}\s+)?(.+)$/u.exec(text)
      const title = heading?.[1]?.trim() ?? text
      if (/^(?:验收标准|acceptance(?: criteria)?)$/i.test(title)) section = 'acceptance'
      else if (/^(?:待确认事项|开放问题|未决问题|open questions?|questions?)$/i.test(title)) section = 'questions'
      const listItem = /^(?:[-*+]\s+|\d+[.)]\s+)(.+)$/u.exec(text)
      const tableRow = /^\|.*\|$/u.test(text) && !/^\|?\s*:?-{3,}/u.test(text.replaceAll('|', ''))
      const isHeading = /^(?:#{1,6}\s+)/u.test(text) || title === '验收标准' || title === '待确认事项'
      if (isHeading) {
        const level = /^(#{1,6})\s+/u.exec(text)?.[1]?.length ?? 1
        sectionPath.splice(level - 1)
        sectionPath[level - 1] = requirementSectionPathSegment(title)
      }
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
      const requiredDisposition = !isHeading && (options.requireAllBlocks === true || (section === 'acceptance' || section === 'questions') && (listItem !== null || tableRow))
      anchors.push({ id: sourceAnchorId(kind, block.locator, normalized), kind, documentKind, sectionPath: sectionPath.filter(Boolean), ordinal: anchors.length, text: normalized, textDigest: block.textDigest, locator: block.locator, normativeHints: sourceNormativeHints(normalized, section), contentClassification: isHeading ? 'context' : 'normative', classificationReason: isHeading ? 'Document heading provides structure.' : options.requireAllBlocks === true ? 'V3 treats every non-heading block from the normative source as disposition-required.' : 'Acceptance and open-question items require explicit disposition.', requiredDisposition })
    }
  }
  for (const [index, ref] of (input.sourceRefs ?? []).entries()) {
    const locator = `attachment:${index + 1}:${ref}`
    anchors.push({ id: sourceAnchorId('paragraph', locator, ref), kind: 'paragraph', documentKind: 'attachment', sectionPath: [], ordinal: anchors.length, text: ref, textDigest: digestObject(ref), locator, normativeHints: [], contentClassification: 'context', classificationReason: 'Attachment reference is context until a readable source profile is available.', requiredDisposition: false })
  }
  return RequirementSourceManifestSchema.parse({ sourceDigest: digestObject({ prd: input.prd, technicalDesign: input.technicalDesign ?? '', sourceRefs: input.sourceRefs ?? [], sourceBlocks }), anchors })
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

function normalizeGeneratedSourceAnchorRefs(value: unknown, manifest: RequirementSourceManifest): void {
  const canonicalByFullDigestRef = new Map<string, string | undefined>()
  for (const anchor of manifest.anchors) {
    const separator = anchor.id.lastIndexOf(':')
    if (separator < 0) continue
    const fullDigestRef = `${anchor.id.slice(0, separator + 1)}${anchor.textDigest}`
    const existing = canonicalByFullDigestRef.get(fullDigestRef)
    canonicalByFullDigestRef.set(fullDigestRef, existing === undefined && !canonicalByFullDigestRef.has(fullDigestRef) ? anchor.id : undefined)
  }
  const normalizeRefs = (record: Record<string, unknown>, field: string): void => {
    if (!Array.isArray(record[field])) return
    record[field] = record[field].map((ref) => typeof ref === 'string' ? canonicalByFullDigestRef.get(ref) ?? ref : ref)
  }
  if (value === null || typeof value !== 'object') return
  const root = value as Record<string, unknown>
  if (Array.isArray(root.requirements)) {
    for (const requirementValue of root.requirements) {
      if (requirementValue === null || typeof requirementValue !== 'object') continue
      const requirement = requirementValue as Record<string, unknown>
      normalizeRefs(requirement, 'sourceRefs')
      if (!Array.isArray(requirement.acceptanceCriteria)) continue
      for (const criterionValue of requirement.acceptanceCriteria) {
        if (criterionValue !== null && typeof criterionValue === 'object') normalizeRefs(criterionValue as Record<string, unknown>, 'sourceRefs')
      }
    }
  }
  if (Array.isArray(root.decisions)) {
    for (const decisionValue of root.decisions) {
      if (decisionValue === null || typeof decisionValue !== 'object') continue
      const decision = decisionValue as Record<string, unknown>
      normalizeRefs(decision, 'sourceRefs')
      if (!Array.isArray(decision.options)) continue
      for (const optionValue of decision.options) {
        if (optionValue !== null && typeof optionValue === 'object') normalizeRefs(optionValue as Record<string, unknown>, 'evidenceAnchorIds')
      }
    }
  }
  if (Array.isArray(root.diagnostics)) {
    for (const diagnosticValue of root.diagnostics) {
      if (diagnosticValue !== null && typeof diagnosticValue === 'object') normalizeRefs(diagnosticValue as Record<string, unknown>, 'sourceRefs')
    }
  }
}

export function parseRequirementAnalysis(raw: string, manifest: RequirementSourceManifest, input: { resolvedDecisionKeys?: string[] } = {}): RequirementAnalysisResult {
  const parsed = normalizeGeneratedDiagnostics(parsePlannerJson(raw), true)
  normalizeGeneratedSourceAnchorRefs(parsed, manifest)
  if (parsed !== null && typeof parsed === 'object' && Array.isArray((parsed as Record<string, unknown>).requirements)) {
    for (const requirement of (parsed as { requirements: unknown[] }).requirements) {
      if (requirement === null || typeof requirement !== 'object' || !Array.isArray((requirement as Record<string, unknown>).acceptanceCriteria)) continue
      for (const criterion of (requirement as { acceptanceCriteria: unknown[] }).acceptanceCriteria) {
        if (criterion !== null && typeof criterion === 'object' && (criterion as Record<string, unknown>).scenario === 'good') {
          ;(criterion as Record<string, unknown>).scenario = 'happy_path'
        }
      }
    }
  }
  return validateRequirementAnalysis(RequirementAnalysisResultSchema.parse(parsed), manifest, input)
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

function assertKnownValues(values: string[], allowed: Set<string>, code: string, subject: string): void {
  const unknown = values.find((value) => !allowed.has(value))
  if (unknown !== undefined) throw new WorkflowError(code, `${subject} references unknown value "${unknown}".`, 422)
}

function scopeIsWithin(candidate: string, allowed: string): boolean {
  const normalizedCandidate = candidate.replace(/\\/g, '/').replace(/^\.\//, '').replace(/\/$/, '')
  const normalizedAllowed = allowed.replace(/\\/g, '/').replace(/^\.\//, '').replace(/\/$/, '')
  return normalizedCandidate === normalizedAllowed || normalizedCandidate.startsWith(`${normalizedAllowed}/`)
}

function scopesIntersect(left: string, right: string): boolean {
  return scopeIsWithin(left, right) || scopeIsWithin(right, left)
}

function ownsBrowserScope(scope: string): boolean {
  return /(?:^|\/)(?:browser|e2e|playwright|cypress)(?:\/|\.|$)/iu.test(scope)
}

function ownsReleaseLifecycleScope(scope: string): boolean {
  return /(?:^|\/)(?:package\.json|pnpm-lock\.yaml|package-lock\.json|yarn\.lock|bun\.lockb?|\.github\/workflows(?:\/|$)|(?:scripts?|ci|build)(?:\/|$))/iu.test(scope)
}

export function parseGeneratedBindingAnalysisV3(
  raw: string,
  input: {
    requirementKeys: string[]
    allowedEvidenceRefs: string[]
    eventScenarios?: Array<{
      key: string
      requirementKey: string
      eventObservables?: Array<{ key: string; expectation: 'present' | 'absent' }>
    }>
  },
): GeneratedBindingAnalysisV3 {
  const result = GeneratedBindingAnalysisV3Schema.parse(parsePlannerJson(raw))
  const allowedDiagnosticSubjectIds = new Set([...input.requirementKeys, ...input.allowedEvidenceRefs])
  for (const diagnostic of result.diagnostics) assertKnownValues(diagnostic.subjectIds, allowedDiagnosticSubjectIds, 'binding-diagnostic-subject-invalid', `Binding diagnostic "${diagnostic.code}"`)
  if (result.status === 'blocked') {
    if (result.bindings.length > 0) throw new WorkflowError('binding-blocked-with-proposals', 'A blocked binding analysis cannot publish bindings.', 422)
    return result
  }
  assertUniqueKeys(result.bindings.map((binding) => binding.key), 'duplicate-binding-key')
  const requirementKeys = new Set(input.requirementKeys)
  const allowedEvidenceRefs = new Set(input.allowedEvidenceRefs)
  const eventScenarioRequirementByKey = new Map((input.eventScenarios ?? []).map((scenario) => [scenario.key, scenario.requirementKey]))
  const eventObservableByKey = new Map<string, { scenarioKey: string; requirementKey: string; expectation: 'present' | 'absent' }>()
  for (const scenario of input.eventScenarios ?? []) {
    for (const observable of scenario.eventObservables ?? []) {
      if (eventObservableByKey.has(observable.key)) throw new WorkflowError('duplicate-scenario-event-observable-key', `Event observable key "${observable.key}" is not unique.`, 422)
      eventObservableByKey.set(observable.key, { scenarioKey: scenario.key, requirementKey: scenario.requirementKey, expectation: observable.expectation })
    }
  }
  const boundEventObservableKeys = new Set<string>()
  for (const binding of result.bindings) {
    assertKnownValues([binding.requirementKey], requirementKeys, 'binding-reference-invalid', `Binding "${binding.key}"`)
    assertKnownValues(binding.evidenceRefs, allowedEvidenceRefs, 'binding-evidence-invalid', `Binding "${binding.key}"`)
    for (const assessment of binding.impactAssessments) assertKnownValues(assessment.evidenceRefs, allowedEvidenceRefs, 'binding-evidence-invalid', `Binding "${binding.key}" impact "${assessment.dimension}"`)
    if (binding.changeIntent === 'unknown') throw new WorkflowError('binding-intent-unresolved', `Binding "${binding.key}" has unresolved change intent.`, 422)
    assertUniqueKeys(binding.eventFactChains.map((chain) => chain.factKey), 'duplicate-binding-event-fact-key')
    for (const chain of binding.eventFactChains) {
      assertKnownValues(chain.scenarioKeys, new Set(eventScenarioRequirementByKey.keys()), 'binding-event-scenario-invalid', `Binding "${binding.key}" event fact "${chain.factKey}"`)
      const wrongRequirementScenario = chain.scenarioKeys.find((key) => eventScenarioRequirementByKey.get(key) !== binding.requirementKey)
      if (wrongRequirementScenario !== undefined) throw new WorkflowError('binding-event-scenario-requirement-mismatch', `Binding "${binding.key}" event fact "${chain.factKey}" references Scenario "${wrongRequirementScenario}" from another Requirement.`, 422)
      if (eventObservableByKey.size > 0) {
        const observable = eventObservableByKey.get(chain.eventObservableKey)
        if (observable === undefined) throw new WorkflowError('binding-event-observable-invalid', `Binding "${binding.key}" event fact "${chain.factKey}" references unknown event observable "${chain.eventObservableKey}".`, 422)
        if (observable.requirementKey !== binding.requirementKey || chain.scenarioKeys.length !== 1 || chain.scenarioKeys[0] !== observable.scenarioKey) throw new WorkflowError('binding-event-observable-scenario-mismatch', `Binding "${binding.key}" event fact "${chain.factKey}" does not match event observable "${chain.eventObservableKey}" and its owning Scenario.`, 422)
        if (chain.assertsAbsence !== (observable.expectation === 'absent')) throw new WorkflowError('binding-event-observable-expectation-mismatch', `Binding "${binding.key}" event fact "${chain.factKey}" contradicts the frozen expectation for "${chain.eventObservableKey}".`, 422)
        if (boundEventObservableKeys.has(chain.eventObservableKey)) throw new WorkflowError('duplicate-binding-event-observable-key', `Event observable "${chain.eventObservableKey}" is mapped by more than one Binding fact chain.`, 422)
        boundEventObservableKeys.add(chain.eventObservableKey)
      }
      const chainOwners = [...chain.recordOwnerSymbols, ...chain.persistedCollectionOwnerSymbols, ...chain.readSurfaceOwnerSymbols, ...chain.producerOwnerSymbols]
      assertKnownValues(chainOwners, new Set(binding.ownerSymbols), 'binding-event-owner-invalid', `Binding "${binding.key}" event fact "${chain.factKey}"`)
      const chainEvidenceRefs = [...chain.fixtureEvidenceRefs, ...chain.assertionEvidenceRefs]
      assertKnownValues(chainEvidenceRefs, allowedEvidenceRefs, 'binding-event-evidence-invalid', `Binding "${binding.key}" event fact "${chain.factKey}"`)
      assertKnownValues(chainEvidenceRefs, new Set(binding.evidenceRefs), 'binding-event-evidence-unowned', `Binding "${binding.key}" event fact "${chain.factKey}"`)
      for (const dimension of ['write_path', 'read_path', 'data', 'test'] as const) {
        if (binding.impactAssessments.find((assessment) => assessment.dimension === dimension)?.applicability !== 'required') throw new WorkflowError('binding-event-impact-incomplete', `Binding "${binding.key}" event fact "${chain.factKey}" requires a grounded ${dimension} impact.`, 422)
      }
    }
  }
  const uncovered = input.requirementKeys.filter((key) => !result.bindings.some((binding) => binding.requirementKey === key))
  if (uncovered.length > 0) throw new WorkflowError('requirement-binding-missing', `Requirements have no current code binding: ${uncovered.join(', ')}`, 422)
  const uncoveredEventObservables = [...eventObservableByKey.keys()].filter((key) => !boundEventObservableKeys.has(key))
  if (uncoveredEventObservables.length > 0) throw new WorkflowError('binding-event-observable-chain-missing', `Event observables have no independent structured source-of-truth chain: ${uncoveredEventObservables.join(', ')}`, 422)
  const uncoveredEventScenarios = (input.eventScenarios ?? []).filter((scenario) => (scenario.eventObservables ?? []).length === 0 && !result.bindings.some((binding) => binding.requirementKey === scenario.requirementKey && binding.eventFactChains.some((chain) => chain.scenarioKeys.includes(scenario.key))))
  if (uncoveredEventScenarios.length > 0) throw new WorkflowError('binding-event-observable-chain-missing', `Event-observable Scenarios have no structured source-of-truth chain: ${uncoveredEventScenarios.map((scenario) => scenario.key).join(', ')}`, 422)
  return result
}

export function parseGeneratedScenarioCompletionV3(
  raw: string,
  input: {
    requirements: Array<{ key: string; acceptanceKeys: string[] }>
    requiredCategoriesByAcceptance: Record<string, Array<GeneratedScenarioCompletionV3['scenarios'][number]['category']>>
    requiredSourceRefsByAcceptanceCategory: Record<string, Partial<Record<GeneratedScenarioCompletionV3['scenarios'][number]['category'], string[]>>>
    allowedSourceRefs: string[]
  },
): GeneratedScenarioCompletionV3 {
  const result = GeneratedScenarioCompletionV3Schema.parse(normalizePlanningV3Diagnostics(parsePlannerJson(raw)))
  if (result.status === 'blocked') return result
  assertUniqueKeys(result.scenarios.map((scenario) => scenario.key), 'duplicate-scenario-key')
  assertUniqueKeys(result.scenarios.flatMap((scenario) => scenario.eventObservables.map((observable) => observable.key)), 'duplicate-scenario-event-observable-key')
  const requirementByAcceptance = new Map(input.requirements.flatMap((requirement) => requirement.acceptanceKeys.map((acceptanceKey) => [acceptanceKey, requirement.key] as const)))
  const allowedSourceRefs = new Set(input.allowedSourceRefs)
  for (const scenario of result.scenarios) {
    const expectedRequirement = requirementByAcceptance.get(scenario.acceptanceKey)
    if (expectedRequirement === undefined || expectedRequirement !== scenario.requirementKey) throw new WorkflowError('scenario-reference-invalid', `Scenario "${scenario.key}" references an unknown Requirement or Acceptance pair.`, 422)
    assertKnownValues(scenario.sourceAnchorIds, allowedSourceRefs, 'scenario-source-invalid', `Scenario "${scenario.key}"`)
    const hasUiObservable = scenario.observableAt.some((observable) => observable.kind === 'ui')
    const hasBrowserOrUserTrigger = /(?:\bbrowser\b|\bplaywright\b|\bcypress\b|真实浏览器|浏览器|用户.{0,40}(?:打开|访问|点击|提交|操作|查看)|(?:打开|访问|导航到).{0,40}(?:页面|路由)|点击.{0,40}(?:按钮|链接|控件))/iu.test(scenario.trigger)
    if (hasUiObservable && !hasBrowserOrUserTrigger) {
      throw new WorkflowError('scenario-ui-trigger-nonbrowser', `UI Scenario "${scenario.key}" does not use an executable browser or user interaction as its trigger.`, 422)
    }
  }
  for (const [acceptanceKey, categories] of Object.entries(input.requiredCategoriesByAcceptance)) {
    const scenarios = result.scenarios.filter((scenario) => scenario.acceptanceKey === acceptanceKey && scenario.required)
    for (const category of new Set(['happy_path' as const, ...categories])) {
      const matching = scenarios.filter((scenario) => scenario.category === category)
      if (matching.length === 0) throw new WorkflowError('acceptance-scenario-category-missing', `Acceptance "${acceptanceKey}" has no required ${category} Scenario.`, 422)
      if (matching.length > 1) throw new WorkflowError('acceptance-scenario-category-duplicate', `Acceptance "${acceptanceKey}" has more than one required ${category} Scenario.`, 422)
      const expectedSourceRefs = [...new Set(input.requiredSourceRefsByAcceptanceCategory[acceptanceKey]?.[category] ?? [])].sort()
      const actualSourceRefs = [...new Set(matching[0]!.sourceAnchorIds)].sort()
      if (expectedSourceRefs.length === 0 || JSON.stringify(actualSourceRefs) !== JSON.stringify(expectedSourceRefs)) throw new WorkflowError('scenario-source-policy-mismatch', `Scenario "${matching[0]!.key}" must preserve exactly the source anchors from its ${category} policy.`, 422)
    }
  }
  return result
}

export function parseGeneratedScenarioCoverageReviewV3(raw: string, expectedInputDigest: string): GeneratedScenarioCoverageReviewV3 {
  const result = GeneratedScenarioCoverageReviewV3Schema.parse(parsePlannerJson(raw))
  if (result.reviewedInputDigest !== expectedInputDigest) throw new WorkflowError('scenario-coverage-review-stale', 'Scenario coverage Reviewer did not review the frozen input digest.', 422)
  if (result.status === 'approved' && result.findings.length > 0) throw new WorkflowError('scenario-coverage-review-inconsistent', 'An approved Scenario coverage review must not contain findings.', 422)
  return result
}

export function parseGeneratedPlanningReviewV3(raw: string, expectedInputDigest: string): GeneratedPlanningReviewV3 {
  const result = GeneratedPlanningReviewV3Schema.parse(parsePlannerJson(raw))
  if (result.reviewedInputDigest !== expectedInputDigest) throw new WorkflowError('planning-review-stale', 'Planning Reviewer did not review the frozen input digest.', 422)
  return result
}

export interface GeneratedPlanV3ValidationInput {
  requirementKeys: string[]
  acceptanceKeys: string[]
  requiredAcceptanceKeys: string[]
  scenarioKeys: string[]
  requiredScenarioKeys: string[]
  uiScenarioKeys?: string[]
  decisionKeys: string[]
  resolvedDecisionKeys: string[]
  bindingKeys: string[]
  bindingScopes?: Record<string, string[]>
  bindingOwnerPathsBySymbol?: Record<string, Record<string, string[]>>
  stageIdentifierCompatibilityRequired?: boolean
  requiredPolicyRefs: string[]
  requiredPolicyStatementsByRef?: Record<string, string>
  requiredPolicySubjectsByRef?: Record<string, { requirementKeys: string[]; scenarioKeys: string[] }>
  promptReferenceManifest: PlanningPromptReferenceManifestRecord
}

function planTaskContractText(task: GeneratedPlanV3['tasks'][number]): string {
  return [
    task.description,
    ...task.completionCriteria,
    task.contextPack.objective,
    task.contextPack.targetBehavior,
    ...task.contextPack.inScope,
    ...task.contextPack.requirementStatements,
    ...task.contextPack.expectedArtifacts,
    ...task.contextPack.verificationSteps.flatMap((step) => [step.action, step.expectedObservable]),
  ].join('\n')
}

const TASK_OWNER_MUTATION_VERB_EN = '(?:change|modify|extend|update|refactor|replace|remove|rewrite|add|expose|implement|persist|own)'
const TASK_OWNER_MUTATION_VERB_ZH = '(?:修改|扩展|更新|重构|替换|删除|改造|调整|新增|增加|实现|写入|持久化|投影|声明)'

function regexpEscape(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')
}

function taskOwnerMutationMatchIsNegated(clause: string, match: RegExpExecArray): boolean {
  const mutationVerb = match[1]
  if (mutationVerb === undefined) return false
  const mutationOffset = match.index + match[0].indexOf(mutationVerb)
  const prefix = clause.slice(Math.max(0, mutationOffset - 48), mutationOffset)
  return /(?:\b(?:do(?:es)?|did|will|would|shall|should|must|may|might|can|could|is|are|was|were|be)\s+not(?:\s+to)?|\b(?:never|without)|\b(?:do(?:es)?n't|didn't|won't|wouldn't|shouldn't|mustn't|can't|couldn't)|\bno\s+need\s+to)\s*$/iu.test(prefix)
    || /(?:不|勿|未|无须|无需|不得|禁止|避免|不会|不可|不应|不需|不需要|不必|不做)\s*$/u.test(prefix)
}

function taskClauseClaimsOwnerSymbolChange(clause: string, symbol: string): boolean {
  const symbolNames = [...new Set([symbol, symbol.split('.').at(-1)!])]
  const symbolPattern = `(?:${symbolNames.map((name) => `${symbol.includes('.') ? '(?<![A-Za-z0-9_$])' : '(?<![A-Za-z0-9_$.])'}${regexpEscape(name)}(?![A-Za-z0-9_$])`).join('|')})`
  const patterns = [
    new RegExp(`\\b(${TASK_OWNER_MUTATION_VERB_EN}(?:s|ed|ing)?)\\b\\s+(?:(?:the|an?|existing|current|named|owner)\\s+){0,3}[\`'"]?${symbolPattern}`, 'giu'),
    new RegExp(`${symbolPattern}[\`'"]?\\s+(?:(?:must|will|should|shall|is|are|to)\\s+){0,3}(?:be\\s+)?(${TASK_OWNER_MUTATION_VERB_EN}(?:s|ed|ing)?)\\b`, 'giu'),
    new RegExp(`\\b((?:add|expose|persist)(?:s|ed|ing)?)\\b[^\\n,;]{0,40}\\b(?:to|in|on)\\b\\s+(?:the\\s+)?[\`'"]?${symbolPattern}`, 'giu'),
    new RegExp(`(${TASK_OWNER_MUTATION_VERB_ZH})\\s*(?:现有|已有|当前)?(?:的)?\\s*[\`'"]?${symbolPattern}`, 'giu'),
    new RegExp(`(?:在|向)\\s*[\`'"]?${symbolPattern}[\`'"]?\\s*(?:中|内|上)?\\s*(${TASK_OWNER_MUTATION_VERB_ZH})`, 'giu'),
    new RegExp(`${symbolPattern}[\`'"]?\\s*(?:必须|需要|将|应当|应该)?\\s*(?:被)?\\s*(${TASK_OWNER_MUTATION_VERB_ZH})`, 'giu'),
  ]
  return patterns.some((pattern) => [...clause.matchAll(pattern)].some((match) => !taskOwnerMutationMatchIsNegated(clause, match)))
}

function taskClaimsOwnerSymbolChange(task: GeneratedPlanV3['tasks'][number], symbol: string): boolean {
  return [
    task.description,
    ...task.completionCriteria,
    task.contextPack.objective,
    task.contextPack.targetBehavior,
    ...task.contextPack.inScope,
    ...task.contextPack.expectedArtifacts,
  ].flatMap((value) => value.split(/[\n,，;；。]/u))
    .some((clause) => taskClauseClaimsOwnerSymbolChange(clause, symbol))
}

function mentionsUnknownStageCompatibility(text: string): boolean {
  const unknownStage = /(?:(?:unknown|future|unrecognized|未知|未来|未识别).{0,40}(?:stage|阶段)|(?:stage|阶段).{0,40}(?:unknown|future|unrecognized|未知|未来|未识别))/iu
  const negatedEnglishAction = /(?:\b(?:do(?:es)?|did|will|would|shall|should|must|can|could)\s+not|\b(?:doesn't|didn't|won't|wouldn't|shouldn't|mustn't|can't|couldn't)|\bnever)\s+(?:\w+[\s-]+){0,4}(?:handle|support|implement|extend|introduce|add|accept|preserve|persist|read|sort|provide|require|include|contain|cover|create|define|test|verify)/iu
  const negatedEnglishResult = /\b(?:is|are|will\s+be|must\s+be|should\s+be)?\s*not\s+(?:handled|supported|implemented|extended|introduced|added|accepted|preserved|persisted|readable|sorted|required|in\s+scope)\b/iu
  const negatedChineseAction = /(?:不处理|不支持|不实现|不得扩展|不扩展|不引入|不增加|不接受|不保留|不持久化|不读取|不排序|不提供|不要求|不承担|不涉及|不考虑|不覆盖|不包含|不含|不纳入|不创建|不定义|未声明|不测试|不验证|无需处理|无需支持|无需实现|禁止扩展)/u
  const positiveEnglishAction = /^\s*(?:(?:must|should|will|shall|can|could|may|need(?:s)?\s+to|continue(?:s)?\s+to)\s+)?(?:handle|support|implement|extend|introduce|add|accept|preserve|persist|read|sort|provide|require|include|contain|cover|create|define|test|verify)\b/iu
  const positiveEnglishResult = /\b(?:unknown|future|unrecognized).{0,40}\bstage\b.{0,40}\b(?:remain(?:s)?|continue(?:s)?|must|should|will|need(?:s)?\s+to)\b/iu
  const positiveChineseAction = /^\s*(?:(?:仍然?|继续|必须|需要|应当|应该|将|会|可以|能够)\s*)?(?:处理|支持|实现|扩展|引入|增加|接受|保留|持久化|读取|排序|提供|要求|承担|涉及|考虑|覆盖|包含|纳入|创建|定义|测试|验证)/u
  const positiveChineseResult = /(?:未知|未来|未识别).{0,40}(?:阶段).{0,40}(?:保持|继续|仍然?|必须|需要|应当|应该|将|会|可以|能够).{0,40}(?:可读|保留|排序|处理|支持|兼容|持久化|接受)/u
  return text.split(/[\n;；。]|\b(?:but|however)\b|但|然而/iu).some((segment) => {
    let inheritedNegation = false
    return segment.split(/[,，、]/u).some((rawClause) => {
      const clause = rawClause.trim()
      const negated = negatedEnglishAction.test(clause) || negatedEnglishResult.test(clause) || negatedChineseAction.test(clause)
      const explicitlyPositive = positiveEnglishAction.test(clause) || positiveEnglishResult.test(clause) || positiveChineseAction.test(clause) || positiveChineseResult.test(clause)
      if (!unknownStage.test(clause)) {
        if (negated) inheritedNegation = true
        else if (explicitlyPositive) inheritedNegation = false
        return false
      }
      if (negated) {
        inheritedNegation = true
        return false
      }
      return !inheritedNegation || explicitlyPositive
    })
  })
}

function mutationSourcePolicyCoverageGaps(plan: GeneratedPlanV3, policyRef: string): string[] {
  const evidenceSegments = plan.tasks.filter((task) => task.policyConstraintRefs.includes(policyRef)).flatMap((task) => [
    ...task.completionCriteria,
    ...task.contextPack.verificationSteps.map((step) => `${step.action} ${step.expectedObservable}`),
  ])
  const allowed = /(?:allow(?:ed)?|accept(?:ed)?|success(?:ful(?:ly)?)?|允许|接受|成功)/iu
  const rejected = /(?:reject(?:ed|ion)?|deny|denied|block(?:ed)?|拒绝|拦截|阻止)/iu
  const loopback = /(?:loopback|回环)/iu
  const peer = /(?:\bpeer\b|对端)/iu
  const host = /(?:\bhost\b|主机)/iu
  const origin = /\borigin\b/iu
  const fetchMetadata = /fetch[\s-]*metadata/iu
  const missing = /(?:missing|absent|without|缺失|不存在|未提供|无)/iu
  const crossOrigin = /(?:cross[\s-]*origin|跨源)/iu
  const nonLoopback = /(?:non[\s-]*loopback|非回环)/iu
  const crossSite = /(?:cross[\s-]*site|跨站)/iu
  const invalid = /(?:invalid|malformed|非法|无效)/iu
  const beforeAfter = /(?:before.{0,120}after|pre.{0,40}post|请求前后|前后(?:计数|快照|状态|集合|事实)?)/iu
  const zeroBusinessWrites = /(?:zero\s+(?:business\s+)?writes?|no\s+(?:business\s+)?(?:state|fact|record|write)|unchanged|零(?:业务)?写入|业务写入(?:数|数量|计数)?(?:为|是)?零|无(?:任何)?业务写入|没有写入(?:任何)?业务|业务(?:状态|事实|记录|集合).{0,40}(?:不变|未变|无新增)|(?:计数|快照|状态|集合|事实).{0,40}(?:不变|未变|无新增))/iu
  const contains = (text: string, ...patterns: RegExp[]): boolean => patterns.every((pattern) => pattern.test(text))
  const hasRejectedBoundaryWithZeroWrites = (...patterns: RegExp[]): boolean => evidenceSegments.some((segment) => contains(segment, rejected, ...patterns, beforeAfter, zeroBusinessWrites))
  const gaps: string[] = []
  const hasAllowedBoundary = (...patterns: RegExp[]): boolean => evidenceSegments.some((segment) => contains(segment, allowed, ...patterns))
  if (!hasAllowedBoundary(loopback, peer)) gaps.push('allowed-loopback-peer')
  if (!hasAllowedBoundary(loopback, host)) gaps.push('allowed-loopback-host')
  if (!hasAllowedBoundary(origin, /(?:matching|matched|same[\s-]*origin|匹配|同源)/iu)) gaps.push('allowed-matching-origin')
  if (!hasAllowedBoundary(fetchMetadata, /(?:same[\s-]*origin|同源)/iu)) gaps.push('allowed-same-origin-fetch-metadata')
  if (!hasRejectedBoundaryWithZeroWrites(nonLoopback, peer)) gaps.push('rejected-non-loopback-peer-with-zero-writes')
  if (!hasRejectedBoundaryWithZeroWrites(nonLoopback, host)) gaps.push('rejected-non-loopback-host-with-zero-writes')
  if (!hasRejectedBoundaryWithZeroWrites(origin, missing)) gaps.push('rejected-missing-origin-with-zero-writes')
  if (!hasRejectedBoundaryWithZeroWrites(origin, crossOrigin)) gaps.push('rejected-cross-origin-with-zero-writes')
  if (!hasRejectedBoundaryWithZeroWrites(fetchMetadata, crossSite)) gaps.push('rejected-cross-site-fetch-metadata-with-zero-writes')
  if (!hasRejectedBoundaryWithZeroWrites(fetchMetadata, invalid)) gaps.push('rejected-invalid-fetch-metadata-with-zero-writes')
  return gaps
}

export function parseGeneratedPlanV3(raw: string, input: GeneratedPlanV3ValidationInput): GeneratedPlanV3 {
  const plan = GeneratedPlanV3Schema.parse(parsePlannerJson(raw))
  if (plan.status === 'blocked') {
    if (plan.workPackages.length > 0) throw new WorkflowError('plan-blocked-with-proposals', 'A blocked V3 plan cannot publish work packages.', 422)
    return plan
  }
  if (plan.tasks.length === 0 || plan.workPackages.length === 0) throw new WorkflowError('empty-plan', 'A ready V3 plan requires work packages and tasks.', 422)
  assertUniqueKeys(plan.workPackages.map((item) => item.key), 'duplicate-work-package-key')
  assertUniqueKeys(plan.tasks.map((item) => item.key), 'duplicate-task-key')
  const requirementKeys = new Set(input.requirementKeys)
  const acceptanceKeys = new Set(input.acceptanceKeys)
  const scenarioKeys = new Set(input.scenarioKeys)
  const uiScenarioKeys = new Set(input.uiScenarioKeys ?? [])
  const decisionKeys = new Set(input.decisionKeys)
  const resolvedDecisionKeys = new Set(input.resolvedDecisionKeys)
  const bindingKeys = new Set(input.bindingKeys)
  const workPackageKeys = new Set(plan.workPackages.map((item) => item.key))
  const taskKeys = new Set(plan.tasks.map((item) => item.key))
  const promptRefs = new Map(input.promptReferenceManifest.references.map((reference) => [reference.ref, reference.kind]))
  const verificationCommandByRef = new Map(input.promptReferenceManifest.references
    .filter((reference) => reference.kind === 'verification_command')
    .map((reference) => [reference.ref, reference.artifactId]))
  const assertPromptRefs = (refs: string[], kinds: Array<PlanningPromptReferenceManifestRecord['references'][number]['kind']>, subject: string): void => {
    const invalid = refs.find((ref) => !kinds.includes(promptRefs.get(ref)!))
    if (invalid !== undefined) throw new WorkflowError('plan-reference-invalid', `${subject} references ref "${invalid}" that was not injected for this stage and kind.`, 422)
  }
  assertPromptRefs(input.requiredPolicyRefs, ['policy_constraint'], 'Required policy set')
  for (const workPackage of plan.workPackages) {
    assertKnownValues(workPackage.requirementKeys, requirementKeys, 'plan-reference-invalid', `Work package "${workPackage.key}"`)
    assertKnownValues(workPackage.acceptanceKeys, acceptanceKeys, 'plan-reference-invalid', `Work package "${workPackage.key}"`)
    assertKnownValues(workPackage.bindingKeys, bindingKeys, 'plan-reference-invalid', `Work package "${workPackage.key}"`)
  }
  for (const task of plan.tasks) {
    assertKnownValues([task.workPackageKey], workPackageKeys, 'plan-reference-invalid', `Task "${task.key}"`)
    assertKnownValues(task.requirementKeys, requirementKeys, 'plan-reference-invalid', `Task "${task.key}"`)
    assertKnownValues(task.acceptanceKeys, acceptanceKeys, 'plan-reference-invalid', `Task "${task.key}"`)
    assertKnownValues(task.scenarioKeys, scenarioKeys, 'plan-reference-invalid', `Task "${task.key}"`)
    assertKnownValues(task.decisionKeys, decisionKeys, 'plan-reference-invalid', `Task "${task.key}"`)
    assertKnownValues(task.bindingKeys, bindingKeys, 'plan-reference-invalid', `Task "${task.key}"`)
    assertKnownValues(task.dependencyKeys, taskKeys, 'unknown-dependency', `Task "${task.key}"`)
    const unresolved = task.decisionKeys.find((key) => !resolvedDecisionKeys.has(key))
    if (unresolved !== undefined) throw new WorkflowError('plan-decision-unresolved', `Task "${task.key}" references unresolved Decision "${unresolved}".`, 422)
    assertPromptRefs(task.policyConstraintRefs, ['policy_constraint'], `Task "${task.key}"`)
    assertPromptRefs(task.evidenceClaimRefs, ['evidence_claim'], `Task "${task.key}"`)
    assertPromptRefs(task.verificationCommandRefs, ['verification_command'], `Task "${task.key}"`)
    assertPromptRefs(task.contextPack.currentBehaviorClaimRefs, ['evidence_claim'], `Task "${task.key}" context`)
    assertPromptRefs(task.contextPack.startingPoints.map((item) => item.evidenceRef), ['evidence_claim', 'repository_evidence'], `Task "${task.key}" context`)
    assertPromptRefs(task.contextPack.verificationSteps.flatMap((item) => item.commandEvidenceRef === undefined ? [] : [item.commandEvidenceRef]), ['verification_command'], `Task "${task.key}" context`)
    if (task.contextPack.unknowns.some((unknown) => unknown.blocking)) throw new WorkflowError('task-context-blocking-unknown', `Task "${task.key}" contains a blocking unknown.`, 422)
    if (task.kind === 'test' && task.scenarioKeys.some((key) => uiScenarioKeys.has(key)) && task.changeContract.allowedPathScopes.some(ownsBrowserScope) && task.contextPack.verificationHarness === undefined) {
      throw new WorkflowError('browser-infrastructure-harness-contract-missing', `Task "${task.key}" owns a dedicated browser-test scope but has no executable browser harness contract for capability derivation.`, 422)
    }
    if (task.relationship === 'implementation' && task.contextPack.verificationHarness !== undefined && !task.changeContract.allowedPathScopes.some(ownsBrowserScope)) {
      throw new WorkflowError('browser-harness-ownership-invalid', `Implementation Task "${task.key}" declares a browser harness without owning browser-test infrastructure; keep its verification local to its executable commands and leave browser observations to dependent browser Tasks.`, 422)
    }
    if (task.contextPack.verificationHarness !== undefined && !task.verificationCommandRefs.some((ref) => /(?:^|[\s:/.\-])(?:test|verify|browser|e2e|playwright|cypress)(?:[\s:/.\-]|$)/iu.test(verificationCommandByRef.get(ref) ?? ''))) {
      throw new WorkflowError('verification-harness-command-mismatch', `Task "${task.key}" declares a browser harness but none of its verification commands execute a test, verify, browser, or e2e lifecycle.`, 422)
    }
    const allowedBindingScopes = task.bindingKeys.flatMap((key) => input.bindingScopes?.[key] ?? [])
    if (allowedBindingScopes.length > 0 && task.changeContract.allowedPathScopes.some((scope) => !allowedBindingScopes.some((allowed) => scopeIsWithin(scope, allowed)))) {
      throw new WorkflowError('task-scope-expanded', `Task "${task.key}" expands beyond its evidence-backed Binding scope.`, 422)
    }
    const expectedOutsideAllowed = task.contextPack.expectedChangeSurfaces.find((surface) => !task.changeContract.allowedPathScopes.some((allowed) => scopeIsWithin(surface, allowed)))
    if (expectedOutsideAllowed !== undefined) throw new WorkflowError('task-context-surface-outside-write-scope', `Task "${task.key}" expects to change "${expectedOutsideAllowed}" but does not include it in allowedPathScopes.`, 422)
    const expectedInsideExcluded = task.contextPack.expectedChangeSurfaces.find((surface) => task.changeContract.excludedPathScopes.some((excluded) => scopeIsWithin(surface, excluded)))
    if (expectedInsideExcluded !== undefined) throw new WorkflowError('task-context-surface-excluded', `Task "${task.key}" expects to change "${expectedInsideExcluded}" but explicitly excludes that surface.`, 422)
    const expectedInsideForbidden = task.contextPack.expectedChangeSurfaces.find((surface) => task.contextPack.forbiddenChangeSurfaces.some((forbidden) => scopeIsWithin(surface, forbidden)))
    if (expectedInsideForbidden !== undefined) throw new WorkflowError('task-context-surface-forbidden', `Task "${task.key}" expects to change "${expectedInsideForbidden}" but also marks it forbidden.`, 422)
    const whollyExcludedAllowed = task.changeContract.allowedPathScopes.find((allowed) => task.changeContract.excludedPathScopes.some((excluded) => scopeIsWithin(allowed, excluded)))
    if (whollyExcludedAllowed !== undefined) throw new WorkflowError('task-write-scope-contradictory', `Task "${task.key}" allows "${whollyExcludedAllowed}" but also excludes the entire scope.`, 422)
    const contractText = planTaskContractText(task)
    for (const bindingKey of task.bindingKeys) {
      for (const [symbol, ownerPaths] of Object.entries(input.bindingOwnerPathsBySymbol?.[bindingKey] ?? {})) {
        if (!taskClaimsOwnerSymbolChange(task, symbol)) continue
        if (!ownerPaths.some((path) => task.changeContract.allowedPathScopes.some((allowed) => scopeIsWithin(path, allowed)))) {
          throw new WorkflowError('task-contract-owner-outside-write-scope', `Task "${task.key}" claims a change to owner symbol "${symbol}" but none of its declaring paths (${ownerPaths.join(', ')}) is included in allowedPathScopes.`, 422)
        }
        if (ownerPaths.some((path) => task.changeContract.excludedPathScopes.some((excluded) => scopeIsWithin(path, excluded)))) {
          throw new WorkflowError('task-contract-owner-excluded', `Task "${task.key}" names owner symbol "${symbol}" but explicitly excludes a declaring path.`, 422)
        }
      }
    }
    if (input.stageIdentifierCompatibilityRequired === false && mentionsUnknownStageCompatibility(contractText)) {
      throw new WorkflowError('task-stage-compatibility-unrequired', `Task "${task.key}" introduces unknown or future stage-identifier compatibility that no frozen Requirement or Acceptance requires.`, 422)
    }
  }
  const uiScenariosWithoutBrowserVerification = [...uiScenarioKeys].filter((scenarioKey) => !plan.tasks.some((task) => task.relationship === 'verification'
    && task.scenarioKeys.includes(scenarioKey)
    && task.contextPack.verificationHarness?.kind === 'browser'))
  if (uiScenariosWithoutBrowserVerification.length > 0) {
    throw new WorkflowError('ui-verification-harness-missing', `UI Scenarios have no verification Task with an executable browser harness contract: ${uiScenariosWithoutBrowserVerification.join(', ')}`, 422)
  }
  const missingPolicyRefs = input.requiredPolicyRefs.filter((ref) => !plan.tasks.some((task) => task.policyConstraintRefs.includes(ref) && task.verificationCommandRefs.length > 0))
  if (missingPolicyRefs.length > 0) throw new WorkflowError('policy-fulfillment-missing', `Applicable MUST policies have no Task with verification fulfillment: ${missingPolicyRefs.join(', ')}`, 422)
  for (const policyRef of input.requiredPolicyRefs) {
    const subjects = input.requiredPolicySubjectsByRef?.[policyRef]
    if (subjects === undefined) continue
    const missingRequirements = subjects.requirementKeys.filter((requirementKey) => !plan.tasks.some((task) => task.policyConstraintRefs.includes(policyRef) && task.requirementKeys.includes(requirementKey) && task.verificationCommandRefs.length > 0))
    const missingScenarios = subjects.scenarioKeys.filter((scenarioKey) => !plan.tasks.some((task) => task.policyConstraintRefs.includes(policyRef) && task.scenarioKeys.includes(scenarioKey) && task.verificationCommandRefs.length > 0))
    if (missingRequirements.length > 0 || missingScenarios.length > 0) {
      throw new WorkflowError('policy-subject-fulfillment-missing', `Applicable MUST policy "${policyRef}" is not fulfilled for every mapped subject; Requirements: ${missingRequirements.join(', ') || 'none'}; Scenarios: ${missingScenarios.join(', ') || 'none'}.`, 422)
    }
  }
  for (const policyRef of input.requiredPolicyRefs) {
    const statement = input.requiredPolicyStatementsByRef?.[policyRef]
    if (statement === undefined || !/(?:mutation|修改请求|变更请求|写请求)/iu.test(statement) || !/(?:loopback|回环)/iu.test(statement) || !/\bpeer\b/iu.test(statement) || !/\bhost\b/iu.test(statement) || !/\borigin\b/iu.test(statement) || !/fetch[\s-]*metadata/iu.test(statement)) continue
    const gaps = mutationSourcePolicyCoverageGaps(plan, policyRef)
    if (gaps.length > 0) throw new WorkflowError('mutation-source-policy-coverage-incomplete', `Mutation-source policy "${policyRef}" lacks executable positive/negative boundary coverage with before/after zero-write evidence: ${gaps.join(', ')}`, 422)
  }
  topologicalTasks(plan.tasks.map((task, ordinal) => ({ id: task.key, dependencies: task.dependencyKeys, ordinal })))
  const taskByKey = new Map(plan.tasks.map((task) => [task.key, task]))
  const dependsOn = (taskKey: string, candidateDependencyKey: string): boolean => {
    const pending = [...(taskByKey.get(taskKey)?.dependencyKeys ?? [])]
    const visited = new Set<string>()
    while (pending.length > 0) {
      const dependencyKey = pending.pop()!
      if (dependencyKey === candidateDependencyKey) return true
      if (visited.has(dependencyKey)) continue
      visited.add(dependencyKey)
      pending.push(...(taskByKey.get(dependencyKey)?.dependencyKeys ?? []))
    }
    return false
  }
  const browserInfrastructureTasks = plan.tasks.filter((task) => task.relationship === 'implementation' && task.changeContract.allowedPathScopes.some(ownsBrowserScope))
  for (const task of plan.tasks.filter((candidate) => candidate.contextPack.verificationHarness !== undefined && !browserInfrastructureTasks.some((infrastructure) => infrastructure.key === candidate.key))) {
    if (browserInfrastructureTasks.length > 0 && !browserInfrastructureTasks.some((infrastructure) => dependsOn(task.key, infrastructure.key))) {
      throw new WorkflowError('browser-harness-infrastructure-dependency-missing', `Task "${task.key}" declares a browser harness but has no dependency path to browser infrastructure Task(s): ${browserInfrastructureTasks.map((item) => item.key).join(', ')}`, 422)
    }
  }
  for (let leftIndex = 0; leftIndex < plan.tasks.length; leftIndex += 1) {
    const left = plan.tasks[leftIndex]!
    for (let rightIndex = leftIndex + 1; rightIndex < plan.tasks.length; rightIndex += 1) {
      const right = plan.tasks[rightIndex]!
      const overlappingScopes = left.changeContract.allowedPathScopes.filter((leftScope) => right.changeContract.allowedPathScopes.some((rightScope) => scopesIntersect(leftScope, rightScope)))
      if (overlappingScopes.length === 0 || dependsOn(left.key, right.key) || dependsOn(right.key, left.key)) continue
      const rightConflictKeys = new Set(right.changeContract.conflictKeys)
      if (left.changeContract.conflictKeys.some((key) => rightConflictKeys.has(key))) continue
      throw new WorkflowError('parallel-write-conflict-uncontrolled', `Tasks "${left.key}" and "${right.key}" have overlapping write scopes without a dependency path or shared conflict key: ${overlappingScopes.join(', ')}`, 422)
    }
  }
  const assertDualCoverage = (key: string, field: 'acceptanceKeys' | 'scenarioKeys', label: string): void => {
    const related = plan.tasks.filter((task) => task[field].includes(key))
    if (!related.some((task) => task.relationship === 'implementation')) throw new WorkflowError(`${label}-implementation-missing`, `${label} "${key}" has no implementation task.`, 422)
    if (!related.some((task) => task.relationship === 'verification')) throw new WorkflowError(`${label}-verification-missing`, `${label} "${key}" has no verification task.`, 422)
  }
  for (const key of input.requiredAcceptanceKeys) assertDualCoverage(key, 'acceptanceKeys', 'acceptance')
  for (const key of input.requiredScenarioKeys) assertDualCoverage(key, 'scenarioKeys', 'scenario')
  for (const task of plan.tasks.filter((item) => item.relationship === 'verification' || item.relationship === 'review' || item.relationship === 'release')) {
    if (!plan.tasks.some((candidate) => candidate.relationship === 'implementation' && dependsOn(task.key, candidate.key))) {
      throw new WorkflowError('task-relationship-dependency-invalid', `Task "${task.key}" must have a dependency path to an implementation task.`, 422)
    }
  }
  return plan
}

const IMPACT_CAPABILITY: Partial<Record<GeneratedBindingAnalysisV3['bindings'][number]['impactAssessments'][number]['dimension'], string>> = {
  data: 'data.change', state: 'domain.state', api: 'api.contract', permission: 'security.authorization', async: 'integration.async',
  consumer: 'integration.consumer', failure: 'reliability.failure-handling', test: 'testing.automation', migration: 'database.migration',
  release: 'release.delivery', rollback: 'release.rollback',
}

export function derivePolicyCapabilityIdsV3(statement: string): string[] {
  const securityBoundary = /(?:\borigin\b|fetch\s+metadata|\bcsrf\b|\bauthori[sz](?:ation|ed?)\b|\bauthentication\b|\bpermission\b|loopback\s+(?:peer|host)|回环|同源|鉴权|授权|权限|身份认证)/iu
  return securityBoundary.test(statement) ? ['security.authorization'] : []
}

function scopeUsesLanguageCapability(scope: string, capability: string): boolean {
  if (capability === 'language.typescript') return /\.(?:ts|tsx|mts|cts)$/iu.test(scope)
  if (capability === 'language.javascript') return /\.(?:js|jsx|mjs|cjs)$/iu.test(scope)
  return false
}

export function deriveCapabilityRequirementDraftsV3(
  plan: GeneratedPlanV3,
  bindingAnalysis: GeneratedBindingAnalysisV3,
  input: {
    projectId: string
    operationId: string
    reservedTaskIdsByKey: Record<string, string>
    stackCapabilityEvidence: Array<{ capability: string; evidencePaths: string[] }>
    repositoryEvidencePathByRef: Record<string, string>
    policyCapabilitiesByRef?: Record<string, string[]>
    now?: string
    derivationRuleVersion?: string
  },
): CapabilityRequirementDraftRecord[] {
  if (plan.status !== 'ready' || bindingAnalysis.status !== 'ready') return []
  const createdAt = input.now ?? new Date().toISOString()
  const ruleVersion = input.derivationRuleVersion ?? 'v3.3.13'
  const bindings = new Map(bindingAnalysis.bindings.map((binding) => [binding.key, binding]))
  const tasks = new Map(plan.tasks.map((task) => [task.key, task]))
  const roleByRelationship: Record<GeneratedPlanV3['tasks'][number]['relationship'], DeliveryRole> = {
    implementation: 'implementer', verification: 'verifier', review: 'reviewer', migration: 'specialist', release: 'release',
  }
  const pathsIntersect = (left: string, right: string): boolean => scopeIsWithin(left, right) || scopeIsWithin(right, left)
  const directCapabilities = new Map<string, Set<string>>()
  const impactCapabilitiesByTask = new Map<string, Set<string>>()
  const verifiableFrameworkCapabilitiesByTask = new Map<string, Set<string>>()
  for (const task of plan.tasks) {
    const reservedTaskId = input.reservedTaskIdsByKey[task.key]
    if (reservedTaskId === undefined) throw new WorkflowError('planning-reference-map-incomplete', `Task "${task.key}" has no reserved Task id.`, 500)
    const sourceBindings = task.bindingKeys.map((key) => bindings.get(key)).filter((binding): binding is NonNullable<typeof binding> => binding !== undefined)
    if (sourceBindings.length !== task.bindingKeys.length) throw new WorkflowError('capability-binding-missing', `Task "${task.key}" has no complete Binding input.`, 422)
    const taskScopes = task.changeContract.allowedPathScopes
    const verifiesBindingBehavior = task.relationship === 'verification' || task.relationship === 'review' || task.relationship === 'release'
    const capabilities = new Set(input.stackCapabilityEvidence
      .filter((stackCapability) => {
        if (stackCapability.capability.startsWith('language.')) {
          return taskScopes.some((scope) => scopeUsesLanguageCapability(scope, stackCapability.capability))
            || stackCapability.evidencePaths.some((path) => taskScopes.some((scope) => !/\.[a-z0-9]+$/iu.test(scope) && scopeIsWithin(path, scope)))
        }
        return stackCapability.evidencePaths.some((path) => taskScopes.some((scope) => pathsIntersect(path, scope))
          && (!stackCapability.capability.startsWith('framework.') || !/(^|\/)(?:package\.json|[^/]*lock[^/]*)$/iu.test(path)))
      })
      .map((stackCapability) => stackCapability.capability))
    for (const policyRef of task.policyConstraintRefs) {
      for (const capability of input.policyCapabilitiesByRef?.[policyRef] ?? []) capabilities.add(capability)
    }
    for (const assessment of sourceBindings.flatMap((binding) => binding.impactAssessments.filter((item) => item.applicability === 'required'))) {
      const evidencePaths = assessment.evidenceRefs.map((ref) => input.repositoryEvidencePathByRef[ref])
      if (evidencePaths.some((path) => path === undefined)) throw new WorkflowError('capability-evidence-unresolved', `Task "${task.key}" has an impact assessment with unresolved repository evidence.`, 422)
      const capability = IMPACT_CAPABILITY[assessment.dimension]
      const specializedRelationshipMatches = assessment.dimension === 'migration'
        ? task.relationship === 'migration'
        : assessment.dimension === 'release' || assessment.dimension === 'rollback'
          ? task.relationship === 'migration' || task.relationship === 'release'
          : true
      const ownsImpactSurface = evidencePaths.some((path) => taskScopes.some((scope) => pathsIntersect(path!, scope)))
      const verifiesImpactWithoutOwningSource = verifiesBindingBehavior && assessment.dimension !== 'data'
      if (capability !== undefined && specializedRelationshipMatches && (ownsImpactSurface || verifiesImpactWithoutOwningSource)) capabilities.add(capability)
    }
    const consumerEvidencePaths = sourceBindings.flatMap((binding) => binding.impactAssessments
      .filter((assessment) => assessment.dimension === 'consumer' && assessment.applicability === 'required')
      .flatMap((assessment) => assessment.evidenceRefs.map((ref) => input.repositoryEvidencePathByRef[ref])))
    if (consumerEvidencePaths.some((path) => path === undefined)) throw new WorkflowError('capability-evidence-unresolved', `Task "${task.key}" has a consumer impact with unresolved repository evidence.`, 422)
    for (const stackCapability of input.stackCapabilityEvidence.filter((item) => item.capability.startsWith('framework.'))) {
      const frameworkConsumerPaths = stackCapability.evidencePaths.filter((path) => !/(^|\/)(?:package\.json|[^/]*lock[^/]*)$/iu.test(path)
        && consumerEvidencePaths.some((consumerPath) => pathsIntersect(path, consumerPath!)))
      const ownsFrameworkConsumerSurface = frameworkConsumerPaths.some((path) => taskScopes.some((scope) => pathsIntersect(path, scope)))
      if (ownsFrameworkConsumerSurface) capabilities.add(stackCapability.capability)
      if (frameworkConsumerPaths.length > 0) {
        const verifiable = verifiableFrameworkCapabilitiesByTask.get(task.key) ?? new Set<string>()
        verifiable.add(stackCapability.capability)
        verifiableFrameworkCapabilitiesByTask.set(task.key, verifiable)
      }
    }
    const ownsBrowserVerification = task.contextPack.verificationHarness !== undefined || taskScopes.some(ownsBrowserScope)
    if (task.relationship === 'verification' || task.relationship === 'release') capabilities.add('testing.verification')
    if (task.relationship === 'review') capabilities.add('review.independent')
    if (task.relationship === 'migration') capabilities.add('database.migration')
    if (task.relationship === 'release') {
      capabilities.add('release.delivery')
      capabilities.add('build.process-orchestration')
      if (ownsBrowserVerification) capabilities.add('testing.browser-e2e')
    }
    if (task.relationship === 'implementation' && taskScopes.some(ownsReleaseLifecycleScope)) {
      capabilities.add('build.process-orchestration')
      capabilities.add('release.delivery')
    }
    if (task.contextPack.verificationHarness !== undefined) {
      capabilities.add('testing.browser-e2e')
      capabilities.add('testing.verification')
      const hasBoundDataImpact = sourceBindings.some((binding) => binding.impactAssessments.some((assessment) => assessment.dimension === 'data' && assessment.applicability === 'required'))
      const hasBoundPermissionImpact = sourceBindings.some((binding) => binding.impactAssessments.some((assessment) => assessment.dimension === 'permission' && assessment.applicability === 'required'))
      if (task.contextPack.verificationHarness.fixtureMutation === 'create_and_cleanup' && hasBoundDataImpact) capabilities.add('data.change')
      if (hasBoundPermissionImpact) capabilities.add('security.authorization')
    }
    directCapabilities.set(task.key, capabilities)
    impactCapabilitiesByTask.set(task.key, new Set(sourceBindings.flatMap((binding) => binding.impactAssessments
      .filter((assessment) => assessment.applicability === 'required')
      .map((assessment) => IMPACT_CAPABILITY[assessment.dimension])
      .filter((capability): capability is string => capability !== undefined))))
  }
  const resolvedCapabilities = new Map<string, Set<string>>()
  const resolving = new Set<string>()
  const hasFrameworkImplementationDependency = (task: GeneratedPlanV3['tasks'][number], capability: string): boolean => {
    const bindingKeys = new Set(task.bindingKeys)
    const pending = [...task.dependencyKeys]
    const visited = new Set<string>()
    while (pending.length > 0) {
      const dependencyKey = pending.pop()!
      if (visited.has(dependencyKey)) continue
      visited.add(dependencyKey)
      const dependency = tasks.get(dependencyKey)
      if (dependency === undefined || !dependency.bindingKeys.some((key) => bindingKeys.has(key))) continue
      if (dependency.relationship === 'implementation' && directCapabilities.get(dependencyKey)?.has(capability)) return true
      pending.push(...dependency.dependencyKeys)
    }
    return false
  }
  const capabilitiesFor = (taskKey: string): Set<string> => {
    const resolved = resolvedCapabilities.get(taskKey)
    if (resolved !== undefined) return resolved
    if (resolving.has(taskKey)) throw new WorkflowError('dependency-cycle', `Task capability inheritance contains a cycle at "${taskKey}".`, 422)
    const task = tasks.get(taskKey)
    if (task === undefined) throw new WorkflowError('unknown-dependency', `Capability derivation cannot resolve task "${taskKey}".`, 422)
    resolving.add(taskKey)
    const capabilities = new Set(directCapabilities.get(taskKey) ?? [])
    if (task.contextPack.verificationHarness !== undefined || task.relationship === 'verification' || task.relationship === 'review' || task.relationship === 'release') {
      const relevantImpactCapabilities = impactCapabilitiesByTask.get(task.key) ?? new Set<string>()
      for (const dependencyKey of task.dependencyKeys) {
        const dependency = tasks.get(dependencyKey)
        if (dependency === undefined || !dependency.bindingKeys.some((key) => task.bindingKeys.includes(key))) continue
        for (const capability of capabilitiesFor(dependencyKey)) {
          if (relevantImpactCapabilities.has(capability)) capabilities.add(capability)
        }
      }
      if (task.relationship === 'verification' || task.relationship === 'review' || task.relationship === 'release') {
        const ownsBrowserVerification = task.contextPack.verificationHarness !== undefined || task.changeContract.allowedPathScopes.some(ownsBrowserScope)
        for (const capability of verifiableFrameworkCapabilitiesByTask.get(task.key) ?? []) {
          if (ownsBrowserVerification || hasFrameworkImplementationDependency(task, capability)) capabilities.add(capability)
        }
      }
    }
    resolving.delete(taskKey)
    if (capabilities.size === 0) throw new WorkflowError('capability-mapping-unresolved', `Task "${task.key}" has no capability mapping from current stack, Bindings, or verified implementation dependencies.`, 422)
    resolvedCapabilities.set(taskKey, capabilities)
    return capabilities
  }
  return plan.tasks.map((task) => {
    const reservedTaskId = input.reservedTaskIdsByKey[task.key]
    if (reservedTaskId === undefined) throw new WorkflowError('planning-reference-map-incomplete', `Task "${task.key}" has no reserved Task id.`, 500)
    const capabilities = capabilitiesFor(task.key)
    const core = {
      projectId: input.projectId, operationId: input.operationId, reservedTaskId, taskKey: task.key,
      requiredRoles: [roleByRelationship[task.relationship]], requiredCapabilities: [...capabilities].sort(),
      requiresIndependentReviewer: task.relationship === 'review' || task.risk === 'high' || task.risk === 'critical',
      derivationRuleVersion: ruleVersion, sourceBindingKeys: [...task.bindingKeys].sort(),
    }
    return {
      id: `capreq:${input.operationId}:${task.key}`,
      ...core,
      requirementDigest: digestObject(core),
      createdAt,
    }
  })
}

export interface AssignmentCandidateV3 {
  agentId: string
  activeMembership: boolean
  autoAssignable: boolean
  deliveryRoles: DeliveryRole[]
  claimedCapabilityIds: string[]
  trustedCapabilityIds: string[]
  repositoryAccess: boolean
  runtimeCompatible: boolean
  runtimeStatus: 'online' | 'offline' | 'unstable'
  availableSlots: number
  activeConflict?: boolean
  affinityScore?: number
}

export function qualifyAssignmentsV3(
  requirements: CapabilityRequirementDraftRecord[],
  candidates: AssignmentCandidateV3[],
  input: { projectId: string; operationId: string; metricPolicyId: string; metricPolicyVersion: string; metricPolicyDigest: string; risk: 'low' | 'medium' | 'high' | 'critical'; now?: string },
): { drafts: AssignmentDraftRecord[]; evaluations: AssignmentEvaluationRecord[] } {
  const createdAt = input.now ?? new Date().toISOString()
  const drafts: AssignmentDraftRecord[] = []
  const evaluations: AssignmentEvaluationRecord[] = []
  for (const requirement of requirements) {
    const evaluated = candidates.map((candidate) => {
      const reasonCodes: string[] = []
      if (!candidate.activeMembership) reasonCodes.push('membership-inactive')
      if (!candidate.autoAssignable) reasonCodes.push('auto-assignment-disabled')
      if (requirement.requiredRoles.some((role) => !candidate.deliveryRoles.includes(role))) reasonCodes.push('role-missing')
      const missingClaim = requirement.requiredCapabilities.find((capability) => !candidate.claimedCapabilityIds.includes(capability))
      if (missingClaim !== undefined) reasonCodes.push('capability-claim-missing')
      const untrustedClaim = requirement.requiredCapabilities.find((capability) => candidate.claimedCapabilityIds.includes(capability) && !candidate.trustedCapabilityIds.includes(capability))
      if (untrustedClaim !== undefined) reasonCodes.push('capability-claim-untrusted')
      if (!candidate.repositoryAccess) reasonCodes.push('repository-access-missing')
      if (!candidate.runtimeCompatible) reasonCodes.push('runtime-incompatible')
      return { candidate, reasonCodes, structuralEligibility: reasonCodes.length === 0 ? 'eligible' as const : 'ineligible' as const }
    })
    const eligible = evaluated.filter((item) => item.structuralEligibility === 'eligible').sort((left, right) => (right.candidate.affinityScore ?? 0) - (left.candidate.affinityScore ?? 0) || left.candidate.agentId.localeCompare(right.candidate.agentId))
    const topScore = eligible[0]?.candidate.affinityScore ?? 0
    const ambiguous = requirement.requiresIndependentReviewer && eligible.filter((item) => (item.candidate.affinityScore ?? 0) === topScore).length > 1
    const selected = ambiguous ? undefined : eligible[0]?.candidate
    const outcome: AssignmentEvaluationRecord['outcome'] = selected !== undefined
      ? 'selected'
      : ambiguous
        ? 'abstained_ambiguous'
        : evaluated.some((item) => item.reasonCodes.includes('repository-access-missing'))
          ? 'abstained_access'
          : evaluated.some((item) => item.reasonCodes.includes('runtime-incompatible'))
            ? 'abstained_runtime_incompatible'
            : 'abstained_no_eligible'
    const dispatchStatus = selected === undefined ? 'blocked' as const
      : selected.runtimeStatus !== 'online' ? 'waiting_runtime' as const
        : selected.availableSlots <= 0 ? 'waiting_capacity' as const
          : selected.activeConflict ? 'waiting_conflict' as const
            : 'dispatchable' as const
    const draftCore = {
      projectId: input.projectId, operationId: input.operationId, reservedTaskId: requirement.reservedTaskId, taskKey: requirement.taskKey,
      capabilityRequirementDraftId: requirement.id,
      candidates: evaluated.map((item) => ({ agentId: item.candidate.agentId, structuralEligibility: item.structuralEligibility, reasonCodes: item.reasonCodes })),
      ...(selected === undefined ? {} : { selectedTargetType: 'agent' as const, selectedTargetId: selected.agentId, executingAgentId: selected.agentId }),
      dispatchStatus,
    }
    const draft = AssignmentDraftRecordSchema.parse({ id: `assignment-draft:${input.operationId}:${requirement.taskKey}`, ...draftCore, assignmentDraftDigest: digestObject(draftCore), createdAt })
    const evaluationCore = {
      projectId: input.projectId, operationId: input.operationId, taskKey: requirement.taskKey, assignmentDraftId: draft.id,
      evaluationCohort: 'production' as const, risk: input.risk,
      assignmentDraftDigest: draft.assignmentDraftDigest, eligibleAgentIds: eligible.map((item) => item.candidate.agentId),
      ...(selected === undefined ? {} : { selectedTargetType: 'agent' as const, selectedTargetId: selected.agentId, executingAgentId: selected.agentId }),
      outcome,
      reasonCodes: outcome === 'selected' ? ['structural-eligibility-passed'] : outcome === 'abstained_ambiguous' ? ['assignment-owner-ambiguous'] : [outcome.replace('abstained_', '')],
      reasonSourceRecordIds: [requirement.id],
      metricPolicyId: input.metricPolicyId,
      metricPolicyVersion: input.metricPolicyVersion,
      metricPolicyDigest: input.metricPolicyDigest,
    }
    const evaluation = AssignmentEvaluationRecordSchema.parse({ id: `assignment-evaluation:${input.operationId}:${requirement.taskKey}`, ...evaluationCore, evaluationDigest: digestObject(evaluationCore), createdAt })
    drafts.push(draft)
    evaluations.push(evaluation)
  }
  return { drafts, evaluations }
}

export interface TaskPreflightReportV3 {
  agentId: string
  agentReportedStatus: 'accepted' | 'needs_clarification' | 'rejected'
  identityAuditable: boolean
  structuralEligible: boolean
  accessCurrent: boolean
  contextCurrent: boolean
  evidenceRead: boolean
  objectiveRestated: boolean
  startingPointCovered: boolean
  allowedScopeCovered: boolean
  forbiddenScopeAcknowledged: boolean
  verificationCovered: boolean
  escalationCovered: boolean
  noBlockingUnknowns: boolean
  missingFacts: string[]
}

export function evaluateTaskPreflightV3(
  assignment: AssignmentDraftRecord,
  report: TaskPreflightReportV3,
  input: { id: string; now?: string },
): TaskPreflightRecordV3 {
  const noBlockingUnknowns = report.noBlockingUnknowns && report.missingFacts.length === 0 && report.agentReportedStatus === 'accepted'
  const definitions: Array<{ code: TaskPreflightRecordV3['acceptanceChecks'][number]['code']; pass: boolean; failureDisposition: 'clarify_upstream' | 'reject_candidate'; restartStage: TaskPreflightRecordV3['acceptanceChecks'][number]['restartStage'] }> = [
    { code: 'agent_matches_assignment', pass: report.agentId === assignment.executingAgentId, failureDisposition: 'reject_candidate', restartStage: 'assignment_qualification' },
    { code: 'identity_auditable', pass: report.identityAuditable, failureDisposition: 'reject_candidate', restartStage: 'assignment_qualification' },
    { code: 'structurally_eligible', pass: report.structuralEligible && assignment.candidates.some((candidate) => candidate.agentId === report.agentId && candidate.structuralEligibility === 'eligible'), failureDisposition: 'reject_candidate', restartStage: 'assignment_qualification' },
    { code: 'access_current', pass: report.accessCurrent, failureDisposition: 'reject_candidate', restartStage: 'assignment_qualification' },
    { code: 'context_current', pass: report.contextCurrent, failureDisposition: 'clarify_upstream', restartStage: 'code_binding' },
    { code: 'evidence_read', pass: report.evidenceRead, failureDisposition: 'clarify_upstream', restartStage: 'code_binding' },
    { code: 'objective_restated', pass: report.objectiveRestated, failureDisposition: 'clarify_upstream', restartStage: 'task_plan' },
    { code: 'starting_point_covered', pass: report.startingPointCovered, failureDisposition: 'clarify_upstream', restartStage: 'code_binding' },
    { code: 'allowed_scope_covered', pass: report.allowedScopeCovered, failureDisposition: 'clarify_upstream', restartStage: 'task_plan' },
    { code: 'forbidden_scope_acknowledged', pass: report.forbiddenScopeAcknowledged, failureDisposition: 'clarify_upstream', restartStage: 'task_plan' },
    { code: 'verification_covered', pass: report.verificationCovered, failureDisposition: 'clarify_upstream', restartStage: 'plan_review' },
    { code: 'escalation_covered', pass: report.escalationCovered, failureDisposition: 'clarify_upstream', restartStage: 'task_plan' },
    { code: 'no_blocking_unknowns', pass: noBlockingUnknowns, failureDisposition: 'clarify_upstream', restartStage: 'requirement_analysis' },
  ]
  const checks = definitions.map(({ code, pass, failureDisposition, restartStage }) => ({ code, status: pass ? 'pass' as const : 'fail' as const, ...(pass ? {} : { failureDisposition, restartStage }) }))
  const hasReject = checks.some((check) => check.status === 'fail' && check.failureDisposition === 'reject_candidate')
  const hasClarification = checks.some((check) => check.status === 'fail')
  const serviceVerdict = hasReject ? 'rejected' as const
    : hasClarification ? 'needs_clarification' as const
      : 'accepted' as const
  const core = {
    projectId: assignment.projectId, operationId: assignment.operationId, reservedTaskId: assignment.reservedTaskId, taskKey: assignment.taskKey,
    assignmentDraftId: assignment.id, assignmentDraftDigest: assignment.assignmentDraftDigest, agentId: report.agentId,
    agentReportedStatus: report.agentReportedStatus, serviceVerdict, acceptanceChecks: checks, missingFacts: report.missingFacts,
    verdictInputDigest: digestObject({ assignmentDigest: assignment.assignmentDraftDigest, report }),
  }
  return TaskPreflightRecordV3Schema.parse({ id: input.id, ...core, preflightDigest: digestObject(core), createdAt: input.now ?? new Date().toISOString() })
}

export interface DispatchTaskV3 {
  id: string
  revision: number
  dependencies: string[]
  status: TaskRecord['status']
  dispatchStatus: 'dispatchable' | 'waiting_runtime' | 'waiting_capacity' | 'waiting_conflict' | 'blocked'
  stale?: boolean
}

export function planExecutionDispatchV3(
  tasks: DispatchTaskV3[],
  input: { projectId: string; approvalId: string; expectedProjectRevision: number; requestedTaskIds: string[]; gateCurrent: boolean; gateDigest: string; idempotencyKey: string; taskRunIdsByTaskId: Record<string, string>; now?: string },
): ExecutionDispatchRecord {
  assertUniqueKeys(input.requestedTaskIds, 'dispatch-task-duplicate')
  const byId = new Map(tasks.map((task) => [task.id, task]))
  const unknown = input.requestedTaskIds.find((id) => !byId.has(id))
  if (unknown !== undefined) throw new WorkflowError('dispatch-task-unknown', `Dispatch references unknown task "${unknown}".`, 400)
  const requested = input.requestedTaskIds.map((id) => byId.get(id)!)
  const hardStale = !input.gateCurrent || requested.some((task) => task.stale)
  const hardBlocked = requested.some((task) => task.dispatchStatus === 'blocked' || ['blocked', 'failed', 'cancelled', 'completed'].includes(task.status))
  const completed = new Set(tasks.filter((task) => task.status === 'completed').map((task) => task.id))
  const taskResults: ExecutionDispatchRecord['taskResults'] = requested.map((task) => {
    const predecessorTaskIds = [...task.dependencies]
    if (hardStale) return { taskId: task.id, taskRevision: task.revision, outcome: 'stale', predecessorTaskIds, reasonCodes: ['plan-stale'] }
    if (hardBlocked) return { taskId: task.id, taskRevision: task.revision, outcome: 'blocked', predecessorTaskIds, reasonCodes: ['dispatch-hard-blocked'] }
    const waitingDependencies = task.dependencies.filter((id) => !completed.has(id))
    if (waitingDependencies.length > 0) return { taskId: task.id, taskRevision: task.revision, outcome: 'waiting_dependency', predecessorTaskIds, reasonCodes: ['dependency-not-completed'] }
    if (task.dispatchStatus !== 'dispatchable') return { taskId: task.id, taskRevision: task.revision, outcome: task.dispatchStatus, predecessorTaskIds, reasonCodes: [task.dispatchStatus.replace('waiting_', '')] }
    const taskRunId = input.taskRunIdsByTaskId[task.id]
    if (taskRunId === undefined) throw new WorkflowError('task-run-id-missing', `Runnable task "${task.id}" has no reserved TaskRun id.`, 500)
    return { taskId: task.id, taskRevision: task.revision, outcome: 'started', predecessorTaskIds, reasonCodes: [], taskRunId }
  })
  const createdTaskRunIds = taskResults.flatMap((result) => result.outcome === 'started' && result.taskRunId !== undefined ? [result.taskRunId] : [])
  const outcome: ExecutionDispatchRecord['outcome'] = hardStale ? 'stale' : hardBlocked ? 'blocked'
    : createdTaskRunIds.length === 0 ? 'waiting'
      : createdTaskRunIds.length === taskResults.length ? 'started' : 'partially_started'
  const core = {
    projectId: input.projectId, approvalId: input.approvalId, expectedProjectRevision: input.expectedProjectRevision,
    requestedTaskIds: [...input.requestedTaskIds], outcome, taskResults, createdTaskRunIds, observedGateDigest: input.gateDigest,
    runnableFrontierDigest: digestObject(taskResults.map((result) => ({ taskId: result.taskId, taskRevision: result.taskRevision, outcome: result.outcome, predecessorTaskIds: result.predecessorTaskIds }))),
    idempotencyKey: input.idempotencyKey,
  }
  return ExecutionDispatchRecordSchema.parse({ id: `execution-dispatch:${input.projectId}:${input.idempotencyKey}`, ...core, dispatchDigest: digestObject(core), createdAt: input.now ?? new Date().toISOString() })
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
