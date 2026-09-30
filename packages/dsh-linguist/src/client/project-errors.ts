import type { LinguistIpcErrorCode, LinguistProjectHealthCheckInfo } from '@linguist/domain-service/contracts'
import { LinguistRequestError } from './api'

type Translate = (key: string, params?: Record<string, unknown>) => string

const messages: Record<LinguistIpcErrorCode, string> = {
  INVALID_INPUT: '输入不符合要求', INTERNAL: '发生内部错误，请重试',
  PROJECT_NOT_FOUND: '项目不存在或已被移除', PROJECT_ARCHIVED: '项目已归档，无法执行写操作',
  PROJECT_UNHEALTHY: '项目数据未通过健康检查，需要修复', IMPORT_TOO_LARGE: '导入文件超过大小限制',
  EXPORT_BLOCKED_BY_QA: '仍有阻断级 QA 问题，请先修复或填写豁免理由',
  DELIVERY_NOT_READY: '交付预检尚未通过，请处理建议、确认句段和阻断级 QA',
  CONTEXT_DOC_EXTRACT_FAILED: 'Context 文档文本提取失败；请检查文件是否损坏、加密或仅含图片',
  PROJECT_DELETE_REQUIRES_ARCHIVE: '请先归档项目，再执行删除',
  PROJECT_DELETE_CONFIRMATION_MISMATCH: '项目名称确认不匹配，已取消删除',
  PROJECT_ORDER_CONFLICT: '项目顺序已变化，请刷新后重试',
  SESSION_COPY_BLOCKED: '当前会话状态不能安全复制到其他项目',
  SESSION_COPY_FAILED: '会话复制未完成',
  IMPORT_VERIFICATION_FAILED: '导入未通过回读验证，已整批回滚',
  IMPORT_UNDO_BLOCKED: '该批次已有下游工作引用，无法撤销导入',
  PROJECT_LOCALE_CHANGE_BLOCKED: '项目已有批次或 TM/TB，语言方向已冻结；请新建项目',
  STORE_SQLITE_UNAVAILABLE: '本机 SQLite 运行时不可用，项目数据库暂无法访问',
  STORE_SCHEMA_TOO_NEW: '项目数据由更新版本创建，请升级应用后再打开',
  STORE_NOT_FOUND: '项目存储不存在', STORE_INDEX_CORRUPT: '项目索引损坏',
  STORE_READ_ONLY: '项目存储为只读，无法写入', STORE_BUSY: '项目数据正被占用，请稍后重试',
  STORE_PROJECT_EXISTS: '同名项目已存在',
  STORE_ASSET_SOURCE_MISMATCH: '批次源文件校验不一致',
  STORE_BACKUP_CORRUPT: '备份未通过完整性校验，已拒绝恢复',
  STORE_BACKUP_LEGACY: '旧格式备份缺少完整性清单与源文件，不支持恢复',
  FORMAT_PARSE_ERROR: '文件解析失败', FORMAT_EXPORT_ERROR: '导出失败',
  FORMAT_SEGMENT_LOST: '导出会丢失句段，已中止', FORMAT_UNSUPPORTED: '不支持的文件格式',
  FORMAT_AMBIGUOUS: '文件格式存在歧义', SEGMENT_LOCKED: '句段已锁定',
  REVISION_CONFLICT: '内容已被其他操作修改，请刷新后重试',
  STALE_PROPOSAL: '建议已过期', UNKNOWN_SEGMENT: '句段不存在',
  INVALID_STATE_TRANSITION: '不允许的状态变更', INVALID_ID: 'ID 格式不合法',
}

const referenceLabels: Record<string, string> = {
  proposals: '建议', qaFindings: 'QA', legacyCriticArtifacts: '历史评审件',
  exports: '导出', editedSegments: '人工编辑段',
}

export function describeProjectError(cause: unknown, t: Translate): string {
  if (!(cause instanceof LinguistRequestError)) return String(cause)
  const error = cause.detail
  const details = error.formatDetails
  if (details) {
    let description: string
    switch (details.code) {
      case 'FORMAT_UNSUPPORTED':
        description = t('文件 {filename} 的扩展名与内容不匹配；已尝试 {adapters}。请确认来源格式。', { filename: details.filename, adapters: details.triedAdapterIds.join('、') })
        break
      case 'FORMAT_AMBIGUOUS':
        description = t('文件 {filename} 同时符合多种格式：{adapters}；请确认来源格式。', { filename: details.filename, adapters: details.adapterIds.join('、') })
        break
      case 'FORMAT_PARSE_ERROR':
        description = t('文件 {filename} 解析失败（{category}）：{detail}', { filename: details.filename, category: details.category, detail: details.detail })
        break
      case 'FORMAT_EXPORT_ERROR':
        description = t('导出失败：{detail}', { detail: details.detail })
        break
      case 'FORMAT_SEGMENT_LOST':
        description = t('导出将丢失 {count} 段，已中止。{detail}', { count: details.missingSegmentIds.length, detail: details.detail ?? '' })
        break
    }
    return `${description} (${error.code})`
  }
  const base = t(messages[error.code])
  if (error.code === 'SESSION_COPY_FAILED' && error.sessionCopyDetails) {
    const { sessionId, cleanup } = error.sessionCopyDetails
    const detail = { 'not-started': '历史复制失败，尚未建立可用副本。', completed: 'Linguist 绑定已清理，副本已归档，可从原生归档恢复。', failed: '副本清理或归档失败，请检查此会话后再重试。' }[cleanup]
    return `${base}：${t(detail)} ${t('复制会话 ID')} ${sessionId} (${error.code})`
  }
  if (error.code === 'IMPORT_UNDO_BLOCKED' && error.details) {
    const references = Object.entries(referenceLabels)
      .filter(([key]) => (error.details?.[key] ?? 0) > 0)
      .map(([key, label]) => t('{label} {count} 条', { label: t(label), count: error.details![key] }))
    if (references.length) return `${base}：${references.join('、')} (${error.code})`
  }
  if (error.code === 'INVALID_INPUT' || error.code === 'CONTEXT_DOC_EXTRACT_FAILED') return `${base}：${error.message} (${error.code})`
  return `${base} (${error.code})`
}

const healthLabels: Record<LinguistProjectHealthCheckInfo['id'], string> = {
  project_json: '项目元数据', cat_db_open: '翻译数据库',
  schema_version: '数据库版本', asset_sources: '批次源文件抽样',
}

export function describeHealthCheck(check: LinguistProjectHealthCheckInfo, t: Translate): string {
  const scope = check.scope === 'sampled' ? ` · ${t('抽样')} ${check.checkedItems ?? 0}/${check.totalItems ?? 0}` : ''
  return `${t(healthLabels[check.id])}${scope}${check.detail ? ` · ${check.detail}` : ''}`
}
