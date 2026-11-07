/** Read-only CAT assistance. All ranges are raw JS UTF-16 offsets; no edits or QA verdicts. */
import { scanTags, type TagToken } from '@linguist/cat-core'
import type { LinguistTagProfileInfo, LinguistTechConstraintInfo, LinguistTermMatchInfo } from '@linguist/domain-service/contracts'

export interface AssistRange { start: number; end: number }
export interface AssistIssue extends AssistRange {
  id: string
  kind: 'term' | 'number' | 'variable' | 'length' | 'unicode'
  side: 'source' | 'target'
  code: string
  message: string
  messageKey: string
  values: Record<string, string | number>
  severity: 'info' | 'warning'
  termId?: string
}
export interface TermAssistance {
  /** The actual Host match, including its raw source range. Never rematched on the Client. */
  match: LinguistTermMatchInfo
  state: 'present' | 'missing' | 'forbidden' | 'conflict' | 'review'
  targetRanges: AssistRange[]
}
export type LengthUnit = 'code-points' | 'graphemes' | 'utf8-bytes' | 'lines'
export interface LengthConstraint {
  id: string
  unit: LengthUnit
  min?: number
  max?: number
}
export interface InvalidLengthConstraint { id: string; reason: string }
export interface VisibleCounts {
  codePoints: number
  graphemes: number
  utf8Bytes: number
  lines: number
  /** Dynamic placeholders are excluded, not expanded into invented display lengths. */
  hasPlaceholders: boolean
  /** ICU rendering is not inferred by this literal-text helper. */
  hasIcu: boolean
}
export interface SegmentAssistanceInput {
  source: string
  target: string
  termMatches?: readonly LinguistTermMatchInfo[]
  tagProfile?: LinguistTagProfileInfo
  meta?: Readonly<Record<string, unknown>>
  constraints?: readonly LinguistTechConstraintInfo[]
  assetId?: string
  sourceLocale?: string
  targetLocale?: string
}
export interface NumberCorrespondence {
  id: string
  kind: 'number'
  source: AssistRange
  target: AssistRange[]
  label: string
  uncertain: boolean
}
export interface SegmentAssistance {
  terms: TermAssistance[]
  numberPairs: NumberCorrespondence[]
  issues: AssistIssue[]
  length: {
    constraints: LengthConstraint[]
    invalidConstraints: InvalidLengthConstraint[]
    source: VisibleCounts
    target: VisibleCounts
  }
}

function makeIssue(
  kind: AssistIssue['kind'], side: AssistIssue['side'], range: AssistRange, code: string,
  messageKey: string, values: Record<string, string | number> = {},
  severity: AssistIssue['severity'] = 'info', termId?: string,
): AssistIssue {
  return {
    start: range.start, end: range.end, kind, side, code, messageKey, values, severity,
    id: `${kind}:${side}:${range.start}:${range.end}:${code}:${termId ?? ''}`,
    message: messageKey.replace(/\{(\w+)\}/g, (literal, name: string) => String(values[name] ?? literal)),
    ...(termId === undefined ? {} : { termId }),
  }
}

