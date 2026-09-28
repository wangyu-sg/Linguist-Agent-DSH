import type { LinguistProjectService } from '@linguist/domain-service'
import type { LinguistRole, SessionBinding } from './bindings'

export interface LinguistDelegationRequest {
  role?: Exclude<LinguistRole, 'general'>
  scope?: { assetIds?: readonly string[]; segmentIds?: readonly string[] }
}

/** Freeze only IDs owned by the parent's CAT project before DSH starts a child. */
export function freezeLinguistDelegation(
  service: LinguistProjectService,
  parent: SessionBinding,
  request: LinguistDelegationRequest,
): SessionBinding {
  if (!parent.projectId || parent.workMode !== 'cat') throw new Error('Linguist delegation requires a CAT project Session')
  if (parent.role !== 'general') throw new Error('Only a General Session can delegate a Linguist CAT role')
  const db = service.openProject(parent.projectId)
  const assetIds = [...new Set(request.scope?.assetIds ?? [])]
  const selected = [...new Set(request.scope?.segmentIds ?? [])]
  for (const assetId of assetIds) {
    if (!db.assets.get(assetId)) throw new Error(`Delegated Asset does not belong to project: ${assetId}`)
    selected.push(...db.segments.queryIds({ assetId }))
  }
  const segmentIds = [...new Set(selected.length || request.scope ? selected : db.segments.queryIds())]
  if (!segmentIds.length) throw new Error('Delegated scope contains no Segment')
  if (db.segments.getByIds(segmentIds).length !== segmentIds.length) throw new Error('Delegated scope contains a Segment outside the project')
  if (parent.delegatedScope && segmentIds.some(id => !parent.delegatedScope!.segmentIds.includes(id))) {
    throw new Error('Child scope exceeds the parent delegated scope')
  }
  return { ...parent, role: request.role ?? parent.role, delegatedScope: { assetIds, segmentIds } }
}

/** Native DSH run completion is separate from the CAT decision audit. */
export function linguistDelegationOutcome(service: LinguistProjectService, sessionId: string, binding: SessionBinding): unknown {
  const stage = binding.role === 'translator' ? 'translation' : binding.role === 'reviewer' ? 'editing' : binding.role === 'proofreader' ? 'proofreading' : undefined
  if (!stage || !binding.projectId || !binding.delegatedScope) return undefined
  const db = service.openProject(binding.projectId)
  const evidenceState = db.stageEvidence.list(stage).find(state => state.sessionId === sessionId)
  const evidence = evidenceState && db.stageEvidence.getCompletion(evidenceState.stageRunId)
  const coverage = evidence?.decisions ?? db.segments.getStageDecisionCoverage(stage, binding.delegatedScope.segmentIds, {
    actor: sessionId, afterEventId: Number.MAX_SAFE_INTEGER,
  })
  return {
    role: binding.role, stage, ...coverage,
    status: evidence && evidence.status !== 'complete' ? evidence.status : coverage.status,
    decided: coverage.total - coverage.pending,
    ...(evidence ? { evidence: {
      status: evidence.status,
      required: evidence.presentation.required,
      presented: evidence.presentation.presented,
      pending: evidence.presentation.pending.length,
      blockingGaps: evidence.blockingGaps.length,
      warnings: evidence.warnings.length,
    } } : {}),
  }
}
