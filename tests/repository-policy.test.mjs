import assert from 'node:assert/strict'
import test from 'node:test'
import {
  derivePolicyTargetSelectorV3,
  extractNormativePolicyStatementsV3,
  mapPolicySubjectsV3,
  policySubjectFactsFromTextV3,
} from '../lib/index.js'

test('Repository Policy extracts only explicit atomic normative statements', () => {
  const content = `# Project

<p>界面示意：这里需要审批。</p>

创建时只需要：

适合已有 PRD 的场景。需要提供工作目录。

- 执行前必须获取工作区租约。
- Requests MUST NOT bypass approval. This is explanatory text.

Planner 会检查仓库。已有执行记录的 Project 不允许追加拆分。

\`\`\`
This example MUST NOT become policy.
\`\`\`
`
  assert.deepEqual(extractNormativePolicyStatementsV3(content), [
    '执行前必须获取工作区租约。',
    'Requests MUST NOT bypass approval. This is explanatory text.',
    '已有执行记录的 Project 不允许追加拆分。',
  ])
})

test('Repository Policy maps mutation rules only to matching requirement operations', () => {
  const selector = derivePolicyTargetSelectorV3({
    sourcePath: 'README.md',
    statement: 'Mutation requests MUST validate Origin and Fetch Metadata before any write.',
  })
  const decisions = mapPolicySubjectsV3(selector, [
    policySubjectFactsFromTextV3({ subjectType: 'requirement', subjectId: 'req-read', text: 'GET /samples lists sample collection records without writes.' }),
    policySubjectFactsFromTextV3({ subjectType: 'requirement', subjectId: 'req-write', text: 'POST /samples creates and persists a sample collection record.' }),
  ])
  assert.equal(decisions.find((item) => item.subjectId === 'req-read')?.result, 'not_applicable')
  assert.equal(decisions.find((item) => item.subjectId === 'req-write')?.result, 'applicable')
})

test('Repository Policy directory scope does not leak across unrelated modules', () => {
  const selector = derivePolicyTargetSelectorV3({ sourcePath: 'src/payments/AGENTS.md', statement: 'Changes MUST include automated tests.' })
  const decisions = mapPolicySubjectsV3(selector, [
    policySubjectFactsFromTextV3({ subjectType: 'requirement', subjectId: 'req-payment', text: 'Modify src/payments/checkout.ts and add tests.' }),
    policySubjectFactsFromTextV3({ subjectType: 'requirement', subjectId: 'req-catalog', text: 'Modify src/catalog/search.ts and add tests.' }),
  ])
  assert.equal(decisions.find((item) => item.subjectId === 'req-payment')?.result, 'applicable')
  assert.equal(decisions.find((item) => item.subjectId === 'req-catalog')?.result, 'not_applicable')
})

test('Repository Policy fails closed when a scoped rule has no subject path facts', () => {
  const selector = derivePolicyTargetSelectorV3({ sourcePath: 'src/payments/AGENTS.md', statement: 'Changes MUST include automated tests.' })
  const [decision] = mapPolicySubjectsV3(selector, [
    policySubjectFactsFromTextV3({ subjectType: 'requirement', subjectId: 'req-unknown', text: 'Adjust checkout behavior and add tests.' }),
  ])
  assert.equal(decision.result, 'needs_confirmation')
  assert.equal(decision.reasonCode, 'selector-facts-missing')
})
