import { createHash } from 'node:crypto'
import { existsSync, readFileSync, statSync, unlinkSync } from 'node:fs'
import { join } from 'node:path'
import { z } from 'zod'
import type { LibraryPreparationStatus, LinguistRetrievalProgress, SemanticProgress } from './contracts'
import { loadDatabaseSync } from '@linguist/cat-store'
import { writeJsonFileAtomic } from './safe-file'
import * as semantic from './semantic-review'
import type { ReviewSegment, SemanticReview } from './semantic-review'

const Preferences = z.object({ semanticEnabled: z.boolean() }).strict()

async function waitForResult<T>(work: Promise<T>, signal?: AbortSignal, onAbort?: () => void): Promise<T> {
  signal?.throwIfAborted()
  if (!signal) return work
  const cancelled = Promise.withResolvers<never>()
  const abort = () => { onAbort?.(); cancelled.reject(signal.reason) }
  signal.addEventListener('abort', abort, { once: true })
  try { return await Promise.race([work, cancelled.promise]) } finally { signal.removeEventListener('abort', abort) }
}

type CacheJob<T> = { controller: AbortController; result: Promise<T>; running: boolean; readers: number; progress: SemanticProgress }

type LibraryPreparation = {
  controller: AbortController
  work: Promise<void>
  requestedAt: number
  rerun: boolean
  status: LibraryPreparationStatus
}

function readJob<T>(jobs: Map<string, CacheJob<T>>, key: string, job: CacheJob<T>, signal?: AbortSignal): Promise<T> {
  if (job.running) job.readers++
  return waitForResult(job.result, signal, () => {
    if (job.running && --job.readers === 0) {
      if (jobs.get(key) === job) jobs.delete(key)
      job.controller.abort()
    }
  })
}

/** Shared by CAT, browser snapshots and working copies; targets are never cached. */
export class ReviewCache {
  private jobs = new Map<string, CacheJob<SemanticReview>>()
  private searches = new Map<string, CacheJob<number[][]>>()
  private preparations = new Map<string, LibraryPreparation>()
  private clearing = new Map<string, Promise<void>>()
  private preferences: z.infer<typeof Preferences>
  private readonly preferencePath: string

  constructor(rootDir: string) {
    this.preferencePath = join(rootDir, 'review-preferences.json')
    this.preferences = existsSync(this.preferencePath)
      ? Preferences.parse(JSON.parse(readFileSync(this.preferencePath, 'utf8'))) : { semanticEnabled: true }
  }

  get enabled(): boolean { return this.preferences.semanticEnabled }

  async setEnabled(enabled: boolean): Promise<void> {
    writeJsonFileAtomic(this.preferencePath, { semanticEnabled: enabled })
    this.preferences = { semanticEnabled: enabled }
    if (!enabled) await this.clearJobs()
  }

  async get(cachePath: string, segments: readonly ReviewSegment[], signal?: AbortSignal, taskGroupId = ''): Promise<SemanticReview> {
    await this.clearing.get(cachePath)
    if (!this.enabled) return { status: 'disabled' }
    if (signal?.aborted) return { status: 'failed', error: '操作已停止' }
    const key = cachePath + ':' + taskGroupId + ':' + createHash('sha256').update(JSON.stringify(segments.map(({ id, source }) => [id, source]).sort())).digest('hex')
    let job = this.jobs.get(key)
    const reused = Boolean(job)
    if (!job) {
      const controller = new AbortController()
      const result = semantic.getSemanticReview(cachePath, segments, controller.signal, taskGroupId, progress => { job!.progress = progress })
      job = { controller, result, running: true, readers: 0, progress: { phase: 'loading' } }
      this.jobs.set(key, job)
      void result.then(value => { job!.running = false; if (value.status === 'failed' && this.jobs.get(key) === job) this.jobs.delete(key) })
    }
    let result: SemanticReview
    try { result = await readJob(this.jobs, key, job, signal) }
    catch (error) {
      if (signal?.aborted) return { status: 'failed', error: '操作已停止' }
      throw error
    }
    if (signal?.aborted) return { status: 'failed', error: '操作已停止' }
    if (!this.enabled) return { status: 'disabled' }
    return reused && result.status === 'ready' ? { ...result, embedded: 0, cached: result.cached + result.embedded, reusedGroups: true } : result
  }

