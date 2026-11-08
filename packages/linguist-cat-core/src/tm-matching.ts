import { sha256Hex } from './hash'
import { scanTagTokens } from './tag-families'

/** The only match classes emitted by Segment Match. Concordance is separate. */
export type TmSegmentMatchClass =
  | 'double-context'
  | 'context'
  | 'exact'
  | 'near-exact'
  | 'fuzzy'

export type TmContextState = 'match' | 'mismatch' | 'unknown'
export type TmReuseSafety = 'compatible' | 'review' | 'incompatible'

export interface TmMatchContext {
  contextKey?: string
  previousSource?: string
  nextSource?: string
}

export interface TmMatchCandidate {
  unitId: string
  source: string
  target: string
  sourceLabel?: string
  sourcePriority?: number
  contextKey?: string
  previousSourceHash?: string
  nextSourceHash?: string
  originalTuid?: string
  metadata?: Record<string, string | string[]>
  sourceInline?: string
  targetInline?: string
}

export interface TmMatchDiagnostics extends Pick<TmMatchCandidate,
  'originalTuid' | 'metadata' | 'contextKey' | 'previousSourceHash' | 'nextSourceHash' | 'sourceInline' | 'targetInline'> {
  unitId: string
  matchClass: TmSegmentMatchClass
  displayScore: number
  matchedSource: string
  target: string
  sourceLabel: string
  sourcePriority: number
  provenanceCount: number
  variantCount: number
  context: {
    structural: TmContextState
    textFlow: TmContextState
  }
  structure: {
    safety: Exclude<TmReuseSafety, 'incompatible'>
    reasons: string[]
  }
  differences: string[]
}

export interface TmMatcherOptions {
  context?: TmMatchContext
  minimumScore?: number
}

export interface TmAgentEvidence extends Pick<TmMatchDiagnostics,
  'originalTuid' | 'metadata' | 'contextKey' | 'previousSourceHash' | 'nextSourceHash' | 'sourceInline' | 'targetInline'> {
  unitId: string
  matchClass: TmSegmentMatchClass
  score: number
  matchedSource: string
  target: string
  sourceLabel: string
  safety: 'compatible' | 'review'
  reasons: string[]
  ambiguous: boolean
}

const WORD_SEGMENTER = new Intl.Segmenter(undefined, { granularity: 'word' })

function normalizeTmText(value: string): string {
  return value
    .normalize('NFKC')
    .replace(/\r\n?/gu, '\n')
    .replace(/[\t\f\v ]+/gu, ' ')
    .trim()
    .toLocaleLowerCase()
}

function tokenize(value: string): string[] {
  return Array.from(WORD_SEGMENTER.segment(value), (part) => part.segment.trim())
    .filter((token) => token !== '')
}

function isCjk(value: string): boolean {
  return /[\u3040-\u30ff\u3400-\u9fff\uf900-\ufaff]/u.test(value)
}

function characterNgrams(characters: readonly string[]): Map<string, number> {
  const grams = new Map<string, number>()
  const size = characters.length > 1 ? 2 : 1
  for (let index = 0; index + size <= characters.length; index += 1) {
    const gram = characters.slice(index, index + size).join('')
    grams.set(gram, (grams.get(gram) ?? 0) + 1)
  }
  return grams
}

function multisetDice(left: Map<string, number>, right: Map<string, number>, leftTotal: number, rightTotal: number): number {
  let overlap = 0
  for (const [gram, count] of left) overlap += Math.min(count, right.get(gram) ?? 0)
  return leftTotal === 0 && rightTotal === 0
    ? 1
    : (2 * overlap) / (leftTotal + rightTotal)
}

function levenshteinSimilarity(left: readonly string[], right: readonly string[]): number {
  if (left.length === 0 && right.length === 0) return 1
  const previous = Array.from({ length: right.length + 1 }, (_, index) => index)
  for (let row = 1; row <= left.length; row += 1) {
    let diagonal = previous[0]!
    previous[0] = row
    for (let column = 1; column <= right.length; column += 1) {
      const above = previous[column]!
      previous[column] = left[row - 1] === right[column - 1]
        ? diagonal
        : 1 + Math.min(diagonal, above, previous[column - 1]!)
      diagonal = above
    }
  }
  return 1 - previous[right.length]! / Math.max(left.length, right.length)
}

