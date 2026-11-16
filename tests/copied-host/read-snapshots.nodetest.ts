import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { CatStore } from '../../packages/linguist-cat-store/src/index.ts'
import { createLinguistCatTools } from '../../packages/linguist-cat-tools/src/index.ts'
import { createCatToolRuntime } from '../../packages/linguist-cat-tools/src/tool-runtime.ts'
import { SessionReadSnapshots } from '../../packages/dsh-linguist/src/host/read-snapshots.ts'
import { adaptCatTool } from '../../packages/dsh-linguist/src/host/tool-adapter.ts'
import { Context } from '../../packages/dsh-linguist/node_modules/@deepseek-ai/cordis/lib/index.js'
import { Session, SessionId, SessionLogOffset, SessionStore } from '../../packages/dsh-linguist/node_modules/@deepseek-ai/dsh-session/lib/index.js'
import { SessionQueryEngine } from '../../packages/dsh-linguist/node_modules/@deepseek-ai/dsh-session-query/lib/index.js'
import { SystemPrompt } from '../../packages/dsh-linguist/node_modules/@deepseek-ai/dsh-system-prompt/lib/index.js'
import { ToolRuntime } from '../../packages/dsh-linguist/node_modules/@deepseek-ai/dsh-tools/lib/index.js'
import * as NativeToolExecutor from '../../packages/dsh-linguist/node_modules/@deepseek-ai/dsh-tool-executor-native/lib/index.js'
import { createToolResultMessage, ToolCallId } from '../../packages/dsh-linguist/node_modules/@deepseek-ai/dsh-llm/lib/index.js'

class ReadOnlyQuery extends SessionQueryEngine {
  async searchSessions(): Promise<never> { throw new Error('Snapshot restoration must not search sessions') }
  async searchEvents(): Promise<never> { throw new Error('Snapshot restoration must use the exact Session') }
}

async function fixture(run: (f: Awaited<ReturnType<typeof setup>>) => Promise<void>) {
  const f = await setup()
  try { await run(f) } finally { await f.close() }
}
async function setup() {
  const root = mkdtempSync(join(tmpdir(), 'la-native-read-snapshots-'))
  const store = new CatStore({ rootDir: root })
  const project = store.createProject({ name: 'Synthetic snapshot restore', sourceLocale: 'en', targetLocale: 'zh-CN' })
  const db = store.openProject(project.id)
  const imported = db.assets.insertImported({ asset: { formatId: 'fixture', originalFilename: 'source.txt', sourceSha256: 'a'.repeat(64), segmentCount: 3 },
    segments: [0, 1, 2].map(ordinal => ({ ordinal, source: `Source ${ordinal}`, target: `译文 ${ordinal}`, sourceLocale: 'en', targetLocale: 'zh-CN', status: 'translated' as const,
      locked: false, revision: 0, sourceHash: `source-${ordinal}` })), warnings: [], originalBytes: new Uint8Array([1]),
  })
  const ids = imported.segments.map(segment => segment.id as string)
  const ctx = new Context()
  const plugins = [ctx.plugin(SystemPrompt, {}), ctx.plugin(SessionStore)]
  for (const plugin of plugins) await plugin.await()
  plugins.push(ctx.plugin(ReadOnlyQuery, {}), ctx.plugin(ToolRuntime, {}))
  for (const plugin of plugins.slice(2)) await plugin.await()
  plugins.push(ctx.plugin(NativeToolExecutor))
  await plugins.at(-1)!.await()
  let session: Session
  let detach: () => void = () => {}
  const mount = (next: Session) => {
    detach()
    session = next
    detach = ctx.sessions.enter(session)
    ctx.sessions.announce(session)
  }
  const emptySession = (id: string) => Session.create(SessionId(id), undefined, { version: 4, id: SessionId(id), createdAt: Date.now(), cwd: root, isSeeded: false })
  mount(emptySession('snapshot-reviewer'))
  let disposers: Array<() => void> = []
  let snapshots: SessionReadSnapshots
  let calls = 0
  const bind = (projectId = project.id, sessionId = session.id) => {
    for (const dispose of disposers) dispose()
    if (sessionId !== session.id) mount(emptySession(sessionId))
    snapshots = new SessionReadSnapshots(ctx.sessionQuery, sessionId, projectId)
    const tools = createLinguistCatTools({ resolveProject: () => ({ project: { ...project, id: projectId }, db }), resultProjectId: projectId,
      sessionId, linguistRole: 'reviewer', readSnapshots: snapshots })
    disposers = tools.map(source => ctx.tools.register(adaptCatTool(source, {} as never, undefined, undefined, undefined, snapshots, () => ids)))
  }
  bind()
  const invoke = async (name: string, args: unknown, options: { ptc?: boolean } = {}) => {
    const callId = ToolCallId(`synthetic-${++calls}`)
    const batch = await ctx.tools.execute({ agent: { id: session.id, session, ctx, options: {} } as never,
      signal: new AbortController().signal, calls: [{ type: 'tool-call', id: callId, name, arguments: JSON.stringify(args) }] })
    const result = batch.results[0]!.result
    if (options.ptc) {
      session.append('tool/ptc-dispatch' as never, { rootCallId: 'synthetic-root', parentCallId: 'synthetic-root', subCallId: callId,
        name, arguments: JSON.stringify(args), content: result.content, isError: result.isError, ...(result.meta == null ? {} : { meta: result.meta }) } as never)
    } else {
      session.append('tool/result', { turn: 0, step: 0, message: createToolResultMessage({ callId, content: result.content, isError: result.isError }),
        ...(result.meta == null ? {} : { meta: result.meta }) }, { surfaceOp: 'append' })
    }
    if (result.isError) throw new Error(result.content.filter(block => block.type === 'text').map(block => block.text).join(''))
    assert.ok(!result.content.some(block => block.type === 'text' && block.text.includes('linguist-read-snapshots')), 'private recovery state must not enter model content')
    return (result.value as { details: Record<string, any> }).details
  }
  const read = (segmentIds = ids, extra: object = {}) => invoke('cat_get_translation_context', { segmentIds, readOnly: true, includeNeighbors: false, ...extra })
  const restoreNativeSession = async (forkId?: string) => {
    using observation = await ctx.sessionQuery.observeSession(session.id, { projectionMode: 'none' })
    const stored = JSON.parse(JSON.stringify({ header: observation.header, events: observation.events, inheritedEventCount: observation.inheritedEventCount }))
    const id = SessionId(forkId ?? session.id)
    mount(Session.create(id, stored.events, { ...stored.header, id, ...(forkId ? { isSeeded: true } : {}) },
      SessionLogOffset(forkId ? stored.events.length : stored.inheritedEventCount)))
    bind()
  }
  return { db, ids, project, ctx, read, invoke, bind, restoreNativeSession, get session() { return session }, get snapshots() { return snapshots },
    async close() { for (const dispose of disposers) dispose(); detach(); for (const plugin of [...plugins].reverse()) await plugin.dispose(); db.close(); rmSync(root, { recursive: true, force: true }) } }
}

