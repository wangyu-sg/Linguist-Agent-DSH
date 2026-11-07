import test from 'node:test'
import assert from 'node:assert/strict'
import {
  analyzeTerms, analyzeSegmentAssistance, parseLengthConstraints, summarizeVisibleCounts,
} from '../../packages/dsh-linguist/src/client/editor-assist.ts'
import { scanTags } from '../../packages/linguist-cat-core/src/index.ts'

// Current code + synthetic strings only: no customer projects, database or historical snapshots.
const term = (changes = {}) => ({
  id: 'term-synthetic', term: '药水', translation: 'Potion', status: 'preferred',
  caseSensitive: false, matchType: 'contains', conflict: false,
  start: 3, end: 5, lowDiscrimination: false, ...changes,
})
const analyze = (source, target, options = {}) => analyzeSegmentAssistance({ source, target, ...options })
const ofKind = (result, kind) => result.issues.filter(issue => issue.kind === kind)
const constraint = (id, value, scope) => ({ id, kind: 'length', valueJson: typeof value === 'string' ? value : JSON.stringify(value), scope, updatedAt: 'synthetic' })

test('Host occurrence identity and raw UTF-16 offsets survive analysis without re-matching source', () => {
  const source = '🦉药水，药水'
  const first = term({ id: 'first', start: 2, end: 4 })
  const second = term({ id: 'second', start: 5, end: 7 })
  const result = analyze(source, '🦉 Potion', { termMatches: [first, second] })
  assert.strictEqual(result.terms[0].match, first)
  assert.strictEqual(result.terms[1].match, second)
  assert.deepEqual(result.terms.map(item => item.state), ['present', 'present'])
  assert.deepEqual(result.terms[0].targetRanges, [{ start: 3, end: 9 }])
  assert.deepEqual(analyzeTerms([], 'Potion'), [], 'Client never mines source/project terms')
})

test('target coverage excludes attributes, placeholders and custom project tags, not visible formatted text', () => {
  const tagProfile = { families: [{ id: 'synthetic', pattern: '\\[ICON:[^\\]]+\\]', class: 'singleton' }] }
  const target = '<span title="Potion 999">Health <b>Potion</b></span> {Potion} [ICON:Potion]'
  const match = term({ translation: 'Health Potion' })
  const result = analyzeTerms([match], target, tagProfile)[0]
  assert.equal(result.state, 'present')
  assert.equal(result.targetRanges.map(range => target.slice(range.start, range.end)).join(''), 'Health Potion')
  for (const range of result.targetRanges) {
    assert(!scanTags(target, { profile: tagProfile }).some(tag => range.start < tag.end && range.end > tag.start))
  }
  assert.equal(analyzeTerms([term()], '<span title="Potion">x</span> {Potion} [ICON:Potion]', tagProfile)[0].state, 'missing')
  assert.equal(analyzeTerms([term({ translation: 'abcd' })], 'ab{name}cd')[0].state, 'missing', 'unknown dynamic text cannot join words')
})

test('Latin word/case boundaries are respected while CJK terms can occur inside a sentence', () => {
  assert.equal(analyzeTerms([term({ translation: 'cat' })], 'concatenate')[0].state, 'missing')
  assert.equal(analyzeTerms([term({ translation: 'cat' })], 'category cat_2')[0].state, 'missing')
  assert.equal(analyzeTerms([term({ translation: 'HP', caseSensitive: true })], 'hp')[0].state, 'missing')
  assert.equal(analyzeTerms([term({ translation: 'Potion', caseSensitive: false })], 'POTION')[0].state, 'present')
  assert.equal(analyzeTerms([term({ translation: '药水' })], '获得药水奖励')[0].state, 'present')
})

test('simple English plurals/inflections request review rather than reporting a definite missing term', () => {
  for (const [translation, target] of [['potion', 'potions'], ['city', 'cities'], ['box', 'boxes'], ['charge', 'charging'], ['carry', 'carried']]) {
    const result = analyze('药水', target, { termMatches: [term({ translation, start: 0, end: 2 })] })
    assert.equal(result.terms[0].state, 'review', `${translation} / ${target}`)
    assert(result.terms[0].targetRanges.length)
    assert(ofKind(result, 'term').every(issue => issue.severity === 'info'))
  }
  const absent = analyze('药水', 'Drink this.', { termMatches: [term({ start: 0, end: 2 })] })
  assert.equal(absent.terms[0].state, 'missing')
  assert.equal(ofKind(absent, 'term')[0].severity, 'info')
  assert.match(ofKind(absent, 'term')[0].message, /需复核/)
})

