import assert from 'node:assert/strict'
import { readFile, writeFile } from 'node:fs/promises'
import { BindingStage, buildRepositoryEvidenceRetrievalReportV3, RepositoryEvidenceRetrievalReportSchema } from '../lib/index.js'

// Read-only reproduction against retained frozen repositories; no model calls.
const snapshot = await fetch('http://127.0.0.1:3087/project-orchestrator/api/snapshot').then(r => { assert.ok(r.ok); return r.json() })
const ledger = JSON.parse(await readFile('output/acceptance/release-collection-disposition-2026-10-16.json', 'utf8'))
const reports = []
for (const attempt of ledger.attempts) {
  const operation = snapshot.planningOperations.find(o => o.id === attempt.operationId)
  const repository = snapshot.repositorySnapshotsV3.find(r => r.id === operation.evaluationInput.repositorySnapshotId)
  const analysis = snapshot.requirementAnalysisProposals.find(p => p.operationId === operation.id).analysis
  const manifest = snapshot.requirementSourceManifests.find(m => m.id === operation.sourceManifestId)
  const focus = manifest.anchors.map(a => a.text).join('\n')
  const report = await buildRepositoryEvidenceRetrievalReportV3({ projectId: repository.projectId, operationId: repository.operationId, repository,
    requirements: analysis.requirements.filter(r => r.scope === 'in_scope').map(r => ({ key: r.key, statement: r.statement, acceptanceStatements: r.acceptanceCriteria.map(a => a.statement) })) })
  const stage = new BindingStage({})
  RepositoryEvidenceRetrievalReportSchema.parse(report)
  const contents = await stage.loadFrozenEvidence(repository, { projectId: repository.projectId, operationId: repository.operationId, references: stage.repositoryReferences(repository, report) }, focus)
  const totalContentBytes = contents.reduce((n, c) => n + Buffer.byteLength(c.content), 0)
  assert.ok(totalContentBytes <= 65_536)
  const get = path => contents.find(c => c.path === path)?.content ?? ''
  if (attempt.caseId.startsWith('zod-')) {
    assert.ok(get('packages/zod/src/v4/core/api.ts').includes('export function _stringbool('))
    assert.ok(get('packages/zod/src/v4/classic/schemas.ts').includes('export const stringbool:'))
    assert.ok(get('packages/zod/src/v4/mini/schemas.ts').includes('export const stringbool:'))
    assert.ok(get('packages/zod/src/v4/classic/tests/stringbool.test.ts').includes('stringbool'))
    assert.ok(get('packages/zod/tsconfig.test.json').includes('extends'))
  } else {
    assert.ok(get('src/middleware/cors/index.ts').includes('exposeHeaders'))
    assert.ok(get('src/middleware/cors/index.test.ts').includes('cors'))
    const regressionPath = 'src/middleware/cors/index.test.ts'
    assert.equal(contents.find(c => c.path === regressionPath).truncated, false, 'Complete CORS regression starting-point inspection is required')
    assert.equal(get(regressionPath), await readFile(`${repository.canonicalRoot}/${regressionPath}`, 'utf8'))
    assert.ok(get('tsconfig.spec.json').includes('include'))
    assert.ok(get('src/context.ts').includes('class Context'), 'Missing Context declaration owner')
    assert.ok(get('src/hono-base.ts').includes('new Context'), 'Missing request Context construction')
    assert.ok(get('src/hono-base.ts').includes('onError'), 'Missing error dispatch owner')
    assert.ok(get('src/compose.ts').includes('catch'), 'Missing middleware error composition owner')
  }
  assert.ok(get('package.json').includes('scripts'))
  reports.push({ caseId: attempt.caseId, sourceOperationId: operation.id, indexVersion: report.indexVersion, queryTermCounts: report.querySeeds.map(s => s.terms.length), diagnostics: report.diagnostics, totalContentBytes,
    suppliedFiles: contents.filter(c => c.content).length,
    focusedFiles: contents.filter(c => focus.includes(c.path) || /tsconfig|package\.json/u.test(c.path)).map(c => ({ path: c.path, bytes: Buffer.byteLength(c.content), truncated: c.truncated })) })
}
const result = { status: 'focused_source_assertions_passed', modelRequests: 0, domainMutations: 0, reports }
await writeFile(process.argv[2] ?? 'output/acceptance/focused-evidence-real-repositories-after-2026-10-16.json', JSON.stringify(result, null, 2), { flag: 'wx' })
console.log(JSON.stringify({ ...result, reports: reports.map(({ focusedFiles, ...summary }) => summary) }))
