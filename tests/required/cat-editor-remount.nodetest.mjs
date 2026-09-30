import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'

const require = createRequire(new URL('../../packages/dsh-linguist/package.json', import.meta.url))
const React = require('react')
const jotai = require('jotai')
const { renderToStaticMarkup } = require('react-dom/server')
const client = new URL('../../packages/dsh-linguist/src/client/', import.meta.url)
const cache = new Map()
let hooks
const resizeObservers = [], frames = new Map()
let frameId = 0
const t = (key, params = {}) => key.replace(/\{(\w+)\}/g, (_, name) => String(params[name]))

function load(name) {
  if (cache.has(name)) return cache.get(name)
  const exports = {}
  cache.set(name, exports)
  const code = ts.transpileModule(readFileSync(new URL(name, client), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.React, target: ts.ScriptTarget.ES2022 },
  }).outputText
  runInNewContext(code + (name === 'CatWorkbench.tsx' ? '\nexports.testRows = SegmentRows;' : ''), { exports, window: { innerHeight: 800 },
    ResizeObserver: class { constructor(callback) { this.callback = callback; resizeObservers.push(this) } observe(target) { this.target = target } disconnect() { this.disconnected = true } },
    requestAnimationFrame: callback => { frames.set(++frameId, callback); return frameId }, cancelAnimationFrame: id => frames.delete(id),
    require: name => {
    if (name === 'react') return { ...React, ...Object.fromEntries(['useState', 'useRef', 'useMemo', 'useCallback', 'useEffect', 'useImperativeHandle'].map(name => [name, (...args) => hooks ? hooks[name](...args) : React[name](...args)])) }
    if (name === 'jotai') return { ...jotai, useAtom: atom => { if (!hooks) return jotai.useAtom(atom); const store = hooks.store; return [store.get(atom), hooks.useCallback(value => store.set(atom, value), [store, atom])] } }
    if (name === './cat-editor-state') return load('cat-editor-state.ts')
    if (name === './TargetEditor') return load('TargetEditor.tsx')
    if (name === './cat-edit-utils') return load('cat-edit-utils.ts')
    if (name === './cat-virtual-utils') return load('cat-virtual-utils.ts')
    if (name === './tag-atomic-utils') return load('tag-atomic-utils.ts')
    if (name === './workflow-ui') return { stageActionLabel: () => '确认', stageProgressLabel: () => '翻译', segmentStatusBadgeTitle: () => '翻译' }
    if (name === '@tanstack/react-virtual') return { useVirtualizer: ({ count }) => ({ getVirtualItems: () => Array.from({ length: count }, (_, index) => ({ index, start: index * 94 })), getTotalSize: () => count * 94, scrollToIndex() {}, measureElement() {} }) }
    if (name === '@deepseek-ai/dsh-client-ui-primitives') return { Button: 'button', Checkbox: 'checkbox', Menu: 'menu', Tooltip: 'tooltip', IconPanelLeftOutlineRegular: 'svg', IconEllipsisOutlineRegular: 'svg', IconChevronDownOutlineRegular: 'svg', IconCheckOutlineRegular: 'svg' }
    if (name === './ui-locale') return { useT: () => t }
    if (name.endsWith('.module.css')) return { default: {} }
    // The lifecycle fixture has no protected tokens; tag rules have their own copied tests.
    if (name === '@linguist/cat-core') return { scanTags: () => [], compileTagFamilyRegex: () => null }
    // These children are not rendered by the provider lifecycle probe.
    return {}
  } })
  return exports
}

function mountStore(sessionId, projectId) {
  const tree = load('CatWorkbench.tsx').CatWorkbench({ sessionId, projectId })
  let store
  function Probe() { store = jotai.useStore(); return null }
  renderToStaticMarkup(React.cloneElement(tree, undefined, React.createElement(Probe)))
  return store
}

test('closing and reopening the native CAT workbench keeps draft state and isolates project and Session', () => {
  const draft = jotai.atom({ value: 'original', past: [], future: [], baseRevision: 1 })
  const first = mountStore('session-A', 'project-A')
  first.set(draft, { value: 'unsaved synthetic draft', past: ['original'], future: [], baseRevision: 1 })
  const reopened = mountStore('session-A', 'project-A')
  assert.equal(reopened.get(draft).value, 'unsaved synthetic draft', 'whole workbench remount must retain the draft')
  assert.deepEqual(reopened.get(draft).past, ['original'])
  assert.equal(mountStore('session-B', 'project-A').get(draft).value, 'original')
  assert.equal(mountStore('session-A', 'project-B').get(draft).value, 'original')
})

