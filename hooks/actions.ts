import type { RenderSurface } from 'claude-code'

import type { EditorFile, Pos } from '../types'
import { unified } from './diff'
import type { Io } from './io'
import { commandOf } from './keys'
import { MENU_HEIGHT, MENU_ITEMS, MENU_WIDTH } from './protocol'
import type { InputEvent, MenuAction, Post } from './protocol'
import { MAX_EDITORS, dropFile, isDiffId, isEditorId, getFile, getOrder, historyOf, putDiff, putFile, serial, setHistory, setOrder } from './store'
import { clamp, edit, hash, indentOf, join, ordered, placeAt, record, redo, selectedText, split, undo } from './text'
import type { Doc, EditCommand, Sel } from './text'
import { follow, gutterWidth, hit } from './window'

/** What an action needs from the engine: its `$` and the surface the person is on. */
export type Ctx = { io: Io; surface: RenderSurface }
/** One change to a file; it runs inside the file's serial chain and never touches the chain itself. */
export type Act = (c: Ctx, f: EditorFile) => Promise<EditorFile>
export type Action =
  | 'save' | 'overwrite' | 'recreate' | 'undo' | 'redo' | 'copy' | 'cut' | 'paste' | 'selectAll'
  | 'reload' | 'keep' | 'diff' | 'cancel' | 'close' | 'discard' | 'saveClose'

const FLASH_MS = 2600
const MAX_BYTES = 4 * 1024 * 1024
const CLIPBOARDS = [['pbpaste'], ['wl-paste', '-n'], ['xclip', '-selection', 'clipboard', '-o']] as const

export const nameOf = (path: string): string => path.slice(path.lastIndexOf('/') + 1) || path
export const titleOf = (f: EditorFile): string => `${f.dirty ? '● ' : ''}${nameOf(f.path)}`
const reason = (err: unknown): string => (err instanceof Error ? err.message : String(err))
const same = (a: Pos, b: Pos): boolean => a.line === b.line && a.col === b.col
const docOf = (f: EditorFile): Doc => ({ lines: f.lines, cursor: f.cursor, anchor: f.anchor, goalCol: f.goalCol })
const selOf = (d: Sel): Sel => ({ cursor: d.cursor, anchor: d.anchor })
const withDoc = (f: EditorFile, d: Doc): EditorFile => ({ ...f, lines: d.lines, cursor: d.cursor, anchor: d.anchor, goalCol: d.goalCol })
const flashed = (f: EditorFile, text: string, now: number): EditorFile => ({ ...f, flash: { text, at: now } })

/** The hash of a file's text as the editor sees it: lines and eol round-tripped, so it matches `dirty`. */
export function digest(text: string): number {
  const { lines, eol } = split(text)
  return hash(join(lines, eol))
}

async function readText(io: Io, path: string): Promise<string> {
  const text = await io.read(path)
  if (typeof text !== 'string') throw new Error('not a text file')
  return text
}

/** Keeps the cursor in the window after an edit or a move. */
function followed(f: EditorFile): EditorFile {
  return { ...f, ...follow(f, f.view.rows, f.view.columns - gutterWidth(f.lines.length)) }
}

/** Applies one edit command and records it for undo. */
function typed(f: EditorFile, cmd: EditCommand, now: number): EditorFile {
  const r = edit(docOf(f), cmd, { pageRows: f.view.rows, indent: cmd.type === 'tab' ? indentOf(f.lines) : '  ' })
  if (r.change) {
    setHistory(f.id, record(historyOf(f.id), { change: r.change, before: selOf(f), after: selOf(r.doc), kind: r.kind, at: now }))
  }
  return followed(withDoc(f, r.doc))
}

/** Writes the result of an act: the dirty flag, the tab title when it flips, and the flash timer. */
async function commit(c: Ctx, before: EditorFile, after: EditorFile): Promise<EditorFile> {
  if (after === before) return after
  let next = after
  if (after.lines !== before.lines || after.base !== before.base || after.eol !== before.eol) {
    const dirty = hash(join(after.lines, after.eol)) !== after.base.hash
    if (dirty !== after.dirty) next = { ...after, dirty }
  }
  await putFile(c.io, next)
  if (next.dirty !== before.dirty) await c.io.open({ id: next.id, title: titleOf(next) }).catch(() => undefined)
  const { flash } = next
  if (flash && flash !== before.flash) {
    c.io.after(FLASH_MS, () => void run(c, next.id, async (_, f) => (f.flash?.at === flash.at ? { ...f, flash: undefined } : f)))
  }
  return next
}

/** Runs an act on one file inside its serial chain; a failure becomes a flash. */
export function run(c: Ctx, id: string, act: Act): Promise<EditorFile | undefined> {
  return serial(id, async () => {
    const before = await getFile(c.io, id)
    if (!before) return undefined
    let after = before
    try {
      after = await act(c, before)
    } catch (err) {
      after = flashed(before, `error: ${reason(err)}`, await c.io.now().catch(() => 0))
    }
    return commit(c, before, after)
  })
}

