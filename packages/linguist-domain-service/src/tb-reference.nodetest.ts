import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import JSZip from 'jszip'
import { createLinguistCatTools, type CatGetTranslationContextResult } from '@linguist/cat-tools'
import { LinguistProjectService } from './project-service'
import { prepareReviewMaterials } from './review-materials'

test('XLSX terminology retains description and other reference columns', async () => {
  const root = mkdtempSync(join(tmpdir(), 'la-tb-xlsx-'))
  const service = new LinguistProjectService({ rootDir: root, applicationVersion: 'synthetic-test' })
  service.init()
  try {
    const project = await service.createProject({ name: 'Synthetic workbook TB', sourceLocale: 'en', targetLocale: 'zh-CN' })
    const zip = new JSZip()
    zip.file('xl/workbook.xml', '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Terms" sheetId="1" r:id="rId1"/></sheets></workbook>')
    zip.file('xl/_rels/workbook.xml.rels', '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>')
    zip.file('xl/worksheets/sheet1.xml', '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>Source</t></is></c><c r="B1" t="inlineStr"><is><t>Target</t></is></c><c r="C1" t="inlineStr"><is><t>Description</t></is></c><c r="D1" t="inlineStr"><is><t>Term ID</t></is></c></row><row r="2"><c r="A2" t="inlineStr"><is><t>Potion</t></is></c><c r="B2" t="inlineStr"><is><t>药剂</t></is></c><c r="C2" t="inlineStr"><is><t>Use for health items</t></is></c><c r="D2" t="inlineStr"><is><t>TB123</t></is></c></row></sheetData></worksheet>')
    const bytes = await zip.generateAsync({ type: 'nodebuffer' })
    await service.importReference(project.id, 'terms', { filename: 'terms.xlsx', bytes,
      xlsxMapping: { sheetName: 'Terms', columns: { source: 'Source', target: 'Target' } } })
    const match = service.openProject(project.id).termEntries.findMatches({ text: 'Use potion', limit: 10 })[0]!
    assert.match(match.note!, /Description: Use for health items/)
    assert.match(match.note!, /Term ID: TB123/)
    writeFileSync(join(root, 'terms.xlsx'), bytes)
    writeFileSync(join(root, 'source.csv'), 'key,source,target\na,Use potion,使用药剂\n')
    await service.reviewCache.setEnabled(false)
    const materials = await prepareReviewMaterials(service, { workspaceRoot: root, taskId: 'synthetic', sourcePath: 'source.csv',
      sourceLocale: 'en', targetLocale: 'zh-CN', referenceFiles: [{ path: 'terms.xlsx', kind: 'terms' }] })
    assert.match(materials.readingContent, /Description: Use for health items/)
    assert.match(materials.readingContent, /TB123/)
    const mappedByLetter = await prepareReviewMaterials(service, { workspaceRoot: root, taskId: 'synthetic-column-letters', sourcePath: 'source.csv',
      sourceLocale: 'en', targetLocale: 'zh-CN', referenceFiles: [{ path: 'terms.xlsx', kind: 'terms',
        xlsxMapping: { sheetName: 'Terms', columns: { source: 'A', target: 'B' } } }] })
    assert.match(mappedByLetter.readingContent, /Description: Use for health items/)
    assert.doesNotMatch(mappedByLetter.readingContent, /未能导入/)
    assert.match(mappedByLetter.readingContent, /本批未提供 TM/)
    assert.doesNotMatch(mappedByLetter.readingContent, /本批 TM 未成功准备/)
  } finally { service.closeAll(); rmSync(root, { recursive: true, force: true }) }
})

