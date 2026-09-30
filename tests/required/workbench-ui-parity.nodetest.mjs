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
const primitives = { Button: 'button', Input: 'input', Checkbox: 'checkbox', Menu: 'menu', Modal: 'modal', Tooltip: 'tooltip', IconPanelLeftOutlineRegular: 'svg', IconEllipsisOutlineRegular: 'svg', IconChevronDownOutlineRegular: 'svg', IconCheckOutlineRegular: 'svg' }
const client = new URL('../../packages/dsh-linguist/src/client/', import.meta.url)
const workflow = {}
runInNewContext(ts.transpileModule(readFileSync(new URL('workflow-ui.ts', client), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, { exports: workflow })

// Execute each production component and its hooks; only external I/O and native primitives are substituted.
function mount(file, symbol, props, { required = async () => { throw new Error('Unexpected domain request') }, fetch, writeClipboard } = {}) {
  const state = [], memo = [], effects = [], pending = []
  let cursor, memoCursor, effectCursor, tree
  const exports = {}
  const code = ts.transpileModule(readFileSync(new URL(file, client), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.React, target: ts.ScriptTarget.ES2022 } }).outputText
  runInNewContext(`${code}\nexports.testComponent = ${symbol};`, { exports, fetch, Intl, EventSource: class { addEventListener() {} close() {} }, crypto: { randomUUID: () => 'synthetic-key' }, require: name => {
    if (name === 'react') return { ...React,
      useSyncExternalStore(_subscribe, getSnapshot) { return getSnapshot() },
      useState(initial) { const i = cursor++; if (!(i in state)) state[i] = typeof initial === 'function' ? initial() : initial; return [state[i], value => { state[i] = typeof value === 'function' ? value(state[i]) : value }] },
      useMemo(factory, deps) { const i = memoCursor++; if (!memo[i] || deps.some((value, j) => value !== memo[i].deps[j])) memo[i] = { deps, value: factory() }; return memo[i].value },
      useCallback(callback, deps) { const i = memoCursor++; if (!memo[i] || deps.some((value, j) => value !== memo[i].deps[j])) memo[i] = { deps, value: callback }; return memo[i].value },
      useRef(value) { const i = memoCursor++; if (!memo[i]) memo[i] = { value: { current: value } }; return memo[i].value },
      useEffect(run, deps) { const i = effectCursor++; if (!effects[i] || deps.some((value, j) => value !== effects[i].deps[j])) pending.push(() => { effects[i]?.cleanup?.(); effects[i] = { deps, cleanup: run() } }) },
    }
    if (name === '@deepseek-ai/dsh-client-ui-primitives') return { ...primitives, writeClipboard }
    if (name === './api') return { required, fileUrl: token => `/la/v1/files/${token}`, stageFiles: async () => ['synthetic-file-token'] }
    if (name === './ui-locale') return { useT: () => t }
    if (name === './project-errors') return { describeProjectError: String }
    if (name === './qa-severity') return { qaSeverityTier: () => 'blocking', qaSeverityLabel: value => value, qaTierLabel: value => value }
    if (name === './proposal-view') return { groupProposalRuns: () => [], textDiffParts: () => [] }
    if (name === './workflow-ui') return workflow
    if (name === './format-labels') return { describeLinguistFormat: value => value }
    if (name === './ProjectSessions') return { ProjectSessions: 'project-sessions' }
    if (name === './ProjectLocaleSelect') return { ProjectLocaleSelect: 'locale-select' }
    if (name === './LegacyMigrationPanel') return { LegacyMigrationPanel: 'legacy-migration' }
    if (name === './ScheduleManager') return { ScheduleManager: 'schedule-manager' }
    if (name === './TargetEditor') return { splitProtectedText: value => [{ kind: 'text', value }] }
    if (name.endsWith('.module.css')) return { default: {} }
    return {}
  } })
  function nodes(node) {
    if (typeof node !== 'object' || node === null) return []
    if (node.type === 'modal' && !node.props.open) return []
    return [node, ...React.Children.toArray(node.props?.children).flatMap(nodes), ...React.Children.toArray(node.props?.footer).flatMap(nodes), ...React.Children.toArray(node.props?.anchor).flatMap(nodes)]
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

test('CAT status uses complete batch totals and actual decisions, clears stale scope and reports failed coverage', async () => {
  const assets = [
    { assetId: 'a', filename: 'synthetic-a.json', sourceCharacters: 12400, targetCharacters: 8500, segmentCount: 500, currentStageCounts: { confirmed: 10, draft: 2, untouched: 488 } },
    { assetId: 'b', filename: 'synthetic-b.json', sourceCharacters: 100, targetCharacters: 80, segmentCount: 5, currentStageCounts: { confirmed: 2, draft: 1, untouched: 2 } },
  ]
  let fail = false
  const requests = []
  const component = mount('CatStatusBar.tsx', 'CatStatusBar', { projectId: 'p', assetId: 'a', summary: { project: { workflowStage: 'editing' }, assets, totalSegments: 505, currentStageCounts: { confirmed: 12, draft: 3, untouched: 490 } }, active: segment, selectedCount: 2, revision: '0' }, { required: async (operation, input) => {
    requests.push({ operation, input })
    if (fail) throw new Error('synthetic coverage failure')
    return { total: 500, pending: 50, confirmed: 10, unchanged: 400, corrected: 45, blocked: 5 }
  } })
  component.render(); await tick()
  let text = component.render()
  assert.match(text, /源文 12,400 字符.*译文 8,500 字符/)
  assert.match(text, /已审校 10 \/ 500.*审校草稿 2/)
  assert.match(text, /审校决策 450 \/ 500.*未修改 400.*已修正 45.*阻塞 5/)
  assert.match(text, /当前句段 #8.*已选 2 段/)
  assert.equal(component.nodes().find(node => node.type === 'progress').props.max, 500)
  assert(!component.render({ revision: '1' }).includes('450 / 500'))
  await tick(); component.render()
  text = component.render({ assetId: undefined })
  assert.match(text, /源文 12,500 字符.*译文 8,580 字符/)
  assert(!text.includes('审校决策'))
  assert.equal(requests.length, 2)
  fail = true
  component.render({ assetId: 'b' }); await tick(); text = component.render()
  assert.match(text, /决策覆盖读取失败：Error: synthetic coverage failure/)
  assert(!text.includes('450 / 500'))
  assert.equal(requests.at(-1).input.assetId, 'b')
  component.dispose()
})

test('reference inspector exposes term details and inserts through the active protected editor capability', async () => {
  const inserted = []
  const props = { projectId: 'project-synthetic', segmentId: segment.id, archived: false, mutation: 0, onOpenTerms() {}, editorHandle: { insert(value) { inserted.push(value); return true }, focus() {} } }
  const component = mount('CatWorkbench.tsx', 'ContextPanel', props, { required: async operation => operation === 'linguistCatGetContext' ? context : { items: [] } })
  component.render(); await tick()
  let text = component.render()
  assert.match(text, /必须 · 包含匹配 · 区分大小写 · 译文冲突/)
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

test('term labels cover filters, edits, lists, conflicts and import candidates without changing submitted values', async () => {
  const labels = { required: '必须', preferred: '推荐', forbidden: '禁用', allowed: '允许', deprecated: '弃用' }
  const terms = Object.keys(labels).map((status, i) => ({ id: `term-${i}`, term: `Synthetic ${i}`, translation: `译法 ${i}`, status, caseSensitive: false }))
  const requests = []
  const component = mount('Panels.tsx', 'ReferencePanel', { projectId: 'p', segmentIds: [], archived: false, onChanged() {}, onNavigate() {}, onSendAgentTask() {} }, { required: async (operation, input) => {
    requests.push({ operation, input })
    if (operation === 'linguistReferencesQueryTerms') return { items: terms, total: terms.length, hasMore: false }
    if (operation === 'linguistReferencesListTermConflicts') return { count: 1, conflicts: [{ normalizedTerm: 'synthetic', entries: terms.slice(0, 2) }] }
    if (operation === 'linguistReferencesImport') return { cancelled: false, requiresConfirmation: true, candidateId: 'candidate-synthetic', filename: 'synthetic.csv', sourceSha256: 'a'.repeat(64), summary: { entryCount: terms.length, warnings: [], samples: terms.map(term => ({ ...term, kind: 'terms' })) } }
    if (operation === 'linguistReferencesUpsertTerm') return {}
    throw new Error(operation)
  } })
  component.render(); await tick()
  let text = component.render()
  const select = label => component.nodes().find(node => node.type === 'select' && node.props['aria-label'] === label)
  for (const term of terms) {
    const checkbox = component.nodes().find(node => node.type === 'checkbox' && node.props.title === `选择术语 ${term.term}`)
    assert.equal(checkbox.props.label, term.term)
    const row = component.nodes().find(node => React.Children.toArray(node.props?.children).some(child => child.type === 'checkbox' && child.props.label === term.term))
    assert(!React.Children.toArray(row.props.children).some(node => node.type === 'strong' && node.props.children === term.term))
  }
  for (const label of ['术语状态筛选', '术语约束']) {
    const options = React.Children.toArray(select(label).props.children).filter(node => node.props.value)
    assert.deepEqual(Object.fromEntries(options.map(node => [node.props.value, node.props.children])), labels)
  }
  for (const term of terms) assert(text.includes(`${term.translation}${labels[term.status]}`), `list label ${term.status}`)
  for (const term of terms.slice(0, 2)) assert(text.includes(`${term.translation} · ${labels[term.status]}`), `conflict label ${term.status}`)
  select('术语状态筛选').props.onChange({ target: { value: 'forbidden' } }); component.render(); await tick(); component.render()
  assert.equal(requests.filter(request => request.operation === 'linguistReferencesQueryTerms').at(-1).input.status, 'forbidden')
  component.nodes().find(node => node.type === 'input' && node.props.type === 'file').props.onChange({ target: { files: [{ name: 'synthetic.csv' }], value: 'synthetic.csv' } })
  await tick(); text = component.render()
  for (const term of terms) assert(text.includes(`${term.term} → ${term.translation} · ${labels[term.status]}`), `candidate label ${term.status}`)
  for (const status of Object.keys(labels)) {
    component.nodes().find(node => node.type === 'input' && node.props['aria-label'] === '术语').props.onChange({ target: { value: 'Synthetic term' } })
    component.nodes().find(node => node.type === 'input' && node.props['aria-label'] === '译法').props.onChange({ target: { value: '合成译法' } })
    select('术语约束').props.onChange({ target: { value: status } }); component.render()
    component.nodes().find(node => node.type === 'form').props.onSubmit({ preventDefault() {} })
    await tick(); component.render()
    assert.equal(requests.filter(request => request.operation === 'linguistReferencesUpsertTerm').at(-1).input.status, status)
  }
  const locale = {}, dictionaries = {}
  runInNewContext(ts.transpileModule(readFileSync(new URL('ui-locale.tsx', client), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.React, target: ts.ScriptTarget.ES2022 } }).outputText, { exports: locale, require: () => React })
  locale.registerLinguistLocale({ register(_namespace, language, dictionary) { dictionaries[language] = dictionary; return () => {} } })
  assert.deepEqual(Object.fromEntries(Object.values(labels).map(label => [label, dictionaries.en[label]])), { 必须: 'Required', 推荐: 'Preferred', 禁用: 'Forbidden', 允许: 'Allowed', 弃用: 'Deprecated' })
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

test('delivery copies the prepared PM report through the native clipboard and reports write failure', async () => {
  const reportMarkdown = '# Synthetic PM review\n\nCurrent revision only — 句段 3 ✅\n'
  const copied = []
  let clipboardAvailable = false
  const component = mount('Panels.tsx', 'DeliveryPanel', { projectId: 'p', assets: [{ assetId: 'asset-1', filename: 'synthetic.txt' }], archived: false }, {
    required: async operation => operation === 'linguistExportsPrepareAsset'
      ? { reportMarkdown, preflight: { ready: false, stageCounts: { confirmed: 2 }, segmentCount: 3, qa: { openErrors: 1 }, pendingProposalCount: 0, blockers: [] } }
      : [],
    writeClipboard: async text => { copied.push(text); return clipboardAvailable },
  })
  component.render(); await tick(); component.render()
  assert(!component.render().includes('复制 PM 审校报告'))
  component.click('仅运行预检'); await tick(); component.render()
  assert.equal(component.button('复制 PM 审校报告').size, 'sm')
  await component.click('复制 PM 审校报告'); await tick()
  assert.match(component.render(), /无法复制审校报告/)
  clipboardAvailable = true
  await component.click('复制 PM 审校报告'); await tick()
  assert.match(component.render(), /审校报告已复制/)
  assert.deepEqual(copied, [reportMarkdown, reportMarkdown])
  component.dispose()
})

test('project archive requires native confirmation, keeps failure visible, and preserves read-only follow-up', async () => {
  const requests = []
  let fail = true, changed = 0
  const project = { id: 'project-archive', name: 'Synthetic archive', sourceLocale: 'en-US', targetLocale: 'ja-JP', workflowStage: 'translation' }
  const component = mount('Panels.tsx', 'ProjectSettingsPanel', { project, hasBatches: false, onChanged() { changed++ } }, {
    required: async (operation, input) => {
      requests.push({ operation, input })
      if (operation === 'linguistProjectsArchive' && fail) throw new Error('Synthetic archive refused')
      return []
    },
  })
  component.render(); await tick(); component.render()
  component.click('归档项目'); component.render()
  assert(!requests.some(request => request.operation === 'linguistProjectsArchive'))
  const modal = component.nodes().find(node => node.type === 'modal')
  assert.equal(modal.props.title, '归档项目「Synthetic archive」？')
  assert.match(component.render(), /数据以只读方式保留，仍可打开查看和备份/)
  component.click('取消'); component.render()
  assert(!component.nodes().some(node => node.type === 'modal'))
  component.click('归档项目'); component.render()
  component.click('确认归档'); component.render()
  assert.equal(component.button('归档中…').disabled, true)
  await tick()
  assert.match(component.render(), /Synthetic archive refused/)
  assert.equal(changed, 0)
  fail = false
  component.click('确认归档'); await tick(); component.render()
  assert.deepEqual(JSON.parse(JSON.stringify(requests.filter(request => request.operation === 'linguistProjectsArchive').map(request => request.input))), [{ projectId: project.id }, { projectId: project.id }])
  assert.equal(changed, 1)
  assert(!component.nodes().some(node => node.type === 'modal'))
  component.render({ project: { ...project, archivedAt: '2026-09-30T00:00:00Z' } })
  assert.equal(component.button('归档项目').disabled, true)
  assert.match(component.render(), /归档项目为只读/)
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


test('compact project controls preserve all four roles, three work modes and Workspace identity', async () => {
  const workspaces = [
    { workspaceId: 'workspace-a', title: 'Shared', path: '/synthetic/a' },
    { workspaceId: 'workspace-b', title: 'Shared', path: '/synthetic/b' },
    { workspaceId: 'workspace-c', title: 'Unique', path: '/synthetic/c' },
  ]
  const projects = ['one', 'two'].map(id => ({ id, name: id, sourceLocale: 'en-US', targetLocale: 'ja-JP', workflowStage: 'translation', workspaceId: 'workspace-a', createdAt: '2026-09-29T00:00:00Z', updatedAt: '2026-09-29T01:00:00Z' }))
  const entered = [], openedProjects = [], requests = []
  let projectOpenError
  const component = mount('ProjectsPage.tsx', 'ProjectsPage', {
    workspaces: { list: { subscribe() { return () => {} }, getSnapshot() { return { items: workspaces } } } }, sessions: {},
    onEnter: async input => entered.push(input), onOpenProject: async id => { if (projectOpenError) throw projectOpenError; openedProjects.push(id) }, onOpenSession() {}, onPickDirectory() {},
  }, { required: async (operation, input) => {
    requests.push({ operation, input })
    if (operation === 'linguistProjectsList') return projects
    if (operation === 'linguistProjectsListFormatQualifications') return []
    if (operation === 'linguistProjectsGetSummary') return { totalSegments: 8, assetCount: 1 }
    if (operation === 'linguistProjectsCheckHealth') return { checks: [] }
    if (operation === 'linguistProjectsReorderActive') return {}
    throw new Error(operation)
  } })
  component.render(); await tick(); component.render(); await tick(); component.render()
  const select = label => component.nodes().find(node => node.type === 'select' && node.props['aria-label'] === label)
  const role = select('岗位'), mode = select('工作方式')
  assert(role, 'roles are a compact, labelled selector')
  assert(mode, 'work modes are a compact, labelled selector')
  assert.deepEqual(React.Children.toArray(role.props.children).map(node => node.props.value), ['general', 'translator', 'reviewer', 'proofreader'])
  assert.deepEqual(React.Children.toArray(mode.props.children).map(node => node.props.value), ['cat', 'working-copy', 'browser'])
  assert(!component.nodes().some(node => node.props?.role === 'radiogroup'))
  const picker = select('工作区')
  assert.deepEqual(React.Children.toArray(picker.props.children).slice(1).map(node => node.props.children), ['Shared · /synthetic/a', 'Shared · /synthetic/b', 'Unique'])
  role.props.onChange({ target: { value: 'reviewer' } }); mode.props.onChange({ target: { value: 'browser' } }); component.render()
  assert.equal(component.button('进入工作会话').variant, 'outline')
  await component.click('进入工作会话'); component.render()
  assert.deepEqual(JSON.parse(JSON.stringify(entered)), [{ projectId: 'one', workspaceId: 'workspace-a', role: 'reviewer', workMode: 'browser' }])
  const menus = component.nodes().filter(node => node.type === 'menu')
  assert.equal(menus.length, 2)
  assert.equal(menus[0].props.items.find(item => item.id === 'up').disabled, true)
  await menus[0].props.onSelect('down'); component.render(); await tick(); component.render()
  assert.deepEqual(Array.from(requests.find(request => request.operation === 'linguistProjectsReorderActive').input.orderedProjectIds), ['two', 'one'])
  assert.equal(component.button('one').variant, 'ghost')
  await component.click('one'); await tick(); component.render()
  assert.deepEqual(openedProjects, ['one'], 'project title uses ensure/open independently of explicit role/mode creation')
  assert.equal(entered.length, 1, 'opening the title does not call the explicit new-Session path')
  projectOpenError = new Error('Synthetic project open refused')
  await component.click('one'); await tick()
  assert.match(component.render(), /Synthetic project open refused/)
  assert.equal(component.button('one').disabled, false)
  component.dispose()
})

test('native project drag/drop submits the full active order, excludes archives, and keeps keyboard moves', async () => {
  const projects = ['one', 'hidden', 'two', 'three', 'archived'].map(id => ({ id, name: id, sourceLocale: 'en-US', targetLocale: 'ja-JP', workspaceId: id === 'hidden' ? 'workspace-b' : 'workspace-a', ...(id === 'archived' ? { archivedAt: '2026-09-29T00:00:00Z' } : {}), createdAt: '2026-09-29T00:00:00Z', updatedAt: '2026-09-29T01:00:00Z' }))
  const requests = []
  const component = mount('ProjectsPage.tsx', 'ProjectsPage', {
    workspaces: { list: { subscribe() { return () => {} }, getSnapshot() { return { items: [{ workspaceId: 'workspace-a', title: 'Synthetic', path: '/synthetic/a' }] } } } }, sessions: {}, onEnter() {}, onOpenSession() {}, onPickDirectory() {},
  }, { required: async (operation, input) => {
    if (operation === 'linguistProjectsList') return projects
    if (operation === 'linguistProjectsListFormatQualifications') return []
    if (operation === 'linguistProjectsGetSummary') return { totalSegments: 0, assetCount: 0 }
    if (operation === 'linguistProjectsCheckHealth') return { checks: [] }
    if (operation === 'linguistProjectsReorderActive') { requests.push(Array.from(input.orderedProjectIds)); return {} }
    throw new Error(operation)
  } })
  component.render(); await tick(); component.render(); await tick(); component.render()
  const row = id => component.nodes().find(node => node.type === 'li' && node.key.endsWith(`$${id}`))
  const title = id => component.nodes().find(node => node.type === 'button' && node.props.title === id)
  const dataTransfer = { setData(type, value) { assert.equal(type, 'text/plain'); assert.equal(value, 'one') } }
  const event = clientY => ({ clientY, dataTransfer, preventDefault() {}, currentTarget: { getBoundingClientRect: () => ({ top: 100, height: 40 }), contains: () => false } })
  assert.equal(title('one').props.draggable, true)
  title('one').props.onDragStart({ dataTransfer }); component.render()
  assert.equal(dataTransfer.effectAllowed, 'move')
  row('three').props.onDragOver(event(130)); component.render()
  assert.equal(row('three').props['data-drop-position'], 'after')
  row('three').props.onDrop(event(130)); component.render(); await tick(); component.render(); await tick(); component.render()
  assert.deepEqual(requests[0], ['hidden', 'two', 'three', 'one'])
  assert.equal(row('three').props['data-drop-position'], undefined)
  title('one').props.onDragStart({ dataTransfer }); component.render()
  row('two').props.onDragOver(event(110)); component.render()
  assert.equal(row('two').props['data-drop-position'], 'before')
  row('two').props.onDrop(event(110)); component.render(); await tick(); component.render(); await tick(); component.render()
  assert.deepEqual(requests[1], ['hidden', 'one', 'two', 'three'])
  title('one').props.onDragEnd(); component.render()
  row('two').props.onDrop(event(130)); await tick()
  assert.equal(requests.length, 2, 'external or cancelled drags do not reorder projects')
  component.nodes().find(node => node.type === 'checkbox').props.onChange(true); component.render()
  assert.equal(title('archived').props.draggable, false)
  const menus = component.nodes().filter(node => node.type === 'menu')
  assert.equal(menus.length, 3, 'archives have no reorder menu')
  menus[0].props.onSelect('down'); component.render(); await tick()
  assert.deepEqual(requests[2], ['two', 'hidden', 'one', 'three'])
  component.dispose()
})
