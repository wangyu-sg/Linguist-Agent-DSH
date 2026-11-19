import { createHash } from 'node:crypto'
import type { GenerateOptions } from '@deepseek-ai/dsh-llm'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import type { PromptStatus } from './diagnostics'

interface ModelProvenance {
  modelProvider: string
  modelId: string
  linguistPromptVersion: string
  promptHash: string
  toolsetHash: string
  taskContextHash?: string
  resolvedEffort?: string
}

/** Bind the request actually dispatched by DSH to its resulting root and nested tool calls. */
export class ModelCallProvenance {
  private request?: ModelProvenance
  private readonly calls = new Map<string, ModelProvenance>()

  dispatched(options: GenerateOptions, prompt: { prompt: string; status: Pick<PromptStatus, 'promptVersion' | 'promptHash'> }, expectedContextHash?: string): void {
    if (options.purpose !== undefined) return
    const system = [options.system, ...options.messages.filter(message => message.role === 'system')
      .flatMap(message => message.content.flatMap(block => block.type === 'text' ? [block.text] : []))].filter(Boolean).join('\n')
    if (!system.includes(prompt.prompt)) throw new Error('Dispatched DSH request does not contain the assembled Linguist prompt')
    const latest = options.messages.findLast(message => message.source?.kind === 'linguist-task-context')
    const taskContextHash = latest?.source?.kind === 'linguist-task-context' ? latest.source.hash : undefined
    if (expectedContextHash !== undefined) {
      const text = latest?.content.flatMap(block => block.type === 'text' ? [block.text] : []).join('') ?? ''
      if (taskContextHash !== expectedContextHash || createHash('sha256').update(text).digest('hex') !== taskContextHash) {
        throw new Error('Dispatched DSH request has no matching Linguist task context')
      }
    }
    this.request = {
      modelProvider: options.provider, modelId: options.model,
      linguistPromptVersion: prompt.status.promptVersion, promptHash: prompt.status.promptHash,
      ...(taskContextHash === undefined ? {} : { taskContextHash }),
      ...(options.reasoningEffort === undefined ? {} : { resolvedEffort: options.reasoningEffort }),
      toolsetHash: createHash('sha256').update(JSON.stringify(options.tools ?? [])).digest('hex'),
    }
  }

  observe(event: SessionEvent): void {
    if (event.type === 'tool/call' && this.request) this.calls.set(event.data.callId, this.request)
    if (event.type === 'turn/end') {
      this.request = undefined
      this.calls.clear()
    }
  }

  associateNestedCall(callId: string, rootCallId: string): void {
    if (callId === rootCallId) return
    const root = this.calls.get(rootCallId)
    if (root) this.calls.set(callId, root)
  }

  forCall(callId: string): ModelProvenance {
    const provenance = this.calls.get(callId)
    if (!provenance) throw new Error('CAT generation has no observed DSH model request for this tool call')
    return { ...provenance }
  }
}
