import { createHash } from 'node:crypto'
import { mkdirSync, mkdtempSync, realpathSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, isAbsolute, join, relative } from 'node:path'
import { z } from 'zod'
import type { TermEntryMatch, TmStoredMatchCandidate } from '@linguist/cat-store'
import { evaluateSegmentTermPolicy, matchTmCandidates, scanTagTokens, selectTmAgentEvidence, type Segment } from '@linguist/cat-core'
import { normalizeDelimitedHeader, parseXlsxWorkbook } from '@linguist/cat-formats'
import { LinguistProjectService } from './project-service'
import type { ReviewSegment } from './semantic-review'
import type { CatReadVersion } from '@linguist/cat-tools'
import { disposeWorkingCopyReferences, getWorkingCopyReferences, type ReferenceItem } from './working-copy-references'
import { bindWorkingBatch, type LinguistWorkingCopy, prepareWorkingCopy, readWorkingJson, resumeWorkingCopy, workingCopyPath } from './working-copy'
import { buildWorkingReview, workingReviewInput } from './working-review'
import { writeJsonFileAtomic, writeFileAtomic } from './safe-file'
import { readPickedFileWithinLimit } from './project-file-intake'
import { LINGUIST_FILE_MAX_BYTES } from './contracts'
import type { XlsxImportMapping } from './project-service-types'
import { suggestProjectWorkbookMapping } from './project-workbook-mapping'
import { prepareReviewVisuals } from './review-visuals'
import { getProjectLibraryMaterials, syncProjectLibrary } from './project-library'

const OnlineSnapshot = z.object({
  segments: z.array(z.object({
    id: z.string().min(1), ordinal: z.number().int().nonnegative(), source: z.string(), target: z.string(),
    key: z.string().optional(), locked: z.boolean().default(false),
    context: z.object({ note: z.string().optional(), origin: z.string().optional(), meta: z.record(z.string(), z.string()).optional() }).strict().optional(),
  }).strict()).min(1),
}).strict()

// Reuse task-specific matches between translator and reviewer; target text is not cached here.
interface AttachmentMatches {
  projectId?: string
  taskGroupId: string
  tm: TmStoredMatchCandidate[]
  terms: ReadonlyMap<string, TermEntryMatch[]>
  kinds: Set<'tm' | 'terms'>
}
const taskReferences = new WeakMap<LinguistProjectService, Map<string, AttachmentMatches>>()

export function clearGroupReviewMaterials(service: LinguistProjectService, projectId: string | undefined, taskGroupId?: string): void {
  disposeWorkingCopyReferences(service, projectId, taskGroupId)
  const entries = taskReferences.get(service)
  if (entries) for (const [key, entry] of entries) {
    if (entry.projectId === projectId && (taskGroupId === undefined || entry.taskGroupId === taskGroupId)) entries.delete(key)
  }
}

export interface ReviewMaterialsInput {
  workspaceRoot: string
  taskId: string
  projectId?: string
  taskGroupId?: string
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
  online?: { fileId?: string; url: string; expectedSegments: number; observedAt: string }
}

export function semanticCachePath(service: LinguistProjectService, projectId?: string): string {
  return projectId ? join(service.getProjectPaths(projectId).projectDir, 'semantic-cache.sqlite') : join(service.rootDir, 'online-semantic-cache.sqlite')
}

