import type { ToolDefinition } from '@deepseek-ai/dsh-tools'
import { inspectDeliveryReport, writeDeliveryReport } from '@linguist/domain-service'
import { Type } from 'typebox'
import { Value } from 'typebox/value'
import type { LinguistRole } from './bindings'

const parameters = Type.Object({
  kind: Type.Union([Type.Literal('translation'), Type.Literal('review')]),
  dataPath: Type.String({ minLength: 1, description: 'Workspace-relative JSON path. Use the fields in game-localization/references/delivery.md.' }),
}, { additionalProperties: false })

export function createDeliveryReportTool(templates: URL, resolveContext: () => Promise<{ workspaceRoot: string; role: LinguistRole }>): ToolDefinition {
  return {
    name: 'linguist_delivery_report',
    description: 'Fill and validate the required Excel handoff for finished translation, review or proofreading in any working mode. Use translation for Translator and review for Reviewer or Proofreader. Link the returned path alongside the draft in the batch record and include it in the handoff. The workbook records outcomes, including unresolved work, without changing drafts or submitting to any platform.',
    parameters: JSON.parse(JSON.stringify(parameters)) as Record<string, unknown>,
    output: {
      schema: { type: 'object', properties: { kind: { type: 'string' }, path: { type: 'string' }, artifactSha256: { type: 'string' },
        detailRows: { type: 'integer' }, questions: { type: 'integer' }, history: { type: 'integer' } }, required: ['kind', 'path', 'artifactSha256'] },
      render(_args, value) { return [{ type: 'text', text: JSON.stringify(value) }] },
    },
    async execute(args) {
      if (!Value.Check(parameters, args)) throw new Error('交付表需要指定类型和工作区内的 JSON 路径')
      const { workspaceRoot, role } = await resolveContext()
      if (role !== 'general' && args.kind !== (role === 'translator' ? 'translation' : 'review')) throw new Error('交付表类型须与当前岗位一致')
      return writeDeliveryReport(workspaceRoot, args.dataPath, args.kind, new URL(`${args.kind}.xlsx`, templates))
    },
  }
}

export function createInspectDeliveryReportTool(resolveContext: () => Promise<{ workspaceRoot: string }>): ToolDefinition {
  const input = Type.Object({ path: Type.String({ minLength: 1 }), batch: Type.Optional(Type.String({ minLength: 1 })) })
  return {
    name: 'linguist_inspect_delivery_report',
    description: 'Open an existing workspace Excel delivery report read-only. Supply its path and the batch identifier for a handoff. Returns the LA report header and worksheet names. For shared reports, batchCheck.locations identifies the matching tabs and the exact value and address of the first matching cell on each sheet. Cite those locations alongside the batch record.',
    parameters: JSON.parse(JSON.stringify(input)) as Record<string, unknown>,
    output: { schema: { type: 'object', additionalProperties: true }, render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }] },
    async execute(args) {
      if (!Value.Check(input, args)) throw new Error('请传 path（Excel 在工作区内的相对路径），批次号用字符串 batch 指定。')
      const { workspaceRoot } = await resolveContext()
      return inspectDeliveryReport(workspaceRoot, args.path, args.batch)
    },
  }
}
