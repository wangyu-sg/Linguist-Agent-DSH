import { sha256Hex } from './hash'
import type { Segment } from './segment'

export type TextFunction = 'mechanics' | 'ui' | 'quest' | 'dialogue' | 'item' | 'marketing'
export interface ProfessionalStandard {
  version: string
  rules: Array<{ id: string; text: string }>
  profiles: Array<{ id: TextFunction; ruleRefs: string[]; questions: string[] }>
}
export interface ProfessionalCase {
  caseId: string
  version: string
  sourceLocale: string
  targetLocale: string
  textFunctions: TextFunction[]
  problemTags: string[]
  scene: string
  relatedText: string[]
  source: Record<string, string>
  candidates: Array<Record<string, string>>
  judgment: { decision: string; rationale: string }
  invariants: string[]
  when: string[]
  notWhen: string[]
  ruleRefs: string[]
  origin: string
  review: { status: 'pending' | 'approved' | 'withdrawn'; by?: string; at?: string; contentHash?: string }
}
export interface ProfessionalResources {
  standard: ProfessionalStandard
  examples: { version: string; cases: ProfessionalCase[] }
  standardHash: string
  examplesHash: string
}

export function professionalHash(value: unknown): string {
  return sha256Hex(new TextEncoder().encode(JSON.stringify(value)))
}

export function professionalCaseHash({ review: _review, ...content }: ProfessionalCase): string {
  return professionalHash(content)
}

export function renderProfessionalStandard(resources: ProfessionalResources): string {
  return `# 专业判断标准 ${resources.standard.version}\nstandardHash=${resources.standardHash}\n` +
    resources.standard.rules.map(rule => `${rule.id} ${rule.text}`).join('\n')
}

/** Metadata selects possible functions; it never proves a scene's facts or a case's applicability. */
export function selectProfessionalContext(resources: ProfessionalResources, segments: readonly Segment[], focus: readonly string[] = [], caseLimit: 0 | 1 | 2 = 2, hints: Readonly<Record<string, TextFunction[]>> = {}) {
  const profiles = Object.fromEntries(resources.standard.profiles.map(profile => [profile.id, profile]))
  const routes = segments.map(segment => {
    const metadata = segment.context?.meta ?? {}
    const labels = [metadata.textFunctions, metadata.textType, metadata.category].filter(Boolean).join(',').toLowerCase().split(/[,;|\s]+/)
    const metadataIds = resources.standard.profiles.filter(profile => labels.includes(profile.id)).map(profile => profile.id)
    const profileIds = metadataIds.length ? metadataIds : [...new Set(hints[segment.id] ?? [])]
    return { segmentId: segment.id as string, profileIds, caseIds: [] as string[], functionSource: metadataIds.length ? 'metadata' : profileIds.length ? 'model-hint' : 'unknown' }
  })
  const activeCases = resources.examples.cases.filter(example => example.review.status === 'approved'
    && example.review.by && example.review.at && example.review.contentHash === professionalCaseHash(example))
  const selected = activeCases.filter(example => example.problemTags.some(tag => focus.includes(tag)) && segments.some((segment, index) =>
    segment.sourceLocale.toLowerCase() === example.sourceLocale.toLowerCase()
    && segment.targetLocale.toLowerCase() === example.targetLocale.toLowerCase()
    && example.textFunctions.some(id => routes[index]!.profileIds.includes(id))))
    .sort((a, b) => b.problemTags.filter(tag => focus.includes(tag)).length - a.problemTags.filter(tag => focus.includes(tag)).length || a.caseId.localeCompare(b.caseId))
    .slice(0, caseLimit)
  for (const [index, route] of routes.entries()) {
    const segment = segments[index]!
    route.caseIds = selected.filter(example => example.sourceLocale.toLowerCase() === segment.sourceLocale.toLowerCase()
      && example.targetLocale.toLowerCase() === segment.targetLocale.toLowerCase()
      && example.textFunctions.some(id => route.profileIds.includes(id))).map(example => example.caseId)
  }
  const packet = {
    standardVersion: resources.standard.version, standardHash: resources.standardHash,
    examplesVersion: resources.examples.version, examplesHash: resources.examplesHash,
    profiles: Object.fromEntries([...new Set(routes.flatMap(route => route.profileIds))].map(id => [id, profiles[id]!])),
    cases: selected, perSegmentRoutes: routes,
    availableCaseTopics: [...new Set(activeCases.flatMap(example => example.problemTags))].sort(),
    note: '功能来自元数据；缺失时结合原文判断。案例仅供类比，须核对 when/notWhen 与当前项目证据；没有相关案例是正常结果。',
  }
  return { ...packet, packetHash: professionalHash(packet) }
}

export type ProfessionalContext = ReturnType<typeof selectProfessionalContext>
