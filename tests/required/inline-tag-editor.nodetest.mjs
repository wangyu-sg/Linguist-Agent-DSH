import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'
import * as tokens from '../../packages/dsh-linguist/src/client/inline-tokens.ts'
import * as tagCore from '../../packages/linguist-cat-core/src/tag-families.ts'

const require = createRequire(new URL('../../packages/dsh-linguist/package.json', import.meta.url))
const code = ts.transpileModule(readFileSync(new URL('../../packages/dsh-linguist/src/client/TokenEditor.tsx', import.meta.url), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.React, target: ts.ScriptTarget.ES2022 },
}).outputText
const exports = {}
let hooks
const React = require('react')
const { renderToStaticMarkup } = require('react-dom/server')
const inlineExports = {}
const inlineCode = ts.transpileModule(readFileSync(new URL('../../packages/dsh-linguist/src/client/InlineTaggedText.tsx', import.meta.url), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.React, target: ts.ScriptTarget.ES2022 },
}).outputText
runInNewContext(inlineCode, { exports: inlineExports, require: name => name === 'react' ? React : name === './inline-tokens' ? tokens : { default: {} } })
const hookedReact = { ...React, ...Object.fromEntries(['useRef', 'useLayoutEffect', 'useImperativeHandle'].map(name => [name, (...args) => hooks ? hooks[name](...args) : React[name](...args)])) }
runInNewContext(code, { exports, Intl, require: name => name === 'react' ? hookedReact : name === './inline-tokens' ? tokens : { default: {} } })
const { renderTokenEditorDom } = exports
const targetExports = {}
const targetCode = ts.transpileModule(readFileSync(new URL('../../packages/dsh-linguist/src/client/TargetEditor.tsx', import.meta.url), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.React, target: ts.ScriptTarget.ES2022 },
}).outputText
runInNewContext(targetCode, { exports: targetExports, require: name => name === 'react' ? React : name === '@linguist/cat-core' ? tagCore : name === './inline-tokens' ? tokens : {} })

// Structural DOM fixture only: exercise the production safe builder and mapping, not layout/rendering.
class DomNode {
  constructor(nodeType, ownerDocument, tagName, nodeValue = null) {
    Object.assign(this, { nodeType, ownerDocument, tagName, nodeValue, childNodes: [], parentNode: null, attributes: new Map(), dataset: {} })
  }
  get nextSibling() { return this.parentNode?.childNodes[this.parentNode.childNodes.indexOf(this) + 1] ?? null }
  get textContent() { return this.nodeType === 3 ? this.nodeValue : this.childNodes.map(child => child.textContent).join('') }
  set innerHTML(_) { assert.fail('Production renderer must never parse untrusted HTML') }
  appendChild(node) {
    if (node.nodeType === 11) { for (const child of [...node.childNodes]) this.appendChild(child); node.childNodes = []; return node }
    if (node.parentNode) node.parentNode.childNodes.splice(node.parentNode.childNodes.indexOf(node), 1)
    node.parentNode = this; this.childNodes.push(node); return node
  }
  replaceChildren(...children) {
    this.replacements = (this.replacements ?? 0) + 1
    // DOM live Range endpoints inside removed children relocate to their parent.
    const selection = this.ownerDocument.getSelection()
    for (const endpoint of ['anchor', 'focus']) if (this.contains(selection[`${endpoint}Node`])) { selection[`${endpoint}Node`] = this; selection[`${endpoint}Offset`] = 0 }
    this.childNodes.forEach(child => { child.parentNode = null }); this.childNodes = []; children.forEach(child => this.appendChild(child))
  }
  contains(node) { return node === this || this.childNodes.some(child => child.contains(node)) }
  focus() { this.ownerDocument.activeElement = this }
  addEventListener(type, callback) { (this.listeners ??= new Map()).set(type, callback) }
  removeEventListener(type) { this.listeners?.delete(type) }
  querySelectorAll(selector) { return descendants(this).filter(node => node !== this && node.hasAttribute(selector.slice(1, -1))) }
  setAttribute(name, value) { this.attributes.set(name, value) }
  getAttribute(name) {
    if (name.startsWith('data-')) return this.dataset[name.slice(5).replace(/-([a-z])/g, (_, value) => value.toUpperCase())] ?? null
    return this.attributes.get(name) ?? null
  }
  hasAttribute(name) { return this.getAttribute(name) !== null }
}
function dom() {
  const document = {
    createElement: tag => new DomNode(1, document, tag.toUpperCase()),
    createTextNode: text => new DomNode(3, document, undefined, text),
    createDocumentFragment: () => new DomNode(11, document),
    activeElement: null, selectionWrites: 0,
    listeners: new Map(),
    addEventListener(type, callback) { this.listeners.set(type, callback) },
    removeEventListener(type) { this.listeners.delete(type) },
    getSelection() { return this.selection },
  }
  document.selection = { anchorNode: null, focusNode: null, anchorOffset: 0, focusOffset: 0,
    setBaseAndExtent(anchorNode, anchorOffset, focusNode, focusOffset) { Object.assign(this, { anchorNode, anchorOffset, focusNode, focusOffset }); document.selectionWrites++ },
  }
  return { document, root: document.createElement('div') }
}
const tags = value => value.filter(token => token.kind === 'tag')
const descendants = root => [root, ...root.childNodes.flatMap(descendants)]

test('raw offsets and source identities survive nested repeated closes and target pair reordering', () => {
  const source = '😀<color=red><color=blue>x</color>y</color> {name} {name}'
  const target = '<color=blue>蓝</color><color=red>红</color> {name} {name}😀'
  const original = tags(tokens.tokenizeInlineText(source))
  assert.deepEqual(original.map(tag => [tag.key, tag.tagKind]), [['tag:1', 'open'], ['tag:2', 'open'], ['tag:2', 'close'], ['tag:1', 'close'], ['tag:3', 'singleton'], ['tag:4', 'singleton']])
  const translated = tags(tokens.tokenizeInlineText(target, { sourceText: source }))
  assert.deepEqual(translated.map(tag => tag.key), ['tag:2', 'tag:2', 'tag:1', 'tag:1', 'tag:3', 'tag:4'])
  assert.equal(original[0].start, 2, 'offsets count UTF-16 code units, not code points')
  for (const token of tokens.tokenizeInlineText(target, { sourceText: source })) assert.equal(target.slice(token.start, token.end), token.raw)
  assert.equal(tokens.tokenizeInlineText(target).map(token => token.raw).join(''), target)
})

