import assert from 'node:assert/strict'
import { createHash, randomUUID } from 'node:crypto'
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { CatStore, LINGUIST_APPLICATION_ID, loadDatabaseSync, MIGRATIONS } from '@linguist/cat-store'
import { getProjectQuestionMaterials, listProjectLibrary, syncProjectLibrary } from './project-library'
import { LinguistProjectService } from './project-service'

test('two groups independently edit, reimport, move, export and restore one original with shared and private sources', async () => {
  const workspace = realpathSync(mkdtempSync(join(tmpdir(), 'la-two-groups-')))
  const service = new LinguistProjectService({ rootDir: join(workspace, 'data'), applicationVersion: 'synthetic' })
  const imported = new LinguistProjectService({ rootDir: join(workspace, 'fresh'), applicationVersion: 'synthetic' })
  service.init()
  imported.init()
  try {
    const project = await service.createProject({ name: 'Synthetic group isolation', sourceLocale: 'en', targetLocale: 'zh-CN' })
    const id = project.id
    await service.reviewCache.setEnabled(false)
    const db = service.openProject(id)
    const a = db.taskGroups.change({ action: 'create', name: 'First' })
    const b = db.taskGroups.change({ action: 'create', name: 'Second' })
    const filename = 'same.xliff'
    const bytes = Buffer.from('<xliff version="1.2"><file><body><trans-unit id="key"><source>Use potion</source><target>原始译文</target></trans-unit><trans-unit id="locked" translate="no"><source>Fixed</source><target>固定</target></trans-unit></body></file></xliff>')
    writeFileSync(join(workspace, filename), bytes)
    const digest = createHash('sha256').update(bytes).digest('hex')
    const firstFileId = db.taskGroups.registerBatch(a, 'working-copy', digest, filename)
    const intake = (taskGroupId: string) => service.importAsset(id, { bytes, filename, taskGroupId })
    const [first, second, repeat] = await Promise.all([intake(a), intake(b), intake(a)])
    assert.equal(first.assetId, firstFileId)
    assert.equal(first.assetId, repeat.assetId)
    assert.equal([first.status, repeat.status].filter(status => status === 'imported').length, 1)
    assert.notEqual(first.assetId, second.assetId)
    assert.deepEqual(db.taskGroups.list().map(item => item.batchCount), [0, 1, 1])
    const firstRow = db.segments.query({ assetId: first.assetId })[0]!
    const secondRow = db.segments.query({ assetId: second.assetId })[0]!
    assert.notEqual(firstRow.id, secondRow.id)
    service.editSegment(id, firstRow.id, '甲组译文', firstRow.revision, { propagateRepeated: true })
    assert.equal(db.segments.getById(secondRow.id)!.target, '原始译文')
    service.editSegment(id, secondRow.id, '乙组译文', secondRow.revision)
    service.confirmCurrentStage(id, firstRow.id, db.segments.getById(firstRow.id)!.revision, 'synthetic-first')
    const locked = db.segments.query({ assetId: first.assetId })[1]!

    writeFileSync(join(workspace, 'base.txt'), 'Base rule')
    await syncProjectLibrary(service, id, workspace, [{ path: 'base.txt', kind: 'rules' }])
    const screenshot = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jR3sAAAAASUVORK5CYII=', 'base64')
    for (const [scope, label] of [[a, 'Alpha'], [b, 'Beta']] as const) {
      const upload = join('.linguist', 'project-resources', id, randomUUID())
      mkdirSync(join(workspace, upload), { recursive: true })
      writeFileSync(join(workspace, upload, label + '.png'), screenshot)
      writeFileSync(join(workspace, label + '-query.txt'), 'Potion query answer ' + label)
      writeFileSync(join(workspace, label + '.txt'), label + ' rule')
      writeFileSync(join(workspace, label + '-terms.csv'), 'source,target\nPotion,' + label + 'Term\n')
      writeFileSync(join(workspace, label + '-tm.csv'), 'source,target\nUse potion,' + label + 'Memory\n')
      await syncProjectLibrary(service, id, workspace, [
        { path: label + '.txt', kind: 'rules', ...(scope === a ? { replacesInherited: 'file:base.txt' } : {}) },
        { path: label + '-terms.csv', kind: 'terms' }, { path: label + '-tm.csv', kind: 'tm' },
        { path: join(upload, label + '.png'), kind: 'context' }, { path: label + '-query.txt', kind: 'context' },
      ], { taskGroupId: scope })
    }
    async function verify(current: LinguistProjectService) {
      const projectDb = current.openProject(id)
      assert.equal(projectDb.taskGroups.groupOf(first.assetId), a)
      assert.equal(projectDb.taskGroups.groupOf(second.assetId), b)
      assert.equal(projectDb.segments.getById(locked.id)?.locked, true)
      assert.equal(projectDb.segments.getById(firstRow.id)?.target, '甲组译文')
      assert.equal(projectDb.segments.getById(secondRow.id)?.target, '乙组译文')
      const [left, right, shared] = await Promise.all([a, b, undefined].map(scope =>
        getProjectQuestionMaterials(current, id, workspace, 'Use potion', undefined, [], scope)))
      assert.deepEqual(left!.rules.map(rule => rule.text), ['Alpha rule'])
      assert.deepEqual(right!.rules.map(rule => rule.text).sort(), ['Base rule', 'Beta rule'])
      assert.deepEqual(shared!.rules.map(rule => rule.text), ['Base rule'])
      assert.deepEqual(left!.terms.map(term => term.translation), ['AlphaTerm'])
      assert.deepEqual(right!.terms.map(term => term.translation), ['BetaTerm'])
      assert.deepEqual(shared!.terms, [])
      assert.ok(left!.related.some(entry => entry.text.includes('Potion query answer Alpha')))
      assert.ok(right!.related.some(entry => entry.text.includes('Potion query answer Beta')))
      assert.deepEqual(shared!.related, [])
      assert.deepEqual(shared!.visualFiles, [])
      for (const [materials, label] of [[left!, 'Alpha'], [right!, 'Beta']] as const) {
        assert.deepEqual(materials.visualFiles.map(path => path.split('/').at(-1)), [label + '.png'])
        assert.deepEqual(readFileSync(join(workspace, materials.visualFiles[0]!)), screenshot)
      }
      assert.ok(left!.tm.some(unit => unit.target === 'AlphaMemory'))
      assert.ok(right!.tm.some(unit => unit.target === 'BetaMemory'))
      assert.doesNotMatch(JSON.stringify(left), /Beta/u)
      assert.doesNotMatch(JSON.stringify(right), /Alpha|甲组译文/u)
      assert.equal(shared!.tm.length, 0)
    }
    await verify(service)
    for (const [batch, tag] of [[first, '甲'], [second, '乙']] as const) {
      const output = join(workspace, tag + '.xliff')
      await service.exportAssetToPath(id, batch.assetId, output, 'as-is', false)
      assert.match(readFileSync(output, 'utf8'), new RegExp(tag + '组译文'))
    }
    assert.deepEqual(readFileSync(join(workspace, filename)), bytes)
    const backup = service.backupProject(id, workspace)
    rmSync(join(workspace, '.linguist', 'project-resources'), { recursive: true })
    rmSync(join(workspace, '.linguist', 'context-images'), { recursive: true })
    assert.throws(() => db.taskGroups.change({ action: 'moveBatches', id: a, batchIds: [second.assetId] }), /同一原稿/)
    db.taskGroups.change({ action: 'moveBatches', id: 'ungrouped', batchIds: [second.assetId] })
    const next = await intake(b)
    assert.notEqual(next.assetId, second.assetId)
    assert.equal(db.segments.getById(secondRow.id)?.target, '乙组译文')
    db.taskGroups.change({ action: 'archive', id: a })
    assert.throws(() => db.segments.setLocked(locked.id, false), /归档/)
    service.setWorkflowConfig(id, 'editing')
    assert.equal(db.segments.getById(firstRow.id)?.target, '甲组译文')
    db.taskGroups.change({ action: 'restore', id: a })
    service.restoreProject(id, backup.backupName)
    imported.importProjectBackupFromPath(join(service.rootDir, backup.backupDir))
    await verify(service)
    await verify(imported)
  } finally {
    service.closeAll()
    imported.closeAll()
    rmSync(workspace, { recursive: true, force: true })
  }
})

