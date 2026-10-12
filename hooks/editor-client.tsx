import type { ClientModule } from 'claude-code'

import { MENU_WIDTH } from './protocol'
import type { ClientProps, InputEvent, Post } from './protocol'
import { SELECTION_BG } from './window'

type State = {
  mount: string
  seq: number
  queue: InputEvent[]
  held: boolean
  sent: { rows: number; columns: number }
}

const MENU_BG = '#21252B'

/** The last ack each mounted instance was handed, by mount: drawing writes it, the listeners read it. */
const acked = new Map<string, number>()

/** Forwards keys and pointer events to the hooks module and draws the rows it sends back. */
const Editor: ClientModule<ClientProps, State> = (props, surface) => {
  const { Box, Text } = surface.elements
  const state = surface.state

  if (state === undefined) {
    const mount = Math.random().toString(36).slice(2, 6).padEnd(4, '0')
    const live: State = { mount, seq: 0, queue: [], held: false, sent: { rows: 0, columns: 0 } }
    const ack = (): number => acked.get(mount) ?? 0
    const post = (): void => {
      live.queue = live.queue.filter(e => e.seq > ack())
      const data: Post = { id: props.id, mount, seq: live.seq, events: live.queue, rows: surface.rows, columns: surface.columns }
      surface.post(data as unknown as Parameters<typeof surface.post>[0])
    }
    surface.onKey(k => {
      const event: InputEvent = { seq: ++live.seq, kind: 'key', key: k.key }
      if (k.ctrl) event.ctrl = true
      if (k.shift) event.shift = true
      if (k.meta) event.meta = true
      live.queue.push(event)
      post()
    })
    surface.onPointer(p => {
      if (p.type === 'enter' || p.type === 'leave') return
      if (p.type === 'down') live.held = p.button === 'left'
      if (p.type === 'move' && !live.held) return
      const event: InputEvent = { seq: ++live.seq, kind: 'pointer', type: p.type, x: p.x, y: p.y }
      if (p.button) event.button = p.button
      const last = live.queue[live.queue.length - 1]
      if (p.type === 'move' && last?.kind === 'pointer' && last.type === 'move' && last.seq > ack()) {
        live.queue[live.queue.length - 1] = event
      } else live.queue.push(event)
      if (p.type === 'up') live.held = false
      post()
    })
    surface.every(250, () => {
      const { rows, columns } = surface
      if (rows <= 0 || columns <= 0 || (rows === live.sent.rows && columns === live.sent.columns)) return
      live.sent = { rows, columns }
      post()
    })
    surface.setState(live)
    return <Text dimColor>{''}</Text>
  }

  if (props.input.mount === state.mount) acked.set(state.mount, props.input.ack)

  const { gutter, rows, menu, note } = props
  return (
    <Box flexDirection="column">
      {rows.length === 0 ? <Text dimColor>{note ?? ''}</Text> : null}
      {rows.map(row => (
        <Text wrap="truncate-end">
          <Text dimColor={!row.cur}>{`${String(row.n).padStart(gutter - 3)} │ `}</Text>
          {row.segs.map(seg => (
            <Text color={seg.c} backgroundColor={seg.sel ? SELECTION_BG : undefined} inverse={seg.cur}>
              {seg.t}
            </Text>
          ))}
        </Text>
      ))}
      {menu === undefined ? null : (
        <Box position="absolute" top={menu.y} left={menu.x} flexDirection="column" borderStyle="round" backgroundColor={MENU_BG}>
          {menu.items.map(item => (
            <Text dimColor={!item.enabled}>{item.label.padEnd(MENU_WIDTH - 2)}</Text>
          ))}
        </Box>
      )}
    </Box>
  )
}

export default Editor
