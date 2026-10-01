import { PROJECT_NAME_MAX_LENGTH, LOCALE_MAX_LENGTH, LOCALE_PATTERN } from '../project-input'
import { existsSync, lstatSync, readdirSync, realpathSync, statSync } from 'node:fs'
import { readdir, stat } from 'node:fs/promises'
import { basename, extname, isAbsolute, join, relative } from 'node:path'
import { WorkspaceId } from '@deepseek-ai/dsh-workspace'
import {
  normalizeQaProfile,
  normalizeWorkflowStage,
  sha256Hex,
  type LinguistProject,
  type ProposalStatus,
  type QaFindingDisposition,
  type QaFindingSeverity,
  type SegmentStatus,
  type WorkflowStage,
} from '@linguist/cat-core'
import { normalizeDelimitedHeader, parseXlsxWorkbook, XlsxAdapter, type XlsxWorkbookParseResult } from '@linguist/cat-formats'
import { readProjectManifestFile, StoreNotFoundError, type ContextDoc, type ProposalMutationItem } from '@linguist/cat-store'
import {
  LinguistProjectService,
  LinguistDeliveryNotReadyError,
  LinguistExportBlockedByQaError,
  convertOfficePreviewToHtml,
  deriveImportProjectId,
  listDefaultFormatQualifications,
  parseTermReference,
  parseTmReference,
  readPickedFileWithinLimit,
  readOfficePreviewText,
  readWorkingJson,
  suggestProjectWorkbookMapping,
} from '@linguist/domain-service'
import type { LinguistAssetPreviewResult, LinguistProjectInfo, LinguistScheduleCreateRequest, LinguistScheduleTiming, LinguistSessionDetachBindingResult, LinguistTurnContextV1, LinguistWorkingCopiesListResult, LinguistXlsxMappingPreview } from '@linguist/domain-service/contracts'
import type { XlsxImportMapping, LinguistReferenceKind } from '@linguist/domain-service'
import type { BindingStore } from './bindings'
import type { ManagedFiles } from './files'
import type { MutationBus } from './mutations'
import { copyLinguistSessionToProject, sessionCopyEligibility, type SessionCopyHost } from './session-copy'
import { validateLinguistTurnContext } from './automation-context'
import type { TurnContextReceipts } from './turn-context'
import type { ScheduleContextManager } from './schedule-context'
import type { LinguistDelegationControl } from './delegation-control'

const PROJECT_ID = /^prj-[0-9a-f]{16}$/
const ASSET_ID = /^ast(?:-[0-9a-f]{16}|_v2_[0-9a-f]{64})$/
const SEGMENT_ID = /^seg(?:-[0-9a-f]{16}|_v2_[0-9a-f]{64})$/
const PROPOSAL_ID = /^prp(?:-[0-9a-f]{16}|_v2_[0-9a-f]{64})$/
const FINDING_ID = /^qaf(?:-[0-9a-f]{16}|_v2_[0-9a-f]{64})$/
const PROJECT_ASSET_ID = /^(?:sgr|spn|ctx|tcn|vpr)(?:-[0-9a-f]{16}|_v2_[0-9a-f]{64})$/
const REFERENCE_ID = /^(?:(?:tmu|ter)(?:-[0-9a-f]{16}|_v2_[0-9a-f]{64})|tmuo_v2_[0-9a-f]{64})$/
const TERM_ID = /^ter(?:-[0-9a-f]{16}|_v2_[0-9a-f]{64})$/
const REFERENCE_IMPORT_ID = /^rfi(?:-[0-9a-f]{16}|_v2_[0-9a-f]{64})$/
const BACKUP_NAME = /^(?:backup-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z|cat-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z\.db)$/
const XLSX_DETECTOR = new XlsxAdapter()
const TEXT_PREVIEW_EXTENSIONS = new Set(['.xliff', '.xlf', '.mqxliff', '.sdlxliff', '.mxliff', '.csv', '.tsv', '.json', '.md', '.markdown', '.txt', '.text', '.log'])
const OFFICE_PREVIEW_EXTENSIONS = new Set(['.docx', '.xlsx', '.pptx'])
const LEGACY_OFFICE_PREVIEW_EXTENSIONS = new Set(['.doc', '.dot', '.wps', '.wpt', '.rtf'])
const SINGLE_RESOURCE_EXTENSIONS = new Set(['.csv', '.tmx', '.tbx', '.sdltm', '.sdltb', '.pdf', '.doc', '.docx', '.rtf', '.pptx', '.md', '.markdown', '.txt', '.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg', '.bmp'])

type Data = Record<string, unknown>
type AssetKind = 'styleGuideRules' | 'sentencePatterns' | 'contextDocs' | 'techConstraints' | 'voiceProfiles'

export interface DispatchOperationInput {
  operation: string
  payload: Data
  service: LinguistProjectService
  bindings: BindingStore
  workspaceRegistry: { get(id: WorkspaceId): { id: WorkspaceId; path: string } | undefined }
  files: ManagedFiles
  mutations: MutationBus
  assertProjectSession: (sessionId: string, projectId: string) => Promise<void>
  resolveSessionWorkspace: (sessionId: string) => Promise<{ workspaceRoot: string }>
  sessionCopyHost?: SessionCopyHost
  turnContextReceipts?: TurnContextReceipts
  scheduleContext?: ScheduleContextManager
  delegationControl?: LinguistDelegationControl
  detachSessionBinding?: (sessionId: string) => Promise<LinguistSessionDetachBindingResult>
}

function object(value: unknown, field = 'input'): Data {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new TypeError(`${field} must be an object`)
  return value as Data
}

function string(value: unknown, field: string, max = 1000, pattern?: RegExp): string {
  if (typeof value !== 'string' || value.trim() === '' || value.length > max || (pattern !== undefined && !pattern.test(value))) {
    throw new TypeError(`${field} is invalid`)
  }
  return value
}

function optionalString(value: unknown, field: string, max = 1000): string | undefined {
  if (value === undefined) return undefined
  if (typeof value !== 'string' || value.length > max) throw new TypeError(`${field} is invalid`)
  return value
}

function boolean(value: unknown, field: string, fallback?: boolean): boolean {
  if (value === undefined && fallback !== undefined) return fallback
  if (typeof value !== 'boolean') throw new TypeError(`${field} must be boolean`)
  return value
}

function integer(value: unknown, field: string, minimum: number, maximum: number, fallback?: number): number {
  if (value === undefined && fallback !== undefined) return fallback
  if (!Number.isSafeInteger(value) || (value as number) < minimum || (value as number) > maximum) throw new TypeError(`${field} is out of range`)
  return value as number
}

function oneOf<T extends string>(value: unknown, field: string, choices: readonly T[], fallback?: T): T {
  if (value === undefined && fallback !== undefined) return fallback
  if (typeof value !== 'string' || !choices.includes(value as T)) throw new TypeError(`${field} must be one of ${choices.join('/')}`)
  return value as T
}

function strings(value: unknown, field: string, max: number, itemPattern?: RegExp, allowEmpty = false): string[] {
  if (!Array.isArray(value) || value.length > max || (!allowEmpty && value.length === 0)) throw new TypeError(`${field} must be a bounded array`)
  return value.map((item) => string(item, `${field} item`, 1000, itemPattern))
}

function page(payload: Data, defaultLimit = 50): { limit: number; offset: number } {
  return { limit: integer(payload.limit, 'limit', 1, 200, defaultLimit), offset: integer(payload.offset, 'offset', 0, Number.MAX_SAFE_INTEGER, 0) }
}

function projectId(payload: Data): string { return string(payload.projectId, 'projectId', 20, PROJECT_ID) }
function assetId(payload: Data): string { return string(payload.assetId, 'assetId', 80, ASSET_ID) }
function segmentId(payload: Data): string { return string(payload.segmentId, 'segmentId', 80, SEGMENT_ID) }
function findingId(payload: Data): string { return string(payload.findingId, 'findingId', 80, FINDING_ID) }
function proposalId(payload: Data): string { return string(payload.proposalId, 'proposalId', 80, PROPOSAL_ID) }
function revision(payload: Data): number { return integer(payload.expectedRevision, 'expectedRevision', 0, Number.MAX_SAFE_INTEGER) }
function stage(value: unknown, fallback?: WorkflowStage): WorkflowStage { return oneOf(value, 'workflowStage', ['translation', 'editing', 'proofreading'] as const, fallback) }
function assetKind(value: unknown): AssetKind { return oneOf(value, 'kind', ['styleGuideRules', 'sentencePatterns', 'contextDocs', 'techConstraints', 'voiceProfiles'] as const) }
function referenceKind(value: unknown): LinguistReferenceKind { return oneOf(value, 'kind', ['tm', 'terms'] as const) }

function workspace(id: string, registry: DispatchOperationInput['workspaceRegistry']): void {
  const record = registry.get(WorkspaceId(id))
  if (record === undefined || !existsSync(record.path) || realpathSync(record.path) !== record.path || !statSync(record.path).isDirectory()) {
    throw new TypeError('workspaceId does not name an available DSH Workspace')
  }
}

function workspaceDirectory(workspaceId: string, selectedPath: string, registry: DispatchOperationInput['workspaceRegistry'], allowRoot = false): string {
  if (isAbsolute(selectedPath) || selectedPath.split(/[\\/]/u).some(part => part === '..')) throw new TypeError('selected path must be relative to the DSH Workspace')
  workspace(workspaceId, registry)
  const root = registry.get(WorkspaceId(workspaceId))!.path
  const selected = join(root, selectedPath)
  const stat = lstatSync(selected)
  if (stat.isSymbolicLink() || !stat.isDirectory()) throw new TypeError('selected path must be a regular directory')
  const canonical = realpathSync(selected)
  const inside = relative(root, canonical)
  if ((!allowRoot && inside === '') || inside === '..' || inside.startsWith('../') || isAbsolute(inside)) throw new TypeError('selected path is outside the DSH Workspace')
  return canonical
}

function assertRegularTree(root: string): void {
  const rootStat = lstatSync(root)
  if (rootStat.isSymbolicLink() || !rootStat.isDirectory() || realpathSync(root) !== root) throw new TypeError('legacy root must remain a regular canonical directory')
  const pending = [root]
  while (pending.length > 0) {
    const current = pending.pop()!
    for (const item of readdirSync(current, { withFileTypes: true })) {
      const path = join(current, item.name)
      const stat = lstatSync(path)
      if (stat.isSymbolicLink() || (!stat.isDirectory() && !stat.isFile())) throw new TypeError('legacy root contains a non-regular entry')
      if (stat.isDirectory()) pending.push(path)
    }
  }
}

