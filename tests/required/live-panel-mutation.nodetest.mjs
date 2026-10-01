import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'

const React = createRequire(new URL('../../packages/dsh-linguist/package.json', import.meta.url))('react')
const client = new URL('../../packages/dsh-linguist/src/client/', import.meta.url)
const compile = file => ts.transpileModule(readFileSync(new URL(file, client), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.React, target: ts.ScriptTarget.ES2022 } }).outputText
const proposalView = {}, workflow = {}
runInNewContext(compile('proposal-view.ts'), { exports: proposalView })
runInNewContext(compile('workflow-ui.ts'), { exports: workflow })
const code = compile('Panels.tsx')
const tick = () => new Promise(resolve => setImmediate(resolve))
const t = (key, params = {}) => key.replace(/\{(\w+)\}/g, (_, name) => String(params[name]))

// Run production hooks and components; substitute only external I/O and native primitives.
function mount(symbol, props, required, fetch) {
  const state = [], effects = [], callbacks = [], pending = [], exports = {}
  let cursor, effectCursor, callbackCursor, tree
  runInNewContext(`${code}\nexports.component = ${symbol};`, { exports, fetch, crypto: { randomUUID: () => 'synthetic-id' }, EventSource: class { addEventListener() {} close() {} }, require: name => {
    if (name === 'react') return { ...React,
      useState(initial) { const i = cursor++; if (!(i in state)) state[i] = typeof initial === 'function' ? initial() : initial; return [state[i], value => { state[i] = typeof value === 'function' ? value(state[i]) : value }] },
      useEffect(run, deps) { const i = effectCursor++; if (!effects[i] || deps.some((value, j) => value !== effects[i].deps[j])) pending.push(() => { effects[i]?.cleanup?.(); effects[i] = { deps, cleanup: run() } }) },
      useCallback(callback, deps) { const i = callbackCursor++; if (!callbacks[i] || deps.some((value, j) => value !== callbacks[i].deps[j])) callbacks[i] = { deps, value: callback }; return callbacks[i].value },
    }
    if (name === '@deepseek-ai/dsh-client-ui-primitives') return { Button: 'button', Input: 'input', Checkbox: 'checkbox', Modal: 'modal' }
    if (name === './api') return { required, stageFiles: async () => ['synthetic-staged-token'], fileUrl: token => `/la/v1/files/${token}` }
    if (name === './ui-locale') return { useT: () => t }
    if (name === './project-errors') return { describeProjectError: String }
    if (name === './qa-severity') return { qaSeverityTier: () => 'blocking', qaSeverityLabel: value => value, qaTierLabel: value => value }
    if (name === './proposal-view') return proposalView
    if (name === './workflow-ui') return workflow
    if (name === './ProjectLocaleSelect') return { ProjectLocaleSelect: 'locale-select' }
    if (name.endsWith('.module.css')) return { default: {} }
    return {}
  } })
  const children = node => [...React.Children.toArray(node.props?.children), ...React.Children.toArray(node.props?.footer)]
  const nodes = node => typeof node !== 'object' || node === null || (node.type === 'modal' && !node.props.open) ? [] : [node, ...children(node).flatMap(nodes)]
  const text = node => typeof node !== 'object' || node === null ? (typeof node === 'boolean' || node == null ? '' : String(node)) : node.type === 'modal' && !node.props.open ? '' : children(node).map(text).join('')
  return {
    render(next = {}) { Object.assign(props, next); cursor = effectCursor = callbackCursor = 0; tree = exports.component(props); pending.splice(0).forEach(run => run()); return text(tree) },
    nodes: () => nodes(tree),
    button(label) { const button = nodes(tree).find(node => node.type === 'button' && text(node) === label); assert(button, `Missing button ${label}`); return button.props },
    click(label) { const button = this.button(label); assert(!button.disabled, `${label} disabled`); return button.onClick() },
    dispose() { effects.forEach(effect => effect.cleanup?.()) },
  }
}

const common = { projectId: 'project-synthetic', mutation: 0, archived: false, onChanged() {}, onNavigate() {}, onSendAgentTask: async () => {}, onOpenBatchPreview() {} }
const segment = revision => ({ id: 'segment-synthetic', ordinal: 1, source: 'Synthetic source', target: `Synthetic Target r${revision}`, revision })

