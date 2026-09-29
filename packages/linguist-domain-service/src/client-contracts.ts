/** Browser-safe JSON contracts for the LA workbench, derived from the source product DTOs. */

export interface LinguistProjectMutationEvent {
  projectId: string
  /** 当前 Host 内推送顺序；Client 重连以 sequence 为持久游标。 */
  revision: number
  /** cat.db outbox 的持久序号；旧的人工作业通知可以缺省。 */
  sequence?: number
  kind:
    | 'proposal-created'
    | 'proposal-reviewed'
    | 'segment-updated'
    | 'qa-updated'
    | 'asset-updated'
    | 'project-updated'
    | 'job-updated'
    | 'run-undone'
  runId?: string
  toolCallId?: string
  segmentIds?: readonly string[]
  proposalIds?: readonly string[]
  qaFindingIds?: readonly string[]
  resolvedQaFindingIds?: readonly string[]
  jobId?: string
  job?: {
    status: 'pending' | 'running' | 'paused' | 'completed' | 'failed' | 'cancelled'
    cursor: number
    total: number
    completed: number
    failed: number
  }
}

export const LINGUIST_IPC_ERROR_CODES = {
  // ---- API 边界 ----
  /** 输入校验失败（id/locale/枚举/长度/类型不合规）。 */
  INVALID_INPUT: 'INVALID_INPUT',
  /** 未类型化的意外错误（无 stack / 内部文本泄露）。 */
  INTERNAL: 'INTERNAL',

  // ---- 领域服务 ----
  PROJECT_NOT_FOUND: 'PROJECT_NOT_FOUND',
  PROJECT_ARCHIVED: 'PROJECT_ARCHIVED',
  PROJECT_UNHEALTHY: 'PROJECT_UNHEALTHY',
  IMPORT_TOO_LARGE: 'IMPORT_TOO_LARGE',
  EXPORT_BLOCKED_BY_QA: 'EXPORT_BLOCKED_BY_QA',
  DELIVERY_NOT_READY: 'DELIVERY_NOT_READY',
  CONTEXT_DOC_EXTRACT_FAILED: 'CONTEXT_DOC_EXTRACT_FAILED',
  PROJECT_DELETE_REQUIRES_ARCHIVE: 'PROJECT_DELETE_REQUIRES_ARCHIVE',
  PROJECT_DELETE_CONFIRMATION_MISMATCH: 'PROJECT_DELETE_CONFIRMATION_MISMATCH',
  PROJECT_ORDER_CONFLICT: 'PROJECT_ORDER_CONFLICT',
  SESSION_COPY_BLOCKED: 'SESSION_COPY_BLOCKED',
  IMPORT_VERIFICATION_FAILED: 'IMPORT_VERIFICATION_FAILED',
  IMPORT_UNDO_BLOCKED: 'IMPORT_UNDO_BLOCKED',
  PROJECT_LOCALE_CHANGE_BLOCKED: 'PROJECT_LOCALE_CHANGE_BLOCKED',

  // ---- cat-store 穿透（packages/linguist-cat-store/src/errors.ts）----
  STORE_SQLITE_UNAVAILABLE: 'STORE_SQLITE_UNAVAILABLE',
  STORE_SCHEMA_TOO_NEW: 'STORE_SCHEMA_TOO_NEW',
  STORE_NOT_FOUND: 'STORE_NOT_FOUND',
  STORE_INDEX_CORRUPT: 'STORE_INDEX_CORRUPT',
  STORE_READ_ONLY: 'STORE_READ_ONLY',
  STORE_BUSY: 'STORE_BUSY',
  STORE_PROJECT_EXISTS: 'STORE_PROJECT_EXISTS',
  STORE_ASSET_SOURCE_MISMATCH: 'STORE_ASSET_SOURCE_MISMATCH',
  STORE_BACKUP_CORRUPT: 'STORE_BACKUP_CORRUPT',
  STORE_BACKUP_LEGACY: 'STORE_BACKUP_LEGACY',

  // ---- cat-formats 穿透（packages/linguist-cat-formats/src/errors.ts）----
  FORMAT_PARSE_ERROR: 'FORMAT_PARSE_ERROR',
  FORMAT_EXPORT_ERROR: 'FORMAT_EXPORT_ERROR',
  FORMAT_SEGMENT_LOST: 'FORMAT_SEGMENT_LOST',
  FORMAT_UNSUPPORTED: 'FORMAT_UNSUPPORTED',
  FORMAT_AMBIGUOUS: 'FORMAT_AMBIGUOUS',

  // ---- cat-core domain 穿透（packages/linguist-cat-core/src/errors.ts）----
  SEGMENT_LOCKED: 'SEGMENT_LOCKED',
  REVISION_CONFLICT: 'REVISION_CONFLICT',
  STALE_PROPOSAL: 'STALE_PROPOSAL',
  UNKNOWN_SEGMENT: 'UNKNOWN_SEGMENT',
  INVALID_STATE_TRANSITION: 'INVALID_STATE_TRANSITION',
  INVALID_ID: 'INVALID_ID',
} as const

