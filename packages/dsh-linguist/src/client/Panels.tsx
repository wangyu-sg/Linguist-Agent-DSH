import * as React from 'react'
import { Button, Input } from '@deepseek-ai/dsh-client-ui-primitives'
import type {
  LinguistAssetInfo,
  LinguistAssetsQueryResult,
  LinguistBackupInfo,
  LinguistCatContextResult,
  LinguistCatListQaFindingsResult,
  LinguistContextDocInfo,
  LinguistDeliveryPreflight,
  LinguistExportFileInfo,
  LinguistPrepareDeliveryResult,
  LinguistProjectInfo,
  LinguistProjectImportResult,
  LinguistProposalDiff,
  LinguistApplyTranslationsResult,
  LinguistProposalListResult,
  LinguistQaFindingInfo,
  LinguistReferenceImportResult,
  LinguistReferenceQueryResult,
  LinguistSentencePatternInfo,
  LinguistStyleGuideRuleInfo,
  LinguistTermInfo,
  LinguistTermConflictInfo,
  LinguistTermConflictsResult,
  LinguistTermsDeleteResult,
  LinguistTermsValidateResult,
  LinguistTmReferenceInfo,
  LinguistUnknownTagPatternInfo,
  LinguistVoiceProfileInfo,
  LinguistWorkflowStage,
  LinguistXlsxMappingPreviewSheet,
} from '@linguist/domain-service/contracts'
import { fileUrl, required, stageFiles } from './api'
import { describeLinguistFormat, isGenericXliffFallback } from './format-labels'
import { PreviewView, type PreviewRequest } from './PreviewView'
import { describeProjectError } from './project-errors'
import { qaSeverityLabel, qaSeverityTier, qaTierLabel } from './qa-severity'
import { groupProposalRuns, textDiffParts } from './proposal-view'
import { useT } from './ui-locale'
import styles from './Panels.module.css'

export function QaPanel({ projectId, assetId, segmentId, focusFindingId, focusSegmentId, archived, onNavigate, onChanged }: { projectId: string; assetId?: string; segmentId?: string; focusFindingId?: string; focusSegmentId?: string; archived: boolean; onNavigate: (id: string) => void; onChanged: () => void }): React.ReactElement {
  const t = useT()
  const [list, setList] = React.useState<LinguistCatListQaFindingsResult>()
  const [status, setStatus] = React.useState('open')
  const [severity, setSeverity] = React.useState('')
  const [disposition, setDisposition] = React.useState('')
  const [page, setPage] = React.useState(0)
  const [operator, setOperator] = React.useState('')
  const [reason, setReason] = React.useState('')
  const [message, setMessage] = React.useState('')
  const [refresh, setRefresh] = React.useState(0)
  const [bulkWaiver, setBulkWaiver] = React.useState<{code:string;findingIds:string[];total:number}>()
  const [scopedSegmentId, setScopedSegmentId] = React.useState(focusSegmentId)
  React.useEffect(() => setScopedSegmentId(focusSegmentId), [focusSegmentId])
  React.useEffect(() => { if (focusFindingId) { setStatus(''); setPage(0) } }, [focusFindingId])
  React.useEffect(() => {
    let live = true
    required<LinguistCatListQaFindingsResult>('linguistCatListQaFindings', { projectId, assetId: scopedSegmentId ? undefined : assetId, segmentId: scopedSegmentId, status: status || undefined, severity: severity || undefined, disposition: disposition || undefined, limit: 100, offset: page * 100 })
      .then((next) => { if (live) { setList(next); setMessage('') } }).catch((error: unknown) => { if (live) setMessage(describeProjectError(error, t)) })
    return () => { live = false }
  }, [projectId, assetId, scopedSegmentId, status, severity, disposition, page, refresh])
  const mutate = async (operation: string, input: object): Promise<boolean> => {
    if (archived) return false
    try { await required(operation, input); setRefresh((value) => value + 1); onChanged(); setMessage(t("操作已完成")); return true }
    catch (error) { setMessage(describeProjectError(error, t)); return false }
  }
  const prepareBulkWaiver = async (code: string) => {
    try {
      const found = await required<LinguistCatListQaFindingsResult>('linguistCatListQaFindings', { projectId, code, status: 'open', limit: 200, offset: 0 })
      setBulkWaiver({ code, findingIds: found.items.map((item) => item.id), total: found.total })
    } catch (error) { setMessage(describeProjectError(error, t)) }
  }
  const confirmBulkWaiver = async () => {
    if (!bulkWaiver || !reason.trim() || !operator.trim() || archived) return
    if (await mutate('linguistCatWaiveQaFindingsBulk', { projectId, findingIds: bulkWaiver.findingIds, reason: reason.trim(), operator: operator.trim() })) setBulkWaiver(undefined)
  }
  return <section className={styles.panel} aria-label="QA Findings">
    <div className={styles.toolbar}><strong>QA Findings {list?.total ?? ''}</strong><select aria-label={t("QA 状态")} value={status} onChange={(event) => { setStatus(event.target.value); setPage(0) }}><option value="open">{t("开放")}</option><option value="resolved">{t("已解决")}</option><option value="waived">{t("已豁免")}</option><option value="">{t("全部")}</option></select><select aria-label={t("严重度")} value={severity} onChange={(event) => { setSeverity(event.target.value); setPage(0) }}><option value="">{t("全部等级")}</option>{(['L0','L1','L2','L3','L4'] as const).map((item) => <option key={item} value={item}>{t(qaSeverityLabel(item))} · {t(qaTierLabel(qaSeverityTier(item)))}</option>)}</select><select aria-label={t('QA 处置')} value={disposition} onChange={(event) => { setDisposition(event.target.value); setPage(0) }}><option value="">{t('全部处置')}</option><option value="defect">{t('缺陷')}</option><option value="needs_review">{t('需要人工复核')}</option><option value="query">{t('疑问')}</option><option value="info">{t('信息')}</option></select>{scopedSegmentId && <Button size="sm" onClick={() => { setScopedSegmentId(undefined); setPage(0) }}>{t('显示完整 QA 范围')}</Button>}<Button size="sm" disabled={archived || !assetId} onClick={() => assetId && void mutate('linguistCatRunQa', { projectId, assetId })}>{t("运行 QA")}</Button><Button size="sm" onClick={() => setRefresh((value) => value + 1)}>{t("刷新")}</Button></div>
    <div className={styles.toolbar}><Input disabled={archived} maxLength={120} aria-label={t("豁免操作人")} placeholder={t("豁免操作人")} value={operator} onChange={(event) => setOperator(event.target.value)} /><Input disabled={archived} maxLength={500} aria-label={t("豁免理由")} placeholder={t("填写豁免理由")} value={reason} onChange={(event) => setReason(event.target.value)} /></div>
    {bulkWaiver && <div className={styles.callout} role="alert"><p>{t('将在整个项目中豁免规则 {code} 的 {count} 条开放 Finding。', { code: bulkWaiver.code, count: bulkWaiver.findingIds.length })}{bulkWaiver.total > bulkWaiver.findingIds.length && ` ${t('该规则共 {total} 条，本批只处理前 {count} 条。', { total: bulkWaiver.total, count: bulkWaiver.findingIds.length })}`}</p><p>{t('理由')}：{reason} · {t('操作者')}：{operator}</p><Button size="sm" disabled={archived || bulkWaiver.findingIds.length === 0 || !reason.trim() || !operator.trim()} onClick={() => void confirmBulkWaiver()}>{t('确认项目范围豁免')}</Button><Button size="sm" onClick={() => setBulkWaiver(undefined)}>{t('取消')}</Button></div>}
    {message && <p role="status">{message}</p>}
    {list?.items.length === 0 && <p>{t("当前筛选没有 Finding。")}</p>}
    {list?.items.map((finding: LinguistQaFindingInfo) => <article key={finding.id} className={finding.id === focusFindingId || finding.segmentId === segmentId ? styles.selected : styles.item}>
      <div><strong className={styles[qaSeverityTier(finding.severity)]}>{t(qaSeverityLabel(finding.severity))} · {t(qaTierLabel(qaSeverityTier(finding.severity)))} · {finding.code}</strong> <span>{finding.issueType} · {finding.disposition} · {finding.status}</span>{finding.currentRevision !== finding.segmentRevision && <span> · {t('已过时，需重跑 QA')}</span>}</div><p>{finding.message}</p>{finding.waiverReason && <p>{t('豁免理由')}：{finding.waiverReason} · {finding.waivedBy ?? t('未知操作人')}</p>}
      <div className={styles.toolbar}><Button size="sm" onClick={() => onNavigate(finding.segmentId)}>{t("定位句段")}</Button>{finding.status === 'open' && <>
        <Button size="sm" disabled={archived || finding.currentRevision <= finding.segmentRevision} title={finding.currentRevision <= finding.segmentRevision ? t("需先修改句段") : undefined} onClick={() => void mutate('linguistCatResolveQaFinding', { projectId, findingId: finding.id })}>{t("标记已解决")}</Button>
        <Button size="sm" disabled={archived || !reason.trim() || !operator.trim()} onClick={() => void mutate('linguistCatWaiveQaFinding', { projectId, findingId: finding.id, reason: reason.trim(), operator: operator.trim() })}>{t("豁免")}</Button>
        {!scopedSegmentId && <Button size="sm" disabled={archived || !reason.trim() || !operator.trim()} onClick={() => void prepareBulkWaiver(finding.code)}>{t("豁免项目内同规则")}</Button>}
      </>}</div>
    </article>)}
    <div className={styles.toolbar}><Button size="sm" disabled={page === 0} onClick={() => setPage((value) => value - 1)}>{t("上一页")}</Button><span>{t("第")} {page + 1} {t("页")}</span><Button size="sm" disabled={!list?.hasMore} onClick={() => setPage((value) => value + 1)}>{t("下一页")}</Button></div>
  </section>
}

