import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const css = readFileSync(new URL('./Workbench.module.css', import.meta.url), 'utf8')

test('CAT grid may fit the native side pane before target focus', () => {
  const gridInner = css.match(/\.gridInner\s*\{([^}]+)\}/)?.[1]
  assert.ok(gridInner)
  assert.match(gridInner, /\bmin-width:\s*0\s*;/)
})
