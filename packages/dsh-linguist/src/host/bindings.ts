import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { ExecutionProfile } from './execution-profile'
import type { CatReadVersion } from '@linguist/cat-tools'

export type LinguistRole = 'general' | 'translator' | 'reviewer' | 'proofreader'
export type LinguistWorkMode = 'cat' | 'working-copy' | 'browser'

export interface SessionBinding {
  workspaceId: string
  projectId?: string
  taskGroupId?: string
  role: LinguistRole
  workMode: LinguistWorkMode
  workModeDecision?: { source: 'user' | 'automatic' }
  reportOnly?: boolean
  useRoleDefaults?: boolean
  executionProfile?: ExecutionProfile
  professionalSource?: string
  delegatedScope?: { assetIds: string[]; segmentIds: string[] }
  reviewSnapshot?: { id: string; versions: CatReadVersion[] }
}

interface BindingState {
  version: 1
  projects: Record<string, string>
  sessions: Record<string, SessionBinding>
}

/** Small product-owned association table; CAT project metadata stays Host-neutral. */
export class BindingStore {
  private readonly path: string
  private state: BindingState

  constructor(dataRoot: string) {
    mkdirSync(dataRoot, { recursive: true, mode: 0o700 })
    this.path = join(dataRoot, 'linguist-bindings.json')
    try {
      const parsed: unknown = JSON.parse(readFileSync(this.path, 'utf8'))
      if (!isBindingState(parsed)) throw new Error('Invalid Linguist binding state')
      this.state = parsed
      if (Object.values(parsed.sessions).some(entry => Object.hasOwn(entry, 'workModeConfirmed'))) {
        const sessions = Object.fromEntries(Object.entries(parsed.sessions).map(([id, entry]) => {
          const { workModeConfirmed, ...binding } = entry as SessionBinding & { workModeConfirmed?: boolean }
          return [id, { ...binding, ...(workModeConfirmed && !binding.workModeDecision ? { workModeDecision: { source: 'user' as const } } : {}) }]
        }))
        this.save({ ...parsed, sessions })
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
      this.state = { version: 1, projects: {}, sessions: {} }
    }
  }

  projectWorkspace(projectId: string): string | undefined {
    return this.state.projects[projectId]
  }

  session(sessionId: string): SessionBinding | undefined {
    return this.state.sessions[sessionId]
  }

  bindProject(projectId: string, workspaceId: string): void {
    const existing = this.state.projects[projectId]
    if (existing !== undefined && existing !== workspaceId) {
      throw new Error(`Project ${projectId} is already bound to another DSH Workspace`)
    }
    this.save({ ...this.state, projects: { ...this.state.projects, [projectId]: workspaceId } })
  }

  bindSession(sessionId: string, binding: SessionBinding): void {
    this.save({ ...this.state, sessions: { ...this.state.sessions, [sessionId]: binding } })
  }

  restoreSession(sessionId: string, previous: SessionBinding | undefined): void {
    const sessions = { ...this.state.sessions }
    if (previous === undefined) delete sessions[sessionId]
    else sessions[sessionId] = previous
    this.save({ ...this.state, sessions })
  }

  private save(next: BindingState): void {
    const temp = `${this.path}.${process.pid}.tmp`
    writeFileSync(temp, JSON.stringify(next), { mode: 0o600 })
    renameSync(temp, this.path)
    this.state = next
  }
}

function isBindingState(value: unknown): value is BindingState {
  return typeof value === 'object' && value !== null
    && 'version' in value && value.version === 1
    && 'projects' in value && typeof value.projects === 'object' && value.projects !== null
    && 'sessions' in value && typeof value.sessions === 'object' && value.sessions !== null
}