function publicProject(project: LinguistProject, bindings: BindingStore): LinguistProjectInfo & { workspaceId?: string } {
  const workspaceId = bindings.projectWorkspace(project.id)
  return {
    schemaVersion: project.schemaVersion,
    id: project.id,
    name: project.name,
    sourceLocale: project.sourceLocale,
    targetLocale: project.targetLocale,
    createdAt: project.createdAt,
    updatedAt: project.updatedAt,
    ...(project.archivedAt === undefined ? {} : { archivedAt: project.archivedAt }),
    workflowStage: normalizeWorkflowStage(project.workflowStage),
    outputStatusPolicy: project.outputStatusPolicy,
    qaProfile: normalizeQaProfile(project.qaProfile),
    ...(project.tagProfile === undefined ? {} : { tagProfile: project.tagProfile }),
    ...(workspaceId === undefined ? {} : { workspaceId }),
  }
}

function notify(mutations: MutationBus, project: string, kind: string, fields: Data = {}): void {
  mutations.publish(project, { kind, ...fields })
}

function uploadTokens(payload: Data): string[] { return strings(payload.fileTokens, 'fileTokens', 500) }
function readUpload(files: ManagedFiles, token: string): { path: string; filename: string } { return files.takeUpload(token) }

function scheduleRequest(payload: Data, service: LinguistProjectService): LinguistScheduleCreateRequest {
  const sessionId = string(payload.sessionId, 'sessionId', 200)
  const project = projectId(payload)
  if (payload.executeAtDue !== true) throw new TypeError('executeAtDue must be true')
  const scope = oneOf(payload.scope, 'scope', ['project', 'asset', 'segments'] as const)
  const selector = object(payload.timing, 'timing')
  const kind = oneOf(selector.kind, 'timing.kind', ['after', 'at', 'every', 'daily', 'weekly', 'monthly', 'cron'] as const)
  let timing: LinguistScheduleTiming
  if (kind === 'after') timing = { kind, seconds: integer(selector.seconds, 'timing.seconds', 60, Number.MAX_SAFE_INTEGER) }
  else if (kind === 'every') {
    const activeWindowStart = selector.activeWindowStart === undefined ? undefined : string(selector.activeWindowStart, 'timing.activeWindowStart', 5, /^(?:[01]\d|2[0-3]):[0-5]\d$/)
    const activeWindowEnd = selector.activeWindowEnd === undefined ? undefined : string(selector.activeWindowEnd, 'timing.activeWindowEnd', 5, /^(?:[01]\d|2[0-3]):[0-5]\d$/)
    if ((activeWindowStart === undefined) !== (activeWindowEnd === undefined) || (activeWindowStart !== undefined && activeWindowStart >= activeWindowEnd!)) throw new TypeError('timing active window must have start < end')
    let activeWeekdays: number[] | undefined
    if (selector.activeWeekdays !== undefined) {
      if (!Array.isArray(selector.activeWeekdays) || selector.activeWeekdays.length > 7) throw new TypeError('timing.activeWeekdays must be a bounded array')
      activeWeekdays = selector.activeWeekdays.map(day => integer(day, 'timing.activeWeekdays', 0, 6))
      if (new Set(activeWeekdays).size !== activeWeekdays.length) throw new TypeError('timing.activeWeekdays contains duplicates')
    }
    timing = { kind, seconds: integer(selector.seconds, 'timing.seconds', 60, Number.MAX_SAFE_INTEGER),
      ...(activeWindowStart === undefined ? {} : { activeWindowStart, activeWindowEnd }), ...(activeWeekdays?.length ? { activeWeekdays } : {}) }
  } else if (kind === 'monthly') timing = { kind, time: string(selector.time, 'timing.time', 5, /^(?:[01]\d|2[0-3]):[0-5]\d$/), dayOfMonth: integer(selector.dayOfMonth, 'timing.dayOfMonth', 1, 31) }
  else if (kind === 'at') {
    const at = string(selector.at, 'timing.at', 40, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/)
    if (!Number.isFinite(Date.parse(at)) || Date.parse(at) - Date.now() < 60_000) throw new TypeError('timing.at must be at least 60 seconds in the future')
    timing = { kind, at }
  } else if (kind === 'daily') timing = { kind, time: string(selector.time, 'timing.time', 12), timeZone: string(selector.timeZone, 'timing.timeZone', 100) }
  else if (kind === 'weekly') {
    if (!Array.isArray(selector.weekdays) || selector.weekdays.length === 0 || selector.weekdays.length > 7) throw new TypeError('timing.weekdays must be a bounded array')
    const weekdays = selector.weekdays.map(day => integer(day, 'weekday', 1, 7))
    if (new Set(weekdays).size !== weekdays.length) throw new TypeError('timing.weekdays contains duplicates')
    timing = { kind, time: string(selector.time, 'timing.time', 12), timeZone: string(selector.timeZone, 'timing.timeZone', 100), weekdays }
  } else timing = { kind, expression: string(selector.expression, 'timing.expression', 200), timeZone: string(selector.timeZone, 'timing.timeZone', 100) }
  if (payload.notificationTargets !== undefined && (!Array.isArray(payload.notificationTargets) || payload.notificationTargets.length > 20)) throw new TypeError('notificationTargets must be a bounded array')
  const notificationTargets = (payload.notificationTargets as unknown[] | undefined)?.map(value => {
    const target = object(value, 'notificationTarget')
    return { destinationId: string(target.destinationId, 'destinationId', 200), trigger: oneOf(target.trigger, 'trigger', ['always', 'success', 'error'] as const) }
  })
  const turnContext: LinguistTurnContextV1 | undefined = scope === 'project' ? undefined : validateLinguistTurnContext(payload.turnContext, project, service).context
  return { sessionId, projectId: project, title: string(payload.title, 'title', 120).trim(), prompt: string(payload.prompt, 'prompt', 4000).trim(), notificationTargets, executeAtDue: true, scope, ...(turnContext ? { turnContext } : {}), timing,
    sessionMode: payload.sessionMode === undefined ? 'daily' : oneOf(payload.sessionMode, 'sessionMode', ['daily', 'reuse'] as const),
    ...(payload.maxRuns === undefined ? {} : { maxRuns: integer(payload.maxRuns, 'maxRuns', 1, Number.MAX_SAFE_INTEGER) }) }
}

