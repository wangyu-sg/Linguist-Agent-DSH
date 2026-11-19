import { randomUUID } from 'node:crypto'
import { realpathSync } from 'node:fs'
import { isAbsolute, relative } from 'node:path'
import type { Agent, AgentOptions } from '@deepseek-ai/dsh-agent'
import { ReasoningEffortId, type LlmRuntime } from '@deepseek-ai/dsh-llm'
import { SessionId } from '@deepseek-ai/dsh-session'
import type { SubagentRuntime } from '@deepseek-ai/dsh-subagent'
import type { ToolDefinition } from '@deepseek-ai/dsh-tools'
import { prepareReviewMaterials, workingCopyPath, type LinguistProjectService, type ReviewMaterialsInput } from '@linguist/domain-service'
import { Type } from 'typebox'
import { Value } from 'typebox/value'
import type { LinguistWorkMode, SessionBinding } from './bindings'
import { resolveExecutionProfile } from './execution-profile'
import { freezeLinguistDelegation } from './delegation'
import type { LinguistDelegationControl } from './delegation-control'
import { deliverDelegationInputs, preflightDelegationInputs } from './delegation-inputs'

const parameters = Type.Object({
  role: Type.Union([Type.Literal('translator'), Type.Literal('reviewer'), Type.Literal('proofreader')]),
  objective: Type.String({ minLength: 1, maxLength: 10000, description: 'State the task, source purpose and client requirements with their sources and scope. Label parent drafts and suggestions as provisional. Do not prescribe a review verdict or require reuse of a model draft.' }),
  provider: Type.Optional(Type.String({ minLength: 1 })),
  model: Type.Optional(Type.String({ minLength: 1 })),
  reasoningEffort: Type.Optional(Type.String({ minLength: 1 })),
  scope: Type.Optional(Type.Object({
    batchIds: Type.Optional(Type.Array(Type.String(), { maxItems: 200 })),
    segmentIds: Type.Optional(Type.Array(Type.String(), { maxItems: 2000 })),
    sourcePath: Type.Optional(Type.String({ minLength: 1 })),
    snapshotPath: Type.Optional(Type.String({ minLength: 1 })),
    previousResultPath: Type.Optional(Type.String({ minLength: 1 })),
    sourceLocale: Type.Optional(Type.String({ minLength: 2 })),
    targetLocale: Type.Optional(Type.String({ minLength: 2 })),
    outputDir: Type.Optional(Type.String({ minLength: 1 })),
    referenceFiles: Type.Optional(Type.Array(Type.Object({ path: Type.String({ minLength: 1 }), kind: Type.Union([Type.Literal('tm'), Type.Literal('terms')]),
      xlsxMapping: Type.Optional(Type.Object({ sheetName: Type.String({ minLength: 1 }), columns: Type.Object({ source: Type.String({ minLength: 1 }), target: Type.String({ minLength: 1 }) }) })) }))),
    contextFiles: Type.Optional(Type.Array(Type.String({ minLength: 1 }), { description: 'Original spreadsheets, presentations or images with visual context, relative to the Workspace.' })),
    online: Type.Optional(Type.Object({ fileId: Type.Optional(Type.String({ minLength: 1, description: 'Stable platform file or job identifier for this batch.' })), url: Type.String({ minLength: 1 }), expectedSegments: Type.Integer({ minimum: 1 }), observedAt: Type.String({ minLength: 1 }) })),
  })),
  inputs: Type.Optional(Type.Array(Type.Object({
    path: Type.String({ minLength: 1 }),
    purpose: Type.String({ minLength: 1, maxLength: 500 }),
    required: Type.Boolean(),
    expectedSha256: Type.Optional(Type.String()),
    snapshot: Type.Optional(Type.Boolean()),
  }))),
  reportOnly: Type.Optional(Type.Boolean({ description: 'True for observations only; no translation or stage writes.' })),
  expectedOutcome: Type.Optional(Type.String({ minLength: 1, maxLength: 4000 })),
})

const messageParameters = Type.Object({
  childSessionId: Type.String({ minLength: 1 }),
  message: Type.String({ minLength: 1, maxLength: 10000 }),
})
const childParameters = Type.Object({ childSessionId: Type.String({ minLength: 1 }) })

function output() {
  return {
    schema: { type: 'object' as const, additionalProperties: true },
    render(_args: unknown, value: unknown) { return [{ type: 'text' as const, text: JSON.stringify(value) }] },
  }
}