test('native Session metadata restores complete snapshots and applied revisions after replacing every tool instance', () => fixture(async f => {
  const read = await f.read()
  assert.ok(read.snapshotId)
  f.bind()
  await f.invoke('cat_apply_translations', { snapshotIds: [read.snapshotId], edits: [{ segmentId: f.ids[0], target: '热更新前修订' }] })
  await f.restoreNativeSession()
  const confirmed = await f.invoke('cat_confirm_segments', { snapshotIds: [read.snapshotId], segmentIds: f.ids })
  assert.deepEqual(confirmed.decisions, [
    { segmentId: f.ids[0], decision: 'corrected', revision: 1 },
    { segmentId: f.ids[1], decision: 'unchanged', revision: 0 },
    { segmentId: f.ids[2], decision: 'unchanged', revision: 0 },
  ])
}))

test('a reviewer can explicitly finish its full scope without copying read IDs or unchanged segment IDs', () => fixture(async f => {
  await assert.rejects(f.invoke('cat_apply_translations', { edits: [], reviewedAll: true }), /No previously supplied complete read/)
  await f.read()
  assert.equal(f.db.segments.listStageEvents(f.ids[0]!).length, 0, 'receiving materials does not confirm review')
  await f.restoreNativeSession()
  const result = await f.invoke('cat_apply_translations', { edits: [{ segmentId: f.ids[0], target: '审校后' }], reviewedAll: true })
  assert.equal(result.applied, 1)
  assert.deepEqual(result.review.decisions.map((item: { decision: string }) => item.decision), ['corrected', 'unchanged', 'unchanged'])
}))

test('automatic read selection refuses conflicting versions instead of guessing', () => fixture(async f => {
  await f.read([f.ids[0]!])
  f.db.segments.applyTargetEdit(f.ids[0]!, '其他人的新译文', 0)
  await f.read([f.ids[0]!])
  await assert.rejects(f.invoke('cat_apply_translations', { edits: [{ segmentId: f.ids[0], target: '不应覆盖' }] }), /Multiple read versions/)
  assert.equal(f.db.segments.getById(f.ids[0]!)!.target, '其他人的新译文')
}))

