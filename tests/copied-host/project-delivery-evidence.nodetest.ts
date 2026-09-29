import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createSeededEntropy, createStageEvidenceBaseline, type ProjectId, type StageEvidencePlan } from '../../packages/linguist-cat-core/src/index.ts'
import { CatStore } from '../../packages/linguist-cat-store/src/index.ts'
import { CatFormatRegistry, JsonAdapter } from '../../packages/linguist-cat-formats/src/index.ts'
import { ProjectDelivery, summarizeDeliveryEvidence } from '../../packages/linguist-domain-service/src/project-delivery.ts'
import { readLinguistExportManifests, recordLinguistExportManifest } from '../../packages/linguist-domain-service/src/export-manifest.ts'
import { projectPaths } from '../../packages/linguist-domain-service/src/paths.ts'
import { computeLinguistProjectRevision } from '../../packages/linguist-domain-service/src/project-revision.ts'
import { makeImportedAsset } from '../../packages/linguist-cat-store/src/testkit.ts'
import { LinguistProjectService } from '../../packages/linguist-domain-service/src/project-service.ts'

test('异步导出期间修改项目，清单仍标注实际导出快照的 revision', async () => {
  const rootDir = mkdtempSync(join(tmpdir(), 'delivery-revision-'))
  const store = new CatStore({ rootDir, entropy: createSeededEntropy('delivery-revision') })
  const project = store.createProject({ name: 'Revision', sourceLocale: 'en', targetLocale: 'zh-CN' })
  const db = store.openProject(project.id)
  try {
    const adapter = new JsonAdapter()
    const bytes = new TextEncoder().encode('[{"id":"one","source":"Hello","target":"你好"}]')
    const imported = await adapter.import({ bytes, filename: 'sample.json', sourceLocale: 'en', targetLocale: 'zh-CN' })
    const { asset, segments } = db.assets.insertImported(imported)
    db.saveAssetSourceForImport(asset, bytes)
    const revisionBefore = computeLinguistProjectRevision(project, db)
    const delivery = new ProjectDelivery({
      rootDir,
      now: () => new Date().toISOString(),
      registry: new CatFormatRegistry().register(adapter),
      getProject: id => store.getProject(id),
      getProjectPaths: id => projectPaths(rootDir, id),
      openProject: () => db,
      assertProjectWritable: () => {},
      call: fn => fn(),
    })
    const normal = await delivery.stageExport(project.id, asset.id)
    assert.equal(readLinguistExportManifests(projectPaths(rootDir, project.id).exportsDir).get(normal.artifact.id)?.projectRevision, revisionBefore)

    let finish!: () => void
    const blocked = new Promise<void>(resolve => { finish = resolve })
    const exportOriginal = adapter.export.bind(adapter)
    adapter.export = async input => { await blocked; return exportOriginal(input) }
    const pending = delivery.stageExport(project.id, asset.id)
    db.segments.applyTargetEdit(segments[0]!.id, '您好', 0)
    finish()
    const staged = await pending
    assert.equal(readFileSync(staged.stagingPath, 'utf8'), new TextDecoder().decode(bytes))
    const manifest = readLinguistExportManifests(projectPaths(rootDir, project.id).exportsDir).get(staged.artifact.id)!
    assert.equal(manifest.projectRevision, revisionBefore)
    assert.notEqual(manifest.projectRevision, computeLinguistProjectRevision(project, db))
  } finally {
    db.close()
    rmSync(rootDir, { recursive: true, force: true })
  }
})

