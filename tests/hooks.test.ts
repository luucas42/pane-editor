import type { On } from 'claude-code'
import type { Engine } from 'claude-code/testing'
import { describe, expect, test } from 'claude-code/testing'

import type { EditorFile } from '../types'
import { closeRequest } from '../hooks/actions'
import { getFile, putFile, setOrder } from '../hooks/store'
import { CWD, TYPED, asData, key, memoryIo, messageAt, paneAt, post, world } from './world'

const A = `${CWD}/a.ts`
const POINTER = { kind: 'pointer', button: 'left' } as const

/** The world with `text` open in ed-1 and its pane mounted, so a post reaches the plugin as a Client's does. */
async function editing($: Engine, on: On, text: string) {
  const w = world(on, { [A]: text })
  await $.command.run({ ...TYPED, command: 'open', args: A })
  const ui = await $.ui.mount({ ...paneAt('ed-1'), surface: 'terminal' })
  const send = (events: Parameters<typeof post>[1], extra: Parameters<typeof post>[2] = {}, id = 'ed-1') =>
    ui.post(asData(post(id, events, extra)))
  return { w, ui, send, file: () => w.latest.get('ed-1') }
}

describe('opening', () => {
  test('/open of a file opens pane ed-1 with its lines, at the given line, without focus', async ($, on) => {
    const w = world(on, { [A]: 'one\ntwo\nthree\n' })
    await $.session.start({ cwd: CWD, surface: 'terminal', isInteractive: true })
    const out = await $.command.run({ ...TYPED, command: 'open', args: 'a.ts:2' })
    expect(out.text).toBe('')
    expect(w.opened).toEqual([{ id: 'ed-1', title: 'a.ts' }])
    expect(w.latest.get('ed-1')).toMatchObject({ path: A, lines: ['one', 'two', 'three', ''], eol: '\n', cursor: { line: 1, col: 0 }, dirty: false })
    expect(w.state.order).toEqual(['ed-1'])
  })

  test('/open without an argument shows usage, and a missing file a toast', async ($, on) => {
    const w = world(on)
    expect((await $.command.run({ ...TYPED, command: 'open', args: '' })).text).toBe('usage: /open <path>[:line]')
    await $.command.run({ ...TYPED, command: 'open', args: 'nope.ts' })
    expect(w.toasts).toEqual([`pane-editor: not a file: ${CWD}/nope.ts`])
    expect(w.opened).toEqual([])
  })

  test('a binary file is refused', async ($, on) => {
    const w = world(on, { [A]: 'ab\u0000cd' })
    await $.command.run({ ...TYPED, command: 'open', args: A })
    expect(w.toasts).toEqual(['pane-editor: a.ts looks binary'])
  })

  test('opening an open file again shows it and moves the cursor', async ($, on) => {
    const w = world(on, { [A]: Array.from({ length: 30 }, (_, i) => `line ${i + 1}`).join('\n') })
    await $.command.run({ ...TYPED, command: 'open', args: A })
    await $.command.run({ ...TYPED, command: 'open', args: `${A}:20` })
    expect(w.state.order).toEqual(['ed-1'])
    expect(w.opened.map(o => o.id)).toEqual(['ed-1', 'ed-1'])
    expect(w.latest.get('ed-1')).toMatchObject({ cursor: { line: 19, col: 0 }, top: 14 })
  })

  test('a 7th file closes the oldest clean editor; with all dirty, none opens', async ($, on) => {
    const w = world(on, Object.fromEntries(Array.from({ length: 8 }, (_, i) => [`${CWD}/f${i + 1}.ts`, `file ${i + 1}`])))
    for (let i = 1; i <= 6; i++) await $.command.run({ ...TYPED, command: 'open', args: `f${i}.ts` })
    await $.command.run({ ...TYPED, command: 'open', args: 'f7.ts' })
    expect(w.closed).toEqual(['ed-1'])
    expect(w.state.order).toEqual(['ed-2', 'ed-3', 'ed-4', 'ed-5', 'ed-6', 'ed-7'])
    expect(w.latest.get('ed-1')).toBeNull()

    const ui = await $.ui.mount({ ...paneAt('ed-2'), surface: 'terminal' })
    for (let i = 2; i <= 7; i++) await ui.post(asData(post(`ed-${i}`, [key(1, 'x')])))
    await $.command.run({ ...TYPED, command: 'open', args: 'f8.ts' })
    expect(w.toasts).toEqual(['pane-editor: 6 files have unsaved changes — save or close one first'])
    expect(w.state.order).toHaveLength(6)
  })
})

