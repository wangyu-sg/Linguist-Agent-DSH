import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'
import * as inline from '../../packages/dsh-linguist/src/client/inline-tokens.ts'
import * as diff from '../../packages/dsh-linguist/src/client/editor-diff.ts'

const require = createRequire(new URL('../../packages/dsh-linguist/package.json', import.meta.url))
const React = require('react')
const { renderToStaticMarkup } = require('react-dom/server')
const { transform: parseCss } = require('lightningcss')
const client = new URL('../../packages/dsh-linguist/src/client/', import.meta.url)
const t = (key, params = {}) => key.replace(/\{(\w+)\}/g, (_, name) => String(params[name]))
const cache = new Map()

// Synthetic, structural component checks only. Production token rendering and diff
// run unchanged; native buttons and locale are substituted, without a browser/mock UI.
function load(file) {
  if (cache.has(file)) return cache.get(file)
  const exports = {}
  cache.set(file, exports)
  const code = ts.transpileModule(readFileSync(new URL(file, client), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.React, target: ts.ScriptTarget.ES2022 },
  }).outputText
  runInNewContext(code, { exports, require: name => {
    if (name === 'react') return { ...React, useMemo: factory => factory(), useId: () => 'synthetic-reference' }
    if (name === '@deepseek-ai/dsh-client-ui-primitives') return { Button: 'button' }
    if (name === './ui-locale') return { useT: () => t }
    if (name === './inline-tokens') return inline
    if (name === './editor-diff') return diff
    if (name === './InlineTaggedText') return load('InlineTaggedText.tsx')
    if (name === './workflow-ui') return load('workflow-ui.ts')
    if (name.endsWith('.module.css')) return { default: new Proxy({}, { get: (_target, key) => key }) }
    throw Error(`Unexpected reference inspector dependency: ${name}`)
  } })
  return exports
}
const { ReferenceMatches } = load('ReferenceMatches.tsx')
const children = node => React.Children.toArray(node?.props?.children)
const text = node => node == null || typeof node === 'boolean' ? '' : typeof node !== 'object' ? String(node) : children(node).map(text).join('')
const entries = (node, parents = []) => node === null || typeof node !== 'object' ? [] : [{ node, parents }, ...children(node).flatMap(child => entries(child, [...parents, node]))]
const nodes = node => entries(node).map(entry => entry.node)
const expand = node => {
  if (node === null || typeof node !== 'object') return node
  if (typeof node.type === 'function') return expand(node.type(node.props))
  return React.cloneElement(node, undefined, ...children(node).map(expand))
}
const select = (root, predicate) => { const found = nodes(root).find(predicate); assert(found, 'Expected rendered reference node'); return found }
const button = (root, label) => select(root, node => node.type === 'button' && text(node) === label)
const projection = (node, skip) => node == null || typeof node === 'boolean' ? '' : typeof node !== 'object' ? String(node) : node.type === skip ? '' : children(node).map(child => projection(child, skip)).join('')
const chips = root => nodes(root).filter(node => node.props?.['data-inline-raw'] !== undefined)
const escape = value => value.replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#x27;' })[char])

const segment = { id: 'synthetic-segment', assetId: 'synthetic-asset', ordinal: 0, source: 'Take <b>12</b> potions, {player}.', target: 'CURRENT TARGET MUST NOT ENTER SOURCE DIFF', sourceLocale: 'en-US', targetLocale: 'fr-FR', sourceHash: 'synthetic-hash', revision: 1, status: 'draft', locked: false }
const tm = { id: 'synthetic-tm', matchedSource: 'Take <b>10</b> potions, {player}.', target: 'Prenez <b>10</b> potions, {player}.', matchClass: 'fuzzy', score: 93.6, sourceLabel: 'Synthetic TM / source A', provenanceCount: 3, variantCount: 2, badges: ['Synthetic context', 'Synthetic source badge'], safety: 'review', warnings: ['Synthetic variable warning', 'Synthetic context warning'], differences: ['Synthetic number difference', 'Synthetic provenance difference'] }
const term = { id: 'synthetic-term', term: 'potions', translation: 'potions synthétiques', status: 'required', caseSensitive: true, matchType: 'contains', conflict: true, start: 15, end: 22, lowDiscrimination: true, module: 'Synthetic Battle', category: 'Synthetic Item', note: 'Synthetic terminology note\nsecond line' }
function props(patch = {}) { return { segment, tm: [tm], terms: [term], editorAvailable: true, currentTarget: tm.target, targetIsDraft: false, onApply() {}, onOpenTerms() {}, ...patch } }
const render = patch => expand(React.createElement(ReferenceMatches, props(patch)))
const tmCard = root => select(root, node => node.props?.['data-reference-tm'] === tm.id)
const termCard = root => select(root, node => node.props?.['data-reference-term'] === term.id)

