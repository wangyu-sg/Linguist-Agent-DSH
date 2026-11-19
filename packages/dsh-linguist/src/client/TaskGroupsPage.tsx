import * as React from 'react'
import { Button, Input } from '@deepseek-ai/dsh-client-ui-primitives'
import type { TaskGroup, TaskGroupChange } from '@linguist/domain-service/contracts'
import { required, subscribeProject } from './api'
import { BatchImport } from './BatchImport'
import { useT } from './ui-locale'
import styles from './ProjectsPage.module.css'

type Batch = { id: string; taskGroupId: string; name: string; kind?: 'browser' | 'working-copy' }
type Contents = { groups: TaskGroup[]; batches: Batch[] }

export function TaskGroupsPage({ project, initialGroup, onBack, onLibrary, onSession, onOpenBatch }: {
  project: { id: string; name: string; archivedAt?: string }
  initialGroup?: TaskGroup
  onBack: () => void
  onOpenBatch: (group: TaskGroup, assetId: string) => Promise<void>
  onLibrary: (group: TaskGroup) => void
  onSession: (group: TaskGroup) => Promise<void>
}) {
  const t = useT()
  const [contents, setContents] = React.useState<Contents>({ groups: [], batches: [] })
  const [groupId, setGroupId] = React.useState(initialGroup?.id ?? 'ungrouped')
  const [name, setName] = React.useState('')
  const [includeArchived, setIncludeArchived] = React.useState(initialGroup?.archived ?? false)
  const [selected, setSelected] = React.useState<string[]>([])
  const [destination, setDestination] = React.useState('')
  const [message, setMessage] = React.useState('')
  const [error, setError] = React.useState('')
  const [busy, setBusy] = React.useState(false)
  const [pendingMapping, setPendingMapping] = React.useState(false)
  const [importing, setImporting] = React.useState(false)
  const sequence = React.useRef(0)
  const reload = React.useCallback(async () => {
    const request = ++sequence.current
    const result = await required<Contents>('linguistTaskGroups', { projectId: project.id, includeBatches: true })
    if (request === sequence.current) setContents(result)
  }, [project.id])
  React.useEffect(() => {
    const read = () => { void reload().catch(error => setError(String(error))) }
    read()
    return subscribeProject(project.id, 0, read, read)
  }, [project.id, reload])
  const change = async (change: TaskGroupChange) => {
    setBusy(true); setError('')
    try {
      const result = await required<Contents>('linguistTaskGroups', { projectId: project.id, change, includeBatches: true })
      sequence.current++; setContents(result); setSelected([]); setName('')
      if (change.action === 'create') setGroupId(result.groups.find(group => group.name === change.name.trim())!.id)
      if (change.action === 'delete' || change.action === 'archive') setGroupId('ungrouped')
    } catch (cause) { setError(String(cause)) } finally { setBusy(false) }
  }
  const group = contents.groups.find(group => group.id === groupId)
  const readOnly = Boolean(project.archivedAt || group?.archived)
  return <main className={styles.page}><div className={styles.content}>
    <header className={styles.heading}><div><Button variant="ghost" size="sm" disabled={busy || importing || pendingMapping} onClick={onBack}>{t('返回项目')}</Button><h1>{project.name} / {t('任务组')}</h1></div></header>
    {message && <p role="status">{message}</p>}
    {error && <p role="alert">{error}</p>}
    <fieldset className={styles.groupControls} disabled={busy || importing || pendingMapping}>
      <label>{t('任务组')} <select value={groupId} onChange={event => { setGroupId(event.target.value); setMessage(''); setName(''); setSelected([]); setDestination('') }}>
        {contents.groups.filter(item => includeArchived || !item.archived).map(item => <option value={item.id} key={item.id}>{item.name} ({item.batchCount}){item.archived && ' · ' + t('已归档')}</option>)}
      </select></label>
      <label><input type="checkbox" checked={includeArchived} onChange={event => { setIncludeArchived(event.target.checked); if (group?.archived) setGroupId('ungrouped') }} />{t('显示已归档')}</label>
      {!project.archivedAt && <div className={styles.toolbar}><Input aria-label={t('任务组名称')} placeholder={t('任务组名称')} value={name} onChange={event => setName(event.target.value)} />
        <Button variant="outline" size="sm" disabled={!name.trim()} onClick={() => void change({ action: 'create', name })}>{t('新建任务组')}</Button>
        {group && group.id !== 'ungrouped' && <><Button variant="outline" size="sm" disabled={!name.trim() || readOnly} onClick={() => void change({ action: 'rename', id: group.id, name })}>{t('改名')}</Button>
          <Button variant="outline" size="sm" onClick={() => void change({ action: group.archived ? 'restore' : 'archive', id: group.id })}>{t(group.archived ? '恢复' : '归档')}</Button>
          <Button variant="outline" size="sm" disabled={group.batchCount > 0} onClick={() => void change({ action: 'delete', id: group.id })}>{t('删除空组')}</Button></>}
      </div>}
    </fieldset>
    {group && <section className={styles.section}><h2>{group.name}</h2><div className={styles.toolbar}>
      <Button variant="outline" size="sm" disabled={busy || importing || pendingMapping} onClick={() => onLibrary(group)}>{t('本组资料')}</Button>
      <Button variant="outline" size="sm" disabled={readOnly || busy || importing || pendingMapping} onClick={() => {
        setBusy(true); setError(''); setMessage('')
        void required('linguistSettingsClearCache', { projectId: project.id, taskGroupId: group.id })
          .then(() => setMessage(t('本组检索缓存已清理'))).catch(cause => setError(String(cause))).finally(() => setBusy(false))
      }}>{t('清理本组检索缓存')}</Button>
      <Button variant="outline" size="sm" disabled={readOnly || busy || importing || pendingMapping} onClick={() => { setBusy(true); void onSession(group).catch(cause => setError(String(cause))).finally(() => setBusy(false)) }}>{t('新建 LA 会话')}</Button>
    </div>
    <BatchImport key={group.id} projectId={project.id} taskGroupId={group.id} archived={readOnly} importing={importing} setImporting={setImporting} onAwaitingMapping={setPendingMapping} onImported={() => void reload().catch(cause => setError(String(cause)))} />
    <ul className={styles.groupBatches}>{contents.batches.filter(batch => batch.taskGroupId === group.id).map(batch => <li key={batch.id}><label><input type="checkbox" disabled={readOnly || busy} checked={selected.includes(batch.id)} onChange={event => setSelected(event.target.checked ? [...selected, batch.id] : selected.filter(id => id !== batch.id))} />{batch.name}</label>{batch.kind ? <small> · {t(batch.kind === 'browser' ? '浏览器' : '工作副本')}</small>
      : <Button variant="ghost" size="sm" disabled={busy || importing || pendingMapping || readOnly} onClick={() => { setBusy(true); void onOpenBatch(group, batch.id).catch(cause => setError(String(cause))).finally(() => setBusy(false)) }}>{t('打开 CAT')}</Button>}</li>)}</ul>
    {selected.length > 0 && <div className={styles.toolbar}><label>{t('移入后使用目标组资料')} <select value={destination} onChange={event => setDestination(event.target.value)}><option value="">{t('选择任务组')}</option>{contents.groups.filter(item => !item.archived && item.id !== group.id).map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
      <Button variant="outline" size="sm" disabled={!destination || busy} onClick={() => void change({ action: 'moveBatches', id: destination, batchIds: selected })}>{t('移动选中批次')}</Button></div>}
    </section>}
  </div></main>
}
