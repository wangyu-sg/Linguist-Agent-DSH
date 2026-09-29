import * as React from 'react'
import { Button } from '@deepseek-ai/dsh-client-ui-primitives'
import type { LinguistUnknownTagPatternInfo } from '@linguist/domain-service/contracts'
import { required } from './api'
import { useT } from './ui-locale'
import styles from './Workbench.module.css'

const TAG_RECOGNITION_TASK = '请识别当前项目里扫描到的未知 Tag 形状：先运行未知 Tag 扫描，逐类判断它是不是真实的格式 Tag。真实的请整理成正则候选提交给我确认，误报请说明理由。不要直接启用硬保护，候选由我批准后才生效。'

export function UnknownTagNotice({ projectId, scanRevision, onView, onSendAgentTask }: {
  projectId: string
  scanRevision: string
  onView: () => void
  onSendAgentTask: (text: string) => Promise<void>
}): React.ReactElement | null {
  const t = useT()
  const [patterns, setPatterns] = React.useState<LinguistUnknownTagPatternInfo[]>()
  const [dismissed, setDismissed] = React.useState('')
  const [error, setError] = React.useState('')
  const [actionError, setActionError] = React.useState('')
  const [sending, setSending] = React.useState(false)
  const [scanRetry, setScanRetry] = React.useState(0)
  React.useEffect(() => {
    let live = true
    required<LinguistUnknownTagPatternInfo[]>('linguistProjectsScanUnknownTags', { projectId, sampleLimit: 1 })
      .then((result) => { if (live) { setPatterns(result); setError('') } })
      .catch((cause: unknown) => { if (live) setError(String(cause)) })
    return () => { live = false }
  }, [projectId, scanRevision, scanRetry])

  const fingerprint = patterns?.map((pattern) => `${pattern.patternShape}:${pattern.frequency}`).sort().join('|') ?? ''
  if (error) return <div className={styles.tagNotice} role="alert">{t('未知 Tag 扫描失败')} · {error}<Button variant="outline" size="sm" onClick={() => setScanRetry((value) => value + 1)}>{t('重试')}</Button></div>
  if (!patterns?.length || fingerprint === dismissed) return null
  const askAgent = async () => {
    setSending(true)
    try { await onSendAgentTask(TAG_RECOGNITION_TASK); setActionError('') }
    catch (cause) { setActionError(String(cause)) }
    finally { setSending(false) }
  }
  return <div className={styles.tagNotice} role="status" aria-label={t('未知 Tag 提示')}>
    <span>{t('发现 {count} 类未登记的疑似 Tag；批准后才会进入编辑与 QA 的硬保护。', { count: patterns.length })}</span>
    {actionError && <span role="alert">{actionError}</span>}
    <div className={styles.tagNoticeActions}>
      <Button variant="outline" size="sm" onClick={onView}>{t('查看')}</Button>
      <Button variant="outline" size="sm" disabled={sending} onClick={() => void askAgent()}>{sending ? t('发送中…') : t('让 Agent 识别')}</Button>
      <button type="button" aria-label={t('忽略本次提示')} title={t('忽略本次提示；出现新形状时会重新提示')} onClick={() => setDismissed(fingerprint)}>×</button>
    </div>
  </div>
}