test('a native surface replacement replaying the original read metadata cannot downgrade a committed revision', () => fixture(async f => {
  const read = await f.read([f.ids[0]!])
  await f.invoke('cat_apply_translations', { snapshotIds: [read.snapshotId], edits: [{ segmentId: f.ids[0], target: '保存后的修订' }] })
  using observation = await f.ctx.sessionQuery.observeSession(f.session.id, { projectionMode: 'none' })
  const original = observation.events.find(event => event.type === 'tool/result' && JSON.stringify(event.data.meta).includes(read.snapshotId))!
  assert.equal(original.type, 'tool/result')
  if (original.type !== 'tool/result') throw new Error('Missing original native read event')
  f.session.append('tool/result', original.data, { surfaceOp: { op: 'replace', startSeq: original.seq, endSeq: original.seq }, sourceEventSeqs: [original.seq] })
  await f.restoreNativeSession()
  const confirmed = await f.invoke('cat_confirm_segments', { snapshotIds: [read.snapshotId], segmentIds: [f.ids[0]] })
  assert.deepEqual(confirmed.decisions, [{ segmentId: f.ids[0], decision: 'corrected', revision: 1 }])
  f.db.segments.applyTargetEdit(f.ids[0]!, '外部更新', 1)
  await f.restoreNativeSession()
  const stale = await f.invoke('cat_confirm_segments', { snapshotIds: [read.snapshotId], segmentIds: [f.ids[0]] })
  assert.deepEqual(stale.skipped, [{ segmentId: f.ids[0], code: 'STALE_SNAPSHOT' }], 'replay must not borrow an external revision')
  f.db.catDb.db.prepare('UPDATE segments SET source = ?, source_hash = ? WHERE id = ?').run('New source identity', 'external-source', f.ids[0])
  await f.restoreNativeSession()
  await assert.rejects(f.invoke('cat_apply_translations', { snapshotIds: [read.snapshotId], edits: [{ segmentId: f.ids[0], target: '不可写' }] }), /Source changed/)
  assert.equal(f.db.segments.getById(f.ids[0]!)!.target, '外部更新')
}))

test('a failed native call rolls back snapshot changes and cannot publish invented applied revisions', () => fixture(async f => {
  const read = await f.read([f.ids[0]!])
  await f.invoke('cat_apply_translations', { snapshotIds: [read.snapshotId], edits: [{ segmentId: f.ids[0], target: '已提交修订' }] })
  const before = structuredClone(f.snapshots.get(read.snapshotId))
  const dispose = f.ctx.tools.register(adaptCatTool({
    name: 'synthetic_snapshot_failure', label: 'Synthetic failure', description: 'Fails after preparing state', parameters: { type: 'object', properties: {} } as never,
    async execute() {
      assert.equal(before?.kind, 'snapshot')
      if (before?.kind !== 'snapshot') throw new Error('Missing synthetic complete read')
      f.snapshots.set(read.snapshotId, { kind: 'snapshot', versions: before.versions.map(version => ({ ...version, appliedRevision: 99 })) })
      throw new Error('Synthetic failure after state preparation')
    },
  }, {} as never, undefined, undefined, undefined, f.snapshots))
  try {
    await assert.rejects(f.invoke('synthetic_snapshot_failure', {}), /Synthetic failure after state preparation/)
    assert.deepEqual(f.snapshots.get(read.snapshotId), before)
    await f.restoreNativeSession()
    const confirmed = await f.invoke('cat_confirm_segments', { snapshotIds: [read.snapshotId], segmentIds: [f.ids[0]] })
    assert.deepEqual(confirmed.decisions, [{ segmentId: f.ids[0], decision: 'corrected', revision: 1 }])
  } finally { dispose() }
}))

