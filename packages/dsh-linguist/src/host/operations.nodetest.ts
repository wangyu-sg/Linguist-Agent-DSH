import assert from 'node:assert/strict'
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { WorkspaceId } from '@deepseek-ai/dsh-workspace'
import { executeWorkingCopyAction, LinguistProjectService, prepareWorkingCopy } from '@linguist/domain-service'
import { BindingStore } from './bindings'
import { ManagedFiles } from './files'
import { MutationBus } from './mutations'
import { dispatchOperation, listWorkingCopies, type DispatchOperationInput } from './operations'

test('Host operation dispatch creates a bound project and preserves proposal mode semantics', async () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'la-dsh-dispatch-')))
  const service = new LinguistProjectService({ rootDir: join(root, 'linguist'), applicationVersion: 'synthetic-test' })
  service.init()
  try {
    const knownWorkspace = WorkspaceId('synthetic-workspace')
    const deps: Omit<DispatchOperationInput, 'operation' | 'payload'> = {
      service, bindings: new BindingStore(root), files: new ManagedFiles(root), mutations: new MutationBus(),
      workspaceRegistry: { get: id => id === knownWorkspace ? { id, path: root } : undefined },
      assertProjectSession: async () => { throw new Error('Unexpected Session authority check') },
      resolveSessionWorkspace: async () => { throw new Error('Unexpected Session Workspace lookup') },
    }
    const created = await dispatchOperation({ ...deps, operation: 'linguistProjectsCreate', payload: {
      workspaceId: knownWorkspace, name: 'Synthetic', sourceLocale: 'zh-CN', targetLocale: 'en-US',
    } }) as { id: string; workspaceId: string }
    assert.equal(created.workspaceId, knownWorkspace)
    const imported = await service.importAsset(created.id, { bytes: new TextEncoder().encode('key,source,target\na,开始,Begin\n'), filename: 'synthetic.csv' })
    assert.equal(imported.status, 'imported')
    const segment = service.openProject(created.id).segments.query({ limit: 1 })[0]!
    const proposed = await dispatchOperation({ ...deps, operation: 'linguistProposalsApplyTranslations', payload: {
      projectId: created.id, mode: 'proposal', edits: [{ segmentId: segment.id, baseRevision: segment.revision, target: 'Start' }],
    } }) as { pending: number; applied: number; proposalIds: string[] }
    assert.equal(proposed.pending, 1)
    assert.equal(proposed.applied, 0)
    assert.equal(service.openProject(created.id).segments.getById(segment.id)?.target, segment.target)
    const diff = await dispatchOperation({ ...deps, operation: 'linguistProposalsGetDiff', payload: {
      projectId: created.id, proposalId: proposed.proposalIds[0],
    } }) as { proposedTarget: string; currentTarget: string }
    assert.equal(diff.proposedTarget, 'Start')
    assert.equal(diff.currentTarget, segment.target)
  } finally {
    service.closeAll()
    rmSync(root, { recursive: true, force: true })
  }
})

test('working copy list reads historical sessions from the bound workspace', async () => {
  const root = mkdtempSync(join(tmpdir(), 'la-dsh-operations-'))
  try {
    writeFileSync(join(root, 'source.csv'), 'key,source,target\na,开始,Begin\n')
    const source = { sourcePath: 'source.csv', sourceLocale: 'zh-CN', targetLocale: 'en-US' }
    const baseline = await prepareWorkingCopy({ ...source, workspaceRoot: root })
    await executeWorkingCopyAction({ ...source, operation: 'prepare' }, () => ({ workspaceRoot: root, sessionId: 'previous-session' }))
    writeFileSync(join(root, 'decisions.json'), JSON.stringify({
      sourceSha256: baseline.sourceSha256,
      groups: [{ segmentIds: [baseline.segments[0]!.id], decision: 'unchanged' }],
      edits: [], unresolved: [],
    }))
    await executeWorkingCopyAction({ ...source, operation: 'assemble', decisionsPath: 'decisions.json' }, () => ({ workspaceRoot: root, sessionId: 'current-session' }))
    const input = {
      payload: { sessionId: 'reader-session' },
      resolveSessionWorkspace: async (sessionId: string) => {
        assert.equal(sessionId, 'reader-session')
        return { workspaceRoot: root }
      },
    }
    const listed = await listWorkingCopies(input)
    assert.equal(listed.total, 2)
    assert.equal(listed.truncated, false)
    assert.deepEqual(new Set(listed.items.map(item => item.ownerSessionId)), new Set(['previous-session', 'current-session']))
    assert.equal(listed.items.find(item => item.kind === 'result')?.status, 'coverage-complete')
    assert.equal(listed.items.every(item => item.submitted === false), true)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
