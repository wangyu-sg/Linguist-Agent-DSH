import * as React from 'react'
import { Button } from '@deepseek-ai/dsh-client-ui-primitives'
import type { SkillListValue } from '@deepseek-ai/dsh-api-session-controller/types'
import { getInstructionFiles } from './api'
import { useT } from './ui-locale'
import styles from './Panels.module.css'

export function ProjectCapabilities({ sessionId, loadSkills, onOpenFile, onOpenPlugins, onOpenFiles }: {
  sessionId?: string
  loadSkills: (sessionId: string, signal: AbortSignal) => Promise<SkillListValue>
  onOpenFile?: (path: string) => void | Promise<void>
  onOpenPlugins: () => void
  onOpenFiles?: () => void
}): React.ReactElement {
  const t = useT()
  const [catalog, setCatalog] = React.useState<{ sessionId: string; value?: SkillListValue; error?: string }>()
  const [instructions, setInstructions] = React.useState<{ sessionId: string; files?: Awaited<ReturnType<typeof getInstructionFiles>>; error?: string }>()
  const [refresh, setRefresh] = React.useState(0)
  const [openError, setOpenError] = React.useState('')
  React.useEffect(() => {
    if (!sessionId) return
    const abort = new AbortController()
    setCatalog({ sessionId })
    void loadSkills(sessionId, abort.signal).then((value) => {
      if (!abort.signal.aborted) setCatalog({ sessionId, value })
    }).catch((error: unknown) => {
      if (!abort.signal.aborted) setCatalog({ sessionId, error: String(error) })
    })
    return () => abort.abort()
  }, [sessionId, loadSkills, refresh])
  React.useEffect(() => {
    if (!sessionId) return
    const abort = new AbortController()
    setInstructions({ sessionId })
    void getInstructionFiles(sessionId, abort.signal).then((files) => {
      if (!abort.signal.aborted) setInstructions({ sessionId, files })
    }).catch((error: unknown) => {
      if (!abort.signal.aborted) setInstructions({ sessionId, error: String(error) })
    })
    return () => abort.abort()
  }, [sessionId, refresh])
  const current = catalog?.sessionId === sessionId ? catalog : undefined
  const currentInstructions = instructions?.sessionId === sessionId ? instructions : undefined
  const openFile = async (path: string) => {
    setOpenError('')
    try { await onOpenFile!(path) }
    catch (error) { setOpenError(String(error)) }
  }
  return <section className={styles.panel} aria-label={t('Agent 能力')}>
    <h3>{t('Agent 能力')}</h3>
    <div className={styles.toolbar}>
      <Button variant="outline" size="sm" onClick={onOpenPlugins}>{t('打开原生插件')}</Button>
      {sessionId && onOpenFiles && <Button variant="outline" size="sm" onClick={onOpenFiles}>{t('打开原生 Files')}</Button>}
    </div>
    {!sessionId ? <p className={styles.notice}>{t('进入项目会话后查看 Skills 与指令文件。')}</p> : <>
      <div className={styles.toolbar}><strong>{t('可调用 Skills')}{current?.value && ` · ${current.value.skills.length}`}</strong><Button variant="outline" size="sm" onClick={() => setRefresh((value) => value + 1)}>{t('刷新')}</Button></div>
      {current?.error ? <p role="alert">{current.error}</p> : !current?.value ? <p role="status">{t('正在读取可调用 Skills…')}</p> : current.value.skills.length === 0 ? <p className={styles.notice}>{t('当前会话没有可手动调用的 Skills。')}</p> : <details>
        <summary>{t('查看 Skills')}</summary>
        <div className={styles.panel} style={{ maxHeight: 280, overflowY: 'auto' }}>{current.value.skills.map((skill) => <div className={styles.item} key={skill.name}>
          <div className={styles.toolbar}><strong>/{skill.name}</strong><small>{t(skill.modelInvocable ? 'Agent 也可调用' : '仅手动调用')}</small></div>
          <p>{skill.description}</p>
          {skill.path && onOpenFile && <Button variant="outline" size="sm" onClick={() => void openFile(skill.path!)}>{t('打开 {name}', { name: skill.name })}</Button>}
        </div>)}</div>
      </details>}
      <strong>{t('DSH 默认指令文件')}</strong>
      <small className={styles.notice}>{t('按 DSH 默认规则查找；实际载入由会话配置决定。')}</small>
      {currentInstructions?.error ? <p role="alert">{currentInstructions.error}</p> : currentInstructions?.files === undefined ? <p role="status">{t('正在读取指令文件…')}</p> : currentInstructions.files.length === 0 ? <p className={styles.notice}>{t('未发现工作区指令文件。')}</p> : currentInstructions.files.map((file) => <div className={styles.toolbar} key={file.path}><span>{file.label}</span>{onOpenFile && <Button variant="outline" size="sm" onClick={() => void openFile(file.path)}>{t('打开 {name}', { name: file.label })}</Button>}</div>)}
    </>}
    {openError && <p role="alert">{openError}</p>}
  </section>
}