test('approved variants share coverage, without requiring every approved translation', () => {
  const matches = [term(), term({ id: 'variant', translation: 'Draught', status: 'allowed' })]
  const result = analyze('使用药水', 'Use the draught.', { termMatches: matches })
  assert.deepEqual(result.terms.map(item => item.state), ['present', 'present'])
  assert.deepEqual(result.terms[0].targetRanges, result.terms[1].targetRanges)
  assert.equal(ofKind(result, 'term').length, 0)
  const distinctOccurrence = analyzeTerms([matches[0], term({ id: 'other', start: 8, end: 10, translation: 'Elixir' })], 'Potion')
  assert.equal(distinctOccurrence[1].state, 'missing', 'variants do not leak across source occurrences')
})

test('forbidden/deprecated absence is OK, positive presence warns, conflict and weak matches request review', () => {
  for (const status of ['forbidden', 'deprecated']) {
    assert.equal(analyzeTerms([term({ status })], 'Drink')[0].state, 'present')
    assert.equal(ofKind(analyze('药水', 'Drink', { termMatches: [term({ status })] }), 'term').length, 0)
    const result = analyze('药水', 'Potion', { termMatches: [term({ status })] })
    assert.equal(result.terms[0].state, 'forbidden')
    assert.equal(ofKind(result, 'term')[0].side, 'target')
    assert.equal(ofKind(result, 'term')[0].severity, 'warning')
  }
  assert.equal(analyzeTerms([term({ conflict: true })], 'Potion')[0].state, 'conflict')
  assert.equal(analyzeTerms([term({ lowDiscrimination: true })], 'Potion')[0].state, 'review')
})

test('numbers keep signs, percent, currency, unit aliases and occurrence counts outside tag code', () => {
  const source = '<b amount="999">-$1,234.50</b>; -20%; 5 kg; 5 kg; {count_42}'
  const target = '<b amount="123">-$1,234.50</b>; −20％; 5 公斤; 5 千克; {count_42}'
  const options = { sourceLocale: 'en-US', targetLocale: 'en-US' }
  assert.equal(ofKind(analyze(source, target, options), 'number').length, 0)
  assert.equal(ofKind(analyze(source, target, options), 'variable').length, 0)
  const result = analyze(source, '<b amount="999">-$1,234.50</b>; -20%; 5 kg; {count_42}', options)
  const missing = ofKind(result, 'number').find(issue => issue.code === 'number.missing')
  assert(missing)
  assert.equal(missing.values.sourceCount, 2)
  assert.equal(missing.values.targetCount, 1)
  assert.equal(source.slice(missing.start, missing.end), '5 kg')
  assert(!ofKind(result, 'number').some(issue => issue.values.value.includes('999') || issue.values.value.includes('42')))
})

test('scanner locale activation uses the segment target locale on both sides, not source numeric locale', () => {
  const tagProfile = { families: [{ id: 'locale-only', pattern: '\\[LOCALE:[^\\]]+\\]', class: 'singleton', targetLocales: ['en'] }] }
  const source = '[LOCALE:77] 5'
  const target = '[LOCALE:77] 5'
  const active = analyze(source, target, { tagProfile, sourceLocale: 'de-DE', targetLocale: 'en-US' })
  assert.equal(active.numberPairs.length, 1)
  assert.equal(active.length.source.codePoints, 2)
  const inactive = analyze(source, target, { tagProfile, sourceLocale: 'de-DE', targetLocale: 'fr-FR' })
  assert.equal(inactive.numberPairs.length, 2)
  assert.equal(inactive.length.source.codePoints, source.length)
})

test('localized numeric formatting normalizes exact values without floating point precision loss', () => {
  for (const [source, target, options] of [
    ['1,234.50', '1.234,50', { sourceLocale: 'en-US', targetLocale: 'de-DE' }],
    ['1\u202f234,50', '1,234.50', { sourceLocale: 'fr-FR', targetLocale: 'en-US' }],
    ['12,50', '12.5', {}],
    ['١٢٫٥', '12.5', {}],
    ['１２.５', '12.5', {}],
    ['USD 5', '5 US$', {}],
    ['EUR5', '5 EUR', {}],
    ['- 5', '−5', {}],
    ['USD - 5', '-5 USD', {}],
    ['9007199254740993', '9007199254740993', {}],
  ]) assert.equal(ofKind(analyze(source, target, options), 'number').length, 0, `${source} / ${target}`)
  assert(ofKind(analyze('9007199254740993', '9007199254740992'), 'number').length)
})

