import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'
import * as core from '../../packages/linguist-cat-core/src/index.ts'
import * as assist from '../../packages/dsh-linguist/src/client/editor-assist.ts'
import * as inline from '../../packages/dsh-linguist/src/client/inline-tokens.ts'
import * as diff from '../../packages/dsh-linguist/src/client/editor-diff.ts'
import { editorSpelling } from '../../packages/dsh-linguist/src/host/editor-assistance.ts'

const require = createRequire(new URL('../../packages/dsh-linguist/package.json', import.meta.url))
const React = require('react'), jotai = require('jotai')
const { renderToStaticMarkup } = require('react-dom/server')
const client = new URL('../../packages/dsh-linguist/src/client/', import.meta.url)
const tick = () => new Promise(resolve => setImmediate(resolve))
const plain = value => JSON.parse(JSON.stringify(value))
const t = (key, params = {}) => key.replace(/\{(\w+)\}/g, (_, name) => String(params[name]))
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no }); return { promise, resolve, reject } }

// Same lightweight lifecycle style as the existing panel/editor fixtures. Production
// components, analyzer, scanner, token rendering and diff run unchanged; only I/O,
// timers, native primitives and hook scheduling are substituted. No visual mock DOM.
function mount(symbol, props, required = async operation => { throw Error(`Unexpected operation: ${operation}`) }) {
  const slots = [], pending = [], timers = new Map(), cache = new Map(), store = jotai.createStore()
  let cursor = 0, active = false, tree, timerId = 0
  const memo = (factory, deps) => {
    const index = cursor++
    if (!slots[index] || deps.some((value, i) => !Object.is(value, slots[index].deps[i]))) slots[index] = { value: factory(), deps }
    return slots[index].value
  }
  const hooks = {
    useState(initial) { const index = cursor++; if (!(index in slots)) slots[index] = typeof initial === 'function' ? initial() : initial; return [slots[index], value => { slots[index] = typeof value === 'function' ? value(slots[index]) : value }] },
    useRef: initial => memo(() => ({ current: initial }), []), useMemo: memo,
    useCallback: (callback, deps) => memo(() => callback, deps),
    useEffect(run, deps) { const index = cursor++; if (!slots[index] || deps.some((value, i) => !Object.is(value, slots[index].deps[i]))) pending.push(() => { slots[index]?.cleanup?.(); slots[index] = { deps, cleanup: run() } }) },
  }
  class ElementFixture { constructor(id) { this.dataset = { assistId: id } } closest() { return this } }
  const storage = new Map(), events = new EventTarget()
  function load(file) {
    if (cache.has(file)) return cache.get(file)
    const exports = {}
    cache.set(file, exports)
    const code = ts.transpileModule(readFileSync(new URL(file, client), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.React, target: ts.ScriptTarget.ES2022 } }).outputText
    runInNewContext(code + (file === 'EditorAssistance.tsx' ? '\nexports.SourceText = SourceText; exports.ActiveSegmentAssistance = ActiveSegmentAssistance; exports.Concordance = Concordance; exports.TermsProbe = props => useEditorTerms(props.projectId, props.segments, props.mutation);' : ''), {
      exports, Element: ElementFixture,
      setTimeout(callback) { const id = ++timerId; timers.set(id, callback); return id }, clearTimeout: id => timers.delete(id),
      localStorage: { getItem: key => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value) },
      Event, window: { getSelection: () => null, addEventListener: (...args) => events.addEventListener(...args), removeEventListener: (...args) => events.removeEventListener(...args), dispatchEvent: (...args) => events.dispatchEvent(...args) },
      require: name => {
        if (name === 'react') return { ...React, ...Object.fromEntries(Object.keys(hooks).map(name => [name, (...args) => active ? hooks[name](...args) : React[name](...args)])) }
        if (name === 'jotai') return { ...jotai, useAtomValue: atom => store.get(atom) }
        if (name === '@linguist/cat-core') return core
        if (name === '@deepseek-ai/dsh-client-ui-primitives') return { Button: 'button', Input: 'input', Checkbox: 'checkbox', Tooltip: ({ label, children }) => React.createElement('span', { 'data-tooltip': label }, children) }
        if (name === './editor-assist') return assist
        if (name === './inline-tokens') return inline
        if (name === './editor-diff') return diff
        if (name === './api') return { required }
        if (name === './ui-locale') return { useT: () => t }
        if (name === './PreviewView') return { PreviewView: 'PreviewView' }
        if (name === './TokenEditor') return { TokenEditor: 'TokenEditor' }
        if (name.endsWith('.module.css')) return { default: {} }
        if (name.startsWith('./')) return load(name.slice(2) + (['./InlineTaggedText', './TargetEditor', './RelatedSegments'].includes(name) ? '.tsx' : '.ts'))
        throw Error(`Unexpected fixture import: ${name}`)
      },
    })
    return exports
  }
  const exports = load(symbol === 'RelatedSegments' ? 'RelatedSegments.tsx' : 'EditorAssistance.tsx')
  const children = node => React.Children.toArray(node?.props?.children)
  const nodes = node => typeof node !== 'object' || node === null ? [] : [node, ...children(node).flatMap(nodes)]
  const text = node => typeof node !== 'object' || node === null ? (node == null || typeof node === 'boolean' ? '' : String(node)) : children(node).map(text).join('')
  return {
    store, load, Element: ElementFixture, notifySettings: () => events.dispatchEvent(new Event('linguist:review-settings')),
    render(next = {}) { Object.assign(props, next); active = true; try { for (let pass = 0; pass < 2; pass++) { cursor = 0; tree = exports[symbol](props); pending.splice(0).forEach(run => run()) } } finally { active = false } return tree },
    nodes: () => nodes(tree), text: () => text(tree),
    find(predicate) { const found = nodes(tree).find(predicate); assert(found, 'Missing expected rendered node'); return found },
    button(label) { return this.find(node => node.type === 'button' && text(node) === label).props },
    click(label) { const button = this.button(label); assert(!button.disabled, `${label} is disabled`); return button.onClick?.() },
    input(label) { return this.find(node => node.type === 'input' && node.props['aria-label'] === label).props },
    submit() { return this.find(node => node.type === 'form').props.onSubmit({ preventDefault() {} }) },
    flushTimers() { const work = [...timers.values()]; timers.clear(); work.forEach(run => run()) },
    html(component, componentProps) { return renderToStaticMarkup(React.createElement(exports[component], componentProps)) },
    dispose() { slots.forEach(slot => slot?.cleanup?.()); timers.clear() },
  }
}

