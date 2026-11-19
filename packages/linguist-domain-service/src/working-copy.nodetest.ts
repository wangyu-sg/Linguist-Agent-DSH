import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import test, { mock } from 'node:test'

import { getWorkingCopyReferences } from './working-copy-references'
import type { WorkingCopyContext } from './working-copy-service'
import { readWorkingJson, type LinguistWorkingCopy } from './working-copy'

mock.module('./semantic-review', { namedExports: { getSemanticReview: async () => ({ status: 'failed', error: 'Synthetic test: local model unavailable' }) } })
const { LinguistProjectService } = await import('./project-service')
const { executeWorkingCopyAction } = await import('./working-copy-service')

test('working copy prepares and shares group references without a 50-segment model query', async t => {
  const root = mkdtempSync(join(tmpdir(), 'la-working-references-'))
  const service = new LinguistProjectService({ rootDir: join(root, 'cat'), applicationVersion: 'synthetic-test' })
  service.init()
  const rows = ['first,Collect 20 coins,Original synthetic,English UI requirement,scene-1',
    'second,Collect 20 coins,Another use,Independent description,scene-2',
    ...Array.from({ length: 59 }, (_, index) => `row${index},Synthetic source ${index},,,`)]
  rows[2] = `many,${Array.from({ length: 12 }, (_, i) => `term${i}`).join(' ')},,,`
  writeFileSync(join(root, 'source.csv'), `key,source,target,Description,RequestID\n${rows.join('\n')}\n`)
  try {
    const project = await service.createProject({ name: 'Synthetic references', sourceLocale: 'en', targetLocale: 'zh-CN' })
    const db = service.openProject(project.id)
    for (let index = 0; index < 25; index++) db.styleGuideRules.upsert({ ruleText: `Synthetic project rule ${index}` })
    for (let index = 0; index < 12; index++) db.termEntries.upsert({ term: `term${index}`, translation: `术语${index}`, status: 'allowed', caseSensitive: true })
    db.tmUnits.importMany([{ source: 'Collect 10 coins', target: '领取 10 金币', sourceLocale: 'en', targetLocale: 'zh-CN', sourceId: 'synthetic', occurrenceKey: 'one' }])
    await service.importReference(project.id, 'terms', { filename: 'synthetic-terms.csv', bytes: Buffer.from('source,target,note\ncoins,金币,Synthetic note\n') })
    const params = { sourcePath: 'source.csv', sourceLocale: 'en', targetLocale: 'zh-CN' }
    const translator: WorkingCopyContext = { workspaceRoot: root, sessionId: 'translator', taskId: 'synthetic-task', project: { service, projectId: project.id } }
    const started = performance.now()
    const prepared = await executeWorkingCopyAction({ ...params, operation: 'prepare' }, () => translator)
    const preparedAt = performance.now()
    const draft = readWorkingJson(root, prepared.path).value as LinguistWorkingCopy
    assert.equal(draft.segments[0]!.context!.meta!['column:4:Description'], 'English UI requirement')
    assert.equal(draft.segments[1]!.context!.meta!['column:4:Description'], 'Independent description')
    const longContext = 'Synthetic long contextual guidance. '.repeat(2_000)
    const doc = db.contextDocs.insert({ kind: 'doc', originalFilename: 'synthetic-context.txt', blobRelpath: 'synthetic-context.txt', textExtract: longContext })
    db.contextDocs.setEvidenceLink({ contextDocId: doc.id, relation: { kind: 'segment', segmentId: draft.segments[0]!.id }, requiredness: 'required', mappingRevision: 'synthetic' })
    const early = await executeWorkingCopyAction({ ...params, operation: 'references', previousResultPath: prepared.path, segmentIds: draft.segments.map(segment => segment.id), wait: false }, () => translator)
    const earlyItems = (readWorkingJson(root, early.path).value as any).items
    assert.ok(earlyItems.some((item: any) => item.status === 'pending'))
    assert.ok(earlyItems.filter((item: any) => item.status === 'pending').every((item: any) => item.tm === undefined))
    const first = await executeWorkingCopyAction({ ...params, operation: 'references', previousResultPath: prepared.path, segmentIds: [draft.segments[0]!.id] }, () => translator)
    const firstData = readWorkingJson(root, first.path).value as any
    assert.equal(firstData.items[0].status, 'ready')
    assert.equal(firstData.items[0].tm[0].adaptation.candidate, '领取 20 金币')
    assert.notEqual(firstData.items[0].tm[0].baseScore, 100)
    assert.equal(firstData.items[0].allowedTerms[0].note, 'Synthetic note')
    assert.equal(firstData.items[0].allowedTerms[0].sources[0].filename, 'synthetic-terms.csv')
    assert.equal(firstData.projectRules.length, 25)
    assert.equal((Object.values(firstData.shared.context) as Array<{ docId: string; text: string }>).find(entry => entry.docId === doc.id)!.text, longContext)
    t.diagnostic(`Synthetic 61-segment sample: prepare ${(preparedAt - started).toFixed(1)} ms; first reference group ${(performance.now() - started).toFixed(1)} ms`)
    const confirmed = db.segments.recordCurrentStageDecision(draft.segments[0]!.id, 'translation', draft.segments[0]!.revision, 'unchanged', { actor: 'translator' })
    db.tmUnits.addConfirmed(confirmed.segment, confirmed.event, 'synthetic-task')
    writeFileSync(join(root, 'translator-decisions.json'), JSON.stringify({ sourceSha256: prepared.sourceSha256, previousResultSha256: prepared.artifactSha256,
      groups: [{ segmentIds: [draft.segments[0]!.id], decision: 'corrected' }, { segmentIds: draft.segments.slice(1).map(segment => segment.id), decision: 'unchanged' }],
      edits: [{ segmentId: draft.segments[0]!.id, target: '领取 20 金币' }], unresolved: [] }))
    const translated = await executeWorkingCopyAction({ ...params, operation: 'assemble', previousResultPath: prepared.path, decisionsPath: 'translator-decisions.json' }, () => translator)
    assert.equal((readWorkingJson(root, translated.path).value as LinguistWorkingCopy).segments[0]!.target, '领取 20 金币')
    const reviewer: WorkingCopyContext = { ...translator, sessionId: 'reviewer' }
    const group = await executeWorkingCopyAction({ ...params, operation: 'references', previousResultPath: translated.path }, () => reviewer)
    const result = readWorkingJson(root, group.path).value as any
    assert.equal(result.items.length, 61)
    assert.ok(result.items.every((item: any) => item.status === 'ready'))
    assert.equal(result.items[2].allowedTerms.length, 12)
    assert.deepEqual(result.items.at(-1).tm, [])
    assert.ok(result.items[0].tm.some((item: any) => item.adaptation?.candidate === '领取 20 金币'))
    assert.ok(result.items[0].tm.some((item: any) => item.target === 'Original synthetic' && item.sameTask === true))
    assert.equal(result.workingCopySha256, translated.artifactSha256)
    assert.equal(result.items[0].currentTarget, '领取 20 金币')
    const readingRoot = dirname(join(root, group.readingPath!))
    assert.match(readFileSync(join(readingRoot, 'group-1.md'), 'utf8'), /领取 20 金币/)
    assert.match(readFileSync(join(readingRoot, 'cross-review.md'), 'utf8'), /相同原文/)
    assert.match(readFileSync(join(readingRoot, 'project-rules.md'), 'utf8'), /Synthetic project rule 24/)
    assert.ok(readFileSync(join(readingRoot, 'group-1.md'), 'utf8').includes(longContext))
    const term = db.termEntries.search({ query: 'coins' })[0]!
    const longNote = 'Changed synthetic note. '.repeat(2_000)
    db.termEntries.upsert({ ...term, note: longNote })
    const refreshed = await executeWorkingCopyAction({ ...params, operation: 'references', previousResultPath: translated.path, segmentIds: [draft.segments[0]!.id] }, () => reviewer)
    assert.equal((readWorkingJson(root, refreshed.path).value as any).items[0].allowedTerms[0].note, longNote)
    service.editSegment(project.id, draft.segments[0]!.id, 'Concurrent synthetic edit', draft.segments[0]!.revision)
    await assert.rejects(executeWorkingCopyAction({ ...params, operation: 'references', previousResultPath: translated.path, segmentIds: [draft.segments[0]!.id] }, () => reviewer), /原版本或锁不一致/)
  } finally { service.closeAll(); rmSync(root, { recursive: true, force: true }) }
})

