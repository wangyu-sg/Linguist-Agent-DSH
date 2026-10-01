import { afterEach, describe, expect, test } from 'bun:test'
import { createHash } from 'node:crypto'
import { mkdtempSync, mkdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { resolveProjectDiscoveryScope } from './project-discovery-scope'
import type { ContextImageMetadata } from './project-service-types'

const temporaryDirectories: string[] = []

afterEach(() => {
  for (const path of temporaryDirectories.splice(0)) rmSync(path, { recursive: true, force: true })
})

describe('Project Discovery Scope', () => {
  test('同一图片对象的名称和类型进入冻结 hash，普通文件保留原 canonical 格式', () => {
    const root = realpathSync(mkdtempSync(join(tmpdir(), 'linguist-discovery-image-')))
    temporaryDirectories.push(root)
    const bytes = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jR3sAAAAASUVORK5CYII=', 'base64')
    const path = join(root, createHash('sha256').update(bytes).digest('hex'))
    writeFileSync(path, bytes)
    const input = {
      session: { attachedFiles: [path] },
      dependencies: {
        getWorkspace: () => undefined,
        getProjectFilesPath: () => root,
        getWorkspaceAttachedDirectories: () => [],
        getWorkspaceAttachedFiles: () => [],
        listManagedEvidence: () => [],
      },
    }
    const withImage = (image: ContextImageMetadata) => resolveProjectDiscoveryScope({ ...input, images: new Map([[path, image]]) })
    const original = withImage({ filename: 'visual.png', mediaType: 'image/png' })
    expect(withImage({ filename: 'renamed.png', mediaType: 'image/png' }).hash).not.toBe(original.hash)
    expect(withImage({ filename: 'visual.png', mediaType: 'image/jpeg' }).hash).not.toBe(original.hash)
    expect(withImage({ filename: 'visual.png', mediaType: 'image/png' })).toEqual(original)
    expect(original.files).toEqual([{ kind: 'session-attached-file', path, image: { filename: 'visual.png', mediaType: 'image/png' } }])
    const plain = resolveProjectDiscoveryScope(input)
    const canonical = { roots: [], files: [`session-attached-file\0${path}`], unavailable: [] }
    expect(plain.files).toEqual([{ kind: 'session-attached-file', path }])
    expect(plain.hash).toBe(createHash('sha256').update(JSON.stringify(canonical)).digest('hex'))
  })

  test('只包含宿主授权的项目根和附件，并把不可用附件显式保留为缺口', () => {
    const root = mkdtempSync(join(tmpdir(), 'linguist-discovery-'))
    temporaryDirectories.push(root)
    const attachedDirectory = join(root, 'references')
    const attachedFile = join(root, 'brief.docx')
    const missingFile = join(root, 'missing.xlsx')
    mkdirSync(attachedDirectory)
    writeFileSync(attachedFile, 'brief')

    const scope = resolveProjectDiscoveryScope({
      session: {
        workspaceId: 'workspace-1',
        linguistProjectId: 'project-1',
        attachedDirectories: [attachedDirectory, root],
        attachedFiles: [attachedFile, missingFile],
      },
      dependencies: {
        getWorkspace: () => ({
          id: 'workspace-1',
          name: 'Workspace',
          slug: 'workspace',
          projectRootPath: root,
          createdAt: 0,
          updatedAt: 0,
        }),
        getProjectFilesPath: () => root,
        getWorkspaceAttachedDirectories: () => [attachedDirectory],
        getWorkspaceAttachedFiles: () => [attachedFile],
        listManagedEvidence: () => [
          { ref: { kind: 'asset', id: 'asset-1' }, version: 'sha-1' },
        ],
      },
    })

    expect(scope.roots.map((item) => item.path)).toEqual([
      realpathSync(root),
      realpathSync(attachedDirectory),
    ])
    expect(scope.files.map((item) => item.path)).toEqual([realpathSync(attachedFile)])
    expect(scope.unavailable).toEqual([
      { kind: 'session-attached-file', name: 'missing.xlsx', reason: 'missing' },
    ])
    expect(scope.managedEvidence).toEqual([
      { ref: { kind: 'asset', id: 'asset-1' }, version: 'sha-1' },
    ])
    expect(scope.hash).toHaveLength(64)
  })
})
