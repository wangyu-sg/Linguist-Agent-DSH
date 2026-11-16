import { scanTagTokens } from './tag-families'

export interface TmAdaptation {
  status: 'adapted' | 'needs-review'
  candidate?: string
  replacements: Array<{ type: string; from: string; to: string }>
}

const placeables = /https?:\/\/[^\s<>]+|[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}|\$?\{[\w.:-]+\}|%(?:\d+\$)?[a-zA-Z]|\b\d{4}[-/]\d{1,2}[-/]\d{1,2}\b|\b\d{1,2}[-/]\d{1,2}[-/]\d{2,4}\b|\b\d{1,2}:\d{2}(?::\d{2})?\b|\d+(?:[.,]\d+)?\s?(?:kg|km|cm|mm|ms|mg|ml|°C|°F|%)(?![A-Za-z])|\d+(?:[.,]\d+)?|\b[A-Z]{2,}\b/gu

function kind(value: string): string {
  if (/^https?:/u.test(value)) return 'url'
  if (value.includes('@')) return 'email'
  if (/^(?:\$?\{|%)/u.test(value)) return 'variable'
  if (/^\d+[-/]\d+[-/]\d+$/u.test(value)) return 'date'
  if (/^\d+:\d+/u.test(value)) return 'time'
  if (/\d\s?(?:kg|km|cm|mm|ms|mg|ml|°C|°F|%)$/u.test(value)) return 'unit'
  return /^\d/u.test(value) ? 'number' : 'abbreviation'
}

function extract(text: string) {
  const markup = scanTagTokens(text).filter(token => token.group !== 'placeholder')
  return Array.from(text.matchAll(placeables), match => ({ text: match[0], start: match.index, end: match.index + match[0].length, type: kind(match[0]) }))
    .filter(item => !markup.some(tag => item.start < tag.end && item.end > tag.start))
}

/** Only replace exact, unique target tokens when source structure and ordering agree. */
export function adaptTmTarget(current: string, source: string, target: string): TmAdaptation | undefined {
  const markup = (text: string) => scanTagTokens(text).filter(token => token.group !== 'placeholder').map(token => text.slice(token.start, token.end))
  const uncertain: TmAdaptation = { status: 'needs-review', replacements: [] }
  if (JSON.stringify(markup(source)) !== JSON.stringify(markup(current))) return uncertain
  const old = extract(source), next = extract(current)
  const changed = old.length !== next.length || old.some((item, i) => item.text !== next[i]?.text || item.type !== next[i]?.type)
  if (!changed) return undefined
  if (old.length !== next.length || old.some((item, i) => item.type !== next[i]!.type)) return uncertain
  const mask = (text: string, items: ReturnType<typeof extract>) => {
    let result = '', offset = 0
    for (const item of items) { result += `${text.slice(offset, item.start)}\u0000${item.type}\u0000`; offset = item.end }
    return result + text.slice(offset)
  }
  if (mask(source, old) !== mask(current, next)) return uncertain
  const targetTokens = extract(target)
  const replacements: TmAdaptation['replacements'] = []
  const edits: Array<{ start: number; end: number; value: string }> = []
  for (let i = 0; i < old.length; i++) {
    const before = old[i]!, after = next[i]!
    if (before.text === after.text) continue
    const matches = targetTokens.filter(item => item.type === before.type && item.text === before.text)
    if (old.filter(item => item.type === before.type && item.text === before.text).length !== 1 || matches.length !== 1) return uncertain
    replacements.push({ type: before.type, from: before.text, to: after.text })
    edits.push({ start: matches[0]!.start, end: matches[0]!.end, value: after.text })
  }
  let candidate = target
  for (const edit of edits.sort((a, b) => b.start - a.start)) candidate = candidate.slice(0, edit.start) + edit.value + candidate.slice(edit.end)
  // Literal numeric mappings may denote a different concept or locale format in the target.
  return { status: replacements.some(item => ['number', 'date', 'time', 'unit'].includes(item.type)) ? 'needs-review' : 'adapted', candidate, replacements }
}
