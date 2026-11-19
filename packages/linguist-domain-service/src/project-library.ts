import { createHash } from 'node:crypto'
import { constants, copyFileSync, lstatSync, mkdirSync, readFileSync, realpathSync, statSync } from 'node:fs'
import { basename, dirname, extname, isAbsolute, join, relative } from 'node:path'
import { z } from 'zod'
import { deriveStableIdV2, matchTmCandidates, selectTmAgentEvidence, type ContextAnchorLocator, type Segment } from '@linguist/cat-core'
import { parseXlsxWorkbook } from '@linguist/cat-formats'
import type { LinguistProjectService } from './project-service'
import type { XlsxImportMapping } from './project-service-types'
import { contextImageFormat, extractContext } from './context-extractor'
import { readPickedFileWithinLimit } from './project-file-intake'
import { LINGUIST_FILE_MAX_BYTES } from './contracts'
import { suggestProjectWorkbookMapping } from './project-workbook-mapping'
import { workingCopyPath } from './working-copy'
import { writeJsonFileAtomic } from './safe-file'

export const ProjectResourceSchema = z.object({
  path: z.string().min(1), kind: z.enum(['tm', 'terms', 'rules', 'context']),
  taskGroupId: z.string().optional(),
  replacesInherited: z.string().min(1).optional(),
  appliesTo: z.array(z.string().min(1)).optional(),
  xlsxMapping: z.object({ sheetName: z.string(), columns: z.object({ source: z.string(), target: z.string() }) }).optional(),
}).strict()
export type ProjectResource = z.infer<typeof ProjectResourceSchema>
export interface LibraryEntry { id: string; source: string; locator: string; text: string; appliesTo?: string[] }
interface RegisteredResource extends ProjectResource {
  stamp?: string; configuration?: string; hash?: string; importedId?: string; entries?: LibraryEntry[]; warnings?: string[]
  error?: string; readAt?: string; replaces?: string; replaceScope?: string
}
interface LibraryState { resources: RegisteredResource[] }
export interface ProjectLibraryItem extends ProjectResource {
  key: string
  filename: string
  origin: 'workspace' | 'cat' | 'entry'
  text?: string
  status: 'ready' | 'changed' | 'error' | 'manual'
  warnings: string[]
  error?: string
  readAt?: string
}
export interface ProjectLibraryChange { taskGroupId?: string; move?: { keys: string[]; to: string }; remove?: string; replace?: string; retry?: boolean }
export interface ProjectLibraryMaterials {
  rules: LibraryEntry[]
  matches: Record<string, LibraryEntry[]>
  warnings: string[]
  contextFiles: string[]
}

const hash = (value: string | Uint8Array) => createHash('sha256').update(value).digest('hex')
const hasVisualContent = (path: string) => !!contextImageFormat(path) || /\.(?:xlsx|pptx)$/iu.test(path)
const active = new Map<string, Promise<LibraryState>>()
const states = new Map<string, { stamp: number; value: LibraryState }>()
const statePath = (service: LinguistProjectService, projectId: string) => join(service.getProjectPaths(projectId).projectDir, 'project-library.json')
function readState(service: LinguistProjectService, projectId: string): LibraryState {
  const path = statePath(service, projectId)
  const stamp = statSync(path, { throwIfNoEntry: false })?.mtimeMs ?? 0
  const cached = states.get(path)
  if (cached?.stamp === stamp) return cached.value
  const value: LibraryState = stamp ? JSON.parse(readFileSync(path, 'utf8')) : { resources: [] }
  states.set(path, { stamp, value })
  return value
}

/** Keep current cell citations separate from the content used for matching. */
function libraryRows(sections: { location: ContextAnchorLocator; label: string; text: string }[]) {
  const rows = new Map<string, string[]>()
  const cells = sections.flatMap(({ location, label, text }) => {
    if (location.kind === 'sheet' && location.cell && location.row !== undefined) {
      return [{ sheet: location.sheet, row: location.row, header: location.rowKind === 'header',
        column: location.cell.replace(/\d+$/u, ''), address: location.cell, value: text }]
    }
    rows.set(label, [...(rows.get(label) ?? []), text])
    return []
  })
  for (const [sheet, sheetCells] of Map.groupBy(cells, cell => cell.sheet)) {
    const headings = new Map(sheetCells.filter(cell => cell.header).map(cell => [cell.column, cell.value]))
    const byHeading = Map.groupBy([...headings.values()], heading => heading)
    for (const [row, cells] of Map.groupBy(sheetCells, cell => cell.row)) {
      const addresses: string[] = []
      const fields = cells.map(({ column, address, value }) => {
        const heading = headings.get(column)
        addresses.push(heading ? `${heading} ${address}` : address)
        // Column letters distinguish unnamed or identically named fields.
        const field = heading && byHeading.get(heading)!.length === 1 ? heading : [heading ?? '', column]
        return JSON.stringify([field, value])
      })
      rows.set(`${sheet}!row ${row} · ${addresses.join(' · ')}`, fields.sort())
    }
  }
  return rows
}

