import { expect, test } from 'bun:test'
import { matchTmCandidates } from './tm-matching'
import { similarityThreshold, truncatedTmPenalty } from './tm-scoring'

// Values are derived from the local research prototype, not native Trados results.
test('source-only weighted scoring follows the documented penalty tiers', () => {
  for (const [source, memory, score] of [
    ['the dog sat', 'the dig sat', 77],
    ['the rabbit sat', 'the rabkit sat', 90],
    ['the dog sat down', 'the cat sat down', 83],
    ['the dog sat down', 'the dog sat', 79],
    ['the dog sat.', 'the dog sat!', 99],
    ['the dog sat', 'the  dog sat', 99],
    ['Hello', 'hello', 90],
  ] as const) expect(matchTmCandidates(source, [{ unitId: 'synthetic', source: memory, target: 'Synthetic target' }], { minimumScore: 0 })[0]!.displayScore).toBe(score)
})

test('quantization, float32 truncation, target independence and contextual classification', () => {
  expect([1, .9, .8999, .75, .7499, .5, .4999].map(similarityThreshold)).toEqual([1, .9, .75, .75, .5, .5, 0])
  expect(truncatedTmPenalty(Math.fround(.7), 7)).toBe(10)
  const source = 'the rabbit sat'
  const match = (target: string) => matchTmCandidates(source, [{ unitId: 'synthetic', source: 'the rabkit sat', target }], { minimumScore: 0 })[0]!
  expect(match('short').displayScore).toBe(match('long '.repeat(500)).displayScore)
  expect(match('short').differences).toContain('rabkit → rabbit')
  const exact = matchTmCandidates(source, [{ unitId: 'exact', source, target: 'Synthetic', contextKey: 'row' }], { context: { contextKey: 'row' } })[0]!
  expect([exact.matchClass, exact.displayScore]).toEqual(['context', 101])
})

test('a positive sub-point punctuation penalty cannot produce an exact score', () => {
  const source = `${'word '.repeat(20)}.`
  const memory = `${'word '.repeat(20)}!`
  const candidates = [{ unitId: 'synthetic', source: memory, target: 'Synthetic' }]
  const result = matchTmCandidates(source, candidates, { minimumScore: 0 })
  expect(result[0]?.displayScore).toBe(99)
  expect(result[0]?.matchClass).toBe('near-exact')
  expect(matchTmCandidates(source, candidates, { minimumScore: 100 })).toEqual([])
  expect(matchTmCandidates(source, [{ unitId: 'exact', source, target: 'Synthetic' }], { minimumScore: 100 })[0]?.displayScore).toBe(100)
})

test('long segments can align without allocating a quadratic score matrix', () => {
  const middle = 'word '.repeat(1100)
  const match = matchTmCandidates(`start ${middle}end`, [{ unitId: 'synthetic', source: `begin ${middle}finish`, target: 'Synthetic' }], { minimumScore: 0 })[0]!
  expect(match.displayScore).toBe(99)
  expect(match.differences.length).toBeGreaterThan(0)
})

test('same task confirmation is identified without confusing historical metadata with approval', () => {
  const candidate = { unitId: 'local', source: 'Synthetic source', target: 'Synthetic target', localMetadata: {
    la_confirmations: [JSON.stringify({ taskId: 'parent-task', segmentId: 'segment-1', stage: 'translation', actor: 'translator' })],
    la_task_ids: ['parent-task'],
  } }
  const self = matchTmCandidates(candidate.source, [candidate], { context: { taskId: 'parent-task' } })[0]!
  const other = matchTmCandidates(candidate.source, [candidate], { context: { taskId: 'another-task', segmentId: 'segment-1' } })[0]!
  expect(self.sameTask).toBe(true)
  expect(self.structure.reasons.join(' ')).toContain('本任务')
  expect(other.sameTask).toBe(false)
  expect(other.sameSegment).toBe(true)
  expect(other.structure.reasons.join(' ')).toContain('同一句段')
})

test('multiple translations keep the base score and apply the default one-point penalty before filtering', () => {
  const candidates = [
    { unitId: 'a', source: 'Synthetic source', target: 'Target A' },
    { unitId: 'b', source: 'Synthetic source', target: 'Target B' },
  ]
  const matches = matchTmCandidates('Synthetic source', candidates, { minimumScore: 0 })
  expect(matches.map(match => [match.baseScore, match.displayScore, match.variantCount])).toEqual([[100, 99, 2], [100, 99, 2]])
  expect(matchTmCandidates('Synthetic source', candidates, { minimumScore: 100 })).toEqual([])
})

test('score threshold never drops a qualifying result across mixed token combinations', () => {
  const pieces = ['apple', 'rabbit', '42', ' ', ',', '<b>', '</b>', '{hero}']
  for (let i = 0; i < 160; i++) {
    const source = Array.from({ length: 5 }, (_, j) => pieces[(i * 7 + j * 3) % pieces.length]).join('')
    const memory = Array.from({ length: 5 + i % 3 }, (_, j) => pieces[(i * 5 + j * 7 + 1) % pieces.length]).join('')
    const candidates = [{ unitId: 'synthetic', source: memory, target: 'Synthetic' }]
    const all = matchTmCandidates(source, candidates, { minimumScore: 0 })
    for (const minimumScore of [50, 75, 85, 95]) {
      expect(matchTmCandidates(source, candidates, { minimumScore })).toEqual(all.filter(match => match.displayScore >= minimumScore))
    }
  }
})
