import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { createAsset, deriveSegmentId, type Segment } from '@linguist/cat-core'
import { CatStore } from '@linguist/cat-store'
import { createLinguistCatTools } from './factory'
import type { CatApplyTranslationsResult, CatConfirmSegmentsResult, CatGetTranslationContextResult } from './types'

async function fixture(run: (f: Awaited<ReturnType<typeof setup>>) => Promise<void>) {
  const f = setup()
  try { await run(f) } finally { f.db.close(); rmSync(f.root, { recursive: true, force: true }) }
}
function setup() {
  const root = mkdtempSync(join(tmpdir(), 'linguist-work-snapshots-'))
  const store = new CatStore({ rootDir: root })
  const project = store.createProject({ name: 'Synthetic coherent review', sourceLocale: 'en', targetLocale: 'zh-CN' })
  const db = store.openProject(project.id)
  const asset = createAsset({ projectId: project.id, formatId: 'synthetic', originalFilename: 'work.txt', sourceSha256: 'a'.repeat(64), segmentCount: 3 })
  const segments: Segment[] = [0, 1, 2].map(ordinal => ({ id: deriveSegmentId(asset.id, ordinal), assetId: asset.id, ordinal,
    source: `Source ${ordinal}`, target: `译文 ${ordinal}`, sourceLocale: 'en', targetLocale: 'zh-CN', status: 'translated',
    locked: false, revision: 0, sourceHash: `source-${ordinal}` }))
  db.assets.insert(asset, segments)
  const tools = createLinguistCatTools({ resolveProject: () => ({ project, db }), sessionId: 'independent-reviewer', linguistRole: 'reviewer' })
  let call = 0
  const invoke = async (name: string, args: unknown, id = `call-${++call}`) => tools.find(tool => tool.name === name)!.execute(id, args as never)
  const read = async (ids: string[]) => {
    const result = await invoke('cat_get_translation_context', { segmentIds: ids, readOnly: true, includeNeighbors: false })
    const dto = result.details as CatGetTranslationContextResult
    assert.equal(dto.contexts.length, ids.length)
    assert.ok(dto.snapshotId)
    return dto.snapshotId
  }
  return { root, db, project, segments, invoke, read }
}

test('one submission saves edits and explicitly reviewed unchanged coverage across read pages', () => fixture(async f => {
  const ids = f.segments.map(segment => segment.id as string)
  const snapshots = [await f.read(ids.slice(0, 2)), await f.read(ids.slice(2))]
  const params = { snapshotIds: snapshots, edits: [{ segmentId: ids[0], target: '修订译文 0' }], reviewedSegmentIds: ids }
  const first = (await f.invoke('cat_apply_translations', params, 'submit-group')).details as CatApplyTranslationsResult
  assert.equal(first.applied, 1)
  assert.equal(first.review!.coverage.status, 'complete')
  assert.deepEqual(first.review!.decisions.map(item => [item.segmentId, item.decision, item.revision]), [
    [ids[0], 'corrected', 1], [ids[1], 'unchanged', 0], [ids[2], 'unchanged', 0],
  ])
  assert.ok(ids.every(id => f.db.segments.listStageEvents(id).at(-1)?.actor === 'independent-reviewer'))
  const eventCount = f.db.segments.listStageEvents(ids[0]!).length
  const repeated = (await f.invoke('cat_apply_translations', params, 'submit-group')).details as CatApplyTranslationsResult
  assert.deepEqual(repeated, first)
  const rebound = createLinguistCatTools({ resolveProject: () => ({ project: f.project, db: f.db }), sessionId: 'independent-reviewer', linguistRole: 'reviewer' })
  const persisted = await rebound.find(tool => tool.name === 'cat_apply_translations')!.execute('submit-group', params as never)
  assert.deepEqual(persisted.details, first)
  assert.equal(f.db.segments.getById(ids[0]!)!.revision, 1)
  assert.equal(f.db.segments.listStageEvents(ids[0]!).length, eventCount)
  f.db.runs.undoRun('run:independent-reviewer:submit-group', { actorId: 'independent-reviewer' })
  assert.equal(f.db.segments.getById(ids[0]!)!.target, '译文 0')
}))

