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
  runInNewContext(ts.transpileModule(code, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, {
    exports: module,
    document: { querySelector: () => null, createElement: () => ({ dataset: {}, textContent: '' }), head: { appendChild: element => styles.push(element) } },
  })
  return { names: module.default, css: styles.map(style => style.textContent).join('\n'), watched }
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
