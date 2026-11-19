import * as React from 'react'
import { useAtomValue, type PrimitiveAtom } from 'jotai'
import { Button, Checkbox, Input, Tooltip } from '@deepseek-ai/dsh-client-ui-primitives'
import { pairingErrors, scanTags } from '@linguist/cat-core'
import type { LinguistAssetsQueryResult, LinguistConcordanceResult, LinguistContextDocInfo, LinguistEditorDetails, LinguistEditorTermsResult, LinguistProposalInfo, LinguistSegmentInfo, LinguistSpellingResult, LinguistTagProfileInfo, LinguistTechConstraintInfo, LinguistTermMatchInfo } from '@linguist/domain-service/contracts'
import { required } from './api'
import { isProtectedCatDraft } from './cat-editor-state'
import { analyzeSegmentAssistance, analyzeTerms, type AssistIssue } from './editor-assist'
import { InlineTaggedText } from './InlineTaggedText'
import { inlineOffsetToDomPoint, readInlineDomText, type InlineAnnotation } from './inline-tokens'
import { TargetEditor, targetProtectionViolations, type TargetEditorDraft, type TargetEditorHandle, type TargetEditorProps } from './TargetEditor'
import { PreviewView, type PreviewRequest } from './PreviewView'
import { editorDiffParts } from './editor-diff'
import { TERM_STATUS_LABELS } from './workflow-ui'
import { useT } from './ui-locale'
import { RelatedSegments } from './RelatedSegments'
import styles from './EditorAssistance.module.css'

export interface EditorViewOptions { invisibles: boolean; formatCodes: boolean; terms: boolean; critical: boolean; spelling: boolean; differences: boolean; context: boolean }
export const defaultEditorViews: EditorViewOptions = { invisibles: false, formatCodes: false, terms: true, critical: true, spelling: true, differences: false, context: false }
const storageKey = 'linguist:editor-views'
export function useEditorViewOptions(): [EditorViewOptions, (patch: Partial<EditorViewOptions>) => void, string] {
  const [error, setError] = React.useState('')
  const [options, setOptions] = React.useState<EditorViewOptions>(defaultEditorViews)
  React.useEffect(() => {
    const load = () => {
      try {
        const raw = localStorage.getItem(storageKey)
        if (raw) {
          const saved = JSON.parse(raw)
          const valid = Object.fromEntries(Object.entries(defaultEditorViews).map(([key, fallback]) => [key, typeof saved[key] === 'boolean' ? saved[key] : fallback])) as unknown as EditorViewOptions
          setOptions(valid)
        }
      } catch (cause) { setError(String(cause)) }
    }
    load()
    window.addEventListener(storageKey, load)
    window.addEventListener('storage', load)
    return () => { window.removeEventListener(storageKey, load); window.removeEventListener('storage', load) }
  }, [])
  const update = (patch: Partial<EditorViewOptions>) => {
    const next = { ...options, ...patch }
    setOptions(next)
    try { localStorage.setItem(storageKey, JSON.stringify(next)); window.dispatchEvent(new Event(storageKey)); setError('') }
    catch (cause) { setError(String(cause)) }
  }
  return [options, update, error]
}

export function EditorViewControls({ options, onChange }: { options: EditorViewOptions; onChange: (patch: Partial<EditorViewOptions>) => void }): React.ReactElement {
  const t = useT()
  return <div className={styles.viewControls} role="group" aria-label={t('编辑辅助')}>
    <Button variant="ghost" size="sm" aria-pressed={options.formatCodes} title={t('显示原生格式码；不改变文本')} onClick={() => onChange({ formatCodes: !options.formatCodes })}>{t('格式码')}</Button>
    <Button variant="ghost" size="sm" aria-pressed={options.invisibles} title={t('显示空格、换行、Tab 与特殊不可见字符；不改变文本')} onClick={() => onChange({ invisibles: !options.invisibles })}>¶ {t('不可见字符')}</Button>
    <details className={styles.viewMenu} onKeyDown={event => { if (event.key === 'Escape') { event.preventDefault(); event.currentTarget.open = false; event.currentTarget.querySelector('summary')?.focus() } }}><summary>{t('编辑辅助')}</summary><div className={styles.viewOptions}>
      {(['terms', 'critical', 'spelling', 'differences', 'context'] as const).map(key => <Checkbox key={key} label={t(({ terms: '术语提示', critical: '数字与变量', spelling: '拼写检查', differences: '修改差异', context: '行内上下文' })[key])} checked={options[key]} onChange={value => onChange({ [key]: value })} />)}
      <small>{t('运行时标签始终以 chip 显示；格式码与显示辅助不自动修改或确认译文。')}</small>
    </div></details>
  </div>
}

