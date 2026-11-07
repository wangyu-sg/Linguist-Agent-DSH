import { SessionId } from '@deepseek-ai/dsh-session'
import { AsyncLocalStorage } from 'node:async_hooks'
import type { SessionQueryEngine } from '@deepseek-ai/dsh-session-query'
import type { CatReadState, CatReadStateStore } from '@linguist/cat-tools'
import { Type, type Static } from 'typebox'
import { Value } from 'typebox/value'

export const READ_SNAPSHOT_META_SCHEMA = Type.Object({
  kind: Type.Literal('linguist-read-snapshots'),
  sessionId: Type.String(),
  projectId: Type.String(),
  entries: Type.Array(Type.Object({
    id: Type.String(),
    state: Type.Union([
      Type.Object({ kind: Type.Literal('snapshot'), versions: Type.Array(Type.Object({
        segmentId: Type.String(), revision: Type.Integer({ minimum: 0 }), sourceHash: Type.String(),
        appliedRevision: Type.Optional(Type.Integer({ minimum: 0 })),
      })) }),
      Type.Object({ kind: Type.Literal('fragments'), ranges: Type.Array(Type.Object({
        start: Type.Integer({ minimum: 0 }), end: Type.Integer({ minimum: 0 }),
      })) }),
    ]),
  })),
})
export type ReadSnapshotMeta = Static<typeof READ_SNAPSHOT_META_SCHEMA>

/** Rehydrate only Host-issued state from this Session's durable native tool results. */
export class SessionReadSnapshots implements CatReadStateStore {
  private readonly states = new Map<string, CatReadState>()
  private readonly calls = new AsyncLocalStorage<Map<string, CatReadState>>()
  private activeCalls = 0
  private restoration?: Promise<void>

  constructor(private readonly query: Pick<SessionQueryEngine, 'observeSession'>, private readonly sessionId: string, private readonly projectId: string) {}

  restore(): Promise<void> {
    return this.restoration ??= this.restoreSession()
  }

  private async restoreSession(): Promise<void> {
    using observation = await this.query.observeSession(SessionId(this.sessionId), { projectionMode: 'none' })
    if (observation.header.id !== this.sessionId) throw new Error('Read snapshot Session identity changed')
    for (const event of observation.events.slice(observation.inheritedEventCount)) {
      // PTC dispatches persist the same private meta but do not enter the message surface.
      const type: string = event.type
      if (type !== 'tool/result' && type !== 'tool/ptc-dispatch') continue
      const data = event.data as { meta?: unknown; isError?: boolean; message?: { isError?: boolean } }
      if (data.isError || data.message?.isError) continue
      if (typeof data.meta !== 'object' || data.meta === null || !('readSnapshots' in data.meta)) continue
      const meta = data.meta.readSnapshots
      if (typeof meta !== 'object' || meta === null || !('kind' in meta) || meta.kind !== 'linguist-read-snapshots') continue
      if (!Value.Check(READ_SNAPSHOT_META_SCHEMA, meta)) throw new Error('Invalid durable Linguist read snapshot metadata')
      if (meta.sessionId !== this.sessionId || meta.projectId !== this.projectId) continue
      for (const entry of meta.entries) this.states.set(entry.id, this.merge(this.states.get(entry.id), entry.state))
    }
  }

  get(id: string): CatReadState | undefined {
    const current = this.states.get(id), pending = this.calls.getStore()?.get(id)
    return pending === undefined ? current : this.merge(current, pending)
  }

  set(id: string, state: CatReadState): void {
    const changes = this.calls.getStore()
    if (changes === undefined) throw new Error('Read snapshot changes require a native tool execution')
    const previous = this.get(id)
    const delta = state.kind !== 'snapshot' || previous?.kind !== 'snapshot' ? state : {
      kind: 'snapshot' as const,
      versions: state.versions.filter(version => {
        const before = previous.versions.find(item => item.segmentId === version.segmentId)
        return before === undefined || before.revision !== version.revision || before.sourceHash !== version.sourceHash || before.appliedRevision !== version.appliedRevision
      }),
    }
    changes.set(id, this.merge(changes.get(id), delta))
  }

  /** Failed calls publish nothing; successful siblings only merge their own deltas. */
  async run<T extends object>(execute: () => Promise<T>): Promise<T & { readSnapshots?: ReadSnapshotMeta }> {
    await this.restore()
    this.activeCalls++
    try {
      return await this.calls.run(new Map(), async () => {
        const result = await execute()
        const changes = this.calls.getStore()!
        if (changes.size === 0) return result
        for (const [id, state] of changes) this.states.set(id, this.merge(this.states.get(id), state))
        const entries = [...changes].map(([id, state]) => ({ id, state: structuredClone(state) }))
        const readSnapshots = { kind: 'linguist-read-snapshots', sessionId: this.sessionId, projectId: this.projectId, entries } as ReadSnapshotMeta
        return { ...result, readSnapshots }
      })
    } finally {
      if (--this.activeCalls === 0) this.calls.disable()
    }
  }

  private merge(current: CatReadState | undefined, delta: CatReadState): CatReadState {
    if (delta.kind === 'snapshot') {
      const versions = new Map((current?.kind === 'snapshot' ? current.versions : []).map(version => [version.segmentId, version]))
      for (const version of delta.versions) {
        const appliedRevision = versions.get(version.segmentId)?.appliedRevision
        // Surface replacements may append the original read again after its successful save.
        versions.set(version.segmentId, appliedRevision !== undefined && appliedRevision > (version.appliedRevision ?? -1)
          ? { ...version, appliedRevision } : version)
      }
      return { kind: 'snapshot', versions: [...versions.values()] }
    }
    const ranges: Array<{ start: number; end: number }> = []
    for (const range of [...(current?.kind === 'fragments' ? current.ranges : []), ...delta.ranges].sort((a, b) => a.start - b.start)) {
      const last = ranges.at(-1)
      if (last && range.start <= last.end) last.end = Math.max(last.end, range.end)
      else ranges.push({ ...range })
    }
    return { kind: 'fragments', ranges }
  }
}