test('QA project history refreshes current Finding revision without requiring a batch or clearing waiver drafts', async () => {
  let revision = 2
  const requests = []
  const panel = mount('QaPanel', { ...common }, async (operation, input) => {
    requests.push({ operation, input })
    return { items: [{ id: 'finding-synthetic', segmentId: 'segment-synthetic', currentRevision: revision, segmentRevision: 2, status: 'open', severity: 'L2', code: 'synthetic', message: 'Synthetic Finding' }], total: 1 }
  })
  panel.render(); await tick(); panel.render()
  assert.equal(requests.length, 1)
  assert.equal(requests[0].input.projectId, common.projectId)
  assert.equal(requests[0].input.assetId, undefined)
  assert.equal(requests[0].input.segmentId, undefined)
  assert.equal(panel.button('运行 QA').disabled, true)
  panel.nodes().find(node => node.type === 'input' && node.props['aria-label'] === '豁免理由').props.onChange({ target: { value: 'Synthetic waiver draft' } })
  const findingNode = () => panel.nodes().find(node => node.type.name === 'QaFindingText')
  const disclosure = mount('QaFindingText', { ...findingNode().props }, async () => ({ segment: segment(revision) }))
  disclosure.render()
  disclosure.nodes().find(node => node.type === 'details').props.onToggle({ currentTarget: { open: true } })
  disclosure.render(); await tick(); assert.match(disclosure.render(), /当前 Target · r2/)
  revision = 3
  panel.render({ mutation: 1 }); await tick(); panel.render()
  assert.equal(requests.length, 2)
  assert.equal(findingNode().props.finding.currentRevision, 3)
  disclosure.render(findingNode().props); await tick()
  assert.match(disclosure.render(), /当前 Target · r3.*Synthetic Target r3/)
  assert.equal(panel.nodes().find(node => node.type === 'input' && node.props['aria-label'] === '豁免理由').props.value, 'Synthetic waiver draft')
  assert.match(panel.render(), /选择一个工作批次以运行 QA。/)
  panel.dispose(); disclosure.dispose()
})

test('Proposal list and focused diff refresh while edited text and captured batch/bulk CAS revisions stay intact', async () => {
  let revision = 2
  const requests = []
  const diff = () => ({ proposal: { id: 'proposal-synthetic', segmentId: 'segment-synthetic', status: 'pending', createdAt: '2026-10-01T00:00:00Z', evidenceRefs: [], termRefs: [], warnings: [] }, originalOrdinal: 1, source: 'Synthetic source', currentTarget: `Synthetic Target r${revision}`, proposedTarget: 'Synthetic proposal', currentRevision: revision, baseRevision: 2 })
  const panel = mount('ProposalPanel', { ...common, segmentIds: ['segment-synthetic'], focusProposalId: 'proposal-synthetic' }, async (operation, input) => {
    requests.push({ operation, input })
    if (operation === 'linguistProposalsList') return { items: [diff()], total: 1 }
    if (operation === 'linguistProposalsGetDiff') return diff()
    if (operation === 'linguistCatGetContext') return { segment: segment(revision) }
    if (operation === 'linguistProposalsApplyTranslations') return { requested: 1, applied: 0, pending: 1, stale: [], locked: [], failed: [] }
    return {}
  })
  panel.render(); await tick(); panel.render()
  panel.nodes().find(node => node.type === 'textarea' && node.props['aria-label'] === '编辑建议 proposal-synthetic').props.onChange({ target: { value: 'Synthetic edited proposal draft' } })
  panel.nodes().find(node => node.type === 'checkbox').props.onChange(true)
  panel.render(); panel.click('接受所选'); await tick(); panel.render()
  panel.click('读取所选句段 1 段'); await tick(); panel.render()
  panel.nodes().find(node => node.type === 'textarea' && !node.props['aria-label']).props.onChange({ target: { value: 'Synthetic batch draft' } })
  revision = 3
  const before = requests.length
  panel.render({ mutation: 1 }); await tick(); panel.render()
  assert.deepEqual(requests.slice(before).map(request => request.operation).sort(), ['linguistProposalsGetDiff', 'linguistProposalsList'])
  assert.equal(panel.nodes().find(node => node.type === 'textarea' && node.props['aria-label']).props.value, 'Synthetic edited proposal draft')
  assert.equal(panel.nodes().find(node => node.type === 'textarea' && !node.props['aria-label']).props.value, 'Synthetic batch draft')
  panel.click('创建待审建议'); await tick(); panel.render()
  assert.equal(requests.find(request => request.operation === 'linguistProposalsApplyTranslations').input.edits[0].baseRevision, 2)
  panel.click('确认批量处理'); await tick()
  assert.equal(requests.find(request => request.operation === 'linguistProposalsAcceptSelected').input.items[0].expectedRevision, 2)
  panel.dispose()
})