function lengthPenalty(a: number, b: number): number {
  if (a === 0 && b === 0) return 1
  return Math.min(a, b) / Math.max(a, b)
}

const PLAIN_PLACEABLE_PATTERN = /\b\d+(?:[.,]\d+)?%?|https?:\/\/[^\s]+|[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}/giu

function extractPlaceables(value: string, tokens: ReturnType<typeof scanTagTokens>): string[] {
  const placeholders = value.match(PLAIN_PLACEABLE_PATTERN) ?? []
  return [...tokens.map((token) => token.signature).sort(), ...placeholders.map((item) => item.toLocaleLowerCase())]
}

function placeableMasked(value: string, tokens: ReturnType<typeof scanTagTokens>): string {
  let result = value
  for (const token of [...tokens].sort((left, right) => right.start - left.start)) {
    result = `${result.slice(0, token.start)}¤${result.slice(token.end)}`
  }
  return result.replace(PLAIN_PLACEABLE_PATTERN, '¤')
}

function punctuationMasked(masked: string): string {
  return masked
    .normalize('NFKC')
    .replace(/[^\p{L}\p{N}\s¤]/gu, '')
    .replace(/\s+/gu, ' ')
    .trim()
    .toLocaleLowerCase()
}

interface PreparedSourceFeatures {
  source: string
  normalized: string
  tokens: string[]
  grams: Map<string, number>
  gramCount: number
  characterCount: number
  masked: string
  rawMasked: string
  punctuationMasked: string
  placeableCount: number
  placeableKey: string
}

function prepareSource(source: string): PreparedSourceFeatures {
  const normalized = normalizeTmText(source)
  const rawTags = scanTagTokens(source)
  const normalizedTags = source === normalized ? rawTags : scanTagTokens(normalized)
  const rawMasked = placeableMasked(source, rawTags)
  const placeables = extractPlaceables(source, rawTags)
  const characters = Array.from(normalized)
  return {
    source, normalized, tokens: tokenize(normalized), grams: characterNgrams(characters),
    gramCount: characters.length > 1 ? characters.length - 1 : characters.length,
    characterCount: characters.length, masked: placeableMasked(normalized, normalizedTags), rawMasked,
    punctuationMasked: punctuationMasked(rawMasked), placeableCount: placeables.length, placeableKey: placeables.join('\u0000'),
  }
}

// Candidates belong to the Store's current corpus; releasing it also releases these features.
const preparedCandidates = new WeakMap<TmMatchCandidate, PreparedSourceFeatures>()
function prepareCandidate(candidate: TmMatchCandidate): PreparedSourceFeatures {
  const cached = preparedCandidates.get(candidate)
  if (cached !== undefined && cached.source === candidate.source) return cached
  const prepared = prepareSource(candidate.source)
  preparedCandidates.set(candidate, prepared)
  return prepared
}

function structuralSafety(left: PreparedSourceFeatures, right: PreparedSourceFeatures): { safety: TmReuseSafety; reasons: string[] } {
  if (left.placeableCount !== right.placeableCount) {
    return {
      safety: 'incompatible',
      reasons: ['Placeable 数量不一致'],
    }
  }
  if (left.placeableKey !== right.placeableKey) {
    return {
      safety: 'review',
      reasons: ['Placeable 或 Tag 值/映射发生变化'],
    }
  }
  return { safety: 'compatible', reasons: [] }
}

function differences(query: PreparedSourceFeatures, candidate: PreparedSourceFeatures): string[] {
  const result: string[] = []
  if (query.source !== candidate.source) {
    if (query.normalized === candidate.normalized) {
      if (query.source.replace(/\s+/gu, ' ') !== candidate.source.replace(/\s+/gu, ' ')) result.push('空白差异')
      if (query.source.toLocaleLowerCase() === candidate.source.toLocaleLowerCase()) result.push('大小写差异')
      if (result.length === 0) result.push('标点或格式差异')
    } else if (query.rawMasked === candidate.rawMasked) {
      result.push('可识别 Placeable 差异')
    } else {
      result.push('词汇或词序差异')
    }
  }
  return result
}

