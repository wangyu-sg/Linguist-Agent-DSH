import { randomUUID } from 'node:crypto'
import { TaskGroupsRepository } from './task-groups'
import {
  deriveStableIdV2,
  evaluateSegmentTermPolicy,
  type Segment,
  type SegmentTermPolicyEvaluation,
} from '@linguist/cat-core'
import type { CatDatabase } from '../database'
import { StoreNotFoundError } from '../errors'
import type { RunHarnessRepository } from '../run-harness'
import type { ReferenceImportResult } from './tm-units'

export type TermEntryStatus = 'allowed' | 'preferred' | 'required' | 'forbidden' | 'deprecated'

export interface TermEntry {
  id: string
  term: string
  translation: string
  status: TermEntryStatus
  caseSensitive: boolean
  note?: string
  /** PB-095：术语所属模块/分类/配图（blobs/ 相对路径），均为可空标注。 */
  module?: string
  category?: string
  imageRef?: string
  sources?: Array<{ id: string; filename: string; sha256: string; term: string; translation: string; note?: string }>
}

export interface TermEntryImportInput {
  term: string
  translation: string
  status: TermEntryStatus
  caseSensitive: boolean
  note?: string
  module?: string
  category?: string
  imageRef?: string
}

export interface TermEntryUpsertInput extends TermEntryImportInput {
  id?: string
}

export interface TermEntrySearch {
  taskGroupId?: string
  /** Case-insensitive literal substring matched against term OR translation. */
  query?: string
  status?: TermEntryStatus
  limit?: number
  offset?: number
}

export interface TermMatchOptions {
  taskGroupId?: string
  text: string
  statuses?: readonly TermEntryStatus[]
  limit?: number
  module?: string
  category?: string
}

export interface TermMatchManyOptions extends Omit<TermMatchOptions, 'text'> {
  texts: readonly string[]
}

export type TermMatchType = 'exact' | 'contains'

export interface TermEntryMatch extends TermEntry {
  matchType: TermMatchType
  conflict: boolean
  start: number
  end: number
  lowDiscrimination: boolean
}

export interface TermEntryConflict {
  normalizedTerm: string
  entries: TermEntry[]
}

export interface TermValidationResult {
  missingRequired: Array<{ segmentId: string; termId: string; term: string; expected: string }>
  forbiddenHits: Array<{ segmentId: string; termId: string; forbidden: string }>
  preferredNotUsed: Array<{ segmentId: string; termId: string; term: string; preferred: string }>
  unresolvedConflicts: Array<{ segmentId: string; term: string; termIds: string[] }>
}

interface TermEntryRow {
  id: string
  project_id: string
  term: string
  translation: string
  status: TermEntryStatus
  case_sensitive: number
  note: string | null
  module: string | null
  category: string | null
  image_ref: string | null
  created_at: string
}

function stableId(projectId: string, input: TermEntryImportInput): string {
  return deriveStableIdV2('ter', [
    projectId,
    input.term,
    input.translation,
    input.status,
    input.caseSensitive,
  ])
}

function contentKey(input: Pick<TermEntryImportInput, 'term' | 'translation' | 'status' | 'caseSensitive'>): string {
  return JSON.stringify([input.term, input.translation, input.status, input.caseSensitive])
}

/** Escape LIKE wildcards so query is a literal substring match. */
function likePattern(search: string): string {
  return `%${search.replace(/[\\%_]/g, (c) => `\\${c}`)}%`
}

function termEntryFromRow(row: TermEntryRow): TermEntry {
  return {
    id: row.id,
    term: row.term,
    translation: row.translation,
    status: row.status,
    caseSensitive: row.case_sensitive === 1,
    ...(row.note !== null ? { note: row.note } : {}),
    ...(row.module !== null ? { module: row.module } : {}),
    ...(row.category !== null ? { category: row.category } : {}),
    ...(row.image_ref !== null ? { imageRef: row.image_ref } : {}),
  }
}

