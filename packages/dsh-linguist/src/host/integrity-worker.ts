import { parentPort, threadId, workerData } from 'node:worker_threads'
import { scanProjectIntegrity, type ProjectIntegrityCheckId, type ProjectIntegrityProgress } from '@linguist/cat-store'

export interface IntegrityWorkerInput {
  projectDir: string
  projectId: string
  jobId: string
  startedAt: string
}

const CHECK_ORDER: readonly ProjectIntegrityCheckId[] = [
  'project_manifest', 'schema_version', 'source_digests', 'blob_digests',
  'sqlite_integrity', 'foreign_keys', 'orphans', 'proposal_references',
  'qa_references', 'review_references', 'event_sequence', 'job_lineage',
  'run_lineage', 'export_manifests',
]

export interface FullIntegrityProgress extends ProjectIntegrityProgress {
  completedChecks: number
  totalChecks: number
  percent: number
}

export function runFullIntegrityScrub(input: IntegrityWorkerInput, onProgress: (progress: FullIntegrityProgress) => void) {
  const report = scanProjectIntegrity({
    projectDir: input.projectDir,
    expectedProjectId: input.projectId,
    onProgress(progress) {
      const checkIndex = CHECK_ORDER.indexOf(progress.checkId)
      const fraction = progress.totalItems === 0 ? 1 : Math.min(1, progress.completedItems / progress.totalItems)
      onProgress({
        ...progress,
        completedChecks: checkIndex,
        totalChecks: CHECK_ORDER.length,
        percent: Math.round(((checkIndex + fraction) / CHECK_ORDER.length) * 100),
      })
    },
  })
  return {
    schemaVersion: 1 as const,
    kind: 'full' as const,
    projectId: input.projectId,
    jobId: input.jobId,
    executor: 'worker_thread' as const,
    workerThreadId: threadId,
    outcome: report.outcome,
    startedAt: input.startedAt,
    completedAt: new Date().toISOString(),
    checks: report.checks,
  }
}

const port = parentPort
if (port) {
  try {
    const report = runFullIntegrityScrub(workerData as IntegrityWorkerInput, progress => {
      port.postMessage({ type: 'progress', progress })
    })
    port.postMessage({ type: 'report', report })
  } catch {
    port.postMessage({ type: 'error', errorCode: 'WORKER_FAILED' })
    process.exitCode = 1
  }
}
