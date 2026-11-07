import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { activateTagProfileCandidate, normalizeTagProfile, runDeterministicHardRules, runQa, saveTagProfileCandidate, type SegmentId } from '../../packages/linguist-cat-core/src/index.ts'
import { createLinguistCatTools, type CatGetTranslationContextResult } from '../../packages/linguist-cat-tools/src/index.ts'
import { LinguistProjectService } from '../../packages/linguist-domain-service/src/project-service.ts'

test('project placeholder exceptions preserve exact segment, source, locale and multiplicity', () => {
  const segment = { id: 'seg-0000000000000001' as SegmentId, source: '银鸮试用凭证', targetLocale: 'en-US', locked: false }
  const target = 'Silver Owl {Avatar_42} Trial'
  const exception = {
    segmentId: segment.id, source: segment.source, targetLocale: segment.targetLocale,
    placeholders: ['{Avatar_42}'],
    ruleReference: 'Synthetic guide / Item names / 2', ruleQuote: 'Include the owner variable in item names.',
    evidence: { segmentId: 'seg-0000000000000002', source: '使用后试用 {Avatar_42} 的银鸮外观。', reason: 'Same synthetic item ID, description field.' },
  }
  const tagProfile = { families: [], placeholderExceptions: [exception] }
  assert.equal(runDeterministicHardRules({ segment, proposedTarget: target }).ok, false)
  assert.deepEqual(runDeterministicHardRules({ segment, proposedTarget: target, tagProfile }), { ok: true, violations: [] })
  for (const proposedTarget of ['Silver Owl {Avatar_43} Trial', `${target} {Avatar_42}`, 'Silver Owl Trial']) {
    assert.equal(runDeterministicHardRules({ segment, proposedTarget, tagProfile }).ok, false)
  }
  for (const changed of [{ id: 'seg-0000000000000003' as SegmentId }, { source: '另一件物品' }, { targetLocale: 'fr-FR' }, { locked: true }]) {
    assert.equal(runDeterministicHardRules({ segment: { ...segment, ...changed }, proposedTarget: target, tagProfile }).ok, false)
  }
  for (const invalid of [{ ruleQuote: '' }, { placeholders: ['{Avatar_43}'] }, { placeholders: ['{Avatar_42}', '{Avatar_42}'] }, { placeholders: ['.*'] }]) {
    assert.throws(() => normalizeTagProfile({ families: [], placeholderExceptions: [{ ...exception, ...invalid }] }))
  }
  const tagged = { ...segment, source: '<b>凭证</b> {count}' }
  const scoped = { families: [], placeholderExceptions: [{ ...exception, source: tagged.source }] }
  assert.equal(runDeterministicHardRules({ segment: tagged, proposedTarget: '<b>Trial</b> {count} {Avatar_42}', tagProfile: scoped }).ok, true)
  for (const proposedTarget of ['<b>Trial</b> {Avatar_42}', 'Trial {count} {Avatar_42}', '<b>Trial {count} {Avatar_42}']) {
    assert.equal(runDeterministicHardRules({ segment: tagged, proposedTarget, tagProfile: scoped }).ok, false)
  }
})

