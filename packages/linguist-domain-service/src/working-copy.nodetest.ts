import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { LinguistProjectService } from './project-service'
import { executeWorkingCopyAction, type WorkingCopyContext } from './working-copy-service'
import { readWorkingJson, type LinguistWorkingCopy } from './working-copy'

test('bound working copies share CAT identities and deliver reviewed targets in the original format', async () => {
  const root = mkdtempSync(join(tmpdir(), 'la-working-delivery-'))
  const service = new LinguistProjectService({ rootDir: join(root, 'cat'), applicationVersion: 'synthetic-test' })
  service.init()
  const original = 'key,source,target\na,开始,Begin\nb,取消,Cancel\n'
  writeFileSync(join(root, 'source.csv'), original)
  try {
    const project = await service.createProject({ name: 'Synthetic working copy', sourceLocale: 'zh-CN', targetLocale: 'en-US' })
    const context: WorkingCopyContext = { workspaceRoot: root, sessionId: 'actual-author', project: { service, projectId: project.id }, provenance: { runId: 'synthetic-run', toolCallId: 'synthetic-delivery' } }
    const events: unknown[] = []
    context.onMutation = event => events.push(event)
    const params = { sourcePath: 'source.csv', sourceLocale: 'zh-CN', targetLocale: 'en-US' }
    const prepared = await executeWorkingCopyAction({ ...params, operation: 'prepare' }, () => context)
    const baseline = readWorkingJson(root, prepared.path).value as LinguistWorkingCopy
    const db = service.openProject(project.id)
    assert.deepEqual(events, [{ kind: 'asset-updated' }])
    assert.deepEqual(baseline.segments, db.segments.query())
    const [a, b] = baseline.segments
    assert.ok(a && b)
    writeFileSync(join(root, 'decisions.json'), JSON.stringify({
      sourceSha256: prepared.sourceSha256, previousResultSha256: prepared.artifactSha256,
      groups: [{ segmentIds: [a.id], decision: 'corrected' }, { segmentIds: [b.id], decision: 'unchanged' }],
      edits: [{ segmentId: a.id, target: 'Start' }], unresolved: [],
    }))
    const assembled = await executeWorkingCopyAction({ ...params, operation: 'assemble', previousResultPath: prepared.path, decisionsPath: 'decisions.json' }, () => context)
    assert.equal((readWorkingJson(root, assembled.path).value as { finalChanges: Array<{ baseRevision: number }> }).finalChanges[0]!.baseRevision, a.revision)
    assert.equal(db.segments.getById(a.id)!.target, 'Begin', 'assemble remains a private draft')
    writeFileSync(join(root, 'decisions.json'), JSON.stringify({
      sourceSha256: prepared.sourceSha256, previousResultSha256: assembled.artifactSha256,
      groups: [{ segmentIds: [a.id, b.id], decision: 'unchanged' }], edits: [], unresolved: [],
    }))
    const delivered = await executeWorkingCopyAction({ ...params, operation: 'deliver', previousResultPath: assembled.path, decisionsPath: 'decisions.json' }, () => context)
    assert.match(delivered.path, /\.csv$/)
    assert.equal(readFileSync(join(root, delivered.path), 'utf8'), 'key,source,target\na,开始,Start\nb,取消,Cancel\n')
    assert.equal(readFileSync(join(root, 'source.csv'), 'utf8'), original)
    const current = db.segments.getById(a.id)!
    assert.equal(current.target, 'Start')
    assert.equal(current.revision, a.revision + 1)
    assert.equal(current.currentStageState, 'draft')
    assert.equal(db.proposals.listBySegment(a.id, 'accepted')[0]!.sessionId, context.sessionId)
    assert.equal(readWorkingJson(root, delivered.reviewPath!).sha256, delivered.reviewSha256)
    const retried = await executeWorkingCopyAction({ ...params, operation: 'deliver', previousResultPath: assembled.path, decisionsPath: 'decisions.json' }, () => context)
    assert.equal(retried.artifactSha256, delivered.artifactSha256)
    assert.equal(db.segments.getById(a.id)!.revision, current.revision)
    assert.equal(events.length, 2, 'replay and existing-source prepare cannot repeat mutation notifications')
    const refreshed = await executeWorkingCopyAction({ ...params, operation: 'prepare' }, () => context)
    assert.deepEqual((readWorkingJson(root, refreshed.path).value as LinguistWorkingCopy).segments, db.segments.query())
    assert.equal(db.runs.getLatestRunChangeSummary()!.canUndo, true)
    assert.equal(db.runs.undoRun(context.provenance!.runId, { actorId: 'synthetic-user' }).status, 'completed')
    assert.equal(db.segments.getById(a.id)!.target, 'Begin')
  } finally {
    service.closeAll()
    rmSync(root, { recursive: true, force: true })
  }
})

