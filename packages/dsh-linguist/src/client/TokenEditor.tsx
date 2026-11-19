import * as React from 'react'
import type { LinguistTagProfileInfo } from '@linguist/domain-service/contracts'
import {
  annotatedTextRuns, copyInlineSelection, inlineDomPointToOffset, inlineDomSelection, inlineOffsetToDomPoint,
  formattingRawOffset, formattingTextOffset, phraseFormatting, replacePhraseFormattedText, togglePhraseFormat,
  readInlineDomText, inlineSelectionText, snapInlineSelection, tokenizeInlineText, unicodeCharacters,
  type InlineAnnotation, type InlineSelection, type PhraseFormatFlag,
} from './inline-tokens'
import inlineStyles from './InlineTaggedText.module.css'
import styles from './TokenEditor.module.css'

export interface TokenEditorHandle {
  focus(): void
  select(start: number, end: number): void
  selection(): InlineSelection
  insert(text: string): boolean
  toggleFormat(flag: PhraseFormatFlag): boolean
}
export interface TokenEditorProps {
  value: string
  sourceText: string
  tagProfile?: LinguistTagProfileInfo
  formatId?: string
  readOnly: boolean
  autoFocus?: boolean
  lang?: string
  spellCheck?: boolean
  showInvisibles?: boolean
  showFormatCodes?: boolean
  activeTag?: string
  annotations?: readonly InlineAnnotation[]
  initialSelection?: InlineSelection
  onSelectionChange?: (selection: InlineSelection) => void
  onSelectedText?: (text: string) => void
  onTagFocus?: (key: string | undefined) => void
  onEdit: (value: string, operation: 'manual' | 'protected', before?: InlineSelection, after?: InlineSelection) => boolean
  onCompositionStart: () => void
  onCompositionUpdate: (value: string) => void
  /** Returns the accepted final value (or the pre-composition value on a rejected edit). */
  onCompositionEnd: (value: string, selection?: InlineSelection) => string
  onUndo: () => boolean
  onRedo: () => boolean
  onProtectedSelection?: () => void
  onKeyDown?: React.KeyboardEventHandler<HTMLDivElement>
  label: string
  describedBy?: string
  invalid?: boolean
}

