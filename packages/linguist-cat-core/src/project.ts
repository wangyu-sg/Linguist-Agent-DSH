/**
 * LinguistProject metadata. Version 1 belongs to projects created by the
 * former Host; version 2 has no Host workspace identifier.
 */

import { generateProjectId, type EntropySource, type ProjectId } from './ids'
import type { LinguistGlossaryPolicy } from './glossary-policy'
import { normalizeQaProfile, type QaProfile } from './qa-profile'
import type { LinguistTagProfile } from './tag-profile'
import type { LinguistWorkbookMappingProfile } from './workbook-mapping'
import {
  normalizeWorkflowStage,
  type WorkflowOutputStatusPolicy,
  type WorkflowStage,
} from './workflow'

interface ProjectFields {
  id: ProjectId
  name: string
  sourceLocale: string
  targetLocale: string
  createdAt: string
  updatedAt: string
  archivedAt?: string
  /**
   * 术语执行策略（PB-096，契约《通用缺陷等级》）。
   * normalizeGlossaryPolicy 回落 'prefer'，绝不主动回写。
   */
  glossaryPolicy?: LinguistGlossaryPolicy
  /**
   * 项目 tag 族登记表（PB-097）。可选字段：旧
   * project.json 无此键，读取经 normalizeTagProfile 回落 undefined
   * （= 仅内置族），绝不主动回写。项目族手工登记，不做 LLM 自动发现。
   */
  tagProfile?: LinguistTagProfile
  /** 当前项目承担的 T/E/P 任务阶段；旧项目读取时规范化为 translation。 */
  workflowStage?: WorkflowStage
  /** 格式原生状态的项目级覆盖策略。 */
  outputStatusPolicy?: WorkflowOutputStatusPolicy
  /** 确定性 QA 的项目预设；旧项目读取为 general。 */
  qaProfile?: QaProfile
  /** Agent/用户确认过的轻量 XLSX 映射；不含主机路径或源文件内容。 */
  workbookMappings?: LinguistWorkbookMappingProfile[]
}

export type LinguistProject =
  | (ProjectFields & { schemaVersion: 1; promaWorkspaceId: string })
  | (ProjectFields & { schemaVersion: 2; promaWorkspaceId?: never })

export interface CreateProjectInput {
  name: string
  sourceLocale: string
  targetLocale: string
  workflowStage?: WorkflowStage
  outputStatusPolicy?: WorkflowOutputStatusPolicy
  qaProfile?: QaProfile
}

export interface CreateProjectDeps {
  entropy?: EntropySource
  /** ISO timestamp; inject for determinism. */
  now?: string
}

export function createProject(input: CreateProjectInput, deps: CreateProjectDeps = {}): LinguistProject {
  const now = deps.now ?? new Date().toISOString()
  return {
    schemaVersion: 2,
    id: generateProjectId(deps.entropy),
    name: input.name,
    sourceLocale: input.sourceLocale,
    targetLocale: input.targetLocale,
    workflowStage: normalizeWorkflowStage(input.workflowStage),
    qaProfile: normalizeQaProfile(input.qaProfile),
    ...(input.outputStatusPolicy !== undefined
      ? { outputStatusPolicy: input.outputStatusPolicy }
      : {}),
    createdAt: now,
    updatedAt: now,
  }
}

/** Archive is metadata-only; returns a new project object. */
export function archiveProject(project: LinguistProject, now: string): LinguistProject {
  return { ...project, archivedAt: now, updatedAt: now }
}
