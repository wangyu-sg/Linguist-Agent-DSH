import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import test, { mock } from 'node:test'

const JSZip = createRequire(new URL('../../packages/linguist-cat-formats/package.json', import.meta.url))('jszip')

let semanticCalls = 0
mock.module('../../packages/linguist-domain-service/src/semantic-review.ts', { namedExports: { checkSemanticModel: async () => ({ available: true, model: 'synthetic' }), getSemanticReview: async (_cache, segments) => { semanticCalls++; return ({
  status: 'ready', model: 'synthetic', fingerprint: 'synthetic', embedded: segments.length, cached: 0, reusedGroups: true,
  groups: segments.length > 1 ? [{ anchorId: segments[0].id, segmentIds: [segments[0].id, segments.at(-1).id] }] : [],
}) } } })
const { createWorkingCopyTool } = await import('../../packages/dsh-linguist/src/host/working-copy-tool.ts')
const { prepareWorkingCopy } = await import('../../packages/linguist-domain-service/src/working-copy.ts')
const { runQa, QA_RULE_CODES } = await import('../../packages/linguist-cat-core/src/qa-core.ts')
const { createReviewMaterialsTool } = await import('../../packages/dsh-linguist/src/host/review-materials-tool.ts')
const { settingsOperation } = await import('../../packages/dsh-linguist/src/host/settings.ts')
const { semanticCachePath } = await import('../../packages/linguist-domain-service/src/review-materials.ts')
const { LinguistProjectService } = await import('../../packages/linguist-domain-service/src/project-service.ts')
const { createCatDeps } = await import('../../packages/dsh-linguist/src/host/cat-deps.ts')
const { createLinguistCatTools } = await import('../../packages/linguist-cat-tools/src/index.ts')
const { adaptCatTool } = await import('../../packages/dsh-linguist/src/host/tool-adapter.ts')
const { createLinguistDelegationTool } = await import('../../packages/dsh-linguist/src/host/delegation-tool.ts')
const { SessionReadSnapshots } = await import('../../packages/dsh-linguist/src/host/read-snapshots.ts')
const { loadProfessionalResources } = await import('../../packages/dsh-linguist/src/host/professional-context.ts')
const professional = loadProfessionalResources(new URL('../../packages/dsh-linguist/resources/professional-judgment/', import.meta.url))

test('parsed original reuse cannot retain draft edits and refreshes when file bytes change', async () => {
  const root = mkdtempSync(join(tmpdir(), 'la-parsed-original-'))
  try {
    const path = join(root, 'source.csv')
    writeFileSync(path, 'key,source,target\none,Original,初稿\n')
    const input = { workspaceRoot: root, sourcePath: 'source.csv', sourceLocale: 'en', targetLocale: 'zh-CN' }
    const first = await prepareWorkingCopy(input)
    first.segments[0].target = '临时修改'
    assert.equal((await prepareWorkingCopy(input)).segments[0].target, '初稿')
    writeFileSync(path, 'key,source,target\none,Updated,新稿\n')
    const changed = await prepareWorkingCopy(input)
    assert.equal(changed.segments[0].source, 'Updated')
    assert.equal(changed.segments[0].target, '新稿')
  } finally { rmSync(root, { recursive: true, force: true }) }
})

