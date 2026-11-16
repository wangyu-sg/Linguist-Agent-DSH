import type { Agent } from '@deepseek-ai/dsh-agent'
import { SessionId } from '@deepseek-ai/dsh-session'
import type { SubagentRuntime, SubagentPromptRequestId } from '@deepseek-ai/dsh-subagent'
import type { LinguistProjectService } from '@linguist/domain-service'
import type { BindingStore, SessionBinding } from './bindings'
import { linguistDelegationOutcome } from './delegation'

type NativeControl = Pick<SubagentRuntime, 'listDescendants' | 'sendMessage' | 'prompt' | 'interrupt'>

/** DSH owns child lifecycle; LA keeps workspace and any CAT scope binding. */
export class LinguistDelegationControl {
  constructor(
    private readonly service: LinguistProjectService,
    private readonly bindings: BindingStore,
    private readonly native: NativeControl,
    private readonly assertProjectSession: (sessionId: string, projectId: string) => Promise<void>,
  ) {}

  async list(parentSessionId: string): Promise<{ items: Array<{
    childSessionId: string; label: string; role: SessionBinding['role'];
    scope?: SessionBinding['delegatedScope']
    professionalOutcome?: NonNullable<ReturnType<typeof linguistDelegationOutcome>>
  }> }> {
    const parent = await this.parent(parentSessionId)
    const children = await this.native.listDescendants(SessionId(parentSessionId))
    const items = []
    for (const child of children) {
      if (child.parentId !== parentSessionId) continue
      if (child.kind === 'diagnostic') throw new Error(`DSH child catalog ${child.id}: ${child.reason}`)
      if (child.mode !== 'continuable') continue
      const binding = this.bindings.session(child.id)
      if (!binding || binding.role === 'general' || binding.projectId !== parent.projectId || binding.workspaceId !== parent.workspaceId) continue
      const professionalOutcome = linguistDelegationOutcome(this.service, child.id, binding)
      items.push({ childSessionId: child.id, label: child.label,
        role: binding.role, ...(binding.delegatedScope ? { scope: binding.delegatedScope } : {}),
        ...(professionalOutcome ? { professionalOutcome } : {}) })
    }
    return { items }
  }

  async sendMessage(parent: Agent, childSessionId: string, text: string, signal: AbortSignal): Promise<{ messageId: string }> {
    await this.child(parent.id, childSessionId)
    const messageId = await this.native.sendMessage(parent, SessionId(childSessionId), [{ type: 'text', text }], { signal })
    return { messageId }
  }

  async prompt(parentSessionId: string, childSessionId: string, requestId: string, text: string, delivery: 'queue' | 'steer'): Promise<{ messageId: string }> {
    await this.child(parentSessionId, childSessionId)
    const result = await this.native.prompt({
      childSessionId: SessionId(childSessionId),
      requestId: requestId as SubagentPromptRequestId, delivery,
      content: [{ type: 'text', text }],
    }, AbortSignal.timeout(30_000))
    return { messageId: result.messageId }
  }

  async interrupt(parentSessionId: string, childSessionId: string, parent?: Agent): Promise<{ childSessionId: string; accepted: true; scope: 'current-turn' }> {
    await this.child(parentSessionId, childSessionId)
    this.native.interrupt(SessionId(childSessionId), parent === undefined ? { kind: 'user' } : { kind: 'ancestor', agent: parent })
    return { childSessionId, accepted: true, scope: 'current-turn' }
  }

  private async parent(sessionId: string): Promise<SessionBinding> {
    const binding = this.bindings.session(sessionId)
    if (!binding) throw new Error('Parent is not bound to a Linguist workspace')
    if (binding.projectId) await this.assertProjectSession(sessionId, binding.projectId)
    return binding
  }

  private async child(parentSessionId: string, childSessionId: string): Promise<SessionBinding> {
    const parent = await this.parent(parentSessionId)
    const catalog = await this.native.listDescendants(SessionId(parentSessionId))
    if (!catalog.some(item => item.kind === 'child' && item.parentId === parentSessionId && item.id === childSessionId && item.mode === 'continuable')) throw new Error('Child is not a direct continuable DSH subagent')
    const child = this.bindings.session(childSessionId)
    if (!child || child.projectId !== parent.projectId || child.workspaceId !== parent.workspaceId || child.role === 'general'
      || (parent.projectId !== undefined && this.bindings.projectWorkspace(parent.projectId) !== parent.workspaceId)
      || (child.workMode === 'cat' && !child.delegatedScope?.segmentIds.length)) {
      throw new Error('Child Linguist project or frozen binding changed')
    }
    if (parent.projectId && child.delegatedScope) {
      const db = this.service.openProject(parent.projectId)
      for (const assetId of child.delegatedScope.assetIds) if (!db.assets.get(assetId)) throw new Error('Delegated Asset is unavailable')
      for (const segmentId of child.delegatedScope.segmentIds) {
        const segment = db.segments.getById(segmentId)
        if (!segment || (parent.delegatedScope && !parent.delegatedScope.segmentIds.includes(segmentId))) throw new Error('Delegated Segment scope changed')
      }
    }
    return child
  }
}
