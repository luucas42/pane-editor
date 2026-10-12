/** A place in the text: `line` 0-based, `col` in UTF-16 code units, 0..line.length. */
export type Pos = { line: number; col: number }

export type Banner =
  | { kind: 'changed' }      // the disk changed while there are unsaved edits
  | { kind: 'deleted' }      // the file is gone from disk
  | { kind: 'overwrite' }    // a save found the disk changed since load/save
  | { kind: 'close' }        // a close was asked with unsaved edits

export type EditorFile = {
  id: string                 // pane id, `ed-1` … 
  path: string               // absolute
  lines: string[]
  eol: '\n' | '\r\n'
  cursor: Pos
  anchor?: Pos               // a selection is anchor..cursor when anchor is set and differs
  goalCol?: number           // display column that up/down keep
  top: number                // first line shown
  left: number               // first display column shown
  base: { hash: number; mtimeMs: number; size: number }  // the disk as last loaded or saved
  dirty: boolean             // hash(text) !== base.hash
  banner?: Banner
  flash?: { text: string; at: number }
  menu?: { x: number; y: number }       // right-click menu, Client cells
  view: { rows: number; columns: number } // the Client's size as it last reported it
  openedAt: number
  input: { mount: string; ack: number }  // the input protocol (below)
}

export type DiffView = { title: string; text: string }

declare module 'claude-code' {
  interface PluginState {
    'pane-editor': {
      files: StateFamily<EditorFile | null>   // id → file; null once closed
      order: string[]                         // open editor ids, oldest first
      diffs: StateFamily<DiffView | null>     // `diff-<id>` → diff text
    }
  }
}