export function createLinguistDelegationTool(input: {
  service: LinguistProjectService
  binding: SessionBinding
  agent: Agent
  subagents: Pick<SubagentRuntime, 'resolveMaxDepth' | 'startActivation'>
  control: LinguistDelegationControl
  llm?: Pick<LlmRuntime, 'resolveModelInfo' | 'resolveCallConfig'>
  resolveSessionWorkspace: () => Promise<{ workspaceRoot: string }>
  selectWorkMode: (recommended: LinguistWorkMode, signal: AbortSignal) => Promise<LinguistWorkMode | undefined>
  reserveIntent: (childSessionId: string, binding: SessionBinding) => () => void
}): { tool: ToolDefinition; messageTool: ToolDefinition; listTool: ToolDefinition; interruptTool: ToolDefinition } {
  const tool: ToolDefinition = {
    name: 'linguist_delegate',
    description: 'Delegate translation, independent review or proofreading in CAT, working-copy or browser mode. Choose the professional role and objective. For CAT provide batchIds or segmentIds; for a file provide sourcePath, language pair, optional previousResultPath and this task’s TM/TB referenceFiles; for online review provide its export or snapshotPath with online metadata. Include original spreadsheets, presentations or images as inputs or contextFiles. Bilingual materials, selected TM/TB, semantic associations and image locations are prepared once and handed to the child automatically. A question requiring a professional child can omit scope. The host supplies the approved model and effort. Omit model overrides. Starting a child is not review completion.',
    parameters: JSON.parse(JSON.stringify(parameters)) as Record<string, unknown>, output: output(),
    async execute(args, exec) {
      if (!Value.Check(parameters, args)) throw new Error(`Invalid linguist_delegate arguments: ${Value.Errors(parameters, args)[0]?.message}`)
      if (exec.agent !== input.agent) throw new Error('Delegation caller is not the bound DSH Agent')
      const call = args as {
        role: 'translator' | 'reviewer' | 'proofreader'; objective: string; expectedOutcome?: string; reportOnly?: boolean
        provider?: string; model?: string; reasoningEffort?: string
        scope?: Omit<ReviewMaterialsInput, 'workspaceRoot' | 'taskId' | 'projectId'>
        inputs?: Array<{ path: string; purpose: string; required: boolean; expectedSha256?: string; snapshot?: boolean }>
      }
      const { workspaceRoot } = await input.resolveSessionWorkspace()
      const scope = call.scope ?? {}
      const fileTask = Boolean(scope.sourcePath || scope.snapshotPath)
      if (fileTask || scope.batchIds?.length || scope.segmentIds?.length) {
        const requested = fileTask ? scope.online ? 'browser' : 'working-copy' : 'cat'
        const selected = await input.selectWorkMode(requested, exec.signal)
        if (!selected) return { status: 'choose-work-mode' }
        if (selected !== requested) return { status: 'use-selected-work-mode', workMode: selected }
      }
      const childBinding = freezeLinguistDelegation(input.service, input.binding, {
        role: call.role,
        ...(fileTask ? { fileMode: scope.online ? 'browser' as const : 'working-copy' as const }
          : scope.batchIds || scope.segmentIds ? { scope: { assetIds: scope.batchIds, segmentIds: scope.segmentIds } } : {}),
      })
      childBinding.reportOnly = input.binding.reportOnly || call.reportOnly
      const file = scope.sourcePath ?? scope.snapshotPath
      if (file) childBinding.professionalSource = relative(realpathSync(workspaceRoot), workingCopyPath(workspaceRoot, file))
      const selection = input.agent.model?.current()
      const nativeSelection = input.agent.session?.ownEvents().findLast(event => event.type === 'model/selection')
      const inherited = input.binding.executionProfile
      const inheritedRoleDefault = inherited?.source === 'la-role-default'
        && selection?.provider === inherited.provider && selection?.model === inherited.model && selection?.reasoningEffort === inherited.resolvedEffort
      const userSelected = nativeSelection !== undefined && !inheritedRoleDefault
      const asserted = { provider: call.provider, model: call.model, reasoningEffort: call.reasoningEffort === undefined ? undefined : ReasoningEffortId(call.reasoningEffort) }
      const childSelection = inheritedRoleDefault && selection && !asserted.reasoningEffort ? { ...selection, reasoningEffort: undefined } : selection
      const resolved = childSelection && input.llm ? await resolveExecutionProfile(input.llm, childSelection, call.role,
        input.binding.useRoleDefaults === true, userSelected, asserted, exec.signal) : undefined
      if (!resolved && (call.provider !== undefined || call.model !== undefined || call.reasoningEffort !== undefined)) throw new Error('当前会话没有可验证的模型配置')
      childBinding.executionProfile = resolved?.profile
      const preflight = await preflightDelegationInputs(call.inputs ?? [], workspaceRoot)
      if (!preflight.ready) return { status: 'blocked-input', inputs: preflight.items.map(item => item.receipt) }
      const receipts = await deliverDelegationInputs(preflight.items, workspaceRoot, String(exec.callId))
      const referencePaths = new Set(scope.referenceFiles?.map(file => file.path))
      const contextFiles = [...new Set([...(scope.contextFiles ?? []), ...receipts.filter(item => item.usablePath && !referencePaths.has(item.requestedPath))
        .map(item => isAbsolute(item.usablePath!) ? relative(realpathSync(workspaceRoot), item.usablePath!) : item.usablePath!)])]
      const review = fileTask || childBinding.delegatedScope?.segmentIds.length ? await prepareReviewMaterials(input.service, {
        ...scope, contextFiles, workspaceRoot, taskGroupId: childBinding.taskGroupId, taskId: String(input.agent.id),
        ...(childBinding.projectId ? { projectId: childBinding.projectId } : {}),
        ...(childBinding.delegatedScope ? { batchIds: undefined, segmentIds: [...childBinding.delegatedScope.segmentIds] } : {}),
      }, exec.signal, (id, versions) => { childBinding.reviewSnapshot = { id, versions } }) : undefined
      const childId = SessionId(randomUUID())
      const release = input.reserveIntent(childId, childBinding)
      try {
        const prompt = [
          'Parent drafts and conclusions are review inputs, not client approval. Verify claimed client constraints against their cited sources and scope; perform the assigned role independently, including necessary terminology and factual research.',
          `Objective: ${call.objective}`,
          ...(call.expectedOutcome ? [`Expected outcome: ${call.expectedOutcome}`] : []),
          `Linguist role: ${childBinding.role}; mode: ${childBinding.workMode}.`,
          ...(childBinding.reportOnly ? ['Deliver observations only. Leave targets and stage confirmations untouched.'] : []),
          ...(childBinding.delegatedScope?.segmentIds.length ? [`Scope: ${childBinding.delegatedScope.segmentIds.length} segments.`] : []),
          ...(review ? [
            '[LA prepared review materials]',
            `${review.readingContent ? 'The first normal review group is included below; do not fetch it again.' : 'The first group is too long for inline delivery; read it from the files below.'} These materials contain exact IDs, current bilingual text, related comparisons and references. Read these files in order: ${JSON.stringify(review.continuationPaths)}. Do not separately query semantic groups. Full index: ${review.readingPath}.`,
            review.readingContent,
          ] : []),
          ...(receipts.length ? [`Relevant inputs: ${JSON.stringify(receipts.map(({ requestedPath, purpose, state, usablePath }) => ({ path: usablePath ?? requestedPath, purpose, state })))}.`] : []),
          'Inspect necessary original images; batch image reads when practical. Report missing evidence and unresolved issues. Materials are not proof of completed review.',
        ].join('\n')
        const maxDepth = input.subagents.resolveMaxDepth()
        const agentOptions: AgentOptions = resolved?.options ?? {}
        const accepted = await input.subagents.startActivation({
          provider: 'spawn', delivery: 'parent', childId, label: call.objective.slice(0, 120),
          parent: input.agent, prompt: [{ type: 'text', text: prompt }],
          ...(Object.keys(agentOptions).length ? { agentOptions } : {}),
          ...(maxDepth === undefined ? {} : { maxDepth }),
          signal: exec.signal,
        })
        return {
          status: 'started', childSessionId: accepted.childId, messageId: accepted.messageId,
          ...(childBinding.delegatedScope ? { scope: childBinding.delegatedScope } : {}),
          ...(receipts.some(item => item.state === 'missing') ? { missingInputs: receipts.filter(item => item.state === 'missing').map(item => item.requestedPath) } : {}),
        }
      } finally { release() }
    },
  }

  const messageTool: ToolDefinition = {
    name: 'linguist_delegation_message',
    description: 'Send a follow-up message to a direct continuable Linguist child through DSH. Acceptance does not mean the child finished. Cancelling this wait does not interrupt the child.',
    parameters: JSON.parse(JSON.stringify(messageParameters)) as Record<string, unknown>, output: output(),
    async execute(args, exec) {
      if (!Value.Check(messageParameters, args)) throw new Error('Invalid Linguist child message')
      if (exec.agent !== input.agent) throw new Error('Delegation sender is not the bound DSH Agent')
      const call = args as { childSessionId: string; message: string }
      return input.control.sendMessage(input.agent, call.childSessionId, call.message, exec.signal)
    },
  }

  const listTool: ToolDefinition = {
    name: 'linguist_delegations_list',
    description: 'List direct continuable Linguist children and their current professionalOutcome over the full frozen CAT scope. The outcome includes current-revision decisions and required evidence coverage; native child completion alone does not prove professional completion.',
    parameters: { type: 'object', properties: {}, additionalProperties: false }, output: output(),
    async execute(_args, exec) {
      if (exec.agent !== input.agent) throw new Error('Delegation caller is not the bound DSH Agent')
      return input.control.list(input.agent.id)
    },
  }

  const interruptTool: ToolDefinition = {
    name: 'linguist_delegation_interrupt',
    description: 'Interrupt only the current turn of a direct continuable Linguist child through DSH. The child Session and queued work remain resumable.',
    parameters: JSON.parse(JSON.stringify(childParameters)) as Record<string, unknown>, output: output(),
    async execute(args, exec) {
      if (!Value.Check(childParameters, args)) throw new Error('Invalid Linguist child address')
      if (exec.agent !== input.agent) throw new Error('Delegation caller is not the bound DSH Agent')
      return input.control.interrupt(input.agent.id, (args as { childSessionId: string }).childSessionId, input.agent)
    },
  }

  return { tool, messageTool, listTool, interruptTool }
}
