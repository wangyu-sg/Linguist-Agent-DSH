import { open as openFile } from 'node:fs/promises'
import { basename } from 'node:path'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { realpath } from 'node:fs/promises'
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-host-webserver'
import type {} from '@deepseek-ai/dsh-session-persistence'
import type { SessionId } from '@deepseek-ai/dsh-session'
import { WorkspaceId } from '@deepseek-ai/dsh-workspace'
import { discoverBaselineInstructionFiles } from '@deepseek-ai/dsh-agent-instructions'
import fileType from 'file-type'
import { FormatAmbiguousError, FormatExportError, FormatParseError, FormatSegmentLostError, FormatUnsupportedError,
  MQXLIFF_ADAPTER_ID, PHRASE_DOCX_ADAPTER_ID, PHRASE_MXLIFF_ADAPTER_ID, SDLXLIFF_ADAPTER_ID } from '@linguist/cat-formats'
import type { LinguistProjectService } from '@linguist/domain-service'
import { LINGUIST_IPC_ERROR_CODES, type LinguistIpcError } from '@linguist/domain-service/contracts'
import { BindingStore, type LinguistRole, type LinguistWorkMode, type SessionBinding } from './bindings'
import { ManagedFiles } from './files'
import { MutationBus } from './mutations'
import { LinguistSessionCopyError } from './session-copy'

interface HttpDeps {
  ctx: Context
  service: LinguistProjectService
  bindings: BindingStore
  files: ManagedFiles
  mutations: MutationBus
  installationId: string
  rebindAgent: (sessionId: string) => void
  dispatch: (operation: string, payload: Record<string, unknown>) => Promise<unknown>
}

export function registerHttpRoutes(deps: HttpDeps): () => void {
  return deps.ctx.webServer.register({ kind: 'prefix', path: '/la/v1', handler: (request, response) => handle(request, response, deps) })
}

