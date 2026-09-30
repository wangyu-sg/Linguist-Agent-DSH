import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import { EventEmitter } from 'node:events'
import { cpSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createRequire } from 'node:module'
import { Readable } from 'node:stream'
import { fileURLToPath } from 'node:url'
import test from 'node:test'
import { LinguistProjectService, convertOfficePreviewToHtml } from '../../packages/linguist-domain-service/src/index.ts'
import { createDefaultCatFormatRegistry } from '../../packages/linguist-domain-service/src/format-registry.ts'
import { createAsset, createProject, createStageEvidenceBaseline } from '../../packages/linguist-cat-core/src/index.ts'
import { bindImportedSegments } from '../../packages/linguist-cat-formats/src/index.ts'
import { createLinguistCatTools, LINGUIST_CAT_TOOL_NAMES } from '../../packages/linguist-cat-tools/src/index.ts'
import { FormatParseError } from '../../packages/linguist-cat-formats/src/errors.ts'
import { createCatDeps } from '../../packages/dsh-linguist/src/host/cat-deps.ts'
import { EvidenceObserver } from '../../packages/dsh-linguist/src/host/evidence.ts'
import { BindingStore } from '../../packages/dsh-linguist/src/host/bindings.ts'
import { ManagedFiles } from '../../packages/dsh-linguist/src/host/files.ts'
import { MutationBus } from '../../packages/dsh-linguist/src/host/mutations.ts'
import { dispatchOperation } from '../../packages/dsh-linguist/src/host/operations.ts'
import { invokeError, registerHttpRoutes } from '../../packages/dsh-linguist/src/host/http.ts'
import { loadLinguistRoleResources } from '../../packages/dsh-linguist/src/host/role-resources.ts'
import { createWorkingCopyTool } from '../../packages/dsh-linguist/src/host/working-copy-tool.ts'
import { adaptCatTool } from '../../packages/dsh-linguist/src/host/tool-adapter.ts'
import { captureAutomationLinguistContext, revalidateAutomationLinguistContext } from '../../packages/dsh-linguist/src/host/automation-context.ts'
import { freezeLinguistDelegation, linguistDelegationOutcome } from '../../packages/dsh-linguist/src/host/delegation.ts'
import { LinguistDelegationControl } from '../../packages/dsh-linguist/src/host/delegation-control.ts'
import { deliverDelegationInputs, preflightDelegationInputs } from '../../packages/dsh-linguist/src/host/delegation-inputs.ts'
import { createLinguistDelegationTool } from '../../packages/dsh-linguist/src/host/delegation-tool.ts'
import { copyLinguistSessionToProject, sessionCopyEligibility, LinguistSessionCopyError } from '../../packages/dsh-linguist/src/host/session-copy.ts'
import { addPreparedTurnContext, TurnContextCallProvenance, TurnContextReceipts } from '../../packages/dsh-linguist/src/host/turn-context.ts'
import { ScheduleContextManager, scheduleExecutions, scheduleRunPolicy } from '../../packages/dsh-linguist/src/host/schedule-context.ts'
import { ScheduleId, createAfterScheduleRecord, createAtScheduleRecord, createEveryScheduleRecord, renderReminderFraming, renderRecurringReminderBatchFraming } from '../../packages/dsh-linguist/node_modules/@deepseek-ai/dsh-schedule/lib/index.js'

import { Session, SessionId } from '../../packages/dsh-linguist/node_modules/@deepseek-ai/dsh-session/lib/index.js'
import { Context } from '../../packages/dsh-linguist/node_modules/@deepseek-ai/cordis/lib/index.js'
import { apply as applyHost, inject as hostInject } from '../../packages/dsh-linguist/src/index.ts'
import { ScheduleSessionRuntime } from '../../packages/dsh-linguist/src/host/schedule-session.ts'
import { ModelCallProvenance } from '../../packages/dsh-linguist/src/host/model-provenance.ts'
import { buildLinguistPromptSection } from '../../packages/dsh-linguist/src/host/diagnostics.ts'

const requireFormats = createRequire(new URL('../../packages/linguist-cat-formats/package.json', import.meta.url))
const requireDsh = createRequire(new URL('../../packages/dsh-linguist/package.json', import.meta.url))
const JSZip = requireFormats('jszip')
const { Type } = requireDsh('typebox')
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex')

// Native settings and source removal are exercised by schedule-session-independence.nodetest.mjs.
function scheduleOwnerRuntime(bindings) {
  return {
    async resolve(id) { return { id } },
    async create(_source, binding, _title, record) {
      const id = SessionId(`session-task-${randomUUID()}`)
      bindings.bindSession(id, binding)
      record({ sessionId: id, createdAt: new Date().toISOString() })
      return { id }
    },
  }
}

test('Host schedule callbacks use Sessions through the real Cordis injection boundary', async () => {
  const root = mkdtempSync(join(tmpdir(), 'la-dsh-host-inject-'))
  const ctx = new Context()
  const session = Session.create(SessionId('session-inject-fixture'))
  let pluginContext, reads = 0, flushes = 0
  const services = {
    agents: { list: () => [] },
    skills: { registerProvider: () => () => {} },
    webServer: { register: () => () => {} },
    sessions: {
      get(id) { assert.equal(id, session.id); reads++; return session },
      async flush(value) { assert.equal(value, session); flushes++; return true },
    },
  }
  const providers = ctx.plugin({ apply(provider) {
    for (const key of new Set([...hostInject, 'sessions'])) provider.provide(key, services[key] ?? {})
  } })
  await providers.await()
  const plugin = ctx.plugin({ inject: hostInject, apply(scoped) {
    pluginContext = scoped
    applyHost(scoped, { dataRoot: root, installationId: 'synthetic-injection', notificationDestinations: { get: () => [] } })
  } })
  try {
    await plugin.await()
    // The installed Host callback shares the event reader used by Schedule list/admission.
    await ctx.serial('session/event', session, { type: 'turn/end', data: { turn: 1 } })
    assert.equal(reads, 1)
    await new ScheduleSessionRuntime(pluginContext, new BindingStore(root), () => {}).flush({ session })
    assert.equal(flushes, 1)
  } finally { await plugin.dispose(); await providers.dispose(); rmSync(root, { recursive: true, force: true }) }
})

test('seven packaged skills use the real native registry, bundled precedence, resources and disposal', async () => {
  const { SkillRegistry, BUNDLED_SKILL_RANK } = requireDsh('@deepseek-ai/dsh-skill')
  const { FileSystemSkillProvider } = requireDsh('@deepseek-ai/dsh-skill-filesystem')
  const ctx = new Context()
  const registry = ctx.plugin(SkillRegistry)
  await registry.await()
  const native = ctx.skills
  const plugin = ctx.plugin({ inject: ['skills'], apply(scoped) {
    scoped.skills.registerProvider(control => new FileSystemSkillProvider(scoped, control, {
      providerName: 'linguist', includeDefaultRoots: false, watch: false,
      bundledSkillDir: fileURLToPath(new URL('../../packages/dsh-linguist/resources/skills/', import.meta.url)),
    }))
  } })
  await plugin.await()
  try {
    const catalog = await native.list()
    assert.deepEqual(catalog.map(skill => skill.name), ['cultural-lqa', 'game-localization', 'localization-readiness', 'phrase-platform-review-ops', 'release-lqa', 'terminology-candidate-mining', 'translator-brief'])
    for (const skill of catalog) {
      assert.equal(skill.source, 'bundled')
      assert.equal(skill.provider, 'linguist')
      const loaded = await native.get(skill.name)
      assert.ok(loaded.content.length > 100)
      assert.equal(loaded.resourceBase.kind, 'directory')
      assert.ok(readFileSync(loaded.path, 'utf8').includes(loaded.content))
      for (const [, ref] of loaded.content.matchAll(/\]\((references\/[^)]+)\)/g)) {
        assert.ok(readFileSync(join(loaded.resourceBase.path, ref), 'utf8').length > 100)
      }
    }
    const user = ctx.plugin({ inject: ['skills'], apply(scoped) {
      scoped.skills.registerProvider(() => ({
        name: 'synthetic-user',
        async list() { return [{ name: 'game-localization', description: 'User choice', source: 'user-dsh', provider: 'synthetic-user', rank: BUNDLED_SKILL_RANK - 100, locator: 'choice', invocation: { modelInvocable: true, userInvocable: true } }] },
        async get(candidate) { return { ...candidate, content: 'User customized localization skill' } },
      }))
    } })
    await user.await()
    assert.equal((await native.get('game-localization')).provider, 'synthetic-user')
    await plugin.dispose()
    assert.deepEqual((await native.list()).map(skill => skill.name), ['game-localization'])
    await user.dispose()
    assert.deepEqual(await native.list(), [])
  } finally { await plugin.dispose(); await registry.dispose() }
})

test('generation provenance freezes the dispatched prompt, actual model and schemas for root and PTC calls', () => {
  const roleText = loadLinguistRoleResources(new URL('../../packages/dsh-linguist/resources/linguist-roles/', import.meta.url))
  const prompt = buildLinguistPromptSection({}, roleText, { role: 'general', workMode: 'cat' })
  const provenance = new ModelCallProvenance()
  const { createSystemMessage } = requireDsh('@deepseek-ai/dsh-llm')
  const tools = [{ name: 'run_code', description: 'Actual native transport', parameters: { type: 'object' } }]
  const request = { provider: 'real-request-route', model: 'actual-request-model', messages: [createSystemMessage(`Native host instructions\n${prompt.prompt}`)], tools }
  provenance.dispatched(request, prompt)
  provenance.observe({ type: 'tool/call', data: { turn: 1, step: 0, callId: 'root-requested-call' } })
  provenance.associateNestedCall('nested-cat-call', 'root-requested-call')
  const captured = provenance.forCall('nested-cat-call')
  assert.deepEqual(captured, { modelProvider: request.provider, modelId: request.model, linguistPromptVersion: prompt.status.promptVersion, promptHash: sha256(prompt.prompt), toolsetHash: sha256(JSON.stringify(tools)) })
  tools[0].description = 'Later changed schema'
  provenance.dispatched({ ...request, purpose: 'session-title', model: 'auxiliary-model' }, prompt)
  assert.deepEqual(provenance.forCall('nested-cat-call'), captured)
  const nextPrompt = { prompt: 'New rendered Linguist section', status: { ...prompt.status, promptHash: sha256('New rendered Linguist section') } }
  provenance.dispatched({ ...request, model: 'next-model', messages: [createSystemMessage(nextPrompt.prompt)] }, nextPrompt)
  provenance.observe({ type: 'tool/call', data: { turn: 1, step: 1, callId: 'next-call' } })
  assert.equal(provenance.forCall('next-call').modelId, 'next-model')
  assert.equal(provenance.forCall('next-call').promptHash, nextPrompt.status.promptHash)
  assert.notEqual(provenance.forCall('next-call').toolsetHash, captured.toolsetHash)
  assert.deepEqual(provenance.forCall('root-requested-call'), captured)
  assert.throws(() => provenance.dispatched({ ...request, messages: [] }, prompt), /does not contain/)
  assert.throws(() => provenance.forCall('made-up-call'), /no observed/)
  provenance.observe({ type: 'turn/end', data: { turn: 1 } })
  assert.throws(() => provenance.forCall('nested-cat-call'), /no observed/)
})

test('CAT worker progress crosses the adapter and SSE before settlement, with durable running and cancelled job state', async () => {
  const root = mkdtempSync(join(tmpdir(), 'la-dsh-job-progress-'))
  const service = new LinguistProjectService({ rootDir: join(root, 'linguist'), applicationVersion: 'synthetic-test' })
  service.init()
  try {
    const project = await service.createProject({ name: 'Synthetic job progress', sourceLocale: 'en-US', targetLocale: 'zh-CN' })
    const imported = await service.importAsset(project.id, { filename: 'progress.csv', bytes: new TextEncoder().encode('key,source,target\na,Start,开始\n') })
    const db = service.openProject(project.id)
    const bus = new MutationBus()
    const frames = []
    const unsubscribe = bus.subscribe(project.id, 0, { write: frame => { frames.push(frame); return true } })
    let enterWorker
    const entered = new Promise(resolve => { enterWorker = resolve })
    const source = createLinguistCatTools({
      sessionId: 'job-session', resolveProject: () => ({ project: service.getProject(project.id), db }),
      qaWorker: async (_request, signal, onProgress) => {
        onProgress('started')
        enterWorker()
        await new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(signal.reason), { once: true }))
      },
    }).find(tool => tool.name === 'cat_run_qa')
    const tool = adaptCatTool(source, {}, undefined, undefined, (toolCallId, update) => {
      const { jobId, ...job } = update.details.jobProgress
      bus.publish(project.id, { kind: 'job-updated', sessionId: 'job-session', toolCallId, jobId, job })
    })
    const abort = new AbortController()
    const pending = tool.execute({ batchId: imported.assetId }, { callId: 'qa-progress-call', signal: abort.signal })
    const rejected = assert.rejects(pending, /cancelled/)
    await entered
    const progress = frames.filter(frame => frame.startsWith('id: ')).map(frame => JSON.parse(frame.split('\ndata: ')[1]))
    const current = progress.at(-1)
    assert.equal(current.job.status, 'running')
    assert.equal(current.toolCallId, 'qa-progress-call')
    assert.equal(current.job.total, 1)
    const summary = await dispatchOperation({ operation: 'linguistCatGetLatestRunSummary', payload: { projectId: project.id }, service })
    assert.equal(summary.summary.job.jobId, current.jobId)
    assert.equal(summary.summary.job.status, 'running')
    abort.abort(new Error('cancelled'))
    await rejected
    const last = JSON.parse(frames.filter(frame => frame.startsWith('id: ')).at(-1).split('\ndata: ')[1])
    assert.equal(last.job.status, 'cancelled')
    assert.equal(db.runs.getJob(current.jobId, { sessionId: 'job-session' }).status, 'cancelled')
    const readJob = sessionId => dispatchOperation({ operation: 'linguistCatGetJob', payload: { projectId: project.id, sessionId, jobId: current.jobId }, service, assertProjectSession: async (_sessionId, projectId) => { assert.equal(projectId, project.id) } })
    assert.deepEqual((await readJob('job-session')).job, { jobId: current.jobId, sessionId: 'job-session', runId: summary.summary.runId, ...last.job })
    await assert.rejects(readJob('other-session'), /session/i)
    for (const name of ['cat_run_qa', 'cat_plan_consistency_repairs']) {
      const updates = []
      const source = createLinguistCatTools({ sessionId: 'completed-job-session', resolveProject: () => ({ project: service.getProject(project.id), db }) }).find(tool => tool.name === name)
      const adapted = adaptCatTool(source, {}, undefined, undefined, (_callId, update) => { updates.push(update.details.jobProgress) })
      await adapted.execute(name === 'cat_run_qa' ? { batchId: imported.assetId } : {}, { callId: `${name}-complete`, signal: new AbortController().signal })
      assert.ok(updates.some(update => update.status === 'running'))
      assert.equal(updates.at(-1).status, 'completed')
      assert.equal(updates.at(-1).completed, 1)
      assert.equal(db.runs.getJob(updates.at(-1).jobId, { sessionId: 'completed-job-session' }).status, 'completed')
    }
    unsubscribe()
  } finally { service.closeAll(); rmSync(root, { recursive: true, force: true }) }
})

test('native CAT tool adapter preserves required fields, unions, limits, cancellation and errors', async () => {
  const calls = []
  const presented = []
  const source = {
    name: 'synthetic_schema_boundary', description: 'Synthetic schema boundary',
    parameters: Type.Object({
      mode: Type.Union([Type.Literal('read'), Type.Literal('write')]),
      entries: Type.Array(Type.String({ minLength: 1 }), { minItems: 1, maxItems: 2 }),
    }, { additionalProperties: false }),
    async execute(callId, args, signal) {
      calls.push({ callId, args, signal })
      if (signal.aborted) throw new Error('cancelled')
      if (args.mode === 'write') throw new Error('domain write failed')
      return { content: [{ type: 'text', text: 'Synthetic result' }], details: { count: args.entries.length } }
    },
  }
  const tool = adaptCatTool(source, { saveImage: () => { throw new Error('No image expected') } }, (callId, content) => presented.push({ callId, content }))
  assert.deepEqual(tool.parameters, JSON.parse(JSON.stringify(source.parameters)))
  const signal = new AbortController().signal
  const exec = { callId: 'synthetic-call', signal }
  for (const args of [{ entries: ['one'] }, { mode: 'other', entries: ['one'] },
    { mode: 'read', entries: [] }, { mode: 'read', entries: ['one', 'two', 'three'] },
    { mode: 'read', entries: ['one'], unexpected: true }]) {
    await assert.rejects(tool.execute(args, exec), /Invalid synthetic_schema_boundary arguments/)
  }
  assert.equal(calls.length, 0)
  const output = await tool.execute({ mode: 'read', entries: ['one'] }, exec)
  assert.deepEqual(output, { content: [{ type: 'text', text: 'Synthetic result' }], details: { count: 1 } })
  assert.deepEqual(tool.output.render({}, output), output.content)
  assert.equal(calls[0].signal, signal)
  assert.deepEqual(presented, [{ callId: 'synthetic-call', content: output.content }])
  await assert.rejects(tool.execute({ mode: 'write', entries: ['one'] }, exec), /domain write failed/)
  const cancelled = new AbortController()
  cancelled.abort()
  await assert.rejects(tool.execute({ mode: 'read', entries: ['one'] }, { ...exec, signal: cancelled.signal }), /cancelled/)
  assert.equal(presented.length, 1, 'failed or cancelled calls must not present model evidence')
})

test('native CAT image results carry actual bytes into the DSH attachment and presented content', async () => {
  const pixels = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jR3sAAAAASUVORK5CYII=', 'base64')
  const saved = []
  const presented = []
  const tool = adaptCatTool({
    name: 'synthetic_image', description: 'Synthetic image', parameters: Type.Object({}),
    async execute() { return { content: [{ type: 'image', mimeType: 'image/png', data: pixels.toString('base64') }] } },
  }, { async saveImage(image) { saved.push(image); return { id: 'synthetic-attachment' } } }, (callId, content) => presented.push({ callId, content }))
  const result = await tool.execute({}, { callId: 'image-call', signal: new AbortController().signal })
  assert.equal(saved.length, 1)
  assert.equal(saved[0].mediaType, 'image/png')
  assert.deepEqual(saved[0].data, pixels)
  assert.deepEqual(result.content, [{ type: 'image', attachment: { id: 'synthetic-attachment' } }])
  assert.deepEqual(presented, [{ callId: 'image-call', content: result.content }])
})