test('source-backed exception persists through the bound tool and applies to writes, QA and delivery without propagating', async () => {
  const root = mkdtempSync(join(tmpdir(), 'la-placeholder-exception-'))
  const service = new LinguistProjectService({ rootDir: root, applicationVersion: 'synthetic' })
  service.init()
  try {
    const project = await service.createProject({ name: 'Synthetic items', sourceLocale: 'zh-CN', targetLocale: 'en-US' })
    const path = join(root, 'items.csv')
    writeFileSync(path, 'key,source,target\nname,银鸮试用凭证,Silver Owl {Avatar_42} Trial\ndescription,试用 {Avatar_42} 的外观,Try the outfit for {Avatar_42}\nrepeat,银鸮试用凭证,\n')
    await service.importResourcesFromPaths(project.id, root, { paths: [path], recursive: false, kind: 'batch', dryRun: false })
    let db = service.openProject(project.id)
    const [segment, evidence, repeated] = db.segments.query()
    assert.ok(segment && evidence && repeated)
    const target = 'Silver Owl {Avatar_42} Pass'
    assert.deepEqual(db.proposals.applyTranslations([{ segmentId: segment.id, baseRevision: 0, target }]).failed,
      [{ segmentId: segment.id, code: 'PLACEHOLDER_SIGNATURE_MISMATCH' }])

    const tools = createLinguistCatTools({
      resolveProject: () => ({ project: service.getProject(project.id), db: service.openProject(project.id) }),
      setPlaceholderException: input => service.setPlaceholderException(project.id, input),
    })
    const tool = tools.find(item => item.name === 'cat_set_placeholder_exception')!
    const request = {
      segmentId: segment.id, source: segment.source,
      exception: { placeholders: ['{Avatar_42}'], ruleReference: 'Synthetic guide / items / 2',
        ruleQuote: 'Include the owner variable in item names.', evidenceSegmentId: evidence.id, reason: 'Synthetic item name and its description.' },
    }
    await assert.rejects(tool.execute('wrong-evidence', { ...request, exception: { ...request.exception, evidenceSegmentId: repeated.id } } as never), /related source/)
    await assert.rejects(tool.execute('stale-source', { ...request, source: 'stale' } as never), /原文已变化/)
    await tool.execute('register', request as never)
    assert.equal(db.segments.getById(segment.id)!.revision, 0, 'registration does not edit or confirm the target')
    service.closeAll()
    db = service.openProject(project.id)
    const tagProfile = service.getProject(project.id).tagProfile!
    assert.equal(tagProfile.placeholderExceptions![0]!.evidence.source, evidence.source)
    const contextTool = tools.find(item => item.name === 'cat_get_translation_context')!
    const context = await contextTool.execute('read-context', { segmentIds: [segment.id], readOnly: true } as never)
    assert.deepEqual((context.details as CatGetTranslationContextResult).contexts[0]!.placeholderException, tagProfile.placeholderExceptions![0])
    assert.equal(db.proposals.applyTranslations([{ segmentId: segment.id, baseRevision: 0, target }], { tagProfile }).applied, 1)
    const current = db.segments.getById(segment.id)!
    assert.equal(runQa([current], { tagProfile }).some(item => /PLACEHOLDER/.test(item.code)), false)
    assert.equal(service.getDeliveryPreflight(project.id, segment.assetId).blockers.some(item => item.code === 'STRUCTURAL_RULES'), false)

    const propagated = service.editSegment(project.id, segment.id, 'Silver Owl {Avatar_42} Token', current.revision, { propagateRepeated: true })
    assert.deepEqual(propagated.repetition!.updatedSegmentIds, [])
    assert.deepEqual(propagated.repetition!.skipped, [{ segmentId: repeated.id, reason: 'unsafe-target' }])
    const other = await service.createProject({ name: 'Separate project', sourceLocale: 'zh-CN', targetLocale: 'en-US' })
    assert.throws(() => service.setPlaceholderException(other.id, request), /segment/)
    const savedCandidate = saveTagProfileCandidate(tagProfile, {
      name: 'unused candidate', regex: '\\[unused\\]', kind: 'standalone', evidenceExampleIds: [], confidence: 1, explanation: 'synthetic',
    })
    assert.deepEqual(savedCandidate.profile.placeholderExceptions, tagProfile.placeholderExceptions)
    assert.deepEqual(activateTagProfileCandidate(savedCandidate.profile, savedCandidate.candidate.id).placeholderExceptions, tagProfile.placeholderExceptions)
    await tool.execute('remove', { segmentId: segment.id, source: segment.source, exception: null } as never)
    assert.equal(service.getProject(project.id).tagProfile?.placeholderExceptions, undefined)
    assert.equal(service.getDeliveryPreflight(project.id, segment.assetId).blockers.some(item => item.code === 'STRUCTURAL_RULES'), true)
  } finally { service.closeAll(); rmSync(root, { recursive: true, force: true }) }
})