export async function dispatchOperation(input: DispatchOperationInput): Promise<unknown> {
  const { operation, payload, service, bindings, workspaceRegistry, files, mutations } = input
  switch (operation) {
    case 'linguistDelegationsList': {
      if (!input.delegationControl) throw new Error('Native DSH continuable subagents are unavailable')
      return input.delegationControl.list(string(payload.parentSessionId, 'parentSessionId', 200))
    }
    case 'linguistDelegationsPrompt': {
      if (!input.delegationControl) throw new Error('Native DSH continuable subagents are unavailable')
      return input.delegationControl.prompt(
        string(payload.parentSessionId, 'parentSessionId', 200),
        string(payload.childSessionId, 'childSessionId', 200),
        string(payload.requestId, 'requestId', 36, /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i),
        string(payload.text, 'text', 10000),
        oneOf(payload.delivery, 'delivery', ['queue', 'steer'] as const),
      )
    }
    case 'linguistDelegationsInterrupt': {
      if (!input.delegationControl) throw new Error('Native DSH continuable subagents are unavailable')
      return input.delegationControl.interrupt(
        string(payload.parentSessionId, 'parentSessionId', 200),
        string(payload.childSessionId, 'childSessionId', 200),
      )
    }
    case 'linguistSessionsDetachBinding': {
      if (!input.detachSessionBinding) throw new Error('Native DSH Session binding service is unavailable')
      return input.detachSessionBinding(string(payload.sessionId, 'sessionId', 200))
    }
    case 'linguistScheduleCreate': {
      if (!input.scheduleContext) throw new Error('Native DSH Schedule is unavailable')
      return input.scheduleContext.create(scheduleRequest(payload, service))
    }
    case 'linguistScheduleList': {
      if (!input.scheduleContext) throw new Error('Native DSH Schedule is unavailable')
      return input.scheduleContext.list(string(payload.sessionId, 'sessionId', 200))
    }
    case 'linguistScheduleUpdate': {
      if (!input.scheduleContext) throw new Error('Native DSH Schedule is unavailable')
      return input.scheduleContext.update({ ...scheduleRequest(payload, service),
        scheduleId: string(payload.scheduleId, 'scheduleId', 200), expectedVersion: string(payload.expectedVersion, 'expectedVersion', 64, /^[0-9a-f]{64}$/) })
    }
    case 'linguistSchedulePause': {
      if (!input.scheduleContext) throw new Error('Native DSH Schedule is unavailable')
      return input.scheduleContext.pause(string(payload.sessionId, 'sessionId', 200), string(payload.scheduleId, 'scheduleId', 200),
        string(payload.expectedVersion, 'expectedVersion', 64, /^[0-9a-f]{64}$/))
    }
    case 'linguistScheduleCancel': {
      if (!input.scheduleContext) throw new Error('Native DSH Schedule is unavailable')
      return input.scheduleContext.cancel(string(payload.sessionId, 'sessionId', 200), string(payload.scheduleId, 'scheduleId', 200))
    }
    case 'linguistScheduleHistory': {
      if (!input.scheduleContext) throw new Error('Native DSH Schedule is unavailable')
      return input.scheduleContext.history(string(payload.sessionId, 'sessionId', 200), string(payload.scheduleId, 'scheduleId', 200),
        integer(payload.limit, 'limit', 1, 100, 50), payload.before === undefined ? undefined : string(payload.before, 'before', 200),
        payload.beforeExecution === undefined ? undefined : string(payload.beforeExecution, 'beforeExecution', 200))
    }
    case 'linguistScheduleRunNow': {
      if (!input.scheduleContext) throw new Error('Native DSH Schedule is unavailable')
      return input.scheduleContext.runNow(string(payload.sessionId, 'sessionId', 200), string(payload.scheduleId, 'scheduleId', 200),
        string(payload.expectedVersion, 'expectedVersion', 64, /^[0-9a-f]{64}$/))
    }
    case 'linguistTurnContextPrepare': {
      if (!input.turnContextReceipts) throw new Error('Linguist turn context receipt service is unavailable')
      const sessionId = string(payload.sessionId, 'sessionId', 200)
      const requestId = string(payload.requestId, 'requestId', 36, /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i)
      const binding = bindings.session(sessionId)
      if (!binding?.projectId || binding.workMode !== 'cat') throw new Error('Session is not bound to a Linguist CAT project')
      await input.assertProjectSession(sessionId, binding.projectId)
      const parsed = validateLinguistTurnContext(payload.turnContext, binding.projectId, service)
      input.turnContextReceipts.prepare(sessionId, requestId, parsed.context)
      return { requestId, context: parsed.context, selectionTruncated: parsed.selectionTruncated }
    }
    case 'linguistSessionsCopyEligibility': {
      if (!input.sessionCopyHost) throw new Error('Native DSH Session copy service is unavailable')
      return sessionCopyEligibility(input.sessionCopyHost, string(payload.sessionId, 'sessionId', 200),
        payload.targetProjectId === undefined ? undefined : string(payload.targetProjectId, 'targetProjectId', 20, PROJECT_ID))
    }
    case 'linguistSessionsCopyToProject': {
      if (!input.sessionCopyHost) throw new Error('Native DSH Session copy service is unavailable')
      return copyLinguistSessionToProject(input.sessionCopyHost,
        string(payload.sessionId, 'sessionId', 200), string(payload.targetProjectId, 'targetProjectId', 20, PROJECT_ID))
    }
    case 'linguistProjectsList':
      return service.listProjects({ includeArchived: boolean(payload.includeArchived, 'includeArchived', false) }).map((project) => publicProject(project, bindings))
    case 'linguistProjectsListFormatQualifications':
      return listDefaultFormatQualifications()
    case 'linguistProjectsCreate': {
      const workspaceId = string(payload.workspaceId, 'workspaceId', 200)
      workspace(workspaceId, workspaceRegistry)
      const created = await service.createProject({
        name: string(payload.name, 'name', PROJECT_NAME_MAX_LENGTH),
        sourceLocale: string(payload.sourceLocale, 'sourceLocale', LOCALE_MAX_LENGTH, LOCALE_PATTERN),
        targetLocale: string(payload.targetLocale, 'targetLocale', LOCALE_MAX_LENGTH, LOCALE_PATTERN),
        workflowStage: stage(payload.workflowStage, 'translation'),
        ...(payload.qaProfile === undefined ? {} : { qaProfile: oneOf(payload.qaProfile, 'qaProfile', ['general', 'subtitle'] as const) }),
        ...(payload.outputStatusPolicy === undefined ? {} : { outputStatusPolicy: outputStatusPolicy(payload.outputStatusPolicy) }),
      })
      bindings.bindProject(created.id, workspaceId)
      notify(mutations, created.id, 'project-updated')
      return publicProject(created, bindings)
    }
    case 'linguistProjectsAssociateWorkspace': {
      const id = projectId(payload)
      const workspaceId = string(payload.workspaceId, 'workspaceId', 200)
      service.getProject(id)
      workspace(workspaceId, workspaceRegistry)
      bindings.bindProject(id, workspaceId)
      notify(mutations, id, 'project-updated')
      return publicProject(service.getProject(id), bindings)
    }
    case 'linguistProjectsOpen': {
      const id = projectId(payload)
      service.openProject(id)
      return { project: publicProject(service.getProject(id), bindings), health: service.checkProjectHealth(id) }
    }
    case 'linguistProjectsCheckHealth':
      return service.checkProjectHealth(projectId(payload))
    case 'linguistProjectsGetSummary': {
      const id = projectId(payload)
      const summary = service.getProjectSummary(id)
      return { ...summary, project: publicProject(summary.project, bindings) }
    }
    case 'linguistProjectsGetStageCoverage':
      return service.getStageDecisionCoverage(projectId(payload), assetId(payload), stage(payload.workflowStage))
    case 'linguistProjectsRename': {
      const id = projectId(payload)
      const result = service.renameProject(id, string(payload.name, 'name', PROJECT_NAME_MAX_LENGTH))
      notify(mutations, id, 'project-updated')
      return publicProject(result, bindings)
    }
    case 'linguistProjectsSetLocales': {
      const id = projectId(payload)
      const result = service.setProjectLocales(id, string(payload.sourceLocale, 'sourceLocale', LOCALE_MAX_LENGTH, LOCALE_PATTERN), string(payload.targetLocale, 'targetLocale', LOCALE_MAX_LENGTH, LOCALE_PATTERN))
      notify(mutations, id, 'project-updated')
      return publicProject(result, bindings)
    }
    case 'linguistProjectsReorderActive': {
      const ordered = strings(payload.orderedProjectIds, 'orderedProjectIds', 500, PROJECT_ID, true)
      const projects = service.reorderActiveProjects(ordered).map(project => publicProject(project, bindings))
      for (const project of projects) notify(mutations, project.id, 'project-updated')
      return projects
    }
    case 'linguistProjectsSetWorkflowConfig': {
      const id = projectId(payload)
      const result = service.setWorkflowConfig(id, stage(payload.workflowStage), payload.outputStatusPolicy === undefined ? undefined : payload.outputStatusPolicy === null ? null : outputStatusPolicy(payload.outputStatusPolicy), payload.qaProfile === undefined ? undefined : oneOf(payload.qaProfile, 'qaProfile', ['general', 'subtitle'] as const))
      notify(mutations, id, 'project-updated')
      return publicProject(result, bindings)
    }
    case 'linguistProjectsUpdateTagProfile': {
      const id = projectId(payload)
      const action = oneOf(payload.action, 'action', ['save', 'activate', 'ignore', 'enable', 'disable'] as const)
      const result = action === 'save'
        ? service.saveTagProfileCandidate(id, tagCandidate(object(payload.candidate, 'candidate')), optionalString(payload.replaceId, 'replaceId', 100)).project
        : service.updateTagProfile(id, string(payload.entryId, 'entryId', 100), action).project
      notify(mutations, id, 'project-updated')
      return publicProject(result, bindings)
    }
    case 'linguistProjectsScanUnknownTags':
      return service.scanUnknownTagPatterns(projectId(payload), payload.assetIds === undefined ? undefined : strings(payload.assetIds, 'assetIds', 100, ASSET_ID), payload.sampleLimit === undefined ? undefined : integer(payload.sampleLimit, 'sampleLimit', 1, 10))
    case 'linguistProjectsArchive': {
      const id = projectId(payload)
      const result = service.archiveProject(id)
      notify(mutations, id, 'project-updated')
      return publicProject(result, bindings)
    }
    case 'linguistProjectsDelete': {
      const id = projectId(payload)
      const result = service.deleteProject(id, string(payload.confirmationName, 'confirmationName', 120))
      notify(mutations, id, 'project-updated')
      return result
    }
    case 'linguistProjectsBackup':
      return service.backupProject(projectId(payload))
    case 'linguistBackupsList':
      return service.listBackups(projectId(payload))
    case 'linguistBackupsPreviewRestore':
      return service.previewRestore(projectId(payload), string(payload.backupName, 'backupName', 80, BACKUP_NAME))
    case 'linguistBackupsRestore': {
      const id = projectId(payload)
      const result = service.restoreProject(id, string(payload.backupName, 'backupName', 80, BACKUP_NAME))
      notify(mutations, id, 'project-updated')
      return result
    }
    case 'linguistBackupsImportExternal': {
      const workspaceId = string(payload.workspaceId, 'workspaceId', 200)
      const backupPath = string(payload.backupPath, 'backupPath', 2048)
      const canonical = workspaceDirectory(workspaceId, backupPath, workspaceRegistry)
      const preview = readProjectManifestFile(join(canonical, 'project.json'))
      const bound = bindings.projectWorkspace(preview.id)
      if (bound !== undefined && bound !== workspaceId) throw new Error('Project ID is already associated with another DSH Workspace')
      const imported = service.importProjectBackupFromPath(canonical)
      bindings.bindProject(imported.project.id, workspaceId)
      notify(mutations, imported.project.id, 'project-updated')
      return { project: publicProject(imported.project, bindings), importedFrom: backupPath, schemaVersion: imported.schemaVersion }
    }
    case 'linguistLegacyMigrationScan': {
      const workspaceId = string(payload.workspaceId, 'workspaceId', 200)
      const legacyRootPath = string(payload.legacyRootPath, 'legacyRootPath', 2048)
      const root = workspaceDirectory(workspaceId, legacyRootPath, workspaceRegistry, true)
      assertRegularTree(root)
      return service.legacyMigration.scanRoot(root, workspaceId)
    }
    case 'linguistLegacyMigrationImport': {
      const workspaceId = string(payload.workspaceId, 'workspaceId', 200)
      workspace(workspaceId, workspaceRegistry)
      const scanId = string(payload.scanId, 'scanId', 36, /^[0-9a-f-]{36}$/u)
      const projectIds = [...new Set(strings(payload.projectIds, 'projectIds', 500, /^[^\\/]+$/u))]
      const options = payload.options === undefined ? undefined : object(payload.options, 'options')
      const externalSource = options?.externalSource === undefined ? undefined : oneOf(options.externalSource, 'externalSource', ['copy', 'reference'] as const)
      const salvageOrphan = options?.salvageOrphan === undefined ? undefined : boolean(options.salvageOrphan, 'salvageOrphan')
      const scannedRoot = service.legacyMigration.scannedRoot(scanId, workspaceId)
      const currentRoot = workspaceRegistry.get(WorkspaceId(workspaceId))!.path
      const inside = relative(currentRoot, scannedRoot)
      if (inside === '..' || inside.startsWith('../') || isAbsolute(inside)) throw new TypeError('scanned legacy root is outside the selected DSH Workspace')
      assertRegularTree(scannedRoot)
      for (const legacyProjectId of projectIds) {
        const bound = bindings.projectWorkspace(deriveImportProjectId(legacyProjectId))
        if (bound !== undefined && bound !== workspaceId) throw new Error('Legacy project ID is already associated with another DSH Workspace')
      }
      const report = await service.legacyMigration.importSelected({
        scanId, scopeId: workspaceId, projectIds,
        ...(externalSource === undefined && salvageOrphan === undefined ? {} : { options: { ...(externalSource === undefined ? {} : { externalSource }), ...(salvageOrphan === undefined ? {} : { salvageOrphan }) } }),
      }, progress => mutations.publishMigration(workspaceId, scanId, progress))
      for (const project of report.projects) {
        if (!project.targetConflict && project.disposition !== 'quarantined' && project.disposition !== 'error') {
          bindings.bindProject(project.newProjectId, workspaceId)
          notify(mutations, project.newProjectId, 'project-updated')
        }
      }
      return report
    }
    case 'linguistProjectsUndoImportAsset': {
      const id = projectId(payload)
      const result = service.undoImportAsset(id, assetId(payload))
      notify(mutations, id, 'asset-updated')
      return result
    }
    case 'linguistProjectsImport':
      return importProject(input)
    case 'linguistProjectsConfirmXlsxMapping':
      return confirmXlsxMapping(input)
    case 'linguistProjectsPreviewAssetSource': {
      const { sourcePath, originalFilename } = service.resolveAssetSourcePath(projectId(payload), assetId(payload))
      return previewManagedFile(files, sourcePath, originalFilename)
    }
    case 'linguistProjectsPreviewReferenceImport': {
      const { sourcePath, originalFilename } = service.resolveReferenceImportPreviewPath(projectId(payload), string(payload.importId, 'importId', 80, REFERENCE_IMPORT_ID))
      return previewManagedFile(files, sourcePath, originalFilename)
    }
    case 'linguistWorkingCopiesList':
      return listWorkingCopies(input)
    case 'linguistCatQuery': {
      const id = projectId(payload)
      const selectedAssetId = payload.assetId === undefined ? undefined : string(payload.assetId, 'assetId', 80, ASSET_ID)
      const status = payload.status === undefined ? undefined : oneOf(payload.status, 'status', ['untranslated', 'draft', 'translated', 'reviewed'] as const)
      const currentStageState = payload.currentStageState === undefined ? undefined : oneOf(payload.currentStageState, 'currentStageState', ['untouched', 'draft', 'confirmed'] as const)
      const search = optionalString(payload.search, 'search', 500)?.trim() || undefined
      const { limit, offset } = page(payload, 100)
      const data = service.queryCatWorkspace(id, { assetId: selectedAssetId, status, currentStageState, search, limit, offset, includeIndex: boolean(payload.includeIndex, 'includeIndex', false) })
      return { assets: data.assets.map((asset) => ({ assetId: asset.id, filename: asset.originalFilename, formatId: asset.formatId, segmentCount: asset.segmentCount, sourceSha256: asset.sourceSha256 })), segments: data.segments, segmentIds: data.segmentIds, total: data.total, limit, offset, hasMore: offset + data.segments.length < data.total }
    }
    case 'linguistCatEditSegment': {
      const id = projectId(payload)
      if (typeof payload.target !== 'string') throw new TypeError('target must be a string')
      const result = service.editSegment(id, segmentId(payload), payload.target, revision(payload))
      notify(mutations, id, 'segment-updated', { segmentIds: [result.id] })
      return result
    }
    case 'linguistCatConfirmStage':
    case 'linguistCatUnconfirmStage': {
      const id = projectId(payload)
      const result = operation === 'linguistCatConfirmStage' ? service.confirmCurrentStage(id, segmentId(payload), revision(payload)) : service.unconfirmCurrentStage(id, segmentId(payload), revision(payload))
      notify(mutations, id, 'segment-updated', { segmentIds: [result.id] })
      return result
    }
    case 'linguistCatConfirmStageBulk': {
      const id = projectId(payload)
      if (!Array.isArray(payload.items) || payload.items.length === 0 || payload.items.length > 200) throw new TypeError('items must contain 1-200 entries')
      const items = payload.items.map((item) => { const row = object(item, 'item'); return { segmentId: segmentId(row), expectedRevision: revision(row) } })
      const result = service.confirmCurrentStageBulk(id, items)
      if (result.succeeded.length > 0) notify(mutations, id, 'segment-updated', { segmentIds: result.succeeded.map((item) => item.id) })
      return result
    }
    case 'linguistCatGetContext':
      return service.getSegmentContext(projectId(payload), segmentId(payload))
    case 'linguistCatAddApprovedExemplar': {
      const id = projectId(payload)
      const selectedSegment = segmentId(payload)
      const result = service.addApprovedExemplar(id, { segmentId: selectedSegment, speaker: string(payload.speaker, 'speaker', 200), textType: string(payload.textType, 'textType', 120), note: optionalString(payload.note, 'note', 2000) })
      notify(mutations, id, 'project-updated', { segmentIds: [selectedSegment] })
      return result
    }
    case 'linguistCatRunQa': {
      const id = projectId(payload)
      const findings = service.runQa(id, assetId(payload))
      const severityCounts = { L0: 0, L1: 0, L2: 0, L3: 0, L4: 0 }
      const dispositionCounts = { defect: 0, needs_review: 0, query: 0, info: 0 }
      for (const finding of findings) { severityCounts[finding.severity]++; dispositionCounts[finding.disposition]++ }
      notify(mutations, id, 'qa-updated', { qaFindingIds: findings.map((item) => item.id) })
      return { total: findings.length, severityCounts, dispositionCounts }
    }
    case 'linguistCatListQaFindings': {
      const id = projectId(payload)
      const { limit, offset } = page(payload, 100)
      const result = service.listQaFindings(id, {
        assetId: payload.assetId === undefined ? undefined : string(payload.assetId, 'assetId', 80, ASSET_ID),
        segmentId: payload.segmentId === undefined ? undefined : string(payload.segmentId, 'segmentId', 80, SEGMENT_ID),
        code: optionalString(payload.code, 'code', 120),
        status: payload.status === undefined ? undefined : oneOf(payload.status, 'status', ['open', 'resolved', 'waived'] as const),
        severity: payload.severity === undefined ? undefined : oneOf(payload.severity, 'severity', ['L0', 'L1', 'L2', 'L3', 'L4'] as const),
        disposition: payload.disposition === undefined ? undefined : oneOf(payload.disposition, 'disposition', ['defect', 'needs_review', 'query', 'info'] as const),
        limit, offset,
      })
      return { ...result, limit, offset, hasMore: offset + result.items.length < result.total }
    }
    case 'linguistCatResolveQaFinding': {
      const id = projectId(payload)
      const result = service.resolveQaFinding(id, findingId(payload))
      notify(mutations, id, 'qa-updated', { resolvedQaFindingIds: [result.id] })
      return result
    }
    case 'linguistCatWaiveQaFinding': {
      const id = projectId(payload)
      const result = service.waiveQaFinding(id, findingId(payload), string(payload.reason, 'reason', 500), string(payload.operator, 'operator', 120))
      notify(mutations, id, 'qa-updated', { resolvedQaFindingIds: [result.id] })
      return result
    }
    case 'linguistCatWaiveQaFindingsBulk': {
      const id = projectId(payload)
      const ids = strings(payload.findingIds, 'findingIds', 200, FINDING_ID)
      if (new Set(ids).size !== ids.length) throw new TypeError('findingIds must be unique')
      const result = service.waiveQaFindings(id, ids, string(payload.reason, 'reason', 500), string(payload.operator, 'operator', 120))
      notify(mutations, id, 'qa-updated', { resolvedQaFindingIds: result.map((item) => item.id) })
      return result
    }
    case 'linguistCatGetLatestRunSummary':
      return { summary: service.openProject(projectId(payload)).runs.getLatestRunChangeSummary() ?? null }
    case 'linguistCatGetJob': {
      const id = projectId(payload)
      const sessionId = string(payload.sessionId, 'sessionId', 200)
      await input.assertProjectSession(sessionId, id)
      const job = service.openProject(id).runs.getJob(string(payload.jobId, 'jobId', 1000), { sessionId })
      return { job: job === undefined ? null : {
        jobId: job.jobId, sessionId: job.sessionId, runId: job.runId, status: job.status,
        cursor: job.cursor, total: job.segmentIds.length, completed: job.completedSegmentIds.length, failed: job.failedSegmentIds.length,
      } }
    }
    case 'linguistCatUndoLatestRun': {
      const id = projectId(payload)
      const sessionId = string(payload.sessionId, 'sessionId', 200)
      await input.assertProjectSession(sessionId, id)
      const expectedRunId = string(payload.expectedRunId, 'expectedRunId', 200)
      const runs = service.openProject(id).runs
      const summary = runs.getLatestRunChangeSummary()
      if (summary === undefined || summary.runId !== expectedRunId) throw new TypeError('Latest run changed; refresh before undo')
      const result = runs.undoRun(summary.runId, { actorId: `workbench:${sessionId}` })
      if (result.event !== undefined) notify(mutations, id, 'run-undone', { runId: summary.runId })
      return { runId: result.runId, status: result.status, reverted: result.reverted, refused: result.refused }
    }
    case 'linguistCatListProjectEvents': {
      const id = projectId(payload)
      const afterSequence = integer(payload.afterSequence, 'afterSequence', 0, Number.MAX_SAFE_INTEGER)
      const limit = integer(payload.limit, 'limit', 1, 200, 100)
      const rows = service.openProject(id).runs.listEvents(afterSequence, limit + 1)
      return { events: rows.slice(0, limit).map((event) => ({ ...event, revision: event.sequence, sequence: event.sequence })), hasMore: rows.length > limit }
    }
    case 'linguistCatAckProjectEvents':
      return service.openProject(projectId(payload)).runs.ackEvents(string(payload.consumerId, 'consumerId', 120, /^[A-Za-z0-9][A-Za-z0-9._:-]{0,119}$/), integer(payload.throughSequence, 'throughSequence', 0, Number.MAX_SAFE_INTEGER))
    default:
      return dispatchOtherOperation(input)
  }
}

