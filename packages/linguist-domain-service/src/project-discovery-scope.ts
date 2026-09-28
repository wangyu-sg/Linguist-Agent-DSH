import { createHash } from 'node:crypto'
import { existsSync, realpathSync, statSync } from 'node:fs'
import { basename } from 'node:path'
import type { VersionedStageEvidenceRef } from '@linguist/cat-core'

export type ProjectDiscoverySourceKind =
  | 'workspace-root'
  | 'session-attached-directory'
  | 'workspace-attached-directory'
  | 'session-attached-file'
  | 'workspace-attached-file'

export interface ProjectDiscoveryLocation {
  kind: ProjectDiscoverySourceKind
  path: string
}

export interface UnavailableProjectDiscoveryLocation {
  kind: ProjectDiscoverySourceKind
  name: string
  reason: 'missing' | 'not-directory' | 'not-file' | 'unreadable'
}

export interface ProjectDiscoveryScope {
  roots: ProjectDiscoveryLocation[]
  files: ProjectDiscoveryLocation[]
  unavailable: UnavailableProjectDiscoveryLocation[]
  managedEvidence: VersionedStageEvidenceRef[]
  hash: string
}

interface DiscoverySession {
  workspaceId?: string
  linguistProjectId?: string
  attachedDirectories?: string[]
  attachedFiles?: string[]
}

interface ProjectDiscoveryScopeDependencies {
  getWorkspace: (workspaceId: string) => { slug: string } | undefined
  getProjectFilesPath: (workspaceSlug: string) => string
  getWorkspaceAttachedDirectories: (workspaceSlug: string) => string[]
  getWorkspaceAttachedFiles: (workspaceSlug: string) => string[]
  listManagedEvidence: (projectId: string) => VersionedStageEvidenceRef[]
}

/** Only Host-authorized Workspace paths and attachments enter this scope. */
export function resolveProjectDiscoveryScope(input: {
  session: DiscoverySession
  dependencies: ProjectDiscoveryScopeDependencies
}): ProjectDiscoveryScope {
  const { session, dependencies } = input
  const roots: ProjectDiscoveryLocation[] = []
  const files: ProjectDiscoveryLocation[] = []
  const unavailable: UnavailableProjectDiscoveryLocation[] = []
  const seen = new Set<string>()
  const add = (kind: ProjectDiscoverySourceKind, path: string, expected: 'directory' | 'file'): void => {
    let resolved: string
    try {
      if (!existsSync(path)) {
        unavailable.push({ kind, name: basename(path), reason: 'missing' })
        return
      }
      resolved = realpathSync(path)
      const info = statSync(resolved)
      if (expected === 'directory' && !info.isDirectory()) {
        unavailable.push({ kind, name: basename(path), reason: 'not-directory' })
        return
      }
      if (expected === 'file' && !info.isFile()) {
        unavailable.push({ kind, name: basename(path), reason: 'not-file' })
        return
      }
    } catch {
      unavailable.push({ kind, name: basename(path), reason: 'unreadable' })
      return
    }
    if (seen.has(resolved)) return
    seen.add(resolved)
    const location = { kind, path: resolved }
    if (expected === 'directory') roots.push(location)
    else files.push(location)
  }
  const workspace = session.workspaceId === undefined ? undefined : dependencies.getWorkspace(session.workspaceId)
  if (workspace) add('workspace-root', dependencies.getProjectFilesPath(workspace.slug), 'directory')
  for (const path of session.attachedDirectories ?? []) add('session-attached-directory', path, 'directory')
  if (workspace) for (const path of dependencies.getWorkspaceAttachedDirectories(workspace.slug)) add('workspace-attached-directory', path, 'directory')
  for (const path of session.attachedFiles ?? []) add('session-attached-file', path, 'file')
  if (workspace) for (const path of dependencies.getWorkspaceAttachedFiles(workspace.slug)) add('workspace-attached-file', path, 'file')
  const managedEvidence = session.linguistProjectId === undefined ? [] : [...dependencies.listManagedEvidence(session.linguistProjectId)]
    .sort((left, right) => `${left.ref.kind}\0${left.ref.id}\0${left.version}`.localeCompare(`${right.ref.kind}\0${right.ref.id}\0${right.version}`))
  const canonical = {
    roots: roots.map(item => `${item.kind}\0${item.path}`).sort(),
    files: files.map(item => `${item.kind}\0${item.path}`).sort(),
    unavailable: unavailable.map(item => `${item.kind}\0${item.name}\0${item.reason}`).sort(),
  }
  return { roots, files, unavailable, managedEvidence, hash: createHash('sha256').update(JSON.stringify(canonical)).digest('hex') }
}