function mountEditor(scope, props, render = props => load('TargetEditor.tsx').TargetEditor.render(props, null), textarea) {
  const slots = [], pending = []
  let cursor, tree
  const memo = (factory, deps) => {
    const index = cursor++
    if (!slots[index] || deps.some((value, i) => !Object.is(value, slots[index].deps[i]))) slots[index] = { value: factory(), deps }
    return slots[index].value
  }
  const runtime = {
    store: scope.store,
    useState(initial) { const index = cursor++; if (!(index in slots)) slots[index] = typeof initial === 'function' ? initial() : initial; return [slots[index], value => { slots[index] = typeof value === 'function' ? value(slots[index]) : value }] },
    useRef: initial => memo(() => ({ current: initial }), []),
    useMemo: memo,
    useCallback: (callback, deps) => memo(() => callback, deps),
    useEffect(run, deps) { const index = cursor++; if (!slots[index] || deps.some((value, i) => !Object.is(value, slots[index].deps[i]))) pending.push(() => { slots[index]?.cleanup?.(); slots[index] = { deps, cleanup: run() } }) },
    useImperativeHandle() {},
  }
  const nodes = node => typeof node !== 'object' || node === null ? [] : [node, ...React.Children.toArray(node.props?.children).flatMap(nodes), ...React.Children.toArray(node.props?.anchor).flatMap(nodes)]
  return {
    render(next = {}) {
      Object.assign(props, next)
      hooks = runtime
      try { for (let pass = 0; pass < 2; pass++) { cursor = 0; tree = render(props); if (textarea) nodes(tree).find(node => node.type === 'textarea').ref.current = textarea; pending.splice(0).forEach(run => run()) } }
      finally { hooks = undefined }
      return tree
    },
    nodes: () => nodes(tree),
    input(value) { nodes(tree).find(node => node.type === 'textarea').props.onChange({ target: { value } }) },
    textarea() { return nodes(tree).find(node => node.type === 'textarea').props },
    editorProps() { return nodes(tree).find(node => node.type === load('TargetEditor.tsx').TargetEditor).props },
    click(label) { const button = nodes(tree).find(node => node.type === 'button' && (node.props['aria-label'] === label || node.props.children === label)); assert(button, label); assert(!button.props.disabled, label); button.props.onClick() },
    unmount() { slots.forEach(slot => slot?.cleanup?.()) },
  }
}

const tick = () => new Promise(resolve => setImmediate(resolve))
function editorFixture(id) {
  const state = load('cat-editor-state.ts').getCatEditorState(id, 'project-synthetic')
  const { createTargetDraftState } = load('TargetEditor.tsx')
  const segment = { id: 'same-segment', source: 'Synthetic source', target: 'original', revision: 1, locked: false }
  const draftAtom = jotai.atom({ state: createTargetDraftState(segment.target), baseTarget: segment.target, baseRevision: segment.revision, saving: false, conflict: false, resolvingConflict: false })
  state.drafts.set(segment.id, draftAtom)
  state.store.set(state.editingId, segment.id)
  const props = { draftAtom, segment, index: 0, archived: false, confirmLabel: '确认', onCancel() {}, onSave: async () => 'saved', onReload: async () => segment, onSaved() {} }
  return { state, props, mount: () => mountEditor({ ...state, store: mountStore(id, 'project-synthetic') }, props) }
}

test('remounted target editor preserves undo, redo, IME text and reacts to an external revision without dropping the draft', () => {
  const fixture = editorFixture('draft-lifecycle')
  let editor = fixture.mount()
  editor.render()
  editor.input('first edit'); editor.render()
  editor.input('second edit'); editor.render()
  editor.unmount()
  editor = fixture.mount(); editor.render()
  assert.equal(editor.textarea().value, 'second edit')
  editor.click('撤销译文编辑'); editor.render()
  assert.equal(editor.textarea().value, 'first edit')
  editor.click('重做译文编辑'); editor.render()
  assert.equal(editor.textarea().value, 'second edit')
  editor.textarea().onCompositionStart(); editor.render()
  editor.input('输入法草稿'); editor.render(); editor.unmount()
  editor = fixture.mount(); editor.render({ segment: { ...fixture.props.segment, target: 'remote update', revision: 2 } })
  assert.equal(editor.textarea().value, '输入法草稿')
  const restored = fixture.state.store.get(fixture.props.draftAtom)
  assert.equal(restored.state.composing, false)
  assert.equal(restored.conflict, true)
  assert.equal(restored.baseRevision, 2)
  editor.unmount()
})