test('project opening/closing families use explicit pair groups and a stack for identical closers', () => {
  const profile = { families: [
    { id: 'open', class: 'paired', kind: 'opening', pairWith: 'game', pattern: '\\[OPEN:[ab]\\]' },
    { id: 'close', class: 'paired', kind: 'closing', pairWith: 'game', pattern: '\\[END\\]' },
  ], candidates: [] }
  const source = '[OPEN:a][OPEN:b]x[END][END]'
  const mapped = tags(tokens.tokenizeInlineText('[OPEN:b]b[END][OPEN:a]a[END]', { sourceText: source, tagProfile: profile }))
  assert.deepEqual(mapped.map(tag => tag.key), ['tag:2', 'tag:2', 'tag:1', 'tag:1'])
  const extra = tags(tokens.tokenizeInlineText('[OPEN:a][OPEN:c]{new}', { sourceText: source, tagProfile: profile }))
  assert.equal(extra[0].key, 'tag:1')
  assert.equal(extra.at(-1).key, 'target-tag:1')
})

test('locale-scoped project families activate consistently for chip identities and the safe editor builder', () => {
  const tagProfile = { families: [{ id: 'ja-only', class: 'singleton', pattern: '\\[JA:[^\\]]+\\]', targetLocales: ['ja'] }], candidates: [] }
  const raw = '[JA:name]'
  assert.equal(tags(tokens.tokenizeInlineText(raw, { tagProfile, targetLocale: 'en-US' })).length, 0)
  assert.equal(tags(tokens.tokenizeInlineText(raw, { tagProfile, targetLocale: 'ja-JP' })).length, 1)
  const { root } = dom()
  renderTokenEditorDom(root, raw, { sourceText: raw, tagProfile, lang: 'en-US' })
  assert.equal(descendants(root).filter(node => node.dataset.inlineRaw).length, 0)
  assert.equal(tokens.readInlineDomText(root), raw)
  assert.equal(targetExports.targetProtectionViolations({ source: raw, targetLocale: 'en-US' }, '', tagProfile).length, 0)
  assert.equal(targetExports.targetProtectionViolations({ source: raw, targetLocale: 'ja-JP' }, '', tagProfile).length, 1)
})

