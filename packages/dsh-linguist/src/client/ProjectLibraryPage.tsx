import * as React from 'react'
import { Button, Input, Modal } from '@deepseek-ai/dsh-client-ui-primitives'
import { LINGUIST_FILE_MAX_BYTES, type ProjectLibraryItem, type ProjectResource, type TaskGroup } from '@linguist/domain-service/contracts'
import { discardStagedFiles, required, stageFiles, subscribeProject } from './api'
import { PreviewView, type PreviewRequest } from './PreviewView'
import { LibraryPreparation } from './LibraryPreparation'
import { useT } from './ui-locale'
import styles from './ProjectLibraryPage.module.css'

const purposes = { tm: '翻译记忆 TM', terms: '术语表 TB', rules: '规则 / SG / Checklist', context: '背景 / 例句 / Query / 反馈' } as const

type Editor = { action: 'add' | 'edit' | 'replace' | 'override'; item?: ProjectLibraryItem }
export function ProjectLibraryPage({ project, initialGroup, onBack }: {
  project: { id: string; name: string; archivedAt?: string }
  initialGroup?: TaskGroup
  onBack: () => void
}): React.ReactElement {
  const t = useT()
  const [groups, setGroups] = React.useState<TaskGroup[]>([])
  const [groupId, setGroupId] = React.useState(initialGroup?.id ?? '')
  const taskGroupId = groupId || undefined
  const [selected, setSelected] = React.useState<string[]>([])
  const [to, setTo] = React.useState('')
  const [items, setItems] = React.useState<ProjectLibraryItem[]>([])
  const [loading, setLoading] = React.useState(true)
  const [busy, setBusy] = React.useState(false)
  const [error, setError] = React.useState('')
  const [message, setMessage] = React.useState('')
  const [editor, setEditor] = React.useState<Editor>()
  const [removing, setRemoving] = React.useState<ProjectLibraryItem>()
  const [preview, setPreview] = React.useState<PreviewRequest>()
  const [saveGroup, setSaveGroup] = React.useState(groupId)
  const [file, setFile] = React.useState<File>()
  const [kind, setKind] = React.useState<ProjectResource['kind']>('context')
  const [scope, setScope] = React.useState('')
  const [mapping, setMapping] = React.useState({ sheetName: '', source: '', target: '' })
  const [formError, setFormError] = React.useState('')
  const readOnly = Boolean(project.archivedAt || (groups.find(group => group.id === groupId) ?? initialGroup)?.archived && groupId)

  React.useEffect(() => {
    let live = true, request = 0
    const read = () => {
      const revision = ++request
      void required<{ items: ProjectLibraryItem[]; groups: TaskGroup[] }>('linguistLibraryList', { projectId: project.id, taskGroupId })
        .then(result => { if (live && revision === request) { setGroups(result.groups); setItems(result.items); setError(''); setLoading(false) } })
        .catch(cause => { if (live && revision === request) { setError(String(cause)); setLoading(false) } })
    }
    read()
    const unsubscribe = subscribeProject(project.id, 0, read, read)
    window.addEventListener('focus', read)
    return () => { live = false; unsubscribe(); window.removeEventListener('focus', read) }
  }, [project.id, taskGroupId])

  const openEditor = (action: Editor['action'], item?: ProjectLibraryItem) => {
    setSaveGroup(groupId); setEditor({ action, item }); setFile(undefined); setKind(item?.kind ?? 'context')
    setScope(item?.appliesTo?.join('\n') ?? '')
    setMapping({ sheetName: item?.xlsxMapping?.sheetName ?? '', source: item?.xlsxMapping?.columns.source ?? '', target: item?.xlsxMapping?.columns.target ?? '' })
    setFormError(''); setError(''); setMessage('')
  }
  const refresh = async () => {
    setBusy(true); setError(''); setMessage(t('正在读取资料…'))
    try {
      const result = await required<{ items: ProjectLibraryItem[] }>(readOnly ? 'linguistLibraryList' : 'linguistLibraryRefresh', { projectId: project.id, taskGroupId })
      setItems(result.items); setMessage(t('资料状态已更新'))
    } catch (cause) { setError(String(cause)); setMessage('') }
    finally { setBusy(false) }
  }
  const save = async (event: React.FormEvent) => {
    event.preventDefault()
    if (!editor) return
    setBusy(true); setFormError(''); setMessage(t('正在读取资料…'))
    let tokens: readonly string[] = []
    try {
      if (file) tokens = await stageFiles([file], progress => setMessage(t('正在上传 {filename} · {percent}%', { filename: progress.filename, percent: Math.round(progress.loadedBytes / Math.max(1, progress.totalBytes) * 100) })))
      const result = await required<{ items: ProjectLibraryItem[] }>('linguistLibrarySave', {
        projectId: project.id, taskGroupId: saveGroup || undefined, ...(editor.action === 'override' ? { replacesInherited: editor.item?.key } : { key: editor.item?.key }), kind,
        appliesTo: kind === 'rules' || kind === 'context' ? scope.split('\n').map(value => value.trim()).filter(Boolean) : [],
        ...(tokens.length ? { fileTokens: tokens } : {}),
        ...(mapping.sheetName.trim() && (kind === 'tm' || kind === 'terms') ? { xlsxMapping: { sheetName: mapping.sheetName.trim(), columns: { source: mapping.source.trim(), target: mapping.target.trim() } } } : {}),
      })
      setGroupId(saveGroup); setItems(result.items); setEditor(undefined); setPreview(undefined)
      setMessage(result.items.some(item => item.status === 'error') ? t('资料已登记，请处理列表中的读取失败项') : t('资料已保存'))
    } catch (cause) { setFormError(String(cause)); setMessage('') }
    finally {
      try { if (tokens.length) await discardStagedFiles(tokens) }
      catch (cause) { setError(String(cause)) }
      setBusy(false)
    }
  }
  const remove = async () => {
    if (!removing) return
    setBusy(true); setError('')
    try {
      const result = await required<{ items: ProjectLibraryItem[] }>('linguistLibraryRemove', { projectId: project.id, taskGroupId, key: removing.key })
      setItems(result.items); setRemoving(undefined); setPreview(undefined); setMessage(t('已移除项目资料'))
    } catch (cause) { setError(String(cause)) }
    finally { setBusy(false) }
  }
  const editorTitle = t(editor?.action === 'override' ? '仅本组替代' : editor?.action === 'replace' ? '替换资料' : editor?.action === 'edit' ? '编辑资料' : '添加资料')
  const isWorkbook = /\.xlsx$/iu.test(file?.name ?? editor?.item?.filename ?? '') && (kind === 'tm' || kind === 'terms')
  return <main className={styles.page} aria-label={t('项目资料')}>
    <div className={styles.content}>
      <header className={styles.heading}>
        <div><Button variant="ghost" size="sm" disabled={busy} onClick={onBack}>{t('返回项目')}</Button><h1>{t('项目资料')}</h1><p>{project.name}</p></div>
        <div className={styles.actions}><Button variant="outline" size="sm" disabled={loading || busy} onClick={() => void refresh()}>{t('刷新状态')}</Button><Button variant="primary" size="sm" disabled={readOnly || busy} onClick={() => openEditor('add')}>{t('添加资料')}</Button></div>
      </header>
      <label>{t('资料归属')} <select value={groupId} disabled={busy} onChange={event => { setGroupId(event.target.value); setLoading(true); setSelected([]); setRemoving(undefined); setMessage(''); setPreview(undefined); setEditor(undefined); setItems([]) }}><option value="">{t('项目共用')}</option>{groups.map(group => <option key={group.id} value={group.id}>{group.name}</option>)}</select></label>
      <LibraryPreparation key={groupId} projectId={project.id} groups={[{ id: groupId, name: groups.find(group => group.id === groupId)?.name ?? (initialGroup?.id === groupId ? initialGroup.name : '') }]} readOnly={readOnly || loading || busy} />
      {selected.length > 0 && <div className={styles.actions}><label>{t('资料移入')} <select value={to} onChange={event => setTo(event.target.value)}><option value="">{t('项目共用')}</option>{groups.filter(group => !group.archived).map(group => <option key={group.id} value={group.id}>{group.name}</option>)}</select></label>
        <Button variant="outline" size="sm" disabled={busy || to === groupId} onClick={() => { setBusy(true); void required<{ items: ProjectLibraryItem[] }>('linguistLibraryMove', { projectId: project.id, taskGroupId, keys: selected, toGroup: to || undefined }).then(result => { setItems(result.items); setSelected([]) }).catch(cause => setError(String(cause))).finally(() => setBusy(false)) }}>{t('移动选中资料')}</Button></div>}
      <p className={styles.intro}>{t('问答、CAT、工作副本和线上审校共用这些资料。原件变化后可刷新读取；上传文件保存在项目工作区的资料副本中。')}</p>
      {readOnly && <p role="note">{t('已归档，只读')}</p>}
      {error && <p className={styles.error} role="alert">{error}</p>}
      {message && <p className={styles.notice} role="status">{message}</p>}
      {loading ? <p role="status">{t('正在读取资料…')}</p> : items.length === 0 ? <div className={styles.empty}><h2>{t('还没有项目资料')}</h2><p>{t('添加 TM、术语表、规则或参考文件。也可以让 LA 在对话中登记，之后会显示在这里。')}</p></div>
        : <ul className={styles.list}>{items.map(item => <li key={item.key} className={styles.item}>
          <div className={styles.file}><strong>{!readOnly && item.taskGroupId === taskGroupId && <input aria-label={item.filename} type="checkbox" checked={selected.includes(item.key)} onChange={event => setSelected(event.target.checked ? [...selected, item.key] : selected.filter(key => key !== item.key))} />}{item.filename}</strong><small>{t(item.taskGroupId ? '本组添加' : groupId ? '从项目继承' : '项目共用')}{item.replacesInherited && ' · ' + t('仅本组替代') + ' ' + item.replacesInherited}</small><span className={styles.path} title={item.path}>{item.origin === 'entry' ? t('项目语言资产') : item.origin === 'cat' ? t('CAT 已导入原件') : item.path}</span></div>
          <dl className={styles.meta}>
            <div><dt>{t('用途')}</dt><dd>{t(purposes[item.kind])}</dd></div>
            <div><dt>{t('适用范围')}</dt><dd>{item.appliesTo?.length ? item.appliesTo.join(' · ') : t('全项目')}</dd></div>
            <div><dt>{t('读取状态')}</dt><dd className={item.status === 'error' ? styles.error : undefined}>{t(item.status === 'ready' ? '已读取' : item.status === 'changed' ? '原件已变化' : item.status === 'manual' ? '需查看原件' : '读取失败')}{item.readAt && <small>{new Date(item.readAt).toLocaleString()}</small>}</dd></div>
          </dl>
          <div className={styles.actions}>
            <Button variant="ghost" size="sm" disabled={busy} onClick={() => setPreview({ operation: 'linguistLibraryPreview', input: { projectId: project.id, taskGroupId, key: item.key } })}>{t('查看')}</Button>
            <Button variant="ghost" size="sm" disabled={busy || readOnly || item.origin === 'entry' || item.taskGroupId !== taskGroupId} onClick={() => openEditor('edit', item)}>{t('编辑')}</Button>
            <Button variant="ghost" size="sm" disabled={busy || readOnly || item.origin === 'entry'} onClick={() => openEditor(item.taskGroupId !== taskGroupId ? 'override' : 'replace', item)}>{t(item.taskGroupId !== taskGroupId ? '仅本组替代' : '替换')}</Button>
            <Button variant="ghost" size="sm" disabled={busy || readOnly || item.origin === 'entry' || item.taskGroupId !== taskGroupId} onClick={() => setRemoving(item)}>{t('移除')}</Button>
          </div>
          {(item.error || item.warnings.length > 0) && <div className={styles.details}>{item.error && <p role="alert" className={styles.error}>{item.error}{item.readAt && ` · ${t('仍使用上次成功读取的版本')}`}</p>}{item.warnings.map((warning, index) => <p key={index}>{warning}</p>)}</div>}
        </li>)}</ul>}
      {preview && <div className={styles.preview}><PreviewView request={preview} onClose={() => setPreview(undefined)} /></div>}
      <Modal open={Boolean(editor)} onClose={() => { if (!busy) setEditor(undefined) }} title={editorTitle} closeLabel={t('关闭')} className={styles.modal} contentClassName={styles.dialog}>
        <form className={styles.form} onSubmit={event => void save(event)}>
          {editor?.item && <p className={styles.filename}>{editor.item.filename}</p>}
          {editor?.action !== 'edit' && <label className={styles.field}>{t('文件')}<input type="file" required disabled={busy} onChange={event => { setFile(event.target.files?.[0]); setMapping({ sheetName: '', source: '', target: '' }) }} /><small>{t('单文件最大 {size}；工作区原件不会被覆盖。', { size: `${LINGUIST_FILE_MAX_BYTES / 1024 ** 3} GiB` })}</small></label>}
          <label className={styles.field}>{t('资料归属')}<select value={saveGroup} disabled={busy || editor?.action !== 'add'} onChange={event => setSaveGroup(event.target.value)}><option value="">{t('项目共用')}</option>{groups.filter(group => !group.archived).map(group => <option key={group.id} value={group.id}>{group.name}</option>)}</select></label>
          <label className={styles.field}>{t('用途')}<select value={kind} disabled={busy} onChange={event => setKind(event.target.value as ProjectResource['kind'])}>{Object.entries(purposes).map(([value, label]) => <option key={value} value={value}>{t(label)}</option>)}</select></label>
          <label className={styles.field}>{t('适用范围')}<textarea rows={3} disabled={busy || kind === 'tm' || kind === 'terms'} value={kind === 'tm' || kind === 'terms' ? '' : scope} onChange={event => setScope(event.target.value)} placeholder={t('全项目；指定范围时每行填写一项')} /><small>{t(kind === 'tm' || kind === 'terms' ? 'TM／TB 沿用项目匹配规则。' : '可填角色、模块或文本类型，供审校判断适用性；留空表示全项目。')}</small></label>
          {isWorkbook && <details open={Boolean(mapping.sheetName)}><summary>{t('Excel 列映射')}</summary><p>{t('默认自动识别。需要指定时填写工作表名和源文、译文列的表头或列字母。')}</p><div className={styles.mapping}>
            <label className={styles.field}>{t('工作表')}<Input value={mapping.sheetName} disabled={busy} onChange={event => setMapping({ ...mapping, sheetName: event.target.value })} /></label>
            <label className={styles.field}>{t('源文列')}<Input value={mapping.source} required={Boolean(mapping.sheetName.trim())} disabled={busy} onChange={event => setMapping({ ...mapping, source: event.target.value })} /></label>
            <label className={styles.field}>{t('译文列')}<Input value={mapping.target} required={Boolean(mapping.sheetName.trim())} disabled={busy} onChange={event => setMapping({ ...mapping, target: event.target.value })} /></label>
          </div></details>}
          {formError && <p role="alert" className={styles.error}>{formError}</p>}
          {busy && <p role="status">{message}</p>}
          <footer className={styles.actions}><Button variant="outline" size="sm" disabled={busy} onClick={() => setEditor(undefined)}>{t('取消')}</Button><Button variant="primary" size="sm" type="submit" disabled={busy || editor?.action !== 'edit' && !file}>{t(busy ? '正在读取资料…' : '保存资料')}</Button></footer>
        </form>
      </Modal>
      <Modal open={Boolean(removing)} onClose={() => { if (!busy) setRemoving(undefined) }} title={t('移除项目资料')} closeLabel={t('关闭')} className={styles.modal} contentClassName={styles.dialog}>
        <div className={styles.form}><strong className={styles.filename}>{removing?.filename}</strong><p>{t('移除此范围的资料引用。其他有效引用、工作区原件和已有译文会保留。')}</p>
          {error && <p className={styles.error} role="alert">{error}</p>}
          <footer className={styles.actions}><Button variant="outline" size="sm" disabled={busy} onClick={() => setRemoving(undefined)}>{t('取消')}</Button><Button variant="primary" size="sm" disabled={busy} onClick={() => void remove()}>{t('移除')}</Button></footer>
        </div>
      </Modal>
    </div>
  </main>
}
