import { fnv1a64, deriveStableIdV2 } from '@linguist/cat-core'
import { randomUUID } from 'node:crypto'
import { StoreNotFoundError } from '../errors'
import type { CatDatabase } from '../database'

export interface TaskGroup { id: string; name: string; archived: boolean; batchCount: number; createdAt: string }
export type TaskGroupChange =
  | { action: 'create'; name: string }
  | { action: 'rename'; id: string; name: string }
  | { action: 'archive' | 'restore' | 'delete'; id: string }
  | { action: 'moveBatches'; id: string; batchIds: string[] }

interface ResourceRef { resource_key: string; scope: string; backing_key: string; replaces_key: string | null }

export class TaskGroupsRepository {
  constructor(private readonly db: CatDatabase, private readonly now: () => string) {}

  list(): TaskGroup[] {
    if (this.db.schemaVersion < 21) {
      const row = this.db.db.prepare('SELECT count(*) AS count FROM assets').get() as { count: number }
      return [{ id: 'ungrouped', name: '未分组', archived: false, batchCount: row.count, createdAt: '' }]
    }
    const rows = this.db.db.prepare(`SELECT id, name, archived, created_at AS createdAt,
      (SELECT COUNT(*) FROM assets WHERE task_group_id = g.id) + (SELECT COUNT(*) FROM external_batches WHERE group_id = g.id AND asset_id IS NULL) AS batchCount
      FROM task_groups g ORDER BY id <> 'ungrouped', created_at, id`).all() as Array<Omit<TaskGroup, 'archived'> & { archived: number }>
    return rows.map(row => ({ ...row, archived: !!row.archived }))
  }

  groupOf(assetId?: string): string | undefined {
    if (!assetId) return undefined
    if (this.db.schemaVersion < 21) return this.db.db.prepare('SELECT 1 FROM assets WHERE id=?').get(assetId) ? 'ungrouped' : undefined
    return (this.db.db.prepare('SELECT task_group_id AS scope FROM assets WHERE id=? UNION ALL SELECT group_id FROM external_batches WHERE id=?')
      .get(assetId, assetId) as { scope: string } | undefined)?.scope
  }

  assertContains(groupId: string, kind: 'assets' | 'segments' | 'qa_findings' | 'proposals', ids: readonly string[]): void {
    const membership = kind === 'assets' ? 'assets a'
      : kind === 'segments' ? 'segments s JOIN assets a ON a.id = s.asset_id'
      : `${kind} r JOIN segments s ON s.id = r.segment_id JOIN assets a ON a.id = s.asset_id`
    const key = kind === 'assets' ? 'a.id' : kind === 'segments' ? 's.id' : 'r.id'
    const group = this.db.schemaVersion < 21 ? "'ungrouped'" : 'a.task_group_id'
    const row = this.db.db.prepare(`SELECT COUNT(*) AS count FROM ${membership}
      WHERE ${group} = ? AND ${key} IN (SELECT value FROM json_each(?))`).get(groupId, JSON.stringify(ids)) as { count: number }
    if (row.count !== new Set(ids).size) throw new StoreNotFoundError(kind + ' in task group', groupId)
  }

  forAssets(ids: readonly string[], fallback?: string): string | undefined {
    const groups = new Set([...new Set(ids)].map(id => this.groupOf(id)).filter(Boolean))
    if (groups.size > 1) throw new Error('批次属于不同任务组，请按组分别准备资料')
    return groups.values().next().value ?? fallback
  }

  requireActive(id: string): void {
    if (!this.db.db.prepare('SELECT 1 FROM task_groups WHERE id = ? AND archived = 0').get(id)) throw new Error('任务组不存在或已归档')
  }

