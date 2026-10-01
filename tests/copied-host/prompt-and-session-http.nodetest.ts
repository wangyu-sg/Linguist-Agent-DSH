import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, renameSync, rmSync, unlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Readable } from 'node:stream'
import { pathToFileURL } from 'node:url'
import test from 'node:test'
import { LinguistProjectService } from '../../packages/linguist-domain-service/src/index.ts'
import { BindingStore } from '../../packages/dsh-linguist/src/host/bindings.ts'
import { buildLinguistPromptSection } from '../../packages/dsh-linguist/src/host/diagnostics.ts'
import { ManagedFiles } from '../../packages/dsh-linguist/src/host/files.ts'
import { registerHttpRoutes } from '../../packages/dsh-linguist/src/host/http.ts'
import { MutationBus } from '../../packages/dsh-linguist/src/host/mutations.ts'
import { loadLinguistRoleResources } from '../../packages/dsh-linguist/src/host/role-resources.ts'
import { apply as applyHost, inject as hostInject } from '../../packages/dsh-linguist/src/index.ts'
import { Context } from '../../packages/dsh-linguist/node_modules/@deepseek-ai/cordis/lib/index.js'
import { SystemPrompt, renderPrompt } from '../../packages/dsh-linguist/node_modules/@deepseek-ai/dsh-system-prompt/lib/index.js'
import { ToolRuntime } from '../../packages/dsh-linguist/node_modules/@deepseek-ai/dsh-tools/lib/index.js'
import { Session, SessionId } from '../../packages/dsh-linguist/node_modules/@deepseek-ai/dsh-session/lib/index.js'
import { WorkspaceId } from '../../packages/dsh-linguist/node_modules/@deepseek-ai/dsh-workspace/lib/index.js'
import { createSystemMessage, createUserMessage } from '../../packages/dsh-linguist/node_modules/@deepseek-ai/dsh-llm/lib/index.js'
import { AttachmentId } from '../../packages/dsh-linguist/node_modules/@deepseek-ai/dsh-attachment/lib/index.js'
import { ensureStageEvidenceForSession } from '../../packages/dsh-linguist/src/host/stage-evidence.ts'
import { projectDiscoveryScope } from '../../packages/dsh-linguist/src/host/discovery.ts'

test('packaged role resources reject missing, blank and oversized instructions without path in the error message', () => {
  const root = mkdtempSync(join(tmpdir(), 'la-dsh-role-resource-'))
  const directory = join(root, 'roles')
  mkdirSync(directory)
  try {
    for (const role of ['general', 'translator', 'reviewer', 'proofreader']) writeFileSync(join(directory, `${role}.md`), `${role} instructions`)
    const base = pathToFileURL(`${directory}/`)
    assert.equal(loadLinguistRoleResources(base).reviewer, 'reviewer instructions')
    unlinkSync(join(directory, 'reviewer.md'))
    assert.throws(() => loadLinguistRoleResources(base), error => error instanceof Error
      && error.message === 'Linguist reviewer role resource unavailable' && !error.message.includes(root))
    writeFileSync(join(directory, 'reviewer.md'), '  ')
    assert.throws(() => loadLinguistRoleResources(base), /Linguist reviewer role resource invalid/)
    writeFileSync(join(directory, 'reviewer.md'), 'x'.repeat(6_001))
    assert.throws(() => loadLinguistRoleResources(base), /Linguist reviewer role resource invalid/)
  } finally { rmSync(root, { recursive: true, force: true }) }
})

