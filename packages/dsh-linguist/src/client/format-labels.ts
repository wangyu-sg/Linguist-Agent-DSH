const labels: Record<string, string> = {
  xliff_1_2: 'XLIFF 1.2',
  mqxliff_1_2: 'memoQ MQXLIFF',
  sdlxliff_1_2: 'SDL Trados XLIFF',
  phrase_mxliff_1_2: 'Phrase MXLIFF',
  phrase_bilingual_docx_1: 'Phrase 双语 DOCX',
  xlsx_ooxml: 'Excel 工作簿',
  csv_rfc4180: 'CSV 表格',
  json_i18n: 'JSON 国际化',
}

export function describeLinguistFormat(formatId: string): string {
  return labels[formatId] ?? formatId
}

export function isGenericXliffFallback(filename: string, formatId: string): boolean {
  return formatId === 'xliff_1_2' && filename.toLowerCase().endsWith('.mqxliff')
}

export function describeFormatCapability(formatId: string): string | undefined {
  if (formatId === 'mqxliff_1_2') return '专用解析：已启用 · Tag round-trip：合成样例已验证，真实样本待验证'
  if (formatId === 'phrase_mxliff_1_2') return 'Phrase split/master：内容配对已启用 · verified 导出会检查 Tag Mapping'
  return undefined
}
