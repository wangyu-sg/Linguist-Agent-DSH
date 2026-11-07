import { createHash } from 'node:crypto'
import { mkdirSync, readFileSync, realpathSync } from 'node:fs'
import { basename, join, relative, isAbsolute } from 'node:path'
import type { LinguistGenerationProvenance, LinguistTagProfile } from '@linguist/cat-core'
import type { ProjectEventInput, RunMutationChange } from '@linguist/cat-store'
import { writeJsonFileAtomic } from './safe-file'
import { assembleWorkingCopy, prepareWorkingCopy, readWorkingJson, workingCopyPath } from './working-copy'
import { copyFileVerified } from './secure-export'
import type { LinguistProjectService } from './project-service'
import { readPickedFileWithinLimit } from './project-file-intake'
import { LINGUIST_FILE_MAX_BYTES } from './contracts'

export interface WorkingCopyActionInput {
  operation: 'prepare' | 'assemble' | 'deliver'
  sourcePath: string
  sourceLocale: string
  targetLocale: string
  previousResultPath?: string
  decisionsPath?: string
}

export interface WorkingCopyContext {
  workspaceRoot: string
  sessionId: string
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
  if (input.operation !== 'prepare' && input.decisionsPath === undefined) throw new Error(`${input.operation} 需要 decisionsPath`)
  if (input.operation === 'prepare' && input.previousResultPath !== undefined) throw new Error('工作稿接续使用 assemble 和 previousResultPath，sourcePath 仍是原文件')
  const context = resolveContext()
  if (context.project && input.operation !== 'prepare' && input.previousResultPath === undefined) throw new Error('请通过 previousResultPath 指定已审读的 prepare 或 assemble 快照')
  if (input.operation === 'deliver' && !context.project) throw new Error('原格式交付需要绑定本地化项目；普通工作区仍可准备和接续工作稿')
  if (input.operation === 'deliver' && !context.provenance) throw new Error('交付缺少宿主执行身份')
  if (context.sessionId === '' || context.sessionId === '.' || context.sessionId === '..' || context.sessionId.includes('/') || context.sessionId.includes('\\')) {
    throw new Error('无效的会话身份')
  }
  const assertCurrent = (): void => {
    if (signal?.aborted) throw new Error('操作已停止')
    const current = resolveContext()
    if (current.workspaceRoot !== context.workspaceRoot || current.sessionId !== context.sessionId
      || current.project?.projectId !== context.project?.projectId || current.project?.service !== context.project?.service) throw new Error('工作区绑定已变化')
  }
  let baseline
  if (context.project) {
    const { service, projectId } = context.project
    const project = service.getProject(projectId)
    if (project.sourceLocale !== input.sourceLocale || project.targetLocale !== input.targetLocale) throw new Error('工作稿语言对与绑定项目不一致')
    const { bytes: source } = await readPickedFileWithinLimit(workingCopyPath(context.workspaceRoot, input.sourcePath), LINGUIST_FILE_MAX_BYTES)
    const sourceSha256 = createHash('sha256').update(source).digest('hex')
    const db = service.openProject(projectId)
    const existing = db.assets.listByProject().find(asset => asset.sourceSha256 === sourceSha256)
    baseline = await prepareWorkingCopy({ ...input, workspaceRoot: context.workspaceRoot,
      ...(existing?.formatConfigJson === undefined ? {} : { formatConfigJson: existing.formatConfigJson }) })
    if (sourceSha256 !== baseline.sourceSha256) throw new Error('原文件已变化，请重新准备工作稿')
    assertCurrent()
    let assetId: string | undefined = existing?.id
    if (assetId === undefined) {
      const imported = await service.importAsset(projectId, { bytes: source, filename: basename(baseline.sourcePath), onProgress: async () => assertCurrent() })
      assetId = imported.assetId
      if (imported.status === 'imported') context.onMutation?.({ kind: 'asset-updated' })
    }
    baseline = { ...baseline, projectId, assetId, segments: db.segments.query({ assetId, limit: baseline.segments.length }) }
  } else baseline = await prepareWorkingCopy({ ...input, workspaceRoot: context.workspaceRoot })
  const decisions = input.operation === 'prepare' ? undefined : readWorkingJson(context.workspaceRoot, input.decisionsPath!)
  const previous = input.previousResultPath === undefined ? undefined : readWorkingJson(context.workspaceRoot, input.previousResultPath)
  const tagProfile = context.project ? context.project.service.getProject(context.project.projectId).tagProfile : context.tagProfile
  const assembled = input.operation === 'assemble'
    ? assembleWorkingCopy(baseline, decisions!.value, tagProfile, previous)
    : undefined
  const result = assembled ?? baseline
  assertCurrent()
  const root = realpathSync(context.workspaceRoot)
  const parts = ['.linguist', 'working-copies', baseline.sourceSha256, context.sessionId]
  let parent = root
  for (const part of parts) {
    const child = join(parent, part)
    mkdirSync(child, { recursive: true })
    parent = realpathSync(child)
    const within = relative(root, parent)
    if (within.startsWith('..') || isAbsolute(within)) throw new Error('工作成果目录越界')
  }
  const output = join(parent, input.operation === 'prepare' ? 'bilingual.json' : input.operation === 'deliver' ? 'delivery.json' : 'result.json')
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
  writeJsonFileAtomic(output, result)
  return {
    path: relative(root, output),
    artifactSha256: createHash('sha256').update(readFileSync(output)).digest('hex'),
    sourceSha256: baseline.sourceSha256,
    segments: baseline.segments.length,
    format: baseline.formatId,
    warnings: baseline.warnings,
    ...(context.project ? { projectId: baseline.projectId, assetId: baseline.assetId } : {}),
    ...(assembled ? { coverage: assembled.coverage, finalChangeCount: assembled.finalChanges.length, submitted: false, nextAction: assembled.nextAction } : {}),
  }
}
