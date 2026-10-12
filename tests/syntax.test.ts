import { describe, expect, test } from 'claude-code/testing'

import type { LangId, TokState } from '../hooks/syntax'
import { PALETTE, langOf, stateAt, tokenize } from '../hooks/syntax'

const kinds = (line: string, lang: LangId, state: TokState = 0) =>
  tokenize(line, lang, state).toks.filter(t => t.k).map(t => `${t.k}:${t.t}`)

const SAMPLES: Array<[LangId, string]> = [
  ['ts', 'export async function load<T>(path: string): Promise<T | undefined> {'],
  ['ts', "  const x = `a ${b} c` + 'it\\'s' // trailing"],
  ['ts', '\tif (a === 0x1F && b > 1_000.5e3) return null;'],
  ['js', 'module.exports = { name: "ş-ğ", run() { return 42 } }'],
  ['py', 'def f(x, *, y=None): return f"{x}" + \'a\' # note'],
  ['py', '    """doc string"""  # tail'],
  ['sh', 'for f in *.ts; do echo "$f" # list'],
  ['sh', "echo 'a # b' # real comment"],
  ['json', '  "name": "pane-editor", "n": [1, 2.5, -3e2, true, null]'],
  ['json', '{"a": {"b": "c:d"}}'],
  ['md', '# Heading with `code`'],
  ['md', 'Some **bold** text and a [link](https://x.y/z) here'],
  ['md', '```ts'],
  ['css', '.a:hover > #id, @media (max-width: 10px) { color: #fff; margin: 0 1.5rem }'],
  ['html', '<div class="a" id=\'b\' data-x=1><span>hi</span></div>'],
  ['html', '<!-- c --> text <br/>'],
  ['go', 'func (s *Server) Run(ctx context.Context) error { return nil }'],
  ['rs', "fn main<'a>(x: &'a str) -> char { let c = 'x'; c }"],
  ['c', '#include <stdio.h> // hi'],
  ['c', 'int main(void) { printf("%d\\n", 0x10); /* c */ return 0; }'],
  ['java', '@Override public static void main(String[] args) { new Foo(); }'],
  ['rb', 'def hello(name) puts "hi #{name}" end # done'],
  ['yaml', '  - name: build  # step'],
  ['yaml', 'key: "value" # c'],
  ['toml', '[package.metadata]'],
  ['toml', 'version = "0.1.0" # c'],
  ['sql', "SELECT id, name FROM users WHERE age >= 18 -- adults"],
  ['plain', 'anything at all, 123 "quotes" // not comments'],
  ['ts', ''],
  ['ts', '   \t  '],
  ['ts', 'unterminated "string and `template'],
  ['html', '<a href="x'],
  ['md', '`unclosed code and **bold and [link]( '],
]

