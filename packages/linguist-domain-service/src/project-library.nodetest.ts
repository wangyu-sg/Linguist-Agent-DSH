import assert from 'node:assert/strict'
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import JSZip from 'jszip'
import { LinguistProjectService } from './project-service'
import { syncProjectLibrary, getProjectLibraryMaterials, getProjectQuestionMaterials, resolveLibraryFile } from './project-library'
import { prepareCatTask } from './task-preparation'
import { prepareReviewMaterials } from './review-materials'
import { executeWorkingCopyAction } from './working-copy-service'

test('shared project originals reach CAT, browser, working-copy and questions; updates retire only owned prior versions', async t => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'la-library-')))
  const service = new LinguistProjectService({ rootDir: join(root, 'data'), applicationVersion: 'synthetic' })
  service.init()
  try {
    const project = await service.createProject({ name: 'Synthetic', sourceLocale: 'en', targetLocale: 'zh-CN' })
    const groupBatch = t.mock.method(service.reviewCache, 'get', async () => ({
      status: 'ready', model: 'synthetic', fingerprint: 'synthetic', embedded: 0, cached: 0, reusedGroups: false, groups: [],
    }))
    const searchBackground = t.mock.method(service.reviewCache, 'search', async (_path: string, texts: string[], queries: string[]) =>
      queries.map(() => [texts.findIndex(text => text.includes('restores energy'))]))
    writeFileSync(join(root, 'terms.csv'), 'source,target\nPotion,药剂\n')
    writeFileSync(join(root, 'tm.csv'), 'source,target\nUse potion,使用药剂\n')
    writeFileSync(join(root, 'rules.txt'), 'Use sentence case.\nKeep item descriptions consistent.\n')
    writeFileSync(join(root, 'notes.txt'), 'Question: What does the potion restore?\nReply: Only energy.\nStatus: awaiting confirmation.\n\nUnrelated background.')
    const zip = new JSZip()
    zip.file('xl/workbook.xml', '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Queries" sheetId="1" r:id="rId1"/></sheets></workbook>')
    zip.file('xl/_rels/workbook.xml.rels', '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>')
    zip.file('xl/worksheets/sheet1.xml', '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>Question</t></is></c><c r="B1" t="inlineStr"><is><t>Reply</t></is></c><c r="C1" t="inlineStr"><is><t>Status</t></is></c></row><row r="2"><c r="A2" t="inlineStr"><is><t>Does potion restore health?</t></is></c><c r="B2" t="inlineStr"><is><t>It restores energy, not health.</t></is></c><c r="C2" t="inlineStr"><is><t>Pending</t></is></c></row></sheetData></worksheet>')
    writeFileSync(join(root, 'query.xlsx'), await zip.generateAsync({ type: 'nodebuffer' }))
    const library = await syncProjectLibrary(service, project.id, root, [
      { path: 'terms.csv', kind: 'terms' }, { path: 'tm.csv', kind: 'tm' },
      { path: 'rules.txt', kind: 'rules', appliesTo: ['dialogue'] }, { path: 'query.xlsx', kind: 'context' }, { path: 'notes.txt', kind: 'context' },
    ])
    const libraryPath = join(service.getProjectPaths(project.id).projectDir, 'project-library.json')
    const stamp = statSync(libraryPath).mtimeMs
    assert.equal((await syncProjectLibrary(service, project.id, root)).resources, library.resources)
    assert.equal(statSync(libraryPath).mtimeMs, stamp, 'unchanged originals do not rewrite the library')
    await syncProjectLibrary(service, project.id, root, [{ path: join(root, 'notes.txt'), kind: 'context' }])
    assert.equal(statSync(libraryPath).mtimeMs, stamp, 'registering the same absolute path is idempotent')
    const question = await getProjectQuestionMaterials(service, project.id, root, 'Use potion')
    assert.equal(question.terms[0]!.translation, '药剂')
    assert.equal(question.terms[0]!.status, 'allowed', 'missing status never invents mandatory approval')
    assert.match(JSON.stringify(question.related), /Reply B2.*restores energy/)
    const reply = question.related.find(entry => entry.text.includes('It restores energy'))!
    assert.match(reply.locator, /Status C2/)
    assert.match(reply.text, /\["Status","Pending"\]/)
    assert.match(JSON.stringify(question.related), /Reply: Only energy/)
    assert.match(JSON.stringify(question.related), /awaiting confirmation/)
    assert.match(JSON.stringify(question.rules), /sentence case/)
    assert.equal(question.tm[0]!.target, '使用药剂')

    const original = '<xliff version="1.2"><file><body><trans-unit id="button"><source>Use potion</source><target>使用药水</target></trans-unit><trans-unit id="help"><source>Drink potion</source><target>喝药水</target></trans-unit></body></file></xliff>'
    writeFileSync(join(root, 'task.xliff'), original)
    const platform = { segments: [{ id: 'platform-1', ordinal: 0, key: 'button', source: 'Use potion', target: '使用药水', locked: true }, { id: 'platform-2', ordinal: 1, key: 'help', source: 'Drink potion', target: '喝药水', locked: false }] }
    writeFileSync(join(root, 'platform.json'), JSON.stringify(platform))
    const prepared = await prepareCatTask(service, { projectId: project.id, workspaceRoot: root, sessionId: 'synthetic', sourcePath: 'task.xliff', platformSnapshotPath: 'platform.json' })
    const db = service.openProject(project.id)
    const rows = db.segments.query({ assetId: prepared.assetId, limit: 10 })
    assert.equal(rows[0]!.locked, true)
    assert.throws(() => service.editSegment(project.id, rows[0]!.id, 'changed', rows[0]!.revision), /locked/i)
    assert.equal(readFileSync(join(root, 'task.xliff'), 'utf8'), original)
    const scopes = [{ batchIds: [prepared.assetId] }, { sourcePath: 'task.xliff' }, { snapshotPath: 'platform.json', online: { url: 'https://example.invalid/editor', expectedSegments: 2, observedAt: '2026-01-01T00:00:00Z' } }]
    for (const scope of scopes) {
      const material = await prepareReviewMaterials(service, { workspaceRoot: root, taskId: 'reviewer', projectId: project.id, ...scope })
      const delivered = [material.readingContent, ...material.continuationPaths.map(path => readFileSync(join(root, path), 'utf8'))].join('\n')
      assert.match(delivered, /sentence case/)
      assert.match(delivered, /Reply B2.*restores energy/)
      assert.match(delivered, /药剂/)
      assert.match(delivered, /使用药剂/)
    }
    const work = prepared.workingCopy as { path: string }
    const refs = await executeWorkingCopyAction({ operation: 'references', sourcePath: 'task.xliff', sourceLocale: 'en', targetLocale: 'zh-CN', previousResultPath: work.path },
      () => ({ workspaceRoot: root, sessionId: 'reviewer', service, project: { service, projectId: project.id } })) as { readingContent: string; continuationPaths: string[] }
    assert.match([refs.readingContent, ...refs.continuationPaths.map(path => readFileSync(join(root, path), 'utf8'))].join('\n'), /restores energy/)
    assert.ok(groupBatch.mock.callCount() > 0, 'regular review still groups the current batch')
    assert.equal(searchBackground.mock.callCount(), 0, 'regular review must start without embedding the project library')
    const related = await getProjectQuestionMaterials(service, project.id, root, 'stamina', undefined, [], undefined, true)
    assert.equal(searchBackground.mock.callCount(), 1)
    assert.match(JSON.stringify(related.related), /restores energy/)
    assert.equal(db.assets.countByProject(), 1, 'work copy is tied to the one CAT import')
    const bad = { segments: platform.segments.map(row => ({ ...row, key: 'missing' })) }
    writeFileSync(join(root, 'bad.json'), JSON.stringify(bad))
    await assert.rejects(prepareCatTask(service, { projectId: project.id, workspaceRoot: root, sessionId: 'synthetic', sourcePath: 'task.xliff', platformSnapshotPath: 'bad.json' }), /稳定 ID|不一致/)

    writeFileSync(join(root, 'terms.csv'), 'source,target\nPotion,恢复剂\n')
    writeFileSync(join(root, 'tm.csv'), 'source,target\nUse potion,使用恢复剂\n')
    writeFileSync(join(root, 'rules.txt'), 'New sentence rule.\n')
    const updated = await getProjectQuestionMaterials(service, project.id, root, 'Use potion')
    assert.deepEqual(updated.terms.map(term => term.translation), ['恢复剂'])
    assert.deepEqual(updated.tm.map(tm => tm.target), ['使用恢复剂'])
    assert.doesNotMatch(JSON.stringify(updated.rules), /Use sentence case/)
    assert.match(JSON.stringify(updated.rules), /New sentence rule/)
    const spreadsheet = await prepareCatTask(service, { projectId: project.id, workspaceRoot: root, sessionId: 'synthetic', sourcePath: 'query.xlsx',
      xlsxMapping: { sheetName: 'Queries', columns: { source: 'Question', target: 'Reply' } } })
    assert.equal(spreadsheet.preflight.segments, 1)
    writeFileSync(join(root, 'tm.csv'), 'source,target\nUse potion,使用药剂\n')
    const reverted = await getProjectQuestionMaterials(service, project.id, root, 'Use potion')
    assert.deepEqual(reverted.tm.map(tm => tm.target), ['使用药剂'], 'restoring a prior source version re-enables it')
  } finally { service.closeAll(); rmSync(root, { recursive: true, force: true }) }
})

