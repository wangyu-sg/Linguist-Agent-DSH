import type {
  LinguistGenerationProvenance,
  ProposalIssuanceInput,
  Segment,
  StageEvidenceReceipt,
} from '@linguist/cat-core'
import type { ProjectDatabase } from '@linguist/cat-store'
import type { TSchema } from 'typebox'
import { LinguistCatInvalidArgumentError } from './errors'
import type {
  CatSegmentListItem,
  LinguistCatToolMutation,
  LinguistCatToolName,
  LinguistCatToolsDeps,
  LinguistToolDefinition,
  LinguistToolResult,
  LinguistToolContent,
  ResolvedLinguistCatProject,
  CatReadVersion,
  CatReadState,
} from './types'
import { randomUUID } from 'node:crypto'

export const defineTool = <
  TParams extends TSchema,
  TDetails = unknown,
  TState = unknown,
>(
  tool: LinguistToolDefinition<TParams, TDetails, TState>,
) => tool

/** 导航元数据只携带首个句段锚点；content 自含模型所需正文，details 保留 UI 导航合同。 */
export function toolResult<TDetails extends object>(
  dto: TDetails,
  projectId?: string,
  segmentIds?: readonly string[],
): LinguistToolResult<TDetails> {
  const details: TDetails = projectId === undefined
    ? dto
    : {
        ...dto,
        projectId,
        ...(segmentIds?.[0] !== undefined
          ? { segmentId: segmentIds[0] }
          : {}),
      }
  return {
    content: [{
      type: 'text',
      text: JSON.stringify(details),
    }],
    details,
  }
}

export function toSegmentItem(segment: Segment): CatSegmentListItem {
  return {
    segmentId: segment.id as string,
    batchId: segment.assetId as string,
    originalOrdinal: segment.ordinal + 1,
    ...(segment.key !== undefined ? { key: segment.key } : {}),
    status: segment.status,
    locked: segment.locked,
    revision: segment.revision,
    source: segment.source,
    target: segment.target,
    ...(segment.context === undefined ? {} : { context: segment.context }),
  }
}

export interface CatToolRuntime {
  captureRead: (id: string, segments: readonly Segment[], fragment?: { hash: string; start: number; end: number; total: number }) => boolean
  readVersions: (snapshotIds: readonly string[], segmentIds: readonly string[], db: ProjectDatabase) => CatReadVersion[]
  newSnapshotId: () => string
  recordApplied: (snapshotIds: readonly string[], items: readonly { segmentId: string; baseRevision: number; revision: number }[]) => void
  prepareStage: NonNullable<LinguistCatToolsDeps['prepareStage']>
  deps: LinguistCatToolsDeps
  resolveBoundProject: (
    toolName: LinguistCatToolName,
    toolCallId: string,
  ) => ResolvedLinguistCatProject
  notifyMutation: (mutation: LinguistCatToolMutation) => void
  proposalProvenance: (
    toolCallId: string,
  ) => ProposalIssuanceInput & { toolCallId: string; runId: string }
  prepareEvidencePresentation: (
    db: ProjectDatabase,
    toolCallId: string,
    segmentIds: readonly string[],
    evidence: StageEvidenceReceipt['evidence'],
    content: LinguistToolContent[],
  ) => void
}

