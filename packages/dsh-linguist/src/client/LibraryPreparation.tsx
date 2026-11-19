import * as React from 'react'
import { Button } from '@deepseek-ai/dsh-client-ui-primitives'
import type { TurnLocation } from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { LibraryPreparationStatus, SemanticProgress } from '@linguist/domain-service/contracts'
import { required, subscribeProject } from './api'
import { useT } from './ui-locale'
import styles from './Native.module.css'

export function SemanticProgressLine({ scope, progress }: { scope: string; progress: SemanticProgress }) {
  const t = useT()
  const stage = t(progress.phase === 'loading' ? '正在读取检索缓存' : progress.phase === 'matching' ? '正在匹配' : '正在准备')
  const counted = progress.phase === 'preparing' && progress.total > 0
  return <label className={styles.retrievalProgress}>
    <span>{scope} · {stage}</span>
    <progress aria-label={scope + ' · ' + stage} max={counted ? progress.total : undefined} value={counted ? progress.ready : undefined} />
    {counted && <span>{progress.ready.toLocaleString()} / {progress.total.toLocaleString()} ({Math.floor(progress.ready * 100 / progress.total)}%)</span>}
  </label>
}

export function LibraryPreparationTurnActions({ turn, sessionId }: { turn: TurnLocation; sessionId: string }) {
  const source = turn.data.source('linguist-library-preparation')
  const offers = React.useSyncExternalStore(source.subscribe, source.getSnapshot)
  return <>{offers?.map(offer => <LibraryPreparation key={offer.projectId} projectId={offer.projectId} groups={offer.groups}
    offerKey={'linguist:later:' + sessionId + ':' + turn.turn + ':' + offer.projectId} />)}</>
}

export function LibraryPreparation({ projectId, groups, offerKey, readOnly }: {
  projectId: string
  groups: Array<{ id: string; name: string; offeredAt?: number }>
  offerKey?: string
  readOnly?: boolean
}) {
  const t = useT()
  const [statuses, setStatuses] = React.useState<LibraryPreparationStatus[]>([])
  const [busy, setBusy] = React.useState(false)
  const [error, setError] = React.useState('')
  const [readError, setReadError] = React.useState('')
  const [deferred, setDeferred] = React.useState(() => !!offerKey && sessionStorage.getItem(offerKey) === 'later')
  const [revision, refresh] = React.useReducer((value: number) => value + 1, 0)
  const groupKey = JSON.stringify(groups.map(({ id, offeredAt }) => ({ id, offeredAt })))

  React.useEffect(() => {
    let live = true, request = 0
    let timer: ReturnType<typeof setTimeout>
    const scopes: Array<{ id: string; offeredAt?: number }> = JSON.parse(groupKey)
    const read = async () => {
      clearTimeout(timer)
      const sequence = ++request
      try {
        const result = await Promise.all(scopes.map(({ id: taskGroupId }) =>
          required<LibraryPreparationStatus>('linguistLibraryPreparationStatus', { projectId, taskGroupId })))
        if (!live || sequence !== request) return
        const visible = result.map((status, index) => {
          const offeredAt = scopes[index]!.offeredAt
          return offeredAt !== undefined && 'requestedAt' in status && status.requestedAt < offeredAt ? { phase: 'idle' } as const : status
        })
        setReadError('')
        setStatuses(visible)
        if (visible.some(status => status.phase === 'queued' || status.phase === 'running')) timer = setTimeout(read, 2500)
      } catch (cause) {
        if (!live || sequence !== request) return
        setReadError(String(cause))
        timer = setTimeout(read, 5000)
      }
    }
    const update = () => void read()
    update()
    const unsubscribe = !offerKey ? subscribeProject(projectId, 0, event => {
      if (event.kind === 'project-updated') update()
    }, update) : undefined
    window.addEventListener('focus', update)
    return () => {
      live = false
      clearTimeout(timer)
      unsubscribe?.()
      window.removeEventListener('focus', update)
    }
  }, [projectId, groupKey, offerKey, revision])

  const actionable = groups.filter((_group, index) => {
    const phase = statuses[index]?.phase
    return phase === 'idle' || phase === 'failed' || (phase === 'ready' && !offerKey)
  })
  const start = async () => {
    setError('')
    setBusy(true)
    const results = await Promise.allSettled(actionable.map(({ id }) =>
      required('linguistLibraryPrepare', { projectId, taskGroupId: id })))
    setError(results.flatMap(result => result.status === 'rejected' ? [String(result.reason)] : []).join(' · '))
    setBusy(false)
    refresh()
  }

  if (deferred) return <p className={styles.retrievalProgress}>{t('可稍后在项目资料页提前准备')}</p>
  const canStart = !readOnly && actionable.length > 0
  const waitingForChoice = !!offerKey && statuses.some(status => status.phase === 'idle')
  return <section className={styles.libraryPreparation} aria-label={t('背景资料准备')}>
    {waitingForChoice && <p>{t('已登记到 {groups}，可在后台提前准备语义检索。', { groups: groups.map(group => group.name || t('项目共用')).join('、') })}</p>}
    <div className={styles.libraryPreparationActions}>
      {canStart && <Button variant="outline" size="sm" type="button" disabled={busy} onClick={() => void start()}>{t(offerKey ? '现在准备' : '提前准备')}</Button>}
      {canStart && waitingForChoice && <Button variant="ghost" size="sm" type="button" disabled={busy} onClick={() => { sessionStorage.setItem(offerKey, 'later'); setDeferred(true) }}>{t('稍后')}</Button>}
    </div>
    {statuses.map((status, index) => {
      const group = groups[index]!
      const scope = (group.name || t('项目共用')) + ' · ' + t('背景资料准备')
      if (status.phase === 'running') return <SemanticProgressLine key={group.id} scope={scope} progress={status.progress} />
      if (status.phase === 'idle' || (status.phase === 'disabled' && index > 0)) return null
      const message = status.phase === 'disabled' ? t('请在 DSH 设置中开启语义关联')
        : status.phase === 'queued' ? t('等待后台准备')
        : status.phase === 'ready' ? (status.total ? t(offerKey ? '已准备 {count} 条背景资料' : '上次准备了 {count} 条背景资料', { count: status.total.toLocaleString() }) : t('此范围暂无可准备的背景资料'))
        : t('资料准备未完成：{error}', { error: status.error })
      return <p className={styles.retrievalProgress} key={group.id} role="status">{scope} · {message}</p>
    })}
    {(error || readError) && <p className={styles.contextError} role="alert">{error || readError}</p>}
  </section>
}