test('working copy counts only saved TM reuse retained through independent review', async () => {
  const root = mkdtempSync(join(tmpdir(), 'la-working-reuse-'))
  const service = new LinguistProjectService({ rootDir: join(root, 'cat'), applicationVersion: 'synthetic-test' })
  service.init()
  writeFileSync(join(root, 'source.csv'), 'key,source,target\na,Collect 20 coins,\nb,Collect 30 coins,\n')
  try {
    const project = await service.createProject({ name: 'Synthetic reuse', sourceLocale: 'en', targetLocale: 'zh-CN' })
    const db = service.openProject(project.id)
    db.tmUnits.importMany([{ source: 'Collect 10 coins', target: '领取 10 金币', sourceLocale: 'en', targetLocale: 'zh-CN', sourceId: 'synthetic', occurrenceKey: 'one' }])
    const unitId = db.tmUnits.listCandidates('en', 'zh-CN', undefined, 'ungrouped')[0]!.unitId
    const params = { sourcePath: 'source.csv', sourceLocale: 'en', targetLocale: 'zh-CN' }
    const context: WorkingCopyContext = { workspaceRoot: root, sessionId: 'translator', taskId: 'synthetic-task', project: { service, projectId: project.id }, provenance: { runId: 'synthetic-run', toolCallId: 'synthetic-deliver' } }
    const prepared = await executeWorkingCopyAction({ ...params, operation: 'prepare' }, () => context)
    const [a, b] = (readWorkingJson(root, prepared.path).value as LinguistWorkingCopy).segments
    const decisions = (previousResultSha256: string, groups: unknown[], edits: unknown[], unresolved: string[] = []) => {
      writeFileSync(join(root, 'decisions.json'), JSON.stringify({ sourceSha256: prepared.sourceSha256, previousResultSha256, groups, edits, unresolved }))
    }
    decisions(prepared.artifactSha256, [{ segmentIds: [a!.id, b!.id], decision: 'corrected' }], [
      { segmentId: a!.id, target: '领取 20 金币', tmUnitId: unitId }, { segmentId: b!.id, target: '领取 30 金币', tmUnitId: unitId },
    ])
    const translated = await executeWorkingCopyAction({ ...params, operation: 'assemble', previousResultPath: prepared.path, decisionsPath: 'decisions.json' }, () => context)
    assert.equal(db.tmUnits.listCandidates('en', 'zh-CN', undefined, 'ungrouped')[0]!.localMetadata?.la_reuse_count, undefined)
    const reviewer = { ...context, sessionId: 'reviewer' }
    decisions(translated.artifactSha256, [{ segmentIds: [a!.id], decision: 'unchanged' }, { segmentIds: [b!.id], decision: 'corrected' }], [
      { segmentId: b!.id, target: '获得 30 金币' },
    ])
    const reviewed = await executeWorkingCopyAction({ ...params, operation: 'assemble', previousResultPath: translated.path, decisionsPath: 'decisions.json' }, () => reviewer)
    decisions(reviewed.artifactSha256, [{ segmentIds: [a!.id, b!.id], decision: 'unchanged' }], [], ['synthetic-blocker'])
    await assert.rejects(executeWorkingCopyAction({ ...params, operation: 'deliver', previousResultPath: reviewed.path, decisionsPath: 'decisions.json' }, () => reviewer), /没有阻断/)
    assert.equal(db.tmUnits.listCandidates('en', 'zh-CN', undefined, 'ungrouped')[0]!.localMetadata?.la_reuse_count, undefined)
    decisions(reviewed.artifactSha256, [{ segmentIds: [a!.id, b!.id], decision: 'unchanged' }], [])
    await executeWorkingCopyAction({ ...params, operation: 'deliver', previousResultPath: reviewed.path, decisionsPath: 'decisions.json' }, () => reviewer)
    await executeWorkingCopyAction({ ...params, operation: 'deliver', previousResultPath: reviewed.path, decisionsPath: 'decisions.json' }, () => reviewer)
    assert.equal(db.tmUnits.listCandidates('en', 'zh-CN', undefined, 'ungrouped')[0]!.localMetadata?.la_reuse_count, '1')
    assert.equal(db.segments.getById(b!.id)!.target, '获得 30 金币')
  } finally { service.closeAll(); rmSync(root, { recursive: true, force: true }) }
})

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

