import * as React from 'react'
import { Button, Input } from '@deepseek-ai/dsh-client-ui-primitives'
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
import styles from './ProjectsPage.module.css'

export type Role = 'general' | 'translator' | 'reviewer' | 'proofreader'
export type WorkMode = 'cat' | 'working-copy' | 'browser'
type Project = LinguistProjectInfo & { workspaceId?: string }
type ImportedBackup = { project: Project; importedFrom: string; schemaVersion: number }
type ProjectDetail = { summary?: LinguistProjectSummary; health?: LinguistProjectHealthReport; summaryError?: string; healthError?: string }

export function ProjectsPage({ workspaces, sessions, onEnter, onOpenSession }: {
  workspaces: IWorkspaces
  sessions: ISessions
  onEnter: (input: { projectId?: string; workspaceId: WorkspaceId; role: Role; workMode: WorkMode }) => Promise<void>
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
  const [role, setRole] = React.useState<Role>('general')
  const [workMode, setWorkMode] = React.useState<WorkMode>('cat')
  const [includeArchived, setIncludeArchived] = React.useState(false)
  const [message, setMessage] = React.useState('')
  const [busy, setBusy] = React.useState(false)
  const [refresh, setRefresh] = React.useState(0)
  const [formats, setFormats] = React.useState<LinguistFormatQualification[]>([])
  const [formatError, setFormatError] = React.useState('')
  const [settingsProjectId, setSettingsProjectId] = React.useState<string>()

  React.useEffect(() => {
    if (workspaceId === '' && workspaceSnapshot.items.length === 1) setWorkspaceId(workspaceSnapshot.items[0]!.workspaceId)
  }, [workspaceId, workspaceSnapshot.items])
  React.useEffect(() => {
    let live = true
    setLoading(true)
    required<Project[]>('linguistProjectsList', { includeArchived: true }).then((next) => { if (live) { setProjects(next); setLoading(false) } }).catch((error: unknown) => { if (live) { setLoading(false); setMessage(describeProjectError(error, t)) } })
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
    try {
      const created = await required<Project>('linguistProjectsCreate', { name: name.trim(), sourceLocale, targetLocale, workflowStage, qaProfile: 'general', workspaceId })
      setName('')
      setRefresh((value) => value + 1)
      setMessage(t('已创建 {name}', { name: created.name }))
    } catch (error) { setMessage(describeProjectError(error, t)) }
    finally { setBusy(false) }
  }
  const enter = async (project?: Project) => {
    const targetWorkspace = project?.workspaceId ?? workspaceId
    if (!targetWorkspace) { setMessage(t("请选择 DSH Workspace，或先为项目建立关联。")); return }
    setBusy(true)
    try { await onEnter({ projectId: project?.id, workspaceId: targetWorkspace as WorkspaceId, role, workMode: project?.archivedAt ? 'cat' : workMode }); setMessage(t("会话已打开")) }
    catch (error) { setMessage(describeProjectError(error, t)) }
    finally { setBusy(false) }
  }
  const importBackup = async (event: React.FormEvent) => {
    event.preventDefault()
    if (!workspaceId || !backupPath.trim()) return
    setBusy(true)
    try {
      const result = await required<ImportedBackup>('linguistBackupsImportExternal', { workspaceId, backupPath: backupPath.trim() })
      setBackupPath('')
      setRefresh((value) => value + 1)
      setMessage(t('已从 Workspace 备份目录导入 {name}', { name: result.project.name }))
    } catch (error) { setMessage(describeProjectError(error, t)) }
    finally { setBusy(false) }
  }
  const visibleProjects = projects.filter((project) => (!project.archivedAt || includeArchived) && (!workspaceId || project.workspaceId === workspaceId || project.workspaceId === undefined))
  const activeVisible = visibleProjects.filter((project) => !project.archivedAt)
  const settingsProject = projects.find((project) => project.id === settingsProjectId)
  const reorder = async (projectId: string, step: -1 | 1) => {
    const position = activeVisible.findIndex((project) => project.id === projectId)
    const neighbor = activeVisible[position + step]
    if (!neighbor) return
    const orderedProjectIds = projects.filter((project) => !project.archivedAt).map((project) => project.id)
    const from = orderedProjectIds.indexOf(projectId)
    const to = orderedProjectIds.indexOf(neighbor.id)
    ;[orderedProjectIds[from], orderedProjectIds[to]] = [orderedProjectIds[to]!, orderedProjectIds[from]!]
    setBusy(true)
    try {
      await required('linguistProjectsReorderActive', { orderedProjectIds })
      setRefresh((value) => value + 1)
      setMessage(t('项目顺序已保存'))
    } catch (error) { setMessage(describeProjectError(error, t)) }
    finally { setBusy(false) }
  }
  return <main className={styles.page} aria-label={t("Linguist 项目")}>
    <header className={styles.heading}><h1>Linguist</h1><p>{t("项目、岗位与工作方式")}</p></header>
    <div className={styles.columns}>
      <section className={styles.section} aria-label={t("项目")}>
        <div className={styles.toolbar}><h2>{t("项目")}</h2><Button size="sm" onClick={() => setRefresh((value) => value + 1)}>{t("刷新")}</Button><label><input type="checkbox" checked={includeArchived} onChange={(event) => setIncludeArchived(event.target.checked)} /> {t("显示归档")}</label></div>
        <label className={styles.label}>DSH Workspace<select aria-label="DSH Workspace" value={workspaceId} onChange={(event) => setWorkspaceId(event.target.value as WorkspaceId)}><option value="">{t("选择 Workspace")}</option>{workspaceSnapshot.items.map((workspace) => <option key={workspace.workspaceId} value={workspace.workspaceId}>{workspace.title} · {workspace.path}</option>)}</select></label>
        {workspaceSnapshot.items.length === 0 && <p role="status">{t("DSH 尚无 Workspace。请先在原生侧栏创建 Workspace。")}</p>}
        {loading ? <p role="status">{t("正在读取项目…")}</p> : visibleProjects.length === 0 ? <p>{t("当前没有项目。填写右侧表单创建。")}</p> : <ul className={styles.list}>{visibleProjects.map((project) => {
          const detail = details[project.id]
          const failedChecks = detail?.health?.checks.filter((check) => !check.ok).map((check) => describeHealthCheck(check, t))
          return <li key={project.id} className={styles.project}>
            <div className={styles.projectIdentity}>
              <strong>{project.name}</strong>
              <small>{project.sourceLocale} → {project.targetLocale} · {t(stageName(project.workflowStage ?? 'translation'))}{project.archivedAt ? t(" · 已归档") : ''}</small>
              <small>{detail?.summary ? t('{segments} 段 · {assets} 批次', { segments: detail.summary.totalSegments, assets: detail.summary.assetCount }) : detail?.summaryError ? t('计数不可用') : t('计数加载中…')}</small>
              <small>{t('更新于 {time}', { time: new Date(project.updatedAt).toLocaleString() })} · {t('创建于 {time}', { time: new Date(project.createdAt).toLocaleString() })}</small>
              {failedChecks && failedChecks.length > 0 && <span className={styles.warning}>{t('需要修复')} · {failedChecks.join('；')}</span>}
              {detail?.healthError && <span className={styles.warning}>{t('健康检查不可用')} · {detail.healthError}</span>}
              {!project.workspaceId && <span className={styles.warning}>{t("需关联 Workspace")}</span>}
            </div>
            <div className={styles.projectActions}>
              {!project.archivedAt && <><Button size="sm" aria-label={t('上移 {name}', { name: project.name })} disabled={busy || activeVisible[0]?.id === project.id} onClick={() => void reorder(project.id, -1)}>↑</Button><Button size="sm" aria-label={t('下移 {name}', { name: project.name })} disabled={busy || activeVisible.at(-1)?.id === project.id} onClick={() => void reorder(project.id, 1)}>↓</Button></>}
              {!project.workspaceId && <Button size="sm" disabled={busy || !workspaceId} onClick={() => { if (!workspaceId) return; setBusy(true); void required('linguistProjectsAssociateWorkspace', { projectId: project.id, workspaceId }).then(() => { setRefresh((value) => value + 1); setMessage(t("Workspace 已关联")) }).catch((error: unknown) => setMessage(describeProjectError(error, t))).finally(() => setBusy(false)) }}>{t("关联所选 Workspace")}</Button>}
              <Button size="sm" aria-pressed={settingsProjectId === project.id} onClick={() => setSettingsProjectId((current) => current === project.id ? undefined : project.id)}>{t('设置')}</Button>
              <Button size="sm" disabled={busy || !project.workspaceId} onClick={() => void enter(project)}>{project.archivedAt ? t('只读查看') : t("进入工作会话")}</Button>
            </div>
          </li>
        })}</ul>}
        <ProjectSessions sessions={sessions} projects={projects} onOpen={onOpenSession} />
        {settingsProject && <div className={styles.settings}><div className={styles.toolbar}><h2>{settingsProject.name} · {t('项目设置')}</h2><Button size="sm" onClick={() => setSettingsProjectId(undefined)}>{t('关闭设置')}</Button></div><ProjectSettingsPanel key={settingsProject.id} project={settingsProject} hasBatches={(details[settingsProject.id]?.summary?.assetCount ?? 0) > 0} onChanged={() => setRefresh((value) => value + 1)} /></div>}
      </section>
      <div className={styles.right}>
        <section className={styles.section} aria-label={t("新建项目")}><h2>{t("新建项目")}</h2><form className={styles.form} onSubmit={(event) => void create(event)}><label>{t("名称")}<Input required value={name} onChange={(event) => setName(event.target.value)} /></label><div className={styles.locale}><label>Source locale<Input required value={sourceLocale} onChange={(event) => setSourceLocale(event.target.value)} /></label><label>Target locale<Input required value={targetLocale} onChange={(event) => setTargetLocale(event.target.value)} /></label></div><label>{t("当前工作阶段")}<select value={workflowStage} onChange={(event) => setWorkflowStage(event.target.value as LinguistWorkflowStage)}><option value="translation">{t("翻译")}</option><option value="editing">{t("编辑审校")}</option><option value="proofreading">{t("校对")}</option></select></label><Button type="submit" variant="primary" disabled={busy || !workspaceId || !name.trim()}>{t("创建")}</Button></form></section>
        <section className={styles.section} aria-label={t('导入备份目录')}><h2>{t('导入备份目录')}</h2><p>{t('输入所选 DSH Workspace 内的相对目录。导入后会自动关联该 Workspace；原备份不会改动。')}</p><form className={styles.form} onSubmit={(event) => void importBackup(event)}><label>{t('Workspace 相对备份目录')}<Input required placeholder="backup-YYYY-MM-DDTHH-MM-SS-mmmZ" value={backupPath} onChange={(event) => setBackupPath(event.target.value)} /></label><Button type="submit" disabled={busy || !workspaceId || !backupPath.trim()}>{t('导入备份')}</Button></form></section>
        <LegacyMigrationPanel workspaceId={workspaceId} onImported={() => setRefresh((value) => value + 1)} />
        <section className={styles.section} aria-label={t("岗位与工作方式")}><h2>{t("进入会话")}</h2><p>{t("岗位决定默认职责。DSH 的通用工具和权限仍由宿主管理。")}</p><div className={styles.roles} role="radiogroup" aria-label={t("岗位")}>{([['general',t("通用")],['translator',t("译者")],['reviewer',t("审校")],['proofreader',t("校对")]] as const).map(([id,label]) => <label key={id}><input type="radio" name="linguist-role" value={id} checked={role === id} onChange={() => setRole(id)} />{label}</label>)}</div><div className={styles.modes} role="radiogroup" aria-label={t("工作方式")}>{([['cat','CAT'],['working-copy',t("工作副本")],['browser',t("浏览器")]] as const).map(([id,label]) => <label key={id}><input type="radio" name="linguist-mode" value={id} checked={workMode === id} onChange={() => setWorkMode(id)} />{label}</label>)}</div>{workMode !== 'cat' && <Button size="sm" disabled={busy || !workspaceId} onClick={() => void enter()}>{t("新建无项目会话")}</Button>}</section>
        <section className={styles.section} aria-label={t("格式验证与平台资格")}><h2>{t("格式资格")}</h2><p>{t("内部验证与平台资格分别记录；“未验证”不代表不兼容。")}</p>{formatError && <p role="alert">{formatError}</p>}{formats.map((format) => <p key={format.formatId}>{t(describeLinguistFormat(format.formatId))} · {format.extensions.map((extension) => `.${extension}`).join(' ')} {t("· 内部")}{format.internalVerification === 'passed' ? t("通过") : t("失败")} {t("· 平台")}{format.platformQualification}{describeFormatCapability(format.formatId) && <small> · {t(describeFormatCapability(format.formatId)!)}</small>}</p>)}</section>
      </div>
    </div>
    {message && <p role="status" className={styles.message}>{message}</p>}
  </main>
}
