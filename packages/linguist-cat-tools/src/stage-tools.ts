import type { WorkflowStage } from '@linguist/cat-core'
import { stageEvidenceDetails, type ProjectDatabase } from '@linguist/cat-store'
import { Type } from 'typebox'
import { LinguistCatInvalidArgumentError } from './errors'
import type { CatConfirmSegmentsResult, CatReadVersion } from './types'
import { defineTool, toolResult, type CatToolRuntime } from './tool-runtime'

const ROLE_STAGE = { translator: 'translation', reviewer: 'editing', proofreader: 'proofreading' } as const

/** Record only the explicitly reviewed group, against its read or committed versions. */
export function recordReviewedWork(runtime: CatToolRuntime, db: ProjectDatabase, versions: readonly CatReadVersion[], blockedIds: readonly string[], applied: readonly { segmentId: string; revision: number }[] = [], failedIds: readonly string[] = []): CatConfirmSegmentsResult {
  const { deps } = runtime
  const role = deps.linguistRole
  if (role === undefined || role === 'general') throw new LinguistCatInvalidArgumentError('linguistRole', 'Stage completion requires a Translator, Reviewer, or Proofreader session')
  const stage: WorkflowStage = ROLE_STAGE[role]
  const evidence = deps.stageEvidenceRunId === undefined ? undefined : db.stageEvidence.get(deps.stageEvidenceRunId)
  if (deps.stageEvidenceRunId !== undefined && evidence === undefined) throw new Error('Host Stage Evidence state is missing')
  const blocked = new Set(blockedIds)
  const writes = new Map(applied.map(item => [item.segmentId, item.revision]))
  const decisions: CatConfirmSegmentsResult['decisions'] = []
  const skipped: NonNullable<CatConfirmSegmentsResult['skipped']> = []
  for (const read of versions) {
    if (failedIds.includes(read.segmentId)) { skipped.push({ segmentId: read.segmentId, code: 'WRITE_NOT_APPLIED' }); continue }
    const current = db.segments.getById(read.segmentId)
    if (!current) { skipped.push({ segmentId: read.segmentId, code: 'UNKNOWN_SEGMENT' }); continue }
    const writtenRevision = writes.get(read.segmentId) ?? read.appliedRevision
    const expectedRevision = writtenRevision ?? read.revision
    const decision = blocked.has(read.segmentId) ? 'blocked' : writtenRevision === undefined ? 'unchanged' : 'corrected'
    if (decision !== 'blocked') {
      const code = current.sourceHash !== read.sourceHash || current.revision !== expectedRevision ? 'STALE_SNAPSHOT'
        : current.locked ? 'LOCKED' : current.target === '' ? 'EMPTY_TARGET' : undefined
      if (code) { skipped.push({ segmentId: read.segmentId, code }); continue }
    }
    const previous = db.segments.listStageEvents(read.segmentId, deps.sessionId === undefined ? undefined : {
      actor: deps.sessionId, afterEventId: evidence?.plan.decisionEventBoundary ?? 0,
    }).at(-1)
    if (previous?.actor === deps.sessionId && previous?.stage === stage && previous.segmentRevision === expectedRevision && previous.action === decision) {
      skipped.push({ segmentId: read.segmentId, code: 'ALREADY_RECORDED' })
      continue
    }
    const result = db.segments.recordCurrentStageDecision(read.segmentId, stage, expectedRevision, decision, {
      ...(deps.sessionId === undefined ? {} : { actor: deps.sessionId }),
      ...(deps.now === undefined ? {} : { now: deps.now() }),
    })
    decisions.push({ segmentId: read.segmentId, decision, revision: result.event.segmentRevision })
  }
  const completion = evidence === undefined ? undefined : db.stageEvidence.getCompletion(evidence.stageRunId)
  const coverage = completion?.decisions ?? db.segments.getStageDecisionCoverage(stage, deps.reviewScopeSegmentIds ?? versions.map(item => item.segmentId))
  return {
    stage, decisions, skipped,
    coverage: { scope: deps.reviewScopeSegmentIds === undefined ? 'items' : 'delegated', ...coverage },
    ...(completion === undefined ? {} : { fullReview: {
      status: completion.status, requiredEvidence: completion.presentation.required, presentedEvidence: completion.presentation.presented,
      pendingEvidence: completion.presentation.pending.length, blockingGaps: completion.blockingGaps.length, warnings: completion.warnings.length,
      ...stageEvidenceDetails(completion),
    } }),
    replayed: false,
  }
}