function outputStatusPolicy(value: unknown): Record<string, Partial<Record<WorkflowStage, string>>> {
  const source = object(value, 'outputStatusPolicy')
  const result: Record<string, Partial<Record<WorkflowStage, string>>> = {}
  for (const [format, raw] of Object.entries(source)) {
    string(format, 'formatId', 64)
    const stages = object(raw, `outputStatusPolicy.${format}`)
    const statuses: Partial<Record<WorkflowStage, string>> = {}
    for (const [name, status] of Object.entries(stages)) statuses[stage(name)] = string(status, 'native status', 64)
    result[format] = statuses
  }
  return result
}

function tagCandidate(value: Data) {
  const kind = oneOf(value.kind, 'candidate.kind', ['standalone', 'opening', 'closing'] as const)
  const evidenceExampleIds = strings(value.evidenceExampleIds, 'candidate.evidenceExampleIds', 50)
  const confidence = value.confidence
  if (typeof confidence !== 'number' || !Number.isFinite(confidence) || confidence < 0 || confidence > 1) throw new TypeError('candidate.confidence must be between 0 and 1')
  return {
    name: string(value.name, 'candidate.name', 80), regex: string(value.regex, 'candidate.regex', 240), kind,
    ...(value.pairKey === undefined ? {} : { pairKey: string(value.pairKey, 'candidate.pairKey', 80) }),
    evidenceExampleIds, confidence, explanation: string(value.explanation, 'candidate.explanation', 500),
  }
}

const pendingImports = new Map<string, { projectId: string; kind: 'xlsx' | 'tm' | 'terms'; sha256: string; xlsxMapping?: XlsxImportMapping }>()

