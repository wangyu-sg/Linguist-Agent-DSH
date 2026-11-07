import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'

const require = createRequire(new URL('../../packages/dsh-linguist/package.json', import.meta.url))
const React = require('react')
const client = new URL('../../packages/dsh-linguist/src/client/', import.meta.url)
const compile = file => ts.transpileModule(readFileSync(new URL(file, client), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.React, target: ts.ScriptTarget.ES2022 } }).outputText
const code = compile('Panels.tsx'), workflow = {}
runInNewContext(compile('workflow-ui.ts'), { exports: workflow })
const t = (key, params = {}) => key.replace(/\{(\w+)\}/g, (_, name) => String(params[name]))
const tick = () => new Promise(resolve => setImmediate(resolve))
const terms = [
  { id: 'term-a', term: 'Synthetic spell', translation: '合成法术', status: 'required', caseSensitive: true, module: 'Battle', category: 'Skill', note: 'Synthetic note' },
  { id: 'term-b', term: 'Synthetic spell', translation: '合成咒语', status: 'preferred', caseSensitive: false },
]
const text = node => node == null || typeof node === 'boolean' ? '' : typeof node !== 'object' ? String(node) : React.Children.toArray(node.props?.children).map(text).join('')
const nodes = (node, parents = []) => typeof node !== 'object' || node === null ? [] : [{ node, parents }, ...React.Children.toArray(node.props?.children).flatMap(child => nodes(child, [...parents, node]))]

// Exercise the production component's state and callbacks with synthetic I/O, following the existing panel regressions.
function mount(overrides = {}, extraProps = {}) {
  const slots = [], pending = [], calls = [], exports = {}, effects = new Set()
  let cursor, tree
  const memo = (factory, deps) => {
    const i = cursor++
    if (!slots[i] || deps.some((value, j) => !Object.is(value, slots[i].deps[j]))) slots[i] = { deps, value: factory() }
    return slots[i].value
  }
  const handlers = {
    linguistReferencesQueryTerms: () => ({ items: terms, total: terms.length, hasMore: false }),
    linguistReferencesListTermConflicts: () => ({ count: 1, conflicts: [{ normalizedTerm: 'synthetic spell', entries: terms }] }),
    linguistReferencesQueryTm: () => ({ items: [{ id: 'tm-a', source: 'Synthetic source', target: '合成译文' }], total: 1, hasMore: false, sources: [{ id: 'source-a', displayName: 'Synthetic TM', enabled: true, priority: 1, unitCount: 1 }] }),
    ...overrides,
  }
  const props = { projectId: 'project-synthetic', assetId: 'batch-synthetic', segmentIds: [], mutation: 0, archived: false, onNavigate() {}, onChanged() {}, onSendAgentTask: async () => {}, ...extraProps }
  runInNewContext(code, { exports, require: name => {
    if (name === 'react') return { ...React,
      useState(initial) { const i = cursor++; if (!(i in slots)) slots[i] = typeof initial === 'function' ? initial() : initial; return [slots[i], value => { slots[i] = typeof value === 'function' ? value(slots[i]) : value }] },
      useCallback: (callback, deps) => memo(() => callback, deps),
      useEffect(run, deps) { const i = cursor++; effects.add(i); if (!slots[i] || deps.some((value, j) => !Object.is(value, slots[i].deps[j]))) pending.push(() => { slots[i]?.cleanup?.(); slots[i] = { deps, cleanup: run() } }) },
    }
    if (name === '@deepseek-ai/dsh-client-ui-primitives') return { Button: 'button', Input: 'input', Checkbox: 'checkbox' }
    if (name === './api') return { stageFiles: async () => ['synthetic-token'], required: async (operation, input) => { calls.push({ operation, input }); assert(handlers[operation], `Unexpected operation: ${operation}`); return handlers[operation](input) } }
    if (name === './ui-locale') return { useT: () => t }
    if (name === './project-errors') return { describeProjectError: String }
    if (name === './workflow-ui') return workflow
    if (name === './PreviewView') return { PreviewView: 'preview-view' }
    if (name.endsWith('.module.css')) return { default: new Proxy({}, { get: (_target, key) => key }) }
    return {}
  } })
  return {
    calls,
    render(next = {}) { Object.assign(props, next); cursor = 0; tree = exports.ReferencePanel(props); pending.splice(0).forEach(run => run()); return tree },
    async settle(next = {}) { this.render(next); await tick(); return this.render() },
    entries: () => nodes(tree),
    node(predicate) { const found = nodes(tree).find(({ node }) => predicate(node)); assert(found, 'Expected component node'); return found.node },
    input(label) { return this.node(node => node.props?.['aria-label'] === label).props },
    button(label) { return this.node(node => node.type === 'button' && text(node) === label).props },
    click(label) { const button = this.button(label); assert(!button.disabled, `${label} disabled`); return button.onClick() },
    outsideManagement(predicate) { const entry = nodes(tree).find(({ node }) => predicate(node)); assert(entry); assert(!entry.parents.some(parent => parent.props.className === 'referenceManagement')); return entry.node },
    dispose() { for (const i of effects) slots[i]?.cleanup?.() },
  }
}

