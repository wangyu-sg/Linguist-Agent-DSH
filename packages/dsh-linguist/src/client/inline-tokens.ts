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
export type PhraseFormatFlag = 'b' | 'i' | 'u'
export interface InlineUnderlineRange { start: number; end: number }
export interface InlineFormatRange extends InlineUnderlineRange { flags: readonly PhraseFormatFlag[] }
export interface InlineFormatCode extends InlineUnderlineRange { opening: boolean; flags: string }
export interface PhraseFormatting {
  supported: boolean
  valid: boolean
  text: string
  codes: InlineFormatCode[]
  ranges: InlineFormatRange[]
}

/** Parse the complete field; never infer formatting inside an opaque runtime chip. */
export function phraseFormatting(text: string, formatId: string | undefined, tokens: readonly Pick<InlineToken, 'kind' | 'start' | 'end'>[] = []): PhraseFormatting {
  const supported = formatId === 'phrase_mxliff_1_2'
  const literal = (valid: boolean): PhraseFormatting => ({ supported, valid, text, codes: [], ranges: [] })
  if (!supported) return literal(true)
  const ranges: InlineFormatRange[] = [], codes: InlineFormatCode[] = []
  let active: { start: number; flags: string } | undefined
  for (const match of text.matchAll(/\{([biu_^]{1,4})>|<([biu_^]{1,4})\}/g)) {
    const end = match.index + match[0].length, flags = (match[1] ?? match[2])!
    if (/[_^]/.test(flags) || new Set(flags).size !== flags.length) return literal(false)
    if (tokens.some(token => token.kind === 'tag' && token.start < end && token.end > match.index
      && (token.start !== match.index || token.end !== end))) return literal(false)
    const opening = match[1] !== undefined
    if (opening) {
      if (active) return literal(false)
      active = { start: end, flags }
    } else {
      if (!active || active.flags !== flags) return literal(false)
      if (active.start < match.index) ranges.push({ start: active.start, end: match.index, flags: [...flags] as PhraseFormatFlag[] })
      active = undefined
    }
    codes.push({ start: match.index, end, opening, flags })
  }
  if (active) return literal(false)
  let plain = '', cursor = 0
  for (const code of codes) { plain += text.slice(cursor, code.start); cursor = code.end }
  return { supported, valid: true, text: plain + text.slice(cursor), codes, ranges }
}

export function formattingTextOffset(model: PhraseFormatting, rawOffset: number): number {
  let removed = 0
  for (const code of model.codes) {
    if (rawOffset <= code.start) break
    removed += Math.min(rawOffset, code.end) - code.start
  }
  return Math.max(0, Math.min(model.text.length, rawOffset - removed))
}

/** Affinity disambiguates the two sides of a zero-width formatting boundary. */
export function formattingRawOffset(model: PhraseFormatting, plainOffset: number, affinity: 'start' | 'end' = 'start'): number {
  const at = Math.max(0, Math.min(model.text.length, plainOffset))
  let rawStart = 0, plainStart = 0
  const candidates: number[] = []
  for (const code of [...model.codes, { start: model.text.length + model.codes.reduce((sum, item) => sum + item.end - item.start, 0), end: 0, opening: false }]) {
    const length = code.start - rawStart
    if (at >= plainStart && at <= plainStart + length) candidates.push(rawStart + at - plainStart)
    plainStart += length
    rawStart = code.end
  }
  return affinity === 'start' ? candidates.at(-1) ?? 0 : candidates[0] ?? 0
}

function plainFormattingRanges(model: PhraseFormatting): InlineFormatRange[] {
  return model.ranges.map(range => ({ ...range, start: formattingTextOffset(model, range.start), end: formattingTextOffset(model, range.end) }))
}

function serializeFormatting(text: string, ranges: readonly InlineFormatRange[]): string {
  const boundaries = [...new Set([0, text.length, ...ranges.flatMap(range => [range.start, range.end])])].sort((a, b) => a - b)
  let raw = '', active = ''
  for (let index = 0; index < boundaries.length - 1; index++) {
    const start = boundaries[index]!, end = boundaries[index + 1]!
    const flags = (['b', 'i', 'u'] as const).filter(flag => ranges.some(range => range.start <= start && range.end >= end && range.flags.includes(flag))).join('')
    if (flags !== active) { if (active) raw += `<${active}}`; if (flags) raw += `{${flags}>`; active = flags }
    raw += text.slice(start, end)
  }
  return raw + (active ? `<${active}}` : '')
}

export function phraseFormatSelection(model: PhraseFormatting, selection: InlineSelection, flag: PhraseFormatFlag): boolean | 'mixed' {
  const start = formattingTextOffset(model, selection.start), end = formattingTextOffset(model, selection.end)
  const ranges = plainFormattingRanges(model).filter(range => range.flags.includes(flag) && range.start < end && range.end > start)
  let covered = start
  for (const range of ranges) if (range.start <= covered) covered = Math.max(covered, range.end)
  return start !== end && covered >= end ? true : ranges.length > 0 ? 'mixed' : false
}

