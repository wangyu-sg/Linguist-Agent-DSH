import assert from 'node:assert/strict'
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { LinguistProjectService } from '@linguist/domain-service'
import { createProjectPreparationTool } from './project-preparation-tool'
import { freezeLinguistDelegation } from './delegation'
import { BindingStore, type SessionBinding } from './bindings'

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
      (_id, next) => { binding = next })
    const exec = {} as Parameters<typeof tool.execute>[1]
    const prepared = await tool.execute({ query: 'What are the project rules?', resources: [{ path: 'rules.txt', kind: 'rules' }] }, exec) as { materials: string }
    assert.match(prepared.materials, /sentence case/)
    assert.equal(binding.workModeDecision?.source, undefined, 'read-only assets do not decide the work mode')
    const projectId = binding.projectId!
    const search = t.mock.method(service.reviewCache, 'search', async () => [[0]])
    writeFileSync(join(root, 'examples.txt'), 'Permit a paper crane on the desk.')
    const prepare = t.mock.method(service.reviewCache, 'prepareLibrary', () => ({ phase: 'queued' }))
    const registered = await tool.execute({ resources: [{ path: 'examples.txt', kind: 'context' }] }, exec) as {
      preparationOffer: { projectId: string; groups: Array<{ id: string; name: string }> }
    }
    assert.equal(registered.preparationOffer.projectId, projectId)
    assert.deepEqual(registered.preparationOffer.groups.map(({ id, name }) => ({ id, name })), [{ id: '', name: '' }])
    assert.deepEqual(tool.output.presentationMeta?.({}, JSON.parse(JSON.stringify(registered))), { linguistLibraryPreparation: registered.preparationOffer })
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
    const started = await tool.execute({ prepareInBackground: true }, exec) as { preparation: Array<{ id: string; status: string }> }
    assert.deepEqual(started.preparation, [{ id: '', status: 'queued' }], 'explicit request starts the background path')
    const [_cache, group, load] = prepare.mock.calls[0]!.arguments as unknown as [string, string, () => Promise<string[]>]
    assert.equal(group, '')
    assert.deepEqual(await load(), ['Place a paper crane on the table.'], 'scope uses the same current background records as search')
    await service.reviewCache.setEnabled(false)
    assert.equal(service.openProject(projectId).assets.countByProject(), 0)
    writeFileSync(join(root, 'task.xliff'), '<xliff version="1.2"><file><body><trans-unit id="one"><source>Use potion</source><target>使用药水</target></trans-unit></body></file></xliff>')
    const proposed = await tool.execute({ sourceLocale: 'en', targetLocale: 'zh-CN', sources: [{ path: 'task.xliff' }] }, exec) as { status: string; recommendedWorkMode: string }
    assert.equal(proposed.status, 'choose-work-mode')
    assert.equal(proposed.recommendedWorkMode, 'cat')
    assert.equal(service.openProject(projectId).assets.countByProject(), 0)
    writeFileSync(join(root, 'plain.txt'), 'A plain document for a detached work copy.')
    const fileMode = await tool.execute({ sources: [{ path: 'plain.txt' }], autoRoute: true }, exec) as { workMode: string }
    assert.equal(fileMode.workMode, 'working-copy')
    assert.equal(binding.workModeDecision?.source, 'automatic')
    const liveMode = await tool.execute({ online: true, newTask: true, autoRoute: true }, exec) as { workMode: string }
    assert.equal(liveMode.workMode, 'browser')
    assert.equal(service.openProject(projectId).assets.countByProject(), 0)

    writeFileSync(join(root, 'terms.csv'), 'source,target\nPotion,药剂\n')
    await tool.execute({ workMode: 'cat', sourceLocale: 'en', targetLocale: 'zh-CN', sources: [{ path: 'task.xliff' }], resources: [{ path: 'terms.csv', kind: 'terms' }] }, exec)
    assert.equal(binding.projectId, projectId)
    assert.equal(binding.workModeDecision?.source, 'user')
    await tool.execute({ sources: [{ path: 'task.xliff' }] }, exec)
    const db = service.openProject(projectId)
    assert.equal(db.assets.countByProject(), 1, 'confirmed CAT is reused without a second choice or duplicate manuscript')
    const child = freezeLinguistDelegation(service, binding, { role: 'reviewer' })
    assert.equal(child.workModeDecision?.source, 'user')
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

test('a previously chosen work mode is migrated once and an undecided binding stays undecided', () => {
  const root = mkdtempSync(join(tmpdir(), 'la-route-migration-'))
  try {
    const base = { workspaceId: 'workspace', role: 'general', workMode: 'cat' }
    writeFileSync(join(root, 'linguist-bindings.json'), JSON.stringify({ version: 1, projects: {}, sessions: {
      old: { ...base, workModeConfirmed: true }, undecided: { ...base, workModeConfirmed: false },
    } }))
    const migrated = new BindingStore(root)
    assert.deepEqual(migrated.session('old')?.workModeDecision, { source: 'user' })
    assert.equal(migrated.session('undecided')?.workModeDecision, undefined)
    assert.deepEqual(new BindingStore(root).session('old'), { ...base, workModeDecision: { source: 'user' } })
  } finally { rmSync(root, { recursive: true, force: true }) }
})
