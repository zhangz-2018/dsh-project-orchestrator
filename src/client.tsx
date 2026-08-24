import React, { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import type { ClientContext, WorkspaceId } from '@deepseek-ai/dsh-client-runtime/client'
import type { SidebarFooterActionOwnerProps } from '@deepseek-ai/dsh-client-ui-sidebar/client'
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import {
  Tooltip,
  IconAgentPresetOutline16,
  IconCheckOutline16,
  IconChecklistOutline14,
  IconChevronLeftOutline14,
  IconChevronRightOutline14,
  IconCloseOutline16,
  IconCodeOutline16,
  IconEditOutline16,
  IconFolderOpenOutline16,
  IconPlayOutline16,
  IconPlusOutline16,
  IconProjectAddOutline16,
  IconQueueOutline14,
  IconRefreshOutline16,
  IconSearchOutline16,
  IconSendOutline16,
  IconStopFill16,
  IconTrashOutline16,
  IconUserOutline16,
  IconWarningOutline16,
} from '@deepseek-ai/dsh-client-ui-primitives'
import { loadSnapshot, mutate } from './api-client.js'
import type {
  AgentBuilderMessage,
  AgentBuilderResponse,
  AgentDraft,
  AgentRecord,
  AgentWorkload,
  BoardStage,
  FeatureUsageFeature,
  ProjectAgentMembership,
  ProjectSquadBinding,
  InboxItem,
  ProjectRecord,
  ProjectStatus,
  Priority,
  RepositoryInspection,
  RunRecord,
  RuntimeRecord,
  RuntimeDetail,
  AgentRuntimeImpact,
  SquadAvailability,
  SquadEscalationPolicy,
  SquadRecord,
  EscalationTrigger,
  ProjectResource,
  Snapshot,
  TaskLanguage,
  TaskRecord,
  TaskStatus,
} from './client-types.js'
import {
  DEFAULT_COLLABORATION_POLICY_VERSION,
  ESCALATION_TRIGGER_OPTIONS,
  RECOMMENDED_LEADER_INSTRUCTIONS,
  effectiveSquadEscalationPolicy,
  escalationTriggerSummary,
  legacyEscalationPolicySummary,
  squadUiDiagnostics,
} from './squad-ui.js'
import { styles } from './styles.js'

export const inject = ['slots', 'workspaces']

type View = 'tasks' | 'projects' | 'agents' | 'inbox' | 'issues' | 'squads' | 'runtimes' | 'skills' | 'local-data'
type Panel = 'task-new' | 'task-detail' | 'project-form' | 'issue-detail' | 'agent-start' | 'agent-manual' | 'agent-ai' | 'agent-edit' | 'squad-form' | 'squad-detail' | 'project-squad-binding' | 'runtime-form' | 'runtime-detail' | 'runtime-binding' | null
type ProjectTab = 'overview' | 'tasks' | 'agents' | 'runs'

type DialogTone = 'default' | 'warning' | 'danger'
interface DialogRequest {
  title: string
  message: string
  confirmLabel?: string
  cancelLabel?: string
  tone?: DialogTone
}

interface WorkbenchState {
  open: boolean
  view: View
  panel: Panel
  dialog: DialogRequest | null
  snapshot: Snapshot
  selectedProjectId: string | undefined
  selectedTaskId: string | undefined
  selectedIssueId: string | undefined
  selectedAgentId: string | undefined
  selectedSquadId: string | undefined
  selectedRuntimeId: string | undefined
  editingProjectId: string | undefined
  projectTab: ProjectTab
  loading: boolean
  error: string | undefined
  notice: string | undefined
}

const EMPTY_SNAPSHOT: Snapshot = { agents: [], projects: [], tasks: [], approvals: [], runs: [], planHashes: {}, runtimes: [], resources: [], issues: [], taskRuns: [], activity: [], comments: [], decisions: [], squads: [], delegations: [], transcripts: [], artifacts: [], commands: [], externalTriggers: [], skills: [], workspaceLeases: [], localDirectoryLocks: [], inbox: [], agentWorkloads: [], runStatistics: [], projectAgentMemberships: [], projectSquadBindings: [], projectAgentMembershipSources: [], featureUsageDaily: [], runtimeOverview: { defaultHost: { id: 'default-host', name: '本机默认环境', status: 'unstable', capabilities: [], boundAgentCount: 0 }, customCount: 0, abnormalCount: 0, archivedCount: 0 } }

interface DirectoryEntry { name: string; path: string; hidden: boolean }
interface DirectoryListing { path: string; home: string; crumbs: DirectoryEntry[]; entries: DirectoryEntry[]; truncated: boolean }
interface WorkspaceLink { workspaceId: string; path: string; title: string }

interface RequirementImportResult {
  markdown: string
  pageCount: number
  textPageCount: number
  analyzedImagePages: number[]
  warnings: string[]
}

interface ParsedPdfImport {
  pageCount: number
  textPageCount: number
  visualPageCount: number
  extractedText: string
  images: Array<{ page: number; mediaType: 'image/jpeg'; dataBase64: string }>
  warnings: string[]
}

const MAX_PDF_BYTES = 15 * 1024 * 1024
const MAX_PDF_PAGES = 200
const MAX_PDF_TEXT_CHARS = 180_000
const MAX_PDF_IMAGE_PAGES = 20
const MAX_PDF_IMAGE_BASE64_CHARS = 26 * 1024 * 1024

async function parsePdfImport(file: File, signal: AbortSignal, progress: (message: string) => void): Promise<ParsedPdfImport> {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs')
  pdfjs.GlobalWorkerOptions.workerSrc = `/project-orchestrator/api/pdf-worker.mjs?v=${encodeURIComponent(pdfjs.version)}`
  const loadingTask = pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()), enableScripting: false } as Parameters<typeof pdfjs.getDocument>[0])
  const abort = () => { void loadingTask.destroy() }
  signal.addEventListener('abort', abort, { once: true })
  let document: Awaited<typeof loadingTask.promise> | undefined
  try {
    throwIfAborted(signal)
    document = await loadingTask.promise
    if (document.numPages > MAX_PDF_PAGES) throw new Error(`PDF 共 ${document.numPages} 页，超过 ${MAX_PDF_PAGES} 页上限。`)

    const textParts: string[] = []
    const visualCandidates: number[] = []
    let textCharacters = 0
    let textPageCount = 0
    let textTruncated = false
    for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
      throwIfAborted(signal)
      progress(`正在提取第 ${pageNumber}/${document.numPages} 页…`)
      const page = await document.getPage(pageNumber)
      try {
        const textContent = await page.getTextContent()
        const pageText = reconstructPdfPageText(textContent.items)
        if (pageText.length >= 40) textPageCount += 1
        const pageSection = `## PDF 第 ${pageNumber} 页\n${pageText || '[本页没有可提取文字]'}`
        if (textCharacters < MAX_PDF_TEXT_CHARS) {
          const remaining = MAX_PDF_TEXT_CHARS - textCharacters
          textParts.push(pageSection.slice(0, remaining))
          textCharacters += Math.min(pageSection.length, remaining)
          if (pageSection.length > remaining) textTruncated = true
        } else {
          textTruncated = true
        }
        visualCandidates.push(pageNumber)
      } finally {
        page.cleanup()
      }
    }

    const selectedVisualPages = samplePageNumbers(visualCandidates, MAX_PDF_IMAGE_PAGES)
    const images: ParsedPdfImport['images'] = []
    for (let index = 0; index < selectedVisualPages.length; index += 1) {
      throwIfAborted(signal)
      const pageNumber = selectedVisualPages[index]!
      progress(`正在渲染视觉页 ${index + 1}/${selectedVisualPages.length}（PDF 第 ${pageNumber} 页）…`)
      const page = await document.getPage(pageNumber)
      try {
        const natural = page.getViewport({ scale: 1 })
        const scale = Math.min(2, 1_500 / Math.max(natural.width, natural.height))
        const viewport = page.getViewport({ scale })
        const canvas = window.document.createElement('canvas')
        canvas.width = Math.max(1, Math.ceil(viewport.width))
        canvas.height = Math.max(1, Math.ceil(viewport.height))
        if (canvas.getContext('2d', { alpha: false }) === null) throw new Error('浏览器无法创建 PDF 页面画布。')
        await page.render({ canvas, viewport }).promise
        const blob = await canvasToJpeg(canvas)
        canvas.width = 0
        canvas.height = 0
        images.push({ page: pageNumber, mediaType: 'image/jpeg', dataBase64: await blobToBase64(blob) })
        if (images.reduce((total, image) => total + image.dataBase64.length, 0) > MAX_PDF_IMAGE_BASE64_CHARS) {
          throw new Error('PDF 页面图像转换后超过 26 MB，请压缩或拆分文档后重试。')
        }
      } finally {
        page.cleanup()
      }
    }

    const warnings: string[] = []
    if (textTruncated) warnings.push(`PDF 可提取文字超过 ${MAX_PDF_TEXT_CHARS.toLocaleString()} 字符，已截取前部内容。`)
    if (visualCandidates.length > selectedVisualPages.length) warnings.push(`需要视觉识别的页面较多，已抽样 ${selectedVisualPages.length}/${visualCandidates.length} 页。`)
    return {
      pageCount: document.numPages,
      textPageCount,
      visualPageCount: visualCandidates.length,
      extractedText: textParts.join('\n\n'),
      images,
      warnings,
    }
  } finally {
    signal.removeEventListener('abort', abort)
    await loadingTask.destroy()
  }
}

function reconstructPdfPageText(items: readonly unknown[]): string {
  const lines: string[] = []
  let line = ''
  let previousY: number | undefined
  for (const item of items) {
    if (typeof item !== 'object' || item === null || !('str' in item) || typeof item.str !== 'string') continue
    const transform = 'transform' in item && Array.isArray(item.transform) ? item.transform : undefined
    const y = typeof transform?.[5] === 'number' ? transform[5] : previousY
    if (previousY !== undefined && y !== undefined && Math.abs(y - previousY) > 3 && line.trim() !== '') {
      lines.push(line.trim())
      line = ''
    }
    if (item.str.trim() !== '') line += `${line === '' ? '' : ' '}${item.str.trim()}`
    if ('hasEOL' in item && item.hasEOL === true && line.trim() !== '') {
      lines.push(line.trim())
      line = ''
    }
    previousY = y
  }
  if (line.trim() !== '') lines.push(line.trim())
  return lines.join('\n').trim()
}

function samplePageNumbers(pages: number[], limit: number): number[] {
  if (pages.length <= limit) return pages
  if (limit <= 1) return [pages[0]!]
  return [...new Set(Array.from({ length: limit }, (_, index) => pages[Math.round(index * (pages.length - 1) / (limit - 1))]!))]
}

async function canvasToJpeg(canvas: HTMLCanvasElement): Promise<Blob> {
  const encode = async (quality: number) => await new Promise<Blob>((resolve, reject) => canvas.toBlob((blob) => {
    if (blob === null) reject(new Error('无法编码 PDF 页面图像。'))
    else resolve(blob)
  }, 'image/jpeg', quality))
  let encoded = await encode(0.8)
  for (const quality of [0.68, 0.54]) {
    if (encoded.size <= 1_200_000) break
    encoded = await encode(quality)
  }
  return encoded
}

async function blobToBase64(blob: Blob): Promise<string> {
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = () => reject(reader.error ?? new Error('无法读取 PDF 页面图像。'))
    reader.onload = () => resolve(String(reader.result))
    reader.readAsDataURL(blob)
  })
  return dataUrl.slice(dataUrl.indexOf(',') + 1)
}

function throwIfAborted(signal: AbortSignal): void {
  if (signal.aborted) throw signal.reason instanceof Error ? signal.reason : new DOMException('Aborted', 'AbortError')
}

class WorkbenchModel {
  constructor(
    private readonly directoryPicker: () => Promise<string | null>,
    private readonly directoryLister: (path?: string, signal?: AbortSignal) => Promise<DirectoryListing>,
    private readonly workspaceCreator: (path: string) => Promise<WorkspaceLink>,
    private readonly workspaceStarter: (workspaceId: string) => void,
  ) {}

  pickDirectory = (): Promise<string | null> => this.directoryPicker()
  listDirectory = (path?: string, signal?: AbortSignal): Promise<DirectoryListing> => this.directoryLister(path, signal)
  ensureWorkspace = (path: string): Promise<WorkspaceLink> => this.workspaceCreator(path)
  startWorkspace = (workspaceId: string): void => this.workspaceStarter(workspaceId)

  private state: WorkbenchState = {
    open: false,
    view: 'tasks',
    panel: null,
    dialog: null,
    snapshot: EMPTY_SNAPSHOT,
    selectedProjectId: undefined,
    selectedTaskId: undefined,
    selectedIssueId: undefined,
    selectedAgentId: undefined,
    selectedSquadId: undefined,
    selectedRuntimeId: undefined,
    editingProjectId: undefined,
    projectTab: 'overview',
    loading: false,
    error: undefined,
    notice: undefined,
  }
  private listeners = new Set<() => void>()
  private interval: number | undefined
  private refreshGeneration = 0
  private actionPending = false
  private returnFocus: HTMLElement | null = null
  private panelReturnFocus: HTMLElement | null = null
  trigger: HTMLButtonElement | null = null

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  getSnapshot = (): WorkbenchState => this.state

  open = (): void => {
    this.returnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : this.trigger
    this.patch({ open: true, error: undefined, notice: undefined })
    void this.refresh()
    if (this.interval === undefined) this.interval = window.setInterval(() => void this.refresh(true), 2_000)
  }

  close = (): void => {
    if (this.interval !== undefined) window.clearInterval(this.interval)
    this.interval = undefined
    this.refreshGeneration += 1
    this.resolveDialog(false)
    this.patch({ open: false, panel: null })
    window.setTimeout(() => {
      const target = this.returnFocus?.isConnected
        ? this.returnFocus
        : document.querySelector<HTMLButtonElement>('.po-launcher')
      target?.focus()
    }, 0)
  }

  destroy = (): void => {
    if (this.interval !== undefined) window.clearInterval(this.interval)
    this.interval = undefined
    this.refreshGeneration += 1
  }

  setView = (view: View): void => {
    void recordUsage(featureForView(view), 'open')
    this.patch({
      view,
      panel: null,
      selectedProjectId: undefined,
      selectedTaskId: undefined,
      selectedIssueId: undefined,
      selectedAgentId: undefined,
      selectedSquadId: undefined,
      selectedRuntimeId: undefined,
      editingProjectId: undefined,
      projectTab: 'overview',
      error: undefined,
      notice: undefined,
    })
  }

  openPanel = (panel: Panel): void => {
    this.rememberPanelFocus()
    this.patch({ panel, error: undefined, notice: undefined })
  }
  closePanel = (): void => {
    this.patch({ panel: null, editingProjectId: undefined, selectedSquadId: undefined, selectedRuntimeId: undefined })
    window.setTimeout(() => {
      const target = this.panelReturnFocus?.isConnected
        ? this.panelReturnFocus
        : document.querySelector<HTMLElement>('.po-workbench')
      target?.focus()
      this.panelReturnFocus = null
    }, 0)
  }
  openTask = (id: string): void => {
    this.rememberPanelFocus()
    this.patch({ selectedTaskId: id, panel: 'task-detail' })
  }
  openIssue = (id: string): void => {
    this.rememberPanelFocus()
    this.patch({ selectedIssueId: id, panel: 'issue-detail' })
  }
  openProject = (id: string, projectTab: ProjectTab = 'overview'): void => {
    void recordUsage('projects', 'open')
    this.patch({ selectedProjectId: id, projectTab, panel: null })
  }
  setProjectTab = (projectTab: ProjectTab): void => this.patch({ projectTab, panel: null })
  openProjectForm = (id?: string): void => {
    this.rememberPanelFocus()
    this.patch({ editingProjectId: id, panel: 'project-form' })
  }
  openAgent = (id: string): void => this.patch({ selectedAgentId: id, panel: null })
  openSquad = (id: string, edit = false): void => { this.rememberPanelFocus(); this.patch({ selectedSquadId: id, panel: edit ? 'squad-form' : 'squad-detail' }) }
  openProjectSquadBinding = (squadId?: string): void => { this.rememberPanelFocus(); this.patch({ selectedSquadId: squadId, panel: 'project-squad-binding' }) }
  openRuntime = (id: string, edit = false): void => { this.rememberPanelFocus(); this.patch({ selectedRuntimeId: id, panel: edit ? 'runtime-form' : 'runtime-detail' }) }
  clearSelection = (): void => this.patch({ selectedProjectId: undefined, selectedAgentId: undefined, selectedSquadId: undefined, selectedRuntimeId: undefined, projectTab: 'overview', panel: null })
  clearMessages = (): void => this.patch({ error: undefined, notice: undefined })
  reportError = (error: unknown): void => this.patch({ loading: false, error: messageOf(error), notice: undefined })
  reportNotice = (notice: string): void => this.patch({ notice, error: undefined })
  confirm = (request: DialogRequest): Promise<boolean> => new Promise((resolve) => {
    this.dialogResolver?.(false)
    this.dialogResolver = resolve
    this.patch({ dialog: { ...request, confirmLabel: request.confirmLabel ?? '确认', cancelLabel: request.cancelLabel ?? '取消' } })
  })
  resolveDialog = (confirmed: boolean): void => {
    const resolve = this.dialogResolver
    this.dialogResolver = undefined
    this.patch({ dialog: null })
    resolve?.(confirmed)
  }

  private dialogResolver: ((confirmed: boolean) => void) | undefined

  async refresh(silent = false): Promise<void> {
    const generation = ++this.refreshGeneration
    if (!silent) this.patch({ loading: true })
    try {
      const loaded = await loadSnapshot()
      const snapshot: Snapshot = { ...loaded, projectAgentMemberships: loaded.projectAgentMemberships ?? [], projectSquadBindings: loaded.projectSquadBindings ?? [], projectAgentMembershipSources: loaded.projectAgentMembershipSources ?? [], featureUsageDaily: loaded.featureUsageDaily ?? [] }
      if (generation !== this.refreshGeneration) return
      const selectedProjectId = keepOrUndefined(this.state.selectedProjectId, snapshot.projects)
      const selectedTaskId = keepOrUndefined(this.state.selectedTaskId, snapshot.tasks)
      const selectedAgentId = keepOrUndefined(this.state.selectedAgentId, snapshot.agents)
      const taskWasRemoved = this.state.selectedTaskId !== undefined && selectedTaskId === undefined
      const closeMissingTask = taskWasRemoved && this.state.panel === 'task-detail'
      this.patch({
        snapshot,
        selectedProjectId,
        selectedTaskId,
        selectedAgentId,
        panel: closeMissingTask ? null : this.state.panel,
        loading: false,
        ...(closeMissingTask ? { notice: '该任务已被删除或不再属于当前项目。' } : {}),
      })
    } catch (error) {
      if (generation === this.refreshGeneration) this.patch({ loading: false, error: messageOf(error) })
    }
  }

  async action<T>(operation: () => Promise<T>, notice: string, recordMeaningfulAction = true): Promise<T | undefined> {
    if (this.actionPending) return undefined
    this.actionPending = true
    this.patch({ loading: true, error: undefined, notice: undefined })
    try {
      const result = await operation()
      if (recordMeaningfulAction) void recordUsage(featureForView(this.state.view), 'action')
      await this.refresh(true)
      this.patch({ loading: false, notice })
      return result
    } catch (error) {
      this.patch({ loading: false, error: messageOf(error) })
      return undefined
    } finally {
      this.actionPending = false
    }
  }

  private rememberPanelFocus(): void {
    if (this.state.panel === null) {
      this.panelReturnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null
    }
  }

  private patch(next: Partial<WorkbenchState>): void {
    this.state = { ...this.state, ...next }
    for (const listener of this.listeners) listener()
  }
}

export function apply(ctx: ClientContext): void {
  const model = new WorkbenchModel(
    () => ctx.workspaces.pickDirectory(),
    (path, signal) => ctx.workspaces.listDirectory(path, signal),
    async (path) => {
      const workspace = await ctx.workspaces.create({ path })
      return { workspaceId: String(workspace.workspaceId), path: workspace.path, title: workspace.title }
    },
    (workspaceId) => ctx.workspaces.startSession(workspaceId as WorkspaceId),
  )
  ctx.effect(() => {
    const style = document.createElement('style')
    style.dataset.plugin = 'dsh-project-orchestrator'
    style.textContent = styles
    document.head.append(style)
    return () => style.remove()
  }, 'project-orchestrator.styles')
  ctx.effect(() => () => model.destroy(), 'project-orchestrator.client-lifecycle')

  function Launcher({ wide }: SidebarFooterActionOwnerProps) {
    const button = (
      <button
        ref={(element) => { model.trigger = element }}
        type="button"
        className={`po-launcher${wide ? ' po-launcher-wide' : ''}`}
        aria-label="打开交付工作台"
        onClick={model.open}
      >
        <IconChecklistOutline14 />
        {wide ? <span>交付工作台</span> : null}
      </button>
    )
    return wide ? button : <Tooltip label="交付工作台" side="right">{button}</Tooltip>
  }

  function Overlay() {
    const state = useSyncExternalStore(model.subscribe, model.getSnapshot)
    if (!state.open) return null
    return <Workbench model={model} state={state} />
  }

  ctx.slots.inject('sidebar.footer.action', () => ctx.slots.register({
    name: 'sidebar.footer.action',
    id: 'dsh.project-orchestrator.launcher',
    order: 40,
  }, Launcher))
  ctx.slots.inject('shell.overlay', () => ctx.slots.register({
    name: 'shell.overlay',
    id: 'dsh.project-orchestrator.workbench',
    order: 40,
  }, Overlay))
}

function Workbench({ model, state }: { model: WorkbenchModel; state: WorkbenchState }) {
  const root = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const workbench = root.current
    if (workbench === null) return
    const focusSelector = 'button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [href], [tabindex]:not([tabindex="-1"])'
    const modal = workbench.querySelector<HTMLElement>('.po-confirm-dialog, .po-modal')
    const focusScope = modal ?? workbench
    const background = [
      workbench.querySelector<HTMLElement>('.po-sidebar'),
      workbench.querySelector<HTMLElement>('.po-main'),
      workbench.querySelector<HTMLElement>('.po-mobile-nav'),
    ].filter((element): element is HTMLElement => element !== null)
    for (const element of background) {
      element.inert = modal !== null
      if (modal !== null) element.setAttribute('aria-hidden', 'true')
      else element.removeAttribute('aria-hidden')
    }
    const firstFocus = focusScope.querySelector<HTMLElement>(focusSelector)
    if (modal !== null) firstFocus?.focus()
    else workbench.focus()
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        if (state.dialog !== null) model.resolveDialog(false)
        else if (state.panel !== null) model.closePanel()
        else model.close()
        return
      }
      if (event.key !== 'Tab') return
      const focusable = [...focusScope.querySelectorAll<HTMLElement>(focusSelector)]
        .filter((element) => element.getClientRects().length > 0)
      if (focusable.length === 0) return
      const first = focusable[0]
      const last = focusable[focusable.length - 1]
      if (event.shiftKey && (document.activeElement === first || !focusScope.contains(document.activeElement))) {
        event.preventDefault()
        last?.focus()
      } else if (!event.shiftKey && (document.activeElement === last || !focusScope.contains(document.activeElement))) {
        event.preventDefault()
        first?.focus()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      for (const element of background) {
        element.inert = false
        element.removeAttribute('aria-hidden')
      }
    }
  }, [model, state.panel, state.dialog])

  const selectedTask = state.snapshot.tasks.find((task) => task.id === state.selectedTaskId)
  const selectedIssue = state.snapshot.issues.find((issue) => issue.id === state.selectedIssueId)

  return (
    <div
      ref={root}
      className={`po-workbench${state.loading ? ' po-loading' : ''}`}
      role="dialog"
      aria-modal="true"
      aria-label="交付工作台"
      aria-busy={state.loading}
      tabIndex={-1}
    >
      <WorkspaceSidebar state={state} model={model} />
      <main className="po-main">
        <MessageBar state={state} model={model} />
        {state.view === 'tasks' ? <TasksPage state={state} model={model} /> : null}
        {state.view === 'projects' ? <ProjectsPage state={state} model={model} /> : null}
        {state.view === 'agents' ? <AgentsPage state={state} model={model} /> : null}
        {state.view === 'inbox' ? <InboxPage state={state} model={model} /> : null}
        {state.view === 'issues' ? <IssuesPage state={state} model={model} /> : null}
        {state.view === 'squads' ? <SquadsPage state={state} model={model} /> : null}
        {state.view === 'runtimes' ? <RuntimesPage state={state} model={model} /> : null}
        {state.view === 'skills' ? <SkillsPage state={state} model={model} /> : null}
        {state.view === 'local-data' ? <LocalDataPage state={state} model={model} /> : null}
      </main>
      <MobileNavigation state={state} model={model} />
      {state.panel === 'task-new' ? <TaskDialog key="new-task" state={state} model={model} /> : null}
      {state.panel === 'task-detail' && selectedTask !== undefined ? <TaskDialog key={selectedTask.id} state={state} model={model} task={selectedTask} /> : null}
       {state.panel === 'issue-detail' && selectedIssue !== undefined ? <IssueDialog key={selectedIssue.id} state={state} model={model} issue={selectedIssue} /> : null}
      {state.panel === 'project-form' ? <ProjectDialog key={state.editingProjectId ?? 'new-project'} state={state} model={model} project={state.snapshot.projects.find((project) => project.id === state.editingProjectId)} /> : null}
      {state.panel === 'squad-form' ? <SquadDrawer key={state.selectedSquadId ?? 'new-squad'} state={state} model={model} squad={state.snapshot.squads.find((squad) => squad.id === state.selectedSquadId)} /> : null}
      {state.panel === 'squad-detail' && state.selectedSquadId ? <SquadDetailDrawer key={state.selectedSquadId} state={state} model={model} squadId={state.selectedSquadId} /> : null}
      {state.panel === 'project-squad-binding' && state.selectedProjectId ? <ProjectSquadBindingDrawer key={`${state.selectedProjectId}:${state.selectedSquadId ?? 'new'}`} project={state.snapshot.projects.find((project) => project.id === state.selectedProjectId)!} state={state} model={model} {...(state.selectedSquadId === undefined ? {} : { squadId: state.selectedSquadId })} /> : null}
      {state.panel === 'runtime-form' ? <RuntimeDrawer key={state.selectedRuntimeId ?? 'new-runtime'} state={state} model={model} runtime={state.snapshot.runtimes.find((runtime) => runtime.id === state.selectedRuntimeId)} /> : null}
      {state.panel === 'runtime-detail' && state.selectedRuntimeId ? <RuntimeDetailDrawer key={state.selectedRuntimeId} state={state} model={model} runtimeId={state.selectedRuntimeId} /> : null}
      {state.dialog ? <GlobalConfirmDialog request={state.dialog} onResolve={model.resolveDialog} /> : null}
    </div>
  )
}

function IssuesPage({ state, model }: { state: WorkbenchState; model: WorkbenchModel }) {
  const [query, setQuery] = useState('')
  const [status, setStatus] = useState<'all' | import('./client-types.js').IssueStatus>('all')
  const issues = state.snapshot.issues.filter((issue) => (status === 'all' || issue.status === status) && `${issue.title} ${issue.description} ${issue.labels.join(' ')}`.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase())).sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
  return <section className="po-page"><PageHeader title="Issues" subtitle={`${issues.length} 个长期工作事项`} /><div className="po-toolbar"><SearchField value={query} onChange={setQuery} placeholder="搜索 Issue…" /><select className="po-select po-compact-select" value={status} onChange={(event) => setStatus(event.target.value as typeof status)}><option value="all">全部状态</option><option value="todo">待办</option><option value="in_progress">进行中</option><option value="in_review">待审核</option><option value="blocked">阻塞</option><option value="done">已完成</option><option value="cancelled">已取消</option></select></div><div className="po-entity-list">{issues.length === 0 ? <EmptyState title="没有匹配的 Issue" body="项目计划、手动协作和 Squad 委派的长期事项会显示在这里。" /> : issues.map((issue) => { const project = state.snapshot.projects.find((candidate) => candidate.id === issue.projectId); const run = issue.activeTaskRunId ? state.snapshot.taskRuns.find((candidate) => candidate.id === issue.activeTaskRunId) : state.snapshot.taskRuns.filter((candidate) => candidate.issueId === issue.id).sort((a,b) => b.createdAt.localeCompare(a.createdAt))[0]; return <button type="button" className="po-entity-row" key={issue.id} onClick={() => model.openIssue(issue.id)}><span><strong>{issue.title}</strong><small>{project?.name ?? '工作区'} · {issue.labels.join(', ') || '无标签'}</small></span><span><StatusBadge status={issue.status as TaskStatus} /><small>{issue.reviewStatus ? `Review ${issue.reviewStatus}` : '尚未请求审核'}</small></span><span>{issue.assigneeId ? assigneeLabel(state.snapshot, issue.assigneeType, issue.assigneeId) : '未分派'}<small>{run ? `Run ${run.status} · attempt ${run.attempt}` : '无 TaskRun'}</small></span><IconChevronRightOutline14 /></button> })}</div></section>
}

function SquadsPage({ state, model }: { state: WorkbenchState; model: WorkbenchModel }) {
  const [filter, setFilter] = useState<'active' | 'archived'>('active')
  const squads = state.snapshot.squads.filter((squad) => squad.status === filter).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
  return <section className="po-page"><PageHeader title="团队编排" subtitle={`${squads.length} 个 ${filter === 'active' ? 'active' : '已归档'} Squad`} action={<ActionButton variant="primary" icon={<IconPlusOutline16 />} onClick={() => model.openPanel('squad-form')}>创建 Squad</ActionButton>} /><div className="po-toolbar"><div className="po-segments" role="group" aria-label="筛选 Squad"><Segment active={filter === 'active'} onClick={() => setFilter('active')}>Active</Segment><Segment active={filter === 'archived'} onClick={() => setFilter('archived')}>已归档</Segment></div></div><div className="po-management-list">{squads.length === 0 ? <EmptyState title={filter === 'active' ? '还没有 Squad' : '没有已归档 Squad'} body="创建 Squad，将 Leader、成员职责、委派说明和升级规则组织为可复用团队。" /> : squads.map((squad) => { const activeIssues = state.snapshot.issues.filter((issue) => issue.assigneeType === 'squad' && issue.assigneeId === squad.id && !['done','cancelled'].includes(issue.status)).length; const activeDelegations = state.snapshot.delegations.filter((item) => item.squadId === squad.id && ['queued','running','waiting_leader'].includes(item.status)).length; return <button className="po-management-row" type="button" key={squad.id} onClick={() => model.openSquad(squad.id)}><span><strong>{squad.name}</strong><small>{squad.description || '未填写描述'}</small></span><span><strong>{agentName(state.snapshot, squad.leaderAgentId)}</strong><small>Leader · {squad.memberAgentIds.length} 名成员</small></span><span><strong>{activeIssues} Issues · {activeDelegations} 委派</strong><small>并行上限 {squad.maxParallelDelegations}</small></span><span className={`po-badge po-status-${squad.status === 'active' ? 'completed' : 'cancelled'}`}>{squad.status === 'active' ? '活跃' : '已归档'}</span><IconChevronRightOutline14 /></button> })}</div></section>
}

