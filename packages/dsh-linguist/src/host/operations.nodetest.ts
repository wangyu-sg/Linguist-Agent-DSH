import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import fs from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createRequire, syncBuiltinESMExports } from 'node:module'
import { Readable } from 'node:stream'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { sha256Hex } from '@linguist/cat-core'
import type { LinguistProjectImportResult, LinguistReferenceImportResult, LinguistReferenceQueryResult, LinguistTmReferenceInfo } from '@linguist/domain-service/contracts'
import test from 'node:test'
import { WorkspaceId } from '@deepseek-ai/dsh-workspace'
import { executeWorkingCopyAction, LinguistProjectService, prepareWorkingCopy } from '@linguist/domain-service'
import { BindingStore } from './bindings'
import { ManagedFiles } from './files'
import { MutationBus } from './mutations'
import { dispatchOperation, listWorkingCopies, type DispatchOperationInput } from './operations'

test('human confirmation records the bound parent task and rejects a foreign session', async () => {
  const root = mkdtempSync(join(tmpdir(), 'la-stage-session-'))
  const service = new LinguistProjectService({ rootDir: join(root, 'linguist'), applicationVersion: 'synthetic-test' })
  service.init()
  try {
    const project = await service.createProject({ name: 'Synthetic', sourceLocale: 'en-US', targetLocale: 'zh-CN' })
    await service.importAsset(project.id, { bytes: Buffer.from('key,source,target\na,Open,打开\n'), filename: 'synthetic.csv' })
    const db = service.openProject(project.id), segment = db.segments.query()[0]!
    const deps: Omit<DispatchOperationInput, 'operation' | 'payload'> = {
      service, bindings: new BindingStore(root), files: new ManagedFiles(root), mutations: new MutationBus(),
      workspaceRegistry: { get: () => undefined }, resolveSessionWorkspace: async () => { throw new Error('Unexpected Workspace lookup') },
      assertProjectSession: async id => { if (id !== 'child') throw new Error('Unbound Session') },
      sessionCopyHost: { sessionQuery: { observeSession: async (id: string) => ({ header: { id, origin: 'subagent', parentSession: 'parent' }, [Symbol.dispose]() {} }) } } as unknown as NonNullable<DispatchOperationInput['sessionCopyHost']>,
    }
    const payload = { projectId: project.id, segmentId: segment.id, expectedRevision: segment.revision }
    await assert.rejects(dispatchOperation({ ...deps, operation: 'linguistCatConfirmStage', payload: { ...payload, sessionId: 'foreign' } }), /Unbound Session/)
    await dispatchOperation({ ...deps, operation: 'linguistCatConfirmStage', payload: { ...payload, sessionId: 'child' } })
    const record = JSON.parse((db.tmUnits.listCandidates('en-US', 'zh-CN', undefined, 'ungrouped')[0]!.localMetadata!.la_confirmations as string[])[0]!)
    assert.equal(record.taskId, 'parent')
    assert.equal(record.actor, 'local-user')
  } finally { service.closeAll(); rmSync(root, { recursive: true, force: true }) }
})

test('successful and duplicate ordinary imports release staging while keeping the original asset; cleanup failure is diagnosed and retried', async (context) => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'la-staging-lifecycle-')))
  const service = new LinguistProjectService({ rootDir: join(root, 'linguist'), applicationVersion: 'synthetic-test' })
  service.init()
  const files = new ManagedFiles(root)
  try {
    const project = await service.createProject({ name: 'Synthetic staging', sourceLocale: 'en-US', targetLocale: 'zh-CN' })
    const bytes = Buffer.from(JSON.stringify([{ key: 'a', source: 'Start', target: '开始' }]))
    const deps: Omit<DispatchOperationInput, 'operation' | 'payload'> = {
      service, files, bindings: new BindingStore(root), mutations: new MutationBus(), workspaceRegistry: { get: () => undefined },
      assertProjectSession: async () => { throw new Error('Unexpected Session check') }, resolveSessionWorkspace: async () => { throw new Error('Unexpected Workspace lookup') },
    }
    for (const expected of ['imported', 'skipped-duplicate']) {
      const body = Buffer.concat([Buffer.from('--lifecycle\r\nContent-Disposition: form-data; name="files"; filename="synthetic.json"\r\n\r\n'), bytes, Buffer.from('\r\n--lifecycle--\r\n')])
      const request = Object.assign(Readable.from([body]), { headers: { 'content-type': 'multipart/form-data; boundary=lifecycle' } }) as IncomingMessage
      const [token] = await files.stage(request)
      const path = files.takeUpload(token!).path
      if (expected === 'imported') {
        context.mock.method(fs, 'rmSync', () => { throw new Error('synthetic cleanup EACCES') })
        syncBuiltinESMExports()
      }
      const result = await dispatchOperation({ ...deps, operation: 'linguistProjectsImport', payload: { projectId: project.id, fileTokens: [token] } }) as { status: string; assetId: string }
      assert.equal(result.status, expected)
      if (expected === 'imported') {
        assert.equal(existsSync(path), true)
        assert.match(files.lastCleanupError!, /synthetic cleanup EACCES/)
        context.mock.restoreAll()
        syncBuiltinESMExports()
        files.collectExpired()
      }
      assert.equal(existsSync(path), false)
      assert.throws(() => files.takeUpload(token!))
      assert.doesNotThrow(() => files.discardUpload(token!))
      assert.deepEqual(readFileSync(service.resolveAssetSourcePath(project.id, result.assetId).sourcePath), bytes)
    }
  } finally { context.mock.restoreAll(); syncBuiltinESMExports(); service.closeAll(); rmSync(root, { recursive: true, force: true }) }
})

