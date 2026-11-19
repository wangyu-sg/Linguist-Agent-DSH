import { Type } from 'typebox'
import { LinguistCatInvalidArgumentError } from './errors'
import { defineTool, toolResult, type CatToolRuntime } from './tool-runtime'

/** 当前 Agent 使用确定性扫描结果判断 Tag，不嵌套第二个模型。 */
export function createTagTools(runtime: CatToolRuntime) {
  const { deps, resolveBoundProject } = runtime

  const scanTool = defineTool({
    name: 'cat_scan_unknown_tag_patterns',
    label: 'Scan unknown tag patterns',
    description: 'Deterministically scan the bound project for unregistered bracket, brace, angle, dollar and custom escape shapes. Returns examples and preservation evidence; never activates a profile.',
    promptSnippet: 'Scan unknown tag-like patterns before proposing a project Tag Profile',
    parameters: Type.Object({
      batchIds: Type.Optional(Type.Array(Type.String(), { maxItems: 100 })),
      sampleLimit: Type.Optional(Type.Integer({ minimum: 1, maximum: 10 })),
    }),
    async execute(toolCallId, params) {
      const { db } = resolveBoundProject('cat_scan_unknown_tag_patterns', toolCallId)
      if (!deps.scanUnknownTagPatterns) {
        throw new LinguistCatInvalidArgumentError('batchIds', 'unknown Tag scanning is unavailable in this host')
      }
      let batches = params.batchIds
      if (deps.delegatedScopeSegmentIds || deps.taskGroupId) {
        const group = deps.taskGroupId ?? 'ungrouped'
        if (batches) db.taskGroups.assertContains(group, 'assets', batches)
        else batches = db.assets.listByProject().filter(asset => asset.taskGroupId === group).map(asset => asset.id)
      }
      return toolResult(
        { patterns: deps.scanUnknownTagPatterns(batches, params.sampleLimit), activated: false },
        deps.resultProjectId,
      )
    },
  })

  const saveTool = defineTool({
    name: 'cat_save_tag_profile_candidate',
    label: 'Save tag profile candidate',
    description: 'Validate and save a Tag Profile candidate in the bound project from scan evidence. It remains soft-protected unless activate=true was explicitly requested by the user.',
    promptSnippet: 'Save a validated project Tag Profile candidate',
    promptGuidelines: [
      'Do not set activate=true unless the user explicitly asked to automatically identify and lock high-confidence tags.',
    ],
    parameters: Type.Object({
      name: Type.String({ minLength: 1, maxLength: 80 }),
      regex: Type.String({ minLength: 1, maxLength: 240 }),
      kind: Type.Union([Type.Literal('standalone'), Type.Literal('opening'), Type.Literal('closing')]),
      pairKey: Type.Optional(Type.String({ minLength: 1, maxLength: 80 })),
      evidenceExampleIds: Type.Array(Type.String(), { minItems: 1, maxItems: 50 }),
      confidence: Type.Number({ minimum: 0, maximum: 1 }),
      explanation: Type.String({ minLength: 1, maxLength: 500 }),
      activate: Type.Optional(Type.Boolean()),
    }),
    async execute(toolCallId, params) {
      resolveBoundProject('cat_save_tag_profile_candidate', toolCallId)
      if (!deps.saveTagProfileCandidate) {
        throw new LinguistCatInvalidArgumentError('regex', 'Tag Profile persistence is unavailable in this host')
      }
      const result = deps.saveTagProfileCandidate({
        name: params.name,
        regex: params.regex,
        kind: params.kind,
        ...(params.pairKey === undefined ? {} : { pairKey: params.pairKey }),
        evidenceExampleIds: params.evidenceExampleIds,
        confidence: params.confidence,
        explanation: params.explanation,
      }, params.activate ?? false)
      runtime.notifyMutation({ kind: 'project-updated' })
      return toolResult(result, deps.resultProjectId)
    },
  })

  const exceptionTool = defineTool({
    name: 'cat_set_placeholder_exception',
    label: 'Set segment placeholder exception',
    description: 'Register or remove exact target-only named variables for one segment in the bound project. Requires a read Source snapshot, an explicit applicable project rule citation/quote, and a different segment in the same batch whose Source contains the variables. Check the item/field relationship before registering. Original Target, TM self-matches and model confidence are not authorization. Variables remain exact and required once registered; other segments, locales, source versions, tags and locks retain their checks. This does not edit Target, confirm a stage or waive QA. exception=null removes the registration.',
    promptSnippet: 'Register a source-backed, segment-specific variable exception required by a project rule',
    parameters: Type.Object({
      segmentId: Type.String({ minLength: 1 }),
      source: Type.String({ description: 'Exact current Source read for this segment.' }),
      exception: Type.Union([Type.Null(), Type.Object({
        placeholders: Type.Array(Type.String({ pattern: '^\\{[A-Za-z_][A-Za-z0-9_]*\\}$' }), { minItems: 1, maxItems: 32, uniqueItems: true }),
        ruleReference: Type.String({ minLength: 1, maxLength: 1000, description: 'Document/version and section or cell containing the applicable rule.' }),
        ruleQuote: Type.String({ minLength: 1, maxLength: 4000 }),
        evidenceSegmentId: Type.String({ minLength: 1, description: 'Related Source in this batch, not a TM record or Target.' }),
        reason: Type.String({ minLength: 1, maxLength: 2000, description: 'Verified item/field relationship and why the cited rule applies here.' }),
      })]),
    }),
    async execute(toolCallId, params) {
      resolveBoundProject('cat_set_placeholder_exception', toolCallId)
      runtime.prepareStage([params.segmentId])
      if (!deps.setPlaceholderException) {
        throw new LinguistCatInvalidArgumentError('exception', 'project placeholder exception persistence is unavailable in this host')
      }
      const exception = deps.setPlaceholderException(params)
      runtime.notifyMutation({ kind: 'project-updated' })
      return toolResult({ segmentId: params.segmentId, exception }, deps.resultProjectId, [params.segmentId])
    },
  })

  return [scanTool, saveTool, exceptionTool] as const
}
