import { randomUUID } from 'node:crypto'
import { appendFileSync } from 'node:fs'
import { join } from 'node:path'
import type { GenerateOptions, StreamChunk, ContentBlock } from '@deepseek-ai/dsh-llm'
import type { RecordStageEvidenceReceiptInput } from '@linguist/cat-store'
import type { LinguistProjectService } from '@linguist/domain-service'

interface Prepared {
  projectId: string
  receipt: RecordStageEvidenceReceiptInput
  presented?: ContentBlock[]
}

/** A receipt is written only after the exact tool result enters a real model request and that request returns. */
export class EvidenceObserver {
  private readonly pending = new Map<string, Prepared[]>()
  private readonly logPath: string

  constructor(private readonly service: LinguistProjectService, dataRoot: string) {
    this.logPath = join(dataRoot, 'evidence-observations.jsonl')
  }

  prepare(projectId: string, receipt: RecordStageEvidenceReceiptInput): void {
    const entries = this.pending.get(receipt.sessionId) ?? []
    entries.push({ projectId, receipt })
    this.pending.set(receipt.sessionId, entries)
  }

  presented(sessionId: string, callId: string, content: ContentBlock[]): void {
    for (const entry of this.pending.get(sessionId) ?? []) {
      if (entry.receipt.toolCallId === callId) entry.presented = content
    }
  }

  stream(options: GenerateOptions, next: () => AsyncIterable<StreamChunk>): AsyncIterable<StreamChunk> {
    const sessionId = options.sessionId
    if (sessionId === undefined) return next()
    const prepared = (this.pending.get(sessionId) ?? []).filter(entry =>
      entry.presented !== undefined && options.messages.some(message =>
        message.role === 'tool' && message.toolCallId === entry.receipt.toolCallId
        && entry.presented!.every(block => message.content.some(actual => sameBlock(block, actual))),
      ),
    )
    if (prepared.length === 0) return next()
    const observedRequestId = randomUUID()
    const source = next()
    const self = this
    return (async function* () {
      let success = false
      let responseId: string | undefined
      for await (const chunk of source) {
        if (chunk.type === 'finish') {
          success = chunk.reason.kind !== 'error' && chunk.reason.kind !== 'aborted'
          const response = chunk.replayState?.response
          if (typeof response === 'object' && response !== null && 'responseId' in response && typeof response.responseId === 'string') {
            responseId = response.responseId
          }
        }
        yield chunk
      }
      if (!success) return
      for (const entry of prepared) {
        try {
          const db = self.service.openProject(entry.projectId)
          db.stageEvidence.recordReceipt({
            ...entry.receipt,
            evidence: entry.receipt.evidence.map(item => ({ ...item, submission: 'provider-response-v1' })),
          })
          appendFileSync(self.logPath, `${JSON.stringify({
            observedRequestId,
            sessionId,
            projectId: entry.projectId,
            stageRunId: entry.receipt.stageRunId,
            toolCallId: entry.receipt.toolCallId,
            provider: options.provider,
            model: options.model,
            ...(responseId === undefined ? {} : { responseId }),
            outcome: 'response',
          })}\n`, { mode: 0o600 })
          const remaining = self.pending.get(sessionId) ?? []
          self.pending.set(sessionId, remaining.filter(candidate => candidate !== entry))
        } catch (error) {
          console.error('[Linguist] model response observed but Stage Evidence receipt failed', error instanceof Error ? error.name : typeof error)
        }
      }
    })()
  }
}

function sameBlock(expected: ContentBlock, actual: ContentBlock): boolean {
  if (expected.type === 'text') return actual.type === 'text' && actual.text === expected.text
  if (expected.type === 'image') return actual.type === 'image' && !actual.offloaded && actual.attachment.attachmentId === expected.attachment.attachmentId
  return false
}