test('native Prompt retains the role and only whole Digest lines within 18k', async () => {
  const root = mkdtempSync(join(tmpdir(), 'la-dsh-prompt-copy-'))
  const service = new LinguistProjectService({ rootDir: join(root, 'linguist'), applicationVersion: 'synthetic-test' })
  service.init()
  try {
    const project = await service.createProject({ name: 'Synthetic prompt', sourceLocale: 'zh-CN', targetLocale: 'en-US' })
    const db = service.openProject(project.id)
    for (let index = 0; index < 12; index++) db.styleGuideRules.upsert({
      groupKey: '必须', ruleText: `COMPLETE-RULE-${index}:` + `synthetic-${index}-`.repeat(220),
    })
    const roles = Object.fromEntries((['general', 'translator', 'reviewer', 'proofreader'] as const).map(role => [
      role, readFileSync(new URL(`../../packages/dsh-linguist/resources/linguist-roles/${role}.md`, import.meta.url), 'utf8'),
    ])) as Record<'general' | 'translator' | 'reviewer' | 'proofreader', string>
    for (const text of Object.values(roles)) assert.ok(text.length <= 6_000)
    const result = buildLinguistPromptSection(service, roles, { role: 'reviewer', workMode: 'cat', projectId: project.id })
    assert.ok(result.prompt.length <= 18_000)
    assert.equal(result.status.role, 'reviewer')
    assert.equal(result.status.projectDigestTruncated, true)
    assert.match(result.prompt, /COMPLETE-RULE-0:/)
    assert.match(result.prompt, /其余必要要求与资料尚未展开/)
    assert.doesNotMatch(result.prompt, /COMPLETE-RULE-11:/)
    assert.match(result.prompt, /独立|审读|审校/)
  } finally { service.closeAll(); rmSync(root, { recursive: true, force: true }) }
})

test('native Session binding rejects a role change after a real user request', async () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'la-dsh-session-http-')))
  const service = new LinguistProjectService({ rootDir: join(root, 'linguist'), applicationVersion: 'synthetic-test' })
  service.init()
  const bindings = new BindingStore(root)
  let handler: ((request: unknown, response: unknown) => Promise<void>) | undefined
  try {
    const project = await service.createProject({ name: 'Synthetic binding', sourceLocale: 'zh-CN', targetLocale: 'en-US' })
    bindings.bindProject(project.id, 'workspace-synthetic')
    bindings.bindSession('session-synthetic', { workspaceId: 'workspace-synthetic', projectId: project.id, role: 'translator', workMode: 'cat' })
    const ctx = {
      webServer: { register: (entry: { handler: typeof handler }) => { handler = entry.handler; return () => {} } },
      sessionPersistence: {
        stat: async () => ({ header: { cwd: root } }),
        open: async () => ({ read: async () => ({ events: [{ type: 'user/message', data: { source: { kind: 'user' } } }] }), close: async () => {} }),
      },
      workspaceRegistry: { list: () => [{ id: 'workspace-synthetic', path: root }] },
    }
    registerHttpRoutes({
      ctx: ctx as never, service, bindings, files: new ManagedFiles(root), mutations: new MutationBus(), installationId: 'synthetic',
      rebindAgent: () => { throw new Error('Role change should be rejected before rebind') },
      dispatch: async () => { throw new Error('Unexpected operation') },
    })
    assert.ok(handler)
    const request = Readable.from([Buffer.from(JSON.stringify({
      sessionId: 'session-synthetic', projectId: project.id, role: 'reviewer', workMode: 'cat',
    }))]) as Readable & { method: string; url: string; headers: Record<string, string> }
    request.method = 'POST'
    request.url = '/la/v1/session-bind'
    request.headers = { host: '127.0.0.1:19387', 'content-type': 'application/json' }
    const response = {
      headersSent: false, statusCode: 0, body: '',
      writeHead(status: number) { this.statusCode = status; this.headersSent = true },
      end(body: string) { this.body = body },
    }
    await handler(request, response)
    assert.equal(response.statusCode, 409)
    assert.match((JSON.parse(response.body) as { error: string }).error, /fixed after the first user request/)
    assert.equal(bindings.session('session-synthetic')?.role, 'translator')
  } finally { service.closeAll(); rmSync(root, { recursive: true, force: true }) }
})