test('replacing an Excel library reuses moved rows and delivers every current citation and customer field', async t => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'la-replace-excel-')))
  const service = new LinguistProjectService({ rootDir: join(root, 'data'), applicationVersion: 'synthetic' })
  try {
    service.init()
    const { id } = await service.createProject({ name: 'Replacement', sourceLocale: 'en', targetLocale: 'zh-CN' })
    const before = 'client-requirements-before.xlsx', after = 'client-requirements-after.xlsx'
    for (const name of [before, after]) copyFileSync(new URL('../../../tests/linguist-fixtures/' + name, import.meta.url), join(root, name))
    const search = t.mock.method(service.reviewCache, 'search', async (_path: string, texts: string[]) => [texts.map((_, i) => i)])
    const query = [{ id: 'batch', text: 'Ward' }]
    await syncProjectLibrary(service, id, root, [{ path: before, kind: 'context' }])
    await getProjectLibraryMaterials(service, id, root, query, undefined, undefined, true)
    await syncProjectLibrary(service, id, root, [{ path: after, kind: 'context' }], { replace: 'file:' + before })
    const result = await getProjectLibraryMaterials(service, id, root, query, undefined, undefined, true)
    const [oldTexts, newTexts] = search.mock.calls.map(call => new Set(call.arguments[1]))
    const added = [...newTexts!].filter(text => !oldTexts!.has(text))
    assert.equal(added.length, 2, 'only the added requirement and the changed confirmation status are new')
    assert.ok(added.some(text => text.includes('Feather')))
    assert.ok(added.some(text => text.includes('Moonstone') && text.includes('Approved')))
    const records = result.matches.batch!
    assert.ok(records.every(entry => entry.source === after))
    assert.ok(records.every(entry => !entry.text.includes('Use bronze.')))
    const wards = records.filter(entry => entry.text.includes('Keep {hero}'))
    assert.equal(wards.length, 2)
    for (const [index, row] of [4, 6].entries()) {
      assert.equal(wards[index]!.locator, `Updated notes!row ${row} · Status A${row} · Note B${row} · Key C${row} · Customer requirement D${row}`)
      assert.deepEqual(Object.fromEntries(wards[index]!.text.split('\n').map(line => JSON.parse(line))), {
        Key: 'Ward', 'Customer requirement': 'Keep {hero} in the shield tooltip.', Status: 'Approved', Note: 'First line\nB2: literal customer text.',
      })
    }
    const beacon = records.find(entry => entry.text.includes('Moonstone'))!
    assert.match(beacon.locator, /Status A5/)
    assert.doesNotMatch(beacon.text, /Pending/)
    assert.match(records.find(entry => entry.text.includes('Feather'))!.text, /Pending/)
  } finally { service.closeAll(); rmSync(root, { recursive: true, force: true }) }
})

