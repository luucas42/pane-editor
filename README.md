# pane-editor

A file editor that lives in a docked pane of Claude Code's fullscreen terminal. When Claude names a file, a click on its path opens that file here, not in the IDE.

```
 a.ts  hooks/                                   Ln 12, Col 8 · TypeScript · LF
   10 │ export function clamp(n: number, low: number, high: number): number {
   11 │   // keep n inside [low, high]
   12 │   return Math.min(Math.max(n, low), high)
   13 │ }
 [ save ] [ undo ] [ redo ]  ✓ saved
```

## What it does

- **Opens files three ways.**
  - A path in Claude's reply, written in backticks (`` `hooks/format.ts:78` ``), becomes a link. A plain click opens it in the editor; a ctrl/cmd-click still does what your terminal does. Only paths of files that exist become links.
  - Under every Read, Edit, Write, MultiEdit and NotebookEdit row there is a dim `↗ open in editor` link.
  - `/open <path>[:line]`.
- **One tab per file.** A newly opened pane is shown, and the other panes go behind it. At most **6** editors are open at once: opening a 7th closes the one opened longest ago that has no unsaved edits. If all 6 have unsaved edits, the new file does not open and a toast says so. Files over 4 MiB, binary files and anything that is not a file are refused with a toast.
- **Never takes the keyboard by itself.** A click inside the text gives the editor the keys and places the cursor. Esc hands the keys back to the prompt.
- **Edits like an editor.** Line numbers, syntax colours (TypeScript, JavaScript, Python, shell, JSON, Markdown, CSS, HTML, Go, Rust, C, Java, Ruby, YAML, TOML, SQL), the mouse wheel to scroll, and sideways scrolling for long lines (they never wrap).
- **Follows the disk.** Every open file is checked every 2 s, and right after any Edit, Write, MultiEdit or NotebookEdit tool call on it.

## Keys

| Key | Does |
| --- | --- |
| typing, Enter, Tab | insert text (Turkish letters too), a new line, the file's indent |
| Backspace, Delete | delete left / right |
| option+Backspace, ctrl+w | delete the word to the left |
| arrows | move; option+← / → jump a word, ctrl+← / → go to line start / end |
| Home / End, ctrl+a / ctrl+e | line start (first non-space, then column 0) / line end |
| ctrl+Home / ctrl+End | start / end of the file |
| PgUp / PgDn | move a page |
| shift + any movement key | extend the selection |
| ctrl+s | save |
| ctrl+z | undo |
| ctrl+y, ctrl+shift+z | redo |
| ctrl+v | paste |

Claude Code keeps ctrl+c for itself, so it never reaches the editor. Copy and cut are on the footer buttons and in the right-click menu.

## Mouse

| Action | Does |
| --- | --- |
| click | place the cursor |
| drag | select (blue, keeping the syntax colours); dragging above or below the text scrolls it |
| right-click | menu: copy, cut, paste, select all |
| wheel | scroll the text |

Selecting never touches the clipboard. With a selection the footer shows `N lines · M chars` and `[ copy ] [ cut ]`; copying flashes `✓ copied 48 chars`.

## Disk changes

| When | The editor |
| --- | --- |
| the file changed and you have no unsaved edits | reloads silently and flashes `↻ reloaded from disk` |
| the file changed and you have unsaved edits | `⚠ format.ts changed on disk  [ reload ] [ keep mine ] [ diff ]` |
| the file was deleted | `⚠ format.ts was deleted on disk  [ save to recreate ] [ close ]` |
| you save and the disk changed since you opened or last saved it | `⚠ format.ts changed on disk since you opened it  [ overwrite ] [ reload ] [ diff ] [ cancel ]` |
| you close a file with unsaved edits | the pane stays open: `● unsaved changes  [ save & close ] [ discard ] [ cancel ]` |

`[ diff ]` opens a second tab, `Δ format.ts`, with a unified diff from the disk to the editor. `[ keep mine ]` takes the disk's current state as the base, so the next save does not ask again. A tab titled `● name` has unsaved edits.

## Install

At the prompt of a Claude Code terminal session:

```
/plugin install pane-editor --marketplace luucas42/pane-editor
```

Answer `y` to add the marketplace and pick a scope. The plugin is a function-hooks mod, so its hooks start running in that session straight away.

### Requirements

- A Claude Code build with function hooks (mods). This mod was built for 2.1.294. The hooks API is early access and may change between releases.
- **Fullscreen terminal UI** (`"tui": "fullscreen"`). Other surfaces draw a note, "open in the terminal".
- On macOS, `pbpaste` for ctrl+v. On Linux, `wl-paste` or `xclip`. Without one, paste flashes `paste needs pbpaste, wl-paste or xclip`.

## Commands

| Command | What it does |
| --- | --- |
| `/open <path>[:line]` | Open a file in an editor pane, or show the one already open, at a line |

## How it works

The hooks module is the one source of truth for every open file; the Client (`editor-client.tsx`) only forwards keys and pointer events and draws the rows it is given.

| Event | Does |
| --- | --- |
| `ui.render` Pane | draws the editor (header, banner, Client, footer) or the diff |
| `ui.message` | takes the Client's unacked input, applies it in order, answers the next props |
| `ui.scroll` | the wheel moves the editor's own window |
| `ui.close` | keeps a dirty file open behind the close banner when you close it |
| `ui.render` AssistantMessage / ToolUse | the path links |
| `tool.call` | checks the file right after an Edit or Write on it |
| `session.start` | registers `/open` and starts the 2 s disk check |

Input carries a sequence number, and every post repeats the events the hooks module has not acknowledged yet, so no key is lost or applied twice. All work for one file (keys, buttons, disk checks, saves) runs through one queue. The text lives in memory and in the session's `$.state`, so a reload of the mod keeps the open files; the undo history lives in memory only.

## Development

```
hooks/text.ts           the document, the edit commands, undo and redo
hooks/keys.ts           Client key event to command
hooks/syntax.ts         language from a path, line tokenizer, palette
hooks/window.ts         the visible frame, hit-testing, follow
hooks/links.ts          path tokens in a reply, linkify, file:// links
hooks/diff.ts           line diff to unified text
hooks/protocol.ts       what the Client posts and what it draws
hooks/io.ts             the engine calls the editor makes, as plain functions
hooks/store.ts          open files, their history and per-file queues
hooks/actions.ts        save, paste, copy, undo, disk checks, opening, closing
hooks/view.tsx          the Pane trees: editor and diff
hooks/editor-client.tsx the Client surface module
hooks/register.tsx      the event hooks
types/index.d.ts        the $.state contract
tests/                  claude plugin test
```

```
claude plugin validate .
claude plugin test .
```

## License

MIT
