import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { LinguistProjectService } from './project-service'
import { getProjectQuestionMaterials, syncProjectLibrary } from './project-library'
import { prepareReviewMaterials } from './review-materials'
import { executeWorkingCopyAction } from './working-copy-service'
import { readWorkingJson, type LinguistWorkingCopy } from './working-copy'

test('two groups isolate detached drafts, online jobs, current references and explicit CAT batch selections', async () => {
  const root = mkdtempSync(join(tmpdir(), 'la-scoped-workflows-'))
  const service = new LinguistProjectService({ rootDir: join(root, 'cat'), applicationVersion: 'synthetic' })
  service.init()
  try {
    const { id: projectId } = await service.createProject({ name: 'Fixture', sourceLocale: 'en', targetLocale: 'zh-CN' })
    await service.reviewCache.setEnabled(false)
    const db = service.openProject(projectId)
    const [a, b] = ['Alpha', 'Beta'].map(name => db.taskGroups.change({ action: 'create', name })) as [string, string]
    const sharedVoice = db.voiceProfiles.upsert({ speaker: 'NPC' })
    const firstVoice = db.voiceProfiles.upsert({ speaker: 'NPC', notes: 'A' }, a)
    const secondVoice = db.voiceProfiles.upsert({ speaker: 'NPC', notes: 'B' }, b)
    assert.equal(new Set([sharedVoice.id, firstVoice.id, secondVoice.id]).size, 3)
    assert.equal(db.voiceProfiles.upsert({ speaker: 'NPC' }, b).id, secondVoice.id)
    assert.throws(() => db.voiceProfiles.upsert({ id: firstVoice.id, speaker: 'NPC' }, b), /其他范围/)
    assert.throws(() => db.voiceProfiles.delete(sharedVoice.id, b), /其他范围/)
    const languages = { sourceLocale: 'en', targetLocale: 'zh-CN' }
    writeFileSync(join(root, 'source.csv'), 'key,source,target\none,Compass,Original target\n')
    writeFileSync(join(root, 'shared.txt'), 'Shared rule')
    writeFileSync(join(root, 'temporary.csv'), 'term,target\nCompass,Temporary term\n')
    await syncProjectLibrary(service, projectId, root, [{ kind: 'rules', path: 'shared.txt' }])
    for (const [group, label] of [[a, 'Alpha'], [b, 'Beta']] as const) {
      writeFileSync(join(root, label + '.txt'), label + ' rule')
      writeFileSync(join(root, label + '.csv'), 'term,target\nCompass,' + label + ' term\n')
      await syncProjectLibrary(service, projectId, root, [
        { kind: 'rules', path: label + '.txt' }, { kind: 'terms', path: label + '.csv' },
      ], { taskGroupId: group })
    }
    const source = { sourcePath: 'source.csv', ...languages }
    const ctx = (group: string) => ({ workspaceRoot: root, taskGroupId: group, sessionId: 'same-session', referenceProjectId: projectId, service })
    const [first, second] = await Promise.all([a, b].map(taskGroupId => executeWorkingCopyAction({ ...source, operation: 'prepare' }, () => ctx(taskGroupId))))
    const draft = readWorkingJson(root, first!.path).value as LinguistWorkingCopy
    const other = readWorkingJson(root, second!.path).value as LinguistWorkingCopy
    assert.notEqual(first!.path, second!.path)
    assert.notEqual(draft.batchId, other.batchId)
    assert.notEqual(draft.segments[0]!.id, other.segments[0]!.id)
    assert.equal(db.assets.countByProject(), 0)
    assert.equal(db.taskGroups.externalBatches().length, 2)
    const fileTask = { ...source, projectId, workspaceRoot: root, taskId: 'same-task', referenceFiles: [{ kind: 'terms' as const, path: 'temporary.csv' }] }
    await assert.rejects(prepareReviewMaterials(service, { ...fileTask, previousResultPath: first!.path, taskGroupId: b }), /任务组/)
    const pair = await Promise.all([a, b].map(taskGroupId => prepareReviewMaterials(service, { ...fileTask, taskGroupId })))
    const materials = (result: { readingPath: string }) => readFileSync(join(root, dirname(result.readingPath), 'materials.json'), 'utf8')
    assert.match(materials(pair[0]!), /Alpha term/)
    assert.doesNotMatch(materials(pair[0]!), /Beta (term|rule)/)
    assert.match(materials(pair[1]!), /Beta term/)
    assert.doesNotMatch(materials(pair[1]!), /Alpha (term|rule)/)
    for (const item of pair) { assert.match(materials(item), /Shared rule/); assert.match(materials(item), /Temporary term/) }
    writeFileSync(join(root, 'Alpha.csv'), 'term,target\nCompass,Updated Alpha term\n')
    const warm = await prepareReviewMaterials(service, { ...fileTask, taskGroupId: a })
    assert.match(materials(warm), /Updated Alpha term/)
    const common = await getProjectQuestionMaterials(service, projectId, root, 'Compass')
    assert.match(JSON.stringify(common), /Shared rule/)
    assert.doesNotMatch(JSON.stringify(common), /(Alpha|Beta) (term|rule)/)

    writeFileSync(join(root, 'platform.json'), JSON.stringify({ segments: [{ id: 'stable-row', ordinal: 0, source: 'Compass', target: 'On platform', locked: true }] }))
    const online = { url: 'https://example.test/editor', fileId: 'job-1', expectedSegments: 1, observedAt: '2026-01-01T00:00:00Z' }
    for (const group of [a, b]) {
      const request = { workspaceRoot: root, taskId: 'online', projectId, taskGroupId: group, snapshotPath: 'platform.json', online }
      const read = await prepareReviewMaterials(service, request)
      assert.equal(read.batchId, (await prepareReviewMaterials(service, request)).batchId)
      assert.match(materials(read), group === a ? /Updated Alpha term/ : /Beta term/)
      assert.doesNotMatch(materials(read), group === a ? /Beta term/ : /Alpha term/)
    }
    assert.equal(db.taskGroups.externalBatches().filter(batch => batch.kind === 'browser').length, 2)
    assert.equal(db.assets.countByProject(), 0)
    const imported = await service.importAsset(projectId, { taskGroupId: b, filename: 'source.csv', bytes: readFileSync(join(root, 'source.csv')) })
    const cat = await prepareReviewMaterials(service, { workspaceRoot: root, taskId: 'cat', projectId, taskGroupId: a, batchIds: [imported.assetId] })
    const firstAsset = await service.importAsset(projectId, { taskGroupId: a, filename: 'source.csv', bytes: readFileSync(join(root, 'source.csv')) })
    await assert.rejects(executeWorkingCopyAction({ ...source, operation: 'prepare' }, () => ({
      ...ctx(a), project: { service, projectId }, delegatedSegmentIds: [],
    })), /整份工作稿超过/)
    const [rowA] = db.segments.queryIds({ assetId: firstAsset.assetId })
    const [rowB] = db.segments.queryIds({ assetId: imported.assetId })
    const allowedDraft = await executeWorkingCopyAction({ ...source, operation: 'prepare' }, () => ({
      ...ctx(a), sessionId: 'full-batch-delegate', project: { service, projectId }, delegatedSegmentIds: [rowA!],
    }))
    assert.equal((readWorkingJson(root, allowedDraft.path).value as LinguistWorkingCopy).assetId, firstAsset.assetId)
    for (const [runId, segmentIds] of [['run-a', [rowA!]], ['run-b', [rowB!]], ['mixed', [rowA!, rowB!]]] as const) {
      db.runs.createJob({ runId, jobId: runId, sessionId: 'fixture', strategy: 'fast', segmentIds, provenance: { schemaVersion: 1, runtime: 'fixture' } })
    }
    assert.equal(db.runs.getLatestRunChangeSummary(a)?.runId, 'run-a')
    assert.equal(db.runs.getLatestRunChangeSummary(b)?.runId, 'run-b')
    assert.equal(db.runs.getLatestRunChangeSummary()?.runId, 'mixed')
    assert.match(materials(cat), /Beta term/)
    assert.doesNotMatch(materials(cat), /Alpha term/)
    const locator = JSON.stringify([new URL(online.url).origin, online.fileId])
    const platformId = db.taskGroups.findRegisteredBatch(b, 'browser', locator)!.id
    const linked = await prepareReviewMaterials(service, {
      ...source, workspaceRoot: root, taskId: 'online', projectId, taskGroupId: b, online,
    })
    assert.equal(linked.batchId, imported.assetId)
    assert.equal(db.taskGroups.externalBatches().filter(batch => batch.kind === 'browser').length, 1)
    const third = db.taskGroups.change({ action: 'create', name: 'Archive review' })
    db.taskGroups.change({ action: 'moveBatches', id: third, batchIds: [firstAsset.assetId] })
    await assert.rejects(prepareReviewMaterials(service, { ...fileTask, previousResultPath: first!.path, taskGroupId: a }), /归属已变化/)
    assert.equal(db.taskGroups.findRegisteredBatch(a, 'working-copy', draft.sourceSha256), undefined)
    const detached = db.taskGroups.registerBatch(a, 'working-copy', draft.sourceSha256, 'source.csv')
    assert.throws(() => db.taskGroups.change({ action: 'moveBatches', id: a, batchIds: [platformId] }), /同一原稿/)
    assert.throws(() => db.taskGroups.change({ action: 'moveBatches', id: b, batchIds: [detached] }), /同一原稿/)
    assert.equal(db.taskGroups.groupOf(detached), a)
    assert.equal(db.taskGroups.groupOf(imported.assetId), b)
    const different = db.taskGroups.registerBatch(a, 'working-copy', 'e'.repeat(64), 'source.csv')
    db.taskGroups.change({ action: 'moveBatches', id: b, batchIds: [different] })
    assert.equal(db.taskGroups.groupOf(different), b)
    db.taskGroups.change({ action: 'moveBatches', id: 'ungrouped', batchIds: [platformId] })
    assert.equal(db.taskGroups.groupOf(imported.assetId), 'ungrouped')
    assert.equal(db.taskGroups.findRegisteredBatch('ungrouped', 'browser', locator)?.assetId, imported.assetId)
    assert.equal(db.taskGroups.findRegisteredBatch(b, 'browser', locator), undefined)
    const aVersion = db.taskGroups.materialVersion(a)
    const bVersion = db.taskGroups.materialVersion(b)
    db.voiceProfiles.upsert({ id: firstVoice.id, speaker: 'NPC', notes: 'New voice' }, a)
    assert.notEqual(aVersion, db.taskGroups.materialVersion(a))
    assert.equal(bVersion, db.taskGroups.materialVersion(b))
  } finally { service.closeAll(); rmSync(root, { recursive: true, force: true }) }
})