const editor = panel => panel.node(node => node.type === 'fieldset')
const management = panel => panel.node(node => node.type === 'details' && node.props.className === 'referenceManagement')
const type = (panel, label, value) => panel.input(label).onChange({ target: { value } })
const selectTerm = (panel, id) => panel.node(node => node.type === 'article' && node.key?.endsWith(id)).props.children[0].props.children[0].props.onChange(true)

test('reference lookup stays direct while one management disclosure contains administration', async () => {
  const panel = mount()
  await panel.settle()
  for (const label of ['参考类别', '搜索参考', '术语状态筛选']) panel.outsideManagement(node => node.props?.['aria-label'] === label)
  panel.outsideManagement(node => node.type === 'button' && text(node) === '新增术语')
  panel.outsideManagement(node => node.type === 'article' && node.key?.endsWith('term-a'))
  assert.equal(editor(panel).props.hidden, true)
  const admin = management(panel)
  for (const predicate of [node => node.type === 'button' && text(node) === '新增术语', node => node.type === 'button' && text(node) === '校验所选句段术语 0 段', node => node.props.className === 'referenceManagement']) {
    const entry = panel.entries().find(({ node }) => predicate(node))
    assert(entry.parents.some(parent => parent.props.className === 'referenceActions'), 'term actions and management share the compact action row')
  }
  assert.equal(panel.button('校验所选句段术语 0 段').disabled, true)
  assert.equal(panel.button('校验所选句段术语 0 段').title, '先在 CAT 网格选择句段，再校验术语。')
  assert(!panel.entries().some(({ node }) => node.type === 'small' && text(node) === '先在 CAT 网格选择句段，再校验术语。'))
  const css = readFileSync(new URL('Panels.module.css', client), 'utf8')
  assert.match(css, /\.referenceActions\s*\{[^}]*flex-wrap:\s*wrap/)
  assert.match(css, /\.referenceManagement\[open\]\s*\{[^}]*flex:\s*1 0 100%/)
  assert.equal(admin.props.open, undefined, 'native disclosure starts closed and retains its own open state')
  assert.equal(admin.props.onToggle, undefined, 'closing management does not reset or unmount drafts')
  assert.match(text(admin.props.children[0]), /参考库管理.*导入与术语整理.*1.*组术语/)
  const descendants = nodes(admin).slice(1).map(({ node }) => node)
  assert(!descendants.some(node => node.type === 'details'), 'administrative actions are only one level deep')
  assert(descendants.some(node => node.type === 'input' && node.props.type === 'file'))
  assert(descendants.some(node => node.type === 'button' && text(node) === '让 Agent 整理本批术语'))
  assert(descendants.some(node => node.type === 'button' && text(node) === '保留此译法'))
  type(panel, '搜索参考', 'spell'); type(panel, '术语状态筛选', 'required'); await panel.settle()
  const query = panel.calls.filter(call => call.operation === 'linguistReferencesQueryTerms').at(-1).input
  assert.equal(query.query, 'spell'); assert.equal(query.status, 'required')
  panel.dispose()
})

