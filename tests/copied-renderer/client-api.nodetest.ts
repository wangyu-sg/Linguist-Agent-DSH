import test from 'node:test'
import assert from 'node:assert/strict'
import { bindSession, fileUrl, getBinding, invoke, LinguistRequestError, required, stageFiles, subscribeProject } from '../../packages/dsh-linguist/src/client/api.ts'
import { LINGUIST_FILE_MAX_BYTES } from '../../packages/linguist-domain-service/src/contracts.ts'

test('Client 通过同源 HTTP 使用 native Session 绑定和 operation 信封，并核对返回身份', async () => {
  const original = globalThis.fetch
  const requests: Array<{ url: string; options?: RequestInit }> = []
  const responses = [
    { sessionId: 'session-A', workspaceId: 'workspace-A', projectId: 'project-A', role: 'reviewer', workMode: 'cat' },
    { sessionId: 'session-A', workspaceId: 'workspace-A', projectId: 'project-A', role: 'reviewer', workMode: 'cat' },
    { ok: true, data: { assetId: 'asset-A' } },
    { ok: false, error: { code: 'REVISION_CONFLICT', message: 'changed' } },
    { sessionId: 'other-session', workspaceId: 'workspace-A', projectId: 'project-A', role: 'reviewer', workMode: 'cat' },
    { sessionId: 'session-A', workspaceId: 'wrong-workspace', projectId: 'project-A', role: 'reviewer', workMode: 'cat' },
  ]
  globalThis.fetch = async (url, options) => {
    requests.push({ url: String(url), options })
    return Response.json(responses.shift())
  }
  try {
    const binding = await bindSession({ sessionId: 'session-A', projectId: 'project-A', role: 'reviewer', workMode: 'cat' }, 'workspace-A')
    assert.equal(binding.sessionId, 'session-A')
    assert.equal(requests[0]?.url, '/la/v1/session-bind')
    assert.equal(requests[0]?.options?.credentials, 'same-origin')
    assert.deepEqual(JSON.parse(String(requests[0]?.options?.body)), { sessionId: 'session-A', projectId: 'project-A', role: 'reviewer', workMode: 'cat' })
    assert.equal((await getBinding('session-A'))?.projectId, 'project-A')
    assert.equal(requests[1]?.url, '/la/v1/session-bind?sessionId=session-A')
    assert.deepEqual(await invoke('linguistCatQuery', { projectId: 'project-A', assetId: 'asset-A' }), { ok: true, data: { assetId: 'asset-A' } })
    assert.deepEqual(JSON.parse(String(requests[2]?.options?.body)), { operation: 'linguistCatQuery', input: { projectId: 'project-A', assetId: 'asset-A' } })
    await assert.rejects(required('linguistCatEditSegment', { projectId: 'project-A' }), (error: unknown) => error instanceof LinguistRequestError && error.detail.code === 'REVISION_CONFLICT')
    await assert.rejects(getBinding('session-A'), /identity mismatch/)
    await assert.rejects(bindSession({ sessionId: 'session-A', projectId: 'project-A', role: 'reviewer', workMode: 'cat' }, 'workspace-A'), /does not match/)
    assert.equal(fileUrl('opaque/token'), '/la/v1/files/opaque%2Ftoken')
  } finally {
    globalThis.fetch = original
  }
})

test('Client 上传文件只传浏览器 File，返回受管 token，不传本机路径', async () => {
  const original = globalThis.fetch
  let captured: { url: string; options?: RequestInit } | undefined
  globalThis.fetch = async (url, options) => {
    captured = { url: String(url), options }
    return Response.json({ tokens: ['opaque-synthetic-token'] })
  }
  try {
    const tokens = await stageFiles([new File(['synthetic only'], 'synthetic.txt', { type: 'text/plain' })])
    assert.deepEqual(tokens, ['opaque-synthetic-token'])
    assert.equal(captured?.url, '/la/v1/files/stage')
    assert.equal(captured?.options?.credentials, 'same-origin')
    const files = (captured?.options?.body as FormData).getAll('files')
    assert.equal(files.length, 1)
    assert.equal((files[0] as File).name, 'synthetic.txt')
    assert.equal((files[0] as File).size, 14)
  } finally {
    globalThis.fetch = original
  }
})

