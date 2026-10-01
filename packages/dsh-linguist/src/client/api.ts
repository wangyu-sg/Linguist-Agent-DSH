import type { LinguistIpcError, LinguistIpcResult, LinguistMigrationProgress, LinguistProjectMutationEvent } from '@linguist/domain-service/contracts'
import { LINGUIST_FILE_MAX_BYTES } from '@linguist/domain-service/contracts'

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

export async function getInstructionFiles(sessionId: string, signal: AbortSignal): Promise<readonly { path: string; label: string }[]> {
  const response = await fetch(`${base}/session-instructions?sessionId=${encodeURIComponent(sessionId)}`, { credentials: 'same-origin', signal })
  if (!response.ok) throw new Error(`Linguist instruction discovery failed: HTTP ${response.status}`)
  const result: { sessionId: string; files: { path: string; label: string }[] } = await response.json()
  if (result.sessionId !== sessionId) throw new Error('Linguist instruction response identity mismatch')
  return result.files
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
  if (files.length === 0 || files.length > 500) throw new Error('一次请选择 1–500 个文件。')
  for (const file of files) {
    if (file.size > LINGUIST_FILE_MAX_BYTES) throw new LinguistRequestError({ code: 'IMPORT_TOO_LARGE', message: `文件“${file.name}”（${file.size} 字节）超过单文件上限 512 MiB。请拆分文件后重试。` })
  }
  const tokens: string[] = []
  try {
    for (const file of files) {
      const form = new FormData()
      form.append('files', file, file.name)
      const response = await fetch(`${base}/files/stage`, { method: 'POST', credentials: 'same-origin', body: form })
      if (!response.ok) {
        const failure: { error: LinguistIpcError | string } = await response.json()
        throw typeof failure.error === 'string' ? new Error(failure.error) : new LinguistRequestError(failure.error)
      }
      const result: unknown = await response.json()
      if (typeof result !== 'object' || result === null || !('tokens' in result) || !Array.isArray(result.tokens) || result.tokens.length !== 1 || typeof result.tokens[0] !== 'string') throw new Error('Invalid Linguist file staging response')
      tokens.push(result.tokens[0])
    }
    return tokens
  } catch (error) {
    if (tokens.length) {
      try { await discardStagedFiles(tokens) }
      catch (cleanupError) { throw new AggregateError([error, cleanupError], '上传未完成，部分暂存释放失败；请重新选择文件，遗留暂存将在过期后回收。') }
    }
    throw error
  }
}

export async function discardStagedFiles(tokens: readonly string[]): Promise<void> {
  const response = await fetch(`${base}/files/discard`, { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ tokens }) })
  if (!response.ok) throw new Error(`暂存释放失败：HTTP ${response.status}`)
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