async function clipboardText(io: Io): Promise<string | undefined> {
  for (const argv of CLIPBOARDS) {
    try {
      const out = await io.run(argv)
      if (out.exitCode === 0) return out.stdout
    } catch {
      // Not installed here: try the next one.
    }
  }
  return undefined
}

const pasteAct: Act = async ({ io }, f) => {
  const now = await io.now()
  const text = await clipboardText(io)
  if (text === undefined) return flashed(f, 'paste needs pbpaste, wl-paste or xclip', now)
  return typed(f, { type: 'insert', text: text.replace(/\r\n/g, '\n') }, now)
}

async function copyOut({ io, surface }: Ctx, f: EditorFile): Promise<{ text: string; copied: boolean; note: string }> {
  const text = selectedText(docOf(f))
  const result = await io.copy({ text, surface })
  return { text, copied: result.isCopied, note: result.isCopied ? `✓ copied ${text.length} chars` : `copy failed: ${result.reason}` }
}

const copyAct: Act = async (c, f) => {
  if (!ordered(f)) return f
  const out = await copyOut(c, f)
  return flashed(f, out.note, await c.io.now())
}

const cutAct: Act = async (c, f) => {
  if (!ordered(f)) return f
  const out = await copyOut(c, f)
  const now = await c.io.now()
  return out.copied ? flashed(typed(f, { type: 'backspace' }, now), out.note, now) : flashed(f, out.note, now)
}

const selectAllAct: Act = async ({ io }, f) => typed(f, { type: 'selectAll' }, await io.now())

/** Selects the whole file and copies it, leaving the window where it is. */
const copyAllAct: Act = async (c, f) => {
  const all = edit(docOf(f), { type: 'selectAll' }, { pageRows: f.view.rows, indent: '  ' }).doc
  return copyAct(c, withDoc(f, all))
}

const undoAct: Act = async (_, f) => {
  const r = undo(docOf(f), historyOf(f.id))
  if (!r) return f
  setHistory(f.id, r.history)
  return followed(withDoc(f, r.doc))
}

const redoAct: Act = async (_, f) => {
  const r = redo(docOf(f), historyOf(f.id))
  if (!r) return f
  setHistory(f.id, r.history)
  return followed(withDoc(f, r.doc))
}

async function stamp(io: Io, path: string): Promise<{ mtimeMs: number; size: number }> {
  const { mtimeMs, size } = await io.stat(path)
  return { mtimeMs, size }
}

/** Saves; with `check`, first looks for a change on disk since the last load or save. */
async function saveWith({ io }: Ctx, f: EditorFile, check: boolean): Promise<EditorFile> {
  if (check) {
    const disk = await io.stat(f.path).catch(() => undefined)
    if (disk?.kind === 'file' && (disk.mtimeMs !== f.base.mtimeMs || disk.size !== f.base.size)) {
      const changed = digest(await readText(io, f.path).catch(() => '\u0000')) !== f.base.hash
      if (changed) return { ...f, banner: { kind: 'overwrite' } }
    }
  }
  const text = join(f.lines, f.eol)
  await io.write(f.path, text)
  const base = { hash: hash(text), ...(await stamp(io, f.path)) }
  return flashed({ ...f, base, banner: undefined }, '✓ saved', await io.now())
}

const saveAct: Act = (c, f) => saveWith(c, f, true)
const overwriteAct: Act = (c, f) => saveWith(c, f, false)

/** Replaces the text with what is on disk, keeping the cursor where it can. */
async function loaded(io: Io, f: EditorFile): Promise<EditorFile> {
  const text = await readText(io, f.path)
  const { mtimeMs, size } = await io.stat(f.path)
  const { lines, eol } = split(text)
  setHistory(f.id, { undo: [], redo: [] })
  return {
    ...f, lines, eol, cursor: clamp(lines, f.cursor), anchor: undefined, goalCol: undefined,
    top: Math.min(f.top, lines.length - 1), base: { hash: digest(text), mtimeMs, size }, banner: undefined,
  }
}

const reloadAct: Act = async ({ io }, f) => {
  try {
    return await loaded(io, f)
  } catch {
    return { ...f, banner: { kind: 'deleted' } }
  }
}

const keepAct: Act = async ({ io }, f) => {
  try {
    const text = await readText(io, f.path)
    return { ...f, base: { hash: digest(text), ...(await stamp(io, f.path)) }, banner: undefined }
  } catch {
    return { ...f, banner: { kind: 'deleted' } }
  }
}

