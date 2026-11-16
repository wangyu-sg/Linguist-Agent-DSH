import { lstatSync } from 'node:fs'
import { join } from 'node:path'
import { Worker } from 'node:worker_threads'
import { CatStore, type ProjectDatabase } from '@linguist/cat-store'
import type { CatGetTranslationContextResult, SegmentTranslationContext } from '@linguist/cat-tools'
import { workerEntry } from './cat-job-worker-client'
import type { LinguistProjectService } from './project-service'
import type { SemanticReview } from './semantic-review'

export type ReadyReference = Omit<SegmentTranslationContext, 'currentTarget' | 'targetTags'> & {
  status: 'ready'
  shared: CatGetTranslationContextResult['shared']
  projectRules: NonNullable<CatGetTranslationContextResult['projectRules']>
  unprovidedReferences: NonNullable<CatGetTranslationContextResult['unprovidedReferences']>
}
export type ReferenceItem = ReadyReference | { segmentId: string; status: 'failed'; error: string } | { segmentId: string; status: 'platform'; note: string }
type ReferenceJob = {
  projectId: string
  ids: string[]
  monitor: ProjectDatabase
  version: number
  file: { dev: number; ino: number }
  worker: Worker
  active: boolean
  items: Map<string, ReferenceItem>
  waiters: Set<() => void>
  semantic: SemanticReview
  abort: AbortController
}

const jobs = new WeakMap<LinguistProjectService, Map<string, ReferenceJob>>()
const version = (db: ProjectDatabase) => (db.catDb.db.prepare('PRAGMA data_version').get() as { data_version: number }).data_version
const notify = (job: ReferenceJob) => { for (const wake of job.waiters) wake(); job.waiters.clear() }

function stop(job: ReferenceJob): void {
  job.active = false
  job.abort.abort()
  void job.worker.terminate()
  job.monitor.close()
  notify(job)
}

export function disposeWorkingCopyReferences(service: LinguistProjectService, projectId?: string): void {
  const entries = jobs.get(service)
  if (!entries) return
  for (const [key, job] of entries) if (projectId === undefined || projectId === job.projectId) {
    entries.delete(key)
    stop(job)
  }
}

function getJob(service: LinguistProjectService, projectId: string, taskId: string, sourceSha256: string, ids: string[]): ReferenceJob {
  let entries = jobs.get(service)
  if (!entries) { entries = new Map(); jobs.set(service, entries) }
  const key = JSON.stringify([projectId, taskId, sourceSha256])
  let job = entries.get(key)
  if (job) {
    const file = lstatSync(job.monitor.catDb.path, { throwIfNoEntry: false })
    if (!file || file.dev !== job.file.dev || file.ino !== job.file.ino || version(job.monitor) !== job.version
      || JSON.stringify(job.ids) !== JSON.stringify(ids)) {
      entries.delete(key)
      stop(job)
      job = undefined
    }
  }
  if (job) return job
  const monitor = new CatStore({ rootDir: service.rootDir }).openProject(projectId, { readOnly: true })
  const file = lstatSync(monitor.catDb.path)
  const worker = new Worker(workerEntry(), { workerData: {
    kind: 'working-references', request: { rootDir: service.rootDir, projectId, taskId, segmentIds: ids },
  } })
  worker.unref()
  const created: ReferenceJob = { projectId, ids, monitor, version: version(monitor), file, worker,
    active: true, items: new Map(), waiters: new Set(), semantic: { status: 'pending' }, abort: new AbortController() }
  const segments = ids.map(id => monitor.segments.getById(id)!)
  void service.reviewCache.get(join(service.getProjectPaths(projectId).projectDir, 'semantic-cache.sqlite'), segments, created.abort.signal)
    .then(result => { created.semantic = result; notify(created) })
  const fail = (message: string) => {
    if (!created.active) return
    created.active = false
    for (const segmentId of ids) if (!created.items.has(segmentId)) created.items.set(segmentId, { segmentId, status: 'failed', error: message })
    notify(created)
  }
  worker.on('message', (message: { type: string; items?: ReferenceItem[]; message?: string }) => {
    if (message.type === 'references') for (const item of message.items!) created.items.set(item.segmentId, item)
    if (message.type === 'error') fail(message.message ?? '参考资料工作线程失败')
    notify(created)
  })
  worker.on('error', error => fail(error.message))
  worker.on('exit', code => {
    if (created.active && created.items.size < ids.length) fail(`参考资料工作线程提前退出（${code}）`)
    created.active = false
    notify(created)
  })
  entries.set(key, created)
  return created
}

export function prefetchWorkingCopyReferences(service: LinguistProjectService, projectId: string, taskId: string, sourceSha256: string, ids: string[]): void {
  getJob(service, projectId, taskId, sourceSha256, ids)
}

export async function getWorkingCopyReferences(input: {
  service: LinguistProjectService; projectId: string; taskId: string; sourceSha256: string
  allIds: string[]; selectedIds: string[]; wait: boolean; signal?: AbortSignal
}): Promise<{ items: Array<ReferenceItem | { segmentId: string; status: 'pending' }>; semantic: SemanticReview }> {
  for (;;) {
    if (input.signal?.aborted) throw new Error('操作已停止')
    const job = getJob(input.service, input.projectId, input.taskId, input.sourceSha256, input.allIds)
    if (job.active) job.worker.postMessage({ prioritize: input.selectedIds })
    while (input.wait && (job.semantic.status === 'pending' || input.selectedIds.some(id => !job.items.has(id)))) {
      await new Promise<void>((resolve, reject) => {
        const wake = () => { input.signal?.removeEventListener('abort', abort); resolve() }
        const abort = () => { job.waiters.delete(wake); reject(new Error('操作已停止')) }
        job.waiters.add(wake)
        input.signal?.addEventListener('abort', abort, { once: true })
      })
      if (getJob(input.service, input.projectId, input.taskId, input.sourceSha256, input.allIds) !== job) break
    }
    if (getJob(input.service, input.projectId, input.taskId, input.sourceSha256, input.allIds) !== job) continue
    return { items: input.selectedIds.map(segmentId => job.items.get(segmentId) ?? { segmentId, status: 'pending' }), semantic: job.semantic }
  }
}
