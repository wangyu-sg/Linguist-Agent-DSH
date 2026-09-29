import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

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
