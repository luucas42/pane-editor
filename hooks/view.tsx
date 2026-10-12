import type { BoxProps, ButtonProps, ClientProps as ClientElementProps, CodeProps, ElementConstructor, RenderElement, RenderSurface, TextProps } from 'claude-code'

import type { DiffView, EditorFile } from '../types'
import { nameOf } from './actions'
import type { Action } from './actions'
import { MENU_ITEMS } from './protocol'
import type { ClientProps } from './protocol'
import { langOf } from './syntax'
import { ordered, selectedText } from './text'
import { displayCol, frame } from './window'

/** The terminal's elements the trees are made of. */
export type Kit = {
  Box: ElementConstructor<BoxProps>
  Text: ElementConstructor<TextProps>
  Button: ElementConstructor<ButtonProps>
  Client: ElementConstructor<ClientElementProps>
  Code: ElementConstructor<CodeProps>
}
/** What the pane knows about its room and the file's history. */
export type Room = { bodyRows: number; bodyColumns: number; canUndo: boolean; canRedo: boolean }
export type Press = (id: string, action: Action, surface: RenderSurface) => void

const AMBER = '#F5A524'
const GREEN = '#98C379'
const HINT = 'click to edit · esc → prompt · right-click: menu'
const DIFF_CHARS = 90_000

/** The Client's props: the visible rows of the file, the ack, and the open menu. */
export function clientProps(file: EditorFile, height: number = file.view.rows): ClientProps {
  const selection = ordered(file)
  const shown = frame({
    lines: file.lines, lang: langOf(file.path).id, top: file.top, left: file.left,
    height, width: file.view.columns, cursor: file.cursor, ...(selection ? { selection } : {}),
  })
  const props: ClientProps = { id: file.id, input: { mount: file.input.mount, ack: file.input.ack }, gutter: shown.gutter, rows: shown.rows }
  if (file.menu) {
    const items = MENU_ITEMS.map(label => ({ label, enabled: selection !== undefined || (label !== 'copy' && label !== 'cut') }))
    props.menu = { x: file.menu.x, y: file.menu.y, items }
  }
  if (file.lines.length === 1 && file.lines[0] === '') props.note = '(empty file)'
  return props
}

function header({ Box, Text }: Kit, f: EditorFile, width: number): RenderElement {
  const name = nameOf(f.path)
  const dir = f.path.slice(0, f.path.length - name.length)
  const col = displayCol(f.lines[f.cursor.line] ?? '', f.cursor.col) + 1
  const right = `Ln ${f.cursor.line + 1}, Col ${col} · ${langOf(f.path).name} · ${f.eol === '\r\n' ? 'CRLF' : 'LF'}`
  const room = width - (f.dirty ? 2 : 0) - name.length - right.length - 2
  const shown = room < 4 ? '' : dir.length <= room ? dir : `…${dir.slice(dir.length - (room - 1))}`
  return (
    <Box key="header" height={1}>
      <Text wrap="truncate-end">
        {f.dirty ? <Text color={AMBER}>{'● '}</Text> : null}
        <Text bold>{name}</Text>
        <Text dimColor>{shown === '' ? '' : ` ${shown}`}</Text>
      </Text>
      <Box flexGrow={1} />
      <Text dimColor>{right}</Text>
    </Box>
  )
}

function banner({ Box, Text, Button }: Kit, f: EditorFile, press: Press): RenderElement | null {
  if (!f.banner) return null
  const name = nameOf(f.path)
  const choice = (action: Action, label: string): RenderElement => (
    <Box key={`box-${action}`} flexShrink={0}>
      <Button key={`banner-${action}`} label={label} onPress={e => press(f.id, action, e.surface)} />
    </Box>
  )
  const [text, buttons] = {
    changed: [`⚠ ${name} changed on disk`, [choice('reload', 'reload'), choice('keep', 'keep mine'), choice('diff', 'diff')]],
    deleted: [`⚠ ${name} was deleted on disk`, [choice('recreate', 'save to recreate'), choice('close', 'close')]],
    overwrite: [
      `⚠ ${name} changed on disk since you opened it`,
      [choice('overwrite', 'overwrite'), choice('reload', 'reload'), choice('diff', 'diff'), choice('cancel', 'cancel')],
    ],
    close: ['● unsaved changes', [choice('saveClose', 'save & close'), choice('discard', 'discard'), choice('cancel', 'cancel')]],
  }[f.banner.kind] as [string, RenderElement[]]
  return (
    <Box key="banner" height={1} gap={1}>
      <Box flexShrink={1}>
        <Text color={AMBER} wrap="truncate-end">{text}</Text>
      </Box>
      {buttons}
    </Box>
  )
}