test('row Edit opens and focuses the populated form; collapsing retains drafts and saves the same term', async () => {
  const panel = mount({ linguistReferencesUpsertTerm: () => ({}) })
  await panel.settle()
  panel.click('编辑'); panel.render()
  assert.equal(editor(panel).props.hidden, false)
  assert.equal(panel.button('收起术语编辑')['aria-expanded'], true)
  for (const [label, value] of [['术语', terms[0].term], ['译法', terms[0].translation], ['术语约束', 'required'], ['术语模块', 'Battle'], ['术语类别', 'Skill'], ['术语备注', 'Synthetic note']]) assert.equal(panel.input(label).value, value)
  assert.equal(panel.node(node => node.type === 'checkbox' && node.props.label === '区分大小写').props.checked, true)
  let focused = 0, scrolled = 0
  const form = { querySelector(selector) { assert.equal(selector, 'input'); return { focus(options) { assert.equal(options.preventScroll, true); focused++ } } }, scrollIntoView(options) { assert.equal(options.block, 'nearest'); scrolled++ } }
  panel.node(node => node.type === 'form').ref(form); panel.render()
  assert.equal(focused, 1); assert.equal(scrolled, 1)
  type(panel, '译法', 'Unsaved synthetic draft'); panel.render()
  panel.click('收起术语编辑'); panel.render()
  assert.equal(editor(panel).props.hidden, true)
  assert.equal(panel.input('译法').value, 'Unsaved synthetic draft')
  panel.click('继续编辑术语'); panel.render()
  panel.node(node => node.type === 'form').ref(form); panel.render()
  assert.equal(focused, 2)
  assert.equal(panel.input('译法').value, 'Unsaved synthetic draft')
  await panel.settle({ mutation: 1 })
  assert.equal(panel.input('译法').value, 'Unsaved synthetic draft')
  panel.node(node => node.type === 'form').props.onSubmit({ preventDefault() {} }); await panel.settle()
  const saved = panel.calls.find(call => call.operation === 'linguistReferencesUpsertTerm').input
  assert.deepEqual(JSON.parse(JSON.stringify(saved)), { projectId: 'project-synthetic', id: 'term-a', term: terms[0].term, translation: 'Unsaved synthetic draft', status: 'required', caseSensitive: true, module: 'Battle', category: 'Skill', note: 'Synthetic note' })
  assert.equal(panel.input('术语').value, '')
  panel.dispose()
})

test('new-term drafts survive collapse and category switches; repeat Edit focuses the selected row', async () => {
  const panel = mount()
  await panel.settle()
  panel.click('新增术语'); panel.render(); type(panel, '术语', 'New draft'); panel.render()
  panel.click('收起术语编辑'); panel.render(); panel.click('新增术语'); panel.render()
  assert.equal(panel.input('术语').value, 'New draft')
  type(panel, '参考类别', 'tm'); await panel.settle()
  type(panel, '参考类别', 'terms'); await panel.settle()
  assert.equal(panel.input('术语').value, 'New draft')
  for (const id of ['term-a', 'term-a', 'term-b']) {
    const row = panel.node(node => node.type === 'article' && node.key?.endsWith(id))
    nodes(row).find(({ node }) => node.type === 'button' && text(node) === '编辑').node.props.onClick(); panel.render()
    const expected = terms.find(term => term.id === id)
    assert.equal(panel.input('译法').value, expected.translation)
    let focused = false
    panel.node(node => node.type === 'form').ref({ querySelector: () => ({ focus() { focused = true } }), scrollIntoView() {} }); panel.render()
    assert(focused, 'every explicit row Edit requests focus, including the same row again')
  }
  assert.equal(panel.input('术语模块').value, '')
  assert.equal(panel.input('术语类别').value, '')
  assert.equal(panel.input('术语备注').value, '')
  panel.dispose()
})

test('selected term actions have a contextual count and keep existing bulk-delete and validation scopes', async () => {
  const panel = mount({ linguistReferencesDeleteTerms: input => ({ count: input.termIds.length }), linguistReferencesValidateTerms: () => ({ missingRequired: [], forbiddenHits: [], preferredNotUsed: [], unresolvedConflicts: [] }) }, { segmentIds: ['segment-a', 'segment-b'] })
  await panel.settle()
  assert(!panel.entries().some(({ node }) => node.props?.role === 'group'))
  selectTerm(panel, 'term-a'); panel.render(); selectTerm(panel, 'term-b'); panel.render()
  panel.outsideManagement(node => node.props?.role === 'group' && node.props['aria-label'] === '已选 2 条术语')
  panel.click('清除术语选择'); panel.render()
  assert(!panel.entries().some(({ node }) => node.props?.role === 'group'))
  selectTerm(panel, 'term-b'); panel.render(); panel.click('删除所选术语 1 条'); await panel.settle()
  assert.deepEqual(Array.from(panel.calls.find(call => call.operation === 'linguistReferencesDeleteTerms').input.termIds), ['term-b'])
  panel.click('校验所选句段术语 2 段'); await panel.settle()
  assert.deepEqual(Array.from(panel.calls.find(call => call.operation === 'linguistReferencesValidateTerms').input.segmentIds), ['segment-a', 'segment-b'])
  selectTerm(panel, 'term-a'); panel.render({ archived: true })
  assert.equal(panel.button('删除所选术语 1 条').disabled, true)
  assert.equal(panel.button('新增术语').disabled, true)
  assert.equal(panel.button('编辑').disabled, true)
  panel.render({ segmentIds: Array(201).fill('segment-a') })
  assert.equal(panel.button('校验所选句段术语 201 段').disabled, true)
  panel.dispose()
})