// Uploaded files have a unique LA-owned path; originals registered by the user stay external.
function managedUpload(projectId: string, path: string): boolean {
  const parts = path.split('/')
  return parts.length === 5 && parts[0] === '.linguist' && parts[1] === 'project-resources' && parts[2] === projectId
    && /^[0-9a-f-]{36}$/i.test(parts[3]!) && !!parts[4] && parts[4] !== '.' && parts[4] !== '..'
}

function copyLibraryFile(source: string, root: string, path: string): void {
  let parent = root
  for (const part of dirname(path).split('/')) {
    const directory = join(parent, part)
    if (!lstatSync(directory, { throwIfNoEntry: false })) mkdirSync(directory, { mode: 0o700 })
    parent = workingCopyPath(root, relative(root, directory))
  }
  copyFileSync(source, join(parent, basename(path)), constants.COPYFILE_EXCL)
}

function libraryFile(service: LinguistProjectService, projectId: string, workspaceRoot: string, path: string, copyIntoProject = false): string {
  if (!managedUpload(projectId, path)) return workingCopyPath(workspaceRoot, path)
  const project = service.getProjectPaths(projectId).projectDir
  const owned = join('blobs', 'project-library', ...path.split('/').slice(-2))
  if (!lstatSync(join(project, owned), { throwIfNoEntry: false })) {
    const original = workingCopyPath(workspaceRoot, path)
    if (!copyIntoProject) return original
    copyLibraryFile(original, project, owned)
  }
  return workingCopyPath(project, owned)
}

export function resetLibraryForRestore(service: LinguistProjectService, projectId: string): void {
  const key = statePath(service, projectId)
  if (active.has(key)) throw new Error('项目资料正在更新，请在完成后恢复')
  states.delete(key)
}

function backingKey(resource: RegisteredResource): string {
  if (resource.importedId) return 'reference:' + resource.importedId
  return resource.hash ? 'file-version:' + hash(JSON.stringify([resource.hash, resource.kind, resource.configuration])) : 'file:' + resource.path
}

