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

function harness(required, overrides = {}) {
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
  const props = { sessionId: 'source-session', refresh: 0, editable: true, onEdit() {}, onDestinations() {}, onOpenSession: async () => {}, ...overrides }
  const nodes = node => typeof node !== 'object' || node === null ? [] : node.props?.open === false ? [] : [node, ...React.Children.toArray(node.props?.children).flatMap(nodes), ...React.Children.toArray(node.props?.footer).flatMap(nodes)]
  const button = label => nodes(tree).find(node => node.props?.onClick && React.Children.toArray(node.props.children).join('') === label)
  return {
    render() { cursor = 0; effectCursor = 0; tree = exports.ScheduleManager(props); pending.splice(0).forEach(run => run()); return renderToStaticMarkup(tree) },
    button(label) { const value = button(label); assert(value, label); return value.props },
    click(label) { const value = button(label); assert(value, label); assert(!value.props.disabled, `${label} is disabled`); return value.props.onClick() },
    nodes: () => nodes(tree),
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

test('manual pause preserves displayed history and resumes through revalidation of the same task', async () => {
  let current = { ...schedule, pausedByUser: false }
  const requests = [], edits = []
  const component = harness(async (operation, input) => {
    requests.push({ operation, input })
    if (operation === 'linguistScheduleList') return { items: [current], notificationDestinations: [] }
    if (operation === 'linguistScheduleHistory') return {
      scheduleId: current.scheduleId, executions: [{ turn: 1, messageId: 'completed-run', sessionId: 'actual-run-session', admittedAt: '2026-09-29T09:00:00.000Z', outcome: 'completed', phase: 'execution' }], records: [],
    }
    assert.equal(operation, 'linguistSchedulePause')
    current = { ...current, status: 'inactive', pausedByUser: true, version: 'paused-v2' }
    return { scheduleId: current.scheduleId, paused: true }
  }, { onEdit: value => edits.push(value) })
  component.render()
  await tick()
  component.render()
  component.click('执行与投递历史')
  await tick()
  component.render()
  component.click('暂停任务')
  await tick()
  component.render()
  await tick()
  const html = component.render()
  assert(html.includes('已手动暂停'))
  assert(html.includes('actual-run-session'), 'pause must retain the loaded execution history')
  assert(!html.includes('下次到期'), 'paused tasks must not show a live due time')
  assert.equal(component.button('立即运行').disabled, true)
  component.click('重新核验并恢复')
  assert.deepEqual(JSON.parse(JSON.stringify(edits[0])), current)
  const pause = requests.find(item => item.operation === 'linguistSchedulePause')
  assert.deepEqual(JSON.parse(JSON.stringify(pause.input)), { sessionId: 'source-session', scheduleId: current.scheduleId, expectedVersion: 'v1' })
  assert(!requests.some(item => item.operation === 'linguistScheduleCancel'), 'pause must not use destructive cancellation')
  component.dispose()
})

test('pause rejects another task receipt without claiming successful suspension', async () => {
  const component = harness(async operation => {
    if (operation === 'linguistScheduleList') return { items: [schedule], notificationDestinations: [] }
    assert.equal(operation, 'linguistSchedulePause')
    return { scheduleId: 'other-task', paused: true }
  })
  component.render()
  await tick()
  component.render()
  component.click('暂停任务')
  await tick()
  const html = component.render()
  assert(html.includes('Host 暂停回执与当前任务不一致。'))
  assert(!html.includes('已手动暂停'))
  component.dispose()
})

test('history opens the actual execution Session and reports deleted Sessions without substituting its owner', async () => {
  let executionSessionId = 'actual-run-session', unavailable = false
  const opened = []
  const component = harness(async operation => {
    if (operation === 'linguistScheduleList') return { items: [schedule], notificationDestinations: [] }
    assert.equal(operation, 'linguistScheduleHistory')
    return { scheduleId: schedule.scheduleId, records: [], executions: [
      { turn: 1, messageId: 'execution-message', sessionId: executionSessionId, admittedAt: '2026-09-29T09:00:00.000Z', outcome: 'completed', phase: 'execution' },
    ] }
  }, { onOpenSession: async id => { opened.push(id); if (unavailable) throw new Error('执行会话已不存在') } })
  component.render()
  await tick()
  component.render()
  component.click('执行与投递历史')
  await tick()
  component.render()
  component.click('打开执行会话')
  await tick()
  component.render()
  assert.deepEqual(opened, ['actual-run-session'])
  unavailable = true
  component.click('打开执行会话')
  await tick()
  assert(component.render().includes('执行会话已不存在'))
  assert.deepEqual(opened, ['actual-run-session', 'actual-run-session'])
  executionSessionId = undefined
  component.click('执行与投递历史')
  await tick()
  component.render()
  assert.equal(component.button('打开执行会话').disabled, true)
  component.dispose()
})

test('native schedule states form ordered active, paused and ended groups while retaining API order', async () => {
  let items = [
    { ...schedule, scheduleId: 'max', title: 'Reached maximum', status: 'inactive', limitReached: true },
    { ...schedule, scheduleId: 'active-b', title: 'Active B' },
    { ...schedule, scheduleId: 'failed', title: 'Failure pause', status: 'inactive', pausedAfterFailures: true },
    { ...schedule, scheduleId: 'active-a', title: 'Active A' },
    { ...schedule, scheduleId: 'manual', title: 'Manual pause', status: 'inactive', pausedByUser: true },
    { ...schedule, scheduleId: 'once', title: 'Once ended', status: 'inactive' },
  ]
  const component = harness(async operation => {
    assert.equal(operation, 'linguistScheduleList')
    return { items, notificationDestinations: [] }
  })
  const groups = () => component.nodes().filter(node => node.type === 'section' && ['启用中', '已暂停', '调度已结束'].includes(node.props['aria-label']))
  const titles = group => React.Children.toArray(group.props.children).flatMap(node => node.type === 'article' ? React.Children.toArray(node.props.children).flatMap(child => React.Children.toArray(child.props?.children).filter(item => item.type === 'strong').map(item => item.props.children)) : [])
  component.render(); await tick(); component.render()
  assert.deepEqual(groups().map(group => group.props['aria-label']), ['启用中', '已暂停', '调度已结束'])
  assert.deepEqual(groups().map(titles), [['Active B', 'Active A'], ['Failure pause', 'Manual pause'], ['Reached maximum', 'Once ended']])
  items = items.map(item => item.scheduleId === 'active-b' ? { ...item, status: 'inactive', pausedByUser: true } : item)
  component.click('刷新'); component.render(); await tick(); component.render()
  assert.deepEqual(groups().map(titles), [['Active A'], ['Active B', 'Failure pause', 'Manual pause'], ['Reached maximum', 'Once ended']])
  component.dispose()
})

for (const stopped of [
  { limitReached: true },
  { pausedAfterFailures: true },
  { pausedByUser: true },
  {},
]) test(`stopped own schedule remains explicitly cancellable: ${JSON.stringify(stopped)}`, async () => {
  const current = { ...schedule, ...stopped, status: 'inactive' }
  let resolveCancel, removed = false
  const requests = []
  const component = harness(async (operation, input) => {
    requests.push({ operation, input })
    if (operation === 'linguistScheduleList') return { items: removed ? [] : [current], notificationDestinations: [] }
    assert.equal(operation, 'linguistScheduleCancel')
    await new Promise(resolve => { resolveCancel = resolve })
    removed = true
    return { cancelled: true }
  }, { editable: false })
  component.render(); await tick(); component.render()
  assert.equal(component.button('立即运行').disabled, true)
  component.click('取消任务'); component.render()
  assert.match(component.render(), /删除原生调度历史/)
  assert(!requests.some(item => item.operation === 'linguistScheduleCancel'))
  component.click('保留任务'); component.render()
  assert(!requests.some(item => item.operation === 'linguistScheduleCancel'))
  component.click('取消任务'); component.render(); component.click('确认取消任务'); component.render()
  assert.equal(component.button('取消任务').disabled, true)
  assert.equal(component.button('确认取消任务').disabled, true)
  resolveCancel(); await tick(); component.render(); await tick()
  assert.match(component.render(), /此会话没有 Linguist 专用定时任务/)
  assert.deepEqual(JSON.parse(JSON.stringify(requests.filter(item => item.operation === 'linguistScheduleCancel'))), [{ operation: 'linguistScheduleCancel', input: { sessionId: 'source-session', scheduleId: schedule.scheduleId } }])
  component.dispose()
})
