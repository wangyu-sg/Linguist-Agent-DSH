import * as React from 'react'
import { Button, Checkbox, Input } from '@deepseek-ai/dsh-client-ui-primitives'
import type {
  LinguistMigrationProjectReport,
  LinguistMigrationProgress,
  LinguistMigrationReport,
  LinguistMigrationWorkspaceScanResult,
} from '@linguist/domain-service/contracts'
import { required, subscribeMigration } from './api'
import { useT } from './ui-locale'
import styles from './LegacyMigrationPanel.module.css'

export function LegacyMigrationPanel({ workspaceId, onImported, onPickDirectory, onRunningChange }: { workspaceId: string; onImported: () => void; onPickDirectory: (workspaceId: string) => Promise<string | null>; onRunningChange: (running: boolean) => void }): React.ReactElement {
  const t = useT()
  const [legacyRootPath, setLegacyRootPath] = React.useState('.')
  const [scan, setScan] = React.useState<LinguistMigrationWorkspaceScanResult>()
  const [selected, setSelected] = React.useState<ReadonlySet<string>>(new Set())
  const [externalSource, setExternalSource] = React.useState<'copy' | 'reference'>('copy')
  const [salvageOrphan, setSalvageOrphan] = React.useState(false)
  const [running, setRunning] = React.useState(false)
  const [current, setCurrent] = React.useState<{index:number;total:number;projectId:string}>()
  const [totalSelected, setTotalSelected] = React.useState(0)
  const [reports, setReports] = React.useState<LinguistMigrationProjectReport[]>([])
  const [errors, setErrors] = React.useState<Record<string,string>>({})
  const [message, setMessage] = React.useState('')
  const [phaseProgress, setPhaseProgress] = React.useState<LinguistMigrationProgress>()
  const [progressError, setProgressError] = React.useState('')

  React.useEffect(() => onRunningChange(running), [running, onRunningChange])

  React.useEffect(() => { setScan(undefined); setSelected(new Set()); setReports([]); setErrors({}); setMessage(''); setPhaseProgress(undefined); setProgressError(''); setTotalSelected(0) }, [workspaceId])

  const changeRoot = (value: string) => { setLegacyRootPath(value); setScan(undefined); setSelected(new Set()); setReports([]); setErrors({}); setTotalSelected(0) }
  const chooseRoot = async () => {
    setRunning(true)
    try { const value = await onPickDirectory(workspaceId); if (value !== null) changeRoot(value) }
    catch (error) { setMessage(String(error)) }
    finally { setRunning(false) }
  }

  const scanRoot = async (event: React.FormEvent) => {
    event.preventDefault()
    if (!workspaceId) return
    setRunning(true)
    setScan(undefined)
    setSelected(new Set())
    setReports([])
    setErrors({})
    setTotalSelected(0)
    setMessage('')
    setProgressError('')
    try {
      const result = await required<LinguistMigrationWorkspaceScanResult>('linguistLegacyMigrationScan', { workspaceId, legacyRootPath: legacyRootPath.trim() })
      setScan(result)
      setSelected(new Set(result.projects.map((project) => project.projectId)))
    } catch (error) { setMessage(String(error)) }
    finally { setRunning(false) }
  }

  const importSelected = async () => {
    if (!scan || !workspaceId || selected.size === 0 || running) return
    const projectIds = scan.projects.map((project) => project.projectId).filter((id) => selected.has(id))
    setRunning(true)
    setReports([])
    setErrors({})
    setMessage('')
    setPhaseProgress(undefined)
    setProgressError('')
    setTotalSelected(projectIds.length)
    let closeProgress: (() => void) | undefined
    try {
      closeProgress = await subscribeMigration(workspaceId, scan.scanId, setPhaseProgress, (error) => setProgressError(String(error)))
      for (const [index, projectId] of projectIds.entries()) {
        setCurrent({ index: index + 1, total: projectIds.length, projectId })
        setPhaseProgress(undefined)
        try {
          const result = await required<LinguistMigrationReport>('linguistLegacyMigrationImport', {
            workspaceId, scanId: scan.scanId, projectIds: [projectId], options: { externalSource, salvageOrphan },
          })
          setReports((currentReports) => [...currentReports, ...result.projects])
          if (result.projects.some((project) => !project.targetConflict && (project.disposition === 'imported' || project.disposition === 'partial' || project.disposition === 'archived-only'))) onImported()
        } catch (error) { setErrors((currentErrors) => ({ ...currentErrors, [projectId]: String(error) })) }
      }
    } catch (error) { setTotalSelected(0); setMessage(`${t('迁移进度连接未就绪，未开始导入。')} ${String(error)}`) }
    finally {
      closeProgress?.()
      setCurrent(undefined)
      setPhaseProgress(undefined)
      setRunning(false)
    }
  }

  return <section className={styles.panel} aria-label={t('旧 LA 数据根迁移')}>
    <h2>{t('旧 LA 数据根迁移')}</h2>
    <p>{t('先将旧数据根的副本放在所选 DSH Workspace 内。扫描只读；导入逐项目执行并逐项目验证。旧聊天保留为只读转录。')}</p>
    <form className={styles.form} onSubmit={(event) => void scanRoot(event)}>
      <label>{t('Workspace 内旧数据根相对目录')}<Input required disabled={running} value={legacyRootPath} onChange={(event) => changeRoot(event.target.value)} placeholder="." /></label>
      <Button variant="outline" type="button" size="sm" disabled={!workspaceId || running} onClick={() => void chooseRoot()}>{t('选择目录')}</Button>
      <Button variant="outline" type="submit" size="sm" disabled={!workspaceId || running || !legacyRootPath.trim()}>{t('扫描旧数据根')}</Button>
    </form>
    {message && <p role="alert">{message}</p>}
    {scan && <>
      <p>{t('源 schema {version} · {projects} 项目 · {batches} 批次 · {segments} 段', { version: scan.schemaVersion, projects: scan.totals.projects, batches: scan.totals.batches, segments: scan.totals.segments })}</p>
      {scan.health.map((signal, index) => <p key={index} className={signal.severity === 'error' ? styles.warning : undefined}>{signal.severity} · {signal.message}</p>)}
      {scan.projects.length === 0 ? <p>{t('该数据根中没有可迁移项目。')}</p> : <>
        <div className={styles.projects}>{scan.projects.map((project) => <div key={project.projectId} className={styles.project}>
          <Checkbox disabled={running} checked={selected.has(project.projectId)} label={project.name} onChange={() => setSelected((currentSelected) => { const next = new Set(currentSelected); if (next.has(project.projectId)) next.delete(project.projectId); else next.add(project.projectId); return next })} />
          <span><code>{project.projectId}</code><small>{project.sourceLocale ?? '?'} → {project.targetLocale ?? '?'} · {project.batches} {t('批次')} · {project.segments} {t('段')} · TM {project.tmEntries ?? '?'} · TB {project.termEntries ?? '?'}{project.chatPresent ? ` · ${t('含聊天记录')}` : ''}{project.orphan ? ` · ${salvageOrphan ? t('将抢救导入') : t('将隔离（零写入）')}` : ''}</small>{project.health.map((signal, index) => <small key={index} className={signal.severity === 'error' ? styles.warning : undefined}>{signal.severity} · {signal.message}</small>)}</span>
        </div>)}</div>
        <div className={styles.options}>
          <label><input type="radio" name="legacy-external-source" disabled={running} checked={externalSource === 'copy'} onChange={() => setExternalSource('copy')} />{t('复制外部源文字节（默认）')}</label>
          <label><input type="radio" name="legacy-external-source" disabled={running} checked={externalSource === 'reference'} onChange={() => setExternalSource('reference')} />{t('只保留外部源文引用')}</label>
          {scan.projects.some((project) => project.orphan) && <Checkbox disabled={running} checked={salvageOrphan} onChange={setSalvageOrphan} label={t('抢救无清单的孤儿项目')} />}
        </div>
        <Button variant="outline" size="sm" disabled={running || selected.size === 0} onClick={() => void importSelected()}>{t('导入所选项目 {count} 个', { count: selected.size })}</Button>
      </>}
    </>}
    {current && <p role="status">{t('正在导入并验证 {index}/{total}：{id}', { index: current.index, total: current.total, id: current.projectId })}</p>}
    {current && phaseProgress?.projectId === current.projectId && <p role="status">{phaseProgress.phase === 'import' ? t('Host 正在导入当前项目') : t('Host 正在回读验证当前项目')}</p>}
    {progressError && <p role="alert">{t('迁移进度连接中断；各项目最终结果仍以导入报告为准。')} {progressError}</p>}
    {totalSelected > 0 && <div role="status"><progress value={reports.length + Object.keys(errors).length} max={totalSelected} /><span>{t('逐项目请求已完成 {completed}/{total}', { completed: reports.length + Object.keys(errors).length, total: totalSelected })}</span></div>}
    {Object.entries(errors).map(([projectId, error]) => <p role="alert" key={projectId}>{projectId} · {error}</p>)}
    {reports.length > 0 && <section aria-label={t('逐项目迁移报告')}><h3>{t('逐项目迁移报告')}</h3>{reports.map((report) => <details key={report.legacyProjectId} className={styles.report} open={report.verify.status === 'failed' || report.disposition === 'error'}>
      <summary>{report.projectName} · {report.disposition} · {t('验证')} {report.verify.status}{report.targetConflict ? ` · ${t('目标已存在，本次未写入')}` : ''}</summary>
      <p>{t('新项目')} {report.newProjectId} · {report.totals.assets} {t('批次')} · {report.totals.segments} {t('段')} · TM {report.totals.tmImported} · TB {report.totals.termsImported} · QA {report.totals.qaOpen}/{report.totals.qaWaived}</p>
      {report.refusal && <p role="alert">{t('隔离原因')}：{report.refusal.reason}</p>}
      {report.transcript && <p>{t('只读聊天转录')}：{report.transcript.path} · {report.transcript.sessions} Sessions · {report.transcript.rows} {t('行')} · SHA-256 {report.transcript.sha256}</p>}
      {report.verify.checks.map((check) => <p key={check.id} className={check.ok ? undefined : styles.warning}>{check.ok ? '✓' : '✗'} {check.id} · {check.detail}</p>)}
      {report.notes.map((note, index) => <p key={index}>{note}</p>)}
      {report.rollback.map((step, index) => <p key={index}>{t('回滚指引')}：{step}</p>)}
    </details>)}</section>}
  </section>
}
