import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'

const require = createRequire(new URL('../../packages/dsh-linguist/package.json', import.meta.url))
const React = require('react')
const { renderToStaticMarkup } = require('react-dom/server')
const tick = () => new Promise(resolve => setImmediate(resolve))

function harness(props, getInstructionFiles) {
  const state = [], effects = [], pending = []
  let cursor, effectCursor, tree
  const exports = {}
  const code = ts.transpileModule(readFileSync(new URL('../../packages/dsh-linguist/src/client/ProjectCapabilities.tsx', import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.React, target: ts.ScriptTarget.ES2022 },
  }).outputText
  runInNewContext(code, { exports, AbortController, require: name => {
    if (name === 'react') return { ...React,
      useState(initial) { const index = cursor++; if (!(index in state)) state[index] = initial; return [state[index], value => { state[index] = typeof value === 'function' ? value(state[index]) : value }] },
      useEffect(run, deps) { const index = effectCursor++; if (!effects[index] || deps.some((value, i) => value !== effects[index].deps[i])) pending.push(() => { effects[index]?.cleanup?.(); effects[index] = { deps, cleanup: run() } }) },
    }
    if (name === '@deepseek-ai/dsh-client-ui-primitives') return { Button: ({ variant, size, ...props }) => React.createElement('button', props) }
    if (name === './ui-locale') return { useT: () => (key, params = {}) => key.replace(/\{(\w+)\}/g, (_, key) => String(params[key])) }
    if (name === './api') return { getInstructionFiles }
    if (name.endsWith('.module.css')) return { default: {} }
    throw new Error(`Unexpected capabilities import: ${name}`)
  } })
  const nodes = node => typeof node !== 'object' || node === null ? [] : [node, ...React.Children.toArray(node.props?.children).flatMap(nodes)]
  return {
    render(next = {}) { Object.assign(props, next); cursor = 0; effectCursor = 0; tree = exports.ProjectCapabilities(props); pending.splice(0).forEach(run => run()); return renderToStaticMarkup(tree) },
    click(label) { const button = nodes(tree).find(node => node.type !== 'section' && node.props?.onClick && React.Children.toArray(node.props.children).join('') === label); assert(button, label); return button.props.onClick() },
    dispose() { effects.forEach(effect => effect.cleanup?.()) },
  }
}

test('project capabilities render actual native Skills and route files/plugins without writing the composer', async () => {
  const calls = []
  const component = harness({ sessionId: 'synthetic-session',
    loadSkills: async (sessionId, signal) => { calls.push(['load', sessionId, signal.aborted]); return { skills: [{ name: 'translate', description: 'Synthetic translator', path: '/synthetic/.agents/skills/translate/SKILL.md', modelInvocable: true }, { name: 'manual', description: 'Synthetic manual skill', modelInvocable: false }] } },
    onOpenFile: path => calls.push(['file', path]), onOpenPlugins: () => calls.push(['plugins']), onOpenFiles: () => calls.push(['files']),
  }, async (sessionId, signal) => { calls.push(['instructions', sessionId, signal.aborted]); return [{ path: '/synthetic/AGENTS.md', label: 'AGENTS.md' }] })
  assert(component.render().includes('正在读取可调用 Skills…'))
  await tick()
  const html = component.render()
  assert(html.includes('可调用 Skills · 2'))
  assert(html.includes('仅手动调用'))
  assert(html.includes('AGENTS.md'))
  assert(html.includes('按 DSH 默认规则查找；实际载入由会话配置决定。'))
  assert(!html.includes('已启用'))
  component.click('打开 translate')
  component.click('打开 AGENTS.md')
  component.click('打开原生插件')
  component.click('打开原生 Files')
  component.click('刷新')
  component.render()
  await tick()
  assert.equal(calls.filter(([action]) => action === 'load').length, 2)
  assert.equal(calls.filter(([action]) => action === 'instructions').length, 2)
  assert.deepEqual(calls.filter(([action]) => !['load', 'instructions'].includes(action)), [['file', '/synthetic/.agents/skills/translate/SKILL.md'], ['file', '/synthetic/AGENTS.md'], ['plugins'], ['files']])
  component.dispose()
})

test('capabilities reject stale Session results and distinguish failed reads from an empty catalog', async () => {
  const pending = new Map()
  const instructionPending = new Map()
  const component = harness({ sessionId: 'old', loadSkills: (id, signal) => new Promise((resolve, reject) => pending.set(id, { signal, resolve, reject })), onOpenFile() {}, onOpenPlugins() {}, onOpenFiles() {} }, (id, signal) => new Promise((resolve, reject) => instructionPending.set(id, { signal, resolve, reject })))
  component.render()
  component.render({ sessionId: 'new' })
  assert.equal(pending.get('old').signal.aborted, true)
  assert.equal(instructionPending.get('old').signal.aborted, true)
  pending.get('old').resolve({ skills: [{ name: 'wrong-session-skill', description: '', modelInvocable: true }] })
  instructionPending.get('old').resolve([{ path: '/old/AGENTS.md', label: 'Wrong session instruction' }])
  pending.get('new').reject(new Error('synthetic catalog unavailable'))
  instructionPending.get('new').reject(new Error('synthetic instruction read failed'))
  await tick()
  const html = component.render()
  assert(!html.includes('wrong-session-skill'))
  assert(!html.includes('Wrong session instruction'))
  assert(html.includes('synthetic catalog unavailable'))
  assert(html.includes('synthetic instruction read failed'))
  assert(!html.includes('可调用 Skills · 0'))
  component.click('刷新')
  component.render()
  pending.get('new').resolve({ skills: [] })
  instructionPending.get('new').resolve([])
  await tick()
  const empty = component.render()
  assert(empty.includes('可调用 Skills · 0'))
  assert(empty.includes('当前会话没有可手动调用的 Skills。'))
  assert(empty.includes('未发现工作区指令文件。'))
  const unbound = component.render({ sessionId: undefined, onOpenFiles: undefined, onOpenFile: undefined })
  assert(unbound.includes('进入项目会话后查看 Skills 与指令文件。'))
  assert(!unbound.includes('打开原生 Files'))
  component.dispose()
})