function buildWhere(projectId: string, filter: TermEntrySearch): { where: string; params: unknown[] } {
  const clauses = ['project_id = ?']
  const params: unknown[] = [projectId]
  if (filter.query !== undefined) {
    clauses.push("(term LIKE ? ESCAPE '\\' OR translation LIKE ? ESCAPE '\\')")
    params.push(likePattern(filter.query), likePattern(filter.query))
  }
  if (filter.status !== undefined) {
    clauses.push('status = ?')
    params.push(filter.status)
  }
  return { where: `WHERE ${clauses.join(' AND ')}`, params }
}

function normalizeText(value: string, foldCase = true): string {
  const normalized = value.normalize('NFKC').replace(/\s+/gu, ' ').trim()
  return foldCase ? normalized.toLowerCase() : normalized
}

const graphemes = new Intl.Segmenter(undefined, { granularity: 'grapheme' })

function normalizedTextWithOffsets(value: string, foldCase: boolean) {
  const normalized = value.normalize('NFKC')
  const positions = new Map<string, { indices: number[]; next: number }>()
  for (let i = 0; i < normalized.length;) {
    const char = String.fromCodePoint(normalized.codePointAt(i)!)
    for (const decomposed of char.normalize('NFD')) {
      const bucket = positions.get(decomposed) ?? { indices: [], next: 0 }
      bucket.indices.push(i)
      positions.set(decomposed, bucket)
    }
    i += char.length
  }
  const originalSpans = new Map<number, { start: number; end: number }>()
  // NFD of the whole NFKC result has the same decomposed scalars as NFKD of
  // the original; equal scalars keep their order through canonical reordering.
  for (const part of graphemes.segment(value)) {
    const span = { start: part.index, end: part.index + part.segment.length }
    for (const char of part.segment.normalize('NFKD')) {
      const bucket = positions.get(char)!
      const index = bucket.indices[bucket.next++]!
      const previous = originalSpans.get(index)
      originalSpans.set(index, previous === undefined ? span : {
        start: Math.min(previous.start, span.start), end: Math.max(previous.end, span.end),
      })
    }
  }
  let text = ''
  let offsets: Array<{ start: number; end: number }> = []
  for (let i = 0; i < normalized.length;) {
    const char = String.fromCodePoint(normalized.codePointAt(i)!)
    const span = originalSpans.get(i)!
    if (/\s/u.test(char)) {
      if (text && text.endsWith(' ')) offsets[offsets.length - 1]!.end = span.end
      else if (text) { text += ' '; offsets.push({ ...span }) }
    } else {
      text += char
      for (let j = 0; j < char.length; j++) offsets.push({ ...span })
    }
    i += char.length
  }
  if (text.endsWith(' ')) { text = text.slice(0, -1); offsets.pop() }
  if (foldCase) {
    const foldedOffsets: typeof offsets = []
    for (let i = 0; i < text.length;) {
      const char = String.fromCodePoint(text.codePointAt(i)!)
      for (let j = 0; j < char.toLowerCase().length; j++) foldedOffsets.push(offsets[i]!)
      i += char.length
    }
    text = text.toLowerCase()
    offsets = foldedOffsets
  }
  return { text, offsets }
}

function termPattern(term: string): RegExp {
  const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return new RegExp(`(?<![\\p{L}\\p{N}_])${escaped}(?![\\p{L}\\p{N}_])`, 'gu')
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0
}

function cleanInput<T extends TermEntryImportInput>(input: T): T {
  const term = input.term.trim()
  const translation = input.translation.trim()
  if (term === '' || translation === '') throw new TypeError('term and translation must be non-empty')
  return { ...input, term, translation }
}

function bucketKey(value: string): string | undefined {
  const normalized = normalizeText(value)
  const han = normalized.match(/\p{Script=Han}/u)?.[0]
  if (han !== undefined) return `h:${han}`
  const token = normalized.match(/[\p{L}\p{N}_]+/u)?.[0]
  return token === undefined ? [...normalized][0] === undefined ? undefined : `c:${[...normalized][0]}` : `t:${token}`
}

