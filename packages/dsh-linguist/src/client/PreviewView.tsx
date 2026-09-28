import * as React from 'react'
import { Button } from '@deepseek-ai/dsh-client-ui-primitives'
import type { LinguistAssetPreviewResult } from '@linguist/domain-service/contracts'
import { required } from './api'
import { useT } from './ui-locale'
import styles from './Panels.module.css'

export interface PreviewRequest {
  operation: 'linguistProjectsPreviewAssetSource' | 'linguistAssetsPreviewContextDoc' | 'linguistReferencesPreviewCandidate'
  input: object
}

export function PreviewView({ request, onClose }: { request: PreviewRequest; onClose: () => void }): React.ReactElement {
  const t = useT()
  const [preview, setPreview] = React.useState<LinguistAssetPreviewResult>()
  const [error, setError] = React.useState('')
  React.useEffect(() => {
    let live = true
    required<LinguistAssetPreviewResult>(request.operation, request.input)
      .then((next) => { if (live) { setPreview(next); setError('') } })
      .catch((cause: unknown) => { if (live) setError(String(cause)) })
    return () => { live = false }
  }, [request])
  return <section className={styles.previewPane} aria-label={t("原文件预览")}>
    <div className={styles.toolbar}><strong>{preview?.filename ?? t("正在读取原文件…")}</strong><Button size="sm" onClick={onClose}>{t("关闭预览")}</Button></div>
    {error && <p role="alert">{error}</p>}
    {preview?.kind === 'text' && <><pre>{preview.text}</pre>{preview.truncated && <p role="note">{t("文本预览已截断；原文件没有改动。")}</p>}</>}
    {preview?.kind === 'html' && <><iframe title={t('{filename} 预览', { filename: preview.filename })} sandbox="" referrerPolicy="no-referrer" srcDoc={`<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data: blob:">${preview.html}`} />{preview.text && <details><summary>{t("提取的纯文本")}</summary><pre>{preview.text}</pre></details>}</>}
    {preview?.kind === 'url' && (preview.url.startsWith('/la/v1/files/')
      ? <p><a href={preview.url} target="_blank" rel="noopener noreferrer">{t("在本机受管预览中打开")} {preview.filename}</a></p>
      : <p role="alert">{t("Host 未返回受管的本地预览 URL。")}</p>)}
  </section>
}
