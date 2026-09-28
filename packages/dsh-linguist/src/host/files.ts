import { randomBytes } from 'node:crypto'
import { createReadStream, createWriteStream, mkdirSync, realpathSync, rmSync } from 'node:fs'
import { lstat, realpath, rm } from 'node:fs/promises'
import type { IncomingMessage } from 'node:http'
import { basename, dirname, isAbsolute, join, relative } from 'node:path'
import { pipeline } from 'node:stream/promises'
import Busboy from 'busboy'

const MAX_FILE_BYTES = 50 * 1024 * 1024
const MAX_REQUEST_BYTES = 512 * 1024 * 1024
const TOKEN_LIFETIME_MS = 60 * 60 * 1000

type FileKind = 'upload' | 'download' | 'preview'
interface ManagedFile { kind: FileKind; path: string; filename: string; expiresAt: number }

export class ManagedFiles {
  private readonly root: string
  private readonly staging: string
  private readonly tokens = new Map<string, ManagedFile>()

  constructor(dataRoot: string) {
    this.root = realpathSync(dataRoot)
    this.staging = join(this.root, 'staging')
    mkdirSync(this.staging, { recursive: true, mode: 0o700 })
  }

  async stage(request: IncomingMessage): Promise<string[]> {
    const parser = Busboy({ headers: request.headers, limits: { fileSize: MAX_FILE_BYTES, files: 500, fields: 0, parts: 500 } })
    const staged: Array<{ token: string; path: string; filename: string }> = []
    const writes: Promise<void>[] = []
    let total = 0
    const parsed = new Promise<void>((resolve, reject) => {
      parser.on('file', (_field, stream, info) => {
        if (_field !== 'files') { stream.resume(); reject(new Error('Unexpected upload field')); return }
        const filename = basename(info.filename.replaceAll('\\', '/'))
        if (filename === '.' || filename === '..' || filename.length === 0) { stream.resume(); reject(new Error('Invalid upload filename')); return }
        const token = newToken()
        const directory = join(this.staging, token)
        mkdirSync(directory, { mode: 0o700 })
        const path = join(directory, filename)
        staged.push({ token, path, filename })
        stream.on('data', (chunk: Buffer) => { total += chunk.length; if (total > MAX_REQUEST_BYTES) stream.destroy(new Error('Upload exceeds request limit')) })
        writes.push(pipeline(stream, createWriteStream(path, { flags: 'wx', mode: 0o600 })).then(() => {
          if (stream.truncated) throw new Error('Upload exceeds file limit')
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
      await Promise.all(writes)
      if (staged.length === 0) throw new Error('No files uploaded')
      for (const item of staged) this.tokens.set(item.token, { kind: 'upload', path: item.path, filename: item.filename, expiresAt: Date.now() + TOKEN_LIFETIME_MS })
      return staged.map(item => item.token)
    } catch (error) {
      request.unpipe(parser)
      parser.destroy()
      await Promise.allSettled(writes)
      await Promise.all(staged.map(item => rm(dirname(item.path), { recursive: true, force: true })))
      throw error
    }
  }

  takeUpload(token: string): { path: string; filename: string } {
    const item = this.lookup(token, 'upload')
    return { path: item.path, filename: item.filename }
  }

  discardUpload(token: string): void {
    const item = this.lookup(token, 'upload')
    rmSync(dirname(item.path), { recursive: true, force: true })
    this.tokens.delete(token)
  }

  issueDownload(path: string, filename: string): string { return this.issue(path, filename, 'download') }
  issuePreview(path: string, filename: string): string { return this.issue(path, filename, 'preview') }

  async open(token: string): Promise<{ path: string; stream: ReturnType<typeof createReadStream>; filename: string; kind: FileKind; bytes: number; consume: () => void }> {
    const item = this.lookup(token)
    const canonical = await realpath(item.path)
    if (!within(canonical, this.root)) throw new Error('Managed file escaped the product root')
    const info = await lstat(canonical)
    if (!info.isFile()) throw new Error('Managed file is not a regular file')
    return {
      path: canonical, stream: createReadStream(canonical), filename: item.filename, kind: item.kind, bytes: info.size,
      consume: () => { if (item.kind === 'download') this.tokens.delete(token) },
    }
  }

  private issue(path: string, filename: string, kind: 'download' | 'preview'): string {
    if (!isAbsolute(path)) throw new Error('Managed file path must be absolute')
    const canonical = realpathSync(path)
    if (!within(canonical, this.root)) throw new Error('File is outside the new product data root')
    const token = newToken()
    this.tokens.set(token, { kind, path: canonical, filename: basename(filename), expiresAt: Date.now() + TOKEN_LIFETIME_MS })
    return token
  }

  private lookup(token: string, expected?: FileKind): ManagedFile {
    const item = this.tokens.get(token)
    if (item === undefined || item.expiresAt < Date.now() || (expected !== undefined && item.kind !== expected)) {
      throw new Error('Unknown or expired managed file token')
    }
    return item
  }
}

function newToken(): string { return randomBytes(24).toString('base64url') }
function within(path: string, root: string): boolean {
  const rel = relative(root, path)
  return rel === '' || (rel !== '..' && !rel.startsWith('../') && !isAbsolute(rel))
}