test('project backup restores library registrations in place and into a new data root', async () => {
  const workspace = realpathSync(mkdtempSync(join(tmpdir(), 'la-library-backup-')))
  const original = new LinguistProjectService({ rootDir: join(workspace, 'original'), applicationVersion: 'synthetic', workspaceRootForProject: () => workspace })
  const restored = new LinguistProjectService({ rootDir: join(workspace, 'restored'), applicationVersion: 'synthetic' })
  try {
    original.init()
    restored.init()
    const { id } = await original.createProject({ name: 'Library backup', sourceLocale: 'en', targetLocale: 'zh-CN' })
    const beforeLibrary = original.backupProject(id)
    writeFileSync(join(workspace, 'scope.txt'), 'Use compass labels.')
    const resource = { kind: 'rules' as const, path: 'scope.txt', appliesTo: ['navigation'] }
    await syncProjectLibrary(original, id, workspace, [resource])
    const uploadPath = `.linguist/project-resources/${id}/d375eb87-5754-4690-8fd1-18088ce24ea4/upload.txt`
    mkdirSync(join(workspace, uploadPath, '..'), { recursive: true })
    writeFileSync(join(workspace, uploadPath), 'Uploaded rules')
    await syncProjectLibrary(original, id, workspace, [{ kind: 'rules', path: uploadPath }])
    assert.match(original.previewRestore(id, beforeLibrary.backupName).notice ?? '', /缺少项目资料登记/)
    const backup = original.backupProject(id)
    rmSync(join(workspace, uploadPath))
    const newWorkspace = join(workspace, 'new-workspace')
    mkdirSync(newWorkspace)
    await syncProjectLibrary(original, id, workspace, [], { remove: 'file:scope.txt' })
    original.restoreProject(id, backup.backupName)
    restored.importProjectBackupFromPath(join(original.rootDir, backup.backupDir))
    for (const service of [original, restored]) {
      const root = service === original ? workspace : newWorkspace
      const library = await syncProjectLibrary(service, id, root)
      assert.equal(readFileSync(resolveLibraryFile(service, id, root, `file:${uploadPath}`).sourcePath, 'utf8'), 'Uploaded rules')
      assert.deepEqual(library.resources.filter(item => item.path === resource.path).map(({ kind, path, appliesTo }) => ({ kind, path, appliesTo })), [resource])
      assert.equal(library.resources[0]?.entries?.[0]?.text, 'Use compass labels.')
    }
    // A pre-upgrade upload may still live only in the workspace when the user restores an older backup.
    const paths = original.getProjectPaths(id)
    const owned = join('blobs', 'project-library', ...uploadPath.split('/').slice(-2))
    rmSync(join(paths.projectDir, owned))
    writeFileSync(join(workspace, uploadPath), 'Uploaded rules')
    const rollback = original.restoreProject(id, beforeLibrary.backupName)
    assert.equal(readFileSync(join(paths.backupsDir, rollback.preRestoreName, owned), 'utf8'), 'Uploaded rules')
    original.restoreProject(id, backup.backupName)
    rmSync(join(paths.projectDir, owned))
    rmSync(join(workspace, uploadPath))
    assert.throws(() => original.backupProject(id), /ENOENT/)
    original.restoreProject(id, backup.backupName)
    assert.equal(readFileSync(join(paths.projectDir, owned), 'utf8'), 'Uploaded rules')
  } finally { original.closeAll(); restored.closeAll(); rmSync(workspace, { recursive: true, force: true }) }
})
