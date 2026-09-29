import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'

const require = createRequire(new URL('../../packages/dsh-linguist/package.json', import.meta.url))
const React = require('react')
const tick = () => new Promise(resolve => setImmediate(resolve))
const t = (key, params = {}) => key.replace(/\{(\w+)\}/g, (_, name) => String(params[name]))
const primitives = { Button: 'button', Input: 'input', Checkbox: 'checkbox', Menu: 'menu', Modal: 'modal' }
const client = new URL('../../packages/dsh-linguist/src/client/', import.meta.url)

// Execute each production component and its hooks; only external I/O and native primitives are substituted.
function mount(file, symbol, props, { required = async () => { throw new Error('Unexpected domain request') }, fetch } = {}) {
  const state = [], memo = [], effects = [], pending = []
  let cursor, memoCursor, effectCursor, tree
  const exports = {}
  const code = ts.transpileModule(readFileSync(new URL(file, client), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.React, target: ts.ScriptTarget.ES2022 } }).outputText
  runInNewContext(`${code}\nexports.testComponent = ${symbol};`, { exports, fetch, Intl, crypto: { randomUUID: () => 'synthetic-key' }, require: name => {
    if (name === 'react') return { ...React,
      useState(initial) { const i = cursor++; if (!(i in state)) state[i] = typeof initial === 'function' ? initial() : initial; return [state[i], value => { state[i] = typeof value === 'function' ? value(state[i]) : value }] },
      useMemo(factory, deps) { const i = memoCursor++; if (!memo[i] || deps.some((value, j) => value !== memo[i].deps[j])) memo[i] = { deps, value: factory() }; return memo[i].value },
      useCallback(callback, deps) { const i = memoCursor++; if (!memo[i] || deps.some((value, j) => value !== memo[i].deps[j])) memo[i] = { deps, value: callback }; return memo[i].value },
      useRef(value) { const i = memoCursor++; if (!memo[i]) memo[i] = { value: { current: value } }; return memo[i].value },
      useEffect(run, deps) { const i = effectCursor++; if (!effects[i] || deps.some((value, j) => value !== effects[i].deps[j])) pending.push(() => { effects[i]?.cleanup?.(); effects[i] = { deps, cleanup: run() } }) },
    }
    if (name === '@deepseek-ai/dsh-client-ui-primitives') return primitives
    if (name === './api') return { required, fileUrl: token => `/la/v1/files/${token}` }
    if (name === './ui-locale') return { useT: () => t }
    if (name === './project-errors') return { describeProjectError: String }
    if (name === './qa-severity') return { qaSeverityTier: () => 'blocking', qaSeverityLabel: value => value, qaTierLabel: value => value }
    if (name === './proposal-view') return { groupProposalRuns: () => [], textDiffParts: () => [] }
    if (name === './workflow-ui') return { stageName: value => value, stageFilterOptions: () => [], stageProgressLabel: value => value, stageCompletionLabel: value => value }
    if (name === './format-labels') return { describeLinguistFormat: value => value }
    if (name === './ScheduleManager') return { ScheduleManager: 'schedule-manager' }
    if (name === './TargetEditor') return { splitProtectedText: value => [{ kind: 'text', value }] }
    if (name.endsWith('.module.css')) return { default: {} }
    return {}
  } })
  function nodes(node) {
    if (typeof node !== 'object' || node === null) return []
    if (node.type === 'modal' && !node.props.open) return []
    return [node, ...React.Children.toArray(node.props?.children).flatMap(nodes), ...React.Children.toArray(node.props?.footer).flatMap(nodes)]
  }
  function text(node) {
    if (node === null || node === undefined || typeof node === 'boolean') return ''
    if (typeof node !== 'object') return String(node)
    if (node.type === 'modal' && !node.props.open) return ''
    return React.Children.toArray(node.props?.children).map(text).join('') + React.Children.toArray(node.props?.footer).map(text).join('')
  }
  return {
    render(next = {}) { Object.assign(props, next); cursor = memoCursor = effectCursor = 0; tree = exports.testComponent(props); pending.splice(0).forEach(run => run()); return text(tree) },
    nodes: () => nodes(tree),
    button(label) { const node = nodes(tree).find(node => node.type === 'button' && text(node) === label); assert(node, `Missing button ${label}`); return node.props },
    click(label) { const props = this.button(label); assert(!props.disabled, `${label} disabled`); return props.onClick() },
    dispose() { effects.forEach(effect => effect.cleanup?.()) },
  }
}

