import * as React from 'react'
import { Button, Input } from '@deepseek-ai/dsh-client-ui-primitives'
import type { LinguistWorkflowStage } from '@linguist/domain-service/contracts'
import { PROJECT_NAME_MAX_LENGTH } from '../project-input'
import { ProjectLocaleSelect } from './ProjectLocaleSelect'
import { describeProjectError } from './project-errors'
import { useT } from './ui-locale'
import styles from './ProjectsPage.module.css'

export type ProjectSetup = { name: string; sourceLocale: string; targetLocale: string; workflowStage: LinguistWorkflowStage; qaProfile: 'general' | 'subtitle' }
export const DEFAULT_PROJECT_SETUP: ProjectSetup = { name: '', sourceLocale: 'zh-CN', targetLocale: 'en-US', workflowStage: 'translation', qaProfile: 'general' }

export function ProjectCreateForm({ input, onInputChange, disabled, children, onCreate, onBusyChange }: {
  input: ProjectSetup
  onInputChange: React.Dispatch<React.SetStateAction<ProjectSetup>>
  disabled?: boolean
  children?: React.ReactNode
  onCreate: (input: ProjectSetup) => Promise<void>
  onBusyChange: (busy: boolean) => void
}) {
  const t = useT()
  const [busy, setBusy] = React.useState(false)
  const [error, setError] = React.useState('')
  const create = async (event: React.FormEvent) => {
    event.preventDefault()
    setBusy(true); onBusyChange(true); setError('')
    try { await onCreate({ ...input, name: input.name.trim() }) }
    catch (cause) { setError(describeProjectError(cause, t)) }
    finally { setBusy(false); onBusyChange(false) }
  }
  return <form className={styles.form} onSubmit={event => void create(event)}>
    {children}
    <label>{t('名称')}<Input required disabled={busy} maxLength={PROJECT_NAME_MAX_LENGTH} data-modal-autofocus placeholder={t('例如：官网本地化')} value={input.name} onChange={event => onInputChange(current => ({ ...current, name: event.target.value }))} /></label>
    <div className={styles.locale}>
      <ProjectLocaleSelect label={t('源语言')} disabled={busy} value={input.sourceLocale} onValueChange={sourceLocale => onInputChange(current => ({ ...current, sourceLocale }))} />
      <ProjectLocaleSelect label={t('目标语言')} disabled={busy} value={input.targetLocale} onValueChange={targetLocale => onInputChange(current => ({ ...current, targetLocale }))} />
    </div>
    <label>{t('当前工作阶段')}<select disabled={busy} value={input.workflowStage} onChange={event => onInputChange(current => ({ ...current, workflowStage: event.target.value as LinguistWorkflowStage }))}><option value="translation">{t('翻译')}</option><option value="editing">{t('编辑审校')}</option><option value="proofreading">{t('校对')}</option></select></label>
    <small className={styles.formHint}>{t('已有目标译文不会自动算作本轮完成；确认后会按此阶段写回双语文件状态。')}</small>
    <label>{t('QA 场景')}<select disabled={busy} value={input.qaProfile} onChange={event => onInputChange(current => ({ ...current, qaProfile: event.target.value as ProjectSetup['qaProfile'] }))}><option value="general">{t('通用本地化')}</option><option value="subtitle">{t('字幕 / 对白')}</option></select></label>
    <small className={styles.formHint}>{t('字幕模式降低省略号和强调标点噪声；数字、标签与占位符检查不变。')}</small>
    {error && <p className={styles.warning} role="alert">{error}</p>}
    <Button type="submit" variant="primary" size="sm" disabled={busy || disabled || !input.name.trim()}>{busy ? t('正在创建…') : t('创建')}</Button>
  </form>
}
