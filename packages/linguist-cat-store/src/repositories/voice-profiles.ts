/**
 * Voice profiles repository (PB-095, schema v6): per-speaker voice rows
 * (语域/人称/语气标记/禁忌). 同一资料范围的 speaker + textType 重复创建
 * 幂等返回既有行；编辑使用显式 id。
 */

import { randomUUID } from 'node:crypto'
import { TaskGroupsRepository } from './task-groups'
import { deriveStableIdV2 } from '@linguist/cat-core'
import type { CatDatabase } from '../database'
import { StoreNotFoundError } from '../errors'
import {
  voiceProfileFromRow,
  type VoiceProfile,
  type VoiceProfileRow,
} from './rows'

export interface VoiceProfileInput {
  speaker: string
  textType?: string
  register?: string
  person?: string
  toneMarkers?: string[]
  taboos?: string[]
  notes?: string
  updatedBy?: string
}

export interface VoiceProfileUpsertInput extends VoiceProfileInput {
  /** 缺省为创建；给定时只能更新该项目的现有记录。 */
  id?: string
}

export interface VoiceProfileSearch {
  /** Case-insensitive literal substring matched against speaker OR notes. */
  query?: string
  textType?: string
  limit?: number
  offset?: number
}

function stableId(projectId: string, input: VoiceProfileInput): string {
  return deriveStableIdV2('vpr', [projectId, input.speaker, input.textType ?? null])
}

/** Escape LIKE wildcards so query is a literal substring match. */
function likePattern(search: string): string {
  return `%${search.replace(/[\\%_]/g, (c) => `\\${c}`)}%`
}

function buildWhere(projectId: string, filter: VoiceProfileSearch): { where: string; params: unknown[] } {
  const clauses = ['project_id = ?']
  const params: unknown[] = [projectId]
  if (filter.query !== undefined) {
    clauses.push("(speaker LIKE ? ESCAPE '\\' OR notes LIKE ? ESCAPE '\\')")
    const pattern = likePattern(filter.query)
    params.push(pattern, pattern)
  }
  if (filter.textType !== undefined) {
    clauses.push('text_type = ?')
    params.push(filter.textType)
  }
  return { where: `WHERE ${clauses.join(' AND ')}`, params }
}

export class VoiceProfilesRepository {
  constructor(
    private readonly db: CatDatabase,
    private readonly projectId: string,
    private readonly now: () => string = () => new Date().toISOString(),
  ) {}

  private assertWritable(groups: TaskGroupsRepository, id: string, group: string): void {
    const refs = groups.refs().filter(ref => ref.resource_key === 'voice:' + id)
    if (refs.length ? refs.some(ref => ref.scope !== group) : !!group) throw new Error('口吻档案由其他范围持有，请在原归属维护或创建本组条目')
  }

  upsert(input: VoiceProfileUpsertInput, taskGroupId = ''): VoiceProfile {
    return this.db.transaction(`upsert voice profile ${input.id ?? input.speaker}`, () => {
      const groups = new TaskGroupsRepository(this.db, this.now)
      if (taskGroupId) groups.requireActive(taskGroupId)
      if (input.id !== undefined) {
        const existing = this.db.db
          .prepare('SELECT id FROM voice_profiles WHERE id = ? AND project_id = ?')
          .get(input.id, this.projectId)
        if (existing === undefined) throw new StoreNotFoundError('voice profile', input.id)
        this.assertWritable(groups, input.id, taskGroupId)
        this.db.db
          .prepare(
            `UPDATE voice_profiles
             SET speaker = ?, text_type = ?, register = ?, person = ?, tone_markers = ?,
                 taboos = ?, notes = ?, updated_at = ?, updated_by = ?
             WHERE id = ? AND project_id = ?`,
          )
          .run(
            input.speaker,
            input.textType ?? null,
            input.register ?? null,
            input.person ?? null,
            input.toneMarkers !== undefined ? JSON.stringify(input.toneMarkers) : null,
            input.taboos !== undefined ? JSON.stringify(input.taboos) : null,
            input.notes ?? null,
            this.now(),
            input.updatedBy ?? null,
            input.id,
            this.projectId,
          )
        return this.get(input.id)!
      }

      const existing = this.db.db.prepare(`SELECT v.* FROM voice_profiles v WHERE project_id=? AND speaker=? AND text_type IS ?
        AND (EXISTS (SELECT 1 FROM task_resource_refs r WHERE r.resource_key='voice:' || v.id AND r.scope=?)
          OR (?='' AND NOT EXISTS (SELECT 1 FROM task_resource_refs r WHERE r.resource_key='voice:' || v.id))) ORDER BY v.id LIMIT 1`)
        .get(this.projectId, input.speaker, input.textType ?? null, taskGroupId, taskGroupId) as VoiceProfileRow | undefined
      if (existing) return voiceProfileFromRow(existing)
      let id = stableId(this.projectId, input)
      if (this.get(id)) id = deriveStableIdV2('vpr', [this.projectId, randomUUID()])
      groups.ref('voice:' + id, taskGroupId, 'voice:' + id)
      this.db.db
        .prepare(
          `INSERT INTO voice_profiles
           (id, project_id, speaker, text_type, register, person, tone_markers, taboos,
            notes, updated_at, updated_by)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          id,
          this.projectId,
          input.speaker,
          input.textType ?? null,
          input.register ?? null,
          input.person ?? null,
          input.toneMarkers !== undefined ? JSON.stringify(input.toneMarkers) : null,
          input.taboos !== undefined ? JSON.stringify(input.taboos) : null,
          input.notes ?? null,
          this.now(),
          input.updatedBy ?? null,
        )
      return this.get(id) as VoiceProfile
    })
  }

  get(id: string): VoiceProfile | undefined {
    const row = this.db.db
      .prepare('SELECT * FROM voice_profiles WHERE id = ? AND project_id = ?')
      .get(id, this.projectId) as VoiceProfileRow | undefined
    return row === undefined ? undefined : voiceProfileFromRow(row)
  }

  list(filter: VoiceProfileSearch = {}): VoiceProfile[] {
    const { where, params } = buildWhere(this.projectId, filter)
    const rows = this.db.db
      .prepare(`SELECT * FROM voice_profiles ${where} ORDER BY speaker, updated_at, id LIMIT ? OFFSET ?`)
      .all(...params, filter.limit ?? 500, filter.offset ?? 0) as VoiceProfileRow[]
    return rows.map(voiceProfileFromRow)
  }

  count(filter: Omit<VoiceProfileSearch, 'limit' | 'offset'> = {}): number {
    const { where, params } = buildWhere(this.projectId, filter)
    const row = this.db.db
      .prepare(`SELECT COUNT(*) AS n FROM voice_profiles ${where}`)
      .get(...params) as { n: number }
    return Number(row.n)
  }

  delete(id: string, taskGroupId = ''): void {
    this.db.transaction(`delete voice profile ${id}`, () => {
      const groups = new TaskGroupsRepository(this.db, this.now)
      if (taskGroupId) groups.requireActive(taskGroupId)
      this.assertWritable(groups, id, taskGroupId)
      const result = this.db.db
        .prepare('DELETE FROM voice_profiles WHERE id = ? AND project_id = ?')
        .run(id, this.projectId)
      if (Number(result.changes) === 0) throw new StoreNotFoundError('voice profile', id)
      groups.removeRef('voice:' + id, taskGroupId)
    })
  }
}