test('Client 分请求上传，收齐同一批 token 后才交给导入', async () => {
  const original = globalThis.fetch
  const names: string[][] = []
  globalThis.fetch = async (_url, options) => {
    names.push((options!.body as FormData).getAll('files').map(file => (file as File).name))
    return Response.json({ tokens: [`token-${names.length}`] })
  }
  try {
    const files = [new File(['split'], 'split.mxliff'), new File(['master'], 'master.mxliff')]
    for (const file of files) Object.defineProperty(file, 'size', { value: 300 * 1024 * 1024 })
    assert.deepEqual(await stageFiles(files), ['token-1', 'token-2'])
    assert.deepEqual(names, [['split.mxliff'], ['master.mxliff']])
  } finally { globalThis.fetch = original }
})

test('Client accepts inclusive File.size metadata, rejects overflow before upload, and releases a partially staged batch', async (context) => {
  let count = 0
  const cleanup: string[][] = []
  context.mock.method(globalThis, 'fetch', async (url: string, options: RequestInit) => {
    if (String(url).endsWith('/discard')) {
      cleanup.push(JSON.parse(String(options.body)).tokens)
      return Response.json({ discarded: true })
    }
    count++
    return count === 3 ? Response.json({ error: { code: 'IMPORT_TOO_LARGE', message: 'synthetic overflow' } }, { status: 413 }) : Response.json({ tokens: [`token-${count}`] })
  })
  const file = new File(['synthetic'], 'boundary.txt')
  Object.defineProperty(file, 'size', { configurable: true, value: LINGUIST_FILE_MAX_BYTES })
  assert.deepEqual(await stageFiles([file]), ['token-1'])
  Object.defineProperty(file, 'size', { value: LINGUIST_FILE_MAX_BYTES + 1 })
  await assert.rejects(stageFiles([file]), (error: unknown) => error instanceof LinguistRequestError && error.detail.code === 'IMPORT_TOO_LARGE' && error.message.includes('boundary.txt'))
  assert.equal(count, 1)
  await assert.rejects(stageFiles([new File(['a'], 'a.txt'), new File(['b'], 'b.txt')]), /synthetic overflow/)
  assert.deepEqual(cleanup, [['token-2']])
})

test('Project mutation SSE 只接受请求项目的事件并在卸载时关闭', () => {
  const original = Object.getOwnPropertyDescriptor(globalThis, 'EventSource')
  const instances: FakeEventSource[] = []
  class FakeEventSource {
    onmessage?: (event: { data: string }) => void
    readonly listeners = new Map<string, (event: { data: string }) => void>()
    closed = false
    constructor(readonly url: string) { instances.push(this) }
    addEventListener(type: string, listener: (event: { data: string }) => void): void { this.listeners.set(type, listener) }
    close(): void { this.closed = true }
  }
  Object.defineProperty(globalThis, 'EventSource', { configurable: true, value: FakeEventSource })
  try {
    const events: string[] = []
    let snapshots = 0
    const unsubscribe = subscribeProject('project-A', 7, (event) => events.push(event.kind), () => { snapshots++ })
    const source = instances[0]!
    assert.equal(source.url, '/la/v1/events?projectId=project-A&afterSequence=7')
    source.onmessage!({ data: JSON.stringify({ projectId: 'project-A', kind: 'segment-updated', revision: 8 }) })
    source.listeners.get('snapshot')!({ data: JSON.stringify({ projectId: 'project-A' }) })
    assert.deepEqual(events, ['segment-updated'])
    assert.equal(snapshots, 1)
    assert.throws(() => source.onmessage!({ data: JSON.stringify({ projectId: 'project-B', kind: 'segment-updated', revision: 9 }) }), /Invalid Linguist mutation event/)
    unsubscribe()
    assert.equal(source.closed, true)
  } finally {
    if (original) Object.defineProperty(globalThis, 'EventSource', original)
    else Reflect.deleteProperty(globalThis, 'EventSource')
  }
})