const segment = { id: 'seg-synthetic', assetId: 'asset-A', ordinal: 0, source: '🦉获得药水 10，药水', target: 'Potion 10', sourceHash: 'synthetic-source', sourceLocale: 'zh-CN', targetLocale: 'en-US', revision: 3, locked: false, context: {} }
const match = { id: 'term-host', term: '药水', translation: 'Potion', status: 'required', caseSensitive: false, matchType: 'contains', conflict: false, start: 4, end: 6, lowDiscrimination: false, note: 'Host scoped terminology note' }
const views = { invisibles: false, terms: true, critical: true, spelling: true, differences: false, context: false }
const spelling = (issues = [], dictionary = []) => ({ locale: 'en-US', supported: true, issues, dictionary })
const detailsApi = async (operation, input) => {
  if (operation === 'linguistCatEditorDetails') return { segment: { ...segment, id: input.segmentId }, previous: [], next: [], revisions: [], totalRevisions: 0 }
  if (operation === 'linguistAssetsQuery') return { items: [], hasMore: false }
  throw Error(`Unexpected operation: ${operation}`)
}
function cellsProps() {
  const draft = { state: { value: 'Potion 10', past: ['saved'], future: [], composing: false }, baseTarget: 'saved', baseRevision: 3, saving: false, conflict: false, resolvingConflict: false }
  return { projectId: 'project-A', mutation: 0, segment: { ...segment }, selected: true, editing: true, draftAtom: jotai.atom(draft), options: { ...views }, termMatches: [match], archived: false, sourceClassName: '', targetClassName: '', targetButtonClassName: '', signals: null,
    editorProps: { index: 0, confirmLabel: '确认', onSave() { assert.fail('Assistance must never save') }, onSaved() { assert.fail('Assistance must never confirm') }, onCancel() {}, onReload: async () => segment }, onStartEdit() {}, onNavigate() {} }
}
function activeProps(changes = {}) {
  return { projectId: 'project-A', mutation: 0, segment, target: segment.target, baseTarget: segment.target, options: { ...views }, termMatches: [match], selectedText: '', onSelectedText() {}, spelling: spelling(), spellingError: '', onDictionaryChanged() {}, archived: false, onNavigate() {}, onLocate() {}, ...changes }
}
const concordanceResult = label => ({ segments: [{ segment: { ...segment, id: `result-${label}`, source: label }, assetLabel: label }], segmentTotal: 1, tm: [], tmTotal: 0, limit: 10, offset: 0 })

