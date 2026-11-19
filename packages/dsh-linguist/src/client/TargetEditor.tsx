import * as React from 'react'
import { Button } from '@deepseek-ai/dsh-client-ui-primitives'
import { useAtom, type WritableAtom } from 'jotai'
import type { LinguistSegmentInfo, LinguistTagProfileInfo } from '@linguist/domain-service/contracts'
import { compileTagFamilyRegex, scanTags } from '@linguist/cat-core'
import { useT } from './ui-locale'
import styles from './TargetEditor.module.css'
import {
  canCommitTarget,
  canConfirmTarget,
  editKeyAction,
  targetSaveCompletion,
  type TargetSaveResult,
} from './cat-edit-utils'
import { TokenEditor, type TokenEditorHandle } from './TokenEditor'
import { isProtectedCatDraft } from './cat-editor-state'
import { phraseFormatting, phraseFormatSelection, formattingTextOffset, tokenizeInlineText, type InlineAnnotation, type InlineSelection } from './inline-tokens'

export interface ProtectedTextPart {
  kind: 'text' | 'token' | 'suspected'
  value: string
}

export interface TargetDraftSnapshot {
  value: string
  selection?: InlineSelection
}
export interface TargetDraftState extends TargetDraftSnapshot {
  past: readonly TargetDraftSnapshot[]
  future: readonly TargetDraftSnapshot[]
  composing: boolean
  compositionBase?: TargetDraftSnapshot
}

export interface TargetEditorDraft {
  state: TargetDraftState
  baseTarget: string
  baseRevision: number
  saving: boolean
  conflict: boolean
  resolvingConflict: boolean
  tmReference?: { unitId: string; target: string }
}

export type TargetDraftAction =
  | { type: 'reset'; value: string }
  | { type: 'commit'; value: string; selection?: InlineSelection; previousSelection?: InlineSelection }
  | { type: 'composition-start' }
  | { type: 'composition-update'; value: string }
  | { type: 'composition-end'; value: string; selection?: InlineSelection }
  | { type: 'undo' }
  | { type: 'redo' }

export const TARGET_UNDO_MAX_OPERATIONS = 200
export const TARGET_UNDO_MAX_CHARACTERS = 200_000

export interface TargetEditorHandle {
  replace: (value: string) => boolean
  insert: (value: string) => boolean
  undo: () => boolean
  redo: () => boolean
  focus: () => void
  select: (start: number, end: number) => void
}

export interface TargetEditorProps {
  draftAtom: WritableAtom<TargetEditorDraft | undefined, [React.SetStateAction<TargetEditorDraft | undefined>], void>
  index: number
  segment: LinguistSegmentInfo
  archived: boolean
  confirmLabel: string
  onCancel: () => void
  onSave: (target: string) => Promise<TargetSaveResult>
  onReload: () => Promise<LinguistSegmentInfo | undefined>
  onSaved?: (advance: boolean) => void
  onHandleChange?: (handle: TargetEditorHandle | undefined) => void
  tagProfile?: LinguistTagProfileInfo
  formatId?: string
  showInvisibles?: boolean
  showFormatCodes?: boolean
  onFormatCodesChange?: (show: boolean) => void
  onInvisiblesChange?: (show: boolean) => void
  activeTag?: string
  onTagFocus?: (key: string | undefined) => void
  onSelectedText?: (text: string) => void
  annotations?: readonly InlineAnnotation[]
  spellCheck?: boolean
}

export function splitProtectedText(text: string, tagProfile?: LinguistTagProfileInfo, targetLocale?: string): ProtectedTextPart[] {
  const spans: Array<{ start: number; end: number; kind: 'token' | 'suspected' }> = scanTags(text, { profile: tagProfile, targetLocale })
    .map((tag) => ({ start: tag.start, end: tag.end, kind: 'token' }))
  for (const candidate of tagProfile?.candidates ?? []) {
    if (candidate.status !== 'candidate') continue
    const regex = compileTagFamilyRegex(candidate.pattern)
    if (regex === null) continue
    regex.lastIndex = 0
    for (const match of text.matchAll(regex)) {
      const start = match.index ?? 0
      const end = start + match[0].length
      if (match[0] && !spans.some((span) => !(end <= span.start || start >= span.end))) {
        spans.push({ start, end, kind: 'suspected' })
      }
    }
  }
  spans.sort((left, right) => left.start - right.start)
  const parts: ProtectedTextPart[] = []
  let cursor = 0
  for (const span of spans) {
    if (span.start > cursor) parts.push({ kind: 'text', value: text.slice(cursor, span.start) })
    parts.push({ kind: span.kind, value: text.slice(span.start, span.end) })
    cursor = span.end
  }
  if (cursor < text.length) parts.push({ kind: 'text', value: text.slice(cursor) })
  return parts
}

