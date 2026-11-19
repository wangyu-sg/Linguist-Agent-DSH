import { FormatAmbiguousError, FormatParseError, FormatUnsupportedError } from '@linguist/cat-formats'
import { createDefaultCatFormatRegistry, readPickedFileWithinLimit, workingCopyPath, type LinguistProjectService } from '@linguist/domain-service'
import { LINGUIST_FILE_MAX_BYTES } from '@linguist/domain-service/contracts'
import type { LinguistWorkMode, SessionBinding } from './bindings'

export function routeTask(
  binding: Pick<SessionBinding, 'workMode' | 'workModeDecision'>,
  input: { explicit?: LinguistWorkMode; online?: boolean; local?: 'cat' | 'working-copy'; newTask?: boolean },
): Pick<SessionBinding, 'workMode' | 'workModeDecision'> {
  if (input.explicit) return { workMode: input.explicit, workModeDecision: { source: 'user' } }
  if (binding.workModeDecision && (!input.newTask || binding.workModeDecision.source === 'user')) {
    return { workMode: binding.workMode, workModeDecision: binding.workModeDecision }
  }
  const workMode = input.online ? 'browser' : input.local
  return workMode ? { workMode, workModeDecision: { source: 'automatic' } } : { workMode: binding.workMode, workModeDecision: undefined }
}

export async function inspectLocalSource(service: LinguistProjectService, input: Parameters<typeof import('@linguist/domain-service').prepareCatTask>[1]) {
  const read = (path: string) => readPickedFileWithinLimit(workingCopyPath(input.workspaceRoot, path), LINGUIST_FILE_MAX_BYTES)
  try {
    const sourceData = await read(input.sourcePath)
    const xlsxMapping = input.xlsxMapping ?? (sourceData.filename.toLowerCase().endsWith('.xlsx')
      ? await service.resolveWorkbookMapping(input.projectId, sourceData.bytes, sourceData.filename, true) : undefined)
    const phraseMaster = input.phraseMasterPath ? await read(input.phraseMasterPath) : undefined
    await service.previewAssetImport(input.projectId, { ...sourceData, xlsxMapping, phraseMaster, taskGroupId: input.taskGroupId })
    return { mode: 'cat' as const, sourceData, xlsxMapping, phraseMaster }
  } catch (error) {
    if (error instanceof FormatUnsupportedError && !input.xlsxMapping && !input.phraseMasterPath && !input.platformSnapshotPath) {
      const name = input.sourcePath.toLowerCase()
      const requiresReadableStructure = !name.endsWith('.docx') && createDefaultCatFormatRegistry().list().some(adapter =>
        adapter.extensions.some(extension => name.endsWith(extension.toLowerCase())))
      if (!requiresReadableStructure) return { mode: 'working-copy' as const, reason: error.message }
    }
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { mode: 'blocked' as const, reason: '找不到稿件或对应的配套文件' }
    if (error instanceof FormatParseError || error instanceof FormatAmbiguousError || error instanceof FormatUnsupportedError) {
      return { mode: 'blocked' as const, reason: error.message }
    }
    throw error
  }
}
