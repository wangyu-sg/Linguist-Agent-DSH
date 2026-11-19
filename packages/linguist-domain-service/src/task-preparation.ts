import { createHash } from 'node:crypto'
import { join } from 'node:path'
import { z } from 'zod'
import { scanTagTokens } from '@linguist/cat-core'
import type { LinguistProjectService } from './project-service'
import type { XlsxImportMapping } from './project-service-types'
import { readWorkingJson, workingCopyPath } from './working-copy'
import { readPickedFileWithinLimit } from './project-file-intake'
import { LINGUIST_FILE_MAX_BYTES } from './contracts'
import { executeWorkingCopyAction } from './working-copy-service'
import { writeJsonFileAtomic } from './safe-file'

const PlatformLocks = z.object({ segments: z.array(z.object({
  id: z.string().min(1), key: z.string().min(1).optional(), source: z.string(), target: z.string(), locked: z.boolean(),
})).min(1) })

/** Import the original as a managed copy, then attach verified platform locks by stable key. */
export async function prepareCatTask(service: LinguistProjectService, input: {
  projectId: string; taskGroupId?: string; workspaceRoot: string; sessionId: string; sourcePath: string; platformSnapshotPath?: string
  xlsxMapping?: XlsxImportMapping; phraseMasterPath?: string
  sourceData?: { bytes: Uint8Array; filename: string }; phraseMaster?: { bytes: Uint8Array; filename: string }
}) {
  const { projectId, workspaceRoot, sessionId, sourcePath } = input
  const project = service.getProject(projectId)
  const languages = { sourceLocale: project.sourceLocale, targetLocale: project.targetLocale }
  const sourceData = input.sourceData ?? await readPickedFileWithinLimit(workingCopyPath(workspaceRoot, sourcePath), LINGUIST_FILE_MAX_BYTES)
  const xlsxMapping = input.xlsxMapping ?? (sourceData.filename.toLowerCase().endsWith('.xlsx')
    ? await service.resolveWorkbookMapping(projectId, sourceData.bytes, sourceData.filename) : undefined)
  const phraseMaster = input.phraseMaster ?? (input.phraseMasterPath
    ? await readPickedFileWithinLimit(workingCopyPath(workspaceRoot, input.phraseMasterPath), LINGUIST_FILE_MAX_BYTES) : undefined)
  const imported = await service.importAsset(projectId, { ...sourceData, xlsxMapping, phraseMaster, taskGroupId: input.taskGroupId })
  const db = service.openProject(projectId)
  let segments = db.segments.query({ assetId: imported.assetId, limit: imported.segmentCount })
  const snapshot = input.platformSnapshotPath ? readWorkingJson(workspaceRoot, input.platformSnapshotPath) : undefined
  const platform = snapshot ? PlatformLocks.parse(snapshot.value).segments : undefined
  if (platform) {
    if (platform.length !== segments.length || new Set(platform.map(row => row.id)).size !== platform.length
      || new Set(platform.map(row => row.key ?? row.id)).size !== platform.length) throw new Error('平台锁定快照须覆盖整份导出，稳定 ID 与文件 key 均不能重复')
    const byKey = new Map(segments.map(row => [row.key, row]))
    for (const row of platform) {
      const file = byKey.get(row.key ?? row.id)
      if (!file || file.source !== row.source || file.target !== row.target) throw new Error(`平台与导出不一致：${row.id}。请核对稳定 key 与当前源译文，不按行号猜测对应。`)
    }
  }
  if (platform) {
    const byKey = new Map(platform.map(row => [row.key ?? row.id, row]))
    db.catDb.transaction('apply platform locks to managed copy', () => {
      for (const row of segments) if (byKey.get(row.key!)!.locked) db.segments.setLocked(row.id, true)
    })
    writeJsonFileAtomic(join(service.getProjectPaths(projectId).projectDir, `platform-${imported.assetId}.json`), {
      sourceSha256: imported.sourceSha256, snapshotSha256: snapshot!.sha256,
      rows: segments.map(row => ({ segmentId: row.id, key: row.key, platformId: byKey.get(row.key!)!.id, locked: row.locked || byKey.get(row.key!)!.locked })),
    })
    segments = db.segments.query({ assetId: imported.assetId, limit: imported.segmentCount })
  }
  const workingCopy = await executeWorkingCopyAction({ operation: 'prepare', sourcePath, ...languages }, () => ({
    workspaceRoot, sessionId, service, taskGroupId: input.taskGroupId, project: { service, projectId },
  }))
  const tags = segments.flatMap(row => scanTagTokens(row.source, { profile: project.tagProfile, targetLocale: project.targetLocale })
    .map(tag => ({ key: row.key, family: tag.familyId, text: row.source.slice(tag.start, tag.end) })))
  return { projectId, assetId: imported.assetId, workingCopy,
    preflight: { segments: segments.length, sourceSha256: createHash('sha256').update(sourceData.bytes).digest('hex'),
      lockedKeys: segments.filter(row => row.locked).map(row => row.key),
      platformLocks: platform ? 'verified-by-key-and-text' : 'file-markers-only',
      tagSamples: [...new Set(tags.map(tag => tag.family))].map(family => ({ family,
        occurrences: tags.filter(tag => tag.family === family).length,
        examples: [...new Map(tags.filter(tag => tag.family === family).map(tag => [tag.text, tag])).values()].slice(0, 2) })),
      unknownTags: service.scanUnknownTagPatterns(projectId, [imported.assetId]),
      note: '核对这些标签边界与工作稿中的可译文字。平台导出无锁定标记时须提供平台快照；未提供不代表平台没有锁定。原稿未改，未提交平台。' } }
}