export function useEditorTerms(projectId: string, segments: readonly LinguistSegmentInfo[], mutation: number) {
  const scope = `${projectId}\0${mutation}`
  const key = `${scope}\0${segments.map(segment => `${segment.id}:${segment.sourceHash}`).join('|')}`
  const [result, setResult] = React.useState<{ scope: string; key: string; data?: LinguistEditorTermsResult; error?: string }>()
  React.useEffect(() => {
    if (!segments.length) return
    let live = true
    const timer = setTimeout(() => {
      const requests: Array<Promise<LinguistEditorTermsResult>> = []
      for (let offset = 0; offset < segments.length; offset += 200) requests.push(required<LinguistEditorTermsResult>('linguistCatEditorTerms', { projectId, segmentIds: segments.slice(offset, offset + 200).map(segment => segment.id) }))
      Promise.all(requests).then(pages => { if (live) setResult({ scope, key, data: { items: pages.flatMap(page => page.items) } }) }).catch(cause => { if (live) setResult({ scope, key, error: String(cause) }) })
    }, 150)
    return () => { live = false; clearTimeout(timer) }
  }, [key])
  const sources = new Map(segments.map(segment => [segment.id, segment.sourceHash]))
  return { items: new Map((result?.scope === scope ? result.data?.items ?? [] : []).filter(item => sources.get(item.segmentId) === item.sourceHash).map(item => [item.segmentId, item])), error: result?.key === key ? result.error : undefined }
}

const termStateLabels = { present: '译文已匹配', missing: '译文待核对', forbidden: '命中禁用或弃用译法', conflict: '术语译法冲突', review: '需要人工核对' }

function SourceText({ segment, target, matches, options, tagProfile, formatId, activeTag, onTagFocus, annotations }: { segment: LinguistSegmentInfo; target: string; matches: LinguistTermMatchInfo[]; options: EditorViewOptions; tagProfile?: LinguistTagProfileInfo; formatId?: string; activeTag?: string; onTagFocus: (key: string | undefined) => void; annotations: InlineAnnotation[] }) {
  const t = useT()
  const terms = React.useMemo(() => analyzeTerms(matches, target, tagProfile, segment.targetLocale), [matches, target, tagProfile, segment.targetLocale])
  const groups = new Map<string, typeof terms>()
  if (options.terms) for (const term of terms) { const key = `${term.match.start}:${term.match.end}`; groups.set(key, [...groups.get(key) ?? [], term]) }
  // Only the complete outer field receives formatId; term substrings must not re-parse wrappers.
  return <InlineTaggedText text={segment.source} sourceText={segment.source} tagProfile={tagProfile} formatId={formatId} targetLocale={segment.targetLocale} activeTag={activeTag} onTagFocus={onTagFocus} annotations={annotations} showInvisibles={options.invisibles} showFormatCodes={options.formatCodes} formatIssueLabel={t('存在未识别或未配对的格式码；已保留原文显示。')} renderText={(raw, start) => {
    const end = start + raw.length
    const relevant = [...groups.values()].filter(group => group[0]!.match.start < end && group[0]!.match.end > start).sort((a, b) => a[0]!.match.start - b[0]!.match.start)
    const output: React.ReactNode[] = []
    let cursor = start
    for (const group of relevant) {
      const left = Math.max(cursor, group[0]!.match.start), right = Math.min(end, group[0]!.match.end)
      if (right <= left) continue
      if (left > cursor) output.push(<InlineTaggedText key={`text:${cursor}`} text={segment.source.slice(cursor, left)} showInvisibles={options.invisibles} />)
      const label = group.map(item => [`${item.match.term} → ${item.match.translation}`, `${t(TERM_STATUS_LABELS[item.match.status])} · ${t(termStateLabels[item.state])}`, item.match.note, item.match.module, item.match.category, item.match.lowDiscrimination ? t('短术语匹配，请结合上下文核对。') : ''].filter(Boolean).join('\n')).join('\n\n')
      output.push(<Tooltip portal key={`term:${left}`} label={label}><span tabIndex={0} data-assist-id={`term:${group[0]!.match.id}:${group[0]!.match.start}`} className={styles.term} data-warning={group.some(item => item.state === 'forbidden' || item.state === 'conflict')} aria-label={group.map(item => `${item.match.term} → ${item.match.translation} · ${t(termStateLabels[item.state])}`).join('; ')}><InlineTaggedText text={segment.source.slice(left, right)} showInvisibles={options.invisibles} /></span></Tooltip>)
      cursor = right
    }
    if (cursor < end) output.push(<InlineTaggedText key={`text:${cursor}`} text={segment.source.slice(cursor, end)} showInvisibles={options.invisibles} />)
    return output
  }} />
}