test('related CAT segments coalesce rapid selection, discard stale results and refresh after settings changes', async () => {
  const calls = [], navigation = []
  const panel = mount('RelatedSegments', { projectId: 'synthetic', segmentId: 'first', mutation: 0, onNavigate: id => navigation.push(id) }, (operation, input) => {
    assert.equal(operation, 'linguistCatRelated')
    const reply = deferred(); calls.push({ input, reply }); return reply.promise
  })
  panel.render(); panel.render({ segmentId: 'second' }); panel.flushTimers()
  assert.equal(calls.length, 1)
  assert.equal(calls[0].input.segmentId, 'second')
  panel.render({ segmentId: 'third' }); panel.flushTimers()
  calls[1].reply.resolve({ status: 'ready', scope: 55, segments: [{ id: 'linked', ordinal: 54, source: 'Similar source', target: 'Current saved target' }] })
  await tick(); panel.render()
  assert.match(panel.text(), /Current saved target/)
  calls[0].reply.resolve({ status: 'ready', scope: 55, segments: [{ id: 'old', ordinal: 1, source: 'Stale', target: 'Old target' }] })
  await tick(); panel.render()
  assert.doesNotMatch(panel.text(), /Old target/)
  panel.click('定位句段'); assert.deepEqual(navigation, ['linked'])
  panel.notifySettings(); panel.render(); panel.flushTimers()
  calls[2].reply.resolve({ status: 'disabled', segments: [] }); await tick(); panel.render()
  assert.match(panel.text(), /已在 LA 设置中关闭/)
  panel.render({ segmentId: 'fourth' }); panel.dispose(); panel.flushTimers()
  assert.equal(calls.length, 3)
})

test('SourceText popup uses supplied actual Host occurrence, status and note, without re-matching another occurrence', () => {
  const harness = mount('SourceText', { segment, target: 'Potion 10', matches: [match], options: views, onTagFocus() {}, annotations: [] })
  const html = harness.html('SourceText', { segment, target: 'Potion 10', matches: [match], options: views, onTagFocus() {}, annotations: [] })
  assert.match(html, /药水 → Potion/)
  assert.match(html, /Host scoped terminology note/)
  assert.equal((html.match(/data-assist-id="term:term-host:4"/g) ?? []).length, 1)
  assert.equal((html.match(/data-tooltip=/g) ?? []).length, 1, 'unmatched second source occurrence has no invented popup')
  assert(!harness.html('SourceText', { segment, target: 'Potion 10', matches: [match], options: { ...views, terms: false }, onTagFocus() {}, annotations: [] }).includes('data-tooltip='))
  harness.dispose()
})