const hasIcu = (text: string) => /\{[^{}]+,\s*(?:plural|select|selectordinal|number|date|time)\b/iu.test(text)
interface Projection { text: string; positions: number[]; tags: TagToken[] }
function project(text: string, profile?: LinguistTagProfileInfo, locale?: string, separatePlaceholders = true): Projection {
  const tags = scanTags(text, { profile, targetLocale: locale })
  const pieces: string[] = []
  const positions: number[] = []
  let cursor = 0
  for (const tag of tags) {
    pieces.push(text.slice(cursor, tag.start))
    for (let index = cursor; index < tag.start; index += 1) positions.push(index)
    // A variable is an unknown runtime value, not an empty string joining two words.
    if (separatePlaceholders && tag.group === 'placeholder') {
      pieces.push('\ufffc')
      positions.push(tag.start)
    }
    cursor = tag.end
  }
  pieces.push(text.slice(cursor))
  for (let index = cursor; index < text.length; index += 1) positions.push(index)
  return { text: pieces.join(''), positions, tags }
}
function rawRanges(projection: Projection, start: number, end: number): AssistRange[] {
  const ranges: AssistRange[] = []
  for (let index = start; index < end; index += 1) {
    const raw = projection.positions[index]
    const last = ranges.at(-1)
    if (last && last.end === raw) last.end += 1
    else ranges.push({ start: raw, end: raw + 1 })
  }
  return ranges
}
function wholeRange(projection: Projection, start: number, end: number): AssistRange {
  return { start: projection.positions[start], end: projection.positions[end - 1] + 1 }
}
const escapeRegex = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
// CJK text is not space-delimited; Latin/Greek/Cyrillic words must not match inside other words.
const wordChar = (text: string) => /[\p{Script=Latin}\p{Script=Greek}\p{Script=Cyrillic}\p{N}\p{M}_]/u.test(text)
function findTerm(projection: Projection, translation: string, caseSensitive: boolean): AssistRange[] {
  if (!translation.trim()) return []
  const pattern = new RegExp(escapeRegex(translation), caseSensitive ? 'gu' : 'giu')
  const ranges: AssistRange[] = []
  for (const found of projection.text.matchAll(pattern)) {
    const start = found.index
    const end = start + found[0].length
    const before = [...projection.text.slice(Math.max(0, start - 2), start)].at(-1) ?? ''
    const after = [...projection.text.slice(end, end + 2)][0] ?? ''
    if (wordChar([...translation][0]) && wordChar(before)) continue
    if (wordChar([...translation].at(-1)!) && wordChar(after)) continue
    ranges.push(...rawRanges(projection, start, end))
  }
  return ranges
}
/** Only simple English plural/past/progressive candidates; never a stemming verdict. */
function inflectedTranslations(translation: string): string[] {
  const found = /\b([a-z]{3,})$/i.exec(translation)
  if (!found) return []
  const word = found[1]
  const prefix = translation.slice(0, found.index)
  const plural = /[^aeiou]y$/i.test(word) ? `${word.slice(0, -1)}ies`
    : /(?:s|x|z|ch|sh)$/i.test(word) ? `${word}es` : `${word}s`
  const past = /[^aeiou]y$/i.test(word) ? `${word.slice(0, -1)}ied` : `${word}${/e$/i.test(word) ? 'd' : 'ed'}`
  const progressive = /[^e]e$/i.test(word) ? `${word.slice(0, -1)}ing` : `${word}ing`
  return [plural, past, progressive].map(value => prefix + value)
}
function uniqueRanges(ranges: readonly AssistRange[]): AssistRange[] {
  return [...new Map(ranges.map(range => [`${range.start}:${range.end}`, range])).values()]
    .sort((left, right) => left.start - right.start || left.end - right.end)
}

export function analyzeTerms(
  matches: readonly LinguistTermMatchInfo[], target: string, tagProfile?: LinguistTagProfileInfo, targetLocale?: string,
): TermAssistance[] {
  const projection = project(target, tagProfile, targetLocale)
  const coverage = matches.map(match => ({
    exact: findTerm(projection, match.translation, match.caseSensitive),
    inflected: uniqueRanges(inflectedTranslations(match.translation).flatMap(value => findTerm(projection, value, match.caseSensitive))),
  }))
  // Multiple approved translations of this actual source occurrence are alternatives, not cumulative requirements.
  const groups = new Map<string, { exact: AssistRange[]; inflected: AssistRange[] }>()
  matches.forEach((match, index) => {
    if (match.status === 'forbidden' || match.status === 'deprecated') return
    const key = `${match.start}:${match.end}`
    const group = groups.get(key) ?? { exact: [], inflected: [] }
    group.exact.push(...coverage[index].exact)
    group.inflected.push(...coverage[index].inflected)
    groups.set(key, group)
  })
  return matches.map((match, index) => {
    const prohibited = match.status === 'forbidden' || match.status === 'deprecated'
    const own = coverage[index]
    const group = prohibited ? own : groups.get(`${match.start}:${match.end}`)!
    const exact = uniqueRanges(group.exact)
    const inflected = uniqueRanges(group.inflected)
    const targetRanges = exact.length ? exact : inflected
    const state: TermAssistance['state'] = match.conflict ? 'conflict'
      : match.lowDiscrimination ? 'review'
      : prohibited ? own.exact.length ? 'forbidden' : own.inflected.length ? 'review' : 'present'
      : exact.length ? 'present' : inflected.length ? 'review' : 'missing'
    return { match, state, targetRanges }
  })
}

const lengthUnits: readonly LengthUnit[] = ['code-points', 'graphemes', 'utf8-bytes', 'lines']
function decodeLength(value: unknown, id: string): { constraints: LengthConstraint[]; invalidConstraints: InvalidLengthConstraint[] } {
  let decoded = value
  const invalid = (reason: string) => ({ constraints: [], invalidConstraints: [{ id, reason }] })
  if (typeof value === 'string') {
    try { decoded = JSON.parse(value) } catch { return invalid('长度约束不是有效 JSON') }
  }
  const constraints: LengthConstraint[] = []
  const invalidConstraints: InvalidLengthConstraint[] = []
  const entries = Array.isArray(decoded) ? decoded : [decoded]
  if (!entries.length) return invalid('长度约束数组为空')
  entries.forEach((entry: unknown, index: number) => {
    const entryId = entries.length === 1 ? id : `${id}:${index}`
    const reject = (reason: string) => invalidConstraints.push({ id: entryId, reason })
    if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) { reject('长度约束必须是对象'); return }
    const object = entry as Record<string, unknown>
    if (!lengthUnits.includes(object.unit as LengthUnit)) { reject('长度约束需显式指定 unit：code-points / graphemes / utf8-bytes / lines'); return }
    // Existing technical constraints store JSON verbatim; maximum/minimum occur in current synthetic fixtures.
    if ((object.min !== undefined && object.minimum !== undefined && object.min !== object.minimum)
      || (object.max !== undefined && object.maximum !== undefined && object.max !== object.maximum)) {
      reject('长度约束的上下限字段互相矛盾'); return
    }
    const min = object.min !== undefined ? object.min : object.minimum
    const max = object.max !== undefined ? object.max : object.maximum
    if ((min === undefined && max === undefined)
      || (min !== undefined && (typeof min !== 'number' || !Number.isSafeInteger(min) || min < 0))
      || (max !== undefined && (typeof max !== 'number' || !Number.isSafeInteger(max) || max < 0))
      || (typeof min === 'number' && typeof max === 'number' && min > max)) {
      reject('长度约束的 min/max 必须为有效的非负整数范围'); return
    }
    // Unknown measurement/side controls must not silently turn a per-line/source rule into a total target rule.
    if (Object.keys(object).some(key => !['unit', 'min', 'max', 'minimum', 'maximum'].includes(key))) {
      reject('长度约束包含未支持字段，需核实计数范围'); return
    }
    constraints.push({ id: entryId, unit: object.unit as LengthUnit,
      ...(min === undefined ? {} : { min: min as number }), ...(max === undefined ? {} : { max: max as number }) })
  })
  return { constraints, invalidConstraints }
}
/**
 * Explicit opt-in metadata contract (not guessed from notes/maxLen):
 * context.meta.lengthConstraints = JSON object or array of {unit, min?, max?}.
 * Units: code-points | graphemes | utf8-bytes | lines; counts are target visible literals.
 * Current format importers do not populate length aliases. Invalid constraints are explained by the wrapper.
 */
