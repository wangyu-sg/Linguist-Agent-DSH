import { randomUUID } from 'node:crypto'
import type { Agent, AgentOptions } from '@deepseek-ai/dsh-agent'
import { ReasoningEffortId } from '@deepseek-ai/dsh-llm'
import { SessionId } from '@deepseek-ai/dsh-session'
import type { SubagentRuntime } from '@deepseek-ai/dsh-subagent'
import type { ToolDefinition } from '@deepseek-ai/dsh-tools'
import type { LinguistProjectService } from '@linguist/domain-service'
import { Type } from 'typebox'
import { Value } from 'typebox/value'
import type { SessionBinding } from './bindings'
import { freezeLinguistDelegation } from './delegation'
import type { LinguistDelegationControl } from './delegation-control'
import { deliverDelegationInputs, preflightDelegationInputs } from './delegation-inputs'

const parameters = Type.Object({
  role: Type.Union([Type.Literal('translator'), Type.Literal('reviewer'), Type.Literal('proofreader')]),
  objective: Type.String({ minLength: 1, maxLength: 10000 }),
  provider: Type.Optional(Type.String({ minLength: 1 })),
  model: Type.Optional(Type.String({ minLength: 1 })),
  reasoningEffort: Type.Optional(Type.String({ minLength: 1 })),
  scope: Type.Object({
    batchIds: Type.Optional(Type.Array(Type.String(), { maxItems: 200 })),
    segmentIds: Type.Optional(Type.Array(Type.String(), { maxItems: 2000 })),
  }),
  inputs: Type.Optional(Type.Array(Type.Object({
    path: Type.String({ minLength: 1 }),
    purpose: Type.String({ minLength: 1, maxLength: 500 }),
    required: Type.Boolean(),
    expectedSha256: Type.Optional(Type.String()),
    snapshot: Type.Optional(Type.Boolean()),
  }), { maxItems: 20 })),
  expectedOutcome: Type.String({ minLength: 1, maxLength: 4000 }),
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
  subagents: Pick<SubagentRuntime, 'resolveMaxDepth' | 'startContinuable'>
  control: LinguistDelegationControl
  resolveSessionWorkspace: () => Promise<{ workspaceRoot: string }>
  reserveIntent: (childSessionId: string, binding: SessionBinding) => () => void
}): { tool: ToolDefinition; messageTool: ToolDefinition; listTool: ToolDefinition; interruptTool: ToolDefinition } {
  const tool: ToolDefinition = {
    name: 'linguist_delegate',
    description: 'Start a durable, continuable DSH child for one bounded Linguist CAT task. State the professional role, objective, actual Asset/Segment scope, explicit file purposes and expected outcome. Optionally select the child provider, model and reasoningEffort; omitted route settings use DSH inheritance. This only reports accepted child creation; it does not claim that the child read inputs or completed review.',
    parameters: JSON.parse(JSON.stringify(parameters)) as Record<string, unknown>, output: output(),
    async execute(args, exec) {
      if (!Value.Check(parameters, args)) throw new Error(`Invalid linguist_delegate arguments: ${Value.Errors(parameters, args)[0]?.message}`)
      if (exec.agent !== input.agent) throw new Error('Delegation caller is not the bound DSH Agent')
      const call = args as {
        role: 'translator' | 'reviewer' | 'proofreader'; objective: string; expectedOutcome: string
        provider?: string; model?: string; reasoningEffort?: string
        scope: { batchIds?: string[]; segmentIds?: string[] }
        inputs?: Array<{ path: string; purpose: string; required: boolean; expectedSha256?: string; snapshot?: boolean }>
      }
      const { workspaceRoot } = await input.resolveSessionWorkspace()
      const childBinding = freezeLinguistDelegation(input.service, input.binding, {
        role: call.role, scope: { assetIds: call.scope.batchIds, segmentIds: call.scope.segmentIds },
      })
      const preflight = await preflightDelegationInputs(call.inputs ?? [], workspaceRoot)
      if (!preflight.ready) return { status: 'blocked-input', inputs: preflight.items.map(item => item.receipt) }
      const receipts = await deliverDelegationInputs(preflight.items, workspaceRoot, String(exec.callId))
      const childId = SessionId(randomUUID())
      const release = input.reserveIntent(childId, childBinding)
      try {
        const prompt = [
          `Objective: ${call.objective}`,
          `Expected outcome: ${call.expectedOutcome}`,
          `Linguist CAT project: ${childBinding.projectId}. Role: ${childBinding.role}.`,
          `Frozen Asset IDs: ${JSON.stringify(childBinding.delegatedScope!.assetIds)}.`,
          `Frozen Segment IDs: ${JSON.stringify(childBinding.delegatedScope!.segmentIds)}.`,
          `Authorized input receipts: ${JSON.stringify(receipts)}.`,
          'Inputs have been handed off, not checked by you. Report checkedInputs and notChecked in your result. A completed turn is not professional review completion.',
        ].join('\n')
        const maxDepth = input.subagents.resolveMaxDepth()
        const agentOptions: AgentOptions = {
          ...(call.provider === undefined ? {} : { provider: call.provider }),
          ...(call.model === undefined ? {} : { model: call.model }),
          ...(call.reasoningEffort === undefined ? {} : { reasoningEffort: ReasoningEffortId(call.reasoningEffort) }),
        }
        const accepted = await input.subagents.startContinuable({
          provider: 'spawn', childId, label: call.objective.slice(0, 120),
          request: { parent: input.agent, prompt: [{ type: 'text', text: prompt }],
            ...(Object.keys(agentOptions).length ? { agentOptions } : {}),
            ...(maxDepth === undefined ? {} : { maxDepth }) },
          signal: exec.signal,
        })
        return {
          status: 'started', childSessionId: accepted.childId, messageId: accepted.messageId,
          inputs: receipts, scope: childBinding.delegatedScope,
          checkedInputs: [], notChecked: receipts.filter(item => item.state === 'referenced' || item.state === 'snapshotted').map(item => item.requestedPath),
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
      return input.control.interrupt(input.agent.id, (args as { childSessionId: string }).childSessionId)
    },
  }

  return { tool, messageTool, listTool, interruptTool }
}
