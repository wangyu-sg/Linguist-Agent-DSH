import { deriveStableIdV2, matchTmCandidates, tmSourceHash, type Segment, type TmMatchCandidate, type WorkflowStageEvent } from '@linguist/cat-core'
import type { CatDatabase } from '../database'
import { StoreNotFoundError } from '../errors'
import type { RunHarnessRepository } from '../run-harness'

export interface TmUnit extends Pick<TmMatchCandidate,
  'originalTuid' | 'metadata' | 'contextKey' | 'previousSourceHash' | 'nextSourceHash' | 'sourceInline' | 'targetInline'> {
  id: string
  source: string
  target: string
  sourceLocale: string
  targetLocale: string
}

export type TmStoredMatchCandidate = TmMatchCandidate

export interface ApprovedExemplar {
  id: string
  source: string
  target: string
  sourceLocale: string
  targetLocale: string
  speaker: string
  textType: string
  module?: string
  assetId: string
  segmentId: string
  note?: string
  approvedAt: string
}

export interface ApprovedExemplarInput extends Omit<ApprovedExemplar, 'id' | 'approvedAt'> {}

export interface ApprovedExemplarSearch {
  speaker?: string
  textType?: string
  module?: string
  limit?: number
}

export interface TmUnitImportInput {
  source: string
  target: string
  sourceLocale: string
  targetLocale: string
  sourceId: string
  occurrenceKey: string
  originalTuid?: string
  contextKey?: string
  previousSource?: string
  nextSource?: string
  metadata?: Record<string, string | string[]>
  sourceInline?: string
  targetInline?: string
}

export interface ReferenceImportResult {
  imported: number
  unchanged: number
}

export interface TmUnitSearch {
  /** Case-insensitive literal substring matched against source OR target. */
  query?: string
  sourceLocale?: string
  targetLocale?: string
  limit?: number
  offset?: number
}

interface TmUnitRow {
  id: string
  project_id: string
  source: string
  target: string
  source_locale: string
  target_locale: string
  source_id: string | null
  source_hash: string | null
  original_tuid: string | null
  context_key: string | null
  previous_source_hash: string | null
  next_source_hash: string | null
  metadata_json: string | null
  local_metadata_json?: string | null
  source_inline_xml: string | null
  target_inline_xml: string | null
  source_label?: string | null
  source_priority?: number | null
}

type ApprovedExemplarMetadata = Omit<
  ApprovedExemplar,
  'id' | 'source' | 'target' | 'sourceLocale' | 'targetLocale'
>

function parseApprovedExemplar(row: TmUnitRow): ApprovedExemplar | undefined {
  if (row.metadata_json === null) return undefined
  const meta = JSON.parse(row.metadata_json) as Partial<ApprovedExemplarMetadata>
  if (
    typeof meta.speaker !== 'string'
    || typeof meta.textType !== 'string'
    || typeof meta.assetId !== 'string'
    || typeof meta.segmentId !== 'string'
    || typeof meta.approvedAt !== 'string'
  ) return undefined
  return {
    id: row.id,
    source: row.source,
    target: row.target,
    sourceLocale: row.source_locale,
    targetLocale: row.target_locale,
    speaker: meta.speaker,
    textType: meta.textType,
    ...(typeof meta.module === 'string' ? { module: meta.module } : {}),
    assetId: meta.assetId,
    segmentId: meta.segmentId,
    ...(typeof meta.note === 'string' ? { note: meta.note } : {}),
    approvedAt: meta.approvedAt,
  }
}

function stableId(projectId: string, input: TmUnitImportInput): string {
  return deriveStableIdV2('tmuo', [projectId, input.sourceId, input.occurrenceKey])
}

/** Escape LIKE wildcards so query is a literal substring match. */
function likePattern(search: string): string {
  return `%${search.replace(/[\\%_]/g, (c) => `\\${c}`)}%`
}

function tmUnitFromRow(row: TmUnitRow): TmUnit {
  return {
    id: row.id,
    source: row.source,
    target: row.target,
    sourceLocale: row.source_locale,
    targetLocale: row.target_locale,
  }
}

