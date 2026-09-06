import { posix } from 'node:path'
import type {
  PolicyApplicabilityDecision,
  PolicyArtifactKind,
  PolicyLifecycleStage,
  PolicyOperationKind,
  PolicyTargetSelector,
} from '../types.js'

const NORMATIVE_TERM = /(?:\bMUST(?:\s+NOT)?\b|\bSHALL(?:\s+NOT)?\b|必须|不得|严禁|禁止|不允许)/iu
const POLICY_APPLICABILITY_EVALUATOR_VERSION = 'policy-applicability-v3.4.0'

const OPERATION_PATTERNS: Array<[PolicyOperationKind, RegExp]> = [
  ['read', /(?:\bGET\b|\bread(?:s|ing)?\b|\bquery\b|\blist\b|\bview\b|只读|读取|查询|查看|列表)/iu],
  ['write', /(?:\bPOST\b|\bPUT\b|\bPATCH\b|\bmutation\b|\bwrite\b|\bcreate\b|\bupdate\b|\binsert\b|\bsave\b|写入|创建|更新|修改|变更|提交|持久化)/iu],
  ['delete', /(?:\bDELETE\b|\bdelete\b|\bremove\b|删除|移除|清理)/iu],
  ['publish', /(?:\bpublish\b|\brelease\b|\bnpm\b|发布|发版)/iu],
  ['deploy', /(?:\bdeploy\b|\bproduction\b|部署|生产环境|上线)/iu],
  ['network', /(?:\bnetwork\b|\bHTTP\b|\brequest\b|\borigin\b|fetch[\s-]*metadata|\bpeer\b|\bhost\b|网络|请求|同源|跨源|回环)/iu],
  ['credential', /(?:\bcredential\b|\bsecret\b|\btoken\b|\bpassword\b|凭证|密钥|令牌|密码)/iu],
]

const ARTIFACT_PATTERNS: Array<[PolicyArtifactKind, RegExp]> = [
  ['test', /(?:\btests?\b|\bspec\b|\bplaywright\b|\bcypress\b|测试|验收)/iu],
  ['schema', /(?:\bschema\b|\bmodel\b|数据模型|表结构)/iu],
  ['migration', /(?:\bmigrations?\b|\bDDL\b|迁移|回填)/iu],
  ['workflow', /(?:\bworkflow\b|\bCI\b|github actions|流水线)/iu],
  ['docs', /(?:\bdocs?\b|\bREADME\b|文档)/iu],
  ['source', /(?:\bsource\b|\bcode\b|\bimplementation\b|源码|代码|实现)/iu],
]

const LIFECYCLE_PATTERNS: Array<[PolicyLifecycleStage, RegExp]> = [
  ['plan', /(?:\bplan(?:ning)?\b|规划|拆解)/iu],
  ['implement', /(?:\bimplement(?:ation)?\b|\bcode\b|实现|编码)/iu],
  ['verify', /(?:\bverify\b|\bvalidation\b|\btests?\b|验证|测试|验收)/iu],
  ['integrate', /(?:\bintegrat(?:e|ion)\b|\bmerge\b|集成|合并)/iu],
  ['release', /(?:\brelease\b|\bpublish\b|\bdeploy\b|发布|部署|上线)/iu],
]

