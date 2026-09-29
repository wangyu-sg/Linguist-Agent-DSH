import * as React from 'react'
import { Button } from '@deepseek-ai/dsh-client-ui-primitives'
import type { InputActions } from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { CatReferenceStatus, connectCatReference } from './composer-reference'
import { getWorkbenchComposerContext, subscribeWorkbenchComposerContext } from './composer-context'
import { useT } from './ui-locale'
import styles from './Native.module.css'

export function ComposerContextChips({ sessionId, connect, inputActions }: { sessionId: string; connect: (sessionId: string, changed: (status: CatReferenceStatus) => void) => ReturnType<typeof connectCatReference>; inputActions: InputActions }): React.ReactElement | null {
  const t = useT()
  const subscribe = React.useCallback((listener: () => void) => subscribeWorkbenchComposerContext(sessionId, listener), [sessionId])
  const snapshot = React.useCallback(() => getWorkbenchComposerContext(sessionId), [sessionId])
  const context = React.useSyncExternalStore(subscribe, snapshot)
  const [referenceStatus, setReferenceStatus] = React.useState<CatReferenceStatus>('omitted')
  const [error, setError] = React.useState('')
  const reference = React.useRef<ReturnType<typeof connectCatReference>>()
  React.useEffect(() => {
    const connected = connect(sessionId, setReferenceStatus)
    reference.current = connected
    return () => { reference.current = undefined; connected.dispose() }
  }, [sessionId, connect])
  if (!context) return null
  return <div role="group" aria-label={t('当前 Linguist 工作台视图')} className={styles.contextChips}>
    <span className={styles.contextChip} title={context.projectId}>{context.projectName}</span>
    {context.assetId && <span className={styles.contextChip} title={context.assetId}>{context.assetName ?? t('当前批次')}</span>}
    {context.referenceSegmentId && <span className={styles.contextChip} title={context.referenceSegmentId}>{t('引用片段')}<Button variant="ghost" size="sm" type="button" onClick={context.clearReference} aria-label={t('清除引用片段')}>×</Button></span>}
    {context.selectedCount > 0 && <span className={styles.contextChip}>{t('已选 {count} 段', { count: context.selectedCount })}<Button variant="ghost" size="sm" type="button" onClick={context.clearSelection} aria-label={t('清除已选片段')}>×</Button></span>}
    <small>{t(referenceStatus === 'attached' ? '发送时附带当前 CAT 选区。' : '本条未附带 CAT 选区。')}</small>
    {referenceStatus === 'omitted' && <Button variant="outline" size="sm" onClick={() => {
      try {
        if (!reference.current?.attach(inputActions.captureInsertion())) throw new Error(t('输入正在提交，请稍后重新附带选区。'))
        setError('')
      } catch (cause) { setError(String(cause)) }
    }}>{t('附带 CAT 选区')}</Button>}
    {error && <span role="alert">{error}</span>}
  </div>
}