test('saving remains read-only after remount and a failed response keeps the draft editable', async () => {
  const fixture = editorFixture('pending-save')
  let finishSave
  fixture.props.onSave = () => new Promise(resolve => { finishSave = resolve })
  let editor = fixture.mount()
  editor.render(); editor.input('awaiting save'); editor.render(); editor.click('保存译文'); editor.render()
  assert.equal(editor.textarea().readOnly, true)
  editor.unmount(); editor = fixture.mount(); editor.render()
  assert.equal(editor.textarea().value, 'awaiting save')
  assert.equal(editor.textarea().readOnly, true)
  finishSave('failed'); await tick(); editor.render()
  assert.equal(editor.textarea().value, 'awaiting save')
  assert.equal(editor.textarea().readOnly, false)
  editor.unmount()
})

test('a late saved row cannot close another editor or remove a replacement draft', async () => {
  const fixture = editorFixture('late-row-save')
  const a = fixture.props.segment
  const b = { ...a, id: 'other-segment' }
  let finishSave
  const props = { data: { total: 2, ids: [a.id, b.id], rows: new Map([[0, a], [1, b]]) },
    drafts: fixture.state.drafts, editingIdAtom: fixture.state.editingId,
    signals: new Map(), selectedIds: new Set(), reviewingIds: new Set(), workflowStage: 'translation',
    onVisibleRange() {}, onEditorHandleChange() {}, onSave: () => new Promise(resolve => { finishSave = resolve }),
    onReload: async () => a, onConfirm() {},
  }
  const rows = mountEditor(fixture.state, props, props => load('CatWorkbench.tsx').testRows(props))
  rows.render()
  const oldProps = rows.editorProps()
  const editorA = mountEditor(fixture.state, oldProps)
  editorA.render(); editorA.input('saving A'); editorA.render(); editorA.click('保存译文')
  editorA.unmount()
  fixture.state.store.set(fixture.state.editingId, b.id)
  rows.render()
  const editorB = mountEditor(fixture.state, rows.editorProps())
  editorB.render(); editorB.input('keep B'); editorB.render()
  finishSave('saved'); await tick(); rows.render(); editorB.render()
  assert.equal(fixture.state.store.get(fixture.state.editingId), b.id)
  assert.equal(editorB.textarea().value, 'keep B')
  assert(!fixture.state.drafts.has(a.id) || fixture.state.drafts.get(a.id) !== oldProps.draftAtom)
  editorB.unmount()

  fixture.state.store.set(fixture.state.editingId, a.id)
  rows.render()
  const staleCompletion = rows.editorProps().onSaved
  const replacement = jotai.atom({ ...fixture.state.store.get(fixture.props.draftAtom) })
  fixture.state.drafts.set(a.id, replacement)
  staleCompletion(false)
  assert.equal(fixture.state.drafts.get(a.id), replacement)
  assert.equal(fixture.state.store.get(fixture.state.editingId), a.id)
  rows.unmount()
})

test('disposing the plugin clears in-memory drafts', () => {
  const old = mountStore('dispose-session', 'dispose-project')
  load('cat-editor-state.ts').clearCatEditorStates()
  assert.notEqual(mountStore('dispose-session', 'dispose-project'), old)
})