test('actual terminology hook requests bounded Host matches and ignores stale project/source replies', async () => {
  const calls = []
  const probe = mount('TermsProbe', { projectId: 'project-A', segments: [segment], mutation: 0 }, (operation, input) => { const reply = deferred(); calls.push({ operation, input, reply }); return reply.promise })
  assert.equal(probe.render().items.size, 0)
  assert.equal(calls.length, 0, 'scroll-driven lookup waits until the window settles')
  probe.flushTimers()
  assert.equal(calls[0].operation, 'linguistCatEditorTerms')
  assert.deepEqual(plain(calls[0].input), { projectId: 'project-A', segmentIds: [segment.id] })
  calls[0].reply.resolve({ items: [{ segmentId: segment.id, sourceHash: segment.sourceHash, revision: segment.revision, termMatches: [match], truncated: false }] })
  await tick()
  assert.equal(probe.render().items.get(segment.id).termMatches[0].id, match.id)
  assert.equal(probe.render({ projectId: 'project-B' }).items.size, 0)
  probe.render({ segments: [{ ...segment, sourceHash: 'new-source' }] })
  probe.flushTimers()
  calls[1].reply.resolve({ items: [{ segmentId: segment.id, sourceHash: 'old-source', termMatches: [match] }] })
  await tick()
  assert.equal(probe.render().items.size, 0, 'old project/source data must not create popup matches')
  probe.dispose()
})

test('rapid viewport changes coalesce terminology requests and retain only same-source overlapping hints', async () => {
  const calls = [], next = { ...segment, id: 'seg-next', sourceHash: 'next-source' }
  const probe = mount('TermsProbe', { projectId: 'project-A', segments: [segment], mutation: 0 }, (operation, input) => { const reply = deferred(); calls.push({ input, reply }); return reply.promise })
  probe.render()
  probe.render({ segments: [segment, next] })
  probe.render({ segments: [next] })
  assert.equal(calls.length, 0)
  probe.flushTimers()
  assert.deepEqual(plain(calls[0].input.segmentIds), [next.id])
  calls[0].reply.resolve({ items: [{ segmentId: next.id, sourceHash: next.sourceHash, revision: 1, termMatches: [match], truncated: false }] })
  await tick()
  assert.equal(probe.render().items.size, 1)
  assert.equal(probe.render({ segments: [next, segment] }).items.size, 1, 'overlapping unchanged source retains its hint while the window settles')
  probe.render({ mutation: 1 })
  assert.equal(probe.render().items.size, 0, 'project mutations invalidate overlap data')
  probe.dispose()
  probe.flushTimers()
  assert.equal(calls.length, 1, 'disposal cancels the queued read')
})

test('SegmentTextCells view toggles and numeric/term hover links do not alter draft, history or save state', () => {
  const props = cellsProps(), requests = []
  const cells = mount('SegmentTextCells', props, async (operation, input) => { requests.push({ operation, input }); return spelling() })
  cells.render()
  const original = cells.store.get(props.draftAtom)
  const source = () => cells.find(node => node.type?.name === 'SourceText')
  const editor = () => cells.find(node => node.type === cells.load('TargetEditor.tsx').TargetEditor)
  const number = source().props.annotations.find(item => item.kind === 'number')
  assert(number)
  assert.equal(segment.source.slice(number.start, number.end), '10')
  assert(editor().props.annotations.some(item => item.kind === 'number' && item.id === number.id))
  assert(editor().props.annotations.some(item => item.kind === 'term' && item.start === 0 && item.end === 6))
  cells.find(node => node.props?.['data-label'] === '源文').props.onMouseOver({ target: new cells.Element(number.id) })
  cells.render()
  assert(editor().props.annotations.some(item => item.id === number.id && item.active))
  const selected = []
  editor().props.onHandleChange({ select: (...range) => selected.push(range), insert() { assert.fail('Locating a hint must not edit') } })
  cells.render()
  cells.find(node => node.type?.name === 'ActiveSegmentAssistance').props.onLocate('target', 7, 9)
  assert.deepEqual(selected, [[7, 9]])
  for (const key of Object.keys(views)) { cells.render({ options: { ...views, [key]: !views[key] } }); assert.strictEqual(cells.store.get(props.draftAtom), original) }
  assert.equal(requests.length, 0, 'debounced spelling does not fire simply by changing display controls')
  cells.dispose()
})

