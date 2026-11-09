import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { promisify } from 'node:util'

// Read-only review preparation: no model calls, project writes, human
// attestations, or release Gold. The inputs below precede any candidate output.
const run = promisify(execFile)
const sha256 = (value) => createHash('sha256').update(value).digest('hex')
const draftPath = resolve(process.argv[2] ?? 'output/acceptance/release-corpus-draft-v2-2026-10-15.json')
const destination = resolve(process.argv[3] ?? 'output/acceptance/release-input-review-2026-10-15')
const draft = JSON.parse(await readFile(draftPath, 'utf8'))
const priorEvidencePacket = process.argv[4] === undefined ? undefined : JSON.parse(await readFile(resolve(process.argv[4]), 'utf8'))
assert.equal(sha256(await readFile(draft.documentPath)), draft.documentSha256, 'Regenerate the source draft after a document change.')

const jsOwners = ['index.js', 'index.d.ts']
const jsTests = ['test.js', 'index.test-d.ts']
const zodOwners = ['packages/zod/src/v4/core/api.ts', 'packages/zod/src/v4/core/util.ts', 'packages/zod/src/v4/core/index.ts', 'packages/zod/src/v4/classic/schemas.ts', 'packages/zod/src/v4/classic/external.ts', 'packages/zod/src/v4/classic/index.ts', 'packages/zod/src/v4/mini/schemas.ts', 'packages/zod/src/v4/mini/external.ts', 'packages/zod/src/v4/mini/index.ts']
const specifications = [
  {
    id: 'plimit-wrapper-counts', owners: jsOwners, tests: jsTests,
    requirement: 'limitFunction 的返回函数新增只读 activeCount 与 pendingCount，实时读取同一个内部 limiter。',
    acceptance: [
      ['happy_path', '并发 1 时，一个未完成任务加一个等待任务，包装函数的计数分别为 1 和 1。'],
      ['boundary', '所有任务完成后两个计数均为 0；clearQueue 后 pendingCount 为 0，已运行任务仍计入 activeCount。'],
      ['compatibility', '不创建第二个队列，不改变返回 Promise、并发调度和现有 clearQueue；新增计数不可写，类型回归应拒绝赋值。'],
    ],
  },
  {
    id: 'plimit-clear-reason', owners: jsOwners, tests: jsTests,
    requirement: '开启 rejectOnClear 的 limiter 支持 clearQueue(reason?)，自定义拒绝值的策略待 DEC-001 决定。',
    question: '显式传入 reason 时，原样作为拒绝值，还是包装为 AbortError？',
    options: ['原样作为拒绝值', '包装为 AbortError'], recommendation: 0,
    acceptance: [
      ['happy_path', '推荐方案下，显式传入的 Error 对象或字符串原样拒绝各等待任务，Error 身份必须相同。'],
      ['boundary', '推荐方案下，以 arguments 区分显式 undefined 与无参数：前者原样拒绝 undefined，后者保持既有 AbortError。'],
      ['compatibility', '已运行任务不取消；清空后 pendingCount=0；rejectOnClear=false 时保持既有清空与 Promise 契约。'],
    ],
  },
  {
    id: 'pretry-abort-cause', owners: jsOwners, tests: jsTests,
    requirement: 'AbortError 新增标准 cause，指向它已有的 originalError，不改变重试终止契约。',
    acceptance: [
      ['happy_path', '以 Error 构造时，cause 和 originalError 均严格等于传入对象。'],
      ['boundary', '以字符串构造时，cause 严格等于现有包装 Error，message 与 name 保持兼容。'],
      ['compatibility', 'pRetry 遇到 AbortError 仍抛回原始 Error；声明中 cause 可读取，原有 originalError 与调用签名不变。'],
    ],
  },
  {
    id: 'pretry-scheduled-hook', owners: jsOwners, tests: jsTests,
    requirement: '新增可选同步 onRetryScheduled(context: Readonly<{attemptNumber:number; delay:number}>): void。attemptNumber 为刚失败的尝试编号（首次失败为 1），delay 为毫秒调度参数而非实测耗时；忽略返回值，不等待 thenable（异步 hook 不在支持范围）。hook 抛出异常的策略待 DEC-001 决定。',
    question: 'hook 抛错应终止调用并传播，还是忽略后继续重试？',
    options: ['终止调用并原样传播', '忽略并继续'], recommendation: 0,
    acceptance: [
      ['happy_path', '仅 consumeRetry=true 且通过全部终止检查的分支，在 delayForRetry 前发出一次事件，包括最终 delay=0；shouldConsumeRetry=false 的即时重试不发事件。delay 复用现有已随机取样并舍入的退避值，再取 maxTimeout 和剩余时间预算上界，不新增 minTimeout 下界或随机采样。确定性验证 factor=.1/minTimeout=100 的第二次值为 10、minTimeout=0 的零值及剩余预算截断。'],
      ['business_rejection', '次数耗尽、时间预算耗尽、AbortError、非网络 TypeError、shouldRetry=false 或已取消均不发事件。推荐方案下 hook 抛错原样终止；另一方案忽略同步抛错并继续，但仍执行取消检查。'],
      ['compatibility', 'hook 正常返回但内同步 abort 时，必须在开始等待或下一次尝试前以 signal.reason 及时拒绝（包括 delay=0）。同时 abort 并抛错：OPT-1 以 hook 抛出的值优先，OPT-2 忽略该值再以 signal.reason 拒绝。两者均不新建或遗留计时器/abort 监听；用两个不同对象确定性验证优先级。未配置 hook 的类型推断、退避、取消与清理保持兼容。'],
    ],
  },
  {
    id: 'pqueue-outstanding-count', owners: ['source/index.ts'], tests: ['test/basic.ts', 'test/advanced.ts', 'test-d/index.test-d.ts'],
    requirement: 'PQueue 新增只读 outstandingCount，等于读取时的 size + pending，不存储第二份计数。',
    acceptance: [
      ['happy_path', '入队、开始运行及成功/失败完成后，outstandingCount 均等于 size+pending。'],
      ['boundary', '空队列、暂停、限速及 clear 后等式仍成立，clear 不取消已运行任务；completed/error 事件内与当时 size+pending 比较，最终零值在 onIdle 后检查，不提前改变既有微任务计数更新时机。'],
      ['compatibility', '不改变调度、事件顺序及既有 size/pending 语义；类型回归拒绝给 outstandingCount 赋值。'],
    ],
  },
  {
    id: 'pqueue-maxqueued', owners: ['source/index.ts', 'source/options.ts'], tests: ['test/basic.ts', 'test/advanced.ts', 'test-d/index.test-d.ts'],
    requirement: '构造选项 maxQueued 限制等待任务数量，默认不限制；队列已满的处理策略待 DEC-001 决定。',
    question: '等待队列已满时，拒绝值使用原生 RangeError，还是 name 为 QueueCapacityError 的普通 Error？调用方依赖错误类型分支，未选择前不能固定错误契约。',
    options: ['以原生 RangeError 拒绝新提交，保留已有任务', '以 name=QueueCapacityError 的普通 Error 拒绝新提交，保留已有任务'], recommendation: 0,
    acceptance: [
      ['happy_path', '推荐方案下，只拒绝超限新提交的 add Promise，已有等待与运行任务继续；覆盖 addAll 的拒绝传播。'],
      ['boundary', 'maxQueued 为非负安全整数或 Infinity，省略/undefined 为 Infinity，非法值创建时抛 TypeError；0 允许可立即开始的任务，但拒绝暂停、并发已满或限速下需要等待的任务，错误类型取决于 DEC-001。'],
      ['compatibility', '容量拒绝发生在 add 事件前，不发 add/error/next 事件，不执行、不入队、不消费限速额度、不遗留 abort 监听；已取消信号沿既有拒绝路径，未配置时行为不变。验证重入 add 监听、固定/滑动窗口及队列空但额度已耗尽，依据实际能否开始判断，不仅依据 isRateLimited。'],
    ],
  },
  {
    id: 'pmap-completion-observer', owners: jsOwners, tests: jsTests,
    requirement: '仅默认 pMap 新增同步可选 onMapped({index,value}): void。成功 mapper 完成时，仅在整体尚未 settle、index 小于当时已知 done/stop 边界且结果非控制符时通知一次。不等待返回值；不支持异步 hook。已通知结果可能被稍后获知的更早 stop/done 排除，事件不撤回；整体 settle 后的在途成功结果不通知。',
    acceptance: [
      ['happy_path', '并发完成顺序可以不同于输入顺序，通知携带对应 index/value，最终数组仍按输入顺序排列。用 deferred Promise 验证先完成后发现更早 stop、先获知 stop/done 后完成、abort/fail-fast 后完成三类时序，按通知时刻的上述条件判定。'],
      ['business_rejection', 'pMapSkip 和 pMapStop 不通知；hook 抛错遵循 stopOnError，包含 false 时的聚合错误路径。'],
      ['compatibility', '未配置 hook 时兼容；pMapSettled、pMapKeyed、pMapSettledKeyed、pMapIterable 的运行入口忽略此字段，声明用新鲜对象拒绝该字段，不能经共享 Options 或引擎意外暴露。回调 value 推断为 await 后非控制符结果，不扩大返回数组类型。'],
    ],
  },
  {
    id: 'pmap-input-bound', owners: jsOwners, tests: jsTests,
    requirement: '仅默认 pMap 新增 maxItems，按 next() 启动调用顺序（非完成顺序）计数源位置，skip 也消耗位置。最多启动 maxItems+1 次 next()，最后一次仅作 overflow/done 探测，探测元素绝不传 mapper；并发高于上限及异步乱序也不得多拉取。发现该探测为元素时的结果待 DEC-001 决定。',
    question: '发现超限元素时拒绝整个调用，还是成功返回截断结果？',
    options: ['RangeError 拒绝整个调用，超限元素不交给 mapper', '成功返回截断结果'], recommendation: 0,
    acceptance: [
      ['happy_path', '推荐方案下，第 maxItems+1 项触发 RangeError，该元素不得交给 mapper；同步与异步 iterable 都适用。'],
      ['boundary', '仅接受 0..Number.MAX_SAFE_INTEGER，省略/undefined 不限制，Infinity/NaN/小数/负数以返回 Promise 拒绝 TypeError（不新增同步抛错）。0 时空输入成功，非空输入按 DEC-001 选择 RangeError 或空数组成功；恰好上限时探测 done 后正常返回。覆盖 concurrency>maxItems、异步 next 乱序、skip 计数。'],
      ['compatibility', 'OPT-1 overflow 为结构性立即 RangeError，与 stopOnError 无关；OPT-2 设定上限边界并等此前 mapper，沿既有 stopOnError 聚合。首次实际发生的终止失败/abort 优先；已知更早 done/stop 可屏蔽其后探测或 pull 错误，其他有效 next 错误沿原契约。已启动 Promise 拒绝始终被观察，未读输入不承诺；return() 调用但不等阻塞清理，拒绝被观察，不替换既有终止原因。未配置及其他导出函数保持原契约。'],
    ],
  },
  {
    id: 'ky-http-error-status', owners: ['source/errors/HTTPError.ts'], inspect: ['source/errors/KyError.ts'], tests: ['test/http-error.ts', 'test-d/http-error-status.ts'], newTests: ['test-d/http-error-status.ts'],
    requirement: 'HTTPError 新增只读 status getter，实时读取 response.status，不复制状态。',
    acceptance: [
      ['happy_path', '普通 HTTP 失败中 error.status 严格等于 error.response.status。'],
      ['boundary', '无 statusText 的 Response 仍有正确 status；在允许的 response 重新赋值后 getter 反映当前对象。'],
      ['compatibility', 'response/request/options/data、name/message 与 isHTTPError 保持兼容；类型验证拒绝给 status 赋值。'],
    ],
  },
  {
    id: 'ky-error-url-policy', owners: ['source/errors/HTTPError.ts', 'source/types/options.ts', 'source/core/Ky.ts', 'source/core/constants.ts', 'source/utils/options.ts', 'source/utils/merge.ts', 'source/index.ts', 'source/types/hooks.ts', 'source/types/ky.ts'], tests: ['test/http-error.ts', 'test/hooks.ts', 'test/request-options.ts', 'test-d/hide-error-url-search.ts'], newTests: ['test-d/hide-error-url-search.ts'],
    requirement: '为 HTTPError message 增加 hideErrorUrlSearch 选项，隐藏 query 与 fragment；默认策略待 DEC-001 决定。',
    question: '默认隐藏 URL 的 query/fragment，还是仅显式 opt-in 时隐藏？',
    options: ['仅显式 opt-in 隐藏，默认兼容', '默认隐藏'], recommendation: 0,
    acceptance: [
      ['happy_path', 'hideErrorUrlSearch=true 时，仅将 message 中的请求 URL 格式化为 search/hash 均清空的 URL，保留 method/status 等上下文；false 显式不隐藏。direct/create/extend 覆盖省略、true、false 及继承 true 后以 false 覆盖。该字段作为 boolean（省略按 DEC-001 默认，OPT-1 为 false）出现在一致的 InternalOptions/NormalizedOptions、error.options 与接收 NormalizedOptions 的 beforeRequest/beforeRetry/beforeError/afterResponse hooks 的 readonly normalized snapshot，运行值与公开声明一致；init 仍使用可变的归一化前 InitOptions，允许省略字段。'],
      ['boundary', 'beforeError 入口（用户 hook 修改之前）观察到上述 message；对 https://example.test/a?q=1#f 的 URL 片段期望 https://example.test/a，另覆盖仅 query、仅 fragment、均无；request.url 不变。'],
      ['compatibility', '默认 message 按 DEC-001：OPT-1 完全兼容原文，OPT-2 默认移除 URL 的 search/hash。实际发送 URL、重试行为不变；新选项经 kyOptionKeys 过滤，不得作为未知 RequestInit 字段泄漏到 fetch。merge/index/options 为必须追踪的现有传递/消费 owner，不强迫修改已有正确的通用逻辑。'],
    ],
  },
  {
    id: 'hono-cors-expose-function', owners: ['src/middleware/cors/index.ts'], tests: ['src/middleware/cors/index.test.ts'],
    requirement: 'CORS exposeHeaders 支持接收 origin 和 Context 的同步/异步函数，返回 string[]。',
    acceptance: [
      ['happy_path', '每个正常请求和 OPTIONS 请求各调用一次，origin 为原始请求 Origin header（缺失为字符串空值），Context 为同一请求实例；覆盖 allow-origin 选择与原始 Origin 不同。返回非空数组时写入 expose header。'],
      ['boundary', '返回空数组不写 expose header；异步抛错沿现有错误通道传播，不回退为允许所有来源。'],
      ['compatibility', '静态数组、allowMethods/origin、Vary、预检及非预检响应保持兼容；回归覆盖同步与异步类型签名。'],
    ],
  },
  {
    id: 'hono-cors-maxage-policy', owners: ['src/middleware/cors/index.ts'], tests: ['src/middleware/cors/index.test.ts'],
    requirement: 'CORS maxAge 的负数、NaN 与 Infinity 必须明确处理；错误时机待 DEC-001 决定。',
    question: '创建中间件时抛 TypeError，还是忽略非法字段并省略响应 header？',
    options: ['创建中间件时抛 TypeError', '忽略字段并省略 header'], recommendation: 0,
    acceptance: [
      ['business_rejection', '推荐方案下，负数、NaN、正负 Infinity 均在创建中间件时抛 TypeError，不等到首个请求。'],
      ['boundary', '0 合法，OPTIONS 输出值 0；未配置时省略；合法非负有限数沿既有行为处理。'],
      ['compatibility', 'GET 与 OPTIONS 的其他 CORS header、origin 选择、Vary 及异常通道不变。'],
    ],
  },
  {
    id: 'zod-stringbool-trim', owners: zodOwners, tests: ['packages/zod/src/v4/classic/tests/stringbool.test.ts', 'packages/zod/src/v4/mini/tests/stringbool.test.ts'], newTests: ['packages/zod/src/v4/mini/tests/stringbool.test.ts'],
    requirement: 'stringbool 新增 opt-in trim，默认 false；开启时先 trim 输入，再应用现有 case 配置。',
    acceptance: [
      ['happy_path', 'classic 与 mini 出口都接受 trim 参数，默认词表及自定义词表按 trim 后输入与现有大小写规则匹配。'],
      ['business_rejection', '按 trim 与现有 case 处理后的输入查词表，不匹配才失败；非字符串保持既有校验错误。默认词表中空白输入仍失败；自定义空字符串词条可使 trim 后纯空白成功，未开启时自定义含空白词条仍可精确匹配。'],
      ['compatibility', 'core/classic/mini 共享参数链及 boolean output 推断不变；仅 decode/parse 输入 trim，词表不 trim。encode 保持原有 case 归一化、第一项选择及空首项回退 true/false；验证大写词条、含空白词条与空首项。core util、public factory 与 exports 追踪兼容性，不要求修改已正确的通用透传。'],
    ],
  },
  {
    id: 'zod-stringbool-overlap', owners: zodOwners, tests: ['packages/zod/src/v4/classic/tests/stringbool.test.ts', 'packages/zod/src/v4/mini/tests/stringbool.test.ts'], newTests: ['packages/zod/src/v4/mini/tests/stringbool.test.ts'],
    requirement: 'truthy/falsy 词表在现有大小写归一化后重叠时，处理策略待 DEC-001 决定。',
    question: '重叠值采用 truthy 优先，还是构造 schema 时拒绝重叠？',
    options: ['构造时抛 TypeError 拒绝重叠', 'truthy 优先'], recommendation: 0,
    acceptance: [
      ['business_rejection', '推荐方案下，classic 与 mini 在构造时抛 TypeError，不到 parse 时再选真假。'],
      ['boundary', 'OPT-1 在既有 case 归一化后交集非空时构造拒绝；OPT-2 保持当前 truthy 优先（该分支是既有行为，可能只需兼容验证）。覆盖默认 insensitive、sensitive、完全重叠、仅大小写不同、空字符串重叠、单侧自定义与另一侧默认重叠及空数组；不额外 trim。'],
      ['compatibility', '无重叠配置、默认词表、boolean 推断和 encode/decode 行为不变。'],
    ],
  },
  {
    id: 'mitt-listener-count', owners: ['src/index.ts'], inspect: ['.gitignore', '.github/workflows/main.yml'], tests: ['test/index_test.ts', 'test/test-types-compilation.ts'],
    requirement: 'Emitter 新增 listenerCount(type)，返回该精确 key 当前注册的 handler 个数。',
    acceptance: [
      ['happy_path', '字符串、symbol、wildcard 分别精确计数；重复注册分别计数，off 后实时反映。'],
      ['boundary', '不存在 key 时为 0；wildcard 不计入普通事件，清空 Emitter.all 后读取为 0；传入预填充 map，直接替换 map 条目或修改 handler 数组后读取当前长度，不维护第二套计数。'],
      ['compatibility', 'on/off/emit 和数组快照行为不变，类型只接受既有事件键或 wildcard。'],
    ],
  },
  {
    id: 'mitt-once-reentrancy', owners: ['src/index.ts'], inspect: ['.gitignore', '.github/workflows/main.yml'], tests: ['test/index_test.ts', 'test/test-types-compilation.ts'],
    requirement: 'Emitter 新增 once<Key extends keyof Events>(type:Key,handler:Handler<Events[Key]>):void 与 once(type:"*",handler:WildcardHandler<Events>):void；每次注册独立包装，重复 once 注册分别触发，普通 on 同一函数不受影响。不新增 off(originalHandler) 识别包装的契约：off(type, originalHandler) 仍仅移除匹配原函数的普通注册；既有允许省略 handler 的普通事件 off(type) 清空该 key。保留 wildcard off 的现有类型限制，不新增类型可用的 off("*")。注销时机待 DEC-001 决定。',
    question: '在首次 handler 调用前注销，还是返回后注销？',
    options: ['调用前注销并以 per-registration fired 标记防止旧快照重复调用', '在 handler 的 finally 注销；回调内部尚未注销，允许有界重入再次调用'], recommendation: 0,
    acceptance: [
      ['happy_path', '推荐方案下，订阅在首次 handler 调用前注销，同一 handler 内重入 emit 不再次触发该订阅。'],
      ['dependency_failure', 'OPT-1 在 handler 抛错前已注销；OPT-2 在 finally 注销。两者均同步传播异常，不吞异常、不添加异步调度；B 不预选其中任一注销时机。'],
      ['compatibility', '普通与 wildcard 顺序及其他订阅快照语义不变；OPT-1 每次注册最多调用一次，包括更早普通 handler 引发递归后旧外层快照再次遇到 once 包装，以及 wildcard 同类重入。两种重载覆盖正负类型检查；OPT-2 允许回调内有界递归多次，但退出后不再调用。'],
    ],
  },
]

