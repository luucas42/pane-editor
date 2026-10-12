import type { DiffView, EditorFile } from '../types'
import type { Io } from './io'
import type { History } from './text'

/** The hooks module is the source of truth; `$.state` mirrors it for the render and survives a reload. */
const files = new Map<string, EditorFile>()
const histories = new Map<string, History>()
const chains = new Map<string, Promise<unknown>>()
let order: string[] | undefined

export const MAX_EDITORS = 6
export const isEditorId = (id: string): boolean => /^ed-\d+$/.test(id)
export const isDiffId = (id: string): boolean => /^diff-ed-\d+$/.test(id)

/** One open editor by id: the memory mirror first, then `$.state` (empty after a hot reload). */
export async function getFile(io: Io, id: string): Promise<EditorFile | undefined> {
  const held = files.get(id)
  if (held) return held
  const value = await io.getFile(id)
  if (value) files.set(id, value)
  return value ?? undefined
}

/** Writes a file to both the mirror and `$.state`. */
export async function putFile(io: Io, file: EditorFile): Promise<void> {
  files.set(file.id, file)
  await io.setFile(file.id, file)
}

/** Forgets an editor: the file, its history and its queue. */
export async function dropFile(io: Io, id: string): Promise<void> {
  files.delete(id)
  histories.delete(id)
  chains.delete(id)
  await io.setFile(id, null)
}

/** The open editor ids, oldest first. */
export async function getOrder(io: Io): Promise<string[]> {
  if (order === undefined) order = (await io.getOrder()) ?? []
  return order
}

/** Replaces the open editor ids. */
export async function setOrder(io: Io, ids: string[]): Promise<void> {
  order = ids
  await io.setOrder(ids)
}

export const historyOf = (id: string): History => histories.get(id) ?? { undo: [], redo: [] }
export const setHistory = (id: string, history: History): void => void histories.set(id, history)

/** Runs `work` after everything queued before it under `key`; a failure never blocks the line. */
export function serial<T>(key: string, work: () => Promise<T>): Promise<T> {
  const run = (chains.get(key) ?? Promise.resolve()).then(work)
  chains.set(key, run.then(() => undefined, () => undefined))
  return run
}

export async function putDiff(io: Io, id: string, diff: DiffView | null): Promise<void> {
  await io.setDiff(id, diff)
}