function textBucketKeys(value: string): Set<string> {
  const normalized = normalizeText(value)
  const keys = new Set<string>()
  for (const char of normalized.match(/\p{Script=Han}/gu) ?? []) keys.add(`h:${char}`)
  for (const token of normalized.match(/[\p{L}\p{N}_]+/gu) ?? []) keys.add(`t:${token}`)
  for (const char of normalized) if (!/\s/u.test(char)) keys.add(`c:${char}`)
  return keys
}

function occurrences(text: string, term: string, wholeToken = false): Array<{ start: number; end: number }> {
  if (term === '') return []
  if (wholeToken || !/\p{Script=Han}/u.test(term)) {
    return [...text.matchAll(termPattern(term))].map((match) => ({
      start: match.index,
      end: match.index + match[0].length,
    }))
  }
  const result: Array<{ start: number; end: number }> = []
  for (let start = text.indexOf(term); start >= 0; start = text.indexOf(term, start + Math.max(1, term.length))) {
    result.push({ start, end: start + term.length })
  }
  return result
}

interface CompiledTermbase {
  hidden: Set<string>
  rows: TermEntryRow[]
  buckets: Map<string, TermEntryRow[]>
}

interface PositionedMatch {
  row: TermEntryRow
  matchType: TermMatchType
  start: number
  end: number
  lowDiscrimination: boolean
  contextRank: number
}

export class TermEntriesRepository {
  private compiled?: CompiledTermbase
  private compiledScope?: string
  private compiledVersion?: number

  private visibility(group?: string) {
    const hidden = new Set([...new TaskGroupsRepository(this.db, this.now).hidden(group)].filter(key => key.startsWith('reference:') || key.startsWith('term:')))
    const keys = JSON.stringify([...hidden].sort())
    const sql = hidden.size ? ` AND (('term:' || term_entries.id NOT IN (SELECT value FROM json_each(?))
        AND (NOT EXISTS (SELECT 1 FROM term_entry_sources s WHERE s.term_id=term_entries.id) OR EXISTS (SELECT 1 FROM task_resource_refs r WHERE r.resource_key='term:' || term_entries.id)))
        OR EXISTS (SELECT 1 FROM term_entry_sources s WHERE s.term_id=term_entries.id AND 'reference:' || s.reference_id NOT IN (SELECT value FROM json_each(?))))` : ''
    return { sql, params: hidden.size ? [keys, keys] : [], hidden, keys }
  }


  constructor(
    private readonly db: CatDatabase,
    private readonly projectId: string,
    private readonly now: () => string = () => new Date().toISOString(),
    private readonly events?: RunHarnessRepository,
  ) {}

