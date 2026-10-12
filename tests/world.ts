import type { JsonValue, On } from 'claude-code'
import { mock } from 'claude-code/testing'

import type { DiffView, EditorFile } from '../types'
import type { Io } from '../hooks/io'
import type { InputEvent, Post } from '../hooks/protocol'

export const T0 = 1_000_000
export const CWD = '/proj'
export const TYPED = {
  origin: { kind: 'composer' },
  presentation: { isFullscreen: true, columns: 314 },
} as const

export const key = (seq: number, k: string, mods: { ctrl?: true; shift?: true; meta?: true } = {}): InputEvent => ({ seq, kind: 'key', key: k, ...mods })
/** A Client post as the plain data `ui.post` takes. */
export const asData = (p: Post): JsonValue => p as unknown as JsonValue
export const post = (id: string, events: InputEvent[], extra: Partial<Post> = {}): Post => ({
  id, mount: 'm1', seq: events[events.length - 1]?.seq ?? 0, events, rows: 20, columns: 80, ...extra,
})

export const messageAt = (requestId: string, text: string, isFirstOfReply = false) => ({
  plugin: 'pane-editor',
  component: 'AssistantMessage' as const,
  requestId,
  props: { text, isFirstOfReply },
})

export const paneAt = (id: string, bodyRows = 24, bodyColumns = 100) => ({
  plugin: 'pane-editor',
  component: 'Pane' as const,
  requestId: id,
  props: { title: id, isFocused: false, bodyColumns, placement: 'dock' as const, scroll: { offset: 0, bodyRows }, view: {} },
})

/**
 * The engine beneath the plugin: a clock, an in-memory disk, and recorders for panes, toasts and copies.
 * `peek` reads what the plugin wrote to `$.state` through a beneath `state.set` hook.
 */
export function world(on: On, files: Record<string, string> = {}) {
  const clock = mock.clock(on, { now: T0 })
  const disk = new Map<string, { text: string; mtimeMs: number }>()
  let tick = T0
  const put = (path: string, text: string) => void disk.set(path, { text, mtimeMs: ++tick })
  for (const [path, text] of Object.entries(files)) put(path, text)

  const opened: Array<{ id: string; title?: string; focus?: true }> = []
  const closed: string[] = []
  const toasts: string[] = []
  const copied: string[] = []
  const written: string[] = []
  const latest = new Map<string, EditorFile | null>()
  const diffs = new Map<string, DiffView | null>()
  const state = { order: [] as string[], clipboard: 'pasted' as string | undefined }

  on('state.set', (_, e, next) => {
    const value = e.value as unknown
    if (e.key === 'files') latest.set(e.id as string, value as EditorFile | null)
    else if (e.key === 'diffs') diffs.set(e.id as string, value as DiffView | null)
    else if (e.key === 'order') state.order = value as string[]
    return next(e)
  })
  on('fs.stat', (_, e) => {
    const f = disk.get(e.path)
    if (!f) return { deny: 'ENOENT' }
    return { value: { kind: 'file' as const, size: f.text.length, mtimeMs: f.mtimeMs, isLink: false } }
  })
  on('fs.read', (_, e) => {
    const f = disk.get(e.path)
    return f ? { value: f.text } : { deny: 'ENOENT' }
  })
  on('fs.write', (_, e) => {
    put(e.path, e.text)
    written.push(e.path)
    return { value: undefined }
  })
  on('ui.open', (_, e) => {
    opened.push({ id: e.id, title: e.title, ...(e.focus ? { focus: e.focus } : {}) })
    return { value: { isPlaced: true as const } }
  })
  on('ui.close', (_, e) => {
    closed.push(e.id)
    return { value: undefined }
  })
  on('ui.toast', (_, e) => {
    toasts.push(e.text)
    return { value: undefined }
  })
  on('ui.copy', (_, e) => {
    copied.push(e.text)
    return { value: { isCopied: true as const } }
  })
  on('ui.render', (_, e) => _.ui.resolve(e).Text({ children: 'engine row' }))
  on('tool.call', () => ({ result: 'ok' as never }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('session.cwd', () => ({ value: CWD }))
  on('command.register', (_, e) => ({ value: { command: e.name } }))
  on('process.run', (_, e) => {
    const out = state.clipboard
    return { value: { exitCode: out === undefined ? 1 : 0, stdout: out ?? '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
  })
  return { clock, disk, put, opened, closed, toasts, copied, written, latest, diffs, state }
}

/** An Io over memory alone, for tests of the logic that never touches a disk. */
export function memoryIo(): Io {
  const files = new Map<string, EditorFile | null>()
  let order: string[] | undefined
  const nothing = () => Promise.reject(new Error('not in this test'))
  return {
    stat: nothing, read: nothing, write: nothing, run: nothing, copy: nothing,
    toast: () => undefined,
    open: async () => undefined,
    close: async () => undefined,
    now: async () => T0,
    after: () => undefined,
    getFile: async id => files.get(id),
    setFile: async (id, file) => void files.set(id, file),
    getOrder: async () => order,
    setOrder: async ids => void (order = ids),
    setDiff: async () => undefined,
  }
}
