import * as React from 'react'
import { Button } from '@deepseek-ai/dsh-client-ui-primitives'
import type { LinguistAssetInfo, LinguistCatQueryResult, LinguistProjectSummary, LinguistSegmentInfo } from '@linguist/domain-service/contracts'
import { required } from './api'
import { describeLinguistFormat } from './format-labels'
import { PreviewView } from './PreviewView'
import { splitProtectedText } from './TargetEditor'
import { useT } from './ui-locale'
import { stageFilterOptions, stageName, stageProgressLabel } from './workflow-ui'
import styles from './BatchPreview.module.css'

const PAGE_SIZE = 50

function missingProtectedTokens(segment: LinguistSegmentInfo, profile: LinguistProjectSummary['project']['tagProfile']): string[] {
  const sourceTokens = splitProtectedText(segment.source, profile).filter((part) => part.kind === 'token').map((part) => part.value)
  const remaining = splitProtectedText(segment.target, profile).filter((part) => part.kind === 'token').map((part) => part.value)
  return sourceTokens.filter((token) => {
    const index = remaining.indexOf(token)
    if (index < 0) return true
    remaining.splice(index, 1)
    return false
  })
}

export function BatchPreview({ projectId, asset, onClose }: { projectId: string; asset: LinguistAssetInfo; onClose: () => void }): React.ReactElement {
  const t = useT()
  const [summary, setSummary] = React.useState<LinguistProjectSummary>()
  const [page, setPage] = React.useState<LinguistCatQueryResult>()
  const [offset, setOffset] = React.useState(0)
  const [refresh, setRefresh] = React.useState(0)
  const [rawOpen, setRawOpen] = React.useState(false)
  const [error, setError] = React.useState('')
  const rawRequest = React.useMemo(() => ({ operation: 'linguistProjectsPreviewAssetSource' as const, input: { projectId, assetId: asset.assetId } }), [projectId, asset.assetId])

  React.useEffect(() => {
    let live = true
    setPage(undefined)
    setError('')
    Promise.all([
      required<LinguistProjectSummary>('linguistProjectsGetSummary', { projectId }),
      required<LinguistCatQueryResult>('linguistCatQuery', { projectId, assetId: asset.assetId, limit: PAGE_SIZE, offset }),
    ]).then(([overview, next]) => { if (live) { setSummary(overview); setPage(next); setError('') } })
      .catch((cause: unknown) => { if (live) setError(String(cause)) })
    return () => { live = false }
  }, [projectId, asset.assetId, offset, refresh])

  const profile = summary?.project.tagProfile
  const currentAsset = summary?.assets.find((item) => item.assetId === asset.assetId) ?? asset
  const workflowStage = summary?.project.workflowStage ?? 'translation'
  const warnings = page?.segments.flatMap((segment) => {
    const missing = missingProtectedTokens(segment, profile)
    return missing.length ? [{ segment, missing }] : []
  }) ?? []
  return <section className={styles.preview} aria-label={t('批次语义预览')}>
    <div className={styles.toolbar}><strong>{asset.filename}</strong><Button variant="outline" size="sm" onClick={() => setRefresh((value) => value + 1)}>{t('刷新')}</Button><Button variant="ghost" size="sm" onClick={onClose}>{t('关闭预览')}</Button></div>
    <p>{t(describeLinguistFormat(currentAsset.formatId))} · {summary?.project.sourceLocale ?? '—'} → {summary?.project.targetLocale ?? '—'} · {currentAsset.segmentCount} {t('段')}</p>
    <p>{t('批次当前统计')}：{t('未翻译')} {currentAsset.segmentCounts.untranslated} · {t('草稿')} {currentAsset.segmentCounts.draft} · {t('已翻译')} {currentAsset.segmentCounts.translated} · {t('已审校')} {currentAsset.segmentCounts.reviewed} · QA {currentAsset.openQaCount}</p>
    <p>{t('当前阶段')}：{t(stageName(workflowStage))} · {stageFilterOptions(workflowStage).map((option) => `${t(option.label)} ${currentAsset.currentStageCounts[option.value]}`).join(' · ')}</p>
    {error && <p role="alert">{error}<Button variant="outline" size="sm" onClick={() => setRefresh((value) => value + 1)}>{t("重试")}</Button></p>}
    {!error && !page && <p role="status">{t('正在读取双语预览…')}</p>}
    {page && <>
      <p>{t('仅检查本页标签和占位符；完整质量检查请运行 QA。')}</p>
      {warnings.length > 0 && <div className={styles.warning} role="note"><strong>{t('本页 {count} 段可能缺少受保护内容', { count: warnings.length })}</strong>{warnings.slice(0, 5).map(({ segment, missing }) => <p key={segment.id}>#{segment.ordinal + 1} · {missing.join('、')}</p>)}{warnings.length > 5 && <p>{t('其余 {count} 段请在下方逐行检查', { count: warnings.length - 5 })}</p>}</div>}
      {page.total === 0 && <p role="status">{t('当前批次没有可预览的句段。')}</p>}
      {page.total > 0 && <div className={styles.rows} role="table" aria-label={t('双语句段预览')}>
        <div className={styles.heading} role="row"><span role="columnheader">#</span><span role="columnheader">{t("源文")}</span><span role="columnheader">{t("译文")}</span><span role="columnheader">{t('状态')}</span></div>
        {page.segments.map((segment) => <div className={styles.row} role="row" key={segment.id}>
          <span role="cell">#{segment.ordinal + 1}{segment.locked ? ` · ${t('锁定')}` : ''}</span>
          {[segment.source, segment.target].map((value, index) => <span role="cell" key={index} data-label={t(index ? "译文" : "源文")} lang={index ? segment.targetLocale : segment.sourceLocale} dir="auto">{splitProtectedText(value, profile).map((part, partIndex) => <span key={partIndex} className={part.kind === 'text' ? undefined : styles.token}>{part.value}</span>)}</span>)}
          <span role="cell">{t(segment.status)} · {t(stageProgressLabel(workflowStage, segment.currentStageState ?? 'untouched', Boolean(segment.target)))}</span>
        </div>)}
      </div>}
      <div className={styles.toolbar}><Button variant="outline" size="sm" disabled={offset === 0} onClick={() => setOffset((value) => Math.max(0, value - PAGE_SIZE))}>{t('上一页')}</Button><span>{page.total ? `${offset + 1}–${offset + page.segments.length} / ${page.total}` : '0'}</span><Button variant="outline" size="sm" disabled={!page.hasMore} onClick={() => setOffset((value) => value + PAGE_SIZE)}>{t('下一页')}</Button><Button variant="outline" size="sm" onClick={() => setRawOpen((value) => !value)}>{rawOpen ? t('隐藏原始文件') : t('查看原始文件')}</Button></div>
    </>}
    {rawOpen && <PreviewView request={rawRequest} onClose={() => setRawOpen(false)} />}
  </section>
}
