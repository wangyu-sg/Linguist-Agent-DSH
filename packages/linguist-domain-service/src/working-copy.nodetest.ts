import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import test, { mock } from 'node:test'

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
    const unitId = db.tmUnits.listCandidates('en', 'zh-CN')[0]!.unitId
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
    assert.equal(db.tmUnits.listCandidates('en', 'zh-CN')[0]!.localMetadata?.la_reuse_count, undefined)
    const reviewer = { ...context, sessionId: 'reviewer' }
    decisions(translated.artifactSha256, [{ segmentIds: [a!.id], decision: 'unchanged' }, { segmentIds: [b!.id], decision: 'corrected' }], [
      { segmentId: b!.id, target: '获得 30 金币' },
    ])
    const reviewed = await executeWorkingCopyAction({ ...params, operation: 'assemble', previousResultPath: translated.path, decisionsPath: 'decisions.json' }, () => reviewer)
    decisions(reviewed.artifactSha256, [{ segmentIds: [a!.id, b!.id], decision: 'unchanged' }], [], ['synthetic-blocker'])
    await assert.rejects(executeWorkingCopyAction({ ...params, operation: 'deliver', previousResultPath: reviewed.path, decisionsPath: 'decisions.json' }, () => reviewer), /没有阻断/)
    assert.equal(db.tmUnits.listCandidates('en', 'zh-CN')[0]!.localMetadata?.la_reuse_count, undefined)
    decisions(reviewed.artifactSha256, [{ segmentIds: [a!.id, b!.id], decision: 'unchanged' }], [])
    await executeWorkingCopyAction({ ...params, operation: 'deliver', previousResultPath: reviewed.path, decisionsPath: 'decisions.json' }, () => reviewer)
    await executeWorkingCopyAction({ ...params, operation: 'deliver', previousResultPath: reviewed.path, decisionsPath: 'decisions.json' }, () => reviewer)
    assert.equal(db.tmUnits.listCandidates('en', 'zh-CN')[0]!.localMetadata?.la_reuse_count, '1')
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
