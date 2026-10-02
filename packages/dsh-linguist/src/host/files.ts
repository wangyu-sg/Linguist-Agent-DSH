import { randomBytes } from 'node:crypto'
import { constants, createReadStream, createWriteStream, mkdirSync, readdirSync, realpathSync, rmSync, statSync, utimesSync } from 'node:fs'
import { chmod, copyFile, lstat, realpath, rm } from 'node:fs/promises'
import type { IncomingMessage } from 'node:http'
import { basename, dirname, isAbsolute, join, relative } from 'node:path'
import { pipeline } from 'node:stream/promises'
import Busboy from 'busboy'
import { LinguistImportTooLargeError, type XlsxImportMapping } from '@linguist/domain-service'
import { LINGUIST_FILE_MAX_BYTES } from '@linguist/domain-service/contracts'

const MAX_REQUEST_BYTES = LINGUIST_FILE_MAX_BYTES
const TOKEN_LIFETIME_MS = 60 * 60 * 1000

type FileKind = 'upload' | 'download' | 'preview' | 'native-preview'
interface ManagedFile { kind: FileKind; path: string; filename: string; expiresAt: number; users: number; discarded: boolean }

export class ManagedFiles {
  private readonly root: string
  private readonly staging: string
  private readonly tokens = new Map<string, ManagedFile>()
  private readonly receiving = new Set<string>()
  readonly pendingImports = new Map<string, { projectId: string; kind: 'xlsx' | 'tm' | 'terms'; sha256: string; xlsxMapping?: XlsxImportMapping }>()
  lastCleanupError?: string

  constructor(dataRoot: string, private readonly maxFileBytes = LINGUIST_FILE_MAX_BYTES) {
    this.root = realpathSync(dataRoot)
    this.staging = join(this.root, 'staging')
    mkdirSync(this.staging, { recursive: true, mode: 0o700 })
    this.collectExpired()
  }

  async stage(request: IncomingMessage): Promise<string[]> {
    this.collectExpired()
    // Busboy marks a stream truncated at equality; reserve one byte for our inclusive limit.
    const parser = Busboy({ headers: request.headers, defParamCharset: 'utf8', limits: { fileSize: this.maxFileBytes + 1, files: 500, fields: 0, parts: 500 } })
    const staged: Array<{ token: string; path: string; filename: string }> = []
    const writes: Promise<PromiseSettledResult<void>>[] = []
    let total = 0
    const parsed = new Promise<void>((resolve, reject) => {
      parser.on('file', (_field, stream, info) => {
        if (_field !== 'files') { stream.resume(); reject(new Error('Unexpected upload field')); return }
        const filename = basename(info.filename.replaceAll('\\', '/'))
        if (filename === '.' || filename === '..' || filename.length === 0) { stream.resume(); reject(new Error('Invalid upload filename')); return }
        const token = newToken()
        this.receiving.add(token)
        const directory = join(this.staging, token)
        const path = join(directory, filename)
        staged.push({ token, path, filename })
        try { mkdirSync(directory, { mode: 0o700 }) }
        catch (error) { stream.resume(); parser.destroy(error as Error); return }
        let bytes = 0
        stream.on('data', (chunk: Buffer) => {
          total += chunk.length
          bytes += chunk.length
          if (bytes > this.maxFileBytes) parser.destroy(new LinguistImportTooLargeError(bytes, this.maxFileBytes, filename))
          else if (total > MAX_REQUEST_BYTES) {
            const error = new LinguistImportTooLargeError(total, MAX_REQUEST_BYTES)
            error.message = '单次请求的文件内容总量超过 512 MiB；请分请求上传，收齐文件后再一起导入。'
            parser.destroy(error)
          }
        })
        const write = pipeline(stream, createWriteStream(path, { flags: 'wx', mode: 0o600 })).then(() => {
          if (stream.truncated) throw new LinguistImportTooLargeError(bytes, this.maxFileBytes, filename)
        })
        writes.push(write.then(() => ({ status: 'fulfilled', value: undefined }), error => {
          parser.destroy(error)
          return { status: 'rejected', reason: error }
        }))
      })
      parser.once('error', reject)
      parser.once('filesLimit', () => reject(new Error('Too many upload files')))
      parser.once('partsLimit', () => reject(new Error('Too many multipart parts')))
      parser.once('close', resolve)
      request.once('error', reject)
    })
    request.pipe(parser)
    try {
      await parsed
      const results = await Promise.all(writes)
      const failed = results.find(result => result.status === 'rejected')
      if (failed?.status === 'rejected') throw failed.reason
      if (staged.length === 0) throw new Error('No files uploaded')
      for (const item of staged) {
        const now = Date.now()
        utimesSync(dirname(item.path), now / 1000, now / 1000)
        this.tokens.set(item.token, { kind: 'upload', path: item.path, filename: item.filename, expiresAt: now + TOKEN_LIFETIME_MS, users: 0, discarded: false })
      }
      return staged.map(item => item.token)
    } catch (error) {
      request.unpipe(parser)
      parser.destroy()
      await Promise.allSettled(writes)
      await Promise.all(staged.map(item => rm(dirname(item.path), { recursive: true, force: true })))
      throw error
    } finally {
      for (const item of staged) this.receiving.delete(item.token)
    }
  }

  takeUpload(token: string): { path: string; filename: string } {
    const item = this.lookup(token, 'upload')
    return { path: item.path, filename: item.filename }
  }

