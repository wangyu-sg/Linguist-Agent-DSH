import { changeTaskGroup, GroupChange } from './task-groups'
import { createHash } from 'node:crypto'
import { basename } from 'node:path'
import { Type, type Static } from 'typebox'
import { Value } from 'typebox/value'
import type { LibraryPreparationOffer } from '@linguist/domain-service/contracts'
import type { ToolDefinition } from '@deepseek-ai/dsh-tools'
import { prepareCatTask, prepareProjectLibrary, syncProjectLibrary, listProjectLibrary, readPickedFileWithinLimit, workingCopyPath, type LinguistProjectService } from '@linguist/domain-service'
import { LINGUIST_FILE_MAX_BYTES } from '@linguist/domain-service/contracts'
import type { BindingStore, SessionBinding } from './bindings'
import { browserBatchIdentity, inspectLocalSource } from './task-routing'
import { projectQuestionText } from './project-question-context'

const Input = Type.Object({
  taskGroupId: Type.Optional(Type.String({ description: 'Session group ID. Empty string selects shared project materials.' })),
  listBatches: Type.Optional(Type.Literal(true, { description: 'Find already registered browser and local batches and their IDs before resuming. Use alone.' })),
  listResourceFiles: Type.Optional(Type.Literal(true, { description: 'Inspect registered resource files and their current availability, without registering or refreshing. Use alone or with taskGroupId. lastReadSha256 identifies the last successful read of a workspace file.' })),
  groupChange: Type.Optional(GroupChange),
  moveResources: Type.Optional(Type.Object({ keys: Type.Array(Type.String(), { minItems: 1 }), to: Type.String({ description: 'Destination group ID, or empty string for project.' }) })),
  query: Type.Optional(Type.String({ minLength: 1, description: 'Look up project evidence for this focused question. Use query alone for a read in the current scope.' })),
  semantic: Type.Optional(Type.Boolean({ description: 'With query, include meaning-based matches when wording or TM/TB evidence is insufficient. A cold index can take time.' })),
  prepareInBackground: Type.Optional(Type.Boolean({ description: 'Set true only when the user explicitly asks to prepare the meaning-based background search in advance. May be combined with registering background files or used alone for the current project/group. Starts immediately and returns without waiting; otherwise registration offers Now/Later in the conversation.' })),
  compareGroups: Type.Optional(Type.Array(Type.String(), { minItems: 2, uniqueItems: true })),
  batchId: Type.Optional(Type.String({ minLength: 1, description: 'Existing batch ID from the project or a prior preparation. Reuse for the same batch when adding a downloaded source to CAT or attaching its explicitly identified browser batch.' })),
  batch: Type.Optional(Type.Object({ kind: Type.Union([Type.Literal('browser'), Type.Literal('working-copy')]), locator: Type.String({ minLength: 1, description: 'For browser use JSON.stringify([origin, native file or job ID]); for a batch of joined jobs use JSON.stringify([origin, ...sorted native IDs]); for local files use the source SHA-256. Reuse the same locator across sessions.' }), name: Type.String({ minLength: 1 }) })),
  removeResource: Type.Optional(Type.String({ description: 'Exact resource key from the returned resources list to remove from project use; original files are retained.' })),
  replaceResource: Type.Optional(Type.String({ description: 'Exact resource key to replace after the single new resource reads successfully.' })),
  sourceLocale: Type.Optional(Type.String()), targetLocale: Type.Optional(Type.String()),
  useCat: Type.Optional(Type.Boolean({ description: 'Set true to import and process this batch in CAT, false for working-copy or browser. Omit to reuse an existing batch choice or current session mode.' })),
  online: Type.Optional(Type.Boolean({ description: 'True when registering or preparing a web platform batch, including read-only collection.' })),
  reportOnly: Type.Optional(Type.Boolean({ description: 'True when the user requests observations only, without changing or confirming targets.' })),
  useRoleDefaults: Type.Optional(Type.Boolean({ description: 'True only if the user expressly chooses LA role defaults. Preserve the current host settings otherwise.' })),
  sources: Type.Optional(Type.Array(Type.Object({ path: Type.String({ minLength: 1 }), platformSnapshotPath: Type.Optional(Type.String()), phraseMasterPath: Type.Optional(Type.String()),
    xlsxMapping: Type.Optional(Type.Object({ sheetName: Type.String(), columns: Type.Object({ source: Type.String(), target: Type.String(), key: Type.Optional(Type.String()), context: Type.Optional(Type.String()), locked: Type.Optional(Type.String()) }) })),
  }, { additionalProperties: false }))),
  resources: Type.Optional(Type.Array(Type.Object({ path: Type.String({ minLength: 1 }),
    kind: Type.Union([Type.Literal('tm'), Type.Literal('terms'), Type.Literal('rules'), Type.Literal('context')]),
    taskGroupId: Type.Optional(Type.String()), replacesInherited: Type.Optional(Type.String()),
    appliesTo: Type.Optional(Type.Array(Type.String({ minLength: 1 }))),
    xlsxMapping: Type.Optional(Type.Object({ sheetName: Type.String(), columns: Type.Object({ source: Type.String(), target: Type.String() }) })),
  }, { additionalProperties: false }))),
}, { additionalProperties: false })