async function handle(request: IncomingMessage, response: ServerResponse, deps: HttpDeps): Promise<void> {
  const url = new URL(request.url ?? '/', `http://${request.headers.host ?? 'localhost'}`)
  const route = url.pathname
  const violation = fenceViolation(request, route)
  if (violation) { sendJson(response, 403, { error: `forbidden: ${violation}` }); return }
  try {
    if (route === '/la/v1/status' && request.method === 'GET') {
      sendJson(response, 200, { appId: 'linguist-agent-dsh', installationId: deps.installationId, service: deps.service.getStatus(), mutationDeliveryError: deps.mutations.lastError ?? null })
    } else if (route === '/la/v1/session-instructions' && request.method === 'GET') {
      const sessionId = url.searchParams.get('sessionId')
      if (!sessionId) throw new RequestError(400, 'sessionId is required')
      const binding = deps.bindings.session(sessionId)
      if (!binding) throw new RequestError(404, 'Linguist binding not found')
      const workspace = deps.ctx.workspaceRegistry.get(WorkspaceId(binding.workspaceId))
      const stored = await deps.ctx.sessionPersistence.stat(sessionId as SessionId)
      if (!workspace || !stored?.header.cwd || await realpath(stored.header.cwd) !== workspace.path) throw new RequestError(409, 'DSH Session Workspace membership changed')
      const files = await discoverBaselineInstructionFiles({ cwd: workspace.path })
      sendJson(response, 200, { sessionId, files: files.map(file => ({ path: file.absolutePath, label: file.displayPath })) })
    } else if (route === '/la/v1/session-bind' && request.method === 'GET') {
      const sessionId = url.searchParams.get('sessionId')
      if (!sessionId) throw new RequestError(400, 'sessionId is required')
      const binding = deps.bindings.session(sessionId)
      if (!binding) throw new RequestError(404, 'Linguist binding not found')
      sendJson(response, 200, { sessionId, ...binding })
    } else if (route === '/la/v1/session-bind' && request.method === 'POST') {
      const input = await readJson(request)
      const sessionId = stringField(input, 'sessionId')
      const role = stringField(input, 'role')
      const workMode = stringField(input, 'workMode')
      if (!isRole(role) || !isWorkMode(workMode)) throw new RequestError(400, 'Invalid Linguist role or work mode')
      const projectId = input.projectId === undefined ? undefined : stringField(input, 'projectId')
      if (workMode === 'cat' && projectId === undefined) throw new RequestError(400, 'CAT mode requires a project')
      const stored = await deps.ctx.sessionPersistence.stat(sessionId as SessionId)
      if (!stored?.header.cwd) throw new RequestError(404, 'DSH Session has no Workspace directory')
      const cwd = await realpath(stored.header.cwd)
      const workspace = deps.ctx.workspaceRegistry.list().find(item => item.path === cwd)
      if (!workspace) throw new RequestError(409, 'DSH Session Workspace is not registered')
      if (projectId !== undefined) {
        deps.service.getProject(projectId)
        if (deps.bindings.projectWorkspace(projectId) !== workspace.id) throw new RequestError(409, 'Project is not associated with this DSH Workspace')
      }
      const binding: SessionBinding = { workspaceId: workspace.id, ...(projectId === undefined ? {} : { projectId }), role, workMode }
      const previous = deps.bindings.session(sessionId)
      if (previous?.workspaceId === binding.workspaceId && previous.projectId === binding.projectId && previous.role === binding.role && previous.workMode === binding.workMode) {
        sendJson(response, 200, { sessionId, ...binding }); return
      }
      if (await hasUserRequest(deps.ctx, sessionId)) throw new RequestError(409, 'Linguist binding is fixed after the first user request; create a new DSH Session')
      deps.bindings.bindSession(sessionId, binding)
      try { deps.rebindAgent(sessionId) }
      catch (error) { deps.bindings.restoreSession(sessionId, previous); deps.rebindAgent(sessionId); throw error }
      sendJson(response, 200, { sessionId, ...binding })
    } else if (route === '/la/v1/invoke' && request.method === 'POST') {
      const body = await readJson(request)
      const operation = stringField(body, 'operation')
      const payload = objectField(body, 'input')
      try { sendJson(response, 200, { ok: true, data: await deps.dispatch(operation, payload) }) }
      catch (error) { sendJson(response, 200, { ok: false, error: invokeError(error) }) }
    } else if (route === '/la/v1/files/stage' && request.method === 'POST') {
      sendJson(response, 200, { tokens: await deps.files.stage(request) })
    } else if (route === '/la/v1/files/export' && request.method === 'POST') {
      const body = await readJson(request)
      const projectId = stringField(body, 'projectId')
      const assetId = stringField(body, 'assetId')
      const validation = stringField(body, 'validation')
      if (validation !== 'verified' && validation !== 'as-is') throw new RequestError(400, 'Invalid export validation')
      const result = await deps.dispatch('linguistExportsSaveAsset', { projectId, assetId, validation })
      sendJson(response, 200, result)
    } else if (route.startsWith('/la/v1/files/') && request.method === 'GET') {
      await sendManagedFile(response, deps.files, route.slice('/la/v1/files/'.length))
    } else if (route === '/la/v1/events' && request.method === 'GET') {
      const projectId = url.searchParams.get('projectId')
      const workspaceId = url.searchParams.get('workspaceId')
      const scanId = url.searchParams.get('scanId')
      if (projectId && (workspaceId || scanId)) throw new RequestError(400, 'Choose one event scope')
      let subscribe: () => () => void
      if (projectId) {
        deps.service.getProject(projectId)
        const after = Number(url.searchParams.get('afterSequence') ?? 0)
        if (!Number.isSafeInteger(after) || after < 0) throw new RequestError(400, 'Invalid afterSequence')
        subscribe = () => deps.mutations.subscribe(projectId, after, response)
      } else {
        if (!workspaceId || !scanId) throw new RequestError(400, 'workspaceId and scanId are required')
        deps.service.legacyMigration.scannedRoot(scanId, workspaceId)
        subscribe = () => deps.mutations.subscribeMigration(workspaceId, scanId, response)
      }
      response.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-store', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' })
      const unsubscribe = subscribe()
      const heartbeat = setInterval(() => response.write(': heartbeat\n\n'), 15000)
      request.once('close', () => { clearInterval(heartbeat); unsubscribe() })
    } else {
      sendJson(response, 404, { error: 'Unknown Linguist route' })
    }
  } catch (error) {
    if (response.headersSent) { response.destroy(error instanceof Error ? error : undefined); return }
    if (error instanceof RequestError) sendJson(response, error.status, { error: error.message })
    else {
      console.error('[Linguist HTTP] unexpected request error')
      sendJson(response, 500, { error: 'Unexpected internal error.' })
    }
  }
}

