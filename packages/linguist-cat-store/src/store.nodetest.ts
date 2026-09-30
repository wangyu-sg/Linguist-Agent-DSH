import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { CsvAdapter, FormatExportError, JsonAdapter, MqXliffAdapter } from '@linguist/cat-formats'
import { CatStore } from './store'
import { stageAssetExport } from './export-staging'
import { readBackupManifest } from './backup'
import { LINGUIST_APPLICATION_ID } from './database'
import { loadDatabaseSync } from './runtime'
import { MIGRATIONS } from './schema'
import { makeClock, makeEntropy, makeTempDir } from './testkit'

test('交付往返：单语 JSON 写入译文，双语 JSON/CSV 保留源文，拒绝错误产物', async (t) => {
  for (const sample of [
    { filename: 'flat.json', adapter: new JsonAdapter(), original: '{"hello":"Hello","keep":"Keep","empty":""}', expected: '{"hello":"你好","keep":"Keep","empty":""}' },
    { filename: 'nested.json', adapter: new JsonAdapter(), original: '\uFEFF {"menu":{"hello":"Hello","keep":"Keep"},"count":2,"items":["opaque"]}', expected: '\uFEFF {"menu":{"hello":"你好","keep":"Keep"},"count":2,"items":["opaque"]}' },
    { filename: 'bilingual.json', adapter: new JsonAdapter(), original: '[{"id":"hello","source":"Hello","target":""},{"id":"keep","source":"Keep","target":""}]', expected: '[{"id":"hello","source":"Hello","target":"你好"},{"id":"keep","source":"Keep","target":""}]' },
    { filename: 'bilingual.csv', adapter: new CsvAdapter(), original: 'id,source,target\nhello,Hello,\nkeep,Keep,\n', expected: 'id,source,target\nhello,Hello,你好\nkeep,Keep,\n' },
  ]) {
    await t.test(sample.filename, async () => {
      const rootDir = makeTempDir()
      const store = new CatStore({ rootDir, entropy: makeEntropy(sample.filename), now: makeClock() })
      const project = store.createProject({ name: 'Export', sourceLocale: 'en', targetLocale: 'zh-CN' })
      const db = store.openProject(project.id)
      try {
        const bytes = new TextEncoder().encode(sample.original)
        const imported = await sample.adapter.import({ bytes, filename: sample.filename, sourceLocale: 'en', targetLocale: 'zh-CN' })
        const { asset, segments } = db.assets.insertImported(imported)
        db.saveAssetSourceForImport(asset, bytes)
        const input = { project, projectDir: store.index.projectDir(project.id), db, assetId: asset.id, adapter: sample.adapter }
        const unmodified = await stageAssetExport(input)
        assert.deepEqual(readFileSync(unmodified.stagingPath), Buffer.from(bytes))

        db.segments.applyTargetEdit(segments[0]!.id, '你好', 0)
        const exported = await stageAssetExport(input)
        assert.equal(readFileSync(exported.stagingPath, 'utf8'), sample.expected)
        assert.equal(exported.verifiedSegments, segments.length)
        assert.equal(exported.verification.changedTargetSegments, 1)
        assert.deepEqual(db.readAssetSource(asset.id), Buffer.from(bytes))

        // 模拟适配器丢失译文和改坏源文；交付校验必须继续 fail closed。
        const exportValid = sample.adapter.export.bind(sample.adapter)
        sample.adapter.export = async () => bytes
        await assert.rejects(stageAssetExport(input), FormatExportError)
        sample.adapter.export = async (exportInput) => new TextEncoder().encode(
          new TextDecoder().decode(await exportValid(exportInput)).replace('Keep', 'Corrupted'),
        )
        await assert.rejects(stageAssetExport(input), FormatExportError)
      } finally {
        db.close()
        rmSync(rootDir, { recursive: true, force: true })
      }
    })
  }
})

