import type { LinguistProposalDiff, LinguistProposalStatus } from '@linguist/domain-service/contracts'

export function textDiffParts(current: string, proposed: string): Array<{ kind: 'equal' | 'remove' | 'insert'; text: string }> {
  const before = Array.from(current)
  const after = Array.from(proposed)
  let prefix = 0
  while (prefix < before.length && prefix < after.length && before[prefix] === after[prefix]) prefix += 1
  let suffix = 0
  while (suffix < before.length - prefix && suffix < after.length - prefix && before[before.length - 1 - suffix] === after[after.length - 1 - suffix]) suffix += 1
  const parts: Array<{ kind: 'equal' | 'remove' | 'insert'; text: string }> = []
  if (prefix) parts.push({ kind: 'equal', text: before.slice(0, prefix).join('') })
  if (before.length > prefix + suffix) parts.push({ kind: 'remove', text: before.slice(prefix, before.length - suffix).join('') })
  if (after.length > prefix + suffix) parts.push({ kind: 'insert', text: after.slice(prefix, after.length - suffix).join('') })
  if (suffix) parts.push({ kind: 'equal', text: before.slice(before.length - suffix).join('') })
  return parts
}

export function groupProposalRuns(diffs: readonly LinguistProposalDiff[]): Array<{
  runId: string
  createdAt: string
  modelId?: string
  sessionId?: string
  items: LinguistProposalDiff[]
  statusCounts: Partial<Record<LinguistProposalStatus, number>>
}> {
  const groups = new Map<string, ReturnType<typeof groupProposalRuns>[number]>()
  for (const diff of diffs) {
    const proposal = diff.proposal
    const source = diff.latestIssuance
    const runId = source?.runId ?? proposal.runId ?? 'legacy'
    const createdAt = source?.createdAt ?? proposal.createdAt
    let group = groups.get(runId)
    if (!group) {
      group = { runId, createdAt, modelId: source?.modelId ?? proposal.modelId, sessionId: source?.sessionId ?? proposal.sessionId, items: [], statusCounts: {} }
      groups.set(runId, group)
    }
    group.items.push(diff)
    group.statusCounts[proposal.status] = (group.statusCounts[proposal.status] ?? 0) + 1
    if (createdAt > group.createdAt) group.createdAt = createdAt
  }
  return [...groups.values()].sort((left, right) => right.createdAt.localeCompare(left.createdAt) || right.runId.localeCompare(left.runId))
}
