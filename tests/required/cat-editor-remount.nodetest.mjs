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
let apiRequired, navigation
const document = { activeElement: null }
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
  runInNewContext(code + (name === 'CatWorkbench.tsx' ? '\nexports.testRows = SegmentRows; exports.testWorkbench = WorkbenchBody;' : ''), { exports, document, window: { innerHeight: 800, setTimeout, clearTimeout },
    ResizeObserver: class { constructor(callback) { this.callback = callback; resizeObservers.push(this) } observe(target) { this.target = target } disconnect() { this.disconnected = true } },
    requestAnimationFrame: callback => { frames.set(++frameId, callback); return frameId }, cancelAnimationFrame: id => frames.delete(id),
    require: name => {
    if (name === 'react') return { ...React, ...Object.fromEntries(['useState', 'useRef', 'useMemo', 'useCallback', 'useEffect', 'useLayoutEffect', 'useImperativeHandle'].map(name => [name, (...args) => hooks ? hooks[name](...args) : React[name](...args)])) }
    if (name === 'jotai') return { ...jotai, useAtom: atom => { if (!hooks) return jotai.useAtom(atom); const store = hooks.store; return [store.get(atom), hooks.useCallback(value => store.set(atom, value), [store, atom])] } }
    if (name === './cat-editor-state') return load('cat-editor-state.ts')
    if (name === './TargetEditor') return load('TargetEditor.tsx')
    if (name === './cat-edit-utils') return load('cat-edit-utils.ts')
    if (name === './cat-virtual-utils') return load('cat-virtual-utils.ts')
    if (name === './tag-atomic-utils') return load('tag-atomic-utils.ts')
    if (name === './workflow-ui') return { stageActionLabel: () => '确认', stageProgressLabel: () => '翻译', segmentStatusBadgeTitle: () => '翻译', stageName: () => '翻译', stageCompletionLabel: () => '已确认', nextStageItemLabel: () => '下一待处理', stageFilterOptions: () => [] }
    if (name === '@tanstack/react-virtual') return { useVirtualizer: ({ count }) => ({ getVirtualItems: () => Array.from({ length: count }, (_, index) => ({ index, start: index * 94 })), getTotalSize: () => count * 94, scrollToIndex() {}, measureElement() {} }) }
    if (name === '@deepseek-ai/dsh-client-ui-primitives') return { Button: 'button', Input: 'input', Checkbox: 'checkbox', Menu: 'menu', Tooltip: 'tooltip', IconPanelLeftOutlineRegular: 'svg', IconEllipsisOutlineRegular: 'svg', IconChevronDownOutlineRegular: 'svg', IconCheckOutlineRegular: 'svg' }
    if (name === './ui-locale') return { useT: () => t }
    if (name === './api') return { required: (...args) => apiRequired(...args), subscribeProject: () => () => {} }
    if (name === './cat-navigation') return { useCatNavigation: () => navigation }
    if (name === './workbench-location') return { readWorkbenchLocation: () => ({ value: { assetId: 'asset-A', segmentId: 'row-199', assetNavigatorOpen: true, assetNavigatorWidth: 240, inspectorWidth: 320, dockOpen: true, dock: 'qa', dockHeight: 240 } }), writeWorkbenchLocation() {} }
    if (name === './composer-context') return { publishWorkbenchComposerContext() {} }
    if (name === './Panels') return Object.fromEntries(['QaPanel', 'ProposalPanel', 'ReferencePanel', 'AssetsPanel', 'DeliveryPanel', 'ProjectSettingsPanel'].map(name => [name, name]))
    if (name === './UnknownTagNotice') return { UnknownTagNotice: 'UnknownTagNotice' }
    if (name === './CatStatusBar') return { CatStatusBar: 'CatStatusBar' }
    if (name === './Splitter') return { Splitter: 'Splitter' }
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
    useLayoutEffect(run, deps) { return runtime.useEffect(run, deps) },
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
  row.props.onKeyDown({ key: 'Enter', target: { closest: () => null }, currentTarget: {} })
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

test('grid navigation moves DOM focus on every key, including a newly mounted row, and preserves editor keys', () => {
  const fixture = editorFixture('row-keyboard-focus')
  fixture.state.store.set(fixture.state.editingId, undefined)
  const segments = Array.from({ length: 20 }, (_, index) => ({ ...fixture.props.segment, id: `row-${index}`, ordinal: index }))
  const props = { data: { total: segments.length, ids: segments.map(row => row.id), rows: new Map(segments.map((row, i) => [i, row])) },
    drafts: fixture.state.drafts, editingIdAtom: fixture.state.editingId,
    signals: new Map(), selectedIds: new Set(), reviewingIds: new Set(), workflowStage: 'translation', selectedId: 'row-0',
    onVisibleRange() {}, onEditorHandleChange() {}, onSelect(id) { props.selectedId = id },
  }
  const rows = mountEditor(fixture.state, props, props => load('CatWorkbench.tsx').testRows(props))
  let focused = 0
  const rowNodes = () => rows.nodes().filter(node => node.props?.role === 'row' && node.props['data-index'] !== undefined)
  const commitRows = () => {
    rows.render()
    for (const row of rowNodes()) row.ref({ focus() { focused = row.props['data-index']; row.props.onFocus() } })
  }
  const key = value => {
    const row = rowNodes().find(row => row.props['data-index'] === focused)
    const element = { closest: () => null }
    row.props.onKeyDown({ key: value, target: element, currentTarget: element, preventDefault() {} })
    commitRows()
  }
  commitRows()
  for (const [value, expected] of [['ArrowDown', 1], ['ArrowDown', 2], ['ArrowUp', 1], ['End', 19], ['ArrowUp', 18], ['PageUp', 10], ['Home', 0], ['ArrowUp', 0]]) {
    key(value)
    assert.equal(focused, expected, `${value} must move DOM focus, not only the selected state`)
    assert.equal(props.selectedId, `row-${expected}`)
    assert.equal(rowNodes().filter(row => row.props.tabIndex === 0).length, 1)
  }
  // A virtualized target may mount after the key's render; focus must wait for its ref.
  const first = rowNodes()[0], element = { closest: () => null }
  first.props.onKeyDown({ key: 'End', target: element, currentTarget: element, preventDefault() {} })
  first.ref(null)
  rows.render()
  assert.equal(focused, 0)
  rowNodes().at(-1).ref({ focus() { focused = 19 } })
  assert.equal(focused, 19)
  key('Enter')
  assert.equal(fixture.state.store.get(fixture.state.editingId), 'row-19')
  const editingRow = rowNodes().at(-1)
  editingRow.props.onKeyDown({ key: 'ArrowUp', target: { closest: () => ({}) }, currentTarget: {}, preventDefault() { assert.fail('textarea arrow must stay native') } })
  assert.equal(props.selectedId, 'row-19')
  focused = undefined
  rows.editorProps().onCancel(); commitRows()
  assert.equal(focused, 19, 'canceling editing returns focus from the removed textarea')
  key('ArrowUp')
  assert.equal(focused, 18, 'canceling editing must return focus to grid navigation')
  rowNodes()[18].props.onKeyDown({ key: 'ArrowUp', target: { closest: () => null }, currentTarget: {}, preventDefault() {} })
  commitRows()
  assert.equal(focused, 17, 'checkboxes and row buttons permit arrow navigation')
  key('Enter')
  focused = undefined
  rows.editorProps().onSaved(false); commitRows()
  assert.equal(focused, 17, 'saving returns focus to grid navigation')
  rows.unmount()
})

test('external and QA focus waits for loaded mounted rows and preserves an editor already in that row', () => {
  const fixture = editorFixture('external-row-focus')
  const segments = Array.from({ length: 3 }, (_, ordinal) => ({ ...fixture.props.segment, id: `row-${ordinal}`, ordinal }))
  const settled = [], mounted = new Map()
  let focused, focusCalls = 0
  const props = { data: { total: 3, ids: segments.map(row => row.id), rows: new Map([[0, segments[0]]]) },
    drafts: fixture.state.drafts, editingIdAtom: fixture.state.editingId,
    signals: new Map(), selectedIds: new Set(), reviewingIds: new Set(), workflowStage: 'translation', selectedId: 'row-0',
    onVisibleRange() {}, onEditorHandleChange() {}, onSelect(id) { props.selectedId = id },
    onFocusSettled(index) { settled.push(index); props.focusIndex = undefined },
  }
  const rows = mountEditor(fixture.state, props, props => load('CatWorkbench.tsx').testRows(props))
  rows.render()
  const grid = rows.nodes().find(node => node.props?.role === 'grid')
  grid.ref.current = { querySelector(selector) { return mounted.get(Number(selector.match(/\d+/)[0])) } }
  const row = { contains(element) { return element?.row === 2 }, focus() { focused = 2; focusCalls++; document.activeElement = { row: 2 } } }
  rows.render({ selectedId: 'row-2', focusIndex: 2 })
  assert.deepEqual(settled, [], 'an unloaded target must retain the focus request')
  props.data = { ...props.data, rows: new Map([[0, segments[0]], [2, segments[2]]]) }
  rows.render()
  assert.deepEqual(settled, [], 'loading data alone does not prove the virtual row is mounted')
  mounted.set(2, row)
  rows.render({ data: { ...props.data, rows: new Map(props.data.rows) } })
  assert.equal(focused, 2)
  assert.deepEqual(settled, [2])
  document.activeElement = { row: 2, editor: true }
  rows.render({ focusIndex: 2 })
  assert.equal(focusCalls, 1, 'reload must not steal focus from the same row textarea')
  mounted.delete(2)
  rows.render({ focusIndex: 2, data: { ...props.data, rows: new Map([[0, segments[0]]]) } })
  rows.render({ selectedId: 'row-0' })
  mounted.set(2, row)
  rows.render({ data: { ...props.data, rows: new Map([[0, segments[0]], [2, segments[2]]]) } })
  assert.equal(focusCalls, 1, 'an older pending jump must not override a later selected row')
  rows.unmount()
  document.activeElement = null
})

async function workbenchFixture(id, queryPage, { filter = '', deferredQuery, movingProject = false } = {}) {
  const state = load('cat-editor-state.ts').getCatEditorState(id, 'project-synthetic')
  const segments = Array.from({ length: 403 }, (_, ordinal) => ({ id: `row-${ordinal}`, ordinal, source: 'Synthetic source', target: 'target', revision: 1, assetId: 'asset-A', locked: ordinal >= 200 && ordinal !== 401, currentStageState: 'untouched' }))
  const project = { id: 'project-synthetic', name: 'Synthetic project', sourceLocale: 'en-US', targetLocale: 'zh-CN', workflowStage: 'translation' }
  const summary = { project, assets: [{ assetId: 'asset-A', filename: 'synthetic.json', currentStageCounts: { confirmed: 0 }, segmentCount: segments.length }], assetCount: 1 }
  const calls = []
  navigation = undefined
  apiRequired = async (operation, input) => {
    if (operation === 'linguistProjectsOpen') return { project }
    if (operation === 'linguistProjectsGetSummary') return movingProject ? { ...summary, project: { ...project } } : summary
    if (operation === 'linguistCatGetContext') return { segment: segments[Number(input.segmentId.slice(4))], qaFindings: [] }
    if (operation === 'linguistCatConfirmStage') { const row = segments[Number(input.segmentId.slice(4))]; row.currentStageState = 'confirmed'; return { ...row } }
    if (operation === 'linguistCatQuery') {
      const filtered = segments.filter(row => (!input.currentStageState || row.currentStageState === input.currentStageState) && (!input.assetId || row.assetId === input.assetId) && (!input.search || row.source.includes(input.search)))
      if (input.offset > 0) { calls.push(input.offset); return queryPage(input.offset, filtered) }
      const page = { segments: filtered.slice(0, 200), segmentIds: filtered.map(row => row.id), total: filtered.length }
      return deferredQuery?.(input, page) ?? page
    }
    throw new Error(`Unexpected synthetic operation: ${operation}`)
  }
  const workbench = mountEditor(state, { projectId: project.id, sessionId: id, editorState: state }, props => load('CatWorkbench.tsx').testWorkbench(props))
  workbench.render(); await tick(); workbench.render(); await tick(); workbench.render()
  if (filter) { workbench.nodes().find(node => node.props?.['aria-label'] === '阶段筛选').props.onChange({ target: { value: filter } }); workbench.render(); await tick(); workbench.render() }
  const rows = () => workbench.nodes().find(node => node.type?.name === 'SegmentRows').props
  return { workbench, rows, segments, calls, async settle() { workbench.render(); await tick(); workbench.render(); await tick(); workbench.render() } }
}

test('confirm advance shares same-index page requests and refetches after confirmation', async () => {
  const releases = []
  const fixture = await workbenchFixture('advance-locked-pages', async (offset, segments) => {
    if (offset === 200) return new Promise(resolve => { releases.push(() => resolve({ segments: segments.slice(200, 400) })) })
    return { segments: segments.slice(offset, offset + 200) }
  })
  fixture.rows().onVisibleRange(200, 205)
  fixture.rows().onVisibleRange(200, 205)
  assert.deepEqual(fixture.calls, [200], 'the same query index shares visible-range requests')
  const advance = fixture.rows().onConfirm(fixture.segments[199])
  await tick(); fixture.workbench.render()
  assert.deepEqual(fixture.calls, [200, 200], 'confirmation must query new pages rather than reuse a pre-confirmation response')
  releases[0](); await tick(); fixture.workbench.render()
  assert.equal(fixture.rows().data.rows.has(200), false, 'an old page cannot merge into a refreshed index')
  fixture.rows().onVisibleRange(200, 205)
  assert.deepEqual(fixture.calls, [200, 200], 'advance and viewport share the new index request')
  releases[1](); await advance; fixture.workbench.render()
  assert.deepEqual(fixture.calls, [200, 200, 400])
  assert.equal(fixture.rows().selectedId, 'row-401')
  assert.equal(fixture.rows().focusIndex, 401)
  fixture.workbench.unmount()
})

test('confirm advance does not cross batch boundaries, report success after a page failure, or override later navigation', async () => {
  for (const outcome of ['batch-end', 'failure', 'empty-page', 'later-navigation', 'later-filter']) {
    let releasePage
    const fixture = await workbenchFixture(`advance-${outcome}`, (offset, segments) => {
      if (outcome === 'failure') return Promise.reject(new Error('Synthetic page request failed'))
      if (outcome === 'empty-page') return { segments: [] }
      if (outcome.startsWith('later-')) return new Promise(resolve => { releasePage = () => resolve({ segments: segments.slice(offset, offset + 200) }) })
      return { segments: [{ ...segments[200], locked: false, assetId: 'asset-B' }] }
    })
    const advance = fixture.rows().onConfirm(fixture.segments[199])
    await tick()
    if (outcome === 'later-navigation') { fixture.rows().onSelect('row-17'); fixture.workbench.render() }
    if (outcome === 'later-filter') { fixture.workbench.nodes().find(node => node.props?.['aria-label'] === '阶段筛选').props.onChange({ target: { value: 'untouched' } }); fixture.workbench.render() }
    releasePage?.()
    await advance; fixture.workbench.render()
    assert.equal(fixture.rows().selectedId, outcome === 'later-navigation' ? 'row-17' : outcome === 'later-filter' ? undefined : 'row-199', outcome)
    assert.deepEqual(fixture.calls, [200], `${outcome} must not continue loading stale or out-of-batch pages`)
    const statuses = fixture.workbench.nodes().filter(node => node.props?.role === 'status').flatMap(node => React.Children.toArray(node.props.children)).filter(value => typeof value === 'string').join(' ')
    if (outcome === 'failure') assert.match(statuses, /Synthetic page request failed/)
    if (outcome === 'empty-page') assert.match(statuses, /无法前进|没有下一个/)
    if (outcome === 'batch-end') assert.match(statuses, /没有下一个/)
    fixture.workbench.unmount()
  }
})

test('ordinary query refresh and search retain selection without requesting DOM focus', async () => {
  const fixture = await workbenchFixture('query-does-not-steal-focus', (offset, rows) => ({ segments: rows.slice(offset, offset + 200) }))
  assert.equal(fixture.rows().selectedId, 'row-199')
  assert.equal(fixture.rows().focusIndex, undefined, 'initial preserved selection is not an explicit focus request')
  fixture.workbench.nodes().find(node => node.type === 'menu').props.onSelect('refresh')
  await fixture.settle()
  assert.equal(fixture.rows().focusIndex, undefined, 'background refresh must preserve the composer focus')
  fixture.workbench.nodes().find(node => node.props?.['aria-label'] === '搜索源文或译文').props.onChange({ target: { value: 'Synthetic' } })
  await fixture.settle()
  assert.equal(fixture.rows().selectedId, 'row-199')
  assert.equal(fixture.rows().focusIndex, undefined, 'matching search must retain input focus')
  fixture.workbench.unmount()
})

test('confirm advance uses the shrinking post-confirm filter index and stable IDs across a locked page', async () => {
  for (const filter of ['untouched', 'draft']) {
    const fixture = await workbenchFixture(`advance-shrinking-${filter}`, (offset, rows) => ({ segments: rows.slice(offset, offset + 200) }), { filter, movingProject: true })
    if (filter === 'draft') { fixture.segments.forEach(row => { row.currentStageState = 'draft' }); fixture.workbench.nodes().find(node => node.type === 'menu').props.onSelect('refresh'); await fixture.settle() }
    const advance = fixture.rows().onConfirm(fixture.segments[199])
    await tick(); fixture.workbench.render(); await tick(); fixture.workbench.render()
    await advance; await fixture.settle()
    assert.equal(fixture.rows().selectedId, 'row-401', filter)
    assert.equal(fixture.rows().data.ids[fixture.rows().focusIndex], 'row-401', 'focus index must identify the same unlocked row')
    fixture.rows().onVisibleRange(fixture.rows().focusIndex, fixture.rows().focusIndex)
    await fixture.settle()
    assert.equal(fixture.rows().data.rows.get(fixture.rows().focusIndex).locked, false)
    assert.equal(fixture.rows().data.ids.includes('row-199'), false)
    fixture.workbench.unmount()
  }
})

test('a late background refresh cannot clear the segment chosen by completed confirmation', async () => {
  let initialQueries = 0, release, releasePage
  const fixture = await workbenchFixture('advance-before-late-refresh', (offset, rows) => offset === 200 ? new Promise(resolve => { releasePage = () => resolve({ segments: rows.slice(offset, offset + 200) }) }) : ({ segments: rows.slice(offset, offset + 200) }), { filter: 'untouched', movingProject: true, deferredQuery(input, page) {
    initialQueries++
    if (initialQueries === 4) return new Promise(resolve => { release = () => resolve(page) })
  } })
  const advance = fixture.rows().onConfirm(fixture.segments[199])
  await tick(); fixture.workbench.render(); await tick(); fixture.workbench.render()
  releasePage()
  await advance
  fixture.workbench.render()
  const completed = fixture.rows().data
  assert.equal(completed.rows.get(fixture.rows().focusIndex).id, 'row-401')
  assert.equal(typeof release, 'function', 'the background refresh must be held until navigation completes')
  release(); await fixture.settle()
  assert.equal(fixture.rows().selectedId, 'row-401')
  assert.equal(fixture.rows().data.rows.size, completed.rows.size, 'a stale refresh must retain the loaded confirmation rows')
  assert.equal(fixture.rows().data.ids, completed.ids, 'a stale refresh must retain the authoritative confirmation index')
  assert.equal(fixture.rows().data.rows.get(fixture.rows().focusIndex).id, 'row-401')
  fixture.workbench.unmount()
})


test('page loading waits for the new filtered index instead of writing new rows under old stable IDs', async () => {
  let defer = false, release
  const fixture = await workbenchFixture('no-old-index-new-filter', (offset, rows) => ({ segments: rows.slice(offset, offset + 200) }), { deferredQuery(input, page) {
    if (defer && input.currentStageState === 'untouched') return new Promise(resolve => { release = () => resolve(page) })
  } })
  fixture.segments[0].currentStageState = 'confirmed'
  defer = true
  fixture.workbench.nodes().find(node => node.props?.['aria-label'] === '阶段筛选').props.onChange({ target: { value: 'untouched' } })
  fixture.workbench.render()
  const oldIndex = fixture.rows().data.ids
  fixture.rows().onVisibleRange(200, 201)
  await tick(); fixture.workbench.render()
  assert.deepEqual(fixture.calls, [], 'an old index must not send page requests with the new query parameters')
  assert.equal(fixture.rows().data.rows.has(200), false)
  assert.equal(typeof release, 'function')
  release(); await fixture.settle()
  assert.notEqual(fixture.rows().data.ids, oldIndex)
  fixture.rows().onVisibleRange(200, 201)
  await fixture.settle()
  assert.equal(fixture.rows().data.ids[200], 'row-201')
  assert.equal(fixture.rows().data.rows.get(200).id, fixture.rows().data.ids[200])
  fixture.workbench.unmount()
})

test('normal refresh still loads current data when the user selects another row during the request', async () => {
  let defer = false, release
  const fixture = await workbenchFixture('refresh-during-row-selection', (offset, rows) => ({ segments: rows.slice(offset, offset + 200) }), { deferredQuery(input, page) {
    if (defer) return new Promise(resolve => { release = () => resolve(page) })
  } })
  fixture.segments[0] = { ...fixture.segments[0], target: 'newer external target', revision: 2 }
  defer = true
  fixture.workbench.nodes().find(node => node.type === 'menu').props.onSelect('refresh')
  fixture.workbench.render()
  fixture.rows().onSelect('row-17'); fixture.workbench.render()
  assert.equal(typeof release, 'function')
  release(); await fixture.settle()
  assert.equal(fixture.rows().selectedId, 'row-17')
  assert.equal(fixture.rows().data.rows.get(0).target, 'newer external target')
  assert.equal(fixture.rows().focusIndex, undefined)
  fixture.workbench.unmount()
})

test('a pending out-of-scope jump is cancelled by a later search, filter or batch choice', async () => {
  for (const change of ['搜索源文或译文', '阶段筛选', '工作批次']) {
    let defer = false, release
    const fixture = await workbenchFixture(`cancel-pending-${change}`, (offset, rows) => ({ segments: rows.slice(offset, offset + 200) }), { filter: 'untouched', deferredQuery(input, page) { if (defer && !input.assetId && !input.currentStageState && !input.search) return new Promise(resolve => { release = () => resolve(page) }) } })
    fixture.segments[250].currentStageState = 'confirmed'
    fixture.workbench.nodes().find(node => node.type === 'menu').props.onSelect('refresh')
    await fixture.settle()
    defer = true
    fixture.workbench.nodes().find(node => node.type === 'QaPanel').props.onNavigate('row-250')
    fixture.workbench.render(); await tick()
    fixture.workbench.nodes().find(node => node.props?.['aria-label'] === change).props.onChange({ target: { value: change === '阶段筛选' ? 'untouched' : change === '工作批次' ? 'asset-A' : 'Synthetic' } })
    await fixture.settle()
    release?.(); await fixture.settle()
    const statuses = fixture.workbench.nodes().filter(node => node.props?.role === 'status').flatMap(node => React.Children.toArray(node.props.children)).filter(value => typeof value === 'string').join(' ')
    assert.equal(fixture.rows().selectedId, 'row-199', 'later query must not consume a stale pending target')
    assert.doesNotMatch(statuses, /row-250/)
    assert.equal(fixture.rows().focusIndex, undefined)
    fixture.workbench.unmount()
  }
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
