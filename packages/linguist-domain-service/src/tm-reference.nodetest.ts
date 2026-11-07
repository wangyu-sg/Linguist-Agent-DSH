import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { matchTmCandidates, selectTmAgentEvidence } from '@linguist/cat-core'
import { loadDatabaseSync } from '@linguist/cat-store'
import { LinguistProjectService } from './project-service'
import { parseSdltmReference } from './trados-reference-parsers'

test('SDLTM provenance survives native schema variants, import, concordance, CAT and Agent evidence', async () => {
  const root = mkdtempSync(join(tmpdir(), 'la-tm-provenance-'))
  const service = new LinguistProjectService({ rootDir: join(root, 'projects'), applicationVersion: 'synthetic-test' })
  service.init()
  try {
    const project = await service.createProject({ name: 'Synthetic TM', sourceLocale: 'zh-CN', targetLocale: 'en-US' })
    for (const memoryColumn of ['translation_memory_id', 'tm_id']) {
      const path = join(root, `${memoryColumn}.sdltm`)
      const DatabaseSync = loadDatabaseSync()
      const native = new DatabaseSync(path)
      native.exec(`
        CREATE TABLE translation_memories (id INTEGER PRIMARY KEY, source_language TEXT, target_language TEXT);
        INSERT INTO translation_memories VALUES (1, 'zh-CN', 'en-US');
        CREATE TABLE translation_units (id INTEGER PRIMARY KEY, ${memoryColumn} INTEGER,
          source_segment TEXT, target_segment TEXT, creation_date TEXT, creation_user TEXT,
          change_date TEXT, change_user TEXT, usage_counter INTEGER);
        CREATE TABLE translation_unit_contexts (translation_unit_id INTEGER, left_source_context INTEGER, left_target_context INTEGER);
        INSERT INTO translation_unit_contexts VALUES (42, 9223372036854775806, -9223372036854775807);
        CREATE TABLE attributes (id INTEGER PRIMARY KEY, name TEXT);
        CREATE TABLE string_attributes (translation_unit_id INTEGER, attribute_id INTEGER, value TEXT);
        INSERT INTO attributes VALUES (1, 'Document');
        INSERT INTO string_attributes VALUES (42, 1, 'historical-ui.csv');
      `)
      const sourceInline = '<Segment><Elements><Text><Value>领取奖励</Value></Text></Elements><CultureName>zh-CN</CultureName></Segment>'
      const targetInline = '<Segment><Elements><Text><Value>Claim rewards</Value></Text></Elements><CultureName>en-US</CultureName></Segment>'
      native.prepare(`INSERT INTO translation_units VALUES (42, 1, ?, ?, ?, ?, ?, ?, 3)`)
        .run(sourceInline, targetInline, '2024-05-01 09:00:00', 'original-author', '2024-05-02 11:00:00', 'original-editor')
      native.close()
      const bytes = readFileSync(path)
      const parsed = parseSdltmReference(bytes, `${memoryColumn}.sdltm`, 'zh-CN', 'en-US')
      assert.equal(parsed.entries[0]!.occurrenceKey, '42')
      assert.equal(parsed.entries[0]!.originalTuid, '42')
      assert.equal(parsed.entries[0]!.sourceInline, sourceInline)
      assert.deepEqual(parsed.entries[0]!.metadata!['sdltm:contexts'], [JSON.stringify({
        left_source_context: '9223372036854775806', left_target_context: '-9223372036854775807',
      })])
      await service.importReference(project.id, 'tm', { filename: `${memoryColumn}.sdltm`, bytes })
    }
    const db = service.openProject(project.id)
    const candidates = db.tmUnits.listCandidates('zh-CN', 'en-US')
    assert.equal(candidates.length, 2)
    for (const candidate of candidates) {
      assert.equal(candidate.originalTuid, '42')
      assert.equal(candidate.metadata!['sdltm:creation_date'], '2024-05-01 09:00:00')
      assert.equal(candidate.metadata!['sdltm:creation_user'], 'original-author')
      assert.equal(candidate.metadata!['sdltm:change_user'], 'original-editor')
      assert.deepEqual(candidate.metadata!['sdltm:attribute:Document'], ['historical-ui.csv'])
      assert.equal(candidate.previousSourceHash, undefined)
      assert.equal(candidate.contextKey, undefined)
    }
    assert.deepEqual(db.tmUnits.concordance({ query: '领取' })[0]!.metadata, candidates[0]!.metadata)
    const evidence = selectTmAgentEvidence(matchTmCandidates('领取奖励', candidates))
    assert.equal(evidence[0]!.originalTuid, '42')
    for (const item of evidence) {
      const candidate = candidates.find(candidate => candidate.unitId === item.unitId)!
      assert.deepEqual(item.metadata, candidate.metadata)
      assert.equal(item.sourceLabel, candidate.sourceLabel)
    }
    assert.equal('approved' in evidence[0]!, false)
    const batch = join(root, 'batch.csv')
    writeFileSync(batch, 'key,source,target\nreward,领取奖励,Claim rewards\n')
    await service.importResourcesFromPaths(project.id, root, { paths: [batch], kind: 'batch', recursive: false, dryRun: false })
    const segment = db.segments.query({ limit: 1 })[0]!
    const context = service.getSegmentContext(project.id, segment.id)
    assert.ok(context.tm[0]!.badges.includes('原库 TU ID：42'))
    assert.ok(context.tm[0]!.badges.some(badge => badge.includes('original-author') && badge.includes('日期不代表审批')))
  } finally {
    service.closeAll()
    rmSync(root, { recursive: true, force: true })
  }
})

test('SDLTM missing optional provenance columns stays unknown rather than becoming invented history', () => {
  const root = mkdtempSync(join(tmpdir(), 'la-tm-minimal-'))
  try {
    const path = join(root, 'minimal.sdltm')
    const DatabaseSync = loadDatabaseSync()
    const native = new DatabaseSync(path)
    native.exec(`
      CREATE TABLE translation_memories (id INTEGER PRIMARY KEY, source_language TEXT, target_language TEXT);
      INSERT INTO translation_memories VALUES (1, 'en-US', 'zh-CN');
      CREATE TABLE translation_units (id INTEGER PRIMARY KEY, tm_id INTEGER, source_segment TEXT, target_segment TEXT);
      INSERT INTO translation_units VALUES (88, 1, 'Hello', '你好');
    `)
    native.close()
    const { entries } = parseSdltmReference(readFileSync(path), 'minimal.sdltm', 'en-US', 'zh-CN')
    assert.equal(entries[0]!.originalTuid, '88')
    assert.deepEqual(entries[0]!.metadata, { 'sdltm:id': '88', 'sdltm:tm_id': '1' })
    assert.equal(entries[0]!.previousSource, undefined)
    assert.equal(entries[0]!.contextKey, undefined)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
