import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { readFile, mkdir, mkdtemp, readdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { promisify } from 'node:util'
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs'
import { OrchestratorService } from '../lib/index.js'

const repositoryRoot = resolve(dirname(new URL(import.meta.url).pathname), '..')
const pdfPath = join(repositoryRoot, 'output/pdf/agent-squad-real-input-acceptance.pdf')
const evidencePath = join(repositoryRoot, 'output/acceptance/real-pdf-input.json')
const run = promisify(execFile)

function context(response, observation) {
  return {
    skills: { list: async () => [] },
    agentDefaultModel: { currentSelection: () => ({ provider: 'acceptance', model: 'vision-fixture' }) },
    agentPresets: { mount: async () => {} },
    llm: { resolveModelInfo: async () => ({ provider: 'acceptance', id: 'vision-fixture', name: 'Vision fixture', inputModalities: ['text', 'image'] }) },
    attachments: {
      imageLimits: { maxImageBytes: 5_000_000, maxImagesPerMessage: 20, maxMessageImageBytes: 20_000_000, maxImagePixels: 4_000_000, mediaTypes: ['image/jpeg'] },
      validateImage: async (image) => {
        assert.equal(image.data[0], 0xff)
        assert.equal(image.data[1], 0xd8)
        observation.validatedBytes.push(image.data.byteLength)
      },
      saveImage: async (image) => {
        observation.savedImages += 1
        return { attachmentId: `real-pdf-page-${observation.savedImages}`, mediaType: image.mediaType, bytes: image.data.byteLength, width: 842, height: 1191, name: image.name }
      },
    },
    sessions: { flush: async () => {} },
    agents: {
      create: async (options) => {
        await options.setup({ systemPrompt: { section: () => () => {} }, tools: { guard: () => () => {} } })
        const session = { events: [{ type: 'assistant/message', data: { message: { content: [{ type: 'text', text: response }] } } }] }
        return { agent: { session, followup: (message) => { observation.message = message }, whenIdle: async () => {}, cancel: () => {} }, dispose: async () => {} }
      },
    },
  }
}

const bytes = new Uint8Array(await readFile(pdfPath))
const standardFontDataUrl = `${join(repositoryRoot, 'node_modules/pdfjs-dist/standard_fonts')}/`
const loadingTask = getDocument({ data: bytes, enableScripting: false, disableWorker: true, standardFontDataUrl })
const document = await loadingTask.promise
const extractedPages = []
for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
  const page = await document.getPage(pageNumber)
  const textContent = await page.getTextContent()
  extractedPages.push(`## PDF page ${pageNumber}\n${textContent.items.map((item) => 'str' in item ? item.str : '').filter(Boolean).join(' ')}`)
  page.cleanup()
}
await loadingTask.destroy()

const renderDirectory = await mkdtemp(join(tmpdir(), 'dsh-real-pdf-'))
const renderPrefix = join(renderDirectory, 'page')
const pdftoppm = process.env.CODEX_PDFTOPPM ?? 'pdftoppm'
await run(pdftoppm, ['-jpeg', '-r', '120', pdfPath, renderPrefix])
const renderedFiles = (await readdir(renderDirectory)).filter((name) => name.endsWith('.jpg')).sort((left, right) => left.localeCompare(right, undefined, { numeric: true }))
const images = await Promise.all(renderedFiles.map(async (name, index) => ({ page: index + 1, mediaType: 'image/jpeg', dataBase64: (await readFile(join(renderDirectory, name))).toString('base64') })))

const extractedText = extractedPages.join('\n\n')
assert.match(extractedText, /30 seconds/)
assert.match(extractedText, /45 seconds/)
assert.match(extractedText, /ONE IDEMPOTENT LEADER CONTINUATION/)
const observation = { validatedBytes: [], savedImages: 0 }
const service = new OrchestratorService(context('# Imported requirement\n\nApproved dependency timeout: 45 seconds.\n\nThe 30 second value is superseded by Decision D-01.', observation), {})
const result = await service.importRequirementDocument({ fileName: 'agent-squad-real-input-acceptance.pdf', documentKind: 'prd', pageCount: document.numPages, textPageCount: extractedPages.length, visualPageCount: images.length, extractedText, images })

assert.deepEqual(result.analyzedImagePages, [1, 2, 3])
assert.deepEqual(observation.message.content.filter((block) => block.type === 'image').map((block) => block.attachment.attachmentId), ['real-pdf-page-1', 'real-pdf-page-2', 'real-pdf-page-3'])
assert.match(observation.message.content[0].text, /30 seconds/)
assert.match(observation.message.content[0].text, /45 seconds/)
assert.match(result.markdown, /45 seconds/)

await mkdir(dirname(evidencePath), { recursive: true })
await writeFile(evidencePath, `${JSON.stringify({ status: 'passed', pdfPath, pageCount: document.numPages, textExtractionEngine: 'pdfjs-dist/legacy', pageImageEngine: 'poppler/pdftoppm', extractedTextCharacters: extractedText.length, extractedConflict: { superseded: '30 seconds', approved: '45 seconds', decisionId: 'D-01' }, renderedImagePages: images.map((image) => image.page), jpegBytes: observation.validatedBytes, analyzedImagePages: result.analyzedImagePages, importedMarkdown: result.markdown }, null, 2)}\n`)
console.log(evidencePath)