test('CAT, online snapshots/exports and working copies share retrieval without writing review decisions', async () => {
  const root = mkdtempSync(join(tmpdir(), 'la-review-modes-'))
  const service = new LinguistProjectService({ rootDir: join(root, 'cat'), applicationVersion: 'synthetic-test' })
  service.init()
  try {
    const project = await service.createProject({ name: 'Synthetic shared review', sourceLocale: 'en', targetLocale: 'zh-CN' })
    const db = service.openProject(project.id)
    db.termEntries.upsert({ term: 'potion', translation: '药水', status: 'allowed', caseSensitive: false, note: 'Keep this TB evidence' })
    writeFileSync(join(root, 'source.csv'), `key,source,target\n${Array.from({ length: 55 }, (_, i) => `${i},Use potion ${i},原译${i}`).join('\n')}\n`)
    const context = { workspaceRoot: root, sessionId: 'synthetic', taskId: 'whole-review', project: { service, projectId: project.id } }
    const working = createWorkingCopyTool(() => context, async () => {})
    const args = { sourcePath: 'source.csv', sourceLocale: 'en', targetLocale: 'zh-CN' }
    const exec = { signal: new AbortController().signal, callId: 'synthetic', rootCallId: 'synthetic' }
    const initialCalls = semanticCalls
    const prepared = await working.execute({ ...args, operation: 'prepare' }, exec)
    const refs = await working.execute({ ...args, operation: 'references', previousResultPath: prepared.path }, exec)
    const rows = db.segments.query({ limit: 100 })
    const tool = createReviewMaterialsTool(service, async () => ({ workspaceRoot: root, projectId: project.id, taskId: 'whole-review' }))
    const cat = await tool.execute({ batchIds: [rows[0].assetId] }, exec)
    for (const [entry, result] of [[working, refs], [tool, cat]]) {
      const received = entry.output.render({}, result).map(block => block.text).join('\n')
      assert.match(received, /Use potion 54/, 'normal first review input includes the distant related source without opening a related file')
      assert.match(received, /原译54/, 'normal input includes the related current target')
      assert.match(received, /Keep this TB evidence/)
      assert.match(received, /不是错误/)
    }
    assert.deepEqual(cat.coverage, { loaded: 55, expected: 55, complete: true })
    assert.equal(cat.semantic.embedded, 0)
    assert.equal(semanticCalls - initialCalls, 1, 'whole working-copy and CAT scopes share one calculation')
    const catData = JSON.parse(readFileSync(join(root, dirname(cat.readingPath), 'materials.json'), 'utf8'))
    const workingData = JSON.parse(readFileSync(join(root, refs.path), 'utf8'))
    assert.deepEqual(catData.semantic.groups, workingData.semantic.groups)
    assert.equal(catData.items.length, 55)
    assert.ok(catData.items.every(item => item.allowedTerms[0].note === 'Keep this TB evidence'))
    const unused = () => { throw new Error('Review reading must not call a write/decision hook') }
    const deps = createCatDeps({
      professional, service, projectId: project.id, sessionId: 'reviewer', taskId: 'whole-review', role: 'reviewer', sessionCwd: root,
      readSnapshots: new Map(), attachments: {}, assertBound: () => {},
      authorizeReadPath: unused, authorizeWritePath: unused, discoveryScope: unused, onMutation: unused,
      prepareStage: unused, prepareContextDoc: unused, onEvidencePrepared: unused, generationProvenance: unused,
      stageEvidenceRunId: () => undefined, reviewScopeSegmentIds: () => undefined, delegatedScopeSegmentIds: () => undefined,
    })
    const nativeRead = adaptCatTool(createLinguistCatTools(deps).find(tool => tool.name === 'cat_get_segments'), {})
    const normal = await nativeRead.execute({ batchId: rows[0].assetId, limit: 2 }, exec)
    const visible = nativeRead.output.render({}, normal).map(block => block.text).join('\n')
    assert.match(visible, /Use potion 54/, 'native normal CAT read carries remote relation without separate material lookup')
    assert.match(visible, /Keep this TB evidence/)
    assert.equal(normal.details.coverage.loaded, 55, 'legacy page size does not slice review scope')
    assert.match(visible, /continuationPaths/)
    const fullReading = [normal.details.readingContent, ...normal.details.continuationPaths.map(path => readFileSync(join(root, path), 'utf8'))].join('\n')
    for (const row of rows) {
      assert.ok(fullReading.includes(row.source))
      assert.ok(fullReading.includes(row.target))
    }
    assert.equal((normal.details.readingContent.match(/Keep this TB evidence/g) ?? []).length, 1, 'shared TB is printed once per group')
    const agent = { id: 'parent' }
    let prompt, childBinding
    const delegate = createLinguistDelegationTool({ service, agent,
      binding: { workspaceId: 'synthetic', projectId: project.id, role: 'general', workMode: 'cat', batchStart: { batchId: rows[0].assetId, useCat: true } },
      resolveSessionWorkspace: async () => ({ workspaceRoot: root }), reserveIntent: (_id, binding) => { childBinding = binding; return () => {} }, control: {},
      subagents: { resolveMaxDepth: () => undefined, startActivation: async spec => {
        prompt = spec.prompt[0].text
        assert.equal(Object.hasOwn(spec, 'agentOptions'), false, 'selected model is inherited')
        return { childId: spec.childId, messageId: 'synthetic' }
      } },
    })
    await delegate.tool.execute({ role: 'reviewer', objective: 'Independently review the full batch',
      expectedOutcome: 'Necessary corrections and unresolved questions', scope: { batchIds: [rows[0].assetId] } }, { ...exec, agent })
    assert.match(prompt, /Use potion 54/)
    assert.match(prompt, /Keep this TB evidence/)
    assert.match(prompt, /Parent drafts and conclusions are review inputs, not client approval/)
    assert.doesNotMatch(prompt, /paged cat_get_segments|Use cat_list_batches/)
    const related = await settingsOperation(service, 'linguistCatRelated', { projectId: project.id, segmentId: rows[0].id })
    assert.equal(related.segments[0].id, rows.at(-1).id)
    db.segments.applyTargetEdit(rows.at(-1).id, '最新已保存译文', rows.at(-1).revision)
    const refreshed = await settingsOperation(service, 'linguistCatRelated', { projectId: project.id, segmentId: rows[0].id })
    assert.equal(refreshed.segments[0].target, '最新已保存译文')
    assert.equal(semanticCalls - initialCalls, 1, 'target edits never invalidate source retrieval')
    const snapshotRows = db.segments.getByIds(rows.map(row => row.id)).map(({ id, ordinal, key, source, target, locked }) => ({ id, ordinal, key, source, target, locked }))
    writeFileSync(join(root, 'online.json'), JSON.stringify({ segments: snapshotRows }))
    const online = { url: 'https://example.test/review', expectedSegments: 55, observedAt: '2026-11-13T00:00:00Z' }
    const browser = await tool.execute({ snapshotPath: 'online.json', online }, exec)
    assert.match(tool.output.render({}, browser).map(block => block.text).join('\n'), /最新已保存译文/,
      'the normal online input automatically includes the latest related target')
    assert.equal(browser.semantic.embedded, 0)
    assert.equal(semanticCalls - initialCalls, 1)
    const browserData = JSON.parse(readFileSync(join(root, dirname(browser.readingPath), 'materials.json'), 'utf8'))
    assert.deepEqual(browserData.semantic.groups, catData.semantic.groups)
    assert.equal(browserData.items[0].status, 'ready')
    assert.match(browserData.items[0].warnings.join(' '), /平台 TM／TB/)
    const browserText = readFileSync(join(root, dirname(browser.readingPath), 'group-1.md'), 'utf8')
    assert.match(browserText, /最新已保存译文/)
    assert.match(browserText, /不是错误/)
    const partial = await tool.execute({ snapshotPath: 'online.json', online: { ...online, expectedSegments: 60 } }, exec)
    assert.equal(partial.coverage.complete, false)
    assert.match(readFileSync(join(root, partial.readingPath), 'utf8'), /范围尚未取齐/)
    const exported = await tool.execute({ ...args, online }, exec)
    assert.equal(exported.coverage.loaded, 55)
    assert.equal(db.assets.listByProject().length, 1, 'browser export is not imported into CAT')
    assert.deepEqual(db.segments.getByIds(rows.map(row => row.id)).map(row => row.target), snapshotRows.map(row => row.target))
    assert.equal(db.stageEvidence.list().length, 0, 'retrieval never becomes independent review completion')
    await assert.rejects(tool.execute({ snapshotPath: 'online.json', online, batchIds: [rows[0].assetId] }, exec), /不能混用/)
    const delegated = createReviewMaterialsTool(service, async () => ({ workspaceRoot: root, projectId: project.id, taskId: 'child', allowedIds: [rows[0].id] }))
    await assert.rejects(delegated.execute({ segmentIds: [rows[1].id] }, exec), /超出子任务范围/)
    // Reading the supplied groups is sufficient to save; no second TM/TB read for a token.
    const writable = { ...deps, prepareStage: () => {}, onMutation: () => {}, generationProvenance: () => ({ sessionId: 'reviewer' }) }
    const apply = createLinguistCatTools(writable).find(item => item.name === 'cat_apply_translations')
    const saved = await apply.execute('save-normal', { snapshotIds: [normal.details.snapshotId], edits: [{ segmentId: rows[0].id, target: '审校修订0' }] })
    assert.equal(saved.details.applied, 1)
    const stale = await apply.execute('reject-stale', { snapshotIds: [normal.details.snapshotId], edits: [{ segmentId: rows.at(-1).id, target: '不应覆盖人工修改' }] })
    assert.deepEqual(stale.details.stale, [rows.at(-1).id])
    assert.equal(db.segments.getById(rows.at(-1).id).target, '最新已保存译文')
    const query = { observeSession: async () => ({ header: { id: 'child' }, events: [], inheritedEventCount: 0, [Symbol.dispose]() {} }) }
    const childReads = new SessionReadSnapshots(query, 'child', project.id, childBinding.reviewSnapshot)
    const childApply = createLinguistCatTools({ ...writable, sessionId: 'child', readSnapshots: childReads }).find(item => item.name === 'cat_apply_translations')
    const childResult = await childReads.run(() => childApply.execute('save-child', { snapshotIds: [childBinding.reviewSnapshot.id], edits: [{ segmentId: rows[1].id, target: '独立审校修订1' }] }))
    assert.equal(childResult.details.applied, 1, 'child can use the version supplied with its initial reading material')
    assert.ok(childResult.readSnapshots, 'native result persists applied revisions for restart')
    assert.doesNotMatch(prompt, new RegExp(childBinding.reviewSnapshot.id), 'the host keeps the read snapshot without making the reviewer copy its ID')
    const ownReads = new SessionReadSnapshots(query, 'child', project.id)
    const ownMaterials = createReviewMaterialsTool(service, async () => ({ workspaceRoot: root, projectId: project.id, taskId: 'child' }), ownReads)
    const ownResult = await ownMaterials.execute({ segmentIds: [rows[2].id] }, exec)
    assert.ok(ownMaterials.output.presentationMeta({}, ownResult).readSnapshots)
    assert.doesNotMatch(ownMaterials.output.render({}, ownResult)[0].text, /readSnapshots/, 'private version arrays stay out of model context')
    const ownApply = createLinguistCatTools({ ...writable, readSnapshots: ownReads }).find(item => item.name === 'cat_apply_translations')
    assert.equal((await ownReads.run(() => ownApply.execute('save-materials', { snapshotIds: [ownResult.snapshotId], edits: [{ segmentId: rows[2].id, target: '材料审校修订2' }] }))).details.applied, 1)
  } finally { service.closeAll(); rmSync(root, { recursive: true, force: true }) }
})