function RuntimesPage({ state, model }: { state: WorkbenchState; model: WorkbenchModel }) {
  const [filter, setFilter] = useState<'active' | 'archived'>('active')
  const runtimes = state.snapshot.runtimes.filter((runtime) => runtime.lifecycle === filter).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
  const host = state.snapshot.runtimeOverview.defaultHost
  return <section className="po-page"><PageHeader title="运行环境" subtitle={`${state.snapshot.runtimeOverview.customCount} 个自定义 Runtime · ${state.snapshot.runtimeOverview.abnormalCount} 个异常`} action={<><ActionButton variant="ghost" onClick={() => model.setView('local-data')}>查看本地数据</ActionButton><ActionButton variant="primary" icon={<IconPlusOutline16 />} onClick={() => model.openPanel('runtime-form')}>创建 Runtime</ActionButton></>} /><div className="po-toolbar"><div className="po-segments" role="group" aria-label="筛选 Runtime"><Segment active={filter === 'active'} onClick={() => setFilter('active')}>Active</Segment><Segment active={filter === 'archived'} onClick={() => setFilter('archived')}>已归档</Segment></div></div><div className="po-management-list"><div className="po-management-row po-host-baseline"><span><strong>{host.name}</strong><small>Host baseline · 无需配置</small></span><span><strong>{availabilityLabel(host.status)}</strong><small>{host.capabilities.join(', ') || 'Harness 默认能力'}</small></span><span><strong>{host.boundAgentCount} Agents</strong><small>默认执行环境</small></span><span className="po-badge po-runtime-online">默认</span><span /></div>{runtimes.map((runtime) => { const agents = state.snapshot.agents.filter((agent) => agent.runtimeId === runtime.id).length; const resources = state.snapshot.resources.filter((resource) => resource.runtimeId === runtime.id).length; return <button className="po-management-row" type="button" key={runtime.id} onClick={() => model.openRuntime(runtime.id)}><span><strong>{runtime.name}</strong><small>{runtime.machineId}</small></span><span><strong>{availabilityLabel(runtime.status)}</strong><small>心跳 {relativeDate(runtime.lastHeartbeatAt)}</small></span><span><strong>{agents} Agents · {resources} Resources</strong><small>{runtime.capabilities.join(', ') || '未声明能力'}</small></span><span className={`po-badge po-runtime-${runtime.status}`}>{runtime.lifecycle === 'archived' ? '已归档' : availabilityLabel(runtime.status)}</span><IconChevronRightOutline14 /></button> })}</div></section>
}

async function readApi<T>(path: string): Promise<T> {
  const response = await fetch(`/project-orchestrator/api${path}`)
  const payload = await response.json() as T | { error?: { message?: string } }
  if (!response.ok) throw new Error(typeof payload === 'object' && payload !== null && 'error' in payload ? payload.error?.message || `Request failed with status ${response.status}.` : `Request failed with status ${response.status}.`)
  return payload as T
}

function SquadDrawer({ state, model, squad }: { state: WorkbenchState; model: WorkbenchModel; squad: SquadRecord | undefined }) {
  const [name, setName] = useState(squad?.name ?? '')
  const [description, setDescription] = useState(squad?.description ?? '')
  const [leaderAgentId, setLeaderAgentId] = useState(squad?.leaderAgentId ?? '')
  const [memberAgentIds, setMemberAgentIds] = useState<string[]>(squad?.memberAgentIds ?? [])
  const [memberRoles, setMemberRoles] = useState<Record<string, string>>(squad?.memberRoles ?? {})
  const [instructions, setInstructions] = useState(squad?.instructions ?? RECOMMENDED_LEADER_INSTRUCTIONS)
  const [escalationConfig, setEscalationConfig] = useState<SquadEscalationPolicy>(() => effectiveSquadEscalationPolicy(squad))
  const [maxParallelDelegations, setMaxParallelDelegations] = useState(squad?.maxParallelDelegations ?? 1)
  const [step, setStep] = useState<1 | 2 | 3>(1)
  const stepHeadingRef = useRef<HTMLDivElement>(null)
  useEffect(() => { if (step > 1) window.requestAnimationFrame(() => stepHeadingRef.current?.focus()) }, [step])
  const activeAgents = state.snapshot.agents.filter((agent) => agent.status === 'active')
  const toggleMember = (id: string) => setMemberAgentIds((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id])
  const toggleTrigger = (trigger: EscalationTrigger) => setEscalationConfig((current) => ({ ...current, triggers: current.triggers.includes(trigger) ? current.triggers.filter((item) => item !== trigger) : [...current.triggers, trigger] }))
  const diagnostics = squadUiDiagnostics({ instructions, customInstructions: escalationConfig.customInstructions, memberAgentIds, memberRoles, leaderAgentId, maxParallelDelegations, agents: activeAgents })
  const identityValid = name.trim() !== ''
  const membershipValid = memberAgentIds.length >= 2 && memberAgentIds.includes(leaderAgentId)
  const strategyValid = instructions.trim() !== '' && escalationConfig.triggers.length > 0
  const valid = identityValid && membershipValid && strategyValid
  const stepValid = step === 1 ? identityValid : step === 2 ? membershipValid : strategyValid
  const save = async () => { const payload = { name, description, leaderAgentId, memberAgentIds, memberRoles: Object.fromEntries(memberAgentIds.map((id) => [id, memberRoles[id]?.trim() || state.snapshot.agents.find((agent) => agent.id === id)?.role || '成员'])), instructions, escalationPolicy: legacyEscalationPolicySummary(escalationConfig), escalationConfig, collaborationPolicyVersion: squad?.collaborationPolicyVersion ?? DEFAULT_COLLABORATION_POLICY_VERSION, maxParallelDelegations, ...(squad ? { expectedUpdatedAt: squad.updatedAt } : {}) }; const result = await model.action(() => squad ? mutate<SquadRecord>(`/squads/${squad.id}`, 'PUT', payload) : mutate<SquadRecord>('/squads', 'POST', payload), squad ? 'Squad 已更新。' : 'Squad 已创建。'); if (result) model.closePanel() }
  return <ManagementDrawer title={squad ? '编辑 Squad' : '创建 Squad'} subtitle={`第 ${step}/3 步 · ${step === 1 ? '团队信息' : step === 2 ? '成员与职责' : '协作策略'}`} close={model.closePanel} footer={<>
<ActionButton variant="ghost" onClick={model.closePanel}>取消</ActionButton>{step > 1 ? <ActionButton variant="outline" onClick={() => setStep((step - 1) as 1 | 2)}>上一步</ActionButton> : null}{step < 3 ? <ActionButton variant="primary" disabled={!stepValid} onClick={() => setStep((step + 1) as 2 | 3)}>下一步</ActionButton> : <ActionButton variant="primary" disabled={!valid || state.loading} onClick={() => void save()}>{squad ? '保存 Squad' : '创建 Squad'}</ActionButton>}</>}>
<div ref={stepHeadingRef} className="po-drawer-steps" tabIndex={-1} aria-live="polite" aria-label={`步骤 ${step}/3`}>
<span aria-current={step === 1 ? 'step' : undefined}>1 团队信息</span>
<span aria-current={step === 2 ? 'step' : undefined}>2 成员职责</span>
<span aria-current={step === 3 ? 'step' : undefined}>3 协作策略</span>
</div>
<div className="po-form-grid">{step === 1 ? <>
<Field label="名称" wide>
<input className="po-input" autoFocus value={name} maxLength={160} onChange={(event) => setName(event.target.value)} />
</Field>
<Field label="描述" wide>
<textarea className="po-textarea" value={description} maxLength={1000} onChange={(event) => setDescription(event.target.value)} />
</Field>
</> : null}{step === 2 ? <>
<Field label="Leader">
<select className="po-select" autoFocus value={leaderAgentId} onChange={(event) => { setLeaderAgentId(event.target.value); if (!memberAgentIds.includes(event.target.value)) setMemberAgentIds([...memberAgentIds, event.target.value]) }}>
<option value="">选择 Leader</option>{activeAgents.map((agent) => <option key={agent.id} value={agent.id}>{agent.name}</option>)}</select>
</Field>
<Field label="并行委派上限">
<input className="po-input" type="number" min={1} max={32} value={maxParallelDelegations} onChange={(event) => setMaxParallelDelegations(Math.min(32, Math.max(1, Number(event.target.value) || 1)))} />
</Field>
<fieldset className="po-member-picker po-field-wide">
<legend>成员与职责 <span>权限由智能体配置决定</span></legend>{activeAgents.map((agent) => <div key={agent.id}>
<label>
<input type="checkbox" checked={memberAgentIds.includes(agent.id)} onChange={() => toggleMember(agent.id)} />
<span className="po-member-name"><span>{agent.name}</span><small className={`po-member-tool-policy ${agent.toolPolicy === 'full' ? 'po-member-tool-policy-full' : ''}`}>{agent.toolPolicy === 'full' ? '可执行' : '只读'}</small></span>
</label>{memberAgentIds.includes(agent.id) ? <input className="po-input" aria-label={`${agent.name} 的职责`} value={memberRoles[agent.id] ?? agent.role} onChange={(event) => setMemberRoles({ ...memberRoles, [agent.id]: event.target.value })} /> : null}</div>)}</fieldset>
</> : null}{step === 3 ? <>
<Field label="Leader 协作协议" hint="生效范围：Leader TaskRun。系统会把本字段加入 Leader 运行指令。" wide>
<div className="po-field-toolbar"><span>{instructions.length.toLocaleString()} / 20,000 字符</span><ActionButton size="sm" variant="outline" onClick={() => setInstructions(RECOMMENDED_LEADER_INSTRUCTIONS)}>恢复推荐模板</ActionButton></div>
<textarea className="po-textarea po-squad-instructions" autoFocus value={instructions} maxLength={20_000} onChange={(event) => setInstructions(event.target.value)} />
</Field>
<Field label="最大并行委派" hint="生效范围：整个 Squad 的 active Delegation。"><input className="po-input" type="number" min={1} max={32} value={maxParallelDelegations} onChange={(event) => setMaxParallelDelegations(Math.min(32, Math.max(1, Number(event.target.value) || 1)))} /></Field>
<Field label="同类验证失败后升级" hint="允许的针对性修复次数，0–10。"><input className="po-input" type="number" min={0} max={10} value={escalationConfig.maxFocusedRepairAttempts} onChange={(event) => setEscalationConfig({ ...escalationConfig, maxFocusedRepairAttempts: Math.min(10, Math.max(0, Number(event.target.value) || 0)) })} /></Field>
<fieldset className="po-trigger-picker po-field-wide"><legend>必须升级的情况</legend><p>生效范围：Leader 和成员 TaskRun。触发器由系统执行并请求人工 Decision。</p><div>{ESCALATION_TRIGGER_OPTIONS.map((option) => <label key={option.value}><input type="checkbox" checked={escalationConfig.triggers.includes(option.value)} onChange={() => toggleTrigger(option.value)} /><span><strong>{option.label}</strong><small>{option.description}</small></span></label>)}</div>{escalationConfig.triggers.length === 0 ? <span className="po-field-error">至少选择一个系统升级触发器。</span> : null}</fieldset>
<Field label="自定义升级说明（可选）" hint="作为补充进入协作 Prompt，不能扩大权限、改变系统动作或绕过 Review。" wide><textarea className="po-textarea" value={escalationConfig.customInstructions} maxLength={10_000} onChange={(event) => setEscalationConfig({ ...escalationConfig, customInstructions: event.target.value })} placeholder="补充团队特定的升级事实、证据或沟通要求" /></Field>
<div className="po-fixed-policy po-field-wide"><strong>成员失败时</strong><span>保留其他成员工作并请求 Leader 或人工处理。</span></div>
{diagnostics.length > 0 ? <section className="po-squad-diagnostics po-field-wide" aria-live="polite"><h3><IconWarningOutline16 />配置诊断（不阻止保存）</h3><ul>{diagnostics.map((item) => <li key={item.code}><strong>{item.scope}</strong><span>{item.message}</span></li>)}</ul></section> : <div className="po-squad-diagnostics po-squad-diagnostics-clear po-field-wide" role="status">未发现明显的配置质量问题。</div>}
</> : null}</div>
</ManagementDrawer>
}

function SquadDetailDrawer({ state, model, squadId }: { state: WorkbenchState; model: WorkbenchModel; squadId: string }) {
  const squad = state.snapshot.squads.find((item) => item.id === squadId)
  if (!squad) return null
  const activeIssues = state.snapshot.issues.filter((issue) => issue.assigneeType === 'squad' && issue.assigneeId === squad.id && !['done','cancelled'].includes(issue.status))
  const delegations = state.snapshot.delegations.filter((item) => item.squadId === squad.id).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
  const activeDelegations = delegations.filter((item) => ['queued', 'running', 'waiting_leader'].includes(item.status))
  const squadRuns = state.snapshot.taskRuns.filter((run) => run.squadId === squad.id).sort((a, b) => b.createdAt.localeCompare(a.createdAt))
  const evidenceRun = squadRuns.find((run) => run.promptVersion || run.collaborationPolicyVersion) ?? squadRuns[0]
  const escalationConfig = effectiveSquadEscalationPolicy(squad)
  const roleDiagnostics = squadUiDiagnostics({ instructions: squad.instructions, customInstructions: escalationConfig.customInstructions, memberAgentIds: squad.memberAgentIds, memberRoles: squad.memberRoles, leaderAgentId: squad.leaderAgentId, maxParallelDelegations: squad.maxParallelDelegations, agents: state.snapshot.agents }).filter((item) => item.scope === '成员职责')
  const latestDecision = state.snapshot.decisions.filter((decision) => decision.metadata.squadId === squad.id).sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0]
  const clone = async () => { const result = await model.action(() => mutate<SquadRecord>(`/squads/${squad.id}/clone`, 'POST', { expectedSourceUpdatedAt: squad.updatedAt }), 'Squad 副本已创建。'); if (result) model.openSquad(result.id, true) }
  const archive = async () => { if (!await model.confirm({ title: '归档 Squad', message: `归档 Squad“${squad.name}”？归档后不能再分派新 Issue。`, confirmLabel: '归档 Squad', tone: 'warning' })) return; const result = await model.action(() => mutate(`/squads/${squad.id}/archive`, 'POST', { expectedUpdatedAt: squad.updatedAt }), 'Squad 已归档。'); if (result) model.closePanel() }
  const remove = async () => { if (!await model.confirm({ title: '删除 Squad', message: `永久删除 Squad“${squad.name}”？仅无历史引用的 Squad 可以删除。`, confirmLabel: '永久删除', tone: 'danger' })) return; const result = await model.action(() => mutate(`/squads/${squad.id}`, 'DELETE'), 'Squad 已删除。'); if (result) model.closePanel() }
  return <ManagementDrawer title={squad.name} subtitle={`${squad.status === 'active' ? '活跃' : '已归档'} · 更新于 ${formatDate(squad.updatedAt)}`} close={model.closePanel} footer={<><ActionButton variant="ghost" onClick={() => void clone()}>克隆 Squad</ActionButton>{squad.status === 'active' ? <ActionButton variant="outline" onClick={() => model.openSquad(squad.id, true)}>编辑 Squad</ActionButton> : null}{squad.status === 'active' ? <ActionButton variant="outline" onClick={() => void archive()}>归档 Squad</ActionButton> : <ActionButton variant="outline" icon={<IconTrashOutline16 />} onClick={() => void remove()}>删除 Squad</ActionButton>}</>}>
    <dl className="po-detail-facts"><dt>Leader</dt><dd>{agentName(state.snapshot, squad.leaderAgentId)}</dd><dt>成员职责</dt><dd>{squad.memberAgentIds.map((id) => `${agentName(state.snapshot,id)}（${squad.memberRoles[id] ?? '成员'} · ${state.snapshot.agents.find((agent) => agent.id === id)?.toolPolicy === 'read_only' ? '只读' : '可执行'}）`).join('、')}</dd><dt>并行容量</dt><dd>{activeDelegations.length}/{squad.maxParallelDelegations} 占用</dd><dt>Leader 协作协议</dt><dd>{squad.instructions}<small className="po-scope-label">生效范围：Leader TaskRun</small></dd><dt>升级触发器</dt><dd>{escalationTriggerSummary(escalationConfig)}<small className="po-scope-label">系统执行，触发后请求人工 Decision</small></dd>{escalationConfig.customInstructions ? <><dt>自定义升级说明</dt><dd>{escalationConfig.customInstructions}</dd></> : null}</dl>
    <section className="po-drawer-section"><h3>Prompt 与策略证据</h3><dl className="po-detail-facts"><dt>Prompt 版本</dt><dd>{evidenceRun?.promptVersion ?? 'legacy'}</dd><dt>协作策略版本</dt><dd>{evidenceRun?.collaborationPolicyVersion ?? squad.collaborationPolicyVersion ?? 'legacy'}</dd><dt>Prompt digest</dt><dd className="po-mono">{evidenceRun?.promptDigest ?? '历史运行未记录'}</dd><dt>Context digest</dt><dd className="po-mono">{evidenceRun?.promptContextDigest ?? '历史运行未记录'}</dd></dl>{evidenceRun?.promptDiagnostics?.length ? <ul className="po-evidence-diagnostics">{evidenceRun.promptDiagnostics.map((item, index) => <li key={`${item.code}:${index}`}>{item.severity} · {item.code}</li>)}</ul> : null}</section>
    <section className="po-drawer-section"><h3>活跃委派占用</h3>{activeDelegations.length === 0 ? <p className="po-context-empty">当前没有 active Delegation。</p> : activeDelegations.map((delegation) => <button type="button" className="po-delegation-row" key={delegation.id} onClick={() => model.openIssue(delegation.childIssueId)}><span><strong>{agentName(state.snapshot, delegation.memberAgentId)}</strong><small>{delegation.contract?.objective ?? delegation.instruction}</small></span><span>{delegation.status}</span></button>)}</section>
    <section className="po-drawer-section"><h3>职责与工具冲突</h3>{roleDiagnostics.length === 0 ? <p className="po-context-empty">未识别到职责重复或只读工具冲突。</p> : <ul className="po-conflict-list">{roleDiagnostics.map((item) => <li key={item.code}><IconWarningOutline16 /><span>{item.message}</span></li>)}</ul>}</section>
    <section className="po-drawer-section"><h3>最近升级 Decision</h3>{latestDecision ? <article className="po-decision-evidence"><div><strong>{latestDecision.title}</strong><span className={`po-badge po-status-${latestDecision.status === 'approved' ? 'completed' : latestDecision.status === 'rejected' ? 'failed' : 'blocked'}`}>{latestDecision.status}</span></div><p>{latestDecision.prompt}</p>{latestDecision.resolution ? <small>处理结论：{latestDecision.resolution}</small> : null}<time dateTime={latestDecision.createdAt}>{formatDate(latestDecision.createdAt)} · {latestDecision.id}</time></article> : <p className="po-context-empty">没有 metadata.squadId 指向此 Squad 的 Decision。</p>}</section>
    {activeIssues.length > 0 ? <section className="po-drawer-section"><h3>活跃 Issues</h3>{activeIssues.map((issue) => <button type="button" className="po-context-row po-context-row-button" key={issue.id} onClick={() => model.openIssue(issue.id)}><strong>{issue.title}</strong><span>{issue.status}</span></button>)}</section> : null}
  </ManagementDrawer>
}

function RuntimeDrawer({ state, model, runtime }: { state: WorkbenchState; model: WorkbenchModel; runtime: RuntimeRecord | undefined }) {
  const [name, setName] = useState(runtime?.name ?? '')
  const [machineId, setMachineId] = useState(runtime?.machineId ?? '')
  const [capabilities, setCapabilities] = useState(runtime?.capabilities.join('\n') ?? '')
  const [agentCli, setAgentCli] = useState(runtime?.agentCli ?? '')
  const [workspaceRoot, setWorkspaceRoot] = useState(runtime?.workspaceRoot ?? '')
  const executionFieldsLocked = runtime !== undefined && (state.snapshot.agents.some((agent) => agent.runtimeId === runtime.id) || state.snapshot.resources.some((resource) => resource.runtimeId === runtime.id) || state.snapshot.taskRuns.some((run) => run.runtimeId === runtime.id && ['queued', 'waiting_local_directory', 'dispatched', 'running'].includes(run.status)))
  const save = async () => { const base = { name, machineId, capabilities: parseList(capabilities), agentCli: agentCli.trim() || (runtime ? null : undefined), workspaceRoot: workspaceRoot.trim() || (runtime ? null : undefined) }; const payload = runtime ? { ...base, expectedUpdatedAt: runtime.updatedAt } : base; const result = await model.action(() => runtime ? mutate(`/runtimes/${runtime.id}`, 'PUT', payload) : mutate('/runtimes', 'POST', payload), runtime ? 'Runtime 已更新。' : 'Runtime 已创建。'); if (result) model.closePanel() }
  return <ManagementDrawer title={runtime ? '编辑 Runtime' : '创建 Runtime'} subtitle="Runtime 描述当前本机 Host 的执行配置，不代表远程工作节点。" close={model.closePanel} footer={<><ActionButton variant="ghost" onClick={model.closePanel}>取消</ActionButton><ActionButton variant="primary" disabled={!name.trim() || !machineId.trim() || state.loading} onClick={() => void save()}>{runtime ? '保存 Runtime' : '创建 Runtime'}</ActionButton></>}>{executionFieldsLocked ? <div className="po-info-banner"><IconWarningOutline16 /><span>执行配置正在被引用；名称仍可修改。其他字段请通过新建 Runtime 并迁移绑定来变更。</span></div> : null}<div className="po-form-grid"><Field label="名称" wide><input className="po-input" autoFocus value={name} maxLength={160} onChange={(event) => setName(event.target.value)} /></Field><Field label="Machine ID" wide><input className="po-input po-mono" value={machineId} disabled={executionFieldsLocked} maxLength={240} onChange={(event) => setMachineId(event.target.value)} /></Field><Field label="能力（每行一项）" wide><textarea className="po-textarea" value={capabilities} disabled={executionFieldsLocked} onChange={(event) => setCapabilities(event.target.value)} /></Field><Field label="Agent CLI"><input className="po-input po-mono" value={agentCli} disabled={executionFieldsLocked} onChange={(event) => setAgentCli(event.target.value)} placeholder="Harness 默认" /></Field><Field label="工作区根目录"><input className="po-input po-mono" value={workspaceRoot} disabled={executionFieldsLocked} onChange={(event) => setWorkspaceRoot(event.target.value)} placeholder="不限制" /></Field></div></ManagementDrawer>
}

function RuntimeDetailDrawer({ state, model, runtimeId }: { state: WorkbenchState; model: WorkbenchModel; runtimeId: string }) {
  const [detail, setDetail] = useState<RuntimeDetail>()
  const [error, setError] = useState<string>()
  useEffect(() => { void readApi<RuntimeDetail>(`/runtimes/${runtimeId}`).then(setDetail).catch((reason) => setError(messageOf(reason))) }, [runtimeId])
  const runtime = detail?.runtime ?? state.snapshot.runtimes.find((item) => item.id === runtimeId)
  if (!runtime) return null
  const heartbeat = async (status: RuntimeRecord['status']) => { await model.action(() => mutate(`/runtimes/${runtime.id}/heartbeat`, 'POST', { status }), `Runtime 已标记为${availabilityLabel(status)}。`) }
  const archive = async () => { if (!await model.confirm({ title: '归档 Runtime', message: `归档 Runtime“${runtime.name}”？请先迁移所有 Agent 和 Resource 绑定。`, confirmLabel: '归档 Runtime', tone: 'warning' })) return; const result = await model.action(() => mutate(`/runtimes/${runtime.id}/archive`, 'POST', { expectedUpdatedAt: runtime.updatedAt }), 'Runtime 已归档。'); if (result) model.closePanel() }
  const remove = async () => { if (!await model.confirm({ title: '删除 Runtime', message: `永久删除 Runtime“${runtime.name}”？仅无绑定和历史引用时允许删除。`, confirmLabel: '永久删除', tone: 'danger' })) return; const result = await model.action(() => mutate(`/runtimes/${runtime.id}`, 'DELETE'), 'Runtime 已删除。'); if (result) model.closePanel() }
  return <ManagementDrawer title={runtime.name} subtitle={`${runtime.machineId} · ${availabilityLabel(runtime.status)}`} close={model.closePanel} footer={<>{runtime.lifecycle === 'active' ? <><ActionButton variant="ghost" onClick={() => void heartbeat(runtime.status === 'online' ? 'unstable' : 'online')}>{runtime.status === 'online' ? '标记不稳定' : '标记在线'}</ActionButton><ActionButton variant="outline" onClick={() => model.openRuntime(runtime.id, true)}>编辑 Runtime</ActionButton><ActionButton variant="outline" onClick={() => void archive()}>归档 Runtime</ActionButton></> : <ActionButton variant="outline" icon={<IconTrashOutline16 />} onClick={() => void remove()}>删除 Runtime</ActionButton>}</>}>
    {error ? <div className="po-inline-error"><IconWarningOutline16 />{error}</div> : null}<dl className="po-detail-facts"><dt>状态</dt><dd>{availabilityLabel(runtime.status)}</dd><dt>最近心跳</dt><dd>{formatDate(runtime.lastHeartbeatAt)}</dd><dt>能力</dt><dd>{runtime.capabilities.join(', ') || '未声明'}</dd><dt>工作区根目录</dt><dd>{runtime.workspaceRoot || '未限制'}</dd><dt>Agent CLI</dt><dd>{runtime.agentCli || 'Harness 默认'}</dd><dt>运行历史</dt><dd>{detail ? `${detail.historyCount} 次，${detail.activeTaskRuns.length} 个 active，${detail.queuedTaskRuns.length} 个排队` : '正在读取…'}</dd></dl>{detail && (detail.agents.length > 0 || detail.resources.length > 0) ? <section className="po-drawer-section"><h3>当前绑定</h3>{detail.agents.map((agent) => <button type="button" className="po-context-row po-context-row-button" key={agent.id} onClick={() => { model.closePanel(); model.setView('agents'); window.setTimeout(() => model.openAgent(agent.id), 0) }}><strong>{agent.name}</strong><span>Agent</span></button>)}{detail.resources.map((resource) => <div className="po-context-row" key={resource.id}><strong>{resource.location}</strong><span>Resource</span></div>)}</section> : null}</ManagementDrawer>
}

function ProjectSquadBindingDrawer({ project, state, model, squadId }: { project: ProjectRecord; state: WorkbenchState; model: WorkbenchModel; squadId?: string }) {
  const activeBindings = state.snapshot.projectSquadBindings.filter((binding) => binding.projectId === project.id && binding.status !== 'removed')
  const boundIds = new Set(activeBindings.map((binding) => binding.squadId))
  const candidates = state.snapshot.squads.filter((squad) => squad.status === 'active' && (!boundIds.has(squad.id) || squad.id === squadId))
  const [selectedSquadId, setSelectedSquadId] = useState(squadId ?? '')
  const [makeDefault, setMakeDefault] = useState(activeBindings.length === 0)
  const [syncRoles, setSyncRoles] = useState(false)
  const selected = candidates.find((squad) => squad.id === selectedSquadId)
  const activeMemberIds = new Set(projectMemberships(state.snapshot, project.id).map((member) => member.agentId))
  const additions = selected?.memberAgentIds.filter((agentId) => !activeMemberIds.has(agentId)) ?? []
  const executable = selected?.memberAgentIds.filter((agentId) => state.snapshot.agents.find((agent) => agent.id === agentId)?.toolPolicy !== 'read_only').length ?? 0
  const submit = async () => {
    if (!selected) return
    const result = await model.action(() => mutate(`/projects/${project.id}/squad-bindings`, 'POST', { squadId: selected.id, isDefault: makeDefault, syncRoles, expectedProjectRevision: project.revision, expectedSquadUpdatedAt: selected.updatedAt }), `${selected.name} 已绑定，${additions.length} 个项目成员已补齐。`)
    if (result) model.closePanel()
  }
  return <ManagementDrawer title="绑定 Squad" subtitle="建立项目团队关系，并补齐 Leader 与成员的参与资格。" close={model.closePanel} footer={<><ActionButton variant="ghost" onClick={model.closePanel}>取消</ActionButton><ActionButton variant="primary" data-testid="confirm-bind-squad" disabled={!selected || state.loading} onClick={() => void submit()}>绑定并同步</ActionButton></>}>
    <div data-testid="project-squad-binding-drawer"><fieldset className="po-binding-picker"><legend>选择团队</legend>{candidates.length === 0 ? <div className="po-empty-project-note"><IconWarningOutline16 /><div><strong>没有可绑定的 active Squad</strong><p>项目已经绑定全部可用 Squad，或需要先在团队编排中创建团队。</p></div></div> : candidates.map((squad) => <label key={squad.id} data-testid={`squad-option-${squad.id}`}><input type="radio" name="project-squad" checked={selectedSquadId === squad.id} onChange={() => setSelectedSquadId(squad.id)} /><span><strong>{squad.name}</strong><small>Leader：{agentName(state.snapshot, squad.leaderAgentId)} · {squad.memberAgentIds.length} 名成员 · {squad.memberAgentIds.filter((agentId) => state.snapshot.agents.find((agent) => agent.id === agentId)?.toolPolicy !== 'read_only').length} 名可执行</small></span></label>)}</fieldset>
    {selected ? <section className="po-drawer-section" data-testid="squad-assignment-preview"><h3>绑定影响</h3><dl className="po-detail-facts"><dt>新增项目成员</dt><dd data-testid="squad-preview-additions">{additions.length === 0 ? '无需新增' : additions.map((id) => agentName(state.snapshot, id)).join('、')}</dd><dt>成员构成</dt><dd>{executable} 名可执行，{selected.memberAgentIds.length - executable} 名只读</dd><dt>任务分配</dt><dd>不修改现有 Task，绑定后可使用批量分配。</dd><dt>项目审批</dt><dd>不改变 revision 或现有审批。</dd></dl></section> : null}
    <section className="po-drawer-section"><h3>同步选项</h3><label className="po-check" data-testid="squad-default-toggle"><input type="checkbox" checked={makeDefault} disabled={activeBindings.length === 0} onChange={(event) => setMakeDefault(event.target.checked)} />设为项目默认 Squad</label><label className="po-check" data-testid="squad-sync-mode"><input type="checkbox" checked={syncRoles} onChange={(event) => setSyncRoles(event.target.checked)} />同步 Squad 职责到仅由该 Squad 提供的新成员</label><p className="po-helper-copy">手动维护的项目职责不会被覆盖。绑定不会自动批准或启动项目。</p></section>
    </div>
  </ManagementDrawer>
}

