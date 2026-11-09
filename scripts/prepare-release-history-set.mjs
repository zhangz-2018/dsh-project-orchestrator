import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFile, writeFile } from 'node:fs/promises'
import { assertGoldPrecedesBundleCandidates } from './release-gold-history.mjs'

// Combine evidence references, never rewrite past ledgers, infer successor
// versions, or count automatic successors as fresh candidates.
const [configurationPath, installationPath, projectsPath, destination] = process.argv.slice(2)
assert.ok(configurationPath && installationPath && projectsPath && destination)
const read = async path => JSON.parse(await readFile(path, 'utf8'))
const hash = bytes => createHash('sha256').update(bytes).digest('hex')
const configuration = await read(configurationPath)
const installation = await read(installationPath)
const projects = await read(projectsPath)
const paths = []
for (const path of configuration.previousObservations) {
  const previous = await read(path)
  const records = [previous.ledger, previous.domainFacts, previous.installedBundle, ...(previous.successorObservation === undefined ? [] : [previous.successorObservation])]
  assert.equal(previous.sources.length, records.length)
  for (const [i, source] of previous.sources.entries()) {
    const bytes = await readFile(source.path)
    assert.equal(hash(bytes), source.sha256)
    assert.deepEqual(JSON.parse(bytes), records[i])
  }
  paths.push({ ledger: previous.sources[0].path, domainFacts: previous.sources[1].path,
    ...(previous.successorObservation === undefined ? {} : { successorObservation: previous.sources[3].path }) })
}
paths.push(...configuration.additionalObservations)
const histories = []
for (const set of paths) {
  const history = { sources: [] }
  for (const [key, path] of Object.entries({ ledger: set.ledger, domainFacts: set.domainFacts, installedBundle: installationPath,
    ...(set.successorObservation === undefined ? {} : { successorObservation: set.successorObservation }) })) {
    const bytes = await readFile(path)
    history[key] = JSON.parse(bytes)
    history.sources.push({ path, sha256: hash(bytes) })
  }
  histories.push(history)
}
const projectIds = [...new Set(projects.projects.flatMap(p => Object.values(p.projectIdsByRun ?? { first: p.projectId })))]
const proofs = []
for (const projectId of projectIds) {
  const response = await fetch(`${projects.baseUrl}/project-orchestrator/api/projects/${projectId}/planning-operations`)
  assert.ok(response.ok)
  proofs.push(...assertGoldPrecedesBundleCandidates(await response.json(), installation.installedBundleSha256, histories))
}
assert.ok(proofs.length)
await writeFile(destination, JSON.stringify(histories, null, 2), { flag: 'wx' })
console.log(JSON.stringify({ destination, evidenceSets: histories.length, verifiedProjects: projectIds.length, terminalProofs: proofs.length, inferredVersions: 0, modelRequests: 0, domainMutations: 0 }))
