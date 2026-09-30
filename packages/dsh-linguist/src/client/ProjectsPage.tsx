import { PROJECT_NAME_MAX_LENGTH } from '../project-input'
import * as React from 'react'
import { Button, Checkbox, Input, Menu, Modal, Tooltip, IconEllipsisOutlineRegular } from '@deepseek-ai/dsh-client-ui-primitives'
import type { IWorkspaces } from '@deepseek-ai/dsh-api-workspace-controller/client'
import type { ISessions } from '@deepseek-ai/dsh-api-session-controller/client'
import type { WorkspaceId } from '@deepseek-ai/dsh-workspace/types'
import type { LinguistFormatQualification, LinguistProjectHealthReport, LinguistProjectInfo, LinguistProjectSummary, LinguistWorkflowStage } from '@linguist/domain-service/contracts'
import { required, type LinguistBinding } from './api'
import { describeFormatCapability, describeLinguistFormat } from './format-labels'
import { ProjectSettingsPanel } from './Panels'
import { LegacyMigrationPanel } from './LegacyMigrationPanel'
import { describeHealthCheck, describeProjectError } from './project-errors'
import { useT } from './ui-locale'
import { stageName } from './workflow-ui'
import { ProjectSessions } from './ProjectSessions'
import { ProjectLocaleSelect } from './ProjectLocaleSelect'
import styles from './ProjectsPage.module.css'

export type Role = 'general' | 'translator' | 'reviewer' | 'proofreader'
export type WorkMode = 'cat' | 'working-copy' | 'browser'
type Project = LinguistProjectInfo & { workspaceId?: string }
type ImportedBackup = { project: Project; importedFrom: string; schemaVersion: number }
type ProjectDetail = { summary?: LinguistProjectSummary; health?: LinguistProjectHealthReport; summaryError?: string; healthError?: string }