export function createTargetDraftState(value: string): TargetDraftState {
  return {
    value,
    past: [],
    future: [],
    composing: false,
  }
}

function boundDraftHistory(
  past: readonly TargetDraftSnapshot[],
  future: readonly TargetDraftSnapshot[],
  futureFirst = false,
): Pick<TargetDraftState, 'past' | 'future'> {
  let operations = TARGET_UNDO_MAX_OPERATIONS
  let characters = TARGET_UNDO_MAX_CHARACTERS
  const take = (values: readonly TargetDraftSnapshot[], nearestAtStart: boolean): TargetDraftSnapshot[] => {
    const kept: TargetDraftSnapshot[] = []
    if (nearestAtStart) {
      for (const value of values) {
        if (operations === 0 || value.value.length > characters) break
        kept.push(value)
        operations -= 1
        characters -= value.value.length
      }
      return kept
    }
    for (let index = values.length - 1; index >= 0; index -= 1) {
      const value = values[index]!
      if (operations === 0 || value.value.length > characters) break
      kept.unshift(value)
      operations -= 1
      characters -= value.value.length
    }
    return kept
  }
  if (futureFirst) {
    const boundedFuture = take(future, true)
    return { past: take(past, false), future: boundedFuture }
  }
  const boundedPast = take(past, false)
  return { past: boundedPast, future: take(future, true) }
}

function commitDraft(state: TargetDraftState, action: Extract<TargetDraftAction, { type: 'commit' }>): TargetDraftState {
  if (action.value === state.value) return state
  return {
    value: action.value,
    selection: action.selection ?? { start: action.value.length, end: action.value.length },
    ...boundDraftHistory([...state.past, { value: state.value, selection: action.previousSelection ?? state.selection }], []),
    composing: false,
  }
}

export function targetDraftReducer(
  state: TargetDraftState,
  action: TargetDraftAction,
): TargetDraftState {
  switch (action.type) {
    case 'reset':
      return createTargetDraftState(action.value)
    case 'commit':
      return state.composing ? state : commitDraft(state, action)
    case 'composition-start':
      return state.composing
        ? state
        : { ...state, composing: true, compositionBase: { value: state.value, selection: state.selection } }
    case 'composition-update':
      return state.composing ? { ...state, value: action.value } : state
    case 'composition-end': {
      const compositionBase = state.compositionBase ?? { value: state.value, selection: state.selection }
      if (compositionBase.value === action.value) {
        return { ...state, value: action.value, selection: action.selection ?? state.selection, composing: false, compositionBase: undefined }
      }
      return {
        value: action.value,
        selection: action.selection ?? state.selection,
        ...boundDraftHistory([...state.past, compositionBase], []),
        composing: false,
      }
    }
    case 'undo': {
      if (state.composing || state.past.length === 0) return state
      const previous = state.past.at(-1)!
      return {
        ...previous,
        ...boundDraftHistory(
          state.past.slice(0, -1),
          [{ value: state.value, selection: state.selection }, ...state.future],
          true,
        ),
        composing: false,
      }
    }
    case 'redo': {
      if (state.composing || state.future.length === 0) return state
      const [next, ...future] = state.future
      return {
        ...next!,
        ...boundDraftHistory([...state.past, { value: state.value, selection: state.selection }], future),
        composing: false,
      }
    }
  }
}

export function targetProtectionViolations(
  segment: Pick<LinguistSegmentInfo, 'source'> & Partial<Pick<LinguistSegmentInfo, 'targetLocale'>>,
  target: string,
  tagProfile?: LinguistTagProfileInfo,
): string[] {
  const sourceTokens = splitProtectedText(segment.source, tagProfile, segment.targetLocale)
    .filter((part) => part.kind === 'token')
    .map((part) => part.value)
  const targetTokens = splitProtectedText(target, tagProfile, segment.targetLocale)
    .filter((part) => part.kind === 'token')
    .map((part) => part.value)
  const remainingTarget = [...targetTokens]
  const violations: string[] = []
  for (const token of sourceTokens) {
    const index = remainingTarget.indexOf(token)
    if (index < 0) violations.push(`missing:${token}`)
    else remainingTarget.splice(index, 1)
  }
  return [
    ...violations,
    ...remainingTarget.map((token) => `extra:${token}`),
  ]
}

