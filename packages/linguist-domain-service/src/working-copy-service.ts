import { createHash } from 'node:crypto'
import { mkdirSync, readFileSync, realpathSync } from 'node:fs'
import { basename, join, relative, isAbsolute } from 'node:path'
import { asProjectId, createAsset, type LinguistGenerationProvenance, type LinguistTagProfile } from '@linguist/cat-core'
import { serializeXlsxFormatConfig } from '@linguist/cat-formats'
import { createDefaultCatFormatRegistry } from './format-registry'
import type { ProjectEventInput, RunMutationChange } from '@linguist/cat-store'
import { writeJsonFileAtomic, writeFileAtomic } from './safe-file'
import { assembleWorkingCopy, bindWorkingBatch, prepareWorkingCopy, readWorkingJson, resumeWorkingCopy, workingCopyPath } from './working-copy'
import { getWorkingCopyReferences, prefetchWorkingCopyReferences } from './working-copy-references'
import { buildWorkingReview, workingReviewInput } from './working-review'
import { copyFileVerified } from './secure-export'
import type { LinguistProjectService } from './project-service'
import { readPickedFileWithinLimit } from './project-file-intake'
import { LINGUIST_FILE_MAX_BYTES } from './contracts'
import { prepareReviewMaterials, type ReviewMaterialsInput } from './review-materials'
import { getProjectLibraryMaterials, syncProjectLibrary } from './project-library'
import { prepareReviewVisuals } from './review-visuals'

export interface WorkingCopyActionInput {
  operation: 'prepare' | 'references' | 'assemble' | 'deliver'
  sourcePath: string
  sourceLocale: string
  targetLocale: string
  previousResultPath?: string
  decisionsPath?: string
  segmentIds?: string[]
  wait?: boolean
  outputDir?: string
  referenceFiles?: ReviewMaterialsInput['referenceFiles']
  contextFiles?: string[]
}

export interface WorkingCopyContext {
  workspaceRoot: string
  sessionId: string
  reportOnly?: boolean
  taskId?: string
  service?: LinguistProjectService
  taskGroupId?: string
  delegatedSegmentIds?: readonly string[]
  referenceProjectId?: string
  tagProfile?: LinguistTagProfile
  project?: { service: LinguistProjectService; projectId: string }
  provenance?: LinguistGenerationProvenance & { runId: string; toolCallId: string }
  onMutation?: (event: ProjectEventInput) => void
}

