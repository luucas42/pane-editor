import type { Pos } from '../types'
import { PALETTE, stateAt, tokenize } from './syntax'
import type { LangId, TokKind } from './syntax'

export const TAB_WIDTH = 4
export const SELECTION_BG = '#264F78'
export type Seg = { t: string; c?: string; sel?: true; cur?: true }
export type Row = { n: number; cur: boolean; segs: Seg[] }
export type Frame = { gutter: number; rows: Row[] }

const isHigh = (u: number) => u >= 0xd800 && u <= 0xdbff
const isLow = (u: number) => u >= 0xdc00 && u <= 0xdfff

/** Length in UTF-16 units of the char starting at `i` (2 for a surrogate pair). */
function charLen(line: string, i: number): number {
  return isHigh(line.charCodeAt(i)) && isLow(line.charCodeAt(i + 1)) ? 2 : 1
}

function widthAt(ch: string, dc: number): number {
  return ch === '\t' ? TAB_WIDTH - (dc % TAB_WIDTH) : 1
}

/** The display column of `col` in `line`, tabs expanded to the next multiple of TAB_WIDTH. */
export function displayCol(line: string, col: number): number {
  let dc = 0
  let i = 0
  const stop = Math.min(col, line.length)
  while (i < stop) {
    const n = charLen(line, i)
    dc += widthAt(line[i] as string, dc)
    i += n
  }
  return dc
}

/** The col whose display span holds `x`; past the end gives `line.length`. */
export function colAt(line: string, x: number): number {
  let dc = 0
  let i = 0
  while (i < line.length) {
    const w = widthAt(line[i] as string, dc)
    if (x < dc + w) return i
    dc += w
    i += charLen(line, i)
  }
  return line.length
}

/** The gutter's width: the line number column plus " │ ". */
export function gutterWidth(lineCount: number): number {
  return Math.max(3, String(Math.max(1, lineCount)).length) + 3
}

type Cell = { ch: string; at: number; first: boolean; k?: TokKind }

function cellsOf(line: string, toks: { t: string; k?: TokKind }[]): Cell[] {
  const cells: Cell[] = []
  let at = 0
  for (const tok of toks) {
    let i = 0
    while (i < tok.t.length) {
      const n = charLen(tok.t, i)
      const ch = tok.t.slice(i, i + n)
      if (ch === '\t') {
        const w = widthAt('\t', cells.length)
        for (let s = 0; s < w; s++) cells.push({ ch: ' ', at, first: s === 0, k: tok.k })
      } else cells.push({ ch, at, first: true, k: tok.k })
      at += n
      i += n
    }
  }
  return at === line.length ? cells : []
}

function seg(t: string, k: TokKind | undefined, sel: boolean, cur: boolean): Seg {
  const s: Seg = { t }
  if (k) s.c = PALETTE[k]
  if (sel) s.sel = true
  if (cur) s.cur = true
  return s
}

/** The visible rows: syntax colours, selection and cursor marks, clipped to the window. */
export function frame(input: {
  lines: string[]; lang: LangId; top: number; left: number; height: number; width: number
  cursor: Pos; selection?: [Pos, Pos]
}): Frame {
  const { lines, lang, top, left, height, width, cursor } = input
  const gutter = gutterWidth(lines.length)
  const textW = Math.max(0, width - gutter)
  const sel = input.selection && orderPair(input.selection)
  const rows: Row[] = []
  let state = stateAt(lines, lang, top)
  const stop = Math.min(lines.length, top + height)
  for (let n = top; n < stop; n++) {
    const line = lines[n] ?? ''
    const { toks, end } = tokenize(line, lang, state)
    state = end
    const from = sel ? (n === sel[0].line ? sel[0].col : n > sel[0].line ? 0 : Infinity) : Infinity
    const to = sel ? (n === sel[1].line ? sel[1].col : n < sel[1].line ? Infinity : -1) : -1
    const newline = !!sel && n >= sel[0].line && n < sel[1].line
    const isCursorLine = n === cursor.line
    const segs: Seg[] = []
    let run: Seg | undefined
    const push = (cell: { ch: string; k?: TokKind }, selected: boolean, cur: boolean) => {
      const c = cell.k ? PALETTE[cell.k] : undefined
      if (run && !cur && !run.cur && run.c === c && !!run.sel === selected) { run.t += cell.ch; return }
      run = seg(cell.ch, cell.k, selected, cur)
      segs.push(run)
    }
    const cells = cellsOf(line, toks)
    for (let dc = Math.max(0, left); dc < Math.min(cells.length, left + textW); dc++) {
      const cell = cells[dc] as Cell
      const selected = cell.at >= from && cell.at < to
      push(cell, selected, isCursorLine && cell.first && cell.at === cursor.col)
    }
    if ((isCursorLine && cursor.col >= line.length) || newline) {
      const dcEnd = displayCol(line, line.length)
      if (dcEnd >= left && dcEnd < left + textW) {
        const cur = isCursorLine && cursor.col >= line.length
        segs.push(seg(' ', undefined, newline, cur))
      }
    }
    rows.push({ n: n + 1, cur: isCursorLine, segs })
  }
  return { gutter, rows }
}

function orderPair([a, b]: [Pos, Pos]): [Pos, Pos] {
  return a.line < b.line || (a.line === b.line && a.col <= b.col) ? [a, b] : [b, a]
}

/** Scrolls minimally so the cursor is inside the window, with 4 columns of slack sideways. */
export function follow(
  file: { lines: string[]; cursor: Pos; top: number; left: number },
  height: number,
  textWidth: number,
): { top: number; left: number } {
  const h = Math.max(1, height)
  const w = Math.max(1, textWidth)
  let { top, left } = file
  const { line } = file.cursor
  if (line < top) top = line
  else if (line >= top + h) top = line - h + 1
  const dc = displayCol(file.lines[line] ?? '', file.cursor.col)
  if (dc < left) left = Math.max(0, dc - 4)
  else if (dc >= left + w) left = Math.max(0, dc - w + 4)
  return { top: Math.max(0, top), left }
}

/** The text position under a Client cell (x, y). */
export function hit(
  file: { lines: string[]; top: number; left: number },
  gutter: number,
  x: number,
  y: number,
): Pos {
  const line = Math.min(Math.max(file.top + y, 0), Math.max(0, file.lines.length - 1))
  if (x < gutter) return { line, col: 0 }
  return { line, col: colAt(file.lines[line] ?? '', file.left + x - gutter) }
}