export function parseLengthConstraints(meta?: Readonly<Record<string, unknown>>): LengthConstraint[] {
  return meta?.lengthConstraints === undefined ? [] : decodeLength(meta.lengthConstraints, 'meta:lengthConstraints').constraints
}
const graphemeSegmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' })
export function summarizeVisibleCounts(text: string, tagProfile?: LinguistTagProfileInfo, targetLocale?: string): VisibleCounts {
  const projection = project(text, tagProfile, targetLocale, false)
  return {
    codePoints: [...projection.text].length,
    graphemes: [...graphemeSegmenter.segment(projection.text)].length,
    utf8Bytes: new TextEncoder().encode(projection.text).byteLength,
    lines: projection.text.length === 0 ? 0 : projection.text.split(/\r\n|\r|\n/u).length,
    hasPlaceholders: projection.tags.some(tag => tag.group === 'placeholder'),
    hasIcu: hasIcu(projection.text),
  }
}

interface NumberToken extends AssistRange { text: string; key: string; uncertain: boolean; unit: string; currency: string; ranges: AssistRange[] }
const digits = '0-9٠-٩۰-۹０-９'
const numberPattern = new RegExp(`(?:[+\\-−＋－][ \\t]*)?[${digits}]+(?:[.,．，٫٬'’\\u00a0\\u202f][${digits}]+| [${digits}]{3}(?![${digits}]))*`, 'gu')
const currencyPattern = '(?:US\\$|CA\\$|A\\$|USD|EUR|GBP|JPY|CNY|RMB|CAD|AUD|CHF|[\\p{Sc}])'
const currencyPrefix = new RegExp(`([+\\-−＋－]?[ \\t]*${currencyPattern}[ \\t]*[+\\-−＋－]?)$`, 'u')
const currencySuffix = new RegExp(`^[ \\t]*(${currencyPattern})(?![A-Za-z])`, 'u')
const unitAliases: Record<string, string> = {
  '%': '%', '％': '%', '٪': '%', '‰': '‰', '‱': '‱',
  '°C': '°C', '℃': '°C', '摄氏度': '°C', '°F': '°F', '℉': '°F', '华氏度': '°F',
  'kg': 'kg', 'kilograms': 'kg', 'kilogram': 'kg', '千克': 'kg', '公斤': 'kg',
  'mg': 'mg', '毫克': 'mg', 'g': 'g', 'grams': 'g', 'gram': 'g', '克': 'g',
  'km/h': 'km/h', 'm/s': 'm/s', 'km': 'km', 'kilometers': 'km', 'kilometres': 'km', '公里': 'km', '千米': 'km',
  'cm': 'cm', '厘米': 'cm', 'mm': 'mm', '毫米': 'mm', 'm': 'm', 'meters': 'm', 'metres': 'm', '米': 'm',
  'ms': 'ms', 'milliseconds': 'ms', '毫秒': 'ms', 's': 's', 'seconds': 's', 'second': 's', '秒': 's',
  'min': 'min', 'minutes': 'min', 'minute': 'min', '分钟': 'min', 'h': 'h', 'hours': 'h', 'hour': 'h', '小时': 'h',
  'Hz': 'Hz', 'kHz': 'kHz', 'MHz': 'MHz', 'GB': 'GB', 'MB': 'MB', 'KB': 'KB', 'GiB': 'GiB', 'MiB': 'MiB', 'KiB': 'KiB',
  'HP': 'HP', 'MP': 'MP', 'XP': 'XP', 'AP': 'AP',
}
const unitPattern = new RegExp(`^[ \\t\\u00a0\\u202f]*(${Object.keys(unitAliases).sort((a, b) => b.length - a.length).map(escapeRegex).join('|')})(?![A-Za-z])`, 'u')
function asciiNumber(text: string): string {
  return text.normalize('NFKC').replace(/[٠-٩۰-۹]/gu, value => String(value.charCodeAt(0) - (value <= '٩' ? 0x660 : 0x6f0)))
    .replace(/−/g, '-').replace(/’/g, "'").replace(/[\u00a0\u202f]/g, ' ')
}
function decimalKey(integer: string, fraction = '', sign = ''): string {
  const whole = integer.replace(/^0+(?=\d)/, '')
  const decimal = fraction.replace(/0+$/, '')
  return `${whole === '0' && !decimal && sign === '-' ? '' : sign}${whole}${decimal ? `.${decimal}` : ''}`
}
function normalizedNumber(raw: string, locale?: string): { key: string; uncertain: boolean } {
  const text = asciiNumber(raw).replace(/^([+-])[ \t]+/u, '$1')
  const sign = /^[+-]/.exec(text)?.[0] ?? ''
  const unsigned = text.slice(sign.length)
  let decimal: string | undefined
  let group: string | undefined
  if (locale) {
    try {
      const parts = new Intl.NumberFormat(locale).formatToParts(12345.6)
      decimal = asciiNumber(parts.find(part => part.type === 'decimal')?.value ?? '.')
      group = asciiNumber(parts.find(part => part.type === 'group')?.value ?? ',')
    } catch { return { key: text, uncertain: true } }
  }
  // Plain spaces may separate independent values. Only an explicit space-grouping locale resolves that ambiguity.
  if (new RegExp(`[${digits}] [${digits}]`, 'u').test(raw) && group !== ' ') return { key: text, uncertain: true }
  const canonical = (whole: string, fraction = '') => ({ key: decimalKey(whole, fraction, sign), uncertain: false })
  const grouped = (value: string, separator: string) => new RegExp(`^\\d{1,3}(?:${escapeRegex(separator)}\\d{3})+$`).test(value)
  const whole = (value: string): string | undefined => {
    if (/^\d+$/.test(value)) return value
    for (const separator of [group, ' ', "'", '٬']) {
      if (separator && grouped(value, separator)) return value.split(separator).join('')
    }
    return undefined
  }
  if (/^\d+$/.test(unsigned)) return canonical(unsigned)
  if (decimal !== undefined) {
    const parts = unsigned.split(decimal)
    const integer = whole(parts[0])
    if (parts.length <= 2 && integer !== undefined && (parts.length === 1 || /^\d+$/.test(parts[1]))) return canonical(integer, parts[1])
    return { key: text, uncertain: true }
  }
  for (const separator of [' ', "'", '٬']) if (grouped(unsigned, separator)) return canonical(unsigned.split(separator).join(''))
  // Mixed decimal/group punctuation is unambiguous only with valid triple grouping before the last separator.
  for (const separator of [',', '.', '٫']) {
    const at = unsigned.lastIndexOf(separator)
    if (at < 0) continue
    const left = unsigned.slice(0, at)
    const right = unsigned.slice(at + 1)
    if (!/^\d+$/.test(right)) continue
    if (/^\d+$/.test(left)) {
      if (right.length !== 3 || separator === '٫') return canonical(left, right)
      return { key: text, uncertain: true } // 1,234 / 1.234: locale required.
    }
    for (const grouping of [',', '.', ' ', "'", '٬']) {
      if (grouping !== separator && grouped(left, grouping)) return canonical(left.split(grouping).join(''), right)
    }
  }
  for (const separator of [',', '.']) {
    if (unsigned.split(separator).length > 2 && grouped(unsigned, separator)) return canonical(unsigned.split(separator).join(''))
  }
  return { key: text, uncertain: true }
}
function normalizeCurrency(value: string): string {
  return ({ 'US$': 'USD', 'CA$': 'CAD', 'A$': 'AUD', 'RMB': 'CNY', '￥': '¥' } as Record<string, string>)[value] ?? value
}
function numbers(text: string, profile?: LinguistTagProfileInfo, locale?: string, targetLocale?: string): NumberToken[] {
  const projection = project(text, profile, targetLocale)
  const result: NumberToken[] = []
  let consumed = 0
  for (const found of projection.text.matchAll(numberPattern)) {
    let start = found.index
    let end = start + found[0].length
    if (start < consumed) continue
    const prefix = currencyPrefix.exec(projection.text.slice(0, start))
    let currency = ''
    let numeric = found[0]
    if (prefix) {
      start -= prefix[0].length
      const symbol = new RegExp(currencyPattern, 'u').exec(prefix[0])!
      currency = normalizeCurrency(symbol[0])
      const sign = /[+\-−＋－]/u.exec(prefix[0])?.[0]
      if (sign && !/^[+\-−＋－]/u.test(numeric)) numeric = sign + numeric
    }
    if (/[A-Za-z_]/u.test(projection.text[start - 1] ?? '')) continue
    const suffix = currencySuffix.exec(projection.text.slice(end))
    if (suffix && !currency) { currency = normalizeCurrency(suffix[1]); end += suffix[0].length }
    const unitMatch = unitPattern.exec(projection.text.slice(end))
    const unit = unitMatch ? unitAliases[unitMatch[1]] : ''
    if (unitMatch) end += unitMatch[0].length
    const normalized = normalizedNumber(numeric, locale)
    const around = projection.text.slice(Math.max(0, start - 1), end + 1)
    const structured = /\d[-/:]\d|\d\.\d\./u.test(around)
      || (!unit && /^[A-Za-z_]/u.test(projection.text[end] ?? ''))
    const raw = projection.text.slice(start, end)
    result.push({ ...wholeRange(projection, start, end), text: raw, key: `${normalized.key}|${currency}|${unit}`,
      uncertain: normalized.uncertain || structured, unit, currency, ranges: rawRanges(projection, start, end) })
    consumed = end
  }
  return result
}
function possibleNumberKeys(token: NumberToken): string[] {
  const [number, currency, unit] = token.key.split('|')
  const found = token.uncertain ? /^([+-]?)(\d{1,3})[.,](\d{3})$/u.exec(number) : null
  return found ? [token.key, `${decimalKey(found[2] + found[3], '', found[1])}|${currency}|${unit}`,
    `${decimalKey(found[2], found[3], found[1])}|${currency}|${unit}`] : [token.key]
}
function numberAnalysis(input: SegmentAssistanceInput): { issues: AssistIssue[]; numberPairs: NumberCorrespondence[] } {
  if (hasIcu(project(input.source, input.tagProfile, input.targetLocale).text)
    || hasIcu(project(input.target, input.tagProfile, input.targetLocale).text)) return { numberPairs: [], issues: [makeIssue('number', 'source', { start: 0, end: 0 }, 'number.icu',
    'ICU 的分支与数值格式需按运行结构复核；此处不把分支编号当作普通数字比较')] }
  const source = numbers(input.source, input.tagProfile, input.sourceLocale, input.targetLocale)
  const target = numbers(input.target, input.tagProfile, input.targetLocale, input.targetLocale)
  const unused = new Set(target.map((_, index) => index))
  // Reserve exact matches first: an ambiguous candidate must not steal a later certain occurrence.
  const matched = source.map(token => {
    const index = [...unused].find(index => token.key === target[index].key)
    if (index !== undefined) unused.delete(index)
    return index
  })
  const reviewMatches = new Set<number>()
  source.forEach((token, sourceIndex) => {
    if (matched[sourceIndex] !== undefined) return
    const options = possibleNumberKeys(token)
    const index = [...unused].find(index => possibleNumberKeys(target[index]).some(key => options.includes(key)))
    if (index !== undefined) {
      matched[sourceIndex] = index
      unused.delete(index)
      reviewMatches.add(sourceIndex)
    }
  })
  const numberPairs: NumberCorrespondence[] = source.map((token, index) => {
    const found = matched[index] === undefined ? undefined : target[matched[index]!]
    return { id: `number:${token.start}:${token.end}`, kind: 'number',
      source: { start: token.start, end: token.end }, target: found ? found.ranges : [],
      label: token.text, uncertain: token.uncertain || !!found?.uncertain || reviewMatches.has(index) }
  })
  const issues: AssistIssue[] = []
  const seen = new Set<string>()
  source.forEach((token, index) => {
    if (matched[index] !== undefined && !reviewMatches.has(index)) return
    if (seen.has(token.key)) return
    seen.add(token.key)
    const review = reviewMatches.has(index) || token.uncertain || [...unused].some(index => target[index].uncertain
      || target[index].unit !== token.unit || target[index].currency !== token.currency)
    issues.push(makeIssue('number', 'source', token, review ? 'number.review' : 'number.missing',
      review ? '数字／单位“{value}”的对应关系不确定，请核实本地格式、换算与上下文'
        : '未识别到数字／单位“{value}”的等量对应（源文 {sourceCount} 处，译文 {targetCount} 处），请复核',
      { value: token.text, sourceCount: source.filter(item => item.key === token.key).length,
        targetCount: target.filter(item => item.key === token.key).length }, review ? 'info' : 'warning'))
  })
  seen.clear()
  for (const index of unused) {
    const token = target[index]
    if (seen.has(token.key)) continue
    seen.add(token.key)
    issues.push(makeIssue('number', 'target', token, 'number.extra', '译文中的数字／单位“{value}”未找到等量源文对应，请结合改写与换算复核', { value: token.text }))
  }
  return { issues, numberPairs }
}

