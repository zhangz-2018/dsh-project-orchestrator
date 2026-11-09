import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { execFile } from 'node:child_process'
import { createServer } from 'node:http'
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import test from 'node:test'

const run = promisify(execFile)
const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const verifier = join(repositoryRoot, 'scripts', 'verify-host-acceptance.mjs')
const repositoryBundle = join(repositoryRoot, 'lib', 'index.js')
const sha256 = (value) => createHash('sha256').update(value).digest('hex')

async function createAcceptanceFixture(root) {
  const profileRoot = join(root, 'profile')
  const storagePath = join(profileRoot, 'home', 'storages', 'project_orchestrator.json')
  const backupPath = join(profileRoot, 'backup', 'project_orchestrator.migrated.json')
  const installedBundle = join(profileRoot, 'home', 'profiles', 'web', 'node_modules', 'dsh-project-orchestrator', 'lib', 'index.js')
  await Promise.all([mkdir(dirname(storagePath), { recursive: true }), mkdir(dirname(backupPath), { recursive: true }), mkdir(dirname(installedBundle), { recursive: true })])
  await Promise.all([writeFile(storagePath, '{"fixture":true}\n'), writeFile(backupPath, '{"fixture":true}\n'), cp(repositoryBundle, installedBundle)])

  const gitRoot = join(root, 'git-input')
  await mkdir(gitRoot)
  await run('git', ['init'], { cwd: gitRoot })
  await run('git', ['config', 'user.email', 'test@example.com'], { cwd: gitRoot })
  await run('git', ['config', 'user.name', 'Test'], { cwd: gitRoot })
  await writeFile(join(gitRoot, 'README.md'), 'host acceptance fixture\n')
  await run('git', ['add', 'README.md'], { cwd: gitRoot })
  await run('git', ['commit', '-m', 'test: host acceptance fixture'], { cwd: gitRoot })
  await run('git', ['remote', 'add', 'origin', 'https://github.com/zhangz-2018/dsh-project-orchestrator.git'], { cwd: gitRoot })
  await run('git', ['update-ref', 'refs/remotes/origin/main', 'HEAD'], { cwd: gitRoot })

  const legacyProject = { id: 'legacy-host-31-project', name: 'Legacy host fixture' }
  const tasks = Array.from({ length: 31 }, (_, index) => ({
    id: `legacy-task-${index}`,
    projectId: legacyProject.id,
    issueId: `legacy-child-${index}`,
    status: index < 11 ? 'completed' : index < 21 ? 'failed' : 'draft',
  }))
  const issues = [
    { id: 'legacy-parent', projectId: legacyProject.id, status: 'todo' },
    ...tasks.map((task, index) => ({ id: task.issueId, projectId: legacyProject.id, parentIssueId: 'legacy-parent', status: index < 11 ? 'done' : index < 21 ? 'blocked' : 'todo' })),
  ]
  const gitProject = { id: 'real-git-project', name: 'Real Git Acceptance', cwd: gitRoot }
  const snapshot = {
    projects: [legacyProject, gitProject],
    tasks,
    issues,
    projectAgentMemberships: [{ projectId: legacyProject.id, agentId: 'default-agent-software-engineer', status: 'active' }],
    projectAgentMembershipSources: [{ projectId: legacyProject.id, agentId: 'default-agent-software-engineer', status: 'active' }],
    decisions: [{ id: 'legacy-approval:legacy-host-31-approval', status: 'approved' }],
    resources: [{ id: 'real-git-resource', projectId: gitProject.id, kind: 'github_repo', location: 'https://github.com/zhangz-2018/dsh-project-orchestrator.git', ref: 'main', sourcePath: gitRoot }],
  }
  return { profileRoot, storagePath, snapshot, legacyProject, tasks }
}

test('Host acceptance reports partial without recovery evidence and verifies a content-bound experiment', async () => {
  const root = await mkdtemp(join(tmpdir(), 'po-host-acceptance-'))
  let server
  try {
    const fixture = await createAcceptanceFixture(root)
    server = createServer((request, response) => {
      const path = new URL(request.url, 'http://test.local').pathname.replace('/project-orchestrator/api', '')
      const body = path === '/health'
        ? { ok: true }
        : path === '/snapshot'
          ? fixture.snapshot
          : path === `/projects/${fixture.legacyProject.id}/team-plan`
            ? { project: fixture.legacyProject, tasks: fixture.tasks }
            : undefined
      response.writeHead(body === undefined ? 404 : 200, { 'content-type': 'application/json' })
      response.end(JSON.stringify(body ?? { error: 'not found' }))
    })
    await new Promise((resolveListen, rejectListen) => {
      server.once('error', rejectListen)
      server.listen(0, '127.0.0.1', () => { server.off('error', rejectListen); resolveListen() })
    })
    const address = server.address()
    const baseUrl = `http://127.0.0.1:${address.port}`
    const partialOutput = join(root, 'partial-report.json')
    await run(process.execPath, [verifier, baseUrl, fixture.profileRoot], { cwd: repositoryRoot, env: { ...process.env, PO_HOST_ACCEPTANCE_OUTPUT: partialOutput } })
    const partial = JSON.parse(await readFile(partialOutput, 'utf8'))
    assert.equal(partial.status, 'partial')
    assert.equal(partial.storageRecovery.status, 'unknown')
    assert.equal(partial.storageRecovery.corruptionFailureObserved, undefined)

    const failureLog = join(root, 'corruption-failure.log')
    const failureLogBytes = Buffer.from('Host rejected the intentionally corrupted storage fixture.\n')
    await writeFile(failureLog, failureLogBytes)
    const storageBytes = await readFile(fixture.storagePath)
    const evidencePath = join(root, 'recovery-evidence.json')
    await writeFile(evidencePath, `${JSON.stringify({
      experimentId: 'host-recovery-test-1',
      observedAt: '2026-09-22T01:00:00.000Z',
      corruptionFailureObserved: true,
      corruptBytes: 17,
      failureLogPath: 'corruption-failure.log',
      failureLogDigest: sha256(failureLogBytes),
      restoredHash: sha256(storageBytes),
      backupHash: sha256(storageBytes),
    }, null, 2)}\n`)
    const verifiedOutput = join(root, 'verified-report.json')
    await run(process.execPath, [verifier, baseUrl, fixture.profileRoot, evidencePath], { cwd: repositoryRoot, env: { ...process.env, PO_HOST_ACCEPTANCE_OUTPUT: verifiedOutput } })
    const verified = JSON.parse(await readFile(verifiedOutput, 'utf8'))
    assert.equal(verified.status, 'passed')
    assert.equal(verified.storageRecovery.status, 'verified')
    assert.equal(verified.storageRecovery.failureLogDigest, sha256(failureLogBytes))
    assert.equal(verified.storageRecovery.evidenceFileHash, sha256(await readFile(evidencePath)))
  } finally {
    if (server !== undefined) await new Promise((resolveClose) => server.close(resolveClose))
    await rm(root, { recursive: true, force: true })
  }
})
