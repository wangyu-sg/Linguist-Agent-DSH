import * as React from 'react'
import { Button, Checkbox, Input, Modal } from '@deepseek-ai/dsh-client-ui-primitives'
import type {
  LinguistLatestRunSummaryResult,
  LinguistJobProgressResult,
  LinguistProjectMutationEvent,
  LinguistRunUndoResult,
  LinguistScheduleCreateRequest,
  LinguistScheduleCreateResult,
  LinguistScheduleInfo,
  LinguistScheduleListResult,
  LinguistScheduleNotificationTarget,
  LinguistScheduleTiming,
  LinguistScheduleUpdateRequest,
  LinguistStageDecisionCoverage,
  LinguistTurnContextV1,
  LinguistWorkflowStage,
} from '@linguist/domain-service/contracts'
import { required } from './api'
import { useT } from './ui-locale'
import { stageCompletionLabel, stageName } from './workflow-ui'
import { ScheduleManager } from './ScheduleManager'
import styles from './Panels.module.css'

function ScheduledAgentTaskForm({ projectId, sessionId, assetId, selectedSegmentIds, uiRevision, editing, destinations, onSaved, onCancelEdit }: {
  projectId: string
  sessionId: string
  assetId?: string
  selectedSegmentIds: string[]
  uiRevision: number
  editing?: LinguistScheduleInfo
  destinations?: LinguistScheduleListResult['notificationDestinations']
  onSaved: (result: LinguistScheduleCreateResult) => void
  onCancelEdit: () => void
}): React.ReactElement {
  const t = useT()
  const [maxRuns, setMaxRuns] = React.useState(editing?.maxRuns === undefined ? '' : String(editing.maxRuns))
  const [sessionMode, setSessionMode] = React.useState<'daily' | 'reuse'>(editing?.sessionMode ?? 'daily')
  const [notificationTargets, setNotificationTargets] = React.useState<LinguistScheduleNotificationTarget[]>(editing?.notificationTargets ?? [])
  const [title, setTitle] = React.useState(editing?.title ?? '')
  const [prompt, setPrompt] = React.useState(editing?.prompt ?? '')
  const [scope, setScope] = React.useState<'project' | 'asset' | 'segments'>(editing?.scope ?? 'project')
  const [editedAssetId, setScopeAssetId] = React.useState(editing?.scopeSnapshot.assetId ?? assetId)
  const [editedSegmentIds, setScopeSegmentIds] = React.useState(editing?.scopeSnapshot.selectedSegmentIds ?? selectedSegmentIds)
  const scopeAssetId = editing ? editedAssetId : assetId
  const scopeSegmentIds = editing ? editedSegmentIds : selectedSegmentIds
  const [kind, setKind] = React.useState<LinguistScheduleTiming['kind']>(editing?.timing.kind ?? 'after')
  const [seconds, setSeconds] = React.useState(editing?.timing.kind === 'after' || editing?.timing.kind === 'every' ? String(editing.timing.seconds) : '3600')
  const [at, setAt] = React.useState(() => {
    if (editing?.timing.kind !== 'at') return ''
    const date = new Date(editing.timing.at)
    return new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 16)
  })
  const [time, setTime] = React.useState(editing?.timing.kind === 'daily' || editing?.timing.kind === 'weekly' ? editing.timing.time.slice(0, 8) : '09:00:00')
  const [timeZone, setTimeZone] = React.useState(editing?.timing.kind === 'daily' || editing?.timing.kind === 'weekly' || editing?.timing.kind === 'cron' ? editing.timing.timeZone : Intl.DateTimeFormat().resolvedOptions().timeZone)
  const [weekdays, setWeekdays] = React.useState<number[]>(editing?.timing.kind === 'weekly' ? editing.timing.weekdays : [1, 2, 3, 4, 5])
  const [expression, setExpression] = React.useState(editing?.timing.kind === 'cron' ? editing.timing.expression : '0 9 * * 1-5')
  const [created, setCreated] = React.useState<LinguistScheduleCreateResult>()
  const [error, setError] = React.useState('')
  const [busy, setBusy] = React.useState(false)

  const create = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (busy) return
    setCreated(undefined)
    setError('')
    try {
      if (!title.trim() || !prompt.trim()) throw new Error(t('填写任务名称和任务描述。'))
      if (scope !== 'project' && !scopeAssetId) throw new Error(t('先选择一个工作批次。'))
      if (scope === 'segments' && (scopeSegmentIds.length === 0 || scopeSegmentIds.length > 100)) throw new Error(t('请选择 1–100 个句段。'))
      let timing: LinguistScheduleTiming
      if (kind === 'after' || kind === 'every') {
        const value = Number(seconds)
        if (!Number.isSafeInteger(value) || value < 60) throw new Error(t('延迟或间隔须至少 60 秒。'))
        timing = { kind, seconds: value }
      } else if (kind === 'at') {
        const value = new Date(at)
        if (!at || !Number.isFinite(value.getTime()) || value.getTime() - Date.now() < 60_000) throw new Error(t('选择至少一分钟后的时间。'))
        timing = { kind, at: value.toISOString() }
      } else if (kind === 'daily') timing = { kind, time: time.length === 5 ? `${time}:00` : time, timeZone: timeZone.trim() }
      else if (kind === 'weekly') {
        if (weekdays.length === 0) throw new Error(t('至少选择一个星期。'))
        timing = { kind, time: time.length === 5 ? `${time}:00` : time, timeZone: timeZone.trim(), weekdays }
      } else timing = { kind, expression: expression.trim(), timeZone: timeZone.trim() }
      const turnContext: LinguistTurnContextV1 | undefined = scope === 'project' ? undefined : {
        schemaVersion: 1,
        projectId,
        assetId: scopeAssetId,
        selectedSegmentIds: scope === 'segments' ? [...scopeSegmentIds] : [],
        capturedAt: new Date().toISOString(),
        uiRevision,
      }
      setBusy(true)
      const input: LinguistScheduleCreateRequest = {
        sessionId, projectId, title: title.trim(), prompt: prompt.trim(), executeAtDue: true, sessionMode, notificationTargets,
        scope, ...(turnContext ? { turnContext } : {}), timing, ...(maxRuns === '' ? {} : { maxRuns: Number(maxRuns) }),
      }
      const next = editing
        ? await required<LinguistScheduleCreateResult>('linguistScheduleUpdate', { ...input, scheduleId: editing.scheduleId, expectedVersion: editing.version } satisfies LinguistScheduleUpdateRequest)
        : await required<LinguistScheduleCreateResult>('linguistScheduleCreate', input)
      setCreated(next)
      onSaved(next)
    } catch (cause) { setError(String(cause)) }
    finally { setBusy(false) }
  }

  return <form className={styles.scheduleForm} onSubmit={(event) => void create(event)}>
    <h3>{t(editing?.pausedAfterFailures ? '重新核验并恢复' : editing ? '编辑专业定时任务' : '创建专业定时任务')}</h3>
    <p>{t('到期在任务专用的 DSH 会话执行，创建时继承来源模型和权限；需要登录或授权时会停在原生交互。')}</p>
    {editing && <p>{t('编辑沿用当前任务的原生调度规则与冻结范围；保存时按当前项目和岗位重新核验授权。')}{kind === 'after' && ` ${t('若修改延迟秒数，会从保存时重新计时并转换为绝对时间。')}`}</p>}
    <fieldset><legend>{t('飞书通知')}</legend>
      <p>{t('仅向勾选目标发送任务名称、本轮模型输出和执行状态。目标凭据在 DSH 原生 Linguist 插件配置中设置。')}</p>
      {destinations?.length === 0 && <p>{t('尚未配置通知目标。')}</p>}
      {destinations?.map(destination => {
        const selected = notificationTargets.find(item => item.destinationId === destination.id)
        return <div key={destination.id} className={styles.form}>
          <Checkbox label={destination.label} checked={!!selected} onChange={checked => setNotificationTargets(previous => checked ? [...previous, { destinationId: destination.id, trigger: 'always' }] : previous.filter(item => item.destinationId !== destination.id))} />
          {selected && <select aria-label={`${t('通知条件')} · ${destination.label}`} value={selected.trigger} onChange={event => setNotificationTargets(previous => previous.map(item => item.destinationId === destination.id ? { ...item, trigger: event.target.value as LinguistScheduleNotificationTarget['trigger'] } : item))}>
            <option value="always">{t('每次执行结束')}</option><option value="success">{t('仅正常结束')}</option><option value="error">{t('仅未成功结束')}</option>
          </select>}
        </div>
      })}
      {destinations && notificationTargets.filter(target => !destinations.some(item => item.id === target.destinationId)).map(target => <p key={target.destinationId} role="alert">{t('通知目标已不可用')} · {target.destinationId} <Button type="button" variant="outline" size="sm" onClick={() => setNotificationTargets(previous => previous.filter(item => item.destinationId !== target.destinationId))}>{t('移除')}</Button></p>)}
    </fieldset>
    <label>{t('任务名称')}<Input required value={title} onChange={(event) => setTitle(event.target.value)} /></label>
    <label>{t('任务描述')}<textarea required value={prompt} onChange={(event) => setPrompt(event.target.value)} /></label>
    <div className={styles.form}>
      <label>{t('最多执行次数（留空不限）')}<Input type="number" min="1" step="1" value={maxRuns} onChange={event => setMaxRuns(event.target.value)} /></label>
      <label>{t('任务会话')}<select value={sessionMode} onChange={event => setSessionMode(event.target.value as typeof sessionMode)}>
        <option value="daily">{t('每日新会话，同日复用')}</option>
        <option value="reuse">{t('持续复用任务会话')}</option>
      </select></label>
      <label>{t('执行范围')}<select value={scope} onChange={(event) => setScope(event.target.value as typeof scope)}>
        <option value="project">{t('全项目')}</option>
        <option value="asset" disabled={!scopeAssetId}>{t('当前批次')}</option>
        <option value="segments" disabled={!scopeAssetId || scopeSegmentIds.length === 0}>{t('勾选句段')}</option>
      </select></label>
      {scope !== 'project' && <span>{t('范围批次 ID')}：{scopeAssetId}</span>}
      {scope === 'segments' && <span>{t('范围句段 {count} 段', { count: scopeSegmentIds.length })}</span>}
      {editing && <Button variant="outline" type="button" size="sm" onClick={() => { setScopeAssetId(assetId); setScopeSegmentIds(selectedSegmentIds) }}>{t('改用当前工作台选区')}</Button>}
      <label>{t('调度方式')}<select value={kind} onChange={(event) => setKind(event.target.value as LinguistScheduleTiming['kind'])}>
        <option value="after">{t('延迟一次')}</option><option value="at">{t('指定时间一次')}</option>
        <option value="every">{t('按间隔重复')}</option><option value="daily">{t('每天')}</option>
        <option value="weekly">{t('每周')}</option><option value="cron">Cron</option>
      </select></label>
      {(kind === 'after' || kind === 'every') && <label>{t('秒数')}<Input type="number" min="60" step="1" value={seconds} onChange={(event) => setSeconds(event.target.value)} /></label>}
      {kind === 'at' && <label>{t('执行时间')}<Input type="datetime-local" value={at} onChange={(event) => setAt(event.target.value)} /></label>}
      {(kind === 'daily' || kind === 'weekly') && <label>{t('每天时间')}<Input type="time" step="1" value={time} onChange={(event) => setTime(event.target.value)} /></label>}
      {kind === 'weekly' && <fieldset className={styles.formFields}><legend>{t('星期')}</legend>{[1, 2, 3, 4, 5, 6, 7].map((day) => <Checkbox key={day} label={t(['一', '二', '三', '四', '五', '六', '日'][day - 1]!)} checked={weekdays.includes(day)} onChange={() => setWeekdays((current) => current.includes(day) ? current.filter((value) => value !== day) : [...current, day].sort())} />)}</fieldset>}
      {kind === 'cron' && <label>Cron<Input value={expression} onChange={(event) => setExpression(event.target.value)} /></label>}
      {(kind === 'daily' || kind === 'weekly' || kind === 'cron') && <label>{t('时区')}<Input value={timeZone} onChange={(event) => setTimeZone(event.target.value)} /></label>}
    </div>
    <div className={styles.toolbar}><Button variant="primary" type="submit" size="md" disabled={busy}>{busy ? t('正在保存…') : t(editing?.pausedAfterFailures ? '重新核验并恢复' : editing ? '保存并重新核验' : '创建到期执行任务')}</Button>{editing && <Button variant="outline" type="button" size="sm" onClick={onCancelEdit}>{t('取消编辑')}</Button>}</div>
    {created && <p role="status">{t(editing?.pausedAfterFailures ? '已恢复 DSH 调度' : editing ? '已更新 DSH 调度' : '已创建 DSH 调度')} {created.scheduleId} · {created.role} · {created.scope} · {created.scheduledAt}</p>}
    {error && <p role="alert">{error}</p>}
  </form>
}

