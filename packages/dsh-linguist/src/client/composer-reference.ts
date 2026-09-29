import type { Context } from '@deepseek-ai/cordis'
import type { InputTriggerSource } from '@deepseek-ai/dsh-client-ui-input-trigger/client'
import type { InputState, TokenSpan } from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { LinguistTurnContextV1 } from '@linguist/domain-service/contracts'
import { getWorkbenchComposerContext } from './composer-context'

const SOURCE = 'linguist-cat-selection'
const readers = new Map<string, Set<() => string>>()
export type CatReferenceStatus = 'attached' | 'omitted'

export const catReferenceSource: InputTriggerSource = {
  trigger: '@', name: SOURCE,
  candidates: async () => [],
  onPick: () => undefined,
  codec: {
    clipboardText: () => '@CAT',
    serialize(ref, signal) {
      signal.throwIfAborted()
      const capture = readers.get(ref)?.values().next().value
      if (!capture) throw new Error('CAT selection is unavailable; reopen its workbench before sending.')
      // Capture synchronously. No live selection is read after returning this Promise.
      return Promise.resolve(capture())
    },
  },
}

/** Only explicit attachment changes the draft. Native slash commands must start before the reference. */
export function connectCatReference(ctx: Context, sessionId: string, changed: (status: CatReferenceStatus) => void) {
  const binding = ctx.sessions.binding(sessionId as Parameters<typeof ctx.sessions.binding>[0])
  if (!binding) throw new Error('The CAT Session is unavailable.')
  const input = ctx.conversation.input.for(binding.ctx)
  let adjudicated: LinguistTurnContextV1 | Error | undefined
  let phase = input.state.getSnapshot().phase
  const capture = () => {
    const view = getWorkbenchComposerContext(sessionId)
    if (!view) throw new Error('CAT selection is unavailable; reopen its workbench before sending.')
    return { ...view.selection, selectedSegmentIds: [...view.selection.selectedSegmentIds], capturedAt: new Date().toISOString() }
  }
  const serialize = () => {
    const context = adjudicated ?? capture()
    adjudicated = undefined
    if (context instanceof Error) throw context
    if (context.selectedSegmentIds.length > 100) throw new Error('CAT selection exceeds 100 segments; reduce the selection before sending.')
    return `\n[LA-TURN-CONTEXT v1]\n${JSON.stringify({ sessionId, context })}\n[/LA-TURN-CONTEXT]\n`
  }
  const activeReaders = readers.get(sessionId) ?? new Set<() => string>()
  activeReaders.add(serialize)
  readers.set(sessionId, activeReaders)
  const attached = () => {
    const state: InputState = input.state.getSnapshot()
    return state.occurrences.some(item => item.source === SOURCE && item.ref === sessionId)
  }
  const attach = (span: TokenSpan) => {
    if (attached()) return true
    capture()
    return input.insertReference({ source: SOURCE, ref: sessionId, label: 'CAT', clipboardText: '@CAT' }, { ...span, start: span.end })
  }
  const inputChanged = () => {
    const state = input.state.getSnapshot()
    // Slash arbitration can await another plugin. Freeze before that arbitration returns.
    if (phase !== 'adjudicating' && state.phase === 'adjudicating') {
      try { adjudicated = capture() }
      catch (error) { adjudicated = error instanceof Error ? error : new Error(String(error)) }
    }
    if (state.phase !== 'adjudicating') adjudicated = undefined
    phase = state.phase
    changed(attached() ? 'attached' : 'omitted')
  }
  const off = input.state.subscribe(inputChanged)
  inputChanged()
  return { attach, dispose: () => { off(); activeReaders.delete(serialize); if (activeReaders.size === 0) readers.delete(sessionId) } }
}