test('adapted TM candidate and replacements are visible and applied only on explicit action', () => {
  const candidate = 'Prenez <b>12</b> potions, {player}.'
  const applied = []
  const adapted = { ...tm, adaptation: { status: 'adapted', candidate, replacements: [{ type: 'number', from: '10', to: '12' }] } }
  const card = tmCard(render({ tm: [adapted], onApply: (...args) => applied.push(args) }))
  assert.match(text(card), /适配候选/)
  assert.match(text(card), /10.*12/)
  assert(text(card).includes(candidate))
  assert(text(card).includes('94%'))
  assert.deepEqual(applied, [])
  button(card, '使用适配候选').props.onClick()
  assert.deepEqual(applied, [[candidate, 'replace', tm.id]])
  const uncertain = tmCard(render({ tm: [{ ...tm, adaptation: { status: 'needs-review', replacements: [] } }] }))
  assert.match(text(uncertain), /适配需判断/)
  assert(!nodes(uncertain).some(node => node.type === 'button' && text(node) === '使用适配候选'))
})

test('term evidence exposes its source file and source note alongside the actual translation', () => {
  const sourced = { ...term, sources: [{ id: 'synthetic-source', filename: 'synthetic-termbase.csv', sha256: 'a'.repeat(64), term: 'potions', translation: 'potions synthétiques', note: 'Inventory terminology' }] }
  const card = termCard(render({ terms: [sourced] }))
  assert.match(text(card), /potions synthétiques/)
  assert.match(text(card), /synthetic-termbase\.csv/)
  assert.match(text(card), /Inventory terminology/)
})

test('TM diff is baseline matchedSource → current segment.source; translation is never its comparison input', () => {
  const root = render(), card = tmCard(root)
  const comparison = select(card, node => node.props?.['data-source-comparison'] === 'tm-to-current')
  assert.equal(projection(comparison, 'ins'), tm.matchedSource)
  assert.equal(projection(comparison, 'del'), segment.source)
  assert.equal(text(select(comparison, node => node.type === 'del')), '10')
  assert.equal(text(select(comparison, node => node.type === 'ins')), '12')
  assert(!text(comparison).includes('Prenez'))
  assert(!text(comparison).includes(segment.target))
  assert.match(text(root), /源文比较：TM 原文 → 当前源文/)
  assert.match(text(root), /删除.*仅 TM 中存在/)
  assert.match(text(root), /新增.*仅当前文本中存在/)
  assert.equal(text(select(card, node => node.props?.['data-tm-target'] === true)), tm.target)
})

test('TM target comparison projects exact baseline and live current text while application keeps the original target', () => {
  const current = 'Prenez <b>12</b> potions, {player}.\n'
  const calls = [], root = render({ currentTarget: current, targetIsDraft: true, onApply: (...args) => calls.push(args) })
  const target = select(tmCard(root), node => node.props?.['data-target-comparison'] === 'tm-to-current')
  assert.equal(projection(target, 'ins'), tm.target)
  assert.equal(projection(target, 'del'), current)
  assert.match(text(root), /译文比较：TM 译文 → 当前草稿/)
  assert.equal(text(select(tmCard(root), node => node.props?.['data-tm-target'] === 'original')), tm.target)
  button(tmCard(root), '替换草稿').props.onClick()
  button(tmCard(root), '插入草稿').props.onClick()
  assert.deepEqual(calls, [[tm.target, 'replace', tm.id], [tm.target, 'insert', tm.id]])
  const saved = render({ currentTarget: current, targetIsDraft: false })
  assert.match(text(saved), /译文比较：TM 译文 → 已保存译文/)
})

