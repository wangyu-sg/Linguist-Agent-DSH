import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import vm from 'node:vm'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

test('registers a DSH settings page and renders its controls without LA Studio', async () => {
  const code = await readFile(new URL('../client.js', import.meta.url), 'utf8')
  let plugin
  vm.runInNewContext(code, { window: { __ModuleLoader__: { load: definition => { plugin = definition.factory(() => React) } } } })
  const entries = new Map()
  plugin.apply({ slots: { inject: (_name, fn) => fn(), register: (spec, component) => entries.set(`${spec.name}:${spec.id}`, component) } })
  const Settings = entries.get('settings.section:memsearch-control')
  assert.ok(Settings)
  assert.ok(entries.has('settings.section.icon:memsearch-control'))
  assert.ok(entries.has('shell.overlay:memsearch-control.styles'))
  const markup = renderToStaticMarkup(React.createElement(Settings))
  for (const text of ['后台摘要模型', '模型提供方', '请选择模型', '思考强度', '记忆检索', '技能候选']) assert.match(markup, new RegExp(text))
})
