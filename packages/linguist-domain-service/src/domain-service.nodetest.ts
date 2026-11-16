import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { CatStore, LINGUIST_APPLICATION_ID, loadDatabaseSync, MIGRATIONS } from '@linguist/cat-store'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, truncateSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test, { mock } from 'node:test'

import { prepareWorkingCopy, readWorkingJson, workingCopyPath } from './working-copy'

import { LINGUIST_FILE_MAX_BYTES } from './contracts'
import { LinguistImportTooLargeError } from './errors'
import { PROJECT_BRIEF_PATH, readProjectBrief, readWorkspaceBriefSource, type ProjectBrief } from './project-brief'

mock.module('./semantic-review', { namedExports: { getSemanticReview: async () => ({ status: 'failed', error: 'Synthetic test: local model unavailable' }) } })
const { LinguistProjectService } = await import('./project-service')
const { executeWorkingCopyAction } = await import('./working-copy-service')

test('project summary reads an old project without migrating it or replacing a live handle', async () => {
  const root = mkdtempSync(join(tmpdir(), 'la-summary-readonly-'))
  const service = new LinguistProjectService({ rootDir: root, applicationVersion: 'synthetic-test' })
  service.init()
  try {
    const project = await service.createProject({ name: 'Synthetic old project', sourceLocale: 'en', targetLocale: 'zh-CN' })
    const paths = service.getProjectPaths(project.id)
    const db = new (loadDatabaseSync())(paths.catDbPath)
    db.exec(`DROP TABLE term_entry_sources;
      ALTER TABLE tm_units DROP COLUMN local_metadata_json;
      ALTER TABLE tm_units DROP COLUMN locally_confirmed;
      DELETE FROM schema_migrations WHERE version = 20;
      PRAGMA user_version = 19;
      PRAGMA wal_checkpoint(TRUNCATE);`)
    db.close()
    new CatStore({ rootDir: root, applicationVersion: 'synthetic-test' }).index.recordDatabaseIdentity(project.id, { applicationId: LINGUIST_APPLICATION_ID, schemaVersion: 19, migrated: false })
    const before = readFileSync(paths.projectJsonPath)
    const beforeDb = readFileSync(paths.catDbPath)
    assert.equal(service.getProjectSummary(project.id).totalSegments, 0)
    assert.equal(service.checkProjectHealth(project.id).checks.find(check => check.id === 'schema_version')?.upgradeRequired, true)
    assert.deepEqual(readFileSync(paths.projectJsonPath), before)
    assert.deepEqual(readFileSync(paths.catDbPath), beforeDb)
    assert.equal(service.listBackups(project.id).length, 0)
    const old = new (loadDatabaseSync())(paths.catDbPath, { readOnly: true })
    try { assert.equal((old.prepare('PRAGMA user_version').get() as { user_version: number }).user_version, 19) }
    finally { old.close() }
    const live = service.openProject(project.id)
    assert.equal(live.schemaVersion, 20)
    assert.equal(service.listBackups(project.id).length, 1)
    service.getProjectSummary(project.id)
    assert.equal(service.openProject(project.id), live)
    service.closeProject(project.id)
    writeFileSync(paths.catDbPath, 'synthetic corruption')
    assert.throws(() => service.getProjectSummary(project.id), { code: 'PROJECT_UNHEALTHY' })
  } finally { service.closeAll(); rmSync(root, { recursive: true, force: true }) }
})

