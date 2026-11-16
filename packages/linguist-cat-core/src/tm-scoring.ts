import { scanTagTokens } from './tag-families'

type Token = { text: string; folded: string; kind: 'word' | 'number' | 'space' | 'punct' | 'tag' }
export interface TmScoringSource { tokens: Token[]; weight: number; counts: [number, number, number, number] }
const segmenter = new Intl.Segmenter(undefined, { granularity: 'word' })

export function prepareTmScoringSource(text: string): TmScoringSource {
  const tokens: Token[] = []
  const append = (part: string) => {
    for (const item of segmenter.segment(part)) {
      const value = item.segment
      tokens.push({ text: value, folded: base(value), kind: /^\s+$/u.test(value) ? 'space'
        : /^[\p{P}\p{S}]+$/u.test(value) ? 'punct'
          : /\d/u.test(value) ? 'number' : 'word' })
    }
  }
  let offset = 0
  for (const tag of scanTagTokens(text)) {
    append(text.slice(offset, tag.start))
    tokens.push({ text: text.slice(tag.start, tag.end), folded: '', kind: 'tag' })
    offset = tag.end
  }
  append(text.slice(offset))
  let weight = 0
  const counts: TmScoringSource['counts'] = [0, 0, 0, 0]
  for (const token of tokens) {
    weight = Math.fround(weight + (token.kind === 'tag' ? 0 : token.kind === 'space' || token.kind === 'punct' ? Math.fround(.1) : 1))
    counts[token.kind === 'space' ? 1 : token.kind === 'punct' ? 2 : token.kind === 'tag' ? 3 : 0]++
  }
  return { tokens, weight, counts }
}

/** A conservative bound from unavoidable insertions/deletions of incompatible token classes. */
export function tmScoreUpperBound(a: TmScoringSource, b: TmScoringSource): number {
  const lower = (Math.abs(a.counts[0] - b.counts[0]) + Math.abs(a.counts[3] - b.counts[3])) * .7
    + (Math.abs(a.counts[1] - b.counts[1]) + Math.abs(a.counts[2] - b.counts[2])) * .1
  return Math.max(0, 100 - Math.trunc(lower * .9999 * 100 / (Math.fround(a.weight + b.weight) || 1)))
}

export function similarityThreshold(similarity: number): number {
  return similarity === 1 ? 1 : similarity >= .9 ? .9 : similarity >= .75 ? .75 : similarity >= .5 ? .5 : 0
}

export function truncatedTmPenalty(penalty: number, weight: number): number {
  return Math.trunc(Math.fround(Math.fround(penalty * 100) / weight))
}

function base(value: string): string { return value.toLocaleLowerCase().normalize('NFD').replace(/\p{M}/gu, '') }

function similarity(a: Token, b: Token): number {
  if ((a.kind === 'tag') !== (b.kind === 'tag') || (a.kind === 'space') !== (b.kind === 'space') || (a.kind === 'punct') !== (b.kind === 'punct')) return -1
  if (a.text === b.text) return 1
  if (a.kind === 'tag') return -1
  if (a.kind === 'space' || a.kind === 'punct') return .94
  const adjustment = (a.kind === 'word') !== (b.kind === 'word') ? .1 : 0
  if (a.folded === b.folded) return .95 - adjustment
  if (a.text.length === 1 && b.text.length === 1) return 0
  if (a.text.length + b.text.length >= 100) return 0
  const left = Array.from(a.text), right = Array.from(b.text)
  const leftBases = left.map(base), rightBases = right.map(base)
  const row = Array.from({ length: right.length + 1 }, (_, i) => i)
  for (let i = 1; i <= left.length; i++) {
    let diagonal = row[0]!
    row[0] = i
    for (let j = 1; j <= right.length; j++) {
      const above = row[j]!
      const cost = left[i - 1] === right[j - 1] ? 0 : leftBases[i - 1] === rightBases[j - 1] ? .05 : 1
      row[j] = Math.min(diagonal + cost, above + 1, row[j - 1]! + 1)
      diagonal = above
    }
  }
  const charSimilarity = Math.max(0, 1 - 2 * row[right.length]! / (left.length + right.length))
  return Math.max(0, (a.kind === 'word' && b.kind === 'word' ? 1 : .95) * similarityThreshold(charSimilarity) - adjustment)
}

