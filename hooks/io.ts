import type { FsStat, PaneOpenArgs, ProcessRunResult, UiCopyArgs, UiCopyResult } from 'claude-code'

import type { DiffView, EditorFile } from '../types'

/**
 * What the editor needs from the engine, as plain functions. `register.tsx` builds it from `$`,
 * because `claude plugin validate` follows `$` only inside the file that spells every call.
 */
export type Io = {
  stat: (path: string) => Promise<FsStat>
  read: (path: string) => Promise<string>
  write: (path: string, text: string) => Promise<void>
  run: (argv: readonly string[]) => Promise<ProcessRunResult>
  copy: (args: UiCopyArgs) => Promise<UiCopyResult>
  toast: (text: string) => void
  open: (args: PaneOpenArgs) => Promise<unknown>
  close: (id: string) => Promise<void>
  now: () => Promise<number>
  after: (ms: number, fn: () => void) => void
  getFile: (id: string) => Promise<EditorFile | null | undefined>
  setFile: (id: string, file: EditorFile | null) => Promise<void>
  getOrder: () => Promise<string[] | undefined>
  setOrder: (ids: string[]) => Promise<void>
  setDiff: (id: string, diff: DiffView | null) => Promise<void>
}
