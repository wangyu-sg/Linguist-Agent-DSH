import { Buffer } from 'node:buffer'
import type { AttachmentStore } from '@deepseek-ai/dsh-attachment'
import type { ToolDefinition } from '@deepseek-ai/dsh-tools'
import type { ContentBlock } from '@deepseek-ai/dsh-llm'
import { Value } from 'typebox/value'
import type { LinguistToolDefinition, LinguistToolResult } from '@linguist/cat-tools'
import type { ReadSnapshotMeta, SessionReadSnapshots } from './read-snapshots'
import type { PreparedEvidenceMeta } from './evidence'

/** Preserve the original TypeBox validation at the model-input boundary. */
export function adaptCatTool(source: LinguistToolDefinition, attachments: AttachmentStore, onPresented?: (callId: string, content: ContentBlock[]) => PreparedEvidenceMeta | void, onExecuting?: (callId: string, rootCallId: string) => void, onUpdate?: (callId: string, update: LinguistToolResult) => void, snapshots?: SessionReadSnapshots, scope?: () => readonly string[] | undefined): ToolDefinition {
  const parameters = JSON.parse(JSON.stringify(source.parameters)) as Record<string, unknown>
  const automaticRead = snapshots !== undefined && (source.name === 'cat_apply_translations' || source.name === 'cat_confirm_segments')
  if (automaticRead) {
    const required = parameters.required as string[]
    parameters.required = required.filter(field => field !== 'snapshotIds' && (source.name !== 'cat_confirm_segments' || field !== 'segmentIds'))
    const properties = parameters.properties as Record<string, unknown>
    properties.reviewedAll = { type: 'boolean', description: 'Explicitly declare that you independently reviewed the entire delegated scope; omit for partial work.' }
  }
  return {
    name: source.name,
    description: !automaticRead ? source.description : source.name === 'cat_apply_translations'
      ? 'Save authorized edits and optionally declare completed review in one call. Host supplies read versions automatically. Use reviewedAll only after independently reviewing the entire delegated scope; use reviewedSegmentIds for a partial scope. blockedSegmentIds remain unresolved. Proposals do not complete review. Locks, tags and version conflicts still apply; report-only tasks must not write.'
      : 'Record an explicitly completed professional review. Use reviewedAll only after reviewing the whole delegated scope, or supply segmentIds for a partial scope. Host supplies previously read versions automatically; blocked, stale, locked and empty rows remain unresolved.',
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
      let input = args as Record<string, unknown>
      if (automaticRead) {
        input = { ...input }
        if (input.reviewedAll !== undefined && typeof input.reviewedAll !== 'boolean') throw new Error('reviewedAll must be a boolean')
        if (input.reviewedAll === true) {
          const all = scope?.()
          if (!all?.length) throw new Error('The complete delegated scope is unavailable; specify the reviewed segment IDs')
          const field = source.name === 'cat_confirm_segments' ? 'segmentIds' : 'reviewedSegmentIds'
          if (input[field] !== undefined) throw new Error(`Use reviewedAll or ${field}, not both`)
          input[field] = [...all]
        }
        delete input.reviewedAll
        if (input.snapshotIds === undefined) {
          await snapshots.restore()
          const edits = Array.isArray(input.edits) ? input.edits.map(edit => (edit as { segmentId?: string }).segmentId).filter((id): id is string => typeof id === 'string') : []
          const reviewed = (source.name === 'cat_confirm_segments' ? input.segmentIds : input.reviewedSegmentIds) as string[] | undefined
          const ids = [...new Set([...edits, ...(Array.isArray(reviewed) ? reviewed : [])])]
          const found = snapshots.covering(ids)
          if (!found.length) throw new Error('No previously supplied complete read covers this work; read the affected material first')
          input.snapshotIds = found
        }
      }
      if (!Value.Check(source.parameters, input)) {
        const first = Value.Errors(source.parameters, input)[0]
        throw new Error(`Invalid ${source.name} arguments: ${first?.message ?? ''}`)
      }
      onExecuting?.(exec.callId, exec.rootCallId ?? exec.callId)
      const execute = async () => {
        const result = await source.execute(exec.callId, input as never, exec.signal, update => onUpdate?.(exec.callId, update))
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
