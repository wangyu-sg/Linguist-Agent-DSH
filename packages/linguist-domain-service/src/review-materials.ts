import { createHash } from 'node:crypto'
import { mkdirSync, mkdtempSync, realpathSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, isAbsolute, join, relative } from 'node:path'
import { z } from 'zod'
import { matchTmCandidates, scanTagTokens, selectTmAgentEvidence, type Segment } from '@linguist/cat-core'
import { normalizeDelimitedHeader, parseXlsxWorkbook } from '@linguist/cat-formats'
import { LinguistProjectService } from './project-service'
import type { ReviewSegment } from './semantic-review'
import type { CatReadVersion } from '@linguist/cat-tools'
import { getWorkingCopyReferences, type ReferenceItem } from './working-copy-references'
import { prepareWorkingCopy, readWorkingJson, resumeWorkingCopy, workingCopyPath } from './working-copy'
import { buildWorkingReview, workingReviewInput } from './working-review'
import { writeJsonFileAtomic, writeTextFileAtomic } from './safe-file'
import { readPickedFileWithinLimit } from './project-file-intake'
import { LINGUIST_FILE_MAX_BYTES } from './contracts'
import type { XlsxImportMapping } from './project-service-types'
import { suggestProjectWorkbookMapping } from './project-workbook-mapping'
import { prepareReviewVisuals } from './review-visuals'

const OnlineSnapshot = z.object({
  segments: z.array(z.object({
    id: z.string().min(1), ordinal: z.number().int().nonnegative(), source: z.string(), target: z.string(),
    key: z.string().optional(), locked: z.boolean().default(false),
    context: z.object({ note: z.string().optional(), origin: z.string().optional(), meta: z.record(z.string(), z.string()).optional() }).strict().optional(),
  }).strict()).min(1),
}).strict()

// Reuse task-specific matches between translator and reviewer; target text is not cached here.
const taskReferences = new WeakMap<LinguistProjectService, Map<string, ReferenceItem[]>>()

export interface ReviewMaterialsInput {
  workspaceRoot: string
  taskId: string
  projectId?: string
  batchIds?: string[]
  segmentIds?: string[]
  sourcePath?: string
  snapshotPath?: string
  sourceLocale?: string
  targetLocale?: string
  previousResultPath?: string
  outputDir?: string
  referenceFiles?: Array<{ path: string; kind: 'tm' | 'terms'; xlsxMapping?: XlsxImportMapping }>
  contextFiles?: string[]
  online?: { url: string; expectedSegments: number; observedAt: string }
}

export function semanticCachePath(service: LinguistProjectService, projectId?: string): string {
  return projectId ? join(service.getProjectPaths(projectId).projectDir, 'semantic-cache.sqlite') : join(service.rootDir, 'online-semantic-cache.sqlite')
}