const diffAct: Act = async ({ io }, f) => {
  const disk = split(await readText(io, f.path)).lines
  const id = `diff-${f.id}`
  const title = `Δ ${nameOf(f.path)}`
  await putDiff(io, id, { title, text: unified(disk, f.lines, { a: 'disk', b: 'editor' }) })
  await io.open({ id, title })
  return f
}

const cancelAct: Act = async (_, f) => ({ ...f, banner: undefined })

/** The disk check: a vanished file, a silent reload, or a banner when there are unsaved edits. */
export const checkAct: Act = async ({ io }, f) => {
  if (f.banner) return f
  const disk = await io.stat(f.path).catch(() => undefined)
  if (disk?.kind !== 'file') return { ...f, banner: { kind: 'deleted' } }
  if (disk.mtimeMs === f.base.mtimeMs && disk.size === f.base.size) return f
  const text = await readText(io, f.path)
  if (digest(text) === f.base.hash) return { ...f, base: { ...f.base, mtimeMs: disk.mtimeMs, size: disk.size } }
  if (f.dirty) return { ...f, banner: { kind: 'changed' } }
  return flashed(await loaded(io, f), '↻ reloaded from disk', await io.now())
}

const MENU_ACTS: Record<MenuAction, Act> = { copy: copyAct, cut: cutAct, paste: pasteAct, 'select all': selectAllAct }
const ACTS: Partial<Record<Action, Act>> = {
  save: saveAct, overwrite: overwriteAct, recreate: overwriteAct, undo: undoAct, redo: redoAct, copy: copyAct, cut: cutAct,
  paste: pasteAct, selectAll: selectAllAct, reload: reloadAct, keep: keepAct, diff: diffAct, cancel: cancelAct,
}

/** A button or menu press: the matching act in the file's chain, or a close. */
export async function perform(c: Ctx, id: string, action: Action): Promise<void> {
  const act = ACTS[action]
  if (act) await run(c, id, act)
  else if (action === 'saveClose') {
    const after = await run(c, id, saveAct)
    if (after && !after.dirty && !after.banner) await closeAndForget(c.io, id)
  } else await closeAndForget(c.io, id)
}

const within = (n: number, low: number, high: number): number => Math.min(Math.max(n, low), Math.max(low, high))

async function key(c: Ctx, f: EditorFile, ev: Extract<InputEvent, { kind: 'key' }>, now: number): Promise<EditorFile> {
  const g = f.menu ? { ...f, menu: undefined } : f
  const cmd = commandOf(ev)
  if (!cmd) return g
  if (cmd.type === 'save') return saveAct(c, g)
  if (cmd.type === 'undo') return undoAct(c, g)
  if (cmd.type === 'redo') return redoAct(c, g)
  if (cmd.type === 'paste') return pasteAct(c, g)
  if (cmd.type === 'copyAll') return copyAllAct(c, g)
  return typed(g, cmd, now)
}

async function pointer(c: Ctx, f: EditorFile, ev: Extract<InputEvent, { kind: 'pointer' }>): Promise<EditorFile> {
  const gutter = gutterWidth(f.lines.length)
  if (ev.type === 'up') return f.anchor && same(f.anchor, f.cursor) ? { ...f, anchor: undefined } : f
  if (ev.type === 'move') {
    const top = ev.y < 0 ? Math.max(0, f.top - 1) : ev.y >= f.view.rows ? Math.min(f.lines.length - 1, f.top + 1) : f.top
    const g = { ...f, top }
    return withDoc(g, placeAt(docOf(g), hit(g, gutter, ev.x, ev.y), true))
  }
  if (ev.button === 'right') {
    return { ...f, menu: { x: within(ev.x, 0, f.view.columns - MENU_WIDTH), y: within(ev.y, 0, f.view.rows - MENU_HEIGHT) } }
  }
  if (ev.button !== 'left' && ev.button !== undefined) return f
  const { menu } = f
  const g = { ...f, menu: undefined }
  if (menu && ev.x >= menu.x && ev.x < menu.x + MENU_WIDTH && ev.y >= menu.y && ev.y < menu.y + MENU_HEIGHT) {
    const label = MENU_ITEMS[ev.y - menu.y - 1]
    const enabled = label !== 'copy' && label !== 'cut' ? true : ordered(f) !== undefined
    return label && enabled ? MENU_ACTS[label](c, g) : g
  }
  const placed = placeAt(docOf(g), hit(g, gutter, ev.x, ev.y), false)
  return withDoc(g, { ...placed, anchor: placed.cursor })
}