test('numeric correspondence exposes raw one-to-one hover ranges using the same localized normalization', () => {
  const source = '🦉 1,234.50 kg / 1,234.50 kg / -5%'
  const target = '1.234,50 公斤 / -5％'
  const result = analyze(source, target, { sourceLocale: 'en-US', targetLocale: 'de-DE' })
  assert.equal(result.numberPairs.length, 3)
  const [first, duplicate, negative] = result.numberPairs
  assert.equal(source.slice(first.source.start, first.source.end), '1,234.50 kg')
  assert.equal(target.slice(first.target[0].start, first.target[0].end), '1.234,50 公斤')
  assert.equal(first.uncertain, false)
  assert.deepEqual(duplicate.target, [], 'one target occurrence cannot cover two source occurrences')
  assert.equal(target.slice(negative.target[0].start, negative.target[0].end), '-5％')
  const ambiguous = analyze('1,234 / 1234', '1234').numberPairs
  assert.equal(ambiguous[0].uncertain, true)
  assert.deepEqual(ambiguous[0].target, [], 'ambiguous candidate cannot steal a later exact occurrence')
  assert.equal(ambiguous[1].target.length, 1)
  const candidate = analyze('1,234', '1234').numberPairs[0]
  assert.equal(candidate.target.length, 1)
  assert.equal(candidate.uncertain, true)
  const styledTarget = '1<b>0</b> kg'
  const styled = analyze('10 kg', styledTarget).numberPairs[0]
  assert.equal(styled.target.map(range => styledTarget.slice(range.start, range.end)).join(''), '10 kg')
  assert(styled.target.every(range => !scanTags(styledTarget).some(tag => range.start < tag.end && range.end > tag.start)))
})

test('ambiguous decimal/group punctuation, structured values and unit conversion remain review-only', () => {
  for (const [source, target] of [['1,234', '1234'], ['1.234', '1234'], ['100 200', '100200'], ['1 km', '1000 m'], ['$5', '5 USD'], ['2026-11-07', '2026-11-08']]) {
    const issues = ofKind(analyze(source, target), 'number')
    assert(issues.length, `${source} / ${target}`)
    assert(issues.every(issue => issue.severity === 'info'), `${source} / ${target}`)
  }
  assert.equal(ofKind(analyze('1,234', '1,234'), 'number').length, 0, 'identical ambiguous literals need no invented discrepancy')
})

test('changed negative/percent content and extra numeric occurrences are surfaced without replacement', () => {
  for (const [source, target] of [['-5', '5'], ['20%', '20'], ['10', '10 10'], ['5 HP', '5 MP']]) {
    const result = analyze(source, target)
    assert(ofKind(result, 'number').length)
    assert.equal(result.source, undefined, 'analysis exposes no editing payload')
  }
})

test('placeholder variables are exact-case multisets, excluding attribute values and printf escapes', () => {
  const source = '<b title="{ignored} %d 99">{Player}</b> ${n} {{name}} %s {Player} %%'
  const target = '<b title="changed">{Player}</b> ${n} {{name}} %s {Player} %%'
  assert.equal(ofKind(analyze(source, target), 'variable').length, 0)
  const issues = ofKind(analyze(source, target.replace(' {Player} %%', ' %%')), 'variable')
  assert.equal(issues.length, 1)
  assert.equal(issues[0].values.sourceCount, 2)
  assert.equal(issues[0].values.targetCount, 1)
  assert.equal(issues[0].severity, 'warning')
  const changedCase = ofKind(analyze('{Player}', '{player}'), 'variable')
  assert.equal(changedCase.length, 2)
  assert(changedCase.every(issue => issue.severity === 'warning'))
})

test('printf explicit positions permit safe parameter reordering but not changed argument types', () => {
  assert.equal(ofKind(analyze('%s: %d', '%2$d: %1$s'), 'variable').length, 0)
  assert(ofKind(analyze('%s %d', '%d %s'), 'variable').length)
  const dynamic = ofKind(analyze('%*s', '%s'), 'variable')
  assert(dynamic.length)
  assert(dynamic.every(issue => issue.severity === 'info'))
})

