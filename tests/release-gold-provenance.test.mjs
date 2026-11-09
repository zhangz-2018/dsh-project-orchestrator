import assert from 'node:assert/strict'
import test from 'node:test'
import { buildScopedCapabilityProvenance } from '../scripts/release-gold-provenance.mjs'

/** 模拟保留原登记字段的同项目事实，供作用域证据的正反例复用。 */
function fixture() {
  const claim = { id: 'claim-1', projectId: 'original-project', agentId: 'engineer', capabilityId: 'api.contract', capabilityVersion: 1, status: 'active', source: 'human_confirmed', confirmedBy: 'human', claimDigest: 'original-digest' }
  const { id: _id, projectId: _projectId, claimDigest: _digest, ...projection } = claim
  return { projectId: claim.projectId, teamCatalogFacts: { members: [{ agentId: claim.agentId }], claims: [projection] }, snapshotClaims: [structuredClone(claim)], apiClaims: [structuredClone(claim)], receipts: [{ path: 'receipt.json', sha256: 'receipt-digest', claims: [claim] }] }
}

test('Gold scope evidence retains original claim identity even without planning history', () => {
  const input = fixture()
  const proof = buildScopedCapabilityProvenance(input)
  assert.equal(proof.originalProjectScopedClaimsVerified, true)
  assert.deepEqual(proof.matches[0].claim, input.receipts[0].claims[0])
})

test('Gold scope evidence rejects globalized or copied project attestations', () => {
  for (const scope of [undefined, 'new-project']) {
    const input = fixture()
    if (scope !== undefined) input.projectId = scope
    for (const claims of [input.snapshotClaims, input.apiClaims]) claims[0].projectId = scope
    assert.throws(() => buildScopedCapabilityProvenance(input), /broadened|original registration/)
  }
})

test('Gold scope evidence rejects missing receipts and changed confirmation facts', () => {
  const input = fixture()
  input.receipts = []
  assert.throws(() => buildScopedCapabilityProvenance(input), /registration receipt/)
  const changed = fixture()
  changed.receipts[0].claims[0].confirmedBy = 'someone else'
  assert.throws(() => buildScopedCapabilityProvenance(changed), /original registration field/)
})

test('Gold scope evidence rejects an API or frozen projection mismatch', () => {
  const api = fixture()
  api.apiClaims[0].claimDigest = 'changed'
  assert.throws(() => buildScopedCapabilityProvenance(api), /scoped API/)
  const projection = fixture()
  projection.teamCatalogFacts.claims[0].capabilityId = 'domain.state'
  assert.throws(() => buildScopedCapabilityProvenance(projection), /frozen active projection/)
})