const segment = { id: 'segment-synthetic', ordinal: 7, source: 'Synthetic source', target: 'Synthetic current target', revision: 3, locked: false, sourceLocale: 'en-US', targetLocale: 'ja-JP' }
const context = { segment, tm: [], qaFindings: [], approvedExemplars: [], termMatches: [{ id: 'term-1', term: 'Synthetic', translation: '用語', status: 'required', matchType: 'contains', caseSensitive: true, conflict: true, module: 'UI', category: 'menu', note: 'Synthetic term note' }] }

test('reference inspector exposes term details and inserts through the active protected editor capability', async () => {
  const inserted = []
  const props = { projectId: 'project-synthetic', segmentId: segment.id, archived: false, mutation: 0, onOpenTerms() {}, editorHandle: { insert(value) { inserted.push(value); return true }, focus() {} } }
  const component = mount('CatWorkbench.tsx', 'ContextPanel', props, { required: async operation => operation === 'linguistCatGetContext' ? context : { items: [] } })
  component.render(); await tick()
  let text = component.render()
  assert.match(text, /必需 · 包含匹配 · 区分大小写 · 译文冲突/)
  assert.match(text, /Synthetic term note/)
  component.click('插入草稿')
  assert.deepEqual(inserted, ['用語'])
  text = component.render({ editorHandle: undefined })
  assert(component.button('插入草稿').disabled)
  assert.match(text, /先打开当前句段的译文编辑器/)
  component.render({ editorHandle: props.editorHandle, archived: true })
  assert(component.button('插入草稿').disabled)
  component.dispose()
})

test('QA does not fetch a project-wide list when no batch is chosen and the current-segment filter keeps the run batch', async () => {
  const calls = []
  const component = mount('Panels.tsx', 'QaPanel', { projectId: 'p', segmentId: segment.id, archived: false, onNavigate() {}, onChanged() {} }, { required: async (operation, input) => { calls.push({ operation, input }); return { items: [], total: 0, hasMore: false } } })
  assert.match(component.render(), /选择一个工作批次/)
  assert.equal(calls.length, 0)
  component.render({ assetId: 'batch-synthetic' }); await tick(); component.render()
  assert.equal(calls.at(-1).input.assetId, 'batch-synthetic')
  component.nodes().find(node => node.type === 'checkbox').props.onChange(true)
  component.render(); await tick(); component.render()
  assert.equal(calls.at(-1).input.segmentId, segment.id)
  component.render({ segmentId: 'next-segment' }); component.render(); await tick(); component.render()
  assert.equal(calls.at(-1).input.segmentId, 'next-segment')
  component.click('运行 QA'); await tick()
  assert(calls.some(call => call.operation === 'linguistCatRunQa' && call.input.assetId === 'batch-synthetic'))
  component.dispose()
})

test('Finding source/target disclosure reads current domain content on demand and follows revision changes', async () => {
  let revision = 3, calls = 0
  const finding = { segmentId: segment.id, currentRevision: revision }
  const component = mount('Panels.tsx', 'QaFindingText', { projectId: 'p', finding }, { required: async () => { calls++; return { ...context, segment: { ...segment, revision, target: `Target r${revision}` } } } })
  component.render(); assert.equal(calls, 0)
  component.nodes().find(node => node.type === 'details').props.onToggle({ currentTarget: { open: true } })
  component.render(); await tick()
  assert.match(component.render(), /Synthetic source.*Target r3/)
  revision = 4
  component.render({ finding: { ...finding, currentRevision: revision } }); await tick()
  assert.match(component.render(), /Target r4/)
  assert.equal(calls, 2)
  component.dispose()
})

test('Proposal loading and failed requests do not display a false empty inbox', async () => {
  let fail = true
  const component = mount('Panels.tsx', 'ProposalPanel', { projectId: 'p', segmentIds: [], archived: false, onNavigate() {}, onChanged() {} }, { required: async () => { if (fail) throw new Error('Synthetic offline'); return { items: [], total: 0 } } })
  assert(!component.render().includes('当前筛选没有建议。'))
  await tick()
  const failed = component.render()
  assert.match(failed, /Synthetic offline/); assert(!failed.includes('当前筛选没有建议。'))
  fail = false; component.click('重试'); component.render(); await tick()
  assert.match(component.render(), /当前筛选没有建议。/)
  component.dispose()
})

