import * as React from 'react'
import { Button } from '@deepseek-ai/dsh-client-ui-primitives'
import type { ImageAttachmentRef } from '@deepseek-ai/dsh-attachment/types'
import type { ToolCallViewProps } from '@deepseek-ai/dsh-client-ui-tool/client'
import type { ContentBlock } from '@deepseek-ai/dsh-llm'
import type { CatNavigation, CatDock } from './cat-navigation'
import { useT } from './ui-locale'
import styles from './CatToolResult.module.css'

export const catToolNames = [
  'cat_project_summary', 'cat_list_batches', 'cat_get_segments', 'cat_import_resources',
  'cat_refresh_project_inventory', 'cat_preview_workbook_mapping', 'cat_save_workbook_mapping',
  'cat_upsert_voice_profile', 'cat_add_approved_exemplar', 'cat_get_voice_context',
  'cat_scan_unknown_tag_patterns', 'cat_save_tag_profile_candidate', 'cat_export_batch',
  'cat_get_translation_context', 'cat_get_proposal_snapshot', 'cat_apply_translations',
  'cat_confirm_segments', 'cat_search_tm', 'cat_search_terms', 'cat_upsert_terms',
  'cat_delete_terms', 'cat_list_term_conflicts', 'cat_validate_terms', 'cat_propose_translations',
  'cat_accept_proposals', 'cat_run_qa', 'cat_get_qa_findings', 'cat_plan_consistency_repairs',
  'cat_create_consistency_proposals', 'cat_search_sentence_patterns', 'cat_read_context_doc',
] as const

const titles: Record<(typeof catToolNames)[number], string> = {
  cat_project_summary: '项目摘要', cat_list_batches: '工作批次', cat_get_segments: '句段清单',
  cat_import_resources: '资源导入', cat_refresh_project_inventory: '资源清单刷新',
  cat_preview_workbook_mapping: '表格列映射预览', cat_save_workbook_mapping: '保存表格列映射',
  cat_upsert_voice_profile: '保存 Voice Profile', cat_add_approved_exemplar: '批准译例',
  cat_get_voice_context: '声音规范', cat_scan_unknown_tag_patterns: '疑似 Tag 扫描',
  cat_save_tag_profile_candidate: '保存 Tag 候选', cat_export_batch: '批次导出',
  cat_get_translation_context: '翻译上下文', cat_get_proposal_snapshot: '建议快照',
  cat_apply_translations: '译文写回', cat_confirm_segments: '阶段确认',
  cat_search_tm: '翻译记忆', cat_search_terms: '术语检索', cat_upsert_terms: '保存术语',
  cat_delete_terms: '删除术语', cat_list_term_conflicts: '术语冲突',
  cat_validate_terms: '术语校验', cat_propose_translations: '翻译建议',
  cat_accept_proposals: '接受建议', cat_run_qa: '确定性 QA', cat_get_qa_findings: 'QA 问题',
  cat_plan_consistency_repairs: '一致性检查', cat_create_consistency_proposals: '一致性建议',
  cat_search_sentence_patterns: '句式检索', cat_read_context_doc: '上下文文档',
}

const PROJECT_ID = /^prj-[0-9a-f]{16}$/
const ASSET_ID = /^ast(?:-[0-9a-f]{16}|_v2_[0-9a-f]{64})$/
const SEGMENT_ID = /^seg(?:-[0-9a-f]{16}|_v2_[0-9a-f]{64})$/
const PROPOSAL_ID = /^prp(?:-[0-9a-f]{16}|_v2_[0-9a-f]{64})$/
const FINDING_ID = /^qaf(?:-[0-9a-f]{16}|_v2_[0-9a-f]{64})$/

function object(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : undefined
}

function readId(value: unknown, pattern: RegExp): string | undefined {
  return typeof value === 'string' && pattern.test(value) ? value : undefined
}

function firstObject(value: unknown): Record<string, unknown> | undefined {
  return Array.isArray(value) ? object(value[0]) : undefined
}

function readPayload(text: string | undefined): Record<string, unknown> | undefined {
  if (text === undefined) return undefined
  try { return object(JSON.parse(text)) } catch { return undefined }
}

function count(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : undefined
}

