type Op = { op: ' ' | '-' | '+'; text: string }

const MAX_D = 4000

const at = (arr: Int32Array, i: number): number => arr[i] ?? 0

/** Myers' O(ND) shortest edit script; undefined when it needs more than MAX_D edits. */
function myers(a: string[], b: string[]): Op[] | undefined {
  const n = a.length
  const m = b.length
  const max = Math.min(n + m, MAX_D)
  const off = max + 1
  const v = new Int32Array(2 * max + 3)
  const trace: Int32Array[] = []
  let found = -1
  for (let d = 0; d <= max && found < 0; d++) {
    trace.push(v.slice(off - d - 1, off + d + 2))
    for (let k = -d; k <= d; k += 2) {
      let x = k === -d || (k !== d && at(v, off + k - 1) < at(v, off + k + 1))
        ? at(v, off + k + 1)
        : at(v, off + k - 1) + 1
      let y = x - k
      while (x < n && y < m && a[x] === b[y]) { x++; y++ }
      v[off + k] = x
      if (x >= n && y >= m) { found = d; break }
    }
  }
  if (found < 0) return undefined

  const ops: Op[] = []
  let x = n
  let y = m
  for (let d = found; d >= 0; d--) {
    const prev = trace[d] as Int32Array
    const k = x - y
    const down = k === -d || (k !== d && at(prev, k - 1 + d + 1) < at(prev, k + 1 + d + 1))
    const prevK = down ? k + 1 : k - 1
    const prevX = d === 0 ? 0 : at(prev, prevK + d + 1)
    const prevY = d === 0 ? 0 : prevX - prevK
    while (x > prevX && y > prevY) { x--; y--; ops.push({ op: ' ', text: a[x] ?? '' }) }
    if (d > 0) {
      if (x === prevX) ops.push({ op: '+', text: b[prevY] ?? '' })
      else ops.push({ op: '-', text: a[prevX] ?? '' })
    }
    x = prevX
    y = prevY
  }
  return ops.reverse()
}

function script(a: string[], b: string[]): Op[] {
  let p = 0
  while (p < a.length && p < b.length && a[p] === b[p]) p++
  let s = 0
  while (s < a.length - p && s < b.length - p && a[a.length - 1 - s] === b[b.length - 1 - s]) s++
  const am = a.slice(p, a.length - s)
  const bm = b.slice(p, b.length - s)
  const mid = myers(am, bm) ?? [
    ...am.map((text): Op => ({ op: '-', text })),
    ...bm.map((text): Op => ({ op: '+', text })),
  ]
  return [
    ...a.slice(0, p).map((text): Op => ({ op: ' ', text })),
    ...mid,
    ...a.slice(a.length - s).map((text): Op => ({ op: ' ', text })),
  ]
}

function range(start: number, count: number): string {
  return `${count === 0 ? start : start + 1},${count}`
}

/** A `diff -u` text from `a` to `b`; empty when they are equal. */
export function unified(a: string[], b: string[], names: { a: string; b: string }, context = 3): string {
  const ops = script(a, b)
  const changes: number[] = []
  ops.forEach((o, i) => { if (o.op !== ' ') changes.push(i) })
  if (changes.length === 0) return ''

  const aBefore: number[] = []
  const bBefore: number[] = []
  let ai = 0
  let bi = 0
  for (const o of ops) {
    aBefore.push(ai)
    bBefore.push(bi)
    if (o.op !== '+') ai++
    if (o.op !== '-') bi++
  }

  const out = [`--- ${names.a}`, `+++ ${names.b}`]
  let g = 0
  while (g < changes.length) {
    let h = g
    while (h + 1 < changes.length && (changes[h + 1] as number) - (changes[h] as number) <= 2 * context + 1) h++
    const start = Math.max(0, (changes[g] as number) - context)
    const end = Math.min(ops.length, (changes[h] as number) + context + 1)
    const body = ops.slice(start, end)
    const aCount = body.filter(o => o.op !== '+').length
    const bCount = body.filter(o => o.op !== '-').length
    out.push(`@@ -${range(aBefore[start] ?? 0, aCount)} +${range(bBefore[start] ?? 0, bCount)} @@`)
    for (const o of body) out.push(o.op + o.text)
    g = h + 1
  }
  return out.join('\n')
}