test('导出引用阻止撤销导入，拒绝时保留资产、原件、导出记录和历史', async () => {
  const rootDir = mkdtempSync(join(tmpdir(), 'delivery-undo-'))
  const service = new LinguistProjectService({ rootDir, applicationVersion: 'synthetic-test' })
  service.init()
  try {
    const project = await service.createProject({ name: 'Synthetic undo protection', sourceLocale: 'en', targetLocale: 'zh-CN' })
    const imported = await service.importAsset(project.id, {
      filename: 'exported.json', bytes: new TextEncoder().encode('[{"id":"one","source":"Open","target":"打开"}]'),
    })
    assert.equal(imported.status, 'imported')
    assert(imported.assetId)
    const db = service.openProject(project.id)
    const assetId = imported.assetId
    const staged = await service.stageExport(project.id, assetId)
    const original = db.readAssetSource(assetId)
    const segments = db.segments.query({ assetId })
    const exports = db.exports.listByAsset(assetId)
    const manifest = readLinguistExportManifests(service.getProjectPaths(project.id).exportsDir)
    const events = db.runs.listEvents()
    assert.equal(exports.length, 1)
    assert.equal(db.proposals.countByAsset(assetId), 0)
    assert.equal(db.qaFindings.count({ assetId }), 0)
    assert.equal(db.segments.countEditedByAsset(assetId), 0)
    assert.equal(db.runs.countReferencingAsset(assetId), 0)
    // Export is the sole blocker; no other reference can accidentally mask a lost export check.
    for (let attempt = 0; attempt < 2; attempt++) {
      assert.throws(() => service.undoImportAsset(project.id, assetId), (error: unknown) => {
        assert.equal((error as { code: string }).code, 'IMPORT_UNDO_BLOCKED')
        assert.equal((error as { references: { exports: number } }).references.exports, 1)
        return true
      })
      assert.deepEqual(db.segments.query({ assetId }), segments)
      assert.deepEqual(db.readAssetSource(assetId), original)
      assert.deepEqual(db.exports.listByAsset(assetId), exports)
      assert.deepEqual(db.runs.listEvents(), events)
      assert.deepEqual(readLinguistExportManifests(service.getProjectPaths(project.id).exportsDir), manifest)
      assert.deepEqual(readFileSync(staged.stagingPath), original)
    }

    const edited = service.editSegment(project.id, segments[0]!.id, '开启', segments[0]!.revision)
    const revisions = db.segments.listRevisions(edited.id)
    const editedEvents = db.runs.listEvents()
    assert.equal(revisions.length, 1)
    assert.throws(() => service.undoImportAsset(project.id, assetId), (error: unknown) => {
      const blocked = error as { code: string; references: { exports: number; editedSegments: number } }
      assert.equal(blocked.code, 'IMPORT_UNDO_BLOCKED')
      assert.equal(blocked.references.exports, 1)
      assert.equal(blocked.references.editedSegments, 1)
      return true
    })
    assert.deepEqual(db.segments.listRevisions(edited.id), revisions)
    assert.deepEqual(db.runs.listEvents(), editedEvents)
    assert.equal(db.segments.getById(edited.id)?.target, '开启')
    assert.deepEqual(db.exports.listByAsset(assetId), exports)
    assert.deepEqual(db.readAssetSource(assetId), original)

    const pristine = await service.importAsset(project.id, {
      filename: 'pristine.json', bytes: new TextEncoder().encode('[{"id":"two","source":"Close","target":"关闭"}]'),
    })
    assert(pristine.assetId)
    const undone = service.undoImportAsset(project.id, pristine.assetId)
    assert.equal(undone.deletedSegments, 1)
    assert.equal(undone.sourceBlobRemoved, true)
    assert.equal(db.assets.get(pristine.assetId), undefined)
    assert.equal(db.segments.count({ assetId: pristine.assetId }), 0)
    assert.equal(db.exports.listByAsset(assetId).length, 1)
  } finally {
    service.closeAll()
    rmSync(rootDir, { recursive: true, force: true })
  }
})

