import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFile, writeFile } from 'node:fs/promises'
import { assertGoldPrecedesBundleCandidates } from './release-gold-history.mjs'

// Local evidence projection only. The older ledger and domain audit are kept
// byte-for-byte; no version is filled into an existing operation.
const paths = {
  ledger: process.argv[3] ?? 'output/acceptance/release-collection-focused-evidence-v11-2026-10-16.json',
  domainFacts: process.argv[4] ?? 'output/acceptance/release-focused-evidence-v11-all4-domain-facts-2026-10-16.json',
  installedBundle: process.argv[5] ?? 'output/acceptance/installed-bundle-transitive-policy-v13-2026-10-16.json',
  ...(process.argv[7] === undefined ? {} : { successorObservation: process.argv[7] }),
}
const history = {}
const sources = []
for (const [key, path] of Object.entries(paths)) {
  const bytes = await readFile(path)
  history[key] = JSON.parse(bytes)
  sources.push({ path, sha256: createHash('sha256').update(bytes).digest('hex') })
}
const proofs = []
for (const projectId of (process.argv[6] ?? 'f45acad5-36c5-422b-8288-b2996dd4a754').split(',')) {
  const response = await fetch(`http://127.0.0.1:3087/project-orchestrator/api/projects/${projectId}/planning-operations`)
  assert.ok(response.ok)
  proofs.push(...assertGoldPrecedesBundleCandidates(await response.json(), history.installedBundle.installedBundleSha256, history))
}
assert.ok(proofs.length > 0)
const report = { ...history, sources, proofs, recordedAt: new Date().toISOString(), modelRequests: 0, domainMutations: 0 }
const destination = process.argv[2] ?? 'output/acceptance/release-historical-policy-observation-v13-2026-10-16.json'
await writeFile(destination, JSON.stringify(report, null, 2), { flag: 'wx' })
console.log(JSON.stringify({ destination, sources, proofs, modelRequests: 0, domainMutations: 0 }))
