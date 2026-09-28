import test from 'node:test'
import assert from 'node:assert/strict'
import { canCommitTarget, canConfirmTarget, editKeyAction, targetSaveCompletion } from '../../packages/dsh-linguist/src/client/cat-edit-utils.ts'
import { findNextEditableRow, gridRowKeyAction, mergeIndexedPage, pageOffsetsForRange, virtualRowKey } from '../../packages/dsh-linguist/src/client/cat-virtual-utils.ts'

test('CAT 目标编辑保存只在可写且草稿稳定时可提交；等待、组合输入和冲突不能提交', () => {
  const ready = { archived: false, locked: false, dirty: true, saving: false, resolvingConflict: false, composing: false, hasViolations: false, conflict: false }
  assert.equal(canCommitTarget(ready), true)
  for (const field of ['archived', 'locked', 'saving', 'resolvingConflict', 'composing', 'hasViolations', 'conflict'] as const) {
    assert.equal(canCommitTarget({ ...ready, [field]: true }), false, field)
  }
  assert.equal(canCommitTarget({ ...ready, dirty: false }), false)
  assert.equal(canConfirmTarget({ ...ready, dirty: false }), true)
  assert.equal(canConfirmTarget({ ...ready, dirty: false, saving: true }), false)
  assert.equal(targetSaveCompletion('saved', false), 'close')
  assert.equal(targetSaveCompletion('saved', true), 'advance')
  assert.equal(targetSaveCompletion('conflict', true), 'conflict')
  assert.equal(targetSaveCompletion('failed', true), 'stay')
})

test('CAT 编辑快捷键尊重 IME；虚拟列表键和跨页片段身份保持稳定', () => {
  const key = { metaKey: false, ctrlKey: true, shiftKey: false, isComposing: false }
  assert.equal(editKeyAction({ ...key, key: 'Enter' }), 'confirm-and-advance')
  assert.equal(editKeyAction({ ...key, key: 'z' }), 'undo')
  assert.equal(editKeyAction({ ...key, key: 'z', shiftKey: true }), 'redo')
  assert.equal(editKeyAction({ ...key, key: 'Enter', isComposing: true }), null)
  assert.equal(editKeyAction({ ...key, key: 'Escape', isComposing: true }), 'cancel')
  assert.deepEqual(pageOffsetsForRange(185, 420, 200), [0, 200, 400])
  const rows = mergeIndexedPage(new Map<number, string>([[0, 'asset-A-row-0']]), 200, ['asset-A-row-200', 'asset-A-row-201'])
  assert.equal(rows.get(0), 'asset-A-row-0')
  assert.equal(rows.get(201), 'asset-A-row-201')
  assert.equal(virtualRowKey(['segment-A', 'segment-B'], 1), 'segment-B')
  assert.throws(() => virtualRowKey(['segment-A'], 1), /Missing virtual row key/)
  assert.deepEqual(gridRowKeyAction({ key: 'PageDown', currentIndex: 198, total: 420, pageSize: 200, metaKey: false, ctrlKey: false, altKey: false }), { type: 'focus', index: 398 })
  assert.deepEqual(findNextEditableRow(new Map([[0, { assetId: 'A', locked: false }], [1, { assetId: 'A', locked: true }], [2, { assetId: 'A', locked: false }]]), 0, 'A', 3), { kind: 'found', index: 2 })
  assert.deepEqual(findNextEditableRow(new Map([[0, { assetId: 'A', locked: false }]]), 0, 'A', 3), { kind: 'load', index: 1 })
  assert.deepEqual(findNextEditableRow(new Map([[0, { assetId: 'A', locked: false }], [1, { assetId: 'B', locked: false }]]), 0, 'A', 2), { kind: 'end' })
})
