import { readFileSync } from 'node:fs'
import type { LinguistRole } from './bindings'

const ROLES = ['general', 'translator', 'reviewer', 'proofreader'] as const
const MAX_ROLE_CHARS = 6_000

/** Packaged role instructions are required product resources, never user-selected paths. */
export function loadLinguistRoleResources(base: URL): Record<LinguistRole, string> {
  return Object.fromEntries(ROLES.map(role => {
    let content: string
    try { content = readFileSync(new URL(`${role}.md`, base), 'utf8') }
    catch (cause) { throw new Error(`Linguist ${role} role resource unavailable`, { cause }) }
    if (!content.trim() || content.length > MAX_ROLE_CHARS) throw new Error(`Linguist ${role} role resource invalid`)
    return [role, content]
  })) as Record<LinguistRole, string>
}