export type LinguistIpcErrorCode =
  (typeof LINGUIST_IPC_ERROR_CODES)[keyof typeof LINGUIST_IPC_ERROR_CODES]

export type LinguistFormatImportErrorCategory =
  | 'format_mismatch'
  | 'format_ambiguous'
  | 'unsupported_version'
  | 'vendor_structure_incomplete'
  | 'file_corrupt'

interface LinguistFormatParseErrorDetails {
  code: 'FORMAT_PARSE_ERROR'
  category: Extract<
    LinguistFormatImportErrorCategory,
    'unsupported_version' | 'vendor_structure_incomplete' | 'file_corrupt'
  >
  adapterId: string
  filename: string
  detail: string
}

interface LinguistFormatExportErrorDetails {
  code: 'FORMAT_EXPORT_ERROR'
  adapterId: string
  detail: string
}

interface LinguistFormatSegmentLostErrorDetails {
  code: 'FORMAT_SEGMENT_LOST'
  adapterId: string
  missingSegmentIds: readonly string[]
  detail?: string
}

interface LinguistFormatUnsupportedErrorDetails {
  code: 'FORMAT_UNSUPPORTED'
  category: 'format_mismatch'
  filename: string
  triedAdapterIds: readonly string[]
}

interface LinguistFormatAmbiguousErrorDetails {
  code: 'FORMAT_AMBIGUOUS'
  category: 'format_ambiguous'
  filename: string
  score: number
  adapterIds: readonly string[]
}

export type LinguistFormatErrorDetails =
  | LinguistFormatParseErrorDetails
  | LinguistFormatExportErrorDetails
  | LinguistFormatSegmentLostErrorDetails
  | LinguistFormatUnsupportedErrorDetails
  | LinguistFormatAmbiguousErrorDetails

export interface LinguistIpcError {
  code: LinguistIpcErrorCode
  /** 人类可读描述；类型化错误透传其 message，未知错误为通用文案。 */
  message: string
  /**
   * LA-INTAKE-007：类型化错误可选携带的机器可读计数（如 IMPORT_UNDO_BLOCKED
   * 的下游引用计数）。只允许非负整数值；绝无客户文本。
   */
  details?: Record<string, number>
  formatDetails?: LinguistFormatErrorDetails
}

export type LinguistIpcResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: LinguistIpcError }

export interface LinguistProjectInfo {
  schemaVersion: 1 | 2
  id: string
  name: string
  sourceLocale: string
  targetLocale: string
  createdAt: string
  updatedAt: string
  archivedAt?: string
  /** 旧项目可缺省；Host 响应会提供。 */
  workflowStage?: LinguistWorkflowStage
  outputStatusPolicy?: LinguistWorkflowOutputStatusPolicy
  /** 旧项目可缺省；Host 响应会提供。 */
  qaProfile?: LinguistQaProfile
  tagProfile?: LinguistTagProfileInfo
}

export type LinguistTagCandidateKind = 'standalone' | 'opening' | 'closing'

export interface LinguistTagFamilyInfo {
  id: string
  pattern: string
  class: 'paired' | 'singleton'
  kind?: LinguistTagCandidateKind
  pairWith?: string
  note?: string
  enabled?: boolean
  targetLocales?: readonly string[]
  grammar?: {
    kind: 'plural-attributes'
    tagName: string
    argumentAttribute: string
    formAttributes: readonly string[]
  }
}

export interface LinguistTagProfileCandidateInfo {
  id: string
  name: string
  pattern: string
  kind: LinguistTagCandidateKind
  pairKey?: string
  evidenceExampleIds: readonly string[]
  confidence: number
  explanation: string
  status: 'candidate' | 'ignored'
}

export interface LinguistTagProfileInfo {
  families: readonly LinguistTagFamilyInfo[]
  candidates?: readonly LinguistTagProfileCandidateInfo[]
}

export interface LinguistUnknownTagExampleInfo {
  id: string
  segmentId: string
  side: 'source' | 'target'
  value: string
}

export interface LinguistUnknownTagPatternInfo {
  patternShape: string
  examples: LinguistUnknownTagExampleInfo[]
  frequency: number
  sourceTargetPreservation: {
    exactValueRate: number
    shapeRate: number
    countRate: number
  }
  pairingEvidence: { opening: number; closing: number; balanced: boolean; pairKeys: string[] }
  suggestedVariableParts: string[]
}

export const LINGUIST_WORKFLOW_STAGES = ['translation', 'editing', 'proofreading'] as const

export type LinguistWorkflowStage = (typeof LINGUIST_WORKFLOW_STAGES)[number]

export type LinguistCurrentStageState = 'untouched' | 'draft' | 'confirmed'

export type LinguistCurrentStageStateCounts = Record<LinguistCurrentStageState, number>

export const LINGUIST_QA_PROFILES = ['general', 'subtitle'] as const

export type LinguistQaProfile = (typeof LINGUIST_QA_PROFILES)[number]

export interface LinguistWorkflowOutputStatusPolicy {
  [formatId: string]: Partial<Record<LinguistWorkflowStage, string>> | undefined
}