test('a schema 7 project is identified as needing an upgrade without upgrading it from the list', async () => {
  const root = mkdtempSync(join(tmpdir(), 'la-summary-v7-'))
  const service = new LinguistProjectService({ rootDir: root, applicationVersion: 'synthetic-test' })
  service.init()
  try {
    const project = await service.createProject({ name: 'Synthetic v7 project', sourceLocale: 'en', targetLocale: 'zh-CN' })
    const paths = service.getProjectPaths(project.id)
    rmSync(paths.catDbPath)
    const legacy = new (loadDatabaseSync())(paths.catDbPath)
    legacy.exec('CREATE TABLE schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL, description TEXT NOT NULL)')
    const record = legacy.prepare('INSERT INTO schema_migrations (version, applied_at, description) VALUES (?, ?, ?)')
    for (const migration of MIGRATIONS.filter(item => item.version <= 7)) {
      legacy.exec(migration.sql)
      migration.backfill?.(legacy)
      record.run(migration.version, '2026-01-01T00:00:00.000Z', migration.description)
    }
    legacy.exec(`PRAGMA application_id = ${LINGUIST_APPLICATION_ID}; PRAGMA user_version = 7`)
    legacy.close()
    new CatStore({ rootDir: root, applicationVersion: 'synthetic-test' }).index.recordDatabaseIdentity(project.id, { applicationId: LINGUIST_APPLICATION_ID, schemaVersion: 7, migrated: false })
    const beforeDb = readFileSync(paths.catDbPath)
    assert.throws(() => service.getProjectSummary(project.id))
    assert.equal(service.checkProjectHealth(project.id).checks.find(check => check.id === 'schema_version')?.upgradeRequired, true)
    assert.deepEqual(readFileSync(paths.catDbPath), beforeDb)
    assert.equal(service.listBackups(project.id).length, 0)
    assert.equal(service.openProject(project.id).schemaVersion, 20)
    assert.equal(service.listBackups(project.id).length, 1)
    assert.equal(service.getProjectSummary(project.id).totalSegments, 0)
  } finally { service.closeAll(); rmSync(root, { recursive: true, force: true }) }
})

test('human stage confirmation writes the same TM with a real local-user record', async () => {
  const root = mkdtempSync(join(tmpdir(), 'la-confirmed-tm-'))
  const service = new LinguistProjectService({ rootDir: root, applicationVersion: 'synthetic-test' })
  service.init()
  try {
    const project = await service.createProject({ name: 'Synthetic', sourceLocale: 'en', targetLocale: 'zh-CN' })
    const path = join(root, 'batch.csv')
    writeFileSync(path, 'key,source,target\na,Open,打开\n')
    await service.importResourcesFromPaths(project.id, root, { paths: [path], recursive: false, kind: 'batch', dryRun: false })
    const db = service.openProject(project.id), segment = db.segments.query()[0]!
    const tmx = Buffer.from('<tmx version="1.4"><header srclang="en"/><body><tu tuid="synthetic"><prop type="la_confirmations">external one</prop><prop type="la_confirmations">external two</prop><prop type="la_reuse_count">external count</prop><tuv xml:lang="en"><seg>Open</seg></tuv><tuv xml:lang="zh-CN"><seg>打开</seg></tuv></tu></body></tmx>')
    await service.importReference(project.id, 'tm', { filename: 'synthetic.tmx', bytes: tmx })
    service.confirmCurrentStage(project.id, segment.id, segment.revision, 'synthetic-task')
    const match = db.tmUnits.listCandidates('en', 'zh-CN')[0]!
    assert.equal(match.target, '打开')
    assert.deepEqual(match.metadata?.la_confirmations, ['external one', 'external two'])
    assert.equal(match.metadata?.la_reuse_count, 'external count')
    assert.equal((await service.importReference(project.id, 'tm', { filename: 'synthetic.tmx', bytes: tmx })).unchanged, 1)
    assert.deepEqual([JSON.parse((match.localMetadata!.la_confirmations as string[])[0]!).actor, JSON.parse((match.localMetadata!.la_confirmations as string[])[0]!).taskId], ['local-user', 'synthetic-task'])
    assert.ok(service.getSegmentContext(project.id, segment.id).tm[0]!.warnings.some(value => value.includes('同一句段')))
    assert.throws(() => service.confirmCurrentStage(project.id, segment.id, segment.revision))
    assert.equal(db.tmUnits.listCandidates('en', 'zh-CN')[0]!.localMetadata!.la_confirmation_count, '1')
  } finally { service.closeAll(); rmSync(root, { recursive: true, force: true }) }
})

