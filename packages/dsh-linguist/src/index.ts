import { realpathSync } from 'node:fs'
import { join } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-session-persistence'
import type {} from '@deepseek-ai/dsh-api-session-controller'
import type {} from '@deepseek-ai/dsh-subagent'
import type {} from '@deepseek-ai/dsh-schedule'
import Schema from '@deepseek-ai/schemastery'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { SessionId } from '@deepseek-ai/dsh-session'
import { WorkspaceId } from '@deepseek-ai/dsh-workspace'
import { createLinguistCatTools } from '@linguist/cat-tools'
import { LinguistProjectService } from '@linguist/domain-service'
import type { LinguistTurnContextV1 } from './host/automation-context'
import { BindingStore, type LinguistRole, type SessionBinding } from './host/bindings'
import { createCatDeps } from './host/cat-deps'
import { LinguistDelegationControl } from './host/delegation-control'
import { createLinguistDelegationTool } from './host/delegation-tool'
import { buildLinguistPromptSection, DIAGNOSTICS_OPERATIONS, DiagnosticsHost } from './host/diagnostics'
import { projectDiscoveryScope, authorizeWorkspaceRead, authorizeWorkspaceWrite } from './host/discovery'
import { EvidenceObserver } from './host/evidence'
import { ManagedFiles } from './host/files'
import { registerHttpRoutes } from './host/http'
import { INTEGRITY_OPERATIONS, IntegrityHost } from './host/integrity'
import { MutationBus } from './host/mutations'
import { dispatchOperation } from './host/operations'
import { loadLinguistRoleResources } from './host/role-resources'
import { ScheduleContextManager } from './host/schedule-context'
import { ScheduleSessionRuntime } from './host/schedule-session'
import { ensureStageEvidenceForSession } from './host/stage-evidence'
import { adaptCatTool } from './host/tool-adapter'
import { addPreparedTurnContext, TurnContextCallProvenance, TurnContextReceipts } from './host/turn-context'
import { createWorkingCopyTool } from './host/working-copy-tool'

export const name = '@linguist/dsh-plugin'
export const inject = ['agents', 'attachments', 'llm', 'schedule', 'sessionController', 'sessionPersistence', 'subagents', 'systemPrompt', 'tools', 'webServer', 'workspaceRegistry']
export const Config = Schema.object({ dataRoot: Schema.string(), installationId: Schema.string() })
export type Config = { dataRoot: string; installationId: string }

