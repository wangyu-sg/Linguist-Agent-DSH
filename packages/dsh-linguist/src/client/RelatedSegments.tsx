import * as React from 'react'
import { Button } from '@deepseek-ai/dsh-client-ui-primitives'
import { required } from './api'

interface Related {
  status: 'ready' | 'disabled' | 'failed'; error?: string; scope?: number
  segments: Array<{ id: string; ordinal: number; key?: string; source: string; target: string }>
}

export function RelatedSegments({ projectId, segmentId, mutation, onNavigate }: { projectId: string; segmentId: string; mutation: number; onNavigate: (id: string) => void }) {
  const [data, setData] = React.useState<Related>()
  const [error, setError] = React.useState('')
  const [refresh, setRefresh] = React.useState(0)
  React.useEffect(() => {
    const changed = () => setRefresh(value => value + 1)
    window.addEventListener('linguist:review-settings', changed)
    return () => window.removeEventListener('linguist:review-settings', changed)
  }, [])
  React.useEffect(() => {
    let live = true
    setData(undefined); setError('')
    const timer = setTimeout(() => {
      void required<Related>('linguistCatRelated', { projectId, segmentId }).then(value => { if (live) setData(value) })
        .catch(cause => { if (live) setError(String(cause)) })
    }, 150)
    return () => { live = false; clearTimeout(timer) }
  }, [projectId, segmentId, mutation, refresh])
  return <details><summary>相关句段{data?.status === 'ready' ? ` · ${data.segments.length}` : ''}</summary>
    <p>整批原文检索，展示当前已保存译文。相关不等于错误，也不证明必须统一译法。</p>
    {error ? <p role="alert">{error}</p> : !data ? <p role="status">正在准备关联…</p> : data.status === 'disabled' ? <p>语义关联已在 LA 设置中关闭。</p> : data.status === 'failed' ? <p role="alert">{data.error}</p> : <>
      <small>检索范围 {data.scope} 条；候选不代表完整审校结论。</small>
      {data.segments.map(row => <article key={row.id}><p><strong>#{row.ordinal + 1} {row.key}</strong></p><p>{row.source}</p><p>{row.target}</p><Button variant="ghost" size="sm" onClick={() => onNavigate(row.id)}>定位句段</Button></article>)}
    </>}
  </details>
}
