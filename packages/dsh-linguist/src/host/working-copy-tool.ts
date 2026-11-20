import type { ToolDefinition } from '@deepseek-ai/dsh-tools'
import { executeWorkingCopyAction, type WorkingCopyActionInput, type WorkingCopyContext } from '@linguist/domain-service'
import { Type } from 'typebox'
import { Value } from 'typebox/value'

const parameters = Type.Object({
  operation: Type.Union([Type.Literal('prepare'), Type.Literal('references'), Type.Literal('assemble'), Type.Literal('deliver')]),
  sourcePath: Type.String({ description: 'Original source file relative to the current DSH Workspace; it remains untouched.' }),
  sourceLocale: Type.String({ minLength: 2 }),
  targetLocale: Type.String({ minLength: 2 }),
  previousResultPath: Type.Optional(Type.String({ description: 'For references/assemble/deliver: the exact prepare/assemble JSON snapshot being read; required when a CAT project is bound.' })),
  decisionsPath: Type.Optional(Type.String({ description: 'For assemble/deliver: Workspace-relative JSON with explicit review groups, edits, unresolved IDs, source SHA and previous-result SHA. An edit may include tmUnitId when its target actually adopts that TM original or adapted candidate; reuse is counted only after the retained target is saved.' })),
  segmentIds: Type.Optional(Type.Array(Type.String({ minLength: 1 }), { minItems: 1, description: 'For references: omit to prepare reading materials for the entire current draft in one call. Supply IDs only for an explicitly selected subset.' })),
  wait: Type.Optional(Type.Boolean({ description: 'For references: wait for the selected group by default; false returns pending status immediately.' })),
  outputDir: Type.Optional(Type.String({ minLength: 1, description: 'Existing workspace-relative directory for task materials.' })),
  referenceFiles: Type.Optional(Type.Array(Type.Object({ path: Type.String({ minLength: 1 }), kind: Type.Union([Type.Literal('tm'), Type.Literal('terms')]),
    xlsxMapping: Type.Optional(Type.Object({ sheetName: Type.String({ minLength: 1 }), columns: Type.Object({ source: Type.String({ minLength: 1 }), target: Type.String({ minLength: 1 }) }) })) }))),
  contextFiles: Type.Optional(Type.Array(Type.String({ minLength: 1 }), { description: 'Workspace-relative spreadsheets, presentations or images with visual context.' })),
})

export function createWorkingCopyTool(resolveContext: (toolCallId: string, rootCallId: string) => WorkingCopyContext, verifySession: (input: WorkingCopyActionInput, signal: AbortSignal) => Promise<void>): ToolDefinition {
  return {
    name: 'linguist_working_copy',
    description: 'Prepare a bilingual working copy, with or without a bound CAT project. Call references once for the current draft: supply previousResultPath and any task-specific TM/TB referenceFiles. The first reading group includes current source/target, matched references and cached semantic associations; read continuationPaths without separate per-50 queries. Similarity is a lead, not an error. Read related images when needed. Assemble explicitly reviewed decisions into a private draft; deliver verifies the original-format file, current draft, scope and completion. For unsupported formats use existing workspace tools.',
    parameters: JSON.parse(JSON.stringify(parameters)) as Record<string, unknown>,
    output: {
      schema: { type: 'object', properties: {
        path: { type: 'string' }, artifactSha256: { type: 'string' }, sourceSha256: { type: 'string' },
        segments: { type: 'integer' }, format: { type: 'string' }, warnings: { type: 'array' },
      }, additionalProperties: true },
      render(_args, value) { return [{ type: 'text', text: JSON.stringify(value) }] },
    },
    async execute(args, exec) {
      if (!Value.Check(parameters, args)) throw new Error(`Invalid linguist_working_copy arguments: ${Value.Errors(parameters, args)[0]?.message}`)
      const input = args as WorkingCopyActionInput
      await verifySession(input, exec.signal)
      return executeWorkingCopyAction(input, () => resolveContext(String(exec.callId), String(exec.rootCallId)), exec.signal)
    },
  }
}