export type LinguistSegmentStatus = 'untranslated' | 'draft' | 'translated' | 'reviewed'

export type LinguistSegmentStatusCounts = Record<LinguistSegmentStatus, number>

export interface LinguistProjectHealthCheckInfo {
  id: 'project_json' | 'cat_db_open' | 'schema_version' | 'asset_sources'
  ok: boolean
  scope: 'complete' | 'sampled'
  checkedItems?: number
  totalItems?: number
  /** 仅含错误码 / 计数，绝无客户文本。 */
  detail?: string
}

export interface LinguistProjectHealthReport {
  kind: 'quick'
  projectId: string
  healthy: boolean
  checkedAt: string
  checks: LinguistProjectHealthCheckInfo[]
}

export interface LinguistImportWarning {
  /** 稳定的 adapter 作用域 code，如 'fake_tsv.empty_key'。 */
  code: string
  message: string
  segmentKey?: string
}

export interface LinguistAssetMetadata {
  assetId: string
  /** 导入时的文件 basename（展示元数据，绝非路径）。 */
  filename: string
  formatId: string
  segmentCount: number
  /** 源字节 SHA-256（hex，64 字符）。 */
  sourceSha256: string
}

export interface LinguistAssetInfo extends LinguistAssetMetadata {
  segmentCounts: LinguistSegmentStatusCounts
  currentStageCounts: LinguistCurrentStageStateCounts
  /** 源文 Unicode 字符数（SQLite length / code point）。 */
  sourceCharacters: number
  /** 当前译文 Unicode 字符数（SQLite length / code point）。 */
  targetCharacters: number
  openQaCount: number
}

export interface LinguistProjectOpenResult {
  project: LinguistProjectInfo
  health: LinguistProjectHealthReport
}

export interface LinguistXlsxMappingColumnPreview {
  /** 0-based physical worksheet column. */
  index: number
  /** Exact header text; this is what a confirmed mapping sends back. */
  header: string
  /** false for blank or normalized-duplicate headers, which are unsafe to persist by name. */
  selectable: boolean
}

export interface LinguistXlsxMappingSampleCell {
  columnIndex: number
  value: string
  truncated: boolean
}

export interface LinguistXlsxMappingSampleRow {
  /** Physical Excel row number, never a display-only ordinal. */
  rowNo: number
  cells: LinguistXlsxMappingSampleCell[]
}

export interface LinguistXlsxMappingSuggestion {
  columns: {
    key?: string
    source?: string
    target?: string
    locked?: string
    context?: string
    speaker?: string
    status?: string
  }
  confidence: number
  reasons: string[]
}

export interface LinguistXlsxMappingPreviewSheet {
  name: string
  state: 'visible' | 'hidden' | 'veryHidden'
  /** Physical header rows returned by the parser; v1 mapping uses the first row. */
  headerRowNumbers: number[]
  columns: LinguistXlsxMappingColumnPreview[]
  sampleRows: LinguistXlsxMappingSampleRow[]
  suggestion: LinguistXlsxMappingSuggestion
  coverage: {
    physicalRows: number
    dataRows: number
    nonEmptyDataRows: number
    emptyDataRows: number
    shownSampleRows: number
    truncated: boolean
  }
  distortion: {
    formulaCells: number
    formulaCellsWithCachedValue: number
    formulaCellsWithoutCachedValue: number
    errorCells: number
    mergedRanges: number
    mergedCoveredCells: number
    phoneticRunsExcluded: number
    ooxmlEscapesRestored: number
  }
}

export interface LinguistXlsxMappingPreview {
  sourceSha256: string
  sheets: LinguistXlsxMappingPreviewSheet[]
  skippedSheets: Array<{ name: string; state: 'visible' | 'hidden' | 'veryHidden'; reason: string }>
}

export interface LinguistXlsxMappingUsedInfo {
  /** Opaque project-local profile id; never a filesystem path. */
  profileId: string
  sheetName: string
  columns: {
    key?: string
    source: string
    target: string
    locked?: string
    context?: string
  }
}

export type LinguistProjectImportResult =
  | { cancelled: true }
  | {
      cancelled: false
      bulk: false
      requiresXlsxMapping: true
      /** Selected basename only; Client never receives the source path. */
      filename: string
      mappingId: string
      sourceSha256: string
      preview: LinguistXlsxMappingPreview
    }
  | {
      cancelled: false
      bulk: false
      requiresXlsxMapping: false
      /** 被选中文件的 basename（展示用元数据；绝非路径）。 */
      filename: string
      status: 'imported' | 'skipped-duplicate'
      assetId: string
      formatId: string
      segmentCount: number
      warnings: LinguistImportWarning[]
      sourceSha256: string
      verification: LinguistImportVerificationReport
      unknownTagSummary: LinguistUnknownTagPatternInfo[]
      /** Present when a saved profile was created or reused for this import. */
      mappingUsed?: LinguistXlsxMappingUsedInfo
    }
  | {
      cancelled: false
      bulk: true
      found: number
      ready: number
      imported: number
      skippedDuplicate: number
      needsInput: number
      unsupported: number
      failed: number
      truncated: boolean
      items: Array<{
        filename: string
        status: 'imported' | 'skipped-duplicate' | 'needs-input' | 'unsupported' | 'failed' | 'ready' | 'supporting'
        resourceKind?: 'batch' | 'tm' | 'terms' | 'context'
        resourceId?: string
        message?: string
        unknownTagSummary?: LinguistUnknownTagPatternInfo[]
      }>
    }

