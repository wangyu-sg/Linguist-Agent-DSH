import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { parseXlsxWorkbook } from '@linguist/cat-formats'
import { createDeliveryReportTool, createInspectDeliveryReportTool } from './delivery-report-tool'

test('formal translation and review produce the correct template, and inconsistent or incomplete handoffs fail', async t => {
  const workspaceRoot = mkdtempSync(join(tmpdir(), 'la-delivery-report-'))
  t.after(() => rmSync(workspaceRoot, { recursive: true, force: true }))
  const templates = new URL('../../resources/delivery-templates/', import.meta.url)
  const original = readFileSync(new URL('translation.xlsx', templates))
  const metadata = { task: 'Synthetic', languagePair: 'zh-CN → en-US', baseline: 'fixture v1', version: 'v2', scope: '检查合成稿的 16 段' }
  const evidence = { reason: '按当前操作翻译', evidence: '当前原文' }
  const fixture = 'report.json'
  let role: 'general' | 'translator' | 'reviewer' = 'translator'
  const tool = createDeliveryReportTool(templates, async () => ({ workspaceRoot, role }))
  const generate = async (kind: 'translation' | 'review', data: object) => {
    writeFileSync(join(workspaceRoot, fixture), JSON.stringify(data))
    return tool.execute({ kind, dataPath: fixture }, {} as never) as Promise<{ path: string; detailRows: number }>
  }
  const translations = Array.from({ length: 15 }, (_, index) =>
    ({ location: 'test.key.' + index, source: '原句 {0}', status: '定稿', final: '=A1\nKeep {0} & <b> _x0041_', ...evidence }))
  const pending = { location: 'test.pending', source: '等待确认', status: '待确认', questionId: 'Q1', ...evidence }
  const questions = [{ id: 'Q1', affected: pending.location, question: '核对数值', evidence: '规格尚缺', status: '草稿' }]
  const history = [{ location: translations[0]!.location, source: '旧句', target: 'Old', reference: 'Synthetic TM / TU-3', relation: '近义', decision: '根据当前范围另译' }]
  const input = { ...metadata, collection: '逐段全量', items: [...translations, pending], questions, history }
  await assert.rejects(generate('translation', { ...input, scope: '' }), /scope/)
  await assert.rejects(generate('translation', { ...input, items: [{ ...pending, final: 'Unverified' }] }), /译文与处理状态不符/)
  await assert.rejects(generate('review', input), /岗位/)
  assert.deepEqual(readdirSync(workspaceRoot), [fixture])
  const translation = await generate('translation', input)
  assert.equal(translation.detailRows, 16)
  const { sheets } = await parseXlsxWorkbook(readFileSync(join(workspaceRoot, translation.path)))
  assert.deepEqual(sheets.map(sheet => sheet.name), ['翻译明细', '待确认', '历史对照', '填写示例', '使用说明'])
  assert.equal(sheets[0]!.rows.find(row => row.rowNo === 2)!.cells[1]!.value, 'Synthetic / zh-CN → en-US')
  assert.equal(sheets[0]!.rows.find(row => row.rowNo === 3)!.cells[4]!.value, metadata.scope)
  const target = sheets[0]!.rows.find(row => row.rowNo === 20)!.cells[2]!
  assert.equal(target.value, translations[0]!.final)
  assert.equal(target.kind, 'text', 'an Excel-looking formula is stored as text')
  const last = sheets[0]!.rows.find(row => row.rowNo === 21)!.cells
  assert.deepEqual([last[0]!.value, last[2]!.value, last[6]!.value], [pending.location, '', 'Q1'])
  assert.equal(sheets[1]!.rows.find(row => row.rowNo === 4)!.cells[0]!.value, 'Q1')
  assert.equal(sheets[2]!.rows.find(row => row.rowNo === 4)!.cells[3]!.value, 'Synthetic TM / TU-3')
  assert.deepEqual(readFileSync(new URL('translation.xlsx', templates)), original)

  role = 'reviewer'
  const review = { ...metadata, collection: '仅改项与未决', items: [] }
  const empty = await generate('review', review)
  assert.equal(empty.detailRows, 0)
  assert.notEqual(empty.path, translation.path)
  const reviewItems = [
    { draft: 'Old', final: 'Button', status: '采用终稿' },
    { draft: 'Close', status: '保留原译' },
    { draft: '  Open  menu, then close.', final: ' Open menu! then save. ', status: '采用终稿' },
    { draft: 'A B\tC\r\nD\u3000E', final: 'A\u00a0B C\nD E', status: '采用终稿' },
    { draft: 'Same', final: 'Same', status: '采用终稿' },
    { draft: 'Check this', status: '待确认' },
    { draft: '', final: '=A1 & <b> _x0001_ 👩🏽‍💻', status: '采用终稿' },
    { draft: 'Use _x0001_ & {0}', final: 'Use _x0002_ & {0}', status: '采用终稿' },
  ].map((item, index) => ({ location: `test.key.${index + 1}`, source: '原句', ...evidence, ...item }))
  const changed = await generate('review', { ...review, items: reviewItems })
  const reviewBytes = readFileSync(join(workspaceRoot, changed.path))
  const reviewSheet = (await parseXlsxWorkbook(reviewBytes)).sheets[0]!
  assert.equal(reviewSheet.name, '审校明细')
  for (const [index, item] of reviewItems.entries()) {
    assert.deepEqual(reviewSheet.rows.find(row => row.rowNo === index + 6)!.cells.slice(2, 5).map(cell => cell.value),
      [item.draft, item.final ?? '', item.status])
  }
  const JSZip = createRequire(new URL('../../../linguist-cat-formats/package.json', import.meta.url))('jszip')
  const translationZip = await JSZip.loadAsync(readFileSync(join(workspaceRoot, translation.path)))
  const reviewZip = await JSZip.loadAsync(reviewBytes)
  for (const zip of [translationZip, reviewZip]) {
    for (const index of [1, 2, 3]) {
      assert.doesNotMatch(await zip.file(`xl/worksheets/sheet${index}.xml`).async('string'), /<autoFilter\b/)
      assert.match(await zip.file(`xl/tables/table${index}.xml`).async('string'), /<autoFilter\b/)
    }
  }
  assert.match(await translationZip.file('xl/tables/table1.xml').async('string'), /<tableColumn id="3" name="译文"\/>/)
  const xml: string = await reviewZip.file('xl/worksheets/sheet1.xml').async('string')
  const redRuns = (address: string) => {
    const cell = new RegExp(`<c r="${address}"[^>]*>([\\s\\S]*?)</c>`).exec(xml)![1]!
    return [...cell.matchAll(/<r><rPr><rFont val="Aptos"\/><color rgb="FFB91C1C"\/><sz val="11"\/><\/rPr><t xml:space="preserve">([\s\S]*?)<\/t><\/r>/g)]
      .map(match => match[1])
  }
  assert.deepEqual([redRuns('C6'), redRuns('D6')], [['Old'], ['Button']])
  assert.deepEqual([redRuns('C8'), redRuns('D8')], [[' ', ' ', ',', 'close'], ['!', 'save', ' ']])
  assert.deepEqual([redRuns('C9'), redRuns('D9')], [[' ', '\t', '&#xD;', '\u3000'], ['\u00a0', ' ', ' ']])
  assert.deepEqual([redRuns('C12'), redRuns('D12')], [[], ['=A1 &amp; &lt;b&gt; _x005F_x0001_ 👩🏽‍💻']])
  assert.deepEqual([redRuns('C13'), redRuns('D13')], [['_x005F_x0001_'], ['_x005F_x0002_']])
  for (const address of ['B8', 'C7', 'D7', 'C10', 'D10', 'C11', 'D11']) assert.deepEqual(redRuns(address), [])
  assert.doesNotMatch(await translationZip.file('xl/worksheets/sheet1.xml').async('string'), /FFB91C1C/)

  const reader = createInspectDeliveryReportTool(async () => ({ workspaceRoot }))
  const inspect = (path: string, batch?: string) => reader.execute({ path, ...(batch && { batch }) }, {} as never)
  const expected = { task: 'Synthetic / zh-CN → en-US', baseline: metadata.baseline, version: metadata.version,
    collection: input.collection, scope: metadata.scope }
  const before = readFileSync(join(workspaceRoot, changed.path))
  assert.deepEqual(await inspect(translation.path), { path: translation.path, report: expected,
    sheets: sheets.map(({ name }) => name), skippedSheets: [] })
  assert.deepEqual(await inspect(translation.path, metadata.task), { path: translation.path, report: expected,
    sheets: sheets.map(({ name }) => name), batchCheck: { batch: metadata.task, locations: ['「翻译明细」的任务栏 B2 为「Synthetic / zh-CN → en-US」'] }, skippedSheets: [] })
  const names = ['审校明细', '待确认', '历史对照', '填写示例', '使用说明']
  assert.deepEqual(await inspect(changed.path, 'test.key.1'), { path: changed.path,
    report: { ...expected, collection: review.collection }, sheets: names,
    batchCheck: { batch: 'test.key.1', locations: ['「审校明细」的 A6 单元格值为「test.key.1」'] }, skippedSheets: [] })
  assert.deepEqual(await reader.execute({ path: changed.path, batch: 'test.key.1', kind: 'Review' }, {} as never), await inspect(changed.path, 'test.key.1'))
  assert.deepEqual(await inspect(changed.path, 'not-this-batch'), { path: changed.path,
    report: { ...expected, collection: review.collection }, sheets: names, batchCheck: { batch: 'not-this-batch', locations: [] }, skippedSheets: [] })
  writeFileSync(join(workspaceRoot, '空模板.xlsx'), original)
  assert.deepEqual(await inspect('空模板.xlsx', '32.2'), { path: '空模板.xlsx',
    report: { task: '', baseline: '', version: '', collection: '', scope: '' }, sheets: sheets.map(({ name }) => name),
    batchCheck: { batch: '32.2', locations: [] }, skippedSheets: [] })
  await assert.rejects(async () => inspect(join(workspaceRoot, changed.path)), /相对路径/)
  assert.deepEqual(readFileSync(join(workspaceRoot, changed.path)), before)
})