function resultSummary(toolName: string, payload: Record<string, unknown> | undefined, t: (key: string, params?: Record<string, unknown>) => string): string {
  if (!payload) return t('结果已返回，展开查看完整内容')
  if (toolName === 'cat_read_context_doc') {
    const shown = typeof payload.text === 'string' ? payload.text.length : 0
    return t('已读取 {shown} / {total} 字符', { shown, total: count(payload.totalChars) ?? '?' })
  }
  if (toolName === 'cat_apply_translations') return t('请求 {requested} · 已应用 {applied} · 待审 {pending} · 过期 {stale} · 锁定 {locked} · 失败 {failed}', {
    requested: count(payload.requested) ?? 0, applied: count(payload.applied) ?? 0, pending: count(payload.pending) ?? 0,
    stale: Array.isArray(payload.stale) ? payload.stale.length : 0, locked: Array.isArray(payload.locked) ? payload.locked.length : 0,
    failed: Array.isArray(payload.failed) ? payload.failed.length : 0,
  })
  if (toolName === 'cat_import_resources') return t('已导入 {imported} · 未变化 {skipped} · 待处理 {needsInput} · 失败 {failed}', {
    imported: count(payload.imported) ?? 0, skipped: count(payload.skippedDuplicate) ?? 0,
    needsInput: count(payload.needsInput) ?? 0, failed: count(payload.failed) ?? 0,
  })
  if (toolName === 'cat_run_qa') return t('发现 {count} 个 QA 问题', { count: count(payload.total) ?? 0 })
  if (toolName === 'cat_project_summary') return t('{batches} 个批次 · {segments} 个句段', {
    batches: count(payload.batchCount ?? payload.assetCount) ?? 0, segments: count(payload.totalSegments) ?? 0,
  })
  if (toolName === 'cat_propose_translations' || toolName === 'cat_create_consistency_proposals')
    return t('生成 {count} 条待审建议', { count: Array.isArray(payload.proposalIds) ? payload.proposalIds.length : 0 })
  if (toolName === 'cat_accept_proposals')
    return t('已接受 {count} 条建议', { count: Array.isArray(payload.accepted) ? payload.accepted.length : 0 })
  if (toolName === 'cat_export_batch')
    return t('{filename} · {count} 段已回读验证', { filename: typeof payload.filename === 'string' ? payload.filename : '', count: count(payload.verifiedSegments) ?? 0 })
  if (toolName === 'cat_confirm_segments') {
    const coverage = object(payload.coverage)
    const review = object(payload.fullReview)
    return t('本次记录 {decisions} 段 · 决策覆盖 {covered}/{total} · 证据状态 {status}', {
      decisions: Array.isArray(payload.decisions) ? payload.decisions.length : 0,
      covered: (count(coverage?.total) ?? 0) - (count(coverage?.pending) ?? 0),
      total: count(coverage?.total) ?? 0,
      status: typeof review?.status === 'string' ? review.status : t('未签发'),
    })
  }
  if (toolName === 'cat_validate_terms') return t('必用缺失 {missing} · 禁用命中 {forbidden} · 首选未用 {preferred} · 冲突 {conflicts}', {
    missing: Array.isArray(payload.missingRequired) ? payload.missingRequired.length : 0,
    forbidden: Array.isArray(payload.forbiddenHits) ? payload.forbiddenHits.length : 0,
    preferred: Array.isArray(payload.preferredNotUsed) ? payload.preferredNotUsed.length : 0,
    conflicts: Array.isArray(payload.unresolvedConflicts) ? payload.unresolvedConflicts.length : 0,
  })
  if (toolName === 'cat_upsert_terms' || toolName === 'cat_delete_terms' || toolName === 'cat_list_term_conflicts')
    return t('处理 {count} 条术语记录', { count: count(payload.count) ?? 0 })
  if (toolName === 'cat_plan_consistency_repairs') return t('{groups} 组发现 {findings} 个问题', {
    groups: count(payload.groupCount) ?? 0, findings: count(payload.findingCount) ?? 0,
  })
  if (Array.isArray(payload.items)) return t('显示 {shown} / {total} 条', { shown: payload.items.length, total: count(payload.total) ?? payload.items.length })
  if (Array.isArray(payload.results)) return t('找到 {total} 条结果', { total: count(payload.total) ?? payload.results.length })
  if (Array.isArray(payload.contexts)) return t('已读取 {count} 个句段上下文', { count: payload.contexts.length })
  if (Array.isArray(payload.patterns)) return t('发现 {count} 类疑似 Tag', { count: payload.patterns.length })
  if (Array.isArray(payload.proposals)) return t('处理 {count} 条建议', { count: payload.proposals.length })
  if (Array.isArray(payload.confirmed)) return t('已确认 {count} 个句段', { count: payload.confirmed.length })
  if (typeof payload.status === 'string') return t('状态：{status}', { status: payload.status })
  if (typeof payload.filename === 'string') return payload.filename
  return t('结构化结果已返回，展开查看完整内容')
}

