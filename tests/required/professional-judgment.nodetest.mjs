import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { professionalHash, professionalCaseHash, selectProfessionalContext, runQa } from '../../packages/linguist-cat-core/src/index.ts'
import { LinguistProjectService } from '../../packages/linguist-domain-service/src/index.ts'
import { createLinguistCatTools } from '../../packages/linguist-cat-tools/src/index.ts'
import { loadProfessionalResources } from '../../packages/dsh-linguist/src/host/professional-context.ts'

const resources = loadProfessionalResources(new URL('../../packages/dsh-linguist/resources/professional-judgment/', import.meta.url))
const segment = (id, source, target, meta = {}) => ({ id, assetId: 'synthetic', ordinal: Number(id), source, target,
  sourceLocale: 'zh-CN', targetLocale: 'en-US', status: 'translated', locked: false, revision: 0, sourceHash: 'synthetic', context: { meta } })

test('teaching cases require current human approval, language/function/topic relevance and stay within two per packet', () => {
  assert.deepEqual(resources.examples.cases.map(item => item.caseId), ['DEV-02', 'DEV-03', 'DEV-04', 'DEV-05', 'DEV-06', 'DEV-07'])
  for (const example of resources.examples.cases) {
    assert.equal(example.review.status, 'approved')
    assert.equal(example.review.contentHash, professionalCaseHash(example))
    assert.ok(example.when.length && example.notWhen.length && example.scene)
    assert.ok(example.ruleRefs.every(id => resources.standard.rules.some(rule => rule.id === id)))
  }
  const input = segment('1', '合成源文', 'Synthetic target', { category: 'mechanics' })
  const focus = resources.examples.cases.flatMap(example => example.problemTags)
  const packet = selectProfessionalContext(resources, [input], focus)
  assert.deepEqual(packet.cases.map(example => example.caseId), ['DEV-03', 'DEV-04'])
  assert.deepEqual(packet.perSegmentRoutes[0].profileIds, ['mechanics'])
  assert.equal(selectProfessionalContext(resources, [input]).cases.length, 0)
  assert.equal(selectProfessionalContext(resources, [{ ...input, targetLocale: 'ja-JP' }], focus).cases.length, 0)
  assert.equal(selectProfessionalContext(resources, [{ ...input, context: {} }], focus).cases.length, 0)
  assert.equal(selectProfessionalContext(resources, [{ ...input, context: {} }], focus, 2, { 1: ['mechanics'] }).cases.length, 2)
  assert.equal(selectProfessionalContext(resources, [input], focus, 0).cases.length, 0)
  const changed = structuredClone(resources)
  changed.examples.cases.find(example => example.caseId === 'DEV-03').scene += ' changed'
  changed.examples.cases.find(example => example.caseId === 'DEV-04').review.status = 'withdrawn'
  assert.equal(selectProfessionalContext(changed, [input], focus).cases.length, 0)
  const mixed = [...resources.standard.profiles].map((profile, i) => segment(String(i), '合成', 'Synthetic', { textType: profile.id }))
  assert.equal(selectProfessionalContext(resources, mixed, focus).cases.length, 2)
})

test('professional context uses the real CAT budget and rejects continuation after its standard changes', async () => {
  const root = mkdtempSync(join(tmpdir(), 'la-professional-'))
  const service = new LinguistProjectService({ rootDir: root, applicationVersion: 'synthetic' })
  service.init()
  try {
    const project = await service.createProject({ name: 'Synthetic professional context', sourceLocale: 'zh-CN', targetLocale: 'en-US' })
    const imported = await service.importAsset(project.id, { filename: 'mechanics.csv', bytes: new TextEncoder().encode('key,source,target\na,命中后获得护盾,On hit gain a shield\nb,生命低于阈值,While below the HP threshold\n') })
    const db = service.openProject(project.id)
    const segments = db.segments.getByIds(db.segments.queryIds({ assetId: imported.assetId }))
    const current = structuredClone(resources)
    const tool = createLinguistCatTools({ resolveProject: () => ({ project: service.getProject(project.id), db }), professionalJudgment: current })
      .find(tool => tool.name === 'cat_get_translation_context')
    const params = { segmentIds: segments.map(item => item.id), readOnly: true, includeNeighbors: false, tmLimitPerSegment: 0, termLimitPerSegment: 0,
      functionHints: segments.map(item => ({ segmentId: item.id, functions: ['mechanics'] })), judgmentFocus: ['trigger'], maxBytes: 32000 }
    const full = (await tool.execute('full', params)).details
    assert.equal(full.professionalJudgment.cases[0].caseId, 'DEV-03')
    assert.equal(full.professionalJudgment.perSegmentRoutes[0].functionSource, 'model-hint')
    assert.ok(full.usedBytes <= params.maxBytes)
    const tiny = (await tool.execute('tiny', { ...params, maxBytes: 1024 })).details
    assert.ok(tiny.nextCursor)
    assert.ok(Buffer.byteLength(JSON.stringify(tiny)) <= 1024)
    let page = tiny, json = ''
    while (page.contextFragment) {
      json += page.contextFragment.text
      if (json.length === page.contextFragment.totalChars) break
      page = (await tool.execute('continue', { ...params, cursor: page.nextCursor, maxBytes: 1800 })).details
      assert.ok(Buffer.byteLength(JSON.stringify(page)) <= 1800)
    }
    const assembled = JSON.parse(json)
    assert.equal(assembled.contexts[0].source, segments[0].source)
    assert.equal(assembled.professionalJudgment.cases.length, 0, 'cases yield to the actual source/target under a tight budget')
    assert.equal(assembled.professionalJudgment.standardHash, current.standardHash)
    current.standard.rules[0].text += ' Synthetic revision.'
    current.standardHash = professionalHash(current.standard)
    await assert.rejects(tool.execute('changed', { ...params, cursor: tiny.nextCursor }), error => error.code === 'CONTEXT_DRIFT')
  } finally { service.closeAll(); rmSync(root, { recursive: true, force: true }) }
})

test('surface QA signals request review while missing variables and tags remain defects', () => {
  const findings = runQa([
    segment('0', 'Steam', 'Steam'),
    segment('1', '保存', 'Automatically save progress whenever you leave camp.'),
    segment('2', '开始挑战任务', 'Begin the challenge'),
    segment('3', '开始挑战任务', 'Start the challenge'),
    segment('4', '退出', 'Close'), segment('5', '关闭', 'Close'),
    segment('6', '<b>{name}</b>', 'Name'),
  ])
  for (const code of ['SOURCE_EQUALS_TARGET', 'TARGET_LENGTH_WARNING', 'INCONSISTENT_REPEATED_SOURCE', 'TARGET_SOURCE_INCONSISTENCY']) {
    const matching = findings.filter(finding => finding.code === code)
    assert.ok(matching.length, code)
    assert.ok(matching.every(finding => finding.disposition === 'needs_review'), code)
  }
  for (const code of ['PLACEHOLDER_MISMATCH', 'TAG_MISMATCH']) assert.ok(findings.some(finding => finding.code === code && finding.disposition === 'defect'), code)
})