test('human use of a selected TM is counted only with a successful matching save', async () => {
  const root = mkdtempSync(join(tmpdir(), 'la-human-tm-reuse-'))
  const service = new LinguistProjectService({ rootDir: root, applicationVersion: 'synthetic-test' })
  service.init()
  try {
    const project = await service.createProject({ name: 'Synthetic', sourceLocale: 'en', targetLocale: 'zh-CN' })
    const path = join(root, 'batch.csv')
    writeFileSync(path, 'key,source,target\na,Open,初稿\nb,Open,\nc,Open,\n')
    await service.importResourcesFromPaths(project.id, root, { paths: [path], recursive: false, kind: 'batch', dryRun: false })
    const db = service.openProject(project.id), segment = db.segments.query()[0]!
    db.tmUnits.importMany([{ source: 'Open', target: '打开', sourceLocale: 'en', targetLocale: 'zh-CN', sourceId: 'synthetic', occurrenceKey: 'one' }])
    const unit = db.tmUnits.listCandidates('en', 'zh-CN')[0]!
    const saved = service.editSegment(project.id, segment.id, '打开', segment.revision, { tmUnitId: unit.unitId, propagateRepeated: true })
    assert.equal(saved.repetition?.updatedSegmentIds.length, 2)
    assert.equal(db.tmUnits.listCandidates('en', 'zh-CN')[0]!.localMetadata?.la_reuse_count, '3')
    assert.throws(() => service.editSegment(project.id, segment.id, '打开', segment.revision, { tmUnitId: unit.unitId }))
    assert.equal(db.tmUnits.listCandidates('en', 'zh-CN')[0]!.localMetadata?.la_reuse_count, '3')
  } finally { service.closeAll(); rmSync(root, { recursive: true, force: true }) }
})

test('project service creates versioned metadata and preserves import/CAS/archive behavior', async () => {
  const root = mkdtempSync(join(tmpdir(), 'la-dsh-project-'))
  const service = new LinguistProjectService({ rootDir: root, applicationVersion: 'synthetic-test' })
  service.init()
  try {
    const project = await service.createProject({ name: 'Synthetic', sourceLocale: 'zh-CN', targetLocale: 'en-US' })
    assert.equal(project.schemaVersion, 2)
    assert.equal('promaWorkspaceId' in project, false)
    const file = join(root, 'batch.csv')
    writeFileSync(file, 'key,source,target\na,开始,Begin\nb,取消,Cancel\n')
    const input = { paths: [file], recursive: false, kind: 'batch' as const }
    assert.equal((await service.importResourcesFromPaths(project.id, root, { ...input, dryRun: true })).ready, 1)
    assert.equal(service.openProject(project.id).assets.listByProject().length, 0)
    assert.equal((await service.importResourcesFromPaths(project.id, root, { ...input, dryRun: false })).imported, 1)
    assert.equal((await service.importResourcesFromPaths(project.id, root, { ...input, dryRun: false })).skippedDuplicate, 1)
    const contextPath = join(root, 'guide.txt')
    writeFileSync(contextPath, 'Synthetic style note')
    const contextInput = { paths: [contextPath], recursive: false, kind: 'auto' as const }
    assert.equal((await service.importResourcesFromPaths(project.id, root, { ...contextInput, dryRun: true })).ready, 1)
    assert.equal((await service.importResourcesFromPaths(project.id, root, { ...contextInput, dryRun: false })).imported, 1)
    assert.equal(service.openProject(project.id).contextDocs.count(), 1)
    const splitPhrase = '<xliff version="1.2" xmlns:m="http://www.memsource.com/mxlf/2.0"><file><body><trans-unit id="one"><source>Open {0} world</source><target>打开 {0} 世界</target></trans-unit></body></file></xliff>'
    for (const extension of ['mxliff', 'xlf', 'xliff']) {
      const split = join(root, `split.${extension}`)
      writeFileSync(split, splitPhrase)
      const preview = await service.importResourcesFromPaths(project.id, root, { paths: [split], recursive: false, kind: 'auto', dryRun: true })
      assert.equal(preview.ready, 0)
      assert.equal(preview.needsInput, 1)
    }
    const db = service.openProject(project.id)
    const segment = db.segments.query({ limit: 1 })[0]
    assert.ok(segment)
    const changed = service.editSegment(project.id, segment.id, 'Start', segment.revision).segment
    assert.equal(changed.target, 'Start')
    assert.throws(() => service.editSegment(project.id, segment.id, 'Stale', segment.revision))
    const backup = service.backupProject(project.id)
    assert.equal(service.listBackups(project.id).some((item) => item.name === backup.backupName), true)
    assert.equal(service.previewRestore(project.id, backup.backupName).verification?.ok, true)
    service.archiveProject(project.id)
    assert.throws(() => service.editSegment(project.id, segment.id, 'Closed', changed.revision))
  } finally {
    service.closeAll()
    rmSync(root, { recursive: true, force: true })
  }
})

