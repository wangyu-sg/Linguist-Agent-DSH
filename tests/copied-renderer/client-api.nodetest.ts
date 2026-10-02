import test, { type TestContext } from 'node:test'
import assert from 'node:assert/strict'
import { bindSession, fileUrl, getBinding, invoke, LinguistRequestError, required, stageFiles, subscribeImport, subscribeProject } from '../../packages/dsh-linguist/src/client/api.ts'
import { LINGUIST_FILE_MAX_BYTES } from '../../packages/linguist-domain-service/src/contracts.ts'
import { describeProjectError } from '../../packages/dsh-linguist/src/client/project-errors.ts'

test('Phrase parse error explains the missing companion and the next file selection in Chinese', () => {
  const text = describeProjectError(new LinguistRequestError({ code: 'FORMAT_PARSE_ERROR', message: 'Could not parse', formatDetails: {
    code: 'FORMAT_PARSE_ERROR', category: 'vendor_structure_incomplete', adapterId: 'phrase_mxliff_1_2', filename: '合成游戏.mxliff', detail: 'The source file could not be parsed.', reason: 'phrase-master-required',
  } }), (key, params) => key.replace(/\{(\w+)\}/g, (_, name) => String(params?.[name])))
  assert.match(text, /合成游戏\.mxliff/)
  assert.match(text, /master XLIFF/)
  assert.match(text, /同时选中.*\.xlf \/ \.xliff/)
  assert.doesNotMatch(text, /vendor_structure_incomplete|FORMAT_PARSE_ERROR|could not be parsed/)
})

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

function mockUploads(context: TestContext, respond: (form: FormData) => { status: number; body: unknown }) {
  const original = Object.getOwnPropertyDescriptor(globalThis, 'XMLHttpRequest')
  class FakeRequest {
    upload: { onprogress?: (event: { lengthComputable: boolean; loaded: number; total: number }) => void } = {}
    responseType = ''
    response: unknown
    status = 0
    onload?: () => void
    open(method: string, url: string) { assert.equal(method, 'POST'); assert.equal(url, '/la/v1/files/stage') }
    send(form: FormData) {
      assert.equal(this.responseType, 'json')
      this.upload.onprogress?.({ lengthComputable: true, loaded: 50, total: 100 })
      const result = respond(form)
      this.response = result.body
      this.status = result.status
      queueMicrotask(() => this.onload?.())
    }
  }
  Object.defineProperty(globalThis, 'XMLHttpRequest', { configurable: true, value: FakeRequest })
  context.after(() => { if (original) Object.defineProperty(globalThis, 'XMLHttpRequest', original); else Reflect.deleteProperty(globalThis, 'XMLHttpRequest') })
}

test('Client uploads browser Files separately, reports actual bytes, and keeps Phrase tokens in one logical batch', async context => {
  const names: string[][] = []
  const progress: { filename: string; loadedBytes: number; totalBytes: number }[] = []
  mockUploads(context, form => {
    names.push(form.getAll('files').map(file => (file as File).name))
    return { status: 200, body: { tokens: [`token-${names.length}`] } }
  })
  const files = [new File(['split'], '合成拆分.mxliff'), new File(['master'], '配套原件.xliff')]
  for (const file of files) Object.defineProperty(file, 'size', { value: 300 * 1024 * 1024 })
  assert.deepEqual(await stageFiles(files, value => progress.push(value)), ['token-1', 'token-2'])
  assert.deepEqual(names, [['合成拆分.mxliff'], ['配套原件.xliff']])
  assert.deepEqual(progress.map(value => value.loadedBytes / value.totalBytes), [0, .25, .5, .5, .75, 1])
  assert.equal(progress[1]!.filename, '合成拆分.mxliff')
})

test('Client rejects overflow before upload, releases partially uploaded batches, and rejects malformed staging responses', async context => {
  let count = 0
  const cleanup: string[][] = []
  mockUploads(context, () => {
    count++
    return count === 3 ? { status: 413, body: { error: { code: 'IMPORT_TOO_LARGE', message: 'synthetic overflow' } } }
      : { status: 200, body: count === 4 ? null : { tokens: [`token-${count}`] } }
  })
  context.mock.method(globalThis, 'fetch', async (url: string, options: RequestInit) => {
    assert.ok(String(url).endsWith('/discard'))
    cleanup.push(JSON.parse(String(options.body)).tokens)
    return Response.json({ discarded: true })
  })
  const file = new File(['synthetic'], 'boundary.txt')
  Object.defineProperty(file, 'size', { configurable: true, value: LINGUIST_FILE_MAX_BYTES })
  assert.deepEqual(await stageFiles([file]), ['token-1'])
  Object.defineProperty(file, 'size', { value: LINGUIST_FILE_MAX_BYTES + 1 })
  await assert.rejects(stageFiles([file]), (error: unknown) => error instanceof LinguistRequestError && error.detail.code === 'IMPORT_TOO_LARGE' && error.message.includes('boundary.txt'))
  assert.equal(count, 1)
  await assert.rejects(stageFiles([new File(['a'], 'a.txt'), new File(['b'], 'b.txt')]), /synthetic overflow/)
  assert.deepEqual(cleanup, [['token-2']])
  await assert.rejects(stageFiles([new File(['a'], 'bad.txt')]), /Invalid Linguist file staging response/)
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

test('Import progress waits for the subscription, isolates concurrent requests, and reports lost progress separately from the import result', async context => {
  const original = Object.getOwnPropertyDescriptor(globalThis, 'EventSource')
  const instances: FakeSource[] = []
  class FakeSource {
    listeners = new Map<string, (event: { data: string }) => void>()
    closed = false
    onerror?: () => void
    constructor(readonly url: string) { instances.push(this) }
    addEventListener(name: string, listener: (event: { data: string }) => void) { this.listeners.set(name, listener) }
    close() { this.closed = true }
  }
  Object.defineProperty(globalThis, 'EventSource', { configurable: true, value: FakeSource })
  context.after(() => { if (original) Object.defineProperty(globalThis, 'EventSource', original); else Reflect.deleteProperty(globalThis, 'EventSource') })
  const phases: string[] = []
  let lost = 0
  const waiting = subscribeImport('project-A', 'import-A', event => phases.push(event.phase), () => lost++)
  const source = instances[0]!
  source.listeners.get('snapshot')!({ data: JSON.stringify({ projectId: 'project-A' }) })
  const close = await waiting
  const event = { projectId: 'project-A', requestId: 'import-A', filename: '合成.mxliff', index: 1, total: 2, phase: 'matching' }
  for (const value of [{ ...event, requestId: 'other' }, { ...event, projectId: 'other' }, event]) source.listeners.get('import-progress')!({ data: JSON.stringify(value) })
  assert.deepEqual(phases, ['matching'])
  source.onerror!()
  assert.equal(lost, 1)
  close()
  assert.equal(source.closed, true)
  const failure = subscribeImport('project-A', 'import-B', () => {}, () => lost++)
  instances[1]!.onerror!()
  await assert.rejects(failure, /尚未开始解析或写入/)
  assert.equal(lost, 1)
})