test('read-only source and target chips display complete original tag code and share pair identities', () => {
  const source = '<g id="11" data-name="合成 &amp; Label"><g id="7">合成标签</g></g>'
  const target = '<g id="11" data-name="合成 &amp; Label"><g id="7">Synthetic label</g></g>'
  const escape = text => text.replace(/[&<>"']/g, value => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#x27;' })[value])
  for (const text of [source, target]) {
    const html = renderToStaticMarkup(React.createElement(inlineExports.InlineTaggedText, { text, sourceText: source }))
    for (const tag of tags(tokens.tokenizeInlineText(text, { sourceText: source }))) assert.ok(html.includes(`>${escape(tag.raw)}</span>`), `Visible complete code: ${tag.raw}`)
    assert.equal((html.match(/data-inline-tag-key="tag:1"/g) ?? []).length, 2)
    assert.equal((html.match(/data-inline-tag-key="tag:2"/g) ?? []).length, 2)
  }
  const css = readFileSync(new URL('../../packages/dsh-linguist/src/client/InlineTaggedText.module.css', import.meta.url), 'utf8')
  const chip = css.match(/\.chip\s*\{([^}]+)\}/)[1]
  assert.match(chip, /white-space:\s*pre-wrap/)
  assert.match(chip, /overflow-wrap:\s*anywhere/)
  assert.doesNotMatch(chip, /text-overflow:\s*ellipsis|overflow:\s*hidden/)
})

test('safe DOM builder displays full atomic tag code and preserves all whitespace, entities and Unicode exactly', () => {
  const { root } = dom()
  const raw = '  A\t😀\r\n\u00a0\u200b\u200d\ufeff &amp; <img src="x" onerror="alert(1)"/> {name}\n'
  renderTokenEditorDom(root, raw, { sourceText: raw, showInvisibles: true })
  assert.equal(tokens.readInlineDomText(root), raw)
  const chips = descendants(root).filter(node => node.hasAttribute('data-inline-raw'))
  assert.equal(chips.length, 2)
  assert(chips.every(chip => chip.contentEditable === 'false' && chip.title === chip.dataset.inlineRaw))
  assert(chips.every(chip => chip.textContent === chip.dataset.inlineRaw))
  assert(!descendants(root).some(node => node.tagName === 'IMG' || node.tagName === 'SCRIPT'))
  assert(descendants(root).some(node => node.dataset.invisibleGlyph === 'ZWSP'))
  assert.equal(tokens.readInlineDomText(root).includes('ZWSP'), false)
  assert.equal(descendants(root).at(-1).dataset.inlineTail, 'true')
})

test('raw/DOM endpoints round-trip at every legal UTF-16 caret position, including adjacent chips', () => {
  const { root } = dom()
  const raw = '😀<b>{name}</b>\t X\n\u00a0\u200b'
  const parsed = tokens.tokenizeInlineText(raw)
  renderTokenEditorDom(root, raw, { sourceText: raw, showInvisibles: true })
  for (let offset = 0; offset <= raw.length; offset++) {
    const normalized = tokens.snapInlineSelection(raw, offset, offset, parsed).start
    const point = tokens.inlineOffsetToDomPoint(root, normalized)
    assert.equal(tokens.inlineDomPointToOffset(root, point.node, point.offset), normalized, `caret ${offset}`)
  }
  const chip = descendants(root).find(node => node.dataset.inlineRaw === '{name}')
  assert.equal(tokens.inlineDomPointToOffset(root, chip.childNodes[0], 1), raw.indexOf('{name}') + '{name}'.length)
  const labelRange = tokens.inlineDomSelection(root, { anchorNode: chip.childNodes[0], anchorOffset: 0, focusNode: chip.childNodes[0], focusOffset: 1 })
  assert.equal(raw.slice(labelRange.start, labelRange.end), '{name}')
})

test('selection snapping expands whole chips and never leaves a caret between surrogate halves', () => {
  const raw = '😀<b>x</b>'
  const parsed = tokens.tokenizeInlineText(raw)
  assert.deepEqual(tokens.snapInlineSelection(raw, 1, 1, parsed), { start: 0, end: 0 })
  assert.deepEqual(tokens.snapInlineSelection(raw, 1, 4, parsed), { start: 0, end: 5 })
  assert.deepEqual(tokens.snapInlineSelection(raw, 3, 9, parsed), { start: 2, end: 10 })
})

test('annotation and invisible wrappers remain editable text and cannot change raw DOM offsets', () => {
  const { root } = dom()
  const raw = '😀term <b>12</b>\u200b'
  const annotations = [{ id: 'term', start: 1, end: 6, kind: 'term', title: 'Term' }, { id: 'issue', start: 4, end: raw.length, kind: 'issue' }]
  renderTokenEditorDom(root, raw, { sourceText: raw, showInvisibles: true, annotations })
  assert.equal(tokens.readInlineDomText(root), raw)
  const marked = descendants(root).filter(node => node.dataset.assistId)
  assert(marked.length >= 2)
  assert(marked.every(node => node.contentEditable !== 'false'))
  assert(marked.every(node => !descendants(node).some(child => child.dataset.inlineRaw)))
  assert.equal(tokens.annotatedTextRuns('😀x', 0, [{ id: 'u', start: 1, end: 2, kind: 'issue' }])[0].raw, '😀')
})

test('native IME text nodes, line wrappers and trailing caret sentinels serialize without visual labels', () => {
  const { document, root } = dom()
  const first = document.createElement('div'), second = document.createElement('div')
  first.appendChild(document.createTextNode('组合😀'))
  second.appendChild(document.createTextNode('\u00a0next'))
  root.appendChild(first); root.appendChild(second)
  assert.equal(tokens.readInlineDomText(root), '组合😀\n\u00a0next')
  assert.equal(tokens.inlineDomPointToOffset(root, second.childNodes[0], 1), '组合😀\n\u00a0'.length)
  const point = tokens.inlineOffsetToDomPoint(root, '组合😀\n\u00a0'.length)
  assert.equal(tokens.inlineDomPointToOffset(root, point.node, point.offset), '组合😀\n\u00a0'.length)
})

test('copy preserves complete selected tag code and original invisible characters', () => {
  const { document, root } = dom()
  const raw = 'Hi <b>😀</b>\u00a0\n'
  renderTokenEditorDom(root, raw, { sourceText: raw, showInvisibles: true })
  const start = tokens.inlineOffsetToDomPoint(root, 0), end = tokens.inlineOffsetToDomPoint(root, raw.length)
  document.getSelection = () => ({ anchorNode: start.node, anchorOffset: start.offset, focusNode: end.node, focusOffset: end.offset, isCollapsed: false, rangeCount: 1 })
  const copied = new Map()
  let prevented = false
  tokens.copyInlineSelection(root, { clipboardData: { setData: (type, value) => copied.set(type, value) }, preventDefault() { prevented = true } })
  assert.equal(copied.get('text/plain'), raw)
  assert.equal(prevented, true)
})

function mountTokenEditor(initial = {}) {
  const { document, root } = dom()
  const slots = [], pending = [], calls = [], selected = []
  const handle = { current: undefined }
  let cursor, tree
  const props = { value: 'base', sourceText: 'base', readOnly: false, label: 'Synthetic target',
    onEdit(value, operation) { calls.push(['edit', value, operation]); props.value = value; return true },
    onCompositionStart() { calls.push(['composition-start']) },
    onCompositionUpdate(value) { calls.push(['composition-update', value]); props.value = value },
    onCompositionEnd(value) { calls.push(['composition-end', value]); props.value = value; return value },
    onUndo() { calls.push(['undo']); return true }, onRedo() { calls.push(['redo']); return true },
    onSelectedText(value) { selected.push(value) }, ...initial }
  const runtime = {
    useRef(value) { const at = cursor++; return slots[at] ??= { current: value } },
    useImperativeHandle(ref, factory) { cursor++; ref.current = factory() },
    useLayoutEffect(run, deps) { const at = cursor++; if (!slots[at] || deps.some((value, index) => !Object.is(value, slots[at].deps[index]))) pending.push(() => { slots[at]?.cleanup?.(); slots[at] = { deps, cleanup: run() } }) },
  }
  const render = (patch = {}) => {
    Object.assign(props, patch); cursor = 0; hooks = runtime
    try { tree = exports.TokenEditor.render(props, handle); tree.ref.current = root; pending.splice(0).forEach(run => run()) }
    finally { hooks = undefined }
  }
  render()
  return { root, document, props, calls, selected, handle, render,
    event(type, values = {}) { const event = { currentTarget: root, cancelable: true, defaultPrevented: false, preventDefault() { this.defaultPrevented = true }, ...values }; root.listeners.get(type)(event); return event },
    invoke(name, values = {}) { const event = { currentTarget: root, nativeEvent: {}, defaultPrevented: false, propagationStopped: false, preventDefault() { this.defaultPrevented = true }, stopPropagation() { this.propagationStopped = true }, ...values }; tree.props[name](event); return event },
    unmount() { slots.forEach(slot => slot?.cleanup?.()) },
  }
}

test('passive annotation changes cannot steal a source/helper selection; active-only changes keep owned DOM nodes', () => {
  const editor = mountTokenEditor({ annotations: [{ id: 'a', start: 0, end: 4, kind: 'term' }] })
  const { document, root } = editor
  const helper = document.createElement('input'), outside = document.createTextNode('source selection')
  helper.appendChild(outside); document.activeElement = helper
  document.selection.setBaseAndExtent(outside, 1, outside, 6)
  const writes = document.selectionWrites, replacements = root.replacements, textNode = root.childNodes[1]
  editor.render({ annotations: [{ id: 'a', start: 0, end: 4, kind: 'term', active: true }] })
  assert.equal(root.replacements, replacements)
  assert.equal(root.childNodes[1], textNode)
  assert.equal(descendants(root).find(node => node.dataset.assistId === 'a').dataset.active, 'true')
  editor.render({ annotations: [{ id: 'b', start: 1, end: 3, kind: 'spelling' }] })
  assert.equal(document.selectionWrites, writes)
  assert.equal(document.selection.anchorNode, outside)
  assert.equal(document.activeElement, helper)
  assert.deepEqual(editor.selected, [])
  editor.handle.current.select(1, 3)
  assert.equal(document.activeElement, root)
  assert.equal(document.selectionWrites, writes + 1)
  assert.equal(editor.selected.at(-1), 'as')
  editor.unmount()
})

test('external focus rebuilds cannot overwrite cached raw selections with a collapsed live Range', () => {
  const raw = '{u>abcd<u}', editor = mountTokenEditor({ value: raw, sourceText: raw, formatId: phraseFormat })
  const { document, root } = editor, helper = document.createElement('button')
  editor.handle.current.select(3, 5)
  const anchor = tokens.inlineOffsetToDomPoint(root, 5), focus = tokens.inlineOffsetToDomPoint(root, 3)
  document.selection.setBaseAndExtent(anchor.node, anchor.offset, focus.node, focus.offset)
  document.listeners.get('selectionchange')()
  const before = editor.handle.current.selection(), writes = document.selectionWrites
  assert.equal(before.backward, true)
  helper.focus()
  editor.render({ showFormatCodes: true })
  assert.equal(document.selection.anchorNode, root)
  assert.equal(document.selection.anchorOffset, 0, 'the fixture reproduces standard live Range removal behavior')
  document.listeners.get('selectionchange')()
  assert.deepEqual({ ...editor.handle.current.selection() }, before)
  assert.equal(document.activeElement, helper)
  assert.equal(document.selectionWrites, writes, 'a view rebuild must not steal focus or replace an external control selection')
  root.focus(); editor.invoke('onFocus'); document.listeners.get('selectionchange')()
  assert.deepEqual({ ...editor.handle.current.selection() }, before, 'Tab refocus restores the original raw selection')
  assert.equal(editor.handle.current.toggleFormat('b'), true)
  assert.equal(tokens.readInlineDomText(root), '{bu>ab<bu}{u>cd<u}')

  // An undo/redo snapshot may replace raw text and selection while undo has focus.
  const snapshots = [{ value: 'A first', initialSelection: { start: 2, end: 7, backward: true } }, { value: 'A redo', initialSelection: { start: 2, end: 6, backward: false } }]
  for (const snapshot of snapshots) {
    helper.focus(); editor.render(snapshot); document.listeners.get('selectionchange')()
    assert.deepEqual({ ...editor.handle.current.selection() }, snapshot.initialSelection)
    assert.equal(document.activeElement, helper)
  }
  assert.equal(editor.handle.current.toggleFormat('i'), true)
  assert.equal(tokens.readInlineDomText(root), 'A {i>redo<i}', 'a toolbar action uses the restored snapshot range, not root/0')
  editor.unmount()
})

test('pointer refocus respects a new user caret instead of restoring the old cached range', () => {
  const editor = mountTokenEditor({ value: 'abcdef', sourceText: 'abcdef' }), { document, root } = editor
  editor.handle.current.select(1, 4)
  document.createElement('button').focus(); editor.render({ showInvisibles: true })
  document.listeners.get('selectionchange')()
  editor.invoke('onPointerDown'); root.focus()
  const point = tokens.inlineOffsetToDomPoint(root, 5)
  document.selection.setBaseAndExtent(point.node, point.offset, point.node, point.offset)
  editor.invoke('onFocus'); document.listeners.get('selectionchange')()
  assert.equal(editor.handle.current.selection().start, 5)
  editor.handle.current.insert('X')
  assert.equal(tokens.readInlineDomText(root), 'abcdeXf')
  editor.unmount()
})

test('IME Escape and legacy composing key events keep their native default without reaching parent shortcuts', () => {
  let parentKeys = 0
  const editor = mountTokenEditor({ onKeyDown() { parentKeys++ } })
  editor.invoke('onCompositionStart')
  const local = editor.invoke('onKeyDown', { key: 'Escape', nativeEvent: { isComposing: false } })
  assert.equal(local.defaultPrevented, false); assert.equal(local.propagationStopped, true)
  editor.invoke('onCompositionEnd')
  for (const nativeEvent of [{ isComposing: true }, { isComposing: false, keyCode: 229 }]) {
    const event = editor.invoke('onKeyDown', { key: 'Escape', nativeEvent })
    assert.equal(event.defaultPrevented, false); assert.equal(event.propagationStopped, true)
  }
  assert.equal(parentKeys, 0)
  editor.invoke('onKeyDown', { key: 'Escape' })
  assert.equal(parentKeys, 1, 'ordinary Escape still reaches the editor cancel action')
  editor.unmount()
})

test('IME keeps its live DOM untouched until completion and reads the last native text before unmount', () => {
  const editor = mountTokenEditor({ autoFocus: true })
  editor.invoke('onCompositionStart')
  editor.root.childNodes[1].nodeValue = 'base拼'
  editor.invoke('onInput', { nativeEvent: { isComposing: true } })
  const replacements = editor.root.replacements
  editor.render({ showInvisibles: true, annotations: [{ id: 's', start: 0, end: 2, kind: 'spelling' }] })
  assert.equal(editor.root.replacements, replacements, 'React updates cannot touch an in-progress native composition')
  editor.root.childNodes[1].nodeValue = 'base拼终'
  editor.unmount()
  assert.deepEqual(editor.calls.at(-1), ['composition-end', 'base拼终'])
  assert.equal(editor.root.replacements, replacements)
  assert.equal(editor.root.listeners.size, 0)
  assert.equal(editor.document.listeners.size, 0)
})

test('owned beforeinput edits preserve Unicode graphemes/newlines and route native history to reducer callbacks', () => {
  const editor = mountTokenEditor({ value: 'A😀e\u0301', sourceText: 'A😀e\u0301', autoFocus: true })
  assert.equal(editor.event('beforeinput', { inputType: 'deleteContentBackward' }).defaultPrevented, true)
  assert.equal(tokens.readInlineDomText(editor.root), 'A😀')
  editor.event('beforeinput', { inputType: 'deleteContentBackward' })
  assert.equal(tokens.readInlineDomText(editor.root), 'A')
  editor.event('beforeinput', { inputType: 'insertParagraph' })
  editor.event('beforeinput', { inputType: 'insertText', data: '\u00a0\t' })
  assert.equal(tokens.readInlineDomText(editor.root), 'A\n\u00a0\t')
  editor.event('beforeinput', { inputType: 'historyUndo' })
  editor.event('beforeinput', { inputType: 'historyRedo' })
  assert.deepEqual(editor.calls.slice(-2), [['undo'], ['redo']])
  editor.render({ readOnly: true })
  editor.event('beforeinput', { inputType: 'insertText', data: 'forbidden' })
  assert.equal(tokens.readInlineDomText(editor.root), 'A\n\u00a0\t')
  editor.unmount()
})

test('paste and cut consume exact plain text while required-chip rejection restores the owned DOM', () => {
  const raw = '<b>A</b>'
  const editor = mountTokenEditor({ value: raw, sourceText: raw, autoFocus: true,
    onEdit(value) { return value.includes('<b>') && value.includes('</b>') } })
  editor.handle.current.select(3, 4)
  editor.invoke('onPaste', { clipboardData: { getData: type => type === 'text/plain' ? '\t😀\n\u00a0' : '<img src=x>' } })
  assert.equal(tokens.readInlineDomText(editor.root), '<b>\t😀\n\u00a0</b>')
  editor.handle.current.select(0, 3)
  const clipboard = new Map()
  editor.invoke('onCut', { clipboardData: { setData: (type, value) => clipboard.set(type, value) } })
  assert.equal(clipboard.get('text/plain'), '<b>')
  assert.equal(tokens.readInlineDomText(editor.root), '<b>\t😀\n\u00a0</b>', 'a rejected cut must restore chips, not leave label text')
  editor.unmount()
})

test('cut with a collapsed selection preserves the clipboard and draft', () => {
  const editor = mountTokenEditor({ autoFocus: true })
  const clipboard = new Map([['text/plain', 'keep clipboard']])
  editor.invoke('onCut', { clipboardData: { setData: (type, value) => clipboard.set(type, value) } })
  assert.equal(clipboard.get('text/plain'), 'keep clipboard')
  assert.equal(tokens.readInlineDomText(editor.root), 'base')
  assert.equal(editor.calls.length, 0)
  editor.unmount()
})

test('text drop ignores HTML and snaps a browser drop point away from surrogate halves', () => {
  const editor = mountTokenEditor({ value: 'A😀B', sourceText: 'A😀B', autoFocus: true })
  const textNode = editor.root.childNodes[1]
  editor.document.caretRangeFromPoint = () => ({ startContainer: textNode, startOffset: 2 })
  const transfer = { files: [], getData: type => type === 'text/plain' ? '\t<not-a-tag\n' : '<img src=x onerror=alert(1)>' }
  editor.invoke('onDrop', { clientX: 1, clientY: 1, dataTransfer: transfer })
  assert.equal(tokens.readInlineDomText(editor.root), 'A\t<not-a-tag\n😀B')
  assert.equal(descendants(editor.root).some(node => node.tagName === 'IMG'), false)
  editor.unmount()
})

const phraseFormat = 'phrase_mxliff_1_2'
const phraseRanges = (raw, formatId = phraseFormat, options = {}) => tokens.phraseFormatting(raw, formatId, tokens.tokenizeInlineText(raw, options)).ranges.filter(range => range.flags.includes('u')).map(({ start, end }) => ({ start, end }))
const decoratedNodes = root => descendants(root).filter(node => node.dataset.inlineDecoration === 'underline')

test('Phrase underline ranges use exact UTF-16 flat, multiline and multiple balanced pairs', () => {
  for (const raw of ['{u>flat<u}', '😀{u>A\r\nB\t\u00a0<u} end', 'before {u>one<u} / {u>two😀<u} after']) {
    const ranges = phraseRanges(raw)
    assert.deepEqual(ranges.map(range => raw.slice(range.start, range.end)), [...raw.matchAll(/\{u>(.*?)<u\}/gs)].map(match => match[1]))
    assert.equal(tokens.tokenizeInlineText(raw).map(token => token.raw).join(''), raw)
  }
  assert.deepEqual(phraseRanges('😀{u>x<u}'), [{ start: 5, end: 6 }])
  assert.deepEqual(phraseRanges('{u><u}'), [], 'empty pairs add no presentation nodes')
})

test('non-Phrase, nested, unbalanced and malformed underline syntax stays literal', () => {
  const invalid = ['{u>x', 'x<u}', '<u}{u>x<u}', '{u>outer {u>inner<u} outer<u}', '{u>ok<u}{u>unfinished', '{u >x<u}', '{u>x<u }', '{U>x<U}']
  for (const raw of invalid) {
    assert.deepEqual(phraseRanges(raw), [], raw)
    const { root } = dom()
    renderTokenEditorDom(root, raw, { sourceText: raw, formatId: phraseFormat })
    assert.equal(decoratedNodes(root).length, 0, raw)
    assert.equal(tokens.readInlineDomText(root), raw)
  }
  for (const formatId of [undefined, 'sdlxliff_1_2', 'xliff_1_2', 'phrase_mxliff']) {
    const raw = '{u>plain<u}', { root } = dom()
    assert.deepEqual(phraseRanges(raw, formatId ?? ''), [])
    renderTokenEditorDom(root, raw, { sourceText: raw, formatId })
    assert.equal(decoratedNodes(root).length, 0)
    const html = renderToStaticMarkup(React.createElement(inlineExports.InlineTaggedText, { text: raw, formatId }))
    assert.doesNotMatch(html, /data-inline-decoration/)
  }
})

test('read-only decoration wraps full-field ranges after annotation and nested renderText splits', () => {
  const raw = 'A {u>term 10 and\nterm<u} Z'
  const seen = []
  const html = renderToStaticMarkup(React.createElement(inlineExports.InlineTaggedText, {
    text: raw, sourceText: raw, formatId: phraseFormat, showFormatCodes: true,
    annotations: [{ id: 'number', start: raw.indexOf('10'), end: raw.indexOf('10') + 2, kind: 'number' }],
    renderText(value, start) {
      seen.push([value, start])
      // Like SourceText: a nested renderer sees only fragments and no formatId.
      return React.createElement(inlineExports.InlineTaggedText, { text: value, showInvisibles: false })
    },
  }))
  assert.equal(seen.map(([value]) => value).join(''), raw)
  assert.match(html, /data-inline-decoration="underline"><span[^>]*data-inline-view="true"[^>]*>term /)
  assert.match(html, /data-inline-decoration="underline"><span[^>]*data-assist-id="number"[^>]*><span[^>]*data-inline-view="true"[^>]*>10/)
  assert.equal((html.match(/data-inline-decoration="underline"/g) ?? []).length, 3)
  assert.match(html.replace(/<[^>]*>/g, ''), /A \{u&gt;/)
  assert.match(html.replace(/<[^>]*>/g, ''), /&lt;u\} Z/)
  assert.doesNotMatch(html, /<u[\s>]|<script|<img/)
  const css = readFileSync(new URL('../../packages/dsh-linguist/src/client/InlineTaggedText.module.css', import.meta.url), 'utf8')
  assert.match(css.match(/\.underline\s*\{([^}]+)\}/)[1], /text-decoration-line:\s*underline/)
})