function normalizedScope(path: string): string {
  const normalized = path.replace(/\\/g, '/').replace(/^\.\//u, '').replace(/\/+$/u, '')
  return normalized === '' ? '.' : normalized
}

function scopesIntersect(left: string, right: string): boolean {
  const normalizedLeft = normalizedScope(left)
  const normalizedRight = normalizedScope(right)
  return normalizedLeft === '.' || normalizedRight === '.' || normalizedLeft === normalizedRight || normalizedLeft.startsWith(`${normalizedRight}/`) || normalizedRight.startsWith(`${normalizedLeft}/`)
}

function uniqueMatches<T extends string>(text: string, patterns: Array<[T, RegExp]>): T[] {
  return patterns.filter(([, pattern]) => pattern.test(text)).map(([value]) => value)
}

export interface PolicySubjectFactsV3 {
  subjectType: 'requirement' | 'scenario'
  subjectId: string
  text: string
  pathScopes: string[]
  artifactKinds: PolicyArtifactKind[]
  operationKinds: PolicyOperationKind[]
  lifecycleStages: PolicyLifecycleStage[]
  stackTags: string[]
}

export function inferPolicyOperationKindsV3(text: string): PolicyOperationKind[] {
  return uniqueMatches(text, OPERATION_PATTERNS)
}

export function inferPolicyArtifactKindsV3(text: string): PolicyArtifactKind[] {
  return uniqueMatches(text, ARTIFACT_PATTERNS)
}

export function inferPolicyLifecycleStagesV3(text: string): PolicyLifecycleStage[] {
  return uniqueMatches(text, LIFECYCLE_PATTERNS)
}

export function inferRepositoryPathScopesV3(text: string): string[] {
  const candidates = text.match(/(?:^|[\s`'"（(])((?:\.?\.?\/)?[A-Za-z0-9_.@-]+(?:\/[A-Za-z0-9_.@*{}-]+)+|(?:package|tsconfig|pom|build\.gradle|go\.mod)[A-Za-z0-9_.-]*)(?=$|[\s`'"，。；：、）),;:])/gu) ?? []
  return [...new Set(candidates.map((candidate) => normalizedScope(candidate.trim().replace(/^[`'"（(]|[`'"，。；：、）),;:]$/gu, ''))).filter((candidate) => !candidate.includes('..') && !candidate.includes('*') && !candidate.includes('{')))].sort()
}

export function derivePolicyTargetSelectorV3(input: { sourcePath?: string; statement: string; stackTags?: string[] }): PolicyTargetSelector {
  const sourcePath = input.sourcePath === undefined ? undefined : normalizedScope(input.sourcePath)
  const sourceDirectory = sourcePath === undefined || sourcePath === '.' ? '.' : normalizedScope(posix.dirname(sourcePath))
  const scopedByRepositoryDocument = sourcePath !== undefined && /(?:^|\/)(?:AGENTS\.md|README(?:\.[^/]+)?\.md)$/iu.test(sourcePath)
  return {
    includePaths: scopedByRepositoryDocument && sourceDirectory !== '.' ? [sourceDirectory] : [],
    excludePaths: [],
    artifactKinds: inferPolicyArtifactKindsV3(input.statement),
    operationKinds: inferPolicyOperationKindsV3(input.statement),
    lifecycleStages: inferPolicyLifecycleStagesV3(input.statement),
    stackTags: [...new Set(input.stackTags ?? [])].sort(),
  }
}

export function policySubjectFactsFromTextV3(input: Pick<PolicySubjectFactsV3, 'subjectType' | 'subjectId' | 'text'> & Partial<Omit<PolicySubjectFactsV3, 'subjectType' | 'subjectId' | 'text'>>): PolicySubjectFactsV3 {
  return {
    subjectType: input.subjectType,
    subjectId: input.subjectId,
    text: input.text,
    pathScopes: [...new Set([...(input.pathScopes ?? []), ...inferRepositoryPathScopesV3(input.text)])].sort(),
    artifactKinds: [...new Set([...(input.artifactKinds ?? []), ...inferPolicyArtifactKindsV3(input.text)])],
    operationKinds: [...new Set([...(input.operationKinds ?? []), ...inferPolicyOperationKindsV3(input.text)])],
    lifecycleStages: [...new Set([...(input.lifecycleStages ?? []), ...inferPolicyLifecycleStagesV3(input.text)])],
    stackTags: [...new Set(input.stackTags ?? [])].sort(),
  }
}

export function evaluatePolicyApplicabilityV3(selector: PolicyTargetSelector, subject: PolicySubjectFactsV3): PolicyApplicabilityDecision {
  const matchedFacts: string[] = []
  const evaluateSet = <T extends string>(name: string, expected: T[], actual: T[]): 'match' | 'miss' | 'unknown' => {
    if (expected.length === 0) return 'match'
    if (actual.length === 0) return 'unknown'
    const matched = expected.filter((value) => actual.includes(value))
    if (matched.length === 0) return 'miss'
    matchedFacts.push(`${name}:${matched.join(',')}`)
    return 'match'
  }
  if (selector.excludePaths.some((excluded) => subject.pathScopes.some((path) => scopesIntersect(excluded, path)))) {
    return { subjectType: subject.subjectType, subjectId: subject.subjectId, result: 'not_applicable', matchedFacts: ['excluded-path'], reasonCode: 'path-excluded', evaluatorVersion: POLICY_APPLICABILITY_EVALUATOR_VERSION }
  }
  const pathResult = selector.includePaths.length === 0
    ? 'match'
    : subject.pathScopes.length === 0
      ? 'unknown'
      : selector.includePaths.some((included) => subject.pathScopes.some((path) => scopesIntersect(included, path)))
        ? 'match'
        : 'miss'
  if (pathResult === 'match' && selector.includePaths.length > 0) matchedFacts.push(`path:${selector.includePaths.join(',')}`)
  const results = [
    pathResult,
    evaluateSet('artifact', selector.artifactKinds, subject.artifactKinds),
    evaluateSet('operation', selector.operationKinds, subject.operationKinds),
    evaluateSet('lifecycle', selector.lifecycleStages, subject.lifecycleStages),
    evaluateSet('stack', selector.stackTags, subject.stackTags),
  ]
  const result = results.includes('miss') ? 'not_applicable' : results.includes('unknown') ? 'needs_confirmation' : 'applicable'
  return {
    subjectType: subject.subjectType,
    subjectId: subject.subjectId,
    result,
    matchedFacts,
    reasonCode: result === 'applicable' ? 'selector-matched' : result === 'not_applicable' ? 'selector-mismatch' : 'selector-facts-missing',
    evaluatorVersion: POLICY_APPLICABILITY_EVALUATOR_VERSION,
  }
}

export function mapPolicySubjectsV3(selector: PolicyTargetSelector, subjects: PolicySubjectFactsV3[]): PolicyApplicabilityDecision[] {
  return [...subjects].sort((left, right) => left.subjectType.localeCompare(right.subjectType) || left.subjectId.localeCompare(right.subjectId)).map((subject) => evaluatePolicyApplicabilityV3(selector, subject))
}

export function extractNormativePolicyStatementsV3(content: string): string[] {
  const statements: string[] = []
  let fenced = false
  for (const line of content.replace(/\r\n?/g, '\n').split('\n')) {
    if (/^\s*```/u.test(line)) {
      fenced = !fenced
      continue
    }
    if (fenced) continue
    const normalized = line
      .replace(/^\s*(?:>\s*)?/u, '')
      .replace(/^\s*(?:#{1,6}\s+|[-*+]\s+|\d+[.)]\s+)/u, '')
      .trim()
    if (normalized.length < 4) continue
    for (const sentence of normalized.match(/[^。！？!?]+[。！？!?]?/gu) ?? []) {
      const statement = sentence.trim()
      if (statement.length >= 4 && statement.length <= 2_000 && NORMATIVE_TERM.test(statement)) statements.push(statement)
    }
  }
  return [...new Set(statements)]
}