test('ICU branch text is not mistaken for ordinary missing placeholders or number occurrences', () => {
  const result = analyze('{n, plural, one {Rare} other {items}}', '{n, plural, one {Rare} few {items} other {items}}')
  assert(ofKind(result, 'variable').length)
  assert(ofKind(result, 'variable').every(issue => issue.code === 'variable.icu' && issue.severity === 'info'))
  assert(ofKind(result, 'number').every(issue => issue.code === 'number.icu' && issue.severity === 'info'))
})

test('only explicitly documented length metadata is read; arbitrary notes/maxLen/ratios are not constraints', () => {
  assert.deepEqual(parseLengthConstraints({ maxLen: '20', maxLength: '20', note: 'max 3 characters', ratio: '1.2' }), [])
  const meta = { lengthConstraints: JSON.stringify([{ unit: 'code-points', max: 4 }, { unit: 'lines', minimum: 1, maximum: 2 }]) }
  assert.deepEqual(parseLengthConstraints(meta), [
    { id: 'meta:lengthConstraints:0', unit: 'code-points', max: 4 },
    { id: 'meta:lengthConstraints:1', unit: 'lines', min: 1, max: 2 },
  ])
  assert.equal(ofKind(analyze('短', 'A very long but unconstrained translation.'), 'length').length, 0)
})

test('code points, graphemes, UTF-8 bytes and line count exclude scanner-recognized tag code', () => {
  const text = '<b title="999">A👩‍🚀e\u0301</b>\r\n中{count}'
  const counts = summarizeVisibleCounts(text)
  assert.deepEqual(counts, { codePoints: 9, graphemes: 5, utf8Bytes: 20, lines: 2, hasPlaceholders: true, hasIcu: false })
  assert.deepEqual(summarizeVisibleCounts(''), { codePoints: 0, graphemes: 0, utf8Bytes: 0, lines: 0, hasPlaceholders: false, hasIcu: false })
  assert.equal(summarizeVisibleCounts('[b]Hi[/b]').codePoints, 2)
})

test('explicit length units are enforced independently and lower/upper bounds are inclusive', () => {
  const target = 'e\u0301🦉'
  const result = analyze('', target, { constraints: [
    constraint('points', { unit: 'code-points', min: 3, max: 3 }),
    constraint('graphemes', { unit: 'graphemes', max: 1 }),
    constraint('bytes', { unit: 'utf8-bytes', max: 6 }),
    constraint('lines', { unit: 'lines', max: 1 }),
  ] })
  assert.equal(result.length.target.codePoints, 3)
  assert.equal(result.length.target.graphemes, 2)
  assert.equal(result.length.target.utf8Bytes, 7)
  assert.equal(result.length.constraints.length, 4)
  const issues = ofKind(result, 'length')
  assert.equal(issues.length, 2)
  assert(issues.every(issue => issue.severity === 'warning'))
  assert(issues.every(issue => issue.start === 0 && issue.end === 0), 'segment-level constraints never fabricate a text span')
  assert.equal(ofKind(analyze('', 'one\ntwo', { constraints: [constraint('line', { unit: 'lines', max: 1 })] }), 'length').length, 1)
})

test('project length scopes apply only globally, to current asset or exact textType', () => {
  const result = analyze('', '12345', { assetId: 'asset-current', meta: { textType: 'UI' }, constraints: [
    constraint('global', { unit: 'code-points', max: 4 }),
    constraint('asset', { unit: 'code-points', max: 4 }, 'asset-current'),
    constraint('type', { unit: 'code-points', max: 4 }, 'UI'),
    constraint('other-asset', { unit: 'code-points', max: 1 }, 'asset-other'),
    constraint('other-type', { unit: 'code-points', max: 1 }, 'dialogue'),
    { ...constraint('not-length', { unit: 'code-points', max: 1 }), kind: 'tag_note' },
  ] })
  assert.deepEqual(result.length.constraints.map(item => item.id), ['global', 'asset', 'type'])
  assert.equal(ofKind(result, 'length').length, 3)
  const noMetadata = analyze('', '12345', { constraints: [constraint('scoped', { unit: 'code-points', max: 1 }, 'UI')] })
  assert.equal(noMetadata.length.constraints.length, 0)
})