test('unmodified cached rows display and analyze new saved targets while protected drafts remain intact', async () => {
  const props = cellsProps(), requests = []
  props.editing = false
  const cells = mount('SegmentTextCells', props, async (operation, input) => { requests.push({ operation, input }); return spelling() })
  const pristine = { state: { value: segment.target, past: [], future: [], composing: false }, baseTarget: segment.target, baseRevision: segment.revision, saving: false, conflict: false, resolvingConflict: false }
  cells.store.set(props.draftAtom, pristine)
  const assistance = () => cells.find(node => node.type?.name === 'ActiveSegmentAssistance').props
  const displayed = () => cells.find(node => node.type === 'button' && node.props.className === props.targetButtonClassName).props.children.props.text
  cells.render()
  assert.equal(displayed(), segment.target)
  const saved = { ...segment, target: 'Updated potion 20', revision: segment.revision + 1 }
  cells.render({ segment: saved, mutation: 1 })
  assert.equal(displayed(), saved.target)
  assert.equal(assistance().target, saved.target)
  assert.equal(assistance().baseTarget, saved.target, 'saved comparison must not use the stale cached baseline')
  cells.flushTimers(); await tick()
  assert.equal(requests.at(-1).input.text, saved.target, 'spelling checks the displayed current target')
  assert.strictEqual(cells.store.get(props.draftAtom), pristine, 'display refresh does not rewrite undo history or cached state')
  for (const patch of [
    { state: { ...pristine.state, value: 'Unsaved potion 30' } },
    { state: { ...pristine.state, composing: true, compositionBase: pristine.state.value } },
    { saving: true }, { conflict: true }, { resolvingConflict: true },
  ]) {
    const protectedDraft = { ...pristine, ...patch }
    cells.store.set(props.draftAtom, protectedDraft)
    cells.render()
    assert.equal(displayed(), protectedDraft.state.value)
    assert.equal(assistance().target, protectedDraft.state.value)
    assert.equal(assistance().baseTarget, protectedDraft.baseTarget)
    assert.strictEqual(cells.store.get(props.draftAtom), protectedDraft)
  }
  cells.dispose()
})

test('late spelling replies cannot replace hints for a newer draft or another project', async () => {
  const props = cellsProps(), calls = []
  const cells = mount('SegmentTextCells', props, (operation, input) => { const reply = deferred(); calls.push({ operation, input, reply }); return reply.promise })
  cells.render(); cells.flushTimers()
  assert.equal(calls.length, 1)
  const draft = cells.store.get(props.draftAtom)
  cells.store.set(props.draftAtom, { ...draft, state: { ...draft.state, value: 'Fresh draft' } })
  cells.render(); cells.flushTimers()
  assert.equal(calls.length, 2)
  calls[1].reply.resolve(spelling([{ word: 'Fresh', start: 0, end: 5, suggestions: [] }]))
  await tick(); cells.render()
  const annotations = () => cells.find(node => node.type === cells.load('TargetEditor.tsx').TargetEditor).props.annotations
  assert(annotations().some(item => item.title?.includes('Fresh')))
  calls[0].reply.resolve(spelling([{ word: 'Stale', start: 0, end: 5, suggestions: [] }]))
  await tick(); cells.render()
  assert(!annotations().some(item => item.title?.includes('Stale')))
  cells.render({ projectId: 'project-B' })
  assert(!annotations().some(item => item.kind === 'spelling'), 'another project never receives the previous dictionary result')
  assert.equal(cells.store.get(props.draftAtom).state.value, 'Fresh draft')
  cells.dispose()
})