test('TM source diff isolates a deletion inside continuous Chinese text', () => {
  const source = '07.17馆内展出白色纸鹤！'
  const matchedSource = '07.17馆内展出蓝色蝴蝶和白色纸鹤！'
  const card = tmCard(render({
    segment: { ...segment, source, sourceLocale: 'zh-CN', targetLocale: 'en-US' },
    tm: [{ ...tm, matchedSource }],
  }))
  const sourceDiff = select(card, node => node.props?.['data-source-comparison'])
  assert.deepEqual(nodes(sourceDiff).filter(node => node.type === 'del').map(text), ['蓝色蝴蝶和'])
  assert.equal(projection(sourceDiff, 'del'), source)
  assert.equal(projection(sourceDiff, 'ins'), matchedSource)
})

test('target differences preserve full atomic tag code, exact whitespace and empty current targets', () => {
  for (const [before, after] of [
    ['  Take <g id="11">😀</g>\t&amp;\r\n{name}', ' Take <g id="12">😀</g>\n&amp; {name}'],
    [tm.target, ''],
    [tm.target, tm.target],
  ]) {
    const root = render({ tm: [{ ...tm, target: before }], currentTarget: after, targetIsDraft: true }), card = tmCard(root)
    const comparison = nodes(card).find(node => node.props?.['data-target-comparison'])
    if (before === after) { assert.equal(comparison, undefined); assert.equal(text(select(card, node => node.props?.['data-tm-target'] === true)), before) }
    else { assert.equal(projection(comparison, 'ins'), before); assert.equal(projection(comparison, 'del'), after) }
    for (const chip of chips(card)) assert.equal(text(chip), chip.props['data-inline-raw'])
  }
})

test('source comparison round-trips whitespace, entities, newlines and Unicode without normalization', () => {
  for (const [before, after] of [
    ['  A\t<b>😀</b>\r\n\u00a0{name}', ' A\t<b>😀</b>\n\u00a0{name}\u200b'],
    ['&amp; <g id="11">塔</g>  ', '&amp; <g id="12">塔</g>\t'],
  ]) {
    const root = render({ segment: { ...segment, source: after }, tm: [{ ...tm, matchedSource: before, matchClass: 'exact', score: 100 }], terms: [] })
    const comparison = select(root, node => node.props?.['data-source-comparison'])
    assert.equal(projection(comparison, 'ins'), before)
    assert.equal(projection(comparison, 'del'), after)
    assert.equal(text(select(tmCard(root), node => node.props?.['data-tm-source'] === 'original')), before)
  }
})

test('identical source displays actual TM source directly, with no synthesized diff or guide', () => {
  const exact = { ...tm, matchedSource: segment.source, target: 'Exact original <b>12</b> target {player}', matchClass: 'exact', score: 100, safety: 'compatible', warnings: [], differences: [], provenanceCount: 1, variantCount: 1 }
  const root = render({ tm: [exact], terms: [] }), card = tmCard(root)
  assert(!nodes(root).some(node => node.props?.['data-source-comparison']))
  assert(!text(root).includes('源文比较：'))
  const original = entries(card).find(({ node }) => node.props?.['data-tm-source'] === 'original')
  assert.equal(text(original.node), segment.source)
  assert(!original.parents.some(parent => parent.type === 'details'), 'actual exact source is visible without expanding details')
  assert.match(text(card), /100%精确匹配可复用/)
  const details = select(card, node => node.type === 'details')
  assert.match(text(details), /1 个来源/)
  assert.match(text(details), /1 个译文变体/)
})

test('reuse safety distinguishes source identity from structural compatibility', () => {
  for (const [matchedSource, safety, label, warning] of [
    [segment.source, 'compatible', '可复用', undefined],
    [tm.matchedSource, 'compatible', '核对差异', true],
    [segment.source, 'review', '需检查', true],
    [tm.matchedSource, 'review', '需检查', true],
  ]) {
    const root = render({ tm: [{ ...tm, matchedSource, safety }] })
    const indicator = select(tmCard(root), node => node.props?.className === 'safety')
    assert.equal(text(indicator), label)
    assert.equal(indicator.props['data-review'], warning)
  }
})

