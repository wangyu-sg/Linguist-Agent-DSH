import { Buffer } from 'node:buffer'
import type { AttachmentStore } from '@deepseek-ai/dsh-attachment'
import type { ToolDefinition } from '@deepseek-ai/dsh-tools'
import type { ContentBlock } from '@deepseek-ai/dsh-llm'
import { Value } from 'typebox/value'
import type { LinguistToolDefinition, LinguistToolResult } from '@linguist/cat-tools'
import type { ReadSnapshotMeta, SessionReadSnapshots } from './read-snapshots'
import type { PreparedEvidenceMeta } from './evidence'

/** Preserve the original TypeBox validation at the model-input boundary. */
export function adaptCatTool(source: LinguistToolDefinition, attachments: AttachmentStore, onPresented?: (callId: string, content: ContentBlock[]) => PreparedEvidenceMeta | void, onExecuting?: (callId: string, rootCallId: string) => void, onUpdate?: (callId: string, update: LinguistToolResult) => void, snapshots?: SessionReadSnapshots): ToolDefinition {
  const parameters = JSON.parse(JSON.stringify(source.parameters)) as Record<string, unknown>
  return {
    name: source.name,
    description: source.description,
    parameters,
    output: {
      schema: {
        type: 'object',
        properties: {
          content: { type: 'array', items: { oneOf: [
            { type: 'object', properties: { type: { type: 'string', const: 'text' }, text: { type: 'string' } }, required: ['type', 'text'], additionalProperties: false },
            { type: 'object', properties: { type: { type: 'string', const: 'image' }, attachment: { type: 'object', additionalProperties: true } }, required: ['type', 'attachment'], additionalProperties: false },
          ] } },
          details: {},
          readSnapshots: { type: 'object', additionalProperties: true },
          evidence: { type: 'object', additionalProperties: true },
        },
        required: ['content'],
      },
      render(_args, value) {
        return (value as unknown as { content: ContentBlock[] }).content
      },
      presentationMeta(_args, value) {
        const { readSnapshots, evidence } = value as { readSnapshots?: ReadSnapshotMeta; evidence?: PreparedEvidenceMeta }
        return readSnapshots === undefined && evidence === undefined ? null : {
          ...(readSnapshots === undefined ? {} : { readSnapshots }), ...(evidence === undefined ? {} : { evidence }),
        }
      },
    },
    async execute(args, exec) {
      if (!Value.Check(source.parameters, args)) {
        const first = Value.Errors(source.parameters, args)[0]
        throw new Error(`Invalid ${source.name} arguments: ${first?.message ?? ''}`)
      }
      onExecuting?.(exec.callId, exec.rootCallId ?? exec.callId)
      const execute = async () => {
        const result = await source.execute(exec.callId, args as never, exec.signal, update => onUpdate?.(exec.callId, update))
        const content: ContentBlock[] = []
        for (const item of result.content) {
          if (item.type === 'text') content.push(item)
          else content.push({
            type: 'image',
            attachment: await attachments.saveImage({
              data: Buffer.from(item.data, 'base64'),
              mediaType: item.mimeType as 'image/png' | 'image/jpeg' | 'image/webp' | 'image/gif',
            }),
          })
        }
        const evidence = onPresented?.(exec.callId, content)
        return { content, ...(result.details === undefined ? {} : { details: result.details }), ...(evidence === undefined ? {} : { evidence }) }
      }
      return snapshots === undefined ? execute() : snapshots.run(execute)
    },
  }
}
