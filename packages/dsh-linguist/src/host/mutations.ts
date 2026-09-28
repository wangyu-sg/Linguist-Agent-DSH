import { randomUUID } from 'node:crypto'
import type { ServerResponse } from 'node:http'
import type { LinguistMigrationProgress } from '@linguist/domain-service/contracts'

interface ProjectEvent { projectId: string; revision: number; [key: string]: unknown }

/** Snapshot-first local SSE notification; every mutation response remains authoritative on write success. */
export class MutationBus {
  readonly epoch = randomUUID()
  private readonly revisions = new Map<string, number>()
  private readonly history = new Map<string, ProjectEvent[]>()
  private readonly clients = new Map<string, Set<ServerResponse>>()
  private readonly migrationClients = new Map<string, Set<ServerResponse>>()
  lastError?: string

  revision(projectId: string): number { return this.revisions.get(projectId) ?? 0 }

  publish(projectId: string, mutation: object): ProjectEvent {
    const revision = Math.max(this.revision(projectId) + 1, Date.now() * 1000)
    this.revisions.set(projectId, revision)
    const event = { ...mutation, projectId, revision }
    const records = this.history.get(projectId) ?? []
    records.push(event)
    if (records.length > 200) records.shift()
    this.history.set(projectId, records)
    for (const response of this.clients.get(projectId) ?? []) {
      try { response.write(`id: ${revision}\ndata: ${JSON.stringify(event)}\n\n`) }
      catch (error) {
        this.clients.get(projectId)?.delete(response)
        this.lastError = error instanceof Error ? error.name : typeof error
        console.error('[Linguist] committed mutation SSE delivery failed', this.lastError)
      }
    }
    return event
  }

  publishIntegrity(projectId: string, event: object): void {
    const payload = JSON.stringify({ ...event, projectId })
    for (const response of this.clients.get(projectId) ?? []) {
      try { response.write(`event: integrity\ndata: ${payload}\n\n`) }
      catch (error) {
        this.clients.get(projectId)?.delete(response)
        this.lastError = error instanceof Error ? error.name : typeof error
        console.error('[Linguist] integrity SSE delivery failed', this.lastError)
      }
    }
  }

  subscribe(projectId: string, afterSequence: number, response: ServerResponse): () => void {
    response.write(`event: snapshot\ndata: ${JSON.stringify({ projectId, revision: this.revision(projectId), epoch: this.epoch })}\n\n`)
    for (const event of this.history.get(projectId) ?? []) {
      if (event.revision > afterSequence) response.write(`id: ${event.revision}\ndata: ${JSON.stringify(event)}\n\n`)
    }
    let set = this.clients.get(projectId)
    if (set === undefined) { set = new Set(); this.clients.set(projectId, set) }
    set.add(response)
    return () => { set?.delete(response) }
  }

  publishMigration(workspaceId: string, scanId: string, progress: LinguistMigrationProgress): void {
    const key = JSON.stringify([workspaceId, scanId])
    const payload = JSON.stringify({ workspaceId, scanId, ...progress })
    for (const response of this.migrationClients.get(key) ?? []) {
      try { response.write(`event: migration-progress\ndata: ${payload}\n\n`) }
      catch (error) {
        this.migrationClients.get(key)?.delete(response)
        this.lastError = error instanceof Error ? error.name : typeof error
        console.error('[Linguist] migration progress SSE delivery failed', this.lastError)
      }
    }
  }

  subscribeMigration(workspaceId: string, scanId: string, response: ServerResponse): () => void {
    const key = JSON.stringify([workspaceId, scanId])
    response.write(`event: migration-ready\ndata: ${JSON.stringify({ workspaceId, scanId })}\n\n`)
    let set = this.migrationClients.get(key)
    if (set === undefined) { set = new Set(); this.migrationClients.set(key, set) }
    set.add(response)
    return () => {
      set.delete(response)
      if (set.size === 0) this.migrationClients.delete(key)
    }
  }
}
