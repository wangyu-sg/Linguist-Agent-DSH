import * as React from 'react'
import { Button, Checkbox, Modal } from '@deepseek-ai/dsh-client-ui-primitives'
import type { LinguistImportProgress, LinguistProjectImportResult, LinguistXlsxMappingPreviewSheet } from '@linguist/domain-service/contracts'
import { discardStagedFiles, required, stageFiles, subscribeImport } from './api'
import { describeProjectError } from './project-errors'
import { describeLinguistFormat, isGenericXliffFallback } from './format-labels'
import { useT } from './ui-locale'
import styles from './Panels.module.css'

const phaseLabels = { uploading: '上传文件', connecting: '连接导入服务', reading: '读取文件', matching: '核对 Phrase 配套文件', parsing: '解析句段与文件结构', writing: '写入并核对导入结果', scanning: '检查标签' }
const statusLabels = { imported: '已导入', 'skipped-duplicate': '已存在，跳过重复', 'needs-input': '需要处理', unsupported: '格式不支持', failed: '导入失败', ready: '可导入', supporting: '已作为配套文件使用' }
type Progress = Omit<LinguistImportProgress, 'phase'> & { phase: keyof typeof phaseLabels; fraction?: number; since: number }

function suggestedXlsxColumns(sheet: LinguistXlsxMappingPreviewSheet | undefined): { key: string; source: string; target: string; locked: string; context: string } {
  const columns = { key: '', source: '', target: '', locked: '', context: '' }
  if (!sheet) return columns
  const selectable = new Set(sheet.columns.filter((column) => column.selectable).map((column) => column.header))
  const used = new Set<string>()
  for (const role of ['key', 'source', 'target', 'locked', 'context'] as const) {
    const value = sheet.suggestion.columns[role]
    if (value && selectable.has(value) && !used.has(value)) { columns[role] = value; used.add(value) }
  }
  return columns
}
export function BatchImport({ projectId, archived, importing, setImporting, onImported }: {
  projectId: string; archived: boolean; importing: boolean; setImporting: (busy: boolean) => void; onImported: () => void
}): React.ReactElement {
  const t = useT()
  const picker = React.useRef<HTMLInputElement>(null)
  const directoryPicker = React.useRef<HTMLInputElement>(null)
  const [open, setOpen] = React.useState(false)
  const [importResult, setImportResult] = React.useState<LinguistProjectImportResult>()
  const [error, setError] = React.useState('')
  const [notice, setNotice] = React.useState('')
  const [progress, setProgress] = React.useState<Progress>()
  const [now, setNow] = React.useState(Date.now)
  const [sheetName, setSheetName] = React.useState('')
  const [columns, setColumns] = React.useState({ key: '', source: '', target: '', locked: '', context: '' })
  const [rememberMapping, setRememberMapping] = React.useState(true)
  const mapCandidate = importResult && !importResult.cancelled && !importResult.bulk && importResult.requiresXlsxMapping ? importResult : undefined
  const bulkImport = importResult && !importResult.cancelled && importResult.bulk ? importResult : undefined
  const completedImport = importResult && !importResult.cancelled && !importResult.bulk && !importResult.requiresXlsxMapping ? importResult : undefined
  const needsAttention = !!error || !!bulkImport && bulkImport.needsInput + bulkImport.unsupported + bulkImport.failed > 0
  React.useEffect(() => {
    if (!importing) return
    const timer = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(timer)
  }, [importing])
  const updateProgress = (value: Omit<Progress, 'since'>) => setProgress(current => ({ ...value, since: current?.phase === value.phase && current.filename === value.filename ? current.since : Date.now() }))
  const runImport = async (operation: string, input: object) => {
    const requestId = crypto.randomUUID()
    const unsubscribe = await subscribeImport(projectId, requestId, updateProgress, () => setNotice(t('进度连接已断开，正在等待导入结果。请勿重复导入；完成结果返回后会更新此窗口。')))
    try { return await required<LinguistProjectImportResult>(operation, { ...input, projectId, requestId }) }
    finally { unsubscribe() }
  }
  const acceptResult = (result: LinguistProjectImportResult) => {
    setImportResult(result)
    if (!result.cancelled && !result.bulk && result.requiresXlsxMapping) {
      const sheet = result.preview.sheets[0]
      setSheetName(sheet?.name ?? '')
      setColumns(suggestedXlsxColumns(sheet))
    } else onImported()
  }
  const importBatch = async (files: File[], selection: 'files' | 'directory') => {
    setOpen(true); setError(''); setNotice(''); setImportResult(undefined); setImporting(true)
    updateProgress({ filename: files[0]!.name, index: 1, total: files.length, phase: 'uploading', fraction: 0 })
    let tokens: readonly string[] = []
    let awaitingMapping = false
    try {
      tokens = await stageFiles(files, event => updateProgress({ ...event, phase: 'uploading', fraction: event.totalBytes === 0 ? 1 : event.loadedBytes / event.totalBytes }))
      updateProgress({ filename: files[0]!.name, index: 1, total: files.length, phase: 'connecting' })
      const result = await runImport('linguistProjectsImport', { fileTokens: tokens, selection })
      awaitingMapping = !result.cancelled && !result.bulk && result.requiresXlsxMapping
      acceptResult(result)
    } catch (cause) { setError(describeProjectError(cause, t)) }
    finally {
      if (!awaitingMapping && tokens.length) {
        try { await discardStagedFiles(tokens) }
        catch { setNotice(t('暂存文件暂未释放，将在过期后回收。导入结果不受影响。')) }
      }
      setImporting(false)
    }
  }
  const confirmMapping = async () => {
    if (!mapCandidate) return
    setImporting(true); setError(''); setNotice('')
    updateProgress({ filename: mapCandidate.filename, index: 1, total: 1, phase: 'connecting' })
    try {
      acceptResult(await runImport('linguistProjectsConfirmXlsxMapping', { mappingId: mapCandidate.mappingId, sourceSha256: mapCandidate.sourceSha256, sheetName, columns: Object.fromEntries(Object.entries(columns).filter(([, value]) => value)), rememberMapping }))
    } catch (cause) { setError(describeProjectError(cause, t)) }
    finally { setImporting(false) }
  }
  const cancelMapping = async () => {
    if (!mapCandidate) return
    setImporting(true)
    try { await discardStagedFiles([mapCandidate.mappingId]); setImportResult(undefined); setOpen(false) }
    catch (cause) { setError(describeProjectError(cause, t)) }
    finally { setImporting(false) }
  }
  const sheet = mapCandidate?.preview.sheets.find(entry => entry.name === sheetName)
  const selectedColumns = Object.values(columns).filter(Boolean)
  const mappingValid = !!sheet && !!columns.source && !!columns.target && selectedColumns.length === new Set(selectedColumns).size
  const waitingSeconds = progress ? Math.max(0, Math.floor((now - progress.since) / 1000)) : 0
  const title = importing ? '正在导入工作批次' : error ? '导入未完成' : mapCandidate ? '请确认 Excel 列映射' : needsAttention ? '部分文件需要处理' : '导入完成'
  return <>
    <div className={styles.toolbar}>
      <input ref={picker} type="file" multiple hidden disabled={archived || importing || !!mapCandidate} onChange={event => { if (event.target.files?.length) void importBatch(Array.from(event.target.files), 'files'); event.target.value = '' }} />
      <input ref={directoryPicker} type="file" multiple hidden {...{ webkitdirectory: '' }} disabled={archived || importing || !!mapCandidate} onChange={event => { if (event.target.files?.length) void importBatch(Array.from(event.target.files), 'directory'); event.target.value = '' }} />
      <Button variant="primary" size="sm" disabled={archived || importing || !!mapCandidate} onClick={() => picker.current?.click()}>{t('选择文件')}</Button>
      <Button variant="outline" size="sm" disabled={archived || importing || !!mapCandidate} onClick={() => directoryPicker.current?.click()}>{t('选择文件夹')}</Button>
      {(importing || importResult || error) && <Button variant="outline" size="sm" onClick={() => setOpen(true)}>{t(importing ? '查看导入进度' : mapCandidate ? '继续确认映射' : '查看导入结果')}</Button>}
    </div>
    <Modal className={styles.importModal} contentClassName={styles.confirmModalContent} open={open} onClose={() => setOpen(false)} title={t(title)} closeLabel={t(importing ? '收起' : '关闭')} footer={<>
      <Button variant="outline" size="sm" onClick={() => setOpen(false)}>{t(importing ? '收起，继续导入' : '关闭')}</Button>
      {!importing && needsAttention && !mapCandidate && <Button variant="primary" size="sm" disabled={archived} onClick={() => picker.current?.click()}>{t('重新选择文件')}</Button>}
    </>}>
      {progress && (importing || error) && <section className={styles.importProgress} aria-label={t('当前导入阶段')}>
        <div className={styles.importHeading}><strong>{t(phaseLabels[progress.phase])}</strong><span>{t('第 {index} / {total} 个文件', progress)}</span></div>
        <p className={styles.importFilename}>{progress.filename}</p>
        {importing && <progress className={styles.jobProgress} aria-label={t(phaseLabels[progress.phase])} max={1} value={progress.fraction} />}
        <p className={styles.notice} role="status">{importing ? progress.phase === 'uploading' ? t('已上传 {percent}%', { percent: Math.floor((progress.fraction ?? 0) * 100) }) : t('此阶段已等待 {seconds} 秒', { seconds: waitingSeconds }) : t('此阶段未完成')}</p>
        {importing && waitingSeconds >= 30 && <p className={styles.notice}>{t('仍未收到本阶段的完成结果。大文件解析可能需要较长时间；可收起窗口，勿重复导入。')}</p>}
      </section>}
      {error && <div className={styles.importFailure} role="alert">{error}</div>}
      {notice && <p className={styles.notice} role="status">{notice}</p>}
    {mapCandidate && <div className={styles.callout} aria-label={t('XLSX 映射确认')}>
      <div className={styles.toolbar}><strong>{mapCandidate.filename} {t("需要映射列")}</strong><Button variant="outline" size="sm" disabled={importing} onClick={() => void cancelMapping()}>{t('取消')}</Button></div>
      <label>{t('工作表')} <select aria-label={t("工作表")} disabled={importing} value={sheetName} onChange={(event) => { const next = mapCandidate.preview.sheets.find((entry) => entry.name === event.target.value); setSheetName(event.target.value); setColumns(suggestedXlsxColumns(next)) }}>{mapCandidate.preview.sheets.map((entry) => <option key={entry.name} value={entry.name}>{entry.name}{entry.state === 'visible' ? '' : ` (${entry.state})`}</option>)}</select></label>
      {sheet && <>
        <div className={styles.toolbar}>{(['key','source','target','locked','context'] as const).map((field) => <label key={field}>{field}<select aria-label={t('{field} 列', { field })} disabled={importing} value={columns[field]} onChange={(event) => setColumns((current) => ({ ...current, [field]: event.target.value }))}><option value="">{t("未指定")}</option>{sheet.columns.filter((entry) => entry.selectable).map((entry) => <option key={entry.index} value={entry.header}>{entry.header}</option>)}</select></label>)}</div>
        <p>{t('建议置信度 {percent}%', { percent: Math.round(sheet.suggestion.confidence * 100) })} · {sheet.suggestion.reasons.join('；')}</p>
        <details><summary>{t('解析证据：表头 {headers} · 样本 {shown}/{total}', { headers: sheet.headerRowNumbers.join('、') || t('未识别'), shown: sheet.coverage.shownSampleRows, total: sheet.coverage.dataRows })}</summary>
          <p>{t('物理行 {physical} · 非空 {nonEmpty} · 空行 {empty}', { physical: sheet.coverage.physicalRows, nonEmpty: sheet.coverage.nonEmptyDataRows, empty: sheet.coverage.emptyDataRows })}</p>
          <p>{t('公式 {formula} · 无缓存值 {missing} · 错误单元格 {errors} · 合并区域 {merged}', { formula: sheet.distortion.formulaCells, missing: sheet.distortion.formulaCellsWithoutCachedValue, errors: sheet.distortion.errorCells, merged: sheet.distortion.mergedRanges })}</p>
          {sheet.sampleRows.map((row) => <p key={row.rowNo}>{t('第 {row} 行', { row: row.rowNo })}：{row.cells.map((cell) => `${sheet.columns.find((column) => column.index === cell.columnIndex)?.header ?? `#${cell.columnIndex + 1}`}=${cell.value}${cell.truncated ? '…' : ''}`).join(' · ')}</p>)}
        </details>
      </>}
      <div className={styles.toolbar}><Checkbox label={t('记住此映射')} checked={rememberMapping} disabled={importing} onChange={setRememberMapping} /><Button variant="outline" size="sm" disabled={archived || importing || !mappingValid} onClick={() => void confirmMapping()}>{t("确认映射并导入")}</Button></div>
      {!mappingValid && <p role="alert">{t('Source、Target 必选，且每列只能用于一个字段。')}</p>}
    </div>}
      {bulkImport && <section>
        <p role="status">{t('已导入 {imported} · 重复 {duplicate} · 待处理 {attention}', { imported: bulkImport.imported, duplicate: bulkImport.skippedDuplicate, attention: bulkImport.needsInput + bulkImport.unsupported + bulkImport.failed })}</p>
        {bulkImport.truncated && <p role="alert">{t('已达到 500 项上限，请缩小文件夹范围后继续。')}</p>}
        <ul className={styles.importResults}>{bulkImport.items.map((item, index) => <li key={index}><div className={styles.importHeading}><strong>{item.filename}</strong><span>{t(statusLabels[item.status])}</span></div>{item.message && <p>{item.message}</p>}{item.status === 'unsupported' && <p>{t('此格式不能作为工作批次导入，请从原工具导出受支持的双语文件。')}</p>}{item.status === 'needs-input' && item.filename.toLowerCase().endsWith('.xlsx') && <p>{t('请单独选择此 XLSX 以确认 Sheet/列映射')}</p>}</li>)}</ul>
      </section>}
      {completedImport && <section className={styles.importProgress}>
        <strong>{completedImport.filename}</strong>
        <p role="status">{t(statusLabels[completedImport.status])} · {t(describeLinguistFormat(completedImport.formatId))} · {completedImport.segmentCount} {t('段')}</p>
        {isGenericXliffFallback(completedImport.filename, completedImport.formatId) && <p role="note">{t('已按通用 XLIFF 打开；memoQ 专有结构未完全验证')}</p>}
        {completedImport.warnings.map((warning, index) => <p key={index} role="note">{warning.message}</p>)}
        <details><summary>{t('查看导入检查详情')}</summary><p>SHA-256 {completedImport.sourceSha256}</p>{completedImport.mappingUsed && <p>{t('映射已使用')} · {completedImport.mappingUsed.sheetName}</p>}{completedImport.verification.checks.map(check => <p key={check.id}>{check.passed ? '✓' : '✗'} {check.id} · {check.detail}</p>)}</details>
      </section>}
    </Modal>
  </>
}
