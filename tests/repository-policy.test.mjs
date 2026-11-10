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

test('Repository Policy preserves nested API headings for subjectless parameter constraints', () => {
  const statement = 'Must be a non-negative number, Infinity included, or undefined; anything else throws a TypeError.'
  const content = `# Library
## API
### retry(options?)
#### options
##### delay
Type: number
${statement}
\`\`\`md
##### invented
This example MUST NOT become policy.
\`\`\`
### fetch(options?)
#### options
##### timeout
${statement}
`
  assert.deepEqual(extractNormativePolicyStatementsV3(content), [
    `API > retry(options?) > options > delay: ${statement}`,
    `API > fetch(options?) > options > timeout: ${statement}`,
  ])
})

test('Repository Policy retains normative headings and their nested constraints', () => {
  assert.deepEqual(extractNormativePolicyStatementsV3('# Changes MUST include tests\n## API\n### Requests MUST validate input\nValues must be strings.'), [
    'Changes MUST include tests',
    'API > Requests MUST validate input: Requests MUST validate input',
    'API > Requests MUST validate input: Values must be strings.',
  ])
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

test('Repository Policy command examples do not become target operation predicates', () => {
  const selector = derivePolicyTargetSelectorV3({ sourcePath: 'AGENTS.md', statement: "Run scripts with `nub run`, repository TypeScript with `nub <file>`, and installed tools with `nub exec --node <tool>`. Keep third-party tools and built-package compatibility probes on plain Node; Nub's augmentation must not mask resolution errors or change test behavior. Use `nub install --frozen-lockfile` for reproducible installs and `nub add` / `nub remove` to manage dependencies." })
  assert.deepEqual(selector.operationKinds, [])
  const [decision] = mapPolicySubjectsV3(selector, [policySubjectFactsFromTextV3({ subjectType: 'scenario', subjectId: 'type-probe', text: 'Verify the tests with the configured compiler.', artifactKinds: ['test'], lifecycleStages: ['verify'] })])
  assert.equal(decision.result, 'applicable')
  const deletion = derivePolicyTargetSelectorV3({ sourcePath: 'AGENTS.md', statement: 'Before you delete records, you MUST run `npm test`.' })
  assert.deepEqual(deletion.operationKinds, ['delete'])
})