test('交付按句段选择当前任务；小范围不能掩盖旧缺口，完整替代后旧 stale 不再污染', () => {
  const rootDir = mkdtempSync(join(tmpdir(), 'delivery-scopes-'))
  const store = new CatStore({ rootDir, entropy: createSeededEntropy('delivery-scopes') })
  const project = store.createProject({ name: 'Scopes', sourceLocale: 'en', targetLocale: 'zh-CN' })
  const db = store.openProject(project.id)
  try {
    const imported = db.assets.insertImported(makeImportedAsset({ segmentCount: 2, fillEvery: 1 }))
    const ids = imported.segments.map(segment => segment.id)
    const start = (id: string, scope: string[], complete: boolean): void => {
      const evidence = { ref: { kind: 'asset' as const, id: imported.asset.id }, version: imported.asset.sourceSha256 }
      const plan: StageEvidencePlan = { stageRunId: id, role: 'reviewer', stage: 'editing', assetIds: [imported.asset.id], segmentIds: scope,
        requirements: [{ evidence, purpose: 'source-authority', requiredness: 'required', scope: { kind: 'segments', segmentIds: scope }, anchorIds: [], rationale: 'source' }] }
      const baseline = createStageEvidenceBaseline({ stageRunId: id, discoveryScopeHash: 'scope', mappingRevision: '1', ruleSetRevision: '1', segmentIds: scope, evidence: [evidence] })
      db.stageEvidence.create({ stageRunId: id, sessionId: 'reviewer', plan, baseline })
      if (!complete) return
      for (const segmentId of scope) db.segments.recordCurrentStageDecision(segmentId, 'editing', 0, 'unchanged', { actor: 'reviewer' })
      db.stageEvidence.recordReceipt({ stageRunId: id, baselineHash: baseline.baselineHash, sessionId: 'reviewer', generationRunId: id, segmentIds: scope,
        evidence: [{ ref: evidence.ref, version: evidence.version, anchorIds: [], submission: 'provider-response-v1' }] })
    }
    start('old', ids, false)
    db.stageEvidence.markStale('old', '参考版本变化')
    start('new-first', [ids[0]!], true)
    assert.equal(summarizeDeliveryEvidence(db, imported.asset.id, 'editing').status, 'stale')
    start('new-second', [ids[1]!], true)
    assert.equal(summarizeDeliveryEvidence(db, imported.asset.id, 'editing').status, 'complete')
    db.stageEvidence.getCompletion('old')
    assert.equal(summarizeDeliveryEvidence(db, imported.asset.id, 'editing').status, 'complete')
    start('restart-first', [ids[0]!], false)
    assert.equal(summarizeDeliveryEvidence(db, imported.asset.id, 'editing').status, 'in-progress')
  } finally { db.close(); rmSync(rootDir, { recursive: true, force: true }) }
})

test('交付证据汇总只阻断显式 blocking Gap，未映射 warning 仅随清单提醒', () => {
  const rootDir = mkdtempSync(join(tmpdir(), 'delivery-evidence-'))
  const store = new CatStore({
    rootDir,
    entropy: createSeededEntropy('delivery-evidence'),
  })
  const project = store.createProject({
    name: 'Delivery Evidence',
    sourceLocale: 'zh-CN',
    targetLocale: 'en',
  })
  const db = store.openProject(project.id)
  try {
    const imported = db.assets.insertImported({
      asset: {
        formatId: 'fixture',
        originalFilename: 'batch.xlf',
        sourceSha256: 'a'.repeat(64),
        segmentCount: 1,
      },
      segments: [{
        ordinal: 0,
        key: 'one',
        source: '一',
        target: 'One',
        sourceLocale: 'zh-CN',
        targetLocale: 'en',
        status: 'translated',
        locked: false,
        revision: 0,
        sourceHash: 'one',
      }],
      warnings: [],
      originalBytes: new Uint8Array([1]),
    })
    const segmentId = imported.segments[0]!.id
    const stageRunId = 'stage-delivery'
    const requirement = {
      evidence: { ref: { kind: 'asset' as const, id: imported.asset.id }, version: imported.asset.sourceSha256 },
      purpose: 'source-authority' as const,
      requiredness: 'required' as const,
      scope: { kind: 'assets' as const, assetIds: [imported.asset.id] },
      anchorIds: [],
      rationale: '主批次 Source',
    }
    const plan: StageEvidencePlan = {
      stageRunId,
      role: 'reviewer',
      stage: 'editing',
      assetIds: [imported.asset.id],
      segmentIds: [segmentId],
      requirements: [requirement],
    }
    const baseline = createStageEvidenceBaseline({
      stageRunId,
      discoveryScopeHash: 'scope',
      mappingRevision: 'mapping',
      ruleSetRevision: 'rules',
      segmentIds: plan.segmentIds,
      evidence: [requirement.evidence],
    })
    db.stageEvidence.create({ stageRunId, sessionId: 'reviewer', plan, baseline })
    db.segments.recordCurrentStageDecision(segmentId, 'editing', 0, 'unchanged', { actor: 'reviewer' })
    db.stageEvidence.recordReceipt({
      stageRunId,
      baselineHash: baseline.baselineHash,
      sessionId: 'reviewer',
      generationRunId: 'generation',
      segmentIds: [segmentId],
      evidence: [{ ref: requirement.evidence.ref, anchorIds: [], version: requirement.evidence.version, submission: 'provider-response-v1' }],
    })
    db.stageEvidence.replaceStageGaps(stageRunId, [{
      id: 'gap-pm-confirm',
      code: 'UNMAPPED_CLIENT_VISIBLE_CONTENT',
      severity: 'warning',
      summary: '伴生表有未映射行',
      suggestedAction: '向 PM 确认，不自行改 CAT 文件',
    }])

    const warningOnly = summarizeDeliveryEvidence(db, imported.asset.id, 'editing')
    assert.equal(warningOnly.status, 'complete')
    assert.deepEqual(warningOnly.gaps.map((gap) => gap.severity), ['warning'])

    db.stageEvidence.replaceStageGaps(stageRunId, [{
      id: 'gap-required',
      code: 'REQUIRED_RESOURCE_MISSING',
      severity: 'blocking',
      summary: '用户声明的必需资料缺失',
      suggestedAction: '补充或显式豁免',
    }])
    assert.equal(summarizeDeliveryEvidence(db, imported.asset.id, 'editing').status, 'blocked')
  } finally {
    db.close()
    rmSync(rootDir, { recursive: true, force: true })
  }
})

