import { mkdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fillDeliveryWorkbook, parseXlsxWorkbook, sha256Hex } from '@linguist/cat-formats'
import { z } from 'zod'
import { writeFileAtomic } from './safe-file'
import { readWorkingJson, workingCopyPath } from './working-copy'
import { LINGUIST_FILE_MAX_BYTES } from './contracts'
import { readPickedFileWithinLimit } from './project-file-intake'

export type DeliveryReportKind = 'translation' | 'review'

export async function inspectDeliveryReport(workspaceRoot: string, path: string, batch?: string) {
  const { bytes, filename } = await readPickedFileWithinLimit(workingCopyPath(workspaceRoot, path), LINGUIST_FILE_MAX_BYTES)
  const { sheets, skippedSheets } = await parseXlsxWorkbook(bytes, { filename, maxRowsPerSheet: batch ? undefined : 3 })
  const detail = sheets.find(sheet => sheet.name === '翻译明细' || sheet.name === '审校明细')
  const header = detail && new Map([...detail.headers, ...detail.rows.slice(0, 3)]
    .filter(row => row.rowNo === 2 || row.rowNo === 3).flatMap(row => row.cells.map(cell => [cell.ref, cell.value] as const)))
  const locations = batch && sheets.flatMap(sheet => {
    const matches = sheet.name === batch ? [`页签「${sheet.name}」`] : []
    const task = sheet === detail ? header?.get('B2') : undefined
    if (task?.startsWith(`${batch} / `)) matches.push(`「${sheet.name}」的任务栏 B2 为「${task}」`)
    for (const rows of [sheet.headers, sheet.rows]) {
      for (const row of rows) {
        const cell = row.cells.find(cell => cell.value.trim() === batch)
        if (cell) return [...matches, `「${sheet.name}」的 ${cell.ref} 单元格值为「${cell.value}」`]
      }
    }
    return matches
  })
  return {
    path,
    ...(header && { report: { task: header.get('B2') ?? '', baseline: header.get('E2') ?? '', version: header.get('H2') ?? '',
      collection: header.get('B3') ?? '', scope: header.get('E3') ?? '' } }),
    sheets: sheets.map(sheet => sheet.name),
    ...(batch && { batchCheck: { batch, locations } }),
    skippedSheets: skippedSheets.map(sheet => sheet.name),
  }
}

const cell = z.string().max(32767)
const required = cell.refine(value => value.trim().length > 0, '必须填写')
const translationStatuses = ['定稿', '保留原文', '待确认', '待核术语', '待验结构'] as const
const reviewStatuses = ['采用终稿', '保留原译', '待确认', '待验结构'] as const
const report = z.object({
  task: required, languagePair: required, baseline: required, version: required, scope: required,
  collection: z.enum(['仅决定项与未决', '仅改项与未决', '逐段全量', '指定范围']),
  items: z.array(z.object({
    location: required, source: cell, draft: cell.optional(), final: cell.optional(),
    status: z.enum([...translationStatuses, '采用终稿', '保留原译']),
    reason: cell.optional(), evidence: cell.optional(), questionId: cell.optional(), note: cell.optional(),
  })).max(1_048_571),
  questions: z.array(z.object({
    id: required, affected: required, question: required, evidence: required,
    status: z.enum(['草稿', '已发待答', '已答待复核', '已结案']), answer: cell.optional(), next: cell.optional(),
  })).max(1_048_573).default([]),
  history: z.array(z.object({
    location: required, source: required, target: required, reference: required, version: cell.optional(),
    relation: required, decision: required,
  })).max(1_048_573).default([]),
})

export async function writeDeliveryReport(workspaceRoot: string, dataPath: string, kind: DeliveryReportKind, template: URL) {
  const { value, sha256 } = readWorkingJson(workspaceRoot, dataPath)
  const result = report.safeParse(value)
  if (!result.success) {
    const issue = result.error.issues[0]!
    throw new Error(`交付表 ${issue.path.join('.')}：${issue.message}`)
  }
  const { task, languagePair, baseline, version, scope, collection, items, questions, history } = result.data
  const translation = kind === 'translation'
  if (collection === (translation ? '仅改项与未决' : '仅决定项与未决')) throw new Error('收录口径与交付表类型不符')
  if (collection === '逐段全量' && items.length === 0) throw new Error('逐段全量交付表必须填写明细')
  const questionIds = new Set(questions.map(question => question.id.trim()))
  if (questionIds.size !== questions.length) throw new Error('同一问题只保留一个编号')
  const locations = new Set<string>()
  const details = items.map((item, index) => {
    const row = index + 6
    const location = item.location.trim()
    if (locations.has(location)) throw new Error(`明细第 ${row} 行的句段定位重复：${location}`)
    locations.add(location)
    const statuses: readonly string[] = translation ? translationStatuses : reviewStatuses
    if (!statuses.includes(item.status)) throw new Error(`明细第 ${row} 行的状态与交付表类型不符`)
    if (!translation && item.draft === undefined) throw new Error(`明细第 ${row} 行须填写原译，底稿确为空时填空字符串`)
    const final = item.final ?? ''
    const original = item.status === '保留原文'
    const usable = item.status === '定稿' || original || item.status === '采用终稿'
    if ((usable && !final.trim()) || (!usable && final !== '') || (original && final !== item.source)) {
      throw new Error(`明细第 ${row} 行的译文与处理状态不符`)
    }
    if ((!item.source.trim() || (!translation && !item.draft!.trim()) || item.status !== '保留原译') &&
        (!item.reason?.trim() || !item.evidence?.trim())) throw new Error(`明细第 ${row} 行须填写理由与依据`)
    const question = item.questionId?.trim() ?? ''
    if (question && !questionIds.has(question)) throw new Error(`明细第 ${row} 行引用了不存在的问题号：${question}`)
    const note = [item.reason ?? '', item.evidence ?? '', question]
    return translation ? [location, item.source, final, item.status, ...note, item.note ?? '']
      : [location, item.source, item.draft!, final, item.status, ...note]
  })
  const header = `${task} / ${languagePair}`
  if (header.length > 32767) throw new Error('任务和语对合并后超出 Excel 单元格限制')
  const bytes = await fillDeliveryWorkbook(readFileSync(template), [header, baseline, version, collection, scope], [
    details,
    questions.map(item => [item.id.trim(), item.affected, item.question, item.evidence, item.status, item.answer ?? '', item.next ?? '']),
    history.map(item => [item.location, item.source, item.target, item.reference, item.version ?? '', item.relation, item.decision]),
  ])
  const directory = 'LA交付'
  mkdirSync(join(workspaceRoot, directory), { recursive: true })
  const filename = `${translation ? '翻译交付' : '审校交付'}-${sha256.slice(0, 16)}.xlsx`
  writeFileAtomic(join(workingCopyPath(workspaceRoot, directory), filename), bytes)
  return { kind, path: `${directory}/${filename}`, artifactSha256: sha256Hex(bytes), detailRows: details.length, questions: questions.length, history: history.length }
}
