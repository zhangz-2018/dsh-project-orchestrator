import assert from 'node:assert/strict'
import { digestObject } from '../lib/index.js'

/** 将当前 active 投影逐条绑定到同项目原登记回执；拒绝全局化、跨项目或变更过的人工事实，不写入领域数据。 */
export function buildScopedCapabilityProvenance({ projectId, teamCatalogFacts, snapshotClaims, apiClaims, receipts }) {
  const members = new Set(teamCatalogFacts.members.map(member => member.agentId))
  const active = snapshotClaims.filter(claim => members.has(claim.agentId) && (claim.projectId === undefined || claim.projectId === projectId) && claim.status === 'active')
  const projectApiActive = apiClaims.filter(claim => members.has(claim.agentId) && claim.status === 'active')
  const sort = claims => claims.map(digestObject).sort()
  assert.deepEqual(sort(active), sort(projectApiActive), 'Snapshot and scoped API claims disagree')
  const projectClaim = ({ id: _id, projectId: _projectId, claimDigest: _digest, ...claim }) => claim
  assert.deepEqual(sort(active.map(projectClaim)), sort(teamCatalogFacts.claims.filter(claim => claim.status === 'active')), 'Raw scope evidence must match the frozen active projection exactly')
  const matches = active.map(claim => {
    assert.equal(claim.projectId, projectId, 'Historical project-scoped claims must not be broadened to global scope')
    const matches = receipts.flatMap(receipt => receipt.claims.filter(original => original.id === claim.id).map(original => ({ receipt, original })))
    assert.equal(matches.length, 1, 'Every relied-upon claim needs exactly one original registration receipt')
    const { receipt, original } = matches[0]
    assert.deepEqual(claim, original, 'Current claim must preserve every original registration field')
    return { claim, registrationReceipt: { path: receipt.path, sha256: receipt.sha256 }, frozenProjectionDigest: digestObject(projectClaim(claim)) }
  })
  return {
    projectId, originalProjectScopedClaimsVerified: true,
    policy: 'Raw snapshot and scoped GET claims match the frozen active projection after the Service removes only id, projectId and claimDigest. Every full claim exactly matches its original registration receipt, including the original projectId. Project operation history is independent of capability scope. This read-only check creates no attestation.',
    matches,
  }
}
