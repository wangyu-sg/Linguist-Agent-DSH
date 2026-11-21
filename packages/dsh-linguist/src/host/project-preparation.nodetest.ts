import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { LinguistProjectService } from '@linguist/domain-service'
import { createProjectPreparationTool } from './project-preparation-tool'
import { freezeLinguistDelegation } from './delegation'
import { BindingStore, type SessionBinding } from './bindings'
import { libraryPreparationTurn } from '../client/library-preparation-turn'
import type { LibraryPreparationOffer } from '@linguist/domain-service/contracts'

test('on-demand project questions, chosen CAT preparation and independent children share scoped originals', async t => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'la-preparation-')))
  const service = new LinguistProjectService({ rootDir: join(root, 'data'), applicationVersion: 'synthetic' })
  service.init()
  let binding: SessionBinding = { workspaceId: 'synthetic', role: 'general', workMode: 'working-copy' }
  let segmentIds: string[] = []
  try {
    writeFileSync(join(root, 'rules.txt'), 'Use sentence case.\n')
    const tool = createProjectPreparationTool(service,
      async () => ({ workspaceRoot: root, sessionId: 'parent', binding, segmentIds }),
      (_id, next) => { binding = next }, new BindingStore(join(root, 'data')))
    const exec = {} as Parameters<typeof tool.execute>[1]
    const prepared = await tool.execute({ query: 'What are the project rules?', resources: [{ path: 'rules.txt', kind: 'rules' }] }, exec) as { materials: string }
    assert.match(prepared.materials, /sentence case/)
    assert.equal(binding.batchStart?.useCat, undefined, 'read-only assets do not decide the work mode')
    const projectId = binding.projectId!
    const search = t.mock.method(service.reviewCache, 'search', async () => [[0]])
    writeFileSync(join(root, 'examples.txt'), 'Permit a paper crane on the desk.')
    const prepare = t.mock.method(service.reviewCache, 'prepareLibrary', () => ({ phase: 'queued' }))
    const registered = await tool.execute({ resources: [{ path: 'examples.txt', kind: 'context' }] }, exec) as {
      preparationOffer: { projectId: string; groups: Array<{ id: string; name: string }> }
    }
    assert.equal(registered.preparationOffer.projectId, projectId)
    assert.deepEqual(registered.preparationOffer.groups.map(({ id, name }) => ({ id, name })), [{ id: '', name: '' }])
    assert.deepEqual(registered, JSON.parse(JSON.stringify(registered)), 'the native tool executor rejects undefined values before displaying the card')
    assert.deepEqual(tool.output.presentationMeta?.({}, registered), { linguistLibraryPreparation: registered.preparationOffer })
    assert.equal(prepare.mock.callCount(), 0, 'ordinary registration returns a choice')
    writeFileSync(join(root, 'examples.txt'), 'Place a paper crane on the table.')
    await tool.execute({ resources: [{ path: 'examples.txt', kind: 'context' }] }, exec)
    assert.equal(search.mock.callCount(), 0, 'registering and updating originals do not invoke the encoder')
    const quick = await tool.execute({ query: 'crane' }, exec) as { materials: string }
    assert.match(quick.materials, /Place a paper crane/)
    assert.equal(search.mock.callCount(), 0, 'a wording lookup works without a vector index')
    const related = await tool.execute({ query: 'folded bird', semantic: true }, exec) as { materials: string }
    assert.equal(search.mock.callCount(), 1)
    assert.match(related.materials, /Place a paper crane/)
    writeFileSync(join(root, 'examples-v2.txt'), 'Place a paper crane on the table.')
    const replaced = await tool.execute({ replaceResource: 'file:examples.txt', resources: [{ path: 'examples-v2.txt', kind: 'context' }] }, exec) as {
      resources: Array<{ path: string }>; preparationOffer: LibraryPreparationOffer
    }
    assert.deepEqual(replaced.preparationOffer.registrations, [{ path: 'examples-v2.txt', filename: 'examples-v2.txt', taskGroupId: '', status: 'ready' }])
    assert.equal(replaced.preparationOffer.groups.length, 1)
    assert.ok(!replaced.resources.some(resource => resource.path === 'examples.txt'))
    assert.equal(prepare.mock.callCount(), 0, 'replacement does not start the encoder without a choice')
    const started = await tool.execute({ prepareInBackground: true }, exec) as { preparation: Array<{ id: string; status: string }> }
    assert.deepEqual(started.preparation, [{ id: '', status: 'queued' }], 'explicit request starts the background path')
    const [_cache, group, load] = prepare.mock.calls[0]!.arguments as unknown as [string, string, () => Promise<string[]>]
    assert.equal(group, '')
    assert.deepEqual(await load(), ['Place a paper crane on the table.'], 'scope uses the same current background records as search')
    await service.reviewCache.setEnabled(false)
    assert.equal(service.openProject(projectId).assets.countByProject(), 0)
    writeFileSync(join(root, 'task.xliff'), '<xliff version="1.2"><file><body><trans-unit id="one"><source>Use potion</source><target>使用药水</target></trans-unit></body></file></xliff>')
    const sources = [{ path: 'task.xliff' }]
    const ready = await tool.execute({ sources, sourceLocale: 'en', targetLocale: 'zh-CN', useCat: false }, exec) as { batchId: string; workMode: string; prepared: unknown[] }
    assert.equal(ready.workMode, 'working-copy')
    assert.deepEqual(ready.prepared, [])
    assert.equal(service.openProject(projectId).assets.countByProject(), 0)
    writeFileSync(join(root, 'terms.csv'), 'source,target\nPotion,药剂\n')
    const withTerms = await tool.execute({ batchId: ready.batchId, sources, useCat: true, resources: [{ path: 'terms.csv', kind: 'terms' }] }, exec) as { preparationOffer: LibraryPreparationOffer }
    assert.deepEqual(withTerms.preparationOffer.groups, [], 'term matching is ready without a semantic preparation job')
    const meta = tool.output.presentationMeta?.({}, JSON.parse(JSON.stringify(withTerms)))
    assert.deepEqual(libraryPreparationTurn.match({ type: 'tool/result', data: { turn: 1, message: { isError: false }, meta } } as never),
      { id: '1', role: 'start' }, 'registration feedback survives into the real reply slot without an embedding job')
    assert.equal(binding.projectId, projectId)
    assert.equal(binding.batchStart?.useCat, true)
    await tool.execute({ sources: [{ path: 'task.xliff' }] }, exec)
    const db = service.openProject(projectId)
    assert.equal(db.assets.countByProject(), 1, 'confirmed CAT is reused without a second choice or duplicate manuscript')
    const child = freezeLinguistDelegation(service, binding, { role: 'reviewer' })
    assert.equal(child.batchStart?.useCat, true)
    assert.equal(child.projectId, projectId)
    segmentIds = db.segments.queryIds()
    const before = binding
    const result = await tool.execute({ query: '这句怎么样？' }, exec) as { materials: string }
    assert.match(result.materials, /sentence case/)
    assert.match(result.materials, /药剂/)
    assert.strictEqual(binding, before, 'a lookup does not rebind the session')
    rmSync(join(root, 'rules.txt'))
    const missing = await tool.execute({ query: '这句怎么样？' }, exec) as { materials: string }
    assert.match(missing.materials, /读取失败.*仍使用上次成功读取的版本/)
    const comparisonIds = ['ungrouped', db.taskGroups.change({ action: 'create', name: 'Another task' })]
    const comparison = await tool.execute({ compareGroups: comparisonIds, query: 'Potion' }, exec) as { comparison: Array<{ group: { id: string } }> }
    assert.deepEqual(comparison.comparison.map(item => item.group.id), comparisonIds)
    binding = child
    await assert.rejects(tool.execute({ compareGroups: comparisonIds, query: 'Potion' }, exec), /子任务已冻结范围/)
  } finally { service.closeAll(); rmSync(root, { recursive: true, force: true }) }
})

