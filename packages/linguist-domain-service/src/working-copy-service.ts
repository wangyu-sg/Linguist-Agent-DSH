import { createHash } from 'node:crypto'
import { mkdirSync, realpathSync } from 'node:fs'
import { join, relative, isAbsolute } from 'node:path'
import type { LinguistTagProfile } from '@linguist/cat-core'
import { writeJsonFileAtomic } from './safe-file'
import { assembleWorkingCopy, prepareWorkingCopy, readWorkingJson } from './working-copy'

export interface WorkingCopyActionInput {
  operation: 'prepare' | 'assemble'
  sourcePath: string
  sourceLocale: string
  targetLocale: string
  previousResultPath?: string
  decisionsPath?: string
}

export interface WorkingCopyContext {
  workspaceRoot: string
  sessionId: string
  tagProfile?: LinguistTagProfile
}

/** The Host supplies the bound DSH Session workspace on every call. */
export async function executeWorkingCopyAction(
  input: WorkingCopyActionInput,
  resolveContext: () => WorkingCopyContext,
  signal?: AbortSignal,
) {
  if (signal?.aborted) throw new Error('操作已停止')
  if (input.operation === 'assemble' && input.decisionsPath === undefined) throw new Error('assemble 需要 decisionsPath')
  if (input.operation === 'prepare' && input.previousResultPath !== undefined) throw new Error('工作稿接续使用 assemble 和 previousResultPath，sourcePath 仍是原文件')
  const context = resolveContext()
  if (context.sessionId === '' || context.sessionId === '.' || context.sessionId === '..' || context.sessionId.includes('/') || context.sessionId.includes('\\')) {
    throw new Error('无效的会话身份')
  }
  const baseline = await prepareWorkingCopy({ ...input, workspaceRoot: context.workspaceRoot })
  const assembled = input.operation === 'assemble'
    ? assembleWorkingCopy(baseline, readWorkingJson(context.workspaceRoot, input.decisionsPath!).value, context.tagProfile,
      input.previousResultPath === undefined ? undefined : readWorkingJson(context.workspaceRoot, input.previousResultPath))
    : undefined
  const result = assembled ?? baseline
  if (signal?.aborted) throw new Error('操作已停止')
  const current = resolveContext()
  if (current.workspaceRoot !== context.workspaceRoot || current.sessionId !== context.sessionId) throw new Error('工作区绑定已变化')
  const root = realpathSync(context.workspaceRoot)
  const parts = ['.linguist', 'working-copies', baseline.sourceSha256, context.sessionId]
  let parent = root
  for (const part of parts) {
    const child = join(parent, part)
    mkdirSync(child, { recursive: true })
    parent = realpathSync(child)
    const within = relative(root, parent)
    if (within.startsWith('..') || isAbsolute(within)) throw new Error('工作成果目录越界')
  }
  const output = join(parent, input.operation === 'prepare' ? 'bilingual.json' : 'result.json')
  writeJsonFileAtomic(output, result)
  return {
    path: relative(root, output),
    artifactSha256: createHash('sha256').update(JSON.stringify(result, null, 2)).digest('hex'),
    sourceSha256: baseline.sourceSha256,
    segments: baseline.segments.length,
    format: baseline.formatId,
    warnings: baseline.warnings,
    ...(assembled ? { coverage: assembled.coverage, finalChangeCount: assembled.finalChanges.length, submitted: false, nextAction: assembled.nextAction } : {}),
  }
}