describe('input', () => {
  test('keys a, b, return give two lines and ack seq 3', async ($, on) => {
    const { w, send, file } = await editing($, on, 'x')
    await send([key(1, 'a'), key(2, 'b'), key(3, 'return')])
    expect(file()).toMatchObject({ lines: ['ab', 'x'], cursor: { line: 1, col: 0 }, dirty: true, input: { mount: 'm1', ack: 3 } })
    expect(w.opened.at(-1)).toEqual({ id: 'ed-1', title: '● a.ts' })
  })

  test('a replayed message does not apply its keys twice', async ($, on) => {
    const { send, file } = await editing($, on, 'x')
    await send([key(1, 'a'), key(2, 'b')])
    await send([key(1, 'a'), key(2, 'b')])
    expect(file()?.lines).toEqual(['abx'])
  })

  test('two messages sent together apply each key once', async ($, on) => {
    const { send, file } = await editing($, on, '')
    await Promise.all([send([key(1, 'a')]), send([key(1, 'a'), key(2, 'b')])])
    expect(file()?.lines).toEqual(['ab'])
  })

  test('a new mount resets the ack', async ($, on) => {
    const { send, file } = await editing($, on, '')
    await send([key(1, 'a'), key(2, 'b')])
    await send([key(1, 'c')], { mount: 'm2' })
    expect(file()).toMatchObject({ lines: ['abc'], input: { mount: 'm2', ack: 1 } })
  })

  test('a message that is not for an open editor changes nothing', async ($, on) => {
    const { w, ui, send, file } = await editing($, on, 'x')
    await send([key(1, 'a')], {}, 'ed-9')
    await ui.post('hello')
    await ui.post({ id: 'ed-1' })
    expect(file()).toMatchObject({ lines: ['x'], dirty: false })
    expect(w.latest.has('ed-9')).toBe(false)
  })

  test('ctrl+s writes the file and clears dirty, and the flash goes away', async ($, on) => {
    const { w, send, file } = await editing($, on, 'x')
    await send([key(1, 'a')])
    await send([key(2, 's', { ctrl: true })])
    expect(w.disk.get(A)?.text).toBe('ax')
    expect(file()).toMatchObject({ dirty: false, flash: { text: '✓ saved' } })
    expect(w.opened.map(o => o.title)).toEqual(['a.ts', '● a.ts', 'a.ts'])
    await w.clock.advance(2600)
    expect(file()?.flash).toBeUndefined()
  })

  test('ctrl+v pastes the clipboard as one step that ctrl+z and ctrl+y walk', async ($, on) => {
    const { send, file } = await editing($, on, 'x')
    await send([key(1, 'v', { ctrl: true })])
    expect(file()?.lines).toEqual(['pastedx'])
    await send([key(2, 'z', { ctrl: true })])
    expect(file()).toMatchObject({ lines: ['x'], dirty: false })
    await send([key(3, 'y', { ctrl: true })])
    expect(file()?.lines).toEqual(['pastedx'])
  })

  test('paste without a clipboard tool flashes why', async ($, on) => {
    const w = world(on, { [A]: 'x' })
    w.state.clipboard = undefined
    await $.command.run({ ...TYPED, command: 'open', args: A })
    const ui = await $.ui.mount({ ...paneAt('ed-1'), surface: 'terminal' })
    await ui.post(asData(post('ed-1', [key(1, 'v', { ctrl: true })])))
    expect(w.latest.get('ed-1')?.flash?.text).toBe('paste needs pbpaste, wl-paste or xclip')
  })

  test('a drag selects, and the right-click menu copies the selection', async ($, on) => {
    const { w, send, file } = await editing($, on, 'hello\nworld')
    const g = 6
    await send([
      { seq: 1, type: 'down', x: g + 1, y: 0, ...POINTER },
      { seq: 2, type: 'move', x: g + 3, y: 1, ...POINTER },
      { seq: 3, type: 'up', x: g + 3, y: 1, ...POINTER },
    ])
    expect(file()).toMatchObject({ cursor: { line: 1, col: 3 }, anchor: { line: 0, col: 1 } })

    await send([{ seq: 4, kind: 'pointer', type: 'down', x: 70, y: 18, button: 'right' }])
    expect(file()?.menu).toEqual({ x: 66, y: 14 })
    await send([{ seq: 5, type: 'down', x: 67, y: 15, ...POINTER }])
    expect(w.copied).toEqual(['ello\nwor'])
    expect(file()?.menu).toBeUndefined()
    expect(file()?.flash?.text).toBe('✓ copied 8 chars')
  })
})