test('workspace maintenance verifies moved files in project and group layouts without adopting a directory convention', async () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'la-maintenance-')))
  const service = new LinguistProjectService({ rootDir: join(root, 'data'), applicationVersion: 'synthetic' })
  service.init()
  try {
    for (const layout of [
      { name: 'monthly', directory: '共用资料', kind: 'rules', text: 'Use title case.' },
      { name: 'platform', directory: '平台/任务甲/答疑', kind: 'context', text: 'A customer question awaiting a reply.' },
    ] as const) {
      const workspaceRoot = join(root, layout.name)
      mkdirSync(join(workspaceRoot, layout.directory), { recursive: true })
      const from = 'original.txt', to = join(layout.directory, from)
      writeFileSync(join(workspaceRoot, from), layout.text)
      let binding: SessionBinding = { workspaceId: layout.name, role: 'general', workMode: 'working-copy' }
      const tool = createProjectPreparationTool(service, async () => ({ workspaceRoot, sessionId: layout.name, binding }),
        (_id, next) => { binding = next }, new BindingStore(join(root, 'data')))
      const exec = {} as Parameters<typeof tool.execute>[1]
      const inspect = (taskGroupId: string) => tool.execute({ listResourceFiles: true, taskGroupId }, exec) as Promise<ReturnType<typeof service.inspectProjectResourceFiles>>
      const projectCount = service.listProjects().length
      assert.deepEqual(await inspect(''), { status: 'no-project', groups: [], resources: [] })
      assert.equal(binding.projectId, undefined)
      assert.equal(service.listProjects().length, projectCount)

      const project = await service.createProject({ name: layout.name, sourceLocale: 'en', targetLocale: 'zh-CN' })
      binding = { ...binding, projectId: project.id }
      const db = service.openProject(project.id)
      const group = layout.kind === 'context' ? db.taskGroups.change({ action: 'create', name: '任务甲' }) : ''
      await tool.execute({ resources: [{ path: from, kind: layout.kind, taskGroupId: group }] }, exec)
      const bindingBeforeInspection = binding
      const libraryPath = join(service.getProjectPaths(project.id).projectDir, 'project-library.json')
      const libraryBeforeInspection = readFileSync(libraryPath)
      if (group) {
        assert.deepEqual((await inspect('')).resources, [], 'group-only material stays out of the shared inventory')
        binding = { ...binding, taskGroupId: group, delegatedScope: { assetIds: [], segmentIds: [] } }
        assert.deepEqual((await inspect(group)).groups.map(item => item.id), [group])
        await assert.rejects(inspect(''), /子任务已冻结范围/)
        binding = bindingBeforeInspection
      }
      const [registered] = (await inspect(group)).resources
      assert.equal(registered?.status, 'ready')
      assert.equal(registered.lastReadSha256, createHash('sha256').update(layout.text).digest('hex'))

      renameSync(join(workspaceRoot, from), join(workspaceRoot, to))
      const [broken] = (await inspect(group)).resources
      assert.equal(broken?.status, 'error', 'a past successful read cannot hide a missing original')
      assert.equal(broken.lastReadSha256, registered.lastReadSha256)
      await assert.rejects(tool.execute({ listResourceFiles: true, removeResource: registered.key }, exec), /仅接受任务组范围/)
      assert.strictEqual(binding, bindingBeforeInspection)
      assert.deepEqual(readFileSync(libraryPath), libraryBeforeInspection, 'the check preserves the last successful registration')
      assert.strictEqual(service.openProject(project.id), db, 'inspection leaves the working database handle open')

      await tool.execute({ taskGroupId: group, replaceResource: registered.key, resources: [{ path: to, kind: layout.kind }] }, exec)
      const verified = (await inspect(group)).resources
      assert.deepEqual(verified.map(item => [item.path, item.taskGroupId ?? '', item.status, item.lastReadSha256]),
        [[to, group, 'ready', registered.lastReadSha256]])
      assert.equal(readFileSync(join(workspaceRoot, to), 'utf8'), layout.text)
    }
  } finally { service.closeAll(); rmSync(root, { recursive: true, force: true }) }
})

