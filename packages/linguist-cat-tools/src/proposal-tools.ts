import {
  analyzeBatchConsistency,
  createProposal,
  InvalidStateTransitionError,
  normalizeQaProfile,
  selectedConsistencyProposalInputs,
  type LinguistProject,
  type SegmentId,
} from '@linguist/cat-core'
import {
  buildQaTermOptions,
  StoreJobStateError,
  StoreNotFoundError,
  type ProjectDatabase,
} from '@linguist/cat-store'
import { Type } from 'typebox'
import { LinguistCatInvalidArgumentError } from './errors'
import {
  runConsistencyPlanWorkerJob,
  type WorkerJobProgress,
} from './job-runner'
import {
  type CatBatchConsistencyGroupItem,
  type CatApplyTranslationsResult,
  type CatConsistencyPlanResult,
  type CatCreateConsistencyProposalsResult,
  type CatProposeTranslationsResult,
  type LinguistConsistencyWorkerResult,
  type LinguistToolUpdateCallback,
} from './types'
import {
  defineTool,
  toolResult,
  type CatToolRuntime,
} from './tool-runtime'
import {
  buildProposalReviewSnapshot,
} from './proposal-snapshot'
import { recordReviewedWork, validateReviewedGroup } from './stage-tools'

const EMPTY_CONSISTENCY_NOTE =
  'No open consistency findings: the tracked repeated-source, terminology, and punctuation rules found nothing to repair.'