test('first writable open of a v20 project backs up its managed file and preserves its original batch and its recorded review', async () => {
  const workspace = realpathSync(mkdtempSync(join(tmpdir(), 'la-upgrade-group-')))
  const rootDir = join(workspace, 'data')
  const service = new LinguistProjectService({ rootDir, applicationVersion: 'synthetic', workspaceRootForProject: () => workspace })
  const store = new CatStore({ rootDir })
  service.init()
  try {
    const { id } = store.createProject({ name: 'Previous version', sourceLocale: 'en', targetLocale: 'zh-CN' })
    const paths = service.getProjectPaths(id)
    const sqlite = new (loadDatabaseSync())(paths.catDbPath)
    const assetId = 'ast-0000000000000001'
    const rowId = 'seg-0000000000000001'
    const source = '{"k":"Compass"}'
    const sourceDigest = createHash('sha256').update(source).digest('hex')
    sqlite.exec('CREATE TABLE schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL, description TEXT NOT NULL)')
    const record = sqlite.prepare('INSERT INTO schema_migrations VALUES (?, ?, ?)')
    for (const migration of MIGRATIONS.filter(item => item.version <= 20)) {
      sqlite.exec(migration.sql)
      migration.backfill?.(sqlite)
      record.run(migration.version, '2026-11-01T00:00:00Z', migration.description)
    }
    sqlite.prepare('INSERT INTO assets(id,project_id,format_id,original_filename,source_sha256,segment_count,created_at) VALUES (?,?,?,?,?,1,?)')
      .run(assetId, id, 'json', 'old.json', sourceDigest, '2026-11-01T00:00:00Z')
    sqlite.prepare(`INSERT INTO segments(id,asset_id,ordinal,key,source,target,source_locale,target_locale,status,locked,revision,source_hash,context_json,current_stage_state)
      VALUES (?,?,0,'k','Compass','指南针','en','zh-CN','reviewed',1,1,?,NULL,'confirmed')`).run(rowId, assetId, createHash('sha256').update('Compass').digest('hex'))
    sqlite.prepare("INSERT INTO segment_revisions(segment_id,revision,target,status,source,created_at) VALUES (?,1,'指南针','reviewed','human','2026-11-01T00:00:00Z')").run(rowId)
    sqlite.prepare("INSERT INTO segment_stage_events(segment_id,stage,action,segment_revision,actor,created_at) VALUES (?,'editing','confirmed',1,'synthetic-reviewer','2026-11-01T00:00:00Z')").run(rowId)
    sqlite.exec(`PRAGMA application_id=${LINGUIST_APPLICATION_ID}; PRAGMA user_version=20`)
    sqlite.close()
    store.index.recordDatabaseIdentity(id, { applicationId: LINGUIST_APPLICATION_ID, schemaVersion: 20, migrated: false })
    writeFileSync(join(paths.projectDir, 'source', assetId + '.json'), source)
    const dir = '.linguist/project-resources/' + id + '/dc043eba-b3d9-45f6-9a0e-56abec79a7b4'
    mkdirSync(join(workspace, dir), { recursive: true })
    writeFileSync(join(workspace, dir, 'style.txt'), 'Keep Compass.')
    writeFileSync(join(paths.projectDir, 'project-library.json'), JSON.stringify({ resources: [{ kind: 'rules', path: dir + '/style.txt' }] }))
    const archivedRoot = join(workspace, 'archived')
    cpSync(rootDir, archivedRoot, { recursive: true })
    const archived = new LinguistProjectService({ rootDir: archivedRoot, applicationVersion: 'synthetic' })
    try {
      archived.init()
      archived.archiveProject(id)
      assert.ok(listProjectLibrary(archived, id, workspace).some(item => item.filename === 'style.txt'))
      assert.equal(archived.openProject(id).schemaVersion, 20)
      assert.equal(existsSync(join(archived.getProjectPaths(id).projectDir, 'blobs/project-library')), false)
    } finally { archived.closeAll() }
    const live = service.openProject(id)
    assert.deepEqual(live.taskGroups.list().map(({ id, batchCount }) => ({ id, batchCount })), [{ id: 'ungrouped', batchCount: 1 }])
    const row = live.segments.getById(rowId)!
    assert.deepEqual([row.id, row.assetId, row.target, row.locked, row.revision], [rowId, assetId, '指南针', true, 1])
    assert.equal(live.segments.listStageEvents(rowId)[0]?.actor, 'synthetic-reviewer')
    assert.equal(live.segments.listRevisions(rowId)[0]?.target, '指南针')
    assert.equal(live.assets.get(assetId)?.taskGroupId, 'ungrouped')
    const [backup] = service.listBackups(id)
    assert.equal(backup?.schemaVersion, 20)
    assert.equal(readFileSync(join(paths.backupsDir, backup!.name, 'blobs/project-library/dc043eba-b3d9-45f6-9a0e-56abec79a7b4/style.txt'), 'utf8'), 'Keep Compass.')
    service.closeProject(id)
    service.openProject(id)
    assert.equal(service.listBackups(id).length, 1)
  } finally { service.closeAll(); rmSync(workspace, { recursive: true, force: true }) }
})
