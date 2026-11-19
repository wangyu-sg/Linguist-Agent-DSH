import * as React from 'react'
import type { LinguistTagProfileInfo } from '@linguist/domain-service/contracts'
import { annotatedTextRuns, copyInlineSelection, phraseFormatting, tokenizeInlineText, unicodeCharacters, type InlineAnnotation, type PhraseFormatFlag } from './inline-tokens'
import styles from './InlineTaggedText.module.css'

export interface InlineTaggedTextProps {
  text: string
  sourceText?: string
  tagProfile?: LinguistTagProfileInfo
  formatId?: string
  targetLocale?: string
  showInvisibles?: boolean
  showFormatCodes?: boolean
  formatIssueLabel?: string
  activeTag?: string
  onTagFocus?: (key: string | undefined) => void
  annotations?: readonly InlineAnnotation[]
  renderText?: (raw: string, start: number) => React.ReactNode
}

function visibleText(text: string, show: boolean): React.ReactNode {
  if (!show) return text
  return unicodeCharacters(text).map(character => character.invisible ? (
    <span key={character.start} className={styles.invisible} data-invisible-glyph={character.glyph}
      data-zero-width={character.codePoint > 0x7f && character.codePoint !== 0xa0 && character.codePoint !== 0x202f || undefined}
      title={`${character.codePointLabel} ${character.name}`}>{character.raw}</span>
  ) : character.raw)
}

/** Read-only inline rendering shares the exact same raw token identities as TokenEditor. */
export function InlineTaggedText({ text, sourceText, tagProfile, formatId, targetLocale, showInvisibles = false, showFormatCodes = false, formatIssueLabel, activeTag, onTagFocus, annotations, renderText }: InlineTaggedTextProps): React.ReactElement {
  const tokens = React.useMemo(() => tokenizeInlineText(text, { sourceText, tagProfile, targetLocale }), [text, sourceText, tagProfile, targetLocale])
  const formatting = React.useMemo(() => phraseFormatting(text, formatId, tokens), [text, formatId, tokens])
  const formatClass = (flags: readonly PhraseFormatFlag[]) => flags.map(flag => ({ b: styles.bold, i: styles.italic, u: styles.underline })[flag]).filter(Boolean).join(' ')
  const tokenFlags = (start: number, end: number) => formatting.ranges.find(range => range.start <= start && range.end >= end)?.flags ?? []
  const code = (raw: string, start: number) => <span key={`format-${start}`} hidden contentEditable={false} data-inline-raw={raw} data-inline-format-code />
  return <span className={styles.inline} data-inline-view data-inline-format-id={formatId} data-inline-format-view={showFormatCodes ? 'codes' : 'rich'} data-inline-format-invalid={!formatting.valid || undefined} title={!formatting.valid ? formatIssueLabel : undefined} onCopy={event => copyInlineSelection(event.currentTarget, event)}>
    {tokens.map(token => !showFormatCodes && formatting.codes.some(code => code.start === token.start && code.end === token.end) ? code(token.raw, token.start) : token.kind === 'tag' ? (
      <span key={`tag-${token.start}`} className={[styles.chip, formatClass(tokenFlags(token.start, token.end))].filter(Boolean).join(' ')}
        data-inline-format={tokenFlags(token.start, token.end).join('') || undefined}
        data-inline-decoration={tokenFlags(token.start, token.end).includes('u') ? 'underline' : undefined}
        contentEditable={false} data-inline-raw={token.raw}
        data-inline-tag-key={token.key} data-active={activeTag === token.key || undefined} title={token.raw}
        aria-label={token.raw} tabIndex={onTagFocus ? 0 : undefined}
        onMouseEnter={() => onTagFocus?.(token.key)} onMouseLeave={() => onTagFocus?.(undefined)}
        onFocus={() => onTagFocus?.(token.key)} onBlur={() => onTagFocus?.(undefined)}>{token.raw}</span>
    ) : annotatedTextRuns(token.raw, token.start, annotations, formatting.ranges, formatting.codes).map(run => {
      if (!showFormatCodes && run.formatCode) return code(run.raw, run.start)
      let content = renderText ? renderText(run.raw, run.start) : visibleText(run.raw, showInvisibles)
      for (const annotation of [...run.annotations].reverse()) content = <span className={styles.annotation}
        data-assist-id={annotation.id} data-assist-kind={annotation.kind} data-active={annotation.active || undefined} tabIndex={0} title={annotation.title}>{content}</span>
      if (run.flags.length) content = <span className={formatClass(run.flags)} data-inline-format={run.flags.join('')} data-inline-decoration={run.flags.includes('u') ? 'underline' : undefined}>{content}</span>
      return <React.Fragment key={`text-${run.start}`}>{content}</React.Fragment>
    }))}
  </span>
}