async function importProject(input: DispatchOperationInput): Promise<unknown> {
  const { service, files, payload, mutations } = input
  const id = projectId(payload)
  service.assertProjectWritable(id)
  const tokens = uploadTokens(payload)
  const uploads = tokens.map((token) => readUpload(files, token))
  if (uploads.length > 1 || payload.selection === 'directory') {
    const result = await service.importResourcesFromPaths(id, service.rootDir, { paths: uploads.map((item) => item.path), recursive: false, kind: 'auto', dryRun: false })
    if (result.imported > 0) notify(mutations, id, 'asset-updated')
    return { cancelled: false, bulk: true, ...result }
  }
  const upload = uploads[0]!
  const extension = extname(upload.filename).toLowerCase()
  if (SINGLE_RESOURCE_EXTENSIONS.has(extension)) {
    const result = await service.importResourcesFromPaths(id, service.rootDir, { paths: [upload.path], recursive: false, kind: 'auto', dryRun: false })
    if (result.imported > 0) notify(mutations, id, 'asset-updated')
    return { cancelled: false, bulk: true, ...result }
  }
  const { bytes } = await readPickedFileWithinLimit(upload.path, 50 * 1024 * 1024)
  if (await XLSX_DETECTOR.detect(bytes, upload.filename) > 0) {
    const parsed = await parseXlsxWorkbook(bytes, { filename: upload.filename, maxRowsPerSheet: 50 })
    const matched = await service.matchWorkbookMapping(id, bytes, upload.filename)
    if (matched !== undefined) {
      const mapping = validateXlsxMapping(parsed, matched.mapping)
      const result = await service.importAsset(id, { bytes, filename: upload.filename, xlsxMapping: mapping })
      if (result.status === 'imported') notify(mutations, id, 'asset-updated', { assetIds: [result.assetId] })
      return { cancelled: false, bulk: false, requiresXlsxMapping: false, filename: upload.filename, ...result, mappingUsed: { profileId: matched.profileId, sheetName: mapping.sheetName, columns: mapping.columns } }
    }
    pendingImports.set(tokens[0]!, { projectId: id, kind: 'xlsx', sha256: parsed.report.sourceSha256 })
    return { cancelled: false, bulk: false, requiresXlsxMapping: true, filename: upload.filename, mappingId: tokens[0], sourceSha256: parsed.report.sourceSha256, preview: xlsxPreview(parsed, service.getProject(id)) }
  }
  const result = await service.importAsset(id, { bytes, filename: upload.filename })
  if (result.status === 'imported') notify(mutations, id, 'asset-updated', { assetIds: [result.assetId] })
  return { cancelled: false, bulk: false, requiresXlsxMapping: false, filename: upload.filename, ...result }
}

async function confirmXlsxMapping(input: DispatchOperationInput): Promise<unknown> {
  const { service, files, payload, mutations } = input
  const id = projectId(payload)
  service.assertProjectWritable(id)
  const mappingId = string(payload.mappingId, 'mappingId', 200)
  const sourceSha256 = string(payload.sourceSha256, 'sourceSha256', 64, /^[0-9a-f]{64}$/)
  const pending = pendingImports.get(mappingId)
  if (pending?.projectId !== id || pending.kind !== 'xlsx' || pending.sha256 !== sourceSha256) throw new TypeError('XLSX mapping candidate is missing or bound to another project/source')
  const upload = readUpload(files, mappingId)
  const { bytes } = await readPickedFileWithinLimit(upload.path, 50 * 1024 * 1024)
  if (sha256Hex(bytes) !== sourceSha256) throw new TypeError('XLSX source bytes changed after preview')
  const parsed = await parseXlsxWorkbook(bytes, { filename: upload.filename, maxRowsPerSheet: 50 })
  const selected = object(payload.columns, 'columns')
  const mapping = validateXlsxMapping(parsed, {
    sheetName: string(payload.sheetName, 'sheetName', 512),
    columns: {
      source: string(selected.source, 'columns.source', 512),
      target: string(selected.target, 'columns.target', 512),
      ...(selected.key === undefined ? {} : { key: string(selected.key, 'columns.key', 512) }),
      ...(selected.locked === undefined ? {} : { locked: string(selected.locked, 'columns.locked', 512) }),
      ...(selected.context === undefined ? {} : { context: string(selected.context, 'columns.context', 512) }),
    },
  })
  const rememberMapping = boolean(payload.rememberMapping, 'rememberMapping', false)
  const profile = rememberMapping ? await service.saveWorkbookMappingFromBytes(id, bytes, upload.filename, mapping) : undefined
  const result = await service.importAsset(id, { bytes, filename: upload.filename, xlsxMapping: mapping })
  pendingImports.delete(mappingId)
  files.discardUpload(mappingId)
  if (result.status === 'imported') notify(mutations, id, 'asset-updated', { assetIds: [result.assetId] })
  return { cancelled: false, bulk: false, requiresXlsxMapping: false, filename: upload.filename, ...result, ...(profile === undefined ? {} : { mappingUsed: { profileId: profile.id, sheetName: profile.sheetName, columns: profile.columns } }) }
}

function xlsxPreview(parsed: XlsxWorkbookParseResult, project: LinguistProject): LinguistXlsxMappingPreview {
  const truncated = new Set(parsed.report.sampling.truncatedSheets.map((entry) => entry.sheet))
  return {
    sourceSha256: parsed.report.sourceSha256,
    sheets: parsed.sheets.map((sheet) => {
      const header = sheet.headers[0]
      const normalizedCounts = new Map<string, number>()
      for (const cell of header?.cells ?? []) {
        const normalized = normalizeDelimitedHeader(cell.value)
        if (normalized) normalizedCounts.set(normalized, (normalizedCounts.get(normalized) ?? 0) + 1)
      }
      return {
        name: sheet.name,
        state: sheet.state,
        headerRowNumbers: sheet.headerRowNumbers,
        columns: (header?.cells ?? []).map((cell) => { const normalized = normalizeDelimitedHeader(cell.value); return { index: cell.col, header: cell.value, selectable: normalized !== '' && normalizedCounts.get(normalized) === 1 } }),
        sampleRows: sheet.rows.map((row) => ({ rowNo: row.rowNo, cells: row.cells.map((cell) => ({ columnIndex: cell.col, value: cell.value.slice(0, 400), truncated: cell.value.length > 400 })) })),
        suggestion: suggestProjectWorkbookMapping(sheet, project.sourceLocale, project.targetLocale),
        coverage: { physicalRows: sheet.stats.totalRows, dataRows: sheet.stats.dataRows, nonEmptyDataRows: sheet.stats.nonEmptyDataRows, emptyDataRows: sheet.stats.emptyDataRows, shownSampleRows: sheet.rows.length, truncated: truncated.has(sheet.name) },
        distortion: sheet.distortion,
      }
    }),
    skippedSheets: parsed.skippedSheets,
  }
}

function validateXlsxMapping(parsed: XlsxWorkbookParseResult, mapping: XlsxImportMapping): XlsxImportMapping {
  const matches = parsed.sheets.filter((sheet) => sheet.name === mapping.sheetName)
  if (matches.length !== 1) throw new TypeError('selected XLSX sheet is missing or ambiguous')
  const header = matches[0]!.headers[0]
  if (header === undefined) throw new TypeError('selected XLSX sheet has no header')
  const seen = new Set<string>()
  const columns: XlsxImportMapping['columns'] = { source: '', target: '' }
  for (const role of ['key', 'source', 'target', 'locked', 'context'] as const) {
    const selected = mapping.columns[role]
    if (selected === undefined) continue
    const normalized = normalizeDelimitedHeader(selected)
    const occurrences = header.cells.filter((cell) => normalizeDelimitedHeader(cell.value) === normalized)
    if (normalized === '' || occurrences.length !== 1 || seen.has(normalized)) throw new TypeError(`XLSX ${role} column is missing, ambiguous, or reused`)
    seen.add(normalized)
    columns[role] = selected
  }
  return { sheetName: mapping.sheetName, columns }
}

async function previewManagedFile(files: ManagedFiles, sourcePath: string, filename: string): Promise<LinguistAssetPreviewResult> {
  const ext = extname(filename).toLowerCase()
  if (TEXT_PREVIEW_EXTENSIONS.has(ext)) {
    const { bytes } = await readPickedFileWithinLimit(sourcePath, 50 * 1024 * 1024)
    const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
    return { kind: 'text', text: text.slice(0, 200_000), truncated: text.length > 200_000, filename }
  }
  if (OFFICE_PREVIEW_EXTENSIONS.has(ext)) {
    const { bytes } = await readPickedFileWithinLimit(sourcePath, 50 * 1024 * 1024)
    const converted = await convertOfficePreviewToHtml(bytes, filename)
    return { kind: 'html', ...converted, filename }
  }
  if (LEGACY_OFFICE_PREVIEW_EXTENSIONS.has(ext)) {
    const { bytes } = await readPickedFileWithinLimit(sourcePath, 50 * 1024 * 1024)
    const text = await readOfficePreviewText(bytes)
    return { kind: 'text', text: text.slice(0, 200_000), truncated: text.length > 200_000, filename }
  }
  return { kind: 'url', url: `/la/v1/files/${encodeURIComponent(files.issuePreview(sourcePath, filename))}`, filename, ext: ext.slice(1) }
}

