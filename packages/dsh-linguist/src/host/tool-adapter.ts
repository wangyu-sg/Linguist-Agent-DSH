import { Buffer } from 'node:buffer'
import type { AttachmentStore } from '@deepseek-ai/dsh-attachment'
import type { ToolDefinition } from '@deepseek-ai/dsh-tools'
import type { ContentBlock } from '@deepseek-ai/dsh-llm'
import { Value } from 'typebox/value'
import type { LinguistToolDefinition } from '@linguist/cat-tools'

/** Preserve the original TypeBox validation at the model-input boundary. */
export function adaptCatTool(source: LinguistToolDefinition, attachments: AttachmentStore, onPresented?: (callId: string, content: ContentBlock[]) => void): ToolDefinition {
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
        },
        required: ['content'],
      },
      render(_args, value) {
        return (value as unknown as { content: ContentBlock[] }).content
      },
    },
    async execute(args, exec) {
      if (!Value.Check(source.parameters, args)) {
        const first = Value.Errors(source.parameters, args)[0]
        throw new Error(`Invalid ${source.name} arguments: ${first?.message ?? ''}`)
      }
      const result = await source.execute(exec.callId, args as never, exec.signal)
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
      onPresented?.(exec.callId, content)
      return result.details === undefined ? { content } : { content, details: result.details }
    },
  }
}
