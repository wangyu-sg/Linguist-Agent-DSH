import test from 'node:test'
import assert from 'node:assert/strict'
import { readWorkbenchLocation, writeWorkbenchLocation } from '../../packages/dsh-linguist/src/client/workbench-location.ts'

test('CAT 工作台位置按项目隔离，并收敛持久化的非法布局值', () => {
  const original = Object.getOwnPropertyDescriptor(globalThis, 'localStorage')
  const values = new Map<string, string>()
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value) },
  } })
  try {
    const initial = readWorkbenchLocation('project-A').value
    assert.equal(initial.dock, 'qa')
    assert.equal(initial.assetNavigatorWidth, 240)
    writeWorkbenchLocation('project-A', { ...initial, assetId: 'asset-A', segmentId: 'segment-A', dock: 'proposals', dockHeight: 300, inspectorWidth: 360 })
    assert.equal(readWorkbenchLocation('project-A').value.segmentId, 'segment-A')
    assert.equal(readWorkbenchLocation('project-A').value.dock, 'proposals')
    assert.equal(readWorkbenchLocation('project-A').value.inspectorWidth, 360)
    assert.deepEqual(readWorkbenchLocation('project-B').value, initial)

    values.set('linguist:workbench:project-B', JSON.stringify({ dock: 'unknown', inspectorWidth: 999, dockHeight: 30, assetNavigatorWidth: -1, assetId: '', segmentId: 1 }))
    const bounded = readWorkbenchLocation('project-B').value
    assert.equal(bounded.dock, 'qa')
    assert.equal(bounded.inspectorWidth, 480)
    assert.equal(bounded.dockHeight, 80)
    assert.equal(bounded.assetNavigatorWidth, 180)
    assert.equal(bounded.assetId, undefined)
    assert.equal(bounded.segmentId, undefined)
    values.set('linguist:workbench:project-B', '{')
    assert.equal(readWorkbenchLocation('project-B').value.dock, 'qa')
    assert.match(readWorkbenchLocation('project-B').error ?? '', /SyntaxError/)
  } finally {
    if (original) Object.defineProperty(globalThis, 'localStorage', original)
    else Reflect.deleteProperty(globalThis, 'localStorage')
  }
})
