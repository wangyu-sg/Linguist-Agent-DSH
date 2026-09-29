import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'

// Execute the real Client registration without mounting React or a desktop window.
test('native navigation cancels pending LA opens and late session creation', async () => {
  const registrations = new Map()
  const listeners = new Set()
  const opened = []
  let mounted
  let navigation = new AbortController()
  let completeCreate
  const ctx = {
    effect() {},
    locale: { bind: () => text => text },
    slots: {
      inject: (_name, register) => register(),
      register: (key, render) => { registrations.set(key.name, render) },
    },
    layout: {
      selectPanel: () => navigation.abort(),
      beginNavigation: () => { navigation.abort(); navigation = new AbortController(); return navigation.signal },
    },
    uiWorkspace: { openSession: () => navigation.abort() },
    sidebarRight: {
      mounted: { getSnapshot: () => mounted, subscribe: listener => { listeners.add(listener); return () => listeners.delete(listener) } },
      openResourceIn: (...args) => opened.push(args),
    },
    sessions: { create: () => new Promise(resolve => { completeCreate = resolve }) },
  }
  const components = ['CatWorkbench', 'BatchPreview', 'ComposerContextChips', 'ProjectsPage', 'SessionCopyPage', 'WorkingCopyPage']
  const exports = {}
  const source = readFileSync(new URL('../../packages/dsh-linguist/src/client/index.ts', import.meta.url), 'utf8')
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
  runInNewContext(code, { exports, setTimeout, clearTimeout, require: name => {
    if (name === 'react') return { createElement: (_type, props, child) => ({ props, child }) }
    if (name === './api') return { bindSession: async value => value }
    if (name === './ui-locale') return {}
    if (name === './Native.module.css') return { default: {} }
    if (name === './CatToolResult') return { catToolNames: [] }
    if (name === './cat-navigation' || name === '@deepseek-ai/dsh-util-workspace-path' || name === '@deepseek-ai/dsh-client-ui-primitives') return {}
    if (components.some(component => name === `./${component}`)) return {}
    throw new Error(`Unexpected Client import: ${name}`)
  } })
  exports.apply(ctx)
  const { onOpenSession, onEnter } = registrations.get('main')().child.props
  const binding = { sessionId: 'synthetic-A', projectId: 'project-A', workMode: 'cat' }
  const pending = onOpenSession(binding)
  assert.equal(listeners.size, 1)
  ctx.layout.selectPanel('another-panel')
  await pending
  assert.equal(listeners.size, 0)
  mounted = binding.sessionId
  listeners.forEach(listener => listener())
  assert.equal(opened.length, 0)
  await onOpenSession(binding)
  assert.equal(opened.length, 1)
  assert.equal(opened[0][0], binding.sessionId)
  const entering = onEnter({ projectId: 'project-B', workspaceId: 'workspace-B', role: 'translator', workMode: 'cat' })
  ctx.layout.selectPanel('another-panel')
  completeCreate('synthetic-B')
  await entering
  assert.equal(opened.length, 1)
  assert.equal(listeners.size, 0)
})