test('missing CAT database leaves Prompt diagnostic available and never recreates the database', async () => {
  const root = mkdtempSync(join(tmpdir(), 'la-dsh-cat-availability-'))
  const service = new LinguistProjectService({ rootDir: join(root, 'linguist'), applicationVersion: 'synthetic-test' })
  service.init()
  try {
    const project = await service.createProject({ name: 'Synthetic availability', sourceLocale: 'zh-CN', targetLocale: 'en-US' })
    const path = service.getProjectPaths(project.id).catDbPath
    service.closeProject(project.id)
    renameSync(path, `${path}.held`)
    try {
      const roles = { general: 'General', translator: 'Translator', reviewer: 'Reviewer', proofreader: 'Proofreader' }
      const prompt = buildLinguistPromptSection(service, roles, { role: 'general', workMode: 'cat', projectId: project.id })
      assert.equal(prompt.status.projectDigestStatus, 'skipped')
      assert.match(prompt.prompt, /Project Digest 当前无可用项目数据/)
      assert.equal(existsSync(path), false)
      assert.throws(() => service.openProject(project.id))
    } finally { renameSync(`${path}.held`, path) }
    assert.equal(service.checkProjectHealth(project.id).healthy, true)
  } finally { service.closeAll(); rmSync(root, { recursive: true, force: true }) }
})