test('ordinary XLSX keeps its mapping candidate, cancels it safely, and releases confirmed and automatically mapped duplicates', async () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'la-xlsx-staging-')))
  const service = new LinguistProjectService({ rootDir: join(root, 'linguist'), applicationVersion: 'synthetic-test' })
  service.init()
  try {
    const project = await service.createProject({ name: 'Synthetic workbook', sourceLocale: 'en-US', targetLocale: 'zh-CN' })
    const files = new ManagedFiles(root)
    const deps: Omit<DispatchOperationInput, 'operation' | 'payload'> = {
      service, files, bindings: new BindingStore(root), mutations: new MutationBus(), workspaceRegistry: { get: () => undefined },
      assertProjectSession: async () => { throw new Error('Unexpected Session check') }, resolveSessionWorkspace: async () => { throw new Error('Unexpected Workspace lookup') },
    }
    const bytes = await referenceWorkbook()
    const cancelled = await stageSynthetic(files, 'synthetic.xlsx', bytes)
    await dispatchOperation({ ...deps, operation: 'linguistProjectsImport', payload: { projectId: project.id, fileTokens: [cancelled] } })
    const cancelledPath = files.takeUpload(cancelled).path
    assert.equal(files.pendingImports.has(cancelled), true)
    files.discardUpload(cancelled)
    assert.equal(files.pendingImports.has(cancelled), false)
    assert.equal(existsSync(cancelledPath), false)
    assert.equal(service.openProject(project.id).assets.listByProject().length, 0)

    const token = await stageSynthetic(files, 'synthetic.xlsx', bytes)
    const path = files.takeUpload(token).path
    const preview = await dispatchOperation({ ...deps, operation: 'linguistProjectsImport', payload: { projectId: project.id, fileTokens: [token] } }) as Extract<LinguistProjectImportResult, { requiresXlsxMapping: true }>
    assert.equal(preview.requiresXlsxMapping, true)
    const otherGroup = service.openProject(project.id).taskGroups.change({ action: 'create', name: 'Other delivery' })
    await assert.rejects(dispatchOperation({ ...deps, operation: 'linguistProjectsConfirmXlsxMapping', payload: {
      projectId: project.id, taskGroupId: otherGroup, mappingId: token, sourceSha256: preview.sourceSha256,
    } }), /bound to another/)
    assert(files.pendingImports.has(token))
    const imported = await dispatchOperation({ ...deps, operation: 'linguistProjectsConfirmXlsxMapping', payload: {
      projectId: project.id, mappingId: preview.mappingId, sourceSha256: preview.sourceSha256,
      sheetName: 'Synthetic references', columns: { source: 'English', target: 'Chinese' }, rememberMapping: true,
    } }) as { assetId: string; status: string }
    assert.equal(imported.status, 'imported')
    assert.equal(existsSync(path), false)
    assert.deepEqual(readFileSync(service.resolveAssetSourcePath(project.id, imported.assetId).sourcePath), bytes)
    const duplicate = await stageSynthetic(files, 'synthetic.xlsx', bytes)
    const duplicatePath = files.takeUpload(duplicate).path
    const auto = await dispatchOperation({ ...deps, operation: 'linguistProjectsImport', payload: { projectId: project.id, fileTokens: [duplicate] } }) as { status: string; requiresXlsxMapping: boolean }
    assert.equal(auto.requiresXlsxMapping, false)
    assert.equal(auto.status, 'skipped-duplicate')
    assert.equal(existsSync(duplicatePath), false)
  } finally { service.closeAll(); rmSync(root, { recursive: true, force: true }) }
})