/** The Client's post as an act: only the events past the ack, in order, then the ack and the size. */
export function applyPost(post: Post): Act {
  return async (c, f) => {
    const now = await c.io.now()
    let g: EditorFile = post.mount === f.input.mount ? f : { ...f, input: { mount: post.mount, ack: 0 } }
    for (const ev of post.events) {
      if (ev.seq <= g.input.ack) continue
      try {
        g = ev.kind === 'key' ? await key(c, g, ev, now) : await pointer(c, g, ev)
      } catch (err) {
        g = flashed(g, `error: ${reason(err)}`, now)
      }
      g = { ...g, input: { mount: post.mount, ack: ev.seq } }
    }
    const view = post.rows > 0 && post.columns > 0 ? { rows: post.rows, columns: post.columns } : g.view
    return { ...g, view, input: { mount: post.mount, ack: Math.max(g.input.ack, post.seq) } }
  }
}

/** Moves the cursor to a 1-based line and shows it a little below the top. */
function atLine(f: EditorFile, line: number): EditorFile {
  const cursor = clamp(f.lines, { line: line - 1, col: 0 })
  return { ...f, cursor, anchor: undefined, goalCol: undefined, top: Math.max(0, cursor.line - 5) }
}

async function open(io: Io, path: string, line: number | undefined): Promise<void> {
  const name = nameOf(path)
  const stat = await io.stat(path).catch(() => undefined)
  if (stat?.kind !== 'file') return io.toast(`pane-editor: not a file: ${path}`)
  if (stat.size > MAX_BYTES) return io.toast(`pane-editor: ${name} is larger than 4 MiB`)

  const c: Ctx = { io, surface: 'terminal' }
  let ids = await getOrder(io)
  for (const id of ids) {
    if ((await getFile(io, id))?.path !== path) continue
    const shown = await run(c, id, async (_, f) => (line === undefined ? f : atLine(f, line)))
    if (shown) await io.open({ id, title: titleOf(shown) })
    return
  }

  const text = await readText(io, path).catch(() => undefined)
  if (text === undefined) return io.toast(`pane-editor: could not read ${name}`)
  if (text.includes('\u0000')) return io.toast(`pane-editor: ${name} looks binary`)

  if (ids.length >= MAX_EDITORS) {
    const open = await Promise.all(ids.map(id => getFile(io, id)))
    const oldest = open.filter((f): f is EditorFile => f !== undefined && !f.dirty).sort((a, b) => a.openedAt - b.openedAt)[0]
    if (!oldest) return io.toast('pane-editor: 6 files have unsaved changes — save or close one first')
    await closeAndForget(io, oldest.id)
    ids = await getOrder(io)
  }

  const id = `ed-${Math.max(0, ...ids.map(i => Number(i.slice(3)))) + 1}`
  const { lines, eol } = split(text)
  const file = atLine(
    {
      id, path, lines, eol, cursor: { line: 0, col: 0 }, top: 0, left: 0,
      base: { hash: digest(text), mtimeMs: stat.mtimeMs, size: stat.size }, dirty: false,
      view: { rows: 20, columns: 80 }, openedAt: await io.now(), input: { mount: '', ack: 0 },
    },
    line ?? 1,
  )
  await putFile(io, file)
  await setOrder(io, [...ids, id])
  await io.open({ id, title: titleOf(file) })
}

/** Opens a file in an editor pane, or shows the one already open; `line` is 1-based. */
export function openFile(io: Io, path: string, line?: number): Promise<void> {
  return serial('open', () => open(io, path, line)).catch(err => io.toast(`pane-editor: ${reason(err)}`))
}

/** Forgets an editor that closed: its file, its place in the order. */
export async function forget(io: Io, id: string): Promise<void> {
  await dropFile(io, id)
  await setOrder(io, (await getOrder(io)).filter(other => other !== id))
}

/**
 * A close request: a dirty file the person asks to close stays open behind the close banner (false);
 * anything else is forgotten (true). A diff pane only drops its text.
 */
export async function closeRequest(io: Io, id: string, origin: 'plugin' | 'person' | 'unload'): Promise<boolean> {
  if (isDiffId(id)) {
    await putDiff(io, id, null)
    return true
  }
  if (!isEditorId(id)) return true
  if (origin === 'person' && (await getFile(io, id))?.dirty) {
    await run({ io, surface: 'terminal' }, id, async (_, f) => ({ ...f, banner: { kind: 'close' } }))
    return false
  }
  await forget(io, id)
  return true
}

/** Closes a pane of ours and forgets what it held, whether or not our own `ui.close` hook saw the call. */
async function closeAndForget(io: Io, id: string): Promise<void> {
  await io.close(id)
  await closeRequest(io, id, 'plugin')
}

/** Checks one open file against the disk. */
export async function checkPath(io: Io, path: string): Promise<void> {
  for (const id of await getOrder(io)) {
    if ((await getFile(io, id))?.path === path) await run({ io, surface: 'terminal' }, id, checkAct)
  }
}

/** Checks every open file against the disk. */
export async function checkAll(io: Io): Promise<void> {
  for (const id of await getOrder(io)) await run({ io, surface: 'terminal' }, id, checkAct)
}
