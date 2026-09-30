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
const constraints = { LOCALE_MAX_LENGTH: 35, LOCALE_PATTERN: /^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/ }

function renderLocale(props) {
  const exports = {}
  const code = ts.transpileModule(readFileSync(new URL('ProjectLocaleSelect.tsx', client), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.React, target: ts.ScriptTarget.ES2022 },
  }).outputText
  runInNewContext(code, { exports, require: name => {
    if (name === 'react') return React
    if (name === '@deepseek-ai/dsh-client-ui-primitives') return { Input: props => React.createElement('input', props) }
    if (name === '../project-input') return constraints
    if (name === './ui-locale') return { useT: () => key => key }
    if (name.endsWith('.module.css')) return { default: {} }
    throw new Error(`Unexpected locale select import: ${name}`)
  } })
  return renderToStaticMarkup(React.createElement(exports.ProjectLocaleSelect, { label: '源语言', onValueChange() {}, ...props }))
}

test('project locale dropdown retains all 30 source languages and localized labels', () => {
  const html = renderLocale({ value: 'en-US' })
  assert.equal((html.match(/<option /g) ?? []).length, 31)
  assert.match(html, /<option value="en-US" selected="">英语（美国，en-US）<\/option>/)
  for (const value of ['zh-CN', 'zh-TW', 'zh-HK', 'pt-BR', 'pt-PT', 'es-MX', 'ja-JP', 'ko-KR', 'ms-MY']) assert(html.includes(`value="${value}"`), value)
  assert(html.includes('源语言'))
  assert(html.includes('自定义语言代码'))
  assert(!html.includes('<input'), 'common languages need no manual code input')
})

test('custom project locales retain their value and native validation, including frozen fields', () => {
  const html = renderLocale({ value: 'es-419', disabled: true })
  assert.match(html, /<select[^>]*disabled=""/)
  assert.match(html, /<input[^>]*disabled=""/)
  assert(html.includes('value="es-419"'))
  assert(html.includes('maxLength="35"'))
  assert(html.includes('required=""'))
  const pattern = html.match(/ pattern="([^"]+)"/)[1]
  for (const locale of ['en', 'es-419', 'zh-Hant-TW']) assert(new RegExp(pattern, 'v').test(locale))
  for (const locale of ['', 'zh_CN', 'zh--CN']) assert(!new RegExp(pattern, 'v').test(locale))
  assert.match(renderLocale({ value: 'zh_CN' }), /aria-invalid="true"/)
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