test('whole chips inside underline ranges are decorated without styling chips that cross boundaries', () => {
  const raw = '{u><b>{name}</b><u} outside {other}'
  const { root } = dom()
  renderTokenEditorDom(root, raw, { sourceText: raw, formatId: phraseFormat })
  assert.deepEqual(decoratedNodes(root).map(node => node.dataset.inlineRaw), ['<b>', '{name}', '</b>'])
  assert.equal(descendants(root).find(node => node.dataset.inlineRaw === '{other}').dataset.inlineDecoration, undefined)
  const html = renderToStaticMarkup(React.createElement(inlineExports.InlineTaggedText, { text: raw, formatId: phraseFormat }))
  assert.equal((html.match(/data-inline-decoration="underline"/g) ?? []).length, 3)
  const opaqueProfile = { families: [{ id: 'opaque', class: 'singleton', pattern: '\\[opaque:[^\\]]+\\]' }], candidates: [] }
  for (const crossing of ['<g label="{u>inside">outside<u}', '[opaque:{u>inside]outside<u}', '{u>outside[opaque:inside<u}]', '[opaque:{u>inside<u}]']) {
    assert.deepEqual(phraseRanges(crossing, phraseFormat, { tagProfile: opaqueProfile }), [], 'a presentation boundary inside atomic code rejects that range')
    renderTokenEditorDom(root, crossing, { sourceText: crossing, formatId: phraseFormat, tagProfile: opaqueProfile })
    assert.equal(decoratedNodes(root).length, 0)
    assert.equal(tokens.readInlineDomText(root), crossing)
    assert.doesNotMatch(renderToStaticMarkup(React.createElement(inlineExports.InlineTaggedText, { text: crossing, formatId: phraseFormat, tagProfile: opaqueProfile })), /data-inline-decoration/)
  }
  const tagProfile = { families: [{ id: 'marker', class: 'singleton', pattern: '\\{u>|<u\\}' }], candidates: [] }
  renderTokenEditorDom(root, raw, { sourceText: raw, formatId: phraseFormat, tagProfile })
  assert.equal(descendants(root).find(node => node.dataset.inlineRaw === '{u>').dataset.inlineDecoration, undefined)
  assert.equal(descendants(root).find(node => node.dataset.inlineRaw === '{name}').dataset.inlineDecoration, 'underline')
})

