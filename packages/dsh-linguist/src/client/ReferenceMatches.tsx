import * as React from 'react'
import { Button } from '@deepseek-ai/dsh-client-ui-primitives'
import type {
  LinguistSegmentInfo,
  LinguistTagProfileInfo,
  LinguistTermMatchInfo,
  LinguistTmPanelItem,
} from '@linguist/domain-service/contracts'
import { InlineTaggedText } from './InlineTaggedText'
import { editorDiffParts } from './editor-diff'
import { TERM_STATUS_LABELS } from './workflow-ui'
import { useT } from './ui-locale'
import styles from './ReferenceMatches.module.css'

export interface ReferenceMatchesProps {
  segment: LinguistSegmentInfo
  tagProfile?: LinguistTagProfileInfo
  tm: readonly LinguistTmPanelItem[]
  terms: readonly LinguistTermMatchInfo[]
  editorAvailable: boolean
  currentTarget: string
  targetIsDraft: boolean
  readOnlyReason?: 'archived' | 'locked' | 'editor-closed'
  onApply: (target: string, action: 'replace' | 'insert', tmUnitId?: string) => void
  onOpenTerms: () => void
}

const matchClassLabels: Record<LinguistTmPanelItem['matchClass'], string> = {
  'double-context': '双重上下文匹配', context: '上下文匹配', exact: '精确匹配',
  'near-exact': '近似精确匹配', fuzzy: '模糊匹配',
}

/** Segment-scoped lookup only: applying a reference forwards its original target unchanged. */
export function ReferenceMatches({ segment, tagProfile, tm, terms, editorAvailable, currentTarget, targetIsDraft, readOnlyReason, onApply, onOpenTerms }: ReferenceMatchesProps): React.ReactElement {
  const t = useT()
  const id = React.useId()
  const reason = readOnlyReason ?? (segment.locked ? 'locked' : !editorAvailable ? 'editor-closed' : undefined)
  const disabled = reason !== undefined
  const reasonId = disabled ? `${id}-read-only` : undefined
  const hasSourceDiff = tm.some(item => item.matchedSource !== segment.source)
  const hasTargetDiff = tm.some(item => item.target !== currentTarget)
  const apply: ReferenceMatchesProps['onApply'] = (target, action, tmUnitId) => {
    if (!disabled) tmUnitId === undefined ? onApply(target, action) : onApply(target, action, tmUnitId)
  }
  return <div className={styles.matches}>
    {reason && <p id={reasonId} className={styles.readOnly} role="status">{t(reason === 'archived' ? '项目已归档，仅可查看参考内容。' : reason === 'locked' ? '当前句段已锁定，仅可查看参考内容。' : '先打开当前句段的译文编辑器，再插入参考内容。')}</p>}
    <section className={styles.section} aria-labelledby={`${id}-tm`} data-reference-section="tm">
      <header className={styles.sectionHeading}><h3 id={`${id}-tm`} title={t('翻译记忆')}>TM <span className={styles.count}>{tm.length}</span></h3></header>
      {(hasSourceDiff || hasTargetDiff) && <div className={styles.diffGuide}>
        {hasSourceDiff && <span>{t('源文比较：TM 原文 → 当前源文')}</span>}
        {hasTargetDiff && <span>{t(targetIsDraft ? '译文比较：TM 译文 → 当前草稿' : '译文比较：TM 译文 → 已保存译文')}</span>}
        <span className={styles.legend}><span><del>{t('删除')}</del> {t('仅 TM 中存在')}</span><span><ins>{t('新增')}</ins> {t('仅当前文本中存在')}</span></span>
      </div>}
      {tm.length === 0 ? <p className={styles.empty}>{t('没有匹配')}</p> : <div className={styles.matchList}>{tm.map(item => <TmMatch key={item.id} item={item} segment={segment} currentTarget={currentTarget} targetIsDraft={targetIsDraft} tagProfile={tagProfile} disabled={disabled} reasonId={reasonId} onApply={apply} />)}</div>}
    </section>
    <section className={styles.section} aria-labelledby={`${id}-tb`} data-reference-section="tb">
      <header className={styles.sectionHeading}><h3 id={`${id}-tb`} title={t('术语')}>TB <span className={styles.count}>{terms.length}</span></h3><Button type="button" variant="ghost" size="sm" onClick={onOpenTerms}>{t('打开术语库')}</Button></header>
      {terms.length === 0 ? <p className={styles.empty}>{t('没有匹配')}</p> : <div className={styles.matchList}>{terms.map(item => <TermMatch key={`${item.id}:${item.start}`} item={item} segment={segment} tagProfile={tagProfile} disabled={disabled} reasonId={reasonId} onApply={apply} />)}</div>}
    </section>
  </div>
}

