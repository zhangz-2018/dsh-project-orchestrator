import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { execFileSync, spawnSync } from 'node:child_process'
import { mkdir, mkdtemp, readFile, realpath, symlink, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'

// Supply requested tool-source evidence before any current-bundle candidate.
// The experiment uses a new controlled fixture, never the benchmark repository.
const [toolDirectoryArgument, projectsPath, previousReviewPath, destination] = process.argv.slice(2)
assert.ok(toolDirectoryArgument && projectsPath && previousReviewPath && destination)
const toolsDirectory = resolve(toolDirectoryArgument)
const projects = JSON.parse(await readFile(projectsPath, 'utf8'))
const packet = JSON.parse(await readFile(projects.packetPath, 'utf8'))
const previous = JSON.parse(await readFile(previousReviewPath, 'utf8'))
assert.equal(previous.status, 'insufficient_evidence')
const item = packet.cases.find(c => c.caseId === previous.caseId)
assert.equal(item.repositoryIdentity, 'sindresorhus/p-queue')
const archivePath = join(toolsDirectory, 'nz-0.1.0.tgz')
const hash = v => createHash('sha256').update(v).digest('hex')
const files = ['package.json', 'readme.md', 'source/cli.js', 'source/runner.js'].map(path => {
  const content = execFileSync('tar', ['-xOf', archivePath, `package/${path}`], { encoding: 'utf8', maxBuffer: 1_000_000 })
  return { path, content, sha256: hash(content), truncated: false }
})
assert.equal(JSON.parse(files[0].content).version, '0.1.0')
const root = await mkdtemp(join(toolsDirectory, 'nz-discovery-fixture-'))
execFileSync('tar', ['-xf', archivePath, '-C', root])
const fixture = join(root, 'fixture')
await mkdir(join(fixture, 'node_modules'), { recursive: true })
await mkdir(join(fixture, 'test-d'))
await mkdir(join(fixture, 'source'))
await symlink(await realpath(join(toolsDirectory, 'package')), join(fixture, 'node_modules/typescript'), 'dir')
const compilerVersion = JSON.parse(await readFile(join(fixture, 'node_modules/typescript/package.json'), 'utf8')).version
assert.equal(compilerVersion, '6.0.3')
await writeFile(join(fixture, 'package.json'), JSON.stringify({ name: 'controlled-nz-discovery-proof', version: '1.0.0', type: 'module', types: 'index.d.ts', files: ['index.d.ts'], devDependencies: { typescript: compilerVersion } }), { flag: 'wx' })
await writeFile(join(fixture, 'tsconfig.json'), JSON.stringify({ compilerOptions: { strict: true, noEmit: true, module: 'NodeNext', target: 'ESNext', types: [], rootDir: 'source' }, include: ['source'] }), { flag: 'wx' })
await writeFile(join(fixture, 'source/index.ts'), 'export {};\n', { flag: 'wx' })
const declaration = 'export interface Counts { readonly count: number }\n'
await writeFile(join(fixture, 'index.d.ts'), declaration, { flag: 'wx' })
await writeFile(join(fixture, 'test-d/index.test-d.ts'), 'import type {Counts} from "../index.js";\ndeclare const queue: Counts;\nconst count: number = queue.count;\n// @ts-expect-error: count must stay readonly\nqueue.count = 1;\n', { flag: 'wx' })
const invoke = args => {
  const result = spawnSync(process.execPath, [join(root, 'package/source/cli.js'), ...args], { cwd: fixture, encoding: 'utf8' })
  assert.ifError(result.error)
  return { args, exitCode: result.status, output: result.stdout + result.stderr }
}
const discovery = invoke(['--show-config'])
assert.equal(discovery.exitCode, 0, discovery.output)
assert.match(discovery.output, /test-d\/index\.test-d\.ts/u)
assert.match(discovery.output, /--project/u)
const readonly = invoke([])
assert.equal(readonly.exitCode, 0, readonly.output)
await writeFile(join(fixture, 'index.d.ts'), declaration.replace('readonly ', ''))
const writable = invoke([])
assert.notEqual(writable.exitCode, 0)
assert.match(writable.output, /TS2578|Unused '@ts-expect-error'/u)
await writeFile(join(fixture, 'index.d.ts'), declaration)
const report = {
  scope: 'Supplemental frozen tool source and controlled experiment; original specification and proposed Gold unchanged, no candidate outputs supplied.',
  observedAt: new Date().toISOString(), repositoryIdentity: item.repositoryIdentity, repositoryBaseCommit: item.repositoryBaseCommit, caseIds: [item.caseId],
  package: { name: 'nz', version: '0.1.0', declaredRange: '^0.1.0', registryTarball: 'https://registry.npmjs.org/nz/-/nz-0.1.0.tgz' },
  archivePath, archiveSha256: hash(await readFile(archivePath)), files,
  previousIndependentReview: { reviewId: previous.reviewId, status: previous.status, proposedGoldSha256: previous.proposedGoldSha256, verdict: previous.verdict },
  clarificationForIndependentAssessment: 'The unchanged PRD requires the type-negative test to be included through tsconfig/tsd. The supplied nz implementation derives a temporary tsconfig extending the repository configuration and explicitly includes discovered test-d files in files. Assess whether this establishes the existing config-backed route without changing the original PRD, expectations, owner scope, dependencies, or approval criteria. Source and fixture evidence are not proof that the upstream feature is implemented or its tests have run.',
  controlledExperiment: { fixture, compilerVersion, observations: { discovery, readonly, writable }, benchmarkRepositoryWrites: 0, modelRequests: 0, domainMutations: 0, releaseCandidate: false },
}
await writeFile(destination, JSON.stringify(report, null, 2), { flag: 'wx' })
console.log(JSON.stringify({ destination, caseId: item.caseId, toolVersion: report.package.version, compilerVersion, readonlyExitCode: readonly.exitCode, writableExitCode: writable.exitCode, benchmarkRepositoryWrites: 0, domainMutations: 0 }))