test('owned editable underline spans preserve exact raw, UTF-16 caret, backward selection and copy', () => {
  const raw = '😀 {u>term\t10\r\n\u00a0{name}😀<u} {u>尾\u200b<u}'
  const { root, document } = dom()
  const annotations = [{ id: 't', start: raw.indexOf('term'), end: raw.indexOf('term') + 4, kind: 'term' },
    { id: 'n', start: raw.indexOf('10'), end: raw.indexOf('10') + 2, kind: 'number' }]
  renderTokenEditorDom(root, raw, { sourceText: raw, formatId: phraseFormat, annotations, showInvisibles: true, showFormatCodes: true })
  assert.equal(tokens.readInlineDomText(root), raw)
  assert.equal(root.textContent, raw)
  const editable = decoratedNodes(root).filter(node => !node.hasAttribute('data-inline-raw'))
  assert(editable.length >= 4)
  assert(editable.every(node => node.contentEditable !== 'false' && !node.hasAttribute('data-inline-raw')))
  const parsed = tokens.tokenizeInlineText(raw)
  for (let offset = 0; offset <= raw.length; offset++) {
    const normalized = tokens.snapInlineSelection(raw, offset, offset, parsed).start
    const point = tokens.inlineOffsetToDomPoint(root, normalized)
    assert.equal(tokens.inlineDomPointToOffset(root, point.node, point.offset), normalized, `decorated caret ${offset}`)
  }
  const left = tokens.inlineOffsetToDomPoint(root, 0), right = tokens.inlineOffsetToDomPoint(root, raw.length)
  document.selection.setBaseAndExtent(right.node, right.offset, left.node, left.offset)
  assert.deepEqual(tokens.inlineDomSelection(root, document.selection), { start: 0, end: raw.length, backward: true })
  const clipboard = new Map()
  tokens.copyInlineSelection(root, { clipboardData: { setData: (type, value) => clipboard.set(type, value) }, preventDefault() {} })
  assert.equal(clipboard.get('text/plain'), raw, 'raw copy retains visible delimiters, chips and invisible code units')
})

