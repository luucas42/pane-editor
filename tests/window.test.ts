import { describe, expect, test } from 'claude-code/testing'

import { PALETTE } from '../hooks/syntax'
import { SELECTION_BG, TAB_WIDTH, colAt, displayCol, follow, frame, gutterWidth, hit } from '../hooks/window'
import type { Row } from '../hooks/window'

const base = { lang: 'plain' as const, top: 0, left: 0, height: 10, width: 40, cursor: { line: 0, col: 0 } }
const text = (r: Row | undefined) => (r?.segs ?? []).map(s => s.t).join('')

describe('window', () => {
  test('constants', () => {
    expect(TAB_WIDTH).toBe(4)
    expect(SELECTION_BG).toBe('#264F78')
  })

  test('displayCol expands tabs to the next multiple of 4', () => {
    expect(displayCol('abc', 2)).toBe(2)
    expect(displayCol('\tx', 1)).toBe(4)
    expect(displayCol('ab\tx', 3)).toBe(4)
    expect(displayCol('abcd\tx', 5)).toBe(8)
    expect(displayCol('a😀b', 3)).toBe(2)
    expect(displayCol('abc', 99)).toBe(3)
  })

  test('colAt finds the col whose span holds x', () => {
    expect(colAt('abc', 1)).toBe(1)
    expect(colAt('abc', 3)).toBe(3)
    expect(colAt('abc', 99)).toBe(3)
    expect(colAt('\tx', 0)).toBe(0)
    expect(colAt('\tx', 3)).toBe(0)
    expect(colAt('\tx', 4)).toBe(1)
    expect(colAt('a😀b', 2)).toBe(3)
    expect(colAt('', 5)).toBe(0)
  })

  test('gutterWidth is max(3, digits) + 3', () => {
    expect(gutterWidth(1)).toBe(6)
    expect(gutterWidth(999)).toBe(6)
    expect(gutterWidth(1000)).toBe(7)
    expect(gutterWidth(123456)).toBe(9)
  })

  test('frame emits rows from top, up to height, none past the last line', () => {
    const lines = ['a', 'b', 'c', 'd']
    const f = frame({ ...base, lines, top: 1, height: 2 })
    expect(f.gutter).toBe(6)
    expect(f.rows.map(r => r.n)).toEqual([2, 3])
    expect(frame({ ...base, lines, top: 3, height: 5 }).rows.map(r => r.n)).toEqual([4])
    expect(frame({ ...base, lines, top: 9 }).rows).toEqual([])
  })

  test('frame marks the cursor row and the cursor char', () => {
    const f = frame({ ...base, lines: ['abc', 'def'], cursor: { line: 1, col: 1 } })
    expect(f.rows.map(r => r.cur)).toEqual([false, true])
    expect(f.rows[1]?.segs).toEqual([{ t: 'd' }, { t: 'e', cur: true }, { t: 'f' }])
  })

  test('the cursor at the line end is an extra space cell', () => {
    const f = frame({ ...base, lines: ['ab'], cursor: { line: 0, col: 2 } })
    expect(f.rows[0]?.segs).toEqual([{ t: 'ab' }, { t: ' ', cur: true }])
    const empty = frame({ ...base, lines: [''], cursor: { line: 0, col: 0 } })
    expect(empty.rows[0]?.segs).toEqual([{ t: ' ', cur: true }])
  })

  test('tabs expand to spaces and the cursor sits on the first cell of a tab', () => {
    const f = frame({ ...base, lines: ['\tx'], cursor: { line: 0, col: 0 } })
    expect(f.rows[0]?.segs).toEqual([{ t: ' ', cur: true }, { t: '   x' }])
    const after = frame({ ...base, lines: ['\tx'], cursor: { line: 0, col: 1 } })
    expect(text(after.rows[0])).toBe('    x')
    expect(after.rows[0]?.segs[1]).toEqual({ t: 'x', cur: true })
  })

  test('syntax colours land in c', () => {
    const f = frame({ ...base, lines: ['const a = 1'], lang: 'ts', cursor: { line: 9, col: 0 } })
    expect(f.rows[0]?.segs.map(s => [s.t, s.c])).toEqual([
      ['const', PALETTE.kw], [' a = ', undefined], ['1', PALETTE.num],
    ])
  })

  test('the tokenizer state at top comes from the lines above', () => {
    const lines = ['/* open', 'inside', 'close */ let x']
    const f = frame({ ...base, lines, lang: 'ts', top: 1 })
    expect(f.rows[0]?.segs).toEqual([{ t: 'inside', c: PALETTE.com }])
    expect(f.rows[1]?.segs.map(s => s.c)).toEqual([PALETTE.com, undefined, PALETTE.kw, undefined])
  })

  test('horizontal scroll clips to [left, left + textWidth)', () => {
    const line = '0123456789'
    const f = frame({ ...base, lines: [line], left: 3, width: 6 + 4, cursor: { line: 0, col: 5 } })
    expect(text(f.rows[0])).toBe('3456')
    expect(f.rows[0]?.segs.find(s => s.cur)?.t).toBe('5')
    const none = frame({ ...base, lines: [line], left: 3, width: 6 + 4, cursor: { line: 0, col: 0 } })
    expect(none.rows[0]?.segs.some(s => s.cur)).toBe(false)
    const end = frame({ ...base, lines: [line], left: 8, width: 6 + 4, cursor: { line: 0, col: 10 } })
    expect(end.rows[0]?.segs).toEqual([{ t: '89' }, { t: ' ', cur: true }])
  })

  test('a tab cut by the left edge shows its remaining cells', () => {
    const f = frame({ ...base, lines: ['\tx'], left: 2 })
    expect(text(f.rows[0])).toBe('  x')
  })

  test('a selection on one line splits the segments', () => {
    const f = frame({
      ...base, lines: ['hello world'], cursor: { line: 0, col: 8 },
      selection: [{ line: 0, col: 2 }, { line: 0, col: 8 }],
    })
    expect(f.rows[0]?.segs).toEqual([
      { t: 'he' }, { t: 'llo wo', sel: true }, { t: 'r', cur: true }, { t: 'ld' },
    ])
  })

  test('a selection keeps the syntax colours', () => {
    const f = frame({
      ...base, lang: 'ts', lines: ['const a'], cursor: { line: 0, col: 7 },
      selection: [{ line: 0, col: 3 }, { line: 0, col: 7 }],
    })
    expect(f.rows[0]?.segs.slice(0, 3)).toEqual([
      { t: 'con', c: PALETTE.kw },
      { t: 'st', c: PALETTE.kw, sel: true },
      { t: ' a', sel: true },
    ])
  })

  test('a multi-line selection and an empty selected line', () => {
    const lines = ['abc', '', 'def']
    const f = frame({
      ...base, lines, cursor: { line: 2, col: 2 },
      selection: [{ line: 0, col: 1 }, { line: 2, col: 2 }],
    })
    expect(f.rows[0]?.segs).toEqual([{ t: 'a' }, { t: 'bc', sel: true }, { t: ' ', sel: true }])
    expect(f.rows[1]?.segs).toEqual([{ t: ' ', sel: true }])
    expect(f.rows[2]?.segs).toEqual([{ t: 'de', sel: true }, { t: 'f', cur: true }])
  })

  test('a selection given backwards is the same', () => {
    const a = frame({ ...base, lines: ['abcd'], selection: [{ line: 0, col: 3 }, { line: 0, col: 1 }], cursor: { line: 0, col: 3 } })
    expect(a.rows[0]?.segs.find(s => s.sel)?.t).toBe('bc')
  })

  test('follow keeps the cursor line in view', () => {
    const lines = Array.from({ length: 50 }, () => 'x')
    const file = { lines, cursor: { line: 30, col: 0 }, top: 0, left: 0 }
    expect(follow(file, 10, 40)).toEqual({ top: 21, left: 0 })
    expect(follow({ ...file, cursor: { line: 3, col: 0 }, top: 10 }, 10, 40)).toEqual({ top: 3, left: 0 })
    expect(follow({ ...file, cursor: { line: 12, col: 0 }, top: 10 }, 10, 40)).toEqual({ top: 10, left: 0 })
  })

  test('follow keeps the cursor column in view with 4 columns of slack', () => {
    const lines = ['x'.repeat(200)]
    expect(follow({ lines, cursor: { line: 0, col: 100 }, top: 0, left: 0 }, 10, 40)).toEqual({ top: 0, left: 64 })
    expect(follow({ lines, cursor: { line: 0, col: 50 }, top: 0, left: 80 }, 10, 40)).toEqual({ top: 0, left: 46 })
    expect(follow({ lines, cursor: { line: 0, col: 2 }, top: 0, left: 80 }, 10, 40)).toEqual({ top: 0, left: 0 })
    expect(follow({ lines, cursor: { line: 0, col: 10 }, top: 0, left: 0 }, 10, 40)).toEqual({ top: 0, left: 0 })
  })

  test('follow counts tabs as display columns', () => {
    const lines = ['\t\t\t\t\t\t\t\t\t\t\tx']
    expect(follow({ lines, cursor: { line: 0, col: 11 }, top: 0, left: 0 }, 5, 20).left).toBe(44 - 20 + 4)
  })

  test('hit maps cells to text positions', () => {
    const file = { lines: ['abc', '\tdef', 'ghi'], top: 0, left: 0 }
    expect(hit(file, 6, 7, 0)).toEqual({ line: 0, col: 1 })
    expect(hit(file, 6, 2, 0)).toEqual({ line: 0, col: 0 })
    expect(hit(file, 6, 0, 1)).toEqual({ line: 1, col: 0 })
    expect(hit(file, 6, 6 + 4, 1)).toEqual({ line: 1, col: 1 })
    expect(hit(file, 6, 60, 2)).toEqual({ line: 2, col: 3 })
    expect(hit(file, 6, 7, 9)).toEqual({ line: 2, col: 1 })
    expect(hit(file, 6, 7, -3)).toEqual({ line: 0, col: 1 })
    expect(hit({ ...file, top: 1, left: 2 }, 6, 6, 0)).toEqual({ line: 1, col: 0 })
    expect(hit({ ...file, top: 1, left: 2 }, 6, 6 + 2, 0)).toEqual({ line: 1, col: 1 })
  })
})
