import type { Context } from '@deepseek-ai/cordis'
import type { PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { MainPanelId } from '@deepseek-ai/dsh-client-ui-layout/client'
import { PANEL_ID as PLUGINS_PANEL_ID } from '@deepseek-ai/dsh-client-ui-plugin-manager/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar-right/client'
import type { WorkspaceId } from '@deepseek-ai/dsh-workspace/types'
import type { SessionRequestId } from '@deepseek-ai/dsh-api-session-controller/types'
import { isAbsoluteWorkspacePath, relativizeToCwd, sessionFileAddress } from '@deepseek-ai/dsh-util-workspace-path'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-session/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-client-ui-tool/client'
import type {} from '@deepseek-ai/dsh-api-session-controller/client'
import type {} from '@deepseek-ai/dsh-api-session-controller/remote'
import type {} from '@deepseek-ai/dsh-api-workspace-controller/client'
import type {} from '@deepseek-ai/dsh-client-ui-workspace/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import { createElement, useEffect, useState } from 'react'
import { Button, Menu, Modal, Tooltip, IconGlobeOutlineRegular } from '@deepseek-ai/dsh-client-ui-primitives'
import type { LinguistAssetInfo, LinguistProjectOpenResult, LinguistProjectSummary, LinguistSessionDetachBindingResult, LinguistTurnContextPrepareResult, LinguistTurnContextV1 } from '@linguist/domain-service/contracts'
import { bindSession, getBinding, required, subscribeProject, type LinguistBinding } from './api'
import { CatWorkbench } from './CatWorkbench'
import { clearCatEditorStates } from './cat-editor-state'
import { BatchPreview } from './BatchPreview'
import { NativePreviewContext } from './PreviewView'
import { CatToolResult, catToolNames } from './CatToolResult'
import { ComposerContextChips } from './ComposerContextChips'
import { catReferenceSource, connectCatReference } from './composer-reference'
import { requestCatNavigation, type CatNavigation } from './cat-navigation'
import { ProjectsPage, type Role, type WorkMode } from './ProjectsPage'
import { ProjectCapabilities } from './ProjectCapabilities'
import { SessionCopyPage, type SessionCopyResult } from './SessionCopyPage'
import { WorkingCopyPage } from './WorkingCopyPage'
import { LocaleProvider, registerLinguistLocale, useT } from './ui-locale'
import styles from './Native.module.css'

const PANEL_ID = 'linguist' as MainPanelId
const CAT_KIND = 'linguist-cat'
const CAT_PROVIDER_ID = '@linguist/dsh-client-cat'
const CAT_PREFIX = 'dsh-resource://linguist-cat/'
const BATCH_KIND = 'linguist-batch-preview'
const BATCH_PROVIDER_ID = '@linguist/dsh-client-batch-preview'
const BATCH_PREFIX = 'dsh-resource://linguist-batch-preview/'
const WORKING_KIND = 'linguist-working-copy'
const WORKING_PROVIDER_ID = '@linguist/dsh-client-working-copy'
const COPY_KIND = 'linguist-session-copy'
const COPY_PROVIDER_ID = '@linguist/dsh-client-session-copy'
const DETACH_EVENT = 'linguist:session-detached'

export const inject = ['slots', 'layout', 'sidebarRight', 'sidebarRightTabs', 'sessions', 'uiWorkspace', 'workspaces', 'conversation', 'inputTriggers', 'locale', 'remote', 'remote.skills']

function CatPage(props: PropsRuntime<'sidebar.right.pane.tab'> & { onCancelRun: (sessionId: string) => Promise<void>; onOpenSession: (sessionId: string) => Promise<void>; onSendAgentTask: (sessionId: string, text: string, context: LinguistTurnContextV1) => Promise<void>; onOpenBatchPreview: (sessionId: string, projectId: string, assetId: string) => void; capabilities: React.ReactNode }) {
  const t = useT()
  const info = props.useTabInfo()
  const address = info.tab.navigation.address
  if (!address.startsWith(CAT_PREFIX)) throw new Error(`Unexpected Linguist CAT address: ${address}`)
  const projectId = decodeURIComponent(address.slice(CAT_PREFIX.length))
  const sessionId = String(props.sessionId)
  const [binding, setBinding] = useState<LinguistBinding | undefined>()
  const [error, setError] = useState('')
  useEffect(() => {
    let live = true
    getBinding(sessionId).then((value) => {
      if (!live) return
      if (value?.projectId !== projectId || value.workMode !== 'cat') setError(t('当前 DSH Session 未绑定此 CAT 项目。'))
      else { setBinding(value); setError('') }
    }).catch((cause: unknown) => { if (live) setError(String(cause)) })
    return () => { live = false }
  }, [sessionId, projectId])
  useEffect(() => {
    const onDetached = (event: Event) => {
      if ((event as CustomEvent<string>).detail === sessionId) {
        setBinding(undefined)
        setError(t('当前 DSH Session 已解除 Linguist 绑定。'))
      }
    }
    window.addEventListener(DETACH_EVENT, onDetached)
    return () => window.removeEventListener(DETACH_EVENT, onDetached)
  }, [sessionId])
  if (error) return createElement('p', { role: 'alert', className: styles.error }, error)
  if (!binding) return createElement('p', { role: 'status', className: styles.notice }, t('正在验证 CAT 会话绑定…'))
  return createElement(CatWorkbench, { key: projectId, projectId, sessionId, onCancelRun: () => props.onCancelRun(sessionId), onOpenSession: props.onOpenSession, onSendAgentTask: (text: string, context: LinguistTurnContextV1) => props.onSendAgentTask(sessionId, text, context), onOpenBatchPreview: (assetId: string) => props.onOpenBatchPreview(sessionId, projectId, assetId), capabilities: props.capabilities })
}

function BatchPreviewPage(props: PropsRuntime<'sidebar.right.pane.tab'>) {
  const t = useT()
  const info = props.useTabInfo()
  const address = info.tab.navigation.address
  if (!address.startsWith(BATCH_PREFIX)) throw new Error(`Unexpected Linguist batch address: ${address}`)
  const [encodedProject, encodedAsset] = address.slice(BATCH_PREFIX.length).split('/')
  if (!encodedProject || !encodedAsset) throw new Error(`Invalid Linguist batch address: ${address}`)
  const projectId = decodeURIComponent(encodedProject)
  const assetId = decodeURIComponent(encodedAsset)
  const sessionId = String(props.sessionId)
  const [asset, setAsset] = useState<LinguistAssetInfo>()
  const [error, setError] = useState('')
  useEffect(() => {
    let live = true
    getBinding(sessionId).then((binding) => {
      if (binding?.projectId !== projectId || binding.workMode !== 'cat') throw new Error(t('当前 DSH Session 未绑定此 CAT 项目。'))
      return required<LinguistProjectSummary>('linguistProjectsGetSummary', { projectId })
    }).then((summary) => {
      if (!live) return
      const found = summary.assets.find((item) => item.assetId === assetId)
      if (!found) throw new Error(t('批次已不存在，请刷新项目。'))
      setAsset(found)
      setError('')
    }).catch((cause: unknown) => { if (live) setError(String(cause)) })
    return () => { live = false }
  }, [sessionId, projectId, assetId])
  if (error) return createElement('p', { role: 'alert', className: styles.error }, error)
  if (!asset) return createElement('p', { role: 'status', className: styles.notice }, t('正在读取双语预览…'))
  return createElement(BatchPreview, { projectId, asset, onClose: () => info.tab.actions.close() })
}

function SessionBadge({ sessionId, openCat, openWorkingCopy, openBrowser, openCopy, openRoleSession, onNewTask }: { sessionId: string; openCat: (sessionId: string, projectId: string) => void; openWorkingCopy: (sessionId: string) => void; openBrowser: (sessionId: string) => void; openCopy: (sessionId: string) => void; openRoleSession: (binding: LinguistBinding, role: Role) => Promise<void>; onNewTask: (binding: LinguistBinding, kind: 'general' | 'continue') => Promise<void> }) {
  const t = useT()
  const [binding, setBinding] = useState<LinguistBinding | undefined>()
  const [projectName, setProjectName] = useState('')
  const [projectError, setProjectError] = useState('')
  const [actionError, setActionError] = useState('')
  const [roleBusy, setRoleBusy] = useState(false)
  const [detachOpen, setDetachOpen] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)
  const [detachBusy, setDetachBusy] = useState(false)
  const [detached, setDetached] = useState<LinguistSessionDetachBindingResult>()
  const [error, setError] = useState('')
  useEffect(() => {
    let live = true
    getBinding(sessionId).then((value) => { if (live) setBinding(value) }).catch((cause: unknown) => { if (live) setError(String(cause)) })
    return () => { live = false }
  }, [sessionId])
  useEffect(() => {
    if (!binding?.projectId) return
    let live = true
    let request = 0
    const refreshName = () => {
      const current = ++request
      required<LinguistProjectSummary>('linguistProjectsGetSummary', { projectId: binding.projectId })
        .then((summary) => { if (live && current === request) { setProjectName(summary.project.name); setProjectError('') } })
        .catch((cause: unknown) => { if (live && current === request) setProjectError(String(cause)) })
    }
    refreshName()
    const unsubscribe = subscribeProject(binding.projectId, 0, (event) => { if (event.kind === 'project-updated') refreshName() }, refreshName)
    return () => { live = false; unsubscribe() }
  }, [binding?.projectId])
  if (error) return createElement('span', { className: styles.error, title: error }, t('Linguist 绑定读取失败'))
  if (!binding) return detached ? createElement('span', { className: styles.badge, role: 'status' }, t('Linguist 绑定已解除；历史 CAT 证据保留。'), detached.cancelledScheduleIds.length ? ` ${t('已取消专用定时任务 {count} 项。', { count: detached.cancelledScheduleIds.length })}` : '') : null
  const roleLabel = t({ general: '通用', translator: '译者', reviewer: '审校', proofreader: '校对' }[binding.role])
  const changeRole = async (role: Role) => {
    if (role === binding.role || roleBusy) return
    setRoleBusy(true)
    try { await openRoleSession(binding, role); setActionError('') }
    catch (cause) { setActionError(String(cause)) }
    finally { setRoleBusy(false) }
  }
  const newTask = async (kind: 'general' | 'continue') => {
    if (roleBusy) return
    setRoleBusy(true)
    try { await onNewTask(binding, kind); setActionError('') }
    catch (cause) { setActionError(String(cause)) }
    finally { setRoleBusy(false) }
  }
  const detach = async () => {
    if (detachBusy) return
    setDetachBusy(true)
    try {
      const result = await required<LinguistSessionDetachBindingResult>('linguistSessionsDetachBinding', { sessionId })
      setDetached(result)
      setBinding(undefined)
      setActionError('')
      window.dispatchEvent(new CustomEvent(DETACH_EVENT, { detail: sessionId }))
    } catch (cause) { setActionError(String(cause)) }
    finally { setDetachBusy(false) }
  }
  const identity = `${roleLabel} · ${t({ cat: 'CAT', 'working-copy': '工作副本', browser: '浏览器' }[binding.workMode])}${binding.projectId ? ` · ${projectName || binding.projectId.slice(0, 12)}` : ''}`
  return createElement('span', { className: styles.badge },
    createElement(Tooltip, { label: identity, portal: true, side: 'bottom', children: createElement<React.HTMLAttributes<HTMLSpanElement>>('span', { className: styles.identity, tabIndex: 0 }, identity) }),
    binding.projectId && binding.workMode === 'cat'
      ? createElement(Button, { size: 'sm', variant: 'outline', onClick: () => openCat(sessionId, binding.projectId!), 'aria-label': t('打开 Linguist CAT 工作台') }, t('打开 CAT'))
      : null,
    binding.workMode === 'working-copy' ? createElement(Button, { size: 'sm', variant: 'outline', onClick: () => { try { openWorkingCopy(sessionId); setActionError('') } catch (cause) { setActionError(String(cause)) } } }, t('打开工作副本')) : null,
    binding.workMode === 'browser' ? createElement(Button, { size: 'sm', variant: 'outline', onClick: () => { try { openBrowser(sessionId); setActionError('') } catch (cause) { setActionError(String(cause)) } } }, t('打开浏览器')) : null,
    createElement(Menu, {
      open: menuOpen, portal: true, align: 'end', autoFocus: true,
      anchor: createElement(Button, { size: 'sm', variant: 'ghost', 'aria-label': t('Linguist 操作'), 'aria-expanded': menuOpen, onClick: () => setMenuOpen(!menuOpen) }, '···'),
      items: [
        ...(binding.projectId && binding.workMode === 'cat' ? [{ id: 'new-general', label: t('新建项目通用会话'), disabled: roleBusy }] : []),
        ...(binding.projectId ? [{ id: 'continue', label: t('继续新任务'), disabled: roleBusy }] : []),
        ...(binding.projectId ? [{ id: 'copy', label: t('复制到项目') }] : []),
        { id: 'role', label: t('开启新岗位会话'), disabled: roleBusy, submenu: (['general', 'translator', 'reviewer', 'proofreader'] as const).map(role => ({ id: `role:${role}`, label: t({ general: '通用', translator: '译者', reviewer: '审校', proofreader: '校对' }[role]), disabled: role === binding.role })) },
        { type: 'separator', id: 'detach-separator' },
        { id: 'detach', label: t('解除 Linguist 绑定'), danger: true },
      ],
      onClose: () => setMenuOpen(false),
      onSelect: id => { setMenuOpen(false); if (id === 'new-general') void newTask('general'); else if (id === 'continue') void newTask('continue'); else if (id === 'copy') openCopy(sessionId); else if (id === 'detach') setDetachOpen(true); else if (id.startsWith('role:')) void changeRole(id.slice(5) as Role) },
    }),
    createElement(Modal, { open: detachOpen, onClose: () => setDetachOpen(false), title: t('解除 Linguist 绑定'), closeLabel: t('关闭'),
      description: t('解除后此 Session 成为普通 Agent，会取消活跃的 Linguist 专用定时任务；历史专业证据保留。'),
      footer: createElement('div', { className: styles.actions },
        createElement(Button, { variant: 'ghost', size: 'sm', disabled: detachBusy, onClick: () => setDetachOpen(false) }, t('取消')),
        createElement(Button, { variant: 'primary', size: 'sm', disabled: detachBusy, onClick: () => void detach() }, t('确认解除'))),
    }, actionError ? createElement('p', { className: styles.error, role: 'alert' }, actionError) : null),
    projectError ? createElement(Tooltip, { label: projectError, portal: true, children: createElement<React.HTMLAttributes<HTMLSpanElement>>('span', { className: styles.error, tabIndex: 0 }, t('项目名称读取失败')) }) : null,
    actionError && !detachOpen ? createElement('span', { className: styles.error, role: 'alert' }, actionError) : null,
  )
}