/** A complete scope, not a read-page. All three work modes share retrieval and rendering. */
export async function prepareReviewMaterials(service: LinguistProjectService, input: ReviewMaterialsInput, signal?: AbortSignal,
  onSnapshot?: (id: string, versions: CatReadVersion[]) => void) {
  if (input.batchIds && input.segmentIds) throw new Error('请选择批次或句段范围中的一种')
  if ((input.sourcePath || input.snapshotPath) && input.batchIds) throw new Error('文件材料与 CAT 范围不能混用')
  if (input.online) {
    z.object({ url: z.string().url(), expectedSegments: z.number().int().positive(), observedAt: z.string().datetime({ offset: true }) }).parse(input.online)
    if (!input.sourcePath && !input.snapshotPath) throw new Error('线上材料需要平台导出或结构化快照')
  }
  let segments: ReviewSegment[]
  let items: Array<ReferenceItem | { segmentId: string; status: 'pending' }>
  let semantic
  let versions: CatReadVersion[] | undefined
  if (input.sourcePath || input.snapshotPath) {
    if (input.sourcePath && input.snapshotPath) throw new Error('请选择平台导出或结构化快照中的一种')
    const project = input.projectId ? service.getProject(input.projectId) : undefined
    const sourceLocale = input.sourceLocale ?? project?.sourceLocale
    const targetLocale = input.targetLocale ?? project?.targetLocale
    if (input.snapshotPath) {
      segments = OnlineSnapshot.parse(readWorkingJson(input.workspaceRoot, input.snapshotPath).value).segments as ReviewSegment[]
    } else {
      if (!sourceLocale || !targetLocale) throw new Error('解析文件需要语言对')
      let baseline = await prepareWorkingCopy({ workspaceRoot: input.workspaceRoot, sourcePath: input.sourcePath!, sourceLocale, targetLocale })
      if (input.previousResultPath) {
        const previous = readWorkingJson(input.workspaceRoot, input.previousResultPath).value as { projectId?: string; assetId?: string }
        if (previous.projectId && previous.assetId && previous.projectId === input.projectId) {
          const db = service.openProject(previous.projectId)
          baseline = { ...baseline, projectId: previous.projectId, assetId: previous.assetId,
            segments: db.segments.query({ assetId: previous.assetId, limit: baseline.segments.length }) }
        }
        segments = resumeWorkingCopy(baseline, previous, project?.tagProfile).segments
      } else segments = baseline.segments
    }
    if (new Set(segments.map(row => row.id)).size !== segments.length) throw new Error('平台快照包含重复句段 ID')
    if (input.online && segments.length > input.online.expectedSegments) throw new Error('快照条数超过声明的平台范围')
    const platformNote = '平台 TM／TB、最新 Comments 和必要图片须按线上流程实际核对；本地材料不证明平台资料已读取。'
    const files = input.referenceFiles ?? []
    const requestedKinds = new Set(files.map(file => file.kind))
    if (files.length && (!sourceLocale || !targetLocale)) throw new Error('本批 TM／TB 需要语言对')
    const projectMatchesLanguages = project && sourceLocale === project.sourceLocale && targetLocale === project.targetLocale
    const rules = projectMatchesLanguages && input.projectId ? service.openProject(input.projectId).getProjectRules() : []
    const referenceWarnings: string[] = []
    const preparedFiles = (await Promise.all(files.map(async file => {
      try {
        const path = workingCopyPath(input.workspaceRoot, file.path)
        const { bytes } = await readPickedFileWithinLimit(path, LINGUIST_FILE_MAX_BYTES)
        return { ...file, filename: basename(path), bytes, hash: createHash('sha256').update(bytes).digest('hex') }
      } catch (error) {
        referenceWarnings.push(`${file.path} 未能读取：${error instanceof Error ? error.message : String(error)}`)
        return undefined
      }
    }))).filter(file => file !== undefined)
    const referenceKey = preparedFiles.length ? createHash('sha256').update(JSON.stringify({
      files: preparedFiles.map(({ kind, filename, hash, xlsxMapping }) => ({ kind, filename, hash, xlsxMapping })),
      sourceLocale, targetLocale, projectId: input.projectId, taskId: input.taskId, online: Boolean(input.online), rules,
      tagProfile: projectMatchesLanguages ? project?.tagProfile : undefined,
      segments: segments.map(({ id, ordinal, key, source, context, locked, revision }) => ({ id, ordinal, key, source, context, locked, revision })),
    })).digest('hex') : undefined
    let cache = taskReferences.get(service)
    const cached = referenceKey && referenceWarnings.length === 0 ? cache?.get(referenceKey) : undefined
    let temporary: LinguistProjectService | undefined
    let temporaryRoot: string | undefined
    try {
      let references = projectMatchesLanguages && input.projectId ? service.openProject(input.projectId) : undefined
      const importedKinds = new Set<'tm' | 'terms'>()
      if (files.length && !cached) {
        temporaryRoot = mkdtempSync(join(tmpdir(), 'linguist-task-references-'))
        temporary = new LinguistProjectService({ rootDir: temporaryRoot, applicationVersion: 'task-references' })
        temporary.init()
        const task = await temporary.createProject({ name: 'Task references', sourceLocale: sourceLocale!, targetLocale: targetLocale! })
        for (const file of preparedFiles) {
          try {
            let mapping = file.xlsxMapping
            if (file.filename.toLowerCase().endsWith('.xlsx') && !mapping) {
              const workbook = await parseXlsxWorkbook(file.bytes, { filename: file.filename, maxRowsPerSheet: 50 })
              const choices = workbook.sheets.flatMap(sheet => {
                const suggestion = suggestProjectWorkbookMapping(sheet, sourceLocale!, targetLocale!)
                const { source, target } = suggestion.columns
                if (suggestion.confidence < 0.95 || !source || !target) return []
                const headers = sheet.headers.at(-1)?.cells ?? []
                const unique = (name: string) => headers.filter(cell => normalizeDelimitedHeader(cell.value) === normalizeDelimitedHeader(name)).length === 1
                return unique(source) && unique(target) ? [{ sheetName: sheet.name, columns: { source, target } }] : []
              })
              if (choices.length !== 1) throw new Error('需要明确工作表及源／目标列映射')
              mapping = choices[0]
            }
            await temporary.importReference(task.id, file.kind, { filename: file.filename, bytes: file.bytes,
              ...(mapping ? { xlsxMapping: mapping } : {}) })
            importedKinds.add(file.kind)
          } catch (error) {
            referenceWarnings.push(`${file.path} 未能导入：${error instanceof Error ? error.message : String(error)}`)
          }
        }
        references = temporary.openProject(task.id)
      }
      if (cached) items = cached
      else if (references && sourceLocale && targetLocale) {
        const candidates = references.tmUnits.listCandidates(sourceLocale, targetLocale)
        items = segments.map(row => {
          const segment = { ...row, assetId: ('file-task' as Segment['assetId']), sourceLocale, targetLocale,
            status: 'draft', revision: row.revision ?? 0, sourceHash: '' } as Segment
          const policy = references!.termEntries.evaluateSegment(segment).matches
          const tags = scanTagTokens(segment.source, { targetLocale, ...(project?.tagProfile ? { profile: project.tagProfile } : {}) })
          const matches = matchTmCandidates(segment.source, candidates, { minimumScore: 85, includeAdaptable: true,
            context: { segmentId: segment.id, taskId: input.taskId, ...(segment.key ? { contextKey: segment.key } : {}) } })
          return { segmentId: segment.id, status: 'ready' as const, batchId: segment.assetId, revision: segment.revision,
            source: segment.source, locked: segment.locked, originalOrdinal: segment.ordinal + 1,
            ...(segment.key ? { key: segment.key } : {}), ...(segment.context?.note ? { notes: segment.context.note } : {}),
            voiceRefs: [], previous: [], next: [], tags, placeholderSignature: tags.filter(tag => tag.group === 'placeholder').map(tag => tag.signature).sort(),
            requiredTerms: policy.filter(item => item.enforcement === 'hard' && item.match.status === 'required').map(item => item.match),
            forbiddenTerms: policy.filter(item => item.enforcement === 'hard' && item.match.status === 'forbidden').map(item => item.match),
            preferredTerms: policy.filter(item => item.enforcement === 'advisory').map(item => item.match),
            allowedTerms: policy.filter(item => item.match.status === 'allowed').map(item => item.match),
            conflicts: policy.map(item => item.match).filter(item => item.conflict),
            tm: [...selectTmAgentEvidence(matches.filter(match => !match.sameTask && !match.sameSegment), 10),
              ...selectTmAgentEvidence(matches.filter(match => match.sameTask || match.sameSegment), 2)],
            contextRefs: [], warnings: [...(input.online ? [platformNote] : []), ...referenceWarnings,
              ...(files.length && !importedKinds.has('tm') ? [requestedKinds.has('tm') ? '本批 TM 未成功准备' : '本批未提供 TM，不能视为已核对'] : []),
              ...(files.length && !importedKinds.has('terms') ? [requestedKinds.has('terms') ? '本批 TB 未成功准备' : '本批未提供 TB，不能视为已核对'] : [])],
            evidence: [], shared: { context: {}, voices: {}, neighbors: {} }, projectRules: rules, unprovidedReferences: [] }
        })
      } else {
        items = segments.map(row => ({ segmentId: row.id, status: 'platform' as const,
          note: input.online ? platformNote : '未绑定或指定本批 TM／TB；不能视为已核对。' }))
      }
      if (referenceKey && !cached && referenceWarnings.length === 0) {
        if (!cache) { cache = new Map(); taskReferences.set(service, cache) }
        cache.set(referenceKey, items as ReferenceItem[])
        if (cache.size > 2) cache.delete(cache.keys().next().value!)
      }
    } finally {
      temporary?.closeAll()
      if (temporaryRoot) rmSync(temporaryRoot, { recursive: true, force: true })
    }
    semantic = await service.reviewCache.get(semanticCachePath(service, input.projectId), segments, signal)
  } else {
    if (!input.projectId) throw new Error('CAT 材料需要当前项目；线上材料可直接使用平台导出或快照')
    const db = service.openProject(input.projectId)
    if (input.batchIds?.some(id => !db.assets.get(id))) throw new Error('审校范围含不存在的批次')
    const ids = input.segmentIds ?? (input.batchIds
      ? input.batchIds.flatMap(assetId => db.segments.queryIds({ assetId })) : db.segments.queryIds())
    if (!ids.length || new Set(ids).size !== ids.length) throw new Error('审校范围为空或包含重复 ID')
    segments = db.segments.getByIds(ids)
    if (segments.length !== ids.length) throw new Error('审校范围含不存在的句段')
    const references = await getWorkingCopyReferences({ service, projectId: input.projectId, taskId: input.taskId,
      sourceSha256: createHash('sha256').update(JSON.stringify(ids)).digest('hex'), allIds: ids, selectedIds: ids, wait: true, signal })
    items = references.items
    semantic = references.semantic
    const current = db.segments.getByIds(ids)
    segments = current
    versions = current.map(row => ({ segmentId: row.id as string, revision: row.revision, sourceHash: row.sourceHash }))
  }
  if (signal?.aborted) throw new Error('操作已停止')
  const selectedIds = (input.sourcePath || input.snapshotPath) ? input.segmentIds : undefined
  if (selectedIds && (!selectedIds.length || new Set(selectedIds).size !== selectedIds.length
    || selectedIds.some(id => !segments.some(segment => segment.id === id)))) throw new Error('文件范围含未知或重复句段 ID')
  const loaded = selectedIds?.length ?? segments.length
  const expected = selectedIds?.length ?? input.online?.expectedSegments ?? segments.length
  const coverage = { loaded, expected, complete: loaded === expected }
  const visualFiles = [...(input.contextFiles ?? []), ...(input.sourcePath?.toLowerCase().endsWith('.xlsx') ? [input.sourcePath] : [])]
  const visual = await prepareReviewVisuals(input.workspaceRoot, visualFiles, segments, input.outputDir)
  const content = { segments, items, semantic, coverage, selectedIds, online: input.online, visual }
  const hash = createHash('sha256').update(JSON.stringify(content)).digest('hex')
  const root = realpathSync(input.workspaceRoot)
  let directory = input.outputDir ? workingCopyPath(root, input.outputDir) : root
  for (const part of [...(input.outputDir ? [] : ['.linguist']), 'review-materials', hash]) {
    directory = join(directory, part)
    mkdirSync(directory, { recursive: true })
    directory = realpathSync(directory)
    const inside = relative(root, directory)
    if (inside.startsWith('..') || isAbsolute(inside)) throw new Error('审校材料目录越界')
  }
  const review = buildWorkingReview(segments, items, semantic, selectedIds, visual)
  for (const file of review.files) writeTextFileAtomic(join(directory, file.name), file.name === 'index.md'
    ? `本次已取得 ${coverage.loaded}/${coverage.expected} 条；${coverage.complete ? '当前声明范围已取齐' : '范围尚未取齐，不得声明整批关联已检查'}。\n\n${input.online ? `平台：${input.online.url}\n读取时间：${input.online.observedAt}\n线上写回前须核对当前文本、稳定 ID 和最新 Comments。\n\n` : ''}${file.text}` : file.text)
  writeJsonFileAtomic(join(directory, 'materials.json'), content)
  // This binds supplied materials to their versions; it is not evidence of reading.
  const snapshotId = versions ? `read:${hash}` : undefined
  if (snapshotId) onSnapshot?.(snapshotId, versions!)
  return { ...workingReviewInput(review, relative(root, directory)), readingPath: relative(root, join(directory, 'index.md')), groups: review.groups, coverage,
    ...(snapshotId ? { snapshotId } : {}),
    semantic: semantic.status === 'ready' ? { status: semantic.status, groups: semantic.groups.length, embedded: semantic.embedded, cached: semantic.cached } : semantic,
    note: '材料不是审校完成凭据；独立 Reviewer 仍须完整审读。正常组无需回执，不自动写回译文。' }
}
