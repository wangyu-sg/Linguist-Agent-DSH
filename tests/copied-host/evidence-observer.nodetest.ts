import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { createLinguistCatTools } from '../../packages/linguist-cat-tools/src/index.ts'
import { LinguistProjectService } from '../../packages/linguist-domain-service/src/index.ts'
import { EvidenceObserver } from '../../packages/dsh-linguist/src/host/evidence.ts'
import { ensureStageEvidenceForSession } from '../../packages/dsh-linguist/src/host/stage-evidence.ts'
import { adaptCatTool } from '../../packages/dsh-linguist/src/host/tool-adapter.ts'
import { Context } from '../../packages/dsh-linguist/node_modules/@deepseek-ai/cordis/lib/index.js'
import { ToolRuntime } from '../../packages/dsh-linguist/node_modules/@deepseek-ai/dsh-tools/lib/index.js'
import { SystemPrompt } from '../../packages/dsh-linguist/node_modules/@deepseek-ai/dsh-system-prompt/lib/index.js'
import * as NativeToolExecutor from '../../packages/dsh-linguist/node_modules/@deepseek-ai/dsh-tool-executor-native/lib/index.js'
import { estimateContent } from '../../packages/dsh-linguist/node_modules/@deepseek-ai/dsh-token-meter/lib/types/estimate.js'
import { Session, SessionId, SessionLogOffset, SessionStore } from '../../packages/dsh-linguist/node_modules/@deepseek-ai/dsh-session/lib/index.js'
import { SessionQueryEngine } from '../../packages/dsh-linguist/node_modules/@deepseek-ai/dsh-session-query/lib/index.js'
import { SessionReadSnapshots } from '../../packages/dsh-linguist/src/host/read-snapshots.ts'
import { createToolResultMessage, ToolCallId } from '../../packages/dsh-linguist/node_modules/@deepseek-ai/dsh-llm/lib/index.js'

test('DSH CAT adapter preserves model-facing tool descriptions and input schema', () => {
  const source = createLinguistCatTools({ resolveProject: () => { throw new Error('Description check must not execute tools') } })
  const context = source.find(tool => tool.name === 'cat_get_translation_context')!
  const adapted = adaptCatTool(context, {} as never)
  assert.equal(adapted.description, context.description)
  assert.deepEqual(adapted.parameters, JSON.parse(JSON.stringify(context.parameters)))
  assert.match(adapted.description, /readOnly=true creates neither Stage nor evidence receipts/)
  assert.match((adapted.parameters as { properties: { readOnly: { description: string } } }).properties.readOnly.description, /without creating\/replacing a (professional )?Stage/)
})

