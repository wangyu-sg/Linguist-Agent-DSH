import assert from 'node:assert/strict'
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { LinguistProjectService } from '@linguist/domain-service'
import { createProjectPreparationTool } from './project-preparation-tool'
import { freezeLinguistDelegation } from './delegation'
import type { SessionBinding } from './bindings'

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
    assert.equal(binding.workModeConfirmed, undefined, 'read-only assets do not decide the work mode')
    const projectId = binding.projectId!
    const search = t.mock.method(service.reviewCache, 'search', async () => [[0]])
    writeFileSync(join(root, 'examples.txt'), 'Permit a paper crane on the desk.')
    await tool.execute({ resources: [{ path: 'examples.txt', kind: 'context' }] }, exec)
    writeFileSync(join(root, 'examples.txt'), 'Place a paper crane on the table.')
    await tool.execute({ resources: [{ path: 'examples.txt', kind: 'context' }] }, exec)
    assert.equal(search.mock.callCount(), 0, 'registering and updating originals do not invoke the encoder')
    const quick = await tool.execute({ query: 'crane' }, exec) as { materials: string }
    assert.match(quick.materials, /Place a paper crane/)
    assert.equal(search.mock.callCount(), 0, 'a wording lookup works without a vector index')
    const related = await tool.execute({ query: 'folded bird', semantic: true }, exec) as { materials: string }
    assert.equal(search.mock.callCount(), 1)
    assert.match(related.materials, /Place a paper crane/)
    await service.reviewCache.setEnabled(false)
    assert.equal(service.openProject(projectId).assets.countByProject(), 0)
    writeFileSync(join(root, 'task.xliff'), '<xliff version="1.2"><file><body><trans-unit id="one"><source>Use potion</source><target>使用药水</target></trans-unit></body></file></xliff>')
    await assert.rejects(tool.execute({ sources: [{ path: 'task.xliff' }] }, exec), /先询问/)
    writeFileSync(join(root, 'terms.csv'), 'source,target\nPotion,药剂\n')
    await tool.execute({ workMode: 'cat', sourceLocale: 'en', targetLocale: 'zh-CN', sources: [{ path: 'task.xliff' }], resources: [{ path: 'terms.csv', kind: 'terms' }] }, exec)
    assert.equal(binding.projectId, projectId)
    assert.equal(binding.workModeConfirmed, true)
    await tool.execute({ sources: [{ path: 'task.xliff' }] }, exec)
    const db = service.openProject(projectId)
    assert.equal(db.assets.countByProject(), 1, 'confirmed CAT is reused without a second choice or duplicate manuscript')
    const child = freezeLinguistDelegation(service, binding, { role: 'reviewer' })
    assert.equal(child.workModeConfirmed, true)
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
