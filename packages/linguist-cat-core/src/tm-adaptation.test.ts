import { expect, test } from 'bun:test'
import { matchTmCandidates } from './tm-matching'

test('adapts unambiguous numbers, dates, units and variables without changing the match score', () => {
  const cases = [
    ['Collect 20 coins', 'Collect 10 coins', '领取 10 金币', '领取 20 金币'],
    ['Gain 25% power', 'Gain 10% power', '提升 10% 威力', '提升 25% 威力'],
    ['Wait 3.5 seconds', 'Wait 1.5 seconds', '等待 1.5 秒', '等待 3.5 秒'],
    ['On 2026-12-31', 'On 2026-01-01', '日期 2026-01-01', '日期 2026-12-31'],
    ['On 12/25/2026', 'On 11/25/2026', '日期 11/25/2026', '日期 12/25/2026'],
    ['At 12:30', 'At 11:45', '时间 11:45', '时间 12:30'],
    ['Carry 20 kg', 'Carry 10 kg', '携带 10 kg', '携带 20 kg'],
    ['Run 5 km', 'Run 2 km', '跑 2 km', '跑 5 km'],
    ['Wait 30 ms', 'Wait 20 ms', '等待 20 ms', '等待 30 ms'],
    ['Hello {hero}', 'Hello {player}', '你好 {player}', '你好 {hero}'],
    ['Hello ${hero}', 'Hello ${player}', '你好 ${player}', '你好 ${hero}'],
    ['Use %d', 'Use %s', '使用 %s', '使用 %d'],
  ] as const
  for (const [source, memory, target, expected] of cases) {
    const match = matchTmCandidates(source, [{ unitId: 'synthetic', source: memory, target }], { minimumScore: 0 })[0]!
    expect(match.adaptation?.candidate, source).toBe(expected)
    expect(match.adaptation?.status, source).toBe(source.includes('{') || source.includes('%d') ? 'adapted' : 'needs-review')
    expect(match.adaptation?.replacements.length, source).toBe(1)
    expect(match.target, source).toBe(target)
    const withoutAdaptation = matchTmCandidates(source, [{ unitId: 'synthetic', source: memory, target: 'unrelated' }], { minimumScore: 0 })[0]!
    expect(match.displayScore, source).toBe(withoutAdaptation.displayScore)
  }
})

test('numeric and locale-sensitive tentative replacements require judgment', () => {
  for (const [source, memory, target] of [
    ['On 02/03/2026', 'On 01/01/2026', 'Le 01/01/2026'],
    ['On day 2 go to First Street', 'On day 1 go to First Street', '第一天前往1号街'],
  ] as const) {
    const match = matchTmCandidates(source, [{ unitId: 'synthetic', source: memory, target }], { minimumScore: 0 })[0]!
    expect(match.adaptation?.status).toBe('needs-review')
    expect(match.structure.reasons.join(' ')).toContain('判断')
  }
})

test('uncertain mappings remain unchanged and are passed to judgment', () => {
  for (const [source, memory, target] of [
    ['Take 20 and 30', 'Take 10 and 10', '拿 10 和 10'],
    ['Take 20 coins', 'Take 10 coins', '拿十枚金币'],
    ['Spend 20 coins', 'Take 10 coins', '拿 10 金币'],
    ['Use <ph id="20"/>', 'Use <ph id="10"/>', '使用 <ph id="10"/>'],
  ] as const) {
    const match = matchTmCandidates(source, [{ unitId: 'synthetic', source: memory, target }], { minimumScore: 0 })[0]!
    expect(match.adaptation?.status, source).toBe('needs-review')
    expect(match.adaptation?.candidate, source).toBeUndefined()
    expect(match.target, source).toBe(target)
  }
})
