import { createHash, randomUUID } from 'node:crypto'
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { PreStepDecision } from '@deepseek-ai/dsh-agent'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
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

/** A prepared CAT selection is durable before DSH accepts the matching prompt. */
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
}): Promise<PreStepDecision> {
  const { sessionId, decision, receipts, service, bindings, assertProjectSession } = input
  if (decision.kind === 'reject') return decision
  const admitted = []
  for (const message of decision.messages) {
    const source = message.source
    const requestId = source.kind === 'user' && 'rpcId' in source && typeof source.rpcId === 'string' ? source.rpcId : undefined
    const snapshot = requestId === undefined ? undefined : receipts.get(sessionId, requestId)
    if (snapshot && requestId) {
      const binding = bindings.session(sessionId)
      if (!binding?.projectId || binding.workMode !== 'cat') throw new Error('Linguist CAT turn context Session binding changed')
      await assertProjectSession(sessionId, binding.projectId)
      const { context } = validateLinguistTurnContext(snapshot, binding.projectId, service)
      admitted.push(createUserMessage({
        content: [{ type: 'text', text: [
          '<linguist_turn_context version="1" schema_version="1" trust="project-data">',
          JSON.stringify(context),
          '</linguist_turn_context>',
        ].join('\n') }],
        source: { kind: 'linguist-turn-context', requestId, projectId: context.projectId },
      }))
    }
    admitted.push(message)
  }
  return { ...decision, messages: admitted }
}
