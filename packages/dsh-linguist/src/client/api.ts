import type { LinguistIpcError, LinguistIpcResult, LinguistMigrationProgress, LinguistProjectMutationEvent } from '@linguist/domain-service/contracts'

const base = '/la/v1'

export class LinguistRequestError extends Error {
  readonly detail: LinguistIpcError
  constructor(detail: LinguistIpcError) {
    super(`${detail.code}: ${detail.message}`)
    this.name = 'LinguistRequestError'
    this.detail = detail
  }
}

export interface LinguistBinding {
  sessionId: string
  workspaceId: string
  projectId?: string
  role: 'general' | 'translator' | 'reviewer' | 'proofreader'
  workMode: 'cat' | 'working-copy' | 'browser'
}

export async function bindSession(input: Omit<LinguistBinding, 'workspaceId'>, expectedWorkspaceId: string): Promise<LinguistBinding> {
  const response = await fetch(`${base}/session-bind`, { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input) })
  if (!response.ok) throw new Error(`Linguist session binding failed: HTTP ${response.status}`)
  const value: LinguistBinding = await response.json()
  if (value.sessionId !== input.sessionId || value.workspaceId !== expectedWorkspaceId || value.projectId !== input.projectId || value.role !== input.role || value.workMode !== input.workMode) {
    throw new Error('Linguist session binding response does not match the requested session')
  }
  return value
}

export async function getBinding(sessionId: string): Promise<LinguistBinding | undefined> {
  const response = await fetch(`${base}/session-bind?sessionId=${encodeURIComponent(sessionId)}`, { credentials: 'same-origin' })
  if (response.status === 404) return undefined
  if (!response.ok) throw new Error(`Linguist session binding read failed: HTTP ${response.status}`)
  const value: LinguistBinding = await response.json()
  if (value.sessionId !== sessionId) throw new Error('Linguist session binding identity mismatch')
  return value
}

export async function invoke<T>(operation: string, input: object): Promise<LinguistIpcResult<T>> {
  const response = await fetch(`${base}/invoke`, {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ operation, input }),
  })
  if (!response.ok) throw new Error(`Linguist request failed: HTTP ${response.status}`)
  const result: unknown = await response.json()
  if (typeof result !== 'object' || result === null || !('ok' in result) || typeof result.ok !== 'boolean') {
    throw new Error(`Invalid Linguist response for ${operation}`)
  }
  return result as LinguistIpcResult<T>
}

export async function required<T>(operation: string, input: object): Promise<T> {
  const result = await invoke<T>(operation, input)
  if (!result.ok) throw new LinguistRequestError(result.error)
  return result.data
}

export async function stageFiles(files: readonly File[]): Promise<readonly string[]> {
  const form = new FormData()
  for (const file of files) form.append('files', file, file.name)
  const response = await fetch(`${base}/files/stage`, { method: 'POST', credentials: 'same-origin', body: form })
  if (!response.ok) throw new Error(`Linguist file staging failed: HTTP ${response.status}`)
  const result: unknown = await response.json()
  if (typeof result !== 'object' || result === null || !('tokens' in result) || !Array.isArray(result.tokens) || !result.tokens.every((token) => typeof token === 'string')) {
    throw new Error('Invalid Linguist file staging response')
  }
  return result.tokens
}

export function fileUrl(token: string): string {
  return `${base}/files/${encodeURIComponent(token)}`
}

export function subscribeProject(projectId: string, afterSequence: number, onMutation: (event: LinguistProjectMutationEvent) => void, onSnapshot: () => void): () => void {
  const source = new EventSource(`${base}/events?projectId=${encodeURIComponent(projectId)}&afterSequence=${afterSequence}`)
  source.onmessage = (message) => {
    const event: unknown = JSON.parse(message.data)
    if (typeof event !== 'object' || event === null || !('projectId' in event) || event.projectId !== projectId) {
      throw new Error('Invalid Linguist mutation event')
    }
    onMutation(event as LinguistProjectMutationEvent)
  }
  source.addEventListener('snapshot', (message) => {
    const event: unknown = JSON.parse((message as MessageEvent).data)
    if (typeof event !== 'object' || event === null || !('projectId' in event) || event.projectId !== projectId) {
      throw new Error('Invalid Linguist project snapshot')
    }
    onSnapshot()
  })
  return () => source.close()
}

export function subscribeMigration(
  workspaceId: string,
  scanId: string,
  onProgress: (event: LinguistMigrationProgress) => void,
  onError: (error: Error) => void,
): Promise<() => void> {
  const source = new EventSource(`${base}/events?workspaceId=${encodeURIComponent(workspaceId)}&scanId=${encodeURIComponent(scanId)}`)
  return new Promise((resolve, reject) => {
    let ready = false
    const fail = (error: Error) => {
      source.close()
      if (ready) onError(error)
      else reject(error)
    }
    source.addEventListener('migration-ready', (message) => {
      try {
        const event: unknown = JSON.parse((message as MessageEvent).data)
        if (typeof event !== 'object' || event === null || !('workspaceId' in event) || event.workspaceId !== workspaceId || !('scanId' in event) || event.scanId !== scanId) {
          throw new Error('Invalid Linguist migration ready event')
        }
        ready = true
        resolve(() => source.close())
      } catch (error) { fail(error instanceof Error ? error : new Error(String(error))) }
    })
    source.addEventListener('migration-progress', (message) => {
      try {
        const event: unknown = JSON.parse((message as MessageEvent).data)
        if (typeof event !== 'object' || event === null || !('workspaceId' in event) || event.workspaceId !== workspaceId || !('scanId' in event) || event.scanId !== scanId || !('projectId' in event) || typeof event.projectId !== 'string' || !('phase' in event) || (event.phase !== 'import' && event.phase !== 'verify') || !('index' in event) || !Number.isInteger(event.index) || !('total' in event) || !Number.isInteger(event.total)) {
          throw new Error('Invalid Linguist migration progress event')
        }
        onProgress(event as LinguistMigrationProgress)
      } catch (error) { fail(error instanceof Error ? error : new Error(String(error))) }
    })
    source.onerror = () => fail(new Error('Linguist migration progress connection failed'))
  })
}
