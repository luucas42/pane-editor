import { describe, expect, test } from 'claude-code/testing'

import type { Doc, EditCommand, History, MoveTo, Step } from '../hooks/text'
import { edit, hash, indentOf, join, ordered, placeAt, record, redo, replace, selectedText, split, undo } from '../hooks/text'

const ctx = { pageRows: 5, indent: '  ' }
const doc = (lines: string[], line = 0, col = 0, anchor?: { line: number; col: number }): Doc =>
  anchor ? { lines, cursor: { line, col }, anchor } : { lines, cursor: { line, col } }
const run = (d: Doc, cmd: EditCommand, c = ctx) => edit(d, cmd, c).doc
const typeIn = (d: Doc, text: string) => run(d, { type: 'insert', text })
const mv = (d: Doc, to: MoveTo, extend = false) => run(d, { type: 'move', to, extend })

describe('text', () => {
  test('insert at the cursor', () => {
    const r = edit(doc(['ac'], 0, 1), { type: 'insert', text: 'b' }, ctx)
    expect(r.doc.lines).toEqual(['abc'])
    expect(r.doc.cursor).toEqual({ line: 0, col: 2 })
    expect(r.change).toEqual({ from: { line: 0, col: 1 }, removed: '', inserted: 'b' })
    expect(r.kind).toBe('insert')
  })

  test('insert with a newline in the text splits the line', () => {
    const d = typeIn(doc(['abcd'], 0, 2), 'X\nY')
    expect(d.lines).toEqual(['abX', 'Ycd'])
    expect(d.cursor).toEqual({ line: 1, col: 1 })
  })

  test('newline splits the line without auto-indent', () => {
    const d = run(doc(['  ab'], 0, 3), { type: 'newline' })
    expect(d.lines).toEqual(['  a', 'b'])
    expect(d.cursor).toEqual({ line: 1, col: 0 })
  })

  test('insert replaces the selection and clears the anchor', () => {
    const d = typeIn(doc(['hello world'], 0, 5, { line: 0, col: 0 }), 'X')
    expect(d.lines).toEqual(['X world'])
    expect(d.cursor).toEqual({ line: 0, col: 1 })
    expect(d.anchor).toBeUndefined()
  })

  test('tab inserts the indent, or spaces up to the next multiple', () => {
    expect(run(doc(['x'], 0, 0), { type: 'tab' }, { pageRows: 5, indent: '\t' }).lines).toEqual(['\tx'])
    expect(run(doc(['x'], 0, 0), { type: 'tab' }, { pageRows: 5, indent: '    ' }).lines).toEqual(['    x'])
    expect(run(doc(['abc'], 0, 3), { type: 'tab' }, { pageRows: 5, indent: '    ' }).lines).toEqual(['abc '])
    expect(run(doc(['ab'], 0, 2), { type: 'tab' }, { pageRows: 5, indent: '  ' }).lines).toEqual(['ab  '])
  })

  test('backspace deletes one char, joins lines, and stops at 0:0', () => {
    expect(run(doc(['abc'], 0, 2), { type: 'backspace' }).lines).toEqual(['ac'])
    const joined = run(doc(['ab', 'cd'], 1, 0), { type: 'backspace' })
    expect(joined.lines).toEqual(['abcd'])
    expect(joined.cursor).toEqual({ line: 0, col: 2 })
    const r = edit(doc(['ab']), { type: 'backspace' }, ctx)
    expect(r.change).toBeUndefined()
    expect(r.doc.lines).toEqual(['ab'])
  })

  test('backspace with a selection deletes the selection', () => {
    const d = run(doc(['hello'], 0, 4, { line: 0, col: 1 }), { type: 'backspace' })
    expect(d.lines).toEqual(['ho'])
    expect(d.cursor).toEqual({ line: 0, col: 1 })
  })

  test('delete removes the char to the right and joins at a line end', () => {
    expect(run(doc(['abc'], 0, 1), { type: 'delete' }).lines).toEqual(['ac'])
    const joined = run(doc(['ab', 'cd'], 0, 2), { type: 'delete' })
    expect(joined.lines).toEqual(['abcd'])
    expect(joined.cursor).toEqual({ line: 0, col: 2 })
    expect(edit(doc(['ab'], 0, 2), { type: 'delete' }, ctx).change).toBeUndefined()
  })

  test('deleteWordBack skips spaces then one class of chars', () => {
    expect(run(doc(['foo bar  '], 0, 9), { type: 'deleteWordBack' }).lines).toEqual(['foo '])
    expect(run(doc(['foo.bar'], 0, 7), { type: 'deleteWordBack' }).lines).toEqual(['foo.'])
    expect(run(doc(['foo.bar'], 0, 4), { type: 'deleteWordBack' }).lines).toEqual(['foobar'])
    expect(run(doc(['çay şeker'], 0, 9), { type: 'deleteWordBack' }).lines).toEqual(['çay '])
    expect(run(doc(['ab', 'cd'], 1, 0), { type: 'deleteWordBack' }).lines).toEqual(['abcd'])
  })

  test('surrogate pairs are never split', () => {
    const d = doc(['a😀b'], 0, 3)
    expect(mv(d, 'left').cursor.col).toBe(1)
    expect(mv(doc(['a😀b'], 0, 1), 'right').cursor.col).toBe(3)
    expect(run(d, { type: 'backspace' }).lines).toEqual(['ab'])
    expect(run(doc(['a😀b'], 0, 1), { type: 'delete' }).lines).toEqual(['ab'])
  })

  test('home toggles between the first non-space char and col 0', () => {
    const d = doc(['    code'], 0, 6)
    const first = mv(d, 'home')
    expect(first.cursor.col).toBe(4)
    expect(mv(first, 'home').cursor.col).toBe(0)
    expect(mv(mv(first, 'home'), 'home').cursor.col).toBe(4)
    expect(mv(d, 'end').cursor.col).toBe(8)
  })

  test('up and down keep the goal display column across short lines', () => {
    let d = doc(['abcdefgh', 'ab', 'abcdefgh'], 0, 6)
    d = mv(d, 'down')
    expect(d.cursor).toEqual({ line: 1, col: 2 })
    expect(d.goalCol).toBe(6)
    d = mv(d, 'down')
    expect(d.cursor).toEqual({ line: 2, col: 6 })
    d = mv(d, 'left')
    expect(d.goalCol).toBeUndefined()
  })

  test('up and down count tabs as display columns', () => {
    const d = mv(doc(['\tx', 'abcdef'], 0, 1), 'down')
    expect(d.cursor).toEqual({ line: 1, col: 4 })
  })

  test('up on the first line goes to col 0 and down on the last to the end', () => {
    expect(mv(doc(['abc'], 0, 2), 'up').cursor).toEqual({ line: 0, col: 0 })
    expect(mv(doc(['abc'], 0, 1), 'down').cursor).toEqual({ line: 0, col: 3 })
  })

  test('left and right cross line boundaries', () => {
    expect(mv(doc(['ab', 'cd'], 1, 0), 'left').cursor).toEqual({ line: 0, col: 2 })
    expect(mv(doc(['ab', 'cd'], 0, 2), 'right').cursor).toEqual({ line: 1, col: 0 })
  })

  test('word moves', () => {
    const d = doc(['foo bar.baz'], 0, 0)
    expect(mv(d, 'wordRight').cursor.col).toBe(3)
    expect(mv(mv(d, 'wordRight'), 'wordRight').cursor.col).toBe(7)
    expect(mv(doc(['foo bar'], 0, 7), 'wordLeft').cursor.col).toBe(4)
    expect(mv(doc(['foo bar'], 0, 4), 'wordLeft').cursor.col).toBe(0)
  })

  test('page moves go pageRows - 1 lines and clear the goal column', () => {
    const lines = Array.from({ length: 20 }, (_, i) => `line ${i}`)
    const d = run(doc(lines, 2, 3), { type: 'move', to: 'pageDown', extend: false }, { pageRows: 6, indent: '  ' })
    expect(d.cursor).toEqual({ line: 7, col: 3 })
    expect(d.goalCol).toBeUndefined()
    const up = run(d, { type: 'move', to: 'pageUp', extend: false }, { pageRows: 6, indent: '  ' })
    expect(up.cursor.line).toBe(2)
    expect(mv(doc(lines, 18, 0), 'pageDown').cursor.line).toBe(19)
  })

  test('docStart and docEnd', () => {
    const d = doc(['ab', 'cde'], 0, 1)
    expect(mv(d, 'docEnd').cursor).toEqual({ line: 1, col: 3 })
    expect(mv(doc(['ab', 'cde'], 1, 2), 'docStart').cursor).toEqual({ line: 0, col: 0 })
  })

  test('shift-moves extend the selection from where the cursor was', () => {
    let d = doc(['abcdef'], 0, 2)
    d = mv(d, 'right', true)
    d = mv(d, 'right', true)
    expect(d.anchor).toEqual({ line: 0, col: 2 })
    expect(d.cursor).toEqual({ line: 0, col: 4 })
    expect(selectedText(d)).toBe('cd')
  })

  test('a plain left or right collapses a selection to its edge', () => {
    const sel = doc(['abcdef'], 0, 4, { line: 0, col: 1 })
    expect(mv(sel, 'left').cursor.col).toBe(1)
    expect(mv(sel, 'left').anchor).toBeUndefined()
    expect(mv(sel, 'right').cursor.col).toBe(4)
    const down = mv(doc(['abcdef', 'xy'], 0, 4, { line: 0, col: 1 }), 'down')
    expect(down.anchor).toBeUndefined()
    expect(down.cursor.line).toBe(1)
  })

  test('selectAll selects from 0:0 to the end', () => {
    const d = run(doc(['ab', 'cde'], 0, 1), { type: 'selectAll' })
    expect(d.anchor).toEqual({ line: 0, col: 0 })
    expect(d.cursor).toEqual({ line: 1, col: 3 })
    expect(selectedText(d)).toBe('ab\ncde')
  })

  test('ordered and selectedText over several lines', () => {
    const d = doc(['abc', 'def', 'ghi'], 0, 1, { line: 2, col: 2 })
    expect(ordered(d)).toEqual([{ line: 0, col: 1 }, { line: 2, col: 2 }])
    expect(selectedText(d)).toBe('bc\ndef\ngh')
    expect(ordered(doc(['a'], 0, 1, { line: 0, col: 1 }))).toBeUndefined()
    expect(selectedText(doc(['abc']))).toBe('')
  })

  test('replace over several lines', () => {
    const r = replace(['abc', 'def', 'ghi'], { line: 0, col: 1 }, { line: 2, col: 1 }, 'X')
    expect(r.lines).toEqual(['aXhi'])
    expect(r.removed).toBe('bc\ndef\ng')
    expect(r.end).toEqual({ line: 0, col: 2 })
  })

  test('split and join round trip with LF, CRLF and a trailing newline', () => {
    for (const text of ['a\nb', 'a\nb\n', 'a\r\nb\r\n', '', '\n\n']) {
      const { lines, eol } = split(text)
      expect(join(lines, eol)).toBe(text)
    }
    expect(split('a\r\nb\n')).toEqual({ lines: ['a', 'b', ''], eol: '\r\n' })
    expect(split('a\nb')).toEqual({ lines: ['a', 'b'], eol: '\n' })
  })

  test('hash is FNV-1a 32-bit', () => {
    expect(hash('')).toBe(0x811c9dc5)
    expect(hash('a')).toBe(0xe40c292c)
    expect(hash('foobar')).toBe(0xbf9cf968)
  })

  test('indentOf picks tabs, 4 spaces or 2 spaces', () => {
    expect(indentOf(['a', '\tb', '\t\tc', '  d'])).toBe('\t')
    expect(indentOf(['a', '    b', '        c'])).toBe('    ')
    expect(indentOf(['a', '  b', '    c'])).toBe('  ')
    expect(indentOf(['a', 'b'])).toBe('  ')
  })

  test('placeAt clicks and drags', () => {
    const d = doc(['abc', 'def'], 1, 1)
    const clicked = placeAt(d, { line: 0, col: 2 }, false)
    expect(clicked.cursor).toEqual({ line: 0, col: 2 })
    expect(clicked.anchor).toBeUndefined()
    const dragged = placeAt({ ...clicked, anchor: clicked.cursor }, { line: 1, col: 99 }, true)
    expect(dragged.anchor).toEqual({ line: 0, col: 2 })
    expect(dragged.cursor).toEqual({ line: 1, col: 3 })
  })
})