export function validateReviewedGroup(segmentIds: readonly string[], blockedIds: readonly string[]): void {
  if (segmentIds.length < 1 || segmentIds.length > 200 || new Set(segmentIds).size !== segmentIds.length) {
    throw new LinguistCatInvalidArgumentError('segmentIds', 'expected 1-200 unique explicitly reviewed IDs')
  }
  if (new Set(blockedIds).size !== blockedIds.length || blockedIds.some(id => !segmentIds.includes(id))) {
    throw new LinguistCatInvalidArgumentError('blockedSegmentIds', 'expected a unique subset of the reviewed IDs')
  }
}

export function createStageTools(runtime: CatToolRuntime) {
  const { deps, resolveBoundProject, notifyMutation } = runtime
  const confirmSegmentsTool = defineTool({
    name: 'cat_confirm_segments', label: 'CAT record reviewed group',
    description: 'Declare a complete group actually reviewed against full Source/current Target and applicable evidence. Supply its read snapshot IDs and segment IDs once. The software records unchanged/corrected from the read versions and actual successful writes; blockedSegmentIds remain unresolved. No manual revision copying or per-segment unchanged records. Only a professional role can confirm. Stale, locked and empty items are reported in skipped, never silently confirmed. A read page, saved edit or absent change-list item does not prove review completion. Use cat_apply_translations with reviewedSegmentIds to save edits and declare the group together.',
    promptSnippet: 'Declare the explicit full reviewed group; software records versions and decisions',
    parameters: Type.Object({
      snapshotIds: Type.Array(Type.String({ minLength: 1 }), { minItems: 1, maxItems: 200 }),
      segmentIds: Type.Array(Type.String({ minLength: 1 }), { minItems: 1, maxItems: 200 }),
      blockedSegmentIds: Type.Optional(Type.Array(Type.String({ minLength: 1 }), { maxItems: 200 })),
    }),
    async execute(toolCallId, params) {
      const blocked = params.blockedSegmentIds ?? []
      validateReviewedGroup(params.segmentIds, blocked)
      const { db } = resolveBoundProject('cat_confirm_segments', toolCallId)
      runtime.prepareStage(params.segmentIds)
      const runId = deps.sessionId === undefined ? `tool:${toolCallId}` : `run:${deps.sessionId}:${toolCallId}`
      const mutation = db.runs.executeMutation({
        identity: { runId, toolCallId, idempotencyKey: `cat_confirm_segments:${deps.stageEvidenceRunId ?? 'unscoped'}:${runId}:${toolCallId}` },
        operation: 'cat_confirm_segments', payload: params,
        mutate: () => {
          const versions = runtime.readVersions(params.snapshotIds, params.segmentIds, db)
          const result = recordReviewedWork(runtime, db, versions, blocked)
          return { result, changes: [], ...(result.decisions.length ? { event: { kind: 'project-updated' as const, segmentIds: result.decisions.map(item => item.segmentId) } } : {}) }
        },
      })
      if (!mutation.replayed && mutation.event) notifyMutation({ kind: 'project-updated', sequence: mutation.event.sequence, segmentIds: mutation.event.segmentIds })
      return toolResult({ ...mutation.result, replayed: mutation.replayed }, deps.resultProjectId, params.segmentIds)
    },
  })
  return [confirmSegmentsTool] as const
}