async function dispatchOtherOperation(input: DispatchOperationInput): Promise<unknown> {
  const { operation, payload, service, files, mutations } = input
  switch (operation) {
    case 'linguistProposalsGetDiff': {
      const db = service.openProject(projectId(payload))
      const selected = proposalId(payload)
      const proposal = db.proposals.getById(selected)
      if (proposal === undefined) throw new StoreNotFoundError('proposal', selected)
      const segment = db.segments.getById(proposal.segmentId)
      if (segment === undefined) throw new StoreNotFoundError('segment', proposal.segmentId)
      const issuances = db.proposals.listIssuances(proposal.id)
      return {
        proposal, originalOrdinal: segment.ordinal + 1, source: segment.source,
        currentTarget: segment.target, proposedTarget: proposal.proposedTarget,
        currentRevision: segment.revision, baseRevision: proposal.baseRevision, locked: segment.locked,
        issuanceCount: issuances.length,
        ...(issuances.at(-1) === undefined ? {} : { latestIssuance: issuances.at(-1)! }),
      }
    }
    case 'linguistProposalsApplyTranslations': {
      const id = projectId(payload)
      const mode = oneOf(payload.mode, 'mode', ['apply', 'proposal'] as const, 'apply')
      if (!Array.isArray(payload.edits) || payload.edits.length < 1 || payload.edits.length > 200) throw new TypeError('edits must contain 1-200 items')
      const edits = payload.edits.map((raw, index) => {
        const edit = object(raw, `edits[${index}]`)
        return {
          segmentId: segmentId(edit), baseRevision: integer(edit.baseRevision, 'baseRevision', 0, Number.MAX_SAFE_INTEGER),
          target: string(edit.target, 'target', 100_000),
          ...(edit.note === undefined ? {} : { note: optionalString(edit.note, 'note', 2000) }),
        }
      })
      const db = service.openProject(id)
      const tagProfile = service.getProject(id).tagProfile
      const result = db.proposals.applyTranslations(edits, { mode, ...(tagProfile === undefined ? {} : { tagProfile }) })
      if (result.proposalIds.length > 0) {
        const proposals = result.proposalIds.map(proposalId => db.proposals.getById(proposalId)!)
        notify(mutations, id, mode === 'proposal' ? 'proposal-created' : 'proposal-reviewed', {
          proposalIds: result.proposalIds, segmentIds: proposals.map(proposal => proposal.segmentId),
        })
      }
      return result
    }
    case 'linguistProposalsList': {
      const id = projectId(payload)
      const filter = proposalFilter(payload)
      const db = service.openProject(id)
      if (filter.assetId !== undefined && db.assets.get(filter.assetId) === undefined) throw new StoreNotFoundError('asset', filter.assetId)
      const items = db.proposals.listWithDiffs(filter)
      const total = db.proposals.count(filter)
      return { items, total, limit: filter.limit, offset: filter.offset, hasMore: filter.offset + items.length < total }
    }
    case 'linguistProposalsListPending':
      return service.openProject(projectId(payload)).proposals.listPending()
    case 'linguistProposalsAccept':
    case 'linguistProposalsReject':
    case 'linguistProposalsEditAndAccept':
    case 'linguistProposalsReissue':
    case 'linguistProposalsAcceptSelected':
    case 'linguistProposalsRejectSelected': {
      const id = projectId(payload)
      const db = service.openProject(id)
      const key = string(payload.idempotencyKey, 'idempotencyKey', 128)
      const items = operation.endsWith('Selected') ? proposalItems(payload.items) : [proposalItem(payload)]
      const tagProfile = service.getProject(id).tagProfile
      if (operation === 'linguistProposalsAccept' || operation === 'linguistProposalsAcceptSelected') {
        const mutation = db.proposals.acceptSelected(items, key, tagProfile === undefined ? {} : { tagProfile })
        const { value: values, replayed } = unwrapProposalMutation(mutation)
        if (!replayed) notify(mutations, id, 'proposal-reviewed', { proposalIds: values.map((value) => value.proposal.id), segmentIds: values.map((value) => value.proposal.segmentId) })
        const mapped = values.map((value) => ({ proposal: value.proposal, segmentId: value.segment.id, target: value.segment.target, revision: value.segment.revision }))
        return operation.endsWith('Selected') ? mapped : mapped[0]
      }
      if (operation === 'linguistProposalsReject' || operation === 'linguistProposalsRejectSelected') {
        const mutation = db.proposals.rejectSelected(items, key)
        const { value: values, replayed } = unwrapProposalMutation(mutation)
        if (!replayed) notify(mutations, id, 'proposal-reviewed', { proposalIds: values.map((value) => value.id), segmentIds: values.map((value) => value.segmentId) })
        return operation.endsWith('Selected') ? values : values[0]
      }
      if (operation === 'linguistProposalsEditAndAccept') {
        const mutation = db.proposals.editAndAccept({ ...items[0]!, editedTarget: string(payload.editedTarget, 'editedTarget', 100_000), idempotencyKey: key, ...(tagProfile === undefined ? {} : { tagProfile }) })
        const { value, replayed } = unwrapProposalMutation(mutation)
        if (!replayed) notify(mutations, id, 'proposal-reviewed', { proposalIds: [value.proposal.id], segmentIds: [value.proposal.segmentId] })
        return { proposal: value.proposal, segmentId: value.segment.id, target: value.segment.target, revision: value.segment.revision }
      }
      const mutation = db.proposals.reissueTerminal({ ...items[0]!, idempotencyKey: key, runId: `human-reconcile:${key}`, ...(tagProfile === undefined ? {} : { tagProfile }) })
      const { value, replayed } = unwrapProposalMutation(mutation)
      if (!replayed) notify(mutations, id, 'proposal-created', { proposalIds: [value.id], segmentIds: [value.segmentId] })
      return value
    }
    case 'linguistReferencesQueryTm': {
      const id = projectId(payload)
      const result = service.queryTmReferences(id, { ...page(payload), query: optionalString(payload.query, 'query', 1000)?.trim() || undefined })
      return { ...result, items: result.items.map((item) => ({ id: item.id, source: item.source, target: item.target })), imports: result.imports.map(referenceImportInfo), sources: (result.tmSources ?? []).map(tmSourceInfo) }
    }
    case 'linguistReferencesQueryTerms': {
      const id = projectId(payload)
      const result = service.queryTermReferences(id, { ...page(payload), query: optionalString(payload.query, 'query', 1000)?.trim() || undefined, status: payload.status === undefined ? undefined : termStatus(payload.status) })
      return { ...result, imports: result.imports.map(referenceImportInfo) }
    }
    case 'linguistReferencesUpdateTmSource': {
      const id = projectId(payload)
      const patch = {
        ...(payload.enabled === undefined ? {} : { enabled: boolean(payload.enabled, 'enabled') }),
        ...(payload.priority === undefined ? {} : { priority: integer(payload.priority, 'priority', -1_000_000, 1_000_000) }),
      }
      if (Object.keys(patch).length === 0) throw new TypeError('TM source update requires enabled or priority')
      const result = service.updateTmSource(id, string(payload.sourceId, 'sourceId', 200), patch)
      notify(mutations, id, 'project-updated')
      return tmSourceInfo(result)
    }
    case 'linguistReferencesImport':
      return importReference(input)
    case 'linguistReferencesMapXlsxCandidate':
      return mapReferenceXlsxCandidate(input)
    case 'linguistReferencesConfirmImport':
      return confirmReferenceImport(input)
    case 'linguistReferencesCancelImport': {
      const id = projectId(payload)
      const token = string(payload.candidateId, 'candidateId', 200)
      const kind = referenceKind(payload.kind)
      requirePending(token, id, kind, string(payload.sourceSha256, 'sourceSha256', 64, /^[0-9a-f]{64}$/))
      pendingImports.delete(token)
      files.discardUpload(token)
      return { candidateId: token }
    }
    case 'linguistReferencesPreviewCandidate': {
      const id = projectId(payload)
      service.getProject(id)
      const token = string(payload.candidateId, 'candidateId', 200)
      const kind = referenceKind(payload.kind)
      requirePending(token, id, kind, string(payload.sourceSha256, 'sourceSha256', 64, /^[0-9a-f]{64}$/))
      const upload = readUpload(files, token)
      if (OFFICE_PREVIEW_EXTENSIONS.has(extname(upload.filename).toLowerCase())) return previewManagedFile(files, upload.path, upload.filename)
      const { bytes } = await readPickedFileWithinLimit(upload.path, 512 * 1024 * 1024)
      const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
      return { kind: 'text', text: text.slice(0, 200_000), truncated: text.length > 200_000, filename: upload.filename }
    }
    case 'linguistReferencesUpsertTerm': {
      const id = projectId(payload)
      const result = service.upsertTermReference(id, termInput(payload))
      notify(mutations, id, 'project-updated')
      return result
    }
    case 'linguistReferencesUpsertTerms': {
      const id = projectId(payload)
      if (!Array.isArray(payload.terms) || payload.terms.length === 0 || payload.terms.length > 200) throw new TypeError('terms must contain 1-200 items')
      const saved = service.upsertTermReferences(id, payload.terms.map((value) => termInput(object(value, 'term'))))
      notify(mutations, id, 'project-updated')
      return { terms: saved, count: saved.length }
    }
    case 'linguistReferencesDeleteTerms': {
      const id = projectId(payload)
      const termIds = strings(payload.termIds, 'termIds', 200, TERM_ID)
      if (new Set(termIds).size !== termIds.length) throw new TypeError('termIds must be unique')
      service.deleteTermReferences(id, termIds)
      notify(mutations, id, 'project-updated')
      return { deletedTermIds: termIds, count: termIds.length }
    }
    case 'linguistReferencesValidateTerms': {
      const id = projectId(payload)
      const segmentIds = strings(payload.segmentIds, 'segmentIds', 200, SEGMENT_ID)
      if (new Set(segmentIds).size !== segmentIds.length) throw new TypeError('segmentIds must be unique')
      return service.validateTerms(id, segmentIds)
    }
    case 'linguistReferencesDelete': {
      const id = projectId(payload)
      const kind = referenceKind(payload.kind)
      const refId = string(payload.id, 'id', 80, REFERENCE_ID)
      service.deleteReference(id, kind, refId)
      notify(mutations, id, 'project-updated')
      return { id: refId }
    }
    case 'linguistReferencesListTermConflicts': {
      const id = projectId(payload)
      const statuses = payload.statuses === undefined ? undefined : strings(payload.statuses, 'statuses', 5).map(termStatus)
      const conflicts = service.listTermConflicts(id, {
        statuses,
        module: payload.module === undefined ? undefined : string(payload.module, 'module', 4000).trim(),
        category: payload.category === undefined ? undefined : string(payload.category, 'category', 4000).trim(),
      })
      return { conflicts, count: conflicts.length }
    }
    default:
      return dispatchRemainingOperation(input)
  }
}

function proposalFilter(payload: Data): { assetId?: string; status?: ProposalStatus; limit: number; offset: number } {
  return { ...page(payload, 100), assetId: payload.assetId === undefined ? undefined : string(payload.assetId, 'assetId', 80, ASSET_ID), status: payload.status === undefined ? undefined : oneOf(payload.status, 'status', ['pending', 'accepted', 'rejected', 'superseded', 'expired'] as const) }
}
function proposalItem(payload: Data): ProposalMutationItem { return { proposalId: proposalId(payload), expectedRevision: revision(payload) } }
function proposalItems(value: unknown): ProposalMutationItem[] {
  if (!Array.isArray(value) || value.length === 0 || value.length > 50) throw new TypeError('items must contain 1-50 proposals')
  const items = value.map((item) => proposalItem(object(item, 'item')))
  if (new Set(items.map((item) => item.proposalId)).size !== items.length) throw new TypeError('proposal ids must be unique')
  return items
}
function unwrapProposalMutation<T>(result: { ok: true; result: T; replayed: boolean } | { ok: false; conflict: true }): { value: T; replayed: boolean } {
  if (!result.ok) throw new TypeError('idempotencyKey was already used for another request')
  return { value: result.result, replayed: result.replayed }
}
function termStatus(value: unknown) { return oneOf(value, 'status', ['allowed', 'preferred', 'required', 'forbidden', 'deprecated'] as const) }
function termInput(payload: Data) {
  const note = trimmed(payload.note, 'note', 4000)
  const module = trimmed(payload.module, 'module', 4000)
  const category = trimmed(payload.category, 'category', 4000)
  const imageRef = trimmed(payload.imageRef, 'imageRef', 4000)
  return {
    ...(payload.id === undefined ? {} : { id: string(payload.id, 'id', 80, TERM_ID) }),
    term: string(payload.term, 'term', 1000).trim(), translation: string(payload.translation, 'translation', 1000).trim(),
    status: termStatus(payload.status), caseSensitive: boolean(payload.caseSensitive, 'caseSensitive'),
    ...(note === undefined ? {} : { note }),
    ...(module === undefined ? {} : { module }),
    ...(category === undefined ? {} : { category }),
    ...(imageRef === undefined ? {} : { imageRef }),
  }
}
function referenceImportInfo(source: { id: string; kind: string; originalFilename: string; sourceSha256: string; createdAt: string }) {
  return { id: source.id, kind: source.kind, filename: source.originalFilename, sourceSha256: source.sourceSha256, createdAt: source.createdAt }
}
function tmSourceInfo(source: { id: string; displayName: string; enabled: boolean; priority: number; unitCount: number }) {
  return { id: source.id, displayName: source.displayName, enabled: source.enabled, priority: source.priority, unitCount: source.unitCount }
}
function requirePending(token: string, id: string, kind: 'xlsx' | 'tm' | 'terms', sha256: string) {
  const pending = pendingImports.get(token)
  if (pending?.projectId !== id || pending.kind !== kind || pending.sha256 !== sha256) throw new TypeError('Import candidate is missing or bound to another project/source')
  return pending
}