export function targetSuspectedTagWarnings(
  segment: Pick<LinguistSegmentInfo, 'source'> & Partial<Pick<LinguistSegmentInfo, 'targetLocale'>>,
  target: string,
  tagProfile?: LinguistTagProfileInfo,
): string[] {
  const values = (text: string) => splitProtectedText(text, tagProfile, segment.targetLocale)
    .filter((part) => part.kind === 'suspected')
    .map((part) => part.value)
  const remaining = values(target)
  return values(segment.source).flatMap((value) => {
    const index = remaining.indexOf(value)
    if (index < 0) return [`missing-suspected:${value}`]
    remaining.splice(index, 1)
    return []
  })
}

export const TargetEditor = React.forwardRef<TargetEditorHandle, TargetEditorProps>(
  function TargetEditor({
    draftAtom,
    index,
    segment,
    archived,
    confirmLabel,
    onCancel,
    onSave,
    onReload,
    onSaved,
    onHandleChange,
    tagProfile,
    formatId,
    showInvisibles,
    showFormatCodes,
    onFormatCodesChange,
    onInvisiblesChange,
    activeTag,
    onTagFocus,
    onSelectedText,
    annotations,
    spellCheck,
  }, ref): React.ReactElement {
    const t = useT()
    const [draft, setDraft] = useAtom(draftAtom)
    // TargetCell 只在有草稿时挂载编辑器；保存完成/取消后由同一 atom 卸载。
    const { state, baseTarget, baseRevision, saving, conflict, resolvingConflict } = draft!
    const updateDraft = React.useCallback((patch: Partial<TargetEditorDraft>): void => {
      setDraft((current) => current === undefined ? current : { ...current, ...patch })
    }, [setDraft])
    const dispatch = React.useCallback((action: TargetDraftAction): void => {
      setDraft((current) => current === undefined ? current : {
        ...current,
        state: targetDraftReducer(current.state, action),
      })
    }, [setDraft])
    const [blocked, setBlocked] = React.useState(false)
    const [tagHint, setTagHint] = React.useState<string>()
    const tokenEditorRef = React.useRef<TokenEditorHandle>(null)
    const composingRef = React.useRef(false)
    const readOnly = archived || segment.locked || saving || resolvingConflict
    const dirty = state.value !== segment.target
    const formatting = React.useMemo(() => phraseFormatting(state.value, formatId, tokenizeInlineText(state.value, { sourceText: segment.source, tagProfile, targetLocale: segment.targetLocale })), [state.value, formatId, segment.source, segment.targetLocale, tagProfile])
    const formatSelection = state.selection ?? { start: 0, end: 0 }
    const formatHasText = formattingTextOffset(formatting, formatSelection.start) !== formattingTextOffset(formatting, formatSelection.end)
    const canFormat = !readOnly && !state.composing && formatting.supported && formatting.valid && formatHasText
    const violations = React.useMemo(
      () => targetProtectionViolations(segment, state.value, tagProfile),
      [segment, state.value, tagProfile],
    )
    const suspectedWarnings = React.useMemo(
      () => targetSuspectedTagWarnings(segment, state.value, tagProfile),
      [segment, state.value, tagProfile],
    )
    const commitAvailability = {
      archived,
      locked: segment.locked,
      dirty,
      saving,
      resolvingConflict,
      composing: state.composing,
      hasViolations: violations.length > 0,
      conflict,
    }
    const canCommit = canCommitTarget(commitAvailability)
    const canConfirm = onSaved !== undefined && canConfirmTarget(commitAvailability)

    React.useEffect(() => () => {
      // IME 组合属于当前 DOM；卸载后保留文字并结束组合，重新打开即可继续编辑。
      setDraft((current) => current?.state.composing ? {
        ...current,
        state: targetDraftReducer(current.state, {
          type: 'composition-end', value: current.state.value,
        }),
      } : current)
    }, [setDraft])

    React.useEffect(() => {
      if (baseRevision === segment.revision && baseTarget === segment.target) return
      setDraft((current) => {
        if (current === undefined) return current
        const pristine = !isProtectedCatDraft(current)
        return {
          ...current,
          baseRevision: segment.revision,
          baseTarget: segment.target,
          state: pristine ? createTargetDraftState(segment.target) : current.state,
          conflict: !pristine,
        }
      })
      setBlocked(false)
    }, [baseRevision, baseTarget, segment.revision, segment.target, setDraft])

    const acceptCandidate = React.useCallback((
      value: string,
      operation: 'manual' | 'protected',
      action: TargetDraftAction = { type: 'commit', value },
    ): boolean => {
      if (readOnly) return false
      const nextViolations = targetProtectionViolations(segment, value, tagProfile)
      const previousValue = state.compositionBase?.value ?? state.value
      const currentIsValid = targetProtectionViolations(segment, previousValue, tagProfile).length === 0
      const nextFormat = phraseFormatting(value, formatId, tokenizeInlineText(value, { sourceText: segment.source, tagProfile, targetLocale: segment.targetLocale }))
      const previousFormat = phraseFormatting(previousValue, formatId, tokenizeInlineText(previousValue, { sourceText: segment.source, tagProfile, targetLocale: segment.targetLocale }))
      if (previousFormat.valid && !nextFormat.valid) { setBlocked(false); setTagHint(t('格式标记必须完整配对；可切换格式码视图检查。')); return false }
      if (action.type === 'composition-end' && !showFormatCodes && previousFormat.valid
        && previousFormat.codes.map(code => previousValue.slice(code.start, code.end)).join('|') !== nextFormat.codes.map(code => value.slice(code.start, code.end)).join('|')) {
        setTagHint(t('输入法编辑不能改动原生格式码；请使用格式工具。'))
        return false
      }
      if (
        nextViolations.length > 0
        && (operation === 'protected' || currentIsValid)
      ) {
        setBlocked(true)
        return false
      }
      setBlocked(false)
      setTagHint(undefined)
      dispatch(action)
      return true
    }, [dispatch, readOnly, segment, state.value, state.compositionBase, tagProfile, formatId, showFormatCodes, t])

    const undo = React.useCallback((): boolean => {
      if (readOnly || state.composing || state.past.length === 0) return false
      setBlocked(false)
      dispatch({ type: 'undo' })
      return true
    }, [dispatch, readOnly, state.composing, state.past.length])

    const redo = React.useCallback((): boolean => {
      if (readOnly || state.composing || state.future.length === 0) return false
      setBlocked(false)
      dispatch({ type: 'redo' })
      return true
    }, [dispatch, readOnly, state.composing, state.future.length])

    const replace = React.useCallback((value: string): boolean => {
      if (composingRef.current) return false
      return acceptCandidate(value, 'protected')
    }, [acceptCandidate])

    const insert = React.useCallback((value: string): boolean => {
      if (composingRef.current) return false
      // The owned editor retains its raw selection when a helper button takes focus.
      return tokenEditorRef.current?.insert(value) ?? false
    }, [])

    const operationsRef = React.useRef({ replace, insert, undo, redo })
    operationsRef.current = { replace, insert, undo, redo }
    const handle = React.useMemo<TargetEditorHandle>(() => ({
      replace: (value) => operationsRef.current.replace(value),
      insert: (value) => operationsRef.current.insert(value),
      undo: () => operationsRef.current.undo(),
      redo: () => operationsRef.current.redo(),
      focus: () => tokenEditorRef.current?.focus(),
      select: (start, end) => tokenEditorRef.current?.select(start, end),
    }), [])

    React.useImperativeHandle(ref, () => handle, [handle])

    React.useEffect(() => {
      onHandleChange?.(handle)
      return () => onHandleChange?.(undefined)
    }, [handle, onHandleChange])

    const save = async (advance: boolean): Promise<void> => {
      if ((advance ? !canConfirm : !canCommit) || composingRef.current) return
      if (advance && !dirty) {
        onSaved?.(true)
        return
      }
      updateDraft({ saving: true })
      try {
        const completion = targetSaveCompletion(await onSave(state.value), advance)
        if (completion === 'conflict') {
          updateDraft({ conflict: true })
        } else if (completion === 'close' || completion === 'advance') {
          onSaved?.(completion === 'advance')
        }
      } finally {
        updateDraft({ saving: false })
      }
    }

    const resolveConflict = async (preserveDraft: boolean): Promise<void> => {
      if (resolvingConflict || saving) return
      updateDraft({ resolvingConflict: true })
      try {
        const latest = await onReload()
        if (latest === undefined) return
        const latestState = createTargetDraftState(latest.target)
        updateDraft({
          state: preserveDraft
            ? targetDraftReducer(latestState, { type: 'commit', value: state.value })
            : latestState,
          baseTarget: latest.target,
          baseRevision: latest.revision,
          conflict: false,
        })
        setBlocked(false)
      } finally {
        updateDraft({ resolvingConflict: false })
      }
    }

    const cancel = (): void => {
      if (saving || resolvingConflict) return
      if (conflict) void onReload()
      onCancel()
    }

    return (
      <span
        role="group"
        aria-label={t('正在编辑原始行 {number} 译文', { number: index + 1 })}
        aria-busy={saving || resolvingConflict}
        data-target-editor
        className={styles.editor}
      >
        <span role="toolbar" aria-label={t('文本格式与视图')} className={styles.formatToolbar} onMouseDown={event => event.preventDefault()}>
          {(['b', 'i', 'u'] as const).map(flag => <Button key={flag} type="button" variant="ghost" size="sm"
            aria-label={t(({ b: '加粗', i: '斜体', u: '下划线' })[flag])} aria-keyshortcuts={`Meta+${flag.toUpperCase()} Control+${flag.toUpperCase()}`}
            aria-pressed={phraseFormatSelection(formatting, formatSelection, flag)} disabled={!canFormat}
            title={t(!formatting.supported ? '当前文件格式不支持此样式' : !formatting.valid ? '先检查未识别或未配对的格式码' : !formatHasText ? '请先选中译文中的文字' : ({ b: '加粗', i: '斜体', u: '下划线' })[flag])}
            onClick={() => tokenEditorRef.current?.toggleFormat(flag)}>{flag === 'b' ? <b>B</b> : flag === 'i' ? <i>I</i> : <u>U</u>}</Button>)}
          <Button type="button" variant="ghost" size="sm" disabled aria-label={t('下标')} title={t('当前文件尚未验证此样式')}>x₂</Button>
          <Button type="button" variant="ghost" size="sm" disabled aria-label={t('上标')} title={t('当前文件尚未验证此样式')}>x²</Button>
          <span className={styles.formatDivider} aria-hidden="true" />
          <Button type="button" variant="ghost" size="sm" aria-label={t('撤销译文编辑')} title={t('撤销')} onClick={undo} disabled={readOnly || state.composing || state.past.length === 0}>↶</Button>
          <Button type="button" variant="ghost" size="sm" aria-label={t('重做译文编辑')} title={t('重做')} onClick={redo} disabled={readOnly || state.composing || state.future.length === 0}>↷</Button>
          <span className={styles.formatDivider} aria-hidden="true" />
          <Button type="button" variant="ghost" size="sm" aria-pressed={Boolean(showFormatCodes)} disabled={state.composing || !onFormatCodesChange} title={t('显示原生格式码；不改变文本')} onClick={() => onFormatCodesChange?.(!showFormatCodes)}>{t('格式码')}</Button>
          <Button type="button" variant="ghost" size="sm" aria-pressed={Boolean(showInvisibles)} disabled={state.composing || !onInvisiblesChange} title={t('显示空格、换行、Tab 与特殊不可见字符；不改变文本')} onClick={() => onInvisiblesChange?.(!showInvisibles)}>¶</Button>
        </span>
        <TokenEditor
          ref={tokenEditorRef}
          value={state.value}
          sourceText={segment.source}
          tagProfile={tagProfile}
          formatId={formatId}
          readOnly={readOnly}
          autoFocus={!readOnly}
          lang={segment.targetLocale}
          spellCheck={spellCheck}
          showInvisibles={showInvisibles}
          showFormatCodes={showFormatCodes}
          activeTag={activeTag}
          annotations={annotations}
          onTagFocus={onTagFocus}
          onSelectedText={onSelectedText}
          initialSelection={state.selection}
          onSelectionChange={(selection) => setDraft((current) => {
            if (current === undefined || (current.state.selection?.start === selection.start && current.state.selection.end === selection.end && current.state.selection.backward === selection.backward)) return current
            return { ...current, state: { ...current.state, selection } }
          })}
          label={t('编辑原始行 {number} 译文', { number: index + 1 })}
          invalid={violations.length > 0}
          describedBy={`target-editor-help-${segment.id}`}
          onEdit={(value, operation, previousSelection, selection) => acceptCandidate(value, operation, { type: 'commit', value, previousSelection, selection })}
          onCompositionStart={() => {
            composingRef.current = true
            dispatch({ type: 'composition-start' })
          }}
          onCompositionUpdate={(value) => dispatch({ type: 'composition-update', value })}
          onCompositionEnd={(value, selection) => {
            composingRef.current = false
            if (acceptCandidate(value, 'manual', { type: 'composition-end', value, selection })) return value
            const previous = state.compositionBase?.value ?? state.value
            dispatch({ type: 'composition-end', value: previous, selection: state.compositionBase?.selection })
            return previous
          }}
          onUndo={undo}
          onRedo={redo}
          onProtectedSelection={() => setTagHint(t("已选中整个标签；再次按下删除键尝试移除。源文必需的标签无法删除。"))}
          onKeyDown={(event) => {
            const action = editKeyAction({
              key: event.key,
              metaKey: event.metaKey,
              ctrlKey: event.ctrlKey,
              shiftKey: event.shiftKey,
              isComposing: composingRef.current || event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229,
            })
            if (action === null) return
            event.preventDefault()
            if (action === 'cancel') cancel()
            else if (action === 'save') void save(false)
            else if (action === 'confirm-and-advance') void save(true)
            else if (action === 'undo') undo()
            else redo()
          }}
        />
        <span className={styles.meta}>
          {dirty && (
            <span className={styles.draftStatus}>{t("未保存")}</span>
          )}
        </span>
        {conflict && (
          <span
            role="alert"
            className={styles.warning}
          >
            <span className={styles.messageTitle}>{t("译文已有更新，草稿尚未覆盖最新内容。")}</span>
            <span className={styles.actions}>
              <Button
                type="button"
                disabled={resolvingConflict}
                onClick={() => void resolveConflict(false)}
                variant="outline" size="sm"
              >
                {t("重新加载最新译文")}
              </Button>
              <Button
                type="button"
                disabled={resolvingConflict}
                onClick={() => void resolveConflict(true)}
                variant="outline" size="sm"
              >
                {t("保留我的草稿")}
              </Button>
            </span>
          </span>
        )}
        {suspectedWarnings.length > 0 && violations.length === 0 && (
          <span className={styles.caution}>
            {t("译文未保留")} {suspectedWarnings.length} {t("个疑似 Tag；它们尚未启用硬保护，请确认是否可翻译。")}
          </span>
        )}
        {!formatting.valid && <span className={styles.caution}>{t('存在未识别或未配对的格式码；已保留原文显示。')}</span>}
        {tagHint !== undefined && (
          <span role="status" className={styles.hint}>
            {tagHint}
          </span>
        )}
        <span className={styles.toolbar}>
          <span
            id={`target-editor-help-${segment.id}`}
            className={blocked || violations.length > 0 || conflict ? styles.errorHelp : styles.help}
          >
            {blocked || violations.length > 0
              ? t("必须保留源文中的标签和占位符")
              : conflict
                ? t("请先处理 Revision Conflict")
                : t('⌘/Ctrl+S 保存 · ⌘/Ctrl+↵ {confirmLabel}并前进 · Esc 取消', { confirmLabel })}
          </span>
          <span className={styles.actions}>
            <Button
              type="button"
              aria-label={t("取消编辑")}
              aria-keyshortcuts="Escape"
              onClick={cancel}
              disabled={saving || resolvingConflict}
              variant="outline" size="sm"
            >
              {t("取消")}
            </Button>
            <Button
              type="button"
              aria-label={t("保存译文")}
              aria-keyshortcuts="Meta+S Control+S"
              onClick={() => void save(false)}
              disabled={!canCommit}
              variant="outline" size="sm"
            >
              {t("保存")}
            </Button>
            <Button
              type="button"
              aria-label={t('{confirmLabel}并前进', { confirmLabel })}
              aria-keyshortcuts="Meta+Enter Control+Enter"
              onClick={() => void save(true)}
              disabled={!canConfirm}
              variant="primary" size="sm"
            >
              {t('{confirmLabel}并前进', { confirmLabel })}
            </Button>
          </span>
        </span>
        <span role="status" aria-live="polite" className={styles.srOnly}>
          {saving
            ? t("正在保存译文")
            : resolvingConflict
              ? t("正在重新加载最新译文")
              : conflict
                ? t("译文存在 Revision Conflict")
                : blocked || violations.length > 0
                  ? t("译文未保留全部标签或占位符")
                  : dirty
                    ? t("译文有未保存更改")
                    : t("译文已保存")}
        </span>
      </span>
    )
  },
)