test('raw repeated/nested tag code remains complete and safely escaped in source, diff and unchanged target', () => {
  const oldTag = '<g id="11" data-name="塔 &amp; Power">', newTag = '<g id="12" data-name="塔 &amp; Power">'
  const original = `${oldTag}<g id="7">Old😀</g></g> {name} {name} <img src="x" onerror="alert(1)"/>`
  const current = `${newTag}<g id="7">New😀</g></g> {name} {name} <img src="x" onerror="alert(1)"/>`
  const target = `${oldTag}<g id="7">Cible😀</g></g> {name} {name} <img src="x" onerror="alert(1)"/>`
  const input = props({ segment: { ...segment, source: current }, tm: [{ ...tm, matchedSource: original, target }], terms: [], currentTarget: target })
  const root = expand(React.createElement(ReferenceMatches, input)), card = tmCard(root)
  const comparison = select(card, node => node.props?.['data-source-comparison'])
  assert.equal(projection(comparison, 'ins'), original)
  assert.equal(projection(comparison, 'del'), current)
  assert(chips(select(comparison, node => node.type === 'del')).some(chip => chip.props['data-inline-raw'] === oldTag))
  assert(chips(select(comparison, node => node.type === 'ins')).some(chip => chip.props['data-inline-raw'] === newTag))
  for (const chip of chips(root)) assert.equal(text(chip), chip.props['data-inline-raw'], 'chip labels are full original code, never numeric substitutions')
  assert.equal(text(select(card, node => node.props?.['data-tm-target'] === true)), target)
  assert.equal(nodes(root).filter(node => node.type === 'img' || node.type === 'script' || node.type === 'g').length, 0)
  const html = renderToStaticMarkup(React.createElement(ReferenceMatches, input))
  assert(html.includes(`>${escape(oldTag)}</span>`))
  assert(html.includes(`>${escape(newTag)}</span>`))
  assert.doesNotMatch(html, /<img |<script|<g /)
})

test('source diff and chips both honor locale-scoped project tag families atomically', () => {
  const tagProfile = { families: [{ id: 'synthetic-fr', class: 'singleton', pattern: '\\[FR:[^\\]]+\\]', targetLocales: ['fr'] }] }
  const before = 'Use [FR:name=avant &amp; 塔] now', after = 'Use [FR:name=après &amp; 塔] now'
  const patch = { segment: { ...segment, source: after }, tm: [{ ...tm, matchedSource: before }], terms: [], tagProfile }
  const root = render(patch), comparison = select(root, node => node.props?.['data-source-comparison'])
  assert.equal(projection(comparison, 'ins'), before)
  assert.equal(projection(comparison, 'del'), after)
  const changed = entries(comparison).filter(({ node, parents }) => node.props?.['data-inline-raw'] && parents.some(parent => parent.type === 'del' || parent.type === 'ins'))
  assert.deepEqual(changed.map(({ node }) => node.props['data-inline-raw']), ['[FR:name=avant &amp; 塔]', '[FR:name=après &amp; 塔]'])
  const english = render({ ...patch, segment: { ...patch.segment, targetLocale: 'en-US' } })
  assert(!chips(english).some(chip => chip.props['data-inline-raw'].startsWith('[FR:')))
})

test('TM provenance, badges, warnings, differences and actual source share one shallow labelled disclosure', () => {
  const root = render(), card = tmCard(root)
  const allDetails = nodes(card).filter(node => node.type === 'details')
  assert.equal(allDetails.length, 1)
  const details = allDetails[0]
  assert.equal(details.props.open, undefined)
  assert.match(text(children(details)[0]), /匹配详情与 TM 原始文本.*2 条警告/)
  assert.equal(text(select(details, node => node.props?.['data-tm-source'] === 'original')), tm.matchedSource)
  assert.match(text(details), /3 个来源/)
  assert.match(text(details), /2 个译文变体/)
  for (const value of [...tm.badges, ...tm.warnings, ...tm.differences]) assert(text(details).includes(value))
  assert.match(text(details), /差异 2 项/)
  assert(!nodes(details).some(node => node.type === 'button'))
  for (const label of ['替换草稿', '插入草稿']) {
    const entry = entries(card).find(({ node }) => node.type === 'button' && text(node) === label)
    assert(!entry.parents.some(parent => parent.type === 'details'), 'target actions stay direct')
  }
  assert.equal(text(select(card, node => node.props?.className === 'provenance')), `来源：${tm.sourceLabel}`)
  assert.equal(nodes(root).filter(node => node.props?.className === 'diffGuide').length, 1)
})