test('CAT repeated saves preserve exact scope, protected targets, CAS and safe undo', async () => {
  const root = mkdtempSync(join(tmpdir(), 'la-dsh-repetitions-'))
  const service = new LinguistProjectService({ rootDir: root, applicationVersion: 'synthetic-test' })
  service.init()
  try {
    const project = await service.createProject({ name: 'Repetitions', sourceLocale: 'en-US', targetLocale: 'zh-CN' })
    const path = join(root, 'repetitions.csv')
    writeFileSync(path, [
      'key,source,target',
      'primary,Hello {0},Initial {0}',
      'empty,Hello {0},',
      'same-before,Hello {0},Old {0}',
      'later-edit,Hello {0},Old {0}',
      'restore,Hello {0},',
      'locked,Hello {0},',
      'confirmed,Hello {0},Old {0}',
      'draft,Hello {0},',
      'different,Hello {0},Different {0}',
      'same-target,Hello {0},New {0}',
      'other-tags,Hello {1},',
      'other-whitespace,Hello {0} ,',
      'other-locale,Hello {0},',
      'unsafe-primary,Unsafe {0},',
      'unsafe-repeat,Unsafe {0},',
    ].join('\n'))
    await service.importResourcesFromPaths(project.id, root, { paths: [path], recursive: false, kind: 'batch', dryRun: false })
    const db = service.openProject(project.id)
    const asset = db.assets.listByProject()[0]!
    const byKey = new Map(db.segments.query({ assetId: asset.id }).map(segment => [segment.key, segment]))
    const primary = byKey.get('primary')!
    const empty = byKey.get('empty')!
    const sameBefore = byKey.get('same-before')!
    const laterEdit = byKey.get('later-edit')!
    const restore = byKey.get('restore')!
    db.segments.setLocked(byKey.get('locked')!.id, true)
    service.confirmCurrentStage(project.id, byKey.get('confirmed')!.id, 0)
    db.catDb.db.prepare('UPDATE segments SET target_locale = ? WHERE id = ?').run('ja-JP', byKey.get('other-locale')!.id)
    const otherPath = join(root, 'other-batch.csv')
    writeFileSync(otherPath, 'key,source,target\nother,Hello {0},\n')
    await service.importResourcesFromPaths(project.id, root, { paths: [otherPath], recursive: false, kind: 'batch', dryRun: false })
    const otherBatch = db.segments.query().find(segment => segment.key === 'other')!

    const disabled = service.editSegment(project.id, primary.id, 'Old {0}', 0, { propagateRepeated: false })
    assert.equal(disabled.repetition, undefined)
    assert.equal(db.segments.getById(empty.id)!.target, '')
    const saved = service.editSegment(project.id, primary.id, 'New {0}', disabled.segment.revision, {
      propagateRepeated: true,
      excludedSegmentIds: [byKey.get('draft')!.id],
    })
    assert.ok(saved.repetition)
    assert.deepEqual(saved.repetition.updatedSegmentIds, [empty.id, sameBefore.id, laterEdit.id, restore.id])
    assert.deepEqual(saved.repetition.skipped, [
      { segmentId: byKey.get('locked')!.id, reason: 'locked' },
      { segmentId: byKey.get('confirmed')!.id, reason: 'confirmed' },
      { segmentId: byKey.get('draft')!.id, reason: 'draft' },
      { segmentId: byKey.get('different')!.id, reason: 'different-target' },
      { segmentId: byKey.get('same-target')!.id, reason: 'same-target' },
    ])
    for (const segment of [byKey.get('other-tags')!, byKey.get('other-whitespace')!, byKey.get('other-locale')!, otherBatch]) {
      assert.equal(db.segments.getById(segment.id)!.target, '')
      assert.equal(db.segments.getById(segment.id)!.revision, 0)
    }
    const event = db.runs.listEvents(0, 100).at(-1)!
    assert.equal(event.runId, saved.repetition.runId)
    assert.deepEqual(event.segmentIds, [primary.id, ...saved.repetition.updatedSegmentIds])
    const beforeConflict = db.segments.query()
    assert.throws(() => service.editSegment(project.id, primary.id, 'Stale {0}', disabled.segment.revision, { propagateRepeated: true }))
    assert.deepEqual(db.segments.query(), beforeConflict)
    assert.equal(db.runs.getRunChangeSummary(saved.repetition.runId).changes.total, 4)

    service.confirmCurrentStage(project.id, sameBefore.id, 1)
    service.editSegment(project.id, laterEdit.id, 'Later {0}', 1)
    const undone = db.runs.undoRun(saved.repetition.runId, { actorId: 'synthetic-user', excludedSegmentIds: [empty.id] })
    assert.equal(undone.status, 'partial')
    assert.deepEqual(undone.reverted.map(item => item.entityId), [restore.id])
    assert.deepEqual(new Set(undone.refused.map(item => item.entityId)), new Set([empty.id, sameBefore.id, laterEdit.id]))
    assert.deepEqual(db.segments.getById(restore.id), restore)
    assert.deepEqual(db.segments.listRevisions(restore.id), [])
    assert.equal(db.segments.getById(primary.id)!.target, 'New {0}')
    assert.equal(db.segments.getById(sameBefore.id)!.currentStageState, 'confirmed')
    assert.equal(db.segments.getById(laterEdit.id)!.target, 'Later {0}')
    assert.equal(db.segments.getById(empty.id)!.target, 'New {0}')
    const retry = db.runs.undoRun(saved.repetition.runId, { actorId: 'synthetic-user' })
    assert.deepEqual(retry.reverted.map(item => item.entityId), [empty.id])
    assert.deepEqual(db.segments.getById(empty.id), empty)

    const unsafe = service.editSegment(project.id, byKey.get('unsafe-primary')!.id, 'Missing placeholder', 0, { propagateRepeated: true })
    assert.equal(unsafe.segment.target, 'Missing placeholder')
    assert.deepEqual(unsafe.repetition!.updatedSegmentIds, [])
    assert.deepEqual(unsafe.repetition!.skipped, [{ segmentId: byKey.get('unsafe-repeat')!.id, reason: 'unsafe-target' }])
    assert.equal(db.segments.getById(byKey.get('unsafe-repeat')!.id)!.target, '')
    assert.equal(db.runs.getLatestRunChangeSummary()?.runId, saved.repetition.runId, 'zero propagated edits must not replace the latest reversible run')
  } finally {
    service.closeAll()
    rmSync(root, { recursive: true, force: true })
  }
})

