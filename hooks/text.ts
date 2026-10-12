import type { Pos } from '../types'
import { colAt, displayCol } from './window'

export type Sel = { cursor: Pos; anchor?: Pos }
export type Doc = { lines: string[]; cursor: Pos; anchor?: Pos; goalCol?: number }
export type Change = { from: Pos; removed: string; inserted: string }
export type Step = { change: Change; before: Sel; after: Sel; kind: 'insert' | 'delete' | 'other'; at: number }
export type History = { undo: Step[]; redo: Step[] }
export type MoveTo = 'left' | 'right' | 'up' | 'down' | 'home' | 'end' | 'pageUp' | 'pageDown' | 'wordLeft' | 'wordRight' | 'docStart' | 'docEnd'
export type EditCommand =
  | { type: 'insert'; text: string }
  | { type: 'newline' }
  | { type: 'tab' }
  | { type: 'backspace' } | { type: 'delete' } | { type: 'deleteWordBack' }
  | { type: 'move'; to: MoveTo; extend: boolean }
  | { type: 'selectAll' }

const HISTORY_CAP = 200
const COALESCE_MS = 1000

/** Splits file text into lines; the eol is CRLF when the text has any. */
export function split(text: string): { lines: string[]; eol: '\n' | '\r\n' } {
  return { lines: text.split(/\r?\n/), eol: text.includes('\r\n') ? '\r\n' : '\n' }
}

/** The inverse of `split`. */
export function join(lines: string[], eol: '\n' | '\r\n'): string {
  return lines.join(eol)
}

/** FNV-1a 32-bit over UTF-16 units, unsigned. */
export function hash(text: string): number {
  let h = 0x811c9dc5
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return h >>> 0
}

const before = (a: Pos, b: Pos) => a.line < b.line || (a.line === b.line && a.col < b.col)
const same = (a: Pos, b: Pos) => a.line === b.line && a.col === b.col

/** The selection as start..end, or undefined when there is none. */
export function ordered(doc: Sel): [Pos, Pos] | undefined {
  const { anchor, cursor } = doc
  if (!anchor || same(anchor, cursor)) return undefined
  return before(anchor, cursor) ? [anchor, cursor] : [cursor, anchor]
}

function between(lines: string[], from: Pos, to: Pos): string {
  if (from.line === to.line) return (lines[from.line] ?? '').slice(from.col, to.col)
  const out = [(lines[from.line] ?? '').slice(from.col)]
  for (let n = from.line + 1; n < to.line; n++) out.push(lines[n] ?? '')
  out.push((lines[to.line] ?? '').slice(0, to.col))
  return out.join('\n')
}

/** The selected text, lines joined with `\n`; empty when nothing is selected. */
export function selectedText(doc: Doc): string {
  const sel = ordered(doc)
  return sel ? between(doc.lines, sel[0], sel[1]) : ''
}

/** Pulls a position inside the text. */
export function clamp(lines: string[], pos: Pos): Pos {
  const line = Math.min(Math.max(pos.line, 0), Math.max(0, lines.length - 1))
  return { line, col: Math.min(Math.max(pos.col, 0), (lines[line] ?? '').length) }
}

/** Where the cursor lands after `text` is typed at `from`. */
function endOf(from: Pos, text: string): Pos {
  const parts = text.split('\n')
  const last = parts[parts.length - 1] ?? ''
  return parts.length === 1
    ? { line: from.line, col: from.col + last.length }
    : { line: from.line + parts.length - 1, col: last.length }
}

/** Replaces from..to with `text` (which may hold `\n`). */
export function replace(lines: string[], from: Pos, to: Pos, text: string): { lines: string[]; end: Pos; removed: string } {
  const removed = between(lines, from, to)
  const head = (lines[from.line] ?? '').slice(0, from.col)
  const tail = (lines[to.line] ?? '').slice(to.col)
  const parts = text.split('\n')
  const first = parts[0] ?? ''
  const last = parts[parts.length - 1] ?? ''
  const mid = parts.length === 1 ? [head + first + tail] : [head + first, ...parts.slice(1, -1), last + tail]
  return {
    lines: [...lines.slice(0, from.line), ...mid, ...lines.slice(to.line + 1)],
    end: endOf(from, text),
    removed,
  }
}

