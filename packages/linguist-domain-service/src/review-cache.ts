import { createHash } from 'node:crypto'
import { existsSync, readFileSync, statSync, unlinkSync } from 'node:fs'
import { join } from 'node:path'
import { z } from 'zod'
import { writeJsonFileAtomic } from './safe-file'
import { getSemanticReview, type ReviewSegment, type SemanticReview } from './semantic-review'

const Preferences = z.object({ semanticEnabled: z.boolean() }).strict()

/** Shared by CAT, browser snapshots and working copies; targets are never cached. */
export class ReviewCache {
  private jobs = new Map<string, { controller: AbortController; result: Promise<SemanticReview>; running: boolean }>()
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

  async get(cachePath: string, segments: readonly ReviewSegment[], signal?: AbortSignal): Promise<SemanticReview> {
    await this.clearing.get(cachePath)
    if (!this.enabled) return { status: 'disabled' }
    if (signal?.aborted) return { status: 'failed', error: '操作已停止' }
    const key = cachePath + ':' + createHash('sha256').update(JSON.stringify(segments.map(({ id, source }) => [id, source]).sort())).digest('hex')
    let job = this.jobs.get(key)
    const reused = Boolean(job)
    if (!job) {
      const controller = new AbortController()
      const result = getSemanticReview(cachePath, segments, controller.signal)
      job = { controller, result, running: true }
      this.jobs.set(key, job)
      void result.then(value => { job!.running = false; if (value.status === 'failed' && this.jobs.get(key) === job) this.jobs.delete(key) })
    }
    const result = await job.result
    if (signal?.aborted) return { status: 'failed', error: '操作已停止' }
    if (!this.enabled) return { status: 'disabled' }
    return reused && result.status === 'ready' ? { ...result, embedded: 0, cached: result.cached + result.embedded, reusedGroups: true } : result
  }

  info(cachePath: string): { bytes: number; running: boolean } {
    return { bytes: ['', '-wal', '-shm', '-journal'].reduce((sum, suffix) => {
      const stat = statSync(cachePath + suffix, { throwIfNoEntry: false })
      return sum + (stat?.size ?? 0)
    }, 0), running: [...this.jobs].some(([key, job]) => key.startsWith(cachePath + ':') && job.running) }
  }

  private async clearJobs(cachePath?: string): Promise<void> {
    const selected = [...this.jobs].filter(([key]) => cachePath === undefined || key.startsWith(cachePath + ':'))
    for (const [, job] of selected) job.controller.abort()
    await Promise.all(selected.map(([, job]) => job.result))
    for (const [key] of selected) this.jobs.delete(key)
  }

  async clear(cachePath: string): Promise<void> {
    const previous = this.clearing.get(cachePath)
    if (previous) return previous
    const clearing = this.clearJobs(cachePath).then(() => {
      for (const suffix of ['', '-wal', '-shm', '-journal']) if (existsSync(cachePath + suffix)) unlinkSync(cachePath + suffix)
    })
    this.clearing.set(cachePath, clearing)
    try { await clearing } finally { this.clearing.delete(cachePath) }
  }

  dispose(): void { for (const job of this.jobs.values()) job.controller.abort(); this.jobs.clear() }
}