export function RunPanel({ projectId, sessionId, assetId, selectedSegmentIds, uiRevision, workflowStage, archived, mutation, jobUpdates, onCancelRun, onChanged }: {
  projectId: string
  sessionId: string
  assetId?: string
  selectedSegmentIds: string[]
  uiRevision: number
  workflowStage: LinguistWorkflowStage
  archived: boolean
  mutation: number
  jobUpdates: ReadonlyMap<string, LinguistProjectMutationEvent>
  onCancelRun: () => Promise<void>
  onChanged: () => void
}): React.ReactElement {
  const t = useT()
  const [run, setRun] = React.useState<LinguistLatestRunSummaryResult>()
  const [coverage, setCoverage] = React.useState<LinguistStageDecisionCoverage>()
  const [undo, setUndo] = React.useState<LinguistRunUndoResult>()
  const [message, setMessage] = React.useState('')
  const [busy, setBusy] = React.useState(false)
  const [refresh, setRefresh] = React.useState(0)
  const [jobs, setJobs] = React.useState<ReadonlyMap<string, NonNullable<LinguistJobProgressResult['job']>>>(new Map())
  const [jobError, setJobError] = React.useState('')
  const [stopConfirm, setStopConfirm] = React.useState(false)
  const [stopping, setStopping] = React.useState(false)
  const [loadError, setLoadError] = React.useState('')
  const [scheduleRefresh, setScheduleRefresh] = React.useState(0)
  const [notificationDestinations, setNotificationDestinations] = React.useState<LinguistScheduleListResult['notificationDestinations']>()
  const [editingSchedule, setEditingSchedule] = React.useState<LinguistScheduleInfo>()
  const scheduleFormRef = React.useRef<HTMLDivElement>(null)
  React.useEffect(() => { if (editingSchedule) scheduleFormRef.current?.scrollIntoView({ block: 'nearest' }) }, [editingSchedule])

  React.useEffect(() => {
    let live = true
    const reads: [Promise<LinguistLatestRunSummaryResult>, Promise<LinguistStageDecisionCoverage | undefined>] = [
      required('linguistCatGetLatestRunSummary', { projectId }),
      assetId ? required('linguistProjectsGetStageCoverage', { projectId, assetId, workflowStage }) : Promise.resolve(undefined),
    ]
    Promise.all(reads).then(([latest, stage]) => {
      if (live) { setRun(latest); setCoverage(stage); setLoadError('') }
    }).catch((error: unknown) => { if (live) setLoadError(String(error)) })
    return () => { live = false }
  }, [projectId, assetId, workflowStage, mutation, refresh])

  React.useEffect(() => {
    let live = true
    setJobError('')
    // SSE provides current progress immediately; the scoped read reconciles final state after reconnect.
    setJobs(new Map([...jobUpdates].map(([jobId, event]) => [jobId, { jobId, sessionId, runId: event.runId ?? '', ...event.job! }])))
    Promise.all([...jobUpdates.keys()].map((jobId) => required<LinguistJobProgressResult>('linguistCatGetJob', { projectId, sessionId, jobId })))
      .then((results) => { if (live) setJobs(new Map(results.flatMap(({ job }) => job ? [[job.jobId, job] as const] : []))) })
      .catch((cause: unknown) => { if (live) setJobError(String(cause)) })
    return () => { live = false }
  }, [projectId, sessionId, jobUpdates, refresh, mutation])

  const stopRun = async () => {
    setStopping(true)
    try { await onCancelRun(); setStopConfirm(false); setRefresh((value) => value + 1); setMessage(t('停止请求已交给 DSH；请核对任务最终状态。')) }
    catch (cause) { setJobError(String(cause)) }
    finally { setStopping(false) }
  }

  const undoRun = async () => {
    const summary = run?.summary
    if (!summary?.canUndo || busy || archived) return
    setBusy(true)
    try {
      const result = await required<LinguistRunUndoResult>('linguistCatUndoLatestRun', {
        projectId, sessionId, expectedRunId: summary.runId,
      })
      setUndo(result)
      setMessage(t('撤销结果：{status}，已撤销 {reverted} 项，拒绝 {refused} 项', { status: result.status, reverted: result.reverted.length, refused: result.refused.length }))
      setRefresh((value) => value + 1)
      onChanged()
    } catch (error) { setMessage(String(error)) }
    finally { setBusy(false) }
  }

  return <section className={styles.panel} aria-label={t("岗位覆盖与运行记录")}>
    <div className={styles.toolbar}><strong>{t("岗位决策覆盖")}</strong><Button variant="ghost" size="sm" onClick={() => setRefresh((value) => value + 1)}>{t("刷新")}</Button></div>
    {loadError && <p role="alert">{loadError}</p>}
    {!assetId ? <p>{t("选择一个工作批次以查看当前岗位覆盖。")}</p> : !coverage && !loadError ? <p role="status">{t("正在读取覆盖…")}</p> : coverage &&
      <div className={styles.callout}><p>{t(stageName(workflowStage))} · {t({ in_progress: '决策进行中', complete: '决策覆盖完整', completed_with_blocks: '决策覆盖完整，仍有阻塞' }[coverage.status])}</p><p>{t("总计")} {coverage.total} · {t(stageCompletionLabel(workflowStage))} {coverage.confirmed} {t("· 原文无改动")} {coverage.unchanged} {t("· 已修订")} {coverage.corrected} {t("· 阻塞")} {coverage.blocked} {t("· 待决策")} {coverage.pending}</p><p>{t('阶段决策覆盖不等于正式交付完成；仍需处理 QA、建议与交付预检。')}</p></div>}
    <div className={styles.toolbar}><h3>{t('当前会话的专业任务')}</h3><Button variant="outline" size="sm" disabled={stopping} onClick={() => setStopConfirm(true)}>{t('停止当前会话运行')}</Button></div>
    <p className={styles.notice}>{t('停止操作会中止整个当前会话的活动回合，包括正在执行的工具。')}</p>
    {jobError && <p role="alert">{jobError}</p>}
    {[...jobs.values()].map((job) => <article className={styles.item} key={job.jobId} aria-label={`${t('专业任务')} ${job.jobId}`}>
      <div className={styles.toolbar}><strong>{t('专业任务')} {job.jobId}</strong><span>{t({ pending: '等待中', running: '运行中', paused: '已暂停', completed: '执行结束', failed: '执行失败', cancelled: '已取消' }[job.status])}</span></div>
      <progress className={styles.jobProgress} max={Math.max(1, job.total)} value={job.cursor} aria-label={t('专业任务进度')} />
      <p>{t('已处理')} {job.cursor}/{job.total} · {t('完成')} {job.completed} · {t('失败')} {job.failed}</p>
    </article>)}
    <Modal className={styles.confirmModal} contentClassName={styles.confirmModalContent} open={stopConfirm} onClose={() => { if (!stopping) setStopConfirm(false) }} title={t('停止当前会话运行')} closeLabel={t('取消')} footer={<><Button variant="ghost" size="sm" disabled={stopping} onClick={() => setStopConfirm(false)}>{t('取消')}</Button><Button variant="primary" size="sm" disabled={stopping} onClick={() => void stopRun()}>{stopping ? t('正在停止…') : t('确认停止')}</Button></>}><p>{t('停止操作会中止整个当前会话的活动回合，包括正在执行的工具。')}</p>{jobError && <p role="alert">{jobError}</p>}</Modal>
    <h3>{t("最近一次 Agent 运行")}</h3>
    {!run && !loadError ? <p role="status">{t("正在读取运行记录…")}</p> : run && !run.summary ? <p>{t("此项目尚无可展示的运行记录。")}</p> : run?.summary &&
      <div className={styles.item}>
        <strong>Run {run.summary.runId}</strong>
        {run.summary.job && <p>Job {run.summary.job.jobId} · {run.summary.job.status} {t("· 完成")} {run.summary.job.completedSegments}/{run.summary.job.scopedSegments} {t("· 失败")} {run.summary.job.failedSegments}</p>}
        <p>{t("提议")} {run.summary.changes.proposalsCreated} {t("· QA 新增")} {run.summary.changes.qaFindingsCreated} {t("· QA 更新")} {run.summary.changes.qaFindingsUpdated} {t("· 文件记录")} {run.summary.changes.filesTouched} {t("· 已撤销")} {run.summary.changes.undone}</p>
        <Button variant="outline" size="sm" disabled={archived || busy || !run.summary.canUndo} onClick={() => void undoRun()}>{t("撤销本次可逆 CAT 变更")}</Button>
      </div>}
    {undo?.refused.map((entry) => <p role="alert" key={`${entry.entityType}:${entry.entityId}`}>{entry.entityType} {entry.entityId}：{entry.reason}</p>)}
    {!archived && <div ref={scheduleFormRef}><ScheduledAgentTaskForm key={`${editingSchedule?.scheduleId ?? 'new'}:${editingSchedule?.version ?? ''}`} projectId={projectId} sessionId={sessionId} assetId={assetId} selectedSegmentIds={selectedSegmentIds} uiRevision={uiRevision} editing={editingSchedule} destinations={notificationDestinations} onSaved={(result) => { setMessage(t(editingSchedule ? '专用定时任务已更新并重新核验。' : '专用定时任务已创建。')); setEditingSchedule(undefined); setScheduleRefresh((value) => value + 1) }} onCancelEdit={() => setEditingSchedule(undefined)} /></div>}
    <ScheduleManager onDestinations={setNotificationDestinations} sessionId={sessionId} refresh={scheduleRefresh} editable={!archived} onEdit={(schedule) => setEditingSchedule(schedule)} />
    {message && <p role="status">{message}</p>}
  </section>
}