test('memoQ 交付：草稿保留原生状态，仅本轮确认按项目策略写回，严格回读不放宽', async () => {
  const rootDir = makeTempDir()
  const store = new CatStore({ rootDir, entropy: makeEntropy('mqxliff-stage-export'), now: makeClock() })
  const project = store.createProject({ name: 'Synthetic memoQ export', sourceLocale: 'zh-CN', targetLocale: 'en-US' })
  const db = store.openProject(project.id)
  const adapter = new MqXliffAdapter(undefined, () => '2026-09-30T00:00:00.123Z')
  try {
    const bytes = new Uint8Array(readFileSync(new URL('../../../tests/linguist-fixtures/sample.mqxliff', import.meta.url)))
    const imported = await adapter.import({ bytes, filename: 'sample.mqxliff', sourceLocale: project.sourceLocale, targetLocale: project.targetLocale })
    const { asset, segments } = db.assets.insertImported(imported)
    db.saveAssetSourceForImport(asset, bytes)
    const input = { project, projectDir: store.index.projectDir(project.id), db, assetId: asset.id, adapter }
    const original = await stageAssetExport(input)
    assert.deepEqual(readFileSync(original.stagingPath), Buffer.from(bytes))

    const edited = db.segments.applyTargetEdit(segments[0]!.id, 'Synthetic revised target', 0).segment
    assert.equal(edited.currentStageState, 'draft')
    assert.equal(edited.importedNativeStatus, 'PartiallyEdited')
    db.segments.applyTargetEdit(segments[2]!.id, `Revised ${segments[2]!.target}`, 0)
    const draft = await stageAssetExport(input)
    const draftBytes = new Uint8Array(readFileSync(draft.stagingPath))
    const draftReimport = await adapter.import({ bytes: draftBytes, filename: 'sample.mqxliff', sourceLocale: project.sourceLocale, targetLocale: project.targetLocale })
    assert.equal(draft.verification.changedTargetSegments, 2)
    assert.equal(draft.verification.changedNativeStatusSegments, 0)
    assert.deepEqual(draftReimport.segments.map(segment => segment.importedNativeStatus), imported.segments.map(segment => segment.importedNativeStatus))
    assert.equal(draftReimport.segments[2]!.target, `Revised ${segments[2]!.target}`)
    assert.ok(new TextDecoder().decode(draftBytes).includes('<ph id="1">'))

    db.segments.confirmCurrentStage(segments[0]!.id, 'translation', 1)
    const confirmedWithoutPolicy = await stageAssetExport(input)
    assert.deepEqual(readFileSync(confirmedWithoutPolicy.stagingPath), Buffer.from(draftBytes))
    const policyInput = { ...input, project: { ...project, outputStatusPolicy: { mqxliff_1_2: { translation: 'ConfirmedTranslator' } } } }
    db.segments.confirmCurrentStage(segments[1]!.id, 'translation', 0)
    const confirmed = await stageAssetExport(policyInput)
    const confirmedBytes = new Uint8Array(readFileSync(confirmed.stagingPath))
    const confirmedReimport = await adapter.import({ bytes: confirmedBytes, filename: 'sample.mqxliff', sourceLocale: project.sourceLocale, targetLocale: project.targetLocale })
    assert.equal(confirmed.verification.changedTargetSegments, 2)
    assert.equal(confirmed.verification.changedNativeStatusSegments, 2)
    assert.deepEqual(confirmedReimport.segments.map(segment => segment.importedNativeStatus), ['ConfirmedTranslator', 'ConfirmedTranslator', 'PartiallyEdited', 'PartiallyEdited'])
    assert.equal(confirmedReimport.segments[1]!.target, segments[1]!.target)
    assert.equal(confirmedReimport.segments[3]!.target, segments[3]!.target)
    assert.deepEqual(db.readAssetSource(asset.id), Buffer.from(bytes))

    const exportValid = adapter.export.bind(adapter)
    adapter.export = async exportInput => new TextEncoder().encode(new TextDecoder().decode(await exportValid(exportInput)).replaceAll('mq:status="PartiallyEdited"', 'mq:status="ConfirmedTranslator"'))
    await assert.rejects(stageAssetExport(policyInput), /reimported native status differs/)
  } finally {
    db.close()
    rmSync(rootDir, { recursive: true, force: true })
  }
})

