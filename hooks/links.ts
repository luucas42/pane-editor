const PATHLIKE = /^(?:\.{1,2}\/|\/)?(?:[\w.@+-]+\/)*[\w.@+-]+(?::\d+(?::\d+)?)?$/
const INLINE = /`([^`\n]+)`/g

/** Runs `fn` on every line outside ``` fences; fence lines are passed through as they are. */
function outsideFences(text: string, fn: (line: string) => string): string {
  let fenced = false
  return text
    .split('\n')
    .map(line => {
      if (/^\s*```/.test(line)) { fenced = !fenced; return line }
      return fenced ? line : fn(line)
    })
    .join('\n')
}

function looksLikePath(token: string): boolean {
  return PATHLIKE.test(token) && (token.includes('/') || /\.\w{1,8}/.test(token))
}

/** The unique backticked path-like tokens of a reply, outside code fences. */
export function pathTokens(text: string, max = 40): string[] {
  const found = new Set<string>()
  outsideFences(text, line => {
    for (const m of line.matchAll(INLINE)) {
      const token = m[1] ?? ''
      if (found.size < max && looksLikePath(token)) found.add(token)
    }
    return line
  })
  return [...found]
}

/** Splits `a/b.ts:12:4` into the file and its line and column. */
export function splitLoc(token: string): { file: string; line?: number; col?: number } {
  const m = /^(.*?)(?::(\d+)(?::(\d+))?)?$/.exec(token)
  const out: { file: string; line?: number; col?: number } = { file: m?.[1] ?? token }
  if (m?.[2]) out.line = Number(m[2])
  if (m?.[3]) out.col = Number(m[3])
  return out
}

function normalize(path: string): string {
  const out: string[] = []
  for (const part of path.split('/')) {
    if (part === '' || part === '.') continue
    if (part === '..') out.pop()
    else out.push(part)
  }
  return '/' + out.join('/')
}

/** An absolute path stays; anything else is joined to `cwd`. */
export function resolvePath(file: string, cwd: string): string {
  return file.startsWith('/') ? file : normalize(`${cwd}/${file}`)
}

/** A `file://` link to a path, with `#L<line>` when a line is given. */
export function hrefOf(abs: string, line?: number): string {
  const path = encodeURI(abs).replace(/[?#()]/g, c => '%' + c.charCodeAt(0).toString(16).toUpperCase())
  return `file://${path}${line ? `#L${line}` : ''}`
}

/** The path and line of a `file://` link; undefined for any other href. */
export function parseHref(href: string): { path: string; line?: number } | undefined {
  if (!href.startsWith('file://')) return undefined
  const rest = href.slice('file://'.length)
  const hashAt = rest.indexOf('#')
  const raw = hashAt < 0 ? rest : rest.slice(0, hashAt)
  const frag = hashAt < 0 ? '' : rest.slice(hashAt + 1)
  let path: string
  try { path = decodeURIComponent(raw) } catch { return undefined }
  const m = /^L(\d+)$/.exec(frag)
  return m ? { path, line: Number(m[1]) } : { path }
}

/** Rewrites each known `` `token` `` to a markdown link, outside fences and existing links. */
export function linkify(text: string, hrefs: ReadonlyMap<string, string>): string {
  return outsideFences(text, line =>
    line.replace(INLINE, (whole, token: string, at: number, all: string) => {
      const href = hrefs.get(token)
      if (!href) return whole
      const wrapped = all[at - 1] === '[' && all.startsWith('](', at + whole.length)
      return wrapped ? whole : `[${whole}](${href})`
    }),
  )
}