test('import progress, candidate mapping and errors remain outside the management disclosure', async () => {
  let finishImport
  const panel = mount({
    linguistReferencesImport: () => new Promise(resolve => { finishImport = resolve }),
    linguistReferencesMapXlsxCandidate: () => { throw new Error('Synthetic mapping failure') },
  })
  await panel.settle()
  panel.node(node => node.type === 'input' && node.props.type === 'file').props.onChange({ target: { files: [{ name: 'synthetic.xlsx' }], value: 'synthetic.xlsx' } })
  await panel.settle()
  panel.outsideManagement(node => node.props?.role === 'status' && text(node) === '正在处理参考导入…')
  assert.equal(panel.input('参考类别').disabled, true)
  finishImport({ requiresConfirmation: true, requiresXlsxMapping: true, candidateId: 'candidate-a', sourceSha256: 'a'.repeat(64), filename: 'synthetic.xlsx', preview: { sheets: [{ name: 'Terms', state: 'visible', columns: [{ index: 0, header: 'Source', selectable: true }, { index: 1, header: 'Target', selectable: true }], sampleRows: [] }] } })
  await panel.settle()
  panel.outsideManagement(node => node.props?.['aria-label'] === '参考文件候选确认')
  type(panel, '工作表', 'Terms'); panel.render(); type(panel, '源文列', 'Source'); type(panel, '译文列', 'Target'); panel.render()
  assert.equal(panel.button('预览参考候选').disabled, false)
  assert.equal(management(panel).props.open, undefined)
  panel.click('预览参考候选'); await panel.settle()
  panel.outsideManagement(node => node.props?.role === 'status' && text(node).includes('Synthetic mapping failure'))
  assert.equal(panel.input('工作表').value, 'Terms'); assert.equal(panel.input('源文列').value, 'Source'); assert.equal(panel.input('译文列').value, 'Target')
  assert.equal(panel.input('参考类别').disabled, true)
  assert.equal(panel.button('取消').disabled, false)
  panel.dispose()
})

test('TM administration stays one level deep and project-wide organization is labelled accurately', async () => {
  const panel = mount({ linguistReferencesUpdateTmSource: () => ({}) }, { assetId: undefined })
  await panel.settle()
  assert(panel.button('让 Agent 整理项目术语'))
  type(panel, '参考类别', 'tm'); await panel.settle()
  const sourceEntries = panel.entries().filter(({ node }) => node.type === 'checkbox' && node.props.label === 'Synthetic TM')
  assert.equal(sourceEntries.length, 1)
  assert.equal(sourceEntries[0].parents.filter(parent => parent.type === 'details').length, 1)
  sourceEntries[0].node.props.onChange(false); await panel.settle()
  panel.input('Synthetic TM 优先级').onBlur({ target: { value: '4' } }); await panel.settle()
  const writes = panel.calls.filter(call => call.operation === 'linguistReferencesUpdateTmSource').map(call => JSON.parse(JSON.stringify(call.input)))
  assert.deepEqual(writes, [{ projectId: 'project-synthetic', sourceId: 'source-a', enabled: false }, { projectId: 'project-synthetic', sourceId: 'source-a', priority: 4 }])
  panel.input('Synthetic TM 优先级').onBlur({ target: { value: '1.5' } }); panel.render()
  panel.outsideManagement(node => node.props?.role === 'status' && text(node) === '优先级必须是整数')
  panel.render({ archived: true })
  assert.equal(panel.input('Synthetic TM 优先级').disabled, true)
  assert.equal(panel.node(node => node.type === 'input' && node.props.type === 'file').props.disabled, true)
  panel.dispose()
})
