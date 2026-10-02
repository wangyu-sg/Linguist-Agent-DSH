import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, truncateSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { executeWorkingCopyAction } from './working-copy-service'
import { prepareWorkingCopy, readWorkingJson, workingCopyPath } from './working-copy'
import { LinguistProjectService } from './project-service'
import { LINGUIST_FILE_MAX_BYTES } from './contracts'
import { LinguistImportTooLargeError } from './errors'
import { PROJECT_BRIEF_PATH, readProjectBrief, readWorkspaceBriefSource, type ProjectBrief } from './project-brief'

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
      edits: [{ segmentId: a.id, baseRevision: a.revision, target: 'Start' }],
      unresolved: [],
    }))
    const t = await executeWorkingCopyAction({ ...params, operation: 'assemble', decisionsPath: 'decisions.json' }, () => ({ workspaceRoot: root, sessionId: 'T' }))
    const prior = readWorkingJson(root, t.path)
    assert.equal(prior.sha256, t.artifactSha256)
    writeFileSync(join(root, 'decisions.json'), JSON.stringify({
      sourceSha256: baseline.sourceSha256,
      previousResultSha256: t.artifactSha256,
      groups: [{ segmentIds: [a.id], decision: 'unchanged' }, { segmentIds: [b.id], decision: 'corrected' }],
      edits: [{ segmentId: b.id, baseRevision: b.revision, target: 'Cancel.' }],
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
