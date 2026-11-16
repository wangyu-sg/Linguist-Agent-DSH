import { sha256Hex } from './hash'
import { scanTagTokens } from './tag-families'
import { prepareTmScoringSource, scoreTmSource, tmCanReachScore, tmScoreUpperBound, type TmScoringSource } from './tm-scoring'
import { adaptTmTarget, type TmAdaptation } from './tm-adaptation'

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
  taskId?: string
  segmentId?: string
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
  localMetadata?: Record<string, string | string[]>
  sourceInline?: string
  targetInline?: string
}

export interface TmMatchDiagnostics extends Pick<TmMatchCandidate,
  'originalTuid' | 'metadata' | 'localMetadata' | 'contextKey' | 'previousSourceHash' | 'nextSourceHash' | 'sourceInline' | 'targetInline'> {
  unitId: string
  matchClass: TmSegmentMatchClass
  baseScore: number
  displayScore: number
  matchedSource: string
  target: string
  sourceLabel: string
  sourcePriority: number
  provenanceCount: number
  variantCount: number
  sameTask: boolean
  sameSegment: boolean
  context: {
    structural: TmContextState
    textFlow: TmContextState
  }
  structure: {
    safety: Exclude<TmReuseSafety, 'incompatible'>
    reasons: string[]
  }
  differences: string[]
  adaptation?: TmAdaptation
}

export interface TmMatcherOptions {
  context?: TmMatchContext
  minimumScore?: number
  /** Automatic context may expose a low-scoring placeable candidate without changing its score. */
  includeAdaptable?: boolean
}

export interface TmAgentEvidence extends Pick<TmMatchDiagnostics,
  'originalTuid' | 'metadata' | 'localMetadata' | 'contextKey' | 'previousSourceHash' | 'nextSourceHash' | 'sourceInline' | 'targetInline' | 'adaptation'> {
  unitId: string
  matchClass: TmSegmentMatchClass
  score: number
  baseScore: number
  matchedSource: string
  target: string
  sourceLabel: string
  safety: 'compatible' | 'review'
  reasons: string[]
  ambiguous: boolean
  sameTask: boolean
  sameSegment: boolean
}

function normalizeTmText(value: string): string {
  return value
    .normalize('NFKC')
    .replace(/\r\n?/gu, '\n')
    .replace(/[\t\f\v ]+/gu, ' ')
    .trim()
    .toLocaleLowerCase()
}