test('settings persist global retrieval preference while clearing only the chosen project semantic cache', async () => {
  const root = mkdtempSync(join(tmpdir(), 'la-review-settings-'))
  const options = { rootDir: join(root, 'cat'), applicationVersion: 'synthetic-test' }
  const service = new LinguistProjectService(options)
  service.init()
  try {
    const first = await service.createProject({ name: 'First synthetic project', sourceLocale: 'en', targetLocale: 'zh-CN' })
    const second = await service.createProject({ name: 'Second synthetic project', sourceLocale: 'en', targetLocale: 'fr' })
    const cache = semanticCachePath(service, first.id), other = semanticCachePath(service, second.id)
    writeFileSync(cache, 'rebuildable synthetic data'); writeFileSync(other, 'other project')
    const before = service.getProject(first.id)
    const info = await settingsOperation(service, 'linguistSettingsGet', {})
    assert.ok(info.projects.find(item => item.id === first.id).cache.bytes > 0)
    await settingsOperation(service, 'linguistSettingsSemantic', { enabled: false })
    const calls = semanticCalls
    assert.equal((await service.reviewCache.get(cache, [])).status, 'disabled')
    assert.equal(semanticCalls, calls)
    assert.deepEqual(service.getProject(first.id), before, 'global preference does not rewrite project QA or language rules')
    await settingsOperation(service, 'linguistSettingsClearCache', { projectId: first.id })
    assert.equal(existsSync(cache), false)
    assert.equal(readFileSync(other, 'utf8'), 'other project')
    assert.deepEqual(service.getProject(first.id), before)
    const reopened = new LinguistProjectService(options)
    try { assert.equal(reopened.reviewCache.enabled, false) } finally { reopened.closeAll() }
    await settingsOperation(service, 'linguistSettingsSemantic', { enabled: true })
    assert.equal((await service.reviewCache.get(cache, [])).status, 'ready')
    assert.equal(semanticCalls, calls + 1)
    await assert.rejects(settingsOperation(service, 'linguistSettingsClearCache', { projectId: '../other' }), /项目 ID 无效/)
  } finally { service.closeAll(); rmSync(root, { recursive: true, force: true }) }
})