describe('closing', () => {
  test('a close by the plugin forgets the file, its order slot and its history', async ($, on) => {
    const { w, ui, file } = await editing($, on, 'x')
    w.disk.delete(A)
    await $.tool.call({ tool: 'Write', file_path: A, content: '' })
    await ui.redraw()
    await ui.press({ key: 'banner-close' })
    expect(file()).toBeNull()
    expect(w.state.order).toEqual([])
  })

  test('a diff pane shows the unified diff and forgets its text when it closes', async ($, on) => {
    const { w, ui, send } = await editing($, on, 'x')
    await send([key(1, 'a')])
    w.put(A, 'changed')
    await $.tool.call({ tool: 'Write', file_path: A, content: 'changed' })
    await ui.redraw()
    await ui.press({ key: 'banner-diff' })
    expect(w.diffs.get('diff-ed-1')?.text).toContain('+ax')
    expect(w.opened.at(-1)).toEqual({ id: 'diff-ed-1', title: 'Δ a.ts' })

    const diff = await $.ui.mount({ ...paneAt('diff-ed-1'), surface: 'terminal' })
    expect(await diff.find({ type: 'Code' })).toBeDefined()
    await diff.press({ key: 'close' })
    expect(w.closed).toEqual(['diff-ed-1'])
    expect(w.diffs.get('diff-ed-1')).toBeNull()
  })
})

describe('closing as the person', () => {
  // The kit cannot raise a person's close (`ui.close` is not callable on its `$`, and a hook may not
  // rewrite an origin), so the decision is tested on its own over an in-memory Io.
  const base = (id: string, dirty: boolean): EditorFile => ({
    id, path: A, lines: ['x'], eol: '\n', cursor: { line: 0, col: 0 }, top: 0, left: 0,
    base: { hash: 0, mtimeMs: 1, size: 1 }, dirty, view: { rows: 20, columns: 80 }, openedAt: 1, input: { mount: '', ack: 0 },
  })

  test('a person close of a dirty file is refused and raises the close banner', async () => {
    const io = memoryIo()
    await putFile(io, base('ed-1', true))
    expect(await closeRequest(io, 'ed-1', 'person')).toBe(false)
    expect((await getFile(io, 'ed-1'))?.banner).toEqual({ kind: 'close' })
  })

  test('a person close of a clean file, and any close by the plugin, forgets the file', async () => {
    const io = memoryIo()
    await putFile(io, base('ed-2', false))
    await putFile(io, base('ed-3', true))
    await setOrder(io, ['ed-2', 'ed-3'])
    expect(await closeRequest(io, 'ed-2', 'person')).toBe(true)
    expect(await closeRequest(io, 'ed-3', 'plugin')).toBe(true)
    expect(await getFile(io, 'ed-2')).toBeUndefined()
    expect(await getFile(io, 'ed-3')).toBeUndefined()
  })
})

