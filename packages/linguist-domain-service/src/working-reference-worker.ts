import { setImmediate as yieldThread } from 'node:timers/promises'
import type { MessagePort } from 'node:worker_threads'
import { CatStore } from '@linguist/cat-store'
import { createLinguistCatTools, type CatGetTranslationContextResult } from '@linguist/cat-tools'

export interface WorkingReferenceRequest {
  rootDir: string; projectId: string; taskId: string; segmentIds: string[]
  taskGroupId?: string; assetIds: string[]; materialVersion: string; tagProfile?: string
}

export async function runWorkingReferenceWorker(
  request: WorkingReferenceRequest,
  port: MessagePort,
): Promise<void> {
  const store = new CatStore({ rootDir: request.rootDir })
  const project = store.getProject(request.projectId)
  const db = store.openProject(request.projectId, { readOnly: true })
  const tool = createLinguistCatTools({ resolveProject: () => ({ project, db }), taskId: request.taskId, contextOutput: 'artifact' })
    .find(item => item.name === 'cat_get_translation_context')!
  const readContext = tool.execute as (id: string, params: { segmentIds: string[]; readOnly: true; includeNeighbors: false }) => Promise<{ details?: CatGetTranslationContextResult }>
  const queue = [...request.segmentIds]
  port.on('message', (message: { prioritize: string[] }) => {
    const priority = new Set(message.prioritize)
    queue.sort((a, b) => Number(priority.has(b)) - Number(priority.has(a)))
  })
  try {
    // One WAL snapshot for every page. A state seen only during worker startup cannot escape.
    db.catDb.db.exec('BEGIN')
    if (JSON.stringify(project.tagProfile) !== request.tagProfile
      || db.taskGroups.materialVersion(request.taskGroupId ?? '', request.assetIds) !== request.materialVersion) {
      port.postMessage({ type: 'stale' })
      return
    }
    while (queue.length) {
      const segmentIds = queue.splice(0, 50)
      try {
        const result = await readContext('working-reference', { segmentIds, readOnly: true, includeNeighbors: false })
        const payload = result.details!
        port.postMessage({ type: 'references', items: payload.contexts.map(({ currentTarget: _target, targetTags: _tags, ...context }) => ({
          ...context, status: 'ready', shared: payload.shared, projectRules: payload.projectRules ?? [],
          unprovidedReferences: payload.unprovidedReferences?.filter(ref => ref.segmentIds.includes(context.segmentId)) ?? [],
        })) })
      } catch (error) {
        port.postMessage({ type: 'references', items: segmentIds.map(segmentId => ({
          segmentId, status: 'failed', error: error instanceof Error ? error.message : String(error),
        })) })
      }
      await yieldThread()
    }
  } finally {
    db.close()
    port.close()
  }
}
