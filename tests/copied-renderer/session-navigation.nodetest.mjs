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
  await pending
  assert.equal(listeners.size, 0, 'ordinary bound-Session opening leaves the native rightbar presentation untouched')
  assert.equal(opened.length, 0, 'opening a saved Session must not replace Files or preview with CAT')
  const revealing = onEnter({ projectId: 'project-A', workspaceId: 'workspace-A', role: 'general', workMode: 'cat' })
  completeCreate('synthetic-A')
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(listeners.size, 1)
  ctx.layout.selectPanel('another-panel')
  await revealing
  assert.equal(listeners.size, 0)
  mounted = binding.sessionId
  listeners.forEach(listener => listener())
  assert.equal(opened.length, 0)
  await onOpenSession(binding)
  assert.equal(opened.length, 0)
  const explicitEntry = onEnter({ projectId: 'project-A', workspaceId: 'workspace-A', role: 'general', workMode: 'cat' })
  completeCreate('synthetic-A')
  await explicitEntry
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

test('opening a project reuses native CAT history, lazily ensures one Session, and rejects stale navigation and read errors', async () => {
  const registrations = new Map(), listeners = new Set(), bindings = new Map()
  const opened = [], resources = [], creates = [], binds = [], navigationRequests = []
  let mounted, navigation = new AbortController(), createResult, projectResult, bindingError
  const workspace = { workspaceId: 'workspace-A', path: '/synthetic/workspace' }
  const byId = {}, sessionIds = []
  const ctx = {
    effect(register, label) { if (label === 'linguist: project Session visits') register() },
    locale: { bind: () => text => text },
    slots: { inject: (_name, register) => register(), register: (key, render) => registrations.set(key.name, render) },
    layout: { selectPanel() { navigation.abort() }, beginNavigation() { navigation.abort(); navigation = new AbortController(); return navigation.signal } },
    uiWorkspace: { openSession(id) { opened.push(id); navigation.abort(); mounted = id; listeners.forEach(listener => listener()) } },
    workspaces: { list: { getSnapshot: () => ({ items: [workspace] }) } },
    sidebarRight: { mounted: { getSnapshot: () => mounted, subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener) } }, openResourceIn: (...args) => resources.push(args) },
    sessions: { refresh: async () => {}, list: { getSnapshot: () => ({ ids: sessionIds, byId, phase: 'ready' }) }, create: async input => { creates.push(input); const id = await (createResult ?? Promise.resolve(`created-${creates.length}`)); addSession(id, {}, 100); return id } },
  }
  function addSession(id, binding, updatedAt) { if (!sessionIds.includes(id)) sessionIds.push(id); byId[id] = { id, cwd: workspace.path, updatedAt }; if (binding.projectId) bindings.set(id, { sessionId: id, workspaceId: workspace.workspaceId, workMode: 'cat', ...binding }) }
  function visit(id) { mounted = id; listeners.forEach(listener => listener()); mounted = undefined }
  const api = {
    async getBinding(id) { if (bindingError === id) throw new Error('Synthetic binding read failure'); return bindings.get(id) },
    async bindSession(value, workspaceId) { binds.push(value); const binding = { ...value, workspaceId }; bindings.set(value.sessionId, binding); return binding },
    async required(operation, input) { assert.equal(operation, 'linguistProjectsOpen'); return await (projectResult ?? { project: { id: input.projectId, workspaceId: workspace.workspaceId }, health: { projectId: input.projectId, healthy: true } }) },
  }
  const exports = {}, components = ['CatWorkbench', 'BatchPreview', 'ComposerContextChips', 'ProjectsPage', 'ProjectCapabilities', 'SessionCopyPage', 'WorkingCopyPage']
  const code = ts.transpileModule(readFileSync(new URL('../../packages/dsh-linguist/src/client/index.ts', import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
  runInNewContext(code, { exports, setTimeout, clearTimeout, require: name => {
    if (name === 'react') return { createElement: (_type, props, child) => ({ props, child }) }
    if (name === './api') return api
    if (name === './Native.module.css') return { default: {} }
    if (name === './CatToolResult') return { catToolNames: [] }
    if (name === '@deepseek-ai/dsh-util-workspace-path') return workspacePaths
    if (name === '@deepseek-ai/dsh-client-ui-plugin-manager/client') return { PANEL_ID: 'plugins' }
    if (name === './cat-navigation') return { requestCatNavigation: value => navigationRequests.push(value) }
    if (name === './ui-locale' || name === './composer-reference' || name === './cat-editor-state' || name === '@deepseek-ai/dsh-client-ui-primitives' || components.some(component => name === `./${component}`)) return {}
    throw new Error(`Unexpected Client import: ${name}`)
  } })
  exports.apply(ctx)
  const { onOpenProject } = registrations.get('main')().child.props
  assert.equal(typeof onOpenProject, 'function', 'project names need an ensure/open callback distinct from explicit Session creation')
  addSession('cat-current', { projectId: 'project-A', role: 'reviewer' }, 1)
  addSession('cat-newer', { projectId: 'project-A', role: 'proofreader' }, 999)
  visit('cat-current')
  await onOpenProject('project-A')
  assert.equal(opened.at(-1), 'cat-current', 'current project Session wins over most recently updated')
  assert.equal(creates.length, 0); assert.equal(binds.length, 0)
  visit('cat-newer'); visit('cat-current')
  addSession('ordinary', {}, 1000); visit('ordinary')
  await onOpenProject('project-A')
  assert.equal(opened.at(-1), 'cat-current', 'observed native MRU wins over update timestamp')
  await onOpenProject('project-A', 'qa')
  assert.deepEqual(JSON.parse(JSON.stringify(navigationRequests.at(-1))), { sessionId: 'cat-current', projectId: 'project-A', dock: 'qa' })
  assert.equal(creates.length, 0, 'project history reuses its native CAT Session')
  await onOpenProject('empty-project')
  assert.equal(creates.length, 1)
  assert.deepEqual(JSON.parse(JSON.stringify(binds[0])), { sessionId: 'created-1', projectId: 'empty-project', role: 'general', workMode: 'cat' })
  await onOpenProject('empty-project'); assert.equal(creates.length, 1)
  projectResult = Promise.reject(new Error('Synthetic ProjectOpen failure'))
  await assert.rejects(onOpenProject('failed-project'), /ProjectOpen failure/); assert.equal(creates.length, 1)
  projectResult = { project: { id: 'unhealthy', workspaceId: workspace.workspaceId }, health: { projectId: 'unhealthy', healthy: false } }
  await assert.rejects(onOpenProject('unhealthy'), /需要修复/); assert.equal(creates.length, 1)
  projectResult = undefined; bindingError = 'created-1'
  await assert.rejects(onOpenProject('unread-project'), /binding read failure/); assert.equal(creates.length, 1)
  bindingError = undefined
  let resolveCreate
  createResult = new Promise(resolve => { resolveCreate = resolve })
  const first = onOpenProject('concurrent-project'), second = onOpenProject('concurrent-project')
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(creates.length, 2, 'same-project concurrent opens share one ensure/create')
  resolveCreate('concurrent-session'); await Promise.all([first, second]); createResult = undefined
  assert.equal(opened.filter(id => id === 'concurrent-session').length, 1)
  let resolveProject
  projectResult = new Promise(resolve => { resolveProject = resolve })
  const late = onOpenProject('late-project'), count = opened.length
  ctx.layout.selectPanel('another-panel')
  resolveProject({ project: { id: 'late-project', workspaceId: workspace.workspaceId }, health: { projectId: 'late-project', healthy: true } })
  await late; projectResult = undefined
  assert.equal(opened.length, count); assert.equal(creates.length, 2)
  createResult = new Promise(resolve => { resolveCreate = resolve })
  const lateCreate = onOpenProject('late-create')
  await new Promise(resolve => setImmediate(resolve))
  await onOpenProject('project-A')
  const current = opened.at(-1)
  resolveCreate('late-created'); await lateCreate
  assert.equal(opened.at(-1), current, 'late Session completion cannot steal another project navigation')
  assert.equal(resources.at(-1)[0], current)
  createResult = undefined
  const { onNewTask } = registrations.get('conversation.session.header.utilities')({ sessionId: 'cat-current' }).child.props
  const sourceBinding = bindings.get('cat-current')
  await onNewTask(sourceBinding, 'general')
  assert.deepEqual(JSON.parse(JSON.stringify(creates.at(-1))), { workspaceId: workspace.workspaceId }, 'new tasks use native creation defaults, without forking or setting a model route')
  assert.deepEqual(JSON.parse(JSON.stringify(binds.at(-1))), { sessionId: 'created-4', projectId: 'project-A', role: 'general', workMode: 'cat' })
  await onNewTask(sourceBinding, 'continue')
  assert.deepEqual(JSON.parse(JSON.stringify(binds.at(-1))), { sessionId: 'created-5', projectId: 'project-A', role: 'reviewer', workMode: 'cat' })
  const taskCount = creates.length, taskOpenCount = opened.length
  for (const changed of [undefined, { ...sourceBinding, projectId: 'other-project' }, { ...sourceBinding, workspaceId: 'other-workspace' }, { ...sourceBinding, role: 'translator' }, { ...sourceBinding, workMode: 'browser' }]) {
    bindings.set('cat-current', changed)
    await assert.rejects(onNewTask(sourceBinding, 'continue'), /绑定已变化/)
  }
  bindings.set('cat-current', sourceBinding)
  bindingError = 'cat-current'
  await assert.rejects(onNewTask(sourceBinding, 'continue'), /binding read failure/)
  bindingError = undefined
  projectResult = Promise.reject(new Error('Synthetic ProjectOpen failure'))
  await assert.rejects(onNewTask(sourceBinding, 'continue'), /ProjectOpen failure/)
  projectResult = { project: { id: 'project-A', archivedAt: 1 }, health: { projectId: 'project-A', healthy: true } }
  await assert.rejects(onNewTask(sourceBinding, 'continue'), /已归档/)
  projectResult = { project: { id: 'project-A' }, health: { projectId: 'project-A', healthy: false } }
  await assert.rejects(onNewTask(sourceBinding, 'continue'), /需要修复/)
  projectResult = { project: { id: 'other-project' }, health: { projectId: 'project-A', healthy: true } }
  await assert.rejects(onNewTask(sourceBinding, 'continue'), /项目身份校验失败/)
  assert.equal(creates.length, taskCount, 'failed binding or project checks never create an ordinary fallback Session')
  assert.equal(opened.length, taskOpenCount)
  projectResult = new Promise(resolve => { resolveProject = resolve })
  const lateTask = onNewTask(sourceBinding, 'continue')
  await new Promise(resolve => setImmediate(resolve))
  ctx.layout.selectPanel('another-panel')
  resolveProject({ project: { id: 'project-A' }, health: { projectId: 'project-A', healthy: true } })
  await lateTask
  assert.equal(creates.length, taskCount, 'cancelled task checks do not create or focus a Session')
  assert.equal(opened.length, taskOpenCount)
})

test('the native Linguist menu exposes project tasks and displays failures', async () => {
  const require = createRequire(new URL('../../packages/dsh-linguist/package.json', import.meta.url))
  const React = require('react')
  const source = readFileSync(new URL('../../packages/dsh-linguist/src/client/index.ts', import.meta.url), 'utf8')
  const code = ts.transpileModule(source + '\nexport { SessionBadge }', { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
  const binding = { sessionId: 'synthetic-cat', workspaceId: 'workspace-A', projectId: 'project-A', role: 'reviewer', workMode: 'cat' }
  const state = [binding, 'Synthetic project', '', '', false, false, false, false, undefined, '']
  let cursor = 0
  const exports = {}, taskKinds = []
  runInNewContext(code, { exports, require: name => {
    if (name === 'react') return { ...React, useEffect() {}, useState() { const index = cursor++; return [state[index], value => { state[index] = value }] } }
    if (name === './ui-locale') return { useT: () => value => value }
    if (name === '@deepseek-ai/dsh-client-ui-primitives') return { Button: 'button', Tooltip: 'tooltip', Modal: 'modal', Menu: 'menu' }
    if (name.endsWith('.module.css')) return { default: {} }
    return {}
  } })
  const nodes = node => typeof node !== 'object' || node === null ? [] : [node, ...React.Children.toArray(node.props?.children).flatMap(nodes)]
  const render = () => { cursor = 0; return nodes(exports.SessionBadge({ sessionId: binding.sessionId, onNewTask: async (actual, kind) => { assert.equal(actual, binding); taskKinds.push(kind); throw new Error('Synthetic project task failure') } })) }
  let menu = render().find(node => node.type === 'menu')
  assert(menu.props.items.some(item => item.id === 'new-general'))
  assert(menu.props.items.some(item => item.id === 'continue'))
  menu.props.onSelect('new-general')
  await new Promise(resolve => setImmediate(resolve))
  assert.match(render().find(node => node.props.role === 'alert').props.children, /Synthetic project task failure/)
  menu = render().find(node => node.type === 'menu')
  menu.props.onSelect('continue')
  await new Promise(resolve => setImmediate(resolve))
  assert.deepEqual(taskKinds, ['general', 'continue'])
  assert.equal(state[4], false, 'failed actions release the menu busy state')
  state[0] = { ...binding, projectId: undefined, workMode: 'browser' }
  menu = render().find(node => node.type === 'menu')
  assert(!menu.props.items.some(item => item.id === 'new-general' || item.id === 'continue'), 'non-project Sessions must not create a CAT project')
})