test('as-is delivery makes no export request before the native confirmation and preserves validation identity', async () => {
  const requests = []
  const component = mount('Panels.tsx', 'DeliveryPanel', { projectId: 'p', assets: [{ assetId: 'asset-1', filename: 'synthetic.txt' }], archived: false }, {
    required: async () => [],
    fetch: async (url, init) => { requests.push({ url, body: JSON.parse(init.body) }); return { ok: true, json: async () => ({ token: 'file-token', filename: 'synthetic.txt', preparation: { preflight: { ready: false, stageCounts: {}, qa: {}, blockers: [] } } }) } },
  })
  component.render(); await tick(); component.render()
  component.click('按当前状态导出'); const confirmation = component.render()
  assert.equal(requests.length, 0)
  assert.match(confirmation, /可能仍有未确认句段、QA 问题或待审建议/)
  component.click('确认按当前状态导出'); await tick()
  assert.deepEqual(requests[0].body, { projectId: 'p', assetId: 'asset-1', validation: 'as-is' })
  assert.match(component.render(), /下载链接一次有效/)
  component.dispose()
})

test('Run panel shows true job progress, reconciles the scoped job, and explicitly cancels the entire Session', async () => {
  let cancelled = 0
  const job = { jobId: 'job-1', sessionId: 's', runId: 'run-1', status: 'running', cursor: 2, total: 5, completed: 2, failed: 0 }
  const updates = new Map([[job.jobId, { kind: 'job-updated', jobId: job.jobId, sessionId: 's', runId: job.runId, job }]])
  const component = mount('RunPanel.tsx', 'RunPanel', { projectId: 'p', sessionId: 's', selectedSegmentIds: [], uiRevision: 1, workflowStage: 'translation', archived: true, mutation: 0, jobUpdates: updates, onCancelRun: async () => { cancelled++ }, onChanged() {} }, {
    required: async (operation, input) => { if (operation === 'linguistCatGetJob') { assert.equal(input.sessionId, 's'); assert.equal(input.jobId, job.jobId); return { job } } return { summary: null } },
  })
  component.render(); await tick()
  assert.match(component.render(), /已处理 2\/5/)
  assert.equal(component.nodes().find(node => node.type === 'progress').props.value, 2)
  component.click('停止当前会话运行'); assert.match(component.render(), /整个当前会话的活动回合/); assert.equal(cancelled, 0)
  await component.click('确认停止'); assert.equal(cancelled, 1)
  component.dispose()
})

test('file preview clears failed state for retry and keeps sandbox and CSP on HTML', async () => {
  let failed = true
  const component = mount('PreviewView.tsx', 'PreviewView', { request: { operation: 'linguistProjectsPreviewAssetSource', input: { projectId: 'p' } }, onClose() {} }, { required: async () => { if (failed) throw new Error('Synthetic missing'); return { kind: 'html', filename: 'synthetic.html', html: '<p>Preview</p>' } } })
  component.render(); await tick(); assert.match(component.render(), /原文件预览失败/)
  failed = false; component.click('重试'); component.render(); await tick(); component.render()
  const iframe = component.nodes().find(node => node.type === 'iframe')
  assert.equal(iframe.props.sandbox, '')
  assert.match(iframe.props.srcDoc, /default-src 'none'/)
  component.dispose()
})

test('empty batch preview explains the absence of segments instead of rendering an empty table', async () => {
  const asset = { assetId: 'asset-1', filename: 'empty.txt', formatId: 'text', segmentCount: 0, segmentCounts: {}, currentStageCounts: {} }
  const component = mount('BatchPreview.tsx', 'BatchPreview', { projectId: 'p', asset, onClose() {} }, { required: async operation => operation === 'linguistProjectsGetSummary' ? { project: {}, assets: [asset] } : { total: 0, segments: [], hasMore: false } })
  component.render(); await tick(); assert.match(component.render(), /当前批次没有可预览的句段/)
  assert(!component.nodes().some(node => node.props?.role === 'table'))
  component.dispose()
})