test('Stage receipt needs exact model-visible tool content and a completed response', async () => {
  const root = mkdtempSync(join(tmpdir(), 'la-dsh-evidence-observer-'))
  const service = new LinguistProjectService({ rootDir: join(root, 'linguist'), applicationVersion: 'synthetic-test' })
  service.init()
  try {
    const project = await service.createProject({ name: 'Synthetic evidence', sourceLocale: 'zh-CN', targetLocale: 'en-US' })
    const imported = await service.importAsset(project.id, {
      filename: 'synthetic.csv', bytes: new TextEncoder().encode('key,source,target\na,开始,Begin\n'),
    })
    const db = service.openProject(project.id)
    const segment = db.segments.query({ assetId: imported.assetId, limit: 1 })[0]!
    const state = ensureStageEvidenceForSession({
      session: { id: 'synthetic-reviewer', linguistRole: 'reviewer' }, db,
      discoveryScope: { roots: [], files: [], unavailable: [], hash: 'synthetic-scope', managedEvidence: [
        { ref: { kind: 'asset', id: imported.assetId }, version: imported.sourceSha256 },
      ] },
      fallbackSegmentIds: [segment.id],
    })!
    const observer = new EvidenceObserver(service, root)
    observer.prepare(project.id, {
      stageRunId: state.stageRunId, baselineHash: state.baseline.baselineHash,
      sessionId: 'synthetic-reviewer', generationRunId: 'synthetic-run', toolCallId: 'synthetic-tool',
      segmentIds: [segment.id], evidence: [{ ref: { kind: 'asset', id: imported.assetId }, version: imported.sourceSha256, anchorIds: [] }],
    })
    const presented = [{ type: 'text' as const, text: 'Source: 开始\nCurrent target: Begin' }]
    observer.presented('synthetic-reviewer', 'synthetic-tool', presented)
    async function* response(kind: 'completed' | 'aborted') {
      yield { type: 'finish', reason: { kind }, replayState: { response: { responseId: 'synthetic-response' } } }
    }
    const request = (content: typeof presented) => ({
      sessionId: 'synthetic-reviewer', provider: 'synthetic-provider', model: 'synthetic-model',
      messages: [{ role: 'tool', toolCallId: 'synthetic-tool', content }],
    })
    for await (const _ of observer.stream(request([{ type: 'text', text: 'Details are hidden' }]) as never, () => response('completed') as never)) {}
    assert.equal(db.stageEvidence.listReceipts(state.stageRunId).length, 0)
    for await (const _ of observer.stream(request(presented) as never, () => response('aborted') as never)) {}
    assert.equal(db.stageEvidence.listReceipts(state.stageRunId).length, 0)
    for await (const _ of observer.stream(request(presented) as never, () => response('completed') as never)) {}
    const receipts = db.stageEvidence.listReceipts(state.stageRunId)
    assert.equal(receipts.length, 1)
    assert.equal(receipts[0]!.evidence[0]!.submission, 'provider-response-v1')
    assert.equal(db.stageEvidence.getPresentationCoverage(state.stageRunId).presented, 1)
    const observation = readFileSync(join(root, 'evidence-observations.jsonl'), 'utf8')
    assert.match(observation, /"responseId":"synthetic-response"/)
    assert.match(observation, /"provider":"synthetic-provider"/)
    assert.doesNotMatch(observation, /Current target: Begin/)
    for await (const _ of observer.stream(request(presented) as never, () => response('completed') as never)) {}
    assert.equal(db.stageEvidence.listReceipts(state.stageRunId).length, 1)
  } finally { service.closeAll(); rmSync(root, { recursive: true, force: true }) }
})