function contextState(expectedHash: string | undefined, actualHash: string | undefined): TmContextState {
  if (expectedHash === undefined || actualHash === undefined) return 'unknown'
  return expectedHash === actualHash ? 'match' : 'mismatch'
}

/** Exact lookup hash; context-only hashes omit locales because no pair is available. */
export function tmSourceHash(value: string, sourceLocale?: string, targetLocale?: string): string {
  const localePrefix = sourceLocale === undefined && targetLocale === undefined
    ? ''
    : `${sourceLocale ?? ''}\u0000${targetLocale ?? ''}\u0000`
  return sha256Hex(new TextEncoder().encode(`${localePrefix}${normalizeTmText(value)}`))
}

function isShortSegment(features: PreparedSourceFeatures): boolean {
  const normalized = features.normalized
  if (normalized === '') return true
  if (/^\d+$/u.test(normalized)) return true
  if (isCjk(normalized)) return features.characterCount <= 6
  return features.tokens.length <= 2
}

function compareDiagnostics(left: TmMatchDiagnostics, right: TmMatchDiagnostics): number {
  return right.displayScore - left.displayScore
    || right.sourcePriority - left.sourcePriority
    || left.unitId.localeCompare(right.unitId)
}

function ambiguityGroups(matches: TmMatchDiagnostics[]): void {
  for (const sourceMatches of Map.groupBy(
    matches,
    (match) => normalizeTmText(match.matchedSource),
  ).values()) {
    const targetGroups = Map.groupBy(sourceMatches, (match) => normalizeTmText(match.target))
    for (const targetMatches of targetGroups.values()) {
      for (const match of targetMatches) {
        match.provenanceCount = targetMatches.length
        match.variantCount = targetGroups.size
      }
    }
  }
}

/** Pure, deterministic Segment Matcher. Store supplies candidates; no IO here. */
export function matchTmCandidates(
  query: string,
  candidates: readonly TmMatchCandidate[],
  options: TmMatcherOptions = {},
): TmMatchDiagnostics[] {
  const queryFeatures = prepareSource(query)
  const shortQuery = isShortSegment(queryFeatures)
  const previousHash = options.context?.previousSource === undefined ? undefined : tmSourceHash(options.context.previousSource)
  const nextHash = options.context?.nextSource === undefined ? undefined : tmSourceHash(options.context.nextSource)
  const matches: TmMatchDiagnostics[] = []
  for (const candidate of candidates) {
    const features = prepareCandidate(candidate)
    const rawExact = query === candidate.source
    const structural = candidate.contextKey === undefined || options.context?.contextKey === undefined
      ? 'unknown'
      : candidate.contextKey === options.context.contextKey ? 'match' : 'mismatch'
    const previousFlow = contextState(previousHash, candidate.previousSourceHash)
    const nextFlow = contextState(nextHash, candidate.nextSourceHash)
    const textFlow = options.context === undefined
      || (candidate.previousSourceHash === undefined && candidate.nextSourceHash === undefined)
      ? 'unknown'
      : previousFlow === 'match' || nextFlow === 'match'
        ? 'match'
        : 'mismatch'
    let matchClass: TmSegmentMatchClass
    let displayScore: number
    if (rawExact && structural === 'match' && textFlow === 'match') {
      matchClass = 'double-context'
      displayScore = 102
    } else if (rawExact && (structural === 'match' || textFlow === 'match')) {
      matchClass = 'context'
      displayScore = 101
    } else if (rawExact) {
      matchClass = 'exact'
      displayScore = 100
    } else if (queryFeatures.punctuationMasked === features.punctuationMasked || queryFeatures.masked === features.masked) {
      matchClass = 'near-exact'
      displayScore = 97
    } else {
      const penalty = lengthPenalty(queryFeatures.characterCount, features.characterCount)
      const dice = multisetDice(queryFeatures.grams, features.grams, queryFeatures.gramCount, features.gramCount)
      if (options.minimumScore !== undefined) {
        const tokenCount = Math.max(queryFeatures.tokens.length, features.tokens.length)
        // Edit distance >= the token-count difference. Use the original arithmetic order at the boundary.
        const tokenUpper = tokenCount === 0 ? 1 : 1 - Math.abs(queryFeatures.tokens.length - features.tokens.length) / tokenCount
        const upperScore = Math.max(0, Math.min(94, (0.65 * tokenUpper + 0.35 * dice) * penalty * 100))
        if (upperScore < options.minimumScore) continue
      }
      const lexicalScore = 0.65 * levenshteinSimilarity(queryFeatures.tokens, features.tokens) + 0.35 * dice
      displayScore = Math.max(0, Math.min(94, lexicalScore * penalty * 100))
      matchClass = 'fuzzy'
    }
    if (options.minimumScore !== undefined && displayScore < options.minimumScore) continue
    const structure = structuralSafety(queryFeatures, features)
    const safety = matchClass === 'fuzzy' || matchClass === 'near-exact' || structure.safety !== 'compatible'
      ? 'review' : 'compatible'
    const safetyReasons = [
      ...structure.reasons,
      ...(matchClass === 'near-exact' && structure.reasons.length === 0 ? ['Near Exact 默认需要人工审核'] : []),
      ...(matchClass === 'fuzzy' ? [shortQuery ? '短句模糊候选，仅供参考，需核对语义与上下文' : '模糊候选需核对变化后再使用'] : []),
    ]
    matches.push({
      unitId: candidate.unitId,
      matchClass,
      displayScore: Math.round(displayScore * 100) / 100,
      matchedSource: candidate.source,
      target: candidate.target,
      sourceLabel: candidate.sourceLabel ?? 'Project TM',
      sourcePriority: candidate.sourcePriority ?? 0,
      provenanceCount: 1,
      variantCount: 1,
      context: { structural, textFlow },
      structure: { safety, reasons: [...safetyReasons] },
      differences: differences(queryFeatures, features),
      ...(candidate.originalTuid === undefined ? {} : { originalTuid: candidate.originalTuid }),
      ...(candidate.metadata === undefined ? {} : { metadata: candidate.metadata }),
      ...(candidate.contextKey === undefined ? {} : { contextKey: candidate.contextKey }),
      ...(candidate.previousSourceHash === undefined ? {} : { previousSourceHash: candidate.previousSourceHash }),
      ...(candidate.nextSourceHash === undefined ? {} : { nextSourceHash: candidate.nextSourceHash }),
      ...(candidate.sourceInline === undefined ? {} : { sourceInline: candidate.sourceInline }),
      ...(candidate.targetInline === undefined ? {} : { targetInline: candidate.targetInline }),
    })
  }
  ambiguityGroups(matches)
  matches.sort(compareDiagnostics)
  return matches
}

