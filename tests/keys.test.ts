import { describe, expect, test } from 'claude-code/testing'

import type { ClientKeyEvent } from 'claude-code'
import { commandOf } from '../hooks/keys'

const key = (k: string, ...mods: Array<'ctrl' | 'shift' | 'meta'>): ClientKeyEvent => {
  const e: ClientKeyEvent = { key: k }
  for (const m of mods) e[m] = true
  return e
}
const cmd = (k: string, ...mods: Array<'ctrl' | 'shift' | 'meta'>) => commandOf(key(k, ...mods))

describe('keys', () => {
  test('text keys', () => {
    expect(cmd('space')).toEqual({ type: 'insert', text: ' ' })
    expect(cmd('a')).toEqual({ type: 'insert', text: 'a' })
    expect(cmd('ş')).toEqual({ type: 'insert', text: 'ş' })
    expect(cmd('(')).toEqual({ type: 'insert', text: '(' })
    expect(cmd('a', 'shift')).toEqual({ type: 'insert', text: 'A' })
    expect(cmd('1', 'shift')).toEqual({ type: 'insert', text: '1' })
    expect(cmd('return')).toEqual({ type: 'newline' })
    expect(cmd('tab')).toEqual({ type: 'tab' })
    expect(cmd('tab', 'shift')).toBeUndefined()
  })

  test('shift with i gives the Turkish dotted capital', () => {
    expect(cmd('i', 'shift')).toEqual({ type: 'insert', text: 'İ' })
    expect(cmd('ı', 'shift')).toEqual({ type: 'insert', text: 'I' })
  })

  test('deleting keys', () => {
    expect(cmd('backspace')).toEqual({ type: 'backspace' })
    expect(cmd('backspace', 'meta')).toEqual({ type: 'deleteWordBack' })
    expect(cmd('backspace', 'ctrl')).toEqual({ type: 'deleteWordBack' })
    expect(cmd('delete')).toEqual({ type: 'delete' })
    expect(cmd('w', 'ctrl')).toEqual({ type: 'deleteWordBack' })
  })

  test('arrows and their modifiers', () => {
    expect(cmd('left')).toEqual({ type: 'move', to: 'left', extend: false })
    expect(cmd('right')).toEqual({ type: 'move', to: 'right', extend: false })
    expect(cmd('left', 'meta')).toEqual({ type: 'move', to: 'wordLeft', extend: false })
    expect(cmd('right', 'meta')).toEqual({ type: 'move', to: 'wordRight', extend: false })
    expect(cmd('left', 'ctrl')).toEqual({ type: 'move', to: 'home', extend: false })
    expect(cmd('right', 'ctrl')).toEqual({ type: 'move', to: 'end', extend: false })
    expect(cmd('b', 'meta')).toEqual({ type: 'move', to: 'wordLeft', extend: false })
    expect(cmd('f', 'meta')).toEqual({ type: 'move', to: 'wordRight', extend: false })
    expect(cmd('up')).toEqual({ type: 'move', to: 'up', extend: false })
    expect(cmd('down')).toEqual({ type: 'move', to: 'down', extend: false })
  })

  test('home, end and paging', () => {
    expect(cmd('home')).toEqual({ type: 'move', to: 'home', extend: false })
    expect(cmd('end')).toEqual({ type: 'move', to: 'end', extend: false })
    expect(cmd('home', 'ctrl')).toEqual({ type: 'move', to: 'docStart', extend: false })
    expect(cmd('end', 'ctrl')).toEqual({ type: 'move', to: 'docEnd', extend: false })
    expect(cmd('a', 'ctrl')).toEqual({ type: 'move', to: 'home', extend: false })
    expect(cmd('e', 'ctrl')).toEqual({ type: 'move', to: 'end', extend: false })
    expect(cmd('pageup')).toEqual({ type: 'move', to: 'pageUp', extend: false })
    expect(cmd('pagedown')).toEqual({ type: 'move', to: 'pageDown', extend: false })
  })

  test('shift on any move extends the selection', () => {
    for (const k of ['left', 'right', 'up', 'down', 'home', 'end', 'pageup', 'pagedown']) {
      expect(cmd(k, 'shift')).toMatchObject({ type: 'move', extend: true })
    }
    expect(cmd('left', 'shift', 'meta')).toEqual({ type: 'move', to: 'wordLeft', extend: true })
    expect(cmd('home', 'shift', 'ctrl')).toEqual({ type: 'move', to: 'docStart', extend: true })
    expect(cmd('a', 'shift', 'ctrl')).toEqual({ type: 'move', to: 'home', extend: true })
  })

  test('actions', () => {
    expect(cmd('s', 'ctrl')).toEqual({ type: 'save' })
    expect(cmd('z', 'ctrl')).toEqual({ type: 'undo' })
    expect(cmd('z', 'ctrl', 'shift')).toEqual({ type: 'redo' })
    expect(cmd('y', 'ctrl')).toEqual({ type: 'redo' })
    expect(cmd('v', 'ctrl')).toEqual({ type: 'paste' })
  })

  test('unlisted keys give undefined', () => {
    expect(cmd('escape')).toBeUndefined()
    expect(cmd('f5')).toBeUndefined()
    expect(cmd('c', 'ctrl')).toBeUndefined()
    expect(cmd('k', 'ctrl')).toBeUndefined()
    expect(cmd('x', 'meta')).toBeUndefined()
    expect(cmd('a', 'meta')).toBeUndefined()
    expect(cmd('space', 'ctrl')).toBeUndefined()
    expect(cmd('return', 'meta')).toBeUndefined()
    expect(cmd('insert')).toBeUndefined()
  })
})