export interface LinguistProjectSummary {
  project: LinguistProjectInfo
  assetCount: number
  totalSegments: number
  segmentCounts: LinguistSegmentStatusCounts
  currentStageCounts: LinguistCurrentStageStateCounts
  /** 已导入资产列表（PB-033；与 assetCount 一致，按创建时间升序）。 */
  assets: LinguistAssetInfo[]
}

export interface LinguistSegmentInfo {
  id: string
  assetId: string
  ordinal: number
  key?: string
  source: string
  target: string
  sourceLocale: string
  targetLocale: string
  status: LinguistSegmentStatus
  /** schema v8 前的线格式可缺省；UI 按 untouched 处理。 */
  currentStageState?: LinguistCurrentStageState
  importedNativeStatus?: string
  locked: boolean
  revision: number
  sourceHash: string
  context?: {
    note?: string
    origin?: string
    meta?: Record<string, string>
  }
}

export interface LinguistCatQueryResult {
  assets: LinguistAssetMetadata[]
  segments: LinguistSegmentInfo[]
  /** 与当前过滤/排序一致的稳定 key 索引；includeIndex=false 时为空数组。 */
  segmentIds: string[]
  total: number
  limit: number
  offset: number
  hasMore: boolean
}

export interface LinguistWorkflowStageEventInfo {
  stage: LinguistWorkflowStage
  action: 'confirmed' | 'unconfirmed' | 'unchanged' | 'corrected' | 'blocked'
  segmentRevision: number
  actor?: string
  createdAt: string
}

export interface LinguistApprovedExemplarInfo {
  id: string
  source: string
  target: string
  sourceLocale: string
  targetLocale: string
  speaker: string
  textType: string
  module?: string
  assetId: string
  segmentId: string
  note?: string
  approvedAt: string
}

export type LinguistQaFindingSeverity = 'L0' | 'L1' | 'L2' | 'L3' | 'L4'

export type LinguistQaFindingStatus = 'open' | 'resolved' | 'waived'

export type LinguistQaFindingDisposition = 'defect' | 'needs_review' | 'query' | 'info'

export type LinguistQaIssueType =
  | 'hallucination' | 'mistranslation' | 'omission' | 'addition'
  | 'terminology_hard' | 'terminology_soft' | 'consistency' | 'style_guide'
  | 'character_voice' | 'register_tone' | 'fluency_readability' | 'grammar_syntax'
  | 'spelling_typo' | 'punctuation_typography' | 'capitalization_case' | 'numbers_units_dates'
  | 'names_titles_honorifics' | 'gender_pronouns' | 'cultural_sensitivity' | 'profanity_rating'
  | 'legal_compliance' | 'format_tags' | 'placeholders_variables' | 'whitespace_linebreaks'
  | 'length_limit' | 'ui_terminology' | 'glossary_conflict' | 'source_issue' | 'other'

export interface LinguistQaFindingInfo {
  id: string
  segmentId: string
  code: string
  severity: LinguistQaFindingSeverity
  issueType: LinguistQaIssueType
  disposition: LinguistQaFindingDisposition
  message: string
  status: LinguistQaFindingStatus
  /** 运行 QA 时的 Segment 修订。 */
  segmentRevision: number
  /** 当前 Segment 修订；Host 实时读取。 */
  currentRevision: number
  waiverReason?: string
  waivedBy?: string
  waivedAt?: string
}

export interface LinguistCatListQaFindingsResult {
  items: LinguistQaFindingInfo[]
  total: number
  limit: number
  offset: number
  hasMore: boolean
}

export interface LinguistCatContextResult {
  segment: LinguistSegmentInfo
  pendingProposal?: LinguistProposalInfo
  qaFindings: LinguistQaFindingInfo[]
  tm: LinguistTmPanelItem[]
  termMatches: LinguistTermMatchInfo[]
  approvedExemplars: LinguistApprovedExemplarInfo[]
  stageEvents?: LinguistWorkflowStageEventInfo[]
}

export type LinguistTmMatchClass =
  | 'double-context'
  | 'context'
  | 'exact'
  | 'near-exact'
  | 'fuzzy'

export type LinguistTmReuseSafety = 'compatible' | 'review'

export interface LinguistTmPanelItem {
  id: string
  matchClass: LinguistTmMatchClass
  score: number
  matchedSource: string
  target: string
  sourceLabel: string
  provenanceCount: number
  badges: string[]
  safety: LinguistTmReuseSafety
  warnings: string[]
  differences: string[]
  variantCount: number
}

export interface LinguistTmReferenceInfo {
  id: string
  source: string
  target: string
}

export type LinguistTermStatus = 'allowed' | 'preferred' | 'required' | 'forbidden' | 'deprecated'

