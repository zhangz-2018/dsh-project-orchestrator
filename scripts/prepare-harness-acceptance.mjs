import { mkdtemp, mkdir, readFile, readdir, writeFile, chmod } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { createRequire } from 'node:module'

const [sourceHomeArgument, tarballArgument] = process.argv.slice(2)
if (!sourceHomeArgument || !tarballArgument) throw new Error('Usage: node scripts/prepare-harness-acceptance.mjs <source-dsh-home> <packed-plugin.tgz>')
const sourceHome = resolve(sourceHomeArgument)
const tarball = resolve(tarballArgument)
await readFile(tarball)
const require = createRequire(join(sourceHome, 'profiles/node_modules/js-yaml/package.json'))
const yaml = require('js-yaml')
const settings = yaml.load(await readFile(join(sourceHome, 'settings.yaml'), 'utf8'))
const selection = settings['agent-default-model']
if (!selection?.provider || !selection?.model) throw new Error('A configured model selection is required.')
const provider = settings['llm-pi-ai']?.providers?.[selection.provider]
if (!provider) throw new Error('The selected provider must have an explicit llm-pi-ai configuration.')
const credentials = yaml.load(await readFile(join(sourceHome, '.credentials.yaml'), 'utf8'))
const reference = provider.apiKeyEnv
if (!reference || typeof credentials?.refs?.[reference] !== 'string') throw new Error('The selected provider must have a stored credential reference.')

const root = await mkdtemp(join(tmpdir(), 'po-certified-acceptance-'))
await chmod(root, 0o700)
const home = join(root, 'home')
const profile = join(home, 'profiles/web')
await mkdir(profile, { recursive: true, mode: 0o700 })
const harnessVersion = '0.1.0-rc.6'
const harnessNames = (await readdir(join(sourceHome, 'profiles/node_modules/@deepseek-ai')))
  .filter((name) => name === 'dsh' || name.startsWith('dsh-'))
const overrides = Object.fromEntries([...new Set(['dsh', 'dsh-base', 'dsh-web-app', ...harnessNames])]
  .map((name) => [`@deepseek-ai/${name}`, harnessVersion]))
overrides['@deepseek-ai/cordis'] = '4.0.1'
Object.assign(overrides, {
  '@deepseek-ai/cordis-plugin-hmr': '1.0.16',
  '@deepseek-ai/cordis-plugin-loader': '1.0.2',
  '@deepseek-ai/cordis-plugin-group': '1.0.1',
  '@deepseek-ai/cordis-plugin-include': '1.0.6',
  '@deepseek-ai/cordis-plugin-timer': '1.1.3',
})
const manifest = {
  name: 'project-orchestrator-certified-acceptance', private: true, type: 'module',
  dsh: { profile: { bundles: ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app'] } },
  dependencies: {
    '@deepseek-ai/dsh': harnessVersion,
    '@deepseek-ai/dsh-base': harnessVersion,
    '@deepseek-ai/dsh-web-app': harnessVersion,
    'dsh-project-orchestrator': `file:${tarball}`,
  },
  pnpm: { overrides, onlyBuiltDependencies: ['esbuild', 'sharp', 'node-pty', 'koffi'] },
}
await writeFile(join(profile, 'package.json'), `${JSON.stringify(manifest, null, 2)}\n`, { flag: 'wx' })
await writeFile(join(profile, '.npmrc'), 'auto-install-peers=true\n', { flag: 'wx' })
await writeFile(join(profile, 'cordis.yml'), '[]\n', { flag: 'wx' })
await writeFile(join(profile, 'cordis.patch.yml'), yaml.dump([{ insert: [{ id: 'project-orchestrator', name: 'dsh-project-orchestrator' }] }]), { flag: 'wx' })
await writeFile(join(home, 'settings.yaml'), yaml.dump({
  'llm-pi-ai': { providers: { [selection.provider]: provider } },
  'agent-default-model': selection,
}), { flag: 'wx', mode: 0o600 })
// Harness rc.6 reads a flat reference map; the source Profile uses a versioned envelope.
await writeFile(join(home, '.credentials.yaml'), yaml.dump({ [reference]: credentials.refs[reference] }), { flag: 'wx', mode: 0o600 })
const report = { root, home, profile, harnessVersion, modelProvider: selection.provider, modelId: selection.model, createdAt: new Date().toISOString(), credentialCopied: true }
const reportPath = resolve('output/acceptance/isolated-harness-2026-10-14.json')
await mkdir(resolve('output/acceptance'), { recursive: true })
await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, { flag: 'wx' })
console.log(JSON.stringify({ ...report, reportPath }))
