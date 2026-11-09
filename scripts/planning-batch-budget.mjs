import { createServer } from 'node:http'
import { randomUUID } from 'node:crypto'
import { mkdir, open, readFile, rename, rmdir, unlink } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'

function positiveInteger(value, name) {
  if (!Number.isSafeInteger(value) || value <= 0) throw new Error(`${name} must be a positive safe integer.`)
  return value
}

async function durableWrite(path, value) {
  const temporary = `${path}.${randomUUID()}.tmp`
  const file = await open(temporary, 'wx', 0o600)
  try {
    await file.writeFile(`${JSON.stringify(value, null, 2)}\n`)
    await file.sync()
  } finally { await file.close() }
  try {
    await rename(temporary, path)
    const directory = await open(dirname(path), 'r')
    try { await directory.sync() } finally { await directory.close() }
  } catch (error) {
    await unlink(temporary).catch(() => {})
    throw error
  }
}

function reservationTotal(attempts) {
  return attempts.reduce((total, attempt) => total + attempt.chargedTokens, 0)
}

function usageTokens(raw) {
  const usage = raw?.usage ?? raw?.response?.usage
  if (!usage) return undefined
  const input = usage.input_tokens ?? usage.prompt_tokens
  const output = usage.output_tokens ?? usage.completion_tokens
  if (!Number.isSafeInteger(input) || input < 0 || !Number.isSafeInteger(output) || output < 0) return undefined
  if (usage.total_tokens !== undefined && usage.total_tokens !== input + output) return undefined
  return { input, output, total: input + output }
}

/** A loopback-only request gate, not a price oracle or a model-quality fixture.
 * Each request reserves the entire declared model input+output ceiling. Unknown
 * usage retains that ceiling. All retry HTTP requests pass through this gate.
 */