describe('the disk', () => {
  test('the ticker reloads a clean file silently and flashes it', async ($, on) => {
    const { w, file } = await editing($, on, 'x')
    await $.session.start({ cwd: CWD, surface: 'terminal', isInteractive: true })
    w.put(A, 'changed\nlines')
    await w.clock.advance(2000)
    expect(file()).toMatchObject({ lines: ['changed', 'lines'], dirty: false, flash: { text: '↻ reloaded from disk' } })
    expect(file()?.banner).toBeUndefined()
  })

  test('an Edit tool call is checked right away; unsaved edits get the changed banner and reload takes the disk', async ($, on) => {
    const { w, ui, send, file } = await editing($, on, 'x')
    await send([key(1, 'a')])
    w.put(A, 'from claude')
    await $.tool.call({ tool: 'Edit', file_path: A, old_string: 'x', new_string: 'y' })
    expect(file()).toMatchObject({ lines: ['ax'], banner: { kind: 'changed' }, dirty: true })
    await ui.redraw()
    await ui.press({ key: 'banner-reload' })
    expect(file()).toMatchObject({ lines: ['from claude'], dirty: false })
    expect(file()?.banner).toBeUndefined()
  })

  test('keep mine accepts the disk as the base so the next save does not ask', async ($, on) => {
    const { w, ui, send, file } = await editing($, on, 'x')
    await send([key(1, 'a')])
    w.put(A, 'other')
    await $.tool.call({ tool: 'Write', file_path: A, content: 'other' })
    await ui.redraw()
    await ui.press({ key: 'banner-keep' })
    expect(file()?.banner).toBeUndefined()
    expect(file()?.dirty).toBe(true)
    await send([key(2, 's', { ctrl: true })])
    expect(w.disk.get(A)?.text).toBe('ax')
  })

  test('a deleted file shows the deleted banner and save recreates it', async ($, on) => {
    const { w, ui, send, file } = await editing($, on, 'x')
    w.disk.delete(A)
    await $.tool.call({ tool: 'Write', file_path: A, content: '' })
    expect(file()?.banner).toEqual({ kind: 'deleted' })
    await ui.redraw()
    await send([key(1, 'a')])
    await ui.press({ key: 'banner-recreate' })
    expect(w.disk.get(A)?.text).toBe('ax')
    expect(file()?.banner).toBeUndefined()
  })

  test('saving over a changed disk asks first; overwrite writes anyway', async ($, on) => {
    const { w, ui, send, file } = await editing($, on, 'x')
    await send([key(1, 'a')])
    w.put(A, 'theirs')
    await send([key(2, 's', { ctrl: true })])
    expect(file()?.banner).toEqual({ kind: 'overwrite' })
    expect(w.disk.get(A)?.text).toBe('theirs')
    await ui.redraw()
    await ui.press({ key: 'banner-overwrite' })
    expect(w.disk.get(A)?.text).toBe('ax')
    expect(file()?.banner).toBeUndefined()
  })
})

