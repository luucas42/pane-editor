import type { EngineInterface, Register, RenderSurface } from 'claude-code'

import { applyPost, checkAll, checkPath, closeRequest, openFile, perform, run } from './actions'
import type { Action } from './actions'
import type { Io } from './io'
import { hrefOf, linkify, parseHref, pathTokens, resolvePath, splitLoc } from './links'
import type { InputEvent, Post } from './protocol'
import { getFile, historyOf, isDiffId, isEditorId } from './store'
import { clamp } from './text'
import { clientProps, diffView, editorView, notice } from './view'

const CHECK_MS = 2000
const STAT_TTL_MS = 10_000
const EDIT_TOOLS = ['Edit', 'Write', 'MultiEdit', 'NotebookEdit']
const LINKED_TOOLS = ['Read', 'Edit', 'Write', 'MultiEdit', 'NotebookEdit']
const USAGE = 'usage: /open <path>[:line]'

/** Every engine call the editor makes, spelled out here so `claude plugin validate` can follow `$`. */
const ioOf = ($: EngineInterface): Io => ({
  stat: path => $.fs.stat(path),
  read: async path => {
    const text = await $.fs.read(path)
    if (typeof text !== 'string') throw new Error('not a text file')
    return text
  },
  write: (path, text) => $.fs.write(path, text),
  run: argv => $.process.run(argv),
  copy: args => $.ui.copy(args),
  toast: text => $.ui.toast(text),
  open: args => $.ui.open(args),
  close: id => $.ui.close({ id }),
  now: () => $.clock.now(),
  after: (ms, fn) => void $.clock.after(ms, fn),
  getFile: async id => (await $.state.get({ plugin: 'pane-editor', key: 'files', id } as const)).value,
  setFile: async (id, file) => void (await $.state.set({ plugin: 'pane-editor', key: 'files', id } as const, file)),
  getOrder: async () => (await $.state.get({ plugin: 'pane-editor', key: 'order' } as const)).value,
  setOrder: async ids => void (await $.state.set({ plugin: 'pane-editor', key: 'order' } as const, ids)),
  setDiff: async (id, diff) => void (await $.state.set({ plugin: 'pane-editor', key: 'diffs', id } as const, diff)),
})

/** Whether a path is a file, remembered for a few seconds so a long reply is not stat'ed on every draw. */
const known = new Map<string, { at: number; isFile: boolean }>()

async function isFile($: EngineInterface, path: string): Promise<boolean> {
  const seen = known.get(path)
  if (seen && Date.now() - seen.at < STAT_TTL_MS) return seen.isFile
  const isFile = (await $.fs.stat(path).catch(() => undefined))?.kind === 'file'
  known.set(path, { at: Date.now(), isFile })
  return isFile
}

/** The path a file-touching tool names, if it names one. */
function pathOf(input: unknown): string | undefined {
  const { file_path: file, notebook_path: notebook } = (input ?? {}) as { file_path?: unknown; notebook_path?: unknown }
  const path = typeof file === 'string' ? file : notebook
  return typeof path === 'string' ? path : undefined
}

function openHref($: EngineInterface, href: string): void {
  const target = parseHref(href)
  if (target) void openFile(ioOf($), target.path, target.line)
}

/** A post from a Client, or undefined for anything else that arrives at `ui.message`. */
function postOf(data: unknown): Post | undefined {
  const d = data as Partial<Post> | null
  if (typeof d?.id !== 'string' || typeof d.mount !== 'string' || typeof d.seq !== 'number') return undefined
  const events = Array.isArray(d.events) ? d.events.filter((e): e is InputEvent => typeof e?.seq === 'number') : []
  return { id: d.id, mount: d.mount, seq: d.seq, events, rows: Number(d.rows) || 0, columns: Number(d.columns) || 0 }
}

