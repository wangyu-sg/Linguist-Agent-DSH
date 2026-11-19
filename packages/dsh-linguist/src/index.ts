import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { realpathSync } from 'node:fs'
import { basename, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Context, Volatile } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-session-persistence'
import type {} from '@deepseek-ai/dsh-session-query'
import type {} from '@deepseek-ai/dsh-api-session-controller'
import type {} from '@deepseek-ai/dsh-agent-preset-registry'
import type {} from '@deepseek-ai/dsh-subagent'
import type {} from '@deepseek-ai/dsh-schedule'
import type {} from '@deepseek-ai/dsh-skill'
import { FileSystemSkillProvider } from '@deepseek-ai/dsh-skill-filesystem'
import Schema from '@deepseek-ai/schemastery'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { SessionId } from '@deepseek-ai/dsh-session'
import { WorkspaceId } from '@deepseek-ai/dsh-workspace'
import manifest from '../package.json' with { type: 'json' }
import { createLinguistCatTools, type CatWorkerJobProgress } from '@linguist/cat-tools'
import type { ProjectDatabase, StageEvidenceState } from '@linguist/cat-store'
import { LinguistProjectService, type ContextImageMetadata } from '@linguist/domain-service'
import type { LinguistTurnContextV1 } from './host/automation-context'
import { BindingStore, type LinguistRole, type SessionBinding } from './host/bindings'
import { createCatDeps } from './host/cat-deps'
import { DEFAULT_DATA_ROOT, initializeStorage } from './host/config'
import { LinguistDelegationControl } from './host/delegation-control'
import { createLinguistDelegationTool } from './host/delegation-tool'
import { createDeliveryReportTool } from './host/delivery-report-tool'
import { buildFixedLinguistPrompt, buildLinguistTaskContext, DIAGNOSTICS_OPERATIONS, DiagnosticsHost } from './host/diagnostics'
import { projectDiscoveryScope, authorizeWorkspaceRead, authorizeWorkspaceWrite } from './host/discovery'
import { EvidenceObserver } from './host/evidence'
import { ManagedFiles } from './host/files'
import { registerHttpRoutes } from './host/http'
import { INTEGRITY_OPERATIONS, IntegrityHost } from './host/integrity'
import { MutationBus } from './host/mutations'
import { resolveExecutionProfile } from './host/execution-profile'
import { routeTask } from './host/task-routing'
import { ModelCallProvenance } from './host/model-provenance'
import { dispatchOperation } from './host/operations'
import { loadLinguistRoleResources } from './host/role-resources'
import { loadProfessionalResources } from './host/professional-context'
import { SessionReadSnapshots } from './host/read-snapshots'
import { ScheduleContextManager } from './host/schedule-context'
import { ScheduleNotifications, type FeishuDestination } from './host/schedule-notifications'
import { ScheduleSessionRuntime } from './host/schedule-session'
import { ensureStageEvidenceForSession } from './host/stage-evidence'
import { adaptCatTool } from './host/tool-adapter'
import { addPreparedTurnContext, TurnContextCallProvenance, TurnContextReceipts } from './host/turn-context'
import { createWorkingCopyTool } from './host/working-copy-tool'
import { createReviewMaterialsTool } from './host/review-materials-tool'
import { createProjectPreparationTool } from './host/project-preparation-tool'
import { settingsOperation, SETTINGS_OPERATIONS } from './host/settings'

export const name = '@linguist/dsh-plugin'
export const inject = ['agents', 'agentPresets', 'attachments', 'llm', 'schedule', 'sessionController', 'sessionPersistence', 'sessionQuery', 'sessions', 'skills', 'subagents', 'systemPrompt', 'tools', 'webServer', 'workspaceRegistry']
export const Config = Schema.object({ dataRoot: Schema.string().default(DEFAULT_DATA_ROOT), installationId: Schema.string().default(''),
  notificationDestinations: Schema.array(Schema.object({ id: Schema.string().required(), label: Schema.string().required(),
    appId: Schema.string().required(), appSecret: Schema.string().role('secret').required(), chatId: Schema.string().required(),
    domain: Schema.union(['feishu', 'lark']).default('feishu'),
  })).default([]).volatile(),
})
export type Config = { dataRoot: string; installationId: string; notificationDestinations: Volatile<FeishuDestination[]> }