export type LinguistTermMatchType = 'exact' | 'contains'

export interface LinguistTermInfo {
  id: string
  term: string
  translation: string
  status: LinguistTermStatus
  caseSensitive: boolean
  note?: string
  /** PB-095：所属模块/分类/配图（blobs/ 相对路径），可空标注。 */
  module?: string
  category?: string
  imageRef?: string
}

export interface LinguistTermMatchInfo extends LinguistTermInfo {
  matchType: LinguistTermMatchType
  /** 多个 preferred 项给同一术语不同译文时只标冲突，不擅自选第一条。 */
  conflict: boolean
  start: number
  end: number
  lowDiscrimination: boolean
}

export interface LinguistReferenceQueryResult<T> {
  items: T[]
  total: number
  limit: number
  offset: number
  hasMore: boolean
  /** 当前 TM/TB 类别的文件导入来源；仅含安全展示元数据。 */
  imports?: LinguistReferenceImportInfo[]
  /** TM 来源管理摘要；术语库和项目资产查询不填写。 */
  sources?: LinguistTmSourceInfo[]
}

export interface LinguistTmSourceInfo {
  id: string
  displayName: string
  enabled: boolean
  priority: number
  unitCount: number
}

export interface LinguistReferenceImportInfo {
  id: string
  kind: 'tm' | 'terms'
  filename: string
  sourceSha256: string
  createdAt: string
}

export interface LinguistTmReferenceCandidateSample {
  kind: 'tm'
  source: string
  target: string
}

export interface LinguistTermReferenceCandidateSample {
  kind: 'terms'
  term: string
  translation: string
  status: LinguistTermStatus
  caseSensitive: boolean
  note?: string
}

export type LinguistReferenceCandidateSample =
  | LinguistTmReferenceCandidateSample
  | LinguistTermReferenceCandidateSample

export interface LinguistReferenceCandidateSummary {
  entryCount: number
  warningCount: number
  warnings: string[]
  samples: LinguistReferenceCandidateSample[]
  samplesTruncated: boolean
  valuesTruncated: boolean
}

export type LinguistReferenceImportResult =
  | { cancelled: true }
  | {
      cancelled: false
      requiresConfirmation: true
      filename: string
      candidateId: string
      sourceSha256: string
      summary: LinguistReferenceCandidateSummary
    }
  | {
      cancelled: false
      requiresConfirmation: false
      filename: string
      imported: number
      unchanged: number
      warnings: string[]
      source: LinguistReferenceImportInfo
    }

export interface LinguistStyleGuideRuleInfo {
  id: string
  groupKey?: string
  ruleText: string
  sourceExample?: string
  goodExample?: string
  badExample?: string
  /** blobs/ 相对路径；Client 不开放写入。 */
  screenshotRef?: string
  updatedAt: string
  updatedBy?: string
}

export type LinguistSentencePatternStatus = 'confirmed' | 'pending' | 'rejected'

export interface LinguistSentencePatternInfo {
  id: string
  textType?: string
  module?: string
  source: string
  draftTarget?: string
  suggestedTarget?: string
  reviewer?: string
  status: LinguistSentencePatternStatus
  createdAt: string
  updatedAt: string
}

export type LinguistContextDocKind = 'doc' | 'image'

export interface LinguistContextDocInfo {
  id: string
  kind: LinguistContextDocKind
  /** 导入时的文件 basename（元数据，不是路径）。 */
  originalFilename: string
  sha256?: string
  note?: string
  createdAt: string
  /** 是否有可经 cat_read_context_doc 阅读的纯文本抽取。 */
  hasTextExtract: boolean
  textExtractLength: number
  /** 仅图片资源下发：DSH Host 发放的本地受控 URL，不包含绝对文件路径。 */
  previewUrl?: string
}

export type LinguistTechConstraintKind = 'length' | 'rich_text' | 'tag_note'

export interface LinguistTechConstraintInfo {
  id: string
  kind: LinguistTechConstraintKind
  /** 作用域（text_type 或资产级；可空 = 全局）。 */
  scope?: string
  valueJson: string
  note?: string
  updatedAt: string
}

export interface LinguistVoiceProfileInfo {
  id: string
  speaker: string
  textType?: string
  register?: string
  person?: string
  toneMarkers?: string[]
  taboos?: string[]
  notes?: string
  updatedAt: string
  updatedBy?: string
}

export type LinguistProjectAssetInfo =
  | LinguistStyleGuideRuleInfo
  | LinguistSentencePatternInfo
  | LinguistContextDocInfo
  | LinguistTechConstraintInfo
  | LinguistVoiceProfileInfo

export type LinguistAssetsQueryResult = LinguistReferenceQueryResult<LinguistProjectAssetInfo>

export interface LinguistBackupInfo {
  name: string
  /** directory = 新格式（可恢复）；legacy = PB-024 两文件旧格式（仅可预览）。 */
  format: 'directory' | 'legacy'
  createdAt?: string
  sizeBytes: number
  schemaVersion?: number
  method?: 'vacuum_into' | 'backup_api'
  fileCount?: number
}

