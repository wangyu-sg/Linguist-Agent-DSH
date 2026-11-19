import type { AgentOptions } from '@deepseek-ai/dsh-agent'
import { ReasoningEffortId, type LlmRuntime } from '@deepseek-ai/dsh-llm'
import type { LinguistRole } from './bindings'

export interface ExecutionProfile {
  provider: string
  model: string
  source: 'inherited' | 'inherited-user' | 'la-role-default' | 'provider-default'
  requestedEffort?: string
  resolvedEffort?: string
}

export async function resolveExecutionProfile(
  llm: Pick<LlmRuntime, 'resolveModelInfo' | 'resolveCallConfig'>,
  current: { provider: string; model: string; reasoningEffort?: import('@deepseek-ai/dsh-llm').ReasoningEffortId },
  role: LinguistRole,
  useRoleDefaults: boolean,
  userSelected: boolean,
  asserted: Pick<AgentOptions, 'provider' | 'model' | 'reasoningEffort'> = {},
  signal?: AbortSignal,
): Promise<{ options: AgentOptions; profile: ExecutionProfile }> {
  if ((asserted.provider !== undefined && asserted.provider !== current.provider) ||
      (asserted.model !== undefined && asserted.model !== current.model) ||
      (asserted.reasoningEffort !== undefined && asserted.reasoningEffort !== current.reasoningEffort)) {
    throw new Error('专业子任务使用当前会话已选的模型和推理档位。请在宿主模型选择器更改本次配置。')
  }
  let effort = current.reasoningEffort
  let source: ExecutionProfile['source'] = userSelected ? 'inherited-user' : effort ? 'inherited' : 'provider-default'
  if (useRoleDefaults && !userSelected && !effort) {
    const { reasoning } = await llm.resolveModelInfo(current.provider, current.model, signal)
    const candidates = role === 'reviewer' ? ['max', 'xhigh', 'high'] : ['high']
    const selected = candidates.flatMap(id => reasoning?.efforts.filter(option =>
      new RegExp(`^(?:thinking[-_ ])?${id}$`, 'i').test(option.id)) ?? [])[0]
    if (selected) {
      effort = ReasoningEffortId(selected.id)
      source = 'la-role-default'
    }
  }
  const options = { provider: current.provider, model: current.model, ...(effort ? { reasoningEffort: effort } : {}) }
  const resolved = await llm.resolveCallConfig(options, signal)
  return { options, profile: {
    provider: current.provider, model: current.model, source,
    ...(current.reasoningEffort ? { requestedEffort: current.reasoningEffort } : {}),
    ...(resolved.reasoningEffort ? { resolvedEffort: resolved.reasoningEffort } : {}),
  } }
}