// The native tool executor rejects undefined members, including optional nested fields.
function jsonOutput<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

export function createProjectPreparationTool(service: LinguistProjectService, resolve: (callId: string, useTurnQuestion: boolean) => Promise<{
  workspaceRoot: string; sessionId: string; binding: SessionBinding; segmentIds?: string[]; question?: string; selectedBatchId?: string
}>, bind: (projectId: string, binding: SessionBinding) => void, starts: Pick<BindingStore, 'batchStart' | 'saveBatchStart'>, onChanged?: (projectId: string) => void): ToolDefinition {
  return {
    name: 'linguist_prepare_project',
    description: 'Register or resume formal localization batches and manage project materials. Identify a batch by existing batchId, stable platform batch locator, or local sources; pass useCat when choosing CAT or non-CAT explicitly, or omit it to reuse an existing batch choice or current session mode. Ordinary Q&A, terminology queries and read-only web browsing do not require starting a CAT batch. Use resources to register project material, replaceResource to replace an original, query alone for evidence, and compareGroups to compare groups.',
    parameters: JSON.parse(JSON.stringify(Input)),
    output: {
      schema: { type: 'object', additionalProperties: true },
      render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }],
      presentationMeta: (_args, value) => {
        const preparationOffer = (value as Record<string, typeof value>).preparationOffer
        return preparationOffer ? { linguistLibraryPreparation: preparationOffer } : null
      },
    },
    async execute(args, exec) {
      if (!Value.Check(Input, args)) throw new Error(`Invalid project preparation: ${Value.Errors(Input, args)[0]?.message}`)
      const input = args as Static<typeof Input>
      if (input.semantic && !input.query && !input.compareGroups) throw new Error('语义检索需要查询问题')
      const context = await resolve(String(exec.rootCallId ?? exec.callId), !!input.compareGroups && !input.query)
      if (context.binding.delegatedScope && (input.listBatches || input.groupChange || input.moveResources || input.compareGroups || input.sources || input.batch || input.batchId
        || input.resources || input.online || input.useCat !== undefined || input.reportOnly !== undefined || input.useRoleDefaults !== undefined || input.prepareInBackground || input.removeResource || input.replaceResource || input.taskGroupId !== undefined && input.taskGroupId !== context.binding.taskGroupId)) throw new Error('子任务已冻结范围，项目或任务组维护请交由 General')
      if (input.listBatches) {
        if (Object.keys(input).length !== 1) throw new Error('盘点工作批次请单独调用')
        const { projectId, taskGroupId } = context.binding
        const items = projectId ? service.openProject(projectId).taskGroups.externalBatches(true)
          .filter(batch => !taskGroupId || batch.taskGroupId === taskGroupId) : []
        return { items }
      }
      if (input.listResourceFiles) {
        if (Object.keys(input).some(key => key !== 'listResourceFiles' && key !== 'taskGroupId')) throw new Error('盘点资料仅接受任务组范围')
        const { projectId } = context.binding
        if (!projectId) return { status: 'no-project', resources: [], groups: [] }
        const taskGroupId = input.taskGroupId ?? context.binding.taskGroupId ?? ''
        const { groups, resources } = service.inspectProjectResourceFiles(projectId, context.workspaceRoot, taskGroupId)
        return jsonOutput({ projectId, taskGroupId, groups: context.binding.delegatedScope ? groups.filter(group => group.id === taskGroupId) : groups, resources })
      }
      if (input.query && Object.keys(input).every(key => key === 'query' || key === 'taskGroupId' || key === 'semantic')) {
        const { projectId } = context.binding
        if (!projectId) throw new Error('当前会话尚未绑定项目资料')
        const taskGroupId = (input.taskGroupId ?? context.binding.taskGroupId) || undefined
        if (input.taskGroupId && !service.openProject(projectId).taskGroups.list().some(group => group.id === taskGroupId)) throw new Error('任务组不存在')
        const segmentIds = taskGroupId === context.binding.taskGroupId ? context.segmentIds : undefined
        return jsonOutput({ projectId, taskGroupId, materials: await projectQuestionText(service, projectId, context.workspaceRoot, input.query, segmentIds, taskGroupId, exec.signal, input.semantic) })
      }
      if (input.compareGroups && Object.keys(input).every(key => ['compareGroups', 'query', 'semantic'].includes(key))) {
        const { projectId } = context.binding
        if (!projectId) throw new Error('当前会话尚未绑定项目资料')
        const groups = service.openProject(projectId).taskGroups.list()
        const question = input.query ?? context.question
        return jsonOutput({ projectId, comparison: await Promise.all(input.compareGroups.map(async id => {
          const group = groups.find(item => item.id === id)
          if (!group) throw new Error('比较的任务组不存在')
          return { group, materials: question && await projectQuestionText(service, projectId, context.workspaceRoot, question, undefined, id, exec.signal, input.semantic) }
        })) })
      }
      if (input.prepareInBackground && !input.resources?.length && !context.binding.projectId) throw new Error('当前会话尚未绑定项目资料')
      let project = context.binding.projectId ? service.getProject(context.binding.projectId) : undefined
      const sourceLocale = input.sourceLocale ?? project?.sourceLocale ?? 'und'
      const targetLocale = input.targetLocale ?? project?.targetLocale ?? 'und'
      if (input.resources?.some(resource => resource.kind === 'tm' || resource.kind === 'terms')
        && (sourceLocale === 'und' || targetLocale === 'und')) throw new Error('稿件与 TM／TB 需要本次语言对；一般规则和背景资料无需先确定语言对')
      if (!project) {
        project = await service.createProject({ name: basename(context.workspaceRoot), sourceLocale, targetLocale })
        bind(project.id, { ...context.binding, projectId: project.id })
      }
      else if (project.sourceLocale !== sourceLocale || project.targetLocale !== targetLocale) project = service.setProjectLocales(project.id, sourceLocale, targetLocale)
      const db = service.openProject(project.id)
      const changedId = input.groupChange && changeTaskGroup(service, project.id, input.groupChange)
      let taskGroupId = (input.taskGroupId ?? (input.groupChange?.action === 'create' ? changedId : context.binding.taskGroupId)) || undefined
      if (input.groupChange && ('id' in input.groupChange) && input.groupChange.id === taskGroupId && (input.groupChange.action === 'archive' || input.groupChange.action === 'delete')) taskGroupId = undefined
      if (taskGroupId) db.taskGroups.requireActive(taskGroupId)
      const formal = Boolean(input.sources?.length || input.online || input.batch || input.batchId)
      let reportOnly = input.reportOnly ?? context.binding.reportOnly
      let batchStart = taskGroupId === context.binding.taskGroupId ? context.binding.batchStart : undefined
      let batchId: string | undefined
      let registeredBatch: ReturnType<typeof db.taskGroups.registeredBatch>
      let firstFile: Awaited<ReturnType<typeof readPickedFileWithinLimit>> | undefined
      if (formal) {
        batchId = input.batchId ?? (!input.batch && !input.sources?.length ? context.selectedBatchId : undefined)
        if (batchId) {
          const group = db.taskGroups.groupOf(batchId)
          if (!group || (input.taskGroupId !== undefined && group !== (taskGroupId ?? 'ungrouped'))) throw new Error('工作批次不在当前项目或指定任务组')
          db.taskGroups.requireActive(group)
          taskGroupId = group === 'ungrouped' ? undefined : group
        } else {
          let batch = input.batch
          if (!batch && input.sources?.length && !input.online) {
            firstFile = await readPickedFileWithinLimit(workingCopyPath(context.workspaceRoot, input.sources[0]!.path), LINGUIST_FILE_MAX_BYTES)
            batch = { kind: 'working-copy', locator: createHash('sha256').update(firstFile.bytes).digest('hex'), name: firstFile.filename }
          }
          if (!batch) return { status: 'identify-batch', note: '请提供本批的文件、平台稳定标识或已有批次 ID，再开工。' }
          let group = taskGroupId ?? 'ungrouped'
          if (!taskGroupId && input.taskGroupId === undefined) {
            const matches = db.taskGroups.externalBatches(true).filter(entry => entry.kind === batch.kind && entry.locator === batch.locator)
            if (matches.length > 1) return { status: 'identify-batch', matches, note: '多组有相同稿件或平台标识，请指定本批 ID。' }
            if (matches[0]) {
              group = matches[0].taskGroupId
              taskGroupId = group === 'ungrouped' ? undefined : group
            }
          }
          db.taskGroups.requireActive(group)
          const known = db.taskGroups.findRegisteredBatch(group, batch.kind, batch.locator)
          if (!known) {
            service.assertProjectWritable(project.id)
            db.taskGroups.registerBatch(group, batch.kind, batch.locator, batch.name)
          }
          batchId = db.taskGroups.findRegisteredBatch(group, batch.kind, batch.locator)!.id
        }
        registeredBatch = db.taskGroups.registeredBatch(batchId)
        batchStart = starts.batchStart(project.id, batchId)
          ?? (registeredBatch?.assetId ? starts.batchStart(project.id, registeredBatch.assetId) : undefined)
        if (batchStart) registeredBatch = db.taskGroups.registeredBatch(batchStart.batchId) ?? registeredBatch
        reportOnly = input.reportOnly ?? (context.binding.batchStart?.batchId === (batchStart?.batchId ?? batchId) ? context.binding.reportOnly : undefined)
        const existingAsset = db.assets.get(batchId) ?? (registeredBatch?.assetId ? db.assets.get(registeredBatch.assetId) : undefined)
        const resolvedUseCat = input.useCat
          ?? batchStart?.useCat
          ?? (existingAsset ? true : undefined)
          ?? (input.online && !input.sources?.length ? false : (input.sources?.length && !reportOnly ? context.binding.workMode === 'cat' : undefined))
        if (resolvedUseCat !== undefined && (input.useCat !== undefined || !batchStart) && !(reportOnly && input.useCat === undefined && !existingAsset)) {
          batchStart = { ...(batchStart ?? { batchId }), batchId: batchStart?.batchId ?? batchId, useCat: resolvedUseCat }
          starts.saveBatchStart(project.id, batchStart, registeredBatch?.assetId ?? existingAsset?.id ?? undefined)
        }
        const activeBatchId = batchStart?.batchId ?? batchId
        const onlineBatch = input.batch
        if (input.batchId && onlineBatch?.kind === 'browser') {
          const identity = browserBatchIdentity(onlineBatch.locator)
          if (!identity) throw new Error('请提供平台站点与本批原生文件或作业 ID')
          const [origin, ...nativeIds] = identity
          const group = taskGroupId ?? 'ungrouped'
          const linked = db.taskGroups.browserBatchesFor(group, activeBatchId)
          const otherOwner = db.taskGroups.externalBatches(true).some(batch => {
            if (batch.kind !== 'browser' || linked.some(item => item.id === batch.id)) return false
            const registered = browserBatchIdentity(batch.locator)
            return registered?.[0] === origin && registered.slice(1).some(id => nativeIds.includes(id))
          })
          if (otherOwner) throw new Error('该平台文件或作业已属于本项目的另一批次')
          if (!linked.some(batch => batch.locator === onlineBatch.locator)) {
            const assetId = registeredBatch?.assetId ?? db.assets.get(input.batchId)?.id
            if (!assetId) throw new Error('请使用本批已登记的平台身份，或指定关联的 CAT 批次')
            service.assertProjectWritable(project.id)
            db.taskGroups.registerBatch(group, 'browser', onlineBatch.locator, onlineBatch.name, assetId)
          }
        }
        batchId = activeBatchId
      }
      const nextWorkMode = !formal
        ? context.binding.workMode
        : batchStart
          ? (batchStart.useCat ? 'cat' as const : ((input.online || registeredBatch?.kind === 'browser') && !input.sources?.length ? 'browser' as const : 'working-copy' as const))
          : (input.online && !input.sources?.length ? 'browser' as const : context.binding.workMode)
      const binding = { ...context.binding, taskGroupId, projectId: project.id, batchStart,
        workMode: nextWorkMode,
        reportOnly, useRoleDefaults: input.useRoleDefaults ?? context.binding.useRoleDefaults,
      }
      bind(project.id, binding)
      const mode = binding.workMode
      const { registered } = await syncProjectLibrary(service, project.id, context.workspaceRoot, input.resources, { taskGroupId, move: input.moveResources, remove: input.removeResource, replace: input.replaceResource })
      const backgroundScopes = [...new Set(registered.flatMap(resource => resource.kind === 'context' && resource.status === 'ready' ? [resource.taskGroupId] : []))]
      if (input.prepareInBackground && !registered.length) backgroundScopes.push(taskGroupId ?? '')
      const groups = db.taskGroups.list()
      const preparationOffer: LibraryPreparationOffer | undefined = backgroundScopes.length || registered.length ? {
        projectId: project.id,
        groups: backgroundScopes.map(id => ({ id, name: id ? groups.find(group => group.id === id)!.name : '', offeredAt: Date.now() })),
        registrations: registered.map(({ kind: _kind, ...registration }) => registration),
      } : undefined
      const preparation = input.prepareInBackground ? backgroundScopes.map(id => ({
        id, status: prepareProjectLibrary(service, project.id, context.workspaceRoot, id).phase,
      })) : undefined
      if (taskGroupId !== context.binding.taskGroupId || input.groupChange || formal || input.moveResources || input.resources?.length || input.removeResource || input.replaceResource || preparation?.length) onChanged?.(project.id)
      const prepared = []
      const files = []
      for (const [index, source] of (input.sources ?? []).entries()) {
        if (sourceLocale === 'und' || targetLocale === 'und') {
          files.push({ path: source.path, status: 'blocked', reason: '请补充任务的源语言和目标语言' })
        } else if (mode === 'cat' && !reportOnly) {
          const task = { ...source, sourcePath: source.path, projectId: project.id, taskGroupId,
            workspaceRoot: context.workspaceRoot, sessionId: context.sessionId, sourceData: index === 0 ? firstFile : undefined }
          const support = await inspectLocalSource(service, task)
          if (support.mode === 'cat') {
            const file = await prepareCatTask(service, { ...task, ...support })
            prepared.push(file)
            if (index === 0 && registeredBatch && !registeredBatch.assetId) {
              db.taskGroups.registerBatch(taskGroupId ?? 'ungrouped', registeredBatch.kind, registeredBatch.locator, registeredBatch.name, file.assetId)
            }
            if (batchStart) starts.saveBatchStart(project.id, batchStart, file.assetId)
            files.push({ path: source.path, status: 'prepared', workMode: 'cat' })
          } else if (support.mode === 'blocked') files.push({ path: source.path, status: 'blocked', reason: support.reason })
          else files.push({ path: source.path, status: 'ready', workMode: 'working-copy' })
        } else files.push({ path: source.path, status: 'ready', workMode: 'working-copy' })
      }
      const materials = input.query && !input.compareGroups ? await projectQuestionText(service, project.id, context.workspaceRoot, input.query, undefined, taskGroupId, exec.signal, input.semantic) : undefined
      const question = input.query ?? context.question
      const comparison = input.compareGroups && await Promise.all(input.compareGroups.map(async id => {
        const group = db.taskGroups.list().find(group => group.id === id)
        if (!group) throw new Error('比较的任务组不存在')
        return { group, materials: question && await projectQuestionText(service, project!.id, context.workspaceRoot, question, undefined, id, exec.signal, input.semantic) }
      }))
      return jsonOutput({ projectId: project.id, workMode: mode, batchStart, reportOnly: binding.reportOnly, files, taskGroupId, groups, batchId, comparison, preparationOffer, preparation, resources: listProjectLibrary(service, project.id, context.workspaceRoot, taskGroupId), prepared, materials,
        note: '同一项目资料供所有岗位使用。CAT 副本不覆盖原稿；锁定与标签须结合扫描样例判断。审校材料和独立审校沿用正常入口，无逐条回执。' })
    },
  }
}
