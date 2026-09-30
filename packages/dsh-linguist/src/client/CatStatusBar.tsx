import * as React from 'react'
import type { LinguistProjectSummary, LinguistSegmentInfo, LinguistStageDecisionCoverage } from '@linguist/domain-service/contracts'
import { required } from './api'
import { stageCompletionLabel, stageName, stageProgressLabel } from './workflow-ui'
import { useT } from './ui-locale'
import styles from './CatStatusBar.module.css'

export function CatStatusBar({ projectId, assetId, summary, active, selectedCount, revision }: {
  projectId: string; assetId?: string; summary?: LinguistProjectSummary; active?: LinguistSegmentInfo; selectedCount: number; revision: string
}): React.ReactElement {
  const t = useT()
  const stage = summary?.project.workflowStage ?? 'translation'
  const scope = `${projectId}:${assetId ?? ''}:${stage}:${revision}`
  const [result, setResult] = React.useState<{ scope: string; coverage?: LinguistStageDecisionCoverage; error?: string }>()
  React.useEffect(() => {
    let live = true
    setResult(undefined)
    if (assetId) void required<LinguistStageDecisionCoverage>('linguistProjectsGetStageCoverage', { projectId, assetId, workflowStage: stage })
      .then((coverage) => { if (live) setResult({ scope, coverage }) })
      .catch((error: unknown) => { if (live) setResult({ scope, error: String(error) }) })
    return () => { live = false }
  }, [projectId, assetId, stage, scope])

  const batch = summary?.assets.find((item) => item.assetId === assetId)
  const assets = assetId ? batch && [batch] : summary?.assets
  const counts = assetId ? batch?.currentStageCounts : summary?.currentStageCounts
  const total = assetId ? batch?.segmentCount : summary?.totalSegments
  const coverage = result?.scope === scope ? result.coverage : undefined
  const error = result?.scope === scope ? result.error : undefined
  return <footer className={styles.statusBar} aria-label={t('本地化工作台状态栏')}>
    <span className={styles.scope} title={batch?.filename}>{assetId ? batch?.filename : t('全部批次')}</span>
    {assets && <span className={styles.characters}>{t('源文')} <strong>{assets.reduce((sum, item) => sum + item.sourceCharacters, 0).toLocaleString()}</strong> {t('字符')}<span aria-hidden="true"> · </span>{t('译文')} <strong>{assets.reduce((sum, item) => sum + item.targetCharacters, 0).toLocaleString()}</strong> {t('字符')}</span>}
    {counts && total !== undefined && <span className={styles.progress}>
      <progress aria-label={t(stageCompletionLabel(stage))} value={counts.confirmed} max={total || 1} />
      <span>{t(stageCompletionLabel(stage))} <strong>{counts.confirmed.toLocaleString()} / {total.toLocaleString()}</strong></span>
      {counts.draft > 0 && <span>{t(stageProgressLabel(stage, 'draft', true))} {counts.draft.toLocaleString()}</span>}
    </span>}
    {active && <span title={active.id}>{t('当前句段')} <strong>#{active.ordinal + 1}</strong></span>}
    {selectedCount > 0 && <span>{t('已选 {count} 段', { count: selectedCount })}</span>}
    <span className={styles.shortcuts}>{t('↑↓ 切换 · Enter 编辑 · Esc 取消')}</span>
    {coverage && (coverage.total > coverage.pending || coverage.blocked > 0) && <span className={styles.coverage} title={t('阶段决策覆盖不等于正式交付完成；仍需处理 QA、建议与交付预检。')}>
      {t('{stage}决策', { stage: t(stageName(stage)) })} <strong>{stage === 'translation' ? coverage.confirmed : coverage.total - coverage.pending} / {coverage.total}</strong>
      {stage !== 'translation' && <> · {t('未修改')} {coverage.unchanged} · {t('已修正')} {coverage.corrected}</>}
      {' · '}{t('阻塞')} {coverage.blocked}
    </span>}
    {error && <span role="alert" className={styles.error}>{t('决策覆盖读取失败')}：{error}</span>}
  </footer>
}
