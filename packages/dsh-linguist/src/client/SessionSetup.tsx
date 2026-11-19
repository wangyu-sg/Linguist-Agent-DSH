import * as React from 'react'
import type { PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { SessionSnapshot } from '@deepseek-ai/dsh-api-session-controller/client'
import type {} from '@deepseek-ai/dsh-agent-preset-registry/types'
import { Button, Menu, IconAgentPresetOutlineRegular, IconChevronDownOutlineRegular } from '@deepseek-ai/dsh-client-ui-primitives'
import type { LinguistProjectInfo, LinguistRetrievalProgress } from '@linguist/domain-service/contracts'
import { BINDING_CHANGED_EVENT, bindSession, required, type LinguistBinding } from './api'
import { useBinding } from './use-binding'
import { SemanticProgressLine } from './LibraryPreparation'
import { useT } from './ui-locale'
import styles from './Native.module.css'

type Project = LinguistProjectInfo & { workspaceId?: string }
const roles = [
  ['general', '通用', '统筹任务、整理资料并委派专业岗位。'],
  ['translator', '译者', '从原文开始翻译，查术语、核实文化背景。'],
  ['reviewer', '审校', '独立对照原文和当前译文，检查准确性与表达。'],
  ['proofreader', '校对', '检查最终文本、标点和格式，保留审校判断。'],
] as const

export function SessionSetup(props: PropsRuntime<'conversation.input.dock'> & {
  onEnter: (binding: LinguistBinding) => Promise<void>
  onOpenProject: (projectId: string) => void
}) {
  const preset = props.useProjection('agentPreset')
  return preset === 'linguist' ? <LinguistSessionSetup {...props} /> : null
}

function RetrievalProgress({ projectId, taskGroupId }: { projectId: string; taskGroupId: string }) {
  const t = useT()
  const [jobs, setJobs] = React.useState<LinguistRetrievalProgress[]>([])
  const [error, setError] = React.useState('')
  React.useEffect(() => {
    let live = true
    let timer: ReturnType<typeof setTimeout>
    async function refresh() {
      try {
        const active = await required<LinguistRetrievalProgress[]>('linguistRetrievalProgress', { projectId, taskGroupId })
        if (live) { setJobs(active); setError('') }
      } catch (cause) {
        if (live) { setJobs([]); setError(String(cause)) }
      } finally {
        if (live) timer = setTimeout(refresh, 4000)
      }
    }
    void refresh()
    return () => { live = false; clearTimeout(timer) }
  }, [projectId, taskGroupId])
  if (error) return <span className={styles.contextError} role="status">{t('暂时无法读取检索进度')} · {error}</span>
  return <>{jobs.map(({ kind, progress }, index) =>
    <SemanticProgressLine key={kind + index} scope={t(kind === 'materials' ? '本组背景资料' : '本组相关句段')} progress={progress} />)}</>
}

function LinguistSessionSetup({ sessionId, useSession, onEnter, onOpenProject }: PropsRuntime<'conversation.input.dock'> & {
  onEnter: (binding: LinguistBinding) => Promise<void>
  onOpenProject: (projectId: string) => void
}) {
  const t = useT()
  const blank = useSession((state: SessionSnapshot) => state.blank && !state.promptAttempted && !state.running)
  const running = useSession((state: SessionSnapshot) => state.running)
  const { binding, error: bindingError, loading } = useBinding(sessionId)
  const [projects, setProjects] = React.useState<Project[]>([])
  const [menu, setMenu] = React.useState<'role' | 'project' | 'workMode'>()
  const [busy, setBusy] = React.useState(false)
  const [error, setError] = React.useState('')
  React.useEffect(() => {
    let live = true
    required<Project[]>('linguistProjectsList', {}).then(value => { if (live) setProjects(value) }).catch(cause => { if (live) setError(String(cause)) })
    return () => { live = false }
  }, [])
  if (bindingError) return <p className={styles.setupError} role="alert">{bindingError}</p>
  if (!binding) return loading ? <p className={styles.setupHint} role="status">{t('正在读取 Linguist 岗位…')}</p> : null
  const availableProjects = projects.filter(project => project.workspaceId === binding.workspaceId)
  const change = async (changes: Partial<Pick<LinguistBinding, 'role' | 'projectId' | 'workMode' | 'workModeDecision'>>) => {
    setMenu(undefined); setBusy(true); setError('')
    try {
      const next = { ...binding, ...changes }
      if (next.projectId !== binding.projectId) delete next.taskGroupId
      if (blank) {
        await bindSession(next, binding.workspaceId)
        window.dispatchEvent(new CustomEvent(BINDING_CHANGED_EVENT, { detail: sessionId }))
      }
      else await onEnter(next)
    } catch (cause) { setError(String(cause)) }
    finally { setBusy(false) }
  }
  const anchor = (id: typeof menu, label: string, disabled = false) => <Button variant="ghost" size="sm" className={styles.presetButton} disabled={busy || disabled} aria-haspopup="menu" aria-expanded={menu === id} onClick={() => setMenu(menu === id ? undefined : id)}>
    {id === 'role' && <IconAgentPresetOutlineRegular size={16} />}<span>{label}</span><IconChevronDownOutlineRegular size={14} />
  </Button>
  return <div className={styles.sessionSetup} role="group" aria-label={t('Linguist 岗位与项目')}>
    <Menu open={menu === 'role'} onClose={() => setMenu(undefined)} portal align="start" selectedId={binding.role} anchor={anchor('role', t(roles.find(role => role[0] === binding.role)![1]))} items={roles.map(([id, name, description]) => ({ id, label: <span className={styles.presetItem}><span>{t(name)}</span><small>{t(description)}</small></span> }))} onSelect={role => { if (role !== binding.role) void change({ role: role as LinguistBinding['role'] }); else setMenu(undefined) }} />
    <Menu open={menu === 'workMode'} onClose={() => setMenu(undefined)} portal align="start" selectedId={binding.workModeDecision ? binding.workMode : 'auto'} anchor={anchor('workMode', t(binding.workModeDecision ? { cat: 'CAT', 'working-copy': '工作副本', browser: '浏览器' }[binding.workMode] : '开工时选择'), !blank)} items={[{ id: 'auto', label: t('开工时选择') }, { id: 'cat', label: 'CAT', disabled: !binding.projectId }, { id: 'working-copy', label: t('工作副本') }, { id: 'browser', label: t('浏览器') }]} onSelect={workMode => void change(workMode === 'auto' ? { workMode: binding.projectId ? 'cat' : 'working-copy', workModeDecision: undefined } : { workMode: workMode as LinguistBinding['workMode'], workModeDecision: { source: 'user' } })} />
    {availableProjects.length > 0 && <Menu open={menu === 'project'} onClose={() => setMenu(undefined)} portal align="start" selectedId={binding.projectId} anchor={anchor('project', availableProjects.find(project => project.id === binding.projectId)?.name ?? t('选择项目'), !blank)} items={availableProjects.map(project => ({ id: project.id, label: project.name }))} onSelect={projectId => void change({ projectId, ...(binding.workModeDecision ? {} : { workMode: 'cat' }) })} />}
    {binding.projectId && binding.workMode === 'cat' && <Button variant="outline" size="sm" onClick={() => onOpenProject(binding.projectId!)}>{t('打开 CAT')}</Button>}
    {!blank && <span className={styles.setupHint}>{t('换岗位会开启新会话')}</span>}
    {running && binding.projectId && <RetrievalProgress key={sessionId + ':' + binding.projectId + ':' + (binding.taskGroupId ?? '')} projectId={binding.projectId} taskGroupId={binding.taskGroupId ?? ''} />}
    {error && <span className={styles.contextError} role="alert">{error}</span>}
  </div>
}