test('malformed, unitless, contradictory or unsupported length rules are explained, never guessed or silently enforced', () => {
  const values = [
    '{broken', { maximum: 2 }, { unit: 'characters', max: 2 }, { unit: 'graphemes', min: 5, max: 2 },
    { unit: 'graphemes', max: -1 }, { unit: 'graphemes', max: '2' }, { unit: 'graphemes', max: 1.5 },
    { unit: 'graphemes', min: null, max: 2 },
    { unit: 'graphemes', max: 2, maximum: 3 }, { unit: 'lines', max: 2, perLine: true },
  ]
  for (const value of values) {
    const result = analyze('', 'abcdefghijklmnop', { constraints: [constraint('invalid', value)] })
    assert.equal(result.length.constraints.length, 0, JSON.stringify(value))
    assert.equal(result.length.invalidConstraints.length, 1, JSON.stringify(value))
    assert.equal(ofKind(result, 'length')[0].severity, 'info')
    assert.equal(ofKind(result, 'length')[0].start, ofKind(result, 'length')[0].end)
  }
  const malformedMeta = analyze('', 'x', { meta: { lengthConstraints: 'invalid JSON' } })
  assert.equal(malformedMeta.length.invalidConstraints.length, 1)
})

test('dynamic variables and ICU do not pretend to have known final display lengths', () => {
  const low = analyze('', '{name}', { constraints: [constraint('min', { unit: 'graphemes', min: 3 })] })
  assert.equal(low.length.target.codePoints, 0)
  assert.equal(ofKind(low, 'length')[0].severity, 'info')
  const high = analyze('', 'Too long {name}', { constraints: [constraint('max', { unit: 'graphemes', max: 2 })] })
  assert.equal(ofKind(high, 'length')[0].severity, 'warning', 'visible literal prefix already exceeds explicit maximum')
  const icu = analyze('', '{n, plural, one {a} other {bb}}', { constraints: [constraint('icu', { unit: 'graphemes', max: 2 })] })
  assert.equal(icu.length.target.hasIcu, true)
  assert(ofKind(icu, 'length').every(issue => issue.severity === 'info' && issue.code.startsWith('length.dynamic:')))
})

test('Unicode inspection reports raw UTF-16 ranges and preserves intentional joiners and text', () => {
  const source = '🦉x\u200by\u202ez'
  const target = '👩‍🚀 فارسی\u200c زبان\u2066x\u2069'
  const original = { source, target }
  const result = analyze(source, target)
  const issues = ofKind(result, 'unicode')
  assert(issues.every(issue => issue.severity === 'info'))
  const zwsp = issues.find(issue => issue.values.value === 'U+200B')
  assert.deepEqual({ start: zwsp.start, end: zwsp.end }, { start: 3, end: 4 })
  assert.equal(source.slice(zwsp.start, zwsp.end), '\u200b')
  assert(issues.some(issue => issue.values.value === 'U+202E'))
  assert(issues.some(issue => issue.values.value === 'U+200C'))
  assert(!issues.some(issue => issue.values.value === 'U+200D'), 'valid emoji ZWJ is not an anomaly')
  assert.deepEqual({ source, target }, original)
  assert.equal(ofKind(analyze('<b title="\u200b">safe</b>', 'safe'), 'unicode').length, 0, 'tag attributes are not visible text')
  const icuAttribute = analyze('<b title="{n, plural, one {Rare}}">5</b>', '5')
  assert.equal(ofKind(icuAttribute, 'number').length, 0)
  assert.equal(icuAttribute.length.source.hasIcu, false)
  assert(ofKind(analyze('', '\ud800'), 'unicode').some(issue => issue.code === 'unicode.control'))
})

test('issue IDs and structured localization values are deterministic and inputs remain immutable', () => {
  const match = Object.freeze(term())
  const input = Object.freeze({ source: '使用药水 -5 {n}', target: 'Drink 5 {m}\u200b', termMatches: Object.freeze([match]) })
  const first = analyzeSegmentAssistance(input)
  const second = analyzeSegmentAssistance(input)
  assert.deepEqual(first, second)
  assert.equal(new Set(first.issues.map(issue => issue.id)).size, first.issues.length)
  const repeated = analyze('药水 药水', 'Potion', { termMatches: [
    term({ status: 'forbidden', start: 0, end: 2 }), term({ status: 'forbidden', start: 3, end: 5 }),
  ] })
  assert.equal(new Set(repeated.issues.map(issue => issue.id)).size, repeated.issues.length, 'one glossary ID may repeat across source occurrences')
  for (const issue of first.issues) {
    assert.equal(typeof issue.messageKey, 'string')
    assert.equal(typeof issue.message, 'string')
    assert.equal(typeof issue.values, 'object')
    assert(issue.start >= 0 && issue.end >= issue.start)
    assert(issue.end <= input[issue.side].length)
  }
})
