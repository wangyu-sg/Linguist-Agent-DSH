import type { Agent } from '@deepseek-ai/dsh-agent'
import { SessionId } from '@deepseek-ai/dsh-session'
import type { SubagentRuntime, SubagentPromptRequestId } from '@deepseek-ai/dsh-subagent'
import type { LinguistProjectService } from '@linguist/domain-service'
import type { BindingStore, SessionBinding } from './bindings'
import { linguistDelegationOutcome } from './delegation'

type NativeControl = Pick<SubagentRuntime, 'listChildren' | 'sendMessage' | 'prompt' | 'interruptByParent'>

/** LA checks project authority and frozen CAT scope; DSH owns every child lifecycle transition. */
export class LinguistDelegationControl {
  constructor(
    private readonly service: LinguistProjectService,
    private readonly bindings: BindingStore,
    private readonly native: NativeControl,
    private readonly assertProjectSession: (sessionId: string, projectId: string) => Promise<void>,
  ) {}

  async list(parentSessionId: string): Promise<{ items: Array<{
    childSessionId: string; label: string; createdAt: number; role: SessionBinding['role'];
    scope: NonNullable<SessionBinding['delegatedScope']>
    professionalOutcome: ReturnType<typeof linguistDelegationOutcome>
  }> }> {
    const parent = await this.parent(parentSessionId)
    const children = await this.native.listChildren(SessionId(parentSessionId))
    const items = []
    for (const child of children) {
      if (child.mode !== 'continuable') continue
      const binding = this.bindings.session(child.id)
      if (!binding?.delegatedScope || binding.projectId !== parent.projectId || binding.workspaceId !== parent.workspaceId) continue
      items.push({ childSessionId: child.id, label: child.label, createdAt: child.createdAt,
        role: binding.role, scope: binding.delegatedScope,
        professionalOutcome: linguistDelegationOutcome(this.service, child.id, binding) })
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
      parentSessionId: SessionId(parentSessionId), childSessionId: SessionId(childSessionId),
      requestId: requestId as SubagentPromptRequestId, mode: 'continuable', delivery,
      content: [{ type: 'text', text }],
    }, AbortSignal.timeout(30_000))
    return { messageId: result.messageId }
  }

  async interrupt(parentSessionId: string, childSessionId: string): Promise<{ childSessionId: string; accepted: true; scope: 'current-turn' }> {
    await this.child(parentSessionId, childSessionId)
    const result = this.native.interruptByParent(SessionId(childSessionId), SessionId(parentSessionId), 'continuable')
    return { childSessionId, accepted: result.accepted, scope: 'current-turn' }
  }

  private async parent(sessionId: string): Promise<SessionBinding & { projectId: string }> {
    const binding = this.bindings.session(sessionId)
    if (!binding?.projectId || binding.workMode !== 'cat') throw new Error('Parent is not bound to a Linguist CAT project')
    await this.assertProjectSession(sessionId, binding.projectId)
    return binding as SessionBinding & { projectId: string }
  }

  private async child(parentSessionId: string, childSessionId: string): Promise<SessionBinding> {
    const parent = await this.parent(parentSessionId)
    const catalog = await this.native.listChildren(SessionId(parentSessionId))
    if (!catalog.some(item => item.id === childSessionId && item.mode === 'continuable')) throw new Error('Child is not a direct continuable DSH subagent')
    const child = this.bindings.session(childSessionId)
    if (!child?.delegatedScope?.segmentIds.length || child.projectId !== parent.projectId || child.workspaceId !== parent.workspaceId
      || child.role === 'general' || child.workMode !== 'cat' || this.bindings.projectWorkspace(parent.projectId) !== parent.workspaceId) {
      throw new Error('Child Linguist project or frozen binding changed')
    }
    const db = this.service.openProject(parent.projectId)
    for (const assetId of child.delegatedScope.assetIds) if (!db.assets.get(assetId)) throw new Error('Delegated Asset is unavailable')
    for (const segmentId of child.delegatedScope.segmentIds) {
      const segment = db.segments.getById(segmentId)
      if (!segment || (parent.delegatedScope && !parent.delegatedScope.segmentIds.includes(segmentId))) throw new Error('Delegated Segment scope changed')
    }
    return child
  }
}
