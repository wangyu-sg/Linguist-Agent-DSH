import type {
  LinguistCurrentStageState,
  LinguistSegmentStatus,
  LinguistWorkflowStage,
} from '@linguist/domain-service/contracts'

const progressLabels: Record<LinguistWorkflowStage, Record<LinguistCurrentStageState, string>> = {
  translation: { untouched: '未翻译', draft: '翻译草稿', confirmed: '已确认' },
  editing: { untouched: '待审校', draft: '审校草稿', confirmed: '已审校' },
  proofreading: { untouched: '待校对', draft: '校对草稿', confirmed: '已校对' },
}

const descriptions: Record<LinguistWorkflowStage, Record<LinguistCurrentStageState, string>> = {
  translation: { untouched: '尚无译文，尚未翻译', draft: '翻译草稿已暂存，尚未确认', confirmed: '翻译已确认，可进入审校' },
  editing: { untouched: '等待审校，尚未开始本轮确认', draft: '审校修改已暂存，尚未确认', confirmed: '审校已确认，可进入校对' },
  proofreading: { untouched: '等待校对，尚未开始本轮确认', draft: '校对修改已暂存，尚未确认', confirmed: '校对已确认，片段完成' },
}

const statusLabels: Record<LinguistSegmentStatus, string> = {
  untranslated: '未翻译', draft: '草稿', translated: '已翻译', reviewed: '已审校',
}

export function stageName(stage: LinguistWorkflowStage): string {
  return { translation: '翻译', editing: '审校', proofreading: '校对' }[stage]
}

export function stageActionLabel(stage: LinguistWorkflowStage): string {
  return { translation: '确认翻译', editing: '确认审校', proofreading: '确认校对' }[stage]
}

export function stageCompletionLabel(stage: LinguistWorkflowStage): string {
  return progressLabels[stage].confirmed
}

export function stageProgressLabel(stage: LinguistWorkflowStage, state: LinguistCurrentStageState, hasTarget: boolean): string {
  return stage === 'translation' && state === 'untouched' && hasTarget ? '待确认' : progressLabels[stage][state]
}

export function stageFilterOptions(stage: LinguistWorkflowStage): Array<{ value: LinguistCurrentStageState; label: string }> {
  return (['untouched', 'draft', 'confirmed'] as const).map((value) => ({
    value,
    label: stage === 'translation' && value === 'untouched' ? '未翻译 / 待确认' : progressLabels[stage][value],
  }))
}

export function nextStageItemLabel(stage: LinguistWorkflowStage): string {
  return stage === 'translation' ? '下一个未翻译 / 待确认' : `下一个${progressLabels[stage].untouched}`
}

export function segmentStatusBadgeTitle(stage: LinguistWorkflowStage, state: LinguistCurrentStageState, status: LinguistSegmentStatus, hasTarget: boolean, t: (value: string) => string): string {
  const description = stage === 'translation' && state === 'untouched' && hasTarget ? '已有译文，等待确认翻译' : descriptions[stage][state]
  return `${t(stageName(stage))}${t('阶段')} · ${t(stageProgressLabel(stage, state, hasTarget))}：${t(description)}\n${t('徽标颜色对应整体状态')}：${t(statusLabels[status])}`
}