/** 把宿主 authority 与通知策略集中在一处，具体 Tool 只实现领域行为。 */
export function createCatToolRuntime(
  deps: LinguistCatToolsDeps,
): CatToolRuntime {
  const snapshots = deps.readSnapshots ?? new Map<string, CatReadState>()
  const proposalProvenance = (
    toolCallId: string,
  ): ProposalIssuanceInput & { toolCallId: string; runId: string } => {
    const provided: LinguistGenerationProvenance = deps.generationProvenance?.(toolCallId) ?? {}
    return {
      ...provided,
      ...(provided.sessionId === undefined && deps.sessionId !== undefined
        ? { sessionId: deps.sessionId }
        : {}),
      ...(provided.modelId === undefined && deps.modelId !== undefined
        ? { modelId: deps.modelId }
        : {}),
      toolCallId,
      runId:
        provided.runId
        ?? (deps.sessionId === undefined
          ? `tool:${toolCallId}`
          : `run:${deps.sessionId}:${toolCallId}`),
    }
  }
  return {
    deps,
    newSnapshotId: () => `read:${randomUUID()}`,
    captureRead(id, segments, fragment) {
      if (fragment) {
        const key = `fragments:${fragment.hash}:${fragment.total}`
        const previous = snapshots.get(key)
        const ranges = [...(previous?.kind === 'fragments' ? previous.ranges : []), { start: fragment.start, end: fragment.end }].sort((a, b) => a.start - b.start)
        snapshots.set(key, { kind: 'fragments', ranges })
        let end = 0
        for (const range of ranges) {
          if (range.start > end) break
          end = Math.max(end, range.end)
        }
        if (end !== fragment.total) return false
      }
      snapshots.set(id, { kind: 'snapshot', versions: segments.map(segment => ({
        segmentId: segment.id as string, revision: segment.revision, sourceHash: segment.sourceHash,
      })) })
      return true
    },
    readVersions(snapshotIds, segmentIds, db) {
      const reads = snapshotIds.map(id => {
        const snapshot = snapshots.get(id)
        if (snapshot?.kind !== 'snapshot') throw new LinguistCatInvalidArgumentError('snapshotIds', 'Read snapshot is unavailable in this session. Read the affected content again before deciding.')
        return snapshot.versions
      })
      const currentSegments = new Map(db.segments.getByIds(segmentIds).map(segment => [segment.id as string, segment]))
      return segmentIds.map(segmentId => {
        const versions = reads.flatMap(read => read.filter(version => version.segmentId === segmentId))
        if (!versions.length) throw new LinguistCatInvalidArgumentError('snapshotIds', `No complete read snapshot for ${segmentId}`)
        const first = versions[0]!
        if (versions.some(version => version.revision !== first.revision || version.sourceHash !== first.sourceHash)) {
          throw new LinguistCatInvalidArgumentError('snapshotIds', `Multiple read versions for ${segmentId}; specify the snapshot used for this decision`)
        }
        const current = currentSegments.get(segmentId)
        if (current !== undefined && current.sourceHash !== first.sourceHash) {
          throw new LinguistCatInvalidArgumentError('snapshotIds', `Source changed for ${segmentId}; reread this item before deciding. Other unchanged items retain their snapshots`)
        }
        return versions.find(version => version.appliedRevision !== undefined) ?? first
      })
    },
    recordApplied(snapshotIds, items) {
      for (const id of snapshotIds) {
        const snapshot = snapshots.get(id)
        if (snapshot?.kind !== 'snapshot') continue
        const applied = new Map(items.map(item => [item.segmentId, item]))
        const versions = snapshot.versions.map(version => {
          const item = applied.get(version.segmentId)
          return item?.baseRevision === version.revision ? { ...version, appliedRevision: item.revision } : version
        })
        if (versions.some((version, index) => version !== snapshot.versions[index])) snapshots.set(id, { kind: 'snapshot', versions })
      }
    },
    prepareStage(segmentIds, task) {
      deps.prepareStage?.(segmentIds, task)
      const scope = deps.reviewScopeSegmentIds
      if (scope !== undefined && segmentIds.some(id => !scope.includes(id))) {
        throw new LinguistCatInvalidArgumentError('segmentIds', 'outside the frozen task scope')
      }
    },
    resolveBoundProject(toolName, toolCallId) {
      const resolved = deps.resolveProject({ toolName, toolCallId })
      if (resolved instanceof Error) throw resolved
      return resolved
    },
    notifyMutation(mutation) {
      try {
        deps.onMutation?.(mutation)
      } catch (error) {
        // 写入已经提交；通知失败不能伪装成失败并诱发模型重复写。
        console.error('[Linguist] committed mutation notification failed', error)
      }
    },
    proposalProvenance,
    prepareEvidencePresentation(db, toolCallId, segmentIds, evidence, content) {
      if (db.readOnly || deps.stageEvidenceRunId === undefined || deps.onEvidencePrepared === undefined) return
      const state = db.stageEvidence.get(deps.stageEvidenceRunId)
      if (state === undefined) throw new Error('Host Stage Evidence state is missing')
      const provenance = proposalProvenance(toolCallId)
      const sessionId = provenance.sessionId ?? deps.sessionId
      if (sessionId === undefined) throw new Error('Host Stage Evidence session is missing')
      const planned = evidence.flatMap(item => {
        const requirement = state.plan.requirements.find(candidate => candidate.evidence.ref.kind === item.ref.kind
          && candidate.evidence.ref.id === item.ref.id)
        return requirement === undefined ? [] : [{ ...item, version: requirement.evidence.version }]
      })
      if (planned.length === 0) return
      deps.onEvidencePrepared({
        stageRunId: state.stageRunId,
        baselineHash: state.baseline.baselineHash,
        sessionId,
        generationRunId: provenance.runId,
        toolCallId,
        segmentIds: [...new Set(segmentIds)],
        evidence: planned,
      }, content)
    },
  }
}