test('direct TM replace/insert and TB insert forward their original full targets without adaptation or saving', () => {
  const applied = [], snapshot = JSON.stringify({ segment, tm, term })
  const root = render({ onApply: (...args) => applied.push(args) })
  button(tmCard(root), '替换草稿').props.onClick()
  button(tmCard(root), '插入草稿').props.onClick()
  button(termCard(root), '插入草稿').props.onClick()
  assert.deepEqual(applied, [[tm.target, 'replace', tm.id], [tm.target, 'insert', tm.id], [term.translation, 'insert']])
  assert.equal(JSON.stringify({ segment, tm, term }), snapshot)
})

test('archived, locked and editor-closed states disable all three apply actions with a shared visible semantic reason', () => {
  for (const [patch, expected] of [
    [{ readOnlyReason: 'archived' }, '项目已归档，仅可查看参考内容。'],
    [{ segment: { ...segment, locked: true }, readOnlyReason: 'locked' }, '当前句段已锁定，仅可查看参考内容。'],
    [{ segment: { ...segment, locked: true } }, '当前句段已锁定，仅可查看参考内容。'],
    [{ editorAvailable: false }, '先打开当前句段的译文编辑器，再插入参考内容。'],
    [{ editorAvailable: false, readOnlyReason: 'editor-closed' }, '先打开当前句段的译文编辑器，再插入参考内容。'],
  ]) {
    const applied = [], opened = []
    const root = render({ ...patch, onApply: (...args) => applied.push(args), onOpenTerms: () => opened.push(true) })
    const reason = select(root, node => node.props?.role === 'status')
    assert.equal(text(reason), expected)
    const applyButtons = nodes(root).filter(node => node.type === 'button' && ['替换草稿', '插入草稿'].includes(text(node)))
    assert.equal(applyButtons.length, 3)
    for (const action of applyButtons) {
      assert.equal(action.props.disabled, true)
      assert.equal(action.props['aria-describedby'], reason.props.id)
      action.props.onClick()
    }
    assert.equal(applied.length, 0)
    button(root, '打开术语库').props.onClick()
    assert.deepEqual(opened, [true], 'read-only references can still be browsed')
  }
  const active = render()
  assert(!nodes(active).some(node => node.props?.role === 'status'))
  for (const action of nodes(active).filter(node => node.type === 'button' && ['替换草稿', '插入草稿'].includes(text(node)))) {
    assert.equal(action.props.disabled, false)
    assert.equal(action.props['aria-describedby'], undefined)
  }
})

test('TB presents a paired source → translation row, significant status/conflict and all existing metadata at one level', () => {
  const card = termCard(render())
  const pair = select(card, node => node.props?.className === 'termPair')
  assert.equal(text(pair), `${term.term}→${term.translation}`)
  const status = entries(card).find(({ node }) => node.props?.className === 'termStatus')
  const conflict = entries(card).find(({ node }) => node.props?.className === 'conflict')
  assert.equal(text(status.node), '必须')
  assert.equal(text(conflict.node), '译文冲突')
  assert(!status.parents.some(parent => parent.type === 'details'))
  assert(!conflict.parents.some(parent => parent.type === 'details'))
  const details = nodes(card).filter(node => node.type === 'details')
  assert.equal(details.length, 1)
  assert.equal(text(children(details[0])[0]), '术语详情')
  for (const value of ['包含匹配', '区分大小写', segment.source.slice(term.start, term.end), term.module, term.category, '短术语匹配，请结合上下文核对。']) assert(text(details[0]).includes(value))
  const note = entries(card).find(({ node }) => node.props?.className === 'termNote')
  assert.equal(text(note.node), term.note)
  assert(!note.parents.some(parent => parent.type === 'details'), 'terminology context stays visible as a complete secondary note')
  assert(!nodes(details[0]).some(node => node.type === 'button'))
  for (const status of ['allowed', 'preferred', 'required', 'forbidden', 'deprecated']) {
    const root = render({ terms: [{ ...term, status, conflict: false, matchType: 'exact', caseSensitive: false, lowDiscrimination: false }] })
    assert.equal(select(termCard(root), node => node.props?.className === 'termStatus').props['data-status'], status)
    assert.match(text(termCard(root)), /精确匹配 · 不区分大小写/)
    assert(!nodes(termCard(root)).some(node => node.props?.className === 'conflict'))
    assert.equal(button(termCard(root), '插入草稿').props.disabled, false, 'term status is significant, not a new editing restriction')
  }
})

