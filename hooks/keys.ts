import type { ClientKeyEvent } from 'claude-code'
import type { EditCommand, MoveTo } from './text'

export type Command =
  | EditCommand
  | { type: 'save' } | { type: 'undo' } | { type: 'redo' } | { type: 'paste' } | { type: 'copyAll' }

const move = (to: MoveTo, k: ClientKeyEvent): Command => ({ type: 'move', to, extend: !!k.shift })

function printable(k: ClientKeyEvent): Command | undefined {
  if (k.ctrl || k.meta || [...k.key].length !== 1) return undefined
  const upper = k.key.toLocaleUpperCase('tr')
  const lowercase = upper !== k.key && k.key.toLocaleLowerCase('tr') === k.key
  return { type: 'insert', text: k.shift && lowercase ? upper : k.key }
}

function chord(k: ClientKeyEvent): Command | undefined {
  if (k.ctrl && !k.meta) {
    switch (k.key) {
      case 's': return { type: 'save' }
      case 'z': return k.shift ? { type: 'redo' } : { type: 'undo' }
      case 'y': return { type: 'redo' }
      case 'v': return { type: 'paste' }
      case 'w': return { type: 'deleteWordBack' }
      case 'a': return { type: 'copyAll' }
      case 'e': return move('end', k)
    }
  }
  if (k.meta && !k.ctrl) {
    if (k.key === 'b') return move('wordLeft', k)
    if (k.key === 'f') return move('wordRight', k)
    if (k.key === 'a') return { type: 'copyAll' }
  }
  return undefined
}

/** The editor command a Client key stands for, or undefined when the editor ignores it. */
export function commandOf(k: ClientKeyEvent): Command | undefined {
  const plain = !k.ctrl && !k.meta
  switch (k.key) {
    case 'space': return plain ? { type: 'insert', text: ' ' } : undefined
    case 'return': return plain ? { type: 'newline' } : undefined
    case 'tab': return plain && !k.shift ? { type: 'tab' } : undefined
    case 'backspace': return k.ctrl || k.meta ? { type: 'deleteWordBack' } : { type: 'backspace' }
    case 'delete': return plain ? { type: 'delete' } : undefined
    case 'left': return move(k.ctrl ? 'home' : k.meta ? 'wordLeft' : 'left', k)
    case 'right': return move(k.ctrl ? 'end' : k.meta ? 'wordRight' : 'right', k)
    case 'up': return plain ? move('up', k) : undefined
    case 'down': return plain ? move('down', k) : undefined
    case 'home': return move(k.ctrl ? 'docStart' : 'home', k)
    case 'end': return move(k.ctrl ? 'docEnd' : 'end', k)
    case 'pageup': return plain ? move('pageUp', k) : undefined
    case 'pagedown': return plain ? move('pageDown', k) : undefined
  }
  return chord(k) ?? printable(k)
}