test('large native CAT reads reach the Provider intact in bounded pages and complete Source evidence once', async () => {
  const root = mkdtempSync(join(tmpdir(), 'la-dsh-bounded-source-'))
  const service = new LinguistProjectService({ rootDir: join(root, 'linguist'), applicationVersion: 'synthetic-test' })
  service.init()
  const ctx = new Context()
  const prompt = ctx.plugin(SystemPrompt, {})
  await prompt.await()
  const registry = ctx.plugin(ToolRuntime, {})
  await registry.await()
  const executor = ctx.plugin(NativeToolExecutor)
  await executor.await()
  try {
    const project = await service.createProject({ name: 'Synthetic bounded Source', sourceLocale: 'en-US', targetLocale: 'zh-CN' })
    const source = `SOURCE-BEGIN ${'Complete synthetic language evidence. '.repeat(4_000)} SOURCE-END`
    const imported = await service.importAsset(project.id, { filename: 'large.csv', bytes: new TextEncoder().encode(`key,source,target\na,${source},\n`) })
    const db = service.openProject(project.id)
    const segment = db.segments.query({ assetId: imported.assetId, limit: 1 })[0]!
    const sessionId = SessionId('synthetic-bounded-reviewer')
    const state = ensureStageEvidenceForSession({ session: { id: sessionId, linguistRole: 'reviewer' }, db,
      discoveryScope: { roots: [], files: [], unavailable: [], hash: 'synthetic-scope', managedEvidence: [
        { ref: { kind: 'asset', id: imported.assetId }, version: imported.sourceSha256 },
      ] }, fallbackSegmentIds: [segment.id],
    })!
    const observer = new EvidenceObserver(service, root)
    const tools = createLinguistCatTools({ resolveProject: () => ({ project, db }), sessionId, stageEvidenceRunId: state.stageRunId,
      resultProjectId: project.id, onEvidencePrepared: receipt => observer.prepare(project.id, receipt),
    })
    const read = tools.find(tool => tool.name === 'cat_get_translation_context')!
    ctx.tools.register(adaptCatTool(read, {} as never, (callId, content) => observer.presented(sessionId, callId, content)))
    const session = Session.create(sessionId, undefined, { version: 4, id: sessionId, createdAt: Date.now(), cwd: root, isSeeded: false })
    const agent = { id: sessionId, session, options: {}, ctx }
    let cursor: string | undefined, payload = '', pages = 0
    do {
      const callId = ToolCallId(`source-page-${pages++}`)
      const batch = await ctx.tools.execute({ agent: agent as never, signal: new AbortController().signal, calls: [{ type: 'tool-call', id: callId, name: read.name,
        arguments: JSON.stringify({ segmentIds: [segment.id], includeNeighbors: false, tmLimitPerSegment: 0, termLimitPerSegment: 0, cursor }),
      }] })
      const result = batch.results[0]!.result
      assert.equal(result.isError, false)
      assert.ok(estimateContent(result.content) <= 12_500, 'actual SDK projection must remain below native spill threshold')
      const text = result.content.filter(block => block.type === 'text').map(block => block.text).join('')
      assert.ok(Buffer.byteLength(text, 'utf8') <= 32_000)
      const page = JSON.parse(text)
      assert.ok(page.contextFragment)
      assert.equal(page.contextFragment.offset, payload.length)
      assert.equal(typeof page.nextCursor === 'string', page.contextFragment.offset + page.contextFragment.text.length < page.contextFragment.totalChars)
      payload += page.contextFragment.text
      assert.equal(db.stageEvidence.getPresentationCoverage(state.stageRunId).presented, 0, 'tool completion alone does not present Source')
      const request = (content: typeof result.content) => ({ sessionId, provider: 'synthetic-provider', model: 'synthetic-model', messages: [createToolResultMessage({ callId, content, isError: false })] })
      const response = () => (async function* () { yield { type: 'finish', reason: { kind: 'completed' }, replayState: { response: { responseId: `response-${pages}` } } } })()
      if (pages === 1) {
        for await (const _ of observer.stream(request([{ type: 'text', text: 'Full result saved to /synthetic/result.txt' }]) as never, response as never)) {}
        assert.equal(db.stageEvidence.getPresentationCoverage(state.stageRunId).presented, 0, 'a file path is not the language evidence')
      }
      for await (const _ of observer.stream(request(result.content) as never, response as never)) {}
      cursor = page.nextCursor
      assert.ok(pages < 100)
    } while (cursor)
    assert.equal(JSON.parse(payload).contexts[0].source, source)
    assert.ok(pages > 1)
    assert.equal(db.stageEvidence.getPresentationCoverage(state.stageRunId).presented, 1)
    assert.equal(db.stageEvidence.listReceipts(state.stageRunId).length, pages, 'each page is presented once in the original pass, without a reread')
    const image = db.contextDocs.insert({ kind: 'image', originalFilename: 'synthetic.png', blobRelpath: 'blobs/synthetic.png', textExtract: 'Synthetic visual reference. '.repeat(300),
      extractionWarnings: Array.from({ length: 20 }, (_, index) => ({ code: 'PARTIAL_EXTRACTION', message: `warning-${index}: ${'Reference metadata. '.repeat(120)}` })),
    })
    const imageRead = createLinguistCatTools({ resolveProject: () => ({ project, db }), readContextImage: async () => ({ data: 'c3ludGhldGlj', mimeType: 'image/png' }) })
      .find(tool => tool.name === 'cat_read_context_doc')!
    ctx.tools.register(adaptCatTool(imageRead, { saveImage: async () => ({ attachmentId: 'sha256:synthetic-image', mediaType: 'image/png', bytes: 9, width: 1, height: 1 }) } as never))
    const imageBatch = await ctx.tools.execute({ agent: agent as never, signal: new AbortController().signal, calls: [{ type: 'tool-call', id: ToolCallId('image-read'), name: imageRead.name,
      arguments: JSON.stringify({ docId: image.id, readOnly: true }),
    }] })
    const imageResult = imageBatch.results[0]!.result
    assert.equal(imageResult.isError, false)
    assert.ok(imageResult.content.some(block => block.type === 'image'), 'bounded text must not drop visual evidence')
    assert.ok(estimateContent(imageResult.content) <= 12_500, 'text plus the actual image-reference projection fits the spill budget')
  } finally { await executor.dispose(); await registry.dispose(); await prompt.dispose(); service.closeAll(); rmSync(root, { recursive: true, force: true }) }
})