assert.equal(specifications.length, 16)
const cases = []
for (const source of draft.cases) {
  const baseId = source.caseId.replace(/-(?:pending|resolved)$/u, '')
  const spec = specifications.find((item) => item.id === baseId)
  assert.ok(spec, `Missing independently authored specification for ${source.caseId}`)
  const repository = draft.repositories.find((item) => item.identity === source.repositoryIdentity)
  assert.ok(repository)
  const git = async (args) => (await run('git', ['-C', repository.repository, ...args])).stdout.trim()
  assert.equal(await git(['rev-parse', 'HEAD']), repository.baseCommit)
  assert.equal(await git(['status', '--porcelain=v1']), '')
  const newTests = new Set(spec.newTests ?? [])
  const inventory = (await git(['ls-files'])).split('\n')
  const configPaths = inventory.filter((path) => path === 'package.json' || /^(?:[^/]*config[^/]*\.(?:json|ts|mts|js|mjs)|\.mocharc[^/]*)$/u.test(path) || (repository.identity.endsWith('/zod') && /^packages\/zod\/(?:package.json|[^/]*config[^/]*\.(?:json|ts))$/u.test(path)))
  const files = []
  for (const path of [...new Set([...spec.owners, ...spec.tests, ...(spec.inspect ?? []), ...configPaths])]) {
    assert.ok(!path.startsWith('/') && !path.split('/').includes('..'))
    if (newTests.has(path)) {
      // A proposed new test is not fabricated as a current evidence file.
      assert.equal(await git(['ls-files', '--', path]), '', `${path} is no longer a new file`)
      files.push({ path, kind: 'proposed_new_test' })
    } else {
      assert.equal(await git(['ls-files', '--', path]), path)
      const contents = await readFile(join(repository.repository, path))
      files.push({ path, kind: spec.owners.includes(path) ? 'current_owner' : spec.tests.includes(path) ? 'current_test' : 'current_configuration', sha256: sha256(contents) })
    }
  }
  const paired = spec.question !== undefined
  const blocked = source.expectedReadiness === 'blocked'
  // Candidate.ownerPaths exports Binding.allowedPathScopes: future writable
  // source and regression owners, not every read-only import/export consumer.
  const writableOwners = spec.id.startsWith('zod-') ? ['packages/zod/src/v4/core/api.ts']
    : spec.id === 'ky-error-url-policy' ? ['source/errors/HTTPError.ts', 'source/types/options.ts', 'source/core/Ky.ts', 'source/core/constants.ts']
      : spec.owners
  const bindingOwners = [...writableOwners, ...spec.tests]
  const inspectionOwners = spec.owners.filter((path) => !writableOwners.includes(path))
  const acceptance = spec.acceptance.map(([scenario, statement], index) => ({ key: `AC-${String(index + 1).padStart(3, '0')}`, scenario, statement, required: true }))
  const decision = !paired ? undefined : {
    key: 'DEC-001', question: spec.question,
    options: spec.options.map((description, index) => ({ id: `OPT-${index + 1}`, description })),
    ...(blocked ? {} : { proposedChosenOption: `OPT-${spec.recommendation + 1}` }),
    status: blocked ? 'intentionally_pending' : 'hypothetical_benchmark_choice',
    humanConfirmed: false,
  }
  const externalEvidence = []
  if (repository.identity === 'developit/mitt') {
    const url = 'https://raw.githubusercontent.com/developit/microbundle/c87aaf0e97cddc89ac177e55daf0688cfe4eda48/src/index.js'
    const cached = priorEvidencePacket?.cases.find((item) => item.repositoryIdentity === repository.identity)?.externalEvidence.find((item) => item.url === url)
    let content
    if (cached !== undefined) {
      assert.equal(cached.identity, 'developit/microbundle@0.12.3')
      assert.equal(sha256(cached.content), cached.sha256)
      content = cached.content
    } else {
      const response = await fetch(url, { signal: AbortSignal.timeout(30_000) })
      assert.equal(response.ok, true)
      content = await response.text()
    }
    externalEvidence.push({ url, identity: 'developit/microbundle@0.12.3', sha256: sha256(content), content })
  }
  const sourceLines = [
    `# ${source.caseId}`, '', `仓库：${repository.identity} @ ${repository.baseCommit}`, '',
    `REQ-001: ${spec.requirement}${paired && !blocked ? ` 本假设评测输入已固定 DEC-001=${decision.proposedChosenOption}，上述待定项在此场景已明确，无需再等待人工决策。` : ''}`, '',
    ...acceptance.map((item) => `${item.key} [${item.scenario}, required]: ${item.statement}`), '',
    ...(decision === undefined ? [] : [
      `DEC-001: ${decision.question}`,
      ...decision.options.map((option) => `${option.id}: ${option.description}`),
      blocked ? 'DEC-001 尚未决定。上述“推荐方案下”的 AC 只是条件验收，不授权选择该方案；必须保留未决 Decision 并停止，不能发布 ready 任务。' : `本 C 场景已固定假设输入 ${decision.proposedChosenOption}。AC 中的“推荐方案下”均以此场景输入解释。这是 benchmark 作者固定的假设，不是已经登记的人工决策，humanConfirmed=false。`, '',
      ...(!blocked ? ['本 C 场景只有所选分支是 required 的实现/验证义务，其他 OPT 描述仅为未选背景；保留同一 AC 键，不把备选分支同时当作交付要求。', ''] : []),
    ]),
    `必须检查的实现 owner：${spec.owners.join('、')}。`,
    `REQ-001 的完整可写 Binding allowedPathScopes 为这些精确文件：${bindingOwners.join('、')}。包含实现声明及所有要求新增/加强的回归文件，不用整目录替代；现有正确逻辑可以保持原样，不强迫为凑文件改代码。`,
    ...(inspectionOwners.length > 0 ? [`只读检查与兼容性追踪（不要求改动，故不列入可写 owner）：${inspectionOwners.join('、')}；如源码证明其中必须修改声明/透传，先明确需求范围缺口，不能以检查替代修改。`] : []),
    `自动回归与类型验证范围：${spec.tests.join('、')}。`,
    '运行测试与编译期检查分别沿仓库配置：类型负例必须放入已纳入 tsconfig/tsd 的文件，使用不会在运行时执行的断言，不把 tsx/Vitest 运行等同于类型检查。',
    `既有验证入口：package.json 的 test script（${repository.testScript}）。`,
    ...(repository.identity === 'developit/mitt' ? ['验证前置：按 .github/workflows/main.yml 先执行 npm run build，再 npm test。index.d.ts 与 dist 均在 .gitignore，为生成物而非独立维护 owner；package.source=src/index.ts，microbundle 0.12.3 从 pkg.types/typings 解析 declarationDir 并启用 declaration（固定上游源码证据另附）。修改 src/index.ts 后须重建声明，再检查从根入口导入的现有测试。本轮仅评测规划，不声称构建已运行。'] : []),
    `${blocked ? '仅在 DEC-001 解决之后适用：' : ''}保持上述 REQ/AC/DEC 本地键；仅使用现有依赖。任务拆为 TASK-IMPLEMENT（实现）与 TASK-VERIFY（独立验证，依赖 TASK-IMPLEMENT），全部必需 AC 均需实现及验证关系覆盖。${blocked ? '本未决场景不生成可分配任务。' : ''}`,
    '本批次只评测规划，不批准或派发任务，不修改仓库或上游，不修改发布配置。能力不足必须明确拒绝分配，不能由 Persona 推定。', '',
  ]
  const proposedPrd = sourceLines.join('\n')
  cases.push({
    caseId: source.caseId, repositoryIdentity: repository.identity, repositoryBaseCommit: repository.baseCommit,
    ...(source.pairedCaseId === undefined ? {} : { pairedCaseId: source.pairedCaseId }),
    expectedReadiness: source.expectedReadiness, expectedBlockingReasons: source.proposedBlockingReasons,
    requiredEvidenceStages: source.requiredEvidenceStages,
    requiredRequirementKeys: ['REQ-001'], requiredAcceptanceKeys: acceptance.map((item) => item.key),
    acceptance, allowedBindingOwnerPathsByRequirement: { 'REQ-001': [bindingOwners] }, inspectionOwnerPathsByRequirement: { 'REQ-001': inspectionOwners },
    proposedTaskExpectations: blocked ? [] : [
      { taskKey: 'TASK-IMPLEMENT', relationship: 'implementation', requiredRole: 'implementer', allowedAgentIds: null },
      { taskKey: 'TASK-VERIFY', relationship: 'verification', requiredRole: 'verifier', dependencyKeys: ['TASK-IMPLEMENT'], allowedAgentIds: null },
    ],
    ...(decision === undefined ? {} : { decision }), files, externalEvidence, repositoryInventory: inventory, proposedPrd, proposedPrdSha256: sha256(proposedPrd),
    humanReview: null, releaseInput: null, runnable: false,
    remaining: ['independent Gold review', 'scoped trusted team and capability facts', 'pre-model releaseInput freeze'],
  })
}
assert.equal(cases.length, 24)
assert.equal(new Set(cases.map((item) => item.caseId)).size, 24)
assert.equal(cases.filter((item) => item.decision?.proposedChosenOption !== undefined).length, 8)
const report = { schemaVersion: 1, status: 'review_only_not_release_gold', sourceDraftPath: draftPath, sourceDocumentSha256: draft.documentSha256,
  model: { provider: 'pockapi', id: 'gpt-6.1-sol' }, caseCount: cases.length, cases,
  batchBudget: { mode: 'explicitly_unlimited', tokenLimit: null, authorization: '用户于 2026-10-16 回复：不限制' }, realModelRequestCount: 0, humanAttestationsCreated: 0 }
