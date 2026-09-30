import { constants } from 'node:fs'
import { open } from 'node:fs/promises'
import { basename } from 'node:path'
import type { AttachmentStore } from '@deepseek-ai/dsh-attachment'
import fileType from 'file-type'
import type { LinguistCatToolsDeps } from '@linguist/cat-tools'
import type { ProjectDatabase } from '@linguist/cat-store'
import { runLinguistConsistencyWorker, runLinguistQaWorker, type LinguistProjectService } from '@linguist/domain-service'
import type { ProjectDiscoveryScope } from '@linguist/domain-service/contracts'

export interface CreateCatDepsInput {
  service: LinguistProjectService
  projectId: string
  sessionId: string
  role: NonNullable<LinguistCatToolsDeps['linguistRole']>
  sessionCwd: string
  attachments: AttachmentStore
  /** Rechecks the persisted DSH Session binding for this project before every operation. */
  assertBound: () => void
  /** Refreshes Host Stage state after a successful, revalidated project resolution. */
  onProjectResolved?: (db: ProjectDatabase) => void
  /** Returns an authorized real file or directory path for the current Session. */
  authorizeReadPath: (requestedPath: string) => Promise<string>
  /** Returns an authorized absolute output path after checking overwrite permission. */
  authorizeWritePath: (requestedPath: string, overwrite: boolean) => Promise<string>
  discoveryScope: () => Promise<ProjectDiscoveryScope>
  onMutation: NonNullable<LinguistCatToolsDeps['onMutation']>
  prepareStage: NonNullable<LinguistCatToolsDeps['prepareStage']>
  prepareContextDoc: NonNullable<LinguistCatToolsDeps['prepareContextDoc']>
  onEvidencePrepared: NonNullable<LinguistCatToolsDeps['onEvidencePrepared']>
  generationProvenance: NonNullable<LinguistCatToolsDeps['generationProvenance']>
  stageEvidenceRunId: () => string | undefined
  reviewScopeSegmentIds: () => readonly string[] | undefined
  delegatedScopeSegmentIds: () => readonly string[] | undefined
  modelId?: string
}

export function createCatDeps(input: CreateCatDepsInput): LinguistCatToolsDeps {
  const { service, projectId } = input
  return {
    resolveProject() {
      input.assertBound()
      const project = service.getProject(projectId)
      const db = service.openProject(projectId)
      input.onProjectResolved?.(db)
      return { project, db }
    },
    resultProjectId: projectId,
    sessionId: input.sessionId,
    linguistRole: input.role,
    ...(input.modelId === undefined ? {} : { modelId: input.modelId }),
    onMutation: input.onMutation,
    prepareStage: input.prepareStage,
    prepareContextDoc: input.prepareContextDoc,
    onEvidencePrepared: input.onEvidencePrepared,
    generationProvenance: input.generationProvenance,
    get stageEvidenceRunId() { return input.stageEvidenceRunId() },
    get reviewScopeSegmentIds() { return input.reviewScopeSegmentIds() },
    get delegatedScopeSegmentIds() { return input.delegatedScopeSegmentIds() },
    readDeliveryPreflight(assetId) {
      input.assertBound()
      return service.getDeliveryPreflight(projectId, assetId)
    },
    qaWorker: runLinguistQaWorker,
    consistencyWorker: runLinguistConsistencyWorker,
    async importResources(request) {
      input.assertBound()
      const paths = await Promise.all(request.paths.map(input.authorizeReadPath))
      input.assertBound()
      return service.importResourcesFromPaths(projectId, input.sessionCwd, { ...request, paths })
    },
    async refreshProjectEvidenceInventory() {
      input.assertBound()
      const scope = await input.discoveryScope()
      input.assertBound()
      return service.refreshEvidenceInventory(projectId, scope)
    },
    async previewWorkbookMapping(requestedPath) {
      input.assertBound()
      const path = await input.authorizeReadPath(requestedPath)
      input.assertBound()
      return service.previewWorkbookMapping(projectId, input.sessionCwd, path)
    },
    async saveWorkbookMapping(requestedPath, mapping) {
      input.assertBound()
      const path = await input.authorizeReadPath(requestedPath)
      input.assertBound()
      return service.saveWorkbookMapping(projectId, input.sessionCwd, path, mapping)
    },
    async exportAsset(assetId, requestedPath, validation, overwrite) {
      input.assertBound()
      const path = await input.authorizeWritePath(requestedPath, overwrite)
      input.assertBound()
      const { mode, ...result } = await service.exportAssetToPath(projectId, assetId, path, validation, overwrite)
      return { ...result, validation: mode }
    },
    scanUnknownTagPatterns(assetIds, sampleLimit) {
      input.assertBound()
      return service.scanUnknownTagPatterns(projectId, assetIds, sampleLimit)
    },
    saveTagProfileCandidate(candidate, activate) {
      input.assertBound()
      const saved = service.saveTagProfileCandidate(projectId, candidate, undefined, activate)
      return { candidateId: saved.candidate!.id, status: activate ? 'active' : 'candidate', validation: saved.validation! }
    },
    async readContextImage(docId) {
      input.assertBound()
      const { sourcePath, originalFilename } = service.resolveContextDocPreviewPath(projectId, docId)
      const file = await open(sourcePath, constants.O_RDONLY | constants.O_NOFOLLOW)
      let bytes: Buffer
      try {
        const stat = await file.stat()
        if (!stat.isFile() || stat.size > input.attachments.imageLimits.maxImageBytes) {
          throw new Error('Managed Context image exceeds the DSH image limit or is not a regular file')
        }
        bytes = await file.readFile()
      } finally {
        await file.close()
      }
      const detected = await fileType.fromBuffer(bytes)
      const mediaType = detected?.mime
      if (mediaType !== 'image/png' && mediaType !== 'image/jpeg' && mediaType !== 'image/webp' && mediaType !== 'image/gif') {
        throw new Error('Managed Context image is not a supported raster')
      }
      const ref = await input.attachments.saveImage({ data: bytes, mediaType, name: basename(originalFilename) })
      const stored = await input.attachments.readImage(ref)
      input.assertBound()
      return { data: Buffer.from(stored.data).toString('base64'), mimeType: stored.ref.mediaType }
    },
  }
}
