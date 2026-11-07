import nspell from 'nspell'
import { scanTags, UnknownSegmentError } from '@linguist/cat-core'
import type { LinguistProjectService } from '@linguist/domain-service'
import type { LinguistCatRowSignalsResult, LinguistConcordanceResult, LinguistEditorDetails, LinguistEditorTermsResult, LinguistSpellingResult } from '@linguist/domain-service/contracts'

/** Grid badges read only QA/proposals; full TM matching belongs to the selected inspector. */
export function editorRowSignals(service: LinguistProjectService, projectId: string, segmentIds: string[]): LinguistCatRowSignalsResult {
  const db = service.openProject(projectId)
  const segments = db.segments.getByIds(segmentIds)
  if (segments.length !== segmentIds.length) throw new UnknownSegmentError(segmentIds.find(id => !segments.some(segment => segment.id === id))!)
  return { items: segments.map(segment => {
    const open = db.qaFindings.list({ segmentId: segment.id }).filter(finding => finding.status === 'open')
    return { segmentId: segment.id, proposal: db.proposals.listBySegment(segment.id, 'pending').at(-1), qaCount: open.length,
      highestSeverity: open.map(finding => finding.severity).sort()[0] }
  }) }
}

export function editorTermMatches(service: LinguistProjectService, projectId: string, segmentIds: string[]): LinguistEditorTermsResult {
  const db = service.openProject(projectId)
  const segments = db.segments.getByIds(segmentIds)
  if (segments.length !== segmentIds.length) throw new UnknownSegmentError(segmentIds.find(id => !segments.some(segment => segment.id === id))!)
  return { items: segments.map(segment => {
    const matches = db.termEntries.evaluateSegment(segment).matches.map(item => item.match)
    return { segmentId: segment.id, sourceHash: segment.sourceHash, revision: segment.revision, termMatches: matches.slice(0, 200), truncated: matches.length > 200 }
  }) }
}

export function editorDetails(service: LinguistProjectService, projectId: string, segmentId: string): LinguistEditorDetails {
  const db = service.openProject(projectId)
  const segment = db.segments.getById(segmentId)
  if (!segment) throw new UnknownSegmentError(segmentId)
  const neighbors = db.segments.neighbors(segmentId, 1)
  const revisions = db.segments.listRevisions(segmentId)
  return { segment, ...neighbors, revisions: revisions.slice(-100), totalRevisions: revisions.length }
}

export function editorConcordance(service: LinguistProjectService, projectId: string, query: string, assetId: string | undefined, limit: number, offset: number): LinguistConcordanceResult {
  const project = service.getProject(projectId)
  const db = service.openProject(projectId)
  const page = service.queryCatWorkspace(projectId, { assetId, search: query, limit, offset, includeIndex: false })
  const labels = new Map(page.assets.map(asset => [asset.id as string, asset.originalFilename]))
  const filter = { query, sourceLocale: project.sourceLocale, targetLocale: project.targetLocale, limit, offset }
  return {
    segments: page.segments.map(segment => ({ segment, assetLabel: labels.get(segment.assetId) ?? segment.assetId })),
    segmentTotal: page.total, tm: db.tmUnits.concordance(filter), tmTotal: db.tmUnits.count(filter), limit, offset,
  }
}

let english: Promise<nspell> | undefined
function englishDictionary(): Promise<nspell> {
  return english ??= import('dictionary-en').then(({ default: dictionary }) => nspell({ aff: Buffer.from(dictionary.aff), dic: Buffer.from(dictionary.dic) }))
}

/** Offline only. Per-project words never mutate the shared base dictionary. */
export async function editorSpelling(service: LinguistProjectService, projectId: string, locale: string, text: string): Promise<LinguistSpellingResult> {
  const project = service.getProject(projectId)
  const dictionary = project.spellingDictionary?.[locale] ?? []
  const supported = /^en(?:-US)?$/i.test(locale)
  if (!supported) return { locale, supported, dictionary, issues: [] }
  const spell = await englishDictionary()
  const custom = new Set(dictionary.map(word => word.normalize('NFC').toLocaleLowerCase('en')))
  const tags = scanTags(text, { profile: project.tagProfile, targetLocale: locale })
  const words = text.matchAll(/[\p{L}\p{M}]+(?:['’\-][\p{L}\p{M}]+)*/gu)
  const issues: LinguistSpellingResult['issues'] = []
  const suggestions = new Map<string, string[]>()
  for (const match of words) {
    const word = match[0], start = match.index!, end = start + word.length
    if (!/[A-Za-z]/.test(word) || tags.some(tag => start < tag.end && end > tag.start)) continue
    const normalized = word.normalize('NFC').replaceAll('’', "'")
    if (custom.has(word.normalize('NFC').toLocaleLowerCase('en')) || spell.correct(normalized)) continue
    let proposed = suggestions.get(normalized)
    if (!proposed) { proposed = normalized.length <= 64 ? spell.suggest(normalized).slice(0, 5) : []; suggestions.set(normalized, proposed) }
    issues.push({ word, start, end, suggestions: proposed })
    if (issues.length === 100) break
  }
  return { locale, supported, dictionary, issues }
}