test('stale reads never borrow new revisions and failed edits never become unchanged review', () => fixture(async f => {
  const ids = f.segments.map(segment => segment.id as string)
  const snapshot = await f.read(ids)
  f.db.segments.applyTargetEdit(ids[0]!, '人工新译文 0', 0)
  f.db.segments.setLocked(ids[1]!, true)
  const result = (await f.invoke('cat_apply_translations', {
    snapshotIds: [snapshot], edits: [{ segmentId: ids[0], target: '旧候选 0' }, { segmentId: ids[1], target: '旧候选 1' }], reviewedSegmentIds: ids,
  })).details as CatApplyTranslationsResult
  assert.deepEqual(result.stale, [ids[0]])
  assert.deepEqual(result.locked, [ids[1]])
  assert.deepEqual(result.review!.decisions.map(item => item.segmentId), [ids[2]])
  assert.equal(result.review!.skipped!.length, 2)
  assert.equal(f.db.segments.getById(ids[0]!)!.target, '人工新译文 0')
  const unchanged = (await f.invoke('cat_confirm_segments', { snapshotIds: [snapshot], segmentIds: [ids[0]] })).details as CatConfirmSegmentsResult
  assert.deepEqual(unchanged.skipped, [{ segmentId: ids[0], code: 'STALE_SNAPSHOT' }])
}))

test('a Source identity change without a revision change rejects old edits and proposals only for the affected item', () => fixture(async f => {
  const ids = f.segments.slice(0, 2).map(segment => segment.id as string)
  const snapshot = await f.read(ids)
  f.db.catDb.db.prepare('UPDATE segments SET source = ?, source_hash = ? WHERE id = ?').run('Changed source', 'changed-source', ids[0])
  await assert.rejects(f.invoke('cat_apply_translations', { snapshotIds: [snapshot], edits: [{ segmentId: ids[0], target: '旧源候选' }] }), /Source changed for/)
  await assert.rejects(f.invoke('cat_propose_translations', { snapshotIds: [snapshot], segmentProposals: [{ segmentId: ids[0], proposedTarget: '旧源提案' }] }), /Source changed for/)
  assert.equal(f.db.segments.getById(ids[0]!)!.target, '译文 0')
  assert.equal(f.db.proposals.list().length, 0)
  const unaffected = (await f.invoke('cat_confirm_segments', { snapshotIds: [snapshot], segmentIds: [ids[1]] })).details as CatConfirmSegmentsResult
  assert.deepEqual(unaffected.decisions, [{ segmentId: ids[1], decision: 'unchanged', revision: 0 }])
}))

test('edits alone do not claim review, while a later explicit group uses its actual committed receipt', () => fixture(async f => {
  const id = f.segments[0]!.id as string
  const snapshot = await f.read([id])
  const result = (await f.invoke('cat_apply_translations', { snapshotIds: [snapshot], edits: [{ segmentId: id, target: '独立修订 0' }] })).details as CatApplyTranslationsResult
  assert.equal(result.review, undefined)
  assert.equal(f.db.segments.listStageEvents(id).some(event => event.action === 'corrected'), false)
  const reviewed = (await f.invoke('cat_confirm_segments', { snapshotIds: [snapshot], segmentIds: [id] })).details as CatConfirmSegmentsResult
  assert.deepEqual(reviewed.decisions, [{ segmentId: id, decision: 'corrected', revision: 1 }])
}))

