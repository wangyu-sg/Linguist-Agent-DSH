import { describe, expect, spyOn, test } from 'bun:test'
import {
  matchTmCandidates,
  selectTmAgentEvidence,
  tmSourceHash,
} from './tm-matching'

interface CorpusCase {
  name: string
  query: string
  source: string
  expected: 'fuzzy' | 'near-exact'
}

const candidate = (id: string, source: string, target = source) => ({
  unitId: id,
  source,
  target,
})

const lexicalCases: CorpusCase[] = [
  { name: 'Save is not Save game', query: 'Save', source: 'Save game', expected: 'fuzzy' },
  { name: 'Play is not Replay', query: 'Play', source: 'Replay', expected: 'fuzzy' },
  { name: 'OK is not OK continue', query: 'OK', source: 'OK, continue', expected: 'fuzzy' },
  { name: 'Home is not Home screen', query: 'Home', source: 'Home screen', expected: 'fuzzy' },
  { name: 'Back is not Back to menu', query: 'Back', source: 'Back to menu', expected: 'fuzzy' },
  { name: 'Open is not Reopen', query: 'Open', source: 'Reopen', expected: 'fuzzy' },
  { name: 'Run is not Runner', query: 'Run', source: 'Runner', expected: 'fuzzy' },
  { name: 'Close is not Close window', query: 'Close', source: 'Close window', expected: 'fuzzy' },
  { name: 'word order lowers score one', query: 'Player attacks the enemy', source: 'The enemy attacks player', expected: 'fuzzy' },
  { name: 'word order lowers score two', query: 'The wizard opens the gate', source: 'The gate opens the wizard', expected: 'fuzzy' },
  { name: 'word order lowers score three', query: 'Return to the main menu', source: 'Return the menu to main', expected: 'fuzzy' },
  { name: 'word order lowers score four', query: 'The guard blocks the door', source: 'The door blocks the guard', expected: 'fuzzy' },
  { name: 'word order lowers score five', query: 'The player finds a key', source: 'A key finds the player', expected: 'fuzzy' },
  { name: 'Chinese fuzzy one', query: '领取每日奖励吧', source: '领取任务奖励吧', expected: 'fuzzy' },
  { name: 'Chinese fuzzy two', query: '进入战斗准备界面', source: '进入战斗准备页面', expected: 'fuzzy' },
  { name: 'Chinese fuzzy three', query: '系统设置已保存', source: '系统设置已储存', expected: 'fuzzy' },
  { name: 'Chinese fuzzy four', query: '技能冷却中请稍候', source: '技能冷却中请稍等', expected: 'fuzzy' },
  { name: 'Chinese fuzzy five', query: '获得新的装备奖励', source: '获得新的装备报酬', expected: 'fuzzy' },
  { name: 'numeric variation one', query: 'Collect 100 coins', source: 'Collect 200 coins', expected: 'near-exact' },
  { name: 'numeric variation two', query: 'Deal 10 damage', source: 'Deal 100 damage', expected: 'near-exact' },
  { name: 'numeric variation three', query: 'Version 1.2.3 ready', source: 'Version 1.2.4 ready', expected: 'near-exact' },
  { name: 'numeric variation four', query: 'Earn 10% bonus', source: 'Earn 15% bonus', expected: 'near-exact' },
  { name: 'time variation', query: 'Wait 05:00 minutes', source: 'Wait 10:00 minutes', expected: 'near-exact' },
  { name: 'URL variation', query: 'Visit https://example.com/a', source: 'Visit https://example.com/b', expected: 'near-exact' },
  { name: 'placeholder name', query: 'You gained {x} XP', source: 'You gained {y} XP', expected: 'near-exact' },
  { name: 'inline tag name', query: 'Press <b>Start</b> now', source: 'Press <i>Start</i> now', expected: 'near-exact' },
  { name: 'inline tag id', query: 'Open <ph id="1"/> now', source: 'Open <ph id="2"/> now', expected: 'near-exact' },
  { name: 'printf placeholder', query: 'Use %s to continue', source: 'Use %d to continue', expected: 'near-exact' },
  { name: 'named placeholders', query: 'Build {name} at {time}', source: 'Build {name} at {date}', expected: 'near-exact' },
  { name: 'reordered placeholders', query: '{name} gained {x} XP', source: '{x} gained {name} XP', expected: 'near-exact' },
  { name: 'punctuation variation', query: 'Hello world', source: 'Hello, world', expected: 'near-exact' },
  { name: 'whitespace variation', query: 'Hello  world', source: 'Hello world', expected: 'near-exact' },
  { name: 'case variation', query: 'HELLO world', source: 'Hello world', expected: 'near-exact' },
  { name: 'long lexical variation one', query: 'The player attacks the enemy now', source: 'The player attacks the foe now', expected: 'fuzzy' },
  { name: 'long lexical variation two', query: 'Please review this translation before delivery', source: 'Please check this translation before delivery', expected: 'fuzzy' },
  { name: 'long lexical variation three', query: 'The reward appears after the battle ends', source: 'The reward appears when the battle ends', expected: 'fuzzy' },
  { name: 'long lexical variation four', query: 'Select a language from the settings menu', source: 'Choose a language in the settings menu', expected: 'fuzzy' },
  { name: 'long lexical variation five', query: 'A new mission begins today', source: 'A new challenge begins today', expected: 'fuzzy' },
]

