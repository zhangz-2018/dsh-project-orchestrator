import assert from 'node:assert/strict'
import { readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import ts from 'typescript'

// Compile an in-memory consumer of the actual frozen checkout. No emit,
// repository writes, module execution, or replacement release candidate.
const destination = process.argv[2]
assert.ok(destination)
const root = resolve('output/acceptance/repositories/zod')
const path = `${root}/packages/zod/src/core-output-oracle.virtual.ts`
const source = `import * as core from './v4/core/index.js';
const schema = core._stringbool({}, {});
type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends (<T>() => T extends B ? 1 : 2) ? true : false;
type Assert<T extends true> = T;
type CoreOutput = core.output<typeof schema>;
type CoreInput = core.input<typeof schema>;
type OutputIsBoolean = Assert<Equal<CoreOutput, boolean>>;
type InputIsUnknown = Assert<Equal<CoreInput, unknown>>;
// @ts-expect-error The output is boolean, not the default input type unknown.
type OutputIsUnknown = Assert<Equal<CoreOutput, unknown>>;
`
const options = { noEmit: true, strict: true, skipLibCheck: true, target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.NodeNext, moduleResolution: ts.ModuleResolutionKind.NodeNext }
const host = ts.createCompilerHost(options)
const getSourceFile = host.getSourceFile.bind(host)
host.getSourceFile = (name, languageVersion, onError, shouldCreateNewSourceFile) => name === path
  ? ts.createSourceFile(name, source, languageVersion, true)
  : getSourceFile(name, languageVersion, onError, shouldCreateNewSourceFile)
const fileExists = host.fileExists.bind(host)
host.fileExists = name => name === path || fileExists(name)
host.writeFile = () => { throw new Error('No emit allowed') }
const program = ts.createProgram([path], options, host)
const diagnostics = ts.getPreEmitDiagnostics(program).map(d => ({ code: d.code, file: d.file?.fileName, message: ts.flattenDiagnosticMessageText(d.messageText, '\n') }))
const checker = program.getTypeChecker()
const types = Object.fromEntries(program.getSourceFile(path).statements.filter(n => ts.isTypeAliasDeclaration(n) && ['CoreOutput', 'CoreInput'].includes(n.name.text))
  .map(n => [n.name.text, checker.typeToString(checker.getTypeAtLocation(n))]))
const result = { scope: 'readonly_frozen_direct_core_type_oracle', observedAt: new Date().toISOString(), compilerVersion: ts.version, source,
  types, diagnosticCount: diagnostics.length, diagnostics, repositoryWrites: 0, executedRuntimeCalls: 0, releaseCandidate: false }
await writeFile(destination, JSON.stringify(result, null, 2), { flag: 'wx' })
console.log(JSON.stringify(result))
assert.deepEqual(diagnostics, [])
assert.deepEqual(types, { CoreOutput: 'boolean', CoreInput: 'unknown' })