export async function createPlanningBatchBudgetGate(options) {
  const { modelId, upstreamBaseUrl } = options
  if (typeof modelId !== 'string' || !modelId.trim()) throw new Error('modelId is required.')
  const tokenLimit = positiveInteger(options.tokenLimit, 'tokenLimit')
  const inputTokenBudget = positiveInteger(options.inputTokenBudget, 'inputTokenBudget')
  const outputTokenBudget = positiveInteger(options.outputTokenBudget, 'outputTokenBudget')
  const perRequestReservation = positiveInteger(inputTokenBudget + outputTokenBudget, 'perRequestReservation')
  const requestTimeoutMs = positiveInteger(options.requestTimeoutMs ?? 10 * 60_000, 'requestTimeoutMs')
  const upstream = new URL(upstreamBaseUrl)
  if (!['http:', 'https:'].includes(upstream.protocol) || upstream.username || upstream.password || upstream.search || upstream.hash) throw new Error('Invalid upstream URL.')
  const ledgerPath = resolve(options.ledgerPath)
  await mkdir(dirname(ledgerPath), { recursive: true })
  const lockPath = `${ledgerPath}.lock`
  // Exclusive ownership is intentionally not auto-recovered by age or PID.
  // After a crash, confirm that the old process is gone before removing it.
  await mkdir(lockPath)
  let ledger
  let poisoned = false
  let closed = false
  let queue = Promise.resolve()
  const config = { modelId, upstreamBaseUrl: upstream.href, tokenLimit, inputTokenBudget, outputTokenBudget }
  const serialize = (action) => {
    const pending = queue.then(action)
    queue = pending.catch(() => {})
    return pending
  }
  const persist = async (next) => {
    try { await durableWrite(ledgerPath, next) } catch (error) { poisoned = true; throw error }
    ledger = next
  }
  try {
    try { ledger = JSON.parse(await readFile(ledgerPath, 'utf8')) } catch (error) {
      if (error.code !== 'ENOENT') throw error
      ledger = { schemaVersion: 1, config, halted: false, attempts: [] }
      await persist(ledger)
    }
    if (ledger.schemaVersion !== 1 || JSON.stringify(ledger.config) !== JSON.stringify(config) || !Array.isArray(ledger.attempts) || typeof ledger.halted !== 'boolean') throw new Error('Ledger configuration changed or ledger is invalid; refusing to reset the budget.')
    const ids = new Set()
    for (const attempt of ledger.attempts) {
      if (typeof attempt.id !== 'string' || ids.has(attempt.id) || attempt.reservedTokens !== perRequestReservation || !Number.isSafeInteger(attempt.chargedTokens) || attempt.chargedTokens < 0 || attempt.chargedTokens > perRequestReservation || !['reserved', 'settled', 'usage_unknown', 'usage_exceeded_reservation'].includes(attempt.status)) throw new Error('Invalid budget attempt.')
      ids.add(attempt.id)
      // Unfinished or unknown requests must never be released on restart.
      if (attempt.status !== 'settled' && attempt.chargedTokens !== perRequestReservation) throw new Error('Unknown usage must retain its entire reservation.')
      if (attempt.status === 'settled' && (usageTokens({ usage: attempt.usage })?.total !== attempt.chargedTokens)) throw new Error('Invalid settled usage.')
      if (attempt.status === 'usage_exceeded_reservation' && !ledger.halted) throw new Error('Exceeded usage requires a halted ledger.')
    }
    if (!Number.isSafeInteger(reservationTotal(ledger.attempts)) || reservationTotal(ledger.attempts) > tokenLimit) throw new Error('Ledger exceeds the approved budget.')
  } catch (error) { await rmdir(lockPath); throw error }

  const reserve = () => serialize(async () => {
    if (poisoned || ledger.halted) throw new Error('Batch budget halted.')
    if (reservationTotal(ledger.attempts) + perRequestReservation > tokenLimit) throw new Error('Batch token budget exhausted.')
    const attempt = { id: randomUUID(), reservedTokens: perRequestReservation, chargedTokens: perRequestReservation, status: 'reserved', startedAt: new Date().toISOString() }
    await persist({ ...ledger, attempts: [...ledger.attempts, attempt] })
    return attempt.id
  })
  const settle = (id, usage) => serialize(async () => {
    const exceeded = usage !== undefined && (usage.input > inputTokenBudget || usage.output > outputTokenBudget || usage.total > perRequestReservation)
    const attempts = ledger.attempts.map((attempt) => attempt.id !== id ? attempt : {
      ...attempt, status: exceeded ? 'usage_exceeded_reservation' : usage === undefined ? 'usage_unknown' : 'settled',
      chargedTokens: usage !== undefined && !exceeded ? usage.total : attempt.reservedTokens,
      ...(usage === undefined ? {} : { usage: { input_tokens: usage.input, output_tokens: usage.output, total_tokens: usage.total } }),
      completedAt: new Date().toISOString(),
    })
    await persist({ ...ledger, halted: ledger.halted || exceeded, attempts })
  })
  const reply = (res, status, code) => {
    res.writeHead(status, { 'content-type': 'application/json' })
    res.end(JSON.stringify({ error: { code, message: code } }))
  }
  const server = createServer(async (req, res) => {
    let attemptId
    try {
      if (!['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(req.socket.remoteAddress)) return reply(res, 403, 'loopback_required')
      // Catalog lookups are needed for the Service's pre-model route freeze;
      // this exact read-only endpoint cannot submit a completion request.
      if (req.method === 'GET' && req.url === '/v1/models') {
        const response = await fetch(`${upstream.href.replace(/\/$/u, '')}/models`, { headers: req.headers.authorization === undefined ? {} : { authorization: req.headers.authorization }, redirect: 'error', signal: AbortSignal.timeout(10_000) })
        const chunks = []; let bytes = 0
        if (response.body !== null) for await (const chunk of response.body) {
          bytes += chunk.length
          if (bytes > 1024 * 1024) throw new Error('Catalog response too large.')
          chunks.push(chunk)
        }
        res.writeHead(response.status, { 'content-type': 'application/json', 'cache-control': 'no-store' })
        return res.end(Buffer.concat(chunks))
      }
      if (req.method !== 'POST' || !['/v1/chat/completions', '/v1/responses'].includes(req.url)) return reply(res, 404, 'route_not_allowed')
      let size = 0
      const chunks = []
      for await (const chunk of req) {
        size += chunk.length
        if (size > 4 * 1024 * 1024) return reply(res, 413, 'request_too_large')
        chunks.push(chunk)
      }
      const body = JSON.parse(Buffer.concat(chunks).toString('utf8'))
      const responseApi = req.url === '/v1/responses'
      const maxTokens = responseApi ? body.max_output_tokens : body.max_completion_tokens ?? body.max_tokens
      const outputFields = ['max_tokens', 'max_completion_tokens', 'max_output_tokens'].filter((key) => body[key] !== undefined)
      if (body.model !== modelId || !Number.isSafeInteger(maxTokens) || maxTokens <= 0 || maxTokens > outputTokenBudget || outputFields.length !== 1 || (responseApi ? outputFields[0] !== 'max_output_tokens' : outputFields[0] === 'max_output_tokens') || (body.tools?.length ?? 0) > 0 || (body.functions?.length ?? 0) > 0 || (body.n !== undefined && body.n !== 1) || (body.best_of !== undefined && body.best_of !== 1) || body.background === true) return reply(res, 400, 'request_outside_frozen_model_budget')
      if (body.stream === true && !responseApi) body.stream_options = { ...body.stream_options, include_usage: true }
      attemptId = await reserve()
      const path = responseApi ? 'responses' : 'chat/completions'
      const target = new URL(`${upstream.href.replace(/\/$/u, '')}/${path}`)
      const headers = { 'content-type': 'application/json', ...(req.headers.authorization === undefined ? {} : { authorization: req.headers.authorization }) }
      const response = await fetch(target, { method: 'POST', headers, body: JSON.stringify(body), redirect: 'error', signal: AbortSignal.timeout(requestTimeoutMs) })
      res.writeHead(response.status, { 'content-type': response.headers.get('content-type') ?? 'application/json', 'cache-control': 'no-store' })
      let usage
      const streaming = response.headers.get('content-type')?.includes('text/event-stream') === true
      let buffer = ''
      let captureValid = true
      const decoder = new TextDecoder()
      const inspect = (line) => {
        if (!line.startsWith('data:')) return
        try { usage = usageTokens(JSON.parse(line.slice(5).trim())) ?? usage } catch { /* [DONE] and non-usage events */ }
      }
      if (response.body !== null) for await (const chunk of response.body) {
        res.write(chunk)
        if (!captureValid) continue
        buffer += decoder.decode(chunk, { stream: true })
        if (streaming) {
          let end
          while ((end = buffer.indexOf('\n')) !== -1) { inspect(buffer.slice(0, end).replace(/\r$/u, '')); buffer = buffer.slice(end + 1) }
        }
        if (buffer.length > 8 * 1024 * 1024) { captureValid = false; buffer = '' }
      }
      buffer += decoder.decode()
      if (captureValid) {
        if (streaming) inspect(buffer)
        else { try { usage = usageTokens(JSON.parse(buffer)) } catch { /* unknown usage keeps the reservation */ } }
      }
      await settle(attemptId, response.ok && captureValid ? usage : undefined)
      attemptId = undefined
      res.end()
    } catch {
      // Never log request bodies, credentials, prompts, or provider error text.
      if (attemptId !== undefined) await settle(attemptId, undefined).catch(() => { poisoned = true })
      if (!res.headersSent) reply(res, 503, 'batch_request_refused_or_failed')
      else res.destroy()
    }
  })
  server.on('clientError', (_error, socket) => socket.destroy())
  return {
    server,
    async listen(port = 0) {
      if (closed) throw new Error('Budget gate is closed.')
      await new Promise((resolveListen, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', resolveListen) })
      return `http://127.0.0.1:${server.address().port}/v1`
    },
    async close() {
      if (closed) return
      closed = true
      if (server.listening) await new Promise((resolveClose, reject) => server.close((error) => error ? reject(error) : resolveClose()))
      await queue
      await rmdir(lockPath)
    },
  }
}