/** A complete scope, not a read-page. All three work modes share retrieval and rendering. */
export async function prepareReviewMaterials(service: LinguistProjectService, input: ReviewMaterialsInput, signal?: AbortSignal,
  onSnapshot?: (id: string, versions: CatReadVersion[]) => void) {
  let taskGroupId = input.taskGroupId ?? 'ungrouped'
  let batchId: string | undefined
  let materialVersion: string | undefined
  let catAssets: string[] = []
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
    const projectDb = input.projectId ? service.openProject(input.projectId) : undefined
    if (input.snapshotPath) {
      segments = OnlineSnapshot.parse(readWorkingJson(input.workspaceRoot, input.snapshotPath).value).segments as ReviewSegment[]
    } else {
      if (!sourceLocale || !targetLocale) throw new Error('解析文件需要语言对')
      let baseline = await prepareWorkingCopy({ workspaceRoot: input.workspaceRoot, sourcePath: input.sourcePath!, sourceLocale, targetLocale })
      const previous = input.previousResultPath ? readWorkingJson(input.workspaceRoot, input.previousResultPath).value as LinguistWorkingCopy : undefined
      if (previous?.projectId && previous.projectId !== input.projectId) throw new Error('工作稿来自其他项目')
      if (!input.taskGroupId && previous?.taskGroupId) taskGroupId = previous.taskGroupId
      if (previous?.taskGroupId && previous.taskGroupId !== taskGroupId) throw new Error('工作稿来自其他任务组，请选择当前组的快照')
      if (previous?.batchId && projectDb && projectDb.taskGroups.groupOf(previous.batchId) !== taskGroupId) throw new Error('工作稿的批次归属已变化，请重新准备')
      if (previous?.assetId && projectDb && previous.projectId === input.projectId) {
        const asset = projectDb.assets.get(previous.assetId)
        if (!asset || asset.sourceSha256 !== baseline.sourceSha256 || asset.taskGroupId !== taskGroupId) throw new Error('工作稿的批次或任务组已变化，请重新准备相应批次')
        baseline = { ...baseline, projectId: input.projectId, assetId: asset.id, taskGroupId, segments: projectDb.segments.query({ assetId: asset.id, limit: baseline.segments.length }) }
        batchId = asset.id
      } else if (projectDb && input.online) {
        batchId = projectDb.assets.findBySource(baseline.sourceSha256, taskGroupId)?.id
      } else if (projectDb && input.projectId) {
        const bound = bindWorkingBatch(service, input.projectId, taskGroupId, baseline)
        batchId = bound.batchId
        // A user-supplied detached draft retains its original row keys.
        if (!previous || previous.projectId || previous.taskGroupId) baseline = bound
      }
      segments = previous ? resumeWorkingCopy(baseline, previous, project?.tagProfile).segments : baseline.segments
    }
    if (new Set(segments.map(row => row.id)).size !== segments.length) throw new Error('平台快照包含重复句段 ID')
    if (input.online && segments.length > input.online.expectedSegments) throw new Error('快照条数超过声明的平台范围')
    if (projectDb && input.online?.fileId && input.projectId) {
      const locator = JSON.stringify([new URL(input.online.url).origin, input.online.fileId])
      const known = projectDb.taskGroups.findRegisteredBatch(taskGroupId, 'browser', locator)
      if (known?.assetId && batchId && known.assetId !== batchId) throw new Error('平台文件已关联其他 CAT 批次，请核对文件身份')
      if (!known || (batchId && !known.assetId)) {
        service.assertProjectWritable(input.projectId)
        batchId = projectDb.taskGroups.registerBatch(taskGroupId, 'browser', locator, input.online.fileId, batchId)
      } else batchId = known.assetId ?? known.id
    }
    if (project && input.projectId) await syncProjectLibrary(service, input.projectId, input.workspaceRoot, [], { taskGroupId })
    materialVersion = projectDb?.taskGroups.materialVersion(taskGroupId)
    const platformNote = '平台 TM／TB、最新 Comments 和必要图片须按线上流程实际核对；本地材料不证明平台资料已读取。'
    const files = input.referenceFiles ?? []
    const requestedKinds = new Set(files.map(file => file.kind))
    if (files.length && (!sourceLocale || !targetLocale)) throw new Error('本批 TM／TB 需要语言对')
    const projectMatchesLanguages = project && sourceLocale === project.sourceLocale && targetLocale === project.targetLocale
    const rules = projectMatchesLanguages && input.projectId ? service.openProject(input.projectId).getProjectRules(undefined, taskGroupId) : []
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
      sourceLocale, targetLocale, taskGroupId, projectId: input.projectId, taskId: input.taskId,
      segments: segments.map(({ source, context }) => [source, context?.meta?.module, context?.meta?.category]),
    })).digest('hex') : undefined
    let cache = taskReferences.get(service)
    let attached = referenceKey && referenceWarnings.length === 0 ? cache?.get(referenceKey) : undefined
    let temporary: LinguistProjectService | undefined
    let temporaryRoot: string | undefined
    try {
      const references = projectMatchesLanguages ? projectDb : undefined
      const importedKinds = new Set<'tm' | 'terms'>()
      const termKey = (row: ReviewSegment) => JSON.stringify([row.source, row.context?.meta?.module, row.context?.meta?.category])
      if (files.length && !attached) {
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
        const db = temporary.openProject(task.id)
        const terms = new Map<string, TermEntryMatch[]>()
        for (const row of segments) {
          const key = termKey(row)
          if (!terms.has(key)) terms.set(key, db.termEntries.findMatches({ text: row.source, limit: Number.MAX_SAFE_INTEGER, module: row.context?.meta?.module, category: row.context?.meta?.category }))
        }
        attached = { projectId: input.projectId, taskGroupId, tm: db.tmUnits.listCandidates(sourceLocale!, targetLocale!), terms, kinds: importedKinds }
        if (referenceKey && referenceWarnings.length === 0) {
          if (!cache) { cache = new Map(); taskReferences.set(service, cache) }
          cache.set(referenceKey, attached)
          if (cache.size > 2) cache.delete(cache.keys().next().value!)
        }
      }
      if ((references || attached) && sourceLocale && targetLocale) {
        const candidates = [...references?.tmUnits.listCandidates(sourceLocale, targetLocale, undefined, taskGroupId) ?? [], ...attached?.tm ?? []]
        items = segments.map(row => {
          const segment = { ...row, assetId: ('file-task' as Segment['assetId']), sourceLocale, targetLocale,
            status: 'draft', revision: row.revision ?? 0, sourceHash: '' } as Segment
          const module = row.context?.meta?.module, category = row.context?.meta?.category
          const terms = [...references?.termEntries.findMatches({ text: row.source, taskGroupId, module, category, limit: Number.MAX_SAFE_INTEGER }) ?? [], ...attached?.terms.get(termKey(row)) ?? []]
          const normalize = (text: string) => text.normalize('NFKC').trim().toLocaleLowerCase()
          const alternatives = Map.groupBy(terms, term => normalize(term.term))
          const policy = evaluateSegmentTermPolicy({ source: row.source, target: row.target, sourceLocale, targetLocale, assetId: segment.assetId,
            module, category, segmentMetadata: row.context?.meta ?? {}, candidates: terms.map(term => ({
              ...term, conflict: term.conflict || alternatives.get(normalize(term.term))!.some(other => normalize(other.translation) !== normalize(term.translation)),
            })) }).matches
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
              ...(files.length && !attached?.kinds.has('tm') ? [requestedKinds.has('tm') ? '本批 TM 未成功准备' : '本批未提供 TM，不能视为已核对'] : []),
              ...(files.length && !attached?.kinds.has('terms') ? [requestedKinds.has('terms') ? '本批 TB 未成功准备' : '本批未提供 TB，不能视为已核对'] : [])],
            evidence: [], shared: { context: {}, voices: {}, neighbors: {} }, projectRules: rules, unprovidedReferences: [] }
        })
      } else {
        items = segments.map(row => ({ segmentId: row.id, status: 'platform' as const,
          note: input.online ? platformNote : '未绑定或指定本批 TM／TB；不能视为已核对。' }))
      }
    } finally {
      temporary?.closeAll()
      if (temporaryRoot) rmSync(temporaryRoot, { recursive: true, force: true })
    }
    semantic = await service.reviewCache.get(semanticCachePath(service, input.projectId), segments, signal, taskGroupId)
  } else {
    if (!input.projectId) throw new Error('CAT 材料需要当前项目；线上材料可直接使用平台导出或快照')
    const db = service.openProject(input.projectId)
    if (input.batchIds?.some(id => !db.assets.get(id))) throw new Error('审校范围含不存在的批次')
    const ids = input.segmentIds ?? (input.batchIds
      ? input.batchIds.flatMap(assetId => db.segments.queryIds({ assetId })) : db.segments.queryIds({ taskGroupId }))
    if (!ids.length || new Set(ids).size !== ids.length) throw new Error('审校范围为空或包含重复 ID')
    const rows = db.segments.getByIds(ids)
    if (rows.length !== ids.length) throw new Error('审校范围含不存在的句段')
    catAssets = [...new Set(rows.map(row => row.assetId))]
    taskGroupId = db.taskGroups.forAssets(catAssets, taskGroupId)!
    await syncProjectLibrary(service, input.projectId, input.workspaceRoot, [], { taskGroupId })
    materialVersion = db.taskGroups.materialVersion(taskGroupId)
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
  const library = input.projectId ? await getProjectLibraryMaterials(service, input.projectId, input.workspaceRoot,
    segments.map(row => ({ id: row.id, text: [row.source, row.target, row.key, JSON.stringify(row.context)].filter(Boolean).join('\n') })), signal, taskGroupId) : undefined
  const visualFiles = [...new Set([...(input.contextFiles ?? []), ...(library?.contextFiles ?? []), ...(input.sourcePath?.toLowerCase().endsWith('.xlsx') ? [input.sourcePath] : [])])]
  const visual = await prepareReviewVisuals(input.workspaceRoot, visualFiles, segments, input.outputDir)
  if (input.projectId) {
    const groups = service.openProject(input.projectId).taskGroups
    if (groups.materialVersion(taskGroupId) !== materialVersion || (batchId && groups.groupOf(batchId) !== taskGroupId) || catAssets.some(id => groups.groupOf(id) !== taskGroupId)) throw new Error('资料或批次归属在准备时已变化，请重新读取')
  }
  const content = { taskGroupId, batchId, materialVersion, segments, items, semantic, coverage, selectedIds, online: input.online, visual, library }
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
  const review = buildWorkingReview(segments, items, semantic, selectedIds, visual, library)
  for (const file of review.files) writeFileAtomic(join(directory, file.name), file.name === 'index.md'
    ? `本次已取得 ${coverage.loaded}/${coverage.expected} 条；${coverage.complete ? '当前声明范围已取齐' : '范围尚未取齐，不得声明整批关联已检查'}。\n\n${input.online ? `平台：${input.online.url}\n读取时间：${input.online.observedAt}\n线上写回前须核对当前文本、稳定 ID 和最新 Comments。\n\n` : ''}${file.text}` : file.text)
  writeJsonFileAtomic(join(directory, 'materials.json'), content)
  // This binds supplied materials to their versions; it is not evidence of reading.
  const snapshotId = versions ? `read:${hash}` : undefined
  if (snapshotId) onSnapshot?.(snapshotId, versions!)
  return { ...workingReviewInput(review, relative(root, directory)), readingPath: relative(root, join(directory, 'index.md')), groups: review.groups, coverage,
    ...(snapshotId ? { snapshotId } : {}), taskGroupId, batchId,
    semantic: semantic.status === 'ready' ? { status: semantic.status, groups: semantic.groups.length, embedded: semantic.embedded, cached: semantic.cached } : semantic,
    note: '材料不是审校完成凭据；独立 Reviewer 仍须完整审读。正常组无需回执，不自动写回译文。' }
}
