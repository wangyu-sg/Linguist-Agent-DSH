import { lstat, realpath } from 'node:fs/promises'
import { basename, dirname, isAbsolute, join, relative } from 'node:path'
import { resolveProjectDiscoveryScope, type LinguistProjectService, type ProjectDiscoveryScope } from '@linguist/domain-service'

export function projectDiscoveryScope(service: LinguistProjectService, projectId: string, workspaceId: string, workspacePath: string, attachedFiles: readonly string[] = []): ProjectDiscoveryScope {
  const db = service.openProject(projectId)
  const managedEvidence = [
    ...db.assets.listByProject().map(asset => ({ ref: { kind: 'asset' as const, id: asset.id as string }, version: asset.sourceSha256 })),
    ...db.contextDocs.list({ limit: db.contextDocs.count() }).map(doc => ({ ref: { kind: 'context-doc' as const, id: doc.id }, version: doc.sha256 ?? doc.createdAt })),
    ...(['tm', 'terms'] as const).flatMap(kind => db.referenceImports.list(kind).map(item => ({ ref: { kind: 'reference-import' as const, id: item.id }, version: item.sourceSha256 }))),
    ...db.styleGuideRules.list({ limit: db.styleGuideRules.count() }).map(rule => ({ ref: { kind: 'style-rule' as const, id: rule.id }, version: rule.updatedAt })),
    ...db.techConstraints.list({ limit: db.techConstraints.count() }).map(item => ({ ref: { kind: 'tech-constraint' as const, id: item.id }, version: item.updatedAt })),
    ...db.voiceProfiles.list({ limit: db.voiceProfiles.count() }).map(item => ({ ref: { kind: 'voice-profile' as const, id: item.id }, version: item.updatedAt })),
  ]
  return resolveProjectDiscoveryScope({
    session: { workspaceId, linguistProjectId: projectId, attachedFiles: [...attachedFiles] },
    dependencies: {
      getWorkspace: id => id === workspaceId ? { slug: workspaceId } : undefined,
      getProjectFilesPath: () => workspacePath,
      getWorkspaceAttachedDirectories: () => [],
      getWorkspaceAttachedFiles: () => [],
      listManagedEvidence: () => managedEvidence,
    },
  })
}

function within(path: string, root: string): boolean {
  const rel = relative(root, path)
  return rel === '' || (rel !== '..' && !rel.startsWith('../') && !isAbsolute(rel))
}

export async function authorizeWorkspaceRead(requested: string, workspacePath: string, attachedFiles: readonly string[] = []): Promise<string> {
  if (!isAbsolute(requested)) throw new Error('A workspace file path must be absolute')
  const root = await realpath(workspacePath)
  const file = await realpath(requested)
  if (!within(file, root) && !attachedFiles.includes(requested)) throw new Error('File is outside this DSH Workspace')
  return file
}

export async function authorizeWorkspaceWrite(requested: string, workspacePath: string, overwrite: boolean): Promise<string> {
  if (!isAbsolute(requested)) throw new Error('An output path must be absolute')
  const root = await realpath(workspacePath)
  const parent = await realpath(dirname(requested))
  if (!within(parent, root)) throw new Error('Output is outside this DSH Workspace')
  try {
    const info = await lstat(requested)
    if (!info.isFile() || info.isSymbolicLink() || !overwrite) throw new Error('Output exists or is not a regular file')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
  }
  return join(parent, basename(requested))
}
