import { isDeepStrictEqual } from 'node:util'
import type { LinguistProjectService } from '@linguist/domain-service'
import type { LinguistTurnContextV1 } from '@linguist/domain-service/contracts'
import type { BindingStore, LinguistRole, SessionBinding } from './bindings'

export type { LinguistTurnContextV1 } from '@linguist/domain-service/contracts'

const PROJECT_ID = /^prj-[0-9a-f]{16}$/
const ASSET_ID = /^ast(?:-[0-9a-f]{16}|_v2_[0-9a-f]{64})$/
const SEGMENT_ID = /^seg(?:-[0-9a-f]{16}|_v2_[0-9a-f]{64})$/
const FINDING_ID = /^qaf(?:-[0-9a-f]{16}|_v2_[0-9a-f]{64})$/

export interface AutomationLinguistContext {
  projectId: string
  role: LinguistRole
  scope?: { kind: 'project' } | { kind: 'asset'; assetId: string } | { kind: 'segments'; assetId: string; segmentIds: string[] }
  capturedAt: string
}

export interface AutomationLinguistCapture {
  scope: 'context' | 'project' | 'asset' | 'segments' | 'none'
  role?: LinguistRole
  turnContext?: unknown
}

export function validateLinguistTurnContext(value: unknown, projectId: string, service: LinguistProjectService): { context: LinguistTurnContextV1; selectionTruncated: boolean } {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Linguist turn context must be an object')
  const context = value as Record<string, unknown>
  const allowed = new Set(['schemaVersion', 'selectionTruncated', 'projectId', 'assetId', 'activeSegmentId', 'selectedSegmentIds', 'activeQaFindingId', 'capturedAt', 'uiRevision'])
  if (Object.keys(context).some(key => !allowed.has(key))) throw new Error('Linguist turn context contains an unknown field')
  if (context.schemaVersion !== 1 || context.projectId !== projectId || !PROJECT_ID.test(projectId)) throw new Error('Linguist turn context differs from Session project')
  if (context.assetId !== undefined && (typeof context.assetId !== 'string' || !ASSET_ID.test(context.assetId))) throw new Error('Invalid context Asset ID')
  if (context.activeSegmentId !== undefined && (typeof context.activeSegmentId !== 'string' || !SEGMENT_ID.test(context.activeSegmentId))) throw new Error('Invalid active Segment ID')
  if (context.activeQaFindingId !== undefined && (typeof context.activeQaFindingId !== 'string' || !FINDING_ID.test(context.activeQaFindingId))) throw new Error('Invalid QA Finding ID')
  if (!Array.isArray(context.selectedSegmentIds) || context.selectedSegmentIds.some(id => typeof id !== 'string' || !SEGMENT_ID.test(id))) throw new Error('Invalid selected Segment IDs')
  if (context.selectionTruncated !== undefined && context.selectionTruncated !== true) throw new Error('Invalid truncation flag')
  if (typeof context.capturedAt !== 'string' || !Number.isFinite(Date.parse(context.capturedAt)) || new Date(context.capturedAt).toISOString() !== context.capturedAt) throw new Error('Invalid context timestamp')
  if (!Number.isSafeInteger(context.uiRevision) || (context.uiRevision as number) < 0) throw new Error('Invalid context revision')
  const selected = context.selectedSegmentIds as string[]
  const ids = selected.slice(0, 100)
  if (new Set(selected).size !== selected.length) throw new Error('Duplicate selected Segment ID')
  const db = service.openProject(projectId)
  const assetId = context.assetId as string | undefined
  if (assetId && !db.assets.get(assetId)) throw new Error('Context Asset does not belong to project')
  for (const id of [...ids, ...(context.activeSegmentId ? [context.activeSegmentId as string] : [])]) {
    const segment = db.segments.getById(id)
    if (!segment || (assetId && segment.assetId !== assetId)) throw new Error('Context Segment does not belong to selected project/Asset')
  }
  if (context.activeQaFindingId && !db.qaFindings.getById(context.activeQaFindingId as string)) throw new Error('Context QA Finding does not belong to project')
  const selectionTruncated = selected.length > 100 || context.selectionTruncated === true
  return { context: Object.freeze({
    schemaVersion: 1,
    ...(selectionTruncated ? { selectionTruncated: true } : {}),
    projectId,
    ...(assetId ? { assetId } : {}),
    ...(context.activeSegmentId ? { activeSegmentId: context.activeSegmentId as string } : {}),
    selectedSegmentIds: Object.freeze(ids),
    ...(context.activeQaFindingId ? { activeQaFindingId: context.activeQaFindingId as string } : {}),
    capturedAt: context.capturedAt,
    uiRevision: context.uiRevision as number,
  }), selectionTruncated }
}

