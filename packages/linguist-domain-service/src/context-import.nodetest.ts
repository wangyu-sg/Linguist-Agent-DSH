import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { runLinguistContextImportWorker } from './cat-job-worker-client'
import { LinguistProjectService } from './project-service'

test('Context 大批量导入时主线程持续响应，完成后可读，失败后释放写入守卫', async () => {
  const rootDir = mkdtempSync(join(tmpdir(), 'la-context-worker-'))
  const service = new LinguistProjectService({
    rootDir, applicationVersion: 'test',
  })
  service.init()
  let timer: ReturnType<typeof setInterval> | undefined
  try {
    const project = await service.createProject({
      name: '隔离导入', sourceLocale: 'en', targetLocale: 'zh-CN',
    })
    const db = service.openProject(project.id)
    const input = {
      filename: 'large.txt',
      bytes: new TextEncoder().encode(Array.from({ length: 20_000 }, (_, index) => `参考段落 ${index}`).join('\n')),
    }
    let ticks = 0
    let last = performance.now()
    let longestGap = 0
    timer = setInterval(() => {
      const now = performance.now()
      longestGap = Math.max(longestGap, now - last)
      last = now
      ticks++
      // 独立写连接的事务不阻塞主线程读取已提交快照。
      db.contextDocs.count()
    }, 10)
    const pending = service.importContextDoc(project.id, input)
    assert.throws(() => service.archiveProject(project.id), /正在导入/)
    await assert.rejects(service.importContextDoc(project.id, input), /正在导入/)
    const doc = await pending
    longestGap = Math.max(longestGap, performance.now() - last)
    clearInterval(timer)
    assert.ok(ticks >= 3, `导入期间主线程只响应 ${ticks} 次`)
    assert.ok(longestGap < 500, `导入阻塞主线程 ${Math.round(longestGap)}ms`)
    assert.equal(db.contextDocs.listAnchors(doc.id).length, 20_000)
    assert.equal(db.contextDocs.count(), 1)
    await assert.rejects(service.importContextDoc(project.id, {
      filename: 'broken.xlsx', bytes: new Uint8Array([1, 2, 3]),
    }))
    assert.equal(db.contextDocs.count(), 1)
    service.assertProjectWritable(project.id)
    service.archiveProject(project.id)
    await assert.rejects(runLinguistContextImportWorker({
      projectId: project.id, projectDir: service.getProjectPaths(project.id).projectDir, input,
    }), /archived/)
  } finally {
    clearInterval(timer)
    service.closeAll()
    rmSync(rootDir, { recursive: true, force: true })
  }
})

test('Host 图片 metadata 使无扩展名及误导名称仍盘点和导入为精确图片原件', async () => {
  const rootDir = realpathSync(mkdtempSync(join(tmpdir(), 'la-native-image-context-')))
  const service = new LinguistProjectService({ rootDir, applicationVersion: 'test' })
  service.init()
  try {
    const project = await service.createProject({ name: 'Synthetic image attachment', sourceLocale: 'en', targetLocale: 'zh-CN' })
    const bytes = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jR3sAAAAASUVORK5CYII=', 'base64')
    const digest = createHash('sha256').update(bytes).digest('hex')
    const path = join(rootDir, digest)
    writeFileSync(path, bytes)
    const split = join(rootDir, 'synthetic-split.mxliff')
    writeFileSync(split, '<xliff version="1.2" xmlns:m="http://www.memsource.com/mxlf/2.0"><file><body><trans-unit id="one"><source>Open {0} world</source><target>打开 {0} 世界</target></trans-unit></body></file></xliff>')
    for (const filename of [undefined, 'visual.pdf', 'visual.xlf']) {
      const images = new Map([[path, { filename, mediaType: 'image/png' as const }]])
      const paths = filename === 'visual.xlf' ? [path, split] : [path]
      const preview = await service.importResourcesFromPaths(project.id, rootDir, { paths, recursive: false, kind: 'auto', dryRun: true }, images)
      assert.equal(preview.ready, 1)
      assert.equal(preview.items[0]!.filename, filename ?? digest)
      assert.equal(preview.items[0]!.imageMediaType, 'image/png')
      const imported = await service.importResourcesFromPaths(project.id, rootDir, { paths, recursive: false, kind: 'auto', dryRun: false }, images)
      assert.equal(imported.imported, 1)
      const doc = service.openProject(project.id).contextDocs.get(imported.items[0]!.resourceId!)!
      assert.equal(doc.kind, 'image')
      assert.equal(doc.originalFilename, filename ?? digest)
      assert.equal(doc.sha256, digest)
      assert.ok(doc.blobRelpath.endsWith('.png'))
      assert.deepEqual(readFileSync(service.resolveContextDocPreviewPath(project.id, doc.id).sourcePath), bytes)
      const anchors = service.openProject(project.id).contextDocs.listAnchors(doc.id)
      assert.equal(anchors.length, 1)
      assert.equal(anchors[0]!.locator.kind, 'image')
      assert.equal(anchors[0]!.mediaContextDocId, doc.id)
    }
  } finally {
    service.closeAll()
    rmSync(rootDir, { recursive: true, force: true })
  }
})