function isCjk(value: string): boolean {
  return /[\u3040-\u30ff\u3400-\u9fff\uf900-\ufaff]/u.test(value)
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
  wordCount: number
  scoring: TmScoringSource
  characterCount: number
  masked: string
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
  const scoring = prepareTmScoringSource(source)
  return {
    source, normalized, scoring, wordCount: scoring.tokens.filter(token => token.kind === 'word' || token.kind === 'number').length,
    characterCount: characters.length, masked: placeableMasked(normalized, normalizedTags),
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
  return features.wordCount <= 2
}

function compareDiagnostics(left: TmMatchDiagnostics, right: TmMatchDiagnostics): number {
  const lastUsed = (match: TmMatchDiagnostics) => {
    const value = match.localMetadata?.la_last_used_at ?? match.metadata?.['sdltm:last_used_date']
    return typeof value === 'string' ? Date.parse(value) || 0 : 0
  }
  return right.displayScore - left.displayScore
    || lastUsed(right) - lastUsed(left)
    || right.sourcePriority - left.sourcePriority
    || left.unitId.localeCompare(right.unitId)
}

function ambiguityGroups(matches: TmMatchDiagnostics[], candidates: readonly TmMatchCandidate[]): void {
  const sources = new Set(matches.map(match => normalizeTmText(match.matchedSource)))
  const variants = new Map<string, Map<string, number>>()
  for (const candidate of candidates) {
    const source = prepareCandidate(candidate).normalized
    if (!sources.has(source)) continue
    const targets = variants.get(source) ?? new Map<string, number>()
    const target = normalizeTmText(candidate.target)
    targets.set(target, (targets.get(target) ?? 0) + 1)
    variants.set(source, targets)
  }
  for (const match of matches) {
    const targets = variants.get(normalizeTmText(match.matchedSource))!
    match.provenanceCount = targets.get(normalizeTmText(match.target))!
    match.variantCount = targets.size
    if (targets.size > 1) match.displayScore = Math.max(0, match.displayScore - 1)
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
  const scoringCache = new Map()
  for (const candidate of candidates) {
    const features = prepareCandidate(candidate)
    const rawExact = query === candidate.source
    const near = queryFeatures.punctuationMasked === features.punctuationMasked || queryFeatures.masked === features.masked
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
    let sourceDifferences: string[] = []
    if (rawExact && structural === 'match' && textFlow === 'match') {
      matchClass = 'double-context'
      displayScore = 102
    } else if (rawExact && (structural === 'match' || textFlow === 'match')) {
      matchClass = 'context'
      displayScore = 101
    } else if (rawExact) {
      matchClass = 'exact'
      displayScore = 100
    } else {
      if (options.minimumScore !== undefined && !(options.includeAdaptable && near)
        && (tmScoreUpperBound(queryFeatures.scoring, features.scoring) < options.minimumScore
          || !tmCanReachScore(queryFeatures.scoring, features.scoring, options.minimumScore, scoringCache))) continue
      const scored = scoreTmSource(queryFeatures.scoring, features.scoring, scoringCache)
      displayScore = scored.score
      sourceDifferences = scored.differences
      matchClass = near ? 'near-exact' : 'fuzzy'
    }
    if (options.minimumScore !== undefined && displayScore < options.minimumScore && !(options.includeAdaptable && near)) continue
    const adaptation = adaptTmTarget(query, candidate.source, candidate.target)
    if (options.minimumScore !== undefined && displayScore < options.minimumScore && !(options.includeAdaptable && near && adaptation)) continue
    const structure = structuralSafety(queryFeatures, features)
    const sameTask = options.context?.taskId !== undefined && Array.isArray(candidate.localMetadata?.la_task_ids)
      && candidate.localMetadata.la_task_ids.includes(options.context.taskId)
    const confirmations = candidate.localMetadata?.la_confirmations
    const sameSegment = options.context?.segmentId !== undefined && Array.isArray(confirmations)
      && confirmations.some(value => (JSON.parse(value) as { segmentId: string }).segmentId === options.context!.segmentId)
    const safety = sameTask || sameSegment || matchClass === 'fuzzy' || matchClass === 'near-exact' || structure.safety !== 'compatible'
      ? 'review' : 'compatible'
    const safetyReasons = [
      ...structure.reasons,
      ...(sameTask ? ['含本任务的阶段确认记录，不能作为独立历史定稿依据'] : []),
      ...(sameSegment ? ['含同一句段的阶段确认记录，不能作为独立历史定稿依据'] : []),
      ...(adaptation?.status === 'needs-review' ? ['自动适配无法可靠对齐，需结合上下文判断'] : []),
      ...(matchClass === 'near-exact' && structure.reasons.length === 0 ? ['Near Exact 默认需要人工审核'] : []),
      ...(matchClass === 'fuzzy' ? [shortQuery ? '短句模糊候选，仅供参考，需核对语义与上下文' : '模糊候选需核对变化后再使用'] : []),
    ]
    matches.push({
      unitId: candidate.unitId,
      matchClass,
      baseScore: displayScore,
      displayScore: Math.round(displayScore * 100) / 100,
      matchedSource: candidate.source,
      target: candidate.target,
      sourceLabel: candidate.sourceLabel ?? 'Project TM',
      sourcePriority: candidate.sourcePriority ?? 0,
      provenanceCount: 1,
      variantCount: 1,
      sameTask,
      sameSegment,
      context: { structural, textFlow },
      structure: { safety, reasons: [...safetyReasons] },
      differences: sourceDifferences,
      ...(adaptation === undefined ? {} : { adaptation }),
      ...(candidate.originalTuid === undefined ? {} : { originalTuid: candidate.originalTuid }),
      ...(candidate.metadata === undefined ? {} : { metadata: candidate.metadata }),
      ...(candidate.localMetadata === undefined ? {} : { localMetadata: candidate.localMetadata }),
      ...(candidate.contextKey === undefined ? {} : { contextKey: candidate.contextKey }),
      ...(candidate.previousSourceHash === undefined ? {} : { previousSourceHash: candidate.previousSourceHash }),
      ...(candidate.nextSourceHash === undefined ? {} : { nextSourceHash: candidate.nextSourceHash }),
      ...(candidate.sourceInline === undefined ? {} : { sourceInline: candidate.sourceInline }),
      ...(candidate.targetInline === undefined ? {} : { targetInline: candidate.targetInline }),
    })
  }
  ambiguityGroups(matches, candidates)
  const filtered = options.minimumScore === undefined ? matches : matches.filter(match => match.displayScore >= options.minimumScore!
    || (options.includeAdaptable && match.matchClass === 'near-exact' && match.adaptation !== undefined))
  filtered.sort(compareDiagnostics)
  return filtered
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
      baseScore: match.baseScore,
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
      sameTask: match.sameTask,
      sameSegment: match.sameSegment,
      ...(match.localMetadata === undefined ? {} : { localMetadata: match.localMetadata }),
      ...(match.adaptation === undefined ? {} : { adaptation: match.adaptation }),
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
