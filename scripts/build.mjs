import { execFileSync } from 'node:child_process'
import { mkdir, readFile } from 'node:fs/promises'
import { build } from 'esbuild'

const packageJson = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'))
const packageId = packageJson.name
const externals = [...Object.keys(packageJson.dependencies ?? {}), ...Object.keys(packageJson.peerDependencies ?? {})]

await mkdir(new URL('../lib/', import.meta.url), { recursive: true })

await build({
  entryPoints: [new URL('../src/index.ts', import.meta.url).pathname],
  outfile: new URL('../lib/index.js', import.meta.url).pathname,
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  sourcemap: true,
  external: externals,
  logLevel: 'info',
})

await build({
  entryPoints: [new URL('../src/cli.ts', import.meta.url).pathname],
  outfile: new URL('../lib/cli.js', import.meta.url).pathname,
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  logLevel: 'info',
})

await build({
  entryPoints: [new URL('../src/client.tsx', import.meta.url).pathname],
  outfile: new URL('../lib/client.js', import.meta.url).pathname,
  bundle: true,
  platform: 'browser',
  format: 'cjs',
  target: ['chrome120'],
  sourcemap: true,
  external: externals,
  banner: {
    js: `window.__ModuleLoader__.load({ id: ${JSON.stringify(packageId)}, factory: (require) => { var module = { exports: {} }; var exports = module.exports;`,
  },
  footer: { js: 'return module.exports; } });' },
  logLevel: 'info',
})

execFileSync(process.execPath, [
  new URL('../node_modules/typescript/lib/tsc.js', import.meta.url).pathname,
  '--project',
  new URL('../tsconfig.json', import.meta.url).pathname,
  '--emitDeclarationOnly',
  '--declaration',
  '--declarationMap',
  '--outDir',
  new URL('../lib/types', import.meta.url).pathname,
], { stdio: 'inherit' })