test('native working-copy entry accepts a coherent group larger than 50 and returns its references', async () => {
  const root = mkdtempSync(join(tmpdir(), 'la-native-reference-tool-'))
  const service = new LinguistProjectService({ rootDir: join(root, 'cat'), applicationVersion: 'synthetic-test' })
  service.init()
  try {
    const project = await service.createProject({ name: 'Synthetic native group', sourceLocale: 'en', targetLocale: 'zh-CN' })
    const db = service.openProject(project.id)
    db.termEntries.upsert({ term: 'potion', translation: '药水', status: 'allowed', caseSensitive: false, note: 'Synthetic note' })
    writeFileSync(join(root, 'source.csv'), `key,source,target\n${Array.from({ length: 55 }, (_, i) => `${i},Use potion ${i},`).join('\n')}\n`)
    const tool = createWorkingCopyTool(() => ({ workspaceRoot: root, sessionId: 'synthetic', taskId: 'synthetic-task', project: { service, projectId: project.id } }), async () => {})
    const args = { sourcePath: 'source.csv', sourceLocale: 'en', targetLocale: 'zh-CN' }
    const exec = { signal: new AbortController().signal, callId: 'synthetic-call', rootCallId: 'synthetic-root' }
    const prepared = await tool.execute({ ...args, operation: 'prepare' }, exec)
    const references = await tool.execute({ ...args, operation: 'references', previousResultPath: prepared.path }, exec)
    const data = JSON.parse(readFileSync(join(root, references.path), 'utf8'))
    assert.equal(data.items.length, 55)
    assert.ok(data.items.every(item => item.status === 'ready' && item.allowedTerms[0].note === 'Synthetic note'))
    assert.equal(references.pending, 0)
    assert.equal(references.failed, 0)
    assert.equal(references.semantic.status, 'ready')
    assert.equal(data.semantic.groups[0].segmentIds.length, 2)
    const related = readFileSync(join(root, dirname(references.readingPath), 'group-1.md'), 'utf8')
    assert.match(related, /Use potion 54/)
    assert.match(related, /不是错误/)
    assert.match(readFileSync(join(root, references.readingPath), 'utf8'), /完整范围 55 条/)
    const reading = [references.readingContent, ...references.continuationPaths.map(path => readFileSync(join(root, path), 'utf8'))].join('\n')
    for (let i = 0; i < 55; i++) assert.ok(reading.includes(`Use potion ${i}`), 'the full scope remains available in one reference request')
  } finally { service.closeAll(); rmSync(root, { recursive: true, force: true }) }
})