test('openProject: creates a verifiable pre-migration backup before Schema 19 writes', () => {
  const store = new CatStore({
    rootDir: makeTempDir(),
    entropy: makeEntropy('pre-migration-backup'),
    now: makeClock(),
    applicationVersion: 'test',
  })
  const project = store.createProject({
    name: 'Pre-migration backup',
    sourceLocale: 'en-US',
    targetLocale: 'zh-CN',
  })
  const dbPath = store.index.projectDbPath(project.id)
  const DatabaseSync = loadDatabaseSync()
  const legacy = new DatabaseSync(dbPath)
  legacy.exec(`
    CREATE TABLE schema_migrations (
      version INTEGER PRIMARY KEY,
      applied_at TEXT NOT NULL,
      description TEXT NOT NULL
    )
  `)
  const record = legacy.prepare(
    'INSERT INTO schema_migrations (version, applied_at, description) VALUES (?, ?, ?)',
  )
  for (const migration of MIGRATIONS.filter((item) => item.version <= 18)) {
    legacy.exec(migration.sql)
    migration.backfill?.(legacy)
    record.run(migration.version, '2026-01-01T00:00:00.000Z', migration.description)
  }
  legacy.exec(`
    PRAGMA application_id = ${LINGUIST_APPLICATION_ID};
    PRAGMA user_version = 18;
  `)
  legacy.close()
  store.index.recordDatabaseIdentity(project.id, {
    applicationId: LINGUIST_APPLICATION_ID,
    schemaVersion: 18,
    migrated: false,
  })

  const migrated = store.openProject(project.id)
  try {
    assert.equal(migrated.schemaVersion, 19)
  } finally {
    migrated.close()
  }

  const [backup] = store.listProjectBackups(project.id)
  assert.ok(backup)
  const backupDir = join(store.index.projectDir(project.id), 'backups', backup.name)
  const manifest = readBackupManifest(backupDir)
  assert.ok(manifest)
  assert.equal(manifest.schemaVersion, 18)
  assert.deepEqual(manifest.migration, { fromSchema: 18, toSchema: 19 })

  const backupDb = store.openBackupDatabase(project.id, backup.name)
  try {
    assert.equal(backupDb.readOnly, true)
    assert.equal(backupDb.schemaVersion, 18)
  } finally {
    backupDb.close()
  }
})

test('Schema 19 repositories keep imported occurrences separately and honor source controls', () => {
  const store = new CatStore({
    rootDir: makeTempDir(),
    entropy: makeEntropy('tm-sources'),
    now: makeClock(),
  })
  const project = store.createProject({
    name: 'TM sources',
    sourceLocale: 'en-US',
    targetLocale: 'zh-CN',
  })
  const db = store.openProject(project.id)
  try {
    const reference = db.referenceImports.insert({
      kind: 'tm',
      originalFilename: 'source.tmx',
      sourceSha256: 'a'.repeat(64),
      blobRelpath: 'blobs/source.tmx',
    })
    const source = db.tmSources.ensureImported(reference)
    const imported = db.tmUnits.importMany([{
      source: 'Charge',
      target: '充能',
      sourceLocale: 'en-US',
      targetLocale: 'zh-CN',
      sourceId: source.id,
      occurrenceKey: 'tuid-1',
      originalTuid: 'tuid-1',
      metadata: { domain: 'ui' },
      sourceInline: '<seg><ph/></seg>',
      targetInline: '<seg><ph/></seg>',
    }])
    assert.deepEqual(imported, { imported: 1, unchanged: 0 })
    assert.deepEqual(db.tmSources.get(source.id), {
      ...source,
      unitCount: 1,
    })
    const unit = db.tmUnits.list()[0]!
    assert.deepEqual(db.tmUnits.listCandidates('en-US', 'zh-CN')[0], {
      unitId: unit.id,
      source: 'Charge',
      target: '充能',
      sourceLabel: 'source.tmx',
      sourcePriority: 0,
      originalTuid: 'tuid-1',
      metadata: { domain: 'ui' },
      sourceInline: '<seg><ph/></seg>',
      targetInline: '<seg><ph/></seg>',
    })

    db.tmSources.update(source.id, { enabled: false })
    assert.equal(db.tmUnits.listCandidates('en-US', 'zh-CN').length, 0)
    db.tmSources.update(source.id, { enabled: true, priority: 3 })
    assert.equal(db.tmSources.get(source.id)?.priority, 3)
    assert.equal(db.tmSources.get(source.id)?.enabled, true)
  } finally {
    db.close()
  }
})

