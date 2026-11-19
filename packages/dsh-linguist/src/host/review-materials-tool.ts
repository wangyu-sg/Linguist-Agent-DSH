import type { ToolDefinition } from '@deepseek-ai/dsh-tools'
import { Type } from 'typebox'
import { Value } from 'typebox/value'
import { prepareReviewMaterials, type LinguistProjectService, type ReviewMaterialsInput } from '@linguist/domain-service'
import type { ReadSnapshotMeta, SessionReadSnapshots } from './read-snapshots'

const parameters = Type.Object({
  batchIds: Type.Optional(Type.Array(Type.String({ minLength: 1 }), { minItems: 1 })),
  segmentIds: Type.Optional(Type.Array(Type.String({ minLength: 1 }), { minItems: 1 })),
  sourcePath: Type.Optional(Type.String({ minLength: 1, description: 'Bilingual source file or BrowserSkill export, relative to this Workspace. Read-only; no CAT import.' })),
  snapshotPath: Type.Optional(Type.String({ minLength: 1, description: 'Workspace JSON from the normal BrowserSkill reading: {segments:[{id,ordinal,source,target,key?,locked?,context?:{note?,meta?}}]}. ordinal is zero-based; preserve platform IDs, notes and exact current text. Accumulate pages in one file; no per-row calls.' })),
  sourceLocale: Type.Optional(Type.String({ minLength: 2 })),
  targetLocale: Type.Optional(Type.String({ minLength: 2 })),
  previousResultPath: Type.Optional(Type.String({ minLength: 1, description: 'Latest working-copy draft, if reviewing a saved draft.' })),
  outputDir: Type.Optional(Type.String({ minLength: 1, description: 'Existing workspace-relative output directory for review materials.' })),
  referenceFiles: Type.Optional(Type.Array(Type.Object({ path: Type.String({ minLength: 1 }), kind: Type.Union([Type.Literal('tm'), Type.Literal('terms')]),
    xlsxMapping: Type.Optional(Type.Object({ sheetName: Type.String({ minLength: 1 }), columns: Type.Object({ source: Type.String({ minLength: 1 }), target: Type.String({ minLength: 1 }) }) })) }))),
  contextFiles: Type.Optional(Type.Array(Type.String({ minLength: 1 }), { description: 'Workspace-relative spreadsheets, presentations or images with visual context.' })),
  online: Type.Optional(Type.Object({ fileId: Type.Optional(Type.String({ minLength: 1, description: 'Stable file or job identifier supplied by the platform.' })), url: Type.String({ format: 'uri', minLength: 1 }), expectedSegments: Type.Integer({ minimum: 1 }), observedAt: Type.String({ minLength: 1 }) })),
}, { additionalProperties: false })

export function createReviewMaterialsTool(service: LinguistProjectService,
  resolve: () => Promise<Pick<ReviewMaterialsInput, 'workspaceRoot' | 'taskId' | 'projectId' | 'taskGroupId'> & { allowedIds?: readonly string[] }>,
  snapshots?: SessionReadSnapshots): ToolDefinition {
  return {
    name: 'linguist_review_materials',
    description: 'Prepare a complete CAT, file/working-copy or browser review once without changing modes. CAT: provide batchIds or segmentIds. File: provide sourcePath, language pair, optional previousResultPath and this task’s TM/TB referenceFiles. Browser: provide export or BrowserSkill snapshot with online metadata; still verify platform TM/TB and Comments. The first reading group includes related bilingual comparisons and applicable evidence; read continuationPaths without separately querying semantic groups. Similarity is a lead, not an error. No per-50 retrieval, receipt, target write or platform submission.',
    parameters: JSON.parse(JSON.stringify(parameters)),
    output: {
      schema: { type: 'object', properties: { readingPath: { type: 'string' }, groups: { type: 'integer' }, coverage: { type: 'object' }, semantic: { type: 'object' } }, required: ['readingPath', 'groups', 'coverage', 'semantic'], additionalProperties: true },
      render(_args, value) {
        const { readSnapshots: _meta, ...visible } = value as Record<string, unknown>
        return [{ type: 'text', text: JSON.stringify(visible) }]
      },
      presentationMeta(_args, value) {
        const { readSnapshots } = value as { readSnapshots?: ReadSnapshotMeta }
        return readSnapshots ? { readSnapshots } : null
      },
    },
    async execute(args, exec) {
      if (!Value.Check(parameters, args)) throw new Error(`Invalid review materials: ${Value.Errors(parameters, args)[0]?.message}`)
      const input = args as Omit<ReviewMaterialsInput, 'workspaceRoot' | 'taskId' | 'projectId'>
      const context = await resolve()
      if (context.allowedIds) {
        if (input.sourcePath || input.snapshotPath) throw new Error('CAT 子任务须使用父任务声明的句段范围')
        if (input.batchIds) throw new Error('CAT 子任务已绑定完整范围，无需重新指定批次')
        if (input.segmentIds?.some(id => !context.allowedIds!.includes(id))) throw new Error('超出子任务范围')
        input.segmentIds ??= [...context.allowedIds]
      }
      const execute = () => prepareReviewMaterials(service, { ...input, ...context }, exec.signal,
        (id, versions) => snapshots?.set(id, { kind: 'snapshot', versions }))
      return snapshots ? snapshots.run(execute) : execute()
    },
  }
}