test('file and online delegation use the selected role and task-specific references without importing a CAT batch', async t => {
  const root = mkdtempSync(join(tmpdir(), 'la-task-review-'))
  const importReference = LinguistProjectService.prototype.importReference
  const imports = t.mock.method(LinguistProjectService.prototype, 'importReference', function (...args) { return importReference.apply(this, args) })
  const service = new LinguistProjectService({ rootDir: join(root, 'cat'), applicationVersion: 'synthetic-test' })
  service.init()
  try {
    const project = await service.createProject({ name: 'Existing synthetic project', sourceLocale: 'en', targetLocale: 'zh-CN' })
    const db = service.openProject(project.id)
    db.termEntries.upsert({ term: 'potion', translation: '旧名称', status: 'allowed', caseSensitive: false })
    writeFileSync(join(root, 'source.csv'), 'key,source,target\na,Use potion 10,原译\nb,Use potion 20,另一译\n')
    writeFileSync(join(root, 'terms.csv'), 'term,target,note\npotion,新名称,本批术语说明\n')
    writeFileSync(join(root, 'memory.csv'), 'source,target\nUse potion 10,使用10个新名称\n')
    const agent = { id: 'parent' }
    let prompt, childBinding
    const delegate = createLinguistDelegationTool({ service, agent,
      binding: { workspaceId: 'workspace', projectId: project.id, role: 'general', workMode: 'working-copy', batchStart: { batchId: 'synthetic', useCat: false, order: 'Review the draft' } },
      resolveSessionWorkspace: async () => ({ workspaceRoot: root }),
      reserveIntent: (_id, binding) => { childBinding = binding; return () => {} }, control: {},
      subagents: { resolveMaxDepth: () => undefined, startActivation: async spec => {
        prompt = spec.prompt[0].text
        return { childId: spec.childId, messageId: 'started' }
      } },
    })
    const referenceFiles = [{ path: 'terms.csv', kind: 'terms' }, { path: 'memory.csv', kind: 'tm' }]
    const exec = { agent, signal: new AbortController().signal, callId: 'synthetic', rootCallId: 'synthetic' }
    await delegate.tool.execute({ role: 'reviewer', objective: 'Review the file', scope: {
      sourcePath: 'source.csv', sourceLocale: 'en', targetLocale: 'zh-CN', referenceFiles,
    } }, exec)
    assert.equal(childBinding.role, 'reviewer')
    assert.equal(childBinding.workMode, 'working-copy')
    assert.match(prompt, /Use potion 20/)
    assert.match(prompt, /另一译/)
    assert.match(prompt, /本批术语说明/)
    assert.match(prompt, /使用10个新名称/)
    assert.match(prompt, /旧名称/, 'temporary terms supplement applicable project terminology and preserve conflicts')
    assert.equal(db.assets.listByProject().length, 0)
    assert.equal(imports.mock.calls.length, 2)

    const working = createWorkingCopyTool(() => ({ workspaceRoot: root, sessionId: 'draft', service }), async () => {})
    const prepared = await working.execute({ operation: 'prepare', sourcePath: 'source.csv', sourceLocale: 'en', targetLocale: 'zh-CN' }, exec)
    const draft = JSON.parse(readFileSync(join(root, prepared.path), 'utf8'))
    draft.segments[0].target = '最新工作稿译文'
    writeFileSync(join(root, prepared.path), JSON.stringify(draft))
    const workingReferences = await working.execute({ operation: 'references', sourcePath: 'source.csv', previousResultPath: prepared.path,
      sourceLocale: 'en', targetLocale: 'zh-CN', referenceFiles }, exec)
    assert.match(workingReferences.readingContent, /最新工作稿译文/)
    assert.match(workingReferences.readingContent, /本批术语说明/)
    assert.equal(db.assets.listByProject().length, 0)
    const subset = await working.execute({ operation: 'references', sourcePath: 'source.csv', previousResultPath: prepared.path,
      sourceLocale: 'en', targetLocale: 'zh-CN', referenceFiles, segmentIds: [draft.segments[0].id] }, exec)
    assert.equal(subset.coverage.loaded, 1)
    assert.match(subset.readingContent, /另一译/, 'related rows remain available as context outside the selected review scope')
    const afterWorkingImports = imports.mock.calls.length
    await delegate.tool.execute({ role: 'reviewer', objective: 'Review the current draft', scope: {
      sourcePath: 'source.csv', previousResultPath: prepared.path, sourceLocale: 'en', targetLocale: 'zh-CN', referenceFiles,
    } }, exec)
    assert.match(prompt, /最新工作稿译文/)
    assert.equal(imports.mock.calls.length, afterWorkingImports, 'unchanged task references are not re-imported when only the draft target changes')

    writeFileSync(join(root, 'online.json'), JSON.stringify({ segments: [
      { id: 'platform-1', ordinal: 0, source: 'Use potion 10', target: '线上译文', locked: false },
      { id: 'platform-2', ordinal: 1, source: 'Use potion 20', target: '关联译文', locked: false },
    ] }))
    await delegate.tool.execute({ role: 'reviewer', objective: 'Review the online snapshot', scope: {
      snapshotPath: 'online.json', sourceLocale: 'en', targetLocale: 'zh-CN', referenceFiles,
      online: { url: 'https://example.test/review', expectedSegments: 2, observedAt: '2026-11-15T00:00:00Z' },
    } }, exec)
    assert.equal(childBinding.workMode, 'browser')
    assert.match(prompt, /platform-2/)
    assert.match(prompt, /关联译文/)
    assert.match(prompt, /本批术语说明/)
    assert.match(prompt, /平台 TM／TB/)
    assert.equal(imports.mock.calls.length, afterWorkingImports, 'the same temporary sources are reused for online review; platform warnings are supplied anew')
    assert.equal(db.assets.listByProject().length, 0)
    writeFileSync(join(root, 'terms.csv'), 'term,target,note\npotion,更新名称,术语已更新\n')
    await delegate.tool.execute({ role: 'reviewer', objective: 'Review updated references', scope: {
      sourcePath: 'source.csv', sourceLocale: 'en', targetLocale: 'zh-CN', referenceFiles,
    } }, exec)
    assert.match(prompt, /术语已更新/)
    assert.equal(imports.mock.calls.length, afterWorkingImports + 2, 'changed reference bytes invalidate the cached matches')
    const incomplete = [{ path: 'terms.csv', kind: 'terms' }, { path: 'missing.csv', kind: 'tm' }]
    await delegate.tool.execute({ role: 'reviewer', objective: 'Review remaining available evidence', scope: {
      sourcePath: 'source.csv', sourceLocale: 'en', targetLocale: 'zh-CN', referenceFiles: incomplete,
    } }, exec)
    assert.match(prompt, /术语已更新/, 'a missing TM does not discard the available TB')
    assert.match(prompt, /missing.csv.*未能读取/)
    assert.match(prompt, /本批 TM 未成功准备/)
    writeFileSync(join(root, 'missing.csv'), 'source,target\nUse potion 10,已补充的历史译文\n')
    await delegate.tool.execute({ role: 'reviewer', objective: 'Review after the TM is restored', scope: {
      sourcePath: 'source.csv', sourceLocale: 'en', targetLocale: 'zh-CN', referenceFiles: incomplete,
    } }, exec)
    assert.match(prompt, /已补充的历史译文/, 'a failed reference is retried after it is restored')
    assert.doesNotMatch(prompt, /本批 TM 未成功准备/)
  } finally { service.closeAll(); rmSync(root, { recursive: true, force: true }) }
})