test('import preview rejects mapping.json and malformed XML, keeps Phrase recovery across extensions and writes nothing', async () => {
  const root = mkdtempSync(join(tmpdir(), 'la-dsh-intake-boundary-'))
  const service = new LinguistProjectService({ rootDir: join(root, 'linguist'), applicationVersion: 'synthetic-test' })
  service.init()
  try {
    const project = await service.createProject({ name: 'Synthetic intake', sourceLocale: 'en-US', targetLocale: 'zh-CN' })
    writeFileSync(join(root, 'mapping.json'), '{"sourceColumn":"A","targetColumn":"B"}')
    writeFileSync(join(root, 'broken.xliff'), '<xliff version="1.2"><file><body><trans-unit id="a"><source>Open</source></file></xliff>')
    const split = '<xliff version="1.2" xmlns:m="http://www.memsource.com/mxlf/2.0"><file><body><trans-unit id="one"><source>Open {0}</source><target>打开 {0}</target></trans-unit></body></file></xliff>'
    for (const extension of ['mxliff', 'xlf', 'xliff']) writeFileSync(join(root, `split.${extension}`), split)
    const report = await service.importResourcesFromPaths(project.id, root, {
      paths: ['mapping.json', 'broken.xliff', 'split.mxliff', 'split.xlf', 'split.xliff'],
      recursive: false, kind: 'auto', dryRun: true,
    })
    const byName = Object.fromEntries(report.items.map(item => [item.filename, item]))
    assert.notEqual(byName['mapping.json'].status, 'ready', 'mapping configuration must not be accepted as a translation batch')
    assert.notEqual(byName['broken.xliff'].status, 'ready')
    assert.deepEqual(['mxliff', 'xlf', 'xliff'].map(extension => byName[`split.${extension}`].status),
      ['needs-input', 'needs-input', 'needs-input'])
    assert.equal(service.openProject(project.id).assets.listByProject().length, 0)
    assert.equal(service.openProject(project.id).contextDocs.count(), 0)
    assert.equal(readFileSync(join(root, 'split.mxliff'), 'utf8'), split)
  } finally { service.closeAll(); rmSync(root, { recursive: true, force: true }) }
})

test('local HTTP rejects cross-site access and unsafe files while SSE replays only until disconnect', async () => {
  const root = mkdtempSync(join(tmpdir(), 'la-dsh-http-boundary-'))
  try {
    const mutations = new MutationBus()
    let handler
    const service = { getStatus: () => ({ state: 'ready' }), getProject: id => ({ id }) }
    registerHttpRoutes({
      ctx: { webServer: { register: route => { handler = route.handler; return () => {} } } },
      service,
      bindings: new BindingStore(root), files: new ManagedFiles(root), mutations,
      installationId: 'synthetic-installation', rebindAgent: () => {},
      dispatch: async () => { throw new Error('synthetic dispatch failure') },
    })
    const send = async (url, headers = { host: '127.0.0.1:19387' }, method = 'GET', body = '') => {
      const request = Object.assign(body ? Readable.from([Buffer.from(body)]) : new EventEmitter(), { method, url, headers })
      const chunks = []
      const response = {
        headersSent: false, statusCode: 0,
        writeHead(status, responseHeaders) { this.statusCode = status; this.headers = responseHeaders; this.headersSent = true },
        write(chunk) { chunks.push(chunk) },
        end(chunk) { if (chunk) chunks.push(chunk) },
      }
      await handler(request, response)
      return { request, response, chunks, json: () => JSON.parse(chunks.join('')) }
    }
    assert.equal((await send('/la/v1/status', { host: 'example.com' })).response.statusCode, 403)
    assert.equal((await send('/la/v1/status', { host: '127.0.0.1:19387', origin: 'https://evil.example' })).response.statusCode, 403)
    assert.equal((await send('/la/v1/status', { host: '127.0.0.1:19387', 'sec-fetch-site': 'cross-site' })).response.statusCode, 403)
    assert.equal((await send('/la/v1/files/../../private')).response.statusCode, 404)
    assert.equal((await send('/la/v1/files/not-a-token')).response.statusCode, 404)
    const status = await send('/la/v1/status')
    assert.equal(status.response.statusCode, 200)
    assert.equal(status.json().installationId, 'synthetic-installation')
    assert.equal(status.response.headers['Cache-Control'], 'no-store')
    service.getStatus = () => { throw new Error('/private/customer/secret') }
    const failedStatus = await send('/la/v1/status')
    assert.equal(failedStatus.response.statusCode, 500)
    assert.deepEqual(failedStatus.json(), { error: 'Unexpected internal error.' })
    const failure = await send('/la/v1/invoke', { host: '127.0.0.1:19387', origin: 'http://127.0.0.1:19387', 'content-type': 'application/json' },
      'POST', JSON.stringify({ operation: 'synthetic', input: {} }))
    assert.deepEqual(failure.json(), { ok: false, error: { code: 'INTERNAL', message: 'Unexpected internal error.' } })
    const prior = mutations.publish('synthetic-project', { kind: 'prior' })
    const sse = await send('/la/v1/events?projectId=synthetic-project&afterSequence=0')
    assert.equal(sse.response.statusCode, 200)
    assert.match(sse.chunks[0], /event: snapshot/)
    assert.match(sse.chunks[0], new RegExp(mutations.epoch))
    assert.match(sse.chunks[1], new RegExp(String(prior.revision)))
    mutations.publish('synthetic-project', { kind: 'live' })
    assert.equal(sse.chunks.length, 3)
    sse.request.emit('close')
    mutations.publish('synthetic-project', { kind: 'late' })
    assert.equal(sse.chunks.length, 3)
  } finally { rmSync(root, { recursive: true, force: true }) }
})

test('packaged role resources fail with stable path-free errors when missing or oversized', () => {
  const root = mkdtempSync(join(tmpdir(), 'la-dsh-role-resources-'))
  try {
    const base = new URL(`file://${root}/`)
    for (const role of ['general', 'translator', 'reviewer', 'proofreader']) writeFileSync(join(root, `${role}.md`), `# ${role}`)
    assert.equal(loadLinguistRoleResources(base).reviewer, '# reviewer')
    rmSync(join(root, 'reviewer.md'))
    assert.throws(() => loadLinguistRoleResources(base), error => error.message === 'Linguist reviewer role resource unavailable' && !error.message.includes(root))
    writeFileSync(join(root, 'reviewer.md'), 'x'.repeat(6_001))
    assert.throws(() => loadLinguistRoleResources(base), error => error.message === 'Linguist reviewer role resource invalid' && !error.message.includes(root))
  } finally { rmSync(root, { recursive: true, force: true }) }
})

test('invoke error preserves only safe typed counts and format classification', () => {
  assert.deepEqual(invokeError(new TypeError('input /private/customer/secret')), { code: 'INVALID_INPUT', message: 'Invalid Linguist input.' })
  assert.deepEqual(invokeError(Object.assign(new Error('/private/customer/secret'), { code: 'STORE_READ_ONLY' })),
    { code: 'STORE_READ_ONLY', message: 'Linguist request failed.' })
  assert.deepEqual(invokeError(Object.assign(new Error('/private/customer/secret'), { code: 'STORE_DATABASE_IDENTITY' })),
    { code: 'INTERNAL', message: 'Unexpected internal error.' })
  assert.deepEqual(invokeError({ code: 'INVALID_INPUT', message: '/private/customer/secret' }),
    { code: 'INTERNAL', message: 'Unexpected internal error.' })
  const countError = Object.assign(new Error('Downstream references block import undo'), {
    code: 'IMPORT_UNDO_BLOCKED', details: { proposals: 2, jobs: 1 },
  })
  assert.deepEqual(invokeError(countError).details, { proposals: 2, jobs: 1 })
  countError.details = { proposals: 2, path: '/private/customer-file' }
  assert.equal(invokeError(countError).details, undefined)
  const format = invokeError(new FormatParseError('synthetic-csv', '/private/customer/path/sample.csv', 'Customer text: <secret>'))
  assert.equal(format.formatDetails?.code, 'FORMAT_PARSE_ERROR')
  assert.equal(format.formatDetails?.filename, 'sample.csv')
  assert.doesNotMatch(JSON.stringify(format), /private|<secret>|Customer text/)
})

test('Session copy HTTP errors expose residual identity and cleanup state without underlying exception data', () => {
  for (const cleanup of ['not-started', 'completed', 'failed']) {
    const error = new LinguistSessionCopyError('session-synthetic-copy', cleanup, { cause: new Error('Synthetic secret /private/fixture') })
    error.internalPath = '/private/fixture'
    const projected = invokeError(error)
    assert.equal(projected.code, 'SESSION_COPY_FAILED')
    assert.deepEqual(projected.sessionCopyDetails, { sessionId: 'session-synthetic-copy', cleanup })
    assert.match(projected.message, /session-synthetic-copy/)
    assert.match(projected.message, cleanup === 'not-started' ? /before a usable copy/ : cleanup === 'completed' ? /archived.*restore/ : /cleanup failed/)
    assert.doesNotMatch(JSON.stringify(projected), /Synthetic secret|private|internalPath|cause|stack/)
  }
})

