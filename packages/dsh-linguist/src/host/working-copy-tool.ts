import type { ToolDefinition } from '@deepseek-ai/dsh-tools'
import { executeWorkingCopyAction, type WorkingCopyActionInput, type WorkingCopyContext } from '@linguist/domain-service'
import { Type } from 'typebox'
import { Value } from 'typebox/value'

const parameters = Type.Object({
  operation: Type.Union([Type.Literal('prepare'), Type.Literal('assemble')]),
  sourcePath: Type.String({ description: 'Original source file relative to the current DSH Workspace; it remains untouched.' }),
  sourceLocale: Type.String({ minLength: 2 }),
  targetLocale: Type.String({ minLength: 2 }),
  previousResultPath: Type.Optional(Type.String({ description: 'For assemble: a previous complete bilingual result for the same original source.' })),
  decisionsPath: Type.Optional(Type.String({ description: 'For assemble: Workspace-relative JSON with complete review groups, edits, unresolved IDs and source SHA.' })),
})

export function createWorkingCopyTool(resolveContext: () => WorkingCopyContext, verifySession: () => Promise<void>): ToolDefinition {
  return {
    name: 'linguist_working_copy',
    description: 'Prepare a complete bilingual working JSON from an original Workspace file without importing into CAT. Read it in coherent groups, then assemble explicitly reviewed decisions and edits into a complete result. Reuse a previous result through previousResultPath. Original files, CAT stages and external jobs remain untouched; the result is a private working artifact, not a native delivery export.',
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
      return executeWorkingCopyAction(args as WorkingCopyActionInput, resolveContext, exec.signal)
    },
  }
}
