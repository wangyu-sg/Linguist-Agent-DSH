import * as React from 'react'

export type CatDock = 'qa' | 'proposals' | 'references' | 'assets' | 'delivery' | 'run' | 'settings'

export interface CatNavigation {
  sessionId: string
  projectId: string
  assetId?: string
  segmentId?: string
  findingId?: string
  proposalId?: string
  docId?: string
  dock?: CatDock
  inspector?: boolean
}

interface NavigationRequest extends CatNavigation { revision: number }

const requests = new Map<string, NavigationRequest>()
const listeners = new Map<string, Set<() => void>>()

function navigationKey(sessionId: string, projectId: string): string {
  return `${sessionId}\0${projectId}`
}

export function requestCatNavigation(input: CatNavigation): void {
  const key = navigationKey(input.sessionId, input.projectId)
  requests.set(key, { ...input, revision: (requests.get(key)?.revision ?? 0) + 1 })
  listeners.get(key)?.forEach((listener) => listener())
}

export function useCatNavigation(sessionId: string, projectId: string): NavigationRequest | undefined {
  const key = navigationKey(sessionId, projectId)
  const subscribe = React.useCallback((listener: () => void) => {
    let group = listeners.get(key)
    if (group === undefined) { group = new Set(); listeners.set(key, group) }
    group.add(listener)
    return () => { group.delete(listener); if (group.size === 0) listeners.delete(key) }
  }, [key])
  const getSnapshot = React.useCallback(() => requests.get(key), [key])
  return React.useSyncExternalStore(subscribe, getSnapshot)
}
