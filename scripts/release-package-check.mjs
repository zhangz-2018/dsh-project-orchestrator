import { readFile } from 'node:fs/promises'

const rawPath = process.argv[2] ?? 'package-pack.raw.json'
const raw = await readFile(rawPath, 'utf8')
const start = raw.indexOf('{')
if (start < 0) throw new Error('pnpm pack did not emit JSON metadata.')
const pack = JSON.parse(raw.slice(start))
const files = new Set(pack.files.map((entry) => entry.path))
for (const required of ['lib/index.js', 'lib/client.js', 'lib/pdf.worker.mjs', 'README.md', 'SECURITY.md', 'CHANGELOG.md']) {
  if (!files.has(required)) throw new Error(`Missing package file: ${required}`)
}
console.log(`Release package content check passed: ${files.size} files.`)
