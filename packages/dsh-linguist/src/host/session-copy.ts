import { realpathSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import type { LinguistProjectService } from '@linguist/domain-service'
import type { SessionEvent, SessionId } from '@deepseek-ai/dsh-session'
import { buildForkSeed, SESSION_FORMAT_VERSION, SessionId as asSessionId, SessionLogOffset } from '@deepseek-ai/dsh-session'
import type { SessionPersistence } from '@deepseek-ai/dsh-session-persistence'
import { WorkspaceId } from '@deepseek-ai/dsh-workspace'
import type { BindingStore } from './bindings'

export type LinguistSessionCopyEligibility =
  | { eligible: true; mode: 'blank' | 'fork' }
  | { eligible: false; reason: 'SESSION_NOT_FOUND' | 'NOT_LINGUIST_SESSION' | 'RUNNING' | 'HISTORY_UNREADABLE' | 'NO_COMPLETED_ASSISTANT' | 'TARGET_PROJECT_UNAVAILABLE' | 'SAME_PROJECT'; message: string }

export interface SessionCopyHost {
  bindings: BindingStore
  service: LinguistProjectService
  sessionController: {
    inspect(id: SessionId): Promise<{ meta: { cwd?: string; agentPreset?: string }; events: readonly SessionEvent[] }>
    create(input: { workspaceId: WorkspaceId; sessionId?: SessionId; agentPreset?: string }): Promise<{ sessionId: SessionId }>
    fork(input: { sessionId: SessionId }): Promise<{ sessionId: SessionId }>
    rename(input: { sessionId: SessionId; title: string }): Promise<unknown>
  }
  sessionPersistence: Pick<SessionPersistence, 'create'>
  workspaceRegistry: { get(id: WorkspaceId): { id: WorkspaceId; path: string } | undefined }
  sessionExists: (id: string) => Promise<boolean>
  agentStatus: (id: string) => 'idle' | 'running' | undefined
  rebindAgent: (id: string) => void
}

function completedAssistant(events: readonly SessionEvent[]): boolean {
  let lastCompleted = -1
  let lastTurnStart = -1
  let lastAssistant = -1
  for (const event of events) {
    if (event.type === 'turn/start') lastTurnStart = event.seq
    if (event.type === 'assistant/message') lastAssistant = event.seq
    if (event.type === 'turn/end' && event.data.reason.kind === 'completed' && lastAssistant > lastTurnStart) lastCompleted = event.seq
  }
  if (lastCompleted < lastAssistant || lastAssistant < 0) return false
  return !events.slice(lastCompleted + 1).some(event => event.type === 'turn/start' || event.type === 'user/message' || event.type === 'agent/inbox/spliced')
}

export async function sessionCopyEligibility(host: SessionCopyHost, sessionId: string, targetProjectId?: string): Promise<LinguistSessionCopyEligibility> {
  const binding = host.bindings.session(sessionId)
  const blocked = (reason: Exclude<LinguistSessionCopyEligibility, { eligible: true }>['reason'], message: string): LinguistSessionCopyEligibility => ({ eligible: false, reason, message })
  if (!await host.sessionExists(sessionId)) return blocked('SESSION_NOT_FOUND', 'Source DSH Session does not exist')
  let inspection: Awaited<ReturnType<SessionCopyHost['sessionController']['inspect']>>
  try { inspection = await host.sessionController.inspect(asSessionId(sessionId)) }
  catch { return blocked('HISTORY_UNREADABLE', 'Source DSH Session history cannot be read') }
  if (!binding?.projectId) return blocked('NOT_LINGUIST_SESSION', 'Source Session is not bound to a Linguist project')
  const workspace = host.workspaceRegistry.get(WorkspaceId(binding.workspaceId))
  let observedCwd: string | undefined
  try { observedCwd = inspection.meta.cwd && realpathSync(inspection.meta.cwd) }
  catch { return blocked('NOT_LINGUIST_SESSION', 'Source Session Workspace directory is unavailable') }
  if (!workspace || !observedCwd || observedCwd !== workspace.path || host.bindings.projectWorkspace(binding.projectId) !== workspace.id) {
    return blocked('NOT_LINGUIST_SESSION', 'Source Session project or Workspace binding changed')
  }
  if (host.agentStatus(sessionId) === 'running') return blocked('RUNNING', 'Source Session is running')
  const mode = inspection.events.some(event => event.type === 'user/message' || event.type === 'assistant/message') ? 'fork' : 'blank'
  if (mode === 'fork' && !completedAssistant(inspection.events)) return blocked('NO_COMPLETED_ASSISTANT', 'Source Session has no safely completed assistant turn')
  if (targetProjectId === undefined) return { eligible: true, mode }
  if (binding.projectId === targetProjectId) return blocked('SAME_PROJECT', 'Target project must differ from source project')
  let targetWorkspaceId: string | undefined
  try {
    const target = host.service.getProject(targetProjectId)
    targetWorkspaceId = host.bindings.projectWorkspace(targetProjectId)
    if (target.archivedAt || !host.service.checkProjectHealth(targetProjectId).healthy || !targetWorkspaceId || !host.workspaceRegistry.get(WorkspaceId(targetWorkspaceId))) {
      return blocked('TARGET_PROJECT_UNAVAILABLE', 'Target project is archived, unhealthy or has no available DSH Workspace')
    }
  } catch { return blocked('TARGET_PROJECT_UNAVAILABLE', 'Target project is unavailable') }
  return { eligible: true, mode }
}

export async function copyLinguistSessionToProject(host: SessionCopyHost, sourceSessionId: string, targetProjectId: string): Promise<{
  sessionId: string; workspaceId: string; projectId: string; role: string; workMode: string; mode: 'blank' | 'fork'
}> {
  const first = await sessionCopyEligibility(host, sourceSessionId, targetProjectId)
  if (!first.eligible) throw new Error(`${first.reason}: ${first.message}`)
  const source = host.bindings.session(sourceSessionId)!
  const project = host.service.getProject(targetProjectId)
  const targetWorkspaceId = host.bindings.projectWorkspace(targetProjectId)!
  const second = await sessionCopyEligibility(host, sourceSessionId, targetProjectId)
  if (!second.eligible || second.mode !== first.mode) throw new Error('Source Session changed during copy eligibility check')
  let copied: { sessionId: SessionId }
  if (first.mode === 'blank' || targetWorkspaceId !== source.workspaceId) {
    const snapshot = await host.sessionController.inspect(asSessionId(sourceSessionId))
    if (host.agentStatus(sourceSessionId) === 'running' || (first.mode === 'fork' ? !completedAssistant(snapshot.events)
      : snapshot.events.some(event => event.type === 'user/message' || event.type === 'assistant/message'))) throw new Error('Source Session changed before history capture')
    if (snapshot.events.length === 0) {
      copied = await host.sessionController.create({ workspaceId: WorkspaceId(targetWorkspaceId), agentPreset: snapshot.meta.agentPreset })
    } else {
      const id = asSessionId(`session-${randomUUID()}`)
      const boundary = snapshot.events.at(-1)!.seq
      try {
        const handle = await host.sessionPersistence.create({
          version: SESSION_FORMAT_VERSION, id, createdAt: Date.now(),
          cwd: host.workspaceRegistry.get(WorkspaceId(targetWorkspaceId))!.path,
          parentSession: asSessionId(sourceSessionId), isSeeded: true,
          ...(snapshot.meta.agentPreset === undefined ? {} : { agentPreset: snapshot.meta.agentPreset }),
        }, { inheritedEventCount: SessionLogOffset(boundary + 1) })
        try {
          await handle.append(buildForkSeed(snapshot.events, boundary))
          await handle.flush()
        } finally { await handle.close() }
        copied = await host.sessionController.create({ workspaceId: WorkspaceId(targetWorkspaceId), sessionId: id, agentPreset: snapshot.meta.agentPreset })
      } catch (error) {
        throw new Error(`Native DSH Session ${id} history copy failed; inspect this exact Session before retrying: ${String(error)}`)
      }
    }
  } else {
    copied = await host.sessionController.fork({ sessionId: asSessionId(sourceSessionId) })
  }
  const sessionId = String(copied.sessionId)
  const binding = { workspaceId: targetWorkspaceId, projectId: targetProjectId, role: source.role, workMode: source.workMode }
  try {
    host.bindings.bindSession(sessionId, binding)
    host.rebindAgent(sessionId)
    await host.sessionController.rename({ sessionId: copied.sessionId, title: `${project.name} (copy)` })
    const third = await sessionCopyEligibility(host, sourceSessionId, targetProjectId)
    const latestTarget = host.service.getProject(targetProjectId)
    if (!third.eligible || third.mode !== first.mode || latestTarget.archivedAt || !host.service.checkProjectHealth(targetProjectId).healthy
      || host.bindings.session(sessionId)?.projectId !== targetProjectId || host.bindings.projectWorkspace(targetProjectId) !== targetWorkspaceId) {
      throw new Error('Source or target changed during copy')
    }
  } catch (error) {
    throw new Error(`Native DSH Session ${sessionId} was created but copy finalization failed; inspect this exact Session before retrying: ${String(error)}`)
  }
  return { sessionId, workspaceId: targetWorkspaceId, projectId: targetProjectId, role: source.role, workMode: source.workMode, mode: first.mode }
}