test('working reference worker reuses private-group changes and observes committed edits from another process', async () => {
  const root = mkdtempSync(join(tmpdir(), 'la-reference-clock-'))
  const service = new LinguistProjectService({ rootDir: root, applicationVersion: 'synthetic' })
  try {
    service.init()
    await service.reviewCache.setEnabled(false)
    const { id: projectId } = await service.createProject({ name: 'Reference revisions', sourceLocale: 'en', targetLocale: 'zh-CN' })
    const db = service.openProject(projectId)
    const a = db.taskGroups.change({ action: 'create', name: 'A' })
    const b = db.taskGroups.change({ action: 'create', name: 'B' })
    const file = { filename: 'same.csv', bytes: Buffer.from('key,source,target\na,Find the key,\n') }
    const first = await service.importAsset(projectId, { ...file, taskGroupId: a })
    const other = await service.importAsset(projectId, { ...file, taskGroupId: b })
    const ids = db.segments.queryIds({ assetId: first.assetId })
    const term = db.termEntries.upsert({ term: 'key', translation: '钥匙', status: 'preferred', caseSensitive: false, note: 'Original' }, a)
    db.tmUnits.importMany([{ source: 'Find the key', target: '找到钥匙', sourceLocale: 'en', targetLocale: 'zh-CN', sourceId: 'legacy-test', occurrenceKey: 'one' }])
    const doc = db.contextDocs.insert({ kind: 'doc', originalFilename: 'scene.txt', blobRelpath: 'scene.txt', textExtract: 'Cellar' })
    const read = async () => {
      const result = await getWorkingCopyReferences({ service, projectId, taskId: 'scope-test', sourceSha256: 'same',
        allIds: ids, selectedIds: ids, wait: true })
      const item = result.items[0]!
      assert.ok(item.status === 'ready')
      return item
    }
    const firstRead = await read()
    assert.equal(firstRead.preferredTerms[0]?.note, 'Original')
    assert.equal(firstRead.tm[0]?.target, '找到钥匙')
    const stageVersion = db.taskGroups.materialVersion(a)
    db.taskGroups.change({ action: 'rename', id: b, name: 'Other group' })
    const privateTerm = db.termEntries.upsert({ ...term, id: undefined, note: 'B only' }, b)
    db.contextDocs.setEvidenceLink({ contextDocId: doc.id, relation: { kind: 'asset', assetId: other.assetId }, requiredness: 'required', mappingRevision: 'b1' })
    assert.equal(await read(), firstRead)
    db.termEntries.delete(privateTerm.id, b)
    assert.equal(await read(), firstRead)
    assert.equal(db.taskGroups.materialVersion(a), stageVersion)

    // This writer shares no connection, repository or in-process invalidation callback with the service.
    const update = (sql: string, id: string) => execFileSync(process.execPath, ['--input-type=module', '-e',
      "import { DatabaseSync } from 'node:sqlite'; const [path, sql, id]=process.argv.slice(1); const db=new DatabaseSync(path); db.prepare(sql).run(id); db.close()",
      db.catDb.path, sql, id], { stdio: 'pipe' })
    update("UPDATE term_entries SET note='Revised annotation' WHERE id=?", term.id)
    const revisedTerm = await read()
    assert.notEqual(revisedTerm, firstRead)
    assert.equal(revisedTerm.preferredTerms[0]?.note, 'Revised annotation')
    assert.notEqual(db.taskGroups.materialVersion(a), stageVersion)
    update("UPDATE tm_units SET target='找到这把钥匙' WHERE id=?", firstRead.tm[0]!.unitId)
    assert.equal((await read()).tm[0]?.target, '找到这把钥匙')
    update('UPDATE segments SET locked=1 WHERE id=?', ids[0]!)
    assert.equal((await read()).locked, true)
    db.contextDocs.setEvidenceLink({ contextDocId: doc.id, relation: { kind: 'segment', segmentId: ids[0]! }, requiredness: 'required', mappingRevision: 'a1' })
    assert.equal((await read()).contextRefs[0]?.requiredness, 'required')
  } finally { service.closeAll(); rmSync(root, { recursive: true, force: true }) }
})