test('separately uploaded Phrase split and master are imported as one paired batch and both staging files are released', async () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'la-phrase-staging-')))
  const service = new LinguistProjectService({ rootDir: join(root, 'linguist'), applicationVersion: 'synthetic-test' })
  service.init()
  try {
    const project = await service.createProject({ name: 'Synthetic Phrase pairing', sourceLocale: 'en-US', targetLocale: 'zh-CN' })
    const files = new ManagedFiles(root)
    const split = Buffer.from('<xliff version="1.2" xmlns:m="http://www.memsource.com/mxlf/2.0"><file><body><trans-unit id="s1"><source>Open {0} world</source><target>打开 {0} 世界</target></trans-unit></body></file></xliff>')
    const master = Buffer.from('<xliff version="1.2"><file><body><trans-unit id="m1"><source>Open <ph id="1">{0}</ph> world</source></trans-unit></body></file></xliff>')
    const tokens = [await stageSynthetic(files, 'split.mxliff', split), await stageSynthetic(files, 'master.xliff', master)]
    const paths = tokens.map(token => files.takeUpload(token).path)
    const mutations = new MutationBus()
    const frames: string[] = []
    const unsubscribe = mutations.subscribe(project.id, 0, { write: (frame: string) => { frames.push(frame); return true } } as ServerResponse)
    const result = await dispatchOperation({
      service, files, bindings: new BindingStore(root), mutations, workspaceRegistry: { get: () => undefined },
      assertProjectSession: async () => { throw new Error('Unexpected Session check') }, resolveSessionWorkspace: async () => { throw new Error('Unexpected Workspace lookup') },
      operation: 'linguistProjectsImport', payload: { projectId: project.id, fileTokens: tokens, requestId: 'synthetic-paired-import' },
    }) as { imported: number; items: { status: string; message: string }[] }
    unsubscribe()
    const progress = frames.filter(frame => frame.startsWith('event: import-progress')).map(frame => JSON.parse(frame.split('\ndata: ')[1]!))
    for (const phase of ['reading', 'matching', 'parsing', 'writing', 'scanning']) assert.ok(progress.some(event => event.phase === phase), phase)
    assert.ok(progress.every(event => event.requestId === 'synthetic-paired-import' && event.projectId === project.id && event.total === 2))
    assert.doesNotMatch(JSON.stringify(progress), /Open|世界|staging/)
    const writing = progress.findIndex(event => event.phase === 'writing')
    assert.ok(writing > progress.findIndex(event => event.phase === 'parsing'))
    assert.ok(progress.findIndex(event => event.phase === 'scanning') > writing)
    assert.equal(result.imported, 1)
    assert.match(result.items[0]!.message, /唯一配对/)
    assert.equal(service.openProject(project.id).assets.listByProject().length, 1)
    assert.equal(service.openProject(project.id).segments.query({ limit: 1 })[0]!.source, 'Open <ph id="1">{0}</ph> world')
    assert.equal(paths.every(path => !existsSync(path)), true)
  } finally { service.closeAll(); rmSync(root, { recursive: true, force: true }) }
})

test('Host operation dispatch creates a bound project and preserves proposal mode semantics', async () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'la-dsh-dispatch-')))
  const service = new LinguistProjectService({ rootDir: join(root, 'linguist'), applicationVersion: 'synthetic-test' })
  service.init()
  try {
    const knownWorkspace = WorkspaceId('synthetic-workspace')
    const deps: Omit<DispatchOperationInput, 'operation' | 'payload'> = {
      service, bindings: new BindingStore(root), files: new ManagedFiles(root), mutations: new MutationBus(),
      workspaceRegistry: { get: id => id === knownWorkspace ? { id, path: root } : undefined },
      assertProjectSession: async () => { throw new Error('Unexpected Session authority check') },
      resolveSessionWorkspace: async () => { throw new Error('Unexpected Session Workspace lookup') },
    }
    const created = await dispatchOperation({ ...deps, operation: 'linguistProjectsCreate', payload: {
      workspaceId: knownWorkspace, name: 'Synthetic', sourceLocale: 'zh-CN', targetLocale: 'en-US',
    } }) as { id: string; workspaceId: string }
    assert.equal(created.workspaceId, knownWorkspace)
    const imported = await service.importAsset(created.id, { bytes: new TextEncoder().encode('key,source,target\na,开始,Begin\n'), filename: 'synthetic.csv' })
    assert.equal(imported.status, 'imported')
    const segment = service.openProject(created.id).segments.query({ limit: 1 })[0]!
    const proposed = await dispatchOperation({ ...deps, operation: 'linguistProposalsApplyTranslations', payload: {
      projectId: created.id, mode: 'proposal', edits: [{ segmentId: segment.id, baseRevision: segment.revision, target: 'Start' }],
    } }) as { pending: number; applied: number; proposalIds: string[] }
    assert.equal(proposed.pending, 1)
    assert.equal(proposed.applied, 0)
    assert.equal(service.openProject(created.id).segments.getById(segment.id)?.target, segment.target)
    const diff = await dispatchOperation({ ...deps, operation: 'linguistProposalsGetDiff', payload: {
      projectId: created.id, proposalId: proposed.proposalIds[0],
    } }) as { proposedTarget: string; currentTarget: string }
    assert.equal(diff.proposedTarget, 'Start')
    assert.equal(diff.currentTarget, segment.target)
  } finally {
    service.closeAll()
    rmSync(root, { recursive: true, force: true })
  }
})