export function apply(ctx: Context, config: Config): void {
  if (!config.dataRoot || !config.installationId) throw new Error('Linguist product dataRoot and installationId are required')
  const service = new LinguistProjectService({ rootDir: join(config.dataRoot, 'linguist'), applicationVersion: '1.0.0' })
  service.init()
  const bindings = new BindingStore(config.dataRoot)
  const files = new ManagedFiles(config.dataRoot)
  const mutations = new MutationBus()
  const turnContextReceipts = new TurnContextReceipts(config.dataRoot)
  const evidence = new EvidenceObserver(service, config.dataRoot)
  const integrity = new IntegrityHost(service, mutations, files)
  const roleText = loadLinguistRoleResources(new URL('../resources/linguist-roles/', import.meta.url))
  const registered = new Map<string, () => void>()
  const delegationIntents = new Map<string, { parentSessionId: string; binding: SessionBinding }>()

  const resolveSessionWorkspace = async (sessionId: string): Promise<{ workspaceRoot: string }> => {
    const binding = bindings.session(sessionId)
    if (!binding) throw new Error('Session is not bound to a Linguist Workspace')
    const workspace = ctx.workspaceRegistry.get(WorkspaceId(binding.workspaceId))
    const stored = await ctx.sessionPersistence.stat(sessionId as SessionId)
    if (!workspace || !stored?.header.cwd || realpathSync(stored.header.cwd) !== workspace.path) throw new Error('DSH Session Workspace membership changed')
    return { workspaceRoot: workspace.path }
  }
  const assertProjectSession = async (sessionId: string, projectId: string): Promise<void> => {
    const binding = bindings.session(sessionId)
    if (!binding || binding.projectId !== projectId || binding.workspaceId !== bindings.projectWorkspace(projectId)) throw new Error('Session is not bound to this Linguist project')
    await resolveSessionWorkspace(sessionId)
  }
  const delegationControl = new LinguistDelegationControl(service, bindings, ctx.subagents, assertProjectSession)

  const bindAgent = (agent: Agent): void => {
    registered.get(agent.id)?.()
    registered.delete(agent.id)
    const binding = bindings.session(agent.id)
    if (!binding) return
    const workspace = ctx.workspaceRegistry.get(WorkspaceId(binding.workspaceId))
    if (!workspace || !agent.session.header.cwd || realpathSync(agent.session.header.cwd) !== workspace.path) {
      throw new Error(`Linguist Session ${agent.id} no longer belongs to its DSH Workspace`)
    }
    if (binding.projectId && bindings.projectWorkspace(binding.projectId) !== workspace.id) {
      throw new Error(`Linguist project binding changed for Session ${agent.id}`)
    }
    const turnContextProvenance = binding.projectId && binding.workMode === 'cat' ? new TurnContextCallProvenance() : undefined
    const disposers: Array<() => void> = []
    try {
      disposers.push(agent.ctx.systemPrompt.section({
        name: 'linguist-role', order: 300,
        text: () => buildLinguistPromptSection(service, roleText, binding, workspace.path).prompt,
        interpolate: false,
      }))
      if (turnContextProvenance) {
        disposers.push(agent.ctx.on('session/event', (session, event) => {
          if (session === agent.session) turnContextProvenance.observe(event)
        }))
        disposers.push(agent.ctx.on('agent/pre-step', async ({ turn }, next) => {
          const matched: Array<{ requestId: string; context: LinguistTurnContextV1 }> = []
          const decision = await addPreparedTurnContext({
            sessionId: agent.id,
            decision: await next(),
            receipts: turnContextReceipts,
            service,
            bindings,
            assertProjectSession,
            onAdmitted: (requestId, context) => { matched.push({ requestId, context }) },
          })
          turnContextProvenance.admitStep(turn, decision, matched)
          return decision
        }))
      }
      disposers.push(agent.ctx.tools.register(createWorkingCopyTool(() => {
        const current = bindings.session(agent.id)
        const owned = current && ctx.workspaceRegistry.get(WorkspaceId(current.workspaceId))
        if (!current || current.workspaceId !== binding.workspaceId || !owned || !agent.session.header.cwd || realpathSync(agent.session.header.cwd) !== owned.path) {
          throw new Error('Linguist working copy Session Workspace binding changed')
        }
        return {
          workspaceRoot: owned.path,
          sessionId: agent.id,
          ...(current.projectId ? { tagProfile: service.getProject(current.projectId).tagProfile } : {}),
        }
      }, async () => { await resolveSessionWorkspace(agent.id) })))
      if (binding.projectId && binding.workMode === 'cat' && binding.role === 'general') {
        const delegation = createLinguistDelegationTool({
          service, binding, agent, subagents: ctx.subagents, control: delegationControl,
          resolveSessionWorkspace: () => resolveSessionWorkspace(agent.id),
          reserveIntent: (childSessionId, intent) => {
            if (delegationIntents.has(childSessionId)) throw new Error('Linguist child identity is already reserved')
            delegationIntents.set(childSessionId, { parentSessionId: agent.id, binding: intent })
            return () => { delegationIntents.delete(childSessionId) }
          },
        })
        for (const tool of Object.values(delegation)) disposers.push(agent.ctx.tools.register(tool))
      }
      if (binding.projectId) {
        const projectId = binding.projectId
        const sessionId = agent.id
        const db = service.openProject(projectId)
        let stage = db.stageEvidence.list().find(item => item.sessionId === sessionId)
        const parentSession = agent.session.header.origin === 'subagent' ? agent.session.header.parentSession : undefined
        const parentStage = parentSession === undefined ? undefined : db.stageEvidence.list().find(item => item.sessionId === parentSession)
        const delegatedScope = binding.delegatedScope?.segmentIds ?? parentStage?.plan.segmentIds
        const assertBound = () => {
          const current = bindings.session(sessionId)
          if (!current || current.projectId !== projectId || current.workspaceId !== workspace.id) throw new Error('Linguist Session project binding changed')
        }
        const scope = () => projectDiscoveryScope(service, projectId, workspace.id, workspace.path)
        const prepareStage = (segmentIds: readonly string[], task?: { scope?: 'segments' | 'assets' | 'project'; restart?: boolean; toolCallId: string }) => {
          assertBound()
          if (binding.role === 'general' || db.readOnly) return
          const segments = db.segments.getByIds(segmentIds)
          if (segments.length !== new Set(segmentIds).size) throw new Error('Stage task contains missing segments')
          if (delegatedScope && segmentIds.some(id => !delegatedScope.includes(id))) throw new Error('Delegated work is outside the parent Stage scope')
          if (!task && stage && segmentIds.some(id => !stage!.plan.segmentIds.includes(id))) throw new Error('Write is outside frozen Stage scope')
          const selected = task?.scope === 'project' || (binding.role === 'reviewer' && task?.scope === undefined)
            ? delegatedScope ?? db.segments.queryIds()
            : task?.scope === 'assets'
              ? [...new Set(segments.flatMap(segment => db.segments.queryIds({ assetId: segment.assetId })))]
              : task?.scope === 'segments' ? segmentIds : stage?.plan.segmentIds ?? segmentIds
          if (delegatedScope && selected.some(id => !delegatedScope.includes(id))) throw new Error('Stage task is outside delegated scope')
          stage = ensureStageEvidenceForSession({
            session: { id: sessionId, linguistRole: binding.role }, db,
            discoveryScope: scope(), fallbackSegmentIds: selected,
            restart: task?.restart, toolCallId: task?.toolCallId,
          })
        }
        const deps = createCatDeps({
          service, projectId, sessionId, role: binding.role, sessionCwd: workspace.path,
          attachments: ctx.attachments, assertBound,
          authorizeReadPath: path => authorizeWorkspaceRead(path, workspace.path),
          authorizeWritePath: (path, overwrite) => authorizeWorkspaceWrite(path, workspace.path, overwrite),
          discoveryScope: async () => scope(),
          onMutation: mutation => { mutations.publish(projectId, mutation) },
          prepareStage,
          prepareContextDoc: docId => {
            assertBound()
            if (!stage || db.readOnly) return
            stage = ensureStageEvidenceForSession({
              session: { id: sessionId, linguistRole: binding.role }, db,
              discoveryScope: scope(), fallbackSegmentIds: stage.plan.segmentIds, contextDocId: docId,
            })
          },
          onEvidencePrepared: (receipt) => evidence.prepare(projectId, receipt),
          generationProvenance: toolCallId => ({ sessionId, toolCallId, runId: `dsh:${sessionId}:${toolCallId}`, modelProvider: agent.options.provider, modelId: agent.options.model, runtime: 'dsh-native', ...(turnContextProvenance?.forCall(toolCallId) ?? {}) }),
          stageEvidenceRunId: () => stage?.stageRunId,
          reviewScopeSegmentIds: () => stage?.plan.segmentIds,
          delegatedScopeSegmentIds: () => delegatedScope,
          ...(agent.options.model === undefined ? {} : { modelId: agent.options.model }),
        })
        for (const source of createLinguistCatTools(deps)) {
          disposers.push(agent.ctx.tools.register(adaptCatTool(source, ctx.attachments, (callId, content) => evidence.presented(sessionId, callId, content), (callId, rootCallId) => turnContextProvenance?.associateNestedCall(callId, rootCallId))))
        }
      }
      registered.set(agent.id, () => { for (const dispose of disposers.reverse()) dispose() })
    } catch (error) {
      for (const dispose of disposers.reverse()) dispose()
      throw error
    }
  }

  ctx.on('agent/created', ({ agent }) => {
    let inherited = false
    if (!bindings.session(agent.id) && agent.session.header.origin === 'subagent' && agent.session.header.parentSession) {
      const parent = bindings.session(agent.session.header.parentSession)
      if (parent) {
        const workspace = ctx.workspaceRegistry.get(WorkspaceId(parent.workspaceId))
        if (!workspace || !agent.session.header.cwd || realpathSync(agent.session.header.cwd) !== workspace.path) throw new Error('Linguist subagent Workspace differs from its parent')
        const intent = delegationIntents.get(agent.id)
        if (intent && intent.parentSessionId !== agent.session.header.parentSession) throw new Error('Linguist child parent identity changed')
        bindings.bindSession(agent.id, intent?.binding ?? parent)
        inherited = true
      }
    }
    try { bindAgent(agent) }
    catch (error) { if (inherited) bindings.restoreSession(agent.id, undefined); throw error }
    return undefined
  })
  ctx.on('agent/disposed', ({ agent }) => { registered.get(agent.id)?.(); registered.delete(agent.id) })
  ctx.on('llm/stream', (options, next) => evidence.stream(options, next))
  for (const agent of ctx.agents.list()) bindAgent(agent)

  const scheduleContext = new ScheduleContextManager(config.dataRoot, ctx.schedule, service, bindings, assertProjectSession,
    async (sessionId: string) => {
      const live = ctx.sessions.get(sessionId as SessionId)
      if (live) return live.ownEvents()
      if (!await ctx.sessionPersistence.stat(sessionId as SessionId)) return undefined
      const handle = await ctx.sessionPersistence.open(sessionId as SessionId, 'read')
      try { return (await handle.read(handle.inheritedEventCount)).events }
      finally { await handle.close() }
    },
    async (sessionId, message) => {
      const resolved = await ctx.sessionController.resolveAgent(sessionId as SessionId)
      if ('error' in resolved) throw resolved.error
      resolved.agent.followup(message)
      if (!await ctx.sessions.flush(resolved.agent.session)) throw new Error('Native DSH Session did not acknowledge manual Schedule delivery')
    })
  ctx.on('session/event', async (session, event) => {
    if (event.type === 'turn/end') {
      await scheduleContext.recordExecutionEnd(session.id)
      scheduleContext.clearTurn(session.id, event.data.turn)
      if (bindings.session(session.id)?.projectId) await scheduleContext.enforceRunPolicy(session.id)
    }
  })
  const scheduleSessions = new ScheduleSessionRuntime(ctx, bindings, bindAgent)
  ctx.on('agent/pre-step', async ({ agent, messages, turn, step }, next) => {
    scheduleContext.recordAttempts(agent, messages, turn)
    return scheduleContext.onPreStep(agent, await scheduleContext.dispatchDue(agent, await next(), turn, scheduleSessions), turn, step)
  })
  ctx.on('agent/request', async ({ agent, turn, step }, next) => {
    const config = await next()
    await scheduleContext.validateModelRequest(agent, turn, step, config, (provider, model) => ctx.llm.resolveModelInfo(provider, model))
    return config
  })
  ctx.on('agent/disposed', ({ agent }) => { scheduleContext.clearSession(agent.id) })
  const detachSessionBinding = async (sessionId: string) => {
    const previous = bindings.session(sessionId)
    if (!previous) return { sessionId, detached: false, cancelledScheduleIds: [], historicalEvidencePreserved: true as const }
    await resolveSessionWorkspace(sessionId)
    const agent = ctx.agents.get(sessionId as SessionId)
    if (agent?.status === 'running') throw new Error('Stop the DSH Agent before detaching its Linguist binding')
    const cancelledScheduleIds = await scheduleContext.stopSessionSchedules(sessionId)
    bindings.restoreSession(sessionId, undefined)
    try { if (agent) bindAgent(agent) }
    catch (error) { bindings.restoreSession(sessionId, previous); if (agent) bindAgent(agent); throw error }
    return { sessionId, detached: true, cancelledScheduleIds, historicalEvidencePreserved: true as const }
  }
  const diagnostics = new DiagnosticsHost(service, bindings, files, {
    roleText, assertProjectSession,
    resolveWorkspaceRoot: workspaceId => ctx.workspaceRegistry.get(WorkspaceId(workspaceId))?.path,
    getSession: async sessionId => {
      const agent = ctx.agents.get(sessionId as SessionId)
      return agent ? { cwd: agent.session.header.cwd } : undefined
    },
  })
  const removeHttp = registerHttpRoutes({
    ctx, service, bindings, files, mutations, installationId: config.installationId,
    rebindAgent: sessionId => { const agent = ctx.agents.get(sessionId as SessionId); if (agent) bindAgent(agent) },
    dispatch: (operation, payload) => INTEGRITY_OPERATIONS.includes(operation as typeof INTEGRITY_OPERATIONS[number])
      ? integrity.dispatch(operation, payload)
      : DIAGNOSTICS_OPERATIONS.includes(operation as typeof DIAGNOSTICS_OPERATIONS[number])
        ? diagnostics.dispatch(operation, payload)
        : dispatchOperation({ operation, payload, service, bindings, workspaceRegistry: ctx.workspaceRegistry, files, mutations, assertProjectSession, resolveSessionWorkspace, turnContextReceipts, scheduleContext, delegationControl, detachSessionBinding,
            sessionCopyHost: { bindings, service, sessionController: ctx.sessionController, sessionPersistence: ctx.sessionPersistence, workspaceRegistry: ctx.workspaceRegistry,
              sessionExists: async id => Boolean(await ctx.sessionPersistence.stat(id as SessionId)),
              agentStatus: id => ctx.agents.get(id as SessionId)?.status,
              rebindAgent: id => { const agent = ctx.agents.get(id as SessionId); if (agent) bindAgent(agent) },
            },
          }),
  })
  ctx.effect(() => () => {
    removeHttp()
    for (const dispose of registered.values()) dispose()
    registered.clear()
    integrity.dispose()
    service.closeAll()
  })
}
