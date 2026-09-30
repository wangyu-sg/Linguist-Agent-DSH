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
  assert.match(empty, /summary\?\.assetCount === 0/)
  assert.match(empty, /!project\.archivedAt && <Button/)
  assert.match(empty, /setDock\('assets'\); setDockOpen\(true\)/)
  assert.match(empty, /导入批次与资料/)
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