/** Convert diagnostics to the intentionally smaller Agent evidence contract. */
export function selectTmAgentEvidence(
  matches: readonly TmMatchDiagnostics[],
  limit = 5,
): TmAgentEvidence[] {
  const chosen: TmAgentEvidence[] = []
  let fuzzyCount = 0
  for (const match of matches) {
    if (match.matchClass === 'fuzzy') {
      if (match.displayScore < 85 || fuzzyCount >= 2) continue
      fuzzyCount += 1
    }
    chosen.push({
      unitId: match.unitId,
      matchClass: match.matchClass,
      score: Math.round(match.displayScore),
      matchedSource: match.matchedSource,
      target: match.target,
      sourceLabel: match.sourceLabel,
      safety: match.structure.safety,
      reasons: [
        ...match.structure.reasons,
        ...match.differences,
        ...(match.variantCount <= 1 ? [] : ['同一原文存在多个不同译文变体，不能仅按分数选择。']),
      ],
      ambiguous: match.variantCount > 1,
      ...(match.originalTuid === undefined ? {} : { originalTuid: match.originalTuid }),
      ...(match.metadata === undefined ? {} : { metadata: match.metadata }),
      ...(match.contextKey === undefined ? {} : { contextKey: match.contextKey }),
      ...(match.previousSourceHash === undefined ? {} : { previousSourceHash: match.previousSourceHash }),
      ...(match.nextSourceHash === undefined ? {} : { nextSourceHash: match.nextSourceHash }),
      ...(match.sourceInline === undefined ? {} : { sourceInline: match.sourceInline }),
      ...(match.targetInline === undefined ? {} : { targetInline: match.targetInline }),
    })
    if (chosen.length >= limit) break
  }
  return chosen
}
