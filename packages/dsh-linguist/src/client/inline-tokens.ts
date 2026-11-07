import { scanTags, type TagTokenKind } from '@linguist/cat-core'
import type { LinguistTagProfileInfo } from '@linguist/domain-service/contracts'

export interface InlineTextToken { kind: 'text'; raw: string; start: number; end: number }
export interface InlineTagToken {
  kind: 'tag'
  raw: string
  start: number
  end: number
  /** Shared by both ends of a pair and by its source/target counterparts. */
  key: string
  pairId: string
  tagKind: TagTokenKind
  familyId: string
}
export type InlineToken = InlineTextToken | InlineTagToken
export interface InlineTokenOptions { sourceText?: string; tagProfile?: LinguistTagProfileInfo; targetLocale?: string }
export interface InlineAnnotation {
  id: string
  start: number
  end: number
  kind: 'term' | 'number' | 'issue' | 'spelling'
  title?: string
  active?: boolean
}
/** Split text only; annotations overlapping chips are intentionally clipped to text runs. */
export function annotatedTextRuns(text: string, start: number, annotations: readonly InlineAnnotation[] = []): Array<{ raw: string; start: number; annotations: readonly InlineAnnotation[] }> {
  const end = start + text.length
  const relevant = annotations.filter(annotation => annotation.start < end && annotation.end > start).map(annotation => ({ ...annotation,
    start: start + unicodeBoundary(text, annotation.start - start, false),
    end: start + unicodeBoundary(text, annotation.end - start, true),
  }))
  const boundaries = [...new Set([start, end, ...relevant.flatMap(annotation => [Math.max(start, annotation.start), Math.min(end, annotation.end)])])].sort((a, b) => a - b)
  return boundaries.slice(0, -1).map((at, index) => ({ raw: text.slice(at - start, boundaries[index + 1]! - start), start: at,
    annotations: relevant.filter(annotation => annotation.start <= at && annotation.end >= boundaries[index + 1]!) }))
}
export interface InlineSelection { start: number; end: number; backward?: boolean }

/** All offsets in this module are raw JavaScript UTF-16 offsets, never chip-label offsets. */
export function tokenizeInlineText(text: string, options: InlineTokenOptions = {}): InlineToken[] {
  const source = options.sourceText ?? text
  const sourceTags = scanTags(source, { profile: options.tagProfile, targetLocale: options.targetLocale })
  const identities = new Map<string, number[]>()
  let nextId = 0
  for (const tag of sourceTags) {
    // Closing tags are assigned through the opener stack, not a literal occurrence queue.
    if (tag.kind === 'close') continue
    const signature = JSON.stringify([tag.familyId, tag.kind, source.slice(tag.start, tag.end)])
    const queue = identities.get(signature) ?? []
    queue.push(++nextId)
    identities.set(signature, queue)
  }
  const used = new Map<string, number>()
  const stack: Array<{ group: string | null; name: string | null; id: number; key: string }> = []
  const result: InlineToken[] = []
  let cursor = 0
  let unmatched = 0
  for (const tag of scanTags(text, { profile: options.tagProfile, targetLocale: options.targetLocale })) {
    if (tag.start > cursor) result.push({ kind: 'text', raw: text.slice(cursor, tag.start), start: cursor, end: tag.start })
    const raw = text.slice(tag.start, tag.end)
    let id: number | undefined
    let key: string | undefined
    if (tag.kind === 'close') {
      // Search from the top so identical nested closers bind to the innermost opener.
      const index = stack.findLastIndex(entry => entry.group === tag.pairGroup && entry.name === tag.pairKey)
      if (index >= 0) {
        const opener = stack[index]!
        id = opener.id
        key = opener.key
        stack.splice(index)
      }
    } else {
      const signature = JSON.stringify([tag.familyId, tag.kind, raw])
      const occurrence = used.get(signature) ?? 0
      used.set(signature, occurrence + 1)
      id = identities.get(signature)?.[occurrence]
      if (id !== undefined) key = `tag:${id}`
    }
    if (id === undefined) { id = ++unmatched; key = `target-tag:${id}` }
    if (tag.kind === 'open') stack.push({ group: tag.pairGroup, name: tag.pairKey, id, key: key! })
    result.push({ kind: 'tag', raw, start: tag.start, end: tag.end, key: key!, pairId: key!,
      tagKind: tag.kind, familyId: tag.familyId })
    cursor = tag.end
  }
  if (cursor < text.length) result.push({ kind: 'text', raw: text.slice(cursor), start: cursor, end: text.length })
  return result
}

