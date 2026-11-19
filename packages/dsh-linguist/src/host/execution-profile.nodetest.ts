import assert from 'node:assert/strict'
import test from 'node:test'
import { ReasoningEffortId, type LlmRuntime } from '@deepseek-ai/dsh-llm'
import { resolveExecutionProfile } from './execution-profile'

test('role defaults choose only supported efforts and inherit explicit selections across professional roles', async () => {
  const llm = {
    async resolveModelInfo(provider: string, model: string) {
      return { provider, id: model, name: model, reasoning: { efforts: (model === 'first' ? ['high', 'xhigh'] : ['high', 'max']).map(name => ({ id: ReasoningEffortId(name), name })) } }
    },
    async resolveCallConfig(config: Parameters<LlmRuntime['resolveCallConfig']>[0]) { return config },
  }
  for (const [provider, model, expected] of [['first-route', 'first', 'xhigh'], ['other-route', 'second', 'max']]) {
    const selection = { provider: provider!, model: model! }
    assert.equal((await resolveExecutionProfile(llm, selection, 'reviewer', true, false)).profile.resolvedEffort, expected)
    const explicit = { ...selection, reasoningEffort: ReasoningEffortId('high') }
    const result = await resolveExecutionProfile(llm, explicit, 'reviewer', true, true)
    assert.deepEqual(result.options, explicit)
    assert.equal(result.profile.source, 'inherited-user')
    assert.equal((await resolveExecutionProfile(llm, selection, 'reviewer', false, false)).options.reasoningEffort, undefined)
    await assert.rejects(resolveExecutionProfile(llm, explicit, 'reviewer', true, true, { model: 'unapproved' }), /已选的模型/)
  }
})