type SimilarityCache = Map<Token, Map<string, number>>

function cachedSimilarity(cache: SimilarityCache, left: Token, right: Token): number {
  let values = cache.get(left)
  if (!values) {
    if (cache.size >= 256) return similarity(left, right)
    values = new Map(); cache.set(left, values)
  }
  const key = `${right.kind}\u0000${right.text}`
  const cached = values.get(key)
  if (cached !== undefined) return cached
  const value = similarity(left, right)
  // ponytail: bound the shared cache while allowing typical short segments enough vocabulary.
  if (values.size < Math.max(512, Math.min(8192, Math.floor(524288 / cache.size)))) values.set(key, value)
  return value
}

/** Lower-bound each source token independently; ignoring competition and inserts can only overestimate the score. */
export function tmCanReachScore(query: TmScoringSource, memory: TmScoringSource, minimum: number, cache: SimilarityCache): boolean {
  let penalty = 0
  const weight = Math.fround(query.weight + memory.weight) || 1
  for (const token of query.tokens) {
    if (memory.tokens.some(candidate => candidate.text === token.text && (candidate.kind === token.kind ||
      ((candidate.kind === 'word' || candidate.kind === 'number') && (token.kind === 'word' || token.kind === 'number'))))) continue
    penalty += token.kind === 'space' || token.kind === 'punct' ? .1 : token.kind === 'tag' ? token.text.length <= 2 ? .7 : 1.5 : .2
    if (100 - Math.trunc(penalty * .999 * 100 / weight) < minimum) return false
  }
  penalty = 0
  for (const token of query.tokens) {
    let least = token.kind === 'space' || token.kind === 'punct' ? .1 : token.text.length <= 2 ? .7 : 1.5
    for (const candidate of memory.tokens) {
      const sim = cachedSimilarity(cache, token, candidate)
      if (sim < 0) continue
      if (sim === 1) { least = 0; break }
      const cost = 1 - sim
      const change = token.kind === 'tag' ? 0 : token.kind === 'space' || token.kind === 'punct' ? .1 : cost < .06 ? .2 : cost < .3 ? .7 : 1.5
      least = Math.min(least, change)
    }
    penalty += least
    if (100 - Math.trunc(penalty * .999 * 100 / weight) < minimum) return false
  }
  return true
}