test('Reference query and conflicts refresh on mutation without replacing an unsaved term', async () => {
  const requests = []
  const panel = mount('ReferencePanel', { ...common, segmentIds: [] }, async operation => { requests.push(operation); return operation === 'linguistReferencesListTermConflicts' ? { conflicts: [], count: 0 } : { items: [] } })
  panel.render(); await tick(); panel.render()
  panel.nodes().find(node => node.type === 'input' && node.props['aria-label'] === '术语').props.onChange({ target: { value: 'Synthetic term draft' } })
  panel.render({ mutation: 1 }); await tick(); panel.render()
  assert.deepEqual(requests, ['linguistReferencesQueryTerms', 'linguistReferencesListTermConflicts', 'linguistReferencesQueryTerms', 'linguistReferencesListTermConflicts'])
  assert.equal(panel.nodes().find(node => node.type === 'input' && node.props['aria-label'] === '术语').props.value, 'Synthetic term draft')
  panel.dispose()
})

test('Assets query and summary refresh on mutation without replacing unsaved resource text', async () => {
  const requests = []
  const panel = mount('AssetsPanel', { ...common }, async operation => { requests.push(operation); return operation === 'linguistProjectsGetSummary' ? { assets: [] } : { items: [] } })
  panel.render(); await tick(); panel.render()
  const field = panel.nodes().find(node => node.type === 'input' && node.props['aria-label'] === '文档备注')
  field.props.onChange({ target: { value: 'Synthetic asset draft' } })
  panel.render({ mutation: 1 }); await tick(); panel.render()
  assert.deepEqual(requests, ['linguistAssetsQuery', 'linguistProjectsGetSummary', 'linguistAssetsQuery', 'linguistProjectsGetSummary'])
  assert(panel.nodes().some(node => node.type === 'input' && node.props.value === 'Synthetic asset draft'))
  panel.dispose()
})

test('Delivery mutation invalidates prepared state, refreshes exports and retains the issued download without auto-preparing', async () => {
  const requests = []
  const panel = mount('DeliveryPanel', { ...common, assets: [{ assetId: 'asset-synthetic', filename: 'synthetic.txt' }] }, async operation => { requests.push(operation); return [] }, async () => ({ ok: true, json: async () => ({ token: 'issued-token', filename: 'synthetic.txt', preparation: { reportMarkdown: '# Synthetic preflight report', preflight: { ready: true, stageCounts: {}, qa: {}, blockers: [] } } }) }))
  panel.render(); await tick(); panel.render()
  panel.click('按当前状态导出'); panel.render(); panel.click('确认按当前状态导出'); await tick(); panel.render()
  assert.match(panel.render(), /Synthetic preflight report/)
  const before = requests.length
  panel.render({ mutation: 1 }); await tick()
  assert(!panel.render().includes('Synthetic preflight report'))
  assert.deepEqual(requests.slice(before), ['linguistExportsList'])
  assert.equal(panel.nodes().find(node => node.type === 'a').props.href, '/la/v1/files/issued-token')
  assert(!requests.includes('linguistExportsPrepareAsset'))
  panel.dispose()
})

test('Settings mutation scans unknown tags while preserving dirty fields and native project-history shortcuts', async () => {
  const project = { id: common.projectId, name: 'Synthetic project', sourceLocale: 'en-US', targetLocale: 'ja-JP' }
  const requests = [], tabs = []
  const panel = mount('ProjectSettingsPanel', { project, mutation: 0, hasBatches: false, onChanged() {}, onOpenHistory: tab => tabs.push(tab) }, async operation => { requests.push(operation); return [] })
  panel.render(); await tick(); panel.render()
  panel.nodes().find(node => node.type === 'input' && node.props.value === project.name).props.onChange({ target: { value: 'Synthetic dirty name' } })
  panel.nodes().find(node => node.type === 'input' && node.props['aria-label'] === 'Tag 正则').props.onChange({ target: { value: 'Synthetic dirty tag regex' } })
  panel.nodes().find(node => node.type === 'locale-select' && node.props.label === '目标语言').props.onValueChange('zh-CN')
  const before = requests.length
  panel.render({ mutation: 1 }); await tick(); panel.render()
  assert.deepEqual(requests.slice(before), ['linguistProjectsScanUnknownTags'])
  assert(panel.nodes().some(node => node.type === 'input' && node.props.value === 'Synthetic dirty name'))
  assert.equal(panel.nodes().find(node => node.type === 'input' && node.props['aria-label'] === 'Tag 正则').props.value, 'Synthetic dirty tag regex')
  assert.equal(panel.nodes().find(node => node.type === 'locale-select' && node.props.label === '目标语言').props.value, 'zh-CN')
  for (const label of ['QA 历史', '建议历史']) { assert.equal(panel.button(label).variant, 'outline'); assert.equal(panel.button(label).size, 'sm'); panel.click(label) }
  assert.deepEqual(tabs, ['qa', 'proposals'])
  panel.dispose()
})