async function importReference(input: DispatchOperationInput): Promise<unknown> {
  const { payload, service, files } = input
  const id = projectId(payload)
  const kind = referenceKind(payload.kind)
  service.assertProjectWritable(id)
  const tokens = uploadTokens(payload)
  if (tokens.length !== 1) throw new TypeError('Reference import accepts exactly one file')
  const upload = readUpload(files, tokens[0]!)
  const { bytes } = await readPickedFileWithinLimit(upload.path, 512 * 1024 * 1024)
  const project = service.getProject(id)
  const sourceSha256 = sha256Hex(bytes)
  if (await XLSX_DETECTOR.detect(bytes, upload.filename) > 0) {
    const workbook = await parseXlsxWorkbook(bytes, { filename: upload.filename, maxRowsPerSheet: 50 })
    pendingImports.set(tokens[0]!, { projectId: id, kind, sha256: sourceSha256 })
    return { cancelled: false, filename: upload.filename, requiresConfirmation: true, requiresXlsxMapping: true, candidateId: tokens[0], sourceSha256, preview: xlsxPreview(workbook, project) }
  }
  const parsed = kind === 'tm' ? await parseTmReference({ bytes, filename: upload.filename }, project.sourceLocale, project.targetLocale) : await parseTermReference({ bytes, filename: upload.filename }, project.sourceLocale, project.targetLocale)
  const summary = referenceCandidateSummary(kind, parsed.entries, parsed.warnings)
  pendingImports.set(tokens[0]!, { projectId: id, kind, sha256: sourceSha256 })
  return { cancelled: false, filename: upload.filename, requiresConfirmation: true, requiresXlsxMapping: false, candidateId: tokens[0], sourceSha256, summary }
}

async function mapReferenceXlsxCandidate(input: DispatchOperationInput): Promise<unknown> {
  const { payload, service, files } = input
  const id = projectId(payload)
  const kind = referenceKind(payload.kind)
  const token = string(payload.candidateId, 'candidateId', 200)
  const sourceSha256 = string(payload.sourceSha256, 'sourceSha256', 64, /^[0-9a-f]{64}$/)
  const pending = requirePending(token, id, kind, sourceSha256)
  service.assertProjectWritable(id)
  const upload = readUpload(files, token)
  const { bytes } = await readPickedFileWithinLimit(upload.path, 512 * 1024 * 1024)
  if (sha256Hex(bytes) !== sourceSha256) throw new TypeError('Reference candidate bytes changed after preview')
  const workbook = await parseXlsxWorkbook(bytes, { filename: upload.filename, maxRowsPerSheet: 50 })
  const columns = object(payload.columns, 'columns')
  const xlsxMapping = validateXlsxMapping(workbook, { sheetName: string(payload.sheetName, 'sheetName', 512), columns: {
    source: string(columns.source, 'columns.source', 512), target: string(columns.target, 'columns.target', 512),
  } })
  const project = service.getProject(id)
  const file = { bytes, filename: upload.filename, xlsxMapping }
  const parsed = kind === 'tm' ? await parseTmReference(file, project.sourceLocale, project.targetLocale) : await parseTermReference(file, project.sourceLocale, project.targetLocale)
  pending.xlsxMapping = xlsxMapping
  return { cancelled: false, filename: upload.filename, requiresConfirmation: true, requiresXlsxMapping: false, candidateId: token, sourceSha256, summary: referenceCandidateSummary(kind, parsed.entries, parsed.warnings) }
}

async function confirmReferenceImport(input: DispatchOperationInput): Promise<unknown> {
  const { payload, service, files, mutations } = input
  const id = projectId(payload)
  const kind = referenceKind(payload.kind)
  const token = string(payload.candidateId, 'candidateId', 200)
  const sourceSha256 = string(payload.sourceSha256, 'sourceSha256', 64, /^[0-9a-f]{64}$/)
  const pending = requirePending(token, id, kind, sourceSha256)
  service.assertProjectWritable(id)
  const upload = readUpload(files, token)
  const { bytes } = await readPickedFileWithinLimit(upload.path, 512 * 1024 * 1024)
  if (sha256Hex(bytes) !== sourceSha256) throw new TypeError('Reference candidate bytes changed after preview')
  const result = await service.importReference(id, kind, { bytes, filename: upload.filename, xlsxMapping: pending.xlsxMapping })
  if (result.source === undefined) throw new Error('Reference source provenance was not persisted')
  pendingImports.delete(token)
  files.discardUpload(token)
  if (result.imported > 0) notify(mutations, id, 'project-updated')
  return { cancelled: false, requiresConfirmation: false, filename: upload.filename, imported: result.imported, unchanged: result.unchanged, warnings: result.warnings, source: referenceImportInfo(result.source) }
}

function referenceCandidateSummary(kind: 'tm' | 'terms', entries: readonly object[], warnings: readonly string[]) {
  let valuesTruncated = false
  const shorten = (value: string): string => { if (value.length <= 400) return value; valuesTruncated = true; return `${value.slice(0, 400)}…` }
  const samples = entries.slice(0, 20).map((entry) => {
    if (kind === 'tm') {
      const value = entry as { source: string; target: string }
      return { kind, source: shorten(value.source), target: shorten(value.target) }
    }
    const value = entry as { term: string; translation: string; status: string; caseSensitive: boolean; note?: string }
    return { kind, term: shorten(value.term), translation: shorten(value.translation), status: value.status, caseSensitive: value.caseSensitive, ...(value.note === undefined ? {} : { note: shorten(value.note) }) }
  })
  return { entryCount: entries.length, warningCount: warnings.length, warnings: warnings.slice(0, 20).map(shorten), samples, samplesTruncated: entries.length > 20, valuesTruncated }
}

async function dispatchRemainingOperation(input: DispatchOperationInput): Promise<unknown> {
  const { operation, payload, service, files, mutations } = input
  switch (operation) {
    case 'linguistAssetsQuery': {
      const id = projectId(payload)
      const kind = assetKind(payload.kind)
      const query = {
        ...page(payload), query: optionalString(payload.query, 'query', 1000)?.trim() || undefined,
        status: payload.status === undefined ? undefined : oneOf(payload.status, 'status', ['confirmed', 'pending', 'rejected'] as const),
        segmentId: payload.segmentId === undefined ? undefined : segmentId(payload),
      }
      if (query.segmentId !== undefined && kind !== 'contextDocs') throw new TypeError('segmentId is only supported for contextDocs')
      const result = service.queryProjectAssets(id, kind, query)
      return {
        ...result,
        items: result.items.map((item) => {
          if (!('blobRelpath' in item)) return item
          const path = item.kind === 'image' ? service.resolveContextDocBlobPath(id, item.blobRelpath) : undefined
          const previewUrl = path === undefined ? undefined : `/la/v1/files/${encodeURIComponent(files.issuePreview(path, item.originalFilename))}`
          return contextDocInfo(item, previewUrl)
        }),
      }
    }
    case 'linguistAssetsUpsert': {
      const id = projectId(payload)
      const kind = assetKind(payload.kind)
      const item = object(payload.item, 'item')
      let result: unknown
      switch (kind) {
        case 'styleGuideRules':
          result = service.upsertProjectAsset(id, kind, {
            ...(item.id === undefined ? {} : { id: string(item.id, 'item.id', 80, PROJECT_ASSET_ID) }),
            groupKey: trimmed(item.groupKey, 'item.groupKey', 1000),
            ruleText: string(item.ruleText, 'item.ruleText', 4000),
            sourceExample: trimmed(item.sourceExample, 'item.sourceExample', 4000),
            goodExample: trimmed(item.goodExample, 'item.goodExample', 4000),
            badExample: trimmed(item.badExample, 'item.badExample', 4000),
            updatedBy: trimmed(item.updatedBy, 'item.updatedBy', 1000),
          })
          break
        case 'sentencePatterns':
          result = service.upsertProjectAsset(id, kind, {
            ...(item.id === undefined ? {} : { id: string(item.id, 'item.id', 80, PROJECT_ASSET_ID) }),
            textType: trimmed(item.textType, 'item.textType', 1000), module: trimmed(item.module, 'item.module', 1000),
            source: string(item.source, 'item.source', 4000), draftTarget: trimmed(item.draftTarget, 'item.draftTarget', 4000),
            suggestedTarget: trimmed(item.suggestedTarget, 'item.suggestedTarget', 4000), reviewer: trimmed(item.reviewer, 'item.reviewer', 1000),
            ...(item.status === undefined ? {} : { status: oneOf(item.status, 'item.status', ['confirmed', 'pending', 'rejected'] as const) }),
          })
          break
        case 'contextDocs':
          result = contextDocInfo(service.upsertProjectAsset(id, kind, { id: string(item.id, 'item.id', 80, PROJECT_ASSET_ID), note: trimmed(item.note, 'item.note', 4000) }))
          break
        case 'techConstraints': {
          const valueJson = string(item.valueJson, 'item.valueJson', 8000)
          try { JSON.parse(valueJson) } catch { throw new TypeError('item.valueJson must be valid JSON') }
          result = service.upsertProjectAsset(id, kind, {
            ...(item.id === undefined ? {} : { id: string(item.id, 'item.id', 80, PROJECT_ASSET_ID) }),
            kind: oneOf(item.kind, 'item.kind', ['length', 'rich_text', 'tag_note'] as const),
            scope: trimmed(item.scope, 'item.scope', 1000), valueJson, note: trimmed(item.note, 'item.note', 4000),
          })
          break
        }
        case 'voiceProfiles':
          result = service.upsertProjectAsset(id, kind, {
            ...(item.id === undefined ? {} : { id: string(item.id, 'item.id', 80, PROJECT_ASSET_ID) }),
            speaker: string(item.speaker, 'item.speaker', 1000), textType: trimmed(item.textType, 'item.textType', 1000),
            register: trimmed(item.register, 'item.register', 1000), person: trimmed(item.person, 'item.person', 1000),
            toneMarkers: optionalStrings(item.toneMarkers, 'item.toneMarkers', 50, 1000),
            taboos: optionalStrings(item.taboos, 'item.taboos', 50, 1000),
            notes: trimmed(item.notes, 'item.notes', 4000), updatedBy: trimmed(item.updatedBy, 'item.updatedBy', 1000),
          })
      }
      notify(mutations, id, 'asset-updated')
      return result
    }
    case 'linguistAssetsDelete': {
      const id = projectId(payload)
      const selected = string(payload.id, 'id', 80, PROJECT_ASSET_ID)
      service.deleteProjectAsset(id, assetKind(payload.kind), selected)
      notify(mutations, id, 'asset-updated')
      return { id: selected }
    }
    case 'linguistAssetsSetContextDocSegmentLink': {
      const id = projectId(payload)
      const docId = string(payload.docId, 'docId', 80, PROJECT_ASSET_ID)
      const selectedSegment = segmentId(payload)
      const linked = boolean(payload.linked, 'linked')
      service.setContextDocSegmentLink(id, docId, selectedSegment, linked)
      notify(mutations, id, 'asset-updated')
      return { docId, segmentId: selectedSegment, linked }
    }
    case 'linguistAssetsImportContextDoc': {
      const id = projectId(payload)
      service.assertProjectWritable(id)
      const token = exactlyOneUpload(payload)
      const upload = readUpload(files, token)
      const { bytes } = await readPickedFileWithinLimit(upload.path, 512 * 1024 * 1024)
      const note = trimmed(payload.note, 'note', 4000)
      const doc = await service.importContextDoc(id, { bytes, filename: upload.filename, ...(note === undefined ? {} : { note }) })
      files.discardUpload(token)
      notify(mutations, id, 'asset-updated')
      return { cancelled: false, filename: upload.filename, doc: contextDocInfo(doc) }
    }
    case 'linguistAssetsImportSentencePatterns': {
      const id = projectId(payload)
      service.assertProjectWritable(id)
      const token = exactlyOneUpload(payload)
      const upload = readUpload(files, token)
      const { bytes } = await readPickedFileWithinLimit(upload.path, 50 * 1024 * 1024)
      const result = service.importSentencePatterns(id, { bytes, filename: upload.filename })
      files.discardUpload(token)
      if (result.imported > 0) notify(mutations, id, 'asset-updated')
      return { cancelled: false, filename: upload.filename, ...result }
    }
    case 'linguistAssetsPreviewContextDoc': {
      const { sourcePath, originalFilename } = service.resolveContextDocPreviewPath(projectId(payload), string(payload.docId, 'docId', 80, PROJECT_ASSET_ID))
      return previewManagedFile(files, sourcePath, originalFilename)
    }
    case 'linguistExportsList':
      return service.listExportFiles(projectId(payload))
    case 'linguistExportsPrepareAsset': {
      const prepared = await service.prepareDelivery(projectId(payload), assetId(payload))
      return publicPreparation(prepared)
    }
    case 'linguistExportsSaveAsset': {
      const id = projectId(payload)
      const selectedAsset = assetId(payload)
      const validation = oneOf(payload.validation, 'validation', ['verified', 'as-is'] as const, 'verified')
      const prepared = await service.prepareDelivery(id, selectedAsset, validation)
      if (prepared.staged === undefined || prepared.verification === undefined) {
        if (prepared.preflight.qa.openErrors > 0) throw new LinguistExportBlockedByQaError(id, selectedAsset, prepared.preflight.qa.openErrors)
        throw new LinguistDeliveryNotReadyError(id, selectedAsset, prepared.preflight.blockers.length)
      }
      const staged = prepared.staged
      const record = service.listExportFiles(id).find((file) => file.filename === basename(staged.stagingPath) && file.sha256 === staged.artifact.sha256)
      if (record?.projectRevision === undefined || record.verifiedAt === undefined) throw new Error('Export audit manifest does not match staged artifact')
      const token = files.issueDownload(staged.stagingPath, staged.suggestedFilename)
      return {
        token, filename: staged.suggestedFilename, preparation: publicPreparation(prepared),
        artifact: { id: staged.artifact.id, assetId: staged.artifact.assetId, sha256: staged.artifact.sha256, segmentCount: staged.artifact.segmentCount, createdAt: staged.artifact.createdAt },
        delivery: { sha256: staged.artifact.sha256, sizeBytes: record.sizeBytes, verifiedAt: record.verifiedAt, projectRevision: record.projectRevision },
      }
    }
    default:
      throw new TypeError(`Unknown Linguist operation: ${operation}`)
  }
}

