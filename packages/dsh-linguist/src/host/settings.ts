import { dirname } from 'node:path'
import { clearGroupReviewMaterials, checkSemanticModel, disposeWorkingCopyReferences, semanticCachePath, type LinguistProjectService } from '@linguist/domain-service'

export const SETTINGS_OPERATIONS = ['linguistSettingsGet', 'linguistSettingsSemantic', 'linguistSettingsClearCache', 'linguistSettingsCheckModel', 'linguistRetrievalProgress', 'linguistCatRelated'] as const

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
  if (operation === 'linguistRetrievalProgress') {
    if (!id || typeof input.taskGroupId !== 'string') throw new Error('需要项目和任务组范围')
    return service.reviewCache.activeProgress(semanticCachePath(service, id), input.taskGroupId)
  }
  if (id) service.getProject(id)
  if (operation === 'linguistSettingsClearCache') {
    const group = input.taskGroupId
    if (group !== undefined && (typeof group !== 'string' || !id || !service.openProject(id).taskGroups.list().some(item => item.id === group))) throw new Error('任务组不存在')
    if (id) clearGroupReviewMaterials(service, id, group)
    await service.reviewCache.clear(semanticCachePath(service, id), group)
    return { cleared: true }
  }
  if (operation === 'linguistCatRelated') {
    if (!id || typeof input.segmentId !== 'string') throw new Error('需要项目和句段 ID')
    const db = service.openProject(id)
    const selected = db.segments.getById(input.segmentId)
    if (!selected) throw new Error('句段不存在')
    const ids = db.segments.queryIds({ assetId: selected.assetId })
    const rows = db.segments.getByIds(ids)
    const semantic = await service.reviewCache.get(semanticCachePath(service, id), rows, undefined, db.taskGroups.groupOf(selected.assetId))
    if (semantic.status !== 'ready') return { ...semantic, segments: [] }
    const related = [...new Set(semantic.groups.filter(group => group.segmentIds.includes(selected.id)).flatMap(group => group.segmentIds))]
      .filter(candidate => candidate !== selected.id)
    return { status: 'ready', scope: ids.length,
      segments: db.segments.getByIds(related).map(({ id, ordinal, key, source, target, context }) => ({ id, ordinal, key, source, target, context })) }
  }
  throw new Error('未知 LA 设置操作')
}
