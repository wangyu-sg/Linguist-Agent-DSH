import { createHash, randomUUID } from 'node:crypto'
import { appendFileSync } from 'node:fs'
import { join } from 'node:path'
import type { GenerateOptions, StreamChunk, ContentBlock } from '@deepseek-ai/dsh-llm'
import type { RecordStageEvidenceReceiptInput } from '@linguist/cat-store'
import type { LinguistProjectService } from '@linguist/domain-service'
import { SessionId } from '@deepseek-ai/dsh-session'
import type { SessionQueryEngine } from '@deepseek-ai/dsh-session-query'
import { Type, type Static } from 'typebox'
import { Value } from 'typebox/value'

const range = Type.Object({ start: Type.Integer({ minimum: 0 }), end: Type.Integer({ minimum: 0 }) })
const PREPARED_EVIDENCE_META_SCHEMA = Type.Object({
  kind: Type.Literal('linguist-prepared-evidence'), sessionId: Type.String(), projectId: Type.String(),
  entries: Type.Array(Type.Object({
    contentHashes: Type.Array(Type.String()),
    receipt: Type.Object({
      stageRunId: Type.String(), baselineHash: Type.String(), sessionId: Type.String(), generationRunId: Type.String(), toolCallId: Type.String(),
      segmentIds: Type.Array(Type.String()), evidence: Type.Array(Type.Object({
        ref: Type.Object({ kind: Type.Union(['asset', 'context-doc', 'reference-import', 'style-rule', 'tech-constraint', 'voice-profile', 'workspace-attachment'].map(kind => Type.Literal(kind))), id: Type.String() }),
        anchorIds: Type.Array(Type.String()), version: Type.Optional(Type.String()), visual: Type.Optional(Type.Boolean()), textRange: Type.Optional(range),
        payloadPart: Type.Optional(Type.Object({ hash: Type.String(), start: Type.Integer({ minimum: 0 }), end: Type.Integer({ minimum: 0 }), total: Type.Integer({ minimum: 0 }) })),
      })),
    }),
  })),
})
export type PreparedEvidenceMeta = Static<typeof PREPARED_EVIDENCE_META_SCHEMA>

interface Prepared {
  projectId: string
  receipt: RecordStageEvidenceReceiptInput
  contentHashes?: string[]
}

/** A receipt is written only after the exact tool result enters a real model request and that request returns. */
export class EvidenceObserver {
  private readonly pending = new Map<string, Prepared[]>()
  private readonly bindings = new Map<string, { projectId: string; restore: () => Promise<void> }>()
  private readonly logPath: string

  constructor(private readonly service: LinguistProjectService, dataRoot: string) {
    this.logPath = join(dataRoot, 'evidence-observations.jsonl')
  }
  bind(sessionId: string, projectId: string, query: Pick<SessionQueryEngine, 'observeSession'>): () => void {
    let restoration: Promise<void> | undefined
    this.bindings.set(sessionId, { projectId, restore: () => restoration ??= this.restore(query, sessionId, projectId) })
    return () => { this.bindings.delete(sessionId); this.pending.delete(sessionId) }
  }
  private async restore(query: Pick<SessionQueryEngine, 'observeSession'>, sessionId: string, projectId: string): Promise<void> {
    using observation = await query.observeSession(SessionId(sessionId), { projectionMode: 'none' })
    if (observation.header.id !== sessionId) throw new Error('Evidence Session identity changed')
    const db = this.service.openProject(projectId)
    const entries = this.pending.get(sessionId) ?? []
    for (const event of observation.events.slice(observation.inheritedEventCount)) {
      const type: string = event.type
      if (type !== 'tool/result' && type !== 'tool/ptc-dispatch') continue
      const data = event.data as { meta?: { evidence?: unknown }; isError?: boolean; subCallId?: string; message?: { isError?: boolean; toolCallId?: string } }
      if (data.isError || data.message?.isError || data.meta?.evidence === undefined) continue
      const meta = data.meta.evidence
      if (!Value.Check(PREPARED_EVIDENCE_META_SCHEMA, meta)) throw new Error('Invalid durable Linguist evidence metadata')
      if (meta.sessionId !== sessionId || meta.projectId !== projectId) continue
      const callId = type === 'tool/result' ? data.message?.toolCallId : data.subCallId
      for (const entry of meta.entries) {
        const receipt = entry.receipt
        if (receipt.sessionId !== sessionId || receipt.toolCallId !== callId) continue
        const stage = db.stageEvidence.get(receipt.stageRunId)
        if (stage?.sessionId !== sessionId || stage.baseline.baselineHash !== receipt.baselineHash) continue
        if (db.stageEvidence.listReceipts(receipt.stageRunId).some(saved => saved.toolCallId === callId && saved.generationRunId === receipt.generationRunId && saved.baselineHash === receipt.baselineHash)) continue
        if (!entries.some(saved => JSON.stringify(saved.receipt) === JSON.stringify(receipt))) entries.push({ projectId, ...entry })
      }
    }
    this.pending.set(sessionId, entries)
  }

  prepare(projectId: string, receipt: RecordStageEvidenceReceiptInput): void {
    const entries = this.pending.get(receipt.sessionId) ?? []
    entries.push({ projectId, receipt })
    this.pending.set(receipt.sessionId, entries)
  }

  presented(sessionId: string, callId: string, content: ContentBlock[]): PreparedEvidenceMeta | undefined {
    const entries = (this.pending.get(sessionId) ?? []).filter(entry => entry.receipt.toolCallId === callId)
    if (entries.length === 0) return
    const contentHashes = content.map(blockHash)
    for (const entry of entries) entry.contentHashes = contentHashes
    return { kind: 'linguist-prepared-evidence', sessionId, projectId: entries[0]!.projectId,
      entries: entries.map(entry => ({ receipt: entry.receipt as PreparedEvidenceMeta['entries'][number]['receipt'], contentHashes })) }
  }

  stream(options: GenerateOptions, next: () => AsyncIterable<StreamChunk>): AsyncIterable<StreamChunk> {
    const sessionId = options.sessionId
    if (sessionId === undefined) return next()
    const self = this
    return (async function* () {
      const binding = self.bindings.get(sessionId)
      await binding?.restore()
      const prepared = (self.pending.get(sessionId) ?? []).filter(entry =>
        (binding === undefined || entry.projectId === binding.projectId) && entry.contentHashes !== undefined && options.messages.some(message =>
          message.role === 'tool' && message.toolCallId === entry.receipt.toolCallId
          && entry.contentHashes!.every(hash => message.content.some(actual => blockHash(actual) === hash)),
        ),
      )
      if (prepared.length === 0) { yield* next(); return }
      const observedRequestId = randomUUID()
      const source = next()
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

function blockHash(block: ContentBlock): string {
  if (block.type === 'text') return createHash('sha256').update(`text:${block.text}`).digest('hex')
  if (block.type === 'image' && !block.offloaded) return createHash('sha256').update(`image:${block.attachment.attachmentId}`).digest('hex')
  return ''
}