interface VariableToken extends AssistRange { text: string; key: string; uncertain: boolean }
function variables(text: string, profile?: LinguistTagProfileInfo, locale?: string): VariableToken[] {
  let position = 0
  return scanTags(text, { profile, targetLocale: locale }).filter(tag => tag.group === 'placeholder' && text.slice(tag.start, tag.end) !== '%%').map(tag => {
    const literal = text.slice(tag.start, tag.end)
    const printf = tag.familyId === 'printf' ? /^%(?:(\d+)\$)?(.*)$/u.exec(literal)! : null
    const key = printf ? `printf:${printf[1] ?? ++position}:${printf[2]}` : literal
    return { start: tag.start, end: tag.end, text: literal, key, uncertain: !!printf && printf[2].includes('*') }
  })
}
function variableIssues(input: SegmentAssistanceInput): AssistIssue[] {
  if (hasIcu(project(input.source, input.tagProfile, input.targetLocale).text)
    || hasIcu(project(input.target, input.tagProfile, input.targetLocale).text)) return [makeIssue('variable', 'source', { start: 0, end: 0 }, 'variable.icu',
    'ICU 变量及分支交由既有结构校验；此处不按普通占位符数量判错')]
  const source = variables(input.source, input.tagProfile, input.targetLocale)
  const target = variables(input.target, input.tagProfile, input.targetLocale)
  const issues: AssistIssue[] = []
  const keys = new Set([...source, ...target].map(token => token.key))
  for (const key of keys) {
    const from = source.filter(token => token.key === key)
    const to = target.filter(token => token.key === key)
    if (from.length === to.length) continue
    const side = from.length > to.length ? 'source' : 'target'
    const token = side === 'source' ? from[to.length] : to[from.length]
    const uncertain = [...source, ...target].some(item => item.uncertain)
    issues.push(makeIssue('variable', side, token, uncertain ? 'variable.review' : 'variable.count',
      uncertain ? '变量“{value}”涉及动态 printf 宽度／精度，参数对应需按运行格式复核'
        : '变量“{value}”出现次数不同：源文 {sourceCount}，译文 {targetCount}；请复核，不会自动替换',
      { value: token.text, sourceCount: from.length, targetCount: to.length }, uncertain ? 'info' : 'warning'))
  }
  return issues
}

