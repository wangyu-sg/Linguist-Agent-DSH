import assert from 'node:assert/strict'
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { delimiter, join } from 'node:path'
import { tmpdir } from 'node:os'
import test from 'node:test'
import type { Segment } from '@linguist/cat-core'
import { getSemanticReview } from './semantic-review'
import { buildWorkingReview, workingReviewInput } from './working-review'

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
  if (Object.keys(request).sort().join(',') !== 'cachePath,texts') process.exit(3);
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
  } finally {
    if (previousPath === undefined) delete process.env.PATH
    else process.env.PATH = previousPath
    rmSync(root, { recursive: true, force: true })
  }
})
