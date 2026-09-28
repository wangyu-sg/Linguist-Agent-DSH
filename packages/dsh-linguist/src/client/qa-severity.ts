import type { LinguistQaFindingInfo } from '@linguist/domain-service/contracts'

type Severity = LinguistQaFindingInfo['severity']
export type QaSeverityTier = 'blocking' | 'check' | 'notice'

export function qaSeverityTier(severity: Severity): QaSeverityTier {
  return severity === 'L0' || severity === 'L1' ? 'blocking' : severity === 'L4' ? 'notice' : 'check'
}

export function qaSeverityLabel(severity: Severity): string {
  return { L0: 'L0 阻断', L1: 'L1 严重', L2: 'L2 重要', L3: 'L3 次要', L4: 'L4 建议' }[severity]
}

export function qaTierLabel(tier: QaSeverityTier): string {
  return { blocking: '阻止写回', check: '需要检查', notice: '普通提示' }[tier]
}