function footer({ Box, Text, Button }: Kit, f: EditorFile, room: Room, press: Press): RenderElement {
  const tap = (action: Action) => (e: { surface: RenderSurface }) => press(f.id, action, e.surface)
  const selection = ordered(f)
  const chosen = selection
    ? [
        <Text key="count" dimColor>{`${selection[1].line - selection[0].line + 1} lines · ${selectedText(f).length} chars`}</Text>,
        <Button key="copy" label="copy" onPress={tap('copy')} />,
        <Button key="cut" label="cut" onPress={tap('cut')} />,
      ]
    : null
  const note = f.flash ? (
    <Text key="note" color={/^[✓↻]/.test(f.flash.text) ? GREEN : AMBER} wrap="truncate-end">{f.flash.text}</Text>
  ) : (
    <Text key="note" dimColor wrap="truncate-end">{HINT}</Text>
  )
  return (
    <Box key="footer" height={1} gap={1} overflow="hidden">
      <Button key="save" label="save" dimColor={!f.dirty} onPress={tap('save')} />
      <Button key="undo" label="undo" dimColor={!room.canUndo} onPress={tap('undo')} />
      <Button key="redo" label="redo" dimColor={!room.canRedo} onPress={tap('redo')} />
      {chosen}
      {note}
    </Box>
  )
}

function failure({ Text }: Kit, err: unknown): RenderElement {
  return <Text dimColor>{`pane-editor: ${err instanceof Error ? err.message : String(err)}`}</Text>
}

/** The editor pane: header, banner, the Client, footer; at most `bodyRows` tall and never throws. */
export function editorView(kit: Kit, f: EditorFile, room: Room, press: Press): RenderElement {
  try {
    const { Box, Client } = kit
    const height = Math.max(3, room.bodyRows - 2 - (f.banner ? 1 : 0))
    return (
      <Box flexDirection="column">
        {header(kit, f, room.bodyColumns)}
        {banner(kit, f, press)}
        <Client key="ed" module="./editor-client.tsx" props={clientProps(f, height)} height={height} width="100%" />
        {footer(kit, f, room, press)}
      </Box>
    )
  } catch (err) {
    return failure(kit, err)
  }
}

/** The diff pane: a header with `[ close ]` over the unified diff from disk to the editor. */
export function diffView(kit: Kit, diff: DiffView | undefined, onClose: (surface: RenderSurface) => void): RenderElement {
  try {
    const { Box, Text, Button, Code } = kit
    if (!diff) return <Text dimColor>{'closed'}</Text>
    const cut = diff.text.length > DIFF_CHARS ? diff.text.lastIndexOf('\n', DIFF_CHARS) : diff.text.length
    return (
      <Box flexDirection="column">
        <Box key="header" height={1} gap={1}>
          <Text bold>{diff.title}</Text>
          <Text dimColor>{'· disk → editor'}</Text>
          <Box flexGrow={1} />
          <Button key="close" label="close" onPress={e => onClose(e.surface)} />
        </Box>
        {diff.text === '' ? <Text dimColor>{'no differences'}</Text> : <Code source={diff.text.slice(0, cut)} format="diff" />}
        {cut < diff.text.length ? <Text dimColor>{'… diff cut here'}</Text> : null}
      </Box>
    )
  } catch (err) {
    return failure(kit, err)
  }
}

/** What a pane draws when its file is gone, or the surface is not the terminal. */
export function notice({ Text }: Pick<Kit, 'Text'>, text: string): RenderElement {
  return <Text dimColor>{text}</Text>
}