export interface LinguistExternalBackupImportResult {
  project: LinguistProjectInfo & { workspaceId: string }
  /** Path chosen inside the DSH Workspace, relative to its canonical root. */
  importedFrom: string
  /** cat.db schema after opening the imported project. */
  schemaVersion: number
}

export type LinguistMigrationDisposition = 'imported' | 'partial' | 'archived-only' | 'quarantined' | 'error'

export interface LinguistMigrationHealthSignal {
  severity: 'info' | 'warning' | 'error'
  message: string
}

export interface LinguistMigrationScannedProject {
  projectId: string
  name: string
  sourceLocale: string | null
  targetLocale: string | null
  batches: number
  segments: number
  tmEntries: number | null
  termEntries: number | null
  chatPresent: boolean
  orphan: boolean
  health: LinguistMigrationHealthSignal[]
}

export interface LinguistMigrationScanResult {
  schemaVersion: 1 | 2
  projects: LinguistMigrationScannedProject[]
  health: LinguistMigrationHealthSignal[]
  totals: { projects: number; batches: number; segments: number }
}

export interface LinguistMigrationWorkspaceScanResult extends LinguistMigrationScanResult {
  scanId: string
  rootPath: string
}

export interface LinguistMigrationImportOptions {
  externalSource?: 'copy' | 'reference'
  salvageOrphan?: boolean
}

export interface LinguistMigrationProgress {
  projectId: string
  phase: 'import' | 'verify'
  index: number
  total: number
}

export interface LinguistMigrationVerifyCheck {
  id: 'transcript-rerender' | 'transcript-bytes' | 'store-reopen' | 'store-assets' | 'store-references' | 'store-qa'
  ok: boolean
  detail: string
}

export interface LinguistMigrationVerifyResult {
  status: 'passed' | 'failed' | 'skipped'
  checks: LinguistMigrationVerifyCheck[]
}

export interface LinguistMigrationProjectReport {
  legacyProjectId: string
  newProjectId: string
  projectName: string
  disposition: LinguistMigrationDisposition
  targetConflict: boolean
  refusal: { reason: string; evidence?: Record<string, unknown> } | null
  totals: {
    assets: number
    segments: number
    tmImported: number
    termsImported: number
    qaOpen: number
    qaWaived: number
  }
  transcript: { path: string; sha256: string; sessions: number; rows: number } | null
  archivesWritten: number
  rollback: string[]
  notes: string[]
  verify: LinguistMigrationVerifyResult
}

export interface LinguistMigrationReport {
  counts: Record<LinguistMigrationDisposition, number>
  projects: LinguistMigrationProjectReport[]
}

export type LinguistDeliveryBlockerCode =
  | 'PENDING_PROPOSALS'
  | 'UNCONFIRMED_SEGMENTS'
  | 'OPEN_QA_ERRORS'
  | 'PHRASE_MASTER_MAPPING'
  | 'STRUCTURAL_RULES'
  | 'EVIDENCE_STAGE_STALE'
  | 'EVIDENCE_REQUIRED_PENDING'
  | 'EVIDENCE_BLOCKING_GAPS'

export interface LinguistDeliveryBlockerInfo {
  code: LinguistDeliveryBlockerCode
  count: number
  message: string
}

export interface LinguistDeliveryQaSummary {
  openErrors: number
  openWarnings: number
  waived: number
  bySeverity: Record<LinguistQaFindingSeverity, number>
}

export interface LinguistDeliveryEvidenceSummary {
  status: 'not-applicable' | 'in-progress' | 'blocked' | 'stale' | 'complete'
  stageRuns: number
  required: number
  presented: number
  pending: number
  gaps: Array<{
    code: string
    severity: 'blocking' | 'warning'
    summary: string
    suggestedAction: string
  }>
}

export interface LinguistDeliveryPreflight {
  projectId: string
  assetId: string
  filename: string
  formatId: string
  workflowStage: LinguistWorkflowStage
  expectedNativeStatus?: string
  segmentCount: number
  stageCounts: LinguistCurrentStageStateCounts
  lockedSegments: number
  unconfirmedUnlockedSegments: number
  pendingProposalCount: number
  qa: LinguistDeliveryQaSummary
  evidence: LinguistDeliveryEvidenceSummary
  ready: boolean
  blockers: LinguistDeliveryBlockerInfo[]
}

export interface LinguistDeliveryVerification {
  verifiedSegments: number
  verifiedSourceSegments: number
  verifiedTargetSegments: number
  verifiedNativeStatusSegments: number
  changedTargetSegments: number
  changedNativeStatusSegments: number
  tagsPreserved: boolean
  sha256: string
  suggestedFilename: string
}

export interface LinguistPrepareDeliveryResult {
  validation: 'verified' | 'as-is'
  preflight: LinguistDeliveryPreflight
  verification?: LinguistDeliveryVerification
  reportMarkdown: string
}

