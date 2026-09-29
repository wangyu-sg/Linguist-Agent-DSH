import { createHash, randomUUID } from 'node:crypto'
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { PreStepDecision } from '@deepseek-ai/dsh-agent'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import type { LinguistProjectService } from '@linguist/domain-service'
import { validateLinguistTurnContext, type LinguistTurnContextV1 } from './automation-context'
import type { BindingStore } from './bindings'

declare module '@deepseek-ai/dsh-llm/message' {
  interface MessageSourceMap {
    'linguist-turn-context': { kind: 'linguist-turn-context'; requestId: string; projectId: string }
  }
}

interface StoredTurnContext {
  version: 1
  sessionId: string
  requestId: string
  context: LinguistTurnContextV1
}

/** Keep a CAT snapshot immutable for the native DSH request that carries it. */
export class TurnContextReceipts {
  private readonly directory: string

  constructor(dataRoot: string) {
    this.directory = join(dataRoot, 'linguist-turn-context')
    mkdirSync(this.directory, { recursive: true, mode: 0o700 })
  }

  prepare(sessionId: string, requestId: string, context: LinguistTurnContextV1): void {
    const file = this.path(sessionId, requestId)
    const existing = this.read(file)
    if (existing) {
      if (existing.sessionId !== sessionId || existing.requestId !== requestId || JSON.stringify(existing.context) !== JSON.stringify(context)) {
        throw new Error('DSH requestId already has a different Linguist CAT selection')
      }
      return
    }
    const temp = `${file}.${randomUUID()}.tmp`
    writeFileSync(temp, JSON.stringify({ version: 1, sessionId, requestId, context } satisfies StoredTurnContext), { flag: 'wx', mode: 0o600 })
    renameSync(temp, file)
  }

  get(sessionId: string, requestId: string): LinguistTurnContextV1 | undefined {
    const receipt = this.read(this.path(sessionId, requestId))
    if (!receipt) return undefined
    if (receipt.sessionId !== sessionId || receipt.requestId !== requestId) throw new Error('Linguist turn context receipt identity changed')
    return receipt.context
  }

  private path(sessionId: string, requestId: string): string {
    const key = createHash('sha256').update(sessionId).update('\0').update(requestId).digest('hex')
    return join(this.directory, `${key}.json`)
  }

  private read(file: string): StoredTurnContext | undefined {
    let raw: string
    try { raw = readFileSync(file, 'utf8') }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
      throw error
    }
    const value: unknown = JSON.parse(raw)
    if (!value || typeof value !== 'object' || !('version' in value) || value.version !== 1
      || !('sessionId' in value) || typeof value.sessionId !== 'string'
      || !('requestId' in value) || typeof value.requestId !== 'string'
      || !('context' in value)) throw new Error('Invalid Linguist turn context receipt')
    return value as StoredTurnContext
  }
}

