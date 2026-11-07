import type { ToolDefinition } from '@deepseek-ai/dsh-tools'
import { executeWorkingCopyAction, type WorkingCopyActionInput, type WorkingCopyContext } from '@linguist/domain-service'
import { Type } from 'typebox'
import { Value } from 'typebox/value'

const parameters = Type.Object({
  operation: Type.Union([Type.Literal('prepare'), Type.Literal('assemble'), Type.Literal('deliver')]),
  sourcePath: Type.String({ description: 'Original source file relative to the current DSH Workspace; it remains untouched.' }),
  sourceLocale: Type.String({ minLength: 2 }),
  targetLocale: Type.String({ minLength: 2 }),
  previousResultPath: Type.Optional(Type.String({ description: 'For assemble/deliver: the exact reviewed prepare/assemble JSON snapshot for this source; required when a CAT project is bound.' })),
  decisionsPath: Type.Optional(Type.String({ description: 'For assemble/deliver: Workspace-relative JSON with explicit review groups, edits, unresolved IDs, source SHA and previous-result SHA.' })),
})

export function createWorkingCopyTool(resolveContext: (toolCallId: string, rootCallId: string) => WorkingCopyContext, verifySession: () => Promise<void>): ToolDefinition {
  return {
    name: 'linguist_working_copy',
    description: 'Prepare complete bilingual working JSON from an original Workspace file. With a bound CAT project, automatically resolve/import its source and read the shared current targets, stable IDs and revisions. Read that snapshot in coherent groups; assemble explicitly reviewed decisions and edits into a private draft. deliver requires complete explicit coverage and a bound project, commits reviewed changes with CAS, and produces a verified original-format file. Reuse snapshots through previousResultPath with their SHA in decisions. Original files remain untouched; workflow stages and external platform jobs are not confirmed or submitted by this tool. Use DSH native Workspace tools for unsupported files.',
    parameters: JSON.parse(JSON.stringify(parameters)) as Record<string, unknown>,
    output: {
      schema: { type: 'object', properties: {
        path: { type: 'string' }, artifactSha256: { type: 'string' }, sourceSha256: { type: 'string' },
        segments: { type: 'integer' }, format: { type: 'string' }, warnings: { type: 'array' },
      }, required: ['path', 'artifactSha256', 'sourceSha256', 'segments', 'format', 'warnings'], additionalProperties: true },
      render(_args, value) { return [{ type: 'text', text: JSON.stringify(value) }] },
    },
    async execute(args, exec) {
      if (!Value.Check(parameters, args)) throw new Error(`Invalid linguist_working_copy arguments: ${Value.Errors(parameters, args)[0]?.message}`)
      await verifySession()
      return executeWorkingCopyAction(args as WorkingCopyActionInput, () => resolveContext(String(exec.callId), String(exec.rootCallId)), exec.signal)
    },
  }
}
