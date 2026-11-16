import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { createAsset, deriveSegmentId, type Segment } from '@linguist/cat-core'
import { CatStore } from '@linguist/cat-store'
import { createProjectTools } from './project-tools'
import { createReferenceTools } from './reference-tools'
import { createCatToolRuntime } from './tool-runtime'

test('segment pages keep complete UTF-8 content and notes, return exact continuation and expose oversized rows', async () => {
  const rootDir = mkdtempSync(join(tmpdir(), 'cat-segment-page-'))
  const store = new CatStore({ rootDir })
  const project = store.createProject({ name: 'Synthetic page budget', sourceLocale: 'zh-CN', targetLocale: 'en' })
  const db = store.openProject(project.id)
  try {
    const asset = createAsset({ projectId: project.id, formatId: 'synthetic', originalFilename: 'page.txt', sourceSha256: 'a'.repeat(64), segmentCount: 9 })
    const segments: Segment[] = Array.from({ length: 9 }, (_, ordinal) => ({
      id: deriveSegmentId(asset.id, ordinal), assetId: asset.id, ordinal, key: `key-${ordinal}`,
      source: `${ordinal}：${'完整原文😀'.repeat(ordinal === 3 ? 2000 : 300)}`,
      target: `Complete target ${ordinal} ${'text '.repeat(300)}`,
      sourceLocale: 'zh-CN', targetLocale: 'en', status: 'translated', locked: ordinal === 2,
      revision: 0, sourceHash: `source-${ordinal}`,
      context: { note: `Approved wording ${ordinal}; preserve this text.`, origin: 'Synthetic UI', meta: { speaker: 'Narrator' } },
    }))
    db.assets.insert(asset, segments)
    const runtime = createCatToolRuntime({ resolveProject: () => ({ project, db }), resultProjectId: project.id })
    const tool = createProjectTools(runtime)[2]
    const ids: string[] = []
    let offset = 0
    let oversizedPages = 0
    let pages = 0
    do {
      const result = await tool.execute(`page-${offset}`, { batchId: asset.id, offset, limit: 100 })
      const page = result.details!
      assert.ok('items' in page)
      const text = result.content[0]!
      assert.equal(text.type, 'text')
      const bytes = Buffer.byteLength('text' in text ? text.text : '', 'utf8')
      assert.equal(page.maxBytes, 24 * 1024)
      if (page.oversized) {
        oversizedPages++
        assert.equal(page.items.length, 1)
        assert.ok(bytes > page.maxBytes)
        assert.match(page.note!, /complete|untruncated/)
        assert.match(page.note!, /maxBytes=24576/)
      } else assert.ok(bytes <= page.maxBytes, `${bytes} > ${page.maxBytes}`)
      assert.ok(page.items.length > 0)
      for (const item of page.items) {
        const expected = segments.find(segment => segment.id === item.segmentId)!
        assert.ok(expected)
        assert.ok('source' in item && 'target' in item && 'context' in item)
        assert.equal(item.source, expected.source)
        assert.equal(item.target, expected.target)
        assert.deepEqual(item.context, expected.context)
        assert.equal(item.key, expected.key)
        assert.equal(item.revision, expected.revision)
        assert.equal(item.locked, expected.locked)
        assert.equal(item.originalOrdinal, expected.ordinal + 1)
        assert.ok(!('id' in item) && !('ordinal' in item))
        ids.push(item.segmentId as string)
      }
      offset += page.items.length
      assert.equal(page.nextOffset, page.hasMore ? offset : null)
      if (!page.hasMore) break
      assert.ok(++pages < segments.length, 'pagination must advance without repeating rows')
    } while (true)
    assert.deepEqual(ids, segments.map(segment => segment.id))
    assert.equal(oversizedPages, 1)
    const contextTool = createReferenceTools(runtime)[0]
    let cursor: string | undefined
    let payload = ''
    do {
      const fragment = await contextTool.execute('oversized-context', {
        segmentIds: [segments[3]!.id], includeNeighbors: false, readOnly: true, maxBytes: 24 * 1024,
        ...(cursor === undefined ? {} : { cursor }),
      })
      assert.ok(Buffer.byteLength(JSON.stringify(fragment.details), 'utf8') <= 24 * 1024)
      assert.equal(fragment.details!.contextFragment!.offset, payload.length)
      payload += fragment.details!.contextFragment!.text
      cursor = fragment.details!.nextCursor
    } while (cursor !== undefined)
    assert.equal(JSON.parse(payload).contexts[0].source, segments[3]!.source)
    assert.equal(JSON.parse(payload).contexts[0].currentTarget, segments[3]!.target)
    const index = (await tool.execute('index', { view: 'index', limit: 100 })).details!
    assert.ok('items' in index)
    assert.deepEqual(index.items.map(item => item.segmentId), ids)
    for (const item of index.items) assert.ok(!('source' in item) && !('target' in item) && !('context' in item))
    const beyond = (await tool.execute('beyond', { offset: 1000 })).details!
    assert.ok('items' in beyond)
    assert.deepEqual(beyond.items, [])
    assert.equal(beyond.nextOffset, null)
  } finally {
    db.close()
    rmSync(rootDir, { recursive: true, force: true })
  }
})
