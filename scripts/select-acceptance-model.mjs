import { appendFile, readFile, realpath, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { createRequire } from 'node:module'

const model = process.argv[2]
if (!model || !/^[a-zA-Z0-9._-]{1,240}$/u.test(model)) throw new Error('Usage: node scripts/select-acceptance-model.mjs <model-id>')
const reportPath = resolve('output/acceptance/isolated-harness-2026-10-14.json')
const report = JSON.parse(await readFile(reportPath, 'utf8'))
const require = createRequire(await realpath(join(report.profile, 'node_modules/@deepseek-ai/dsh/package.json')))
const yaml = require('js-yaml')
const settingsPath = join(report.home, 'settings.yaml')
const settings = yaml.load(await readFile(settingsPath, 'utf8'))
const selection = settings['agent-default-model']
const sourceHome = process.argv[3]
if (sourceHome !== undefined) {
  const sourceSettings = yaml.load(await readFile(join(resolve(sourceHome), 'settings.yaml'), 'utf8'))
  const sourceSelection = sourceSettings['agent-default-model']
  const sourceProvider = sourceSettings['llm-pi-ai']?.providers?.[sourceSelection?.provider]
  const sourceCredentials = yaml.load(await readFile(join(resolve(sourceHome), '.credentials.yaml'), 'utf8'))
  const reference = sourceProvider?.apiKeyEnv
  const credential = sourceCredentials?.refs?.[reference] ?? sourceCredentials?.[reference]
  if (!sourceProvider || !reference || typeof credential !== 'string') throw new Error('The selected source provider must have a stored credential.')
  settings['llm-pi-ai'].providers = { [sourceSelection.provider]: sourceProvider }
  Object.assign(selection, sourceSelection)
  report.modelProvider = sourceSelection.provider
  report.connectionRefreshedAt = new Date().toISOString()
  await writeFile(join(report.home, '.credentials.yaml'), yaml.dump({ [reference]: credential }), { mode: 0o600 })
}
const provider = settings['llm-pi-ai'].providers[selection.provider]
if (!provider.models.some((entry) => entry.id === model)) {
  const template = provider.models.find((entry) => entry.id === selection.model)
  if (template === undefined) throw new Error('No configured route limits are available for the selected provider.')
  provider.models.push({ ...template, id: model, name: model })
  report.modelCatalogSource = 'explicit_user_selection_with_existing_provider_limits'
}
selection.model = model
report.modelId = model
report.modelSelectionUpdatedAt = new Date().toISOString()
await writeFile(settingsPath, yaml.dump(settings), { mode: 0o600 })
await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`)
console.log(JSON.stringify({ modelProvider: selection.provider, modelId: model, target: 'isolated acceptance Profile', providerLimitsInherited: report.modelCatalogSource !== undefined }))

const credentials = yaml.load(await readFile(join(report.home, '.credentials.yaml'), 'utf8'))
const credential = credentials[provider.apiKeyEnv]
if (typeof credential !== 'string') throw new Error('The isolated provider credential is unavailable.')
if (provider.api !== 'openai-completions') throw new Error('The connectivity probe supports only the configured openai-completions protocol.')
const observedAt = new Date().toISOString()
let result
try {
  const response = await fetch(`${provider.baseURL.replace(/\/$/u, '')}/chat/completions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${credential}` },
    body: JSON.stringify({ model, messages: [{ role: 'user', content: 'Reply with exactly OK.' }], max_tokens: 64, stream: false }),
    signal: AbortSignal.timeout(20_000),
  })
  const data = await response.json().catch(() => undefined)
  const errorCode = data?.error?.code
  const text = data?.choices?.[0]?.message?.content
  result = {
    status: response.ok && typeof text === 'string' && text.trim().length > 0 ? 'passed' : 'failed',
    httpStatus: response.status,
    textCharacters: typeof text === 'string' ? text.length : 0,
    ...(typeof errorCode === 'string' && /^[a-zA-Z0-9_-]{1,100}$/u.test(errorCode) ? { errorCode } : {}),
    ...(response.ok && typeof data?.model === 'string' && /^[a-zA-Z0-9._-]{1,240}$/u.test(data.model) ? { responseModel: data.model } : {}),
  }
} catch (error) {
  result = { status: 'failed', errorName: error.name }
}
const probe = { ...result, modelProvider: selection.provider, requestedModel: model, observedAt, protocol: provider.api }
await appendFile(resolve('output/acceptance/model-connectivity-history-2026-10-14.jsonl'), `${JSON.stringify(probe)}\n`, { mode: 0o600 })
await writeFile(resolve('output/acceptance/model-connectivity-2026-10-14.json'), `${JSON.stringify(probe, null, 2)}\n`)
console.log(JSON.stringify(probe))
if (probe.status !== 'passed') process.exitCode = 1
