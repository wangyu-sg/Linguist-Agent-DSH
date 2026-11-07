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
runInNewContext(targetCode, { exports: targetExports, require: name => name === 'react' ? React : name === '@linguist/cat-core' ? tagCore : {} })

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
  replaceChildren(...children) { this.replacements = (this.replacements ?? 0) + 1; this.childNodes.forEach(child => { child.parentNode = null }); this.childNodes = []; children.forEach(child => this.appendChild(child)) }
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
    invoke(name, values = {}) { tree.props[name]({ currentTarget: root, nativeEvent: {}, preventDefault() { this.defaultPrevented = true }, ...values }) },
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

test('Unicode metadata distinguishes code points from raw code units and names invisible characters', () => {
  const characters = tokens.unicodeCharacters('😀\t\n\u00a0\u200b')
  assert.deepEqual(characters.map(character => [character.start, character.end]), [[0, 2], [2, 3], [3, 4], [4, 5], [5, 6]])
  assert.equal(characters[0].codePointLabel, 'U+1F600')
  assert.equal(characters.at(-1).name, 'ZERO WIDTH SPACE')
  assert.equal(characters.at(-1).glyph, 'ZWSP')
})
