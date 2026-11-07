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