test('working copy list reads historical sessions from the bound workspace', async () => {
  const root = mkdtempSync(join(tmpdir(), 'la-dsh-operations-'))
  try {
    writeFileSync(join(root, 'source.csv'), 'key,source,target\na,开始,Begin\n')
    const source = { sourcePath: 'source.csv', sourceLocale: 'zh-CN', targetLocale: 'en-US' }
    const baseline = await prepareWorkingCopy({ ...source, workspaceRoot: root })
    await executeWorkingCopyAction({ ...source, operation: 'prepare' }, () => ({ workspaceRoot: root, sessionId: 'previous-session' }))
    writeFileSync(join(root, 'decisions.json'), JSON.stringify({
      sourceSha256: baseline.sourceSha256,
      groups: [{ segmentIds: [baseline.segments[0]!.id], decision: 'unchanged' }],
      edits: [], unresolved: [],
    }))
    await executeWorkingCopyAction({ ...source, operation: 'assemble', decisionsPath: 'decisions.json' }, () => ({ workspaceRoot: root, sessionId: 'current-session' }))
    const input = {
      payload: { sessionId: 'reader-session' },
      resolveSessionWorkspace: async (sessionId: string) => {
        assert.equal(sessionId, 'reader-session')
        return { workspaceRoot: root }
      },
    }
    const listed = await listWorkingCopies(input)
    assert.equal(listed.total, 2)
    assert.equal(listed.truncated, false)
    assert.deepEqual(new Set(listed.items.map(item => item.ownerSessionId)), new Set(['previous-session', 'current-session']))
    assert.equal(listed.items.find(item => item.kind === 'result')?.status, 'coverage-complete')
    assert.equal(listed.items.every(item => item.submitted === false), true)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})


test('reference XLSX mapping previews explicit columns, binds the choice and confirms the original bytes for TM and TB', async () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'la-reference-xlsx-')))
  const service = new LinguistProjectService({ rootDir: join(root, 'linguist'), applicationVersion: 'synthetic-test' })
  service.init()
  const bytes = await referenceWorkbook()
  try {
    const project = await service.createProject({ name: 'Synthetic references', sourceLocale: 'en-US', targetLocale: 'zh-CN' })
    const foreign = await service.createProject({ name: 'Foreign candidate', sourceLocale: 'en-US', targetLocale: 'zh-CN' })
    const files = new ManagedFiles(root)
    const deps: Omit<DispatchOperationInput, 'operation' | 'payload'> = {
      service, files, bindings: new BindingStore(root), mutations: new MutationBus(), workspaceRegistry: { get: () => undefined },
      assertProjectSession: async () => { throw new Error('Unexpected Session check') }, resolveSessionWorkspace: async () => { throw new Error('Unexpected Workspace lookup') },
    }
    for (const kind of ['tm', 'terms'] as const) {
      const body = Buffer.concat([Buffer.from('--synthetic-boundary\r\nContent-Disposition: form-data; name="files"; filename="synthetic.xlsx"\r\nContent-Type: application/octet-stream\r\n\r\n'), bytes, Buffer.from('\r\n--synthetic-boundary--\r\n')])
      const request = Object.assign(Readable.from([body]), { headers: { 'content-type': 'multipart/form-data; boundary=synthetic-boundary' } }) as IncomingMessage
      const [token] = await files.stage(request)
      const query = () => kind === 'tm' ? service.queryTmReferences(project.id, { limit: 100, offset: 0 }) : service.queryTermReferences(project.id, { limit: 100, offset: 0 })
      const candidate = await dispatchOperation({ ...deps, operation: 'linguistReferencesImport', payload: { projectId: project.id, kind, fileTokens: [token] } }) as Extract<LinguistReferenceImportResult, { requiresXlsxMapping: true }>
      assert.equal(candidate.requiresXlsxMapping, true)
      assert.equal(candidate.sourceSha256, sha256Hex(bytes))
      assert.equal(candidate.preview.sheets[0]!.name, 'Synthetic references')
      assert.deepEqual(candidate.preview.sheets[0]!.columns.map(column => column.header), ['English', 'Chinese', 'French'])
      assert.equal(query().total, 0)
      const bound = { projectId: project.id, kind, candidateId: token, sourceSha256: candidate.sourceSha256 }
      await assert.rejects(dispatchOperation({ ...deps, operation: 'linguistReferencesConfirmImport', payload: bound }))
      const mapping = { ...bound, sheetName: 'Synthetic references', columns: { source: 'English', target: 'Chinese' } }
      for (const patch of [{ projectId: foreign.id }, { kind: kind === 'tm' ? 'terms' : 'tm' }, { sourceSha256: 'f'.repeat(64) }, { sheetName: 'Missing' }, { columns: { source: 'English', target: 'English' } }]) {
        await assert.rejects(dispatchOperation({ ...deps, operation: 'linguistReferencesMapXlsxCandidate', payload: { ...mapping, ...patch } }))
        assert.equal(query().total, 0)
      }
      const preview = await dispatchOperation({ ...deps, operation: 'linguistReferencesMapXlsxCandidate', payload: mapping }) as Extract<LinguistReferenceImportResult, { requiresXlsxMapping: false; requiresConfirmation: true }>
      assert.equal(preview.summary.entryCount, 2)
      assert.equal(query().total, 0)
      const original = await dispatchOperation({ ...deps, operation: 'linguistReferencesPreviewCandidate', payload: bound }) as { kind: string; path: string }
      assert.equal(original.kind, 'native')
      assert.deepEqual(readFileSync(original.path), bytes)
      const upload = files.takeUpload(token!)
      writeFileSync(upload.path, Buffer.from('changed after mapping'))
      await assert.rejects(dispatchOperation({ ...deps, operation: 'linguistReferencesConfirmImport', payload: bound }), /bytes changed/)
      assert.equal(query().total, 0)
      writeFileSync(upload.path, bytes)
      const imported = await dispatchOperation({ ...deps, operation: 'linguistReferencesConfirmImport', payload: bound }) as Extract<LinguistReferenceImportResult, { requiresConfirmation: false }>
      assert.equal(imported.imported, 2)
      assert.equal(imported.source.sourceSha256, sha256Hex(bytes))
      const page = query()
      assert.equal(page.total, 2)
      assert.deepEqual(page.items.map(item => 'source' in item ? [item.source, item.target] : [item.term, item.translation]).sort(), [['Close', '关闭'], ['Open', '打开']])
      assert.throws(() => files.takeUpload(token!))
      await assert.rejects(dispatchOperation({ ...deps, operation: 'linguistReferencesConfirmImport', payload: bound }), /candidate is missing/)
      const cancelRequest = Object.assign(Readable.from([body]), { headers: { 'content-type': 'multipart/form-data; boundary=synthetic-boundary' } }) as IncomingMessage
      const [cancelToken] = await files.stage(cancelRequest)
      const cancelledCandidate = await dispatchOperation({ ...deps, operation: 'linguistReferencesImport', payload: { projectId: project.id, kind, fileTokens: [cancelToken] } }) as Extract<LinguistReferenceImportResult, { requiresXlsxMapping: true }>
      const cancelBound = { ...bound, candidateId: cancelToken, sourceSha256: cancelledCandidate.sourceSha256 }
      await dispatchOperation({ ...deps, operation: 'linguistReferencesCancelImport', payload: cancelBound })
      assert.equal(query().total, 2)
      assert.throws(() => files.takeUpload(cancelToken!))
      await assert.rejects(dispatchOperation({ ...deps, operation: 'linguistReferencesMapXlsxCandidate', payload: { ...mapping, ...cancelBound } }), /candidate is missing/)
    }
  } finally { service.closeAll(); rmSync(root, { recursive: true, force: true }) }
})

