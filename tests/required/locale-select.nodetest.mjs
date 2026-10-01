import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'

const client = new URL('../../packages/dsh-linguist/src/client/', import.meta.url)
const require = createRequire(new URL('../../packages/dsh-linguist/package.json', import.meta.url))
const React = require('react')
const { renderToStaticMarkup } = require('react-dom/server')

function renderLocale(props) {
  const exports = {}
  const code = ts.transpileModule(readFileSync(new URL('ProjectLocaleSelect.tsx', client), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.React, target: ts.ScriptTarget.ES2022 },
  }).outputText
  runInNewContext(code, { exports, require: name => {
    if (name === 'react') return React
    if (name === './ui-locale') return { useT: () => key => key }
    if (name.endsWith('.module.css')) return { default: {} }
    throw new Error(`Unexpected locale select import: ${name}`)
  } })
  return renderToStaticMarkup(React.createElement(exports.ProjectLocaleSelect, { label: '源语言', onValueChange() {}, ...props }))
}

test('project locale dropdown retains all 30 source languages and localized labels', () => {
  const html = renderLocale({ value: 'en-US' })
  assert.equal((html.match(/<option /g) ?? []).length, 30)
  assert.match(html, /<option value="en-US" selected="">英语（美国，en-US）<\/option>/)
  for (const value of ['zh-CN', 'zh-TW', 'zh-HK', 'pt-BR', 'pt-PT', 'es-MX', 'ja-JP', 'ko-KR', 'ms-MY']) assert(html.includes(`value="${value}"`), value)
  const id = html.match(/<select[^>]* id="([^"]+)"/)[1]
  assert(html.includes(`<label for="${id}">源语言</label>`))
  assert(!html.includes('<input'))
  assert.equal((renderLocale({ value: '' }).match(/<option /g) ?? []).length, 30)
})

test('unknown project locales remain selected as current values, including frozen fields', () => {
  for (const value of ['es-419', 'zh_CN']) {
    const html = renderLocale({ value, disabled: true })
    assert.equal((html.match(/<option /g) ?? []).length, 31)
    assert.match(html, /<select[^>]*disabled=""/)
    assert(html.includes(`<option value="${value}" selected="">${value}（当前值）</option>`))
    assert(!html.includes('<input'))
    assert(!html.includes('aria-invalid'))
  }
})

test('create and settings use the same dropdown and create preserves QA choice before opening the new project', () => {
  const create = readFileSync(new URL('ProjectsPage.tsx', client), 'utf8')
  const settings = readFileSync(new URL('Panels.tsx', client), 'utf8')
  for (const source of [create, settings]) {
    assert.equal((source.match(/<ProjectLocaleSelect\b/g) ?? []).length, 2)
    assert(!source.includes('Source locale<Input'))
    assert(!source.includes('Target locale<Input'))
  }
  assert.match(settings, /<ProjectLocaleSelect[^>]*disabled=\{archived \|\| hasBatches\}/)
  assert.match(create, /workflowStage, qaProfile, workspaceId/)
  assert.match(create, /await openProject\(created\)/)
  assert.match(create, /value=\{qaProfile\}/)
})