function unicodeIssues(text: string, side: AssistIssue['side'], profile?: LinguistTagProfileInfo, targetLocale?: string): AssistIssue[] {
  const projection = project(text, profile, targetLocale)
  const issues: AssistIssue[] = []
  for (let index = 0; index < projection.text.length;) {
    const code = projection.text.codePointAt(index)!
    const character = String.fromCodePoint(code)
    const range = wholeRange(projection, index, index + character.length)
    const value = `U+${code.toString(16).toUpperCase().padStart(4, '0')}`
    if (/[\u061c\u200e\u200f\u202a-\u202e\u2066-\u2069]/u.test(character)) {
      issues.push(makeIssue('unicode', side, range, 'unicode.bidi', '发现双向文字控制符 {value}；它可能影响显示顺序，请结合语言和原稿检查，勿自动删除', { value }))
    } else if (/[\u00ad\u034f\u200b-\u200d\u2060\ufeff]/u.test(character)) {
      const before = projection.text.slice(0, index).replace(/[\ufe0e\ufe0f\p{Emoji_Modifier}]+$/u, '')
      const emojiJoiner = code === 0x200d && /\p{Extended_Pictographic}$/u.test(before)
        && /^\p{Extended_Pictographic}/u.test(projection.text.slice(index + 1))
      if (!emojiJoiner) issues.push(makeIssue('unicode', side, range, 'unicode.invisible', '发现不可见格式字符 {value}；断词、连写或排版可能有意使用，请检查而非自动删除', { value }))
    } else if ((code < 0x20 && ![0x09, 0x0a, 0x0d].includes(code)) || (code >= 0xd800 && code <= 0xdfff) || code === 0x7f) {
      issues.push(makeIssue('unicode', side, range, 'unicode.control', '发现控制字符或未配对代理项 {value}，请检查原始编码与用途', { value }))
    }
    index += character.length
  }
  return issues
}