export interface LinguistExportFileInfo {
  filename: string
  /** 解析得出的来源资产 id；文件名不符 staging 形状时缺省。 */
  assetId?: string
  sizeBytes: number
  /** epoch ms。 */
  modifiedAt: number
  /** manifest 校验通过时提供；历史或损坏 manifest 缺省。 */
  sha256?: string
  createdAt?: string
  verifiedAt?: string
  projectRevision?: string
  /** true 表示项目段 revision/状态已晚于该交付物。 */
  stale?: boolean
}

export type LinguistProposalStatus =
  | 'pending'
  | 'accepted'
  | 'rejected'
  | 'superseded'
  | 'expired'

export interface LinguistProposalInfo {
  id: string
  segmentId: string
  baseRevision: number
  proposedTarget: string
  evidenceRefs: string[]
  termRefs: string[]
  warnings: string[]
  modelId?: string
  sessionId?: string
  runId?: string
  reissuedFromProposalId?: string
  supersedesProposalId?: string
  createdAt: string
  status: LinguistProposalStatus
}

export interface LinguistProposalIssuanceInfo {
  id: string
  proposalId: string
  idempotencyKey?: string
  sessionId?: string
  runId?: string
  toolCallId?: string
  modelProvider?: string
  modelId?: string
  runtime?: string
  strategy?: 'fast' | 'balanced' | 'best'
  linguistPromptVersion?: string
  promptHash?: string
  projectDigestHash?: string
  projectDigestRevision?: string
  turnContextVersion?: number
  turnContextSnapshot?: string
  turnContextHash?: string
  toolsetHash?: string
  evidenceRefs: string[]
  termRefs: string[]
  createdAt: string
}

export interface LinguistProposalDiff {
  proposal: LinguistProposalInfo
  originalOrdinal: number
  source: string
  currentTarget: string
  proposedTarget: string
  currentRevision: number
  baseRevision: number
  locked: boolean
  /** Provenance may be absent when no issuance was recorded. */
  issuanceCount?: number
  latestIssuance?: LinguistProposalIssuanceInfo
}

export interface LinguistProposalListResult {
  /** Proposal + current Segment snapshot, projected by one Store JOIN query. */
  items: LinguistProposalDiff[]
  total: number
  limit: number
  offset: number
  hasMore: boolean
}

export interface LinguistProposalGetDiffRequest {
  projectId: string
  proposalId: string
}

export type LinguistProposalGetDiffResult = LinguistProposalDiff

export interface LinguistApplyTranslationEdit {
  segmentId: string
  baseRevision: number
  target: string
  note?: string
}

export interface LinguistApplyTranslationsRequest {
  projectId: string
  edits: LinguistApplyTranslationEdit[]
  mode?: 'apply' | 'proposal'
}

export interface LinguistApplyTranslationsResult {
  requested: number
  applied: number
  pending: number
  stale: string[]
  locked: string[]
  failed: Array<{ segmentId: string; code: string }>
  proposalIds: string[]
  appliedItems?: Array<{ segmentId: string; proposalId: string; baseRevision: number; revision: number }>
}

export interface LinguistImportVerificationCheck {
  id: 'segment-count' | 'format' | 'language-pair' | 'source-hash'
  passed: boolean
  detail: string
}

export interface LinguistImportVerificationReport {
  ok: boolean
  checks: LinguistImportVerificationCheck[]
}

export interface LinguistCatStageMutationFailure {
  segmentId: string
  code: string
  message: string
}

export interface LinguistCatConfirmStageBulkResult {
  succeeded: LinguistSegmentInfo[]
  failed: LinguistCatStageMutationFailure[]
}

export interface LinguistRunChangeSummary {
  schemaVersion: 1
  projectId: string
  runId: string
  job?: {
    jobId: string
    status: 'pending' | 'running' | 'paused' | 'completed' | 'failed' | 'cancelled'
    scopedSegments: number
    cursor: number
    completedSegments: number
    failedSegments: number
  }
  mutationCount: number
  changes: {
    proposalsCreated: number
    qaFindingsCreated: number
    qaFindingsUpdated: number
    filesTouched: number
    total: number
    undone: number
  }
  eventSequence?: { first: number; last: number }
  canUndo: boolean
}

export interface LinguistLatestRunSummaryResult {
  summary: LinguistRunChangeSummary | null
}

export interface LinguistRunUndoResult {
  runId: string
  status: 'completed' | 'partial' | 'refused' | 'already-undone'
  reverted: Array<{
    entityType: 'segment' | 'proposal' | 'qa-finding' | 'file' | 'legacy-record'
    entityId: string
  }>
  refused: Array<{
    entityType: 'segment' | 'proposal' | 'qa-finding' | 'file' | 'legacy-record'
    entityId: string
    reason: string
  }>
}

export interface LinguistStageDecisionCoverage {
  total: number
  confirmed: number
  unchanged: number
  corrected: number
  blocked: number
  pending: number
  status: 'in_progress' | 'complete' | 'completed_with_blocks'
}

export interface LinguistTermConflictInfo {
  normalizedTerm: string
  entries: LinguistTermInfo[]
}

export interface LinguistTermConflictsResult {
  conflicts: LinguistTermConflictInfo[]
  count: number
}