function ManagementDrawer({ title, subtitle, close, children, footer }: { title: string; subtitle?: string; close: () => void; children: React.ReactNode; footer: React.ReactNode }) {
  const drawerRef = useRef<HTMLElement>(null)
  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : undefined
    const drawer = drawerRef.current
    const focusable = () => [...(drawer?.querySelectorAll<HTMLElement>('button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])') ?? [])]
    window.requestAnimationFrame(() => (drawer?.querySelector<HTMLElement>('[autofocus]') ?? focusable()[0])?.focus())
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); close(); return }
      if (event.key !== 'Tab') return
      const items = focusable()
      if (items.length === 0) { event.preventDefault(); return }
      const first = items[0]!
      const last = items.at(-1)!
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus() }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus() }
    }
    document.addEventListener('keydown', onKeyDown)
    return () => { document.removeEventListener('keydown', onKeyDown); previous?.focus() }
  }, [close])
  return <div className="po-drawer-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) close() }}><section ref={drawerRef} className="po-drawer" role="dialog" aria-modal="true" aria-label={title}><header><div><h2>{title}</h2>{subtitle ? <p>{subtitle}</p> : null}</div><button type="button" className="po-icon-button" aria-label="关闭" onClick={close}><IconCloseOutline16 /></button></header><div className="po-drawer-body">{children}</div><footer>{footer}</footer></section></div>
}

function LocalDataPage({ state, model }: { state: WorkbenchState; model: WorkbenchModel }) {
  const latest = [...state.snapshot.featureUsageDaily].sort((a, b) => b.lastUsedAt.localeCompare(a.lastUsedAt))
  const clearUsage = async () => { await model.action(() => mutate('/usage', 'DELETE'), '本地使用统计已清除。', false) }
  return <section className="po-page"><PageHeader title="本地数据" subtitle="当前 Host 的持久化记录与最近使用情况" action={latest.length > 0 ? <ActionButton variant="outline" icon={<IconTrashOutline16 />} disabled={state.loading} onClick={() => void clearUsage()}>清除使用统计</ActionButton> : undefined} /><div className="po-local-data"><section><h2>持久化记录</h2><dl><dt>Projects</dt><dd>{state.snapshot.projects.length}</dd><dt>Issues</dt><dd>{state.snapshot.issues.length}</dd><dt>TaskRuns</dt><dd>{state.snapshot.taskRuns.length}</dd><dt>Artifacts</dt><dd>{state.snapshot.artifacts.length}</dd><dt>Feature usage days</dt><dd>{state.snapshot.featureUsageDaily.length}</dd></dl></section><section><h2>最近使用</h2>{latest.length === 0 ? <p>尚无本地功能使用记录。</p> : latest.slice(0, 12).map((item) => <div className="po-context-row" key={item.id}><strong>{item.feature}</strong><span>{item.opens} 次打开 · {item.meaningfulActions} 次操作</span></div>)}</section><section><h2>导航</h2><div className="po-inline-actions"><ActionButton variant="outline" onClick={() => model.setView('projects')}>查看项目</ActionButton><ActionButton variant="outline" onClick={() => model.setView('runtimes')}>查看运行环境</ActionButton><ActionButton variant="outline" onClick={() => model.setView('inbox')}>查看 Inbox</ActionButton></div></section></div></section>
}

function SkillsPage({ state, model }: { state: WorkbenchState; model: WorkbenchModel }) {
  return <section className="po-page"><PageHeader title="Skills" subtitle={`${state.snapshot.skills.length} 个已分配技能名称`} /><div className="po-info-banner"><IconWarningOutline16 /><span>这里展示 Agent Profile 中的技能分配，不代表 Harness 已安装或当前 Runtime 可用。</span></div><div className="po-entity-list">{state.snapshot.skills.length === 0 ? <EmptyState title="尚无技能分配" body="在 Agent 配置中添加 Skills 后，可从这里查看使用范围。" /> : state.snapshot.skills.map((skill) => <article className="po-entity-panel" key={skill.id}><div className="po-section-heading"><div><h2>{skill.name}</h2><p>{skill.description}</p></div><strong>{skill.agentIds.length} Agents</strong></div><div className="po-inline-links">{skill.agentIds.map((id) => <button type="button" key={id} onClick={() => { model.setView('agents'); window.setTimeout(() => model.openAgent(id), 0) }}>{agentName(state.snapshot,id)}</button>)}</div></article>)}</div></section>
}

function InboxPage({ state, model }: { state: WorkbenchState; model: WorkbenchModel }) {
  const [kind, setKind] = useState<'all' | InboxItem['kind']>('all')
  const items = state.snapshot.inbox.filter((item) => kind === 'all' || item.kind === kind)
  return <section className="po-page">
    <PageHeader title="Inbox" subtitle={`${state.snapshot.inbox.length} 个待处理事项`} />
    <div className="po-toolbar"><div className="po-segments" role="group" aria-label="筛选 Inbox"><button type="button" aria-pressed={kind === 'all'} onClick={() => setKind('all')}>全部</button><button type="button" aria-pressed={kind === 'needs_decision'} onClick={() => setKind('needs_decision')}>决定</button><button type="button" aria-pressed={kind === 'blocked'} onClick={() => setKind('blocked')}>阻塞</button><button type="button" aria-pressed={kind === 'review_ready'} onClick={() => setKind('review_ready')}>审核</button></div><span className="po-toolbar-note">按最新变化排序</span></div>
    <div className="po-inbox-layout">
      <div className="po-inbox-list">{items.length === 0 ? <EmptyState title={state.snapshot.inbox.length === 0 ? '当前没有待处理事项' : '没有匹配的待处理事项'} body="阻塞、审核、Runtime 离线和需要决定的事项会集中显示在这里。" /> : items.map((item) => <InboxCard key={item.id} item={item} state={state} model={model} />)}</div>
      <WorkloadPanel state={state} model={model} />
    </div>
  </section>
}

function InboxCard({ item, state, model }: { item: InboxItem; state: WorkbenchState; model: WorkbenchModel }) {
  const [resolution, setResolution] = useState('')
  const project = item.projectId === undefined ? undefined : state.snapshot.projects.find((candidate) => candidate.id === item.projectId)
  const decision = item.decisionId === undefined ? undefined : state.snapshot.decisions.find((candidate) => candidate.id === item.decisionId)
  const act = async (action: InboxItem['actions'][number]) => {
    const note = resolution.trim() || inboxDefaultResolution(action)
    const result = await model.action(() => mutate(`/inbox/${encodeURIComponent(item.id)}/actions`, 'POST', { action, resolution: note, actor: 'operator' }), inboxActionNotice(action))
    if (result) setResolution('')
  }
  return <article className="po-inbox-item"><div className="po-inbox-item-heading"><span className="po-status-badge po-status-badge-warning">{inboxKindLabel(item.kind)}</span><time dateTime={item.createdAt}>{formatDate(item.createdAt)}</time></div><h2>{item.title}</h2><p>{item.summary}</p><div className="po-inbox-context">{project ? <button type="button" onClick={() => { model.setView('projects'); window.setTimeout(() => model.openProject(project.id), 0) }}>{project.name}</button> : <span>工作区事项</span>}{decision ? <span>{decisionKindLabel(decision.kind)} · {decision.requestedById || actorTypeLabel(decision.requestedByType)}</span> : null}{item.taskRunId ? <span>TaskRun {item.taskRunId.slice(0, 8)}</span> : null}</div>{item.actions.length > 0 ? <label className="po-inbox-resolution"><span>处理说明</span><textarea value={resolution} onChange={(event) => setResolution(event.target.value)} placeholder="记录决定依据、审核结论或重试原因" maxLength={20_000} /></label> : null}<div className="po-inbox-actions">{item.runtimeId !== undefined ? <ActionButton size="sm" variant="outline" onClick={() => { model.setView('runtimes'); window.setTimeout(() => model.openRuntime(item.runtimeId!), 0) }}>查看 Runtime</ActionButton> : null}{item.issueId !== undefined ? <ActionButton size="sm" variant="outline" onClick={() => model.openIssue(item.issueId!)}>查看 Issue</ActionButton> : null}{item.actions.includes('approve') ? <ActionButton size="sm" variant="primary" aria-label={`批准：${item.title}`} onClick={() => void act('approve')}>批准事项</ActionButton> : null}{item.actions.includes('reject') ? <ActionButton size="sm" variant="outline" aria-label={`拒绝：${item.title}`} onClick={() => void act('reject')}>拒绝事项</ActionButton> : null}{item.actions.includes('defer') ? <ActionButton size="sm" variant="ghost" aria-label={`稍后处理：${item.title}`} onClick={() => void act('defer')}>稍后处理</ActionButton> : null}{item.actions.includes('retry') ? <ActionButton size="sm" variant="primary" aria-label={`重试：${item.title}`} onClick={() => void act('retry')}>重试执行</ActionButton> : null}</div></article>
}

function WorkloadPanel({ state, model }: { state: WorkbenchState; model: WorkbenchModel }) {
  const workloads = [...state.snapshot.agentWorkloads].sort((left, right) => right.utilizationPercent - left.utilizationPercent || right.queued - left.queued)
  return <aside className="po-workload-panel" aria-label="Agent 工作负载"><div className="po-section-heading"><div><h2>Agent workload</h2><p>Runtime 状态与并发占用</p></div></div>{workloads.length === 0 ? <p className="po-context-empty">还没有可统计的智能体。</p> : workloads.map((workload) => { const agent = state.snapshot.agents.find((candidate) => candidate.id === workload.agentId); return <button type="button" className="po-workload-row" key={workload.agentId} onClick={() => { model.setView('agents'); window.setTimeout(() => model.openAgent(workload.agentId), 0) }} aria-label={`${agent?.name ?? workload.agentId}，${availabilityLabel(workload.availability)}，占用 ${workload.occupied} / ${workload.maxConcurrency} 个并发槽位`}><div><strong>{agent?.name ?? workload.agentId}</strong><span>{availabilityLabel(workload.availability)} · {workloadLabel(workload.workload)}{workload.queued > 0 ? ` · ${workload.queued} 排队` : ''}</span><span className="po-workload-track" aria-hidden="true"><i style={{ width: `${Math.min(100, workload.utilizationPercent)}%` }} /></span></div><b>{workload.occupied}/{workload.maxConcurrency}<small>{workload.availableSlots} 空闲</small></b></button> })}</aside>
}

function WorkspaceSidebar({ state, model }: { state: WorkbenchState; model: WorkbenchModel }) {
  const activeAgents = state.snapshot.agentWorkloads.filter((workload) => workload.occupied > 0).length
  const [moreOpen, setMoreOpen] = useState(() => window.localStorage.getItem('project-orchestrator:sidebar-more') === 'open')
  const runtimeWarnings = state.snapshot.runtimes.filter((runtime) => runtime.status !== 'online').length
  const activeSquads = state.snapshot.delegations.filter((delegation) => ['queued', 'running', 'waiting_leader'].includes(delegation.status)).length
  const toggleMore = () => setMoreOpen((open) => { const next = !open; window.localStorage.setItem('project-orchestrator:sidebar-more', next ? 'open' : 'closed'); return next })
  return (
    <aside className="po-sidebar">
      <div className="po-sidebar-brand"><span className="po-brand-mark"><IconCodeOutline16 /></span><div><strong>交付工作台</strong><span>Harness projects</span></div></div>
      <div className="po-sidebar-section">工作</div>
      <SideNavButton active={state.view === 'inbox'} icon={<IconWarningOutline16 />} count={state.snapshot.inbox.length} onClick={() => model.setView('inbox')}>Inbox</SideNavButton>
      <SideNavButton active={state.view === 'projects'} icon={<IconFolderOpenOutline16 />} count={state.snapshot.projects.length} onClick={() => model.setView('projects')}>项目</SideNavButton>
      <SideNavButton active={state.view === 'tasks'} icon={<IconChecklistOutline14 />} count={state.snapshot.tasks.length} onClick={() => model.setView('tasks')}>交付看板</SideNavButton>
      <SideNavButton active={state.view === 'issues'} icon={<IconChecklistOutline14 />} count={state.snapshot.issues.length} onClick={() => model.setView('issues')}>Issues</SideNavButton>
      <div className="po-sidebar-section">执行角色</div>
      <SideNavButton active={state.view === 'agents'} icon={<IconAgentPresetOutline16 />} count={state.snapshot.agents.length} onClick={() => model.setView('agents')}>智能体</SideNavButton>
      <SideNavButton active={state.view === 'skills'} icon={<IconQueueOutline14 />} count={state.snapshot.skills.length} onClick={() => model.setView('skills')}>Skills</SideNavButton>
      <button type="button" className="po-sidebar-more-toggle" aria-expanded={moreOpen} onClick={toggleMore}><IconChevronRightOutline14 /><span>更多</span>{runtimeWarnings > 0 ? <i className="po-nav-warning" aria-label={`${runtimeWarnings} 个运行环境异常`} /> : activeSquads > 0 ? <i className="po-nav-active" aria-label={`${activeSquads} 个团队编排活动`} /> : null}</button>
      {moreOpen ? <div className="po-sidebar-more-items"><SideNavButton active={state.view === 'squads'} icon={<IconUserOutline16 />} count={activeSquads} onClick={() => model.setView('squads')}>团队编排</SideNavButton><SideNavButton active={state.view === 'runtimes'} icon={<IconCodeOutline16 />} count={runtimeWarnings} onClick={() => model.setView('runtimes')}>运行环境</SideNavButton><SideNavButton active={state.view === 'local-data'} icon={<IconFolderOpenOutline16 />} count={state.snapshot.featureUsageDaily.length} onClick={() => model.setView('local-data')}>本地数据</SideNavButton></div> : null}
      <div className="po-sidebar-section po-sidebar-section-spaced">运行概览</div>
      <div className="po-sidebar-metric"><span>智能体工作中</span><strong>{activeAgents}</strong></div>
      <div className="po-sidebar-metric"><span>等待批准</span><strong>{state.snapshot.projects.filter((project) => project.status === 'awaiting_approval').length}</strong></div>
      <div className="po-sidebar-metric"><span>测试已通过</span><strong>{state.snapshot.tasks.filter((task) => task.status === 'completed').length}</strong></div>
      <div className="po-sidebar-footer"><button type="button" className="po-side-action" onClick={() => void model.refresh()}><IconRefreshOutline16 />刷新数据</button><button type="button" className="po-side-action" onClick={model.close}><IconCloseOutline16 />退出工作台</button></div>
    </aside>
  )
}

function SideNavButton({ active, icon, count, onClick, children }: { active: boolean; icon: React.ReactNode; count: number; onClick: () => void; children: React.ReactNode }) {
  return <button className="po-side-nav" type="button" aria-current={active ? 'page' : undefined} onClick={onClick}>{icon}<span>{children}</span><span className="po-side-count">{count}</span></button>
}

function MobileNavigation({ state, model }: { state: WorkbenchState; model: WorkbenchModel }) {
  const moreActive = ['issues', 'skills', 'squads', 'runtimes', 'local-data'].includes(state.view)
  const moreRef = useRef<HTMLDetailsElement>(null)
  const selectMoreView = (view: View) => { if (moreRef.current) moreRef.current.open = false; model.setView(view) }
  return (
    <nav className="po-mobile-nav" aria-label="工作区导航">
      <button type="button" aria-current={state.view === 'inbox' ? 'page' : undefined} onClick={() => model.setView('inbox')}><IconWarningOutline16 /><span>Inbox</span></button>
      <button type="button" aria-current={state.view === 'projects' ? 'page' : undefined} onClick={() => model.setView('projects')}><IconFolderOpenOutline16 /><span>项目</span></button>
      <button type="button" aria-current={state.view === 'tasks' ? 'page' : undefined} onClick={() => model.setView('tasks')}><IconChecklistOutline14 /><span>交付</span></button>
      <button type="button" aria-current={state.view === 'agents' ? 'page' : undefined} onClick={() => model.setView('agents')}><IconAgentPresetOutline16 /><span>智能体</span></button>
      <details ref={moreRef} className="po-mobile-more"><summary aria-current={moreActive ? 'page' : undefined}><IconQueueOutline14 /><span>更多</span></summary><div><button type="button" aria-current={state.view === 'issues' ? 'page' : undefined} onClick={() => selectMoreView('issues')}>Issues</button><button type="button" aria-current={state.view === 'skills' ? 'page' : undefined} onClick={() => selectMoreView('skills')}>Skills</button><button type="button" aria-current={state.view === 'squads' ? 'page' : undefined} onClick={() => selectMoreView('squads')}>团队编排</button><button type="button" aria-current={state.view === 'runtimes' ? 'page' : undefined} onClick={() => selectMoreView('runtimes')}>运行环境</button><button type="button" aria-current={state.view === 'local-data' ? 'page' : undefined} onClick={() => selectMoreView('local-data')}>本地数据</button><button type="button" onClick={model.close}>关闭工作台</button></div></details>
    </nav>
  )
}

function PageHeader({ title, subtitle, action, back, backLabel = '返回' }: { title: string; subtitle?: string; action?: React.ReactNode; back?: () => void; backLabel?: string }) {
  return (
    <header className="po-page-header">
      <div className="po-page-heading">
        {back === undefined ? null : <button type="button" className="po-icon-button" aria-label={backLabel} onClick={back}><IconChevronLeftOutline14 /></button>}
        <div><h1>{title}</h1>{subtitle ? <p>{subtitle}</p> : null}</div>
      </div>
      {action ? <div className="po-page-actions">{action}</div> : null}
    </header>
  )
}

function ActionButton({ variant = 'ghost', size = 'md', icon, className, children, type, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'ghost' | 'outline' | 'danger'
  size?: 'md' | 'sm'
  icon?: React.ReactNode
}) {
  return <button {...props} type={type ?? 'button'} className={`po-button po-button-${variant} po-button-${size}${className ? ` ${className}` : ''}`}>{icon ? <span className="po-button-icon">{icon}</span> : null}<span className="po-button-label">{children}</span></button>
}

type BoardColumnId = BoardStage | 'completed'

const BOARD_COLUMNS: Array<{ id: BoardColumnId; label: string; tone: string }> = [
  { id: 'planned', label: '待规划', tone: 'neutral' },
  { id: 'todo', label: '待办', tone: 'plain' },
  { id: 'in_progress', label: '进行中', tone: 'amber' },
  { id: 'review', label: '审核中', tone: 'green' },
  { id: 'completed', label: '已完成', tone: 'blue' },
]
const SCHEDULABLE_STAGES: BoardStage[] = ['planned', 'todo', 'in_progress', 'review']

function TasksPage({ state, model }: { state: WorkbenchState; model: WorkbenchModel }) {
  const [query, setQuery] = useState('')
  const [kind, setKind] = useState<'all' | 'code' | 'test'>('all')
  const [draggingTaskId, setDraggingTaskId] = useState<string>()
  const [dragOverStage, setDragOverStage] = useState<BoardColumnId>()
  const [moveMenuTaskId, setMoveMenuTaskId] = useState<string>()
  const pointerDrag = useRef<{ taskId: string; pointerId: number; overStage: BoardColumnId | undefined }>()
  const visibleTasks = useMemo(() => state.snapshot.tasks.filter((task) => {
    const text = `${task.title} ${task.description} ${projectName(state.snapshot, task.projectId)}`.toLocaleLowerCase()
    return (kind === 'all' || task.kind === kind) && text.includes(query.trim().toLocaleLowerCase())
  }), [kind, query, state.snapshot])
  const activeAgents = state.snapshot.agentWorkloads.filter((workload) => workload.occupied > 0).length
  const clearDrag = () => {
    pointerDrag.current = undefined
    setDraggingTaskId(undefined)
    setDragOverStage(undefined)
  }
  const focusTaskHandle = (taskId: string) => {
    window.requestAnimationFrame(() => {
      const card = [...document.querySelectorAll<HTMLElement>('.po-task-card')].find((element) => element.dataset.taskId === taskId)
      card?.querySelector<HTMLButtonElement>('.po-card-drag-handle')?.focus()
    })
  }
  const moveTaskToStage = async (task: TaskRecord, stage: BoardColumnId, restoreFocus = false) => {
    clearDrag()
    setMoveMenuTaskId(undefined)
    if (stage === 'completed') {
      model.reportError('已完成列由独立测试门禁控制，不能人工拖入。')
      if (restoreFocus) focusTaskHandle(task.id)
      return
    }
    if (!canScheduleTask(state.snapshot, task)) {
      model.reportError(task.status === 'completed' ? '测试已通过的任务不能人工移动。' : '项目正在拆解或执行，暂时不能调整排期。')
      if (restoreFocus) focusTaskHandle(task.id)
      return
    }
    if (boardColumnForTask(task) === stage) {
      if (restoreFocus) focusTaskHandle(task.id)
      return
    }
    const result = await model.action(
      () => mutate<TaskRecord>(`/tasks/${task.id}/board-stage`, 'PUT', { boardStage: stage }),
      `任务已移至“${boardStageLabel(stage)}”。`,
    )
    if (restoreFocus && result !== undefined) focusTaskHandle(task.id)
  }
  const beginPointerDrag = (task: TaskRecord, event: React.PointerEvent<HTMLButtonElement>) => {
    if (!canScheduleTask(state.snapshot, task) || state.loading) return
    event.preventDefault()
    event.currentTarget.setPointerCapture(event.pointerId)
    pointerDrag.current = { taskId: task.id, pointerId: event.pointerId, overStage: undefined }
    setMoveMenuTaskId(undefined)
    setDraggingTaskId(task.id)
  }
  const updatePointerDrag = (event: React.PointerEvent<HTMLButtonElement>) => {
    const current = pointerDrag.current
    if (current === undefined || current.pointerId !== event.pointerId) return
    event.preventDefault()
    const column = document.elementFromPoint(event.clientX, event.clientY)?.closest<HTMLElement>('[data-board-stage]')
    const stage = column?.dataset.boardStage as BoardColumnId | undefined
    current.overStage = stage
    setDragOverStage(stage)
  }
  const finishPointerDrag = (task: TaskRecord, event: React.PointerEvent<HTMLButtonElement>) => {
    const current = pointerDrag.current
    if (current === undefined || current.pointerId !== event.pointerId) return
    const stage = current.overStage
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
    if (stage === undefined) clearDrag()
    else void moveTaskToStage(task, stage)
  }
  return (
    <section className="po-page po-task-page">
      <PageHeader
        title="任务"
        subtitle={`${visibleTasks.length} 个任务，${activeAgents} 个智能体工作中`}
        action={<ActionButton variant="primary" icon={<IconPlusOutline16 />} disabled={state.loading} onClick={() => model.openPanel('task-new')}>新建任务</ActionButton>}
      />
      <div className="po-toolbar">
        <div className="po-segments" role="group" aria-label="任务类型">
          <Segment active={kind === 'all'} onClick={() => setKind('all')}>全部</Segment>
          <Segment active={kind === 'code'} onClick={() => setKind('code')}>代码</Segment>
          <Segment active={kind === 'test'} onClick={() => setKind('test')}>测试</Segment>
        </div>
        <SearchField value={query} onChange={setQuery} placeholder="搜索任务、项目…" />
      </div>
      <div className={`po-board${draggingTaskId ? ' po-board-dragging' : ''}`} aria-label="任务看板">
        {BOARD_COLUMNS.map((column) => {
          const tasks = visibleTasks.filter((task) => boardColumnForTask(task) === column.id)
          const dropClass = dragOverStage === column.id ? (column.id === 'completed' ? ' po-drop-blocked' : ' po-drop-target') : ''
          return (
            <section
              key={column.id}
              className={`po-board-column po-board-${column.tone}${dropClass}`}
              data-board-stage={column.id}
              aria-label={`${column.label}，${tasks.length} 个任务`}
              onDragEnter={() => setDragOverStage(column.id)}
              onDragOver={(event) => { if (draggingTaskId !== undefined) { event.preventDefault(); event.dataTransfer.dropEffect = column.id === 'completed' ? 'none' : 'move' } }}
              onDrop={(event) => {
                event.preventDefault()
                const task = state.snapshot.tasks.find((entry) => entry.id === (draggingTaskId ?? event.dataTransfer.getData('text/plain')))
                if (task === undefined) clearDrag()
                else void moveTaskToStage(task, column.id)
              }}
            >
              <header><span className="po-column-indicator" /><strong>{column.label}</strong><span>{tasks.length}</span>{column.id === 'planned' ? <button type="button" aria-label="新建任务" onClick={() => model.openPanel('task-new')}><IconPlusOutline16 /></button> : null}</header>
              <div className="po-board-stack">
                {tasks.length === 0 ? <div className="po-column-empty">无任务</div> : tasks.map((task) => <TaskCard
                  key={task.id}
                  task={task}
                  snapshot={state.snapshot}
                  movable={canScheduleTask(state.snapshot, task)}
                  dragging={draggingTaskId === task.id}
                  menuOpen={moveMenuTaskId === task.id}
                  onClick={() => model.openTask(task.id)}
                  onToggleMenu={() => setMoveMenuTaskId((current) => current === task.id ? undefined : task.id)}
                  onDragStart={(event) => {
                    event.dataTransfer.effectAllowed = 'move'
                    event.dataTransfer.setData('text/plain', task.id)
                    setMoveMenuTaskId(undefined)
                    setDraggingTaskId(task.id)
                  }}
                  onDragEnd={clearDrag}
                  onPointerDown={(event) => beginPointerDrag(task, event)}
                  onPointerMove={updatePointerDrag}
                  onPointerUp={(event) => finishPointerDrag(task, event)}
                  onPointerCancel={clearDrag}
                  onKeyboardMove={(stage) => void moveTaskToStage(task, stage, true)}
                  onMenuMove={(stage) => void moveTaskToStage(task, stage, true)}
                />)}
              </div>
            </section>
          )
        })}
      </div>
    </section>
  )
}

function Segment({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return <button type="button" aria-pressed={active} onClick={onClick}>{children}</button>
}

function SearchField({ value, onChange, placeholder }: { value: string; onChange: (value: string) => void; placeholder: string }) {
  return <label className="po-search"><IconSearchOutline16 /><span className="po-sr-only">{placeholder}</span><input value={value} onChange={(event) => onChange(event.target.value)} placeholder={placeholder} /></label>
}

function TaskCard({ task, snapshot, movable, dragging, menuOpen, onClick, onToggleMenu, onDragStart, onDragEnd, onPointerDown, onPointerMove, onPointerUp, onPointerCancel, onKeyboardMove, onMenuMove }: {
  task: TaskRecord
  snapshot: Snapshot
  movable: boolean
  dragging: boolean
  menuOpen: boolean
  onClick: () => void
  onToggleMenu: () => void
  onDragStart: (event: React.DragEvent<HTMLElement>) => void
  onDragEnd: () => void
  onPointerDown: (event: React.PointerEvent<HTMLButtonElement>) => void
  onPointerMove: (event: React.PointerEvent<HTMLButtonElement>) => void
  onPointerUp: (event: React.PointerEvent<HTMLButtonElement>) => void
  onPointerCancel: () => void
  onKeyboardMove: (stage: BoardStage) => void
  onMenuMove: (stage: BoardStage) => void
}) {
  const agent = snapshot.agents.find((entry) => entry.id === task.agentId)
  const showStatus = ['verifying', 'failed', 'blocked', 'cancelled'].includes(task.status)
    || (task.boardStage !== undefined && task.boardStage !== defaultBoardStageForStatus(task.status))
  const currentStage = boardColumnForTask(task)
  return (
    <article className={`po-task-card po-task-card-${task.status}${dragging ? ' po-task-card-dragging' : ''}`} data-task-id={task.id} draggable={movable} onDragStart={onDragStart} onDragEnd={onDragEnd}>
      <button type="button" className="po-task-card-open" onClick={onClick}>
        <div className="po-card-code"><span>{task.kind === 'code' ? 'CODE' : 'TEST'} · {task.ordinal + 1}</span><PriorityBadge priority={task.priority ?? 'medium'} /></div>
        <strong>{task.title}</strong>
        <p>{task.description}</p>
        {(task.tags?.length ?? 0) > 0 ? <div className="po-card-tags">{task.tags?.slice(0, 3).map((tag) => <span key={tag}>{tag}</span>)}</div> : null}
        {showStatus ? <div className="po-card-status"><StatusBadge status={task.status} /></div> : null}
        <div className="po-card-project"><IconFolderOpenOutline16 />{projectName(snapshot, task.projectId)}</div>
        <footer>
          <span className="po-agent-dot">{agent?.name.slice(0, 1) ?? 'A'}</span>
          <span>{agent?.name ?? '自动分配'}</span>
          <time>{relativeDate(task.updatedAt)}</time>
        </footer>
      </button>
      {movable ? <Tooltip label="移动任务" side="top">
        <button
          type="button"
          className="po-card-drag-handle"
          aria-label={`移动任务“${task.title}”，当前在${boardStageLabel(currentStage)}；点击选择列或使用左右方向键`}
          aria-haspopup="menu"
          aria-expanded={menuOpen}
          onClick={(event) => { event.preventDefault(); onToggleMenu() }}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerCancel}
          onKeyDown={(event) => {
            if (event.key === 'Escape' && menuOpen) {
              event.preventDefault()
              event.stopPropagation()
              onToggleMenu()
              return
            }
            if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return
            event.preventDefault()
            const index = currentStage === 'completed' ? -1 : SCHEDULABLE_STAGES.indexOf(currentStage)
            const nextIndex = event.key === 'ArrowLeft' ? index - 1 : index + 1
            const next = SCHEDULABLE_STAGES[nextIndex]
            if (next !== undefined) onKeyboardMove(next)
          }}
        ><IconQueueOutline14 /></button>
      </Tooltip> : null}
      {menuOpen ? <div className="po-card-move-menu" role="menu" aria-label={`移动任务“${task.title}”`}>
        {SCHEDULABLE_STAGES.map((stage) => <button key={stage} type="button" role="menuitem" aria-current={currentStage === stage ? 'true' : undefined} onClick={() => onMenuMove(stage)}>{boardStageLabel(stage)}</button>)}
      </div> : null}
    </article>
  )
}