export function ProjectsPage({ workspaces, sessions, onEnter, onOpenProject, onOpenSession, onPickDirectory, capabilities }: {
  workspaces: IWorkspaces
  capabilities: React.ReactNode
  onPickDirectory: (workspaceId: string) => Promise<string | null>
  sessions: ISessions
  onEnter: (input: { projectId?: string; workspaceId: WorkspaceId; role: Role; workMode: WorkMode }) => Promise<void>
  onOpenProject: (projectId: string) => Promise<void>
  onOpenSession: (binding: LinguistBinding) => Promise<void>
}): React.ReactElement {
  const t = useT()
  const workspaceSource = workspaces.list
  const subscribeWorkspaces = React.useMemo(() => workspaceSource.subscribe.bind(workspaceSource), [workspaceSource])
  const getWorkspaceSnapshot = React.useMemo(() => workspaceSource.getSnapshot.bind(workspaceSource), [workspaceSource])
  const workspaceSnapshot = React.useSyncExternalStore(subscribeWorkspaces, getWorkspaceSnapshot)
  const [workspaceId, setWorkspaceId] = React.useState<WorkspaceId | ''>('')
  const [projects, setProjects] = React.useState<Project[]>([])
  const [details, setDetails] = React.useState<Record<string, ProjectDetail>>({})
  const [loading, setLoading] = React.useState(true)
  const [name, setName] = React.useState('')
  const [backupPath, setBackupPath] = React.useState('')
  const [sourceLocale, setSourceLocale] = React.useState('en-US')
  const [targetLocale, setTargetLocale] = React.useState('zh-CN')
  const [workflowStage, setWorkflowStage] = React.useState<LinguistWorkflowStage>('translation')
  const [qaProfile, setQaProfile] = React.useState<'general' | 'subtitle'>('general')
  const [role, setRole] = React.useState<Role>('general')
  const [workMode, setWorkMode] = React.useState<WorkMode>('cat')
  const [includeArchived, setIncludeArchived] = React.useState(false)
  const [message, setMessage] = React.useState('')
  const [messageIsError, setMessageIsError] = React.useState(false)
  const showMessage = (text: string, error = false) => { setMessage(text); setMessageIsError(error) }
  const [busy, setBusy] = React.useState(false)
  const [refresh, setRefresh] = React.useState(0)
  const [formats, setFormats] = React.useState<LinguistFormatQualification[]>([])
  const [formatError, setFormatError] = React.useState('')
  const [settingsProjectId, setSettingsProjectId] = React.useState<string>()
  const [projectMenuId, setProjectMenuId] = React.useState<string>()
  const [draggingProjectId, setDraggingProjectId] = React.useState<string>()
  const [dropTarget, setDropTarget] = React.useState<{ projectId: string; position: 'before' | 'after' }>()
  const [dialog, setDialog] = React.useState<'create' | 'import' | 'formats'>()

  React.useEffect(() => {
    if (workspaceId === '' && workspaceSnapshot.items.length === 1) setWorkspaceId(workspaceSnapshot.items[0]!.workspaceId)
  }, [workspaceId, workspaceSnapshot.items])
  React.useEffect(() => {
    let live = true
    setLoading(true)
    required<Project[]>('linguistProjectsList', { includeArchived: true }).then((next) => { if (live) { setProjects(next); setLoading(false) } }).catch((error: unknown) => { if (live) { setLoading(false); showMessage(describeProjectError(error, t), true) } })
    return () => { live = false }
  }, [refresh])
  React.useEffect(() => {
    let live = true
    required<LinguistFormatQualification[]>('linguistProjectsListFormatQualifications', {})
      .then((next) => { if (live) setFormats(next) })
      .catch((error: unknown) => { if (live) setFormatError(describeProjectError(error, t)) })
    return () => { live = false }
  }, [])
  React.useEffect(() => {
    let live = true
    for (const project of projects) {
      required<LinguistProjectSummary>('linguistProjectsGetSummary', { projectId: project.id })
        .then((summary) => { if (live) setDetails((current) => ({ ...current, [project.id]: { ...current[project.id], summary, summaryError: undefined } })) })
        .catch((error: unknown) => { if (live) setDetails((current) => ({ ...current, [project.id]: { ...current[project.id], summaryError: describeProjectError(error, t) } })) })
      required<LinguistProjectHealthReport>('linguistProjectsCheckHealth', { projectId: project.id })
        .then((health) => { if (live) setDetails((current) => ({ ...current, [project.id]: { ...current[project.id], health, healthError: undefined } })) })
        .catch((error: unknown) => { if (live) setDetails((current) => ({ ...current, [project.id]: { ...current[project.id], healthError: describeProjectError(error, t) } })) })
    }
    return () => { live = false }
  }, [projects])

  const create = async (event: React.FormEvent) => {
    event.preventDefault()
    if (!workspaceId) return
    setBusy(true)
    showMessage('')
    try {
      const created = await required<Project>('linguistProjectsCreate', { name: name.trim(), sourceLocale: sourceLocale.trim(), targetLocale: targetLocale.trim(), workflowStage, qaProfile, workspaceId })
      setName('')
      setDialog(undefined)
      setRefresh((value) => value + 1)
      showMessage(t('已创建 {name}', { name: created.name }))
      await openProject(created)
    } catch (error) { showMessage(describeProjectError(error, t), true) }
    finally { setBusy(false) }
  }
  const enter = async (project?: Project) => {
    const targetWorkspace = project?.workspaceId ?? workspaceId
    if (!targetWorkspace) { showMessage(t("请选择工作区，或先为项目建立关联。")); return }
    setBusy(true)
    showMessage('')
    try { await onEnter({ projectId: project?.id, workspaceId: targetWorkspace as WorkspaceId, role, workMode: project?.archivedAt ? 'cat' : workMode }); showMessage(t("会话已打开")) }
    catch (error) { showMessage(describeProjectError(error, t), true) }
    finally { setBusy(false) }
  }
  const openProject = async (project: Project) => {
    setBusy(true)
    showMessage('')
    try { await onOpenProject(project.id); showMessage(t('会话已打开')) }
    catch (error) { showMessage(describeProjectError(error, t), true) }
    finally { setBusy(false) }
  }
  const importBackup = async (event: React.FormEvent) => {
    event.preventDefault()
    if (!workspaceId || !backupPath.trim()) return
    setBusy(true)
    showMessage('')
    try {
      const result = await required<ImportedBackup>('linguistBackupsImportExternal', { workspaceId, backupPath: backupPath.trim() })
      setBackupPath('')
      setRefresh((value) => value + 1)
      showMessage(t('已从工作区备份目录导入 {name}', { name: result.project.name }))
    } catch (error) { showMessage(describeProjectError(error, t), true) }
    finally { setBusy(false) }
  }
  const visibleProjects = projects.filter((project) => (!project.archivedAt || includeArchived) && (!workspaceId || project.workspaceId === workspaceId || project.workspaceId === undefined))
  const activeVisible = visibleProjects.filter((project) => !project.archivedAt)
  const settingsProject = projects.find((project) => project.id === settingsProjectId)
  const selectedWorkspace = workspaceSnapshot.items.find((workspace) => workspace.workspaceId === workspaceId)
  const workspacePicker = <label className={styles.workspacePicker}>{t('工作区')}<Tooltip portal label={selectedWorkspace?.path ?? t('选择工作区')}><select aria-label={t('工作区')} disabled={busy} value={workspaceId} onChange={(event) => setWorkspaceId(event.target.value as WorkspaceId)}><option value="">{t('选择工作区')}</option>{workspaceSnapshot.items.map((workspace) => <option key={workspace.workspaceId} value={workspace.workspaceId}>{workspaceSnapshot.items.some((other) => other.workspaceId !== workspace.workspaceId && other.title === workspace.title) ? `${workspace.title} · ${workspace.path}` : workspace.title}</option>)}</select></Tooltip></label>
  const saveOrder = async (orderedProjectIds: string[]) => {
    setBusy(true)
    showMessage('')
    try {
      await required('linguistProjectsReorderActive', { orderedProjectIds })
      setRefresh((value) => value + 1)
      showMessage(t('项目顺序已保存'))
    } catch (error) { showMessage(describeProjectError(error, t), true) }
    finally { setBusy(false) }
  }
  const reorder = async (projectId: string, step: -1 | 1) => {
    const position = activeVisible.findIndex((project) => project.id === projectId)
    const neighbor = activeVisible[position + step]
    if (!neighbor) return
    const orderedProjectIds = projects.filter((project) => !project.archivedAt).map((project) => project.id)
    const from = orderedProjectIds.indexOf(projectId)
    const to = orderedProjectIds.indexOf(neighbor.id)
    ;[orderedProjectIds[from], orderedProjectIds[to]] = [orderedProjectIds[to]!, orderedProjectIds[from]!]
    await saveOrder(orderedProjectIds)
  }
  const dropProject = (event: React.DragEvent<HTMLLIElement>, projectId: string) => {
    event.preventDefault()
    setDraggingProjectId(undefined)
    setDropTarget(undefined)
    if (busy || !draggingProjectId || draggingProjectId === projectId) return
    const rect = event.currentTarget.getBoundingClientRect()
    const position = event.clientY < rect.top + rect.height / 2 ? 'before' : 'after'
    const orderedProjectIds = projects.filter((project) => !project.archivedAt && project.id !== draggingProjectId).map((project) => project.id)
    orderedProjectIds.splice(orderedProjectIds.indexOf(projectId) + (position === 'after' ? 1 : 0), 0, draggingProjectId)
    void saveOrder(orderedProjectIds)
  }
  return <main className={styles.page} aria-label={t("Linguist 项目")}>
    <header className={styles.heading}>
      <div><h1>Linguist</h1><p>{t("项目、岗位与工作方式")}</p></div>
      <div className={styles.toolbar}>
        <Button variant="ghost" size="sm" onClick={() => { showMessage(''); setDialog('formats') }}>{t('格式资格')}</Button>
        <Button variant="outline" size="sm" onClick={() => { showMessage(''); setDialog('import') }}>{t('导入项目')}</Button>
        <Button variant="primary" size="sm" onClick={() => { showMessage(''); setDialog('create') }}>{t('新建项目')}</Button>
      </div>
    </header>
    <div className={styles.content}>
      <section className={styles.section} aria-label={t("项目")}>
        <div className={styles.projectToolbar}><h2>{t("项目")}</h2>{workspacePicker}<Button variant="ghost" size="sm" disabled={loading} onClick={() => setRefresh((value) => value + 1)}>{t("刷新")}</Button><Checkbox checked={includeArchived} onChange={setIncludeArchived} label={t("显示归档")} /></div>
        <section className={styles.sessionOptions} aria-label={t("岗位与工作方式")}>
          <span>{t('新会话')}</span>
          <label>{t('岗位')}<Tooltip portal label={t('岗位决定默认职责。DSH 的通用工具和权限仍由宿主管理。')}><select aria-label={t('岗位')} value={role} onChange={(event) => setRole(event.target.value as Role)}>{([['general',t('通用')],['translator',t('译者')],['reviewer',t('审校')],['proofreader',t('校对')]] as const).map(([id,label]) => <option key={id} value={id}>{label}</option>)}</select></Tooltip></label>
          <label>{t('工作方式')}<select aria-label={t('工作方式')} value={workMode} onChange={(event) => setWorkMode(event.target.value as WorkMode)}>{([['cat','CAT'],['working-copy',t('工作副本')],['browser',t('浏览器')]] as const).map(([id,label]) => <option key={id} value={id}>{label}</option>)}</select></label>
          {workMode !== 'cat' && <Button variant="outline" size="sm" disabled={busy || !workspaceId} onClick={() => void enter()}>{t('新建无项目会话')}</Button>}
        </section>
        {workspaceSnapshot.items.length === 0 && <p role="status">{t("尚无工作区。请先在 DSH 原生侧栏创建工作区。")}</p>}
        {loading ? <p role="status">{t("正在读取项目…")}</p> : visibleProjects.length === 0 ? <div className={styles.empty}><strong>{t("开始一个本地化项目")}</strong><p>{t("当前没有项目。新建项目或导入已有项目后开始工作。")}</p></div> : <ul className={styles.list}>{visibleProjects.map((project) => {
          const detail = details[project.id]
          const workspace = workspaceSnapshot.items.find(item => item.workspaceId === project.workspaceId)
          const failedChecks = detail?.health?.checks.filter((check) => !check.ok).map((check) => describeHealthCheck(check, t))
          return <li key={project.id} className={styles.project} data-drop-position={dropTarget?.projectId === project.id ? dropTarget.position : undefined} onDragOver={(event) => {
            if (busy || project.archivedAt || !draggingProjectId || draggingProjectId === project.id) return
            event.preventDefault()
            event.dataTransfer.dropEffect = 'move'
            const rect = event.currentTarget.getBoundingClientRect()
            setDropTarget({ projectId: project.id, position: event.clientY < rect.top + rect.height / 2 ? 'before' : 'after' })
          }} onDragLeave={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node)) setDropTarget(undefined) }} onDrop={(event) => { if (!project.archivedAt) dropProject(event, project.id) }}>
            <div className={styles.projectIdentity}>
              <Tooltip portal label={`${t('更新于 {time}', { time: new Date(project.updatedAt).toLocaleString() })} · ${t('创建于 {time}', { time: new Date(project.createdAt).toLocaleString() })} · ${project.archivedAt ? t('归档于 {time}', { time: new Date(project.archivedAt).toLocaleString() }) : t('拖动调整项目顺序')}`}><Button variant="ghost" size="sm" className={styles.projectName} disabled={busy || !project.workspaceId} draggable={!project.archivedAt && !busy} onClick={() => void openProject(project)} onDragStart={(event) => { setDraggingProjectId(project.id); setProjectMenuId(undefined); event.dataTransfer.effectAllowed = 'move'; event.dataTransfer.setData('text/plain', project.id) }} onDragEnd={() => { setDraggingProjectId(undefined); setDropTarget(undefined) }}>{project.name}</Button></Tooltip>
              <small>{project.sourceLocale} → {project.targetLocale} · {t(stageName(project.workflowStage ?? 'translation'))}{project.archivedAt ? t(" · 已归档") : ''} · {detail?.summary ? t('{segments} 段 · {assets} 批次', { segments: detail.summary.totalSegments, assets: detail.summary.assetCount }) : detail?.summaryError ? t('计数不可用') : t('计数加载中…')}{project.workspaceId && <> · <span title={workspace?.path}>{workspace ? `${t('工作区')} · ${workspace.title}` : t('工作区不可用')}</span></>}</small>
              {failedChecks && failedChecks.length > 0 && <span className={styles.warning}>{t('需要修复')} · {failedChecks.join('；')}</span>}
              {detail?.healthError && <span className={styles.warning}>{t('健康检查不可用')} · {detail.healthError}</span>}
              {!project.workspaceId && <span className={styles.warning}>{t('需关联工作区')}</span>}
            </div>
            <div className={styles.projectActions}>
              {!project.archivedAt && <Menu portal open={projectMenuId === project.id} onClose={() => setProjectMenuId(undefined)} anchor={<Button variant="ghost" size="sm" aria-label={t('项目 {name} 的更多操作', { name: project.name })} aria-haspopup="menu" aria-expanded={projectMenuId === project.id} onClick={() => setProjectMenuId((current) => current === project.id ? undefined : project.id)}><IconEllipsisOutlineRegular size={16} /></Button>} items={[
                { id: 'up', label: t('上移 {name}', { name: project.name }), disabled: busy || activeVisible[0]?.id === project.id },
                { id: 'down', label: t('下移 {name}', { name: project.name }), disabled: busy || activeVisible.at(-1)?.id === project.id },
              ]} onSelect={(id) => { setProjectMenuId(undefined); void reorder(project.id, id === 'up' ? -1 : 1) }} />}
              {!project.workspaceId && <Button variant="outline" size="sm" disabled={busy || !workspaceId} onClick={() => { if (!workspaceId) return; setBusy(true); void required('linguistProjectsAssociateWorkspace', { projectId: project.id, workspaceId }).then(() => { setRefresh((value) => value + 1); showMessage(t("工作区已关联")) }).catch((error: unknown) => showMessage(describeProjectError(error, t), true)).finally(() => setBusy(false)) }}>{t("关联所选工作区")}</Button>}
              <Button variant="ghost" size="sm" aria-pressed={settingsProjectId === project.id} onClick={() => setSettingsProjectId((current) => current === project.id ? undefined : project.id)}>{t('设置')}</Button>
              <Button variant="outline" size="sm" disabled={busy || !project.workspaceId} onClick={() => void enter(project)}>{project.archivedAt ? t('只读查看') : t("进入工作会话")}</Button>
            </div>
          </li>
        })}</ul>}
        <ProjectSessions sessions={sessions} projects={projects} onOpen={onOpenSession} />

      </section>
      <Modal open={dialog === 'create'} onClose={() => { if (!busy) setDialog(undefined) }} title={t('新建项目')} closeLabel={t('关闭')} className={styles.modal} contentClassName={styles.dialog}>
          <p className={styles.formHint}>{t('先选择工作区，再设置项目语言和工作阶段。')}</p>
          <form className={styles.form} onSubmit={(event) => void create(event)}>
            {workspacePicker}
            <label>{t("名称")}<Input required disabled={busy} maxLength={PROJECT_NAME_MAX_LENGTH} data-modal-autofocus placeholder={t('例如：官网本地化')} value={name} onChange={(event) => setName(event.target.value)} /></label>
            <div className={styles.locale}>
              <ProjectLocaleSelect label={t('源语言')} disabled={busy} value={sourceLocale} onValueChange={setSourceLocale} />
              <ProjectLocaleSelect label={t('目标语言')} disabled={busy} value={targetLocale} onValueChange={setTargetLocale} />
            </div>
            <label>{t("当前工作阶段")}<select disabled={busy} value={workflowStage} onChange={(event) => setWorkflowStage(event.target.value as LinguistWorkflowStage)}><option value="translation">{t("翻译")}</option><option value="editing">{t("编辑审校")}</option><option value="proofreading">{t("校对")}</option></select></label>
            <small className={styles.formHint}>{t('已有目标译文不会自动算作本轮完成；确认后会按此阶段写回双语文件状态。')}</small>
            <label>{t('QA 场景')}<select disabled={busy} value={qaProfile} onChange={(event) => setQaProfile(event.target.value as 'general' | 'subtitle')}><option value="general">{t('通用本地化')}</option><option value="subtitle">{t('字幕 / 对白')}</option></select></label>
            <small className={styles.formHint}>{t('字幕模式只降低省略号、强调标点和长度比例噪声；数字、标签与占位符硬门不变。')}</small>
            <Button type="submit" variant="primary" disabled={busy || !workspaceId || !name.trim()}>{t("创建")}</Button>
          </form>
        {message && <p role={messageIsError ? 'alert' : 'status'} className={messageIsError ? styles.warning : styles.message}>{message}</p>}
      </Modal>
      <Modal open={dialog === 'import'} onClose={() => { if (!busy) setDialog(undefined) }} title={t('导入项目')} closeLabel={t('关闭')} className={styles.modal} contentClassName={styles.dialog}>
        <section className={styles.section} aria-label={t('导入备份目录')}>
          <h2>{t('导入备份目录')}</h2>
          <p>{t('选择当前工作区内的备份目录。导入后会自动关联该工作区；原备份不会改动。')}</p>
          <form className={styles.form} onSubmit={(event) => void importBackup(event)}>
            {workspacePicker}
            <label>{t('工作区相对备份目录')}<Input required disabled={busy} placeholder="backup-YYYY-MM-DDTHH-MM-SS-mmmZ" value={backupPath} onChange={(event) => setBackupPath(event.target.value)} /></label>
            <div className={styles.toolbar}>
              <Button variant="outline" type="button" disabled={busy || !workspaceId} onClick={() => { void onPickDirectory(workspaceId).then((path) => { if (path !== null) setBackupPath(path) }).catch((error: unknown) => showMessage(describeProjectError(error, t), true)) }}>{t('选择目录')}</Button>
              <Button variant="outline" type="submit" disabled={busy || !workspaceId || !backupPath.trim()}>{t('导入备份')}</Button>
            </div>
          </form>
        </section>
        <details className={styles.disclosure}><summary>{t('旧 LA 数据根迁移')}</summary><fieldset disabled={busy} className={styles.migration}><LegacyMigrationPanel workspaceId={workspaceId} onRunningChange={setBusy} onPickDirectory={onPickDirectory} onImported={() => setRefresh((value) => value + 1)} /></fieldset></details>
        {message && <p role={messageIsError ? 'alert' : 'status'} className={messageIsError ? styles.warning : styles.message}>{message}</p>}
      </Modal>

      <Modal open={dialog === 'formats'} onClose={() => { if (!busy) setDialog(undefined) }} title={t('格式资格')} closeLabel={t('关闭')} className={styles.modal} contentClassName={styles.dialog}>
        <section className={styles.section} aria-label={t("格式验证与平台资格")}><h2>{t("格式资格")}</h2><p>{t("内部验证与平台资格分别记录；“未验证”不代表不兼容。")}</p>{formatError && <p role="alert">{formatError}</p>}{formats.map((format) => <p key={format.formatId}>{t(describeLinguistFormat(format.formatId))} · {format.extensions.join(' ')} {t("· 内部")}{format.internalVerification === 'passed' ? t("通过") : t("失败")} {t("· 平台")}{format.platformQualification}{describeFormatCapability(format.formatId) && <small> · {t(describeFormatCapability(format.formatId)!)}</small>}</p>)}</section>
        {message && <p role={messageIsError ? 'alert' : 'status'} className={messageIsError ? styles.warning : styles.message}>{message}</p>}
      </Modal>
      <Modal open={Boolean(settingsProject)} onClose={() => setSettingsProjectId(undefined)} title={settingsProject ? `${settingsProject.name} · ${t('项目设置')}` : t('项目设置')} closeLabel={t('关闭')} className={styles.modal} contentClassName={styles.dialog}>
        {settingsProject && <ProjectSettingsPanel capabilities={capabilities} key={settingsProject.id} project={settingsProject} hasBatches={(details[settingsProject.id]?.summary?.assetCount ?? 0) > 0} onChanged={() => setRefresh((value) => value + 1)} />}
      </Modal>
    </div>
    {message && !dialog && <p role={messageIsError ? 'alert' : 'status'} className={messageIsError ? styles.warning : styles.message}>{message}</p>}
  </main>
}