export function ProposalPanel({ projectId, assetId, segmentIds, focusProposalId, archived, onNavigate, onChanged }: { projectId: string; assetId?: string; segmentIds: readonly string[]; focusProposalId?: string; archived: boolean; onNavigate: (id: string) => void; onChanged: () => void }): React.ReactElement {
  const t = useT()
  const [list, setList] = React.useState<LinguistProposalListResult>()
  const [status, setStatus] = React.useState('pending')
  const [page, setPage] = React.useState(0)
  const [selected, setSelected] = React.useState<ReadonlySet<string>>(new Set())
  const [bulkReview, setBulkReview] = React.useState<{ operation: 'accept' | 'reject'; idempotencyKey: string; selectedCount: number; items: Array<{ proposalId: string; expectedRevision: number }>; excluded: Array<{ ordinal: number; reason: string }> }>()
  const [edits, setEdits] = React.useState<Record<string,string>>({})
  const [message, setMessage] = React.useState('')
  const [batchRows, setBatchRows] = React.useState<LinguistCatContextResult[]>()
  const [batchTargets, setBatchTargets] = React.useState<Record<string, string>>({})
  const [batchResult, setBatchResult] = React.useState<LinguistApplyTranslationsResult>()
  const [batchBusy, setBatchBusy] = React.useState(false)
  const [refresh, setRefresh] = React.useState(0)
  const [focusedDiff, setFocusedDiff] = React.useState<LinguistProposalDiff>()
  React.useEffect(() => {
    if (!focusProposalId) { setFocusedDiff(undefined); return }
    let live = true
    required<LinguistProposalDiff>('linguistProposalsGetDiff', { projectId, proposalId: focusProposalId })
      .then((diff) => { if (live) setFocusedDiff(diff) })
      .catch((error: unknown) => { if (live) setMessage(describeProjectError(error, t)) })
    return () => { live = false }
  }, [projectId, focusProposalId, refresh])
  React.useEffect(() => {
    let live = true
    required<LinguistProposalListResult>('linguistProposalsList', { projectId, assetId, status: status || undefined, limit: 100, offset: page * 100 })
      .then((next) => { if (live) { setList(next); setSelected(new Set()); setMessage('') } }).catch((error: unknown) => { if (live) setMessage(describeProjectError(error, t)) })
    return () => { live = false }
  }, [projectId, assetId, status, page, refresh])
  const mutate = async (operation: string, input: object): Promise<boolean> => {
    if (archived) return false
    try { await required(operation, input); setRefresh((value) => value + 1); onChanged(); setMessage(t("建议已处理")); return true }
    catch (error) { setMessage(describeProjectError(error, t)); setRefresh((value) => value + 1); return false }
  }
  const prepareBulk = async (operation: 'accept' | 'reject') => {
    if (archived || selected.size === 0) return
    try {
      const latest = await Promise.all([...selected].map((proposalId) => required<LinguistProposalDiff>('linguistProposalsGetDiff', { projectId, proposalId })))
      const items: Array<{ proposalId: string; expectedRevision: number }> = []
      const excluded: Array<{ ordinal: number; reason: string }> = []
      for (const diff of latest) {
        const reason = diff.proposal.status !== 'pending' ? t('建议已处理') : operation === 'accept' && diff.locked ? t('片段已锁定') : operation === 'accept' && diff.currentRevision !== diff.baseRevision ? t('建议基于旧版本') : ''
        if (reason) excluded.push({ ordinal: diff.originalOrdinal + 1, reason })
        else items.push({ proposalId: diff.proposal.id, expectedRevision: diff.currentRevision })
      }
      setBulkReview({ operation, idempotencyKey: crypto.randomUUID(), selectedCount: selected.size, items, excluded })
    } catch (cause) { setMessage(describeProjectError(cause, t)) }
  }
  const confirmBulk = async () => {
    if (!bulkReview?.items.length) return
    if (await mutate(bulkReview.operation === 'accept' ? 'linguistProposalsAcceptSelected' : 'linguistProposalsRejectSelected', { projectId, items: bulkReview.items, idempotencyKey: bulkReview.idempotencyKey })) setBulkReview(undefined)
  }
  const loadBatch = async () => {
    setBatchBusy(true)
    try {
      const rows = await Promise.all(segmentIds.map((segmentId) => required<LinguistCatContextResult>('linguistCatGetContext', { projectId, segmentId })))
      setBatchRows(rows)
      setBatchTargets(Object.fromEntries(rows.map((row) => [row.segment.id, row.segment.target])))
      setBatchResult(undefined)
      setMessage('')
    } catch (error) { setMessage(describeProjectError(error, t)) }
    finally { setBatchBusy(false) }
  }
  const applyBatch = async (mode: 'apply' | 'proposal') => {
    if (archived) return
    const edits = batchRows?.filter((row) => batchTargets[row.segment.id] !== row.segment.target).map((row) => ({
      segmentId: row.segment.id, baseRevision: row.segment.revision, target: batchTargets[row.segment.id]!,
    })) ?? []
    if (edits.length === 0) return
    setBatchBusy(true)
    try {
      const result = await required<LinguistApplyTranslationsResult>('linguistProposalsApplyTranslations', { projectId, edits, mode })
      setBatchResult(result)
      setBatchRows(undefined)
      setRefresh((value) => value + 1)
      onChanged()
      setMessage(t('批量译文操作完成；按下方逐项结果核对。'))
    } catch (error) { setMessage(describeProjectError(error, t)) }
    finally { setBatchBusy(false) }
  }
  const refreshDiff = async (proposalId: string) => {
    try {
      const diff = await required<LinguistProposalDiff>('linguistProposalsGetDiff', { projectId, proposalId })
      setList((current) => current && { ...current, items: current.items.map((item) => item.proposal.id === proposalId ? diff : item) })
      setEdits((current) => { const next = { ...current }; delete next[proposalId]; return next })
      setMessage(t('已核对最新建议差异'))
    } catch (error) { setMessage(describeProjectError(error, t)) }
  }
  const visibleProposals = focusedDiff && !list?.items.some((item) => item.proposal.id === focusedDiff.proposal.id)
    ? [focusedDiff, ...(list?.items ?? [])] : list?.items ?? []
  return <section className={styles.panel} aria-label="Proposal Inbox">
    <div className={styles.toolbar}><strong>{t("建议")} {list?.total ?? ''}</strong><select aria-label={t("建议状态")} value={status} onChange={(event) => { setStatus(event.target.value); setPage(0); setBulkReview(undefined) }}><option value="pending">{t("待审")}</option><option value="accepted">{t("已接受")}</option><option value="rejected">{t("已拒绝")}</option><option value="superseded">{t("已替代")}</option><option value="expired">{t("已过期")}</option><option value="">{t("全部")}</option></select><Button size="sm" disabled={archived || selected.size === 0} onClick={() => void prepareBulk('accept')}>{t("接受所选")}</Button><Button size="sm" disabled={archived || selected.size === 0} onClick={() => void prepareBulk('reject')}>{t("拒绝所选")}</Button></div>
    {bulkReview && <div className={styles.callout} role="alert"><p>{t('已选择 {selected} 条建议，实际可{action} {actionable} 条。', { selected: bulkReview.selectedCount, action: t(bulkReview.operation === 'accept' ? '接受' : '拒绝'), actionable: bulkReview.items.length })}</p>{bulkReview.excluded.length > 0 && <><p>{t('以下 {count} 项不会执行：', { count: bulkReview.excluded.length })}</p><ul>{bulkReview.excluded.map((item, index) => <li key={index}>#{item.ordinal}：{item.reason}</li>)}</ul></>}<Button size="sm" disabled={archived || bulkReview.items.length === 0} onClick={() => void confirmBulk()}>{t('确认批量处理')}</Button><Button size="sm" onClick={() => setBulkReview(undefined)}>{t('取消')}</Button></div>}
    <details className={styles.callout}><summary>{t('对所选句段批量编辑译文')}</summary><p>{t('可先创建待审建议，或直接写入 Target；两种操作都逐段检查版本与标签。')}</p><div className={styles.toolbar}><Button size="sm" disabled={batchBusy || segmentIds.length === 0 || segmentIds.length > 200} onClick={() => void loadBatch()}>{t('读取所选句段 {count} 段', { count: segmentIds.length })}</Button></div>
      {batchRows && <div className={styles.batchTargets}>{batchRows.map((row) => <label key={row.segment.id}><span>#{row.segment.ordinal} · {row.segment.source}</span><textarea disabled={archived} value={batchTargets[row.segment.id] ?? ''} onChange={(event) => setBatchTargets((current) => ({ ...current, [row.segment.id]: event.target.value }))} /></label>)}</div>}
      {batchRows && <div className={styles.toolbar}><Button size="sm" disabled={archived || batchBusy || !batchRows.some((row) => batchTargets[row.segment.id] !== row.segment.target)} onClick={() => void applyBatch('proposal')}>{t('创建待审建议')}</Button><Button size="sm" disabled={archived || batchBusy || !batchRows.some((row) => batchTargets[row.segment.id] !== row.segment.target)} onClick={() => void applyBatch('apply')}>{t('立即应用到 Target')}</Button></div>}
      {batchResult && <div role="status"><p>{t('请求 {requested} · 已应用 {applied} · 待审 {pending} · 过期 {stale} · 锁定 {locked} · 失败 {failed}', { requested: batchResult.requested, applied: batchResult.applied, pending: batchResult.pending, stale: batchResult.stale.length, locked: batchResult.locked.length, failed: batchResult.failed.length })}</p>{batchResult.stale.map((id) => <p key={`stale:${id}`}><Button size="sm" onClick={() => onNavigate(id)}>{id}</Button> · {t('版本已过期')}</p>)}{batchResult.locked.map((id) => <p key={`locked:${id}`}><Button size="sm" onClick={() => onNavigate(id)}>{id}</Button> · {t('句段已锁定')}</p>)}{batchResult.failed.map((item) => <p key={`failed:${item.segmentId}`}><Button size="sm" onClick={() => onNavigate(item.segmentId)}>{item.segmentId}</Button> · {item.code}</p>)}</div>}
    </details>
    {message && <p role="status">{message}</p>}
    {visibleProposals.length === 0 && <p>{t("当前筛选没有建议。")}</p>}
    {groupProposalRuns(visibleProposals).map((group) => <section key={group.runId} className={styles.proposalRun}>
      <div className={styles.toolbar}><strong>{group.runId === 'legacy' ? t('旧记录（无运行 ID）') : `Run ${group.runId}`}</strong><small>{t('创建于 {time}', { time: new Date(group.createdAt).toLocaleString() })}</small>{group.modelId && <small>Model {group.modelId}</small>}{group.sessionId && <small>Session {group.sessionId}</small>}{Object.entries(group.statusCounts).map(([state, count]) => <small key={state}>{t(state)} {count}</small>)}</div>
      {group.items.map((diff: LinguistProposalDiff) => {
      const valid = diff.proposal.status === 'pending' && !diff.locked && diff.currentRevision === diff.baseRevision
      const pending = diff.proposal.status === 'pending'
      const parts = textDiffParts(diff.currentTarget, diff.proposedTarget)
      return <article className={diff.proposal.id === focusProposalId ? styles.selected : styles.item} key={diff.proposal.id}>
        <div className={styles.toolbar}><input type="checkbox" aria-label={t('选择建议 {id}', { id: diff.proposal.id })} checked={selected.has(diff.proposal.id)} disabled={archived || !pending} onChange={() => { setBulkReview(undefined); setSelected((current) => { const next = new Set(current); if (next.has(diff.proposal.id)) next.delete(diff.proposal.id); else next.add(diff.proposal.id); return next }) }} /><strong>#{diff.originalOrdinal + 1} · {t(diff.proposal.status)}</strong>{pending && !valid && <span>{t("修订已变或锁定，不能直接接受")}</span>}<Button size="sm" onClick={() => onNavigate(diff.proposal.segmentId)}>{t("定位")}</Button><Button size="sm" onClick={() => void refreshDiff(diff.proposal.id)}>{t('核对最新差异')}</Button></div>
        <div className={styles.compare}><div><small>Source</small><p>{diff.source}</p></div><div><small>{t("当前 Target")}</small><p>{parts.filter((part) => part.kind !== 'insert').map((part, index) => <span key={index} className={part.kind === 'remove' ? styles.removed : undefined}>{part.text}</span>)}</p></div><div><small>{t("建议 Target")}</small><p>{parts.filter((part) => part.kind !== 'remove').map((part, index) => <span key={index} className={part.kind === 'insert' ? styles.added : undefined}>{part.text}</span>)}</p></div></div>
        <small>{t("证据")} {diff.proposal.evidenceRefs.join('、') || t("无")} {t("· 术语")} {diff.proposal.termRefs.join('、') || t("无")} · {diff.proposal.modelId ?? t("模型未记录")}</small>
        <small>{t('基础版本 {base} · 当前版本 {current}', { base: diff.baseRevision, current: diff.currentRevision })} · {t('创建于 {time}', { time: new Date(diff.proposal.createdAt).toLocaleString() })}</small>
        {diff.latestIssuance && <details><summary>{t('本次建议的生成依据')}</summary><p>Provider {diff.latestIssuance.modelProvider ?? t('未记录')} · Model {diff.latestIssuance.modelId ?? t('未记录')} · Runtime {diff.latestIssuance.runtime ?? t('未记录')}</p><p>Prompt {diff.latestIssuance.linguistPromptVersion ?? t('未记录')} · hash {diff.latestIssuance.promptHash ?? t('未记录')}</p><p>Project digest {diff.latestIssuance.projectDigestRevision ?? t('未记录')} · hash {diff.latestIssuance.projectDigestHash ?? t('未记录')}</p><p>Toolset hash {diff.latestIssuance.toolsetHash ?? t('未记录')} · Turn context hash {diff.latestIssuance.turnContextHash ?? t('未记录')}</p></details>}
        {diff.proposal.warnings.map((warning, index) => <p key={index} role="note">{warning}</p>)}
        <div className={styles.toolbar}><textarea className={styles.proposalTarget} disabled={archived} aria-label={t('编辑建议 {id}', { id: diff.proposal.id })} value={edits[diff.proposal.id] ?? diff.proposedTarget} onChange={(event) => setEdits((current) => ({ ...current, [diff.proposal.id]: event.target.value }))} /><Button size="sm" disabled={archived || !valid} onClick={() => void mutate('linguistProposalsAccept', { projectId, proposalId: diff.proposal.id, expectedRevision: diff.currentRevision, idempotencyKey: crypto.randomUUID() })}>{t("接受")}</Button><Button size="sm" disabled={archived || !valid || !(edits[diff.proposal.id] ?? diff.proposedTarget).trim()} onClick={() => void mutate('linguistProposalsEditAndAccept', { projectId, proposalId: diff.proposal.id, expectedRevision: diff.currentRevision, editedTarget: edits[diff.proposal.id] ?? diff.proposedTarget, idempotencyKey: crypto.randomUUID() })}>{t("编辑并接受")}</Button><Button size="sm" disabled={archived || !pending} onClick={() => void mutate('linguistProposalsReject', { projectId, proposalId: diff.proposal.id, expectedRevision: diff.currentRevision, idempotencyKey: crypto.randomUUID() })}>{t("拒绝")}</Button>{diff.proposal.status !== 'pending' && <Button size="sm" disabled={archived} onClick={() => void mutate('linguistProposalsReissue', { projectId, proposalId: diff.proposal.id, expectedRevision: diff.currentRevision, idempotencyKey: crypto.randomUUID() })}>{t("重新签发")}</Button>}</div>
      </article>
      })}
    </section>)}
    <div className={styles.toolbar}><Button size="sm" disabled={page === 0} onClick={() => setPage((value) => value - 1)}>{t("上一页")}</Button><span>{t("第")} {page + 1} {t("页")}</span><Button size="sm" disabled={!list?.hasMore} onClick={() => setPage((value) => value + 1)}>{t("下一页")}</Button></div>
  </section>
}

export function ReferencePanel({ projectId, assetId, segmentIds, archived, onNavigate, onChanged, onSendAgentTask }: { projectId: string; assetId?: string; segmentIds: readonly string[]; archived: boolean; onNavigate: (id: string) => void; onChanged: () => void; onSendAgentTask: (text: string) => Promise<void> }): React.ReactElement {
  const t = useT()
  const [kind, setKind] = React.useState<'tm' | 'terms'>('terms')
  const [query, setQuery] = React.useState('')
  const [termFilter, setTermFilter] = React.useState<LinguistTermInfo['status'] | ''>('')
  const [page, setPage] = React.useState(0)
  const [list, setList] = React.useState<LinguistReferenceQueryResult<LinguistTermInfo | LinguistTmReferenceInfo>>()
  const [conflicts, setConflicts] = React.useState<LinguistTermConflictsResult>()
  const [candidate, setCandidate] = React.useState<Extract<LinguistReferenceImportResult, {requiresConfirmation:true}>>()
  const [preview, setPreview] = React.useState<PreviewRequest>()
  const [editingTermId, setEditingTermId] = React.useState<string>()
  const [term, setTerm] = React.useState('')
  const [translation, setTranslation] = React.useState('')
  const [termStatus, setTermStatus] = React.useState<LinguistTermInfo['status']>('preferred')
  const [caseSensitive, setCaseSensitive] = React.useState(false)
  const [module, setModule] = React.useState('')
  const [category, setCategory] = React.useState('')
  const [note, setNote] = React.useState('')
  const [message, setMessage] = React.useState('')
  const [selectedTermIds, setSelectedTermIds] = React.useState<ReadonlySet<string>>(new Set())
  const [validation, setValidation] = React.useState<LinguistTermsValidateResult>()
  const [refresh, setRefresh] = React.useState(0)
  const [agentSending, setAgentSending] = React.useState(false)

  React.useEffect(() => {
    let live = true
    const operation = kind === 'terms' ? 'linguistReferencesQueryTerms' : 'linguistReferencesQueryTm'
    const reads = [
      required<LinguistReferenceQueryResult<LinguistTermInfo | LinguistTmReferenceInfo>>(operation, {
        projectId, query: query || undefined, status: kind === 'terms' && termFilter ? termFilter : undefined,
        limit: 100, offset: page * 100,
      }),
      kind === 'terms' ? required<LinguistTermConflictsResult>('linguistReferencesListTermConflicts', {
        projectId, statuses: ['preferred', 'required'],
      }) : Promise.resolve(undefined),
    ] as const
    Promise.all(reads).then(([next, conflictList]) => {
      if (live) { setList(next); setConflicts(conflictList); setSelectedTermIds(new Set()); setMessage('') }
    }).catch((error: unknown) => { if (live) setMessage(describeProjectError(error, t)) })
    return () => { live = false }
  }, [projectId, kind, query, termFilter, page, refresh])

  const mutate = async (operation: string, input: object): Promise<boolean> => {
    if (archived) return false
    try {
      await required(operation, input)
      setRefresh((value) => value + 1)
      onChanged()
      setMessage(t("操作已完成"))
      return true
    } catch (error) { setMessage(describeProjectError(error, t)); return false }
  }
  const resetTerm = () => {
    setEditingTermId(undefined); setTerm(''); setTranslation(''); setTermStatus('preferred')
    setCaseSensitive(false); setModule(''); setCategory(''); setNote('')
  }
  const importFile = async (file: File) => {
    if (archived) return
    try {
      const tokens = await stageFiles([file])
      const result = await required<LinguistReferenceImportResult>('linguistReferencesImport', { projectId, kind, fileTokens: tokens })
      if (!result.cancelled && result.requiresConfirmation) setCandidate(result)
      else { setRefresh((value) => value + 1); onChanged() }
    } catch (error) { setMessage(describeProjectError(error, t)) }
  }
  const finishCandidate = async (operation: string) => {
    if (!candidate) return
    if (await mutate(operation, { projectId, kind, candidateId: candidate.candidateId, sourceSha256: candidate.sourceSha256 })) setCandidate(undefined)
  }
  const saveTerm = async (event: React.FormEvent) => {
    event.preventDefault()
    if (archived) return
    const saved = await mutate('linguistReferencesUpsertTerm', {
      projectId, id: editingTermId, term: term.trim(), translation: translation.trim(), status: termStatus,
      caseSensitive, note: note.trim() || undefined, module: module.trim() || undefined,
      category: category.trim() || undefined,
    })
    if (saved) resetTerm()
  }
  const deleteSelectedTerms = async () => {
    if (archived) return
    try {
      const result = await required<LinguistTermsDeleteResult>('linguistReferencesDeleteTerms', { projectId, termIds: [...selectedTermIds] })
      setSelectedTermIds(new Set())
      setRefresh((value) => value + 1)
      onChanged()
      setMessage(t('已删除 {count} 条术语', { count: result.count }))
    } catch (error) { setMessage(describeProjectError(error, t)) }
  }
  const validateSelectedSegments = async () => {
    try {
      setValidation(await required<LinguistTermsValidateResult>('linguistReferencesValidateTerms', { projectId, segmentIds: [...segmentIds] }))
      setMessage(t('术语校验已完成'))
    } catch (error) { setMessage(describeProjectError(error, t)) }
  }
  const keepConflictTerm = async (conflict: LinguistTermConflictInfo, keepId: string) => {
    const terms = conflict.entries.map((entry) => ({
      id: entry.id, term: entry.term, translation: entry.translation,
      status: entry.id !== keepId && (entry.status === 'required' || entry.status === 'preferred') ? 'allowed' as const : entry.status,
      caseSensitive: entry.caseSensitive, note: entry.note, module: entry.module, category: entry.category, imageRef: entry.imageRef,
    }))
    if (await mutate('linguistReferencesUpsertTerms', { projectId, terms })) setMessage(t('已保留所选译法；其他生效译法已降为允许，条目未删除。'))
  }
  const organizeTerms = async () => {
    setAgentSending(true)
    try {
      const scope = assetId ? `当前批次 ID：${assetId}。` : '当前范围为整个项目。'
      await onSendAgentTask(`请整理当前项目术语。${scope}提取应统一的源文术语，对照项目术语库，列出缺失或不一致的条目；新增或修改术语前先给我确认。`)
      setMessage(t('已把整理术语任务发给当前 DSH Agent 会话。'))
    } catch (cause) { setMessage(String(cause)) }
    finally { setAgentSending(false) }
  }
  return <section className={styles.panel} aria-label={t("TM 与术语库")}>
    <div className={styles.toolbar}>
      <strong>{t("参考库")}</strong>
      <select aria-label={t("参考类别")} value={kind} onChange={(event) => { setKind(event.target.value as 'tm' | 'terms'); setPage(0); setCandidate(undefined) }}><option value="terms">{t("术语 TB")}</option><option value="tm">{t("翻译记忆 TM")}</option></select>
      <Input aria-label={t("搜索参考")} placeholder={t("搜索")} value={query} onChange={(event) => { setQuery(event.target.value); setPage(0) }} />
      {kind === 'terms' && <select aria-label={t("术语状态筛选")} value={termFilter} onChange={(event) => { setTermFilter(event.target.value as typeof termFilter); setPage(0) }}><option value="">{t("全部状态")}</option>{(['allowed','preferred','required','forbidden','deprecated'] as const).map((value) => <option key={value}>{value}</option>)}</select>}
      <label>{t("导入文件")} <input type="file" disabled={archived} onChange={(event) => { const file = event.target.files?.[0]; if (file) void importFile(file); event.target.value = '' }} /></label>
      {kind === 'terms' && <><Button size="sm" disabled={archived || agentSending} onClick={() => void organizeTerms()}>{agentSending ? t('发送中…') : t('让 Agent 整理本批术语')}</Button><Button size="sm" disabled={archived || selectedTermIds.size === 0} onClick={() => void deleteSelectedTerms()}>{t('删除所选术语 {count} 条', { count: selectedTermIds.size })}</Button><Button size="sm" disabled={segmentIds.length === 0 || segmentIds.length > 200} onClick={() => void validateSelectedSegments()}>{t('校验所选句段术语 {count} 段', { count: segmentIds.length })}</Button></>}
    </div>
    {kind === 'terms' && segmentIds.length === 0 && <p>{t('先在 CAT 网格选择句段，再校验术语。')}</p>}
    {validation && <details open className={styles.callout}><summary>{t('术语校验结果')} · {validation.missingRequired.length + validation.forbiddenHits.length + validation.preferredNotUsed.length + validation.unresolvedConflicts.length}</summary>
      {validation.missingRequired.map((issue) => <p key={`required:${issue.segmentId}:${issue.termId}`}><Button size="sm" onClick={() => onNavigate(issue.segmentId)}>{issue.segmentId}</Button> {t('缺少必用术语')} {issue.term} → {issue.expected}</p>)}
      {validation.forbiddenHits.map((issue) => <p key={`forbidden:${issue.segmentId}:${issue.termId}`}><Button size="sm" onClick={() => onNavigate(issue.segmentId)}>{issue.segmentId}</Button> {t('命中禁用术语')} {issue.forbidden}</p>)}
      {validation.preferredNotUsed.map((issue) => <p key={`preferred:${issue.segmentId}:${issue.termId}`}><Button size="sm" onClick={() => onNavigate(issue.segmentId)}>{issue.segmentId}</Button> {t('未使用首选术语')} {issue.term} → {issue.preferred}</p>)}
      {validation.unresolvedConflicts.map((issue) => <p key={`conflict:${issue.segmentId}:${issue.term}`}><Button size="sm" onClick={() => onNavigate(issue.segmentId)}>{issue.segmentId}</Button> {t('术语冲突未解决')} {issue.term} · {issue.termIds.join(', ')}</p>)}
      {validation.missingRequired.length + validation.forbiddenHits.length + validation.preferredNotUsed.length + validation.unresolvedConflicts.length === 0 && <p>{t('所选句段没有术语校验问题。')}</p>}
    </details>}
    {candidate && <div className={styles.callout} aria-label={t("参考文件候选确认")}>
      <strong>{candidate.filename} {t("· 待确认")} {candidate.summary.entryCount} {t("条")}</strong>
      {candidate.summary.warnings.map((warning, index) => <p key={index} role="note">{warning}</p>)}
      <ul>{candidate.summary.samples.map((sample, index) => <li key={index}>{sample.kind === 'tm' ? `${sample.source} → ${sample.target}` : `${sample.term} → ${sample.translation} · ${sample.status}`}</li>)}</ul>
      {candidate.summary.samplesTruncated && <p>{t("候选样本仅展示前")} {candidate.summary.samples.length} {t("条。")}</p>}
      <div className={styles.toolbar}><Button size="sm" onClick={() => setPreview({ operation: 'linguistReferencesPreviewCandidate', input: { projectId, kind, candidateId: candidate.candidateId, sourceSha256: candidate.sourceSha256 } })}>{t("查看原文件")}</Button><Button size="sm" disabled={archived} onClick={() => void finishCandidate('linguistReferencesConfirmImport')}>{t("确认导入")}</Button><Button size="sm" onClick={() => { if (archived) setCandidate(undefined); else void finishCandidate('linguistReferencesCancelImport') }}>{t("取消")}</Button></div>
    </div>}
    {preview && <PreviewView request={preview} onClose={() => setPreview(undefined)} />}
    {kind === 'terms' && <fieldset disabled={archived} className={styles.formFields}><form className={styles.form} aria-label={editingTermId ? t("编辑术语") : t("新增术语")} onSubmit={(event) => void saveTerm(event)}>
      <Input required aria-label={t("术语")} placeholder={t("术语")} value={term} onChange={(event) => setTerm(event.target.value)} />
      <Input required aria-label={t("译法")} placeholder={t("译法")} value={translation} onChange={(event) => setTranslation(event.target.value)} />
      <select aria-label={t("术语约束")} value={termStatus} onChange={(event) => setTermStatus(event.target.value as LinguistTermInfo['status'])}>{(['allowed','preferred','required','forbidden','deprecated'] as const).map((value) => <option key={value}>{value}</option>)}</select>
      <label><input type="checkbox" checked={caseSensitive} onChange={(event) => setCaseSensitive(event.target.checked)} />{t("区分大小写")}</label>
      <Input aria-label={t("术语模块")} placeholder={t("模块")} value={module} onChange={(event) => setModule(event.target.value)} />
      <Input aria-label={t("术语类别")} placeholder={t("类别")} value={category} onChange={(event) => setCategory(event.target.value)} />
      <Input aria-label={t("术语备注")} placeholder={t("备注")} value={note} onChange={(event) => setNote(event.target.value)} />
      <Button type="submit" size="sm">{editingTermId ? t("保存术语") : t("添加术语")}</Button>
      {editingTermId && <Button size="sm" onClick={resetTerm}>{t("取消编辑")}</Button>}
    </form></fieldset>}
    {message && <p role="status">{message}</p>}
    {kind === 'terms' && conflicts && conflicts.count > 0 && <section className={styles.callout} aria-label={t("术语冲突")}><strong>{conflicts.count} {t("组术语有多条生效译法")}</strong>{conflicts.conflicts.map((conflict) => <div key={conflict.normalizedTerm} className={styles.item}><strong>{conflict.entries[0]?.term ?? conflict.normalizedTerm}</strong>{conflict.entries.filter((entry) => entry.status === 'required' || entry.status === 'preferred').map((entry) => <p key={entry.id}>{entry.translation} · {entry.status}{entry.module ? ` · ${entry.module}` : ''} <Button size="sm" disabled={archived} onClick={() => void keepConflictTerm(conflict, entry.id)}>{t('保留此译法')}</Button></p>)}</div>)}</section>}
    {list?.items.length === 0 && <p>{t("当前筛选没有参考条目。")}</p>}
    {list?.items.map((item) => <article className={styles.item} key={item.id}>
      <div className={styles.toolbar}>{'term' in item && <input type="checkbox" aria-label={t('选择术语 {term}', { term: item.term })} checked={selectedTermIds.has(item.id)} onChange={() => setSelectedTermIds((current) => { const next = new Set(current); if (next.has(item.id)) next.delete(item.id); else next.add(item.id); return next })} />}<strong>{'term' in item ? item.term : item.source}</strong><span>→ {'translation' in item ? item.translation : item.target}</span>{'status' in item && <small>{item.status}{item.caseSensitive ? t(" · 区分大小写") : ''}</small>}
        {'term' in item && <Button size="sm" disabled={archived} onClick={() => { setEditingTermId(item.id); setTerm(item.term); setTranslation(item.translation); setTermStatus(item.status); setCaseSensitive(item.caseSensitive); setModule(item.module ?? ''); setCategory(item.category ?? ''); setNote(item.note ?? '') }}>{t("编辑")}</Button>}
        <Button size="sm" disabled={archived} onClick={() => void mutate('linguistReferencesDelete', { projectId, kind, id: item.id })}>{t("删除")}</Button>
      </div>{'note' in item && item.note && <p>{item.note}</p>}
    </article>)}
    {kind === 'tm' && list?.sources?.map((source) => <div key={source.id} className={styles.toolbar}><label><input type="checkbox" disabled={archived} checked={source.enabled} onChange={(event) => void mutate('linguistReferencesUpdateTmSource', { projectId, sourceId: source.id, enabled: event.target.checked })} />{source.displayName}</label><span>{source.unitCount} {t("条")}</span><label>{t("优先级")} <input type="number" disabled={archived} key={`${source.id}:${source.priority}`} defaultValue={source.priority} aria-label={t('{name} 优先级', { name: source.displayName })} onBlur={(event) => { const priority = Number(event.target.value); if (Number.isSafeInteger(priority) && priority !== source.priority) void mutate('linguistReferencesUpdateTmSource', { projectId, sourceId: source.id, priority }); else if (!Number.isSafeInteger(priority)) setMessage(t("优先级必须是整数")) }} /></label></div>)}
    <div className={styles.toolbar}><Button size="sm" disabled={page === 0} onClick={() => setPage((value) => value - 1)}>{t("上一页")}</Button><span>{t("第")} {page + 1} {t("页")}</span><Button size="sm" disabled={!list?.hasMore} onClick={() => setPage((value) => value + 1)}>{t("下一页")}</Button></div>
  </section>
}

type AssetKind = 'contextDocs' | 'styleGuideRules' | 'sentencePatterns' | 'voiceProfiles' | 'techConstraints'

function suggestedXlsxColumns(sheet: LinguistXlsxMappingPreviewSheet | undefined): { key: string; source: string; target: string; locked: string; context: string } {
  const columns = { key: '', source: '', target: '', locked: '', context: '' }
  if (!sheet) return columns
  const selectable = new Set(sheet.columns.filter((column) => column.selectable).map((column) => column.header))
  const used = new Set<string>()
  for (const role of ['key', 'source', 'target', 'locked', 'context'] as const) {
    const value = sheet.suggestion.columns[role]
    if (value && selectable.has(value) && !used.has(value)) { columns[role] = value; used.add(value) }
  }
  return columns
}

export function AssetsPanel({ projectId, segmentId, focusDocId, archived, onChanged, onSendAgentTask, onOpenBatchPreview }: { projectId: string; segmentId?: string; focusDocId?: string; archived: boolean; onChanged: () => void; onSendAgentTask: (text: string) => Promise<void>; onOpenBatchPreview: (assetId: string) => void }): React.ReactElement {
  const t = useT()
  const [kind, setKind] = React.useState<AssetKind>('contextDocs')
  const [items, setItems] = React.useState<LinguistAssetsQueryResult>()
  const [assetQuery, setAssetQuery] = React.useState('')
  const [assetPage, setAssetPage] = React.useState(0)
  const [sentenceStatus, setSentenceStatus] = React.useState('')
  const [summary, setSummary] = React.useState<LinguistAssetInfo[]>([])
  const [importResult, setImportResult] = React.useState<LinguistProjectImportResult>()
  const [preview, setPreview] = React.useState<PreviewRequest>()
  const [sheetName, setSheetName] = React.useState('')
  const [columns, setColumns] = React.useState({ key: '', source: '', target: '', locked: '', context: '' })
  const [rememberMapping, setRememberMapping] = React.useState(true)
  const [importing, setImporting] = React.useState(false)
  const [agentSending, setAgentSending] = React.useState(false)
  const [editingId, setEditingId] = React.useState<string>()
  const [form, setForm] = React.useState({ first: '', second: '', third: '', fourth: '' })
  const [extra, setExtra] = React.useState({ sourceExample: '', module: '', suggestedTarget: '', reviewer: '', person: '', toneMarkers: '', taboos: '' })
  const [message, setMessage] = React.useState('')
  const [refresh, setRefresh] = React.useState(0)
  React.useEffect(() => {
    if (focusDocId) {
      setKind('contextDocs')
      setPreview({ operation: 'linguistAssetsPreviewContextDoc', input: { projectId, docId: focusDocId } })
    }
  }, [projectId, focusDocId])
  React.useEffect(() => {
    let live = true
    Promise.all([
      required<LinguistAssetsQueryResult>('linguistAssetsQuery', { projectId, kind, query: assetQuery || undefined, status: kind === 'sentencePatterns' && sentenceStatus ? sentenceStatus : undefined, limit: 200, offset: assetPage * 200 }),
      required<{ assets: LinguistAssetInfo[] }>('linguistProjectsGetSummary', { projectId }),
    ]).then(([data, overview]) => { if (live) { setItems(data); setSummary(overview.assets) } }).catch((error: unknown) => { if (live) setMessage(describeProjectError(error, t)) })
    return () => { live = false }
  }, [projectId, kind, assetQuery, assetPage, sentenceStatus, refresh])
  const changed = () => { setRefresh((value) => value + 1); onChanged() }
  const mutate = async (operation: string, input: object): Promise<boolean> => {
    if (archived) return false
    try { await required(operation, input); changed(); setMessage(t("操作已完成")); return true }
    catch (error) { setMessage(describeProjectError(error, t)); return false }
  }
  const importBatch = async (files: FileList, selection: 'files' | 'directory') => {
    setImporting(true)
    try {
      const result = await required<LinguistProjectImportResult>('linguistProjectsImport', { projectId, fileTokens: await stageFiles(Array.from(files)), selection })
      setImportResult(result)
      if (!result.cancelled && !result.bulk && result.requiresXlsxMapping) {
        const sheet = result.preview.sheets[0]
        setSheetName(sheet?.name ?? '')
        setColumns(suggestedXlsxColumns(sheet))
      } else changed()
    } catch (error) { setMessage(describeProjectError(error, t)) }
    finally { setImporting(false) }
  }
  const confirmMapping = async () => {
    const candidate = importResult
    if (!candidate || candidate.cancelled || candidate.bulk || !candidate.requiresXlsxMapping) return
    setImporting(true)
    try {
      const result = await required<LinguistProjectImportResult>('linguistProjectsConfirmXlsxMapping', { projectId, mappingId: candidate.mappingId, sourceSha256: candidate.sourceSha256, sheetName, columns: Object.fromEntries(Object.entries(columns).filter(([, value]) => value)), rememberMapping })
      setImportResult(result)
      changed()
    } catch (error) { setMessage(describeProjectError(error, t)) }
    finally { setImporting(false) }
  }
  const importResource = async (file: File, operation: 'linguistAssetsImportContextDoc' | 'linguistAssetsImportSentencePatterns') => {
    if (archived) return
    try {
      const fileTokens = await stageFiles([file])
      if (operation === 'linguistAssetsImportSentencePatterns') {
        const result = await required<{filename:string;imported:number;unchanged:number;warnings:string[]}> (operation, { projectId, fileTokens })
        setMessage(t('{filename} · 导入 {imported} 条 · 未变 {unchanged} 条', { filename: result.filename, imported: result.imported, unchanged: result.unchanged }) + (result.warnings.length ? ` · ${result.warnings.join('；')}` : ''))
      } else {
        const result = await required<{filename:string}>(operation, { projectId, fileTokens })
        setMessage(t('已导入 {filename}', { filename: result.filename }))
      }
      changed()
    }
    catch (error) { setMessage(describeProjectError(error, t)) }
  }
  const transitionSentence = async (pattern: LinguistSentencePatternInfo, status: LinguistSentencePatternInfo['status']) => {
    await mutate('linguistAssetsUpsert', { projectId, kind: 'sentencePatterns', item: {
      id: pattern.id, source: pattern.source, status, textType: pattern.textType,
      module: pattern.module, draftTarget: pattern.draftTarget,
      suggestedTarget: pattern.suggestedTarget, reviewer: pattern.reviewer,
    } })
  }
  const saveAsset = async () => {
    const id = editingId
    const item = kind === 'styleGuideRules' ? { id, groupKey: form.second || undefined, ruleText: form.first, sourceExample: extra.sourceExample || undefined, goodExample: form.third || undefined, badExample: form.fourth || undefined }
      : kind === 'sentencePatterns' ? { id, source: form.first, draftTarget: form.second || undefined, textType: form.third || undefined, status: form.fourth || 'pending', module: extra.module || undefined, suggestedTarget: extra.suggestedTarget || undefined, reviewer: extra.reviewer || undefined }
      : kind === 'voiceProfiles' ? { id, speaker: form.first, textType: form.second || undefined, register: form.third || undefined, notes: form.fourth || undefined, person: extra.person || undefined, toneMarkers: extra.toneMarkers.split(/[,，]/).map((value) => value.trim()).filter(Boolean), taboos: extra.taboos.split(/[,，]/).map((value) => value.trim()).filter(Boolean) }
      : kind === 'techConstraints' ? { id, kind: form.first, scope: form.second || undefined, valueJson: form.third, note: form.fourth || undefined }
      : { id, note: form.first || undefined }
    if (await mutate('linguistAssetsUpsert', { projectId, kind, item })) {
      setEditingId(undefined)
      setForm({ first: '', second: '', third: '', fourth: '' })
      setExtra({ sourceExample: '', module: '', suggestedTarget: '', reviewer: '', person: '', toneMarkers: '', taboos: '' })
    }
  }
  const startEdit = (item: LinguistAssetsQueryResult['items'][number]) => {
    setEditingId(item.id)
    if ('ruleText' in item) { setForm({ first: item.ruleText, second: item.groupKey ?? '', third: item.goodExample ?? '', fourth: item.badExample ?? '' }); setExtra((current) => ({ ...current, sourceExample: item.sourceExample ?? '' })) }
    else if ('source' in item) { setForm({ first: item.source, second: item.draftTarget ?? '', third: item.textType ?? '', fourth: item.status }); setExtra((current) => ({ ...current, module: item.module ?? '', suggestedTarget: item.suggestedTarget ?? '', reviewer: item.reviewer ?? '' })) }
    else if ('speaker' in item) { setForm({ first: item.speaker, second: item.textType ?? '', third: item.register ?? '', fourth: item.notes ?? '' }); setExtra((current) => ({ ...current, person: item.person ?? '', toneMarkers: item.toneMarkers?.join(', ') ?? '', taboos: item.taboos?.join(', ') ?? '' })) }
    else if ('valueJson' in item) setForm({ first: item.kind, second: item.scope ?? '', third: item.valueJson, fourth: item.note ?? '' })
    else setForm({ first: item.note ?? '', second: '', third: '', fourth: '' })
  }
  const mapCandidate = importResult && !importResult.cancelled && !importResult.bulk && importResult.requiresXlsxMapping ? importResult : undefined
  const bulkImport = importResult && !importResult.cancelled && importResult.bulk ? importResult : undefined
  const completedImport = importResult && !importResult.cancelled && !importResult.bulk && !importResult.requiresXlsxMapping ? importResult : undefined
  const summarizeVoice = async () => {
    setAgentSending(true)
    try {
      await onSendAgentTask('请分析当前项目中已确认的角色台词：按 speaker 和 textType 归纳角色声音、语域、人称、语气标记与禁忌，明确列出引用的 Segment 作为依据；缺少 speaker 元数据时不要猜角色。更新 Voice Profile 前先给我确认。')
      setMessage(t('已把角色声音总结任务发给当前 DSH Agent 会话。'))
    } catch (cause) { setMessage(String(cause)) }
    finally { setAgentSending(false) }
  }
  const sheet = mapCandidate?.preview.sheets.find((entry) => entry.name === sheetName)
  const selectedColumns = Object.values(columns).filter(Boolean)
  const mappingValid = !!sheet && !!columns.source && !!columns.target && selectedColumns.length === new Set(selectedColumns).size
  return <section className={styles.panel} aria-label={t("批次与语言资产")}>
    <h3>{t("工作批次")}</h3>
    <div className={styles.toolbar}>
      <label>{t('选择文件')} <input type="file" multiple disabled={archived || importing || !!mapCandidate} onChange={(event) => { if (event.target.files?.length) void importBatch(event.target.files, 'files'); event.target.value = '' }} /></label>
      <label>{t('选择文件夹')} <input type="file" multiple {...{ webkitdirectory: '' }} disabled={archived || importing || !!mapCandidate} onChange={(event) => { if (event.target.files?.length) void importBatch(event.target.files, 'directory'); event.target.value = '' }} /></label>
      <span>{summary.length} {t("个批次")}</span>
    </div>
    {importing && <p role="status">{t('导入中（读取并解析文件）…')}</p>}
    {summary.map((asset) => <p key={asset.assetId}>{asset.filename} · {t(describeLinguistFormat(asset.formatId))} · {asset.segmentCount} {t("段 ·")} {asset.currentStageCounts.confirmed} {t("已确认")} <small title={asset.sourceSha256}>SHA-256 {asset.sourceSha256.slice(0, 12)}…</small> {isGenericXliffFallback(asset.filename, asset.formatId) && <span role="note">{t('已按通用 XLIFF 打开；memoQ 专有结构未完全验证')}</span>} <Button size="sm" onClick={() => onOpenBatchPreview(asset.assetId)}>{t('预览批次')}</Button><Button size="sm" disabled={archived || importing} onClick={() => void mutate('linguistProjectsUndoImportAsset', { projectId, assetId: asset.assetId })}>{t("撤销导入")}</Button></p>)}
    {preview && <PreviewView request={preview} onClose={() => setPreview(undefined)} />}
    {mapCandidate && <div className={styles.callout} aria-label={t('XLSX 映射确认')}>
      <div className={styles.toolbar}><strong>{mapCandidate.filename} {t("需要映射列")}</strong><Button size="sm" disabled={importing} onClick={() => setImportResult(undefined)}>{t('取消')}</Button></div>
      <label>{t('工作表')} <select aria-label={t("工作表")} disabled={importing} value={sheetName} onChange={(event) => { const next = mapCandidate.preview.sheets.find((entry) => entry.name === event.target.value); setSheetName(event.target.value); setColumns(suggestedXlsxColumns(next)) }}>{mapCandidate.preview.sheets.map((entry) => <option key={entry.name} value={entry.name}>{entry.name}{entry.state === 'visible' ? '' : ` (${entry.state})`}</option>)}</select></label>
      {sheet && <>
        <div className={styles.toolbar}>{(['key','source','target','locked','context'] as const).map((field) => <label key={field}>{field}<select aria-label={t('{field} 列', { field })} disabled={importing} value={columns[field]} onChange={(event) => setColumns((current) => ({ ...current, [field]: event.target.value }))}><option value="">{t("未指定")}</option>{sheet.columns.filter((entry) => entry.selectable).map((entry) => <option key={entry.index} value={entry.header}>{entry.header}</option>)}</select></label>)}</div>
        <p>{t('建议置信度 {percent}%', { percent: Math.round(sheet.suggestion.confidence * 100) })} · {sheet.suggestion.reasons.join('；')}</p>
        <details><summary>{t('解析证据：表头 {headers} · 样本 {shown}/{total}', { headers: sheet.headerRowNumbers.join('、') || t('未识别'), shown: sheet.coverage.shownSampleRows, total: sheet.coverage.dataRows })}</summary>
          <p>{t('物理行 {physical} · 非空 {nonEmpty} · 空行 {empty}', { physical: sheet.coverage.physicalRows, nonEmpty: sheet.coverage.nonEmptyDataRows, empty: sheet.coverage.emptyDataRows })}</p>
          <p>{t('公式 {formula} · 无缓存值 {missing} · 错误单元格 {errors} · 合并区域 {merged}', { formula: sheet.distortion.formulaCells, missing: sheet.distortion.formulaCellsWithoutCachedValue, errors: sheet.distortion.errorCells, merged: sheet.distortion.mergedRanges })}</p>
          {sheet.sampleRows.map((row) => <p key={row.rowNo}>{t('第 {row} 行', { row: row.rowNo })}：{row.cells.map((cell) => `${sheet.columns.find((column) => column.index === cell.columnIndex)?.header ?? `#${cell.columnIndex + 1}`}=${cell.value}${cell.truncated ? '…' : ''}`).join(' · ')}</p>)}
        </details>
      </>}
      <div className={styles.toolbar}><label><input type="checkbox" checked={rememberMapping} disabled={importing} onChange={(event) => setRememberMapping(event.target.checked)} />{t('记住此映射')}</label><Button size="sm" disabled={archived || importing || !mappingValid} onClick={() => void confirmMapping()}>{t("确认映射并导入")}</Button></div>
      {!mappingValid && <p role="alert">{t('Source、Target 必选，且每列只能用于一个字段。')}</p>}
    </div>}
    {bulkImport && <details className={styles.callout} open><summary>{t('批量导入结果')} · {t('发现 {found} · 导入 {imported} · 重复 {duplicate} · 待确认 {needsInput} · 不支持 {unsupported} · 失败 {failed}', { found: bulkImport.found, imported: bulkImport.imported, duplicate: bulkImport.skippedDuplicate, needsInput: bulkImport.needsInput, unsupported: bulkImport.unsupported, failed: bulkImport.failed })}</summary>
      {bulkImport.truncated && <p role="alert">{t('已达到 500 项上限，请缩小文件夹范围后继续。')}</p>}
      <ul className={styles.importItems}>{bulkImport.items.map((item, index) => <li key={`${item.filename}:${index}`}><strong>{item.filename}</strong> · {item.status}{item.resourceKind ? ` · ${item.resourceKind}` : ''}{item.message ? ` · ${item.message}` : ''}{item.status === 'needs-input' && item.filename.toLowerCase().endsWith('.xlsx') ? ` · ${t('请单独选择此 XLSX 以确认 Sheet/列映射')}` : ''}</li>)}</ul>
    </details>}
    {completedImport && <div className={styles.callout} role="status"><strong>{completedImport.filename} · {completedImport.status}</strong><p>{t(describeLinguistFormat(completedImport.formatId))} · {completedImport.segmentCount} {t('段')} · SHA-256 {completedImport.sourceSha256}</p>{isGenericXliffFallback(completedImport.filename, completedImport.formatId) && <p role="note">{t('已按通用 XLIFF 打开；memoQ 专有结构未完全验证')}</p>}{completedImport.mappingUsed && <p>{t('映射已使用')} · {completedImport.mappingUsed.sheetName}</p>}{completedImport.warnings.map((warning, index) => <p key={`${warning.code}:${index}`} role="note">{warning.code} · {warning.message}</p>)}{completedImport.verification.checks.map((check) => <p key={check.id}>{check.passed ? '✓' : '✗'} {check.id} · {check.detail}</p>)}</div>}
    <hr /><div className={styles.toolbar}><strong>{t("项目语言资产")}</strong><select aria-label={t("语言资产类别")} value={kind} onChange={(event) => { setKind(event.target.value as AssetKind); setAssetPage(0); setEditingId(undefined); setForm({ first: '', second: '', third: '', fourth: '' }); setExtra({ sourceExample: '', module: '', suggestedTarget: '', reviewer: '', person: '', toneMarkers: '', taboos: '' }) }}><option value="contextDocs">{t("Context 文档与图像")}</option><option value="styleGuideRules">Style Guide</option><option value="sentencePatterns">{t("句型")}</option><option value="voiceProfiles">Voice Profile</option><option value="techConstraints">{t("技术约束")}</option></select><Input aria-label={t("搜索语言资产")} placeholder={t("搜索语言资产")} value={assetQuery} onChange={(event) => { setAssetQuery(event.target.value); setAssetPage(0) }} />{kind === 'sentencePatterns' && <select aria-label={t("句型状态")} value={sentenceStatus} onChange={(event) => { setSentenceStatus(event.target.value); setAssetPage(0) }}><option value="">{t("全部状态")}</option><option value="pending">{t("待审")}</option><option value="confirmed">{t("已确认")}</option><option value="rejected">{t("已拒绝")}</option></select>}{(kind === 'contextDocs' || kind === 'sentencePatterns') && <label>{t("导入文件")} <input type="file" disabled={archived} onChange={(event) => { const file = event.target.files?.[0]; if (file) void importResource(file, kind === 'contextDocs' ? 'linguistAssetsImportContextDoc' : 'linguistAssetsImportSentencePatterns'); event.target.value = '' }} /></label>}{kind === 'voiceProfiles' && <Button size="sm" disabled={archived || agentSending} onClick={() => void summarizeVoice()}>{agentSending ? t('发送中…') : t('让 Agent 从已确认台词总结角色声音')}</Button>}</div>
    {message && <p role="status">{message}</p>}
    <fieldset disabled={archived} className={styles.formFields}>
    <form className={styles.form} onSubmit={(event) => { event.preventDefault(); void saveAsset() }}>
      {kind === 'techConstraints' ? <select aria-label={t("约束类别")} value={form.first} required onChange={(event) => setForm((current) => ({ ...current, first: event.target.value }))}><option value="">{t("选择约束")}</option><option value="length">{t("长度")}</option><option value="rich_text">{t("富文本")}</option><option value="tag_note">{t("Tag 备注")}</option></select> : <Input aria-label={kind === 'styleGuideRules' ? t("规则") : kind === 'sentencePatterns' ? t("源句型") : kind === 'voiceProfiles' ? t("说话人") : t("文档备注")} placeholder={kind === 'styleGuideRules' ? t("规则文字") : kind === 'sentencePatterns' ? t("Source 句型") : kind === 'voiceProfiles' ? t("说话人") : t("文档备注")} value={form.first} onChange={(event) => setForm((current) => ({ ...current, first: event.target.value }))} required={kind !== 'contextDocs'} />}
      {kind !== 'contextDocs' && <Input aria-label={t("分类或译法")} placeholder={t("分类 / 译法 / Text type / Scope")} value={form.second} onChange={(event) => setForm((current) => ({ ...current, second: event.target.value }))} />}
      {kind !== 'contextDocs' && <Input aria-label={t("示例或约束值")} placeholder={t("示例 / Text type / Register / JSON 值")} value={form.third} onChange={(event) => setForm((current) => ({ ...current, third: event.target.value }))} required={kind === 'techConstraints'} />}
      {kind === 'sentencePatterns' ? <select aria-label={t("句型决定")} value={form.fourth || 'pending'} onChange={(event) => setForm((current) => ({ ...current, fourth: event.target.value }))}><option value="pending">{t("待审")}</option><option value="confirmed">{t("已确认")}</option><option value="rejected">{t("已拒绝")}</option></select> : kind !== 'contextDocs' && <Input aria-label={t("补充信息")} placeholder={t("反例 / 备注")} value={form.fourth} onChange={(event) => setForm((current) => ({ ...current, fourth: event.target.value }))} />}
      {kind === 'styleGuideRules' && <Input aria-label={t("源文示例")} placeholder={t("源文示例")} value={extra.sourceExample} onChange={(event) => setExtra((current) => ({ ...current, sourceExample: event.target.value }))} />}
      {kind === 'sentencePatterns' && <><Input aria-label={t("句型模块")} placeholder={t("模块")} value={extra.module} onChange={(event) => setExtra((current) => ({ ...current, module: event.target.value }))} /><Input aria-label={t("建议译法")} placeholder={t("建议译法")} value={extra.suggestedTarget} onChange={(event) => setExtra((current) => ({ ...current, suggestedTarget: event.target.value }))} /><Input aria-label={t("句型审校人")} placeholder={t("审校人")} value={extra.reviewer} onChange={(event) => setExtra((current) => ({ ...current, reviewer: event.target.value }))} /></>}
      {kind === 'voiceProfiles' && <><Input aria-label={t("人称")} placeholder={t("人称")} value={extra.person} onChange={(event) => setExtra((current) => ({ ...current, person: event.target.value }))} /><Input aria-label={t("语气标记")} placeholder={t("语气标记，逗号分隔")} value={extra.toneMarkers} onChange={(event) => setExtra((current) => ({ ...current, toneMarkers: event.target.value }))} /><Input aria-label={t("禁忌")} placeholder={t("禁忌，逗号分隔")} value={extra.taboos} onChange={(event) => setExtra((current) => ({ ...current, taboos: event.target.value }))} /></>}
      <Button type="submit" size="sm" disabled={kind === 'contextDocs' && !editingId}>{editingId ? t("保存修改") : t("添加")}</Button>{editingId && <Button size="sm" onClick={() => { setEditingId(undefined); setForm({ first: '', second: '', third: '', fourth: '' }); setExtra({ sourceExample: '', module: '', suggestedTarget: '', reviewer: '', person: '', toneMarkers: '', taboos: '' }) }}>{t("取消编辑")}</Button>}
    </form>
    </fieldset>
    {items?.items.map((item) => <article className={styles.item} key={item.id}>
      <div className={styles.toolbar}>
        <strong>{'ruleText' in item ? item.ruleText : 'source' in item ? item.source : 'speaker' in item ? item.speaker : 'originalFilename' in item ? item.originalFilename : item.kind}</strong>
        {'originalFilename' in item && <Button size="sm" onClick={() => setPreview({ operation: 'linguistAssetsPreviewContextDoc', input: { projectId, docId: item.id } })}>{t('预览原件')}</Button>}
        <Button size="sm" disabled={archived} onClick={() => startEdit(item)}>{t('编辑')}</Button>
        <Button size="sm" disabled={archived} onClick={() => void mutate('linguistAssetsDelete', { projectId, kind, id: item.id })}>{t('删除')}</Button>
      </div>
      {'ruleText' in item && <><p>{item.groupKey ?? t('未指定分组')}{item.sourceExample ? ` · Source: ${item.sourceExample}` : ''}</p>{item.goodExample && <p>✓ {t('正例')}：{item.goodExample}</p>}{item.badExample && <p>✗ {t('反例')}：{item.badExample}</p>}</>}
      {'source' in item && <><p>{t('状态')}：{t({ pending: '待审', confirmed: '已确认', rejected: '已拒绝' }[item.status])}{item.textType ? ` · ${item.textType}` : ''}{item.module ? ` · ${item.module}` : ''}</p>{item.draftTarget && <p>{t('草稿译法')}：{item.draftTarget}</p>}{item.suggestedTarget && <p>{t('建议译法')}：{item.suggestedTarget}</p>}{item.reviewer && <p>{t('审校人')}：{item.reviewer}</p>}<div className={styles.toolbar}>{(['pending', 'confirmed', 'rejected'] as const).filter((status) => status !== item.status).map((status) => <Button key={status} size="sm" disabled={archived} onClick={() => void transitionSentence(item, status)}>{t({ pending: '打回待审', confirmed: '确认句型', rejected: '拒绝句型' }[status])}</Button>)}</div></>}
      {'speaker' in item && <><p>{[item.textType, item.register, item.person].filter(Boolean).join(' · ')}</p>{item.toneMarkers && item.toneMarkers.length > 0 && <p>{t('语气')}：{item.toneMarkers.join('、')}</p>}{item.taboos && item.taboos.length > 0 && <p>{t('禁忌')}：{item.taboos.join('、')}</p>}{item.notes && <p>{item.notes}</p>}</>}
      {'valueJson' in item && <><p>{item.scope ?? t('全项目')}</p><pre>{item.valueJson}</pre>{item.note && <p>{item.note}</p>}</>}
      {'originalFilename' in item && <><p>{item.kind === 'image' ? t('图片') : t('文档')} · {item.hasTextExtract ? t('可阅读 {count} 字', { count: item.textExtractLength ?? 0 }) : t('无文本抽取')}</p>{item.note && <p>{item.note}</p>}{item.kind === 'image' && item.previewUrl?.startsWith('/la/v1/files/') && <img className={styles.preview} alt={item.originalFilename} src={item.previewUrl} />}{segmentId && <Button size="sm" disabled={archived} onClick={() => void mutate('linguistAssetsSetContextDocSegmentLink', { projectId, docId: item.id, segmentId, linked: true })}>{t('关联当前句段')}</Button>}</>}
    </article>)}
    <div className={styles.toolbar}><Button size="sm" disabled={assetPage === 0} onClick={() => setAssetPage((value) => value - 1)}>{t("上一页")}</Button><span>{t("第")} {assetPage + 1} {t("页 · 共")} {items?.total ?? 0} {t("条")}</span><Button size="sm" disabled={!items?.hasMore} onClick={() => setAssetPage((value) => value + 1)}>{t("下一页")}</Button></div>
  </section>
}

export function DeliveryPanel({ projectId, assets, archived }: { projectId: string; assets: readonly LinguistAssetInfo[]; archived: boolean }): React.ReactElement {
  const t = useT()
  const [assetId, setAssetId] = React.useState(assets[0]?.assetId ?? '')
  const [prepared, setPrepared] = React.useState<LinguistPrepareDeliveryResult>()
  const [exports, setExports] = React.useState<LinguistExportFileInfo[]>([])
  const [download, setDownload] = React.useState<{token:string;filename:string}>()
  const [message, setMessage] = React.useState('')
  const [busy, setBusy] = React.useState(false)
  const refreshExports = React.useCallback(() => required<LinguistExportFileInfo[]>('linguistExportsList', { projectId }).then(setExports).catch((error: unknown) => setMessage(describeProjectError(error, t))), [projectId])
  React.useEffect(() => { void refreshExports() }, [refreshExports])
  const prepare = async (): Promise<LinguistPrepareDeliveryResult | undefined> => {
    setBusy(true)
    try { const result = await required<LinguistPrepareDeliveryResult>('linguistExportsPrepareAsset', { projectId, assetId }); setPrepared(result); setMessage(t("预检已完成")); return result }
    catch (error) { setMessage(describeProjectError(error, t)); return undefined }
    finally { setBusy(false) }
  }
  const exportFile = async (validation: 'verified' | 'as-is', targetAssetId = assetId) => {
    setBusy(true)
    try {
      const response = await fetch('/la/v1/files/export', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ projectId, assetId: targetAssetId, validation }) })
      if (!response.ok) throw new Error(t('导出失败：HTTP {status}', { status: response.status }))
      const result: unknown = await response.json()
      if (typeof result !== 'object' || result === null || !('token' in result) || typeof result.token !== 'string' || !('filename' in result) || typeof result.filename !== 'string' || !('preparation' in result) || typeof result.preparation !== 'object' || result.preparation === null) throw new Error(t("导出服务返回的下载收据无效"))
      setDownload({ token: result.token, filename: result.filename })
      setPrepared(result.preparation as LinguistPrepareDeliveryResult)
      setMessage(t("导出产物已准备，可领取一次性下载链接。下载本身不代表专业任务完成。"))
      void refreshExports()
    } catch (error) { setMessage(describeProjectError(error, t)) }
    finally { setBusy(false) }
  }
  const verifyAndExport = async () => {
    const result = await prepare()
    if (result?.preflight.ready) await exportFile('verified')
  }
  return <section className={styles.panel} aria-label={t("交付")}>
    <div className={styles.toolbar}><strong>{t("交付预检与导出")}</strong><select aria-label={t("导出批次")} value={assetId} onChange={(event) => { setAssetId(event.target.value); setPrepared(undefined); setDownload(undefined) }}>{assets.map((asset) => <option key={asset.assetId} value={asset.assetId}>{asset.filename}</option>)}</select><Button size="sm" disabled={archived || busy || !assetId} onClick={() => void verifyAndExport()}>{t("验证并导出")}</Button><Button size="sm" disabled={archived || busy || !assetId} onClick={() => void prepare()}>{t("仅运行预检")}</Button><Button size="sm" disabled={archived || busy || !assetId} onClick={() => void exportFile('as-is')}>{t("按当前状态导出")}</Button></div>
    {archived && <p>{t('归档项目只能查看历史交付物。')}</p>}
    {message && <p role="status">{message}</p>}
    {prepared && <div className={styles.callout}><strong>{prepared.preflight.ready ? t("预检通过") : t("预检有阻塞")}</strong><p>{t("阶段")} {prepared.preflight.stageCounts.confirmed}/{prepared.preflight.segmentCount} {t("· QA 错误")} {prepared.preflight.qa.openErrors} {t("· 建议待审")} {prepared.preflight.pendingProposalCount}</p>{prepared.preflight.blockers.map((blocker) => <p key={blocker.code} role="alert">{blocker.code}：{blocker.message} ({blocker.count})</p>)}<details><summary>{t("完整预检报告")}</summary><pre>{prepared.reportMarkdown}</pre></details></div>}
    {download && <p><a href={fileUrl(download.token)} download={download.filename} onClick={() => setDownload(undefined)}>{t("下载")} {download.filename}</a>{t("（下载链接一次有效）")}</p>}
    <h3>{t("本项目交付记录")}</h3>{exports.map((item) => <p key={item.filename}>{item.filename} · {item.sizeBytes} bytes {item.stale ? t("· 已过时") : ''}{item.assetId && <Button size="sm" disabled={archived || busy} onClick={() => void exportFile('as-is', item.assetId)}>{t("按当前状态重新导出")}</Button>}</p>)}
  </section>
}

interface ProjectDiagnosticsStatus {
  projectRevision: string
  prompt: {
    promptVersion: string
    promptHash: string
    role: string
    roleSource: string
    renderer: string
    projectDigestStatus: 'complete' | 'partial' | 'skipped'
    projectDigestTruncated: boolean
    charCount: number
  }
}

export function ProjectSettingsPanel({ project, hasBatches, onChanged, sessionId, onOpenFiles }: { project: LinguistProjectInfo; hasBatches: boolean; onChanged: () => void; sessionId?: string; onOpenFiles?: () => void }): React.ReactElement {
  const t = useT()
  const [name, setName] = React.useState(project.name)
  const [sourceLocale, setSourceLocale] = React.useState(project.sourceLocale)
  const [targetLocale, setTargetLocale] = React.useState(project.targetLocale)
  const [workflowStage, setWorkflowStage] = React.useState<LinguistWorkflowStage>(project.workflowStage ?? 'translation')
  const [outputStatus, setOutputStatus] = React.useState<'default' | 'Translated' | 'ApprovedTranslation' | 'ApprovedSignOff'>((project.outputStatusPolicy?.sdlxliff_1_2?.[project.workflowStage ?? 'translation'] as 'Translated' | 'ApprovedTranslation' | 'ApprovedSignOff' | undefined) ?? 'default')
  const [qaProfile, setQaProfile] = React.useState(project.qaProfile ?? 'general')
  const [confirmName, setConfirmName] = React.useState('')
  const [backups, setBackups] = React.useState<LinguistBackupInfo[]>([])
  const [restorePreview, setRestorePreview] = React.useState<{backupName:string;restorable:boolean;notice?:string}>()
  const [integrityJob, setIntegrityJob] = React.useState('')
  const [integrityStatus, setIntegrityStatus] = React.useState('')
  const [integrityComplete, setIntegrityComplete] = React.useState(false)
  const [download, setDownload] = React.useState<{token:string;filename:string}>()
  const [diagnosticsPreview, setDiagnosticsPreview] = React.useState<unknown>()
  const [unknownTags, setUnknownTags] = React.useState<LinguistUnknownTagPatternInfo[]>([])
  const [tagPattern, setTagPattern] = React.useState('')
  const [tagName, setTagName] = React.useState('')
  const [tagKind, setTagKind] = React.useState<'standalone'|'opening'|'closing'>('standalone')
  const [tagPairKey, setTagPairKey] = React.useState('')
  const [tagEvidenceId, setTagEvidenceId] = React.useState('')
  const [candidatePatterns, setCandidatePatterns] = React.useState<Record<string, string>>({})
  const [message, setMessage] = React.useState('')
  const [diagnostics, setDiagnostics] = React.useState<ProjectDiagnosticsStatus>()
  const projectId = project.id
  const archived = project.archivedAt !== undefined
  React.useEffect(() => { setName(project.name); setSourceLocale(project.sourceLocale); setTargetLocale(project.targetLocale); setWorkflowStage(project.workflowStage ?? 'translation'); setOutputStatus((project.outputStatusPolicy?.sdlxliff_1_2?.[project.workflowStage ?? 'translation'] as 'Translated' | 'ApprovedTranslation' | 'ApprovedSignOff' | undefined) ?? 'default'); setQaProfile(project.qaProfile ?? 'general') }, [project.name, project.sourceLocale, project.targetLocale, project.workflowStage, project.outputStatusPolicy, project.qaProfile])
  const refreshBackups = React.useCallback(() => required<LinguistBackupInfo[]>('linguistBackupsList', { projectId }).then(setBackups).catch((error: unknown) => setMessage(describeProjectError(error, t))), [projectId])
  React.useEffect(() => { void refreshBackups() }, [refreshBackups])
  React.useEffect(() => {
    const source = new EventSource(`/la/v1/events?projectId=${encodeURIComponent(projectId)}&afterSequence=0`)
    source.addEventListener('integrity', (raw) => {
      const event = JSON.parse((raw as MessageEvent).data) as {jobId:string;state:string;progress?:{percent:number};report?:{outcome:string}}
      if (event.jobId === integrityJob) {
        setIntegrityStatus(event.state === 'running' ? t('全检 {percent}%', { percent: event.progress?.percent ?? 0 }) : event.report?.outcome ?? event.state)
        setIntegrityComplete(event.state === 'completed')
      }
    })
    return () => source.close()
  }, [projectId, integrityJob])
  const mutate = async (operation: string, input: object, success = t("操作已完成")): Promise<boolean> => {
    try { await required(operation, input); onChanged(); setMessage(success); void refreshBackups(); return true }
    catch (error) { setMessage(describeProjectError(error, t)); return false }
  }
  const startIntegrity = async () => {
    try { const job = await required<{jobId:string}>('linguistIntegrityStart', { projectId }); setIntegrityJob(job.jobId); setIntegrityStatus(t("全检运行中")); setIntegrityComplete(false) }
    catch (error) { setMessage(describeProjectError(error, t)) }
  }
  const scanTags = async () => {
    try { setUnknownTags(await required<LinguistUnknownTagPatternInfo[]>('linguistProjectsScanUnknownTags', { projectId })); setMessage(t("疑似 Tag 扫描完成")) }
    catch (error) { setMessage(describeProjectError(error, t)) }
  }
  React.useEffect(() => {
    let live = true
    required<LinguistUnknownTagPatternInfo[]>('linguistProjectsScanUnknownTags', { projectId })
      .then((items) => { if (live) setUnknownTags(items) })
      .catch((error: unknown) => { if (live) setMessage(describeProjectError(error, t)) })
    return () => { live = false }
  }, [projectId])
  const exportManagedFile = async (operation: 'linguistIntegrityExportReport' | 'linguistDiagnosticsExportBundle', input: object) => {
    try {
      const result = await required<unknown>(operation, input)
      if (typeof result !== 'object' || result === null || !('token' in result) || typeof result.token !== 'string' || !('filename' in result) || typeof result.filename !== 'string') throw new Error(t("Host 未返回受管下载收据"))
      setDownload({ token: result.token, filename: result.filename })
      setMessage(t("报告已在本机准备，下载链接仅可使用一次。"))
    } catch (error) { setMessage(describeProjectError(error, t)) }
  }
  return <section className={styles.panel} aria-label={t("项目设置与维护")}>
    {archived && <p className={styles.callout}>{t('归档项目为只读；仍可查看、备份和诊断。')}</p>}
    {onOpenFiles && <div className={styles.toolbar}><strong>{t('DSH Workspace 文件')}</strong><Button size="sm" onClick={onOpenFiles}>{t('打开原生 Files')}</Button></div>}
    <h3>{t("项目")}</h3><div className={styles.form}><label>{t("名称")}<Input disabled={archived} value={name} onChange={(event) => setName(event.target.value)} /></label><Button size="sm" disabled={archived || !name.trim() || name === project.name} onClick={() => void mutate('linguistProjectsRename', { projectId, name: name.trim() })}>{t("重命名")}</Button><label>Source locale<Input disabled={archived || hasBatches} value={sourceLocale} onChange={(event) => setSourceLocale(event.target.value)} /></label><label>Target locale<Input disabled={archived || hasBatches} value={targetLocale} onChange={(event) => setTargetLocale(event.target.value)} /></label><Button size="sm" disabled={archived || hasBatches || (sourceLocale === project.sourceLocale && targetLocale === project.targetLocale)} onClick={() => void mutate('linguistProjectsSetLocales', { projectId, sourceLocale, targetLocale })}>{t("保存语言")}</Button></div>
    {hasBatches && <p>{t('已有批次，不能修改项目语言。')}</p>}
    <div className={styles.toolbar}><label>{t("阶段")}<select disabled={archived} value={workflowStage} onChange={(event) => { const next = event.target.value as LinguistWorkflowStage; setWorkflowStage(next); setOutputStatus((project.outputStatusPolicy?.sdlxliff_1_2?.[next] as 'Translated' | 'ApprovedTranslation' | 'ApprovedSignOff' | undefined) ?? 'default') }}><option value="translation">Translator</option><option value="editing">Reviewer</option><option value="proofreading">Proofreader</option></select></label><label>{t('SDLXLIFF 确认输出')}<select disabled={archived} value={outputStatus} onChange={(event) => setOutputStatus(event.target.value as typeof outputStatus)}><option value="default">{t('随 T / E / P 阶段')}</option><option value="Translated">Translated</option><option value="ApprovedTranslation">ApprovedTranslation</option><option value="ApprovedSignOff">ApprovedSignOff</option></select></label><label>{t("QA 配置")}<select disabled={archived} value={qaProfile} onChange={(event) => setQaProfile(event.target.value as 'general'|'subtitle')}><option value="general">{t("通用")}</option><option value="subtitle">{t("字幕")}</option></select></label><Button size="sm" disabled={archived || (workflowStage === (project.workflowStage ?? 'translation') && qaProfile === (project.qaProfile ?? 'general') && outputStatus === ((project.outputStatusPolicy?.sdlxliff_1_2?.[workflowStage] as typeof outputStatus | undefined) ?? 'default'))} onClick={() => void mutate('linguistProjectsSetWorkflowConfig', { projectId, workflowStage, outputStatusPolicy: outputStatus === 'default' ? null : { sdlxliff_1_2: { [workflowStage]: outputStatus } }, qaProfile })}>{t("保存工作流")}</Button></div>
    <h3>Tag Profile</h3>
    <p>{t("候选只给软提示；批准后才成为编辑、QA 和导出的硬保护规则。")}</p>
    <div className={styles.toolbar}><Button size="sm" onClick={() => void scanTags()}>{t("扫描疑似 Tag")}</Button></div>
    {project.tagProfile?.families.map((family) => <div key={family.id} className={styles.item}><div className={styles.toolbar}><strong>{family.id}</strong><code>{family.pattern}</code><span>{family.enabled === false ? t("停用") : t("启用")}</span><Button size="sm" disabled={archived} onClick={() => void mutate('linguistProjectsUpdateTagProfile', { projectId, action: family.enabled === false ? 'enable' : 'disable', entryId: family.id })}>{family.enabled === false ? t("启用") : t("停用")}</Button></div></div>)}
    {unknownTags.map((item) => <div key={item.patternShape} className={styles.item}><strong>{item.patternShape} · {item.frequency} {t("次")}</strong><p>{t("原文/译文原样率")} {Math.round(item.sourceTargetPreservation.exactValueRate * 100)}{t("% · 平衡配对")} {item.pairingEvidence.balanced ? t("是") : t("否")}</p>{item.examples.map((example) => <label key={example.id} className={styles.toolbar}><input type="radio" name="tag-evidence" checked={tagEvidenceId === example.id} onChange={() => { setTagEvidenceId(example.id); setTagPattern(item.patternShape) }} />{example.side === 'source' ? 'Source' : 'Target'} · {example.value}</label>)}</div>)}
    <form className={styles.form} onSubmit={(event) => { event.preventDefault(); if (!tagEvidenceId || archived) return; void mutate('linguistProjectsUpdateTagProfile', { projectId, action: 'save', candidate: { name: tagName.trim(), regex: tagPattern.trim(), kind: tagKind, ...(tagPairKey.trim() ? { pairKey: tagPairKey.trim() } : {}), evidenceExampleIds: [tagEvidenceId], confidence: 1, explanation: '用户依据项目扫描样本显式登记' } }).then((saved) => { if (saved) { setTagPattern(''); setTagName(''); setTagPairKey(''); setTagEvidenceId('') } }) }}>
      <Input required disabled={archived} aria-label={t("Tag 名称")} placeholder={t("Tag 名称")} value={tagName} onChange={(event) => setTagName(event.target.value)} />
      <Input required disabled={archived} aria-label={t("Tag 正则")} placeholder={t("Tag 正则")} value={tagPattern} onChange={(event) => setTagPattern(event.target.value)} />
      <select disabled={archived} aria-label={t("Tag 类型")} value={tagKind} onChange={(event) => setTagKind(event.target.value as typeof tagKind)}><option value="standalone">{t("独立")}</option><option value="opening">{t("开始")}</option><option value="closing">{t("结束")}</option></select>
      {tagKind !== 'standalone' && <Input disabled={archived} aria-label={t("配对键")} placeholder={t("配对键")} value={tagPairKey} onChange={(event) => setTagPairKey(event.target.value)} />}
      <Button type="submit" size="sm" disabled={archived || !tagEvidenceId}>{t("保存候选 Tag")}</Button>
    </form>
    {project.tagProfile?.candidates?.map((candidate) => <div key={candidate.id} className={styles.item}><div className={styles.toolbar}><strong>{candidate.name}</strong><span>{candidate.status}</span><small>{candidate.explanation}</small></div><Input disabled={archived} aria-label={t('{name} 正则', { name: candidate.name })} value={candidatePatterns[candidate.id] ?? candidate.pattern} onChange={(event) => setCandidatePatterns((current) => ({ ...current, [candidate.id]: event.target.value }))} /><div className={styles.toolbar}><Button size="sm" disabled={archived || (candidatePatterns[candidate.id] ?? candidate.pattern) === candidate.pattern} onClick={() => void mutate('linguistProjectsUpdateTagProfile', { projectId, action: 'save', replaceId: candidate.id, candidate: { name: candidate.name, regex: candidatePatterns[candidate.id], kind: candidate.kind, pairKey: candidate.pairKey, evidenceExampleIds: [...candidate.evidenceExampleIds], confidence: candidate.confidence, explanation: candidate.explanation } })}>{t("保存正则")}</Button>{candidate.status === 'candidate' ? <><Button size="sm" disabled={archived} onClick={() => void mutate('linguistProjectsUpdateTagProfile', { projectId, action: 'activate', entryId: candidate.id })}>{t("批准硬保护")}</Button><Button size="sm" disabled={archived} onClick={() => void mutate('linguistProjectsUpdateTagProfile', { projectId, action: 'ignore', entryId: candidate.id })}>{t("忽略候选")}</Button></> : <span>{t("已忽略")}</span>}</div></div>)}
    <h3>{t("备份与恢复")}</h3><div className={styles.toolbar}><Button size="sm" onClick={() => void mutate('linguistProjectsBackup', { projectId }, t("备份已创建"))}>{t("创建备份")}</Button><Button size="sm" onClick={() => void refreshBackups()}>{t("刷新备份")}</Button></div>
    {backups.map((backup) => <div key={backup.name} className={styles.toolbar}><span>{backup.name} · {backup.format} · {backup.sizeBytes} bytes</span><Button size="sm" disabled={archived} onClick={() => { void required<{restorable:boolean;notice?:string}>('linguistBackupsPreviewRestore', { projectId, backupName: backup.name }).then((preview) => setRestorePreview({ ...preview, backupName: backup.name })).catch((error: unknown) => setMessage(describeProjectError(error, t))) }}>{t("预览恢复")}</Button></div>)}
    {restorePreview && <div className={styles.callout}><strong>{restorePreview.backupName}</strong><p>{restorePreview.notice ?? (restorePreview.restorable ? t("验证通过，可恢复") : t("此备份不可恢复"))}</p><Button size="sm" disabled={archived || !restorePreview.restorable} onClick={() => void mutate('linguistBackupsRestore', { projectId, backupName: restorePreview.backupName }, t("项目已从备份恢复"))}>{t("确认恢复")}</Button></div>}
    <h3>{t("完整性与诊断")}</h3><div className={styles.toolbar}><Button size="sm" onClick={() => void startIntegrity()}>{t("运行全量完整性检查")}</Button>{integrityJob && !integrityComplete && <Button size="sm" onClick={() => void mutate('linguistIntegrityCancel', { projectId, jobId: integrityJob })}>{t("取消全检")}</Button>}<span role="status">{integrityStatus}</span>{integrityComplete && <Button size="sm" onClick={() => void exportManagedFile('linguistIntegrityExportReport', { projectId, jobId: integrityJob })}>{t("下载脱敏全检报告")}</Button>}<Button size="sm" onClick={() => { void required<ProjectDiagnosticsStatus>('linguistDiagnosticsGetStatus', { projectId, ...(sessionId ? { sessionId } : {}) }).then(setDiagnostics).catch((error: unknown) => setMessage(describeProjectError(error, t))) }}>{t("检查运行状态")}</Button><Button size="sm" onClick={() => { void required<unknown>('linguistDiagnosticsPreviewBundle', { projectId, ...(sessionId ? { sessionId } : {}) }).then(setDiagnosticsPreview).catch((error: unknown) => setMessage(describeProjectError(error, t))) }}>{t("预览脱敏诊断包")}</Button>{diagnosticsPreview !== undefined && <Button size="sm" onClick={() => void exportManagedFile('linguistDiagnosticsExportBundle', { projectId, ...(sessionId ? { sessionId } : {}) })}>{t("下载诊断包")}</Button>}</div>{diagnostics && <div className={styles.callout} role="status"><strong>{t('Prompt 状态')}</strong><p>Version {diagnostics.prompt.promptVersion} · {t('岗位')} {diagnostics.prompt.role} · {t('项目版本')} {diagnostics.projectRevision}</p><p>{t('项目摘要状态')}：{diagnostics.prompt.projectDigestStatus}{diagnostics.prompt.projectDigestTruncated ? ` · ${t('摘要已按预算裁减')}` : ''}</p><p>Hash {diagnostics.prompt.promptHash} · {diagnostics.prompt.charCount} {t('字符')}</p></div>}{diagnosticsPreview !== undefined && <details><summary>{t("诊断包预览")}</summary><pre>{JSON.stringify(diagnosticsPreview, null, 2)}</pre></details>}{download && <p><a href={fileUrl(download.token)} download={download.filename} onClick={() => setDownload(undefined)}>{t("下载")} {download.filename}</a></p>}
    <h3>{t("归档与移入回收区")}</h3><div className={styles.toolbar}><Button size="sm" disabled={archived} onClick={() => void mutate('linguistProjectsArchive', { projectId }, t("项目已归档"))}>{t("归档项目")}</Button><Input disabled={!archived} aria-label={t("输入项目名称确认移入回收区")} placeholder={t("输入完整项目名")} value={confirmName} onChange={(event) => setConfirmName(event.target.value)} /><Button size="sm" disabled={!archived || confirmName !== project.name} onClick={() => void mutate('linguistProjectsDelete', { projectId, confirmationName: confirmName }, t("项目已移入回收区"))}>{t("移入回收区")}</Button></div>
    {message && <p role="status">{message}</p>}
  </section>
}
