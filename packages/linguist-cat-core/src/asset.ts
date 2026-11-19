/**
 * Asset — one imported bilingual file inside a project. Pure data.
 * `sourceSha256` anchors the asset to exact source bytes (CAS), so the
 * store can reuse an existing import within its task group.
 */

import { deriveAssetId, type AssetId, type ProjectId } from './ids'

export interface Asset {
  id: AssetId
  projectId: ProjectId
  taskGroupId?: string
  /** Bilingual format identifier, e.g. 'phrase_mxliff' | 'mqxliff' | 'sdlxliff' | 'xliff' | 'csv' | 'xlsx'. */
  formatId: string
  originalFilename: string
  /** SHA-256 (hex) of the original source bytes. */
  sourceSha256: string
  segmentCount: number
  /** Adapter-owned, versioned import configuration. CAT Core intentionally does not parse it. */
  formatConfigJson?: string
}

export interface CreateAssetInput {
  id?: AssetId
  taskGroupId?: string
  projectId: ProjectId
  formatId: string
  originalFilename: string
  sourceSha256: string
  segmentCount: number
  formatConfigJson?: string
}

export function createAsset(input: CreateAssetInput): Asset {
  return {
    id: input.id ?? deriveAssetId(input.projectId, input.sourceSha256, input.originalFilename),
    projectId: input.projectId,
    ...(input.taskGroupId ? { taskGroupId: input.taskGroupId } : {}),
    formatId: input.formatId,
    originalFilename: input.originalFilename,
    sourceSha256: input.sourceSha256,
    segmentCount: input.segmentCount,
    ...(input.formatConfigJson === undefined ? {} : { formatConfigJson: input.formatConfigJson }),
  }
}
