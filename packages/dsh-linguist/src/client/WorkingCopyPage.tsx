import * as React from 'react'
import { Button } from '@deepseek-ai/dsh-client-ui-primitives'
import type { LinguistWorkingCopiesListResult } from '@linguist/domain-service/contracts'
import { required } from './api'
import { useLocaleId, useT } from './ui-locale'
import styles from './WorkingCopyPage.module.css'

export function WorkingCopyPage({ sessionId, onOpenFile }: {
  sessionId: string
  onOpenFile: (path: string) => void
}): React.ReactElement {
  const t = useT()
  const locale = useLocaleId()
  const [list, setList] = React.useState<LinguistWorkingCopiesListResult>()
  const [error, setError] = React.useState('')
  const [loading, setLoading] = React.useState(true)
  const [refresh, setRefresh] = React.useState(0)
  React.useEffect(() => {
    let live = true
    setLoading(true)
    required<LinguistWorkingCopiesListResult>('linguistWorkingCopiesList', { sessionId })
      .then((next) => { if (live) { setList(next); setError('') } })
      .catch((cause: unknown) => { if (live) setError(String(cause)) })
      .finally(() => { if (live) setLoading(false) })
    return () => { live = false }
  }, [sessionId, refresh])
  return <section className={styles.page} aria-label={t("本地化工作副本")}>
    <header className={styles.header}><div><h2>{t("工作副本")}</h2><p>{t("原文件保持原样；工作稿内的决策覆盖不等于正式交付完成。")}</p></div><Button variant="outline" size="sm" disabled={loading} onClick={() => setRefresh((value) => value + 1)}>{t("刷新")}</Button></header>
    {error && <p role="alert" className={styles.error}>{error}</p>}
    {!list && !error && <p role="status">{t("正在读取当前会话的工作副本…")}</p>}
    {list && list.items.length === 0 && <p>{t("此会话尚无工作副本。可让 Agent 对 Workspace 内原文件运行本地化工作副本工具。")}</p>}
    {list?.truncated && <p role="note">{t("列表已截断。使用 DSH 原生文件浏览器查看 Workspace 中的其他工作稿。")}</p>}
    {list?.items.map((item) => <article className={styles.item} key={item.path}>
      <div className={styles.itemHead}><div><strong>{item.sourcePath}</strong><small>{item.formatId} · {item.sourceLocale} → {item.targetLocale} · {item.segmentCount} {t("段 ·")} {new Date(item.updatedAt).toLocaleString(locale === 'zh' ? 'zh-CN' : locale)}</small><small>{item.ownerSessionId === sessionId ? t('当前会话') : t('历史会话')} · {item.ownerSessionId.slice(0, 12)}</small></div><Button variant="outline" size="sm" onClick={() => onOpenFile(item.path)}>{t("用 DSH 文件预览打开")}</Button></div>
      <p className={styles.status}>{item.kind === 'result' ? t("已组装结果") : t("双语基线")} · {{ prepared: t("已准备"), 'in-progress': t("裁定进行中"), 'coverage-complete': t("工作稿裁定覆盖完整") }[item.status]} {t("· 未正式提交")}</p>
      {item.coverage && <p>{t("本轮决策：无改动")} {item.coverage.unchanged} {t("· 已修订")} {item.coverage.corrected} {t("· 阻塞")} {item.coverage.blocked} {t("· 未裁定")} {item.coverage.undecided} / {item.coverage.total}</p>}
      <p>{t("相对原件的差异")} {item.differenceCount} {t("项 · 修订记录")} {item.finalChangeCount} {t("项")}</p>
      {item.nextAction && <p className={styles.nextAction}>{item.nextAction}</p>}
      {item.differences.length > 0 && <details><summary>{t("查看差异（展示")} {item.differences.length} / {item.differenceCount}）</summary><ol>{item.differences.map((diff) => <li key={diff.segmentId}><small>{diff.segmentId}</small><div className={styles.diff}><div><span>Source</span><p>{diff.source}</p></div><div><span>{t("原 Target")}</span><p>{diff.previousTarget}</p></div><div><span>{t("工作稿 Target")}</span><p>{diff.target}</p></div></div></li>)}</ol>{item.differencesTruncated && <p>{t("此处仅展示前 20 条且长字段已截断；完整内容请打开工作稿文件。")}</p>}</details>}
      <small className={styles.hash}>{t("原件 SHA-256")} {item.sourceSha256} {t("· 工作稿 SHA-256")} {item.artifactSha256}</small>
    </article>)}
  </section>
}