interface ResultAnchor { label: string; count?: number; location: CatNavigation }

function resultAnchors(toolName: string, payload: Record<string, unknown> | undefined, sessionId: string, argsRaw: string | undefined): ResultAnchor[] {
  const projectId = readId(payload?.projectId, PROJECT_ID)
  if (!projectId || !payload) return []
  const args = readPayload(argsRaw)
  const firstItem = firstObject(payload.items)
  const firstProposal = firstObject(payload.proposals)
  const firstContext = firstObject(payload.contexts)
  const assetId = readId(payload.batchId ?? payload.assetId ?? firstItem?.batchId ?? firstItem?.assetId ?? args?.batchId, ASSET_ID)
  const segmentId = readId(payload.segmentId ?? (Array.isArray(payload.segmentIds) ? payload.segmentIds[0] : undefined)
    ?? firstItem?.segmentId ?? firstContext?.segmentId ?? firstProposal?.segmentId, SEGMENT_ID)
  const proposalId = readId(payload.proposalId ?? (Array.isArray(payload.proposalIds) ? payload.proposalIds[0] : undefined)
    ?? firstItem?.proposalId ?? firstProposal?.proposalId, PROPOSAL_ID)
  const findingId = readId(payload.findingId ?? (Array.isArray(payload.qaFindingIds) ? payload.qaFindingIds[0] : undefined)
    ?? (toolName === 'cat_get_qa_findings' ? firstItem?.id : undefined), FINDING_ID)
  const docId = typeof payload.docId === 'string' && /^[a-z0-9][a-z0-9_-]{1,100}$/i.test(payload.docId) ? payload.docId : undefined
  const base: CatNavigation = { sessionId, projectId }
  const links: ResultAnchor[] = [{ label: '项目', location: base }]
  if (assetId) links.push({ label: '批次', location: { ...base, assetId } })
  if (segmentId) links.push({ label: '句段', location: { ...base, segmentId } })
  const dock: CatDock | undefined = toolName.includes('qa') || findingId ? 'qa'
    : toolName.includes('proposal') || toolName === 'cat_apply_translations' ? 'proposals'
      : toolName.includes('context') || docId ? 'assets'
        : toolName.includes('term') || toolName.includes('tm') || toolName.includes('sentence_pattern') ? 'references'
          : toolName.includes('export') ? 'delivery'
            : toolName.includes('tag') || toolName.includes('voice') ? 'settings'
              : undefined
  if (dock === 'qa') links.push({ label: 'QA', location: { ...base, ...(assetId ? { assetId } : {}), ...(segmentId ? { segmentId } : {}), ...(findingId ? { findingId } : {}), dock } })
  if (dock === 'proposals') links.push({ label: '建议', location: { ...base, ...(assetId ? { assetId } : {}), ...(segmentId ? { segmentId } : {}), ...(proposalId ? { proposalId } : {}), dock } })
  if (dock === 'assets' && docId) links.push({ label: '上下文', location: { ...base, docId, dock } })
  if (toolName === 'cat_get_translation_context' && segmentId) links.push({ label: '上下文', location: { ...base, segmentId, inspector: true } })
  if (dock === 'references') links.push({ label: '参考库', location: { ...base, ...(segmentId ? { segmentId } : {}), dock } })
  if (dock === 'delivery') links.push({ label: '交付', location: { ...base, ...(assetId ? { assetId } : {}), dock } })
  if (toolName === 'cat_apply_translations') {
    const groups: readonly [string, unknown, unknown][] = [
      ['版本冲突', payload.stale, Array.isArray(payload.stale) ? payload.stale[0] : undefined],
      ['锁定跳过', payload.locked, Array.isArray(payload.locked) ? payload.locked[0] : undefined],
      ['失败项', payload.failed, firstObject(payload.failed)?.segmentId],
    ]
    for (const [label, values, id] of groups) {
      const target = readId(id, SEGMENT_ID)
      if (target && Array.isArray(values) && values.length > 0) links.push({ label, count: values.length, location: { ...base, segmentId: target, dock: 'proposals' } })
    }
  }
  return links
}