/** 提案与批次一致性修复建议。 */
export function createProposalTools(runtime: CatToolRuntime) {
  const {
    deps,
    notifyMutation,
    proposalProvenance,
    resolveBoundProject,
  } = runtime

  function assertDelegatedProposalScope(segmentIds: readonly string[]): void {
    const scope = deps.delegatedScopeSegmentIds
    if (scope === undefined) return
    const allowed = new Set(scope)
    const outside = segmentIds.find(id => !allowed.has(id))
    if (outside !== undefined) {
      throw new LinguistCatInvalidArgumentError(
        'segmentId',
        `${outside} is outside the delegated task scope`,
      )
    }
  }

  const getProposalSnapshotTool = defineTool({
    name: 'cat_get_proposal_snapshot',
    label: 'CAT get proposal snapshot',
    description:
      'Read one proposal candidate from the bound project as a fixed review snapshot with source, current target, ' +
      'proposed target, revision, context, evidence, producer provenance, and a SHA-256 snapshotHash. Read-only. ' +
      'A changed segment revision is reported as status stale.',
    promptSnippet: 'Read a fixed proposal snapshot before independent review',
    promptGuidelines: [
      'Submit reviews only against the returned snapshotId and snapshotHash.',
      'Do not review a stale snapshot; fetch a current candidate instead.',
    ],
    parameters: Type.Object({
      proposalId: Type.String({ minLength: 1 }),
    }),
    async execute(toolCallId, params) {
      const { db } = resolveBoundProject('cat_get_proposal_snapshot', toolCallId)
      const proposal = db.proposals.getById(params.proposalId)
      if (proposal === undefined) throw new StoreNotFoundError('proposal', params.proposalId)
      const snapshot = buildProposalReviewSnapshot(db, proposal)
      return toolResult(snapshot, deps.resultProjectId, [snapshot.segmentId])
    },
  })

  const applyTranslationsTool = defineTool({
    name: 'cat_apply_translations',
    label: 'CAT apply translations',
    description: 'Submit finalized edits using snapshotIds returned with the complete Source/Target actually read. The software supplies each base revision and returns real committed versions. Optionally declare reviewedSegmentIds to save edits and record a complete explicitly reviewed group in the same call; blockedSegmentIds remain unresolved. For an actually reused TM target, optionally include its tmUnitId in the same edit; it is counted only after a successful matching write. Use edits=[] for review without changes. No manual revision copying or per-item unchanged records. Failed edits are never confirmed. mode=proposal stores suggestions only and cannot declare reviewed completion. Existing scope, lock, tag, CAS and evidence protections apply. Group work by language/context, independent of read pages. Report-only tasks must not write.',
    promptSnippet: 'Save finalized work and explicitly reviewed coverage together, against immutable read snapshots',
    parameters: Type.Object({
      snapshotIds: Type.Array(Type.String({ minLength: 1 }), { minItems: 1, maxItems: 200 }),
      edits: Type.Array(Type.Object({
        segmentId: Type.String({ minLength: 1 }),
        target: Type.String({ minLength: 1 }),
        note: Type.Optional(Type.String({ maxLength: 2_000 })),
        tmUnitId: Type.Optional(Type.String({ minLength: 1, description: 'TM unit actually reused for this exact original or adapted target; counted only after successful application.' })),
      })),
      reviewedSegmentIds: Type.Optional(Type.Array(Type.String({ minLength: 1 }), { minItems: 1 })),
      blockedSegmentIds: Type.Optional(Type.Array(Type.String({ minLength: 1 }))),
      mode: Type.Optional(Type.Union([Type.Literal('apply'), Type.Literal('proposal')], { description: 'apply commits successful edits (default). proposal creates pending suggestions only, without accepting them or starting a professional Stage. Neither mode is appropriate for a chat-only/report-only request that disallows project writes.' })),
    }),
    async execute(toolCallId, params) {
      if (new Set(params.edits.map(edit => edit.segmentId)).size !== params.edits.length || (!params.edits.length && !params.reviewedSegmentIds?.length)) {
        throw new LinguistCatInvalidArgumentError('edits', 'expected unique edits or an explicit reviewed group')
      }
      const { project, db } = resolveBoundProject('cat_apply_translations', toolCallId)
      const mode = params.mode ?? 'apply'
      const reviewed = params.reviewedSegmentIds ?? []
      const blocked = params.blockedSegmentIds ?? []
      if (reviewed.length) validateReviewedGroup(reviewed, blocked)
      if (blocked.length && !reviewed.length) throw new LinguistCatInvalidArgumentError('blockedSegmentIds', 'requires reviewedSegmentIds')
      if (mode === 'proposal' && reviewed.length) throw new LinguistCatInvalidArgumentError('reviewedSegmentIds', 'pending suggestions do not complete professional review')
      if (mode === 'proposal' && params.edits.some(edit => edit.tmUnitId !== undefined)) throw new LinguistCatInvalidArgumentError('tmUnitId', 'pending suggestions do not record completed TM reuse')
      const ids = [...new Set([...params.edits.map(edit => edit.segmentId), ...reviewed])]
      if (mode === 'apply') {
        runtime.prepareStage(ids)
      } else {
        assertDelegatedProposalScope(params.edits.map(edit => edit.segmentId))
      }
      const provenance = proposalProvenance(toolCallId)
      const runId = provenance.runId
      const createdAt = deps.now?.()
      const mutation = db.runs.executeMutation({
        identity: {
          runId,
          toolCallId,
          idempotencyKey: `cat_apply_translations:${runId}:${toolCallId}`,
        },
        operation: 'cat_apply_translations',
        payload: params,
        mutate: () => {
          const versions = runtime.readVersions(params.snapshotIds, ids, db)
          const reads = new Map(versions.map(version => [version.segmentId, version]))
          const edits = params.edits.map(edit => ({ ...edit, baseRevision: reads.get(edit.segmentId)!.revision }))
          const before = new Map(
            db.segments.getByIds(params.edits.map((edit) => edit.segmentId))
              .map((segment) => [segment.id as string, segment]),
          )
          const dto: CatApplyTranslationsResult = edits.length ? db.proposals.applyTranslations(edits, {
            mode,
            ...(project.tagProfile === undefined ? {} : { tagProfile: project.tagProfile }),
            ...(provenance.modelId === undefined ? {} : { modelId: provenance.modelId }),
            ...(provenance.sessionId === undefined ? {} : { sessionId: provenance.sessionId }),
            runId,
            ...(createdAt === undefined ? {} : { now: createdAt }),
            issuance: {
              ...provenance,
              idempotencyKey: `cat_apply_translations:${runId}:${toolCallId}`,
              ...(createdAt === undefined ? {} : { createdAt }),
            },
          }) : { requested: 0, applied: 0, pending: 0, stale: [], locked: [], failed: [], proposalIds: [], appliedItems: [] }
          if (reviewed.length) dto.review = recordReviewedWork(runtime, db, versions.filter(version => reviewed.includes(version.segmentId)), blocked, dto.appliedItems, [
            ...dto.stale, ...dto.locked, ...dto.failed.map(item => item.segmentId),
          ])
          for (const applied of dto.appliedItems ?? []) {
            const edit = params.edits.find(item => item.segmentId === applied.segmentId)!
            if (edit.tmUnitId === undefined) continue
            const segment = before.get(applied.segmentId)!
            db.tmUnits.recordReuse(edit.tmUnitId, segment, edit.target, { runId, segmentId: applied.segmentId, revision: applied.revision, actor: deps.sessionId ?? 'unknown' })
          }
          const proposals = dto.proposalIds.flatMap((id) => {
            const proposal = db.proposals.getById(id)
            return proposal === undefined ? [] : [proposal]
          })
          const changedSegments = proposals.flatMap((proposal) => {
            if (proposal.status !== 'accepted') return []
            const previous = before.get(proposal.segmentId as string)
            const current = db.segments.getById(proposal.segmentId)
            return previous === undefined || current === undefined ? [] : [{ previous, current }]
          })
          const changes = [
            ...proposals.map((proposal) => ({
              entityType: 'proposal' as const,
              entityId: proposal.id as string,
              changeKind: 'created' as const,
              segmentId: proposal.segmentId as string,
              expectedRevision: proposal.baseRevision,
              after: proposal,
            })),
            ...changedSegments.map(({ previous, current }) => ({
              entityType: 'segment' as const,
              entityId: current.id as string,
              changeKind: 'updated' as const,
              segmentId: current.id as string,
              expectedRevision: current.revision,
              before: previous,
              after: current,
            })),
          ]
          return {
            result: dto,
            changes,
            ...(changes.length === 0 && !dto.review?.decisions.length ? {} : {
              event: {
                kind: mode === 'proposal' ? 'proposal-created' as const : 'project-updated' as const,
                segmentIds: [...new Set([...proposals.map((proposal) => proposal.segmentId as string), ...dto.review?.decisions.map(item => item.segmentId) ?? []])],
                proposalIds: dto.proposalIds,
              },
            }),
          }
        },
      })
      runtime.recordApplied(params.snapshotIds, mutation.result.appliedItems ?? [])
      if (!mutation.replayed && mutation.event !== undefined) {
        notifyMutation({
          kind: mode === 'proposal' ? 'proposal-created' : 'project-updated',
          sequence: mutation.event.sequence,
          segmentIds: mutation.event.segmentIds,
          proposalIds: mutation.event.proposalIds,
        })
      }
      return toolResult(mutation.result, deps.resultProjectId, mutation.event?.segmentIds)
    },
  })

  const proposeTranslationsTool = defineTool({
    name: 'cat_propose_translations',
    label: 'CAT propose translations',
    description: 'Create pending translation proposals against snapshotIds returned by a complete Source/Target read. The software supplies base revisions. This does not accept suggestions, change Target, confirm review or create a professional Stage. Use only when stored suggestions are authorized; report-only/chat-only tasks use chat output. Existing 1-50 limit, locks, structure checks, atomicity and delegated scope apply.',
    promptSnippet: 'Propose translations for review without changing segments',
    parameters: Type.Object({
      snapshotIds: Type.Array(Type.String({ minLength: 1 }), { minItems: 1, maxItems: 200 }),
      segmentProposals: Type.Array(
        Type.Object({
          segmentId: Type.String({ minLength: 1 }),
          proposedTarget: Type.String({ minLength: 1 }),
          evidenceRefs: Type.Optional(Type.Array(Type.String())),
          termRefs: Type.Optional(Type.Array(Type.String())),
          warnings: Type.Optional(Type.Array(Type.String())),
        }),
        { minItems: 1, maxItems: 50 },
      ),
    }),
    async execute(toolCallId, params) {
      if (params.segmentProposals.length < 1 || params.segmentProposals.length > 50) {
        throw new LinguistCatInvalidArgumentError('segmentProposals', 'expected 1-50 items')
      }
      const { project, db } = resolveBoundProject('cat_propose_translations', toolCallId)
      assertDelegatedProposalScope(params.segmentProposals.map(proposal => proposal.segmentId))
      for (const input of params.segmentProposals) {
        if (input.proposedTarget.trim() === '') {
          throw new LinguistCatInvalidArgumentError('proposedTarget', 'expected a non-empty translation')
        }
      }
      const provenance = proposalProvenance(toolCallId)
      const runId = provenance.runId
      const createdAt = deps.now?.()
      const mutation = db.runs.executeMutation({
        identity: {
          runId,
          toolCallId,
          idempotencyKey: `cat_propose_translations:${runId}:${toolCallId}`,
        },
        operation: 'cat_propose_translations',
        payload: params,
        mutate: () => {
          const versions = new Map(runtime.readVersions(params.snapshotIds, params.segmentProposals.map(input => input.segmentId), db).map(item => [item.segmentId, item]))
          const proposalInputs = params.segmentProposals.map((input) => ({
            segmentId: input.segmentId as SegmentId,
            baseRevision: versions.get(input.segmentId)!.revision,
            proposedTarget: input.proposedTarget,
            ...(input.evidenceRefs !== undefined ? { evidenceRefs: input.evidenceRefs } : {}),
            ...(input.termRefs !== undefined ? { termRefs: input.termRefs } : {}),
            ...(input.warnings !== undefined ? { warnings: input.warnings } : {}),
            ...(provenance.modelId !== undefined ? { modelId: provenance.modelId } : {}),
            ...(provenance.sessionId !== undefined ? { sessionId: provenance.sessionId } : {}),
            runId,
            ...(createdAt !== undefined ? { now: createdAt } : {}),
          }))
          const existingProposalIds = new Set(
            proposalInputs
              .map((input) => createProposal(input).id as string)
              .filter((id) => db.proposals.getById(id)?.status === 'pending'),
          )
          let proposals
          try {
            proposals = db.proposals.insertPendingMany(proposalInputs, {
              ...(project.tagProfile !== undefined ? { tagProfile: project.tagProfile } : {}),
              issuance: {
                ...provenance,
                idempotencyKey: `cat_propose_translations:${runId}:${toolCallId}`,
                ...(createdAt === undefined ? {} : { createdAt }),
              },
            })
          } catch (error) {
            if (
              error instanceof InvalidStateTransitionError
              && error.entity === 'proposal-hard-rules'
            ) {
              throw new LinguistCatInvalidArgumentError('proposedTarget', error.from)
            }
            throw error
          }
          const createdProposals = proposals.filter(
            (proposal) => !existingProposalIds.has(proposal.id as string),
          )
          const dto: CatProposeTranslationsResult = {
            runId,
            proposalIds: proposals.map((proposal) => proposal.id as string),
          }
          return {
            result: dto,
            changes: createdProposals.map((proposal) => ({
              entityType: 'proposal' as const,
              entityId: proposal.id as string,
              changeKind: 'created' as const,
              segmentId: proposal.segmentId as string,
              expectedRevision: proposal.baseRevision,
              after: proposal,
            })),
            ...(createdProposals.length === 0
              ? {}
              : {
                  event: {
                    kind: 'proposal-created' as const,
                    segmentIds: [...new Set(
                      createdProposals.map((proposal) => proposal.segmentId as string),
                    )],
                    proposalIds: createdProposals.map((proposal) => proposal.id as string),
                  },
                }),
          }
        },
      })
      const dto = mutation.result
      if (!mutation.replayed && mutation.event !== undefined) {
        notifyMutation({
          kind: 'proposal-created',
          sequence: mutation.event.sequence,
          segmentIds: mutation.event.segmentIds,
          proposalIds: mutation.event.proposalIds,
        })
      }
      return toolResult(
        dto,
        deps.resultProjectId,
        params.segmentProposals.map((proposal) => proposal.segmentId),
      )
    },
  })

  const acceptProposalsTool = defineTool({
    name: 'cat_accept_proposals',
    label: 'CAT accept proposals',
    description: 'Accept explicitly authorized pending proposals using the existing revision, lock, structure and issuance checks. Do not auto-accept when the user requested suggestions or a report. Acceptance updates Target but does not by itself certify a professional stage; a professional execution task still needs valid decisions and required evidence. Use the current proposal snapshot where relevant; stale proposals require current data rather than overriding revision checks.',
    promptSnippet: 'Apply validated pending proposals to CAT segments',
    parameters: Type.Object({
      proposals: Type.Array(Type.Object({
        proposalId: Type.String({ minLength: 1 }),
        expectedRevision: Type.Integer({ minimum: 0 }),
      }), { minItems: 1, maxItems: 50 }),
    }),
    async execute(toolCallId, params) {
      const { project, db } = resolveBoundProject('cat_accept_proposals', toolCallId)
      runtime.prepareStage(params.proposals.map(item => {
        const proposal = db.proposals.getById(item.proposalId)
        if (proposal === undefined) throw new StoreNotFoundError('proposal', item.proposalId)
        return proposal.segmentId
      }))
      const mutation = db.proposals.acceptSelected(
        params.proposals,
        `cat_accept_proposals:${deps.sessionId ?? 'session-unavailable'}:${toolCallId}`,
        project.tagProfile === undefined ? {} : { tagProfile: project.tagProfile },
      )
      if (!mutation.ok) {
        throw new LinguistCatInvalidArgumentError('proposals', 'revision conflict; refresh segments and proposals')
      }
      const accepted = mutation.result.map(({ proposal, segment }) => ({
        proposalId: proposal.id as string,
        segmentId: segment.id as string,
        revision: segment.revision,
        status: segment.status,
      }))
      if (!mutation.replayed) {
        notifyMutation({
          kind: 'project-updated',
          segmentIds: accepted.map((item) => item.segmentId),
          proposalIds: accepted.map((item) => item.proposalId),
        })
      }
      return toolResult({ accepted, replayed: mutation.replayed }, deps.resultProjectId, accepted.map((item) => item.segmentId))
    },
  })


  const readConsistencyPlan = async (
    project: LinguistProject,
    db: ProjectDatabase,
    operation: 'plan' | 'apply',
    toolCallId: string,
    signal?: AbortSignal,
    onUpdate?: LinguistToolUpdateCallback<unknown>,
  ) => {
    const filter = { taskGroupId: deps.taskGroupId ?? 'ungrouped', segmentIds: deps.delegatedScopeSegmentIds ?? deps.reviewScopeSegmentIds }
    const total = db.segments.count(filter)
    const segments = total === 0 ? [] : db.segments.query({ ...filter, limit: total })
    const request = {
      segments,
      options: {
        ...buildQaTermOptions(db, segments),
        glossaryPolicy: project.glossaryPolicy,
        profile: normalizeQaProfile(project.qaProfile),
        ...(project.tagProfile !== undefined ? { tagProfile: project.tagProfile } : {}),
      },
      persistedFindings: db.qaFindings.list({ ...filter, status: 'open' }),
    }
    const worker = deps.consistencyWorker ?? (async () => ({
      pass: analyzeBatchConsistency(request),
      workerThreadId: 0,
    }))
    let latestProgress: WorkerJobProgress | undefined
    const publish = (text: string): void => {
      onUpdate?.({
        content: [{ type: 'text', text }],
        details: latestProgress === undefined ? undefined : { jobProgress: latestProgress },
      })
    }
    const compute = (workerSignal?: AbortSignal) => worker(
      request,
      workerSignal,
      (phase) => publish(`CAT consistency worker ${phase}`),
    )
    const jobSegmentIds = segments
      .filter((segment) => !segment.locked)
      .map((segment) => segment.id as string)
    let workerResult: LinguistConsistencyWorkerResult
    if (db.readOnly || jobSegmentIds.length === 0) {
      workerResult = await compute(signal)
    } else {
      const runId =
        `consistency-${operation}:${deps.sessionId ?? 'session-unavailable'}:${toolCallId}`
      workerResult = await runConsistencyPlanWorkerJob({
        db,
        runId,
        sessionId: deps.sessionId ?? 'session-unavailable',
        segmentIds: jobSegmentIds,
        ...(deps.modelId === undefined ? {} : { modelId: deps.modelId }),
        signal,
        onProgress: (next) => {
          latestProgress = next
          publish(`CAT consistency job ${next.status}: ${next.cursor}/${next.total}`)
        },
        compute: async (_job, workerSignal) => ({ result: await compute(workerSignal) }),
        commit: (result, job) => {
          if (job.failedSegmentIds.length > 0) {
            throw new StoreJobStateError(
              job.jobId,
              'consistency snapshot changed while the worker was running',
            )
          }
          return result
        },
      })
    }
    const pass = workerResult.pass
    const groups: CatBatchConsistencyGroupItem[] = pass.groups.map((group) => ({
      groupId: group.groupId,
      source: group.source,
      normalizedSource: group.normalizedSource,
      segmentIds: group.segmentIds.map((id) => id as string),
      findingIds: group.findingIds.map((id) => id as string),
      candidateTargets: group.candidateTargets,
      dimensions: {
        batchIds: group.dimensions.assetIds,
        contextKeys: group.dimensions.contextKeys,
        domains: group.dimensions.domains,
        stringTypes: group.dimensions.stringTypes,
        speakers: group.dimensions.speakers,
      },
      findings: group.findings.map((finding) => ({
        findingId: finding.findingId as string,
        segmentId: finding.segmentId as string,
        code: finding.code,
        severity: finding.severity,
        message: finding.message,
        locked: finding.locked,
      })),
    }))
    return { groups, pass }
  }

  const planConsistencyRepairsTool = defineTool({
    name: 'cat_plan_consistency_repairs',
    label: 'CAT plan consistency repairs',
    description:
      'Read consistency findings in the bound CAT project and return normalized-source groups, candidate target counts, context dimensions, ' +
      'and a snapshot-bound planId. This tool is strictly read-only: candidate counts are evidence, not truth, and ' +
      'it never creates proposals or changes segments.',
    promptSnippet: 'Plan consistency repairs without writing',
    promptGuidelines: [
      'Treat candidate counts as advisory evidence, never as an automatic majority decision.',
      'Planning writes nothing; use cat_create_consistency_proposals with an explicit target and segment selection.',
    ],
    parameters: Type.Object({}),
    async execute(toolCallId, _params, signal, onUpdate) {
      const { project, db } = resolveBoundProject('cat_plan_consistency_repairs', toolCallId)
      const { groups, pass } = await readConsistencyPlan(
        project,
        db,
        'plan',
        toolCallId,
        signal,
        onUpdate,
      )
      const dto: CatConsistencyPlanResult = {
        planId: pass.planId,
        findingCount: pass.findingCount,
        groupCount: groups.length,
        groups,
        ...(pass.findingCount === 0 ? { note: EMPTY_CONSISTENCY_NOTE } : {}),
      }
      return toolResult(
        dto,
        deps.resultProjectId,
        groups.flatMap((group) => group.segmentIds),
      )
    },
  })

  const createConsistencyProposalsTool = defineTool({
    name: 'cat_create_consistency_proposals',
    label: 'CAT create consistency proposals',
    description:
      'Create pending consistency proposals in the bound CAT project from a current planId and explicit group, target, and segment selections. ' +
      'The plan is recomputed and stale plans fail closed. Locked/out-of-group segments and deterministic hard-rule ' +
      'violations reject the whole call atomically. Segment targets and revisions are never changed.',
    promptSnippet: 'Create explicitly selected consistency proposals',
    promptGuidelines: [
      'Choose every proposed target explicitly; never infer that the most frequent candidate is correct.',
      'This creates pending proposals; apply them with cat_accept_proposals only after checking the selection.',
    ],
    parameters: Type.Object({
      planId: Type.String({ minLength: 1 }),
      selections: Type.Array(Type.Object({
        groupId: Type.String({ minLength: 1 }),
        proposedTarget: Type.String({ minLength: 1 }),
        segmentIds: Type.Array(Type.String({ minLength: 1 }), { minItems: 1, maxItems: 50 }),
      }), { minItems: 1, maxItems: 50 }),
    }),
    async execute(toolCallId, params, signal, onUpdate) {
      const selectedCount = params.selections.reduce(
        (sum, selection) => sum + selection.segmentIds.length,
        0,
      )
      if (selectedCount > 50) {
        throw new LinguistCatInvalidArgumentError('selections', 'expected at most 50 selected segments')
      }
      const { project, db } = resolveBoundProject('cat_create_consistency_proposals', toolCallId)
      const { pass } = await readConsistencyPlan(
        project,
        db,
        'apply',
        toolCallId,
        signal,
        onUpdate,
      )
      if (params.planId !== pass.planId) {
        throw new LinguistCatInvalidArgumentError('planId', 'stale consistency plan; plan again')
      }
      let selectedInputs
      try {
        selectedInputs = selectedConsistencyProposalInputs(pass, params.selections.map((selection) => ({
          ...selection,
          segmentIds: selection.segmentIds as SegmentId[],
        })))
      } catch (error) {
        throw new LinguistCatInvalidArgumentError(
          'selections',
          error instanceof Error ? error.message : 'invalid consistency selection',
        )
      }
      const provenance = proposalProvenance(toolCallId)
      const runId = provenance.runId
      const createdAt = deps.now?.()
      const proposalInputs = selectedInputs.map((input) => ({
        ...input,
        ...(provenance.modelId !== undefined ? { modelId: provenance.modelId } : {}),
        ...(provenance.sessionId !== undefined ? { sessionId: provenance.sessionId } : {}),
        runId,
        ...(createdAt !== undefined ? { now: createdAt } : {}),
      }))
      const mutation = db.runs.executeMutation({
        identity: {
          runId,
          toolCallId,
          idempotencyKey:
            `cat_create_consistency_proposals:${deps.sessionId ?? 'session-unavailable'}:${toolCallId}`,
        },
        operation: 'cat_create_consistency_proposals',
        payload: params,
        mutate: () => {
          const existingProposalIds = new Set(
            proposalInputs
              .map((input) => createProposal(input).id as string)
              .filter((id) => db.proposals.getById(id)?.status === 'pending'),
          )
          let proposals
          try {
            proposals = db.proposals.insertPendingMany(proposalInputs, {
              ...(project.tagProfile !== undefined ? { tagProfile: project.tagProfile } : {}),
              issuance: {
                ...provenance,
                idempotencyKey: `cat_create_consistency_proposals:${runId}:${toolCallId}`,
                ...(createdAt === undefined ? {} : { createdAt }),
              },
            })
          } catch (error) {
            if (
              error instanceof InvalidStateTransitionError
              && error.entity === 'proposal-hard-rules'
            ) {
              throw new LinguistCatInvalidArgumentError('selections', error.from)
            }
            throw error
          }
          const createdProposals = proposals.filter(
            (proposal) => !existingProposalIds.has(proposal.id as string),
          )
          const dto: CatCreateConsistencyProposalsResult = {
            planId: pass.planId,
            runId,
            proposalIds: proposals.map((proposal) => proposal.id as string),
          }
          return {
            result: dto,
            changes: createdProposals.map((proposal) => ({
              entityType: 'proposal' as const,
              entityId: proposal.id as string,
              changeKind: 'created' as const,
              segmentId: proposal.segmentId as string,
              expectedRevision: proposal.baseRevision,
              after: proposal,
            })),
            ...(createdProposals.length === 0
              ? {}
              : {
                  event: {
                    kind: 'proposal-created' as const,
                    segmentIds: [...new Set(
                      createdProposals.map((proposal) => proposal.segmentId as string),
                    )],
                    proposalIds: createdProposals.map((proposal) => proposal.id as string),
                  },
                }),
          }
        },
      })
      if (!mutation.replayed && mutation.event !== undefined) {
        notifyMutation({
          kind: 'proposal-created',
          sequence: mutation.event.sequence,
          segmentIds: mutation.event.segmentIds,
          proposalIds: mutation.event.proposalIds,
        })
      }
      return toolResult(
        mutation.result,
        deps.resultProjectId,
        selectedInputs.map((input) => input.segmentId as string),
      )
    },
  })

  return [
    getProposalSnapshotTool,
    applyTranslationsTool,
    proposeTranslationsTool,
    acceptProposalsTool,
    planConsistencyRepairsTool,
    createConsistencyProposalsTool,
  ] as const
}