export function analyzeSegmentAssistance(input: SegmentAssistanceInput): SegmentAssistance {
  const terms = analyzeTerms(input.termMatches ?? [], input.target, input.tagProfile, input.targetLocale)
  const issues: AssistIssue[] = []
  for (const { match, state, targetRanges } of terms) {
    if (state === 'present') continue
    const range = state === 'forbidden' ? targetRanges[0] : { start: match.start, end: match.end }
    const message = state === 'forbidden' ? '译文出现禁用／弃用术语“{translation}”，请复核项目要求'
      : state === 'conflict' ? '术语“{term}”存在项目冲突，需人工确认适用译法'
      : state === 'missing' ? '未在译文中识别到“{term}”的已准译法；词形变化、改写或语境可能合法，需复核'
      : '术语“{term}”涉及词形变化或低区分度匹配，仅供复核'
    const issue = makeIssue('term', state === 'forbidden' ? 'target' : 'source', range, `term.${state}`, message,
      { term: match.term, translation: match.translation }, state === 'forbidden' ? 'warning' : 'info', match.id)
    // A glossary ID repeats across source occurrences, including warnings pointing to the same target range.
    issues.push({ ...issue, id: `${issue.id}:${match.start}:${match.end}` })
  }
  const numeric = numberAnalysis(input)
  issues.push(...numeric.issues, ...variableIssues(input),
    ...unicodeIssues(input.source, 'source', input.tagProfile, input.targetLocale), ...unicodeIssues(input.target, 'target', input.tagProfile, input.targetLocale))
  const parsed = input.meta?.lengthConstraints === undefined ? { constraints: [], invalidConstraints: [] }
    : decodeLength(input.meta.lengthConstraints, 'meta:lengthConstraints')
  const constraints: LengthConstraint[] = [...parsed.constraints]
  const invalidConstraints: InvalidLengthConstraint[] = [...parsed.invalidConstraints]
  for (const constraint of input.constraints ?? []) {
    if (constraint.kind !== 'length') continue
    const scope = constraint.scope?.trim()
    if (scope && scope !== input.assetId && scope !== input.meta?.textType) continue
    const result = decodeLength(constraint.valueJson, constraint.id)
    constraints.push(...result.constraints)
    invalidConstraints.push(...result.invalidConstraints)
  }
  const source = summarizeVisibleCounts(input.source, input.tagProfile, input.targetLocale)
  const target = summarizeVisibleCounts(input.target, input.tagProfile, input.targetLocale)
  for (const invalid of invalidConstraints) {
    issues.push(makeIssue('length', 'target', { start: 0, end: 0 }, `length.invalid:${invalid.id}`,
      '显式长度约束未应用：{reason}', { reason: invalid.reason }))
  }
  const counters: Record<LengthUnit, number> = { 'code-points': target.codePoints, graphemes: target.graphemes, 'utf8-bytes': target.utf8Bytes, lines: target.lines }
  for (const constraint of constraints) {
    const count = counters[constraint.unit]
    if (target.hasIcu) {
      issues.push(makeIssue('length', 'target', { start: 0, end: 0 }, `length.dynamic:${constraint.id}`,
        'ICU 的最终显示长度取决于分支与运行参数，需按显式约束另行检查'))
    } else if ((constraint.max !== undefined && count > constraint.max) || (constraint.min !== undefined && count < constraint.min)) {
      const below = constraint.min !== undefined && count < constraint.min
      issues.push(makeIssue('length', 'target', { start: 0, end: 0 }, `length.${below ? 'min' : 'max'}:${constraint.id}`,
        target.hasPlaceholders ? '译文可见字面量为 {count} {unit}，约束为 {min}–{max}；动态变量显示长度需另行核实'
          : '译文可见长度为 {count} {unit}，不在显式约束 {min}–{max} 内',
        { count, unit: constraint.unit, min: constraint.min ?? 0, max: constraint.max ?? '∞' }, target.hasPlaceholders && below ? 'info' : 'warning'))
    }
  }
  return { terms, numberPairs: numeric.numberPairs, issues, length: { constraints, invalidConstraints, source, target } }
}
