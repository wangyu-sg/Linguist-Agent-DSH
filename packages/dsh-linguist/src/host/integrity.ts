import { createHash, randomUUID } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { basename, join } from 'node:path'
import { Worker } from 'node:worker_threads'
import type { ProjectIntegrityCheck } from '@linguist/cat-store'
import type { LinguistProjectService } from '@linguist/domain-service'
import type { ManagedFiles } from './files'
import type { MutationBus } from './mutations'
import type { FullIntegrityProgress, IntegrityWorkerInput } from './integrity-worker'

const PROJECT_ID = /^prj-[0-9a-f]{16}$/
const JOB_ID = /^scrub-[0-9a-f-]{36}$/

export const INTEGRITY_OPERATIONS = [
  'linguistIntegrityStart',
  'linguistIntegrityCancel',
  'linguistIntegrityExportReport',
] as const

export interface FullIntegrityReport {
  schemaVersion: 1
  kind: 'full'
  projectId: string
  jobId: string
  executor: 'worker_thread'
  workerThreadId: number
  outcome: 'passed' | 'failed' | 'incomplete'
  startedAt: string
  completedAt: string
  checks: ProjectIntegrityCheck[]
}

export type IntegrityEvent =
  | { projectId: string; jobId: string; state: 'running'; progress: FullIntegrityProgress }
  | { projectId: string; jobId: string; state: 'completed'; report: FullIntegrityReport }
  | { projectId: string; jobId: string; state: 'cancelled' }
  | { projectId: string; jobId: string; state: 'failed'; errorCode: 'WORKER_FAILED' }

interface ActiveScrub {
  projectId: string
  jobId: string
  worker: Worker
  settled: boolean
}

function identifier(value: unknown, field: string, pattern: RegExp): string {
  if (typeof value !== 'string' || !pattern.test(value)) throw new TypeError(`${field} is invalid`)
  return value
}

/** A real worker per project; the most recent completed report is retained for explicit export. */
export class IntegrityHost {
  private readonly active = new Map<string, ActiveScrub>()
  private readonly reports = new Map<string, FullIntegrityReport>()

  constructor(
    private readonly service: LinguistProjectService,
    private readonly mutations: MutationBus,
    private readonly files: ManagedFiles,
    private readonly workerScript: URL = new URL('./integrity-scrub-worker.js', import.meta.url),
  ) {}

  async dispatch(operation: string, payload: Record<string, unknown>): Promise<unknown> {
    const projectId = identifier(payload.projectId, 'projectId', PROJECT_ID)
    switch (operation) {
      case 'linguistIntegrityStart': return this.start(projectId)
      case 'linguistIntegrityCancel': return this.cancel(projectId, identifier(payload.jobId, 'jobId', JOB_ID))
      case 'linguistIntegrityExportReport': return this.exportReport(projectId, identifier(payload.jobId, 'jobId', JOB_ID))
      default: throw new TypeError(`Unknown Integrity operation: ${operation}`)
    }
  }

  dispose(): void {
    for (const item of this.active.values()) {
      item.settled = true
      void item.worker.terminate()
    }
    this.active.clear()
  }

  private start(projectId: string): { jobId: string } {
    const existing = this.active.get(projectId)
    if (existing) return { jobId: existing.jobId }
    this.service.getProject(projectId)
    const input: IntegrityWorkerInput = {
      projectDir: this.service.getProjectPaths(projectId).projectDir,
      projectId,
      jobId: `scrub-${randomUUID()}`,
      startedAt: new Date().toISOString(),
    }
    const worker = new Worker(this.workerScript, { workerData: input })
    const item: ActiveScrub = { projectId, jobId: input.jobId, worker, settled: false }
    this.active.set(projectId, item)
    worker.on('message', (message: unknown) => {
      if (item.settled || typeof message !== 'object' || message === null) return
      const value = message as { type?: string; progress?: FullIntegrityProgress; report?: FullIntegrityReport }
      if (value.type === 'progress' && value.progress) {
        this.emit({ projectId, jobId: item.jobId, state: 'running', progress: value.progress })
      } else if (value.type === 'report' && value.report?.projectId === projectId && value.report.jobId === item.jobId && value.report.executor === 'worker_thread') {
        item.settled = true
        this.active.delete(projectId)
        this.reports.set(projectId, value.report)
        this.emit({ projectId, jobId: item.jobId, state: 'completed', report: value.report })
      } else if (value.type === 'error') this.fail(item)
    })
    worker.on('error', () => this.fail(item))
    worker.on('exit', () => this.fail(item))
    return { jobId: item.jobId }
  }

  private cancel(projectId: string, jobId: string): { cancelled: boolean } {
    const item = this.active.get(projectId)
    if (!item || item.jobId !== jobId) return { cancelled: false }
    item.settled = true
    this.active.delete(projectId)
    void item.worker.terminate()
    this.emit({ projectId, jobId, state: 'cancelled' })
    return { cancelled: true }
  }

  private async exportReport(projectId: string, jobId: string): Promise<unknown> {
    this.service.getProject(projectId)
    const report = this.reports.get(projectId)
    if (!report || report.jobId !== jobId) throw new Error('No completed Integrity report for this job')
    const content = {
      schemaVersion: 1,
      kind: 'full_integrity_scrub',
      generatedAt: report.completedAt,
      outcome: report.outcome,
      executor: report.executor,
      correlation: { projectFingerprint: createHash('sha256').update(report.projectId).digest('hex') },
      checks: report.checks,
      privacy: {
        redacted: true,
        autoUpload: false,
        contains: { projectId: false, jobId: false, filenames: false, customerText: false, absolutePaths: false, secrets: false, hiddenReasoning: false },
      },
    }
    const bytes = Buffer.from(`${JSON.stringify(content, null, 2)}\n`)
    const directory = join(this.service.rootDir, 'reports', 'integrity')
    await mkdir(directory, { recursive: true, mode: 0o700 })
    const path = join(directory, `${jobId}.json`)
    try { await writeFile(path, bytes, { flag: 'wx', mode: 0o600 }) }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error }
    const stored = await readFile(path)
    if (!stored.equals(bytes)) throw new Error('Existing Integrity report bytes differ from the completed report')
    const sha256 = createHash('sha256').update(stored).digest('hex')
    const filename = `linguist-integrity-${report.completedAt.replace(/[:.]/g, '-')}.json`
    return {
      cancelled: false,
      token: this.files.issueDownload(path, filename),
      filename: basename(filename),
      sha256,
      sizeBytes: stored.byteLength,
      verifiedAt: new Date().toISOString(),
    }
  }

  private fail(item: ActiveScrub): void {
    if (item.settled) return
    item.settled = true
    this.active.delete(item.projectId)
    this.emit({ projectId: item.projectId, jobId: item.jobId, state: 'failed', errorCode: 'WORKER_FAILED' })
  }

  private emit(event: IntegrityEvent): void { this.mutations.publishIntegrity(event.projectId, event) }
}
