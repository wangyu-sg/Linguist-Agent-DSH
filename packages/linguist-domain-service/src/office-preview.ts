import { extname } from 'node:path'
import { parseXlsxWorkbook } from '@linguist/cat-formats'

const PREVIEW_MAX_CHARS = 200_000
const HTML_MAX_CHARS = 1_000_000

function escapeHtml(value: string): string {
  return value.replace(/&/gu, '&amp;').replace(/</gu, '&lt;').replace(/>/gu, '&gt;').replace(/"/gu, '&quot;').replace(/'/gu, '&#39;')
}

export async function readOfficePreviewText(bytes: Uint8Array): Promise<string> {
  const officeParser = await import('officeparser') as unknown as { parseOfficeAsync(file: Buffer): Promise<string> }
  const text = await officeParser.parseOfficeAsync(Buffer.from(bytes))
  if (text.trim() === '') throw new Error('Office document has no readable text')
  return text
}

/** Preview only; extraction never writes to the source or makes a delivery artifact. */
export async function convertOfficePreviewToHtml(bytes: Uint8Array, filename: string): Promise<{ html: string; text?: string }> {
  const extension = extname(filename).toLowerCase()
  if (extension === '.docx') {
    const mammoth = await import('mammoth')
    const buffer = Buffer.from(bytes)
    const converted = await mammoth.convertToHtml({ buffer })
    if (converted.value.length <= HTML_MAX_CHARS) return { html: converted.value }
    const text = (await mammoth.extractRawText({ buffer })).value.slice(0, PREVIEW_MAX_CHARS)
    return { html: `<pre>${escapeHtml(text)}</pre>`, text }
  }
  if (extension === '.pptx') {
    const text = (await readOfficePreviewText(bytes)).slice(0, PREVIEW_MAX_CHARS)
    return { html: `<pre>${escapeHtml(text)}</pre>`, text }
  }
  if (extension !== '.xlsx') throw new TypeError('Unsupported Office preview format')

  const workbook = await parseXlsxWorkbook(bytes, { filename, maxRowsPerSheet: 200 })
  const html: string[] = []
  const plain: string[] = []
  let size = 0
  let truncated = workbook.sheets.length > 8
  for (const sheet of workbook.sheets.slice(0, 8)) {
    const heading = `<h2>${escapeHtml(sheet.name)}</h2><table border="1" cellspacing="0" cellpadding="4">`
    if (size + heading.length > HTML_MAX_CHARS) { truncated = true; break }
    html.push(heading)
    plain.push(`[${sheet.name}]`)
    size += heading.length
    for (const row of [...sheet.skippedRowsAboveHeader, ...sheet.headers, ...sheet.rows]) {
      const cells = row.cells.filter(cell => cell.col < 40)
      const rendered = `<tr><th>${row.rowNo}</th>${cells.map(cell => `<td>${escapeHtml(cell.value.slice(0, 400))}</td>`).join('')}</tr>`
      if (size + rendered.length + 100 > HTML_MAX_CHARS) { truncated = true; break }
      html.push(rendered)
      plain.push(`${row.rowNo}\t${cells.map(cell => cell.value.slice(0, 400)).join('\t')}`)
      size += rendered.length
    }
    html.push('</table>')
    if (truncated) break
  }
  if (truncated || workbook.report.sampling.truncatedSheets.length > 0 || workbook.skippedSheets.length > 0) {
    html.push('<p>预览仅显示部分内容；原始工作簿仍保留。</p>')
  }
  return { html: html.join(''), text: plain.join('\n').slice(0, PREVIEW_MAX_CHARS) }
}
