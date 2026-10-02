import * as React from 'react'
import { Button, MarkdownText } from '@deepseek-ai/dsh-client-ui-primitives'
import type { LinguistAssetPreviewResult } from '@linguist/domain-service/contracts'
import { required } from './api'
import { useT } from './ui-locale'
import { PdfPreview } from './PdfPreview'
import styles from './Panels.module.css'
import workbenchStyles from './Workbench.module.css'

export interface PreviewRequest {
  operation: 'linguistProjectsPreviewAssetSource' | 'linguistAssetsPreviewContextDoc' | 'linguistReferencesPreviewCandidate'
  input: object
}

export const NativePreviewContext = React.createContext<((path: string) => void) | undefined>(undefined)

export function PreviewView({ request, onClose }: { request: PreviewRequest; onClose: () => void }): React.ReactElement {
  const t = useT()
  const openNative = React.useContext(NativePreviewContext)
  const [preview, setPreview] = React.useState<LinguistAssetPreviewResult>()
  const [mediaType, setMediaType] = React.useState<'image' | 'pdf' | 'other'>('other')
  const [error, setError] = React.useState('')
  const [refresh, setRefresh] = React.useState(0)
  React.useEffect(() => {
    let live = true
    setPreview(undefined)
    setError('')
    required<LinguistAssetPreviewResult>(request.operation, request.input)
      .then(async (next) => {
        if (!live) return
        if (next.kind === 'native') {
          if (!openNative) throw new Error(t('请在项目会话中打开原生预览。'))
          openNative(next.path)
        }
        if (next.kind === 'url') {
          if (!/^\/la\/v1\/files\/[A-Za-z0-9_-]{32}$/.test(next.url)) throw new Error(t('Host 未返回受管的本地预览 URL。'))
          const response = await fetch(next.url, { credentials: 'same-origin' })
          const contentType = response.headers.get('content-type')?.split(';')[0]?.trim().toLowerCase()
          if (response.body) await response.body.cancel()
          if (!response.ok) throw new Error(`Linguist file preview failed: HTTP ${response.status}`)
          if (live) setMediaType(contentType?.startsWith('image/') ? 'image' : contentType === 'application/pdf' ? 'pdf' : 'other')
        }
        if (live) { setPreview(next); setError('') }
      })
      .catch((cause: unknown) => { if (live) setError(String(cause)) })
    return () => { live = false }
  }, [request, refresh])
  return <section className={styles.previewPane} aria-label={t("原文件预览")}>
    <div className={styles.toolbar}><strong>{preview?.filename ?? t(error ? "原文件预览失败" : "正在读取原文件…")}</strong><Button variant="ghost" size="sm" onClick={onClose}>{t("关闭预览")}</Button></div>
    {error && <p role="alert">{error}<Button variant="outline" size="sm" onClick={() => setRefresh((value) => value + 1)}>{t("重试")}</Button></p>}
    {!error && !preview && <p role="status">{t("正在读取原文件…")}</p>}
    {preview?.kind === 'text' && <>{/\.(?:md|markdown)$/i.test(preview.filename)
      ? <div className={workbenchStyles.markdownPreview} aria-label={t('Markdown 预览')}><MarkdownText text={preview.text} variant="body" labels={{ code: { copyLabel: t('复制'), copiedLabel: t('已复制') }, footnotes: t('脚注') }} /></div>
      : <pre>{preview.text}</pre>}{preview.truncated && <p role="note">{t("文本预览已截断；原文件没有改动。")}</p>}</>}
    {preview?.kind === 'native' && <>
      <p role="status">{t('已在 DSH 文档标签中打开只读预览。')}</p>
      <Button variant="outline" size="sm" onClick={() => openNative!(preview.path)}>{t('打开文档预览')}</Button>
    </>}
    {!error && preview?.kind === 'url' && <>
      {mediaType === 'image' && <img className={workbenchStyles.originalImage} src={preview.url} alt={preview.filename} onError={() => setError(t('图片预览失败'))} />}
      {mediaType === 'pdf' && <PdfPreview key={preview.url} url={preview.url} filename={preview.filename} />}
      <p><a href={preview.url} download={preview.filename}>{t("下载原件")} {preview.filename}</a></p>
    </>}
  </section>
}