function ProjectsPage({ state, model }: { state: WorkbenchState; model: WorkbenchModel }) {
  const [query, setQuery] = useState('')
  if (state.selectedProjectId !== undefined) {
    const project = state.snapshot.projects.find((entry) => entry.id === state.selectedProjectId)
    if (project !== undefined) return <ProjectWorkspace project={project} state={state} model={model} />
  }
  const projects = state.snapshot.projects
    .filter((project) => `${project.name} ${project.summary} ${project.cwd} ${project.owner ?? ''}`.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()))
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
  return (
    <section className="po-page">
      <PageHeader title="项目" subtitle={`${projects.length} 个项目`} action={<ActionButton variant="primary" icon={<IconPlusOutline16 />} disabled={state.loading} onClick={() => model.openProjectForm()}>新建项目</ActionButton>} />
      <div className="po-toolbar po-project-toolbar"><SearchField value={query} onChange={setQuery} placeholder="搜索项目…" /><span className="po-toolbar-note">按最近更新排序</span></div>
      <div className="po-project-table" role="table" aria-label="项目列表">
        <div className="po-project-table-head" role="row"><span role="columnheader">名称</span><span role="columnheader">状态</span><span role="columnheader">优先级</span><span role="columnheader">审批</span><span role="columnheader">进度</span><span role="columnheader">负责人</span><span role="columnheader">创建时间</span></div>
        {projects.length === 0 ? <EmptyState title="还没有项目" body="新建项目后，可从 PRD 和技术方案拆解任务。" /> : projects.map((project) => {
          const tasks = state.snapshot.tasks.filter((task) => task.projectId === project.id)
          const completed = tasks.filter((task) => task.status === 'completed').length
          const approvalCurrent = isApprovalCurrent(state.snapshot, project)
          return (
            <button key={project.id} type="button" className="po-project-row" role="row" onClick={() => model.openProject(project.id)}>
              <span role="cell" className="po-project-name"><IconFolderOpenOutline16 /><span><strong>{project.name}</strong><small>{project.cwd}</small></span></span>
              <span role="cell"><StatusBadge status={project.status} /></span>
              <span role="cell"><PriorityBadge priority={project.priority ?? 'medium'} /></span>
              <span role="cell">{approvalCurrent ? `R${project.revision} 已批准` : `R${project.revision} 待确认`}</span>
              <span role="cell" className="po-progress-cell"><ProgressRing value={tasks.length === 0 ? 0 : completed / tasks.length} />{completed}/{tasks.length}</span>
              <span role="cell">{project.owner?.trim() || '未分配'}</span>
              <span role="cell">{formatDate(project.createdAt)}<IconChevronRightOutline14 /></span>
            </button>
          )
        })}
      </div>
    </section>
  )
}

function ProgressRing({ value }: { value: number }) {
  return <span className="po-progress-ring" style={{ '--po-progress': `${Math.round(value * 360)}deg` } as React.CSSProperties} aria-hidden="true" />
}

function ProjectWorkspace({ project, state, model }: { project: ProjectRecord; state: WorkbenchState; model: WorkbenchModel }) {
  const tasks = state.snapshot.tasks.filter((task) => task.projectId === project.id).sort((left, right) => left.ordinal - right.ordinal)
  const activeMemberships = projectMemberships(state.snapshot, project.id)
  const activeMemberAgentIds = new Set(activeMemberships.filter((member) => state.snapshot.agents.some((agent) => agent.id === member.agentId && agent.status === 'active')).map((member) => member.agentId))
  const unassignedTasks = tasks.filter((task) => task.agentId === undefined)
  const ineligibleTaskAssignments = tasks.filter((task) => task.agentId !== undefined && !activeMemberAgentIds.has(task.agentId))
  const latestRun = state.snapshot.runs.filter((run) => run.projectId === project.id).sort((left, right) => right.createdAt.localeCompare(left.createdAt))[0]
  const active = isProjectActive(project)
  const approvalCurrent = isApprovalCurrent(state.snapshot, project)
  const planHash = state.snapshot.planHashes[project.id]
  const assignmentsComplete = unassignedTasks.length === 0 && ineligibleTaskAssignments.length === 0
  const planComplete = tasks.some((task) => task.kind === 'code') && tasks.some((task) => task.kind === 'test') && tasks.every((task) => task.testCommand.trim() !== '') && assignmentsComplete
  const canApprove = project.status === 'awaiting_approval' && planComplete && planHash !== undefined && !approvalCurrent
  const canRetry = approvalCurrent && ['approved', 'failed', 'cancelled'].includes(project.status)
  const canReplan = project.prd.trim() !== '' && ['draft', 'awaiting_approval', 'approved'].includes(project.status) && latestRun === undefined
  const canAppendDecomposition = ['draft', 'awaiting_approval'].includes(project.status) && latestRun === undefined && !active
  const [appendDialogOpen, setAppendDialogOpen] = useState(false)
  const openDirectory = () => model.action(() => mutate<{ ok: true }>(`/projects/${project.id}/open-directory`, 'POST'), '已在本机文件管理器中打开项目目录。')
  const completed = tasks.filter((task) => task.status === 'completed' && task.testExitCode === 0).length
  const currentTask = latestRun?.currentTaskId ? tasks.find((task) => task.id === latestRun.currentTaskId) : undefined
  const resources = state.snapshot.resources.filter((resource) => resource.projectId === project.id)
  const issues = state.snapshot.issues.filter((issue) => issue.projectId === project.id)
  const taskRuns = state.snapshot.taskRuns.filter((run) => run.projectId === project.id)
  const activity = state.snapshot.activity.filter((event) => event.projectId === project.id).slice(0, 5)
  const inbox = state.snapshot.inbox.filter((item) => item.projectId === project.id)
  return (
    <section className="po-page po-project-detail-page">
      <PageHeader
        title={project.name}
        subtitle={project.summary || project.cwd}
        back={model.clearSelection}
        action={<details className="po-project-actions-menu"><summary>更多</summary><div><ActionButton variant="outline" icon={<IconEditOutline16 />} disabled={active || state.loading} onClick={() => model.openProjectForm(project.id)}>编辑项目</ActionButton><ActionButton variant="outline" icon={<IconTrashOutline16 />} disabled={active || state.loading} onClick={() => void deleteProject(model, project)}>删除项目</ActionButton></div></details>}
      />
      <nav className="po-project-tabs" aria-label="项目详情"><ProjectTabButton tab="overview" current={state.projectTab} onClick={model.setProjectTab}>概览</ProjectTabButton><ProjectTabButton tab="tasks" current={state.projectTab} onClick={model.setProjectTab}>任务</ProjectTabButton><ProjectTabButton tab="agents" current={state.projectTab} onClick={model.setProjectTab}>智能体</ProjectTabButton><ProjectTabButton tab="runs" current={state.projectTab} onClick={model.setProjectTab}>运行与证据</ProjectTabButton></nav>
      {state.projectTab === 'agents' ? <ProjectAgentsTab project={project} state={state} model={model} /> : null}
      {state.projectTab === 'tasks' ? <ProjectTasksTab project={project} tasks={tasks} state={state} model={model} /> : null}
      {state.projectTab === 'runs' ? <ProjectRunsTab project={project} state={state} model={model} /> : null}
      {state.projectTab === 'overview' ? <>
      <div className="po-project-summary-band">
        <div><span>状态</span><StatusBadge status={project.status} /></div>
        <div><span>优先级</span><PriorityBadge priority={project.priority ?? 'medium'} /></div>
        <div><span>负责人</span><strong>{project.owner?.trim() || '未分配'}</strong></div>
        <div><span>任务语言</span><strong>{(project.taskLanguage ?? 'zh-CN') === 'zh-CN' ? '简体中文' : 'English'}</strong></div>
        <div><span>当前版本</span><strong>Revision {project.revision}</strong></div>
        <button type="button" className="po-summary-link" onClick={() => model.setProjectTab('agents')}><span>项目智能体</span><strong title={activeMemberships.map((member) => agentName(state.snapshot, member.agentId)).join('、')}>{activeMemberships.length > 0 ? `${activeMemberships.length} 个 active 成员` : '添加智能体'}</strong></button>
        <div><span>测试进度</span><strong>{completed}/{tasks.length}</strong></div>
      </div>
       <section className="po-project-directory" aria-label="工作目录"><div className="po-directory-fact"><span>工作目录</span><strong title={project.cwd}>{project.cwd}</strong></div><div className="po-directory-actions">{project.workspaceId ? <ActionButton size="sm" variant="outline" icon={<IconPlayOutline16 />} onClick={() => model.startWorkspace(project.workspaceId!)}>打开 Workspace</ActionButton> : null}<ActionButton size="sm" variant="outline" icon={<IconFolderOpenOutline16 />} disabled={state.loading} onClick={() => void openDirectory()}>打开目录</ActionButton></div></section>
        <ProjectOrchestrationStrip project={project} state={state} model={model} />
      <ProjectSquadsPanel project={project} state={state} model={model} />
      <section className="po-project-context-grid" aria-label="项目协作上下文">
         <div className="po-context-panel"><div className="po-section-heading"><div><h2>Issues</h2><p>{issues.length} 个长期工作事项 · {taskRuns.length} 次执行</p></div></div>{issues.length === 0 ? <p className="po-context-empty">自动交付计划会逐步关联到 Issue。</p> : issues.slice(0, 4).map((issue) => <button key={issue.id} type="button" className="po-context-row po-context-row-button" onClick={() => model.openIssue(issue.id)}><strong>{issue.title}</strong><span>{issue.status} · {issue.priority}</span></button>)}</div>
         <div className="po-context-panel"><div className="po-section-heading"><div><h2>Resources</h2><p>{resources.length} 个执行资源</p></div>{inbox.length > 0 ? <ActionButton size="sm" variant="outline" onClick={() => model.setView('inbox')}>查看 {inbox.length} 个待处理</ActionButton> : null}</div>{resources.length === 0 ? <p className="po-context-empty">尚未绑定项目资源。</p> : resources.map((resource) => <ResourceRuntimeBinding key={resource.id} resource={resource} state={state} model={model} />)}{activity.length > 0 ? <div className="po-context-activity"><strong>最近活动</strong>{activity.slice(0, 3).map((event) => <span key={event.id}>{event.message}</span>)}</div> : null}</div>
       </section>
       {project.lastError ? <ProjectPlanningDiagnostic project={project} state={state} model={model} /> : null}
      <section className="po-delivery-gate po-autonomous-gate">
        <div className="po-section-heading"><div><h2>AI 交付流程</h2><p>{lifecycleDescription(project, tasks, currentTask)}</p></div><span>{approvalCurrent ? `Revision ${project.revision} 已绑定当前 plan hash` : `Revision ${project.revision} 等待确认`}</span></div>
        <ol className="po-lifecycle-stepper" aria-label="项目交付阶段">
          {(['understanding', 'planning', 'approval', 'execution', 'verification'] as const).map((phase) => <li key={phase} className={lifecyclePhaseState(project, phase)} aria-current={lifecyclePhaseState(project, phase) === 'current' ? 'step' : undefined}><span>{lifecyclePhaseIcon(phase)}</span><strong>{lifecyclePhaseLabel(phase)}</strong></li>)}
        </ol>
        {project.status === 'awaiting_approval' && planComplete ? <div className="po-approval-summary"><strong>计划结构完整</strong><span>{tasks.filter((task) => task.kind === 'code').length} 个代码任务 · {tasks.filter((task) => task.kind === 'test').length} 个测试任务 · 所有任务均已绑定项目智能体和独立测试门禁</span></div> : null}
        {project.status === 'awaiting_approval' && !assignmentsComplete ? <div className="po-intervention-panel" role="alert"><strong>计划还不能批准</strong><span>{unassignedTasks.length > 0 ? `${unassignedTasks.length} 个任务未分配执行者。` : ''}{ineligibleTaskAssignments.length > 0 ? `${ineligibleTaskAssignments.length} 个任务的执行者已不具备项目资格。` : ''}</span><ActionButton size="sm" variant="outline" onClick={() => model.setProjectTab('tasks')}>检查任务分配</ActionButton></div> : null}
        {project.status === 'failed' ? <div className="po-intervention-panel" role="alert"><strong>AI 已暂停，保留了已通过的任务</strong><span>{project.lastError || '执行未完成，请检查失败任务的测试证据。'}</span></div> : null}
        <div className="po-gate-actions">
          {canApprove ? <ActionButton variant="primary" icon={<IconCheckOutline16 />} disabled={active || state.loading} onClick={() => void approveAndExecuteProject(model, project, planHash)}>批准计划并开始实施</ActionButton> : null}
          {project.status === 'draft' && tasks.length === 0 ? <ActionButton variant="primary" icon={<IconEditOutline16 />} disabled={state.loading} onClick={() => model.openProjectForm(project.id)}>补充需求并让 AI 拆解</ActionButton> : null}
          {canAppendDecomposition && tasks.length > 0 ? <ActionButton variant="primary" icon={<IconChecklistOutline14 />} disabled={state.loading} onClick={() => setAppendDialogOpen(true)}>新增需求并拆分任务</ActionButton> : null}
          {canReplan && tasks.length > 0 ? <ActionButton variant="outline" icon={<IconChecklistOutline14 />} disabled={active || state.loading} onClick={() => void regenerateProjectPlan(model, project, 'zh-CN')}>替换当前计划</ActionButton> : null}
          {project.status === 'failed' && canRetry ? <ActionButton variant="primary" icon={<IconRefreshOutline16 />} disabled={active || state.loading} onClick={() => void retryProject(model, project)}>让 AI 修复并继续</ActionButton> : null}
          {project.status === 'cancelled' && canRetry ? <ActionButton variant="primary" icon={<IconPlayOutline16 />} disabled={active || state.loading} onClick={() => void retryProject(model, project)}>继续自动实施</ActionButton> : null}
          {active ? <ActionButton variant="outline" icon={<IconStopFill16 />} disabled={state.loading} onClick={() => void cancelProject(model, project)}>停止运行</ActionButton> : null}
        </div>
      </section>
      <div className="po-project-artifacts">
        <details className="po-artifact-disclosure" open><summary>初始需求简报</summary><div className="po-document-text">{project.prd || '尚未填写。空项目可以先手动管理任务，之后再补充需求并启动 AI 拆解。'}</div></details>
        <details className="po-artifact-disclosure"><summary>初始技术方案上下文</summary><div className="po-document-text">{project.technicalDesign || '尚未填写。'}</div></details>
        {(project.decompositionBatches ?? []).length > 0 ? <details className="po-artifact-disclosure"><summary>需求拆分批次（{project.decompositionBatches!.length}）</summary><div className="po-requirement-batches">{project.decompositionBatches!.map((batch, index) => <details key={batch.id}><summary><strong>{index + 1}. {batch.title}</strong><span>{batch.taskIds.length} 个任务</span></summary><div className="po-document-text">{batch.prd}</div>{batch.technicalDesign ? <div className="po-document-text po-document-secondary">{batch.technicalDesign}</div> : null}</details>)}</div></details> : null}
      </div>
      <section className="po-project-task-section">
        <div className="po-section-heading"><div><h2>项目任务</h2><p>{completed}/{tasks.length} 个任务测试通过</p></div>{['draft', 'failed', 'cancelled'].includes(project.status) ? <ActionButton variant="outline" size="sm" icon={<IconPlusOutline16 />} disabled={active || state.loading} onClick={() => model.openPanel('task-new')}>添加任务</ActionButton> : null}</div>
        {tasks.length === 0 ? <EmptyState title="这是一个空项目" body="现在还没有任务。你可以手动添加任务，或补充需求后明确选择让 AI 拆解。" /> : tasks.map((task) => <button key={task.id} type="button" className="po-project-task-row" onClick={() => model.openTask(task.id)}><span className="po-task-kind-mark">{task.kind === 'code' ? '代码' : '测试'}</span><span><strong>{task.title}</strong><small>{agentName(state.snapshot, task.agentId)} · {task.testCommand}</small></span><StatusBadge status={task.status} /><IconChevronRightOutline14 /></button>)}
      </section>
      {latestRun ? <RunSummary run={latestRun} snapshot={state.snapshot} /> : null}
      </> : null}
      {appendDialogOpen ? <AdditionalDecompositionDialog project={project} model={model} loading={state.loading} onClose={() => setAppendDialogOpen(false)} /> : null}
    </section>
  )
}

function ProjectTabButton({ tab, current, onClick, children }: { tab: ProjectTab; current: ProjectTab; onClick: (tab: ProjectTab) => void; children: React.ReactNode }) {
  return <button type="button" aria-current={current === tab ? 'page' : undefined} onClick={() => onClick(tab)}>{children}</button>
}

function ProjectPlanningDiagnostic({ project, state, model }: { project: ProjectRecord; state: WorkbenchState; model: WorkbenchModel }) {
  const error = project.lastError ?? ''
  const repositoryAccessBlocked = error.includes('仓库读取工具') || error.includes('仓库只读')
  const latestRun = state.snapshot.runs.filter((run) => run.projectId === project.id).sort((left, right) => right.createdAt.localeCompare(left.createdAt))[0]
  const canRetry = project.prd.trim() !== '' && ['draft', 'awaiting_approval', 'approved'].includes(project.status) && latestRun === undefined
  const title = repositoryAccessBlocked ? '规划暂未完成' : project.status === 'failed' ? '规划或执行未完成' : '项目需要处理'
  const summary = repositoryAccessBlocked
    ? '当前规划会话没有可用的仓库读取工具，因此没有生成可靠计划。项目资料和已有任务已保留。'
    : project.status === 'failed'
      ? 'AI 已暂停，已通过的任务和执行证据仍然保留。请查看详情后决定是否继续。'
      : '项目最近一次自动化操作没有完成，请查看技术详情。'
  const nextAction = repositoryAccessBlocked ? '请先确认当前 Harness 会话已启用仓库只读工具，再重新运行规划。' : '请查看技术详情，并根据当前项目状态选择下一步操作。'
  return <section className="po-project-diagnostic" role="alert"><div className="po-project-diagnostic-main"><IconWarningOutline16 /><div><strong>{title}</strong><p>{summary}</p><span>{nextAction}</span></div></div><div className="po-project-diagnostic-actions">{canRetry ? <ActionButton size="sm" variant="primary" icon={<IconRefreshOutline16 />} disabled={state.loading} onClick={() => void regenerateProjectPlan(model, project, 'zh-CN')}>重新运行规划</ActionButton> : null}{project.status === 'failed' ? <ActionButton size="sm" variant="outline" disabled={state.loading} onClick={() => model.setProjectTab('runs')}>查看运行证据</ActionButton> : null}<details><summary>技术详情</summary><pre>{error}</pre></details></div></section>
}

function ProjectOrchestrationStrip({ project, state, model }: { project: ProjectRecord; state: WorkbenchState; model: WorkbenchModel }) {
  const runs = state.snapshot.taskRuns.filter((run) => run.projectId === project.id).sort((a, b) => b.createdAt.localeCompare(a.createdAt))
  const current = runs.find((run) => ['queued', 'dispatched', 'running'].includes(run.status))
  const latest = runs[0]
  const runtime = state.snapshot.runtimes.find((item) => item.id === current?.runtimeId)
  const queued = runs.filter((run) => ['deferred', 'queued', 'dispatched'].includes(run.status)).length
  const projectIssues = state.snapshot.issues.filter((issue) => issue.projectId === project.id)
  const blocked = projectIssues.filter((issue) => issue.status === 'blocked').length
  const reviews = projectIssues.filter((issue) => issue.status === 'in_review').length
  const focusIssue = projectIssues.find((issue) => issue.status === 'in_review') ?? projectIssues.find((issue) => issue.status === 'blocked')
  const lead = project.leadAgentId ? agentName(state.snapshot, project.leadAgentId) : '未设置'
  const openQueueAndReview = () => focusIssue ? model.openIssue(focusIssue.id) : model.setProjectTab('runs')
  return <section className="po-orchestration-strip" aria-label="项目编排"><h2>项目编排</h2><button type="button" onClick={() => model.setProjectTab('agents')}><span>负责人</span><strong>{lead}</strong></button><button type="button" onClick={() => current?.taskId ? model.openTask(current.taskId) : model.setProjectTab('tasks')}><span>当前执行</span><strong>{current ? `${agentName(state.snapshot, current.agentId)} · ${taskName(state.snapshot, current.taskId)}` : '当前无执行'}</strong></button><button type="button" onClick={() => model.setView('runtimes')}><span>Runtime</span><strong>{runtime ? `${runtime.name} · ${availabilityLabel(runtime.status)}` : '本机 Harness Host'}</strong></button><button type="button" onClick={openQueueAndReview}><span>队列与审核</span><strong>{queued} 排队 · {blocked} 阻塞 · {reviews} 待审核</strong></button><button type="button" onClick={() => model.setProjectTab('runs')}><span>最近 TaskRun</span><strong>{latest ? `${latest.id.slice(0, 8)} · ${relativeDate(latest.completedAt ?? latest.createdAt)}` : '暂无运行'}</strong></button></section>
}

function ProjectSquadsPanel({ project, state, model }: { project: ProjectRecord; state: WorkbenchState; model: WorkbenchModel }) {
  const bindings = state.snapshot.projectSquadBindings.filter((binding) => binding.projectId === project.id && binding.status !== 'removed')
  const defaultBinding = bindings.find((binding) => binding.isDefault)
  const defaultSquad = state.snapshot.squads.find((squad) => squad.id === defaultBinding?.squadId)
  const reviewCount = bindings.filter((binding) => binding.status === 'needs_review' || state.snapshot.squads.find((squad) => squad.id === binding.squadId)?.updatedAt !== binding.syncedSquadUpdatedAt).length
  return <section className="po-project-squads" aria-label="项目团队编排"><div className="po-section-heading"><div><h2>团队编排</h2><p>{bindings.length === 0 ? '尚未绑定 Squad' : `${bindings.length} 个已绑定${defaultSquad ? `，默认由 ${defaultSquad.name} 编排` : ''}`}</p></div><ActionButton size="sm" variant="outline" onClick={() => model.setProjectTab('agents')}>{bindings.length === 0 ? '绑定 Squad' : '管理绑定'}</ActionButton></div>{reviewCount > 0 ? <div className="po-squad-availability-warning"><strong>{reviewCount} 个绑定需要同步</strong><p>Squad 成员或职责已经变化。同步后才能继续分派新的 Squad Issue。</p></div> : bindings.length > 0 ? <div className="po-context-row"><strong>{defaultSquad?.name ?? '未设置默认 Squad'}</strong><span>默认团队 · 成员资格由绑定同步</span></div> : null}</section>
}

function ProjectTasksTab({ project, tasks, state, model }: { project: ProjectRecord; tasks: TaskRecord[]; state: WorkbenchState; model: WorkbenchModel }) {
  const unassigned = tasks.filter((task) => !task.agentId)
  const [batchOpen, setBatchOpen] = useState(false)
  return <div className="po-project-tab-body"><div className="po-section-heading"><div><h2>项目任务</h2><p>{unassigned.length > 0 ? `${unassigned.length} 个任务需要分配执行者` : '所有任务均已明确执行者'}</p></div><div className="po-inline-actions">{unassigned.length > 0 ? <ActionButton variant="outline" onClick={() => setBatchOpen((open) => !open)}>批量分配未分配任务</ActionButton> : null}<ActionButton variant="primary" icon={<IconPlusOutline16 />} onClick={() => model.openPanel('task-new')}>添加任务</ActionButton></div></div>{batchOpen ? <BatchAssignmentPanel project={project} tasks={unassigned} state={state} model={model} onDone={() => setBatchOpen(false)} /> : null}<div className="po-member-list">{tasks.length === 0 ? <EmptyState title="这是一个空项目" body="添加任务，或从概览中明确启动 AI 拆解。" /> : tasks.map((task) => <button key={task.id} type="button" className="po-project-task-row" onClick={() => model.openTask(task.id)}><span className="po-task-kind-mark">{task.kind === 'code' ? '代码' : '测试'}</span><span><strong>{task.title}</strong><small>{task.agentId ? agentName(state.snapshot, task.agentId) : '未分配'} · {task.testCommand}</small></span><StatusBadge status={task.status} /><IconChevronRightOutline14 /></button>)}</div></div>
}

function ProjectRunsTab({ project, state, model }: { project: ProjectRecord; state: WorkbenchState; model: WorkbenchModel }) {
  const runs = state.snapshot.taskRuns.filter((run) => run.projectId === project.id).sort((a, b) => b.createdAt.localeCompare(a.createdAt))
  const artifacts = state.snapshot.artifacts.filter((artifact) => artifact.projectId === project.id)
  return <div className="po-project-tab-body"><div className="po-section-heading"><div><h2>运行与证据</h2><p>{runs.length} 次 TaskRun · {artifacts.length} 份 Artifact</p></div></div>{runs.length === 0 ? <EmptyState title="尚无运行证据" body="项目批准并执行后，Runtime、Session、测试和 Artifact 会汇总到这里。" /> : runs.map((run) => <details key={run.id} className="po-run-disclosure"><summary><strong>TaskRun {run.id.slice(0, 8)} · {taskName(state.snapshot, run.taskId)}</strong><span>{run.status} · {formatDate(run.createdAt)}</span></summary><dl><dt>智能体</dt><dd>{agentName(state.snapshot, run.agentId)}</dd><dt>Runtime</dt><dd><button type="button" className="po-link-button" onClick={() => { model.setView('runtimes'); if (run.runtimeId) window.setTimeout(() => model.openRuntime(run.runtimeId!), 0) }}>{run.runtimeNameSnapshot ?? runtimeName(state.snapshot, run.runtimeId)}</button></dd><dt>Session</dt><dd>{run.sessionId ?? '未记录'}</dd><dt>工作区</dt><dd>{run.workspace ?? run.cwd ?? '未记录'}</dd><dt>测试</dt><dd>{run.testExitCode === undefined ? '未记录' : `exit ${run.testExitCode}`}</dd><dt>证据</dt><dd>{artifacts.filter((artifact) => artifact.taskRunId === run.id).map((artifact) => artifact.name).join('、') || '暂无 Artifact'}</dd></dl></details>)}</div>
}

function ProjectSquadBindingsSection({ project, state, model }: { project: ProjectRecord; state: WorkbenchState; model: WorkbenchModel }) {
  const bindings = state.snapshot.projectSquadBindings.filter((binding) => binding.projectId === project.id && binding.status !== 'removed')
  const [availability, setAvailability] = useState<SquadAvailability[]>([])
  const [unbindingSquadId, setUnbindingSquadId] = useState<string>()
  const [replacementDefaultSquadId, setReplacementDefaultSquadId] = useState('')
  useEffect(() => { void readApi<SquadAvailability[]>(`/projects/${project.id}/eligible-squads`).then(setAvailability).catch(() => setAvailability([])) }, [project.id, state.snapshot.squads, state.snapshot.projectAgentMemberships, state.snapshot.projectSquadBindings, state.snapshot.delegations])
  const sync = async (binding: ProjectSquadBinding, syncRoles: boolean) => { const squad = state.snapshot.squads.find((item) => item.id === binding.squadId); if (!squad) return; await model.action(() => mutate(`/projects/${project.id}/squad-bindings/${binding.squadId}/sync`, 'POST', { expectedBindingUpdatedAt: binding.updatedAt, expectedSquadUpdatedAt: squad.updatedAt, syncRoles }), syncRoles ? `${squad.name} 的项目成员与 Squad 职责已同步。` : `${squad.name} 的项目成员已同步，现有项目职责已保留。`) }
  const setDefault = async (binding: ProjectSquadBinding) => { const squad = state.snapshot.squads.find((item) => item.id === binding.squadId); await model.action(() => mutate(`/projects/${project.id}/squad-bindings/${binding.squadId}/default`, 'PUT', { expectedBindingUpdatedAt: binding.updatedAt }), `${squad?.name ?? 'Squad'} 已设为默认团队。`) }
  const unbind = async (binding: ProjectSquadBinding) => {
    const squad = state.snapshot.squads.find((item) => item.id === binding.squadId)
    const otherBindings = bindings.filter((item) => item.id !== binding.id)
    if (binding.isDefault && otherBindings.length > 0 && !replacementDefaultSquadId) { setUnbindingSquadId(binding.squadId); return }
    const activeIssues = state.snapshot.issues.filter((issue) => issue.projectId === project.id && issue.assigneeType === 'squad' && issue.assigneeId === binding.squadId && !['done', 'cancelled'].includes(issue.status)).length
    const activeDelegations = state.snapshot.delegations.filter((item) => item.projectId === project.id && item.squadId === binding.squadId && ['queued', 'running', 'waiting_leader'].includes(item.status)).length
    if (!await model.confirm({ title: '解除 Squad 绑定', message: `解除 ${squad?.name ?? binding.squadId} 与项目的绑定？系统只移除该 Squad 提供的成员来源；手动成员、其他 Squad 来源、Task 和历史证据会保留。${activeIssues + activeDelegations > 0 ? ` 当前还有 ${activeIssues} 个 active Issue 和 ${activeDelegations} 个 active Delegation，服务端会拒绝解绑。` : ''}`, confirmLabel: '解除绑定', tone: 'warning' })) return
    const result = await model.action(() => mutate(`/projects/${project.id}/squad-bindings/${binding.squadId}`, 'DELETE', { expectedBindingUpdatedAt: binding.updatedAt, ...(replacementDefaultSquadId ? { replacementDefaultSquadId } : {}) }), `${squad?.name ?? 'Squad'} 已解除绑定。`)
    if (result) { setUnbindingSquadId(undefined); setReplacementDefaultSquadId('') }
  }
  return <section className="po-project-squad-bindings" data-testid="project-squad-bindings"><div className="po-section-heading"><div><h2>团队编排</h2><p>{bindings.length === 0 ? '绑定 Squad 后，Leader 和成员会自动获得项目参与资格。' : `${bindings.length} 个 Squad 已绑定，Task 仍由具体 Agent 负责。`}</p></div><ActionButton variant="primary" icon={<IconPlusOutline16 />} data-testid="bind-squad-button" onClick={() => model.openProjectSquadBinding()}>绑定 Squad</ActionButton></div>{bindings.length === 0 ? <div className="po-empty-project-note"><IconAgentPresetOutline16 /><div><strong>尚未绑定团队</strong><p>绑定不会批准项目、启动执行或自动修改 Task 分配。</p></div></div> : <div className="po-binding-list">{bindings.map((binding) => { const squad = state.snapshot.squads.find((item) => item.id === binding.squadId); if (!squad) return null; const readiness = availability.find((item) => item.squadId === binding.squadId); const needsSync = binding.status === 'needs_review' || binding.syncedSquadUpdatedAt !== squad.updatedAt; const otherBindings = bindings.filter((item) => item.id !== binding.id); return <div className="po-binding-row" data-testid={`project-squad-binding-row-${binding.squadId}`} key={binding.id}><span><strong>{squad.name}{binding.isDefault ? <em data-testid="default-squad-badge">默认</em> : null}</strong><small>Leader：{agentName(state.snapshot, squad.leaderAgentId)} · {squad.memberAgentIds.length} 名成员</small></span><span><strong className={needsSync ? 'po-state-warning' : readiness?.eligible ? 'po-state-success' : ''}>{needsSync ? '需要同步' : readiness?.eligible ? '可派发' : '暂不可用'}</strong><small>{needsSync ? 'Squad 配置已变化' : readiness ? `${readiness.availableSlots} 个空闲槽位` : '正在检查状态'}</small></span><span className="po-binding-actions">{needsSync ? <><ActionButton size="sm" variant="outline" data-testid={`sync-squad-${binding.squadId}`} onClick={() => void sync(binding, false)}>同步成员</ActionButton><ActionButton size="sm" variant="ghost" data-testid={`sync-squad-roles-${binding.squadId}`} onClick={() => void sync(binding, true)}>同步成员及职责</ActionButton></> : null}{!binding.isDefault ? <ActionButton size="sm" variant="ghost" data-testid={`set-default-squad-${binding.squadId}`} onClick={() => void setDefault(binding)}>设为默认</ActionButton> : null}<ActionButton size="sm" variant="ghost" onClick={() => { model.setView('squads'); window.setTimeout(() => model.openSquad(binding.squadId), 0) }}>查看</ActionButton><ActionButton size="sm" variant="ghost" data-testid={`unbind-squad-${binding.squadId}`} onClick={() => void unbind(binding)}>解除绑定</ActionButton></span>{unbindingSquadId === binding.squadId && binding.isDefault && otherBindings.length > 0 ? <div className="po-binding-replacement"><label><span>新的默认 Squad</span><select className="po-select" value={replacementDefaultSquadId} onChange={(event) => setReplacementDefaultSquadId(event.target.value)}><option value="">请选择</option>{otherBindings.map((item) => <option key={item.squadId} value={item.squadId}>{state.snapshot.squads.find((candidate) => candidate.id === item.squadId)?.name ?? item.squadId}</option>)}</select></label><ActionButton size="sm" variant="primary" disabled={!replacementDefaultSquadId} onClick={() => void unbind(binding)}>确认替换并解绑</ActionButton><ActionButton size="sm" variant="ghost" onClick={() => { setUnbindingSquadId(undefined); setReplacementDefaultSquadId('') }}>取消</ActionButton></div> : null}</div> })}</div>}</section>
}

