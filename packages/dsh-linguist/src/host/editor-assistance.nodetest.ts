import assert from 'node:assert/strict'
import { mkdtempSync, realpathSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, sep } from 'node:path'
import test from 'node:test'
import { LinguistProjectService } from '@linguist/domain-service'
import type { LinguistCatRowSignalsResult, LinguistConcordanceResult, LinguistEditorDetails, LinguistEditorTermsResult, LinguistSpellingResult } from '@linguist/domain-service/contracts'
import { BindingStore } from './bindings'
import { ManagedFiles } from './files'
import { MutationBus } from './mutations'
import { dispatchOperation, type DispatchOperationInput } from './operations'

async function fixture(run: (input: Omit<DispatchOperationInput, 'operation' | 'payload'>, projectId: string) => Promise<void>) {
  const parent = realpathSync(tmpdir())
  const root = realpathSync(mkdtempSync(join(parent, 'la-editor-assistance-')))
  const service = new LinguistProjectService({ rootDir: join(root, 'linguist'), applicationVersion: 'synthetic-test' })
  service.init()
  try {
    const project = await service.createProject({ name: 'Editor assistance fixture', sourceLocale: 'zh-CN', targetLocale: 'en-US' })
    await run({ service, files: new ManagedFiles(root), bindings: new BindingStore(root), mutations: new MutationBus(), workspaceRegistry: { get: () => undefined }, assertProjectSession: async () => { throw Error('Unexpected session request') }, resolveSessionWorkspace: async () => { throw Error('Unexpected workspace request') } }, project.id)
  } finally {
    service.closeAll()
    assert.ok(root.startsWith(parent + sep + 'la-editor-assistance-'))
    rmSync(root, { recursive: true, force: true })
  }
}

test('editor terms, neighbors, revisions and concordance expose actual scoped data without mutations', async () => fixture(async (input, projectId) => {
  const { service } = input
  await service.importAsset(projectId, { filename: 'synthetic.csv', bytes: Buffer.from('key,source,target\na,开始,Start\nb,英雄 10,Hero 10\nc,结束,End\n') })
  await service.importAsset(projectId, { filename: 'other.csv', bytes: Buffer.from('key,source,target\nd,英雄,Hero\n') })
  service.upsertTermReference(projectId, { term: '英雄', translation: 'Hero', status: 'required', caseSensitive: false })
  await service.importReference(projectId, 'tm', { filename: 'synthetic-memory.csv', bytes: Buffer.from('source,target\n英雄,Hero\n100%英雄,100% Hero\n') })
  const db = service.openProject(projectId)
  const selected = db.segments.query().find(item => item.key === 'b')!
  const before = db.segments.query()
  const terms = await dispatchOperation({ ...input, operation: 'linguistCatEditorTerms', payload: { projectId, segmentIds: [selected.id] } }) as LinguistEditorTermsResult
  assert.equal(terms.items[0]!.sourceHash, selected.sourceHash)
  assert.equal(terms.items[0]!.termMatches[0]!.translation, 'Hero')
  assert.equal(terms.items[0]!.termMatches[0]!.start, 0)
  assert.equal(terms.items[0]!.truncated, false)
  const details = await dispatchOperation({ ...input, operation: 'linguistCatEditorDetails', payload: { projectId, segmentId: selected.id } }) as LinguistEditorDetails
  assert.deepEqual(details.previous.map(item => item.key), ['a'])
  assert.deepEqual(details.next.map(item => item.key), ['c'])
  const concordance = (query: string, assetId?: string) => dispatchOperation({ ...input, operation: 'linguistCatConcordance', payload: { projectId, query, assetId, limit: 1, offset: 0 } }) as Promise<LinguistConcordanceResult>
  const all = await concordance('英雄')
  assert.equal(all.segmentTotal, 2)
  assert.equal(all.segments.length, 1)
  assert.equal(all.tmTotal, 2)
  assert.equal(all.tm[0]!.sourceLabel, 'synthetic-memory.csv')
  assert.equal(all.tm[0]!.enabled, true)
  assert.equal((await concordance('英雄', selected.assetId)).segmentTotal, 1)
  assert.equal((await concordance('%')).tmTotal, 1, 'wildcards must remain literal')
  assert.deepEqual(db.segments.query(), before)
  const edited = service.editSegment(projectId, selected.id, 'Champion 10', selected.revision).segment
  const updated = await dispatchOperation({ ...input, operation: 'linguistCatEditorDetails', payload: { projectId, segmentId: selected.id } }) as LinguistEditorDetails
  assert.equal(updated.revisions.at(-1)!.target, edited.target)
  assert.equal(updated.revisions.at(-1)!.source, 'human')
  assert.equal(updated.revisions.at(-1)!.revision, edited.revision)
  service.archiveProject(projectId)
  assert.equal((await concordance('英雄')).segmentTotal, 2, 'archived reference lookup remains read-only')
}))

