import type { LinguistTurnContextV1 } from '@linguist/domain-service/contracts'

export interface WorkbenchComposerContext {
  projectId: string
  projectName: string
  assetId?: string
  assetName?: string
  referenceSegmentId?: string
  selectedCount: number
  selection: LinguistTurnContextV1
  clearReference: () => void
  clearSelection: () => void
}

const values = new Map<string, WorkbenchComposerContext>()
const listeners = new Map<string, Set<() => void>>()

export function getWorkbenchComposerContext(sessionId: string): WorkbenchComposerContext | undefined {
  return values.get(sessionId)
}

export function subscribeWorkbenchComposerContext(sessionId: string, listener: () => void): () => void {
  const subscribers = listeners.get(sessionId) ?? new Set<() => void>()
  subscribers.add(listener)
  listeners.set(sessionId, subscribers)
  return () => {
    subscribers.delete(listener)
    if (subscribers.size === 0) listeners.delete(sessionId)
  }
}

export function publishWorkbenchComposerContext(sessionId: string, context?: WorkbenchComposerContext): void {
  if (context) values.set(sessionId, { ...context, selection: Object.freeze({ ...context.selection, selectedSegmentIds: Object.freeze([...context.selection.selectedSegmentIds]) }) })
  else values.delete(sessionId)
  listeners.get(sessionId)?.forEach((listener) => listener())
}
