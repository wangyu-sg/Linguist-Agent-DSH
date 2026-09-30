import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import ts from 'typescript'

const client = new URL('../../packages/dsh-linguist/src/client/', import.meta.url)

test('native Input owns its single border; plugin CSS styles only native select surfaces', () => {
  const native = readFileSync(new URL('../../packages/dsh-linguist/node_modules/@deepseek-ai/dsh-client-ui-primitives/lib/Input.module.css', import.meta.url), 'utf8')
  assert.match(native, /\.wrap\s*\{[^}]*border:/)
  assert.match(native, /\.input\s*\{[^}]*border: none/)
  for (const name of readdirSync(client).filter(name => name.endsWith('.css'))) {
    const css = readFileSync(new URL(name, client), 'utf8')
    for (const rule of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      if (!/\bborder(?:-width)?\s*:/.test(rule[2])) continue
      for (const selector of rule[1].split(',')) {
        assert(!/\binput\b/.test(selector) || selector.includes('::file-selector-button'), `${name}: ${selector.trim()} adds a second border inside native Input`)
      }
    }
  }
})

test('project dialogs bound long content and keep in-flight migration visible', () => {
  const page = readFileSync(new URL('ProjectsPage.tsx', client), 'utf8')
  const controls = readFileSync(new URL('Controls.module.css', client), 'utf8')
  assert.equal((page.match(/className=\{styles\.modal\} contentClassName=\{styles\.dialog\}/g) ?? []).length, 4)
  assert.match(controls, /\.modal\s*\{[^}]*max-height: 100%/)
  assert.match(controls, /\.modalContent\s*\{[^}]*min-height: 0;[^}]*overflow-y: auto/)
  assert.match(page, /LegacyMigrationPanel[^>]*onRunningChange=\{setBusy\}/)
  assert.match(page, /<fieldset disabled=\{busy\}[^>]*><LegacyMigrationPanel/)
  assert.match(page, /open=\{dialog === 'import'\} onClose=\{\(\) => \{ if \(!busy\)/)
})

test('native form controls own visible containers', () => {
  let count = 0
  for (const name of readdirSync(client).filter(name => /\.tsx?$/.test(name))) {
    const file = ts.createSourceFile(name, readFileSync(new URL(name, client), 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
    const visit = node => {
      if (ts.isJsxSelfClosingElement(node) && node.tagName.getText(file) === 'input') {
        const type = node.attributes.properties.find(prop => ts.isJsxAttribute(prop) && prop.name.text === 'type')?.initializer?.text ?? 'text'
        assert(['checkbox', 'radio', 'file', 'range', 'color'].includes(type), `${name}: use native Input for ${type} so its border survives without descendant CSS`)
      }
      if ((ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) && node.tagName.getText(file) === 'Button') {
        count++
        const variant = node.attributes.properties.find(prop => ts.isJsxAttribute(prop) && prop.name.text === 'variant')
        assert(variant, `${name}:${file.getLineAndCharacterOfPosition(node.pos).line + 1}: action button defaults to invisible ghost container`)
        const size = node.attributes.properties.find(prop => ts.isJsxAttribute(prop) && prop.name.text === 'size')
        assert.equal(size?.initializer?.text, 'sm', `${name}:${file.getLineAndCharacterOfPosition(node.pos).line + 1}: button must use the shared small size`)
      }
      ts.forEachChild(node, visit)
    }
    visit(file)
  }
  assert(count > 20)
})
