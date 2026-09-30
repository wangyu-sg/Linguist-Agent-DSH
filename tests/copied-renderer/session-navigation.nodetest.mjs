import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'
import * as workspacePaths from '../../packages/dsh-linguist/node_modules/@deepseek-ai/dsh-util-workspace-path/lib/index.js'
import { createRequire } from 'node:module'

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
  let catPane
  let sessionIds = ['execution-session']
  const openedSessions = []
  const skills = { skills: [{ name: 'synthetic-skill', description: 'Synthetic', modelInvocable: true }] }
  let skillResult = { ok: true, value: skills }
  const ctx = {
    effect(register, label) { if (label === 'linguist: CAT editor drafts') disposeDrafts = register() },
    locale: { bind: () => text => text },
    slots: {
      inject: (_name, register) => register(),
      register: (key, render) => { registrations.set(key.name, render); if (key.key === '@linguist/dsh-client-cat') catPane = render },
    },
    layout: {
      selectPanel: panel => { selectedPanel = panel; navigation.abort() },
      beginNavigation: () => { navigation.abort(); navigation = new AbortController(); return navigation.signal },
    },
    uiWorkspace: { openSession: id => { openedSessions.push(id); navigation.abort() }, pickDirectory: async () => pickedDirectory },
    workspaces: { list: { getSnapshot: () => ({ items: [{ workspaceId: 'workspace-A', path: '/synthetic/workspace' }] }) } },
    sidebarRight: {
      mounted: { getSnapshot: () => mounted, subscribe: listener => { listeners.add(listener); return () => listeners.delete(listener) } },
      openResourceIn: (...args) => opened.push(args),
    },
    sessions: { create: () => new Promise(resolve => { completeCreate = resolve }), refresh: async () => {}, list: { getSnapshot: () => ({ ids: sessionIds }) } },
    remote: { skills: { list: async ({ sessionId }, signal) => { assert.equal(sessionId, 'synthetic-A'); assert(signal instanceof AbortSignal); return skillResult } } },
  }
  const components = ['CatWorkbench', 'BatchPreview', 'ComposerContextChips', 'ProjectsPage', 'ProjectCapabilities', 'SessionCopyPage', 'WorkingCopyPage']
  const exports = {}
  const source = readFileSync(new URL('../../packages/dsh-linguist/src/client/index.ts', import.meta.url), 'utf8')
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
  runInNewContext(code, { exports, setTimeout, clearTimeout, require: name => {
    if (name === 'react') return { createElement: (_type, props, child) => ({ props, child }) }
    if (name === './api') return { bindSession: async value => value, getBinding: async () => undefined }
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
  const executionNavigation = catPane({ sessionId: 'synthetic-A' }).child.props.onOpenSession
  await executionNavigation('execution-session')
  assert.equal(openedSessions.at(-1), 'execution-session')
  sessionIds = []
  const openCount = openedSessions.length
  await assert.rejects(executionNavigation('execution-session'), /执行会话已不存在或已归档/)
  assert.equal(openedSessions.length, openCount, 'missing execution must leave the current Session in place')
  assert.equal(draftsCleared, false)
  disposeDrafts()
  assert.equal(draftsCleared, true)
})

test('a copied Session can retry navigation without creating a second copy', async () => {
  const require = createRequire(new URL('../../packages/dsh-linguist/package.json', import.meta.url))
  const React = require('react')
  const source = readFileSync(new URL('../../packages/dsh-linguist/src/client/SessionCopyPage.tsx', import.meta.url), 'utf8')
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.React, target: ts.ScriptTarget.ES2022 } }).outputText
  const projects = [{ id: 'source' }, { id: 'target' }]
  const state = [{ projectId: 'source', workMode: 'cat' }, projects, 'target', { eligible: true, mode: 'fork' }, false, false, false, undefined, '']
  let cursor = 0, copies = 0, navigations = 0
  const exports = {}
  runInNewContext(code, { exports, require: name => {
    if (name === 'react') return { ...React, useEffect() {}, useState() { const index = cursor++; return [state[index], value => { state[index] = value }] } }
    if (name === '@deepseek-ai/dsh-client-ui-primitives') return { Button: 'button' }
    if (name === './api') return { required: async (operation, input) => {
      assert.equal(operation, 'linguistSessionsCopyToProject')
      assert.equal(input.targetProjectId, 'target')
      copies++
      return { sessionId: 'created-copy', projectId: 'target', mode: 'fork' }
    } }
    if (name === './ui-locale') return { useT: () => value => value }
    if (name === './project-errors') return { describeProjectError: String }
    if (name.endsWith('.module.css')) return { default: {} }
    throw new Error(`Unexpected copy page import: ${name}`)
  } })
  const nodes = node => typeof node !== 'object' || node === null ? [] : [node, ...React.Children.toArray(node.props?.children).flatMap(nodes)]
  const render = () => {
    cursor = 0
    return nodes(exports.SessionCopyPage({ sessionId: 'source-session', onCopied: async result => {
      assert.equal(result.sessionId, 'created-copy')
      if (++navigations === 1) throw new Error('Synthetic navigation failure')
    } })).find(node => node.type === 'button')
  }
  assert.equal(render().props.disabled, false)
  render().props.onClick()
  await new Promise(resolve => setImmediate(resolve))
  const retry = render()
  assert.equal(retry.props.children, '打开已创建会话')
  assert.equal(retry.props.disabled, false)
  assert.match(state.at(-1), /Synthetic navigation failure/)
  retry.props.onClick()
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(copies, 1)
  assert.equal(navigations, 2)
  assert.equal(state.at(-1), '')
})
