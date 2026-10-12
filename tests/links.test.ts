import { describe, expect, test } from 'claude-code/testing'

import { hrefOf, linkify, parseHref, pathTokens, resolvePath, splitLoc } from '../hooks/links'

describe('links', () => {
  test('pathTokens takes backticked paths and skips the rest', () => {
    const text = 'See `hooks/format.ts:78` and `./a.json`, also `npm`, `foo bar`, `x = 1`, `README.md`.'
    expect(pathTokens(text)).toEqual(['hooks/format.ts:78', './a.json', 'README.md'])
  })

  test('pathTokens needs a slash or a dot followed by word chars', () => {
    expect(pathTokens('`Makefile` `src/Makefile` `a.b` `a.`')).toEqual(['src/Makefile', 'a.b'])
    expect(pathTokens('`Makefile:3`')).toEqual([])
  })

  test('pathTokens skips fences, repeats and respects max', () => {
    const text = ['`a/b.ts`', '```', '`c/d.ts`', '```', '`a/b.ts` `e/f.ts`'].join('\n')
    expect(pathTokens(text)).toEqual(['a/b.ts', 'e/f.ts'])
    expect(pathTokens('`a/1.ts` `a/2.ts` `a/3.ts`', 2)).toEqual(['a/1.ts', 'a/2.ts'])
  })

  test('splitLoc reads line and column', () => {
    expect(splitLoc('a/b.ts:12:4')).toEqual({ file: 'a/b.ts', line: 12, col: 4 })
    expect(splitLoc('a/b.ts:12')).toEqual({ file: 'a/b.ts', line: 12 })
    expect(splitLoc('a/b.ts')).toEqual({ file: 'a/b.ts' })
  })

  test('resolvePath', () => {
    expect(resolvePath('/etc/hosts', '/work')).toBe('/etc/hosts')
    expect(resolvePath('./x.ts', '/work/app')).toBe('/work/app/x.ts')
    expect(resolvePath('src/x.ts', '/work/app/')).toBe('/work/app/src/x.ts')
    expect(resolvePath('../x.ts', '/work/app')).toBe('/work/x.ts')
  })

  test('hrefOf and parseHref round trip with spaces and non-ASCII', () => {
    for (const path of ['/Users/b/My Docs/şeker.ts', '/tmp/a#b?c.ts', '/tmp/f(1).ts', '/tmp/100%.md']) {
      expect(parseHref(hrefOf(path))).toEqual({ path })
      expect(parseHref(hrefOf(path, 60))).toEqual({ path, line: 60 })
    }
    expect(hrefOf('/a/b c.ts', 5)).toBe('file:///a/b%20c.ts#L5')
  })

  test('parseHref only takes file hrefs', () => {
    expect(parseHref('https://example.com/a')).toBeUndefined()
    expect(parseHref('file:///a/b.ts#frag')).toEqual({ path: '/a/b.ts' })
    expect(parseHref('file:///a/%E0%A4%A')).toBeUndefined()
  })

  test('linkify wraps known tokens', () => {
    const hrefs = new Map([['a/b.ts:3', 'file:///w/a/b.ts#L3'], ['c.md', 'file:///w/c.md']])
    expect(linkify('Open `a/b.ts:3` or `c.md` or `zzz.ts`.', hrefs)).toBe(
      'Open [`a/b.ts:3`](file:///w/a/b.ts#L3) or [`c.md`](file:///w/c.md) or `zzz.ts`.',
    )
  })

  test('linkify skips fences and links that exist already', () => {
    const hrefs = new Map([['c.md', 'file:///w/c.md']])
    const fenced = ['```', '`c.md`', '```', '`c.md`'].join('\n')
    expect(linkify(fenced, hrefs)).toBe(['```', '`c.md`', '```', '[`c.md`](file:///w/c.md)'].join('\n'))
    const linked = 'already [`c.md`](https://x.y/c) here'
    expect(linkify(linked, hrefs)).toBe(linked)
  })
})
