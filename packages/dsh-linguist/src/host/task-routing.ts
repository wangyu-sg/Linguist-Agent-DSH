import { FormatAmbiguousError, FormatParseError, FormatUnsupportedError } from '@linguist/cat-formats'
import { createDefaultCatFormatRegistry, readPickedFileWithinLimit, workingCopyPath, type LinguistProjectService } from '@linguist/domain-service'
import { LINGUIST_FILE_MAX_BYTES } from '@linguist/domain-service/contracts'
import type { LinguistWorkMode, SessionBinding } from './bindings'

export function workModeInstruction(text: string | undefined): LinguistWorkMode | 'auto' | undefined {
  for (const part of text?.split(/[。！？!?；;\n]/u) ?? []) {
    const sentence = part.trim()
    if (/^(?:请\s*)?(?:由你|你来|你自行|自行)(?:决定|选择)(?:工作方式|开工方式|怎么开工)?$/u.test(sentence) ||
        /^(?:please\s+)?(?:you choose|you decide|choose the working mode)$/iu.test(sentence)) return 'auto'
    if (/(?:还是|或者|\bor\b)/iu.test(sentence)) continue
    const label = (/^(CAT|工作副本|浏览器|working[- ]copy|browser)$/iu.exec(sentence)?.[1]
      ?? /^(?:(?:这次|本次|这批|请|就)\s*)*(?:采用|使用|用|走|选择|选|use\s+|choose\s+)\s*(CAT\b|工作副本|浏览器|working[- ]copy\b|browser\b)/iu.exec(sentence)?.[1])?.toLowerCase()
    if (label === 'cat') return 'cat'
    if (label === '工作副本' || label?.startsWith('working')) return 'working-copy'
    if (label === '浏览器' || label === 'browser') return 'browser'
  }
}

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