test('unknown, cross-session and conflicting snapshots require an actual content reread', () => fixture(async f => {
  const id = f.segments[0]!.id as string
  const old = await f.read([id])
  f.db.segments.applyTargetEdit(id, '当前新译文 0', 0)
  const current = await f.read([id])
  await assert.rejects(f.invoke('cat_apply_translations', { snapshotIds: [old, current], edits: [{ segmentId: id, target: '候选 0' }] }), /Multiple read versions/)
  await assert.rejects(f.invoke('cat_apply_translations', { snapshotIds: ['read:unknown'], edits: [{ segmentId: id, target: '候选 0' }] }), /snapshot is unavailable/)
  const other = createLinguistCatTools({ resolveProject: () => ({ project: f.project, db: f.db }), sessionId: 'another-reviewer', linguistRole: 'reviewer' })
  await assert.rejects(other.find(tool => tool.name === 'cat_apply_translations')!.execute('other', { snapshotIds: [current], edits: [{ segmentId: id, target: '候选 0' }] } as never), /snapshot is unavailable/)
  assert.equal(f.db.segments.getById(id)!.target, '当前新译文 0')
}))

test('proposal mode cannot confirm a professional review or mutate the Target', () => fixture(async f => {
  const id = f.segments[0]!.id as string
  const snapshot = await f.read([id])
  await assert.rejects(f.invoke('cat_apply_translations', { snapshotIds: [snapshot], edits: [{ segmentId: id, target: '候选 0' }], reviewedSegmentIds: [id], mode: 'proposal' }), /do not complete/)
  const result = (await f.invoke('cat_apply_translations', { snapshotIds: [snapshot], edits: [{ segmentId: id, target: '候选 0' }], mode: 'proposal' })).details as CatApplyTranslationsResult
  assert.equal(result.pending, 1)
  assert.equal(f.db.segments.getById(id)!.target, '译文 0')
  assert.equal(f.db.segments.listStageEvents(id).length, 0)
}))

test('a final fragment cannot issue a writable snapshot until the complete payload was delivered', () => fixture(async f => {
  const original = f.segments[0]!
  // The real context response needs multiple pages, even with secondary evidence omitted.
  f.db.catDb.db.prepare('UPDATE segments SET source = ? WHERE id = ?').run('Long source '.repeat(900), original.id)
  const args = { segmentIds: [original.id], readOnly: true, includeNeighbors: false, maxBytes: 2048 }
  const first = (await f.invoke('cat_get_translation_context', args)).details as CatGetTranslationContextResult
  assert.ok(first.contextFragment && first.nextCursor)
  assert.equal(first.snapshotId, undefined)
  const lastCursor = first.nextCursor.replace(/-\d+$/, `-${first.contextFragment.totalChars - 1}`)
  const last = (await f.invoke('cat_get_translation_context', { ...args, cursor: lastCursor })).details as CatGetTranslationContextResult
  assert.equal(last.snapshotId, undefined)
  let page = first
  for (let count = 0; page.nextCursor; count++) {
    assert.ok(count < 100)
    page = (await f.invoke('cat_get_translation_context', { ...args, cursor: page.nextCursor })).details as CatGetTranslationContextResult
    assert.ok(page.usedBytes <= page.maxBytes)
  }
  assert.ok(page.snapshotId)
  const result = (await f.invoke('cat_apply_translations', { snapshotIds: [page.snapshotId], edits: [{ segmentId: original.id, target: '最终完整译文' }] })).details as CatApplyTranslationsResult
  assert.equal(result.applied, 1)
}))

test('a later overlapping group reuses recorded corrections and still confirms its remaining rows', () => fixture(async f => {
  const ids = f.segments.slice(0, 2).map(segment => segment.id as string)
  const snapshot = await f.read(ids)
  await f.invoke('cat_apply_translations', { snapshotIds: [snapshot], edits: [{ segmentId: ids[0], target: '修订 0' }], reviewedSegmentIds: [ids[0]] })
  const count = f.db.segments.listStageEvents(ids[0]!).length
  const result = (await f.invoke('cat_confirm_segments', { snapshotIds: [snapshot], segmentIds: ids })).details as CatConfirmSegmentsResult
  assert.deepEqual(result.skipped, [{ segmentId: ids[0], code: 'ALREADY_RECORDED' }])
  assert.deepEqual(result.decisions, [{ segmentId: ids[1], decision: 'unchanged', revision: 0 }])
  assert.equal(result.coverage.status, 'complete')
  assert.equal(f.db.segments.listStageEvents(ids[0]!).length, count)
}))

