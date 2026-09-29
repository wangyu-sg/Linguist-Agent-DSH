import test from 'node:test'
import assert from 'node:assert/strict'
import { getWorkbenchComposerContext, publishWorkbenchComposerContext, subscribeWorkbenchComposerContext } from '../../packages/dsh-linguist/src/client/composer-context.ts'

test('Composer 工作台视图只更新本 DSH Session，并在工作台卸载时清除', () => {
  const observed: Array<string | undefined> = []
  const unsubscribe = subscribeWorkbenchComposerContext('session-A', () => observed.push(getWorkbenchComposerContext('session-A')?.projectId))
  const context = { projectId: 'project-A', projectName: 'Synthetic', selectedCount: 2,
    selection: { schemaVersion: 1 as const, projectId: 'project-A', selectedSegmentIds: ['segment-A'], capturedAt: '2026-09-29T00:00:00Z', uiRevision: 1 },
    clearReference: () => {}, clearSelection: () => {} }
  publishWorkbenchComposerContext('session-A', context)
  publishWorkbenchComposerContext('session-B', { ...context, projectId: 'project-B' })
  assert.deepEqual(getWorkbenchComposerContext('session-A'), context)
  context.selection.selectedSegmentIds.push('later-change')
  assert.deepEqual(getWorkbenchComposerContext('session-A')?.selection.selectedSegmentIds, ['segment-A'])
  assert.deepEqual(observed, ['project-A'])
  publishWorkbenchComposerContext('session-A')
  assert.equal(getWorkbenchComposerContext('session-A'), undefined)
  assert.deepEqual(observed, ['project-A', undefined])
  unsubscribe()
  publishWorkbenchComposerContext('session-B')
})