const isHigh = (u: number) => u >= 0xd800 && u <= 0xdbff
const isLow = (u: number) => u >= 0xdc00 && u <= 0xdfff

/** The start of the char before `col`; a surrogate pair counts as one. */
function prevCol(line: string, col: number): number {
  if (col >= 2 && isLow(line.charCodeAt(col - 1)) && isHigh(line.charCodeAt(col - 2))) return col - 2
  return Math.max(0, col - 1)
}

function nextCol(line: string, col: number): number {
  if (col + 1 < line.length && isHigh(line.charCodeAt(col)) && isLow(line.charCodeAt(col + 1))) return col + 2
  return Math.min(line.length, col + 1)
}

const WORD = /[\p{L}\p{N}_$]/u
const SPACE = /\s/

function classOf(ch: string): 'space' | 'word' | 'other' {
  return SPACE.test(ch) ? 'space' : WORD.test(ch) ? 'word' : 'other'
}

function charBefore(line: string, col: number): string {
  return line.slice(prevCol(line, col), col)
}

function charAt(line: string, col: number): string {
  return line.slice(col, nextCol(line, col))
}

/** The col a word-left move reaches: skip spaces, then a run of one class. */
function wordStart(line: string, col: number): number {
  let i = col
  while (i > 0 && classOf(charBefore(line, i)) === 'space') i = prevCol(line, i)
  if (i === 0) return 0
  const cls = classOf(charBefore(line, i))
  while (i > 0 && classOf(charBefore(line, i)) === cls) i = prevCol(line, i)
  return i
}

function wordEnd(line: string, col: number): number {
  let i = col
  while (i < line.length && classOf(charAt(line, i)) === 'space') i = nextCol(line, i)
  if (i >= line.length) return line.length
  const cls = classOf(charAt(line, i))
  while (i < line.length && classOf(charAt(line, i)) === cls) i = nextCol(line, i)
  return i
}

function target(doc: Doc, to: MoveTo, pageRows: number): { pos: Pos; goalCol?: number } {
  const { lines, cursor } = doc
  const line = lines[cursor.line] ?? ''
  const last = lines.length - 1
  const rowTo = (n: number, goal: number, keep: boolean) => {
    const l = Math.min(Math.max(n, 0), last)
    return { pos: { line: l, col: colAt(lines[l] ?? '', goal) }, goalCol: keep ? goal : undefined }
  }
  switch (to) {
    case 'left':
      if (cursor.col > 0) return { pos: { line: cursor.line, col: prevCol(line, cursor.col) } }
      return cursor.line > 0 ? { pos: { line: cursor.line - 1, col: (lines[cursor.line - 1] ?? '').length } } : { pos: cursor }
    case 'right':
      if (cursor.col < line.length) return { pos: { line: cursor.line, col: nextCol(line, cursor.col) } }
      return cursor.line < last ? { pos: { line: cursor.line + 1, col: 0 } } : { pos: cursor }
    case 'up':
    case 'down': {
      const goal = doc.goalCol ?? displayCol(line, cursor.col)
      const dir = to === 'up' ? -1 : 1
      if (cursor.line + dir < 0) return { pos: { line: 0, col: 0 }, goalCol: goal }
      if (cursor.line + dir > last) return { pos: { line: last, col: (lines[last] ?? '').length }, goalCol: goal }
      return rowTo(cursor.line + dir, goal, true)
    }
    case 'pageUp':
      return rowTo(cursor.line - Math.max(1, pageRows - 1), displayCol(line, cursor.col), false)
    case 'pageDown':
      return rowTo(cursor.line + Math.max(1, pageRows - 1), displayCol(line, cursor.col), false)
    case 'home': {
      const first = line.search(/\S/)
      const start = first < 0 ? line.length : first
      return { pos: { line: cursor.line, col: cursor.col === start ? 0 : start } }
    }
    case 'end':
      return { pos: { line: cursor.line, col: line.length } }
    case 'wordLeft':
      if (cursor.col === 0) return target(doc, 'left', pageRows)
      return { pos: { line: cursor.line, col: wordStart(line, cursor.col) } }
    case 'wordRight':
      if (cursor.col >= line.length) return target(doc, 'right', pageRows)
      return { pos: { line: cursor.line, col: wordEnd(line, cursor.col) } }
    case 'docStart':
      return { pos: { line: 0, col: 0 } }
    case 'docEnd':
      return { pos: { line: last, col: (lines[last] ?? '').length } }
  }
}

