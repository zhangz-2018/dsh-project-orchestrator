import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'

const reportPath = resolve('output/acceptance/release-projects-2026-10-16.json')
const report = JSON.parse(await readFile(reportPath, 'utf8'))
const common = ['api.contract', 'reliability.failure-handling', 'testing.automation']
const reasons = {
  'sindresorhus/p-limit': '包装函数和声明、队列状态计数、清队列拒绝值与在途 Promise。',
  'sindresorhus/p-retry': 'Error/cause 声明、重试计时和取消、同步 hook 与异常优先级。',
  'sindresorhus/p-queue': 'TypeScript 公共 getter/选项、等待队列状态、并发/限速下的拒绝和清理。',
  'sindresorhus/p-map': 'JS 引擎与声明、异步迭代及 mapper、overflow/abort/stop 与错误观察。',
  'sindresorhus/ky': 'TypeScript 错误/选项契约、异步 HTTP 错误与 hooks、fetch 选项边界和消费者。',
  'honojs/hono': 'TypeScript CORS、异步 exposeHeaders、HTTP 响应消费者与 Origin 安全边界。',
  'colinhacks/zod': 'TypeScript schema 参数和出口、局部转换与构造错误；无数据库/持久化要求。',
  'developit/mitt': 'TypeScript 事件键与载荷、订阅共享状态、同步重入和异常传播；无异步平台要求。',
}
const lines = ['# 隔离发布评测：成员能力确认清单', '', '日期：2026-10-16。范围仅为下列 16 个 ready 规划样本的已创建草稿项目；不派发任务、不修改上游、不部署或发布。8 个 pending 样本不配置执行成员。', '',
  '此前 greeting 的 9 项确认不适用于本批次。本文件仅请求对具体成员在具体项目承担所列能力进行确认，不声称模型已证明成员资质。人工确认接口会写入 human_confirmed，因此必须取得本清单的明确确认；当前全部记录仍为 pending / legacy_pending_mapping。', '',
  '## 专用成员', '', ...report.agents.map((a) => `- ${a.name}：\`${a.id}\`；${a.deliveryRole}，容量 1，使用本机默认运行环境。`), '',
  '实现与独立验证为不同成员。两者均需下面列出的项目能力，verifier 另外需要 testing.verification。声明的作用域只限各项目，未列出的能力保持未确认。', '',
  '## 能力与范围依据', '',
  `各项目基础能力：${common.map((x) => `\`${x}\``).join('、')}。分别对应公共函数/类型契约、拒绝与异常兼容、自动回归。`, '',
  '| 仓库 | 基础能力以外的项目能力 | 责任证据 |', '| --- | --- | --- |']
for (const identity of [...new Set(report.projects.map((p) => p.repositoryIdentity))]) {
  const p = report.projects.find((p) => p.repositoryIdentity === identity && p.expectedReadiness === 'ready')
  lines.push(`| ${identity} | ${p.requiredCapabilities.filter((x) => !common.includes(x)).map((x) => `\`${x}\``).join('、')} | ${reasons[identity]} |`)
}
lines.push('', '能力按每库 A/C 两个样本的责任共同准备：例如 p-limit 的异步能力针对 clearQueue/在途任务，不表示计数 getter 本身新增异步工作；具体任务仍由 Service 根据实际代码写入范围推导。integration.consumer 仅用于 Ky/Hono 的 HTTP 边界，不授予其他库；security.authorization 仅限 CORS 的 Origin 边界。没有数据库迁移、持久化 data.change、发布、浏览器、React/Vue 或运维能力声明。', '',
  '## 精确项目与待确认记录', '', '| caseId | projectId | 待确认项数（两名成员合计） |', '| --- | --- | --- |')
for (const p of report.projects.filter((p) => p.expectedReadiness === 'ready')) {
  const response = await fetch(`${report.baseUrl}/project-orchestrator/api/projects/${p.projectId}/capability-claims`)
  assert.ok(response.ok)
  const live = await response.json()
  for (const c of p.pendingClaims) assert.ok(live.some((x) => x.id === c.id && x.claimDigest === c.claimDigest && x.status === 'pending' && x.source === 'legacy_pending_mapping'))
  lines.push(`| ${p.caseId} | \`${p.projectId}\` | ${p.pendingClaims.length} |`)
}
const digest = createHash('sha256').update(await readFile(reportPath)).digest('hex')
lines.push('', `合计 ${report.projects.reduce((n, p) => n + p.pendingClaims.length, 0)} 条项目限定声明。精确 claimId、capabilityId、成员及 expectedClaimDigest 见 [机器清单](../output/acceptance/release-projects-2026-10-16.json)，SHA256：\`${digest}\`。不得登记机器清单以外的成员或能力，不将原来的 9 项确认复制到这些项目。`, '',
  '## 验收与拒绝边界', '',
  '确认后仍不能凭此宣称正式验收通过。Gold 需冻结确认后的团队摘要，再取得独立审阅；每项至少 5 次 fresh 真实规划、全部失败尝试入 manifest，完整 release gate 退出 0 才通过。若模型要求清单之外的真实能力，保留拒绝原因，不代填、扩大资格或回写已冻结 Gold。', '',
  '用户于 2026-10-16 已允许本批次不限 token。预算和模型授权继续有效；此处只涉及新的人工能力事实。', '')
const path = resolve('docs/release-capability-review-2026-10-16.zh-CN.md')
await writeFile(path, lines.join('\n'), { flag: 'wx' })
console.log(JSON.stringify({ path, claims: report.projects.reduce((n, p) => n + p.pendingClaims.length, 0), reportSha256: digest, trustedClaimsCreated: 0 }))