test('working delivery rejects incomplete review, stale CAT snapshots, damaged tags and locked edits', async () => {
  const root = mkdtempSync(join(tmpdir(), 'la-working-protection-'))
  const service = new LinguistProjectService({ rootDir: join(root, 'cat'), applicationVersion: 'synthetic-test' })
  service.init()
  writeFileSync(join(root, 'source.csv'), 'key,source,target,locked\na,开始 {0},Begin {0},false\nb,取消,Cancel,true\n')
  try {
    const project = await service.createProject({ name: 'Synthetic protected copy', sourceLocale: 'zh-CN', targetLocale: 'en-US' })
    const context: WorkingCopyContext = { workspaceRoot: root, sessionId: 'actual-author', project: { service, projectId: project.id }, provenance: { runId: 'synthetic-run', toolCallId: 'synthetic-delivery' } }
    const params = { sourcePath: 'source.csv', sourceLocale: 'zh-CN', targetLocale: 'en-US' }
    const prepared = await executeWorkingCopyAction({ ...params, operation: 'prepare' }, () => context)
    const [a, b] = (readWorkingJson(root, prepared.path).value as LinguistWorkingCopy).segments
    assert.ok(a && b)
    const decisions = {
      sourceSha256: prepared.sourceSha256, previousResultSha256: prepared.artifactSha256,
      groups: [{ segmentIds: [a.id], decision: 'unchanged' }], edits: [] as Array<{ segmentId: string; target: string }>, unresolved: [],
    }
    const execute = () => executeWorkingCopyAction({ ...params, operation: 'deliver', previousResultPath: prepared.path, decisionsPath: 'decisions.json' }, () => context)
    writeFileSync(join(root, 'decisions.json'), JSON.stringify(decisions))
    await assert.rejects(execute(), /完整.*裁定/)
    decisions.groups = [{ segmentIds: [a.id], decision: 'corrected' }, { segmentIds: [b.id], decision: 'unchanged' }]
    decisions.edits = [{ segmentId: a.id, target: 'Missing placeholder' }]
    writeFileSync(join(root, 'decisions.json'), JSON.stringify(decisions))
    await assert.rejects(execute(), /结构\/锁保护/)
    decisions.groups = [{ segmentIds: [a.id], decision: 'unchanged' }, { segmentIds: [b.id], decision: 'corrected' }]
    decisions.edits = [{ segmentId: b.id, target: 'Changed locked text' }]
    writeFileSync(join(root, 'decisions.json'), JSON.stringify(decisions))
    await assert.rejects(execute(), /结构\/锁保护/)
    service.editSegment(project.id, a.id, 'Current {0}', a.revision)
    decisions.groups = [{ segmentIds: [a.id], decision: 'corrected' }, { segmentIds: [b.id], decision: 'unchanged' }]
    decisions.edits = [{ segmentId: a.id, target: 'Stale replacement {0}' }]
    writeFileSync(join(root, 'decisions.json'), JSON.stringify(decisions))
    await assert.rejects(execute(), /原版本/)
    assert.equal(service.openProject(project.id).segments.getById(a.id)!.target, 'Current {0}')
    assert.equal(service.openProject(project.id).segments.getById(b.id)!.target, 'Cancel')
  } finally {
    service.closeAll()
    rmSync(root, { recursive: true, force: true })
  }
})

test('working delivery rolls back every batch when a later hard terminology check rejects an edit', async () => {
  const root = mkdtempSync(join(tmpdir(), 'la-working-atomic-'))
  const service = new LinguistProjectService({ rootDir: join(root, 'cat'), applicationVersion: 'synthetic-test' })
  service.init()
  writeFileSync(join(root, 'source.csv'), 'key,source,target\n' + Array.from({ length: 201 }, (_, index) => `${index},${index === 200 ? 'Restricted' : `Source ${index}`},Old\n`).join(''))
  try {
    const project = await service.createProject({ name: 'Synthetic atomic copy', sourceLocale: 'en-US', targetLocale: 'zh-CN' })
    const context: WorkingCopyContext = { workspaceRoot: root, sessionId: 'actual-author', project: { service, projectId: project.id }, provenance: { runId: 'synthetic-run', toolCallId: 'synthetic-delivery' } }
    const params = { sourcePath: 'source.csv', sourceLocale: 'en-US', targetLocale: 'zh-CN' }
    const prepared = await executeWorkingCopyAction({ ...params, operation: 'prepare' }, () => context)
    const baseline = readWorkingJson(root, prepared.path).value as LinguistWorkingCopy
    const db = service.openProject(project.id)
    db.termEntries.upsert({ term: 'Restricted', translation: '必须', status: 'required', caseSensitive: true })
    writeFileSync(join(root, 'decisions.json'), JSON.stringify({
      sourceSha256: prepared.sourceSha256, previousResultSha256: prepared.artifactSha256,
      groups: [{ segmentIds: baseline.segments.map(segment => segment.id), decision: 'corrected' }],
      edits: baseline.segments.map(segment => ({ segmentId: segment.id, target: `Changed ${segment.ordinal}` })), unresolved: [],
    }))
    await assert.rejects(executeWorkingCopyAction({ ...params, operation: 'deliver', previousResultPath: prepared.path, decisionsPath: 'decisions.json' }, () => context), /CAT 写回失败/)
    assert.deepEqual(db.segments.query(), baseline.segments)
    assert.equal(db.proposals.count(), 0)
    assert.equal(db.exports.listByProject().length, 0)
  } finally {
    service.closeAll()
    rmSync(root, { recursive: true, force: true })
  }
})
