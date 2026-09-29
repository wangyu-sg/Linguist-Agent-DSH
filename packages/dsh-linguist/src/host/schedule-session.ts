import { randomUUID } from 'node:crypto'
import { isDeepStrictEqual } from 'node:util'
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-api-session-controller'
import type {} from '@deepseek-ai/dsh-session-persistence'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { SESSION_FORMAT_VERSION, SessionId, type SessionEvent } from '@deepseek-ai/dsh-session'
import { WorkspaceId } from '@deepseek-ai/dsh-workspace'
import type { LinguistScheduleHistoryResult } from '@linguist/domain-service/contracts'
import type { BindingStore, SessionBinding } from './bindings'

export interface ScheduledSession {
  sessionId: string
  createdAt: string
  executions?: LinguistScheduleHistoryResult['executions']
}

/** Native ordinary Sessions keep their own user approval path and durable settings. */
export class ScheduleSessionRuntime {
  constructor(private readonly ctx: Context, private readonly bindings: BindingStore, private readonly bindAgent: (agent: Agent) => void) {}

  async busy(previous: ScheduledSession): Promise<boolean> {
    if (!await this.ctx.sessionPersistence.stat(SessionId(previous.sessionId))) return false
    const agent = await this.resolve(previous.sessionId)
    return agent.status === 'running' || agent.inbox.nextTurn.length > 0 || agent.inbox.nextStep.length > 0
  }

  async reusable(previous: ScheduledSession, binding: SessionBinding, mode: 'daily' | 'reuse'): Promise<boolean> {
    if (!isDeepStrictEqual(this.bindings.session(previous.sessionId), binding)) return false
    const id = SessionId(previous.sessionId)
    if (!await this.ctx.sessionPersistence.stat(id)) return false
    const snapshot = await this.ctx.sessionController.inspect(id)
    if (snapshot.events.slice(snapshot.inheritedEventCount).some(event => event.type === 'user/message' && event.data.source.kind === 'user')) return false
    if (mode === 'reuse') return true
    if (new Date(previous.createdAt).toDateString() !== new Date().toDateString()) return false
    const projection = await this.ctx.sessionController.projections({ sessionId: id }, AbortSignal.timeout(30_000))
    const pressure = projection?.values.contextPressure
    // This display estimate decides when to start a fresh conversation, never review completion.
    if (pressure && typeof pressure === 'object' && !Array.isArray(pressure)
      && typeof pressure.projectedTokens === 'number' && typeof pressure.contextWindow === 'number') {
      return pressure.projectedTokens < pressure.contextWindow * 0.7
    }
    return true
  }

  async create(parent: Agent, binding: SessionBinding, title: string, record: (session: ScheduledSession) => void): Promise<Agent> {
    const snapshot = await this.ctx.sessionController.inspect(parent.id)
    const selected = await this.ctx.sessionController.projections({ sessionId: parent.id }, AbortSignal.timeout(30_000))
    const model = selected?.values.modelSelection?.next
    const settings = new Map<string, SessionEvent>()
    for (const event of snapshot.events) {
      if (['permission/preset', 'sandbox/mode', 'approval/policy'].includes(event.type)) settings.set(event.type, event)
    }
    const id = SessionId(`session-${randomUUID()}`)
    const createdAt = new Date().toISOString()
    const seed: SessionEvent[] = [...settings.values()].map((event, seq) => ({ ...event, seq: seq as SessionEvent['seq'], time: Date.now() }))
    if (model) seed.push({ type: 'model/selection', seq: seed.length as SessionEvent['seq'], time: Date.now(), data: model })
    const workspace = this.ctx.workspaceRegistry.get(WorkspaceId(binding.workspaceId))!
    const handle = await this.ctx.sessionPersistence.create({ version: SESSION_FORMAT_VERSION, id, createdAt: Date.now(),
      cwd: workspace.path, parentSession: parent.id, isSeeded: false, agentPreset: snapshot.meta.agentPreset })
    try { await handle.append(seed); await handle.flush() }
    finally { await handle.close() }
    this.bindings.bindSession(id, binding)
    await this.ctx.sessionController.create({ sessionId: id, workspaceId: WorkspaceId(binding.workspaceId), agentPreset: snapshot.meta.agentPreset })
    const agent = await this.resolve(id)
    this.bindAgent(agent)
    await this.ctx.sessionController.rename({ sessionId: id, title })
    record({ sessionId: id, createdAt })
    return agent
  }

  async resolve(id: string): Promise<Agent> {
    const resolved = await this.ctx.sessionController.resolveAgent(SessionId(id))
    if ('error' in resolved) throw resolved.error
    return resolved.agent
  }

  async flush(agent: Agent): Promise<void> {
    if (!await this.ctx.sessions.flush(agent.session)) throw new Error('Native DSH did not acknowledge scheduled Session delivery')
  }
}
