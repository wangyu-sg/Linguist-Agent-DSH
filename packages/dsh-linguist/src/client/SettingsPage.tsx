import * as React from 'react'
import { Button, Checkbox } from '@deepseek-ai/dsh-client-ui-primitives'
import type { LinguistProjectSummary } from '@linguist/domain-service/contracts'
import { required } from './api'
import { useEditorViewOptions, type EditorViewOptions } from './EditorAssistance'
import { ProjectSettingsPanel } from './Panels'
import styles from './SettingsPage.module.css'

interface SettingsInfo {
  dataRoot: string; semanticEnabled: boolean; model: string
  projects: Array<{ id: string; name: string; cache: { bytes: number; running: boolean } }>
  onlineCache: { bytes: number; running: boolean }
}

export function SettingsPage({ onOpenPlugins, onOpenProject, capabilities }: {
  onOpenPlugins: () => void; onOpenProject: (id: string, dock?: 'qa' | 'proposals') => Promise<void>; capabilities: React.ReactNode
}) {
  const [info, setInfo] = React.useState<SettingsInfo>()
  const [error, setError] = React.useState('')
  const [busy, setBusy] = React.useState(false)
  const [message, setMessage] = React.useState('')
  const [model, setModel] = React.useState<{ available: boolean; model: string; error?: string }>()
  const [projectId, setProjectId] = React.useState('')
  const [project, setProject] = React.useState<LinguistProjectSummary>()
  const [revision, setRevision] = React.useState(0)
  const [views, setViews, viewError] = useEditorViewOptions()
  const refresh = async () => setInfo(await required<SettingsInfo>('linguistSettingsGet', {}))
  React.useEffect(() => { void refresh().catch(cause => setError(String(cause))) }, [revision])
  React.useEffect(() => {
    let live = true
    setProject(undefined)
    if (projectId) void required<LinguistProjectSummary>('linguistProjectsGetSummary', { projectId })
      .then(value => { if (live) setProject(value) }).catch(cause => { if (live) setError(String(cause)) })
    return () => { live = false }
  }, [projectId, revision])
  const run = async (work: () => Promise<unknown>, success: string) => {
    setBusy(true); setError(''); setMessage('')
    try { await work(); await refresh(); setMessage(success); window.dispatchEvent(new Event('linguist:review-settings')) }
    catch (cause) { setError(String(cause)) }
    finally { setBusy(false) }
  }
  const size = (bytes: number) => `${(bytes / 1024 / 1024).toFixed(1)} MB`
  const labels: Record<keyof EditorViewOptions, string> = { invisibles: '不可见字符', formatCodes: '原生格式码', terms: '术语高亮', critical: '数字与变量提示', spelling: '拼写提示', differences: '修改差异', context: '行内上下文' }
  return <section className={styles.page} aria-label="Linguist 设置">
    <header><h2>Linguist</h2><p>显示与检索偏好统一管理；语言和质量规则只影响所选项目。</p></header>
    <section className={styles.section}><h3>编辑器显示</h3><div className={styles.options}>
      {(Object.keys(labels) as Array<keyof EditorViewOptions>).map(key => <Checkbox key={key} label={labels[key]} checked={views[key]} onChange={value => setViews({ [key]: value })} />)}
    </div><p>显示开关不影响 Agent 取得 TM／TB，也不关闭实际质量检查。重复句联动仍在当前 CAT 工具栏控制。</p></section>
    <section className={styles.section}><h3>语义关联</h3>
      <Checkbox label="自动准备相关句段" checked={info?.semanticEnabled ?? true} disabled={!info || busy} onChange={enabled => void run(() => required('linguistSettingsSemantic', { enabled }), '语义关联设置已保存。')} />
      <p>CAT、线上材料和工作副本共用本地检索与缓存。相似只是审校线索；完整独立审校和 TM／TB 核对始终保留。</p>
      <div className={styles.row}><span>{info?.model ?? 'gpahal/bge-m3-onnx-int8'}</span><Button variant="outline" size="sm" disabled={busy} onClick={() => void run(async () => setModel(await required('linguistSettingsCheckModel', {})), '本地模型检查完成。')}>检查本地模型</Button></div>
      {model && <p role={model.available ? 'status' : 'alert'}>{model.available ? '本地环境与模型文件可用。' : model.error}</p>}
    </section>
    <section className={styles.section}><h3>存储与缓存</h3><p>数据目录</p><code>{info?.dataRoot ?? '读取中…'}</code>
      <p>清理只删除可重建的语义向量和分组，下次使用时重新计算；译文、语言资产、记忆和备份保留。</p>
      {info && [...info.projects.map(item => ({ ...item, projectId: item.id })), { id: 'online', name: '未绑定项目的线上材料', projectId: undefined, cache: info.onlineCache }].map(item => <div className={styles.row} key={item.id}>
        <span>{item.name}<small>{size(item.cache.bytes)}{item.cache.running ? ' · 正在计算' : ''}</small></span>
        <Button variant="outline" size="sm" disabled={busy || item.cache.bytes === 0 && !item.cache.running} onClick={() => void run(() => required('linguistSettingsClearCache', { projectId: item.projectId }), '语义缓存已清理。')}>清理缓存</Button>
      </div>)}
    </section>
    <section className={styles.section}><h3>项目规则与维护</h3><p>语言对、QA、标签、SDLXLIFF 交付状态、备份和诊断沿用项目原有设置。TM／TB 与 SG 在对应项目资料中管理。</p>
      <label className={styles.row}>项目<select value={projectId} onChange={event => { setProjectId(event.target.value); setError('') }}><option value="">选择项目</option>{info?.projects.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
      {project && <><Button variant="outline" size="sm" onClick={() => void run(() => onOpenProject(project.project.id), '')}>打开此项目的 CAT 与 TM／TB</Button>
        <ProjectSettingsPanel key={project.project.id} project={project.project} hasBatches={project.assetCount > 0} mutation={revision} onChanged={() => setRevision(value => value + 1)} onOpenHistory={dock => { void run(() => onOpenProject(project.project.id, dock), '') }} capabilities={capabilities} /></>}
    </section>
    <section className={styles.section}><h3>通知与连接</h3><p>飞书／Lark 目标沿用 Linguist 原生插件配置，任务是否通知仍在任务中选择。在线作业使用 ego lite。请在 DSH 中按官方 ego-browser 技能连接，实际页面可读取后再开始。MemSearch 使用其原生配置。</p><Button variant="outline" size="sm" onClick={onOpenPlugins}>打开插件配置</Button></section>
    <div role={error || viewError ? 'alert' : 'status'}>{error || viewError || (busy ? '处理中…' : message)}</div>
    <Button variant="ghost" size="sm" disabled={busy} onClick={() => void run(refresh, '状态已刷新。')}>刷新状态</Button>
  </section>
}