export interface InlineFormatEdit { value: string; selection: InlineSelection }
export function togglePhraseFormat(value: string, selection: InlineSelection, flag: PhraseFormatFlag, formatId: string | undefined, tokens: readonly InlineToken[]): InlineFormatEdit | undefined {
  const model = phraseFormatting(value, formatId, tokens)
  if (!model.supported || !model.valid) return undefined
  const start = formattingTextOffset(model, selection.start), end = formattingTextOffset(model, selection.end)
  if (start === end) return undefined
  const ranges = plainFormattingRanges(model), remove = phraseFormatSelection(model, selection, flag) === true
  const next: InlineFormatRange[] = remove ? ranges.flatMap(range => [
    ...(range.start < start ? [{ ...range, end: Math.min(start, range.end) }] : []),
    ...(range.end > start && range.start < end ? [{ start: Math.max(start, range.start), end: Math.min(end, range.end), flags: range.flags.filter(item => item !== flag) }] : []),
    ...(range.end > end ? [{ ...range, start: Math.max(end, range.start) }] : []),
  ]) : [...ranges, { start, end, flags: [flag] }]
  const raw = serializeFormatting(model.text, next), updated = phraseFormatting(raw, formatId)
  return { value: raw, selection: { start: formattingRawOffset(updated, start, 'start'), end: formattingRawOffset(updated, end, 'end'), backward: selection.backward } }
}

/** Rich-view text edits operate on visible text while retaining the surrounding style. */
export function replacePhraseFormattedText(value: string, selection: InlineSelection, replacement: string, formatId: string | undefined, tokens: readonly InlineToken[]): InlineFormatEdit | undefined {
  const model = phraseFormatting(value, formatId, tokens), inserted = phraseFormatting(replacement, formatId)
  if (!model.supported || !model.valid || !inserted.valid) return undefined
  const start = formattingTextOffset(model, selection.start), end = formattingTextOffset(model, selection.end)
  if (start === end && replacement === '') return { value, selection }
  const delta = inserted.text.length - (end - start)
  const inherit = model.ranges.find(range => range.start <= selection.start && range.end >= selection.start)?.flags ?? []
  const ranges = plainFormattingRanges(model).flatMap(range => [
    ...(range.start < start ? [{ ...range, end: Math.min(range.end, start) }] : []),
    ...(range.end > end ? [{ ...range, start: Math.max(range.start, end) + delta, end: range.end + delta }] : []),
  ])
  ranges.push({ start, end: start + inserted.text.length, flags: inherit }, ...plainFormattingRanges(inserted).map(range => ({ ...range, start: start + range.start, end: start + range.end })))
  const raw = serializeFormatting(model.text.slice(0, start) + inserted.text + model.text.slice(end), ranges)
  const updated = phraseFormatting(raw, formatId), at = formattingRawOffset(updated, start + inserted.text.length, 'end')
  return { value: raw, selection: { start: at, end: at } }
}

/** Split text at both annotation and presentation boundaries; never split chips. */
export function annotatedTextRuns(text: string, start: number, annotations: readonly InlineAnnotation[] = [], formatting: readonly InlineFormatRange[] = [], codes: readonly InlineFormatCode[] = []): Array<{ raw: string; start: number; annotations: readonly InlineAnnotation[]; flags: readonly PhraseFormatFlag[]; formatCode: boolean }> {
  const end = start + text.length
  const relevant = annotations.filter(annotation => annotation.start < end && annotation.end > start).map(annotation => ({ ...annotation,
    start: start + unicodeBoundary(text, annotation.start - start, false),
    end: start + unicodeBoundary(text, annotation.end - start, true),
  }))
  const decorations = formatting.filter(range => range.start < end && range.end > start)
  const formatCodes = codes.filter(code => code.start < end && code.end > start)
  const boundaries = [...new Set([start, end, ...[...relevant, ...decorations, ...formatCodes].flatMap(range => [Math.max(start, range.start), Math.min(end, range.end)])])].sort((a, b) => a - b)
  return boundaries.slice(0, -1).map((at, index) => ({ raw: text.slice(at - start, boundaries[index + 1]! - start), start: at,
    annotations: relevant.filter(annotation => annotation.start <= at && annotation.end >= boundaries[index + 1]!),
    flags: decorations.find(range => range.start <= at && range.end >= boundaries[index + 1]!)?.flags ?? [],
    formatCode: formatCodes.some(code => code.start <= at && code.end >= boundaries[index + 1]!) }))
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
/** Rich-view clipboard text carries balanced native styles; code view copies exact raw. */
export function inlineSelectionText(root: HTMLElement, selection: InlineSelection): string {
  const { text, spans } = mapInlineDom(root)
  const raw = text.slice(selection.start, selection.end)
  if (root.getAttribute('data-inline-format-view') !== 'rich' || selection.start === 0 && selection.end === text.length) return raw
  const opaque = [...spans].filter(([node, span]) => span.atomic && !(node as Element).hasAttribute('data-inline-format-code'))
    .map(([, span]) => ({ kind: 'tag' as const, start: span.start, end: span.end }))
  const model = phraseFormatting(text, root.getAttribute('data-inline-format-id') ?? undefined, opaque)
  if (!model.supported || !model.valid) return raw
  const start = formattingTextOffset(model, selection.start), end = formattingTextOffset(model, selection.end)
  const ranges = plainFormattingRanges(model).filter(range => range.start < end && range.end > start)
    .map(range => ({ ...range, start: Math.max(start, range.start) - start, end: Math.min(end, range.end) - start }))
  return serializeFormatting(model.text.slice(start, end), ranges)
}
export function copyInlineSelection(root: HTMLElement, event: { clipboardData: DataTransfer; preventDefault(): void }): void {
  const selection = root.ownerDocument.getSelection()
  if (!selection || selection.isCollapsed || selection.rangeCount === 0) return
  const own = inlineDomSelection(root, selection)
  // cloneContents also retains data-inline-raw when a selection crosses two inline views.
  const raw = own ? inlineSelectionText(root, own)
    : readInlineDomText(selection.getRangeAt(0).cloneContents())
  event.clipboardData.setData('text/plain', raw)
  event.preventDefault()
}