export function prepareLibraryBackup(service: LinguistProjectService, projectId: string, workspaceRoot?: string, purpose: 'backup' | 'pre-restore' = 'backup'): void {
  if (active.has(statePath(service, projectId))) throw new Error('项目资料正在更新，请在完成后备份')
  for (const item of readState(service, projectId).resources) {
    if (!managedUpload(projectId, item.path)) continue
    try {
      const path = workspaceRoot ? libraryFile(service, projectId, workspaceRoot, item.path, true)
        : workingCopyPath(service.getProjectPaths(projectId).projectDir, join('blobs', 'project-library', ...item.path.split('/').slice(-2)))
      if (!statSync(path).isFile()) throw new Error(`项目上传副本不是普通文件：${item.path}`)
    } catch (error) {
      // A rollback snapshot preserves what still exists; a missing upload can itself be the reason for restoring.
      if (purpose !== 'pre-restore' || (error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    }
  }
}

/** Register supplied originals once. Refresh only changed files; never rewrite originals. */
export async function syncProjectLibrary(service: LinguistProjectService, projectId: string, workspaceRoot: string, resources: ProjectResource[] = [], change: ProjectLibraryChange = {}): Promise<LibraryState> {
  workspaceRoot = realpathSync(workspaceRoot)
  const key = statePath(service, projectId)
  const pending = active.get(key)
  const work = (async () => {
    if (pending) await Promise.allSettled([pending])
    if (service.getProject(projectId).archivedAt && !resources.length && !change.remove && !change.replace && !change.retry && !change.move) return readState(service, projectId)
    service.assertProjectWritable(projectId)
    const state = { resources: readState(service, projectId).resources.map(resource => ({ ...resource })) }
    const requestedFiles = new Set<string>()
    const db = service.openProject(projectId)
    const groups = db.taskGroups
    const scope = change.taskGroupId ?? ''
    if (scope && (resources.length || change.remove || change.replace || change.move || change.retry)) groups.requireActive(scope)
    else if (scope && groups.list().find(group => group.id === scope)?.archived) return state
    const registered = new Set(groups.refs().map(ref => ref.resource_key))
    for (const existing of state.resources) {
      const fileKey = 'file:' + existing.path
      if (!registered.has(fileKey)) groups.ref(fileKey, '', backingKey(existing))
    }
    function owned(key: string, owner: string) {
      const refs = groups.refs().filter(ref => ref.resource_key === key)
      if (refs.length ? !refs.some(ref => ref.scope === owner) : !!owner) throw new Error('继承资料请在项目层修改，或在本组指定替代资料')
      return refs
    }
    function remove(key: string, owner: string, replacementKey?: string) {
      if (key === replacementKey) return
      const refs = owned(key, owner)
      if (!/^(file|reference|document):/.test(key) && refs.length <= 1) throw new Error('请在此原生条目的维护入口编辑或删除它')
      groups.removeRef(key, owner)
      if (refs.length <= 1) {
        const resource = state.resources.find(item => 'file:' + item.path === key)
        if (replacementKey && resource?.replaces) {
          const previous = resource.replaces
          delete resource.replaces
          remove(previous, resource.replaceScope ?? '', replacementKey)
        }
        retireLibraryItem(service, projectId, state, key)
      }
    }
    let changed = false
    db.catDb.transaction('register library references', () => {
      if (change.move) {
        const { keys, to } = change.move
        if (to !== scope) db.catDb.transaction('move resource references', () => {
          const present = new Set(listProjectLibrary(service, projectId, workspaceRoot, scope).map(item => item.key))
          for (const key of keys) {
            if (!present.has(key)) throw new Error('项目资料不存在，请刷新列表')
            const refs = owned(key, scope)
            const entry = state.resources.find(item => 'file:' + item.path === key)
            const backing = refs[0]?.backing_key ?? (entry?.importedId ? 'reference:' + entry.importedId : key)
            groups.ref(key, to, backing)
            groups.removeRef(key, scope)
          }
        })
      }
      if (change.replace && resources.length !== 1) throw new Error('替换资料需要一个新文件')
      if (change.replace) { requireLibraryItem(service, projectId, workspaceRoot, change.replace, scope); owned(change.replace, scope) }
      if (change.remove) {
        requireLibraryItem(service, projectId, workspaceRoot, change.remove, scope)
        remove(change.remove, scope)
        changed = true
      }
      for (const raw of resources) {
        const resource = ProjectResourceSchema.parse(raw)
        const requested = isAbsolute(resource.path) ? relative(workspaceRoot, resource.path) : resource.path
        resource.path = managedUpload(projectId, requested) ? requested : relative(workspaceRoot, workingCopyPath(workspaceRoot, requested))
        const owner = resource.taskGroupId ?? scope
        if (owner) groups.requireActive(owner)
        requestedFiles.add(resource.path)
        const replacing = resource.replacesInherited ?? (change.replace ? groups.refs().find(ref => ref.resource_key === change.replace && ref.scope === scope)?.replaces_key ?? undefined : undefined)
        if (replacing) resource.replacesInherited = replacing
        if (replacing) {
          if (!owner || replacing === 'file:' + resource.path) throw new Error('请选择本组要替代的另一份项目资料')
          requireLibraryItem(service, projectId, workspaceRoot, replacing, '')
        }
        delete resource.taskGroupId
        const prior = state.resources.find(item => item.path === resource.path)
        if (prior && prior.kind !== resource.kind) throw new Error('变更用途时请使用新副本替换原资料')
        const fileKey = 'file:' + resource.path
        const refs = groups.refs().filter(ref => ref.resource_key === fileKey)
        const backing = refs[0]?.backing_key ?? (prior ? backingKey(prior) : fileKey)
        if (prior && refs.some(ref => ref.scope !== owner) && ((resource.appliesTo && JSON.stringify(resource.appliesTo) !== JSON.stringify(prior.appliesTo ?? []))
          || (resource.xlsxMapping && JSON.stringify(resource.xlsxMapping) !== JSON.stringify(prior.xlsxMapping)))) throw new Error('多处引用的原文件请用独立副本替换')
        const target = refs.find(ref => ref.scope === owner)?.replaces_key
        groups.ref(fileKey, owner, backing, target ?? undefined)
        if (replacing) resource.taskGroupId = owner
        if (prior) { Object.assign(prior, resource); if (prior.error) prior.stamp = undefined }
        else state.resources.push(resource)
        if (change.replace && change.replace !== fileKey) Object.assign(state.resources.find(item => item.path === resource.path)!, { replaces: change.replace, replaceScope: scope })
        if (!prior || change.replace || replacing) changed = true
      }
    })
    const hidden = groups.hidden(scope)
    for (const resource of [...state.resources]) {
      if (!requestedFiles.has(resource.path) && hidden.has('file:' + resource.path)) continue
      try {
        const path = libraryFile(service, projectId, workspaceRoot, resource.path, true)
        const stat = statSync(path)
        const stamp = `${stat.size}:${stat.mtimeMs}:${stat.ctimeMs}`
        const spreadsheetRecords = (resource.kind === 'context' || resource.kind === 'rules') && extname(path).toLowerCase() === '.xlsx'
        const configuration = JSON.stringify([resource.xlsxMapping, resource.appliesTo, ...(spreadsheetRecords ? ['worksheet-fields-v2'] : [])])
        if (resource.stamp === stamp && resource.configuration === configuration && !(change.retry && resource.error)) continue
        changed = true
        const sameConfiguration = resource.configuration === configuration
        resource.stamp = stamp
        resource.configuration = configuration
        const { bytes, filename } = await readPickedFileWithinLimit(path, LINGUIST_FILE_MAX_BYTES)
        const digest = hash(bytes)
        if (resource.hash === digest && sameConfiguration && !resource.error) { resource.stamp = stamp; continue }
        const binaryReference = resource.kind === 'tm' || resource.kind === 'terms'
        const reusable = state.resources.find(other => other !== resource && other.kind === resource.kind && other.hash === digest
          && !other.error && other.configuration === configuration && (binaryReference ? basename(other.path) === filename : extname(other.path).toLowerCase() === extname(filename).toLowerCase()))
        if (resource.kind === 'tm' || resource.kind === 'terms') {
          const project = service.getProject(projectId)
          if (project.sourceLocale === 'und' || project.targetLocale === 'und') throw new Error('请先在项目设置中确定语言对，再读取 TM／TB')
          let referenceId = reusable?.importedId
          if (referenceId && reusable) {
            groups.updateBacking('file:' + resource.path, 'reference:' + referenceId)
            resource.warnings = reusable.warnings
          } else {
            let xlsxMapping: XlsxImportMapping | undefined = resource.xlsxMapping
            if (!xlsxMapping && filename.toLowerCase().endsWith('.xlsx')) {
              const workbook = await parseXlsxWorkbook(bytes, { filename, maxRowsPerSheet: 50 })
              const project = service.getProject(projectId)
              const choices = workbook.sheets.map(sheet => ({ sheet, suggestion: suggestProjectWorkbookMapping(sheet, project.sourceLocale, project.targetLocale) }))
                .filter(({ suggestion }) => suggestion.confidence >= 0.95 && suggestion.columns.source && suggestion.columns.target)
              if (choices.length !== 1) throw new Error(`${resource.path}：需要指定源／目标列及工作表`)
              xlsxMapping = { sheetName: choices[0]!.sheet.name, columns: { source: choices[0]!.suggestion.columns.source!, target: choices[0]!.suggestion.columns.target! } }
            }
            const imported = await service.importReference(projectId, resource.kind, { bytes, filename, xlsxMapping, libraryKey: `file:${resource.path}` })
            referenceId = imported.source!.id
            resource.warnings = imported.warnings
          }
          if (resource.importedId && resource.importedId !== referenceId && !state.resources.some(other => other !== resource && other.importedId === resource.importedId) && groups.retireBacking('reference:' + resource.importedId)) {
            const db = service.openProject(projectId)
            if (resource.kind === 'tm') db.tmSources.update(db.tmSources.ensureImported(db.referenceImports.get(resource.importedId)!).id, { enabled: false })
          }
          resource.importedId = referenceId
        } else if (reusable?.entries) {
          resource.entries = reusable.entries.map(entry => ({ ...entry, source: resource.path, id: hash(`${resource.path}:${entry.locator}:${entry.text}`) }))
          resource.warnings = reusable.warnings?.map(warning => warning.replace(reusable.path, resource.path))
        } else {
          const extraction = await extractContext(bytes, filename, undefined, Infinity)
          const anchors = new Map(extraction.anchors.map(anchor => [anchor.id, anchor]))
          const rows = libraryRows(extraction.textSections.map(section => {
            const anchor = anchors.get(section.anchorId)!
            return { location: anchor.locator, label: anchor.label ?? JSON.stringify(anchor.locator), text: section.text }
          }))
          if (['.md', '.txt'].includes(extname(filename).toLowerCase())) {
            rows.clear()
            // Keep multiline examples and Q/A together within their original paragraph.
            new TextDecoder().decode(bytes).split(/\r?\n\s*\r?\n/u).forEach((text, index) => {
              if (text.trim()) rows.set(`paragraph ${index + 1}`, [text.trim()])
            })
          }
          resource.entries = [...rows].map(([locator, parts]) => ({ id: hash(`${resource.path}:${locator}:${parts.join('\n')}`), source: resource.path, locator, text: parts.join('\n'), ...(resource.appliesTo ? { appliesTo: resource.appliesTo } : {}) }))
          resource.warnings = extraction.warnings.map(warning => `${resource.path}: ${warning.message}`)
        }
        resource.hash = digest
        resource.stamp = stamp
        resource.configuration = configuration
        groups.updateBacking('file:' + resource.path, backingKey(resource))
        resource.readAt = new Date().toISOString()
        delete resource.error
      } catch (error) {
        // File reads/parsers are the boundary: retain the last good data and expose failure.
        resource.error = error instanceof Error ? error.message : String(error)
        changed = true
      }
    }
    for (const resource of [...state.resources]) {
      if (!requestedFiles.has(resource.path) && hidden.has('file:' + resource.path)) continue
      if (resource.replacesInherited && resource.taskGroupId && !resource.error) {
        const fileKey = 'file:' + resource.path
        groups.ref(fileKey, resource.taskGroupId, backingKey(resource), resource.replacesInherited)
        delete resource.replacesInherited
        delete resource.taskGroupId
        changed = true
      }
      if (resource.replaces && !resource.error) {
        const oldKey = resource.replaces
        const owner = resource.replaceScope ?? ''
        remove(oldKey, owner, 'file:' + resource.path)
        if (!owner) db.catDb.db.prepare('UPDATE task_resource_refs SET replaces_key=? WHERE replaces_key=?').run('file:' + resource.path, oldKey)
        delete resource.replaceScope
        delete resource.replaces
        changed = true
      }
    }
    if (changed) {
      writeJsonFileAtomic(key, state)
      states.set(key, { stamp: statSync(key).mtimeMs, value: state })
    }
    return changed ? state : readState(service, projectId)
  })()
  active.set(key, work)
  try { return await work } finally { if (active.get(key) === work) active.delete(key) }
}

/** List metadata without parsing or embedding files. Native CAT imports share the same view. */
export function listProjectLibrary(service: LinguistProjectService, projectId: string, workspaceRoot: string, taskGroupId = ''): ProjectLibraryItem[] {
  const state = readState(service, projectId)
  const db = service.openProject(projectId)
  const refs = db.taskGroups.refs()
  const hidden = db.taskGroups.hidden(taskGroupId)
  const items: ProjectLibraryItem[] = state.resources.filter(resource => !hidden.has('file:' + resource.path)).map(resource => {
    let status: ProjectLibraryItem['status'] = resource.error ? 'error' : (resource.kind === 'context' || resource.kind === 'rules') && !resource.entries?.length ? 'manual' : 'ready'
    let error = resource.error
    try {
      const stat = statSync(libraryFile(service, projectId, workspaceRoot, resource.path))
      if (!error && resource.stamp !== `${stat.size}:${stat.mtimeMs}:${stat.ctimeMs}`) status = 'changed'
    } catch (cause) { status = 'error'; error = cause instanceof Error ? cause.message : String(cause) }
    return { key: `file:${resource.path}`, path: resource.path, filename: basename(resource.path), origin: 'workspace', kind: resource.kind,
      appliesTo: resource.appliesTo, xlsxMapping: resource.xlsxMapping, status, error, readAt: resource.readAt, warnings: resource.warnings ?? [] }
  })
  const termCounts = db.termEntries.countBySource()
  for (const kind of ['tm', 'terms'] as const) {
    for (const source of db.referenceImports.list(kind)) {
      if (state.resources.some(resource => resource.importedId === source.id) && !refs.some(ref => ref.resource_key === 'reference:' + source.id && (ref.scope === taskGroupId || !ref.scope))) continue
      if (kind === 'tm' ? !db.tmSources.get(deriveStableIdV2('tms', [projectId, source.id]))?.enabled : !termCounts[source.id]) continue
      items.push({ key: `reference:${source.id}`, path: source.originalFilename, filename: source.originalFilename, origin: 'cat', kind,
        status: 'ready', warnings: [], readAt: source.createdAt })
    }
  }
  for (const doc of db.contextDocs.list({ limit: db.contextDocs.count() })) {
    if (doc.parentContextDocId) continue
    items.push({ key: `document:${doc.id}`, path: doc.originalFilename, filename: doc.originalFilename, origin: 'cat',
      kind: /checklist|style.?guide|风格|检查表|检查清单|(?:^|[ _.-])sg(?:[ _.-]|$)/iu.test(doc.originalFilename) ? 'rules' : 'context',
      status: doc.textExtract?.trim() ? 'ready' : 'manual', warnings: doc.extractionWarnings.map(warning => warning.message), readAt: doc.createdAt })
  }
  const entry = (key: string, kind: ProjectResource['kind'], name: string, value: object): void => {
    items.push({ key, kind, path: key, filename: name, text: JSON.stringify(value, null, 2), origin: 'entry', status: 'ready', warnings: [] })
  }
  for (const rule of db.styleGuideRules.list({ limit: db.styleGuideRules.count() })) entry('rule:' + rule.id, 'rules', rule.ruleText, rule)
  for (const rule of db.techConstraints.list({ limit: db.techConstraints.count() })) entry('rule:' + rule.id, 'rules', rule.kind, rule)
  for (const pattern of db.sentencePatterns.list({ limit: db.sentencePatterns.count() })) entry('pattern:' + pattern.id, 'context', pattern.source, pattern)
  for (const term of db.termEntries.manualEntries()) entry('term:' + term.id, 'terms', term.term, term)
  for (const profile of db.voiceProfiles.list({ limit: db.voiceProfiles.count() })) entry('voice:' + profile.id, 'context', profile.speaker, profile)
  for (const exemplar of db.tmUnits.listApprovedExemplars({ limit: Number.MAX_SAFE_INTEGER, taskGroupId })) entry('exemplar:' + exemplar.id, 'tm', exemplar.source, exemplar)
  for (const source of db.tmSources.list()) {
    if (source.id.startsWith('confirmed:')) entry('tm-source:' + source.id, 'tm', `已确认译文（${source.unitCount}）`, source)
  }
  const explicit = new Set(refs.map(ref => ref.resource_key))
  const owners = new Set(refs.filter(ref => !ref.scope || ref.scope === taskGroupId).map(ref => ref.resource_key))
  return items.filter(item => !hidden.has(item.key) && (!explicit.has(item.key) || owners.has(item.key))).map(item => {
    const ref = refs.find(ref => ref.resource_key === item.key && ref.scope === taskGroupId)
    return { ...item, taskGroupId: ref?.scope || undefined, replacesInherited: ref?.replaces_key || undefined }
  })
}

export function requireLibraryItem(service: LinguistProjectService, projectId: string, workspaceRoot: string, key: string, taskGroupId?: string): ProjectLibraryItem {
  const item = listProjectLibrary(service, projectId, workspaceRoot, taskGroupId).find(item => item.key === key)
  if (!item) throw new Error('项目资料不存在，请刷新列表')
  return item
}

export function resolveLibraryFile(service: LinguistProjectService, projectId: string, workspaceRoot: string, key: string, taskGroupId?: string): { sourcePath: string; originalFilename: string } {
  const item = requireLibraryItem(service, projectId, workspaceRoot, key, taskGroupId)
  if (key.startsWith('reference:')) return service.resolveReferenceImportPreviewPath(projectId, key.slice('reference:'.length))
  if (key.startsWith('document:')) return service.resolveContextDocPreviewPath(projectId, key.slice('document:'.length))
  return { sourcePath: libraryFile(service, projectId, workspaceRoot, item.path), originalFilename: item.filename }
}

function retireLibraryItem(service: LinguistProjectService, projectId: string, state: LibraryState, key: string): void {
  const db = service.openProject(projectId)
  const resource = state.resources.find(item => `file:${item.path}` === key)
  if (resource) state.resources = state.resources.filter(item => item !== resource)
  const referenceId = resource?.importedId ?? (key.startsWith('reference:') ? key.slice('reference:'.length) : undefined)
  if (referenceId && !state.resources.some(item => item.importedId === referenceId) && db.taskGroups.retireBacking('reference:' + referenceId)) {
    const reference = db.referenceImports.get(referenceId)!
    if (reference.kind === 'tm') db.tmSources.update(db.tmSources.ensureImported(reference).id, { enabled: false })
  }
  if (key.startsWith('document:')) db.taskGroups.retireBacking(key)
  for (const item of state.resources) if (item.replaces === key) {
    delete item.replaces
    delete item.replaceScope
  }
  if (!resource && !referenceId && !key.startsWith('document:')) throw new Error('请在此原生条目的维护入口编辑或删除它')
}

function words(text: string): Set<string> {
  const tokens = [...text.toLowerCase().matchAll(/[\p{L}\p{N}_]+/gu)].flatMap(match => {
    const token = match[0]
    return /\p{Script=Han}/u.test(token) ? Array.from({ length: Math.max(1, token.length - 1) }, (_, i) => token.slice(i, i + 2)) : [token]
  })
  return new Set(tokens)
}

/** One project library, independent of CAT/UI/working-copy mode or the executing role. */
export async function getProjectLibraryMaterials(service: LinguistProjectService, projectId: string, workspaceRoot: string,
  queries: Array<{ id: string; text: string }>, signal?: AbortSignal, taskGroupId?: string, semantic = false): Promise<ProjectLibraryMaterials> {
  const catalog = await syncProjectLibrary(service, projectId, workspaceRoot, [], { taskGroupId })
  const db = service.openProject(projectId)
  const hidden = db.taskGroups.hidden(taskGroupId)
  const state = { resources: catalog.resources.filter(resource => !hidden.has('file:' + resource.path)) }
  const rules = state.resources.filter(resource => resource.kind === 'rules').flatMap(resource => resource.entries ?? [])
  const entries = state.resources.filter(resource => resource.kind === 'context').flatMap(resource => resource.entries ?? [])
  const warnings = state.resources.flatMap(resource => [...(resource.warnings ?? []), ...(resource.error ? [`${resource.path}：读取失败：${resource.error}${resource.hash ? '；仍使用上次成功读取的版本' : ''}`] : [])])
  const contextFiles: string[] = []
  function visualCopy(source: string, name: string, digest: string): string {
    const path = join('.linguist', 'context-images', digest, basename(name))
    if (!lstatSync(join(workspaceRoot, path), { throwIfNoEntry: false })) copyLibraryFile(source, workspaceRoot, path)
    return relative(realpathSync(workspaceRoot), workingCopyPath(workspaceRoot, path))
  }
  // Existing UI-imported assets participate too; no re-import is required.
  for (const doc of db.contextDocs.list({ limit: db.contextDocs.count() })) {
    if (doc.parentContextDocId) continue
    if (hidden.has('document:' + doc.id)) continue
    if (doc.sha256 && hasVisualContent(doc.originalFilename)) {
      const { sourcePath } = service.resolveContextDocPreviewPath(projectId, doc.id)
      contextFiles.push(visualCopy(sourcePath, doc.originalFilename, doc.sha256))
    }
    warnings.push(...doc.extractionWarnings.map(warning => `${doc.originalFilename}: ${warning.message}`))
    const target = /checklist|style.?guide|风格|检查表|检查清单|(?:^|[ _.-])sg(?:[ _.-]|$)/iu.test(doc.originalFilename) ? rules : entries
    const positions = libraryRows(db.contextDocs.listAnchors(doc.id).flatMap(anchor => {
      const range = anchor.locator.textRange
      return range && doc.textExtract ? [{ location: anchor.locator, label: anchor.label ?? anchor.id, text: doc.textExtract.slice(range.start, range.end) }] : []
    }))
    if (!positions.size && doc.textExtract) positions.set('document', [doc.textExtract])
    for (const [locator, parts] of positions) target.push({ id: hash(`${doc.id}:${locator}`), source: doc.originalFilename, locator, text: parts.join('\n') })
  }
  for (const pattern of db.sentencePatterns.list({ limit: db.sentencePatterns.count() }).filter(item => !hidden.has('pattern:' + item.id))) entries.push({ id: pattern.id, source: 'project sentence patterns', locator: pattern.id, text: JSON.stringify(pattern) })
  for (const profile of db.voiceProfiles.list({ limit: db.voiceProfiles.count() })) {
    if (!hidden.has('voice:' + profile.id)) entries.push({ id: profile.id, source: profile.speaker, locator: profile.id, text: JSON.stringify(profile) })
  }
  const occurrences = Map.groupBy(entries, entry => entry.text)
  const unique = [...occurrences.keys()]
  const nonempty = queries.filter(query => query.text.trim())
  let semanticMatches: number[][] = []
  if (semantic && service.reviewCache.enabled && unique.length && nonempty.length) {
    // Cached match positions refer to this order, independent of the current worksheet order.
    unique.sort()
    try { semanticMatches = await service.reviewCache.search(join(service.getProjectPaths(projectId).projectDir, 'semantic-cache.sqlite'), unique, nonempty.map(query => query.text), signal, taskGroupId) }
    catch (error) { if (signal?.aborted) throw error; warnings.push(`项目资料语义检索未完成，当前只含文字匹配：${error instanceof Error ? error.message : String(error)}`) }
  }
  const matches: Record<string, LibraryEntry[]> = {}
  const indexed = unique.map(words)
  for (const [index, query] of nonempty.entries()) {
    const queryWords = words(query.text)
    const lexical = indexed.map((terms, i) => ({ i, score: [...queryWords].filter(word => terms.has(word)).length }))
      .filter(item => item.score > 0).sort((a, b) => b.score - a.score).slice(0, 5).map(item => item.i)
    matches[query.id] = [...new Set([...lexical, ...(semanticMatches[index] ?? [])])].flatMap(i => occurrences.get(unique[i]!)!)
    matches[query.id]!.push(...rules.filter(rule => rule.appliesTo?.some(scope => query.text.toLowerCase().includes(scope.toLowerCase()))))
  }
  // Without matching type/context metadata, carry the scoped original once for
  // the reviewer to decide applicability; missing columns must not hide rules.
  const attachedRules = new Set(Object.values(matches).flat().map(entry => entry.id))
  for (const resource of state.resources) {
    if (resource.kind === 'tm' || resource.kind === 'terms') continue
    contextFiles.push(resource.hash && hasVisualContent(resource.path) && managedUpload(projectId, resource.path)
      ? visualCopy(libraryFile(service, projectId, workspaceRoot, resource.path), resource.path, resource.hash)
      : resource.path)
  }
  return { rules: rules.filter(rule => !rule.appliesTo?.length || !attachedRules.has(rule.id)), matches, warnings, contextFiles }
}

/** Normal conversation evidence uses the same native TM/TB engines as review. */
export async function getProjectQuestionMaterials(service: LinguistProjectService, projectId: string, workspaceRoot: string, query: string, signal?: AbortSignal,
  selected: readonly (Pick<Segment, 'source' | 'target'> & Partial<Pick<Segment, 'assetId'>>)[] = [], taskGroupId?: string, semantic = false) {
  taskGroupId = service.openProject(projectId).taskGroups.forAssets(selected.flatMap(row => row.assetId ? [row.assetId] : []), taskGroupId)
  const queries = [...new Set([query, ...selected.map(row => row.source)])]
  const library = await getProjectLibraryMaterials(service, projectId, workspaceRoot, queries.map((text, i) => ({ id: String(i), text })), signal, taskGroupId, semantic)
  const project = service.getProject(projectId)
  const db = service.openProject(projectId)
  const candidates = db.tmUnits.listCandidates(project.sourceLocale, project.targetLocale, undefined, taskGroupId)
  return { rules: [...library.rules, ...db.getProjectRules(undefined, taskGroupId).map(rule => ({ id: rule.ruleId, source: 'project rules', locator: rule.ruleId, text: JSON.stringify(rule) }))],
    visualFiles: library.contextFiles.filter(hasVisualContent),
    related: [...new Map(Object.values(library.matches).flat().map(entry => [entry.id, entry])).values()], warnings: library.warnings,
    terms: queries.flatMap(source => db.termEntries.evaluateSegment({ source, target: '', sourceLocale: project.sourceLocale, targetLocale: project.targetLocale } as Segment, '', taskGroupId).matches.map(match => match.match)),
    tm: queries.flatMap(source => selectTmAgentEvidence(matchTmCandidates(source, candidates, { minimumScore: 70, includeAdaptable: true }), 3)) }
}