/** Build only owned elements/text nodes. No user text is ever parsed as HTML. */
export function renderTokenEditorDom(root: HTMLElement, value: string, options: Pick<TokenEditorProps, 'sourceText' | 'tagProfile' | 'formatId' | 'lang' | 'showInvisibles' | 'showFormatCodes' | 'activeTag' | 'annotations'>): void {
  const document = root.ownerDocument
  root.dataset.inlineFormatId = options.formatId ?? ''
  root.dataset.inlineFormatView = options.showFormatCodes ? 'codes' : 'rich'
  const fragment = document.createDocumentFragment()
  const tokens = tokenizeInlineText(value, { ...options, targetLocale: options.lang })
  const formatting = phraseFormatting(value, options.formatId, tokens)
  const formatClass = (flags: readonly PhraseFormatFlag[]) => flags.map(flag => ({ b: inlineStyles.bold, i: inlineStyles.italic, u: inlineStyles.underline })[flag]).filter(Boolean).join(' ')
  const code = (raw: string): void => {
    const marker = document.createElement('span')
    marker.hidden = true
    marker.contentEditable = 'false'
    marker.dataset.inlineRaw = raw
    marker.dataset.inlineFormatCode = 'true'
    fragment.appendChild(marker)
  }
  const text = (parent: Node, raw: string): void => {
    if (!options.showInvisibles) { parent.appendChild(document.createTextNode(raw)); return }
    let ordinary = ''
    for (const character of unicodeCharacters(raw)) {
      if (!character.invisible) { ordinary += character.raw; continue }
      if (ordinary) { parent.appendChild(document.createTextNode(ordinary)); ordinary = '' }
      const span = document.createElement('span')
      span.className = inlineStyles.invisible
      span.dataset.invisibleGlyph = character.glyph
      if (character.codePoint > 0x7f && character.codePoint !== 0xa0 && character.codePoint !== 0x202f) span.dataset.zeroWidth = 'true'
      span.title = `${character.codePointLabel} ${character.name}`
      span.appendChild(document.createTextNode(character.raw))
      parent.appendChild(span)
    }
    if (ordinary) parent.appendChild(document.createTextNode(ordinary))
  }
  // Empty boundary text nodes allow caret placement on both sides of adjacent atomic chips.
  fragment.appendChild(document.createTextNode(''))
  for (const token of tokens) {
    if (!options.showFormatCodes && formatting.codes.some(item => item.start === token.start && item.end === token.end)) { code(token.raw); continue }
    if (token.kind === 'tag') {
      const chip = document.createElement('span')
      chip.contentEditable = 'false'
      const flags = formatting.ranges.find(range => range.start <= token.start && range.end >= token.end)?.flags ?? []
      chip.className = [inlineStyles.chip, formatClass(flags)].filter(Boolean).join(' ')
      if (flags.length) chip.dataset.inlineFormat = flags.join('')
      if (flags.includes('u')) chip.dataset.inlineDecoration = 'underline'
      chip.dataset.inlineRaw = token.raw
      chip.dataset.inlineTagKey = token.key
      if (options.activeTag === token.key) chip.dataset.active = 'true'
      chip.title = token.raw
      chip.setAttribute('aria-label', token.raw)
      chip.appendChild(document.createTextNode(token.raw))
      fragment.appendChild(chip)
      fragment.appendChild(document.createTextNode(''))
    } else {
      for (const run of annotatedTextRuns(token.raw, token.start, options.annotations, formatting.ranges, formatting.codes)) {
        if (!options.showFormatCodes && run.formatCode) { code(run.raw); continue }
        let parent: Node = fragment
        if (run.flags.length) {
          const span = document.createElement('span')
          span.className = formatClass(run.flags)
          span.dataset.inlineFormat = run.flags.join('')
          if (run.flags.includes('u')) span.dataset.inlineDecoration = 'underline'
          parent.appendChild(span)
          parent = span
        }
        for (const annotation of run.annotations) {
          const span = document.createElement('span')
          span.className = inlineStyles.annotation
          span.dataset.assistId = annotation.id
          span.dataset.assistKind = annotation.kind
          if (annotation.active) span.dataset.active = 'true'
          if (annotation.title !== undefined) span.title = annotation.title
          parent.appendChild(span)
          parent = span
        }
        text(parent, run.raw)
      }
    }
  }
  if (value.length === 0 || value.endsWith('\n') || value.endsWith('\r')) {
    const tail = document.createElement('br')
    tail.dataset.inlineTail = 'true'
    fragment.appendChild(tail)
  }
  root.replaceChildren(fragment)
}

function deletionRange(text: string, selection: InlineSelection, inputType: string): InlineSelection {
  if (selection.start !== selection.end) return selection
  const backward = inputType.includes('Backward')
  const at = selection.start
  let boundary = backward ? 0 : text.length
  if (inputType.includes('Word')) {
    const side = backward ? text.slice(0, at) : text.slice(at)
    const match = backward ? side.match(/(?:[\p{L}\p{N}_]+|[^\p{L}\p{N}_\s]+)\s*$/u) : side.match(/^\s*(?:[\p{L}\p{N}_]+|[^\p{L}\p{N}_\s]+)/u)
    boundary = backward ? at - (match?.[0].length ?? side.length) : at + (match?.[0].length ?? side.length)
  } else if (inputType.includes('Line')) {
    boundary = backward ? text.lastIndexOf('\n', at - 1) + 1 : text.indexOf('\n', at)
    if (boundary < 0) boundary = text.length
  } else {
    const segments = [...new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(text)]
    if (backward) boundary = segments.findLast(segment => segment.index < at)?.index ?? 0
    else { const segment = segments.find(segment => segment.index + segment.segment.length > at); boundary = segment ? segment.index + segment.segment.length : text.length }
  }
  return backward ? { start: boundary, end: at } : { start: at, end: boundary }
}