function ProjectAgentsTab({ project, state, model }: { project: ProjectRecord; state: WorkbenchState; model: WorkbenchModel }) {
  const memberships = state.snapshot.projectAgentMemberships.filter((member) => member.projectId === project.id)
  const active = memberships.filter((member) => member.status === 'active')
  const removed = memberships.filter((member) => member.status === 'removed')
  const unassigned = state.snapshot.tasks.filter((task) => task.projectId === project.id && !task.agentId)
  const [adding, setAdding] = useState(active.length === 0)
  const [batchOpen, setBatchOpen] = useState(false)
  return <div className="po-project-tab-body"><ProjectSquadBindingsSection project={project} state={state} model={model} /><section className="po-project-members-section"><div className="po-section-heading"><div><h2>项目成员</h2><p>{active.length} 个 active 成员，Task 执行者只能从这里选择。</p></div><div className="po-inline-actions">{unassigned.length > 0 ? <ActionButton variant="outline" onClick={() => setBatchOpen((open) => !open)}>批量分配未分配任务</ActionButton> : null}<ActionButton variant="primary" icon={<IconPlusOutline16 />} onClick={() => setAdding((open) => !open)}>添加智能体</ActionButton></div></div>{adding ? <AddProjectAgentsPanel project={project} state={state} model={model} onDone={() => setAdding(false)} /> : null}{batchOpen ? <BatchAssignmentPanel project={project} tasks={unassigned} state={state} model={model} onDone={() => setBatchOpen(false)} /> : null}{active.length === 0 ? <EmptyState title="项目还没有成员" body="绑定 Squad 或添加智能体后，才能为任务选择执行者。" /> : <div className="po-member-list" role="table" aria-label="项目智能体列表"><div className="po-member-head" role="row"><span>智能体</span><span>项目职责</span><span>能力与来源</span><span>任务</span><span>操作</span></div>{active.map((member) => <ProjectMemberRow key={member.id} member={member} project={project} state={state} model={model} />)}</div>}{removed.length > 0 ? <details className="po-history-members"><summary>历史成员（{removed.length}）</summary>{removed.map((member) => <div key={member.id}><strong>{agentName(state.snapshot, member.agentId)}</strong><span>{member.projectRole || '未设置职责'} · {member.removedAt ? formatDate(member.removedAt) : '已移出'}</span></div>)}</details> : null}</section></div>
}

function ProjectMemberRow({ member, project, state, model }: { member: ProjectAgentMembership; project: ProjectRecord; state: WorkbenchState; model: WorkbenchModel }) {
  const agent = state.snapshot.agents.find((item) => item.id === member.agentId)
  const workload = agentWorkload(state.snapshot, member.agentId)
  const sources = state.snapshot.projectAgentMembershipSources.filter((source) => source.projectId === project.id && source.agentId === member.agentId && source.status === 'active')
  const squadSources = sources.filter((source) => source.sourceType === 'squad')
  const activeBindings = state.snapshot.projectSquadBindings.filter((binding) => binding.projectId === project.id && binding.status !== 'removed')
  const leaderBindings = activeBindings.filter((binding) => squadSources.some((source) => source.sourceId === binding.squadId) && state.snapshot.squads.find((squad) => squad.id === binding.squadId)?.leaderAgentId === member.agentId)
  const isDefaultSquadLeader = leaderBindings.some((binding) => binding.isDefault)
  const isSquadLeader = leaderBindings.length > 0
  const sourceLabel = sources.length === 0 ? '来源待迁移' : [sources.some((source) => source.sourceType === 'manual') ? '手动加入' : '', ...squadSources.map((source) => state.snapshot.squads.find((squad) => squad.id === source.sourceId)?.name ?? 'Squad'), sources.some((source) => source.sourceType === 'retained_reference') ? '引用保留' : ''].filter(Boolean).join('、')
  const tasks = state.snapshot.tasks.filter((task) => task.projectId === project.id && task.agentId === member.agentId)
  const [editing, setEditing] = useState(false)
  const [reassigning, setReassigning] = useState(false)
  const [replacementAgentId, setReplacementAgentId] = useState('')
  const [role, setRole] = useState(member.projectRole)
  const [autoAssignable, setAutoAssignable] = useState(member.autoAssignable)
  const replacements = projectMemberships(state.snapshot, project.id).filter((candidate) => candidate.agentId !== member.agentId && state.snapshot.agents.some((item) => item.id === candidate.agentId && item.status === 'active'))
  const update = async (setAsLead = false) => { const result = await model.action(() => mutate(`/projects/${project.id}/agents/${member.agentId}`, 'PUT', { projectRole: role, autoAssignable, setAsLead }), setAsLead ? '项目负责人已更新。' : '项目职责已更新。'); if (result) setEditing(false) }
  const remove = async () => { const reassignTasks = tasks.length > 0; if (reassignTasks && !replacementAgentId) { if (replacements.length === 0) model.reportError('当前没有其他 active 项目成员可接管任务，请先添加智能体。'); else setReassigning(true); return } const clearingLead = project.leadAgentId === member.agentId && !replacementAgentId; const replacementName = replacementAgentId ? agentName(state.snapshot, replacementAgentId) : ''; if (!await model.confirm({ title: '移出项目成员', message: `将 ${agent?.name ?? member.agentId} 移出项目？${reassignTasks ? `${tasks.length} 个当前计划任务会原子重新分配给 ${replacementName}，审批将失效。` : clearingLead ? '项目负责人会同时清空。' : ''}历史 TaskRun 和活动会保留。`, confirmLabel: '移出成员', tone: 'warning' })) return; const result = await model.action(() => mutate(`/projects/${project.id}/agents/${member.agentId}`, 'DELETE', { expectedMemberUpdatedAt: member.updatedAt, expectedProjectRevision: project.revision, assignedTaskPolicy: reassignTasks ? 'reassign' : 'reject', ...(replacementAgentId ? { replacementAgentId } : {}), clearLead: clearingLead }), reassignTasks ? `任务已重新分配给 ${replacementName}，原成员已移出，项目需要重新批准。` : '智能体已移出项目，历史成员记录已保留。'); if (result) setReassigning(false) }
  const leadershipLabel = [isDefaultSquadLeader ? '默认 Squad Leader' : isSquadLeader ? 'Squad Leader' : '', project.leadAgentId === member.agentId ? '项目负责人' : ''].filter(Boolean).join(' · ')
  return <div className="po-member-row" role="row"><span><strong>{agent?.name ?? member.agentId}</strong>{leadershipLabel ? <span className="po-member-leadership">{leadershipLabel}</span> : null}<small>{agent?.role || '全局角色未设置'} · {agent?.status === 'active' ? 'active' : '已归档'}</small></span><span>{editing ? <><input className="po-input" value={role} maxLength={200} onChange={(event) => setRole(event.target.value)} /><label className="po-check"><input type="checkbox" checked={autoAssignable} onChange={(event) => setAutoAssignable(event.target.checked)} />允许 AI 自动匹配</label></> : <><strong>{member.projectRole || '未设置项目职责'}</strong><small>{member.autoAssignable ? '可自动匹配' : '仅手动分配'}</small></>}</span><span><strong>{agent?.skills?.length ?? 0} Skills · {agent?.toolPolicy === 'read_only' ? '只读' : '可执行'}</strong><small>{sourceLabel || '来源待迁移'} · {workload ? `${availabilityLabel(workload.availability)} · ${workload.occupied}/${workload.maxConcurrency} 占用` : '可用性未知'}</small></span><span><strong>{tasks.filter((task) => !['completed', 'cancelled'].includes(task.status)).length}/{tasks.length}</strong><small>进行中/全部</small></span><span className="po-member-actions">{editing ? <ActionButton size="sm" variant="primary" onClick={() => void update()}>保存职责</ActionButton> : <ActionButton size="sm" variant="outline" onClick={() => setEditing(true)}>编辑职责</ActionButton>}{!isSquadLeader && project.leadAgentId !== member.agentId ? <ActionButton size="sm" variant="ghost" onClick={() => void update(true)}>设为项目负责人</ActionButton> : null}{squadSources.length > 0 ? <ActionButton size="sm" variant="ghost" disabled title="请先在团队编排中解除或同步 Squad">由 Squad 管理</ActionButton> : reassigning ? <><select className="po-select po-compact-select" aria-label="任务接管智能体" value={replacementAgentId} onChange={(event) => setReplacementAgentId(event.target.value)}><option value="">选择任务接管者</option>{replacements.map((candidate) => <option key={candidate.agentId} value={candidate.agentId}>{agentName(state.snapshot, candidate.agentId)}</option>)}</select><ActionButton size="sm" variant="primary" disabled={!replacementAgentId} onClick={() => void remove()}>重新分配并移出</ActionButton><ActionButton size="sm" variant="ghost" onClick={() => { setReassigning(false); setReplacementAgentId('') }}>取消</ActionButton></> : <ActionButton size="sm" variant="ghost" onClick={() => void remove()}>移出项目</ActionButton>}</span></div>
}

function AddProjectAgentsPanel({ project, state, model, onDone, initialAgentId }: { project: ProjectRecord; state: WorkbenchState; model: WorkbenchModel; onDone: () => void; initialAgentId?: string }) {
  const [query, setQuery] = useState('')
  const existing = new Set(projectMemberships(state.snapshot, project.id).map((member) => member.agentId))
  const candidates = state.snapshot.agents.filter((agent) => !existing.has(agent.id) && `${agent.name} ${agent.role} ${(agent.skills ?? []).join(' ')}`.toLocaleLowerCase().includes(query.toLocaleLowerCase()))
  const remainingSlots = Math.max(0, 100 - existing.size)
  const [selected, setSelected] = useState<Record<string, { projectRole: string; autoAssignable: boolean }>>(() => initialAgentId && remainingSlots > 0 ? { [initialAgentId]: { projectRole: state.snapshot.agents.find((agent) => agent.id === initialAgentId)?.role ?? '', autoAssignable: true } } : {})
  const selectedCount = Object.keys(selected).length
  const toggle = (agent: AgentRecord) => setSelected((current) => current[agent.id] ? Object.fromEntries(Object.entries(current).filter(([id]) => id !== agent.id)) : Object.keys(current).length >= remainingSlots ? current : { ...current, [agent.id]: { projectRole: agent.role, autoAssignable: true } })
  const submit = async () => { const members = Object.entries(selected).map(([agentId, value]) => ({ agentId, ...value })); if (members.length === 0) return; const result = await model.action(() => members.length === 1 ? mutate(`/projects/${project.id}/agents`, 'POST', { ...members[0], expectedProjectRevision: project.revision }) : mutate(`/projects/${project.id}/agents/batch`, 'POST', { members, expectedProjectRevision: project.revision }), `${members.length} 个智能体已加入项目。`); if (result) onDone() }
  return <section className="po-add-members-panel" aria-labelledby="po-add-members-title"><div className="po-section-heading"><div><h3 id="po-add-members-title">添加项目智能体</h3><p>不会调用 AI，也不会创建任务或使现有审批失效。每个项目最多 100 个 active 成员，当前还可添加 {remainingSlots} 个。</p></div><ActionButton variant="ghost" size="sm" onClick={onDone}>取消</ActionButton></div><SearchField value={query} onChange={setQuery} placeholder="搜索名称、角色或 Skill" /><div className="po-agent-picker">{candidates.length === 0 ? <p>没有可加入的 active 智能体。</p> : candidates.map((agent) => { const chosen = selected[agent.id]; const workload = agentWorkload(state.snapshot, agent.id); return <div key={agent.id} className={`po-agent-picker-row${agent.status !== 'active' ? ' po-disabled' : ''}`}><label><input type="checkbox" disabled={agent.status !== 'active' || (chosen === undefined && selectedCount >= remainingSlots)} checked={chosen !== undefined} onChange={() => toggle(agent)} /><span><strong>{agent.name}</strong><small>{agent.role} · {agent.skills?.length ?? 0} Skills · {workload ? availabilityLabel(workload.availability) : '状态未知'}{agent.status !== 'active' ? ' · 已归档，不可加入' : ''}</small></span></label>{chosen ? <div className="po-picker-config"><input className="po-input" aria-label={`${agent.name} 的项目职责`} value={chosen.projectRole} maxLength={200} onChange={(event) => setSelected((current) => ({ ...current, [agent.id]: { ...chosen, projectRole: event.target.value } }))} /><label className="po-check"><input type="checkbox" checked={chosen.autoAssignable} onChange={(event) => setSelected((current) => ({ ...current, [agent.id]: { ...chosen, autoAssignable: event.target.checked } }))} />允许 AI 自动匹配</label></div> : null}</div> })}</div><div className="po-panel-actions"><ActionButton variant="primary" disabled={selectedCount === 0 || selectedCount > remainingSlots || state.loading} onClick={() => void submit()}>添加 {Object.keys(selected).length} 个智能体</ActionButton></div></section>
}

function BatchAssignmentPanel({ project, tasks, state, model, onDone }: { project: ProjectRecord; tasks: TaskRecord[]; state: WorkbenchState; model: WorkbenchModel; onDone: () => void }) {
  const members = projectMemberships(state.snapshot, project.id).filter((member) => state.snapshot.agents.find((agent) => agent.id === member.agentId)?.status === 'active')
  const [assignments, setAssignments] = useState<Record<string, string>>({})
  const submit = async () => { const payload = tasks.map((task) => ({ taskId: task.id, agentId: assignments[task.id] })).filter((item): item is { taskId: string; agentId: string } => Boolean(item.agentId)); if (payload.length !== tasks.length) return; const result = await model.action(() => mutate(`/projects/${project.id}/task-assignments`, 'POST', { expectedRevision: project.revision, assignments: payload }), `${payload.length} 个任务已在一次 revision 中完成分配。`); if (result) onDone() }
  return <section className="po-batch-panel"><div className="po-section-heading"><div><h3>批量分配未分配任务</h3><p>全部校验通过后一次写入，只增加一次 Project revision。</p></div><ActionButton size="sm" variant="ghost" onClick={onDone}>取消</ActionButton></div>{members.length === 0 ? <div className="po-empty-project-note"><IconWarningOutline16 /><div><strong>先添加项目智能体</strong><p>当前项目没有 active 成员，任务不能分配工作区外的智能体。</p></div></div> : tasks.map((task) => <label key={task.id} className="po-batch-row"><span><strong>{task.title}</strong><small>{task.kind === 'code' ? '代码任务' : '测试任务'}</small></span><select className="po-select" value={assignments[task.id] ?? ''} onChange={(event) => setAssignments((current) => ({ ...current, [task.id]: event.target.value }))}><option value="">选择执行者</option>{members.map((member) => <option key={member.agentId} value={member.agentId}>{agentName(state.snapshot, member.agentId)} · {member.projectRole || '未设置职责'}</option>)}</select></label>)}<div className="po-panel-actions"><ActionButton variant="primary" disabled={tasks.length === 0 || tasks.some((task) => !assignments[task.id])} onClick={() => void submit()}>分配 {tasks.length} 个任务</ActionButton></div></section>
}

function AdditionalDecompositionDialog({ project, model, loading, onClose }: { project: ProjectRecord; model: WorkbenchModel; loading: boolean; onClose: () => void }) {
  const [title, setTitle] = useState('')
  const [prd, setPrd] = useState('')
  const [technicalDesign, setTechnicalDesign] = useState('')
  const [taskLanguage, setTaskLanguage] = useState<TaskLanguage>(project.taskLanguage ?? 'zh-CN')
  const [error, setError] = useState<string>()
  const submit = async () => {
    if (!title.trim() || !prd.trim()) { setError('请填写需求标题和需求文档。'); return }
    const result = await model.action(() => mutate<ProjectRecord>(`/projects/${project.id}/decompositions`, 'POST', { title, prd, technicalDesign, taskLanguage }), '新增需求已提交，AI 正在追加任务拆分。')
    if (result) onClose()
  }
  return <div className="po-modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}>
    <section className="po-modal po-modal-wide" role="dialog" aria-modal="true" aria-labelledby="po-add-decomposition-title">
      <header><div><h2 id="po-add-decomposition-title">新增需求并拆分任务</h2><p>这次拆分会追加到当前 Project，已有任务和需求批次不会被删除。</p></div><button type="button" className="po-icon-button" aria-label="关闭" onClick={onClose}><IconCloseOutline16 /></button></header>
      {error ? <div className="po-inline-error"><IconWarningOutline16 />{error}</div> : null}
      <div className="po-modal-body"><label className="po-field"><span className="po-label">需求标题</span><input className="po-input" value={title} onChange={(event) => setTitle(event.target.value)} placeholder="例如：增加权限审计" /></label><label className="po-field"><span className="po-label">需求文档</span><textarea className="po-textarea po-textarea-tall" value={prd} onChange={(event) => setPrd(event.target.value)} placeholder="描述这一批需求、边界和验收目标" /></label><label className="po-field"><span className="po-label">技术方案上下文（可选）</span><textarea className="po-textarea" value={technicalDesign} onChange={(event) => setTechnicalDesign(event.target.value)} placeholder="补充实现约束、接口或测试要求" /></label><label className="po-field"><span className="po-label">任务语言</span><select className="po-select" value={taskLanguage} onChange={(event) => setTaskLanguage(event.target.value as TaskLanguage)}><option value="zh-CN">简体中文</option><option value="en">English</option></select></label></div>
      <footer><ActionButton variant="ghost" onClick={onClose}>取消</ActionButton><ActionButton variant="primary" disabled={loading} onClick={() => void submit()}>提交并追加拆分</ActionButton></footer>
    </section>
  </div>
}

function AgentsPage({ state, model }: { state: WorkbenchState; model: WorkbenchModel }) {
  const [filter, setFilter] = useState<'all' | 'unassigned' | 'working' | 'archived'>('all')
  if (state.panel === 'agent-start') return <AgentBuilderStart model={model} />
  if (state.panel === 'agent-manual') return <AgentManualPage state={state} model={model} />
  if (state.panel === 'agent-ai') return <AgentAiPage state={state} model={model} />
  const selected = state.snapshot.agents.find((agent) => agent.id === state.selectedAgentId)
  if (state.panel === 'agent-edit' && selected) return <AgentManualPage state={state} model={model} agent={selected} />
  if (selected) return <AgentProfile agent={selected} state={state} model={model} />
  return (
    <section className="po-page">
      <PageHeader title="智能体" subtitle={`${state.snapshot.agents.length} 个可复用执行角色`} action={<ActionButton variant="primary" icon={<IconPlusOutline16 />} disabled={state.loading} onClick={() => model.openPanel('agent-start')}>创建智能体</ActionButton>} />
      <div className="po-toolbar"><div className="po-segments" role="group" aria-label="筛选智能体"><Segment active={filter === 'all'} onClick={() => setFilter('all')}>全部</Segment><Segment active={filter === 'unassigned'} onClick={() => setFilter('unassigned')}>未加入项目</Segment><Segment active={filter === 'working'} onClick={() => setFilter('working')}>当前工作中</Segment><Segment active={filter === 'archived'} onClick={() => setFilter('archived')}>已归档</Segment></div></div>
      <div className="po-agent-list">
        {state.snapshot.agents.filter((agent) => { const projectCount = agentMemberships(state.snapshot, agent.id).length; const workload = agentWorkload(state.snapshot, agent.id); return filter === 'all' || (filter === 'unassigned' && projectCount === 0) || (filter === 'working' && (workload?.occupied ?? 0) > 0) || (filter === 'archived' && agent.status === 'archived') }).map((agent) => {
          const assigned = state.snapshot.tasks.filter((task) => task.agentId === agent.id)
          const workload = agentWorkload(state.snapshot, agent.id)
          const memberships = agentMemberships(state.snapshot, agent.id)
          return <button key={agent.id} type="button" className="po-agent-row" onClick={() => model.openAgent(agent.id)}><span className="po-agent-avatar">{agent.name.slice(0, 1)}</span><span><strong>{agent.name}</strong><small>{agent.description || agent.role}</small></span><span className="po-agent-role">{agent.role}</span><span>{workload ? `${availabilityLabel(workload.availability)} · ${workloadLabel(workload.workload)}` : '状态未知'}<small>{workload ? `${workload.occupied}/${workload.maxConcurrency} 占用 · ${workload.queued} 排队` : `${assigned.length} 个任务`}</small></span><span>{memberships.length > 0 ? `${memberships.length} 个项目 · ${assigned.length} 个任务` : '尚未加入项目'}</span><IconChevronRightOutline14 /></button>
        })}
      </div>
    </section>
  )
}

function AgentBuilderStart({ model }: { model: WorkbenchModel }) {
  const resumable = hasStoredAgentBuilderDraft()
  return (
    <section className="po-page po-builder-start">
      <PageHeader title="创建智能体" subtitle="选择创建方式" back={model.closePanel} />
      <div className="po-builder-intro"><h2>先说明目标，再决定细节</h2><p>AI 会先起草一个可工作的版本，你可以边聊边调整配置。</p></div>
      <div className="po-builder-options">
        <button type="button" className="po-builder-option-recommended" onClick={() => model.openPanel('agent-ai')}><span><IconSendOutline16 /></span><small>{resumable ? '有未完成草稿' : '推荐'}</small><strong>{resumable ? '继续 AI 草稿' : '与 AI 一起创建'}</strong><p>从一句需求开始，获得可读反馈、完整 Instructions 和实时配置。</p><em>{resumable ? '继续编辑' : '开始对话'} <IconChevronRightOutline14 /></em></button>
        <button type="button" onClick={() => model.openPanel('agent-manual')}><span><IconEditOutline16 /></span><strong>手动创建</strong><p>直接填写核心配置，能力和运行设置按需展开。</p><em>打开配置 <IconChevronRightOutline14 /></em></button>
      </div>
    </section>
  )
}

type AgentFormValue = Omit<AgentDraft, 'provider' | 'model' | 'skills' | 'runtimeId' | 'access' | 'maxConcurrency'> & { provider: string; model: string; skillsText: string; runtimeId: string; access: 'only_me' | 'workspace' | 'specific_people'; maxConcurrency: number }
type StudioPane = 'conversation' | 'configuration'
type AgentFormField = keyof AgentFormValue
interface BuilderTurn extends AgentBuilderMessage {
  id: string
  assumptions?: string[]
  warnings?: string[]
  reuseRecommendation?: { agentId: string; reason: string }
  openQuestions?: string[]
  changedFields?: string[]
  protectedFields?: AgentFormField[]
  proposal?: AgentFormValue
}
interface StoredAgentBuilderDraft {
  value: AgentFormValue
  turns: BuilderTurn[]
  dirtyFields: AgentFormField[]
  prompt: string
  updatedAt: number
}
const EMPTY_AGENT: AgentFormValue = { name: '', role: '', description: '', persona: '', provider: '', model: '', preset: 'standard', toolPolicy: 'full', skillsText: '', runtimeId: '', access: 'only_me', maxConcurrency: 1 }
const AGENT_BUILDER_STORAGE_KEY = 'project-orchestrator:agent-builder-draft:v2'
const PROJECT_INTAKE_STORAGE_KEY = 'project-orchestrator:project-intake-draft:v2'
const PROJECT_INTAKE_LEGACY_STORAGE_KEY = 'project-orchestrator:project-intake-draft:v1'
const PROJECT_INTAKE_DRAFT_TTL_MS = 30 * 60 * 1_000
const AGENT_PROMPT_TEMPLATES = [
  { label: '代码审查', prompt: '创建一个代码审查智能体。它需要识别业务回归、边界条件和缺失测试，引用具体证据，并给出按严重程度排序的结论。' },
  { label: '任务拆解', prompt: '创建一个工程任务规划智能体。它需要把 PRD 和技术方案拆成依赖清晰的代码任务与测试任务，并为每项任务定义可执行的验收门禁。' },
  { label: '研究分析', prompt: '创建一个研究分析智能体。它需要区分事实、推断和待验证假设，保留来源，并输出结论、风险和下一步验证建议。' },
  { label: '测试设计', prompt: '创建一个测试设计智能体。它需要从需求和实现中识别关键路径、失败路径与边界条件，并产出可自动化的测试方案。' },
]

function AgentManualPage({ state, model, agent }: { state: WorkbenchState; model: WorkbenchModel; agent?: AgentRecord }) {
  const [value, setValue] = useState<AgentFormValue>(agent ? agentValue(agent) : EMPTY_AGENT)
  const submit = async (event: React.FormEvent) => {
    event.preventDefault()
    const payload = agentPayload(value)
    const result = await model.action(
      () => agent === undefined ? mutate<AgentRecord>('/agents', 'POST', payload) : mutate<AgentRecord>(`/agents/${agent.id}`, 'PUT', payload),
      agent === undefined ? '智能体已创建。' : '智能体已更新。',
    )
    if (result) {
      model.closePanel()
      model.openAgent(result.id)
    }
  }
  return (
    <section className="po-page po-agent-builder-page">
      <PageHeader title={agent ? '编辑智能体' : '创建智能体'} subtitle="手动配置" back={agent ? model.closePanel : () => model.openPanel('agent-start')} backLabel={agent ? '返回智能体' : '返回创建方式'} />
      <form className="po-agent-manual-form" onSubmit={(event) => void submit(event)}>
        <div className="po-agent-config"><AgentFields value={value} runtimes={state.snapshot.runtimes} runtimeEditable={agent === undefined} onChange={setValue} /></div>
        <div className="po-config-footer"><ActionButton type="button" variant="ghost" onClick={agent ? model.closePanel : () => model.openPanel('agent-start')}>取消</ActionButton><ActionButton type="submit" variant="primary" disabled={!validAgent(value)}>{agent ? '保存智能体' : '创建智能体'}</ActionButton></div>
      </form>
    </section>
  )
}