function ToolImage({ attachment, loadImage }: { attachment: ImageAttachmentRef; loadImage: ToolCallViewProps['loadImage'] }): React.ReactElement {
  const t = useT()
  const [url, setUrl] = React.useState(() => loadImage.peek?.(attachment))
  const [error, setError] = React.useState('')
  React.useEffect(() => {
    let live = true
    loadImage(attachment).then((next) => { if (live) setUrl(next) }).catch((cause: unknown) => { if (live) setError(String(cause)) })
    return () => { live = false }
  }, [attachment, loadImage])
  return <figure className={styles.image}>{url ? <img src={url} alt={attachment.name ?? t('工具结果图像')} /> : <span>{error || t('正在读取图像…')}</span>}{attachment.name && <figcaption>{attachment.name}</figcaption>}</figure>
}

export function CatToolResult({ props, onNavigate }: { props: ToolCallViewProps; onNavigate: (location: CatNavigation) => Promise<void> }): React.ReactElement {
  const t = useT()
  const { expanded, toggle } = props.useDisclosure()
  const [navigationError, setNavigationError] = React.useState('')
  const name = props.toolName as (typeof catToolNames)[number]
  const title = t(titles[name] ?? name)
  const result = props.phase === 'result' ? props.block : undefined
  const firstText = result?.content.find((item: ContentBlock) => item.type === 'text')
  const payload = readPayload(firstText?.type === 'text' ? firstText.text : undefined)
  const anchors = result?.isError ? [] : resultAnchors(props.toolName, payload, String(props.sessionId), result?.call?.argsRaw)
  const state = props.phase === 'preparing' ? t('准备中') : props.phase === 'start' ? t('执行中') : result?.isError ? t('执行失败') : t('已完成')
  const details = props.phase === 'start' ? props.block.argsRaw
    : result?.call?.argsRaw
  const hasBody = !!details || !!result?.content.length || !!result?.error
  return <section className={styles.card} aria-label={t('{title}工具结果', { title })}>
    <div className={styles.head}>
      <Button variant="ghost" size="sm" type="button" className={styles.toggle} aria-expanded={expanded && hasBody} disabled={!hasBody} onClick={toggle}>
        <span className={styles.caret} aria-hidden="true">{expanded ? '▾' : '▸'}</span><strong>{title}</strong>
        <span className={result?.isError ? styles.error : styles.state}>{state}</span>
      </Button>
      {props.inspect && <Button variant="ghost" size="sm" type="button" className={styles.inspect} onClick={props.inspect}>{t('查看轨迹')}</Button>}
    </div>
    {result && <p className={styles.summary}>{result.isError ? result.error?.reason ?? t('工具执行失败，展开查看详情') : resultSummary(props.toolName, payload, t)}</p>}
    {anchors.length > 0 && <nav className={styles.anchors} aria-label={t('工具结果定位')}>
      {anchors.map(({ label, count, location }) => <Button variant="ghost" size="sm" key={label} type="button" onClick={() => { setNavigationError(''); void onNavigate(location).catch((cause: unknown) => setNavigationError(String(cause))) }}>{t(label)}{count === undefined ? '' : ` ${count}`}</Button>)}
    </nav>}
    {navigationError && <p role="alert" className={styles.error}>{navigationError}</p>}
    {expanded && hasBody && <div className={styles.body}>
      {details && <details><summary>{t('调用参数')}</summary><pre>{details}</pre></details>}
      {result?.error && <p role="alert">{result.error.code} · {result.error.reason ?? result.error.name}</p>}
      {result?.content.map((item: ContentBlock, index: number) => item.type === 'image'
        ? <ToolImage key={index} attachment={item.attachment} loadImage={props.loadImage} />
        : <pre key={index}>{item.type === 'text' || item.type === 'reasoning' ? item.text : JSON.stringify(item, null, 2)}</pre>)}
    </div>}
  </section>
}