test('LA Schedule creates a native DSH task and admits only an unchanged bound due occurrence', async () => {
  const root = mkdtempSync(join(tmpdir(), 'la-dsh-schedule-native-'))
  const service = new LinguistProjectService({ rootDir: join(root, 'linguist'), applicationVersion: 'synthetic-test' })
  service.init()
  try {
    const project = await service.createProject({ name: 'Synthetic due', sourceLocale: 'zh-CN', targetLocale: 'en-US' })
    await service.importAsset(project.id, { bytes: new TextEncoder().encode('key,source,target\na,开始,Begin\n'), filename: 'due.csv' })
    const segment = service.openProject(project.id).segments.query({ limit: 1 })[0]
    const bindings = new BindingStore(root)
    bindings.bindProject(project.id, 'workspace-schedule')
    const binding = { workspaceId: 'workspace-schedule', projectId: project.id, role: 'reviewer', workMode: 'cat' }
    bindings.bindSession('session-schedule', binding)
    const assertProjectSession = async (sessionId, projectId) => {
      assert.equal(bindings.session(sessionId)?.projectId, projectId)
      assert.equal(bindings.projectWorkspace(projectId), 'workspace-schedule')
    }
    const native = {
      rows: [],
      async create(sessionId, request) {
        const id = ScheduleId(`schedule-${randomUUID()}`)
        const record = request.at !== undefined ? createAtScheduleRecord(id, request.prompt, request.at, Date.now(), request.title) : request.after_seconds === undefined
          ? createEveryScheduleRecord(id, request.prompt, request.every_seconds, Date.now(), request.title)
          : createAfterScheduleRecord(id, request.prompt, request.after_seconds, Date.now(), request.title)
        this.rows.push({ ...record, sessionId, status: 'active' })
        if (this.beforeReturn) { await this.beforeReturn(record); this.beforeReturn = undefined }
        return record
      },
      async catalog() { return this.rows },
      async update({ sessionId, id, expected, title, prompt, change }) {
        const row = this.rows.find(item => item.sessionId === sessionId && item.id === id)
        if (!row || row.scheduledAt !== expected.scheduledAt || row.prompt !== expected.prompt) return { id, updated: false, code: 'schedule_conflict' }
        const record = change === undefined ? { ...expected, title, prompt }
          : createEveryScheduleRecord(id, prompt, change.every_seconds, Date.now(), title)
        this.rows = this.rows.map(item => item === row ? { ...record, sessionId, status: 'active' } : item)
        return { id, updated: true, record }
      },
      async history({ id }) { return { id, records: [{ scheduledAt: new Date().toISOString(), deliveredAt: new Date().toISOString(), messageId: `message-${id}`, prompt: this.rows.find(item => item.id === id)?.prompt }], earlierRecordsUnavailable: false, earlierRecordsPruned: false, retention: { days: 30, records: 200 } } },
      async delete({ sessionId, id }) {
        const row = this.rows.find(item => item.sessionId === sessionId && item.id === id)
        if (!row) return { id, deleted: false, code: 'schedule_not_found' }
        this.rows = this.rows.filter(item => item !== row)
        return { id, deleted: true }
      },
    }
    const runtime = scheduleOwnerRuntime(bindings)
    const manager = new ScheduleContextManager(root, native, service, bindings, assertProjectSession, async () => [], runtime)
    native.beforeReturn = async record => {
      const early = { id: 'early-due', role: 'user', source: { kind: 'schedule' }, content: [{ type: 'text', text: renderReminderFraming(record) }] }
      assert.equal((await manager.onPreStep({ id: native.rows.find(item => item.id === record.id).sessionId }, { kind: 'enter', messages: [early] }, 0, 0)).messages[1].source.kind, 'linguist-schedule-execution')
    }
    const turnContext = { schemaVersion: 1, projectId: project.id, assetId: segment.assetId, selectedSegmentIds: [segment.id], capturedAt: new Date().toISOString(), uiRevision: 1 }
    const base = { operation: 'linguistScheduleCreate', payload: {
      sessionId: 'session-schedule', projectId: project.id, title: 'Review selected Segment', prompt: 'Review the selected source and current target.',
      executeAtDue: true, scope: 'segments', turnContext, timing: { kind: 'after', seconds: 120 },
    }, service, bindings, workspaceRegistry: { get: () => ({ id: 'workspace-schedule', path: root }) },
    files: new ManagedFiles(root), mutations: new MutationBus(), assertProjectSession,
    resolveSessionWorkspace: async () => ({ workspaceRoot: root }), scheduleContext: manager }
    await assert.rejects(dispatchOperation({ ...base, payload: { ...base.payload, notificationTargets: [{ destinationId: 'unconfigured', trigger: 'always' }] } }), /Unknown schedule notification destination/)
    await assert.rejects(dispatchOperation({ ...base, payload: { ...base.payload, notificationTargets: [{ destinationId: 'unconfigured', trigger: 'invalid' }] } }), /trigger/)
    assert.equal(native.rows.length, 0, 'invalid notification consent cannot create a native task')
    const created = await dispatchOperation(base)
    assert.equal(created.projectId, project.id)
    assert.equal(created.role, 'reviewer')
    assert.equal(created.scope, 'segments')
    assert.equal(created.scheduleId, native.rows[0].id)
    assert.match(native.rows[0].prompt, /\[LA-SCHEDULE-CONTEXT v1 token=/)
    const originalTarget = native.rows[0].scheduledAt
    const titleOnly = await dispatchOperation({ ...base, operation: 'linguistScheduleUpdate', payload: { ...base.payload,
      scheduleId: created.scheduleId, expectedVersion: created.version, title: 'Title-only review edit' } })
    assert.equal(titleOnly.kind, 'after')
    assert.equal(titleOnly.scheduledAt, originalTarget)
    const message = { id: 'due-message', role: 'user', source: { kind: 'schedule' }, content: [{ type: 'text', text: renderReminderFraming(native.rows[0]) }] }
    const agent = { id: created.sessionId }
    const manualMessages = []
    const reopened = new ScheduleContextManager(root, native, service, bindings, assertProjectSession, async () => [], runtime,
      async (sessionId, manualMessage) => { assert(native.rows.some(row => row.sessionId === sessionId)); manualMessages.push(manualMessage) })
    const manual = await dispatchOperation({ ...base, scheduleContext: reopened, operation: 'linguistScheduleRunNow',
      payload: { sessionId: 'session-schedule', scheduleId: created.scheduleId, expectedVersion: titleOnly.version } })
    assert.equal(manual.status, 'accepted')
    assert.equal(manual.messageId, manualMessages[0].id)
    assert.equal(native.rows[0].scheduledAt, originalTarget)
    const manualAdmitted = await reopened.onPreStep(agent, { kind: 'enter', messages: manualMessages }, 0, 1)
    assert.equal(manualAdmitted.messages[1].source.kind, 'linguist-schedule-execution')
    assert.match(manualAdmitted.messages[1].content[0].text, /"trigger":"manual"/)
    await assert.rejects(dispatchOperation({ ...base, scheduleContext: reopened, operation: 'linguistScheduleRunNow',
      payload: { sessionId: 'session-schedule', scheduleId: created.scheduleId, expectedVersion: created.version } }), /changed since it was listed/)
    const admitted = await reopened.onPreStep(agent, { kind: 'enter', messages: [message] }, 1, 1)
    assert.equal(admitted.messages.length, 2)
    assert.equal(admitted.messages[0], message)
    assert.equal(admitted.messages[1].source.kind, 'linguist-schedule-execution')
    assert.match(admitted.messages[1].content[0].text, /Review the selected source and current target/)
    assert.match(admitted.messages[1].content[0].text, new RegExp(segment.id))
    await assert.rejects(reopened.validateModelRequest(agent, 1, 1, { provider: 'synthetic', model: 'chosen' }, async () => { throw new Error('model unavailable') }), /model unavailable/)
    await reopened.validateModelRequest(agent, 1, 1, { provider: 'synthetic', model: 'chosen' }, async (provider, model) => {
      assert.equal(provider, 'synthetic')
      assert.equal(model, 'chosen')
    })
    const generic = { ...message, content: [{ type: 'text', text: renderReminderFraming({ ...native.rows[0], id: ScheduleId(`schedule-${randomUUID()}`), prompt: 'Drink water' }) }] }
    assert.deepEqual((await reopened.onPreStep(agent, { kind: 'enter', messages: [generic] }, 1, 2)).messages, [generic])
    const removedMarker = { ...message, content: [{ type: 'text', text: renderReminderFraming({ ...native.rows[0], prompt: 'Edited task without marker' }) }] }
    await assert.rejects(reopened.onPreStep(agent, { kind: 'enter', messages: [removedMarker] }, 1, 3), /marker was removed/)
    const recurring = await dispatchOperation({ ...base, payload: { ...base.payload, title: 'Recurring review', timing: { kind: 'every', seconds: 180 } } })
    assert.equal(recurring.kind, 'every')
    const ordinary = createEveryScheduleRecord(ScheduleId(`schedule-${randomUUID()}`), 'Ordinary reminder', 180, Date.now(), 'Ordinary')
    const batch = { ...message, content: [{ type: 'text', text: renderRecurringReminderBatchFraming([
      { record: native.rows[1], occurrenceAt: native.rows[1].scheduledAt },
      { record: ordinary, occurrenceAt: ordinary.scheduledAt },
    ]) }] }
    const batchAdmitted = await reopened.onPreStep({ id: recurring.sessionId }, { kind: 'enter', messages: [batch] }, 2, 1)
    assert.equal(batchAdmitted.messages.length, 2)
    assert.equal(batchAdmitted.messages[1].source.scheduleId, recurring.scheduleId)
    const listed = await dispatchOperation({ ...base, operation: 'linguistScheduleList', payload: { sessionId: 'session-schedule' } })
    assert.equal(listed.items.length, 2)
    assert.equal(listed.items[1].authorizationStatus, 'ready')
    const history = await dispatchOperation({ ...base, operation: 'linguistScheduleHistory', payload: { sessionId: 'session-schedule', scheduleId: recurring.scheduleId, limit: 10 } })
    assert.equal(history.records[0].prompt, 'Review the selected source and current target.')
    const edited = await dispatchOperation({ ...base, operation: 'linguistScheduleUpdate', payload: { ...base.payload,
      scheduleId: recurring.scheduleId, expectedVersion: recurring.version, title: 'Edited recurring review',
      prompt: 'Review the frozen selection again.', timing: { kind: 'every', seconds: 240 } } })
    assert.equal(edited.scheduleId, recurring.scheduleId)
    assert.notEqual(edited.version, recurring.version)
    assert.equal((await manager.list('session-schedule')).items[1].authorizationStatus, 'ready')
    await assert.rejects(dispatchOperation({ ...base, operation: 'linguistScheduleUpdate', payload: { ...base.payload,
      scheduleId: recurring.scheduleId, expectedVersion: recurring.version } }), /changed since it was listed/)
    native.rows[1] = { ...native.rows[1], everySeconds: 300 }
    await assert.rejects(reopened.onPreStep({ id: recurring.sessionId }, { kind: 'enter', messages: [batch] }, 2, 2), /identity changed|deleted or changed/)
    native.rows[0] = { ...native.rows[0], title: 'Edited in native Schedule UI' }
    await assert.rejects(reopened.onPreStep(agent, { kind: 'enter', messages: [message] }, 3, 1), /deleted or changed/)
    native.rows[0] = { ...native.rows[0], title: 'Title-only review edit' }
    bindings.bindSession(created.sessionId, { ...binding, role: 'general' })
    await assert.rejects(reopened.onPreStep(agent, { kind: 'enter', messages: [message] }, 4, 1), /no longer matches/)
    bindings.bindSession(created.sessionId, binding)
    const events = []
    const limitedManager = new ScheduleContextManager(root, native, service, bindings, assertProjectSession, async () => events, runtime,
      async () => { throw new Error('A capped task must not be delivered') })
    const limitedInput = { ...base, scheduleContext: limitedManager, payload: { ...base.payload,
      maxRuns: 2, timing: { kind: 'every', seconds: 180 } } }
    await assert.rejects(dispatchOperation({ ...limitedInput, payload: { ...limitedInput.payload, maxRuns: 0 } }), /maxRuns/)
    const limited = await dispatchOperation(limitedInput)
    const limitEdit = await dispatchOperation({ ...limitedInput, operation: 'linguistScheduleUpdate', payload: {
      ...limitedInput.payload, scheduleId: limited.scheduleId, expectedVersion: limited.version, maxRuns: 3 } })
    assert.notEqual(limitEdit.version, limited.version, 'limit-only edit participates in CAS')
    const limitRestored = await dispatchOperation({ ...limitedInput, operation: 'linguistScheduleUpdate', payload: {
      ...limitedInput.payload, scheduleId: limited.scheduleId, expectedVersion: limitEdit.version } })
    let seq = 0
    const event = (type, data) => ({ type, data, seq: seq++, time: Date.now() + seq })
    const runMessage = id => event('user/message', { id, source: { kind: 'linguist-schedule-execution', scheduleId: limited.scheduleId } })
    events.push(event('turn/start', { turn: 1 }), runMessage('limited-first'), event('turn/end', { turn: 1, reason: { kind: 'error', error: { code: 'UNKNOWN', message: 'synthetic failure' } } }))
    events.push(event('turn/start', { turn: 2 }), runMessage('limited-second'))
    let limitedInfo = (await limitedManager.list('session-schedule')).items.find(item => item.scheduleId === limited.scheduleId)
    assert.equal(limitedInfo.runCount, 1, 'unfinished execution is not counted as ended')
    assert.equal(limitedInfo.status, 'active')
    events.push(event('turn/end', { turn: 2, reason: { kind: 'completed' } }))
    const nativeDelete = native.delete
    native.delete = async () => { throw new Error('synthetic delete failure') }
    const removal = limitedManager.enforceRunPolicy(limited.sessionId)
    assert.equal(limitedManager.enforceRunPolicy(limited.sessionId), removal, 'end and list checks share one removal')
    await assert.rejects(removal, /synthetic delete failure/)
    assert.equal((await limitedManager.history('session-schedule', limited.scheduleId, 10)).records.length, 1, 'history is durable before native removal')
    native.delete = nativeDelete
    await assert.rejects(limitedManager.runNow('session-schedule', limited.scheduleId, limitRestored.version), /maximum run count/)
    await Promise.all([limitedManager.enforceRunPolicy('session-schedule'), limitedManager.enforceRunPolicy('session-schedule')])
    assert(!native.rows.some(item => item.id === limited.scheduleId))
    limitedInfo = (await limitedManager.list('session-schedule')).items.find(item => item.scheduleId === limited.scheduleId)
    assert.equal(limitedInfo.runCount, 2, 'both failure and success count')
    assert.equal(limitedInfo.limitReached, true)
    assert.equal(limitedInfo.status, 'inactive')
    const coldLimited = new ScheduleContextManager(root, native, service, bindings, assertProjectSession, async () => [], runtime)
    assert.equal((await coldLimited.list('session-schedule')).items.find(item => item.scheduleId === limited.scheduleId).runCount, 2, 'retired task count comes from its preserved history')
    const kept = await coldLimited.history('session-schedule', limited.scheduleId, 10)
    assert.equal(kept.records[0].prompt, base.payload.prompt, 'native history is preserved before deletion')
    assert.deepEqual(kept.executions.map(run => run.outcome), ['completed', 'error'])
    await assert.rejects(coldLimited.history('session-schedule', limited.scheduleId, 10, 'foreign-cursor'), /cursor/)
    const failing = await limitedManager.create({ ...base.payload, title: 'Synthetic failing recurring task', timing: { kind: 'every', seconds: 60 } })
    await reopened.runNow('session-schedule', failing.scheduleId, failing.version)
    const staleManual = manualMessages.at(-1)
    const failingNative = native.rows.find(item => item.id === failing.scheduleId)
    const failingDue = { id: 'failing-due', role: 'user', source: { kind: 'schedule' }, content: [{ type: 'text', text: renderReminderFraming(failingNative) }] }
    for (let turn = 3; turn < 8; turn++) {
      events.push(event('turn/start', { turn }), event('user/message', { id: `failed-${turn}`, source: { kind: 'linguist-schedule-execution', scheduleId: failing.scheduleId } }),
        event('turn/end', { turn, reason: { kind: 'error', error: { code: 'UNKNOWN', message: 'synthetic failure' } } }))
      await limitedManager.enforceRunPolicy('session-schedule')
      assert.equal(native.rows.some(item => item.id === failing.scheduleId), turn < 7, 'fifth consecutive failure removes the native timer')
    }
    const failedInfo = (await limitedManager.list('session-schedule')).items.find(item => item.scheduleId === failing.scheduleId)
    assert.equal(failedInfo.pausedAfterFailures, true)
    assert.equal(failedInfo.limitReached, false)
    assert.equal(failedInfo.consecutiveFailures, 5)
    assert.equal(failedInfo.status, 'inactive')
    await assert.rejects(limitedManager.onPreStep({ id: failing.sessionId }, { kind: 'enter', messages: [failingDue] }, 8, 1), /five consecutive failures/)
    const coldFailure = new ScheduleContextManager(root, native, service, bindings, assertProjectSession, async () => [], runtime)
    assert.equal((await coldFailure.list('session-schedule')).items.find(item => item.scheduleId === failing.scheduleId).consecutiveFailures, 5)
    assert.equal((await coldFailure.history('session-schedule', failing.scheduleId, 10)).executions.length, 5)
    const resumeRequest = { ...base.payload, scheduleId: failing.scheduleId, expectedVersion: failedInfo.version, timing: { kind: 'every', seconds: 60 } }
    assert.notEqual(failedInfo.version, failing.version, 'pausing invalidates an active-task edit form')
    await assert.rejects(limitedManager.update({ ...resumeRequest, expectedVersion: failing.version }), /changed since it was listed/)
    native.beforeReturn = async () => {
      await assert.rejects(limitedManager.update(resumeRequest), /already in progress/)
      throw new Error('synthetic response lost after native create')
    }
    await assert.rejects(limitedManager.update(resumeRequest), /response lost/)
    const pendingTimer = native.rows.find(item => item.id !== created.scheduleId && item.id !== recurring.scheduleId)
    assert(pendingTimer, 'native timer committed before lost response')
    const pendingList = (await limitedManager.list('session-schedule')).items.filter(item => item.scheduleId === failing.scheduleId)
    assert.equal(pendingList.length, 1)
    assert.equal(pendingList[0].pausedAfterFailures, true)
    native.beforeReturn = undefined
    const nativeCount = native.rows.length
    const resumedManager = new ScheduleContextManager(root, native, service, bindings, assertProjectSession, async () => events, runtime,
      async (_sessionId, message) => manualMessages.push(message))
    const resumed = await resumedManager.update(resumeRequest)
    assert.equal(native.rows.length, nativeCount, 'retry reuses the committed pending timer')
    assert.equal(resumed.scheduleId, failing.scheduleId, 'resume preserves the public LA task identity')
    assert.notEqual(pendingTimer.id, resumed.scheduleId)
    const resumedInfo = (await resumedManager.list('session-schedule')).items.find(item => item.scheduleId === failing.scheduleId)
    assert.equal(resumedInfo.status, 'active')
    assert.equal(resumedInfo.consecutiveFailures, 0)
    assert.equal(resumedInfo.runCount, 5, 'resume does not reset lifetime run limit accounting')
    await assert.rejects(resumedManager.onPreStep({ id: failing.sessionId }, { kind: 'enter', messages: [failingDue] }, 8, 1), /identity changed/)
    const resumedDue = { id: 'resumed-due', role: 'user', source: { kind: 'schedule' }, content: [{ type: 'text', text: renderReminderFraming(pendingTimer) }] }
    await assert.rejects(resumedManager.onPreStep({ id: failing.sessionId }, { kind: 'enter', messages: [staleManual] }, 8, 1), /generation changed/)
    const resumedAdmission = await resumedManager.onPreStep({ id: failing.sessionId }, { kind: 'enter', messages: [resumedDue] }, 8, 1)
    assert.equal(resumedAdmission.messages[1].source.scheduleId, failing.scheduleId)
    await resumedManager.runNow('session-schedule', failing.scheduleId, resumed.version)
    assert.equal(manualMessages.at(-1).source.scheduleId, failing.scheduleId)
    const resumedHistory = await resumedManager.history('session-schedule', failing.scheduleId, 1)
    assert.equal(resumedHistory.records[0].messageId, `message-${pendingTimer.id}`)
    const previousHistory = await resumedManager.history('session-schedule', failing.scheduleId, 1, resumedHistory.nextBefore)
    assert.equal(previousHistory.records[0].messageId, `message-${failing.scheduleId}`)
    for (let turn = 8; turn < 13; turn++) {
      events.push(event('turn/start', { turn }), event('user/message', { id: `failed-${turn}`, source: { kind: 'linguist-schedule-execution', scheduleId: failing.scheduleId } }),
        event('turn/end', { turn, reason: { kind: 'error', error: { code: 'UNKNOWN', message: 'synthetic failure' } } }))
      await resumedManager.enforceRunPolicy('session-schedule')
      assert.equal(native.rows.some(item => item.id === pendingTimer.id), turn < 12, 'only new failures count after explicit resume')
    }
    const stoppedAgain = (await resumedManager.list('session-schedule')).items.find(item => item.scheduleId === failing.scheduleId)
    assert.equal(stoppedAgain.runCount, 10)
    assert.equal(stoppedAgain.consecutiveFailures, 5)
    const secondHistory = await resumedManager.history('session-schedule', failing.scheduleId, 100)
    assert.equal(secondHistory.records.length, 2)
    assert.equal(secondHistory.executions.length, 10)
    const executionPage = await dispatchOperation({ ...base, scheduleContext: resumedManager, operation: 'linguistScheduleHistory',
      payload: { sessionId: 'session-schedule', scheduleId: failing.scheduleId, limit: 3 } })
    assert.equal(executionPage.nextExecutionBefore, executionPage.executions.at(-1).messageId)
    const olderExecutions = await dispatchOperation({ ...base, scheduleContext: resumedManager, operation: 'linguistScheduleHistory',
      payload: { sessionId: 'session-schedule', scheduleId: failing.scheduleId, limit: 3, beforeExecution: executionPage.nextExecutionBefore } })
    assert.deepEqual(olderExecutions.executions, secondHistory.executions.slice(3, 6))
    assert.deepEqual(olderExecutions.records, executionPage.records, 'execution pagination is independent of native delivery history')
    const coldPage = await coldFailure.history('session-schedule', failing.scheduleId, 3, undefined, olderExecutions.nextExecutionBefore)
    assert.deepEqual(coldPage.executions, secondHistory.executions.slice(6, 9), 'retained execution pages survive a cold read')
    const finalPage = await coldFailure.history('session-schedule', failing.scheduleId, 3, undefined, coldPage.nextExecutionBefore)
    assert.deepEqual(finalPage.executions, secondHistory.executions.slice(9))
    assert.equal(finalPage.nextExecutionBefore, undefined)
    await assert.rejects(resumedManager.history('session-schedule', failing.scheduleId, 3, undefined, 'missing-execution'), /execution history cursor not found/)
    await assert.rejects(resumedManager.update({ ...resumeRequest, expectedVersion: stoppedAgain.version, maxRuns: 10 }), /maximum run count/)
    const atRequest = { ...resumeRequest, expectedVersion: stoppedAgain.version, timing: { kind: 'at', at: new Date(Date.now() + 600_000).toISOString() } }
    native.beforeReturn = async () => { throw new Error('synthetic second response lost') }
    await assert.rejects(resumedManager.update(atRequest), /second response lost/)
    const orphan = native.rows.find(item => item.id !== created.scheduleId && item.id !== recurring.scheduleId)
    native.beforeReturn = undefined
    const newAt = new Date(Date.now() + 900_000).toISOString()
    const resumedAt = await resumedManager.update({ ...atRequest, timing: { kind: 'at', at: newAt } })
    assert.equal(resumedAt.scheduleId, failing.scheduleId)
    assert.equal(resumedAt.scheduledAt, newAt, 'retry with a changed absolute time cannot reuse the old deadline')
    assert(!native.rows.some(item => item.id === orphan.id))
    assert.equal((await resumedManager.cancel('session-schedule', failing.scheduleId)).cancelled, true, 'stable public identity cancels the replacement native timer')

    await service.importAsset(project.id, { bytes: new TextEncoder().encode('key,source,target\nb,结束,End\n'), filename: 'changed.csv' })
    await assert.rejects(reopened.onPreStep(agent, { kind: 'enter', messages: [message] }, 5, 1), /project revision changed/)
    assert.deepEqual(await reopened.stopSessionSchedules('session-schedule'), [], 'source shutdown does not stop independent tasks')
    assert.deepEqual(await reopened.stopSessionSchedules(created.sessionId), [created.scheduleId])
    assert.deepEqual(await reopened.stopSessionSchedules(recurring.sessionId), [recurring.scheduleId])
    assert.equal((await native.catalog()).length, 0)
    const detachResult = await dispatchOperation({ ...base, operation: 'linguistSessionsDetachBinding', payload: { sessionId: 'session-schedule' },
      detachSessionBinding: async sessionId => ({ sessionId, detached: true, cancelledScheduleIds: [], historicalEvidencePreserved: true }) })
    assert.deepEqual(detachResult, { sessionId: 'session-schedule', detached: true, cancelledScheduleIds: [], historicalEvidencePreserved: true })
  } finally { service.closeAll(); rmSync(root, { recursive: true, force: true }) }
})

test('scheduled Linguist context freezes Host-owned project and rejects stale or truncated scope', async () => {
  const root = mkdtempSync(join(tmpdir(), 'la-dsh-automation-context-'))
  const service = new LinguistProjectService({ rootDir: join(root, 'linguist'), applicationVersion: 'synthetic-test' })
  service.init()
  try {
    const project = await service.createProject({ name: 'Synthetic schedule', sourceLocale: 'zh-CN', targetLocale: 'en-US' })
    await service.importAsset(project.id, { bytes: new TextEncoder().encode('key,source,target\na,开始,Begin\n'), filename: 'schedule.csv' })
    const segment = service.openProject(project.id).segments.query({ limit: 1 })[0]
    const bindings = new BindingStore(root)
    bindings.bindProject(project.id, 'workspace-schedule')
    const binding = { workspaceId: 'workspace-schedule', projectId: project.id, role: 'reviewer', workMode: 'cat' }
    const turnContext = { schemaVersion: 1, projectId: project.id, assetId: segment.assetId, selectedSegmentIds: [segment.id], capturedAt: new Date().toISOString(), uiRevision: 1 }
    const captured = captureAutomationLinguistContext({ scope: 'segments', role: 'reviewer', turnContext }, binding, 'workspace-schedule', bindings, service)
    assert.deepEqual(captured.scope, { kind: 'segments', assetId: segment.assetId, segmentIds: [segment.id] })
    assert.deepEqual(revalidateAutomationLinguistContext(captured, binding, 'workspace-schedule', bindings, service), [segment.id])
    assert.throws(() => captureAutomationLinguistContext({ scope: 'segments', turnContext: { ...turnContext, selectionTruncated: true } }, binding, 'workspace-schedule', bindings, service), /truncated/)
    assert.throws(() => revalidateAutomationLinguistContext(captured, { ...binding, projectId: 'prj-0000000000000000' }, 'workspace-schedule', bindings, service), /no longer matches/)
  } finally { service.closeAll(); rmSync(root, { recursive: true, force: true }) }
})

test('native DSH prompt requestId admits the prepared CAT selection exactly in its own model step', async () => {
  const root = mkdtempSync(join(tmpdir(), 'la-dsh-turn-context-'))
  const service = new LinguistProjectService({ rootDir: join(root, 'linguist'), applicationVersion: 'synthetic-test' })
  service.init()
  try {
    const project = await service.createProject({ name: 'Synthetic turn', sourceLocale: 'zh-CN', targetLocale: 'en-US' })
    await service.importAsset(project.id, { bytes: new TextEncoder().encode('key,source,target\na,开始,Begin\n'), filename: 'turn.csv' })
    const segment = service.openProject(project.id).segments.query({ limit: 1 })[0]
    const bindings = new BindingStore(root)
    bindings.bindProject(project.id, 'workspace-turn')
    const binding = { workspaceId: 'workspace-turn', projectId: project.id, role: 'reviewer', workMode: 'cat' }
    bindings.bindSession('session-turn', binding)
    const requestId = '025548a2-3425-4fa8-9465-b851b746568a'
    const context = { schemaVersion: 1, projectId: project.id, assetId: segment.assetId, activeSegmentId: segment.id, selectedSegmentIds: [segment.id], capturedAt: new Date().toISOString(), uiRevision: 8 }
    const receipts = new TurnContextReceipts(root)
    const assertProjectSession = async (sessionId, projectId) => {
      assert.equal(bindings.session(sessionId)?.projectId, projectId)
      assert.equal(bindings.projectWorkspace(projectId), 'workspace-turn')
    }
    const prepareInput = {
      operation: 'linguistTurnContextPrepare', payload: { sessionId: 'session-turn', requestId, turnContext: context },
      service, bindings, workspaceRegistry: { get: () => ({ id: 'workspace-turn', path: root }) },
      files: new ManagedFiles(root), mutations: new MutationBus(), assertProjectSession,
      resolveSessionWorkspace: async () => ({ workspaceRoot: root }), turnContextReceipts: receipts,
    }
    const prepared = await dispatchOperation(prepareInput)
    assert.deepEqual(prepared, { requestId, context, selectionTruncated: false })
    assert.equal(Object.isFrozen(prepared.context), true)
    assert.equal(Object.isFrozen(prepared.context.selectedSegmentIds), true)
    assert.throws(() => { prepared.context.uiRevision = 9 }, TypeError)
    assert.throws(() => prepared.context.selectedSegmentIds.push(segment.id), TypeError)
    const reordered = Object.fromEntries(Object.entries(context).reverse())
    const sameSnapshot = await dispatchOperation({ ...prepareInput, payload: { ...prepareInput.payload, turnContext: reordered } })
    assert.equal(JSON.stringify(sameSnapshot.context), JSON.stringify(prepared.context))
    assert.deepEqual(await dispatchOperation(prepareInput), prepared)
    await assert.rejects(dispatchOperation({ ...prepareInput, payload: { ...prepareInput.payload, turnContext: { ...context, uiRevision: 9 } } }), /different Linguist CAT selection/)
    await assert.rejects(dispatchOperation({ ...prepareInput, payload: { ...prepareInput.payload, turnContext: { ...context, selectedSegmentIds: ['seg-0000000000000000'] }, requestId: randomUUID() } }), /does not belong/)

    const reopened = new TurnContextReceipts(root)
    const original = { id: 'user-message', role: 'user', source: { kind: 'user', rpcId: requestId }, content: [{ type: 'text', text: 'Review this segment' }] }
    const admitted = await addPreparedTurnContext({ sessionId: 'session-turn', decision: { kind: 'enter', messages: [original] }, receipts: reopened, service, bindings, assertProjectSession })
    assert.equal(admitted.kind, 'enter')
    assert.equal(admitted.messages.length, 2)
    assert.equal(admitted.messages[0].source.kind, 'linguist-turn-context')
    assert.equal(admitted.messages[0].source.requestId, requestId)
    assert.match(admitted.messages[0].content[0].text, /<linguist_turn_context version="1"/)
    assert.match(admitted.messages[0].content[0].text, new RegExp(segment.id))
    assert.equal(admitted.messages[1], original)
    assert.equal((await addPreparedTurnContext({ sessionId: 'session-turn', decision: { kind: 'enter', messages: [{ ...original, source: { kind: 'user', rpcId: randomUUID() } }] }, receipts: reopened, service, bindings, assertProjectSession })).messages.length, 1)

    const provenance = new TurnContextCallProvenance()
    const matched = []
    const modelStep = await addPreparedTurnContext({
      sessionId: 'session-turn', decision: { kind: 'enter', messages: [original] }, receipts: reopened, service, bindings, assertProjectSession,
      onAdmitted: (acceptedRequestId, acceptedContext) => matched.push({ requestId: acceptedRequestId, context: acceptedContext }),
    })
    provenance.admitStep(7, modelStep, matched)
    provenance.observe({ type: 'tool/call', data: { turn: 7, step: 0, callId: 'root-call', name: 'run_code', arguments: '{}' } })
    const snapshot = JSON.stringify(context)
    assert.deepEqual(provenance.forCall('root-call'), {
      turnContextVersion: 1, turnContextSnapshot: snapshot, turnContextHash: sha256(snapshot),
    })
    let nestedProvenance
    const nested = adaptCatTool({
      name: 'synthetic_provenance', description: 'Synthetic provenance', parameters: Type.Object({}),
      async execute(callId) { nestedProvenance = provenance.forCall(callId); return { content: [{ type: 'text', text: 'done' }] } },
    }, { saveImage: () => { throw new Error('No image expected') } }, undefined,
    (callId, rootCallId) => provenance.associateNestedCall(callId, rootCallId))
    await nested.execute({}, { callId: 'nested-call', rootCallId: 'root-call', signal: new AbortController().signal })
    assert.deepEqual(nestedProvenance, provenance.forCall('root-call'))
    provenance.admitStep(7, { kind: 'enter', messages: [{ ...original, source: { kind: 'user', rpcId: randomUUID() } }] }, [])
    provenance.observe({ type: 'tool/call', data: { turn: 7, step: 1, callId: 'unprepared-call', name: 'synthetic_provenance', arguments: '{}' } })
    assert.equal(provenance.forCall('unprepared-call'), undefined)
    provenance.observe({ type: 'turn/end', data: { turn: 7, reason: { kind: 'completed' } } })
    assert.equal(provenance.forCall('root-call'), undefined)
    assert.equal(provenance.forCall('nested-call'), undefined)

    bindings.bindSession('session-turn', { ...binding, workMode: 'browser' })
    await assert.rejects(addPreparedTurnContext({ sessionId: 'session-turn', decision: { kind: 'enter', messages: [original] }, receipts: reopened, service, bindings, assertProjectSession }), /binding changed/)
  } finally { service.closeAll(); rmSync(root, { recursive: true, force: true }) }
})

test('native delegation freezes CAT range and Workspace input bytes before child start', async () => {
  const root = mkdtempSync(join(tmpdir(), 'la-dsh-delegation-'))
  const outside = mkdtempSync(join(tmpdir(), 'la-dsh-delegation-outside-'))
  const service = new LinguistProjectService({ rootDir: join(root, 'linguist'), applicationVersion: 'synthetic-test' })
  service.init()
  try {
    const project = await service.createProject({ name: 'Synthetic delegation', sourceLocale: 'zh-CN', targetLocale: 'en-US' })
    await service.importAsset(project.id, { bytes: new TextEncoder().encode('key,source,target\na,开始,Begin\n'), filename: 'scope.csv' })
    const segment = service.openProject(project.id).segments.query({ limit: 1 })[0]
    const binding = { workspaceId: 'synthetic-workspace', projectId: project.id, role: 'general', workMode: 'cat' }
    const frozen = freezeLinguistDelegation(service, binding, { role: 'reviewer', scope: { assetIds: [segment.assetId] } })
    assert.equal(frozen.role, 'reviewer')
    assert.deepEqual(frozen.delegatedScope.segmentIds, [segment.id])
    assert.throws(() => freezeLinguistDelegation(service, frozen, { scope: { segmentIds: ['seg-0000000000000000'] } }), /outside|Only a General/)
    assert.ok(linguistDelegationOutcome(service, 'child-session', frozen))
    const bytes = Buffer.from('Synthetic local input')
    writeFileSync(join(root, 'input.txt'), bytes)
    writeFileSync(join(outside, 'secret.txt'), 'outside')
    symlinkSync(join(outside, 'secret.txt'), join(root, 'outside-link.txt'))
    const staged = await preflightDelegationInputs([{ path: 'input.txt', purpose: 'Review context', required: true, expectedSha256: sha256(bytes), snapshot: true }], root)
    assert.equal(staged.ready, true)
    const receipts = await deliverDelegationInputs(staged.items, root, 'synthetic-call')
    assert.equal(receipts[0].state, 'snapshotted')
    assert.equal(receipts[0].purpose, 'Review context')
    assert.deepEqual(readFileSync(receipts[0].usablePath), bytes)
    assert.equal((await preflightDelegationInputs([{ path: 'outside-link.txt', purpose: 'Unauthorized', required: true }], root)).ready, false)
    assert.equal((await preflightDelegationInputs([{ path: 'missing.txt', purpose: 'Optional context', required: false }], root)).items[0].receipt.state, 'missing')
    const fencedWorkspace = join(root, 'fenced-workspace')
    mkdirSync(fencedWorkspace)
    writeFileSync(join(fencedWorkspace, 'input.txt'), bytes)
    symlinkSync(outside, join(fencedWorkspace, '.linguist'))
    const fenced = await preflightDelegationInputs([{ path: 'input.txt', purpose: 'Review context', required: true, snapshot: true }], fencedWorkspace)
    await assert.rejects(() => deliverDelegationInputs(fenced.items, fencedWorkspace, 'fenced-call'), /not a regular Workspace directory/)
  } finally { service.closeAll(); rmSync(root, { recursive: true, force: true }); rmSync(outside, { recursive: true, force: true }) }
})

test('Linguist delegation starts a continuable DSH child and keeps follow-ups within its frozen binding', async () => {
  const root = mkdtempSync(join(tmpdir(), 'la-dsh-native-delegate-'))
  const service = new LinguistProjectService({ rootDir: join(root, 'linguist'), applicationVersion: 'synthetic-test' })
  service.init()
  try {
    const project = await service.createProject({ name: 'Native child', sourceLocale: 'zh-CN', targetLocale: 'en-US' })
    await service.importAsset(project.id, { bytes: new TextEncoder().encode('key,source,target\na,开始,Begin\n'), filename: 'child.csv' })
    const segment = service.openProject(project.id).segments.query({ limit: 1 })[0]
    const agent = { id: 'parent-session' }
    const bindings = new BindingStore(root)
    bindings.bindProject(project.id, 'workspace')
    const parentBinding = { workspaceId: 'workspace', projectId: project.id, role: 'general', workMode: 'cat' }
    bindings.bindSession(agent.id, parentBinding)
    const intents = new Map()
    const catalog = []
    const calls = []
    let requestedRoute
    const native = {
      resolveMaxDepth: () => 1,
      async startContinuable(spec) {
        assert.equal(spec.provider, 'spawn')
        assert.equal(spec.request.maxDepth, 1)
        assert.equal(spec.request.parent, agent)
        assert.deepEqual(spec.request.agentOptions, requestedRoute)
        if (requestedRoute === undefined) assert.equal(Object.hasOwn(spec.request, 'agentOptions'), false)
        assert.deepEqual(intents.get(spec.childId).delegatedScope.segmentIds, [segment.id])
        assert.match(spec.request.prompt[0].text, /Review context/)
        bindings.bindSession(spec.childId, intents.get(spec.childId))
        catalog.push({ id: spec.childId, mode: 'continuable', label: spec.label, createdAt: 1 })
        calls.push('start')
        return { childId: spec.childId, messageId: 'first-message' }
      },
      async listChildren(id) { assert.equal(id, agent.id); return catalog },
      async sendMessage(sender, childId, content, options) {
        assert.equal(sender, agent)
        assert.equal(options.signal.aborted, false)
        calls.push(['message', childId, content[0].text])
        return 'followup-message'
      },
      async prompt(request) { calls.push(['prompt', request.childSessionId, request.content[0].text, request.delivery]); return { messageId: 'human-message' } },
      interruptByParent(childId, parentId, mode) {
        calls.push(['interrupt', childId, parentId, mode])
        return { accepted: true }
      },
    }
    const control = new LinguistDelegationControl(service, bindings, native, async (sessionId, projectId) => {
      assert.equal(sessionId, agent.id)
      assert.equal(projectId, project.id)
    })
    const { tool, messageTool, listTool, interruptTool } = createLinguistDelegationTool({
      service, binding: parentBinding, agent, control,
      resolveSessionWorkspace: async () => ({ workspaceRoot: root }),
      reserveIntent: (childId, binding) => { intents.set(childId, binding); return () => { intents.delete(childId) } },
      subagents: native,
    })
    const args = { role: 'reviewer', objective: 'Review this synthetic segment', scope: { segmentIds: [segment.id] },
      inputs: [{ path: 'reference.txt', purpose: 'Review context', required: false }], expectedOutcome: 'A segment-level review with unresolved items' }
    const callerWait = new AbortController()
    const result = await tool.execute(args, { agent, callId: 'synthetic-tool-call', signal: callerWait.signal })
    assert.equal(result.status, 'started')
    assert.equal(result.messageId, 'first-message')
    assert.deepEqual(result.checkedInputs, [])
    assert.deepEqual(result.notChecked, [])
    assert.equal(calls[0], 'start')
    assert.equal(intents.size, 0)
    callerWait.abort()
    assert.equal(calls.some(call => Array.isArray(call) && call[0] === 'interrupt'), false, 'cancelling the accepted caller wait does not interrupt the child')
    assert.deepEqual(new BindingStore(root).session(result.childSessionId).delegatedScope.segmentIds, [segment.id])
    assert.equal((await listTool.execute({}, { agent })).items[0].childSessionId, result.childSessionId)
    const message = await messageTool.execute({ childSessionId: result.childSessionId, message: 'Continue within the same scope' },
      { agent, signal: new AbortController().signal })
    assert.equal(message.messageId, 'followup-message')
    const requestId = randomUUID()
    assert.equal((await control.prompt(agent.id, result.childSessionId, requestId, 'Human follow-up', 'queue')).messageId, 'human-message')
    const operationInput = {
      service, bindings, workspaceRegistry: { get: () => undefined }, files: new ManagedFiles(root), mutations: new MutationBus(),
      assertProjectSession: async () => {}, resolveSessionWorkspace: async () => ({ workspaceRoot: root }), delegationControl: control,
    }
    assert.equal((await dispatchOperation({ ...operationInput, operation: 'linguistDelegationsList', payload: { parentSessionId: agent.id } })).items.length, 1)
    assert.equal((await dispatchOperation({ ...operationInput, operation: 'linguistDelegationsPrompt', payload: {
      parentSessionId: agent.id, childSessionId: result.childSessionId, requestId: randomUUID(), text: 'Host follow-up', delivery: 'steer',
    } })).messageId, 'human-message')
    const interrupted = await interruptTool.execute({ childSessionId: result.childSessionId }, { agent })
    assert.deepEqual(interrupted, { childSessionId: result.childSessionId, accepted: true, scope: 'current-turn' })
    assert.deepEqual(calls.slice(1), [
      ['message', result.childSessionId, 'Continue within the same scope'],
      ['prompt', result.childSessionId, 'Human follow-up', 'queue'],
      ['prompt', result.childSessionId, 'Host follow-up', 'steer'],
      ['interrupt', result.childSessionId, agent.id, 'continuable'],
    ])
    assert.equal((await dispatchOperation({ ...operationInput, operation: 'linguistDelegationsInterrupt', payload: {
      parentSessionId: agent.id, childSessionId: result.childSessionId,
    } })).scope, 'current-turn')
    for (const field of ['provider', 'model', 'reasoningEffort']) {
      assert.equal(tool.parameters.properties[field].type, 'string')
      assert.equal(tool.parameters.required.includes(field), false)
    }
    requestedRoute = { provider: 'synthetic-selected-provider', model: 'synthetic-selected-model', reasoningEffort: 'max' }
    const routed = await tool.execute({ ...args, ...requestedRoute }, { agent, callId: 'synthetic-selected-route', signal: new AbortController().signal })
    assert.equal(routed.status, 'started')
    assert.notEqual(routed.childSessionId, result.childSessionId)
    assert.equal(Object.hasOwn(routed, 'effectiveModel'), false, 'accepted ids do not claim a resolved model route')
    assert.equal(intents.size, 0)
    bindings.bindSession(result.childSessionId, { ...parentBinding, role: 'reviewer', delegatedScope: { assetIds: [], segmentIds: [] } })
    await assert.rejects(() => control.prompt(agent.id, result.childSessionId, randomUUID(), 'Blocked', 'queue'), /frozen binding/i)
  } finally { service.closeAll(); rmSync(root, { recursive: true, force: true }) }
})

test('Session copy uses DSH native create/fork only for eligible source and Workspace', async () => {
  const root = mkdtempSync(join(tmpdir(), 'la-dsh-session-copy-'))
  const workspace = join(root, 'workspace')
  const secondWorkspace = join(root, 'other-workspace')
  mkdirSync(workspace)
  mkdirSync(secondWorkspace)
  const service = new LinguistProjectService({ rootDir: join(root, 'linguist'), applicationVersion: 'synthetic-test' })
  service.init()
  try {
    const source = await service.createProject({ name: 'Source project', sourceLocale: 'zh-CN', targetLocale: 'en-US' })
    const target = await service.createProject({ name: 'Target project', sourceLocale: 'zh-CN', targetLocale: 'en-US' })
    const crossWorkspaceTarget = await service.createProject({ name: 'Different Workspace', sourceLocale: 'zh-CN', targetLocale: 'en-US' })
    const bindings = new BindingStore(root)
    bindings.bindProject(source.id, 'workspace-1')
    bindings.bindProject(target.id, 'workspace-1')
    bindings.bindProject(crossWorkspaceTarget.id, 'workspace-2')
    bindings.bindSession('source-session', { workspaceId: 'workspace-1', projectId: source.id, role: 'reviewer', workMode: 'cat' })
    let events = []
    let forks = 0
    let creates = 0
    let storedCopy
    const persistenceSteps = []
    const archived = []
    const host = {
      bindings, service,
      workspaceRegistry: {
        get: id => id === 'workspace-1' ? { id, path: realpathSync(workspace) } : id === 'workspace-2' ? { id, path: realpathSync(secondWorkspace) } : undefined,
        async archiveSession(id, options) {
          assert.notEqual(id, 'source-session')
          assert.deepEqual(options, { stopActivity: true })
          archived.push(id)
        },
      },
      sessionExists: async () => true,
      agentStatus: () => 'idle',
      rebindAgent: () => {},
      sessionPersistence: {
        create: async (header, options) => {
          storedCopy = { header, options }
          return {
            append: async seed => { storedCopy.seed = seed; persistenceSteps.push('append') },
            flush: async () => { persistenceSteps.push('flush') },
            close: async () => { persistenceSteps.push('close') },
          }
        },
      },
      sessionController: {
        inspect: async () => ({ meta: { cwd: realpathSync(workspace) }, events }),
        create: async input => { creates++; if (input.sessionId) persistenceSteps.push('adopt'); return { sessionId: input.sessionId ?? `blank-${creates}` } },
        fork: async () => { forks++; return { sessionId: `fork-${forks}` } },
        rename: async () => {},
      },
    }
    assert.deepEqual(await sessionCopyEligibility(host, 'source-session'), { eligible: true, mode: 'blank' })
    const blank = await copyLinguistSessionToProject(host, 'source-session', target.id)
    assert.equal(blank.mode, 'blank')
    assert.equal(bindings.session(blank.sessionId).projectId, target.id)
    events = [
      { type: 'permission/preset', seq: 0, time: 1, data: { preset: 'workspace-write' } },
      { type: 'sandbox/mode', seq: 1, time: 2, data: { mode: 'workspace-write' } },
      { type: 'approval/policy', seq: 2, time: 3, data: { policy: 'ask' } },
      { type: 'model/selection', seq: 3, time: 4, data: { provider: 'synthetic', model: 'chosen-model', reasoningEffort: 'max' } },
    ]
    host.sessionController.inspect = async () => ({ meta: { cwd: realpathSync(workspace), agentPreset: 'chosen-preset' }, events })
    const configuredBlank = await copyLinguistSessionToProject(host, 'source-session', target.id)
    assert.equal(configuredBlank.mode, 'blank')
    assert.equal(storedCopy?.header.agentPreset, 'chosen-preset')
    assert.deepEqual(storedCopy?.seed.slice(0, events.length), events, 'blank copies retain native model and permission selections')
    const blankSeed = requireDsh('@deepseek-ai/dsh-session-persistence').validateStoredEvents(storedCopy.header, structuredClone(storedCopy.seed))
    const blankRestored = requireDsh('@deepseek-ai/dsh-session').Session.create(storedCopy.header.id, blankSeed, storedCopy.header, storedCopy.options.inheritedEventCount)
    assert.equal(blankRestored.seq, events.length + 1)
    assert.equal(blankRestored.isOwnSeq(events.length - 1), false)
    assert.deepEqual(blankRestored.deriveMessages(), [], 'settings copy does not create conversation content')
    assert.deepEqual(persistenceSteps, ['append', 'flush', 'close', 'adopt'])
    persistenceSteps.length = 0
    const { createUserMessage, createAssistantMessage } = requireDsh('@deepseek-ai/dsh-llm')
    events = [
      { type: 'turn/start', seq: 0, time: 1, data: { turn: 0 } },
      { type: 'user/message', seq: 1, time: 2, surfaceOp: 'append', data: createUserMessage({ content: [{ type: 'text', text: 'Synthetic source' }], source: { kind: 'user' } }) },
      { type: 'assistant/message', seq: 2, time: 3, surfaceOp: 'append', data: { turn: 0, step: 0, stream: [], message: createAssistantMessage({ content: [{ type: 'text', text: 'Synthetic response' }], source: { kind: 'model', provider: 'synthetic', model: 'synthetic' } }) } },
      { type: 'turn/end', seq: 3, time: 4, data: { turn: 0, reason: { kind: 'completed' } } },
    ]
    assert.deepEqual(await sessionCopyEligibility(host, 'source-session'), { eligible: true, mode: 'fork' })
    assert.deepEqual(await sessionCopyEligibility(host, 'source-session', crossWorkspaceTarget.id), { eligible: true, mode: 'fork' })
    const cross = await copyLinguistSessionToProject(host, 'source-session', crossWorkspaceTarget.id)
    assert.equal(cross.workspaceId, 'workspace-2')
    assert.equal(storedCopy.header.cwd, realpathSync(secondWorkspace))
    assert.equal(storedCopy.header.parentSession, 'source-session')
    assert.equal(storedCopy.header.isSeeded, true)
    assert.equal(storedCopy.options.inheritedEventCount, events.length)
    assert.deepEqual(storedCopy.seed.slice(0, events.length), events)
    assert.equal(storedCopy.seed[events.length].type, 'session/end-seed')
    const { validateStoredEvents } = requireDsh('@deepseek-ai/dsh-session-persistence')
    assert.equal(validateStoredEvents(storedCopy.header, structuredClone(storedCopy.seed)).length, events.length + 1)
    const { Session } = requireDsh('@deepseek-ai/dsh-session')
    const restored = Session.create(storedCopy.header.id, storedCopy.seed, storedCopy.header, storedCopy.options.inheritedEventCount)
    assert.equal(restored.header.cwd, realpathSync(secondWorkspace))
    assert.equal(restored.isOwnSeq(2), false)
    assert.equal(restored.isOwnSeq(events.length), true)
    assert.deepEqual(persistenceSteps, ['append', 'flush', 'close', 'adopt'])
    assert.equal(bindings.session(cross.sessionId).projectId, crossWorkspaceTarget.id)
    assert.equal(bindings.session(cross.sessionId).role, 'reviewer')
    const fork = await copyLinguistSessionToProject(host, 'source-session', target.id)
    assert.equal(fork.mode, 'fork')
    assert.equal(forks, 1)
    const completedEvents = events
    events = [...events, { type: 'user/message', seq: 4 }]
    assert.equal((await sessionCopyEligibility(host, 'source-session')).reason, 'NO_COMPLETED_ASSISTANT')
    assert.equal(creates, 3)

    // Failures detach Linguist and archive only the newly created native Session.
    events = []
    const rebinds = []
    host.rebindAgent = id => { rebinds.push({ id, bound: Boolean(bindings.session(id)) }) }
    host.sessionController.rename = async () => { throw new Error('rename refused') }
    await assert.rejects(copyLinguistSessionToProject(host, 'source-session', target.id), /blank-4.*no Linguist binding remains/)
    assert.equal(bindings.session('blank-4'), undefined)
    assert.deepEqual(archived, ['blank-4'])
    assert.deepEqual(rebinds, [], 'binding is delayed until native title and source/target checks succeed')
    host.sessionController.rename = async () => {}
    host.rebindAgent = id => {
      rebinds.push({ id, bound: Boolean(bindings.session(id)) })
      if (bindings.session(id)) throw new Error('tool registration refused')
    }
    await assert.rejects(copyLinguistSessionToProject(host, 'source-session', target.id), /blank-5.*no Linguist binding remains/)
    assert.equal(bindings.session('blank-5'), undefined)
    assert.deepEqual(rebinds, [{ id: 'blank-5', bound: true }, { id: 'blank-5', bound: false }])
    assert.equal(new BindingStore(root).session('blank-5'), undefined)
    assert.deepEqual(archived, ['blank-4', 'blank-5'])
    assert.equal(bindings.session('source-session').projectId, source.id)
    host.rebindAgent = () => { throw new Error('registration and disposal failed') }
    await assert.rejects(copyLinguistSessionToProject(host, 'source-session', target.id), error => {
      assert.ok(error instanceof LinguistSessionCopyError)
      assert.ok(error.cause instanceof AggregateError)
      assert.equal(error.cause.errors.length, 2)
      assert.deepEqual(invokeError(error).sessionCopyDetails, { sessionId: 'blank-6', cleanup: 'failed' })
      assert.match(error.message, /blank-6.*cleanup failed/)
      return true
    })
    assert.deepEqual(archived, ['blank-4', 'blank-5', 'blank-6'], 'native archival still runs after binding rollback throws')
    host.workspaceRegistry.archiveSession = async () => { throw new Error('native archive write refused') }
    await assert.rejects(copyLinguistSessionToProject(host, 'source-session', target.id), error => {
      assert.equal(error.cleanup, 'failed')
      assert.deepEqual(error.cause.errors.map(item => item.message), [
        'registration and disposal failed', 'registration and disposal failed', 'native archive write refused',
      ])
      assert.match(error.message, /blank-7.*cleanup failed/)
      return true
    })
    host.rebindAgent = () => {}
    host.sessionController.rename = async () => { throw new Error('rename refused') }
    await assert.rejects(copyLinguistSessionToProject(host, 'source-session', target.id), error => {
      assert.equal(error.cleanup, 'failed')
      assert.deepEqual(error.cause.errors.map(item => item.message), ['rename refused', 'native archive write refused'])
      return true
    })
    events = [{ type: 'permission/preset', seq: 0, time: 1, data: { preset: 'workspace-write' } }]
    host.sessionPersistence.create = async () => { throw new Error('seed creation refused') }
    host.workspaceRegistry.archiveSession = async () => { assert.fail('never archive an identity that this copy did not create') }
    await assert.rejects(copyLinguistSessionToProject(host, 'source-session', target.id), error => {
      assert.equal(error.cleanup, 'not-started')
      assert.equal(error.cause.message, 'seed creation refused')
      return true
    })
    assert.equal(bindings.session('source-session').projectId, source.id)
    const { RemoteError } = requireDsh('@deepseek-ai/dsh-typert-protocol')
    const nativeFailureArchives = []
    host.workspaceRegistry.archiveSession = async (id, options) => {
      assert.deepEqual(options, { stopActivity: true })
      nativeFailureArchives.push(id)
    }
    for (const [mode, sourceEvents] of [['blank', []], ['fork', completedEvents]]) {
      events = sourceEvents
      const childId = `session-${mode}-attach-failed`
      const failAttach = async () => {
        throw new RemoteError('session/workspace-attach-failed', 'synthetic native attach refused', { sessionId: childId, workspaceId: 'workspace-1' })
      }
      host.sessionController.create = failAttach
      host.sessionController.fork = failAttach
      await assert.rejects(copyLinguistSessionToProject(host, 'source-session', target.id), error => {
        assert.equal(error.sessionId, childId)
        assert.equal(error.cleanup, 'completed')
        return true
      })
      for (const invalid of [
        new RemoteError('session/workspace-attach-failed', 'source ID is not a copy', { sessionId: 'source-session', workspaceId: 'workspace-1' }),
        new RemoteError('session/workspace-attach-failed', 'another Workspace is not this copy', { sessionId: childId, workspaceId: 'workspace-2' }),
        Object.assign(new Error('untyped failure is not native ownership proof'), { code: 'session/workspace-attach-failed', details: { sessionId: childId, workspaceId: 'workspace-1' } }),
      ]) {
        host.sessionController.create = host.sessionController.fork = async () => { throw invalid }
        await assert.rejects(copyLinguistSessionToProject(host, 'source-session', target.id), error => error === invalid)
      }
    }
    assert.deepEqual(nativeFailureArchives, ['session-blank-attach-failed', 'session-fork-attach-failed'])
    assert.equal(bindings.session('source-session').projectId, source.id)
  } finally { service.closeAll(); rmSync(root, { recursive: true, force: true }) }
})

test('failed Session seed copy is archived through the real native registry and survives reopening', async () => {
  const requireNative = createRequire(new URL('../../.toolchain/dsh-0.2.0-rc.2/package.json', import.meta.url))
  const { Context: NativeContext } = requireNative('@deepseek-ai/cordis')
  const { Storage } = requireNative('@deepseek-ai/dsh-storage')
  const jsonStorage = requireNative('@deepseek-ai/dsh-storage-json')
  const domainStorage = requireNative('@deepseek-ai/dsh-storage-domain')
  const JsonlPersistence = requireNative('@deepseek-ai/dsh-session-persistence-jsonl').default
  const { WorkspaceRegistry } = requireNative('@deepseek-ai/dsh-workspace')
  const { SESSION_FORMAT_VERSION } = requireNative('@deepseek-ai/dsh-session')
  const root = mkdtempSync(join(tmpdir(), 'la-dsh-copy-native-archive-'))
  const workspace = join(root, 'workspace')
  mkdirSync(workspace)
  const service = new LinguistProjectService({ rootDir: join(root, 'linguist'), applicationVersion: 'synthetic-test' })
  service.init()
  const ctx = new NativeContext()
  const fibers = []
  try {
    for (const [plugin, config] of [
      [Storage], [jsonStorage, { root: join(root, 'domains') }], [domainStorage, { backend: 'json' }],
      [JsonlPersistence, { root: join(root, 'sessions'), compression: 'none' }], [WorkspaceRegistry],
    ]) {
      const fiber = ctx.plugin(plugin, config)
      fibers.push(fiber)
      await fiber.await()
    }
    const registered = await ctx.workspaceRegistry.create(workspace)
    const source = await service.createProject({ name: 'Synthetic source', sourceLocale: 'en-US', targetLocale: 'zh-CN' })
    const target = await service.createProject({ name: 'Synthetic target', sourceLocale: 'en-US', targetLocale: 'zh-CN' })
    const sourceId = SessionId('session-native-copy-source')
    const sourceHandle = await ctx.sessionPersistence.create({ version: SESSION_FORMAT_VERSION, id: sourceId, createdAt: 1, cwd: realpathSync(workspace), isSeeded: false })
    await sourceHandle.append([{ type: 'permission/preset', seq: 0, time: 1, data: { preset: 'workspace-write' } }])
    await sourceHandle.close()
    const sourceBefore = await ctx.sessionPersistence.stat(sourceId)
    const bindings = new BindingStore(root)
    bindings.bindProject(source.id, registered.id)
    bindings.bindProject(target.id, registered.id)
    const sourceBinding = { workspaceId: registered.id, projectId: source.id, role: 'reviewer', workMode: 'cat' }
    bindings.bindSession(sourceId, sourceBinding)
    const stopped = []
    ctx.on('workspace/session-stop', ({ sessionId }) => {
      assert.ok(ctx.workspaceRegistry.archivedSessionIds.includes(sessionId), 'native archive is durable before stop requests')
      stopped.push(sessionId)
    })
    const host = {
      service, bindings, workspaceRegistry: ctx.workspaceRegistry, sessionPersistence: ctx.sessionPersistence,
      sessionExists: async id => Boolean(await ctx.sessionPersistence.stat(id)), agentStatus: () => 'idle',
      rebindAgent() { assert.fail('failed seed adoption must never bind Linguist tools') },
      sessionController: {
        async inspect(id) {
          const handle = await ctx.sessionPersistence.open(id, 'read')
          try { return { meta: sourceBefore.header, events: (await handle.read()).events } }
          finally { await handle.close() }
        },
        async create() { throw new Error('synthetic adoption refused after durable seed') },
      },
    }
    let failedId
    await assert.rejects(copyLinguistSessionToProject(host, sourceId, target.id), error => {
      assert.ok(error instanceof LinguistSessionCopyError)
      assert.equal(error.cleanup, 'completed')
      assert.match(error.message, /archived.*restore/i)
      failedId = error.sessionId
      return true
    })
    assert.notEqual(failedId, sourceId)
    assert.deepEqual(ctx.workspaceRegistry.archivedSessionIds, [failedId])
    assert.deepEqual(stopped, [failedId])
    assert.ok(await ctx.sessionPersistence.stat(failedId), 'archival retains a recoverable native record')
    assert.equal(bindings.session(failedId), undefined)
    assert.deepEqual(bindings.session(sourceId), sourceBinding)
    assert.deepEqual(await ctx.sessionPersistence.stat(sourceId), sourceBefore)
    await fibers.pop().dispose()
    const reopened = ctx.plugin(WorkspaceRegistry)
    fibers.push(reopened)
    await reopened.await()
    assert.deepEqual(ctx.workspaceRegistry.archivedSessionIds, [failedId], 'archive survives native registry reload')
    await ctx.workspaceRegistry.unarchiveSession(failedId)
    assert.deepEqual(ctx.workspaceRegistry.archivedSessionIds, [])
  } finally {
    for (const fiber of fibers.reverse()) await fiber.dispose()
    service.closeAll()
    rmSync(root, { recursive: true, force: true })
  }
})

test('parent delegation list exposes current actor/revision evidence and never treats partial Stage scope as full completion', async () => {
  const root = mkdtempSync(join(tmpdir(), 'la-dsh-delegation-outcome-'))
  const service = new LinguistProjectService({ rootDir: join(root, 'linguist'), applicationVersion: 'synthetic-test' })
  service.init()
  try {
    const project = await service.createProject({ name: 'Synthetic professional outcome', sourceLocale: 'en-US', targetLocale: 'zh-CN' })
    await service.importAsset(project.id, { filename: 'scope.csv', bytes: new TextEncoder().encode('key,source,target\na,Start,开始\nb,Stop,停止\n') })
    const db = service.openProject(project.id)
    const ids = db.segments.queryIds()
    const bindings = new BindingStore(root)
    bindings.bindProject(project.id, 'workspace')
    const parent = { workspaceId: 'workspace', projectId: project.id, role: 'general', workMode: 'cat' }
    bindings.bindSession('parent', parent)
    const children = ['subset-child', 'full-child']
    for (const child of children) {
      bindings.bindSession(child, { ...parent, role: 'reviewer', delegatedScope: { assetIds: [], segmentIds: ids } })
      const plan = { stageRunId: `stage-${child}`, role: 'reviewer', stage: 'editing', assetIds: [db.segments.getById(ids[0]).assetId], segmentIds: child === 'subset-child' ? ids.slice(0, 1) : ids, requirements: [], decisionEventBoundary: 0 }
      const baseline = createStageEvidenceBaseline({ stageRunId: plan.stageRunId, discoveryScopeHash: 'scope', mappingRevision: 'mapping', ruleSetRevision: 'rules', segmentIds: plan.segmentIds, evidence: [] })
      db.stageEvidence.create({ stageRunId: plan.stageRunId, sessionId: child, plan, baseline })
    }
    const native = { async listChildren() { return children.map(id => ({ id, mode: 'continuable', label: id, createdAt: 1 })) } }
    const control = new LinguistDelegationControl(service, bindings, native, async () => {})
    const agent = { id: 'parent' }
    const { listTool } = createLinguistDelegationTool({ service, binding: parent, agent, control })
    db.segments.recordCurrentStageDecision(ids[0], 'editing', 0, 'unchanged', { actor: 'subset-child' })
    db.segments.recordCurrentStageDecision(ids[1], 'editing', 0, 'unchanged', { actor: 'another-session' })
    let result = await listTool.execute({}, { agent })
    const partial = result.items.find(item => item.childSessionId === 'subset-child').professionalOutcome
    assert.equal(partial.total, 2)
    assert.equal(partial.pending, 1)
    assert.equal(partial.status, 'in_progress')
    assert.equal(partial.evidence.status, 'complete', 'a partial Stage can be complete while delegation remains incomplete')
    assert.match(listTool.output.render({}, result)[0].text, /professionalOutcome/, 'parent model receives the professional audit')
    for (const id of ids) db.segments.recordCurrentStageDecision(id, 'editing', 0, 'unchanged', { actor: 'full-child' })
    result = await listTool.execute({}, { agent })
    assert.equal(result.items.find(item => item.childSessionId === 'full-child').professionalOutcome.status, 'complete')
    db.segments.applyTargetEdit(ids[0], '开始吧', 0)
    result = await listTool.execute({}, { agent })
    const revised = result.items.find(item => item.childSessionId === 'full-child').professionalOutcome
    assert.equal(revised.pending, 1)
    assert.equal(revised.status, 'in_progress', 'decisions on an old revision no longer count')
  } finally { service.closeAll(); rmSync(root, { recursive: true, force: true }) }
})

test('four DSH roles retain the full CAT tool set and distinct Session bindings', async () => {
  const root = mkdtempSync(join(tmpdir(), 'la-dsh-roles-'))
  const service = new LinguistProjectService({ rootDir: join(root, 'linguist'), applicationVersion: 'synthetic-test' })
  service.init()
  try {
    const project = await service.createProject({ name: 'Synthetic roles', sourceLocale: 'zh-CN', targetLocale: 'en-US' })
    const bindings = new BindingStore(root)
    bindings.bindProject(project.id, 'synthetic-workspace')
    const expected = [...LINGUIST_CAT_TOOL_NAMES]
    assert.equal(expected.length, 31)
    for (const role of ['general', 'translator', 'reviewer', 'proofreader']) {
      const sessionId = `synthetic-${role}`
      bindings.bindSession(sessionId, { workspaceId: 'synthetic-workspace', projectId: project.id, role, workMode: 'cat' })
      const unreachable = () => { throw new Error('Unused test hook was called') }
      const deps = createCatDeps({
        service, projectId: project.id, sessionId, role, sessionCwd: root,
        attachments: { imageLimits: { maxImageBytes: 1024 }, saveImage: unreachable, readImage: unreachable },
        assertBound: () => assert.equal(bindings.session(sessionId)?.projectId, project.id),
        authorizeReadPath: unreachable, authorizeWritePath: unreachable, discoveryScope: unreachable,
        onMutation: unreachable, prepareStage: unreachable, prepareContextDoc: unreachable,
        onEvidencePrepared: unreachable, generationProvenance: unreachable,
        stageEvidenceRunId: () => undefined, reviewScopeSegmentIds: () => undefined, delegatedScopeSegmentIds: () => undefined,
      })
      assert.equal(deps.linguistRole, role)
      assert.deepEqual(createLinguistCatTools(deps).map(tool => tool.name), expected)
      assert.equal(bindings.session(sessionId)?.role, role)
    }
    assert.equal(bindings.projectWorkspace(project.id), 'synthetic-workspace')
  } finally {
    service.closeAll()
    rmSync(root, { recursive: true, force: true })
  }
})

test('raw Stage Evidence requires exact model-visible tool content and a successful response', async () => {
  const root = mkdtempSync(join(tmpdir(), 'la-dsh-evidence-'))
  const receipts = []
  const observer = new EvidenceObserver({ openProject: () => ({ stageEvidence: { recordReceipt: value => receipts.push(value) } }) }, root)
  const receipt = {
    stageRunId: 'synthetic-stage', baselineHash: 'synthetic-baseline', sessionId: 'synthetic-session',
    generationRunId: 'synthetic-generation', toolCallId: 'synthetic-call', segmentIds: ['synthetic-segment'],
    evidence: [{ ref: { kind: 'asset', id: 'synthetic-asset' }, version: '1', anchorIds: [] }],
  }
  const collect = async iterable => { for await (const _ of iterable) { /* consume observed stream */ } }
  const stream = reason => async function* () { yield { type: 'finish', reason: { kind: reason } } }
  const options = text => ({
    provider: 'synthetic-provider', model: 'synthetic-model', sessionId: 'synthetic-session',
    messages: [{ role: 'tool', toolCallId: 'synthetic-call', content: [{ type: 'text', text }] }],
  })
  try {
    observer.prepare('synthetic-project', receipt)
    observer.presented(receipt.sessionId, receipt.toolCallId, [{ type: 'text', text: 'Exact source and target' }])
    await collect(observer.stream(options('Partial source'), stream('stop')))
    assert.equal(receipts.length, 0)
    await collect(observer.stream(options('Exact source and target'), stream('aborted')))
    assert.equal(receipts.length, 0)
    await collect(observer.stream(options('Exact source and target'), stream('stop')))
    assert.equal(receipts.length, 1)
    assert.equal(receipts[0].evidence[0].submission, 'provider-response-v1')
    const observations = readFileSync(join(root, 'evidence-observations.jsonl'), 'utf8').trim().split('\n')
    assert.equal(observations.length, 1)
    assert.equal(JSON.parse(observations[0]).toolCallId, receipt.toolCallId)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('synthetic historical schema 1 project metadata survives backup and restore', async () => {
  const root = mkdtempSync(join(tmpdir(), 'la-dsh-schema1-'))
  const service = new LinguistProjectService({ rootDir: root, applicationVersion: 'synthetic-test' })
  service.init()
  try {
    const created = await service.createProject({ name: 'Synthetic legacy', sourceLocale: 'zh-CN', targetLocale: 'en-US' })
    const imported = await service.importAsset(created.id, { bytes: new TextEncoder().encode('key,source,target\na,开始,Begin\n'), filename: 'synthetic.csv' })
    assert.equal(imported.status, 'imported')
    service.closeAll()
    const paths = service.getProjectPaths(created.id)
    const indexPath = join(root, 'projects.json')
    const index = JSON.parse(readFileSync(indexPath, 'utf8'))
    const legacy = { ...index.projects[0], schemaVersion: 1, promaWorkspaceId: 'synthetic-historical-id' }
    index.projects[0] = legacy
    writeFileSync(indexPath, JSON.stringify(index))
    const manifest = JSON.parse(readFileSync(paths.projectJsonPath, 'utf8'))
    writeFileSync(paths.projectJsonPath, JSON.stringify({ ...manifest, schemaVersion: 1, promaWorkspaceId: legacy.promaWorkspaceId }))
    assert.equal(service.getProject(created.id).promaWorkspaceId, legacy.promaWorkspaceId)
    const before = service.openProject(created.id).segments.query({ limit: 1 })[0]
    const backup = service.backupProject(created.id)
    assert.equal(service.previewRestore(created.id, backup.backupName).restorable, true)
    service.editSegment(created.id, before.id, 'Changed after backup', before.revision)
    const restored = service.restoreProject(created.id, backup.backupName)
    assert.equal(restored.backupName, backup.backupName)
    assert.equal(service.getProject(created.id).schemaVersion, 1)
    assert.equal(service.getProject(created.id).promaWorkspaceId, legacy.promaWorkspaceId)
    assert.equal(service.openProject(created.id).segments.getById(before.id).target, before.target)
    assert.equal(service.openProject(created.id).segments.getById(before.id).id, before.id)
  } finally {
    service.closeAll()
    rmSync(root, { recursive: true, force: true })
  }
})

test('external CAT backup import preserves historical IDs and source bytes across independent roots', async () => {
  const root = mkdtempSync(join(tmpdir(), 'la-dsh-external-backup-'))
  const oldRoot = join(root, 'old-product')
  const newRoot = join(root, 'new-product')
  const workspaceRoot = join(root, 'workspace')
  mkdirSync(oldRoot)
  mkdirSync(newRoot)
  mkdirSync(workspaceRoot)
  const oldService = new LinguistProjectService({ rootDir: oldRoot, applicationVersion: 'synthetic-old' })
  const newService = new LinguistProjectService({ rootDir: newRoot, applicationVersion: 'synthetic-new' })
  oldService.init()
  newService.init()
  try {
    const created = await oldService.createProject({ name: 'Synthetic prior CAT', sourceLocale: 'zh-CN', targetLocale: 'en-US' })
    const imported = await oldService.importAsset(created.id, { bytes: new TextEncoder().encode('key,source,target\na,开始,Begin\n'), filename: 'synthetic.csv' })
    assert.equal(imported.status, 'imported')
    oldService.closeAll()
    const indexPath = join(oldRoot, 'projects.json')
    const oldIndex = JSON.parse(readFileSync(indexPath, 'utf8'))
    oldIndex.projects[0] = { ...oldIndex.projects[0], schemaVersion: 1, promaWorkspaceId: 'synthetic-historical-workspace' }
    writeFileSync(indexPath, JSON.stringify(oldIndex))
    const oldProjectPath = oldService.getProjectPaths(created.id).projectJsonPath
    const oldManifest = JSON.parse(readFileSync(oldProjectPath, 'utf8'))
    writeFileSync(oldProjectPath, JSON.stringify({ ...oldManifest, schemaVersion: 1, promaWorkspaceId: 'synthetic-historical-workspace' }))
    const oldSegment = oldService.openProject(created.id).segments.query({ limit: 1 })[0]
    const oldAssetId = oldSegment.assetId
    const backup = oldService.backupProject(created.id)
    oldService.closeAll()
    const originalBackupDir = join(oldRoot, backup.backupDir)
    const selectedBackupDir = join(workspaceRoot, 'selected-backup')
    cpSync(originalBackupDir, selectedBackupDir, { recursive: true })
    const originalBefore = directoryHashes(originalBackupDir)
    const selectedBefore = directoryHashes(selectedBackupDir)
    const bindings = new BindingStore(newRoot)
    const dispatchInput = {
      operation: 'linguistBackupsImportExternal',
      payload: { workspaceId: 'synthetic-dsh-workspace', backupPath: 'selected-backup' },
      service: newService,
      bindings,
      workspaceRegistry: { get: id => id === 'synthetic-dsh-workspace' ? { id, path: realpathSync(workspaceRoot) } : undefined },
      files: new ManagedFiles(newRoot),
      mutations: new MutationBus(),
      assertProjectSession: async () => { throw new Error('Backup import must not require a new Session') },
      resolveSessionWorkspace: async () => { throw new Error('Backup import must not require a new Session') },
    }
    const result = await dispatchOperation(dispatchInput)
    assert.equal(result.project.id, created.id)
    assert.equal(result.project.schemaVersion, 1)
    assert.equal(result.project.workspaceId, 'synthetic-dsh-workspace')
    assert.equal(result.importedFrom, 'selected-backup')
    assert.equal(result.schemaVersion, newService.openProject(created.id).schemaVersion)
    assert.equal(newService.getProject(created.id).promaWorkspaceId, 'synthetic-historical-workspace')
    assert.equal(newService.openProject(created.id).segments.getById(oldSegment.id).id, oldSegment.id)
    assert.equal(newService.openProject(created.id).segments.getById(oldSegment.id).assetId, oldAssetId)
    assert.equal(newService.openProject(created.id).segments.getById(oldSegment.id).target, oldSegment.target)
    assert.equal(new BindingStore(newRoot).projectWorkspace(created.id), 'synthetic-dsh-workspace')
    assert.deepEqual(directoryHashes(originalBackupDir), originalBefore)
    assert.deepEqual(directoryHashes(selectedBackupDir), selectedBefore)
    assert.deepEqual(newService.listProjects({ includeArchived: true }).map(project => project.id), [created.id])
    const health = await dispatchOperation({ ...dispatchInput, operation: 'linguistProjectsCheckHealth', payload: { projectId: created.id } })
    assert.equal(health.kind, 'quick')
    assert.equal(health.healthy, true)
    await assert.rejects(dispatchOperation(dispatchInput), /already exists/i)
    assert.deepEqual(directoryHashes(originalBackupDir), originalBefore)
    assert.deepEqual(directoryHashes(selectedBackupDir), selectedBefore)
    assert.deepEqual(newService.listProjects({ includeArchived: true }).map(project => project.id), [created.id])

    const tampered = join(workspaceRoot, 'tampered-backup')
    cpSync(selectedBackupDir, tampered, { recursive: true })
    writeFileSync(join(tampered, 'cat.db'), 'corrupted synthetic database')
    await assert.rejects(dispatchOperation({ ...dispatchInput, payload: { ...dispatchInput.payload, backupPath: 'tampered-backup' } }), /corrupt|mismatch/i)
    assert.deepEqual(newService.listProjects({ includeArchived: true }).map(project => project.id), [created.id])
    symlinkSync(originalBackupDir, join(workspaceRoot, 'linked-backup'))
    await assert.rejects(dispatchOperation({ ...dispatchInput, payload: { ...dispatchInput.payload, backupPath: 'linked-backup' } }), /regular directory/i)
    assert.deepEqual(directoryHashes(originalBackupDir), originalBefore)

    const failedRoot = join(root, 'failed-product')
    mkdirSync(failedRoot)
    const failedService = new LinguistProjectService({ rootDir: failedRoot, applicationVersion: 'synthetic-failure' })
    failedService.init()
    const failedStore = failedService.store
    failedStore.openProject = () => { throw new Error('Synthetic post-registration failure') }
    try {
      await assert.rejects(dispatchOperation({
        ...dispatchInput,
        service: failedService,
        bindings: new BindingStore(failedRoot),
        files: new ManagedFiles(failedRoot),
      }), /PROJECT_UNHEALTHY|Project unhealthy|unhealthy/i)
      assert.deepEqual(failedService.listProjects({ includeArchived: true }), [])
      assert.equal(lstatSync(join(failedRoot, 'projects', created.id), { throwIfNoEntry: false }), undefined)
      assert.deepEqual(readdirSync(join(failedRoot, 'projects')), [])
      assert.deepEqual(readdirSync(join(failedRoot, 'trash')), [])
      assert.deepEqual(directoryHashes(selectedBackupDir), selectedBefore)
    } finally {
      failedService.closeAll()
    }
  } finally {
    oldService.closeAll()
    newService.closeAll()
    rmSync(root, { recursive: true, force: true })
  }
})

test('legacy LA root migration scans a selected copy and imports with independent verification', async () => {
  const root = mkdtempSync(join(tmpdir(), 'la-dsh-legacy-root-'))
  const workspaceRoot = join(root, 'workspace')
  const legacyRoot = join(workspaceRoot, 'synthetic-la-copy')
  const externalRoot = join(legacyRoot, 'external')
  const dataRoot = join(root, 'new-product')
  const legacyProjectId = 'synthetic-legacy-project'
  const legacyProjectDir = join(legacyRoot, 'data', 'projects', legacyProjectId)
  mkdirSync(join(legacyProjectDir, 'batches', 'synthetic-batch'), { recursive: true })
  mkdirSync(externalRoot)
  mkdirSync(dataRoot)
  const sourceFile = join(externalRoot, 'synthetic.xliff')
  writeFileSync(sourceFile, '<?xml version="1.0"?><xliff version="1.2"><file><body><trans-unit id="one"><source>Open</source><target>打开</target></trans-unit></body></file></xliff>')
  writeFileSync(join(legacyProjectDir, 'project.json'), JSON.stringify({
    schemaVersion: 1, projectId: legacyProjectId, projectName: 'Synthetic legacy import', root: externalRoot,
    sourceLanguage: 'zh-CN', targetLanguage: 'en-US', createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
  }))
  writeFileSync(join(legacyProjectDir, 'batches', 'synthetic-batch', 'batch.json'), JSON.stringify({
    schemaVersion: 1, projectId: legacyProjectId, batchId: 'synthetic-batch', format: 'xliff_1_2', sourceFile,
    sourceLanguage: 'zh-CN', targetLanguage: 'en-US', segments: [
      { id: 'one', source: 'Open', target: '打开', status: 'confirmed', locked: false },
    ],
  }))
  writeFileSync(join(legacyProjectDir, 'chat.json'), JSON.stringify([
    { ts: '2026-01-01T00:00:00.000Z', kind: 'user', text: 'Synthetic request', sessionId: 'synthetic-session' },
    { ts: '2026-01-01T00:00:01.000Z', kind: 'assistant', text: 'Synthetic response', sessionId: 'synthetic-session' },
  ]))
  mkdirSync(join(legacyProjectDir, '_pi_sessions'))
  const historicalSessionBytes = '{"synthetic":"archived only"}\n'
  writeFileSync(join(legacyProjectDir, '_pi_sessions', 'synthetic.jsonl'), historicalSessionBytes)
  const orphanId = 'synthetic-orphan'
  const orphanDir = join(legacyRoot, 'data', 'projects', orphanId, 'batches', 'synthetic-batch')
  mkdirSync(orphanDir, { recursive: true })
  writeFileSync(join(orphanDir, 'batch.json'), JSON.stringify({
    schemaVersion: 1, projectId: orphanId, batchId: 'synthetic-batch', format: 'csv_paste', sourceFile: 'synthetic-paste',
    sourceLanguage: 'zh-CN', targetLanguage: 'en-US', segments: [
      { id: 'orphan-one', source: 'Cancel', target: '取消', status: 'draft', locked: false },
    ],
  }))
  const original = directoryHashes(legacyRoot)
  const service = new LinguistProjectService({ rootDir: dataRoot, applicationVersion: 'synthetic-test' })
  service.init()
  const bindings = new BindingStore(dataRoot)
  const common = {
    service, bindings,
    workspaceRegistry: { get: id => id === 'synthetic-workspace' ? { id, path: realpathSync(workspaceRoot) } : undefined },
    files: new ManagedFiles(dataRoot), mutations: new MutationBus(),
    assertProjectSession: async () => { throw new Error('Legacy import must not create a Session') },
    resolveSessionWorkspace: async () => { throw new Error('Legacy import must not create a Session') },
  }
  try {
    const scan = await dispatchOperation({ ...common, operation: 'linguistLegacyMigrationScan', payload: { workspaceId: 'synthetic-workspace', legacyRootPath: 'synthetic-la-copy' } })
    assert.equal(scan.schemaVersion, 1)
    assert.equal(scan.totals.projects, 2)
    assert.equal(scan.projects.find(item => item.projectId === legacyProjectId).segments, 1)
    assert.equal(scan.projects.find(item => item.projectId === orphanId).orphan, true)
    let eventHandler
    registerHttpRoutes({
      ctx: { webServer: { register: route => { eventHandler = route.handler; return () => {} } } },
      service, bindings, files: common.files, mutations: common.mutations, installationId: 'synthetic',
      rebindAgent: () => { throw new Error('Migration does not rebind an Agent') },
      dispatch: async () => { throw new Error('Migration SSE does not dispatch operations') },
    })
    const streamRequest = Object.assign(new EventEmitter(), {
      method: 'GET', url: `/la/v1/events?workspaceId=synthetic-workspace&scanId=${scan.scanId}`,
      headers: { host: '127.0.0.1:19387' },
    })
    const streamed = []
    const streamResponse = {
      headersSent: false, statusCode: 0,
      writeHead(status) { this.statusCode = status; this.headersSent = true },
      write(chunk) { streamed.push(chunk) },
      end() { throw new Error('Authorized migration SSE should stay open') },
    }
    await eventHandler(streamRequest, streamResponse)
    assert.equal(streamResponse.statusCode, 200)
    assert.match(streamed[0], /event: migration-ready/)
    assert.match(streamed[0], new RegExp(scan.scanId))
    const unrelated = []
    const stopUnrelated = common.mutations.subscribeMigration('other-workspace', scan.scanId, { write: chunk => unrelated.push(chunk) })
    const dryRunRoot = join(root, 'cli-dry-run-product')
    const cli = spawnSync(process.execPath, [
      '--experimental-transform-types', '--import', './packages/linguist-cat-store/test/register-ts-loader.mjs',
      'packages/linguist-legacy-migration/src/cli.ts', 'import', '--root', legacyRoot,
      '--project', legacyProjectId, '--target-root', dryRunRoot, '--dry-run', '--json',
    ], { cwd: process.cwd(), encoding: 'utf8' })
    assert.equal(cli.status, 0, cli.stderr)
    assert.equal(JSON.parse(cli.stdout).dryRun, true)
    assert.equal(lstatSync(dryRunRoot, { throwIfNoEntry: false }), undefined)
    await assert.rejects(dispatchOperation({ ...common, operation: 'linguistLegacyMigrationImport', payload: { workspaceId: 'synthetic-workspace', scanId: '00000000-0000-0000-0000-000000000000', projectIds: [legacyProjectId] } }), /matching legacy root scan/i)
    const input = { workspaceId: 'synthetic-workspace', scanId: scan.scanId, projectIds: [legacyProjectId], options: { externalSource: 'copy' } }
    const report = await dispatchOperation({ ...common, operation: 'linguistLegacyMigrationImport', payload: input })
    const progress = streamed.filter(chunk => chunk.startsWith('event: migration-progress')).map(chunk => JSON.parse(chunk.split('data: ')[1]))
    assert.deepEqual(progress, [
      { workspaceId: 'synthetic-workspace', scanId: scan.scanId, projectId: legacyProjectId, phase: 'import', index: 1, total: 1 },
      { workspaceId: 'synthetic-workspace', scanId: scan.scanId, projectId: legacyProjectId, phase: 'verify', index: 1, total: 1 },
    ])
    assert.equal(unrelated.length, 1, 'Other Workspace receives only its own ready event')
    stopUnrelated()
    streamRequest.emit('close')
    assert.equal(report.projects.length, 1)
    const project = report.projects[0]
    assert.equal(project.legacyProjectId, legacyProjectId)
    assert.equal(project.disposition, 'imported')
    assert.equal(project.verify.status, 'passed')
    assert.equal(project.totals.assets, 1)
    assert.equal(project.totals.segments, 1)
    assert.equal(project.transcript.rows, 2)
    assert.equal(readFileSync(join(dataRoot, 'projects', project.newProjectId, 'legacy-archive', 'chat', 'pi-sessions', 'synthetic.jsonl'), 'utf8'), historicalSessionBytes)
    assert.equal(bindings.projectWorkspace(project.newProjectId), 'synthetic-workspace')
    assert.equal(service.getProject(project.newProjectId).schemaVersion, 2)
    assert.equal(Object.hasOwn(service.getProject(project.newProjectId), 'promaWorkspaceId'), false)
    assert.equal(service.openProject(project.newProjectId).segments.query({ limit: 1 })[0].target, '打开')
    assert.deepEqual(directoryHashes(legacyRoot), original)
    const quarantined = await dispatchOperation({ ...common, operation: 'linguistLegacyMigrationImport', payload: { ...input, projectIds: [orphanId] } })
    assert.equal(quarantined.projects[0].disposition, 'quarantined')
    assert.equal(quarantined.projects[0].verify.status, 'skipped')
    assert.equal(service.listProjects({ includeArchived: true }).length, 1)
    const salvaged = await dispatchOperation({ ...common, operation: 'linguistLegacyMigrationImport', payload: { ...input, projectIds: [orphanId], options: { externalSource: 'reference', salvageOrphan: true } } })
    assert.equal(salvaged.projects[0].targetConflict, false)
    assert.equal(salvaged.projects[0].verify.status, 'passed')
    assert.equal(salvaged.projects[0].totals.segments, 1)
    assert.equal(bindings.projectWorkspace(salvaged.projects[0].newProjectId), 'synthetic-workspace')
    assert.deepEqual(directoryHashes(legacyRoot), original)
    const duplicate = await dispatchOperation({ ...common, operation: 'linguistLegacyMigrationImport', payload: input })
    assert.equal(duplicate.projects[0].targetConflict, true)
    assert.deepEqual(directoryHashes(legacyRoot), original)
    symlinkSync(sourceFile, join(legacyRoot, 'synthetic-link'))
    await assert.rejects(dispatchOperation({ ...common, operation: 'linguistLegacyMigrationImport', payload: input }), /non-regular entry/i)
  } finally {
    service.closeAll()
    rmSync(root, { recursive: true, force: true })
  }
})

test('archived CAT projects remain readable and back-upable while writes fail closed', async () => {
  const root = mkdtempSync(join(tmpdir(), 'la-dsh-archived-'))
  const service = new LinguistProjectService({ rootDir: root, applicationVersion: 'synthetic-test' })
  service.init()
  try {
    const project = await service.createProject({ name: 'Synthetic archived', sourceLocale: 'zh-CN', targetLocale: 'en-US' })
    const imported = await service.importAsset(project.id, { bytes: new TextEncoder().encode('key,source,target\na,开始,Begin\n'), filename: 'synthetic.csv' })
    assert.equal(imported.status, 'imported')
    const segment = service.openProject(project.id).segments.query({ limit: 1 })[0]
    service.archiveProject(project.id)
    assert.equal(service.openProject(project.id).readOnly, true)
    assert.equal(service.getProjectSummary(project.id).totalSegments, 1)
    assert.equal(service.queryCatWorkspace(project.id, { limit: 10, offset: 0, includeIndex: false }).total, 1)
    assert.equal(service.getSegmentContext(project.id, segment.id).segment.id, segment.id)
    assert.equal(service.getStageDecisionCoverage(project.id, segment.assetId, 'translation').total, 1)
    assert.deepEqual(service.listBackups(project.id), [])
    assert.match(service.backupProject(project.id).backupName, /^backup-/u)
    assert.throws(() => service.editSegment(project.id, segment.id, 'Changed', segment.revision), /archived|归档/i)
    assert.throws(() => service.runQa(project.id, segment.assetId), /archived|归档/i)
  } finally {
    service.closeAll()
    rmSync(root, { recursive: true, force: true })
  }
})

function directoryHashes(directory) {
  const result = {}
  const visit = (base, relative = '') => {
    for (const item of readdirSync(base, { withFileTypes: true })) {
      const path = join(base, item.name)
      const child = relative === '' ? item.name : `${relative}/${item.name}`
      assert.equal(lstatSync(path).isSymbolicLink(), false)
      if (item.isDirectory()) visit(path, child)
      else result[child] = sha256(readFileSync(path))
    }
  }
  visit(directory)
  return result
}

test('Office DOCX and XLSX previews read synthetic bytes without changing originals', async () => {
  const docx = new JSZip()
  docx.file('[Content_Types].xml', '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>')
  docx.file('_rels/.rels', '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>')
  docx.file('word/document.xml', '<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>Synthetic Office text</w:t></w:r></w:p></w:body></w:document>')
  const docxBytes = await docx.generateAsync({ type: 'nodebuffer' })
  const docxHash = sha256(docxBytes)
  const docxPreview = await convertOfficePreviewToHtml(docxBytes, 'synthetic.docx')
  assert.match(docxPreview.html, /Synthetic Office text/)
  assert.equal(sha256(docxBytes), docxHash)

  const xlsx = new JSZip()
  xlsx.file('[Content_Types].xml', '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>')
  xlsx.file('_rels/.rels', '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>')
  xlsx.file('xl/workbook.xml', '<?xml version="1.0"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Synthetic" sheetId="1" r:id="rId1"/></sheets></workbook>')
  xlsx.file('xl/_rels/workbook.xml.rels', '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>')
  xlsx.file('xl/worksheets/sheet1.xml', '<?xml version="1.0"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>Source</t></is></c><c r="B1" t="inlineStr"><is><t>Target</t></is></c></row><row r="2"><c r="A2" t="inlineStr"><is><t>Open</t></is></c><c r="B2" t="inlineStr"><is><t>&lt;Start&gt;</t></is></c></row></sheetData></worksheet>')
  const xlsxBytes = await xlsx.generateAsync({ type: 'nodebuffer' })
  const xlsxHash = sha256(xlsxBytes)
  const xlsxPreview = await convertOfficePreviewToHtml(xlsxBytes, 'synthetic.xlsx')
  assert.match(xlsxPreview.html, /Synthetic/)
  assert.match(xlsxPreview.html, /&lt;Start&gt;/)
  assert.doesNotMatch(xlsxPreview.html, /<Start>/)
  assert.equal(sha256(xlsxBytes), xlsxHash)
})

test('native working-copy tool verifies Session and assembles a private full-coverage result', async () => {
  const root = mkdtempSync(join(tmpdir(), 'la-dsh-working-tool-'))
  const original = 'key,source,target\na,开始,Begin\nb,取消,Cancel\n'
  writeFileSync(join(root, 'source.csv'), original)
  let authorized = true
  let checks = 0
  const tool = createWorkingCopyTool(
    () => ({ workspaceRoot: root, sessionId: 'synthetic-session' }),
    async () => { checks += 1; if (!authorized) throw new Error('Session authority changed') },
  )
  const args = { sourcePath: 'source.csv', sourceLocale: 'zh-CN', targetLocale: 'en-US' }
  try {
    const prepared = await tool.execute({ ...args, operation: 'prepare' }, { signal: new AbortController().signal })
    assert.equal(prepared.segments, 2)
    assert.match(prepared.path, /^\.linguist\/working-copies\//)
    assert.equal(readFileSync(join(root, 'source.csv'), 'utf8'), original)
    const baseline = JSON.parse(readFileSync(join(root, prepared.path), 'utf8'))
    const [a, b] = baseline.segments
    writeFileSync(join(root, 'decisions.json'), JSON.stringify({
      sourceSha256: prepared.sourceSha256,
      groups: [{ segmentIds: [a.id], decision: 'corrected' }, { segmentIds: [b.id], decision: 'unchanged' }],
      edits: [{ segmentId: a.id, baseRevision: a.revision, target: 'Start' }], unresolved: [],
    }))
    const result = await tool.execute({ ...args, operation: 'assemble', decisionsPath: 'decisions.json' }, { signal: new AbortController().signal })
    assert.deepEqual(result.coverage, { total: 2, unchanged: 1, corrected: 1, blocked: 0, undecided: 0 })
    assert.equal(result.finalChangeCount, 1)
    assert.equal(result.submitted, false)
    assert.equal(readFileSync(join(root, 'source.csv'), 'utf8'), original)
    assert.equal(checks, 2)
    authorized = false
    await assert.rejects(tool.execute({ ...args, operation: 'prepare' }, { signal: new AbortController().signal }), /Session authority changed/)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('all eight shipped CAT adapters detect and round-trip synthetic original bytes', async () => {
  const fixture = name => new Uint8Array(readFileSync(new URL(`./fixtures/${name}`, import.meta.url)))
  const phraseXml = '<?xml version="1.0"?><xliff version="1.2" xmlns:m="http://www.memsource.com/mxlf/2.0"><file><body><trans-unit id="one"><source>Open</source><target>打开</target></trans-unit></body></file></xliff>'
  const phraseDocx = new JSZip()
  const cell = value => `<w:tc><w:p><w:r><w:t>${value}</w:t></w:r></w:p></w:tc>`
  phraseDocx.file('word/document.xml', `<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:tbl><w:tr>${['synthetic:0', '', '1', 'Open', '打开', 'Draft', ''].map(cell).join('')}</w:tr></w:tbl></w:body></w:document>`)
  const workbook = new JSZip()
  workbook.file('xl/workbook.xml', '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Synthetic" sheetId="1" r:id="rId1"/></sheets></workbook>')
  workbook.file('xl/_rels/workbook.xml.rels', '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>')
  workbook.file('xl/worksheets/sheet1.xml', '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>key</t></is></c><c r="B1" t="inlineStr"><is><t>source</t></is></c><c r="C1" t="inlineStr"><is><t>target</t></is></c></row><row r="2"><c r="A2" t="inlineStr"><is><t>a</t></is></c><c r="B2" t="inlineStr"><is><t>Open</t></is></c><c r="C2" t="inlineStr"><is><t>打开</t></is></c></row></sheetData></worksheet>')
  const cases = [
    ['mini_game_ui.xliff', new Uint8Array(readFileSync(new URL('../linguist-fixtures/mini_game_ui.xliff', import.meta.url)))],
    ['sample.mqxliff', new Uint8Array(readFileSync(new URL('../linguist-fixtures/sample.mqxliff', import.meta.url)))],
    ['minimal_delivery.sdlxliff', fixture('minimal_delivery.sdlxliff')],
    ['synthetic.mxliff', new TextEncoder().encode(phraseXml)],
    ['synthetic.docx', new Uint8Array(await phraseDocx.generateAsync({ type: 'nodebuffer' }))],
    ['mini_dialogue.csv', fixture('mini_dialogue.csv')],
    ['mini_items.json', fixture('mini_items.json')],
    ['synthetic.xlsx', new Uint8Array(await workbook.generateAsync({ type: 'nodebuffer' }))],
  ]
  const registry = createDefaultCatFormatRegistry()
  assert.equal(registry.list().length, 8)
  const project = createProject({ name: 'Synthetic formats', sourceLocale: 'zh-CN', targetLocale: 'en-US' })
  const ids = []
  for (const [filename, bytes] of cases) {
    const adapter = await registry.detectBest(bytes, filename)
    const imported = await adapter.import({ bytes, filename, sourceLocale: 'zh-CN', targetLocale: 'en-US' })
    assert.ok(imported.segments.length > 0, `${filename} has no segments`)
    const asset = createAsset({ projectId: project.id, ...imported.asset })
    const bound = bindImportedSegments(imported.segments, asset.id)
    const exported = await adapter.export({ originalBytes: bytes, asset, segments: bound })
    assert.equal(sha256(exported), sha256(bytes), `${filename} changed with no edits`)
    const reimported = await adapter.import({ bytes: exported, filename, sourceLocale: 'zh-CN', targetLocale: 'en-US' })
    assert.deepEqual(reimported.segments.map(segment => [segment.key, segment.source, segment.target, segment.locked, segment.status]), imported.segments.map(segment => [segment.key, segment.source, segment.target, segment.locked, segment.status]), filename)
    const writable = bound.find(segment => !segment.locked && !/[<>{}]/u.test(segment.source + segment.target))
    assert.ok(writable, `${filename} lacks a plain writable synthetic segment`)
    const nextTarget = 'Synthetic revised target'
    const edited = bound.map(segment => segment.id === writable.id ? { ...segment, target: nextTarget } : segment)
    const changedBytes = await adapter.export({ originalBytes: bytes, asset, segments: edited })
    assert.notEqual(sha256(changedBytes), sha256(bytes), `${filename} did not write the edited target`)
    const changed = await adapter.import({ bytes: changedBytes, filename, sourceLocale: 'zh-CN', targetLocale: 'en-US' })
    const matching = changed.segments.find(segment => segment.key === writable.key)
    assert.ok(matching, `${filename} lost the edited segment`)
    assert.equal(adapter.id === 'json_i18n' ? matching.source : matching.target, nextTarget, filename)
    const locked = bound.find(segment => segment.locked)
    if (locked) {
      await assert.rejects(adapter.export({ originalBytes: bytes, asset, segments: bound.map(segment => segment.id === locked.id ? { ...segment, target: 'Forbidden edit' } : segment) }), undefined, `${filename} allowed a locked edit`)
    }
    ids.push(adapter.id)
  }
  assert.equal(new Set(ids).size, 8)
})


test('Schedule execution history follows committed native turns, not delivery or assistant claims', () => {
  let seq = 0
  const event = (type, data) => ({ type, data, seq: seq++, time: 1000 + seq })
  const admitted = id => event('user/message', { id, source: { kind: 'linguist-schedule-execution', scheduleId: 'scheduled-A' } })
  const events = [event('turn/start', { turn: 1 }), event('user/message', { id: 'delivery', source: { kind: 'schedule' } })]
  assert.deepEqual(scheduleExecutions(events, 'scheduled-A'), [])
  const attempts = [{ sessionId: 'synthetic-session', turn: 1, messageId: 'claimed-A', attemptedAt: new Date(1002).toISOString() }]
  assert.equal(scheduleExecutions(events, 'scheduled-A', attempts)[0].phase, 'admission')
  events.push(admitted('run-A'), admitted('duplicate-step'))
  assert.equal(scheduleExecutions(events, 'scheduled-A', attempts)[0].phase, 'execution')
  assert.equal(scheduleExecutions(events, 'scheduled-A', attempts)[0].messageId, 'claimed-A')
  assert.equal(scheduleExecutions(events, 'scheduled-A', attempts).length, 1)
  assert.equal(scheduleExecutions(events, 'scheduled-A', attempts)[0].outcome, 'unfinished')
  events.push(event('assistant/message', { message: { content: [{ type: 'text', text: 'complete' }] } }))
  assert.equal(scheduleExecutions(events, 'scheduled-A', attempts)[0].outcome, 'unfinished')
  events.push(event('turn/end', { turn: 1, reason: { kind: 'error', error: { message: 'private error text', code: 'RATE_LIMITED', status: 429, requestId: 'private-request-id' } } }))
  events.push(event('turn/start', { turn: 2 }), admitted('run-B'), event('turn/end', { turn: 2, reason: { kind: 'completed' } }))
  const result = scheduleExecutions(events, 'scheduled-A', attempts)
  assert.deepEqual(result.map(run => run.outcome), ['error', 'completed'])
  assert(result.every(run => run.endedAt))
  assert.deepEqual(result[0].failure, { code: 'RATE_LIMITED', status: 429 })
  assert.equal(result[1].failure, undefined)
  assert(!JSON.stringify(result).includes('private error text'))
  assert(!JSON.stringify(result).includes('private-request-id'))
  assert.deepEqual(scheduleExecutions(events, 'another-schedule'), [])
})


test('Schedule pauses after five consecutive failures, resets after success, and ignores unfinished runs', () => {
  const run = (outcome, index) => ({ messageId: `run-${index}`, outcome, ...(outcome === 'unfinished' ? {} : { endedAt: '2026-09-29T00:00:00Z' }) })
  assert.deepEqual(scheduleRunPolicy(['error', 'error', 'error', 'error', 'unfinished'].map(run)), { runCount: 4, consecutiveFailures: 4 })
  assert.deepEqual(scheduleRunPolicy(['error', 'error', 'error', 'error', 'error'].map(run)), { runCount: 5, consecutiveFailures: 5, stopReason: 'consecutive-failures' })
  assert.deepEqual(scheduleRunPolicy(['error', 'error', 'completed', 'error'].map(run)), { runCount: 4, consecutiveFailures: 1 })
  assert.deepEqual(scheduleRunPolicy(['error', 'completed'].map(run), 2), { runCount: 2, consecutiveFailures: 0, stopReason: 'max-runs' })
})


test('LA sidecar records schedule admission failures before a model-visible user message exists', async () => {
  const root = mkdtempSync(join(tmpdir(), 'la-dsh-schedule-admission-'))
  const service = new LinguistProjectService({ rootDir: join(root, 'linguist'), applicationVersion: 'synthetic-test' })
  service.init()
  try {
    const project = await service.createProject({ name: 'Synthetic admission', sourceLocale: 'zh-CN', targetLocale: 'en-US' })
    await service.importAsset(project.id, { bytes: new TextEncoder().encode('key,source,target\na,开始,Begin\n'), filename: 'first.csv' })
    const bindings = new BindingStore(root)
    bindings.bindProject(project.id, 'workspace-admission')
    let session = Session.create(SessionId('session-admission'))
    let agent = { id: session.id, session }
    const sourceId = session.id
    const actors = new Map([[session.id, agent]])
    const runtime = {
      async resolve(id) { return actors.get(id) },
      async create(_source, binding, _title, record) {
        const id = SessionId(`session-admission-task-${randomUUID()}`)
        const owner = { id, session: Session.create(id) }
        actors.set(id, owner)
        bindings.bindSession(id, binding)
        record({ sessionId: id, createdAt: new Date().toISOString() })
        return owner
      },
    }
    bindings.bindSession(session.id, { workspaceId: 'workspace-admission', projectId: project.id, role: 'reviewer', workMode: 'cat' })
    const native = {
      rows: [],
      async create(sessionId, request) {
        const record = createEveryScheduleRecord(ScheduleId(`schedule-${randomUUID()}`), request.prompt, request.every_seconds, Date.now(), request.title)
        this.rows.push({ ...record, sessionId, status: 'active' })
        return record
      },
      async catalog() { return this.rows },
      async history({ id }) { return { id, records: [], earlierRecordsUnavailable: false, earlierRecordsPruned: false } },
      async delete({ id }) { this.rows = this.rows.filter(row => row.id !== id); return { id, deleted: true } },
    }
    const manager = new ScheduleContextManager(root, native, service, bindings, async (sid, pid) => { assert.equal(bindings.session(sid)?.projectId, pid); assert.equal(pid, project.id) }, async id => actors.get(id)?.session.ownEvents(), runtime)
    const created = await manager.create({ sessionId: session.id, projectId: project.id, title: 'Admission fixture', prompt: 'Review synthetic project', executeAtDue: true, scope: 'project', timing: { kind: 'every', seconds: 60 } })
    agent = actors.get(created.sessionId); session = agent.session
    const due = { id: 'native-due', role: 'user', source: { kind: 'schedule' }, content: [{ type: 'text', text: renderReminderFraming(native.rows[0]) }] }
    await service.importAsset(project.id, { bytes: new TextEncoder().encode('key,source,target\nb,结束,End\n'), filename: 'second.csv' })
    for (let turn = 1; turn <= 5; turn++) {
      session.append('turn/start', { turn })
      const message = { ...due, id: `native-due-${turn}` }
      manager.recordAttempts(agent, [message], turn)
      await assert.rejects(manager.onPreStep(agent, { kind: 'enter', messages: [message] }, turn, 1), /project revision changed/)
      session.append('turn/end', { turn, reason: { kind: 'error', error: { code: 'UNKNOWN', message: 'synthetic authorization rejection' } } })
      if (turn === 1) {
        const { validateStoredEvents } = requireDsh('@deepseek-ai/dsh-session-persistence')
        const cold = Session.create(session.id, validateStoredEvents(session.header, structuredClone(session.ownEvents())), session.header)
        const reopened = new ScheduleContextManager(root, native, service, bindings, async () => {}, async id => id === session.id ? cold.ownEvents() : actors.get(id)?.session.ownEvents(), runtime)
        assert.deepEqual((await reopened.history(session.id, created.scheduleId, 10)).executions.map(run => [run.phase, run.outcome]), [['admission', 'error']], 'an active task restores admission failures from its sidecar plus native turn endings')
      }
      await manager.enforceRunPolicy(session.id)
      assert.equal(native.rows.length, turn < 5 ? 1 : 0)
    }
    assert(!session.ownEvents().some(event => event.type === 'user/message'), 'rejected task never reached model-visible input')
    const history = await manager.history(session.id, created.scheduleId, 10)
    assert.equal(history.executions.length, 5)
    assert(history.executions.every(run => run.phase === 'admission' && run.outcome === 'error'))
    const { validateStoredEvents } = requireDsh('@deepseek-ai/dsh-session-persistence')
    const restored = Session.create(session.id, validateStoredEvents(session.header, structuredClone(session.ownEvents())), session.header)
    agent.session = restored
    const reopened = new ScheduleContextManager(root, native, service, bindings, async (sid, pid) => { assert.equal(bindings.session(sid)?.projectId, pid) }, async id => actors.get(id)?.session.ownEvents(), runtime)
    assert.equal((await reopened.history(session.id, created.scheduleId, 10)).executions.length, 5, 'sidecar attempts and native outcomes survive a real native cold read')
    agent.session = session
    session.append('turn/start', { turn: 6 })
    manager.recordAttempts(agent, [{ ...due, id: 'late-due' }], 6)
    session.append('turn/end', { turn: 6, reason: { kind: 'error', error: { code: 'UNKNOWN', message: 'stopped' } } })
    assert.equal((await manager.history(session.id, created.scheduleId, 10)).executions.length, 5, 'already stopped tasks do not accumulate phantom attempts')
    const modelTask = await manager.create({ sessionId: sourceId, projectId: project.id, title: 'Model admission fixture', prompt: 'Review current synthetic project', executeAtDue: true, scope: 'project', timing: { kind: 'every', seconds: 60 } })
    agent = actors.get(modelTask.sessionId); session = agent.session
    const modelDue = { ...due, id: 'model-due', content: [{ type: 'text', text: renderReminderFraming(native.rows[0]) }] }
    session.append('turn/start', { turn: 7 })
    manager.recordAttempts(agent, [modelDue], 7)
    await manager.onPreStep(agent, { kind: 'enter', messages: [modelDue] }, 7, 1)
    await assert.rejects(manager.validateModelRequest(agent, 7, 1, { provider: 'synthetic', model: 'chosen' }, async () => { throw new Error('model unavailable') }), /model unavailable/)
    session.append('turn/end', { turn: 7, reason: { kind: 'error', error: { code: 'MODEL_UNAVAILABLE', message: 'synthetic model failure' } } })
    manager.clearTurn(session.id, 7)
    await manager.validateModelRequest(agent, 7, 1, { provider: 'synthetic', model: 'chosen' }, async () => { throw new Error('ended turn must not resolve model again') })
    assert.equal((await manager.history(session.id, modelTask.scheduleId, 10)).executions.reverse()[0].phase, 'admission')
    session.append('turn/start', { turn: 8 })
    const nextDue = { ...modelDue, id: 'model-due-next' }
    manager.recordAttempts(agent, [nextDue], 8)
    manager.recordAttempts(agent, [nextDue], 8)
    const admitted = await manager.onPreStep(agent, { kind: 'enter', messages: [nextDue] }, 8, 1)
    session.append('step/start', { turn: 8, step: 1 })
    session.append('user/message', admitted.messages[1], { surfaceOp: 'append' })
    session.append('turn/end', { turn: 8, reason: { kind: 'completed' } })
    const modelRuns = (await manager.history(session.id, modelTask.scheduleId, 10)).executions.reverse()
    assert.deepEqual(modelRuns.map(run => run.phase), ['admission', 'execution'])
    assert.equal(modelRuns.length, 2, 'repeated observations in the same turn count once')
    assert.equal(scheduleRunPolicy(modelRuns).consecutiveFailures, 0)
    session.append('turn/start', { turn: 9 })
    manager.recordAttempts(agent, [{ ...modelDue, id: 'rewritten-away' }], 9)
    session.append('turn/end', { turn: 9, reason: { kind: 'completed' } })
    const withNoop = (await manager.history(session.id, modelTask.scheduleId, 10)).executions.reverse()
    assert.equal(withNoop.at(-1).outcome, 'not-admitted')
    assert.equal(scheduleRunPolicy(withNoop).runCount, 2, 'empty completed turn is not an executed task')

  } finally { service.closeAll(); rmSync(root, { recursive: true, force: true }) }
})

test('scheduled business work runs in its own native Session and only its real ending counts', async () => {
  const root = mkdtempSync(join(tmpdir(), 'la-dsh-schedule-dispatch-'))
  const service = new LinguistProjectService({ rootDir: join(root, 'linguist'), applicationVersion: 'synthetic-test' })
  service.init()
  try {
    const project = await service.createProject({ name: 'Synthetic dispatch', sourceLocale: 'en-US', targetLocale: 'zh-CN' })
    await service.importAsset(project.id, { bytes: new TextEncoder().encode('key,source,target\na,Start,开始\n'), filename: 'fixture.csv' })
    const bindings = new BindingStore(root)
    const source = { id: SessionId('session-dispatch-source'), session: Session.create(SessionId('session-dispatch-source')) }
    let parent
    const actors = new Map([[source.id, source]])
    const child = { id: SessionId('session-dispatch-child'), session: Session.create(SessionId('session-dispatch-child')), status: 'idle', inbox: { nextTurn: [], nextStep: [] }, followup(message) { this.inbox.nextTurn.push(message) } }
    bindings.bindProject(project.id, 'workspace-dispatch')
    const binding = { workspaceId: 'workspace-dispatch', projectId: project.id, role: 'reviewer', workMode: 'cat' }
    bindings.bindSession(source.id, binding)
    const native = {
      rows: [],
      async create(sessionId, request) {
        const record = createEveryScheduleRecord(ScheduleId(`schedule-${randomUUID()}`), request.prompt, request.every_seconds, Date.now(), request.title)
        this.rows.push({ ...record, sessionId, status: 'active' })
        if (this.beforeReturn) await this.beforeReturn(record)
        return record
      },
      async catalog() { return this.rows },
      async history({ id }) { return { id, records: [], earlierRecordsUnavailable: false, earlierRecordsPruned: false } },
      async delete({ id }) { this.rows = this.rows.filter(row => row.id !== id); return { id, deleted: true } },
    }
    const { ScheduleNotifications } = await import('../../packages/dsh-linguist/src/host/schedule-notifications.ts')
    let notificationRequests = 0
    const notifier = new ScheduleNotifications(() => [{ id: 'test-chat', label: 'Synthetic', appId: 'test-app', appSecret: 'test-secret', chatId: 'test-room', domain: 'feishu' }], async () => {
      notificationRequests++
      return new Response(JSON.stringify(notificationRequests % 2 ? { code: 0, tenant_access_token: 'test-token' } : { code: 0, data: { message_id: 'test-receipt' } }))
    })
    let childDeleted = false
    let creates = 0
    const runtime = {
      async create(owner, scope, title, record) {
        assert.equal(title, 'Dedicated review')
        if (owner === source) {
          const id = SessionId(`session-task-owner-${randomUUID()}`)
          parent = { id, session: Session.create(id) }
          actors.set(id, parent)
          bindings.bindSession(id, scope)
          record({ sessionId: id, createdAt: new Date().toISOString() })
          return parent
        }
        assert.equal(owner, parent); creates++
        assert.equal(scope.delegatedScope.segmentIds.length, 1)
        actors.set(child.id, child)
        bindings.bindSession(child.id, scope)
        record({ sessionId: child.id, createdAt: new Date().toISOString() })
        return child
      },
      async busy() { return child.status === 'running' || child.inbox.nextTurn.length > 0 },
      async reusable() { return true }, async resolve(id) { return actors.get(id) }, async flush() {},
    }
    const manager = new ScheduleContextManager(root, native, service, bindings, async (sid, pid) => {
      assert.equal(bindings.session(sid)?.projectId, pid); assert.equal(pid, project.id)
    }, async sid => sid === child.id && childDeleted ? undefined : actors.get(sid)?.session.ownEvents(), runtime, undefined, notifier)
    const created = await manager.create({ sessionId: source.id, projectId: project.id, title: 'Dedicated review', prompt: 'Review synthetic content', executeAtDue: true, scope: 'project', maxRuns: 1, notificationTargets: [{ destinationId: 'test-chat', trigger: 'success' }], timing: { kind: 'every', seconds: 60 } })
    const due = { id: 'dispatch-due', role: 'user', source: { kind: 'schedule' }, content: [{ type: 'text', text: renderReminderFraming(native.rows[0]) }] }
    parent.session.append('turn/start', { turn: 1 })
    manager.recordAttempts(parent, [due], 1)
    const routed = await manager.dispatchDue(parent, { kind: 'enter', messages: [due] }, 1, [due])
    assert.deepEqual(routed, { kind: 'reject' })
    assert.equal(child.inbox.nextTurn.length, 1)
    parent.session.append('turn/end', { turn: 1, reason: { kind: 'blocked' } })
    await manager.enforceRunPolicy(parent.id)
    assert.equal(native.rows.length, 1, 'dispatch does not consume the execution limit')
    assert.equal((await manager.history(parent.id, created.scheduleId, 10)).executions[0].outcome, 'dispatched')
    parent.session.append('turn/start', { turn: 2 })
    manager.recordAttempts(parent, [{ ...due, id: 'busy-owner-due' }], 2)
    assert.deepEqual(await manager.dispatchDue(parent, { kind: 'enter', messages: [due] }, 2, [due]), { kind: 'reject' })
    parent.session.append('turn/end', { turn: 2, reason: { kind: 'blocked' } })
    assert.equal((await manager.history(parent.id, created.scheduleId, 10)).executions[0].outcome, 'not-admitted', 'a busy execution Session must not count as another run')
    assert.equal(child.inbox.nextTurn.length, 1, 'idle but queued target must not receive duplicate work')
    assert.equal(creates, 1)
    const human = { id: 'human-claimed', role: 'user', source: { kind: 'user' }, content: [{ type: 'text', text: 'Keep my ordinary task' }] }
    const mixed = await manager.dispatchDue(parent, { kind: 'enter', messages: [due, human] }, 2, [due, human])
    assert.equal(mixed.kind, 'enter', 'dispatch must not suppress a real human instruction in the same claimed batch')
    assert.deepEqual(mixed.messages, [human])
    const delivered = child.inbox.nextTurn.shift()
    child.session.append('turn/start', { turn: 1 })
    manager.recordAttempts(child, [delivered], 1)
    bindings.bindSession(child.id, { ...bindings.session(child.id), role: 'translator' })
    await assert.rejects(manager.onPreStep(child, { kind: 'enter', messages: [delivered] }, 1, 0), /binding or instruction changed/)
    bindings.bindSession(child.id, { ...bindings.session(child.id), role: 'reviewer' })
    const admitted = await manager.onPreStep(child, { kind: 'enter', messages: [delivered] }, 1, 0)
    assert.equal(admitted.messages.length, 1)
    assert.equal(admitted.messages[0].source.kind, 'linguist-schedule-execution')
    child.session.append('user/message', admitted.messages[0], { surfaceOp: 'append' })
    child.session.append('turn/end', { turn: 1, reason: { kind: 'completed' } })
    await manager.recordExecutionEnd(child.id, 1)
    assert.equal(notificationRequests, 2)
    await manager.recordExecutionEnd(child.id, 1)
    assert.equal(notificationRequests, 2, 'replayed end must not duplicate an external notification')
    childDeleted = true
    await manager.enforceRunPolicy(child.id)
    assert.equal(native.rows.length, 0, 'actual child completion enforces owner task limit')
    const history = await manager.history(parent.id, created.scheduleId, 10)
    assert.equal(scheduleRunPolicy(history.executions).runCount, 1, 'deleted execution Session retains its real completion count')
    assert.equal(history.executions.find(run => run.outcome === 'completed').sessionId, child.id)
    assert.deepEqual(history.executions.find(run => run.outcome === 'completed').notifications, [{ destinationId: 'test-chat', status: 'sent', messageId: 'test-receipt' }])
    childDeleted = false
    native.beforeReturn = async record => {
      const early = { ...due, id: 'early-dispatch', content: [{ type: 'text', text: renderReminderFraming(record) }] }
      assert.deepEqual(await manager.dispatchDue(parent, { kind: 'enter', messages: [early] }, 3, [early]), { kind: 'reject' })
    }
    const early = await manager.create({ sessionId: source.id, projectId: project.id, title: 'Dedicated review', prompt: 'Review synthetic content', executeAtDue: true, scope: 'project', timing: { kind: 'every', seconds: 60 } })
    assert.equal((await manager.list(parent.id)).items.find(task => task.scheduleId === early.scheduleId).executionSessionId, child.id, 'create response must preserve a Session dispatched before it returned')
  } finally { service.closeAll(); rmSync(root, { recursive: true, force: true }) }
})

test('scheduled Session creation preserves native settings and daily reuse rotates on real boundaries', async () => {
  const { ScheduleSessionRuntime } = await import('../../packages/dsh-linguist/src/host/schedule-session.ts')
  const root = mkdtempSync(join(tmpdir(), 'la-dsh-task-session-'))
  try {
    const bindings = new BindingStore(root)
    const binding = { workspaceId: 'workspace-task', projectId: 'project-task', role: 'reviewer', workMode: 'cat', delegatedScope: { assetIds: ['asset'], segmentIds: ['segment'] } }
    const events = [
      { type: 'permission/preset', seq: 0, time: 1, data: { preset: 'workspace-write' } },
      { type: 'sandbox/mode', seq: 1, time: 2, data: { mode: 'workspace-write' } },
      { type: 'approval/policy', seq: 2, time: 3, data: { policy: 'ask' } },
    ]
    const model = { provider: 'synthetic', model: 'selected', reasoningEffort: 'max' }
    let stored, recorded, bound, exists = true, pressure, human = false
    const steps = []
    const pending = { status: 'idle', inbox: { nextTurn: [], nextStep: [] } }
    const ctx = {
      workspaceRegistry: { get: () => ({ path: root }) },
      sessionPersistence: {
        async stat() { return exists ? {} : undefined },
        async create(header) {
          stored = { header }
          return { async append(seed) { stored.seed = seed; steps.push('append') }, async flush() { steps.push('flush') }, async close() { steps.push('close') } }
        },
      },
      sessionController: {
        async inspect(id) { return { meta: { agentPreset: 'chosen-preset' }, inheritedEventCount: 0, events: id === 'session-parent' ? events : human ? [{ type: 'user/message', data: { source: { kind: 'user' } } }] : [] } },
        async projections() { return { values: { modelSelection: { next: model }, contextPressure: pressure } } },
        async create(input) { assert.equal(input.sessionId, stored.header.id); assert.equal(input.agentPreset, 'chosen-preset'); steps.push('adopt') },
        async resolveAgent(id) { return { agent: { id, ...pending } } },
        async rename(input) { assert.equal(input.title, 'Review task') },
      },
    }
    const runtime = new ScheduleSessionRuntime(ctx, bindings, agent => { bound = agent.id })
    const agent = await runtime.create({ id: 'session-parent' }, binding, 'Review task', item => { recorded = item })
    assert.equal(agent.id, recorded.sessionId)
    assert.equal(bound, agent.id)
    assert.deepEqual(steps, ['append', 'flush', 'close', 'adopt'])
    assert.equal(stored.header.parentSession, undefined, 'task Session persistence is independent of the source')
    assert.notEqual(stored.header.origin, 'subagent', 'ordinary Session retains native user approval interaction')
    assert.equal(stored.header.agentPreset, 'chosen-preset')
    assert.deepEqual(stored.seed.map(event => event.data), [...events.map(event => event.data), model])
    const validated = requireDsh('@deepseek-ai/dsh-session-persistence').validateStoredEvents(stored.header, structuredClone(stored.seed))
    const restored = Session.create(agent.id, validated, stored.header)
    assert.deepEqual(restored.deriveMessages(), [], 'only settings, no parent conversation copied')
    assert.equal(await runtime.busy(recorded), false)
    pending.status = 'running'
    assert.equal(await runtime.busy(recorded), true)
    pending.status = 'idle'; pending.inbox.nextTurn.push({})
    assert.equal(await runtime.busy(recorded), true)
    pending.inbox.nextTurn.length = 0
    assert.equal(await runtime.reusable(recorded, binding, 'daily'), true)
    pressure = { projectedTokens: 70, contextWindow: 100 }
    assert.equal(await runtime.reusable(recorded, binding, 'daily'), false)
    assert.equal(await runtime.reusable(recorded, binding, 'reuse'), true)
    pressure = { projectedTokens: 69, contextWindow: 100 }
    assert.equal(await runtime.reusable(recorded, binding, 'daily'), true)
    const yesterday = { ...recorded, createdAt: new Date(Date.now() - 86400000).toISOString() }
    assert.equal(await runtime.reusable(yesterday, binding, 'daily'), false)
    assert.equal(await runtime.reusable(yesterday, binding, 'reuse'), true)
    human = true
    assert.equal(await runtime.reusable(recorded, binding, 'reuse'), false)
    human = false; exists = false
    assert.equal(await runtime.busy(recorded), false)
    assert.equal(await runtime.reusable(recorded, binding, 'reuse'), false)
    exists = true
    assert.equal(await runtime.reusable(recorded, { ...binding, role: 'translator' }, 'reuse'), false)
  } finally { rmSync(root, { recursive: true, force: true }) }
})

test('Feishu schedule notifications freeze recipients, disclose only selected turn text and preserve uncertain delivery', async () => {
  const { ScheduleNotifications } = await import('../../packages/dsh-linguist/src/host/schedule-notifications.ts')
  const destination = { id: 'synthetic-chat', label: 'Synthetic chat', appId: 'synthetic-app', appSecret: 'synthetic-secret', chatId: 'synthetic-room', domain: 'feishu' }
  const calls = []
  let configured = [destination]
  const notifier = new ScheduleNotifications(() => configured, async (url, request) => {
    calls.push({ url, ...request })
    return new Response(JSON.stringify(calls.length % 2 === 1 ? { code: 0, tenant_access_token: 'synthetic-token' } : { code: 0, data: { message_id: 'synthetic-sent' } }))
  })
  assert.deepEqual(notifier.list(), [{ id: destination.id, label: destination.label }])
  assert(!JSON.stringify(notifier.list()).includes(destination.appSecret))
  const target = notifier.freeze([{ destinationId: destination.id, trigger: 'success' }])[0]
  assert.throws(() => notifier.freeze([{ destinationId: 'missing', trigger: 'always' }]), /Unknown/)
  assert.throws(() => notifier.freeze([target, target]), /Duplicate/)
  const run = { scheduleId: 'schedule-synthetic', messageId: 'input-synthetic', sessionId: 'session-synthetic', title: 'Synthetic task', turn: 2, outcome: 'completed' }
  const events = [1, 2].map(turn => ({ type: 'assistant/message', data: { turn, message: { content: [{ type: 'text', text: turn === 1 ? 'OLD_TURN_MUST_NOT_SEND' : 'Synthetic current response' }] } } }))
  assert.deepEqual(await notifier.send(target, run, events), { destinationId: target.destinationId, status: 'sent', messageId: 'synthetic-sent' })
  assert.equal(calls.length, 2)
  assert.equal(calls[1].redirect, 'error')
  const body = JSON.parse(calls[1].body)
  assert.equal(body.receive_id, destination.chatId)
  assert.match(body.content, /Synthetic current response/)
  assert.match(body.content, /执行结束不等于/)
  assert(!body.content.includes('OLD_TURN_MUST_NOT_SEND'))
  assert(!body.content.includes(destination.appSecret))
  configured = [{ ...destination, chatId: 'edited-live-room' }]
  assert.equal((await notifier.send(target, run, events)).code, 'DESTINATION_CHANGED')
  assert.equal(calls.length, 2, 'live configuration edits must not redirect an already authorized task')
  const changed = new ScheduleNotifications(() => [{ ...destination, chatId: 'another-room' }], async () => { throw new Error('must not transmit') })
  assert.equal((await changed.send(target, run, events)).code, 'DESTINATION_CHANGED')
  let requests = 0
  const uncertain = new ScheduleNotifications(() => [destination], async () => {
    if (++requests === 1) return new Response(JSON.stringify({ code: 0, tenant_access_token: 'synthetic-token' }))
    throw new Error('synthetic transport interruption')
  })
  assert.deepEqual(await uncertain.send(target, run, events), { destinationId: target.destinationId, status: 'unknown', code: 'SEND_TRANSPORT' })
  const denied = new ScheduleNotifications(() => [destination], async () => new Response('{}', { status: 401 }))
  assert.equal((await denied.send(target, run, events)).code, 'AUTH_HTTP_401')
})

test('native DSH settings redact Linguist notification credentials', async () => {
  const { Config } = await import('../../packages/dsh-linguist/src/index.ts')
  const { redactSecrets } = await import('../../.toolchain/dsh-0.2.0-rc.2/node_modules/@deepseek-ai/dsh-settings/lib/index.js')
  const value = { dataRoot: '/synthetic', installationId: 'synthetic', notificationDestinations: [{ id: 'room', label: 'Synthetic', appId: 'app', appSecret: 'DO_NOT_EXPOSE_SYNTHETIC_SECRET', chatId: 'chat', domain: 'feishu' }] }
  assert.equal(Config.dict.notificationDestinations.meta.volatile, true, 'native configuration UI only exposes live fields')
  assert.equal(Config(value).notificationDestinations.get()[0].appId, 'app', 'live config must be read through native Volatile.get')
  assert.deepEqual(Config({ dataRoot: '/synthetic', installationId: 'synthetic' }).notificationDestinations.get(), [])
  const result = redactSecrets(Config, value)
  assert(!JSON.stringify(result).includes(value.notificationDestinations[0].appSecret))
  assert.equal(result.value.notificationDestinations[0].appId, 'app')
  assert.equal(result.secrets.length, 1)
  assert.equal(value.notificationDestinations[0].appSecret, 'DO_NOT_EXPOSE_SYNTHETIC_SECRET', 'wire redaction must not erase stored configuration')
})
