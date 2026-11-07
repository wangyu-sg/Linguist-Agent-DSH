import * as React from 'react'
import type { LinguistTagProfileInfo } from '@linguist/domain-service/contracts'
import { annotatedTextRuns, copyInlineSelection, tokenizeInlineText, unicodeCharacters, type InlineAnnotation } from './inline-tokens'
import styles from './InlineTaggedText.module.css'

export interface InlineTaggedTextProps {
  text: string
  sourceText?: string
  tagProfile?: LinguistTagProfileInfo
  targetLocale?: string
  showInvisibles?: boolean
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
export function InlineTaggedText({ text, sourceText, tagProfile, targetLocale, showInvisibles = false, activeTag, onTagFocus, annotations, renderText }: InlineTaggedTextProps): React.ReactElement {
  const tokens = React.useMemo(() => tokenizeInlineText(text, { sourceText, tagProfile, targetLocale }), [text, sourceText, tagProfile, targetLocale])
  return <span className={styles.inline} data-inline-view onCopy={event => copyInlineSelection(event.currentTarget, event)}>
    {tokens.map(token => token.kind === 'tag' ? (
      <span key={`tag-${token.start}`} className={styles.chip} contentEditable={false} data-inline-raw={token.raw}
        data-inline-tag-key={token.key} data-active={activeTag === token.key || undefined} title={token.raw}
        aria-label={token.raw} tabIndex={onTagFocus ? 0 : undefined}
        onMouseEnter={() => onTagFocus?.(token.key)} onMouseLeave={() => onTagFocus?.(undefined)}
        onFocus={() => onTagFocus?.(token.key)} onBlur={() => onTagFocus?.(undefined)}>{token.raw}</span>
    ) : annotatedTextRuns(token.raw, token.start, annotations).map(run => {
      let content = renderText ? renderText(run.raw, run.start) : visibleText(run.raw, showInvisibles)
      for (const annotation of [...run.annotations].reverse()) content = <span className={styles.annotation}
        data-assist-id={annotation.id} data-assist-kind={annotation.kind} data-active={annotation.active || undefined} tabIndex={0} title={annotation.title}>{content}</span>
      return <React.Fragment key={`text-${run.start}`}>{content}</React.Fragment>
    }))}
  </span>
}