describe('TM high-risk synthetic corpus', () => {
  test('repeated queries reuse candidate segmentation without merging independent TU evidence', () => {
    const source = 'synthetic writer checks every token carefully'
    const units = [candidate('synthetic-first', source, 'Synthetic target A'), candidate('synthetic-second', 'synthetic writer checks every token again', 'Synthetic target B')]
    const counts = new Map<string, number>()
    const segment = Intl.Segmenter.prototype.segment
    Intl.Segmenter.prototype.segment = function (value: string) {
      counts.set(value, (counts.get(value) ?? 0) + 1)
      return segment.call(this, value)
    }
    try {
      const query = 'synthetic reader checks every label carefully'
      const first = matchTmCandidates(query, units, { minimumScore: 0 })
      expect(counts.get(source)).toBe(1)
      expect(matchTmCandidates(query, units, { minimumScore: 0 })).toEqual(first)
      matchTmCandidates('synthetic reader checks every label again', units, { minimumScore: 0 })
      expect(counts.get(source)).toBe(1)
    } finally { Intl.Segmenter.prototype.segment = segment }
  })

  test('cached Source features never freeze target, provenance, priority or query context', () => {
    const query = 'Synthetic complete source'
    const unit = { ...candidate('mutable-synthetic', 'Synthetic earlier source', 'Synthetic earlier target'),
      sourcePriority: 0, sourceLabel: 'Synthetic initial library', metadata: { note: 'Synthetic initial metadata' },
      contextKey: 'earlier-key', previousSourceHash: tmSourceHash('Earlier neighbor'),
    }
    matchTmCandidates(query, [unit])
    const units = [unit]
    matchTmCandidates(query, units)
    Object.assign(unit, { source: query, target: 'Synthetic current target', sourcePriority: 7, sourceLabel: 'Synthetic current library',
      metadata: { note: 'Synthetic current metadata' }, contextKey: 'current-key', previousSourceHash: tmSourceHash('Current neighbor'),
    })
    const options = { context: { contextKey: 'current-key', previousSource: 'Current neighbor' } }
    const current = matchTmCandidates(query, units, options)
    expect(current).toEqual(matchTmCandidates(query, [{ ...unit }], options))
    expect(current[0]?.displayScore).toBe(102)
    expect(current[0]?.target).toBe('Synthetic current target')
    expect(current[0]?.metadata).toEqual({ note: 'Synthetic current metadata' })
    expect(matchTmCandidates(query, units)[0]?.displayScore).toBe(100)
    unit.source = query.toUpperCase()
    expect(matchTmCandidates(query, units, options)).toEqual(matchTmCandidates(query, [{ ...unit }], options))
    expect(matchTmCandidates(query, units, options)[0]?.displayScore).toBe(91)
  })

  test('a safe upper bound skips impossible scores without excluding a qualifying result', () => {
    const units = [candidate('synthetic-unrelated', 'omega '.repeat(30), 'Synthetic target')]
    const query = 'alpha'
    const allocations = spyOn(Array, 'from')
    const rows = () => allocations.mock.calls.filter(([value]) => value !== null && typeof value === 'object'
      && 'length' in value && !(Symbol.iterator in value)).length
    try {
      expect(matchTmCandidates(query, units, { minimumScore: 85 })).toHaveLength(0)
      expect(rows()).toBe(0)
      expect(matchTmCandidates(query, units, { minimumScore: 0 })).toHaveLength(1)
      expect(rows()).toBeGreaterThan(0)
    } finally { allocations.mockRestore() }
    for (const item of lexicalCases) {
      const unit = [candidate(item.name, item.source)]
      const full = matchTmCandidates(item.query, unit, { minimumScore: 0 })
      for (const minimumScore of [50, 75, 85, 95]) {
        expect(matchTmCandidates(item.query, unit, { minimumScore })).toEqual(full.filter(match => match.displayScore >= minimumScore))
      }
    }
  })

  test('near-exact matches keep their computed score and structural diagnostics', () => {
    for (const [query, source] of [
      ['Synthetic {a}', `Synthetic {${'synthetic'.repeat(30)}}`],
      ['Synthetic 1', `Synthetic ${'9'.repeat(100)}`],
      ['', '.'.repeat(100)],
      ['＜b＞Synthetic＜/b＞', '<i>Synthetic</i>'],
    ]) {
      const matches = matchTmCandidates(query!, [candidate('synthetic-near', source!)], { minimumScore: 0 })
      expect(matches).toHaveLength(1)
      expect(matches[0]?.matchClass).toBe('near-exact')
      expect(matches[0]?.structure.safety).toBe('review')
      const score = matches[0]!.displayScore
      expect(matchTmCandidates(query!, [candidate('synthetic-near', source!)], { minimumScore: score })).toHaveLength(1)
      expect(matchTmCandidates(query!, [candidate('synthetic-near', source!)], { minimumScore: score + .001 })).toHaveLength(0)
    }
  })

  test('threshold uses the penalized score and accounts for all variants', () => {
    const fuzzy = [candidate('synthetic-fuzzy', 'a b x', 'Synthetic target')]
    expect(matchTmCandidates('a b c', fuzzy, { minimumScore: 77 })[0]?.displayScore).toBe(77)
    expect(matchTmCandidates('a b c', fuzzy, { minimumScore: 77.001 })).toHaveLength(0)
    const source = 'Synthetic source'
    const units = [
      { ...candidate('z', source, 'Synthetic target A'), originalTuid: 'synthetic-first', sourcePriority: 1 },
      { ...candidate('a', source, 'Synthetic target A'), originalTuid: 'synthetic-second', sourcePriority: 1 },
      { ...candidate('b', source, 'Synthetic target A'), originalTuid: 'synthetic-third', sourcePriority: 7 },
      candidate('variant', source.toUpperCase(), 'Synthetic target B'),
    ]
    const all = matchTmCandidates(source, units, { minimumScore: 0 })
    expect(all.map(item => item.unitId)).toEqual(['b', 'a', 'z', 'variant'])
    expect(all.map(item => [item.provenanceCount, item.variantCount])).toEqual([[3, 2], [3, 2], [3, 2], [1, 2]])
    const exact = matchTmCandidates(source, units, { minimumScore: 100 })
    expect(exact).toEqual([])
    expect(matchTmCandidates(source, units, { minimumScore: 99 }).map(item => item.originalTuid)).toEqual(['synthetic-third', 'synthetic-second', 'synthetic-first'])
  })

  test('covers every high-risk lexical and structural case without a contains floor', () => {
    for (const item of lexicalCases) {
      const matches = matchTmCandidates(item.query, [candidate(item.name, item.source)], { minimumScore: 0 })
      expect(matches[0]?.matchClass, item.name).toBe(item.expected)
      expect(matches[0]?.displayScore, item.name).toBeGreaterThanOrEqual(0)
      expect(matches[0]?.structure.safety, item.name).toBe('review')
    }
  })

  test('keeps exact/context classes and ambiguity explicit', () => {
    const matches = matchTmCandidates('Charge', [
      {
        ...candidate('double', 'Charge', '充能'),
        contextKey: 'skill.charge',
        previousSourceHash: tmSourceHash('Before'),
        nextSourceHash: tmSourceHash('After'),
      },
      {
        ...candidate('single', 'Charge', '冲锋'),
        contextKey: 'skill.charge',
      },
      candidate('plain', 'Charge', '收费'),
    ], { context: { contextKey: 'skill.charge', previousSource: 'Before', nextSource: 'After' } })
    expect(matches.map((match) => match.matchClass)).toEqual(['double-context', 'context', 'exact'])
    expect(matches.map(match => match.displayScore)).toEqual([101, 100, 99])
    expect(matches.every((match) => match.variantCount === 3)).toBe(true)
    const evidence = selectTmAgentEvidence(matches)
    expect(evidence).toHaveLength(3)
    expect(evidence.every((item) => item.ambiguous)).toBe(true)
  })

  test('retains changed placeable counts for review without lowering Agent score thresholds', () => {
    const matches = matchTmCandidates('You gained {x} XP', [
      candidate('missing', 'You gained XP'),
      candidate('changed', 'You gained {y} XP'),
    ])
    expect(matches).toHaveLength(2)
    expect(matches.every(match => match.structure.safety === 'review')).toBe(true)
    expect(matches.find(match => match.unitId === 'missing')?.structure.reasons).toContain('Placeable 数量不一致')
    expect(selectTmAgentEvidence(matches)).toHaveLength(1)
  })

  test('short fuzzy references remain inspectable without inventing scores or exact reuse', () => {
    for (const [query, source] of [['领取奖励', '领取奖品'], ['免費送', '免费送']]) {
      const [match] = matchTmCandidates(query!, [candidate('short', source!)], { minimumScore: 0 })
      expect(match?.matchClass).toBe('fuzzy')
      expect(match?.structure.safety).toBe('review')
      expect(match?.structure.reasons.join(' ')).toContain('短句')
      expect(match?.displayScore).toBeLessThan(75)
      expect(matchTmCandidates(query!, [candidate('short', source!)], { minimumScore: 75 })).toHaveLength(0)
    }
  })

  test('exact evidence does not hide a useful fuzzy alternative or its original provenance', () => {
    const source = 'Please carefully review every translated sentence and preserve all original placeholders before delivery.'
    const fuzzy = source.replace('carefully', 'thoroughly')
    const metadata = { creation_date: '2024-05-01', creation_user: 'original-author' }
    const matches = matchTmCandidates(source, [candidate('exact', source, 'Exact target'), {
      ...candidate('fuzzy', fuzzy, 'Alternative target'), originalTuid: '42', metadata,
      contextKey: 'native-key', sourceInline: '<seg>Original structure</seg>',
    }])
    expect(matches[1]?.displayScore).toBeGreaterThanOrEqual(85)
    const evidence = selectTmAgentEvidence(matches)
    expect(evidence).toHaveLength(2)
    expect(evidence[1]?.originalTuid).toBe('42')
    expect(evidence[1]?.metadata).toEqual(metadata)
    expect(evidence[1]?.contextKey).toBe('native-key')
    expect(evidence[1]?.sourceInline).toBe('<seg>Original structure</seg>')
    expect(evidence[1]?.safety).toBe('review')
  })

  test('exact hashes include the language pair', () => {
    expect(tmSourceHash('Save', 'en', 'zh-CN')).not.toBe(tmSourceHash('Save', 'en', 'fr-FR'))
    expect(tmSourceHash(' Save ', 'en', 'zh-CN')).toBe(tmSourceHash('Save', 'en', 'zh-CN'))
  })

  test('identical targets keep distinct TU provenance within the same evidence cap', () => {
    const matches = matchTmCandidates('Claim rewards', [
      { ...candidate('first', 'Claim rewards', '领取奖励'), originalTuid: 'historical-tu', metadata: { creation_date: '2024-05-01' } },
      { ...candidate('second', 'Claim rewards', '领取奖励'), originalTuid: 'current-tu', metadata: { creation_date: '2026-11-07' } },
    ])
    const evidence = selectTmAgentEvidence(matches)
    expect(evidence.map(item => item.originalTuid)).toEqual(['historical-tu', 'current-tu'])
    expect(selectTmAgentEvidence(matches, 1)).toHaveLength(1)
  })
})
