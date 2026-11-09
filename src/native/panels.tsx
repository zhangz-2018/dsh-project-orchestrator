import React, { useEffect, useState } from 'react'
import { IconRefreshOutlineMedium, IconTrashOutlineMedium } from '@deepseek-ai/dsh-client-ui-primitives'
import { loadNativeDiagnostics, loadPullRequestEvidence, loadPullRequestStatus, mutate, type PullRequestStatus } from '../api-client.js'
import type { NativeDiagnostics } from './types.js'

/** 能力面板只读取当前 Host，不启动 provider、改开关或请求模型。 */
export function NativeCapabilitiesPanel() {
  const [value, setValue] = useState<NativeDiagnostics>()
  const [error, setError] = useState<string>()
  const [generation, setGeneration] = useState(0)
  useEffect(() => {
    const controller = new AbortController()
    setError(undefined)
    void loadNativeDiagnostics(controller.signal).then(setValue).catch((reason: unknown) => { if (!controller.signal.aborted) setError(String(reason)) })
    return () => controller.abort()
  }, [generation])
  return <section className="po-native-section" aria-label="Host 原生能力">
    <div className="po-section-heading"><h2>Host 原生能力</h2><button type="button" className="po-link-button" title="刷新能力" aria-label="刷新能力" onClick={() => setGeneration((v) => v + 1)}><IconRefreshOutlineMedium /></button></div>
    {error ? <p role="alert" className="po-inline-error">{error}</p> : !value ? <p role="status">正在读取 Host 能力…</p> : <>
      <dl className="po-detail-facts"><dt>命令后端</dt><dd>{value.commandBackend === 'node' ? 'Node / CLI' : 'Harness subprocess'}</dd><dt>更新时间</dt><dd>{new Date(value.observedAt).toLocaleString()}</dd></dl>
      <dl className="po-native-capabilities">{value.capabilities.map((entry) => <div key={entry.id}><dt>{entry.label}</dt><dd><span>{entry.state === 'present' ? '服务已加载' : '服务未加载'}</span><small>{entry.detail}</small></dd></div>)}</dl>
    </>}
  </section>
}

const STATE_LABELS = { unbound: '未关联', unavailable: 'Forge 服务未加载', loading: '正在读取', error: '读取失败', stale: '状态已过期', observed: '已读取' }

/** PR 控件仅操作本地关联；远端 checks/diff 是外部参考，不推进验收。 */
export function NativePullRequestPanel({ projectId }: { projectId: string }) {
  const [status, setStatus] = useState<PullRequestStatus>()
  const [url, setUrl] = useState('')
  const [head, setHead] = useState('')
  const [editing, setEditing] = useState(false)
  const [error, setError] = useState<string>()
  const [evidence, setEvidence] = useState<string>()
  const [busy, setBusy] = useState(false)
  const [generation, setGeneration] = useState(0)
  useEffect(() => {
    const controller = new AbortController()
    setStatus(undefined)
    setError(undefined)
    setEvidence(undefined)
    const refresh = () => { void loadPullRequestStatus(projectId, controller.signal).then((value) => { if (!controller.signal.aborted) setStatus(value) }).catch((reason: unknown) => { if (!controller.signal.aborted) setError(String(reason)) }) }
    refresh()
    const timer = window.setInterval(refresh, 10000)
    return () => { controller.abort(); window.clearInterval(timer) }
  }, [projectId, generation])
  /** 组件按 projectId 挂载；状态轮询随退出取消，显式远端读取由服务端限时，写入使用 CAS。 */
  const act = async (work: () => Promise<unknown>) => {
    setBusy(true); setError(undefined)
    try { await work() } catch (reason) { setError(String(reason)) } finally { setBusy(false) }
  }
  const save = () => act(async () => {
    await mutate(`/projects/${encodeURIComponent(projectId)}/pull-request`, 'PUT', { url, expectedHead: head, expectedUpdatedAt: status?.binding?.updatedAt ?? null })
    setEditing(false); setGeneration((v) => v + 1)
  })
  const remove = () => act(async () => {
    await mutate(`/projects/${encodeURIComponent(projectId)}/pull-request`, 'DELETE', { expectedUpdatedAt: status?.binding?.updatedAt })
    setGeneration((v) => v + 1)
  })
  const read = (kind: 'checks' | 'diff') => act(async () => {
    const result = await loadPullRequestEvidence(projectId, kind)
    setEvidence(typeof result === 'object' && result !== null && 'patch' in result ? String(result.patch) : JSON.stringify(result, null, 2))
  })
  const capture = () => act(async () => { setEvidence(JSON.stringify(await mutate(`/projects/${encodeURIComponent(projectId)}/pull-request/evidence`, 'POST', {}), null, 2)) })
  return <section className="po-native-section" aria-label="Pull Request 关联">
    <div className="po-section-heading"><h2>Pull Request</h2><span>{status ? STATE_LABELS[status.state] : '正在读取…'}</span></div>
    {error ? <p role="alert" className="po-inline-error">{error}</p> : null}
    {status?.binding ? <dl className="po-detail-facts"><dt>PR / MR</dt><dd><a href={status.binding.url} target="_blank" rel="noreferrer">{status.binding.repository.owner}/{status.binding.repository.name} #{status.binding.number}</a></dd><dt>绑定 commit</dt><dd className="po-mono">{status.binding.expectedHead}</dd>{'snapshot' in status && status.snapshot ? <><dt>远端状态</dt><dd>{status.snapshot.state} · checks {status.snapshot.checksRollup}{status.snapshot.checksTruncated ? ' · 列表不完整' : ''}</dd><dt>审阅</dt><dd>{status.snapshot.reviewDecision} · {status.snapshot.unresolvedThreads} 未解决</dd><dt>Head</dt><dd>{status.headMatches ? '与绑定 commit 一致' : '远端 commit 已变化，证据不可复用'}</dd></> : null}{'observedAt' in status ? <><dt>采集时间</dt><dd>{new Date(status.observedAt!).toLocaleString()}</dd></> : null}</dl> : null}
    <div className="po-inline-actions"><button type="button" className="po-link-button" disabled={busy || !status} onClick={() => { setUrl(status?.binding?.url ?? ''); setHead(status?.binding?.expectedHead ?? ''); setEditing((v) => !v) }}>{editing ? '取消关联编辑' : status?.binding ? '编辑关联' : '关联 PR'}</button>{status?.binding ? <><button type="button" className="po-link-button" disabled={busy} onClick={() => void read('checks')}>完整检查</button><button type="button" className="po-link-button" disabled={busy} onClick={() => void capture()}>保存检查参考</button><button type="button" className="po-link-button" disabled={busy} onClick={() => void read('diff')}>查看 diff</button><button type="button" className="po-link-button" title="解除本地关联" aria-label="解除本地关联" disabled={busy} onClick={() => void remove()}><IconTrashOutlineMedium /></button></> : null}</div>
    {editing ? <form className="po-form-grid" onSubmit={(event) => { event.preventDefault(); void save() }}><label className="po-field">PR URL<input className="po-input" type="url" value={url} required onChange={(event) => setUrl(event.target.value)} /></label><label className="po-field">确认本地 HEAD<input className="po-input po-mono" value={head} required pattern="[0-9a-f]{40,64}" onChange={(event) => setHead(event.target.value)} /></label><button type="submit" className="po-link-button" disabled={busy || !url || !head}>保存本地关联</button></form> : null}
    {evidence ? <pre className="po-native-evidence">{evidence}</pre> : null}
  </section>
}