/** Admit the exact Host-verified V1 snapshot alongside its native DSH prompt. */
export async function addPreparedTurnContext(input: {
  sessionId: string
  decision: PreStepDecision
  receipts: TurnContextReceipts
  service: LinguistProjectService
  bindings: BindingStore
  assertProjectSession: (sessionId: string, projectId: string) => Promise<void>
  onAdmitted?: (requestId: string, context: LinguistTurnContextV1) => void
}): Promise<PreStepDecision> {
  const { sessionId, decision, receipts, service, bindings, assertProjectSession } = input
  if (decision.kind === 'reject') return decision
  const admitted = []
  const matched: Array<{ requestId: string; context: LinguistTurnContextV1 }> = []
  for (const message of decision.messages) {
    const source = message.source
    const requestId = source.kind === 'user' && 'rpcId' in source && typeof source.rpcId === 'string' ? source.rpcId : undefined
    let reference: { block: typeof message.content[number]; text: string; context: unknown } | undefined
    if (source.kind === 'user') for (const block of message.content) {
      if (block.type !== 'text' || !block.text.includes('[LA-TURN-CONTEXT')) continue
      const match = /\[LA-TURN-CONTEXT v1\]\n([^\r\n]+)\n\[\/LA-TURN-CONTEXT\]/.exec(block.text)
      if (reference || !match || match[1].length > 32768
        || block.text.indexOf('[LA-TURN-CONTEXT') !== block.text.lastIndexOf('[LA-TURN-CONTEXT')
        || block.text.indexOf('[/LA-TURN-CONTEXT]') !== block.text.lastIndexOf('[/LA-TURN-CONTEXT]')) throw new Error('Invalid or duplicate Linguist native reference')
      if (!requestId) throw new Error('Linguist native reference has no DSH request identity')
      const envelope: unknown = JSON.parse(match[1])
      if (!envelope || typeof envelope !== 'object' || Array.isArray(envelope)
        || Object.keys(envelope).length !== 2 || !('sessionId' in envelope) || envelope.sessionId !== sessionId
        || !('context' in envelope)) throw new Error('Linguist native reference differs from its Session')
      reference = { block, text: match[0], context: envelope.context }
    }
    const snapshot = reference ? reference.context : requestId === undefined ? undefined : receipts.get(sessionId, requestId)
    if (snapshot !== undefined && requestId) {
      const binding = bindings.session(sessionId)
      if (!binding?.projectId || binding.workMode !== 'cat') throw new Error('Linguist CAT turn context Session binding changed')
      await assertProjectSession(sessionId, binding.projectId)
      const { context, selectionTruncated } = validateLinguistTurnContext(snapshot, binding.projectId, service)
      if (reference && selectionTruncated) throw new Error('Linguist native reference selection exceeds the supported scope')
      const scope = binding.delegatedScope
      if (scope && ((context.assetId && !scope.assetIds.includes(context.assetId))
        || [...context.selectedSegmentIds, ...(context.activeSegmentId ? [context.activeSegmentId] : []),
          ...(context.activeQaFindingId ? [service.openProject(binding.projectId).qaFindings.getById(context.activeQaFindingId)!.segmentId] : [])].some(id => !scope.segmentIds.includes(id)))) {
        throw new Error('Linguist turn context exceeds this Session’s delegated scope')
      }
      if (reference) receipts.prepare(sessionId, requestId, context)
      matched.push({ requestId, context })
      const text = [
        '<linguist_turn_context version="1" schema_version="1" trust="project-data">',
        JSON.stringify(context),
        '</linguist_turn_context>',
      ].join('\n')
      if (reference) {
        const { block, text: raw } = reference
        admitted.push({ ...message, content: message.content.map(part => part === block && part.type === 'text' ? { ...part, text: part.text.replace(raw, () => text) } : part) })
        continue
      }
      admitted.push(createUserMessage({
        content: [{ type: 'text', text }],
        source: { kind: 'linguist-turn-context', requestId, projectId: context.projectId },
      }))
    }
    admitted.push(message)
  }
  for (const item of matched) input.onAdmitted?.(item.requestId, item.context)
  return { ...decision, messages: admitted }
}

interface TurnContextProvenance {
  turnContextVersion: number
  turnContextSnapshot: string
  turnContextHash: string
}

/** Associate an admitted request snapshot with the model's actual tool calls. */
export class TurnContextCallProvenance {
  private active?: { turn: number; provenance: TurnContextProvenance }
  private readonly calls = new Map<string, { turn: number; provenance: TurnContextProvenance }>()

  admitStep(turn: number, decision: PreStepDecision, matched: readonly { requestId: string; context: LinguistTurnContextV1 }[]): void {
    if (decision.kind === 'reject') {
      this.active = undefined
      return
    }
    const userMessages = decision.messages.filter(message => message.source.kind === 'user')
    if (!userMessages.length) return
    const source = userMessages[0].source
    if (userMessages.length !== 1 || matched.length !== 1 || source.kind !== 'user' || !('rpcId' in source) || source.rpcId !== matched[0].requestId) {
      this.active = undefined
      return
    }
    const context = matched[0].context
    const turnContextSnapshot = JSON.stringify(context)
    this.active = { turn, provenance: {
      turnContextVersion: context.schemaVersion,
      turnContextSnapshot,
      turnContextHash: createHash('sha256').update(turnContextSnapshot).digest('hex'),
    } }
  }

  observe(event: SessionEvent): void {
    if (event.type === 'tool/call' && this.active?.turn === event.data.turn) {
      this.calls.set(event.data.callId, this.active)
    }
    if (event.type === 'turn/end') {
      if (this.active?.turn === event.data.turn) this.active = undefined
      for (const [callId, value] of this.calls) if (value.turn === event.data.turn) this.calls.delete(callId)
    }
  }

  associateNestedCall(callId: string, rootCallId: string): void {
    const root = this.calls.get(rootCallId)
    if (root) this.calls.set(callId, root)
  }

  forCall(callId: string): TurnContextProvenance | undefined {
    return this.calls.get(callId)?.provenance
  }
}
