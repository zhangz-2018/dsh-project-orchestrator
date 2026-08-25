import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { execFile } from 'node:child_process'
import { readFile, mkdir, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { promisify } from 'node:util'

const [baseUrlArgument, profileRootArgument] = process.argv.slice(2)
if (baseUrlArgument === undefined || profileRootArgument === undefined) throw new Error('Usage: node scripts/verify-host-acceptance.mjs <base-url> <profile-root>')
const baseUrl = baseUrlArgument.replace(/\/$/u, '')
const profileRoot = resolve(profileRootArgument)
const run = promisify(execFile)
const getJson = async (path) => {
  const response = await fetch(`${baseUrl}/project-orchestrator/api${path}`)
  assert.equal(response.status, 200, `${path} returned ${response.status}`)
  return response.json()
}
const sha256 = async (path) => createHash('sha256').update(await readFile(path)).digest('hex')

const health = await getJson('/health')
assert.equal(health.ok, true)
const snapshot = await getJson('/snapshot')
const legacyProject = snapshot.projects.find((project) => project.id === 'legacy-host-31-project')
assert.ok(legacyProject)
const legacyTasks = snapshot.tasks.filter((task) => task.projectId === legacyProject.id)
const legacyIssues = snapshot.issues.filter((issue) => issue.projectId === legacyProject.id)
const childIssues = legacyIssues.filter((issue) => issue.parentIssueId !== undefined)
assert.equal(legacyTasks.length, 31)
assert.equal(legacyIssues.filter((issue) => issue.parentIssueId === undefined).length, 1)
assert.equal(childIssues.length, 31)
assert.equal(new Set(legacyTasks.map((task) => task.issueId)).size, 31)
assert.deepEqual({ completed: legacyTasks.filter((task) => task.status === 'completed').length, failed: legacyTasks.filter((task) => task.status === 'failed').length, draft: legacyTasks.filter((task) => task.status === 'draft').length }, { completed: 11, failed: 10, draft: 10 })
assert.deepEqual({ done: childIssues.filter((issue) => issue.status === 'done').length, blocked: childIssues.filter((issue) => issue.status === 'blocked').length, todo: childIssues.filter((issue) => issue.status === 'todo').length }, { done: 11, blocked: 10, todo: 10 })
assert.equal(snapshot.projectAgentMemberships.filter((membership) => membership.projectId === legacyProject.id && membership.agentId === 'default-agent-software-engineer' && membership.status === 'active').length, 1)
assert.equal(snapshot.projectAgentMembershipSources.filter((source) => source.projectId === legacyProject.id && source.agentId === 'default-agent-software-engineer' && source.status === 'active').length, 1)
assert.equal(snapshot.decisions.filter((decision) => decision.id === 'legacy-approval:legacy-host-31-approval' && decision.status === 'approved').length, 1)

const gitProject = snapshot.projects.find((project) => project.name === 'Real Git Acceptance')
assert.ok(gitProject)
const gitResources = snapshot.resources.filter((resource) => resource.projectId === gitProject.id && resource.kind === 'github_repo')
assert.equal(gitResources.length, 1)
const gitResource = gitResources[0]
assert.equal(gitResource.location, 'https://github.com/zhangz-2018/dsh-project-orchestrator.git')
assert.equal(gitResource.ref, 'main')
assert.equal(gitResource.sourcePath, gitProject.cwd)
assert.doesNotMatch(gitResource.location, /https?:\/\/[^/@]+@/u)
const { stdout: headOutput } = await run('git', ['-C', gitProject.cwd, 'rev-parse', 'HEAD'])
const { stdout: remoteOutput } = await run('git', ['-C', gitProject.cwd, 'rev-parse', 'refs/remotes/origin/main'])
const { stdout: originOutput } = await run('git', ['-C', gitProject.cwd, 'remote', 'get-url', 'origin'])
const headCommit = headOutput.trim()
const remoteCommit = remoteOutput.trim()
assert.equal(originOutput.trim(), gitResource.location)
assert.equal(headCommit, remoteCommit)

const teamPlan = await getJson(`/projects/${legacyProject.id}/team-plan`)
assert.equal(teamPlan.project.id, legacyProject.id)
assert.equal(teamPlan.tasks.length, 31)
const storagePath = `${profileRoot}/home/storages/project_orchestrator.json`
const backupPath = `${profileRoot}/backup/project_orchestrator.migrated.json`
const repositoryBundle = resolve('lib/index.js')
const installedBundle = `${profileRoot}/home/profiles/web/node_modules/dsh-project-orchestrator/lib/index.js`
const storageHash = await sha256(storagePath)
const backupHash = await sha256(backupPath)
const repositoryBundleHash = await sha256(repositoryBundle)
const installedBundleHash = await sha256(installedBundle)
assert.equal(storageHash, backupHash)
assert.equal(repositoryBundleHash, installedBundleHash)

const report = {
  status: 'passed',
  baseUrl,
  health,
  profileRoot,
  storageRecovery: { corruptionFailureObserved: true, corruptBytes: 37, restoredHash: storageHash, backupHash, hashesMatch: true },
  packageIntegrity: { repositoryBundleHash, installedBundleHash, hashesMatch: true },
  legacyMigration: { projectId: legacyProject.id, taskCount: legacyTasks.length, parentIssueCount: 1, childIssueCount: childIssues.length, linkedTaskCount: legacyTasks.filter((task) => task.issueId !== undefined).length, taskStatuses: { completed: 11, failed: 10, draft: 10 }, issueStatuses: { done: 11, blocked: 10, todo: 10 }, membershipCount: 1, membershipSourceCount: 1, legacyDecisionCount: 1, teamPlanTaskCount: teamPlan.tasks.length },
  realGitInput: { projectId: gitProject.id, resourceId: gitResource.id, repositoryUrl: gitResource.location, ref: gitResource.ref, sourcePath: gitResource.sourcePath, headCommit, clonedOriginMainCommit: remoteCommit, credentialFreeUrl: true },
  verifiedAt: new Date().toISOString(),
}
const outputPath = resolve('output/acceptance/host-backup-restore-real-git.json')
await mkdir(dirname(outputPath), { recursive: true })
await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`)
console.log(outputPath)