test('new reviewed decisions write identifiable stage TM exactly once; blocked and repeated decisions do not count', () => fixture(async f => {
  const ids = f.segments.map(segment => segment.id as string)
  const snapshot = await f.read(ids)
  const params = { snapshotIds: [snapshot], segmentIds: ids }
  const first = (await f.invoke('cat_confirm_segments', params, 'first-confirm')).details as CatConfirmSegmentsResult
  assert.equal(first.decisions.length, 3)
  const candidates = f.db.tmUnits.listCandidates('en', 'zh-CN', undefined, 'ungrouped')
  assert.equal(candidates.length, 3)
  for (const segment of f.segments) {
    const item = candidates.find(candidate => candidate.source === segment.source)!
    assert.equal(item.target, segment.target)
    assert.equal(item.localMetadata?.la_confirmation_count, '1')
    assert.equal(item.localMetadata?.la_reuse_count, '0')
    const record = JSON.parse((item.localMetadata!.la_confirmations as string[])[0]!)
    assert.equal(record.segmentId, segment.id)
    assert.equal(record.projectId, f.project.id)
    assert.equal(record.actor, 'independent-reviewer')
    assert.equal(record.stage, 'editing')
    assert.ok(record.taskId)
  }
  const repeated = (await f.invoke('cat_confirm_segments', params, 'second-confirm')).details as CatConfirmSegmentsResult
  assert.equal(repeated.skipped?.filter(item => item.code === 'ALREADY_RECORDED').length, 3)
  assert.deepEqual(f.db.tmUnits.listCandidates('en', 'zh-CN', undefined, 'ungrouped'), candidates)
  const blocked = (await f.invoke('cat_confirm_segments', { ...params, blockedSegmentIds: ids }, 'blocked-confirm')).details as CatConfirmSegmentsResult
  assert.equal(blocked.decisions.filter(item => item.decision === 'blocked').length, 3)
  assert.deepEqual(f.db.tmUnits.listCandidates('en', 'zh-CN', undefined, 'ungrouped'), candidates)
}))

test('confirmed TM reuses imported source/target, preserves its metadata and retains a distinct translation', () => fixture(async f => {
  const original = f.segments[0]!
  const imported = { source: original.source, target: original.target, sourceLocale: 'en', targetLocale: 'zh-CN',
    sourceId: 'synthetic-import', occurrenceKey: 'row-1', metadata: { author: 'synthetic-history' } }
  f.db.tmUnits.importMany([imported])
  const snapshot = await f.read([original.id])
  await f.invoke('cat_confirm_segments', { snapshotIds: [snapshot], segmentIds: [original.id] })
  const same = f.db.tmUnits.listCandidates('en', 'zh-CN', undefined, 'ungrouped')
  assert.equal(same.length, 1)
  assert.equal(same[0]!.metadata?.author, 'synthetic-history')
  assert.equal(same[0]!.localMetadata?.la_confirmation_count, '1')
  assert.deepEqual(f.db.tmUnits.importMany([imported]), { imported: 0, unchanged: 1 })
  f.db.segments.applyTargetEdit(original.id, '另一种译法', 0)
  const next = await f.read([original.id])
  await f.invoke('cat_confirm_segments', { snapshotIds: [next], segmentIds: [original.id] })
  assert.deepEqual(new Set(f.db.tmUnits.listCandidates('en', 'zh-CN', undefined, 'ungrouped').map(item => item.target)), new Set([original.target, '另一种译法']))
}))

