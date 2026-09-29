import * as React from 'react'
import { Button } from '@deepseek-ai/dsh-client-ui-primitives'
import type {
  LinguistScheduleCancelResult,
  LinguistScheduleHistoryResult,
  LinguistScheduleInfo,
  LinguistScheduleListResult,
} from '@linguist/domain-service/contracts'
import { required } from './api'
import { useT } from './ui-locale'
import styles from './Panels.module.css'

export function ScheduleManager({ sessionId, refresh, editable, onEdit }: { sessionId: string; refresh: number; editable: boolean; onEdit: (schedule: LinguistScheduleInfo) => void }): React.ReactElement {
  const t = useT()
  const [list, setList] = React.useState<LinguistScheduleListResult>()
  const [error, setError] = React.useState('')
  const [reload, setReload] = React.useState(0)
  const [cancelId, setCancelId] = React.useState<string>()
  const [busyId, setBusyId] = React.useState<string>()
  const [accepted, setAccepted] = React.useState<{ scheduleId: string; messageId: string }>()
  const [history, setHistory] = React.useState<LinguistScheduleHistoryResult>()
  const [historyId, setHistoryId] = React.useState<string>()
  const [historyBusy, setHistoryBusy] = React.useState(false)
  React.useEffect(() => {
    let live = true
    required<LinguistScheduleListResult>('linguistScheduleList', { sessionId })
      .then((value) => { if (live) { setList(value); setError('') } })
      .catch((cause: unknown) => { if (live) setError(String(cause)) })
    return () => { live = false }
  }, [sessionId, refresh, reload])

  const cancel = async (scheduleId: string) => {
    setBusyId(scheduleId)
    try {
      const result = await required<LinguistScheduleCancelResult>('linguistScheduleCancel', { sessionId, scheduleId })
      if (!result.cancelled) throw new Error(t('定时任务已不在原生计划表，请刷新核对。'))
      setCancelId(undefined)
      if (historyId === scheduleId) { setHistory(undefined); setHistoryId(undefined) }
      setReload((value) => value + 1)
    } catch (cause) { setError(String(cause)) }
    finally { setBusyId(undefined) }
  }

  const runNow = async (schedule: LinguistScheduleInfo) => {
    setBusyId(schedule.scheduleId)
    setAccepted(undefined)
    try {
      const result = await required<{ scheduleId: string; messageId: string; status: 'accepted'; sessionId: string }>('linguistScheduleRunNow', {
        sessionId, scheduleId: schedule.scheduleId, expectedVersion: schedule.version,
      })
      if (result.status !== 'accepted' || result.sessionId !== sessionId || result.scheduleId !== schedule.scheduleId || !result.messageId) throw new Error(t('Host 立即运行回执与当前任务不一致。'))
      setAccepted({ scheduleId: result.scheduleId, messageId: result.messageId })
      setError('')
      setReload((value) => value + 1)
    } catch (cause) { setError(String(cause)) }
    finally { setBusyId(undefined) }
  }

  const loadHistory = async (scheduleId: string, before?: string) => {
    setHistoryBusy(true)
    try {
      const next = await required<LinguistScheduleHistoryResult>('linguistScheduleHistory', { sessionId, scheduleId, limit: 50, ...(before ? { before } : {}) })
      setHistoryId(scheduleId)
      setHistory((current) => before && current?.scheduleId === scheduleId ? { ...next, records: [...current.records, ...next.records] } : next)
      setError('')
    } catch (cause) { setError(String(cause)) }
    finally { setHistoryBusy(false) }
  }

  return <section className={styles.scheduleManager} aria-label={t('Linguist 专用定时任务')}>
    <div className={styles.toolbar}><h3>{t('Linguist 专用定时任务')}</h3><Button variant="outline" size="sm" onClick={() => setReload((value) => value + 1)}>{t('刷新')}</Button></div>
    <p>{t('下方到期和历史仅是 DSH 原生投递记录，不代表专业任务完成或外部平台已确认。')}</p>
    {error && <p role="alert">{error}</p>}
    {!list && !error && <p role="status">{t('正在读取定时任务…')}</p>}
    {list?.items.length === 0 && <p>{t('此会话没有 Linguist 专用定时任务。')}</p>}
    {list?.items.map((schedule) => <article key={schedule.scheduleId} className={styles.item}>
      <div className={styles.toolbar}><strong>{schedule.title}</strong><span>{t(schedule.limitReached ? '已达到执行次数上限' : schedule.status === 'active' ? '运行中' : '未激活')}</span><span>{t(schedule.authorizationStatus === 'ready' ? '授权快照有效' : schedule.authorizationStatus === 'changed' ? '授权范围已变化，需编辑重验' : '更新待确认')}</span></div>
      <p>{schedule.prompt}</p>
      <p>{t('已结束的执行次数')}：{schedule.runCount}{schedule.maxRuns !== undefined && ` / ${schedule.maxRuns}`}</p>
      <p>{t('岗位')}：{t({ general: '通用', translator: '译者', reviewer: '审校', proofreader: '校对' }[schedule.role])} · {t('执行范围')}：{t({ project: '全项目', asset: '当前批次', segments: '勾选句段' }[schedule.scope])} · {t('调度方式')}：{t({ after: '延迟一次', at: '指定时间一次', every: '按间隔重复', daily: '每天', weekly: '每周', cron: 'Cron' }[schedule.kind])}</p>
      {!schedule.limitReached && <p>{t('下次到期')}：{new Date(schedule.scheduledAt).toLocaleString()}{schedule.lastDeliveredAt && <> · {t('最近投递')}：{new Date(schedule.lastDeliveredAt).toLocaleString()}</>}</p>}
      <div className={styles.toolbar}>
        <Button variant="outline" size="sm" disabled={!editable || schedule.status !== 'active'} onClick={() => onEdit(schedule)}>{t('编辑并重新核验')}</Button>
        <Button variant="outline" size="sm" disabled={!editable || schedule.status !== 'active' || schedule.authorizationStatus !== 'ready' || busyId === schedule.scheduleId} onClick={() => void runNow(schedule)}>{t('立即运行')}</Button>
        <Button variant="outline" size="sm" disabled={historyBusy} onClick={() => void loadHistory(schedule.scheduleId)}>{t('执行与投递历史')}</Button>
        {!schedule.limitReached && (cancelId === schedule.scheduleId ? <><span>{t('取消将停止后续投递，并删除原生调度历史。')}</span><Button variant="outline" size="sm" disabled={busyId === schedule.scheduleId} onClick={() => void cancel(schedule.scheduleId)}>{t('确认取消任务')}</Button><Button variant="outline" size="sm" onClick={() => setCancelId(undefined)}>{t('保留任务')}</Button></>
          : <Button variant="outline" size="sm" onClick={() => setCancelId(schedule.scheduleId)}>{t('取消任务')}</Button>)}
      </div>
      {accepted?.scheduleId === schedule.scheduleId && <p role="status">{t('已受理立即运行请求，消息 {id} 已交给 DSH Session；专业任务是否完成需查看实际结果。', { id: accepted.messageId })}</p>}
      {historyId === schedule.scheduleId && history && <div className={styles.callout}>
        <strong>{t('最近执行记录')}</strong>
        <p>{t('执行状态来自 DSH 会话结束事件；专业完成情况请查看对应岗位决策。')}</p>
        {history.executions.length === 0 && <p>{t('暂无执行记录。')}</p>}
        {history.executions.map(run => <p key={run.messageId}>{new Date(run.admittedAt).toLocaleString()} · {t('轮次')} {run.turn} · {t(({ unfinished: '尚无结束记录', completed: '执行结束', aborted: '已取消', blocked: '执行受阻', error: '执行失败', 'max-tokens': '达到输出上限', interrupted: '执行中断', forked: '历史分支边界' } as Record<string, string>)[run.outcome] ?? run.outcome)}{run.endedAt && <> · {new Date(run.endedAt).toLocaleString()}</>}{run.failure && <> · {t('错误代码')}：<code>{run.failure.code}</code>{run.failure.status !== undefined && ` (HTTP ${run.failure.status})`}</>}</p>)}
        <strong>{t('原生投递记录')}</strong>
        {history.records.length === 0 && <p>{t('暂无投递记录。')}</p>}
        {history.records.map((record) => <p key={record.messageId}>{t('到期')} {new Date(record.scheduledAt).toLocaleString()} · {t('投递')} {new Date(record.deliveredAt).toLocaleString()} · {record.messageId}</p>)}
        {history.earlierRecordsPruned && <p>{t('更早的原生投递记录已清理。')}</p>}
        {history.earlierRecordsUnavailable && <p>{t('更早的原生投递记录无法读取。')}</p>}
        {history.nextBefore && <Button variant="outline" size="sm" disabled={historyBusy} onClick={() => void loadHistory(schedule.scheduleId, history.nextBefore)}>{t('读取更早记录')}</Button>}
      </div>}
    </article>)}
  </section>
}