export interface SegmentTextCellsProps {
  projectId: string; mutation: number; segment: LinguistSegmentInfo; selected: boolean; editing: boolean; draftAtom: PrimitiveAtom<TargetEditorDraft | undefined>; options: EditorViewOptions; termMatches: LinguistTermMatchInfo[]; termsTruncated?: boolean; archived: boolean; tagProfile?: LinguistTagProfileInfo; formatId?: string; sourceClassName: string; targetClassName: string; targetButtonClassName: string; proposal?: LinguistProposalInfo; signals: React.ReactNode; editorProps: Omit<TargetEditorProps, 'draftAtom' | 'segment' | 'archived' | 'tagProfile' | 'formatId'>; onStartEdit: () => void; onNavigate: (id: string) => void
}

export function SegmentTextCells(props: SegmentTextCellsProps): React.ReactElement {
  const t = useT()
  const { segment, options } = props
  const draft = useAtomValue(props.draftAtom)
  const protectedDraft = isProtectedCatDraft(draft) ? draft : undefined
  const target = protectedDraft?.state.value ?? segment.target
  const [activeTag, setActiveTag] = React.useState<string>()
  const [activeAssist, setActiveAssist] = React.useState<string>()
  const readAssist = (target: EventTarget | null) => target instanceof Element ? target.closest<HTMLElement>('[data-assist-id]')?.dataset.assistId : undefined
  const [handle, setHandle] = React.useState<TargetEditorHandle>()
  const [selectedText, setSelectedText] = React.useState('')
  const sourceRef = React.useRef<HTMLDivElement>(null)
  const targetRef = React.useRef<HTMLDivElement>(null)
  const locateRange = (side: 'source' | 'target', start: number, end: number) => {
    if (side === 'target' && handle) { handle.select(start, end); return }
    const cell = side === 'source' ? sourceRef.current : targetRef.current
    const text = cell?.querySelector<HTMLElement>('[data-inline-view]')
    if (!cell || !text) return
    cell.focus({ preventScroll: true })
    const left = inlineOffsetToDomPoint(text, start), right = inlineOffsetToDomPoint(text, end)
    text.ownerDocument.getSelection()?.setBaseAndExtent(left.node, left.offset, right.node, right.offset)
    cell.scrollIntoView({ block: 'nearest' })
  }
  const handleChange = React.useCallback((value: TargetEditorHandle | undefined) => { setHandle(value); props.editorProps.onHandleChange?.(value) }, [props.editorProps.onHandleChange])
  const [spelling, setSpelling] = React.useState<{ key: string; value: LinguistSpellingResult }>()
  const [spellingError, setSpellingError] = React.useState('')
  const [spellingRevision, setSpellingRevision] = React.useState(0)
  const spellKey = `${props.projectId}\0${segment.id}\0${segment.targetLocale}\0${props.mutation}\0${spellingRevision}\0${target}`
  React.useEffect(() => {
    if (!props.selected || !options.spelling || draft?.state.composing) return
    let live = true
    const timeout = setTimeout(() => {
      required<LinguistSpellingResult>('linguistCatSpellcheck', { projectId: props.projectId, locale: segment.targetLocale, text: target }).then(value => { if (live) { setSpelling({ key: spellKey, value }); setSpellingError('') } }).catch(cause => { if (live) setSpellingError(String(cause)) })
    }, 450)
    return () => { live = false; clearTimeout(timeout) }
  }, [spellKey, props.selected, props.mutation, options.spelling, draft?.state.composing, spellingRevision])
  const currentSpelling = spelling?.key === spellKey && options.spelling ? spelling.value : undefined
  const inline = React.useMemo(() => analyzeSegmentAssistance({ source: segment.source, target, termMatches: props.termMatches, tagProfile: props.tagProfile, sourceLocale: segment.sourceLocale, targetLocale: segment.targetLocale }), [segment.source, target, props.termMatches, props.tagProfile, segment.sourceLocale, segment.targetLocale])
  const sourceAnnotations: InlineAnnotation[] = options.critical ? inline.numberPairs.map(pair => ({ id: pair.id, ...pair.source, kind: 'number', active: activeAssist === pair.id, title: `${pair.label} · ${t(pair.uncertain || !pair.target.length ? '源译对应待核对' : '源译数字对应')}` })) : []
  const annotations: InlineAnnotation[] = [
    ...(currentSpelling?.issues.map((item, index): InlineAnnotation => ({ id: `spelling:${index}`, start: item.start, end: item.end, kind: 'spelling', title: `${t('疑似拼写问题')}：${item.word}${item.suggestions.length ? ` → ${item.suggestions.join(' / ')}` : ''}` })) ?? []),
    ...(options.critical ? inline.numberPairs.flatMap(pair => pair.target.map(range => ({ id: pair.id, ...range, kind: 'number' as const, active: activeAssist === pair.id, title: pair.label }))) : []),
    ...(options.terms ? inline.terms.flatMap(item => item.targetRanges.map(range => ({ id: `term:${item.match.id}:${item.match.start}`, ...range, kind: 'term' as const, active: activeAssist === `term:${item.match.id}:${item.match.start}`, title: `${item.match.term} → ${item.match.translation} · ${t(termStateLabels[item.state])}` }))) : []),
  ]
  const captureSelection = (event: React.MouseEvent<HTMLElement>) => {
    const selection = window.getSelection()
    if (selection && !selection.isCollapsed && selection.anchorNode && event.currentTarget.contains(selection.anchorNode)) setSelectedText(readInlineDomText(selection.getRangeAt(0).cloneContents()).slice(0, 500))
  }
  return <>
    <div ref={sourceRef} tabIndex={-1} className={props.sourceClassName} role="gridcell" data-label={t('源文')} lang={segment.sourceLocale} dir="auto" onMouseUp={captureSelection} onMouseOver={event => setActiveAssist(readAssist(event.target))} onMouseLeave={() => setActiveAssist(undefined)} onFocusCapture={event => setActiveAssist(readAssist(event.target))} onBlurCapture={() => setActiveAssist(undefined)}>
      <SourceText segment={segment} target={target} matches={props.termMatches} options={options} tagProfile={props.tagProfile} formatId={props.formatId} activeTag={activeTag} onTagFocus={setActiveTag} annotations={sourceAnnotations} />
      {props.selected && options.context && <small className={styles.sourceContext}>{segment.key && <>Key: {segment.key}<br /></>}{segment.context?.meta?.speaker && <>{t('说话人')}：{segment.context.meta.speaker}<br /></>}{segment.context?.note}</small>}
    </div>
    <div ref={targetRef} tabIndex={-1} className={props.targetClassName} role="gridcell" data-label={t('译文')} lang={segment.targetLocale} dir="auto" onMouseUp={captureSelection}>
      {props.editing ? <TargetEditor {...props.editorProps} draftAtom={props.draftAtom} segment={segment} archived={props.archived} tagProfile={props.tagProfile} formatId={props.formatId} showInvisibles={options.invisibles} showFormatCodes={options.formatCodes} activeTag={activeTag} onTagFocus={setActiveTag} onHandleChange={handleChange} onSelectedText={setSelectedText} annotations={annotations} spellCheck={options.spelling && !/^en(?:-US)?$/i.test(segment.targetLocale)} />
        : <button type="button" className={props.targetButtonClassName} disabled={segment.locked || props.archived} onClick={event => { if (event.detail === 0 || window.getSelection()?.isCollapsed !== false) props.onStartEdit() }}><InlineTaggedText text={target || t('编辑译文…')} sourceText={segment.source} tagProfile={props.tagProfile} formatId={props.formatId} targetLocale={segment.targetLocale} showInvisibles={options.invisibles} showFormatCodes={options.formatCodes} formatIssueLabel={t('存在未识别或未配对的格式码；已保留原文显示。')} activeTag={activeTag} onTagFocus={setActiveTag} annotations={annotations} /></button>}
      {props.signals}
      {props.selected && <ActiveSegmentAssistance projectId={props.projectId} mutation={props.mutation} segment={segment} target={target} baseTarget={protectedDraft?.baseTarget ?? segment.target} options={options} termMatches={props.termMatches} termsTruncated={props.termsTruncated} tagProfile={props.tagProfile} proposal={props.proposal} selectedText={selectedText} onSelectedText={setSelectedText} handle={handle} spelling={currentSpelling} spellingError={spellingError} onDictionaryChanged={() => setSpellingRevision(value => value + 1)} archived={props.archived} onNavigate={props.onNavigate} onLocate={locateRange} />}
    </div>
  </>
}

