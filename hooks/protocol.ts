import type { Row } from './window'

/** One input the Client saw; `seq` counts them in the order they happened. */
export type InputEvent =
  | { seq: number; kind: 'key'; key: string; ctrl?: true; shift?: true; meta?: true }
  | { seq: number; kind: 'pointer'; type: 'down' | 'move' | 'up'; x: number; y: number; button?: 'left' | 'middle' | 'right' }

/** What the Client posts: the unacked events and the size of its region. */
export type Post = { id: string; mount: string; seq: number; events: InputEvent[]; rows: number; columns: number }

export type MenuItem = { label: string; enabled: boolean }

/** What the hooks module hands the Client to draw. */
export type ClientProps = {
  id: string
  input: { mount: string; ack: number }
  gutter: number
  rows: Row[]
  menu?: { x: number; y: number; items: MenuItem[] }
  note?: string
}

/** The right-click menu: its size in cells and its items, in order. */
export const MENU_WIDTH = 14
export const MENU_HEIGHT = 6
export const MENU_ITEMS = ['copy', 'cut', 'paste', 'select all'] as const
export type MenuAction = (typeof MENU_ITEMS)[number]