export interface UnicodeCharacter {
  raw: string
  start: number
  end: number
  codePoint: number
  codePointLabel: string
  name: string
  glyph: string
  invisible: boolean
}
const invisibles: Record<number, readonly [string, string]> = {
  0x09: ['CHARACTER TABULATION', '→'], 0x0a: ['LINE FEED', '↵'], 0x0d: ['CARRIAGE RETURN', '␍'],
  0x20: ['SPACE', '·'], 0xa0: ['NO-BREAK SPACE', '⍽'], 0xad: ['SOFT HYPHEN', 'SHY'],
  0x200b: ['ZERO WIDTH SPACE', 'ZWSP'], 0x200c: ['ZERO WIDTH NON-JOINER', 'ZWNJ'],
  0x200d: ['ZERO WIDTH JOINER', 'ZWJ'], 0x200e: ['LEFT-TO-RIGHT MARK', 'LRM'],
  0x200f: ['RIGHT-TO-LEFT MARK', 'RLM'], 0x2028: ['LINE SEPARATOR', 'LS'],
  0x2029: ['PARAGRAPH SEPARATOR', 'PS'], 0x202a: ['LEFT-TO-RIGHT EMBEDDING', 'LRE'],
  0x202b: ['RIGHT-TO-LEFT EMBEDDING', 'RLE'], 0x202c: ['POP DIRECTIONAL FORMATTING', 'PDF'],
  0x202d: ['LEFT-TO-RIGHT OVERRIDE', 'LRO'], 0x202e: ['RIGHT-TO-LEFT OVERRIDE', 'RLO'],
  0x202f: ['NARROW NO-BREAK SPACE', 'NNBSP'], 0x2060: ['WORD JOINER', 'WJ'],
  0x2066: ['LEFT-TO-RIGHT ISOLATE', 'LRI'], 0x2067: ['RIGHT-TO-LEFT ISOLATE', 'RLI'],
  0x2068: ['FIRST STRONG ISOLATE', 'FSI'], 0x2069: ['POP DIRECTIONAL ISOLATE', 'PDI'],
  0xfeff: ['ZERO WIDTH NO-BREAK SPACE', 'BOM'],
}
export function unicodeCharacters(text: string): UnicodeCharacter[] {
  const result: UnicodeCharacter[] = []
  let start = 0
  for (const raw of text) {
    const codePoint = raw.codePointAt(0)!
    const known = invisibles[codePoint]
    const codePointLabel = `U+${codePoint.toString(16).toUpperCase().padStart(4, '0')}`
    result.push({ raw, start, end: start + raw.length, codePoint, codePointLabel,
      name: known?.[0] ?? codePointLabel, glyph: known?.[1] ?? raw, invisible: known !== undefined })
    start += raw.length
  }
  return result
}

function unicodeBoundary(text: string, offset: number, forward: boolean): number {
  const at = Math.max(0, Math.min(offset, text.length))
  const before = text.charCodeAt(at - 1), after = text.charCodeAt(at)
  return before >= 0xd800 && before <= 0xdbff && after >= 0xdc00 && after <= 0xdfff
    ? at + (forward ? 1 : -1) : at
}
export function snapInlineSelection(text: string, start: number, end: number, tokens: readonly InlineToken[]): InlineSelection {
  let left = unicodeBoundary(text, Math.min(start, end), false)
  let right = unicodeBoundary(text, Math.max(start, end), start !== end)
  if (start === end) right = left
  for (const token of tokens) {
    if (token.kind !== 'tag') continue
    if (left === right && left > token.start && left < token.end) {
      left = right = left - token.start <= token.end - left ? token.start : token.end
    } else if (left < token.end && right > token.start) {
      left = Math.min(left, token.start); right = Math.max(right, token.end)
    }
  }
  return { start: left, end: right }
}

