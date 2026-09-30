import type { CatDock } from './cat-navigation'

export interface WorkbenchLocation {
  assetId?: string
  segmentId?: string
  assetNavigatorOpen: boolean
  assetNavigatorWidth: number
  inspectorWidth: number
  dockOpen: boolean
  dock: CatDock
  dockHeight: number
}

const docks: readonly CatDock[] = ['qa', 'proposals', 'references', 'assets', 'delivery', 'run', 'settings']
const defaults: WorkbenchLocation = {
  assetNavigatorOpen: true, assetNavigatorWidth: 240, inspectorWidth: 320,
  dockOpen: true, dock: 'qa', dockHeight: 240,
}

function width(value: unknown, fallback: number, minimum: number, maximum: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? Math.min(maximum, Math.max(minimum, value)) : fallback
}

export function readWorkbenchLocation(projectId: string): { value: WorkbenchLocation; error?: string } {
  try {
    const stored = localStorage.getItem(`linguist:workbench:${projectId}`)
    if (stored === null) return { value: defaults }
    const parsed: unknown = JSON.parse(stored)
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('invalid stored layout')
    const value = parsed as Record<string, unknown>
    return { value: {
      assetId: typeof value.assetId === 'string' && value.assetId ? value.assetId : undefined,
      segmentId: typeof value.segmentId === 'string' && value.segmentId ? value.segmentId : undefined,
      assetNavigatorOpen: typeof value.assetNavigatorOpen === 'boolean' ? value.assetNavigatorOpen : defaults.assetNavigatorOpen,
      assetNavigatorWidth: width(value.assetNavigatorWidth, defaults.assetNavigatorWidth, 180, 420),
      inspectorWidth: width(value.inspectorWidth, defaults.inspectorWidth, 240, 480),
      dockOpen: typeof value.dockOpen === 'boolean' ? value.dockOpen : defaults.dockOpen,
      dock: docks.includes(value.dock as CatDock) ? value.dock as CatDock : defaults.dock,
      dockHeight: width(value.dockHeight, defaults.dockHeight, 80, 480),
    } }
  } catch (cause) { return { value: defaults, error: String(cause) } }
}

export function writeWorkbenchLocation(projectId: string, location: WorkbenchLocation): void {
  localStorage.setItem(`linguist:workbench:${projectId}`, JSON.stringify(location))
}
