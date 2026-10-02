import { atom, createStore, type PrimitiveAtom } from 'jotai'
import type { TargetEditorDraft } from './TargetEditor'

export interface CatEditorState {
  store: ReturnType<typeof createStore>
  drafts: Map<string, PrimitiveAtom<TargetEditorDraft | undefined>>
  editingId: PrimitiveAtom<string | undefined>
  propagateRepeated: PrimitiveAtom<boolean>
}

// Unsubmitted text stays in this Client instance, outside layout storage and Agent context.
const states = new Map<string, CatEditorState>()

export function getCatEditorState(sessionId: string, projectId: string): CatEditorState {
  const key = `${sessionId}\0${projectId}`
  let state = states.get(key)
  if (!state) {
    state = { store: createStore(), drafts: new Map(), editingId: atom<string>(), propagateRepeated: atom(true) }
    states.set(key, state)
  }
  return state
}

export function protectedCatDraftSegmentIds(projectId: string): string[] {
  const ids = new Set<string>()
  for (const [key, state] of states) {
    if (!key.endsWith(`\0${projectId}`)) continue
    for (const [segmentId, draftAtom] of state.drafts) {
      const draft = state.store.get(draftAtom)
      if (draft && (draft.state.value !== draft.baseTarget || draft.saving || draft.state.composing || draft.conflict || draft.resolvingConflict)) ids.add(segmentId)
    }
  }
  return [...ids]
}

export function clearCatEditorStates(): void {
  states.clear()
}
