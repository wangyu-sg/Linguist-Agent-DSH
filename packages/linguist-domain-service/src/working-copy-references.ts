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
  taskGroupId?: string
  ids: string[]
  monitor: ProjectDatabase
  version: number
  materialVersion: string
  assetIds: string[]
  tagProfile: string | undefined
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

export function disposeWorkingCopyReferences(service: LinguistProjectService, projectId?: string, taskGroupId?: string): void {
  const entries = jobs.get(service)
  if (!entries) return
  for (const [key, job] of entries) if ((projectId === undefined || projectId === job.projectId) && (taskGroupId === undefined || taskGroupId === job.taskGroupId)) {
    entries.delete(key)
    stop(job)
  }
}

function getJob(service: LinguistProjectService, projectId: string, taskId: string, sourceSha256: string, ids: string[]): ReferenceJob {
  let entries = jobs.get(service)
  if (!entries) { entries = new Map(); jobs.set(service, entries) }
  const key = JSON.stringify([projectId, taskId, sourceSha256, ids])
  let job = entries.get(key)
  if (job) {
    const file = lstatSync(job.monitor.catDb.path, { throwIfNoEntry: false })
    const dbVersion = version(job.monitor)
    const changed = dbVersion !== job.version && (job.monitor.schemaVersion < 21
      || job.monitor.taskGroups.materialVersion(job.taskGroupId ?? '', job.assetIds) !== job.materialVersion)
    if (!file || file.dev !== job.file.dev || file.ino !== job.file.ino || changed
      || JSON.stringify(service.getProject(projectId).tagProfile) !== job.tagProfile) {
      entries.delete(key)
      stop(job)
      job = undefined
    } else job.version = dbVersion
  }
  if (job) return job
  const monitor = new CatStore({ rootDir: service.rootDir }).openProject(projectId, { readOnly: true })
  const file = lstatSync(monitor.catDb.path)
  // Capture dependencies before the worker is allowed to read. The next poll sees any later commit.
  const dbVersion = version(monitor)
  const { segments, assetIds, taskGroupId, materialVersion } = monitor.catDb.readSnapshot(() => {
    const segments = monitor.segments.getByIds(ids)
    const assetIds = [...new Set(segments.map(row => row.assetId))]
    const taskGroupId = monitor.taskGroups.forAssets(assetIds)
    return { segments, assetIds, taskGroupId, materialVersion: monitor.taskGroups.materialVersion(taskGroupId ?? '', assetIds) }
  })
  const tagProfile = JSON.stringify(service.getProject(projectId).tagProfile)
  const worker = new Worker(workerEntry(), { workerData: {
    kind: 'working-references', request: { rootDir: service.rootDir, projectId, taskId, segmentIds: ids, taskGroupId, assetIds, materialVersion, tagProfile },
  } })
  worker.unref()
  const created: ReferenceJob = { projectId, taskGroupId, ids, monitor, version: dbVersion, materialVersion, assetIds, tagProfile, file, worker,
    active: true, items: new Map(), waiters: new Set(), semantic: { status: 'pending' }, abort: new AbortController() }
  void service.reviewCache.get(join(service.getProjectPaths(projectId).projectDir, 'semantic-cache.sqlite'), segments, created.abort.signal, taskGroupId)
    .then(result => { created.semantic = result; notify(created) })
  const fail = (message: string) => {
    if (!created.active) return
    created.active = false
    for (const segmentId of ids) if (!created.items.has(segmentId)) created.items.set(segmentId, { segmentId, status: 'failed', error: message })
    notify(created)
  }
  worker.on('message', (message: { type: string; items?: ReferenceItem[]; message?: string }) => {
    if (message.type === 'stale' && entries.get(key) === created) {
      entries.delete(key)
      stop(created)
      return
    }
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