test('file, CAT and online review receive cached embedded images without per-image queries', async () => {
  const root = mkdtempSync(join(tmpdir(), 'la-review-visuals-'))
  const service = new LinguistProjectService({ rootDir: join(root, 'cat'), applicationVersion: 'synthetic-test' })
  service.init()
  try {
    const rel = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'
    const zip = new JSZip()
    zip.file('xl/workbook.xml', `<workbook xmlns:r="${rel}"><sheets><sheet name="Brief" sheetId="1" r:id="sheet"/></sheets></workbook>`)
    zip.file('xl/_rels/workbook.xml.rels', '<Relationships><Relationship Id="sheet" Target="worksheets/sheet1.xml"/></Relationships>')
    zip.file('xl/worksheets/sheet1.xml', `<worksheet xmlns:r="${rel}"><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>Key</t></is></c><c r="B1" t="inlineStr"><is><t>Source</t></is></c></row><row r="2"><c r="A2" t="inlineStr"><is><t>one</t></is></c><c r="B2" t="inlineStr"><is><t>Use potion</t></is></c></row></sheetData><drawing r:id="draw"/></worksheet>`)
    zip.file('xl/worksheets/_rels/sheet1.xml.rels', '<Relationships><Relationship Id="draw" Target="../drawings/drawing1.xml"/></Relationships>')
    zip.file('xl/drawings/drawing1.xml', `<xdr:wsDr xmlns:xdr="urn:xdr" xmlns:a="urn:a" xmlns:r="${rel}"><xdr:oneCellAnchor><xdr:from><xdr:col>0</xdr:col><xdr:row>1</xdr:row></xdr:from><xdr:pic><a:blip r:embed="image"/></xdr:pic></xdr:oneCellAnchor></xdr:wsDr>`)
    zip.file('xl/drawings/_rels/drawing1.xml.rels', '<Relationships><Relationship Id="image" Target="../media/frame.png"/></Relationships>')
    zip.file('xl/media/frame.png', new Uint8Array([137, 80, 78, 71, 1]))
    writeFileSync(join(root, 'brief.xlsx'), await zip.generateAsync({ type: 'nodebuffer' }))
    writeFileSync(join(root, 'source.csv'), 'key,source,target\none,Use potion,使用药水\n')
    writeFileSync(join(root, 'online.json'), JSON.stringify({ segments: [{ id: 'platform-1', ordinal: 0, source: 'Use potion', target: '使用药水' }] }))
    const project = await service.createProject({ name: 'Visual test', sourceLocale: 'en', targetLocale: 'zh-CN' })
    const exec = { signal: new AbortController().signal, callId: 'visual', rootCallId: 'visual' }
    const working = createWorkingCopyTool(() => ({ workspaceRoot: root, sessionId: 'visual', project: { service, projectId: project.id } }), async () => {})
    const prepared = await working.execute({ operation: 'prepare', sourcePath: 'source.csv', sourceLocale: 'en', targetLocale: 'zh-CN' }, exec)
    const refs = await working.execute({ operation: 'references', sourcePath: 'source.csv', sourceLocale: 'en', targetLocale: 'zh-CN', previousResultPath: prepared.path, contextFiles: ['brief.xlsx'] }, exec)
    const tool = createReviewMaterialsTool(service, async () => ({ workspaceRoot: root, projectId: project.id, taskId: 'visual' }))
    const rows = service.openProject(project.id).segments.query({ limit: 10 })
    const cat = await tool.execute({ batchIds: [rows[0].assetId], contextFiles: ['brief.xlsx'] }, exec)
    const online = await tool.execute({ snapshotPath: 'online.json', contextFiles: ['brief.xlsx'], online: { url: 'https://example.test', expectedSegments: 1, observedAt: '2026-11-15T00:00:00Z' } }, exec)
    for (const result of [refs, cat, online]) {
      assert.match(result.readingContent, /Brief!A2: frame.png/)
      assert.match(result.readingContent, /context-images/)
    }
    const agent = { id: 'visual-parent' }
    let prompt
    const delegate = createLinguistDelegationTool({ service, agent,
      binding: { workspaceId: 'workspace', projectId: project.id, role: 'general', workMode: 'cat', batchStart: { batchId: rows[0].assetId, useCat: true } },
      resolveSessionWorkspace: async () => ({ workspaceRoot: root }), reserveIntent: () => () => {}, control: {},
      subagents: { resolveMaxDepth: () => undefined, startActivation: async spec => {
        prompt = spec.prompt[0].text
        return { childId: spec.childId, messageId: 'started' }
      } },
    })
    await delegate.tool.execute({ role: 'reviewer', objective: 'Review with the original workbook',
      scope: { batchIds: [rows[0].assetId] }, inputs: [{ path: 'brief.xlsx', purpose: 'Visual context', required: true }] }, { ...exec, agent })
    assert.match(prompt, /Brief!A2: frame.png/, 'the child receives images from normal task inputs automatically')
    const materials = [refs, cat, online].map(result => JSON.parse(readFileSync(join(root, dirname(result.readingPath), 'materials.json'), 'utf8')))
    assert.equal(new Set(materials.map(data => data.visual.visuals[0].path)).size, 1, 'all modes reuse the same extracted image')
    assert.deepEqual([...readFileSync(join(root, materials[0].visual.visuals[0].path))], [137, 80, 78, 71, 1])

    zip.file('xl/worksheets/sheet1.xml', `<worksheet xmlns:r="${rel}"><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>Key</t></is></c><c r="B1" t="inlineStr"><is><t>Source</t></is></c></row><row r="2"><c r="A2" t="inlineStr"><is><t>one</t></is></c><c r="B2" t="inlineStr"><is><t>角色：你好</t></is></c></row></sheetData><drawing r:id="draw"/></worksheet>`)
    writeFileSync(join(root, 'dialogue.xlsx'), await zip.generateAsync({ type: 'nodebuffer' }))
    writeFileSync(join(root, 'dialogue.sdlxliff'), '<xliff version="1.2" xmlns="urn:oasis:names:tc:xliff:document:1.2" xmlns:sdl="http://sdl.com/FileTypes/SdlXliff/1.0"><file source-language="zh-CN" target-language="en-US"><body><trans-unit id="dialogue"><source>角色：你好</source><seg-source><mrk mtype="seg" mid="1">角色：</mrk><mrk mtype="seg" mid="2">你好</mrk></seg-source><target><mrk mtype="seg" mid="1">Hero:</mrk><mrk mtype="seg" mid="2">Hello!</mrk></target></trans-unit></body></file></xliff>')
    const dialogue = await tool.execute({ sourcePath: 'dialogue.sdlxliff', sourceLocale: 'zh-CN', targetLocale: 'en-US', contextFiles: ['dialogue.xlsx'] }, exec)
    assert.match(dialogue.readingContent, /Hero:Hello!/, 'the reviewer sees the actual joined unit')
    assert.match(dialogue.readingContent, /连接提示.*冒号/)
    assert.match(dialogue.readingContent, /Brief!A2: frame.png/)
    const dialogueData = JSON.parse(readFileSync(join(root, dirname(dialogue.readingPath), 'materials.json'), 'utf8'))
    assert.equal(Object.keys(dialogueData.visual.positions).length, 2, 'every segment receives the uniquely matched original cell')
    const draft = await prepareWorkingCopy({ workspaceRoot: root, sourcePath: 'dialogue.sdlxliff', sourceLocale: 'zh-CN', targetLocale: 'en-US' })
    assert.equal(runQa(draft.segments).filter(finding => finding.code === QA_RULE_CODES.BOUNDARY_LABEL_SPACING).length, 1)
    zip.file('xl/worksheets/sheet1.xml', `<worksheet xmlns:r="${rel}"><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>Key</t></is></c><c r="B1" t="inlineStr"><is><t>Source</t></is></c></row><row r="2"><c r="B2" t="inlineStr"><is><t>角色：你好</t></is></c></row><row r="3"><c r="B3" t="inlineStr"><is><t>角色：你好</t></is></c></row></sheetData><drawing r:id="draw"/></worksheet>`)
    writeFileSync(join(root, 'dialogue.xlsx'), await zip.generateAsync({ type: 'nodebuffer' }))
    const ambiguous = await tool.execute({ sourcePath: 'dialogue.sdlxliff', sourceLocale: 'zh-CN', targetLocale: 'en-US', contextFiles: ['dialogue.xlsx'] }, exec)
    const ambiguousData = JSON.parse(readFileSync(join(root, dirname(ambiguous.readingPath), 'materials.json'), 'utf8'))
    assert.equal(Object.keys(ambiguousData.visual.positions).length, 0, 'duplicate source cells are not assigned an arbitrary location')
    assert.ok(ambiguous.continuationPaths.some(path => path.endsWith('visual-context.md')), 'unmatched images remain accessible')
  } finally { service.closeAll(); rmSync(root, { recursive: true, force: true }) }
})