describe('the pane', () => {
  test('draws header, the Client and footer within bodyRows, with the banner taking one row', async ($, on) => {
    const { w, ui, send } = await editing($, on, 'hello\nworld')
    const client = async () => (await ui.findAll({ type: 'Client' }))[0]
    expect((await client())?.props).toMatchObject({ key: 'ed', height: 22 })
    expect(await ui.find({ type: 'Button', text: 'save' })).toBeDefined()
    await send([key(1, 'a')])
    w.put(A, 'z')
    await $.tool.call({ tool: 'Write', file_path: A, content: 'z' })
    await ui.redraw()
    expect(w.latest.get('ed-1')?.banner).toEqual({ kind: 'changed' })
    expect((await client())?.props.height).toBe(21)
    expect(await ui.find({ type: 'Text', text: '⚠ a.ts changed on disk' })).toBeDefined()
    expect(await ui.find({ type: 'Button', text: 'keep mine' })).toBeDefined()
  })

  test('the Client draws the rows, forwards keys, and shows the selection buttons', async ($, on) => {
    const { w, ui, file } = await editing($, on, 'hello\nworld')
    await ui.resize({ columns: 60, rows: 10, in: 'ed' })
    await ui.advance(250)
    expect(file()?.view).toEqual({ rows: 10, columns: 60 })
    expect(await ui.find({ in: 'ed', type: 'Text', text: /hello/ })).toBeDefined()

    await ui.key({ key: 'a', in: 'ed' })
    await ui.key({ key: 'x', ctrl: true, in: 'ed' })
    expect(file()).toMatchObject({ lines: ['ahello', 'world'], input: { ack: 2 } })
    expect(await ui.find({ in: 'ed', type: 'Text', text: /ahello/ })).toBeDefined()

    await ui.pointer({ type: 'down', x: 8, y: 0, button: 'left', in: 'ed' })
    await ui.pointer({ type: 'move', x: 11, y: 1, button: 'left', in: 'ed' })
    await ui.pointer({ type: 'up', x: 11, y: 1, button: 'left', in: 'ed' })
    expect(file()?.anchor).toEqual({ line: 0, col: 2 })
    await ui.redraw()
    await ui.press({ key: 'cut' })
    expect(w.copied).toEqual(['ello\nworld'])
    expect(file()?.lines).toEqual(['ah'])
    await ui.redraw()
    await ui.press({ key: 'undo' })
    expect(file()?.lines).toEqual(['ahello', 'world'])
  })

  test('the wheel moves our own window and the engine keeps its own', async ($, on) => {
    const { file } = await editing($, on, Array.from({ length: 50 }, (_, i) => `l${i}`).join('\n'))
    const scroll = { component: 'Pane', requestId: 'ed-1', offset: 0, by: 1, bodyRows: 24, contentRows: 24, origin: { kind: 'person' } } as const
    expect(await $.ui.scroll(scroll)).toEqual({})
    expect(file()?.top).toBe(3)
    await $.ui.scroll({ ...scroll, by: -10 })
    expect(file()?.top).toBe(0)
  })

  test('other surfaces and closed files draw a dim note, never throw', async ($, on) => {
    const w = world(on, { [A]: 'x' })
    await $.command.run({ ...TYPED, command: 'open', args: A })
    const desktop = await $.ui.mount({ ...paneAt('ed-1'), surface: 'desktop' })
    expect(await desktop.find({ type: 'Text', text: 'open in the terminal' })).toBeDefined()
    const gone = await $.ui.mount({ ...paneAt('ed-4'), surface: 'terminal' })
    expect(await gone.find({ type: 'Text', text: 'closed' })).toBeDefined()
    expect(w.latest.get('ed-4')).toBeUndefined()
  })
})

describe('links in the transcript', () => {
  test('backticked paths of existing files become pressable links that open the editor', async ($, on) => {
    const w = world(on, { [A]: 'one\ntwo\nthree\nfour' })
    const ui = await $.ui.mount({ ...messageAt('m1', 'see `a.ts:3` and `missing.ts` and `x`', true), surface: 'terminal' })
    const md = await ui.find({ type: 'Markdown' })
    expect(md?.props.text).toBe('see [`a.ts:3`](file:///proj/a.ts#L3) and `missing.ts` and `x`')
    expect(md?.props.pressableLinks).toEqual(['file:///proj/a.ts#L3'])
    expect(await ui.find({ type: 'Text', text: '● ' })).toBeDefined()
    await ui.press({ key: 'm-m1', link: { href: 'file:///proj/a.ts#L3' } })
    expect(w.latest.get('ed-1')).toMatchObject({ path: A, cursor: { line: 2, col: 0 } })
  })

  test('a reply with no known path is left to the engine', async ($, on) => {
    world(on)
    const ui = await $.ui.mount({ ...messageAt('m2', 'nothing to see in `nope.ts`'), surface: 'terminal' })
    expect(await ui.find({ type: 'Text', text: 'engine row' })).toBeDefined()
    expect(await ui.find({ type: 'Markdown' })).toBeUndefined()
  })

  test('Read, Edit and Write rows keep the engine row and add an open link', async ($, on) => {
    const w = world(on, { [A]: 'x' })
    const ui = await $.ui.mount({
      plugin: 'pane-editor',
      surface: 'terminal',
      component: 'ToolUse',
      requestId: 'tu-1',
      props: { tool_use_id: 'tu-1', tool: 'Read', input: { file_path: A }, isRunning: false, isErrored: false, isInterrupted: false } as never,
    })
    expect(await ui.find({ type: 'Text', text: 'engine row' })).toBeDefined()
    const md = await ui.find({ type: 'Markdown' })
    expect(md?.props.text).toBe('  ↗ [open in editor](file:///proj/a.ts)')
    await ui.press({ key: 't-tu-1', link: { href: 'file:///proj/a.ts' } })
    expect(w.state.order).toEqual(['ed-1'])
  })
})