test('Schema 19 source identity is not shared across language pairs', () => {
  const store = new CatStore({ rootDir: makeTempDir(), entropy: makeEntropy('tm-hash'), now: makeClock() })
  const project = store.createProject({
    name: 'TM hash',
    sourceLocale: 'en-US',
    targetLocale: 'zh-CN',
  })
  const db = store.openProject(project.id)
  try {
    const sourceId = 'source-1'
    db.tmUnits.importMany([
      {
        source: 'Save',
        target: '保存',
        sourceLocale: 'en-US',
        targetLocale: 'zh-CN',
        sourceId,
        occurrenceKey: 'en-zh',
      },
      {
        source: 'Save',
        target: 'Sauvegarder',
        sourceLocale: 'en-US',
        targetLocale: 'fr-FR',
        sourceId,
        occurrenceKey: 'en-fr',
      },
    ])
    const rows = db.tmUnits.list({ query: 'Save' })
    assert.equal(rows.length, 2)
    const hashes = db.catDb.db.prepare(
      'SELECT source_hash FROM tm_units WHERE project_id = ? ORDER BY source_locale',
    ).all(project.id) as Array<{ source_hash: string }>
    assert.notEqual(hashes[0]!.source_hash, hashes[1]!.source_hash)
  } finally {
    db.close()
  }
})

test('建议批次过滤在分页之前执行，历史与 count 同范围', async () => {
  const rootDir = makeTempDir()
  const store = new CatStore({ rootDir, entropy: makeEntropy('proposal-batch'), now: makeClock() })
  const project = store.createProject({ name: '批次建议', sourceLocale: 'en', targetLocale: 'zh-CN' })
  const db = store.openProject(project.id)
  try {
    const batches = []
    for (const filename of ['a.csv', 'b.csv']) {
      const imported = await new CsvAdapter().import({
        bytes: new TextEncoder().encode('id,source,target\n1,One,\n2,Two,\n3,Three,\n'),
        filename, sourceLocale: 'en', targetLocale: 'zh-CN',
      })
      const batch = db.assets.insertImported(imported)
      batches.push(batch)
      for (const segment of batch.segments) {
        db.proposals.insertPending({ segmentId: segment.id, baseRevision: 0,
          proposedTarget: '译文', runId: filename, now: '2026-09-09T00:00:00.000Z' })
      }
    }
    const assetId = batches[0]!.asset.id
    const filter = { assetId, status: 'pending' as const }
    assert.equal(db.proposals.count(filter), 3)
    assert.equal(db.proposals.count(), 6)
    const all = db.proposals.list(filter)
    assert.equal(all.length, 3)
    assert.deepEqual(db.proposals.list({ ...filter, limit: 1, offset: 1 }), [all[1]])
    assert.deepEqual(db.proposals.listWithDiffs({ ...filter, limit: 1, offset: 1 }).map(item => item.proposal.id), [all[1]!.id])
    db.proposals.accept(all[0]!.id)
    assert.equal(db.proposals.count(filter), 2)
    assert.equal(db.proposals.count({ assetId, status: 'accepted' }), 1)
    const applied = db.proposals.listWithDiffs({ assetId, status: 'accepted' })[0]!
    assert.equal(applied.currentRevision, applied.baseRevision + 1)
    assert.equal(applied.currentTarget, applied.proposedTarget)
    assert.equal(db.proposals.count({ assetId: 'missing' }), 0)
    assert.deepEqual(db.proposals.listWithDiffs({ assetId: 'missing' }), [])
  } finally {
    db.close()
    rmSync(rootDir, { recursive: true, force: true })
  }
})