test('reference delete accepts the real imported TM occurrence ID and deletes only that row', async () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'la-reference-delete-')))
  const service = new LinguistProjectService({ rootDir: join(root, 'linguist'), applicationVersion: 'synthetic-test' })
  service.init()
  try {
    const project = await service.createProject({ name: 'Synthetic TM occurrence', sourceLocale: 'en-US', targetLocale: 'zh-CN' })
    await service.importReference(project.id, 'tm', { filename: 'synthetic.csv', bytes: Buffer.from('source,target\nOpen,打开\nClose,关闭\n') })
    const input: Omit<DispatchOperationInput, 'operation' | 'payload'> = {
      service, files: new ManagedFiles(root), bindings: new BindingStore(root), mutations: new MutationBus(), workspaceRegistry: { get: () => undefined },
      assertProjectSession: async () => { throw new Error('Unexpected Session check') }, resolveSessionWorkspace: async () => { throw new Error('Unexpected Workspace lookup') },
    }
    const before = await dispatchOperation({ ...input, operation: 'linguistReferencesQueryTm', payload: { projectId: project.id } }) as LinguistReferenceQueryResult<LinguistTmReferenceInfo>
    assert.match(before.items[0]!.id, /^tmuo_v2_[0-9a-f]{64}$/)
    const deleted = await dispatchOperation({ ...input, operation: 'linguistReferencesDelete', payload: { projectId: project.id, kind: 'tm', id: before.items[0]!.id } })
    assert.deepEqual(deleted, { id: before.items[0]!.id })
    const after = await dispatchOperation({ ...input, operation: 'linguistReferencesQueryTm', payload: { projectId: project.id } }) as LinguistReferenceQueryResult<LinguistTmReferenceInfo>
    assert.deepEqual(after.items, [before.items[1]])
    assert.deepEqual(after.imports, before.imports)
    assert.equal(after.sources![0]!.unitCount, 1)
  } finally { service.closeAll(); rmSync(root, { recursive: true, force: true }) }
})