  discardUpload(token: string): void {
    const item = this.tokens.get(token)
    if (item === undefined) return
    if (item.kind !== 'upload') throw new TypeError('Only upload tokens can be discarded')
    item.discarded = true
    this.pendingImports.delete(token)
    if (item.users === 0) this.removeStaging(token)
  }

  async useUploads<T>(tokens: readonly string[], action: () => Promise<T>): Promise<T> {
    this.collectExpired()
    const items = tokens.map(token => this.lookup(token, 'upload'))
    for (const item of items) item.users++
    try { return await action() }
    finally {
      for (const item of items) item.users--
      this.collectExpired()
    }
  }

  collectExpired(): void {
    const now = Date.now()
    for (const [token, item] of this.tokens) {
      if (item.users > 0 || (!item.discarded && item.expiresAt > now)) continue
      if (item.kind === 'upload') this.discardUpload(token)
      else if (item.kind === 'native-preview') this.removeStaging(token)
      else this.tokens.delete(token)
    }
    try {
      for (const entry of readdirSync(this.staging, { withFileTypes: true })) {
        if (!entry.isDirectory() || !/^[A-Za-z0-9_-]{32}$/.test(entry.name) || this.tokens.has(entry.name) || this.receiving.has(entry.name)) continue
        if (statSync(join(this.staging, entry.name)).mtimeMs + TOKEN_LIFETIME_MS <= now) this.removeStaging(entry.name)
      }
    } catch (error) {
      this.lastCleanupError = `暂存过期扫描失败：${String(error)}`
      console.error('[Linguist staging]', this.lastCleanupError)
    }
  }

  private removeStaging(token: string): void {
    try {
      rmSync(join(this.staging, token), { recursive: true, force: true })
      this.tokens.delete(token)
    } catch (error) {
      this.lastCleanupError = `暂存清理失败（${token}）：${String(error)}`
      console.error('[Linguist staging]', this.lastCleanupError)
    }
  }

  issueDownload(path: string, filename: string): string { return this.issue(path, filename, 'download') }
  issuePreview(path: string, filename: string): string { return this.issue(path, filename, 'preview') }

  /** Named, read-only copy for DSH's extension-based viewers. Reuses the staging TTL. */
  async nativePreview(sourcePath: string, filename: string): Promise<string> {
    const source = await realpath(sourcePath)
    if (!within(source, this.root)) throw new Error('File is outside the product data root')
    const info = await lstat(source)
    if (!info.isFile()) throw new Error('Preview source is not a regular file')
    if (info.size > this.maxFileBytes) throw new LinguistImportTooLargeError(info.size, this.maxFileBytes, filename)
    const name = basename(filename.replaceAll('\\', '/'))
    if (!name || name === '.' || name === '..') throw new TypeError('Invalid preview filename')
    const token = newToken()
    const directory = join(this.staging, token)
    const path = join(directory, name)
    this.receiving.add(token)
    try {
      mkdirSync(directory, { mode: 0o700 })
      await copyFile(source, path, constants.COPYFILE_FICLONE)
      await chmod(path, 0o400)
    } catch (error) {
      await rm(directory, { recursive: true, force: true })
      throw error
    } finally { this.receiving.delete(token) }
    const now = Date.now()
    utimesSync(directory, now / 1000, now / 1000)
    this.tokens.set(token, { kind: 'native-preview', path, filename: name, expiresAt: now + TOKEN_LIFETIME_MS, users: 0, discarded: false })
    return path
  }

  async open(token: string): Promise<{ path: string; stream: ReturnType<typeof createReadStream>; filename: string; kind: FileKind; bytes: number; consume: () => void }> {
    const item = this.lookup(token)
    const owner = this.tokens.get(basename(dirname(item.path)))
    const reading = owner?.kind === 'upload' && owner !== item ? [item, owner] : [item]
    for (const file of reading) file.users++
    const release = () => {
      for (const file of reading) file.users--
      this.collectExpired()
    }
    try {
      const canonical = await realpath(item.path)
      if (!within(canonical, this.root)) throw new Error('Managed file escaped the product root')
      const info = await lstat(canonical)
      if (!info.isFile()) throw new Error('Managed file is not a regular file')
      const stream = createReadStream(canonical)
      stream.once('close', release)
      return {
        path: canonical, stream, filename: item.filename, kind: item.kind, bytes: info.size,
        consume: () => { if (item.kind === 'download') this.tokens.delete(token) },
      }
    } catch (error) {
      release()
      throw error
    }
  }

  private issue(path: string, filename: string, kind: 'download' | 'preview'): string {
    if (!isAbsolute(path)) throw new Error('Managed file path must be absolute')
    const canonical = realpathSync(path)
    if (!within(canonical, this.root)) throw new Error('File is outside the new product data root')
    const token = newToken()
    this.tokens.set(token, { kind, path: canonical, filename: basename(filename), expiresAt: Date.now() + TOKEN_LIFETIME_MS, users: 0, discarded: false })
    return token
  }

  private lookup(token: string, expected?: FileKind): ManagedFile {
    const item = this.tokens.get(token)
    if (item === undefined || item.discarded || (item.users === 0 && item.expiresAt <= Date.now()) || (expected !== undefined && item.kind !== expected)) {
      this.collectExpired()
      throw new TypeError('Unknown or expired managed file token; select the file again')
    }
    return item
  }
}

function newToken(): string { return randomBytes(24).toString('base64url') }
function within(path: string, root: string): boolean {
  const rel = relative(root, path)
  return rel === '' || (rel !== '..' && !rel.startsWith('../') && !isAbsolute(rel))
}
