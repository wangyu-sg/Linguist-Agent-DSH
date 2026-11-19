import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { LinguistProjectService } from './project-service'
import { listProjectLibrary, syncProjectLibrary } from './project-library'

test('group confirmation keeps its own history, an imported TU keeps its provenance, a shared backing outlives removal of a file reference', async () => {
  const root = mkdtempSync(join(tmpdir(), 'la-resource-scope-'))
  const service = new LinguistProjectService({ rootDir: join(root, 'projects'), applicationVersion: 'synthetic' })
  try {
    service.init()
    const { id } = await service.createProject({ name: 'Scoped confirmations', sourceLocale: 'en', targetLocale: 'zh-CN' })
    const db = service.openProject(id)
    const a = db.taskGroups.change({ action: 'create', name: 'November' })
    const b = db.taskGroups.change({ action: 'create', name: 'December' })
    const tmx = Buffer.from('<tmx version="1.4"><header srclang="en"/><body><tu tuid="shared"><tuv xml:lang="en"><seg>Shared</seg></tuv><tuv xml:lang="zh-CN"><seg>共用</seg></tuv></tu></body></tmx>')
    const owned = await service.importReference(id, 'tm', { filename: 'same.tmx', bytes: tmx })
    writeFileSync(join(root, 'same.tmx'), tmx)
    await syncProjectLibrary(service, id, root, [{ path: 'same.tmx', kind: 'tm', taskGroupId: a }])
    const candidates = (group?: string) => db.tmUnits.listCandidates('en', 'zh-CN', undefined, group)
    assert.equal(candidates(b)[0]?.originalTuid, 'shared')
    await syncProjectLibrary(service, id, root, [], { taskGroupId: a, remove: 'file:same.tmx' })
    assert.equal(candidates(b)[0]?.originalTuid, 'shared')
    assert.ok(listProjectLibrary(service, id, root).some(item => item.key === 'reference:' + owned.source!.id))
    const bytes = Buffer.from('key,source,target\na,Shared,共用\nb,Private,独有\n')
    const batch = await service.importAsset(id, { filename: 'source.csv', bytes, taskGroupId: a })
    const [shared, privateRow] = db.segments.query({ assetId: batch.assetId })
    service.confirmCurrentStage(id, shared!.id, shared!.revision, 'actual-A')
    service.confirmCurrentStage(id, privateRow!.id, privateRow!.revision, 'actual-A')
    const match = candidates(a).find(row => row.source === 'Shared')!
    assert.equal(match.originalTuid, 'shared')
    assert.equal(match.localMetadata?.la_confirmation_count, '1')
    assert.deepEqual(candidates(a).map(row => row.source).sort(), ['Private', 'Shared'])
    for (const group of [b, undefined]) {
      assert.deepEqual(candidates(group).map(row => row.source), ['Shared'])
      assert.equal(candidates(group)[0]?.localMetadata, undefined)
      assert.deepEqual(db.tmUnits.concordance({ taskGroupId: group }).map(row => row.source), ['Shared'])
    }
    const pool = listProjectLibrary(service, id, root, a).find(item => item.key.startsWith('tm-source:confirmed:'))!
    await syncProjectLibrary(service, id, root, [], { taskGroupId: a, move: { keys: [pool.key], to: '' } })
    assert.equal(candidates(b).find(row => row.source === 'Private')?.localMetadata?.la_confirmation_count, '1')
    const extra = await service.importAsset(id, { filename: 'new.csv', bytes: Buffer.from('key,source,target\na,Later,后续\n'), taskGroupId: a })
    const later = db.segments.query({ assetId: extra.assetId })[0]!
    service.confirmCurrentStage(id, later.id, later.revision, 'later-A')
    assert.ok(candidates(a).some(row => row.source === 'Later'))
    assert.ok(!candidates(b).some(row => row.source === 'Later'))
  } finally { service.closeAll(); rmSync(root, { recursive: true, force: true }) }
})