test('Reference XLSX import requires explicit sheet and distinct columns before preview and confirmation', async () => {
  const requests = []
  const bound = { cancelled: false, requiresConfirmation: true, filename: 'synthetic.xlsx', candidateId: 'synthetic-staged-token', sourceSha256: 'a'.repeat(64) }
  const sheet = { name: 'Synthetic references', state: 'visible', columns: [{ index: 0, header: 'English', selectable: true }, { index: 1, header: 'Chinese', selectable: true }, { index: 2, header: 'French', selectable: true }], sampleRows: [{ rowNo: 2, cells: [{ columnIndex: 0, value: 'Open' }, { columnIndex: 1, value: '打开' }, { columnIndex: 2, value: 'Ouvrir' }] }] }
  const panel = mount('ReferencePanel', { ...common, segmentIds: [] }, async (operation, input) => {
    requests.push({ operation, input })
    if (operation === 'linguistReferencesListTermConflicts') return { conflicts: [], count: 0 }
    if (operation === 'linguistReferencesImport') return { ...bound, requiresXlsxMapping: true, preview: { sheets: [sheet] } }
    if (operation === 'linguistReferencesMapXlsxCandidate') return { ...bound, requiresXlsxMapping: false, summary: { entryCount: 1, warnings: [], samples: [{ kind: 'terms', term: 'Open', translation: '打开', status: 'preferred' }] } }
    if (operation === 'linguistReferencesConfirmImport') return { imported: 1 }
    return { items: [] }
  })
  panel.render(); await tick(); panel.render()
  panel.nodes().find(node => node.type === 'input' && node.props.type === 'file').props.onChange({ target: { files: [{ name: 'synthetic.xlsx' }], value: 'synthetic.xlsx' } })
  await tick(); panel.render()
  assert(panel.button('预览参考候选').disabled)
  assert(!panel.nodes().some(node => node.type === 'button' && node.props.children === '确认导入'))
  const field = label => panel.nodes().find(node => node.type === 'select' && node.props['aria-label'] === label).props
  for (const label of ['工作表', '源文列', '译文列']) assert.equal(field(label).value, '', 'never guess a sheet or language column')
  assert(field('参考类别').disabled)
  field('工作表').onChange({ target: { value: sheet.name } }); panel.render()
  field('源文列').onChange({ target: { value: 'English' } }); panel.render()
  field('译文列').onChange({ target: { value: 'English' } }); panel.render()
  assert(panel.button('预览参考候选').disabled)
  field('译文列').onChange({ target: { value: 'Chinese' } }); panel.render()
  assert.equal(panel.button('预览参考候选').variant, 'outline')
  assert.equal(panel.button('预览参考候选').size, 'sm')
  await panel.click('预览参考候选'); await tick(); panel.render()
  const request = requests.find(item => item.operation === 'linguistReferencesMapXlsxCandidate')
  assert.equal(request.input.projectId, common.projectId)
  assert.equal(request.input.kind, 'terms')
  assert.equal(request.input.candidateId, bound.candidateId)
  assert.equal(request.input.sourceSha256, bound.sourceSha256)
  assert.equal(request.input.sheetName, sheet.name)
  assert.deepEqual(JSON.parse(JSON.stringify(request.input.columns)), { source: 'English', target: 'Chinese' })
  assert.equal(panel.button('确认导入').variant, 'primary')
  await panel.click('确认导入'); await tick(); panel.render()
  assert(requests.some(item => item.operation === 'linguistReferencesConfirmImport' && item.input.candidateId === bound.candidateId))
  assert(!panel.nodes().some(node => node.type === 'button' && node.props.children === '预览参考候选'))
  panel.dispose()
})
