import { dirname } from 'node:path'
import { checkSemanticModel, disposeWorkingCopyReferences, semanticCachePath, type LinguistProjectService } from '@linguist/domain-service'

export const SETTINGS_OPERATIONS = ['linguistSettingsGet', 'linguistSettingsSemantic', 'linguistSettingsClearCache', 'linguistSettingsCheckModel', 'linguistCatRelated'] as const

export async function settingsOperation(service: LinguistProjectService, operation: string, input: Record<string, unknown>) {
  if (operation === 'linguistSettingsSemantic') {
    if (typeof input.enabled !== 'boolean') throw new Error('enabled 必须是布尔值')
    await service.reviewCache.setEnabled(input.enabled)
    disposeWorkingCopyReferences(service)
    return { enabled: service.reviewCache.enabled }
  }
  if (operation === 'linguistSettingsCheckModel') return checkSemanticModel()
  if (operation === 'linguistSettingsGet') return {
    dataRoot: dirname(service.rootDir), semanticEnabled: service.reviewCache.enabled, model: 'gpahal/bge-m3-onnx-int8',
    projects: service.listProjects().map(project => ({ id: project.id, name: project.name, cache: service.reviewCache.info(semanticCachePath(service, project.id)) })),
    onlineCache: service.reviewCache.info(semanticCachePath(service)),
  }
  if (input.projectId !== undefined && (typeof input.projectId !== 'string' || !/^prj-[a-f0-9]{16}$/.test(input.projectId))) throw new Error('项目 ID 无效')
  const id = input.projectId as string | undefined
  if (id) service.getProject(id)
  if (operation === 'linguistSettingsClearCache') {
    if (id) disposeWorkingCopyReferences(service, id)
    await service.reviewCache.clear(semanticCachePath(service, id))
    return { cleared: true }
  }
  if (operation === 'linguistCatRelated') {
    if (!id || typeof input.segmentId !== 'string') throw new Error('需要项目和句段 ID')
    const db = service.openProject(id)
    const selected = db.segments.getById(input.segmentId)
    if (!selected) throw new Error('句段不存在')
    const ids = db.segments.queryIds({ assetId: selected.assetId })
    const rows = db.segments.getByIds(ids)
    const semantic = await service.reviewCache.get(semanticCachePath(service, id), rows)
    if (semantic.status !== 'ready') return { ...semantic, segments: [] }
    const related = [...new Set(semantic.groups.filter(group => group.segmentIds.includes(selected.id)).flatMap(group => group.segmentIds))]
      .filter(candidate => candidate !== selected.id)
    return { status: 'ready', scope: ids.length,
      segments: db.segments.getByIds(related).map(({ id, ordinal, key, source, target, context }) => ({ id, ordinal, key, source, target, context })) }
  }
  throw new Error('未知 LA 设置操作')
}
