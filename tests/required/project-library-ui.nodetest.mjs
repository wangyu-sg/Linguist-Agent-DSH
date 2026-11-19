import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'

const React = createRequire(new URL('../../packages/dsh-linguist/package.json', import.meta.url))('react')
const code = ts.transpileModule(readFileSync(new URL('../../packages/dsh-linguist/src/client/ProjectLibraryPage.tsx', import.meta.url), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.React, target: ts.ScriptTarget.ES2022 },
}).outputText
const tick = () => new Promise(resolve => setImmediate(resolve))
const text = node => node == null || typeof node === 'boolean' ? '' : typeof node !== 'object' ? String(node) : React.Children.toArray(node.props?.children).map(text).join('')
const nodes = node => typeof node !== 'object' || node === null || node.type === 'modal' && !node.props.open ? [] : [node, ...React.Children.toArray(node.props?.children).flatMap(nodes)]

function mount(archivedAt, initialGroup) {
  const groups = [{ id: 'ungrouped', name: '未分组', archived: false }, { id: 'A', name: '十一月', archived: false }, { id: 'B', name: '十二月', archived: false }]
  const slots = [], effects = [], pending = [], calls = [], exports = {}
  let cursor, tree, changed
  let items = [{ key: 'file:rules.txt', path: 'rules.txt', filename: 'rules.txt', origin: 'workspace', kind: 'rules', appliesTo: ['dialogue'], status: 'ready', warnings: [] }]
  runInNewContext(code, { exports, window: { addEventListener() {}, removeEventListener() {} }, require: name => {
    if (name === '@linguist/domain-service/contracts') return { LINGUIST_FILE_MAX_BYTES: 1_073_741_824 }
    if (name === 'react') return { ...React,
      useState(initial) { const i = cursor++; if (!(i in slots)) slots[i] = initial; return [slots[i], value => { slots[i] = typeof value === 'function' ? value(slots[i]) : value }] },
      useEffect(run, deps) { const i = cursor++; if (!effects[i]) pending.push(() => { effects[i] = run() }) },
    }
    if (name === '@deepseek-ai/dsh-client-ui-primitives') return { Button: 'button', Input: 'input', Modal: 'modal' }
    if (name === './api') return {
      subscribeProject: (_id, _revision, onChange) => { changed = onChange; return () => {} },
      stageFiles: async files => { assert.equal(files.length, 1); return ['upload-token'] }, discardStagedFiles: async () => {},
      required: async (operation, input) => {
        calls.push({ operation, input })
        if (operation === 'linguistLibrarySave') items = [{ ...items[0], appliesTo: input.appliesTo }]
        if (operation === 'linguistLibraryRemove') items = []
        return { items, groups }
      },
    }
    if (name === './ui-locale') return { useT: () => key => key }
    if (name === './PreviewView') return { PreviewView: 'preview' }
    if (name.endsWith('.module.css')) return { default: {} }
    throw new Error(name)
  } })
  return {
    calls, get changed() { return changed },
    render() { cursor = 0; tree = exports.ProjectLibraryPage({ project: { id: 'synthetic-project', name: 'Synthetic', archivedAt }, initialGroup, onBack() {} }); pending.splice(0).forEach(run => run()); return tree },
    async settle() { this.render(); await tick(); return this.render() },
    node(predicate) { const node = nodes(tree).find(predicate); assert(node, 'Missing UI node'); return node },
    button(label) { return this.node(node => node.type === 'button' && text(node) === label).props },
    click(label) { const button = this.button(label); assert(!button.disabled); return button.onClick() },
  }
}

test('library page edits and removes the listed resource directly without opening CAT or creating a Session', async () => {
  const page = mount()
  await page.settle()
  page.click('编辑'); page.render()
  page.node(node => node.type === 'textarea').props.onChange({ target: { value: 'battle\nUI' } })
  page.render()
  await page.node(node => node.type === 'form').props.onSubmit({ preventDefault() {} }); await page.settle()
  const save = page.calls.find(call => call.operation === 'linguistLibrarySave').input
  assert.equal(save.key, 'file:rules.txt')
  assert.equal(save.projectId, 'synthetic-project')
  assert.equal(save.kind, 'rules')
  assert.equal(JSON.stringify(save.appliesTo), '["battle","UI"]')
  page.click('替换'); page.render()
  assert.equal(page.node(node => node.type === 'input' && node.props.type === 'file').props.required, true)
  assert.equal(page.button('保存资料').disabled, true, 'replacement requires a file')
  page.click('取消'); page.render()
  page.click('移除'); page.render()
  const dialog = page.node(node => node.type === 'modal' && node.props.open)
  await nodes(dialog).find(node => node.type === 'button' && text(node) === '移除').props.onClick()
  await page.settle()
  assert.equal(page.calls.find(call => call.operation === 'linguistLibraryRemove').input.key, 'file:rules.txt')
  assert.match(text(page.render()), /还没有项目资料/)
  const before = page.calls.length
  page.changed(); await page.settle()
  assert.equal(page.calls.length, before + 1, 'Agent mutation refreshes the shared list')
  assert(page.calls.every(call => call.operation.startsWith('linguistLibrary')), 'no CAT open or Session creation')
})

test('archived project library remains readable and disables edits', async () => {
  const page = mount('2026-01-01T00:00:00Z')
  await page.settle()
  for (const action of ['添加资料', '编辑', '替换', '移除']) assert.equal(page.button(action).disabled, true, action)
  assert.equal(page.button('查看').disabled, false)
})

test('a group inherits project rules and can replace one only in its own scope', async () => {
  const page = mount(undefined, { id: 'A', name: '十一月', archived: false })
  await page.settle()
  assert.equal(page.calls[0].input.taskGroupId, 'A')
  assert.equal(page.button('编辑').disabled, true)
  assert.equal(page.button('移除').disabled, true)
  page.click('仅本组替代'); page.render()
  page.node(node => node.type === 'input' && node.props.type === 'file').props.onChange({ target: { files: [{ name: 'sg-A.txt' }] } })
  page.render()
  await page.node(node => node.type === 'form').props.onSubmit({ preventDefault() {} })
  await tick()
  const save = page.calls.find(call => call.operation === 'linguistLibrarySave').input
  assert.equal(save.taskGroupId, 'A')
  assert.equal(save.replacesInherited, 'file:rules.txt')
  assert.equal(save.key, undefined)
})