async function referenceWorkbook(): Promise<Buffer> {
  const JSZip = createRequire(new URL('../../../linguist-cat-formats/package.json', import.meta.url))('jszip')
  const zip = new JSZip()
  zip.file('[Content_Types].xml', '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/></Types>')
  zip.file('_rels/.rels', '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>')
  zip.file('xl/workbook.xml', '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Synthetic references" sheetId="1" r:id="rId1"/></sheets></workbook>')
  zip.file('xl/_rels/workbook.xml.rels', '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>')
  zip.file('xl/worksheets/sheet1.xml', '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>' + [['English', 'Chinese', 'French'], ['Open', '打开', 'Ouvrir'], ['Close', '关闭', 'Fermer']].map((row, i) => `<row r="${i + 1}">${row.map((value, j) => `<c r="${String.fromCharCode(65 + j)}${i + 1}" t="inlineStr"><is><t>${value}</t></is></c>`).join('')}</row>`).join('') + '</sheetData></worksheet>')
  return zip.generateAsync({ type: 'nodebuffer' })
}

async function stageSynthetic(files: ManagedFiles, filename: string, bytes: Buffer): Promise<string> {
  const request = Object.assign(Readable.from([
    Buffer.from(`--synthetic\r\nContent-Disposition: form-data; name="files"; filename="${filename}"\r\n\r\n`),
    bytes, Buffer.from('\r\n--synthetic--\r\n'),
  ]), { headers: { 'content-type': 'multipart/form-data; boundary=synthetic' } }) as IncomingMessage
  return (await files.stage(request))[0]!
}

