import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)
const cli = new URL('../lib/cli.js', import.meta.url).pathname

async function withCliServer(operation, responder = () => ({ ok: true })) {
  const requests = []
  const server = createServer((request, response) => {
    let body = ''
    request.setEncoding('utf8')
    request.on('data', (chunk) => { body += chunk })
    request.on('end', () => {
      requests.push({ method: request.method, url: request.url, body: body === '' ? undefined : JSON.parse(body) })
      const result = responder(requests.at(-1))
      response.statusCode = result?.httpStatus ?? 200
      response.setHeader('content-type', 'application/json')
      response.end(result?.raw ?? JSON.stringify(result?.payload ?? result))
    })
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  assert.notEqual(address, null)
  const url = `http://127.0.0.1:${address.port}/project-orchestrator/api`
  try {
    await operation({ requests, url })
  } finally {
    await new Promise((resolve, reject) => server.close((error) => error === undefined ? resolve() : reject(error)))
  }
}

test('CLI team queries encode identifiers and use the shared HTTP projections', async () => {
  await withCliServer(async ({ requests, url }) => {
    const result = await execFileAsync(cli, ['agent-candidates', 'project / one', 'task ? one', '--url', url])
    assert.deepEqual(JSON.parse(result.stdout), { ok: true })
    assert.deepEqual(requests, [{ method: 'GET', url: '/project-orchestrator/api/projects/project%20%2F%20one/agent-candidates?taskId=task%20%3F%20one', body: undefined }])
  })
})

test('CLI team mutations preserve the command payload through the shared HTTP boundary', async () => {
  await withCliServer(async ({ requests, url }) => {
    const payload = { taskId: 'task-1', agentId: 'agent-2', expectedRevision: 7, reason: 'Capacity changed.' }
    const result = await execFileAsync(cli, ['reassign-task', 'project-1', JSON.stringify(payload), '--url', url])
    assert.deepEqual(JSON.parse(result.stdout), { ok: true })
    assert.deepEqual(requests, [{ method: 'POST', url: '/project-orchestrator/api/projects/project-1/reassign-task', body: payload }])
  })
})

test('CLI Squad bind and sync commands use the audited team mutation routes', async () => {
  await withCliServer(async ({ requests, url }) => {
    const bind = { squadId: 'squad-1', expectedProjectRevision: 3, expectedSquadUpdatedAt: '2026-08-25T00:00:00.000Z' }
    const sync = { expectedBindingUpdatedAt: '2026-08-25T00:01:00.000Z', expectedSquadUpdatedAt: '2026-08-25T00:02:00.000Z', syncRoles: true }
    await execFileAsync(cli, ['bind-project-squad', 'project-1', JSON.stringify(bind), '--url', url])
    await execFileAsync(cli, ['sync-project-squad', 'project-1', 'squad / 1', JSON.stringify(sync), '--url', url])
    assert.deepEqual(requests, [
      { method: 'POST', url: '/project-orchestrator/api/projects/project-1/squad-bindings', body: bind },
      { method: 'POST', url: '/project-orchestrator/api/projects/project-1/squad-bindings/squad%20%2F%201/sync', body: sync },
    ])
  })
})

test('CLI targeted decomposition revision encodes identifiers and preserves the request body', async () => {
  await withCliServer(async ({ requests, url }) => {
    const payload = { title: '修订', prd: '更新验收。', technicalDesign: '', taskLanguage: 'zh-CN', expectedBundleUpdatedAt: '2026-08-26T00:00:00.000Z', idempotencyKey: 'revise-1' }
    const result = await execFileAsync(cli, ['revise-decomposition', 'project / one', 'bundle ? one', JSON.stringify(payload), '--url', url])
    assert.deepEqual(JSON.parse(result.stdout), { ok: true })
    assert.deepEqual(requests, [{ method: 'POST', url: '/project-orchestrator/api/projects/project%20%2F%20one/decompositions/bundle%20%3F%20one/revise', body: payload }])
  })
})

test('CLI rejects non-loopback endpoints before sending team data', async () => {
  await assert.rejects(
    () => execFileAsync(cli, ['team-plan', 'project-1', '--url', 'https://example.com/project-orchestrator/api']),
    (error) => error.code === 1 && /only connects to a loopback Harness API/.test(error.stderr),
  )
})

const digest = 'a'.repeat(64)

function planningEvaluationArtifact() {
  return {
    schemaVersion: 1,
    runId: 'run/one',
    executionKind: 'real_model',
    status: 'blocked',
    repositoryEvidenceIds: [],
    requirements: [],
    decisions: [],
    bindings: [],
    tasks: [],
    assignments: [],
    substantiveRewriteRequired: false,
    provenance: {
      caseId: 'case one', repositoryBaseCommit: 'b'.repeat(40), planningOperationId: 'operation?one', planningOperationDigest: digest,
      repositoryDigest: digest, sourceDigest: digest, teamCatalogDigest: digest, decisionInputDigest: digest,
      metricPolicyId: 'policy-1', metricPolicyVersion: 'v1', metricPolicyDigest: digest, promptVersionsDigest: digest,
      modelProvider: 'test', modelId: 'model', modelVersion: 'model-v1', samplingConfigDigest: digest,
      inputTokenBudget: 16_384, outputTokenBudget: 16_384, toolCallBudget: 0,
      startedAt: '2026-09-06T00:00:00.000Z', completedAt: '2026-09-06T00:01:00.000Z',
    },
  }
}

function releaseCanaryArtifact() {
  return {
    schemaVersion: 1, releaseVersion: '1.7.0', planningContractVersion: 3, projectKey: 'project:redacted',
    planningOperationId: 'operation-1', planningOperationDigest: digest, sourceSnapshotDigest: digest,
    planSnapshotId: 'plan-1', planSnapshotDigest: digest, approvalId: 'approval-1', approvalDigest: digest,
    executionDispatches: [{ id: 'dispatch-1', digest }, { id: 'dispatch-2', digest }], taskRunCount: 2,
    deliveryIntegrationSnapshotId: 'integration-1', deliveryIntegrationDigest: digest, finalCommit: 'b'.repeat(40),
    convergenceReviewId: 'review-1', convergenceReviewDigest: digest, outcome: 'converged', falseReady: false, falseConverged: false,
    requiredRequirementCoverage: 1, requiredAcceptanceCoverage: 1, evidenceRecordIds: ['evidence-1'], evidenceBundleDigest: digest,
    startedAt: '2026-09-06T00:00:00.000Z', completedAt: '2026-09-06T00:10:00.000Z',
  }
}

test('CLI captures validated evaluation and multi-dispatch canary artifacts without overwriting evidence', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-cli-evidence-'))
  try {
    const evaluationPath = join(root, 'nested', 'evaluation.json')
    const canaryPath = join(root, 'canary.json')
    await withCliServer(async ({ requests, url }) => {
      const evaluation = await execFileAsync(cli, ['capture-planning-eval', 'project one', 'operation?one', 'case one', 'run/one', '--output', evaluationPath, '--url', url])
      assert.equal(JSON.parse(evaluation.stdout).path, evaluationPath)
      assert.deepEqual(JSON.parse(await readFile(evaluationPath, 'utf8')), planningEvaluationArtifact())
      assert.equal(requests[0].url, '/project-orchestrator/api/projects/project%20one/planning-operations/operation%3Fone/evaluation-export?caseId=case%20one&runId=run%2Fone')
      await assert.rejects(() => execFileAsync(cli, ['capture-planning-eval', 'project one', 'operation?one', 'case one', 'run/one', '--output', evaluationPath, '--url', url]), (error) => error.code === 1 && /Refusing to overwrite existing artifact/.test(error.stderr))

      const canary = await execFileAsync(cli, ['capture-release-canary', 'project one', '--output', canaryPath, '--url', url])
      assert.equal(JSON.parse(canary.stdout).path, canaryPath)
      assert.deepEqual(JSON.parse(await readFile(canaryPath, 'utf8')), releaseCanaryArtifact())
      assert.equal(requests.at(-1).url, '/project-orchestrator/api/projects/project%20one/release-canary?releaseVersion=1.7.0')
    }, (request) => request.url.includes('release-canary') ? releaseCanaryArtifact() : planningEvaluationArtifact())
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('CLI leaves no artifact when the Harness response is malformed JSON or violates the evidence schema', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-cli-malformed-'))
  try {
    const malformedJsonPath = join(root, 'malformed-json.json')
    await withCliServer(async ({ url }) => {
      await assert.rejects(() => execFileAsync(cli, ['capture-release-canary', 'project-1', '--output', malformedJsonPath, '--url', url]), (error) => error.code === 1 && /non-JSON/.test(error.stderr))
      await assert.rejects(() => readFile(malformedJsonPath, 'utf8'), (error) => error.code === 'ENOENT')
    }, () => ({ raw: '{not-json' }))

    const invalidSchemaPath = join(root, 'invalid-schema.json')
    await withCliServer(async ({ url }) => {
      await assert.rejects(() => execFileAsync(cli, ['capture-planning-eval', 'project-1', 'operation-1', 'case-1', 'run-1', '--output', invalidSchemaPath, '--url', url]), (error) => error.code === 1)
      await assert.rejects(() => readFile(invalidSchemaPath, 'utf8'), (error) => error.code === 'ENOENT')
    }, () => ({ ok: true }))

    const mismatchedIdentityPath = join(root, 'mismatched-identity.json')
    await withCliServer(async ({ url }) => {
      await assert.rejects(() => execFileAsync(cli, ['capture-planning-eval', 'project-1', 'operation-1', 'case-1', 'run-1', '--output', mismatchedIdentityPath, '--url', url]), (error) => error.code === 1 && /identity does not match/.test(error.stderr))
      await assert.rejects(() => readFile(mismatchedIdentityPath, 'utf8'), (error) => error.code === 'ENOENT')
    }, () => planningEvaluationArtifact())
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