test('row secondary actions use the native menu while direct confirmation and editing remain reachable', () => {
  const fixture = editorFixture('row-action-menu')
  fixture.state.store.set(fixture.state.editingId, undefined)
  const segment = { ...fixture.props.segment, ordinal: 0, currentStageState: 'untouched' }
  const calls = []
  const props = { data: { total: 1, ids: [segment.id], rows: new Map([[0, segment]]) },
    drafts: fixture.state.drafts, editingIdAtom: fixture.state.editingId,
    signals: new Map(), selectedIds: new Set(), reviewingIds: new Set(), workflowStage: 'translation',
    onVisibleRange() {}, onEditorHandleChange() {}, onSelect() {},
    onConfirm(value) { calls.push(['confirm', value.id]) }, onUnconfirm(value) { calls.push(['unconfirm', value.id]) },
    onReferenceAgent(value) { calls.push(['reference', value.id]) }, onReviewProposal(_segment, proposal, action) { calls.push([action, proposal.id]) },
  }
  const rows = mountEditor(fixture.state, props, props => load('CatWorkbench.tsx').testRows(props))
  rows.render()
  assert(!rows.nodes().some(node => node.type === 'button' && node.props.children === '为 Agent 引用'))
  const row = rows.nodes().find(node => node.props?.role === 'row' && node.props['aria-rowindex'] === 2)
  assert.equal(typeof row.ref, 'function', 'virtual rows retain actual DOM height measurement')
  row.props.onKeyDown({ key: 'Enter', target: {}, currentTarget: {} })
  assert.equal(fixture.state.store.get(fixture.state.editingId), undefined, 'native controls keep their own keyboard activation')
  rows.click('确认句段 1')
  const menu = () => rows.nodes().find(node => node.type === 'menu')
  rows.click('句段 1 的更多操作'); rows.render()
  assert.equal(menu().props.open, true)
  menu().props.onSelect('reference'); rows.render()
  assert.equal(menu().props.open, false)
  assert.deepEqual(calls, [['confirm', segment.id], ['reference', segment.id]])
  rows.click('句段 1 的更多操作'); rows.render()
  assert.equal(menu().props.open, true)
  rows.nodes().find(node => node.props?.role === 'grid').props.onScroll()
  rows.render()
  assert.equal(menu().props.open, false, 'scrolling closes the row menu before virtual rows are recycled')
  const proposal = { id: 'proposal-one', baseRevision: 1 }
  props.signals.set(segment.id, { proposal })
  rows.render({ data: { ...props.data, rows: new Map([[0, { ...segment, locked: true, currentStageState: 'confirmed' }]]) } })
  assert(!rows.nodes().some(node => node.type === 'button' && node.props['aria-label'] === '确认句段 1'))
  assert.equal(menu().props.items.find(item => item.id === 'accept').disabled, true)
  assert.equal(menu().props.items.find(item => item.id === 'reject').disabled, false)
  menu().props.onSelect('unconfirm')
  assert.deepEqual(calls.at(-1), ['unconfirm', segment.id])
  rows.render({ archived: true })
  assert.equal(menu().props.items.find(item => item.id === 'unconfirm').disabled, true)
  assert.equal(menu().props.items.find(item => item.id === 'reject').disabled, true)
  rows.render({ archived: false, data: { ...props.data, rows: new Map([[0, segment]]) } })
  rows.nodes().find(node => node.type === 'button' && node.props.children === segment.target).props.onClick()
  rows.render()
  assert.equal(rows.editorProps().segment.id, segment.id)
  rows.unmount()
})

test('resizing a native CAT column remeasures the target without disturbing IME or reacting to height-only changes', () => {
  const fixture = editorFixture('column-resize')
  const textarea = { clientWidth: 400, scrollHeight: 80, style: {}, value: 'original', selectionStart: 0, selectionEnd: 0 }
  const editor = mountEditor(fixture.state, fixture.props, undefined, textarea)
  editor.render()
  const observer = resizeObservers.at(-1)
  assert.equal(observer.target, textarea)
  assert.equal(textarea.style.height, '80px')
  textarea.clientWidth = 160; textarea.scrollHeight = 220
  observer.callback()
  for (const callback of frames.values()) callback()
  frames.clear()
  assert.equal(textarea.style.height, '220px')
  observer.callback()
  assert.equal(frames.size, 0, 'a height change must not create a resize loop')
  editor.textarea().onCompositionStart(); editor.render()
  textarea.clientWidth = 100; textarea.scrollHeight = 320
  observer.callback()
  for (const callback of frames.values()) callback()
  frames.clear()
  assert.equal(textarea.style.height, '220px', 'composition must retain its DOM layout until commit')
  editor.textarea().onCompositionEnd({ currentTarget: textarea }); editor.render()
  for (const callback of frames.values()) callback()
  frames.clear()
  assert.equal(textarea.style.height, '320px')
  editor.unmount()
  assert.equal(observer.disconnected, true)
})