  activeProgress(cachePath: string, taskGroupId: string): LinguistRetrievalProgress[] {
    const prefix = cachePath + ':' + taskGroupId + ':'
    const active: LinguistRetrievalProgress[] = []
    for (const [kind, jobs] of [['materials', this.searches], ['segments', this.jobs]] as const) {
      for (const [key, job] of jobs) {
        if (job.running && !job.controller.signal.aborted && key.startsWith(prefix)) active.push({ kind, progress: job.progress })
      }
    }
    const preparation = this.preparationStatus(cachePath, taskGroupId)
    if (preparation.phase === 'running') active.push({ kind: 'materials', progress: preparation.progress })
    return active
  }

  info(cachePath: string): { bytes: number; running: boolean } {
    return { bytes: ['', '-wal', '-shm', '-journal'].reduce((sum, suffix) => {
      const stat = statSync(cachePath + suffix, { throwIfNoEntry: false })
      return sum + (stat?.size ?? 0)
    }, 0), running: [...this.jobs, ...this.searches].some(([key, job]) => key.startsWith(cachePath + ':') && job.running)
      || [...this.preparations].some(([key, job]) => key.startsWith(cachePath + ':') && (job.status.phase === 'queued' || job.status.phase === 'running')) }
  }

  preparationStatus(cachePath: string, taskGroupId: string): LibraryPreparationStatus {
    if (!this.enabled) return { phase: 'disabled' }
    return this.preparations.get(cachePath + ':' + taskGroupId)?.status ?? { phase: 'idle' }
  }

  prepareLibrary(cachePath: string, taskGroupId: string, loadTexts: () => Promise<string[]>): LibraryPreparationStatus {
    if (!this.enabled) return { phase: 'disabled' }
    const key = cachePath + ':' + taskGroupId
    const current = this.preparations.get(key)
    if (current && (current.status.phase === 'queued' || current.status.phase === 'running')) {
      current.requestedAt = Date.now()
      // Queued jobs read the newest library when they start. Running jobs also cover new registrations.
      if (current.status.phase === 'running') current.rerun = true
      current.status = { ...current.status, requestedAt: current.requestedAt }
      return current.status
    }
    const controller = new AbortController()
    const { signal } = controller
    const earlier = [...this.preparations].filter(([otherKey]) => otherKey.startsWith(cachePath + ':')).map(([, job]) => job.work)
    const clearing = this.clearing.get(cachePath)
    const requestedAt = Date.now()
    const job: LibraryPreparation = {
      controller, requestedAt, rerun: false, status: { phase: 'queued', requestedAt },
      work: waitForResult(Promise.allSettled([...earlier, clearing]), signal).then(async () => {
        signal.throwIfAborted()
        let total = 0
        do {
          job.rerun = false
          job.status = { phase: 'running', requestedAt: job.requestedAt, progress: { phase: 'loading' } }
          const texts = await loadTexts()
          signal.throwIfAborted()
          total = texts.length
          if (total) await semantic.searchSemanticMaterials(cachePath, texts, [], signal, taskGroupId, progress => {
            job.status = { phase: 'running', requestedAt: job.requestedAt, progress }
          })
          signal.throwIfAborted()
        } while (job.rerun)
        job.status = { phase: 'ready', requestedAt: job.requestedAt, total }
      }).catch(error => {
        if (!signal.aborted) job.status = { phase: 'failed', requestedAt: job.requestedAt, error: error instanceof Error ? error.message : String(error) }
      }),
    }
    this.preparations.set(key, job)
    return job.status
  }

