import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { runInNewContext } from 'node:vm'
import test from 'node:test'
import ts from 'typescript'

const packageRoot = fileURLToPath(new URL('../../packages/dsh-linguist/', import.meta.url))
const require = createRequire(join(packageRoot, 'package.json'))
const configPath = join(packageRoot, 'tsdown.config.ts')
const clientRoot = join(packageRoot, 'src/client')
const exports = {}
runInNewContext(ts.transpileModule(readFileSync(configPath, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
}).outputText, { exports, process, require: name => name === 'tsdown' ? { defineConfig: value => value } : require(name) })
const plugin = exports.default.find(config => config.platform === 'browser').plugins.find(plugin => plugin.name === 'linguist-css-modules')

async function loadCss(name) {
  const watched = []
  const id = await plugin.resolveId(`./${name}`, join(clientRoot, 'ProjectsPage.tsx'))
  const code = await plugin.load.call({ addWatchFile: path => watched.push(path) }, id)
  const styles = []
  const module = {}
  const compiled = ts.transpileModule(code, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
  runInNewContext(compiled, {
    exports: module,
    document: { querySelector: () => null, createElement: () => ({ dataset: {}, textContent: '' }), head: { appendChild: element => styles.push(element) } },
  })
  return { names: module.default, css: styles.map(style => style.textContent).join('\n'), watched, compiled }
}

function styleDocument(initial = []) {
  const elements = [...initial], counts = { created: 0, appended: 0 }
  const document = {
    querySelector(selector) {
      assert.match(selector, /^style\[data-linguist-css="[^"]+"\]$/)
      const tag = JSON.parse(selector.slice('style[data-linguist-css='.length, -1))
      return elements.find(element => element.dataset.linguistCss === tag) ?? null
    },
    createElement(name) { assert.equal(name, 'style'); counts.created++; return styleElement() },
    head: { appendChild(element) { assert(element.dataset.linguistCss); assert(element.textContent); counts.appended++; elements.push(element) } },
  }
  return { document, elements, counts }
}

function styleElement(tag, initial = '') {
  let text = initial
  return { dataset: tag ? { linguistCss: tag } : {}, writes: 0,
    get textContent() { return text }, set textContent(value) { this.writes++; text = value } }
}

function executeCss(result, document) {
  const module = {}
  runInNewContext(result.compiled, { exports: module, document })
  return module.default
}

function includesClass(value, expected) {
  assert(value.split(/\s+/).includes(expected), `${value} must compose ${expected}`)
}

test('real client CSS loader emits shared rules and complete external/local composed class names', async () => {
  const shared = await loadCss('Controls.module.css')
  const projects = await loadCss('ProjectsPage.module.css')
  const [surface] = shared.names.surface.split(/\s+/)
  includesClass(projects.names.page, surface)
  includesClass(projects.names.workspacePicker, shared.names.field)
  includesClass(projects.names.toolbar, shared.names.toolbar)
  for (const className of shared.names.modalContent.split(/\s+/)) includesClass(projects.names.dialog, className)
  includesClass(shared.names.modalContent, surface)
  assert(projects.css.includes(`.${surface} select`), 'final injected CSS must contain the shared select rules')
  assert(projects.css.includes(`.${shared.names.field}{`), 'final injected CSS must contain shared vertical field layout')
  assert(projects.css.includes(`.${shared.names.toolbar}{`), 'final injected CSS must contain shared toolbar layout')
  assert(projects.watched.some(path => resolve(path) === join(clientRoot, 'Controls.module.css')), 'shared CSS must be watched by the native bundler')
})

test('real generated CSS loader updates an existing style in place and preserves its position and name', async () => {
  const result = await loadCss('InlineTaggedText.module.css')
  const before = styleElement('other/before', 'before'), existing = styleElement('@linguist/dsh-plugin/InlineTaggedText.module.css', 'old CSS'), after = styleElement('other/after', 'after')
  const fixture = styleDocument([before, existing, after])
  const names = executeCss(result, fixture.document)
  assert.equal(existing.textContent, result.css)
  assert(existing.textContent.includes(`.${names.underline}{`), 'hot application adds the actual emitted underline class to the old style node')
  assert.deepEqual(fixture.elements, [before, existing, after], 'updating text must not append, remove or reorder styles')
  assert.equal(existing.dataset.linguistCss, '@linguist/dsh-plugin/InlineTaggedText.module.css')
  assert.equal(existing.writes, 1)
  assert.deepEqual(fixture.counts, { created: 0, appended: 0 })
  assert.equal(before.textContent, 'before'); assert.equal(after.textContent, 'after')
})

test('real generated CSS loader creates and appends a named style when first loaded', async () => {
  const result = await loadCss('InlineTaggedText.module.css'), before = styleElement('other/before', 'before')
  const fixture = styleDocument([before])
  const names = executeCss(result, fixture.document)
  assert.deepEqual(fixture.counts, { created: 1, appended: 1 })
  assert.equal(fixture.elements.length, 2)
  assert.strictEqual(fixture.elements[0], before)
  assert.equal(fixture.elements[1].dataset.linguistCss, '@linguist/dsh-plugin/InlineTaggedText.module.css')
  assert.equal(fixture.elements[1].textContent, result.css)
  assert.equal(names.underline, result.names.underline)
  assert.doesNotThrow(() => executeCss(result, undefined), 'the generated module remains safe without a browser document')
})

test('reexecuting the real generated CSS loader is idempotent after initial creation or an existing-style update', async () => {
  const result = await loadCss('InlineTaggedText.module.css')
  for (const existing of [undefined, styleElement('@linguist/dsh-plugin/InlineTaggedText.module.css', 'old CSS')]) {
    const fixture = styleDocument(existing ? [existing] : [])
    executeCss(result, fixture.document)
    const element = fixture.elements[0], writes = element.writes, counts = { ...fixture.counts }
    executeCss(result, fixture.document); executeCss(result, fixture.document)
    assert.equal(element.textContent, result.css)
    assert.equal(writes, 1)
    assert.equal(element.writes, writes, 'identical CSS must not rewrite textContent')
    assert.deepEqual(fixture.counts, counts)
    assert.equal(fixture.elements.length, 1)
    assert.strictEqual(fixture.elements[0], element)
  }
})

test('every real CSS Module composition resolves to emitted class names without unresolved dependencies', async () => {
  const shared = await loadCss('Controls.module.css')
  for (const name of readdirSync(clientRoot).filter(name => name.endsWith('.module.css'))) {
    const source = readFileSync(join(clientRoot, name), 'utf8')
    const result = await loadCss(name)
    for (const match of source.matchAll(/\.([\w-]+)\s*\{\s*composes:\s+([\w-]+)(?:\s+from\s+['"]\.\/Controls\.module\.css['"])?\s*;/g)) {
      const composition = match[0].includes(' from ') ? shared.names[match[2]] : result.names[match[2]]
      for (const className of composition.split(/\s+/)) {
        includesClass(result.names[match[1]], className)
        assert(result.css.includes(`.${className}`), `${name} must inject CSS for composed ${className}`)
      }
    }
    assert(!/\bcomposes\s*:/.test(result.css), `${name} left unresolved CSS Modules instructions in browser CSS`)
  }
})
