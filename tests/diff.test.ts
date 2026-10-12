import { describe, expect, test } from 'claude-code/testing'

import { unified } from '../hooks/diff'

const names = { a: 'disk', b: 'editor' }

describe('diff', () => {
  test('equal input gives the empty string', () => {
    expect(unified(['a', 'b'], ['a', 'b'], names)).toBe('')
    expect(unified([], [], names)).toBe('')
  })

  test('one changed line', () => {
    expect(unified(['a', 'b', 'c'], ['a', 'X', 'c'], names)).toBe(
      ['--- disk', '+++ editor', '@@ -1,3 +1,3 @@', ' a', '-b', '+X', ' c'].join('\n'),
    )
  })

  test('an insert at the start', () => {
    expect(unified(['a', 'b'], ['new', 'a', 'b'], names)).toBe(
      ['--- disk', '+++ editor', '@@ -1,2 +1,3 @@', '+new', ' a', ' b'].join('\n'),
    )
  })

  test('a delete at the end', () => {
    expect(unified(['a', 'b', 'c'], ['a', 'b'], names)).toBe(
      ['--- disk', '+++ editor', '@@ -1,3 +1,2 @@', ' a', ' b', '-c'].join('\n'),
    )
  })

  test('hunk header numbers with context and two hunks', () => {
    const a = Array.from({ length: 20 }, (_, i) => `l${i + 1}`)
    const b = [...a]
    b[2] = 'CHANGED3'
    b[16] = 'CHANGED17'
    const out = unified(a, b, names).split('\n')
    const heads = out.filter(l => l.startsWith('@@'))
    expect(heads).toEqual(['@@ -1,6 +1,6 @@', '@@ -14,7 +14,7 @@'])
    expect(out).toContain('-l3')
    expect(out).toContain('+CHANGED17')
  })

  test('close changes share one hunk', () => {
    const a = Array.from({ length: 12 }, (_, i) => `l${i + 1}`)
    const b = [...a]
    b[2] = 'X'
    b[8] = 'Y'
    const heads = unified(a, b, names).split('\n').filter(l => l.startsWith('@@'))
    expect(heads).toEqual(['@@ -1,12 +1,12 @@'])
  })

  test('a custom context width', () => {
    const a = ['1', '2', '3', '4', '5']
    const b = ['1', '2', 'X', '4', '5']
    expect(unified(a, b, names, 1).split('\n').filter(l => l.startsWith('@@'))).toEqual(['@@ -2,3 +2,3 @@'])
  })

  test('pure adds and deletes in an empty side', () => {
    expect(unified([], ['a'], names).split('\n')[2]).toBe('@@ -0,0 +1,1 @@')
    expect(unified(['a'], [], names).split('\n')[2]).toBe('@@ -1,1 +0,0 @@')
  })

  test('a diff whose edits would pass the cap becomes one hunk of - and + lines', () => {
    const a = Array.from({ length: 3000 }, (_, i) => `a${i}`)
    const b = Array.from({ length: 3000 }, (_, i) => `b${i}`)
    const out = unified(a, b, names).split('\n')
    expect(out[2]).toBe('@@ -1,3000 +1,3000 @@')
    expect(out).toHaveLength(2 + 1 + 6000)
    expect(out[3]).toBe('-a0')
    expect(out[3003]).toBe('+b0')
  })

  test('the diff reproduces b when applied to a', () => {
    const a = 'the quick brown fox jumps over the lazy dog and runs away'.split(' ')
    const b = 'a quick red fox jumps over lazy dogs and then runs far away'.split(' ')
    const lines = unified(a, b, names, 100).split('\n').slice(3)
    expect(lines.filter(l => l[0] !== '+').map(l => l.slice(1))).toEqual(a)
    expect(lines.filter(l => l[0] !== '-').map(l => l.slice(1))).toEqual(b)
  })
})