test('a detached six-segment draft in each direction delivers through the original adapter and retains the original file', async () => {
  const root = mkdtempSync(join(tmpdir(), 'la-detached-delivery-'))
  const service = new LinguistProjectService({ rootDir: join(root, 'data'), applicationVersion: 'synthetic' })
  service.init()
  try {
    for (const [sourceLocale, targetLocale, source, target, corrected] of [
      ['en', 'zh-CN', 'Collect %d shells', '消耗 %d 枚贝壳', '收集 %d 枚贝壳'],
      ['zh-CN', 'en', '收集 %d 枚贝壳', 'Spend %d shells', 'Collect %d shells'],
    ] as const) {
      const project = await service.createProject({ name: sourceLocale, sourceLocale, targetLocale })
      const sourcePath = sourceLocale + '.csv'
      const original = 'key,source,target\n' + Array.from({ length: 6 }, (_, i) => `row${i},${source},${target}`).join('\n') + '\n'
      writeFileSync(join(root, sourcePath), original)
      const context: WorkingCopyContext = { workspaceRoot: root, sessionId: 'synthetic', service, referenceProjectId: project.id,
        provenance: { runId: 'review', sessionId: 'synthetic', toolCallId: 'deliver', modelProvider: 'synthetic', modelId: 'test' } }
      const request = { sourcePath, sourceLocale, targetLocale }
      const prepared = await executeWorkingCopyAction({ ...request, operation: 'prepare' }, () => context)
      const rows = (readWorkingJson(root, prepared.path).value as LinguistWorkingCopy).segments
      const decisionsPath = sourceLocale + '.json'
      writeFileSync(join(root, decisionsPath), JSON.stringify({
        sourceSha256: prepared.sourceSha256, previousResultSha256: prepared.artifactSha256, unresolved: [],
        groups: [{ decision: 'corrected', segmentIds: [rows[0]!.id] }, { decision: 'unchanged', segmentIds: rows.slice(1).map(row => row.id) }],
        edits: [{ segmentId: rows[0]!.id, target: corrected }],
      }))
      const delivery = { ...request, operation: 'deliver' as const, previousResultPath: prepared.path, decisionsPath }
      await assert.rejects(executeWorkingCopyAction(delivery, () => ({ ...context, reportOnly: true })), /只报告问题/)
      const result = await executeWorkingCopyAction(delivery, () => context)
      assert.equal(result.segments, 6)
      assert.equal(readFileSync(join(root, sourcePath), 'utf8'), original)
      assert(readFileSync(join(root, result.path), 'utf8').includes(corrected))
      assert.equal(service.openProject(project.id).assets.countByProject(), 0)
    }
  } finally { service.closeAll(); rmSync(root, { recursive: true, force: true }) }
})