interface MatchProps {
  segment: LinguistSegmentInfo
  tagProfile?: LinguistTagProfileInfo
  disabled: boolean
  reasonId?: string
  onApply: ReferenceMatchesProps['onApply']
}

function TmMatch({ item, segment, tagProfile, currentTarget, targetIsDraft, disabled, reasonId, onApply }: MatchProps & Pick<ReferenceMatchesProps, 'currentTarget' | 'targetIsDraft'> & { item: LinguistTmPanelItem }): React.ReactElement {
  const t = useT()
  const differs = item.matchedSource !== segment.source
  const parts = React.useMemo(() => differs ? editorDiffParts(item.matchedSource, segment.source, tagProfile, segment.targetLocale) : [], [differs, item.matchedSource, segment.source, tagProfile, segment.targetLocale])
  const targetDiffers = item.target !== currentTarget
  const targetParts = React.useMemo(() => targetDiffers ? editorDiffParts(item.target, currentTarget, tagProfile, segment.targetLocale) : [], [targetDiffers, item.target, currentTarget, tagProfile, segment.targetLocale])
  const renderDiff = (changes: ReturnType<typeof editorDiffParts>) => changes.map((part, index) => {
    const content = <InlineTaggedText text={part.text} sourceText={part.kind === 'remove' ? item.matchedSource : segment.source} tagProfile={tagProfile} targetLocale={segment.targetLocale} />
    return part.kind === 'remove' ? <del key={index} data-diff-kind="remove">{content}</del> : part.kind === 'insert' ? <ins key={index} data-diff-kind="insert">{content}</ins> : <React.Fragment key={index}>{content}</React.Fragment>
  })
  return <article className={styles.matchCard} data-reference-tm={item.id} data-match-class={item.matchClass}>
    <header className={styles.matchHeading}>
      <strong className={styles.score}>{Math.round(item.score)}%</strong>
      {item.baseScore !== undefined && item.baseScore !== item.score && <span>{t('原始匹配分')} {item.baseScore}%</span>}
      <span className={styles.matchClass}>{t(matchClassLabels[item.matchClass])}</span>
      <span className={styles.safety} data-review={item.safety === 'review' || differs || undefined}>{t(item.safety === 'review' ? '需检查' : differs ? '核对差异' : '可复用')}</span>
    </header>
    <div className={styles.textBlock}>
      <span className={styles.fieldLabel}>{t(differs ? '源文差异（TM → 当前）' : 'TM 原文')}</span>
      {differs ? <p className={styles.text} lang={segment.sourceLocale} data-source-comparison="tm-to-current">{renderDiff(parts)}</p> : <p className={styles.text} lang={segment.sourceLocale} data-tm-source="original"><InlineTaggedText text={item.matchedSource} tagProfile={tagProfile} targetLocale={segment.targetLocale} /></p>}
    </div>
    <div className={styles.textBlock}>
      <span className={styles.fieldLabel}>{t(targetDiffers ? targetIsDraft ? '译文差异（TM → 当前草稿）' : '译文差异（TM → 已保存译文）' : 'TM 译文')}</span>
      {targetDiffers ? <p className={styles.text} lang={segment.targetLocale} data-target-comparison="tm-to-current" data-tm-target>{renderDiff(targetParts)}</p>
        : <p className={styles.text} lang={segment.targetLocale} data-tm-target><InlineTaggedText text={item.target} sourceText={item.matchedSource} tagProfile={tagProfile} targetLocale={segment.targetLocale} /></p>}
    </div>
    <div className={styles.actions}>
      <Button type="button" variant="outline" size="sm" disabled={disabled} aria-describedby={reasonId} onClick={() => onApply(item.target, 'replace', item.id)}>{t('替换草稿')}</Button>
      <Button type="button" variant="ghost" size="sm" disabled={disabled} aria-describedby={reasonId} onClick={() => onApply(item.target, 'insert', item.id)}>{t('插入草稿')}</Button>
    </div>
    {item.adaptation?.candidate !== undefined && <div className={styles.textBlock}>
      <span className={styles.fieldLabel}>{t('适配候选')}</span>
      <p className={styles.text} lang={segment.targetLocale}><InlineTaggedText text={item.adaptation.candidate} sourceText={segment.source} tagProfile={tagProfile} targetLocale={segment.targetLocale} /></p>
      <p>{item.adaptation.replacements.map(change => `${change.from} → ${change.to}`).join(' · ')}</p>
      <Button type="button" variant="outline" size="sm" disabled={disabled} aria-describedby={reasonId} onClick={() => onApply(item.adaptation!.candidate!, 'replace', item.id)}>{t('使用适配候选')}</Button>
    </div>}
    {item.adaptation?.status === 'needs-review' && <p className={styles.warning}>{t('适配需判断')}</p>}
    <p className={styles.provenance}><span>{t('来源')}：</span>{item.sourceLabel}</p>
    <details className={styles.details}>
      <summary>{t(differs || targetDiffers ? '匹配详情与 TM 原始文本' : '匹配详情')}{item.warnings.length > 0 && <span className={styles.warningCount}>{t('{count} 条警告', { count: item.warnings.length })}</span>}</summary>
      <div className={styles.detailBody}>
        {differs && <div className={styles.originalText}><span className={styles.fieldLabel}>{t('TM 原文（未改动）')}</span><p className={styles.text} lang={segment.sourceLocale} data-tm-source="original"><InlineTaggedText text={item.matchedSource} tagProfile={tagProfile} targetLocale={segment.targetLocale} /></p></div>}
        {targetDiffers && <div className={styles.originalText}><span className={styles.fieldLabel}>{t('TM 译文（原始文本）')}</span><p className={styles.text} lang={segment.targetLocale} data-tm-target="original"><InlineTaggedText text={item.target} sourceText={item.matchedSource} tagProfile={tagProfile} targetLocale={segment.targetLocale} /></p></div>}
        <dl className={styles.metadata}>
          <dt>{t('来源数量')}</dt><dd>{t('{count} 个来源', { count: item.provenanceCount })}</dd>
          <dt>{t('译文变体')}</dt><dd>{t('{count} 个译文变体', { count: item.variantCount })}</dd>
          {item.badges.length > 0 && <><dt>{t('来源标记')}</dt><dd>{item.badges.join(' · ')}</dd></>}
        </dl>
        {item.warnings.length > 0 && <div className={styles.detailGroup}><strong className={styles.warning}>{t('复用警告')}</strong><ul className={styles.warning}>{item.warnings.map((warning, index) => <li key={index}>{warning}</li>)}</ul></div>}
        {item.differences.length > 0 && <div className={styles.detailGroup}><strong>{t('差异 {count} 项', { count: item.differences.length })}</strong><ul>{item.differences.map((difference, index) => <li key={index}>{difference}</li>)}</ul></div>}
      </div>
    </details>
  </article>
}

