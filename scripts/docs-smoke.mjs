import { access, readFile, readdir } from 'node:fs/promises'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const chineseDocs = [
  'docs/api.zh-CN.md',
  'docs/architecture.zh-CN.md',
  'docs/compatibility.zh-CN.md',
  'docs/operations.zh-CN.md',
  'docs/migration.zh-CN.md',
  'docs/releasing.zh-CN.md',
  'CONTRIBUTING.zh-CN.md',
  'SECURITY.zh-CN.md',
  'SUPPORT.zh-CN.md',
  'GOVERNANCE.zh-CN.md',
  'CODE_OF_CONDUCT.zh-CN.md',
  'CHANGELOG.zh-CN.md',
]

for (const path of chineseDocs) {
  const source = await readFile(join(root, path), 'utf8')
  if (!/^# .+\n\n\[English\]\([^)]+\.md\) \| 简体中文/m.test(source)) {
    throw new Error(`${path} is missing its English / Simplified Chinese language switch.`)
  }
}

const chineseReadme = await readFile(join(root, 'README.zh-CN.md'), 'utf8')
for (const path of chineseDocs) {
  if (!chineseReadme.includes(`](${path})`)) throw new Error(`README.zh-CN.md does not link to ${path}.`)
}
if (/\]\((?:docs\/(?:api|architecture|compatibility|operations|migration|releasing)|CONTRIBUTING|SECURITY|SUPPORT|GOVERNANCE|CODE_OF_CONDUCT|CHANGELOG)\.md\)/.test(chineseReadme)) {
  throw new Error('README.zh-CN.md still links to an English documentation page.')
}

const markdownFiles = [
  ...(await readdir(root, { withFileTypes: true })).filter((entry) => entry.isFile() && entry.name.endsWith('.md')).map((entry) => entry.name),
  ...(await readdir(join(root, 'docs'), { withFileTypes: true })).filter((entry) => entry.isFile() && entry.name.endsWith('.md')).map((entry) => join('docs', entry.name)),
]
for (const sourcePath of markdownFiles) {
  const source = await readFile(join(root, sourcePath), 'utf8')
  for (const match of source.matchAll(/\[[^\]]*\]\(([^)]+)\)/g)) {
    const raw = match[1].trim().replace(/^<|>$/g, '').split(/\s+["']/)[0]
    if (raw === '' || raw.startsWith('#') || /^(?:https?:|mailto:)/.test(raw)) continue
    const target = decodeURIComponent(raw.split('#')[0])
    const resolved = resolve(dirname(join(root, sourcePath)), target)
    if (!resolved.startsWith(`${root}/`) && resolved !== root) throw new Error(`${sourcePath} links outside the package: ${raw}`)
    try { await access(resolved) } catch { throw new Error(`${sourcePath} has a broken local link: ${raw}`) }
  }
}

process.stdout.write(`Documentation smoke passed: ${chineseDocs.length} Chinese pages and ${markdownFiles.length} Markdown files.\n`)
