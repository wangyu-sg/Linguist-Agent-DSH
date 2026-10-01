import * as React from 'react'
import { Button } from '@deepseek-ai/dsh-client-ui-primitives'
import { getDocument, PDFWorker, type PDFDocumentLoadingTask, type PDFDocumentProxy, type RenderTask } from 'pdfjs-dist'
import { useT } from './ui-locale'
import styles from './Workbench.module.css'

export function PdfPreview({ url, filename }: { url: string; filename: string }): React.ReactElement {
  const t = useT()
  const canvas = React.useRef<HTMLCanvasElement>(null)
  const [document, setDocument] = React.useState<PDFDocumentProxy>()
  const [page, setPage] = React.useState(1)
  const [busy, setBusy] = React.useState(true)
  const [error, setError] = React.useState('')
  const [retry, setRetry] = React.useState(0)
  React.useEffect(() => {
    const abort = new AbortController()
    let task: PDFDocumentLoadingTask | undefined
    let worker: PDFWorker | undefined
    let port: Worker | undefined
    setDocument(undefined)
    setPage(1)
    setBusy(true)
    setError('')
    canvas.current!.width = 0
    const load = async (): Promise<void> => {
      const response = await fetch(url, { credentials: 'same-origin', signal: abort.signal })
      if (!response.ok) throw new Error(`Linguist PDF preview failed: HTTP ${response.status}`)
      const data = new Uint8Array(await response.arrayBuffer())
      if (abort.signal.aborted) return
      port = new Worker('/la/v1/pdf-worker.mjs', { type: 'module' })
      worker = PDFWorker.fromPort({ port })
      task = getDocument({ data, worker, isEvalSupported: false })
      const failed = new Promise<never>((_resolve, reject) => {
        port!.addEventListener('error', event => {
          const cause = new Error(event.message)
          if (!abort.signal.aborted) { setError(String(cause)); setBusy(false) }
          reject(cause)
        }, { once: true })
      })
      const next = await Promise.race([task.promise, failed])
      if (!abort.signal.aborted) setDocument(next)
    }
    void load().catch((cause: unknown) => {
      if (!abort.signal.aborted) { setError(String(cause)); setBusy(false) }
    })
    return () => {
      abort.abort()
      if (task) void task.destroy().catch((cause: unknown) => console.error('[Linguist] PDF cleanup failed', cause)).finally(() => { worker?.destroy(); port?.terminate() })
      else { worker?.destroy(); port?.terminate() }
    }
  }, [url, retry])
  React.useEffect(() => {
    if (!document) return
    let live = true
    let render: RenderTask | undefined
    setBusy(true)
    setError('')
    const draw = async (): Promise<void> => {
      const pdfPage = await document.getPage(page)
      if (!live) return
      const viewport = pdfPage.getViewport({ scale: 1.5 })
      const element = canvas.current!
      const context = element.getContext('2d')
      if (!context) throw new Error('PDF canvas is unavailable')
      element.width = Math.ceil(viewport.width)
      element.height = Math.ceil(viewport.height)
      render = pdfPage.render({ canvasContext: context, viewport })
      await render.promise
      if (live) setBusy(false)
    }
    void draw().catch((cause: unknown) => { if (live) { setError(String(cause)); setBusy(false) } })
    return () => { live = false; render?.cancel() }
  }, [document, page])
  return <section className={styles.pdfPreview} aria-label={t('PDF 预览')} aria-busy={busy}>
    <div className={styles.pdfToolbar}>
      <Button variant="outline" size="sm" disabled={!document || busy || page === 1} onClick={() => setPage(value => value - 1)}>{t('上一页')}</Button>
      <span>{document && t('第 {page} / {total} 页', { page, total: document.numPages })}</span>
      <Button variant="outline" size="sm" disabled={!document || busy || page === document.numPages} onClick={() => setPage(value => value + 1)}>{t('下一页')}</Button>
    </div>
    {busy && <p role="status">{t('正在读取 PDF…')}</p>}
    {error && <p role="alert">{t('PDF 预览失败')}：{error} <Button variant="outline" size="sm" onClick={() => setRetry(value => value + 1)}>{t('重试')}</Button></p>}
    <canvas ref={canvas} className={styles.pdfCanvas} aria-label={t('{filename} 预览', { filename })} hidden={Boolean(error)} />
  </section>
}
