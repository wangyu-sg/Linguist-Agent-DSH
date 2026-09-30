import * as React from 'react'
import { Button } from '@deepseek-ai/dsh-client-ui-primitives'
import type { ISessions } from '@deepseek-ai/dsh-api-session-controller/client'
import type { LinguistProjectInfo } from '@linguist/domain-service/contracts'
import { getBinding, type LinguistBinding } from './api'
import { useT } from './ui-locale'
import styles from './ProjectsPage.module.css'

export function ProjectSessions({ sessions, projects, onOpen }: { sessions: ISessions; projects: readonly LinguistProjectInfo[]; onOpen: (binding: LinguistBinding) => Promise<void> }): React.ReactElement {
  const t = useT()
  const sessionSource = sessions.list
  const subscribe = React.useCallback((listener: () => void) => sessionSource.subscribe(listener), [sessionSource])
  const snapshotOf = React.useCallback(() => sessionSource.getSnapshot(), [sessionSource])
  const snapshot = React.useSyncExternalStore(subscribe, snapshotOf)
  const idsKey: string = snapshot.ids.join('\0')
  const [bindings, setBindings] = React.useState<LinguistBinding[]>([])
  const [loading, setLoading] = React.useState(true)
  const [errors, setErrors] = React.useState<string[]>([])
  const [refresh, setRefresh] = React.useState(0)
  const [opening, setOpening] = React.useState<string>()
  const [openError, setOpenError] = React.useState('')

  React.useEffect(() => {
    let live = true
    setLoading(true)
    const ids: string[] = idsKey ? idsKey.split('\0') : []
    Promise.allSettled(ids.map((id) => getBinding(id))).then((results) => {
      if (!live) return
      setBindings(results.flatMap((result) => result.status === 'fulfilled' && result.value?.projectId ? [result.value] : []))
      setErrors(results.flatMap((result, index) => result.status === 'rejected' ? [`${ids[index]}: ${String(result.reason)}`] : []))
      setLoading(false)
    })
    return () => { live = false }
  }, [idsKey, refresh])

  const groups = new Map<string, LinguistBinding[]>()
  for (const binding of bindings) {
    const group = groups.get(binding.projectId!) ?? []
    group.push(binding)
    groups.set(binding.projectId!, group)
  }
  const open = async (binding: LinguistBinding) => {
    setOpening(binding.sessionId)
    try { await onOpen(binding); setOpenError('') }
    catch (cause) { setOpenError(String(cause)) }
    finally { setOpening(undefined) }
  }

  return <section className={styles.sessionDisclosure} aria-label={t('项目会话')}>
    <details>
      <summary>{t('项目会话')}</summary>
      <div className={styles.sessionGroups}>
        {snapshot.phase === 'pending' || loading ? <p role="status">{t('正在读取会话…')}</p> : groups.size === 0 && <p>{t('当前没有项目会话。')}</p>}
        {[...groups].map(([projectId, entries]) => {
          const project = projects.find((item) => item.id === projectId)
          return <div className={styles.sessionGroup} key={projectId}>
            <strong>{project?.name ?? t('项目已缺失')} {project?.archivedAt && <small>· {t('已归档，只读')}</small>}{!project && <small>· {projectId}</small>}</strong>
            {entries.sort((left, right) => (snapshot.byId[right.sessionId]?.updatedAt ?? 0) - (snapshot.byId[left.sessionId]?.updatedAt ?? 0)).map((binding) => {
              const session = snapshot.byId[binding.sessionId]
              const updatedAt = session ? new Date(session.updatedAt) : undefined
              return <div className={styles.sessionRow} key={binding.sessionId}>
                <span><span className={styles.sessionTitle} title={session?.displayTitle ?? binding.sessionId}>{session?.displayTitle ?? binding.sessionId}</span><small>{t({ general: '通用', translator: '译者', reviewer: '审校', proofreader: '校对' }[binding.role])} · {t({ cat: 'CAT', 'working-copy': '工作副本', browser: '浏览器' }[binding.workMode])}{updatedAt && <> · <time dateTime={updatedAt.toISOString()} title={updatedAt.toLocaleString()}>{updatedAt.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</time></>}</small></span>
                <Button variant="outline" size="sm" disabled={!project || opening === binding.sessionId} onClick={() => void open(binding)}>{project?.archivedAt ? t('只读打开') : t('打开会话')}</Button>
              </div>
            })}
          </div>
        })}
      </div>
    </details>
    <Button className={styles.sessionRefresh} variant="outline" size="sm" disabled={loading || snapshot.phase === 'pending'} onClick={() => { void sessions.refresh().then(() => setRefresh((value) => value + 1)).catch((cause: unknown) => setOpenError(String(cause))) }}>{t('刷新会话')}</Button>
    {errors.length > 0 && <p role="alert" className={styles.warning}>{t('有 {count} 个会话绑定读取失败：', { count: errors.length })} {errors.slice(0, 3).join('；')}</p>}
    {openError && <p role="alert" className={styles.warning}>{openError}</p>}
  </section>
}
