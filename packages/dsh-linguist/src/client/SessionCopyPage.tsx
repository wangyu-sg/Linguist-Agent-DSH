import * as React from 'react'
import { Button } from '@deepseek-ai/dsh-client-ui-primitives'
import type { LinguistProjectInfo } from '@linguist/domain-service/contracts'
import { getBinding, required, type LinguistBinding } from './api'
import { useT } from './ui-locale'
import { describeProjectError } from './project-errors'
import styles from './SessionCopyPage.module.css'

type Project = LinguistProjectInfo & { workspaceId?: string }
type Eligibility =
  | { eligible: true; mode: 'blank' | 'fork' }
  | { eligible: false; reason: string; message: string }
export type SessionCopyResult = LinguistBinding & { mode: 'blank' | 'fork' }

export function SessionCopyPage({ sessionId, onCopied }: {
  sessionId: string
  onCopied: (copy: SessionCopyResult) => Promise<void>
}): React.ReactElement {
  const t = useT()
  const [binding, setBinding] = React.useState<LinguistBinding>()
  const [projects, setProjects] = React.useState<Project[]>([])
  const [targetProjectId, setTargetProjectId] = React.useState('')
  const [eligibility, setEligibility] = React.useState<Eligibility>()
  const [loading, setLoading] = React.useState(true)
  const [checking, setChecking] = React.useState(false)
  const [copying, setCopying] = React.useState(false)
  const [copied, setCopied] = React.useState<SessionCopyResult>()
  const [error, setError] = React.useState('')

  React.useEffect(() => {
    let live = true
    Promise.all([
      getBinding(sessionId),
      required<Project[]>('linguistProjectsList', { includeArchived: false }),
    ]).then(([nextBinding, nextProjects]) => {
      if (!live) return
      if (!nextBinding?.projectId) throw new Error(t('此 DSH Session 未绑定 Linguist 项目，无法复制到其他项目。'))
      setBinding(nextBinding)
      setProjects(nextProjects)
      setLoading(false)
    }).catch((cause: unknown) => { if (live) { setError(describeProjectError(cause, t)); setLoading(false) } })
    return () => { live = false }
  }, [sessionId])

  React.useEffect(() => {
    if (!binding) return
    let live = true
    setChecking(true)
    setEligibility(undefined)
    required<Eligibility>('linguistSessionsCopyEligibility', { sessionId, ...(targetProjectId ? { targetProjectId } : {}) })
      .then((result) => { if (live) { setEligibility(result); setChecking(false) } })
      .catch((cause: unknown) => { if (live) { setError(describeProjectError(cause, t)); setChecking(false) } })
    return () => { live = false }
  }, [binding, sessionId, targetProjectId])

  const source = projects.find((project) => project.id === binding?.projectId)
  const candidates = projects.filter((project) => project.id !== binding?.projectId)
  const target = candidates.find((project) => project.id === targetProjectId)
  const mismatchedLocales = source && target && (source.sourceLocale !== target.sourceLocale || source.targetLocale !== target.targetLocale)
  const copy = async () => {
    if (copying || (!copied && (!target || !eligibility?.eligible))) return
    setCopying(true)
    setError('')
    try {
      const result = copied ?? await required<SessionCopyResult>('linguistSessionsCopyToProject', { sessionId, targetProjectId: target!.id })
      setCopied(result)
      await onCopied(result)
    } catch (cause) { setError(describeProjectError(cause, t)) }
    finally { setCopying(false) }
  }

  return <section className={styles.page} aria-label={t('复制 Linguist 会话')}>
    <header><h2>{t('复制到其他项目')}</h2><p>{t('使用 DSH 原生 Session 创建或分叉。原项目与原会话保持不变。')}</p></header>
    {loading && !error && <p role="status">{t('正在读取会话和项目…')}</p>}
    {error && <p role="alert" className={styles.error}>{error}</p>}
    {binding && <>
      <p>{t('源项目')}：<strong>{source?.name ?? binding.projectId}</strong> · {t({ cat: 'CAT', 'working-copy': '工作副本', browser: '浏览器' }[binding.workMode])}</p>
      {candidates.length === 0 ? <p>{t('没有其他活跃的目标项目。')}</p> : <fieldset className={styles.targets} disabled={copying || !!copied}>
        <legend>{t('目标项目')}</legend>
        {candidates.map((project) => <label key={project.id} className={styles.target}>
          <input type="radio" name="linguist-copy-target" value={project.id} checked={targetProjectId === project.id} onChange={() => { setTargetProjectId(project.id); setError('') }} />
          <span><strong>{project.name}</strong><small>{project.sourceLocale} → {project.targetLocale}</small></span>
        </label>)}
      </fieldset>}
      {checking && <p role="status">{t('正在检查会话历史和目标项目…')}</p>}
      {eligibility && !eligibility.eligible && <p role="alert" className={styles.error}>{eligibility.message}</p>}
      {eligibility?.eligible && target && <p role="status">{eligibility.mode === 'fork'
        ? t('将分叉完整 DSH 对话历史和运行配置；后续 Linguist 上下文使用目标项目。')
        : t('此会话没有对话历史；将在目标 Workspace 创建空白 DSH Session。')}</p>}
      {mismatchedLocales && <p role="status" className={styles.warning}>{t('目标项目的语言方向与源项目不同；后续上下文将使用目标项目策略。')}</p>}
      {copied && <p role="status">{t('已创建 DSH Session')}：{copied.sessionId}</p>}
      <Button variant="primary" size="sm" disabled={copying || (!copied && (!target || !eligibility?.eligible || checking))} onClick={() => void copy()}>{copying ? t('正在打开…') : copied ? t('打开已创建会话') : t('复制并打开')}</Button>
    </>}
  </section>
}
