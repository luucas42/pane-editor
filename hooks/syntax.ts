export type TokKind = 'kw' | 'str' | 'num' | 'com' | 'fn' | 'type' | 'lit' | 'tag' | 'attr' | 'head' | 'code' | 'link'
export type Tok = { t: string; k?: TokKind }
export type LangId = 'ts' | 'js' | 'py' | 'sh' | 'json' | 'md' | 'css' | 'html' | 'go' | 'rs' | 'c' | 'java' | 'rb' | 'yaml' | 'toml' | 'sql' | 'plain'
export type Lang = { id: LangId; name: string }
export type TokState = 0 | 'block' | 'tmpl' | 'fence' | 'triple' | 'markupComment'

/** One Dark colours for each token kind. */
export const PALETTE: Record<TokKind, string> = {
  kw: '#C678DD',
  str: '#98C379',
  num: '#D19A66',
  com: '#7F848E',
  fn: '#61AFEF',
  type: '#E5C07B',
  lit: '#D19A66',
  tag: '#E06C75',
  attr: '#D19A66',
  head: '#61AFEF',
  code: '#98C379',
  link: '#56B6C2',
}

const EXT: Record<string, [LangId, string]> = {
  ts: ['ts', 'TypeScript'], tsx: ['ts', 'TypeScript'], mts: ['ts', 'TypeScript'], cts: ['ts', 'TypeScript'],
  js: ['js', 'JavaScript'], jsx: ['js', 'JavaScript'], mjs: ['js', 'JavaScript'], cjs: ['js', 'JavaScript'],
  py: ['py', 'Python'],
  sh: ['sh', 'Shell'], bash: ['sh', 'Shell'], zsh: ['sh', 'Shell'],
  json: ['json', 'JSON'], jsonc: ['json', 'JSON'],
  md: ['md', 'Markdown'], markdown: ['md', 'Markdown'],
  css: ['css', 'CSS'], scss: ['css', 'SCSS'], less: ['css', 'Less'],
  html: ['html', 'HTML'], htm: ['html', 'HTML'], xml: ['html', 'XML'], svg: ['html', 'SVG'], vue: ['html', 'Vue'],
  go: ['go', 'Go'],
  rs: ['rs', 'Rust'],
  c: ['c', 'C'], h: ['c', 'C'], cpp: ['c', 'C++'], hpp: ['c', 'C++'], cc: ['c', 'C++'],
  java: ['java', 'Java'], kt: ['java', 'Kotlin'], kts: ['java', 'Kotlin'], swift: ['java', 'Swift'], cs: ['java', 'C#'],
  rb: ['rb', 'Ruby'],
  yml: ['yaml', 'YAML'], yaml: ['yaml', 'YAML'],
  toml: ['toml', 'TOML'], ini: ['toml', 'INI'], conf: ['toml', 'Config'],
  sql: ['sql', 'SQL'],
}

const BASENAMES: Record<string, Lang> = {
  '.zshrc': { id: 'sh', name: 'Shell' },
  '.bashrc': { id: 'sh', name: 'Shell' },
}

/** The language of a file from its path; `plain` when unknown. */
export function langOf(path: string): Lang {
  const base = path.slice(path.lastIndexOf('/') + 1)
  const byName = BASENAMES[base]
  if (byName) return byName
  const dot = base.lastIndexOf('.')
  const hit = dot > 0 ? EXT[base.slice(dot + 1).toLowerCase()] : undefined
  return hit ? { id: hit[0], name: hit[1] } : { id: 'plain', name: 'Plain text' }
}

type Cfg = {
  line?: string
  hash?: 'any' | 'ws'
  block?: boolean
  quotes: string
  tmpl?: boolean
  triple?: boolean
  kw: Set<string>
  lit: Set<string>
  typeCap?: boolean
  nocase?: boolean
  unit?: boolean
}

const words = (s: string): Set<string> => new Set(s.split(/\s+/).filter(Boolean))
const LIT = words('true false null undefined None True False nil')