function AgentAiPage({ state, model }: { state: WorkbenchState; model: WorkbenchModel }) {
  const stored = useMemo(() => loadAgentBuilderDraft(), [])
  const [value, setValue] = useState<AgentFormValue>(stored?.value ?? { ...EMPTY_AGENT })
  const [prompt, setPrompt] = useState(stored?.prompt ?? '')
  const [turns, setTurns] = useState<BuilderTurn[]>(stored?.turns ?? [])
  const [dirtyFields, setDirtyFields] = useState<Set<AgentFormField>>(() => new Set(stored?.dirtyFields ?? []))
  const [pendingPrompt, setPendingPrompt] = useState('')
  const [generating, setGenerating] = useState(false)
  const [localError, setLocalError] = useState<string>()
  const [activePane, setActivePane] = useState<StudioPane>('conversation')
  const [mobileStudio, setMobileStudio] = useState(() => window.matchMedia('(max-width: 760px)').matches)
  const historyEnd = useRef<HTMLDivElement>(null)
  const hasDraft = hasAgentDraftContent(value) || turns.length > 0 || prompt.trim() !== ''
  useEffect(() => {
    if (!hasDraft) {
      window.localStorage.removeItem(AGENT_BUILDER_STORAGE_KEY)
      return
    }
    const storedDraft: StoredAgentBuilderDraft = { value, turns: turns.slice(-40), dirtyFields: [...dirtyFields], prompt, updatedAt: Date.now() }
    window.localStorage.setItem(AGENT_BUILDER_STORAGE_KEY, JSON.stringify(storedDraft))
  }, [dirtyFields, hasDraft, prompt, turns, value])
  useEffect(() => {
    const query = window.matchMedia('(max-width: 760px)')
    const update = () => setMobileStudio(query.matches)
    query.addEventListener('change', update)
    return () => query.removeEventListener('change', update)
  }, [])
  useEffect(() => { historyEnd.current?.scrollIntoView({ block: 'nearest' }) }, [generating, turns])
  const updateDraft = (next: AgentFormValue) => {
    setDirtyFields((current) => new Set([...current, ...changedAgentFieldKeys(value, next)]))
    setValue(next)
  }
  const generate = async () => {
    const requirement = prompt.trim()
    if (generating || requirement === '') return
    setGenerating(true)
    setLocalError(undefined)
    setPendingPrompt(requirement)
    setPrompt('')
    try {
      const existingDraft = hasAgentDraftContent(value) ? agentContextPayload(value) : undefined
      const response = await mutate<AgentBuilderResponse>('/agents/draft', 'POST', {
        requirement,
        messages: turns.slice(-30).map(({ role, content }) => ({ role, content })),
        ...(existingDraft ? { existingDraft } : {}),
      })
      const generatedValue = agentValue(response)
      const protectedFields = [...dirtyFields].filter((field) => value[field] !== generatedValue[field])
      const nextValue = mergeGeneratedAgent(value, generatedValue, dirtyFields)
      const turnTime = Date.now()
      const userTurn: BuilderTurn = { id: `user-${turnTime}`, role: 'user', content: requirement }
      const assistantTurn: BuilderTurn = {
        id: `assistant-${turnTime}`,
        role: 'assistant',
        content: response.feedback,
        assumptions: response.assumptions,
        warnings: response.warnings,
        ...(response.reuseRecommendation === undefined ? {} : { reuseRecommendation: response.reuseRecommendation }),
        openQuestions: response.openQuestions,
        changedFields: changedAgentFields(value, nextValue),
        ...(protectedFields.length > 0 ? { protectedFields, proposal: generatedValue } : {}),
      }
      setValue(nextValue)
      setTurns((current) => [...current, userTurn, assistantTurn].slice(-40))
    } catch (error) {
      setPrompt(requirement)
      setLocalError(messageOf(error))
    } finally {
      setPendingPrompt('')
      setGenerating(false)
    }
  }
  const applyProposal = (turn: BuilderTurn) => {
    if (!turn.proposal || !turn.protectedFields?.length) return
    setValue((current) => applyAgentFields(current, turn.proposal as AgentFormValue, turn.protectedFields ?? []))
    setDirtyFields((current) => new Set([...current].filter((field) => !turn.protectedFields?.includes(field))))
    setTurns((current) => current.map((entry) => {
      if (entry.id !== turn.id) return entry
      const updated: BuilderTurn = { ...entry, changedFields: [...new Set([...(entry.changedFields ?? []), ...turn.protectedFields!.map(agentFieldLabel)])] }
      delete updated.protectedFields
      delete updated.proposal
      return updated
    }))
  }
  const create = async () => {
    const result = await model.action(() => mutate<AgentRecord>('/agents', 'POST', agentPayload(value)), '智能体已创建。')
    if (result) {
      window.localStorage.removeItem(AGENT_BUILDER_STORAGE_KEY)
      model.closePanel()
      model.openAgent(result.id)
    }
  }
  const discard = async () => {
    if (hasDraft && !await model.confirm({ title: '放弃智能体草稿', message: '当前智能体草稿和对话尚未保存，放弃后无法恢复。', confirmLabel: '放弃草稿', tone: 'warning' })) return
    window.localStorage.removeItem(AGENT_BUILDER_STORAGE_KEY)
    model.openPanel('agent-start')
  }
  const handleTabKey = (event: React.KeyboardEvent<HTMLButtonElement>, next: StudioPane) => {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return
    event.preventDefault()
    setActivePane(next)
    window.requestAnimationFrame(() => document.getElementById(`po-studio-${next}-tab`)?.focus())
  }
  return (
    <section className="po-page po-agent-builder-page">
      <PageHeader title="创建智能体" subtitle="Agent Creation Studio" back={() => model.openPanel('agent-start')} backLabel="保存草稿并返回" />
      {mobileStudio ? <div className="po-studio-pane-tabs" role="tablist" aria-label="智能体创建视图">
        <button id="po-studio-conversation-tab" type="button" role="tab" tabIndex={activePane === 'conversation' ? 0 : -1} aria-selected={activePane === 'conversation'} aria-controls="po-studio-conversation" onKeyDown={(event) => handleTabKey(event, 'configuration')} onClick={() => setActivePane('conversation')}>对话</button>
        <button id="po-studio-configuration-tab" type="button" role="tab" tabIndex={activePane === 'configuration' ? 0 : -1} aria-selected={activePane === 'configuration'} aria-controls="po-studio-configuration" onKeyDown={(event) => handleTabKey(event, 'conversation')} onClick={() => setActivePane('configuration')}>配置{validAgent(value) ? <IconCheckOutline16 /> : null}</button>
      </div> : null}
      <div className="po-agent-builder-layout po-agent-studio">
        <div id="po-studio-conversation" role={mobileStudio ? 'tabpanel' : undefined} aria-labelledby={mobileStudio ? 'po-studio-conversation-tab' : undefined} hidden={mobileStudio && activePane !== 'conversation'} className={`po-agent-chat po-studio-pane${activePane === 'conversation' ? ' po-studio-pane-active' : ''}`}>
          <div className="po-builder-chat-title"><div><strong>Agent Builder</strong><span>描述目标，继续对话即可调整右侧草稿</span></div><span className="po-online-dot">运行时在线</span></div>
          <div className="po-chat-history" aria-live="polite">
            {turns.length === 0 && pendingPrompt === '' ? <div className="po-chat-empty"><IconAgentPresetOutline16 /><h2>你希望它完成什么？</h2><p>先说结果、工作方式或不能触碰的边界，其余配置由 Builder 起草。</p><div className="po-prompt-examples">{AGENT_PROMPT_TEMPLATES.map((template) => <button key={template.label} type="button" onClick={() => setPrompt(template.prompt)}>{template.label}</button>)}</div></div> : null}
            {turns.map((turn) => turn.role === 'user'
              ? <div key={turn.id} className="po-chat-user">{turn.content}</div>
              : <AssistantBrief key={turn.id} turn={turn} onQuestion={setPrompt} onApplyProposal={() => applyProposal(turn)} />)}
            {pendingPrompt ? <><div className="po-chat-user">{pendingPrompt}</div><div className="po-chat-agent po-generating" role="status"><IconRefreshOutline16 /><span>正在理解目标并更新草稿…</span></div></> : null}
            <div ref={historyEnd} />
          </div>
          {localError ? <div className="po-inline-error" role="alert"><IconWarningOutline16 />{localError}</div> : null}
          <label className="po-chat-composer"><span className="po-sr-only">继续描述或修改智能体</span><textarea value={prompt} onChange={(event) => setPrompt(event.target.value)} placeholder={turns.length === 0 ? '例如：审查后端 API，优先发现业务回归和缺失测试…' : '继续调整，例如：改成只读，并把输出固定为审查清单…'} onKeyDown={(event) => { if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) void generate() }} /><button type="button" aria-label={turns.length === 0 ? '生成智能体草稿' : '更新智能体草稿'} disabled={generating || prompt.trim() === ''} onClick={() => void generate()}>{generating ? <IconRefreshOutline16 /> : <IconSendOutline16 />}</button></label>
        </div>
        <aside id="po-studio-configuration" role={mobileStudio ? 'tabpanel' : undefined} aria-labelledby={mobileStudio ? 'po-studio-configuration-tab' : undefined} hidden={mobileStudio && activePane !== 'configuration'} className={`po-agent-config po-studio-pane${activePane === 'configuration' ? ' po-studio-pane-active' : ''}`}><AgentFields value={value} runtimes={state.snapshot.runtimes} onChange={updateDraft} /></aside>
      </div>
      <div className="po-studio-footer"><span>{hasDraft ? '草稿已自动保存在此浏览器' : '先描述目标或直接编辑配置'}</span><div><ActionButton variant="ghost" onClick={discard}>放弃草稿</ActionButton><ActionButton variant="primary" disabled={!validAgent(value) || generating} onClick={() => void create()}>创建智能体</ActionButton></div></div>
    </section>
  )
}

function AssistantBrief({ turn, onQuestion, onApplyProposal }: { turn: BuilderTurn; onQuestion: (question: string) => void; onApplyProposal: () => void }) {
  return (
    <div className="po-chat-agent">
      <div className="po-assistant-heading"><span className="po-agent-dot">AI</span><strong>Builder</strong></div>
      <p>{turn.content}</p>
      {(turn.changedFields?.length ?? 0) > 0 ? <div className="po-assistant-section"><span>已更新</span><p>{turn.changedFields?.join('、')}</p></div> : null}
      {(turn.protectedFields?.length ?? 0) > 0 ? <div className="po-assistant-section po-protected-changes"><span>手动修改已保留</span><p>Builder 建议同时修改 {turn.protectedFields?.map(agentFieldLabel).join('、')}，当前仍以你的版本为准。</p><button type="button" onClick={onApplyProposal}>应用 Builder 建议</button></div> : null}
      {turn.reuseRecommendation ? <div className="po-assistant-section"><span>复用建议</span><p>{turn.reuseRecommendation.reason}</p></div> : null}
      {(turn.warnings?.length ?? 0) > 0 ? <div className="po-assistant-section po-assistant-warnings"><span>配置诊断</span><ul>{turn.warnings?.map((item) => <li key={item}>{item}</li>)}</ul></div> : null}
      {(turn.assumptions?.length ?? 0) > 0 ? <div className="po-assistant-section"><span>当前假设</span><ul>{turn.assumptions?.map((item) => <li key={item}>{item}</li>)}</ul></div> : null}
      {(turn.openQuestions?.length ?? 0) > 0 ? <div className="po-assistant-section"><span>建议确认</span><div className="po-question-actions">{turn.openQuestions?.map((question) => <button key={question} type="button" onClick={() => onQuestion(question)}>{question}</button>)}</div></div> : null}
    </div>
  )
}

function AgentFields({ value, runtimes, runtimeEditable = true, onChange }: { value: AgentFormValue; runtimes: RuntimeRecord[]; runtimeEditable?: boolean; onChange: (value: AgentFormValue) => void }) {
  const skills = parseList(value.skillsText)
  return (
    <div className="po-config-scroll">
      <div className="po-config-heading"><div><h2>实时草稿</h2><span className={validAgent(value) ? 'po-config-ready' : ''}>{validAgent(value) ? '可以创建' : '还需名称和 Instructions'}</span></div><p>AI 更新与手动修改使用同一份配置。</p></div>
      <section className="po-config-section" aria-labelledby="po-agent-identity"><div className="po-config-section-heading"><h3 id="po-agent-identity">身份</h3><p>列表中如何识别和选择它。</p></div><Field label="名称"><input className="po-input" required value={value.name} onChange={(event) => onChange({ ...value, name: event.target.value })} placeholder="例如：API 回归审查员" /></Field><Field label="一句话描述"><textarea className="po-textarea" maxLength={500} value={value.description} onChange={(event) => onChange({ ...value, description: event.target.value })} placeholder="说明它在什么场景下提供什么结果" /><small className="po-field-hint">{value.description.length}/500</small></Field></section>
      <section className="po-config-section" aria-labelledby="po-agent-behavior"><div className="po-config-section-heading"><h3 id="po-agent-behavior">Instructions</h3><p>真正交给智能体执行的职责、步骤和质量标准。</p></div><Field label="执行指令"><textarea className="po-textarea po-instructions-editor" required value={value.persona} onChange={(event) => onChange({ ...value, persona: event.target.value })} placeholder={'# 职责\n\n# 工作方式\n\n# 输出契约\n\n# 质量门禁\n\n# 边界与升级'} /></Field></section>
      <details className="po-config-disclosure"><summary><span><strong>能力与权限</strong><small>{skills.length} Skills · {value.toolPolicy === 'full' ? '可执行' : '只读'}</small></span><IconChevronRightOutline14 /></summary><div className="po-config-disclosure-body"><Field label="Skills"><textarea className="po-textarea" value={value.skillsText} onChange={(event) => onChange({ ...value, skillsText: event.target.value })} placeholder="每行一个能力，例如：\nAPI contract review\ntest evidence" />{skills.length > 0 ? <div className="po-skill-chips">{skills.map((skill) => <span key={skill}>{skill}</span>)}</div> : null}</Field><div className="po-field"><span className="po-label">工具权限</span><div className="po-choice-group" role="radiogroup" aria-label="工具权限"><button type="button" role="radio" aria-checked={value.toolPolicy === 'full'} onClick={() => onChange({ ...value, toolPolicy: 'full' })}><strong>可执行</strong><span>允许按任务使用 Harness 工具</span></button><button type="button" role="radio" aria-checked={value.toolPolicy === 'read_only'} onClick={() => onChange({ ...value, toolPolicy: 'read_only' })}><strong>只读</strong><span>仅分析、检索和审查</span></button></div></div></div></details>
      <details className="po-config-disclosure"><summary><span><strong>运行设置</strong><small>{value.runtimeId ? runtimes.find((runtime) => runtime.id === value.runtimeId)?.name ?? 'Runtime 不可用' : '本机默认环境'} · {value.maxConcurrency} 并发</small></span><IconChevronRightOutline14 /></summary><div className="po-config-disclosure-body"><Field label="内部角色"><input className="po-input" value={value.role} onChange={(event) => onChange({ ...value, role: event.target.value })} placeholder="未填写时使用智能体名称" /></Field><div className="po-field-pair"><Field label="Runtime"><select className="po-select" value={value.runtimeId} disabled={!runtimeEditable} aria-describedby={!runtimeEditable ? 'po-runtime-binding-help' : undefined} onChange={(event) => onChange({ ...value, runtimeId: event.target.value })}><option value="">本机默认环境</option>{runtimes.map((runtime) => <option key={runtime.id} value={runtime.id}>{runtime.name}（{availabilityLabel(runtime.status)}）</option>)}</select>{!runtimeEditable ? <small id="po-runtime-binding-help" className="po-field-help">请从智能体详情使用“绑定 Runtime”复核影响后变更。</small> : null}</Field><Field label="最大并发"><input className="po-input" type="number" min={1} max={32} value={value.maxConcurrency} onChange={(event) => onChange({ ...value, maxConcurrency: Math.min(32, Math.max(1, Number(event.target.value) || 1)) })} /></Field></div><div className="po-field-pair"><Field label="访问范围"><select className="po-select" value={value.access} onChange={(event) => onChange({ ...value, access: event.target.value as AgentFormValue['access'] })}><option value="only_me">仅自己</option><option value="workspace">工作区</option><option value="specific_people">指定成员</option></select></Field><Field label="Preset"><input className="po-input" value={value.preset} onChange={(event) => onChange({ ...value, preset: event.target.value })} placeholder="standard" /></Field></div><div className="po-field-pair"><Field label="Provider"><input className="po-input" value={value.provider} onChange={(event) => onChange({ ...value, provider: event.target.value })} placeholder="使用默认" /></Field><Field label="Model"><input className="po-input" value={value.model} onChange={(event) => onChange({ ...value, model: event.target.value })} placeholder="使用默认" /></Field></div></div></details>
    </div>
  )
}

function AgentProfile({ agent, state, model }: { agent: AgentRecord; state: WorkbenchState; model: WorkbenchModel }) {
  const assigned = state.snapshot.tasks.filter((task) => task.agentId === agent.id)
  const workload = agentWorkload(state.snapshot, agent.id)
  const runtime = agent.runtimeId === undefined ? undefined : state.snapshot.runtimes.find((candidate) => candidate.id === agent.runtimeId)
  const memberships = agentMemberships(state.snapshot, agent.id)
  const [joining, setJoining] = useState(false)
  const [bindingRuntime, setBindingRuntime] = useState(false)
  const [targetProjectId, setTargetProjectId] = useState(state.snapshot.projects.find((project) => !isProjectActive(project) && !memberships.some((member) => member.projectId === project.id))?.id ?? '')
  const targetProject = state.snapshot.projects.find((project) => project.id === targetProjectId)
  return (
    <section className="po-page">
      <PageHeader title={agent.name} subtitle={agent.description || agent.role} back={model.clearSelection} action={<><ActionButton variant="primary" icon={<IconProjectAddOutline16 />} disabled={agent.status !== 'active'} onClick={() => setJoining((open) => !open)}>加入项目</ActionButton><ActionButton variant="outline" onClick={() => setBindingRuntime((open) => !open)}>绑定 Runtime</ActionButton><ActionButton variant="outline" icon={<IconEditOutline16 />} onClick={() => model.openPanel('agent-edit')}>编辑智能体</ActionButton><ActionButton variant="outline" icon={<IconTrashOutline16 />} disabled={assigned.length > 0 || memberships.length > 0} onClick={() => void deleteAgent(model, agent)}>删除智能体</ActionButton></>} />
      {bindingRuntime ? <AgentRuntimeBindingPanel agent={agent} state={state} model={model} close={() => setBindingRuntime(false)} /> : null}
      {joining ? <section className="po-agent-join-panel"><div className="po-section-heading"><div><h2>加入项目</h2><p>加入后，才能在该项目的任务计划中被选择。</p></div><ActionButton size="sm" variant="ghost" onClick={() => setJoining(false)}>取消</ActionButton></div><select className="po-select" value={targetProjectId} onChange={(event) => setTargetProjectId(event.target.value)}><option value="">选择非运行中项目</option>{state.snapshot.projects.filter((project) => !isProjectActive(project) && !memberships.some((member) => member.projectId === project.id)).map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}</select>{targetProject ? <AddProjectAgentsPanel project={targetProject} state={state} model={model} initialAgentId={agent.id} onDone={() => setJoining(false)} /> : null}</section> : null}
      <div className="po-agent-profile-grid">
        <div className="po-agent-profile-main"><span className="po-agent-avatar po-agent-avatar-large">{agent.name.slice(0, 1)}</span><h2>{agent.role}</h2><p>{agent.persona}</p></div>
        <dl className="po-agent-facts"><dt>可用性</dt><dd>{availabilityLabel(workload?.availability ?? 'unknown')}</dd><dt>工作负载</dt><dd>{workload ? `${workloadLabel(workload.workload)}，占用 ${workload.occupied}/${workload.maxConcurrency}，排队 ${workload.queued}` : '暂无统计'}</dd><dt>Runtime</dt><dd>{runtime ? `${runtime.name} · ${availabilityLabel(runtime.status)}` : `本机默认环境 · ${availabilityLabel(state.snapshot.runtimeOverview.defaultHost.status)}`}</dd><dt>生命周期</dt><dd>{agent.status === 'active' ? '使用中' : '已归档'}</dd><dt>访问范围</dt><dd>{accessLabel(agent.access ?? 'only_me')}</dd><dt>Preset</dt><dd>{agent.preset}</dd><dt>Skills</dt><dd>{agent.skills?.join('、') || '未设置'}</dd><dt>模型</dt><dd>{agent.provider && agent.model ? `${agent.provider} / ${agent.model}` : 'Harness 默认模型'}</dd><dt>工具权限</dt><dd>{agent.toolPolicy === 'full' ? '完整工具' : '只读工具'}</dd><dt>分配任务</dt><dd>{assigned.length}</dd></dl>
      </div>
      <section className="po-project-task-section"><div className="po-section-heading"><div><h2>参与项目</h2><p>{memberships.length > 0 ? `${memberships.length} 个 active 项目成员关系` : '尚未加入项目'}</p></div></div>{memberships.length === 0 ? <EmptyState title="尚未加入项目" body="加入项目后，才能在该项目的任务计划中被选择。" /> : memberships.map((membership) => { const project = state.snapshot.projects.find((item) => item.id === membership.projectId); const taskCount = assigned.filter((task) => task.projectId === membership.projectId).length; return <button key={membership.id} type="button" className="po-project-membership-link" onClick={() => { model.setView('projects'); window.setTimeout(() => model.openProject(membership.projectId, 'agents'), 0) }}><span><strong>{project?.name ?? membership.projectId}{project?.leadAgentId === agent.id ? ' · 负责人' : ''}</strong><small>{membership.projectRole || '未设置项目职责'} · {taskCount} 个任务</small></span><StatusBadge status={project?.status ?? 'draft'} /><IconChevronRightOutline14 /></button> })}</section>
      <section className="po-project-task-section"><div className="po-section-heading"><h2>已分配任务</h2></div>{assigned.length === 0 ? <EmptyState title="暂无任务" body="拆解或编辑任务时可以选择这个智能体。" /> : assigned.map((task) => <button key={task.id} type="button" className="po-project-task-row" onClick={() => { model.setView('tasks'); window.setTimeout(() => model.openTask(task.id), 0) }}><span className="po-task-kind-mark">{task.kind === 'code' ? '代码' : '测试'}</span><span><strong>{task.title}</strong><small>{projectName(state.snapshot, task.projectId)}</small></span><StatusBadge status={task.status} /><IconChevronRightOutline14 /></button>)}</section>
    </section>
  )
}

function AgentRuntimeBindingPanel({ agent, state, model, close }: { agent: AgentRecord; state: WorkbenchState; model: WorkbenchModel; close: () => void }) {
  const [runtimeId, setRuntimeId] = useState(agent.runtimeId ?? 'default')
  const [impact, setImpact] = useState<AgentRuntimeImpact>()
  const [acknowledge, setAcknowledge] = useState(false)
  const [error, setError] = useState<string>()
  useEffect(() => { setImpact(undefined); setAcknowledge(false); setError(undefined); void readApi<AgentRuntimeImpact>(`/agents/${agent.id}/runtime-impact?runtimeId=${encodeURIComponent(runtimeId)}`).then(setImpact).catch((reason) => setError(messageOf(reason))) }, [agent.id, runtimeId])
  const invalidates = impact?.affectedProjects.some((project) => project.approvalWillInvalidate) ?? false
  const blocked = (impact?.executableTaskRunIds.length ?? 0) > 0
  const bind = async () => { if (!impact) return; const result = await model.action(() => mutate(`/agents/${agent.id}/runtime`, 'PUT', { runtimeId: runtimeId === 'default' ? null : runtimeId, expectedTargetUpdatedAt: agent.updatedAt, expectedProjectRevisions: Object.fromEntries(impact.affectedProjects.map((project) => [project.projectId, project.revision])), acknowledgeApprovalInvalidation: acknowledge }), 'Agent Runtime 已更新。'); if (result) close() }
  return <section className="po-agent-join-panel"><div className="po-section-heading"><div><h2>绑定 Runtime</h2><p>变更会重置受影响任务证据；已有审批可能失效。</p></div><ActionButton size="sm" variant="ghost" onClick={close}>取消</ActionButton></div><Field label="目标 Runtime"><select className="po-select" value={runtimeId} onChange={(event) => setRuntimeId(event.target.value)}><option value="default">本机默认环境</option>{state.snapshot.runtimes.filter((runtime) => runtime.lifecycle === 'active').map((runtime) => <option key={runtime.id} value={runtime.id}>{runtime.name} · {availabilityLabel(runtime.status)}</option>)}</select></Field>{error ? <div className="po-inline-error"><IconWarningOutline16 />{error}</div> : null}{impact ? <div className="po-impact-summary"><strong>{impact.affectedProjects.length} 个项目受影响</strong><span>{impact.executableTaskRunIds.length} 个可执行 TaskRun</span>{impact.affectedProjects.map((project) => <div key={project.projectId}>{projectName(state.snapshot, project.projectId)} · Revision {project.revision}{project.approvalWillInvalidate ? ' · 审批将失效' : ''}</div>)}</div> : <p className="po-context-empty">正在检查影响范围…</p>}{invalidates ? <label className="po-check"><input type="checkbox" checked={acknowledge} onChange={(event) => setAcknowledge(event.target.checked)} />我了解这些项目的现有审批将失效，需要重新批准。</label> : null}{blocked ? <div className="po-inline-error"><IconWarningOutline16 />Agent 仍有可执行 TaskRun，请先完成或停止执行。</div> : null}<div className="po-panel-actions"><ActionButton variant="primary" disabled={!impact || blocked || (invalidates && !acknowledge) || state.loading} onClick={() => void bind()}>确认绑定 Runtime</ActionButton></div></section>
}

function ResourceRuntimeBinding({ resource, state, model }: { resource: ProjectResource; state: WorkbenchState; model: WorkbenchModel }) {
  const [runtimeId, setRuntimeId] = useState(resource.runtimeId ?? 'default')
  const bind = async () => { await model.action(() => mutate(`/resources/${resource.id}/runtime`, 'PUT', { runtimeId: runtimeId === 'default' ? null : runtimeId, expectedTargetUpdatedAt: resource.updatedAt }), 'Project Resource Runtime 已更新。') }
  return <div className="po-resource-binding"><strong>{resource.location}</strong><select className="po-select" aria-label={`${resource.location} 的 Runtime`} value={runtimeId} onChange={(event) => setRuntimeId(event.target.value)}><option value="default">本机默认环境</option>{state.snapshot.runtimes.filter((runtime) => runtime.lifecycle === 'active').map((runtime) => <option key={runtime.id} value={runtime.id}>{runtime.name}</option>)}</select><ActionButton size="sm" variant="outline" disabled={state.loading || runtimeId === (resource.runtimeId ?? 'default')} onClick={() => void bind()}>保存绑定</ActionButton></div>
}

function GlobalConfirmDialog({ request, onResolve }: { request: DialogRequest; onResolve: (confirmed: boolean) => void }) {
  const dialogRef = useRef<HTMLElement>(null)
  const resolveRef = useRef(onResolve)
  resolveRef.current = onResolve
  useEffect(() => {
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : undefined
    const focusable = () => [...(dialogRef.current?.querySelectorAll<HTMLElement>('button:not(:disabled), [tabindex]:not([tabindex="-1"])') ?? [])]
    const initial = window.setTimeout(() => focusable()[0]?.focus(), 0)
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); resolveRef.current(false); return }
      if (event.key !== 'Tab') return
      const candidates = focusable()
      if (candidates.length === 0) return
      const first = candidates[0]!
      const last = candidates[candidates.length - 1]!
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus() }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus() }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => { window.clearTimeout(initial); window.removeEventListener('keydown', onKeyDown); if (previousFocus?.isConnected) previousFocus.focus() }
  }, [])
  const tone = request.tone ?? 'default'
  return <div className="po-confirm-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onResolve(false) }}><section ref={dialogRef} className={`po-confirm-dialog po-confirm-${tone}`} role="alertdialog" aria-modal="true" aria-labelledby="po-confirm-title" aria-describedby="po-confirm-message"><div className="po-confirm-icon"><IconWarningOutline16 /></div><div className="po-confirm-content"><h2 id="po-confirm-title">{request.title}</h2><p id="po-confirm-message">{request.message}</p><div className="po-confirm-actions"><ActionButton variant="ghost" onClick={() => onResolve(false)}>{request.cancelLabel ?? '取消'}</ActionButton><ActionButton variant={tone === 'danger' ? 'danger' : 'primary'} onClick={() => onResolve(true)}>{request.confirmLabel ?? '确认'}</ActionButton></div></div></section></div>
}

function ModalShell({ title, subtitle, close, children, footer, wide = false }: { title: string; subtitle?: string; close: () => void; children: React.ReactNode; footer: React.ReactNode; wide?: boolean }) {
  const dialogRef = useRef<HTMLElement>(null)
  const closeRef = useRef(close)
  closeRef.current = close
  useEffect(() => {
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : undefined
    const focusable = () => [...(dialogRef.current?.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), textarea:not(:disabled), select:not(:disabled), details > summary, [href], [tabindex]:not([tabindex="-1"])') ?? [])].filter((element) => element.offsetParent !== null)
    const initial = window.setTimeout(() => (dialogRef.current?.querySelector<HTMLElement>('[autofocus]') ?? focusable()[0])?.focus(), 0)
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); closeRef.current(); return }
      if (event.key !== 'Tab') return
      const candidates = focusable()
      if (candidates.length === 0) { event.preventDefault(); dialogRef.current?.focus(); return }
      const first = candidates[0]!
      const last = candidates[candidates.length - 1]!
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus() }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus() }
      else if (!dialogRef.current?.contains(document.activeElement)) { event.preventDefault(); first.focus() }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => {
      window.clearTimeout(initial)
      window.removeEventListener('keydown', onKeyDown)
      if (previousFocus?.isConnected) previousFocus.focus()
    }
  }, [])
  return (
    <div className="po-modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) close() }}>
      <section ref={dialogRef} tabIndex={-1} className={`po-modal${wide ? ' po-modal-wide' : ''}`} role="dialog" aria-modal="true" aria-label={title}>
        <header><div><h2>{title}</h2>{subtitle ? <p>{subtitle}</p> : null}</div><button type="button" className="po-icon-button" aria-label="关闭" onClick={close}><IconCloseOutline16 /></button></header>
        <div className="po-modal-body">{children}</div>
        <footer>{footer}</footer>
      </section>
    </div>
  )
}

type ProjectCreationMode = 'empty' | 'ai'
type ProjectSourceKind = 'local_directory' | 'github_repo'

interface ProjectIntakeValue {
  mode: ProjectCreationMode
  sourceKind: ProjectSourceKind
  repositoryUrl: string
  repositoryRef: string
  issueNumbers: number[]
  name: string
  summary: string
  priority: Priority
  owner: string
  cwd: string
  prd: string
  technicalDesign: string
  taskLanguage: TaskLanguage
}

type StoredProjectIntakeValue = Pick<ProjectIntakeValue, 'mode' | 'sourceKind' | 'repositoryRef' | 'issueNumbers' | 'name' | 'summary' | 'priority' | 'owner' | 'taskLanguage'>
interface StoredProjectIntakeDraft {
  value: StoredProjectIntakeValue
  updatedAt: number
}

