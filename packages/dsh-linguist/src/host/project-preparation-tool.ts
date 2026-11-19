import { changeTaskGroup, GroupChange } from './task-groups'
import { basename } from 'node:path'
import { Type, type Static } from 'typebox'
import { Value } from 'typebox/value'
import type { ToolDefinition } from '@deepseek-ai/dsh-tools'
import { prepareCatTask, syncProjectLibrary, listProjectLibrary, type LinguistProjectService } from '@linguist/domain-service'
import type { SessionBinding } from './bindings'
import { projectQuestionText } from './project-question-context'

const Input = Type.Object({
  taskGroupId: Type.Optional(Type.String({ description: 'Session group ID. Empty string selects shared project materials.' })),
  groupChange: Type.Optional(GroupChange),
  moveResources: Type.Optional(Type.Object({ keys: Type.Array(Type.String(), { minItems: 1 }), to: Type.String({ description: 'Destination group ID, or empty string for project.' }) })),
  query: Type.Optional(Type.String({ minLength: 1, description: 'Look up project evidence for this focused question. Use query alone for a read in the current scope.' })),
  semantic: Type.Optional(Type.Boolean({ description: 'With query, include meaning-based matches when wording or TM/TB evidence is insufficient. A cold index can take time.' })),
  compareGroups: Type.Optional(Type.Array(Type.String(), { minItems: 2, uniqueItems: true })),
  batch: Type.Optional(Type.Object({ assetId: Type.Optional(Type.String()), kind: Type.Union([Type.Literal('browser'), Type.Literal('working-copy')]), locator: Type.String({ minLength: 1, description: 'Stable platform file identifier or source digest.' }), name: Type.String({ minLength: 1 }) })),
  removeResource: Type.Optional(Type.String({ description: 'Exact resource key from the returned resources list to remove from project use; original files are retained.' })),
  replaceResource: Type.Optional(Type.String({ description: 'Exact resource key to replace after the single new resource reads successfully.' })),
  workMode: Type.Optional(Type.Union([Type.Literal('cat'), Type.Literal('working-copy'), Type.Literal('browser')], { description: 'Use only the user’s chosen mode. Omit for read-only resource preparation. Ask once for a formal task when mode is undecided.' })),
  sourceLocale: Type.Optional(Type.String()), targetLocale: Type.Optional(Type.String()),
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

export function createProjectPreparationTool(service: LinguistProjectService, resolve: (callId: string, useTurnQuestion: boolean) => Promise<{
  workspaceRoot: string; sessionId: string; binding: SessionBinding; segmentIds?: string[]; question?: string
}>, bind: (projectId: string, binding: SessionBinding) => void, onChanged?: (projectId: string) => void): ToolDefinition {
  return {
    name: 'linguist_prepare_project',
    description: 'Prepare supplied project assets once for every LA conversation and work mode. resources: TM/TB use native matching; rules carry complete checklist/SG requirements, optional appliesTo scopes; context keeps full examples/query responses with source positions. No mandatory extra columns. Reuses unchanged originals and updates changed sources. After the user chooses CAT, pass workMode=cat and sources to import managed copies, bind working copies, verify stable IDs/platform locks and scan tag boundaries. No original or platform write. Non-CAT work still uses the same library. For a question that needs project evidence, use query alone in the bound session. For cross-group comparison supply compareGroups and the same query.',
    parameters: JSON.parse(JSON.stringify(Input)),
    output: { schema: { type: 'object', additionalProperties: true }, render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }] },
    async execute(args, exec) {
      if (!Value.Check(Input, args)) throw new Error(`Invalid project preparation: ${Value.Errors(Input, args)[0]?.message}`)
      const input = args as Static<typeof Input>
      if (input.semantic && !input.query && !input.compareGroups) throw new Error('语义检索需要查询问题')
      const context = await resolve(String(exec.rootCallId ?? exec.callId), !!input.compareGroups && !input.query)
      if (context.binding.delegatedScope && (input.groupChange || input.moveResources || input.compareGroups || input.sources || input.batch
        || input.resources || input.removeResource || input.replaceResource || input.taskGroupId !== undefined && input.taskGroupId !== context.binding.taskGroupId)) throw new Error('子任务已冻结范围，项目或任务组维护请交由 General')
      if (input.query && Object.keys(input).every(key => key === 'query' || key === 'taskGroupId' || key === 'semantic')) {
        const { projectId } = context.binding
        if (!projectId) throw new Error('当前会话尚未绑定项目资料')
        const taskGroupId = (input.taskGroupId ?? context.binding.taskGroupId) || undefined
        if (input.taskGroupId && !service.openProject(projectId).taskGroups.list().some(group => group.id === taskGroupId)) throw new Error('任务组不存在')
        const segmentIds = taskGroupId === context.binding.taskGroupId ? context.segmentIds : undefined
        return { projectId, taskGroupId, materials: await projectQuestionText(service, projectId, context.workspaceRoot, input.query, segmentIds, taskGroupId, exec.signal, input.semantic) }
      }
      const mode = input.workMode ?? context.binding.workMode
      if (input.sources?.length && (mode !== 'cat' || (!input.workMode && !context.binding.workModeConfirmed))) throw new Error('先询问用户是否使用 CAT；只有选择 CAT 才导入稿件。资料准备不需要导入稿件。')
      let project = context.binding.projectId ? service.getProject(context.binding.projectId) : undefined
      const sourceLocale = input.sourceLocale ?? project?.sourceLocale ?? 'und'
      const targetLocale = input.targetLocale ?? project?.targetLocale ?? 'und'
      if ((input.sources?.length || input.resources?.some(resource => resource.kind === 'tm' || resource.kind === 'terms'))
        && (sourceLocale === 'und' || targetLocale === 'und')) throw new Error('稿件与 TM／TB 需要本次语言对；一般规则和背景资料无需先确定语言对')
      if (!project) project = await service.createProject({ name: basename(context.workspaceRoot), sourceLocale, targetLocale })
      else if (project.sourceLocale !== sourceLocale || project.targetLocale !== targetLocale) project = service.setProjectLocales(project.id, sourceLocale, targetLocale)
      const db = service.openProject(project.id)
      const changedId = input.groupChange && changeTaskGroup(service, project.id, input.groupChange)
      let taskGroupId = (input.taskGroupId ?? (input.groupChange?.action === 'create' ? changedId : context.binding.taskGroupId)) || undefined
      if (input.groupChange && ('id' in input.groupChange) && input.groupChange.id === taskGroupId && (input.groupChange.action === 'archive' || input.groupChange.action === 'delete')) taskGroupId = undefined
      if (taskGroupId) db.taskGroups.requireActive(taskGroupId)
      let batchId: string | undefined
      if (input.batch) {
        service.assertProjectWritable(project.id)
        batchId = db.taskGroups.registerBatch(taskGroupId ?? 'ungrouped', input.batch.kind, input.batch.locator, input.batch.name, input.batch.assetId)
      }
      const binding = { ...context.binding, taskGroupId, projectId: project.id, workMode: mode,
        ...(input.workMode ? { workModeConfirmed: true } : {}) }
      bind(project.id, binding)
      await syncProjectLibrary(service, project.id, context.workspaceRoot, input.resources, { taskGroupId, move: input.moveResources, remove: input.removeResource, replace: input.replaceResource })
      if (taskGroupId !== context.binding.taskGroupId || input.groupChange || input.batch || input.moveResources || input.resources?.length || input.removeResource || input.replaceResource) onChanged?.(project.id)
      const prepared = []
      for (const source of input.sources ?? []) prepared.push(await prepareCatTask(service, {
        projectId: project.id, taskGroupId, workspaceRoot: context.workspaceRoot, sessionId: context.sessionId,
        sourcePath: source.path, platformSnapshotPath: source.platformSnapshotPath, xlsxMapping: source.xlsxMapping, phraseMasterPath: source.phraseMasterPath,
      }))
      const materials = input.query && !input.compareGroups ? await projectQuestionText(service, project.id, context.workspaceRoot, input.query, undefined, taskGroupId, exec.signal, input.semantic) : undefined
      const question = input.query ?? context.question
      const comparison = input.compareGroups && await Promise.all(input.compareGroups.map(async id => {
        const group = db.taskGroups.list().find(group => group.id === id)
        if (!group) throw new Error('比较的任务组不存在')
        return { group, materials: question && await projectQuestionText(service, project!.id, context.workspaceRoot, question, undefined, id, exec.signal, input.semantic) }
      }))
      return { projectId: project.id, workMode: mode, taskGroupId, groups: db.taskGroups.list(), batchId, comparison, resources: listProjectLibrary(service, project.id, context.workspaceRoot, taskGroupId), prepared, materials,
        note: '同一项目资料供所有岗位使用。CAT 副本不覆盖原稿；锁定与标签须结合扫描样例判断。审校材料和独立审校沿用正常入口，无逐条回执。' }
    },
  }
}
