import { test, type TestContext } from 'node:test'
import assert from 'node:assert/strict'
import { rmSync } from 'node:fs'
import { CatStore } from './store'
import { makeClock, makeEntropy, makeImportedAsset, makeTempDir } from './testkit'

function fixture(t: TestContext) {
  const rootDir = makeTempDir()
  const store = new CatStore({ rootDir, now: makeClock(), entropy: makeEntropy('synthetic-tm-cache') })
  const project = store.createProject({ name: 'Synthetic TM cache', sourceLocale: 'en', targetLocale: 'zh-CN' })
  const db = store.openProject(project.id)
  t.after(() => { db.close(); rmSync(rootDir, { recursive: true, force: true }) })
  const input = {
    source: 'Synthetic reward', target: '合成奖励', sourceLocale: 'en', targetLocale: 'zh-CN',
    sourceId: 'synthetic-source', occurrenceKey: 'first', originalTuid: 'synthetic-tu',
    metadata: { creationdate: '20200101T000000Z', creationid: 'synthetic-author' },
  }
  db.tmUnits.importMany([input])
  return { store, project, db, input }
}

test('TM candidates reuse locale/exact lists across Target writes and unchanged imports', (t) => {
  const { db, input } = fixture(t)
  const all = db.tmUnits.listCandidates('en', 'zh-CN')
  const exact = db.tmUnits.listCandidates('en', 'zh-CN', input.source)
  const empty = db.tmUnits.listCandidates('en', 'fr')
  assert.strictEqual(db.tmUnits.listCandidates('en', 'zh-CN'), all)
  assert.strictEqual(db.tmUnits.listCandidates('en', 'zh-CN', input.source), exact)
  assert.strictEqual(db.tmUnits.listCandidates('en', 'fr'), empty)
  assert.notStrictEqual(all, exact)
  const { segments } = db.assets.insertImported(makeImportedAsset())
  db.segments.applyTargetEdit(segments[0]!.id, 'Synthetic edited target', 0)
  db.tmUnits.importMany([input])
  db.tmSources.update(input.sourceId, { enabled: true, priority: 0 })
  assert.strictEqual(db.tmUnits.listCandidates('en', 'zh-CN'), all)
  assert.deepEqual(all[0]!.metadata, input.metadata)
})

test('repairing only a missing TM source refreshes cached provenance for unchanged units', (t) => {
  const { db, input } = fixture(t)
  db.catDb.db.prepare('DELETE FROM tm_sources WHERE id = ?').run(input.sourceId)
  const missing = db.tmUnits.listCandidates('en', 'zh-CN')
  const missingExact = db.tmUnits.listCandidates('en', 'zh-CN', input.source)
  assert.equal(missing[0]!.sourceLabel, undefined)
  assert.deepEqual(db.tmUnits.importMany([input]), { imported: 0, unchanged: 1 })
  const repaired = db.tmUnits.listCandidates('en', 'zh-CN')
  assert.notStrictEqual(repaired, missing)
  assert.notStrictEqual(db.tmUnits.listCandidates('en', 'zh-CN', input.source), missingExact)
  assert.equal(repaired[0]!.sourceLabel, 'Legacy TM')
  assert.equal(repaired[0]!.sourcePriority, 0)
  assert.deepEqual(repaired[0]!.metadata, input.metadata)
})

test('TM mutations and source settings refresh the shared candidate lists', (t) => {
  const { db, input } = fixture(t)
  const first = db.tmUnits.listCandidates('en', 'zh-CN')
  db.tmUnits.importMany([{ ...input, source: 'Another synthetic reward', occurrenceKey: 'second' }])
  const imported = db.tmUnits.listCandidates('en', 'zh-CN')
  assert.notStrictEqual(imported, first)
  assert.equal(imported.length, 2)
  db.tmSources.update(input.sourceId, { enabled: false })
  assert.equal(db.tmUnits.listCandidates('en', 'zh-CN').length, 0)
  db.tmSources.update(input.sourceId, { enabled: true, priority: 7 })
  const enabled = db.tmUnits.listCandidates('en', 'zh-CN')
  assert.equal(enabled[0]!.sourcePriority, 7)
  db.tmUnits.delete(enabled[0]!.unitId)
  assert.equal(db.tmUnits.listCandidates('en', 'zh-CN').length, 1)
  db.tmUnits.addApprovedExemplar({ source: 'Synthetic approved source', target: 'Synthetic approved target',
    sourceLocale: 'en', targetLocale: 'zh-CN', speaker: 'Synthetic speaker', textType: 'ui',
    assetId: 'synthetic-asset', segmentId: 'synthetic-segment' })
  assert.equal(db.tmUnits.listCandidates('en', 'zh-CN').length, 2)
  db.tmUnits.addApprovedExemplar({ source: 'Synthetic approved source', target: 'Synthetic revised exemplar',
    sourceLocale: 'en', targetLocale: 'zh-CN', speaker: 'Synthetic speaker', textType: 'ui',
    assetId: 'synthetic-asset', segmentId: 'synthetic-segment' })
  assert.ok(db.tmUnits.listCandidates('en', 'zh-CN').some(item => item.target === 'Synthetic revised exemplar'))
  const beforeSource = db.tmUnits.listCandidates('en', 'zh-CN')
  const reference = db.referenceImports.insert({ kind: 'tm', originalFilename: 'synthetic.tmx',
    sourceSha256: 'b'.repeat(64), blobRelpath: 'blobs/synthetic.tmx' })
  db.tmSources.ensureImported(reference)
  const afterSource = db.tmUnits.listCandidates('en', 'zh-CN')
  assert.notStrictEqual(afterSource, beforeSource)
  db.tmSources.ensureImported(reference)
  assert.strictEqual(db.tmUnits.listCandidates('en', 'zh-CN'), afterSource)
})

test('TM cache never reuses or publishes reads from an outer transaction that rolls back', (t) => {
  const { db, input } = fixture(t)
  const before = db.tmUnits.listCandidates('en', 'zh-CN')
  assert.throws(() => db.catDb.transaction('synthetic rollback', () => {
    assert.notStrictEqual(db.tmUnits.listCandidates('en', 'zh-CN'), before)
    db.tmUnits.importMany([{ ...input, source: 'Uncommitted synthetic source', occurrenceKey: 'rollback' }])
    assert.equal(db.tmUnits.listCandidates('en', 'zh-CN').length, 2)
    throw new Error('synthetic rollback')
  }), /synthetic rollback/u)
  const after = db.tmUnits.listCandidates('en', 'zh-CN')
  assert.equal(after.length, 1)
  assert.strictEqual(db.tmUnits.listCandidates('en', 'zh-CN'), after)
  assert.equal(after[0]!.source, input.source)
})

test('TM cache observes another SQLite connection committing source and unit changes', (t) => {
  const { store, project, db, input } = fixture(t)
  const before = db.tmUnits.listCandidates('en', 'zh-CN')
  const other = store.openProject(project.id)
  try {
    other.tmSources.update(input.sourceId, { priority: 8 })
    const reprioritized = db.tmUnits.listCandidates('en', 'zh-CN')
    assert.notStrictEqual(reprioritized, before)
    assert.equal(reprioritized[0]!.sourcePriority, 8)
    other.tmUnits.importMany([{ ...input, source: 'External synthetic source', occurrenceKey: 'external' }])
    assert.equal(db.tmUnits.listCandidates('en', 'zh-CN').length, 2)
    const after = db.tmUnits.listCandidates('en', 'zh-CN')
    assert.strictEqual(db.tmUnits.listCandidates('en', 'zh-CN'), after)
  } finally { other.close() }
})