  async search(cachePath: string, texts: string[], queries: string[], signal?: AbortSignal, taskGroupId = ''): Promise<number[][]> {
    const preparation = this.preparations.get(cachePath + ':' + taskGroupId)
    if (preparation?.status.phase === 'running') await waitForResult(preparation.work, signal)
    const clearing = this.clearing.get(cachePath)
    if (clearing) await waitForResult(clearing, signal)
    signal?.throwIfAborted()
    if (!this.enabled) return []
    const key = cachePath + ':' + taskGroupId + ':' + createHash('sha256').update(JSON.stringify([texts, queries])).digest('hex')
    let job = this.searches.get(key)
    if (!job) {
      const controller = new AbortController()
      const result = semantic.searchSemanticMaterials(cachePath, texts, queries, controller.signal, taskGroupId, progress => { job!.progress = progress })
      job = { controller, result, running: true, readers: 0, progress: { phase: 'loading' } }
      this.searches.set(key, job)
      void result.then(() => { job!.running = false; job!.readers = 0 }, () => {
        job!.running = false
        if (this.searches.get(key) === job) this.searches.delete(key)
      })
    }
    const result = await readJob(this.searches, key, job, signal)
    signal?.throwIfAborted()
    return this.enabled ? result : []
  }

  private async clearJobs(cachePath?: string, taskGroupId?: string): Promise<void> {
    const matches = (key: string) => cachePath === undefined || key.startsWith(cachePath + ':' + (taskGroupId === undefined ? '' : taskGroupId + ':'))
    const selected = [...this.jobs, ...this.searches].filter(([key]) => matches(key))
    const preparations = [...this.preparations].filter(([key]) => matches(key + ':'))
    for (const [key, job] of preparations) {
      job.controller.abort()
      this.preparations.delete(key)
    }
    for (const [, job] of selected) job.controller.abort()
    await Promise.allSettled([...selected.map(([, job]) => job.result), ...preparations.map(([, job]) => job.work)])
    for (const [key, job] of selected) {
      if (this.jobs.get(key) === job) this.jobs.delete(key)
      if (this.searches.get(key) === job) this.searches.delete(key)
    }
  }

  async clear(cachePath: string, taskGroupId?: string): Promise<void> {
    const previous = this.clearing.get(cachePath)
    const preparations = [...this.preparations].filter(([key]) => key.startsWith(cachePath + ':')).map(([, job]) => job.work)
    const clearing = (async () => {
      await previous
      await this.clearJobs(cachePath, taskGroupId)
      if (taskGroupId === undefined) {
        for (const suffix of ['', '-wal', '-shm', '-journal']) if (existsSync(cachePath + suffix)) unlinkSync(cachePath + suffix)
      } else {
        // Other groups may be embedding in the same SQLite transaction. Let them finish.
        await Promise.allSettled([...this.jobs, ...this.searches].filter(([key, job]) => key.startsWith(cachePath + ':') && job.running).map(([, job]) => job.result))
        await Promise.allSettled(preparations)
        if (!existsSync(cachePath)) return
        const db = new (loadDatabaseSync())(cachePath)
        try {
          if (db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='groups'").get()) {
            db.prepare("DELETE FROM groups WHERE substr(key,1,instr(key,':') - 1) = ?").run(taskGroupId)
          }
        } finally { db.close() }
      }
    })()
    this.clearing.set(cachePath, clearing)
    try { await clearing } finally { if (this.clearing.get(cachePath) === clearing) this.clearing.delete(cachePath) }
  }

  dispose(): void {
    for (const job of [...this.jobs.values(), ...this.searches.values()]) job.controller.abort()
    for (const job of this.preparations.values()) job.controller.abort()
    this.jobs.clear(); this.searches.clear(); this.preparations.clear()
  }
}