test('format changes redraw presentation without stealing selection and defer all decoration until IME completes', () => {
  const raw = '{u>base<u}', editor = mountTokenEditor({ value: raw, sourceText: raw })
  const outside = editor.document.createTextNode('source selection')
  editor.document.selection.setBaseAndExtent(outside, 0, outside, 6)
  const writes = editor.document.selectionWrites
  editor.render({ formatId: phraseFormat })
  assert.equal(decoratedNodes(editor.root).length, 1)
  assert.equal(editor.document.selectionWrites, writes)
  assert.equal(editor.document.selection.anchorNode, outside)
  editor.handle.current.select(4, 6)
  editor.render({ formatId: 'sdlxliff_1_2' })
  assert.equal(decoratedNodes(editor.root).length, 0)
  assert.deepEqual(editor.handle.current.selection(), { start: 4, end: 6, backward: false })
  editor.invoke('onCompositionStart')
  const live = editor.root.childNodes[1], replacements = editor.root.replacements
  live.nodeValue = '{u>组合😀<u}'
  editor.render({ formatId: phraseFormat, showInvisibles: true, annotations: [{ id: 'ime', start: 3, end: 5, kind: 'term' }] })
  assert.equal(editor.root.replacements, replacements)
  assert.equal(editor.root.childNodes[1], live)
  editor.invoke('onCompositionEnd')
  assert.equal(tokens.readInlineDomText(editor.root), '{u>组合😀<u}')
  assert.equal(decoratedNodes(editor.root).map(node => node.textContent).join(''), '组合😀')
  assert.deepEqual(editor.calls.at(-1), ['composition-end', '{u>组合😀<u}'])
  editor.unmount()
})