test('Export Manifest 区分 verified/as-is 并持久化非阻断证据提醒', t => {
  const root = mkdtempSync(join(tmpdir(), 'delivery-manifest-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const stagingPath = join(root, 'staged.xlf')
  writeFileSync(stagingPath, 'result')
  const artifactId = `exp_v2_${'b'.repeat(64)}`
  const assetId = `ast_v2_${'a'.repeat(64)}`
  recordLinguistExportManifest({
    exportsDir: root,
    stagingPath,
    artifact: {
      id: artifactId,
      projectId: `prj_v2_${'c'.repeat(64)}` as ProjectId,
      assetId,
      path: 'exports/staged.xlf',
      sha256: 'd'.repeat(64),
      segmentCount: 1,
      createdAt: '2026-08-28T00:00:00.000Z',
    },
    projectRevision: `rev-${'e'.repeat(64)}`,
    validation: 'as-is',
    evidence: {
      status: 'complete',
      stageRuns: 1,
      required: 1,
      presented: 1,
      pending: 0,
      gaps: [{
        code: 'UNMAPPED_CLIENT_VISIBLE_CONTENT',
        severity: 'warning',
        summary: '伴生表有未映射行',
        suggestedAction: '向 PM 确认',
      }],
    },
  })

  const manifest = readLinguistExportManifests(root).get(artifactId)
  assert.equal(manifest?.validation, 'as-is')
  assert.equal(manifest?.evidence?.gaps[0]?.severity, 'warning')
})

test('QA 查询保持批次范围并拒绝跨批次片段与无效批次', async () => {
  const { ProjectQuality } = await import('../../packages/linguist-domain-service/src/project-quality.ts')
  const rootDir = mkdtempSync(join(tmpdir(), 'qa-batch-scope-'))
  const store = new CatStore({ rootDir, entropy: createSeededEntropy('qa-batch-scope') })
  const project = store.createProject({ name: 'QA Scope', sourceLocale: 'en', targetLocale: 'zh-CN' })
  const db = store.openProject(project.id)
  try {
    const batches = []
    for (const filename of ['a.json', 'b.json']) {
      const imported = await new JsonAdapter().import({ bytes: new TextEncoder().encode('[{"source":"Number 123","target":"数字 456"}]'),
        filename, sourceLocale: 'en', targetLocale: 'zh-CN' })
      batches.push(db.assets.insertImported(imported))
    }
    const quality = new ProjectQuality({ rootDir, now: () => new Date().toISOString(), registry: new CatFormatRegistry(),
      getProject: id => store.getProject(id), getProjectPaths: id => projectPaths(rootDir, id),
      openProject: () => db, assertProjectWritable: () => {}, call: fn => fn() })
    for (const batch of batches) quality.runQa(project.id, batch.asset.id)
    const a = batches[0]!
    const b = batches[1]!
    const scoped = quality.listQaFindings(project.id, { assetId: a.asset.id })
    assert.ok(scoped.total > 0)
    assert.ok(scoped.items.every(item => item.segmentId === a.segments[0]!.id))
    assert.equal(quality.listQaFindings(project.id).total, scoped.total * 2)
    assert.throws(() => quality.listQaFindings(project.id, { assetId: a.asset.id, segmentId: b.segments[0]!.id }))
    assert.throws(() => quality.listQaFindings(project.id, { assetId: 'missing' }))
  } finally { db.close(); rmSync(rootDir, { recursive: true, force: true }) }
})