function tmMatchCandidateFromRow(row: TmUnitRow): TmStoredMatchCandidate {
  return {
    unitId: row.id,
    source: row.source,
    target: row.target,
    ...(row.source_label === null || row.source_label === undefined ? {} : { sourceLabel: row.source_label }),
    ...(row.source_priority === null || row.source_priority === undefined ? {} : { sourcePriority: row.source_priority }),
    ...(row.context_key === null ? {} : { contextKey: row.context_key }),
    ...(row.previous_source_hash === null ? {} : { previousSourceHash: row.previous_source_hash }),
    ...(row.next_source_hash === null ? {} : { nextSourceHash: row.next_source_hash }),
    ...(row.original_tuid === null ? {} : { originalTuid: row.original_tuid }),
    ...(row.metadata_json === null
      ? {}
      : { metadata: JSON.parse(row.metadata_json) as Record<string, string | string[]> }),
    ...(row.local_metadata_json == null ? {} : { localMetadata: JSON.parse(row.local_metadata_json) as Record<string, string | string[]> }),
    ...(row.source_inline_xml === null
      ? {}
      : { sourceInline: row.source_inline_xml }),
    ...(row.target_inline_xml === null
      ? {}
      : { targetInline: row.target_inline_xml }),
  }
}

function sameContent(row: TmUnitRow, projectId: string, input: TmUnitImportInput): boolean {
  const metadata = row.metadata_json === null ? undefined : JSON.parse(row.metadata_json) as Record<string, string | string[]>
  return row.project_id === projectId
    && row.source === input.source
    && row.target === input.target
    && row.source_locale === input.sourceLocale
    && row.target_locale === input.targetLocale
    && row.source_id === input.sourceId
    && row.source_hash === tmSourceHash(input.source, input.sourceLocale, input.targetLocale)
    && row.original_tuid === (input.originalTuid ?? null)
    && row.context_key === (input.contextKey ?? null)
    && row.previous_source_hash === (input.previousSource === undefined ? null : tmSourceHash(input.previousSource))
    && row.next_source_hash === (input.nextSource === undefined ? null : tmSourceHash(input.nextSource))
    && JSON.stringify(metadata) === JSON.stringify(input.metadata)
    && row.source_inline_xml === (input.sourceInline ?? null)
    && row.target_inline_xml === (input.targetInline ?? null)
}

function buildWhere(projectId: string, filter: TmUnitSearch): { where: string; params: unknown[] } {
  const clauses = ['project_id = ?']
  const params: unknown[] = [projectId]
  if (filter.query !== undefined) {
    clauses.push("(source LIKE ? ESCAPE '\\' OR target LIKE ? ESCAPE '\\')")
    params.push(likePattern(filter.query), likePattern(filter.query))
  }
  if (filter.sourceLocale !== undefined) {
    clauses.push('source_locale = ?')
    params.push(filter.sourceLocale)
  }
  if (filter.targetLocale !== undefined) {
    clauses.push('target_locale = ?')
    params.push(filter.targetLocale)
  }
  return { where: `WHERE ${clauses.join(' AND ')}`, params }
}

export class TmUnitsRepository {
  private readonly candidates = new Map<string, TmStoredMatchCandidate[]>()
  private dataVersion?: number

  constructor(
    private readonly db: CatDatabase,
    private readonly projectId: string,
    private readonly now: () => string = () => new Date().toISOString(),
    private readonly events?: RunHarnessRepository,
  ) {}

