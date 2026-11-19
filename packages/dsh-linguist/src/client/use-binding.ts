import { useEffect, useState } from 'react'
import { BINDING_CHANGED_EVENT, getBinding, subscribeProject, type LinguistBinding } from './api'

export function useBinding(sessionId: string, preset?: string | null) {
  const [binding, setBinding] = useState<LinguistBinding>()
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  useEffect(() => {
    if (!binding?.projectId) return
    const refresh = () => window.dispatchEvent(new CustomEvent(BINDING_CHANGED_EVENT, { detail: sessionId }))
    return subscribeProject(binding.projectId, 0, event => { if (event.kind === 'project-updated') refresh() }, refresh)
  }, [sessionId, binding?.projectId])
  useEffect(() => {
    let live = true
    let revision = 0
    setBinding(undefined); setError(''); setLoading(true)
    const read = () => {
      const current = ++revision
      getBinding(sessionId).then(value => {
        if (live && current === revision) { setBinding(value); setError(''); setLoading(false) }
      }).catch(cause => { if (live && current === revision) { setError(String(cause)); setLoading(false) } })
    }
    const changed = (event: Event) => { if ((event as CustomEvent<string>).detail === sessionId) read() }
    read()
    window.addEventListener(BINDING_CHANGED_EVENT, changed)
    return () => { live = false; window.removeEventListener(BINDING_CHANGED_EVENT, changed) }
  }, [sessionId, preset])
  return { binding, error, loading }
}
