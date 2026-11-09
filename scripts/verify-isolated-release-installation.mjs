import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFile, realpath, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'

// Verify the isolated installation; never install, dispatch, or confirm claims.
const [packagePath, hostLog, localVerification, canaryVerification, destination] = process.argv.slice(2)
assert.ok(packagePath && hostLog && localVerification && canaryVerification && destination)
const isolated = JSON.parse(await readFile('output/acceptance/isolated-harness-2026-10-14.json', 'utf8'))
const hash = bytes => createHash('sha256').update(bytes).digest('hex')
const localBundleSha256 = hash(await readFile('lib/index.js'))
const installedPath = await realpath(join(isolated.profile, 'node_modules/dsh-project-orchestrator/lib/index.js'))
assert.ok(installedPath.startsWith(`${await realpath(isolated.profile)}/node_modules/`))
const installedBundleSha256 = hash(await readFile(installedPath))
assert.equal(installedBundleSha256, localBundleSha256)
const profile = JSON.parse(await readFile(join(isolated.profile, 'package.json'), 'utf8'))
assert.equal(profile.dependencies['dsh-project-orchestrator'], `file:${resolve(packagePath)}`)
const response = await fetch('http://127.0.0.1:3087/project-orchestrator/api/snapshot', { signal: AbortSignal.timeout(30_000) })
assert.ok(response.ok)
const snapshot = await response.json()
assert.equal(snapshot.planningOperations.filter(o => o.status === 'running').length, 0)
const writerResponse = await fetch('http://127.0.0.1:3087/project-orchestrator/api/admin/workspace-writer', { signal: AbortSignal.timeout(30_000) })
assert.ok(writerResponse.ok)
const writer = await writerResponse.json()
const workspaceId = 'po-certified-acceptance-EiDNyF'
assert.equal(writer.health, 'healthy')
assert.equal(writer.workspaceIdentityDigest, hash(workspaceId))
const original = JSON.parse(await readFile('output/acceptance/release-capabilities-confirmed-2026-10-16.json', 'utf8'))
let confirmedCount = 0
for (const p of original.projects) for (const claim of p.claims) {
  assert.deepEqual(snapshot.agentCapabilityClaims.find(c => c.id === claim.id), claim)
  confirmedCount++
}
assert.equal(confirmedCount, 204)
const addendum = JSON.parse(await readFile('output/acceptance/release-capability-addendum-52-2026-10-16.json', 'utf8'))
assert.equal(addendum.declarations.length, 52)
const registration = JSON.parse(await readFile('output/acceptance/release-capability-addendum-52-confirmed-2026-10-16.json', 'utf8'))
assert.equal(registration.status, 'confirmed_and_persisted')
assert.equal(registration.confirmedCount, 52)
const confirmed = registration.projects.flatMap(p => p.claims)
assert.equal(confirmed.length, 52)
for (const d of addendum.declarations) {
  const matches = confirmed.filter(c => ['projectId', 'agentId', 'capabilityId'].every(key => c[key] === d[key]))
  assert.equal(matches.length, 1)
  const claim = matches[0]
  for (const key of ['projectId', 'agentId', 'capabilityId']) assert.equal(claim[key], d[key])
  assert.equal(claim.status, 'active')
  assert.equal(claim.source, 'human_confirmed')
  assert.ok(claim.confirmedBy && claim.evidenceRef)
  assert.deepEqual(snapshot.agentCapabilityClaims.find(c => c.id === claim.id), claim)
  assert.deepEqual(snapshot.agentCapabilityClaims.find(c => c.id === d.pendingClaim.id), d.pendingClaim)
}
const canary = JSON.parse(await readFile(canaryVerification, 'utf8'))
assert.equal(canary.status, 'canary_v2_verified')
assert.equal(canary.finalCommit, '8541b63a4959b3b82ce12df570f93507f6435cba')
assert.equal(canary.taskRunCount, 2)
assert.equal(canary.humanReviewApproved, true)
assert.equal(canary.deliveryConfirmed, true)
const report = {
  status: 'isolated_package_installed_and_canary_reverified', verifiedAt: new Date().toISOString(),
  package: packagePath, packageSha256: hash(await readFile(packagePath)), baseUrl: 'http://127.0.0.1:3087',
  localBundleSha256, installedBundleSha256, hostLog, contractMode: 'v3-candidate',
  workspaceId, lockDirectory: join(isolated.root, 'writer-locks'), hostPid: writer.ownerPid, writer,
  canaryVerification, localVerification, original204ClaimsUnchanged: true, confirmedAddendumClaims: 52, unconfirmedAddendumClaims: 0,
  historicalPendingDeclarationsPreserved: 52,
  addendumRegistrationExecuted: true, originalUserHostModified: false, releaseQualificationPassed: false,
}
await writeFile(destination, JSON.stringify(report, null, 2), { flag: 'wx' })
console.log(JSON.stringify(report))
