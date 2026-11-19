import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'
import * as inlineTokens from '../../packages/dsh-linguist/src/client/inline-tokens.ts'

const require = createRequire(new URL('../../packages/dsh-linguist/package.json', import.meta.url))
const React = require('react')
const jotai = require('jotai')
const { renderToStaticMarkup } = require('react-dom/server')
const client = new URL('../../packages/dsh-linguist/src/client/', import.meta.url)
const cache = new Map()
let hooks
let apiRequired, navigation
const document = { activeElement: null }
const t = (key, params = {}) => key.replace(/\{(\w+)\}/g, (_, name) => String(params[name]))

function load(name) {
  if (cache.has(name)) return cache.get(name)
  const exports = {}
  cache.set(name, exports)
  const code = ts.transpileModule(readFileSync(new URL(name, client), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.React, target: ts.ScriptTarget.ES2022 },
  }).outputText
  runInNewContext(code + (name === 'CatWorkbench.tsx' ? '\nexports.testRows = SegmentRows; exports.testWorkbench = WorkbenchBody; exports.testInline = ProposalInlineReview;' : ''), { exports, document, crypto: { randomUUID: () => 'synthetic-key' }, window: { innerHeight: 800, setTimeout: (...args) => setTimeout(...args), clearTimeout: timer => clearTimeout(timer) },
    require: name => {
    if (name === 'react') return { ...React, ...Object.fromEntries(['useState', 'useRef', 'useMemo', 'useCallback', 'useEffect', 'useLayoutEffect', 'useImperativeHandle'].map(name => [name, (...args) => hooks ? hooks[name](...args) : React[name](...args)])) }
    if (name === 'jotai') return { ...jotai, useAtomValue: atom => hooks ? hooks.store.get(atom) : jotai.useAtomValue(atom), useAtom: atom => { if (!hooks) return jotai.useAtom(atom); const store = hooks.store; return [store.get(atom), hooks.useCallback(value => store.set(atom, value), [store, atom])] } }
    if (name === './cat-editor-state') return load('cat-editor-state.ts')
    if (name === './TargetEditor') return load('TargetEditor.tsx')
    if (name === './TokenEditor') return { TokenEditor: 'TokenEditor' }
    if (name === './InlineTaggedText') return { InlineTaggedText: 'InlineTaggedText' }
    if (name === './EditorAssistance') return { useEditorViewOptions: () => [{ invisibles: false, terms: true, critical: true, spelling: true, differences: false, context: false }, () => {}, ''], useEditorTerms: () => ({ items: new Map() }), EditorViewControls: 'EditorViewControls', SegmentTextCells: SegmentTextCellsFixture }
    if (name === './inline-tokens') return inlineTokens
    if (name === './cat-edit-utils') return load('cat-edit-utils.ts')
    if (name === './cat-virtual-utils') return load('cat-virtual-utils.ts')
    if (name === './proposal-view') return load('proposal-view.ts')
    if (name === './workflow-ui') return { stageActionLabel: () => '确认', stageProgressLabel: () => '翻译', segmentStatusBadgeTitle: () => '翻译', stageName: () => '翻译', stageCompletionLabel: () => '已确认', nextStageItemLabel: () => '下一待处理', stageFilterOptions: () => [] }
    if (name === '@tanstack/react-virtual') return { useVirtualizer: ({ count }) => ({ getVirtualItems: () => Array.from({ length: count }, (_, index) => ({ index, start: index * 94 })), getTotalSize: () => count * 94, scrollToIndex() {}, measureElement() {} }) }
    if (name === '@deepseek-ai/dsh-client-ui-primitives') return { Button: 'button', Input: 'input', Checkbox: 'checkbox', Menu: 'menu', Tooltip: 'tooltip', IconPanelLeftOutlineRegular: 'svg', IconEllipsisOutlineRegular: 'svg', IconChevronDownOutlineRegular: 'svg', IconCheckOutlineRegular: 'svg', IconCheckCircleFillRegular: 'svg' }
    if (name === './ui-locale') return { useT: () => t }
    if (name === './api') return { required: (...args) => apiRequired(...args), subscribeProject: () => () => {} }
    if (name === './cat-navigation') return { useCatNavigation: () => navigation, requestCatNavigation: input => { navigation = { ...input, revision: (navigation?.revision ?? 0) + 1 } } }
    if (name === './workbench-location') return { workbenchDefaults: { assetNavigatorWidth: 200, inspectorWidth: 280, dockHeight: 200 }, readWorkbenchLocation: () => ({ value: { assetId: 'asset-A', segmentId: 'row-199', assetNavigatorOpen: true, assetNavigatorWidth: 240, inspectorWidth: 320, dockOpen: true, dock: 'qa', dockHeight: 240 } }), writeWorkbenchLocation() {} }
    if (name === './composer-context') return { publishWorkbenchComposerContext() {} }
    if (name === './Panels') return { ...Object.fromEntries(['QaPanel', 'ProposalPanel', 'ReferencePanel', 'AssetsPanel', 'DeliveryPanel', 'ProjectSettingsPanel', 'BatchExportButton', 'ProposalReviewConfirmation'].map(name => [name, name])), loadProposalReviewPlan: (...args) => load('Panels.tsx').loadProposalReviewPlan(...args) }
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

// Isolate assistance data fetching while preserving the real row/editor callbacks under test.
function SegmentTextCellsFixture(props) {
  return React.createElement(React.Fragment, null,
    React.createElement('div', { role: 'gridcell' }, props.segment.source),
    React.createElement('div', { role: 'gridcell' }, props.editing
      ? React.createElement(load('TargetEditor.tsx').TargetEditor, { ...props.editorProps, draftAtom: props.draftAtom, segment: props.segment, archived: props.archived, tagProfile: props.tagProfile, formatId: props.formatId })
      : React.createElement('button', { type: 'button', disabled: props.segment.locked || props.archived, onClick: props.onStartEdit }, props.segment.target), props.signals))
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

function mountEditor(scope, props, render = props => load('TargetEditor.tsx').TargetEditor.render(props, null), tokenHandle) {
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
  const nodes = node => typeof node !== 'object' || node === null ? [] : [node, ...(node.type === SegmentTextCellsFixture ? nodes(SegmentTextCellsFixture(node.props)) : []), ...React.Children.toArray(node.props?.children).flatMap(nodes), ...React.Children.toArray(node.props?.anchor).flatMap(nodes)]
  return {
    render(next = {}) {
      Object.assign(props, next)
      hooks = runtime
      try { for (let pass = 0; pass < 2; pass++) { cursor = 0; tree = render(props); if (tokenHandle) nodes(tree).find(node => node.type === 'TokenEditor').ref.current = tokenHandle; pending.splice(0).forEach(run => run()) } }
      finally { hooks = undefined }
      return tree
    },
    nodes: () => nodes(tree),
    input(value) { const editor = nodes(tree).find(node => node.type === 'TokenEditor').props; if (scope.store.get(props.draftAtom).state.composing) editor.onCompositionUpdate(value); else editor.onEdit(value, 'manual') },
    tokenEditor() { return nodes(tree).find(node => node.type === 'TokenEditor').props },
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
  assert.equal(editor.tokenEditor().value, 'second edit')
  editor.click('撤销译文编辑'); editor.render()
  assert.equal(editor.tokenEditor().value, 'first edit')
  editor.click('重做译文编辑'); editor.render()
  assert.equal(editor.tokenEditor().value, 'second edit')
  editor.tokenEditor().onCompositionStart(); editor.render()
  editor.input('输入法草稿'); editor.render(); editor.unmount()
  editor = fixture.mount(); editor.render({ segment: { ...fixture.props.segment, target: 'remote update', revision: 2 } })
  assert.equal(editor.tokenEditor().value, '输入法草稿')
  const restored = fixture.state.store.get(fixture.props.draftAtom)
  assert.equal(restored.state.composing, false)
  assert.equal(restored.conflict, true)
  assert.equal(restored.baseRevision, 2)
  editor.unmount()
})

test('external updates preserve IME and protected operations even when local text still equals its saved baseline', () => {
  for (const flag of ['composing', 'saving', 'conflict', 'resolvingConflict']) {
    const fixture = editorFixture(`protected-baseline-${flag}`)
    const original = fixture.state.store.get(fixture.props.draftAtom)
    const draft = flag === 'composing'
      ? { ...original, state: { ...original.state, composing: true, compositionBase: { value: original.state.value } } }
      : { ...original, [flag]: true }
    fixture.state.store.set(fixture.props.draftAtom, draft)
    const editor = fixture.mount()
    editor.render({ segment: { ...fixture.props.segment, target: 'Agent saved a new target', revision: 2 } })
    const retained = fixture.state.store.get(fixture.props.draftAtom)
    assert.equal(editor.tokenEditor().value, original.state.value, `${flag} content remains visible`)
    assert.strictEqual(retained.state, draft.state, `${flag} state and undo history remain intact`)
    assert.equal(retained.conflict, true)
    assert.equal(retained.baseRevision, 2)
    assert.equal(retained.baseTarget, 'Agent saved a new target')
    editor.unmount()
  }
})

test('saving remains read-only after remount and a failed response keeps the draft editable', async () => {
  const fixture = editorFixture('pending-save')
  let finishSave
  fixture.props.onSave = () => new Promise(resolve => { finishSave = resolve })
  let editor = fixture.mount()
  editor.render(); editor.input('awaiting save'); editor.render(); editor.click('保存译文'); editor.render()
  assert.equal(editor.tokenEditor().readOnly, true)
  editor.unmount(); editor = fixture.mount(); editor.render()
  assert.equal(editor.tokenEditor().value, 'awaiting save')
  assert.equal(editor.tokenEditor().readOnly, true)
  finishSave('failed'); await tick(); editor.render()
  assert.equal(editor.tokenEditor().value, 'awaiting save')
  assert.equal(editor.tokenEditor().readOnly, false)
  editor.unmount()
})

test('mixed all-batch rows resolve formats by each segment assetId and TargetEditor forwards format without changing draft', () => {
  const fixture = editorFixture('mixed-asset-formats')
  const segments = ['phrase', 'sdl', 'unknown'].map((assetId, ordinal) => ({ ...fixture.props.segment, id: `format-${assetId}`, assetId, ordinal }))
  const props = { data: { total: segments.length, ids: segments.map(segment => segment.id), rows: new Map(segments.map((segment, index) => [index, segment])) },
    assets: [{ assetId: 'sdl', formatId: 'sdlxliff_1_2' }, { assetId: 'phrase', formatId: 'phrase_mxliff_1_2' }],
    drafts: fixture.state.drafts, editingIdAtom: fixture.state.editingId,
    signals: new Map(), selectedIds: new Set(), reviewingIds: new Set(), workflowStage: 'translation', onVisibleRange() {}, onEditorHandleChange() {} }
  fixture.state.store.set(fixture.state.editingId, segments[0].id)
  const rows = mountEditor(fixture.state, props, props => load('CatWorkbench.tsx').testRows(props))
  rows.render()
  assert.deepEqual(rows.nodes().filter(node => node.type === SegmentTextCellsFixture).map(node => node.props.formatId), ['phrase_mxliff_1_2', 'sdlxliff_1_2', undefined])
  const editor = mountEditor(fixture.state, { ...rows.editorProps() })
  editor.render()
  const original = fixture.state.store.get(rows.editorProps().draftAtom)
  assert.equal(editor.tokenEditor().formatId, 'phrase_mxliff_1_2')
  editor.render({ formatId: 'sdlxliff_1_2' })
  assert.equal(editor.tokenEditor().formatId, 'sdlxliff_1_2')
  assert.strictEqual(fixture.state.store.get(rows.editorProps().draftAtom), original)
  editor.unmount(); rows.unmount()
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
  assert.equal(editorB.tokenEditor().value, 'keep B')
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
  const currentRow = () => rows.nodes().find(node => node.props?.role === 'row' && node.props['aria-rowindex'] === 2)
  rows.render({ selectedId: segment.id })
  assert.equal(currentRow().props['aria-selected'], true)
  assert.equal(currentRow().props['data-picked'], false, 'active editing row is not implicitly bulk-selected')
  rows.render({ selectedId: undefined, selectedIds: new Set([segment.id]) })
  assert.equal(currentRow().props['aria-selected'], false)
  assert.equal(currentRow().props['data-picked'], true, 'checkbox selection is visible independently of the active row')
  assert.equal(rows.nodes().filter(node => node.props?.role === 'gridcell').length, 4)
  rows.render({ selectedIds: new Set() })
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
  editingRow.props.onKeyDown({ key: 'ArrowUp', target: { closest: () => ({}) }, currentTarget: {}, preventDefault() { assert.fail('owned editor arrow must stay native') } })
  assert.equal(props.selectedId, 'row-19')
  focused = undefined
  rows.editorProps().onCancel(); commitRows()
  assert.equal(focused, 19, 'canceling editing returns focus from the removed chip editor')
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
  assert.equal(focusCalls, 1, 'reload must not steal focus from the same row chip editor')
  mounted.delete(2)
  rows.render({ focusIndex: 2, data: { ...props.data, rows: new Map([[0, segments[0]]]) } })
  rows.render({ selectedId: 'row-0' })
  mounted.set(2, row)
  rows.render({ data: { ...props.data, rows: new Map([[0, segments[0]], [2, segments[2]]]) } })
  assert.equal(focusCalls, 1, 'an older pending jump must not override a later selected row')
  rows.unmount()
  document.activeElement = null
})

async function workbenchFixture(id, queryPage, { filter = '', deferredQuery, movingProject = false, withGroups = false, boundGroup } = {}) {
  const state = load('cat-editor-state.ts').getCatEditorState(id, 'project-synthetic')
  const segments = Array.from({ length: 403 }, (_, ordinal) => ({ id: `row-${ordinal}`, ordinal, source: 'Synthetic source', target: 'target', revision: 1, assetId: 'asset-A', locked: ordinal >= 200 && ordinal !== 401, currentStageState: 'untouched' }))
  const project = { id: 'project-synthetic', name: 'Synthetic project', sourceLocale: 'en-US', targetLocale: 'zh-CN', workflowStage: 'translation' }
  const summary = { project, taskGroups: [{ id: 'ungrouped', name: '未分组', archived: false }], assets: [{ assetId: 'asset-A', taskGroupId: 'ungrouped', filename: 'synthetic.json', currentStageCounts: { confirmed: 0 }, segmentCount: segments.length }], assetCount: 1 }
  if (withGroups) {
    summary.taskGroups.push({ id: 'other-group', name: 'Second delivery', archived: false })
    summary.assets.push({ ...summary.assets[0], assetId: 'asset-B', taskGroupId: 'other-group' })
    segments.at(-1).assetId = 'asset-B'
  }
  const calls = []
  navigation = undefined
  apiRequired = async (operation, input) => {
    if (operation === 'linguistProjectsOpen') return { project }
    if (operation === 'linguistProjectsGetSummary') {
      if (input.taskGroupId) return { ...summary, assets: summary.assets.filter(asset => asset.taskGroupId === input.taskGroupId) }
      return movingProject ? { ...summary, project: { ...project } } : summary
    }
    if (operation === 'linguistCatRowSignals') return { items: input.segmentIds.map(segmentId => ({ segmentId, qaCount: 0 })) }
    if (operation === 'linguistCatGetContext') {
      const segment = segments[Number(input.segmentId.slice(4))]
      if (input.taskGroupId && !summary.assets.some(asset => asset.assetId === segment.assetId && asset.taskGroupId === input.taskGroupId)) throw Error('segment outside task group')
      return { segment, qaFindings: [] }
    }
    if (operation === 'linguistCatConfirmStage') { const row = segments[Number(input.segmentId.slice(4))]; row.currentStageState = 'confirmed'; return { ...row } }
    if (operation === 'linguistCatQuery') {
      const filtered = segments.filter(row => (!input.taskGroupId || summary.assets.some(asset => asset.assetId === row.assetId && asset.taskGroupId === input.taskGroupId)) && (!input.currentStageState || row.currentStageState === input.currentStageState) && (!input.assetId || row.assetId === input.assetId) && (!input.search || row.source.includes(input.search)))
      if (input.offset > 0) { calls.push(input.offset); return queryPage(input.offset, filtered) }
      const page = { segments: filtered.slice(0, 200), segmentIds: filtered.map(row => row.id), total: filtered.length }
      return deferredQuery?.(input, page) ?? page
    }
    throw new Error(`Unexpected synthetic operation: ${operation}`)
  }
  const workbench = mountEditor(state, { projectId: project.id, taskGroupId: boundGroup, sessionId: id, editorState: state }, props => load('CatWorkbench.tsx').testWorkbench(props))
  workbench.render(); await tick(); workbench.render(); await tick(); workbench.render()
  if (filter) { workbench.nodes().find(node => node.props?.['aria-label'] === '阶段筛选').props.onChange({ target: { value: filter } }); workbench.render(); await tick(); workbench.render() }
  const rows = () => workbench.nodes().find(node => node.type?.name === 'SegmentRows').props
  return { workbench, rows, segments, calls, async settle() { workbench.render(); await tick(); workbench.render(); await tick(); workbench.render() } }
}

test('project CAT filters same-named batches, navigation, rows and history together, retaining drafts across groups', async () => {
  const id = 'group-navigation'
  const fixture = await workbenchFixture(id, (offset, rows) => ({ segments: rows.slice(offset, offset + 200) }), { withGroups: true })
  const { workbench } = fixture
  const controls = label => workbench.nodes().find(node => node.props?.['aria-label'] === label)
  const entries = () => workbench.nodes().filter(node => node.type === 'BatchExportButton').map(node => node.props.asset.assetId)
  const options = () => React.Children.toArray(controls('工作批次').props.children).map(node => node.props.value)
  const scope = load('cat-editor-state.ts').getCatEditorState(id, 'project-synthetic')
  const draft = jotai.atom({ state: { value: 'pending edit' }, baseTarget: 'target' })
  scope.drafts.set('row-199', draft)
  scope.store.set(scope.editingId, 'row-199')
  try {
    assert.equal(controls('任务组').props.value, 'ungrouped')
    assert.deepEqual(options(), ['', 'asset-A'])
    assert.deepEqual(entries(), ['asset-A'])
    controls('任务组').props.onChange({ target: { value: 'other-group' } })
    await fixture.settle()
    assert.equal(controls('工作批次').props.value, '')
    assert.deepEqual(options(), ['', 'asset-B'])
    assert.deepEqual(entries(), ['asset-B'])
    assert.deepEqual([...fixture.rows().data.ids], ['row-402'])
    assert.equal(workbench.nodes().find(node => node.type === 'QaPanel').props.taskGroupId, 'other-group')
    assert.equal(workbench.nodes().find(node => node.type === 'CatStatusBar').props.taskGroupId, 'other-group')
    navigation = { projectId: 'project-synthetic', sessionId: id, segmentId: 'row-199', revision: 1 }
    await fixture.settle()
    assert.equal(controls('任务组').props.value, 'ungrouped')
    assert.equal(controls('工作批次').props.value, 'asset-A')
    assert.equal(fixture.rows().selectedId, 'row-199')
    assert.equal(scope.store.get(scope.drafts.get('row-199')).state.value, 'pending edit')
    navigation = { projectId: 'project-synthetic', sessionId: id, assetId: 'asset-B', revision: 2 }
    await fixture.settle()
    assert.equal(controls('任务组').props.value, 'other-group')
    assert.equal(controls('工作批次').props.value, 'asset-B')
  } finally { workbench.unmount() }
})

test('bound CAT stays in its group even when an old location or external link names another batch', async () => {
  const id = 'bound-group-navigation'
  const f = await workbenchFixture(id, (offset, rows) => ({ segments: rows.slice(offset, offset + 200) }), { withGroups: true, boundGroup: 'other-group' })
  try {
    assert(!f.workbench.nodes().some(n => n.props?.['aria-label'] === '任务组'))
    assert.deepEqual([...f.rows().data.ids], ['row-402'])
    navigation = { sessionId: id, projectId: 'project-synthetic', assetId: 'asset-A', revision: 1 }
    await f.settle()
    assert.deepEqual([...f.rows().data.ids], ['row-402'])
    assert.equal(f.workbench.nodes().find(n => n.props?.['aria-label'] === '工作批次').props.value, 'asset-B')
    assert(f.workbench.nodes().some(n => n.props?.role === 'status' && React.Children.toArray(n.props.children).includes('目标批次不在当前会话范围内。')))
  } finally { f.workbench.unmount() }
})

test('inspector receives only the selected editing draft, including an unmounted editor draft', async () => {
  const id = 'inspector-draft-scope', fixture = await workbenchFixture(id, (offset, rows) => ({ segments: rows.slice(offset, offset + 200) }))
  const state = load('cat-editor-state.ts').getCatEditorState(id, 'project-synthetic')
  const selected = fixture.rows().selectedId
  const draft = jotai.atom({ state: { value: 'Selected unsaved draft', past: [], future: [], composing: false }, baseRevision: 1, baseTarget: 'target' })
  state.drafts.set(selected, draft)
  state.store.set(state.editingId, selected)
  fixture.workbench.click('句段参考'); fixture.workbench.render()
  const pane = () => fixture.workbench.nodes().find(node => node.type?.name === 'ContextPanel').props
  try {
    assert.equal(pane().draftAtom, draft)
    assert.equal(pane().editorHandle, undefined, 'draft comparison is independent of a mounted apply capability')
    state.store.set(state.editingId, 'row-other')
    fixture.workbench.render()
    assert.equal(pane().draftAtom, undefined, 'a different selected row never sees the active draft')
  } finally { fixture.workbench.unmount() }
})

test('scrolling coalesces lightweight badge reads, bounds in-flight work and retains valid offscreen results', async context => {
  context.mock.timers.enable({ apis: ['setTimeout'] })
  const fixture = await workbenchFixture('scroll-badge-batches', (offset, rows) => ({ segments: rows.slice(offset, offset + 200) }))
  const ordinary = apiRequired, calls = []
  let finishFirst
  apiRequired = (operation, input) => {
    assert.notEqual(operation, 'linguistCatGetContext', 'scroll badges must not fetch full TM context')
    if (operation !== 'linguistCatRowSignals') return ordinary(operation, input)
    calls.push(input)
    if (calls.length === 1) return new Promise(resolve => { finishFirst = () => resolve({ items: input.segmentIds.map(segmentId => ({ segmentId, qaCount: 2 })) }) })
    return ordinary(operation, input)
  }
  try {
    fixture.rows().onVisibleRange(4, 24); fixture.workbench.render()
    fixture.rows().onVisibleRange(7, 27); fixture.workbench.render()
    context.mock.timers.tick(149)
    assert.equal(calls.length, 0)
    context.mock.timers.tick(1)
    assert.equal(calls.length, 1)
    assert.deepEqual(Array.from(calls[0].segmentIds), fixture.segments.slice(7, 28).map(segment => segment.id))
    fixture.rows().onVisibleRange(60, 80); fixture.workbench.render()
    context.mock.timers.tick(150)
    assert.equal(calls.length, 1, 'only one badge batch can remain in flight')
    finishFirst(); await fixture.settle()
    assert.equal(fixture.rows().signals.get('row-7').qaCount, 2, 'same-scope replies stay valid when their rows leave the viewport')
    context.mock.timers.tick(150); await fixture.settle()
    assert.equal(calls.length, 2)
    assert.ok(calls.every(call => call.segmentIds.length <= 200))
    fixture.rows().onVisibleRange(7, 27); fixture.workbench.render()
    context.mock.timers.tick(150); await fixture.settle()
    assert.equal(calls.length, 2, 'returning to loaded rows does not repeat their badge read')
  } finally { fixture.workbench.unmount() }
})

test('grid proposal review keeps failed and excluded selections and uses the shared fresh CAS plan', async () => {
  const fixture = await workbenchFixture('grid-proposal-review', (offset, rows) => ({ segments: rows.slice(offset, offset + 200) }))
  const ordinary = apiRequired, calls = []
  let refuse = true
  fixture.segments[2].locked = true
  apiRequired = async (operation, input) => {
    if (operation === 'linguistCatGetContext') {
      const segment = fixture.segments[Number(input.segmentId.slice(4))]
      return { segment, qaFindings: [], ...(segment.ordinal === 1 ? {} : { pendingProposal: { id: `proposal-${segment.ordinal}` } }) }
    }
    if (operation === 'linguistProposalsGetDiff') {
      const segment = fixture.segments[Number(input.proposalId.slice(9))]
      return { proposal: { id: input.proposalId, segmentId: segment.id, status: 'pending' }, originalOrdinal: segment.ordinal + 1, currentRevision: segment.revision, baseRevision: segment.revision, locked: segment.locked }
    }
    if (operation === 'linguistProposalsAcceptSelected') {
      calls.push(input)
      if (refuse) throw new Error('Synthetic current revision conflict')
      return []
    }
    return ordinary(operation, input)
  }
  for (const id of ['row-0', 'row-1', 'row-2']) fixture.rows().onToggleSelected(id)
  await fixture.settle()
  fixture.workbench.click('接受所选建议'); await fixture.settle()
  const confirmation = () => fixture.workbench.nodes().find(node => node.type === 'ProposalReviewConfirmation').props
  assert.equal(confirmation().plan.items.length, 1)
  assert.equal(confirmation().plan.excluded.length, 2)
  assert.equal(confirmation().plan.items[0].expectedRevision, 1)
  fixture.segments[0].revision = 2
  confirmation().onConfirm(); await fixture.settle()
  assert.equal(calls[0].items[0].expectedRevision, 1, 'confirmation does not silently replace its captured CAS snapshot')
  assert.match(confirmation().error, /revision conflict/)
  assert.deepEqual([...fixture.rows().selectedIds], ['row-0', 'row-1', 'row-2'])
  confirmation().onClose(); fixture.workbench.render()
  refuse = false
  fixture.workbench.click('接受所选建议'); await fixture.settle()
  assert.equal(confirmation().plan.items[0].expectedRevision, 2)
  confirmation().onConfirm(); await fixture.settle()
  assert.deepEqual([...fixture.rows().selectedIds], ['row-1', 'row-2'], 'only successfully reviewed items leave the selection')
  assert.equal(confirmation().plan, undefined)
  assert(fixture.workbench.nodes().some(node => node.type === 'BatchExportButton' && node.props.asset.assetId === 'asset-A'))
  fixture.workbench.unmount()
})

test('next untouched remains inside the current search and the header changes only the workflow stage', async () => {
  const fixture = await workbenchFixture('search-and-stage', (offset, rows) => ({ segments: rows.slice(offset, offset + 200) }))
  fixture.segments[2].source = 'Synthetic needle'; fixture.segments[5].source = 'Synthetic needle'
  const ordinary = apiRequired, writes = []
  apiRequired = async (operation, input) => {
    if (operation === 'linguistProjectsSetWorkflowConfig') { writes.push(input); return {} }
    if (operation === 'linguistProjectsGetSummary') { const summary = await ordinary(operation, input); return writes.length ? { ...summary, project: { ...summary.project, workflowStage: writes.at(-1).workflowStage } } : summary }
    return ordinary(operation, input)
  }
  const search = () => fixture.workbench.nodes().find(node => node.props?.['aria-label'] === '搜索源文或译文').props
  search().onChange({ target: { value: 'needle' } }); await fixture.settle()
  fixture.rows().onSelect('row-2'); fixture.workbench.render()
  fixture.workbench.click('下一待处理'); await fixture.settle()
  assert.equal(fixture.rows().selectedId, 'row-5')
  assert.equal(search().value, 'needle')
  assert.deepEqual(Array.from(fixture.rows().data.ids), ['row-2', 'row-5'])
  fixture.workbench.nodes().find(node => node.props?.['aria-label'] === '当前工作阶段').props.onChange({ target: { value: 'editing' } }); await fixture.settle()
  assert.deepEqual(JSON.parse(JSON.stringify(writes)), [{ projectId: 'project-synthetic', workflowStage: 'editing' }])
  assert.equal(fixture.rows().workflowStage, 'editing')
  assert.equal(search().value, 'needle')
  fixture.workbench.unmount()
})

test('a committed proposal review keeps success true and makes its failed overview refresh visible', async () => {
  const fixture = await workbenchFixture('proposal-overview-read-failure', (offset, rows) => ({ segments: rows.slice(offset, offset + 200) }))
  const ordinary = apiRequired
  let writes = 0, overviewReads = 0
  apiRequired = async (operation, input) => {
    if (operation === 'linguistCatGetContext') return { ...await ordinary(operation, input), ...(input.segmentId === 'row-0' ? { pendingProposal: { id: 'proposal-0' } } : {}) }
    if (operation === 'linguistProposalsGetDiff') return { proposal: { id: 'proposal-0', segmentId: 'row-0', status: 'pending' }, originalOrdinal: 1, currentRevision: 1, baseRevision: 1, locked: false }
    if (operation === 'linguistProposalsAcceptSelected') { writes++; return [] }
    if (operation === 'linguistProjectsGetSummary' && writes && overviewReads++ === 0) throw new Error('Synthetic post-commit overview read failure')
    return ordinary(operation, input)
  }
  fixture.rows().onToggleSelected('row-0'); await fixture.settle()
  fixture.workbench.click('接受所选建议'); await fixture.settle()
  fixture.workbench.nodes().find(node => node.type === 'ProposalReviewConfirmation').props.onConfirm()
  await fixture.settle()
  assert.equal(writes, 1)
  assert.equal(fixture.rows().selectedIds.size, 0, 'a committed mutation is not offered as a failed retry')
  assert.equal(fixture.workbench.nodes().find(node => node.type === 'ProposalReviewConfirmation').props.plan, undefined)
  const statuses = fixture.workbench.nodes().filter(node => node.props?.role === 'status').flatMap(node => React.Children.toArray(node.props.children)).filter(value => typeof value === 'string').join(' ')
  assert.match(statuses, /已接受 1 条建议/)
  assert.match(statuses, /Synthetic post-commit overview read failure/, 'the closed confirmation cannot be the only place holding the read failure')
  fixture.workbench.unmount()
})

test('a failed query after opening the project shows a retry while preserving editor drafts', async () => {
  let fail = false
  const fixture = await workbenchFixture('query-error-visible', (offset, rows) => ({ segments: rows.slice(offset, offset + 200) }), { deferredQuery(_input, page) { if (fail) throw new Error('Synthetic grid read failure'); return page } })
  const draft = jotai.atom({ synthetic: 'unsaved' })
  const state = load('cat-editor-state.ts').getCatEditorState('query-error-visible', 'project-synthetic')
  state.drafts.set('row-199', draft)
  fail = true; fixture.workbench.nodes().find(node => node.type === 'menu').props.onSelect('refresh'); await fixture.settle()
  assert(fixture.workbench.nodes().some(node => node.props?.role === 'alert' && React.Children.toArray(node.props.children).some(child => typeof child === 'string' && child.includes('Synthetic grid read failure'))))
  assert.equal(state.drafts.get('row-199'), draft)
  fail = false; fixture.workbench.click('重试'); await fixture.settle()
  assert(fixture.rows().data.total > 0)
  assert(!fixture.workbench.nodes().some(node => node.props?.role === 'alert'))
  assert.equal(state.drafts.get('row-199'), draft)
  fixture.workbench.unmount()
})

test('late page failures cannot replace a newer search or refreshed index with an error', async () => {
  for (const change of ['search', 'refresh']) {
    let rejectPage
    const fixture = await workbenchFixture(`late-page-error-${change}`, () => new Promise((_resolve, reject) => { rejectPage = reject }))
    fixture.rows().onVisibleRange(200, 201)
    const rejectOldPage = rejectPage
    const oldIds = fixture.rows().data.ids
    if (change === 'search') fixture.workbench.nodes().find(node => node.props?.['aria-label'] === '搜索源文或译文').props.onChange({ target: { value: 'Synthetic' } })
    else fixture.workbench.nodes().find(node => node.type === 'menu').props.onSelect('refresh')
    await fixture.settle()
    assert.notEqual(fixture.rows().data.ids, oldIds)
    rejectOldPage(new Error('Synthetic stale page failure'))
    await fixture.settle()
    assert(!fixture.workbench.nodes().some(node => node.props?.role === 'alert'), `${change} retains its newer grid`)
    assert.equal(fixture.rows().selectedId, 'row-199')
    fixture.rows().onVisibleRange(200, 201)
    rejectPage(new Error('Synthetic current page failure'))
    await fixture.settle()
    assert(fixture.workbench.nodes().some(node => node.props?.role === 'alert' && React.Children.toArray(node.props.children).some(child => typeof child === 'string' && child.includes('Synthetic current page failure'))), 'current page failures remain visible')
    fixture.workbench.unmount()
  }
})

test('the active proposal row exposes a real current/proposed diff and keeps stale acceptance disabled', () => {
  const fixture = editorFixture('inline-proposal')
  const proposal = { id: 'proposal', baseRevision: 1, proposedTarget: 'proposed', evidenceRefs: ['context:synthetic'], termRefs: ['term:synthetic'], warnings: ['Synthetic warning'] }
  const calls = []
  const inline = mountEditor(fixture.state, { segment: { ...fixture.props.segment, revision: 2 }, proposal, archived: false, busy: false, onReview: operation => calls.push(operation) }, props => load('CatWorkbench.tsx').testInline(props))
  inline.render()
  assert(inline.nodes().some(node => node.type === 'del' && node.props.children === 'original'))
  assert(inline.nodes().some(node => node.type === 'ins' && node.props.children === 'proposed'))
  assert.equal(inline.nodes().find(node => node.type === 'button' && node.props.children === '接受').props.disabled, true)
  inline.click('拒绝建议'); assert.deepEqual(calls, ['reject'])
  assert(inline.nodes().some(node => node.props?.role === 'alert'))
  inline.unmount()
})

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

test('raw selection survives remount and the editor handle exposes issue-range selection without a textarea', () => {
  const fixture = editorFixture('raw-selection-remount')
  let handle
  fixture.props.onHandleChange = value => { handle = value }
  const selected = []
  const tokenHandle = { select(start, end) { selected.push([start, end]) }, focus() {}, insert() { return true } }
  let editor = mountEditor(fixture.state, fixture.props, undefined, tokenHandle)
  editor.render()
  assert.equal(typeof handle.select, 'function')
  handle.select(2, 5)
  assert.deepEqual(selected, [[2, 5]])
  editor.tokenEditor().onSelectionChange({ start: 2, end: 5, backward: true })
  editor.unmount()
  assert.equal(handle, undefined)
  editor = fixture.mount(); editor.render()
  assert.deepEqual(fixture.state.store.get(fixture.props.draftAtom).state.selection, { start: 2, end: 5, backward: true })
  assert.equal(editor.tokenEditor().initialSelection.start, 2)
  assert.equal(editor.tokenEditor().initialSelection.end, 5)
  assert.equal(editor.nodes().some(node => node.type === 'textarea'), false)
  editor.unmount()
})

test('native formatting toolbar uses the draft transaction and undo/redo restore raw and selection together', () => {
  const fixture = editorFixture('format-transaction-history')
  const raw = 'A {name} B', before = { start: 2, end: 8, backward: true }
  fixture.props.segment = { ...fixture.props.segment, source: raw, target: raw }
  fixture.props.formatId = 'phrase_mxliff_1_2'
  fixture.state.store.set(fixture.props.draftAtom, { ...fixture.state.store.get(fixture.props.draftAtom), state: load('TargetEditor.tsx').createTargetDraftState(raw), baseTarget: raw })
  let saves = 0, editor
  const view = []
  fixture.props.onSave = async () => { saves++; return 'saved' }
  fixture.props.onFormatCodesChange = value => view.push(['codes', value])
  fixture.props.onInvisiblesChange = value => view.push(['invisibles', value])
  const tokenHandle = { toggleFormat(flag) {
    const current = fixture.state.store.get(fixture.props.draftAtom).state
    const edit = inlineTokens.togglePhraseFormat(current.value, current.selection, flag, fixture.props.formatId, inlineTokens.tokenizeInlineText(current.value))
    return edit ? editor.tokenEditor().onEdit(edit.value, 'protected', current.selection, edit.selection) : false
  } }
  editor = mountEditor(fixture.state, fixture.props, undefined, tokenHandle)
  editor.render()
  assert(editor.nodes().find(node => node.props?.['aria-label'] === '下划线').props.disabled)
  editor.tokenEditor().onSelectionChange(before); editor.render()
  editor.click('下划线'); editor.render()
  const formatted = fixture.state.store.get(fixture.props.draftAtom).state
  assert.equal(formatted.value, 'A {u>{name}<u} B')
  assert.equal(formatted.past.length, 1)
  assert.deepEqual(formatted.past[0].selection, before)
  const after = formatted.selection
  assert.equal(saves, 0)
  editor.click('格式码'); editor.click('¶'); editor.render()
  assert.deepEqual(view, [['codes', true], ['invisibles', true]])
  assert.equal(fixture.state.store.get(fixture.props.draftAtom).state, formatted)
  editor.click('撤销译文编辑'); editor.render()
  assert.equal(editor.tokenEditor().value, raw)
  assert.deepEqual(editor.tokenEditor().initialSelection, before)
  editor.click('重做译文编辑'); editor.render()
  assert.equal(editor.tokenEditor().value, formatted.value)
  assert.deepEqual(editor.tokenEditor().initialSelection, after)
  for (const name of ['下标', '上标']) assert(editor.nodes().find(node => node.props?.['aria-label'] === name).props.disabled)
  editor.render({ archived: true })
  for (const name of ['加粗', '斜体', '下划线']) assert(editor.nodes().find(node => node.props?.['aria-label'] === name).props.disabled)
  editor.render({ archived: false, formatId: 'sdlxliff_1_2' })
  for (const name of ['加粗', '斜体', '下划线']) assert(editor.nodes().find(node => node.props?.['aria-label'] === name).props.disabled)
  editor.render({ formatId: 'phrase_mxliff_1_2' })
  const beforeIme = fixture.state.store.get(fixture.props.draftAtom).state
  editor.tokenEditor().onCompositionStart(); editor.render()
  editor.tokenEditor().onCompositionUpdate(raw); editor.render()
  assert.equal(editor.tokenEditor().onCompositionEnd(raw, { start: 1, end: 1 }), beforeIme.value, 'native IME cannot silently drop hidden style codes')
  editor.render()
  assert.equal(fixture.state.store.get(fixture.props.draftAtom).state.value, beforeIme.value)
  assert.deepEqual(fixture.state.store.get(fixture.props.draftAtom).state.selection, beforeIme.selection)
  assert.equal(fixture.state.store.get(fixture.props.draftAtom).state.past.length, beforeIme.past.length)
  editor.unmount()
})

test('IME Escape preserves the live Target draft through local and platform composing signals', () => {
  const fixture = editorFixture('ime-escape-draft')
  let cancellations = 0
  fixture.props.onCancel = () => { cancellations++; fixture.state.drafts.delete(fixture.props.segment.id) }
  const editor = fixture.mount(); editor.render()
  editor.input('unsaved'); editor.render()
  editor.tokenEditor().onCompositionStart()
  editor.input('未确认的输入法草稿')
  const key = (nativeEvent = {}) => {
    const event = { key: 'Escape', metaKey: false, ctrlKey: false, shiftKey: false, nativeEvent, defaultPrevented: false, preventDefault() { this.defaultPrevented = true } }
    editor.tokenEditor().onKeyDown(event)
    return event
  }
  assert.equal(key({ isComposing: false }).defaultPrevented, false, 'the local composition ref covers native events that report false')
  assert.equal(cancellations, 0)
  assert(fixture.state.drafts.has(fixture.props.segment.id))
  assert.equal(fixture.state.store.get(fixture.props.draftAtom).state.value, '未确认的输入法草稿')
  editor.render(); editor.tokenEditor().onCompositionEnd('未确认的输入法草稿'); editor.render()
  const retained = fixture.state.store.get(fixture.props.draftAtom)
  for (const nativeEvent of [{ isComposing: true }, { isComposing: false, keyCode: 229 }]) {
    assert.equal(key(nativeEvent).defaultPrevented, false)
    assert.equal(cancellations, 0)
    assert.strictEqual(fixture.state.store.get(fixture.props.draftAtom), retained)
    assert(fixture.state.drafts.has(fixture.props.segment.id))
  }
  assert.equal(key({ isComposing: false, keyCode: 27 }).defaultPrevented, true)
  assert.equal(cancellations, 1, 'ordinary Escape still cancels after IME ends')
  assert.equal(fixture.state.drafts.has(fixture.props.segment.id), false)
  editor.unmount()
})

test('snapshot history keeps bounded raw/selection pairs and groups IME into one undo step', () => {
  const { createTargetDraftState, targetDraftReducer, TARGET_UNDO_MAX_OPERATIONS } = load('TargetEditor.tsx')
  let state = createTargetDraftState('0')
  for (let index = 1; index <= 250; index++) state = targetDraftReducer(state, { type: 'commit', value: String(index), previousSelection: { start: 0, end: 1 }, selection: { start: 1, end: 1 } })
  assert.equal(state.past.length, TARGET_UNDO_MAX_OPERATIONS)
  assert.equal(state.past.at(-1).value, '249')
  assert.equal(state.past.at(-1).selection.end, 1)
  const original = state
  state = targetDraftReducer(state, { type: 'composition-start' })
  state = targetDraftReducer(state, { type: 'composition-update', value: '组' })
  state = targetDraftReducer(state, { type: 'composition-update', value: '组合😀' })
  state = targetDraftReducer(state, { type: 'composition-end', value: '组合😀', selection: { start: 4, end: 4 } })
  assert.equal(state.past.at(-1).value, original.value)
  state = targetDraftReducer(state, { type: 'undo' })
  assert.equal(state.value, original.value)
  assert.deepEqual(state.selection, original.selection)
  state = targetDraftReducer(state, { type: 'redo' })
  assert.equal(state.value, '组合😀')
  assert.equal(state.selection.start, 4)
  let large = createTargetDraftState('x'.repeat(100_001))
  for (const suffix of ['1', '2', '3']) large = targetDraftReducer(large, { type: 'commit', value: 'x'.repeat(100_001) + suffix })
  assert([...large.past, ...large.future].reduce((sum, snapshot) => sum + snapshot.value.length, 0) <= 200_000)
})

test('project history clears the prior batch and selection while Agent references display the segment number', async () => {
  const fixture = await workbenchFixture('project-history-entry', (offset, rows) => ({ segments: rows.slice(offset, offset + 200) }))
  fixture.rows().onReferenceAgent(fixture.segments[7]); fixture.workbench.render()
  const reference = fixture.workbench.nodes().find(node => node.props?.role === 'status' && node.props.title === 'row-7')
  assert(reference, 'the reference keeps its stable ID as a tooltip')
  assert(React.Children.toArray(reference.props.children).includes('#8'), 'visible reference uses the human segment number')
  fixture.rows().onToggleSelected('row-7'); fixture.workbench.render()
  navigation = { sessionId: 'project-history-entry', projectId: 'project-synthetic', dock: 'settings', revision: 1 }
  await fixture.settle()
  fixture.workbench.nodes().find(node => node.type === 'ProjectSettingsPanel').props.onOpenHistory('qa')
  await fixture.settle()
  assert.equal(fixture.workbench.nodes().find(node => node.type === 'QaPanel').props.assetId, undefined)
  assert.equal(fixture.rows().selectedId, undefined)
  assert.equal(fixture.rows().selectedIds.size, 0)
  navigation = { sessionId: 'project-history-entry', projectId: 'project-synthetic', dock: 'proposals', revision: 2 }
  await fixture.settle()
  assert.equal(fixture.workbench.nodes().find(node => node.type === 'ProposalPanel').props.assetId, undefined)
  fixture.workbench.unmount()
})