  change(input: TaskGroupChange): string {
    return this.db.transaction('change task group', () => {
      if (input.action === 'create' || input.action === 'rename') {
        const name = input.name.trim()
        if (!name) throw new Error('请输入任务组名称')
        if (input.action === 'create') {
          const id = randomUUID()
          this.db.db.prepare('INSERT INTO task_groups(id,name,created_at) VALUES (?,?,?)').run(id, name, this.now())
          return id
        }
        this.requireActive(input.id)
        if (input.id === 'ungrouped') throw new Error('未分组是项目默认任务组')
        this.db.db.prepare('UPDATE task_groups SET name=? WHERE id=?').run(name, input.id)
      } else if (input.action === 'moveBatches') {
        this.requireActive(input.id)
        for (const id of new Set(input.batchIds)) {
          const batch = this.db.db.prepare(`SELECT id AS assetId, task_group_id AS groupId, source_sha256 AS digest FROM assets WHERE id=?
            UNION ALL SELECT e.asset_id, COALESCE(a.task_group_id,e.group_id),
              COALESCE(a.source_sha256, CASE WHEN e.kind='working-copy' THEN e.locator END)
            FROM external_batches e LEFT JOIN assets a ON a.id=e.asset_id WHERE e.id=? LIMIT 1`)
            .get(id, id) as { assetId: string | null; groupId: string; digest: string | null } | undefined
          if (!batch) throw new Error('工作批次不存在')
          this.requireActive(batch.groupId)
          if (batch.groupId === input.id) continue
          if (batch.digest && this.db.db.prepare(`SELECT 1 FROM assets WHERE task_group_id=? AND source_sha256=?
            UNION ALL SELECT 1 FROM external_batches WHERE group_id=? AND kind='working-copy' AND locator=? LIMIT 1`)
            .get(input.id, batch.digest, input.id, batch.digest)) throw new Error('目标任务组已有同一原稿的独立批次')
          if (batch.assetId) {
            this.db.db.prepare('UPDATE external_batches SET group_id=? WHERE asset_id=?').run(input.id, batch.assetId)
            this.db.db.prepare('UPDATE assets SET task_group_id=? WHERE id=?').run(input.id, batch.assetId)
          } else this.db.db.prepare('UPDATE external_batches SET group_id=? WHERE id=?').run(input.id, id)
        }
      } else {
        if (input.id === 'ungrouped') throw new Error('未分组是项目默认任务组')
        if (!this.db.db.prepare('SELECT 1 FROM task_groups WHERE id=?').get(input.id)) throw new Error('任务组不存在')
        if (input.action === 'delete') {
          if (this.db.db.prepare('SELECT 1 FROM task_resource_refs WHERE scope=?').get(input.id) || this.list().find(group => group.id === input.id)!.batchCount) throw new Error('请先移动本组批次和资料，或归档任务组')
          this.db.db.prepare('DELETE FROM task_groups WHERE id=?').run(input.id)
        } else this.db.db.prepare('UPDATE task_groups SET archived=? WHERE id=?').run(Number(input.action === 'archive'), input.id)
      }
      return input.id
    })
  }

  externalBatches() {
    if (this.db.schemaVersion < 21) return []
    return this.db.db.prepare('SELECT id,group_id AS taskGroupId,kind,locator,name FROM external_batches WHERE asset_id IS NULL ORDER BY name,id').all() as Array<{ id: string; taskGroupId: string; kind: string; locator: string; name: string }>
  }

  findRegisteredBatch(group: string, kind: 'browser' | 'working-copy', locator: string) {
    if (this.db.schemaVersion < 21) return undefined
    return this.db.db.prepare('SELECT id, asset_id AS assetId FROM external_batches WHERE group_id=? AND kind=? AND locator=?')
      .get(group, kind, locator) as { id: string; assetId: string | null } | undefined
  }

  registerBatch(group: string, kind: 'browser' | 'working-copy', locator: string, name: string, assetId?: string): string {
    return this.db.transaction('register task batch', () => {
      this.requireActive(group)
      if (assetId && !this.db.db.prepare('SELECT 1 FROM assets WHERE id=? AND task_group_id=?').get(assetId, group)) throw new Error('关联的 CAT 批次须属于当前任务组')
      if (!assetId && kind === 'working-copy') {
        assetId = (this.db.db.prepare('SELECT id FROM assets WHERE task_group_id=? AND source_sha256=?').get(group, locator) as { id: string } | undefined)?.id
      }
      const id = deriveStableIdV2('ast', [randomUUID()])
      this.db.db.prepare(`INSERT INTO external_batches(id,group_id,kind,locator,name,asset_id) VALUES (?,?,?,?,?,?)
        ON CONFLICT(group_id,kind,locator) DO UPDATE SET name=excluded.name, asset_id=COALESCE(excluded.asset_id,external_batches.asset_id)`).run(id, group, kind, locator, name, assetId ?? null)
      return (this.db.db.prepare('SELECT COALESCE(asset_id,id) AS id FROM external_batches WHERE group_id=? AND kind=? AND locator=?').get(group, kind, locator) as { id: string }).id
    })
  }