const apply = (d: Doc, h: History, cmd: EditCommand, at: number): { doc: Doc; history: History } => {
  const r = edit(d, cmd, ctx)
  if (!r.change) return { doc: r.doc, history: h }
  const step: Step = { change: r.change, before: { cursor: d.cursor, anchor: d.anchor }, after: { cursor: r.doc.cursor }, kind: r.kind, at }
  return { doc: r.doc, history: record(h, step) }
}
const fresh: History = { undo: [], redo: [] }
const typed = (text: string, d: Doc, h: History, at: number) => apply(d, h, { type: 'insert', text }, at)

describe('history', () => {
  test('undo and redo restore text and selection', () => {
    let s = typed('a', doc(['']), fresh, 0)
    s = apply(s.doc, s.history, { type: 'newline' }, 5000)
    expect(s.doc.lines).toEqual(['a', ''])
    const u = undo(s.doc, s.history)
    expect(u?.doc.lines).toEqual(['a'])
    expect(u?.doc.cursor).toEqual({ line: 0, col: 1 })
    const r = redo(u!.doc, u!.history)
    expect(r?.doc.lines).toEqual(['a', ''])
    expect(r?.doc.cursor).toEqual({ line: 1, col: 0 })
    expect(undo(doc(['x']), fresh)).toBeUndefined()
    expect(redo(doc(['x']), fresh)).toBeUndefined()
  })

  test('undo of a selection replace brings the selection back', () => {
    const start = doc(['hello'], 0, 5, { line: 0, col: 0 })
    const s = typed('X', start, fresh, 0)
    expect(s.doc.lines).toEqual(['X'])
    const u = undo(s.doc, s.history)
    expect(u?.doc.lines).toEqual(['hello'])
    expect(u?.doc.anchor).toEqual({ line: 0, col: 0 })
    expect(u?.doc.cursor).toEqual({ line: 0, col: 5 })
  })

  test('typing within 1 s coalesces into one step', () => {
    let s = typed('a', doc(['']), fresh, 0)
    s = typed('b', s.doc, s.history, 300)
    s = typed('c', s.doc, s.history, 900)
    expect(s.history.undo).toHaveLength(1)
    expect(undo(s.doc, s.history)?.doc.lines).toEqual([''])
  })

  test('a 1 s gap or a newline starts a new step', () => {
    let s = typed('a', doc(['']), fresh, 0)
    s = typed('b', s.doc, s.history, 2000)
    expect(s.history.undo).toHaveLength(2)
    let n = typed('a', doc(['']), fresh, 0)
    n = apply(n.doc, n.history, { type: 'newline' }, 100)
    n = typed('b', n.doc, n.history, 200)
    expect(n.history.undo).toHaveLength(3)
  })

  test('typing elsewhere does not coalesce', () => {
    let s = typed('a', doc(['xy']), fresh, 0)
    s = typed('b', placeAt(s.doc, { line: 0, col: 0 }, false), s.history, 100)
    expect(s.history.undo).toHaveLength(2)
  })

  test('repeated backspace coalesces and undoes together', () => {
    let s = { doc: doc(['abcd'], 0, 4), history: fresh }
    s = apply(s.doc, s.history, { type: 'backspace' }, 0)
    s = apply(s.doc, s.history, { type: 'backspace' }, 100)
    s = apply(s.doc, s.history, { type: 'backspace' }, 200)
    expect(s.doc.lines).toEqual(['a'])
    expect(s.history.undo).toHaveLength(1)
    const u = undo(s.doc, s.history)
    expect(u?.doc.lines).toEqual(['abcd'])
    expect(u?.doc.cursor).toEqual({ line: 0, col: 4 })
  })

  test('repeated forward delete coalesces', () => {
    let s = { doc: doc(['abcd'], 0, 0), history: fresh }
    s = apply(s.doc, s.history, { type: 'delete' }, 0)
    s = apply(s.doc, s.history, { type: 'delete' }, 100)
    expect(s.history.undo).toHaveLength(1)
    expect(undo(s.doc, s.history)?.doc.lines).toEqual(['abcd'])
  })

  test('a new edit clears redo, and history is capped at 200', () => {
    let s = typed('a', doc(['']), fresh, 0)
    const u = undo(s.doc, s.history)!
    expect(u.history.redo).toHaveLength(1)
    s = typed('b', u.doc, u.history, 10)
    expect(s.history.redo).toHaveLength(0)

    let h: History = fresh
    let d = doc([''])
    for (let i = 0; i < 250; i++) {
      const r = apply(d, h, { type: 'newline' }, i * 5000)
      d = r.doc
      h = r.history
    }
    expect(h.undo).toHaveLength(200)
  })
})