function ActiveSegmentAssistance({ projectId, mutation, segment, target, baseTarget, options, termMatches, termsTruncated, tagProfile, proposal, selectedText, onSelectedText, handle, spelling, spellingError, onDictionaryChanged, archived, onNavigate, onLocate }: { projectId: string; mutation: number; segment: LinguistSegmentInfo; target: string; baseTarget: string; options: EditorViewOptions; termMatches: LinguistTermMatchInfo[]; termsTruncated?: boolean; tagProfile?: LinguistTagProfileInfo; proposal?: LinguistProposalInfo; selectedText: string; onSelectedText: (text: string) => void; handle?: TargetEditorHandle; spelling?: LinguistSpellingResult; spellingError: string; onDictionaryChanged: () => void; archived: boolean; onNavigate: (id: string) => void; onLocate: (side: 'source' | 'target', start: number, end: number) => void }) {
  const t = useT()
  const scope = `${projectId}\0${segment.id}\0${segment.revision}\0${mutation}`
  const [loaded, setLoaded] = React.useState<{ scope: string; details: LinguistEditorDetails; docs: LinguistContextDocInfo[]; constraints: LinguistTechConstraintInfo[] }>()
  const [error, setError] = React.useState('')
  const [retry, setRetry] = React.useState(0)
  const [issueType, setIssueType] = React.useState('all')
  const [issueIndex, setIssueIndex] = React.useState(-1)
  const [actionError, setActionError] = React.useState('')
  const [baseline, setBaseline] = React.useState('saved')
  const [concordanceOpen, setConcordanceOpen] = React.useState(false)
  const [dictionaryOpen, setDictionaryOpen] = React.useState(false)
  const [dictionaryWord, setDictionaryWord] = React.useState('')
  const dictionaryScope = React.useRef('')
  dictionaryScope.current = `${projectId}\0${segment.targetLocale}`
  const [preview, setPreview] = React.useState<PreviewRequest>()
  const loadAssets = async (kind: 'techConstraints' | 'contextDocs', segmentId?: string) => {
    const items: LinguistAssetsQueryResult['items'] = []
    let offset = 0
    for (;;) {
      const page = await required<LinguistAssetsQueryResult>('linguistAssetsQuery', { projectId, sourceAssetId: segment.assetId, kind, ...(segmentId ? { segmentId } : {}), limit: 200, offset })
      items.push(...page.items)
      if (!page.hasMore) return items
      if (!page.items.length) throw new Error('Language asset pagination returned an empty incomplete page')
      offset += page.items.length
    }
  }
  React.useEffect(() => {
    let live = true
    setError('')
    Promise.all([
      required<LinguistEditorDetails>('linguistCatEditorDetails', { projectId, segmentId: segment.id }),
      loadAssets('techConstraints'),
      loadAssets('contextDocs', segment.id),
    ]).then(([details, constraints, docs]) => { if (live) setLoaded({ scope, details, constraints: constraints.filter((item): item is LinguistTechConstraintInfo => 'valueJson' in item), docs: docs.filter((item): item is LinguistContextDocInfo => 'originalFilename' in item) }) }).catch(cause => { if (live) setError(String(cause)) })
    return () => { live = false }
  }, [scope, retry])
  const data = loaded?.scope === scope ? loaded : undefined
  const analysis = React.useMemo(() => analyzeSegmentAssistance({ source: segment.source, target, termMatches, meta: segment.context?.meta, constraints: data?.constraints, assetId: segment.assetId, tagProfile, sourceLocale: segment.sourceLocale, targetLocale: segment.targetLocale }), [segment.source, target, termMatches, segment.context?.meta, data?.constraints, segment.assetId, tagProfile, segment.sourceLocale, segment.targetLocale])
  const issues: Array<AssistIssue | { id: string; kind: string; side: 'target'; start: number; end: number; message: string }> = analysis.issues.filter(item => item.kind === 'term' ? options.terms : item.kind === 'number' || item.kind === 'variable' ? options.critical : true)
  const protection = targetProtectionViolations(segment, target, tagProfile)
  for (const [index, message] of [...protection, ...pairingErrors(scanTags(target, { profile: tagProfile, targetLocale: segment.targetLocale }))].entries()) issues.push({ id: `tag:${index}`, kind: 'tag', side: 'target', start: 0, end: 0, message: `${t('标签结构待检查')}：${message}` })
  if (options.spelling) for (const [index, item] of (spelling?.issues ?? []).entries()) issues.push({ id: `spelling:${index}`, kind: 'spelling', side: 'target', start: item.start, end: item.end, message: `${t('疑似拼写问题')}：${item.word}` })
  const shown = issues.filter(item => issueType === 'all' || item.kind === issueType)
  const locate = (item: typeof issues[number], index: number) => {
    setIssueIndex(index)
    onLocate(item.side, item.start, item.end)
  }
  const changeDictionary = async (word: string, included: boolean): Promise<boolean> => {
    const requestedScope = dictionaryScope.current
    try {
      await required('linguistCatSetSpellingWord', { projectId, locale: segment.targetLocale, word, included })
      if (dictionaryScope.current !== requestedScope) return false
      onDictionaryChanged(); setActionError(''); return true
    } catch (cause) { if (dictionaryScope.current === requestedScope) setActionError(String(cause)); return false }
  }
  const countByUnit = { 'code-points': analysis.length.target.codePoints, graphemes: analysis.length.target.graphemes, 'utf8-bytes': analysis.length.target.utf8Bytes, lines: analysis.length.target.lines }
  const unitNames = { 'code-points': t('码点'), graphemes: t('字素'), 'utf8-bytes': 'UTF-8 B', lines: t('行数') }
  const lengthLabel = (item: typeof analysis.length.constraints[number]) => `${countByUnit[item.unit]}${item.max === undefined ? '' : ` / ${item.max}`} ${unitNames[item.unit]}${item.min === undefined ? '' : ` · ${t('最少')} ${item.min}`}`
  const base = baseline === 'proposal' ? proposal?.proposedTarget : baseline === 'saved' ? baseTarget : data?.details.revisions.find(item => String(item.revision) === baseline)?.target
  const diff = React.useMemo(() => options.differences && base !== undefined ? editorDiffParts(base, target, tagProfile, segment.targetLocale) : [], [options.differences, base, target, tagProfile, segment.targetLocale])
  return <section className={styles.assistance} aria-label={t('当前句段编辑辅助')}>
    <div className={styles.summary}>
      <span>{analysis.length.constraints.length ? analysis.length.constraints.map(lengthLabel).join(' · ') : `${t('字符')} ${analysis.length.target.codePoints} · UTF-8 ${analysis.length.target.utf8Bytes} B`}</span>
      <select aria-label={t('本句提示类别')} value={issueType} onChange={event => { setIssueType(event.target.value); setIssueIndex(-1) }}><option value="all">{t('全部提示')} ({issues.length})</option>{[['term', '术语'], ['tag', '标签'], ['number', '数字'], ['variable', '变量'], ['length', '长度'], ['spelling', '拼写'], ['unicode', '特殊字符']].map(([key, label]) => <option key={key} value={key}>{t(label!)}</option>)}</select>
      <Button variant="ghost" size="sm" disabled={!shown.length} onClick={() => { const next = (issueIndex + 1) % shown.length; locate(shown[next]!, next) }}>{t('本句下一处')}{shown.length > 0 ? ` ${Math.max(0, issueIndex + 1)}/${shown.length}` : ''}</Button>
    </div>
    {shown.length > 0 && <details><summary>{t('查看本句提示')} · {shown.length}</summary><div className={styles.issueList}>{shown.map((item, index) => <Button key={item.id} variant="ghost" size="sm" aria-pressed={issueIndex === index} onClick={() => locate(item, index)}>{'messageKey' in item ? t(item.messageKey, item.values) : item.message}</Button>)}</div></details>}
    {termsTruncated && <p role="note">{t('术语匹配超过 200 项，仅显示前 200 项。')}</p>}
    <details><summary>{t('长度与计数口径')}</summary><p>{t('码点')} {analysis.length.target.codePoints} · {t('字素')} {analysis.length.target.graphemes} · UTF-8 {analysis.length.target.utf8Bytes} B · {t('行数')} {analysis.length.target.lines}</p>{analysis.length.constraints.length === 0 && <p>{t('没有可执行的显式长度限制。可在资料 → 技术约束中设置带单位的限制。')}</p>}{analysis.length.constraints.map(item => <p key={item.id}>{lengthLabel(item)}</p>)}{analysis.length.invalidConstraints.map(item => <p key={item.id} role="note">{t('长度约束未应用')}：{t(item.reason)}</p>)}<small>{t('计数不含标签代码和动态变量；ICU 与变量的最终显示长度、游戏内排版需另行核实。')}</small></details>
    <RelatedSegments projectId={projectId} segmentId={segment.id} mutation={mutation} onNavigate={onNavigate} />
    <div className={styles.tools}><Button variant="ghost" size="sm" onClick={() => setConcordanceOpen(value => !value)}>{t('选词查用例')}</Button>{options.spelling && <Button variant="ghost" size="sm" onClick={() => setDictionaryOpen(value => !value)}>{t('项目词典')}</Button>}</div>
    {concordanceOpen && <Concordance projectId={projectId} assetId={segment.assetId} selectedText={selectedText} onSelectedText={onSelectedText} onNavigate={onNavigate} showInvisibles={options.invisibles} tagProfile={tagProfile} targetLocale={segment.targetLocale} />}
    {options.spelling && spellingError && <p role="alert">{spellingError}<Button variant="ghost" size="sm" onClick={onDictionaryChanged}>{t('重试')}</Button></p>}
    {options.spelling && spelling && !spelling.supported && <small>{t('该语言使用浏览器拼写能力；项目离线词典检查目前支持 en-US。')}</small>}
    {options.spelling && spelling?.issues.length ? <details><summary>{t('拼写候选')} · {spelling.issues.length}{spelling.issues.length === 100 ? ` · ${t('已到 100 处显示上限')}` : ''}</summary>{spelling.issues.map((item, index) => <div key={`${item.start}:${item.word}`} className={styles.spelling}><Button variant="ghost" size="sm" onClick={() => onLocate('target', item.start, item.end)}>{item.word}</Button><span>{item.suggestions.length ? item.suggestions.map(suggestion => <Button key={suggestion} variant="ghost" size="sm" disabled={!handle || archived || segment.locked} title={t('仅替换当前草稿中的这个词，不自动保存')} onClick={() => { if (!handle) return; handle.select(item.start, item.end); if (!handle.insert(suggestion)) setActionError(t('拼写候选未写入，请检查标签、锁和输入法状态。')) }}>{suggestion}</Button>) : t('没有建议')}</span><Button variant="outline" size="sm" disabled={archived} onClick={() => void changeDictionary(item.word, true)}>{t('加入项目词典')}</Button></div>)}</details> : null}
    {dictionaryOpen && <div className={styles.dictionary}><strong>{t('项目词典')} · {segment.targetLocale}</strong><small>{t('词典按项目和语言保存，仅影响拼写提示，不替代术语规则。')}</small><form onSubmit={event => { event.preventDefault(); const word = dictionaryWord.trim(); if (word) void changeDictionary(word, true).then(saved => { if (saved) setDictionaryWord(current => current.trim() === word ? '' : current) }) }}><Input aria-label={t('项目词典新词')} value={dictionaryWord} maxLength={100} onChange={event => setDictionaryWord(event.target.value)} /><Button type="submit" variant="outline" size="sm" disabled={archived || !spelling?.supported || !dictionaryWord.trim()}>{t('加入')}</Button></form>{spelling?.dictionary.map(word => <span key={word}>{word}<Button variant="ghost" size="sm" disabled={archived} aria-label={t('从项目词典移除 {word}', { word })} onClick={() => void changeDictionary(word, false)}>×</Button></span>)}{!spelling?.dictionary.length && <p>{t('尚无自定义词。可从拼写候选中加入专名。')}</p>}</div>}
    {options.differences && <div className={styles.diff}><label>{t('比较基准')} <select value={baseline} onChange={event => setBaseline(event.target.value)}><option value="saved">{t('本次草稿基准')} · r{segment.revision}</option>{data?.details.revisions.filter(item => item.revision !== segment.revision).map(item => <option key={item.revision} value={item.revision}>r{item.revision} · {item.createdAt} · {item.source}</option>)}{proposal && <option value="proposal">{t('待审建议')} · r{proposal.baseRevision}</option>}</select></label><small>{t('删除来自基准，新增来自当前草稿；仅比较，不写入。')}</small>{base === undefined ? <p>{t('所选比较基准暂不可用。')}</p> : <p>{diff.map((part, index) => { const text = <InlineTaggedText text={part.text} sourceText={segment.source} tagProfile={tagProfile} targetLocale={segment.targetLocale} showInvisibles={options.invisibles} />; return part.kind === 'remove' ? <del key={index}>{text}</del> : part.kind === 'insert' ? <ins key={index}>{text}</ins> : <React.Fragment key={index}>{text}</React.Fragment> })}</p>}{data && data.details.totalRevisions > data.details.revisions.length && <small>{t('仅列出最近 100 个修订；更早历史未加载。')}</small>}</div>}
    {options.context && data && <div className={styles.context}><strong>{t('上下文')}</strong>{segment.key && <p>Key: {segment.key}</p>}{segment.context?.origin && <p>{segment.context.origin}</p>}{segment.context?.note && <p>{segment.context.note}</p>}{Object.entries(segment.context?.meta ?? {}).map(([key, value]) => <p key={key}>{key}: {value}</p>)}{data.details.previous.map(item => <p key={item.id}><Button variant="ghost" size="sm" onClick={() => onNavigate(item.id)}>{t('前一句')} #{item.ordinal + 1}</Button><InlineTaggedText text={item.source} tagProfile={tagProfile} targetLocale={item.targetLocale} showInvisibles={options.invisibles} /> → <InlineTaggedText text={item.target} sourceText={item.source} tagProfile={tagProfile} targetLocale={item.targetLocale} showInvisibles={options.invisibles} /></p>)}{data.details.next.map(item => <p key={item.id}><Button variant="ghost" size="sm" onClick={() => onNavigate(item.id)}>{t('后一句')} #{item.ordinal + 1}</Button><InlineTaggedText text={item.source} tagProfile={tagProfile} targetLocale={item.targetLocale} showInvisibles={options.invisibles} /> → <InlineTaggedText text={item.target} sourceText={item.source} tagProfile={tagProfile} targetLocale={item.targetLocale} showInvisibles={options.invisibles} /></p>)}{data.docs.map(doc => <div key={doc.id}><Button variant="ghost" size="sm" onClick={() => setPreview({ operation: 'linguistAssetsPreviewContextDoc', input: { projectId, docId: doc.id } })}>{doc.originalFilename}</Button>{doc.kind === 'image' && /^\/la\/v1\/files\/[A-Za-z0-9_-]{32}$/.test(doc.previewUrl ?? '') && <img src={doc.previewUrl} alt={doc.originalFilename} />}</div>)}{preview && <PreviewView request={preview} onClose={() => setPreview(undefined)} />}</div>}
    {error && <p role="alert">{error} <Button variant="ghost" size="sm" onClick={() => setRetry(value => value + 1)}>{t('重试')}</Button></p>}
    {actionError && <p role="alert">{actionError}</p>}
  </section>
}

function Concordance({ projectId, assetId, selectedText, onSelectedText, onNavigate, showInvisibles, tagProfile, targetLocale }: { projectId: string; assetId: string; selectedText: string; onSelectedText: (text: string) => void; onNavigate: (id: string) => void; showInvisibles: boolean; tagProfile?: LinguistTagProfileInfo; targetLocale?: string }) {
  const t = useT()
  const [query, setQuery] = React.useState(selectedText)
  const [batchOnly, setBatchOnly] = React.useState(false)
  const scope = `${projectId}\0${assetId}`
  const [request, setRequest] = React.useState<{ scope: string; query: string; batchOnly: boolean; offset: number }>()
  const [result, setResult] = React.useState<{ request: typeof request; value: LinguistConcordanceResult }>()
  const [error, setError] = React.useState('')
  React.useEffect(() => { if (selectedText) setQuery(selectedText) }, [selectedText])
  React.useEffect(() => {
    if (!request || request.scope !== scope) return
    let live = true
    setError('')
    required<LinguistConcordanceResult>('linguistCatConcordance', { projectId, sourceAssetId: assetId, query: request.query, ...(request.batchOnly ? { assetId } : {}), offset: request.offset, limit: 10 }).then(value => { if (live) setResult({ request, value }) }).catch(cause => { if (live) setError(String(cause)) })
    return () => { live = false }
  }, [request, projectId, assetId])
  const data = request?.scope === scope && result && result.request === request ? result.value : undefined
  return <section className={styles.concordance} aria-label={t('选词用例检索')}><form onSubmit={event => { event.preventDefault(); const value = query.trim(); if (value) { onSelectedText(value); setRequest({ scope, query: value, batchOnly, offset: 0 }) } }}><Input aria-label={t('用例检索词')} placeholder={t('选中文字或输入短语')} value={query} maxLength={500} onChange={event => setQuery(event.target.value)} /><Checkbox label={t('仅当前批次')} title={t('勾选后只看当前批次句段；TM 使用本组及共用资料')} checked={batchOnly} onChange={value => { setBatchOnly(value); setRequest(undefined) }} /><Button type="submit" variant="outline" size="sm" disabled={!query.trim()}>{t('查用例')}</Button></form>{request?.scope === scope && !data && !error && <p role="status">{t('正在检索…')}</p>}{request?.scope === scope && error && <p role="alert">{error}</p>}{data && <><p>{t('检索结果')}：{request?.query} · {t(request?.batchOnly ? '当前批次' : '项目')}</p><strong>{t('项目用例')} · {data.segmentTotal}</strong>{data.segments.map(({ segment, assetLabel }) => <article key={segment.id}><small>{assetLabel} · #{segment.ordinal + 1} · {t(segment.currentStageState === 'confirmed' ? '当前阶段已确认' : '当前阶段未确认')} · {segment.status} · r{segment.revision}</small><p><InlineTaggedText text={segment.source} tagProfile={tagProfile} targetLocale={segment.targetLocale} showInvisibles={showInvisibles} /></p><p><InlineTaggedText text={segment.target} sourceText={segment.source} tagProfile={tagProfile} targetLocale={segment.targetLocale} showInvisibles={showInvisibles} /></p><Button variant="ghost" size="sm" onClick={() => onNavigate(segment.id)}>{t('定位句段')}</Button></article>)}<strong>TM · {data.tmTotal}</strong>{data.tm.map(item => <article key={item.id}><small>{item.sourceLabel} · {item.sourceKind}{!item.enabled && ` · ${t('来源已暂停')}`}{item.contextKey && ` · Key: ${item.contextKey}`}{item.originalTuid && ` · TU: ${item.originalTuid}`}</small><p><InlineTaggedText text={item.source} tagProfile={tagProfile} targetLocale={targetLocale} showInvisibles={showInvisibles} /></p><p><InlineTaggedText text={item.target} sourceText={item.source} tagProfile={tagProfile} targetLocale={targetLocale} showInvisibles={showInvisibles} /></p><small>{t('TM 用例不代表当前句段已确认。')}</small></article>)}{data.segmentTotal + data.tmTotal === 0 && <p>{t('没有匹配用例')}</p>}<div className={styles.tools}><Button variant="ghost" size="sm" disabled={!request || request.offset === 0} onClick={() => setRequest(current => current && { ...current, offset: Math.max(0, current.offset - 10) })}>{t('上一页')}</Button><small>{t('第 {page} 页', { page: Math.floor(data.offset / data.limit) + 1 })}</small><Button variant="ghost" size="sm" disabled={data.offset + data.limit >= Math.max(data.segmentTotal, data.tmTotal)} onClick={() => setRequest(current => current && { ...current, offset: current.offset + 10 })}>{t('下一页')}</Button></div></>}</section>
}