test('decorated editor plain-text paste/cut/edit keeps delimiters and never accepts clipboard HTML', () => {
  const raw = '{u>base<u}', editor = mountTokenEditor({ value: raw, sourceText: raw, formatId: phraseFormat, autoFocus: true })
  editor.handle.current.select(3, 7)
  editor.invoke('onPaste', { clipboardData: { getData: type => type === 'text/plain' ? '😀\n{name}' : '<img src=x>' } })
  assert.equal(tokens.readInlineDomText(editor.root), '{u>😀\n{name}<u}')
  assert.equal(decoratedNodes(editor.root).map(node => node.textContent).join(''), '😀\n{name}')
  editor.handle.current.select(3, 5)
  const clipboard = new Map()
  editor.invoke('onCut', { clipboardData: { setData: (type, value) => clipboard.set(type, value) } })
  assert.equal(clipboard.get('text/plain'), '{u>😀<u}', 'rich cut preserves the selected style as a balanced native fragment')
  assert.equal(tokens.readInlineDomText(editor.root), '{u>\n{name}<u}')
  editor.handle.current.select(3, 3)
  editor.event('beforeinput', { inputType: 'insertText', data: 'New' })
  assert.equal(tokens.readInlineDomText(editor.root), '{u>New\n{name}<u}')
  assert.equal(editor.handle.current.selection().start, 6)
  assert(!descendants(editor.root).some(node => node.tagName === 'IMG' || node.tagName === 'U'))
  editor.unmount()
})

test('rich view hides only verified native boundaries and code view preserves literal raw text', () => {
  for (const flags of ['b', 'i', 'u', 'bi', 'bu', 'iu', 'biu']) {
    const raw = `X{${flags}>😀 {name}<${flags}}Y`, { root } = dom()
    renderTokenEditorDom(root, raw, { sourceText: raw, formatId: phraseFormat })
    assert.equal(root.textContent, 'X😀 {name}Y')
    assert.equal(tokens.readInlineDomText(root), raw)
    assert.equal(descendants(root).filter(node => node.dataset.inlineFormatCode && node.hidden).length, 2)
    assert(descendants(root).some(node => node.dataset.inlineRaw === '{name}' && node.dataset.inlineFormat === flags))
    renderTokenEditorDom(root, raw, { sourceText: raw, formatId: phraseFormat, showFormatCodes: true })
    assert.equal(root.textContent, raw)
    assert.equal(tokens.readInlineDomText(root), raw)
    assert.equal(descendants(root).filter(node => node.dataset.inlineFormatCode).length, 0)
  }
})

test('rich partial clipboard fragments are balanced while code view copies the exact selected raw', () => {
  const raw = 'A {bu>foo {name} bar<bu} Z'
  const editor = mountTokenEditor({ value: raw, sourceText: raw, formatId: phraseFormat })
  const start = raw.indexOf('foo') + 1, end = raw.indexOf('bar') + 2
  editor.handle.current.select(start, end)
  const copied = new Map()
  editor.invoke('onCopy', { clipboardData: { setData: (type, value) => copied.set(type, value) } })
  assert.equal(copied.get('text/plain'), '{bu>oo {name} ba<bu}')
  assert(tokens.phraseFormatting(copied.get('text/plain'), phraseFormat).valid)
  editor.render({ showFormatCodes: true })
  editor.handle.current.select(start, end)
  editor.invoke('onCopy', { clipboardData: { setData: (type, value) => copied.set(type, value) } })
  assert.equal(copied.get('text/plain'), raw.slice(start, end))
  assert.equal(tokens.readInlineDomText(editor.root), raw)
  assert.equal(editor.calls.length, 0, 'view changes are display-only')
  editor.unmount()
})

