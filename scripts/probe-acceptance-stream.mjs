import { readFile, realpath, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { join, resolve } from 'node:path'

const report = JSON.parse(await readFile(resolve('output/acceptance/isolated-harness-2026-10-14.json'), 'utf8'))
const require = createRequire(await realpath(join(report.profile, 'node_modules/@deepseek-ai/dsh/package.json')))
const yaml = require('js-yaml')
const settings = yaml.load(await readFile(join(report.home, 'settings.yaml'), 'utf8'))
const selection = settings['agent-default-model']
const provider = settings['llm-pi-ai'].providers[selection.provider]
const credentials = yaml.load(await readFile(join(report.home, '.credentials.yaml'), 'utf8'))
const protocol = process.argv[2] ?? 'chat'
if (!['chat', 'responses'].includes(protocol)) throw new Error('Expected chat or responses protocol.')
const result = {
  requestedModel: selection.model, protocol, observedAt: new Date().toISOString(),
  status: 'failed', eventCount: 0, textCharacters: 0, terminalObserved: false, upstreamErrorObserved: false,
}
try {
  const response = await fetch(`${provider.baseURL.replace(/\/$/u, '')}/${protocol === 'chat' ? 'chat/completions' : 'responses'}`, {
    method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${credentials[provider.apiKeyEnv]}` },
    body: JSON.stringify(protocol === 'chat'
      ? { model: selection.model, messages: [{ role: 'user', content: 'Reply with exactly OK.' }], max_tokens: 512, stream: true }
      : { model: selection.model, input: 'Reply with exactly OK.', max_output_tokens: 512, stream: true }),
    signal: AbortSignal.timeout(30_000),
  })
  result.httpStatus = response.status
  result.contentType = response.headers.get('content-type')
  if (response.ok && result.contentType?.includes('text/event-stream')) {
    const decoder = new TextDecoder()
    let pending = ''
    const inspectLine = (line) => {
      if (!line.startsWith('data:')) return
      const payload = line.slice(5).trim()
      if (payload === '[DONE]') { result.terminalObserved = true; return }
      let event
      try { event = JSON.parse(payload) } catch { result.malformedEventObserved = true; return }
      result.eventCount += 1
      if (event.error || event.type === 'error' || event.type === 'response.failed' || event.type === 'response.incomplete') result.upstreamErrorObserved = true
      for (const choice of event.choices ?? []) {
        if (typeof choice.delta?.content === 'string') result.textCharacters += choice.delta.content.length
        if (typeof choice.finish_reason === 'string') result.finishReason = choice.finish_reason
      }
      if (event.type === 'response.output_text.delta' && typeof event.delta === 'string') result.textCharacters += event.delta.length
      if (event.type === 'response.completed') result.terminalObserved = true
    }
    for await (const chunk of response.body) {
      pending += decoder.decode(chunk, { stream: true })
      const lines = pending.split('\n')
      pending = lines.pop()
      for (const line of lines) inspectLine(line)
    }
    pending += decoder.decode()
    if (pending.trim()) inspectLine(pending)
    if (result.textCharacters > 0 && result.terminalObserved && !result.upstreamErrorObserved && !result.malformedEventObserved) result.status = 'passed'
  }
} catch (error) { result.errorName = error.name }
await writeFile(resolve(`output/acceptance/model-stream-${protocol}-2026-10-14.json`), `${JSON.stringify(result, null, 2)}\n`)
console.log(JSON.stringify(result))
if (result.status !== 'passed') process.exitCode = 1