// Reserve a new destination; never overwrite an earlier review packet.
await mkdir(destination)
await writeFile(join(destination, 'review-inputs.json'), `${JSON.stringify(report, null, 2)}\n`, { flag: 'wx' })
for (const item of cases) await writeFile(join(destination, `${item.caseId}.md`), item.proposedPrd, { flag: 'wx' })
const markdown = [
  '# 发布评测逐项输入审阅包', '',
  '状态：仅草案。没有调用模型、登记能力、签署 Gold 或填入虚假 reviewer。24 项各有独立完整输入，不依赖“与上一 case 相同”的隐式引用。', '',
  'C 场景保留拟定选择，须审阅后才能成为运行输入。类型与测试范围是拟定写入范围，当前文件的 SHA256 仅用于审阅溯源，不冒充 Service repositoryDigest。', '',
  '每项正式 Gold 还缺可信团队的 allowedAgentIds、运行前 releaseInput 与独立审阅摘要。用户已明确允许本批次不限 token，单请求仍受模型容量和输出上限约束。', '',
  ...cases.flatMap((item) => [
    `## ${item.caseId}`, '',
    `预期：${item.expectedReadiness}；阶段：${item.requiredEvidenceStages.join(' → ')}。`,
    `拟定 PRD SHA256：\`${item.proposedPrdSha256}\`。`, '',
    item.proposedPrd.replace(/^# .+\n/u, ''),
    '完整 owner 替代集合（须覆盖其中一整组）：', '',
    ...item.allowedBindingOwnerPathsByRequirement['REQ-001'].map((paths) => `- ${paths.map((path) => `\`${path}\``).join('、')}`), '',
    '源码/现有测试证据：', '',
    ...item.files.map((file) => `- \`${file.path}\`：${file.kind === 'proposed_new_test' ? '拟新增测试，当前不存在，不作为现有证据' : `SHA256 \`${file.sha256}\``}`), '',
  ]),
].join('\n')
await writeFile(join(destination, 'review.md'), markdown, { flag: 'wx' })
console.log(JSON.stringify({ destination, caseCount: cases.length, files: cases.length + 2, modelRequests: 0, status: report.status }))
