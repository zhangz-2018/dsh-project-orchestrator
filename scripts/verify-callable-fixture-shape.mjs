import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { build } from 'esbuild'
import ts from 'typescript'

// Reproduce the retained Scenario's existing callable contract. No upstream
// edits, proposed CORS implementation, model calls or domain writes.
const destination = process.argv[2]
assert.ok(destination)
const repository = resolve('output/acceptance/repositories/hono')
const git = args => execFileSync('git', args, { cwd: repository, encoding: 'utf8' })
const commit = git(['rev-parse', 'HEAD']).trim()
assert.equal(commit, '588ec13fa68ea44fed1b5e1b503341db2bf09d70')
const beforeStatus = git(['status', '--porcelain'])
const sourcePath = resolve(repository, 'src/compose.ts')
const source = await readFile(sourcePath, 'utf8')
const hash = value => createHash('sha256').update(value).digest('hex')
const sourceDigest = hash(source)
const bundled = await build({ entryPoints: [sourcePath], bundle: true, write: false, format: 'esm', platform: 'node', logLevel: 'silent' })
const { compose } = await import(`data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].contents).toString('base64')}`)
const observations = []
for (const shape of ['original', 'nested']) {
  for (const method of ['GET', 'OPTIONS']) {
    const sentinel = new Error('expose-failed')
    const errors = []
    let middlewareCalls = 0, downstreamCalls = 0
    const context = { req: { routeIndex: 0 }, finalized: false }
    const middleware = async () => { middlewareCalls++; throw sentinel }
    const downstream = async () => { downstreamCalls++; return new Response('unexpected') }
    const entries = shape === 'original' ? [[middleware], [downstream]] : [[[middleware]], [[downstream]]]
    const result = await compose(entries, (error, ctx) => { errors.push({ error, ctx }); return new Response('handled-expose-error', { status: 500 }) })(context)
    assert.equal(result, context)
    assert.equal(downstreamCalls, 0)
    if (shape === 'original') {
      assert.equal(middlewareCalls, 0)
      assert.deepEqual(errors, [])
      assert.equal(context.error, undefined)
      assert.equal(context.res, undefined)
    } else {
      assert.equal(middlewareCalls, 1)
      assert.deepEqual(errors, [{ error: sentinel, ctx: context }])
      assert.equal(context.error, sentinel)
      assert.equal(context.res.status, 500)
      assert.equal(await context.res.text(), 'handled-expose-error')
    }
    observations.push({ shape, method, middlewareCalls, downstreamCalls, errorHandlerCalls: errors.length, originalOracleReachable: shape === 'nested' })
  }
}

// Type-check both concrete argument shapes against the real frozen compose
// declaration, with an in-memory file only. Filter solely the two call sites;
// unrelated transitive project diagnostics cannot stand in for this oracle.
const fixturePath = resolve(repository, 'src/__acceptance_callable_shape__.ts')
const fixture = `import { compose } from './compose'
const middleware = async () => {}
const downstream = async () => {}
compose([[middleware], [downstream]])
compose([[[middleware]], [[downstream]]])
`
const options = { noEmit: true, strict: true, skipLibCheck: true, target: ts.ScriptTarget.ESNext, module: ts.ModuleKind.ESNext, moduleResolution: ts.ModuleResolutionKind.Bundler, types: [] }
const host = ts.createCompilerHost(options)
const originalGetSourceFile = host.getSourceFile.bind(host)
host.getSourceFile = (path, languageVersion, onError, shouldCreateNewSourceFile) => path === fixturePath
  ? ts.createSourceFile(path, fixture, languageVersion, true)
  : originalGetSourceFile(path, languageVersion, onError, shouldCreateNewSourceFile)
const program = ts.createProgram([fixturePath], options, host)
const diagnostics = ts.getPreEmitDiagnostics(program).filter(d => d.file?.fileName === fixturePath).map(d => ({
  line: d.file.getLineAndCharacterOfPosition(d.start).line + 1, code: d.code, message: ts.flattenDiagnosticMessageText(d.messageText, '\n'),
}))
assert.ok(diagnostics.length && diagnostics.every(d => d.line === 4 && d.code === 2322), JSON.stringify(diagnostics))
assert.equal(git(['status', '--porcelain']), beforeStatus)
assert.equal(hash(await readFile(sourcePath)), sourceDigest)
const report = { status: 'frozen_callable_shape_verified', observedAt: new Date().toISOString(), repository, commit, sourceDigest, observations, diagnostics,
  correctCallTypeChecked: true, originalCallRejectedByTypeChecker: true, sourceUnchanged: true, modelRequests: 0, domainMutations: 0, releasePass: false }
await writeFile(destination, JSON.stringify(report, null, 2), { flag: 'wx' })
console.log(JSON.stringify(report))