export function apply(ctx: Context): void {
  ctx.effect(() => clearCatEditorStates, 'linguist: CAT editor drafts')
  ctx.effect(() => registerLinguistLocale(ctx.locale), 'linguist: locale dictionaries')
  ctx.effect(() => ctx.inputTriggers.registerSource(catReferenceSource), 'linguist: CAT selection reference')
  const connectReference = (sessionId: string, changed: Parameters<typeof connectCatReference>[2]) => connectCatReference(ctx, sessionId, changed)
  const t = ctx.locale.bind('linguist')
  const pickDirectory = async (workspaceId: string) => {
    const workspace = ctx.workspaces.list.getSnapshot().items.find((item) => item.workspaceId === workspaceId)
    if (!workspace) throw new Error(t('请选择工作区，或先为项目建立关联。'))
    const selected = await ctx.uiWorkspace.pickDirectory()
    if (selected === null) return null
    const relative = selected === workspace.path ? '.' : relativizeToCwd(selected, workspace.path)
    if (isAbsoluteWorkspacePath(relative)) throw new Error(t('请选择当前 Workspace 内的目录'))
    return relative
  }
  const cancelRun = async (sessionId: string) => {
    const scope = ctx.sessions.scope(sessionId as Parameters<typeof ctx.sessions.scope>[0])
    const session = scope && ctx.sessions.sessionOf(scope)
    if (!session) throw new Error(t('当前 DSH Session 尚未就绪'))
    const result = await session.cancel()
    if (!result.ok) throw new Error(result.error.message)
  }
  const openCat = (sessionId: string, projectId: string) => {
    ctx.sidebarRight.openResourceIn(sessionId as Parameters<typeof ctx.sidebarRight.openResourceIn>[0], `${CAT_PREFIX}${encodeURIComponent(projectId)}`, { kind: CAT_KIND })
  }
  const openBatchPreview = (sessionId: string, projectId: string, assetId: string) => {
    ctx.sidebarRight.openResourceIn(sessionId as Parameters<typeof ctx.sidebarRight.openResourceIn>[0], `${BATCH_PREFIX}${encodeURIComponent(projectId)}/${encodeURIComponent(assetId)}`, { kind: BATCH_KIND })
  }
  const navigateToToolResult = async (location: CatNavigation) => {
    const binding = await getBinding(location.sessionId)
    if (binding?.projectId !== location.projectId || binding.workMode !== 'cat') throw new Error(t('此工具结果与当前 CAT 会话绑定不一致'))
    requestCatNavigation(location)
    openCat(location.sessionId, location.projectId)
  }
  const openWorkingFile = (sessionId: string, path: string) => {
    ctx.sidebarRight.openResourceIn(sessionId as Parameters<typeof ctx.sidebarRight.openResourceIn>[0], sessionFileAddress(sessionId, path))
  }
  const nativePreview = (sessionId: string, children: React.ReactNode) => createElement(NativePreviewContext.Provider, { value: (path: string) => ctx.sidebarRight.openResourceIn(sessionId as Parameters<typeof ctx.sidebarRight.openResourceIn>[0], sessionFileAddress(sessionId, path), { kind: 'text' }) }, children)
  const openWorkingCopy = (sessionId: string) => ctx.sidebarRight.openTabIn(sessionId as Parameters<typeof ctx.sidebarRight.openTabIn>[0], WORKING_KIND)
  const openFiles = (sessionId: string) => ctx.sidebarRight.openTabIn(sessionId as Parameters<typeof ctx.sidebarRight.openTabIn>[0], 'files')
  const loadSkills = async (sessionId: string, signal: AbortSignal) => {
    const result = await ctx.remote.skills.list({ sessionId: sessionId as Parameters<typeof ctx.remote.skills.list>[0]['sessionId'] }, signal)
    if (!result.ok) throw new Error(result.error.message)
    return result.value
  }
  const capabilities = (sessionId?: string) => createElement(ProjectCapabilities, { sessionId, loadSkills,
    onOpenPlugins: () => ctx.layout.selectPanel(PLUGINS_PANEL_ID),
    ...(sessionId ? { onOpenFile: (path: string) => openWorkingFile(sessionId, path), onOpenFiles: () => openFiles(sessionId) } : {}),
  })
  const openCopy = (sessionId: string) => ctx.sidebarRight.openTabIn(sessionId as Parameters<typeof ctx.sidebarRight.openTabIn>[0], COPY_KIND)
  const openBrowser = (sessionId: string) => {
    if (ctx.sidebarRightTabs.get('browserskill-observation') === undefined) throw new Error(t('BrowserSkill 观察面板未安装或未加载'))
    ctx.sidebarRight.openTabIn(sessionId as Parameters<typeof ctx.sidebarRight.openTabIn>[0], 'browserskill-observation')
  }
  const pendingAgentTasks = new Map<string, { text: string; scope: string; requestId: SessionRequestId }>()
  const sendAgentTask = async (sessionId: string, prompt: string, context: LinguistTurnContextV1) => {
    const id = sessionId as Parameters<typeof ctx.sessions.scope>[0]
    const scope = ctx.sessions.scope(id)
    if (!scope) throw new Error(t('当前 DSH Session 尚未就绪'))
    const session = ctx.sessions.sessionOf(scope)
    if (!session) throw new Error(t('当前 DSH Session 尚未就绪'))
    const scopeKey = JSON.stringify([context.projectId, context.assetId, context.activeSegmentId, context.selectedSegmentIds, context.activeQaFindingId])
    let pending = pendingAgentTasks.get(sessionId)
    if (pending && (pending.text !== prompt || pending.scope !== scopeKey)) {
      throw new Error(t('上次 Agent 请求的发送状态未明；请恢复原选区并重试同一任务。'))
    }
    if (!pending) {
      const handle = session.beginSubmission({ mode: 'queue', text: prompt, attachments: [] })
      try {
        const prepared = await required<LinguistTurnContextPrepareResult>('linguistTurnContextPrepare', { sessionId, requestId: handle.requestId, turnContext: context })
        if (prepared.requestId !== handle.requestId || prepared.selectionTruncated) throw new Error(t('Agent 任务范围校验失败，未发送请求。'))
      } catch (error) { handle.abandon(); throw error }
      pending = { text: prompt, scope: scopeKey, requestId: handle.requestId }
      pendingAgentTasks.set(sessionId, pending)
    }
    let result
    try { result = await session.prompt([{ type: 'text', text: prompt }], 'queue', undefined, pending.requestId) }
    catch { result = await session.prompt([{ type: 'text', text: prompt }], 'queue', undefined, pending.requestId) }
    if (!result.ok) { pendingAgentTasks.delete(sessionId); throw new Error(result.error.message) }
    pendingAgentTasks.delete(sessionId)
    ctx.uiWorkspace.openSession(id)
  }
  const openBoundSession = async (binding: LinguistBinding, revealWorkbench = false) => {
    const id = binding.sessionId as Parameters<typeof ctx.uiWorkspace.openSession>[0]
    ctx.layout.selectPanel(null)
    ctx.uiWorkspace.openSession(id)
    if (!revealWorkbench) return
    const navigation = ctx.layout.beginNavigation()
    await new Promise<void>((resolve, reject) => {
      if (ctx.sidebarRight.mounted.getSnapshot() === id) { resolve(); return }
      let timer: ReturnType<typeof setTimeout>
      const unsubscribe = ctx.sidebarRight.mounted.subscribe(() => {
        if (ctx.sidebarRight.mounted.getSnapshot() === id) { cleanup(); resolve() }
      })
      const cancel = () => { cleanup(); resolve() }
      const cleanup = () => { clearTimeout(timer); unsubscribe(); navigation.removeEventListener('abort', cancel) }
      navigation.addEventListener('abort', cancel, { once: true })
      timer = setTimeout(() => { cleanup(); reject(new Error(t('会话已建立，但右侧工作台尚未就绪'))) }, 15000)
    })
    if (navigation.aborted) return
    if (binding.workMode === 'cat' && binding.projectId) openCat(binding.sessionId, binding.projectId)
    if (binding.workMode === 'working-copy') openWorkingCopy(binding.sessionId)
    if (binding.workMode === 'browser') openBrowser(binding.sessionId)
  }
  const enter = async (input: { projectId?: string; workspaceId: WorkspaceId; role: Role; workMode: WorkMode }, navigation = ctx.layout.beginNavigation()) => {
    const id = await ctx.sessions.create({ workspaceId: input.workspaceId })
    const binding = await bindSession({ sessionId: String(id), projectId: input.projectId, role: input.role, workMode: input.workMode }, String(input.workspaceId))
    if (!navigation.aborted) await openBoundSession(binding, true)
  }
  const newProjectTask = async (binding: LinguistBinding, kind: 'general' | 'continue') => {
    const navigation = ctx.layout.beginNavigation()
    const current = await getBinding(binding.sessionId)
    if (navigation.aborted) return
    if (!current?.projectId || current.projectId !== binding.projectId || current.workspaceId !== binding.workspaceId || current.role !== binding.role || current.workMode !== binding.workMode || (kind === 'general' && current.workMode !== 'cat')) throw new Error(t('当前会话绑定已变化，请刷新后重试。'))
    const opened = await required<LinguistProjectOpenResult>('linguistProjectsOpen', { projectId: current.projectId })
    if (navigation.aborted) return
    if (opened.project.id !== current.projectId || opened.health.projectId !== current.projectId) throw new Error(t('项目身份校验失败'))
    if (opened.project.archivedAt !== undefined) throw new Error(t('已归档，只读'))
    if (!opened.health.healthy) throw new Error(t('需要修复'))
    await enter({ projectId: current.projectId, workspaceId: current.workspaceId as WorkspaceId, role: kind === 'general' ? 'general' : current.role, workMode: current.workMode }, navigation)
  }
  const visitedSessions: Parameters<typeof ctx.sessions.scope>[0][] = []
  ctx.effect(() => {
    const remember = () => {
      const id = ctx.sidebarRight.mounted.getSnapshot()
      if (id === undefined) return
      const previous = visitedSessions.indexOf(id)
      if (previous !== -1) visitedSessions.splice(previous, 1)
      visitedSessions.unshift(id)
    }
    remember()
    return ctx.sidebarRight.mounted.subscribe(remember)
  }, 'linguist: project Session visits')
  const pendingProjectSessions = new Map<string, Promise<LinguistBinding>>()
  const openProject = async (projectId: string, dock?: 'qa' | 'proposals') => {
    const navigation = ctx.layout.beginNavigation()
    const opened = await required<LinguistProjectOpenResult & { project: { workspaceId?: string } }>('linguistProjectsOpen', { projectId })
    if (navigation.aborted) return
    if (opened.project.id !== projectId || opened.health.projectId !== projectId) throw new Error(t('项目身份校验失败'))
    if (!opened.health.healthy) throw new Error(t('需要修复'))
    const workspace = ctx.workspaces.list.getSnapshot().items.find(item => item.workspaceId === opened.project.workspaceId)
    if (!workspace) throw new Error(t('请选择工作区，或先为项目建立关联。'))
    let pending = pendingProjectSessions.get(projectId)
    if (!pending) {
      pending = (async () => {
        await ctx.sessions.refresh()
        const snapshot = ctx.sessions.list.getSnapshot()
        const candidates = [...new Set([
          ...visitedSessions,
          ...[...snapshot.ids].sort((left, right) => snapshot.byId[right]!.updatedAt - snapshot.byId[left]!.updatedAt),
        ])]
        for (const id of candidates) {
          if (!snapshot.ids.includes(id)) continue
          const row = snapshot.byId[id]!
          if (row.cwd !== workspace.path || row.parentId !== undefined || row.origin === 'subagent') continue
          const binding = await getBinding(id)
          if (binding?.projectId === projectId && binding.workspaceId === workspace.workspaceId && binding.workMode === 'cat') return binding
        }
        const id = await ctx.sessions.create({ workspaceId: workspace.workspaceId })
        return bindSession({ sessionId: String(id), projectId, role: 'general', workMode: 'cat' }, String(workspace.workspaceId))
      })().finally(() => pendingProjectSessions.delete(projectId))
      pendingProjectSessions.set(projectId, pending)
    }
    const binding = await pending
    if (!navigation.aborted) {
      if (dock) requestCatNavigation({ sessionId: binding.sessionId, projectId, dock })
      await openBoundSession(binding, true)
    }
  }
  const openExecutionSession = async (sessionId: string) => {
    await ctx.sessions.refresh()
    const id = sessionId as Parameters<typeof ctx.uiWorkspace.openSession>[0]
    if (!ctx.sessions.list.getSnapshot().ids.includes(id)) throw new Error(t('执行会话已不存在或已归档。'))
    const binding = await getBinding(sessionId)
    if (binding) await openBoundSession(binding)
    else { ctx.layout.selectPanel(null); ctx.uiWorkspace.openSession(id) }
  }
  ctx.slots.inject('main', () => ctx.slots.register({ name: 'main', key: PANEL_ID }, () => createElement(LocaleProvider, { locale: ctx.locale }, createElement(ProjectsPage, { workspaces: ctx.workspaces, sessions: ctx.sessions, onEnter: enter, onOpenProject: openProject, onOpenSession: openBoundSession, onPickDirectory: pickDirectory, capabilities: capabilities() }))))
  ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({ name: 'sidebar.panellist', id: PANEL_ID, order: 12, label: () => 'Linguist' }, ({ size }) => createElement(IconGlobeOutlineRegular, { size })))
  ctx.effect(() => ctx.sidebarRightTabs.register({ id: CAT_PROVIDER_ID, kind: CAT_KIND, patterns: [`${CAT_PREFIX}**`], priority: 'extension', keepMounted: true, title: () => 'Linguist CAT' }), 'linguist: CAT page')
  ctx.slots.inject('sidebar.right.pane.tab', () => ctx.slots.register({ name: 'sidebar.right.pane.tab', key: CAT_PROVIDER_ID }, (props) => createElement(LocaleProvider, { locale: ctx.locale }, nativePreview(String(props.sessionId), createElement(CatPage, { ...props, onCancelRun: cancelRun, onOpenSession: openExecutionSession, onSendAgentTask: sendAgentTask, onOpenBatchPreview: openBatchPreview, capabilities: capabilities(String(props.sessionId)) })))))
  ctx.effect(() => ctx.sidebarRightTabs.register({ id: BATCH_PROVIDER_ID, kind: BATCH_KIND, patterns: [`${BATCH_PREFIX}**`], priority: 'extension', keepMounted: true, title: () => t('批次语义预览') }), 'linguist: batch preview')
  ctx.slots.inject('sidebar.right.pane.tab', () => ctx.slots.register({ name: 'sidebar.right.pane.tab', key: BATCH_PROVIDER_ID }, (props) => createElement(LocaleProvider, { locale: ctx.locale }, nativePreview(String(props.sessionId), createElement(BatchPreviewPage, props)))))
  ctx.effect(() => ctx.sidebarRightTabs.register({ id: WORKING_PROVIDER_ID, kind: WORKING_KIND, priority: 'extension', keepMounted: true, title: () => t('Linguist 工作副本') }), 'linguist: working-copy page')
  ctx.slots.inject('sidebar.right.pane.tab', () => ctx.slots.register({ name: 'sidebar.right.pane.tab', key: WORKING_PROVIDER_ID }, (props) => createElement(LocaleProvider, { locale: ctx.locale }, createElement(WorkingCopyPage, { sessionId: String(props.sessionId), onOpenFile: (path: string) => openWorkingFile(String(props.sessionId), path) }))))
  ctx.effect(() => ctx.sidebarRightTabs.register({ id: COPY_PROVIDER_ID, kind: COPY_KIND, priority: 'extension', keepMounted: true, title: () => t('复制 Linguist 会话') }), 'linguist: session-copy page')
  ctx.slots.inject('sidebar.right.pane.tab', () => ctx.slots.register({ name: 'sidebar.right.pane.tab', key: COPY_PROVIDER_ID }, (props) => createElement(LocaleProvider, { locale: ctx.locale }, createElement(SessionCopyPage, { sessionId: String(props.sessionId), onCopied: (copy: SessionCopyResult) => openBoundSession(copy, true) }))))
  ctx.slots.inject('conversation.session.header.utilities', () => ctx.slots.register({ name: 'conversation.session.header.utilities', id: 'linguist-binding', order: 5 }, (props) => createElement(LocaleProvider, { locale: ctx.locale }, createElement(SessionBadge, { sessionId: String(props.sessionId), openCat, openWorkingCopy, openBrowser, openCopy, onNewTask: newProjectTask, openRoleSession: (binding: LinguistBinding, role: Role) => enter({ projectId: binding.projectId, workspaceId: binding.workspaceId as WorkspaceId, role, workMode: binding.workMode }) }))))
  ctx.slots.inject('conversation.input.dock', () => ctx.slots.register({ name: 'conversation.input.dock', id: 'linguist-context', order: 5 }, (props) => createElement(LocaleProvider, { locale: ctx.locale }, createElement(ComposerContextChips, { sessionId: String(props.sessionId), connect: connectReference, inputActions: props.inputActions }))))
  ctx.slots.inject('tool.call.toolview', function* () {
    for (const toolName of catToolNames) yield ctx.slots.register({ name: 'tool.call.toolview', key: toolName }, (props) => createElement(LocaleProvider, { locale: ctx.locale }, createElement(CatToolResult, { props, onNavigate: navigateToToolResult })))
  })
}
