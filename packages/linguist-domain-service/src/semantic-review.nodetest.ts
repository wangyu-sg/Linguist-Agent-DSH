import assert from 'node:assert/strict'
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { delimiter, join } from 'node:path'
import { tmpdir } from 'node:os'
import { setTimeout as delay } from 'node:timers/promises'
import test from 'node:test'
import type { Segment } from '@linguist/cat-core'
import { getSemanticReview } from './semantic-review'
import { buildWorkingReview, workingReviewInput } from './working-review'
import { loadDatabaseSync } from '@linguist/cat-store'
import { ReviewCache } from './review-cache'

test('only the last cancelled material search stops its subprocess and a same-key retry stays cached', async () => {
  const root = mkdtempSync(join(tmpdir(), 'la-search-consumers-'))
  const previousPath = process.env.PATH
  const cache = new ReviewCache(root)
  const search = (query: string, signal?: AbortSignal) => cache.search(join(root, 'cache.sqlite'), ['entry'], [query], signal)
  const started = join(root, 'started')
  const launches = () => readFileSync(started, 'utf8').trim().split('\n')
  const waitFor = async (condition: () => boolean) => {
    const deadline = Date.now() + 5_000
    while (!condition()) { assert.ok(Date.now() < deadline, 'synthetic subprocess did not reach the expected state'); await delay(10) }
  }
  try {
    writeFileSync(join(root, 'memsearch'), 'synthetic launcher')
    writeFileSync(join(root, 'python'), `#!${process.execPath}
const fs = require('node:fs'), path = require('node:path');
process.stdin.resume();
process.stdin.on('end', () => {
  const marker = path.join(__dirname, String(process.pid));
  process.on('SIGTERM', () => { fs.writeFileSync(marker + '.stopped', ''); process.exit(0) });
  console.error('LA_PROGRESS preparing 1 2');
  fs.appendFileSync(path.join(__dirname, 'started'), process.pid + '\\n');
  setInterval(() => { if (fs.existsSync(marker + '.finish')) { console.log('{"groups":[[0]]}'); process.exit(0) } }, 10);
  setTimeout(() => process.exit(1), 8_000);
});`, { mode: 0o700 })
    process.env.PATH = root + delimiter + (previousPath ?? '')
    const first = new AbortController()
    const cancelled = assert.rejects(search('shared', first.signal), { name: 'AbortError' })
    const otherReader = search('shared')
    await waitFor(() => existsSync(started))
    const path = join(root, 'cache.sqlite')
    const progress = () => cache.activeProgress(path, '')
    await waitFor(() => progress()[0]?.progress.phase === 'preparing')
    assert.deepEqual(progress(), [{ kind: 'materials', progress: { phase: 'preparing', ready: 1, total: 2 } }])
    assert.deepEqual(cache.activeProgress(path, 'another-group'), [])
    assert.deepEqual(cache.activeProgress(join(root, 'other-project.sqlite'), ''), [])
    first.abort()
    await cancelled
    assert.equal(launches().length, 1)
    writeFileSync(join(root, launches()[0]! + '.finish'), '')
    assert.deepEqual(await otherReader, [[0]])
    assert.deepEqual(progress(), [])

    const last = new AbortController()
    const stopped = assert.rejects(search('retry', last.signal), { name: 'AbortError' })
    await waitFor(() => launches().length === 2)
    last.abort()
    const retry = search('retry')
    await stopped
    await waitFor(() => existsSync(join(root, launches()[1]! + '.stopped')) && launches().length === 3)
    writeFileSync(join(root, launches()[2]! + '.finish'), '')
    assert.deepEqual(await retry, [[0]])
    assert.deepEqual(await search('retry'), [[0]])
    assert.equal(launches().length, 3)

    const review = new AbortController()
    const grouping = cache.get(join(root, 'cache.sqlite'), [{ id: 'test', ordinal: 1, key: 'test', source: 'Paper crane', target: '', locked: false }], review.signal)
    await waitFor(() => launches().length === 4)
    review.abort()
    assert.equal((await grouping).status, 'failed')
    await waitFor(() => existsSync(join(root, launches()[3]! + '.stopped')))
  } finally {
    cache.dispose()
    if (previousPath === undefined) delete process.env.PATH
    else process.env.PATH = previousPath
    rmSync(root, { recursive: true, force: true })
  }
})