function move(doc: Doc, to: MoveTo, extend: boolean, pageRows: number): Doc {
  const sel = ordered(doc)
  if (!extend && sel && (to === 'left' || to === 'right')) {
    return { lines: doc.lines, cursor: to === 'left' ? sel[0] : sel[1] }
  }
  const t = target(doc, to, pageRows)
  const next: Doc = { lines: doc.lines, cursor: t.pos }
  if (extend) next.anchor = doc.anchor ?? doc.cursor
  if (t.goalCol !== undefined) next.goalCol = t.goalCol
  return next
}

type Edited = { doc: Doc; change?: Change; kind: Step['kind'] }

function spliceDoc(doc: Doc, from: Pos, to: Pos, text: string, kind: Step['kind']): Edited {
  const r = replace(doc.lines, from, to, text)
  if (r.removed === '' && text === '') return { doc, kind: 'other' }
  return {
    doc: { lines: r.lines, cursor: r.end },
    change: { from, removed: r.removed, inserted: text },
    kind: r.removed !== '' && text !== '' ? 'other' : kind,
  }
}

function typeText(doc: Doc, text: string): Edited {
  const sel = ordered(doc)
  const [from, to] = sel ?? [doc.cursor, doc.cursor]
  return spliceDoc(doc, from, to, text.replace(/\r\n?/g, '\n'), 'insert')
}

function deleteBack(doc: Doc, byWord: boolean): Edited {
  const sel = ordered(doc)
  if (sel) return { ...spliceDoc(doc, sel[0], sel[1], '', 'delete'), kind: 'other' }
  const { cursor, lines } = doc
  const line = lines[cursor.line] ?? ''
  if (cursor.col === 0) {
    if (cursor.line === 0) return { doc, kind: 'other' }
    return spliceDoc(doc, { line: cursor.line - 1, col: (lines[cursor.line - 1] ?? '').length }, cursor, '', 'delete')
  }
  const col = byWord ? wordStart(line, cursor.col) : prevCol(line, cursor.col)
  return spliceDoc(doc, { line: cursor.line, col }, cursor, '', 'delete')
}

function deleteForward(doc: Doc): Edited {
  const sel = ordered(doc)
  if (sel) return { ...spliceDoc(doc, sel[0], sel[1], '', 'delete'), kind: 'other' }
  const { cursor, lines } = doc
  const line = lines[cursor.line] ?? ''
  if (cursor.col >= line.length) {
    if (cursor.line >= lines.length - 1) return { doc, kind: 'other' }
    return spliceDoc(doc, cursor, { line: cursor.line + 1, col: 0 }, '', 'delete')
  }
  return spliceDoc(doc, cursor, { line: cursor.line, col: nextCol(line, cursor.col) }, '', 'delete')
}

function tabText(doc: Doc, indent: string): string {
  if (indent === '\t' || indent === '') return indent || '\t'
  const width = indent.length
  const dc = displayCol(doc.lines[doc.cursor.line] ?? '', doc.cursor.col)
  return ' '.repeat(width - (dc % width))
}

/** Applies one edit command; `change` is set when the text changed. */
export function edit(doc: Doc, cmd: EditCommand, ctx: { pageRows: number; indent: string }): Edited {
  switch (cmd.type) {
    case 'insert': return cmd.text === '' ? { doc, kind: 'other' } : typeText(doc, cmd.text)
    case 'newline': return typeText(doc, '\n')
    case 'tab': return typeText(doc, tabText(doc, ctx.indent))
    case 'backspace': return deleteBack(doc, false)
    case 'deleteWordBack': return deleteBack(doc, true)
    case 'delete': return deleteForward(doc)
    case 'move': return { doc: move(doc, cmd.to, cmd.extend, ctx.pageRows), kind: 'other' }
    case 'selectAll': {
      const last = doc.lines.length - 1
      return {
        doc: { lines: doc.lines, anchor: { line: 0, col: 0 }, cursor: { line: last, col: (doc.lines[last] ?? '').length } },
        kind: 'other',
      }
    }
  }
}