async function hasUserRequest(ctx: Context, sessionId: string): Promise<boolean> {
  const handle = await ctx.sessionPersistence.open(sessionId as SessionId, 'read')
  try {
    let offset = 0
    while (true) {
      const { events } = await handle.read(offset, 256)
      if (events.some(event => event.type === 'user/message' && event.data.source.kind === 'user')) return true
      if (events.length < 256) return false
      offset += events.length
    }
  } finally { await handle.close() }
}

class RequestError extends Error { constructor(readonly status: number, message: string) { super(message) } }

function sendJson(response: ServerResponse, status: number, value: unknown): void {
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' })
  response.end(JSON.stringify(value))
}

async function readJson(request: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = []
  let bytes = 0
  for await (const chunk of request) {
    bytes += chunk.length
    if (bytes > 1024 * 1024) throw new RequestError(413, 'JSON request exceeds 1 MiB')
    chunks.push(chunk)
  }
  let parsed: unknown
  try { parsed = JSON.parse(Buffer.concat(chunks).toString('utf8')) }
  catch { throw new RequestError(400, 'Invalid JSON request') }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new RequestError(400, 'Expected JSON object')
  return parsed as Record<string, unknown>
}

function objectField(value: Record<string, unknown>, key: string): Record<string, unknown> {
  const item = value[key]
  if (!item || typeof item !== 'object' || Array.isArray(item)) throw new RequestError(400, `${key} must be an object`)
  return item as Record<string, unknown>
}
function stringField(value: Record<string, unknown>, key: string): string {
  const item = value[key]
  if (typeof item !== 'string' || !item) throw new RequestError(400, `${key} must be a nonempty string`)
  return item
}
function isRole(value: string): value is LinguistRole { return ['general', 'translator', 'reviewer', 'proofreader'].includes(value) }
function isWorkMode(value: string): value is LinguistWorkMode { return ['cat', 'working-copy', 'browser'].includes(value) }
/** Preserve only machine counts and format classification from typed domain errors. */
export function invokeError(error: unknown): LinguistIpcError {
  if (error instanceof LinguistSessionCopyError) {
    return { code: LINGUIST_IPC_ERROR_CODES.SESSION_COPY_FAILED, message: error.message,
      sessionCopyDetails: { sessionId: error.sessionId, cleanup: error.cleanup } }
  }
  const candidate = error instanceof Error && 'code' in error ? error.code : undefined
  const code = error instanceof TypeError ? LINGUIST_IPC_ERROR_CODES.INVALID_INPUT
    : Object.values(LINGUIST_IPC_ERROR_CODES).find(value => value === candidate) ?? LINGUIST_IPC_ERROR_CODES.INTERNAL
  if (code === LINGUIST_IPC_ERROR_CODES.INTERNAL) {
    console.error('[Linguist HTTP] untyped invoke error')
    return { code, message: 'Unexpected internal error.' }
  }
  const source = error && typeof error === 'object' && 'details' in error ? error.details : undefined
  const allowed = code === 'IMPORT_UNDO_BLOCKED'
    ? ['proposals', 'qaFindings', 'legacyCriticArtifacts', 'exports', 'editedSegments', 'jobs']
    : code === 'PROJECT_LOCALE_CHANGE_BLOCKED' ? ['batches', 'tmUnits', 'termEntries'] : []
  let details: Record<string, number> | undefined
  if (allowed.length && source && typeof source === 'object' && !Array.isArray(source)) {
    const entries = Object.entries(source)
    if (entries.length > 0 && entries.every(([key, value]) => allowed.includes(key) && Number.isSafeInteger(value) && (value as number) >= 0)) details = Object.fromEntries(entries) as Record<string, number>
  }
  let formatDetails: LinguistIpcError['formatDetails']
  if (error instanceof FormatParseError) {
    const vendor = [MQXLIFF_ADAPTER_ID, SDLXLIFF_ADAPTER_ID, PHRASE_MXLIFF_ADAPTER_ID, PHRASE_DOCX_ADAPTER_ID].includes(error.adapterId)
    const category = /\b(?:XLIFF|TBX)\b.*\bnot supported\b/i.test(error.detail) ? 'unsupported_version'
      : /(?:not valid UTF-8|ZIP container could not be read|文件不是有效的 UTF-8|XML 格式错误)/i.test(error.detail) ? 'file_corrupt'
        : vendor ? 'vendor_structure_incomplete' : 'file_corrupt'
    formatDetails = { code: 'FORMAT_PARSE_ERROR', category, adapterId: error.adapterId,
      filename: basename(error.filename.replaceAll('\\', '/')), detail: 'The source file could not be parsed.' }
  } else if (error instanceof FormatExportError) {
    formatDetails = { code: 'FORMAT_EXPORT_ERROR', adapterId: error.adapterId, detail: 'The source format could not be exported safely.' }
  } else if (error instanceof FormatSegmentLostError) {
    formatDetails = { code: 'FORMAT_SEGMENT_LOST', adapterId: error.adapterId, missingSegmentIds: [...error.missingSegmentIds] }
  } else if (error instanceof FormatUnsupportedError) {
    formatDetails = { code: 'FORMAT_UNSUPPORTED', category: 'format_mismatch', filename: basename(error.filename.replaceAll('\\', '/')), triedAdapterIds: [...error.triedAdapterIds] }
  } else if (error instanceof FormatAmbiguousError) {
    formatDetails = { code: 'FORMAT_AMBIGUOUS', category: 'format_ambiguous', filename: basename(error.filename.replaceAll('\\', '/')), score: error.score, adapterIds: [...error.adapterIds] }
  }
  let message = code === LINGUIST_IPC_ERROR_CODES.INVALID_INPUT ? 'Invalid Linguist input.' : 'Linguist request failed.'
  if (formatDetails) {
    switch (formatDetails.code) {
      case 'FORMAT_PARSE_ERROR': message = `Could not parse ${formatDetails.filename} with ${formatDetails.adapterId}.`; break
      case 'FORMAT_EXPORT_ERROR': message = `Could not export with ${formatDetails.adapterId}.`; break
      case 'FORMAT_SEGMENT_LOST': message = `${formatDetails.missingSegmentIds.length} segment(s) lost during format round-trip.`; break
      case 'FORMAT_UNSUPPORTED': message = `No format adapter accepts ${formatDetails.filename}.`; break
      case 'FORMAT_AMBIGUOUS': message = `Multiple format adapters accept ${formatDetails.filename}.`; break
    }
  }
  return { code, message, ...(details ? { details } : {}), ...(formatDetails ? { formatDetails } : {}) }
}