test('semantic subprocess boundary is offline, maps stable IDs, preserves current targets, and exposes failures', async () => {
  const root = mkdtempSync(join(tmpdir(), 'la-semantic-boundary-'))
  const previousPath = process.env.PATH
  process.env.PATH = root + delimiter + previousPath
  const segments = [
    { id: 'first', ordinal: 0, source: 'Please water the violet fern.', target: 'First current target', locked: false },
    { id: 'last', ordinal: 70, source: 'Water the violet fern this morning.', target: 'Latest reviewer draft', locked: true, context: { meta: { usage: 'Synthetic description' } } },
  ] as unknown as Segment[]
  const writeBackend = (body: string) => {
    writeFileSync(join(root, 'python'), `#!${process.execPath}\n${body}`)
    chmodSync(join(root, 'python'), 0o700)
  }
  try {
    writeFileSync(join(root, 'memsearch'), 'synthetic launcher')
    writeBackend(`
if (process.env.HF_HUB_OFFLINE !== '1' || process.env.TRANSFORMERS_OFFLINE !== '1') process.exit(2);
let input = ''; process.stdin.on('data', chunk => input += chunk);
process.stdin.on('end', () => {
  const request = JSON.parse(input);
  if (Object.keys(request).sort().join(',') !== 'cachePath,taskGroupId,texts') process.exit(3);
  console.log(JSON.stringify({model:'gpahal/bge-m3-onnx-int8',fingerprint:'synthetic',texts:request.texts,
    groups:[{anchor:0,members:[0,1]}],embedded:0,cached:2,reusedGroups:true}));
});`)
    const semantic = await getSemanticReview(join(root, 'cache.sqlite'), segments, new AbortController().signal)
    assert.equal(semantic.status, 'ready')
    if (semantic.status !== 'ready') assert.fail('Synthetic backend did not return ready')
    assert.deepEqual(semantic.groups, [{ anchorId: 'first', segmentIds: ['first', 'last'] }])
    const items = segments.map(segment => ({ segmentId: segment.id, status: 'pending' as const }))
    const review = buildWorkingReview(segments, items, semantic)
    const related = review.files.find(file => file.name === 'group-1.md')!.text
    assert.match(related, /Latest reviewer draft/)
    assert.match(related, /Synthetic description/)
    assert.match(related, /锁定: 是/)
    assert.match(related, /不是错误/)
    assert.equal(related.split('Latest reviewer draft').length - 1, 1, 'related row already in this group is printed once')
    assert.ok(review.files.every(file => !file.name.startsWith('related-')), 'normal reading contains the relation; no extra retrieval file')
    assert.ok(!('findings' in semantic), 'retrieval must not generate QA findings')
    segments[1]!.target = 'Changed draft after retrieval'
    assert.match(buildWorkingReview(segments, items, semantic).files.find(file => file.name === 'group-1.md')!.text, /Changed draft after retrieval/)
    assert.match(review.files.find(file => file.name === 'cross-review.md')!.text, /已编入普通阅读组/)
    const longRow = { ...segments[0]!, source: '完整长文'.repeat(9000) }
    const longReview = buildWorkingReview([longRow], [items[0]!], { status: 'disabled' })
    const longInput = workingReviewInput(longReview, 'materials')
    assert.equal(longInput.readingContent, '', 'long atomic text must not overflow the normal tool result')
    assert.equal(longInput.continuationPaths[0], join('materials', 'group-1.md'))
    assert.ok(longReview.files[0]!.text.includes(longRow.source), 'full text remains in the ordinary first group file')
    writeBackend(readFileSync(join(root, 'python'), 'utf8').split('\n').slice(1).join('\n').replace('members:[0,1]', 'members:[0,999]'))
    const invalid = await getSemanticReview(join(root, 'cache.sqlite'), segments, new AbortController().signal)
    assert.equal(invalid.status, 'failed')
    assert.match(buildWorkingReview(segments, items, invalid).files.find(file => file.name === 'cross-review.md')!.text, /范围外/)
    writeBackend('process.stderr.write("Synthetic model unavailable"); process.exit(1)')
    const failed = await getSemanticReview(join(root, 'cache.sqlite'), segments, new AbortController().signal)
    assert.equal(failed.status, 'failed')
    if (failed.status === 'failed') assert.match(failed.error, /Synthetic model unavailable/)
    const abort = new AbortController()
    abort.abort()
    assert.equal((await getSemanticReview(join(root, 'cache.sqlite'), segments, abort.signal)).status, 'failed')
    writeBackend(`
let input = ''; process.stdin.on('data', chunk => input += chunk);
process.stdin.on('end', () => {
  const request = JSON.parse(input);
  require('node:fs').appendFileSync(${JSON.stringify(join(root, 'search-calls'))}, '1');
  console.log(JSON.stringify({groups: request.queries.map(() => [request.texts.indexOf('Original query and complete reply')])}));
});`)
    const cache = new ReviewCache(root)
    const cachePath = join(root, 'materials.sqlite')
    const texts = ['Original query and complete reply', 'Unrelated paragraph']
    assert.deepEqual(await cache.search(cachePath, texts, ['Relevant question']), [[0]])
    assert.deepEqual(await cache.search(cachePath, texts, ['Relevant question']), [[0]])
    assert.equal(readFileSync(join(root, 'search-calls'), 'utf8'), '1', 'warm identical search launches no subprocess')
    assert.deepEqual(await cache.search(cachePath, [...texts].reverse(), ['Relevant question']), [[1]], 'indices follow corpus order')
    await cache.clear(cachePath)
    await cache.search(cachePath, texts, ['Relevant question'])
    assert.equal(readFileSync(join(root, 'search-calls'), 'utf8'), '111')
    await cache.search(cachePath, texts, ['Relevant question'], undefined, 'group-a')
    await cache.search(cachePath, texts, ['Relevant question'], undefined, 'group-b')
    const db = new (loadDatabaseSync())(cachePath)
    try {
      db.exec("CREATE TABLE groups(key TEXT PRIMARY KEY, value TEXT); INSERT INTO groups VALUES ('group-a:k','[]'),('group-b:k','[]'); CREATE TABLE vectors(key TEXT PRIMARY KEY); INSERT INTO vectors VALUES ('common')")
      await cache.clear(cachePath, 'group-a')
      assert.deepEqual(db.prepare('SELECT key FROM groups').all().map(value => (value as { key: string }).key), ['group-b:k'])
      assert.ok(db.prepare('SELECT 1 FROM vectors').get())
      const calls = readFileSync(join(root, 'search-calls'), 'utf8')
      await cache.search(cachePath, texts, ['Relevant question'], undefined, 'group-b')
      assert.equal(readFileSync(join(root, 'search-calls'), 'utf8'), calls)
      await cache.search(cachePath, texts, ['Relevant question'], undefined, 'group-a')
      assert.equal(readFileSync(join(root, 'search-calls'), 'utf8'), calls + '1')
    } finally { db.close() }
    await cache.setEnabled(false)
    assert.deepEqual(await cache.search(cachePath, texts, ['Relevant question']), [])
    cache.dispose()
  } finally {
    if (previousPath === undefined) delete process.env.PATH
    else process.env.PATH = previousPath
    rmSync(root, { recursive: true, force: true })
  }
})
