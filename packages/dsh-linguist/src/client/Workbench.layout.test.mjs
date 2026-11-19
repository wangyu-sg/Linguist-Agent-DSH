import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import test from 'node:test'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'

const css = readFileSync(new URL('./Workbench.module.css', import.meta.url), 'utf8')

test('CAT grid may fit the native side pane before target focus', () => {
  const gridInner = css.match(/\.gridInner\s*\{([^}]+)\}/)?.[1]
  assert.ok(gridInner)
  assert.match(gridInner, /\bmin-width:\s*0\s*;/)
})

test('empty projects expose their existing import panel even with batch navigation collapsed', () => {
  const workbench = readFileSync(new URL('./CatWorkbench.tsx', import.meta.url), 'utf8')
  const empty = workbench.slice(workbench.indexOf(': dataset?.total === 0 ?'), workbench.indexOf(': dataset && <SegmentRows'))
  assert.match(empty, /scopedAssets\?\.length === 0/)
  assert.match(empty, /!archived && <Button/)
  assert.match(empty, /setDock\('assets'\); setDockOpen\(true\)/)
  assert.match(empty, /导入批次与资料/)
})

test('reference inspector identifies translation memory and termbase sections as TM and TB', () => {
  const workbench = readFileSync(new URL('./CatWorkbench.tsx', import.meta.url), 'utf8')
  const inspector = workbench.slice(workbench.indexOf('function ContextPanel('))
  assert.match(inspector, /<ReferenceMatches segment=\{data\.segment\} tagProfile=\{tagProfile\} tm=\{data\.tm\} terms=\{data\.termMatches\}/)
  const matches = readFileSync(new URL('./ReferenceMatches.tsx', import.meta.url), 'utf8')
  assert.match(matches, /<h3[^>]*>TM\b/)
  assert.match(matches, /<h3[^>]*>TB\b/)
})

test('dock grouping keeps its divider outside the tab selection box', () => {
  const source = ts.createSourceFile('CatWorkbench.tsx', readFileSync(new URL('./CatWorkbench.tsx', import.meta.url), 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  let group
  const visit = node => {
    if (ts.isJsxElement(node) && node.openingElement.tagName.getText(source) === 'React.Fragment' && node.getText(source).includes('styles.dockDivider')) group = node
    ts.forEachChild(node, visit)
  }
  visit(source)
  assert.ok(group, 'the divider and tab share a Fragment without a DOM wrapper')
  const children = group.children.filter(node => !ts.isJsxText(node))
  assert.equal(children.length, 2)
  assert.match(children[0].getText(source), /<span className=\{styles\.dockDivider\} aria-hidden="true" \/>/)
  assert.equal(children[1].openingElement.tagName.getText(source), 'Button')
  assert.doesNotMatch(children[1].getText(source), /data-group-start|dockDivider/)
  assert.doesNotMatch(css, /data-group-start/)
  assert.match(css, /\.dockDivider\s*\{[^}]*border-inline-start:/)
})

test('CAT splitters drag from the displayed panel, clamp, support keyboard/reset, and release capture on disposal', () => {
  const require = createRequire(new URL('../../package.json', import.meta.url))
  const React = require('react')
  let cleanup
  const exports = {}
  const code = ts.transpileModule(readFileSync(new URL('./Splitter.tsx', import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.React },
  }).outputText
  runInNewContext(code, { exports, require: name => name === 'react'
    ? { ...React, useRef: value => ({ current: value }), useEffect: run => { cleanup = run() } }
    : { default: {} } })
  const values = [], captured = new Set()
  let focused = 0
  const element = {
    parentElement: { getBoundingClientRect: () => ({ width: 240, height: 120 }) },
    focus: () => { focused++ },
    setPointerCapture: id => captured.add(id), hasPointerCapture: id => captured.has(id),
    releasePointerCapture: id => captured.delete(id),
  }
  const mount = props => exports.Splitter({ label: 'Synthetic pane', controls: 'pane', value: 320, minimum: 180, maximum: 420, defaultValue: 240, onChange: value => values.push(value), ...props }).props
  const pointer = (clientX, clientY = clientX, pointerId = 1) => ({ button: 0, pointerId, clientX, clientY, currentTarget: element, preventDefault() {} })
  const key = (handle, key) => handle.onKeyDown({ key, preventDefault() {} })
  let handle = mount({ orientation: 'vertical' })
  assert.equal(handle.role, 'separator')
  assert.equal(handle['aria-controls'], 'pane')
  handle.onPointerDown(pointer(100)); handle.onPointerMove(pointer(200))
  assert.equal(values.at(-1), 340, 'drag uses actual 240px width, not the saved 320px preference')
  handle.onPointerUp(pointer(600)); assert.equal(values.at(-1), 420)
  assert.equal(captured.size, 0)
  assert.equal(focused, 1)
  key(handle, 'ArrowRight'); assert.equal(values.at(-1), 336)
  key(handle, 'Home'); assert.equal(values.at(-1), 180)
  key(handle, 'End'); assert.equal(values.at(-1), 420)
  key(handle, 'Enter'); assert.equal(values.at(-1), 240)
  handle.onDoubleClick(); assert.equal(values.at(-1), 240)
  handle = mount({ orientation: 'horizontal', direction: -1, minimum: 80, maximum: 480 })
  handle.onPointerDown(pointer(100)); handle.onPointerMove(pointer(80))
  assert.equal(values.at(-1), 140, 'an upper divider grows upward from displayed height')
  handle.onPointerCancel(pointer(80)); assert.equal(captured.size, 0)
  key(handle, 'ArrowUp'); assert.equal(values.at(-1), 336)
  handle.onPointerDown(pointer(100)); cleanup(); assert.equal(captured.size, 0)
})

test('compact defaults and splitter resets preserve saved project layout preferences', () => {
  const storage = new Map()
  const exports = {}
  const code = ts.transpileModule(readFileSync(new URL('./workbench-location.ts', import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText
  runInNewContext(code, { exports, localStorage: {
    getItem: key => storage.get(key) ?? null,
    setItem: (key, value) => storage.set(key, value),
  } })
  const { value: fresh } = exports.readWorkbenchLocation('fresh')
  assert.equal(fresh.assetNavigatorWidth, 200)
  assert.equal(fresh.inspectorWidth, 280)
  assert.equal(fresh.dockHeight, 200)
  assert.equal(fresh, exports.workbenchDefaults)
  const saved = { ...fresh, assetId: 'synthetic-batch', segmentId: 'synthetic-row', assetNavigatorOpen: false, assetNavigatorWidth: 240, inspectorWidth: 320, dockOpen: false, dock: 'references', dockHeight: 240 }
  exports.writeWorkbenchLocation('saved', saved)
  assert.deepEqual(JSON.parse(JSON.stringify(exports.readWorkbenchLocation('saved').value)), saved)
  const workbench = readFileSync(new URL('./CatWorkbench.tsx', import.meta.url), 'utf8')
  for (const key of ['assetNavigatorWidth', 'inspectorWidth', 'dockHeight']) {
    assert.ok(workbench.includes(`defaultValue={workbenchDefaults.${key}}`))
  }
})
