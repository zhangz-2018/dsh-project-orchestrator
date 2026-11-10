import assert from 'node:assert/strict'
import test from 'node:test'
import { plannedVerificationEntriesV3, repositoryVerificationCommandCatalogV3, repositoryVerificationCommandsV3 } from '../lib/index.js'

const existing = 'packages/bench/existing.ts'
const targetPath = 'packages/bench/new-measurement.ts'
const templateCommand = `nub --expose-gc --conditions=@source ${existing}`
const command = `nub --expose-gc --conditions=@source ${targetPath}`
const declaration = entry => `planned-verification-entry: ${JSON.stringify(entry)}`

test('planned verification entry preserves absent target provenance and an exact existing runner template', () => {
  const verifiedCommands = repositoryVerificationCommandsV3(['package.json', existing], { packageManager: 'nub@0.8.3', scripts: { dev: 'nub --conditions @source' } }, `Inspect \`${existing}\``, { [existing]: '/**\n * Run with: nub --expose-gc\n */' })
  assert.ok(verifiedCommands.includes(templateCommand))
  const entries = plannedVerificationEntriesV3([existing], verifiedCommands, declaration({ targetPath, command }))
  assert.equal(entries[0].targetState, 'absent')
  assert.equal(entries[0].templateCommand, templateCommand)
  assert.equal(verifiedCommands.includes(command), false)
  assert.deepEqual(repositoryVerificationCommandCatalogV3({ verifiedCommands, plannedVerificationEntries: entries }), [templateCommand, command])
  assert.equal(plannedVerificationEntriesV3([existing, targetPath], verifiedCommands, declaration({ targetPath, command }))[0].targetState, 'present')
  assert.deepEqual(plannedVerificationEntriesV3([existing], verifiedCommands, `A prose example: ${command}`), [])
})

test('planned verification entry rejects arbitrary flags, shell, traversal, cross-directory templates and malformed declarations', () => {
  for (const entry of [
    { targetPath, command: `${command}; touch /tmp/no` },
    { targetPath, command: command.replace('--expose-gc', '--eval=evil') },
    { targetPath, command: command.replace('@source', '@other') },
    { targetPath: '../new.ts', command: 'nub --expose-gc ../new.ts' },
    { targetPath: '/tmp/new.ts', command: 'nub --expose-gc /tmp/new.ts' },
    { targetPath: 'packages/other/new.ts', command: 'nub --expose-gc --conditions=@source packages/other/new.ts' },
    { targetPath, command, approved: true },
  ]) assert.throws(() => plannedVerificationEntriesV3([existing], [templateCommand], declaration(entry)), error => /planned-verification/u.test(error.code))
  assert.throws(() => plannedVerificationEntriesV3([], [templateCommand], declaration({ targetPath, command })), error => error.code === 'planned-verification-template-unconfirmed')
  assert.throws(() => plannedVerificationEntriesV3([existing], [templateCommand], 'planned-verification-entry: invalid'), error => error.code === 'planned-verification-entry-invalid')
  assert.throws(() => plannedVerificationEntriesV3([existing], [templateCommand], `${declaration({ targetPath, command })}\n${declaration({ targetPath, command })}`), error => error.code === 'planned-verification-entry-invalid')
})