test('Backspace and Delete at hidden style boundaries edit visible graphemes, never half a marker', () => {
  for (const [raw, at, inputType, expected] of [
    ['X{u>AB<u}Y', 4, 'deleteContentBackward', '{u>AB<u}Y'],
    ['{u>AB<u}Y', 5, 'deleteContentForward', '{u>AB<u}'],
    ['{biu>A😀<biu}', 8, 'deleteContentBackward', '{biu>A<biu}'],
    ['{u>AB<u}', 3, 'deleteContentForward', '{u>B<u}'],
    ['{u>AB<u}', 3, 'deleteContentBackward', '{u>AB<u}'],
    ['{u>AB<u}', 5, 'deleteContentForward', '{u>AB<u}'],
  ]) {
    const editor = mountTokenEditor({ value: raw, sourceText: raw, formatId: phraseFormat })
    editor.handle.current.select(at, at)
    editor.event('beforeinput', { inputType })
    assert.equal(tokens.readInlineDomText(editor.root), expected, `${raw} / ${inputType}`)
    assert(tokens.phraseFormatting(expected, phraseFormat).valid)
    editor.unmount()
  }
})

test('format handle submits a single protected edit with the old and new raw selections', () => {
  const commits = []
  let editor
  editor = mountTokenEditor({ value: 'A {name} B', sourceText: 'A {name} B', formatId: phraseFormat,
    onEdit(value, operation, before, after) { commits.push({ value, operation, before, after }); editor.props.value = value; return true } })
  editor.handle.current.select(2, 8)
  assert.equal(editor.handle.current.toggleFormat('u'), true)
  assert.equal(commits.length, 1)
  assert.equal(commits[0].value, 'A {u>{name}<u} B')
  assert.equal(commits[0].operation, 'protected')
  assert.equal(commits[0].before.start, 2)
  assert.equal(commits[0].after.start, 5)
  assert.equal(tokens.readInlineDomText(editor.root), commits[0].value)
  editor.render({ readOnly: true })
  assert.equal(editor.handle.current.toggleFormat('b'), false)
  assert.equal(commits.length, 1)
  editor.render({ readOnly: false })
  editor.invoke('onCompositionStart')
  assert.equal(editor.handle.current.toggleFormat('i'), false)
  assert.equal(commits.length, 1)
  editor.invoke('onCompositionEnd')
  editor.unmount()
})

test('native format keyboard shortcuts share the selected draft transaction and are inert for other formats', () => {
  const editor = mountTokenEditor({ value: 'word', sourceText: 'word', formatId: phraseFormat })
  editor.handle.current.select(0, 4)
  for (const key of ['b', 'i', 'u']) editor.invoke('onKeyDown', { key, ctrlKey: true })
  assert.equal(tokens.readInlineDomText(editor.root), '{biu>word<biu}')
  assert.equal(editor.calls.filter(call => call[0] === 'edit').length, 3)
  editor.render({ formatId: 'sdlxliff_1_2' })
  editor.invoke('onKeyDown', { key: 'b', metaKey: true })
  assert.equal(tokens.readInlineDomText(editor.root), '{biu>word<biu}')
  assert.equal(editor.calls.filter(call => call[0] === 'edit').length, 3)
  editor.unmount()
})

test('rich cut cannot remove a required runtime chip and restores its formatting projection', () => {
  const raw = '{u>A {name} B<u}'
  const editor = mountTokenEditor({ value: raw, sourceText: raw, formatId: phraseFormat,
    onEdit(value) { return targetExports.targetProtectionViolations({ source: raw }, value).length === 0 } })
  const at = raw.indexOf('{name}')
  editor.handle.current.select(at + 1, at + 3)
  const copied = new Map()
  editor.invoke('onCut', { clipboardData: { setData: (type, value) => copied.set(type, value) } })
  assert.equal(copied.get('text/plain'), '{u>{name}<u}')
  assert.equal(tokens.readInlineDomText(editor.root), raw)
  assert.equal(descendants(editor.root).find(node => node.dataset.inlineRaw === '{name}').dataset.inlineDecoration, 'underline')
  editor.unmount()
})

test('format-code and invisible-character switches wait for IME completion without rebuilding its DOM', () => {
  const raw = '{u>A<u}', editor = mountTokenEditor({ value: raw, sourceText: raw, formatId: phraseFormat })
  editor.handle.current.select(4, 4)
  editor.invoke('onCompositionStart')
  const live = descendants(editor.root).find(node => node.nodeType === 3 && node.nodeValue === 'A')
  live.nodeValue = '输入😀'
  editor.invoke('onInput', { nativeEvent: { isComposing: true } })
  const replacements = editor.root.replacements
  editor.render({ showFormatCodes: true, showInvisibles: true })
  assert.equal(editor.root.replacements, replacements)
  assert.equal(editor.root.dataset.inlineFormatView, 'rich')
  editor.invoke('onCompositionEnd')
  assert.equal(editor.root.dataset.inlineFormatView, 'codes')
  assert.equal(tokens.readInlineDomText(editor.root), '{u>输入😀<u}')
  assert.equal(editor.root.textContent, '{u>输入😀<u}')
  assert.deepEqual(editor.calls.at(-1), ['composition-end', '{u>输入😀<u}'])
  editor.unmount()
})

test('a rejected native composition restores the pre-composition raw selection', () => {
  const raw = '{u>base<u}'
  let editor
  editor = mountTokenEditor({ value: raw, sourceText: raw, formatId: phraseFormat, onCompositionEnd() { editor.props.value = raw; return raw } })
  editor.handle.current.select(4, 5)
  editor.invoke('onCompositionStart')
  editor.root.replaceChildren(editor.document.createTextNode('native replacement'))
  editor.invoke('onInput', { nativeEvent: { isComposing: true } })
  editor.invoke('onCompositionEnd')
  assert.equal(tokens.readInlineDomText(editor.root), raw)
  assert.equal(editor.handle.current.selection().start, 4)
  assert.equal(editor.handle.current.selection().end, 5)
  editor.unmount()
})

test('Unicode metadata distinguishes code points from raw code units and names invisible characters', () => {
  const characters = tokens.unicodeCharacters('😀\t\n\u00a0\u200b')
  assert.deepEqual(characters.map(character => [character.start, character.end]), [[0, 2], [2, 3], [3, 4], [4, 5], [5, 6]])
  assert.equal(characters[0].codePointLabel, 'U+1F600')
  assert.equal(characters.at(-1).name, 'ZERO WIDTH SPACE')
  assert.equal(characters.at(-1).glyph, 'ZWSP')
})
