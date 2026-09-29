import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'
import * as workspacePaths from '../../packages/dsh-linguist/node_modules/@deepseek-ai/dsh-util-workspace-path/lib/index.js'

// Execute the real Client registration without mounting React or a desktop window.
test('native navigation cancels pending LA opens and late session creation', async () => {
  const registrations = new Map()
  const listeners = new Set()
  const opened = []
  let mounted
  let navigation = new AbortController()
  let completeCreate
  let pickedDirectory = '/synthetic/workspace/backups/check'
  let selectedPanel
  let disposeDrafts
  let draftsCleared = false
  const skills = { skills: [{ name: 'synthetic-skill', description: 'Synthetic', modelInvocable: true }] }
  let skillResult = { ok: true, value: skills }
  const ctx = {
    effect(register, label) { if (label === 'linguist: CAT editor drafts') disposeDrafts = register() },
    locale: { bind: () => text => text },
    slots: {
      inject: (_name, register) => register(),
      register: (key, render) => { registrations.set(key.name, render) },
    },
    layout: {
      selectPanel: panel => { selectedPanel = panel; navigation.abort() },
      beginNavigation: () => { navigation.abort(); navigation = new AbortController(); return navigation.signal },
    },
    uiWorkspace: { openSession: () => navigation.abort(), pickDirectory: async () => pickedDirectory },
    workspaces: { list: { getSnapshot: () => ({ items: [{ workspaceId: 'workspace-A', path: '/synthetic/workspace' }] }) } },
    sidebarRight: {
      mounted: { getSnapshot: () => mounted, subscribe: listener => { listeners.add(listener); return () => listeners.delete(listener) } },
      openResourceIn: (...args) => opened.push(args),
    },
    sessions: { create: () => new Promise(resolve => { completeCreate = resolve }) },
    remote: { skills: { list: async ({ sessionId }, signal) => { assert.equal(sessionId, 'synthetic-A'); assert(signal instanceof AbortSignal); return skillResult } } },
  }
  const components = ['CatWorkbench', 'BatchPreview', 'ComposerContextChips', 'ProjectsPage', 'ProjectCapabilities', 'SessionCopyPage', 'WorkingCopyPage']
  const exports = {}
  const source = readFileSync(new URL('../../packages/dsh-linguist/src/client/index.ts', import.meta.url), 'utf8')
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
  runInNewContext(code, { exports, setTimeout, clearTimeout, require: name => {
    if (name === 'react') return { createElement: (_type, props, child) => ({ props, child }) }
    if (name === './api') return { bindSession: async value => value }
    if (name === './ui-locale') return {}
    if (name === './composer-reference') return {}
    if (name === './cat-editor-state') return { clearCatEditorStates: () => { draftsCleared = true } }
    if (name === './Native.module.css') return { default: {} }
    if (name === './CatToolResult') return { catToolNames: [] }
    if (name === '@deepseek-ai/dsh-util-workspace-path') return workspacePaths
    if (name === '@deepseek-ai/dsh-client-ui-plugin-manager/client') return { PANEL_ID: 'plugins' }
    if (name === './cat-navigation' || name === '@deepseek-ai/dsh-client-ui-primitives') return {}
    if (components.some(component => name === `./${component}`)) return {}
    throw new Error(`Unexpected Client import: ${name}`)
  } })
  exports.apply(ctx)
  const { onOpenSession, onEnter, onPickDirectory, capabilities } = registrations.get('main')().child.props
  assert.equal(await capabilities.props.loadSkills('synthetic-A', new AbortController().signal), skills)
  skillResult = { ok: false, error: { message: 'Native catalog unavailable' } }
  await assert.rejects(capabilities.props.loadSkills('synthetic-A', new AbortController().signal), /Native catalog unavailable/)
  capabilities.props.onOpenPlugins()
  assert.equal(selectedPanel, 'plugins')
  assert.equal(capabilities.props.onOpenFiles, undefined, 'project list must not create a Session to open files')
  assert.equal(await onPickDirectory('workspace-A'), 'backups/check')
  pickedDirectory = '/synthetic/workspace'
  assert.equal(await onPickDirectory('workspace-A'), '.')
  pickedDirectory = null
  assert.equal(await onPickDirectory('workspace-A'), null)
  pickedDirectory = '/synthetic/workspace-other/backup'
  await assert.rejects(onPickDirectory('workspace-A'), /Workspace/)
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
  assert.equal(draftsCleared, false)
  disposeDrafts()
  assert.equal(draftsCleared, true)
})