for (const failureFirst of [false, true]) test(`concurrent native batches isolate failed read state (${failureFirst ? 'failure' : 'success'} settles first)`, () => fixture(async f => {
  let openA!: () => void, openB!: () => void, enteredA!: () => void, enteredB!: () => void
  const gateA = new Promise<void>(resolve => { openA = resolve }), gateB = new Promise<void>(resolve => { openB = resolve })
  const startedA = new Promise<void>(resolve => { enteredA = resolve }), startedB = new Promise<void>(resolve => { enteredB = resolve })
  const register = (id: string, gate: Promise<void>, entered: () => void, fail: boolean) => f.ctx.tools.register(adaptCatTool({
    name: id, label: id, description: 'Synthetic CAT read with async boundary', parameters: { type: 'object', properties: {} } as never,
    async execute() {
      f.snapshots.set(`read:${id}`, { kind: 'snapshot', versions: [{ segmentId: f.ids[0]!, revision: 0, sourceHash: 'source-0' }] })
      entered()
      await gate
      if (fail) throw new Error('Synthetic failed concurrent read')
      return { content: [{ type: 'text' as const, text: '{}' }], details: {} }
    },
  }, {} as never, undefined, undefined, undefined, f.snapshots))
  const disposeA = register('synthetic_A', gateA, enteredA, false), disposeB = register('synthetic_B', gateB, enteredB, true)
  try {
    const a = f.invoke('synthetic_A', {})
    await startedA
    const b = f.invoke('synthetic_B', {})
    await startedB
    if (failureFirst) {
      openB()
      await assert.rejects(b, /Synthetic failed concurrent read/)
      openA()
      await a
    } else {
      openA()
      await a
      openB()
      await assert.rejects(b, /Synthetic failed concurrent read/)
    }
    await f.restoreNativeSession()
    await f.snapshots.restore()
    assert.ok(f.snapshots.get('read:synthetic_A'))
    assert.equal(f.snapshots.get('read:synthetic_B'), undefined, 'a failed read must not enter the successful sibling\'s native metadata')
  } finally { openA(); openB(); disposeA(); disposeB() }
}))

test('parallel saves to different rows of one snapshot retain both committed revisions after native replay', () => fixture(async f => {
  const read = await f.read()
  const results = await Promise.all(f.ids.slice(0, 2).map((segmentId, index) => f.invoke('cat_apply_translations', {
    snapshotIds: [read.snapshotId], edits: [{ segmentId, target: `并行修订 ${index}` }],
  })))
  assert.ok(results.every(result => result.applied === 1))
  await f.restoreNativeSession()
  const confirmed = await f.invoke('cat_confirm_segments', { snapshotIds: [read.snapshotId], segmentIds: f.ids })
  assert.deepEqual(confirmed.decisions, [
    { segmentId: f.ids[0], decision: 'corrected', revision: 1 },
    { segmentId: f.ids[1], decision: 'corrected', revision: 1 },
    { segmentId: f.ids[2], decision: 'unchanged', revision: 0 },
  ])
}))

test('a failed concurrent fragment cannot fill a gap or authorize a complete read', () => fixture(async f => {
  let release!: () => void, entered!: () => void
  const gate = new Promise<void>(resolve => { release = resolve }), started = new Promise<void>(resolve => { entered = resolve })
  const disposers: Array<() => void> = []
  const register = (name: string, start: number, end: number, fail = false) => {
    const runtime = createCatToolRuntime({ resolveProject: () => ({ project: f.project, db: f.db }), readSnapshots: f.snapshots })
    disposers.push(f.ctx.tools.register(adaptCatTool({
      name, label: name, description: 'Synthetic partial context read', parameters: { type: 'object', properties: {} } as never,
      async execute() {
        const id = runtime.newSnapshotId()
        const complete = runtime.captureRead(id, [f.db.segments.getById(f.ids[0]!)!], { hash: 'synthetic-payload', start, end, total: 90 })
        if (fail) { entered(); await gate; throw new Error('Synthetic missing middle fragment') }
        return { content: [{ type: 'text' as const, text: '{}' }], details: { complete, ...(complete ? { snapshotId: id } : {}) } }
      },
    }, {} as never, undefined, undefined, undefined, f.snapshots)))
  }
  try {
    register('synthetic_middle', 30, 60, true)
    const failed = f.invoke('synthetic_middle', {})
    await started
    register('synthetic_first', 0, 30)
    assert.equal((await f.invoke('synthetic_first', {})).complete, false)
    release()
    await assert.rejects(failed, /Synthetic missing middle fragment/)
    await f.restoreNativeSession()
    register('synthetic_last', 60, 90)
    assert.equal((await f.invoke('synthetic_last', {})).complete, false)
    await f.restoreNativeSession()
    register('synthetic_recovered_middle', 30, 60)
    assert.equal((await f.invoke('synthetic_recovered_middle', {})).complete, true)
  } finally { release(); for (const dispose of disposers) dispose() }
}))

