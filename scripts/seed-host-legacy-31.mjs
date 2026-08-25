import assert from 'node:assert/strict'
import { readFile, rename, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'

const [storageArgument, repositoryArgument] = process.argv.slice(2)
if (storageArgument === undefined || repositoryArgument === undefined) throw new Error('Usage: node scripts/seed-host-legacy-31.mjs <storage-json> <repository-directory>')
const storagePath = resolve(storageArgument)
const repositoryPath = resolve(repositoryArgument)
assert.notEqual(storagePath, '/')
assert.notEqual(dirname(storagePath), '/')

const document = JSON.parse(await readFile(storagePath, 'utf8'))
assert.equal(typeof document.tables, 'object')
for (const table of ['agents', 'projects', 'tasks', 'approvals']) assert.equal(typeof document.tables[table], 'object', `missing table ${table}`)
const agentId = 'default-agent-software-engineer'
assert.equal(document.tables.agents[agentId]?.status, 'active')

const now = new Date().toISOString()
const projectId = 'legacy-host-31-project'
const taskIds = Array.from({ length: 31 }, (_, index) => `legacy-host-task-${String(index + 1).padStart(2, '0')}`)
document.tables.projects[projectId] = {
  id: projectId,
  name: 'Host Legacy 31 Task Migration',
  summary: 'Physical storage migration acceptance.',
  cwd: repositoryPath,
  prd: 'Preserve all 31 legacy tasks and their states.',
  technicalDesign: 'Migrate through initialize without duplicate facts.',
  status: 'draft',
  revision: 9,
  taskIds,
  leadAgentId: agentId,
  createdAt: now,
  updatedAt: now,
}
for (const [index, id] of taskIds.entries()) {
  document.tables.tasks[id] = {
    id,
    projectId,
    ordinal: index,
    title: `Host Legacy Task ${index + 1}`,
    kind: 'code',
    description: `Legacy physical task ${index + 1}.`,
    acceptanceCriteria: ['Legacy task remains traceable.'],
    dependencies: index === 0 ? [] : [taskIds[index - 1]],
    testCommand: 'true',
    agentId,
    status: index % 3 === 0 ? 'completed' : index % 3 === 1 ? 'failed' : 'draft',
    createdAt: now,
    updatedAt: now,
  }
}
document.tables.approvals['legacy-host-31-approval'] = {
  id: 'legacy-host-31-approval',
  projectId,
  revision: 9,
  planHash: 'b'.repeat(64),
  actor: 'legacy-delivery-owner',
  approvedAt: now,
}

const temporaryPath = `${storagePath}.seed-${process.pid}`
await writeFile(temporaryPath, `${JSON.stringify(document, null, 2)}\n`, { mode: 0o600 })
await rename(temporaryPath, storagePath)
console.log(JSON.stringify({ storagePath, projectId, taskCount: taskIds.length, approvalId: 'legacy-host-31-approval' }))