test('native prepared evidence survives Host replacement without rereading, replaying receipts or crossing bindings', async () => {
  const root = mkdtempSync(join(tmpdir(), 'la-evidence-native-hmr-'))
  const service = new LinguistProjectService({ rootDir: join(root, 'linguist'), applicationVersion: 'synthetic-test' })
  service.init()
  class ExactSessionQuery extends SessionQueryEngine {
    async searchSessions(): Promise<never> { throw new Error('Evidence restore must use the exact Session') }
    async searchEvents(): Promise<never> { throw new Error('Evidence restore must not search history') }
  }
  const ctx = new Context(), plugins = []
  for (const [plugin, config] of [[SystemPrompt, {}], [SessionStore, undefined], [ExactSessionQuery, {}], [ToolRuntime, {}], [NativeToolExecutor, undefined]] as const) {
    const runtime = ctx.plugin(plugin as never, config as never)
    await runtime.await(); plugins.push(runtime)
  }
  let detach = () => {}, unregister = () => {}
  const mounts: Array<() => void> = []
  try {
    const project = await service.createProject({ name: 'Synthetic HMR Source', sourceLocale: 'en-US', targetLocale: 'zh-CN' })
    const imported = await service.importAsset(project.id, { filename: 'source.csv', bytes: new TextEncoder().encode('key,source,target\na,Exact complete Source {name},完整译文 {name}\n') })
    const db = service.openProject(project.id), segment = db.segments.query({ assetId: imported.assetId, limit: 1 })[0]!
    const sessionId = SessionId('synthetic-hmr-reviewer'), callId = ToolCallId('synthetic-read-before-hmr')
    const session = Session.create(sessionId, undefined, { version: 4, id: sessionId, createdAt: Date.now(), cwd: root, isSeeded: false })
    detach = ctx.sessions.enter(session); ctx.sessions.announce(session)
    const stage = ensureStageEvidenceForSession({ session: { id: sessionId, linguistRole: 'reviewer' }, db,
      discoveryScope: { roots: [], files: [], unavailable: [], hash: 'synthetic-scope', managedEvidence: [
        { ref: { kind: 'asset', id: imported.assetId }, version: imported.sourceSha256 },
      ] }, fallbackSegmentIds: [segment.id],
    })!
    const oldObserver = new EvidenceObserver(service, root)
    mounts.push(oldObserver.bind(sessionId, project.id, ctx.sessionQuery))
    const snapshots = new SessionReadSnapshots(ctx.sessionQuery, sessionId, project.id)
    const source = createLinguistCatTools({ resolveProject: () => ({ project, db }), resultProjectId: project.id, sessionId,
      linguistRole: 'reviewer', stageEvidenceRunId: stage.stageRunId, readSnapshots: snapshots,
      onEvidencePrepared: receipt => oldObserver.prepare(project.id, receipt),
    }).find(tool => tool.name === 'cat_get_translation_context')!
    unregister = ctx.tools.register(adaptCatTool(source, {} as never,
      (id, content) => oldObserver.presented(sessionId, id, content), undefined, undefined, snapshots))
    const batch = await ctx.tools.execute({ agent: { id: sessionId, session, ctx, options: {} } as never,
      signal: new AbortController().signal, log: { turn: 0, step: 0 },
      calls: [{ type: 'tool-call', id: callId, name: source.name, arguments: JSON.stringify({ segmentIds: [segment.id], includeNeighbors: false, tmLimitPerSegment: 0, termLimitPerSegment: 0 }) }],
    })
    const result = batch.results[0]!.result
    assert.equal(result.isError, false)
    assert.equal((result.meta as { evidence: { kind: string } }).evidence.kind, 'linguist-prepared-evidence')
    assert.doesNotMatch(JSON.stringify(result.meta), /Exact complete Source|完整译文/)
    using observation = await ctx.sessionQuery.observeSession(sessionId, { projectionMode: 'none' })
    const original = observation.events.findLast(event => event.type === 'tool/result')!
    const message = session.deriveEventMessage(original)!
    assert.equal(message.role, 'tool')
    assert.ok(message.content.some(block => block.type === 'text' && block.text.includes(segment.source)))
    assert.equal(db.stageEvidence.listReceipts(stage.stageRunId).length, 0)
    unregister(); unregister = () => {}
    mounts.splice(0).forEach(dispose => dispose())
    const request = (id: string, content = message.content) => ({ sessionId: id, provider: 'synthetic-provider', model: 'synthetic-model', messages: [createToolResultMessage({ callId, content, isError: false })] })
    const response = (kind = 'completed') => (async function* () { yield { type: 'finish', reason: { kind } } })()
    const consume = async (observer: EvidenceObserver, options: ReturnType<typeof request>, kind = 'completed') => {
      for await (const _ of observer.stream(options as never, () => response(kind) as never)) {}
    }
    // The same database cannot make another project binding accept this metadata.
    const otherProjectService = { openProject: () => db } as unknown as LinguistProjectService
    const isolated = new EvidenceObserver(otherProjectService, root)
    mounts.push(isolated.bind(sessionId, 'another-project', ctx.sessionQuery))
    await consume(isolated, request(sessionId))
    const forkId = SessionId('synthetic-reviewer-fork')
    const fork = Session.create(forkId, observation.events, { ...session.header, id: forkId, isSeeded: true }, SessionLogOffset(observation.events.length))
    const detachFork = ctx.sessions.enter(fork); mounts.push(detachFork); ctx.sessions.announce(fork)
    const forkObserver = new EvidenceObserver(service, root)
    mounts.push(forkObserver.bind(forkId, project.id, ctx.sessionQuery))
    await consume(forkObserver, request(forkId))
    assert.equal(db.stageEvidence.listReceipts(stage.stageRunId).length, 0)
    // Replay a native surface replacement as HMR restores the same durable metadata.
    session.append('tool/result', original.data as never, { surfaceOp: { op: 'replace', startSeq: original.seq, endSeq: original.seq }, sourceEventSeqs: [original.seq] })
    const restored = new EvidenceObserver(service, root)
    mounts.push(restored.bind(sessionId, project.id, ctx.sessionQuery))
    for (const content of [[{ type: 'text' as const, text: 'Full result saved to /synthetic/result.txt' }], [{ type: 'text' as const, text: (message.content[0] as { text: string }).text.slice(0, 40) }]]) {
      await consume(restored, request(sessionId, content))
    }
    await consume(restored, request(sessionId), 'aborted')
    await consume(restored, request(sessionId), 'error')
    for await (const _ of restored.stream(request(sessionId) as never, () => (async function* () {})())) {}
    assert.equal(db.stageEvidence.listReceipts(stage.stageRunId).length, 0)
    await consume(restored, request(sessionId))
    assert.equal(db.stageEvidence.getPresentationCoverage(stage.stageRunId).presented, 1)
    assert.equal(db.stageEvidence.listReceipts(stage.stageRunId).length, 1)
    const afterAnotherHmr = new EvidenceObserver(service, root)
    mounts.push(afterAnotherHmr.bind(sessionId, project.id, ctx.sessionQuery))
    await consume(afterAnotherHmr, request(sessionId))
    assert.equal(db.stageEvidence.listReceipts(stage.stageRunId).length, 1)
    assert.equal(readFileSync(join(root, 'evidence-observations.jsonl'), 'utf8').trim().split('\n').length, 1, 'a settled receipt must not be observed again after HMR')
  } finally {
    unregister(); for (const dispose of mounts.reverse()) dispose(); detach()
    for (const runtime of plugins.reverse()) await runtime.dispose()
    service.closeAll(); rmSync(root, { recursive: true, force: true })
  }
})