export interface InlineDomPoint { node: Node; offset: number }
interface DomSpan { start: number; end: number; boundaries?: number[]; atomic?: boolean }
/** Read-only DOM mapping; chip labels and presentation glyphs never become raw content. */
function mapInlineDom(root: Node): { text: string; spans: Map<Node, DomSpan> } {
  const spans = new Map<Node, DomSpan>()
  let text = ''
  const visit = (node: Node): void => {
    const start = text.length
    if (node.nodeType === 3) text += node.nodeValue ?? ''
    else {
      const element = node.nodeType === 1 ? node as Element : undefined
      if (element?.hasAttribute('data-inline-tail')) { spans.set(node, { start, end: start }); return }
      const raw = element?.getAttribute('data-inline-raw')
      if (raw !== null && raw !== undefined) {
        text += raw; spans.set(node, { start, end: text.length, atomic: true }); return
      }
      if (element?.tagName === 'BR') {
        const parent = node.parentNode
        const filler = parent?.childNodes.length === 1 && (parent === root || (parent.nodeType === 1 && /^(DIV|P|LI)$/.test((parent as Element).tagName)))
        if (!filler) text += '\n'
      } else {
        const boundaries = [start]
        let previousBlock = false
        let previousStart = start
        let hasPrevious = false
        for (const child of Array.from(node.childNodes)) {
          const block = child.nodeType === 1 && /^(DIV|P|LI)$/.test((child as Element).tagName)
          if (hasPrevious && (block || previousBlock) && (!text.endsWith('\n') || previousStart === text.length)) text += '\n'
          const childStart = text.length
          visit(child)
          if (block || text.length > childStart) {
            previousStart = childStart
            previousBlock = block
            hasPrevious = true
          }
          boundaries.push(text.length)
        }
        spans.set(node, { start, end: text.length, boundaries }); return
      }
    }
    spans.set(node, { start, end: text.length })
  }
  visit(root)
  return { text, spans }
}
export function readInlineDomText(root: Node): string { return mapInlineDom(root).text }
export function inlineDomPointToOffset(root: Node, node: Node, offset: number): number | undefined {
  const { spans } = mapInlineDom(root)
  const span = spans.get(node)
  if (span !== undefined) {
    if (span.atomic) return offset === 0 ? span.start : span.end
    if (span.boundaries) return span.boundaries[Math.min(offset, span.boundaries.length - 1)]
    return Math.min(span.end, span.start + offset)
  }
  // A browser selection may point at the text label inside contentEditable=false.
  for (let parent = node.parentNode; parent !== null && parent !== root.parentNode; parent = parent.parentNode) {
    const atomic = spans.get(parent)
    if (atomic?.atomic) return offset === 0 ? atomic.start : atomic.end
  }
  return undefined
}
export function inlineOffsetToDomPoint(root: Node, offset: number): InlineDomPoint {
  const { text, spans } = mapInlineDom(root)
  const at = Math.max(0, Math.min(offset, text.length))
  for (const [node, span] of spans) {
    if (node.nodeType === 3 && at >= span.start && at <= span.end) return { node, offset: at - span.start }
    if (span.atomic && at >= span.start && at <= span.end) {
      const parent = node.parentNode!
      const index = Array.from(parent.childNodes).indexOf(node as ChildNode)
      return { node: parent, offset: index + (at - span.start > (span.end - span.start) / 2 ? 1 : 0) }
    }
  }
  return { node: root, offset: root.childNodes.length }
}
export function inlineDomSelection(root: Node, selection: Selection | null): InlineSelection | undefined {
  if (!selection?.anchorNode || !selection.focusNode) return undefined
  const anchor = inlineDomPointToOffset(root, selection.anchorNode, selection.anchorOffset)
  const focus = inlineDomPointToOffset(root, selection.focusNode, selection.focusOffset)
  if (anchor === undefined || focus === undefined) return undefined
  return { start: Math.min(anchor, focus), end: Math.max(anchor, focus), backward: anchor > focus }
}
export function copyInlineSelection(root: HTMLElement, event: { clipboardData: DataTransfer; preventDefault(): void }): void {
  const selection = root.ownerDocument.getSelection()
  if (!selection || selection.isCollapsed || selection.rangeCount === 0) return
  const own = inlineDomSelection(root, selection)
  // cloneContents also retains data-inline-raw when a selection crosses two inline views.
  const raw = own ? readInlineDomText(root).slice(own.start, own.end)
    : readInlineDomText(selection.getRangeAt(0).cloneContents())
  event.clipboardData.setData('text/plain', raw)
  event.preventDefault()
}