test('plain CSV terminology reaches both roles as reference text and survives context fragmentation', async () => {
  const root = mkdtempSync(join(tmpdir(), 'la-tb-context-'))
  const service = new LinguistProjectService({ rootDir: root, applicationVersion: 'synthetic-test' })
  service.init()
  try {
    const project = await service.createProject({ name: 'Synthetic TB', sourceLocale: 'zh-CN', targetLocale: 'en-US' })
    await service.importReference(project.id, 'terms', {
      filename: 'synthetic-terms.csv',
      bytes: Buffer.from('source,target,note\n晶匣,Crystal Cache,Synthetic inventory category\n'),
    })
    const path = join(root, 'synthetic-batch.csv')
    writeFileSync(path, 'key,source,target\none,领取月辉晶匣。,\ntwo,打开晨星晶匣。,\n')
    await service.importResourcesFromPaths(project.id, root, { paths: [path], recursive: false, kind: 'batch', dryRun: false })
    const db = service.openProject(project.id)
    const segments = db.segments.query({ limit: 50 })
    const term = db.termEntries.search({ query: '晶匣' })[0]!
    assert.equal(term.status, 'allowed', 'a plain two-column glossary must not become a hard rule')
    db.termEntries.upsert({ term: '月辉', translation: 'Moonlight', status: 'required', caseSensitive: false })
    db.termEntries.upsert({ term: '晨星', translation: 'Morningstar', status: 'forbidden', caseSensitive: false })
    const preferred = db.termEntries.upsert({ term: '领取', translation: 'Claim', status: 'preferred', caseSensitive: false })

    for (const linguistRole of ['translator', 'reviewer'] as const) {
      if (linguistRole === 'reviewer') {
        service.editSegment(project.id, segments[0]!.id, 'Claim the Moonlight Casket.', 0)
      }
      const tools = createLinguistCatTools({
        resolveProject: () => ({ project, db }), linguistRole, sessionId: `synthetic-${linguistRole}`,
      })
      const contextTool = tools.find(tool => tool.name === 'cat_get_translation_context')!
      const request = { segmentIds: segments.map(segment => segment.id), includeNeighbors: false, tmLimitPerSegment: 0 }
      const result = await contextTool.execute(`read-${linguistRole}`, request)
      const body = result.content[0]!
      assert.equal(body.type, 'text')
      const page = JSON.parse(body.type === 'text' ? body.text : '') as CatGetTranslationContextResult
      assert.deepEqual(page.contexts.map(context => context.allowedTerms?.map(match => ({
        id: match.id, term: match.term, translation: match.translation, status: match.status, note: match.note,
      }))), segments.map(() => [{
        id: term.id, term: '晶匣', translation: 'Crystal Cache', status: 'allowed', note: 'Synthetic inventory category',
      }]))
      for (const context of page.contexts) {
        assert.equal(context.allowedTerms[0]!.sources?.[0]?.filename, 'synthetic-terms.csv')
        assert.match(context.allowedTerms[0]!.sources?.[0]?.sha256 ?? '', /^[0-9a-f]{64}$/u)
      }
      assert.equal(page.contexts[0]!.requiredTerms[0]!.term, '月辉')
      assert.equal(page.contexts[1]!.forbiddenTerms[0]!.term, '晨星')
      assert.equal(page.contexts[0]!.preferredTerms[0]!.id, preferred.id)
      assert.equal(page.contexts[0]!.currentTarget, linguistRole === 'translator' ? '' : 'Claim the Moonlight Casket.')
      for (const context of page.contexts) {
        assert.ok(context.evidence.some(ref => ref.kind === 'term' && ref.id === term.id))
        assert.equal(context.requiredTerms.some(match => match.id === term.id), false)
      }
      const disabled = (await contextTool.execute(`limit-${linguistRole}`, {
        ...request, termLimitPerSegment: 0,
      })).details as CatGetTranslationContextResult
      assert.deepEqual(disabled.contexts.map(context => context.allowedTerms), [[], []])
      assert.equal(disabled.contexts[0]!.requiredTerms.length, 1)
      assert.equal(disabled.contexts[1]!.forbiddenTerms.length, 1)
    }
    assert.deepEqual(db.termEntries.validateSegments(db.segments.getByIds(segments.map(segment => segment.id))).missingRequired, [])
    assert.equal(db.termEntries.get(term.id)!.status, 'allowed')

    const note = 'Synthetic reference explanation. '.repeat(150)
    db.termEntries.upsert({ ...term, note })
    db.termEntries.upsert({ ...preferred, note })
    const tools = createLinguistCatTools({ resolveProject: () => ({ project, db }) })
    const contextTool = tools.find(tool => tool.name === 'cat_get_translation_context')!
    const request = { segmentIds: [segments[0]!.id], includeNeighbors: false, tmLimitPerSegment: 0, readOnly: true, maxBytes: 4096 }
    let cursor: string | undefined, firstCursor: string | undefined, json = ''
    do {
      const result = await contextTool.execute('fragment', { ...request, cursor })
      const page = result.details as CatGetTranslationContextResult
      assert.ok(page.contextFragment, 'selected terminology must be fragmented rather than silently omitted')
      assert.equal(page.contextFragment.offset, json.length)
      assert.ok(Buffer.byteLength(JSON.stringify(page)) <= request.maxBytes)
      json += page.contextFragment.text
      cursor = page.nextCursor
      firstCursor ??= cursor
    } while (cursor)
    const restored = JSON.parse(json) as CatGetTranslationContextResult
    assert.equal(restored.contexts[0]!.allowedTerms[0]!.note, note)
    assert.equal(restored.contexts[0]!.preferredTerms.length, 1, 'selected advisory terms must retain their text too')
    assert.equal(restored.contexts[0]!.preferredTerms[0]!.note, note)
    assert.equal(restored.contexts[0]!.currentTarget, 'Claim the Moonlight Casket.')
    assert.ok(firstCursor)
    db.termEntries.upsert({ ...term, translation: 'Crystal Chest', note })
    await assert.rejects(contextTool.execute('stale-fragment', { ...request, cursor: firstCursor }), { code: 'CONTEXT_DRIFT' })
  } finally {
    service.closeAll()
    rmSync(root, { recursive: true, force: true })
  }
})

