import * as React from 'react'
import { Button } from '@deepseek-ai/dsh-client-ui-primitives'
import type { LinguistRestorePreview } from '@linguist/domain-service/contracts'
import { useT } from './ui-locale'
import styles from './Panels.module.css'

export function BackupRestorePreview({ preview, archived, busy, onConfirm, onClose }: {
  preview: LinguistRestorePreview
  archived: boolean
  busy: boolean
  onConfirm: () => void
  onClose: () => void
}): React.ReactElement {
  const t = useT()
  const { backupSummary: backup, currentSummary: current } = preview
  const counts = [
    ['批次', backup?.assetCount, current?.assetCount],
    ['总段数', backup?.totalSegments, current?.totalSegments],
    ['未翻译', backup?.segmentCounts.untranslated, current?.segmentCounts.untranslated],
    ['草稿', backup?.segmentCounts.draft, current?.segmentCounts.draft],
    ['兼容状态 translated', backup?.segmentCounts.translated, current?.segmentCounts.translated],
    ['兼容状态 reviewed', backup?.segmentCounts.reviewed, current?.segmentCounts.reviewed],
  ] as const
  return <section className={styles.callout} aria-label={t('预览恢复')}>
    <strong>{preview.backupName}</strong>
    {preview.verification && <div role={preview.verification.ok ? 'status' : 'alert'}>
      <p>{preview.verification.ok ? t('完整性校验通过（文件 SHA-256 与数据库检查）') : t('完整性校验未通过')}</p>
      {preview.verification.problems.length > 0 && <ul>{preview.verification.problems.map((problem, index) => <li key={index}>{problem}</li>)}</ul>}
    </div>}
    <p>{t('备份数据库版本：{version}', { version: preview.backupSchemaVersion === undefined ? t('未知') : `v${preview.backupSchemaVersion}` })} · {t('当前数据库版本：{version}', { version: `v${preview.currentSchemaVersion}` })}</p>
    {preview.willMigrate && <p>{t('恢复后首次打开将自动迁移')}</p>}
    <table style={{ width: '100%', textAlign: 'left' }}>
      <caption>{t('备份与当前项目对照')}</caption>
      <thead><tr><th scope="col">{t('项目')}</th><th scope="col">{t('备份')}</th><th scope="col">{t('当前')}</th></tr></thead>
      <tbody>{counts.map(([label, saved, live]) => <tr key={label}><th scope="row">{t(label)}</th><td>{saved ?? '—'}</td><td>{live ?? '—'}</td></tr>)}</tbody>
    </table>
    {preview.notice && <p>{preview.notice}</p>}
    {preview.restorable && <p>{t('确认恢复将整体替换当前项目的数据库、元数据与源文件。替换前会自动创建 pre-restore 备份，可用于找回当前状态。')}</p>}
    <div className={styles.toolbar}>
      <Button variant="outline" size="sm" disabled={archived || !preview.restorable || busy} onClick={onConfirm}>{busy ? t('正在恢复…') : t('确认恢复')}</Button>
      <Button variant="outline" size="sm" disabled={busy} onClick={onClose}>{t('取消')}</Button>
    </div>
  </section>
}
