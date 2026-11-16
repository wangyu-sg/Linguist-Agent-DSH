import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs'
import { basename, extname, isAbsolute, join, relative } from 'node:path'
import { contextImageFormat, extractContext } from './context-extractor'
import { LINGUIST_FILE_MAX_BYTES } from './contracts'
import { readPickedFileWithinLimit } from './project-file-intake'
import { writeJsonFileAtomic } from './safe-file'
import { workingCopyPath } from './working-copy'
import type { ReviewSegment } from './semantic-review'

export interface ReviewVisual {
  source: string
  path: string
  label: string
  sheet?: string
  row?: number
  rowEnd?: number
  page?: number
}

interface CellMatch { hash: string; sheet: string; row: number; cell?: string }
const textHash = (text: string) => createHash('sha256').update(text.normalize('NFC').replace(/\s+/gu, '')).digest('hex')

/** Preserve original image bytes and locations once per source file, for all task roles. */
export async function prepareReviewVisuals(workspaceRoot: string, files: readonly string[], segments: readonly ReviewSegment[], outputDir?: string) {
  const root = realpathSync(workspaceRoot)
  const output = outputDir ? workingCopyPath(root, outputDir) : root
  const visuals: ReviewVisual[] = []
  const warnings: string[] = []
  const cells: Array<CellMatch & { source: string }> = []
  for (const file of [...new Set(files)]) {
    const ext = extname(file).toLowerCase()
    if (!contextImageFormat(file) && ext !== '.xlsx' && ext !== '.pptx') continue
    try {
      const path = workingCopyPath(root, file)
      if (contextImageFormat(file)) {
        visuals.push({ source: file, path: relative(root, path), label: basename(file) })
        continue
      }
      const { bytes, filename } = await readPickedFileWithinLimit(path, LINGUIST_FILE_MAX_BYTES)
      const hash = createHash('sha256').update('review-visuals-v2').update(bytes).digest('hex')
      let directory = output
      for (const part of [...(outputDir ? [] : ['.linguist']), 'context-images', hash]) {
        directory = join(directory, part)
        mkdirSync(directory, { mode: 0o700, recursive: true })
        directory = realpathSync(directory)
        const within = relative(root, directory)
        if (within.startsWith('..') || isAbsolute(within)) throw new Error('图片缓存目录不在当前工作区内')
      }
      const manifest = join(directory, 'index.json')
      let extracted: { visuals: Omit<ReviewVisual, 'source'>[]; cells: CellMatch[]; warnings: string[] } | undefined
      if (existsSync(manifest)) {
        const cached = JSON.parse(readFileSync(manifest, 'utf8')) as typeof extracted
        if (cached && cached.visuals.every(image => existsSync(join(root, image.path)))) extracted = cached
      }
      if (!extracted) {
        const content = await extractContext(bytes, filename)
        const locations = new Map(content.media.map(image => [image.id, image]))
        const texts = new Map(content.textSections.map(section => [section.id, section.text]))
        const entries: Omit<ReviewVisual, 'source'>[] = []
        const extractedCells: CellMatch[] = []
        for (const anchor of content.anchors) {
          if (anchor.locator.kind === 'sheet' && anchor.locator.row !== undefined && anchor.textSectionId) {
            extractedCells.push({ hash: textHash(texts.get(anchor.textSectionId)!), sheet: anchor.locator.sheet,
              row: anchor.locator.row, ...(anchor.locator.cell ? { cell: anchor.locator.cell } : {}) })
          }
          if (anchor.locator.kind !== 'image' || !anchor.mediaId) continue
          const image = locations.get(anchor.mediaId)!
          const target = join(directory, `${image.id}${extname(image.filename).toLowerCase()}`)
          if (!existsSync(target)) writeFileSync(target, image.bytes, { mode: 0o600 })
          entries.push({ path: relative(root, target), label: anchor.label ?? image.filename,
            ...(anchor.locator.sheet ? { sheet: anchor.locator.sheet } : {}),
            ...(anchor.locator.row === undefined ? {} : { row: anchor.locator.row }),
            ...(anchor.locator.rowEnd === undefined ? {} : { rowEnd: anchor.locator.rowEnd }),
            ...(anchor.locator.page === undefined ? {} : { page: anchor.locator.page }) })
        }
        extracted = { visuals: entries, cells: extractedCells, warnings: content.warnings.map(warning => warning.message) }
        writeJsonFileAtomic(manifest, extracted)
      }
      visuals.push(...extracted.visuals.map(image => ({ ...image, source: file })))
      cells.push(...extracted.cells.map(cell => ({ ...cell, source: file })))
      warnings.push(...extracted.warnings.map(message => `${file}: ${message}`))
      if (ext === '.pptx') warnings.push(`${file}: 提取的是幻灯片内嵌图片；版式、文字或其他形状需查看原幻灯片。`)
    } catch (error) {
      warnings.push(`${file}: 图片准备失败：${error instanceof Error ? error.message : String(error)}；请查看原件。`)
    }
  }
  const byHash = new Map<string, typeof cells>()
  for (const cell of cells) {
    const matches = byHash.get(cell.hash) ?? []
    matches.push(cell)
    byHash.set(cell.hash, matches)
  }
  const units = new Map<string, ReviewSegment[]>()
  for (const segment of segments) {
    const ordinal = segment.context?.meta?.sdlTransUnitOrdinal
    const key = ordinal === undefined ? segment.id : `${segment.assetId ?? ''}:${ordinal}`
    const unit = units.get(key) ?? []
    unit.push(segment)
    units.set(key, unit)
  }
  const positions: Record<string, { source: string; sheet: string; row: number; cell?: string }> = {}
  for (const unit of units.values()) {
    const matches = byHash.get(textHash(unit.map(segment => segment.source).join(''))) ?? []
    if (matches.length !== 1) continue
    const { source, sheet, row, cell } = matches[0]!
    for (const segment of unit) positions[segment.id] = { source, sheet, row, ...(cell ? { cell } : {}) }
  }
  return { visuals, warnings, positions }
}