test('a session default cannot authorize work and a saved batch choice survives a reopened store', () => {
  const root = mkdtempSync(join(tmpdir(), 'la-batch-start-store-'))
  try {
    const store = new BindingStore(root)
    store.bindSession('old', { workspaceId: 'workspace', role: 'general', workMode: 'cat' })
    assert.equal(store.batchStart('project', '32.2'), undefined)
    const start = { batchId: '32.2', useCat: true }
    store.saveBatchStart('project', start, 'cat-asset')
    const reopened = new BindingStore(root)
    assert.deepEqual(reopened.batchStart('project', '32.2'), start)
    assert.deepEqual(reopened.batchStart('project', 'cat-asset'), start)
    assert.equal(reopened.batchStart('project', '32.3'), undefined)
    assert.equal(reopened.batchStart('another-project', '32.2'), undefined)
  } finally { rmSync(root, { recursive: true, force: true }) }
})

test('project defaultBatchWorkMode determines omitted useCat while honoring explicit overrides and saved batch choices', async () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'la-default-batch-mode-')))
  const service = new LinguistProjectService({ rootDir: join(root, 'data'), applicationVersion: 'synthetic' })
  service.init()
  const exec = {} as Parameters<ReturnType<typeof createProjectPreparationTool>['execute']>[1]
  try {
    const catProject = await service.createProject({
      name: 'CAT default', sourceLocale: 'en', targetLocale: 'zh-CN', defaultBatchWorkMode: 'cat',
    })
    let binding: SessionBinding = { workspaceId: 'synthetic', projectId: catProject.id, role: 'general', workMode: 'working-copy' }
    const starts = new BindingStore(join(root, 'data'))
    const tool = createProjectPreparationTool(service,
      async () => ({ workspaceRoot: root, sessionId: 'default-cat', binding }),
      (_id, next) => { binding = next }, starts)

    writeFileSync(join(root, 'report-only.xliff'), '<xliff version="1.2"><file><body><trans-unit id="r1"><source>Shield</source><target>盾牌</target></trans-unit></body></file></xliff>')
    const reported = await tool.execute({ sources: [{ path: 'report-only.xliff' }], reportOnly: true }, exec) as { batchId: string; workMode: string; prepared: unknown[]; batchStart?: { useCat: boolean } }
    assert.equal(reported.workMode, 'working-copy')
    assert.deepEqual(reported.prepared, [])
    assert.equal(reported.batchStart, undefined)
    assert.equal(starts.batchStart(catProject.id, reported.batchId), undefined)

    writeFileSync(join(root, 'auto-cat.xliff'), '<xliff version="1.2"><file><body><trans-unit id="c1"><source>Potion</source><target>药水</target></trans-unit></body></file></xliff>')
    const autoCat = await tool.execute({ sources: [{ path: 'auto-cat.xliff' }] }, exec) as { batchId: string; workMode: string; prepared: unknown[]; batchStart: { useCat: boolean } }
    assert.equal(autoCat.workMode, 'cat', 'project default cat wins even when session started in working-copy')
    assert.equal(autoCat.batchStart.useCat, true)
    assert.equal(autoCat.prepared.length, 1)

    service.setWorkflowConfig(catProject.id, 'translation', undefined, undefined, 'working-copy')
    const reopenedSavedCat = await tool.execute({ batchId: autoCat.batchId }, exec) as { workMode: string; batchStart: { useCat: boolean } }
    assert.equal(reopenedSavedCat.workMode, 'cat', 'saved batchStart wins over subsequent project default change')
    assert.equal(reopenedSavedCat.batchStart.useCat, true)

    writeFileSync(join(root, 'auto-wc.xliff'), '<xliff version="1.2"><file><body><trans-unit id="w1"><source>Elixir</source><target>灵药</target></trans-unit></body></file></xliff>')
    binding = { workspaceId: 'synthetic', projectId: catProject.id, role: 'general', workMode: 'cat' }
    const autoWc = await tool.execute({ sources: [{ path: 'auto-wc.xliff' }] }, exec) as { batchId: string; workMode: string; prepared: unknown[]; batchStart: { useCat: boolean } }
    assert.equal(autoWc.workMode, 'working-copy', 'project default working-copy wins even when session started in cat')
    assert.equal(autoWc.batchStart.useCat, false)
    assert.deepEqual(autoWc.prepared, [])

    writeFileSync(join(root, 'explicit-cat.xliff'), '<xliff version="1.2"><file><body><trans-unit id="e1"><source>Scroll</source><target>卷轴</target></trans-unit></body></file></xliff>')
    const explicitCat = await tool.execute({ sources: [{ path: 'explicit-cat.xliff' }], useCat: true }, exec) as { batchId: string; workMode: string; prepared: unknown[]; batchStart: { useCat: boolean } }
    assert.equal(explicitCat.workMode, 'cat', 'explicit useCat overrides project default')
    assert.equal(explicitCat.batchStart.useCat, true)
    assert.equal(explicitCat.prepared.length, 1)
  } finally { service.closeAll(); rmSync(root, { recursive: true, force: true }) }
})