function ProjectDialog({ state, model, project }: { state: WorkbenchState; model: WorkbenchModel; project?: ProjectRecord | undefined }) {
  const stored = project === undefined ? loadProjectIntakeDraft() : undefined
  const [value, setValue] = useState<ProjectIntakeValue>(() => project ? {
    mode: project.prd.trim() === '' ? 'empty' : 'ai', sourceKind: 'local_directory', repositoryUrl: '', repositoryRef: '', issueNumbers: [], name: project.name, summary: project.summary, priority: project.priority ?? 'medium', owner: project.owner ?? '', cwd: project.cwd, prd: project.prd, technicalDesign: project.technicalDesign, taskLanguage: project.taskLanguage ?? 'zh-CN',
  } : stored ?? { mode: 'empty', sourceKind: 'local_directory', repositoryUrl: '', repositoryRef: '', issueNumbers: [], name: '', summary: '', priority: 'medium', owner: '', cwd: '', prd: '', technicalDesign: '', taskLanguage: 'zh-CN' })
  const [nameLocked, setNameLocked] = useState(Boolean(project?.name || stored?.name))
  const [repository, setRepository] = useState<RepositoryInspection>()
  const [repositoryBusy, setRepositoryBusy] = useState(false)
  const [directoryBrowserOpen, setDirectoryBrowserOpen] = useState(false)
  const [directoryListing, setDirectoryListing] = useState<DirectoryListing>()
  const [directoryBusy, setDirectoryBusy] = useState(false)
  const [directoryError, setDirectoryError] = useState<string>()
  const [importError, setImportError] = useState<string>()
  const [importStatus, setImportStatus] = useState<string>()
  const [importWarnings, setImportWarnings] = useState<string[]>([])
  const [importBusy, setImportBusy] = useState(false)
  const [appendImport, setAppendImport] = useState(false)
  const importInput = useRef<HTMLInputElement>(null)
  const importTarget = useRef<'prd' | 'technicalDesign'>('prd')
  const importRequest = useRef<AbortController>()
  const repositoryRequest = useRef<{ id: number; controller: AbortController } | undefined>(undefined)
  const repositoryRequestVersion = useRef(0)
  useEffect(() => {
    if (project === undefined) persistProjectIntakeDraft(value)
  }, [project, value])
  useEffect(() => () => {
    repositoryRequest.current?.controller.abort()
    importRequest.current?.abort()
  }, [])
  const setBrief = (prd: string) => setValue((current) => ({ ...current, prd, name: nameLocked ? current.name : suggestProjectName(prd) }))
  const applyImportedText = (text: string, target: 'prd' | 'technicalDesign') => {
    setValue((current) => {
      const existing = target === 'prd' ? current.prd : current.technicalDesign
      const imported = appendImport && existing.trim() !== '' ? `${existing.trim()}\n\n${text.trim()}` : text.trim()
      if (target === 'technicalDesign') return { ...current, technicalDesign: imported }
      return { ...current, prd: imported, name: nameLocked ? current.name : suggestProjectName(imported) }
    })
  }
  const readFile = async (file: File | undefined, target: 'prd' | 'technicalDesign') => {
    if (!file || importBusy) return
    const isPdf = file.type === 'application/pdf' || file.name.toLocaleLowerCase().endsWith('.pdf')
    if (!isPdf) {
      if (file.size > 1_000_000) { setImportError('文本文件超过 1 MB，请直接粘贴需要规划的内容。'); return }
      try {
        applyImportedText(await file.text(), target)
        setImportError(undefined)
        setImportWarnings([])
        setImportStatus(`已导入 ${file.name}。`)
      } catch {
        setImportError('无法读取文本文件，请直接粘贴内容。')
      }
      return
    }
    if (file.size > MAX_PDF_BYTES) { setImportError('PDF 超过 15 MB，请压缩或拆分后再导入。'); return }

    const controller = new AbortController()
    importRequest.current?.abort()
    importRequest.current = controller
    setImportBusy(true)
    setImportError(undefined)
    setImportWarnings([])
    setImportStatus(`正在打开 ${file.name}…`)
    try {
      const parsed = await parsePdfImport(file, controller.signal, setImportStatus)
      throwIfAborted(controller.signal)
      setImportStatus('正在让 AI 归纳文档内容…')
      const result = await mutate<RequirementImportResult>('/requirements/import', 'POST', {
        fileName: file.name,
        documentKind: target === 'prd' ? 'prd' : 'technical_design',
        ...parsed,
        warnings: undefined,
      }, controller.signal)
      if (importRequest.current !== controller) return
      applyImportedText(result.markdown, target)
      setImportWarnings([...parsed.warnings, ...result.warnings])
      setImportStatus(`已解析 ${result.pageCount} 页，并生成${target === 'prd' ? '需求文档' : '技术方案草稿'}。`)
    } catch (error) {
      if (importRequest.current !== controller) return
      if (controller.signal.aborted) {
        setImportStatus('已停止解析。')
        return
      }
      const message = error instanceof Error ? error.message : 'PDF 解析失败。'
      const passwordProtected = error instanceof Error && (error.name === 'PasswordException' || /password/i.test(error.message))
      setImportError(passwordProtected ? 'PDF 受密码保护，请解锁后再导入。' : message)
      setImportStatus(undefined)
    } finally {
      if (importRequest.current === controller) {
        importRequest.current = undefined
        setImportBusy(false)
      }
    }
  }
  const saveAndClose = () => {
    importRequest.current?.abort()
    if (project === undefined) persistProjectIntakeDraft(value)
    model.closePanel()
  }
  const browseDirectory = async (path?: string) => {
    setDirectoryBrowserOpen(true)
    setDirectoryBusy(true)
    setDirectoryError(undefined)
    try {
      setDirectoryListing(await model.listDirectory(path))
    } catch (error) {
      setDirectoryError(error instanceof Error ? error.message : '无法读取目录。')
    } finally {
      setDirectoryBusy(false)
    }
  }
  const chooseDirectory = async () => {
    setImportError(undefined)
    try {
      const path = await model.pickDirectory()
      if (path !== null) setValue((current) => ({ ...current, cwd: path }))
    } catch {
      await browseDirectory()
    }
  }
  const selectBrowsedDirectory = () => {
    if (!directoryListing) return
    setValue((current) => ({ ...current, cwd: directoryListing.path }))
    setDirectoryBrowserOpen(false)
    setDirectoryListing(undefined)
  }
  const inspectRepository = async () => {
    const repositoryUrl = value.repositoryUrl.trim()
    if (!repositoryUrl) return
    repositoryRequest.current?.controller.abort()
    const requestId = ++repositoryRequestVersion.current
    const controller = new AbortController()
    repositoryRequest.current = { id: requestId, controller }
    setRepositoryBusy(true)
    setImportError(undefined)
    try {
      const inspected = await mutate<RepositoryInspection>('/repositories/inspect', 'POST', { repositoryUrl }, controller.signal)
      if (repositoryRequestVersion.current !== requestId || controller.signal.aborted) return
      setRepository(inspected)
      setValue((current) => ({ ...current, repositoryUrl: inspected.repositoryUrl, repositoryRef: inspected.defaultBranch, name: current.name || inspected.name, issueNumbers: [] }))
    } catch (error) {
      if (controller.signal.aborted || repositoryRequestVersion.current !== requestId) return
      setRepository(undefined)
      setImportError(error instanceof Error ? error.message : '无法读取 GitHub 仓库。')
    } finally {
      if (repositoryRequestVersion.current === requestId) {
        repositoryRequest.current = undefined
        setRepositoryBusy(false)
      }
    }
  }
  const submit = async (planWithAi = value.mode === 'ai') => {
    const name = value.name.trim() || suggestProjectName(value.prd) || repository?.name || '未命名项目'
    const { mode, sourceKind, repositoryUrl, repositoryRef, issueNumbers, ...editable } = value
    const source = sourceKind === 'local_directory'
      ? { kind: 'local_directory' as const, path: editable.cwd }
      : { kind: 'github_repo' as const, repositoryUrl, ref: repositoryRef, issueNumbers }
    const result = await model.action(async () => {
      if (project === undefined) return mutate<ProjectRecord>('/projects', 'POST', { ...editable, cwd: undefined, name, mode, source })
      if (!planWithAi) return mutate<ProjectRecord>(`/projects/${project.id}`, 'PUT', { ...editable, name })
      return mutate<ProjectRecord>(`/projects/${project.id}/replan`, 'POST', { taskLanguage: editable.taskLanguage, project: { ...editable, name } })
    }, project === undefined
      ? mode === 'empty' ? '空项目已创建，没有调用 AI 或生成任务。' : '项目已创建，AI 正在生成执行计划。'
      : planWithAi ? '项目已更新并重新规划，原审批已失效。' : '项目资料已保存，没有调用 AI。')
    if (result) {
      if (project === undefined) clearProjectIntakeDraft()
      model.closePanel()
      model.openProject(result.id)
      try {
        const workspace = await model.ensureWorkspace(result.cwd)
        const linked = await mutate<ProjectRecord>(`/projects/${result.id}/workspace`, 'POST', { workspaceId: workspace.workspaceId })
        await model.refresh(true)
        model.openProject(linked.id)
        model.reportNotice('项目已创建并关联 DeepSeek Harness Workspace。')
      } catch (error) {
        model.reportError(`项目已创建，但 Workspace 关联失败：${messageOf(error)}`)
      }
    }
  }
  const footer = project === undefined ? <>
    <ActionButton variant="ghost" onClick={saveAndClose}>保存草稿并关闭</ActionButton>
    <ActionButton variant="primary" disabled={state.loading || importBusy || !validProject(value, value.mode === 'ai')} onClick={() => void submit()}>{value.mode === 'empty' ? '创建空项目' : '创建并让 AI 拆解'}</ActionButton>
  </> : <>
    <ActionButton variant="ghost" onClick={saveAndClose}>取消</ActionButton>
    <ActionButton variant="outline" disabled={state.loading || importBusy || !validProject(value, false)} onClick={() => void submit(false)}>仅保存</ActionButton>
    <ActionButton variant="primary" disabled={state.loading || importBusy || !validProject(value, true)} onClick={() => void submit(true)}>保存并让 AI 重新规划</ActionButton>
  </>
  return (
    <ModalShell title={project ? '编辑项目' : '创建项目'} subtitle={project ? '保存资料不会自动调用 AI；只有选择重新规划时才会生成并替换任务计划。' : '先选择创建方式。空项目不会调用 AI，也不会自动生成任务。'} close={saveAndClose} wide footer={footer}>
      <div className="po-project-intake">
        {project === undefined ? <><fieldset className="po-project-mode"><legend>创建方式</legend><label className={value.mode === 'empty' ? 'po-project-mode-option po-project-mode-option-selected' : 'po-project-mode-option'}><input type="radio" name="project-mode" value="empty" checked={value.mode === 'empty'} onChange={() => setValue({ ...value, mode: 'empty' })} /><span><strong>空项目</strong><small>保存仓库与项目资料，不调用 AI。可以从 GitHub Issues 导入长期事项。</small></span></label><label className={value.mode === 'ai' ? 'po-project-mode-option po-project-mode-option-selected' : 'po-project-mode-option'}><input type="radio" name="project-mode" value="ai" checked={value.mode === 'ai'} onChange={() => setValue({ ...value, mode: 'ai' })} /><span><strong>AI 智能拆解</strong><small>克隆或读取仓库，基于需求与所选 Issues 生成代码和测试任务。</small></span></label></fieldset><fieldset className="po-project-mode po-project-source-mode"><legend>代码来源</legend><label className={value.sourceKind === 'local_directory' ? 'po-project-mode-option po-project-mode-option-selected' : 'po-project-mode-option'}><input type="radio" name="project-source" value="local_directory" checked={value.sourceKind === 'local_directory'} onChange={() => setValue({ ...value, sourceKind: 'local_directory' })} /><span><strong>本地代码仓库</strong><small>从本机选择已有目录，路径仍会由 Host 重新校验。</small></span></label><label className={value.sourceKind === 'github_repo' ? 'po-project-mode-option po-project-mode-option-selected' : 'po-project-mode-option'}><input type="radio" name="project-source" value="github_repo" checked={value.sourceKind === 'github_repo'} onChange={() => setValue({ ...value, sourceKind: 'github_repo' })} /><span><strong>GitHub 仓库</strong><small>读取分支与开放 Issues，创建时浅克隆到 Harness 受管目录。</small></span></label></fieldset></> : null}
        <div className="po-form-grid"><Field label="项目名称" hint={value.mode === 'empty' ? '空项目必须填写名称。' : '可留空，系统会根据需求或仓库生成。'}><input className="po-input" autoFocus={!project} required={value.mode === 'empty'} value={value.name} onChange={(event) => { setNameLocked(true); setValue({ ...value, name: event.target.value }) }} placeholder="例如：支付网关重构" /></Field>{project !== undefined || value.sourceKind === 'local_directory' ? <Field label="本地代码仓库" hint={value.mode === 'ai' ? 'AI 会只读检查该目录；执行仍需人工批准。' : '创建时只记录目录，不读取代码。'}><div className="po-directory-control"><input className="po-input" required readOnly={project === undefined} value={value.cwd} onChange={(event) => setValue({ ...value, cwd: event.target.value })} placeholder="点击右侧按钮选择目录" /><ActionButton type="button" variant="outline" icon={<IconFolderOpenOutline16 />} onClick={() => void chooseDirectory()}>选择目录</ActionButton></div></Field> : <Field label="GitHub 仓库地址" hint="首版仅支持不含凭据的 https://github.com/owner/repo 地址。"><div className="po-directory-control"><input className="po-input" type="url" required value={value.repositoryUrl} onChange={(event) => { repositoryRequestVersion.current += 1; repositoryRequest.current?.controller.abort(); repositoryRequest.current = undefined; setRepositoryBusy(false); setRepository(undefined); setValue({ ...value, repositoryUrl: event.target.value, repositoryRef: '', issueNumbers: [] }) }} placeholder="https://github.com/owner/repository" /><ActionButton type="button" variant="outline" disabled={repositoryBusy || !value.repositoryUrl.trim()} onClick={() => void inspectRepository()}>{repositoryBusy ? '读取中…' : '读取仓库'}</ActionButton></div></Field>}</div>
        {project === undefined && value.sourceKind === 'github_repo' && repository ? <section className="po-repository-import" aria-label="GitHub 仓库导入设置"><div className="po-form-grid"><Field label="拉取分支" hint={`默认分支：${repository.defaultBranch}`}><select className="po-select" value={value.repositoryRef} onChange={(event) => setValue({ ...value, repositoryRef: event.target.value })}>{repository.branches.map((branch) => <option key={branch.name} value={branch.name}>{branch.name}{branch.protected ? '（受保护）' : ''}</option>)}</select></Field><div className="po-repository-summary"><strong>{repository.owner}/{repository.name}</strong><span>{repository.branches.length} 个分支 · {repository.issues.length} 个开放 Issue</span></div></div><fieldset className="po-issue-picker"><legend>从 Issues 自动创建事项（可选）</legend>{repository.issues.length === 0 ? <p>该仓库没有可导入的开放 Issue。</p> : <div>{repository.issues.map((issue) => <label key={issue.number}><input type="checkbox" checked={value.issueNumbers.includes(issue.number)} onChange={(event) => setValue((current) => ({ ...current, issueNumbers: event.target.checked ? [...current.issueNumbers, issue.number] : current.issueNumbers.filter((number) => number !== issue.number) }))} /><span><strong>#{issue.number} {issue.title}</strong><small>{issue.labels.join(', ') || '无标签'}</small></span></label>)}</div>}</fieldset></section> : null}
        {value.mode === 'ai' || project !== undefined ? <><Field label="交付目标与约束" hint="只有点击“让 AI 规划”时才会提交给 Planner。"><textarea className="po-textarea po-brief-editor" required={value.mode === 'ai'} value={value.prd} onChange={(event) => setBrief(event.target.value)} placeholder="描述结果、范围、规则和验收标准；支持 Markdown。" /></Field><div className="po-intake-file-actions"><span>{value.prd.length.toLocaleString()} 字符</span><label className="po-import-append"><input type="checkbox" checked={appendImport} onChange={(event) => setAppendImport(event.target.checked)} />追加到现有内容</label><button type="button" disabled={importBusy} onClick={() => { importTarget.current = 'prd'; importInput.current?.click() }}>导入需求文件</button><button type="button" disabled={importBusy} onClick={() => { importTarget.current = 'technicalDesign'; importInput.current?.click() }}>导入技术方案</button><input ref={importInput} type="file" accept=".md,.markdown,.txt,.text,.pdf,application/pdf" hidden aria-label="导入 PDF、Markdown 或文本文件" onChange={(event) => { void readFile(event.target.files?.[0], importTarget.current); event.currentTarget.value = '' }} /></div><p className="po-import-disclosure">PDF 会在浏览器中转换为文字和页面图像，再发送给当前 AI 模型归纳；导入本身不会保存项目或启动规划。</p>{importStatus ? <div className="po-import-status" role="status" aria-live="polite">{importBusy ? <IconRefreshOutline16 /> : <IconCheckOutline16 />}<span>{importStatus}</span>{importBusy ? <button type="button" onClick={() => importRequest.current?.abort()}>停止解析</button> : null}</div> : null}{importWarnings.length > 0 ? <div className="po-import-warnings" role="note">{importWarnings.map((warning) => <span key={warning}><IconWarningOutline16 />{warning}</span>)}</div> : null}</> : <div className="po-empty-project-note"><IconFolderOpenOutline16 /><div><strong>不会自动拆任务</strong><p>创建后项目状态为“待规划”，任务数量为 0。你可以直接添加手动任务，或编辑项目补充需求后再启动 AI。</p></div></div>}
        {importError ? <div className="po-inline-error" role="alert"><IconWarningOutline16 />{importError}</div> : null}
        {directoryBrowserOpen ? <DirectoryBrowser listing={directoryListing} busy={directoryBusy} error={directoryError} navigate={browseDirectory} select={selectBrowsedDirectory} close={() => { setDirectoryBrowserOpen(false); setDirectoryListing(undefined) }} /> : null}
        <details className="po-project-constraints"><summary>补充项目资料（可选）</summary><div className="po-project-constraints-body"><Field label="项目摘要"><textarea className="po-textarea" value={value.summary} onChange={(event) => setValue({ ...value, summary: event.target.value })} placeholder="用于项目列表和详情页的简短说明。" /></Field>{value.mode === 'ai' || project !== undefined ? <Field label="技术方案上下文" hint="可以留空，AI 会根据需求和仓库结构制定方案。"><textarea className="po-textarea" value={value.technicalDesign} onChange={(event) => setValue({ ...value, technicalDesign: event.target.value })} placeholder="已有模块、接口、数据、测试和发布约束。" /></Field> : null}<div className="po-field-pair"><Field label="任务语言" hint="仅在 AI 生成任务时生效；命令和代码标识不会翻译。"><select className="po-select" value={value.taskLanguage} onChange={(event) => setValue({ ...value, taskLanguage: event.target.value as TaskLanguage })}><option value="zh-CN">简体中文（默认）</option><option value="en">English</option></select></Field><Field label="优先级"><select className="po-select" value={value.priority} onChange={(event) => setValue({ ...value, priority: event.target.value as Priority })}><PriorityOptions /></select></Field></div><Field label="负责人"><input className="po-input" value={value.owner} onChange={(event) => setValue({ ...value, owner: event.target.value })} placeholder="姓名或团队" /></Field></div></details>
      </div>
    </ModalShell>
  )
}

function DirectoryBrowser({ listing, busy, error, navigate, select, close }: { listing: DirectoryListing | undefined; busy: boolean; error: string | undefined; navigate: (path?: string) => Promise<void>; select: () => void; close: () => void }) {
  useEffect(() => {
    const keydown = (event: KeyboardEvent) => { if (event.key === 'Escape') close() }
    document.addEventListener('keydown', keydown)
    return () => document.removeEventListener('keydown', keydown)
  }, [close])
  const entries = listing?.entries.filter((entry) => !entry.hidden) ?? []
  return <div className="po-directory-browser-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) close() }}>
    <section className="po-directory-browser" role="dialog" aria-modal="true" aria-labelledby="po-directory-browser-title">
      <header><div><h3 id="po-directory-browser-title">选择项目目录</h3><p>选择后会自动创建或复用同路径的 DeepSeek Harness Workspace。</p></div><button type="button" className="po-icon-button" aria-label="关闭目录选择器" onClick={close}><IconCloseOutline16 /></button></header>
      <nav className="po-directory-crumbs" aria-label="目录路径">{listing?.crumbs.map((crumb) => <button type="button" key={crumb.path} disabled={busy} onClick={() => void navigate(crumb.path)}>{crumb.name}</button>)}</nav>
      <div className="po-directory-list" aria-busy={busy}>{busy && !listing ? <div className="po-directory-message">正在读取目录…</div> : error ? <div className="po-inline-error" role="alert"><IconWarningOutline16 />{error}</div> : entries.length === 0 ? <div className="po-directory-message">当前目录没有可进入的子目录。</div> : entries.map((entry) => <button type="button" key={entry.path} disabled={busy} onClick={() => void navigate(entry.path)}><IconFolderOpenOutline16 /><span>{entry.name}</span><IconChevronRightOutline14 /></button>)}</div>
      {listing?.truncated ? <p className="po-directory-warning">目录内容过多，仅显示前一部分。可通过面包屑缩小范围。</p> : null}
      <footer><span className="po-directory-current" title={listing?.path}>{listing?.path ?? '正在读取主目录…'}</span><ActionButton variant="ghost" onClick={close}>取消</ActionButton><ActionButton variant="primary" disabled={!listing || busy} onClick={select}>选择当前目录</ActionButton></footer>
    </section>
  </div>
}

function IssueDialog({ state, model, issue }: { state: WorkbenchState; model: WorkbenchModel; issue: import('./client-types.js').IssueRecord }) {
  const [body, setBody] = useState('')
  const [note, setNote] = useState('')
  const [assignmentMode, setAssignmentMode] = useState<'agent' | 'squad'>(issue.assigneeType === 'squad' ? 'squad' : 'agent')
  const [agentId, setAgentId] = useState(issue.assigneeType === 'agent' ? issue.assigneeId ?? '' : '')
  const [squadId, setSquadId] = useState(issue.assigneeType === 'squad' ? issue.assigneeId ?? '' : '')
  const [eligibleSquads, setEligibleSquads] = useState<SquadAvailability[]>([])
  const comments = state.snapshot.comments.filter((comment) => comment.issueId === issue.id)
  const events = state.snapshot.activity.filter((event) => event.issueId === issue.id).slice(0, 20)
  const runs = state.snapshot.taskRuns.filter((run) => run.issueId === issue.id).sort((a,b) => b.createdAt.localeCompare(a.createdAt))
  const transcripts = state.snapshot.transcripts.filter((entry) => runs.some((run) => run.id === entry.taskRunId))
  const artifacts = state.snapshot.artifacts.filter((artifact) => artifact.issueId === issue.id)
  const activeRun = issue.activeTaskRunId ? state.snapshot.taskRuns.find((run) => run.id === issue.activeTaskRunId) : undefined
  const eligibleIssueAgentIds = issue.projectId === undefined ? undefined : new Set(projectMemberships(state.snapshot, issue.projectId).map((member) => member.agentId))
  const assignableAgents = state.snapshot.agents.filter((agent) => agent.status === 'active' && (eligibleIssueAgentIds === undefined || eligibleIssueAgentIds.has(agent.id)))
  useEffect(() => { if (issue.projectId) void readApi<SquadAvailability[]>(`/projects/${issue.projectId}/eligible-squads`).then(setEligibleSquads).catch(() => setEligibleSquads([])) }, [issue.projectId, state.snapshot.squads])
  const assignableSquads = eligibleSquads.filter((item) => item.eligible).map((item) => ({ availability: item, squad: state.snapshot.squads.find((candidate) => candidate.id === item.squadId) })).filter((item): item is { availability: SquadAvailability; squad: SquadRecord } => item.squad !== undefined)
  const openProjectAgents = () => { if (issue.projectId === undefined) return; model.setView('projects'); window.setTimeout(() => model.openProject(issue.projectId!, 'agents'), 0) }
  const command = async (type: string, payload: Record<string, unknown>, notice: string) => { await model.action(() => mutate('/commands', 'POST', { type, projectId: issue.projectId, issueId: issue.id, actorType: 'human', actorId: 'operator', payload }), notice) }
  const addComment = async () => { if (!body.trim()) return; const result = await model.action(() => mutate(`/issues/${issue.id}/comments`, 'POST', { body }), '评论已添加。'); if (result) setBody('') }
  const assign = async () => { const assigneeId = assignmentMode === 'agent' ? agentId : squadId; if (!assigneeId) return; await command(issue.assigneeId ? 'reassign_issue' : 'assign_issue', { assigneeType: assignmentMode, assigneeId }, issue.assigneeId ? 'Issue 已重新分派。' : 'Issue 已加入执行队列。') }
  return <ModalShell title={issue.title} subtitle={`${issue.status} · ${issue.priority} · Review ${issue.reviewStatus ?? 'not_requested'}`} close={model.closePanel} wide footer={<ActionButton variant="ghost" onClick={model.closePanel}>关闭详情</ActionButton>}>
    <div className="po-issue-detail">
      <section><h3>描述与属性</h3><p className="po-issue-description">{issue.description || '暂无描述。'}</p><div className="po-issue-facts"><span>状态 <strong>{issue.status}</strong></span><span>负责人 <strong>{issue.assigneeId ? assigneeLabel(state.snapshot, issue.assigneeType, issue.assigneeId) : '未分派'}</strong></span><span>分派版本 <strong>{issue.assignmentRevision ?? 0}</strong></span><span>Labels <strong>{issue.labels.join(', ') || '无'}</strong></span></div></section>
      <section><h3>Owner commands</h3><div className="po-assignment-mode po-segments" role="group" aria-label="Issue 分派模式"><Segment active={assignmentMode === 'agent'} onClick={() => setAssignmentMode('agent')}>Agent</Segment><Segment active={assignmentMode === 'squad'} onClick={() => setAssignmentMode('squad')}>Squad</Segment></div><div className="po-command-bar">{assignmentMode === 'agent' ? <select className="po-select" aria-label="选择 Agent" value={agentId} onChange={(event) => setAgentId(event.target.value)}><option value="">选择 Agent</option>{assignableAgents.map((agent) => <option key={agent.id} value={agent.id}>{agent.name}</option>)}</select> : <select className="po-select" aria-label="选择 Squad" value={squadId} onChange={(event) => setSquadId(event.target.value)}><option value="">选择 eligible Squad</option>{assignableSquads.map(({ squad, availability }) => <option key={squad.id} value={squad.id}>{squad.name} · {availability.dispatchReady ? '可派发' : 'Runtime 警告'}</option>)}</select>}{!['done','in_review'].includes(issue.status) ? <ActionButton variant="primary" disabled={!(assignmentMode === 'agent' ? agentId : squadId) || state.loading} onClick={() => void assign()}>{issue.assigneeId ? '重新分派 Issue' : '分派 Issue'}</ActionButton> : null}{activeRun ? <ActionButton variant="outline" icon={<IconStopFill16 />} onClick={() => void command('stop_issue', { reason: note.trim() || 'Stopped by operator.' }, 'Issue 已停止。')}>停止执行</ActionButton> : null}{!activeRun && ['blocked','cancelled'].includes(issue.status) && issue.assigneeId ? <ActionButton variant="primary" onClick={() => void command('continue_issue', {}, 'Issue 已继续执行。')}>继续执行</ActionButton> : null}</div>{issue.projectId !== undefined && assignableAgents.length === 0 ? <div className="po-empty-project-note"><IconWarningOutline16 /><div><strong>当前项目没有可分派的智能体</strong><p>先把 active 智能体加入项目，再返回分派 Issue。</p></div><ActionButton size="sm" variant="outline" onClick={openProjectAgents}>管理项目智能体</ActionButton></div> : null}<textarea className="po-textarea" value={note} onChange={(event) => setNote(event.target.value)} placeholder="审核结论、停止原因或决定上下文" />{issue.status === 'in_review' ? <div className="po-inline-actions"><ActionButton variant="primary" disabled={!note.trim()} onClick={() => void command('approve_review', { note }, 'Issue 审核已批准。')}>批准审核</ActionButton><ActionButton variant="outline" disabled={!note.trim()} onClick={() => void command('reject_review', { note }, 'Issue 已退回修改。')}>退回修改</ActionButton></div> : null}</section>
      <section><h3>当前运行与历史 <small>{runs.length} 次</small></h3>{runs.length === 0 ? <p className="po-context-empty">尚无执行记录。</p> : runs.map((run) => { const stat = state.snapshot.runStatistics.find((entry) => entry.taskRunId === run.id); return <details key={run.id} className="po-run-disclosure" open={run.id === activeRun?.id}><summary><strong>Attempt {run.attempt}</strong><span>{run.status} · {stat?.durationMs === undefined ? '时长 —' : formatDuration(stat.durationMs)} · {stat?.usageKnown ? `${(stat.inputTokens ?? 0) + (stat.outputTokens ?? 0)} tokens` : 'Tokens —'} · {stat?.costUsd === undefined ? '成本 —' : `$${stat.costUsd.toFixed(4)}`}</span></summary><dl><dt>Workspace</dt><dd>{run.workspace ?? run.cwd ?? '—'}</dd><dt>Branch</dt><dd>{run.branch ?? '—'}</dd><dt>Commits</dt><dd>{run.baseCommit ? `${run.baseCommit.slice(0,8)} → ${(run.headCommit ?? run.baseCommit).slice(0,8)}` : '—'}</dd><dt>Session</dt><dd>{run.sessionId ?? '—'}</dd><dt>Execution environment</dt><dd>{run.executionEnvironment === 'project_venv' ? `Project venv · ${run.virtualEnvPath ?? '.venv'}` : run.executionEnvironment === 'host_path' ? 'Host PATH' : '—'}</dd>{run.error ? <><dt>错误</dt><dd>{run.error}</dd></> : null}</dl></details> })}</section>
      <section><h3>Transcript <small>{transcripts.length} 条</small></h3>{transcripts.length === 0 ? <p className="po-context-empty">执行完成后会投影脱敏的会话记录。</p> : <div className="po-transcript">{transcripts.map((entry) => <div key={entry.id}><strong>{entry.role}</strong><pre>{entry.text}</pre></div>)}</div>}</section>
      <section><h3>Artifacts <small>{artifacts.length} 个</small></h3>{artifacts.length === 0 ? <p className="po-context-empty">尚无交付证据。</p> : <div className="po-artifact-list">{artifacts.map((artifact) => <details key={artifact.id}><summary><strong>{artifact.name}</strong><span>{artifact.kind} · {formatDate(artifact.createdAt)}</span></summary>{artifact.uri ? <a href={artifact.uri} target="_blank" rel="noreferrer noopener">打开 Artifact</a> : null}{artifact.content ? <pre>{artifact.content}</pre> : null}</details>)}</div>}</section>
      <section><h3>评论</h3><div className="po-issue-comments">{comments.map((comment) => <div key={comment.id} className="po-issue-comment"><strong>{comment.authorType === 'human' ? '你' : comment.authorType}</strong><p>{comment.body}</p><time>{formatDate(comment.createdAt)}</time></div>)}</div><textarea className="po-textarea" value={body} onChange={(event) => setBody(event.target.value)} placeholder="补充上下文、决定或验收反馈" /><ActionButton variant="outline" disabled={state.loading || !body.trim()} onClick={() => void addComment()}>添加评论</ActionButton></section>
      <section><h3>Activity</h3><div className="po-issue-activity">{events.map((event) => <div key={event.id}><span>{event.type}</span><p>{event.message}</p><time>{formatDate(event.createdAt)}</time></div>)}</div></section>
    </div>
  </ModalShell>
}

function TaskDialog({ state, model, task }: { state: WorkbenchState; model: WorkbenchModel; task?: TaskRecord | undefined }) {
  const editableProjects = state.snapshot.projects.filter((project) => !isProjectActive(project))
  const selectedProjectIsEditable = editableProjects.some((project) => project.id === state.selectedProjectId)
  const defaultProjectId = task?.projectId ?? (selectedProjectIsEditable ? state.selectedProjectId : undefined) ?? editableProjects[0]?.id ?? ''
  const [projectId, setProjectId] = useState(defaultProjectId)
  const [kind, setKind] = useState<TaskRecord['kind']>(task?.kind ?? 'code')
  const [priority, setPriority] = useState<Priority>(task?.priority ?? 'medium')
  const [tags, setTags] = useState(task?.tags?.join(', ') ?? '')
  const [title, setTitle] = useState(task?.title ?? '')
  const [description, setDescription] = useState(task?.description ?? '')
  const [criteria, setCriteria] = useState(task?.acceptanceCriteria.join('\n') ?? '')
  const [dependencies, setDependencies] = useState(task?.dependencies ?? [])
  const [agentId, setAgentId] = useState(task?.agentId ?? '')
  const [testCommand, setTestCommand] = useState(task?.testCommand ?? '')
  const selectedProject = state.snapshot.projects.find((project) => project.id === projectId)
  const locked = selectedProject !== undefined && isProjectActive(selectedProject)
  const eligibleMembers = selectedProject === undefined ? [] : projectMemberships(state.snapshot, selectedProject.id).filter((member) => state.snapshot.agents.find((agent) => agent.id === member.agentId)?.status === 'active')
  useEffect(() => { if (agentId && !eligibleMembers.some((member) => member.agentId === agentId)) setAgentId('') }, [projectId])
  const projectTasks = state.snapshot.tasks.filter((entry) => entry.projectId === projectId && entry.id !== task?.id)
  const dependents = task === undefined || selectedProject === undefined ? [] : state.snapshot.tasks.filter((entry) => selectedProject.taskIds.includes(entry.id) && entry.dependencies.includes(task.id))
  const canDelete = task !== undefined && !locked && dependents.length === 0
  const save = async () => {
    if (locked) return
    const acceptanceCriteria = criteria.split('\n').map((criterion) => criterion.trim()).filter(Boolean)
    const taskTags = parseList(tags)
    const payload = { kind, priority, tags: taskTags, title, description, acceptanceCriteria, dependencies, agentId: agentId || null, testCommand }
    const result = await model.action(() => task === undefined ? mutate<TaskRecord>(`/projects/${projectId}/tasks`, 'POST', payload) : mutate<TaskRecord>(`/tasks/${task.id}`, 'PUT', { priority, tags: taskTags, title, description, acceptanceCriteria, dependencies, agentId: agentId || null, testCommand }), task === undefined ? '任务已添加到项目计划。' : '任务已更新，项目需要重新批准。')
    if (result) model.closePanel()
  }
  const remove = async () => {
    if (locked || !task || dependents.length > 0) return
    if (!await model.confirm({ title: '删除任务', message: `删除任务“${task.title}”？删除后任务及其关联证据将不再出现在项目中。`, confirmLabel: '删除任务', tone: 'danger' })) return
    const result = await model.action(() => mutate(`/tasks/${task.id}`, 'DELETE'), '任务已删除，项目计划需要重新批准。')
    if (result) model.closePanel()
  }
  return (
    <ModalShell title={task ? task.title : '新建任务'} subtitle={task ? `${projectName(state.snapshot, task.projectId)} · ${statusLabel(task.status)}` : '任务必须具备可独立执行的测试门禁。'} close={model.closePanel} wide footer={<>{task ? <ActionButton variant="ghost" icon={<IconTrashOutline16 />} disabled={!canDelete || state.loading} onClick={() => void remove()}>删除任务</ActionButton> : <span />}<span className="po-spacer" /><ActionButton variant="ghost" onClick={model.closePanel}>取消</ActionButton><ActionButton variant="primary" disabled={locked || state.loading || !validTask({ projectId, title, description, criteria, testCommand })} onClick={() => void save()}>{task ? '保存任务' : '创建任务'}</ActionButton></>}>
      {state.snapshot.projects.length === 0 ? <div className="po-inline-error"><IconWarningOutline16 />请先创建项目，再添加任务。</div> : null}
      {locked ? <div className="po-inline-error"><IconWarningOutline16 />项目正在拆解或执行，任务暂时只读。</div> : null}
      {task && dependents.length > 0 ? <div className="po-inline-error"><IconWarningOutline16 /><span>该任务不能删除，因为以下任务依赖它：{dependents.map((dependent) => <strong key={dependent.id}> {dependent.title}</strong>)}。请先编辑这些任务，移除依赖关系。</span></div> : null}
      <div className="po-form-grid"><Field label="任务标题" wide><input className="po-input" required value={title} onChange={(event) => setTitle(event.target.value)} /></Field><Field label="所属项目"><select className="po-select" disabled={task !== undefined} value={projectId} onChange={(event) => { setProjectId(event.target.value); setDependencies([]) }}>{state.snapshot.projects.map((project) => <option key={project.id} value={project.id} disabled={task === undefined && isProjectActive(project)}>{project.name}{isProjectActive(project) ? '（运行中）' : ''}</option>)}</select></Field><Field label="工作流状态"><select className="po-select" disabled value={task?.status ?? 'draft'}><option value={task?.status ?? 'draft'}>{statusLabel(task?.status ?? 'draft')}（测试门禁驱动）</option></select></Field><Field label="任务类型"><select className="po-select" disabled={task !== undefined} value={kind} onChange={(event) => setKind(event.target.value as TaskRecord['kind'])}><option value="code">代码任务</option><option value="test">测试任务</option></select></Field><Field label="优先级"><select className="po-select" value={priority} onChange={(event) => setPriority(event.target.value as Priority)}><PriorityOptions /></select></Field><Field label="标签" wide><input className="po-input" value={tags} onChange={(event) => setTags(event.target.value)} placeholder="frontend, regression, api" /></Field><Field label="任务描述" wide><textarea className="po-textarea" required value={description} onChange={(event) => setDescription(event.target.value)} /></Field><Field label="验收标准（每行一项）" wide><textarea className="po-textarea" required value={criteria} onChange={(event) => setCriteria(event.target.value)} /></Field><Field label="依赖任务"><select className="po-select" multiple value={dependencies} onChange={(event) => setDependencies([...event.target.selectedOptions].map((option) => option.value))}>{projectTasks.map((candidate) => <option key={candidate.id} value={candidate.id}>{candidate.ordinal + 1}. {candidate.title}</option>)}</select></Field><Field label="执行者"><select className="po-select" value={agentId} onChange={(event) => setAgentId(event.target.value)}><option value="">未分配</option>{eligibleMembers.map((member) => <option key={member.agentId} value={member.agentId}>{agentName(state.snapshot, member.agentId)} · {member.projectRole || '未设置职责'}</option>)}</select><small className="po-field-help">只显示当前项目的 active 成员。未找到合适成员？ <button type="button" className="po-link-button" onClick={() => { model.closePanel(); if (selectedProject) model.openProject(selectedProject.id, 'agents') }}>加入智能体并指派</button></small></Field><Field label="测试门禁命令" wide><input className="po-input" required value={testCommand} onChange={(event) => setTestCommand(event.target.value)} placeholder="例如：pnpm test" /></Field></div>
      {task ? <Evidence task={task} /> : null}
    </ModalShell>
  )
}

function Evidence({ task }: { task: TaskRecord }) {
  if (task.resultSummary === undefined && task.testOutput === undefined && task.failureReason === undefined) return null
  return <section className="po-evidence"><h3>执行与测试证据</h3>{task.failureReason ? <div className="po-inline-error"><IconWarningOutline16 />{task.failureReason}</div> : null}{task.resultSummary ? <pre>{task.resultSummary}</pre> : null}{task.testOutput ? <pre>{task.testOutput}</pre> : null}<div className="po-evidence-meta">{task.sessionId ? `Session ${task.sessionId}` : ''}{task.testExitCode === undefined ? '' : ` · Test exit ${task.testExitCode}`}</div></section>
}

function RunSummary({ run, snapshot }: { run: RunRecord; snapshot: Snapshot }) {
  const currentTask = snapshot.tasks.find((task) => task.id === run.currentTaskId)
  return <section className="po-run-summary"><div className="po-section-heading"><div><h2>最近运行</h2><p>{run.id}</p></div><StatusBadge status={run.status} /></div><dl><dt>当前任务</dt><dd>{currentTask?.title ?? '无'}</dd><dt>开始时间</dt><dd>{formatDate(run.startedAt ?? run.createdAt)}</dd><dt>结束时间</dt><dd>{run.completedAt ? formatDate(run.completedAt) : '进行中'}</dd>{run.error ? <><dt>错误</dt><dd>{run.error}</dd></> : null}</dl></section>
}

function Field({ label, hint, wide = false, children }: { label: string; hint?: string; wide?: boolean; children: React.ReactNode }) {
  return <label className={`po-field${wide ? ' po-field-wide' : ''}`}><span className="po-label">{label}</span>{hint ? <span className="po-field-help">{hint}</span> : null}{children}</label>
}

function StatusBadge({ status }: { status: ProjectStatus | TaskStatus | RunRecord['status'] }) {
  return <span className={`po-badge po-status-${status}`}>{statusLabel(status)}</span>
}

function PriorityBadge({ priority }: { priority: Priority }) {
  return <span className={`po-priority po-priority-${priority}`}>{priorityLabel(priority)}</span>
}

function PriorityOptions() {
  return <><option value="low">低</option><option value="medium">中</option><option value="high">高</option><option value="urgent">紧急</option></>
}

function EmptyState({ title, body }: { title: string; body: string }) {
  return <div className="po-empty"><strong>{title}</strong><span>{body}</span></div>
}

function MessageBar({ state, model }: { state: WorkbenchState; model: WorkbenchModel }) {
  if (!state.error && !state.notice) return null
  return <button type="button" role="status" aria-live="polite" className={`po-toast${state.notice ? ' po-toast-success' : ''}`} onClick={model.clearMessages}>{state.error ?? state.notice}<IconCloseOutline16 /></button>
}

async function regenerateProjectPlan(model: WorkbenchModel, project: ProjectRecord, taskLanguage: TaskLanguage) {
  if (project.taskIds.length > 0 && !await model.confirm({ title: '替换当前计划', message: '重新生成会替换当前任务计划，并使已有审批失效。生成完成后需要重新批准。', confirmLabel: '替换并重新规划', tone: 'warning' })) return
  await model.action(() => mutate(`/projects/${project.id}/replan`, 'POST', { taskLanguage }), taskLanguage === 'zh-CN' ? '中文任务计划正在重新生成，完成后需要重新批准。' : 'English task plan regeneration started; approval will be required again.')
}
async function approveAndExecuteProject(model: WorkbenchModel, project: ProjectRecord, planHash: string | undefined) {
  if (!planHash) return
  await model.action(() => mutate(`/projects/${project.id}/approve`, 'POST', { revision: project.revision, planHash, actor: 'Harness user' }), '计划已批准，AI 正在自动实施。')
}
async function retryProject(model: WorkbenchModel, project: ProjectRecord) {
  await model.action(() => mutate(`/projects/${project.id}/retry`, 'POST'), 'AI 已继续处理未通过的任务。')
}
async function cancelProject(model: WorkbenchModel, project: ProjectRecord) {
  await model.action(() => mutate(`/projects/${project.id}/cancel`, 'POST'), '停止请求已提交。')
}
async function deleteProject(model: WorkbenchModel, project: ProjectRecord) {
  if (!await model.confirm({ title: '删除项目', message: `删除项目“${project.name}”及其任务、Issues、运行记录、审批和相关执行数据？共享的智能体、Squad、Runtime 与 Harness Workspace 不会删除。`, confirmLabel: '删除项目', tone: 'danger' })) return
  const result = await model.action(() => mutate(`/projects/${project.id}`, 'DELETE'), '项目已删除。')
  if (result) model.clearSelection()
}
async function deleteAgent(model: WorkbenchModel, agent: AgentRecord) {
  if (!await model.confirm({ title: '删除智能体', message: `删除智能体“${agent.name}”？删除后该智能体的全局配置将无法恢复。`, confirmLabel: '删除智能体', tone: 'danger' })) return
  const result = await model.action(() => mutate(`/agents/${agent.id}`, 'DELETE'), '智能体已删除。')
  if (result) model.clearSelection()
}

function agentValue(agent: AgentDraft | AgentRecord): AgentFormValue {
  return { name: agent.name, role: agent.role, description: agent.description, persona: agent.persona, provider: agent.provider ?? '', model: agent.model ?? '', preset: agent.preset, toolPolicy: agent.toolPolicy, skillsText: (agent.skills ?? []).join('\n'), runtimeId: agent.runtimeId ?? '', access: agent.access ?? 'only_me', maxConcurrency: agent.maxConcurrency ?? 1 }
}
function agentPayload(value: AgentFormValue): AgentDraft {
  const name = value.name.trim()
  return { name, role: value.role.trim() || name, description: value.description.trim(), persona: value.persona.trim(), ...(value.provider.trim() ? { provider: value.provider.trim() } : {}), ...(value.model.trim() ? { model: value.model.trim() } : {}), preset: value.preset.trim() || 'standard', toolPolicy: value.toolPolicy, skills: parseList(value.skillsText), ...(value.runtimeId ? { runtimeId: value.runtimeId } : {}), access: value.access, maxConcurrency: value.maxConcurrency }
}
const AGENT_FORM_FIELDS: AgentFormField[] = ['name', 'role', 'description', 'persona', 'provider', 'model', 'preset', 'toolPolicy', 'skillsText', 'runtimeId', 'access', 'maxConcurrency']
const AGENT_FIELD_LABELS: Record<AgentFormField, string> = { name: '名称', role: '内部角色', description: '描述', persona: 'Instructions', provider: 'Provider', model: 'Model', preset: 'Preset', toolPolicy: '工具权限', skillsText: 'Skills', runtimeId: 'Runtime', access: '访问范围', maxConcurrency: '最大并发' }
function validAgent(value: AgentFormValue): boolean { return value.name.trim() !== '' && value.persona.trim() !== '' }
function hasAgentDraftContent(value: AgentFormValue): boolean {
  return value.name.trim() !== '' || value.role.trim() !== '' || value.description.trim() !== '' || value.persona.trim() !== '' || value.provider.trim() !== '' || value.model.trim() !== '' || value.skillsText.trim() !== '' || value.preset !== 'standard' || value.toolPolicy !== 'full' || value.runtimeId !== '' || value.access !== 'only_me' || value.maxConcurrency !== 1
}
function agentContextPayload(value: AgentFormValue): Partial<AgentDraft> {
  return {
    ...(value.name.trim() ? { name: value.name.trim() } : {}),
    ...(value.role.trim() ? { role: value.role.trim() } : {}),
    description: value.description.trim(),
    ...(value.persona.trim() ? { persona: value.persona.trim() } : {}),
    ...(value.provider.trim() ? { provider: value.provider.trim() } : {}),
    ...(value.model.trim() ? { model: value.model.trim() } : {}),
    preset: value.preset.trim() || 'standard',
    toolPolicy: value.toolPolicy,
    skills: parseList(value.skillsText),
    ...(value.runtimeId ? { runtimeId: value.runtimeId } : {}),
    access: value.access,
    maxConcurrency: value.maxConcurrency,
  }
}
function changedAgentFieldKeys(previous: AgentFormValue, next: AgentFormValue): AgentFormField[] { return AGENT_FORM_FIELDS.filter((field) => previous[field] !== next[field]) }
function changedAgentFields(previous: AgentFormValue, next: AgentFormValue): string[] { return changedAgentFieldKeys(previous, next).map(agentFieldLabel) }
function agentFieldLabel(field: AgentFormField): string { return AGENT_FIELD_LABELS[field] }
function mergeGeneratedAgent(current: AgentFormValue, generated: AgentFormValue, dirtyFields: Set<AgentFormField>): AgentFormValue {
  const merged = { ...generated }
  for (const field of dirtyFields) Object.assign(merged, { [field]: current[field] })
  return merged
}
function applyAgentFields(current: AgentFormValue, proposal: AgentFormValue, fields: AgentFormField[]): AgentFormValue {
  const applied = { ...current }
  for (const field of fields) Object.assign(applied, { [field]: proposal[field] })
  return applied
}
function hasStoredAgentBuilderDraft(): boolean { return loadAgentBuilderDraft() !== undefined }
function isAgentFormField(value: unknown): value is AgentFormField { return typeof value === 'string' && AGENT_FORM_FIELDS.includes(value as AgentFormField) }
function isStringArray(value: unknown, max = 40): value is string[] { return Array.isArray(value) && value.length <= max && value.every((entry) => typeof entry === 'string') }
function isAgentFormValue(value: unknown): value is AgentFormValue {
  if (typeof value !== 'object' || value === null) return false
  const draft = value as Record<string, unknown>
  return ['name', 'role', 'description', 'persona', 'provider', 'model', 'preset', 'skillsText', 'runtimeId'].every((field) => typeof draft[field] === 'string')
    && (draft.toolPolicy === 'full' || draft.toolPolicy === 'read_only')
    && (draft.access === 'only_me' || draft.access === 'workspace' || draft.access === 'specific_people')
    && typeof draft.maxConcurrency === 'number' && Number.isInteger(draft.maxConcurrency) && draft.maxConcurrency >= 1 && draft.maxConcurrency <= 32
}
function isBuilderTurn(value: unknown): value is BuilderTurn {
  if (typeof value !== 'object' || value === null) return false
  const turn = value as Record<string, unknown>
  return typeof turn.id === 'string' && (turn.role === 'user' || turn.role === 'assistant') && typeof turn.content === 'string' && turn.content.length <= 20_000
    && (turn.assumptions === undefined || isStringArray(turn.assumptions, 10))
    && (turn.warnings === undefined || isStringArray(turn.warnings, 20))
    && (turn.reuseRecommendation === undefined || (typeof turn.reuseRecommendation === 'object' && turn.reuseRecommendation !== null && typeof (turn.reuseRecommendation as Record<string, unknown>).agentId === 'string' && typeof (turn.reuseRecommendation as Record<string, unknown>).reason === 'string'))
    && (turn.openQuestions === undefined || isStringArray(turn.openQuestions, 2))
    && (turn.changedFields === undefined || isStringArray(turn.changedFields, 20))
    && (turn.protectedFields === undefined || (Array.isArray(turn.protectedFields) && turn.protectedFields.every(isAgentFormField)))
    && (turn.proposal === undefined || isAgentFormValue(turn.proposal))
}
function loadAgentBuilderDraft(): StoredAgentBuilderDraft | undefined {
  try {
    const raw = window.localStorage.getItem(AGENT_BUILDER_STORAGE_KEY)
    if (!raw || raw.length > 1_000_000) return undefined
    const stored = JSON.parse(raw) as Record<string, unknown>
    if (!isAgentFormValue(stored.value) || !Array.isArray(stored.turns) || stored.turns.length > 40 || !stored.turns.every(isBuilderTurn) || typeof stored.prompt !== 'string' || stored.prompt.length > 20_000) return undefined
    const dirtyFields = stored.dirtyFields === undefined ? [] : stored.dirtyFields
    if (!Array.isArray(dirtyFields) || !dirtyFields.every(isAgentFormField)) return undefined
    return { value: stored.value, turns: stored.turns, dirtyFields, prompt: stored.prompt, updatedAt: typeof stored.updatedAt === 'number' ? stored.updatedAt : Date.now() }
  } catch {
    return undefined
  }
}
function validProject(value: Pick<ProjectIntakeValue, 'name' | 'cwd' | 'prd' | 'sourceKind' | 'repositoryUrl' | 'repositoryRef' | 'issueNumbers'>, requireBrief: boolean): boolean {
  const sourceReady = value.sourceKind === 'local_directory' ? value.cwd.trim() !== '' : value.repositoryUrl.trim() !== '' && value.repositoryRef.trim() !== ''
  const planningContextReady = value.prd.trim() !== '' || (value.sourceKind === 'github_repo' && value.issueNumbers.length > 0)
  return sourceReady && (!requireBrief || planningContextReady) && (requireBrief || value.name.trim() !== '')
}
function suggestProjectName(brief: string): string {
  const candidate = brief.split('\n').map((line) => line.replace(/^\s*#+\s*/, '').trim()).find((line) => line.length > 0) ?? ''
  return candidate.replace(/[。.!！?？].*$/, '').slice(0, 80)
}
function persistProjectIntakeDraft(value: ProjectIntakeValue): void {
  const storedValue: StoredProjectIntakeValue = {
    mode: value.mode,
    sourceKind: value.sourceKind,
    repositoryRef: value.repositoryRef,
    issueNumbers: [...new Set(value.issueNumbers)].slice(0, 100),
    name: value.name,
    summary: value.summary,
    priority: value.priority,
    owner: value.owner,
    taskLanguage: value.taskLanguage,
  }
  try {
    window.localStorage.removeItem(PROJECT_INTAKE_LEGACY_STORAGE_KEY)
    window.localStorage.setItem(PROJECT_INTAKE_STORAGE_KEY, JSON.stringify({ value: storedValue, updatedAt: Date.now() } satisfies StoredProjectIntakeDraft))
  } catch {
    // Draft persistence is best effort and must not interrupt project creation.
  }
}
function clearProjectIntakeDraft(): void {
  try {
    window.localStorage.removeItem(PROJECT_INTAKE_STORAGE_KEY)
    window.localStorage.removeItem(PROJECT_INTAKE_LEGACY_STORAGE_KEY)
  } catch {
    // Storage may be disabled by the browser profile.
  }
}
function loadProjectIntakeDraft(): ProjectIntakeValue | undefined {
  try {
    window.localStorage.removeItem(PROJECT_INTAKE_LEGACY_STORAGE_KEY)
    const raw = window.localStorage.getItem(PROJECT_INTAKE_STORAGE_KEY)
    if (!raw) return undefined
    const draft = JSON.parse(raw) as Partial<StoredProjectIntakeDraft>
    const stored = draft.value
    if (typeof draft.updatedAt !== 'number' || !Number.isFinite(draft.updatedAt) || Date.now() - draft.updatedAt > PROJECT_INTAKE_DRAFT_TTL_MS || stored === null || typeof stored !== 'object') {
      clearProjectIntakeDraft()
      return undefined
    }
    if (stored.mode !== 'empty' && stored.mode !== 'ai') return undefined
    if (stored.sourceKind !== 'local_directory' && stored.sourceKind !== 'github_repo') return undefined
    return {
      mode: stored.mode,
      sourceKind: stored.sourceKind,
      repositoryUrl: '',
      repositoryRef: typeof stored.repositoryRef === 'string' ? stored.repositoryRef : '',
      issueNumbers: Array.isArray(stored.issueNumbers) ? [...new Set(stored.issueNumbers.filter((number): number is number => typeof number === 'number' && Number.isSafeInteger(number) && number > 0))].slice(0, 100) : [],
      name: typeof stored.name === 'string' ? stored.name : '',
      summary: typeof stored.summary === 'string' ? stored.summary : '',
      priority: stored.priority === 'low' || stored.priority === 'medium' || stored.priority === 'high' || stored.priority === 'urgent' ? stored.priority : 'medium',
      owner: typeof stored.owner === 'string' ? stored.owner : '',
      cwd: '',
      prd: '',
      technicalDesign: '',
      taskLanguage: stored.taskLanguage === 'en' ? 'en' : 'zh-CN',
    }
  } catch {
    clearProjectIntakeDraft()
    return undefined
  }
}
function validTask(value: { projectId: string; title: string; description: string; criteria: string; testCommand: string }): boolean { return value.projectId !== '' && value.title.trim() !== '' && value.description.trim() !== '' && value.criteria.split('\n').some((line) => line.trim() !== '') && value.testCommand.trim() !== '' }
function parseList(value: string): string[] { return [...new Set(value.split(/[,\n]/).map((entry) => entry.trim()).filter(Boolean))] }
function lifecyclePhaseLabel(phase: 'understanding' | 'planning' | 'approval' | 'execution' | 'verification'): string { return ({ understanding: '理解需求', planning: '生成计划', approval: '等待批准', execution: '自动实施', verification: '测试验证' } as const)[phase] }
function lifecyclePhaseIcon(phase: 'understanding' | 'planning' | 'approval' | 'execution' | 'verification'): string { return ({ understanding: '1', planning: '2', approval: '3', execution: '4', verification: '5' } as const)[phase] }
function lifecyclePhaseState(project: ProjectRecord, phase: 'understanding' | 'planning' | 'approval' | 'execution' | 'verification'): 'done' | 'current' | 'pending' {
  const order = ['understanding', 'planning', 'approval', 'execution', 'verification'] as const
  const current = project.status === 'draft' ? 'understanding' : project.status === 'decomposing' ? 'planning' : project.status === 'awaiting_approval' ? 'approval' : ['approved', 'running'].includes(project.status) ? 'execution' : 'verification'
  const currentIndex = order.indexOf(current)
  const phaseIndex = order.indexOf(phase)
  return phaseIndex < currentIndex || project.status === 'completed' ? 'done' : phase === current ? 'current' : 'pending'
}
function lifecycleDescription(project: ProjectRecord, tasks: TaskRecord[], currentTask: TaskRecord | undefined): string {
  if (project.status === 'draft' && project.prd.trim() === '') return '空项目尚未启动 AI。你可以先手动添加任务，或补充需求后明确选择让 AI 拆解。'
  if (project.status === 'draft') return '项目资料已保存，尚未启动 AI。需要时可以手动添加任务或开始智能拆解。'
  if (project.status === 'decomposing') return 'AI 正在只读检查仓库结构、现有测试和交付目标。计划生成后会进入批准阶段。'
  if (project.status === 'awaiting_approval') return `AI 已生成 ${tasks.length} 个依赖任务，确认一次后会自动执行并验证。`
  if (project.status === 'running') return currentTask ? `正在执行：${currentTask.title}。通过测试后会自动进入下一个依赖任务。` : 'AI 正在按依赖顺序执行并验证任务。'
  if (project.status === 'failed') return '自动修复已达到本轮上限，等待你确认继续或修改项目简报。'
  if (project.status === 'completed') return '所有任务均已通过独立测试，项目已完成。'
  if (project.status === 'cancelled') return '运行已停止，已保留通过测试的任务证据。'
  return 'AI 将自动生成代码任务和测试任务。'
}
function priorityLabel(priority: Priority): string { return ({ low: '低', medium: '中', high: '高', urgent: '紧急' } as const)[priority] }
function keepOrUndefined<T extends { id: string }>(current: string | undefined, records: T[]): string | undefined { return current !== undefined && records.some((record) => record.id === current) ? current : undefined }
function defaultBoardStageForStatus(status: TaskStatus): BoardColumnId {
  if (status === 'queued') return 'todo'
  if (status === 'running') return 'in_progress'
  if (status === 'verifying' || status === 'failed' || status === 'blocked' || status === 'cancelled') return 'review'
  if (status === 'completed') return 'completed'
  return 'planned'
}
function boardColumnForTask(task: TaskRecord): BoardColumnId {
  if (task.status === 'completed' || task.status === 'queued' || task.status === 'running' || task.status === 'verifying') return defaultBoardStageForStatus(task.status)
  return task.boardStage ?? defaultBoardStageForStatus(task.status)
}
function boardStageLabel(stage: BoardColumnId): string { return ({ planned: '待规划', todo: '待办', in_progress: '进行中', review: '审核中', completed: '已完成' } as const)[stage] }
function canScheduleTask(snapshot: Snapshot, task: TaskRecord): boolean {
  const project = snapshot.projects.find((entry) => entry.id === task.projectId)
  return task.status !== 'completed' && project !== undefined && !isProjectActive(project)
}
function projectName(snapshot: Snapshot, id: string): string { return snapshot.projects.find((project) => project.id === id)?.name ?? '未知项目' }
function isProjectActive(project: ProjectRecord): boolean { return project.status === 'running' || project.status === 'decomposing' }
function isApprovalCurrent(snapshot: Snapshot, project: ProjectRecord): boolean {
  const planHash = snapshot.planHashes[project.id]
  const approval = snapshot.approvals.find((entry) => entry.projectId === project.id && entry.revision === project.revision)
  return project.approvedRevision === project.revision && planHash !== undefined && approval?.planHash === planHash
}
function agentName(snapshot: Snapshot, id: string | undefined): string { return id === undefined ? '自动选择' : snapshot.agents.find((agent) => agent.id === id)?.name ?? '智能体已删除' }
function assigneeLabel(snapshot: Snapshot, type: import('./client-types.js').IssueRecord['assigneeType'], id: string): string { return type === 'squad' ? snapshot.squads.find((squad) => squad.id === id)?.name ?? 'Squad 已删除' : type === 'agent' ? agentName(snapshot, id) : id }
function agentWorkload(snapshot: Snapshot, agentId: string): AgentWorkload | undefined { return snapshot.agentWorkloads.find((workload) => workload.agentId === agentId) }
function projectMemberships(snapshot: Snapshot, projectId: string): ProjectAgentMembership[] { return snapshot.projectAgentMemberships.filter((member) => member.projectId === projectId && member.status === 'active') }
function agentMemberships(snapshot: Snapshot, agentId: string): ProjectAgentMembership[] { return snapshot.projectAgentMemberships.filter((member) => member.agentId === agentId && member.status === 'active') }
function taskName(snapshot: Snapshot, taskId?: string): string { return snapshot.tasks.find((task) => task.id === taskId)?.title ?? '未关联任务' }
function runtimeName(snapshot: Snapshot, runtimeId?: string): string { return snapshot.runtimes.find((runtime) => runtime.id === runtimeId)?.name ?? '本机 Harness Host' }
function featureForView(view: View): FeatureUsageFeature { return view === 'tasks' ? 'delivery' : view === 'local-data' ? 'local_data' : view }
async function recordUsage(feature: FeatureUsageFeature, event: 'open' | 'action'): Promise<void> { try { await mutate('/usage', 'POST', { feature, opens: event === 'open' ? 1 : 0, meaningfulActions: event === 'action' ? 1 : 0, errorRecoveries: 0 }) } catch { /* Usage must never interrupt project work. */ } }
function availabilityLabel(status: AgentWorkload['availability']): string { return ({ online: '在线', offline: '离线', unstable: '不稳定', unknown: '未绑定' } as const)[status] }
function squadAvailabilityReasonLabels(item: SquadAvailability, snapshot: Snapshot): string {
  const labels: string[] = []
  if (item.reasons.includes('member_outside_project')) {
    const missing = item.missingAgentIds.map((id) => agentName(snapshot, id)).join('、')
    labels.push(`成员未加入本项目：${missing}`)
  }
  if (item.reasons.includes('agent_inactive')) labels.push('包含已归档智能体')
  if (item.reasons.includes('capacity_exhausted')) labels.push('并行容量已占满')
  if (item.reasons.includes('archived')) labels.push('Squad 已归档')
  if (item.reasons.includes('legacy_member_count')) labels.push('成员配置不完整')
  return labels.join('；') || '需要检查成员资格和并行容量'
}
function workloadLabel(status: AgentWorkload['workload']): string { return ({ idle: '空闲', queued: '排队中', working: '工作中' } as const)[status] }
function accessLabel(access: NonNullable<AgentRecord['access']>): string { return ({ only_me: '仅自己', workspace: '工作区', specific_people: '指定成员' } as const)[access] }
function inboxKindLabel(kind: InboxItem['kind']): string { return ({ needs_decision: '需要决定', blocked: '已阻塞', review_ready: '待审核', runtime_offline: 'Runtime 离线', permission_denied: '权限拒绝', test_failed_after_retry: '重试后仍失败', stale_approval: '审批已过期' } as const)[kind] }
function decisionKindLabel(kind: Snapshot['decisions'][number]['kind']): string { return ({ approval: '批准决定', retry: '重试决定', assignment: '分派决定', review: '审核决定', permission: '权限决定', runtime: 'Runtime 决定' } as const)[kind] }
function actorTypeLabel(type: Snapshot['decisions'][number]['requestedByType']): string { return ({ human: '人工请求', agent: 'Agent 请求', system: '系统请求' } as const)[type] }
function inboxDefaultResolution(action: InboxItem['actions'][number]): string { return ({ approve: '已在 Inbox 审核并批准。', reject: '已在 Inbox 审核并拒绝。', defer: '暂缓处理，保留在 Inbox 中。', retry: '已检查失败上下文，同意重试。' } as const)[action] }
function inboxActionNotice(action: InboxItem['actions'][number]): string { return ({ approve: '事项已批准。', reject: '事项已拒绝。', defer: '事项已暂缓。', retry: '已提交重试。' } as const)[action] }
function messageOf(error: unknown): string { return error instanceof Error ? error.message : String(error) }
function formatDate(value: string): string { return new Intl.DateTimeFormat('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }).format(new Date(value)) }
function formatDuration(value: number): string { return value < 1_000 ? `${value}ms` : value < 60_000 ? `${(value / 1_000).toFixed(1)}s` : `${Math.floor(value / 60_000)}m ${Math.round((value % 60_000) / 1_000)}s` }
function relativeDate(value: string): string {
  const delta = Date.now() - new Date(value).getTime()
  const minutes = Math.max(0, Math.round(delta / 60_000))
  if (minutes < 60) return minutes <= 1 ? '刚刚' : `${minutes} 分钟前`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return `${hours} 小时前`
  return `${Math.round(hours / 24)} 天前`
}
function statusLabel(status: ProjectStatus | TaskStatus | RunRecord['status']): string {
  return ({ draft: '待规划', decomposing: '拆解中', awaiting_approval: '待批准', approved: '已批准', running: '进行中', completed: '已完成', failed: '失败', cancelled: '已取消', queued: '待办', verifying: '测试审核', blocked: '已阻塞' } as Record<string, string>)[status] ?? status
}