/** An uncontrolled, owned contenteditable; React never reconciles its editable children. */
export const TokenEditor = React.forwardRef<TokenEditorHandle, TokenEditorProps>(function TokenEditor(props, forwardedRef) {
  const rootRef = React.useRef<HTMLDivElement>(null)
  const config = React.useRef(props)
  config.current = props
  const rawRef = React.useRef(props.value)
  const composing = React.useRef(false)
  const compositionSelection = React.useRef<InlineSelection>()
  const lastSelection = React.useRef<InlineSelection>(props.initialSelection ?? { start: props.value.length, end: props.value.length })
  const dragging = React.useRef<InlineSelection>()
  const pendingSelection = React.useRef<InlineSelection>()
  const restoreSelectionOnFocus = React.useRef(false)

  const selection = (): InlineSelection => {
    const root = rootRef.current
    return root && root.ownerDocument.activeElement === root && !restoreSelectionOnFocus.current
      ? inlineDomSelection(root, root.ownerDocument.getSelection()) ?? lastSelection.current : lastSelection.current
  }
  const select = (range: InlineSelection, focus = true, writeNative = true): void => {
    const root = rootRef.current
    if (!root || composing.current) { pendingSelection.current = range; return }
    const normalized = snapInlineSelection(rawRef.current, range.start, range.end, tokenizeInlineText(rawRef.current, { ...config.current, targetLocale: config.current.lang }))
    lastSelection.current = { ...normalized, backward: range.backward }
    if (writeNative) restoreSelectionOnFocus.current = false
    if (focus) root.focus({ preventScroll: true })
    const native = root.ownerDocument.getSelection()
    if (native && writeNative) {
      const start = inlineOffsetToDomPoint(root, normalized.start), end = inlineOffsetToDomPoint(root, normalized.end)
      native.setBaseAndExtent(range.backward ? end.node : start.node, range.backward ? end.offset : start.offset,
        range.backward ? start.node : end.node, range.backward ? start.offset : end.offset)
    }
    config.current.onSelectionChange?.(lastSelection.current)
    if (writeNative) config.current.onSelectedText?.(rawRef.current.slice(normalized.start, normalized.end))
  }
  const render = (raw: string, range: InlineSelection, focus = false): void => {
    const root = rootRef.current
    if (!root || composing.current) return
    // Removing owned children collapses a live native Range. While a helper has
    // focus, retain raw offsets and restore the native range only on real refocus.
    if (!focus && inlineDomSelection(root, root.ownerDocument.getSelection())) restoreSelectionOnFocus.current = true
    rawRef.current = raw
    renderTokenEditorDom(root, raw, config.current)
    select(range, focus, focus)
  }
  const apply = (raw: string, range: InlineSelection, operation: 'manual' | 'protected'): boolean => {
    if (config.current.readOnly || composing.current) return false
    const accepted = config.current.onEdit(raw, operation, selection(), range)
    if (accepted) render(raw, range, true)
    else render(rawRef.current, lastSelection.current, true)
    return accepted
  }
  const insert = (text: string, range = selection(), operation: 'manual' | 'protected' = 'protected'): boolean => {
    const tokens = tokenizeInlineText(rawRef.current, { ...config.current, targetLocale: config.current.lang })
    const normalized = snapInlineSelection(rawRef.current, range.start, range.end, tokens)
    if (!config.current.showFormatCodes && config.current.formatId === 'phrase_mxliff_1_2' && phraseFormatting(rawRef.current, config.current.formatId, tokens).valid) {
      const edit = replacePhraseFormattedText(rawRef.current, normalized, text, config.current.formatId, tokens)
      return edit !== undefined && apply(edit.value, edit.selection, operation)
    }
    const next = rawRef.current.slice(0, normalized.start) + text + rawRef.current.slice(normalized.end)
    const caret = normalized.start + text.length
    return apply(next, { start: caret, end: caret }, operation)
  }
  const toggleFormat = (flag: PhraseFormatFlag): boolean => {
    const tokens = tokenizeInlineText(rawRef.current, { ...config.current, targetLocale: config.current.lang })
    const current = selection(), range = snapInlineSelection(rawRef.current, current.start, current.end, tokens)
    const edit = togglePhraseFormat(rawRef.current, { ...range, backward: current.backward }, flag, config.current.formatId, tokens)
    return edit !== undefined && apply(edit.value, edit.selection, 'protected')
  }
  const operations = React.useRef({ selection, select, insert, toggleFormat })
  operations.current = { selection, select, insert, toggleFormat }
  React.useImperativeHandle(forwardedRef, () => ({
    focus: () => rootRef.current?.focus(),
    select: (start, end) => operations.current.select({ start, end }),
    selection: () => operations.current.selection(),
    insert: text => operations.current.insert(text),
    toggleFormat: flag => operations.current.toggleFormat(flag),
  }), [])

  const annotationStructure = JSON.stringify(props.annotations?.map(({ active: _active, ...annotation }) => annotation))
  const annotationActivity = JSON.stringify(props.annotations?.filter(annotation => annotation.active).map(annotation => annotation.id))
  React.useLayoutEffect(() => {
    if (composing.current) return
    const root = rootRef.current
    if (!root) return
    const focused = root.ownerDocument.activeElement === root && inlineDomSelection(root, root.ownerDocument.getSelection()) !== undefined
    render(props.value, pendingSelection.current ?? props.initialSelection ?? selection(), focused)
    pendingSelection.current = undefined
  }, [props.value, props.sourceText, props.tagProfile, props.formatId, props.lang, props.showInvisibles, props.showFormatCodes, annotationStructure])
  // Hover updates attributes only: do not rebuild editable text or disturb a native composition.
  React.useLayoutEffect(() => {
    if (composing.current) return
    rootRef.current?.querySelectorAll<HTMLElement>('[data-inline-tag-key]').forEach(chip => {
      if (chip.dataset.inlineTagKey === props.activeTag) chip.dataset.active = 'true'
      else delete chip.dataset.active
    })
    const active = new Set(config.current.annotations?.filter(annotation => annotation.active).map(annotation => annotation.id))
    rootRef.current?.querySelectorAll<HTMLElement>('[data-assist-id]').forEach(span => {
      if (active.has(span.dataset.assistId!)) span.dataset.active = 'true'
      else delete span.dataset.active
    })
  }, [props.activeTag, annotationActivity])
  React.useLayoutEffect(() => {
    const root = rootRef.current!
    if (props.autoFocus && !props.readOnly) select(lastSelection.current)
    const remember = (): void => {
      if (composing.current || root.ownerDocument.activeElement !== root || restoreSelectionOnFocus.current) return
      const current = inlineDomSelection(root, root.ownerDocument.getSelection())
      if (!current) return
      const normalized = snapInlineSelection(rawRef.current, current.start, current.end, tokenizeInlineText(rawRef.current, { ...config.current, targetLocale: config.current.lang }))
      if (normalized.start !== current.start || normalized.end !== current.end) select({ ...normalized, backward: current.backward }, false)
      else {
        lastSelection.current = current
        config.current.onSelectionChange?.(current)
        config.current.onSelectedText?.(rawRef.current.slice(current.start, current.end))
      }
    }
    root.ownerDocument.addEventListener('selectionchange', remember)
    const beforeInput = (event: InputEvent): void => {
      if (event.inputType === 'historyUndo' || event.inputType === 'historyRedo') {
        event.preventDefault()
        if (!composing.current && !config.current.readOnly) (event.inputType === 'historyUndo' ? config.current.onUndo : config.current.onRedo)()
        return
      }
      if (composing.current || event.isComposing) return
      if (config.current.readOnly) { event.preventDefault(); return }
      if (event.inputType === 'insertFromComposition') { event.preventDefault(); return }
      // Noncancelable native replacements (e.g. platform spellcheck) reconcile in onInput.
      if (!event.cancelable) return
      event.preventDefault()
      let range = selection()
      const target = event.getTargetRanges?.()[0]
      if (target) {
        const start = inlineDomPointToOffset(root, target.startContainer, target.startOffset)
        const end = inlineDomPointToOffset(root, target.endContainer, target.endOffset)
        if (start !== undefined && end !== undefined) range = { start, end }
      }
      if (event.inputType === 'insertParagraph' || event.inputType === 'insertLineBreak') insert('\n', range, 'manual')
      else if (event.inputType === 'insertText' || event.inputType === 'insertReplacementText') insert(event.data ?? '', range, 'manual')
      else if (event.inputType.startsWith('delete') && event.inputType !== 'deleteByDrag') {
        const raw = rawRef.current
        const caret = selection()
        const chip = caret.start === caret.end && tokenizeInlineText(raw, { ...config.current, targetLocale: config.current.lang }).find(token => token.kind === 'tag'
          && (event.inputType.includes('Backward') ? token.end === caret.start : token.start === caret.start))
        if (chip) { select({ start: chip.start, end: chip.end }); config.current.onProtectedSelection?.(); return }
        const model = phraseFormatting(raw, config.current.formatId, tokenizeInlineText(raw, { ...config.current, targetLocale: config.current.lang }))
        let deleted = range
        if (range.start === range.end) {
          if (!config.current.showFormatCodes && model.supported && model.valid) {
            const plainAt = formattingTextOffset(model, range.start)
            const plain = deletionRange(model.text, { start: plainAt, end: plainAt }, event.inputType)
            if (plain.start === plain.end) return
            deleted = { start: formattingRawOffset(model, plain.start, 'start'), end: formattingRawOffset(model, plain.end, 'end') }
          } else deleted = deletionRange(raw, range, event.inputType)
        }
        insert('', deleted, 'manual')
      }
    }
    root.addEventListener('beforeinput', beforeInput)
    return () => {
      root.ownerDocument.removeEventListener('selectionchange', remember)
      root.removeEventListener('beforeinput', beforeInput)
      // Read the live IME DOM synchronously before virtualization removes it.
      if (composing.current) {
        const current = inlineDomSelection(root, root.ownerDocument.getSelection())
        if (current) config.current.onSelectionChange?.(current)
        composing.current = false
        config.current.onCompositionEnd(readInlineDomText(root), current)
      }
    }
  }, [])

  const chipAt = (target: EventTarget | null): HTMLElement | null => target instanceof Element ? target.closest<HTMLElement>('[data-inline-tag-key]') : null
  return <div ref={rootRef} className={styles.surface} role="textbox" aria-multiline="true"
    aria-label={props.label} aria-describedby={props.describedBy} aria-invalid={props.invalid}
    aria-readonly={props.readOnly} aria-keyshortcuts="Meta+S Control+S Meta+Enter Control+Enter Escape Meta+Z Control+Z Meta+Shift+Z Control+Shift+Z Control+Y"
    data-token-editor contentEditable={!props.readOnly || composing.current} suppressContentEditableWarning
    lang={props.lang} dir="auto" spellCheck={props.spellCheck ?? true}
    onPointerDown={() => { restoreSelectionOnFocus.current = false }}
    onFocus={() => { if (restoreSelectionOnFocus.current) select(lastSelection.current, false) }}
    onKeyDown={event => {
      if (composing.current || event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229) { event.stopPropagation(); return }
      props.onKeyDown?.(event)
      if (event.defaultPrevented) return
      if ((event.metaKey || event.ctrlKey) && !event.altKey && !event.shiftKey && ['b', 'i', 'u'].includes(event.key.toLowerCase())) {
        event.preventDefault()
        if (!props.readOnly) toggleFormat(event.key.toLowerCase() as PhraseFormatFlag)
        return
      }
      // Native editing history is never allowed to compete with the persisted draft reducer.
      if ((event.metaKey || event.ctrlKey) && !event.altKey && ['z', 'y'].includes(event.key.toLowerCase())) {
        event.preventDefault()
        if (!props.readOnly) (event.key.toLowerCase() === 'y' || event.shiftKey ? props.onRedo : props.onUndo)()
      }
    }}
    onInput={event => {
      const raw = readInlineDomText(event.currentTarget)
      if (composing.current || (event.nativeEvent as InputEvent).isComposing) {
        config.current.onCompositionUpdate(raw)
        const current = inlineDomSelection(event.currentTarget, event.currentTarget.ownerDocument.getSelection())
        if (current) { lastSelection.current = current; config.current.onSelectionChange?.(current) }
        return
      }
      const range = selection()
      const focused = event.currentTarget.ownerDocument.activeElement === event.currentTarget
      if (props.readOnly || !config.current.onEdit(raw, 'manual', lastSelection.current, range)) render(rawRef.current, lastSelection.current, focused)
      else render(raw, range, focused)
    }}
    onCompositionStart={() => { compositionSelection.current = selection(); composing.current = true; config.current.onCompositionStart() }}
    onCompositionEnd={event => {
      const raw = readInlineDomText(event.currentTarget)
      const range = selection()
      composing.current = false
      const accepted = config.current.onCompositionEnd(raw, range)
      render(accepted, pendingSelection.current ?? (accepted === raw ? range : compositionSelection.current ?? range), event.currentTarget.ownerDocument.activeElement === event.currentTarget)
      pendingSelection.current = undefined
      compositionSelection.current = undefined
    }}
    onCopy={event => copyInlineSelection(event.currentTarget, event)}
    onCut={event => {
      const range = selection()
      if (range.start === range.end) return
      event.preventDefault()
      event.clipboardData.setData('text/plain', inlineSelectionText(event.currentTarget, range))
      if (!props.readOnly && !composing.current) insert('', range)
    }}
    onPaste={event => { event.preventDefault(); if (!composing.current) insert(event.clipboardData.getData('text/plain')) }}
    onDragStart={event => {
      if (composing.current) { event.preventDefault(); return }
      const current = selection()
      const range = snapInlineSelection(rawRef.current, current.start, current.end, tokenizeInlineText(rawRef.current, { ...config.current, targetLocale: config.current.lang }))
      dragging.current = range
      event.dataTransfer.setData('text/plain', inlineSelectionText(event.currentTarget, range))
      event.dataTransfer.effectAllowed = props.readOnly ? 'copy' : 'copyMove'
    }}
    onDragOver={event => { event.preventDefault(); event.dataTransfer.dropEffect = props.readOnly ? 'none' : 'copy' }}
    onDrop={event => {
      event.preventDefault()
      if (props.readOnly || composing.current || event.dataTransfer.files.length > 0) return
      const root = event.currentTarget
      const doc = root.ownerDocument as Document & { caretPositionFromPoint?: (x: number, y: number) => { offsetNode: Node; offset: number } | null }
      const point = doc.caretPositionFromPoint?.(event.clientX, event.clientY)
      const nativeRange = !point ? doc.caretRangeFromPoint?.(event.clientX, event.clientY) : null
      const node = point?.offsetNode ?? nativeRange?.startContainer
      const at = node ? inlineDomPointToOffset(root, node, point?.offset ?? nativeRange!.startOffset) : undefined
      const droppedAt = at ?? selection().start
      const position = snapInlineSelection(rawRef.current, droppedAt, droppedAt, tokenizeInlineText(rawRef.current, { ...config.current, targetLocale: config.current.lang })).start
      const moved = dragging.current
      dragging.current = undefined
      if (moved && !event.altKey && !event.ctrlKey) {
        if (position >= moved.start && position <= moved.end) return
        const raw = rawRef.current
        const model = phraseFormatting(raw, config.current.formatId, tokenizeInlineText(raw, { ...config.current, targetLocale: config.current.lang }))
        if (!config.current.showFormatCodes && model.supported && model.valid) {
          const fragment = inlineSelectionText(root, moved)
          const removed = replacePhraseFormattedText(raw, moved, '', config.current.formatId, tokenizeInlineText(raw, { ...config.current, targetLocale: config.current.lang }))
          if (!removed) return
          const length = formattingTextOffset(model, moved.end) - formattingTextOffset(model, moved.start)
          const destination = formattingTextOffset(model, position) - (position > moved.end ? length : 0)
          const without = phraseFormatting(removed.value, config.current.formatId)
          const at = formattingRawOffset(without, destination)
          const inserted = replacePhraseFormattedText(removed.value, { start: at, end: at }, fragment, config.current.formatId, tokenizeInlineText(removed.value, { ...config.current, targetLocale: config.current.lang }))
          if (inserted) {
            const updated = phraseFormatting(inserted.value, config.current.formatId)
            apply(inserted.value, { start: formattingRawOffset(updated, destination, 'start'), end: formattingRawOffset(updated, destination + length, 'end'), backward: moved.backward }, 'protected')
          }
          return
        }
        const content = raw.slice(moved.start, moved.end)
        const without = raw.slice(0, moved.start) + raw.slice(moved.end)
        const adjusted = position > moved.end ? position - (moved.end - moved.start) : position
        apply(without.slice(0, adjusted) + content + without.slice(adjusted), { start: adjusted, end: adjusted + content.length }, 'protected')
      } else insert(event.dataTransfer.getData('text/plain'), { start: position, end: position })
    }}
    onDragEnd={() => { dragging.current = undefined }}
    onMouseOver={event => { const chip = chipAt(event.target); if (chip) props.onTagFocus?.(chip.dataset.inlineTagKey) }}
    onMouseOut={event => { if (chipAt(event.target) && chipAt(event.relatedTarget) !== chipAt(event.target)) props.onTagFocus?.(undefined) }}
    onClick={event => {
      const chip = chipAt(event.target)
      if (!chip || composing.current) return
      const start = inlineDomPointToOffset(event.currentTarget, chip, 0)!
      select({ start, end: start + chip.dataset.inlineRaw!.length })
      props.onTagFocus?.(chip.dataset.inlineTagKey)
    }}
    onBlur={() => props.onTagFocus?.(undefined)}
  />
})
