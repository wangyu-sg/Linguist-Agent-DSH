import * as React from 'react'
import type { PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { Button, Modal } from '@deepseek-ai/dsh-client-ui-primitives'
import { ProjectCreateForm, type ProjectSetup } from './ProjectCreateForm'
import { useT } from './ui-locale'
import styles from './ProjectsPage.module.css'

export function WorkspaceDirectoryFlow({ open, busy: ownerBusy, onPicked, onCancel, pickDirectory, onCreate, onOpenProject }: PropsRuntime<'sidebar.workspaces.directoryFlow'> & {
  pickDirectory: () => Promise<string | null>
  onCreate: (path: string, input: ProjectSetup) => Promise<string>
  onOpenProject: (projectId: string) => Promise<void>
}) {
  const t = useT()
  const [kind, setKind] = React.useState<'linguist' | undefined>()
  const [path, setPath] = React.useState('')
  const [busy, setBusy] = React.useState(false)
  const [error, setError] = React.useState('')
  const [created, setCreated] = React.useState<string>()
  React.useEffect(() => { if (!open) { setKind(undefined); setPath(''); setError(''); setCreated(undefined) } }, [open])
  const openProject = async (projectId: string) => {
    setBusy(true); setError('')
    try { await onOpenProject(projectId); onCancel() }
    catch (cause) { setError(String(cause)) }
    finally { setBusy(false) }
  }
  const pick = async (linguist: boolean) => {
    setBusy(true); setError('')
    try {
      const selected = await pickDirectory()
      if (selected !== null) {
        if (linguist) setPath(selected)
        else onPicked(selected)
      }
    } catch (cause) { setError(String(cause)) }
    finally { setBusy(false) }
  }
  return <Modal open={open} onClose={() => { if (!busy && !ownerBusy) onCancel() }} title={t(kind ? '新建 LA 工作区' : '添加工作区')} closeLabel={t('关闭')} className={styles.modal} contentClassName={styles.dialog}>
    {!kind ? <div className={styles.form}>
      <p className={styles.formHint}>{t('选择已有文件夹，或在目录选择器中新建文件夹。')}</p>
      <Button variant="outline" size="sm" disabled={busy || ownerBusy} onClick={() => void pick(false)}>{t('普通工作区')}</Button>
      <Button variant="outline" size="sm" disabled={busy || ownerBusy} onClick={() => setKind('linguist')}>{t('LA 工作区 · 本地化项目')}</Button>
    </div> : <div className={styles.form}>
      <p className={styles.formHint}>{t('选择目录、设置语言对，创建项目后进入 Linguist 通用岗位。')}</p>
      <div className={styles.toolbar}><Button variant="outline" size="sm" disabled={busy || ownerBusy || Boolean(created)} onClick={() => void pick(true)}>{t(path ? '更换目录' : '选择目录')}</Button><span className={styles.formHint}>{path}</span></div>
      {created ? <Button variant="primary" size="sm" disabled={busy} onClick={() => void openProject(created)}>{t('项目已创建，打开会话')}</Button> : path && <ProjectCreateForm key={path} initialName={path.split(/[\\/]/).filter(Boolean).at(-1)} onBusyChange={setBusy} onCreate={async input => { const id = await onCreate(path, input); setCreated(id); await openProject(id) }} />}
    </div>}
    {error && <p className={styles.warning} role="alert">{error}</p>}
  </Modal>
}