test('duplicate terms retain each actual source row and user edits do not change the originals', async () => {
  const root = mkdtempSync(join(tmpdir(), 'la-tb-provenance-'))
  const service = new LinguistProjectService({ rootDir: root, applicationVersion: 'synthetic-test' })
  service.init()
  try {
    const project = await service.createProject({ name: 'Synthetic', sourceLocale: 'en', targetLocale: 'zh-CN' })
    for (const [filename, note] of [['one.csv', 'First note'], ['two.csv', 'Second note']]) {
      await service.importReference(project.id, 'terms', { filename, bytes: Buffer.from(`source,target,note\nPotion,药水,${note}\n`) })
    }
    const db = service.openProject(project.id), term = db.termEntries.search({ query: 'Potion' })[0]!
    assert.deepEqual(term.sources?.map(source => [source.filename, source.translation, source.note]), [
      ['one.csv', '药水', 'First note'], ['two.csv', '药水', 'Second note'],
    ])
    db.termEntries.upsert({ ...term, translation: '药剂' })
    await service.importReference(project.id, 'terms', { filename: 'one.csv', bytes: Buffer.from('source,target,note\nPotion,药水,First note\n') })
    const edited = db.termEntries.get(term.id)!
    assert.equal(edited.translation, '药剂')
    assert.deepEqual(edited.sources?.map(source => source.translation), ['药水', '药水'])
    assert.equal(db.termEntries.upsert({ term: 'Manual', translation: '人工', status: 'allowed', caseSensitive: false }).sources, undefined)
  } finally { service.closeAll(); rmSync(root, { recursive: true, force: true }) }
})

test('term highlight offsets select the original source after Unicode and whitespace normalization', async () => {
  const root = mkdtempSync(join(tmpdir(), 'la-tb-offset-'))
  const service = new LinguistProjectService({ rootDir: root, applicationVersion: 'synthetic-test' })
  service.init()
  try {
    const project = await service.createProject({ name: 'Synthetic offsets', sourceLocale: 'en', targetLocale: 'zh-CN' })
    const db = service.openProject(project.id)
    db.termEntries.upsert({ term: 'potion', translation: '药水', status: 'allowed', caseSensitive: false })
    db.termEntries.upsert({ term: 'ffi', translation: '连字', status: 'allowed', caseSensitive: false })
    for (const [source, term, expected] of [
      ['A ﬃ potion', 'potion', 'potion'],
      ['  A   potion  ', 'potion', 'potion'],
      ['A e\u0301 Potion', 'potion', 'Potion'],
      ['A İ potion', 'potion', 'potion'],
      ['  potion  ', 'potion', 'potion'],
      ['A ﬃ potion', 'ffi', 'ﬃ'],
    ]) {
      const match = db.termEntries.findMatches({ text: source }).find(item => item.term === term)
      assert.ok(match, `expected ${term} in ${source}`)
      assert.equal(source.slice(match.start, match.end), expected)
    }
  } finally { service.closeAll(); rmSync(root, { recursive: true, force: true }) }
})

test('whole-string NFKC matches Korean compatibility jamo and maps the complete original span', async () => {
  const root = mkdtempSync(join(tmpdir(), 'la-tb-korean-offset-'))
  const service = new LinguistProjectService({ rootDir: root, applicationVersion: 'synthetic-test' })
  service.init()
  try {
    const project = await service.createProject({ name: 'Synthetic Korean offsets', sourceLocale: 'ko', targetLocale: 'zh-CN' })
    const db = service.openProject(project.id)
    db.termEntries.upsert({ term: '가', translation: '合成译名', status: 'allowed', caseSensitive: false })
    for (const [source, expectedType] of [
      ['ㄱㅏ', 'exact'],
      ['앞 ㄱㅏ 뒤', 'contains'],
      ['ﬃ  ㄱㅏ! e\u0301', 'contains'],
    ] as const) {
      const match = db.termEntries.findMatches({ text: source }).find(item => item.term === '가')
      assert.ok(match, `expected Korean term in ${source}`)
      assert.equal(match.matchType, expectedType)
      assert.equal(source.slice(match.start, match.end), 'ㄱㅏ')
    }
    const repeated = 'ㄱㅏ, 가, ㄱㅏ'
    assert.deepEqual(db.termEntries.findMatches({ text: repeated }).map(match => repeated.slice(match.start, match.end)), ['ㄱㅏ', '가', 'ㄱㅏ'])
    for (const [source, term] of [
      ['ｶﾞ', 'ガ'], ['한', '한'], ['ㄱㅏ ㄴㅏ', '가 나'],
      ['ﬃ', 'ffi'], ['a\u0301\u0323', 'ạ\u0301'], ['ΟΣ', 'ος'],
    ]) {
      db.termEntries.upsert({ term, translation: '合成译名', status: 'allowed', caseSensitive: false })
      const match = db.termEntries.findMatches({ text: source }).find(item => item.term === term)
      assert.ok(match, `expected ${term} in ${source}`)
      assert.equal(source.slice(match.start, match.end), source)
    }
  } finally { service.closeAll(); rmSync(root, { recursive: true, force: true }) }
})