test('repeated term occurrences remain distinct; empty sections still expose termbase access', () => {
  const root = render({ terms: [term, { ...term, start: 30, end: 37 }] })
  assert.deepEqual(nodes(root).filter(node => node.type === 'h3').map(text), ['TM 1', 'TB 2'])
  assert.equal(nodes(root).filter(node => node.props?.['data-reference-term'] === term.id).length, 2)
  const empty = render({ tm: [], terms: [] })
  assert.equal(nodes(empty).filter(node => node.type === 'p' && text(node) === '没有匹配').length, 2)
  assert(!nodes(empty).some(node => node.type === 'article' || node.type === 'details'))
  assert(button(empty, '打开术语库'))
})

test('reference source and target share reading treatment, native tokens and complete raw code', () => {
  const css = readFileSync(new URL('ReferenceMatches.module.css', client), 'utf8')
  assert.doesNotThrow(() => parseCss({ filename: 'ReferenceMatches.module.css', code: Buffer.from(css), cssModules: true }))
  const knownCss = ['Workbench.module.css', 'EditorAssistance.module.css', 'Controls.module.css'].map(file => readFileSync(new URL(file, client), 'utf8')).join('\n')
  const tokens = value => [...value.matchAll(/var\((--[\w-]+)/g)].map(match => match[1])
  const known = new Set(tokens(knownCss))
  for (const token of tokens(css)) assert(known.has(token), `Unverified native theme token ${token}`)
  assert.doesNotMatch(css, /:root|:global|text-overflow:\s*ellipsis|overflow:\s*hidden/)
  assert.doesNotMatch(css, /(?:^|[;{])\s*width:\s*100%/)
  assert.match(css, /\.matches \.matchCard\s*\{[^}]*border:\s*0/)
  assert.match(css, /\.matches \.matchCard \+ \.matchCard\s*\{[^}]*border-top:/)
  assert.match(css, /\.matches \.termPair\s*\{[^}]*grid-template-columns:\s*minmax\(0, 1fr\) auto minmax\(0, 1fr\)/)
  const blocks = nodes(tmCard(render())).filter(node => node.type === 'div' && node.props.className === 'textBlock')
  assert.equal(blocks.length, 2, 'source and target use one shared block style')
  assert(blocks.every(block => children(block).some(node => node.type === 'p' && node.props.className === 'text')))
  assert.match(css, /\.matches \.text\s*\{[^}]*font-size:\s*13px;[^}]*font-weight:\s*400;[^}]*line-height:\s*1\.6/)
  assert.match(css, /\.matches \.textBlock\s*\{[^}]*padding:\s*6px 8px;[^}]*background:/)
  assert.match(css, /\.matches \.text del[^}]*text-decoration:\s*line-through/)
  assert.match(css, /\.matches \.text ins[^}]*text-decoration:\s*underline/)
  assert.match(css, /\.matches \.text del \[data-inline-raw\][^}]*text-decoration:\s*line-through/)
  assert.match(css, /\.matches \.text ins \[data-inline-raw\][^}]*text-decoration:\s*underline/)
  assert.match(css, /\.matches \.termNote[^}]*white-space:\s*pre-wrap/)
})