export const register: Register = on => {
  let ticker: { cancel: () => void } | undefined
  let isChecking = false

  on('session.start', async ($, e, next) => {
    try {
      await $.command.register({ name: 'open', description: 'Open a file in an editor pane', argumentHint: '<path>[:line]', immediate: true })
      ticker?.cancel()
      ticker = $.clock.every(CHECK_MS, () => {
        if (isChecking) return
        isChecking = true
        void checkAll(ioOf($)).catch(() => undefined).finally(() => void (isChecking = false))
      })
    } catch {
      // The editor is a bonus: never hold the session up.
    }
    return next(e)
  })

  on('command.run', { command: 'open' }, async ($, e) => {
    const arg = e.args.trim()
    if (arg === '') return { text: USAGE }
    const { file, line } = splitLoc(arg)
    await openFile(ioOf($), resolvePath(file, await $.session.cwd()), line)
    return { text: '' }
  })

  on('ui.render', { component: 'Pane' }, async ($, e, next) => {
    const id = e.requestId
    if (!isEditorId(id) && !isDiffId(id)) return next(e)
    const { Text } = $.ui.resolve(e)
    try {
      if (e.surface !== 'terminal') return notice({ Text }, 'open in the terminal')
      const kit = $.ui.resolve(e)
      const press = (target: string, action: Action, surface: RenderSurface): void => void perform({ io: ioOf($), surface }, target, action).catch(() => undefined)
      if (isDiffId(id)) {
        const { value } = await $.state.get({ plugin: 'pane-editor', key: 'diffs', id } as const)
        return diffView(kit, value ?? undefined, surface => press(id, 'close', surface))
      }
      const { value: file } = await $.state.get({ plugin: 'pane-editor', key: 'files', id } as const)
      if (!file) return notice({ Text }, 'closed')
      const history = historyOf(id)
      const room = { bodyRows: e.props.scroll.bodyRows, bodyColumns: e.props.bodyColumns, canUndo: history.undo.length > 0, canRedo: history.redo.length > 0 }
      return editorView(kit, file, room, press)
    } catch (err) {
      return notice({ Text }, `pane-editor: ${err instanceof Error ? err.message : String(err)}`)
    }
  })

  on('ui.message', async ($, e, next) => {
    const post = postOf(e.data)
    if (!post || !isEditorId(post.id) || !(await getFile(ioOf($), post.id))) return next(e)
    const after = await run({ io: ioOf($), surface: e.surface }, post.id, applyPost(post))
    return after ? { props: clientProps(after) } : next(e)
  }).catch(($, e, next) => next(e))

  on('ui.scroll', async ($, e, next) => {
    if (e.component !== 'Pane' || !isEditorId(e.requestId)) return next(e)
    const step = Math.sign(e.by) * Math.max(3, Math.abs(e.by))
    await run({ io: ioOf($), surface: 'terminal' }, e.requestId, async (_, f) => ({ ...f, top: clamp(f.lines, { line: f.top + step, col: 0 }).line }))
    return {}
  }).catch(($, e, next) => next(e))

  on('ui.close', async ($, e, next) => {
    return (await closeRequest(ioOf($), e.id, e.origin.kind)) ? next(e) : { deny: 'unsaved changes' }
  }).catch(($, e, next) => next(e))

  on('tool.call', async ($, e, next) => {
    const result = await next(e)
    try {
      const path = EDIT_TOOLS.includes(String(e.tool)) ? pathOf(e) : undefined
      if (path !== undefined) await checkPath(ioOf($), resolvePath(path, await $.session.cwd()))
    } catch {
      // A failed check only waits for the next tick.
    }
    return result
  }).catch(($, e, next) => next(e))

  on('ui.render', { component: 'AssistantMessage' }, async ($, e, next) => {
    const tokens = pathTokens(e.props.text)
    if (tokens.length === 0) return next(e)
    const cwd = await $.session.cwd()
    const hrefs = new Map<string, string>()
    for (const token of tokens) {
      const { file, line } = splitLoc(token)
      const path = resolvePath(file, cwd)
      if (await isFile($, path)) hrefs.set(token, hrefOf(path, line))
    }
    if (hrefs.size === 0) return next(e)
    const { Box, Text, Markdown } = $.ui.resolve(e)
    const md = (
      <Markdown
        key={`m-${e.requestId}`}
        text={linkify(e.props.text, hrefs)}
        onLinkPress={link => openHref($, link.href)}
        pressableLinks={[...hrefs.values()]}
      />
    )
    return e.props.isFirstOfReply ? (
      <Box flexDirection="row">
        <Text>{'● '}</Text>
        {md}
      </Box>
    ) : (
      md
    )
  }).catch(($, e, next) => next(e))

  on('ui.render', { component: 'ToolUse' }, async ($, e, next) => {
    const path = pathOf(e.props.input)
    if (!LINKED_TOOLS.includes(e.props.tool) || path === undefined) return next(e)
    const own = await next(e)
    const { Box, Markdown } = $.ui.resolve(e)
    const href = hrefOf(path)
    return (
      <Box flexDirection="column">
        {own}
        <Markdown
          key={`t-${e.props.tool_use_id}`}
          text={`  ↗ [open in editor](${href})`}
          dimColor
          onLinkPress={link => openHref($, link.href)}
          pressableLinks={[href]}
        />
      </Box>
    )
  }).catch(($, e, next) => next(e))
}
