import { atom, createStore, type PrimitiveAtom } from 'jotai'
import type { TargetEditorDraft } from './TargetEditor'

export interface CatEditorState {
  store: ReturnType<typeof createStore>
  drafts: Map<string, PrimitiveAtom<TargetEditorDraft | undefined>>
  editingId: PrimitiveAtom<string | undefined>
}

// Unsubmitted text stays in this Client instance, outside layout storage and Agent context.
const states = new Map<string, CatEditorState>()

export function getCatEditorState(sessionId: string, projectId: string): CatEditorState {
  const key = `${sessionId}\0${projectId}`
  let state = states.get(key)
  if (!state) {
    state = { store: createStore(), drafts: new Map(), editingId: atom<string>() }
    states.set(key, state)
  }
  return state
}

export function clearCatEditorStates(): void {
  states.clear()
}