test('concordance requests only on submit, captures explicit batch scope, cancels stale replies and only navigates on click', async () => {
  const calls = [], navigated = []
  const panel = mount('Concordance', { projectId: 'project-A', assetId: 'asset-A', selectedText: 'Potion', onSelectedText() {}, onNavigate: id => navigated.push(id), showInvisibles: false }, (operation, input) => { const reply = deferred(); calls.push({ operation, input, reply }); return reply.promise })
  panel.render()
  assert.equal(calls.length, 0)
  panel.input('用例检索词').onChange({ target: { value: ' Hero ' } }); panel.render()
  assert.equal(calls.length, 0)
  panel.submit(); panel.render()
  assert.deepEqual(plain(calls[0].input), { projectId: 'project-A', query: 'Hero', offset: 0, limit: 10 })
  panel.find(node => node.type === 'checkbox').props.onChange(true); panel.render()
  assert.equal(calls.length, 1, 'changing scope is not permission to send a new query')
  calls[0].reply.resolve(concordanceResult('stale-project-result')); await tick(); panel.render()
  assert(!panel.text().includes('stale-project-result'))
  panel.submit(); panel.render()
  assert.equal(calls[1].input.assetId, 'asset-A')
  calls[1].reply.resolve(concordanceResult('fresh-batch-result')); await tick(); panel.render()
  assert(panel.text().includes('fresh-batch-result'))
  assert(panel.text().includes('Hero'))
  assert.equal(navigated.length, 0)
  panel.click('定位句段')
  assert.deepEqual(navigated, ['result-fresh-batch-result'])
  assert(calls.every(item => item.operation === 'linguistCatConcordance'))
  panel.dispose()
})

test('concordance changing project or asset clears old-scope data and requires a fresh explicit request', async () => {
  const calls = []
  const panel = mount('Concordance', { projectId: 'project-A', assetId: 'asset-A', selectedText: 'Potion', onSelectedText() {}, onNavigate() {}, showInvisibles: false }, async (operation, input) => { calls.push({ operation, input }); return concordanceResult('old-scope-result') })
  panel.render(); panel.submit(); panel.render(); await tick(); panel.render()
  assert(panel.text().includes('old-scope-result'))
  const count = calls.length
  panel.render({ projectId: 'project-B', assetId: 'asset-B' })
  assert(!panel.text().includes('old-scope-result'), 'old project examples must disappear synchronously')
  assert.equal(calls.length, count, 'scope change must not reissue an old explicit request')
  panel.dispose()
})

test('dictionary write failure retains input and successful older writes do not clear a newer word', async () => {
  let pending, changed = 0
  const calls = []
  const panel = mount('ActiveSegmentAssistance', activeProps({ onDictionaryChanged: () => changed++ }), (operation, input) => {
    calls.push({ operation, input })
    if (operation === 'linguistCatSetSpellingWord') { pending = deferred(); return pending.promise }
    return detailsApi(operation, input)
  })
  panel.render(); await tick(); panel.render(); panel.click('项目词典'); panel.render()
  panel.input('项目词典新词').onChange({ target: { value: 'Thiss' } }); panel.render(); panel.submit()
  assert.equal(calls.at(-1).input.projectId, 'project-A')
  assert.equal(calls.at(-1).input.locale, 'en-US')
  pending.reject(Error('Synthetic dictionary write failure')); await tick(); panel.render()
  assert.equal(panel.input('项目词典新词').value, 'Thiss')
  assert.match(panel.text(), /Synthetic dictionary write failure/)
  assert.equal(changed, 0)
  panel.submit()
  panel.input('项目词典新词').onChange({ target: { value: 'Newword' } }); panel.render()
  pending.resolve({ dictionary: ['Thiss'] }); await tick(); panel.render()
  assert.equal(panel.input('项目词典新词').value, 'Newword', 'an older success must not erase newly typed input')
  assert.equal(changed, 1)
  assert(!calls.some(item => /Save|Confirm|Apply|EditSegment/.test(item.operation)))
  panel.dispose()
})

test('actual offline Host spelling keeps custom words project-scoped and respects locale-gated project tags', async () => {
  const projects = { A: { spellingDictionary: { 'en-US': ['Thiss'] } }, B: {} }
  const service = { getProject: id => projects[id] }
  assert.equal((await editorSpelling(service, 'A', 'en-US', 'Thiss')).issues.length, 0)
  assert((await editorSpelling(service, 'B', 'en-US', 'Thiss')).issues.some(item => item.word === 'Thiss'))
  projects.B.tagProfile = { families: [{ id: 'fr-only', pattern: '\\[FR:[^\\]]+\\]', class: 'singleton', targetLocales: ['fr'] }] }
  assert((await editorSpelling(service, 'B', 'en-US', '[FR:Thiss]')).issues.some(item => item.word === 'Thiss'), 'a French-only family must not hide visible English words')
})
