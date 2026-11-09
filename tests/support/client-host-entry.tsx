import React from 'react'
import * as jsxRuntime from 'react/jsx-runtime'
import { createRoot, type Root } from 'react-dom/client'

declare global {
  interface Window {
    __PO_PLUGIN__: { factory: (require: (id: string) => unknown) => { apply: (context: unknown) => void } }
    __PO_TEST_WORKSPACE__: string
  }
}

const roots: Root[] = []
const disposers: Array<() => void | Promise<void>> = []
const Icon = () => <span aria-hidden="true" />
const primitives = {
  Tooltip: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  IconAgentPresetOutlineMedium: Icon,
  IconCheckOutlineMedium: Icon,
  IconChecklistOutlineMedium: Icon,
  IconChevronLeftOutlineMedium: Icon,
  IconChevronRightOutlineMedium: Icon,
  IconCloseOutlineMedium: Icon,
  IconCodeOutlineMedium: Icon,
  IconEditOutlineMedium: Icon,
  IconFolderOpenOutlineMedium: Icon,
  IconPlayOutlineMedium: Icon,
  IconPlusOutlineMedium: Icon,
  IconProjectAddOutlineMedium: Icon,
  IconQueueOutlineMedium: Icon,
  IconRefreshOutlineMedium: Icon,
  IconSearchOutlineMedium: Icon,
  IconSendOutlineMedium: Icon,
  IconStopFillMedium: Icon,
  IconTrashOutlineMedium: Icon,
  IconUserOutlineMedium: Icon,
  IconWarningOutlineMedium: Icon,
}

const requireModule = (id: string): unknown => {
  if (id === 'react') return React
  if (id === 'react/jsx-runtime' || id === 'react/jsx-dev-runtime') return jsxRuntime
  if (id === '@deepseek-ai/dsh-client-ui-primitives') return primitives
  throw new Error(`Unsupported client test dependency: ${id}`)
}

const slots = {
  inject(_name: string, register: () => unknown) {
    register()
    return () => {}
  },
  register(metadata: { id: string }, Component: React.ComponentType<{ wide?: boolean }>) {
    const target = metadata.id.endsWith('.launcher')
      ? document.querySelector<HTMLElement>('#plugin-launcher')
      : document.querySelector<HTMLElement>('#plugin-overlay')
    if (target === null) throw new Error(`Missing test slot for ${metadata.id}`)
    const root = createRoot(target)
    roots.push(root)
    root.render(<Component wide={metadata.id.endsWith('.launcher')} />)
    return () => root.unmount()
  },
}

const workspaces = {
  async pickDirectory() { return window.__PO_TEST_WORKSPACE__ },
  async listDirectory(path?: string) { return { path: path ?? window.__PO_TEST_WORKSPACE__, parent: null, entries: [] } },
  async create({ path }: { path: string }) { return { workspaceId: 'test-workspace', path, title: 'Test workspace' } },
  async startSession() { return undefined },
  /** 测试导航只记下目标，绝不启动模型。 */
  openSession(sessionId: string) { document.body.dataset.openedSession = sessionId },
}

const context = {
  slots,
  workspaces,
  // 新版 Host 把目录选择和会话导航放在独立的 UI 服务上。
  uiWorkspace: workspaces,
  effect(setup: () => void | (() => void | Promise<void>)) {
    const dispose = setup()
    if (typeof dispose === 'function') disposers.push(dispose)
    return () => {}
  },
}

window.__PO_PLUGIN__.factory(requireModule).apply(context)
window.addEventListener('pagehide', () => {
  for (const root of roots) root.unmount()
  for (const dispose of disposers.reverse()) void dispose()
}, { once: true })