for (const scenario of ['general', 'bound-scope', 'parent-scope', 'no-parent-scope'] as const) test(`real Host ${scenario} binding survives CAT replacement and keeps its first delegated scope`, async () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'la-dsh-host-availability-')))
  const attachmentRoot = realpathSync(mkdtempSync(join(tmpdir(), 'la-dsh-session-files-')))
  const attachedPaths = new Map<string, string>()
  const resolvedAttachments: string[] = []
  const service = new LinguistProjectService({ rootDir: join(root, 'linguist'), applicationVersion: 'synthetic-test' })
  service.init()
  const project = await service.createProject({ name: 'Synthetic Host availability', sourceLocale: 'en-US', targetLocale: 'zh-CN' })
  const workspaceId = WorkspaceId('workspace-host-availability')
  const sessionId = SessionId('session-host-availability')
  const parentSessionId = SessionId('session-parent-availability')
  const imported = await service.importAsset(project.id, { filename: 'synthetic.csv', bytes: new TextEncoder().encode('key,source,target\na,Start,开始\nb,Next,下一步\n') })
  const segmentIds = service.openProject(project.id).segments.queryIds({ assetId: imported.assetId })
  if (scenario === 'bound-scope' || scenario === 'parent-scope') ensureStageEvidenceForSession({
    session: { id: parentSessionId, linguistRole: 'reviewer' }, db: service.openProject(project.id),
    discoveryScope: projectDiscoveryScope(service, project.id, workspaceId, root), fallbackSegmentIds: [segmentIds[0]!],
  })
  const path = service.getProjectPaths(project.id).catDbPath
  const backup = service.backupProject(project.id)
  service.closeAll()
  const bytes = readFileSync(path)
  const bindings = new BindingStore(root)
  bindings.bindProject(project.id, workspaceId)
  bindings.bindSession(sessionId, { workspaceId, projectId: project.id, role: scenario === 'general' ? 'general' : 'reviewer', workMode: 'cat',
    ...(scenario === 'bound-scope' ? { delegatedScope: { assetIds: [imported.assetId], segmentIds: [segmentIds[0]!] } } : {}),
  })
  const ctx = new Context()
  const promptPlugin = ctx.plugin(SystemPrompt, {})
  await promptPlugin.await()
  const toolsPlugin = ctx.plugin(ToolRuntime, { mode: 'native' })
  await toolsPlugin.await()
  let handler: ((request: unknown, response: unknown) => Promise<void>) | undefined
  const services = {
    agents: { list: () => [] },
    attachments: { fileHostPath: (ref: { attachmentId: string }) => {
      resolvedAttachments.push(ref.attachmentId)
      return attachedPaths.get(ref.attachmentId)
    } },
    skills: { registerProvider: () => () => {} },
    webServer: { register: (entry: { handler: typeof handler }) => { handler = entry.handler; return () => {} } },
    workspaceRegistry: { get: (id: string) => id === workspaceId ? { id: workspaceId, path: root } : undefined },
    sessionPersistence: { stat: async () => ({ header: { cwd: root } }) },
  }
  const providers = ctx.plugin({ apply(provider) {
    for (const key of hostInject) if (key !== 'tools' && key !== 'systemPrompt') provider.provide(key, services[key as keyof typeof services] ?? {})
  } })
  await providers.await()
  const host = ctx.plugin({ inject: hostInject, apply(scoped) {
    applyHost(scoped, { dataRoot: root, installationId: 'synthetic-availability', notificationDestinations: { get: () => [] } })
  } })
  await host.await()
  const native = ctx.plugin({ inject: ['tools'], apply(scoped) {
    scoped.tools.register({
      name: 'synthetic_native_general', description: 'Synthetic native availability sentinel',
      parameters: { type: 'object', properties: {} },
      output: { schema: { type: 'object', properties: { available: { type: 'boolean' } }, required: ['available'] }, render: () => [] },
      execute: async () => ({ available: true }),
    })
  } })
  await native.await()
  const session = Session.create(sessionId, undefined, { version: 4, id: sessionId, createdAt: Date.now(), isSeeded: false, cwd: root,
    ...(scenario === 'general' ? {} : { origin: 'subagent', parentSession: parentSessionId }),
  })
  // The public Agent handle supplies the real Session and scoped registry; no loop or Provider is needed to dispatch creation.
  const agent = { id: sessionId, session, options: {}, ctx }
  const exec = { agent, callId: 'synthetic-availability-call', signal: new AbortController().signal }
  writeFileSync(join(root, 'synthetic-source.csv'), 'key,source,target\na,Start,开始\n')
  renameSync(path, `${path}.held`)
  try {
    await ctx.serial('agent/created', { agent, source: 'resume' } as never)
    const general = ctx.tools.get('synthetic_native_general')!
    const workingCopy = ctx.tools.get('linguist_working_copy')!
    const cat = ctx.tools.get('cat_project_summary')!
    assert.ok(general)
    assert.ok(workingCopy)
    assert.ok(cat)
    assert.deepEqual(await general.execute({}, exec as never), { available: true })
    const prepared = await workingCopy.execute({ operation: 'prepare', sourcePath: 'synthetic-source.csv', sourceLocale: 'en-US', targetLocale: 'zh-CN' }, exec as never) as { segments: number }
    assert.equal(prepared.segments, 1)
    await assert.rejects(cat.execute({}, exec as never), /STORE_NOT_FOUND|unhealthy/)
    assert.equal(existsSync(path), false, 'CAT invocation must not recreate a missing store')
    writeFileSync(path, 'synthetic broken sqlite')
    await assert.rejects(cat.execute({}, exec as never), /ERR_SQLITE_ERROR|unhealthy/)
    renameSync(`${path}.held`, path)
    assert.ok(await cat.execute({}, exec as never))
    if (scenario === 'general') {
      const inventory = ctx.tools.get('cat_refresh_project_inventory')!
      const intake = ctx.tools.get('cat_import_resources')!
      const before = await inventory.execute({}, exec as never) as { details: { discoveryScopeHash: string } }
      const refs = ['first', 'second', 'foreign'].map(version => {
        const bytes = Buffer.from(`Synthetic ${version} reference\n`)
        const digest = createHash('sha256').update(bytes).digest('hex')
        const directory = join(attachmentRoot, digest)
        mkdirSync(directory)
        const filename = join(directory, 'reference.txt')
        writeFileSync(filename, bytes)
        const attachment = { attachmentId: AttachmentId(`sha256:${digest}`), name: 'reference.txt', bytes: bytes.length }
        attachedPaths.set(attachment.attachmentId, filename)
        return { attachment, filename }
      })
      const foreign = Session.create(SessionId('session-foreign-attachments'))
      foreign.append('user/message', createUserMessage({ source: { kind: 'user' }, content: [{ type: 'file', attachment: refs[2]!.attachment }] }), { surfaceOp: 'append' })
      const imageId = AttachmentId(`sha256:${'c'.repeat(64)}`)
      session.append('user/message', createUserMessage({ source: { kind: 'user' }, content: [
        { type: 'file', attachment: refs[0]!.attachment },
        { type: 'image', attachment: { attachmentId: imageId, mediaType: 'image/png', bytes: 1, width: 1, height: 1 } },
      ] }), { surfaceOp: 'append' })
      const first = await inventory.execute({}, exec as never) as { details: { discoveryScopeHash: string; items: { filename: string; sourceSha256?: string }[] } }
      assert.notEqual(first.details.discoveryScopeHash, before.details.discoveryScopeHash, 'A native admitted file changes the discovery scope')
      assert.ok(first.details.items.some(item => item.filename === 'reference.txt' && item.sourceSha256 === refs[0]!.attachment.attachmentId.slice('sha256:'.length)))
      assert.equal(resolvedAttachments.includes(refs[2]!.attachment.attachmentId), false, 'Another Session does not authorize its files')
      assert.equal(resolvedAttachments.includes(imageId), false, 'Native image content is not reclassified as a file reference')
      const imported = await intake.execute({ paths: [refs[0]!.filename], kind: 'context', dryRun: true }, exec as never) as { details: { ready: number } }
      assert.equal(imported.details.ready, 1, 'The exact admitted reference is readable outside the Workspace')
      await assert.rejects(intake.execute({ paths: [attachmentRoot], kind: 'context', recursive: true, dryRun: true }, exec as never), /outside this DSH Workspace/)
      await assert.rejects(intake.execute({ paths: [refs[2]!.filename], kind: 'context', dryRun: true }, exec as never), /outside this DSH Workspace/)
      session.append('user/message', createUserMessage({ source: { kind: 'user' }, content: [{ type: 'file', attachment: refs[1]!.attachment }] }), { surfaceOp: 'append' })
      const second = await inventory.execute({}, exec as never) as { details: { discoveryScopeHash: string; items: { filename: string; sourceSha256?: string }[]; gaps: { code: string; summary: string }[] } }
      assert.notEqual(second.details.discoveryScopeHash, first.details.discoveryScopeHash, 'A different admitted version changes the frozen scope')
      assert.deepEqual(second.details.items.filter(item => item.filename === 'reference.txt').map(item => item.sourceSha256).sort(), refs.slice(0, 2).map(ref => ref.attachment.attachmentId.slice('sha256:'.length)).sort())
      assert.equal(second.details.gaps.filter(gap => gap.code === 'VERSION_CONFLICT' && gap.summary.startsWith('reference.txt ')).length, 1)
      const saved = await intake.execute({ paths: [refs[0]!.filename], kind: 'context' }, exec as never) as { details: { imported: number; items: { resourceId: string }[] } }
      assert.equal(saved.details.imported, 1)
      const db = service.openProject(project.id)
      const doc = db.contextDocs.get(saved.details.items[0]!.resourceId)!
      assert.equal(doc.sha256, refs[0]!.attachment.attachmentId.slice('sha256:'.length))
      assert.deepEqual(readFileSync(service.resolveContextDocPreviewPath(project.id, doc.id).sourcePath), readFileSync(refs[0]!.filename))
      assert.deepEqual(db.contextDocs.listAnchors(doc.id).map(anchor => anchor.text), ['Synthetic first reference'])
      db.contextDocs.setEvidenceLink({ contextDocId: doc.id, relation: { kind: 'segment', segmentId: segmentIds[0]! }, requiredness: 'required', mappingRevision: 'synthetic-attachment-1' })
      const response = await ctx.tools.get('cat_get_translation_context')!.execute({ segmentIds: [segmentIds[0]!], readOnly: true, tmLimit: 0, neighborCount: 0 }, exec as never) as { content: { type: string; text: string }[] }
      const rendered = JSON.parse(response.content.find(item => item.type === 'text')!.text) as { shared: { context: Record<string, { docId: string; text: string }> }; contexts: { contextRefs: { ref: string; requiredness: string }[] }[] }
      const required = rendered.contexts[0]!.contextRefs.find(item => rendered.shared.context[item.ref]!.docId === doc.id)!
      assert.equal(required.requiredness, 'required')
      assert.equal(rendered.shared.context[required.ref]!.text, doc.textExtract, 'Required Context carries the full content in actual tool rendering, not a path-only receipt')
      const stage = ensureStageEvidenceForSession({ session: { id: 'session-attachment-review', linguistRole: 'reviewer' }, db,
        discoveryScope: projectDiscoveryScope(service, project.id, workspaceId, root, [refs[0]!.filename, refs[1]!.filename]), fallbackSegmentIds: [segmentIds[0]!],
      })!
      assert.equal(stage.plan.requirements.find(item => item.evidence.ref.kind === 'context-doc' && item.evidence.ref.id === doc.id)?.requiredness, 'required')
      assert.notEqual(db.stageEvidence.getCompletion(stage.stageRunId).status, 'complete', 'Tool output alone does not fabricate a model-visible response receipt')
    }
    if (scenario !== 'general') {
      // These synthetic dispatch events exercise real Host provenance without a network or Provider response.
      await ctx.waterfall('llm/stream', {
        provider: 'synthetic-regression', model: 'synthetic-regression', sessionId,
        messages: [createSystemMessage(renderPrompt(await ctx.systemPrompt.assemble()))], tools: ctx.tools.schemas(),
      } as never, () => (async function* () {})())
      await ctx.serial('session/event', session, { type: 'tool/call', data: { turn: 1, step: 0, callId: exec.callId, name: 'cat_get_translation_context', arguments: '{}' } } as never)
      ensureStageEvidenceForSession({
        session: { id: parentSessionId, linguistRole: 'reviewer' }, db: service.openProject(project.id),
        discoveryScope: projectDiscoveryScope(service, project.id, workspaceId, root),
        fallbackSegmentIds: scenario === 'no-parent-scope' ? [segmentIds[0]!] : segmentIds, restart: true, toolCallId: 'parent-restart',
      })
      const context = ctx.tools.get('cat_get_translation_context')!
      if (scenario === 'no-parent-scope') {
        assert.ok(await context.execute({ segmentIds: [segmentIds[1]!], stageScope: 'segments' }, exec as never), 'A later Parent Stage must not retroactively restrict a child whose first successful CAT read had no Parent Stage')
      } else {
        await assert.rejects(context.execute({ segmentIds: [segmentIds[1]!], stageScope: 'segments' }, exec as never), /outside the parent Stage scope/)
        assert.ok(await context.execute({ segmentIds: [segmentIds[0]!], stageScope: 'segments' }, exec as never))
      }
      const firstStage = service.openProject(project.id).stageEvidence.list().find(item => item.sessionId === sessionId)!
      assert.ok(firstStage)
      service.closeAll()
      assert.ok(handler)
      const request = Readable.from([Buffer.from(JSON.stringify({ operation: 'linguistBackupsRestore', input: { projectId: project.id, backupName: backup.backupName } }))]) as Readable & { method: string; url: string; headers: Record<string, string> }
      request.method = 'POST'; request.url = '/la/v1/invoke'; request.headers = { host: '127.0.0.1:19387', 'content-type': 'application/json' }
      const response = { headersSent: false, statusCode: 0, body: '',
        writeHead(status: number) { this.statusCode = status; this.headersSent = true }, end(body: string) { this.body = body },
      }
      await handler(request, response)
      assert.equal(response.statusCode, 200)
      assert.equal((JSON.parse(response.body) as { ok: boolean }).ok, true)
      const ownSegment = scenario === 'no-parent-scope' ? segmentIds[1]! : segmentIds[0]!
      assert.ok(await context.execute({ segmentIds: [ownSegment], stageScope: 'segments' }, exec as never))
      const restoredStage = service.openProject(project.id).stageEvidence.list().find(item => item.sessionId === sessionId)!
      assert.notEqual(restoredStage.stageRunId, firstStage.stageRunId, 'The same registered tool must reload this Session Stage from restored bytes')
      assert.deepEqual(restoredStage.plan.segmentIds, [ownSegment])
      service.closeAll()
    }
    // Restore uses an atomic replacement; the same tool must stop using the prior cached handle.
    renameSync(path, `${path}.held`)
    writeFileSync(path, 'synthetic replacement is corrupt')
    await assert.rejects(cat.execute({}, exec as never), /ERR_SQLITE_ERROR|unhealthy/)
    renameSync(`${path}.held`, path)
    assert.ok(await cat.execute({}, exec as never))
    assert.deepEqual(readFileSync(path).subarray(0, 16), bytes.subarray(0, 16))
    assert.deepEqual(await general.execute({}, exec as never), { available: true })
    assert.equal(ctx.tools.get('linguist_working_copy'), workingCopy, 'Restoration must not require re-binding the Agent')
  } finally {
    await native.dispose(); await host.dispose(); await providers.dispose(); await toolsPlugin.dispose(); await promptPlugin.dispose()
    service.closeAll()
    rmSync(root, { recursive: true, force: true })
    rmSync(attachmentRoot, { recursive: true, force: true })
  }
})
