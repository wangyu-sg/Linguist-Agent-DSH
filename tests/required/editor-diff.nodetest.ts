import assert from 'node:assert/strict'
import test from 'node:test'
import { editorDiffParts } from '../../packages/dsh-linguist/src/client/editor-diff.ts'
import { scanTags } from '../../packages/linguist-cat-core/src/index.ts'

function roundTrip(before: string, after: string) {
  const parts = editorDiffParts(before, after)
  assert.equal(parts.filter(part => part.kind !== 'insert').map(part => part.text).join(''), before)
  assert.equal(parts.filter(part => part.kind !== 'remove').map(part => part.text).join(''), after)
  return parts
}

test('editor diff isolates multiple changes including invisible whitespace without changing either side', () => {
  const parts = roundTrip('A small hero has 10 gems.\nNext line.', 'A great hero has 12 gems.\nNext  line.')
  assert.ok(parts.some(part => part.kind === 'equal' && part.text.includes(' hero has ')))
  assert.ok(parts.some(part => part.kind === 'insert' && part.text === ' '))
})

test('editor diff never splits raw tag attributes into editable-looking fragments', () => {
  const before = '<g id="11"><g id="7">Synthetic label A</g></g>'
  const after = '<g id="11"><g id="8">Synthetic label B</g></g>'
  const parts = roundTrip(before, after)
  for (const part of parts) for (const tag of scanTags(part.text)) assert.ok(part.text.slice(tag.start, tag.end).startsWith('<'))
  assert.ok(parts.some(part => part.kind === 'remove' && part.text.includes('<g id="7">')))
  assert.ok(parts.some(part => part.kind === 'insert' && part.text.includes('<g id="8">')))
})

test('editor diff handles empty, CJK, combining marks, emoji and significant line endings', () => {
  for (const [before, after] of [['', ''], ['', '新译文'], ['原稿', ''], ['Café 🙂\r\n', 'Café 🙂\n'], ['变量 {0} 100%', '变量 {0}  100%']]) roundTrip(before!, after!)
})

test('very long changed text uses bounded comparison and retains exact originals', () => {
  roundTrip('a '.repeat(2000), 'b '.repeat(2000))
})