/** Capture from the Host's bound Session; a current Client selection cannot change project authority. */
export function captureAutomationLinguistContext(
  capture: AutomationLinguistCapture,
  binding: SessionBinding | undefined,
  workspaceId: string,
  bindings: BindingStore,
  service: LinguistProjectService,
): AutomationLinguistContext | undefined {
  if (capture.scope === 'none') return undefined
  if (!binding?.projectId || binding.workspaceId !== workspaceId) {
    if (capture.scope === 'context') return undefined
    throw new Error('Selected scope needs a Linguist Session in the target Workspace')
  }
  if (bindings.projectWorkspace(binding.projectId) !== workspaceId) throw new Error('Project Workspace association changed')
  service.getProject(binding.projectId)
  const role = capture.role ?? 'general'
  if (!['general', 'translator', 'reviewer', 'proofreader'].includes(role)) throw new Error('Unknown Linguist role')
  const parsed = capture.scope === 'asset' || capture.scope === 'segments'
    ? validateLinguistTurnContext(capture.turnContext, binding.projectId, service)
    : undefined
  if (parsed && !parsed.context.assetId) throw new Error('Captured turn has no Asset')
  if (capture.scope === 'segments' && (parsed!.selectionTruncated || !parsed!.context.selectedSegmentIds.length)) throw new Error('Captured Segment selection is empty or truncated')
  return {
    projectId: binding.projectId, role,
    ...(capture.scope === 'project' ? { scope: { kind: 'project' as const } }
      : capture.scope === 'asset' ? { scope: { kind: 'asset' as const, assetId: parsed!.context.assetId! } }
        : capture.scope === 'segments' ? { scope: { kind: 'segments' as const, assetId: parsed!.context.assetId!, segmentIds: [...parsed!.context.selectedSegmentIds] } } : {}),
    capturedAt: parsed?.context.capturedAt ?? new Date().toISOString(),
  }
}

/** Recheck persisted identity and entity ownership whenever a native execution begins. */
export function revalidateAutomationLinguistContext(
  context: AutomationLinguistContext,
  boundSession: SessionBinding,
  workspaceId: string,
  bindings: BindingStore,
  service: LinguistProjectService,
): readonly string[] | undefined {
  if (boundSession.projectId !== context.projectId || boundSession.workspaceId !== workspaceId || boundSession.role !== context.role || bindings.projectWorkspace(context.projectId) !== workspaceId) {
    throw new Error('Scheduled execution Session no longer matches captured Linguist context')
  }
  const db = service.openProject(context.projectId)
  const scope = context.scope
  if (!scope) return undefined
  if (scope.kind !== 'project' && !db.assets.get(scope.assetId)) throw new Error('Scheduled Asset no longer belongs to project')
  if (scope.kind === 'segments') {
    for (const id of scope.segmentIds) {
      const segment = db.segments.getById(id)
      if (!segment || segment.assetId !== scope.assetId) throw new Error('Scheduled Segment ownership changed')
    }
  }
  return scope.kind === 'segments' ? [...scope.segmentIds] : db.segments.queryIds(scope.kind === 'asset' ? { assetId: scope.assetId } : undefined)
}

export function automationContextMatches(expected: AutomationLinguistContext | undefined, actual: AutomationLinguistContext | undefined): boolean {
  return isDeepStrictEqual(expected, actual)
}