/** 受管原件预览：文本截断、Office HTML，或 DSH Host 签发的本地 URL。 */
export type LinguistAssetPreviewResult =
  | { kind: 'text'; text: string; truncated: boolean; filename: string }
  | { kind: 'html'; html: string; text?: string; filename: string }
  | { kind: 'url'; url: string; filename: string; ext: string }

export interface LinguistFormatQualification {
  formatId: string
  extensions: readonly string[]
  internalVerification: 'passed' | 'failed'
  platformQualification: 'unverified' | 'real_file_passed' | 'platform_roundtrip_passed' | 'native_target_passed'
}

export interface LinguistWorkingCopiesListResult {
  items: Array<{
    path: string
    ownerSessionId: string
    sourcePath: string
    sourceSha256: string
    artifactSha256: string
    kind: 'bilingual' | 'result'
    formatId: string
    sourceLocale: string
    targetLocale: string
    segmentCount: number
    status: 'prepared' | 'in-progress' | 'coverage-complete'
    coverage?: { total: number; unchanged: number; corrected: number; blocked: number; undecided: number }
    finalChangeCount: number
    differenceCount: number
    differencesTruncated: boolean
    differences: Array<{ segmentId: string; source: string; previousTarget: string; target: string }>
    nextAction?: string
    updatedAt: string
    submitted: false
  }>
  total: number
  truncated: boolean
}

export interface LinguistProjectReorderRequest {
  orderedProjectIds: string[]
}

export type LinguistProjectReorderResult = LinguistProjectInfo[]

export interface LinguistTermsDeleteRequest {
  projectId: string
  termIds: string[]
}

export interface LinguistTermsDeleteResult {
  deletedTermIds: string[]
  count: number
}

export interface LinguistTermsValidateRequest {
  projectId: string
  segmentIds: string[]
}

export interface LinguistTermsValidateResult {
  missingRequired: Array<{ segmentId: string; termId: string; term: string; expected: string }>
  forbiddenHits: Array<{ segmentId: string; termId: string; forbidden: string }>
  preferredNotUsed: Array<{ segmentId: string; termId: string; term: string; preferred: string }>
  unresolvedConflicts: Array<{ segmentId: string; term: string; termIds: string[] }>
}

export interface LinguistTurnContextV1 {
  schemaVersion: 1
  projectId: string
  assetId?: string
  activeSegmentId?: string
  selectedSegmentIds: readonly string[]
  activeQaFindingId?: string
  selectionTruncated?: true
  capturedAt: string
  uiRevision: number
}

export interface LinguistTurnContextPrepareResult {
  requestId: string
  context: LinguistTurnContextV1
  selectionTruncated: boolean
}

export type LinguistScheduleTiming =
  | { kind: 'after' | 'every'; seconds: number }
  | { kind: 'at'; at: string }
  | { kind: 'daily'; time: string; timeZone: string }
  | { kind: 'weekly'; time: string; timeZone: string; weekdays: number[] }
  | { kind: 'cron'; expression: string; timeZone: string }

export interface LinguistScheduleCreateRequest {
  sessionId: string
  projectId: string
  title: string
  prompt: string
  executeAtDue: true
  scope: 'project' | 'asset' | 'segments'
  turnContext?: LinguistTurnContextV1
  timing: LinguistScheduleTiming
  maxRuns?: number
}

export interface LinguistScheduleCreateResult {
  scheduleId: string
  sessionId: string
  projectId: string
  title: string
  prompt: string
  kind: LinguistScheduleTiming['kind']
  scheduledAt: string
  role: 'general' | 'translator' | 'reviewer' | 'proofreader'
  scope: LinguistScheduleCreateRequest['scope']
  executeAtDue: true
  version: string
}

export interface LinguistScheduleInfo extends LinguistScheduleCreateResult {
  maxRuns?: number
  runCount: number
  limitReached: boolean
  consecutiveFailures: number
  pausedAfterFailures: boolean
  timing: LinguistScheduleTiming
  scopeSnapshot: { assetId?: string; selectedSegmentIds: string[] }
  status: 'active' | 'inactive'
  authorizationStatus: 'ready' | 'changed' | 'pending-update'
  lastDeliveredAt?: string
}

export interface LinguistScheduleListResult { items: LinguistScheduleInfo[] }

export interface LinguistScheduleUpdateRequest extends LinguistScheduleCreateRequest {
  scheduleId: string
  expectedVersion: string
}

export interface LinguistScheduleCancelResult { scheduleId: string; cancelled: boolean }

export interface LinguistScheduleHistoryResult {
  scheduleId: string
  executions: Array<{ turn: number; messageId: string; admittedAt: string; endedAt?: string; outcome: string; failure?: { code: string; status?: number } }>
  records: Array<{ scheduledAt: string; deliveredAt: string; messageId: string; prompt?: string }>
  earlierRecordsUnavailable: boolean
  earlierRecordsPruned: boolean
  nextBefore?: string
}

export interface LinguistSessionDetachBindingResult {
  sessionId: string
  detached: boolean
  cancelledScheduleIds: string[]
  historicalEvidencePreserved: true
}
