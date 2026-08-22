import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import vm from 'node:vm'

test('client bundle registers with the Harness module loader', async () => {
  const source = await readFile(new URL('../lib/client.js', import.meta.url), 'utf8')
  const manifest = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'))
  let registration
  const context = {
    window: {
      __ModuleLoader__: {
        load(value) { registration = value },
      },
    },
    console,
  }
  vm.runInNewContext(source, context, { filename: 'client.js' })
  assert.equal(registration.id, 'dsh-project-orchestrator')
  const dependency = new Proxy({}, { get: () => () => null })
  const exported = registration.factory(() => dependency)
  assert.equal(typeof exported.apply, 'function')
  assert.deepEqual(Array.from(exported.inject), ['slots', 'workspaces'])
  assert.ok(manifest.dsh.client.inject.includes('@deepseek-ai/dsh-client-runtime'))
  assert.ok(!manifest.dsh.client.inject.includes('workspaces'))
})

test('client styles follow Harness theme tokens', async () => {
  const source = await readFile(new URL('../src/styles.ts', import.meta.url), 'utf8')
  assert.match(source, /body\[data-ds-dark-theme\] \.po-workbench/)
  for (const token of [
    '--dsw-alias-bg-base',
    '--dsw-alias-label-primary',
    '--dsw-alias-border-l2',
    '--dsw-alias-button-primary-fill',
    '--dsw-alias-state-business-primary',
    '--dsw-alias-state-success-primary',
    '--dsw-alias-state-warn-primary',
    '--dsw-alias-state-error-primary',
  ]) assert.match(source, new RegExp(token))
  assert.doesNotMatch(source, /--dsw-alias-border-focus/)
  assert.doesNotMatch(source, /(?:^|[;{]\s*)(?:color|background(?:-color)?|border-color|accent-color):\s*#[0-9a-f]{3,8}/im)
  assert.doesNotMatch(source, /border(?:-(?:top|right|bottom|left))?:\s*[^;{}]*\bsolid\s+#[0-9a-f]{3,8}/im)
})

test('client exposes explicit empty and AI creation actions', async () => {
  const source = await readFile(new URL('../src/client.tsx', import.meta.url), 'utf8')
  const bundle = await readFile(new URL('../lib/client.js', import.meta.url), 'utf8')
  assert.match(source, /空项目/)
  assert.match(source, /AI 智能拆解/)
  assert.match(source, /创建空项目/)
  assert.match(source, /创建并让 AI 拆解/)
  assert.match(source, /本地代码仓库/)
  assert.match(source, /GitHub 仓库/)
  assert.match(source, /选择目录/)
  assert.match(source, /拉取分支/)
  assert.match(source, /从 Issues 自动创建事项/)
  assert.match(source, /打开目录/)
  assert.match(source, /po-directory-fact/)
  assert.match(source, /po-directory-actions/)
  assert.match(source, /ProjectPlanningDiagnostic/)
  assert.match(source, /重新运行规划/)
  assert.match(source, /技术详情/)
  assert.doesNotMatch(source, /Next action/)
  assert.match(source, /PROJECT_INTAKE_DRAFT_TTL_MS/)
  assert.match(source, /AbortController/)
  assert.match(source, /repositoryRequestVersion/)
  assert.match(source, /listDirectory/)
  assert.match(source, /ensureWorkspace/)
  assert.match(source, /选择当前目录/)
  assert.match(source, /projects\/\$\{result\.id\}\/workspace/)
  assert.doesNotMatch(source, /localStorage\.setItem\(PROJECT_INTAKE_STORAGE_KEY, JSON\.stringify\(value\)\)/)
  assert.match(bundle, /repositories\/inspect/)
  assert.match(bundle, /open-directory/)
  assert.match(source, /pdfjs-dist\/legacy\/build\/pdf\.mjs/)
  assert.match(source, /requirements\/import/)
  assert.match(source, /application\/pdf/)
  assert.match(source, /PDF 会在浏览器中转换为文字和页面图像/)
  assert.match(bundle, /pdf-worker\.mjs/)
})

test('client bundle exposes project membership and local usage workflows', async () => {
  const source = await readFile(new URL('../src/client.tsx', import.meta.url), 'utf8')
  const bundle = await readFile(new URL('../lib/client.js', import.meta.url), 'utf8')
  for (const contract of [
    '交付看板',
    '团队编排',
    '运行环境',
    '项目智能体',
    '运行与证据',
    '批量分配未分配任务',
    '加入智能体并指派',
    '/usage',
    '/task-assignments',
    '/agents/batch',
  ]) assert.match(source, new RegExp(contract.replaceAll('/', '\\/')))
  assert.match(bundle, /projectAgentMemberships/)
  assert.match(bundle, /meaningfulActions/)
})

test('client exposes P0 Squad and Runtime management with context binding flows', async () => {
  const source = await readFile(new URL('../src/client.tsx', import.meta.url), 'utf8')
  const styles = await readFile(new URL('../src/styles.ts', import.meta.url), 'utf8')
  for (const contract of [
    '/eligible-squads',
    '/runtime-impact',
    '/resources/${resource.id}/runtime',
    '本机默认环境',
    '创建 Squad',
    '克隆 Squad',
    '归档 Runtime',
    '本地数据',
    'acknowledgeApprovalInvalidation',
    '第 ${step}/3 步',
    '清除使用统计',
  ]) assert.match(source, new RegExp(contract.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))
  assert.match(styles, /po-drawer-backdrop/)
  assert.match(styles, /@media \(max-width: 760px\)/)
  assert.match(styles, /prefers-reduced-motion: reduce/)
  assert.equal(source.match(/清除使用统计/g)?.length, 1)
})

test('PDF.js worker and attachment runtime are included in the plugin package contract', async () => {
  const manifest = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'))
  const worker = await readFile(new URL('../lib/pdf.worker.mjs', import.meta.url), 'utf8')
  const serverSource = await readFile(new URL('../src/index.ts', import.meta.url), 'utf8')
  assert.ok(worker.length > 100_000)
  assert.ok(manifest.files.includes('lib/pdf.worker.mjs'))
  assert.equal(manifest.dependencies['pdfjs-dist'].startsWith('^5.'), true)
  assert.equal(manifest.peerDependencies['@deepseek-ai/dsh-attachment'], '0.1.0-rc.6')
  assert.match(serverSource, /'attachments'/)
  assert.match(serverSource, /'llm'/)
})
