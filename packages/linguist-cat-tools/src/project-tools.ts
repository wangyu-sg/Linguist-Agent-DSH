import type { SegmentStatus } from '@linguist/cat-core'
import { stageEvidenceDetails, type ProjectDatabase } from '@linguist/cat-store'
import { Type } from 'typebox'
import {
  LinguistCatBatchNotFoundError,
  LinguistCatInvalidArgumentError,
} from './errors'
import { pageHasMore, resolvePage } from './pagination'
import {
  CAT_TOOL_PAGE_LIMITS,
  type CatBatchListItem,
  type CatDeliveryStatus,
  type CatProjectSummaryResult,
  type CatSegmentIndexItem,
  type CatSegmentListItem,
  type PagedResult,
} from './types'
import {
  defineTool,
  toolResult,
  toSegmentItem,
  type CatToolRuntime,
} from './tool-runtime'

const SEGMENT_STATUSES: readonly SegmentStatus[] = [
  'untranslated',
  'draft',
  'translated',
  'reviewed',
]

const ARCHIVED_NOTE = 'Project is archived: all data is read-only.'
const SEGMENT_PAGE_BYTES = 24 * 1024

/** 项目概览、批次目录与分页句段读取。 */
export function createProjectTools(runtime: CatToolRuntime) {
  const { deps, resolveBoundProject } = runtime

  const currentTaskFor = (
    db: ProjectDatabase,
    batchId: string,
  ): CatDeliveryStatus['currentTask'] => {
    if (deps.sessionId === undefined
      || (deps.linguistRole !== 'translator' && deps.linguistRole !== 'reviewer' && deps.linguistRole !== 'proofreader')) return null
    const batchSegmentIds = new Set(db.segments.queryIds({ assetId: batchId }))
    const state = db.stageEvidence.list().find(candidate =>
      candidate.sessionId === deps.sessionId
      && candidate.role === deps.linguistRole
      && candidate.plan.segmentIds.some(segmentId => batchSegmentIds.has(segmentId)))
    if (state === undefined) return null
    const completion = db.stageEvidence.getCompletion(state.stageRunId)
    return {
      stageRunId: state.stageRunId,
      role: deps.linguistRole,
      status: completion.status,
      scopeSegments: completion.decisions.total,
      pendingSegments: completion.decisions.pending,
      blockedSegments: completion.decisions.blocked,
      pendingEvidence: completion.presentation.pending.length,
      blockingGaps: completion.blockingGaps.length,
      ...stageEvidenceDetails(completion),
    }
  }

  const projectSummaryTool = defineTool({
    name: 'cat_project_summary',
    label: 'CAT project summary',
    description:
      'Read a side-effect-free business summary of the bound CAT project; never ask for or accept a model-selected projectId. With no arguments, return project, batchCount and segment counts. For one imported batch, use includeDelivery=true with batchId to additionally read the existing delivery preflight snapshot and this session\'s latest relevant professional task. This query does not create tasks, record decisions/evidence, run persisted QA, stage an export, or save files. ready means preflight readiness, not verified export or independent review. qaFreshness=not-evaluated means this summary does not establish QA freshness; no findings is not proof that QA ran. currentTask=null means no matching task, not completed review. Archived projects remain readable but not exportable through this query.',
    promptSnippet: 'Summarize the bound CAT project',
    parameters: Type.Object({
      batchId: Type.Optional(Type.String({
        minLength: 1,
        description: 'Imported batch ID from cat_list_batches. Supply together with includeDelivery=true to inspect one batch; never a project ID.',
      })),
      includeDelivery: Type.Optional(Type.Boolean({
        description: 'Read the existing delivery preflight and this session\'s latest relevant task for one batch. Requires batchId. Does not run persisted QA, create a Stage, stage an export or save a file.',
      })),
    }),
    async execute(toolCallId, params) {
      if (params.includeDelivery === true && params.batchId === undefined) {
        throw new LinguistCatInvalidArgumentError('batchId', 'required when includeDelivery=true')
      }
      if (params.batchId !== undefined && params.includeDelivery !== true) {
        throw new LinguistCatInvalidArgumentError('includeDelivery', 'must be true when batchId is provided')
      }
      const { project, db } = resolveBoundProject('cat_project_summary', toolCallId)
      const batchCount = db.assets.countByProject()
      const segmentCounts = db.segments.countByStatus()
      const totalSegments =
        segmentCounts.untranslated + segmentCounts.draft + segmentCounts.translated + segmentCounts.reviewed
      const archived = project.archivedAt !== undefined
      const delivery = params.includeDelivery === true
        ? (() => {
            const batchId = params.batchId!
            if (db.assets.get(batchId) === undefined) throw new LinguistCatBatchNotFoundError(batchId)
            if (deps.readDeliveryPreflight === undefined) {
              throw new LinguistCatInvalidArgumentError('includeDelivery', 'delivery preflight is unavailable')
            }
            const preflight = deps.readDeliveryPreflight(batchId)
            return {
              batchId: preflight.assetId,
              workflowStage: preflight.workflowStage,
              archived,
              segmentCount: preflight.segmentCount,
              lockedSegments: preflight.lockedSegments,
              unconfirmedUnlockedSegments: preflight.unconfirmedUnlockedSegments,
              pendingProposalCount: preflight.pendingProposalCount,
              qa: {
                openErrors: preflight.qa.openErrors,
                openWarnings: preflight.qa.openWarnings,
                waived: preflight.qa.waived,
              },
              qaFreshness: 'not-evaluated' as const,
              evidence: {
                status: preflight.evidence.status,
                stageRuns: preflight.evidence.stageRuns,
                required: preflight.evidence.required,
                presented: preflight.evidence.presented,
                pending: preflight.evidence.pending,
              },
              ready: preflight.ready,
              blockers: preflight.blockers.map(({ code, count, message }) => ({ code, count, message })),
              verifiedExport: false as const,
              currentTask: currentTaskFor(db, batchId),
            }
          })()
        : undefined
      const dto: CatProjectSummaryResult = {
        project: {
          id: project.id as string,
          name: project.name,
          sourceLocale: project.sourceLocale,
          targetLocale: project.targetLocale,
          archived,
          createdAt: project.createdAt,
          updatedAt: project.updatedAt,
          ...(project.archivedAt !== undefined ? { archivedAt: project.archivedAt } : {}),
        },
        batchCount,
        totalSegments,
        segmentCounts,
        ...(archived ? { note: ARCHIVED_NOTE } : {}),
        ...(delivery === undefined ? {} : { delivery }),
      }
      return toolResult(dto, deps.resultProjectId)
    },
  })

  const listBatchesTool = defineTool({
    name: 'cat_list_batches',
    label: 'CAT list batches',
    description:
      'List imported work batches (source files), not language reference assets, of the bound CAT project: batchId, filename, formatId, ' +
      'segmentCount, and the content-derived sourceSha256 (not a path). Paginated: default limit ' +
      `${CAT_TOOL_PAGE_LIMITS.listBatches.defaultLimit}, hard max ${CAT_TOOL_PAGE_LIMITS.listBatches.maxLimit} ` +
      '(larger limits are clamped with a note). Use offset to page.',
    promptSnippet: 'List work batches of the bound CAT project',
    parameters: Type.Object({
      limit: Type.Optional(Type.Integer({ minimum: 1 })),
      offset: Type.Optional(Type.Integer({ minimum: 0 })),
    }),
    async execute(toolCallId, params) {
      const { db } = resolveBoundProject('cat_list_batches', toolCallId)
      const page = resolvePage(params, CAT_TOOL_PAGE_LIMITS.listBatches)
      // Asset rows are file-level metadata (tens, not millions); listByProject
      // never loads segment rows, so an in-memory page slice stays cheap.
      const batches = db.assets.listByProject()
      const items: CatBatchListItem[] = batches.slice(page.offset, page.offset + page.limit).map((batch) => ({
        batchId: batch.id as string,
        filename: batch.originalFilename,
        formatId: batch.formatId,
        segmentCount: batch.segmentCount,
        sourceSha256: batch.sourceSha256,
      }))
      const dto: PagedResult<CatBatchListItem> = {
        items,
        total: batches.length,
        limit: page.limit,
        offset: page.offset,
        hasMore: pageHasMore(batches.length, page.offset, items.length),
        ...(page.note !== undefined ? { note: page.note } : {}),
      }
      return toolResult(dto, deps.resultProjectId)
    },
  })

  const getSegmentsTool = defineTool({
    name: 'cat_get_segments',
    label: 'CAT get segments',
    description:
      'Read segments of the bound CAT project, optionally filtered by batchId (must come from ' +
      'cat_list_batches), status, or a case-insensitive literal substring over source/target. ' +
      'Paginated: default limit ' +
      `${CAT_TOOL_PAGE_LIMITS.getSegments.defaultLimit}, hard max ${CAT_TOOL_PAGE_LIMITS.getSegments.maxLimit} ` +
      '(larger limits are clamped with a note). Pages fit a 24 KiB UTF-8 result budget; continue with ' +
      'the returned nextOffset, not offset+limit. Content rows include segmentId, one-based originalOrdinal, ' +
      'complete source/current target and imported context notes. An oversized single row is returned ' +
      'complete with oversized=true; if the host truncates it, use cat_get_translation_context with maxBytes=24576 for that ' +
      'segment and collect its cursor fragments before reviewing. view=index returns only IDs and ' +
      'navigation metadata, not review content or evidence. Segment ids are stable across filtering and paging.',
    promptSnippet: 'Read segments of the bound CAT project (paged)',
    promptGuidelines: [
      'Continue cat_get_segments using its nextOffset; byte-limited pages can contain fewer than limit rows. Never treat host-truncated content as fully read.',
    ],
    parameters: Type.Object({
      batchId: Type.Optional(Type.String({ description: 'Batch ID from cat_list_batches.' })),
      status: Type.Optional(
        Type.Union([
          Type.Literal('untranslated'),
          Type.Literal('draft'),
          Type.Literal('translated'),
          Type.Literal('reviewed'),
        ]),
      ),
      search: Type.Optional(Type.String({ description: 'Literal substring matched against source or target.' })),
      view: Type.Optional(Type.Union([Type.Literal('content'), Type.Literal('index')], {
        description: 'Default content returns source/target; index returns only navigation metadata.',
      })),
      limit: Type.Optional(Type.Integer({ minimum: 1 })),
      offset: Type.Optional(Type.Integer({ minimum: 0 })),
    }),
    async execute(toolCallId, params) {
      const { batchId, status, search, view } = params
      if (status !== undefined && !SEGMENT_STATUSES.includes(status)) {
        throw new LinguistCatInvalidArgumentError('status', `expected one of ${SEGMENT_STATUSES.join('/')}, got ${String(status)}`)
      }
      if (view !== undefined && view !== 'content' && view !== 'index') {
        throw new LinguistCatInvalidArgumentError('view', `expected content/index, got ${String(view)}`)
      }
      const { db } = resolveBoundProject('cat_get_segments', toolCallId)
      if (batchId !== undefined && db.assets.get(batchId) === undefined) {
        throw new LinguistCatBatchNotFoundError(batchId)
      }
      const page = resolvePage(params, CAT_TOOL_PAGE_LIMITS.getSegments)
      const filter = {
        ...(batchId !== undefined ? { assetId: batchId } : {}),
        ...(status !== undefined ? { status } : {}),
        ...(search !== undefined && search !== '' ? { search } : {}),
      }
      const pageFilter = { ...filter, limit: page.limit, offset: page.offset }
      const total = db.segments.count(filter)
      const candidates: Array<CatSegmentListItem | CatSegmentIndexItem> = view === 'index'
        ? db.segments.queryIndex(pageFilter).map(segment => ({
            segmentId: segment.id as string,
            batchId: segment.assetId as string,
            originalOrdinal: segment.ordinal + 1,
            ...(segment.key !== undefined ? { key: segment.key } : {}),
            status: segment.status,
            currentStageState: segment.currentStageState,
            locked: segment.locked,
            revision: segment.revision,
          }))
        : db.segments.query(pageFilter).map(toSegmentItem)
      let dto: PagedResult<CatSegmentListItem | CatSegmentIndexItem> & {
        nextOffset: number | null
        maxBytes: number
        oversized?: true
      } = {
        items: [],
        total,
        limit: page.limit,
        offset: page.offset,
        hasMore: false,
        nextOffset: null,
        maxBytes: SEGMENT_PAGE_BYTES,
        ...(page.note !== undefined ? { note: page.note } : {}),
      }
      let result = toolResult(dto, deps.resultProjectId)
      for (const item of candidates) {
        const items = [...dto.items, item]
        const hasMore = pageHasMore(total, page.offset, items.length)
        const next = { ...dto, items, hasMore, nextOffset: hasMore ? page.offset + items.length : null }
        const nextResult = toolResult(next, deps.resultProjectId, [items[0]!.segmentId])
        const bytes = Buffer.byteLength(JSON.stringify(nextResult.details), 'utf8')
        if (bytes > SEGMENT_PAGE_BYTES && items.length > 1) break
        dto = next
        result = nextResult
        if (bytes > SEGMENT_PAGE_BYTES) {
          dto.oversized = true
          dto.note = `${page.note === undefined ? '' : `${page.note} `}Single row exceeds the page budget; returned complete. If the host truncates it, read this segment through cat_get_translation_context with maxBytes=24576 and collect its cursor fragments.`
          result = toolResult(dto, deps.resultProjectId, [item.segmentId])
          break
        }
      }
      return result
    },
  })

return [
    projectSummaryTool,
    listBatchesTool,
    getSegmentsTool,
  ] as const
}