  ref(key: string, group: string, backing: string, replaces?: string): void {
    if (group) this.requireActive(group)
    this.db.db.prepare(`INSERT INTO task_resource_refs VALUES (?,?,?,?) ON CONFLICT(resource_key,scope)
      DO UPDATE SET backing_key=excluded.backing_key,replaces_key=excluded.replaces_key
      WHERE backing_key IS NOT excluded.backing_key OR replaces_key IS NOT excluded.replaces_key`).run(key, group, backing, replaces ?? null)
  }

  updateBacking(key: string, backing: string): void {
    this.db.db.prepare('UPDATE task_resource_refs SET backing_key=? WHERE resource_key=? AND backing_key<>?').run(backing, key, backing)
  }

  // A retired import retains its bytes and evidence for past work. No current scope can match it.
  retireBacking(key: string): boolean {
    if (this.db.db.prepare('SELECT 1 FROM task_resource_refs WHERE backing_key=?').get(key)) return false
    this.db.db.prepare("INSERT INTO task_resource_refs VALUES (?, '@retired', ?, NULL)").run(key, key)
    return true
  }

  removeRef(key: string, group: string): void {
    if (group) this.requireActive(group)
    this.db.db.prepare('DELETE FROM task_resource_refs WHERE resource_key=? AND scope=?').run(key, group)
  }

  refs(): ResourceRef[] {
    if (this.db.schemaVersion < 21) return []
    return this.db.db.prepare('SELECT * FROM task_resource_refs').all() as unknown as ResourceRef[]
  }

  materialVersion(group: string, workingAssetIds?: readonly string[]): string {
    return this.db.readSnapshot(() => this.readMaterialVersion(group, workingAssetIds))
  }

  private readMaterialVersion(group: string, workingAssetIds?: readonly string[]): string {
    const refs = this.refs()
    const hidden = this.hidden(group, refs)
    // Recording a completed segment in local TM must not invalidate its own frozen stage.
    const entries = refs.filter(ref => {
      if (!workingAssetIds && ref.resource_key.startsWith('tm-source:confirmed:')) {
        const originalGroup = ref.resource_key.split(':').at(-2)
        if (originalGroup === group && hidden.has(ref.resource_key)) return true
        if (ref.scope === originalGroup) return false
      }
      return (!ref.scope || ref.scope === group) && !hidden.has(ref.resource_key)
    })
      .map(ref => JSON.stringify([ref.resource_key, ref.backing_key, ref.replaces_key])).sort()
    if (this.db.schemaVersion < 21) return fnv1a64(JSON.stringify([group, entries]))
    // TM imports use a physical source ID derived from their reference ID. Several files can share it.
    const physical = this.db.db.prepare('SELECT project_id FROM reference_imports LIMIT 1').get() as { project_id: string } | undefined
    if (physical) for (const ref of hidden) if (ref.startsWith('reference:')) hidden.add('tm-source:' + deriveStableIdV2('tms', [physical.project_id, ref.slice(10)]))
    const assets = new Set(workingAssetIds?.map(id => 'asset:' + id))
    const revisions = this.db.db.prepare('SELECT resource_key, revision FROM reference_revisions ORDER BY resource_key').all() as { resource_key: string; revision: number }[]
    const visible = revisions.flatMap(({ resource_key: key, revision }) => {
      if (key.startsWith('asset:')) return assets.has(key) ? [revision] : []
      if (key.startsWith('local:')) {
        if (!workingAssetIds) return []
        key = key.slice(6)
      }
      // Stage plans independently verify only the native documents and links in their frozen scope.
      if (!workingAssetIds && (key.startsWith('tm-source:confirmed:') || key.startsWith('document:'))) return []
      return hidden.has(key) ? [] : [revision]
    })
    return fnv1a64(JSON.stringify([group, entries, visible]))
  }

  // Unregistered native project sources are shared. A backing may have several independent references.
  hidden(group = '', refs = this.refs()): Set<string> {
    const replaced = new Set(refs.filter(ref => group && ref.scope === group && ref.replaces_key).map(ref => ref.replaces_key!))
    const hidden = new Set([...replaced, ...refs.flatMap(ref => [ref.resource_key, ref.backing_key])])
    for (const ref of refs) if (ref.scope === group || (!ref.scope && !replaced.has(ref.resource_key))) {
      hidden.delete(ref.resource_key)
      hidden.delete(ref.backing_key)
    }
    return hidden
  }
}