test('project library GUI and Agent share originals, safe replacement, removal, read status and native CAT assets', async () => {
  const { createProjectPreparationTool } = await import('./project-preparation-tool')
  const { getProjectQuestionMaterials } = await import('@linguist/domain-service')
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'la-library-gui-')))
  const service = new LinguistProjectService({ rootDir: join(root, 'data'), applicationVersion: 'synthetic' })
  service.init()
  const files = new ManagedFiles(root), bindings = new BindingStore(root)
  try {
    const project = await service.createProject({ name: 'Synthetic resources', sourceLocale: 'en', targetLocale: 'zh-CN' })
    await service.reviewCache.setEnabled(false)
    const wid = WorkspaceId('synthetic-library-workspace')
    bindings.bindProject(project.id, wid)
    const deps: Omit<DispatchOperationInput, 'operation' | 'payload'> = {
      service, files, bindings, mutations: new MutationBus(), workspaceRegistry: { get: id => id === wid ? { id, path: root } : undefined },
      assertProjectSession: async () => { throw new Error('GUI must not need a CAT Session') },
      resolveSessionWorkspace: async () => { throw new Error('GUI must not need a Session') },
    }
    type Item = import('@linguist/domain-service/contracts').ProjectLibraryItem
    const call = async (operation: string, payload: Record<string, unknown> = {}) => await dispatchOperation({ ...deps, operation, payload: { projectId: project.id, ...payload } }) as { items: Item[] }
    const list = async () => (await call('linguistLibraryList')).items
    const upload = async (filename: string, text: string, kind: string, key?: string) => {
      const token = await stageSynthetic(files, filename, Buffer.from(text))
      const result = await call('linguistLibrarySave', { kind, key, fileTokens: [token] })
      assert.throws(() => files.takeUpload(token), 'completed uploads release staging')
      return result.items
    }
    const tool = createProjectPreparationTool(service, async () => ({ workspaceRoot: root, sessionId: 'synthetic',
      binding: { workspaceId: wid, projectId: project.id, role: 'general', workMode: 'browser' },
      askBatchCat: async () => undefined, askBatchOrder: async () => undefined }), () => {}, deps.bindings)
    writeFileSync(join(root, 'rules.txt'), 'Use short sentences.')
    await tool.execute({ resources: [{ path: 'rules.txt', kind: 'rules' }] }, {} as Parameters<typeof tool.execute>[1])
    assert.equal((await list())[0]!.filename, 'rules.txt', 'Agent registrations appear in GUI')
    await call('linguistLibrarySave', { key: 'file:rules.txt', kind: 'rules', appliesTo: ['dialogue'] })
    assert.deepEqual((await list())[0]!.appliesTo, ['dialogue'])
    let rows = await upload('terms.csv', 'source,target\nPotion,药剂\n', 'terms')
    const term = rows.find(item => item.kind === 'terms')!
    assert.equal(term.status, 'ready')
    assert.deepEqual((await getProjectQuestionMaterials(service, project.id, root, 'Potion')).terms.map(item => item.translation), ['药剂'], 'GUI import reaches Agent matching')
    rows = await upload('bad.csv', 'wrong\n', 'terms', term.key)
    assert(rows.some(item => item.key === term.key), 'failed replacement keeps old original active')
    const failed = rows.find(item => item.status === 'error')!
    assert(failed.error)
    const failedMaterials = await getProjectQuestionMaterials(service, project.id, root, 'Potion')
    assert.equal(failedMaterials.terms[0]!.translation, '药剂')
    assert(failedMaterials.warnings.some(warning => warning.includes('读取失败')))
    rows = await upload('fixed.csv', 'source,target\nPotion,恢复剂\n', 'terms', failed.key)
    assert(!rows.some(item => item.key === term.key || item.key === failed.key), 'repairing a failed replacement retires its superseded original too')
    assert.deepEqual((await getProjectQuestionMaterials(service, project.id, root, 'Potion')).terms.map(item => item.translation), ['恢复剂'])
    const fixed = rows.find(item => item.kind === 'terms')!
    assert.equal(readFileSync(join(root, term.path), 'utf8'), 'source,target\nPotion,药剂\n', 'workspace originals remain intact')
    await call('linguistLibraryRemove', { key: fixed.key })
    assert.equal((await getProjectQuestionMaterials(service, project.id, root, 'Potion')).terms.length, 0)
    assert(!(await list()).some(item => item.kind === 'terms'), 'retired native reference does not reappear')
    writeFileSync(join(root, 'rules.txt'), 'Use complete sentences.')
    assert.equal((await list())[0]!.status, 'changed')
    await call('linguistLibraryRefresh')
    assert.equal((await list())[0]!.status, 'ready')
    assert.match(JSON.stringify((await getProjectQuestionMaterials(service, project.id, root, 'dialogue')).related), /complete sentences/)
    rmSync(join(root, 'rules.txt'))
    assert.equal((await list())[0]!.status, 'error')
    await call('linguistLibraryRefresh')
    assert.equal((await list())[0]!.status, 'error', 'missing file remains visible and removable')
    await tool.execute({ removeResource: 'file:rules.txt' }, {} as Parameters<typeof tool.execute>[1])
    assert.equal((await list()).length, 0, 'Agent removal updates GUI list')

    await service.importReference(project.id, 'tm', { filename: 'native.csv', bytes: Buffer.from('source,target\nOpen menu,打开菜单\n') })
    await service.importContextDoc(project.id, { filename: 'notes.txt', bytes: Buffer.from('A potion restores energy.') })
    rows = await list()
    assert.equal(rows.length, 2)
    assert(rows.every(item => item.origin === 'cat'))
    await call('linguistLibraryRemove', { key: rows.find(item => item.kind === 'tm')!.key })
    assert.equal((await getProjectQuestionMaterials(service, project.id, root, 'Open menu')).tm.length, 0)
    const doc = rows.find(item => item.kind === 'context')!
    rows = (await call('linguistLibrarySave', { key: doc.key, kind: 'rules', appliesTo: ['battle'] })).items
    assert.equal(rows.length, 1)
    assert.equal(rows[0]!.kind, 'rules')
    assert.deepEqual(rows[0]!.appliesTo, ['battle'])
    assert.match(JSON.stringify((await getProjectQuestionMaterials(service, project.id, root, 'battle')).related), /restores energy/)
    const preview = await dispatchOperation({ ...deps, operation: 'linguistLibraryPreview', payload: { projectId: project.id, key: rows[0]!.key } }) as { text: string }
    assert.match(preview.text, /restores energy/)
    await call('linguistLibraryRemove', { key: rows[0]!.key })
    assert.equal((await list()).length, 0)
    assert(service.openProject(project.id).contextDocs.get(doc.key.slice('document:'.length)), 'earlier review evidence can still resolve the document')
    assert.equal(service.queryProjectAssets(project.id, 'contextDocs', { offset: 0, limit: 10 }).total, 0)
    assert.equal((await getProjectQuestionMaterials(service, project.id, root, 'potion')).related.length, 0)
    const status = (operation: string) => dispatchOperation({ ...deps, operation, payload: { projectId: project.id, taskGroupId: '' } })
    assert.deepEqual(await status('linguistLibraryPreparationStatus'), { phase: 'disabled' })
    await service.reviewCache.setEnabled(true)
    assert.equal((await status('linguistLibraryPrepare') as { phase: string }).phase, 'queued')
    await new Promise<void>(resolve => setImmediate(resolve))
    assert.deepEqual((await status('linguistLibraryPreparationStatus') as { phase: string; total: number }).total, 0)
  } finally { service.closeAll(); rmSync(root, { recursive: true, force: true }) }
})