describe('syntax', () => {
  test('langOf maps extensions, basenames and unknowns', () => {
    expect(langOf('/a/b/c.ts')).toEqual({ id: 'ts', name: 'TypeScript' })
    expect(langOf('/a/View.TSX').id).toBe('ts')
    expect(langOf('x.mjs').id).toBe('js')
    expect(langOf('x.py').name).toBe('Python')
    expect(langOf('/home/b/.zshrc').id).toBe('sh')
    expect(langOf('/home/b/.bashrc').id).toBe('sh')
    expect(langOf('x.zsh').id).toBe('sh')
    expect(langOf('x.jsonc').id).toBe('json')
    expect(langOf('x.markdown').id).toBe('md')
    expect(langOf('x.scss').id).toBe('css')
    expect(langOf('x.vue').id).toBe('html')
    expect(langOf('x.hpp').id).toBe('c')
    expect(langOf('x.kt').id).toBe('java')
    expect(langOf('x.yml').id).toBe('yaml')
    expect(langOf('x.ini').id).toBe('toml')
    expect(langOf('x.sql').id).toBe('sql')
    expect(langOf('Makefile').id).toBe('plain')
    expect(langOf('/a.b/README').id).toBe('plain')
    expect(langOf('x.unknown').id).toBe('plain')
  })

  test('tokens join back to the line for sample lines in every language', () => {
    expect(SAMPLES.length).toBeGreaterThanOrEqual(30)
    for (const [lang, line] of SAMPLES) {
      for (const state of [0, 'block', 'tmpl', 'fence', 'triple', 'markupComment'] as TokState[]) {
        const { toks } = tokenize(line, lang, state)
        expect(toks.map(t => t.t).join('')).toBe(line)
      }
    }
  })

  test('a ts line: keyword, string, comment, number, function, type, literal', () => {
    expect(kinds("const n = 42 // hi", 'ts')).toEqual(['kw:const', 'num:42', 'com:// hi'])
    expect(kinds('return foo("a\\"b", null)', 'ts')).toEqual(['kw:return', 'fn:foo', 'str:"a\\"b"', 'lit:null'])
    expect(kinds('new Map<string>()', 'ts')).toEqual(['kw:new', 'type:Map'])
    expect(kinds('x = 0xFF + 1.5e3', 'ts')).toEqual(['num:0xFF', 'num:1.5e3'])
    expect(kinds('let v: Foo', 'ts')).toEqual(['kw:let', 'type:Foo'])
  })

  test('a block comment spans lines through the state', () => {
    const a = tokenize('x = 1 /* start', 'ts', 0)
    expect(a.end).toBe('block')
    expect(a.toks[a.toks.length - 1]).toEqual({ t: '/* start', k: 'com' })
    const b = tokenize('still comment', 'ts', 'block')
    expect(b).toEqual({ toks: [{ t: 'still comment', k: 'com' }], end: 'block' })
    const c = tokenize('end */ let y', 'ts', 'block')
    expect(c.end).toBe(0)
    expect(c.toks[0]).toEqual({ t: 'end */', k: 'com' })
    expect(kinds('end */ let y', 'ts', 'block')).toEqual(['com:end */', 'kw:let'])
  })

  test('a template literal spans lines through the state', () => {
    const a = tokenize('const s = `line one', 'ts', 0)
    expect(a.end).toBe('tmpl')
    expect(kinds('const s = `line one', 'ts')).toEqual(['kw:const', 'str:`line one'])
    expect(tokenize('middle', 'ts', 'tmpl')).toEqual({ toks: [{ t: 'middle', k: 'str' }], end: 'tmpl' })
    expect(tokenize('last` + 1', 'ts', 'tmpl').end).toBe(0)
    expect(kinds('last` + 1', 'ts', 'tmpl')).toEqual(['str:last`', 'num:1'])
  })

  test('stateAt walks the lines before the requested one', () => {
    const lines = ['a', '/* open', 'inside', 'close */', 'b', 'const t = `x', 'y']
    expect(stateAt(lines, 'ts', 0)).toBe(0)
    expect(stateAt(lines, 'ts', 2)).toBe('block')
    expect(stateAt(lines, 'ts', 3)).toBe('block')
    expect(stateAt(lines, 'ts', 4)).toBe(0)
    expect(stateAt(lines, 'ts', 6)).toBe('tmpl')
    expect(stateAt(lines, 'plain', 6)).toBe(0)
  })

  test('a markdown fence toggles and colours its lines as code', () => {
    const open = tokenize('```ts', 'md', 0)
    expect(open.end).toBe('fence')
    expect(open.toks).toEqual([{ t: '```ts', k: 'code' }])
    expect(tokenize('# not a heading', 'md', 'fence')).toEqual({ toks: [{ t: '# not a heading', k: 'code' }], end: 'fence' })
    expect(tokenize('```', 'md', 'fence').end).toBe(0)
  })

  test('markdown headings, inline code, links and bold', () => {
    expect(tokenize('## Title', 'md', 0).toks).toEqual([{ t: '## Title', k: 'head' }])
    expect(kinds('a `b` [c](d) **e** f', 'md')).toEqual(['code:`b`', 'link:[c](d)', 'kw:**e**'])
  })

  test('json tells keys from string values', () => {
    expect(kinds('"name": "pane", "n": 3, "ok": true', 'json')).toEqual([
      'attr:"name"', 'str:"pane"', 'attr:"n"', 'num:3', 'attr:"ok"', 'lit:true',
    ])
  })

  test('python triple quotes span lines through the state', () => {
    const open = tokenize('x = """doc', 'py', 0)
    expect(open.end).toBe('triple')
    expect(kinds('x = """doc', 'py')).toEqual(['str:"""doc'])
    expect(tokenize('more text', 'py', 'triple')).toEqual({ toks: [{ t: 'more text', k: 'str' }], end: 'triple' })
    expect(kinds('end""" + 1', 'py', 'triple')).toEqual(['str:end"""', 'num:1'])
    expect(tokenize('end""" + 1', 'py', 'triple').end).toBe(0)
    expect(kinds('"""one line""" # c', 'py')).toEqual(['str:"""one line"""', 'com:# c'])
    expect(kinds('def f(): return None', 'py')).toEqual(['kw:def', 'fn:f', 'kw:return', 'lit:None'])
  })

  test('hash comments, yaml keys and toml sections', () => {
    expect(kinds('echo hi # note', 'sh')).toEqual(['kw:echo', 'com:# note'])
    expect(kinds('  name: build # c', 'yaml')).toEqual(['attr:name', 'com:# c'])
    expect(kinds('[tool.x]', 'toml')).toEqual(['head:[tool.x]'])
    expect(kinds('version = "1"', 'toml')).toEqual(['attr:version', 'str:"1"'])
  })

  test('html comments span lines, tags and attributes', () => {
    expect(kinds('<a href="x">hi</a>', 'html')).toEqual(['tag:<a', 'attr:href', 'str:"x"', 'tag:>', 'tag:</a>'])
    const open = tokenize('<!-- start', 'html', 0)
    expect(open.end).toBe('markupComment')
    expect(tokenize('end --> <b>', 'html', 'markupComment').end).toBe(0)
    expect(kinds('end --> <b>', 'html', 'markupComment')).toEqual(['com:end -->', 'tag:<b>'])
  })

  test('sql keywords ignore case and -- starts a comment', () => {
    expect(kinds('select a from t -- c', 'sql')).toEqual(['kw:select', 'kw:from', 'com:-- c'])
  })

  test('plain is one untyped token', () => {
    expect(tokenize('if (x) "y"', 'plain', 0)).toEqual({ toks: [{ t: 'if (x) "y"' }], end: 0 })
  })

  test('the palette has a hex colour for every kind', () => {
    for (const c of Object.values(PALETTE)) expect(c).toMatch(/^#[0-9A-F]{6}$/)
    expect(PALETTE.kw).toBe('#C678DD')
    expect(PALETTE.link).toBe('#56B6C2')
  })

  test('tokenize never throws on odd input', () => {
    const odd = ['\\', '"\\', '`\\', '/*', '*/', '\u0000\ud800', '😀"😀', '<', '<!--', '[](', '**', '0x', '1e', '.'.repeat(50)]
    for (const lang of ['ts', 'py', 'sh', 'json', 'md', 'css', 'html', 'rs', 'yaml', 'toml', 'sql', 'plain'] as LangId[]) {
      for (const line of odd) {
        const { toks } = tokenize(line, lang, 0)
        expect(toks.map(t => t.t).join('')).toBe(line)
      }
    }
  })
})