test('working JSON reports the filename and shared limit before reading an oversized sparse file', () => {
  const root = mkdtempSync(join(tmpdir(), 'la-working-limit-'))
  try {
    const path = join(root, 'oversized.json')
    writeFileSync(path, '{}')
    truncateSync(path, LINGUIST_FILE_MAX_BYTES + 1)
    assert.throws(() => readWorkingJson(root, 'oversized.json'), error => error instanceof LinguistImportTooLargeError && error.filename === 'oversized.json' && error.limitBytes === LINGUIST_FILE_MAX_BYTES)
  } finally { rmSync(root, { recursive: true, force: true }) }
})

test('working copies preserve original bytes, explicit decisions and T→E→P revision identity', async () => {
  const root = mkdtempSync(join(tmpdir(), 'la-dsh-working-copy-'))
  try {
    const source = 'key,source,target\na,开始,Begin\nb,取消,Cancel\n'
    writeFileSync(join(root, 'input.csv'), source)
    const params = { sourcePath: 'input.csv', sourceLocale: 'zh-CN', targetLocale: 'en-US' }
    const baseline = await prepareWorkingCopy({ ...params, workspaceRoot: root })
    assert.equal(baseline.segments.length, 2)
    const [a, b] = baseline.segments
    assert.ok(a && b)
    writeFileSync(join(root, 'decisions.json'), JSON.stringify({
      sourceSha256: baseline.sourceSha256,
      groups: [{ segmentIds: [a.id], decision: 'corrected' }, { segmentIds: [b.id], decision: 'unchanged' }],
      edits: [{ segmentId: a.id, target: 'Start' }],
      unresolved: [],
    }))
    const t = await executeWorkingCopyAction({ ...params, operation: 'assemble', decisionsPath: 'decisions.json' }, () => ({ workspaceRoot: root, sessionId: 'T' }))
    const prior = readWorkingJson(root, t.path)
    assert.equal(prior.sha256, t.artifactSha256)
    writeFileSync(join(root, 'decisions.json'), JSON.stringify({
      sourceSha256: baseline.sourceSha256,
      previousResultSha256: t.artifactSha256,
      groups: [{ segmentIds: [a.id], decision: 'unchanged' }, { segmentIds: [b.id], decision: 'corrected' }],
      edits: [{ segmentId: b.id, target: 'Cancel.' }],
      unresolved: [],
    }))
    const e = await executeWorkingCopyAction({ ...params, operation: 'assemble', decisionsPath: 'decisions.json', previousResultPath: t.path }, () => ({ workspaceRoot: root, sessionId: 'E' }))
    const result = JSON.parse(readFileSync(join(root, e.path), 'utf8'))
    assert.deepEqual(result.segments.map((segment: { target: string }) => segment.target), ['Start', 'Cancel.'])
    assert.equal(result.changes.length, 1)
    assert.equal(result.finalChanges.length, 2)
    assert.deepEqual(result.coverage, { total: 2, unchanged: 1, corrected: 1, blocked: 0, undecided: 0 })
    assert.equal(readFileSync(join(root, 'input.csv'), 'utf8'), source)
    symlinkSync(tmpdir(), join(root, 'outside'))
    assert.throws(() => workingCopyPath(root, 'outside'), /工作文件不在/)
    await assert.rejects(
      executeWorkingCopyAction({ ...params, operation: 'assemble', decisionsPath: 'decisions.json', previousResultPath: e.path }, () => ({ workspaceRoot: root, sessionId: 'P' })),
      /审读快照/,
    )
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('project brief derives current and stale requirements without rewriting workspace files', () => {
  const root = mkdtempSync(join(tmpdir(), 'la-dsh-brief-'))
  const identity = { projectId: 'synthetic-project', sourceLocale: 'zh-CN', targetLocale: 'en-US' }
  const guide = 'Synthetic tutorial instruction.'
  const sourceVersion = createHash('sha256').update(guide).digest('hex')
  try {
    mkdirSync(join(root, '.linguist'))
    writeFileSync(join(root, 'guide.md'), guide)
    const brief: ProjectBrief = {
      schemaVersion: 1, projectIdentity: identity, purpose: 'Synthetic tutorial',
      sources: [{ ref: 'workspace-file:guide.md', version: sourceVersion, coverage: 'complete' }],
      requirements: [{ id: 'guide', statement: guide, appliesTo: { textTypes: ['tutorial'] }, strength: 'required', sourceRefs: [{ ref: 'workspace-file:guide.md', version: sourceVersion }] }],
      referenceRoutes: [], unresolved: [],
    }
    const file = join(root, PROJECT_BRIEF_PATH)
    writeFileSync(file, JSON.stringify(brief))
    const resolveSource = (ref: string) => readWorkspaceBriefSource(root, ref)
    assert.match(readProjectBrief({ workspaceRoot: root, identity, resolveSource })!.lines.join('\n'), /\[current:guide\]/)
    writeFileSync(join(root, 'guide.md'), 'Changed synthetic instruction.')
    const stale = readProjectBrief({ workspaceRoot: root, identity, resolveSource })!
    assert.match(stale.lines.join('\n'), /\[stale:guide\]/)
    assert.doesNotMatch(stale.lines.find(line => line.startsWith('- [stale:guide]'))!, /Synthetic tutorial instruction/)
    assert.equal(readFileSync(file, 'utf8'), JSON.stringify(brief))
    assert.throws(() => readProjectBrief({ workspaceRoot: root, identity: { ...identity, projectId: 'another-project' }, resolveSource }), /身份或语言对/)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