const KW: Record<string, Set<string>> = {
  ts: words('abstract as async await break case catch class const continue debugger declare default delete do else enum export extends finally for from function get if implements import in infer instanceof interface is keyof let namespace new of readonly return satisfies set static super switch this throw try type typeof var void while with yield'),
  py: words('and as assert async await break class continue def del elif else except finally for from global if import in is lambda nonlocal not or pass raise return try while with yield self'),
  sh: words('if then else elif fi for while until do done case esac in function select time export local readonly return exit break continue source alias unset set shift echo cd'),
  go: words('break case chan const continue default defer else fallthrough for func go goto if import interface map package range return select struct switch type var'),
  rs: words('as async await break const continue crate dyn else enum extern fn for if impl in let loop match mod move mut pub ref return self Self static struct super trait type unsafe use where while'),
  c: words('auto break case char const continue default do double else enum extern float for goto if inline int long register return short signed sizeof static struct switch typedef union unsigned void volatile while class namespace template typename public private protected virtual new delete using bool'),
  java: words('abstract as break case catch class const continue data default do else enum extends final finally for fun func if implements import in interface is let new null object override package private protected public return static struct super switch this throw throws try val var void when while'),
  rb: words('alias and begin break case class def defined? do else elsif end ensure for if in module next not or redo rescue retry return self super then undef unless until when while yield'),
  yaml: words(''),
  toml: words(''),
  json: words(''),
  css: words(''),
  sql: words('select from where and or not insert into values update set delete create table drop alter add index join left right inner outer full on as group by order having limit offset union all distinct case when then else end null is in like between exists primary key foreign references default unique constraint view with'),
}

const CFG: Partial<Record<LangId, Cfg>> = {
  ts: { line: '//', block: true, quotes: '\'"', tmpl: true, kw: KW.ts!, lit: LIT, typeCap: true },
  js: { line: '//', block: true, quotes: '\'"', tmpl: true, kw: KW.ts!, lit: LIT, typeCap: true },
  go: { line: '//', block: true, quotes: '\'"', kw: KW.go!, lit: LIT, typeCap: true },
  rs: { line: '//', block: true, quotes: '\'"', kw: KW.rs!, lit: LIT, typeCap: true },
  c: { line: '//', block: true, quotes: '\'"', kw: KW.c!, lit: LIT, typeCap: true },
  java: { line: '//', block: true, quotes: '\'"', kw: KW.java!, lit: LIT, typeCap: true },
  css: { block: true, quotes: '\'"', kw: KW.css!, lit: LIT, unit: true },
  py: { line: '#', hash: 'any', quotes: '\'"', triple: true, kw: KW.py!, lit: LIT },
  sh: { line: '#', hash: 'ws', quotes: '\'"', kw: KW.sh!, lit: LIT },
  rb: { line: '#', hash: 'any', quotes: '\'"', kw: KW.rb!, lit: LIT },
  yaml: { line: '#', hash: 'ws', quotes: '\'"', kw: KW.yaml!, lit: LIT },
  toml: { line: '#', hash: 'ws', quotes: '\'"', kw: KW.toml!, lit: LIT },
  json: { line: '//', block: true, quotes: '"', kw: KW.json!, lit: LIT },
  sql: { line: '--', block: true, quotes: '\'"', kw: KW.sql!, lit: LIT, nocase: true },
}

