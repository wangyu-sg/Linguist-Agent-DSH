import JSZip from 'jszip'
import { columnLettersFromIndex, escapeCellText, scanElements } from './adapters/xlsx'

function cell(reference: string, style: string, value: string): string {
  return value === '' ? `<c r="${reference}" s="${style}" t="n"></c>`
    : `<c r="${reference}" s="${style}" t="inlineStr"><is><t xml:space="preserve">${escapeCellText(value)}</t></is></c>`
}

/** Fill only the input cells of the bundled templates. Keep Excel's native table, formatting and validation. */
export async function fillDeliveryWorkbook(template: Uint8Array, header: readonly [string, string, string, string, string],
  tables: readonly [string[][], string[][], string[][]]): Promise<Uint8Array> {
  const zip = await JSZip.loadAsync(template)
  const headerCells = new Map(['B2', 'E2', 'H2', 'B3', 'E3'].map((reference, index) => [reference, header[index]!]))
  const fail = (detail: string): never => { throw new Error(`交付模板结构无效：${detail}`) }
  for (const [index, data] of tables.entries()) {
    if (index !== 0 && data.length === 0) continue
    const path = `xl/worksheets/sheet${index + 1}.xml`
    const xml = await zip.file(path)!.async('string')
    const [sheet] = scanElements(xml, 'sheetData', 0, xml.length, fail)
    const rows = scanElements(xml, 'row', sheet!.innerStart, sheet!.innerEnd, fail)
    const first = index === 0 ? 6 : 4
    const sample = rows[first - 1]!
    const styles = scanElements(xml, 'c', sample.innerStart, sample.innerEnd, fail).map(item => / s="(\d+)"/.exec(item.attrsRaw)![1]!)
    let prefix = xml.slice(0, sample.start)
    if (index === 0) prefix = prefix.replace(/<c r="(B2|E2|H2|B3|E3)" s="(\d+)" t="n"><\/c>/g,
      (_match, address: string, style: string) => cell(address, style, headerCells.get(address)!))
    const written = data.map((values, offset) => {
      const row = first + offset
      const attributes = sample.attrsRaw.replace(/ r="\d+"/, ` r="${row}"`)
      return `<row${attributes}>${styles.map((style, col) => cell(columnLettersFromIndex(col) + row, style, values[col]!)).join('')}</row>`
    }).join('')
    const remaining = rows[first - 1 + data.length]?.start ?? sheet!.innerEnd
    let filled = prefix + written + xml.slice(remaining)
    const end = first + data.length - 1
    if (end > rows.length) {
      const lastColumn = columnLettersFromIndex(styles.length - 1)
      const previousEnd = `:${lastColumn}${rows.length}"`
      const nextEnd = `:${lastColumn}${end}"`
      filled = filled.replace(previousEnd, nextEnd)
      const tablePath = `xl/tables/table${index + 1}.xml`
      zip.file(tablePath, (await zip.file(tablePath)!.async('string')).replaceAll(previousEnd, nextEnd))
    }
    zip.file(path, filled)
  }
  return zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' })
}