function fenceViolation(request: IncomingMessage, route: string): string | undefined {
  const host = request.headers.host ?? ''
  const hostname = host.startsWith('[') ? host.slice(1, host.indexOf(']')) : host.split(':')[0]
  if (!(hostname === 'localhost' || hostname.endsWith('.localhost') || hostname === '::1' || /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(hostname))) return 'Host is not loopback'
  const origin = request.headers.origin
  if (origin !== undefined) {
    try { if (new URL(origin).host !== host) return 'Origin differs from Host' }
    catch { return 'Invalid Origin' }
  }
  if (request.headers['sec-fetch-site'] === 'cross-site') return 'Cross-site request'
  if (request.method === 'POST') {
    const type = request.headers['content-type'] ?? ''
    const expected = route === '/la/v1/files/stage' ? 'multipart/form-data' : 'application/json'
    if (!type.toLowerCase().startsWith(expected)) return `POST requires ${expected}`
  }
  return undefined
}

async function sendManagedFile(response: ServerResponse, files: ManagedFiles, token: string): Promise<void> {
  if (!/^[A-Za-z0-9_-]{32}$/.test(token)) throw new RequestError(404, 'Unknown file token')
  const file = await files.open(token)
  if (file.kind === 'upload') throw new RequestError(403, 'Upload token is not downloadable')
  let mime = 'application/octet-stream'
  if (file.kind === 'preview') {
    const handle = await openFile(file.path, 'r')
    try {
      const header = Buffer.alloc(4100)
      const { bytesRead } = await handle.read(header, 0, header.length, 0)
      const detected = await fileType.fromBuffer(header.subarray(0, bytesRead))
      if (detected?.mime.startsWith('image/') || detected?.mime === 'application/pdf') mime = detected.mime
      else if (/\.(txt|csv|json|xml|xlf|xliff|mxliff|md)$/i.test(file.filename)) mime = 'text/plain; charset=utf-8'
    } finally { await handle.close() }
  }
  response.writeHead(200, {
    'Content-Type': mime,
    'Content-Length': file.bytes,
    'Content-Disposition': `${file.kind === 'preview' && mime !== 'application/octet-stream' ? 'inline' : 'attachment'}; filename*=UTF-8''${encodeURIComponent(file.filename)}`,
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    'Content-Security-Policy': 'sandbox',
  })
  file.stream.pipe(response)
  response.once('finish', file.consume)
}
