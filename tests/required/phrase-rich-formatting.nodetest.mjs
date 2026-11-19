import test from 'node:test'
import assert from 'node:assert/strict'
import { phraseFormatting, formattingTextOffset, formattingRawOffset, phraseFormatSelection, togglePhraseFormat, replacePhraseFormattedText, tokenizeInlineText } from '../../packages/dsh-linguist/src/client/inline-tokens.ts'

const format = 'phrase_mxliff_1_2'
const parse = value => phraseFormatting(value, format, tokenizeInlineText(value))
const toggle = (value, start, end, flag) => togglePhraseFormat(value, { start, end, backward: true }, flag, format, tokenizeInlineText(value))

test('native B/I/U and flat compound flags retain raw UTF-16 coordinates while presenting text', () => {
  for (const flags of ['b', 'i', 'u', 'bi', 'bu', 'iu', 'biu']) {
    const value = `前 {${flags}>😀 e\u0301\r\n{name}<${flags}} 后`
    const model = parse(value)
    assert(model.supported && model.valid)
    assert.equal(model.text, '前 😀 e\u0301\r\n{name} 后')
    assert.deepEqual(model.ranges[0].flags, [...flags])
    assert.equal(value.slice(model.ranges[0].start, model.ranges[0].end), '😀 e\u0301\r\n{name}')
    for (let at = 0; at <= model.text.length; at++) for (const affinity of ['start', 'end']) {
      assert.equal(formattingTextOffset(model, formattingRawOffset(model, at, affinity)), at)
    }
  }
})

test('unknown, unbalanced, duplicate, mismatched or nested formatting remains literal and cannot be formatted', () => {
  for (const value of ['{u>x', 'x<b}', '{bu>x<u}', '{bb>x<bb}', '{b>a{i>b<i}<b}', '{_>sub<_}', '{^>sup<^}', '{bu^>mixed<bu^}']) {
    const model = parse(value)
    assert.equal(model.valid, false, value)
    assert.equal(model.text, value)
    assert.deepEqual(model.codes, [])
    assert.deepEqual(model.ranges, [])
    assert.equal(toggle(value, 0, value.length, 'u'), undefined)
  }
  for (const id of [undefined, 'xliff_1_2', 'sdlxliff_1_2', 'json']) {
    assert.equal(phraseFormatting('{u>literal<u}', id).supported, false)
    assert.equal(togglePhraseFormat('plain', { start: 0, end: 5 }, 'b', id, []), undefined)
  }
})

test('runtime chip code is never reinterpreted as a formatting delimiter', () => {
  const value = '<g name="{u>inside">text<u}'
  const model = phraseFormatting(value, format, tokenizeInlineText(value))
  assert.equal(model.valid, false)
  assert.equal(model.text, value)
  const profile = { families: [{ id: 'opaque', class: 'singleton', pattern: '\\[opaque:[^\\]]+\\]' }], candidates: [] }
  const raw = '[opaque:{u>inside<u}]'
  assert.equal(phraseFormatting(raw, format, tokenizeInlineText(raw, { tagProfile: profile })).valid, false)
})

test('one selected format transaction adds and removes only the requested style', () => {
  const initial = 'abcde'
  const underlined = toggle(initial, 1, 4, 'u')
  assert.equal(underlined.value, 'a{u>bcd<u}e')
  assert.deepEqual(underlined.selection, { start: 4, end: 7, backward: true })
  assert.equal(phraseFormatSelection(parse(underlined.value), underlined.selection, 'u'), true)
  const bold = toggle(underlined.value, underlined.selection.start, underlined.selection.end, 'b')
  assert.equal(bold.value, 'a{bu>bcd<bu}e')
  const italic = toggle(bold.value, bold.selection.start, bold.selection.end, 'i')
  assert.equal(italic.value, 'a{biu>bcd<biu}e')
  const removeU = toggle(italic.value, italic.selection.start, italic.selection.end, 'u')
  assert.equal(removeU.value, 'a{bi>bcd<bi}e')
  assert.equal(toggle('abc', 1, 1, 'u'), undefined, 'an empty selection is not expanded to the whole segment')
})

test('partial removal splits the old range into balanced flat codes and preserves other styles', () => {
  const raw = '{bu>abcde<bu}'
  const edit = toggle(raw, 5, 8, 'u')
  assert.equal(edit.value, '{bu>a<bu}{b>bcd<b}{bu>e<bu}')
  assert.equal(parse(edit.value).text, 'abcde')
  assert(parse(edit.value).valid)
  assert.equal(phraseFormatSelection(parse(edit.value), edit.selection, 'b'), true)
  assert.equal(phraseFormatSelection(parse(edit.value), edit.selection, 'u'), false)
  const mixed = { start: 0, end: edit.value.length }
  assert.equal(phraseFormatSelection(parse(edit.value), mixed, 'u'), 'mixed')
  assert.equal(phraseFormatSelection(parse(edit.value), mixed, 'b'), true)
})

test('format commands preserve runtime token identity and all non-format raw content', () => {
  const raw = '<color=red>A {name} <ph id="12">{0}</ph>😀</color>'
  const before = tokenizeInlineText(raw).filter(token => token.kind === 'tag').map(token => token.raw)
  const edit = toggle(raw, 0, raw.length, 'u')
  const after = tokenizeInlineText(edit.value).filter(token => token.kind === 'tag').map(token => token.raw)
  assert.deepEqual(after, before)
  assert.equal(parse(edit.value).text, raw)
  assert.equal(toggle(edit.value, edit.selection.start, edit.selection.end, 'u').value, raw)
})

test('visible text replacement preserves surrounding flags and accepts balanced rich clipboard fragments', () => {
  const raw = '{bi>hello world<bi}'
  const edit = replacePhraseFormattedText(raw, { start: 4, end: 9 }, '😀', format, tokenizeInlineText(raw))
  assert.equal(edit.value, '{bi>😀 world<bi}')
  assert.equal(edit.selection.start, 6)
  const inserted = replacePhraseFormattedText('A Z', { start: 2, end: 2 }, '{u>B {name}<u}', format, [])
  assert.equal(inserted.value, 'A {u>B {name}<u}Z')
  assert(parse(inserted.value).valid)
  assert.equal(replacePhraseFormattedText(raw, { start: 4, end: 4 }, '{u>broken', format, []), undefined)
  const unchanged = '{ub>A<ub}{ub>B<ub}'
  assert.equal(replacePhraseFormattedText(unchanged, { start: 4, end: 4 }, '', format, []).value, unchanged, 'a no-op must not normalize unrelated raw codes')
})