function presetRole(preset: string | null | undefined): LinguistRole | undefined {
  if (preset === 'linguist') return 'general'
  if (preset === 'linguist-translator') return 'translator'
  if (preset === 'linguist-reviewer') return 'reviewer'
  if (preset === 'linguist-proofreader') return 'proofreader'
  return undefined
}

export function apply(ctx: Context, config: Config): void {
  config = { ...config, ...initializeStorage(config) }
  const bindings = new BindingStore(config.dataRoot)
  const service = new LinguistProjectService({
    rootDir: join(config.dataRoot, 'linguist'), applicationVersion: manifest.version,
    workspaceRootForProject(projectId) {
      const id = bindings.projectWorkspace(projectId)
      return id ? ctx.workspaceRegistry.get(WorkspaceId(id))?.path : undefined
    },
  })
  service.init()
  const files = new ManagedFiles(config.dataRoot)
  const stagingCleanup = setInterval(() => files.collectExpired(), 60_000)
  stagingCleanup.unref()
  ctx.effect(() => () => clearInterval(stagingCleanup))
  const mutations = new MutationBus()
  const turnContextReceipts = new TurnContextReceipts(config.dataRoot)
  const evidence = new EvidenceObserver(service, config.dataRoot)
  const integrity = new IntegrityHost(service, mutations, files)
  const professional = loadProfessionalResources(new URL('../resources/professional-judgment/', import.meta.url))
  const roleText = loadLinguistRoleResources(new URL('../resources/linguist-roles/', import.meta.url))
  const deliveryTemplates = new URL('../resources/delivery-templates/', import.meta.url)
  ctx.skills.registerProvider(control => new FileSystemSkillProvider(ctx, control, {
    providerName: 'linguist', includeDefaultRoots: false, watch: false,
    bundledSkillDir: fileURLToPath(new URL('../resources/skills/', import.meta.url)),
  }))
  const registered = new Map<string, () => void>()
  const delegationIntents = new Map<string, { parentSessionId: string; binding: SessionBinding }>()
  const assertNoOtherWriter = (sessionId: string, scope: SessionBinding) => {
    if (scope.reportOnly || (!scope.delegatedScope?.segmentIds.length && !scope.professionalSource)) return
    const segments = new Set(scope.delegatedScope?.segmentIds)
    const candidates = [...delegationIntents].map(([id, intent]) => [id, intent.binding] as const)
    for (const candidate of ctx.agents.list()) {
      if (candidate.status !== 'running' && !candidate.inbox?.nextTurn.length && !candidate.inbox?.nextStep.length) continue
      const other = bindings.session(candidate.id)
      if (other) candidates.push([candidate.id, other])
    }
    const conflict = candidates.some(([id, other]) => id !== sessionId && !other.reportOnly
      && other.workspaceId === scope.workspaceId && other.projectId === scope.projectId
      && (Boolean(scope.professionalSource && scope.professionalSource === other.professionalSource)
        || other.delegatedScope?.segmentIds.some(id => segments.has(id))))
    if (conflict) throw new Error('此范围已有专业岗位正在写入，请等它保存交接后再启动下一阶段')
  }

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
    const turnContextProvenance = binding.projectId ? new TurnContextCallProvenance() : undefined
    let selectedAssetId: string | undefined
    const currentBinding = (): SessionBinding => {
      const current = bindings.session(agent.id)!
      if (current.delegatedScope && current.projectId && current.taskGroupId) {
        service.openProject(current.projectId).taskGroups.assertContains(current.taskGroupId, 'assets', current.delegatedScope.assetIds)
        return current
      }
      const taskGroupId = selectedAssetId && current.projectId && service.openProject(current.projectId).taskGroups.groupOf(selectedAssetId)
      return taskGroupId ? { ...current, taskGroupId } : current
    }
    let reviewScope = (): readonly string[] | undefined => bindings.session(agent.id)?.delegatedScope?.segmentIds
    const modelProvenance = new ModelCallProvenance()
    const fixedPrompt = buildFixedLinguistPrompt(roleText, professional, binding.role)
    let expectedContextHash: string | undefined
    let lastContextInput: string | undefined
    const disposers: Array<() => void> = []
    try {
      disposers.push(agent.ctx.systemPrompt.section({
        name: 'linguist-role', order: 300,
        text: () => fixedPrompt.prompt,
        interpolate: false,
      }))
      disposers.push(agent.ctx.on('llm/stream', (options, next) => {
        if (options.sessionId === agent.id && options.purpose === undefined) {
          modelProvenance.dispatched(options, fixedPrompt, expectedContextHash)
        }
        return next()
      }))
      disposers.push(agent.ctx.on('session/event', (session, event) => {
        if (session === agent.session) modelProvenance.observe(event)
      }))
      disposers.push(agent.ctx.on('agent/pre-step', async ({ turn }, next) => {
        let decision = await next()
        const matched: Array<{ requestId: string; context: LinguistTurnContextV1 }> = []
        if (turnContextProvenance) {
          decision = await addPreparedTurnContext({ sessionId: agent.id, decision, receipts: turnContextReceipts,
            service, bindings, assertProjectSession,
            onAdmitted: (requestId, context) => { matched.push({ requestId, context }) } })
          turnContextProvenance.admitStep(turn, decision, matched)
          if (decision.kind === 'reject' || decision.messages.some(message => message.source.kind === 'user')) {
            selectedAssetId = matched.length === 1 ? matched[0]!.context.assetId : undefined
            if (selectedAssetId) {
              const selected = currentBinding()
              if (selected.taskGroupId !== bindings.session(agent.id)?.taskGroupId) bindings.bindSession(agent.id, selected)
            }
          }
        }
        if (decision.kind === 'reject') return decision
        const current = currentBinding()
        let selection = agent.model.current()
        if (current.useRoleDefaults && selection && !selection.reasoningEffort && !current.executionProfile) {
          const userSelected = agent.session.ownEvents().some(event => event.type === 'model/selection')
          const resolved = await resolveExecutionProfile(ctx.llm, selection, current.role, true, userSelected)
          if (resolved.profile.source === 'la-role-default') {
            agent.model.select({ ...selection, reasoningEffort: resolved.options.reasoningEffort })
            selection = agent.model.current()
          }
          current.executionProfile = resolved.profile
          bindings.bindSession(agent.id, current)
        }
        const lastContext = agent.session.deriveMessages().findLast(message => message.source.kind === 'linguist-task-context')?.source
        const lastHash = lastContext?.kind === 'linguist-task-context' ? lastContext.hash : undefined
        const input = JSON.stringify([turn, current.projectId, current.taskGroupId, current.workMode, current.workModeDecision,
          current.reportOnly, current.delegatedScope, selection, current.projectId && mutations.revision(current.projectId)])
        if (input !== lastContextInput || lastHash !== expectedContextHash) {
          const dynamic = buildLinguistTaskContext(service, current, workspace.path, {
            sessionId: agent.id,
            model: selection ? { ...selection, selectionSource: current.executionProfile?.model === selection.model && current.executionProfile.provider === selection.provider
              ? current.executionProfile.source : 'current-session' } : undefined,
            resumed: !lastHash && (lastContextInput !== undefined || agent.session.ownEvents().some(event => event.type === 'turn/end')),
          })
          lastContextInput = input
          expectedContextHash = dynamic.hash
          if (lastHash !== dynamic.hash) decision = { ...decision, messages: [createUserMessage({
            content: [{ type: 'text', text: dynamic.content }], source: { kind: 'linguist-task-context', form: 'snapshot', hash: dynamic.hash },
          }), ...decision.messages] }
        }
        return decision
      }))
      disposers.push(agent.ctx.tools.register(createDeliveryReportTool(deliveryTemplates, async () => ({
        ...await resolveSessionWorkspace(agent.id), role: currentBinding().role,
      }))))
      disposers.push(agent.ctx.tools.register(createProjectPreparationTool(service, async (callId, useTurnQuestion) => {
        const { workspaceRoot } = await resolveSessionWorkspace(agent.id)
        const snapshot = turnContextProvenance?.forCall(callId)?.turnContextSnapshot
        const selection: LinguistTurnContextV1 | undefined = snapshot ? JSON.parse(snapshot) : undefined
        const segmentIds = selection && [...new Set([...selection.selectedSegmentIds, ...(selection.activeSegmentId ? [selection.activeSegmentId] : [])])]
        const question = useTurnQuestion ? agent.session.deriveMessages().filter(message => message.role === 'user' && message.source.kind === 'user').at(-1)?.content
          .flatMap(block => block.type === 'text' ? [block.text] : []).join('\n') : undefined
        return { workspaceRoot, sessionId: agent.id, binding: currentBinding(), segmentIds, question }
      }, (projectId, nextBinding) => {
        const previousProject = bindings.session(agent.id)?.projectId
        bindings.bindProject(projectId, workspace.id)
        bindings.bindSession(agent.id, nextBinding)
        if (previousProject !== projectId) bindAgent(agent)
      }, projectId => mutations.publish(projectId, { kind: 'project-updated' }))))
      if (turnContextProvenance) {
        disposers.push(agent.ctx.on('session/event', (session, event) => {
          if (session === agent.session) turnContextProvenance.observe(event)
        }))
      }
      disposers.push(agent.ctx.tools.register(createWorkingCopyTool((toolCallId, rootCallId) => {
        turnContextProvenance?.associateNestedCall(toolCallId, rootCallId)
        modelProvenance.associateNestedCall(toolCallId, rootCallId)
        const current = currentBinding()
        const owned = current && ctx.workspaceRegistry.get(WorkspaceId(current.workspaceId))
        if (!current || current.workspaceId !== binding.workspaceId || !owned || !agent.session.header.cwd || realpathSync(agent.session.header.cwd) !== owned.path) {
          throw new Error('Linguist working copy Session Workspace binding changed')
        }
        return {
          workspaceRoot: owned.path,
          service,
          referenceProjectId: current.projectId, taskGroupId: current.taskGroupId, delegatedSegmentIds: reviewScope(),
          sessionId: agent.id,
          reportOnly: current.reportOnly,
          taskId: agent.session.header.origin === 'subagent' ? agent.session.header.parentSession ?? agent.id : agent.id,
          ...(current.projectId ? { tagProfile: service.getProject(current.projectId).tagProfile } : {}),
          ...(current.projectId && current.workMode === 'cat' ? {
            project: { service, projectId: current.projectId },
            onMutation: event => mutations.publish(current.projectId!, event),
          } : {}),
          get provenance() { return { sessionId: agent.id, toolCallId, runId: `dsh:${agent.id}:${rootCallId}`, ...modelProvenance.forCall(toolCallId), runtime: 'dsh-native' as const, ...(turnContextProvenance?.forCall(toolCallId) ?? {}) } },
        }
      }, async input => {
        await resolveSessionWorkspace(agent.id)
        const current = currentBinding()
        if (input.operation === 'assemble' || input.operation === 'deliver') assertNoOtherWriter(agent.id, { ...current, professionalSource: input.sourcePath })
        if (input.operation === 'references' || current.projectId || current.delegatedScope) return
        const project = await service.createProject({ name: basename(workspace.path), sourceLocale: input.sourceLocale, targetLocale: input.targetLocale })
        bindings.bindProject(project.id, workspace.id)
        bindings.bindSession(agent.id, { ...current, projectId: project.id, ...routeTask(current, { local: 'working-copy' }) })
        // The new project is available to this tool immediately. Rebind the overlay at the next native step.
      })))
      const readSnapshots = binding.projectId ? new SessionReadSnapshots(ctx.sessionQuery, agent.id, binding.projectId, binding.reviewSnapshot) : undefined
      disposers.push(agent.ctx.tools.register(createReviewMaterialsTool(service, async () => {
        const { workspaceRoot } = await resolveSessionWorkspace(agent.id)
        const current = currentBinding()
        return { workspaceRoot, projectId: current.projectId, taskGroupId: current.taskGroupId,
          taskId: agent.session.header.origin === 'subagent' ? agent.session.header.parentSession ?? agent.id : agent.id,
          allowedIds: reviewScope() }
      }, readSnapshots)))
      if (binding.role === 'general') {
        const delegation = createLinguistDelegationTool({
          service, get binding() { return currentBinding() }, agent, subagents: ctx.subagents, control: delegationControl, llm: ctx.llm,
          resolveSessionWorkspace: () => resolveSessionWorkspace(agent.id),
          reserveIntent: (childSessionId, intent) => {
            assertNoOtherWriter(childSessionId, intent)
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
        disposers.push(evidence.bind(sessionId, projectId, ctx.sessionQuery))
        let stage: StageEvidenceState | undefined
        const parentSession = agent.session.header.origin === 'subagent' ? agent.session.header.parentSession : undefined
        let delegatedScope = binding.delegatedScope?.segmentIds
        let parentScopeResolved = delegatedScope !== undefined || parentSession === undefined
        const assertBound = () => {
          const current = currentBinding()
          if (!current || current.projectId !== projectId || current.workspaceId !== workspace.id) throw new Error('Linguist Session project binding changed')
        }
        const refreshStage = (db: ProjectDatabase) => {
          stage = db.stageEvidence.list().find(item => item.sessionId === sessionId)
          if (!parentScopeResolved) {
            const plan = db.stageEvidence.list().find(item => item.sessionId === parentSession)?.plan
            if (plan) delegatedScope = plan.taskGroupId === (binding.taskGroupId ?? 'ungrouped') || (!plan.taskGroupId && !binding.taskGroupId) ? plan.segmentIds : []
            parentScopeResolved = true
          }
        }
        const resolveStage = () => {
          assertBound()
          const db = service.openProject(projectId)
          refreshStage(db)
          return { db, delegatedScope }
        }
        reviewScope = () => resolveStage().delegatedScope
        const attachedFiles = () => {
          const images = new Map<string, ContextImageMetadata>()
          const paths = agent.session.deriveMessages().flatMap(message => {
            if (message.role !== 'user' || message.source.kind !== 'user') return []
            return message.content.flatMap(block => {
              if (block.type !== 'file' && block.type !== 'image') return []
              const path = block.type === 'file'
                ? ctx.attachments.fileHostPath(block.attachment)
                : ctx.attachments.imageHostPath(block.attachment)
              if (path === undefined) throw new Error('DSH Session attachment has no readable host file')
              if (block.type === 'image') images.set(realpathSync(path), {
                filename: block.attachment.name, mediaType: block.attachment.mediaType,
              })
              return [path]
            })
          })
          return { paths, images }
        }
        const scope = () => {
          const files = attachedFiles()
          return projectDiscoveryScope(service, projectId, workspace.id, workspace.path, files.paths, files.images)
        }
        const prepareStage = (segmentIds: readonly string[], task?: { scope?: 'segments' | 'assets' | 'project'; restart?: boolean; toolCallId: string }) => {
          const { db, delegatedScope } = resolveStage()
          if (binding.role === 'general' || db.readOnly) return
          const segments = db.segments.getByIds(segmentIds)
          if (segments.length !== new Set(segmentIds).size) throw new Error('Stage task contains missing segments')
          if (delegatedScope && segmentIds.some(id => !delegatedScope.includes(id))) throw new Error('Delegated work is outside the parent Stage scope')
          if (!task && stage && segmentIds.some(id => !stage!.plan.segmentIds.includes(id))) throw new Error('Write is outside frozen Stage scope')
          const taskGroupId = db.taskGroups.forAssets(segments.map(row => row.assetId), bindings.session(sessionId)?.taskGroupId)
          if (delegatedScope && binding.taskGroupId && taskGroupId !== binding.taskGroupId) throw new Error('委派批次的任务组已变化，请重新确定范围')
          const selected = task?.scope === 'project'
            ? delegatedScope ?? db.segments.queryIds({ taskGroupId: taskGroupId ?? 'ungrouped' })
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
          professional,
          service, projectId, sessionId, taskId: parentSession ?? sessionId, readSnapshots: readSnapshots!, role: binding.role, sessionCwd: workspace.path,
          get taskGroupId() { return currentBinding().taskGroupId },
          attachments: ctx.attachments, assertBound,
          onProjectResolved: refreshStage,
          authorizeReadPath: path => authorizeWorkspaceRead(path, workspace.path, attachedFiles().paths),
          contextImages: () => attachedFiles().images,
          authorizeWritePath: (path, overwrite) => authorizeWorkspaceWrite(path, workspace.path, overwrite),
          discoveryScope: async () => scope(),
          onMutation: mutation => { mutations.publish(projectId, mutation) },
          prepareStage,
          prepareContextDoc: () => {
            const { db } = resolveStage()
            if (!stage || db.readOnly) return
            stage = ensureStageEvidenceForSession({
              session: { id: sessionId, linguistRole: binding.role }, db,
              discoveryScope: scope(), fallbackSegmentIds: stage.plan.segmentIds,
            })
          },
          onEvidencePrepared: (receipt) => evidence.prepare(projectId, receipt),
          generationProvenance: toolCallId => ({ sessionId, toolCallId, runId: `dsh:${sessionId}:${toolCallId}`, ...modelProvenance.forCall(toolCallId), runtime: 'dsh-native', ...(turnContextProvenance?.forCall(toolCallId) ?? {}) }),
          stageEvidenceRunId: () => { resolveStage(); return stage?.stageRunId },
          reviewScopeSegmentIds: () => { resolveStage(); return stage?.plan.segmentIds },
          delegatedScopeSegmentIds: () => resolveStage().delegatedScope,
          ...(agent.options.model === undefined ? {} : { modelId: agent.options.model }),
        })
        for (const source of createLinguistCatTools(deps)) {
          disposers.push(agent.ctx.tools.register(adaptCatTool(source, ctx.attachments,
            (callId, content) => evidence.presented(sessionId, callId, content),
            (callId, rootCallId, args) => {
              turnContextProvenance?.associateNestedCall(callId, rootCallId)
              modelProvenance.associateNestedCall(callId, rootCallId)
              if (/^cat_(?:apply_translations|confirm_segments|accept_proposals|propose_translations|create_consistency_proposals|export_batch)$/.test(source.name)) {
                const current = currentBinding()
                if (current.reportOnly) throw new Error('当前任务只报告问题，不能写入译文、确认阶段或生成译稿交付')
                const ids = new Set((Array.isArray(args.edits) ? args.edits : []).map(edit => (edit as { segmentId?: string }).segmentId).filter((id): id is string => typeof id === 'string'))
                for (const field of ['segmentIds', 'reviewedSegmentIds']) if (Array.isArray(args[field])) for (const id of args[field] as string[]) ids.add(id)
                assertNoOtherWriter(sessionId, ids.size ? { ...current, delegatedScope: { assetIds: [], segmentIds: [...ids] } } : current)
              }
            },
            (toolCallId, update) => {
              const progress = (update.details as CatWorkerJobProgress | undefined)?.jobProgress
              if (progress) {
                const { jobId, ...job } = progress
                mutations.publish(projectId, { kind: 'job-updated', sessionId, toolCallId, jobId, job })
              }
            }, readSnapshots, () => bindings.session(sessionId)?.delegatedScope?.segmentIds,
          )))
        }
      }
      registered.set(agent.id, () => { for (const dispose of disposers.reverse()) dispose() })
    } catch (error) {
      for (const dispose of disposers.reverse()) dispose()
      throw error
    }
  }

  const initializeLinguistSession = (agent: Agent): void => {
    if (bindings.session(agent.id)) return
    const role = presetRole(ctx.agentPresets.composedPreset(agent.ctx))
    if (role === undefined) return
    // A detached, already-started session keeps its historical evidence without reactivation.
    if (agent.session.ownEvents().some(event => event.type === 'user/message')) return
    const cwd = agent.session.header.cwd
    const workspace = cwd && ctx.workspaceRegistry.list().find(item => item.path === realpathSync(cwd))
    if (!workspace) throw new Error('Linguist mode requires a registered DSH Workspace')
    const projects = service.listProjects().filter(project => bindings.projectWorkspace(project.id) === workspace.id)
    const projectId = projects.length === 1 ? projects[0]!.id : undefined
    bindings.bindSession(agent.id, { workspaceId: workspace.id, role, workMode: projectId ? 'cat' : 'working-copy', ...(projectId ? { projectId } : {}) })
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
        const explicitRole = presetRole(agent.session.header.agentPreset)
        bindings.bindSession(agent.id, intent?.binding ?? (explicitRole ? { ...parent, role: explicitRole } : parent))
        inherited = true
      }
    }
    try { initializeLinguistSession(agent); bindAgent(agent) }
    catch (error) { if (inherited) bindings.restoreSession(agent.id, undefined); throw error }
    return undefined
  })
  ctx.on('agent-preset/selected', (sessionId, preset) => {
    const agent = ctx.agents.get(sessionId)
    if (!agent) return
    const role = presetRole(preset)
    const current = bindings.session(sessionId)
    if (role && current) bindings.bindSession(sessionId, { ...current, role })
    else if (role) initializeLinguistSession(agent)
    else bindings.restoreSession(sessionId, undefined)
    bindAgent(agent)
  })
  ctx.on('agent/disposed', ({ agent }) => { registered.get(agent.id)?.(); registered.delete(agent.id) })
  ctx.on('llm/stream', (options, next) => evidence.stream(options, next))
  for (const agent of ctx.agents.list()) { initializeLinguistSession(agent); bindAgent(agent) }

  const scheduleSessions = new ScheduleSessionRuntime(ctx, bindings, bindAgent)
  const scheduleContext = new ScheduleContextManager(config.dataRoot, ctx.schedule, service, bindings, assertProjectSession,
    async (sessionId: string) => {
      const live = ctx.sessions.get(sessionId as SessionId)
      if (live) return live.ownEvents()
      if (!await ctx.sessionPersistence.stat(sessionId as SessionId)) return undefined
      const handle = await ctx.sessionPersistence.open(sessionId as SessionId, 'read')
      try { return (await handle.read(handle.inheritedEventCount)).events }
      finally { await handle.close() }
    }, scheduleSessions,
    async (sessionId, message) => {
      const resolved = await ctx.sessionController.resolveAgent(sessionId as SessionId)
      if ('error' in resolved) throw resolved.error
      resolved.agent.followup(message)
      if (!await ctx.sessions.flush(resolved.agent.session)) throw new Error('Native DSH Session did not acknowledge manual Schedule delivery')
    }, new ScheduleNotifications(() => config.notificationDestinations.get()))
  ctx.on('session/event', async (session, event) => {
    if (event.type === 'turn/end') {
      await scheduleContext.recordExecutionEnd(session.id, event.data.turn)
      scheduleContext.clearTurn(session.id, event.data.turn)
      if (bindings.session(session.id)?.projectId) await scheduleContext.enforceRunPolicy(session.id)
    }
  })
  ctx.on('agent/pre-step', async ({ agent, messages, turn, step }, next) => {
    scheduleContext.recordAttempts(agent, messages, turn)
    return scheduleContext.onPreStep(agent, await scheduleContext.dispatchDue(agent, await next(), turn, messages), turn, step)
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
    roleText, professional, assertProjectSession,
    resolveWorkspaceRoot: workspaceId => ctx.workspaceRegistry.get(WorkspaceId(workspaceId))?.path,
    getSession: async sessionId => {
      const agent = ctx.agents.get(sessionId as SessionId)
      if (!agent) return undefined
      const current = agent.model.current()
      const saved = bindings.session(sessionId)?.executionProfile
      return { cwd: agent.session.header.cwd,
        execution: current && { provider: current.provider, model: current.model, requestedEffort: current.reasoningEffort,
          ...(saved?.provider === current.provider && saved.model === current.model ? { resolvedEffort: saved.resolvedEffort, source: saved.source } : {}),
          providerEffectiveEffort: null, executionPreset: null } }
    },
  })
  const removeHttp = registerHttpRoutes({
    ctx, service, bindings, files, mutations, installationId: config.installationId,
    rebindAgent: sessionId => { const agent = ctx.agents.get(sessionId as SessionId); if (agent) bindAgent(agent) },
    dispatch: (operation, payload) => SETTINGS_OPERATIONS.includes(operation as typeof SETTINGS_OPERATIONS[number])
      ? settingsOperation(service, operation, payload)
      : INTEGRITY_OPERATIONS.includes(operation as typeof INTEGRITY_OPERATIONS[number])
      ? integrity.dispatch(operation, payload)
      : DIAGNOSTICS_OPERATIONS.includes(operation as typeof DIAGNOSTICS_OPERATIONS[number])
        ? diagnostics.dispatch(operation, payload)
        : dispatchOperation({ operation, payload, service, bindings, workspaceRegistry: ctx.workspaceRegistry, files, mutations, assertProjectSession, resolveSessionWorkspace, turnContextReceipts, scheduleContext, delegationControl, detachSessionBinding,
            sessionCopyHost: { bindings, service, sessionController: ctx.sessionController, sessionQuery: ctx.sessionQuery, sessionPersistence: ctx.sessionPersistence, workspaceRegistry: ctx.workspaceRegistry,
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