test('group-bound CAT pages, totals and concordance use the same batch membership', async () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'la-group-cat-view-')))
  const service = new LinguistProjectService({ rootDir: root, applicationVersion: 'synthetic-test' })
  service.init()
  try {
    const { id } = await service.createProject({ name: 'Synthetic', sourceLocale: 'en', targetLocale: 'zh-CN' })
    const deps: Omit<DispatchOperationInput, 'operation' | 'payload'> = { service, files: new ManagedFiles(root), bindings: new BindingStore(root),
      mutations: new MutationBus(), workspaceRegistry: { get: () => undefined }, assertProjectSession: async () => {}, resolveSessionWorkspace: async () => ({ workspaceRoot: root }) }
    const groups = []
    for (const name of ['November', 'December']) {
      const created = await dispatchOperation({ ...deps, operation: 'linguistTaskGroups', payload: { projectId: id, change: { action: 'create', name } } }) as { changedId: string }
      groups.push(created.changedId)
    }
    const assets = []
    for (const taskGroupId of groups) {
      const token = await stageSynthetic(deps.files, 'batch.xliff', Buffer.from('<xliff version="1.2"><file><body><trans-unit id="one"><source>Potion</source><target>药剂</target></trans-unit></body></file></xliff>'))
      const created = await dispatchOperation({ ...deps, operation: 'linguistProjectsImport', payload: { projectId: id, taskGroupId, fileTokens: [token] } }) as { assetId: string }
      assets.push(created.assetId)
    }
    assert.notEqual(assets[0], assets[1])
    const db = service.openProject(id)
    const findings = []
    const proposals = []
    for (const assetId of assets) {
      const segment = db.segments.query({ assetId, limit: 1 })[0]!
      findings.push(db.qaFindings.insertOpen([{ segmentId: segment.id, code: 'SYNTHETIC', message: 'Synthetic finding', severity: 'L2' }])[0]!.id)
      const result = await dispatchOperation({ ...deps, operation: 'linguistProposalsApplyTranslations', payload: { projectId: id, mode: 'proposal', edits: [{ segmentId: segment.id, baseRevision: segment.revision, target: '药水' }] } }) as { proposalIds: string[] }
      proposals.push(result.proposalIds[0]!)
    }
    for (const [index, taskGroupId] of groups.entries()) {
      const summary = service.getProjectSummary(id, taskGroupId)
      assert.equal(summary.totalSegments, 1)
      assert.deepEqual(summary.assets.map(asset => asset.assetId), [assets[index]])
      const page = await dispatchOperation({ ...deps, operation: 'linguistCatQuery', payload: { projectId: id, taskGroupId, includeIndex: true } }) as { segments: { assetId: string }[]; segmentIds: string[] }
      assert.deepEqual(page.segments.map(row => row.assetId), [assets[index]])
      assert.equal(page.segmentIds.length, 1)
      const qa = await dispatchOperation({ ...deps, operation: 'linguistCatListQaFindings', payload: { projectId: id, taskGroupId, code: 'SYNTHETIC' } }) as { total: number; items: { id: string }[] }
      assert.deepEqual([qa.total, qa.items.map(item => item.id)], [1, [findings[index]]])
      const inbox = await dispatchOperation({ ...deps, operation: 'linguistProposalsList', payload: { projectId: id, taskGroupId } }) as { total: number; items: { proposal: { id: string } }[] }
      assert.deepEqual([inbox.total, inbox.items.map(item => item.proposal.id)], [1, [proposals[index]]])
      await assert.rejects(dispatchOperation({ ...deps, operation: 'linguistProposalsGetDiff', payload: { projectId: id, taskGroupId, proposalId: proposals[1 - index] } }), /task group/)
      await assert.rejects(dispatchOperation({ ...deps, operation: 'linguistCatWaiveQaFindingsBulk', payload: { projectId: id, taskGroupId, findingIds: findings, reason: 'Synthetic duplication', operator: 'Tester' } }), /task group/)
      const matches = await dispatchOperation({ ...deps, operation: 'linguistCatConcordance', payload: { projectId: id, query: 'Potion', sourceAssetId: assets[index] } }) as { segments: { segment: { assetId: string } }[] }
      assert.deepEqual(matches.segments.map(row => row.segment.assetId), [assets[index]])
    }
  } finally { service.closeAll(); rmSync(root, { recursive: true, force: true }) }
})
