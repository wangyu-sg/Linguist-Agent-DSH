import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import fs from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createRequire, syncBuiltinESMExports } from 'node:module'
import { Readable } from 'node:stream'
import type { IncomingMessage } from 'node:http'
import { sha256Hex } from '@linguist/cat-core'
import type { LinguistProjectImportResult, LinguistReferenceImportResult, LinguistReferenceQueryResult, LinguistTmReferenceInfo } from '@linguist/domain-service/contracts'
import test from 'node:test'
import { WorkspaceId } from '@deepseek-ai/dsh-workspace'
import { executeWorkingCopyAction, LinguistProjectService, prepareWorkingCopy } from '@linguist/domain-service'
import { BindingStore } from './bindings'
import { ManagedFiles } from './files'
import { MutationBus } from './mutations'
import { dispatchOperation, listWorkingCopies, type DispatchOperationInput } from './operations'

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
    const result = await dispatchOperation({
      service, files, bindings: new BindingStore(root), mutations: new MutationBus(), workspaceRegistry: { get: () => undefined },
      assertProjectSession: async () => { throw new Error('Unexpected Session check') }, resolveSessionWorkspace: async () => { throw new Error('Unexpected Workspace lookup') },
      operation: 'linguistProjectsImport', payload: { projectId: project.id, fileTokens: tokens },
    }) as { imported: number; items: { status: string; message: string }[] }
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
      const original = await dispatchOperation({ ...deps, operation: 'linguistReferencesPreviewCandidate', payload: bound }) as { kind: string; html: string }
      assert.equal(original.kind, 'html')
      assert.match(original.html, /Ouvrir/)
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
