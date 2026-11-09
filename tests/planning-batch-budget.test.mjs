import assert from 'node:assert/strict'
import test from 'node:test'
import { createServer } from 'node:http'
import { mkdir, mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createPlanningBatchBudgetGate } from '../scripts/planning-batch-budget.mjs'

async function fixture(t, handler, tokenLimit = 100) {
  const directory = await mkdtemp(join(tmpdir(), 'po-batch-budget-'))
  const ledgerPath = join(directory, 'ledger.json')
  let calls = 0
  const upstream = createServer(async (req, res) => { calls++; await handler(req, res, JSON.parse(await readFile(ledgerPath, 'utf8'))) })
  await new Promise((done) => upstream.listen(0, '127.0.0.1', done))
  const config = { ledgerPath, modelId: 'model-under-test', upstreamBaseUrl: `http://127.0.0.1:${upstream.address().port}/v1`, tokenLimit, inputTokenBudget: 80, outputTokenBudget: 20 }
  const gates = []
  t.after(async () => {
    for (const gate of gates.reverse()) await gate.close()
    await new Promise((done) => upstream.close(done))
    await rm(directory, { recursive: true, force: true })
  })
  const openGate = async () => {
    const gate = await createPlanningBatchBudgetGate(config)
    gates.push(gate)
    return { gate, url: await gate.listen() }
  }
  const first = await openGate()
  return { ...first, config, calls: () => calls, ledger: async () => JSON.parse(await readFile(ledgerPath, 'utf8')), openGate,
    async restart() { const gate = gates.pop(); await gate.close(); return openGate() },
    post: async (url = first.url, body = {}, route = 'chat/completions') => {
      const response = await fetch(`${url}/${route}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ model: config.modelId, max_tokens: 20, ...body }) })
      // Response headers arrive before the proxy has durably settled usage.
      // Consume the body so the assertions observe completion, not a race.
      const text = await response.text()
      return new Response(text, { status: response.status, headers: response.headers })
    },
  }
}

test('batch gate persists the full reservation before sending and settles verifiable usage', async (t) => {
  const f = await fixture(t, (_req, res, ledger) => {
    assert.equal(ledger.attempts[0].status, 'reserved')
    assert.equal(ledger.attempts[0].chargedTokens, 100)
    res.end(JSON.stringify({ usage: { prompt_tokens: 7, completion_tokens: 3, total_tokens: 10 } }))
  })
  assert.equal((await f.post()).status, 200)
  assert.equal((await f.ledger()).attempts[0].chargedTokens, 10)
  // 90 remaining is insufficient for another 100-token worst-case request.
  assert.equal((await f.post()).status, 503)
  assert.equal(f.calls(), 1)
})

test('batch gate serializes concurrent reservations at the exact budget boundary', async (t) => {
  const f = await fixture(t, (_req, res) => res.end('{}'))
  const statuses = (await Promise.all([f.post(), f.post()])).map((r) => r.status).sort()
  assert.deepEqual(statuses, [200, 503])
  assert.equal(f.calls(), 1)
  assert.equal((await f.ledger()).attempts[0].status, 'usage_unknown')
  const restarted = await f.restart()
  assert.equal((await f.post(restarted.url)).status, 503)
  assert.equal(f.calls(), 1)
})

test('batch gate records failed retries separately and never refunds a failed upstream request', async (t) => {
  const f = await fixture(t, (_req, res) => { res.writeHead(502); res.end(JSON.stringify({ usage: { prompt_tokens: 0, completion_tokens: 0 } })) }, 200)
  assert.equal((await f.post()).status, 502)
  assert.equal((await f.post()).status, 502)
  assert.equal((await f.post()).status, 503)
  assert.equal(f.calls(), 2)
  assert.deepEqual((await f.ledger()).attempts.map((a) => [a.status, a.chargedTokens]), [['usage_unknown', 100], ['usage_unknown', 100]])
})

test('batch gate rejects route/model/output/tool and multiple-generation bypasses without upstream calls', async (t) => {
  const f = await fixture(t, (_req, res) => res.end('{}'))
  for (const body of [{ model: 'different' }, { max_tokens: 21 }, { max_tokens: undefined }, { max_completion_tokens: 2 }, { tools: [{}] }, { functions: [{}] }, { n: 2 }, { best_of: 2 }, { background: true }]) assert.equal((await f.post(f.url, body)).status, 400)
  assert.equal((await fetch(`${f.url}/embeddings`, { method: 'POST' })).status, 404)
  assert.equal(f.calls(), 0)
  assert.equal((await f.ledger()).attempts.length, 0)
})

test('batch gate reads split SSE usage for Chat Completions and Responses', async (t) => {
  const f = await fixture(t, async (req, res) => {
    let text = ''; for await (const chunk of req) text += chunk
    const body = JSON.parse(text)
    if (req.url.endsWith('/chat/completions')) assert.equal(body.stream_options.include_usage, true)
    res.writeHead(200, { 'content-type': 'text/event-stream' })
    const usage = req.url.endsWith('/responses') ? { response: { usage: { input_tokens: 4, output_tokens: 2, total_tokens: 6 } } } : { usage: { prompt_tokens: 4, completion_tokens: 2, total_tokens: 6 } }
    const data = `data: ${JSON.stringify(usage)}\r\n\r\ndata: [DONE]\n\n`
    res.write(data.slice(0, 15)); res.end(data.slice(15))
  }, 200)
  const chat = await f.post(f.url, { stream: true }); await chat.text()
  const responses = await f.post(f.url, { max_tokens: undefined, max_output_tokens: 20, stream: true }, 'responses'); await responses.text()
  assert.deepEqual((await f.ledger()).attempts.map((a) => a.chargedTokens), [6, 6])
})

test('batch gate halts when provider usage exceeds the declared per-request input or output ceiling', async (t) => {
  const f = await fixture(t, (_req, res) => res.end(JSON.stringify({ usage: { input_tokens: 81, output_tokens: 1 } })), 300)
  assert.equal((await f.post()).status, 200)
  const ledger = await f.ledger()
  assert.equal(ledger.halted, true)
  assert.equal(ledger.attempts[0].status, 'usage_exceeded_reservation')
  const next = await f.restart()
  assert.equal((await f.post(next.url)).status, 503)
  assert.equal(f.calls(), 1)
})

test('batch gate refuses concurrent owners, configuration changes and corrupted ledgers', async (t) => {
  const f = await fixture(t, (_req, res) => res.end('{}'))
  await assert.rejects(() => createPlanningBatchBudgetGate(f.config), { code: 'EEXIST' })
  await f.gate.close()
  const directory = await mkdtemp(join(tmpdir(), 'po-batch-corrupt-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const config = { ...f.config, ledgerPath: join(directory, 'ledger.json') }
  await writeFile(config.ledgerPath, JSON.stringify({ schemaVersion: 1, config: { changed: true }, halted: false, attempts: [] }))
  await assert.rejects(() => createPlanningBatchBudgetGate(config), /configuration changed/)
  await writeFile(config.ledgerPath, 'not-json')
  await assert.rejects(() => createPlanningBatchBudgetGate(config), SyntaxError)
})

test('batch gate fails closed before sending if its reservation cannot be persisted', async (t) => {
  const f = await fixture(t, (_req, res) => res.end('{}'))
  const backupPath = `${f.config.ledgerPath}.original`
  await rename(f.config.ledgerPath, backupPath)
  await mkdir(f.config.ledgerPath)
  try {
    assert.equal((await f.post()).status, 503)
    assert.equal((await f.post()).status, 503)
    assert.equal(f.calls(), 0)
  } finally {
    await rm(f.config.ledgerPath, { recursive: true })
    await rename(backupPath, f.config.ledgerPath)
  }
})

test('batch gate retains an interrupted reservation on restart and rejects a changed token limit', async (t) => {
  const f = await fixture(t, (_req, res) => res.end('{}'))
  await f.post()
  await f.gate.close()
  const ledger = await f.ledger()
  ledger.attempts[0].status = 'reserved'
  delete ledger.attempts[0].completedAt
  await writeFile(f.config.ledgerPath, JSON.stringify(ledger))
  await assert.rejects(() => createPlanningBatchBudgetGate({ ...f.config, tokenLimit: 200 }), /configuration changed/)
  const gate = await createPlanningBatchBudgetGate(f.config)
  try {
    const url = await gate.listen()
    assert.equal((await f.post(url)).status, 503)
    assert.equal(f.calls(), 1)
    assert.equal((await f.ledger()).attempts[0].chargedTokens, 100)
  } finally { await gate.close() }
})

test('batch gate forwards only the exact read-only model catalog without charging a completion', async (t) => {
  const f = await fixture(t, (req, res) => { assert.equal(req.method, 'GET'); assert.equal(req.url, '/v1/models'); res.end('{"data":[]}') })
  const response = await fetch(`${f.url}/models`)
  assert.equal(response.status, 200)
  assert.deepEqual(await response.json(), { data: [] })
  assert.equal((await fetch(`${f.url}/models?submit=true`)).status, 404)
  assert.equal((await f.ledger()).attempts.length, 0)
  assert.equal(f.calls(), 1)
})