  importMany(inputs: readonly TmUnitImportInput[]): ReferenceImportResult {
    return this.db.transaction('import TM units', () => {
      const find = this.db.db.prepare('SELECT * FROM tm_units WHERE id = ?')
      const insert = this.db.db.prepare(
        `INSERT INTO tm_units
         (id, project_id, source, target, source_locale, target_locale, origin,
          source_id, source_hash, original_tuid, context_key, previous_source_hash,
          next_source_hash, metadata_json, source_inline_xml, target_inline_xml, created_at)
         VALUES (?, ?, ?, ?, ?, ?, NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      const ensureSource = this.db.db.prepare(`
        INSERT OR IGNORE INTO tm_sources
          (id, project_id, kind, display_name, enabled, priority, created_at)
        VALUES (?, ?, ?, ?, 1, 0, ?)
      `)
      let imported = 0
      let unchanged = 0
      for (const input of inputs) {
        const sourceId = input.sourceId
        const approved = sourceId === `approved:${this.projectId}`
        const sourceInserted = ensureSource.run(
          sourceId,
          this.projectId,
          approved ? 'approved' : 'legacy',
          approved ? 'Approved exemplars' : 'Legacy TM',
          this.now(),
        )
        if (Number(sourceInserted.changes) > 0) this.clearCandidates()
        const id = stableId(this.projectId, input)
        const existing = find.get(id) as TmUnitRow | undefined
        if (existing !== undefined) {
          if (!sameContent(existing, this.projectId, input)) {
            throw new Error(`TM content id collision: ${id}`)
          }
          unchanged++
          continue
        }
        insert.run(
          id,
          this.projectId,
          input.source,
          input.target,
          input.sourceLocale,
          input.targetLocale,
          sourceId,
          tmSourceHash(input.source, input.sourceLocale, input.targetLocale),
          input.originalTuid ?? null,
          input.contextKey ?? null,
          input.previousSource === undefined ? null : tmSourceHash(input.previousSource),
          input.nextSource === undefined ? null : tmSourceHash(input.nextSource),
          input.metadata === undefined ? null : JSON.stringify(input.metadata),
          input.sourceInline ?? null,
          input.targetInline ?? null,
          this.now(),
        )
        if (imported === 0) this.clearCandidates()
        imported++
      }
      if (imported > 0) this.events?.appendProjectEvent({ kind: 'project-updated' })
      return { imported, unchanged }
    })
  }

  /** A stage decision is recorded atomically with its TU; it is not customer approval. */
  addConfirmed(segment: Segment, event: WorkflowStageEvent, taskId: string): void {
    this.db.transaction(`record confirmed TM ${segment.id}`, () => {
      const row = this.db.db.prepare(`SELECT * FROM tm_units WHERE project_id = ? AND source_locale = ?
        AND target_locale = ? AND source = ? AND target = ? ORDER BY created_at, id LIMIT 1`)
        .get(this.projectId, segment.sourceLocale, segment.targetLocale, segment.source, segment.target) as TmUnitRow | undefined
      const { event_id: eventId } = this.db.db.prepare('SELECT event_id FROM segment_stage_events WHERE segment_id = ? ORDER BY event_id DESC LIMIT 1')
        .get(segment.id) as { event_id: number }
      const metadata = row?.local_metadata_json ? JSON.parse(row.local_metadata_json) as Record<string, string | string[]> : {}
      const confirmations = Array.isArray(metadata.la_confirmations) ? metadata.la_confirmations : []
      if (confirmations.some(value => (JSON.parse(value) as { eventId: number }).eventId === eventId)) return
      confirmations.push(JSON.stringify({ eventId, projectId: this.projectId, assetId: segment.assetId,
        segmentId: segment.id, revision: event.segmentRevision, taskId, actor: event.actor ?? 'unknown',
        stage: event.stage, confirmedAt: event.createdAt }))
      metadata.la_confirmations = confirmations
      metadata.la_confirmation_count = String(confirmations.length)
      metadata.la_reuse_count ??= '0'
      metadata.la_task_ids = [...new Set([...(Array.isArray(metadata.la_task_ids) ? metadata.la_task_ids : []), taskId])]
      if (row) {
        this.db.db.prepare('UPDATE tm_units SET local_metadata_json = ?, locally_confirmed = 1 WHERE id = ?').run(JSON.stringify(metadata), row.id)
        this.clearCandidates()
      } else {
        const sourceId = `confirmed:${this.projectId}`
        this.db.db.prepare(`INSERT OR IGNORE INTO tm_sources (id, project_id, kind, display_name, enabled, priority, created_at)
          VALUES (?, ?, 'legacy', 'Stage-confirmed TM', 1, 0, ?)`).run(sourceId, this.projectId, event.createdAt)
        const input = { source: segment.source, target: segment.target, sourceLocale: segment.sourceLocale,
          targetLocale: segment.targetLocale, sourceId,
          occurrenceKey: JSON.stringify([segment.sourceLocale, segment.targetLocale, segment.source, segment.target]) }
        this.importMany([input])
        this.db.db.prepare('UPDATE tm_units SET locally_confirmed = 1, local_metadata_json = ? WHERE id = ?').run(JSON.stringify(metadata), stableId(this.projectId, input))
      }
    })
  }

  recordReuse(unitId: string, segment: Segment, target: string, record: { runId: string; segmentId: string; revision: number; actor: string }): void {
    this.db.transaction(`record TM reuse ${unitId}`, () => {
      const row = this.db.db.prepare('SELECT * FROM tm_units WHERE id = ? AND project_id = ?').get(unitId, this.projectId) as TmUnitRow | undefined
      if (!row) throw new StoreNotFoundError('TM unit', unitId)
      if (row.source_locale !== segment.sourceLocale || row.target_locale !== segment.targetLocale) throw new Error('TM reuse language pair does not match the segment')
      const candidate = tmMatchCandidateFromRow(row)
      if (target !== row.target && target !== matchTmCandidates(segment.source, [candidate], { minimumScore: 0 })[0]?.adaptation?.candidate) {
        throw new Error('TM reuse target does not match the original or adapted candidate')
      }
      const metadata = row.local_metadata_json ? JSON.parse(row.local_metadata_json) as Record<string, string | string[]> : {}
      const records = Array.isArray(metadata.la_reuse_records) ? metadata.la_reuse_records : []
      const value = JSON.stringify(record)
      if (records.includes(value)) return
      records.push(value)
      metadata.la_reuse_records = records
      metadata.la_reuse_count = String(records.length)
      metadata.la_last_used_at = this.now()
      this.db.db.prepare('UPDATE tm_units SET local_metadata_json = ? WHERE id = ?').run(JSON.stringify(metadata), unitId)
      this.clearCandidates()
    })
  }

  addApprovedExemplar(input: ApprovedExemplarInput): ApprovedExemplar {
    if (input.target.trim() === '') throw new Error('Approved exemplar target must not be empty')
    return this.db.transaction(`upsert approved exemplar ${input.segmentId}`, () => {
      const existing = this.listApprovedExemplars({
        speaker: input.speaker,
        textType: input.textType,
        limit: Number.MAX_SAFE_INTEGER,
      }).find((item) => item.segmentId === input.segmentId)
      const module = input.module ?? existing?.module
      const note = input.note ?? existing?.note
      if (existing !== undefined
        && existing.source === input.source
        && existing.target === input.target
        && existing.sourceLocale === input.sourceLocale
        && existing.targetLocale === input.targetLocale
        && existing.module === module
        && existing.assetId === input.assetId
        && existing.note === note) {
        return existing
      }
      if (existing !== undefined) {
        this.db.db.prepare('DELETE FROM tm_units WHERE id = ? AND project_id = ?')
          .run(existing.id, this.projectId)
        this.clearCandidates()
      }
      const approvedAt = this.now()
      const metadata: ApprovedExemplarMetadata = {
        speaker: input.speaker,
        textType: input.textType,
        ...(module === undefined ? {} : { module }),
        assetId: input.assetId,
        segmentId: input.segmentId,
        ...(note === undefined ? {} : { note }),
        approvedAt,
      }
      const sourceId = `approved:${this.projectId}`
      const importInput: TmUnitImportInput = {
        source: input.source,
        target: input.target,
        sourceLocale: input.sourceLocale,
        targetLocale: input.targetLocale,
        sourceId,
        occurrenceKey: input.segmentId,
        metadata: metadata as Record<string, string | string[]>,
      }
      this.importMany([importInput])
      const id = stableId(this.projectId, importInput)
      return parseApprovedExemplar(this.db.db
        .prepare('SELECT * FROM tm_units WHERE id = ? AND project_id = ?')
        .get(id, this.projectId) as TmUnitRow)!
    })
  }

  listApprovedExemplars(filter: ApprovedExemplarSearch = {}): ApprovedExemplar[] {
    // ponytail: personal Alpha 线性扫 approved-exemplar 行；超过 10k 条时再加专用索引列。
    const rows = this.db.db
      .prepare(`SELECT * FROM tm_units
        WHERE project_id = ? AND source_id = ?
        ORDER BY created_at DESC, id DESC`)
      .all(this.projectId, `approved:${this.projectId}`) as TmUnitRow[]
    const speaker = filter.speaker?.toLocaleLowerCase()
    return rows
      .map(parseApprovedExemplar)
      .filter((item): item is ApprovedExemplar => item !== undefined)
      .filter((item) => speaker === undefined || item.speaker.toLocaleLowerCase() === speaker)
      .filter((item) => filter.textType === undefined || item.textType === filter.textType)
      .filter((item) => filter.module === undefined || item.module === filter.module)
      .slice(0, filter.limit ?? 5)
  }

  get(id: string): TmUnit | undefined {
    const row = this.db.db
      .prepare('SELECT * FROM tm_units WHERE id = ? AND project_id = ?')
      .get(id, this.projectId) as TmUnitRow | undefined
    return row === undefined ? undefined : tmUnitFromRow(row)
  }

  list(filter: TmUnitSearch = {}): TmUnit[] {
    const { where, params } = buildWhere(this.projectId, filter)
    const rows = this.db.db
      .prepare(`SELECT * FROM tm_units ${where} ORDER BY created_at, id LIMIT ? OFFSET ?`)
      .all(...params, filter.limit ?? 500, filter.offset ?? 0) as TmUnitRow[]
    return rows.map(tmUnitFromRow)
  }

  /** Literal concordance with the actual source and its enabled state, not a scored match. */
  concordance(filter: TmUnitSearch = {}) {
    const { where, params } = buildWhere(this.projectId, filter)
    const rows = this.db.db.prepare(`
      SELECT u.*, s.display_name AS source_label, s.enabled AS source_enabled, s.kind AS source_kind
      FROM (SELECT * FROM tm_units ${where}) AS u
      LEFT JOIN tm_sources AS s ON s.id = u.source_id AND s.project_id = u.project_id
      ORDER BY u.created_at, u.id LIMIT ? OFFSET ?
    `).all(...params, filter.limit ?? 50, filter.offset ?? 0) as Array<TmUnitRow & { source_enabled: number | null; source_kind: string | null }>
    return rows.map(row => {
      const { unitId, ...candidate } = tmMatchCandidateFromRow(row)
      return {
        ...tmUnitFromRow(row),
        ...candidate,
        sourceLabel: row.source_label ?? 'Legacy TM',
        enabled: row.source_enabled !== 0,
        sourceKind: row.source_kind ?? 'legacy',
      }
    })
  }

  count(filter: Omit<TmUnitSearch, 'limit' | 'offset'> = {}): number {
    const { where, params } = buildWhere(this.projectId, filter)
    const row = this.db.db
      .prepare(`SELECT COUNT(*) AS n FROM tm_units ${where}`)
      .get(...params) as { n: number }
    return Number(row.n)
  }

  delete(id: string): void {
    this.db.transaction(`delete TM unit ${id}`, () => {
      const result = this.db.db
        .prepare('DELETE FROM tm_units WHERE id = ? AND project_id = ?')
        .run(id, this.projectId)
      if (Number(result.changes) === 0) throw new StoreNotFoundError('TM unit', id)
      this.clearCandidates()
      this.events?.appendProjectEvent({ kind: 'project-updated' })
    })
  }

  /** Candidate retrieval only; scoring/classification stays in cat-core. */
  listCandidates(
    sourceLocale: string,
    targetLocale: string,
    exactSource?: string,
  ): TmStoredMatchCandidate[] {
    const { data_version: dataVersion } = this.db.db.prepare('PRAGMA data_version').get() as { data_version: number }
    if (this.dataVersion !== dataVersion) {
      this.clearCandidates()
      this.dataVersion = dataVersion
    }
    const exactHash = exactSource === undefined
      ? undefined
      : tmSourceHash(exactSource, sourceLocale, targetLocale)
    const key = JSON.stringify([sourceLocale, targetLocale, exactHash ?? null])
    // An outer transaction may roll back: its reads must not publish or reuse cached rows.
    const cacheable = !this.db.db.isTransaction
    const cached = cacheable ? this.candidates.get(key) : undefined
    if (cached !== undefined) return cached
    const rows = (this.db.schemaVersion < 19 ? this.db.db.prepare(`
      SELECT u.*, NULL AS source_id, NULL AS source_hash, NULL AS original_tuid, NULL AS context_key,
        NULL AS previous_source_hash, NULL AS next_source_hash, NULL AS metadata_json,
        NULL AS source_inline_xml, NULL AS target_inline_xml
      FROM tm_units AS u WHERE u.project_id = ? AND u.source_locale = ? AND u.target_locale = ?
      ORDER BY u.created_at, u.id
    `).all(this.projectId, sourceLocale, targetLocale) : this.db.db.prepare(`
      SELECT u.*, CASE WHEN s.enabled = 0 THEN 'Stage-confirmed TM (source paused)' ELSE s.display_name END AS source_label,
        s.priority AS source_priority
      FROM tm_units AS u
      LEFT JOIN tm_sources AS s ON s.id = u.source_id AND s.project_id = u.project_id
      WHERE u.project_id = ? AND u.source_locale = ? AND u.target_locale = ?
        ${exactHash === undefined ? '' : 'AND u.source_hash = ?'}
        AND (s.id IS NULL OR s.enabled = 1 ${this.db.schemaVersion < 20 ? '' : "OR (u.locally_confirmed = 1 AND s.id <> 'confirmed:' || u.project_id)"})
      ORDER BY COALESCE(s.priority, 0) DESC, u.created_at, u.id
    `).all(
      this.projectId,
      sourceLocale,
      targetLocale,
      ...(exactHash === undefined ? [] : [exactHash]),
    )) as TmUnitRow[]
    const candidates = rows.filter(row => this.db.schemaVersion >= 19 || exactHash === undefined || tmSourceHash(row.source, sourceLocale, targetLocale) === exactHash).map(tmMatchCandidateFromRow)
    if (cacheable) this.candidates.set(key, candidates)
    return candidates
  }

  clearCandidates(): void {
    this.candidates.clear()
  }
}
