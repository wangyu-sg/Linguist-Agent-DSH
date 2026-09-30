import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'

const require = createRequire(new URL('../../packages/dsh-linguist/package.json', import.meta.url))
const React = require('react')

function form(timing) {
  const state = [], calls = []
  let cursor, tree
  const exports = {}
  const source = readFileSync(new URL('../../packages/dsh-linguist/src/client/RunPanel.tsx', import.meta.url), 'utf8')
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.React, target: ts.ScriptTarget.ES2022 } }).outputText
  runInNewContext(`${code}\nexports.form = ScheduledAgentTaskForm`, { exports, Date, Intl, require: name => {
    if (name === 'react') return { ...React, useState(initial) { const index = cursor++; if (!(index in state)) state[index] = typeof initial === 'function' ? initial() : initial; return [state[index], value => { state[index] = typeof value === 'function' ? value(state[index]) : value }] } }
    if (name === '@deepseek-ai/dsh-client-ui-primitives') return { Button: 'button', Input: 'input', Checkbox: 'checkbox', Modal: 'modal' }
    if (name === './api') return { required: async (operation, input) => { calls.push({ operation, input: JSON.parse(JSON.stringify(input)) }); return { scheduleId: 'task' } } }
    if (name === './ui-locale') return { useT: () => text => text }
    if (name === './workflow-ui' || name === './ScheduleManager') return {}
    if (name.endsWith('.module.css')) return { default: {} }
    throw new Error(`Unexpected schedule form import: ${name}`)
  } })
  const editing = { scheduleId: 'task', version: 'v1', title: 'Synthetic', prompt: 'Synthetic only', timing, scope: 'project', scopeSnapshot: {}, sessionMode: 'daily', pausedByUser: true }
  const nodes = node => !node || typeof node !== 'object' ? [] : [node, ...React.Children.toArray(node.props?.children).flatMap(nodes)]
  return {
    calls,
    render() { cursor = 0; tree = exports.form({ projectId: 'project', sessionId: 'source', selectedSegmentIds: [], uiRevision: 1, editing, onSaved() {}, onCancelEdit() {} }); return nodes(tree) },
    change(label, value) { const control = this.render().find(node => node.type === 'label' && React.Children.toArray(node.props.children)[0] === label); assert(control, label); nodes(control).find(node => node.type === 'input').props.onChange({ target: { value } }) },
    async submit() { this.render(); tree.props.onSubmit({ preventDefault() {} }); await new Promise(resolve => setImmediate(resolve)); return this.render() },
  }
}

test('monthly editing and manual resume preserve the day and actual timing fields', async () => {
  const component = form({ kind: 'monthly', dayOfMonth: 31, time: '09:30' })
  const nodes = await component.submit()
  assert(nodes.some(node => node.type === 'h3' && node.props.children === '重新核验并恢复'))
  assert.equal(component.calls[0].operation, 'linguistScheduleUpdate')
  assert.deepEqual(component.calls[0].input.timing, { kind: 'monthly', dayOfMonth: 31, time: '09:30' })
  assert.equal(component.calls[0].input.scheduleId, 'task')
  assert.equal(component.calls[0].input.expectedVersion, 'v1')
})

test('interval editing preserves local active hours and Sunday, and rejects inverted windows', async () => {
  const timing = { kind: 'every', seconds: 3600, activeWindowStart: '09:00', activeWindowEnd: '18:00', activeWeekdays: [0, 1, 5] }
  const component = form(timing)
  await component.submit()
  assert.deepEqual(component.calls[0].input.timing, timing)
  component.change('开始时间', '19:00')
  const nodes = await component.submit()
  assert.equal(component.calls.length, 1)
  assert(nodes.some(node => node.props?.role === 'alert' && String(node.props.children).includes('开始时间须早于结束时间')))
})