test('native working-copy references retain every returned path and checksum across groups and refreshed content', async () => {
  const root = mkdtempSync(join(tmpdir(), 'la-native-reference-snapshots-'))
  const service = new LinguistProjectService({ rootDir: join(root, 'cat'), applicationVersion: 'synthetic-test' })
  service.init()
  try {
    const project = await service.createProject({ name: 'Synthetic snapshots', sourceLocale: 'en', targetLocale: 'zh-CN' })
    const db = service.openProject(project.id)
    const term = db.termEntries.upsert({ term: 'potion', translation: '药水', status: 'allowed', caseSensitive: false, note: 'First note' })
    db.termEntries.upsert({ term: 'shield', translation: '盾牌', status: 'allowed', caseSensitive: false })
    writeFileSync(join(root, 'source.csv'), 'key,source,target\none,Use potion,\ntwo,Use shield,\n')
    const tool = createWorkingCopyTool(() => ({ workspaceRoot: root, sessionId: 'synthetic', taskId: 'synthetic-task', project: { service, projectId: project.id } }), async () => {})
    const args = { sourcePath: 'source.csv', sourceLocale: 'en', targetLocale: 'zh-CN' }
    const exec = { signal: new AbortController().signal, callId: 'synthetic-call', rootCallId: 'synthetic-root' }
    const prepared = await tool.execute({ ...args, operation: 'prepare' }, exec)
    const draft = JSON.parse(readFileSync(join(root, prepared.path), 'utf8'))
    const getGroup = segmentId => tool.execute({ ...args, operation: 'references', previousResultPath: prepared.path, segmentIds: [segmentId] }, exec)
    const check = result => {
      const bytes = readFileSync(join(root, result.path))
      assert.equal(createHash('sha256').update(bytes).digest('hex'), result.artifactSha256)
      return bytes
    }
    const first = await getGroup(draft.segments[0].id)
    const firstBytes = check(first)
    const firstReading = join(root, dirname(first.readingPath), 'group-1.md')
    const firstReadingBytes = readFileSync(firstReading)
    const second = await getGroup(draft.segments[1].id)
    const secondBytes = check(second)
    assert.notEqual(first.path, second.path)
    assert.deepEqual(check(first), firstBytes)
    db.termEntries.upsert({ ...term, note: 'Updated synthetic note' })
    const refreshed = await getGroup(draft.segments[0].id)
    const refreshedBytes = check(refreshed)
    assert.notEqual(first.path, refreshed.path)
    assert.match(refreshedBytes.toString('utf8'), /Updated synthetic note/)
    assert.deepEqual(check(first), firstBytes)
    assert.deepEqual(check(second), secondBytes)
    assert.deepEqual(readFileSync(firstReading), firstReadingBytes)
    assert.match(readFileSync(join(root, dirname(refreshed.readingPath), 'group-1.md'), 'utf8'), /Updated synthetic note/)
  } finally { service.closeAll(); rmSync(root, { recursive: true, force: true }) }
})
