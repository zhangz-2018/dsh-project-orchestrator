import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { createPlanningBatchBudgetGate } from './planning-batch-budget.mjs'

// No implicit limit, upstream, ledger or model. A reviewed configuration is
// required before opening a listener; credentials remain in Harness settings.
const [configurationPath] = process.argv.slice(2)
if (!configurationPath || process.argv.length !== 3) throw new Error('Usage: node scripts/run-planning-batch-budget-gate.mjs CONFIGURATION_JSON')
const configuration = JSON.parse(await readFile(resolve(configurationPath), 'utf8'))
const allowedKeys = ['ledgerPath', 'modelId', 'upstreamBaseUrl', 'tokenLimit', 'inputTokenBudget', 'outputTokenBudget', 'requestTimeoutMs', 'port']
if (Object.keys(configuration).some((key) => !allowedKeys.includes(key))) throw new Error('Unknown configuration field; never place credentials in the batch configuration.')
if (typeof configuration.ledgerPath !== 'string' || !configuration.ledgerPath.startsWith('/')) throw new Error('ledgerPath must be an explicit absolute path.')
if (!Number.isInteger(configuration.port) || configuration.port < 1024 || configuration.port > 65535) throw new Error('An explicit loopback port between 1024 and 65535 is required.')
const gate = await createPlanningBatchBudgetGate(configuration)
let stopping = false
const stop = async () => {
  if (stopping) return
  stopping = true
  await gate.close()
}
try {
  const baseUrl = await gate.listen(configuration.port)
  console.log(JSON.stringify({ baseUrl, ledgerPath: configuration.ledgerPath, modelId: configuration.modelId, tokenLimit: configuration.tokenLimit, status: 'listening_not_connected_to_harness' }))
  for (const signal of ['SIGTERM', 'SIGINT']) process.once(signal, () => { void stop().catch(() => { process.exitCode = 1 }) })
} catch (error) {
  await stop()
  throw error
}