test('confirming text already present in a paused library makes the local confirmation searchable without enabling the library', () => fixture(async f => {
  const segment = f.segments[0]!
  f.db.tmUnits.importMany([{ source: segment.source, target: segment.target, sourceLocale: 'en', targetLocale: 'zh-CN', sourceId: 'paused-source', occurrenceKey: 'one' }])
  f.db.tmSources.update('paused-source', { enabled: false })
  assert.equal(f.db.tmUnits.listCandidates('en', 'zh-CN', undefined, 'ungrouped').length, 0)
  const snapshot = await f.read([segment.id])
  await f.invoke('cat_confirm_segments', { snapshotIds: [snapshot], segmentIds: [segment.id] })
  assert.equal(f.db.tmSources.get('paused-source')!.enabled, false)
  const candidates = f.db.tmUnits.listCandidates('en', 'zh-CN', undefined, 'ungrouped')
  assert.equal(candidates.length, 1)
  assert.equal(candidates[0]!.localMetadata?.la_confirmation_count, '1')
  assert.match(candidates[0]!.sourceLabel!, /confirmed/i)
}))

test('a TM write failure rolls back the reviewed decision', () => fixture(async f => {
  const id = f.segments[0]!.id as string
  const snapshot = await f.read([id])
  f.db.catDb.db.exec(`CREATE TRIGGER synthetic_tm_failure BEFORE INSERT ON tm_units BEGIN SELECT RAISE(ABORT, 'synthetic TM failure'); END`)
  await assert.rejects(f.invoke('cat_confirm_segments', { snapshotIds: [snapshot], segmentIds: [id] }), /synthetic TM failure/)
  assert.equal(f.db.segments.listStageEvents(id).length, 0)
  assert.equal(f.db.tmUnits.listCandidates('en', 'zh-CN', undefined, 'ungrouped').length, 0)
}))

test('explicit TM reuse counts successful application separately from confirmation and replay', () => fixture(async f => {
  const segment = f.segments[0]!
  f.db.tmUnits.importMany([{ source: segment.source, target: '复用译文', sourceLocale: 'en', targetLocale: 'zh-CN', sourceId: 'synthetic-tm', occurrenceKey: 'unit' }])
  const unit = f.db.tmUnits.listCandidates('en', 'zh-CN', undefined, 'ungrouped')[0]!
  const snapshot = await f.read([segment.id])
  const params = { snapshotIds: [snapshot], edits: [{ segmentId: segment.id, target: unit.target, tmUnitId: unit.unitId }] }
  const first = (await f.invoke('cat_apply_translations', params, 'tm-reuse')).details as CatApplyTranslationsResult
  assert.equal(first.applied, 1)
  await f.invoke('cat_apply_translations', params, 'tm-reuse')
  const reused = f.db.tmUnits.listCandidates('en', 'zh-CN', undefined, 'ungrouped')[0]!
  assert.equal(reused.localMetadata?.la_reuse_count, '1')
  assert.equal(reused.localMetadata?.la_confirmation_count, undefined)
  const stale = (await f.invoke('cat_apply_translations', params, 'tm-reuse-stale')).details as CatApplyTranslationsResult
  assert.deepEqual(stale.stale, [segment.id])
  assert.equal(f.db.tmUnits.listCandidates('en', 'zh-CN', undefined, 'ungrouped')[0]!.localMetadata?.la_reuse_count, '1')
}))

test('automatic context offers a low-scoring but mechanically adaptable variable without changing its score', () => fixture(async f => {
  const segment = f.segments[0]!
  f.db.catDb.db.prepare('UPDATE segments SET source = ? WHERE id = ?').run('Hello {hero}', segment.id)
  f.db.tmUnits.importMany([{ source: 'Hello {player}', target: '你好 {player}', sourceLocale: 'en', targetLocale: 'zh-CN', sourceId: 'synthetic', occurrenceKey: 'variable' }])
  const result = (await f.invoke('cat_get_translation_context', { segmentIds: [segment.id], readOnly: true, includeNeighbors: false })).details as CatGetTranslationContextResult
  const match = result.contexts[0]!.tm[0]!
  assert.equal(match.adaptation?.candidate, '你好 {hero}')
  assert.ok(match.score < 85)
  assert.equal(match.target, '你好 {player}')
}))