test('visible row signals batch QA and pending proposals without running TM matching or changing segments', async () => fixture(async (input, projectId) => {
  const { service } = input
  await service.importAsset(projectId, { filename: 'signals.csv', bytes: Buffer.from('key,source,target\na,药水 10,Potion 11\nb,英雄,Hero\n') })
  const db = service.openProject(projectId), segments = db.segments.query()
  service.runQa(projectId, segments[0]!.assetId)
  const expected = segments.map(segment => service.getSegmentContext(projectId, segment.id))
  const before = db.segments.query(), original = db.tmUnits.listCandidates
  db.tmUnits.listCandidates = () => { throw Error('Grid badges must not run TM matching') }
  try {
    const result = await dispatchOperation({ ...input, operation: 'linguistCatRowSignals', payload: { projectId, segmentIds: segments.map(segment => segment.id) } }) as LinguistCatRowSignalsResult
    assert.equal(result.items.length, segments.length)
    for (const item of result.items) {
      const context = expected.find(context => context.segment.id === item.segmentId)!
      const open = context.qaFindings.filter(finding => finding.status === 'open')
      assert.equal(item.qaCount, open.length)
      assert.equal(item.highestSeverity, open.map(finding => finding.severity).sort()[0])
      assert.deepEqual(item.proposal, context.pendingProposal)
    }
    assert.ok(result.items.some(item => item.qaCount > 0))
    assert.deepEqual(db.segments.query(), before)
    await assert.rejects(dispatchOperation({ ...input, operation: 'linguistCatRowSignals', payload: { projectId, segmentIds: ['seg-0000000000000001'] } }))
    service.archiveProject(projectId)
    assert.equal((await dispatchOperation({ ...input, operation: 'linguistCatRowSignals', payload: { projectId, segmentIds: segments.map(segment => segment.id) } }) as LinguistCatRowSignalsResult).items.length, 2)
  } finally { db.tmUnits.listCandidates = original }
}))

test('offline spelling excludes tags, persists project words and never leaks a dictionary into another project', async () => fixture(async (input, projectId) => {
  const spell = (text: string, id = projectId, locale = 'en-US') => dispatchOperation({ ...input, operation: 'linguistCatSpellcheck', payload: { projectId: id, text, locale } }) as Promise<LinguistSpellingResult>
  const initial = await spell('<g id="Thiss">Thiss hero</g> {PlayerNmae}')
  assert.equal(initial.supported, true)
  assert.deepEqual(initial.issues.map(item => item.word), ['Thiss'])
  assert.equal(initial.issues[0]!.start, '<g id="Thiss">'.length)
  assert.ok(initial.issues[0]!.suggestions.length > 0)
  const setWord = (included: boolean) => dispatchOperation({ ...input, operation: 'linguistCatSetSpellingWord', payload: { projectId, locale: 'en-US', word: 'Thiss', included } })
  await setWord(true)
  assert.equal((await spell('Thiss hero')).issues.length, 0)
  input.service.closeAll()
  assert.deepEqual((await spell('Thiss')).dictionary, ['Thiss'])
  const other = await input.service.createProject({ name: 'Separate project', sourceLocale: 'zh-CN', targetLocale: 'en-US' })
  assert.equal((await spell('Thiss', other.id)).issues.length, 1)
  await setWord(false)
  assert.equal((await spell('Thiss')).issues.length, 1)
  assert.equal((await spell('你好', projectId, 'zh-CN')).supported, false)
  input.service.archiveProject(projectId)
  await assert.rejects(setWord(true))
  assert.equal((await spell('Thiss')).issues.length, 1)
}))

test('editor assistance validates bounded ids, text, locale and dictionary words at the host boundary', async () => fixture(async (input, projectId) => {
  for (const [operation, payload] of [
    ['linguistCatRowSignals', { segmentIds: [] }],
    ['linguistCatRowSignals', { segmentIds: Array.from({ length: 201 }, (_, index) => `seg-${index.toString(16).padStart(16, '0')}`) }],
    ['linguistCatRowSignals', { segmentIds: ['seg-0000000000000001', 'seg-0000000000000001'] }],
    ['linguistCatEditorTerms', { segmentIds: [] }],
    ['linguistCatEditorTerms', { segmentIds: ['seg-0000000000000001', 'seg-0000000000000001'] }],
    ['linguistCatEditorDetails', { segmentId: '../../secrets' }],
    ['linguistCatConcordance', { query: 'x', limit: 201 }],
    ['linguistCatSpellcheck', { text: 'x'.repeat(100_001), locale: 'en-US' }],
    ['linguistCatSpellcheck', { text: '', locale: '../../x' }],
    ['linguistCatSetSpellingWord', { word: '<script>', locale: 'en-US', included: true }],
  ] as const) await assert.rejects(dispatchOperation({ ...input, operation, payload: { projectId, ...payload } }), operation)
}))