const IDENT = /[\p{L}_$][\p{L}\p{N}_$]*/uy
const CSS_IDENT = /-?[\p{L}_][\p{L}\p{N}_-]*/uy
const NUMBER = /0[xX][\da-fA-F_]+|\d[\d_]*(?:\.\d+)?(?:[eE][+-]?\d+)?/y
const CSS_NUMBER = /\d[\d_]*(?:\.\d+)?(?:[eE][+-]?\d+)?[a-zA-Z%]*/y
const RS_CHAR = /'(?:\\.[^']*|[^\\'])'/y

function sticky(re: RegExp, s: string, at: number): string | undefined {
  re.lastIndex = at
  const m = re.exec(s)
  return m ? m[0] : undefined
}

/** Index just past the closing quote of a string opened at `from`, or the line end. */
function stringEnd(line: string, from: number, q: string): { end: number; closed: boolean } {
  let j = from + 1
  while (j < line.length) {
    const c = line[j]
    if (c === '\\') j += 2
    else if (c === q) return { end: j + 1, closed: true }
    else j++
  }
  return { end: line.length, closed: false }
}

function merge(toks: Tok[]): Tok[] {
  const out: Tok[] = []
  for (const tok of toks) {
    if (tok.t === '') continue
    const last = out[out.length - 1]
    if (last && last.k === tok.k) last.t += tok.t
    else out.push(tok.k ? { t: tok.t, k: tok.k } : { t: tok.t })
  }
  return out
}

function classify(word: string, cfg: Cfg, next: string | undefined): TokKind | undefined {
  const w = cfg.nocase ? word.toLowerCase() : word
  if (cfg.lit.has(w)) return 'lit'
  if (cfg.kw.has(w)) return 'kw'
  if (next === '(') return 'fn'
  if (cfg.typeCap && /^\p{Lu}/u.test(word)) return 'type'
  return undefined
}

function scanCode(line: string, lang: LangId, cfg: Cfg, state: TokState): { toks: Tok[]; end: TokState } {
  const toks: Tok[] = []
  const emit = (t: string, k?: TokKind) => toks.push(k ? { t, k } : { t })
  let end: TokState = 0
  let i = 0

  if (state === 'block' && cfg.block) {
    const close = line.indexOf('*/')
    if (close < 0) return { toks: [{ t: line, k: 'com' }], end: 'block' }
    emit(line.slice(0, close + 2), 'com')
    i = close + 2
  } else if (state === 'tmpl' && cfg.tmpl) {
    const r = stringEnd(line, -1, '`')
    emit(line.slice(0, r.end), 'str')
    if (!r.closed) return { toks, end: 'tmpl' }
    i = r.end
  } else if (state === 'triple' && cfg.triple) {
    const close = Math.min(...['"""', "'''"].map(q => { const at = line.indexOf(q); return at < 0 ? Infinity : at }))
    if (close === Infinity) return { toks: [{ t: line, k: 'str' }], end: 'triple' }
    emit(line.slice(0, close + 3), 'str')
    i = close + 3
  }

  if (i === 0 && lang === 'yaml') {
    const m = /^(\s*(?:-\s+)*)([\w.-]+)(?=\s*:(?:\s|$))/.exec(line)
    if (m) { emit(m[1] ?? ''); emit(m[2] ?? '', 'attr'); i = m[0].length }
  } else if (i === 0 && lang === 'toml') {
    const sec = /^(\s*)(\[.*\])(\s*)$/.exec(line)
    if (sec) { emit(sec[1] ?? ''); emit(sec[2] ?? '', 'head'); emit(sec[3] ?? ''); return { toks: merge(toks), end } }
    const m = /^(\s*)([\w."-]+)(?=\s*=)/.exec(line)
    if (m) { emit(m[1] ?? ''); emit(m[2] ?? '', 'attr'); i = m[0].length }
  }

  while (i < line.length) {
    const c = line[i] as string
    const prev = line[i - 1]

    if (cfg.line && line.startsWith(cfg.line, i) && (cfg.hash !== 'ws' || i === 0 || /\s/.test(prev ?? ''))) {
      emit(line.slice(i), 'com')
      break
    }
    if (lang === 'toml' && c === ';' && line.slice(0, i).trim() === '') { emit(line.slice(i), 'com'); break }
    if (cfg.block && c === '/' && line[i + 1] === '*') {
      const close = line.indexOf('*/', i + 2)
      if (close < 0) { emit(line.slice(i), 'com'); end = 'block'; break }
      emit(line.slice(i, close + 2), 'com')
      i = close + 2
      continue
    }
    if (cfg.tmpl && c === '`') {
      const r = stringEnd(line, i, '`')
      emit(line.slice(i, r.end), 'str')
      if (!r.closed) end = 'tmpl'
      i = r.end
      continue
    }
    if (cfg.quotes.includes(c)) {
      if (lang === 'rs' && c === "'") {
        const ch = sticky(RS_CHAR, line, i)
        if (!ch) { emit(c); i++; continue }
        emit(ch, 'str')
        i += ch.length
        continue
      }
      if (cfg.triple && line.startsWith(c.repeat(3), i)) {
        const close = line.indexOf(c.repeat(3), i + 3)
        if (close < 0) { emit(line.slice(i), 'str'); end = 'triple'; break }
        emit(line.slice(i, close + 3), 'str')
        i = close + 3
        continue
      }
      const r = stringEnd(line, i, c)
      const isKey = lang === 'json' && /^\s*:/.test(line.slice(r.end))
      emit(line.slice(i, r.end), isKey ? 'attr' : 'str')
      i = r.end
      continue
    }
    if (c >= '0' && c <= '9') {
      const n = sticky(cfg.unit ? CSS_NUMBER : NUMBER, line, i)
      if (n) { emit(n, 'num'); i += n.length; continue }
    }
    if (lang === 'css' && (c === '@' || c === '#') && /[\w-]/.test(line[i + 1] ?? '')) {
      const m = /[@#][\w-]+/y
      const w = sticky(m, line, i) ?? c
      emit(w, c === '@' ? 'kw' : /^#[\da-fA-F]{3,8}$/.test(w) ? 'num' : undefined)
      i += w.length
      continue
    }
    const word = sticky(lang === 'css' ? CSS_IDENT : IDENT, line, i)
    if (word) {
      const after = line[i + word.length]
      if (cfg.triple && /^[rbfuRBFU]{1,2}$/.test(word) && after && cfg.quotes.includes(after)) {
        emit(word, 'str')
        i += word.length
        continue
      }
      emit(word, classify(word, cfg, after))
      i += word.length
      continue
    }
    emit(c)
    i++
  }
  return { toks: merge(toks), end }
}

function scanMarkdown(line: string, state: TokState): { toks: Tok[]; end: TokState } {
  const fence = /^\s*(```|~~~)/.test(line)
  if (state === 'fence') return { toks: line ? [{ t: line, k: 'code' }] : [], end: fence ? 0 : 'fence' }
  if (fence) return { toks: [{ t: line, k: 'code' }], end: 'fence' }
  if (/^\s{0,3}#{1,6}(\s|$)/.test(line)) return { toks: [{ t: line, k: 'head' }], end: 0 }
  const toks: Tok[] = []
  let i = 0
  while (i < line.length) {
    const c = line[i] as string
    if (c === '`') {
      const close = line.indexOf('`', i + 1)
      if (close > i) { toks.push({ t: line.slice(i, close + 1), k: 'code' }); i = close + 1; continue }
    } else if (c === '[') {
      const link = sticky(/\[[^\]]*\]\([^)]*\)/y, line, i)
      if (link) { toks.push({ t: link, k: 'link' }); i += link.length; continue }
    } else if (c === '*' && line[i + 1] === '*') {
      const close = line.indexOf('**', i + 2)
      if (close > i + 2) { toks.push({ t: line.slice(i, close + 2), k: 'kw' }); i = close + 2; continue }
    }
    toks.push({ t: c })
    i++
  }
  return { toks: merge(toks), end: 0 }
}

function scanHtml(line: string, state: TokState): { toks: Tok[]; end: TokState } {
  const toks: Tok[] = []
  let i = 0
  let inTag = false
  let end: TokState = 0
  if (state === 'markupComment') {
    const close = line.indexOf('-->')
    if (close < 0) return { toks: line ? [{ t: line, k: 'com' }] : [], end: 'markupComment' }
    toks.push({ t: line.slice(0, close + 3), k: 'com' })
    i = close + 3
  }
  while (i < line.length) {
    const c = line[i] as string
    if (!inTag && line.startsWith('<!--', i)) {
      const close = line.indexOf('-->', i + 4)
      if (close < 0) { toks.push({ t: line.slice(i), k: 'com' }); end = 'markupComment'; break }
      toks.push({ t: line.slice(i, close + 3), k: 'com' })
      i = close + 3
      continue
    }
    if (!inTag && c === '<') {
      const name = sticky(/<[!?/]?[\w:.-]*/y, line, i) ?? c
      toks.push({ t: name, k: 'tag' })
      i += name.length
      inTag = true
      continue
    }
    if (inTag) {
      if (c === '>' || (c === '/' && line[i + 1] === '>')) {
        const close = c === '>' ? '>' : '/>'
        toks.push({ t: close, k: 'tag' })
        i += close.length
        inTag = false
        continue
      }
      if (c === '"' || c === "'") {
        const r = stringEnd(line, i, c)
        toks.push({ t: line.slice(i, r.end), k: 'str' })
        i = r.end
        continue
      }
      const attr = sticky(/[\w:@.#-]+/y, line, i)
      if (attr) { toks.push({ t: attr, k: 'attr' }); i += attr.length; continue }
    }
    toks.push({ t: c })
    i++
  }
  return { toks: merge(toks), end }
}

/** Splits one line into coloured tokens, given the state the previous line ended in. */
export function tokenize(line: string, lang: LangId, state: TokState): { toks: Tok[]; end: TokState } {
  const plain = { toks: line ? [{ t: line }] : [], end: 0 as TokState }
  try {
    let res: { toks: Tok[]; end: TokState }
    if (lang === 'plain') return { toks: [{ t: line }], end: 0 }
    else if (lang === 'md') res = scanMarkdown(line, state)
    else if (lang === 'html') res = scanHtml(line, state)
    else {
      const cfg = CFG[lang]
      if (!cfg) return plain
      res = scanCode(line, lang, cfg, state)
    }
    return res.toks.map(t => t.t).join('') === line ? res : plain
  } catch {
    return plain
  }
}

/** The tokenizer state at the start of line `upto`. */
export function stateAt(lines: string[], lang: LangId, upto: number): TokState {
  if (lang === 'plain') return 0
  let state: TokState = 0
  const stop = Math.min(upto, lines.length)
  for (let i = 0; i < stop; i++) state = tokenize(lines[i] ?? '', lang, state).end
  return state
}