/** Scoring follows the observed source-side formula; tokenization and alignment are LA approximations. */
export function scoreTmSource(query: TmScoringSource, memory: TmScoringSource, cache: SimilarityCache = new Map()): { score: number; differences: string[] } {
  const a = query.tokens, b = memory.tokens
  const edits: Array<{ old?: Token; current?: Token; similarity?: number }> = []
  const rowCosts = (a0: number, a1: number, b0: number, b1: number, reverse: boolean) => {
    const width = b1 - b0
    let previous = Float64Array.from({ length: width + 1 }, (_, j) => j)
    let current = new Float64Array(width + 1)
    for (let i = 1; i <= a1 - a0; i++) {
      current[0] = i
      const left = a[reverse ? a1 - i : a0 + i - 1]!
      for (let j = 1; j <= width; j++) {
        const right = b[reverse ? b1 - j : b0 + j - 1]!
        const sim = cachedSimilarity(cache, left, right)
        current[j] = Math.min(sim < 0 ? Infinity : previous[j - 1]! + 1 - sim, previous[j]! + 1, current[j - 1]! + 1)
      }
      ;[previous, current] = [current, previous]
    }
    return previous
  }
  // ponytail: edit alignment is quadratic in time; add indexing if measured long-segment throughput requires it.
  const align = (a0: number, a1: number, b0: number, b1: number): void => {
    while (a0 < a1 && b0 < b1 && a[a0]!.kind === b[b0]!.kind && a[a0]!.text === b[b0]!.text) {
      edits.push({ current: a[a0++]!, old: b[b0++]!, similarity: 1 })
    }
    let suffix = 0
    while (a0 < a1 && b0 < b1 && a[a1 - 1]!.kind === b[b1 - 1]!.kind && a[a1 - 1]!.text === b[b1 - 1]!.text) { a1--; b1--; suffix++ }
    const height = a1 - a0, width = b1 - b0
    if (!height) for (let j = b0; j < b1; j++) edits.push({ old: b[j]! })
    else if (!width) for (let i = a0; i < a1; i++) edits.push({ current: a[i]! })
    else if (height * width <= 1_000_000 || height === 1 || width === 1) {
      const ops = new Uint8Array((height + 1) * (width + 1))
      let previous = Float64Array.from({ length: width + 1 }, (_, j) => j)
      let current = new Float64Array(width + 1)
      for (let j = 1; j <= width; j++) ops[j] = 2
      for (let i = 1; i <= height; i++) {
        current[0] = i; ops[i * (width + 1)] = 1
        for (let j = 1; j <= width; j++) {
          const sim = cachedSimilarity(cache, a[a0 + i - 1]!, b[b0 + j - 1]!)
          let best = sim < 0 ? Infinity : previous[j - 1]! + 1 - sim, op = 0
          if (previous[j]! + 1 < best) { best = previous[j]! + 1; op = 1 }
          if (current[j - 1]! + 1 < best) { best = current[j - 1]! + 1; op = 2 }
          current[j] = best; ops[i * (width + 1) + j] = op
        }
        ;[previous, current] = [current, previous]
      }
      const local: typeof edits = []
      for (let i = height, j = width; i || j;) {
        const op = ops[i * (width + 1) + j]!
        if (op === 0) { const left = a[a0 + --i]!, right = b[b0 + --j]!; local.push({ current: left, old: right, similarity: cachedSimilarity(cache, left, right) }) }
        else if (op === 1) local.push({ current: a[a0 + --i]! })
        else local.push({ old: b[b0 + --j]! })
      }
      for (const edit of local.reverse()) edits.push(edit)
    } else {
      const mid = a0 + Math.floor(height / 2)
      const forward = rowCosts(a0, mid, b0, b1, false), backward = rowCosts(mid, a1, b0, b1, true)
      let split = 0, best = Infinity
      for (let j = 0; j <= width; j++) if (forward[j]! + backward[width - j]! < best) { split = j; best = forward[j]! + backward[width - j]! }
      align(a0, mid, b0, b0 + split); align(mid, a1, b0 + split, b1)
    }
    for (let i = 0; i < suffix; i++) edits.push({ current: a[a1 + i]!, old: b[b1 + i]!, similarity: 1 })
  }
  align(0, a.length, 0, b.length)
  let penalty = 0
  const differences: string[] = []
  for (const edit of edits) {
    const token = edit.current ?? edit.old!
    if (edit.current && edit.old) {
      if (edit.similarity === 1) continue
      if (edit.current.kind === 'tag' && edit.old.kind === 'tag') continue
      const cost = 1 - edit.similarity!
      penalty = Math.fround(penalty + (token.kind === 'space' || token.kind === 'punct' ? .1 : cost < .06 ? .2 : cost < .3 ? .7 : 1.5))
      differences.push(`${edit.old.text} → ${edit.current.text}`)
    } else {
      penalty = Math.fround(penalty + (token.kind === 'space' || token.kind === 'punct' ? .1 : token.text.length <= 2 ? .7 : 1.5))
      differences.push(edit.current ? `+ ${token.text}` : `− ${token.text}`)
    }
  }
  const weight = Math.fround(query.weight + memory.weight) || 1
  const malus = penalty > 0 ? Math.max(1, truncatedTmPenalty(penalty, weight)) : 0
  return { score: Math.max(0, 100 - malus), differences }
}