test('a failed replacement keeps inherited rules, repairing and removing a local override affects just that group', async () => {
  const root = mkdtempSync(join(tmpdir(), 'la-resource-replace-'))
  const service = new LinguistProjectService({ rootDir: join(root, 'data'), applicationVersion: 'synthetic' })
  try {
    service.init()
    const { id } = await service.createProject({ name: 'Versions', sourceLocale: 'en', targetLocale: 'zh-CN' })
    const db = service.openProject(id)
    const a = db.taskGroups.change({ action: 'create', name: 'January' })
    const b = db.taskGroups.change({ action: 'create', name: 'February' })
    const shared = { kind: 'terms' as const, path: 'base.csv' }
    writeFileSync(join(root, shared.path), 'source,target\nCrown,王冠\n')
    writeFileSync(join(root, 'patch.csv'), 'invalid\n')
    await syncProjectLibrary(service, id, root, [shared])
    const patch = { kind: 'terms' as const, path: 'patch.csv', taskGroupId: a, replacesInherited: 'file:base.csv' }
    await syncProjectLibrary(service, id, root, [patch])
    const matches = (group: string) => db.termEntries.findMatches({ taskGroupId: group, text: 'Crown', limit: 1 }).map(row => row.translation)
    assert.deepEqual(matches(a), ['王冠'])
    assert.deepEqual(matches(b), ['王冠'])
    writeFileSync(join(root, patch.path), 'source,target\nCrown,皇冠\n')
    await syncProjectLibrary(service, id, root, [], { taskGroupId: a, retry: true })
    assert.deepEqual(matches(a), ['皇冠'])
    assert.deepEqual(matches(b), ['王冠'])
    assert.deepEqual(matches(''), ['王冠'])
    writeFileSync(join(root, 'cancel.csv'), 'invalid\n')
    await syncProjectLibrary(service, id, root, [{ kind: 'terms', path: 'cancel.csv' }], { replace: 'file:patch.csv', taskGroupId: a })
    await syncProjectLibrary(service, id, root, [], { remove: 'file:cancel.csv', taskGroupId: a })
    assert.deepEqual(matches(a), ['皇冠'])
    await syncProjectLibrary(service, id, root, [{ kind: 'terms', path: 'cancel.csv' }], { replace: 'file:patch.csv', taskGroupId: a })
    // Selecting the still-good original to repair a failed replacement keeps its own registration.
    await syncProjectLibrary(service, id, root, [{ kind: 'terms', path: 'patch.csv' }], { replace: 'file:cancel.csv', taskGroupId: a })
    assert.deepEqual(matches(a), ['皇冠'])
    await syncProjectLibrary(service, id, root, [], { remove: 'file:patch.csv', taskGroupId: a })
    assert.deepEqual(matches(a), ['王冠'])
    const rule = db.styleGuideRules.upsert({ ruleText: 'Use short labels.' })
    const term = db.termEntries.upsert({ term: 'Blade', translation: '刀刃', status: 'preferred', caseSensitive: false })
    const keys = ['rule:' + rule.id, 'term:' + term.id]
    await syncProjectLibrary(service, id, root, [], { move: { keys, to: a } })
    for (const key of keys) {
      assert.ok(listProjectLibrary(service, id, root, a).some(item => item.key === key && item.origin === 'entry' && item.text))
      assert.ok(!listProjectLibrary(service, id, root, b).some(item => item.key === key))
    }
    assert.deepEqual(db.termEntries.findMatches({ taskGroupId: b, text: 'Blade' }), [])
    assert.ok(db.getProjectRules(undefined, a).some(item => item.ruleId === rule.id))
    assert.ok(!db.getProjectRules(undefined, b).some(item => item.ruleId === rule.id))
    assert.throws(() => db.termEntries.upsert({ ...term, translation: '篡改' }, b), /其他范围/)
    assert.throws(() => db.termEntries.delete(term.id, b), /其他范围/)
    const local = db.termEntries.upsert({ term: 'Blade', translation: '刀刃', status: 'preferred', caseSensitive: false, note: 'B only' }, b)
    assert.notEqual(local.id, term.id)
    assert.deepEqual(db.termEntries.findMatches({ taskGroupId: a, text: 'Blade' }).map(row => row.id), [term.id])
    assert.deepEqual(db.termEntries.findMatches({ taskGroupId: b, text: 'Blade' }).map(row => row.id), [local.id])
  } finally { service.closeAll(); rmSync(root, { recursive: true, force: true }) }
})
