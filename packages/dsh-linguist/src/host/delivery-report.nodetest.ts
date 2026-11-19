import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { parseXlsxWorkbook } from '@linguist/cat-formats'
import { createDeliveryReportTool } from './delivery-report-tool'

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
  const changed = await generate('review', { ...review,
    items: [{ location: 'test.key.1', source: '按钮', draft: 'Old', final: 'Button', status: '采用终稿', ...evidence },
      { location: 'test.key.2', source: '关闭', draft: 'Close', status: '保留原译' }] })
  const reviewSheet = (await parseXlsxWorkbook(readFileSync(join(workspaceRoot, changed.path)))).sheets[0]!
  assert.equal(reviewSheet.name, '审校明细')
  assert.deepEqual(reviewSheet.rows.find(row => row.rowNo === 6)!.cells.slice(2, 5).map(cell => cell.value), ['Old', 'Button', '采用终稿'])
  assert.deepEqual(reviewSheet.rows.find(row => row.rowNo === 7)!.cells.slice(2, 5).map(cell => cell.value), ['Close', '', '保留原译'])
})