function trimmed(value: unknown, field: string, max: number): string | undefined { return optionalString(value, field, max)?.trim() || undefined }
function optionalStrings(value: unknown, field: string, max: number, itemMax: number): string[] | undefined {
  if (value === undefined) return undefined
  if (!Array.isArray(value) || value.length > max) throw new TypeError(`${field} must be a bounded array`)
  return value.map((item) => string(item, `${field} item`, itemMax).trim())
}
function exactlyOneUpload(payload: Data): string {
  const tokens = uploadTokens(payload)
  if (tokens.length !== 1) throw new TypeError('Exactly one file token is required')
  return tokens[0]!
}
function contextDocInfo(doc: ContextDoc, previewUrl?: string) {
  return {
    id: doc.id, kind: doc.kind, originalFilename: doc.originalFilename,
    ...(doc.sha256 === undefined ? {} : { sha256: doc.sha256 }),
    ...(doc.note === undefined ? {} : { note: doc.note }),
    createdAt: doc.createdAt, hasTextExtract: doc.textExtract !== undefined, textExtractLength: doc.textExtract?.length ?? 0,
    ...(previewUrl === undefined ? {} : { previewUrl }),
  }
}

export async function listWorkingCopies(input: Pick<DispatchOperationInput, 'payload' | 'resolveSessionWorkspace'>): Promise<LinguistWorkingCopiesListResult> {
  const sessionId = string(input.payload.sessionId, 'sessionId', 200)
  if (sessionId === '.' || sessionId === '..' || sessionId.includes('/') || sessionId.includes('\\')) throw new TypeError('sessionId is invalid')
  const { workspaceRoot } = await input.resolveSessionWorkspace(sessionId)
  const copiesRoot = join(workspaceRoot, '.linguist', 'working-copies')
  if (!existsSync(copiesRoot)) return { items: [], total: 0, truncated: false }

  const items: LinguistWorkingCopiesListResult['items'] = []
  for (const source of await readdir(copiesRoot, { withFileTypes: true })) {
    if (!source.isDirectory() || !/^[0-9a-f]{64}$/.test(source.name)) continue
    const sourceDir = join(copiesRoot, source.name)
    for (const owner of await readdir(sourceDir, { withFileTypes: true })) {
      if (!owner.isDirectory()) continue
      const sessionDir = join(sourceDir, owner.name)
      for (const file of await readdir(sessionDir, { withFileTypes: true })) {
        if (!file.isFile() || (file.name !== 'bilingual.json' && file.name !== 'result.json')) continue
        const path = join('.linguist', 'working-copies', source.name, owner.name, file.name)
        const snapshot = readWorkingJson(workspaceRoot, path)
        const value = object(snapshot.value, path)
        if (value.schemaVersion !== 1 || value.artifactKind !== 'linguist-working-copy'
          || value.sourceSha256 !== source.name || !Array.isArray(value.segments)) throw new Error(`工作稿格式或来源不一致：${path}`)
        const sourcePath = string(value.sourcePath, 'sourcePath', 4096)
        if (isAbsolute(sourcePath) || sourcePath.split(/[\\/]/u).includes('..')) throw new Error(`工作稿原件路径无效：${path}`)
        const common = {
          path, ownerSessionId: owner.name, sourcePath, sourceSha256: source.name, artifactSha256: snapshot.sha256,
          formatId: string(value.formatId, 'formatId', 100),
          sourceLocale: string(value.sourceLocale, 'sourceLocale', LOCALE_MAX_LENGTH, LOCALE_PATTERN),
          targetLocale: string(value.targetLocale, 'targetLocale', LOCALE_MAX_LENGTH, LOCALE_PATTERN),
          segmentCount: value.segments.length, updatedAt: (await stat(join(sessionDir, file.name))).mtime.toISOString(),
          submitted: false as const,
        }
        if (file.name === 'bilingual.json') {
          items.push({ ...common, kind: 'bilingual', status: 'prepared', finalChangeCount: 0, differenceCount: 0, differencesTruncated: false, differences: [] })
          continue
        }
        const coverage = object(value.coverage, 'coverage')
        const counts = {
          total: integer(coverage.total, 'coverage.total', 0, Number.MAX_SAFE_INTEGER),
          unchanged: integer(coverage.unchanged, 'coverage.unchanged', 0, Number.MAX_SAFE_INTEGER),
          corrected: integer(coverage.corrected, 'coverage.corrected', 0, Number.MAX_SAFE_INTEGER),
          blocked: integer(coverage.blocked, 'coverage.blocked', 0, Number.MAX_SAFE_INTEGER),
          undecided: integer(coverage.undecided, 'coverage.undecided', 0, Number.MAX_SAFE_INTEGER),
        }
        if (counts.total !== value.segments.length || counts.unchanged + counts.corrected + counts.blocked + counts.undecided !== counts.total
          || value.submitted !== false || !Array.isArray(value.finalChanges) || !Array.isArray(value.unresolved)) {
          throw new Error(`工作稿裁定或提交状态无效：${path}`)
        }
        let differencesTruncated = value.finalChanges.length > 20
        const differences = value.finalChanges.slice(0, 20).map((raw, index) => {
          const change = object(raw, `finalChanges[${index}]`)
          if (typeof change.source !== 'string' || typeof change.previousTarget !== 'string' || typeof change.target !== 'string') {
            throw new Error(`工作稿差异格式无效：${path}`)
          }
          if (change.source.length > 160 || change.previousTarget.length > 160 || change.target.length > 160) differencesTruncated = true
          return {
            segmentId: string(change.segmentId, 'segmentId', 80, SEGMENT_ID),
            source: change.source.slice(0, 160), previousTarget: change.previousTarget.slice(0, 160), target: change.target.slice(0, 160),
          }
        })
        items.push({
          ...common, kind: 'result', coverage: counts,
          status: counts.undecided === 0 && counts.blocked === 0 && value.unresolved.length === 0 ? 'coverage-complete' : 'in-progress',
          finalChangeCount: value.finalChanges.length, differenceCount: value.finalChanges.length,
          differencesTruncated, differences, nextAction: string(value.nextAction, 'nextAction', 5000),
        })
      }
    }
  }
  items.sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
  return { items: items.slice(0, 200), total: items.length, truncated: items.length > 200 }
}

function publicPreparation(prepared: Awaited<ReturnType<LinguistProjectService['prepareDelivery']>>) {
  return { validation: prepared.validation, preflight: prepared.preflight, ...(prepared.verification === undefined ? {} : { verification: prepared.verification }), reportMarkdown: prepared.reportMarkdown }
}
