import { tokenizeInlineText } from './inline-tokens'
import type { LinguistTagProfileInfo } from '@linguist/domain-service/contracts'
export interface EditorDiffPart { kind: 'equal' | 'remove' | 'insert'; text: string }

/** Tag-atomic token diff: whitespace remains significant and raw strings always round-trip. */
export function editorDiffParts(before: string, after: string, tagProfile?: LinguistTagProfileInfo, targetLocale?: string): EditorDiffPart[] {
  const tokens = (text: string) => tokenizeInlineText(text, { tagProfile, targetLocale }).flatMap(token => {
    if (token.kind === 'tag') return [token.raw]
    // Keep Han characters separate so an edit inside a sentence retains its unchanged text.
    return token.raw.split(/(\p{Script=Han}\p{M}*)/u)
      .flatMap(part => part.match(/\s|[\p{L}\p{M}\p{N}_]+|[^\s\p{L}\p{M}\p{N}_]/gu) ?? [])
  })
  const left = tokens(before), right = tokens(after)
  const parts: EditorDiffPart[] = []
  const add = (kind: EditorDiffPart['kind'], text: string) => {
    if (!text) return
    if (parts.at(-1)?.kind === kind) parts.at(-1)!.text += text
    else parts.push({ kind, text })
  }
  let prefix = 0
  while (prefix < left.length && prefix < right.length && left[prefix] === right[prefix]) add('equal', left[prefix++]!)
  let suffix = 0
  while (suffix < left.length - prefix && suffix < right.length - prefix && left[left.length - 1 - suffix] === right[right.length - 1 - suffix]) suffix++
  const a = left.slice(prefix, left.length - suffix), b = right.slice(prefix, right.length - suffix)
  // Bounded LCS for a single segment. Very long changed middles remain a truthful coarse diff.
  if (a.length * b.length > 1_000_000) { add('remove', a.join('')); add('insert', b.join('')) }
  else {
    const width = b.length + 1
    const table = new Uint32Array((a.length + 1) * width)
    for (let i = a.length - 1; i >= 0; i--) for (let j = b.length - 1; j >= 0; j--) table[i * width + j] = a[i] === b[j] ? table[(i + 1) * width + j + 1]! + 1 : Math.max(table[(i + 1) * width + j]!, table[i * width + j + 1]!)
    let i = 0, j = 0
    while (i < a.length || j < b.length) {
      if (i < a.length && j < b.length && a[i] === b[j]) { add('equal', a[i++]!); j++ }
      else if (i < a.length && (j === b.length || table[(i + 1) * width + j]! >= table[i * width + j + 1]!)) add('remove', a[i++]!)
      else add('insert', b[j++]!)
    }
  }
  if (suffix) add('equal', left.slice(left.length - suffix).join(''))
  return parts
}
