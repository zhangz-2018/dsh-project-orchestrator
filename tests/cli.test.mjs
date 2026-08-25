import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { createServer } from 'node:http'
import test from 'node:test'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)
const cli = new URL('../lib/cli.js', import.meta.url).pathname

async function withCliServer(operation) {
  const requests = []
  const server = createServer((request, response) => {
    let body = ''
    request.setEncoding('utf8')
    request.on('data', (chunk) => { body += chunk })
    request.on('end', () => {
      requests.push({ method: request.method, url: request.url, body: body === '' ? undefined : JSON.parse(body) })
      response.setHeader('content-type', 'application/json')
      response.end(JSON.stringify({ ok: true }))
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

test('CLI rejects non-loopback endpoints before sending team data', async () => {
  await assert.rejects(
    () => execFileAsync(cli, ['team-plan', 'project-1', '--url', 'https://example.com/project-orchestrator/api']),
    (error) => error.code === 1 && /only connects to a loopback Harness API/.test(error.stderr),
  )
})
