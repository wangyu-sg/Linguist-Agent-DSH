import assert from 'node:assert/strict'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, realpathSync, rmSync, symlinkSync, utimesSync, writeFileSync } from 'node:fs'
import type { IncomingMessage } from 'node:http'
import { once } from 'node:events'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Readable } from 'node:stream'
import test from 'node:test'
import { LINGUIST_FILE_MAX_BYTES } from '@linguist/domain-service/contracts'
import { ManagedFiles } from './files'

function upload(bytes: number): IncomingMessage {
  return Object.assign(Readable.from([
    Buffer.from('--files-test\r\nContent-Disposition: form-data; name="files"; filename="synthetic.txt"\r\n\r\n'),
    Buffer.alloc(bytes, 'x'), Buffer.from('\r\n--files-test--\r\n'),
  ]), { headers: { 'content-type': 'multipart/form-data; boundary=files-test' } }) as IncomingMessage
}

test('streaming upload accepts the exact inclusive limit and rejects one more byte without retaining staging', async () => {
  assert.equal(LINGUIST_FILE_MAX_BYTES, 536_870_912)
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'la-upload-boundary-')))
  try {
    const files = new ManagedFiles(root, 32)
    const [token] = await files.stage(upload(32))
    assert.equal(existsSync(files.takeUpload(token!).path), true)
    files.discardUpload(token!)
    await assert.rejects(files.stage(upload(33)), (error: { code?: string; sizeBytes?: number; limitBytes?: number; filename?: string }) =>
      error.code === 'IMPORT_TOO_LARGE' && error.sizeBytes === 33 && error.limitBytes === 32 && error.filename === 'synthetic.txt')
    assert.deepEqual(readdirSync(join(root, 'staging')), [])
  } finally { rmSync(root, { recursive: true, force: true }) }
})

test('expiry clears idle candidates and protects in-flight files and formal downloads', async (context) => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'la-upload-expiry-')))
  let now = Date.now()
  context.mock.method(Date, 'now', () => now)
  try {
    const files = new ManagedFiles(root)
    const [token] = await files.stage(upload(12))
    const path = files.takeUpload(token!).path
    files.pendingImports.set(token!, { projectId: 'synthetic', kind: 'xlsx', sha256: 'a'.repeat(64) })
    const original = join(root, 'original.txt')
    writeFileSync(original, 'formal synthetic source')
    files.issueDownload(original, 'original.txt')
    await files.useUploads([token!], async () => {
      now += 3_600_001
      files.collectExpired()
      assert.equal(files.takeUpload(token!).path, path)
      assert.equal(files.pendingImports.has(token!), true)
      assert.equal(existsSync(path), true)
    })
    assert.equal(existsSync(path), false)
    assert.equal(files.pendingImports.has(token!), false)
    assert.equal(existsSync(original), true)
    files.discardUpload(token!)
  } finally { rmSync(root, { recursive: true, force: true }) }
})

test('restart collection removes only expired owned token directories, preserving new candidates and unrelated data', () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'la-upload-restart-')))
  try {
    const staging = join(root, 'staging')
    mkdirSync(staging)
    const expired = join(staging, 'a'.repeat(32))
    const fresh = join(staging, 'b'.repeat(32))
    const unrelated = join(staging, 'keep-custom-data')
    for (const path of [expired, fresh, unrelated]) { mkdirSync(path); writeFileSync(join(path, 'synthetic.txt'), 'synthetic') }
    const old = (Date.now() - 3_600_001) / 1000
    utimesSync(expired, old, old)
    utimesSync(unrelated, old, old)
    symlinkSync(unrelated, join(staging, 'c'.repeat(32)))
    new ManagedFiles(root)
    assert.equal(existsSync(expired), false)
    assert.equal(existsSync(fresh), true)
    assert.equal(existsSync(unrelated), true)
    assert.equal(existsSync(join(staging, 'c'.repeat(32))), true)
  } finally { rmSync(root, { recursive: true, force: true }) }
})

test('an active staged-file preview survives cancellation until its read stream closes', async () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'la-upload-reading-')))
  try {
    const files = new ManagedFiles(root)
    const [token] = await files.stage(upload(12))
    const path = files.takeUpload(token!).path
    const preview = await files.open(files.issuePreview(path, 'synthetic.txt'))
    const closed = once(preview.stream, 'close')
    files.discardUpload(token!)
    assert.equal(existsSync(path), true)
    let bytes = 0
    for await (const chunk of preview.stream) bytes += chunk.length
    await closed
    assert.equal(bytes, 12)
    assert.equal(existsSync(path), false)
  } finally { rmSync(root, { recursive: true, force: true }) }
})