function TermMatch({ item, segment, tagProfile, disabled, reasonId, onApply }: MatchProps & { item: LinguistTermMatchInfo }): React.ReactElement {
  const t = useT()
  return <article className={styles.matchCard} data-reference-term={item.id} data-term-status={item.status}>
    <div className={styles.termPair}>
      <span className={styles.termSource} lang={segment.sourceLocale}><InlineTaggedText text={item.term} sourceText={segment.source} tagProfile={tagProfile} targetLocale={segment.targetLocale} /></span>
      <span className={styles.arrow} aria-label={t('对应译法')}>→</span>
      <strong className={styles.termTranslation} lang={segment.targetLocale}><InlineTaggedText text={item.translation} sourceText={item.term} tagProfile={tagProfile} targetLocale={segment.targetLocale} /></strong>
    </div>
    <div className={styles.termActions}>
      <span className={styles.termStatus} data-status={item.status}>{t(TERM_STATUS_LABELS[item.status])}</span>
      {item.conflict && <strong className={styles.conflict}>{t('译文冲突')}</strong>}
      <Button type="button" variant="ghost" size="sm" disabled={disabled} aria-describedby={reasonId} onClick={() => onApply(item.translation, 'insert')}>{t('插入草稿')}</Button>
    </div>
    {item.note && <p className={styles.termNote}>{item.note}</p>}
    <details className={styles.details}>
      <summary>{t('术语详情')}</summary>
      <div className={styles.detailBody}>
        <dl className={styles.metadata}>
          <dt>{t('源文匹配')}</dt><dd>{t(item.matchType === 'exact' ? '精确匹配' : '包含匹配')} · {t(item.caseSensitive ? '区分大小写' : '不区分大小写')}</dd>
          <dt>{t('命中原文')}</dt><dd lang={segment.sourceLocale}><InlineTaggedText text={segment.source.slice(item.start, item.end)} sourceText={segment.source} tagProfile={tagProfile} targetLocale={segment.targetLocale} /></dd>
          {item.module && <><dt>{t('模块')}</dt><dd>{item.module}</dd></>}
          {item.category && <><dt>{t('类别')}</dt><dd>{item.category}</dd></>}
        </dl>
        {item.sources?.map((source, index) => <p key={`${source.id}:${index}`}><strong>{t('来源')}：</strong>{source.filename} · {source.term} → {source.translation}{source.note ? ` · ${source.note}` : ''}</p>)}
        {item.lowDiscrimination && <p className={styles.warning}>{t('短术语匹配，请结合上下文核对。')}</p>}
      </div>
    </details>
  </article>
}
