import { test, expect } from '@playwright/test'
import { createServer } from 'node:http'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

test('browser fixture correlates persisted operation facts through API and responsive DOM', async ({ page, request }) => {
  const root = await mkdtemp(join(tmpdir(), 'planning-browser-fixture-'))
  const storePath = join(root, 'operations.json')
  await writeFile(storePath, '[]')
  const server = createServer(async (req, res) => {
    if (req.url === '/api/operations' && req.method === 'POST') {
      const chunks = []
      for await (const chunk of req) chunks.push(chunk)
      const record = JSON.parse(Buffer.concat(chunks).toString('utf8'))
      const records = JSON.parse(await readFile(storePath, 'utf8'))
      records.push(record)
      await writeFile(storePath, JSON.stringify(records))
      res.writeHead(201, { 'content-type': 'application/json' }).end(JSON.stringify(record))
      return
    }
    if (req.url === '/api/operations') {
      res.writeHead(200, { 'content-type': 'application/json' }).end(await readFile(storePath, 'utf8'))
      return
    }
    res.writeHead(200, { 'content-type': 'text/html' }).end(`<!doctype html><meta name="viewport" content="width=device-width"><style>body{font:16px sans-serif}.operations{display:grid;grid-template-columns:1fr 1fr;gap:8px}.operation{border:1px solid #888;padding:8px}@media(max-width:500px){.operations{grid-template-columns:1fr}}</style><main><h1>Planning operations</h1><section class="operations" aria-label="Planning operations"></section></main><script>fetch('/api/operations').then(r=>r.json()).then(rows=>{document.querySelector('.operations').innerHTML=rows.map(row=>'<article class="operation" data-operation-id="'+row.id+'"><strong>'+row.id+'</strong><span>'+row.stage+'</span></article>').join('')})</script>`)
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  const baseURL = `http://127.0.0.1:${address.port}`
  try {
    const operation = { id: 'operation-browser-001', stage: 'assignment' }
    const response = await request.post(`${baseURL}/api/operations`, { data: operation })
    expect(response.status()).toBe(201)
    await page.goto(baseURL)
    const row = page.locator(`[data-operation-id="${operation.id}"]`)
    await expect(row).toContainText(operation.id)
    await expect(row).toContainText(operation.stage)
    expect(await page.locator('.operations').evaluate((element) => getComputedStyle(element).gridTemplateColumns.split(' ').length)).toBe(2)
    await page.reload()
    await expect(row).toContainText(operation.id)
    await page.setViewportSize({ width: 390, height: 844 })
    expect(await page.locator('.operations').evaluate((element) => getComputedStyle(element).gridTemplateColumns.split(' ').length)).toBe(1)
  } finally {
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()))
    await rm(root, { recursive: true, force: true })
  }
})