test('restored snapshots retain revision, Source and lock conflicts without invalidating unrelated rows', () => fixture(async f => {
  const read = await f.read()
  f.db.segments.applyTargetEdit(f.ids[0]!, '人工修订', 0)
  f.db.segments.setLocked(f.ids[1]!, true)
  f.bind()
  const edit = await f.invoke('cat_apply_translations', { snapshotIds: [read.snapshotId], edits: [
    { segmentId: f.ids[0], target: '旧稿' }, { segmentId: f.ids[1], target: '锁定稿' },
  ], reviewedSegmentIds: f.ids })
  assert.deepEqual(edit.stale, [f.ids[0]])
  assert.deepEqual(edit.locked, [f.ids[1]])
  assert.deepEqual(edit.review.decisions.map((item: { segmentId: string }) => item.segmentId), [f.ids[2]])
  const current = await f.read()
  f.db.catDb.db.prepare('UPDATE segments SET source = ?, source_hash = ? WHERE id = ?').run('Changed source', 'changed-source', f.ids[0])
  f.bind()
  await assert.rejects(f.invoke('cat_apply_translations', { snapshotIds: [current.snapshotId], edits: [{ segmentId: f.ids[0], target: '不可写' }] }), /Source changed/)
  assert.equal(f.db.segments.getById(f.ids[0]!)!.target, '人工修订')
  const unaffected = await f.invoke('cat_confirm_segments', { snapshotIds: [current.snapshotId], segmentIds: [f.ids[2]] })
  assert.deepEqual(unaffected.skipped, [{ segmentId: f.ids[2], code: 'ALREADY_RECORDED' }])
}))

test('native state cannot cross a Session or Project even when the database and segment IDs are identical', () => fixture(async f => {
  const read = await f.read()
  await assert.rejects(f.invoke('cat_confirm_segments', { snapshotIds: ['read:invented'], segmentIds: [f.ids[0]],
    readSnapshots: { kind: 'linguist-read-snapshots', sessionId: f.session.id, projectId: f.project.id,
      entries: [{ id: 'read:invented', state: f.snapshots.get(read.snapshotId) }] },
  }), /snapshot is unavailable/)
  f.bind('different-project' as typeof f.project.id)
  await assert.rejects(f.invoke('cat_confirm_segments', { snapshotIds: [read.snapshotId], segmentIds: [f.ids[0]] }), /snapshot is unavailable/)
  f.bind(f.project.id, SessionId('another-reviewer'))
  await assert.rejects(f.invoke('cat_confirm_segments', { snapshotIds: [read.snapshotId], segmentIds: [f.ids[0]] }), /snapshot is unavailable/)
}))

test('fork-inherited native results do not authorize snapshots in the new child Session', () => fixture(async f => {
  const read = await f.read()
  await f.restoreNativeSession('forked-reviewer')
  await assert.rejects(f.invoke('cat_confirm_segments', { snapshotIds: [read.snapshotId], segmentIds: [f.ids[0]] }), /snapshot is unavailable/)
}))

test('PTC private result metadata restores the same complete read without trusting model arguments', () => fixture(async f => {
  const read = await f.invoke('cat_get_translation_context', { segmentIds: [f.ids[0]], readOnly: true, includeNeighbors: false }, { ptc: true })
  f.bind()
  const confirmed = await f.invoke('cat_confirm_segments', { snapshotIds: [read.snapshotId], segmentIds: [f.ids[0]] })
  assert.equal(confirmed.decisions[0].decision, 'unchanged')
}))

test('HMR preserves partial fragment ranges but a final fragment alone never mints a complete read', () => fixture(async f => {
  f.db.catDb.db.prepare('UPDATE segments SET source = ? WHERE id = ?').run('Long synthetic Source '.repeat(600), f.ids[0])
  const args = { maxBytes: 2048, tmLimitPerSegment: 0, termLimitPerSegment: 0 }
  let page = await f.read([f.ids[0]!], args)
  assert.ok(page.contextFragment && page.nextCursor)
  assert.equal(page.snapshotId, undefined)
  const lastCursor = page.nextCursor.replace(/-\d+$/, `-${page.contextFragment.totalChars - 1}`)
  f.bind()
  const last = await f.read([f.ids[0]!], { ...args, cursor: lastCursor })
  assert.equal(last.snapshotId, undefined)
  for (let count = 0; page.nextCursor; count++) {
    assert.ok(count < 100)
    f.bind()
    page = await f.read([f.ids[0]!], { ...args, cursor: page.nextCursor })
  }
  assert.ok(page.snapshotId, 'only the combined complete ranges issue a writable snapshot')
  f.bind()
  const confirmed = await f.invoke('cat_confirm_segments', { snapshotIds: [page.snapshotId], segmentIds: [f.ids[0]] })
  assert.equal(confirmed.decisions[0].decision, 'unchanged')
}))