/** The indent unit a file uses: a tab, or 2 or 4 spaces (2 by default). */
export function indentOf(lines: string[]): string {
  let tabs = 0
  let spaces = 0
  let seen = 0
  const runs = new Set<number>()
  for (const line of lines) {
    if (seen >= 200) break
    if (!/^[ \t]/.test(line) || line.trim() === '') continue
    seen++
    if (line.startsWith('\t')) tabs++
    else {
      spaces++
      const run = line.length - line.trimStart().length
      if (run === 2 || run === 4) runs.add(run)
    }
  }
  if (tabs > spaces) return '\t'
  const smallest = Math.min(...runs)
  return smallest === 2 || smallest === 4 ? ' '.repeat(smallest) : '  '
}

function mergeable(prev: Step, step: Step): Step | undefined {
  if (prev.kind !== step.kind || step.at - prev.at > COALESCE_MS) return undefined
  const a = prev.change
  const b = step.change
  if (step.kind === 'insert') {
    if (a.inserted.includes('\n') || b.inserted.includes('\n')) return undefined
    if (!same(b.from, endOf(a.from, a.inserted))) return undefined
    return { ...step, before: prev.before, change: { from: a.from, removed: '', inserted: a.inserted + b.inserted } }
  }
  if (step.kind === 'delete') {
    if (same(endOf(b.from, b.removed), a.from)) {
      return { ...step, before: prev.before, change: { from: b.from, removed: b.removed + a.removed, inserted: '' } }
    }
    if (same(b.from, a.from)) {
      return { ...step, before: prev.before, change: { from: a.from, removed: a.removed + b.removed, inserted: '' } }
    }
  }
  return undefined
}

/** Pushes a step, clears redo, caps at 200 and merges quick runs of typing or deleting. */
export function record(history: History, step: Step): History {
  const prev = history.undo[history.undo.length - 1]
  const merged = prev && mergeable(prev, step)
  const undo = merged ? [...history.undo.slice(0, -1), merged] : [...history.undo, step]
  return { undo: undo.slice(-HISTORY_CAP), redo: [] }
}

function restore(lines: string[], sel: Sel): Doc {
  const doc: Doc = { lines, cursor: sel.cursor }
  if (sel.anchor) doc.anchor = sel.anchor
  return doc
}

/** Reverts the last step; undefined when there is none. */
export function undo(doc: Doc, history: History): { doc: Doc; history: History } | undefined {
  const step = history.undo[history.undo.length - 1]
  if (!step) return undefined
  const { from, removed, inserted } = step.change
  const r = replace(doc.lines, from, endOf(from, inserted), removed)
  return {
    doc: restore(r.lines, step.before),
    history: { undo: history.undo.slice(0, -1), redo: [...history.redo, step] },
  }
}

/** Re-applies the last undone step; undefined when there is none. */
export function redo(doc: Doc, history: History): { doc: Doc; history: History } | undefined {
  const step = history.redo[history.redo.length - 1]
  if (!step) return undefined
  const { from, removed, inserted } = step.change
  const r = replace(doc.lines, from, endOf(from, removed), inserted)
  return {
    doc: restore(r.lines, step.after),
    history: { undo: [...history.undo, step], redo: history.redo.slice(0, -1) },
  }
}

/** A click (extend false) or a drag (extend true) at `pos`. */
export function placeAt(doc: Doc, pos: Pos, extend: boolean): Doc {
  const cursor = clamp(doc.lines, pos)
  const next: Doc = { lines: doc.lines, cursor }
  if (extend) next.anchor = doc.anchor ?? doc.cursor
  return next
}
