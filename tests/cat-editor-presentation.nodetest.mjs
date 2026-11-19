import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import ts from 'typescript'

const client = new URL('../packages/dsh-linguist/src/client/', import.meta.url)
const read = name => readFileSync(new URL(name, client), 'utf8')
const editorCss = read('TargetEditor.module.css')
const tokenCss = read('TokenEditor.module.css')
const inlineCss = read('InlineTaggedText.module.css')
const tokenEditor = ts.createSourceFile('TokenEditor.tsx', read('TokenEditor.tsx'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
const statusCss = read('CatStatusBar.module.css')
const editor = ts.createSourceFile('TargetEditor.tsx', read('TargetEditor.tsx'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
const status = ts.createSourceFile('CatStatusBar.tsx', read('CatStatusBar.tsx'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)

function rule(css, selector) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const match = css.match(new RegExp(`(?:^|\\n)${escaped}\\s*\\{([^}]+)\\}`))
  assert(match, `Missing CSS rule ${selector}`)
  return match[1]
}

function element(source, className) {
  let found
  const visit = node => {
    if (ts.isJsxElement(node) && node.openingElement.attributes.properties.some(attribute =>
      ts.isJsxAttribute(attribute) && attribute.name.getText(source) === 'className'
      && attribute.initializer?.getText(source) === `{styles.${className}}`)) found = node
    ts.forEachChild(node, visit)
  }
  visit(source)
  assert(found, `Missing JSX element ${className}`)
  return found
}

test('ordinary unsaved drafts have their own neutral status while blocking feedback stays distinct', () => {
  const draft = element(editor, 'draftStatus')
  assert.match(draft.getText(editor), /t\("未保存"\)/)
  assert.match(editor.getFullText(), /\{dirty && \(\s*<span className=\{styles\.draftStatus\}>/)
  const draftStyle = rule(editorCss, '.draftStatus')
  assert.match(draftStyle, /color:\s*var\(--dsw-alias-label-secondary\)/)
  assert.match(draftStyle, /background:\s*var\(--dsw-alias-bg-layer-2\)/)
  assert.doesNotMatch(draftStyle, /state-(?:error|warn)-primary/)
  assert.match(rule(editorCss, '.warning'), /--dsw-alias-state-error-primary/)
  assert.match(rule(editorCss, '.errorHelp'), /--dsw-alias-state-error-primary/)
  assert.match(rule(editorCss, '.caution'), /--dsw-alias-state-warn-primary/)
})

test('target editing keeps the shared reading rhythm and direct native confirmation', () => {
  const surface = rule(tokenCss, '.surface')
  assert.match(surface, /font-size:\s*14px\s*;/)
  assert.match(surface, /line-height:\s*1\.6\s*;/)
  assert.match(surface, /min-height:\s*76px\s*;/)
  assert.match(surface, /max-height:\s*max\(76px, 40vh\)\s*;/)
  assert.match(surface, /white-space:\s*pre-wrap\s*;/)
  assert.match(surface, /overflow-y:\s*auto\s*;/)
  assert.doesNotMatch(editor.getFullText(), /<textarea\b|textareaRef|autoSizeTargetTextarea/)
  assert.match(tokenEditor.getFullText(), /contentEditable=\{!props\.readOnly \|\| composing\.current\}/)
  assert.match(tokenEditor.getFullText(), /spellCheck=\{props\.spellCheck \?\? true\}/)
  assert.match(tokenEditor.getFullText(), /lang=\{props\.lang\}/)
  assert.doesNotMatch(rule(editorCss, '.editor'), /\bborder(?:-width)?:/)
  const source = editor.getFullText()
  assert.match(source, /<Button\s+type="button"\s+aria-label=\{t\('\{confirmLabel\}并前进', \{ confirmLabel \}\)\}\s+aria-keyshortcuts="Meta\+Enter Control\+Enter"\s+onClick=\{\(\) => void save\(true\)\}\s+disabled=\{!canConfirm\}\s+variant="primary"/)
})

test('status keeps task state and statistics in separate localized wrapping groups', () => {
  const task = element(status, 'taskState')
  const statistics = element(status, 'statistics')
  assert.equal(task.parent, statistics.parent)
  assert.match(task.openingElement.getText(status), /role="group" aria-label=\{t\('任务状态'\)\}/)
  assert.match(statistics.openingElement.getText(status), /role="group" aria-label=\{t\('工作统计'\)\}/)
  for (const name of ['scope', 'progress']) assert.match(task.getText(status), new RegExp(`styles\\.${name}`))
  for (const name of ['characters', 'coverage', 'error']) assert.match(statistics.getText(status), new RegExp(`styles\\.${name}`))
  assert.match(rule(statusCss, '.statusBar'), /flex-wrap:\s*wrap\s*;/)
  assert.doesNotMatch(rule(statusCss, '.statusBar'), /flex-direction:\s*column\s*;/)
  assert.match(rule(statusCss, '.taskState, .statistics'), /flex-wrap:\s*wrap\s*;/)
  assert.match(rule(statusCss, '.taskState'), /font-size:\s*12px\s*;/)
  assert.match(rule(statusCss, '.statistics'), /font-size:\s*11px\s*;/)
  assert.doesNotMatch(statusCss, /\.scope\s*\{[^}]*display:\s*none/)
})

test('ordinary space dots center their own glyph over the original space in either direction', () => {
  const dot = rule(inlineCss, '.invisible[data-invisible-glyph="·"]::before')
  assert.match(dot, /left:\s*50%/)
  assert.match(dot, /right:\s*auto/)
  assert.match(dot, /transform:\s*translateX\(-50%\)/)
})

test('editor and status presentation parses and uses theme-based colors', () => {
  for (const source of [editor, tokenEditor, status]) assert.equal(source.parseDiagnostics.length, 0, source.fileName)
  for (const source of [editorCss, tokenCss, inlineCss, statusCss]) {
    assert.doesNotMatch(source, /#[\da-f]{3,8}\b|\b(?:rgb|hsl)a?\s*\(/i)
  }
})
