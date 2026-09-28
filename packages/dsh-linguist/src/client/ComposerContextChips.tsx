import * as React from 'react'
import { getWorkbenchComposerContext, subscribeWorkbenchComposerContext } from './composer-context'
import { useT } from './ui-locale'
import styles from './Native.module.css'

export function ComposerContextChips({ sessionId }: { sessionId: string }): React.ReactElement | null {
  const t = useT()
  const subscribe = React.useCallback((listener: () => void) => subscribeWorkbenchComposerContext(sessionId, listener), [sessionId])
  const snapshot = React.useCallback(() => getWorkbenchComposerContext(sessionId), [sessionId])
  const context = React.useSyncExternalStore(subscribe, snapshot)
  if (!context) return null
  return <div role="group" aria-label={t('当前 Linguist 工作台视图')} className={styles.contextChips}>
    <span className={styles.contextChip} title={context.projectId}>{context.projectName}</span>
    {context.assetId && <span className={styles.contextChip} title={context.assetId}>{context.assetName ?? t('当前批次')}</span>}
    {context.referenceSegmentId && <span className={styles.contextChip} title={context.referenceSegmentId}>{t('引用片段')}<button type="button" onClick={context.clearReference} aria-label={t('清除引用片段')}>×</button></span>}
    {context.selectedCount > 0 && <span className={styles.contextChip}>{t('已选 {count} 段', { count: context.selectedCount })}<button type="button" onClick={context.clearSelection} aria-label={t('清除已选片段')}>×</button></span>}
    {(context.referenceSegmentId || context.selectedCount > 0) && <small>{t('普通发送不附带工作台选区；请用“让 Agent 处理所选”。')}</small>}
  </div>
}