  importMany(inputs: readonly TermEntryImportInput[], referenceId?: string): ReferenceImportResult {
    return this.db.transaction('import term entries', () => {
      const find = this.db.db.prepare('SELECT * FROM term_entries WHERE id = ?')
      const existingContent = new Map(
        (this.db.db.prepare(`SELECT id, term, translation, status, case_sensitive FROM term_entries WHERE project_id = ?
          ${referenceId ? 'AND EXISTS (SELECT 1 FROM term_entry_sources s WHERE s.term_id=term_entries.id)' : ''}`)
          .all(this.projectId) as Array<Pick<TermEntryRow, 'id' | 'term' | 'translation' | 'status' | 'case_sensitive'>>)
          .map((row) => [contentKey({
            term: row.term,
            translation: row.translation,
            status: row.status,
            caseSensitive: row.case_sensitive === 1,
          }), row.id] as const),
      )
      const link = this.db.db.prepare(`INSERT OR IGNORE INTO term_entry_sources
        (term_id, reference_id, source_term, source_translation, source_note) VALUES (?, ?, ?, ?, ?)`)
      const insert = this.db.db.prepare(
        `INSERT INTO term_entries
         (id, project_id, term, translation, status, case_sensitive, note, module, category, image_ref, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      let imported = 0
      let unchanged = 0
      for (const rawInput of inputs) {
        const input = cleanInput(rawInput)
        const key = contentKey(input)
        const sameId = existingContent.get(key)
        if (sameId !== undefined) {
          if (referenceId !== undefined) link.run(sameId, referenceId, input.term, input.translation, input.note ?? '')
          unchanged++
          continue
        }
        let id = stableId(this.projectId, input)
        // Keep a scoped manual annotation independent of the same pair arriving from a file.
        if (referenceId && find.get(id)) id = deriveStableIdV2('ter', [this.projectId, 'import', id])
        const existing = find.get(id) as TermEntryRow | undefined
        if (existing !== undefined) {
          if (existing.project_id !== this.projectId) {
            throw new Error(`Term content id collision: ${id}`)
          }
          if (referenceId !== undefined) link.run(id, referenceId, input.term, input.translation, input.note ?? '')
          unchanged++
          continue
        }
        insert.run(
          id,
          this.projectId,
          input.term,
          input.translation,
          input.status,
          Number(input.caseSensitive),
          input.note ?? null,
          input.module ?? null,
          input.category ?? null,
          input.imageRef ?? null,
          this.now(),
        )
        if (referenceId !== undefined) link.run(id, referenceId, input.term, input.translation, input.note ?? '')
        existingContent.set(key, id)
        imported++
      }
      this.compiled = undefined
      if (imported > 0) this.events?.appendProjectEvent({ kind: 'project-updated' })
      return { imported, unchanged }
    })
  }

  countBySource(): Record<string, number> {
    const rows = this.db.db.prepare(`SELECT reference_id, COUNT(*) AS count FROM term_entry_sources
      JOIN term_entries ON term_entries.id = term_id WHERE project_id = ? GROUP BY reference_id`)
      .all(this.projectId) as Array<{ reference_id: string; count: number }>
    return Object.fromEntries(rows.map(row => [row.reference_id, row.count]))
  }

  /** Retire a registered file version after its replacement imported successfully. */
  retireSource(referenceId: string): void {
    this.db.transaction('retire term source', () => {
      const rows = this.db.db.prepare(`SELECT DISTINCT term_id FROM term_entry_sources
        JOIN term_entries ON term_entries.id = term_id WHERE reference_id = ? AND project_id = ?`)
        .all(referenceId, this.projectId) as Array<{ term_id: string }>
      this.db.db.prepare('DELETE FROM term_entry_sources WHERE reference_id = ?').run(referenceId)
      const remove = this.db.db.prepare(`DELETE FROM term_entries WHERE id = ? AND project_id = ?
        AND NOT EXISTS (SELECT 1 FROM term_entry_sources WHERE term_id = term_entries.id)
        AND NOT EXISTS (SELECT 1 FROM task_resource_refs WHERE resource_key='term:' || term_entries.id)`)
      for (const row of rows) remove.run(row.term_id, this.projectId)
      this.compiled = undefined
      this.events?.appendProjectEvent({ kind: 'project-updated' })
    })
  }

  manualEntries(): TermEntry[] {
    const scoped = this.db.schemaVersion >= 21 ? "OR EXISTS (SELECT 1 FROM task_resource_refs WHERE resource_key='term:' || term_entries.id)" : ''
    const rows = this.db.db.prepare(`SELECT * FROM term_entries WHERE project_id=? AND (NOT EXISTS (SELECT 1 FROM term_entry_sources s WHERE s.term_id=term_entries.id)
      ${scoped}) ORDER BY term,id`)
      .all(this.projectId) as TermEntryRow[]
    return rows.map(termEntryFromRow)
  }

  get(id: string): TermEntry | undefined {
    const row = this.db.db
      .prepare('SELECT * FROM term_entries WHERE id = ? AND project_id = ?')
      .get(id, this.projectId) as TermEntryRow | undefined
    return row === undefined ? undefined : this.fromRow(row)
  }

  private fromRow(row: TermEntryRow, hidden?: Set<string>): TermEntry {
    // Read-only pre-upgrade backups have no per-term source links.
    if (this.db.schemaVersion < 20) return termEntryFromRow(row)
    const sources = this.db.db.prepare(`SELECT r.id, r.original_filename AS filename, r.source_sha256 AS sha256,
        s.source_term AS term, s.source_translation AS translation, s.source_note AS note
      FROM term_entry_sources s JOIN reference_imports r ON r.id = s.reference_id
      WHERE s.term_id = ? AND r.project_id = ? ORDER BY r.created_at, r.id, s.source_note`)
      .all(row.id, this.projectId) as Array<{ id: string; filename: string; sha256: string; term: string; translation: string; note: string }>
    const visible = sources.filter(source => !hidden?.has('reference:' + source.id))
    const entry = termEntryFromRow(row)
    if (visible.length && visible.length !== sources.length && sources.some(source => source.note === (row.note ?? ''))) entry.note = visible[0]!.note || undefined
    return { ...entry, ...(visible.length ? { sources: visible.map(({ note, ...source }) => ({ ...source, ...(note ? { note } : {}) })) } : {}) }
  }

  private assertWritable(id: string, group: string): void {
    const groups = new TaskGroupsRepository(this.db, this.now)
    if (group) groups.requireActive(group)
    const refs = groups.refs()
    const entryKey = 'term:' + id
    const refsToEntry = refs.filter(ref => ref.resource_key === entryKey)
    const sources = this.db.db.prepare('SELECT DISTINCT reference_id FROM term_entry_sources WHERE term_id=?').all(id) as { reference_id: string }[]
    const owners = refsToEntry.map(ref => ref.scope)
    for (const source of sources) {
      const links = refs.filter(ref => ref.backing_key === 'reference:' + source.reference_id && ref.scope !== '@retired')
      owners.push(...(links.length ? links.map(ref => ref.scope) : ['']))
    }
    if (!owners.length) owners.push('')
    if (owners.some(scope => scope !== group)) throw new Error('术语由其他范围持有，请在原归属维护或创建本组条目')
  }

  upsert(input: TermEntryUpsertInput, taskGroupId = ''): TermEntry {
    const cleaned = cleanInput(input)
    return this.db.transaction(`upsert term entry ${cleaned.id ?? cleaned.term}`, () => {
      if (cleaned.id !== undefined) {
        const existing = this.db.db
          .prepare('SELECT id FROM term_entries WHERE id = ? AND project_id = ?')
          .get(cleaned.id, this.projectId)
        if (existing === undefined) throw new StoreNotFoundError('term entry', cleaned.id)
        this.assertWritable(cleaned.id, taskGroupId)
        this.db.db
          .prepare(
            `UPDATE term_entries
             SET term = ?, translation = ?, status = ?, case_sensitive = ?, note = ?,
                 module = ?, category = ?, image_ref = ?
             WHERE id = ? AND project_id = ?`,
          )
          .run(
            cleaned.term,
            cleaned.translation,
            cleaned.status,
            Number(cleaned.caseSensitive),
            cleaned.note ?? null,
            cleaned.module ?? null,
            cleaned.category ?? null,
            cleaned.imageRef ?? null,
            cleaned.id,
            this.projectId,
          )
        this.compiled = undefined
        this.events?.appendProjectEvent({ kind: 'project-updated' })
        return { ...cleaned, id: cleaned.id }
      }

      const groups = new TaskGroupsRepository(this.db, this.now)
      if (taskGroupId) groups.requireActive(taskGroupId)
      const key = 'term:'
      // A repeated add reuses the entry in this scope. The same spelling in another scope stays independently editable.
      const same = this.db.db.prepare(`SELECT t.* FROM term_entries t WHERE project_id=? AND term=? AND translation=? AND status=? AND case_sensitive=?
        AND (EXISTS (SELECT 1 FROM task_resource_refs r WHERE r.resource_key='term:' || t.id AND r.scope=?)
          OR (?='' AND NOT EXISTS (SELECT 1 FROM task_resource_refs r WHERE r.resource_key='term:' || t.id)
            AND NOT EXISTS (SELECT 1 FROM term_entry_sources WHERE term_id=t.id))) ORDER BY created_at,id LIMIT 1`)
        .get(this.projectId, cleaned.term, cleaned.translation, cleaned.status, Number(cleaned.caseSensitive), taskGroupId, taskGroupId) as TermEntryRow | undefined
      if (same) return termEntryFromRow(same)
      let id = stableId(this.projectId, cleaned)
      if (this.db.db.prepare('SELECT 1 FROM term_entries WHERE id=?').get(id)) id = deriveStableIdV2('ter', [this.projectId, randomUUID()])
      groups.ref(key + id, taskGroupId, key + id)
      this.db.db
        .prepare(
          `INSERT INTO term_entries
           (id, project_id, term, translation, status, case_sensitive, note, module, category, image_ref, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          id,
          this.projectId,
          cleaned.term,
          cleaned.translation,
          cleaned.status,
          Number(cleaned.caseSensitive),
          cleaned.note ?? null,
          cleaned.module ?? null,
          cleaned.category ?? null,
          cleaned.imageRef ?? null,
          this.now(),
        )
      this.compiled = undefined
      this.events?.appendProjectEvent({ kind: 'project-updated' })
      return { ...cleaned, id }
    })
  }

  list(filter: TermEntrySearch = {}): TermEntry[] {
    const visible = this.visibility(filter.taskGroupId)
    const base = buildWhere(this.projectId, filter)
    const where = base.where + visible.sql, params = [...base.params, ...visible.params]
    const rows = this.db.db
      .prepare(`SELECT * FROM term_entries ${where} ORDER BY created_at, id LIMIT ? OFFSET ?`)
      .all(...params, filter.limit ?? 500, filter.offset ?? 0) as TermEntryRow[]
    return rows.map(row => this.fromRow(row, visible.hidden))
  }

  /** 现有只读工具使用的检索别名。 */
  search(filter: TermEntrySearch = {}): TermEntry[] {
    return this.list(filter)
  }

  count(filter: Omit<TermEntrySearch, 'limit' | 'offset'> = {}): number {
    const visible = this.visibility(filter.taskGroupId)
    const base = buildWhere(this.projectId, filter)
    const where = base.where + visible.sql, params = [...base.params, ...visible.params]
    const row = this.db.db
      .prepare(`SELECT COUNT(*) AS n FROM term_entries ${where}`)
      .get(...params) as { n: number }
    return Number(row.n)
  }

  delete(id: string, taskGroupId = ''): void {
    this.db.transaction(`delete term entry ${id}`, () => {
      this.assertWritable(id, taskGroupId)
      const result = this.db.db
        .prepare('DELETE FROM term_entries WHERE id = ? AND project_id = ?')
        .run(id, this.projectId)
      if (Number(result.changes) === 0) throw new StoreNotFoundError('term entry', id)
      this.db.db.prepare('DELETE FROM task_resource_refs WHERE resource_key=?').run('term:' + id)
      this.compiled = undefined
      this.events?.appendProjectEvent({ kind: 'project-updated' })
    })
  }

  private compile(group?: string): CompiledTermbase {
    const visible = this.visibility(group)
    const { data_version: version } = this.db.db.prepare('PRAGMA data_version').get() as { data_version: number }
    const cacheable = this.db.readOnly || !this.db.db.isTransaction
    if (cacheable && this.compiledVersion === version && this.compiled !== undefined && this.compiledScope === visible.keys) return this.compiled
    const rows = this.db.db
      .prepare('SELECT * FROM term_entries WHERE project_id = ?' + visible.sql)
      .all(this.projectId, ...visible.params) as TermEntryRow[]
    const buckets = new Map<string, TermEntryRow[]>()
    for (const row of rows) {
      const key = bucketKey(row.term)
      if (key === undefined) continue
      const bucket = buckets.get(key) ?? []
      bucket.push(row)
      buckets.set(key, bucket)
    }
    if (!cacheable) return { rows, buckets, hidden: visible.hidden }
    this.compiledVersion = version
    this.compiledScope = visible.keys
    this.compiled = { rows, buckets, hidden: visible.hidden }
    return this.compiled
  }

  private applicable(
    row: TermEntryRow,
    options: Pick<TermMatchOptions, 'module' | 'category'>,
  ): boolean {
    return (options.module === undefined || row.module === null || row.module === options.module)
      && (options.category === undefined || row.category === null || row.category === options.category)
  }

  listConflicts(
    options: Pick<TermMatchOptions, 'statuses' | 'module' | 'category' | 'taskGroupId'> = {},
  ): TermEntryConflict[] {
    const statuses = options.statuses === undefined ? undefined : new Set(options.statuses)
    const compiled = this.compile(options.taskGroupId)
    const groups = Map.groupBy(
      compiled.rows.filter((row) =>
        (statuses === undefined || statuses.has(row.status)) && this.applicable(row, options)),
      (row) => normalizeText(row.term),
    )
    return [...groups.entries()]
      .filter(([term, rows]) => term !== '' && new Set(rows.map((row) => normalizeText(row.translation))).size > 1)
      .map(([normalizedTerm, rows]) => ({
        normalizedTerm,
        entries: rows.map(row => this.fromRow(row, compiled.hidden)).sort((left, right) => compareText(left.id, right.id)),
      }))
      .sort((left, right) => compareText(left.normalizedTerm, right.normalizedTerm))
  }

  findMatches(options: TermMatchOptions): TermEntryMatch[] {
    return this.findMatchesMany({
      texts: [options.text], taskGroupId: options.taskGroupId,
      ...(options.statuses !== undefined ? { statuses: options.statuses } : {}),
      ...(options.limit !== undefined ? { limit: options.limit } : {}),
      ...(options.module !== undefined ? { module: options.module } : {}),
      ...(options.category !== undefined ? { category: options.category } : {}),
    }).get(options.text) ?? []
  }

  findMatchesMany(options: TermMatchManyOptions): ReadonlyMap<string, TermEntryMatch[]> {
    const compiled = this.compile(options.taskGroupId)
    return new Map(options.texts.map((text) => [
      text,
      this.matchRows(compiled, text, options),
    ]))
  }

  private matchRows(
    compiled: CompiledTermbase,
    rawText: string,
    options: Omit<TermMatchOptions, 'text'>,
  ): TermEntryMatch[] {
    const statuses = options.statuses === undefined ? undefined : new Set(options.statuses)
    const rows = new Map<string, TermEntryRow>()
    for (const key of textBucketKeys(rawText)) {
      for (const row of compiled.buckets.get(key) ?? []) rows.set(row.id, row)
    }
    const positioned: PositionedMatch[] = []
    const normalized = new Map<boolean, ReturnType<typeof normalizedTextWithOffsets>>()
    for (const row of rows.values()) {
      if ((statuses !== undefined && !statuses.has(row.status)) || !this.applicable(row, options)) continue
      const foldCase = row.case_sensitive !== 1
      let source = normalized.get(foldCase)
      if (source === undefined) { source = normalizedTextWithOffsets(rawText, foldCase); normalized.set(foldCase, source) }
      const { text, offsets } = source
      const term = normalizeText(row.term, foldCase)
      const lowDiscrimination = [...term].length === 1
      const contextMatched = (row.module !== null && row.module === options.module)
        || (row.category !== null && row.category === options.category)
      const spans = text === term
        ? [{ start: 0, end: text.length }]
        : occurrences(text, term, lowDiscrimination && !contextMatched)
      for (const span of spans) positioned.push({
        row,
        matchType: text === term ? 'exact' : 'contains',
        start: offsets[span.start]!.start,
        end: offsets[span.end - 1]!.end,
        lowDiscrimination,
        contextRank: contextMatched ? 0 : row.module === null && row.category === null ? 1 : 2,
      })
    }
    const statusRank: Record<TermEntryStatus, number> = {
      required: 0,
      forbidden: 1,
      preferred: 2,
      allowed: 3,
      deprecated: 4,
    }
    positioned.sort((left, right) =>
      Number(left.matchType === 'contains') - Number(right.matchType === 'contains')
      || left.contextRank - right.contextRank
      || normalizeText(right.row.term).length - normalizeText(left.row.term).length
      || statusRank[left.row.status] - statusRank[right.row.status]
      || left.start - right.start
      || compareText(normalizeText(left.row.term), normalizeText(right.row.term))
      || compareText(normalizeText(left.row.translation), normalizeText(right.row.translation))
      || compareText(left.row.id, right.row.id),
    )
    const selected: PositionedMatch[] = []
    for (const candidate of positioned) {
      const sameTermAndSpan = selected.some((match) =>
        match.start === candidate.start
        && match.end === candidate.end
        && normalizeText(match.row.term) === normalizeText(candidate.row.term))
      const overlaps = selected.some((match) =>
        candidate.start < match.end && match.start < candidate.end)
      if (overlaps && !sameTermAndSpan) continue
      selected.push(candidate)
    }
    const conflictTranslations = new Map<string, Set<string>>()
    for (const match of selected) {
      const key = normalizeText(match.row.term)
      const translations = conflictTranslations.get(key) ?? new Set<string>()
      translations.add(normalizeText(match.row.translation))
      conflictTranslations.set(key, translations)
    }
    return selected.slice(0, options.limit ?? 20).map((match) => ({
      ...this.fromRow(match.row, compiled.hidden),
      matchType: match.matchType,
      conflict: (conflictTranslations.get(normalizeText(match.row.term))?.size ?? 0) > 1,
      start: match.start,
      end: match.end,
      lowDiscrimination: match.lowDiscrimination,
    }))
  }

  evaluateSegment(
    segment: Segment,
    target = segment.target,
    taskGroupId = new TaskGroupsRepository(this.db, this.now).groupOf(segment.assetId),
  ): SegmentTermPolicyEvaluation<TermEntryMatch> {
    const module = segment.context?.meta?.module
    const category = segment.context?.meta?.category
    return evaluateSegmentTermPolicy({
      source: segment.source,
      target,
      sourceLocale: segment.sourceLocale,
      targetLocale: segment.targetLocale,
      assetId: segment.assetId as string,
      ...(module === undefined ? {} : { module }),
      ...(category === undefined ? {} : { category }),
      segmentMetadata: segment.context?.meta ?? {},
      candidates: this.findMatches({
        text: segment.source, taskGroupId,
        limit: Number.MAX_SAFE_INTEGER,
        ...(module === undefined ? {} : { module }),
        ...(category === undefined ? {} : { category }),
      }),
    })
  }

  validateSegments(segments: readonly Segment[]): TermValidationResult {
    const result: TermValidationResult = {
      missingRequired: [],
      forbiddenHits: [],
      preferredNotUsed: [],
      unresolvedConflicts: [],
    }
    for (const segment of segments) {
      const evaluated = this.evaluateSegment(segment).matches
      const seen = new Set<string>()
      for (const item of evaluated) {
        const match = item.match
        if (seen.has(match.id)) continue
        seen.add(match.id)
        if (match.status === 'required' && item.enforcement === 'hard' && !item.targetUsed) {
          result.missingRequired.push({
            segmentId: segment.id as string,
            termId: match.id,
            term: match.term,
            expected: match.translation,
          })
        } else if (match.status === 'forbidden' && item.enforcement === 'hard' && item.targetUsed) {
          result.forbiddenHits.push({
            segmentId: segment.id as string,
            termId: match.id,
            forbidden: match.translation,
          })
        } else if (match.status === 'preferred' && !item.targetUsed) {
          result.preferredNotUsed.push({
            segmentId: segment.id as string,
            termId: match.id,
            term: match.term,
            preferred: match.translation,
          })
        }
      }
      const conflictGroups = Map.groupBy(
        evaluated.map((item) => item.match).filter((match) => match.conflict),
        (match) => normalizeText(match.term),
      )
      for (const [term, entries] of conflictGroups) {
        result.unresolvedConflicts.push({
          segmentId: segment.id as string,
          term,
          termIds: [...new Set(entries.map((entry) => entry.id))].sort(compareText),
        })
      }
    }
    return result
  }
}
