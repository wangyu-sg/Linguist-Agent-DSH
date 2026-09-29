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

function harness(required) {
  const state = [], effects = [], pending = []
  let cursor, effectCursor, tree
  const exports = {}
  const source = readFileSync(new URL('../../packages/dsh-linguist/src/client/ScheduleManager.tsx', import.meta.url), 'utf8')
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.React, target: ts.ScriptTarget.ES2022 } }).outputText
  runInNewContext(code, { exports, require: name => {
    if (name === 'react') return { ...React,
      useState(initial) { const index = cursor++; if (!(index in state)) state[index] = initial; return [state[index], value => { state[index] = typeof value === 'function' ? value(state[index]) : value }] },
      useEffect(run, deps) { const index = effectCursor++; if (!effects[index] || deps.some((value, i) => value !== effects[index].deps[i])) pending.push(() => { effects[index]?.cleanup?.(); effects[index] = { deps, cleanup: run() } }) },
    }
    if (name === '@deepseek-ai/dsh-client-ui-primitives') return { Button: ({ variant, size, ...props }) => React.createElement('button', props), Modal: ({ open, children, footer }) => open ? React.createElement('section', null, children, footer) : null }
    if (name === './api') return { required }
    if (name === './ui-locale') return { useT: () => (key, params = {}) => key.replace(/\{(\w+)\}/g, (_, key) => String(params[key])) }
    if (name.endsWith('.module.css')) return { default: {} }
    throw new Error(`Unexpected schedule manager import: ${name}`)
  } })
  const props = { sessionId: 'source-session', refresh: 0, editable: true, onEdit() {}, onDestinations() {} }
  const nodes = node => typeof node !== 'object' || node === null ? [] : node.props?.open === false ? [] : [node, ...React.Children.toArray(node.props?.children).flatMap(nodes), ...React.Children.toArray(node.props?.footer).flatMap(nodes)]
  const button = label => nodes(tree).find(node => node.props?.onClick && React.Children.toArray(node.props.children).join('') === label)
  return {
    render() { cursor = 0; effectCursor = 0; tree = exports.ScheduleManager(props); pending.splice(0).forEach(run => run()); return renderToStaticMarkup(tree) },
    button(label) { const value = button(label); assert(value, label); return value.props },
    click(label) { const value = button(label); assert(value, label); assert(!value.props.disabled, `${label} is disabled`); return value.props.onClick() },
    dispose() { effects.forEach(effect => effect.cleanup?.()) },
  }
}

const schedule = {
  scheduleId: 'schedule-synthetic', sessionId: 'task-owner', version: 'v1', title: 'Synthetic task', prompt: 'Synthetic prompt',
  status: 'active', authorizationStatus: 'ready', sessionMode: 'daily', runCount: 0, consecutiveFailures: 0,
  role: 'reviewer', scope: 'project', kind: 'daily', scheduledAt: '2026-09-29T10:00:00.000Z',
}

test('manual schedule run accepts its task owner receipt from a distinct source Session and rejects another owner', async () => {
  let owner = 'task-owner'
  const requests = []
  const component = harness(async (operation, input) => {
    if (operation === 'linguistScheduleList') return { items: [schedule], notificationDestinations: [] }
    assert.equal(operation, 'linguistScheduleRunNow')
    requests.push(input)
    return { scheduleId: schedule.scheduleId, sessionId: owner, status: 'accepted', messageId: 'native-message-1' }
  })
  component.render()
  await tick()
  component.render()
  component.click('立即运行')
  await tick()
  let html = component.render()
  assert(html.includes('已受理立即运行请求，消息 native-message-1 已交给 DSH Session'), html)
  assert(!html.includes('Host 立即运行回执与当前任务不一致。'))
  assert.deepEqual(JSON.parse(JSON.stringify(requests[0])), { sessionId: 'source-session', scheduleId: schedule.scheduleId, expectedVersion: 'v1' })
  await tick()
  component.render()
  owner = 'unrelated-task-owner'
  component.click('立即运行')
  await tick()
  html = component.render()
  assert(html.includes('Host 立即运行回执与当前任务不一致。'))
  assert(!html.includes('已受理立即运行请求'))
  component.dispose()
})

test('source-owned legacy schedules require recreation while history and explicit cancellation stay available', async () => {
  const legacy = { ...schedule, sessionId: 'source-session', authorizationStatus: 'recreate-required' }
  const requests = []
  const component = harness(async (operation, input) => {
    requests.push({ operation, input })
    if (operation === 'linguistScheduleList') return { items: [legacy], notificationDestinations: [] }
    if (operation === 'linguistScheduleHistory') return { scheduleId: legacy.scheduleId, executions: [], records: [] }
    if (operation === 'linguistScheduleCancel') return { cancelled: true }
    throw new Error(`Legacy task must not be run or edited: ${operation}`)
  })
  component.render()
  await tick()
  const html = component.render()
  assert.match(html, /取消[^<]*(?:重建|重新创建)/)
  assert.equal(component.button('编辑并重新核验').disabled, true)
  assert.equal(component.button('立即运行').disabled, true)
  component.click('执行与投递历史')
  await tick()
  assert(component.render().includes('暂无执行记录。'))
  component.click('取消任务')
  component.render()
  component.click('确认取消任务')
  await tick()
  component.render()
  assert(requests.some(({ operation, input }) => operation === 'linguistScheduleHistory' && input.sessionId === 'source-session' && input.scheduleId === legacy.scheduleId))
  assert(requests.some(({ operation, input }) => operation === 'linguistScheduleCancel' && input.sessionId === 'source-session' && input.scheduleId === legacy.scheduleId))
  component.dispose()
})