/** The Host supplies the bound DSH Session workspace on every call. */
export async function executeWorkingCopyAction(
  input: WorkingCopyActionInput,
  resolveContext: () => WorkingCopyContext,
  signal?: AbortSignal,
) {
  if (signal?.aborted) throw new Error('操作已停止')
  if ((input.operation === 'assemble' || input.operation === 'deliver') && input.decisionsPath === undefined) throw new Error(`${input.operation} 需要 decisionsPath`)
  if (input.operation === 'prepare' && input.previousResultPath !== undefined) throw new Error('工作稿接续使用 assemble 和 previousResultPath，sourcePath 仍是原文件')
  const context = resolveContext()
  const previous = input.previousResultPath === undefined ? undefined : readWorkingJson(context.workspaceRoot, input.previousResultPath)
  const previousScope = previous?.value as Partial<import('./working-copy').LinguistWorkingCopy> | undefined
  if (context.project && input.operation !== 'prepare' && input.previousResultPath === undefined) throw new Error('请通过 previousResultPath 指定已审读的 prepare 或 assemble 快照')
  if (context.reportOnly && (input.operation === 'assemble' || input.operation === 'deliver')) throw new Error('当前任务只报告问题，不能写入或交付译稿')
  if (input.operation === 'deliver' && !context.project && !context.referenceProjectId) throw new Error('原格式交付需要绑定本地化项目')
  if (input.operation === 'deliver' && !previous) throw new Error('交付需要指向当前已审读的工作稿')
  const scopedSource = context.project && context.delegatedSegmentIds ? await readPickedFileWithinLimit(workingCopyPath(context.workspaceRoot, input.sourcePath), LINGUIST_FILE_MAX_BYTES) : undefined
  if (scopedSource && context.project && context.delegatedSegmentIds) {
    const db = context.project.service.openProject(context.project.projectId)
    const asset = db.assets.findBySource(createHash('sha256').update(scopedSource.bytes).digest('hex'), context.taskGroupId)
    const allowed = new Set(context.delegatedSegmentIds)
    if (!asset || db.segments.queryIds({ assetId: asset.id }).some(id => !allowed.has(id))) throw new Error('整份工作稿超过已委派的句段范围，请使用当前句段的审校材料')
  }
  if (input.operation === 'references' && (!context.project || input.referenceFiles || input.contextFiles || input.outputDir || input.sourcePath.toLowerCase().endsWith('.xlsx'))) {
    const service = context.service ?? context.project?.service
    if (!service) throw new Error('工作稿参考资料需要 Linguist 服务')
    return prepareReviewMaterials(service, { workspaceRoot: context.workspaceRoot, taskGroupId: context.taskGroupId, taskId: context.taskId ?? context.sessionId,
      ...(context.project || context.referenceProjectId ? { projectId: context.project?.projectId ?? context.referenceProjectId } : {}), sourcePath: input.sourcePath,
      sourceLocale: input.sourceLocale, targetLocale: input.targetLocale,
      ...(input.previousResultPath ? { previousResultPath: input.previousResultPath } : {}),
      ...(input.outputDir ? { outputDir: input.outputDir } : {}),
      ...(input.referenceFiles ? { referenceFiles: input.referenceFiles } : {}),
      ...(input.contextFiles ? { contextFiles: input.contextFiles } : {}),
      ...(input.segmentIds ? { segmentIds: input.segmentIds } : {}),
    }, signal)
  }
  if (input.operation === 'deliver' && !context.provenance) throw new Error('交付缺少宿主执行身份')
  if (context.sessionId === '' || context.sessionId === '.' || context.sessionId === '..' || context.sessionId.includes('/') || context.sessionId.includes('\\')) {
    throw new Error('无效的会话身份')
  }
  const assertCurrent = (): void => {
    if (signal?.aborted) throw new Error('操作已停止')
    const current = resolveContext()
    if (current.workspaceRoot !== context.workspaceRoot || current.sessionId !== context.sessionId || current.taskGroupId !== context.taskGroupId
      || current.referenceProjectId !== context.referenceProjectId || current.project?.projectId !== context.project?.projectId || current.project?.service !== context.project?.service) throw new Error('工作区绑定已变化')
  }
  let baseline
  if (context.project) {
    const { service, projectId } = context.project
    const project = service.getProject(projectId)
    if (project.sourceLocale !== input.sourceLocale || project.targetLocale !== input.targetLocale) throw new Error('工作稿语言对与绑定项目不一致')
    const sourceData = scopedSource ?? await readPickedFileWithinLimit(workingCopyPath(context.workspaceRoot, input.sourcePath), LINGUIST_FILE_MAX_BYTES)
    const source = sourceData.bytes
    const sourceSha256 = createHash('sha256').update(source).digest('hex')
    const db = service.openProject(projectId)
    const group = context.taskGroupId ?? 'ungrouped'
    const existing = db.assets.findBySource(sourceSha256, group)
    if (previousScope && (previousScope.assetId !== existing?.id || (previousScope.taskGroupId ?? 'ungrouped') !== group)) throw new Error('批次归属已变化或工作稿来自其他任务组，请重新准备当前稿件与资料')
    baseline = await prepareWorkingCopy({ ...input, workspaceRoot: context.workspaceRoot, sourceData,
      ...(existing?.formatConfigJson === undefined ? {} : { formatConfigJson: existing.formatConfigJson }) })
    assertCurrent()
    let assetId: string | undefined = existing?.id
    if (assetId === undefined) {
      const imported = await service.importAsset(projectId, { bytes: source, taskGroupId: context.taskGroupId, filename: basename(baseline.sourcePath), onProgress: async () => assertCurrent() })
      assetId = imported.assetId
      if (imported.status === 'imported') context.onMutation?.({ kind: 'asset-updated' })
    }
    baseline = { ...baseline, projectId, taskGroupId: context.taskGroupId ?? 'ungrouped', assetId, segments: db.segments.query({ assetId, limit: baseline.segments.length }) }
  } else {
    const data = await readPickedFileWithinLimit(workingCopyPath(context.workspaceRoot, input.sourcePath), LINGUIST_FILE_MAX_BYTES)
    const mapping = context.referenceProjectId && context.service && data.filename.toLowerCase().endsWith('.xlsx')
      ? await context.service.resolveWorkbookMapping(context.referenceProjectId, data.bytes, data.filename, true) : undefined
    baseline = await prepareWorkingCopy({ ...input, workspaceRoot: context.workspaceRoot, sourceData: data,
      ...(mapping ? { formatConfigJson: serializeXlsxFormatConfig({ version: 1, ...mapping }) } : {}) })
  }
  if (!context.project && context.referenceProjectId && context.service) {
    const group = context.taskGroupId ?? 'ungrouped'
    if (previousScope?.taskGroupId && previousScope.taskGroupId !== group) throw new Error('上阶段工作稿属于其他任务组，请按当前范围准备')
    if (previousScope?.batchId && context.service.openProject(context.referenceProjectId).taskGroups.groupOf(previousScope.batchId) !== group) throw new Error('工作稿的批次归属已变化，请重新准备')
    if (!previousScope || previousScope.batchId) baseline = bindWorkingBatch(context.service, context.referenceProjectId, group, baseline)
  }
  const decisions = input.operation === 'assemble' || input.operation === 'deliver' ? readWorkingJson(context.workspaceRoot, input.decisionsPath!) : undefined
  const tagProfile = context.project ? context.project.service.getProject(context.project.projectId).tagProfile : context.tagProfile
  const assembled = input.operation === 'assemble'
    ? assembleWorkingCopy(baseline, decisions!.value, tagProfile, previous)
    : undefined
  const result = assembled ?? baseline
  assertCurrent()
  const root = realpathSync(context.workspaceRoot)
  const parts = ['.linguist', 'working-copies', baseline.sourceSha256, ...(context.taskGroupId ? [context.taskGroupId] : []), context.sessionId]
  let parent = root
  for (const part of parts) {
    const child = join(parent, part)
    mkdirSync(child, { recursive: true })
    parent = realpathSync(child)
    const within = relative(root, parent)
    if (within.startsWith('..') || isAbsolute(within)) throw new Error('工作成果目录越界')
  }
  const output = join(parent, input.operation === 'prepare' ? 'bilingual.json' : input.operation === 'deliver' ? 'delivery.json' : 'result.json')
  if (input.operation === 'references') {
    const allIds = baseline.segments.map(segment => segment.id as string)
    const selectedIds = input.segmentIds ?? allIds
    if (!selectedIds.length || new Set(selectedIds).size !== selectedIds.length || selectedIds.some(id => !allIds.includes(id))) throw new Error('参考资料组必须包含当前工作稿中不重复的句段 ID')
    const currentDraft = resumeWorkingCopy(baseline, previous!.value, tagProfile)
    const { service, projectId } = context.project!
    await syncProjectLibrary(service, projectId, context.workspaceRoot, [], { taskGroupId: baseline.taskGroupId })
    const group = baseline.taskGroupId!
    const groups = service.openProject(projectId).taskGroups
    const materialVersion = groups.materialVersion(group)
    const { items, semantic } = await getWorkingCopyReferences({ service, projectId, taskId: context.taskId ?? context.sessionId,
      sourceSha256: baseline.sourceSha256, allIds, selectedIds, wait: input.wait !== false, signal })
    assertCurrent()
    if (readWorkingJson(context.workspaceRoot, input.previousResultPath!).sha256 !== previous!.sha256) throw new Error('审读工作稿已变化，请重新读取')
    const latest = service.openProject(projectId).segments.query({ assetId: baseline.assetId!, limit: allIds.length })
    resumeWorkingCopy({ ...baseline, segments: latest }, previous!.value, tagProfile)
    const selected = new Set(selectedIds)
    const segments = currentDraft.segments.filter(segment => selected.has(segment.id))
    const scopedSemantic = semantic.status === 'ready' ? { ...semantic, groups: semantic.groups
      .filter(group => selected.has(group.anchorId))
      .map(group => ({ ...group, segmentIds: group.segmentIds.filter(id => selected.has(id)) }))
      .filter(group => group.segmentIds.length > 1) } : semantic
    const targets = new Map(segments.map(segment => [segment.id as string, segment.target]))
    const shared = { context: {}, voices: {}, neighbors: {} }
    const projectRules = new Map()
    const compactItems = items.map(item => {
      if (item.status !== 'ready') return item
      for (const kind of ['context', 'voices', 'neighbors'] as const) Object.assign(shared[kind], item.shared[kind])
      for (const rule of item.projectRules) projectRules.set(`${rule.ruleId}@${rule.version}`, rule)
      const { shared: _shared, projectRules: _rules, ...entry } = item
      return { ...entry, currentTarget: targets.get(item.segmentId)! }
    })
    const library = await getProjectLibraryMaterials(service, projectId, context.workspaceRoot,
      segments.map(row => ({ id: row.id, text: [row.source, row.target, row.key, JSON.stringify(row.context)].filter(Boolean).join('\n') })), signal, group)
    const visual = await prepareReviewVisuals(context.workspaceRoot, library.contextFiles, segments)
    if (groups.materialVersion(group) !== materialVersion || groups.groupOf(baseline.assetId) !== group) throw new Error('资料或批次归属在准备时已变化，请重新读取')
    const reference = { taskGroupId: group, materialVersion, assetId: baseline.assetId, artifactKind: 'linguist-working-references', sourceSha256: baseline.sourceSha256, library, visual,
      workingCopySha256: previous!.sha256, items: compactItems, shared, projectRules: [...projectRules.values()], semantic: scopedSemantic,
      note: '参考数据须实际读取；预取和本文件路径不证明已阅读。空数组表示按当前条件检索无命中，pending 表示尚未完成。' }
    const artifactSha256 = createHash('sha256').update(JSON.stringify(reference, null, 2)).digest('hex')
    const referenceOutput = join(parent, `references-${artifactSha256}.json`)
    writeJsonFileAtomic(referenceOutput, reference)
    const review = buildWorkingReview(segments, items, scopedSemantic, undefined, visual, library)
    const reviewDirectory = join(parent, `review-${artifactSha256}`)
    mkdirSync(reviewDirectory, { recursive: true })
    const within = relative(root, realpathSync(reviewDirectory))
    if (within.startsWith('..') || isAbsolute(within)) throw new Error('工作材料目录越界')
    for (const file of review.files) writeFileAtomic(join(reviewDirectory, file.name), file.text)
    return { ...workingReviewInput(review, relative(root, reviewDirectory)), path: relative(root, referenceOutput), artifactSha256,
      readingPath: relative(root, join(reviewDirectory, 'index.md')), readingGroups: review.groups,
      sourceSha256: baseline.sourceSha256, segments: selectedIds.length, format: baseline.formatId, warnings: baseline.warnings,
      ready: items.filter(item => item.status === 'ready').length, pending: items.filter(item => item.status === 'pending').length,
      failed: items.filter(item => item.status === 'failed').length,
      semantic: scopedSemantic.status === 'ready'
        ? { status: 'ready', groups: scopedSemantic.groups.length, embedded: scopedSemantic.embedded, cached: scopedSemantic.cached }
        : scopedSemantic }
  }
  if (input.operation === 'deliver' && !context.project) {
    const projectId = context.referenceProjectId!
    const assembled = assembleWorkingCopy(baseline, decisions!.value, tagProfile, previous)
    if (assembled.coverage.undecided || assembled.coverage.blocked || assembled.unresolved.length) throw new Error('交付需要完整裁定，且没有阻断或待解决问题')
    const { bytes: originalBytes, filename } = await readPickedFileWithinLimit(workingCopyPath(root, input.sourcePath), LINGUIST_FILE_MAX_BYTES)
    if (createHash('sha256').update(originalBytes).digest('hex') !== baseline.sourceSha256) throw new Error('原文件已变化，请核对当前工作稿')
    const adapter = createDefaultCatFormatRegistry().get(baseline.formatId)!
    const mapping = filename.toLowerCase().endsWith('.xlsx') && context.service
      ? await context.service.resolveWorkbookMapping(projectId, originalBytes, filename, true) : undefined
    const original = await adapter.import({ bytes: originalBytes, filename, sourceLocale: input.sourceLocale, targetLocale: input.targetLocale,
      ...(mapping ? { formatConfigJson: serializeXlsxFormatConfig({ version: 1, ...mapping }) } : {}) })
    const asset = createAsset({ ...original.asset, id: assembled.segments[0]!.assetId, projectId: asProjectId(projectId) })
    const bytes = await adapter.export({ originalBytes, asset, segments: assembled.segments })
    const verified = await adapter.import({ bytes, filename, sourceLocale: input.sourceLocale, targetLocale: input.targetLocale, formatConfigJson: asset.formatConfigJson })
    if (verified.segments.length !== assembled.segments.length || verified.segments.some((row, index) => {
      const expected = assembled.segments[index]!
      return row.key !== expected.key || row.source !== expected.source || row.target !== expected.target || row.locked !== expected.locked
    })) throw new Error('交付文件重新读取时，稳定标识、源译文或锁定与工作稿不一致')
    assertCurrent()
    if (readWorkingJson(root, input.previousResultPath!).sha256 !== previous!.sha256) throw new Error('交付时工作稿已变化，请重新读取')
    const hash = createHash('sha256').update(bytes).digest('hex')
    const destination = join(parent, `${hash.slice(0, 16)}-${filename}`)
    writeFileAtomic(destination, bytes)
    const artifact = { path: relative(root, destination), artifactSha256: hash, sourceSha256: baseline.sourceSha256, projectId,
      segments: assembled.segments.length, format: baseline.formatId, warnings: baseline.warnings,
      coverage: assembled.coverage, externalSubmitted: false, verifiedByReimport: true }
    writeJsonFileAtomic(output, { ...assembled, delivery: artifact, execution: context.provenance })
    return { ...artifact, reviewPath: relative(root, output) }
  }
  if (input.operation === 'deliver') {
    const { service, projectId } = context.project!
    service.assertProjectWritable(projectId)
    const db = service.openProject(projectId)
    const provenance = { ...context.provenance!, sessionId: context.sessionId }
    const mutation = db.runs.executeMutation({
      identity: { runId: provenance.runId, toolCallId: provenance.toolCallId, idempotencyKey: `working-copy:${provenance.runId}:${provenance.toolCallId}` },
      operation: 'linguist_working_copy_deliver',
      payload: { sourceSha256: baseline.sourceSha256, previousResultSha256: previous!.sha256, decisions: decisions!.value },
      mutate: () => {
        const assembled = assembleWorkingCopy(baseline, decisions!.value, service.getProject(projectId).tagProfile, previous)
        if (assembled.coverage.undecided > 0 || assembled.coverage.blocked > 0 || assembled.unresolved.length > 0) throw new Error('交付需要完整明确裁定，且没有阻断或待解决问题')
        const beforeById = new Map(baseline.segments.map(segment => [segment.id as string, segment]))
        for (const before of baseline.segments) {
          const current = db.segments.getById(before.id)!
          if (current.revision !== before.revision || current.target !== before.target || current.locked !== before.locked) throw new Error(`CAT 当前译文、原版本或锁已变化：${before.id}`)
        }
        const changes: RunMutationChange[] = []
        const proposalIds: string[] = []
        for (let offset = 0; offset < assembled.finalChanges.length; offset += 200) {
          const edits = assembled.finalChanges.slice(offset, offset + 200)
          const applied = db.proposals.applyTranslations(edits, { ...provenance, tagProfile: service.getProject(projectId).tagProfile, issuance: provenance })
          if (applied.applied !== edits.length) throw new Error(`CAT 写回失败：${JSON.stringify({ stale: applied.stale, locked: applied.locked, failed: applied.failed })}`)
          for (const item of applied.appliedItems ?? []) {
            const reuse = assembled.tmReuses.find(entry => entry.segmentId === item.segmentId)
            if (reuse) db.tmUnits.recordReuse(reuse.tmUnitId, beforeById.get(item.segmentId)!, reuse.target, {
              runId: provenance.runId, segmentId: item.segmentId, revision: item.revision, actor: context.sessionId,
            })
          }
          proposalIds.push(...applied.proposalIds)
          for (const id of applied.proposalIds) {
            const proposal = db.proposals.getById(id)!
            const current = db.segments.getById(proposal.segmentId)!
            changes.push({ entityType: 'proposal', entityId: proposal.id, changeKind: 'created', segmentId: proposal.segmentId, expectedRevision: proposal.baseRevision, after: proposal },
              { entityType: 'segment', entityId: current.id, changeKind: 'updated', segmentId: current.id, expectedRevision: current.revision, before: beforeById.get(current.id)!, after: current })
          }
        }
        return {
          result: { ...assembled, segments: db.segments.query({ assetId: baseline.assetId!, limit: baseline.segments.length }), submitted: true, externalSubmitted: false,
            nextAction: 'CAT 当前译文与工作稿一致；专业阶段状态与平台提交以各自真实回执为准。' },
          changes,
          ...(changes.length === 0 ? {} : { event: { kind: 'project-updated' as const, segmentIds: assembled.finalChanges.map(edit => edit.segmentId), proposalIds } }),
        }
      },
    })
    if (mutation.event && !mutation.replayed) context.onMutation?.(mutation.event)
    const delivered = mutation.result
    writeJsonFileAtomic(output, delivered)
    const staged = await service.stageExport(projectId, baseline.assetId!)
    assertCurrent()
    for (const before of delivered.segments) {
      const current = db.segments.getById(before.id)!
      if (current.revision !== before.revision || current.target !== before.target) throw new Error(`导出期间 CAT 译文已变化；已保存工作稿：${relative(root, output)}`)
    }
    const destination = join(parent, `${staged.artifact.sha256.slice(0, 16)}-${staged.suggestedFilename}`)
    const delivery = copyFileVerified({ managedRoot: service.rootDir, sourcePath: staged.stagingPath, destinationPath: destination, expectedSha256: staged.artifact.sha256, overwrite: true })
    writeJsonFileAtomic(output, { ...delivered, delivery: { path: relative(root, destination), ...delivery, verification: staged.verification } })
    return { path: relative(root, destination), artifactSha256: delivery.sha256, sourceSha256: baseline.sourceSha256,
      segments: baseline.segments.length, format: baseline.formatId, warnings: baseline.warnings,
      reviewPath: relative(root, output), reviewSha256: createHash('sha256').update(readFileSync(output)).digest('hex'), projectId, assetId: baseline.assetId, coverage: delivered.coverage,
      finalChangeCount: delivered.finalChanges.length, submitted: true, externalSubmitted: false, verification: staged.verification,
      nextAction: delivered.nextAction }
  }
  writeJsonFileAtomic(output, assembled ? { ...assembled, execution: context.provenance } : result)
  if (input.operation === 'prepare' && context.project) {
    prefetchWorkingCopyReferences(context.project.service, context.project.projectId, context.taskId ?? context.sessionId,
      baseline.sourceSha256, baseline.segments.map(segment => segment.id as string))
  }
  return {
    path: relative(root, output),
    artifactSha256: createHash('sha256').update(readFileSync(output)).digest('hex'),
    sourceSha256: baseline.sourceSha256,
    segments: baseline.segments.length,
    format: baseline.formatId,
    warnings: baseline.warnings,
    ...(baseline.projectId ? { projectId: baseline.projectId, assetId: baseline.assetId, batchId: baseline.batchId ?? baseline.assetId, taskGroupId: baseline.taskGroupId } : {}),
    ...(input.operation === 'prepare' ? { referenceStatus: context.project ? 'pending' : 'unavailable' } : {}),
    ...(assembled ? { coverage: assembled.coverage, finalChangeCount: assembled.finalChanges.length, submitted: false, nextAction: assembled.nextAction } : {}),
  }
}
